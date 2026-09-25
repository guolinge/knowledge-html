# sql_builder_v2 的核心抽象

```callout
tone: blue
icon: 🧭
text: |
  这篇讲**设计**：这个库为什么要有「条件」「表达式」「方言」这几个抽象，
  它们各自解决什么问题。

  想看文件在哪 → [代码地图](../sql-builder-v2-code-map/)；
  想看整体分层 → [架构](../sql-builder-v2-architecture/)。
```

```cards
cols: 3
items:
  - { title: 概念, desc: 为什么需要「条件」这个抽象；一个条件由什么构成；六种条件入口；四种表达式形态, tag: "01 ~ 04", tone: green }
  - { title: 组织, desc: 条件怎么组合成树；两套词汇怎么分工；两次翻译各做什么, tag: "05 ~ 06", tone: blue }
  - { title: 架构, desc: "条件怎么翻译成 Rule[]；六种实现怎么组织；方言怎么隔离库差异", tag: "07 ~ 09", tone: violet }
```

## 01 · 需求：为什么需要「条件」这个抽象

先看一个真实场景。

> 运营要发一张优惠券，**只发给「最近 7 天加购过、并且是 VIP」的用户**。

要落地，得回答「这批人是谁」。而这些数据散在两个地方：

```text
「加购过」  →  在事件表（行为流水）
「是 VIP」  →  在画像表（静态属性）
```

最直接的做法：**让运营写 SQL**。

```sql
SELECT uid FROM event_v2      WHERE event_type = '加购' AND event_time > ...
INTERSECT
SELECT uid FROM user_portrait WHERE vip_level >= 3
```

这条路走不通，有四个原因：

```cards
cols: 2
items:
  - { title: 运营不会写 SQL, desc: 业务侧的人是产品和运营，不是工程师, tone: amber }
  - { title: 口径要复用, desc: 同一批人明天还要圈一次，不能每次重写, tone: amber }
  - { title: 要防注入, desc: 条件里的值是外部传进来的，直接拼字符串会被注入, tone: red }
  - { title: 要跑在两个库上, desc: 同一句话，Doris 和 ByteHouse 的 SQL 写法不一样, tone: red }
```

```callout
tone: violet
icon: 🎯
quote: true
text: |
  所以需要一层中间物：**用业务语言描述「要什么人」，由它生成 SQL。**
  ==「条件」就是这层描述的基本单位。==
```

## 02 · 一个条件由什么构成

把「最近 7 天加购过」和「是 VIP」拆开看，它们其实是同一种结构：

```compare
first: 拆开看
head: [「最近 7 天加购过」, 「是 VIP」]
rows:
  - 判断对象: [事件「加购」, 画像属性 `vip_level`]
  - 判断方式: [次数 > 0, "`>=`"]
  - 判断值: [—, 3]
  - 额外限定: [最近 7 天, —]
```

**共同点**：都是「**对某个东西做一个判断**」。

```cards
cols: 2
items:
  - title: 叶子条件
    tag: 一个判断
    tone: green
    desc: 最小单位。对某个东西做一次判断
    code: |
      { op: 'IN', name: 'city', value: ['杭州'] }
  - title: 树枝条件
    tag: 组合
    tone: violet
    desc: 用 AND / OR 把条件串起来。**业务说的「并且」「或者」就是它**
    code: |
      { logic: 'AND', items: [ ... ] }
```

### 为什么条件要能嵌套

因为业务说的是：

```text
「最近 7 天加购过，并且是 VIP」          → AND(叶子, 叶子)
「最近 7 天加购过，或者是 VIP」          → OR(叶子, 叶子)
「（加购过 或 下单过）并且是 VIP」        → AND(OR(叶子,叶子), 叶子)
```

**最后一个例子说明为什么必须是树，不能是列表** —— 「或者」可以出现在「并且」里面。

