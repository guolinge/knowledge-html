你在圈选页点一下「查询」，**0.2 秒**后看到「共 53,208 人」。

中间发生了什么？SQL 打在哪些表上？数据怎么被找出来的？

这篇把底下那层全部摊开：**15 张表**、每张表干什么、它们之间怎么连、一次查询怎么从界面走到 Doris 再走回来。

```callout
tone: blue
icon: 🎯
text: |
  **读完你应该能回答**：

  - 这个系统里有几张表？哪些能改、哪些不能？
  - 「年龄」这个筛选项，最终打在 Doris 的哪张表、哪一列？
  - 为什么同一个人，用两种方式问「持不持有半导体」，答案不一样？

  ==这是一张**数据地图**，不是 API 文档。==
```

---

## 01 · 15 张表，分成两半

```compare
first: 维度
head: [MySQL `crm_dc`（10 张）, Doris `crm_insight`（5 张）]
rows:
  - 是什么: ["**配置** —— 有哪些字段、叫什么、怎么筛，外加预设和快照任务", "**数据** —— 真正的人、持仓、开通产品，和冻下来的名单"]
  - 谁写: ["Data Admin（运营在界面上配）", "离线任务灌进来（`doris/seed.mjs`），快照由任务写"]
  - 谁读: ["后端读进内存，缓存 5 秒", "每次查询都真去扫"]
  - 改一行会怎样: ["界面跟着变（最多 5 秒）", [{ text: "数字跟着变，界面不变", tone: amber }]]
  - 量级: ["几十行", "100 万 ~ 133 万行"]
  - 丢了会怎样: ["界面空了", "人都查不出来"]
```

```callout
tone: violet
icon: 💡
text: |
  ==这两半的性质完全不同，这是理解整个系统最重要的一条。==

  MySQL 那边是**定义**：你可以随便改，改完界面就变。
  Doris 那边是**事实**：改它就是在改数据本身。

  一次圈选查询 = **拿 MySQL 的定义，去 Doris 里筛事实。**
```

### 1.1 先看 MySQL 这 6 张「配置表」

```arch
svg: data-map-config
caption: 左边三本是字典，只被引用；右边三张是字段表，引用列都长在这一侧。图上一本字典只画一条边，×N 是真实引用数。
```

**逐张看：**

