[组件图鉴](../combination-components/)给了 11 个组件的长相和对外接口，[机制篇](../combination-mechanics/)讲了草稿和校验。这一篇钻进 `src/components/` **文件夹本身**：10 个 `.vue` 逐个拆 —— 它提供什么功能、谁渲染它、它渲染谁、props 怎么进、事件怎么出、内部状态有哪些。每节配一张真实渲染截图。

```callout
tone: blue
icon: 🧭
text: |
  **口径说明（实事求是）**

  - 代码版本：`crm-dsl-stru @ e8858fb`（2026-10-11）。行数、行为都以这一版为准。
  - 截图：真实渲染 —— 把组件单独挂到空页面上跑，Playwright 逐元素截图。
    数据是 fixture，但形状照 `apps/seed/src/demoCatalog.ts` 抄；独立挂载时按宿主契约
    `provide` 了 `loadValueSet / searchValues / lookupValues` 三个加载函数。
  - 标「实跑」的行为是 Playwright 真点击/真输入观察到的，不是从源码推的。
  - ⚠ 前两篇写在 10-10（更早的代码）：那里说的「Unix 毫秒」「动态候选只有 search」
    已经过期 —— 现在是**秒级时间戳**，动态候选多了一条 `resolve` 回显通道（本篇 11 节）。
```

## 01 · 先看父子关系

```tree
- label: InsightCombiner.vue
  sub: src/（不在 components/ 里）
  tone: violet
  note: 外层壳：provide 三个加载函数、收窄 scope、只渲染 include
  children:
    - { label: ScopeBar.vue, sub: 151, note: 客户范围；无子组件 }
    - label: ConditionSection.vue
      sub: 293
      note: 包含区；组间逻辑（≥2 组）+ 组增删
      children:
        - { label: LogicToggle.vue, sub: 120, note: 组间 AND/OR（第一处复用） }
        - label: ConditionGroup.vue
          sub: 263
          note: 条件组：行级逻辑、幽灵行、每组一个 UID、行类型 convert
          children:
            - { label: LogicToggle.vue, sub: 120, note: 行级 AND/OR（第二处复用） }
            - label: ConditionRow.vue
              sub: 70
              note: 行外壳：slot + 删除按钮
              children:
                - { label: PortraitRow.vue, sub: 161, note: 特征行 }
                - { label: RelationRow.vue, sub: 530, note: 关系行；内含第三处 LogicToggle }
                - { label: UidRow.vue, sub: 89, note: 指定 UID 行 }
    - label: 被两行共用的小件
      note: 都由行组件直接 import
      children:
        - { label: ConditionNameSelect.vue, sub: 110, note: 业务域级联；两处复用 }
        - { label: ValueControl.vue, sub: 253, note: 值控件七形态；两处复用 }
```

同一条链上每一跳传什么、发什么，一张表看完：

```compare
first: 父子边
head: [props 往下传, 事件往上抛]
rows:
  - "InsightCombiner → ConditionSection": ["`includeTree`（`modelValue.include ?? createEmptyInclude()`）+ 整份 `metadata`", "`update:modelValue`（整棵 include 树）"]
  - "ConditionSection → ConditionGroup": ["`entry.child`（组节点）+ `metadata`", "`update:modelValue`（替换后的组）"]
  - "ConditionSection/Group → LogicToggle": ["`modelValue`（'AND' 或 'OR'）", "`update:modelValue`"]
  - "ConditionGroup → ConditionRow": ["无（slot 直通）+ `@delete` 绑定在真实行上", "`delete`"]
  - "ConditionRow → Portrait/Relation/UidRow": ["slot 内容", "行组件自己的 `update` / `convert`"]
  - "行组件 → ConditionNameSelect": ["`modelValue`：`field:city` 或 `relation:holding`", "`update:modelValue`（带前缀的 key）"]
  - "行组件 → ValueControl": ["`inputForm` / `valueType` / `items` / `search` / `resolveSelected` / `prefix` / `suffix` + `modelValue`", "`update:modelValue`（标量、数组或区间）"]
  - "InsightCombiner ⇢ 行组件（跨层）": ["三个注入 key：`loadValueSet` / `searchValues` / `lookupValues`（`context.ts`）", "无（单向）"]
```

跨层那条是这张图里唯一一条「跳层」的边：三个加载函数从壳 `provide`，行组件和值控件在任意深度直接 `inject`。除此之外所有通信都是「props 下、事件上」，逐层不越级。

