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

## 02 · 三个包分别管什么

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

### 这些依赖具体干什么

上面「依赖谁」一栏里全是名字。逐个说清楚它们在这里的作用：

```compare
first: 依赖
head: [它是什么, 在这个库里干什么, 在哪用到]
rows:
  - knex:
      - SQL 查询构造器（JS 库）
      - "**整个库的地基**。所有 SQL 字符串都由它生成；core 的 DB 类只是它的包装"
      - "core/src/db.ts（唯一的入口）"
  - lodash:
      - 通用工具库
      - "**只用了 `cloneDeep` 一个函数** —— 深拷条件对象，避免改到调用方传进来的数据"
      - "entrepots/factory.ts · modules/segmentation.ts"
  - murmurhash:
      - 哈希算法库
      - "算事件名的哈希，决定落在 `event_biz_1..8` 哪张分片表"
      - "dialect/bytehouse.ts（**仅此一处**）"
  - mysql2:
      - MySQL 驱动
      - "**src 里没有直接 import**。它是 knex 用 `client: 'mysql'` 时的底层驱动，列在 deps 里是为了保证部署环境有驱动"
      - 由 knex 间接使用
  - tslib:
      - TypeScript 运行时辅助函数
      - "**src 里也没有直接 import**。`tsconfig.base.json` 里 `importHelpers: true`，编译后的 JS 会 `require('tslib')` 拿 `__spreadArray` 这类辅助函数，所以它必须是 dependency 而不是 devDependency"
      - 编译产物自动引入
  - type-fest:
      - TS 类型工具库
      - "**只用了 `ValueOf` 一个类型**，而且全是 `import type`（编译后消失，不进运行时）"
      - "goods 包 3 个文件"
```

```callout
tone: violet
icon: 💡
text: |
  **注意 `mysql2` 和 `tslib` 都不是主动依赖**，你在 `src/` 里搜不到它们的 import。
  它们存在的原因是「别人需要」：knex 要驱动，编译产物要辅助函数。

  看依赖表时先区分这两类：
  ==主动依赖决定代码怎么写，被动依赖只决定能不能跑起来。==
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

## 03 · `packages/core` —— 通用层

### `src/` 根文件

```cards
cols: 2
items:
  - { title: db.ts, desc: "**最核心**。DB 类 + Expression/Condition/Rule 类型 + Logic/Op/ScopeOp 等操作符枚举 + buildWhere + unionAllRaws + formatField", tag: 235 行, tone: violet }
  - { title: utils.ts, desc: "时间表达式（getTimeRules / generateLatestDaysRules）+ uid 编解码 + treeMinimizer + getStringArrayRule + 标签表构建", tag: 675 行, tone: blue }
  - { title: define.ts, desc: "只有一个 DbType 枚举：mysql / bytehouse / doris", tag: 6 行, tone: muted }
  - { title: tree.ts, desc: "只有一个 GeneralTree 类型和 TreeForkKey —— 给通用树遍历用的最小接口", tag: 8 行, tone: muted }
  - { title: index.ts, desc: 统一出口，把上面这些 + dialect + utils 一起导出, tag: 12 行, tone: green }
```

### `src/utils/` —— 两个防坑小工具

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

### `src/dialect/` —— 方言

```cards
cols: 2
items:
  - { title: interface.ts, desc: "**SqlDialect 接口**，14 个方法：类型转换、JSON 数组、时间范围、多条件选择、正则匹配…", tag: 59 行, tone: violet }
  - { title: bytehouse.ts, desc: ByteHouse 实现（`UNIX_TIMESTAMP(...) * 1000`、`DS_DATETIME_ADD`、`match()` 这类专属函数）, tag: 111 行, tone: blue }
  - { title: doris.ts, desc: Doris 实现（与 ByteHouse 同名方法，内部写法不同）, tag: 139 行, tone: blue }
  - { title: where-sql.ts, desc: "从完整 SELECT 里把 **WHERE 之后**的部分抠出来。用于「只想要 where 片段」的场景", tag: 32 行, tone: muted }
  - { title: spark-array-contains.ts, desc: "把 `array_contains(field, v)` 组合成 IN / NOT IN 语义（多个用 OR，取反用 NOT(OR)）", tag: 35 行, tone: muted }
  - { title: index.ts, desc: 出口, tag: 3 行, tone: muted }
```

## 04 · `packages/crowd` —— 主体

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

## 05 · `packages/goods` + 根级目录

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

## 06 · 我想改 X，去哪个文件

==这是整篇最该收藏的一张表。==

```compare
first: 我想改…
head: [去这个文件, 找什么]
rows:
  - 加一种数据库: ["core/src/dialect/interface.ts", "先实现 SqlDialect 全部 14 个方法"]
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

## 07 · 推荐的看代码顺序

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

## 08 · 自测

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
    1. `core/src/dialect/` 加一个实现 `SqlDialect`（14 个方法）
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
