```callout
tone: blue
icon: 🧭
text: |
  前置是 [⑧ crowd 篇](../sql-builder-v2-crowd/)。

  那篇讲了「翻译是每种条件自己做的」。这篇**把六种条件拆开看** ——
  它们各自是什么、共同形状是什么、工厂怎么分发，以及为什么其中一种占了 906 行。

  读完你应该能说出：「==六种条件都只有 `list` / `count` 两个方法，但它们内部的复杂度差了 8 倍。==」
```

## 01 · 概念：六种条件入口各是什么

条件树上的叶子有六种。**每一种回答一个不同的问题。**

```compare
first: 条件
head: [回答什么问题, 数据在哪, 一行代表]
rows:
  - 画像 portrait: [他现在是什么样, 画像表, 一个人]
  - 事件 event: [他做过什么、几次, 事件表, 一个人某一刻的一个动作]
  - 关系 relation: [他和某个对象什么关系, 各种业务明细表, 一个人 + 一个对象]
  - 人群包 crowd: [预先算好的一批人是谁, 人群包表, 人群包 + 版本 + 一个人]
  - uid: [就是这几个人, { text: 不查表, tone: muted }, —]
  - rawSql: [兜底：直接给 SQL, { text: 不查表, tone: muted }, —]
```

### 为什么正好是六种

```tree
- label: 判断对象的来源
  tone: violet
  note: 六种叶子，各查各的表
  children:
    - { label: 画像, note: "一个人现在是什么样 —— 静态属性" }
    - { label: 事件, note: "一个人做过什么 —— 行为流水" }
    - { label: 关系, note: "一个人和某个对象的关系" }
    - { label: 人群包, note: "预先算好的一批人" }
    - { label: uid, note: "直接给的 ID，不查表" }
    - { label: rawSql, note: "兜底：前五种表达不了时用" }
```

```callout
tone: violet
icon: 💡
text: |
  **前四种是「数据来源」，后两种是「逃生口」。**

  - **uid** 解决「这批人再加上这几个人」—— 运营给一个名单
  - **rawSql** 解决「前五种都表达不了」—— 承认有覆盖不到的情况

  ==一个系统该有几种条件，取决于它的数据有几种来源。==
  不是设计出来的，是数出来的。
```

### 一个容易忽略的差异：谁能嵌套

```compare
first: 条件
head: [能不能组成树, 为什么]
rows:
  - 画像 / 事件 / 关系: [{ text: 能, tone: green }, "判断对象本身可以再组合，比如「城市是杭州 或 深圳」"]
  - 人群包 / rawSql: [{ text: 能, tone: green }, 同样支持 AND / OR 组合多个]
  - uid: [{ text: "不能", tone: red }, "它就是一个 ID 列表，**没有可组合的语义**"]
```

## 02 · 组织：六个类的共同形状

```callout
tone: green
icon: ✅
quote: true
text: |
  ==六个类，每个只有两个公开方法。==

  ```text
  list(condition, decode)   →  一段能查出 uid 列表的 SQL
  count(condition)          →  一段能数出人数的 SQL
  ```
```

```compare
first: 类
head: [list, count, 构造函数收什么]
rows:
  - Portrait: ["`list(condition, decode)`", "`count(condition)`", "`(type: Modules, dialect?)`"]
  - Event: ["`list(condition, decode)`", "`count(condition)`", "`(options?, dialect?)`"]
  - Relation: ["`list(condition, decode)`", "`count(condition)`", "`(type: Modules, dialect?)`"]
  - Crowd: ["`list(condition, decode)`", "`count(condition)`", "`(dialect?)`"]
  - Uid: ["`list(condition, decode)`", "`count(condition)`", "`(dialect?)`"]
  - RawSql: ["`list(condition, decode)`", "`count(condition)`", { text: "不收", tone: muted }]
```

### 构造函数收的东西，说明了复杂度

