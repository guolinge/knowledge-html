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
  - 干什么: [配字段、配值集、停用启用, 选条件、查人数、建快照]
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

下面左边是 MySQL 里 `crm_dc_portrait` 的真实记录（可以改），右边是照着它渲染出来的界面。

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
  table: crm_dc_portrait
  rows:
    - { key: age,       zh: 年龄,        col: birthday,     vt: rangeLong,   on: true }
    - { key: region,    zh: 地区,        col: region,       vt: enumString,  on: true }
    - { key: aum_usd,   zh: 总资产(USD), col: aum_usd,      vt: rangeDouble, on: true }
    - { key: cash_hkd,  zh: 现金(HKD),   col: cash_hkd,     vt: rangeDouble, on: true }
    - { key: city,      zh: 常驻城市,    col: city,         vt: enumString,  on: true }
    - { key: gender,    zh: 性别,        col: gender,       vt: enumString,  on: true }
    - { key: nps_score, zh: NPS 评分,    col: nps_score,    vt: rangeLong,   on: false }
  conds:
    - { key: age,      op: gte, val: 18 }
    - { key: region,   op: eq,  val: US }
    - { key: aum_usd,  op: gte, val: 1000 }
  ops:
    rangeLong: [eq, neq, lt, lte, gt, gte, between, is_null, is_not_null]
    rangeDouble: [eq, neq, lt, lte, gt, gte, between, is_null, is_not_null]
    enumString: [eq, neq, in, not_in, is_null, is_not_null]
  opLabels:
    eq: 等于
    neq: 不等于
    lt: 小于
    lte: 小于等于
    gt: 大于
    gte: 大于等于
    between: 介于
    in: 属于
    not_in: 不属于
    is_null: 为空
    is_not_null: 不为空
  vtLabels:
    rangeLong: range · long
    rangeDouble: range · double
    enumString: enum · string
  facts:
    total: 45
    feature: 40
    rel: 2
    attr: 3
    tail: '另外 <b>2</b> 行是关系、<b>3</b> 行是关系属性，走另一条路。'
```

```callout
tone: violet
icon: 💡
text: |
  **「操作符」那一列也不是从数据库来的 —— 这一版连表都没有。**

  一个字段能用哪些操作符，由它自己的形状算出来（`applicableOps`，按 `variable_type` /
  `data_type` / `content_type` 三列算）：

  | 字段形状 | 算出来的操作符 |
  |---|---|
  | `enum`，或 `string` | 等于 不等于 属于 不属于 为空 不为空 |
  | `boolean` | 等于 为空 不为空 |
  | `long` / `double` | 等于 不等于 小于 小于等于 大于 大于等于 介于 为空 不为空 |
  | `content_type = 1`（日期）/ `2`（时间） | 上面那套再追加 最近X天/X小时 之前X天/X小时 |

  所以把 `age` 的 `data_type` 从 `long` 改成 `string`，
  右边的操作符下拉会**自动换成另一套** —— 前端一行不用改，数据库里也没有任何一张表要改。
  操作符的**名字和顺序**在代码常量 `OPERATOR_DISPLAY` 里（15 个，三语）。
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
  fieldTable: crm_dc_portrait
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
          - [data_type + value_encoding, 'long + native_date']
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
          - [pageValue.ts, "age: { kind: 'years' }"]
          - [compile.ts, "birthday <= '2008-09-30'（用今天倒推 18 年，条件落在裸列上）"]
    - key: region
      ui:
        label: 地区 · region
        src: 'display_name_i18n.zh-CN = "地区"'
      field:
        rows:
          - [field_key, region]
          - [column_name, region]
          - [data_source_id, '1']
          - [data_type, string]
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
          - ['—', 不需要换算：列名直接用]
    - key: last_trade_days
      ui:
        label: 距上次成交天数
        src: 'display_name_i18n.zh-CN'
      field:
        rows:
          - [field_key, last_trade_days]
          - [column_name, last_trade_time]
          - [data_source_id, '1']
          - [data_type + value_encoding, 'long + native_date']
        hint: 换算规则和 age 同一张注册表
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
          - [pageValue.ts, "last_trade_days: { kind: 'days' }"]
          - [compile.ts, "last_trade_time <= '2026-03-14' 的反向窗口（同样下推到裸列）"]
