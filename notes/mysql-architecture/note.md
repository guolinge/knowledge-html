线上报障：一条 `select` 平时 20ms，某天突然 3 秒。你在慢查询日志里翻到它，给两个字段各加了个索引，第二天却还是慢。为什么加索引没用？为什么同一句 SQL 时快时慢？

要回答这类问题，得知道这条 SQL 进到 MySQL 之后到底发生了什么。这篇把 MySQL 拆成四层，配两张带入口和导览的整体图——第一张是四层全景，第二张把「连接与线程」那一层放大——再跟着一条 SQL 走两遍：读一遍（05 节），写一遍（06 节）。原文档评论区里提过问的 12 个概念（Handler API、权限快照、线程池、JOIN、MVCC、聚簇索引、LRU、doublewrite……）都钉在图上的零件里，点开就有。

## 01 · 一张地图：四层各管什么

不急着背分层图。先做一个思想实验：假如没有 MySQL，要你从零写一个数据库，一条 `select * from t where id = 1` 从 socket 进来，你必须依次完成哪些动作？

```cards
cols: 4
items:
  - { title: 认出它是谁, desc: 校验账号密码、查清权限，连接与认证, tag: 安全职责, tone: blue }
  - { title: 听懂它在说什么, desc: 把 SQL 文本理解成结构化请求，词法、语法、语义分析, tag: 编译职责, tone: violet }
  - { title: 决定怎么干最省, desc: 走哪个索引、表按什么顺序连接，挑代价最小的, tag: 规划职责, tone: amber }
  - { title: 真正把数据搬出来, desc: 读文件、翻页、找行、返回，存储与检索, tag: IO 职责, tone: green }
```

这四件事性质迥异，而且变化节奏完全不同：SQL 语法十几年不变，底层文件格式却换了好几代（MyISAM 时代的 `.MYD/.MYI`，再到 InnoDB 的 `.ibd`）。把变化慢的和变化快的焊在一起，改一处就要动全身。按职责聚类，自然得到三大块：连接层管第一件事，Server 层管第二、三件事，存储引擎层管第四件事。常说的「四层划分」只是把引擎层的物理落地单拎出来，多算一层文件系统层，刀还是那三刀。

这和网络协议栈同构：HTTP 只管语义，不管 TCP 怎么重传；TCP 不管 IP 怎么路由。MySQL 的 Server 层同样不知道 InnoDB 把一行数据存在哪个文件的哪个页里，它只需要喊「给我一行」，引擎去想办法。分层之后每层独立演进、独立替换：认证插件从 `mysql_native_password` 换成 `caching_sha2_password`（连接层换人）、查询缓存整体删除（Server 层换人）、MyISAM 换代成 InnoDB（引擎层换人），邻居全部无感。

