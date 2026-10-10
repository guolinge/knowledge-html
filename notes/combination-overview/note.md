运营在圈选页点了几下：客户范围 = 本人，加一条「总资产 ≥ 100 万」，再粘贴一批 UID。这些下拉框、条件组、AND/OR 开关，全都不是洞察子应用自己写的，它们来自一个独立的 Vue 组件包 `@insight/combination`。

这个包 22 个文件、2891 行。它的活可以一句话说完：**把 Metadata 渲染成圈选界面，把人的操作变成一份叫 DraftQuery 的草稿**。至于草稿怎么变成 SQL，它不管。

```callout
tone: blue
icon: 🎯
text: |
  **这篇回答三个问题**：

  - 它在整条链路的哪个位置，边界在哪？
  - 「受控组件」「草稿」「DSL」「Metadata」这几个词各自指什么？
  - 包里的 22 个文件怎么分工？

  每个控件怎么决策、候选值怎么加载、草稿怎么被检查，在[机制篇](notes/combination-mechanics.html)。
```

## 01 · 它在哪条链路上

一次圈选预览要穿过四层。组件包住在第二层，上面吃 Metadata，下面把草稿交给宿主。

```lane-stack
- badge: LAYER 01
  title: 元数据层
  desc: 字段、关系、操作符的定义与物理映射，只有 Data Admin 能写
  tone: muted
  nodes:
    - { title: "Data Admin（MySQL）", sub: "crm_dc_portrait / crm_dc_relation / ...", tag: 写 }
    - { title: AudienceMetadata, sub: "GET /api/audience/metadata 的投影", tag: 读 }
  next: "宿主拉一次 Metadata，全量传给组件 :: :: 组件自己不发请求"

- badge: LAYER 02
  title: 组件层 —— 这个包在这里
  desc: 把 Metadata 渲染成界面，把操作变成草稿
  tone: blue
  nodes:
    - { title: InsightCombiner, sub: "壳：props 进、草稿事件出", tag: "11 个 .vue" }
    - { title: DraftQuery, sub: "允许半填的编辑中间态", tag: "10 个 .ts" }
  next: "宿主在提交前调 buildQuery :: :: 组件只抛变更，不提交"

- badge: LAYER 03
  title: 提交与校验
  desc: 草稿收窄成 DSL，服务端再查一遍
  tone: violet
  nodes:
    - { title: buildQuery(draft), sub: "结构完整性检查，包内实现", tag: 调用方调 }
    - { title: 服务端校验+编译, sub: "validateStructure + Semantics → compile", tag: "@insight/dsl" }
  next: "SQL 交给 DAL :: :: 组件对这一层不可见"

- badge: LAYER 04
  title: 执行层
  desc: 活查预览、异步快照
  tone: green
  nodes:
    - { title: countSql / listSql / uidsSql, sub: "同一段 WHERE，四种外层", tag: compile 产物 }
    - { title: "DAL → Doris", sub: "预览同步，快照异步", tag: 执行 }
```

技术方案给这个包画了很清楚的边界：**不绑定具体 HTTP 接口，不生成 SQL，也不连接数据库**。三件事都推给了别人：

```checklist
tone: cross
items:
  - "发请求 —— 候选值的加载函数由宿主注入（`loadValueSet` / `searchValues` 两个 props）"
  - "生成 SQL —— 那是 `@insight/dsl` 的事，组件只产出 DSL 的输入（草稿）"
  - "连数据库 —— 它连 Catalog 都不拿，物理表名列名对组件不可见"
```

## 02 · 受控组件：草稿的真相在宿主手里

`modelValue` 的类型是 `DraftQuery`。宿主用 `v-model` 持有它，组件在任何操作之后生成一份**新的**草稿对象抛出来，自己不保存、也不修改传入的东西。

```flow
grid: true
groups:
  - { id: pkg, label: "@insight/combination", tone: blue }
nodes:
  - { id: host,  label: 宿主持有草稿, sub: "const query = ref(createEmptyQuery())", row: 0, kind: frontend }
  - { id: props, label: props.modelValue, sub: "DraftQuery", row: 1, group: pkg }
  - { id: ui,    label: 渲染界面, sub: "10 个子组件按 Metadata 渲染", row: 2, group: pkg }
  - { id: act,   label: 用户操作, sub: "选字段 / 切操作符 / 填值 / 加组", row: 3, group: pkg }
  - { id: next,  label: 生成新草稿, sub: "{ ...旧草稿, 改动的那一片 }", row: 4, group: pkg }
  - { id: emit,  label: "emit(update:modelValue)", sub: "组件到此为止", row: 5, group: pkg, tone: green }
  - { id: back,  label: 宿主赋回 v-model, sub: "回到 props，循环闭合", row: 6, kind: frontend }
edges:
  - { from: host, to: props }
  - { from: props, to: ui, dashed: true }
  - { from: ui, to: act, dashed: true }
  - { from: act, to: next, dashed: true }
  - { from: next, to: emit, dashed: true }
  - { from: emit, to: back, label: 新草稿 }
```

