你在圈选页把条件选成「持仓标的」，那一行会从一格变成三块：一个「选择标的」的多选框、一块能加好几行的属性区，还有一个蓝色的「+ 添加属性」。

奇怪的地方在于：元数据里，关系是 `crm_dc_relation` 表里的一行 —— 这一行再长，也只是一个值加几段文字，凭什么它一选中就多长出两格控件？

```callout
tone: blue
icon: 🎯
text: |
  **这篇回答一个问题**：==「+ 添加属性」是表里哪一列决定的？==

  答案先给出来：!!它不是这一行的某一列决定的!!。客体那块控件来自**这一行自己的一组列**，
  属性区和那个按钮来自**另一张表里指回来的行数**。
  下面从界面往回走，一直走到表里的行。
```

---

## 01 · 三块界面，来自两个地方

界面上这三块是挨着的，在表里却是**一条关系行加另一张表的几行**：

```flow
nodes:
  - { id: rel,  label: 关系本体那一行, sub: "crm_dc_relation", row: 0, kind: database }
  - { id: u_rel, label: 关系下拉里的「持仓标的」, sub: "名字来自本体行", row: 0, tone: blue }
  - { id: obj,  label: 本体行上的客体列, sub: "13 个 object_* 列", row: 1, kind: database }
  - { id: u_obj, label: 「选择标的」多选框, sub: "候选值来源配在客体列上", row: 1, tone: blue }
  - { id: prop, label: 属性表里指回来的行, sub: "crm_dc_relation_attr", row: 2, kind: database }
  - { id: u_prop, label: 属性区加那个按钮, sub: "能加几种看这里有几行", row: 2, tone: green }
edges:
  - { from: rel, to: u_rel }
  - { from: obj, to: u_obj }
  - { from: prop, to: u_prop }
```

把这条链拆成「界面上的东西 ← 由什么决定」，就是下面这张表。最后一行是这篇的重点：

```compare
first: 界面上的东西
head: [由什么决定]
rows:
  - 关系下拉里有没有这一项: ["`crm_dc_relation` 里有一行 `relation_key = holding`，并且它是启用的"]
  - 关系显示成什么名字: ["那一行的 `display_name_i18n`，按当前语言取"]
  - 「选择标的」那个多选框: ["本体行上的客体列：`object_name` 定类别、`object_enum_type` 定候选值来源"]
  - 属性区能加几行: ["`crm_dc_relation_attr` 里 `relation_id` 指回这条关系的行**有几行**"]
  - 「+ 添加属性」出不出现: [{ text: "上面那个数字大于 0", tone: green }]
```

---

## 02 · 关系不是一行能说完的：本体带客体，属性另立一张表

画像字段一行就能说完：「用户身上有一个值」。性别、年龄、总资产都是这个形状。

关系说的不是「有一个值」，而是「有一个集合」，集合里每一项各带自己的属性（市场、数量、状态）。这个形状拆成了两张表：**关系本体一行，客体列长在本行上；属性单独一行，靠 `relation_id` 指回来**。

拿 demo 里的 `holding` 举例，它一共占三行：

```tree
- label: "crm_dc_relation · holding"
  sub: "本体行 · 33 列"
  tone: violet
  note: 界面上的「持仓标的」就是这一行
  children:
    - { label: "object_* 客体列 ×13", sub: "object_name = stock", note: "「选择标的」的类别和候选值来源：object_enum_type = dynamic，解析器 stock_search" }
    - label: "crm_dc_relation_attr · relation_id → holding"
      tone: green
      sub: "两张属性行"
      children:
        - { label: market, sub: "→ rel_holding.market · 值集", note: "属性区第 1 格，值来自值集 market" }
        - { label: qty, sub: "→ rel_holding.qty · 无值集", note: "属性区第 2 格，纯数字" }
```

另一个关系 `product` 形状一样，只是行数和客体来源不同。两个家族摆一起，差别一目了然：

```compare
first: 这一行
head: [holding 家族, product 家族]
rows:
  - 本体行: ["`crm_dc_relation` 一行", "`crm_dc_relation` 一行"]
  - 客体列怎么配: ["`object_enum_type = dynamic` → 远端搜股票", "`object_enum_type = custom` → 10 个产品内嵌在 `object_value_set` 之外的内联选项里"]
  - 属性行: ["2 行（`market` `qty`）", "1 行（`status`）"]
  - 界面上能加几种属性: [{ text: "2 种", tone: green }, { text: "1 种", tone: amber }]
```

