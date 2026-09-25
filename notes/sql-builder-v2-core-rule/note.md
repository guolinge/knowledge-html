```callout
tone: blue
icon: 🧭
text: |
  前置是 [④ core 篇](../sql-builder-v2-core/)。

  前面几篇一直在说「业务条件变成 `Rule[]`」「core 只认 `Rule[]`」，
  但没讲 `Rule[]` 到底是什么。

  读完你应该能说出：「==四种形态是「列名要不要处理」×「值要不要处理」的 2×2 组合。==」
```

## 01 · 概念：三个类型，一个比一个窄

先把这个名字拆开。源码里其实有**三个**类型：

```text
// core/src/db.ts

export type Expression =                     // 叶子：四种形态之一
    | NormalExpression
    | RawValueExpression
    | RawExpression
    | RawColumnExpression;

export type Condition = {                    // 树枝：有 logic 和 items
    logic: Logic;
    items: (Condition | Expression)[];
};

export type Rule = Condition | Expression;   // 单个「树枝或叶子」
```

```flow
grid: true
nodes:
  - { id: rule, label: "Rule", sub: "一个节点：树枝或叶子", row: 0, tone: violet }
  - { id: cond, label: "Condition", sub: "树枝：logic + items", row: 1, tone: violet }
  - { id: expr, label: "Expression", sub: "叶子：四种形态", row: 1, tone: green }
  - { id: forms, label: "四种形态", sub: "Normal / RawValue / RawColumn / Raw", row: 2, tone: green }
edges:
  - { from: rule, to: cond, label: "是其中一种" }
  - { from: rule, to: expr, label: "或是另一种" }
  - { from: expr, to: forms }
```

```callout
tone: amber
icon: ⚠
text: |
  ==**注意 `Rule[]` 是**数组**，不是类型名。**==

  `buildWhere(builder, rules: Rule[], logic?)` 收的是**一组** Rule。
  架构图上写的 `Rule[]` 指的是「core 的输入格式」—— 一整个数组。

  而 `Rule`（不带方括号）是**数组里的一个元素**。
  ==说「一个 Rule」和「一个 Rule[]」是两件不同的事。==
```

### 为什么要有这三个层次

```compare
first: 类型
head: [回答什么问题, 有多少种可能]
rows:
  - Rule: ["这是一个树枝还是叶子", 2]
  - Condition: ["这一层怎么连（AND / OR）", "1 种形状，但可以无限嵌套"]
  - Expression: ["这个叶子怎么写进 WHERE", 4]
```

```callout
tone: violet
icon: 💡
text: |
  **整个模型只有两层结构：树枝和叶子。**

  树枝只有一种形状（`logic` + `items`），叶子有四种写法。
  ==`Rule[]` 的全部复杂度就是「树枝能套树枝」+「叶子有四种写法」。==
```

## 02 · 概念：为什么不能直接用 SQL 字符串

如果只需要「生成一段 SQL」，为什么不干脆存字符串？

因为一条 SQL 里，**「数据」和「代码」是两种东西**，处理方式完全不同：

```text
SELECT uid FROM user_portrait WHERE city = '杭州'
       ↑                        ↑   ↑      ↑
    标识符                    标识符 数据  数据
```

```compare
first: 成分
head: [例子, 怎么处理, 处理错了会怎样]
rows:
  - 标识符: ["`city` / `user_portrait`", "包反引号：`` `city` ``", { text: "语法错或歧义", tone: amber }]
  - 数据: ["`'杭州'`", "**参数绑定**（交给 knex）", { text: "**注入漏洞**", tone: red }]
  - 表达式: ["`JSONExtract(props, 'a')`", "**原样**，不能包反引号", { text: "语法错", tone: amber }]
```

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==把「数据」当成「代码」处理，或者反过来，就是注入漏洞。==

  所以**必须有一个数据结构，能把这三类成分精确区分开** ——
  这就是四种形态存在的理由。
