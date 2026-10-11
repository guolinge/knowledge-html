「join 谁做驱动表」这句话听起来像黑话，拆开是三个问题：

- JOIN 在执行器眼里到底是什么？
- 「驱动表」是哪一侧，由什么决定？
- 「小表驱动大表」里的小，指的是什么？

这篇按这个顺序把执行层讲完。两篇相关笔记先摆在这里：[JOIN 的六种语义](../sql-join-six-types/)讲「哪些行被保留」，[B+ 树索引](../mysql-btree-why/)讲内层查找用到的数据结构。本篇讲它们之下的执行：先读谁、怎么找、优化器怎么挑。

```cards
cols: 4
items:
  - { title: JOIN 的本质, desc: 两两组合，再用 ON 过滤, tag: 01, tone: muted }
  - { title: 驱动表, desc: 嵌套循环的外层，先被读的那侧, tag: 02, tone: blue }
  - { title: 内层怎么找, desc: 索引查找、join buffer、hash join, tag: 03, tone: violet }
  - { title: 谁来选、怎么验证, desc: 优化器的成本模型与 EXPLAIN, tag: 04~06, tone: green }
```

## 01 · JOIN 在执行器眼里是「先相乘，再过滤」

单表查询没有「驱动」可言：数据就在一张表里，按 WHERE 筛完即走。JOIN 出场，是要的字段分散在多张表里：用户名在 `users`，订单金额在 `orders`，得靠 `u.id = o.user_id` 把两边的行对上。

执行器看 JOIN 的方式很朴素：把两张表的行两两组合一遍，再用 ON 条件把配不上的扔掉。

```flow
grid: true
nodes:
  - { id: users,  label: users · 3 行, sub: "id: 1, 2, 3", row: 0, tone: blue }
  - { id: orders, label: orders · 4 行, sub: "user_id: 1, 1, 2, 99", row: 0, tone: violet }
  - { id: product, label: 两两组合 · 12 行, sub: "3 × 4，笛卡尔积", row: 1 }
  - { id: filter, label: "ON `u.id` = `o.user_id`", sub: 12 行挨个过条件, row: 2 }
  - { id: out,    label: 结果 3 行, sub: "user_id = 99 的那行配不上，被扔掉", row: 3, tone: green }
edges:
  - { from: users,  to: product }
  - { from: orders, to: product }
  - { from: product, to: filter }
  - { from: filter, to: out, anim: true }
```

INNER、LEFT、RIGHT 的区别，只是「哪些行被保留」的规则不同（见[语义篇](../sql-join-six-types/)）。规则再怎么变，执行层要面对的是同一个问题：**怎么把配得上的行高效地组合出来**。后面所有内容都在回答它。

## 02 · 嵌套循环：驱动表在这里诞生

MySQL 执行连接的基本形状是嵌套循环。官方手册（10.2.1.7）给的伪代码长这样：

```text
for each row in t1 matching range {
  for each row in t2 matching reference key {
    for each row in t3 {
      if row satisfies join conditions, send to client
    }
  }
}
```

最外层循环里的表就是**驱动表**：执行器先从它取行。里面被反复查找的表叫**被驱动表**。驱动表的每一行，都触发一次对内层表的查找。内层被查多少次，等于驱动侧参与连接的行数。

```cards
cols: 2
items:
  - title: 驱动表（外层）
    tone: blue
    body: |-
      先被读的那张表。它**不是**被遍历完才轮到下一张，而是每取一行就拿着这一行的关联值去内层找匹配，然后回头取下一行。
      在 `EXPLAIN` 输出里排第一行（06 节）。
  - title: 被驱动表（内层）
    tone: violet
    body: |-
      被反复查找的那张表。它决定「每次查找有多贵」：join 列上有索引就是几次页访问，没索引就是一次全表扫描。
      03 节的主角。
```

两个方向都能跑：users 驱动，或者 orders 驱动。差距有多大，取决于两个数：驱动侧的行数、内层单次查找的成本。下面亲手算一次。

