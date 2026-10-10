圈选页上「常驻城市」这一项，来自 MySQL 里 `crm_dc_portrait` 表的**一行**：

```json
{ "field_key": "city", "column_name": "city", "variable_type": "enum", "data_type": "string",
  "content_type": 7, "enum_type": "value_set", "value_set_id": 32, "data_source_id": 1 }
```

这一行说：界面上叫 `city`，物理列也叫 `city`（对比 `age` → `birthday` 这种错位的），类型是字符串枚举，候选值去共享值集合里取，所在数据源是那张画像宽表。

`field_key=city` 是 DSL 里的名字，`column_name=city` 是 Doris 里的列。==这一行本身就是一份「翻译表」。==

```callout
tone: blue
icon: 🎯
text: |
  **这篇拆的是《客群洞察技术方案》4.1 的数据模型**：

  - 每张表为什么单独存在？它装的东西换到别的表放不下吗？
  - 表与表之间靠什么连？连得牢不牢？
  - 哪些接口读哪张表？同一张表为什么会被读成两种形状？

  数据取自仓库的 `metadata/schema.sql` 和本机的 seed 脚本，行数、列数、索引都是数出来的。
```

---

## 01 · 这批表装的是「能筛什么」，不是「筛出来的人」

一张表如果装的是人，那它得有 `uid`。这 8 张配置表 ==一列 UID 都没有==。

```compare
first: 维度
head: [这 8 张表（MySQL crm_dc）, 人本身（Doris）]
rows:
  - 装什么: ["**有哪些条件可以选**：字段叫什么、落在哪张表哪一列、能用哪些操作符、候选项有哪些", "每个人的画像值、持仓行、交易行"]
  - 谁写: ["运营在 Data Admin 里配，或者数据同学直接插", "离线任务灌进来"]
  - 谁读: ["圈选组件（渲染界面）、SQL Builder（拼列名）", "DAL 执行 SQL 时才读"]
  - 一条记录对应: ["一个**可选项**", "**一个人**"]
  - 量级: ["40 行特征、2 行关系、3 行属性", "百万行起"]
  - 改一行会怎样: ["界面上的选项跟着变", "筛出来的人数跟着变"]
```

所以 4.1 这 8 张表是一本**字典**。圈选查询做的事，是拿这本字典里的名字去 Doris 里换成人。字典本身不参与筛选。

圈选条件里出现的每一个名字（`age`、`holding`、`market`、`gte`），都得在这 8 张表里的某一行上找到对应。找不到，编译就报 `UNKNOWN_FIELD`。

---

## 02 · 8 张表分成三条线

```arch
svg: admin-schema
caption: 左边三张是字典，只被引用、不指别人；中间三张是字段表，引用列都长在这一侧；右边两张预设自成一条线，跟字段表零引用。
```

图上有两处值得先记住：

- `crm_dc_relation_attr` 到 `crm_dc_relation` 的那条 `relation_id`，是三张字段表之间==唯一==的一条内部引用。
- 操作符不在图上 —— ==它已经不是一张表了==（04 节单独说）。

```compare
first: 线
head: [回答的问题, 各是哪几张, 用在哪个页面]
rows:
  - 字典线（3 张）: ["**名字对应什么**", "`data_source` `business_domain` `value_set`", "被字段表引用，不直接上界面"]
  - 字段线（3 张）: ["**能筛什么**", "`portrait` `relation` `relation_attr`", "圈选页的条件区"]
  - 预设线（2 张）: ["**从哪开始筛**", "`dsl_preset_category` `dsl_preset`", "客群洞察首页的卡片墙"]
```

预设那两张和字段表**没有任何关系**。一张预设卡片里存着一份圈选草稿，但草稿里引用的字段名是以 JSON 字符串形式存在里面的，不构成表间引用。

---

## 03 · 三张字段表：特征、关系、关系属性

这批表的核心是三张字段表。它们对应圈选条件的三种形状：

