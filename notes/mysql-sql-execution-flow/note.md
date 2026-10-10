线上告警：一条 `select * from user where id=1` 平时 5ms，某天突然 3 秒。慢查询日志里，同一句 SQL 有时走索引、有时全表扫描。要解释这个，得知道这条 SQL 从客户端发出之后，在 MySQL 内部究竟经过谁的手。

本页跟着这条 select 走完全程，再看 update 多出来的剧情。主干是一张带入口和导览的整体图（02 节），后面每一章是图上一个站点的放大。

## 01 · 先搞清几个词

后面反复出现的东西先摆在这里，每个都能用一句话说出来。

```cards
cols: 4
items:
  - { title: Server 层, desc: 管连接、解析 SQL、优化、内置函数。处理的是「语义与决策」，不碰数据页, tone: blue }
  - { title: 存储引擎层, desc: 管数据怎么存怎么取。InnoDB 是 5.5 起的默认引擎，以插件形式可替换, tone: violet }
  - { title: handler 接口, desc: 两层之间的契约。执行器只会喊「给我下一行」，引擎懂存储不懂 SQL, tone: green }
  - { title: 解析树, desc: 分析器的产物，SQL 字符串按文法组装成的树, tone: blue }
  - { title: 执行计划, desc: 优化器的产物。用哪个索引、join 谁驱动，EXPLAIN 看到的就是它, tone: violet }
  - { title: WAL, desc: Write-Ahead Logging，先顺序写日志再慢慢刷数据页，随机写变顺序写, tone: green }
  - { title: 脏页, desc: Buffer Pool 里改过、还没刷回磁盘的数据页，每页 16KB, tone: amber }
  - { title: 两阶段提交, desc: redo 先 prepare，binlog 写完再 commit，让两份日志同生共死, tone: amber }
```

## 02 · 整体图：一条 SQL 穿过哪些关卡

一张图装下全部主线：实线是 select 的读路径，①②③ 是 update 多出来的剧情，紫色虚线是查询缓存的命中短路。Server 层五道关卡各管一段，跨过 handler 接口才碰到数据和存储。

