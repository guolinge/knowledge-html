```callout
tone: blue
icon: 🧭
text: |
  前置是 [④ core 篇](../sql-builder-v2-core/)。

  架构篇讲过结论：「方言不生成 SQL，只返回片段或节点」。
  这篇**把 17 个方法逐个拆开**，看哪些只是命名不同、哪些背后藏着真问题。

  读完你应该能说出：「==大部分只是换个函数名，但有三四个背后是引擎限制和真实的 bug 修复。==」
```

## 01 · 概念：为什么需要方言

同一句业务话，两个数据库的写法**完全不一样**：

```compare
first: 要做的事
head: [ByteHouse, Doris]
rows:
  - 从 map 里取一个 key: ["`mapElement(\\`name\\`, 'a')`", "`ELEMENT_AT(\\`name\\`, 'a')`"]
  - 判断是不是 NULL: ["`isNull(\\`x\\`)`", "`\\`x\\` IS NULL`"]
  - 转成整数: ["`toInt64(\\`x\\`)`", "`CAST(\\`x\\` AS SIGNED)`"]
  - 按天分组: ["`FROM_UNIXTIME(\\`t\\`/1000, '%Y-%m-%d')`", "`DATE_FORMAT(\\`t\\`, '%Y-%m-%d')`"]
```

**如果不用方言**，那 `crowd` 里每个条件都要写一遍这种分支：

```text
// ❌ 没有方言会变成这样（假想）
const field = dbType === 'bytehouse'
  ? `mapElement(${col}, '${key}')`
  : `ELEMENT_AT(${col}, '${key}')`;
```

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==**方言层做的事：把这些 if/else 收拢到一处。**==

  17 个方法 = 17 个「两个库写法不同」的地方。
  调用方只写 `dialect.mapPropertyAccess(col, key)`，不关心背后是谁。
```

### 但方言**不生成 SQL**

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==方言方法没有一个是直接产出 SQL 的。==

  它们只返回两种东西：

  - **SQL 片段字符串** —— 被拼进 `Expression.raw`
  - **完整的 Expression / Rule** —— 直接进表达式树

  真正把表达式树变成 SQL 的，是 `buildWhere` + knex。
  （这个取舍的理由在 [④ core 篇](../sql-builder-v2-core/) 第 06 节。）
```

## 02 · 组织：17 个方法，分五类

```compare
first: 类别
head: [方法, 有几个]
rows:
  - 属性取值: ["`mapPropertyAccess`", 1]
  - 判空与兜底: ["`isNullCheck` / `isNotNullCheck` / `ifNullWrap`", 3]
  - 类型转换: ["`castToInt` / `castToFloat` / `castBoolToInt`", 3]
  - 数组与正则: ["`jsonArrayContainsRule` / `NotContains` / `Equals` / `regexpMatchExpr` / `regexpNotMatchExpr`", 5]
  - 时间: ["`groupByEventTime` / `getRelativeTimestampRules` / `getAbsoluteTimestampRules`", 3]
  - 其它: ["`multiIf` / `arrayExpandSql`", 2]
```

```callout
tone: violet
icon: 💡
text: |
  **看返回类型，就知道这个方法有多复杂：**

  | 返回 | 方法 | 意味着 |
  |---|---|---|
  | `string` | 11 个 | 只是拼个片段，最简单 |
  | `Expression` / `Rule` | 5 个 | 要构造表达式节点 |
  | `Expression[]` | 2 个 | 要生成**多个**条件（时间范围） |

  ==返回数组的那两个，是整层里最重的。==
```

## 03 · 细节：命名差异 —— 七个一眼就懂的

```compare
first: 方法
head: [ByteHouse, Doris, 差异性质]
rows:
  - "`mapPropertyAccess`": ["`mapElement(c, 'k')`", "`ELEMENT_AT(c, 'k')`", { text: 换个函数名, tone: green }]
  - "`isNullCheck`": ["`isNull(f)`", "`f IS NULL`", { text: "函数 vs 运算符", tone: green }]
  - "`isNotNullCheck`": ["`isNotNull(f)`", "`f IS NOT NULL`", { text: 同上, tone: green }]
  - "`ifNullWrap`": ["`ifNull(f, d)`", "`IFNULL(f, d)`", { text: 只是大小写, tone: green }]
  - "`castToInt`": ["`toInt64(f)`", "`CAST(f AS SIGNED)`", { text: 换个函数名, tone: green }]
  - "`castToFloat`": ["`toFloat64(f)`", "`CAST(f AS DOUBLE)`", { text: 同上, tone: green }]
  - "`multiIf`": ["`multiIf(c1,v1,c2,v2,default)`", "`CASE WHEN c1 THEN v1 ... ELSE default END`", { text: 两种语法, tone: green }]
```