```tree
- label: portrait · 特征
  tone: violet
  sub: "一行一个字段"
  note: 「这个人身上有一个值」—— 性别、年龄、总资产都是这个形状
  children:
    - { label: age, sub: "→ birthday · 按生日算年龄", note: "名字和列名对不上的典型" }
    - { label: city, sub: "→ city · 值集 value_set", note: "候选值不在自己身上" }
- label: relation · 关系
  tone: blue
  sub: "一行一条关系，客体长在本行"
  note: 「这个人跟某个东西有一组记录」—— 持仓、开通产品
  children:
    - label: holding
      sub: "本体行自带 13 个 object_* 列"
      note: "object_name=stock、object_column_name=object_id、object_enum_type=dynamic……"
      children:
        - { label: "object_* 客体列", sub: "13 列", note: "「选择标的」这个控件的候选值来源就配在这里" }
- label: relation_attr · 关系属性
  tone: green
  sub: "一行一个属性，靠 relation_id 挂"
  note: 「每条关系记录上还有一个值」—— 市场、数量、状态
  children:
    - { label: market, sub: "relation_id → holding", note: "属性也能用值集" }
    - { label: qty, sub: "relation_id → holding", note: "纯数字，没有值集" }
```

三张表分得干净：==`portrait` 说人，`relation` 说人和东西的连接，`relation_attr` 说单条连接记录上的值==。一条关系只有一个客体，客体列就长在关系行上；属性可能有很多个，才需要单独一张表。

### 拆成三张表，换来了三条真正的唯一索引

这是这次拆表换到的最实在的东西。字段名的唯一性规则有三条， scope 各不相同：

```compare
first: 规则
head: [靠哪个索引管, 索引能管住吗]
rows:
  - 特征的 `field_key` 全局唯一: ["`uk_field_key (field_key)`", { text: "✅ 管得住", tone: green }]
  - 关系的 `relation_key` 全局唯一: ["`uk_relation_key (relation_key)`", { text: "✅ 管得住", tone: green }]
  - 属性的 `field_key` 关系内唯一: ["`uk_relation_field (relation_id, field_key)`", { text: "✅ 管得住", tone: green }]
```

在上一版模型里，这三种身份挤在一张 `crm_dc_data_field` 里靠 `field_type` 区分，三条规则里只有「关系内唯一」能用联合索引表达 —— 「特征全局唯一」这条数据库管不住，只能靠写入时校验。拆成三张表之后，==每条规则都落成了一条真正的唯一索引==，数据库自己就能拦住重名。

写入校验没有因此撤掉：`assertMetadataRows` 还是会把三张表各查一遍重名（`duplicate portrait` / `duplicate relation` / `duplicate relation attr`）。区别是现在它兜底的是导入顺序、批量写入这类索引之外的口子，而不是唯一的防线。

### 属性的名字空间属于关系

`uk_relation_field` 只约束 `(relation_id, field_key)` 这一对。所以两个关系可以有同名属性，互不冲突：

```compare
first: 行
head: [挂在哪条关系下, 落在哪一列]
rows:
  - "`market`": ["holding", "`rel_holding.market`"]
  - "`status`": ["product", "`rel_product.status`"]
```

解析属性永远要两步：先按 `relation_key` 定位关系，再在这条关系自己的属性里按 `field_key` 找列。方案 4.3 的解析表写的就是这个顺序。

---

## 04 · 三本字典表，和一张消失的表

三张字段表身上的引用列，各自指向一张字典：

```compare
first: 表
head: [被谁指着, 真实行, 为什么不能并进字段表]
rows:
  - "`data_source`": ["`portrait.data_source_id`、`relation.data_source_id`", "3 行：宽表 + 两张关系长表", "同一个物理表被很多字段共用，表名只维护一份"]
  - "`business_domain`": ["`portrait.business_domain_id`、`relation.business_domain_id`", "7 行：`futu` 底下挂 `identity` `account` `asset` `trade` `service`，另有一个停用的 `legacy`", "它自己是一棵树（`parent_id` + `domain_path`），字段只是挂到某个节点上"]
  - "`value_set`": ["`portrait.value_set_id`、`relation.object_value_set_id`、`relation_attr.value_set_id`", "2 行：`city`、`market`", "**同一条值集合被多个字段共用** —— `city` 和 `open_city` 两个字段指向同一个 `city` 集合"]
```