```arch
svg: mysql-journey
caption: ==从客户端到磁盘，一条 SQL 的旅程。==点图上任意一个框，只看它和它的邻居；下方「我熟悉」从你已经认识的东西进去；四条导览各讲一个问题。
parts:
  client:
    label: 客户端
    sub: 发出 SQL
    detail: 一条 `select * from user where id=1` 从这里发出，走 TCP（或 Unix socket）进 MySQL。==结果集最后也沿这条连接原路返回。==
  conn:
    label: ① 连接器
    sub: 认证 · 权限快照 · 一连接一线程
    detail: TCP 三次握手只负责把水管接上，连接器管==你是谁==：校验用户名密码（8.0 起默认 `caching_sha2_password`），然后读权限表、把权限固化进这条连接（§03 讲哪几档要重连才生效）。它是一连接一线程模型，「连接很贵」的第一层原因在这里。
  qcache:
    label: ② 查询缓存
    sub: key 是 SQL 全文 · 8.0 已移除
    detail: 按==逐字节==匹配 SQL 文本，命中直接返回结果集、短路后面所有站。大小写、多一个空格、换个参数值都算 miss。==8.0 里它已经被整体删除==，画出来是为了对齐老资料，§04 讲它怎么死的。
  parser:
    label: ③ 分析器
    sub: 词法/语法 → 解析树 · ERROR 1064
    detail: 把字符串切成 token、按 SQL 文法组装成解析树。==著名的 `ERROR 1064` 在这一站抛出==，语句根本没进引擎，是「翻译」阶段就被拦下了。收尾还要确认表和列真实存在、把 `select *` 展开成全部列。
  optimizer:
    label: ④ 优化器
    sub: 代价估算 · 选执行计划
    detail: 同一条 SQL 往往有多条等价路径：==用哪个索引、join 谁做驱动表==。优化器按统计信息估算每条路径的代价、挑最便宜的，==`EXPLAIN` 看到的就是它的决定==。统计信息过期，它就会自信地选错。
  executor:
    label: ⑤ 执行器
    sub: precheck 权限 · 迭代器逐行取数
    detail: 先做 ==precheck==（表、列级权限的第二次校验，连接时还查不到「这张表的这些列」），然后按计划调引擎接口==一行一行==取数、做 where 过滤、组装结果集。循环转多少圈，就是这条 SQL 的代价。
  handler:
    label: handler 接口
    sub: 两层的契约
    detail: 引擎以插件形式实现这套接口。执行器懂 SQL 不懂存储，引擎懂存储不懂 SQL，==两者只靠「给我下一行」这一个动词对话==。InnoDB 能从 5.5 起当默认引擎而 Server 层一行不改，靠的就是它。
  binlog:
    label: binlog
    sub: Server 层逻辑日志 · 追加写
    detail: 记录「哪条语句或哪行数据怎么变」，所有引擎共用。用途是==主从复制和数据恢复==：从库重放 binlog 得到和主库一样的数据。
  bp:
    label: ⑥ Buffer Pool
    sub: 16KB 数据页 · 命中内存/读盘
    detail: InnoDB 把数据页（每页 ==16KB==）缓在内存里：命中直接返回，未命中才读磁盘。update 改的是内存页，改完的页叫==脏页==，由后台线程择机刷回磁盘。
  redo:
    label: redo log
    sub: InnoDB 物理日志 · 循环写
    detail: InnoDB 特有。把「哪个页做了什么修改」==顺序追加==进日志（WAL），随机写变顺序写；崩溃后重放它找回没刷盘的数据，这就是 ==crash-safe==。文件固定大小、写满回头覆盖，能覆盖的前提是被覆盖位置的脏页已刷盘（checkpoint）。
  disk:
    label: 磁盘 .ibd
    sub: 数据真正躺的地方
    detail: 脏页迟早刷回这里。整条链路上大量的设计（WAL、Buffer Pool）都是为了==少碰它==。
  replica:
    label: 从库
    sub: 另一台机器
    detail: 拉取主库的 binlog 重放。==binlog 写完整的事务从库一定有；没写完整的主库自己会回滚==，主从就这样对齐（§07 的恢复规则）。
anchors:
  - { part: conn, label: "HTTP 请求链（网关与鉴权）" }
  - { part: parser, label: "编译器前端" }
  - { part: qcache, label: "一个被删掉的缓存" }
  - { part: binlog, label: "update 的两份日志" }
  - { part: optimizer, label: "时快时慢的变量" }
tours:
  - id: select
    label: "select 的旅程"
    steps:
      - { at: [client, conn], text: "客户端发出 SQL，经 TCP 进入 MySQL。==TCP 三次握手只是把水管接上==，之后全是连接器的事。" }
      - { at: [conn], text: "==认证==（8.0 起默认 `caching_sha2_password`），然后把权限表读一遍、==固化成连接里的权限快照==，此后这条连接的权限判断不再查权限表。" }
      - { at: [qcache], text: "==查询缓存==按 SQL 全文逐字节找结果集，命中就地返回。今天画它是为了对齐老资料，==8.0 已整体移除==。" }
      - { at: [parser], text: "==分析器==把字符串切成 token、组装成解析树。SQL 拼错在这里就报 `ERROR 1064`，==根本没碰到数据==。" }
      - { at: [optimizer], text: "==优化器==从等价方案里挑最便宜的：用哪个索引、join 谁驱动。它按==统计信息==估算代价，`EXPLAIN` 看到的就是它的决定。" }
      - { at: [executor], text: "==执行器==先补一次表/列级权限校验（precheck），再按计划==一行一行==向引擎要数据、做 where 过滤。" }
      - { at: [handler, bp], text: "对话走 ==handler 接口==：引擎从 ==Buffer Pool== 的 16KB 数据页里找行，命中内存、未命中才读磁盘。" }
      - { at: [disk], text: "数据最终躺在磁盘的 `.ibd` 文件里。==前面所有站都在想办法少碰它==，这也是 WAL 和 Buffer Pool 的动机。" }
  - id: update
    label: "update 多出来的剧情"
    steps:
      - { at: [executor, bp], text: "update 走完同样的前五站，在执行器把 Buffer Pool 里的页==改成脏页==。" }
      - { at: [redo], text: "InnoDB 先把修改==顺序追加进 redo log、标记 prepare==：随机写变顺序写，崩溃后靠它重放找回数据。" }
      - { at: [binlog], text: "Server 层再把逻辑变更==追加写入 binlog==。这一步是 redo 从 prepare 走到 commit 的==前提==。" }
      - { at: [redo, binlog], text: "binlog 写完，redo 才标记 ==commit==。两份日志的「生效」被绑成一个原子动作，==两阶段提交==，§07 展开三个崩溃点。" }
      - { at: [replica], text: "从库拉取 binlog 重放。==binlog 写完整的事务从库一定有；没写完整的主库自己会回滚==。" }
  - id: slow
    label: "一条 SQL 为什么时快时慢"
    steps:
      - { at: [conn], text: "先排除连接层：连接数打满会被直接拒绝；空闲超过 `wait_timeout`（默认 8 小时）被掐掉；==全局权限改了要重连才生效==。" }
      - { at: [optimizer], text: "==统计信息过期==时，优化器会自信地选错索引，毫秒变分钟。`EXPLAIN` 的 type / rows / key 是第一眼。" }
      - { at: [executor], text: "执行器的循环圈数==就是这条 SQL 的代价==：索引退化、区分度崩了，圈数暴涨。" }
      - { at: [bp, disk], text: "Buffer Pool 装不下热数据时，==每次读都要碰磁盘==，内存不够是慢的另一种形态。" }
      - { at: [qcache], text: "别再指望查询缓存兜底，==8.0 里它已经不存在了==。慢查询请按前四步排查。" }
  - id: auth
    label: "权限在哪两道闸被拦"
    steps:
      - { at: [conn], text: "第一道在==连接器==：认证，并把权限固化进连接。它管「你能不能连」，粒度粗。" }
      - { at: [executor], text: "第二道在==执行器开工前==（precheck）：分析器解析出表名、列名之后，才查得了「这张表的这些列你碰不碰」。" }
      - { at: [qcache], text: "边角：查询缓存命中会==跳过分析器==，没解析出表名列名，所以命中路径在返回结果前要==单独做一次权限校验==。" }
```

