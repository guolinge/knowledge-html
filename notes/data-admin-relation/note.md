你在圈选页把条件选成「持仓标的」，那一行会从一格变成三块：一个「选择标的」的多选框、一块能加好几行的属性区，还有一个蓝色的「+ 添加属性」。

奇怪的地方在于：在元数据表里，关系跟「性别」这种画像字段占的是同一个位置，都是 `crm_dc_data_field` 里的一行。凭什么它一选中就多长出两格控件？

```callout
tone: blue
icon: 🎯
text: |
  **这篇回答一个问题**：==「+ 添加属性」是表里哪一列决定的？==

  答案先给出来：!!没有哪一列单独决定它!!，它看的是一个**行数**。
  下面从界面往回走，一直走到表里的行。
```

---

## 01 · 三块界面，三行数据

界面上这三块是挨着的，在表里却是三条互不相干的记录，靠一个自引用的列串起来：

```flow
nodes:
  - { id: rel,  label: 关系本体那一行, sub: "field_type = 2", row: 0, kind: database }
  - { id: u_rel, label: 关系下拉里的「持仓标的」, sub: "名字来自本体行", row: 0, tone: blue }
  - { id: obj,  label: 对象那一行, sub: "item_role = 1", row: 1, kind: database }
  - { id: u_obj, label: 「选择标的」多选框, sub: "候选值来自对象行", row: 1, tone: blue }
  - { id: prop, label: 属性那两行, sub: "item_role = 2", row: 2, kind: database }
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
  - 关系下拉里有没有这一项: ["有一行 `field_type = 2`，并且它是启用的"]
  - 关系显示成什么名字: ["那一行的 `display_name_i18n`，按当前语言取"]
  - 「选择标的」那个多选框: ["它下面**恰好 1 行** `item_role = 1` 的子行"]
  - 属性区能加几行: ["`item_role = 2` 的子行**有几行**"]
  - 「+ 添加属性」出不出现: [{ text: "上面那个数字大于 0", tone: green }]
```

---

## 02 · 关系不是一个字段，是一个家族

画像字段一行就能说完：「用户身上有一个值」。性别、年龄、总资产都是这个形状。

关系说的不是「有一个值」，而是「有一个集合」，集合里每一项还各带自己的属性（市场、数量、状态）。这个形状塞不进一行，所以拆成本体一行，加上每个子项一行，子行用 `parent_id` 指回本体。

拿 demo 里的 `holding` 举例，家族长这样：

```tree
- label: holding
  sub: "id=64 · field_type=2 · parent_id=0"
  tone: violet
  note: 关系本体。界面上的「持仓标的」就是这一行
  children:
    - { label: object_id, sub: "id=65 · item_role=1", note: "对象行 →「选择标的」下拉（配的是股票搜索）" }
    - { label: market, sub: "id=66 · item_role=2", note: "属性行 → 属性区第 1 格，值来自值集 market" }
    - { label: qty, sub: "id=67 · item_role=2", note: "属性行 → 属性区第 2 格，纯数字，没有值集" }
```

另一个关系 `product` 形状一样，只是子行少一行。两个家族摆一起，差别只在数量上：

```compare
first: 这一行
head: [holding 家族, product 家族]
rows:
  - 本体: ["id=64 · `field_type=2`", "id=68 · `field_type=2`"]
  - 对象行: ["id=65 `object_id` · STRING · 动态搜股票", "id=69 `object_id` · ENUM · 内联 10 个产品"]
  - 属性行 1: ["id=66 `market` · ENUM · 值集", "id=70 `status` · ENUM · 内联（生效 / 已关闭）"]
  - 属性行 2: ["id=67 `qty` · NUMBER · 无值集", { text: "没有第三行", tone: muted }]
  - 界面上能加几种属性: [{ text: "2 种", tone: green }, { text: "1 种", tone: amber }]
```

`holding` 一共 4 行（1 本体 + 3 子行），`product` 3 行（1 本体 + 2 子行）。这 7 行就是全库所有的关系数据，其余 40 行都是画像字段。

---

## 03 · 后端只做四件事

从这些行到前端拿到的 `relations[]`，中间是 `apps/server/src/metadata/project.ts` 里的一段投影。它按顺序做四件事：

