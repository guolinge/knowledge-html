[组件图鉴](../combination-components/)讲了 11 个组件长什么样，[机制篇](../combination-mechanics/)讲了行为。这一篇只解剖一个文件：`src/draft.ts`，全文 273 行 —— **组件和编译器之间的协议本体**。

界面上每一样东西（范围下拉、条件组、三种行、值输入框）在这份协议里都有一个字段与它对应；界面允许的每种「没填完」，协议里都表现为「字段缺席」。读完这篇，你拿到任意一份 DraftQuery JSON 应该能直接说出它对应界面的什么状态。

```callout
tone: blue
icon: 🧭
text: |
  **这篇的解剖顺序**：先看类型全家的形状（01），再看判别字段怎么分派（02），
  然后逐字段过 DraftQuery 和三种叶子（03/04），最后是 buildQuery 这道闸
  （06）和两个工厂（07）。所有「谁写它」「缺省时是什么」都经过 tsx 实跑验证。
```

## 01 · 类型全家的形状

draft.ts 导出 7 个类型、3 个守卫、2 个工厂和 1 道闸（`buildQuery`），另有 12 个私有函数。类型结构是一棵和界面同构的树：

```tree
- label: DraftQuery
  sub: "version: 1"
  tone: violet
  note: 协议根。buildQuery 检查的第一样东西
  children:
    - label: scope
      sub: ScopeLeaf
      note: 客户范围叶子：self / team(groupIds) / all
    - label: include
      sub: "DraftTree | null"
      note: null = 没有任何包含条件；界面渲染时兜底一个空组
      children:
        - label: DraftTree
          sub: "logic: 'AND' | 'OR'"
          note: 条件组。children 混放四种节点
          children:
            - { label: DraftTree, sub: "递归", note: 嵌套组（界面只造两层） }
            - { label: DraftPortrait, sub: "value?" }
            - { label: DraftRelation, sub: "objects? value? props?" }
            - { label: UidLeaf, sub: "uids: string[]" }
    - label: exclude
      sub: "DraftTree | null"
      note: 结构支持，界面无编辑入口，commit 时原样保留
```

`?` 是这篇的主角。**草稿和 DSL 用的是同一棵树，区别全部落在可选性上**：草稿允许 `field: ''`、允许 `value` 缺席、允许 `objects` 空 —— 这些在 DSL（`InsightQuery`）里全部不合法。两者的大小关系是刻意维护的，测试里有一行类型断言：

```ts
type _legalQueryIsDraft = Expect<InsightQuery extends DraftQuery ? true : false>;
```

合法的 DSL 一定能当草稿用。所以「打开历史 DSL 回显」不需要任何转换，直接塞回组件；反方向（草稿 → DSL）才需要 `buildQuery` 收窄。

## 02 · 判别字段：switch 的依据

七个类型里除了 `DraftQuery` 和 `DraftProps`，都带一个字面量 `type` 字段。这不是装饰 —— 它是**判别联合（discriminated union）**的判别符，TypeScript 靠它收窄类型，运行时靠它分派渲染：

```compare
first: type 的取值
head: [渲染成什么, 由谁消费]
rows:
  - "'group'": [ConditionGroup（递归）, "buildTree"]
  - "'portrait'": [PortraitRow, "buildPortrait"]
  - "'relation'": [RelationRow, "buildRelation"]
  - "'uid'": [UidRow, "buildUid"]
```

三个守卫就是围绕判别字段的标准缩窄：

```ts
export function isDraftPortrait(node: DraftNode): node is DraftPortrait {
  return node.type === 'portrait';
}
// isDraftRelation / isDraftUid 同型
```

ConditionGroup 的模板里 `v-if="isDraftPortrait(entry.child)"` 三连选行组件，靠的就是它们；实跑验证过，group 节点对三个守卫都返回 false —— 它们只认叶子。

`DraftRelation` 里还藏着**第二个判别字段**：`formula: 'detail' | 'times'`。同一个关系叶子，公式不同，`op` 的合法集、`objects` 和 `value` 的语义全都不一样（04 节展开）。

