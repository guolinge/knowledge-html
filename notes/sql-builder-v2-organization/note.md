```callout
tone: blue
icon: 🧭
text: |
  前置是 [① 概念篇](../sql-builder-v2-concepts/) —— 你应该已经知道圈人、画像、事件、条件树是什么。

  这篇回答一个问题：==这些代码放在哪、怎么分的？==

  读完你应该能说出：「三个包，core 是通用翻译器，crowd 是业务主体，goods 是商品域」。
  再往下读 [③ 架构篇](../sql-builder-v2-architecture/)，看它们怎么配合工作。
```

## 01 · 一个仓库，三个包

先看这个仓库长什么样：

```tree
- label: sql_builder_v2/
  tone: violet
  note: 一个仓库，装三个 npm 包
  children:
    - label: packages/
      note: 三个包都在这
      children:
        - { label: core/, note: "通用层 —— 不知道任何业务词汇" }
        - { label: crowd/, note: "业务层 —— 用户域圈人，代码最多" }
        - { label: goods/, note: "业务层 —— 商品域，另一条平行的线" }
    - label: types/
      note: "⚠ 构建产物，不是源码"
    - label: pnpm-workspace.yaml
      note: 声明哪些目录是包 + 版本表
    - label: tsconfig.base.json
      note: 三个包共享的 TS 配置
    - { label: package.json, note: "只有 workspace 脚本" }
```

### 先搞清三个词

| 词 | 在这里是什么意思 |
|---|---|
| **monorepo** | 一个仓库里装多个包。这就是这个仓库的形态 |
| **workspace** | monorepo 的具体实现方式。由 `pnpm-workspace.yaml` 声明 `packages/*` |
| **package** | 一个可独立发布的 npm 包，有自己的 `package.json` / 入口 / 依赖 |
| **catalog** | pnpm 的版本统一机制。版本写一次，各包用 `catalog:` 引用 |

```callout
tone: violet
icon: 💡
text: |
  **所以 `packages/core` 不是一个「目录」，是一个能单独发布的包。**

  它有自己完整的 `package.json`：包名 `@futu/sql-builder-core`、版本 `1.0.3`、
  入口 `./lib/index.js`、能 `npm publish`。

  ==「目录」和「包」的区别很重要== —— 后面讲依赖时全靠这个区分。
```

## 02 · 三个包的分工

```compare
first: 维度
head: ["packages/core", "packages/crowd", "packages/goods"]
rows:
  - 包名: ["`@futu/sql-builder-core`", "`@futu/sql-builder-crowd`", "`@futu/sql-builder-goods`"]
  - 定位: [通用 SQL 构造, 用户域圈人, 商品域圈选]
  - 知道业务吗: [{ text: "完全不知道", tone: green }, 知道，大量业务枚举, 知道商品域概念]
  - 依赖谁: ["knex", "core + knex + lodash + murmurhash + mysql2", "core + type-fest"]
  - 代码量: ["1347 行 / 13 文件", { text: "4475 行 / 27 文件", tone: blue }, "1380 行 / 19 文件"]
```

==crowd 是这个仓库的主体==（代码量是另外两个的三倍多），core 是它的地基，goods 是另一条平行的线。

### 为什么拆成三个包

```cards
cols: 3
items:
  - title: core 为什么独立
    tag: 通用
    tone: green
    desc: |
      **它不知道任何业务词汇** —— 没有「画像」「事件」「人群包」这些概念，
      只有「条件树」「表达式」「SQL 片段」。

      这样换一种业务场景时，core 一行都不用改。
    code: |
      core 认识的：
        { logic: 'AND', items: [...] }
        { op: 'Gt', column: 'x', value: 3 }
  - title: crowd 为什么独立
    tag: 业务主体
    tone: violet
    desc: |
      用户域的业务逻辑：六种条件、AND/OR 的集合运算、
      事件表分片、uid 加解密。

      **这些全是业务特有的**，换个业务就没有了，所以不该塞进 core。
    code: |
      crowd 认识的：
        { op: 'IN', name: 'city', value: ['杭州'] }
        { eventName: '加购', timeRange: '最近7天' }
  - title: goods 为什么独立
    tag: 另一条线
    tone: amber
    desc: |
      商品域的条件体系。**它和 crowd 没有关系** —— 不复用 crowd 的任何类型，
      自己定义了一套 `JsonCondition`。
    code: |
      goods 认识的：
        JsonConditionLeaf
        JsonConditionBranch
```