```arch
svg: mysql-arch-map
caption: MySQL 四层架构全景。请求自上而下穿透，结果沿原路返回；跨层只有一条 Handler API 契约线。
parts:
  app:
    label: 业务应用
    sub: 发 SQL 的一端
    detail: 开篇那条时快时慢的 SQL 就是从这里发出的。==它对底下是四层这件事完全无感==，只认一条 TCP 连接和一个协议。
  connpool:
    label: 连接池（HikariCP / Druid）
    sub: 客户端侧 · 通道复用
    detail: |
      每执行一条 SQL 都重新建连，账单是：TCP 握手 1~1.5 个 RTT、密码校验与 SSL/RSA 密钥交换、服务端加载权限快照、分配 Session 内存、四次挥手断开。接口 QPS 2000 时，这些开销每秒重复 2000 次。
      连接池像租车行：启动时建好一批长连接停在池里，业务用时**借（borrow）**、用完**还（return）**，把建连成本摊到成千上万条 SQL 上。代价是连接「占着不吐」：长连接的排序缓冲、临时表内存不断开就不归还；前一个业务 `BEGIN` 没 `COMMIT`、改了 `@var`，下个借到这条连接的业务就会踩坑。++所以池子要定期换血（HikariCP 的 `maxLifetime`），或在归还时调 `mysql_reset_connection` 一键还原。++
  connector:
    label: 连接器
    sub: 认证 → 权限快照 → 分配线程
    detail: |
      校验账号密码之后，连接器把该用户的全部权限读出来，==存成这条连接私有的快照==。此后这条连接上的所有权限判断都用这份快照，管理员后来的 REVOKE 对它无效，直到断开重连。
      为什么这么设计？每条语句都现查权限表，权限判断就成了每条 SQL 的一次额外查询，高频语句的放大效应吃不消。快照是「用一次查询换掉无数次查询」，代价就是一致性。
  thread:
    label: 每连接一线程（默认模型）
    sub: one-thread-per-connection
    detail: |
      一条连接独占一个 OS 线程，直到断开。几百条连接的常见规模下它完全够用，所以至今是默认。
      天花板在连接数与线程数 1:1 线性膨胀：线程要么在等 mutex、要么在等对象锁、要么在等 IO；线程数过某个点后，==连 CPU cache 都被频繁切换的线程轮流冲刷==：每个线程刚把热点数据搬进 cache 就被切走，下个线程上来又得重新加载。官方实测：512 连接后 TPS 开始下滑，4096 连接时只剩约 2000 TPS。
  tpool:
    label: 线程池（企业版插件）
    sub: M:N 调度 · 默认不启用
    detail: |
      评论区问过：**加了线程池，连接数：核心是不是变成了 m:1？** 准确说是两级：
      一级是 ==连接 : Worker = M:N==。连接不再占有线程，只占一个队列槽位；16 个 Thread Group（默认值，可设为物理核数、上限 512）各配少量 Worker（每组 2~4 个），4096 条连接挂着，实际干活的可能只有几十个线程。
      二级是 ==Worker : CPU 核 ≈ N:N==。Worker 数量对齐核数，一个核上的线程不被频繁切走，cache 始终是热的，这正是它消除 cache 抖动的原因。
      让 Receiver 一个线程盯住几千条连接的底层能力是 `epoll`（I/O 多路复用）：连接没数据时 Receiver 休眠不耗 CPU，有数据内核才唤醒它。Nginx、Redis、Node 的事件循环都是同一个 M:N 逻辑。
  parser:
    label: 解析器
    sub: 词法 → 语法 → 语义
    detail: |
      词法分析把字符串切成 token（`SELECT`、`name`、`FROM`……），语法分析按规则拼成语法树，语义分析检查对象是否存在、类型是否匹配。
      写错关键字在语法分析这步报 ==ERROR 1064==；表不存在报 ==ERROR 1146==。三段递进和前端的 parse 报错、模块解析失败、运行时类型错误是同一个结构。
  prep:
    label: 预处理器
    sub: 校验存在性 · 展开 select *
    detail: 把 `*` 展开成全部列必须在这一步做，因为它要查数据字典里的表定义，不展开的话优化器根本不知道要算多少列。
  optimizer:
    label: 优化器
    sub: 成本模型（CBO）挑执行计划
    detail: |
      同一条 SQL 有多种等价干法：三张表 join 顺序有 6 种，四张表 24 种，十张表 362 万种；先查 `name='张三'` 再过滤 age，还是反过来，代价能差几个数量级。
      优化器按统计信息（行数、索引基数、数据分布）估算每条路径的 IO 和 CPU 代价，选它认为最省的。==「最优」是基于估计的最优，不是数学上的全局最优==：统计信息过旧，估算就失真，这就是大变更后要 `ANALYZE TABLE` 的原因。8.0 的直方图能补基数的短板——基数只说「有几个不同值」，直方图说「值是怎么分布的」。
  executor:
    label: 执行器
    sub: 权限校验 · 逐行调引擎 · 流式返回
    detail: |
      开工前先做权限校验（无权直接 ERROR 1142），然后循环调用引擎接口逐行取数：一边取、一边 join / 排序 / 聚合、一边把行发回客户端，不等整个结果集攒齐——和 `res.write` 边产边发是同一个思路。
      交界面上的接口名值得看一眼：全表扫走 `rnd_next`（给我下一行），按索引走 `index_read`（按键定位）。==全是「行」粒度的接口==，Server 层从来看不见页、看不见 B+ 树。
  qcache:
    label: 查询缓存（已删除）
    sub: ≤5.7 的历史路径 · 8.0 整体移除
    detail: |
      SQL 文本做 key、结果集做 value，命中就跳过解析优化执行，听着像白捡的加速，死因是失效粒度太粗：表上有任何更新，这张表的所有缓存条目全部清空。写多读少的场景下命中率趋近 0，清空本身还要加锁，从加速器退化成全局热点。
      它在 5.6 默认关闭、5.7.20 弃用、8.0 连代码都删了。别再拿 5.x 时代的文章教人「MySQL 会缓存查询结果」，现在缓存发生在 Buffer Pool 的数据页层面。
  handler:
    label: Handler API
    sub: Server 层与引擎层的统一契约
    detail: |
      全篇最值钱的一条线。引擎以插件形式向 Server 注册一组入口（打开表、按索引读一行、写一行、提交事务），执行器调用的永远是这个抽象，不是某个引擎的具体实现。
      源码里它是一个抽象基类 `class handler`，常见方法按职责分五类：元数据/生命周期（`ha_open` / `ha_close` / `ha_create`）、全表扫描（`ha_rnd_init` / `ha_rnd_next`）、索引查找（`ha_index_init` / `ha_index_read_map` / `ha_index_next`）、数据增删改（`ha_write_row` / `ha_update_row` / `ha_delete_row`）、事务与锁（`external_lock` / `ha_commit` / `ha_rollback`）。
      一条 `SELECT * FROM users WHERE id = 10`（id 是主键）的引擎侧调用：`ha_index_init(PRIMARY_KEY)` 准备主键索引 → `ha_index_read_map(key=10)` 定位 → InnoDB 搜 B+ 树、从 Buffer Pool 或磁盘取页 → 行填进约定的缓冲区返回 → SQL 层过滤、格式化成网络包 → `ha_index_end()` 结束。
      这和 Linux 的 VFS 同构：应用只用 `open` / `read` / `write`，底下换 ext4 还是 xfs 都不改代码。依赖倒置在操作系统里叫 VFS，在数据库里叫 Handler API。
      MySQL 还把这套底层能力暴露过一个同名 SQL 语法：`HANDLER tbl OPEN` / `HANDLER tbl READ ...`，绕过优化器直接按指令扫表。性能极高、CPU 开销极低，但非标准、无法参与多表优化，业务里很少用，多见于基准测试和底层工具。
  binlog:
    label: binlog 日志模块
    sub: Server 层逻辑日志 · 所有引擎共用
    detail: |
      记录「哪个表哪行改成了什么」（statement / row / mixed 三种格式），追加写，写满一个文件开新文件、历史一直保留。它不知道「第几页的哪个字节」，所以能做归档、主从复制和时间点恢复，但做不了崩溃恢复，那是引擎层 redo log 的活。
  bufferpool:
    label: Buffer Pool
    sub: 数据页缓存 · 吃掉 70~80% 物理内存
    detail: |
      InnoDB 的内存缓存，装 16KB 的数据页和索引页。读先查池：命中免磁盘 IO；未命中才从 `.ibd` 加载页入池。写改内存页，页变脏，后台线程异步刷盘。
      生产经验是把 `innodb_buffer_pool_size` 设为物理内存的 70~80%。==为什么不全给？== 剩下的要留给：OS 内核开销、每条连接的私有内存（排序的 `sort_buffer`、join 用的 `join_buffer`，这部分不在 Buffer Pool 里）、写日志经过的 OS Page Cache，以及防止突发高并发把内存顶到 101% 触发 OOM Killer 杀掉 MySQL 进程。
      线上盯命中率：99% 以上是常态，掉下来意味着工作集大于内存。
  rows:
    label: 表数据 · 聚簇索引
    sub: B+ 树叶子即整行 · 行锁 + MVCC
    detail: |
      InnoDB 的表按主键组织成一棵聚簇索引（clustered index）：主键 B+ 树的叶子直接放整行数据，按主键查一次到位，像字典正文按拼音排，翻到就是全部解释。二级索引像部首查字法，查到的是「请翻到正文第 560 页」，==拿着主键再回聚簇索引取整行的过程叫回表==。
      一张表只有一个聚簇索引，因为数据在磁盘上只能按一种顺序物理排列。MyISAM 没有聚簇索引，索引叶子存行地址，查完还要跳一次。
      外键也在这层：它是引擎自备的约束（MyISAM 没有），插入时防瞎填、删除时防孤儿，代价是每次增删改的跨表检查和锁争用，所以高并发大厂通常把约束写进业务代码而不是建物理外键。
  undolog:
    label: undo log
    sub: 旧值版本链 · 回滚 + MVCC 的原料
    detail: |
      每次修改前先记下旧值，像每次 commit 前先存档。行上有隐藏列 `trx_id`（哪个事务改的）和 `roll_pointer`（指向上一个版本），一行数据因此是一条==版本链==，undo 就是链上每个旧版本的存档，git log 是这条链的浏览命令。
      回滚时沿链回溯；MVCC 的一致性读也靠它：写事务改新版本，读事务按自己启动时间的快照（ReadView）去读旧版本，==读不加锁，读写互不阻塞==。
  redolog:
    label: redo log
    sub: 物理日志 · prepare / commit 两个状态
    detail: |
      记「第 N 页偏移 M 处写入了什么」，页级物理修改，给崩溃恢复重放用。先写进内存的 redo log buffer，刷盘时机由 `innodb_flush_log_at_trx_commit` 决定（1 = 每次提交都刷）。
      它有两个状态位：写完改动作先标 ==prepare==，等 binlog 落盘后才标 ==commit==。这两个状态位加上 binlog 的完整性，是 06 节崩溃对账的全部依据。
  ibd:
    label: user.ibd 表空间
    sub: 一张表一个文件 · 16KB 页
    detail: |
      `datadir` 下每个库一个文件夹，库里每张表一个 `.ibd` 文件（5.6 起 `innodb_file_per_table` 默认开启），里面装着这张表的真实行数据和所有索引，按 16KB 一页组织。`DROP TABLE` 能瞬间删文件还空间，就是因为表和文件一一对应。MyISAM 时代是一张表三个文件（`.frm` + `.MYD` + `.MYI`）。
  dwfile:
    label: doublewrite 区
    sub: 刷盘先留完整底稿 · 防 torn page
    detail: |
      MySQL 的页是 16KB，操作系统和磁盘按 4KB 块写，刷一个页要分 4 次。断电落在中间，磁盘上的页就一半新一半旧（torn page / Partial Page Write），校验和（checksum）对不上，整页报废。
      为什么 redo 救不了？它记的是「在某个原本正常的页上做了什么修改」，底子（原始页）本身烂掉了，重放没有意义。
      所以刷脏页分两步：先把页**连续地**刷进磁盘上的 doublewrite 区（顺序写，磁头不跳，极快），再**离散地**写回各自 `.ibd` 的真正位置。前一步成功后底稿就留下了：真在第二步写坏，重启时用 doublewrite 区的完整副本覆盖回去，再应用 redo，数据复原。
  binlogfile:
    label: binlog 文件
    sub: 追加写 · 给从库复制与备份
    detail: 写满一个文件开新文件，历史一直保留。从库拉它重放，备份工具拿它做时间点恢复。事件末尾有 XID 事件作句号，==没有句号的半截事务在对账时不算数==。
  redofile:
    label: redo 文件（循环写）
    sub: 固定大小 · 写满回卷覆盖
    detail: 固定大小、循环写，写满回到开头覆盖。能覆盖的前提是对应脏页已刷盘、进度已记入 checkpoint，所以它不需要无限大，只要装下「还没刷盘的那一小段」。
tours:
  - id: select-journey
    label: "一条 SELECT 的一生"
    steps:
      - { at: [app, connpool], text: "应用不自己建连接，而是向连接池借一条现成的长连接，省掉 TCP 握手加认证这笔账。" }
      - { at: [connector], text: "==连接器认证通过后，把权限做成快照存进这条连接==。此后权限变更对它无效，直到重连。" }
      - { at: [qcache], text: "8.0 之前会先查查询缓存，SQL 文本完全相同才命中。!!8.0 起整个删除!!，这一站只存在于旧版本。" }
      - { at: [parser, prep], text: "解析器把文本切成 token、拼成语法树（写错关键字在这报 1064）；预处理器确认表列存在、把 * 展开成全部列。" }
      - { at: [optimizer], text: "优化器按统计信息估算每条路径的代价：走哪个索引、join 按什么顺序。==它选的是基于估计的最优，不是全局最优==。" }
      - { at: [executor], text: "执行器先做权限校验（用的是建连时的快照，无权直接 ERROR 1142），然后开始逐行取数。" }
      - { at: [handler], text: "==向下统一走 Handler API==：执行器只会喊「给我下一行」，不知道也不关心底下是哪个引擎。" }
      - { at: [bufferpool], text: "引擎先查 Buffer Pool：命中零磁盘 IO。!!第一次查慢、之后变快，就是页进池了!!。" }
      - { at: [ibd], text: "未命中才按索引树从 .ibd 把 16KB 页读进池。内存级和磁盘级的耗时差，就是「时快时慢」的第一个变量。" }
      - { at: [executor, connpool], text: "结果集沿原路流式返回。首字节时间远早于全部完成时间，排查慢查询时这两个数要分开看。" }
  - id: update-journey
    label: "一条 UPDATE 的一生"
    steps:
      - { at: [executor, handler], text: "定位到那一行之前，写链和读链完全相同。" }
      - { at: [rows], text: "给这行加==行锁==，防止并发写互相踩。" }
      - { at: [undolog], text: "先写 ==undo log 备份旧值==，回滚和 MVCC 都靠它。顺序不能反：先有旧值的存档，才有资格改。" }
      - { at: [rows], text: "改内存页，==页变脏页==，此刻磁盘上还是旧值。" }
      - { at: [redolog, binlog], text: "写 redo 标 ==prepare==（事务还没成立），然后写 binlog 并落盘。" }
      - { at: [redolog], text: "binlog 落盘后 redo 才标 ==commit==，之后才返回客户端「更新完成」。" }
      - { at: [dwfile, ibd], text: "脏页稍后由后台线程刷盘：先连续写 doublewrite 留底稿，再离散写回 .ibd。" }
      - { at: [undolog, redolog, binlog], text: "多出来的每一站各防一件事：undo 防改错要还，redo 防改了没落盘，binlog 防改了没法复制。" }
  - id: crash-recovery
    label: "断电重启：两本账怎么对"
    steps:
      - { at: [redolog, binlog], text: "两份日志是两本账：redo 是引擎的物理账，binlog 是全局的逻辑账。两步之间任何时刻都可能断电。" }
      - { at: [redolog], text: "重启后扫 redo：状态是 ==commit==？binlog 必然已落盘（commit 在 binlog 之后才标），直接提交。" }
      - { at: [binlog], text: "状态是 ==prepare==？拿着事务的 XID 去 binlog 里查。" }
      - { at: [binlog], text: "binlog 里有完整记录（末尾有 XID 事件作句号）→ 提交：从库可能已经同步了它，主库必须承认。" }
      - { at: [undolog], text: "没有 → 回滚：从库根本不知道这笔交易，主库必须当它没发生过。" }
      - { at: [redofile], text: "恢复只重放 checkpoint 之后那段日志。LSN 是进度条，不用从五年前重放。" }
  - id: concurrency
    label: "连接和线程：谁在扛并发"
    steps:
      - { at: [connpool, connector], text: "几千条连接挂着，大部分在 Sleep。它们先由连接池和连接器接待。" }
      - { at: [thread], text: "默认模型：==一条连接独占一个 OS 线程==。连接一多，线程跟着涨。" }
      - { at: [thread], text: "线程不是在干活，是在等锁、等 IO；切换太频繁，==CPU cache 被反复冲刷==，加线程反而降吞吐。" }
      - { at: [tpool], text: "线程池把连接和线程解耦：Receiver 用 epoll 盯着几千条连接，Worker 只有核数那么多个。==连接 : 线程是 M:N==。" }
      - { at: [tpool, connector], text: "连接从「占有一个线程」降级为「占有一个队列槽位」，上下文切换的开销随之消失。" }
```