## 03 · DraftQuery：根上的四个字段

| 字段 | 类型 | 谁写 | 缺席/边界 |
|------|------|------|-----------|
| `version` | `1`（字面量） | `createEmptyQuery()` | 不是 1 直接抛 `UNSUPPORTED_VERSION`，buildQuery 第一行就是查它 |
| `scope` | `ScopeLeaf` | ScopeBar 选择、`clampScope` 收窄 | 三种 kind 见下表；越权由服务端拒绝 |
| `include` | `DraftTree \| null` | ConditionSection | `null` 表示「不包含任何条件」，公式里 M 为空，结果只剩 U ∩ scope |
| `exclude` | `DraftTree \| null` | ——（界面不渲染） | commit 用 spread 合并，**不会被界面清掉** |

`scope` 的三种 kind，和「可选团队」字段的联动：

```compare
first: kind
head: [带什么, 谁能选]
rows:
  - "`self`": ["不带 groupIds（带了会报 INVALID_SCOPE）", "所有人可见"]
  - "`team`": ["groupIds: number[]，非空", "dataLevel ≥ team 的登录人"]
  - "`all`": ["不带 groupIds", "dataLevel = all 的登录人"]
```

`include` 为 `null` 和「包含一个空组」是两个不同的状态：前者是「我没圈任何条件」（合法，结果 = 权限内所有人），后者是界面上的空组，`buildQuery` 会放过它、由服务端抛 `EMPTY_GROUP`（06 节）。

## 04 · 三种叶子，逐字段

### DraftPortrait：特征行（4 个字段）

| 字段 | 类型 | 谁写 | 约束 |
|------|------|------|------|
| `type` | `'portrait'` | 工厂/守卫 | 判别字段 |
| `field` | `string` | ConditionNameSelect | 必须是 `crm_dc_portrait.field_key`；草稿里允许 `''`（还没选） |
| `op` | `Op` | PortraitRow 操作符下拉 | 必须落在 `applicableOps(shape)` 里 —— 形状四元组决定的，机制篇 03 节 |
| `value` | `unknown`（可选） | ValueControl | ==形状完全由 op 决定==，见下表 |

**value 是整个协议里唯一「一个字段、五种形状」的地方**，也是草稿半填状态的载体：

```compare
first: op 族
head: [value 形状, 实例, 填错时 buildQuery 说]
rows:
  - "`is_null` / `is_not_null`": [{ text: "不许有 —— 键都不该出现", tone: red }, '`{ "op": "is_null" }`', '`VALUE_TYPE`：does not take a value']
  - "`in` / `not_in`": ["`ScalarValue[]` 数组", '`{ "op": "in", "value": ["HK", "US"] }`', '`INCOMPLETE_LEAF`：requires an array']
  - "`between`": ["二元组 `[min, max]`", '`{ "op": "between", "value": [100, 500] }`', '`INCOMPLETE_LEAF`：requires [min, max]']
  - "`last_n_days` 等四种相对时间": ["正整数 number（填 N 本身，单位在操作符上）", '`{ "op": "last_n_days", "value": 30 }`', '`VALUE_TYPE`：requires a positive integer']
  - "`eq` / `neq` / `lt` / `lte` / `gt` / `gte`": ["标量：string \\| number \\| boolean", '`{ "op": "gte", "value": 1000000 }`', "缺了 `INCOMPLETE_LEAF`：requires a value"]
```

`ScalarValue` 是 `string | number | boolean` 三者之一 —— 没有 `null`，没有对象。日期和时间字段的值是 Unix 毫秒数（number），界面上的日期串只是 `ValueControl` 的显示层。

### DraftRelation：关系行（7 个字段）

