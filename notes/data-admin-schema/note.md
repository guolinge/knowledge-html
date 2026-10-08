圈选页上「年龄」这一项，来自 MySQL 里 `crm_dc_data_field` 表的**第 22 行**：

```json
{ "id": 22, "field_key": "age", "column_name": "birthday", "field_type": 1,
  "semantic_type": 4, "value_source_type": 0, "data_source_id": 1, "business_domain_id": 70 }
```

这一行说：界面上叫 `age`，物理列是 `birthday`（年龄靠生日算），类型是数值，候选值不需要配，所在数据源 id=1，界面分类挂 id=70。

`field_key=age` 和 `column_name=birthday` 不一样。==这一行本身就是一份「翻译表」。==

```callout
tone: blue
icon: 🎯
text: |
  **这篇拆的是《客群洞察技术方案》4.1 的数据模型**：

  - 每张表为什么单独存在？它装的东西换到别的表放不下吗？
  - 表与表之间靠什么连？连得牢不牢？
  - 哪些接口读哪张表？同一张表为什么会被读成两种形状？

  数据取自本机跑着的 `crm_dc` 实例和仓库的 `metadata/schema.sql`，行数、列数、索引都是数出来的。
```

---

## 01 · 这批表装的是「能筛什么」，不是「筛出来的人」

一张表如果装的是人，那它得有 `uid`。这 7 张表 ==一列 UID 都没有==。

```compare
first: 维度
head: [这 7 张表（MySQL crm_dc）, 人本身（Doris）]
rows:
  - 装什么: ["**有哪些条件可以选**：字段叫什么、落在哪张表哪一列、能用哪些操作符、候选项有哪些", "每个人的画像值、持仓行、交易行"]
  - 谁写: ["运营在 Data Admin 里配，或者数据同学直接插", "离线任务灌进来"]
  - 谁读: ["圈选组件（渲染界面）、SQL Builder（拼列名）", "DAL 执行 SQL 时才读"]
  - 一条记录对应: ["一个**可选项**", "**一个人**"]
  - 量级: ["47 行字段、30 行操作符", "百万行起"]
  - 改一行会怎样: ["界面上的选项跟着变", "筛出来的人数跟着变"]
```

所以 4.1 这 7 张表是一本**字典**。圈选查询做的事，是拿这本字典里的名字去 Doris 里换成人。字典本身不参与筛选。

圈选条件里出现的每一个名字（`age`、`holding`、`city`、`gte`），都得在这 7 张表里的某一行上找到对应。找不到，编译就报 `UNKNOWN_FIELD`。

---

## 02 · 7 张表分成两条线

```arch
svg: admin-schema
caption: 左边 5 张是一条线，右边 2 张是另一条线。两条线之间没有任何一列相连。
```

图上有两处值得先记住：

- 中间那张 `crm_dc_data_field` 是主表，==左边四张都是给它查字典用的==，每一张对应它身上的一个引用列。
- 最下面那条虚线打给 `crm_dc_operator`，标签写的是 `semantic_type 值相等`。它不是外键，后面 06 节单独说。

右边那两张（预设）和字段表**没有任何关系**。一张预设卡片里存着一份圈选草稿，但草稿里引用的字段名是以 JSON 字符串形式存在里面的，不构成表间引用。

```compare
first: 线
head: [回答的问题, 5 张 / 2 张分别是什么, 用在哪个页面]
rows:
  - 字段线: ["**能筛什么**", "`data_source` `data_field` `business_domain` `operator` `value_set`", "圈选页的条件区"]
  - 预设线: ["**从哪开始筛**", "`dsl_preset_category` `dsl_preset`", "客群洞察首页的卡片墙"]
```

---

## 03 · 主表：一张表装三种东西

`crm_dc_data_field` 里同时住着画像特征、关系、关系子项。靠 `field_type` 区分：`1=PORTRAIT`、`2=RELATION`、`3=RELATION_ITEM`。

关系子项不是独立一段数据：它挂在某个关系下面，靠 `parent_id` 指回本表的 `id`。实例里长这样：