这条结构和 HTTP 请求的处理链同构。你脑子里已经有那条链，把新名字套到旧位置上就行。

```compare
first: 位置
head: [HTTP 请求链, MySQL 链]
rows:
  - 鉴权放行: ["网关", "连接器：认证 + 权限快照"]
  - 前置拦截: ["CDN / 页面缓存", "查询缓存（8.0 已删）"]
  - 理解并改写请求: ["路由 + 中间件链", "分析器 + 优化器"]
  - 干活: ["handler", "执行器"]
  - 碰数据: ["DAO / ORM", "存储引擎（InnoDB）"]
```

唯一的差别：HTTP 链的每一层都是你自己写的代码，MySQL 这条链是数据库替你搭好的，一层都改不了，只能理解它。

再看那条 Server 层与引擎层的边界线。前四站流通的「货币」是同一样东西：SQL 文本及其衍生结构（解析树、执行计划），直到执行器才第一次碰到行数据。==线上是语义与决策，线下是数据与存储==。MySQL 为什么能换引擎、日志为什么分两层（binlog 在上、redo 在下），都从这条线来。

## 03 · 连接器：进门与权限快照

```seq
participants:
  - { id: c, label: 客户端, kind: frontend }
  - { id: conn, label: 连接器, kind: security }
  - { id: acl, label: 权限表, sub: mysql 系统库, kind: database }
messages:
  - { from: c, to: conn, label: TCP 三次握手, kind: sync, note: 1 }
  - { from: c, to: conn, label: 用户名 + 密码, kind: sync, note: 2 }
  - { from: conn, to: acl, label: 读出全部权限, kind: sync, note: 3 }
  - { from: conn, to: conn, label: 固化成连接内的权限快照, kind: self, note: 4 }
  - { from: conn, to: c, label: 认证通过，分配线程, kind: reply, note: 5 }
```