```flow
grid: true
nodes:
  - { id: and, label: AND, sub: "顶层", row: 0, tone: violet }
  - { id: or, label: OR, sub: "子树枝", row: 1, tone: violet }
  - { id: vip, label: "是 VIP", sub: "叶子", row: 1, tone: green }
  - { id: cart, label: "加购过", sub: "叶子", row: 2, tone: green }
  - { id: order, label: "下单过", sub: "叶子", row: 2, tone: green }
edges:
  - { from: and, to: or, label: "左边" }
  - { from: and, to: vip, label: "右边" }
  - { from: or, to: cart }
  - { from: or, to: order }
```

## 03 · 六种条件入口（entrepot）

**为什么是六种？** 因为「判断对象」的来源只有六类。

```cards
cols: 2
items:
  - title: portrait
    tag: 静态属性
    tone: green
    desc: 用户的**属性**。查 `user_portrait` 表，一行 = 一个人
    code: |
      { op: 'IN', name: 'city', value: ['杭州'] }
      → WHERE city IN ('杭州')
  - title: event
    tag: 行为
    tone: violet
    desc: 用户**做过什么、几次**。查 `event_v2`，要 join 回画像表
    code: |
      { eventName: '加购', timeRange: '最近3天',
        formula: { op: 'Gt', value: 3 } }
      → 子查询 group by $user_id having count > 3
  - title: crowd
    tag: 预先算好
    tone: blue
    desc: 已经圈好存下来的**一批人**。查 `crowds` 表
    code: |
      { op: 'IN', items: [
          { crowdId: 'C_888', crowdVersion: 'v3' }
      ]}
  - title: uid
    tag: 直接给
    tone: muted
    desc: 直接给一批用户 ID，**不查表**。最简单的一种
    code: |
      { op: 'IN', value: ['111','222'],
        hasEncoded: false }
  - title: relation
    tag: 和对象的关系
    tone: amber
    desc: 用户和某个**对象**的关系。查业务明细表
    code: |
      { formulaType: 'DETAIL', op: 'IN',
        relationName: 'niuniu_user_coupon_receive_last',
        value: ['coupon001'] }
  - title: rawSql
    tag: 兜底
    tone: red
    desc: 直接塞一段 SQL。**前五种表达不了时用**
    code: |
      'select uid from some_table where ...'
```

```callout
tone: amber
icon: ⚠
text: |
  **为什么叫「入口」（entrepot）？**

  因为它是一个条件**进入 SQL 世界的入口** ——
  ==每种条件都知道自己该去哪张表、该怎么写 WHERE==。

  「条件」是业务视角的说法，「入口」是实现视角的说法。同一件事。
```

### 一个容易忽略的差异：五种能嵌套，一种不能

```compare
first: 类型
head: [能不能嵌套成树, 为什么]
rows:
  - portrait / event / relation: [{ text: 能, tone: green }, "它们的判断对象本身可以再组合，比如「城市是杭州 或 深圳」"]
  - crowd / rawSql: [{ text: 能, tone: green }, 同样支持 AND / OR 组合多个]
  - uid: [{ text: "不能", tone: red }, "它就是一个 ID 列表，**没有可组合的语义**"]
```

## 04 · 表达式模型：四种形态

### 为什么不能直接用 SQL 字符串

因为一条 SQL 里，**「数据」和「代码」是两种东西**：

```sql
SELECT uid FROM user_portrait WHERE city = '杭州'
       ↑                        ↑   ↑      ↑
     标识符                   标识符 数据  数据
```

- **标识符**（表名、列名）→ 要包反引号：`` `city` ``
- **数据**（值）→ 要**参数绑定**，不能直接拼进去（否则被注入）

但如果写成 `JSONExtract(properties, 'a')` —— 这段是**代码**，不能包反引号。

```callout
tone: red
icon: ⚠
quote: true
text: |
  把「数据」当成「代码」处理，或者反过来，==就是注入漏洞==。
```

### 四种形态 = 两个维度的组合