客体和属性的分工在这里看得最清楚：==客体是「这条关系连到什么东西」，一条关系只有一个，所以它的 13 个列直接长在本体行上；属性是「每条关系记录上还有什么值」，一条关系可以有很多个，所以单独一张表==。

---

## 03 · 后端只做四件事

从这些行到前端拿到的 `relations[]`，中间是 `apps/server/src/metadata/audience.ts` 里的一段投影。它按顺序做四件事：

```lane-stack
- badge: STEP 01
  title: 读进来
  desc: 全量读，停用的行保留
  tone: muted
  nodes:
    - { title: rows.relations / rows.attrs, sub: "status 跟着行走，不在这里过滤" }
  next: "配对 :: 属性认亲 :: 靠 relation_id"

- title: 配对
  desc: 属性行指回关系本体
  tone: blue
  nodes:
    - { title: 本体, sub: "rows.relations 按 relation_key" }
    - { title: 属性, sub: "rows.attrs 里 relationId === relation.id" }
  next: "客体 :: 不用找 :: 它就长在本体行上"

- title: 客体
  desc: 13 个 object_* 列直接变成客体的类型描述
  tone: violet
  nodes:
    - { title: object, sub: "object_column_name / object_enum_type / object_value_set_id …" }
  next: "打包 :: 行变成对象 :: 交给前端"

- title: 打包
  desc: 前端看到的是一个关系对象，不是一堆行
  tone: green
  nodes:
    - { title: "relations[] 的一个元素", sub: "{ key, name, object, properties, status? }" }
```

投影代码里客体的部分短得出奇 —— 因为不用找：

```ts
// audience.ts · relationOf()
const object = relation.object;          // 客体列就在本体行上，一步取出

const properties = rows.attrs
  .filter((field) => field.relationId === relation.id)   // 属性要靠 relation_id 认亲
  .filter((child) => !onlyProps || onlyProps.has(child.fieldKey))
  .sort((a, b) => a.id - b.id)
  .map((prop) => ({ key: prop.fieldKey, status: statusName(prop.status), … }));
```

`onlyProps` 那一行是给 `POST /api/audience/metadata/resolve` 用的：回显一条老草稿时，只带草稿里点过名的那几个属性。

**属性行自身的状态跟行走**：投影不过滤停用，每条属性带着 `status` 下发 —— 回显老条件时，「市场」停用了也还能显示出名字来。过滤发生在另一份投影里：`rowsToCatalog`（给 SQL Builder 的 Catalog）把 `status !== ENABLED` 的行全部留下不进字典。

### 上一版的那个校验，换了个地方

旧模型里客体是关系下面的一行子项，投影时有一条硬校验：**OBJECT 子行必须恰好 1 行**，0 行或 2 行都在服务启动时炸掉。

拆表之后这条校验==整个消失了== —— 客体不再是行，它的 13 个列全是 `NOT NULL`，一行关系生下来就带一个客体，结构上不存在「没有客体」或「有两个客体」的关系。约束搬到了两个新地方：

```compare
first: 新约束
head: [拦什么, 报什么错]
rows:
  - 属性名不得和客体名撞: ["`relation_attr.field_key` 等于本体行的 `object_name`", "`attr … collides with the object`"]
  - 属性名在关系内不得重复: ["同一 `relation_id` 下两个相同 `field_key`", "`duplicate relation attr holding.market`"]
```

这两条在 `assertMetadataRows` 里，服务启动时跑一遍。数据库那侧还有一道保险：`uk_relation_field (relation_id, field_key)` 唯一索引。

---

## 04 · 判据是数行数

现在能回答开头那个问题了。前端要的判据只有一行（`RelationRow.vue:206`）：

```js
const canFilterProps = computed(() => (relationDef.value?.properties.length ?? 0) > 0);
```

它读的是**数组长度**，不是某一列的某个值。而数组长度等于「`relation_id` 指回这条关系、且下发着的属性行」有几行。三种行数对应三种界面：