```tree
- label: holding
  sub: "id=62  field_type=2  parent_id=0"
  note: 关系本体。这一行没有列名，它代表「一张关系长表」
  tone: violet
  children:
    - label: object_id
      sub: "id=63  item_role=1  column_name=object_id"
      note: OBJECT（对象）—— DSL 里的 `objects` 数组落在这个列上
    - label: market
      sub: "id=64  item_role=2  column_name=market"
      note: PROPERTY（属性）—— 市场
    - label: qty
      sub: "id=65  item_role=2  column_name=qty"
      note: PROPERTY（属性）—— 数量
- label: product
  sub: "id=66  field_type=2  parent_id=0"
  note: 第二条关系，同一套结构再来一遍
  tone: violet
  children:
    - label: object_id
      sub: "id=67  item_role=1"
      note: 注意：**同一个 field_key**，挂在另一个父项下
    - label: status
      sub: "id=68  item_role=2"
```

`object_id` 这个名字出现了两次（id=63 和 id=67），谁都不冲突：子项的 `field_key` 只在 !!自己所属的那个关系里!! 唯一。

### 三种东西凭什么能挤一张表

它们要填的列大部分是同一批：`field_key`、`semantic_type`、`value_source_type`、`status`、`business_domain_id`。拆成三张表，这些列要复制三份，而 DSL 解析时又得先看类型再决定去查哪张表。

代价是「哪些列该填」变得依赖另外两列。方案把这张约束表直接摆了出来，一行负责一种形态：

```compare
first: 形态
head: [parent_id, item_role, column_name, expr, semantic_type]
rows:
  - PORTRAIT 直连: ["= 0", "NULL", "必填", "NULL", "必填"]
  - PORTRAIT 派生: ["= 0", "NULL", { text: "NULL", tone: amber }, "必填", "必填"]
  - RELATION: ["= 0", "NULL", { text: "两列都不能填", tone: red }, { text: "两列都不能填", tone: red }, { text: "NULL", tone: amber }]
  - RELATION_ITEM 直连: ["> 0", "必填", "必填", "NULL", "必填"]
  - RELATION_ITEM 派生: ["> 0", "必填", { text: "NULL", tone: amber }, "必填", "必填"]
```

`column_name` 和 `expr` 是**二选一**：直连字段填列名，派生字段填表达式。关系本体那一行两列都不能填。它不是某个列，代表的是一张表。

```callout
tone: violet
icon: 🔍
text: |
  `parent_id` 这一列有个容易看错的地方：它的值是 `0`，不是 `NULL`。

  `0` 在这里读作「**我不是谁的子项**」。同一批表里 `crm_dc_business_domain.parent_id` 也用 `0`，
  但那里的 `0` 读作「我是顶级域」。两处都是 `0`，含义不同，看表的时候按表的约定读。
```

### 唯一索引管不住那条最重要的规则

`crm_dc_data_field` 上有一个联合唯一索引：

```sql
UNIQUE KEY `uk_source_parent_field` (`data_source_id`, `parent_id`, `field_key`)
```

它管得住「同一个父项下的子项名字不重复」。但方案里还有三条更严的规则：

```text
PORTRAIT 的 field_key      在全部画像特征里唯一
RELATION 的 field_key      在全部关系里唯一
RELATION_ITEM 的 field_key 只在同一个 parent 内唯一
```

前两条，这个索引 !!管不住!!。因为 PORTRAIT 的 `parent_id` 都是 0，只要两条画像落在不同的 `data_source_id` 上，索引就会放行，而规则要求它们全局唯一。

所以方案明写了这句：这三条由 Data Admin 写入时校验，不做成数据库唯一索引。`DUPLICATE_FIELD_KEY` 这个错误码就是这条规则的出口。

---

## 04 · 四张查字典的表

```compare
first: 表
head: [被谁指着, 真实行, 为什么不能并进主表]
rows:
  - "`data_source`": ["`data_field.data_source_id`", "3 行：`user_portrait→user_portraits_wide`、`holding→rel_holding`、`product→rel_product`", "同一个物理表会被很多字段共用，表名只维护一份"]
  - "`business_domain`": ["`data_field.business_domain_id`", "7 行：`futu` 底下挂 `identity` `account` `asset` `trade` `service`，另有一个停用的 `legacy`", "它自己是一棵树（`parent_id` + `domain_path`），字段只是挂到某个节点上"]
  - "`value_set`": ["`data_field.value_set_id`", "2 行：`city`、`market`", "**同一条值集合会被多个字段共用** —— 实例里 `city` 和 `open_city` 两个字段的 `value_set_id` 都是 32"]
  - "`crm_dc_operator`": [{ text: "没有任何列指着它", tone: amber }, "30 行", "操作符按**语义类型**共用，不按字段配"]
```

