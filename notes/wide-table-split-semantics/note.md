`docs/宽表垂直拆分-NULL语义与查询契约.md` 讨论一件具体的事：把用户画像宽表拆成几张子表之后，同一批圈选条件算出来的**人**会不会变。

圈选的过程是：运营在页面上配条件，前端把条件存成一棵 JSON 条件树，SQL Builder 把它翻译成 SQL，Doris 执行后返回 UID 列表或人数。拆表之前，年龄、地区、交易次数是同一行上的列，条件直接写在一起；拆表之后，一个用户的信息分布在多张表里，SQL 要跨表算。

你卡住的六个词就散在这份文档里。这一页用同一份数据把它们串起来。

```callout
tone: blue
icon: 🎯
text: |
  六个词回答两个不同的问题：

  - **算得对不对**：跨表执行、三值逻辑、UID 集合计算
  - **算得快不快**：物理表与分桶、colocate、Join Hint

  ==前三个决定圈到谁，后三个决定多快。== 分界线是先定语义，再谈物理。
```

---

## 01 · 六个词，先分成两组

```cards
cols: 2
items:
  - title: 决定「圈到谁」的三个词
    tag: 语义
    tone: blue
    body: |
      **跨表执行**：条件分散在多张表里，怎么算成同一批 UID。

      **三值逻辑**：`NULL` 参与比较会得到 `UNKNOWN`，而 `WHERE` 只保留 `TRUE`。

      **UID 集合计算**：`AND` / `OR` / `NOT` 当成集合的交、并、补来算。
  - title: 决定「多快」的三个词
    tag: 物理
    tone: violet
    body: |
      **物理表与分桶**：数据实际存在哪张表、哪个桶里。

      **colocate**：让同一个 uid 在不同表里的数据待在同一台机器上。

      **Join Hint**：绕开优化器，人工指定 join 时数据怎么分发。
```

这两组不是并列关系，是一条链路的前后段。文档里那张图画的正是它：

```lane-stack
- badge: 接入
  title: 页面与条件树
  desc: 运营点出来的条件，序列化成一棵树
  tone: blue
  nodes:
    - { title: 页面配置, sub: "画像 / 关系 / 事件", tag: 前端 }
    - { title: JSON 条件树, sub: "AND / OR / NOT", tag: 协议 }
  next: "序列化 :: :: 选项和值都来自元数据"

- title: 查询契约
  desc: 只规定「缺行算什么」「NULL 算什么」，不写 SQL，也不执行
  tone: amber
  nodes:
    - { title: 缺行与 NULL 语义, sub: "包含 / 排除各自怎么算", tag: 这篇的主角 }
  next: "语义明确 :: :: 编译器照着它生成 SQL"

- title: 编译与执行
  desc: 契约定了，才轮到「怎么算出来」
  tone: green
  nodes:
    - { title: SQL Builder, sub: "条件树 → SQL", tag: 编译 }
    - { title: Doris, sub: "执行查询", tag: 执行 }
    - { title: UID 列表 / 人数, sub: "最终结果", tag: 结果 }
```

契约夹在中间：它不写 SQL，也不执行，只规定「缺行算什么」「NULL 算什么」。两头的组件都照着它做。六个词里，前三个是契约要回答的问题，后三个是契约定完之后才轮到的优化空间。

---

## 02 · 起点：一行数据，被拆到几张表里

这一页后面所有例子都用同一份数据：5 个可圈选用户，一张宽表拆成两张子表。

```text
user_universe（本次可圈选的 UID；后面所有「不满足」「排除」都以它为边界）
  1001  1002  1003  1004  1005

user_portrait（拆表前：一行一个 uid）
uid    age    region   trade_count
1001   26     HK       12
1002   NULL   CN       0
1003   41     NULL     3
1004   NULL   NULL     NULL
1005   35     CN       NULL

拆表后
portrait_base(uid, age, region)        portrait_trade(uid, trade_count)
1001   26   HK                          1001   12
1002   NULL CN                          1002   0
1003   41   NULL                        1003   3
1005   35   CN                          1005   NULL
                                        （1004 两张表里都没有行）
```