地图上三条线值得先指出来，后面每一节都挂在它们上面：

- **Handler API 那条横线**是 Server 层和引擎层之间唯一的通道。引擎对上面是可整体替换的黑盒，上面三层对引擎也只是「发来执行计划的客户」。
- **两条日志线**颜色不同：binlog 在 Server 层（所有引擎共用），redo 和 undo 在引擎层（InnoDB 自带）。为什么两套，06 节用写链回答。
- **数据流有两个方向**：请求只有一条下行路，结果要沿原路返回。每一层都要同时实现「传下去」和「传上来」。

排障时先用这张图定位层坐标：连接层看 `show processlist`，Server 层看 EXPLAIN 与慢日志，引擎层看 Buffer Pool 命中率与磁盘 IO。能说出 SQL 卡在哪一层，一堆监控指标才不会糊成一团。

## 02 · 连接层：进门手续，和谁来扛并发

### 权限快照：改了权限为什么不生效

连接器做完认证，会到权限表读出该用户的全部权限，存进这条连接的上下文。此后这条连接上的所有权限判断，都用「建连那一刻」的副本：

```journey
- tag: T0 · 建连
  tone: blue
  name: 权限快照生成
  fields:
    - { k: 动作, v: "登录认证 → 读权限表 → 快照存进连接上下文", tone: ok }
    - { k: 之后, v: "这条连接的所有权限判断都用 T0 的副本" }
  note: 和 JWT 同构：签发时把权限打进 token，签发后服务端改角色，已签发的 claim 不变。

- tag: T1 · 管理员 REVOKE
  tone: muted
  name: 权限表已变化
  fields:
    - { k: 权限表, v: "该用户的写权限已被收回", tone: warn }
    - { k: 这条连接, v: "毫无感知，仍持有 T0 快照" }
  note: 快照不会自己过期，只有断开重连才会重新读权限表。

- tag: T2 · 同一连接继续执行
  tone: amber
  name: 仍按 T0 快照放行
  badge: 最反直觉的一步
  badgeTone: red
  fields:
    - { k: 现象, v: "REVOKE 了还能继续操作", tone: warn }
  note: 所以线上回收权限后，通常还要把该用户的活跃连接 KILL 掉，强制重连。

- tag: T3 · 断开重连
  tone: green
  name: 读到新权限
  fields:
    - { k: 结果, v: "新快照生效，被拒绝", tone: ok }
  note: 「权限变更如何强制生效」的完整答案：KILL 连接，或等它自己断，没有第三条路。
```

### 一连接一线程，和它的天花板

默认线程模型是 one-thread-per-connection：一条连接独占一个 OS 线程，直到断开。它的优点是实现简单、连接之间天然隔离、每条连接公平拿到时间片，几百条连接的常见规模下完全够用，所以它至今是默认。

问题出在线程数与连接数 1:1 膨胀。官方博客（TPCC 实测）的描述是：线程要么在等 mutex、要么在等数据库对象锁、要么在等 IO；线程数超过某个点后，上下文切换把 CPU cache 反复冲刷。曲线是：512 连接后 TPS 开始下滑，4096 连接以上只剩约 2000 TPS，而线程池在同样 4096 连接下维持约 17000 TPS。==拐点不是「连接越多越慢」的线性故事，而是「过了某个点，加线程这件事本身变成纯开销」==。这条曲线在性能工程里叫通用可伸缩性定律：上升期、拐点、崩塌期。

同一批连接，接下来走两条完全不同的路。这张图把两条路并排铺开：