```

## 03 · 组织：四种形态是 2×2 加一个兜底

```compare
first: 形态
head: [列名怎么处理, 值怎么处理]
rows:
  - NormalExpression: ["包反引号", "参数绑定"]
  - RawValueExpression: ["包反引号", { text: "**原样**（值本身是 SQL）", tone: amber }]
  - RawColumnExpression: [{ text: "**原样**（列名本身是表达式）", tone: amber }, "参数绑定"]
  - RawExpression: [{ text: "整段透传 `whereRaw`", tone: red }, "（可选）绑定值"]
```

```callout
tone: violet
icon: 💡
text: |
  ==看出来了吗？**四种形态就是「列名要不要处理」×「值要不要处理」的 2×2 组合**，
  再加一个「整段都别处理」的兜底。==

  |  | 值：正常 | 值：原样 |
  |---|---|---|
  | **列名：正常** | Normal | RawValue |
  | **列名：原样** | RawColumn | （归到 Raw） |
```

### 四种形态各是什么样

```cards
cols: 2
items:
  - title: NormalExpression
    tag: 最常用
    tone: green
    desc: |
      列名和值都是普通数据。==99% 的条件都是这一种。==
    code: |
      { op: 'IN', column: 'city', value: ['杭州'] }

      → WHERE `city` IN (?)
        bindings: ['杭州']
  - title: RawValueExpression
    tag: 值是 SQL
    tone: amber
    desc: |
      列名普通，但**值本身是一段 SQL**（比如子查询）。

      注意字段名是 `rawValue` 而不是 `value`。
    code: |
      { op: 'Gt', column: 'cnt',
        rawValue: '(select avg(x) from t)' }

      → WHERE `cnt` > (select avg(x) from t)
  - title: RawColumnExpression
    tag: 列名是 SQL
    tone: amber
    desc: |
      值普通，但**列名是一段表达式**。

      典型场景：从 JSON / map 列里取值。
    code: |
      { op: 'Eq', rawColumn: "JSONExtract(props, 'a')", value: 1 }

      → WHERE JSONExtract(props, 'a') = ?
  - title: RawExpression
    tag: 整段透传
    tone: red
    desc: |
      整条 where 都是 SQL。**方言方法返回的就是它。**

      `value` 是**可选**的 —— 有就透传成 knex 绑定。
    code: |
      { raw: "CASE WHEN `x` REGEXP ? THEN 1 ELSE 0 END = 1",
        value: '^abc' }
```

### 边界情况：`Raw` 的 value 是可选的

```text
if (rule.value === undefined) {
    this.whereRaw(rule.raw);
} else {
    this.whereRaw(rule.raw, encodeValue(rule.value) as Knex.RawBinding);
}
```

```callout
tone: amber
icon: ⚠
text: |
  ==**`Raw` 是唯一一个「值可选」的形态。**==

  这是它和另外三种的关键差别：另外三种**必须有值**（或者有 `rawValue`），
  而 `Raw` 可以只是一段不带参数的 SQL 片段。

  为什么要这样：因为方言方法经常生成「纯结构」的片段
  （比如 `isNull(\`x\`)`），里面根本没有绑定参数。
```

## 04 · 架构：怎么判别、怎么分派

### 判别靠「哪个字段存在」

```text
export const isCondition     = (rule) => 'logic'    in rule;
export const isRawValueExpr  = (rule) => 'rawValue' in rule;
export const isRawColumnExpr = (rule) => 'rawColumn' in rule;
export const isRawExpr       = (rule) => 'raw'      in rule;
export const isNormalExpr    = (rule) => 'value' in rule && 'column' in rule;
```

```callout
tone: amber
icon: ⚠
quote: true
text: |
  ==**这是鸭子类型（duck typing），不是 class。**==

  没有 `class NormalExpression`，只有一堆 `type` 定义 + 五个 `in` 判断。
  数据就是**普通 JSON 对象**。