`data_source` 只有 8 列，其中 `source_key` 是逻辑标识、`table_name` 是物理表名。DSL 里从来不会出现 `source_key`，它是服务端在字段和物理表之间搭桥用的。

方案里还有一条写死的规定：

> 所有可接入 Data Source 必须以 `uid` 作为用户关联键。编译和关联都按 `uid` 写死。

`uid` 不在任何一张表里，也不在任何一列上。它是编译器里的一个常量。

### 值集合为什么值得单独一张表

`crm_dc_value_set` 只有 10 列，核心是 `data_type` 加一个 `enum_content` 数组。`city` 这条集合的真实内容：

```json
[
  { "value": "SZ", "label": { "zh-CN": "深圳", "zh-HK": "深圳", "en": "Shenzhen" }, "status": 1, "sortOrder": 10 },
  { "value": "GZ", "label": { "zh-CN": "广州", "zh-HK": "廣州", "en": "Guangzhou" }, "status": 1, "sortOrder": 20 },
  { "value": "440300", "label": { "zh-CN": "深圳", "zh-HK": "深圳", "en": "Shenzhen" }, "status": 0, "sortOrder": 100 }
]
```

数组里每一项自带 `status` 和 `sortOrder`。`440300` 已经停用了却还留在数组里 —— 老条件回显时还要用它。用户常驻城市和开户城市都指向 `set_key=city`，城市只维护一份，==这就是它单独成表的原因==。

对比 `market` 只有港股/美股/日股几个值，但它同样有第二个消费者（持有关系的市场属性），所以也是共享集合。真正「只属于一个字段」的候选值不进这张表 —— 那种值用 `enum_type = custom`，直接写在字段自己的 `enum_content` 列里，比如客户评级 A/B/C。

### 操作符不入库了

上一版模型里有一张 `crm_dc_operator` 表：30 行，「语义类型 → 能用哪些操作符」，界面上那个操作符下拉的选项从这里查。这一版把它==整个拿掉了==，替换成两条代码里的规则：

**① 展示信息在 `OPERATOR_DISPLAY` 常量里**（`packages/dsl/src/operators.ts`）。15 个操作符，每个带三语名称、`sortOrder`，相对时间操作符还带模板（「最近 {0} 天」）。

**② 一个字段能用哪些操作符，由字段自己的形状算出来**（`applicableOps`，按 `variable_type` / `data_type` / `content_type` 三个列算）：

| 字段形状 | 算出来的 op |
|-|-|
| `variable_type = enum`，或 `data_type = string` | `eq` `neq` `in` `not_in` `is_null` `is_not_null` |
| `data_type = boolean` | `eq` `is_null` `is_not_null` |
| `data_type = long` / `double` | `eq` `neq` `lt` `lte` `gt` `gte` `between` `is_null` `is_not_null` |
| `content_type = 1`（日期） | 上一行的基础上加 `last_n_days` `before_n_days` |
| `content_type = 2`（时间） | 再加 `last_n_hours` `before_n_hours` |

```callout
tone: amber
icon: ⚖
text: |
  上一版把操作符放进表里，代价是「新增一种操作符要先改编译器，再往表里插一行」；
  这一版连表都省了 —— **改操作符就是改代码发版**，Admin API 里根本没有操作符这个资源。

  换来的是：规则只活在代码里，`applicableOps` 算出来的结果和编译器认的操作符==必然一致==，
  不存在「表里配了一个编译器不认识的操作符」这种配置错误。
  旧版方案里「`unknown operator eqq`」那类投影期报错，随表一起消失了。
```

---

## 05 · 预设的 2 张表

首页卡片墙是另一条线：`crm_dc_dsl_preset_category` 管页签（seed 里 6 个类目），`crm_dc_dsl_preset` 管卡片（30 张）。卡片里最关键的列是 `query_json`，存的是一份**圈选草稿**。

