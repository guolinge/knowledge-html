```callout
tone: blue
icon: 🧭
text: |
  前置是 [② 组织篇](../sql-builder-v2-organization/) 和 [③ 架构篇](../sql-builder-v2-architecture/)。

  架构篇讲的是整条链路。这篇**钻进 `packages/core` 里面**，按同样的六层走一遍。

  读完你应该能说出：「==它是个不懂业务的翻译器，而且被两个互不依赖的包各自用着不同的部分。==」
```

## 01 · 它是什么：一个不懂业务的翻译器

```compare
first: 维度
head: [core, crowd]
rows:
  - 认识的输入: ["`Rule[]` —— 一棵纯数据的表达式树", "六种业务条件"]
  - 认识业务词吗: [{ text: "一个都不认识", tone: green }, 认识，且有 45 行业务枚举]
  - 干的活: ["把表达式树**编译成 SQL**", "把业务条件**翻译成**表达式树"]
  - 依赖谁: [{ text: "只有 knex", tone: green }, "core + lodash + murmurhash"]
  - 代码量: ["1347 行 / 13 文件", "4475 行 / 27 文件"]
```

### 验证它「不懂业务」的方法

```bash
# 在 core 里搜业务词，一个都搜不到
grep -rn 'portrait\|event_v2\|crowd\|加购' packages/core/src/
# → 空
```

```callout
tone: green
icon: ✅
text: |
  ==这条边界是整个架构可扩展性的来源。==

  守住它，加一种数据库不用碰 crowd，加一种业务条件不用碰 core。
  （架构篇第 07 节讲过。）
```

### 但它服务两个消费者

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==**`core` 不只为 `crowd` 服务。**==

  还记得组织篇讲的吗 —— `crowd` 和 `goods` **互不依赖**，但都依赖 `core`。
  所以 core 的通用性是被**验证过**的，不是设计者的一厢情愿。
```

```compare
first: 包
head: [从 core 导入了几个名字, 用的是哪些能力]
rows:
  - crowd: [{ text: "41 个", tone: blue }, "方言、操作符枚举、时间表达式、uid 编解码、树压缩 —— **几乎全套**"]
  - goods: [{ text: "6 个", tone: green }, "`DB` / `Logic` / `Op` / `Rule` + 两个数组条件辅助"]
```

```callout
tone: amber
icon: ⚠
text: |
  **两个消费者用的能力几乎不重叠。**

  goods 只拿 `DB` 和几个枚举，再用两个专门给它准备的函数
  （`buildWhereSqlFromRules` / `buildArrayContainsScalarRules`）——
  这两个函数 **crowd 一次都没用过**。

  ==所以它们虽然是「通用层」的代码，实际只服务一个消费者。==
  这是边界上一处温和的渗漏。
```

## 02 · 组织：`core/src` 里有什么

13 个文件、1347 行。按职责分六块：

```lane-stack
- title: 表达式模型 + 翻译器
  desc: 唯一的「核心」，235 行
  tone: green
  nodes:
    - { title: db.ts, sub: "四种形态 + buildWhere + knex 扩展" }
  next: "工具集 :: :: 675 行，其实是个杂物抽屉"

- title: 工具集
  desc: 时间 / uid / 树压缩 / 标签表
  tone: muted
  nodes:
    - { title: utils.ts, sub: "675 行 · 最大的一块" }
    - { title: utils/, sub: "两个小函数：编码值 / 防注入" }
  next: "方言 :: :: 所有库差异都收在这里"

- title: 方言
  desc: 接口 + 两个实现 + 两个辅助
  tone: amber
  nodes:
    - { title: interface.ts, sub: "59 行 · 17 个方法" }
    - { title: bytehouse.ts, sub: "111 行" }
    - { title: doris.ts, sub: "139 行" }
    - { title: "spark-array-contains / where-sql", sub: "两个独立辅助" }

- title: 骨架
  desc: 类型和枚举，加起来 27 行
  tone: muted
  nodes:
    - { title: index.ts, sub: "13 行 · 出口" }
    - { title: tree.ts, sub: "8 行 · 一个类型" }
    - { title: define.ts, sub: "6 行 · 一个枚举" }
```

```callout
tone: amber
icon: ⚠
text: |
  **`utils.ts` 是个杂物抽屉。** 675 行里塞了四类互不相关的东西：

  | 内容 | 大概行数 | 谁在用 |
  |---|---|---|
  | 时间表达式 | ~300 行 | crowd 的三种条件 |
  | uid 编解码 | ~80 行 | crowd 全部条件 |
  | 树压缩 `treeMinimizer` | ~50 行 | crowd 的 combi |
  | 标签表 `buildLabelTable` | 剩下的 | **只有 crowd 的 segmentation** |

  ==最后一项严格说不属于「通用层」== —— 它是分群专用的。
