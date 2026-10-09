## 01 · 查一行，为什么要先想「页」？

你要查 `id=9876543`，不是把 1000 万行全部搬进内存。索引要做的，是把目标缩小到少数几个页，再在页里找到这一行。

本文基于内部文档《从零推导 InnoDB 索引机制》revision 102，读取了正文 7 章和 40 张评论图片。沿着「页 → 树 → 两棵树 → 键序 → 成本」讲解；图中的小数据集是教学示意，不是数据库实测。

```cards
cols: 3
items:
  - title: 行 · 你要的内容
    tone: green
    tag: 业务对象
    code: "{ id: 42, email: 'lin@demo.cn', name: '小林' }"
    desc: SELECT 要返回的用户信息。
  - title: 页 · 引擎拿取的单位
    tone: violet
    tag: 存储 / 缓存单位
    code: "页 L2 = 多条记录 + 页头 + 目录 + 空闲空间"
    desc: InnoDB 默认页大小为 16 KiB，可配置，并非所有实例都固定为 16 KiB。
  - title: 缓冲池 · 页的内存副本
    tone: blue
    tag: Buffer Pool
    code: "L2 已缓存 → 在内存中查；L2 缺失 → 加载页"
    desc: 一次逻辑页访问，未必需要一次磁盘读取。
```

```flow
grid: true
nodes:
  - { id: need, label: 查询要访问页 L2, sub: "页号由索引导航得到", row: 0, tone: blue }
  - { id: hit, label: 缓冲池命中, sub: "直接使用已缓存的页", row: 1, tone: green }
  - { id: miss, label: 缓冲池未命中, sub: "读取存储中的页到内存", row: 1, tone: amber }
  - { id: find, label: 在内存中定位记录, sub: "页目录与记录键序链", row: 2, tone: violet }
edges:
  - { from: need, to: hit, label: 已缓存 }
  - { from: need, to: miss, label: 缺页 }
  - { from: hit, to: find }
  - { from: miss, to: find }
```

### 原文的 2GB 与 512MB，该怎么算？

按原文设定，1000 万行 × 200 字节约为 2×10⁹ 字节。只算数据载荷，除以 16,384 得约 12.2 万页；若把 2GB 当 2GiB，则是 131,072 页。真实表还要计入页头、行头、空闲空间、二级索引等开销，所以不把「12.8 万页」当作精确值。

```compare
first: 要找 id=9876543
head: [无可用定位索引, 高扇出 B+ 树]
rows:
  - 页访问形态: ["逐页检查记录，最坏接近整表；找到即可停", "只访问根到目标叶页的一条路径"]
  - 1000 万行的示意量级: ["约十几万数据页，取决于真实布局", "若这棵树高 3，则路径含 3 张页"]
  - 对缓存的利用: ["扫描可能涉及许多冷数据页", "小规模导航层反复访问，更容易保持热"]
  - 不能据此推出: ["每页都产生一次随机 IO", "根页永远不能被淘汰、查询恒定 1 次 IO"]
```

原文问「到底读多少次盘」，答案需要两个条件：**索引决定访问哪些页，缓存决定哪些页要重新加载。** 范围宽度、回表、溢出列和版本读取还可能增加访问，不能只背树高。

## 02 · 为什么把树做得又宽又矮？

扇出（fan-out）是一张非叶页能指向多少张子页。将一页装成许多「导航键 + 子页号」，一次页读取就能排除大批不相关数据。

```cards
cols: 2
items:
  - title: 非叶页 · 只负责指路
    tone: violet
    code: "[下界 1 → 页 A] [下界 60 → 页 B] [下界 90 → 页 C]"
    desc: 目标 70 位于 60 与 90 之间，走 B。首条最小记录有特殊标记，不能机械理解成总与子页当前最小值逐字相等。
  - title: 叶页 · 负责存索引记录
    tone: green
    code: "页 B：[60 的记录][70 的记录][80 的记录]；next → C"
    desc: 聚簇叶子放行记录，二级叶子放索引列与主键。叶页同层相连，范围扫描无需每行回到根。
```