```journey
- tag: ① 运营配置
  tone: violet
  name: crm_dc_dsl_preset
  badge: 存在这一行里
  badgeTone: ok
  fields:
    - { k: category_id, v: → 流失防御 }
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

一张卡片必填 `staff_id`（归属人），但预设列表**不按调用人过滤** —— 所有人看到的卡片墙是同一份。

```callout
tone: amber
icon: 🔤
text: |
  一处文档和代码没对齐的命名：最新方案里分类表叫 `crm_dc_dsl_template_category`，
  仓库的 `metadata/schema.sql` 里叫 `crm_dc_dsl_preset_category`。

  语义是同一张表（`category_key` / `name_i18n` / `sort_order`）。以仓库为准，方案那份是笔误级差异。
```

---

## 06 · 表与表之间：9 条引用，0 个外键

把整个 schema.sql 数一遍：`FOREIGN KEY` 出现 !!0 次!!。所有引用都是约定，而不是数据库约束。

```compare
first: 从 → 到
head: [靠哪一列, 数据库管吗, 谁在管]
rows:
  - "`portrait` → `data_source`": ["`data_source_id`", { text: "不管", tone: amber }, "写入时校验数据源存在且启用"]
  - "`relation` → `data_source`": ["`data_source_id`", { text: "不管", tone: amber }, "同上"]
  - "`portrait` → `business_domain`": ["`business_domain_id`", { text: "不管", tone: amber }, "写入时校验域存在"]
  - "`relation` → `business_domain`": ["`business_domain_id`", { text: "不管", tone: amber }, "同上"]
  - "`portrait` → `value_set`": ["`value_set_id`（仅 value_set）", { text: "不管", tone: amber }, "写入时校验集合存在，且集合的 `data_type` 和字段一致"]
  - "`relation` → `value_set`": ["`object_value_set_id`（客体用值集时）", { text: "不管", tone: amber }, "同上"]
  - "`relation_attr` → `value_set`": ["`value_set_id`", { text: "不管", tone: amber }, "同上"]
  - "`relation_attr` → `relation`": ["`relation_id`", { text: "不管", tone: amber }, "写入时校验父行是关系；属性名不得和客体名冲突"]
  - "`dsl_preset` → `dsl_preset_category`": ["`category_id`", { text: "不管", tone: amber }, "写入时校验分类存在"]