```lane-stack
- badge: STEP 01
  title: 读进来
  desc: 停用的行在这里就没了
  tone: muted
  nodes:
    - { title: rows.fields, sub: "status = 1 才进得来", tag: project.ts:190 }
  next: "认亲 :: 谁属于谁 :: 靠自引用的 parent_id"

- title: 认亲
  desc: 本体和它的子行配对
  tone: blue
  nodes:
    - { title: 本体, sub: "field_type = 2 → relations[] 的候选" }
    - { title: 子行, sub: "field_type = 3 且 parent_id 指回本体" }
  next: "分流 :: 子行有两个身份 :: 靠 item_role 分"

- title: 分流
  desc: 同一个 parent 下的子行分两堆
  tone: violet
  nodes:
    - { title: object, sub: "item_role = 1 · 只能有 1 行" }
    - { title: properties, sub: "item_role = 2 · 0 到 N 行" }
  next: "打包 :: 一堆行变成一个对象 :: 交给前端"

- title: 打包
  desc: 前端看到的是一个关系对象，不是一堆行
  tone: green
  nodes:
    - { title: "relations[] 的一个元素", sub: "{ name, label, table, object, properties }" }
```

第二步和第三步是同一段代码里的两个 `filter`，`project.ts` 189 到 230 行：

````cards
cols: 2
items:
  - title: 认亲：两个 filter 夹住一个 parent_id
    tone: blue
    desc: "全表扫两遍，靠 `field_type` 和后向的 `parent_id` 把父子配起来。"
    body: |
      ```js
      // 本体
      rows.fields.filter((f) =>
        f.status === ENABLED && f.fieldType === RELATION)

      // 它的子行
      rows.fields.filter((f) =>
        f.status === ENABLED &&
        f.fieldType === RELATION_ITEM &&
        f.parentId === relation.id)
      ```
  - title: 分流：一列决定身份
    tone: violet
    desc: "两堆的差别只有一个 `item_role`，但后面走的路完全不同。"
    body: |
      ```js
      const objectItems = children.filter(
        (c) => c.itemRole === ItemRole.OBJECT);

      const props = children.filter(
        (c) => c.itemRole === ItemRole.PROPERTY);
      ```

      对象进入 `relation.object`，属性进入 `relation.properties`。
      前端拿到的就不是「子行列表」，而是两个语义明确的字段。
````

````callout
tone: amber
icon: 🚨
text: |
  **对象行写在表里的数量，是有约束的。**

  ```js
  if (objectItems.length !== 1) {
    throw new Error(`relation ${relation.fieldKey} has ${objectItems.length} OBJECT items`);
  }
  ```

  `project.ts:203`。0 行的话，「选择标的」没有候选值来源；2 行的话，
  两个 C 端控件抢一个位置。两种都是配置错误，所以它在投影阶段就炸掉。

  这一步发生在 `createApp` 里（`app.ts:25`），也就是**服务起不来**，
  而不是等用户在界面上发现不对。
````

属性那一堆还各自带参数。`market` 的值域来自值集表，`qty` 的什么都没有，`product` 的 `status` 把选项内嵌在自己行里：

```spec
title: 属性行自己带的三样参数
subtitle: 每个属性一行，互不共享
tone: violet
rows:
  - k: 能配哪些操作符
    v: |
      按自己的 `semantic_type` 去后端给的 `operators` 那张表里取一整套（这张表按语义类型分组）。
      `market`（ENUM）拿到 6 个：等于 / 不等于 / 属于 / 不属于 / 为空 / 不为空；
      `qty`（NUMBER）拿到 11 个，多出大小比较和区间。
  - k: 值从哪来
    v: |
      `value_source_type` 定三种来源：`1` 内嵌在自己这一行、`2` 去 `crm_dc_value_set` 取、
      `3` 动态搜索、`0` 不要值。
      `market` 是 `2`（值集 id 79，港股 / 美股），`qty` 是 `0`，`product.status` 是 `1`。
  - k: 落在哪一列
    v: |
      `column_name` 和 `expr` 二选一：直连列填前者，派生填后者。
      两者都空或者都有，投影时报错。
```

---

## 04 · 判据是数行数

现在能回答开头那个问题了。前端要的判据只有一行（`RelationRow.vue:199`）：

```js
const canFilterProps = computed(() => (relationDef.value?.properties.length ?? 0) > 0);
```

