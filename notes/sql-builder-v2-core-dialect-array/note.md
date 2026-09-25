```callout
tone: blue
icon: 🧭
text: |
  前置是 [⑥ 方言篇](../sql-builder-v2-core-dialect/)。

  那篇讲「方言接口怎么设计的」。这篇讲**一个不走接口的东西** ——
  以及它为什么走不了。

  读完你应该能说出：「==不是重复实现，是接口只建模了一个维度。==」
```

## 01 · 概念：同一件事，两条路

「判断一个数组里有没有某个值」——这件事有两套实现：

```compare
first: 路径
head: [在哪, 怎么区分库, 被谁用]
rows:
  - "`SqlDialect.jsonArray*Rule`": ["`core/src/dialect/`", { text: "走接口，两个实现类", tone: green }, "`event.ts` —— 事件的**属性**"]
  - "`getStringArrayRule`": ["`core/src/utils.ts`", { text: "**按 dbType if/else**", tone: red }, "`relation.ts` —— 关系的**属性**"]
```

````callout
tone: red
icon: ⚠
quote: true
text: |
  ==**第二条路违反了方言层的初衷。**==

  方言层的意义就是「把这些 if/else 收拢到一处」，
  而 `getStringArrayRule` 又把 if/else 搬回了 `utils.ts`。

  ```text
  if (dbType === DbType.Bytehouse) { ... }
  else if (dbType === DbType.Doris) { ... }
  else if (dbType === DbType.MySql) { ... }
  else { throw new Error(`invalid dbType: ${dbType}`); }
````

## 02 · 组织：它其实是个 2×2

````callout
tone: violet
icon: 💡
quote: true
text: |
  ==**先别急着说「重复实现」。**==

  看它的签名 —— 比接口版**多一个参数**：

  ```text
  getStringArrayRule(op, columnName, value, dbType, columnType?)
                                                      ↑ 就是它
  ```

  `columnType` 是 `'array' | 'string'` ——
  ==「同一个语义」在底层有**两种存储形态**。==
````

**这个参数展开来，是一个 2×2 的矩阵**：

```compare
first: 库 × 存储
head: [columnType = 'array', columnType = 'string']
rows:
  - ByteHouse: ["`has(\\`col\\`, ?)`", "`has(splitByChar(',', \\`col\\`), ?)`"]
  - Doris: ["`ARRAY_CONTAINS(\\`col\\`, ?)`", "`find_in_set(?, \\`col\\`)`"]
  - MySql: [{ text: "—（没有 array）", tone: muted }, "`find_in_set(?, \\`col\\`)`"]
```

```callout
tone: violet
icon: 💡
text: |
  **「底层存的是数组，还是逗号分隔的字符串」——这是第二个维度。**

  - **数组**：`has(col, ?)` —— 直接问「这个数组里有吗」
  - **逗号分隔字符串**：`has(splitByChar(',', col), ?)` ——
    ==先按逗号切开，再问==

  同样的语义，两种存储，SQL 完全不一样。
```

### 而接口只建模了一个维度

```text
// core/src/dialect/interface.ts —— 没有 columnType 这种东西
jsonArrayContainsRule(field: string, values: string[]): Rule;
jsonArrayNotContainsRule(field: string, values: string[]): Rule;
jsonArrayEqualsRule(field: string, values: string[], op: Op.Eq | Op.NotEq): Rule;
```

````callout
tone: red
icon: ⚠
text: |
  ==**接口版的假设是「底层就是 JSON 数组」。**==

  看 ByteHouse 的实现就知道：

  ```text
  const convertedField = `assumeNotNull(JSONExtract(${field}, 'Array(String)'))`;
  ```

  它**无条件**把字段当 JSON 数组解析。所以接口里没有 `columnType` 的位置 ——
  ==它的设计前提里就没有「另一种存储形态」。==
````

## 03 · 架构：为什么它走不了接口

```callout
tone: green
icon: ✅
quote: true
text: |
  **这不是谁偷懒，是接口的形状装不下这个需求。**

  接口的抽象是「**一个语义 × N 个库**」。
  而 `getStringArrayRule` 面对的是「**一个语义 × N 个库 × 2 种存储**」。

  强行塞进接口会有两个后果：

  - 每个方法都多一个 `columnType` 参数 —— ==接口变丑，而且大部分实现用不上==
  - `jsonArray*Rule` 那三个方法的语义会变得模糊（它到底是「JSON 数组」还是「数组类属性」）