（`user_universe` 是这份文档给全集 `U` 起的占位表名，落地时要换成权威的全量 UID 表或等价查询。）

拆表前，1004 有一行，只是三个字段都为空。拆表后，1004 在两张子表里都没有行。

这两件事在 SQL 里长得几乎一样：

```compare
first: 物理形态
head: [业务上可能是什么, SQL 里怎么表现]
rows:
  - "有行，字段是 NULL": ["特征值为空 / 不适用 / 尚未填写", "`field IS NULL` 为真"]
  - "整行缺失": ["没有这个特征 / 数据还没写入", "`LEFT JOIN` 之后右表字段也是 NULL"]
```

SQL 只看得见 NULL，看不见「为什么是 NULL」。文档 §6 专门把这两种拆成两个不同的状态（`VALUE_NULL` 和 `ROW_MISSING`），就是为了让契约能分别规定它们的去向。

---

## 03 · 跨表执行：条件分散在多张表里，怎么算

拆表前，「年龄 ≥ 18 且交易次数 > 0」是同一行上的两个列：

```sql
SELECT uid
FROM user_portrait
WHERE age >= 18
  AND trade_count > 0;
```

拆表后，`age` 在 `portrait_base`，`trade_count` 在 `portrait_trade`，一条 `WHERE` 同时说不了这两件事。跨表执行就是解决这个：把分散在多张表里的条件算成同一个人的集合。

逻辑上分五步：

```demo
widget: stepper
title: 跨表算「年龄 ≥ 18 且交易次数 > 0」
actions: false
config:
  steps:
    - label: ① 定全集
      code: "U = {1001, 1002, 1003, 1004, 1005}\n-- 本次可圈选的 UID"
      note: 后面所有「不满足」「排除」都以它为边界，换一个 U，补集就换一批人
    - label: ② base 表算 A
      code: "SELECT uid\nFROM portrait_base\nWHERE age >= 18;"
      note: "A = {1001, 1003, 1005}：1002 的值是 NULL，判定 UNKNOWN；1004 在这张表里没有行"
    - label: ③ trade 表算 B
      code: "SELECT uid\nFROM portrait_trade\nWHERE trade_count > 0;"
      note: "B = {1001, 1003}：1002 是 0（FALSE），1005 是 NULL（UNKNOWN）"
    - label: ④ 合并
      code: "A AND B  →  A ∩ B\n{1001,1003,1005} ∩ {1001,1003}"
      note: 结果是 {1001, 1003}
    - label: ⑤ 返回
      code: "列表：一页 uid，按 uid 游标翻页\n人数：COUNT"
      note: 参与计数的 uid 要唯一，不然同一个人有多条关系记录会多算；本仓库用 UNIQUE KEY(uid) 保证这一点
```

数据库真正执行时，还有一套物理步骤：

```lane-stack
- badge: 物理执行
  title: 扫描
  desc: 只读这次用得到的列
  tone: muted
  nodes:
    - { title: 读 portrait_base, sub: "uid, age", tag: 列裁剪 }
    - { title: 读 portrait_trade, sub: "uid, trade_count", tag: 列裁剪 }
- title: 下推过滤
  desc: 尽早把不满足的行丢掉
  tone: blue
  nodes:
    - { title: age >= 18, sub: "在扫描阶段就执行", tag: 下推 }
    - { title: trade_count > 0, sub: "同上", tag: 下推 }
- title: 重分布
  desc: 让同一个 uid 的两边数据碰上
  tone: violet
  nodes:
    - { title: 按 uid 分发, sub: "哈希到同一台机器", tag: 网络 }
- title: Join / 集合运算
  desc: 这里是两种路线的分叉点
  tone: amber
  nodes:
    - { title: 交集, sub: "A ∩ B", tag: 结果集 }
- title: 聚合与返回
  desc: 算人数或翻页
  tone: green
  nodes:
    - { title: COUNT, sub: "uid 唯一，直接计数", tag: 人数 }
    - { title: ORDER BY uid, sub: "游标翻页", tag: 名单 }
```

