```callout
tone: blue
icon: 🧭
text: |
  前置是 [② 组织篇](../sql-builder-v2-organization/) 和 [③ 架构篇](../sql-builder-v2-architecture/)。

  架构篇讲的是「整条链路怎么走」。这篇**钻进 `packages/crowd` 里面**，
  按同样的六层走一遍：它是什么 / 由什么组成 / 怎么工作 / 为什么这么设计。

  读完你应该能说出：「==core 只认 `Rule[]`，crowd 认识六种业务条件，中间那层翻译是每种条件自己做的。==」
```

## 01 · 它是什么：core 之上加了什么

先看两个包的分工差在哪：

```compare
first: 维度
head: [core, crowd]
rows:
  - 认识的输入: ["`Rule[]` —— 一棵纯数据的表达式树", "**六种业务条件** —— 画像 / 事件 / 关系 / 人群包 / uid / rawSql"]
  - 认识业务词吗: [{ text: 一个都不认识, tone: green }, 认识，且有 45 行业务枚举]
  - 干的活: ["把表达式树编译成 SQL", "把业务条件**翻译成**表达式树，再拼成集合运算"]
  - 依赖谁: [knex, "core + lodash + murmurhash"]
  - 代码量: ["1347 行 / 13 文件", "4475 行 / 27 文件"]
```

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==crowd 干的事，用一句话说就是：==

  **把「运营说的那句话」，变成 core 能吃的 `Rule[]`。**

  这中间隔着两个世界的距离：业务世界说「最近 7 天加购过」，
  core 只认「一个列、一个操作符、一个值」。
```

### 具体加了哪三件事

```cards
cols: 3
items:
  - title: 认识业务条件
    tag: 翻译
    tone: green
    desc: |
      六种条件各有各的语义，各有各的表。

      **每种条件自己知道自己该查哪张表、怎么写查询** ——
      这部分 core 完全不管。
    code: |
      画像 → 查画像表
      事件 → 查事件表 + 按人算次数
      人群包 → 查人群包表
  - title: 做集合运算
    tag: 组合
    tone: violet
    desc: |
      架构篇讲的 AND / OR = `UNION ALL + GROUP BY + HAVING`。

      还有第二层 include / exclude 的增删。
    code: |
      AND → HAVING count(uid) = N
      OR  → 不加 HAVING
      include → UNION ALL
      exclude → NOT IN
  - title: 处理库差异
    tag: 方言
    tone: amber
    desc: |
      **方言的调用全在这一层。** core 的 `buildWhere` 是静态方法，
      签名里根本没有 dialect。

      这是架构的一条裂缝（架构篇第 06 节讲过）。
    code: |
      crowd/src/dialect/
        getEventTable()  ← core 没有这个
```

## 02 · 组织：五个目录的分工

```lane-stack
- title: 对外
  desc: 调用方只看这两个
  tone: green
  nodes:
    - { title: index.ts, sub: "63 行 · 统一出口" }
    - { title: context.ts, sub: "48 行 · SqlContext —— 唯一入口" }
  next: "模块层 :: :: 按业务场景分"

- title: modules/
  desc: 三个模块，各管一类业务场景
  tone: blue
  nodes:
    - { title: segmentation.ts, sub: "324 行 · 分群，最复杂" }
    - { title: tag.ts, sub: "105 行 · 标签" }
    - { title: crowd.ts, sub: "59 行 · 人群包" }
  next: "组合层 :: :: 把条件拼起来"

- title: combi/
  desc: 组合 + 二次加工 + 树结构修正
  tone: violet
  nodes:
    - { title: utils.ts, sub: "381 行 · 树修正与入口" }
    - { title: combination.ts, sub: "165 行 · AND / OR" }
    - { title: pkg.ts, sub: "123 行 · include / exclude" }
    - { title: interface.ts, sub: "63 行 · 结构类型" }
  next: "条件实现 :: :: 六种叶子"

