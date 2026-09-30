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

## 04 · 再往下钻：那张表到底在哪

上一节停在 `column_name: birthday`。但那只是个**列名** —— 它没说在哪张表里。

真实的链条还要往下接两段：元数据里存着**表名**，表名指向 Doris 里**真的存在的表**，
那个表里**真的存着生日**。而「年龄」这个数字，是最后一段代码现算出来的。

把五层摊开看 —— **点上面那排标签换字段**：

```demo
widget: field-lineage
title: 一个字段的五层血缘
hint: 点标签换字段
actions: false
config:
  tabs:
    - key: age
      ui:
        label: 年龄 · age
        src: 'display_name_i18n.zh-CN = "年龄"'
      field:
        rows:
          - [field_key, age]
          - [column_name, birthday]
          - [data_source_id, '1']
          - [semantic_type, 4 （NUMBER）]
        hint: 真列名在这 —— column_name
      source:
        rows:
          - [source_key, user_portrait]
          - [table_name, user_portraits_wide]
        hint: 真表名在这 —— table_name
      table:
        name: user_portraits_wide
        cols:
          - [birthday, DATE, '2002-06-11']
        absent: age —— 这张表里根本没有这一列
      code:
        rows:
          - [project.ts, "fieldKey === 'age' → derive: age_years"]
          - [compile.ts, 'TIMESTAMPDIFF(YEAR, birthday, CURRENT_DATE())']
    - key: region
      ui:
        label: 地区 · region
        src: 'display_name_i18n.zh-CN = "地区"'
      field:
        rows:
          - [field_key, region]
          - [column_name, region]
          - [data_source_id, '1']
          - [semantic_type, 1 （ENUM）]
        hint: 这个字段列名和字段名碰巧一样
      source:
        rows:
          - [source_key, user_portrait]
          - [table_name, user_portraits_wide]
        hint: 同一张表 —— 画像字段都在这
      table:
        name: user_portraits_wide
        cols:
          - [region, VARCHAR(8), SG]
      code:
        rows:
          - ['—', 不需要代码：列名直接用]
    - key: last_trade_days
      ui:
        label: 距上次成交天数
        src: 'display_name_i18n.zh-CN'
      field:
        rows:
          - [field_key, last_trade_days]
          - [column_name, last_trade_time]
          - [data_source_id, '1']
          - [semantic_type, 4 （NUMBER）]
        hint: 又是 NUMBER + DATE —— 和 age 走同一条代码分支
      source:
        rows:
          - [source_key, user_portrait]
          - [table_name, user_portraits_wide]
        hint: 还是同一张表
      table:
        name: user_portraits_wide
        cols:
          - [last_trade_time, DATE, '2026-03-14']
        absent: last_trade_days —— 也没有这一列
      code:
        rows:
          - [project.ts, "fieldKey !== 'age' → derive: days_since"]
          - [compile.ts, 'DATEDIFF(CURRENT_DATE(), last_trade_time)']
```

```callout
tone: blue
icon: 🧱
text: |
  **前四层是数据，第五层是代码。**

  | 层 | 在哪 | Data Admin 改得动吗 |
  |---|---|---|
  | ① 界面文字 | 前端运行时拼的 | 改 ② 就跟着变 |
  | ② `crm_dc_data_field` | MySQL | ✅ 就是它的地盘 |
  | ③ `crm_dc_data_source` | MySQL | ✅ |
  | ④ Doris 表 | 真实存储 | ❌ 不是配置，是数据 |
  | ⑤ 派生规则 | **代码里** | ❌ ==管不到== |
```

### 4.1 那张表里的真实数据

`user_portraits_wide` 宽表一共 43 列。上面三个字段落在里面的样子：

| uid | birthday | region | last_trade_time | 算出来 |
|---|---|---|---|---|
| `10001` | `2002-06-11` | `SG` | `2026-03-14` | 24 岁，距上次成交 200 天 |

**「年龄 24」这个数字，表里没有。** 表里只有 `2002-06-11`。

```compare
first: 字段
head: [表里真实存在的东西, 界面上看到的东西]
rows:
  - 年龄: ['`birthday` = `2002-06-11`', '24']
  - 距上次成交天数: ['`last_trade_time` = `2026-03-14`', '200']
  - 地区: [{ text: '`region` = `SG`', tone: green }, 'SG（原样）']
  - 总资产(USD): [{ text: '`aum_usd` = `4903.00`', tone: green }, '4,903']
```