```callout
tone: amber
icon: 🧱
text: |
  ==SQL 的书写顺序不是执行顺序。==

  你写的是 `FROM → JOIN → WHERE`，优化器可能先把两张表各自过滤一遍，再按 uid 关联。
  同一段 SQL 文字，换一个执行计划，结果不变、耗时能差很多。后面三个物理词处理的都是这一段。
```

跨表这件事有两条实现路线，这份文档选了第二条：

```compare
first: 路线
head: [怎么做, 代价]
rows:
  - 先拼成一张宽表再过滤: ["把多张子表按 uid `JOIN` 起来，再写一条宽表 `WHERE`", "要拼临时宽表；稀疏子表的缺行会被 NULL 填满"]
  - 每个条件各算一个 UID 集合，再做集合运算: ["`age >= 18` 查 base 得到一个集合，`trade_count > 0` 查 trade 得到另一个，两个集合求交", "缺行不会被 join 悄悄改写；文档 §8 选的就是这条"]
```

第二条路线为什么更稳，要看下一节和第五节。

---

## 04 · 三值逻辑：SQL 里多出来的 UNKNOWN

SQL 里的 `NULL` 不是 0，也不是空字符串。它表示「不知道」。任何和它做的比较，结果既不是真也不是假，而是第三种值 `UNKNOWN`。

所以一个条件的取值有三种，`AND` / `OR` 也不再是「真假」两个变量的表：

| `A AND B` | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | FALSE | UNKNOWN |
| **FALSE** | FALSE | FALSE | FALSE |
| **UNKNOWN** | UNKNOWN | FALSE | UNKNOWN |

| `A OR B` | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | TRUE | TRUE |
| **FALSE** | TRUE | FALSE | UNKNOWN |
| **UNKNOWN** | TRUE | UNKNOWN | UNKNOWN |

再加一条：`NOT UNKNOWN` 还是 `UNKNOWN`。

自己点一遍看规则：

```demo
widget: tri-logic-lab
title: A、B 取不同值，AND / OR / NOT 各得到什么
actions: false
config:
  a: T
  b: U
```

落到这份数据上，有两个具体的人值得看：

```text
1002：age = NULL
      age >= 18            →  UNKNOWN
      包含条件里不命中

1003：age = 41，region = NULL
      age >= 18            →  TRUE
      region IN ('CN','HK') →  UNKNOWN
      TRUE AND UNKNOWN      →  UNKNOWN
      包含条件里也不出现
```

```callout
tone: violet
icon: 💡
text: |
  `WHERE` 只保留条件为 `TRUE` 的行。`FALSE` 和 `UNKNOWN` 都会被丢掉。

  两者结果一样、原因不一样：一个是「确实不满足」，一个是「不知道满不满足」。
  这一页后面要讲的「排除」，就靠这个区别活着。
```

这也是 ADR 里那句「`NULL` 不当 0」的来处：如果把 NULL 当成 0，上面两个人都变成了「不满足」，看起来结果一样；但一旦做成排除条件，他们就会被错误地排除掉。

拆表之后，这个问题变得更值得较真，因为两种物理形态在 SQL 里会表现成同一个 NULL：

```text
有行、字段为 NULL   →  field IS NULL 为真
整行缺失（缺行）     →  LEFT JOIN 之后右表字段也是 NULL
```

SQL 分不出这两种，业务上却可能是两回事。文档 §6 的做法是把它们在契约里分开登记，而不是让 SQL 去猜。

---

## 05 · 按 UID 集合计算：把条件树当集合代数

圈选只关心「哪些 UID 命中」，所以每个叶子条件都可以先算出一个 UID 集合，条件树再对这些集合做运算：

```text
Match(A AND B) = Match(A) ∩ Match(B)     -- 交
Match(A OR B)  = Match(A) ∪ Match(B)     -- 并
Match(NOT A)   = U − Match(A)            -- 补，相对全集 U
```

拿这份数据试一遍：A = 年龄 ≥ 18 = `{1001, 1003, 1005}`，B = 交易次数 > 0 = `{1001, 1003}`，`A AND B = {1001, 1003}`，和上一节的答案一致。

