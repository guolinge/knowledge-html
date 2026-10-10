[全景篇](notes/combination-overview.html)讲了包的位置和地图，[机制篇](notes/combination-mechanics.html)讲了草稿与校验。这一篇只回答「**长什么样**」：11 个组件每一个的真实渲染截图（不是示意图，是把组件单独挂到空页面上跑出来的实拍）、对外接口、拆分依据，以及一次用户编辑穿过五层组件的完整数据流。

## 01 · 整体长这样

下面是组件的完整状态：客户范围选了「指定团队 · 深圳一组」，包含区里两组条件（组间「或者」），第一组混了特征行和关系行，第二组有带属性过滤的关系行和一条 UID 行。**界面上每一个框、每一个下拉，都对应草稿里的一个字段** —— 对照着读，组件和协议就是一回事。

```shot
img: 00-hero
alt: InsightCombiner 完整状态实拍
caption: InsightCombiner 富草稿状态。这份界面产出的是 01 节那条 DraftQuery —— 组、行、下拉、输入框一一对应。
```

### 拆分的三条缝

11 个 `.vue` 不是随便切的，缝开在三个地方：

```cards
cols: 3
items:
  - title: 缝一 · 草稿树的层级
    desc: "Section = 树第一层、Group = 组、Row = 叶子。==界面嵌套和 DraftQuery 嵌套同构==，改哪层就渲染哪层。"
    tone: blue
  - title: 缝二 · 叶子的类型
    desc: "portrait / relation / uid 三种叶子各一个行组件。行为差异大的东西不硬塞一个组件用 if 区分。"
    tone: violet
  - title: 缝三 · 横切的重复
    desc: "选名字、切 AND/OR、填值 —— 三件事在多处出现，各抽成一个组件复用（NameSelect / LogicToggle / ValueControl）。"
    tone: green
```

这个页面的每张截图本身就是拆分质量的证据：**每个组件都能脱离全家桶，单独喂 props 渲染出来**。耦合在壳里的组件做不到这一点。

## 02 · 壳与范围：InsightCombiner、ScopeBar

壳只做四件事：接 props、把两个候选值加载函数 `provide` 给深层、渲染 ScopeBar 和唯一的包含区、在身份变化时收窄 scope。业务逻辑一概没有 —— 那些在 ts 层（全景篇 05 节有地图）。

```shot
img: 01-scopebar
alt: ScopeBar 客户范围
caption: ScopeBar。dataLevel 决定选项集：self 只见「本人」；team 加「指定团队」；all 再加「全部」。选了团队才出现团队多选。
```

| 接口 | 内容 |
|------|------|
| props 进 | `modelValue`（ScopeLeaf）、`dataLevel`、`groups` |
| 事件出 | `update:modelValue`（新的 ScopeLeaf） |
| 要点 | 切换 kind 时保留仍然合法的 groupIds；选项由 `allowedScopeKinds(dataLevel)` 算出 |

## 03 · 名字从哪选：ConditionNameSelect

特征和关系混在同一个级联菜单里，靠 key 前缀（`field:` / `relation:`）区分。菜单按 Metadata 的 `domains` 长出层级，字段和关系挂在各自业务域下面。

```shot
img: 02-nameselect
alt: ConditionNameSelect 收起态
caption: 收起态。左：已选中「常驻城市」；右：空值占位。同一个控件被 PortraitRow 和 RelationRow 共用 —— 这是它被单独拆出来的原因。
```

```shot
img: 02b-nameselect-open
alt: ConditionNameSelect 展开态
caption: 展开态：一级业务域（资产规模 / 交易行为 / 身份与账户），箭头进二级。没有字段的空域被剪掉，不挂任何域的字段落到菜单尾部。
```

停用的字段（status = DISABLED）照样出现在菜单里但不可选 —— 新建条件不给选，回显旧条件时还得让人看懂自己圈过什么。

## 04 · 区域与组：ConditionSection、ConditionGroup

```shot
img: 03-section
alt: ConditionSection 两组状态实拍
caption: ConditionSection。左侧胶囊是**组间**逻辑（两组以上才出现），灰色圆角块是每个 ConditionGroup，右上 × 删组，底部「+ 条件组」。minGroups=1 保证删不光。
```

```shot
img: 04-group
alt: ConditionGroup 三种叶子混排实拍
caption: ConditionGroup。左胶囊是**行级**逻辑；行从上到下是特征行、关系行（含属性过滤）、UID 行 —— 三种叶子混排，各自组件渲染。
```