```

九条引用里没有一条是数据库管的。没有外键的代价，全部转成了服务层的检查和错误：`missing value set`、`value set type mismatch`、`duplicate portrait`、`relation attr parent must be a relation`……这些都是「数据库本来可以替你拦、但这里选择自己拦」的地方。

唯一一条==隐式==关联上一版有、这一版没有了：操作符。旧模型里字段和操作符靠 `semantic_type` 值相等对上，表里没有任何列互指；现在操作符不入库，这条边整个消失。

下面这个可以自己走一遍。左边是当前这一行用哪些列指着别处，右边是谁指着它：

````demo
widget: schema-walk
title: 顺着列名走一遍这 8 张表
actions: false
config:
  start: city
  hint: |
    ==点左边或右边的任意一张卡，就从那一头接着往下走==，走出来的路径记在上面的面包屑里。
    卡片底下的灰字写的是「靠哪一列连过去的」。
  jump:
    vs-city: 两个不同字段指向同一个值集合
    holding: 从画像字段换到关系本体
    object-cols: 客体不是子行，是长在关系本行上的 13 个列
    market: 属性行靠 relation_id 挂回关系
    pp: 换到预设那条线，看看它跟字段表有没有关系
  records:
    - id: city
      table: crm_dc_portrait
      title: city
      sub: 特征 · 枚举 · 值集
      fields:
        - [field_key, city]
        - [column_name, city]
        - [variable_type, enum]
        - [data_type, string]
        - [content_type, "7（城市）"]
        - [enum_type, value_set]
        - [value_set_id, → city 集合]
        - [business_domain_id, → identity]
        - [data_source_id, → 宽表]
        - [status, "1（ENABLED）"]
      note: 一个普通画像字段，三种字典各指向一次。
    - id: open_city
      table: crm_dc_portrait
      title: open_city
      sub: 特征 · **已停用**
      off: true
      fields:
        - [field_key, open_city]
        - [column_name, open_city]
        - [enum_type, value_set]
        - [value_set_id, → city 集合]
        - [business_domain_id, → account]
        - [status, "0（DISABLED）"]
      note: 已经停用了，行还在表里，指向的值集合也还是同一个 city。
    - id: vs-city
      table: crm_dc_value_set
      title: city
      sub: enum_content 数组 · 其中 1 项停用
      fields:
        - [set_key, city]
        - [data_type, string]
        - [enum_content, "[SZ, GZ, …, 440300]"]
        - [status, "1（ENABLED）"]
      note: 数组里 `440300` 那项自己的 `status` 是 0，但值留在数组里没删。
    - id: holding
      table: crm_dc_relation
      title: holding
      sub: 关系本体 · 客体长在本行
      fields:
        - [relation_key, holding]
        - [object_name, stock]
        - [object_column_name, object_id]
        - [object_enum_type, dynamic]
        - [object_value_resolver_key, stock_search]
        - [data_source_id, → rel_holding]
      note: 关系本体这一行自带 13 个 object_* 列。「这张关系表长什么样」不用再往下查子行。
    - id: object-cols
      table: crm_dc_relation
      title: holding 的客体列
      sub: 13 个 object_* 列
      fields:
        - [object_name, "stock（客体类别标识）"]
        - [object_column_name, object_id]
        - [object_variable_type / object_data_type, "range / string"]
        - [object_enum_type, "dynamic → stock_search"]
        - [object_value_set_id, "仅 value_set 时用"]
      note: DSL 里的 `objects` 数组落在这条列上。它是动态候选，所以要一个解析器。
    - id: market
      table: crm_dc_relation_attr
      title: market
      sub: 关系属性 · 挂在 holding 下
      fields:
        - [relation_id, → holding]
        - [field_key, market]
        - [column_name, market]
        - [variable_type, enum]
        - [enum_type, value_set]
        - [value_set_id, → market 集合]
      note: 属性也能用值集合，和画像字段走的是同一条取值来源规则。
    - id: qty
      table: crm_dc_relation_attr
      title: qty
      sub: 关系属性 · 什么值集都没有
      fields:
        - [relation_id, → holding]
        - [field_key, qty]
        - [column_name, qty]
        - [variable_type, range]
        - [data_type, long]
        - [enum_type, none]
      note: 同一个 (relation_id, field_key) 唯一 —— qty 只在 holding 下有这一行。
    - id: ds-wide
      table: crm_dc_data_source
      title: user_portraits_wide
      sub: 逻辑源 → 物理表
      fields:
        - [source_key, user_portrait]
        - [table_name, user_portraits_wide]
        - [status, "1（ENABLED）"]
      note: 一张宽表装着全部画像列。关联键写死是 `uid`，这个列名不在表里。
    - id: dom-identity
      table: crm_dc_business_domain
      title: identity
      sub: 二级业务域 · 界面归属
      fields:
        - [domain_code, identity]
        - [parent_id, → futu]
        - [domain_path, futu/identity]
        - [status, "1（ENABLED）"]
      note: 它自己也是一棵树，`parent_id = 0` 的是顶级域 `futu`。
    - id: op-date
      table: "packages/dsl/src/operators.ts"
      title: OPERATOR_DISPLAY
      sub: 15 个操作符 · 代码常量
      fields:
        - [key, last_n_days]
        - [name, "最近X天 / 最近 {0} 天（template）"]
        - [sortOrder, 120]
      note: 操作符的展示名和顺序在代码里。一个字段能用哪几个，由 applicableOps 按形状算。
    - id: pc
      table: crm_dc_dsl_preset_category
      title: churn
      sub: 页签
      fields:
        - [category_key, churn]
        - [name_i18n, "流失防御"]
        - [status, "1（ENABLED）"]
    - id: pp
      table: crm_dc_dsl_preset
      title: 大额净转出预警
      sub: 一张卡片
      fields:
        - [category_id, → churn]
        - [icon, alert]
        - [staff_id, 归属人]
        - [query_json, "{ version, scope, include, exclude }"]
      note: 整条预设线跟字段表零引用 —— 从这一行往两边看，走不到 crm_dc_portrait。
  edges:
    - { from: city, to: vs-city, via: "value_set_id" }
    - { from: city, to: ds-wide, via: "data_source_id" }
    - { from: city, to: dom-identity, via: "business_domain_id" }
    - { from: open_city, to: vs-city, via: "value_set_id" }
    - { from: holding, to: object-cols, via: "客体列长在本行" }
    - { from: market, to: holding, via: "relation_id" }
    - { from: qty, to: holding, via: "relation_id" }
    - { from: object-cols, to: op-date, via: "dynamic 候选 + 操作符都在代码里" }
    - { from: pp, to: pc, via: "category_id" }
````

---

## 07 · 接口和表：同一批表，三种读法

4.1 的接口分三组：Metadata（给前端）、Metadata（给 SQL Builder）、Preset（给前端）。它们读的是同一批表，取的东西完全不同。

```flow
grid: true
legend: true
groups:
  - { id: db, label: "MySQL crm_dc", tone: violet }
  - { id: svc, label: "服务端组装", tone: blue }
  - { id: use, label: "消费方", tone: muted }