```cards
cols: 1
items:
  - title: crm_dc_portrait —— 特征字典（40 行 × 32 列）
    tag: 中心
    tone: violet
    body: |
      ==界面上能选到的每一个画像字段，这里都有一行。==

      32 列里，**参与映射的就这几组**，其余是运维信息（谁改的、什么时候改的、口径说明、负责人）：

      | 列 | 连到哪 / 干什么 | 例子 |
      |---|---|---|
      | `field_key` | **DSL 里的字段名**，代码引用它 | `age` |
      | `column_name` | **物理表的列名**（NOT NULL —— 这一版没有派生列了） | `birthday` |
      | `data_source_id` | → `crm_dc_data_source.id` | `1` |
      | `business_domain_id` | → `business_domain.id` | `70` |
      | `variable_type` / `data_type` | 候选还是范围 / 值的基础类型 | `enum` / `string` |
      | `content_type` | 业务分类：0 普通、1 日期、2 时间、3 金额……10 推广位 | `7`（城市） |
      | `value_encoding` | 日期在这一列上怎么存 | `native_date` |
      | `enum_type` + `enum_content` | 候选值来源（none/custom/value_set/dynamic 四选一）+ 内嵌候选 | `custom` |
      | `value_set_id` | → `crm_dc_value_set.id`（仅 value_set 用） | `32` |
      | `value_resolver_key` | 动态候选的解析器（仅 dynamic 用） | `stock_search` |

      真实的 `age` 那一行：

      ```json
      { "field_key": "age", "column_name": "birthday",
        "variable_type": "range", "data_type": "long", "content_type": 0,
        "value_encoding": "native_date", "data_source_id": 1,
        "display_name_i18n": {"zh-CN":"年龄","en":"Age","zh-HK":"年齡"},
        "business_domain_id": 70, "status": 1 }
      ```

  - title: crm_dc_relation —— 关系字典（2 行 × 33 列）
    tag: 客体长在本行
    tone: blue
    body: |
      一行一条关系，**客体的 13 个 `object_*` 列直接长在本行上**：

      | 列 | holding 的值 |
      |---|---|
      | `relation_key` | `holding`（DSL 里的名字） |
      | `object_name` / `object_column_name` | `stock` / `object_id` |
      | `object_enum_type` | `dynamic` → `object_value_resolver_key = stock_search` |
      | `data_source_id` | → `rel_holding` |

      ==「这条关系连到什么东西」不用再往下查子行== —— 上一版客体是关系下面的子项，
      这一版它是本体行自己的列。

  - title: crm_dc_relation_attr —— 关系属性字典（3 行 × 25 列）
    tag: 靠 relation_id 挂
    tone: green
    body: |
      | 行 | 挂在哪 | 落在哪一列 |
      |---|---|---|
      | `market` | `relation_id` → holding | `rel_holding.market`（值集 market） |
      | `qty` | `relation_id` → holding | `rel_holding.qty`（无值集） |
      | `status` | `relation_id` → product | `rel_product.status`（内嵌选项） |

      唯一索引是 `(relation_id, field_key)` —— ==属性的名字空间属于关系==，
      两个关系可以有同名属性。

  - title: crm_dc_data_source —— 逻辑名 → 物理表（3 行 × 8 列）
    tag: 8 列
    tone: blue
    body: |
      | source_key | table_name |
      |---|---|
      | `user_portrait` | `user_portraits_wide` |
      | `holding` | `rel_holding` |
      | `product` | `rel_product` |

      ==这张表存在的意义：**代码永远不写物理表名**。==
      表改名 / 迁库 / 拆表，改这一行就够。

      代码里引用的是 `source_key`，物理表名只有到这里才知道。

  - title: 操作符 —— 不入库了
    tag: 代码常量
    tone: amber
    body: |
      上一版这里有一张 `crm_dc_operator` 表（30 行，「类型 → 操作符」）。

      这一版==没有这张表==。一个字段能用哪些操作符由它自己的形状算
      （`applicableOps`，按 `variable_type` / `data_type` / `content_type`）；
      操作符的**名字和顺序**在代码常量 `OPERATOR_DISPLAY` 里（15 个，三语）。

      数值 9 个、枚举/字符串 6 个、布尔 3 个；日期/时间再追加相对时间那几个。

  - title: crm_dc_value_set —— 共享值集（2 行 × 10 列）
    tag: 复用
    tone: muted
    body: |
      | set_key | 值 | 谁在用 |
      |---|---|---|
      | `city` | 10 个城市（`440300` 停用未删） | `city`、`open_city` 两个字段 |
      | `market` | `HK` `US` `JP` | 关系属性 `market` |

      候选存成 `enum_content` **数组**，每项自带 `value / label / status / sortOrder`。
      和字段上内嵌的 `custom` 候选的区别：
      ==值集是**多个字段共用**的，改一处全都变。==
```

### 1.2 再看四张「另一条线」的表

```callout
tone: muted
icon: 📋
text: |
  配置表之外，MySQL 里还有**预设两张 + 快照任务两张**，它们不参与字段映射：

  | 表 | 行数 | 干什么 | 关键列 |
  |---|---|---|---|
  | `dsl_preset_category` | 6 | 首页卡片墙的页签 | `category_key`、`name_i18n` |
  | `dsl_preset` | 30 | 一张预设卡片 = 一份圈选草稿 | `query_json`（比较值可空）、`staff_id` |
  | `snapshot_job` | 22 列 | 一次快照任务 | `sql_text`（当时编出来的 SQL）、`query_json`、`status`、`doris_job_id` |
  | `snapshot_log` | 6 列 | 任务的逐条事件 | `snapshot_id` → `snapshot_job.id`、`event`、`message` |

  `snapshot_log.snapshot_id` 指向 `snapshot_job.id`，预设的 `category_id` 指向分类表 ——
  加上字段表的那些引用，全库 ==`FOREIGN KEY` 仍然是 0 条==，全是约定。

  ==`snapshot_job` 记了 `sql_text` 和 `query_json`。== 意思是：快照跑完之后，
  即使元数据改了，你也能回头看出「当时是用什么条件、什么 SQL 建的名单」。
```

### 1.3 Doris 那 5 张

```arch
svg: data-map-landing
caption: 配置里的两样东西分别落到 Doris —— data_source 给关系表名，字段表给列名。
```