==前三行是「算出来的」，第四行是「直接读的」。== 这就是 `derive` 的差别。

### 4.2 `age` 为什么是特例

`derive` 不在数据库里 —— 它在 `apps/server/src/metadata/project.ts` 里**按字段名硬编码**：

```ts
if (physical === 'DATE' || physical.startsWith('DATETIME')) {
  // age is the only NUMBER-on-DATE field measured in years; the rest are day counts.
  return {
    valueType: 'int',
    derive: { kind: field.fieldKey === 'age' ? 'age_years' : 'days_since' },
  };
}
```

规则很短：

```text
semantic_type = NUMBER 且 physical_type 是日期
        │
        ├── field_key === 'age'  →  age_years   →  TIMESTAMPDIFF(YEAR, …)
        └── 其它一切             →  days_since  →  DATEDIFF(…)
```

实际走这条分支的字段有 7 个：

```cards
cols: 2
items:
  - title: 走 age_years（按年）
    tag: 只有 1 个
    tone: amber
    body: |
      判据只有一个：`field_key === 'age'`。

      | 字段 | 真实列 | 界面上叫 |
      |---|---|---|
      | `age` | `birthday` | 年龄 |

      生成的 SQL：

      ```text
      TIMESTAMPDIFF(YEAR, birthday, CURRENT_DATE())
      ```

  - title: 走 days_since（按天）
    tag: 其它 6 个
    tone: green
    body: |
      判据是「**不叫 age**」—— 注意字段名里都带 `_days`，但代码**没读那个后缀**。

      | 字段 | 真实列 |
      |---|---|
      | `register_days` | `register_time` |
      | `last_deposit_days` | `last_deposit_time` |
      | `last_trade_days` | `last_trade_time` |
      | `last_touch_days` | `last_touch_time` |
      | `last_call_days` | `last_call_time` |
      | `last_meet_days` | `last_meet_time` |

      生成的 SQL：

      ```text
      DATEDIFF(CURRENT_DATE(), last_trade_time)
      ```
```

````callout
tone: red
icon: ⚠
text: |
  ==**坑：改 `field_key` 会静默改单位。**==

  唯一区分「年」和「天」的东西，是那个字符串 `'age'`。

  如果有人在 Data Admin 里把它改成 `age_years`（听起来更清楚），
  代码会走 `days_since` 分支：

  ```sql
  -- 改之前
  TIMESTAMPDIFF(YEAR, birthday, CURRENT_DATE()) >= 18   -- 成年
  -- 改之后
  DATEDIFF(CURRENT_DATE(), birthday) >= 18              -- 出生满 18 天
  ```

  **不报错，不警告，人数从几百万变成几乎全部。**

  而且这事在 demo 里必然发生 —— **Data Admin 存在的意义就是让人改这个字段。**

  ==修法只有一条：把单位也变成数据（元数据里加一列 `derive_unit`），
  而不是让代码去猜字段名。==
````

## 05 · 前端代码里其实什么都没有

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

## 06 · 中间那层：5 张表怎么拼成一份 catalog

上一节说「前端是个哑渲染器，只认 `catalog.fields`」。

**但 MySQL 里没有叫 `catalog.fields` 的东西。** 数据库里是 5 张分开的表，
每张一个形状。那份 `catalog` 是**后端启动时现拼的**。

这一节就把中间那段接上 —— ==**拉取 → 转换 → 一份前端直接能用的 JSON**==。