```compare
first: 存储结构
head: [擅长什么, 为通用磁盘查询付出的代价]
rows:
  - 哈希: ["整键等值定位", "散列不保留键的全局顺序，范围和 ORDER BY 不能直接利用哈希序"]
  - 普通平衡二叉树: ["内存中有序查找", "扇出只有 2，指针密集；若逐节点跨页，页访问路径过长"]
  - B 树: ["高扇出且有序", "数据可分布在内部和叶子层，范围遍历更复杂；记录载荷会挤占导航容量"]
  - B+ 树: ["高扇出导航 + 叶链范围扫描", "维护有序页、分裂和合并，需要支付写入代价"]
  - LSM: ["内存接收写入，批量生成有序文件", "读取可能涉及多个层或文件，合并带来读/写/空间放大；收益依配置和负载变化"]
```

LSM 是另一组取舍，不是被 B+ 树全面淘汰。下图是常见的 leveled LSM 写路径，文件中的记录也有序；差别在于跨文件保存多个版本，而非把所有内容维护在一棵原地更新的树里。

```lane-stack
- title: 内存接收写入
  desc: 先记录日志，再更新内存结构
  tone: blue
  nodes:
    - { title: WAL 与 MemTable, sub: "日志保障恢复；内存结构维护键与版本" }
  next: "冻结并刷出 :: :: 生成有序、不可变的文件"
- title: SSTable 文件
  desc: L0 可有重叠键区间
  tone: violet
  nodes:
    - { title: 新文件 A, sub: "key 50 = 新值" }
    - { title: 较旧文件 B, sub: "key 50 = 旧值" }
  next: "Compaction :: :: 合并版本与键区间，依据快照需要保留或清理旧版本"
- title: 后续层的有序文件
  desc: 整理后减少重叠
  tone: green
  nodes:
    - { title: 有序文件 C, sub: "不是修改旧文件中的 key 50" }
    - { title: 读取辅助结构, sub: "Bloom Filter 排除不含键的文件，索引与缓存减少读取" }
```

读取要找到符合当前快照的版本，可能探查多个文件；范围查询也可能归并多个有序输入。不可变文件有利于并发读，但不能据此推出整套引擎「零锁」、复制几个 SST 文件就能完成一致备份。文件集合、元数据与内存日志仍要由引擎的 checkpoint/backup 流程协调。

哈希也不是在 InnoDB 中完全不存在：自适应哈希是 B+ 树之上的加速机制，不替代底层树。

### 容量看公式，不背「三层两千万」

设每叶页能装 R 条记录，每非叶页能指向 F 张子页，高度 h 包含叶层，则示意容量为 `R × F^(h−1)`。下面只调行宽，固定示意扇出 1000、可用载荷 15KiB；已忽略真实记录头、目录、主键宽度和溢出页。

```demo
widget: tuner
title: 行宽变化，三层树容量就变
actions: false
config:
  param: { label: 行载荷, unit: B, values: [100, 200, 500, 1000, 2000] }
  outputs:
    - { label: 每叶页行数, unit: 行, values: [153, 76, 30, 15, 7], tone: blue }
    - { label: 三层示意容量, unit: 万行, values: [15300, 7600, 3000, 1500, 700], tone: green }
```

固定一层高的容量会随行宽和导航记录宽度变化。这里「F=1000」是透明的模型参数，不冒充源码精确值；原文的「键 8B + 页号 6B」也不能代表完整导航记录的实际大小。

## 03 · 往下找一行，往右扫一段

```demo
widget: innodb-visual-lab
title: 亲手追踪：点查、范围查与缓存
actions: false
config:
  mode: path
```

试三次：先跑 `id=42`，再切范围 `25≤id≤75`，最后把「全部冷缓存」与「仅导航页热」各跑一遍。观察访问路径和缺页加载数：缓存变了，树的键序与查询路径没有变。

```compare
first: 查询动作
head: [点查, 范围扫描]
rows:
  - 起点: ["按目标键从根向下定位", "按范围下界从根向下定位"]
  - 到叶页之后: ["找到记录或确认不存在，结束", "页内顺序取记录，沿 next 跨叶页"]
  - 简化访问量: ["根到叶的高度 h", "h + 新跨入的叶页数，起点叶页不重复计"]
  - 最容易变大的部分: ["额外回表、旧版本或溢出列读取", "扫过的叶页数与回表数"]
```

