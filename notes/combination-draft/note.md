[组件图鉴](../combination-components/)讲了 11 个组件长什么样，[机制篇](../combination-mechanics/)讲了行为。这一篇解剖**协议本体**：DraftQuery 全家、每个字段的写入者和缺省边界，以及 `buildQuery` 这道闸。

2026-10-12 按最新代码（@ 7f2ec46）全文重写。上一次写这篇时协议住在 `packages/combination/src/draft.ts`；现在它搬进了 `@insight/dsl/src/draft.ts`（276 行），组合器和 BFF 从同一份协议重导出 —— 这是「包拆成 dsl 协议 + sql-builder 编译器」重构的一部分。

```callout
tone: blue
icon: 🧭
text: |
  **本篇结构**：协议现在住哪（00）→ 类型全家（01）→ 判别字段（02）→
  逐字段解剖（03/04）→ 谁写哪个字段（05）→ buildQuery 的闸（06）→
  工厂与省键（07）→ 错误码清单（08）。
  全部「谁写它」「缺省时是什么」「填错会说什么」都经过 tsx 实跑验证。
```

## 00 · 协议现在住在哪

拆包之后的依赖关系是一条直线：

```lane-stack
- badge: LAYER 01
  title: "@insight/dsl —— 协议包"
  desc: 只描述「条件长什么样」，不编译、不执行
  tone: blue
  nodes:
    - { title: src/draft.ts, sub: "276 行：Draft* 类型 + buildQuery + 工厂", tag: 本篇主角 }
    - { title: src/audience.ts, sub: "CrowdMetadata 全家、ValueSource", tag: 界面协议 }
    - { title: src/operators.ts, sub: "OPERATOR_DISPLAY：操作符三语名与模板", tag: 字典 }
  next: "组件和 BFF 各自 import :: :: 同一份类型，没有两套"

- badge: LAYER 02
  title: "@insight/combination —— 组件包"
  desc: 渲染界面，把人的操作变成草稿
  tone: violet
  nodes:
    - { title: src/draft.ts, sub: "3 行：从 @insight/dsl 重导出", tag: 转发 }
    - { title: relationDraft.ts, sub: "用关系主键属性生成出生草稿", tag: 新增 }
  next: "草稿经宿主提交 :: ::"

- badge: LAYER 03
  title: "@insight/sql-builder —— 编译器包"
  desc: 结构校验、语义校验、编译 SQL
  tone: green
  nodes:
    - { title: src/validate.ts, sub: "validateStructure / validateSemantics", tag: 第二层防线 }
    - { title: src/compile.ts, sub: "Validate → Resolve → Compile → Assemble", tag: 编译 }
```

`packages/combination/src/draft.ts` 现在的全部内容：

```ts
// DraftQuery 与 buildQuery 的实现放在 @insight/dsl，组件和 BFF 共用同一份协议。
export { buildQuery, blankDetail, isDraftPortrait, isDraftRelation, isDraftUid, portraitDraft } from '@insight/dsl';
export type { DraftNode, DraftPortrait, DraftProp, DraftProps, DraftQuery, DraftRelation, DraftTree } from '@insight/dsl';
```

搬家的同时协议加了一族新操作符（`eq_default` / `neq_default`，03 节），其余逐行未变 —— 旧版与新版的 diff 只有两处 import 路径和两个 eqDefault 分支。

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

`?` 是这篇的主角。**草稿和 DSL 用的是同一棵树，区别全部落在可选性上**：草稿允许 `field: ''`、允许 `value` 缺席、允许 `objects` 空 —— 这些在 DSL（`InsightQuery`）里全部不合法。两者的大小关系是刻意维护的，测试里有一行类型断言（搬包后仍在，`combination/test/build.spec.ts`）：

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

三个守卫（`isDraftPortrait` / `isDraftRelation` / `isDraftUid`）是围绕判别字段的标准缩窄，ConditionGroup 模板里 `v-if` 三连选行组件靠的就是它们。实跑验证过，group 节点对三个守卫都返回 false —— 它们只认叶子。

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
| `field` | `string` | ConditionNameSelect | 必须是元数据 `field_key`；草稿里允许 `''`（还没选） |
| `op` | `Op` | PortraitRow / TemporalOps | 必须落在 `applicableOps(shape)` 里 |
| `value` | `unknown`（可选） | ValueControl | ==形状完全由 op 决定==，见下表 |

**value 是整个协议里「一个字段、六种形状」的地方**，也是草稿半填状态的载体：