```

**调用点只有一个**：

```text
// crowd/src/entrepots/relation.ts
if (isContainOp(expr.op)) {
    return getStringArrayRule(
        expr.op,
        expr.name,
        (expr as StringArrayPropExpr).value,
        dbType,        // ← 从哪来的？
        'string'       // ← 硬编码
    );
}
```

```callout
tone: amber
icon: ⚠
text: |
  **注意两个细节，它们暴露了这条路的「旁路」性质：**

  ① `dbType` 是**作为参数传进 `Relation` 类**的，
  而不是从 dialect 实例上读（`this._dialect.name` 就能拿到）。

  ② `columnType` **硬编码成 `'string'`** ——
  虽然函数支持 `'array'`，但关系属性这里永远传字符串形态。

  ==所以它是「知道具体是哪个库」的人在写，而不是「知道有个方言接口」的人在写。==
```

### 两条路各自服务谁

```compare
first: 路径
head: [服务什么数据, 底层存什么, 谁来传 columnType]
rows:
  - 接口版: ["事件的属性（stringArray 类型 prop）", { text: "JSON 数组", tone: green }, { text: "不需要 —— 写死了", tone: muted }]
  - 裂缝版: ["关系的属性", { text: "数组 **或** 逗号分隔字符串", tone: amber }, "调用方传（这里硬编码 string）"]
```

```callout
tone: violet
icon: 💡
text: |
  ==**所以严格说它们不是「重复」，是「两个不同的需求碰巧长得像」。**==

  - 事件的属性：一定是 JSON 数组 → 接口能表达
  - 关系的属性：可能是两种形态 → 接口表达不了

  ==但它们的 SQL 片段高度重合（`has` / `ARRAY_CONTAINS` / `find_in_set`），
  所以看着像重复。==
```

## 04 · 细节：三个容易看漏的地方

### ① Doris 的 string 分支直接复用了 MySql 的实现

```text
function _getDorisStringArrayExpression(op, columnName, value, columnType) {
    if (columnType === 'array') {
        return { raw: `ARRAY_CONTAINS(${DB.formatField(columnName)}, ?)`, value };
    } else {
        // 逗号分隔字符串，使用 FIND_IN_SET（与 mysql 逻辑相同）
        return _getMysqlStringArrayExpression(op, columnName, value);
    }
}
```

```callout
tone: violet
icon: 💡
text: |
  **`find_in_set` 是 MySQL 的函数，Doris 也支持它。**

  所以这里不是「复制粘贴」，是**主动复用** —— 注释也写明了「与 mysql 逻辑相同」。

  ==这是三个 `_get*StringArrayExpression` 里唯一的跨库复用。==
```

### ② `find_in_set` 的参数顺序是反的

```text
function _getMysqlStringArrayExpression(op, columnName, value) {
    const _prefix = op === ContainOp.Has ? 'find_in_set' : 'not find_in_set';
    const raw = DB.raw(DB.formatField(columnName))
        .wrap(_prefix + '(?, ', ')')      // ← 注意这里
        .toQuery();
    return { raw, value };
}
```

拼出来是：

```sql
find_in_set(?, `col`)     -- 值在前，列名在后
```

```callout
tone: amber
icon: ⚠
text: |
  ==**这不是笔误。**==

  `FIND_IN_SET(str, strlist)` 的签名就是「**要查找的字符串在前，列表在后**」。

  对比一下别的分支：`has(\`col\`, ?)`、`ARRAY_CONTAINS(\`col\`, ?)` ——
  都是**列名在前**。

  ==所以这一个方法是反的，而且必须反。== 读代码时容易看漏。