```compare
first: 形态
head: [列名怎么处理, 值怎么处理]
rows:
  - NormalExpression: ["包反引号 `formatField`", "参数绑定 `encodeValue`"]
  - RawValueExpression: ["包反引号", { text: "原样（已经是 SQL）", tone: amber }]
  - RawColumnExpression: [{ text: "原样（是表达式）", tone: amber }, "参数绑定"]
  - RawExpression: [{ text: "整段透传 `whereRaw`", tone: amber }, "—"]
```

```cards
cols: 2
items:
  - title: NormalExpression
    tag: 最常用
    tone: green
    desc: 列名和值都是普通数据。**99% 的条件都是这一种**
    code: |
      { op: 'IN', column: 'city', value: ['杭州'] }
      → WHERE `city` IN (?)     bindings: ['杭州']
  - title: RawValueExpression
    tag: 值是 SQL
    tone: amber
    desc: 列名是普通的，但**值本身是一段 SQL**（比如子查询）
    code: |
      { op: 'Gt', column: 'cnt', rawValue: '(select avg(x) from t)' }
      → WHERE `cnt` > (select avg(x) from t)
  - title: RawColumnExpression
    tag: 列名是 SQL
    tone: amber
    desc: 值普通，但**列名是一段表达式**（比如 JSON 取值）
    code: |
      { op: 'Eq', rawColumn: "JSONExtract(props, 'a')", value: 1 }
      → WHERE JSONExtract(props, 'a') = ?
  - title: RawExpression
    tag: 整段透传
    tone: red
    desc: 整条 where 都是 SQL。**方言方法返回的就是它**
    code: |
      { raw: "CASE WHEN `x` REGEXP ? THEN 1 ELSE 0 END = 1",
        value: '^abc' }
```

```callout
tone: violet
icon: 💡
text: |
  看出来了吗？==四种形态是「列名要不要处理」×「值要不要处理」的 2×2 组合==，
  再加一个「整段都别处理」的兜底。

  为什么要分这么细：因为**「哪些部分是用户数据、哪些部分是 SQL 代码」必须精确区分**。
  这个区分做错了，就是注入漏洞。
```

### 判别靠「哪个字段存在」

```ts
export const isCondition      = (rule) => 'logic' in rule;
export const isRawValueExpr   = (rule) => 'rawValue' in rule;
export const isRawColumnExpr  = (rule) => 'rawColumn' in rule;
export const isRawExpr        = (rule) => 'raw' in rule;
```

```callout
tone: amber
icon: ⚠
text: |
  **这是鸭子类型。** 好处是不用建 class、JSON 直接可用、跨进程传输天然友好。

  代价是==拼错字段名不会报错== —— 会掉进「都不是」那个分支抛异常。
```

## 05 · 组织：条件怎么组合成树

一棵条件树，从业务侧看是这样：

```text
AND
├── 事件：加购，最近 7 天，至少 1 次
└── OR
    ├── 画像：vip_level >= 3
    └── 画像：channel = 'APP'
```

换成 JSON：

```text
{ logic: 'AND', items: [
    { eventName: '加购', timeRange: '最近7天', ... },
    { logic: 'OR', items: [
        { op: 'Gte', name: 'vip_level', value: 3 },
        { op: 'Eq',  name: 'channel',   value: 'APP' }
    ]}
]}
```

```callout
tone: violet
icon: 💡
text: |
  **树只有两种节点**：`logic + items`（树枝）和叶子。
  ==所有复杂度都来自「树枝可以套树枝」，没有别的。==
```

## 06 · 组织：两套词汇，两次翻译

这是全篇最容易懵的地方：**同一棵树，业务侧和 core 用两套词汇描述。**