```

**判别顺序有意义**：

```flow
grid: true
nodes:
  - { id: in, label: "一个 rule 对象", row: 0, kind: backend }
  - { id: c, label: "有 'logic'？", row: 1, tone: violet, shape: note }
  - { id: rv, label: "有 'rawValue'？", row: 2, tone: amber, shape: note }
  - { id: rc, label: "有 'rawColumn'？", row: 3, tone: amber, shape: note }
  - { id: r, label: "有 'raw'？", row: 4, tone: amber, shape: note }
  - { id: n, label: "有 'value' + 'column'？", row: 5, tone: green, shape: note }
  - { id: bad, label: throw, sub: "都不是", row: 6, tone: red }
  - { id: sub, label: "递归 buildWhere", sub: "建括号往下钻", row: 1, tone: violet }
  - { id: expr, label: "挂到 knex", row: 5, tone: green }
edges:
  - { from: in, to: c }
  - { from: c, to: sub, label: "是" }
  - { from: c, to: rv, label: "否", dashed: true }
  - { from: rv, to: expr, label: "是" }
  - { from: rv, to: rc, label: "否", dashed: true }
  - { from: rc, to: expr, label: "是" }
  - { from: rc, to: r, label: "否", dashed: true }
  - { from: r, to: expr, label: "是" }
  - { from: r, to: n, label: "否", dashed: true }
  - { from: n, to: expr, label: "是" }
  - { from: n, to: bad, label: "否", dashed: true }
```

### 分派：AND / OR 就是选方法名

```text
function getWhereFn(builder, logic) {
    switch (logic) {
        case Logic.And: return builder.andWhere.bind(builder);
        case Logic.Or:  return builder.orWhere.bind(builder);
        default: throw new Error(`getWhereFn: 条件错误："logic: ${logic}"`);
    }
}
```

**四种形态落到 knex 的方法**：

```compare
first: 形态
head: [列名, 值, 落到 knex 的]
rows:
  - Normal: ["`DB.raw(formatField(column))`", "`encodeValue(value)`", "`whereFn(列, op, 值)`"]
  - RawValue: ["同上", "`DB.raw(rawValue)`", "同上"]
  - RawColumn: ["`DB.raw(rawColumn)`", "`encodeValue(value)`", "同上"]
  - Raw: ["—", "`encodeValue(value)`", "`whereRaw(raw, value)`"]
```

````callout
tone: violet
icon: 💡
text: |
  ==**看第三列：前三种都落到同一个 `whereFn`。**==

  区别只在「列名怎么来」和「值怎么来」——
  到了 knex 那一层，它们**长得完全一样**。

  ```
  whereFn(column, op, value)
  ```

  ==所以四种形态的差异，在分派时就消解掉了。==
````

## 05 · 取舍：鸭子类型的代价

```compare
first: 维度
head: [鸭子类型（现在）, class（如果改成）]
rows:
  - 定义: ["一个 `type` + 五个 `in` 判断", "四个 class + `instanceof`"]
  - JSON 直接用: [{ text: "✅ 天然可用", tone: green }, "❌ 要反序列化成实例"]
  - 跨进程传输: [{ text: "✅ 就是普通对象", tone: green }, "❌ 要序列化协议"]
  - 拼错字段名: [{ text: "❌ **不报错**，运行到才炸", tone: red }, "✅ 构造时就报错"]
  - 代码量: [{ text: "极少", tone: green }, 多很多]
```

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**代价就是最后那一行：拼错字段名不会在编译期报错。**==

  这个库的输入来自**外部 JSON**（网关、配置、前端提交），
  所以「JSON 直接用」这条优势是决定性的 —— 值得换那个代价。
```

**拼错会发生什么**：

