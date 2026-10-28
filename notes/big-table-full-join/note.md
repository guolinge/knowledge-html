「大表全量 join」不是 SQL 里的 `FULL OUTER JOIN`。它说的是另一件更常见的事：

> ==参与配对的行没有被先筛小，两边整体拿去关联。==

这句话底下压着两个问题，讨论时经常被混成一个：查询慢，和结果被算大。

- 慢：读的行、建的表、探测的次数、搬的数据，全都按全量算。
- 大：一对多接上一对多，行数相乘，`SUM` 被重复累加。

两笔账要分开算，因为解法不一样。前者靠少读、少搬；后者靠先把一侧聚合到一行。

```cards
cols: 2
items:
  - title: 账一 · 慢
    tag: 1 亿行 + 5000 万行
    tone: blue
    body: |-
      两张表都按全量扫一遍，输出还是 1 亿量级。
      时间花在读页、建哈希表、逐行探测，以及后面的排序、聚合、网络。
  - title: 账二 · 大
    tag: 2 行 × 2 行 = 4 行
    tone: red
    body: |-
      两条订单明细、两笔支付记录，直接 join 会配成 4 行。
      `SUM` 把每个金额多加了一遍，结果翻倍，而且不报警。
```

## 01 · 判定：三处没做，就是全量

「全量」不是一种 JOIN 语法，是这道查询的形状。看三处：

```compare
first: 看哪里
head: [做了, 没做会怎样]
rows:
  - 扫描侧的条件:
      - 能少读页的过滤：分区裁剪、索引
      - 表里每一页都要读一遍，过滤只减少往下一层传的行数
  - 取哪些列:
      - 只取 join 之后真用得上的字段
      - 每行带着文本、JSON 这类大字段走完整条链路，哈希表也跟着变大
  - 一对多的表:
      - 先按 join key 聚合到一行
      - 行数相乘，`SUM` / `COUNT` 被重复累加
```

`FULL OUTER JOIN` 管的是另一件事：配对之后，两边落单的行留不留。一段 `INNER JOIN` 完全可以是全量的，一段 `LEFT JOIN` 也可能只碰几十行。判断依据是「参与配对的行有多少」，不是关键字。

先看第一种形态。假设（示意）`orders` 1 亿行、`users` 5000 万行，`users.user_id` 唯一，且每个订单都能找到用户：

```flow
grid: true
nodes:
  - { id: orders, label: "orders · 1 亿行", sub: "order_id / user_id / amount", row: 0, kind: database, tone: violet }
  - { id: users, label: "users · 5000 万行", sub: "user_id / user_name", row: 0, kind: database, tone: blue }
  - { id: join, label: Hash Join, sub: "`o.user_id` = `u.user_id`", row: 1, kind: backend }
  - { id: out, label: 结果 ≈ 1 亿行, sub: "每条订单拼上一个用户名", row: 2, kind: frontend, tone: green }
edges:
  - { from: orders, to: join, label: "1 亿行 · 逐条探测", labelDx: -120 }
  - { from: users, to: join, label: "5000 万行 · 建哈希表", labelDx: 120 }
  - { from: join, to: out, label: ≈ 1 亿行 }
```

这条 SQL 让机器做的工作量是：读 1.5 亿行、建一张 5000 万行的哈希表、做 1 亿次探测，再交出约 1 亿行结果。

如果你要的只是「最近 7 天已支付订单」，那 1 亿行里绝大多数是白干的。实际写的时候往往就是这样一句不带 `WHERE` 的关联，因为它在测试库上跑得很快。

## 02 · 第二笔账：一对多接一对多

假设三张表：`orders`（订单主表）、`order_items`（商品明细）、`payments`（支付流水）。一个订单有多条明细，也可能有多笔支付 —— 支付、退款、补款。

订单 `1001` 的两侧长这样：

```text
order_items                payments
订单号  商品    金额        订单号  支付记录   金额
1001    A 商品  100         1001    支付 1     150
1001    B 商品  200         1001    支付 2     150
```

直接关联，再按订单聚合：

```sql
SELECT
    o.order_id,
    SUM(i.amount)      AS item_amount,
    SUM(p.pay_amount)  AS pay_amount
FROM orders o
JOIN order_items i ON o.order_id = i.order_id
JOIN payments p    ON o.order_id = p.order_id
GROUP BY o.order_id;
```

数据库不会「聪明地」挑一组配另一组。`ON` 的条件是订单号，2 条明细和 2 笔支付两两组合，得到 4 行：