**`user_portraits_wide` —— 宽表，45 列，100 万行**

「宽」的意思是：**一个人的所有信息都在同一行里**。

````callout
tone: green
icon: ✅
text: |
  **45 列按业务域分成 5 组，分组定义就在 `crm_dc_business_domain` 里：**

  | 业务域 | 列数 | 都有什么 |
  |---|---|---|
  | `identity` 身份 | 7 | `birthday` `gender` `region` `nationality` `language` `occupation` `city` |
  | `account` 账户 | 8 | `register_time` `kyc_level` `risk_level` `account_status` `has_hk_account` `has_us_account` `vip_level` |
  | `asset` 资产 | 12 | `aum_hkd` `aum_usd` `cash_hkd` `securities_hkd` `fund_nav_hkd` `margin_debt_hkd` `net_transfer_30d/90d` `peak_aum_1y` `last_deposit_time` `hold_semiconductor` `hold_count` |
  | `trade` 交易 | 7 | `trade_count_30d/90d` `trade_amount_30d` `last_trade_time` `hk/us/options_trade_count_30d` |
  | `service` 服务 | 6 | `last_touch_time` `last_call_time` `last_meet_time` `follow_count_30d` `nps_score` `complaint_count_1y` |
  | | **40** | |

  **另外 5 列是身份/归属**，故意不暴露成筛选项：

  ```
  uid · customer_name · staff_id · staff_name · group_id · group_name
  ```

  ==`uid` 是整张大宽表的主键，也是所有关系表对上的钥匙。==
````

```compare
first: 数
head: [多少, 说明]
rows:
  - 宽表实际列: ['45', '含 6 个身份/归属列']
  - 可筛的列: ['39', "45 − 6 —— 这才是界面下拉框里的项数"]
  - 元数据 portrait 行: ['40', '40 行里有一条是停用的']
  - 停用的那条: ['1', "`open_city`（`status=0`）—— 而且**宽表里根本没有这一列**"]
  - 两侧对账: [{ text: "✅ 40 − 1 = 39", tone: green }, '元数据启用的 = 宽表可筛的']
```

```callout
tone: amber
icon: ⚠
text: |
  **`open_city` 值得看一眼。**

  它在元数据里挂着一个 `column_name = 'open_city'`，
  但==`user_portraits_wide` 里根本没有这一列==。

  之所以没炸，是因为它 `status = 0`（停用）—— 没人会去查它；
  而且重读缓存时的 `assertMetadataRows` 只查引用关系和类型，不查「列在不在 Doris 里」。

  ==也就是说：元数据**可以**指向一个不存在的列，只要它是停用的。==
  如果哪天有人在 Data Admin 里把它启用，查询会当场报「列不存在」。
```

**`rel_holding` / `rel_product` —— 两张关系表**

```compare
first: 表
head: [列, 行数, 一行代表什么]
rows:
  - "`rel_holding` 持仓": ["`uid` `object_id` `market` `qty` `last_trade_date`", "1,328,471", "**某个人持有某个标的**"]
  - "`rel_product` 开通产品": ["`uid` `object_id` `status` `opened_at`", "1,138,855", "**某个人开通了某个产品**"]
```

真实数据（抽几行）：

```text
rel_holding                             rel_product
uid      object_id   market  qty        uid      object_id     status
10001    09618.HK    HK      500        10001    US_ACCOUNT    ACTIVE
10001    AMD.US      US      120        10029    OPTION        ACTIVE
10029    SEMI        US      80         10049    MARGIN        ACTIVE
```

````callout
tone: blue
icon: 🔑
text: |
  **关系表和宽表靠什么对上？`uid`。**

  ```
  user_portraits_wide.uid  ←──→  rel_holding.uid
                           ←──→  rel_product.uid
  ```

  一个人 → 宽表 1 行，关系表 **N 行**（持有几个标的就有几行）。

  ==这就是为什么「查持有 AMD 的人」不能用 JOIN —— 会把人变成 N 行。==
  见第 2 节。
````

**`crm_dc_audience_snapshot` —— 快照落表（0 行）**