组件包内部那五步（虚线）是纯计算：旧草稿 + 用户操作 = 新草稿。最后一格的赋值是宿主的事，赋回之后 props 变了，从渲染那格重新走一遍，循环闭合。为什么这么设计？因为草稿的真相只在宿主手里，组件无权改它；宿主也就有机会在接收前做处理，比如异步收窄 scope（机制篇 06 节）。

demo 宿主（`apps/client/src/App.vue`）的接法：

```html
<InsightCombiner
  v-model="query"
  :metadata="metadata"
  :load-value-set="loadValueSet"
  :search-values="loadSearch"
  :data-level="dataLevel"
  :groups="visibleGroups"
>
  <template #scope-prefix>…模拟身份切换…</template>
</InsightCombiner>
```

组件对外的全部接口就这些：

| prop | 类型 | 干什么 |
|------|------|--------|
| `modelValue` | `DraftQuery` | 圈选草稿，v-model 绑定 |
| `metadata` | `AudienceMetadata` | 字段、关系、操作符、业务域 |
| `dataLevel` | `'self' \| 'team' \| 'all'` | 当前登录人的数据级别 |
| `groups` | `{id,name}[]` | 可见团队，team 范围的选项 |
| `scopeReady` | `boolean`（默认 true） | 身份加载完了吗，没好不收窄 |
| `loadValueSet` | `(setKey) => Promise<ValueItem[]>` | 宿主封装的值集合加载 |
| `searchValues` | `(resolverKey, keyword) => Promise<ValueItem[]>` | 宿主封装的动态候选搜索 |
| 事件 | `update:modelValue` | 唯一的业务事件，参数是新草稿 |
| 插槽 | `scope-prefix` | 范围选择器上方的一块地（demo 放了身份模拟器） |

## 03 · 草稿与 DSL：两个长得像的类型

草稿和 DSL 的结构几乎一样，差别只有一条：**草稿允许半填，DSL 必须完整**。刚新增一条条件、只选了字段还没选操作符、区间只填了一端，都是合法草稿，但不许提交。

```tree
- label: DraftQuery
  sub: 组件对外协议
  tone: violet
  note: "version: 1, scope, include, exclude"
  children:
    - label: scope
      note: 客户范围叶子：self / team(groupIds) / all
    - label: include
      sub: "DraftTree | null"
      note: 界面只渲染这一块
      children:
        - label: group
          sub: "logic: 'AND' | 'OR'"
          note: 条件组，children 混放三种叶子
          children:
            - { label: DraftPortrait, note: "field + op + value?" }
            - { label: DraftRelation, note: "relation + formula(detail|times) + objects? + props?" }
            - { label: UidLeaf, note: "op: in|not_in + uids[]" }
    - label: exclude
      sub: "DraftTree | null"
      note: 结构支持，本期界面没有编辑入口
```

同样的条件在两个状态下的样子：

```journey
- tag: 草稿 · 编辑中
  tone: amber
  name: DraftQuery.include
  code: |
    {
      "type": "portrait",
      "field": "aum_hkd",
      "op": "gte"
      // value 还没填 —— 合法
    }
  note: 组件的日常状态。**buildQuery 会在这一步抛 INCOMPLETE_LEAF。**
  next: "用户填入 1000000 :: ::"

- tag: DSL · 可提交
  tone: green
  name: InsightQuery.include
  code: |
    {
      "type": "portrait",
      "field": "aum_hkd",
      "op": "gte",
      "value": 1000000
    }
  note: buildQuery 的产物。服务端在这个基础上做语义校验和编译。
```

| 内容 | 草稿 DraftQuery | DSL InsightQuery |
|------|----------------|------------------|
| 字段、关系、操作符 | 可以是 `''`、未选 | 必填，且 op 合法 |
| 值 | 缺失、半填都行 | 按 op 给标量 / 数组 / 区间 |
| 关系 objects | 可以不填 | detail 必须非空；times 可省 |
| 关系 props | 属性条件可以半填 | 写出时必须 logic + 完整 items |
| 谁产生 | 组件，随时 | 调用方调 `buildQuery(draft)` |

两个类型的关系是刻意的，测试文件里有一行类型断言：

```ts
type _legalQueryIsDraft = Expect<InsightQuery extends DraftQuery ? true : false>;
```

合法的 DSL 一定能当草稿用。所以「打开一张历史 DSL 回显」不需要转换，直接塞回组件就行；反方向才需要 `buildQuery` 收窄。错误码也是共用的：`buildQuery` 抛的 `CompileError` 来自 `@insight/dsl`，服务端编译器抛同一套码。