```seq
title: catalog 的一生 —— 什么时候拉的、谁在消费
participants:
  - { id: be, label: 后端进程, sub: "8787" }
  - { id: my, label: "MySQL crm_dc", sub: "配置 · 89 行" }
  - { id: fe, label: 浏览器, sub: 圈选页 }
messages:
  - { from: be, to: be, label: "createApp() 先 getCatalog() 验证一遍", kind: self, note: ① 随进程启动 }
  - { from: be, to: my, label: "5 条 SELECT（唯一的读库）", kind: sync, note: ② 只读这一次 }
  - { from: my, to: be, label: "89 行（3+30+47+2+7）", kind: reply }
  - { from: be, to: be, label: "存进 cached 变量", kind: self, note: ③ 之后不再碰 MySQL }
  - { from: fe, to: be, label: "GET /api/meta/catalog", kind: sync, note: ④ 页面加载时拉一次 }
  - { from: be, to: be, label: "rowsToCatalog(缓存的行)", kind: self, note: ⑤ 每次都重跑 }
  - { from: be, to: fe, label: "Catalog JSON", kind: reply }
  - { from: fe, to: fe, label: "v-for 渲染下拉", kind: self, note: ⑥ 之后不再拉 }
gap: 0
segments:
  - { from: 1, to: 4, label: 进程启动时 · 一生只有一次 }
  - { from: 5, to: 8, label: 之后每次打开页面 }
```

````callout
tone: red
icon: ⚠
text: |
  ==**看图上有两处反直觉，都是我从源码里读出来的：**==

  **① MySQL 只读一次。** `getMetadataRows()` 缓存了行：

  ```ts
  let cached: MetadataRows | null = null;
  export async function getMetadataRows() {
    if (!cached) cached = await loadMetadataRows();   // ← 只有第一次真读库
    return cached;
  }
  ```

  **② 但 `rowsToCatalog()` 每次都跑。** `getCatalog()` 每次调用都重新拼一遍：

  ```ts
  export async function getCatalog() {
    return rowsToCatalog(await getMetadataRows(), UNIVERSE_TABLE);   // ← 每次都拼
  }
  ```

  ==**895 行的转换，每个 `/api/meta/catalog` 请求都重跑一次**== —— 缓存的是
  「读出来的行」，不是「拼好的 catalog」。

  之所以这么写，大概率是因为 `rowsToCatalog` 是**纯函数**、而且快（几十毫秒），
  而 `locale` 是每次请求都可能不同的参数 —— 缓存拼好的结果反而要按 locale 分桶。

  代价是：**它每次都在跑那 8 处 `throw`**。改坏了元数据，下一个请求就会炸。
````

```lane-stack
- badge: "01 · MySQL"
  title: 5 张表
  desc: 原始行，按表分开
  tone: violet
  nodes:
    - { title: crm_dc_data_field, sub: "47 行 · 字段字典", tag: 中心 }
    - { title: crm_dc_data_source, sub: "3 行 · 逻辑源 → 物理表" }
    - { title: crm_dc_operator, sub: "30 行 · 类型 → 操作符" }
    - { title: crm_dc_value_set, sub: "2 行 · 共享值集" }
    - { title: business_domain, sub: "7 行 · 业务域" }
  next: "load.ts :: 5 条 SELECT + 行转对象 :: snake_case 变 camelCase"

- badge: "02 · 拉"
  title: MetadataRows
  desc: 形状**没变** —— 还是按表分的 5 个数组
  tone: blue
  nodes:
    - { title: "sources[]", sub: "3 个对象" }
    - { title: "operators[]", sub: "30 个" }
    - { title: "fields[]", sub: "47 个" }
    - { title: "valueSets[]", sub: "2 个" }
    - { title: "domains[]", sub: "7 个" }
  next: "project.ts :: rowsToCatalog() :: 就是这一层"

- badge: "03 · 转"
  title: rowsToCatalog()
  desc: 一趟 map 里做 5 种转换
  tone: amber
  nodes:
    - { title: "① 联表", sub: "data_source_id → table_name" }
    - { title: "② i18n 取值", sub: "display_name_i18n + locale → label" }
    - { title: "③ 类型推导", sub: "semantic_type + physical_type → valueType + derive" }
    - { title: "④ 挑操作符", sub: "semantic_type → ops[]" }
    - { title: "⑤ 解析值集", sub: "value_source_type + value_set_id → options[]" }
  next: "拼成前端要的形状"

- badge: "04 · 结果"
  title: Catalog
  desc: 前端直接就用这个
  tone: green
  nodes:
    - { title: "fields[39]", sub: "{ name, label, table, column, valueType, ops, options }" }
    - { title: "relations[2]", sub: "带 objectSource 和 props[]" }
  next: "HTTP :: GET /api/meta/catalog :: 一次请求拿全量"

- badge: "05 · 界面"
  title: 下拉选项
  desc: v-for 一遍就完事
  tone: muted
  nodes:
    - { title: 年龄 · age, sub: "来自 catalog.fields[0].label" }
    - { title: 地区 · region, sub: "来自 catalog.fields[2].label" }
```

