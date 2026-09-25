# sql_builder_v2 代码地图

```callout
tone: blue
icon: 🧭
text: |
  这篇是**速查表**，不是讲解。想知道「机制怎么实现的」看
  [sql_builder_v2 架构](../sql-builder-v2-architecture/)；
  想知道「哪个文件管什么」就是这篇。
```

```cards
cols: 3
items:
  - { title: 仓库形状, desc: 三个包、每个包一样的骨架、哪些是产物不能改, tag: "01 ~ 02", tone: green }
  - { title: 逐个文件, desc: core / crowd / goods 三个包的 src 里每个文件干什么, tag: "03 ~ 05", tone: blue }
  - { title: 速查, desc: 「我想改 X 该去哪个文件」+ 推荐的看代码顺序, tag: "06 ~ 07", tone: violet }
```

## 01 · 这个仓库是什么形状

### 先搞清三个词

| 词 | 在这里是什么意思 |
|---|---|
| **workspace** | 一个仓库里装多个 npm 包。由 `pnpm-workspace.yaml` 声明 `packages/*` |
| **package** | 一个可独立发布的 npm 包，有自己的 `package.json` / 入口 / 依赖 |
| **catalog** | pnpm 的版本统一机制。`pnpm-workspace.yaml` 里写一次版本号，各包用 `catalog:` 引用 |

所以 `packages/core` 不是「一个目录」，是 ==一个能单独 `npm publish` 的包==。

### 三个包

```text
sql_builder_v2/
├─ packages/
│  ├─ core/       @futu/sql-builder-core    与数据库无关的通用 SQL 构造
│  ├─ crowd/      @futu/sql-builder-crowd   用户域圈人语义
│  └─ goods/      @futu/sql-builder-goods   商品域（另一条线）
├─ types/         ⚠️ 构建产物，不是源码
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ package.json
```