组里藏着两个界面协议：**幽灵行**（空组先显示一行「请选择条件」，不在草稿里，选中才落地）和**每左一个 UID**（`addLeaf` 拦第二个，按钮同时藏掉）。机制在机制篇 02 节。

AND/OR 胶囊自己也是一个组件，三处复用：

```shot
img: 10-logic
alt: LogicToggle 连接线实拍
caption: LogicToggle。中间那根竖线连着上下两条横线，接到右边两行条件上 —— 线长靠 ResizeObserver 量最后一行的高度，行增删自动重算。Section 组间、Group 行级、RelationRow 属性过滤三处用的是同一个组件。
```

## 05 · 三种行

### PortraitRow —— 特征行

```shot
img: 05-portrait
alt: PortraitRow 实拍
caption: 一行 = 名字（级联）+ 操作符（按 applicableOps 过滤）+ 值（ValueControl 按形态渲染）。换字段时操作符重置成新字段第一个合法值。
```

### RelationRow —— 关系行（最复杂的一个，507 行）

一行里有两种公式可切：**detail**（是否存在这样的关系记录）和 **times**（这样的记录有几条）。detail 有客体多选和可选的属性过滤，属性过滤是一组带自己 AND/OR 的子条件。

```shot
img: 06-relation-detail
alt: RelationRow detail 形态实拍
caption: detail 态：「包含这些 / 存在」+ 客体多选（腾讯 00700.HK）+ 展开的属性过滤「且满足 持仓数量 ≥ 100 股」。删光属性行，props 键会从草稿里整个拿掉。
```

```shot
img: 07-relation-times
alt: RelationRow times 形态实拍
caption: times 态：第二格换成公式名（产品行显示「开通只数」），值区跟着变区间，客体位是「不限标的」占位 —— times 允许不点名对象。
```

### UidRow —— 指定 UID

```shot
img: 08-uid
alt: UidRow 实拍
caption: 名字位固定「指定UID」，操作符只有 属于/不属于，值是多行文本框。粘贴进来什么分隔符都认（空格、逗号、分号、中文逗号分号），去重、去非法、500 截断，保字符串不过 number。
```

## 06 · 值控件：一个组件吃下七种形态

ValueControl 没有 `if (field === 'city')` 这种分支 —— 它只认 props 给的 `inputForm`（形态）和 `valueType`（值类型），而这两个值是 `controlFor(形状, op)` 算出来的。形态与形状的完整决策表在机制篇 03 节，这里看长相：

```shot
img: 09-value-forms
alt: ValueControl 七形态实拍
caption: 从上到下：SELECT（单选候选）· MULTI_SELECT（in/not_in）· SWITCH（布尔）· INPUT 数字（long/double）· RANGE（between 两端点）· RANGE 日期版（unix_date）· DATETIME_PICKER · SELECT·DYNAMIC（远程搜索）· NONE（无值操作符，整块消失）。
```

```shot
img: 09b-dynamic-open
alt: 动态搜索下拉展开实拍
caption: DYNAMIC 形态的下拉展开：关键词搜「腾讯」，候选来自宿主注入的 searchValues —— 组件自己不发请求。竞态票据和已选值回显的机制在机制篇 04 节。
```

## 07 · 数据流：一次编辑穿过五层

以「把总资产从 100 万改成 200 万」为例。正向是 props 流下去，反向是事件冒上来，五层各干一件小事：

```seq
grid: true
participants:
  - { id: host, label: 宿主, tone: blue }
  - { id: comb, label: 壳 Combiner, tone: blue }
  - { id: area, label: 区域层, sub: "Section · Group", tone: violet }
  - { id: row, label: 行组件, sub: PortraitRow, tone: violet }
  - { id: val, label: 值控件, sub: ValueControl, tone: green }
messages:
  - { from: host, to: comb, label: "props.modelValue（草稿）", kind: sync }
  - { from: comb, to: area, label: "v-model 下传 include 树", kind: sync }
  - { from: area, to: row, label: "v-model 下传叶子", kind: sync }
  - { from: row, to: val, label: "model-value + display", kind: sync }
  - { from: val, to: val, label: "发新值", kind: self }
  - { from: row, to: row, label: "patch 新叶子", kind: self }
  - { from: area, to: area, label: "replace 原位置", kind: self }
  - { from: comb, to: host, label: "emit 新草稿（不可变新对象）", kind: reply }
  - { from: host, to: host, label: 赋值 → 重放, kind: self }
```

这条链有三个值得记住的形状：