nodes:
  - { id: t, label: "8 张配置表", sub: "字典 3 + 字段 3 + 预设 2", row: 0, kind: database, group: db }
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
  - "`Catalog`（→ SQL Builder）": [{ text: "含表名、列名、valueEncoding、可用操作符", tone: green }, { text: "只含 ENABLED", tone: red }, "已经停用的字段不该出现在新编译的 SQL 里"]
```

### 接口对表的清单

```compare
first: 接口
head: [读写哪些表, 过滤条件, 返回什么]
rows:
  - "`GET /api/audience/metadata`": ["8 张里除预设外的 6 张（都读）", "两种状态都读", "`AudienceMetadata`：域、扁平操作符列表、`features`、`relations`；带 `revision` 哈希"]
  - "`GET /api/audience/value-sets?setKey=`": ["`value_set`", "集合停用也返回 200，便于回显", "一个集合的**全部**取值，每条带 status"]
  - "`GET /api/audience/value-resolvers?resolverKey=`": [{ text: "不读表", tone: amber }, "—", "动态候选，靠 `value_resolver_key` 走到一个解析器（现在是 `stock_search`），不落库"]
  - "`POST /api/audience/metadata/resolve`": ["同 metadata 那批", "按请求点名的 key 返回", "回显用的精简投影：只要草稿里出现过的字段和关系"]
  - "`GET /api/meta/catalog`": ["同上六张", "只收 ENABLED；引用的值集合也停用的话，这个字段整个不进", "`Catalog`：`universeTable` + fields（带 table/column/ops）+ relations"]
  - "`GET /api/presets`": ["`dsl_preset` `dsl_preset_category`", "启用的分类和卡片", "**不带** `query_json`"]
  - "`GET /api/presets/:id`": ["同上", "停用的预设也返回", "`PresetDetail`，带 `query` 草稿"]
```

`AudienceMetadata` 里有一条隐含的连锁：**字段自己的 status 为 0 时它当然是 DISABLED，但字段自己启用了、它指向的数据源或值集合停用了，它也变成 DISABLED** —— 投影时顺着引用列查了一遍。Catalog 那侧的规则更狠：引用的值集合停用，这个字段直接从编译字典里消失。

Admin 那侧还有一处和上一版不同的地方：==操作符不再是 Admin 的资源==。旧模型里它是六个资源之一（只有 GET / PATCH，没有 POST）；现在六个资源是数据源、业务域、值集合、特征、关系、关系属性，操作符连资源都不是了。

```callout
tone: violet
icon: 💡
text: |
  接口和表不是一对一。`/api/audience/metadata` 一次读六张表，`/api/presets` 只读两张，
  而 `/api/audience/value-resolvers` 一张表都不读。

  ==所以要回答「这个字段从哪来」，得先问「它在哪个界面元素上」==。同一个 `crm_dc_portrait` 行，
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
  - SQL Builder: ["—", "—", { text: "报 `UNKNOWN_FIELD` —— 停用对象不在 Catalog 里", tone: red }]
  - Data Admin 列表: ["看得到，带 status", "看得到", "—"]