```arch
svg: mysql-conn-thread
caption: 4096 条连接同时活跃时，默认模型和线程池分别把它们变成什么，最后又落在哪几个核上。
parts:
  connpool:
    label: 连接池
    sub: 客户端侧 · 借 / 还 / 换血
    detail: |
      4096 条连接不是同时建出来的：连接池启动时就备好一批，业务借、用完还。==连接数看起来吓人，但绝大多数时间它们在 Sleep==，真正决定服务器压力的是「同一时刻有多少条在活跃」。
      它和线程池不是一回事：连接池管**通道复用**（省建连断连的开销），线程池管**算力复用**（让有限的核消化海量请求）。
  conn:
    label: 连接 ×4096
    sub: 服务器眼里的 4096 个会话
    detail: |
      每条连接在服务器侧对应一个 socket fd、一份会话状态和一块内存预算。平时它们安安静静，==大促来时几乎同一毫秒全部醒来==，这才是压力时刻。
      接下来是这张图的核心问题：4096 条同时活跃的连接，会变成多少个「真正在跑」的执行体？
  threadA:
    label: OS 线程 ×4096
    sub: 默认模型：一对一
    detail: |
      one-thread-per-connection：每条连接独占一个 OS 线程，直到断开。几百条连接时这个模型简单好用；4096 条连接就是 4096 个线程。
      官方博客的实测（TPCC）：512 连接后 TPS 开始下滑，4096 连接以上只剩约 2000 TPS。!!加线程超过某个点之后，就变成了纯开销。!!
  waitA:
    label: 三种等待
    sub: 线程不是在干活，是在等
    detail: |
      4096 个线程里真正同时在跑的受限于核数，其余要么在等 mutex、要么在等数据库对象锁、要么在等 IO。等本身不消耗 CPU，==但每次「挂起一个、换上一个」都要操作系统付出切换成本==。
  cliff:
    label: TPS 跌到约 2000
    sub: 活锁雪崩
    detail: |
      切换太频繁，CPU 时间全花在换人上：每个线程刚把热点数据搬进 cache 就被切走，下个线程上来又得从内存重新加载。==CPU 使用率冲到 100%，QPS 却跌到接近 0==，健康检查超时。
  tg:
    label: Thread Group ×16
    sub: 连接先分组
    detail: |
      线程池把整个池水平拆成 16 个互不干扰的组（默认值，`thread_pool_size` 可设为物理核数、上限 512），新连接 round-robin 依次分给各组。
      分组带来两件事：==全局锁竞争被拆散==（4096 条连接不再抢同一个队列的锁），以及 **cache 亲和性**：组绑到固定的核上，组内线程的热点数据留在同一个 CPU cache 里。
  recv:
    label: Receiver ×16
    sub: epoll 盯住自己那批连接
    detail: |
      每个组的 Receiver 是一个非阻塞的监听线程，底层是 Linux 的 epoll（I/O 多路复用）。
      没有 epoll 的年代，一个线程读一个连接，连接没数据线程就被挂起，想盯 256 条连接就得 256 个线程，这是 1:1 噩梦的根子。有了 epoll：Receiver 把几千个连接的 fd 一次性注册给内核，然后 `epoll_wait()` 闭目养神；==没人发数据它完全不耗 CPU==，网卡收到数据，内核才唤醒它，并把「哪几条连接有数据」精准递过来。
  queue:
    label: 任务队列
    sub: 削峰填谷的缓冲
    detail: |
      Receiver 读出来的 SQL 被打包成任务，压进这个组的队列。==连接在这里从「占有一个线程」降级为「占有一个槽位」==，4096 条可以同时挂着，队列按自己的节奏放行。
      突发时请求会在队列里排几毫秒，换来的是系统不雪崩。
  worker:
    label: Worker ×几十
    sub: 真正执行 SQL 的线程
    detail: |
      每个组只有 2~4 个 Worker（全实例几十个），数量对齐 CPU 核数。它们从队列取任务执行：解析、优化、调存储引擎、回结果，干完接着取下一个。4096 连接下实测仍能维持约 17000 TPS。
      ==回答评论区的问题：连接 : Worker 是 M:N（4096 : 几十）；Worker : CPU 核 才接近 1:1。说 m:1 是把两级混成了一级。==
  cpu:
    label: CPU 核 ×16 · 各带 cache
    sub: 两个故事的终点
    detail: |
      左边那条路：几千个线程轮流上核，每次换人都把 cache 冲一遍，命中率雪崩。右边那条路：几十个 Worker 铺在 16 个核上，几乎不换人，cache 一直是热的。
      ==M:N 的收益最终落在这里：不是线程变少了，是每个核上的线程变稳定了。==
tours:
  - id: burst
    label: "4096 条连接同时醒来：两条路"
    steps:
      - { at: [connpool, conn], text: "平时这几千条连接大多在 Sleep。大促的一瞬间，它们几乎同时变成活跃。" }
      - { at: [threadA, waitA], text: "默认模型：每条醒来的连接对应一个 OS 线程，==几千个线程一起上==。它们不是在干活，是在等锁、等 IO。" }
      - { at: [cliff], text: "切换把 CPU 时间吃光：!!QPS 跌到接近 0，健康检查超时!!，这叫活锁雪崩。" }
      - { at: [tg, recv], text: "线程池：连接先分给 16 个组，每组一个 Receiver 用 epoll 盯着自己那批连接，没数据就休眠。" }
      - { at: [queue], text: "有数据的连接变成任务压进队列。==连接从「占有一个线程」变成「占有一个槽位」==。" }
      - { at: [worker], text: "几十个 Worker 从队列取活干，数量对齐核数。" }
      - { at: [cpu], text: "对比终点：左边几千个线程在同样的核上换来换去，右边几十个线程几乎不换人。cache 热不热，就在这里分出来。" }
      - { at: [conn, worker], text: "所以准确的说法是：连接 : Worker 是 M:N，Worker : 核 接近 1:1。评论区那个「m:1」把两级混成了一级。" }
  - id: epoll
    label: "epoll 怎么把连接和线程拆开"
    steps:
      - { at: [recv], text: "没有 epoll 的年代：一个线程读一个连接，连接没数据线程就挂起，盯 256 条连接要 256 个线程。" }
      - { at: [recv], text: "有了 epoll：Receiver 把几千个连接一次性注册给内核，然后 epoll_wait() 闭目养神。" }
      - { at: [conn], text: "==挂着的连接不消耗 CPU==，只有发来数据的连接才会让内核把 Receiver 唤醒。" }
      - { at: [recv, queue], text: "内核把「哪几条连接有数据」的列表递给 Receiver，它只读这几条，打包成任务。" }
      - { at: [worker, cpu], text: "于是线程数和连接数彻底脱钩：线程只跟着核数走，不跟着连接数走。" }
```

评论区在这里问过一个好问题：**加了线程池，连接数：核心是不是变成了 m:1？** 拆成两级看更准。连接 : Worker 是 ==M:N==：4096 条连接只占队列槽位，实际干活的 Worker 每组只有 2~4 个、全实例几十个。Worker : CPU 核才接近 1:1，线程数对齐核数，一个核上的线程不被切走，cache 始终是热的。而让 Receiver 一个线程盯住几千条连接的底层能力是 epoll：连接没数据时 Receiver 休眠，有数据内核才唤醒并把就绪列表精准递给它。Redis、Nginx、Node 的事件循环都是同一个逻辑，MySQL 查询是 CPU 密集的（大排序、大 join 能占住核），所以它没有走「单线程事件循环」，而是走到「线程池」就停了。

线程池是 MySQL Enterprise 的可选插件，社区版没有官方实现（Percona 和 MariaDB 各有自己的版本）。大多数实例连接数在几百以内，默认模型够用；连接数稳定在四位数、且多数连接在跑短查询时，线程池的收益才开始盖过它的调度复杂度。

### 长连接、短连接，和那笔建连账单

```cards
cols: 3
items:
  - title: 建连一次要付什么
    tone: amber
    tag: 短连接每条 SQL 重付一遍
    body: |
      1. TCP 三次握手（1~1.5 个 RTT）
      2. 认证与 SSL/RSA 密钥交换
      3. 服务端加载权限快照
      4. 分配 Session 内存
      5. 执行 SQL
      6. TCP 四次挥手断开
  - title: 长连接的新问题
    tone: violet
    tag: 占着不吐
    body: |
      连接占的内存要到断开才释放：
      复杂查询、临时表、sort_buffer 给每条连接分的内存，活着就越攒越多。
      两个对策：定期断开；或 5.7+ 的 `mysql_reset_connection`：不重建连接，但把内存和状态恢复到初始干净状态。
  - title: 连接池替你做这两件事
    tone: green
    tag: 借还 + 定期换血
    body: |
      驱动内置池（HikariCP、Druid）或 ProxySQL：
      预先建好一批长连接，业务用时借、用完还；
      连接设最大生命周期（`maxLifetime`），到期悄悄换新；
      归还时调 reset 清掉脏状态。
```

