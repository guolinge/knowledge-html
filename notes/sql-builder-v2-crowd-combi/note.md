```callout
tone: blue
icon: 🧭
text: |
  前置是 [⑧ crowd 篇](../sql-builder-v2-crowd/)。

  前面几篇一直在说「AND / OR 其实是集合运算」，但没展开。**这篇把它拆开。**

  读完你应该能说出：「==条件之间的 AND / OR 是一种运算，include / exclude 是另一种，
  它们不能合并，因为一个要计数、一个不要。==」
```

## 01 · 概念：combi 这一层在做什么

`combi/` 目录管**两种完全不同的组合**：

```compare
first: 组合
head: [在组合什么, 怎么实现, 要不要计数]
rows:
  - 第一层：条件之间: ["加购 AND VIP", "`UNION ALL` + `GROUP BY` + `HAVING`", { text: 要, tone: red }]
  - 第二层：二次加工: ["先算出一批人，再 include / exclude", "`UNION ALL` / `NOT IN`", { text: "不要", tone: green }]
```

```callout
tone: amber
icon: ⚠
text: |
  ==**这两层最容易混。**==

  用一句话区分：

  - **第一层**问「一个人命中了几条条件」—— 命中 2 条和 3 条，结果不一样
  - **第二层**问「一个人在不在这个名单里」—— 在就是在，不在就是不在

  一个是**计数问题**，一个是**存在性问题**。这就是它们不能合并的原因。
```

## 02 · 架构：AND / OR 怎么变成集合运算

核心就一个方法：`combineSql`。它做四件事：

```flow
grid: true
nodes:
  - { id: in, label: "combineSql(trees, decode, level)", sub: "一棵组合树", row: 0, kind: backend }
  - { id: map, label: "每个条件生成一段子 SQL", sub: "递归处理嵌套的组合", row: 1, tone: violet }
  - { id: union, label: "UNION ALL 堆起来", sub: "包成 ( ... ) ct1", row: 2, tone: blue }
  - { id: group, label: "GROUP BY uid", sub: "把同一个人的多行归并", row: 3, tone: blue }
  - { id: hav, label: "HAVING count(uid) ...", sub: "AND 和自定义数量才有", row: 4, tone: amber, shape: note }
  - { id: out, label: 一段 SQL, row: 5, kind: database }
edges:
  - { from: in, to: map }
  - { from: map, to: union, label: "sqls[]" }
  - { from: union, to: group }
  - { from: group, to: hav }
  - { from: hav, to: out }
```

### 三种模式

```compare
first: 模式
head: [HAVING 怎么写, 结果]
rows:
  - OR: [{ text: "不写 HAVING", tone: green }, "任一条件命中即保留"]
  - AND: ["`HAVING count(uid) = N`", "N 个子查询里**都出现**才保留"]
  - 自定义数量: ["`HAVING count(uid) >= 2`", "至少 N 个条件命中"]
```

对应代码：

```text
// combi/combination.ts · combineSql
if (isCustomMultiEntrepot(trees)) {
    query.having(havingCount(UID), trees.unionCount!.op, trees.unionCount!.count);
} else {
    if (trees.logic === Logic.And) {
        query.having(havingCount(UID), Op.Eq, sqls.length);
    }
}
```

```callout
tone: violet
icon: 💡
text: |
  ==**AND 的实现就是「多加一行 HAVING」。**==

  `OR` 什么都不加，`AND` 加一句 `HAVING count(uid) = sqls.length`，
  自定义数量把等号换成 `>=`。

  没有别的魔法。这是整个「条件组合」的全部实现。
```

### 两个容易忽略的细节

**① 递归的层数变成了表别名**

```text
const unionRawSql = DB.raw(DB.unionAllRaws(sqls)).wrap('(', `) ct${level}`);
```

```callout
tone: amber
icon: ⚠
text: |
  嵌套组合会产生嵌套的 `( ... ) ctN`。如果别名重了，SQL 会报错或语义错乱。

  所以 `combineSql` 带了一个 `level` 参数，每递归一层 +1。
  ==这是那种「不看代码永远想不到，看了觉得理所当然」的细节。==
```

**② 只有最外层 decode**

```text
// 内层不 decode，最外层 decode 就可
return this.combineSql(condition, false, level + 1).rawQuery();
```

因为 `UID_DECODE` 是个函数调用，嵌套 N 层就调 N 次，纯浪费。

## 03 · 架构：二次加工 include / exclude

举一个真实场景：

> 先圈出最近 7 天加购的人，**但要把内部测试账号剔掉**，**再加上运营给的白名单**。

```journey
- tag: 第一步
  tone: blue
  name: 主体
  code: |
    「最近 7 天加购的人」
  note: |
    第 02 节的组合层算出来的。
  next: "include :: 加一批 :: 并集"

- tag: 第二步
  tone: green
  name: include
  code: |
    select `uid` from (
      <majorSql> UNION ALL <minorSql>
    ) iut group by `uid`
  note: |
    **并集。** `UNION ALL` 堆起来再 `GROUP BY` 去重。

    别名 `iut` / `ict` / `irt` 按条件类型区分（uid / crowd / rawSql）。
  next: "exclude :: 减一批 :: 差集"

- tag: 第三步
  tone: red
  name: exclude
  code: |
    select `uid` from ( <majorSql> ) mt
    where `uid` NOT IN ( <minorSql> )
  note: |
    **差集。** 直接 `NOT IN`。

    ==注意它没有 `GROUP BY`== —— 因为不需要计数。
  next: "排序 :: :: 多条规则怎么排"
```