```callout
tone: blue
icon: 🧭
text: |
  **整条链只有两段代码：**

  | 文件 | 行数 | 干什么 |
  |---|---|---|
  | `metadata/load.ts` | 164 | 5 条 `SELECT` + 行转对象（`snake_case` → `camelCase`） |
  | `metadata/project.ts` | **895** | `rowsToCatalog()` —— **就是这一层** |

  ==注意 02 和 03 之间：**形状没变，只是换了名字**。==
  `load.ts` 干的是体力活（搬运 + 改命名），`project.ts` 才真正在**拼**。
```

### 6.1 一趟 map 里做了 5 种转换

`rowsToCatalog()` 的核心就是一个 `.map()`。**点下面任一条规则**，看它读了哪些列、写出了哪些字段：

```arch
svg: rows-to-catalog
caption: 6 条规则各读各的列、各写各的字段。注意它们是**并列的**，不是接力 —— 每条只碰自己那一列。
```

```demo
widget: row-to-catalog
title: 数据库的一行 → 一个下拉项
hint: 点上面换字段，点中间任一条规则看它读了什么
actions: false
config:
  rules:
    - title: ① 直接搬
      from: [field_key, column_name]
      out: [name, column]
      note: 这两列不改，原样搬过去。前端的 `v-for` 就是按 `name` 索引的。
      code: "name:   field.fieldKey\ncolumn: requireColumn(field)   // 空就报错"
    - title: ② 联表
      from: [data_source_id]
      out: [table]
      note: "**这是唯一一次跨表**。`data_source_id` 去 `crm_dc_data_source` 里查，拿到 `table_name`。"
      code: "const source = requireSource(sources, field);\n// sources 是个 Map<id, DataSourceRow>\ntable: source.tableName"
    - title: ③ i18n 取值
      from: [display_name_i18n]
      out: [label]
      note: "三语文案里挑出当前 locale 那一份。挑不到就退回 `field_key` —— 所以界面上永远不会出现空白选项。"
      code: "labelOf(field.displayNameI18n, field.fieldKey, 'zh-CN')\n// → pickLabel(i18n, locale, fallback)"
    - title: ④ 类型推导
      from: [semantic_type, physical_type, field_key]
      out: [valueType, derive]
      note: "**这条最绕**：`semantic_type` 决定大类（枚举 / 布尔 / 数字 / 字符串），数字再看 `physical_type` 是不是日期、是不是小数。是日期的话还要按字段名猜单位。"
      code: "if (semanticType === NUMBER) {\n  if (physical === 'DATE' || physical.startsWith('DATETIME'))\n    return { valueType: 'int',\n             derive: { kind: fieldKey === 'age' ? 'age_years' : 'days_since' } };\n  if (physical.startsWith('DECIMAL')) return { valueType: 'decimal' };\n}"
    - title: ⑤ 挑操作符
      from: [semantic_type]
      out: [ops]
      note: "拿 `semantic_type` 去 `crm_dc_operator` 里筛，再按 `sort_order` 排。**界面上那个操作符下拉的选项就是它。** 数字字段 9 个，布尔字段只有 3 个 —— 差别就在这一行。"
      code: "operators.filter((op) => op.semanticType === field.semanticType)\n  .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)\n  .map((op) => asOp(op.operatorKey))"
    - title: ⑥ 解析值集
      from: [value_source_type, value_mapping, value_set_id]
      out: [options]
      note: "三种来源：`0` 不用值 → 没有选项；`1` 用字段自己内嵌的；`2` **去 `crm_dc_value_set` 里按 `value_set_id` 取**。取到的还要按 locale 翻译、按 `sortOrder` 排、过滤掉停用的。"
      code: "mappingOf(field)\n// value_source_type === 2 时去 valueSets.get(field.valueSetId)\noptionsOf(mapping, locale)\n// 过滤 status / 排序 / 翻译 label"
  tabs:
    - key: age
      srcLabel: MySQL · crm_dc_data_field 的 age 那一行
      outLabel: Catalog · fields[0]
      src:
        - [field_key, age]
        - [column_name, birthday]
        - [display_name_i18n, '{"zh-CN":"年龄", "en":"Age"}']
        - [data_source_id, '1']
        - [semantic_type, '4  (NUMBER)']
        - [physical_type, DATE]
        - [value_source_type, '0  (NONE)']
        - [value_mapping, 'NULL']
      out:
        - [name, '"age"']
        - [label, '"年龄"']
        - [table, '"user_portraits_wide"']
        - [column, '"birthday"']
        - [valueType, '"int"']
        - [derive, '{ kind: "age_years" }']
        - [ops, '[eq, neq, lt, lte, gt, gte, between, …]']
    - key: region
      srcLabel: MySQL · region 那一行 —— 值集内嵌在自己身上
      outLabel: Catalog · fields[region]
      src:
        - [field_key, region]
        - [column_name, region]
        - [display_name_i18n, '{"zh-CN":"地区", "en":"Region"}']
        - [data_source_id, '1']
        - [semantic_type, '1  (ENUM)']
        - [physical_type, VARCHAR(8)]
        - [value_source_type, '1  (INLINE)']
        - [value_mapping, '{"US": {…}, "HK": {…}, …}']
      out:
        - [name, '"region"']
        - [label, '"地区"']
        - [table, '"user_portraits_wide"']
        - [column, '"region"']
        - [valueType, '"enum"']
        - [ops, '[eq, neq, in, not_in, is_null, is_not_null]']
        - [options, '[{value:"US",label:"美国"}, …]']
    - key: city
      srcLabel: MySQL · city 那一行 —— 值集在另一张表里
      outLabel: Catalog · fields[city]
      src:
        - [field_key, city]
        - [column_name, city]
        - [display_name_i18n, '{"zh-CN":"常驻城市", "en":"City"}']
        - [data_source_id, '1']
        - [semantic_type, '1  (ENUM)']
        - [physical_type, VARCHAR(32)]
        - [value_source_type, '2  (VALUE_SET)']
        - [value_set_id, '32  →  crm_dc_value_set']
      out:
        - [name, '"city"']
        - [label, '"常驻城市"']
        - [table, '"user_portraits_wide"']
        - [column, '"city"']
        - [valueType, '"enum"']
        - [ops, '[eq, neq, in, not_in, is_null, is_not_null]']
        - [options, '10 个城市 · 从值集 #32 取的']
    - key: hold_semiconductor
      srcLabel: MySQL · hold_semiconductor 那一行 —— 布尔
      outLabel: Catalog · fields[hold_semiconductor]
      src:
        - [field_key, hold_semiconductor]
        - [column_name, hold_semiconductor]
        - [display_name_i18n, '{"zh-CN":"持仓半导体(画像标记)"}']
        - [data_source_id, '1']
        - [semantic_type, '3  (BOOLEAN)']
        - [physical_type, TINYINT]
        - [value_source_type, '0  (NONE)']
        - [value_mapping, 'NULL']
      out:
        - [name, '"hold_semiconductor"']
        - [label, '"持仓半导体(画像标记)"']
        - [table, '"user_portraits_wide"']
        - [column, '"hold_semiconductor"']
        - [valueType, '"bool"']
        - [ops, '[eq, is_null, is_not_null]  ← 只有 3 个']
    - key: last_trade_days
      srcLabel: MySQL · last_trade_days 那一行 —— 和 age 同一条代码分支
      outLabel: Catalog · fields[last_trade_days]
      src:
        - [field_key, last_trade_days]
        - [column_name, last_trade_time]
        - [display_name_i18n, '{"zh-CN":"距上次成交天数"}']
        - [data_source_id, '1']
        - [semantic_type, '4  (NUMBER)']
        - [physical_type, DATE]
        - [value_source_type, '0  (NONE)']
        - [value_mapping, 'NULL']
      out:
        - [name, '"last_trade_days"']
        - [label, '"距上次成交天数"']
        - [table, '"user_portraits_wide"']
        - [column, '"last_trade_time"']
        - [valueType, '"int"']
        - [derive, '{ kind: "days_since" }  ← 不是 age_years']
        - [ops, '[eq, neq, lt, lte, gt, gte, between, …]']
```