```text
订单号   商品金额   支付金额
1001     100       150
1001     100       150
1001     200       150
1001     200       150
```

于是聚合结果变成：

```text
商品金额：100 + 100 + 200 + 200 = 600   实际应为 300
支付金额：150 + 150 + 150 + 150 = 600   实际应为 300
```

行数一多，性能也一起坏掉：2 万条明细 × 300 笔支付就是 600 万行，而这些行里没有一条是新信息。

下面可以自己加明细、加支付，看行数和两个合计怎么跟着变：

```demo
widget: join-fanout-lab
title: 一对多 × 一对多：行数乘出来，金额也跟着重复
actions: false
config:
  items:
    - { name: A 商品, amount: 100 }
    - { name: B 商品, amount: 200 }
    - { name: C 商品, amount: 50 }
    - { name: D 商品, amount: 20 }
  payments:
    - { name: 支付 1, amount: 150 }
    - { name: 支付 2, amount: 150 }
    - { name: 补款, amount: 50 }
  startItems: 2
  startPayments: 2
```

!!注意 `SUM(DISTINCT ...)` 不是解法。!! 两条明细金额都是 100 时，它会把两条算成一条；正确的做法是让每个订单在每个子查询里只剩一行，然后再 join。

```sql
WITH item_summary AS (
    SELECT
        order_id,
        SUM(amount) AS item_amount
    FROM order_items
    GROUP BY order_id
),
payment_summary AS (
    SELECT
        order_id,
        SUM(pay_amount) AS pay_amount
    FROM payments
    GROUP BY order_id
)
SELECT
    o.order_id,
    i.item_amount,
    p.pay_amount
FROM orders o
LEFT JOIN item_summary   i ON o.order_id = i.order_id
LEFT JOIN payment_summary p ON o.order_id = p.order_id;
```

先聚合之后，`item_summary` 和 `payment_summary` 里每个订单各只有一行，再 join 就不会相乘。代价是两边各多扫一遍、各做一次聚合；这笔开销是固定的，不会随另一侧的行数放大。

## 03 · 整体图：一次全量 JOIN 在机器里走一遍

单机上，一次哈希连接只做两件事：把一侧变成哈希表，再让另一侧逐行来查。真正决定成本的是这两步各自要碰多少行。