```compare
first: 同一个条件
head: [业务条件（crowd 的输入）, "Rule[]（core 的输入）"]
rows:
  - 属性名: ["`name`", "`column`"]
  - 例子: ["`{ op: 'IN', name: 'city', value: ['杭州'] }`", "`{ op: 'IN', column: 'city', value: ['杭州'] }`"]
  - 时间条件: ["用 `dateType` 描述，如「最近 3 天」", "**展开成多个条件**（见第 07 节）"]
  - 逻辑组合: ["`logic` + `items`", "`logic` + `items`（**一样**）"]
```

```flow
grid: true
nodes:
  - { id: biz, label: 业务条件, sub: "运营/产品能懂的语言", row: 0, tone: amber }
  - { id: rule, label: "Rule[]", sub: "core 能懂的语言", row: 1, tone: blue }
  - { id: sql, label: SQL 字符串, sub: "数据库能懂的语言", row: 2, tone: green }
edges:
  - { from: biz, to: rule, label: "adapter 翻译", tone: amber }
  - { from: rule, to: sql, label: "knex 编译", tone: green }
```

```callout
tone: green
icon: ✅
text: |
  **两次翻译，各管一件事：**

  - **adapter**（在 `crowd` 包里）：业务词汇 → 数据词汇
  - **knex**（在 `core` 底层）：数据词汇 → SQL 字符串

  ==`core` 永远不知道「什么是相对时间」「什么是画像属性」。==
```

## 07 · 架构：以画像为例，看条件怎么翻译

```callout
tone: red
icon: ⚠
text: |
  ==**先更正一个容易搞错的地方：没有统一的 `adapter`。**==

  翻译是**每种条件自己做的** —— 六种实现各写各的，没有一个公共的翻译函数。

  这一节讲的 `adapter()` 是 **`portrait.ts` 的私有方法**，只是因为它写得最清楚，
  拿它当例子。事件和关系各有自己的一堆函数（`getPropRules` / `getBaseRules` /
  `buildTimeRangRules` …），uid / 人群包 / rawSql 则基本没有转换逻辑。

  ==展开讲在 [⑧ crowd 篇](../sql-builder-v2-crowd/)。==
```

### 它是个递归函数

```flow
grid: true
nodes:
  - { id: in, label: "adapter(rules)", sub: "单个条件或数组", row: 0, kind: backend }
  - { id: loop, label: 遍历每个 rule, row: 1, tone: violet }
  - { id: q1, label: "有 'logic'？", sub: "是树", row: 2, tone: amber, shape: note }
  - { id: q2, label: "有 'op'？", sub: "是叶子", row: 2, tone: amber, shape: note }
  - { id: rec, label: "递归 adapter(items)", sub: "保持 logic 不变", row: 3, tone: violet }
  - { id: q3, label: "有 'dateType'？", sub: "时间条件", row: 3, tone: amber, shape: note }
  - { id: plain, label: "直接改名", sub: "name → column", row: 4, tone: green }
  - { id: time, label: "展开成 AND 子树", sub: "调方言或 utils", row: 4, tone: red }
  - { id: bad, label: throw, sub: "条件错误", row: 4, tone: red }
edges:
  - { from: in, to: loop }
  - { from: loop, to: q1, label: "是" }
  - { from: q1, to: rec, label: "是" }
  - { from: q1, to: q2, label: "否", dashed: true }
  - { from: q2, to: q3, label: "是" }
  - { from: q2, to: bad, label: "否", dashed: true }
  - { from: q3, to: plain, label: "否" }
  - { from: q3, to: time, label: "是" }
```

### 五个出口各产出什么

```compare
first: 分支
head: [产出, 真实数据]
rows:
  - "有 `logic`":
      - "**递归**，结构不变"
      - |-
        { logic: 'OR', items: [...] }
          → { logic: 'OR', items: [递归结果] }
  - "有 `dateType`\\n且是相对时间戳":
      - "**调方言**，展开成 AND 子树"
      - |-
        { op: Gte, name: '..._time', value: 3 }
          → { logic: AND, items: [3 个 Expression] }
  - "有 `dateType`\\n其它时间":
      - "**调 utils**，展开成 AND 子树"
      - 同上，但生成的是通用 Rule
  - "有 `rawValue`":
      - "改名 + 透传"
      - |-
        { op: Eq, name: 'c', rawValue: 'a+b' }
          → { column: 'c', op: Eq, rawValue: 'a+b' }
  - "普通条件":
      - "**只改名**"
      - |-
        { op: IN, name: 'city', value: ['杭州'] }
          → { column: 'city', op: IN, value: ['杭州'] }
  - "都不是":
      - "throw"
      - "条件错误: {...}"
```