```compare
first: 属性行数量
head: [后端给出的 properties, 界面上那一块]
rows:
  - "0 行": [{ text: "[]", tone: muted }, { text: "整块不出现，连按钮都没有", tone: red }]
  - "1 行": ["1 个属性定义", { text: "一个属性行 + 「+ 添加属性」", tone: green }]
  - "2 行": ["2 个属性定义", { text: "两个属性行 + 「+ 添加属性」", tone: green }]
```

!!同一个按钮有两个文案，而且位置不一样!!，很容易以为是两个功能（`RelationRow.vue:70` 和 `:143`，文案在 `messages.ts`）：

```callout
tone: violet
icon: 🔤
text: |
  | 什么时候出现 | 文案 | 位置 |
  |---|---|---|
  | 还没加过属性（`propItems.length === 0`，`propItems` 就是属性区已经加出来的行） | `+ 属性过滤` | 主行下面 |
  | 已经有属性行了 | `+ 添加属性` | 属性列表下面 |

  属性区已经有行的时候才是「+ 添加属性」；第一次给一个关系加属性，
  看到的其实是「+ 属性过滤」。
  两个按钮点下去跑的是同一个函数（`addProp()`），
  差别只在「要不要先给一个空属性行打头」。
```

关系行本体还有另外两个下拉，它们跟属性无关，跟这条关系整体有关：公式（`怎么比`：包含这些 / 持仓只数）和操作符（`存在` / `不存在`）。列表来自组件里的两个常量，跟属性那一套操作符是分开的。

---

## 05 · 亲手走一遍

左边是 MySQL 里的一行，右边是前端拿到的东西。点上面换行，点中间任一条规则看它读了哪些列：

````demo
widget: row-to-catalog
title: 从表里的一行，到界面上的一块
hint: 点上面换行，点中间任一条规则看它读了什么
actions: false
config:
  rules:
    - title: ① 本体行进下拉
      from: [relation_key, display_name_i18n]
      out: [name, label]
      note: "关系下拉的候选和文案都来自本体行。`relation_key` 同时是 DSL 里 `relation: \"holding\"` 用的名字。"
      code: "rows.relations.map((relation) => relationOf(relation, rows, …))"
    - title: ② 客体长在本行
      from: [object_name, object_column_name, object_enum_type]
      out: [object]
      note: "**不用认亲**。客体列就在本体行上：类别 `stock`、物理列 `object_id`、候选值 dynamic 搜股票。"
      code: "const object = relation.object;"
    - title: ③ 属性靠 relation_id 认亲
      from: [relation_id]
      out: [properties]
      note: "属性在另一张表。指回这条关系的行有几行，`properties` 就多长。"
      code: "rows.attrs.filter((field) => field.relationId === relation.id)"
    - title: ④ 属性各带各的取值来源
      from: [enum_type, value_set_id, value_resolver_key]
      out: [valueSource]
      note: "每个属性自己决定值从哪来：`market` 是值集，`qty` 什么都没有，`product.status` 内嵌选项。"
      code: "valueSourceOf(prop, sets, key)"
    - title: ⑤ 界面那一块
      from: [properties]
      out: [ui]
      note: "**属性数组不为空，属性和按钮一起出现**；数组为空，整块都不出现。"
      code: "computed(() => (relationDef.value?.properties.length ?? 0) > 0)"
  tabs:
    - key: holding · 本体行
      srcLabel: MySQL · crm_dc_relation 的 holding 那一行
      outLabel: AudienceMetadata · relations[holding]
      src:
        - [relation_key, holding]
        - [display_name_i18n, '{"zh-CN":"持仓标的", …}']
        - [object_name, stock]
        - [object_column_name, object_id]
        - [object_enum_type, dynamic]
        - [object_value_resolver_key, stock_search]
        - [data_source_id, "→ rel_holding"]
        - [status, "1  (ENABLED)"]
      out:
        - [key, '"holding"']
        - [name, '"持仓标的"']
        - [object, '{ key: "object_id", valueSource: DYNAMIC/stock_search }']
        - [properties, "[market, qty]"]
        - [ui, '关系下拉 + 「选择标的」+ 属性区 + 「+ 添加属性」']
    - key: market · 属性行
      srcLabel: MySQL · crm_dc_relation_attr 的 market 那一行
      outLabel: AudienceMetadata · relations[holding].properties[0]
      src:
        - [relation_id, "→ holding"]
        - [field_key, market]
        - [column_name, market]
        - [variable_type, enum]
        - [data_type, string]
        - [enum_type, value_set]
        - [value_set_id, "→ market 集合"]
      out:
        - [properties, market]
        - [valueSource, '{ type: "VALUE_SET", setKey: "market" }']
        - [ui, "属性区第 1 格"]
    - key: qty · 属性行
      srcLabel: MySQL · crm_dc_relation_attr 的 qty 那一行
      outLabel: AudienceMetadata · relations[holding].properties[1]
      src:
        - [relation_id, "→ holding"]
        - [field_key, qty]
        - [column_name, qty]
        - [variable_type, range]
        - [data_type, long]
        - [enum_type, none]
      out:
        - [properties, qty]
        - [valueSource, '{ type: "NONE" }']
        - [ui, "属性区第 2 格，手输数字"]
    - key: product · 本体行
      srcLabel: MySQL · crm_dc_relation 的 product 那一行
      outLabel: AudienceMetadata · relations[product]
      src:
        - [relation_key, product]
        - [object_name, product]
        - [object_enum_type, custom]
        - [object 选项, "MARGIN / OPTION / FUND / …（内联）"]
        - [status, "1  (ENABLED)"]
      out:
        - [key, '"product"']
        - [object, '{ valueSource: CUSTOM，内联 10 个产品 }']
        - [properties, "[status]（1 行 → 属性区只有 1 种）"]