### 多条规则怎么排

```text
// pkg.ts · list()
_rules.sort((a, b) => bOrder - aOrder);   // 降序
const bulkSql = _rules.reduce((sql, rule) => { ... }, majorSql);
```

```callout
tone: amber
icon: ⚠
text: |
  **代码注释写着「order 越小，权重越大」，但排序是降序的 —— 这两句要合起来看。**

  降序排列 + 从头 reduce ⇒ ==order 大的先应用，order 小的后应用。==

  后应用的那个会覆盖前面的效果。所以「order 小 = 权重高」成立：

  ```text
  rules = [ {order: 0, exclude}, {order: 1, include} ]
  降序后 → [ include, exclude ]
  reduce → major → include → exclude
  最终 exclude 生效（order 0 赢）
  ```

  ==这种「注释和代码要合起来读才对得上」的地方，是读代码最容易卡住的。==
```

### 一个设计上的小细节

```text
const _crowdInstance = new Crowd();
const _rawSqlInstance = new RawSql();
```

```callout
tone: violet
icon: 💡
text: |
  这两个实例建在**模块级**（文件顶部），不是每次调用都 new。

  但 `_uidInstance` 建在**构造函数里** —— 因为它需要 dialect，
  而模块级没有 dialect。

  ==同一个文件里两种写法，区别只在于「要不要方言」。==
```

## 04 · 细节：`treeSimplifier` —— 藏在里面的优化器

`combi/utils.ts` 381 行里最重要的东西是 `treeSimplifier`。

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**它在生成 SQL 之前，先重写一遍条件树。**==

  这是个**优化器** —— 目标只有一个：**减少没必要的 `UNION ALL`。**
```

### 为什么需要它

看这个条件：

```text
城市是杭州 AND 城市是深圳
```

**直觉上**它是两个条件，走第 02 节的组合层就会变成：

```sql
-- ❌ 没优化的结果：两个子查询
select `uid` from (
  select `uid` from `user_portrait` where `city` = '杭州'
  union all
  select `uid` from `user_portrait` where `city` = '深圳'
) ct1
group by `uid`
having count(`uid`) = 2
```

**但这明显浪费** —— 两个条件查的是**同一张表**，完全可以写成一个 WHERE：

```sql
-- ✅ 优化后：一个查询
select `uid` from `user_portrait`
where `city` = '杭州' and `city` = '深圳'
```

```callout
tone: green
icon: ✅
text: |
  ==这就是 `treeSimplifier` 存在的全部理由。==

  它识别出「这些条件都在同一张表上」，把它们合并成一个节点，
  让组合层生成单表查询而不是 `UNION ALL`。

  代码注释原话：**「减少没必要的 union all; 优化计算效率」**
```

### 它做七件事

```text
// combi/utils.ts · treeSimplifier()
① checkHasCustomCountCombination  → 是「自定义计数」场景就直接返回，不优化
② cloneDeep                       → 不改调用方传进来的对象
③ _checkAndConvertTreeNodeToPortraitEntrepot  → 把能转的节点转成画像类型
④ _mergePortraitEntrepot          → 合并同一层的所有画像节点
⑤ _partitionSpecialCondition      → 分裂特殊条件（人群包要拆）
⑥ _mainTreeMinimizer              → 压掉只有一个子节点的组合
⑦ 空了就兜底 → select `uid` from user_portrait
```

**第 ④ 步是关键**：

```text
// _mergePortraitEntrepot
if (isPortraitEntrepotOnly(tree)) {
    return integratePortraitEntrepot(tree);   // 整棵树全是画像 → 合成一个
}
// 否则把同一层的画像挑出来，合并成一个节点，非画像的保持原样
return {
    logic: tree.logic,
    conditions: [
        ..._others,
        { type: Entrepots.Portrait, condition: { items: _portraits.map(p => p.condition), logic: tree.logic } }
    ]
};
```

### 为什么有些 uid 条件能转成画像

```text
// uid.ts
static checkCanBeConvertToPortraitEntrepot(condition: UidCondition) {
    return !(condition.op === ScopeOp.In && condition.ignoreNoExist !== true);
}
```

```callout
tone: amber
icon: ⚠
text: |
  **这个条件看着绕，但语义很直白：**

  「给一批 uid」要转成「查画像表 where uid in (...)」有个前提 ——
  ==画像表里得有这些人。==

  如果这批 uid 里有人**不在画像表**，两种写法结果就不一样：

  - **原始语义**（`ignoreNoExist = false`）：这批人**都要算上**，哪怕画像表里没有
  - **转成画像后**：`where uid in (...)` 查不出不存在的人，==会静默丢掉==

  所以只有 `ignoreNoExist = true`（不存在就忽略）时才允许转 ——
  因为那时候两种写法才等价。