```arch
svg: hash-join-machine
caption: 从 users 表看起。它的 5000 万行被读进缓冲池、扫成哈希表；orders 的 1 亿行一页页读进来，逐条查这张表，配上的行拼成结果。
frames:
  - id: storage
    boundary: 0
    kind: logical
    label: 存储 · 表和它的页缓存
    detail: 表在磁盘上按页存放；扫描时页先被读进缓冲池，命中就省掉一次物理读，但每行仍然要解析、判断可见性、取列。
  - id: workmem
    boundary: 2
    kind: contains
    label: 工作内存 · 哈希表住在这里
    detail: 哈希表的大小受 work_mem（PostgreSQL，默认 4MB，再乘 hash_mem_multiplier 2.0）或 join_buffer_size（MySQL，默认 256KB）限制；装不下就写临时文件。
  - id: ops
    boundary: 1
    kind: classification
    label: 算子 · 每条输入都被走一遍
    detail: 两个扫描各读一遍自己那张表；build 只写哈希表，probe 每条订单查一次。这里没有「跳过」—— 行数就是次数。
bodies:
  orders_file:
    badge: 1 亿行
    rows:
      - { k: 存放, v: 按页切块 }
      - { k: 读法, v: 顺序读整张表 }
      - { k: 过滤, v: WHERE 只减输出 }
    note: 没索引或分区时，读页省不掉
  users_file:
    badge: 5000 万行
    rows:
      - { k: 存放, v: 按页切块 }
      - { k: 读法, v: 顺序读整张表 }
      - { k: 用到的列, v: 两列 }
    note: 页里其他列白读
  orders_pages:
    badge: 内存里
    rows:
      - { k: 内容, v: orders 最近读过的页 }
      - { k: 命中, v: 省一次物理读 }
      - { k: 未命中, v: 从磁盘读进来 }
    note: 缓存减少 I/O，不减少行数
  users_pages:
    badge: 内存里
    rows:
      - { k: 内容, v: users 最近读过的页 }
      - { k: 命中, v: 省一次物理读 }
    note: 顺序扫描很少复用同一页
  scan_o:
    badge: 第 1 遍
    rows:
      - { k: 做什么, v: 逐页取行、取列 }
      - { k: 输出, v: 1 亿行 }
      - { k: 成本, v: 页数 + 行数 }
    note: 每行判断是否对本次查询可见
  scan_u:
    badge: 第 1 遍
    rows:
      - { k: 做什么, v: 逐页取行、取列 }
      - { k: 输出, v: 5000 万行 }
      - { k: 成本, v: 页数 + 行数 }
    note: 输出全部进哈希表
  build:
    badge: 写
    rows:
      - { k: 输入, v: 5000 万行 users }
      - { k: 计算, v: hash(user_id) }
      - { k: 写入, v: 桶数组 + 冲突链 }
    note: 内存到顶就写 chunk 文件
  hash:
    badge: 工作内存
    rows:
      - { k: 桶里放, v: key + 输出列 }
      - { k: 为什么, v: probe 靠它拼行 }
      - { k: 装不下, v: 按 hash 写 chunk }
    note: 桶、指针、对齐都额外占内存
  probe:
    badge: 1 亿次
    rows:
      - { k: 每条订单, v: 算 hash → 找桶 }
      - { k: 桶里, v: 比 key 真相等 }
      - { k: 命中, v: 拼成一行 }
    note: 找到桶不等于找到人
  result:
    badge: ≈ 1 亿行
    rows:
      - { k: 行数, v: 1 亿 × 1 个用户 }
      - { k: 每行, v: 订单字段 + 用户字段 }
      - { k: 下一站, v: 排序 / 聚合 / 返回 }
    note: 输出也要内存与 CPU
parts:
  orders_file:
    label: orders 表文件
    detail: 全表顺序扫描按页读，读的是整张表。有没有 WHERE 只影响扫描节点吐出多少行，不影响它读多少页 —— 除非过滤能靠索引或分区少读。
  users_file:
    label: users 表文件
    detail: 同一套页结构。join 只需要 user_id 和 user_name，但页是按行存的，用不上的列照样被读进内存。
  orders_pages:
    label: orders 的页缓存
    detail: 页被读进缓冲池后，重复访问不再走磁盘。缓存命中率高时 I/O 少，但解析行、算 hash、拼结果这些 CPU 工作一件都不少。
  users_pages:
    label: users 的页缓存
    detail: 顺序扫描很少重复访问同一页，缓存对它的帮助有限；真正省时间的是「少读一些页」。
  scan_o:
    label: 扫描 orders
    detail: 输出 1 亿行，全部进入 probe。它不负责建表，只负责把行和需要的列取出来。
  scan_u:
    label: 扫描 users
    detail: 输出 5000 万行，全部进 build。选它做 build 侧，是因为它的字节数更小；行数少不等于字节少，优化器看的是估算的宽度。
  build:
    label: 建哈希表
    detail: 对每一行算一次 hash，按桶放进去。这一步是纯写，不能提前结束 —— 哈希表建完才知道哪些 key 存在。
  hash:
    label: 哈希表
    detail: 存 join key 和 probe 之后要输出的列，还要能处理冲突。它比原始数据更占内存，因为桶数组、指针、内存对齐都有开销。
  probe:
    label: 探测
    detail: 每条 orders 都算一次 hash、找一次桶、比一次 key。单次是常数级，但乘 1 亿次就是主成本之一。
  result:
    label: 结果集
    detail: 输出行数由基数关系决定：users.user_id 唯一时是 1 亿行；如果它不唯一，结果还会再乘。
tours:
  - id: build
    label: 先建表
    steps:
      - { at: [users_file, users_pages, scan_u], text: "从 users 表读起：页进缓冲池，扫描节点把 5000 万行一条条交出去。" }
      - { at: [build, hash], text: "每行算一次 ==hash(user_id)==，放进哈希表的桶里。桶里存 key 和之后要用的列。" }
  - id: probe
    label: 再逐条查
    steps:
      - { at: [orders_file, orders_pages, scan_o], text: "orders 也整张读一遍，输出 1 亿行。" }
      - { at: [probe, hash], text: "每条订单拿 user_id 去查表：先找桶，再比 key。命中的拼成一行。" }
      - { at: [result], text: "结果约 1 亿行，进入排序、聚合或网络传输 —— ==下一层还要按这个量级再干一遍==。" }
  - id: memory
    label: 内存这条线
    steps:
      - { at: [scan_u, build, hash], text: "哈希表全在内存里，大小由 work_mem / join_buffer_size 限制。" }
      - { at: [hash, probe], text: "表放不下时，build 侧剩下的行和 probe 侧都要按 hash 写盘，改成成对处理（下一节）。" }
```