8.0 起默认认证插件是 `caching_sha2_password`（SHA-256，需要 SSL 或 RSA 密钥交换）。权限按库级、表级、列级三档存在 `mysql` 系统库的几张权限表里，建连时全部读出来合并进连接，之后每条 SQL 的权限判断都是==纯内存比对==：用一次查询，换无数次的免查询。

「固化」的后果要说准：==不同档位的权限，生效时点不一样==。

```compare
first: 管理员改了什么
head: [已建立的连接什么时候受影响]
rows:
  - 表 / 列级权限（REVOKE 一张表的 SELECT）: [{ text: 下一次请求就生效, tone: green }]
  - 库级权限: [下一次 `USE db_name` 生效]
  - 全局权限和密码: [{ text: 不受影响，重连才生效, tone: amber }]
```

!!「改了权限要重连才生效」只对全局权限和密码成立。!! 表、列级权限是每次请求对着内存里的权限缓存查的，REVOKE 之后下一次请求就生效（MySQL 8.4 手册 When Privilege Changes Take Effect）。线上回收某用户权限时先分清是哪一档；要立即断掉全局权限的用户，光改权限表不够，得把活跃连接 KILL 掉。

连接分长短两种，取舍在开销和内存之间。

```compare
first: 
head: [短连接, 长连接]
rows:
  - 建连开销: [{ text: 每条请求都付：TCP + 认证 + 线程分配, tone: red }, 只付一次]
  - 内存风险: [低，断开即释放, { text: 临时内存挂在连接上，越积越多, tone: amber }]
  - 适用: [低频访问, 高频常驻（连接池）]
```

长连接的坑很具体：执行过程中的临时内存，排序缓冲、临时表、结果集，都挂在连接对象上。一次用了 64MB 排序缓冲的查询结束后，这 64MB ==不还给操作系统==，等连接断开才一次性结清。长连接跑得越久涨得越多，MySQL 内存只涨不跌，直到被系统 OOM kill。「MySQL 内存越用越高」一半的答案在这里。

++两个解法：定期主动断开；5.7+ 用 `mysql_reset_connection` 重置连接，不重建连接但释放临时内存。++ 连接池配置里的 `maxLifetime` 就是「定期断开」的自动化。另有 `max_connections` 管连接数上限（打满拒绝新连接）、`wait_timeout` 管空闲超时（默认 28800 秒 = 8 小时）。

## 04 · 查询缓存：一个被删掉的功能

```flow
grid: true
nodes:
  - { id: sql, label: SQL 进来, row: 0, kind: external }
  - { id: qc, label: 查询缓存, sub: "key = SQL 全文逐字节", row: 1, kind: backend }
  - { id: hit, label: 直接返回结果集, sub: "返回前单独查一次权限", row: 2, kind: cloud, tone: green }
  - { id: chain, label: 走完整链路, sub: "分析器 → 优化器 → 执行器 → 引擎", row: 2, kind: backend }
edges:
  - { from: sql, to: qc }
  - { from: qc, to: hit, label: 命中, tone: green }
  - { from: qc, to: chain, label: 未命中 }
```

它在分析器之前，是整条链的第一道拦截。key 是 SQL 语句文本，逐字节严格匹配；value 是上次执行的完整结果集。「逐字节」苛刻到什么程度：

```compare
first: 客户端发来的 SQL
head: [和缓存里的 key 比]
rows:
  - "SELECT * FROM user WHERE id=1": [{ text: 一模一样，命中, tone: green }]
  - "select * from user where id=1": [{ text: 大小写不同，miss, tone: red }]
  - "SELECT * FROM user  WHERE id=1": [{ text: 多一个空格，miss, tone: red }]
  - "SELECT * FROM user WHERE id=2": [{ text: 换个参数值，miss, tone: red }]
```