## 04 · Metadata：组件吃进去什么

`metadata` prop 是一份 `AudienceMetadata`，由服务端从 `crm_dc_*` 那批表投影出来（那条线在[配置层那篇](notes/data-admin-to-ui.html)）。组件拿到的版本**没有表名和列名**，只有业务语义：

```cards
cols: 3
items:
  - { title: revision, desc: "这份投影的哈希，任一条状态或文案变化都会变", tag: 整数, tone: muted }
  - { title: domains, desc: "业务域树，字段的分组菜单按它长", tag: 树, tone: blue }
  - { title: operators, desc: "扁平操作符列表：key、多语言名、排序，相对时间带 template", tag: 字典, tone: blue }
  - { title: features, desc: "画像特征。每条带自己的 valueSource", tag: 主体, tone: violet }
  - { title: relations, desc: "关系。客体在关系上，属性挂在 properties 里", tag: 主体, tone: violet }
```

每条 feature / 关系属性身上都背着同一组**形状四元组**。组件里所有的「该显示什么」，追到底都是这四个字段决定的：

```cards
cols: 4
items:
  - { title: variableType, desc: "`enum`（枚举）或 `range`（非枚举）。决定操作符家族", tone: blue }
  - { title: dataType, desc: "`long` / `double` / `string` / `boolean`。决定值长什么样", tone: blue }
  - { title: contentType, desc: "0 普通、1 日期、2 时间、3 金额、7 城市……决定相对时间操作符和控件形态", tone: violet }
  - { title: enumType, desc: "`none` / `custom` / `value_set` / `dynamic`。决定候选值从哪来", tone: violet }
```

候选值来源单独说。同一个「值输入框」，四种字段的加载方式完全不同：

```compare
first: valueSource
head: [候选值在哪, 什么时候到手]
rows:
  - "`NONE`": ["没有候选值", "不加载，控件形态由 `controlFor` 决定"]
  - "`CUSTOM`": ["就带在 Metadata 里（items 数组）", "==组件拿到就可用，零请求=="]
  - "`VALUE_SET`": ["共享值集合，字段上只有 setKey", "下拉打开时调宿主注入的 `loadValueSet`，宿主侧缓存"]
  - "`DYNAMIC`": ["字段上只有 resolverKey（如 stock_search）", "输入关键词后调 `searchValues`，按需搜索"]
```

`CUSTOM` 和 `VALUE_SET` 的条目都带 `status`，停用的候选值照样返回：新建条件只用 ENABLED，回显旧条件时按 value 找回 label。`DYNAMIC` 没有停用态，已选值不在搜索结果里时用草稿里的原值回显。

## 05 · 包的地图

### 组件树

11 个 `.vue`。行数是 `wc -l` 实测，差距很大：最复杂的 RelationRow 是最简单的 UidRow 的近六倍。

```tree
- label: InsightCombiner.vue
  sub: 148 行
  tone: violet
  note: 壳。接 props、provide 两个加载函数、watch 收窄 scope
  children:
    - label: ScopeBar.vue
      sub: 151
      note: 客户范围。选项列表由 dataLevel 算出
    - label: ConditionSection.vue
      sub: 293
      note: 包含区。多组时显示组间 AND/OR，组可增删
      children:
        - label: ConditionGroup.vue
          sub: 263
          note: 条件组。行级 AND/OR、幽灵行、每组一个 UID
          children:
            - { label: ConditionRow.vue, sub: 70, note: 行外壳：类型标签 + 删除按钮 }
            - { label: PortraitRow.vue, sub: 147, note: 特征行：字段/操作符/值 }
            - { label: RelationRow.vue, sub: 507, note: 关系行。detail/times、客体多选、嵌套 props 过滤 }
            - { label: UidRow.vue, sub: 89, note: 指定 UID。粘贴解析、去重、500 截断 }
    - label: ConditionNameSelect.vue
      sub: 110
      note: 业务域级联下拉，特征和关系混在一个菜单里
    - label: LogicToggle.vue
      sub: 120
      note: AND/OR 胶囊 + 上下连接线（ResizeObserver 量的）
    - label: ValueControl.vue
      sub: 233
      note: 值控件。七种形态一个组件，形态由 controlFor 决定
```

### 非 Vue 的部分

逻辑全部在这 10 个 `.ts` 里，`.vue` 只做渲染和事件转发：