读这张图只需要记住两条线：**users 走 build，orders 走 probe**。两条线各扫一遍自己的表，中间在哈希表处相遇。

「数据都在缓存里」不等于「工作消失」。页命中只是省掉了磁盘读；解析行、判断这行对当前事务可见、算 hash、比 key、拼结果，这些都在 CPU 上，按行数计价。

## 04 · Build 和 Probe 里各发生了什么

伪代码只有两段：

```text
# build：把 users 变成一张按 user_id 索引的表
for user in users:                        # 5000 万次
    bucket = hash(user.user_id) % N
    hash_table[bucket].append(user)

# probe：每条订单去查一次
for order in orders:                      # 1 亿次
    bucket = hash(order.user_id) % N
    for user in hash_table[bucket]:       # 桶里通常很短
        if order.user_id == user.user_id:
            emit(order, user)
```

三件容易被略过的事：

```cards
cols: 3
items:
  - title: 桶里不只放 hash 值
    tag: 内存比想象的大
    tone: amber
    body: |-
      probe 命中后要拼输出，所以桶里得留着 join key 和要输出的列（这里是 `user_id`、`user_name`），还要有冲突链或指针。
      哈希表占的内存通常大于「这些列的原始大小」：桶数组、指针、对齐都得算。
  - title: 找到桶不等于找到人
    tag: 必须再比一次 key
    tone: violet
    body: |-
      不同 `user_id` 可能落到同一个桶（哈希冲突）。所以 `if` 那一行不能省：==桶里有东西，只说明「可能匹配」==。
  - title: 单次查找便宜，次数不便宜
    tag: 1 亿次
    tone: blue
    body: |-
      每次探测是常数级：算 hash、取桶、比几个 key。但乘上 1 亿行，就是 1 亿次 hash 加 1 亿次比较，再加 1 亿次输出拼接。
```

谁做 build 侧由优化器定，通常挑**字节数较小**的一侧（MySQL 官方博客的说法是按字节，不是按行数）。所以「users 只有 5000 万行」不代表它一定更小：如果它每行带一个大 JSON，orders 反而可能更适合建表。

## 05 · 内存装不下：分批哈希

5000 万行的哈希表很容易超过单次查询的内存额度。这时数据库不会直接失败，而是把放不下的部分写到临时文件，再成对处理。

```lane-stack
- badge: STEP 01
  title: build 阶段把剩下的行写盘
  desc: 内存满之前已经建了一部分哈希表；剩下的行按 hash(user_id) 分到 chunk 文件
  tone: amber
  nodes:
    - { title: chunk 0, sub: "hash % N = 0", tag: 盘上 }
    - { title: chunk 1, sub: "hash % N = 1" }
    - { title: ……, sub: "MySQL 每个输入最多 128 个 chunk 文件" }
  next: "probe 阶段 :: :: 同一套 hash，把 orders 也分到对应 chunk"

- title: probe 阶段也分区
  desc: 一条订单只可能和同编号 chunk 里的那批 users 匹配，不用跨 chunk 找
  tone: blue
  nodes:
    - { title: orders chunk 0, sub: 对应 chunk 0, tag: 写盘 }
    - { title: orders chunk 1, sub: 对应 chunk 1 }
    - { title: ……, sub: "其余订单同样按 hash 分" }
  next: "成对读回 :: :: 每个 chunk 单独建表、探测"

- title: 逐对处理
  desc: 读一个 build chunk 进内存建哈希表，再读对应的 probe chunk 探测；做完一对，再下一对
  tone: green
  nodes:
    - { title: 内存里的哈希表, sub: 一次只装一个 chunk }
    - { title: 结果, sub: 与其它 chunk 的结果合并 }
    - { title: 必要时再切, sub: 单个 chunk 仍太大，就继续往下分 }
```

两个细节值得知道：

- **MySQL 的实现里，分区和桶用了两套 hash 函数。** 如果同一套，同一个 chunk 里的行会全部落到同一个桶，哈希表退化成链表。
- **chunk 数量有上限。** MySQL 每个输入最多 128 个 chunk 文件；如果内存太小、文件数超过 `open_files_limit`，查询会直接失败，而不是慢慢跑完。

落盘之后，同一批数据要多走三趟：读原表、写临时文件、从临时文件读回来。所以耗时不是线性增加，而是突然跳一个台阶 —— 这也是「昨天还好、今天突然慢十倍」的常见来路。