```

```callout
tone: blue
icon: 🧱
text: |
  **前四层是数据，第五层是代码。**

  | 层 | 在哪 | Data Admin 改得动吗 |
  |---|---|---|
  | ① 界面文字 | 前端运行时拼的 | 改 ② 就跟着变 |
  | ② `crm_dc_portrait` | MySQL | ✅ 就是它的地盘 |
  | ③ `crm_dc_data_source` | MySQL | ✅ |
  | ④ Doris 表 | 真实存储 | ❌ 不是配置，是数据 |
  | ⑤ 换算规则 | **代码里**（`pageValue.ts` 的注册表） | ❌ ==管不到== |
```

### 4.1 那张表里的真实数据

`user_portraits_wide` 宽表一共 45 列。上面三个字段落在里面的样子：

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

==前三行是「算出来的」，第四行是「直接读的」。== 这就是换算注册表的差别。

### 4.2 换算规则住在哪：一张按字段名查的注册表

换算不在数据库里 —— 它在 `packages/dsl/src/pageValue.ts` 里**按字段名当键**：

```ts
const PAGE_CONVERT: Record<string, PageConvert> = {
  age:                    { kind: 'years' },
  register_days:          { kind: 'days' },
  last_deposit_days:      { kind: 'days' },
  last_trade_days:        { kind: 'days' },
  last_touch_days:        { kind: 'days' },
  last_call_days:         { kind: 'days' },
  last_meet_days:         { kind: 'days' },
  'holding.market_value': { kind: 'scale', factor: 10000 },
};
```

三种换算：`years`（和今天比年数）、`days`（和今天比天数）、`scale`（差一个倍率）。

编译时它把「页面上填的数」换算到**物理列上的窗口**：`age >= 18` 编成 `birthday <= '2008-09-30'`，
而不是拿 18 去和日期比，也不是在 SQL 里写 `TIMESTAMPDIFF` 现算。
==条件落在裸列上，Doris 的分区裁剪和索引才用得上。==

走 `days` 的字段有 6 个（全部「距上次 X 天数」），走 `years` 的只有 `age` 一个。

````callout
tone: red
icon: ⚠
text: |
  ==**坑：改 `field_key` 会静默改单位。**==

  唯一区分「年」和「天」的东西，还是那个字符串键。

  如果有人在 Data Admin 里把 `age` 改成 `age_years`（听起来更清楚），
  注册表查不到它，编译器会把它当成**没有换算规则**的字段：

  ```sql
  -- 改之前
  u.birthday <= '2008-09-30'                            -- 出生满 18 年
  -- 改之后：拿 18 直接和日期比，或者类型校验当场报错
  ```

  **要么报错，要么人数整个不对 —— 取决于值类型校验先拦住还是先放行。**

  和上一版相比有个进展：物理类型（`physical_type`）已经进了元数据，
  代码里那份「列名 → 类型」的手抄兜底表删掉了。剩下的硬编码只有这一张换算注册表，
  它有夹具测试看住（每条换算路径的 SQL 形状都在 fixtures 里锁着）。
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
// ✅ 真实的（组件里）
<el-option
  v-for="f in metadata.features"   ← 循环，没有字段名
  :key="f.key"
  :label="f.name['zh-CN']"         ← 文字从数据来
/>
```

**`metadata.features` 就是 Data Admin 写进去的那 39 条启用的画像字段。**