```

### 骨架文件有多小

```text
// tree.ts（全文 8 行）
export type TreeForkKey = 'items' | 'conditions';
export interface GeneralTree {
    items?: GeneralTree[];
    conditions?: GeneralTree[];
    [key: string]: any;
}
```

```callout
tone: violet
icon: 💡
text: |
  **8 行，但它解决了一个真问题。**

  树的分支字段有两种名字：`items`（条件树用）和 `conditions`（组合树用）。
  树压缩函数要对两种都工作，所以需要这个类型把「两种都算树」这件事表达出来。

  ```text
  // combi/combination.ts
  treeMinimizer(tree, 'conditions')
  // combi/utils.ts
  treeMinimizer(tree, 'items')
  ```

  ==第二个参数就是 `TreeForkKey`。==
```

```text
// define.ts（全文 6 行）
export enum DbType {
    MySql = 'mysql',      // 作为历史枚举值保留，仅在 getStringArrayRule() 和
                          // buildDetailWhereClause() 中使用
    Bytehouse = 'bytehouse',
    Doris = 'doris'
}
```

```callout
tone: amber
icon: ⚠
text: |
  ==注意注释里那句话：「作为**历史枚举值**保留」。==

  `MySql` 已经不是一等公民了 —— 它只在两个函数里被分支判断。
  这是「曾经支持三个库，现在只用两个」留下的痕迹。

  看到这种注释，就知道**别在它上面加新功能**。
```

## 03 · 架构：一条 `Rule` 进去，SQL 出来

`core` 的主干只有一个函数：`DB.buildWhere`。

```flow
grid: true
nodes:
  - { id: in, label: "buildWhere(builder, rules, logic)", sub: "一棵 Rule 数组", row: 0, kind: backend }
  - { id: loop, label: 遍历每条 rule, row: 1, tone: violet }
  - { id: q, label: "有 'logic'？", sub: "是树枝还是叶子", row: 2, tone: amber, shape: note }
  - { id: sub, label: "whereFn(sub => 递归)", sub: "建一层括号往下钻", row: 3, tone: violet }
  - { id: expr, label: "whereFn(column, op, value)", sub: "挂到 knex 上", row: 3, tone: green }
  - { id: bad, label: throw, sub: "结构错误", row: 3, tone: red }
  - { id: out, label: knex builder, row: 4, kind: database }
edges:
  - { from: in, to: loop }
  - { from: loop, to: q }
  - { from: q, to: sub, label: "是" }
  - { from: q, to: expr, label: "否" }
  - { from: q, to: bad, label: "都不是", dashed: true }
  - { from: sub, to: out }
  - { from: expr, to: out }
```

**AND / OR 的实现就是「选哪个方法名」**：

```text
function getWhereFn(builder, logic) {
    switch (logic) {
        case Logic.And: return builder.andWhere.bind(builder);
        case Logic.Or:  return builder.orWhere.bind(builder);
        default: throw new Error(`getWhereFn: 条件错误："logic: ${logic}"`);
    }
}
```

```callout
tone: violet
icon: 💡
text: |
  ==**没有别的魔法。**== `AND` 就是 `andWhere`，`OR` 就是 `orWhere`。

  嵌套靠的是 `whereFn(sub => DB.buildWhere(sub, rule.items, rule.logic))` ——
  传一个回调进去，knex 会把它包成括号。
```

### 四种形态各落到哪

```compare
first: 形态
head: [列名怎么来, 值怎么来, 落到 knex 的]
rows:
  - Normal: ["`DB.raw(formatField(column))` 包反引号", "`encodeValue(value)`", "`whereFn(列, op, 值)`"]
  - RawValue: ["同上", "`DB.raw(rawValue)`", "同上"]
  - RawColumn: ["`DB.raw(rawColumn)`", "`encodeValue(value)`", "同上"]
  - Raw: ["—", "`encodeValue(value)` 透传绑定", "`whereRaw(raw, value)`"]
```

```callout
tone: amber
icon: ⚠
text: |
  **四种形态的展开在 [⑤ Rule[] 篇](../sql-builder-v2-core-rule/)。**

  这篇只需要知道：`buildWhere` 是**一个递归函数 + 一张判别表**，
  ==没有别的复杂度。==
```

## 04 · 细节：`db.ts` 里的三件小事

### ① `rawQuery()` 是挂在 knex 原型上的

```text
Object.assign(mysql.queryBuilder().constructor.prototype, {
    rawQuery() {
        return this.toString().trim();
    }
});
```

代码注释解释了**为什么不用官方的扩展方式**：

```text
Q: 为什么不用 knex.QueryBuilder.extend?
A: 因为 extend 的方法的返回值必须是 builder 实例