```demo
widget: join-driver-lab
title: 拖一拖：两种驱动顺序，两本账
actions: false
config:
  pages: 3
```

交互里能看到两件事。有索引时，总成本几乎只由「谁做驱动」决定：行数少的那侧驱动，内层查找次数就少。把 `orders.user_id` 的索引关掉，users 驱动的方向立刻从「查 1 万次索引」变成「全表扫描 1 万次、每次扫 100 万行」。这时换顺序救不了，==缺的是索引==。

## 03 · 内层怎么找：索引、join buffer 与 hash join

嵌套循环的总成本 ≈ 驱动侧行数 × 内层单次查找成本。上一节的滑块动的是第一个因子，这一节是第二个。

```cards
cols: 3
items:
  - title: Index Nested Loop
    tag: 内层有索引
    tone: green
    body: |-
      内层的 join 列上有索引，每次查找走一遍 B+ 树，几次页访问就能定位到匹配行。
      `EXPLAIN` 里内层表的 `type` 显示为 `eq_ref` 或 `ref`。
  - title: Block Nested Loop
    tag: 没索引 · 8.0.20 前的老路径
    tone: amber
    body: |-
      把驱动侧的一批行缓存进 join buffer（大小由 `join_buffer_size` 控制，默认 262144 字节即 256KB），内层全表扫描一遍就能和缓冲里所有行比对。内层扫描次数 ≈ (S×C)/join_buffer_size + 1（官方公式，S×C 是缓冲里的总字节）。比「每行扫一遍」好，但内层还是被整个翻了好几遍。
  - title: Hash Join
    tag: 没索引 · 8.0.18+
    tone: violet
    body: |-
      等值连接、没有可用索引时的默认选择。先读一侧把 join 列建成哈希表（build），再扫另一侧逐行到哈希表里探测（probe）。哈希表装不下 `join_buffer_size` 就落盘。
      `EXPLAIN` 的 Extra 显示 `Using join buffer (hash join)`。
```

hash join 也有「先读谁」的问题：先读的那侧用来建哈希表，对应嵌套循环里驱动表的位置。`EXPLAIN FORMAT=TREE` 里能看到它：`Hash` 节点下面那一支就是 build 侧。优化器照样要在这两侧里挑一个。

```compare
first: 算法
head: [什么时候用, 内层单次访问的成本, 对「谁驱动」的敏感度]
rows:
  - Index NLJ:
      - 被驱动表 join 列有索引
      - 几次页访问
      - { text: "很高，总成本跟着驱动侧行数走", tone: red }
  - Hash Join:
      - 等值连接 + 没有可用索引（8.0.18 起）
      - build 一遍 + probe 一遍
      - { text: "低，两侧各扫一遍，顺序影响变小", tone: green }
  - BNL（已被取代）:
      - 同上，8.0.20 起 MySQL 移除了 BNL，一律改走 hash join
      - 内层全表扫 (S×C)/join_buffer_size+1 次
      - 低
```

「小表驱动大表」只说了配对的一半。完整的一对是：**小表做驱动 + 大表那一侧的 join 列有索引**。索引缺席时，两本账一样烂，先补索引，再谈顺序。

## 04 · 「小表」指过滤后的行数，不是磁盘大小

「orders 表 1000 万行、users 只有 1 万行，所以 users 驱动」，这个推理在两处可能不成立。第一处是「小」的口径：

```compare
first: 「小」的口径
head: [含义, 靠不靠谱]
rows:
  - 磁盘上的文件小:
      - 和这次查询无关，两次查询之间也不会变
      - { text: "完全不对口", tone: red }
  - 表的总行数少:
      - 查询不带 WHERE 时，勉强等于第三种
      - { text: "只是无过滤条件下的特例", tone: amber }
  - 过滤后参与 JOIN 的行数:
      - WHERE 加 ON 筛完、真正进入循环的行数
      - { text: "优化器看的口径", tone: green }
```

第二处是例子本身。orders 1000 万行，查询带着 `create_time >= 昨天`，只剩 50 行；users 1 万行，条件过滤后剩 8000 行。这个查询里 ==orders 才是小表==：让它驱动，内层只查 50 次；反过来要查 8000 次。