```compare
first: 你以为
head: [前端负责, 实际是]
rows:
  - 有哪些字段: [前端写死的清单, 后端从 MySQL 读出来的]
  - 字段叫什么: [前端写死的中文, 存在 `display_name_i18n` 里，三语]
  - 能用哪些操作符: [前端按字段写 if/else, 按 `variable_type`/`data_type`/`content_type` 现算]
  - 下拉选项是什么: [前端写死的数组, 存在 `enum_content`（字段自带）或 `value_set`（共享）里]
  - 加一个字段: [{ text: 改前端代码 + 发版, tone: red }, { text: 数据库加一行, tone: green }]
```

==前端是个「哑渲染器」。它不认识「年龄」，只认识「配置里有 N 个字段」。==

这就是为什么改数据库能改界面 —— **界面本来就是照着数据库画的。**

```callout
tone: blue
icon: 🔢
text: |
  **那 45 行记录具体是什么？**

  上一版它们挤在一张 `crm_dc_data_field` 里，用 `field_type` 列区分；
  这一版拆成了三张表，行数是数出来的：

  | 表 | 行数 | 去哪了 |
  |---|---|---|
  | `crm_dc_portrait` | **40**（39 启用 + 1 停用的 `open_city`） | 字段下拉里的 39 个选项 |
  | `crm_dc_relation` | **2** | 关系下拉（持仓 / 产品） |
  | `crm_dc_relation_attr` | **3** | 选了关系之后才能选（market / qty / status） |

  所以 `metadata.features` 是 **39**，不是 45。
  ==把「行数」当成「选项数」是这个 demo 里最容易报错的数字。==
```

---

## 06 · 中间那层：6 张表怎么拼成一份投影

上一节说「前端是个哑渲染器，只认 `metadata.features`」。

**但 MySQL 里没有叫 `features` 的东西。** 数据库里是 6 张分开的表，
每张一个形状。那份投影是**后端现拼的**。

这一节就把中间那段接上 —— ==**拉取 → 转换 → 一份前端直接能用的 JSON**==。

```seq
title: 投影的一生 —— 什么时候拉的、谁在消费
participants:
  - { id: be, label: 后端进程, sub: "8787" }
  - { id: my, label: "MySQL crm_dc", sub: "配置 · 57 行" }
  - { id: fe, label: 浏览器, sub: 圈选页 }
messages:
  - { from: be, to: be, label: "createApp() 先 getCatalog() 验证一遍", kind: self, note: ① 随进程启动 }
  - { from: be, to: my, label: "6 条 SELECT（唯一读库处）", kind: sync, note: ② 缓存过期才读 }
  - { from: my, to: be, label: "57 行（3+7+2+40+2+3）", kind: reply }
  - { from: be, to: be, label: "缓存 5 秒", kind: self, note: ③ 过期前不再碰 MySQL }
  - { from: fe, to: be, label: "GET /api/audience/metadata", kind: sync, note: ④ 页面加载时拉一次 }
  - { from: be, to: be, label: "toAudienceMetadata(缓存的行)", kind: self, note: ⑤ 每次都重跑 }
  - { from: be, to: fe, label: "AudienceMetadata JSON", kind: reply }
  - { from: fe, to: fe, label: "v-for 渲染下拉", kind: self, note: ⑥ 之后不再拉 }
gap: 0
segments:
  - { from: 1, to: 3, label: 进程启动 + 每 5 秒一次 }
  - { from: 4, to: 8, label: 之后每次打开页面 }
```

````callout
tone: green
icon: ✅
text: |
  ==**缓存改过了，两处反直觉还剩一处：**==

  **① MySQL 每 5 秒最多读一次。** `source.ts` 的缓存带 TTL：

  ```ts
  const CACHE_TTL_MS = 5_000;
  export async function getMetadataRows() {
    if (cached && Date.now() < expiresAt) return cached;   // 5 秒内直接用
    …                                                      // 过期了就重读，还带并发去重
  }
  ```

  上一版「改完配置必须重启后端」的坑已经不在了 —— ==改完 MySQL，最多 5 秒生效==。

  **② 但投影函数每次请求都重跑。** `getCatalog()` 每次都重新 `rowsToCatalog()`，
  `toAudienceMetadata()` 同样。缓存的是「读出来的行」，不是「拼好的 JSON」——
  因为投影是纯函数，缓存结果反而要按 locale 分桶。