## 02 · ConditionSection —— 包含区容器

```shot
img: 03-section
alt: ConditionSection 两组状态
caption: 两组状态：左侧「或者」是组间逻辑，灰色圆角块是 ConditionGroup，右上 × 删组，底部「+ 条件组」。按钮的名字都来自 i18n（messages.ts），不是硬编码。
```

```shot
img: 12-section-empty
alt: ConditionSection 空态
caption: 空态：草稿里只有一个空组，组里渲染出「幽灵行」（请选择条件）。幽灵行不住在草稿里 —— 它是 ConditionGroup 在 children 为空时渲染的常量，选中字段后才真正入树（机制篇 02 节）。
```

| 项 | 内容 |
|----|------|
| 功能 | 包含区的标题与描述、组间逻辑开关（≥2 组才出现）、组的新增/删除 |
| props 进 | `title`、`description?`、`accent`（include/exclude 决定标题颜色）、`modelValue`（含组树的 `DraftTree`）、`metadata`、`minGroups`（默认 0，壳传 1） |
| 事件出 | `update:modelValue`（新的 section 树） |
| 子组件 | `ConditionGroup`（v-for 渲染每个组）、`LogicToggle`（组间） |
| 局部状态 | `bodiesEl` + `ResizeObserver` → `groupLogicMargin`：量最后一行的高度，决定组间胶囊的上下留白（基准 `GROUP_ANCHOR = 28`）。纯排版状态，不进草稿 |
| 要点 | `groups` 只挑 `type === 'group'` 的子节点渲染 —— 如果草稿在 section 下直接挂了叶子节点，界面上会**静默不渲染**（正常流程不会出现，但组件不报错）；删除有 `minGroups` 兜底，删不到 0 组 |

数据流只有一个形状：**任何操作 → 换掉 section 树 → emit**。`replace(index, group)` 替换第 index 个子节点、`remove(index)` 过滤掉它、`onAddGroup()` 追加一个空组（`createEmptyGroup()`，组内默认 AND）、`onLogic()` 改组间逻辑。

## 03 · ConditionGroup —— 条件组

```shot
img: 04-group
alt: ConditionGroup 三行混排
caption: 特征行 + 关系行 + UID 行混排；左胶囊是行级逻辑。「+ 条件」「+ 指定UID」一行在底部；这组里已经有 UID，所以「+ 指定UID」不再出现。
```

| 项 | 内容 |
|----|------|
| 功能 | 行级 AND/OR；三种叶子混排渲染；幽灵行；每组最多一个 UID；行类型切换（convert）的分流 |
| props 进 | `modelValue`（组节点）、`metadata` |
| 事件出 | `update:modelValue`（新的组） |
| 子组件 | `ConditionRow`（外壳）、`PortraitRow` / `RelationRow` / `UidRow`（按叶子类型三选一）、`LogicToggle`（行级） |
| 局部状态 | `rowsEl` + `ResizeObserver` → `logicMargin`（基准 `CONTROL_CENTER = 16`）；纯排版 |
| 要点 | `rowKey` = `portrait-<index>-<field>` 这类组合，保证换行类型时 DOM 重建；幽灵行分支的 `PortraitRow` 喂的是常量 `EMPTY_PORTRAIT`，不进草稿 |

数据流是这一层最密的，四条路径分开看：

| 触发 | 走到哪 | 结果 |
|------|--------|------|
| 幽灵行上选了字段/关系 | `commitDraft` → `addLeaf` | 叶子**第一次入树**（幽灵行变成真实行） |
| 已有行改了字段/操作符/值 | 行组件 `update` → `replace(index, leaf)` | 原位替换，其他行不动 |
| 行组件判断类型要换 | `convert` → 界面多行时 `replace`、幽灵行时 `addLeaf` | 特征行 ↔ 关系行互换，op 重置为新类型第一个合法值 |
| 删行 / 加行 / 加 UID | `remove` / `addCondition` / `addUid` | 组内 `children` 过滤或追加；加 UID 前 `addLeaf` 会拦截第二个 UID |