`data_source` 那张表只有 6 列，其中 `source_key` 是个逻辑标识、`table_name` 是物理表名。DSL 里从来不会出现 `source_key`，它是给服务端在字段和物理表之间搭桥用的。

方案里还有一条写死的规定：

> 所有可接入 Data Source 必须以 `uid` 作为用户关联键。这个列名不入库，编译和关联都按 `uid` 写死。

`uid` 不在任何一张表里，也不在任何一列上。它是编译器里的一个常量。

### 值集合为什么值得单独一张表

把它和字段表里的 INLINE 值放一起看就清楚了。`city` 这张集合的真实内容（`value_mapping` 列）：

```json
{
  "SZ":     { "label": { "zh-CN": "深圳", "en": "Shenzhen" }, "status": 1, "sortOrder": 10 },
  "GZ":     { "label": { "zh-CN": "广州", "en": "Guangzhou" }, "status": 1, "sortOrder": 20 },
  "440300": { "label": { "zh-CN": "深圳", "en": "Shenzhen" }, "status": 0, "sortOrder": 100 }
}
```

外面那层 key 就是 DSL 里传的值，`status` 在条目级别，`440300` 已经停用了却还留在 JSON 里。用户归属地和用户开户地都指向 `set_key=city`，城市只维护一份，==这就是它单独成表的原因==。

对比 `market` 只有 3 个值（港股/美股/日股），但它同样有第二个消费者，所以也是共享集合。真正用 INLINE 的是「客户评级 A/B/C」这种只属于一个字段的短列表。

### 操作符为什么不按字段配

`crm_dc_operator` 的唯一键是 `(semantic_type, operator_key)`，不是字段 id：

```sql
UNIQUE KEY `uk_type_operator` (`semantic_type`, `operator_key`)
```

30 行真实数据按语义类型散开：数值 9 个、日期 8 个、枚举 6 个、字符串 4 个、布尔 3 个。字符串类型的那 4 个是 `eq` `neq` `is_null` `is_not_null`。

一个字段要用哪些操作符，查法是「这个字段的 `semantic_type` 是几 → 去 operator 表取这个类型下所有 ENABLED 的行」。没有 `field_id` 这一跳。

```callout
tone: amber
icon: ⚖
text: |
  方案把这条取舍写明了：同一 `semantic_type` 下的字段共用一组操作符，以后如果要按字段收窄，
  再加一张 `crm_dc_field_operator`。本期没有这张表。

  这条取舍有个直接后果：**新增一种操作符要先改编译器，再往表里插一行**。
  所以 Admin API 里操作符只有 GET / PATCH / status，没有 POST —— 服务端不让人凭一条 SQL 就造出一个编译器不认识的操作符。
```

---

## 05 · 预设的 2 张表

首页卡片墙是另一条线：`crm_dc_dsl_preset_category` 管页签，`crm_dc_dsl_preset` 管卡片。卡片里最关键的列是 `query_json`，存的是一份**圈选草稿**。

```journey
- tag: ① 运营配置
  tone: violet
  name: crm_dc_dsl_preset
  badge: 存在这一行里
  badgeTone: ok
  fields:
    - { k: id, v: "12" }
    - { k: name_i18n, v: "大额净转出预警" }
    - { k: query_json, v: "{...草稿...}", note: 比较值可以留空, tone: warn }
  note: 草稿里的叶子允许只选字段不填值，等使用的人到了页面上再填。
- tag: ② 用户点开
  tone: blue
  name: 圈选页
  badge: 只读一次
  badgeTone: muted
  fields:
    - { k: scope, v: "self" }
    - { k: include, v: "…" }
  next: "填进编辑器 :: :: 之后不再回写"
- tag: ③ 用户改了条件
  tone: muted
  name: 这一行没有变
  badge: 不回写卡片
  badgeTone: red
  fields:
    - { k: query_json, v: "还是原来的草稿" }
  note: 用户改完直接查询、建快照。这一次执行的条件抄在 `snapshot_job.query_json` 上，跟卡片无关。
```

所以 `query_json` 和 DSL 不是一回事：DSL 要求比较值必须有且类型确定，草稿允许留空。两者用同一套结构，草稿是它的宽版本。

---

## 06 · 表与表之间：6 条引用，0 个外键