````

```lane-stack
- badge: "01 · MySQL"
  title: 6 张表
  desc: 原始行，按表分开
  tone: violet
  nodes:
    - { title: crm_dc_portrait, sub: "40 行 · 特征字典" }
    - { title: crm_dc_relation, sub: "2 行 · 关系（客体长在本行）" }
    - { title: crm_dc_relation_attr, sub: "3 行 · 关系属性" }
    - { title: crm_dc_data_source, sub: "3 行 · 逻辑源 → 物理表" }
    - { title: crm_dc_value_set, sub: "2 行 · 共享值集" }
    - { title: crm_dc_business_domain, sub: "7 行 · 业务域" }
  next: "load.ts :: 6 条 SELECT + 行转对象 :: snake_case 变 camelCase"

- badge: "02 · 拉"
  title: MetadataRows
  desc: 形状**没变** —— 还是按表分的 6 个数组
  tone: blue
  nodes:
    - { title: "sources[]", sub: "3 个对象" }
    - { title: "portraits[]", sub: "40 个" }
    - { title: "relations[]", sub: "2 个，各带 object" }
    - { title: "attrs[]", sub: "3 个" }
    - { title: "valueSets[]", sub: "2 个" }
    - { title: "domains[]", sub: "7 个" }
  next: "project.ts / audience.ts :: 两条投影 :: 就是这一层"

- badge: "03 · 转"
  title: 两条投影
  desc: 同一批行，两种形状
  tone: amber
  nodes:
    - { title: AudienceMetadata, sub: "给前端：全量带 status，去掉表名列名" }
    - { title: Catalog, sub: "给编译器：只留 ENABLED，补上表名列名" }
  next: "拼成各自要的形状"

- badge: "04 · 结果"
  title: 前端拿到的东西
  desc: 直接就用这个
  tone: green
  nodes:
    - { title: "features[39]", sub: "{ key, name, variableType, dataType, contentType, valueSource }" }
    - { title: "relations[2]", sub: "带 object 和 properties[]" }
  next: "HTTP :: GET /api/audience/metadata :: 一次请求拿全量"

- badge: "05 · 界面"
  title: 下拉选项
  desc: v-for 一遍就完事
  tone: muted
  nodes:
    - { title: 年龄 · age, sub: "来自 features 里 age 的 name" }
    - { title: 地区 · region, sub: "来自 features 里 region 的 name" }
```