```callout
tone: amber
icon: 🔎
text: |
  **两条实跑观察（2026-10-12 真实点击）**

  ① 空组点一次「+ 条件」= **两行**：初始 1 行（幽灵）→ 点击后 2 行（两行都是空特征行）。
  ② 空组点「+ 指定UID」= 一行空特征行 + 一行 UID。

  源码里两个函数共用同一段 base 逻辑（`leaves.length === 0` 时先补一个空叶子）——
  对 addUid 来说是「先立一行条件」，对 addCondition 来说就多立了一行。
  ==看着像把 addUid 的模式复制到了 addCondition==，值得产品/开发确认是不是本意。
```

## 04 · ConditionRow —— 行外壳

```shot
img: 11-condition-row
alt: ConditionRow 包两种行
caption: 同一个外壳包两种内容：上面一行是特征行，下面是关系行（times）。外壳自己只有 70 行 —— 不画边框、不管内容，只提供一行 flex 布局和右侧 ×。
```

| 项 | 内容 |
|----|------|
| 功能 | 行外壳：可选的 `label`（渲染成「标签：」前缀）、默认插槽、删除按钮 |
| props 进 | `label?`（默认空串） |
| 事件出 | `delete` |
| 子组件 | 无（内容是插槽，由 ConditionGroup 决定放入哪种行） |
| 局部状态 | 无 |
| 要点 | 当前**三处使用都没有传 `label`**（`ConditionGroup` 里三处 `<ConditionRow>` 都没有绑定它），所以这个 prop 现在是未启用的 API 面；幽灵行那处的 `× ` 没有绑 `@delete`——实跑点击无反应（不留痕、不报错） |

这一件是「拆分缝」的示例：它本身不做任何业务判断，所以三种行只需要把自己的三五个输入框塞进插槽，而删除按钮、间距、行布局只有一处实现。

## 05 · LogicToggle —— 逻辑胶囊 + 连接线

```shot
img: 10-logic
alt: LogicToggle
caption: 胶囊本体就是一个 el-select（并且/或者）；上面那根竖线和两条短横线是 CSS 伪元素画的，长度由父组件给的 margin 撑开。
```

| 项 | 内容 |
|----|------|
| 功能 | AND/OR 切换 + 连线装饰 |
| props 进 | `modelValue`、`showConnectors`（默认 true）、`stackAlign`（默认 'end'） |
| 事件出 | `update:modelValue` |
| 复用点 | **三处**：ConditionSection（组间）、ConditionGroup（行级）、RelationRow（属性过滤侧） |
| 局部状态 | 无。线长不归它管 —— Section/Group 各自用 `ResizeObserver` 量出高度，把 `margin-top/bottom` 传进来；属性过滤侧用固定 `margin: 16px` |

一个组件在三处出现、三处的密度不同（组间胶囊 36px 宽、行级 80px、属性侧窄版本），实现上只有一处 `<el-select>` 加两条伪元素，改一处三处同步。

## 06 · ScopeBar —— 客户范围

```shot
img: 01-scopebar
alt: ScopeBar
caption: 「客户范围 =」两个静态框（带下拉箭头但不可点，是视觉锚）加一个真下拉「指定团队」，选了团队再追加团队多选。dataLevel = team 时才能看到「指定团队」。
```

| 项 | 内容 |
|----|------|
| 功能 | 圈选范围选择：本人 / 指定团队 / 全部 |
| props 进 | `modelValue`（ScopeLeaf）、`dataLevel`、`groups`（可见团队） |
| 事件出 | `update:modelValue`（新 ScopeLeaf） |
| 要点 | 选项集 = `allowedScopeKinds(dataLevel)`：self 只给「本人」、team 加「指定团队」、all 再加「全部」。切到 team 时继承上次选过且仍合法的 groupIds，没有合法的就给全部可见团队；团队多选再过滤一次合法 id |

数据流很短：改 kind 或改团队 → 造一个新的 `ScopeLeaf` → emit。组件里没有「当前用户是谁」的概念，dataLevel 和 groups 全从外面传进来 —— 权限判断的权威在服务端（机制篇 06 节）。

## 07 · ConditionNameSelect —— 业务域级联

```shot
img: 02-nameselect
alt: ConditionNameSelect 收起态
caption: 收起态：左边是已有值（常驻城市），右边是空占位。宽度固定 208px，两种行里都用它，保证列对齐。
```

```shot
img: 13-nameselect-l2
alt: 二级展开
caption: 点「资产」展开二级：资产规模 → 总资产(HKD)。域树按 domains 的 parentKey 现算，嵌套深度不写死。
```