为什么用整条文本做 key？查询缓存要的就是快，==连分析器都不想经过==，自然拿不到解析结果，只能用最原始、最便宜的东西当 key：字符串本身。代价是连「语义相同」都识别不了。

命中也不是无脑返回：缓存里存的是「别人的结果集」，返回前要校验当前用户有权读这些表。命中路径跳过了分析器、没解析出表名列名，所以这次校验只能放在返回前单独做（§06 的 precheck 是它的正规版本）。

死因是三条叠加的：

```checklist
tone: cross
items:
  - 失效粒度太粗：表上任意一次更新，这张表的全部缓存条目同时清空
  - key 匹配太苛：逐字节比对，连语义相同都识别不了
  - 维护成本照付：每次查询要算 hash、加锁访问缓存结构
```

写多读少的场景，缓存刚建好就被下一个 update 冲掉，命中率趋近零，hash 和加锁的成本却一笔不少付。清空本身也要加锁，高并发写时它从加速器退化成全局热点。缓存的通用教训：==成败不在命中率，在失效粒度==；粒度控不住，缓存就是负债。

```timeline
- when: MySQL 5.6
  title: 默认关闭
  desc: query_cache_type 默认 OFF
  tone: muted
- when: 5.7.20
  title: 官方弃用
  desc: 文档标记 deprecated
  tone: amber
- when: 8.0
  title: 彻底移除
  desc: 替代方案是 Server-side Query Rewrite 或 ProxySQL 中间层缓存，失效粒度交使用方自己定
  tone: red
```

!!删掉的是 Server 层的「结果集」缓存。!! InnoDB 的 Buffer Pool 是「数据页」缓存，活得好好的，别拿老文章里的查询缓存当现状教人。

## 05 · 分析器与优化器：从字符串到执行计划

```flow
grid: true
nodes:
  - { id: in, label: "select * from user where id=1", sub: 一段字符串, row: 0, kind: external }
  - { id: lex, label: 词法分析, sub: "SELECT · * · FROM · user · WHERE · id · = · 1", row: 1, kind: backend }
  - { id: syn, label: 语法分析, sub: 按 SQL 文法组装解析树, row: 2, kind: backend }
  - { id: err, label: "ERROR 1064", sub: "You have an error in your SQL syntax", row: 3, kind: security, tone: red }
  - { id: pre, label: 预处理, sub: "表 / 列是否存在 · 展开 select *", row: 3, kind: backend }
  - { id: opt, label: 优化器, sub: "选索引 · 定 join 顺序 · 代价估算", row: 4, kind: backend }
  - { id: plan, label: 执行计划, sub: "EXPLAIN 看到的就是它", row: 5, kind: cloud, tone: violet }
edges:
  - { from: in, to: lex }
  - { from: lex, to: syn, label: 每个 token 带类型 }
  - { from: syn, to: err, label: "from 写成 form", tone: red }
  - { from: syn, to: pre, label: 语法合法 }
  - { from: pre, to: opt }
  - { from: opt, to: plan }
```

这套流水线就是编译器前端：词法负责贴标签（这段文本是关键字还是标识符），语法负责排座位。拆两步的理由也和编译器一样：每个阶段只认一种规则，==出错才能报准阶段和位置==。排障的基本功是分清「解析期错误」（1064，SQL 根本没跑）和「执行期错误」（表不存在、权限不足，跑起来了但被拦）。

优化器回答「怎么执行最快」。SQL 是声明式语言，只声明「要什么」，「怎么做」全由它定。一个 join 的例子：

```compare
first: 计划
head: [执行方式, 代价]
rows:
  - 计划 1 · 大表驱动: ["全表扫 A（100 万行），逐行去 B 找匹配", { text: 100 万次随机访问 · 毫秒变分钟, tone: red }]
  - 计划 2 · 小表驱动: ["全表扫 B（1000 行），用索引逐行查 A", { text: 1000 次索引查询 · 低几个数量级, tone: green }]
```