| 字段 | 类型 | detail 公式下 | times 公式下 |
|------|------|--------------|--------------|
| `type` | `'relation'` | 判别字段 | 同左 |
| `relation` | `string` | 必填，= `crm_dc_relation.relation_key`；草稿允许 `''` | 同左 |
| `formula` | `'detail' \| 'times'` | 二级判别字段 | 同左 |
| `op` | `Op` | **只有** `in` / `not_in` | `eq/neq/lt/lte/gt/gte/between` 七个 |
| `objects` | `ScalarValue[]`（可选） | 必须非空（`[]` 会被服务端拦，06 节） | 可省；`[]` 与省略同义 = 不限标的 |
| `value` | `unknown`（可选） | **不许有**（写了报 `INCOMPLETE_LEAF`） | 次数：非负整数；`between` 时 `[min, max]` 且 `min ≤ max` |
| `props` | `DraftProps`（可选） | 可选 | 可选 |

`formula` 切换时字段语义整体翻转，这就是为什么它是判别字段而不是普通枚举。界面上切公式时 op 和 value 都会重置（组件图鉴 05 节的 times 截图）。

`props` 是关系行里嵌的第二个逻辑组：

```tree
- label: DraftProps
  tone: violet
  note: "作用在单条关系记录上的过滤条件"
  children:
    - { label: logic, sub: "'AND' | 'OR'", note: 属性之间怎么连 }
    - label: items
      sub: "DraftProp[]"
      note: 写出时必须非空
      children:
        - { label: DraftProp, sub: "field / op / value?", note: field = crm_dc_relation_attr.field_key，op/value 的形状约束与 portrait 完全同套 }
```

`qty ≥ 100` 编译出来是这一行的 `qty >= 100`，不是 `SUM(qty) >= 100` —— 协议层面就不存在聚合语义，属性只描述单条记录。

### UidLeaf：指定 UID（3 个字段，没有可选的）

```compare
first: 字段
head: [约束, 填错时]
rows:
  - "`op`": ["只有 in / not_in —— UID 叶子没有大小比较", "写了别的 op：`OP_NOT_ALLOWED`"]
  - "`uids`": ["`string[]`，==必填非空==，每项必须是字符串", "空/缺：`INCOMPLETE_LEAF`：uid leaf requires uids"]
```

UID 保字符串是协议级的决定：`9007199254740993` 超出 JS 安全整数，转 number 就错。解析、去重、500 截断发生在 UidRow 的输入层，协议只收干净的数组。

## 05 · 谁写哪个字段

协议的每个字段都有唯一的写入者，双向对得上：

```compare
first: 协议字段
head: [写入的组件, 什么时候写]
rows:
  - "`scope.kind` / `scope.groupIds`": [ScopeBar, "用户切范围；身份加载后 clampScope 可能替用户改写"]
  - "`include` 顶层（logic、组数）": [ConditionSection, "加组 / 删组 / 切组间逻辑"]
  - "`group.logic` / `children`": [ConditionGroup, "切行级逻辑；行的增删替换都在这层落地"]
  - "`portrait.field` / `relation`": [ConditionNameSelect, "级联下拉选中，带 field:/relation: 前缀"]
  - "`portrait.op`": [PortraitRow / RelationRow 的操作符下拉, "可选项来自 metadata.operators ∩ applicableOps"]
  - "`value`": [ValueControl, "defineModel 赋值，行组件包成新叶子上抛"]
  - "`relation.formula` / `objects` / `props.*`": [RelationRow, "公式切换、客体多选、属性过滤增删"]
  - "`uid.op` / `uids`": [UidRow, "粘贴文本 parseUids 后写入"]
```

反方向也成立：从一份 DraftQuery JSON 反推界面 —— `children` 里有多少个 group 就渲染几个灰色圆角块，一行 `type` 决定行组件，`props.items.length > 0` 决定关系行的属性区展不展开。协议即界面。

## 06 · buildQuery：草稿的守门员

`buildQuery(draft): InsightQuery` 是这份文件的主函数，273 行里它占了约 200 行。它做且只做**结构完整性检查** —— 不看 Metadata，不查字段存不存在、值类型对不对（那是服务端 `validateSemantics` 的事）。

按节点类型分派，每个 op 族一条检查路。下面交互里的错误码和报错文案全部是 tsx 实跑的真实输出：