把整个 schema.sql 数一遍：`FOREIGN KEY` 出现 !!0 次!!。所有引用都是约定，而不是数据库约束。

```compare
first: 从 → 到
head: [靠哪一列, 数据库管吗, 谁在管]
rows:
  - "`data_field` → `data_source`": ["`data_source_id`", { text: "不管", tone: amber }, "写入时校验数据源存在"]
  - "`data_field` → `data_field`": ["`parent_id`（自引用）", { text: "不管", tone: amber }, "写入时校验父行是 RELATION、子项与父行的 `data_source_id` 一致"]
  - "`data_field` → `business_domain`": ["`business_domain_id`", { text: "不管", tone: amber }, "写入时校验域存在"]
  - "`data_field` → `value_set`": ["`value_set_id`", { text: "不管", tone: amber }, "写入时校验集合存在；停用集合时还要检查有没有 ENABLED 字段在引用它"]
  - "`data_field` → `crm_dc_operator`": [{ text: "没有列", tone: red }, { text: "不管", tone: amber }, "两边 `semantic_type` **值相等**"]
  - "`dsl_preset` → `dsl_preset_category`": ["`category_id`", { text: "不管", tone: amber }, "写入时校验分类存在"]
```

最后一行那条「没有列」的引用是这份模型里唯一一处隐式关联。它不是笔误：`data_field` 里没有 `operator_id`，两边也从来不需要互指。一个字段的行为由它的类型决定，而类型相同的字段共用同一批操作符。

没有外键的代价，全部转成了服务层的错误码和前置检查：`UNKNOWN_DATA_SOURCE`、`UNKNOWN_PARENT`、`SOURCE_IN_USE`、`VALUE_SET_IN_USE`、`OPERATOR_IN_USE`。这些都是「数据库本来可以替你拦、但这里选择自己拦」的地方。

下面这个可以自己走一遍。左边是当前这一行用哪些列指着别处，右边是谁指着它：