````callout
tone: red
icon: ⚠
quote: true
text: |
  ==最容易搞错的一点：`crowd` 和 `goods` 互不依赖。==

  它们都只依赖 `core`，但**彼此之间没有任何引用**。
  各自定义自己的一套条件类型，各自有自己的 entrepot。

  ```
  core ──┬──→ crowd
         └──→ goods
  ```

  **`crowd` 和 `goods` 之间没有箭头。** 所以「这个库有六种条件」
  这句话只对 crowd 成立 —— goods 只有两种（content / security），
  用的是完全不同的类型体系。
````

## 03 · 包里面长什么样

三个包的骨架**大体一致**（goods 有几个差异，下一节说）：

```text
packages/<包名>/
├─ src/                ← 源码。你只改这里
├─ test/               ← 测试
├─ typings/            ← 给第三方库补的类型声明
├─ package.json        ← 包名 / 入口 / 依赖 / 脚本
├─ tsconfig.json       ← 开发用（noEmit，只做类型检查）
└─ tsconfig.prod.json  ← 构建用（真正产出 js）
```

构建后会多出两个目录（已 gitignore，不用管）：

| 目录 | 内容 | 谁在用 |
|---|---|---|
| `lib/` | 编译后的 `.js` | Node 运行时。`package.json` 的 `main` 指向它 |
| `types/` | 编译后的 `.d.ts` | TypeScript 使用者。`package.json` 的 `types` 指向它 |

```callout
tone: amber
icon: ⚠
text: |
  **`typings/` 和 `types/` 只差一个字母，但是两个完全不同的东西：**

  | | 是什么 | 要提交吗 |
  |---|---|---|
  | `typings/` | **手写的**类型补丁 | ✅ 是源码 |
  | `types/` | **编译生成的**声明 | ❌ 是产物 |

  这里 `typings/knex.d.ts` 补的是 `DB.rawQuery()` ——
  因为 core 往 knex 的原型上挂了自定义方法，TypeScript 不认识，得手工补一条声明。

  ==手改 `types/` 没用，下次构建会被覆盖。==
```

## 04 · 每个包装了什么

### `packages/core` —— 通用层（1347 行 / 13 文件）

```tree
- label: core/src/
  tone: green
  note: 不认识任何业务词汇
  children:
    - { label: db.ts, note: "表达式树 → WHERE 子句。最核心的一个文件" }
    - { label: utils.ts, note: "杂物抽屉：时间表达式 + uid 编解码 + 树压缩" }
    - { label: tree.ts, note: 树的通用工具 }
    - { label: define.ts, note: 枚举与常量 }
    - { label: index.ts, note: 包的入口 }
    - label: dialect/
      note: 数据库方言
      children:
        - { label: interface.ts, note: "17 个方法的接口" }
        - { label: bytehouse.ts, note: ByteHouse 实现 }
        - { label: doris.ts, note: Doris 实现 }
```

### `packages/crowd` —— 业务主体（4475 行 / 27 文件）

```tree
- label: crowd/src/
  tone: violet
  note: 用户域圈人的全部业务逻辑
  children:
    - { label: entrepots/, note: "★ 六种条件各一个实现。代码最多的地方" }
    - { label: combi/, note: "AND / OR 怎么变成集合运算；include / exclude" }
    - { label: modules/, note: "对外模块。调用方从这里进" }
    - { label: ast/, note: "Doris / Signal 的语法树处理" }
    - { label: dialect/, note: "crowd 自己的方言扩展（事件表定位）" }
    - { label: context.ts, note: "选方言、构造模块，之后一路传下去" }
    - { label: define.ts, note: "业务枚举全在这 45 行里" }
    - { label: index.ts, note: 包的入口 }
```