它读的是**数组长度**，不是某一列的某个值。而数组长度等于「`parent_id` 指回这个关系、`item_role = 2`、且启用着的行」有几行。三种行数对应三种界面：

```compare
first: 子行数量
head: [后端给出的 properties, 界面上那一块]
rows:
  - "0 行": [{ text: "[]", tone: muted }, { text: "整块不出现，连按钮都没有", tone: red }]
  - "1 行": ["1 个属性定义", { text: "一个属性行 + 「+ 添加属性」", tone: green }]
  - "2 行": ["2 个属性定义", { text: "两个属性行 + 「+ 添加属性」", tone: green }]
```

!!同一个按钮有两个文案，而且位置不一样!!，很容易以为是两个功能（`RelationRow.vue:69` 和 `:141`）：

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
  两个按钮点下去跑的是同一个函数（`addProp()`，`RelationRow.vue:339`），
  差别只在「要不要先给一个空属性行打头」。
```

关系行本体还有另外两个下拉，它们跟属性无关，跟这条关系整体有关：公式（`怎么比`：包含这些 / 持仓只数）和操作符（`存在` / `不存在`）。列表来自 `ops.ts` 里两个常量，跟属性那一套操作符是分开的。

---

## 05 · 亲手走一遍

左边是 MySQL 里的一行，右边是前端拿到的那个字段。点上面换行，点中间任一条规则看它读了哪些列：

````demo
widget: row-to-catalog
title: 从表里的一行，到界面上的一块
hint: |
  点上面切换看的是哪一行，点中间任一条规则，看它读了哪些列、写出了什么。
actions: false
config:
  rules:
    - title: ① 认亲
      from: [field_type, parent_id]
      out: [name, table, properties, object]
      note: "本表自引用：`field_type = 2` 的是本体，`field_type = 3` 且 `parent_id` 指回它的是子行。没有外键，靠这两列认。"
      code: "rows.fields.filter((f) =>\n  f.fieldType === RELATION_ITEM &&\n  f.parentId === relation.id)"
    - title: ② 分流
      from: [item_role]
      out: [object, properties]
      note: "**这一列把子行分成两堆**：`1` 走对象，`2` 走属性。属性几行，界面就能加几种。"
      code: "children.filter((c) => c.itemRole === OBJECT)\nchildren.filter((c) => c.itemRole === PROPERTY)"
    - title: ③ 对象只能有一行
      from: [item_role]
      out: [object]
      note: "数量不等于 1 就在这里抛错。这个校验在建 app 的时候就跑了，不等界面上出错。"
      code: "if (objectItems.length !== 1) {\n  throw new Error(`relation x has N OBJECT items`);\n}"
    - title: ④ 属性各带各的参数
      from: [semantic_type, column_name, value_source_type, value_set_id, value_resolver_key]
      out: [ops, options, valueSource]
      note: "每个属性自己决定：能配哪些操作符（看语义类型）、值从哪来（内嵌 / 值集 / 动态搜索）。"
      code: "opsFor(operators, prop.semanticType, label)\noptionsOf(mappingOf(prop), locale)"
    - title: ⑤ 界面那一块
      from: [item_role]
      out: [ui]
      note: "**属性数组不为空，属性和按钮一起出现**；数组为空，整块都不出现。"
      code: "computed(() => (relationDef.value?.properties.length ?? 0) > 0)"
  tabs:
    - key: holding · 本体行
      srcLabel: MySQL · crm_dc_data_field 的 holding 那一行
      outLabel: Catalog · relations[holding]
      src:
        - [id, "64"]
        - [field_key, holding]
        - [field_type, "2  (RELATION)"]
        - [parent_id, "0"]
        - [data_source_id, "2"]
        - [column_name, NULL]
        - [status, "1  (ENABLED)"]
      out:
        - [name, '"holding"']
        - [label, '"持仓标的"']
        - [table, 'rel_holding']
        - [object, '{ key: "object_id" }']
        - [properties, "[market, qty]"]
        - [ui, '关系下拉 + 「选择标的」+ 属性区 + 「+ 添加属性」']
    - key: object_id · 对象行
      srcLabel: MySQL · 子行 object_id（holding 的对象）
      outLabel: Catalog · relations[holding].object
      src:
        - [id, "65"]
        - [field_key, object_id]
        - [field_type, "3  (RELATION_ITEM)"]
        - [item_role, "1  (OBJECT)"]
        - [parent_id, "64 → holding"]
        - [semantic_type, "5  (STRING)"]
        - [value_source_type, "3  (DYNAMIC)"]
        - [value_resolver_key, stock_search]
      out:
        - [object, '{ key: "object_id", semanticType: "STRING" }']
        - [valueSource, '{ type: "DYNAMIC", resolverKey: "stock_search" }']
        - [ui, '「选择标的」多选框，输入时远端搜股票']
    - key: market · 属性行
      srcLabel: MySQL · 子行 market（值集在另一张表）
      outLabel: Catalog · relations[holding].properties[0]
      src:
        - [id, "66"]
        - [field_key, market]
        - [field_type, "3  (RELATION_ITEM)"]
        - [item_role, "2  (PROPERTY)"]
        - [parent_id, "64 → holding"]
        - [semantic_type, "1  (ENUM)"]
        - [value_source_type, "2  (VALUE_SET)"]
        - [value_set_id, "79 → 值集 market"]
      out:
        - [properties, market]
        - [ops, "ENUM 那一套：eq neq in not_in is_null is_not_null"]
        - [options, "港股 / 美股"]
        - [ui, "属性区第 1 格"]
    - key: qty · 属性行
      srcLabel: MySQL · 子行 qty（什么值集都没有）
      outLabel: Catalog · relations[holding].properties[1]
      src:
        - [id, "67"]
        - [field_key, qty]
        - [field_type, "3  (RELATION_ITEM)"]
        - [item_role, "2  (PROPERTY)"]
        - [parent_id, "64 → holding"]
        - [semantic_type, "4  (NUMBER)"]
        - [value_source_type, "0  (NONE)"]
        - [value_set_id, NULL]
      out:
        - [properties, qty]
        - [ops, "NUMBER 那一套：多出 lt lte gt gte between"]
        - [options, "NULL，要手输数字"]
        - [ui, "属性区第 2 格"]
````

---

## 06 · 三个容易记错的地方

```cards
cols: 3
items:
  - title: 重名只在同一个 parent 内被禁止
    tone: amber
    desc: "`object_id` 在 `holding` 和 `product` 下各有一行，语义完全不同：一个搜股票，一个选产品。`field_key` 只在同一个 parent 内不许重名。"
  - title: 停用不是变灰，是消失
    tone: red
    desc: "投影第一步只留 `status = 1` 的行。停用一个属性行，属性下拉里直接少一个选项；子行全停用，整块按钮一起不见。"
  - title: 没有属性的关系是合法的
    tone: muted
    desc: "属性数组为空时按钮不出现，这条关系就只剩「存在 / 不存在」和「条数」两种筛法。demo 里两个关系都有属性，所以这条分支看不到。"