```callout
tone: amber
icon: ⚙️
text: |
  两个引擎的默认额度差别很大，但都是**每个操作**的额度：

  - **PostgreSQL**：`work_mem` 默认 4MB，哈希表还能再乘 `hash_mem_multiplier`（默认 2.0），约 8MB 起。一条复杂查询里有多个排序/哈希节点，每个都按这个额度算；并发会话再乘一遍 —— 官方文档明确提醒总内存可能是 `work_mem` 的很多倍。
  - **MySQL**：`join_buffer_size` 默认 262144 字节（256KB），哈希连接不能超过这个量。哈希连接是增量分配内存的，调大它比调大块嵌套循环的缓冲更安全。

  ++调大额度能避免落盘，但不会让 1.5 亿行变少。++
```

## 06 · 分布式：还要过一次网络

单机上的账是「读得多、可能落盘」。到了 Spark、Flink、Doris、StarRocks、ClickHouse 这类系统，两侧的数据分散在多个节点上，同一条 `user_id` 的订单和用户可能根本不在同一台机器。

```flow
grid: true
nodes:
  - { id: o, label: orders 分片, sub: "4 台机器，共 1 亿行", row: 0, kind: database, tone: violet }
  - { id: u, label: users 分片, sub: "4 台机器，共 5000 万行", row: 0, kind: database, tone: blue }
  - { id: s, label: 按 user_id 哈希重分区, sub: "相同 key 必须进同一个分区", row: 1, kind: messagebus, tone: amber }
  - { id: n0, label: 节点 A, sub: 约 1500 万行, row: 2, kind: backend }
  - { id: n1, label: 节点 B, sub: 约 1000 万行, row: 2, kind: backend }
  - { id: n2, label: 节点 C, sub: 约 6500 万行 · 热点, row: 2, kind: backend, tone: red }
  - { id: n3, label: 节点 D, sub: 约 1000 万行, row: 2, kind: backend }
  - { id: out, label: 各节点本地 Hash Join, sub: "再汇总成分片结果", row: 3, kind: frontend, tone: green }
edges:
  - { from: o, to: s, label: "Shuffle：按 key 重分发", labelDx: -130 }
  - { from: u, to: s, label: "Shuffle：两侧都要搬", labelDx: 130 }
  - { from: s, to: n0 }
  - { from: s, to: n1 }
  - { from: s, to: n2 }
  - { from: s, to: n3 }
  - { from: n0, to: out }
  - { from: n1, to: out }
  - { from: n2, to: out }
  - { from: n3, to: out }
```

这一步叫 Shuffle：按 join key 重新分区，把数据跨节点拷一遍。Spark 文档对它的描述很直白 —— 重新分配数据，通常要在执行器和机器之间拷贝，因此既复杂又昂贵；map 侧先按目标分区写文件，reduce 侧再读对应的块，内存不够还会落盘。

搬多少数据，取决于表的分布和系统选的策略。Doris 官方文档把四种方式的开销列得很清楚：

```compare
first: 方式
head: [要搬多少, 什么时候可用]
rows:
  - Broadcast Join:
      - "N × 右表大小（发给每个参与计算的节点）"
      - 右表小到能整份广播，通常配合过滤后的小结果集
  - Partition Shuffle Join:
      - "左表 + 右表都要搬"
      - 通用等值 join，两侧都大时的默认选择
  - Bucket Shuffle Join:
      - "只搬右表"
      - 左表本来就按 join 列分桶
  - Colocate Join:
      - "0"
      - 两张表按同一列、同一规则预先落在同一批节点
```

`N` 是参与计算的实例数（可以理解为节点或分片数）。四种方式对数据分布的要求依次变严，命中时省下的网络也依次变多。

### 倾斜：最慢的那个节点决定结束时间

上图的节点 C 分到了约 6500 万行订单（热门 `user_id` 的订单几乎都落在一个分区），其余三个加起来才 3500 万。即使 A、B、D 早就跑完了，整个任务还是要等 C —— 这就是 join 倾斜。常见来路之一是热门 `user_id`，比如平台自营账号、测试账号。

Spark 的自适应执行（AQE，Adaptive Query Execution）会在运行时识别这种分区：分区大小超过 256MB，且大于中位数的 5 倍时，把它拆成更小的任务（必要时复制另一侧的数据）。这类优化默认开启，但它处理的是「已经倾斜」；真正减少数据量还是得靠过滤和预聚合。

## 07 · 先过滤：省了哪几笔，没省哪几笔

把条件写上，是很自然的改法：