两个池子经常被混为一谈，但它们在地图上站在不同的位置、解决不同的问题：

```compare
first: 维度
head: [连接池（客户端 / 中间件）, 线程池（服务端插件）]
rows:
  - 位置: [地图最顶上，业务应用这一侧, 连接层内部]
  - 复用什么: [{ text: 通道复用，省建连断连的开销, tone: green }, { text: 算力复用，让有限的核高效消化海量请求, tone: green }]
  - 解决什么: [建连账单被反复支付, "1:1 线程膨胀导致的 cache 抖动与雪崩"]
  - 默认吗: [主流驱动都内置, { text: 企业版插件，默认不启用, tone: amber }]
```

日常管理还有三个参数值得认识：`max_connections` 是连接上限（默认 151，满了新连接被拒、客户端收到 `Too many connections`），盲目调大是坑：社区版一条连接一个 OS 线程，5000 个活跃连接意味着 5000 个线程加每条几百 KB 的静态内存，先撑爆的是内存和调度器；`wait_timeout` 是空闲超时（默认 28800 秒即 8 小时），超时连接器自动断开，经典踩坑是客户端连接池以为连接还活着、服务端 8 小时没用已经把它踢了，下一次直接拿它发 SQL 就报 `Communications link failure`，++所以客户端池的空闲超时要设得比服务端的 `wait_timeout` 短++；`show processlist` 是连接层的现场巡查，Command 列的 `Sleep` 是发呆、`Query` 是干活、`Locked` 是卡在等锁。

把连接层的账收成一句：==少建连、勤复用、防膨胀==。

## 03 · Server 层：从文本到执行计划

### 查询缓存：一个被删掉的功能

查询缓存想做的事很直白：SQL 文本做 key、结果集做 value，完全相同的 SQL 进来直接命中返回，跳过解析、优化、执行。它死在失效粒度上：

```flow
grid: false
nodes:
  - { id: read, label: 读请求, sub: "SELECT ... · key = SQL 文本", row: 0, kind: backend }
  - { id: hit, label: 命中？直接返回结果集, sub: "多一个空格、换个大小写都算两条不同的 key", row: 1, kind: database }
  - { id: write, label: 表 t 上任何一次 UPDATE, sub: "写多读少的业务里这是常态", row: 1, kind: security, row2: 1 }
  - { id: purge, label: 表 t 的所有缓存条目全部清空, sub: "清空动作本身要加锁 · 高并发写下成全局热点", row: 2, kind: security }
edges:
  - { from: read, to: hit, label: 查缓存 }
  - { from: write, to: purge, label: "失效粒度 = 整张表" }
  - { from: hit, to: purge, label: "刚攒的命中率归零", dashed: true }
```

写多读少的场景下，缓存几乎没机会命中，却要为每次写付出清空成本，从收益变成负担。它在 5.6 就默认关闭，5.7.20 弃用，8.0 连代码都删了。官方给的替代方案分两档：Server-side Query Rewrite 适合把可枚举的查询规则化改写；ProxySQL 这类中间层适合想自己控制失效粒度的场景，共同点是==失效由使用者定义==，而不是系统武断地「一表更新、全表作废」。

!!别把两个「缓存」混为一谈：删掉的是 Server 层的结果集缓存；InnoDB 的 Buffer Pool 是数据页缓存，更新不清空它，活得好好的。!!

### 解析：SQL 文本怎么变成语法树

```flow
grid: false
legend: false
nodes:
  - { id: text, label: "select name from t where id = 1", sub: 一串字符, row: 0, kind: external }
  - { id: lex, label: 词法分析, sub: "切成 token：SELECT / name / FROM / t / WHERE / id / = / 1", row: 1, kind: backend }
  - { id: parse, label: 语法分析, sub: "拼成语法树 · 语法错在这报 ERROR 1064", row: 2, kind: backend }
  - { id: sem, label: 语义分析 + 预处理器, sub: "表列是否存在（1146）· 把 * 展开成全部列", row: 3, kind: backend }
  - { id: tree, label: 合法的语法树, sub: "下一站：优化器的输入 · 此刻一行数据都还没碰", row: 4, kind: database }
edges:
  - { from: text, to: lex, label: 字符流 }
  - { from: lex, to: parse, label: "token 流" }
  - { from: parse, to: sem, label: "语法树" }
  - { from: sem, to: tree, label: "展开后的查询" }
```

展开 `*` 必须在这里做：它要查数据字典里的表定义，不展开的话优化器根本不知道要算多少列。这套流水线就是编译器前端——Babel 和 TypeScript 也是 tokenize、parse 成 AST、语义检查，MySQL 的解析器不过是给 SQL 这门语言写了个前端。三段分开的好处也和编译器一样：报错能定位到阶段。!!到这里为止 MySQL 只是「读懂了」SQL，所有 IO 都在后面。!!

### 优化器：同一条 SQL 有很多种干法

为什么需要优化器？因为同一条 SQL 有多种等价执行路径，代价能差几个数量级。多表 join 时先连哪张表？三张表 6 种顺序，四张表 24 种，十张表 362 万种，人脑不可能在几十毫秒内算清。这些选择交给优化器，它分两层工作：

```compare
first: 层次
head: [它做什么, 例子]
rows:
  - 逻辑优化（与数据无关的规则改写）: [只改「问题本身」，不碰数据, "子查询转 join、OR 转 UNION、消除冗余排序"]
  - 物理优化（基于成本模型 CBO）: [估算每条候选路径的 IO 和 CPU 代价，选最低者, "选索引、选 join 顺序、选 join 算法"]
```

join 算法本身就是成本模型的缩影。拿「全校名单 10000 人 × 今天违纪名单 10 人」查违纪学生详情来说：

```compare
first: 路径
head: [谁驱动谁, 开销]
rows:
  - 大表驱动小表: ["外层循环走 10000 次，每次去小表里查一遍「张三违纪了吗」", { text: 巨大, tone: red }]
  - 小表驱动大表（NLJ）: ["外层循环只走 10 次，拿 10 个违纪学号去大表里查详情", { text: 降了三个数量级, tone: green }]
  - Hash Join（8.0 引入）: ["先在内存给一张表建哈希，另一张表逐行 O(1) 探测", "适合无索引的等值连接，要付建表内存"]
```

成本模型估什么？主要是 IO 次数和 CPU 时间，输入是统计信息：行数、索引基数、数据分布。所以优化器的决策质量取决于统计信息新不新鲜，「最优」是==基于统计信息估计的最优==，不是数学上的全局最优。统计信息过旧时估算失真，选出的计划可能比全表扫还慢；大变更后 `ANALYZE TABLE` 刷新统计信息是 DBA 的日常兜底。8.0 还引入了直方图：基数只能回答「这列有几个不同值」，直方图能回答「值是怎么分布的」——两个字段各有 100 万个不同值，一个均匀分布、一个 99% 挤在同一个值，基数看不出差别，直方图看得出，很多选错索引的冤案根源就在这里。

用 EXPLAIN 看它选的计划：

```sql
EXPLAIN SELECT * FROM tb_student
WHERE name = '张三' AND age = '18'\G
--           id: 1
--   select_type: SIMPLE
--         table: tb_student
--          type: ref              ← 访问方式：const > eq_ref > ref > range > ALL，越靠后越糟
--           key: idx_name_age     ← 选了哪个索引
--          rows: 1               ← 估算扫描行数，不是真实行数
--         Extra: Using where     ← 出现 Using filesort / Using temporary 是危险信号
```

!!EXPLAIN 的输出是「计划」不是「事实」：它是优化器拍板的方案，不是执行后的结果。!!