````demo
widget: schema-walk
title: 顺着列名走一遍这 7 张表
actions: false
config:
  start: city
  hint: |
    ==点左边或右边的任意一张卡，就从那一头接着往下走==，走出来的路径记在上面的面包屑里。
    卡片底下的灰字写的是「靠哪一列连过去的」。
  jump:
    vs-city: 两个不同字段指向同一个值集合
    op-string: 唯一一条不靠列连过去的边
    holding: 从画像字段换到关系
    object_id: 关系子项，注意它的 field_key 在别的关系里也出现过
    pp: 换到预设那条线，看看它跟字段表有没有关系
  records:
    - id: city
      table: crm_dc_data_field
      title: city
      sub: PORTRAIT · ENUM · VALUE_SET
      fields:
        - [id, 33]
        - [field_key, city]
        - [field_type, "1（PORTRAIT）"]
        - [column_name, city]
        - [semantic_type, "1（ENUM）"]
        - [value_source_type, "2（VALUE_SET）"]
        - [value_set_id, 32]
        - [business_domain_id, 70]
        - [data_source_id, 1]
        - [status, "1（ENABLED）"]
      note: 一个普通画像字段，三种字典各指向一次。
    - id: open_city
      table: crm_dc_data_field
      title: open_city
      sub: PORTRAIT · ENUM · **已停用**
      off: true
      fields:
        - [id, 76]
        - [field_key, open_city]
        - [value_set_id, 32]
        - [business_domain_id, 71]
        - [status, "0（DISABLED）"]
      note: 已经停用了，行还在表里，指向的值集合也还是同一个 32。
    - id: vs-city
      table: crm_dc_value_set
      title: city
      sub: 10 个 key，其中 1 个停用
      fields:
        - [id, 32]
        - [set_key, city]
        - [value_mapping, "{ SZ, GZ, …, 440300 }"]
        - [status, "1（ENABLED）"]
      note: 里面的 `440300` 自己那条 `status` 是 0，但 key 留在 JSON 里没删。
    - id: holding
      table: crm_dc_data_field
      title: holding
      sub: RELATION · 关系本体
      fields:
        - [id, 62]
        - [field_key, holding]
        - [field_type, "2（RELATION）"]
        - [parent_id, 0]
        - [column_name, "NULL"]
        - [semantic_type, "NULL"]
        - [data_source_id, 2]
      note: 关系本体这一行没有列名、没有类型。它代表的是一张关系长表。
    - id: object_id
      table: crm_dc_data_field
      title: object_id
      sub: RELATION_ITEM · OBJECT
      fields:
        - [id, 63]
        - [parent_id, 62]
        - [item_role, "1（OBJECT）"]
        - [column_name, object_id]
        - [semantic_type, "5（STRING）"]
        - [value_source_type, "3（DYNAMIC）"]
        - [value_resolver_key, stock_search]
      note: DSL 里的 `objects` 数组就落在这条子项的列上。它是动态候选，所以要一个解析器。
    - id: market
      table: crm_dc_data_field
      title: market
      sub: RELATION_ITEM · PROPERTY
      fields:
        - [id, 64]
        - [parent_id, 62]
        - [item_role, "2（PROPERTY）"]
        - [column_name, market]
        - [semantic_type, "1（ENUM）"]
        - [value_set_id, 77]
      note: 关系属性也能用值集合，和画像字段走的是同一条取值来源规则。
    - id: vs-market
      table: crm_dc_value_set
      title: market
      sub: 港股 / 美股 / 日股
      fields:
        - [id, 77]
        - [set_key, market]
        - [status, "1（ENABLED）"]
    - id: ds-user
      table: crm_dc_data_source
      title: user_portrait
      sub: 逻辑源 → 物理表
      fields:
        - [id, 1]
        - [source_key, user_portrait]
        - [table_name, user_portraits_wide]
        - [status, "1（ENABLED）"]
      note: 一张宽表装着全部画像列。关联键写死是 `uid`，这个列名不在表里。
    - id: dom-identity
      table: crm_dc_business_domain
      title: identity
      sub: 二级业务域 · 界面归属
      fields:
        - [id, 70]
        - [domain_code, identity]
        - [parent_id, 69]
        - [domain_path, futu/identity]
        - [status, "1（ENABLED）"]
      note: 它自己也是一棵树，`parent_id = 0` 的是顶级域 `futu`。
    - id: ds-hold
      table: crm_dc_data_source
      title: holding
      sub: 逻辑源 → 物理表
      fields:
        - [id, 2]
        - [source_key, holding]
        - [table_name, rel_holding]
        - [status, "1（ENABLED）"]
      note: DSL 里从头到尾看不到 `source_key`。它只在编译时把字段接到物理表上。
    - id: op-string
      table: crm_dc_operator
      title: semantic_type = 5 · STRING
      sub: eq / neq / is_null / is_not_null
      fields:
        - [semantic_type, 5]
        - [operator_key, eq]
        - [input_form, "1（INPUT）"]
        - [value_type, string]
        - [status, "1（ENABLED）"]
      note: 它不知道有哪些字段在用自己，字段也不知道它。两边只对 `semantic_type` 这一个数字。
    - id: pc
      table: crm_dc_dsl_preset_category
      title: churn-defense
      sub: 页签
      fields:
        - [id, 3]
        - [category_key, churn-defense]
        - [status, "1（ENABLED）"]
    - id: pp
      table: crm_dc_dsl_preset
      title: 大额净转出预警
      sub: 一张卡片
      fields:
        - [id, 12]
        - [category_id, 3]
        - [icon, transfer-out]
        - [staff_id, 301]
        - [query_json, "{ version, scope, include, exclude }"]
      note: 整条预设线跟字段表零引用 —— 从这一行往两边看，走不到 `crm_dc_data_field`。
  edges:
    - { from: city, to: vs-city, via: "value_set_id = 32" }
    - { from: city, to: ds-user, via: "data_source_id = 1" }
    - { from: city, to: dom-identity, via: "business_domain_id = 70" }
    - { from: open_city, to: vs-city, via: "value_set_id = 32" }
    - { from: holding, to: ds-hold, via: "data_source_id = 2" }
    - { from: object_id, to: holding, via: "parent_id = 62" }
    - { from: market, to: holding, via: "parent_id = 62" }
    - { from: market, to: vs-market, via: "value_set_id = 77" }
    - { from: object_id, to: op-string, via: "semantic_type 都是 5" }
    - { from: pp, to: pc, via: "category_id = 3" }
````

---

## 07 · 接口和表：同一批表，三种读法

4.1 的接口一共分三组：Metadata（给前端）、Metadata（给 SQL Builder）、Preset（给前端），再加一组 Admin。它们读的是同一批表，取的东西完全不同。