| 项 | 内容 |
|----|------|
| 功能 | 一个菜单里选特征或关系；value 是带前缀的 key（`field:xxx` / `relation:xxx`），父组件 `parseConditionKey` 分回两类 |
| props 进 | `modelValue?`（key 字符串）、`metadata` |
| 事件出 | `update:modelValue`（key 字符串） |
| 要点 | `options` 是纯 computed：按 `parentKey` 组树、按 `sortOrder` 排序、**剪掉没有任何叶子的空域**、只有一个子层的域把子层提上来（hoist）、没挂到任何域的字段兜到菜单尾部；停用（DISABLED）节点仍然显示但 `disabled` |

它是「横切复用」的第三个例子：特征行和关系行对「选个名字」的需求完全一样，抽出来之后域树逻辑只有一份，将来加二级业务域也只改这一处。

## 08 · PortraitRow —— 特征行

```shot
img: 05-portrait
alt: PortraitRow
caption: 字段（常驻城市）+ 操作符（等于）+ 值（深圳，value_set 的候选）。操作符列表是从 metadata.operators 里按 applicableOps 过滤出来的 —— 这个字段只出现枚举类操作符。
```

```shot
img: 05b-portrait-default
alt: 默认值操作符
caption: 「= 未发生交易」不是数据，是操作符：连续型数字或日期/时间字段带了 defaultValue 时，操作符表里多出 eq_default / neq_default 两个无值操作符，控件整块消失。当前 demo 里近30天成交笔数就是这个形状。
```

| 项 | 内容 |
|----|------|
| 功能 | 特征叶子编辑：字段、操作符、值 |
| props 进 | `modelValue`（DraftPortrait）、`metadata` |
| 事件出 | `update:modelValue`（新叶子）；`convert`（用户选了关系名 → 发一个 blankDetail 让父层换行类型） |
| 子组件 | `ConditionNameSelect`、操作符 `el-select`、`ValueControl` |
| 数据流 | `operators` = `metadata.operators` ∩ `applicableOps(feature)`；`currentControl` = `controlFor(feature, op)` 决定值控件；`onCondition` 按前缀分流（`relation:` → convert）；`onField` 换字段时把 op 重置成新字段第一个合法值；`onOp` 换操作符时**清掉旧值**；`onValue` 只 patch value |
| 特判 | `operatorLabel()`：`eq_default` / `neq_default` 的显示名不是操作符表里的名字，而是「= <defaultValueExplain>」（缺省回退「默认值」） |

## 09 · RelationRow —— 关系行（最大的一件，530 行）

```shot
img: 06-relation-detail
alt: RelationRow detail
caption: detail 形态：公式（包含这些）+ op（存在）+ 客体多选（腾讯控股 00700.HK，来自注入的搜索）+ 「+ 属性过滤」。客体的候选走注入函数，label 不是原值 —— 这条链在本节末尾。
```

```shot
img: 06b-relation-props-2
alt: 两个属性的 AND
caption: 属性过滤展开两条：左侧出现「并且」胶囊（LogicToggle 的第三个使用点）；第一行数量比较、第二行 market 走 value_set 候选（港股）。删光属性行，props 键会从草稿里整个拿掉。
```

```shot
img: 07-relation-times
alt: RelationRow times
caption: times 形态：第二格换成「条数」类公式名（product 显示「开通只数」），值区变成区间，客体位是「不限标的」。
```

```shot
img: 09b-dynamic-object-open
alt: 客体下拉展开
caption: 客体是多选 + 远程搜索：打开即搜空关键词，候选项带 label（腾讯控股 00700.HK），已选打勾。
```

| 项 | 内容 |
|----|------|
| 功能 | 关系叶子编辑：关系名、公式（detail / times）、操作符、客体多选、可选的属性过滤（可再嵌 AND/OR） |
| props 进 | `modelValue`（DraftRelation）、`metadata` |
| 事件出 | `update:modelValue`；`convert`（选了特征名 → 发 portraitDraft 换回特征行） |
| 子组件 | `ConditionNameSelect`、`ValueControl`（times 的值、每个属性的值）、`LogicToggle`（属性侧）、两个 `el-select`（公式、操作符、客体） |
| 局部状态 | `remoteObjects`（搜索结果）、`rememberedObjects`（value → label 记忆）、`propSetItems`（属性 value_set 预载）、三个竞态令牌（`objectSearchToken` / `objectResolveToken` / `propLoadToken`，卸载时全部作废） |