```callout
tone: amber
text: |
  叶链有序是「键序连续」，不保证对应页在磁盘或文件里紧挨着。它免去树上反复回溯、让范围访问更容易利用局部性；实际顺序 IO 程度还取决于分配、碎片、缓存和预读。
```

## 04 · 页到底在文件里长什么样？

### 两棵树是一组页，不是一份连续数组

```tree
- label: users 的表空间
  note: file-per-table 配置下通常对应 .ibd 文件
  tone: violet
  children:
    - label: 聚簇索引
      note: 这张表的行数据组织
      children:
        - { label: 非叶节点段, note: 导航页与相关空间分配 }
        - { label: 叶节点段, note: 行记录所在的叶页 }
    - label: 二级索引 idx_email
      note: 自己有独立的索引页与两类段
      children:
        - { label: 非叶节点段, note: 邮箱键导航 }
        - { label: 叶节点段, note: 邮箱 + 主键记录 }
    - label: 空间管理页
      note: 表空间头、位图、段分配元数据；不是用户记录
```

```lane-stack
- badge: 分配
  title: 段 segment
  desc: 一类索引页的管理集合
  tone: violet
  nodes:
    - { title: 叶段与非叶段, sub: "每个索引分别管理" }
  next: "申请空间 :: :: 小段可先使用零碎页，增长后使用完整 extent"
- badge: 区间
  title: 区 extent
  desc: 默认页大小下为 64 页
  tone: blue
  nodes:
    - { title: 64 × 16 KiB = 1 MiB, sub: "表空间内连续页号的分配单位" }
  next: "选择页 :: :: 文件偏移连续，不等于底层设备物理地址必然连续"
- badge: 节点
  title: 页 page
  desc: 一张树节点或管理页
  tone: green
  nodes:
    - { title: INDEX 页, sub: "页头 + 记录 + 目录 + 空闲空间" }
    - { title: 管理页, sub: "空间分配与元数据" }
```

```cards
cols: 4
items:
  - { title: p0 · FSP_HDR, desc: 表空间头与分配信息, tone: muted }
  - { title: p1 · IBUF_BITMAP, desc: change buffer 相关位图, tone: muted }
  - { title: p2 · INODE, desc: 段分配元数据, tone: muted }
  - { title: p3 · INDEX, desc: 旧版小表实例中的聚簇根页, tone: violet }
```

这是新建小表旧版转储的布局实例，不是所有版本、所有表空间的固定模板；入口位置来自元数据，不应在应用里写死 `p3`。单表文件也不包含全部 undo 历史。

### 一张页，两种「顺序」

```memmap
title: 一个默认 16 KiB INDEX 页的示意切面
sub: 按低偏移到高偏移摆放；高度为可读性权重，不按字节比例
high: 低偏移 · 页起点
low: 高偏移 · 页末尾
segments:
  - { label: FIL 页头, sub: "页号、页类型、同层 prev/next", tone: blue, size: 1 }
  - { label: 索引页头 / 段头, sub: "记录数、层级、空闲与方向等元数据", tone: violet, size: 1 }
  - { label: infimum / supremum, sub: "比所有真实键小 / 大的哨兵", tone: muted, size: 1 }
  - { label: 用户记录区, sub: "按分配位置存放，next 维护键序", tone: green, size: 2.5, dir: down, mark: 向高偏移增长 }
  - { label: 连续空闲空间, sub: "记录和目录之间的余量", tone: muted, size: 2 }
  - { label: 页目录, sub: "稀疏槽，每槽为页内偏移", tone: amber, size: 1.5, dir: up, mark: 向低偏移增长 }
  - { label: FIL 页尾, sub: "校验相关信息", tone: blue, size: 1 }
note: 图中 top/bottom 是文件偏移，不是内存地址的高低；记录区和页目录从两侧向中间增长。
```

```demo
widget: innodb-visual-lab
title: 物理无序也能查：用目录找组，用 next 找记录
actions: false
config:
  mode: page
```

插入时可以取空闲位置并接入键序链，不需要总把整页记录按键搬一遍。但记录不是「从不搬移」：页内重组和分裂都会搬记录。