集合写法真正解决的是「取反」。看两种问法：

```compare
first: 问题
head: [问的是, 得到谁]
rows:
  - 字段比较取反: ["`trade_count` 有值，且那个值不大于 0", "只有 1002"]
  - 集合取反: ["`U` 里不属于「交易次数 > 0」的人", "1002、1004、1005"]
```

差的两个人正是前面那两种物理状态：1004 在子表里没有行（行级写法根本扫不到它），1005 的值是 NULL（`NOT UNKNOWN` 仍是 `UNKNOWN`，被 `WHERE` 丢掉）。

自己跑一遍：

```demo
widget: uid-set-lab
title: 同一个条件，两种取反，结果差两个人
actions: false
config:
  mode: row
```

用 SQL 写出来就是两种形状。左边只在子表里做字段比较；右边先算出命中集合，再拿全集去减：

```sql
-- ① 行级取反：问「有值但不 > 0」
SELECT uid
FROM portrait_trade
WHERE NOT (trade_count > 0);

-- ② 集合取反：问「不属于命中集合」
SELECT u.uid
FROM user_universe u
WHERE NOT EXISTS (
  SELECT 1
  FROM matched t
  WHERE t.uid = u.uid
);
```

文档 §7.2 把这件事说成「不等于不是逻辑补集」，并给出「不等于」在产品上的三种可能含义：

```compare
first: 含义
head: [包含谁, 对应什么形状]
rows:
  - 已知值不等于: ["有行、有值、值 ≠ x", "`field != x`"]
  - 不满足「等于 x」: ["值不等于 + 值 NULL + 缺行", "集合差 `U − Match(field = x)`"]
  - 缺失值先映射为默认值再比较: ["缺行和 NULL 先按字段契约换成默认值，再参与比较", "字段适配器里做 `COALESCE` 或等价处理"]
```

三种结果不一样，所以文档建议在 DSL 里把它们分成两个操作：`NotEq` 保留原义，真正的补集用独立的 `NOT` 节点或集合排除节点。

`NOT IN` 的坑也在这里。写

```sql
WHERE uid NOT IN (1001, 1003, NULL)
```

时，`uid != NULL` 是 `UNKNOWN`，整条条件可能一行都留不下。所以逻辑 `NOT` 要用集合差表达，而不是往列表里塞一个取反。文档补了一句边界：如果两侧 UID 都被保证非空，`NOT IN`、`NOT EXISTS` 和 Anti Join 结果相同，优化器甚至可能生成同一个计划。前提是「保证非空」，不是语法偏好。

这一步在本项目里已经是既成口径。ADR 0001 写的公式是：

```text
U = U_perm ∩ scope
结果 = (U ∩ M) − E
```

`U_perm` 是操作人的数据权限上限，`scope` 是客户范围，`M` 是包含条件命中的集合，`E` 是排除条件命中的集合。全部相对 `U` 计算。

---

## 06 · 物理表、分区、分桶

先区分三个容易混的东西：

```compare
first: 东西
head: [它是什么, 例子]
rows:
  - 物理表: ["真正存数据的表对象，有自己的文件、分区、分桶、副本", "`portrait_base`、`portrait_trade`"]
  - 视图: ["通常只存查询定义，不存数据", "`CREATE VIEW ... AS SELECT ...`"]
  - 逻辑模型 / 语义层: ["面向业务的定义，一个逻辑字段可能对应好几张物理表", "「年龄」映射到 `birthday` 这一列"]
```

分区和分桶也是两件事，文档里把它们的名字放在一起，但解决的问题不同：

```compare
first: 维度
head: [分区（Partition）, 分桶（Bucket）]
rows:
  - 解决什么: ["数据属于哪一段时间", "同一范围内的数据怎么切、放到哪台机器"]
  - 怎么切: ["按范围，例如日期、月份、租户", "按 `hash(分桶键) % 桶数`"]
  - 查询时的效果: ["按分区裁剪，少读几天的数据", "同一个键永远进同一个桶，join 时可能不用搬数据"]
```

本仓库 demo 的建表语句（列数和桶数都是实测）：