```demo
widget: combination-build-lab
title: 喂 14 份草稿，看哪份活下来（协议视角复看）
actions: false
config:
  groups:
    - name: 根与组
      cases:
        - name: version 写成 2
          verdict: err
          code: UNSUPPORTED_VERSION
          message: "only version 1 is supported"
          draft: |
            { "version": 2, "scope": { "type": "scope", "kind": "self" },
              "include": null, "exclude": null }
        - name: 组缺 logic
          verdict: err
          code: INCOMPLETE_LEAF
          message: "group requires AND or OR"
          draft: |
            { "version": 1, "scope": { "type": "scope", "kind": "self" },
              "include": { "type": "group", "children": [] }, "exclude": null }
        - name: 空组
          verdict: ok
          draft: |
            { "version": 1, "scope": { "type": "scope", "kind": "self" },
              "include": { "type": "group", "logic": "OR",
                "children": [{ "type": "group", "logic": "AND", "children": [] }] },
              "exclude": null }
          out: |
            include 结构原样通过 —— children: [] 不检查
          server: "buildQuery 放行，服务端 `validateStructure` 抛
            `EMPTY_GROUP: group requires at least one child`（实跑确认）。
            ==空组是第二道两层防线的例子==。"
    - name: 特征行 value 形状
      cases:
        - name: 值没填
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait age requires a value"
          draft: |
            { "type": "portrait", "field": "age", "op": "gte" }
        - name: is_null 带了值
          verdict: err
          code: VALUE_TYPE
          message: "portrait age is_null does not take a value"
          draft: |
            { "type": "portrait", "field": "age", "op": "is_null", "value": 1 }
        - name: in 的值不是数组
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait city in requires an array"
          draft: |
            { "type": "portrait", "field": "city", "op": "in", "value": "深圳" }
        - name: 相对时间填了 0
          verdict: err
          code: VALUE_TYPE
          message: "portrait x last_n_days requires a positive integer"
          draft: |
            { "type": "portrait", "field": "x", "op": "last_n_days", "value": 0 }
    - name: 关系行两种公式
      cases:
        - name: detail 带 value
          verdict: err
          code: INCOMPLETE_LEAF
          message: "detail does not take a value"
          draft: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "in", "objects": ["00700.HK"], "value": 3 }
        - name: detail 用了 times 的 op
          verdict: err
          code: OP_NOT_ALLOWED
          message: "detail only allows in/not_in, got gte"
          draft: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "gte", "objects": ["00700.HK"] }
        - name: times 填负数
          verdict: err
          code: INCOMPLETE_LEAF
          message: "times requires a non-negative integer"
          draft: |
            { "type": "relation", "relation": "trade", "formula": "times",
              "op": "gte", "value": -1 }
        - name: times between 写反
          verdict: err
          code: VALUE_TYPE
          message: "times between requires min <= max"
          draft: |
            { "type": "relation", "relation": "trade", "formula": "times",
              "op": "between", "value": [3, 1] }
        - name: props 的 items 空
          verdict: err
          code: INCOMPLETE_LEAF
          message: "relation props require items"
          draft: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "in", "objects": ["00700.HK"],
              "props": { "logic": "AND", "items": [] } }
    - name: UID
      cases:
        - name: uid 列表为空
          verdict: err
          code: INCOMPLETE_LEAF
          message: "uid leaf requires uids"
          draft: |
            { "type": "uid", "op": "in", "uids": [] }
```

`buildQuery` 放过、服务端接住的情况（tsx 实跑）：

```compare
first: 输入
head: [buildQuery, validateStructure（服务端）]
rows:
  - "空组（children: []）": [{ text: "放行 —— 只查了 logic", tone: amber }, { text: "EMPTY_GROUP：group requires at least one child", tone: red }]
  - "detail 的 objects: []": [{ text: "放行 —— [] 是真值，if (!objects) 拦不到", tone: amber }, { text: "INCOMPLETE_LEAF：detail requires objects", tone: red }]
  - "times 的 objects: []": [{ text: "放行", tone: green }, { text: "也放行 —— 与省略同义：不限标的", tone: green }]
```