```callout
tone: violet
icon: 💡
text: |
  **看构造函数就知道这个条件有多复杂：**

  - **RawSql 什么都不收** —— 它只是把字符串拼进去
  - **Uid / Crowd 只收方言** —— 它们不需要知道「自己在哪个模块里」
  - **Portrait / Relation 收 `type: Modules`** —— 因为同一个条件在「标签」和「分群」
    两个场景下**行为不一样**（比如时间条件的 `isTag` 分支）
  - **Event 收 `options`** —— 额外配置：无效数据规则、严格匹配开关
```

```callout
tone: amber
icon: ⚠
text: |
  ==`list()` 的 `decode` 参数默认值是 `true`。==

  它决定最外层要不要包一层 `UID_DECODE(uid)`。
  内部递归时**必须传 `false`** —— 只有最外层才解码。

  所以你会看到 `list(condition, false)` 这种调用（在 crowd / uid / rawSql 里），
  那是内部递归，不是外部调用。
```

## 03 · 组织：工厂怎么分发

工厂负责「给一个条件，找到对应的类，调它的方法」。

```flow
grid: true
nodes:
  - { id: in, label: "EntrepotStruct", sub: "{ type, condition, options? }", row: 0, kind: backend }
  - { id: init, label: "initEntrepotListSqlGen(type, dialect)", sub: "工厂先建好六个实例", row: 1, tone: violet }
  - { id: sw, label: "switch (condition.type)", sub: "再按类型分发", row: 2, tone: amber, shape: note }
  - { id: p, label: Portrait, row: 3, tone: green }
  - { id: e, label: Event, row: 3, tone: violet }
  - { id: o, label: "其余四种", row: 3, tone: muted }
  - { id: err, label: throw, sub: "未知类型", row: 3, tone: red }
  - { id: out, label: 一段子 SQL, sub: "查出一批 uid", row: 4, kind: database }
edges:
  - { from: in, to: init }
  - { from: init, to: sw }
  - { from: sw, to: p, label: "portrait" }
  - { from: sw, to: e, label: "event" }
  - { from: sw, to: o, label: "..." }
  - { from: sw, to: err, label: "其它", dashed: true }
  - { from: p, to: out }
  - { from: e, to: out }
  - { from: o, to: out }
```

### 为什么先建实例再分发

```text
// factory.ts
export function initEntrepotListSqlGen(type, dialect) {
    const _portraitInstance = new Portrait(type, dialect);
    const _eventInstance    = new Event(undefined, dialect);
    const _relationInstance = new Relation(type, dialect);
    // ...

    return (condition, decode) => {
        switch (condition.type) { /* ... */ }
    };
}
```

```callout
tone: violet
icon: 💡
text: |
  **因为要一次生成很多条 SQL。**

  一棵条件树上有 N 个叶子，如果每个叶子都 `new` 一遍类，
  就会重复创建。所以工厂**先建好六个实例**，再返回一个闭包，
  闭包被调用 N 次时复用这些实例。

  ==这是个很朴素的优化，但它决定了接口形状== ——
  所以是 `initXxxSqlGen()` 返回一个函数，而不是 `getXxxSql(condition)`。
```

### 事件是唯一的例外

```text
case Entrepots.Event:
    if (condition.options && isEventOptions(condition.options)) {
        // 暂时只有事件支持 options，如果有更多属性支持 options，
        // 再考虑更通用的方式
        return new Event(condition.options, dialect).list(condition.condition, decode);
    }
    return _eventInstance.list(condition.condition, decode);
```

```callout
tone: amber
icon: ⚠
text: |
  **只有事件会在分发时「现场 new 一个」。**

  因为它的 `options` 是**跟着条件走的**（每个事件条件可以有自己的配置），
  不能预先建好。代码注释自己也写着「暂时只有事件支持 options」。

  ==这种「一个例外 + 一句注释」是真实代码的常态。==
```

### 未知类型直接 throw

```text
default:
    throw new Error('无效的条件结构（未知条件类型）: ' + JSON.stringify(condition));
```

```callout
tone: red
icon: ⚠
text: |
  **不静默返回空。**

  ==静默失败更贵== —— 少一个条件的 SQL **语法完全合法、能跑**，
  只是圈出来的人多了一批。这种 bug 会跑到生产才被发现。

  而且它把 `JSON.stringify(condition)` 也塞进错误信息了 ——
  排查时直接能看到是哪个条件出了问题。
```

