你在圈选页点开「年龄」那个下拉框，看到一列字：**年龄、性别、地区、常驻城市、总资产(USD)…**

这些字从哪来的？

直觉会想「前端代码里写的吧」。**不是。** 前端代码里一个都没有。

它们存在一个 MySQL 库里，由一个叫 **Data Admin** 的服务写进去，浏览器读出来现拼。

```callout
tone: blue
icon: 🎯
text: |
  **这篇回答三个问题**：

  - Data Admin 和圈选页，到底是什么关系？
  - 为什么我改一行数据库，界面就变了？
  - 这个 demo 里为什么找不到 Data Admin 这个服务？

  ==读完你打开那个界面，看到的每一项都能说出它来自哪一行。==
```

---

## 01 · 先说清「两个界面」

最容易混的地方：**Data Admin 自己也是一个界面。**

```
Data Admin            圈选页
（配置台）             （使用台）
────────             ────────
给运营/数据同学用      给客经用
配「能筛什么」         真去筛人

改这里 ─────────────→ 那边就变了
```

```compare
first: 维度
head: [Data Admin 配置台, 圈选页]
rows:
  - 谁在用: [运营 / 数据同学, 客户经理]
  - 干什么: [配字段、配操作符、配值集, 选条件、查人数、建快照]
  - 改的是什么: ["**元数据**（有哪些字）", "**数据**（筛出哪些人）"]
  - 写了之后: [存进 MySQL，给别人读, 什么都不写，只读]
  - 这个 demo 里有吗: [{ text: "没有 —— 只有它的脚本替身", tone: amber }, { text: 有, tone: green }]
```

**关键那句**：

> ==Data Admin 决定「你能看到哪些选项」，圈选页决定「你选了哪些选项」。==

## 02 · 这条链长什么样

```arch
svg: data-admin-flow
caption: 写在一侧（左），读在另一侧（右）。中间没有回头的箭头 —— 圈选页改不了配置。
```

图上有两条边值得盯一眼：

- **绿色的 `SELECT 只读`** —— 后端只读，不写
- **紫色的虚线 `点「查询」才走这条`** —— 这是**另一条路**，去 Doris 拿真实数据。跟配置无关

==两条路别搞混：上面那条决定「界面长什么样」，下面那条决定「筛出谁」。==

---

## 03 · 界面上每个字，追到数据库的一行

下面左边是 MySQL 里 `crm_dc_data_field` 的真实记录（可以改），右边是照着它渲染出来的界面。

**试试这三件事**：

1. **点左边任意一条记录** → 右边它影响的地方全亮起来
2. **改左边 `display_name_i18n.zh-CN` 那格** → 右边的下拉文字当场变
3. **把某条的 `status` 勾掉** → 右边下拉框里它就消失了

```demo
widget: config-to-ui
title: 配置 → 界面（左边改，右边变）
hint: 点左边任意一条记录
actions: false
config:
  rows:
    - { key: age,       zh: 年龄,        col: birthday,     vt: number,  on: true }
    - { key: region,    zh: 地区,        col: region,       vt: enum,    on: true }
    - { key: aum_usd,   zh: 总资产(USD), col: aum_usd,      vt: decimal, on: true }
    - { key: cash_hkd,  zh: 现金(HKD),   col: cash_hkd,     vt: decimal, on: true }
    - { key: city,      zh: 常驻城市,    col: city,         vt: enum,    on: true }
    - { key: gender,    zh: 性别,        col: gender,       vt: enum,    on: true }
    - { key: nps_score, zh: NPS 评分,    col: nps_score,    vt: number,  on: false }
  conds:
    - { key: age,      op: gte, val: 18 }
    - { key: region,   op: eq,  val: US }
    - { key: aum_usd,  op: gte, val: 1000 }
  ops:
    number: [eq, neq, lt, lte, gt, gte, between]
    decimal: [eq, neq, lt, lte, gt, gte]
    string: [eq, neq, in, notIn]
    enum: [eq, neq, in, notIn]
  opLabels:
    eq: 等于
    neq: 不等于
    lt: 小于
    lte: 小于等于
    gt: 大于
    gte: 大于等于
    between: 介于
    in: 属于
    notIn: 不属于
  vtLabels:
    number: NUMBER
    decimal: DECIMAL
    string: STRING
    enum: ENUM
  facts:
    total: 46
    feature: 39
    rel: 7
```