A 表 100 万行、B 表 1000 行，谁做驱动表，代价差几个数量级。毫秒和分钟，只差一个「谁驱动谁」的决定。

!!「优化器选最优」是「按它的估算选最优」。!! 代价模型的输入是统计信息：总行数、索引基数（一列有多少个不同值）、数据分布，由后台采样更新。表数据大变之后、统计更新之前存在一个失准窗口，它选出的「最优」计划可能比全表扫还慢。`EXPLAIN` 的 type、rows、key 是排障第一眼：先看它选了哪个索引、预估扫多少行，再和实际数据量对照。

## 06 · 执行器：真正干活的人

```seq
participants:
  - { id: ex, label: 执行器, sub: Server 层, kind: backend }
  - { id: eng, label: InnoDB, sub: 存储引擎, kind: database }
messages:
  - { from: ex, to: eng, label: "readFirst(条件)", kind: sync, note: 1 }
  - { from: eng, to: ex, label: "行 1", kind: reply }
  - { from: ex, to: ex, label: "where 过滤：不符 → 丢弃", kind: self, note: 2 }
  - { from: ex, to: eng, label: "readNext()", kind: sync }
  - { from: eng, to: ex, label: "行 2", kind: reply }
  - { from: ex, to: ex, label: "where 过滤：符合 → 进结果集", kind: self }
  - { from: ex, to: eng, label: "readNext() …… 直到返回空", kind: sync, note: 3 }
```

这就是迭代器协议：执行器是不停调 `next()` 的消费者，引擎是惰性产出行的 iterator，像 generator 的 yield，==要一行才产一行==。逐行拉取的理由很实际：结果集可能上百万行，一次全取直接撑爆内存；流式处理，内存里只装当前行加结果集。

循环圈数就是这条 SQL 的代价。走不走索引、索引区分度高不高、要不要回表，全折算成圈数。优化器在 05 节费尽心思选的「最便宜的路」，便宜在==让这个循环转得最少==。贵的操作（取数）放引擎用索引控制次数，便宜的操作（where 过滤）放 Server 层纯内存随便做。

权限在这里有第二道闸：

```flow
grid: true
nodes:
  - { id: conn, label: 连接时, sub: "粗粒度：这个用户能不能连", row: 0, kind: security }
  - { id: parse, label: 分析器, sub: 解析出表名、列名, row: 1, kind: backend }
  - { id: pre, label: 执行器 precheck, sub: "细粒度：这张表这些列能不能读", row: 2, kind: security, tone: violet }
  - { id: run, label: 开工取数, row: 3, kind: backend }
edges:
  - { from: conn, to: parse, label: "进得了门 ≠ 碰得了表" }
  - { from: parse, to: pre }
  - { from: pre, to: run }
```

为什么查两次？粒度不同：连接时查不到「这张表的这些列」，必须等分析器解析出表名列名。precheck 卡在优化器开工之前：名字已解析完、计划还没定，==是拦下无权查询最便宜的时刻==。

## 07 · 更新语句：两份日志与两阶段提交

select 走完执行器就返回了；update 在执行器修改数据之后，还要写日志。两份日志分工不同：

```compare
first: 
head: [redo log · InnoDB, binlog · Server 层]
rows:
  - 记录内容: ["物理：哪个数据页做了什么修改", "逻辑：哪条语句 / 哪行怎么变"]
  - 写入方式: [{ text: 循环写，写满回头覆盖, tone: amber }, { text: 追加写，完整留档, tone: green }]
  - 属于谁: [InnoDB 特有，别的引擎没有, 所有引擎共用]
  - 用途: [crash-safe 崩溃恢复, 主从复制、数据恢复]
```

为什么不直接刷盘、要先写 redo？看两种写法的差别：