### 重点：时间条件为什么会「膨胀」

**一个输入条件，变成一棵子树。**

```journey
- tag: 输入
  tone: muted
  name: 业务条件
  badge: 1 行
  code: |
    { op: 'Gte', name: '..._opened_time',
      dateType: 'Relative', value: 30 }
  note: |
    业务侧说的是一句话：「开户时间在**最近 30 天**内」。
  next: "adapter :: :: 遇到 dateType 分支"

- tag: 展开
  tone: violet
  name: 时间表达式
  badge: 变成两个
  code: |
    { op: 'Gte', column: '..._opened_time', value: 开始 }
    { op: 'Lte', column: '..._opened_time', value: 结束 }
  note: |
    ==因为「最近 30 天」在 SQL 里必须写成「>= 开始 AND <= 结束」。==
    一个语义，两个条件。
  next: "补丁 :: :: 某些操作符还要再加一个"

- tag: 补丁
  tone: amber
  name: addHackRules
  badge: 再加一个条件
  code: |
    如果是 '<' 或 '<='
      → 再加 { op: 'Gt', column: '...', value: 0 }
  note: |
    代码注释写着原因：

    > 对于 `<` 和 `<=` 的时间范围，需要加上 `> 0` 的限制条件，
    > 否则会筛选出值为 0 的数据。

    ==「值为 0」在时间戳语义里代表「从没发生过」==，不加会被当成「很久以前发生过」。
  next: "包一层 :: :: 强制 AND"

- tag: 输出
  tone: green
  name: Rule[]
  badge: 一棵子树
  code: |
    { logic: 'AND', items: [ 3 个 Expression ] }
  note: |
    **外面强制包一层 `logic: 'AND'`。** 代码注释解释了原因：

    > 这里包装一层，因为 timeRules 必须是 And 的关系，
    > 而 result 这一层的关系可能是 Or

    不包的话，「最近 3 天 **或** 是 VIP」会被解析成
    「`>= 开始` **或** `<= 结束` **或** 是 VIP」—— ==语义就错了。==
```

## 08 · 架构：entrepot 六种实现怎么组织

### 每种条件是一个类

```tree
- label: Entrepot
  sub: 六个类，共同的形状
  tone: violet
  note: 每种条件一个类，都实现 list / count
  children:
    - { label: Portrait, sub: "portrait.ts · 233 行", note: "查 user_portrait" }
    - { label: Event, sub: "event.ts · 906 行", note: "最复杂：事件名 + 时间 + 属性 + 次数" }
    - { label: Relation, sub: "relation.ts · 715 行", note: "和对象的关系" }
    - { label: Crowd, sub: "crowd.ts · 134 行", note: "查 crowds" }
    - { label: Uid, sub: "uid.ts · 141 行", note: "不查表" }
    - { label: RawSql, sub: "rawSql.ts · 107 行", note: "透传" }
```

```callout
tone: violet
icon: 💡
text: |
  **每个类只有两个公开方法：`list()` 和 `count()`。**

  - `list(condition, decode)` → 一段能查出 uid 列表的 SQL
  - `count(condition)` → 一段能数出人数的 SQL

  ==接口小得可怜，但这就是全部。==
```

### 工厂负责分发