```sql
CREATE TABLE crm_insight.user_portraits_wide (
  uid BIGINT NOT NULL,
  ...                       -- 一共 45 列
)
UNIQUE KEY(uid)
DISTRIBUTED BY HASH(uid) BUCKETS 16
PROPERTIES ("replication_num" = "1");

-- 关系表用同一个分桶键、同一个桶数
-- rel_holding / rel_product：DISTRIBUTED BY HASH(uid) BUCKETS 16
```

分桶的规则本身只有一句话：

```text
uid = 1001  ──hash──▶  bucket = hash(1001) % 16  ──▶  桶里的数据（tablet）  ──▶  落在一台 BE
```

BE 是 Doris 的存储与计算节点。桶号由 Doris 自己算，桶的数量建表时定。这四层（文件、分区、分桶、副本）的入门图解见 [`文件、分区、分桶、副本到底是什么`](../doris-storage-anatomy/)。Apache Doris 官方文档对「几个桶」的建议：

```cards
cols: 2
items:
  - title: 桶数取 BE 数量的整数倍
    desc: 数据分布更均匀，不容易倾斜
    tone: blue
  - title: 够用就行，尽量少
    desc: 桶越多 tablet 越多，元数据和扫描任务也跟着多
    tone: green
  - title: 单个 tablet 压缩后 1GB ~ 20GB
    desc: Unique Key 表不超过 10GB；太小会有小数据聚合的开销
    tone: amber
  - title: 2.0 起可以自动分桶
    desc: 按机器资源和集群信息，给每个分区自动定桶数
    tone: violet
```

```callout
tone: violet
icon: 🧭
text: |
  分桶不改变「谁命中条件」，它改变的是「要不要搬数据、搬多少」。

  会改变圈选结果的是另一件事：==拿哪张表当全集 U==。文档 §5.1 专门写了这一条：
  不能任选一张画像子表当 `U`。稀疏子表只保存有该特征的用户，以它为全集，缺行的人会整批消失，而且换一张子表结果还会跟着变。
```

---

## 07 · colocate：让同一个 uid 的数据待在同一台机器上

上一节说，同一个 uid 在两张表里都会进「各自的同一个桶」。但这两张表的**同一个桶号**未必在同一台机器上。

- 分属不同机器的数据要 join，得有一侧先按 uid 重新分发过去，这段网络开销叫 shuffle。
- colocate 就是把两张表按相同的分桶规则放进同一个 Colocation Group，让同一个桶号落在同一台 BE 上，join 在本地就能完成。

切一下开关，看同一个 uid 的两张表数据在哪里：

```demo
widget: dist-lab
title: 4 个桶、4 台 BE，base 和 trade 怎么落
actions: false
config:
  colocate: true
  uid: "1001"
```

（桶号的对应关系是示意的，真实 Doris 用它自己的哈希；这里要看的只是「两张表的同一个桶是否对齐」。）

要让它成立，得同时满足四条（Apache Doris 官方文档）：

```checklist
items:
  - 参与 join 的表在同一个 Colocation Group（建表时 `"colocate_with" = "group_x"`）
  - join key 与分桶列一致（这里是 uid）
  - 桶数一致、副本数一致
  - 组处于稳定状态（`IsStable = true`）
```

```callout
tone: violet
icon: 💡
text: |
  ==同一个组里的表，不要求分区数、分区范围、分区列类型一致。==

  官方文档里明确写了这一条。要一致的是分桶列、桶数、副本数。
  分区管的是「哪段时间的数据」，它不一致，不影响「同一个 uid 落在哪台机器」。
```

确认有没有生效，看这两处：

```sql
-- 看组和它的分布
SHOW PROC '/colocation_group';
-- GroupName / BucketsNum / ReplicationNum / DistCols / IsStable

-- 看计划里 Hash Join 节点是不是 colocate: true
EXPLAIN SHAPE PLAN SELECT ...;
```

组不稳定的时候（比如某台 BE 挂了正在修复），查询会自己降级成普通 join，计划里会写 `colocate: false, reason: group is not stable`。所以「建表时写了 colocate_with」只是一个前提，跑起来要看计划。