## 04 · 架构：三种复杂度的对照

六个类都只有两个方法，但**内部的复杂度差了 8 倍**。看三个例子：

### 最简单的：uid（141 行）

```journey
- tag: 输入
  tone: muted
  name: 一批 ID
  code: |
    { op: 'IN', value: ['111', '222'], hasEncoded: false }
  note: |
    运营给的一个名单。**不查任何表。**
  next: "加密 :: :: 库里的 uid 是加密的"

- tag: 处理
  tone: blue
  name: 把明文 uid 加密
  code: |
    UID_ENCODE('111'), UID_ENCODE('222')
  note: |
    `hasEncoded` 决定要不要再加密一次 ——
    ==如果调用方给的就是密文，就别重复加密。==
  next: "拼 SQL :: :: 完事"

- tag: 输出
  tone: green
  name: 一段 SQL
  code: |
    select `uid` from (
      select arrayJoin(array(UID_ENCODE('111'), UID_ENCODE('222'))) as `uid`
    ) uidt group by `uid`
  note: |
    整件事就这么多。**没有表、没有 join、没有时间。**
```

### 中等的：画像（233 行）

```journey
- tag: 输入
  tone: muted
  name: 条件树
  code: |
    { op: 'IN', name: 'city', value: ['杭州'] }
  note: |
    支持嵌套树，所以要先递归。
  next: "递归 :: :: 见 ⑧ crowd 篇"

- tag: 处理
  tone: blue
  name: 三种分支
  code: |
    有 logic  → 递归
    有 dateType → 展开成时间子树
    其它      → 改名 name → column
  note: |
    复杂度**全在时间条件那一支**。其它条件只是改个字段名。
  next: "拼 SQL :: :: 单表查询"

- tag: 输出
  tone: green
  name: 一段 SQL
  code: |
    select `uid` from `user_portrait`
    where (`city` in ('杭州'))
  note: |
    单表，一个 where。==所以它只需要 233 行。==
```

### 最复杂的：事件（906 行）

**它要同时处理四件事**，而每一件都有分支：

```compare
first: 要处理的
head: [有多少种情况, 为什么复杂]
rows:
  - 事件名: ["1 种", { text: 简单，就是等值比较, tone: green }]
  - 时间范围: ["相对 / 绝对 × 时间戳 / DATETIME", "要调方言，还要按库拆表"]
  - 属性过滤: ["**严格匹配 / 宽松匹配**", { text: "语义完全不同，SQL 形态都不一样", tone: red }]
  - 次数阈值: ["次数 / 天数", "天数要**按天分组再数天**，SQL 是嵌套两层的"]
```

```callout
tone: amber
icon: ⚠
text: |
  ==四件事是**相乘**的关系，不是相加。==

  光「时间范围 × 属性过滤 × 次数」就已经十几种组合。
  这就是 906 行的来源 —— **不是因为代码烂，是因为它真的要处理这么多情况。**

  下一节拆开看。
```

## 05 · 细节：`event.ts` 906 行里装了什么

### 六个复杂度来源

```cards
cols: 2
items:
  - title: 六个「取反」映射表
    tag: 反逻辑
    tone: amber
    desc: |
      把操作符反过来：`Eq ↔ NotEq`、`In ↔ NotIn`、`And ↔ Or`、
      `Like ↔ NotLike`、`IsNull ↔ IsNotNull`。

      **为什么要取反？** 因为「排除无效数据」和「有且只有」这两个需求，
      实现方式都是「先算出不满足的人，再 NOT IN 排除掉」。
    code: |
      reverseOpMap
      reverseScopeOpMap
      reverseRegexpOpMap
      reverseLogicMap
      reverseLikeOpMap
      reverseNullOpMap
  - title: 内置属性 vs 普通属性
    tag: 属性来源
    tone: blue
    desc: |
      **内置属性**是事件表自带的列（`event_id` / `event_time` / `$user_id` …），
      **普通属性**存在 map 列里，取值方式不一样。

      两种走不同的分支：`createBuildInPropRule` vs `createMapPropRule`。
    code: |
      BuiltInProps = [
        'event_id', 'fdid', 'event_type',
        'event_time', 'process_time',
        '$user_id', '$device_id'
      ]
  - title: 次数 vs 天数
    tag: 统计方式
    tone: violet
    desc: |
      **次数**：`group by uid having count(uid) >= 3`
      **天数**：先 `group by 日期, uid` 去重，**再** `group by uid` 数天数。

      天数要多嵌套一层 —— 因为「同一天登录 10 次」只算 1 天。
    code: |
      enum FormulaType {
        Times = 1,   // 次数
        Days  = 2,   // 天数
      }
  - title: 严格匹配 vs 宽松匹配
    tag: ★ 最重要的
    tone: red
    desc: |
      两者**语义完全不同**，生成的 SQL 形态都不一样。

      这是 906 行里最值得讲的一块，下面单独说。
    code: |
      rule.filter.isStrictMatch !== false
        → 严格匹配
        → 宽松匹配
```