```callout
tone: green
icon: ✅
text: |
  **上面那 5 个标签，每一个都在演示 6 条规则里的一条。**

  | 标签 | 它特别在哪 |
  |---|---|
  | `age` | ④ 最绕的一支：NUMBER + DATE → 现算，且**按年** |
  | `region` | ⑥ 的第一种来源：值集**内嵌在自己身上**（`=1 INLINE`） |
  | `city` | ⑥ 的第二种来源：值集**在 `crm_dc_value_set` 里**（`=2`），要跨表取 |
  | `hold_semiconductor` | ⑤ 最明显的反差：布尔字段只有 **3 个**操作符，数字有 9 个 |
  | `last_trade_days` | ④ 的另一支：**和 `age` 走同一段代码**，只因为字段名不叫 `age`，就变成按天算 |

  ==**5 个标签看完，`rowsToCatalog()` 的每一行代码都被走过一遍了。**==
```


````callout
tone: violet
icon: 💡
text: |
  ==**这 6 条规则加起来的长度，就是这个「转换层」的全部。**==

  它不神秘 —— 就是**一次跨表查字典 + 四次按规则筛**。
  难的部分不是逻辑，是**知道每条规则读哪一列、写哪个字段**。

  对照着看：

  ```
  MySQL 的列                     Catalog 的字段
  ─────────────────────────      ────────────────────
  field_key                  →   name
  column_name                →   column
  data_source_id  ──联表──→      table
  display_name_i18n          →   label
  semantic_type ┐
  physical_type ┴─推导──────→    valueType + derive
  semantic_type ──筛选──────→    ops
  value_source_type ┐
  value_set_id      ┴─解析──→    options
  ```