```

```callout
tone: violet
icon: 💡
text: |
  **这个判断是「优化不能改变语义」这条铁律的体现。**

  优化器可以改 SQL 的写法，但不能改结果。
  一旦拿不准，就**不优化** —— 所以第 ① 步遇到「自定义计数」直接返回。
```

## 05 · 细节：`combi/utils.ts` 里还有什么

381 行、8 个导出函数。除了 `treeSimplifier`，还有：

```compare
first: 函数
head: [干什么, 谁在用]
rows:
  - "`getMainStruct(tree)`": ["从 `{ main, include, exclude }` 里取出主体", "Module 层"]
  - "`initMajorListSqlGen(type, dialect)`": ["生成「处理 main」的 SQL 生成器", "Module 层"]
  - "`initMajorCountSqlGen(type, dialect)`": ["同上，count 版", "Module 层"]
  - "`checkAndGetIncluOrExcluRule(tree)`": ["取出 include / exclude 规则", "Module 层"]
  - "`isOldUidAdditionalStruct` / `isOldCrowdAdditionalStruct`": [{ text: "旧结构兼容判断", tone: amber }, "兼容层"]
  - "`optionCorrector(tree)`": [{ text: "把旧结构转成新结构", tone: amber }, "兼容层"]
```

```callout
tone: amber
icon: ⚠
text: |
  **最后三个是历史包袱。**

  它们的注释里直接写着「后续线上没有这个结构可以删除」。

  ==读这个文件时可以先跳过它们。== 但改的时候别删 ——
  除非你确认线上真的没有旧结构的数据在跑。
```

```callout
tone: violet
icon: 💡
text: |
  **`initMajorListSqlGen` 这个名字里的 `Major` 是「主体」的意思。**

  对应 `BuildInfoTree` 的三个部分：`main`（主体）+ `include` / `exclude`（二次加工）。

  - `initMajorListSqlGen` → 处理主体
  - `Pkg.list(majorSql, rules)` → 在主体结果上做二次加工

  ==看懂 `Major` 这个词，`utils.ts` 的一半函数名就通了。==
```

## 06 · 自测

```quiz
- q: "为什么 AND / OR 不能用 SQL 的 AND / OR 实现？"
  a: |
    因为每个条件查的是**不同的表、不同的时间窗口**，没法拼进一个 WHERE。
    实际实现是**集合运算**：把各条件的 uid 用 `UNION ALL` 堆在一起，
    再 `GROUP BY uid` + `HAVING count(uid) = N`。
    ==AND 的实现就是「多加一行 HAVING」== —— OR 什么都不加，
    自定义数量把等号换成 `>=`。

- q: "include / exclude 为什么不能并进 AND / OR 里？"
  a: |
    因为**运算性质不同**：
    第一层（AND / OR）要**计数** —— 「N 个条件里命中几个」决定留不留；
    第二层（include / exclude）**不计数**，只关心在不在。
    所以 `exclude` 能写成 `NOT IN`（不需要 `GROUP BY`），
    而 AND 必须 `HAVING count(uid) = N`。

- q: "`treeSimplifier` 是干什么的？为什么需要它？"
  a: |
    它是**生成 SQL 之前的优化器**，目标只有一个：**减少没必要的 UNION ALL**。
    比如「城市是杭州 AND 城市是深圳」是两个画像条件，
    不优化会生成两个子查询 UNION ALL；优化后识别出它们在同一张表上，
    合并成一个节点，变成单表 `where city = '杭州' and city = '深圳'`。
    代码注释：「减少没必要的 union all; 优化计算效率」。

- q: "为什么有些 uid 条件不能转成画像条件？"
  a: |
    因为「给一批 uid」和「查画像表 where uid in (...)」有个前提差异 ——
    画像表里得有这些人。
    如果这批 uid 里有人**不在画像表**，转成画像后 `where uid in (...)` 会**静默丢掉**他们，
    而原始语义（`ignoreNoExist = false`）是「这批人都要算上」。
    所以只有 `ignoreNoExist = true`（不存在就忽略）时才允许转。
    ==这是「优化不能改变语义」这条铁律的体现。==

- q: "`include` / `exclude` 有多条规则时，按什么顺序应用？"
  a: |
    按 `options.order` **降序**排列后依次 reduce。
    所以 ==order 大的先应用，order 小的后应用==，后应用的效果会覆盖前面的。
    代码注释说「order 越小，权重越大」—— 要和排序方向合起来读才对得上。

- q: "`combineSql` 里的 `level` 参数是干什么的？"
  a: |
    用来生成子查询的别名 `( ... ) ct${level}`。
    嵌套组合会产生嵌套的 `( ... ) ctN`，如果别名重了 SQL 会报错或语义错乱，
    所以每递归一层 +1。
    同一层的另一个细节是：==内层不 decode，只有最外层 decode== ——
    因为 `UID_DECODE` 是函数调用，嵌套 N 层就调 N 次，纯浪费。
```