注: mysql(name) 与 mysql.queryBuilder() 共享同一个 Builder.prototype，
    因此挂载一次即可被两种入口创建的实例访问到。
```

```callout
tone: violet
icon: 💡
text: |
  **为什么不直接用 `toString()`，要包一层 `rawQuery()`？**

  因为 `toString()` 在别的地方也有意义，而这个库对外只交付**字符串**。
  包一层等于给这个约定一个名字。

  ==代价是 TypeScript 不认识它，得手写声明 —— 就是 `typings/knex.d.ts`。==
  （组织篇讲过 `typings/` 和 `types/` 的区别。）
```

### ② 一个被注释掉的历史处理

```text
rawQuery() {
    // 移除多余的括号的处理，因为逻辑为对 str 直接处理，
    // 可能在外出传入内容包含括号的时候出现 bug
    // 后续如果确实想要处理多余括号，可能要走 sql 解析的方式
    // -- 2026-01-19 修改
    // return removeSQLExcessiveBrackets(this.toString()).trim();
    return this.toString().trim();
}
```

```callout
tone: amber
icon: ⚠
text: |
  ==**这段注释比代码值钱。**==

  它记录了：曾经有个「去掉多余括号」的处理，但因为**字符串处理会误伤**
  （用户传进来的内容里本来就有括号），所以撤掉了。

  还写了「后续如果确实想要处理多余括号，可能要走 SQL 解析的方式」——
  等于给未来的人留了方向。

  ==看到带日期的注释，先读一遍再动手。==
```

### ③ `DB.getInstance()` 有两种入口

```text
static getInstance(name?: string) {
    return name ? mysql(name) : mysql.queryBuilder();
}
```

```compare
first: 调用
head: [返回什么, 谁在用]
rows:
  - "`DB.getInstance()`": ["一个**空白** builder，从零开始拼", "组合层（拼 UNION ALL）"]
  - "`DB.getInstance('user_portrait')`": ["一个**已指定表**的 builder", "条件实现（查某张表）"]
```

## 05 · 细节：两个和注入有关的安全处理

`utils/` 目录下只有两个文件，加起来 31 行 —— **但都和 SQL 注入有关**。

### `encodeValue` —— 避免 `?` 和 knex 占位符冲突

```text
const sqlBuilderQuestionMark = 'SQL_BUILDER_QUESTION_MARK';

/** 与 sql-builder 一致：避免绑定串中的 `?` 与 knex 占位冲突 */
export function encodeValue(value) {
    if (typeof value === 'string' && value.includes('?')) {
        return value.replace(/\?/g, sqlBuilderQuestionMark);
    }
    return value;
}
```

```callout
tone: red
icon: ⚠
text: |
  ==**这不是转义，是「换一个字符」。**==

  knex 用 `?` 当参数占位符。如果一个**值**里带 `?`（比如用户搜 `"什么?"`），
  knex 会把它当成占位符，绑定参数的数量就对不上了 —— SQL 直接报错。

  所以这里把值里的 `?` 替换成一个不会撞车的长字符串。

  ==真正的转义是 knex 的参数绑定做的，不是这个函数。==
```

### `assertSqlSafeArrayValues` —— 数组值不能有单引号

```text
/**
 * 校验将被直接拼进 SQL 字符串字面量的数组值，含单引号则抛错。
 *
 * 背景：stringArray 的值会被拼进 SQL 字符串字面量（如 JSONExtract('[...]')、
 * CAST('[...]')），而 gateway 不支持 array() 等参数绑定写法、
 * 也无法解析反斜杠双写转义。在拼接前拦截含单引号的值，
 * 避免破坏 SQL 边界（注入 / 语法错误）。
 */
export function assertSqlSafeArrayValues(values) {
    const invalidValue = values.find((v) => v.includes("'"));
    if (invalidValue !== undefined) {
        throw new Error(`SQL 数组值不允许包含单引号：${invalidValue}`);
    }
}
```

````callout
tone: red
icon: ⚠
quote: true
text: |
  ==**这段注释把「为什么参数绑定不够用」讲清楚了。**==

  正常情况下，值都走参数绑定（`?`），不会注入。
  但**数组类型的值是个例外** —— 它要拼进字符串字面量：

  ```
  JSONExtract('[{"a":1}]')     ← 整个数组是一个字符串
  ```

  而 gateway **不支持数组的参数绑定**，也**解析不了反斜杠转义**。

  ==于是只剩一条路：拼之前检查，有单引号就拒绝。==
````

```callout
tone: green
icon: ✅
text: |
  **这是「纵深防御」的典型写法。**

  它不是主防线（主防线是参数绑定），而是**在一条不得不拼接的路径上加一道闸**。

  而且它选择了 **throw 而不是转义** ——
  因为转义方式依赖 gateway 的解析能力，说不准就漏。
  ==拒绝比「猜怎么转义」安全。==