```spec
title: crm_dc_audience_snapshot
sub: 建快照时，把名单「冻」在这里
rows:
  - 列: "demo：`snapshot_id` `snapshot_date` `snapshot_minute` `user_id`"
  - 干什么: "点「创建快照」时，把当时的 UID 全量写进来"
  - 为什么: "圈选条件是活的 —— 明天数据变了，名单就变了。快照是**当时那一刻的名单**"
  - 保留: "方案：15 个自然日（D-14 至 D），`encrypt_uid` 密文列、日分区；本机 demo 收成 5 分钟分钟分区，列还是明文 `user_id`"
  - 现在: "0 行 —— 还没人建过快照"
```

还有一张 `insight_uid_job_meta` —— 任务状态迁到 MySQL 之前的**遗留表**，建表脚本还在、代码只留了一个 LEGACY 常量，不再使用。

---

## 02 · 一次查询，数据是怎么走完的

```seq
title: 点一次「查询」发生的事
participants:
  - { id: fe, label: 圈选界面, sub: browser }
  - { id: be, label: 后端, sub: "127.0.0.1:8787" }
  - { id: my, label: "MySQL crm_dc", sub: "配置" }
  - { id: do, label: "Doris", sub: "crm_insight" }
messages:
  - { from: fe, to: be, label: "POST /api/preview　条件树 JSON", kind: sync, note: ① 条件树 }
  - { from: be, to: my, label: "读 6 张配置表（缓存 5 秒）", kind: sync, note: ② 拿字典 }
  - { from: my, to: be, label: "Catalog（39 字段 + 2 关系 + 3 属性）", kind: reply }
  - { from: be, to: be, label: "编译：条件树 → SQL", kind: self, note: ③ 编译 }
  - { from: be, to: do, label: "countSql / listSql / uidsSql", kind: sync, note: ④ SQL }
  - { from: do, to: be, label: "人数 + 一页名单", kind: reply, note: ⑤ 结果 }
  - { from: be, to: fe, label: "count / rows / SQL 原文", kind: reply }
gap: 0
segments:
  - { from: 1, to: 3, label: 缓存过期才重读 }
  - { from: 4, to: 5, label: 真去扫 Doris }
```

### 2.1 编译这一步：三种条件，三种写法

界面上的每个条件，编译出来的 SQL **形状完全不同**：

```compare
first: 条件类型
head: [界面长什么样, 编译成什么, 打在哪个表]
rows:
  - 普通列: ["地区 = 美国", "`u.region = 'US'`", "`user_portraits_wide`"]
  - 换算字段: ["年龄 ≥ 18", "`u.birthday <= '2008-09-30'`（用今天倒推，条件落在裸列上）", "`user_portraits_wide`"]
  - 关系·明细: ["持有 AMD 且市场=美国", "`u.uid IN (SELECT uid FROM rel_holding WHERE …)`", "**`rel_holding`**"]
  - 关系·次数: ["持仓 ≥ 5 笔", "`u.uid IN (SELECT uid FROM rel_holding WHERE … GROUP BY uid HAVING COUNT(*) >= 5)`", "**`rel_holding`**"]
  - 关系·反向: ["不持有 AMD", "`NOT EXISTS (SELECT 1 FROM rel_holding WHERE rel.uid = u.uid AND …)`", "**`rel_holding`**"]
```

````callout
tone: violet
icon: 💡
text: |
  **注意「关系」那三行用的不是 JOIN，是子查询。**

  为什么？因为 `rel_holding` 里一个人有 N 行。用 JOIN 的话：

  ```sql
  SELECT u.uid FROM user_portraits_wide u JOIN rel_holding r ON r.uid = u.uid
  WHERE r.object_id = 'AMD.US'
  ```

  持有 3 个标的人会**出现 3 次**，`COUNT(*)` 数的是行不是人。

  ==所以编译器一律写成 `uid IN (子查询)` 或 `NOT EXISTS` —— 从根上不会重复。==

  这和你平时手写 SQL 的直觉不一样，但在这里是对的。
````

**一步步看 SQL 怎么长出来**（点「下一步」）：