### `packages/goods` —— 商品域（1380 行 / 19 文件）

```tree
- label: goods/src/
  tone: amber
  note: 和 crowd 平行，互不依赖
  children:
    - { label: entrepots/, note: "只有两种：content / security" }
    - { label: types/, note: "自己的条件类型体系 JsonCondition" }
    - { label: combi/, note: 条件组合 }
    - { label: modules/, note: "对外模块 GoodsQuery" }
    - { label: utils/, note: "北京日历、JSON 条件节点处理" }
    - { label: constants/, note: 常量 }
```

## 05 · 三个包的规范并不统一

```callout
tone: amber
icon: ⚠
text: |
  ==这三个包不是一次成型的，是逐步演进的 —— 所以规范不一致。==

  别以为它们是同一个模板生成的。**改代码前先看清你在哪个包里。**
```

```compare
first: 维度
head: [core, crowd, goods]
rows:
  - 测试框架: ["jest 29", "jest（但**没声明**）", { text: "vitest 3", tone: violet }]
  - 配置文件: ["babel.config.js + jest.config.js", "同左", { text: "vitest.config.ts", tone: violet }]
  - devDependencies: ["4 个（jest / ts-jest / typescript / @types/node）", { text: "**一个都没有**", tone: red }, "4 个（vitest / tsx / typescript / @types/node）"]
  - 依赖版本写法: ["硬编码 `^1.0.2`", "用 `catalog:`", "硬编码 `^4.41.0`"]
```

````callout
tone: red
icon: ⚠
text: |
  **crowd 的 `package.json` 里一个 devDependencies 都没有** ——
  但它有 `jest.config.js`、`babel.config.js`，脚本里也写着：

  ```
  "test:unit": "jest test"
  "lint":      "eslint src test"
  "check":     "tsc --noEmit"
  ```

  ==这些工具都没被声明。== 它们能跑起来，是因为被别处带进来的。

  改 crowd 的构建/测试配置时要注意这一点 —— 它不像另外两个包那样自给自足。
````

## 06 · 根级目录

```compare
first: 根级文件
head: [是什么, 要不要动]
rows:
  - "`pnpm-workspace.yaml`": ["包列表 + **catalog 版本表**", { text: 要改, tone: blue }]
  - "`tsconfig.base.json`": ["三个包共享的 TS 配置。`declarationDir: ./types` 决定了根级 `types/` 是产物", { text: 要改, tone: blue }]
  - "`types/`": [{ text: "**构建产物**，不是源码", tone: red }, { text: 不要动, tone: red }]
  - "`package.json`": ["只有 workspace 脚本（build / test / lint 都是 `pnpm -r` 递归）", 参考]
  - "`.eslintrc.js` / `.prettierrc`": ["lint 和格式化规则（4 空格缩进、单引号）", 参考]
  - "`.npmrc`": ["私有 registry 地址 + `git-checks=false`", 参考]
  - "`README.md`": [{ text: "说明这是个**拆分骨架**。**可能落后于实际代码**", tone: amber }, 参考]
```