```cards
cols: 3
items:
  - title: 主道是窄的
    desc: "每一层只有一个业务事件 update:modelValue，参数永远是「这一层视角下的新对象」。行不知道组，组不知道区域，壳不知道宿主要拿草稿干什么。"
    tone: blue
  - title: metadata 是整份下传的
    desc: "壳把整份 AudienceMetadata 原样传给 Section、Group、每一行。深层要的只是几个字段，==但一份传到底省掉了逐层挑选和透传== —— 数据只有几十 KB，简单赢了。"
    tone: violet
  - title: 侧道只有一条
    desc: "候选值加载走 provide/inject：壳 provide 两个函数，任何深度的 ValueControl / RelationRow 直接 inject。==值加载是唯一的横切需求==，再多一条就值得改成显式 props。"
    tone: green
```

## 08 · 速查

```compare
first: 组件
head: [props 进, 事件出, 一句话要点]
rows:
  - "InsightCombiner": ["modelValue · metadata · dataLevel · groups · scopeReady · loadValueSet · searchValues", "update:modelValue", "壳：provide 两个加载函数、watch 收窄 scope；只渲染 include"]
  - "ScopeBar": ["modelValue(ScopeLeaf) · dataLevel · groups", "update:modelValue", "选项集 = allowedScopeKinds(dataLevel)"]
  - "ConditionNameSelect": ["modelValue · metadata", "update:modelValue", "domains 建树 + field:/relation: 前缀；DISABLED 可见不可选"]
  - "ConditionSection": ["modelValue(DraftTree) · title · accent · minGroups", "update:modelValue", "组间逻辑 + 组增删；≥2 组才显示逻辑胶囊"]
  - "ConditionGroup": ["modelValue(DraftTree) · metadata", "update:modelValue", "行级逻辑、幽灵行、每组一个 UID、行类型 convert"]
  - "PortraitRow": ["modelValue · metadata", "update · convert", "换字段重置 op；操作符 = metadata.operators ∩ applicableOps"]
  - "RelationRow": ["modelValue · metadata", "update · convert", "detail/times 两公式；客体三来源；props 可嵌 AND/OR"]
  - "UidRow": ["modelValue(UidLeaf)", "update:modelValue", "parseUids 解析粘贴；500 截断；保字符串"]
  - "ValueControl": ["inputForm · valueType · items · search · prefix/suffix", "defineModel → update:modelValue", "七形态一个组件；日期 ↔ Unix 毫秒；已选值回显"]
  - "LogicToggle": ["modelValue('AND'·'OR') · showConnectors · stackAlign", "update:modelValue", "三处复用的逻辑胶囊；连接线纯 CSS + ResizeObserver"]
  - "ConditionRow": ["label", "delete", "行外壳：类型标签 + 删除按钮，三种行共用"]
```

行组件的 `convert` 事件是行类型切换的出口：PortraitRow 里选到 `relation:xxx` 发 `blankDetail`，RelationRow 里选到 `field:xxx` 发 `portraitDraft` —— ConditionGroup 接住后原位替换（机制篇 02 节）。

```quiz
- q: 为什么 RelationRow 有 507 行而 UidRow 只有 89 行？拆分时为什么不把 RelationRow 再拆？
  a: |
    RelationRow 的大小来自三块真实差异：两种公式的操作符和值区不同、
    客体有三种候选值来源、属性过滤是一组带自己逻辑的子条件。
    这三块共享同一个草稿节点（DraftRelation），拆开就得把一个节点的编辑权
    分给多个组件，事件和状态同步反而变复杂。
    对比之下 UidRow 只是一个文本框加一个解析函数，89 行已经把解析、截断、
    同步都写干净了。行数差不是失衡，是叶子本身的复杂度差。
- q: 「metadata 整份下传」会不会浪费？为什么不挑好再传？
  a: |
    AudienceMetadata 只有几十 KB 且不可变（revision 哈希锁定），整份下传让
    每层组件的 props 契约都一样简单 —— 加一个深层组件不用改中间层的透传。
    真要省的是「深层改一份大对象」的心智成本，而这份数据从不被组件修改。
    这是典型的「数据小就别为省内存加复杂度」。
- q: 怎么证明「拆得干净」？
  a: |
    本篇每张截图都是把对应组件单独挂到空页面、只喂 props（metadata 用
    手写 fixture、加载函数用本地假实现）渲染出来的。任何组件如果暗中依赖
    全局状态或父组件，这一步就会白屏 —— 而它们都能独立跑起来。
```