```spec
title: packages/combination/src 的 TypeScript 层
subtitle: "10 个文件 · 按行数排"
tone: violet
rows:
  - k: draft.ts (273)
    v: |
      **类型 + buildQuery**。DraftQuery 全家类型定义在这，草稿收窄成 DSL 的完整性检查也在这。它是组件与编译器之间唯一的关口。
  - k: query.ts (85)
    v: |
      **草稿工厂和纯函数**。建空查询/空组/各类叶子、加组加叶、`clampScope` 收窄、`parseUids` 粘贴解析。全部是无副作用的纯函数，好测。
  - k: audience.ts (96)
    v: |
      **AudienceMetadata 类型**。整包对 Metadata 的理解都在这份类型里，和 `@insight/dsl` 的 `fieldType` 解耦。
  - k: values.ts (56)
    v: |
      **候选值组合式函数**。CUSTOM 直取、VALUE_SET 加载（带过期票据防竞态）、DYNAMIC 搜索函数缓存。
  - k: ops.ts (37)
    v: |
      **操作符常量**。中文标签表、三种公式各允许哪些 op（`RELATION_DETAIL_OPS` / `RELATION_TIMES_OPS` / `UID_OPS`）。
  - k: messages.ts (152)
    v: |
      **三语言文案**。zh-CN / zh-HK / en，同一份 key。界面上的字只有两个来源：这份文件和 Metadata 里的多语言名。
  - k: label.ts (14)
    v: |
      **useLabel()**。取多语言名的回退链：当前语言 → zh-CN → zh-HK → en。
  - k: conditionKey.ts (13)
    v: |
      **下拉的 key 前缀**。`field:xxx` / `relation:xxx`。特征和关系混在同一个级联菜单里，选完靠前缀分回去。
  - k: context.ts (6)
    v: |
      **两个注入 key**。`loadValueSet` / `searchValues` 的 Symbol，provide 在壳里，inject 在值控件里。
  - k: index.ts (23)
    v: |
      **导出面**。默认导出组件 + buildQuery + 草稿工厂 + 类型。宿主（和测试）只从这里 import。
```

### 它借了 @insight/dsl 的什么

依赖方向是一条直线：`apps/client → @insight/combination → @insight/dsl`。组合包对 dsl 的引用一共 17 处 import，分布在 5 个子模块：

```compare
first: 引自
head: [几处 import, 借的是什么]
rows:
  - "`@insight/dsl/ast`": ["8", "Ops 常量、四种叶子的构造函数（`portraitLeaf` 等）、类型守卫（`isCompareOp` / `isScalarValue` / `isCountPair`）"]
  - "`@insight/dsl/fieldType`": ["4", "==`applicableOps` 和 `controlFor`== —— 控件决策引擎，机制篇 03 节的主角"]
  - "`@insight/dsl/context`": ["3", "`DataLevel` / `Actor` 类型（scope 收窄用）"]
  - "`@insight/dsl`": ["1", "`CompileError` —— buildQuery 抛的错误码和编译器共用"]
  - "`@insight/dsl/clock`": ["1", "时区换算：日期控件显示的字符串 ↔ Unix 毫秒"]
```

UI 依赖是 element-plus（全套控件）和 vue-i18n（文案）。除此之外没有别的运行时依赖。

## 06 · 继续往下

- [组件图鉴](notes/combination-components.html)：11 个组件的真实渲染截图、每个的对外接口、拆分依据与五层数据流。
- [机制篇](notes/combination-mechanics.html)：受控数据流的实现、一行怎么长出来（幽灵行与 convert）、控件决策引擎、候选值三条管道、buildQuery 检查清单、scope 收窄，每节配可操作的交互。
- [配置层那篇](notes/data-admin-to-ui.html)：Metadata 从 MySQL 到 `AudienceMetadata` 投影的那条线，含停用字段的回显规则。
- [@insight/dsl 那篇](notes/insight-dsl.html)：`buildQuery` 产出的 DSL 之后怎么被校验、编译成 SQL。

```quiz
- q: 组件里用户填到一半的条件（还没选操作符）存在哪？存在组件里吗？
  a: |
    不在。组件是受控的：草稿的真相在宿主手里（`v-model` 绑的 `ref`）。
    组件每次操作都生成一份新草稿对象抛给宿主，自己只留展开状态这类临时 UI 状态。
    组件销毁重建，草稿也不丢 —— 因为它从来没在组件里住过。
- q: 草稿和 DSL 为什么分成两个类型，而不是一个？
  a: |
    编辑是允许中间态的：只选字段不填值、区间只填一端，都必须能在界面上活着。
    提交是另一回事：DSL 必须完整才能被编译。`buildQuery(draft)` 是两个状态之间唯一的关口，
    它抛的错误码（INCOMPLETE_LEAF 等）和 SQL Builder 共用一套。
- q: 组件需要知道字段对应数据库里哪张表哪一列吗？
  a: |
    完全不需要。`AudienceMetadata` 投影里没有表名列名，Catalog（物理映射）只发给
    Node BFF 侧的编译器。组件连 Catalog 都拿不到，这是「DSL 与物理模型解耦」在组件侧的体现：
    新增一个字段只改元数据，组件和 SQL Builder 都不用发版。
```