```sql
SELECT
    o.order_id,
    o.user_id,
    u.user_name,
    o.amount
FROM orders o
JOIN users u
  ON o.user_id = u.user_id
WHERE o.pay_time >= CURRENT_DATE - INTERVAL '7 days'
  AND o.status = 'PAID';
```

`WHERE` 写在 `JOIN` 后面，但优化器通常会在语义允许时把条件下推到扫描节点（谓词下推）。执行计划里，它显示成扫描节点上的 `Filter`，而不是 join 之后再补一刀。

关键在于：**下推让扫描节点少吐出一些行，不等于少读一些页。**

PostgreSQL 官方文档的例子说得很清楚：给 `Seq Scan` 加一个 `WHERE unique1 < 7000`，输出行数从 10000 降到 7000，但扫描仍然要访问全部 10000 行，成本没降，反而因为多了一次条件判断略微升高。要真的少读页，得有索引或分区裁剪。

所以两版查询的账要分开记：

```compare
first: 这一笔
head: [不带过滤, 只取最近 7 天已支付]
rows:
  - orders 参与 join 的行:
      - 1 亿
      - 约 200 万（示意）
  - orders 被读的页:
      - 全部
      - 有 pay_time 的索引或分区才减少；只加 WHERE 仍读全表
  - probe 次数:
      - 1 亿
      - 约 200 万
  - 输出行数:
      - 约 1 亿
      - 约 200 万
  - users 侧:
      - 扫描 5000 万行建哈希表
      - 可能仍然是 5000 万行
  - 后续排序 / 聚合 / 网络:
      - 按 1 亿量级
      - 按 200 万量级
```

```callout
tone: red
icon: ⚠
text: |
  ==订单过滤到 200 万行，不代表 users 不会被全扫。==

  普通哈希连接仍然要先把 users 整张建成哈希表。订单变少，省下的是 probe 次数、输出行数和后续处理；users 那 5000 万行该读还得读。
```

想让 users 侧也少读，常见三条路：

```cards
cols: 3
items:
  - title: 让内层走唯一索引
    tag: NLJ
    tone: green
    body: |-
      外层只剩 200 万条订单时，改成嵌套循环 + `users.user_id` 主键查找：查 200 万次，每次几次页访问，只读命中的那些页。
      代价是 200 万次随机 I/O，订单再大就不划算了。
  - title: 先从订单提出 user_id 集合
    tag: 子查询去重
    tone: amber
    body: |-
      先把 7 天订单的 `user_id` 去重，再去查 users。
      ==是否真省，取决于执行计划==：如果数据库仍选择整表建哈希表，这一步只是多写了几行 SQL。
  - title: 动态过滤 / Bloom Filter
    tag: 执行时才知道
    tone: violet
    body: |-
      先用订单侧的 `user_id` 造一个过滤器（Doris 叫 Runtime Filter），推到 users 的扫描节点：不在集合里的行直接丢掉。
      Bloom Filter 只能确定「一定不存在」，不能确定「一定存在」，最后还要精确比一次 key。
```

Doris 的 Runtime Filter 文档给了另一种结构：不能静态改写成 `IN` 列表时（集合是运行时才知道的），在 join 节点收集 key、生成 Bloom Filter、下推到扫描节点，分布式下还要先在 Manager 上合并成全局过滤器。文档里同一个例子：orders 1 亿行、customer 10 万行，先按国家过滤 customer，再让 orders 的扫描用上过滤器。

## 08 · 为什么有索引也可能不走

「有索引」只说明存在一条可走的路，不说明它便宜。

PostgreSQL 的成本模型把这件事量化了：`seq_page_cost` 默认 1.0，`random_page_cost` 默认 4.0。顺序读一页算 1，随机读一页算 4。走索引取一行，通常要读索引页，再回表读数据页，这些是随机访问；如果查询要碰表里的大部分页，顺序扫一遍整张表反而更便宜。

文档在同一节里写了两面：回表读行「比顺序读贵得多」，但**当不需要访问整张表的所有页时**，它仍然比全表扫描便宜。决定性的是「要访问的页占多大比例」，不是「有没有索引」。

MySQL 从 8.0.18 起支持哈希连接。官方博客的说法是：有可用索引时倾向走嵌套循环 + 索引查找；等值连接且没有可用索引时，才用哈希连接。8.4 手册补充了一点：单表谓词上有索引时，哈希连接也照样可能被选中。