这一件的内部数据流有四条独立的线，值得分开记：

```compare
first: 通道
head: [怎么走, 关键机制]
rows:
  - "公式与操作符": ["`onFormula` 切 detail/times：op 重置（in / gt）、value 清空；`onOp` 在 times 下做「单值 ↔ between」的值迁移；detail 只允许 in/not_in", "值形状跟着公式走，清值在叶子层完成"]
  - "客体候选": ["三来源：CUSTOM（内联 options）/ VALUE_SET（`useResolvedItems` 预载）/ DYNAMIC（远程搜索 + `lookup` 回显）", "选中值不在候选里时，用 `rememberedObjects` 的记忆 label 兜底；没有记忆就显示原值"]
  - "客体 label 回显（新）": ["`watch([objectSource, selectedObjects])` → `objectResolveToken` → `valueSearch.resolve(...)` → 拿回 label 写进 rememberedObjects → `objectLabelTick` 触发 computed 重算", "==已保存的取值在没打开下拉时也能显示中文 label==，不依赖搜索"]
  - "属性过滤": ["`propItems` / `propLogic`；属性候选 `propSetItems` 按关系一次性预载（`propLoadToken` 防串）；每个属性的 op 用 `applicableOps` 过滤、控件用 `controlFor` 决定", "`setProps` 在删光时把 props 键整个移除；属性不支持 eq_default（buildQuery 会拒）"]
```

```callout
tone: amber
icon: ⚠
text: |
  **一处写死的特判**：`timesFormulaLabel` 按关系 key 取名字 —— `product` → 「开通只数」、
  `holding` → 「持仓只数」，其它关系一律「条数」。==新加的关系拿不到专用量词==，
  要改就得动组件。它和「控件决策全走 metadata」的主线相悖，值得记一笔。
```

## 10 · UidRow —— 指定 UID

```shot
img: 08-uid
alt: UidRow
caption: 名字位固定「指定UID」（不可改），操作符只有 属于/不属于，值是多行文本框 —— 粘贴的边界就是它的主战场。
```

| 项 | 内容 |
|----|------|
| 功能 | UID 名单叶子：in / not_in 两种操作符 + 文本名单 |
| props 进 | `modelValue`（UidLeaf） |
| 事件出 | `update:modelValue`（整个新 UidLeaf） |
| 局部状态 | `text` —— 文本框的本地镜像。输入时不直接回写草稿文本，而是解析成 uids 抛出去；反向 `watch(modelValue.uids)` 只在「重新解析当前文本 ≠ 草稿 uids」时重写文本，避免打字中间态被覆盖 |
| 要点 | `parseUids`：空格/半角逗号/分号/中文逗号分号都算分隔符，只留正整数字符串（不过 `Number`，`9007199254740993` 不会丢精度），去重保序，`MAX_UIDS = 500` 截断 |

与外层的联系有两条：父层 `ConditionGroup` 的 `addLeaf` 拦截第二个 UID、`hasUid` 藏掉「+ 指定UID」按钮 —— **数据层拦输入、界面层藏入口**，同一条规则两处实现。

## 11 · ValueControl —— 值控件（253 行，七形态）

```shot
img: 09-value-forms
alt: ValueControl 七形态
caption: 同一组件在七种形态间切换：SELECT / MULTI_SELECT / SWITCH / INPUT（数字）/ RANGE（两端）/ RANGE·日期 / DATETIME_PICKER / 动态搜索 / NONE。形态由 props 决定，组件里没有按字段名的分支。
```

| 项 | 内容 |
|----|------|
| 功能 | 按 `inputForm` 渲染对应控件；带前缀/后缀（`HK$` 这类来自 display）；日期/时间做显示串 ↔ 时间戳换算 |
| props 进 | `inputForm`、`valueType`、`items?`、`search?`、`resolveSelected?`、`prefix?`、`suffix?` |
| 事件出 | `update:modelValue`（走 `defineModel`，赋值即 emit） |
| 局部状态 | `remoteItems`（搜索结果）、`selectedLabels` + `labelTick`（value → label 记忆与刷新）、`searchToken`（竞态） |
| 要点 | `NONE` 形态渲染一个宽度 0 的空 span —— 无值操作符时输入框整块消失，布局不塌 |

内部的四条逻辑：