```demo
widget: stepper
title: 条件树 → SQL
actions: false
hint: 点步骤看 SQL 怎么长
config:
  steps:
    - label: 起点
      code: "SELECT u.uid FROM user_portraits_wide AS u"
      note: 只有一张宽表。还没有任何条件。
    - label: "① 普通列"
      code: "WHERE u.region = 'US'"
      note: "直接读列名。元数据说 region 的 column_name 就是 region。"
    - label: "② 换算字段"
      code: "AND u.birthday <= '2008-09-30'"
      note: "年龄在表里不存在。元数据说 column_name=birthday，换算注册表说 age 按年算 —— 编译器用今天倒推出日期上界，条件落在裸列上。"
    - label: "③ 关系条件"
      code: "AND u.uid IN (\n  SELECT rel_holding.uid FROM rel_holding\n  WHERE rel_holding.object_id IN ('AMD.US')\n    AND (rel_holding.market = 'US')\n)"
      note: "换成子查询。表名 rel_holding 来自 crm_dc_data_source，客体列和属性列来自关系两三张字段表。"
    - label: 包一层
      code: "SELECT COUNT(*) FROM (\n  <上面那一段>\n) AS t"
      note: "countSql 外面套一层：把「人数」定义成「uidsSql 这个集合的大小」。它不去重 —— 不去重靠的是关系条件走子查询、不产生重复行。"
    - label: 发出去
      code: "-- 真实结果\ncount = 53,208\nusedTables = ['rel_holding', 'user_portraits_wide']"
      note: "两张表都被用到了 —— 后端记录了它碰过哪些表。"
```

### 2.2 数据怎么被「找」到

```flow
grid: true
legend: true
nodes:
  - { id: start, label: "① 拿宽表当全集", sub: "100 万行", row: 0, tone: blue }
  - { id: f1, label: "② 画像条件先筛", sub: "region = US", row: 1, tone: green }
  - { id: f2, label: "③ 关系条件再筛", sub: "uid IN (子查询)", row: 2, tone: violet }
  - { id: f3, label: "④ 权限范围", sub: "staff_id / group_id", row: 3, tone: amber }
  - { id: out, label: "最终名单", sub: "53,208 个 uid", row: 4, tone: green }
  - { id: rel, label: "rel_holding", sub: "132 万行", row: 1, tone: violet }
  - { id: sub, label: "子查询：筛出符合条件的人", sub: "SELECT uid WHERE object_id='AMD.US'", row: 2, tone: violet }
edges:
  - { from: start, to: f1 }
  - { from: f1, to: f2 }
  - { from: f2, to: f3 }
  - { from: f3, to: out, anim: true }
  - { from: rel, to: sub, label: "读这张表" }
  - { from: sub, to: f2 }
```

```callout
tone: amber
icon: ⚠
text: |
  **注意「权限范围」那一步 —— 它不在界面上，是后端偷偷加的。**

  界面上你只看到「客户范围：本人 / 指定团队 / 全部」。
  编译时它会变成 `WHERE staff_id = 301` 之类的谓词，**直接写进 SQL**；
  范围越权时整次查询直接被拒绝（`SCOPE_DENIED`），不默默裁剪。

  ==所以圈选页永远查不出不属于你的人的名单 —— 不是前端拦的，是 SQL 里就没有。==
```

### 2.3 `uid`：唯一的钥匙

```cards
cols: 3
items:
  - title: 宽表里
    tag: 主键
    tone: blue
    body: |
      ```
      uid = 10001
      ```

      **1 行** —— 这个人的全部信息。

  - title: 关系表里
    tag: 一对多
    tone: violet
    body: |
      ```
      uid = 10001  object_id = 09618.HK
      uid = 10001  object_id = AMD.US
      uid = 10001  object_id = SEMI
      ```

      **N 行** —— 持有几个就有几行。

  - title: 快照表里
    tag: 冻结
    tone: green
    body: |
      ```
      snapshot_id = 7  user_id = 10001
      snapshot_id = 7  user_id = 10002
      ```

      **每个快照里各一份** —— 同一个 uid 可以有多个快照。
```

---

## 03 · 同一件事，两种存法 —— 而且答案不一样

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**「这个人持不持有半导体？」这个问题，系统里有两种存法，而且答案对不上。**==
```

**存法 A：宽表里的一列**

```sql
SELECT COUNT(*) FROM user_portraits_wide WHERE hold_semiconductor = 1;
-- 229,424
```

**存法 B：关系表里的一行**

```sql
SELECT COUNT(DISTINCT uid) FROM rel_holding WHERE object_id = 'SEMI';
-- 63,458
```

**两边都有**

```sql
SELECT COUNT(*) FROM user_portraits_wide w
WHERE w.hold_semiconductor = 1
  AND w.uid IN (SELECT uid FROM rel_holding WHERE object_id = 'SEMI');