````

### 6.2 它还是个校验器

`rowsToCatalog()` 里散着 **8 处 `throw`** —— 都是「配置写错了」的检查点：

```compare
first: 检查
head: [拦什么, 报什么错]
rows:
  - 数据源存在: ["`data_source_id` 指向一个不存在的源", "`missing data source 1 for age`"]
  - 列名非空: ["画像字段没填 `column_name`", "`age is missing column_name`"]
  - 语义类型非空: ["没填 `semantic_type`，无法挑操作符", "`age is missing semantic_type`"]
  - 操作符非空: ["某个 `semantic_type` 下一条操作符都没配", "`no operators for age`"]
  - 操作符合法: ["`operator_key` 不在 DSL 认识的集合里", "`unknown operator eqq`"]
  - 值集存在: ["`value_source_type=2` 但 `value_set_id` 是空的/查不到", "`missing value set for city`"]
  - 源类型对得上: ["画像字段挂在一个关系源上", "`portrait age is not on a portrait source`"]
  - 关系结构合法: ["一个关系不是恰好 1 个 OBJECT 子项", "`relation holding has 2 OBJECT items`"]
```

```callout
tone: green
icon: ✅
text: |
  **为什么要在这里报错，而不是等到查数据的时候？**

  因为 `Catalog` 是**前端信任的形状**。

  ==一旦它拼出来了，后面所有环节都假定它是对的：==
  前端直接拿 `label` 渲染、拿 `ops` 填下拉、拿 `table` + `column` 去编 SQL。

  一个坏的 `column_name` 会一路走到 Doris 才炸，那时候的报错是
  「列不存在」—— **你根本不知道是元数据写错了。**

  所以这一层把错误**提前到启动时**：后端启动会先 `getCatalog()`，
  配错了就直接起不来，而不是等到运营点「查询」才发现。
```

### 6.3 那缓存呢

````callout
tone: amber
icon: ⚠
text: |
  这一整套只跑**一次**。

  ```ts
  // metadata/source.ts
  let cached: MetadataRows | null = null;
  export function getMetadataRows() {
    if (!cached) cached = await loadMetadataRows();   // 只读一次
    return cached;
  }
  ```

  后面每次 `/api/meta/catalog` 都是直接返回内存里那份。

  ==所以改了元数据要重启后端才生效 —— 这个坑在 09 节展开。==
````

---

## 07 · 为什么要隔这么一层

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

## 08 · 那这个 demo 里，Data Admin 在哪

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

## 09 · 一个真实的坑：改了配置，界面不变

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