```

## 06 · 取舍：为什么方言只返回片段

架构篇讲过这个结论，这里从 **core 的视角**再讲一遍。

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**方言方法不生成 SQL，只返回「片段」或「表达式节点」。**==

  真正把表达式树变成 SQL 的，是 `buildWhere` + knex。
```

**为什么这么设计**：

```cards
cols: 2
items:
  - title: 如果方言生成 SQL
    tag: 反事实
    tone: red
    desc: |
      那每个方言方法都要知道：怎么包反引号、怎么处理绑定、
      怎么处理嵌套括号 —— 也就是**重新实现一遍 buildWhere**。

      而且两个实现要各写一遍，很容易不一致。
    code: |
      方言方法的签名会变成：
        buildWhere(rules, logic) => string
      而不是：
        mapPropertyAccess(...) => string
  - title: 现在的做法
    tag: 实际
    tone: green
    desc: |
      方言只回答「**这一种语义在你们库怎么写**」，
      剩下的组装交给唯一的翻译器。

      **差异被压缩成 17 个小问题的答案。**
    code: |
      mapPropertyAccess(mapColumn, key)
        ByteHouse → mapElement(`x`, 'a')
        Doris     → ELEMENT_AT(`x`, 'a')
```

````callout
tone: violet
icon: 💡
text: |
  **这个设计的代价是：调用方要自己把片段组装起来。**

  所以 `crowd` 里到处是这种代码：

  ```
  timeExprs = this._dialect.getRelativeTimestampRules({...});
  const timeRules = addHackRules(rule.name, rule.op, timeExprs);
  result.push({ logic: Logic.And, items: timeRules });
  ```

  ==方言给了原料，`crowd` 负责炒。== 这是架构篇说的「裂缝」的另一面 ——
  它让 core 保持了干净，但让 crowd 多了点组装工作。
````

## 07 · 自测

```quiz
- q: "怎么验证 core 真的「不懂业务」？"
  a: |
    在 `packages/core/src/` 里搜业务词（`portrait` / `event_v2` / `crowd` / 加购），
    一个都搜不到。
    这条边界是整个架构可扩展性的来源 —— 守住它，
    加一种数据库不用碰 crowd，加一种业务条件不用碰 core。

- q: "core 只服务 crowd 吗？"
  a: |
    **不是。** `crowd` 和 `goods` 互不依赖，但都依赖 core。
    crowd 从 core 导入 41 个名字（方言、操作符、时间、uid、树压缩，几乎全套），
    goods 只导入 6 个（`DB` / `Logic` / `Op` / `Rule` + 两个数组条件辅助）。
    ==两个消费者用的能力几乎不重叠==，所以 core 的通用性是被验证过的。

- q: "`encodeValue` 是在做 SQL 转义吗？"
  a: |
    **不是。** 它只是把值里的 `?` 替换成一个不会撞车的长字符串。
    因为 knex 用 `?` 当参数占位符，值里带 `?`（比如用户搜「什么?」）
    会让 knex 把绑定参数数量算错，SQL 直接报错。
    ==真正的转义是 knex 的参数绑定做的。==

- q: "为什么数组值需要 `assertSqlSafeArrayValues` 单独拦一道？"
  a: |
    正常情况下值都走参数绑定，不会注入。但**数组类型的值是个例外** ——
    它要拼进字符串字面量（`JSONExtract('[...]')`），
    而 gateway **不支持数组的参数绑定**，也**解析不了反斜杠转义**。
    所以只剩一条路：拼之前检查，有单引号就 throw。
    选 throw 而不是转义，是因为转义方式依赖 gateway 的解析能力，说不准就漏。

- q: "`tree.ts` 只有 8 行，它解决什么问题？"
  a: |
    树的分支字段有两种名字：`items`（条件树用）和 `conditions`（组合树用）。
    树压缩函数要对两种都工作，所以需要 `TreeForkKey` 这个类型
    把「两种都算树」表达出来。
    调用时第二个参数就是它：`treeMinimizer(tree, 'conditions')`。

- q: "为什么方言方法不直接生成 SQL？"
  a: |
    如果方言生成 SQL，每个方法都要知道怎么包反引号、怎么处理绑定、
    怎么处理嵌套括号 —— 等于**重新实现一遍 `buildWhere`**，而且两个实现各写一遍。
    现在的做法是：方言只回答「这一种语义在你们库怎么写」，
    组装交给唯一的翻译器。
    ==差异被压缩成 17 个小问题的答案。==
    代价是调用方要自己把片段组装起来（crowd 里到处是这种代码）。
```