-- 44,465
```

```compare
first: 口径
head: [人数, 从哪来的]
rows:
  - 宽表布尔列: ["**229,424**", "`user_portraits_wide.hold_semiconductor`"]
  - 关系表某一行: ["**63,458**", "`rel_holding` 里 `object_id='SEMI'` 的那些行"]
  - 两边都满足: ["**44,465**", "两个口径的交集"]
```

```callout
tone: violet
icon: 💡
text: |
  **三个数字都「对」，但它们回答的不是同一个问题。**

  | 问法 | 答案 |
  |---|---|
  | 「画像上标了持半导体的人」 | 229,424 |
  | 「持仓表里有 SEMI 这条记录的人」 | 63,458 |
  | 「两个都算的人」 | 44,465 |

  ==差在哪？== 宽表那列是**离线任务算出来的标记**，
  关系表那些行是**交易系统里真实的持仓记录**。

  两边的更新时间不同、口径不同、覆盖范围也不同。
```

```callout
tone: amber
icon: ⚠
text: |
  **这不是 bug，是 `seed.mjs` 故意造的。**

  它的注释写着：

  > portraits/relations are sparse and **sometimes disagree**
  > （画像标记 ≠ 关系表，账户开通 ≠ 画像布尔）

  ==真实系统里也这样。== 只要同一件事有两条数据链路，
  迟早会出现两个口径。这个 demo 把它提前摆到你面前。
```

**所以选哪个？**

**该这么问：**

```checklist
items:
  - 要「按业务事实筛」（真的持有了）→ 用关系表
  - 要「按画像标记筛」（系统给他打的标）→ 用宽表列
  - 要「两个都成立」→ 两种条件同时加
```

**别这么想：**

```checklist
tone: cross
items:
  - 以为两个数字应该一样
  - 在两个页面各用一种口径，然后对不上账
  - 把其中一个当成「另一个的加速版」
```

---

```summary
title: 三句话
text: |
  **15 张表分两半。** MySQL 那 10 张是定义（配置 6 + 预设 2 + 任务 2），改完界面 5 秒内就变；
  Doris 那 5 张是事实，就是数据本身。三张字段表用引用列把两边接起来。

  **一次查询 = 拿定义去筛事实** —— 画像条件变成 `WHERE 列`，关系条件变成 `uid IN (子查询)`，
  ==一律不用 JOIN，因为关系表里一个人有 N 行。==

  **同一件事可以有两种存法。** 持半导体的人数，宽表说 229,424、关系表说 63,458。
  ==这不是错，是两个口径 —— 用之前先想清楚你要问的是哪个。==
```

```quiz
- q: "「年龄 ≥ 18」这个条件，最终打在 Doris 的哪张表、哪一列？"
  a: |
    `user_portraits_wide` 表的 `birthday` 列。

    元数据里 `field_key='age'` 那行的 `column_name` 是 **`birthday`** ——
    ==表里根本没有 age 这一列==。换算规则在代码注册表（`pageValue.ts`）里：
    `age: { kind: 'years' }`，编译器用今天倒推出 `birthday <= '2008-09-30'`。

    表名来自 `crm_dc_data_source.table_name`（`data_source_id=1` → `user_portrait` → `user_portraits_wide`）。

- q: "「持有 AMD 的人」为什么不用 JOIN 写？"
  a: |
    因为 `rel_holding` 里一个人有 N 行。JOIN 之后持有 3 个标的的人会出现 3 次，
    `COUNT(*)` 数的是**行**不是**人** —— 人数会偏大。

    ==编译器一律写成 `u.uid IN (SELECT uid FROM rel_holding WHERE …)`。==

    副作用：`IN` 子查询里有 N 行也不会让外层重复。

- q: "元数据里有一条 `open_city`，为什么查它不报错？"
  a: |
    因为它 `status = 0`（停用），没人会去查它。

    ==但 `user_portraits_wide` 里根本没有 `open_city` 这一列== ——
    元数据挂了一个不存在的列。谁在 Data Admin 里把它启用，查询就会当场报「列不存在」。

    这说明元数据的写入方**没有校验列是否真的存在**，只在查询时才暴露。
```