```callout
tone: green
icon: ✅
text: |
  **这七个不需要动脑子** —— 查一下两边函数名就行。

  但**别以为 17 个都这么简单**。下面三个要读注释才懂。
```

## 04 · 细节：三个需要读注释的

### ① `castBoolToInt` —— 一个引擎报错

**ByteHouse 的实现只有一行：直接复用 `castToInt`。**

```text
castBoolToInt(field: string): string {
    // ByteHouse 中 properties 是 Map(String,String)，mapElement 取出为 Nullable(String)。
    // bool 属性存的是字符串 "1"/"0"，右侧比较值是数字字面量（UInt8），
    // 若左侧裸用 mapElement 会触发 "no supertype for types String, UInt8" 引擎报错。
    // 与迁移前 bytehouse 链路语义对齐：旧库 isBool 不生效、按 type='long' 走 toInt64，
    // 这里同样把左侧强转 Int64，使 String "1"→1 可与 UInt8 比较。
    return this.castToInt(field);
}
```

**Doris 的实现完全不同：**

```text
castBoolToInt(field: string): string {
    // ds_gateway 的 pingcap/parser 不支持 CAST AS BOOLEAN；直接 = true 比较，
    // Doris 对字符串'true'/整数1/布尔true 均判为真，语义与旧 CAST AS BOOLEAN 一致
    return `CASE WHEN ${field} = true THEN 1 ELSE 0 END`;
}
```

```callout
tone: red
icon: ⚠
text: |
  ==**两个注释讲的是两件不同的事，但都指向同一个约束：类型系统不让你随便比。**==

  - **ByteHouse**：`Map(String,String)` 取出来是**字符串**，右边是数字 → 引擎拒绝比较
  - **Doris**：gateway 的解析器**不支持** `CAST AS BOOLEAN` → 只能换个写法

  ==注意 `castBoolToInt` 在 ByteHouse 里「其实没做 bool 转换」== ——
  它是为了「跟旧行为对齐」而故意这么写的。
```

### ② `regexpMatchExpr` —— 一段**不会被执行**的代码

```text
/**
 * ! 这里目前实测 ds_gateway 的 TiDB Parser 不支持 match()，
 *   udp 后台目前条件也是不支持正则的，实际不会触发到这里
 */
regexpMatchExpr(field: string, value: string): Expression {
    return { raw: `match(${field}, ?) = 1`, value };
}
```

```callout
tone: amber
icon: ⚠
text: |
  **这段注释说的是：「写了，但用不到」。**

  两个原因叠加：
  ① gateway 的解析器**不支持** `match()`
  ② 后台的条件配置里**根本没有正则这个选项**

  ==所以这段代码是死路 —— 但它是接口要求必须实现的，不能删。==
  看到这种注释，就知道**别在这上面花时间**。
```

### ③ `jsonArrayContainsRule` —— 一个有参数绑定、一个没有

**这一对是整层里最值得看的。**

```compare
first: 库
head: [怎么拼数组, 值怎么处理, 要不要手动检查]
rows:
  - ByteHouse: ["`JSONExtract('[...]', 'Array(String)')` **直接拼字符串**", { text: "拼进 SQL 字面量", tone: amber }, { text: "✅ 要 `assertSqlSafeArrayValues`", tone: red }]
  - Doris: ["`CAST(? AS JSON)` **参数绑定**", { text: "走 `?` 绑定", tone: green }, { text: "❌ 不需要", tone: green }]
```