```callout
tone: blue
icon: 🧭
text: |
  **整条链只有两段代码：**

  | 文件 | 行数 | 干什么 |
  |---|---|---|
  | `metadata/load.ts` | 254 | 6 条 `SELECT` + 行转对象（`snake_case` → `camelCase`） |
  | `metadata/project.ts` | 435 | `rowsToCatalog()` + 44 处校验 |
  | `metadata/audience.ts` | 222 | `toAudienceMetadata()` —— 前端那一份 |

  ==注意 02 和 03 之间：**形状没变，只是换了名字**。==
  `load.ts` 干的是体力活（搬运 + 改命名），`project.ts` 才真正在**拼和拦**。
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
      code: "name:   field.fieldKey\ncolumn: field.columnName   // NOT NULL，没有就不合法"
    - title: ② 联表
      from: [data_source_id]
      out: [table]
      note: "**这是唯一一次跨表**。`data_source_id` 去 `crm_dc_data_source` 里查，拿到 `table_name`。"
      code: "const source = requireSource(sources, field);\n// sources 是个 Map<id, DataSourceRow>\ntable: source.tableName"
    - title: ③ i18n 取值
      from: [display_name_i18n]
      out: [label]
      note: "三语文案里挑出当前 locale 那一份。挑不到就退回 `field_key` —— 所以界面上永远不会出现空白选项。"
      code: "labelOf(field.displayNameI18n, field.fieldKey, 'zh-CN')"
    - title: ④ 类型五列
      from: [variable_type, data_type, content_type, value_encoding]
      out: [variableType, dataType, contentType, valueEncoding]
      note: "上一版的 `semantic_type` 一个数拆成了四列：范围还是候选（enum/range）、基础类型（long/double/string/boolean）、业务分类（0 普通 ~ 10 推广位）、日期在列上怎么存。"
      code: "variableType: field.variableType\ndataType: field.dataType\ncontentType: field.contentType\nvalueEncoding: field.valueEncoding"
    - title: ⑤ 操作符现算
      from: [variable_type, data_type, content_type]
      out: [ops]
      note: "**上一版去查 `crm_dc_operator` 表，这一版按形状算**。枚举 6 个、布尔 3 个、数值 9 个；日期/时间再追加相对时间那 2~4 个。界面上那个操作符下拉的选项就是它。"
      code: "ops: applicableOps(field)   // fieldType.ts，无表可查"
    - title: ⑥ 解析候选值
      from: [enum_type, enum_content, value_set_id, value_resolver_key]
      out: [options]
      note: "四种来源互斥：`none` 没有候选；`custom` 内嵌在自己行的 `enum_content`；`value_set` **去 `crm_dc_value_set` 按 id 取**；`dynamic` 远端搜（解析器也在代码里）。取到的按 locale 翻译、排序、带状态。"
      code: "itemsOf(field)\n// enum_type === 'value_set' 时去 valueSets.get(field.valueSetId)\n// 四种取值互斥，配错在 assertMetadataRows 炸"
  tabs:
    - key: age
      srcLabel: MySQL · crm_dc_portrait 的 age 那一行
      outLabel: Catalog · fields[age]
      src:
        - [field_key, age]
        - [column_name, birthday]
        - [display_name_i18n, '{"zh-CN":"年龄", "en":"Age"}']
        - [data_source_id, '1']
        - [variable_type / data_type, 'range / long']
        - [content_type, '0（普通）']
        - [value_encoding, native_date]
        - [physical_type, DATE]
        - [enum_type, none]
      out:
        - [name, '"age"']
        - [label, '"年龄"']
        - [table, '"user_portraits_wide"']
        - [column, '"birthday"']
        - [dataType, '"long"']
        - [ops, '[eq, neq, lt, lte, gt, gte, between, is_null, is_not_null]']
    - key: region
      srcLabel: MySQL · region 那一行 —— 候选内嵌在自己身上
      outLabel: Catalog · fields[region]
      src:
        - [field_key, region]
        - [column_name, region]
        - [variable_type / data_type, 'enum / string']
        - [enum_type, custom]
        - [enum_content, '{"US": {…}, "HK": {…}, …}（数组）']
      out:
        - [name, '"region"']
        - [label, '"地区"']
        - [table, '"user_portraits_wide"']
        - [column, '"region"']
        - [dataType, '"string"']
        - [ops, '[eq, neq, in, not_in, is_null, is_not_null]']
        - [options, '[{value:"US",label:"美国"}, …]']
    - key: city
      srcLabel: MySQL · city 那一行 —— 候选在另一张表里
      outLabel: Catalog · fields[city]
      src:
        - [field_key, city]
        - [column_name, city]
        - [variable_type / data_type, 'enum / string']
        - [content_type, '7（城市）']
        - [enum_type, value_set]
        - [value_set_id, '32  →  crm_dc_value_set']
      out:
        - [name, '"city"']
        - [label, '"常驻城市"']
        - [table, '"user_portraits_wide"']
        - [column, '"city"']
        - [dataType, '"string"']
        - [ops, '[eq, neq, in, not_in, is_null, is_not_null]']
        - [options, '10 个城市 · 从值集 #32 取的']
    - key: hold_semiconductor
      srcLabel: MySQL · hold_semiconductor 那一行 —— 布尔
      outLabel: Catalog · fields[hold_semiconductor]
      src:
        - [field_key, hold_semiconductor]
        - [column_name, hold_semiconductor]
        - [variable_type / data_type, 'range / boolean']
        - [enum_type, none]
      out:
        - [name, '"hold_semiconductor"']
        - [label, '"持仓半导体(画像标记)"']
        - [table, '"user_portraits_wide"']
        - [column, '"hold_semiconductor"']
        - [dataType, '"boolean"']
        - [ops, '[eq, is_null, is_not_null]  ← 只有 3 个']
    - key: last_trade_days
      srcLabel: MySQL · last_trade_days 那一行 —— 和 age 同一张注册表
      outLabel: Catalog · fields[last_trade_days]
      src:
        - [field_key, last_trade_days]
        - [column_name, last_trade_time]
        - [variable_type / data_type, 'range / long']
        - [content_type, '0（普通）']
        - [value_encoding, native_date]
        - [enum_type, none]
      out:
        - [name, '"last_trade_days"']
        - [label, '"距上次成交天数"']
        - [table, '"user_portraits_wide"']
        - [column, '"last_trade_time"']
        - [dataType, '"long"']
        - [ops, '[eq, neq, lt, lte, gt, gte, between, is_null, is_not_null]']
```