### ★ 严格匹配 vs 宽松匹配

**这是这个文件里最重要的一个分支。**

```compare
first: 模式
head: [语义, SQL 从哪张表出发, 没做过事件的人算不算]
rows:
  - 严格匹配: ["有且只有", "**事件表**", { text: "不在结果里", tone: muted }]
  - 宽松匹配: ["满足就行", "**画像表** left join 事件", { text: "算，cnt = 0", tone: amber }]
```

**严格匹配**（`buildEventDataOnlySql`）：

```sql
-- 从事件表出发（表名是算出来的，见下面的说明）
select `$user_id` as `uid`
from `event_biz_N`
where `event_type` = '登录' and `event_time` >= ...
group by `$user_id`
having count(`$user_id`) >= 3
```

```callout
tone: amber
icon: ⚠
text: |
  **`event_biz_N` 里的 `N` 是算出来的。**

  ByteHouse 里事件量太大，按事件名哈希拆成了 8 张表：
  `murmurhash.v3(eventName, 0) % 8 + 1`。

  ==同一个事件名永远落在同一张表== —— 换个事件名就是另一张。
  所以事件条件得先算表名，这也是 `getTable()` 要调方言的原因。
```

**宽松匹配**（`buildGlobalDataSql`）：

```sql
-- 从画像表出发，left join 事件子查询
select `uid` as `uid`
from `user_portrait` as `t1`
left join ( ...事件子查询... ) as `t2` on `t1`.`uid` = `t2`.`$user_id`
where ifNull(`t2`.`cnt`, 0) >= 3
```

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==这两个对 `>= 3` 结果一样，对 `< 3` 结果天差地别。==

  - **严格匹配** `< 3`：在**做过事件的人**里，次数小于 3
  - **宽松匹配** `< 3`：在**所有人**里次数小于 3 ——
    ==包括所有从没做过这件事的人==

  代码注释也点明了：「业务只考虑有数据的情况（不用考虑没有发生事件的 uid）」
  —— 那是严格匹配的注释。
```

### 严格匹配到底「严格」在哪

它处理的是**「有且只有」**这种需求。代码注释给了一个具体例子：

```text
最近 7 天登录次数 >= 3，且登录地在 HK
```

**用户的期望**是：这 7 天里的登录，**全部**都在 HK（没在其他地方登录过）。

```journey
- tag: 直觉做法
  tone: red
  name: 直接在 where 里加条件
  code: |
    where event_type = '登录'
      and login_city = 'HK'
    group by uid having count(*) >= 3
  note: |
    ==这会算错。==

    假设某人 7 天登录 10 次：3 次在 HK，7 次在深圳。
    where 过滤后只剩 3 次 HK 登录 —— `count >= 3` 通过。
    **但他明显不符合「登录地都在 HK」。**
  next: "正确做法 :: :: 反过来排除"

- tag: 正确做法
  tone: green
  name: 先算出「不合格的人」，再排除
  code: |
    step1. 找出「7 天内登录地有非 HK」的用户集合 A
    step2. 找出「登录 >= 3 次」且 `uid NOT IN A` 的人
  note: |
    **这就是那六个 reverse map 的用途** ——
    要把「登录地 = HK」取反成「登录地 ≠ HK」（还要包含 NULL）。

    ==「有且只有」用正向条件表达不了，必须反过来。==