```flow
grid: true
nodes:
  - { id: in, label: "EntrepotStruct", sub: "{ type, condition, options }", row: 0, kind: backend }
  - { id: sw, label: "switch (condition.type)", sub: "工厂里的分发", row: 1, tone: amber, shape: note }
  - { id: p, label: Portrait, row: 2, tone: green }
  - { id: e, label: Event, row: 2, tone: violet }
  - { id: o, label: "其余四种", row: 2, tone: muted }
  - { id: err, label: throw, sub: "未知类型", row: 2, tone: red }
  - { id: out, label: SQL 字符串, row: 3, kind: database }
edges:
  - { from: in, to: sw }
  - { from: sw, to: p, label: "portrait" }
  - { from: sw, to: e, label: "event" }
  - { from: sw, to: o, label: "..." }
  - { from: sw, to: err, label: "其它", dashed: true }
  - { from: p, to: out }
  - { from: e, to: out }
  - { from: o, to: out }
```

```callout
tone: amber
icon: ⚠
text: |
  **未知类型直接 `throw`，不静默返回空。**

  这个选择很重要：==静默失败会让 bug 跑到生产才被发现== ——
  生成的 SQL 少了一个条件，圈出来的人就多了一批。
```

## 09 · 架构：方言怎么隔离库差异

### 为什么需要方言

同一句业务话，两个数据库的 SQL 完全不一样：

```compare
first: 要做的事
head: [ByteHouse 写法, Doris 写法]
rows:
  - map 取 key: ["`mapElement(\\`name\\`, 'a')`", "`ELEMENT_AT(\\`name\\`, 'a')`"]
  - 判空: ["`isNull(\\`x\\`)`", "`\\`x\\` IS NULL`"]
  - 转整数: ["`toInt64(\\`x\\`)`", "`CAST(\\`x\\` AS SIGNED)`"]
  - JSON 数组包含: ["`hasAny(assumeNotNull(JSONExtract(...)), ...)`", "`JSON_CONTAINS(CAST(... AS JSON), ...)`"]
  - 相对时间戳: ["要 `UNIX_TIMESTAMP(...) * 1000` 包装", "不要包装（event_time 是 DATETIME）"]
```

### 17 个方法，覆盖所有差异点

```cards
cols: 3
items:
  - { title: 属性取值, desc: "`mapPropertyAccess`", tone: amber }
  - { title: 判空, desc: "`isNullCheck` / `isNotNullCheck`", tone: amber }
  - { title: 空值兜底, desc: "`ifNullWrap`", tone: amber }
  - { title: 类型转换, desc: "`castToInt` / `castToFloat` / `castBoolToInt`", tone: amber }
  - { title: 正则, desc: "`regexpMatchExpr` / `regexpNotMatchExpr`", tone: amber }
  - { title: JSON 数组, desc: "`jsonArrayContainsRule` / `NotContains` / `Equals`", tone: amber }
  - { title: 多条件选择, desc: "`multiIf`", tone: amber }
  - { title: 数组展开, desc: "`arrayExpandSql`", tone: amber }
  - { title: 按天分组, desc: "`groupByEventTime`", tone: amber }
  - { title: 相对时间, desc: "`getRelativeTimestampRules`", tone: amber }
  - { title: 绝对时间, desc: "`getAbsoluteTimestampRules`", tone: amber }
```

```callout
tone: red
icon: ⚠
tinted: true
text: |
  **方言方法没有一个是直接产出 SQL 的。**

  它们返回两种东西：**SQL 片段字符串**（被拼进 `Expression.raw`），
  或者**完整的 Expression / Rule**（直接进表达式树）。

  ==真正把表达式树变成 SQL 的是 knex，不是方言。==
```

### 什么时候调方言

**只有属性类型特殊时才调** —— 普通条件（`=`、`>`、`IN`）根本不碰方言。

```compare
first: 属性类型
head: [调哪个方法, 返回什么]
rows:
  - 相对时间 + 时间戳: ["`getRelativeTimestampRules()`", "`Expression[]`"]
  - 正则匹配: ["`regexpMatchExpr()`", "`Expression`"]
  - JSON 数组: ["`jsonArrayContainsRule()`", "`Rule`"]
  - bool: ["`castBoolToInt()`", "`string`"]
  - map 取值: ["`mapPropertyAccess()`", "`string`"]
  - NULL 判断: ["`isNullCheck()`", "`string`"]
```