```

```quiz
- q: 「+ 添加属性」这个按钮，是 `crm_dc_data_field` 的哪一列决定的？
  a: |
    没有哪一列单独决定它。定位靠 `parent_id`（指回关系本体）和 `field_type = 3`，
    计数靠 `item_role = 2`，界面上的判据是「这堆子行的**数量**大于 0」。
    所以它是**行数**的结果，不是某个列值的结果。
- q: 把 `qty` 那行的 `item_role` 从 2 改成 1，会发生什么？
  a: |
    服务启动就失败，报 `relation holding has 2 OBJECT items`。
    对象行只能有 1 行（`project.ts:203`），这个错在建 app 的时候就抛出来了，
    不会等到用户在界面上看到两个「选择标的」。
- q: 把 `market` 那一行的 `status` 改成 0，界面上有什么变化？
  a: |
    属性下拉里少掉「市场」这一个选项，属性区还能加行，按钮也还在。
    因为 `properties` 从 2 个变成 1 个，判据是「个数大于 0」，没被打破。
    想让整块消失，得把所有属性行都停用。
```

```summary
title: 一句话总结
text: |
  ==关系的界面形态不是某一列决定的，是「子行的数量」决定的：==
  本体行给出关系本身，`item_role = 1` 的那一行变成「选择标的」，
  `item_role = 2` 的行有几行，属性区就能加几种，大于 0 才长出那个按钮。
```