- title: entrepots/
  desc: 六种条件各自的实现 + 工厂
  tone: violet
  nodes:
    - { title: event.ts, sub: "906 行 · 最复杂" }
    - { title: relation.ts, sub: "715 行" }
    - { title: portrait.ts, sub: "233 行" }
    - { title: factory.ts, sub: "192 行 · 工厂与分发" }
    - { title: "uid / crowd / rawSql", sub: "141 / 134 / 107 行" }

- title: dialect/ + ast/
  desc: 方言扩展；另一套独立的 AST
  tone: amber
  nodes:
    - { title: dialect/, sub: "比 core 多一个 getEventTable" }
    - { title: ast/, sub: "信号 DAG，独立体系" }
```

```callout
tone: amber
icon: ⚠
text: |
  **`combi/utils.ts` 有 381 行、导出 8 个函数，是第二难读的文件。**

  里面有一半是**历史包袱**：`isOldUidAdditionalStruct` / `isOldCrowdAdditionalStruct` /
  `optionCorrector` 都是给旧结构做兼容的，注释里直接写着「后续线上没有这个结构可以删除」。

  ==读的时候可以先跳过这些。==
```

## 03 · 组织：根文件与业务词汇表

`src/` 根下只有三个文件：

```cards
cols: 3
items:
  - title: define.ts
    tag: 43 行 · 起点
    tone: blue
    desc: |
      **所有业务枚举**：Entrepots / Tables / Modules / UidFields /
      CombineType / DimensionType / IntervalType / DbName。

      ==想知道「系统认识哪些表、哪些条件类型」，看这一个文件就够了。==
    code: |
      export enum Entrepots {
        Portrait = 'portrait',
        Event    = 'event',
        Relation = 'relation',
        Crowd    = 'crowd',
        Uid      = 'uid',
        RawSql   = 'rawSql',
      }
  - title: context.ts
    tag: 48 行 · 唯一入口
    tone: green
    desc: |
      **SqlContext**。选方言、构造三个模块，之后一路传下去。

      它把方言**注入**三个模块，模块持有方言实例。
    code: |
      SqlContext.create(DbType.Doris, { eventTableMap })
  - title: index.ts
    tag: 63 行 · 出口
    tone: muted
    desc: |
      统一出口。还聚合了一个 `utils` 对象，
      把零散工具打包给外部用。
```

```callout
tone: green
icon: ✅
text: |
  ==读 crowd 包，从 `define.ts` 开始。==

  43 行，但它是**整个业务词汇表**。看完你就知道：
  系统认识哪六种条件、有哪几个模块、查哪些表。

  然后再去看 `context.ts`（入口），最后才进 `entrepots/`（实现）。
```

## 04 · 架构：业务条件进来，`Rule[]` 出去

### 先更正一个容易搞错的地方

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**没有统一的 `adapter` 层。**==

  业务条件 → `Rule[]` 的翻译，是**每种条件自己做的** ——
  六种实现各写各的，没有一个公共的翻译函数。
```

```compare
first: 条件
head: [它内部的转换方法, 代码量]
rows:
  - 画像: ["`adapter()`（私有）+ `addHackRules()`", 233 行]
  - 事件: ["`getPropRules` / `getBaseRules` / `buildTimeRangRules` / `createMapPropRule` …（十几个）", 906 行]
  - 关系: ["`getDetailBaseRule` / `getPropRules` / `buildDetailSql` / `addHackRules` …", 715 行]
  - uid / 人群包 / rawSql: [{ text: "没有 —— 太简单，直接用", tone: muted }, "141 / 134 / 107 行"]
```

```callout
tone: amber
icon: ⚠
text: |
  **`addHackRules` 在 `portrait.ts` 和 `relation.ts` 里各有一份，逐字节相同。**

  这是复制粘贴的重复代码 —— 改一处不会同步另一处。
  ==看到「这里的行为不对」时，记得两份都要改。==
```