```callout
tone: green
icon: ✅
text: |
  **上面那 5 个标签，每一个都在演示 6 条规则里的一条。**

  | 标签 | 它特别在哪 |
  |---|---|
  | `age` | ④⑤ 的典型：range · long，9 个操作符；换算规则在代码注册表里 |
  | `region` | ⑥ 的第一种来源：候选**内嵌在自己身上**（`custom` + `enum_content`） |
  | `city` | ⑥ 的第二种来源：候选**在 `crm_dc_value_set` 里**（`value_set`），要跨表取 |
  | `hold_semiconductor` | ⑤ 最明显的反差：布尔字段只有 **3 个**操作符 |
  | `last_trade_days` | 和 `age` 共用同一张换算注册表，只是换成按天 |

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
  MySQL 的列                          Catalog 的字段
  ────────────────────────────       ────────────────────
  field_key                      →   name
  column_name                    →   column
  data_source_id  ──联表──→          table
  display_name_i18n              →   label
  variable_type / data_type ┐
  content_type / encoding   ┴─类型──→    四个类型列 + applicableOps → ops
  enum_type ┐
  enum_content / value_set_id ┴─候选──→   options
  ```
````

### 6.2 它还是个校验器 —— 而且比上一版严得多

`project.ts` 里散着 **44 处 `throw`** —— 都是「配置写错了」的检查点，分四组：

```compare
first: 组
head: [拦什么, 报什么错（真实消息）]
rows:
  - 引用关系: ["数据源/业务域/值集合不存在，域成环，特征或关系没有归属", "`missing value set for city`、`business domain … parent is missing`"]
  - 重名: ["特征、关系、属性各自的重名", "`duplicate portrait age`、`duplicate relation attr holding.market`"]
  - 候选值来源: ["`enum_type` 四选一没配对 —— 内嵌/值集/动态混着填", "`custom candidate source requires only enum_content`"]
  - 类型约束: ["`content_type` 超出 0~10、日期列不是 long、金额不是数值、候选值类型和 data_type 不一致", "`date or time must be long`"]
```

上一版只有 8 处 throw。多出来的三十几处，大部分是**候选值来源四选一**带来的：
`enum_type` 是这一版的新列，它要求 `enum_content` / `value_set_id` / `value_resolver_key`
三个列「该填的填、不该填的空」，每种取值都有自己的一条互斥校验。

```callout
tone: green
icon: ✅
text: |
  **为什么在这里报错，而不是等到查数据的时候？**

  因为 `Catalog` / `AudienceMetadata` 是**前端信任的形状**。

  ==一旦它拼出来了，后面所有环节都假定它是对的：==
  前端直接拿 `label` 渲染、拿 `ops` 填下拉、拿 `table` + `column` 去编 SQL。

  一个坏的 `column_name` 会一路走到 Doris 才炸，那时候的报错是
  「列不存在」—— **你根本不知道是元数据写错了。**

  所以这一层把错误**提前**：后端启动会先 `getCatalog()`，
  而且每次缓存重读都会跑一遍 `assertMetadataRows` —— 配错了当场炸，不等到运营点「查询」。
```