```

如果停用等于删行，第二列就没法实现：老条件的回显需要那个名字，而名字已经被删掉了。

两个真实的并存例子：

- `open_city` 整行 `status=0`，行还在 `crm_dc_portrait` 里，指向的 `city` 值集合也还在。
- 值集合 `city` 里的取值 `440300` 自己的 `status=0`，值留在 `enum_content` 数组里。

方案里有一句关于错误码的说明值得抄下来：错误码表里有 `DISABLED_REF`（14 个码之一），但==没有任何一处抛出它==。原因是 Catalog 只收 ENABLED，停用对象在编译器眼里和「从来没写过这个字段」长得一模一样，拿不到「它曾经存在」这个事实，所以实际报的是 `UNKNOWN_FIELD`。

停用还会触发几项前置检查，因为「不删」意味着引用可能仍然存在：停用数据源时如果还有 ENABLED 的画像或关系指向它，接口返回 `SOURCE_IN_USE`；停用值集合的判据是同类的引用检查。

```callout
tone: amber
icon: 🔄
text: |
  这批表的默认值是**方向相反**的：六张元数据表都是 `DEFAULT 0`（新建出来先处于停用），
  预设那两张是 `DEFAULT 1`。

  后果很具体：Admin 写完一条字段，得再调一次 `/status` 把它启用，否则圈选组件的新建下拉里不会出现它。
```

---

## 09 · 模型定稿了，剩下的是两处命名级差异

上一版笔记在这里列过一张「还在改」的对照表（`physical_type` 去留、`agg_funcs` 加不加）。这一版不用再猜了：那场讨论已经收口，==`expr` 派生列拿掉了，`agg` 合计拿掉了，`physical_type` 留下了==。拆三张表、客体留在关系上、操作符不入库，就是收口的结果。

现在文档和代码之间剩下的差异只有命名级：

```compare
first: 项
head: [方案文档, 仓库代码]
rows:
  - 预设分类表名: ["`crm_dc_dsl_template_category`", "`crm_dc_dsl_preset_category`"]
  - 快照名单列: ["`encrypt_uid CHAR(32)`（密文）", "demo 还是 `user_id BIGINT`（明文），属数据层的演进项"]
  - "数据源表上的 `type = 特征/关系`": ["DDL 里的一行示意", "demo 的 `crm_dc_data_source` 没有这一列，8 列"]
```

第三行值得多说一句：方案在 `crm_dc_data_source` 的 DDL 里写了 `type = 特征/关系`，但 demo 的表里没有这个列，画像和关系各挂在哪个源上，靠 `data_source_id` 指对来保证。这是个待实现的约束，不是已实现的事实。

---

```quiz
- q: 拆成三张字段表之后，「特征的 field_key 全局唯一」这条规则为什么就能落到数据库索引上了？
  a: |
    因为三种身份不再挤一张表。特征有自己的 `crm_dc_portrait`，表上可以直接建
    `uk_field_key (field_key)` 全局唯一索引；关系同理。
    上一版三种身份共用一张表、靠 `field_type` 区分，索引最多做到
    `(data_source_id, parent_id, field_key)` 联合唯一 —— 两条落在不同数据源的特征照样能同时插入，
    所以全局唯一只能靠写入校验。现在数据库自己就能拦。
- q: 操作符从表里拿掉之后，「某个字段能用哪些操作符」由什么决定？
  a: |
    由字段自己的形状算：`applicableOps(variable_type, data_type, content_type)`。
    枚举和字符串拿到 `eq/neq/in/not_in/is_null/is_not_null`，布尔只有 `eq/is_null/is_not_null`，
    数值多出大小比较和 `between`；`content_type` 是日期或时间时再追加相对时间操作符。
    展示名和顺序在 `OPERATOR_DISPLAY` 常量里。改操作符 = 改代码发版，Admin API 没有操作符资源。
- q: 同一批表，为什么圈选组件和 SQL Builder 拿到的两份投影不一样？
  a: |
    因为两者的用途不同。圈选组件要渲染选项和回显老条件，所以它需要 DISABLED 的对象和 label，
    但不需要表名列名；SQL Builder 要把名字换成物理列，所以它需要 table/column/valueEncoding，
    但已经停用的字段不该再参与新 SQL，所以它只收 ENABLED ——
    连「引用的值集合停用了」的字段都整个不进。
```