```callout
tone: violet
icon: 💡
text: |
  **注意「操作符」那一列也是从数据库来的。**

  它不在 `crm_dc_data_field` 里，而在另一张表 `crm_dc_operator` —— 存的是「**类型 → 能用哪些操作符**」：

  | value_type | 可用操作符 |
  |---|---|
  | `number` | 等于 不等于 小于 小于等于 大于 大于等于 介于 |
  | `string` | 等于 不等于 属于 不属于 |
  | `enum` | 等于 不等于 属于 不属于 |

  所以把 `age` 的 `value_type` 从 `number` 改成 `string`，
  右边的操作符下拉会**自动换成另一套** —— 前端同样一行都不用改。
```

---

## 04 · 前端代码里其实什么都没有

这是最反直觉的地方。你以为前端是这样写的：

```text
// ❌ 你以为的
<option>年龄</option>
<option>性别</option>
<option>地区</option>
... 手写 39 行
```

真实的是这样：

```text
// ✅ 真实的（App.vue）
<el-option
  v-for="f in catalog.fields"    ← 循环，没有字段名
  :key="f.name"
  :label="f.label"               ← 文字从数据来
/>
```

**`catalog.fields` 就是 Data Admin 写进去的那 39 条画像字段。**

```compare
first: 你以为
head: [前端负责, 实际是]
rows:
  - 有哪些字段: [前端写死的清单, 后端从 MySQL 读出来的]
  - 字段叫什么: [前端写死的中文, 存在 `display_name_i18n` 里，三语]
  - 能用哪些操作符: [前端按字段写 if/else, 存在 `crm_dc_operator` 里，按类型查]
  - 下拉选项是什么: [前端写死的数组, 存在 `value_mapping` / `value_set` 里]
  - 加一个字段: [{ text: 改前端代码 + 发版, tone: red }, { text: 数据库加一行, tone: green }]
```

==前端是个「哑渲染器」。它不认识「年龄」，只认识「配置里有 N 个字段」。==

这就是为什么改数据库能改界面 —— **界面本来就是照着数据库画的。**

```callout
tone: blue
icon: 🔢
text: |
  **那 46 条记录具体是什么？**

  `crm_dc_data_field` 里有个 `field_type` 列，它把记录分成三种：

  | field_type | 含义 | 条数 | 去哪了 |
  |---|---|---|---|
  | `1` | FEATURE —— 画像字段 | **39** | 字段下拉里的 39 个选项 |
  | `2` | RELATION —— 关系 | **2** | 关系下拉（持仓 / 产品） |
  | `3` | RELATION_ITEM —— 关系上的属性 | **5** | 选了关系之后才能选 |

  所以 `catalog.fields` 是 **39**，不是 46。
  ==把「记录数」当成「选项数」是这个 demo 里最容易报错的数字。==
```

---

## 05 · 为什么要隔这么一层

直接在前端写死不是更简单吗？三个理由：