```journey
- tag: 假设
  tone: muted
  name: 调用方传了个错字段
  code: |
    { op: 'IN', colum: 'city', value: ['杭州'] }
              ↑ 少了个 n
  note: |
    注意：这是外部传进来的 JSON，**TypeScript 管不到它**。
  next: "判别 :: :: 五个 in 全不中"

- tag: 判别
  tone: amber
  name: 五个判断都不通过
  code: |
    isCondition     → 'logic' in rule        → false
    isRawValueExpr  → 'rawValue' in rule     → false
    isRawColumnExpr → 'rawColumn' in rule    → false
    isRawExpr       → 'raw' in rule          → false
    isNormalExpr    → 'value' in rule && 'column' in rule
                                               ↑ 'colum' 不是 'column'
                                             → false
  note: |
    ==全部落空。==
  next: "抛异常 :: :: 至少是响了"

- tag: 结果
  tone: red
  name: buildWhere 抛错
  code: |
    throw new Error(`条件结构错误：${JSON.stringify(rule)}`);
  note: |
    **好消息：它 throw 了，而且把原始对象打进错误信息。**

    坏消息：这是**运行时**才炸 —— 如果这条路径没被测试覆盖，
    就跑到生产了。
```

```callout
tone: green
icon: ✅
text: |
  **所以这里的设计是「宁可炸，不要静默」。**

  对比另一种可能：如果不 throw，而是**当成空条件跳过** ——
  那 SQL 就少了一个筛选条件，==圈出来的人会多一批，而且没人知道==。

  和工厂遇到未知类型直接 throw 是同一个取舍。
```

## 06 · 自测

```quiz
- q: "`Rule`、`Condition`、`Expression` 三个类型是什么关系？"
  a: |
    `Rule = Condition | Expression` —— 它是**一个节点**（树枝或叶子）。
    `Condition` 是树枝（`logic` + `items`），`Expression` 是叶子的四种形态。
    而 ==`Rule[]` 是数组==，指整个输入格式 —— 说「一个 Rule」和「一个 Rule[]」
    是两件不同的事。

- q: "为什么要分四种形态？不能统一成一种吗？"
  a: |
    因为一条 SQL 里「数据」和「代码」是两种东西，处理方式完全不同：
    标识符要包反引号、数据要走参数绑定、表达式不能包反引号。
    四种形态就是「列名要不要处理」×「值要不要处理」的 2×2 组合，
    再加一个「整段都别处理」的兜底。
    ==把数据当代码处理，或者反过来，就是注入漏洞。==

- q: "`RawExpression` 和另外三种最大的差别是什么？"
  a: |
    它的 `value` 是**可选**的 —— 可以只是一段不带参数的 SQL 片段。
    另外三种必须有值（或 `rawValue`）。
    因为方言方法经常生成「纯结构」的片段（比如 `isNull(\`x\`)`），
    里面根本没有绑定参数。

- q: "四种形态到了 knex 那一层，长得一样吗？"
  a: |
    **前三种一样。** 它们都落到同一个 `whereFn(column, op, value)`，
    区别只在「列名怎么来」和「值怎么来」—— 到了 knex 那层差异就消解了。
    只有 `Raw` 不同，它落到 `whereRaw(raw, value)`。

- q: "判别用的是鸭子类型还是 class？代价是什么？"
  a: |
    鸭子类型 —— 五个 `'xxx' in rule` 判断，没有 class。
    好处是 JSON 直接可用、跨进程传输天然友好（这个库的输入来自外部 JSON，
    所以这条优势是决定性的）。
    代价是 ==拼错字段名不会在编译期报错== —— 五个判断全落空，
    走到最后 throw「条件结构错误」。
    但 throw 比静默跳过好：静默会让 SQL 少一个条件，圈出来的人多一批。

- q: "`getWhereFn` 里 AND / OR 是怎么实现的？"
  a: |
    一个 switch 选方法名：`Logic.And → builder.andWhere`，`Logic.Or → builder.orWhere`。
    ==没有别的魔法。== 嵌套靠 `whereFn(sub => DB.buildWhere(sub, rule.items, rule.logic))` ——
    传个回调进去，knex 会把它包成括号。
```