```callout
tone: amber
icon: ⚠
text: |
  **根目录的 `types/` 是构建产物，不是源码。**

  `tsconfig.base.json` 里写着 `"declarationDir": "./types"` —— 它是 TypeScript 编译出来的
  `.d.ts` 类型声明，内容全是 `export declare`。**改它没用，下次构建会被覆盖。**
  真正的源码在 `packages/*/src/`。
```

### 每个包的骨架都一样

```text
packages/<包名>/
├─ src/                ← 源码。你只改这里
├─ test/               ← 测试
├─ typings/            ← 给第三方库补类型声明（这里只补 knex）
├─ package.json        ← 包名 / 入口 / 依赖 / 脚本
├─ tsconfig.json       ← 开发用（noEmit）
└─ tsconfig.prod.json  ← 构建用
```

构建后多出两个目录（已 gitignore，不用管）：

| 目录 | 内容 | 谁在用 |
|---|---|---|
| `lib/` | 编译后的 `.js` | Node 运行时，`package.json` 的 `main` 指向它 |
| `types/` | 编译后的 `.d.ts` | TypeScript 使用者，`package.json` 的 `types` 指向它 |

```callout
tone: violet
icon: 💡
text: |
  **注意 `typings/` 和 `types/` 是两个不同的东西**，只差一个字母：

  - `typings/`（源码，要提交）—— 手写的类型补丁
  - `types/`（产物，不提交）—— 编译生成的声明

  这里 `typings/knex.d.ts` 补的是 `DB.rawQuery()` —— 因为 core 往 knex 的原型上挂了
  自定义方法，TypeScript 不认识，得手工补一条声明。
```

## 02 · 先搞清几个词

这篇笔记会反复用到下面这些词。**每个词都配一个真实例子** ——
看不懂定义就看例子，例子比定义清楚。

### 圈人用的原料

```cards
cols: 2
items:
  - title: uid
    tag: 最基础
    tone: muted
    desc: 用户的唯一标识。一串代表「一个人」的编号，系统里到处用它串数据。**存储时是加密的**
    code: |
      1001
  - title: 画像 portrait
    tag: 会被覆盖
    tone: green
    desc: 用户的**静态属性**。存在 `user_portrait` 表，一行 = 一个人。只存当前值，改了就覆盖
    code: |
      uid  | city | vip_level | 开户时间
      1001 | 杭州 | 3         | 2020-01-01
      1002 | 深圳 | 5         | 2021-06-15
  - title: 事件 event
    tag: 只追加
    tone: violet
    desc: 用户的**行为流水**。只追加不覆盖，所以能回答「**做了几次**」
    code: |
      $user_id | event_type | event_time | 商品
      1001     | 加购       | 10:03:12   | A001
      1001     | 加购       | 15:20:41   | B007
      1001     | 下单       | 15:31:08   | B007
  - title: 人群包 crowd
    tag: 可复用
    tone: blue
    desc: 预先算好存下来的一批人。给个编号 + 版本，下次直接复用
    code: |
      crowd_id | crowd_version | uid
      C_888    | v3            | 1001
      C_888    | v3            | 1002
```

### 怎么表达「要哪些人」

```cards
cols: 2
items:
  - title: 条件 condition
    tag: 叶子节点
    tone: green
    desc: 一个判断，比如「城市是杭州」。**这就是最小的条件单元**
    code: |
      { op: 'IN', name: 'city', value: ['杭州'] }
  - title: 条件树
    tag: 整体结构
    tone: violet
    desc: 用 `AND` / `OR` 把条件串起来的树，**可以无限嵌套**
    code: |
      { logic: 'AND', items: [
          { op: 'IN',  name: 'city',      value: ['杭州'] },
          { logic: 'OR', items: [
              { op: 'Gte', name: 'vip_level', value: 3 },
              { op: 'Eq',  name: 'channel',   value: 'APP' }
          ]}
      ]}
```

### 同一棵树，两套写法

**这是全篇最容易懵的地方**：业务侧和 core 用**两套词汇**描述同一件事。

```compare
first: 同一个条件
head: [业务条件（crowd 的输入）, "Rule[]（core 的输入）"]
rows:
  - 属性名: ["`name`", "`column`"]
  - 例子: ["`{ op: 'IN', name: 'city', value: ['杭州'] }`", "`{ op: 'IN', column: 'city', value: ['杭州'] }`"]
  - 时间条件: ["用 `dateType` 描述，如「最近 3 天」", "**展开成多个条件**，见边 ①"]
  - 逻辑组合: ["`logic` + `items`", "`logic` + `items`（**一样**）"]
```

```cards
cols: 2
items:
  - title: 业务条件
    tag: crowd 的输入
    tone: amber
    desc: "**业务侧写的**条件树。用业务词汇：属性叫 `name`，时间用 `dateType` 描述"
    code: |
      { logic: 'AND', items: [
          { op: 'IN', name: 'city', value: ['杭州'] }
      ]}
  - title: "Rule[]"
    tag: core 的输入
    tone: blue
    desc: "**表达式模型**。core 只认这个。用 SQL 词汇：属性叫 `column`。叫 `Rule[]` 是因为**它是个数组**"
    code: |
      [
        { logic: 'AND', items: [
            { op: 'IN', column: 'city', value: ['杭州'] }
        ]}
      ]
```

```callout
tone: violet
icon: 💡
text: |
  看出来了吗？==两套写法长得几乎一样，只有属性名不同（`name` → `column`）。==

  这不是巧合：**它们用的是同一个树形结构**，只是词汇表不同。
  所以翻译起来很轻 —— 大部分节点直接透传，只有业务独有的词汇需要改写。
```

### 中间的三样东西

```cards
cols: 2
items:
  - title: adapter
    tag: 翻译器
    tone: amber
    desc: 把**业务条件**翻译成 **Rule[]** 的那个函数。它在 `crowd` 包里，**不在 core**
    code: |
      输入: { op: 'IN', name: 'city', ... }
      输出: { op: 'IN', column: 'city', ... }
  - title: entrepot
    tag: 六种
    tone: violet
    desc: 「条件入口」。**六种条件各有一个实现**，每种知道自己查哪张表
    code: |
      portrait  → user_portrait 表
      event     → event_v2 表
      crowd     → crowds 表
      uid       → 不查表，直接给
      relation  → 业务明细表
      rawSql    → 透传
  - title: 表达式模型
    tag: 纯数据
    tone: blue
    desc: core 内部的数据结构。**只有字段，没有方法** —— 它不是对象，是数据
    code: |
      Expression 的四种形态之一：
      { op: 'IN', column: 'city', value: ['杭州'] }
  - title: 方言 dialect
    tag: 策略
    tone: red
    desc: 同一个语义在不同数据库怎么写。core 定义接口，两个实现
    code: |
      map 取值：
        ByteHouse → mapElement(`name`, 'a')
        Doris     → ELEMENT_AT(`name`, 'a')
```

### 最后两个

```cards
cols: 2
items:
  - title: ByteHouse / Doris
    tag: 两个数据库
    tone: cloud
    desc: 这套代码要同时在两个数据库上跑。**同名函数写法不同**，这就是「方言」存在的原因
    code: |
      ByteHouse: 事件表按 murmurhash 分 8 张
      Doris:     事件表由调用方传入
  - title: SqlContext
    tag: 唯一入口
    tone: green
    desc: 调用方接触到的**唯一入口**。选方言、构造模块，之后一路传下去
    code: |
      SqlContext.create(DbType.Doris, { eventTableMap })
```

```callout
tone: amber
icon: ⚠
text: |
  **`crowd` 这个词有两个意思，很容易混：**

  - `packages/crowd` —— **包名**，指整个用户域业务包
  - `Entrepots.Crowd` —— **一种条件类型**，指上面那个「人群包」

  看到 `crowd` 先看上下文：说包的时候是前者，说条件类型的时候是后者。
```

```callout
tone: violet
icon: 💡
text: |
  **一句话把上面所有词串起来：**

  运营想圈一批人 → 写下一棵**条件树**（用**画像**、**事件**、**人群包**这些条件）
  → `crowd` 包用 **adapter** 把它翻译成 **Rule[]**
  → `core` 把 **Rule[]** 翻译成 **SQL**（中途遇到 **ByteHouse** / **Doris** 的差异就调**方言**）
```

---

## 03 · 三个包分别管什么

```compare
first: 维度
head: ["packages/core", "packages/crowd", "packages/goods"]
rows:
  - 定位: [通用 SQL 构造, 用户域圈人, 商品域圈选]
  - 知道业务吗: [{ text: 完全不知道, tone: green }, 知道，大量业务枚举, 知道商品域概念]
  - 依赖谁: ["knex", "core + lodash + murmurhash + mysql2", "core + type-fest"]
  - 测试框架: [jest, jest, { text: vitest, tone: violet }]
  - 成熟度: [{ text: 稳定, tone: green }, { text: 主力，代码最多, tone: blue }, { text: 独立演进中, tone: amber }]
```

==crowd 是这个仓库的主体==（约 4000 行），core 是它的地基，goods 是另一条平行的线。

### 逐个拆解

上面「依赖谁」一栏里全是名字。下面把每个按 **输入 / 处理 / 输出 / 怎么调用 / 为什么这么设计 / 业务价值** 拆开。

```callout
tone: amber
icon: ⚠
text: |
  ==但只有 knex 值得这样拆。==

  另外五个在 `src/` 里只有 1~3 处调用（`mysql2` / `tslib` 甚至一处都没有），
  硬套六个维度就是凑字数。所以：knex 和 murmurhash 给完整拆解，
  lodash 给骨架，剩下三个合并成一张表。
```

### murmurhash —— 决定事件去哪个分片

```spec
title: murmurhash
subtitle: 哈希算法 · 全库只有 1 处调用
tone: blue
rows:
  - k: 输入
    v: "事件名（如 `ClickSimStockMatchedEvent`）和事件分类"
  - k: 处理
    code: |
      const num = (murmurhash.v3(eventName, 0) % 8) + 1;   // → 1..8

      switch (eventCategory) {
        case EventCategory.business:
          return `dws.event_biz_${num}`;
        case EventCategory.Develop:
        case EventCategory.Ftoa:
          return `dws.event_monitoring_${num}`;
      }
  - k: 输出
    v: "一个**表名**，如 `dws.event_biz_5`"
  - k: 为什么这么设计
    v: |
      ByteHouse 里事件量太大，一张表装不下，所以按事件名哈希**拆成 8 张**。

      用哈希而不是自增 ID，是因为 ==同一个事件名必须永远落在同一张表== ——
      否则历史数据会分散在多张表里，查询时得全部扫一遍。

      哈希函数固定（`v3`）且种子固定（`0`），保证可重现。
  - k: 业务价值
    v: |
      让「查某个事件」这个动作**只扫 1/8 的数据**。

      代价是：加新事件时表名不可预测，运维得用 `scripts/bh-event-table.mjs` 现算。
```

### lodash —— 只为了不改坏调用方的数据

```spec
title: lodash
subtitle: 通用工具库 · 全库只用了 cloneDeep 一个函数
tone: muted
rows:
  - k: 输入 / 输出
    v: 任意对象 → 一份**深拷贝**
  - k: 怎么调用
    code: |
      import { cloneDeep } from 'lodash';

      // entrepots/factory.ts · convertToPkgEntrepot
      const _entrepot = cloneDeep(entrepot);

      // modules/segmentation.ts
      const _info = cloneDeep(info);
  - k: 为什么这么设计
    v: |
      调用方传进来的条件对象**不能改** —— 改了会污染上游状态，而调用方可能还在用。
      但下游处理时又需要往对象上挂 `options` 等字段，所以先拷一份。

      这是一个**隐含契约**：==这个库保证不修改传入的参数。==
  - k: 业务价值
    v: 全库只有 2 处用到。为了一个函数引一个工具库，是取舍 —— 深拷贝自己写容易漏边界情况。
```

### 剩下三个：mysql2 / tslib / type-fest

```callout
tone: violet
icon: 💡
text: |
  这三个**在 `src/` 里都搜不到 import**。它们没有「输入处理输出」可言，
  因为根本不是主动依赖：
```

```compare
first: 依赖
head: [为什么在 deps 里, 它决定了什么]
rows:
  - mysql2: ["knex 用 `client: 'mysql'` 时的**底层驱动**，knex 自己把它列为可选依赖", "能不能连上库"]
  - tslib: ["`tsconfig.base.json` 里 `importHelpers: true`，**编译产物**会 `require('tslib')` 拿 `__spreadArray` 这类辅助函数", "编译后的 JS 能不能跑"]
  - type-fest: ["只用了 `ValueOf` 一个类型，而且全是 `import type` —— **编译后消失，不进运行时**", "仅类型层，不影响运行"]
```

```callout
tone: green
icon: ✅
text: |
  看依赖表时先分这两类：

  ==主动依赖决定代码怎么写，被动依赖只决定能不能跑起来。==

  主动的（knex / lodash / murmurhash）在 `src/` 里能搜到 import；
  被动的（mysql2 / tslib）搜不到，但删了就会挂。
```

### 版本写在哪儿：catalog

`crowd/package.json` 里写的是 `"knex": "catalog:"` 而不是具体版本号 ——
版本统一在 `pnpm-workspace.yaml` 的 `catalog:` 段里定义。

```text
# pnpm-workspace.yaml
catalog:
  knex: "^1.0.2"
  lodash: "^4.17.21"
  murmurhash: "^2.0.1"
  mysql2: "^2.3.3"
  tslib: "^2.3.1"
```

```callout
tone: amber
icon: ⚠
text: |
  ==但只有 `crowd` 用了 catalog，`core` 和 `goods` 写的是硬编码版本号：==

  - `core`: `"knex": "^1.0.2"`
  - `goods`: `"type-fest": "^4.41.0"`

  所以 catalog 在这个仓库里**并不是统一机制**，只在一个包上用。
  要改版本，别只改 `pnpm-workspace.yaml` —— 先看对应包的 `package.json` 是不是硬编码的。
```

## 04 · 背景：SQL 是怎么被拼出来的

理解这个项目之前，得先知道「SQL 从代码到字符串」这条路长什么样。
`core` 的地基是 `knex`，这一节从零讲它。

### 概念 ①：数据库只认「一段文本」

你在代码里写的东西，数据库一个都看不懂。**它只接受一段 SQL 文本。**

```flow
grid: true
legend: true
nodes:
  - { id: app, label: 你的代码, sub: "想查一批用户", row: 0, kind: frontend }
  - { id: str, label: 一段文本, sub: "SELECT uid FROM user_portrait WHERE ...", row: 1, tone: violet }
  - { id: db, label: 数据库, sub: "不认对象，不认函数，只认文本", row: 2, kind: database }
edges:
  - { from: app, to: str, label: 拼出来 }
  - { from: str, to: db, label: 发过去 }
```

所以「操作数据库」这件事，本质上就是 **把想干的事翻译成一段文本**。

### 概念 ②：但手写文本会出事

最直接的做法是拼字符串：

```js
const sql = "SELECT uid FROM user_portrait WHERE city = '" + city + "'";
```

问题在于：`city` 是外部传进来的。如果它的值是：

```text
杭州' OR '1'='1
```

拼出来的 SQL 就变成了 `WHERE city = '杭州' OR '1'='1'` —— **条件被改写了**。这就是 SQL 注入。

```flow
grid: true
groups:
  - { id: naive, label: "手写拼接这条路", tone: red }
  - { id: safe,  label: "构造器这条路", tone: green }
nodes:
  - { id: a, label: 手写拼接, sub: "值直接嵌进字符串", row: 0, tone: red, group: naive }
  - { id: b, label: 构造器, sub: "值单独放，不混进 SQL", row: 0, tone: green, group: safe }
  - { id: r1, label: 注入风险, sub: "值里带引号就出事", row: 1, tone: red, group: naive }
  - { id: r2, label: 自动转义, sub: "转义交给库", row: 1, tone: green, group: safe }
edges:
  - { from: a, to: r1, dashed: true }
  - { from: b, to: r2 }
```

==knex 就是「构造器」这一类东西：你用 JS 方法描述要干什么，它负责生成安全的 SQL。==

### 概念 ③：链式调用 = 每个方法都返回自己

knex 的用法长这样：

```js
DB.getInstance().select('uid').from('user_portrait').where(...)
```

为什么能一直点下去？因为**每个方法执行完，返回的还是这个对象本身**。

```flow
grid: true
nodes:
  - { id: o, label: 一个查询对象, sub: "像一张空白表单", row: 0, tone: violet }
  - { id: m1, label: ".select('uid')", sub: "填「要查哪些列」", row: 1, tone: blue }
  - { id: m2, label: ".from('...')", sub: "填「查哪张表」", row: 2, tone: blue }
  - { id: m3, label: ".where(...)", sub: "填「筛选条件」", row: 3, tone: blue }
edges:
  - { from: o, to: m1, label: 点第一个方法 }
  - { from: m1, to: m2, label: 返回同一个对象 }
  - { from: m2, to: m3, label: 返回同一个对象 }
```

==每一步返回的都是同一个对象，所以能无限点下去。这叫「链式调用」。==

### 概念 ④：链式调用**不生成 SQL**，只往对象上记东西

这是最反直觉的一点。上面那串调用跑完，**一条 SQL 都没有产生** ——
它只是把「要查哪些列、哪张表、什么条件」记在了那个对象上。

```flow
grid: true
groups:
  - { id: acc, label: "这一整段都只是在记东西 —— 一条 SQL 都没生成", tone: violet }
nodes:
  - { id: s0, label: 空对象, sub: "{}", row: 0, tone: muted, group: acc }
  - { id: s1, label: 记下列, sub: "{ columns: ['uid'] }", row: 1, tone: violet, group: acc }
  - { id: s2, label: 记下表, sub: "+ { table: 'user_portrait' }", row: 2, tone: violet, group: acc }
  - { id: s3, label: 记下条件, sub: "+ { where: [...] }", row: 3, tone: violet, group: acc }
  - { id: sql, label: 编译成 SQL, sub: "还没发生", row: 4, tone: amber }
edges:
  - { from: s0, to: s1, label: ".select('uid')" }
  - { from: s1, to: s2, label: ".from(...)" }
  - { from: s2, to: s3, label: ".where(...)" }
  - { from: s3, to: sql, label: "要主动触发", dashed: true }
```

**自己点一下试试** —— 看状态怎么攒起来、什么时候才真的生成 SQL：

```demo
widget: knex-chain
title: 链式调用到底在干什么
hint: 攒状态中
actions: false
html: |
  <div class="kc">
    <div class="kc-btns">
      <button data-kc-step="select">.select('uid')</button>
      <button data-kc-step="from">.from('user_portrait')</button>
      <button data-kc-step="where">.where('uid', 'in', [1, 2, 3])</button>
      <button data-kc-step="raw" class="kc-final">.rawQuery()</button>
    </div>
    <div class="kc-panes">
      <div class="kc-pane"><h5>对象内部状态</h5><pre data-kc-state></pre></div>
      <div class="kc-pane"><h5>生成的 SQL</h5><pre data-kc-sql></pre></div>
    </div>
    <div class="kc-hint" data-kc-hint></div>
  </div>
```

### 概念 ⑤：取值时才编译 —— 编译做了两件事

「取值」在 knex 里就是调 `.toString()` 或 `.toQuery()`。这一刻它才把内部状态翻成 SQL，做两件事：

```flow
grid: true
nodes:
  - { id: in, label: 内部状态, sub: "{ table: 'user_portrait', where: [uid in [1,2,3]] }", row: 0, tone: violet }
  - { id: id1, label: 标识符加反引号, sub: "user_portrait → `user_portrait`", row: 1, tone: amber }
  - { id: id2, label: 值变占位符, sub: "[1, 2, 3] → ?", row: 1, tone: amber }
  - { id: out, label: 一段 SQL, sub: "select `uid` from `user_portrait` where `uid` in (?)", row: 2, tone: green }
edges:
  - { from: in, to: id1 }
  - { from: in, to: id2 }
  - { from: id1, to: out }
  - { from: id2, to: out }
```

```callout
tone: violet
icon: 💡
text: |
  **为什么要留 `?` 不直接写值？**

  因为 `?` 是**占位符** —— 真正的值放在一个单独的参数数组里，由数据库驱动去填充。
  这样值永远不会被当成 SQL 语法解析，==注入就不可能发生==。

  这个机制叫**参数绑定**，是概念②里那个问题的真正解法。
```

**为什么叫「惰性」**：链式调用只记状态，编译推迟到取值那一刻。好处是——
你可以在中途根据条件决定要不要再加一个 `.where()`，反正还没编译。

### 现在看这个库做了什么

knex 原生给了 `.toString()` 和 `.toQuery()`。这个库只加了一个 `.rawQuery()`：

```text
rawQuery() { return this.toString().trim(); }   // ← 就这么一行
```

**为什么要加**：knex 原生的取值方式返回值结构不统一，而这个库对外只交付**一段字符串**
（下游网关不接受别的形态）。所以统一一个出口。

**为什么挂在原型上，而不是用 `knex.QueryBuilder.extend()`**：

```flow
grid: true
groups:
  - { id: same, label: "两种入口落到同一个原型上", tone: violet }
nodes:
  - { id: e1, label: "DB.getInstance()", sub: "→ queryBuilder()", row: 0, tone: blue, group: same }
  - { id: e2, label: "DB.getInstance('name')", sub: "→ mysql(name)", row: 0, tone: blue, group: same }
  - { id: p, label: 同一个 Builder.prototype, sub: "两种入口共享这一份", row: 1, tone: violet, group: same }
  - { id: r, label: "rawQuery()", sub: "挂一次，两种入口都能用", row: 2, tone: green }
edges:
  - { from: e1, to: p }
  - { from: e2, to: p }
  - { from: p, to: r, label: "core 挂上去的" }
```

```callout
tone: amber
icon: ⚠
text: |
  **为什么不能用 `extend()`？** 代码注释里写了答案：

  ==extend 要求方法的返回值必须是 builder 实例==，而 `rawQuery()` 要返回字符串。
  类型不匹配，所以只能直接挂原型。
```

### 那 `toQuery()` 还在用吗？

搜一遍：`rawQuery()` 出现 **43 处**，`toQuery()` 只有 **9 处**，而且**全是值转义**：

```js
// core/src/db.ts · sqlValue
return DB.raw('?', [val]).toQuery();   // 把字符串转义成 SQL 字面量，借 knex 的能力
```

所以分工很清楚：==`rawQuery()` 管出口，`toQuery()` 管转义。==

### 一句话总结

```summary
title: knex 在这个库里的角色
text: |
  它是**「业务条件」和「SQL 字符串」之间的最后一层**。

  上游只管往 builder 上挂 `where`，不用操心反引号、转义、括号 —— 那些全是 knex 的事。

  这个库对它的唯一改动就是加了一个 `rawQuery()`，把出口统一成字符串。
```

## 05 · `packages/core` —— 通用层

### 它是干什么的

`core` 只做一件事：**把一棵「表达式树」翻译成一段 SQL 字符串。**

它不知道什么是画像、什么是事件、什么是圈人 —— 那些是 `crowd` 的事。
它只知道「有个条件树，要变成 SQL」。

```arch
svg: core-package
caption: packages/core 的组成与数据流 —— 由 archify skill 生成
```

### 它由什么组成

```tree
- label: 表达式模型
  sub: src/db.ts
  tone: violet
  note: 只有数据结构，没有任何行为
  children:
    - { label: Expression, sub: "四种形态", note: "普通 / 裸值 / 裸列 / 裸 SQL 片段" }
    - { label: Condition, sub: "{ logic, items }", note: "logic 是 AND 或 OR，items 可以再嵌套" }
    - { label: Rule, sub: "Condition | Expression", note: "调用方传进来的就是它" }
- label: 翻译器
  sub: src/db.ts
  tone: green
  note: DB 类上的静态方法
  children:
    - { label: buildWhere, note: "递归展开 —— 遇到 Condition 就建子查询再往下钻" }
    - { label: "raw / unionAllRaws", note: "拼 SQL 片段和 UNION ALL" }
    - { label: formatField, note: "反引号包裹列名" }
- label: 方言层
  sub: src/dialect/
  tone: amber
  note: 所有数据库差异都收在这里
  children:
    - { label: interface.ts, sub: "SqlDialect", note: "17 个方法的接口" }
    - { label: bytehouse.ts, note: "111 行" }
    - { label: doris.ts, note: "139 行" }
- label: 工具集
  sub: src/utils.ts
  tone: muted
  note: 675 行 —— 其实是个杂物抽屉
  children:
    - { label: 时间表达式, note: "getTimeRules / generateLatestDaysRules" }
    - { label: uid 编解码, note: "encodeUid / decodeUid / noDecodedSqlGen" }
    - { label: 树压缩, note: "treeMinimizer —— 去掉只有一个孩子的组合节点" }
    - { label: 标签表, note: "buildLabelTable —— 其实是给 crowd 的 segmentation 用的" }
```

```callout
tone: amber
icon: ⚠
text: |
  ==`utils.ts` 是个杂物抽屉。== 675 行里塞了四类互不相关的东西：
  时间表达式、uid 编解码、树压缩、标签表。

  其中**标签表是给 `crowd` 的 segmentation 用的** —— 严格说它不属于「通用层」。
  这是历史遗留，不是设计。
```

#### `src/` 根文件

```cards
cols: 2
items:
  - { title: db.ts, desc: "**最核心**。DB 类 + Expression/Condition/Rule 类型 + Logic/Op/ScopeOp 等操作符枚举 + buildWhere + unionAllRaws + formatField", tag: 235 行, tone: violet }
  - { title: utils.ts, desc: "时间表达式（getTimeRules / generateLatestDaysRules）+ uid 编解码 + treeMinimizer + getStringArrayRule + 标签表构建", tag: 675 行, tone: blue }
  - { title: define.ts, desc: "只有一个 DbType 枚举：mysql / bytehouse / doris", tag: 6 行, tone: muted }
  - { title: tree.ts, desc: "只有一个 GeneralTree 类型和 TreeForkKey —— 给通用树遍历用的最小接口", tag: 8 行, tone: muted }
  - { title: index.ts, desc: 统一出口，把上面这些 + dialect + utils 一起导出, tag: 12 行, tone: green }
```

#### `src/utils/` —— 两个防坑小工具

```cards
cols: 2
items:
  - { title: encode-value.ts, desc: "把绑定值里的 `?` 换成占位符。因为 knex 用 `?` 做参数绑定，值里带问号会把 SQL 拆错", tag: 17 行, tone: amber }
  - { title: assert-sql-safe-value.ts, desc: "数组值含单引号就直接抛错。因为 stringArray 的值要拼进 SQL 字符串字面量（网关不支持参数绑定），含引号会破坏 SQL 边界", tag: 14 行, tone: red }
```

```callout
tone: amber
icon: ⚠
text: |
  这两个文件的存在说明一件事：==这个库有一部分 SQL 是「拼字符串」而不是「参数绑定」==。
  原因是**数据网关不支持某些绑定写法**。所以需要人工兜底 —— 看到这两个文件，
  就知道哪些路径上必须小心注入。
```

#### `src/dialect/` —— 方言

```cards
cols: 2
items:
  - { title: interface.ts, desc: "**SqlDialect 接口**，17 个方法：类型转换、JSON 数组、时间范围、多条件选择、正则匹配…", tag: 59 行, tone: violet }
  - { title: bytehouse.ts, desc: ByteHouse 实现（`UNIX_TIMESTAMP(...) * 1000`、`DS_DATETIME_ADD`、`match()` 这类专属函数）, tag: 111 行, tone: blue }
  - { title: doris.ts, desc: Doris 实现（与 ByteHouse 同名方法，内部写法不同）, tag: 139 行, tone: blue }
  - { title: where-sql.ts, desc: "从完整 SELECT 里把 **WHERE 之后**的部分抠出来。用于「只想要 where 片段」的场景", tag: 32 行, tone: muted }
  - { title: spark-array-contains.ts, desc: "把 `array_contains(field, v)` 组合成 IN / NOT IN 语义（多个用 OR，取反用 NOT(OR)）", tag: 35 行, tone: muted }
  - { title: index.ts, desc: 出口, tag: 3 行, tone: muted }
```

### 它怎么工作：按架构图的每条边走一遍

上面那张图有 **8 个框、7 条边**，每条边都带编号。

```compare
first: 边
head: [从 → 到, 这一步在干什么]
rows:
  - "①": ["`crowd 条件实现` → `Rule[]`", "adapter 改写：字段改名 + 展开特殊条件"]
  - "②": ["`utils.ts` → `Rule[]`", "时间条件展开成一棵 AND 子树"]
  - "③": ["`crowd 条件实现` → `SqlDialect`", "属性类型特殊时才调方言"]
  - "④": ["`SqlDialect` → `Bytehouse` / `Doris`", "接口落到具体实现"]
  - "⑤": ["`Rule[]` → `DB.buildWhere`", "递归展开成 knex 调用"]
  - "⑥": ["`DB.buildWhere` → `knex`", "五种表达式形态各落到哪个方法"]
  - "⑦": ["`knex` → `SQL 字符串`", "链式累积，取值时才编译"]
```

下面按编号一条条走。

#### 边 ① `crowd → Rule[]`：adapter 在干什么

**这是整条链路里唯一的「业务语义 → 数据语义」翻译点。** 值得拆细。

##### 为什么需要这一步：两套词汇表

业务侧和表达式模型**结构长得很像，但词汇完全不同**：

```compare
first: 同一个概念
head: [业务模型（crowd）, 表达式模型（core）]
rows:
  - 属性名: ["`name`", "`column`"]
  - 时间条件: ["`dateType` + `relativeDateType` + `dateFormat`", "展开成多个 `op` + `column` + `value`"]
  - 逻辑组合: ["`logic` + `items`", "`logic` + `items`（**一样**）"]
  - 裸值: ["`rawValue`", "`rawValue`（**一样**）"]
  - 操作符: ["`Op` / `ScopeOp` / `ContainOp` …", "同一套枚举（**一样**）"]
```

```callout
tone: violet
icon: 💡
text: |
  ==两个模型有一半的词汇是共享的，另一半是业务独有的。==

  共享的（`logic` / `items` / `rawValue` / 操作符枚举）**直接透传**；
  业务独有的（`name` / `dateType` 那一堆）**在这一步翻译掉**。

  这样 `core` 就永远不需要知道「什么是相对时间」「什么是画像属性」。
```

##### 它是个递归函数

```flow
grid: true
nodes:
  - { id: in, label: "adapter(rules)", sub: "单个条件或数组", row: 0, kind: backend }
  - { id: loop, label: 遍历每个 rule, row: 1, tone: violet }
  - { id: q1, label: "有 'logic'？", sub: "是树", row: 2, tone: amber, shape: note }
  - { id: q2, label: "有 'op'？", sub: "是叶子", row: 2, tone: amber, shape: note }
  - { id: rec, label: "递归 adapter(items)", sub: "保持 logic 不变", row: 3, tone: violet }
  - { id: q3, label: "有 'dateType'？", sub: "时间条件", row: 3, tone: amber, shape: note }
  - { id: plain, label: "直接改名", sub: "name → column", row: 4, tone: green }
  - { id: time, label: "展开成 AND 子树", sub: "调方言或 utils", row: 4, tone: red }
  - { id: bad, label: throw, sub: "条件错误", row: 4, tone: red }
edges:
  - { from: in, to: loop }
  - { from: loop, to: q1, label: "是" }
  - { from: q1, to: rec, label: "是" }
  - { from: q1, to: q2, label: "否", dashed: true }
  - { from: q2, to: q3, label: "是" }
  - { from: q2, to: bad, label: "否", dashed: true }
  - { from: q3, to: plain, label: "否" }
  - { from: q3, to: time, label: "是" }
```

```callout
tone: amber
icon: ⚠
text: |
  **递归点在第 1 个分支**：`'logic' in rule` 时执行 `items: this.adapter(rule.items)` ——
  子树交给同一个函数处理。==所以 adapter 的输入输出类型是同一个（`Rule[]`），
  这让它天然能处理任意深度的嵌套。==
```

##### 五个出口，各产出什么

```compare
first: 分支
head: [产出, 真实数据]
rows:
  - "有 `logic`":
      - "**递归**，结构不变"
      - |-
        { logic: 'OR', items: [...] }
          → { logic: 'OR', items: [递归结果] }
  - "有 `dateType`\n且是相对时间戳":
      - "**调方言**，展开成 AND 子树"
      - |-
        { op: Gte, name: '..._time', value: 3 }
          → { logic: AND, items: [3 个 Expression] }
  - "有 `dateType`\n其它时间":
      - "**调 utils**，展开成 AND 子树"
      - |-
        同上，但生成的是通用 Rule
  - "有 `rawValue`":
      - "改名 + 透传"
      - |-
        { op: Eq, name: 'c', rawValue: 'a+b' }
          → { column: 'c', op: Eq, rawValue: 'a+b' }
  - "普通条件":
      - "**只改名**"
      - |-
        { op: IN, name: 'city', value: ['杭州'] }
          → { column: 'city', op: IN, value: ['杭州'] }
  - "都不是":
      - "throw"
      - "条件错误: {...}"
```

```callout
tone: violet
icon: 💡
text: |
  ==注意时间条件那两个分支：一个输入条件变成了一棵子树。==

  而且外面**强制包一层 `logic: 'AND'`** —— 代码注释解释了原因：

  > 这里包装一层，因为 timeRules 必须是 And 的关系，
  > 而 result 这一层的关系可能是 Or

  如果不包，「最近 3 天 **或** 是 VIP」会被解析成
  「`>= 开始` **或** `<= 结束` **或** 是 VIP」—— 语义就错了。
```

##### 一个完整例子：看结构怎么膨胀

输入（业务侧）：

```text
{ logic: 'AND', items: [
    { op: 'IN',  name: 'city',       value: ['杭州'] },
    { op: 'Gte', name: '..._time',   dateType: 'Relative', value: 3 }
]}
```

`adapter` 处理完：

```text
{ logic: 'AND', items: [                    ← 外层结构不变，logic 透传
    { op: 'IN', column: 'city', value: ['杭州'] },        ← 只改名

    { logic: 'AND', items: [                ← 时间条件膨胀成一棵子树
        { op: 'Gte', column: '..._time', ... },   ← 起点
        { op: 'Lte', column: '..._time', ... }    ← 终点
    ]}
]}
```

**一个叶子（1 行）→ 一棵子树（5 行）。** 这是 adapter 里唯一会改变结构的地方。

##### 为什么相对时间戳要单独走方言

同样是相对时间，**两个库的 SQL 完全不一样**：

```compare
first: 库
head: [getRelativeTimestampRules 的实现, 生成的 SQL 形态]
rows:
  - ByteHouse:
      - "**薄壳** —— 直接转发给 `utils.getTimestampRules()`"
      - |-
        `..._time` >= UNIX_TIMESTAMP(
          DS_DATETIME_ADD('day', -3, NOW())
        ) * 1000
  - Doris:
      - "**自己实现** —— 因为 Doris 的 event_time 是 DATETIME"
      - |-
        `..._time` >= DS_DATETIME_ADD('day', -3,
          FROM_UNIXTIME(UNIX_TIMESTAMP(), '%Y-%m-%d 00:00:00')
        )
```

```callout
tone: amber
icon: ⚠
text: |
  **差别在于要不要 `UNIX_TIMESTAMP(...) * 1000` 那层包装。**

  ByteHouse 的 `event_time` 是**毫秒时间戳**（数字），所以要把日期转成毫秒再比。
  Doris 的 `event_time` 是 **DATETIME**（日期类型），直接比就行。

  代码注释原话：

  > Doris event_time 是 DATETIME，复用 DS_DATETIME_ADD UDF，
  > 去掉 UNIX_TIMESTAMP(...) * 1000 包装，直接与 DATETIME 列比较

  ==这就是「为什么时间戳必须走方言」的答案 —— 不是风格差异，是列的数据类型不同。==
```

#### 边 ② `utils.ts → Rule[]`：时间条件怎么展开

`utils.ts` 里跟这条边有关的是 `getTimeRules()`。看它的真实输入输出：

业务侧写的是这两种：

```text
{ op: 'Gte', name: '..._opened_time', dateType: 'Relative', value: 30 }
{ op: 'Lte', name: '..._last_time',   dateType: 'Relative', value: 30 }
```

`getTimeRules()` 处理完，变成：

```compare
first: 输入
head: [输出的表达式模型, 最终生成的 SQL]
rows:
  - "Gte + Relative\nvalue: 30":
      - |-
        一棵 AND 子树：
          { op: Gte, column: '...' }
          { op: Lte, column: '...' }
      - |-
        `..._opened_time` >= DS_DATE_ADD(NOW(), -30)
          AND `..._opened_time` <= DS_DATE_ADD(NOW(), -1)
  - "Lte + Relative\nvalue: 30":
      - |-
        一棵 AND 子树：
          { op: Lt, column: '...' }
          { op: Gt, column: '...', value: 0 }
      - |-
        `..._last_time` < DS_DATE_ADD(NOW(), -30)
          AND `..._last_time` > 0
```

```callout
tone: amber
icon: ⚠
text: |
  **第二行那个 `> 0` 是个补丁，不是业务要求。** 代码注释写着：

  > 对于 `<` 和 `<=` 的时间范围，需要加上 `> 0` 的限制条件，
  > 否则会筛选出值为 0 的数据。

  ==「值为 0」在时间戳语义里代表「从没发生过」==，不加这个条件会被当成「很久以前发生过」。
```

`utils.ts` 675 行里跟这条边相关的是**时间表达式**那一块（约 300 行）。
剩下的 375 行是 uid 编解码、树压缩、标签表 —— **跟这条边无关**，是别的调用方在用。

#### 边 ③ `crowd → SqlDialect`：方言真正被调用的地方

```callout
tone: red
icon: ⚠
tinted: true
text: |
  **方言不是 `buildWhere` 调的。** `buildWhere` 是静态方法，签名里根本没有 dialect
  —— 它压根不知道方言存在。

  ==全部方言调用都在 `crowd/src/` 里==，调用点是 `adapter()`。
```

触发条件是**属性类型特殊**：

| 属性类型 | 调哪个方言方法 | 返回什么 |
|---|---|---|
| 相对时间 | `getRelativeTimestampRules()` | `Expression[]` |
| 正则匹配 | `regexpMatchExpr()` | `Expression` |
| JSON 数组 | `jsonArrayContainsRule()` | `Rule` |
| bool | `castBoolToInt()` | `string` |
| map 取值 | `mapPropertyAccess()` | `string` |
| NULL 判断 | `isNullCheck()` | `string` |

```callout
tone: violet
icon: 💡
text: |
  ==**方言方法没有一个是直接产出 SQL 的。**==

  它们返回两种东西：**SQL 片段字符串**（被拼进 `Expression.raw`），
  或者**完整的 Expression / Rule**（直接进表达式树）。

  真正把表达式树变成 SQL 的是 knex，不是方言。
```

#### 边 ④ `SqlDialect → 两个实现`：什么时候决定用哪个

**不在翻译的时候决定，在最早的时候决定一次。**

```flow
grid: true
nodes:
  - { id: create, label: "SqlContext.create(dbType, options)", sub: "唯一入口", row: 0, kind: backend }
  - { id: q, label: "dbType 是什么？", row: 1, tone: amber, shape: note }
  - { id: bh, label: "BytehouseGroupDialect", sub: "无参即可", row: 2, tone: cloud }
  - { id: doris, label: "DorisGroupDialect", sub: "必须传 eventTableMap", row: 2, tone: cloud }
  - { id: err, label: "throw", sub: "不支持的 dbType", row: 2, tone: red }
  - { id: mods, label: "注入三个 Module", sub: "tag / crowd / segment", row: 3, kind: backend }
edges:
  - { from: create, to: q }
  - { from: q, to: bh, label: "Bytehouse" }
  - { from: q, to: doris, label: "Doris" }
  - { from: q, to: err, label: "其它", dashed: true }
  - { from: bh, to: mods }
  - { from: doris, to: mods }
```

选定的方言实例会被**注入三个 Module**，之后一路传下去，翻译过程中不再重新判断。

```callout
tone: red
icon: ⚠
text: |
  **但每个类都写了兜底**：`dialect ?? new BytehouseDialect()`。

  意味着 ==忘了传 dialect 不会报错，会静默按 ByteHouse 生成 SQL==。
  Doris 场景下会生成语法能跑但结果不对的 SQL。
```

#### 边 ⑤ `Rule[] → DB.buildWhere`：递归展开

这一步是整条链路的**核心**，前面已经展开讲过（第 3 层递归那个 journey）。

一句话复述：==**遇到 Condition 就建括号往下钻，遇到 Expression 就挂 where。**==

#### 边 ⑥ `buildWhere → knex`：具体落到哪个方法

| 表达式形态 | 落到 knex 的 |
|---|---|
| `Condition` | `builder.andWhere(sub => 递归)` 或 `.orWhere(...)` |
| `NormalExpression` | `whereFn(DB.raw(formatField(column)), op, encodeValue(value))` |
| `RawValueExpression` | 同上，但 value 是 `DB.raw(rawValue)` |
| `RawColumnExpression` | 同上，但 column 是 `DB.raw(rawColumn)` |
| `RawExpression` | `this.whereRaw(raw, encodeValue(value))` |

```callout
tone: violet
icon: 💡
text: |
  ==**AND / OR 的实现就是「选哪个方法名」。**==

  `getWhereFn(builder, logic)` 里一个 switch：`Logic.And → builder.andWhere`，
  `Logic.Or → builder.orWhere`。没有别的魔法。
```

#### 边 ⑦ `knex → SQL 字符串`：编译

knex 内部是**链式累积**：每个 `.where()` / `.andWhere()` 只是往 builder 的内部状态里追加，
**不生成 SQL**。直到调 `.toString()` 才真正编译。

编译做两件事：

```compare
first: 阶段
head: [数据形态, 例子]
rows:
  - 编译前: ["builder 内部状态", "列名是裸的，值在 bindings 数组里"]
  - 编译中: ["标识符加反引号", "`city`"]
  - 编译中: ["值替换成 ? 占位符", "where `city` in (?, ?)"]
  - 编译后: ["toString() 内联值", "where `city` in ('杭州', '深圳')"]
```

```callout
tone: violet
icon: 💡
text: |
  **为什么要留 `?` 而不是直接写值？**

  因为 `?` 是**占位符** —— 真正的值放在单独的参数数组里，由驱动去填。
  这样值永远不会被当成 SQL 语法解析，==注入就不可能发生==。

  这个库的 `rawQuery()` 用的是 `toString()`，所以拿到的是**内联后的字符串**。
```

#### 终点：SQL 字符串去哪

```journey
- tag: 产出
  tone: green
  name: SQL 字符串
  badge: 交给网关
  code: |
    select `uid` from `user_portrait`
    where (`city` in ('杭州', '深圳') and (...))
  note: |
    `rawQuery()` 返回的就是它。**这个库不执行 SQL**，只负责生成。
  next: "数据网关 :: :: 真正执行的地方"

- tag: 网关
  tone: muted
  name: /api/udp/tool/query-olap-by-sql
  badge: 有约束
  fields:
    - { k: 接受, v: "一段 SQL 字符串", tone: ok }
    - { k: 不接受, v: "{ sql, bindings } 这种结构", tone: warn }
    - { k: "UNION", v: "不支持，只支持 UNION ALL", tone: warn }
  note: |
    ==这就是为什么 `DB.unionAllRaws()` 的注释写着「网关只支持 union all，不支持 union」==
    —— 不是性能选择，是下游能力约束。

    也是为什么 `decodeUid()` 要把结果包成 `UID_DECODE(\`uid\`) as \`uid\``
    —— 网关认得这个函数。
```

### 一个藏在里面的不一致

```callout
tone: red
icon: ⚠
tinted: true
text: |
  **方言差异并不全都走 `SqlDialect` 接口。**

  `getStringArrayRule()` 直接按 `dbType` 分支：
```

```text
// core/src/utils.ts:455
if (dbType === DbType.Bytehouse) { ... }
else if (dbType === DbType.Doris) { ... }
else if (dbType === DbType.MySql) { ... }
```

```callout
tone: red
icon: ⚠
text: |
  这意味着**要加一种数据库，光实现 `SqlDialect` 接口不够** ——
  还得回来改 `utils.ts` 里这个 `if/else`。

  ==这是这套架构里最明显的裂缝。== 理想情况下所有方言分支都该收进接口。
```

## 06 · `packages/crowd` —— 主体

### 五个目录的分工

```lane-stack
- title: 对外
  desc: 调用方只看这两个
  tone: green
  nodes:
    - { title: index.ts, sub: 统一出口 + utils 聚合 }
    - { title: context.ts, sub: "SqlContext —— 唯一入口" }
  next: "模块层 :: :: 按业务场景分"

- title: modules/
  desc: 三个模块，各管一类业务场景
  tone: blue
  nodes:
    - { title: crowd.ts, sub: "CrowdModule · 59 行" }
    - { title: tag.ts, sub: "TagModule · 105 行" }
    - { title: segmentation.ts, sub: "SegmentModule · 324 行", tag: 最复杂 }
  next: "组合层 :: :: 把条件拼起来"

- title: combi/
  desc: 组合 + 二次加工 + 树结构修正
  tone: violet
  nodes:
    - { title: combination.ts, sub: "UNION ALL + GROUP BY + HAVING" }
    - { title: pkg.ts, sub: "include / exclude" }
    - { title: utils.ts, sub: "树修正与分发入口" }
    - { title: interface.ts, sub: "BuildInfoTree 等类型" }
  next: "条件实现 :: :: 六种叶子"

- title: entrepots/
  desc: 六种条件各自的实现 + 工厂
  tone: violet
  nodes:
    - { title: factory.ts, sub: "工厂 + 分发 switch" }
    - { title: portrait / event / relation, sub: "…" }
    - { title: uid / crowd / rawSql, sub: "…" }

- title: dialect/ + ast/
  desc: 方言扩展；另一套 AST
  tone: amber
  nodes:
    - { title: dialect/, sub: "比 core 多一个 getEventTable" }
    - { title: ast/, sub: "信号 DAG，独立体系" }
```

### `src/` 根文件

```cards
cols: 2
items:
  - { title: context.ts, desc: "**SqlContext** —— 全库唯一入口。`create(dbType, options)` 选方言、构造三个模块", tag: 48 行, tone: green }
  - { title: define.ts, desc: "**所有业务枚举**：Entrepots / Tables / Modules / UidFields / CombineType / DimensionType / IntervalType / DbName", tag: 45 行, tone: blue }
  - { title: index.ts, desc: 统一出口。还聚合了一个 `utils` 对象，把零散工具打包给外部用, tag: 63 行, tone: green }
```

```callout
tone: violet
icon: 💡
text: |
  ==想知道「系统认识哪些表、哪些条件类型」，直接看 `define.ts`== ——
  所有业务词汇都在这 45 行里。这是读 crowd 包最好的起点。
```

### `src/combi/` —— 组合层

```cards
cols: 2
items:
  - { title: combination.ts, desc: "**Combination 类**。UNION ALL + GROUP BY uid + HAVING COUNT 实现 AND/OR/自定义数量", tag: 165 行, tone: violet }
  - { title: pkg.ts, desc: "**Pkg 类**。include（UNION ALL 并集）/ exclude（NOT IN 差集），按 options.order 排序", tag: 123 行, tone: violet }
  - { title: utils.ts, desc: "树修正与入口：treeSimplifier / getMainStruct / initMajorListSqlGen / checkAndGetIncluOrExcluRule / optionCorrector", tag: 381 行, tone: blue }
  - { title: interface.ts, desc: "BuildInfoTree / MultiEntrepotCombination / EntrepotCombinationOption 等结构类型", tag: 63 行, tone: muted }
  - { title: index.ts, desc: 出口, tag: 4 行, tone: muted }
```

```callout
tone: amber
icon: ⚠
text: |
  `utils.ts` 有 381 行但导出 11 个函数，是 crowd 包里**第二难读**的文件。
  里面有一半是**历史包袱**：`isOldUidAdditionalStruct` / `isOldCrowdAdditionalStruct` /
  `optionCorrector` 都是给 1.8.0 旧结构做兼容的，注释里直接写着「后续线上没有这个结构可以删除」。
  读的时候可以先跳过这些。
```

### `src/entrepots/` —— 六种条件

```cards
cols: 2
items:
  - { title: factory.ts, desc: "**工厂 + 分发**。initEntrepotListSqlGen / initEntrepotCountSqlGen + 四个 createXxxEntrepot + convertToPkgEntrepot", tag: 192 行, tone: violet }
  - { title: event.ts, desc: "**最复杂的文件**。事件条件：事件名 + 时间范围 + 属性过滤 + 次数阈值", tag: 906 行, tone: red }
  - { title: relation.ts, desc: "关系条件。含 isRelationRule / RelationFormulaType / checkPropsHasNotExistOp", tag: 715 行, tone: blue }
  - { title: portrait.ts, desc: "画像条件。支持 Range / Set 两种区间，可嵌套树", tag: 233 行, tone: blue }
  - { title: uid.ts, desc: "直接给 uid 列表。含 getEncodeUidsText，最简但要注意加密", tag: 141 行, tone: green }
  - { title: crowd.ts, desc: "人群包条件。含 partition() 把树形 CrowdCondition 拆成组合结构", tag: 134 行, tone: green }
  - { title: rawSql.ts, desc: 裸 SQL 透传，逃生口, tag: 107 行, tone: muted }
  - { title: index.ts, desc: 出口 + entrepotGen / entrepotUtils 两个聚合对象, tag: 50 行, tone: green }
```

```callout
tone: violet
icon: 💡
text: |
  ==`event.ts` 906 行 + `relation.ts` 715 行，两个文件占了 crowd 包的 40%。==
  如果只是想知道整体架构，**这两个文件可以最后看** —— 它们主要是业务细节的堆叠，
  不影响理解主干。
```

### `src/dialect/` —— 方言

```cards
cols: 2
items:
  - { title: interface.ts, desc: "GroupSqlDialect extends SqlDialect，只多一个 getEventTable", tag: 11 行, tone: violet }
  - { title: bytehouse.ts, desc: "**按 murmurhash 分 8 张表**：`event_biz_N` / `event_monitoring_N`", tag: 80 行, tone: blue }
  - { title: doris.ts, desc: 从构造时传入的 eventTableMap 里查，查不到直接 throw, tag: 20 行, tone: blue }
  - { title: index.ts, desc: 出口, tag: 3 行, tone: muted }
```

### `src/ast/` —— 另一套 AST

```cards
cols: 2
items:
  - { title: signal.ts, desc: "**Signal 类**。处理「信号 DAG」—— 与条件树平行的另一套模型", tag: 210 行, tone: violet }
  - { title: interface.ts, desc: SignalDag / SignalAggNode / SignalMetric / SignalConfig 等类型, tag: 57 行, tone: muted }
  - { title: doris.ts, desc: "把属性过滤条件转成 Doris 的 Rule：createBuildInPropRule / createMapPropRule", tag: 290 行, tone: blue }
  - { title: enum.ts, desc: "只有 SignalLogicOp（and / or）", tag: 6 行, tone: muted }
```

```callout
tone: amber
icon: ⚠
text: |
  ==`ast/` 和 `entrepots/` 是两套并行的模型==，容易看混：

  - `entrepots/` —— 圈人的**条件树**（portrait / event / crowd …）
  - `ast/` —— 信号服务的 **DAG**（节点 + 指标 + 时长）

  它们都产出 SQL，但输入结构完全不同。`ast/signal.ts` 里的 `SignalDag`
  是**信号服务定义的结构**，不是这个库设计的。
```

### `scripts/` —— 运维脚本（不参与构建）

```cards
cols: 3
items:
  - { title: bh-event-table.mjs, desc: 命令行算「这个事件名落在哪张分片表」, tag: 9 行, tone: muted }
  - { title: seed-test-data.mjs, desc: 给测试 uid 造真实数据，让期望 SQL 能查出结果, tag: 338 行, tone: blue }
  - { title: run-expected-sql.mjs, desc: 把所有测试里的期望 SQL 批量拿去真实库跑一遍，验证可执行, tag: 292 行, tone: green }
```

```callout
tone: green
icon: ✅
text: |
  这三个脚本很能说明这个仓库的测试思路：==不只断言 SQL 字符串，还拿去真库跑==。
  `run-expected-sql.mjs` 是「生成的 SQL 真的能执行吗」的兜底。
```

## 07 · `packages/goods` + 根级目录

### goods 包

结构和 crowd 类似（`src/entrepots` + `src/modules` + `src/utils`），但有两个不同：

```cards
cols: 2
items:
  - { title: 用 vitest 不用 jest, desc: "另外两个包用 jest，goods 用 vitest —— 说明它在独立演进，没跟主线的工具链对齐", tone: violet }
  - { title: test/tooling/, desc: "三个 CLI：print-goods-query（打印生成的 SQL）/ dump-test-fixtures / refresh-query-fixture（刷新快照）", tone: blue }
  - { title: utils/beijing-calendar.ts, desc: 北京日历，处理交易日 / 节假日, tone: blue }
  - { title: utils/json-condition-node.ts, desc: JSON 条件节点的通用处理, tone: blue }
```

### 根级目录

```cards
cols: 2
items:
  - { title: pnpm-workspace.yaml, desc: "包列表 + **catalog 版本表**。所有依赖版本在这里统一，各包用 `catalog:` 引用", tag: 要改, tone: blue }
  - { title: tsconfig.base.json, desc: "共享 TS 配置。**declarationDir: ./types** 决定了根级 types/ 是产物", tag: 要改, tone: blue }
  - { title: package.json, desc: "只有 workspace 脚本（build / test / lint 都是 pnpm -r 递归）", tag: 参考, tone: muted }
  - { title: .eslintrc.js, desc: "lint 规则，用了 eslint-config-futu", tag: 参考, tone: muted }
  - { title: .prettierrc, desc: "格式化规则（4 空格缩进、单引号）", tag: 参考, tone: muted }
  - { title: README.md, desc: "说明这是个**拆分骨架**。注意它可能落后于实际代码", tag: ⚠️, tone: amber }
  - { title: types/, desc: "**构建产物**，core 的 .d.ts。不要手改", tag: 产物, tone: red }
```

## 08 · 我想改 X，去哪个文件

==这是整篇最该收藏的一张表。==

```compare
first: 我想改…
head: [去这个文件, 找什么]
rows:
  - 加一种数据库: ["core/src/dialect/interface.ts", "先实现 SqlDialect 全部 17 个方法"]
  - 同上（事件表定位）: ["crowd/src/dialect/interface.ts + bytehouse.ts / doris.ts", "再实现 getEventTable"]
  - 同上（挂上去）: ["crowd/src/context.ts", "在 _resolveDialect 的 switch 加一个 case"]
  - 加一种条件类型: ["crowd/src/define.ts", "Entrepots 枚举加值"]
  - 同上（写实现）: ["crowd/src/entrepots/<新文件>.ts", "实现 list / count 两个方法"]
  - 同上（注册）: ["crowd/src/entrepots/factory.ts", "两个 switch 各加一个 case"]
  - 改 AND / OR 的语义: ["crowd/src/combi/combination.ts", "combineSql 里的 HAVING 那段"]
  - 改 include / exclude: ["crowd/src/combi/pkg.ts", "include() / exclude()"]
  - 改表名或字段名: ["crowd/src/define.ts", "Tables / UidFields 枚举"]
  - 改「最近 N 天」的算法: ["core/src/utils.ts", "getTimeRules / generateLatestDaysRules"]
  - 改 uid 加解密: ["core/src/utils.ts", "encodeUid / decodeUid / noDecodedSqlGen"]
  - 改 SQL 里的列名引号: ["core/src/db.ts", "DB.formatField"]
  - 改表达式树怎么展开成 WHERE: ["core/src/db.ts", "DB.buildWhere"]
  - 加一个对外模块: ["crowd/src/modules/<新文件>.ts", "照抄 CrowdModule 的骨架"]
  - 改事件表分片规则: ["crowd/src/dialect/bytehouse.ts", "getEventTable 里的 murmurhash"]
  - 改业务枚举: ["crowd/src/define.ts", "全部在这 45 行里"]
```

## 09 · 推荐的看代码顺序

```lane-stack
- badge: STEP 01
  title: 先看词汇表
  desc: 45 行，一次看完
  tone: green
  nodes:
    - { title: crowd/src/define.ts, sub: "系统认识哪些表、哪些条件类型" }
  next: "再找入口 :: :: 从哪进"

- badge: STEP 02
  title: 找入口
  desc: 看清「谁调用谁」的骨架
  tone: blue
  nodes:
    - { title: crowd/src/index.ts, sub: 对外导出什么 }
    - { title: crowd/src/context.ts, sub: "SqlContext —— 唯一入口" }
  next: "看模块 :: :: 业务场景分几类"

- badge: STEP 03
  title: 看模块骨架
  desc: 只读 crowd.ts（59 行），跳过 segmentation
  tone: blue
  nodes:
    - { title: crowd/src/modules/crowd.ts, sub: "list / count / selectRaw 三步" }
  next: "进组合层 :: :: 最核心的机制"

- badge: STEP 04
  title: 看组合层
  desc: 这里藏着最反直觉的设计
  tone: violet
  nodes:
    - { title: combi/combination.ts, sub: "165 行，UNION ALL + HAVING" }
    - { title: combi/pkg.ts, sub: "123 行，include / exclude" }
  next: "看分发 :: :: 六种条件怎么选"

- badge: STEP 05
  title: 看工厂
  desc: 看清六种条件的分发方式
  tone: violet
  nodes:
    - { title: entrepots/factory.ts, sub: "192 行，两个 switch" }
  next: "最后再看具体条件 :: :: 按需读，不用全看"

- badge: STEP 06
  title: 具体条件实现
  desc: 只读你关心的那一种
  tone: amber
  nodes:
    - { title: portrait.ts, sub: "233 行，最容易懂" }
    - { title: crowd.ts, sub: "134 行，第二容易" }
    - { title: "event.ts / relation.ts", sub: "906 + 715 行，业务细节堆叠，最后看", tone: red }
```

```callout
tone: violet
icon: 💡
text: |
  ==前五步加起来不到 600 行==，就能把主干搞懂。
  `event.ts` 和 `relation.ts` 加起来 1621 行，但它们是**同一套模式的重复应用** ——
  看懂 portrait 之后，其他几种只是细节不同。
```

## 10 · 自测

```quiz
- q: 根目录的 `types/` 能改吗？
  a: |
    **不能。** 它是 TypeScript 编译产物（`tsconfig.base.json` 里 `declarationDir: "./types"`），
    内容全是 `export declare`，下次构建会被覆盖。
    真正的源码在 `packages/*/src/`。
    注意别和 `packages/*/typings/` 搞混 —— 那个是手写的类型补丁，要提交。
- q: 想知道「系统支持哪些条件类型」，看哪个文件？
  a: |
    `packages/crowd/src/define.ts`。45 行，`Entrepots` 枚举就是全部条件类型
    （portrait / event / relation / rawSql / crowd / uid），
    `Tables` 枚举是全部表名。
- q: 要加一种新的数据库支持，一共要改几个文件？
  a: |
    至少三个：
    1. `core/src/dialect/` 加一个实现 `SqlDialect`（17 个方法）
    2. `crowd/src/dialect/` 加一个实现 `GroupSqlDialect`（多一个 `getEventTable`）
    3. `crowd/src/context.ts` 的 `_resolveDialect` switch 加 case
    **core 的业务逻辑完全不用改** —— 这就是两个包拆开的价值。
- q: 改 AND / OR 的行为，去哪个文件？
  a: |
    `packages/crowd/src/combi/combination.ts` 的 `combineSql()`。
    AND 和 OR 的差别只有一行：
    `if (trees.logic === Logic.And) query.having(havingCount(UID), Op.Eq, sqls.length)`
    —— OR 就是不执行这一行。
- q: "`event.ts` 有 906 行，需要一开始就读吗？"
  a: |
    不需要。它是**同一套模式在业务细节上的堆叠**。
    先读 `portrait.ts`（233 行）理解模式，再按需看 event 里你关心的那部分。
    `event.ts` + `relation.ts` 占了 crowd 包 40% 的代码，但主干逻辑不在这。
- q: "`packages/crowd/src/ast/` 和 `entrepots/` 有什么区别？"
  a: |
    两套并行的模型：
    `entrepots/` 处理**圈人的条件树**（portrait / event / crowd …）；
    `ast/` 处理**信号服务的 DAG**（节点 + 指标 + 时长），
    `SignalDag` 是信号服务定义的结构，不是这个库设计的。
    两者都产出 SQL，但输入结构完全不同。
- q: "`scripts/` 里的脚本参与构建吗？"
  a: |
    不参与。它们是运维/调试用的独立 Node 脚本，通过 `package.json` 的
    `seed` / `bh-event-table` / `run-expected-sql` 手动触发。
    其中 `run-expected-sql.mjs` 很有价值 —— 它把测试里的期望 SQL
    批量拿去真实数据库执行，验证「生成的 SQL 真的能跑」。
```