### 执行器：拿着计划逐行要数据

执行器开工的第一步是权限校验（没权限直接 `ERROR 1142`），然后进入循环：按计划调用引擎接口取一行、过滤、做 join / 排序 / 聚合、把行发回客户端，再取下一行：

```js
function execute(plan) {
  checkPrivilege(plan.table);
  // 为什么执行前再校验一次：计划可能来自缓存或改写，权限以「执行时刻」为准

  const engine = getEngine(plan.table);
  // 同一实例里不同表可能是不同引擎，接口是统一的（Handler API）

  let row;
  while ((row = engine.readRow(plan.index, plan.condition))) {
    // 逐行拉取而不是一次全取：结果集可能上百万行，流式处理才不爆内存
    if (plan.needJoin) row = engine.readJoinedRow(row, plan.join);
    emit(row); // 边算边返回，客户端不必等全部算完
  }
}
```

接口全是「行」粒度的：全表扫走 `rnd_next`（给我下一行），按索引走 `index_read`（按键定位再顺序取）。Server 层从来看不见页、看不见 B+ 树，这正是存储引擎说换就换的原因。排序和聚合是流式的例外——它们天然要攒齐数据才能出结果，EXPLAIN 里的 `Using temporary` 就是这种「不得不攒」的信号。

## 04 · 引擎层：可插拔契约下的数据落地

### 选引擎：对着需求勾能力

`SHOW ENGINES` 列出当前实例可用的引擎。混用是允许的：一张表一个引擎，日志表用 Archive 压缩归档、热点表用 InnoDB、临时算数用 Memory，同一实例并存。关键差异就几行：

```compare
first: 特性
head: [MyISAM, InnoDB]
rows:
  - 事务: [{ text: 无, tone: red }, { text: 有, tone: green }]
  - 锁粒度: ["表锁：两个事务写不同行也要排队", "行锁：不同行的写互不阻塞"]
  - MVCC（读不阻塞写）: [{ text: 无, tone: red }, { text: 有, tone: green }]
  - 外键: [{ text: 无, tone: red }, "有：插入查主表、删除防孤儿；代价是跨表检查与锁争用，高并发场景常写进业务代码"]
  - 崩溃恢复: [{ text: "无：宕机后靠 CHECK TABLE 事后修补", tone: red }, { text: 有（redo log 重放）, tone: green }]
  - 聚簇索引: ["无：索引叶子存行地址，要跳一次", "有：主键 B+ 树叶子就是整行"]
  - 磁盘形态: [".frm + .MYD + .MYI 三个文件", "一个 .ibd 表空间（5.6 起每表一个文件）"]
```

锁粒度的差别用两个时间轴看最直观。同样是两个事务写同一张表的不同行：

```journey
- tag: MyISAM · 表级锁
  tone: amber
  name: 写不同行也要排队
  fields:
    - { k: "T1", v: "UPDATE t SET a=1 WHERE id=1 → 拿到表锁" }
    - { k: "T2", v: "UPDATE t SET a=2 WHERE id=2 → 等待 T1 结束", tone: warn }
  note: 两个写事务串行执行。OLTP 的高并发写直接堵死。

- tag: InnoDB · 行级锁
  tone: green
  name: 写不同行并行
  fields:
    - { k: "T1", v: "锁行 1，直接执行", tone: ok }
    - { k: "T2", v: "锁行 2，直接执行", tone: ok }
  note: 互不阻塞，并发吞吐随行数扩展。且行锁不升级成表锁，配合 MVCC 的读不阻塞写，高并发读写混合负载才成立。
```

InnoDB 赢的不是「更快」，而是==在并发写和崩溃面前不丢不堵==，这两点在 OLTP 里是刚需。它从 5.5 起成为默认引擎，官方建议除特殊用例外一律 InnoDB。MyISAM 的剩余价值只在只读、读多的小表场景（表锁不伤并发读）。

### 聚簇索引与回表

InnoDB 的表按主键组织成一棵聚簇索引。两个类比把它说透：**聚簇索引像字典正文**，按拼音 a-z 排列，翻到「张」那一页，拼音、笔画、所有解释直接印在上面，不用翻第二次；**二级索引像部首查字法**，按「弓」字旁查到「张」，目录里只有一句「请翻到正文第 560 页」——拿着这个页码再翻一次字典的过程，在数据库里叫==回表==。

所以二级索引的叶子存的是主键值，查完还要回聚簇索引取整行；主键查询一步到位。一张表只能有一个聚簇索引，因为物理数据在磁盘上只能按一种顺序排。

### 事务与 MVCC：读不阻塞写

事务能力是引擎自带的，Server 层不保证，`SHOW ENGINES` 里 MyISAM 那行 `Transactions: NO` 就是这句话的实物。InnoDB 靠 undo log 和 MVCC 把「并发读写」变成互不阻塞：

- 每次修改前，先把旧值记进 undo log。行上的隐藏列 `trx_id` 标记是哪个事务改的，`roll_pointer` 指向 undo 里的上一版——**一行数据因此是一条版本链**，undo 就是链上每个旧版本的存档，git log 就是这条链的浏览命令。
- 回滚时沿版本链回溯到修改前。
- 一致性读（MVCC）也靠它：写事务改新版本，读事务按自己启动时间的快照（ReadView）去读旧版本，==读不加锁，读写互不冲突==。就像飞书文档的历史版本：一个人写新草稿，不妨碍另一个人看刚发布的上一版。

### Buffer Pool 与 LRU：内存里怎么放页

Buffer Pool 是 InnoDB 的内存缓存，装 16KB 的数据页和索引页。读先查池，命中免磁盘 IO；写改内存页，页变脏，后台线程异步刷盘。它就是 CPU 多级缓存的数据库版：命中省掉一次昂贵的下层访问，代价是两层间的数据一致性要自己维护，脏页没刷盘前内存和磁盘不一致，兜底的是 WAL（下一小节）。

池内页用「带中点插入」的 LRU 管理。朴素的 LRU 有个致命缺陷：一次全表扫描（比如备份，或一句没索引的 `SELECT *`）会把几百万条只用一次的页读进内存、排到最前面，==真正被反复访问的热点页全被踢出去==，这叫缓冲池污染。扫完之后正常业务来查热点，发现内存全空，只能疯狂读盘。InnoDB 的解法是把链表劈成两段：

```flow
grid: false
legend: false
nodes:
  - { id: new, label: 从磁盘新读入的页, sub: "先放 Old 区头部（新手考察区，默认占 37%）", row: 0, kind: backend }
  - { id: scan, label: 全表扫描的数据, sub: "只在 1 秒内被读一次 · 在 Old 区慢慢往后挪", row: 1, kind: amber }
  - { id: evict, label: 从链表尾部直接淘汰, sub: "Young 区的核心热点毫发无损", row: 2, kind: security }
  - { id: hot, label: 驻留超过 1 秒且再次被访问, sub: "真·热点数据", row: 1, kind: hot }
  - { id: young, label: 晋升 Young 区头部（热区，默认 63%）, sub: "成为常驻热点", row: 2, kind: database }
edges:
  - { from: new, to: scan, label: "只被读一次" }
  - { from: scan, to: evict, label: "从尾部丢弃" }
  - { from: new, to: hot, label: "隔了 1 秒又被访问", tone: green }
  - { from: hot, to: young, label: "升入热区", tone: green }
```

两个参数守住这道闸：`innodb_old_blocks_pct`（Old 区占比，默认 37，就算全表扫描，新数据最多污染这 37%，Young 区 63% 的热点绝对安全）和 `innodb_old_blocks_time`（晋升门槛，默认 1000ms，全表扫描读一页只要几毫秒，根本拿不到升区资格，只有隔了 1 秒还被反复查的「真热点」才配进 Young 区）。

Buffer Pool 该设多大？生产经验是物理内存的 70~80%。为什么不全给？剩下的 20~30% 要留给：OS 内核自己呼吸的开销、每条连接的私有内存（排序的 `sort_buffer`、join 的 `join_buffer`，这部分不在 Buffer Pool 里）、写 redo 和 binlog 时先经过的 OS Page Cache，以及防 OOM 的安全垫——一旦突发高并发把内存顶到 101%，Linux 的 OOM Killer 会直接杀掉 MySQL 进程。