```

```callout
tone: amber
icon: ⚠
text: |
  **`isStrictMatch` 不传时默认是严格匹配。**

  ```text
  // 暂时兼容老版本，有 filter，但是没有传 isStrictMatch, 默认当做 true 处理
  if (rule.filter && rule.filter.isStrictMatch !== false)
  ```

  ==这是个向后兼容的默认值，但它有真实的行为差异== ——
  老调用方不传这个字段，拿到的就是「有且只有」语义。
  调这个接口时**明确传 `isStrictMatch`**，别依赖默认。
```

### 还有两处现场注释

代码里留着两条带人名和日期的注释，说明了两个真实的坑：

```text
// @jinqiao 反馈，美分 ck 的 not in 的逻辑内，事件表名要带上 db 名称
// （`event` => `dws`.`event`） ---- 2022-09-06 16:07:28

// 经 jinqiao 验证，subquery 用 加 `dws` ---- 2022-10-18 16:57:47
```

```callout
tone: violet
icon: 💡
text: |
  **这两条注释比代码本身值钱。**

  它们记录了「为什么表名要带 `dws.` 前缀」—— 这不是设计，是 ClickHouse
  在 `not in` 和子查询里的行为要求。

  ==看到这种带日期和人名的注释，先别删。== 那是别人踩过坑留下的路标。
```

## 06 · 自测

```quiz
- q: "六种条件入口，为什么正好是六种？"
  a: |
    因为「判断对象的来源」只有六类：一个人的**属性**（画像）、**行为**（事件）、
    **和某个对象的关系**（关系）、**预先算好的一批人**（人群包）、
    **直接给的 ID**（uid），以及**兜底**（rawSql）。
    前四种是数据来源，后两种是逃生口。==不是设计出来的，是数出来的。==

- q: "六个类都只有 list / count 两个方法，为什么 event.ts 有 906 行？"
  a: |
    因为四件事是**相乘**关系：事件名 × 时间范围 × 属性过滤 × 次数阈值。
    光「时间范围 × 属性过滤 × 次数」就十几种组合。
    尤其**严格匹配 / 宽松匹配**这两条路的 SQL 形态完全不同 ——
    一条从事件表出发，一条从画像表 left join。
    ==不是因为代码烂，是因为它真的要处理这么多情况。==

- q: "「严格匹配」和「宽松匹配」对 `次数 >= 3` 结果一样吗？对 `< 3` 呢？"
  a: |
    `>= 3` **一样**（没做过的人 cnt=0，0 < 3，两边都不选）。
    但 `< 3` **天差地别**：
    严格匹配是「做过事件的人里次数 < 3」；
    宽松匹配是「所有人里次数 < 3」—— ==包括所有从没做过这件事的人==。
    区别在于宽松匹配从**画像表**出发 left join，严格匹配从**事件表**出发。

- q: "为什么事件条件需要五个「取反」映射表？"
  a: |
    因为两个需求都是「先算出不合格的人，再排除」：
    ① **排除无效数据**；② **「有且只有」语义**。
    比如「7 天内登录地都在 HK」，正向写不出来 —— 必须找出
    「登录地有非 HK」的人，再 `NOT IN` 排除掉。
    取反要把 `Eq → NotEq`、`In → NotIn`、`IsNull → IsNotNull` 等等都处理到。

- q: "工厂为什么先建好六个实例，再返回一个闭包？"
  a: |
    因为一棵条件树上有 N 个叶子，如果每个叶子都 `new` 一遍类就会重复创建。
    先建好实例再返回闭包，闭包被调用 N 次时复用它们。
    这个朴素优化决定了接口形状 —— 所以是 `initEntrepotListSqlGen()` 返回函数，
    而不是 `getEntrepotSql(condition)`。

- q: "调这个接口时，`isStrictMatch` 该不该显式传？"
  a: |
    **该。** 不传时默认是严格匹配（代码注释：「暂时兼容老版本，
    有 filter 但是没有传 isStrictMatch，默认当做 true 处理」）。
    两种语义差异很大，依赖默认值等于赌调用方懂这个历史。
```