```

### ③ 它有 `MySql` 分支 —— 说明年代更早

```text
} else if (dbType === DbType.MySql) {
    // ! 注意，mysql 场景的 Array，实际上是，用逗号分隔的字符串 String
    if (_v.length === 1) { ... }
```

```callout
tone: amber
icon: ⚠
text: |
  **而 `SqlDialect` 里根本没有 MySql 实现。**

  `DbType.MySql` 的注释写着「**作为历史枚举值保留**，
  仅在 `getStringArrayRule()` 和 `buildDetailWhereClause()` 中使用」。

  ==注意它点名了这两个函数== —— 也就是说，**整个仓库里只有这两个地方还认识 MySql**。
```

## 05 · 取舍：该不该统一

```compare
first: 方案
head: [怎么做, 代价]
rows:
  - 保持现状: ["两条路各管各的", { text: "看着乱，但两边行为明确", tone: amber }]
  - 合并到接口: ["给接口加 columnType 参数", { text: "==接口变丑，大部分实现用不上==", tone: red }]
  - 抽出第三个维度: ["把「存储形态」单独建模，像 `SqlDialect` 一样做成策略", { text: "干净，但要动 core + crowd 两层", tone: violet }]
```

```callout
tone: green
icon: ✅
text: |
  **看到这种「两套并存」，别急着统一。**

  先确认三件事：

  1. **它们的行为真的一样吗？** —— 这里不一样（一个假设 JSON 数组，一个支持两种存储）
  2. **合并会不会让接口变形？** —— 这里会（多一个大部分实现用不上的参数）
  3. **有没有人依赖旧路径的某个行为？** —— 这里可能有（`columnType` 硬编码成 `'string'`）

  ==三个答案都不利于合并，所以现状是合理的妥协。==
```

```callout
tone: violet
icon: 💡
text: |
  **真实代码库里，这种「看起来该统一、其实不该」的地方很多。**

  判断标准不是「代码整齐」，是「**改了会不会引入 bug**」。
  ==能说清为什么它长这样，比把它改整齐更重要。==
```

## 06 · 自测

```quiz
- q: "`getStringArrayRule` 和 `SqlDialect.jsonArrayContainsRule` 是重复实现吗？"
  a: |
    **不是。** 它们服务两个不同的需求：
    接口版服务「事件的属性」（一定是 JSON 数组），
    裂缝版服务「关系的属性」（可能是数组，也可能是逗号分隔字符串）。
    它们的 SQL 片段高度重合，所以看着像重复，但前提假设不一样。

- q: "`getStringArrayRule` 为什么走不了方言接口？"
  a: |
    因为它面对的是「**一个语义 × N 个库 × 2 种存储**」，
    而接口的抽象是「一个语义 × N 个库」—— **少了一个维度**。
    接口版无条件把字段当 JSON 数组解析（`JSONExtract(field, 'Array(String)')`），
    它的设计前提里就没有「另一种存储形态」。
    强行塞进去会让每个方法都多一个大部分实现用不上的参数。

- q: "`columnType` 是 `'string'` 时，ByteHouse 和 Doris 各生成什么？"
  a: |
    ByteHouse：`has(splitByChar(',', \`col\`), ?)` —— 先按逗号切开再问。
    Doris：`find_in_set(?, \`col\`)` —— 直接复用 MySql 的实现。
    ==注意 Doris 这里是主动复用，注释写明了「与 mysql 逻辑相同」。==

- q: "为什么 `find_in_set(?, `col`)` 的参数顺序是反的？"
  a: |
    **不是笔误。** `FIND_IN_SET(str, strlist)` 的签名就是「要查找的字符串在前，列表在后」。
    对比 `has(\`col\`, ?)` / `ARRAY_CONTAINS(\`col\`, ?)` 都是列名在前 ——
    所以只有这一个方法是反的，而且必须反。

- q: "`getStringArrayRule` 里有 MySql 分支，说明什么？"
  a: |
    说明它**写于「还支持三个库」的年代**。
    而 `SqlDialect` 里根本没有 MySql 实现 —— `DbType.MySql` 的注释写着
    「作为历史枚举值保留，仅在 `getStringArrayRule()` 和 `buildDetailWhereClause()`
    中使用」。
    ==注意它点名了这两个函数：整个仓库里只有这两个地方还认识 MySql。==

- q: "看到这种「两套并存」，该不该统一？"
  a: |
    **先确认三件事**：① 行为真的一样吗 ② 合并会不会让接口变形
    ③ 有没有人依赖旧路径的某个行为。
    这里三个答案都不利于合并（行为不同、接口会变形、columnType 被硬编码依赖），
    所以现状是合理的妥协。
    ==判断标准不是「代码整齐」，是「改了会不会引入 bug」。==
```