```compare
first: op 族
head: [value 形状, 实例, 填错时 buildQuery 说]
rows:
  - "`is_null` / `is_not_null`": [{ text: "不许有 —— 键都不该出现", tone: red }, '`{ "op": "is_null" }`', '`VALUE_TYPE`：does not take a value']
  - "`eq_default` / `neq_default`": [{ text: "同样不许有 —— ==和源数据默认值比较==", tone: red }, '`{ "op": "eq_default" }`', '`VALUE_TYPE`：does not take a value']
  - "`in` / `not_in`": ["`ScalarValue[]` 数组", '`{ "op": "in", "value": ["HK", "US"] }`', '`INCOMPLETE_LEAF`：requires an array']
  - "`between`": ["二元组 `[min, max]`", '`{ "op": "between", "value": [100, 500] }`', '`INCOMPLETE_LEAF`：requires [min, max]']
  - "`last_n_days` 等四种相对时间": ["正整数 number（填 N 本身，单位在操作符上）", '`{ "op": "last_n_days", "value": 30 }`', '`VALUE_TYPE`：requires a positive integer']
  - "`eq` / `neq` / `lt` / `lte` / `gt` / `gte`": ["标量：string \\| number \\| boolean", '`{ "op": "gte", "value": 1000000 }`', "缺了 `INCOMPLETE_LEAF`：requires a value"]
```

`ScalarValue` 是 `string | number | boolean` 三者之一 —— 没有 `null`，没有对象。日期和时间字段的值是**秒级 Unix 时间戳**（number；拆包重构把毫秒统一成了秒，`dsl/clock.ts` 出口就是秒）。

`eq_default` / `neq_default` 是拆包期间新增的一族：**连续型和时间型**字段如果配了默认值（`defaultValue` + `defaultExplain`），用户可以用「等于默认值 / 不等于默认值」圈人，值就是元数据里的那个默认值，草稿里不携带。`applicableOps` 只给带默认值的字段追加这两个 op（`fieldType.ts` 的 `hasDefaultValueOp`）。界面上它们显示成 `= 未发生交易` 这样的提示（默认值解释），TemporalOps 组件负责渲染。

### DraftRelation：关系行（7 个字段）

| 字段 | 类型 | detail 公式下 | times 公式下 |
|------|------|--------------|--------------|
| `type` | `'relation'` | 判别字段 | 同左 |
| `relation` | `string` | 必填，= 元数据 `relation_key`；草稿允许 `''` | 同左 |
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
        - { label: DraftProp, sub: "field / op / value?", note: field = 关系属性 field_key，op/value 的形状约束与 portrait 同套 —— ==但 eq_default/neq_default 在这里被明确禁止== }
```

关系属性上禁用默认值比较是 2026-10-12 实跑确认的新行为：往 props 里塞 `{ field: 'qty', op: 'eq_default' }` 会抛 `OP_NOT_ALLOWED: relation prop does not allow eq_default`。数量这类属性的默认值语义没有定义，协议干脆不收。`qty ≥ 100` 编译出来是这一行的 `qty >= 100`，不是 `SUM(qty) >= 100` —— 协议层面不存在聚合语义。

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
  - "时间/日期字段的 `op`": [TemporalOps, "模式选择：固定时间（> >= < <= = != + 默认值）或最近X天/X天之前"]
  - "其余 `op`": [PortraitRow / RelationRow 的操作符下拉, "可选项来自 metadata 操作符 ∩ applicableOps"]
  - "`value`": [ValueControl, "defineModel 赋值，行组件包成新叶子上抛"]
  - "`relation.formula` / `objects` / `props.*`": [RelationRow, "公式切换、客体多选、属性过滤增删"]
  - "`uid.op` / `uids`": [UidRow, "粘贴文本 parseUids 后写入"]
```

反方向也成立：从一份 DraftQuery JSON 反推界面 —— `children` 里有多少个 group 就渲染几个灰色圆角块，一行 `type` 决定行组件，`props.items.length > 0` 决定关系行的属性区展不展开。协议即界面。

## 06 · buildQuery：草稿的守门员

`buildQuery(draft): InsightQuery` 是 draft.ts 的主函数，276 行里它占了约 200 行。它做且只做**结构完整性检查** —— 不看 Metadata，不查字段存不存在、值类型对不对（那是服务端 `validateSemantics` 的事）。

按节点类型分派，每个 op 族一条检查路。下面交互里的错误码和报错文案全部是 tsx 实跑的真实输出（2026-10-12，对 `@insight/dsl` + `@insight/sql-builder`）：

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
          server: "buildQuery 放行，服务端 `validateStructure`（现住
            @insight/sql-builder）抛 `EMPTY_GROUP: group requires at least
            one child`（实跑确认）。==空组是第二道两层防线的例子==。"
    - name: 特征行 value 形状
      cases:
        - name: 值没填
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait age requires a value"
          draft: |
            { "type": "portrait", "field": "age", "op": "gte" }
        - name: eq_default 带了值
          verdict: err
          code: VALUE_TYPE
          message: "portrait aum eq_default does not take a value"
          draft: |
            { "type": "portrait", "field": "aum", "op": "eq_default", "value": 1 }
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
    - name: 关系行两种公式
      cases:
        - name: detail 的 objects 空
          verdict: ok
          draft: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "in", "objects": [] }
          out: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "in", "objects": [] }
          server: "**buildQuery 放过了它** —— `[]` 是真值，`if (!objects)` 拦不到。
            服务端 `validateStructure` 抛 `INCOMPLETE_LEAF: detail requires
            objects`。==两层防线里组件这层漏的一个，被服务端这层接住了==。"
        - name: detail 带了 value
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
        - name: 属性用 eq_default
          verdict: err
          code: OP_NOT_ALLOWED
          message: "relation prop does not allow eq_default"
          draft: |
            { "type": "relation", "relation": "holding", "formula": "detail",
              "op": "in", "objects": ["00700.HK"],
              "props": { "logic": "AND", "items": [{ "field": "qty", "op": "eq_default" }] } }
        - name: times 填负数
          verdict: err
          code: INCOMPLETE_LEAF
          message: "times requires a non-negative integer"
          draft: |
            { "type": "relation", "relation": "trade", "formula": "times",
              "op": "gte", "value": -1 }
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