### WAL 与 doublewrite：先写日志，再改数据

WAL（write-ahead logging，预写日志）的思想：每条修改先追加一条 redo 记录（顺序写，快），然后才改内存页；脏页可以拖几秒再刷。崩溃了？重放 redo 找回没来得及刷盘的数据。它成立的物理原因是==顺序追加写远快于随机写==：redo 往固定文件尾部连续追加，磁头不需要来回寻道；数据页散布在表空间各处，随机写要一次次寻址。「先写日志」是把昂贵的随机写换成廉价的顺序写，把真正的随机写推迟到后台慢慢做。

但刷脏页本身还有一道坑：MySQL 的页是 16KB，操作系统和磁盘按 4KB 块写，刷一个页要分 4 次。断电落在中间，磁盘上的页就一半新一半旧，这叫 torn page（撕裂页 / Partial Page Write）。此时页的物理结构已经损坏，==redo 也救不了它==：redo 记录的是「在某个原本正常的页上做了什么修改」，底子本身烂掉了，重放没有意义。

doublewrite 的解法是在真正写表文件之前先留底稿：刷脏页时先把页**连续地**刷进磁盘上的 doublewrite 区（顺序写，磁头不跳，极快，像装集装箱而不是送外卖），再**离散地**写回各自 `.ibd` 的真正位置。第一步成功后完整副本就留下了：真在第二步写坏，重启时发现某页校验和对不上，就跑到 doublewrite 区把那个完整的 16KB 页拿回来覆盖，再应用 redo，数据复原。

同一个 16KB 页在刷盘路上会经历四种形态，断电点决定它停在哪一种：

```journey
- tag: ① 内存里
  tone: blue
  name: 一个 16KB 的完整脏页
  badge: 校验和正常
  fields:
    - { k: 内容, v: "整页完整 · age 已改成 19", tone: ok }
    - { k: 位置, v: "还在 Buffer Pool，磁盘上还是旧值" }
  note: 接下来要分 4 次 4KB 写出去，中间任何一刻断电都可能只落一半。

- tag: ② 先留底稿
  tone: violet
  name: doublewrite 区的完整副本
  badge: 连续写
  badgeTone: ok
  fields:
    - { k: 写法, v: "整页连续写入 · 磁头不跳", tone: ok }
    - { k: 意义, v: "完整副本已经躺在磁盘上" }
  note: 这一步之后，才敢往真正的表文件位置写。

- tag: ③ 写 .ibd 时断电
  tone: red
  name: 撕裂页 torn page
  badge: 一半新一半旧
  badgeTone: red
  fields:
    - { k: 前 4KB, v: "新内容已写入", tone: warn }
    - { k: 后 12KB, v: "还是旧内容", tone: warn }
  note: 校验和对不上，这页物理报废。redo 救不了它，因为它只会「在正常的页上做修改」，底子烂了就没法重放。

- tag: ④ 重启修复
  tone: green
  name: 底稿覆盖 + 重放 redo
  fields:
    - { k: 动作, v: "从 doublewrite 区取回完整 16KB 页覆盖该页", tone: ok }
    - { k: 之后, v: "再应用 redo，数据复原", tone: ok }
  note: 用一次顺序写，换任何断电点都不留下半页。
```

## 05 · 读一遍：一条 SELECT 的完整旅程

拿一条带 where 的查询，把前几节的组件串成一条链。第一张图下方的导览「一条 SELECT 的一生」，就是这条链的逐步点亮版：

1. **连接器**：认证通过，读权限快照，分配线程。
2. **查询缓存**（8.0 之前）：SQL 文本完全相同才命中；8.0 起这一站不存在。
3. **解析器**：词法、语法、语义，产出语法树。
4. **预处理器**：确认表列存在，展开 `*`。
5. **优化器**：至少两个候选方案，先查 `name='张三'` 再过滤 age，还是反过来。按统计信息估算代价，选它认为最省的。
6. **执行器**：权限校验（无权直接 ERROR 1142），按计划调引擎接口。
7. **Buffer Pool**：命中，直接返回内存页。
8. **磁盘**（未命中时）：按索引树把 16KB 页读进池，再返回。
9. **结果集沿原路返回**客户端，流式发送。

这条链每一步的产出就是下一步的输入，没有一步可以跳过。两个分支能从半路折返：缓存命中（历史版本）从第 2 步直接返回，权限不足在第 6 步报错。

回到开篇的问题：为什么同一句 SQL 时快时慢？变量不在 SQL 文本，而在三个地方：**执行计划的稳定性**（统计信息旧了，优化器会换一条更差的路径）、**Buffer Pool 的命中率**（第一次查要读盘，之后命中内存；命中率跌破 99% 说明工作集大于内存）、**连接与锁的排队**（processlist 里大量 Query 或 Locked 就是现场）。能对着地图指出它卡在哪一层，排查就有了方向。

顺带纠正一个常见说法：「MySQL 是单线程处理 SQL 的」不对。单线程的只是某个组件内部；整条链上连接、解析、优化、执行、引擎由不同模块协作，事务提交还涉及后台刷盘线程。说 MySQL 单线程，是把某一段误当成了整条链。

## 06 · 写一遍：UPDATE 与两阶段提交

### 为什么会有两套日志

更新语句不走查询缓存（它只服务查询类语句），但要多维护三种日志。三份日志的分工是历史演进的产物：

```timeline
- when: 早期
  title: MyISAM 时代，只有 binlog
  desc: binlog 是 Server 层通用日志，只能归档和复制。MyISAM 没有 crash-safe，崩溃丢数据只能认栽。
  tone: muted
- when: InnoDB 到来
  title: 引擎层自备 redo log
  desc: InnoDB 按数据库传统理论（WAL）在引擎层实现了自己的重做日志，补上崩溃恢复。binlog 留在 Server 层管复制。
  tone: blue
- when: 并存至今
  title: 两套日志 + undo 组成三件套
  desc: 跨引擎能力不统一的账单：Server 层不能假设每个引擎都有崩溃恢复，于是 binlog 与 redo 各管一摊。
  tone: violet
```

```compare
first: 维度
head: [binlog（Server 层）, redo log（InnoDB 层）, undo log（InnoDB 层）]
rows:
  - 记什么: ["哪个表哪行改成了什么（逻辑）", "第 N 页偏移 M 处写入了什么（物理）", "改之前的旧值（逻辑）"]
  - 写法: [追加写，写满开新文件, 固定大小循环写，写满回卷, 随修改产生，随事务提交可清理]
  - 给谁用: [从库复制、备份、时间点恢复, 崩溃恢复重放, 回滚、MVCC 旧版本重建]
```

binlog 回答「发生了什么」，redo 回答「落在磁盘哪里」，undo 回答「之前是什么」。三份拼起来，一次更新才可回滚、可恢复、可复制。

### 一条 UPDATE 的七步

```sql
update tb_student set age = '19' where name = '张三';
```

```seq
grid: true
participants:
  - { id: c, label: 客户端, sub: 连接里的 SQL, kind: frontend }
  - { id: e, label: 执行器, sub: Server 层, kind: backend }
  - { id: i, label: InnoDB, sub: 引擎层, kind: database }
  - { id: lg, label: 日志, sub: "redo / binlog", kind: messagebus }
messages:
  - { from: c, to: e, label: "UPDATE ...", kind: sync, note: 1 }
  - { from: e, to: i, label: "定位行（Buffer Pool 命中 / 读盘）+ 加行锁", kind: sync, note: 2 }
  - { from: i, to: lg, label: "写 undo log 备份旧值", kind: sync, note: 3 }
  - { from: i, to: i, label: "改内存页 → 脏页", kind: self, note: 4 }
  - { from: i, to: lg, label: "写 redo，标 prepare（未提交）", kind: sync, note: 5 }
  - { from: e, to: lg, label: "写 binlog 并 fsync 落盘", kind: sync, note: 6 }
  - { from: e, to: i, label: "redo 标 commit", kind: sync, note: 7 }
  - { from: c, to: c, label: "返回「更新完成」· 脏页稍后异步刷盘", kind: reply }
```