```journey
- tag: ① 逻辑删除
  tone: amber
  name: delete-mark
  fields:
    - { k: 记录, v: 仍保留 }
    - { k: 原因, v: 旧快照可能还需要 }
  note: 打删除标记，不意味着占用空间立刻可以随意覆盖。
  next: "旧版本不再被需要 :: :: purge 后台清理"
- tag: ② 物理清理
  tone: green
  name: purge
  fields:
    - { k: 记录, v: 从索引中物理移除 }
    - { k: 页内空间, v: 可供后续复用或整理 }
  note: 页内回收、重组和页合并是后续不同层次的空间管理动作。
```


## 05 · 表是主树，二级索引是另一个入口

### 查询邮箱为什么还要拿主键？

```arch
svg: innodb-visual-two-trees
caption: 查询整行时的两次导航。图中的导航页概括了根和内部层；点任意节点查看它的直接联系。
parts:
  query: { label: 查询邮箱, detail: "查询条件是 email，主键树没有按 email 排序，因此先用二级索引定位。" }
  secondaryNav: { label: 二级树导航页, detail: "导航记录带索引键、补齐的聚簇键与子页号；这里概括了多层导航。" }
  secondaryLeaf: { label: 二级树叶子, detail: "命中记录保存邮箱和主键 id=42，不保存 name 等所有用户列。" }
  clusterNav: { label: 用主键回主树, detail: "回表是一次按主键的逻辑查找，不是用行的物理地址直接跳转。" }
  clusterLeaf: { label: 聚簇树叶子, detail: "拿到行记录和可见性相关字段；大变长列可能还需读取页外数据。" }
  result: { label: 返回结果, detail: "按 SELECT 需求输出列。页是否缺失、是否需要旧版本，决定额外物理读取。" }
anchors:
  - { part: secondaryLeaf, label: 我想看二级叶子 }
  - { part: clusterLeaf, label: 我想看整行在哪 }
```

```journey
- tag: ① 二级叶记录
  tone: blue
  name: idx_email · 索引记录
  fields:
    - { k: email, v: lin@demo.cn }
    - { k: id, v: "42", note: 用于回表 }
  note: 这里没有 name。邮箱相邻的两条记录，主键不一定相邻。
  next: "回表 :: :: 拿 id=42，再定位聚簇树"
- tag: ② 聚簇叶记录
  tone: green
  name: PRIMARY · 行记录
  fields:
    - { k: id, v: "42" }
    - { k: name, v: 小林 }
    - { k: email, v: lin@demo.cn }
    - { k: MVCC, v: trx_id / roll_pointer, note: 可见性与旧版本 }
  note: 此例全部列内联。大字段可存页外内容，叶子中保存相关信息。
```

二级索引保存稳定主键，行因分裂换了页时，引用仍然有效；付出的代价是需要取缺失列时，再查一次聚簇树。主键更新则不同：该行在聚簇树的位置和二级索引中的主键内容都要变。

```compare
first: 聚簇键选择
head: [何时使用, 例子]
rows:
  - 显式主键: ["优先", "PRIMARY KEY(id)"]
  - 合适的唯一索引: ["无主键时，首个所有列均 NOT NULL 的 UNIQUE 索引", "UNIQUE(email)，且 email NOT NULL"]
  - 隐藏聚簇键: ["两者都没有时，生成 GEN_CLUST_INDEX", "单调递增的隐藏 6 字节 row ID，应用不能直接查询它"]
```

### 覆盖、ICP、MRR 分别改了什么？

```demo
widget: innodb-visual-lab
title: 同样扫描四条索引记录，为什么回表不同？
actions: false
config:
  mode: optimize
```

```compare
first: 优化
head: [对哪件事动手, 没有承诺什么]
rows:
  - 覆盖索引: ["所需列都在索引中，免去为缺失列回表", "旧快照可见性判断仍可能访问聚簇记录"]
  - ICP · 索引条件下推: ["索引上先过滤，减少需要回表的记录数", "不能替代设计更窄的访问区间"]
  - MRR · 多范围读取: ["攒一批主键再排序，改善数据页访问局部性", "不取消回表，也不保证所有访问都成为物理顺序 IO"]
```

ICP 要用真正不能进一步缩小访问区间的条件来讲。比如 `(zipcode, lastname, firstname)` 中 `zipcode='95054' AND lastname LIKE '%etrunia%'`：固定邮编段后姓氏仍需过滤。原文 `(email,status)` 两列都等值的例子，后列常可以直接参与定位，不能当作必然 ICP 的证据。