前两行是组件层守门员的两个漏点，第三行是刻意的宽容。调用方在提交前跑 `buildQuery` 拦住最明显的没填完，服务端在编译前把 `validateStructure` + `validateSemantics` 全部重跑 —— **信任的只有那条链，不是前端**。

## 07 · 两个工厂与省键的细节

draft.ts 还导出两个工厂，它们决定了草稿「刚出生时的样子」：

```ts
export function portraitDraft(field: string, op: Op, value?: unknown): DraftPortrait {
  if (value === undefined) return { type: 'portrait', field, op };
  return { type: 'portrait', field, op, value };
}

export function blankDetail(relation: string): DraftRelation {
  return { type: 'relation', relation, formula: 'detail', op: 'in', objects: [] };
}
```

`portraitDraft` 的三元分支看着多余，其实是在维护「**值缺席 = 键不存在**」这条协议约定。实跑验证：

```compare
first: 调用
head: [产物 JSON, "'value' in 对象"]
rows:
  - "`portraitDraft('age', 'gte')`": ["`{\"type\":\"portrait\",\"field\":\"age\",\"op\":\"gte\"}`", "——"]
  - "`portraitDraft('age', 'gte', undefined)`": ["同上，==没有 value 键==", { text: "false", tone: green }]
  - "`portraitDraft('age', 'gte', 18)`": ["`{...,\"value\":18}`", "true"]
```

如果工厂写成无条件带 `value: undefined`，草稿 JSON 会出现「有键但没值」的状态 —— 界面回显和 diff 时都要多解释一层。`blankDetail` 则定义了关系行的出生形态：detail 公式 + 存在 + 空客体数组（空数组在草稿里合法，代表「还没选标的」）。

三个守卫（`isDraftPortrait` / `isDraftRelation` / `isDraftUid`）只认叶子：对 group 节点全部返回 false（实跑确认）。它们是 ConditionGroup 模板里 `v-if` 三连的依据。

## 08 · 错误码清单

`buildQuery` 抛的全部错误码（与 SQL Builder 共用同一套 `CompileError`）：

| 码 | 什么时候抛 | 实跑文案示例 |
|----|-----------|--------------|
| `UNSUPPORTED_VERSION` | `version !== 1` | only version 1 is supported |
| `INCOMPLETE_LEAF` | 字段空、值缺、数组非数组、times 负数、props 空、detail 带值…… | portrait age requires a value |
| `VALUE_TYPE` | 值不是标量、相对时间非正整数、is_null 带值、between 写反 | times between requires min <= max |
| `OP_NOT_ALLOWED` | op 不属于该公式/叶子的合法集 | detail only allows in/not_in, got gte |
| `UNKNOWN_NODE` | type 不是四种之一（运行时兜底，TS 下不可达） | unknown node type |

每个错误都带一句话文案，指向具体字段 —— 组件图鉴 06 节的交互可以逐个触发它们。

```quiz
- q: '草稿里 value 缺席，JSON 里应该是没有这个键，还是写 "value": null？'
  a: |
    没有键。portraitDraft 工厂在 value === undefined 时不写这个键
    （'value' in 对象 === false，实跑验证）。协议里不存在 null 值 ——
    ScalarValue 是 string | number | boolean，null 既不是合法值也不表达「没填」。
    「没填」只由键缺席表达。
- q: detail 和 times 共用一个 DraftRelation 类型，协议怎么区分它们？
  a: |
    靠二级判别字段 formula。它决定其余字段的语义：op 的合法集
    （in/not_in vs 七个比较符）、objects（必须非空 vs 可省且 [] 同省略）、
    value（禁止 vs 次数）。buildRelation 先查 formula 再分派检查，
    界面上 RelationRow 切公式时 op 和 value 全部重置。
- q: '空组（children 为空数组）能通过 buildQuery，这说明协议允许空组吗？'
  a: |
    不允许。buildQuery 只检查了 group 的 logic，没查 children 非空 ——
    这是组件层守门员的漏点之一（实跑：放行）。服务端 validateStructure
    会抛 EMPTY_GROUP: group requires at least one child。空组、
    detail 空 objects 都是这个模式：组件层漏的，服务端那层接住。
```