优化器对「过滤后行数」的估算就写在 EXPLAIN 里：`rows`（预计读的行数）乘上 `filtered`（表条件过滤后剩下的百分比）等于参与连接的行数，这是官方手册给出的读法。统计信息越准，这个估算越准，驱动表就选得越对。

```callout
tone: violet
quote: true
text: |
  「小表驱动大表」的完整说法：让**这次查询里过滤后行数少**的一侧做驱动，
  并且**被驱动侧的 join 列有索引**。两侧悬殊时（50 行 vs 8000 行），
  选错方向是几十倍上百倍的差距。
```

## 05 · 驱动表是优化器挑的，不是书写顺序定的

`FROM users u JOIN orders o` 把 users 写在前面，不代表它先被读。优化器会给同一句 SQL 枚举连接顺序、逐个算成本、挑最便宜的。官方手册（10.9.1）说得很直白：可能计划的数量随表数**指数增长**；表少（典型 7~10 张以内）可以接近穷举，表更多时靠搜索深度（`optimizer_search_depth`，默认 62）和剪枝（`optimizer_prune_level`，默认开）把搜索空间压下来。

优化器算成本靠统计信息：表行数、索引区分度、WHERE 条件的选择性。这些信息会过期：大批写入删除之后不跑 `ANALYZE TABLE`，估算就可能差几个数量级，驱动表跟着选反。症状是 EXPLAIN 里的 `rows` 和实际差得离谱。

LEFT JOIN 是例外。右表依赖左表（要保留左表全部行），执行器把右表钉在左表之后读，左表被固定在驱动位。能松绑的只有一种情况：WHERE 里出现对右表列的判断，比如 `WHERE o.status = 'paid'`，右表补出来的 NULL 行必被滤掉，官方把这个条件叫 null-rejected，此时 LEFT JOIN 被改写成 INNER JOIN，连接顺序重新可换。RIGHT JOIN 一进来就被改写成 LEFT JOIN，所以它没有独立的执行问题。

```callout
tone: amber
icon: 🛠
text: |
  真要手动钉顺序：`SELECT STRAIGHT_JOIN ...` 按书写顺序连接。它有代价：
  官方文档明确提醒会禁用 semijoin 改写，可能让索引用不上。
  8.0 里更推荐 `/*+ JOIN_ORDER(t1, t2) */` 这种 hint，只钉顺序、不伤其他改写。
```

## 06 · 动手读 EXPLAIN：顺序就写在输出里

EXPLAIN 输出的行顺序就是 MySQL 读表的顺序。官方手册（10.8.2）原话：先从第一张表读一行，到第二张表找匹配，再到第三张表……所以驱动表是谁，第一行就写着。

```sql
EXPLAIN
SELECT u.name, o.amount
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.city = '北京'
  AND o.create_time >= '2026-10-01';
```

对应的输出（数字是示意）：

```text
id | table  | type | key         | rows | filtered | Extra
1  | users  | ref  | idx_city    | 100  | 100.00   | NULL
1  | orders | ref  | idx_user_id | 80   | 10.00    | NULL
```

```demo
widget: stepper
title: 六步读完这份 EXPLAIN
actions: false
config:
  steps:
    - { label: 第 1 步 · 看顺序, code: "users 在第一行 → 驱动表", note: "输出行顺序 = 读表顺序。这条查询先取北京的用户，再拿每个用户的 id 去 orders 找订单。" }
    - { label: 第 2 步 · 驱动侧行数, code: "users.rows = 100", note: "优化器估计 idx_city 命中 100 行。这就是「过滤后行数」的估算，02 节滑块里动的那个数。" }
    - { label: 第 3 步 · 还有别的条件吗, code: "users.filtered = 100.00", note: "WHERE 里剩下的条件在索引层全部消化，100 行全部进入连接。若 filtered 是 20.00，参与连接的就只有 20 行。" }
    - { label: 第 4 步 · 内层怎么找, code: "orders.type = ref\norders.key = idx_user_id", note: "每次查找走 user_id 索引，就是 03 节的 Index Nested Loop。内层成本从全表扫描降成几次页访问。" }
    - { label: 第 5 步 · 每次找到几行, code: "80 × 10% = 8 行", note: "官方读法：rows × filtered 是该表与下一表连接的行数。orders 每次查找平均贡献 8 行结果。" }
    - { label: 第 6 步 · 盯着 type 阶梯, code: "const > eq_ref > ref\n> range > index > ALL", note: "第一张表是 ALL：全表扫描当驱动。后面的表是 ALL：每取一行驱动表就全扫一遍内层，官方原话是「usually very bad」。Extra 出现 Using join buffer (hash join) 就是这一层没索引。" }
```