### 一个具体的例子：时间戳为什么必须走方言

```compare
first: 库
head: [实现方式, 生成的 SQL 形态]
rows:
  - ByteHouse:
      - "**薄壳** —— 直接转发给 `utils.getTimestampRules()`"
      - |-
        `..._time` >= UNIX_TIMESTAMP(
          DS_DATETIME_ADD('day', -3, NOW())
        ) * 1000
  - Doris:
      - "**自己实现** —— 因为 Doris 的 event_time 是 DATETIME"
      - |-
        `..._time` >= DS_DATETIME_ADD('day', -3,
          FROM_UNIXTIME(UNIX_TIMESTAMP(), '%Y-%m-%d 00:00:00')
        )
```

```callout
tone: amber
icon: ⚠
text: |
  **差别在于要不要 `UNIX_TIMESTAMP(...) * 1000` 那层包装。**

  ByteHouse 的 `event_time` 是**毫秒时间戳**（数字），要把日期转成毫秒再比。
  Doris 的 `event_time` 是 **DATETIME**（日期类型），直接比就行。

  ==所以「时间戳必须走方言」不是风格差异，是**列的数据类型不同**。==
```

## 10 · 自测

```quiz
- q: 为什么条件必须是「树」，不能是一个平铺的列表？
  a: |
    因为「或者」可以出现在「并且」里面。
    「（加购过 或 下单过）并且是 VIP」这种语义，平铺列表表达不了。
    树只有两种节点：`logic + items`（树枝）和叶子，树枝可以套树枝。

- q: 六种条件入口为什么是六种？
  a: |
    因为「判断对象」的来源只有六类：用户的**属性**（portrait）、
    **行为**（event）、**预先算好的人群**（crowd）、**直接给的 ID**（uid）、
    **和对象的关系**（relation），以及**兜底**（rawSql）。
    每种都知道自己该去哪张表。

- q: Expression 为什么要有四种形态？
  a: |
    因为一条 SQL 里「数据」和「代码」是两种东西，处理方式不同：
    标识符要包反引号，数据要走参数绑定，但表达式不能包反引号。
    四种形态是「列名要不要处理」×「值要不要处理」的 2×2 组合，
    再加一个「整段都别处理」的兜底。**混了就是注入漏洞。**

- q: 「最近 3 天」这一个条件，为什么最后变成了一棵子树？
  a: |
    因为「最近 3 天」在 SQL 里必须写成 `>= 开始 AND <= 结束` —— 一个语义、两个条件。
    某些操作符还要再加一个 `> 0`（否则会把「值为 0」误当成「很久以前发生过」）。
    最后外面强制包一层 `logic: 'AND'`，否则和同一层的 `OR` 混在一起语义就错了。

- q: 方言方法是直接生成 SQL 的吗？
  a: |
    **不是。** 它们返回 SQL 片段字符串（被拼进 `Expression.raw`），
    或者完整的 Expression / Rule（直接进表达式树）。
    真正把表达式树变成 SQL 的是 **knex**，不是方言。

- q: 相对时间戳为什么必须走方言，而不能用通用实现？
  a: |
    因为两个库的 `event_time` 列**数据类型不同**：
    ByteHouse 是毫秒时间戳（数字），要 `UNIX_TIMESTAMP(...) * 1000` 包装；
    Doris 是 DATETIME，直接比就行。**不是风格差异，是数据类型差异。**

- q: 工厂遇到未知的 `condition.type` 会怎样？
  a: |
    直接 `throw`，不静默返回空。
    静默失败会让 bug 跑到生产才被发现 —— 生成的 SQL 少了一个条件，
    圈出来的人就多了一批。
```