```callout
tone: amber
icon: ⚠
text: |
  **`README.md` 写着这是个「拆分骨架」，但实际代码已经长得比它描述的多得多。**

  ==文档会过期，代码不会。== 以 `packages/*/src/` 为准。
```

### 版本写在哪儿：catalog

`crowd/package.json` 里写的是 `"knex": "catalog:"` 而不是具体版本号 ——
版本统一在 `pnpm-workspace.yaml` 的 `catalog:` 段里定义：

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
tone: red
icon: ⚠
text: |
  ==但只有 `crowd` 用了 catalog。==

  - `core` 写的是 `"knex": "^1.0.2"`（硬编码）
  - `goods` 写的是 `"type-fest": "^4.41.0"`（硬编码）

  所以 catalog 在这个仓库里**不是统一机制**，只在一个包上用。
  要改版本，别只改 `pnpm-workspace.yaml` —— 先看对应包的 `package.json`。
```

## 07 · 依赖怎么看：主动 vs 被动

看 `crowd` 的依赖表，会看到六个名字。它们**不是一类东西**：

```compare
first: 依赖
head: [在 src/ 里能搜到 import 吗, 它决定了什么]
rows:
  - knex: [{ text: "能，3 处（都是拿类型）", tone: green }, "SQL 怎么拼出来"]
  - murmurhash: [{ text: "能，1 处（决定分片）", tone: green }, "事件去哪个分片"]
  - lodash: [{ text: "能，2 处（只用 cloneDeep）", tone: green }, "不改坏调用方传进来的对象"]
  - mysql2: [{ text: "**搜不到**", tone: amber }, "能不能连上库（knex 的底层驱动）"]
  - tslib: [{ text: "**搜不到**", tone: amber }, "编译后的 JS 能不能跑（辅助函数）"]
```

```callout
tone: green
icon: ✅
text: |
  **看依赖表时先分这两类：**

  - **主动依赖** —— 决定**代码怎么写**。在 `src/` 里能搜到 `import`
  - **被动依赖** —— 只决定**能不能跑起来**。搜不到，但删了就会挂

  ==`mysql2` 和 `tslib` 在 `src/` 里一处都搜不到，但它们是必需的。==

  所以「这个库用了哪些库」这个问题，答案取决于你问的是哪一种。
```

## 08 · 从哪开始读

```callout
tone: green
icon: ✅
text: |
  ==**前五步加起来不到 600 行**，就能把主干搞懂。==

  剩下 1600 多行是「同一套模式的重复应用」—— 看懂最容易的那种，
  其他只是细节不同。
```

```lane-stack
- badge: STEP 01
  title: 先看词汇表
  desc: 43 行，一次看完
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
  desc: 只读最短的那个，跳过最长的
  tone: blue
  nodes:
    - { title: crowd/src/modules/crowd.ts, sub: "59 行，list / count 两步" }
    - { title: modules/segmentation.ts, sub: "324 行 —— 先跳过" }
  next: "进组合层 :: :: 最核心的机制"

- badge: STEP 04
  title: 看组合层
  desc: 这里藏着最反直觉的设计
  tone: violet
  nodes:
    - { title: combi/combination.ts, sub: "165 行，UNION ALL + HAVING" }
    - { title: combi/pkg.ts, sub: "123 行，include / exclude" }
    - { title: combi/utils.ts, sub: "381 行 —— 只看 treeSimplifier，其余是历史包袱" }
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
    - { title: "event.ts / relation.ts", sub: "906 + 715 行 —— 业务细节堆叠，最后看", tone: red }
```

```callout
tone: violet
icon: 💡
text: |
  **为什么先看 `portrait.ts`？**

  它是最小完整样本：**递归 + 时间展开 + 五个出口**，一样不缺。
  ==看懂它之后，`event.ts` 和 `relation.ts` 只是「同样的模式 + 更多分支」。==
```

## 09 · 我想改 X → 去哪个文件

```callout
tone: green
icon: ✅
text: |
  ==这是全篇最该收藏的一张表。==
```

```callout
tone: amber
icon: ⚠
text: |
  **表里有些名字（`list` / `count` / `buildWhere` / `getTimeRules`）要到后面几篇才展开讲。**

  现在不用看懂它们是干什么的 —— 先知道==「有这么个东西、在那个文件里」==就够了。
  以后真要去改的时候，直接回来查这张表。
```

```compare
first: 我想改…
head: [去这个文件, 找什么]
rows:
  - 加一种数据库: ["`core/src/dialect/interface.ts`", "先实现 SqlDialect 全部 17 个方法"]
  - 同上（事件表定位）: ["`crowd/src/dialect/interface.ts` + `bytehouse.ts` / `doris.ts`", "再实现 getEventTable"]
  - 同上（挂上去）: ["`crowd/src/context.ts`", "在 `_resolveDialect` 的 switch 加一个 case"]
  - 加一种条件类型: ["`crowd/src/define.ts`", "Entrepots 枚举加值"]
  - 同上（写实现）: ["`crowd/src/entrepots/<新文件>.ts`", "实现 `list` / `count` 两个方法"]
  - 同上（注册）: ["`crowd/src/entrepots/factory.ts`", "两个 switch 各加一个 case"]
  - 改 AND / OR 的语义: ["`crowd/src/combi/combination.ts`", "combineSql 里的 HAVING 那段"]
  - 改 include / exclude: ["`crowd/src/combi/pkg.ts`", "`include()` / `exclude()`"]
  - 改表名或字段名: ["`crowd/src/define.ts`", "Tables / UidFields 枚举"]
  - 改「最近 N 天」的算法: ["`core/src/utils.ts`", "getTimeRules / generateLatestDaysRules"]
  - 改 uid 加解密: ["`core/src/utils.ts`", "encodeUid / decodeUid / noDecodedSqlGen"]
  - 改 SQL 里的列名引号: ["`core/src/db.ts`", "DB.formatField"]
  - 改表达式树怎么展开成 WHERE: ["`core/src/db.ts`", "DB.buildWhere"]
  - 加一个对外模块: ["`crowd/src/modules/<新文件>.ts`", "照抄 CrowdModule 的骨架"]
  - 改事件表分片规则: ["`crowd/src/dialect/bytehouse.ts`", "getEventTable 里的 murmurhash"]
  - 改业务枚举: ["`crowd/src/define.ts`", "全部在这 45 行里"]
```

## 10 · 自测

```quiz
- q: 为什么 core 要独立成一个包？
  a: |
    因为它**不知道任何业务词汇** —— 没有「画像」「事件」「人群包」这些概念，
    只有「条件树」「表达式」「SQL 片段」。
    这样换一种业务场景时，core 一行都不用改。

- q: 「这个库有六种条件」这句话准确吗？
  a: |
    **只对 crowd 成立。** crowd 和 goods 互不依赖，各自定义自己的条件体系：
    crowd 有六种（画像/事件/关系/人群包/uid/rawSql），
    goods 只有两种（content / security），用的是完全不同的 `JsonCondition` 类型。
    它们都只依赖 core，但彼此之间没有任何引用。

- q: "`typings/` 和 `types/` 有什么区别？"
  a: |
    `typings/` 是**手写的**类型补丁（源码，要提交）；
    `types/` 是**编译生成的**声明（产物，不提交）。
    这里 `typings/knex.d.ts` 补的是 `DB.rawQuery()` —— 因为 core 往 knex 原型上挂了
    自定义方法，TypeScript 不认识。手改 `types/` 没用，下次构建会被覆盖。

- q: "`mysql2` 在 `src/` 里一处都搜不到，为什么它还在依赖表里？"
  a: |
    它是**被动依赖** —— 决定「能不能跑起来」，而不是「代码怎么写」。
    `mysql2` 是 knex 用 `client: 'mysql'` 时的底层驱动，knex 自己把它列为可选依赖。
    `tslib` 同理：`importHelpers: true` 让编译产物 `require('tslib')` 拿辅助函数。
    ==主动依赖在 src 里能搜到，被动依赖搜不到但删了就会挂。==

- q: 要改「最近 N 天」的算法，去哪个文件？
  a: |
    `core/src/utils.ts` 里的 `getTimeRules` / `generateLatestDaysRules`。
    注意它同时被两条路径调用（普通条件 和 事件条件），改之前先确认两条都考虑到。
```