```compare
first: 
head: [直接刷脏页, WAL（先写 redo）]
rows:
  - 写什么: [每次更新写回整个 16KB 页, 只追加一条小记录]
  - IO 形态: [{ text: 随机写，磁头来回寻道, tone: red }, { text: 顺序写，只动磁头一次, tone: green }]
  - 时机: [同步，更新就得等盘, 异步，后台择机刷脏页]
  - 崩溃时: [丢掉没刷盘的修改, { text: 重放 redo 找回已提交的修改, tone: green }]
```

顺序写和随机写的差距是磁盘物理特性决定的。 redo 的形态差异也来自用途：循环写是因为==只管崩溃恢复==，最近一段就够，能覆盖的前提是被覆盖位置的脏页已刷盘（checkpoint）；binlog 追加写是因为从库要回放==完整历史流水==，覆盖掉就断了。落盘时机各有旋钮：`innodb_flush_log_at_trx_commit=1` 是每次提交都刷（最安全最慢），binlog 对应 `sync_binlog`。binlog 另有 statement / row / mixed 三种记录格式，主从复制里各有各的坑，是往外挖的钩子。

update 的提交时序：

```seq
participants:
  - { id: ex, label: 执行器, sub: 协调者, kind: backend }
  - { id: ib, label: InnoDB, sub: redo log, kind: database }
  - { id: sv, label: Server 层, sub: binlog, kind: database }
messages:
  - { from: ex, to: ib, label: "改内存页（脏页）+ 写 redo，标记 prepare", kind: sync, note: "崩溃点 A" }
  - { from: ex, to: sv, label: "写 binlog（完整事件 + XID 收尾）", kind: sync, note: "崩溃点 B" }
  - { from: ex, to: ib, label: "redo 标记 commit", kind: sync, note: "崩溃点 C" }
  - { from: ib, to: ex, label: "完成，返回客户端「成功」", kind: reply }
```

两份日志分属两层、独立写入，两次写入之间崩溃怎么办？先看两个朴素方案的死穴：

```checklist
tone: cross
items:
  - 方案一「先写 redo 直接提交」：redo 写完崩溃，binlog 没写 → 主库恢复出新值，从库没有 → 主从分裂
  - 方案二「先写 binlog」：binlog 写完崩溃，redo 没写 → 从库执行了，主库没有 → 凭空多数据
```

两个方案各有一个崩溃窗口，窗口里的后果都不可接受。所以要两阶段提交：把 redo 的提交拆成 prepare 和 commit，中间夹着 binlog 的写入。下面亲手在每个崩溃点断一次电：

```demo
widget: mysql-2pc-crash
title: 在三个崩溃点分别断电，看恢复规则怎么兜底
hint: 点一个崩溃点（或不崩，走完）
actions: false
html: |-
  <div class="p2c" data-p2c>
    <div class="seg" data-p2c-modes></div>
    <p class="seg-rule" data-p2c-rule></p>
    <div class="p2c-cols">
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-amber">断电那一刻</span>
          <span data-p2c-state-head>两份日志的状态</span>
        </div>
        <div class="log" data-log="state"></div>
      </div>
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-green">重启后</span>
          <span data-p2c-rec-head>恢复规则怎么判</span>
        </div>
        <div class="log" data-log="rec"></div>
      </div>
    </div>
    <div class="pane-foot" data-p2c-foot></div>
  </div>
```

模拟器里的判定就是这条恢复规则：

```flow
grid: true
nodes:
  - { id: scan, label: 重启，扫描 redo log, row: 0, kind: backend }
  - { id: commit, label: 状态是 commit?, row: 1, kind: backend }
  - { id: live, label: 直接生效, row: 2, kind: cloud, tone: green }
  - { id: chk, label: "拿 XID 查 binlog：完整?", sub: 完整事件 + XID 事件收尾, row: 2, kind: backend }
  - { id: do, label: 提交该事务, row: 3, kind: cloud, tone: green }
  - { id: undo, label: 回滚该事务, row: 3, kind: cloud, tone: red }
edges:
  - { from: scan, to: commit }
  - { from: commit, to: live, label: 是 }
  - { from: commit, to: chk, label: "否（prepare）" }
  - { from: chk, to: do, label: 完整, tone: green }
  - { from: chk, to: undo, label: 缺失, tone: red }
```