```flow
grid: true
legend: true
groups:
  - { id: db, label: "MySQL crm_dc", tone: violet }
  - { id: svc, label: "服务端组装", tone: blue }
  - { id: use, label: "消费方", tone: muted }
nodes:
  - { id: t, label: "7 张配置表", sub: "字段线 5 张 + 预设线 2 张", row: 0, kind: database, group: db }
  - { id: am, label: "AudienceMetadata", sub: "渲染控件、回显标签", row: 1, tone: blue, group: svc }
  - { id: cat, label: "Catalog", sub: "名字 → 物理列", row: 1, tone: green, group: svc }
  - { id: pre, label: "PresetDetail", sub: "卡片 + 一份草稿", row: 1, tone: violet, group: svc }
  - { id: ui, label: "圈选组件", sub: "/api/audience/metadata", row: 2, kind: frontend, group: use }
  - { id: sb, label: "SQL Builder", sub: "/api/meta/catalog", row: 2, kind: backend, group: use }
  - { id: page, label: "首页卡片墙", sub: "/api/presets", row: 2, kind: frontend, group: use }
edges:
  - { from: t, to: am, label: "去掉物理细节", labelDy: -18 }
  - { from: t, to: cat, label: "补上表名列名", labelDy: -18 }
  - { from: t, to: pre, label: "带上草稿", labelDy: -18 }
  - { from: am, to: ui }
  - { from: cat, to: sb }
  - { from: pre, to: page }
```

这两个 Metadata 投影的差别只有一条，但它是整个模型里最容易被漏掉的一条：

```compare
first: 投影
head: [含不含表名列名, 含不含 DISABLED, 为什么]
rows:
  - "`AudienceMetadata`（→ 圈选组件）": [{ text: "不含 —— 物理细节不下发到浏览器", tone: green }, { text: "含，每条带 status", tone: green }, "回显一条老条件时要能显示已停用对象的名称和 label"]
  - "`Catalog`（→ SQL Builder）": [{ text: "含表名、列名、expr、可用操作符", tone: green }, { text: "只含 ENABLED", tone: red }, "已经停用的字段不该出现在新编译的 SQL 里"]
```

### 接口对表的清单

```compare
first: 接口
head: [读写哪些表, 过滤条件, 返回什么]
rows:
  - "`GET /api/audience/metadata`": ["`data_field` `data_source` `business_domain` `operator` `value_set`（都读）", "两种状态都读", "`AudienceMetadata`：域、按语义类型分组的操作符、features、relations；带 `revision` 哈希"]
  - "`GET /api/audience/value-sets?setKey=`": ["`value_set`", "集合停用也返回 200，便于回显", "一个集合的**全部**取值，每条带 status"]
  - "`GET /api/audience/value-resolvers?resolverKey=`": [{ text: "不读表", tone: amber }, "—", "动态候选，靠 `value_resolver_key` 走到一个解析器，不落库"]
  - "`GET /api/meta/catalog`": ["同上五张", "只收 ENABLED；关系必须恰好有一个 ENABLED 的 OBJECT", "`Catalog`：`universeTable` + fields（带 table/column/expr/ops）+ relations"]
  - "`GET /api/presets`": ["`dsl_preset` `dsl_preset_category`", "启用的分类和卡片", "**不带** `query_json`"]
  - "`GET /api/presets/:id`": ["同上", "停用的预设也返回", "`PresetDetail`，带 `query` 草稿"]
```

Admin 那六个资源里，有一处不对称：

```compare
first: 资源
head: [列表, 新增, 修改, 启停]
rows:
  - 数据源 / 业务域 / 值集合 / 画像 / 关系: ["GET", { text: "POST", tone: green }, "PATCH", "POST …/status"]
  - "`crm_dc_operator`": ["GET", { text: "没有", tone: red }, "PATCH …/{semanticType}/{operatorKey}", "POST …/status"]
```

操作符那一行的「没有」跟 04 节那条取舍是同一件事：表里加一行操作符不难，难的是编译器要认识它。

```callout
tone: violet
icon: 💡
text: |
  接口和表不是一对一。`/api/audience/metadata` 一次读五张表，`/api/presets` 只读两张，
  而 `/api/audience/value-resolvers` 一张表都不读。

  ==所以要回答「这个字段从哪来」，得先问「它在哪个界面元素上」==。同一个 `crm_dc_data_field`，
  在圈选页上是控件，在 SQL 里是列名，在首页卡片上根本不出现。
```