```text
// ByteHouse —— 把整个数组 JSON.stringify 后拼进 SQL
const valueRaw = `JSONExtract('${JSON.stringify(values)}', 'Array(String)')`;
assertSqlSafeArrayValues(values);   // ← 所以要先检查单引号
return { raw: `hasAny(${convertedField}, ${valueRaw}) = 1` };

// Doris —— 每个值走参数绑定
const parts = values.map((v) =>
    DB.raw(`JSON_CONTAINS(${castExpr}, CAST(? AS JSON))`, [JSON.stringify(v)]).toQuery()
);
return { raw: `(${parts.join(' OR ')})` };   // ← 不需要检查
```

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**同一个方法，一个需要防注入检查，一个不需要。**==

  ByteHouse 没有「把数组当参数绑定」的写法，只能把整个 JSON 拼进字符串 ——
  所以必须**在拼接前拦一道**（`assertSqlSafeArrayValues`）。

  Doris 可以逐个值绑定 `?`，天然安全。

  ==这不是谁好谁坏，是两边能力不同。== 方言层的作用就是把这种差异**关在里面**，
  让上层调用方不用关心。
```

## 05 · 但它不是唯一的路

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**除了 `SqlDialect` 接口，还有另一条路处理数组条件。**==

  它在 `core/src/utils.ts` 里，**按 `dbType` if/else 分支** ——
  而不是走接口。这是架构的一条裂缝。

  展开在 [数组条件的两种路径](../sql-builder-v2-core-dialect-array/)。
```

```callout
tone: violet
icon: 💡
text: |
  **这里只提一句，因为那是个独立的问题：**

  - 这一篇讲「方言接口怎么设计的」
  - 那一篇讲「为什么还有一个东西不走接口」

  ==如果你在读代码时遇到 `getStringArrayRule`，去那一篇。==
```

## 06 · 自测

```quiz
- q: "方言方法会直接生成 SQL 吗？"
  a: |
    **不会。** 它们只返回两种东西：SQL 片段字符串（拼进 `Expression.raw`），
    或者完整的 Expression / Rule（直接进表达式树）。
    真正把表达式树变成 SQL 的是 `buildWhere` + knex。
    这么设计是为了避免每个方言方法都重新实现一遍 `buildWhere`。

- q: "17 个方法里，大部分只是换个函数名吗？"
  a: |
    大部分是，但**不是全部**。
    七个是纯命名差异（`mapElement` vs `ELEMENT_AT`、`toInt64` vs `CAST AS SIGNED`）。
    但 `castBoolToInt` / `regexpMatchExpr` / `jsonArrayContainsRule` 这几个，
    背后是**引擎限制、gateway 解析器限制、和真实的 bug 修复**。

- q: "为什么 `jsonArrayContainsRule` 在 ByteHouse 里要手动检查单引号，Doris 里不用？"
  a: |
    因为**两边能力不同**：
    ByteHouse 没有「把数组当参数绑定」的写法，只能把整个 JSON 拼进字符串字面量
    （`JSONExtract('[...]', 'Array(String)')`）—— 所以必须拼之前拦一道。
    Doris 可以逐个值绑定 `?`（`CAST(? AS JSON)`），天然安全。
    方言层的作用就是把这种差异关在里面，让上层不用关心。

- q: "`castBoolToInt` 在 ByteHouse 里其实没做 bool 转换，为什么？"
  a: |
    注释说得很清楚：`properties` 是 `Map(String,String)`，`mapElement` 取出来是
    `Nullable(String)`，而 bool 属性存的是字符串 "1"/"0"，
    右侧比较值是数字字面量（UInt8）—— 裸用会触发
    「no supertype for types String, UInt8」引擎报错。
    所以强转 Int64。而且注释还写了「与迁移前语义对齐」——
    ==它是为了跟旧行为一致才故意这么写的。==

- q: "`getStringArrayRule` 为什么说是「架构裂缝」？"
  a: |
    因为同一类需求（字符串数组的包含判断）有**两套实现**：
    走 `SqlDialect` 接口的，和在 `utils.ts` 里按 `dbType` if/else 的。
    后者**违反了方言层的初衷** —— 把 if/else 又搬回来了，
    而且还要调用方额外传 `columnType`。
    它只在 `relation.ts` 一处被调用，`dbType` 是当参数传进去的，
    `columnType` 还硬编码成 `'string'`。

- q: "看到 `getStringArrayRule` 里有 MySql 分支，说明什么？"
  a: |
    说明它**写于「还支持三个库」的年代**。
    而 `SqlDialect` 里根本没有 MySql 实现（`DbType.MySql` 的注释写着
    「作为历史枚举值保留」）。
    ==新老两套并存是真实代码库的常态==，看到时别急着统一 ——
    先确认两边行为真的一样再合并。
```