````cards
cols: 3
items:
  - title: 表名会变
    tag: 解耦
    tone: violet
    body: |
      DSL 里说的是「查 `user_portrait`」，SQL 里说的是「查 `user_portraits_wide`」。

      中间的对应关系只存在 `crm_dc_data_source` 一条记录里：

      ```
      source_key      table_name
      user_portrait → user_portraits_wide
      holding       → rel_holding
      product       → rel_product
      ```

      ==表改名、迁库、拆表，改这一行，代码一行不动。==

  - title: 要能停用
    tag: 运营
    tone: amber
    body: |
      `status` 有 `0` / `1` 两个值。

      某个字段上游断了、口径有问题、暂时不想给人用 —— 把它设成 `0`：

      ```
      UPDATE crm_dc_data_field SET status = 0 WHERE field_key = 'city';
      ```

      界面上下拉框里就没它了。**不用删代码，不用发版。**
      （上面那个交互里你已经试过了。）

  - title: 要多语言
    tag: 国际化
    tone: blue
    body: |
      存的是 JSON，不是字符串：

      ```json
      { "zh-CN": "年龄", "en": "Age", "zh-HK": "年齡" }
      ```

      你截图右上角那个「简体中文」下拉切换时，
      ==39 个字段名、18 个操作符、值集里的城市名，全部跟着换。==
````

````callout
tone: amber
icon: ⚠
text: |
  **但这层「解耦」只做了一半。**

  代码里仍然有硬编码的表名：

  ```ts
  // apps/server/src/metadata/config.ts
  export const UNIVERSE_TABLE = 'user_portraits_wide';   // ← 写死的

  // apps/server/src/metadata/project.ts
  const PHYSICAL_TYPES = {
    'user_portraits_wide.birthday': 'DATE',              // ← 写死一整套
    'user_portraits_wide.gender':   'VARCHAR(8)',
    ...
  }
  ```

  **盲点一**：宽表（"全集"）本身是硬编码的 —— `crm_dc_data_source` 只管关系数据源
  **盲点二**：物理列类型没进元数据，所以要在代码里再维护一份兜底表

  ==写进文档的时候要说清楚：解耦是设计意图，不是已完成状态。==
````

---

## 06 · 那这个 demo 里，Data Admin 在哪

**它不存在。** 架构文档里写得很直白：

```callout
tone: muted
icon: 📄
quote: true
text: |
  > 本仓库 demo 把编译和落表都写在 `apps/server`。
  > **下面是目标切分，不是当前进程边界。**
  >
  > —— `docs/架构与调用.md`
```

目标是三个服务，demo 只有中间那段：

```compare
first: 服务
head: [目标架构, 这个 demo]
rows:
  - Node DSL: [{ text: 独立服务，校验 + 编 SQL, tone: green }, { text: 在 apps/server 里, tone: amber }]
  - Data Admin: [{ text: "独立服务，**Catalog 的写入口**", tone: green }, { text: 只有 seed.ts 脚本, tone: red }]
  - DAL: [{ text: 独立服务，唯一数据面, tone: green }, { text: 在 apps/server 里, tone: amber }]
  - 元数据写接口: [{ text: CRUD, tone: green }, { text: "**没有** —— /api/meta/* 全是 GET", tone: red }]
```

**demo 里谁扮演 Data Admin？**

```
apps/server/src/metadata/seed.ts
```

一个把 46 条字段记录、18 个操作符、3 个数据源**全硬编码在代码里**的脚本。我跑的那条 `metadata:seed` 就是它。

所以「加一个字段」这件事，两条路差别巨大：

```flow
grid: true
legend: true
nodes:
  - { id: n1, label: "① 改 seed.ts", sub: "46 条记录里插一条", row: 0, tone: amber }
  - { id: g1, label: "① 点几下表单", sub: "在 Data Admin 里", row: 0, tone: green }
  - { id: n2, label: "② 重跑脚本", sub: metadata:seed, row: 1, tone: amber }
  - { id: g2, label: "② MySQL 多一行", sub: INSERT, row: 1, tone: green }
  - { id: n3, label: "③ 重启后端", sub: "缓存不会自己刷", row: 2, tone: amber }
  - { id: g3, label: "③ 不需要", sub: "这一步没了", row: 2, tone: muted, shape: note }
  - { id: end, label: 界面多一项, sub: "前端从头到尾没动过", row: 3, tone: violet }
edges:
  - { from: n1, to: n2 }
  - { from: n2, to: n3 }
  - { from: n3, to: end, anim: true }
  - { from: g1, to: g2 }
  - { from: g2, to: g3, dashed: true }
  - { from: g3, to: end, dashed: true, anim: true }
```