## 07 · 三个工厂与省键的细节

draft.ts 导出两个工厂，组合包另有一个（`relationDraft`），它们决定了草稿「刚出生时的样子」：

```ts
// @insight/dsl/src/draft.ts
export function portraitDraft(field: string, op: Op, value?: unknown): DraftPortrait {
  if (value === undefined) return { type: 'portrait', field, op };
  return { type: 'portrait', field, op, value };
}

export function blankDetail(relation: string): DraftRelation {
  return { type: 'relation', relation, formula: 'detail', op: 'in', objects: [] };
}

// @insight/combination/src/relationDraft.ts —— 新增
export function relationDraft(metadata: ResolvedCrowdMetadata, name: string): DraftRelation {
  const relation = metadata.relations.find((item) => item.key === name);
  const items: DraftProp[] = (relation?.properties ?? [])
    .filter((prop) => prop.isPrimaryKey === 1 && !SUBJECT_FIELDS.has(prop.key))
    .map((prop) => {
      const op = applicableOps(prop)[0];
      return { field: prop.key, op: isOp(op) ? op : 'eq' };
    });
  const leaf = blankDetail(name);
  return items.length === 0 ? leaf : { ...leaf, props: { logic: 'AND', items: items } };
}
```

`portraitDraft` 的三元分支在维护「**值缺席 = 键不存在**」这条协议约定。实跑验证：

```compare
first: 调用
head: [产物 JSON, "'value' in 对象"]
rows:
  - "`portraitDraft('age', 'gte')`": ["`{\"type\":\"portrait\",\"field\":\"age\",\"op\":\"gte\"}`", "——"]
  - "`portraitDraft('age', 'gte', undefined)`": ["同上，==没有 value 键==", { text: "false", tone: green }]
  - "`portraitDraft('age', 'gte', 18)`": ["`{...,\"value\":18}`", "true"]
```

如果工厂写成无条件带 `value: undefined`，草稿 JSON 会出现「有键但没值」的状态 —— 界面回显和 diff 时都要多解释一层。

`relationDraft` 是拆包期间新增的：**出生即带主键属性过滤**。关系的元数据里标了 `isPrimaryKey` 的属性（排除 uid / object_id 这两个主体字段），自动生成一排待填的 props —— 「持有序号」这类主键属性就是关系记录的身份证，圈人几乎总要按它过滤。PortraitRow 把特征名换成关系名、RelationRow 换关系名，都用它生成出生草稿；`blankDetail` 退为它的无属性基底。

## 08 · 错误码清单

`buildQuery` 抛的全部错误码（与编译器共用同一套 `CompileError`，定义在 `@insight/dsl/errors.ts`）：

| 码 | 什么时候抛 | 实跑文案示例 |
|----|-----------|--------------|
| `UNSUPPORTED_VERSION` | `version !== 1` | only version 1 is supported |
| `INCOMPLETE_LEAF` | 字段空、值缺、数组非数组、times 负数、props 空、detail 带值…… | portrait age requires a value |
| `VALUE_TYPE` | 值不是标量、相对时间非正整数、is_null/eq_default 带值、between 写反 | portrait aum eq_default does not take a value |
| `OP_NOT_ALLOWED` | op 不属于该公式/叶子的合法集；属性上用默认值比较 | relation prop does not allow eq_default |
| `UNKNOWN_NODE` | type 不是四种之一（运行时兜底，TS 下不可达） | unknown node type |

服务端 `validateStructure` 另有一套同码异文的检查（比如版本错报 `DSL version must be 1`，空组报 `EMPTY_GROUP`）—— 码相同、文案各自措辞，调用方按码分派即可。

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
- q: eq_default 和 is_null 都是无值操作符，它们的区别是什么？关系属性上为什么禁止 eq_default？
  a: |
    is_null 判断「这一列是不是 SQL NULL」；eq_default 判断「这一列的值是否等于
    元数据配置的默认值」—— 值来自元数据的 defaultValue，草稿里不携带，
    所以它也是无值操作符。关系属性上没有「默认值」的语义（数量、市场这类
    属性不存在约定的缺失值），协议直接禁止：OP_NOT_ALLOWED。
- q: '空组（children 为空数组）能通过 buildQuery，这说明协议允许空组吗？'
  a: |
    不允许。buildQuery 只检查了 group 的 logic，没查 children 非空 ——
    这是组件层守门员的漏点之一（实跑：放行）。服务端 validateStructure
    （现住 @insight/sql-builder）会抛 EMPTY_GROUP: group requires at least
    one child。空组、detail 空 objects 都是这个模式：组件层漏的，服务端那层接住。
```