数据页已热时，MRR 排序成本可能抵消收益；优化器会按成本选择。三个 EXPLAIN 标志描述的是计划，不是「发生了多少磁盘 IO」的计数器。

## 06 · 最左前缀：在一条叶链上切区间

联合索引 `(a,b)` 先按 a 排，再在 a 相同的段里按 b 排。像版本号 `major.minor`：先固定 major，minor 才在这段内连续。

```demo
widget: innodb-visual-lab
title: 换列顺序，看「扫描的」和「命中的」如何分开
actions: false
config:
  mode: joint
```

试 `a≥2 AND b=2`：在 `(a,b)` 上，访问区间从 a=2 延伸到 a=3，b=2 是过滤；换 `(b,a)`，b=2 锁住一段，a≥2 再缩小该段。相同命中结果，可以需要不同的扫描量。

```compare
first: INDEX(a,b,c) 的条件
head: [能定位到哪里, 后续怎样处理]
rows:
  - a=1 AND b=2 AND c=3: ["精确组合键区间", "非唯一时仍可能有多条相同组合"]
  - a=1: ["a=1 整段", "继续扫描该段"]
  - a=1 AND c=3: ["仍可用 a=1 缩小范围", "b 未约束，c 常只用于过滤；不是整个索引完全不能用"]
  - 只给 b=2: ["普通最左前缀定位缺少 a", "可能全索引扫描，某些条件下可考虑 Skip Scan"]
  - a IN (1,2) AND b=3: ["多个可定位区间", "不必硬凑为一个连续区间"]
  - ORDER BY a,b: ["排序与索引序匹配时可利用", "实际是否选择仍依访问成本"]
```

```cards
cols: 2
items:
  - title: access · 减少读入
    tone: green
    code: "b=2 先锁住一个段；a≥2 再切段"
    desc: 参与决定从哪里开始、在哪里结束。
  - title: filter · 读到后再判断
    tone: amber
    code: "先扫 a≥2 的全部，再扔掉 b≠2"
    desc: ICP 可把过滤前移到索引上，仍然没有减少本次访问区间。
```

对于同一 `(等值 E AND 范围 R)` 且数据键相同的简单查询，`(E,R)` 的目标扫描区间通常不大于 `(R,E)`。不能仅因 E 区分度低，就断言反过来一定扫描更少。选择列顺序还要考虑其他 SQL、排序、覆盖、索引宽度和维护成本。

### 两条常见绝对化要去掉

```compare
first: 原文简化
head: [更准确的边界, 例子]
rows:
  - 混合 ASC/DESC 无法利用索引: ["MySQL 8.x 支持对应方向的混合降序索引", "INDEX(a ASC,b DESC) 可服务匹配的 ORDER BY"]
  - LIKE 的前缀范围就是 abc 到 abd: ["在简单序关系下可用来建立直觉，真实边界依排序规则而定", "LIKE 'abc%' 可能用于 range；仍保留 LIKE 条件核验"]
  - 函数/OR 一出现就索引失效: ["普通列索引未必支持该表达式，但函数索引、生成列索引、Index Merge 等可改变计划", "先看具体索引与计划，不只看 SQL 字面"]
  - key_len 精确告诉全部条件用法: ["它显示已用键前缀最大长度，可空列与区间转换会带来例外", "结合实际范围、rows、filtered、optimizer trace 判断"]
```

## 07 · 查得快，也要养得起每一棵树

### 「走索引还慢」看这三段

```lane-stack
- badge: ① 定位
  title: 树遍历
  desc: 根到起点叶页
  tone: blue
  nodes:
    - { title: 少量导航页, sub: "常见树高较小；缓存命中可能高" }
  next: "找到起点 :: :: 只解决从哪里开始"
- badge: ② 扫描
  title: 叶链扫描
  desc: 区间有多宽
  tone: violet
  nodes:
    - { title: 访问范围内的叶页, sub: "索引列序影响区间；LIMIT 可提前停止" }
  next: "需要缺失列 :: :: 覆盖可取消这一步的后续回表"
- badge: ③ 取行
  title: 回表
  desc: 多少条主键再查主树
  tone: amber
  nodes:
    - { title: 聚簇索引查找, sub: "ICP 减少条数，MRR 改善顺序，缓存减少加载" }
```