两条路（**黄=改代码，绿=改数据**）在底部**汇合到同一个节点**。

绿色那条中间多一个虚线框「③ 不需要」—— 那就是差别所在：
==同一步，开发要重启后端，运营什么都不用做。==

**终点一模一样**：「界面多一项，前端从头到尾没动过」。

==差别只在「谁来搬这一步」—— 开发改代码，还是运营点按钮。== 这就是 Data Admin 存在的全部意义。

---

## 07 · 一个真实的坑：改了配置，界面不变

我在做上面那个实验时撞到的：改完 MySQL，**接口仍然返回旧值**。

```text
$ mysql -e "UPDATE crm_dc_data_field SET display_name_i18n='...年龄★我改的...' WHERE field_key='age'"
$ curl -s /api/meta/catalog | grep 年龄
  "label": "年龄"          ← 还是旧的！
```

原因是后端把 catalog **缓存在进程里**：

```ts
// apps/server/src/metadata/source.ts
let cached: MetadataRows | null = null;          // ← 进程内缓存

export function getMetadataRows() {
  if (!cached) cached = await loadMetadataRows(); // 只读一次
  return cached;
}

export function resetCatalogCache(): void {       // ← 定义了
  cached = null;
}
```

```callout
tone: red
icon: ⚠
text: |
  ==`resetCatalogCache()` 全项目搜下来，只有定义、没有任何调用点 —— 死代码。==

  所以**改完元数据必须重启后端**才生效。我在实验里是用 `touch` 触发
  `tsx watch` 重启才看到变化的。

  **为什么这件事重要**：等 Data Admin 真正上线，它写完 MySQL 之后，
  后端**必须能被通知刷新缓存** —— 否则运营在配置台改完，用户看到的还是旧的。

  ==这是目标架构里必须补上的一环，而 demo 里它被缓存掩盖了。==
```

---

```summary
title: 三句话总结
text: |
  **Data Admin 是配置台，圈选页是使用台。** 前者写，后者读，中间隔着 MySQL 和一次 HTTP。

  **界面上每个字都来自数据库** —— 前端代码里只有循环，没有字段名。所以改数据就能改界面。

  ==这个 demo 没有 Data Admin==，只有 `seed.ts` 一个脚本替身。
  加字段 = 改代码 + 重跑 + 重启后端。
```

```quiz
- q: "运营说「把『年龄』改叫『年龄区间』」。你要改哪里？"
  a: |
    改 `crm_dc_data_field` 里 `field_key='age'` 那行的
    `display_name_i18n.zh-CN`。**前端一行都不用动。**

    注意：改完要**重启后端**（catalog 缓存在进程里，`resetCatalogCache` 是死代码）。
    而且这应该通过 Data Admin 来做，不是手敲 SQL。

- q: "为什么「年龄」筛 ≥18，生成的 SQL 却是 `TIMESTAMPDIFF(YEAR, birthday, ...)`？"
  a: |
    因为元数据里 `field_key = 'age'` 那行的 `column_name` 是 **`birthday`**。

    数据库里**根本没有 age 这个列** —— 它是元数据层面的一层映射，
    编译器照着 `column_name` 走，派生逻辑由 `semantic_type` 决定。

- q: "圈选页上「大于等于」这个操作符，是前端写死的吗？"
  a: |
    不是。它来自 `crm_dc_operator` 表 ——「类型 → 可用操作符」的映射。

    `number` 有 7 个（含 `between`），`string` / `enum` 只有 4 个（`eq/neq/in/notIn`）。
    所以把某个字段的 `value_type` 改掉，它的操作符下拉会**自动换一整套**。
```