```compare
first: 算法
head: [它怎么花时间, 适合什么形状, 什么时候反而更贵]
rows:
  - Nested Loop:
      - 外表每行 → 内层查一次索引
      - 外表过滤后很小，内层 join 列有高效索引
      - 外表仍有上亿行 → 上亿次随机查找，比顺序扫一遍贵
  - Hash Join:
      - 两侧各扫一遍，build 建表，probe 逐行查
      - 等值连接，两侧都大，或 join 列没有合适索引
      - 内存装不下 → 分批落盘，成本跳一档
  - Merge Join:
      - 两侧按 key 排序，再归并
      - 两侧已经有序（索引顺序、已排序的中间结果）
      - 大表重新排序，同样可能落盘
```

「小表驱动大表」也不是无条件成立：它的完整版本是「过滤后行数少的一侧做驱动，且被驱动侧的 join 列有可用索引」。驱动表的细节在[另一篇](../mysql-join-driver/)里讲透了，这里只需要记住：==优化器比的是总成本，不是关键字，也不是有没有索引==。

## 09 · 怎么确认它真的在全量扫

不能从 SQL 文本猜。看执行计划，再看实际行数。

MySQL 的哈希连接，用 `EXPLAIN FORMAT=TREE` 看结构最清楚；传统 `EXPLAIN` 只在 `Extra` 里写一句 `Using join buffer (hash join)`。

```sql
EXPLAIN FORMAT=TREE
SELECT
    o.order_id,
    o.user_id,
    u.user_name,
    o.amount
FROM orders o
JOIN users u
  ON o.user_id = u.user_id;
```

```text
-> Inner hash join (o.user_id = u.user_id)
    -> Table scan on o          ← probe 侧：1 亿行
    -> Hash
        -> Table scan on u      ← build 侧：5000 万行
```

输出形状是示意的，但结构就是手册里的那种：`Hash` 下面那一支是 build 侧，另一个子节点是 probe 侧。

计划里这几个信号分别回答一个问题：

```compare
first: 看到什么
head: [它在说什么, 下一步看哪里]
rows:
  - Table scan / Seq Scan 出现在两张表上:
      - 两张表都没走索引，按全量读
      - 过滤条件能不能配索引或分区
  - Hash 下面那一支:
      - 哪一侧被建成哈希表（先读的那侧）
      - 这一侧的估算行数是否和实际接近
  - rows × filtered:
      - 优化器估算「进入 join 的行数」
      - 和 `EXPLAIN ANALYZE` 的实际行数差多少
  - "Using join buffer (hash join)（MySQL）":
      - 传统 EXPLAIN 的 Extra 列，走了哈希连接
      - "`join_buffer_size` 够不够这侧装下"
  - "partitions=1/14（Doris explain）":
      - 分区裁剪生效，只扫了一部分
      - 过滤条件是否命中分区键
  - "runtime filters: RF000[bloom]（Doris）":
      - 动态过滤器已下推到扫描节点
      - 看 Profile 里 filtered / input 的比例
```

`rows` 是估算值，`filtered` 是表条件过滤后的百分比 —— 两者相乘才是优化器认为参与 join 的行数。估算依赖统计信息，批量写入之后没更新统计，估算可能差几个数量级，驱动侧和算法都跟着选错。

```callout
tone: violet
icon: 🔎
text: |
  ==看计划要成对看：估算行数 + 实际行数。==

  只有估算时，看到的是优化器的想法；加上 `ANALYZE` 才是这次真跑了多少行。两者差得远，先更新统计信息，再谈调参数。
```

## 10 · 能改的六件事

按「先改数据，再改计划，最后改参数」的顺序排：

```compare
first: 做法
head: [它省掉哪一笔, 什么情况下不奏效]
rows:
  - 先过滤（日期、状态、业务范围）:
      - 参与 join 的行、probe 次数、输出、网络
      - 过滤列没有索引或分区时，表照样整张读
  - 只取需要的列:
      - 每行宽度、哈希表大小、传输量
      - 大字段本身要参与过滤时躲不开
  - 先按 join key 聚合再 join:
      - 一对多相乘、重复求和
      - 聚合要先把子表扫一遍；但这一遍是固定的
  - 给 join 列和过滤列建索引 / 分区:
      - 实际读的页数
      - 选择性差（要读大部分页）时优化器仍选全扫
  - 看清基数关系（1:1 / 1:N / N:N）:
      - 对输出行数的预期
      - 统计信息过期时估不准
  - 小表驱动 / 广播小表:
      - 扫描次数、Shuffle 数据量
      - 两侧都大时没有小表可广播
```