````

---

## 06 · 三个容易记错的地方

```cards
cols: 3
items:
  - title: 属性重名只在同一条关系内被禁止
    tone: amber
    desc: "`holding` 和 `product` 下可以有同名的属性，语义完全不同。唯一索引是 `(relation_id, field_key)`，不是 `field_key` 单列 —— 属性的名字空间属于关系。"
  - title: 两种投影对停用的处理相反
    tone: red
    desc: "给前端的 AudienceMetadata 全量下发、每行带 status —— 停用的「市场」还能回显；给编译器的 Catalog 只收 ENABLED —— 停用的属性直接从字典里消失，新 SQL 里编不出它。"
  - title: 没有属性的关系是合法的
    tone: muted
    desc: "属性数组为空时按钮不出现，这条关系就只剩「存在 / 不存在」和「条数」两种筛法。demo 里两个关系都有属性，所以这条分支看不到。"
```

```quiz
- q: 「+ 添加属性」这个按钮，是表里哪一列决定的？
  a: |
    没有哪一列单独决定它。客体那块控件来自关系本体行上的 object_* 列；
    属性区和按钮来自 `crm_dc_relation_attr` 里 `relation_id` 指回这条关系的**行数** ——
    界面上的判据是「`properties.length > 0`」（RelationRow.vue:206）。
    所以它是**行数**的结果，不是某个列值的结果。
- q: 旧模型里「OBJECT 子行必须恰好 1 行」的启动校验，去哪了？
  a: |
    整个消失了。客体不再是关系下面的一行子项，而是本体行上的 13 个 NOT NULL 列 ——
    一行关系生下来就带一个客体，结构上不存在 0 个或 2 个客体。
    约束换成了两条新的：属性名不得和客体名撞（`collides with the object`）、
    属性名在关系内不得重复（`uk_relation_field` 唯一索引 + `duplicate relation attr`）。
- q: 把 `market` 那一行的 `status` 改成 0，界面上有什么变化？
  a: |
    圈选页上分两种情况。已经写进草稿的条件：AudienceMetadata 里这行还在（带 DISABLED 状态），
    名字照常回显；新建条件的下拉里它消失。属性区还能加行、按钮也还在 ——
    因为 `properties` 里剩下的行数大于 0，判据没被打破。
    想让整块消失，得把这条关系下所有属性行都停用。
```

```summary
title: 一句话总结
text: |
  ==关系的界面形态是「一条本体行 + 另一张表的行数」拼出来的：==
  本体行给出关系本身和客体（13 个 object_* 列长在本行上），
  `crm_dc_relation_attr` 里指回来的行有几行，属性区就能加几种，大于 0 才长出那个按钮。
```