这不是三个恒定系数相加的预测器。许多回表可以命中同一张缓存页，不能拿「命中 10 万行」直接乘成「10 万次真实随机 IO」。优化器也可能选全表扫描：扫描大比例数据时，一次有局部性的扫描常比许多分散查找便宜，没有固定的命中百分比门槛。

### 一次 INSERT，不只写主树

```tree
- label: INSERT 一条新行
  tone: violet
  note: 这里只展示索引维护；真实持久化还有 redo/undo 等机制
  children:
    - { label: 聚簇索引, note: 定位叶页，插入行记录，必要时重组或分裂 }
    - { label: 二级索引 1, note: 插入索引列 + 主键，必要时重组或分裂 }
    - { label: 二级索引 2 … N, note: 每个受影响的索引都有维护成本 }
```

```demo
widget: innodb-visual-lab
title: 页放不下新记录：重组、分裂、父页维护
actions: false
config:
  mode: split
```

原文将「子页代表键」讲成比「分隔键」必然少改相邻两条边，这是过度推导。常见分隔键实现也可以在分裂时插入新边界；本页只画经过确认的变化：分配新页、移动记录、更新页链和父导航记录，必要时传播到根。

```compare
first: 主键维度
head: [影响, 要权衡什么]
rows:
  - 短: ["主键会出现在聚簇导航、二级索引记录中，变宽会减少每页容量", "BIGINT 8B；二进制 UUID 16B；字符存法还受编码影响"]
  - 稳定: ["主键变更会影响聚簇位置和二级引用", "业务字段若会修改，不宜仅因当前唯一就草率选作主键"]
  - 有序分布: ["趋向叶链尾部插入，通常有更好的局部性", "尾部页也可能成为并发热点"]
  - 随机分布: ["插入点分散，通常涉及更多冷页和碎片维护", "分散热点不等于没有锁争用"]
```

```callout
tone: amber
text: |
  `MERGE_THRESHOLD` 默认 50%，意思是利用率下降到阈值以下时「尝试」与邻页合并，并不保证任何页永远至少半满。删除不会凭空增加树高；没有及时合并时，可能保留稀疏的旧层级，而不是突然退化为更高的二叉链。
```

### change buffer：只延后符合条件的二级页变更

```lane-stack
- title: 判断是否适用
  desc: 不替代所有写入
  tone: amber
  nodes:
    - { title: 开启相关 buffering, sub: "还需满足索引种类与页状态限制" }
    - { title: 目标二级页不在缓冲池, sub: "普通聚簇插入 / 唯一性校验不能这样概括" }
  next: "暂存变更 :: :: change buffer 是可持久化的内部结构，不只是一份易失内存列表"
- title: 等待目标页加载或后台合并
  desc: 攒起来一起应用
  tone: green
  nodes:
    - { title: 合并到目标二级索引页, sub: "减少为零散写入反复加载同一页的机会" }
```

```compare
first: 版本 / 配置
head: [默认值, 解读]
rows:
  - MySQL 8.0 的 innodb_change_buffering: [all, "支持的变更默认启用 buffering"]
  - MySQL 8.4 的 innodb_change_buffering: [none, "默认不进行 buffering，别套用旧教程的默认前提"]
  - MERGE_THRESHOLD: [50, "合并尝试阈值，可配置；不是所有时刻的结构不变量"]
```

### 用实测闭环，不盯一个 type 等级

```lane-stack
- title: EXPLAIN
  desc: 优化器准备怎么执行
  tone: blue
  nodes:
    - { title: key / type / key_len, sub: "访问路径和键前缀" }
    - { title: rows / filtered / Extra, sub: "估算扫描量、过滤比例与优化提示" }
  next: "建立假设 :: :: range 也可能扫大区间，ALL 不一定错误"
- title: EXPLAIN ANALYZE
  desc: 执行后看实际行数和时间
  tone: violet
  nodes:
    - { title: 实际算子行数 / 耗时, sub: "与估算对照；该命令真的执行查询" }
  next: "追问误差 :: :: 估算失真看统计，结构不合适看索引设计"
- title: 统计与页指标
  desc: 验证结构层的代价
  tone: green
  nodes:
    - { title: 索引前缀基数 / 叶页数, sub: "mysql.innodb_index_stats" }
    - { title: 页分裂 / 合并 / 重组, sub: "INNODB_METRICS，结合负载看趋势" }
```