本仓库 demo 的建表语句里只有 `HASH(uid) BUCKETS 16` 和 `replication_num = 1`，没有 colocate。要不要上，是文档 §12 那句话决定的事：

```callout
tone: amber
icon: ⚖
text: |
  「按 UID 使用一致分布」是可以作为候选方案的，但 ==没有执行计划和压测数据之前，不能把它写成既定收益==。

  文档列了至少要对比的查询：单字段等值和范围、同表多字段 AND、跨表两条件、高命中率和低命中率 OR、
  基于全集的 NOT、画像与事件/关系/用户群混合。每类记录扫描行数、数据交换量、内存、耗时和执行计划。
```

---

## 08 · Join Hint：人工指定执行方式

join 时右表怎么分发（广播还是按 key 打散），正常由优化器根据统计信息决定。Hint 就是在 SQL 里把这件事写死。

Doris 的写法是写在 join 右侧表的前面，方括号里选分发方式：

```sql
-- 强制 broadcast：把右表复制到所有 BE
SELECT count(*)
FROM t2 JOIN[broadcast] t1
  ON t1.c1 = t2.c2;

-- 也可以用 shuffle，并和 leading hint 一起逐条指定
SELECT /*+ leading(orders shuffle {lineitem shuffle part} shuffle partsupp) */
  ...
```

计划里能看出它到底用了哪种分发：

```text
DistributionSpecReplicated  → broadcast，右表复制到每个 BE
DistributionSpecHash        → shuffle，按 hash key 分发
```

Hint 是 best-effort 的：写错、或者系统没法生成对应的计划，它不报错，能做多少做多少。所以「写了 hint」不等于「hint 生效」，要看 `EXPLAIN`。官方文档对两种分发方式给的建议也很直白：右表小、复制成本低于 shuffle 时用 broadcast；两边都大、按 key 重分布更划算时用 shuffle。

```compare
first: 谁在决定分发
head: [好处, 风险]
rows:
  - 优化器: ["数据量、过滤条件、统计信息一变，它重新选", "偶尔选错，要人看计划才发现"]
  - Hint: ["把某一次压测出来的最优冻结下来", "数据量涨 100 倍后，今天的 broadcast 会变成全量复制的灾难"]
```

推荐的顺序是：

```checklist
items:
  - 先把表设计、分桶、统计信息弄对
  - 用 `EXPLAIN` / Profile 看真实计划和数据分布
  - 确认优化器在同一类查询上稳定选错，再写 hint
  - 把「为什么写它、基于什么数据量、什么条件下回滚」写进设计文档
```

这份文档对它的定位也是最后一位：「物理表如何分桶、是否使用 colocate、具体采用哪种 Join Hint，需要结合 Doris 版本和压测结果另行决定」。三个物理词里，hint 排在最末。

---

## 09 · 回到这份文档：六个词各落在哪

```compare
first: 词
head: [文档里在哪, 它规定了什么]
rows:
  - 跨表执行: ["§2、§4、§13", "画像条件先按字段所在表拆成 UID 子查询，再交给集合组合层；同一张表内的条件仍可以合并成一段 `WHERE`"]
  - 三值逻辑: ["§6、§7.1", "`=`、`>`、`IN` 只匹配有确定值且结果为真的 UID；显式 NULL 和缺行都不命中"]
  - UID 集合计算: ["§8", "`AND` 是交、`OR` 是并、`NOT` 是 `U − Match(P)`；补集用集合差或 Anti Join，不用字段取反"]
  - 物理表与分桶: ["§12", "UID 非空、同一版本内唯一、明确密集表还是稀疏表；分区/分桶/副本/colocate 等压测"]
  - colocate: ["§12", "「按 UID 使用一致分布」是候选方案，不是既定收益"]
  - Join Hint: ["§12", "是否用、用哪种，以执行计划和压测结果为准"]
```

文档 §6 的那棵判定树，就是前面这些规则合起来的形状：