```compare
first: 逻辑
head: [做什么]
rows:
  - "候选并集": ["列表 = 候选（items 或搜索结果）+ 已选但不在候选里的值（用 `selectedLabels` 的记忆 label 补）—— 和机制篇讲的是同一招，新增 `labelTick` 让 computed 在记忆更新后重算"]
  - "动态回显（新）": ["`watch([modelValue, resolveSelected])`：值变化时主动 `resolve` 已保存的取值补 label —— 打开页面就能看到中文名，不必先打开下拉"]
  - "竞态": ["搜索的 `searchToken`、卸载时置废；旧响应不许覆盖新输入"]
  - "时间换算（秒级）": ["显示：`unixMsToZoned(value * 1000)`；写回：`Math.floor(ms / 1000)`。==DSL 里的日期时间是 Unix 秒==，组件负责和日期选择器之间的换算"]
```

它与外层的联系特别干净：**不 inject 任何东西**。三个加载函数由行组件 inject 后以普通 prop（`search` / `resolveSelected`）传进来 —— 值控件只认函数，不认数据从哪来。

## 12 · 速查

```compare
first: 组件
head: [父 → 它的入口, 它的出口, 局部状态]
rows:
  - "ConditionSection": ["includeTree + metadata", "新 section 树", "ResizeObserver（组间留白）"]
  - "ConditionGroup": ["组节点 + metadata", "新组节点", "ResizeObserver（行级留白）"]
  - "ConditionRow": ["label + slot", "delete", "无"]
  - "LogicToggle": ["modelValue + 连接线参数", "新逻辑值", "无"]
  - "ScopeBar": ["ScopeLeaf + dataLevel + groups", "新 ScopeLeaf", "无"]
  - "ConditionNameSelect": ["key 字符串 + metadata", "新 key 字符串", "无（options 是 computed）"]
  - "PortraitRow": ["特征叶子 + metadata", "新叶子 / convert", "无（全 computed）"]
  - "RelationRow": ["关系叶子 + metadata", "新叶子 / convert", "rememberedObjects、propSetItems、4 个竞态令牌"]
  - "UidRow": ["UID 叶子", "新 UID 叶子", "text（文本镜像）"]
  - "ValueControl": ["形态 props + 值", "新值", "selectedLabels、remoteItems、searchToken"]
```

几处实测到的边界，按「值得知道」记：

```checklist
tone: warn
items:
  - 空组点「+ 条件」一次得到两行（源码里与 addUid 共用 base 逻辑，看着像复制过去的）
  - 幽灵行的 × 没有绑 delete：点它不报错、也不消失
  - ConditionRow 的 label prop 目前三处调用都没传，是未启用的 API 面
  - RelationRow 的时间公式量词按 relation key 特判（product/holding），其它关系只有「条数」
  - ConditionSection 只渲染 type === 'group' 的子节点，别的节点会静默不显示
  - 三处 LogicToggle 的留白基准不同：组间 28px / 行级 16px / 属性侧固定 16px
```

```quiz
- q: 界面上的「行」到底由几个组件合作渲染出来？
  a: |
    四个：ConditionGroup 决定这一行是哪种叶子、决定逻辑胶囊的位置；
    ConditionRow 提供外壳（slot + 删除按钮）；PortraitRow/RelationRow/UidRow 渲染内容；
    行里的「选名字」「填值」再各自复用 ConditionNameSelect 和 ValueControl。
    所以改一个行的显示问题，先定位是哪一层的问题。
- q: 客体的中文名（腾讯控股 00700.HK）是怎么出现在界面上的？什么时候会退化成原值？
  a: |
    三条来源依次兜底：搜索结果带回 label → 打开下拉时能记住；
    已保存的取值靠 resolve（lookup）主动补 label；
    两者都没有（比如新开页面、注入函数没接）就显示草稿里的原值字符串。
    这也是为什么独立挂载组件做截图时必须 provide 三个加载函数 —— 不 provide 就会看到原值。
- q: 想给「值」新增一种输入形态（比如滑块），改哪、牵连哪里？
  a: |
    形态由 dsl 的 controlFor 算出，它返回的 inputForm 是 ValueControl 的唯一开关。
    按现在的分层：先在 dsl 里加形态与判定（谁能用），再在 ValueControl 里加一个分支渲染；
    行组件（PortraitRow / RelationRow）不用动 —— 它们只负责把 props 传下去。
    这就是把「值控件」抽成一个组件的收益。
```