`Using filesort` 表示额外排序，不等于一定写了磁盘文件。`rows × filtered` 也不能直接当回表次数：过滤可能在回表前，也可能在回表后。`ANALYZE TABLE` 可刷新统计，但不修复列序、覆盖和宽度问题；应按生产环境流程评估后执行。

### 新增一个索引前，分别做五个判断

```checklist
items:
  - 高频 SQL 能切出多窄的访问区间？用 WHERE 与实际数据分布验证。
  - 所需列是否都在索引里？若不在，预计要回表多少条？
  - 排序与 LIMIT 能否利用索引序？是否仍需额外排序？
  - 主键和新增列使每个索引记录增加多少字节？
  - 节省的读成本是否值得写维护和缓存空间？用代表性负载实测。
```

## 原文与查证 · 如何回到证据

原文中的页号、层数、时延和容量有些属于示意。这里保留机制主线，纠正绝对化说法，未把博客或评论中的硬件性能数字当普遍保证。

- 内部文档《从零推导 InnoDB 索引机制》revision 102（来源链接略去）：评论图片已预览，未在 HTML 内打包或公开转载。
- [MySQL 8.4：聚簇与二级索引](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-index-types.html)：聚簇键回退、二级记录保存主键。
- [MySQL 8.4：索引物理结构](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-physical-structure.html)、[空间管理](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-file-space.html)：页大小、填充、叶段与非叶段、零碎页到 extent 的分配。
- [Jeremy Cole：INDEX 页物理结构](https://blog.jcole.us/2013/01/07/the-physical-structure-of-innodb-index-pages/)：页目录、哨兵、记录链与同层页链，属于特定时代的转储解析。
- [mysql-8.4.0：page0cur.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.0/storage/innobase/page/page0cur.cc#L484-L552)：二分相邻目录槽，再从下界记录向上界顺扫。
- [MySQL 8.4：MVCC 与二级索引](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-multi-versioning.html)：delete-mark、purge、旧快照下的覆盖索引例外。
- [ICP](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/index-condition-pushdown-optimization.html)、[MRR](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/mrr-optimization.html)：过滤位置与按主键重排的区别。
- [多列 range 与 Skip Scan](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/range-optimization.html)、[ORDER BY 优化](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/order-by-optimization.html)：多个区间、key_len 例外、混合方向索引、filesort 的内存/落盘边界。
- [合并阈值](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/index-page-merge-threshold.html)、[change buffer](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-change-buffer.html)：尝试合并、适用条件与版本默认值。
- [RocksDB：Leveled Compaction](https://github.com/facebook/rocksdb/wiki/Leveled-Compaction)、[Basic Operations](https://github.com/facebook/rocksdb/wiki/Basic-Operations)、[Checkpoints](https://github.com/facebook/rocksdb/wiki/Checkpoints)：LSM 内存与文件写路径、层间重叠和快照目录的协调。

### 合上页面，试着回答

```quiz
- q: 三层主键树，为什么可能一次盘都不读，也可能加载三张页？
  a: 根到叶的逻辑路径仍包含三张页。全部命中缓冲池时不需要加载；全部冷时这三张页都可能要从存储加载。是否有额外版本或溢出列读取需另算。
- q: 二级索引中 email 相邻，为什么拿到的整行可能分散在主树各处？
  a: 二级叶链按 email 与主键组合排序，聚簇树按主键排序，两种顺序不必相关。二级记录只提供主键引用；缺失列要按主键回表取行。
- q: INDEX(a,b,c)，WHERE a=1 AND c=3 算完全不能用索引吗？
  a: 可以用最左列 a=1 缩小访问范围，只是 c=3 被未约束的 b 分隔，通常不能把 a 段进一步变成一个更窄的普通前缀区间。c 仍可能参与索引上的过滤。
- q: 覆盖、ICP、MRR 的区别，能各用一个动词说出吗？
  a: 覆盖取消为取缺失列而回表；ICP 提前过滤、减少回表记录；MRR 重排回表顺序、改善局部性。三者都不能把计划标志直接换算成实际磁盘 IO。
```