```flow
grid: true
nodes:
  - { id: u, label: 用户全集 U, sub: "逐个 UID 判断", row: 0, kind: database }
  - { id: has, label: 子表里有行吗？, sub: "缺行 / 有行", row: 1, shape: note }
  - { id: missing, label: ROW_MISSING, sub: "整行不存在", row: 2, tone: violet }
  - { id: have, label: 有行, sub: "字段是否为空", row: 2, tone: muted }
  - { id: batch, label: 业务缺失, sub: "按字段契约处理；批次不完整则暂不可判定", row: 3, tone: amber }
  - { id: isnull, label: 字段是 NULL 吗？, sub: "VALUE_NULL / 继续比较", row: 3, shape: note }
  - { id: vnull, label: VALUE_NULL, sub: "有行但值为空", row: 4, tone: violet }
  - { id: cmp, label: 满足比较条件吗？, sub: "字段有值", row: 4, shape: note }
  - { id: match, label: VALUE_MATCH, sub: "有值且命中", row: 5, tone: green }
  - { id: notmatch, label: VALUE_NOT_MATCH, sub: "有值但未命中", row: 5, tone: red }
edges:
  - { from: u, to: has }
  - { from: has, to: missing, label: 无行 }
  - { from: has, to: have, label: 有行 }
  - { from: missing, to: batch, label: 批次完整 }
  - { from: have, to: isnull }
  - { from: isnull, to: vnull, label: 是 }
  - { from: isnull, to: cmp, label: 否 }
  - { from: cmp, to: match, label: 是 }
  - { from: cmp, to: notmatch, label: 否 }
```

ADR 0001 已经把三条口径定下来了：

```callout
tone: green
icon: ✅
text: |
  - `NULL` 不当 0
  - 比较未知时，包含不命中，排除也不命中，人留在结果里
  - 缺行同样不当 0，也不因此把人从 `U` 里拿掉

  ==这三条就是后面所有 SQL 的验收标准。==
```

第三条规则用现成的交互再看一遍：同一个条件放进包含和排除，NULL 行分别会怎样。

```demo
widget: null-lab
title: 把 region = 'HK' 放进包含、或者放进排除
actions: false
config:
  col: region
  matchVal: HK
  rows:
    - { id: 1001, name: 常驻 HK, v: HK }
    - { id: 1002, name: 常驻 CN, v: CN }
    - { id: 1003, name: 地区未知, v: null }
    - { id: 1005, name: 常驻 CN, v: CN }
```

还有几件事文档列进了待确认清单（§5.1、§5.2、§16），它们不再属于「概念」而是决定实现的东西：

```cards
cols: 3
items:
  - title: U 从哪来
    desc: 哪张表或哪条查询？注销、冻结、未完成的用户算不算？
    tone: amber
  - title: 子表是密集还是稀疏
    desc: 缺行是数据异常，还是本身就有业务含义？
    tone: amber
  - title: 「不等于」含不含 NULL
    desc: 以及缺行、默认值怎么映射、实时用户群「为假」是哪种补集
    tone: amber
```

```summary
title: 一句话
text: |
  前三个词决定「圈到谁」，写进查询契约；后三个词决定「多快」，写进物理设计并等压测。
  顺序不能颠倒：==语义没定，性能优化没有验收标准==。
```

```quiz
- q: 「交易次数不等于 0」用 `WHERE trade_count <> 0` 写，为什么会丢人？
  a: |
    两种人都收不到：子表里没有行的（根本扫不到），和值为 `NULL` 的
    （`NULL <> 0` 是 `UNKNOWN`，`WHERE` 只留 `TRUE`）。
    要按「不属于交易次数大于 0 的集合」来算，就得用全集做集合差，例如 `NOT EXISTS`。
- q: colocate 的两张表，分区数必须一致吗？
  a: |
    不要求。官方要求的是同一个 Colocation Group、join key 与分桶列一致、
    桶数和副本数一致、组稳定。分区数、分区范围、分区列类型可以不同。
- q: SQL 里写了 join hint，就一定会按它执行吗？
  a: |
    不一定。Hint 是 best-effort：写错或生成不了对应计划时不报错，
    实际用哪种分发要看 `EXPLAIN` 里的 `DistributionSpecReplicated` / `DistributionSpecHash`。
```