参数（`work_mem`、`join_buffer_size`）排在最后，因为它只影响「装不装得下」，不减少要处理的行。把 1 亿行塞进内存，它还是 1 亿行。

这篇只回答一个问题：为什么「没筛就关联」既慢又容易算错，以及慢在机器的哪一层。相邻的三篇：

- [JOIN 的六种语义](../sql-join-six-types/)：哪些行被保留
- [JOIN 的执行：驱动表与连接算法](../mysql-join-driver/)：谁先读、内层怎么找
- [宽表拆分里的 Join 与列分布](../wide-table-split-semantics/)：分桶、colocate 与分布
- [一条 SQL 的执行流程](../mysql-sql-execution-flow/)：从解析、优化到执行器

```summary
title: 一句话
text: |
  全量 join 的代价不是某一个算子造成的，是**行数在每一层被重新走了一遍**：读页、建表、探测、输出、Shuffle。
  先让参与配对的行变小，再谈算法和参数。
```

````popquote
label: 这次的问答原文
sub: 第一轮问答 · 摘录
tone: violet
note: 原文摘录：保留结论、例子与数字，重复的展开段落做了压缩。原文里两处 [6] [7] 引用标记没有对应的可访问来源，正文只采用能核对到官方文档的部分。
text: |
  #### 问

  什么是大表全量 join，举例子。

  #### 答

  **大表全量 Join** 通常不是指 SQL 里的 `FULL OUTER JOIN`，而是指：

  > 两张（或多张）数据量很大的表，在没有充分过滤、裁剪字段或预聚合的情况下，直接把大量甚至全部数据拿来做关联。

  这会造成大量扫描、网络 Shuffle、内存/磁盘消耗，查询很慢；如果关联关系是一对多或多对多，还可能造成行数急剧膨胀。

  ##### 例子 1：两张大表不加条件直接关联

  假设 `orders` 1 亿行、`users` 5000 万行，直接按 `user_id` 关联。如果不加时间、状态等过滤条件，数据库可能需要扫描 `orders` 的 1 亿行、扫描 `users` 的 5000 万行、根据 `user_id` 对两张大表进行匹配、排序或 Hash 分布，并生成大量关联结果。

  如果你其实只需要「最近 7 天已支付订单」，却没有提前过滤，就白白关联了大量历史订单和无效数据。核心思想是**先过滤，再 Join**。

  ##### 例子 2：订单明细和支付记录直接 Join，导致数据膨胀

  一个订单有多条商品明细，也可能有多条支付记录。订单 `1001` 有两条明细（100、200）和两笔支付（150、150）。直接 join 再 `GROUP BY` 聚合，2 行 × 2 行会变成 4 行：

  ```text
  商品金额：100 + 100 + 200 + 200 = 600   -- 实际应为 300
  支付金额：150 + 150 + 150 + 150 = 600   -- 实际应为 300
  ```

  正确做法是先把两张子表分别按 `order_id` 聚合，再与订单主表 join。

  ##### 常见优化原则

  1. 先过滤，再 Join
  2. 只取需要的字段，避免 `SELECT *`
  3. 先聚合，再 Join
  4. 给关联字段建索引 / 分区
  5. 注意 Join 的基数关系：一对一、一对多、多对多
  6. 小表驱动大表
````

```quiz
- q: 「大表全量 join」和 FULL OUTER JOIN 是一回事吗？
  a: |
    不是。FULL OUTER JOIN 决定「配不上的行留不留」；全量 join 说的是「参与配对的行没有被先筛小」。
    一句 INNER JOIN 完全可以全量，一句 LEFT JOIN 也可能只碰几十行。
- q: 两张一对多的表直接 join 再 SUM，为什么会翻倍？加 DISTINCT 行不行？
  a: |
    2 条明细 × 2 笔支付 = 4 行，每条明细和每笔支付都被复制了一遍，SUM 把同一笔金额累加了两次。
    SUM(DISTINCT) 也不行：它会把金额相同的两条明细算成一条。正确做法是每张子表先按 join key 聚合到一行，再 join 主表。
- q: orders 加了「最近 7 天」的条件，users 还会被全扫吗？为什么有索引也可能不走？
  a: |
    可能。普通哈希连接仍然要先把 users 整张建成哈希表；订单变少省的是 probe 次数、输出和后续处理。
    有索引也可能不走，是因为优化器比总成本：走索引要随机读索引页再回表，随机 I/O 单价高于顺序读
    （PostgreSQL 默认 seq_page_cost 1.0、random_page_cost 4.0）；要碰表里大部分页时，顺序扫一遍更便宜。
```