定位行之前与读链完全一致，之后每多一步都在防一件事：undo 防「改错要还」，redo 防「改了没落盘」，binlog 防「改了没法复制」。第 5~7 步里 redo 的状态变化是关键——它把一次提交拆成了两阶段，横跨引擎层与 Server 层。两个刷盘参数是这套时序在配置上的投影：`sync_binlog=1`（每笔事务 fsync binlog）加 `innodb_flush_log_at_trx_commit=1`（提交时 redo 必须刷盘），「双 1」是最稳组合，任何调低都是在和崩溃对账做交易。高并发下 MySQL 还会把多个事务的 binlog 合并成一次刷盘（组提交，group commit），把「每事务一次 fsync」摊薄成「一批一次」。

### 顺序不能乱：反证法

为什么必须「redo prepare → binlog 落盘 → redo commit」这个顺序？把两个简单方案放进「任何一步之后都可能断电」的检验里，看它们怎么死：

```compare
first: 方案
head: [崩溃窗口, 后果]
rows:
  - "A：先写 redo 直接提交，再写 binlog":
      - "redo 已提交、binlog 未写之间断电"
      - { text: "主库重启靠 redo 恢复了这行，binlog 里没有，备份和从库永远缺这一条（主有备无）", tone: red }
  - "B：先写 binlog，再写 redo":
      - "binlog 已写、redo 未写之间断电"
      - { text: "本机没有 redo，重启恢复不出这行；从库却按 binlog 执行了，主从不一致（主无备有）", tone: red }
  - "两阶段提交":
      - "任何点断电"
      - { text: "崩溃从「窗口」变成「可对账的状态」：prepare 时拿 XID 查 binlog 判生死", tone: green }
```

这个设计和分布式事务的 2PC 同构：prepare / commit 两个阶段，只是这里没有网络：两个「参与者」是 InnoDB 的 redo 与 Server 层的 binlog，协调者是执行器。MySQL 自 5.0.3 支持 XA，内部事务提交复用的正是这套两阶段协议。!!它不是「两把锁」，而是「一个事务、两处日志、两次状态标记」。!!

### 断电之后：对账

两阶段提交写下了状态，崩溃后重启时 InnoDB 靠这些状态对账：

```flow
grid: false
legend: false
nodes:
  - { id: scan, label: 重启：扫描 redo log, sub: "从 checkpoint 之后开始重放", row: 0, kind: backend }
  - { id: commit, label: redo 状态是 commit？, sub: "binlog 必然已落盘（commit 在其后才标）", row: 1, kind: backend }
  - { id: keep, label: 直接提交, sub: "已提交的不丢", row: 2, kind: database }
  - { id: prep, label: redo 状态是 prepare, sub: "拿着事务的 XID 去 binlog 里查", row: 2, kind: amber }
  - { id: found, label: binlog 有完整记录, sub: "末尾有 XID 事件作句号", row: 3, kind: database }
  - { id: lost, label: binlog 没有它, sub: "步骤 1~2 之间断的", row: 3, kind: security }
  - { id: c2, label: 提交该事务, sub: "从库可能已同步，主库必须承认", row: 4, kind: database }
  - { id: r2, label: 回滚该事务, sub: "从库不知道这笔交易，主库当它没发生过", row: 4, kind: security }
edges:
  - { from: scan, to: commit, label: 逐条检查 }
  - { from: commit, to: keep, label: 是, tone: green }
  - { from: commit, to: prep, label: 否, tone: amber }
  - { from: prep, to: found, label: "XID 命中", tone: green }
  - { from: prep, to: lost, label: "没有", tone: red }
  - { from: found, to: c2, tone: green }
  - { from: lost, to: r2, tone: red }
```

XID 是对账的键：redo 的 prepare 记录和 binlog 的事件带着同一个事务 ID，两边以它为准互相验证。这样任何崩溃点都收敛到一致结论：已提交的不丢，未完成的成不了幽灵数据。

恢复速度靠 checkpoint 兜底。redo 按 LSN（日志序号）连续排列，checkpoint 记录「到这里为止的脏页都已刷盘」的进度条：重启只重放 checkpoint 之后那一小段日志，不用从五年前重放。checkpoint 划得越近，恢复越快，但刷盘压力越大——调优里说的「checkpoint 频率」就是在恢复时长和刷盘压力之间找平衡。

把 06 节四小块串起来：认识三份日志的分工 → 看一次更新怎么串起它们 → 证明顺序不能乱 → 乱序（崩溃）之后怎么找回秩序。合起来回答一个问题：==一台随时可能断电的机器，凭什么敢说「提交过就丢不了」。==

## 07 · 回顾：把一条 SQL 拼回去

读链和写链在「执行器 → 引擎」之前完全相同，之后分道扬镳：

```compare
first: 链路
head: [路径, 深度]
rows:
  - 读链: ["连接器 → 解析 → 预处理 → 优化 → 执行 → 引擎读页 → 原路返回", "9 站，单层内的直线"]
  - 写链: ["读链同样 9 站 + undo → 脏页 → redo prepare → binlog → redo commit → 刷盘", { text: "多 5 站，跨层折线上下横跳两次", tone: amber }]
```

多出来的每一站都是保险，而保险全在跨层：引擎层 redo prepare 到 Server 层 binlog，再回引擎层 redo commit。分层架构里跨层协作总比层内协作贵，这解释了为什么写优化（组提交、刷盘参数、半同步）永远比读优化复杂。

最后把全篇的骨架压成一句能背的话：**四层**（连接 / Server / 引擎 / 文件）、**两大块**（Server 层 + 引擎层）、**一条契约**（Handler API）、**两套日志**（binlog / redo）加 undo、**一个协议**（两阶段提交）。读是单层直线，写是跨层折线——「写比读重」的全部含义就在路径的长度差里。

架构本身十年没大变，但这些版本点最容易让读过旧资料的人踩坑：

```checklist
items:
  - 查询缓存 5.6 默认关闭、5.7.20 弃用、8.0 移除，「MySQL 会缓存查询结果」是旧知识
  - 默认引擎 5.5 起是 InnoDB，8.x 建议除特殊用例一律 InnoDB
  - 8.0 起默认认证插件是 caching_sha2_password，老驱动报 cannot be loaded 的根因是驱动太旧
  - 线程池是企业版插件，别拿企业版特性要求社区版
  - 官方 8.0 / 8.4 / 9.x 手册并存，看文档先确认对着哪个版本（8.4 是 LTS）
```

想再往下挖三个方向：EXPLAIN 的 type / rows 与统计信息（analyze）的关系、InnoDB 行锁与 MVCC 的实现细节、redo 与 binlog 的组提交及半同步复制。

```quiz
- q: 权限快照的坑：REVOKE 之后那条连接还能操作，怎么让它立刻生效？
  a: |
    权限在建连时做成快照存进连接上下文，之后所有权限判断都用这份副本，REVOKE 只改了权限表。
    让它生效只有两条路：KILL 掉该用户的活跃连接强制重连，或等连接自然断开。
    没有第三条路，快照不会自己过期。
- q: "加了线程池，连接数 : 核心是不是变成 m:1？怎么回答才准？"
  a: |
    拆成两级：连接 : Worker 是 M:N（4096 条连接只占队列槽位，Worker 每组 2~4 个、全实例几十个）；
    Worker : CPU 核接近 1:1（线程数对齐核数，cache 不被切换冲刷）。
    让一个 Receiver 盯住几千条连接的底层能力是 epoll：连接没数据就休眠，有数据内核才唤醒。
- q: 崩溃重启后，扫到一条 redo 状态是 prepare 的事务，InnoDB 怎么决定提交还是回滚？
  a: |
    拿这条事务的 XID 去 binlog 里查。binlog 有完整记录（末尾有 XID 事件作句号）→ 提交：
    从库可能已经同步了它，主库必须承认。没有 → 回滚：从库不知道这笔交易，主库当它没发生过。
    这就是两阶段提交把「崩溃窗口」变成「可对账状态」的含义。
```