8.0.18 之后还有两件趁手的工具：`EXPLAIN FORMAT=TREE` 看树形计划（hash join 的 build 侧就是 Hash 节点下面那支），`EXPLAIN ANALYZE` 真跑一遍并给出每一步的实际行数。估算和实际差得远，就是统计信息该刷新了。

## 07 · 速查：写 JOIN 前过一遍

```checklist
tone: cross
items:
  - 被驱动表的 join 列有索引（没有就先建，顺序无从谈起）
  - 驱动侧的过滤条件能走索引，让 rows 小下来
  - EXPLAIN 第一行是过滤后行数少的那张表
  - rows × filtered 和实际量级一致；差太多先 ANALYZE TABLE
  - LEFT JOIN 是不是想要 INNER（null-rejected 之外，左表被钉在驱动位）
  - 多表 JOIN 时先连选择性强的，别让中间结果先膨胀
```

```summary
title: 一句话收束
text: |
  JOIN 的执行是嵌套循环（没索引时换成 hash join）；驱动表是先读、做外层循环的那一侧，
  由优化器按成本挑、写在 `EXPLAIN` 第一行；「小表」指这次查询里过滤后参与连接的行数；
  它的配对条件是被驱动侧 join 列有索引。四件事一起，才是一句 JOIN 跑得快的全部。
```

## 自测

```quiz
- q: 「驱动表」到底是什么？它由什么决定？
  a: |
    嵌套循环里先被读、做外层循环的那一侧。它的每一行都触发一次对被驱动表（内层）的查找，
    所以内层被查的次数 = 驱动侧参与连接的行数。
    它由优化器按成本挑选，和 SQL 里 FROM 的书写顺序无关；
    在 EXPLAIN 输出里排第一行。LEFT JOIN 的左表被依赖关系钉在这个位置上。
- q: orders 表比 users 表大 100 倍，为什么这个查询里反而该让 orders 做驱动表？
  a: |
    因为「小」看的是过滤后参与 JOIN 的行数，不是表的总行数。
    orders 1000 万行但带着 `create_time >= 昨天` 只剩 50 行、users 过滤后剩 8000 行时，
    orders 驱动内层只查 50 次，反方向要查 8000 次。
    在 EXPLAIN 里对应的读法是 rows × filtered。
- q: 被驱动表的 join 列没索引，把驱动表换一下能救回来吗？
  a: |
    救不回来。没索引时内层每次都是全表扫描，总成本是 n×m 量级，两个方向一样烂。
    交互里关掉 orders.user_id 的索引就能看到 users 驱动方向直接爆炸。
    出路是给被驱动表的 join 列建索引（走 Index Nested Loop），
    或者等值连接场景下让 8.0.18+ 的 hash join 接手（两侧各扫一遍）。
- q: LEFT JOIN 能让优化器拿右表当驱动表吗？
  a: |
    不能。右表依赖左表（左表的行要全部保留），右表永远在左表之后读，左表被钉在驱动位。
    能松绑的情形只有一种：WHERE 里出现对右表列的判断（null-rejected 条件，如 WHERE o.status = 'paid'），
    LEFT JOIN 被改写成 INNER JOIN，连接顺序重新可换。
    RIGHT JOIN 则是一进来就被改写成 LEFT JOIN。
```