### 翻译长什么样：以画像为例

`portrait.ts` 里的 `adapter()` 是**递归函数**，处理一棵条件树：

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

**五个出口各产出什么**：

```compare
first: 分支
head: [产出, 真实数据]
rows:
  - "有 `logic`": ["**递归**，结构不变", "`{ logic: 'OR', items: [...] }` → 递归后塞回去"]
  - "有 `dateType`\\n且是相对时间戳": ["**调方言**，展开成 AND 子树", "`{ op: Gte, name: '..._time', value: 30 }` → `{ logic: AND, items: [3 个 Expression] }`"]
  - "有 `dateType`\\n其它时间": ["**调 utils**，展开成 AND 子树", "同上，但生成的是通用 Rule"]
  - "有 `rawValue`": ["改名 + 透传", "`{ op: Eq, name: 'c', rawValue: 'a+b' }` → `{ column: 'c', op: Eq, rawValue: 'a+b' }`"]
  - "普通条件": ["**只改名**", "`{ op: IN, name: 'city', value: ['杭州'] }` → `{ column: 'city', op: IN, value: ['杭州'] }`"]
  - "都不是": [{ text: throw, tone: red }, "`portrait adapter: 条件错误: {...}`"]
```

```callout
tone: violet
icon: 💡
text: |
  **看第 4 和第 5 行 —— 大部分条件其实只做了一件事：把 `name` 改成 `column`。**

  真正有分量的只有**时间条件那一支**（展开成一棵子树）。
  ==翻译之所以「轻」，是因为两套词汇用的是同一个树形结构。==
```

## 05 · 架构：时间条件为什么会「膨胀」

**一个输入条件，变成一棵子树。** 这是整个翻译里最有内容的一步。

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

    ==「值为 0」在时间戳语义里代表「从没发生过」==，
    不加会被当成「很久以前发生过」。
  next: "包一层 :: :: 强制 AND"

- tag: 输出
  tone: green
  name: "Rule[]"
  badge: 一棵子树
  code: |
    { logic: 'AND', items: [ 3 个 Expression ] }
  note: |
    **外面强制包一层 `logic: 'AND'`。** 见下一节。
```

```callout
tone: violet
icon: 💡
text: |
  **这一支还暴露了架构的一条裂缝。**

  上面写着「调方言**或** utils」—— 因为：

  - 相对时间 + **时间戳**格式 → 调**方言**（两个库的包装不一样）
  - 其它时间 → 调 **core 的 utils**（`getTimeRules`，通用逻辑）

  ==同一件事分了两条路，取决于属性格式。==
  而 `getTimeRules` 本身被**三个文件**调用：`portrait` / `event` / `relation`。
```

## 06 · 取舍：三个「为什么」

### 为什么时间条件要强制包一层 `AND`

```text
// portrait.ts · adapter()
const timeRules = addHackRules(rule.name, rule.op, timeExprs);
// 这里包装一层，因为 timeRules 必须是 And 的关系
// 而 result 这一层的关系可能是 Or
result.push({ logic: Logic.And, items: timeRules });
```

**代码注释直接给了答案。** 具体会错在哪：

```journey
- tag: 假设
  tone: muted
  name: 用户说的是
  code: |
    「最近 3 天加购过，或者是 VIP」
  note: |
    顶层是 `OR`，左边是时间条件，右边是画像条件。
  next: "不包 :: 展开 :: 直接塞进去"

- tag: 不包会怎样
  tone: red
  name: 三个条件平铺在 OR 里
  code: |
    >= 开始   OR   <= 结束   OR   是 VIP
  note: |
    ==语义完全错了。==

    任何时间都满足「>= 开始」，所以左边这一支**永远为真** ——
    等于「所有人都要」。
  next: "包一层 :: :: 把三个绑成一个"