三个崩溃点对号入座：A（redo prepare、binlog 无）→ 回滚，主从都没有；B（binlog 完整、redo 停在 prepare）→ 提交，主从都有；C（redo 已 commit）→ 直接生效，主从都有。三种结局都是==两边一致==。XID 是贯穿两份日志的事务身份证，恢复时靠它把两份日志里的同一个事务对上号；「binlog 完整」的判断标准是完整的事件序列、并以 XID 事件收尾，半截的 binlog 不算。

```callout
tone: violet
icon: ⚖
quote: true
text: |
  夹心顺序为什么是「redo prepare → binlog → redo commit」，不是反过来？
  prepare / commit 是 InnoDB 自己的状态位，想标就标；binlog 是 Server 层的日志，
  没有中间态，写了就是写了。==有状态位的一方承担两阶段，另一方只在夹心处一次性写完整。==
```

为什么不用一份日志？redo 要页级物理重放，只有 InnoDB 懂；binlog 要跨引擎、跨版本传递逻辑操作，只有 Server 层能做。用途不同决定粒度不同，粒度不同决定两套不能合并。这套机制在 MySQL 内部叫 internal XA，官方文档确认它保证了 binlog 与 InnoDB 数据文件的同步。

## 08 · 回到开头那句时快时慢的 SQL

现在你有了完整的定位图。同一句 SQL 时快时慢，变量从来不在 SQL 文本本身，在这几站：

```cards
cols: 4
items:
  - { title: 连接层, desc: "连接打满被拒；空闲超 wait_timeout 被掐；全局权限改了没重连", tag: 连接器, tone: blue }
  - { title: 选错计划, desc: "统计信息过期，自信地选错索引。EXPLAIN 看 type / rows / key", tag: 优化器, tone: amber }
  - { title: 圈数暴涨, desc: "索引退化、区分度崩了、回表变多，循环圈数就是代价", tag: 执行器, tone: violet }
  - { title: 缓存未命中, desc: "Buffer Pool 装不下热数据，每次读都碰磁盘", tag: 引擎, tone: green }
```

下次别对着 SQL 文本干瞪眼，==按站排除==。

一条 SQL 的旅程，前半段所有语句共享，后半段只有写语句续费：读是一次「取」，写是一次「取」加一次「记」，记的这笔账要经得起断电。想再往下挖：数据页在 InnoDB 里怎么组织成 B+ 树，见 [innodb-index-visual](../innodb-index-visual/)；再远一点是 MVCC 与 undo log、Buffer Pool 刷脏时机、redo 的 group commit、binlog 三种格式的复制陷阱。

```quiz
- q: 查询缓存为什么被 8.0 删掉？说出至少两条死因。
  a: |
    三条：失效粒度太粗（表上任意一次更新清空这张表的全部缓存）；key 逐字节匹配太苛
    （大小写、空格、参数一变就 miss，连语义相同都识别不了）；维护成本照付（每次查询算 hash、加锁）。
    写多读少场景命中率趋近零，纯负优化。另外它删掉的是「结果集」缓存，
    InnoDB 的 Buffer Pool（数据页缓存）不受影响。
- q: 两阶段提交的崩溃点 B（binlog 已写完、redo 停在 prepare）断电，重启后主库和从库各是什么状态？
  a: |
    恢复规则：redo 停在 prepare，就拿事务的 XID 去查 binlog。binlog 有完整事件、
    以 XID 事件收尾 → 提交该事务。主库追上新值，从库重放这条 binlog 也有新值，
    两边都有、一致。
- q: 管理员 REVOKE 了某用户对一张表的 SELECT，这条用户已建立的连接什么时候开始被拒？
  a: |
    下一次请求就生效。表 / 列级权限是每次请求对着内存里的权限缓存查的；
    「要重连才生效」只适用于全局权限和密码。想立即断掉某人的全局权限，
    光改权限表不够，得把活跃连接 KILL 掉。
```