### 6.3 那缓存呢

````callout
tone: green
icon: ✅
text: |
  缓存带 5 秒 TTL，还带并发去重：

  ```ts
  // metadata/source.ts
  const CACHE_TTL_MS = 5_000;
  let cached: MetadataRows | null = null;
  let inflight: Promise<MetadataRows> | null = null;

  export async function getMetadataRows() {
    if (cached && Date.now() < expiresAt) return cached;  // 5 秒内直接用
    if (inflight) return inflight;                        // 别人正在读，搭车
    …                                                     // 否则真读一次，写回缓存
  }
  ```

  ==改了元数据，最多 5 秒后生效，不用重启后端。==

  上一版「`resetCatalogCache` 是死代码、必须重启」的那个坑已经修掉了 ——
  TTL 之外还留了 `resetCatalogCache()` 手动失效的口子，供测试用。
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
      UPDATE crm_dc_portrait SET status = 0 WHERE field_key = 'city';
      ```

      界面上下拉框里就没它了（5 秒内）。**不用删代码，不用发版。**
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
      ==39 个字段名、15 个操作符名、值集里的城市名，全部跟着换。==
````

````callout
tone: amber
icon: ⚠
text: |
  **但这层「解耦」还剩一处没做完。**

  宽表（"全集"）本身还是硬编码的：

  ```ts
  // apps/server/src/metadata/config.ts
  export const UNIVERSE_TABLE = 'user_portraits_wide';   // ← 写死的
  ```

  `crm_dc_data_source` 管的是关系数据源和画像字段的落表，
  「圈选的全集是哪张表」这一个问题没有进元数据 —— 它是编译上下文的一部分。
  上一版代码里的「列名 → 物理类型」手抄兜底表已经删了（`physical_type` 进了元数据）。
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
  - Node DSL: [{ text: 独立服务，校验 + 编 SQL, tone: green }, { text: 在 packages/dsl + apps/server 里, tone: amber }]
  - Data Admin: [{ text: "独立服务，**元数据的写入口**", tone: green }, { text: 只有 apps/seed 脚本, tone: red }]
  - DAL: [{ text: 独立服务，唯一数据面, tone: green }, { text: 在 apps/server 里, tone: amber }]
  - 元数据写接口: [{ text: CRUD, tone: green }, { text: "**没有** —— /api/audience/*、/api/meta/* 全是 GET", tone: red }]
```

**demo 里谁扮演 Data Admin？**

```
apps/seed/src/            ← catalog.ts 把字段/关系/属性/值集/业务域装成行
                          ← seed.ts 灌进 MySQL 六张表
metadata/seed-presets.mjs ← 预设两张表：6 个类目 30 张卡片
```

一个把全部元数据**写在代码里**、由 `pnpm metadata:seed` 灌进库的脚本。

所以「加一个字段」这件事，两条路差别巨大：

```flow
grid: true
legend: true
nodes:
  - { id: n1, label: "① 改 seed 脚本", sub: "40 行特征里插一条", row: 0, tone: amber }
  - { id: g1, label: "① 点几下表单", sub: "在 Data Admin 里", row: 0, tone: green }
  - { id: n2, label: "② 重跑脚本", sub: metadata:seed, row: 1, tone: amber }
  - { id: g2, label: "② MySQL 多一行", sub: INSERT, row: 1, tone: green }
  - { id: n3, label: "③ 等缓存过期", sub: "最多 5 秒", row: 2, tone: muted }
  - { id: g3, label: "③ 不需要", sub: "这一步没了", row: 2, tone: muted, shape: note }
  - { id: end, label: 界面多一项, sub: "前端从头到尾没动过", row: 3, tone: violet }
edges:
  - { from: n1, to: n2 }
  - { from: n2, to: n3, anim: true }
  - { from: n3, to: end }
  - { from: g1, to: g2 }
  - { from: g2, to: g3, dashed: true }
  - { from: g3, to: end, dashed: true, anim: true }
```