- tag: 包一层
  tone: green
  name: 三个变成一个整体
  code: |
    (>= 开始 AND <= 结束)   OR   是 VIP
  note: |
    外层是 `AND`，把三个条件绑成一个节点，
    再参与上层的 `OR`。==语义就对了。==
```

```callout
tone: green
icon: ✅
text: |
  ==这就是「展开」必须配「包一层」的原因。==

  展开把一个条件变成三个 —— 但它们在语义上**仍然是同一个条件**。
  如果不包，上层逻辑会把它们当成三个独立的判断。
```

### 为什么没有一个统一的 `adapter`

**因为六种条件的翻译逻辑差得太远。**

```compare
first: 条件
head: [翻译的难点]
rows:
  - 画像: ["时间条件要展开、要补 hack 规则"]
  - 事件: ["事件名 + 时间范围 + 属性过滤 + 次数阈值，四件事都要处理"]
  - 关系: ["分 DETAIL / TIMES 两种形态，要判分区"]
  - uid / 人群包 / rawSql: [{ text: "基本没有难点，直接用", tone: muted }]
```

硬抽一个公共层，只会得到一堆「参数不一样、分支不一样」的 if。
==所以它选了「各写各的」，代价是 `addHackRules` 这种重复。==

### 为什么方言调用散在这一层

**因为方言是「业务条件遇到的具体问题」，不是「表达式树的通用问题」。**

```callout
tone: amber
icon: ⚠
text: |
  core 的 `buildWhere` 是**静态方法**，签名里没有 dialect —— 它不知道方言存在。

  所以所有方言调用都落在 `crowd` 里，散在 `portrait` / `event` / `relation` 各自的分支里。

  ==这是一条真实的架构裂缝。== 好在它有边界：
  方言方法都只返回「片段」或「表达式节点」，不生成 SQL（架构篇第 06 节）。
```

## 07 · 自测

```quiz
- q: "crowd 包在 core 之上加了哪三件事？"
  a: |
    ① **认识六种业务条件** —— 每种自己知道该查哪张表；
    ② **做集合运算** —— AND / OR（`UNION ALL + GROUP BY + HAVING`）和 include / exclude；
    ③ **处理库差异** —— 所有方言调用都在这一层，core 的 `buildWhere` 根本不知道方言存在。

- q: "有没有一个统一的 adapter 把业务条件翻译成 Rule[]？"
  a: |
    **没有。** 翻译是**每种条件自己做的** —— 六种实现各写各的，没有公共的翻译函数。
    画像有私有的 `adapter()`，事件有十几个 `getPropRules` / `getBaseRules` 之类的函数，
    uid / 人群包 / rawSql 基本没有转换逻辑。
    代价是 `addHackRules` 在 portrait 和 relation 里各有一份，逐字节相同。

- q: "「最近 30 天」这一个条件，为什么最后变成了三个条件？"
  a: |
    因为它在 SQL 里必须写成 `>= 开始 AND <= 结束` —— 一个语义，两个条件。
    某些操作符（`<` / `<=`）还要再加一个 `> 0`，否则会把「值为 0」
    误当成「很久以前发生过」（0 在时间戳语义里代表「从没发生过」）。

- q: "时间条件展开后，为什么要强制在外面包一层 logic: AND？"
  a: |
    因为展开出来的三个条件在语义上**仍然是同一个条件**，但上层逻辑可能是个 `OR`。
    不包的话，「最近 3 天 **或** 是 VIP」会变成
    「`>= 开始` **或** `<= 结束` **或** 是 VIP」——
    任何时间都满足「>= 开始」，左边这支永远为真，==等于所有人都要==。

- q: "读 crowd 包应该从哪个文件开始？"
  a: |
    `src/define.ts`（43 行）。它是**整个业务词汇表** ——
    系统认识哪六种条件、有哪几个模块、查哪些表，全在这里。
    然后再看 `context.ts`（入口），最后才进 `entrepots/`（实现）。
```