---

## 08 · 停用不是删除

整批表都在用同一个模式：`status TINYINT`，`0=DISABLED`，`1=ENABLED`。没有 DELETE 接口，停用只把这一列改掉，行留在原处。

三个消费方对一条停用数据的反应**各不相同**，这正是「不删除」换来的东西：

```compare
first: 消费方
head: [新建条件时, 回显老条件时, 编译 SQL 时]
rows:
  - 圈选组件: [{ text: "看不到它", tone: amber }, { text: "**看得到**，用同一份结果里的名称和 label", tone: green }, "—"]
  - SQL Builder: ["—", "—", { text: "语义校验直接返回 `DISABLED_REF`", tone: red }]
  - Data Admin 列表: ["看得到，带 status", "看得到", "—"]
```

如果停用等于删行，第二列就没法实现：老条件的回显需要那个名字，而名字已经被删掉了。

两个真实的并存例子：

- `open_city`（id=76）整个字段 `status=0`，行还在 `crm_dc_data_field` 里。
- 值集合 `city` 里的 key `440300` 自己的 `status=0`，key 留在 `value_mapping` 的 JSON 里。

停用还会触发几项前置检查，因为「不删」意味着引用可能仍然存在：停用数据源时如果还有 ENABLED 的画像或关系指向它，返回 `SOURCE_IN_USE`。值集合的判据是同类的引用检查；操作符则换了个判据：停用之后这个语义类型不能一个 ENABLED 操作符都不剩。

```callout
tone: amber
icon: 🔄
text: |
  这批表的默认值是**方向相反**的：`data_field` / `data_source` / `business_domain` / `operator` / `value_set`
  都是 `DEFAULT 0`（新建出来先处于停用），预设那两张是 `DEFAULT 1`。

  后果很具体：Admin 写完一条字段，得再调一次 `/status` 把它启用，否则圈选组件的新建下拉里不会出现它。
```

---

## 09 · 这份模型还在改

本文拆的是 4.1 现在的形态。仓库里另一份文档《圈选数据模型、DSL 与 SQL Builder 技术改造方案》已经提出改动，其中一处正落在这张主表上：

```compare
first: 项
head: [技术方案 4.1, 改造方案]
rows:
  - "`crm_dc_data_field` 列数": ["31 列", "31 列，数量一样、成分不同"]
  - "`physical_type`": [{ text: "有", tone: muted }, { text: "去掉：物理类型统一从 Doris 表结构取", tone: amber }]
  - "`agg_funcs`": [{ text: "无", tone: muted }, { text: "加上：声明这个属性允许做哪些聚合", tone: green }]
  - "`crm_dc_operator`": ["有 `template_i18n`", "不变"]
```

仓库的 `metadata/schema.sql` 目前是**两份文档的混合**：`expr` `display_config` `template_i18n` 已经加进去了（4.1 现在也有），`physical_type` 还在，`agg_funcs` 还没有。以哪一份为准，要在动手实现前定下来。

---

```quiz
- q: 为什么 `crm_dc_data_field` 上的唯一索引拦不住「PORTRAIT 的 field_key 必须全局唯一」这条规则？
  a: |
    因为索引是 `(data_source_id, parent_id, field_key)`。两条画像字段的 `parent_id` 都是 0，
    只要它们的 `data_source_id` 不同，索引就认为不冲突。所以这条规则只能由 Data Admin 写入时校验，
    报 `DUPLICATE_FIELD_KEY`。
- q: "`crm_dc_operator` 是怎么跟字段关联上的？为什么这样设计？"
  a: |
    没有列引用它。字段的 `semantic_type` 去和操作符的 `semantic_type` 对上，值相等就算同一组。
    这样同一类型的所有字段共用一批操作符，不用给「字段 × 操作符」建一张宽表；
    代价是新增操作符必须先改编译器，所以 Admin API 里它没有 POST。
- q: 同一个 `crm_dc_data_field` 表，为什么圈选组件和 SQL Builder 拿到的两份投影不一样？
  a: |
    因为两者的用途不同。圈选组件要渲染选项和回显老条件，所以它需要 DISABLED 的对象和 label，
    但不需要表名列名；SQL Builder 要把名字换成物理列，所以它需要 table/column/expr，
    但已经停用的字段不该再参与新 SQL，所以它只收 ENABLED。
```