两条路（**黄=改代码，绿=改数据**）在底部**汇合到同一个节点**。

黄色那条中间还有一个「③ 等缓存过期」—— 最多 5 秒；
绿色那条连这一步都没有。
==终点一模一样**：「界面多一项，前端从头到尾没动过」。==

==差别只在「谁来搬这一步」—— 开发改代码，还是运营点按钮。== 这就是 Data Admin 存在的全部意义。

---

## 09 · 一个曾经的坑，和它现在补上的那环

我在做上面那个实验时撞到过：改完 MySQL，**接口仍然返回旧值**，必须重启后端。
当时的结论是「缓存永不刷新是目标架构的真缺口」。

这个缺口已经补上了：

```compare
first: 项
head: [当时, 现在]
rows:
  - 缓存: ["进程内永久缓存，`resetCatalogCache()` 没有任何调用点", { text: "5 秒 TTL + 并发去重（inflight 搭车）", tone: green }]
  - 生效方式: ["重启后端 / touch 触发 tsx watch", { text: "最多 5 秒", tone: green }]
  - 预览一致性: ["没有 —— 改配置后，旧预览和新配置可能混着", { text: "预览带 `previewId`，绑定当时的查询 + 元数据哈希 + 时钟；任一变了就要求重新查询", tone: green }]
```

第三行是这一版新加的：`GET /api/audience/metadata` 的返回里带一个 `revision` 哈希，
预览接口把「这次预览是按哪份元数据算的」记下来 —— 配置变了，旧预览上下文直接作废，
而不是拿新字典去解释旧条件。

```summary
title: 三句话总结
text: |
  **Data Admin 是配置台，圈选页是使用台。** 前者写，后者读，中间隔着 MySQL 和一次 HTTP。

  **界面上每个字都来自数据库** —— 前端代码里只有循环，没有字段名。所以改数据就能改界面，
  而且现在 ==最多 5 秒生效==。

  ==这个 demo 没有 Data Admin==，只有 `apps/seed` 一个脚本替身。
  加字段 = 改代码 + 重跑 + 等缓存过期。
```

```quiz
- q: "运营说「把『年龄』改叫『年龄区间』」。你要改哪里？"
  a: |
    改 `crm_dc_portrait` 里 `field_key='age'` 那行的
    `display_name_i18n.zh-CN`。**前端一行都不用动。**

    改完最多 5 秒生效（元数据缓存 TTL）。这应该通过 Data Admin 来做，不是手敲 SQL ——
    demo 里它的替身是 `apps/seed` 脚本。

- q: "为什么「年龄」筛 ≥18，生成的 SQL 却是 `birthday <= '2008-09-30'`？"
  a: |
    因为元数据里 `field_key = 'age'` 那行的 `column_name` 是 **`birthday`**，
    而换算规则在代码注册表（`pageValue.ts`）里：`age: { kind: 'years' }`。

    数据库里**根本没有 age 这个列**。编译器把「18 岁」换算成「今天减 18 年」的日期上界，
    条件落在裸列 `birthday` 上 —— Doris 才能做分区裁剪和索引。
    人数是现算的：它不会过期，口径也只有一处。

- q: "圈选页上「大于等于」这个操作符，是前端写死的吗？"
  a: |
    不是。它是按字段的形状现算的：`applicableOps(variable_type, data_type, content_type)`。

    数值字段 9 个（含 `between`），枚举/字符串 6 个，布尔只有 3 个；
    `content_type` 是日期或时间时再追加相对时间操作符。
    把某个字段的 `data_type` 改掉，它的操作符下拉会**自动换一整套** ——
    数据库和前端都不用改。
```
