```callout
tone: blue
icon: 🧭
text: |
  前置是 [① 概念篇](../sql-builder-v2-concepts/) 和 [② 组织篇](../sql-builder-v2-organization/)。

  这篇回答一个问题：==这些东西怎么配合工作？==

  读完你应该能说出：「一条条件经过**两次翻译**变成 SQL，而 AND / OR 其实是**集合运算**」。
```

## 01 · 主干：一条条件怎么变成 SQL

先看全貌。下面这张图有 **8 个框、7 条边**，每条边都带编号：

```arch
svg: core-package
caption: 主干：8 个框、7 条边。下面的表格按编号逐条对应
```

```compare
first: 边
head: [从 → 到, 这一步在干什么]
rows:
  - "①": ["业务条件 → `Rule[]`", "**adapter 改写**：字段改名 + 展开特殊条件"]
  - "②": ["`utils.ts` → `Rule[]`", "**时间条件展开**成一棵 AND 子树"]
  - "③": ["业务条件 → 方言", "属性类型特殊时才调方言"]
  - "④": ["方言接口 → 两个实现", "接口落到 ByteHouse / Doris"]
  - "⑤": ["`Rule[]` → `buildWhere`", "**递归展开**成 knex 调用"]
  - "⑥": ["`buildWhere` → knex", "每种表达式形态各落到哪个方法"]
  - "⑦": ["knex → SQL 字符串", "链式累积，取值时才编译"]
```

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==记住这 7 条边，整个架构就懂了。==

  后面每一节都在展开其中某几条。真正陌生的只有 **①**（adapter 改写）
  和 **⑤**（递归展开）—— 其余都是「把东西往下传」。
```

## 02 · 两次翻译，各管什么

```flow
grid: true
nodes:
  - { id: biz, label: 业务条件, sub: "运营/产品能懂的语言", row: 0, kind: frontend }
  - { id: rule, label: "Rule[]", sub: "core 能懂的语言", row: 1, tone: violet }
  - { id: sql, label: SQL 字符串, sub: "数据库能懂的语言", row: 2, kind: database }
edges:
  - { from: biz, to: rule, label: "边 ① adapter 翻译" }
  - { from: rule, to: sql, label: "边 ⑤⑥⑦ 编译" }
```

```compare
first: 阶段
head: [谁在做, 做什么, 关心什么]
rows:
  - 第一次翻译: ["`crowd` 包", "业务词汇 → 数据词汇", "「最近 3 天」是什么意思"]
  - 第二次翻译: ["`core` 包 + knex", "数据词汇 → SQL 文本", "反引号、占位符、方言"]
```

```callout
tone: green
icon: ✅
text: |
  **这样分层换来的是：core 永远不知道「什么是相对时间」。**

  它只认「一个列、一个操作符、一个值」。
  ==所以换一种业务场景时，core 一行都不用改。==
```

**两次翻译的边界，就在 `Rule[]` 这个数据结构上。**

它是 core 的唯一输入格式。左边是业务世界，右边是 SQL 世界，`Rule[]` 是中间那个接缝。

```callout
tone: amber
icon: ⚠
text: |
  **`Rule[]` 本身有四种形态**（普通 / 值是 SQL / 列名是 SQL / 整段透传），
  这是「数据 vs 代码」的区分。

  ==那部分展开在 [⑤ Rule[] 篇](../sql-builder-v2-core-rule/)。==
  这篇只需要知道：它是 core 认识的输入格式。
```

## 03 · 组合：为什么 AND / OR 不是 SQL 的 AND / OR

看到「条件 A **AND** 条件 B」，直觉会写：

```sql
-- ❌ 直觉写法：对同一个用户，既要命中 A 又要命中 B
SELECT uid FROM event_add_cart
WHERE ... AND uid IN (SELECT uid FROM user_portrait WHERE ...)
```

**但这里每个条件查的是不同的表、不同的时间窗口**，没法拼进一个 WHERE。
所以实际实现是**集合运算**：

```callout
tone: amber
icon: ⚠
quote: true
text: |
  AND / OR 被实现成「**对 uid 做集合运算**」，而不是 SQL 的 AND / OR。
```

```demo
widget: combination-count
title: AND / OR 的真实执行过程
hint: 点下面的按钮切换
actions: false
html: |
  <div class="cc">
    <div class="cc-sets">
      <div class="cc-set tone-green"><b>条件 A</b><small>事件：加购</small><span class="uids">1, 2, 3</span></div>
      <div class="cc-set tone-blue"><b>条件 B</b><small>画像：VIP</small><span class="uids">2, 3, 4</span></div>
      <div class="cc-set tone-violet"><b>条件 C</b><small>人群包：近30天活跃</small><span class="uids">3, 4, 5</span></div>
    </div>

    <div class="cc-arrow">↓ UNION ALL &nbsp;·&nbsp; 三个子查询的 uid 堆在一起，同一个 uid 出现多次</div>

    <table class="cc-table">
      <thead>
        <tr><th>uid</th><th>命中条件</th><th>COUNT(uid)</th><th>OR</th><th>AND</th><th>≥ 2</th></tr>
      </thead>
      <tbody>
        <tr data-cc-row data-count="1"><td>1</td><td class="src">A</td><td>1</td><td>✓</td><td>✗</td><td>✗</td></tr>
        <tr data-cc-row data-count="2"><td>2</td><td class="src">A B</td><td>2</td><td>✓</td><td>✗</td><td>✓</td></tr>
        <tr data-cc-row data-count="3"><td>3</td><td class="src">A B C</td><td>3</td><td>✓</td><td>✓</td><td>✓</td></tr>
        <tr data-cc-row data-count="2"><td>4</td><td class="src">B C</td><td>2</td><td>✓</td><td>✗</td><td>✓</td></tr>
        <tr data-cc-row data-count="1"><td>5</td><td class="src">C</td><td>1</td><td>✓</td><td>✗</td><td>✗</td></tr>
      </tbody>
    </table>

    <div class="cc-modes">
      <button data-cc-mode="or">OR</button>
      <button data-cc-mode="and">AND</button>
      <button data-cc-mode="n2">至少 2 个</button>
    </div>

    <div class="cc-out">HAVING 过滤后命中 <b data-cc-count>5</b> 个 uid</div>
    <pre data-cc-sql></pre>
  </div>
```

一句话总结：

```compare
first: 逻辑
head: [SQL 怎么写, 结果]
rows:
  - OR: ["GROUP BY uid，**不加** HAVING", "任一条件命中即保留"]
  - AND: ["GROUP BY uid，`HAVING count(uid) = N`", "N 个子查询里**都出现**才保留"]
  - 自定义数量: ["GROUP BY uid，`HAVING count(uid) >= 2`", "至少 N 个条件命中"]
```

对应代码只有一行：

```text
// packages/crowd/src/combi/combination.ts
if (trees.logic === Logic.And) {
    query.having(havingCount(UID), Op.Eq, sqls.length);
}
```

```callout
tone: violet
icon: 💡
text: |
  还有个细节：`DB.unionAllRaws` 的注释写着 **「网关只支持 union all，不支持 union」**。

  所以这里用 `UNION ALL + GROUP BY` 去重，而不是 `UNION` ——
  ==这不只是性能选择，是**下游能力约束**。==
```

## 04 · 二次加工：include / exclude

上面是「条件之间怎么连」。还有一层**很容易忽略**：算完一批人之后，再增删。

举个真实场景：

> 先圈出最近 7 天加购的人，**但要把内部测试账号剔掉**，**再加上运营给的白名单**。

这是三步，不是一步：

```journey
- tag: 第一步
  tone: blue
  name: 主体条件
  code: |
    「最近 7 天加购的人」
  note: |
    这就是第 03 节讲的组合层 —— 算出一批 uid。
  next: "include :: 加一批 :: 并集"

- tag: 第二步
  tone: green
  name: include
  code: |
    UNION ALL(major, minor) + GROUP BY uid
  note: |
    **并集**，顺带去重。运营给的白名单直接并进来。
  next: "exclude :: 减一批 :: 差集"

- tag: 第三步
  tone: red
  name: exclude
  code: |
    major WHERE uid NOT IN (minor)
  note: |
    **差集**。测试账号直接减掉。
  next: "输出 :: :: 最终 uid 列表"
```

### 为什么必须单独一层

```callout
tone: amber
icon: ⚠
quote: true
text: |
  ==因为两种运算的性质不同。==

  - **第一层**（AND / OR）要**计数** —— 「N 个条件里命中几个」决定了留不留
  - **第二层**（include / exclude）**不计数** —— 只关心「在不在」

  `exclude` 能写成 `NOT IN`，正是因为不需要知道谁出现过几次。
```

这就是为什么 `Combination` 和 `Pkg` 是**两个类**而不是一个。

## 05 · 分发：六种入口怎么选

条件树的叶子有六种（概念篇讲的画像 / 事件 / 关系 / 人群包 / uid / rawSql）。
每种都要知道自己**该去哪张表、怎么写查询**。

```flow
grid: true
nodes:
  - { id: in, label: "一个条件", sub: "{ type: 'event', condition: {...} }", row: 0, kind: backend }
  - { id: sw, label: "switch (condition.type)", sub: "工厂里的分发", row: 1, tone: amber, shape: note }
  - { id: p, label: 画像, sub: portrait, row: 2, tone: green }
  - { id: e, label: 事件, sub: event, row: 2, tone: violet }
  - { id: o, label: "其余四种", sub: "关系 / 人群包 / uid / rawSql", row: 2, tone: muted }
  - { id: err, label: throw, sub: "未知类型", row: 2, tone: red }
  - { id: out, label: 一段子 SQL, sub: "查出一批 uid", row: 3, kind: database }
edges:
  - { from: in, to: sw }
  - { from: sw, to: p, label: "portrait" }
  - { from: sw, to: e, label: "event" }
  - { from: sw, to: o, label: "..." }
  - { from: sw, to: err, label: "其它", dashed: true }
  - { from: p, to: out }
  - { from: e, to: out }
  - { from: o, to: out }
```

**每个条件实现都只有两个方法**：

```compare
first: 方法
head: [产出什么, 给谁用]
rows:
  - "`list(condition, decode)`": ["一段能查出 **uid 列表**的 SQL", "list 接口"]
  - "`count(condition)`": ["一段能数出**人数**的 SQL", "count 接口"]
```

```callout
tone: red
icon: ⚠
text: |
  **工厂遇到未知类型直接 `throw`，不静默返回空。**

  这个选择很重要：==静默失败会让 bug 跑到生产才被发现== ——
  生成的 SQL 少了一个条件，圈出来的人就多了一批。
```

```callout
tone: amber
icon: ⚠
text: |
  **六种实现各自的细节**（比如 `event.ts` 那 906 行里装了什么）
  展开在 [⑨ entrepot 篇](../sql-builder-v2-crowd-entrepot/)。
```

## 06 · 隔离：方言怎么吸收库差异

同一句业务话，两个数据库的 SQL 完全不一样：

```compare
first: 要做的事
head: [ByteHouse 写法, Doris 写法]
rows:
  - map 取 key: ["`mapElement(\\`name\\`, 'a')`", "`ELEMENT_AT(\\`name\\`, 'a')`"]
  - 判空: ["`isNull(\\`x\\`)`", "`\\`x\\` IS NULL`"]
  - 转整数: ["`toInt64(\\`x\\`)`", "`CAST(\\`x\\` AS SIGNED)`"]
  - JSON 数组包含: ["`hasAny(assumeNotNull(JSONExtract(...)))`", "`JSON_CONTAINS(CAST(... AS JSON))`"]
  - 相对时间戳: ["要 `UNIX_TIMESTAMP(...) * 1000` 包装", "不要包装（event_time 是 DATETIME）"]
```

### 关键：方言**不生成 SQL**

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==方言方法没有一个是直接产出 SQL 的。==

  它们返回两种东西：

  - **SQL 片段字符串** —— 被拼进 `Expression.raw`
  - **完整的表达式节点** —— core 内部的 `Expression` / `Rule`，直接进表达式树

  真正把表达式树变成 SQL 的是 **knex**，不是方言。
```

### 什么时候调方言

**只有属性类型特殊时才调** —— 普通条件（`=`、`>`、`IN`）根本不碰方言。

```compare
first: 属性类型
head: [调哪个方法, 返回什么]
rows:
  - 相对时间 + 时间戳: ["`getRelativeTimestampRules()`", "`Expression[]`"]
  - 正则匹配: ["`regexpMatchExpr()`", "`Expression`"]
  - JSON 数组: ["`jsonArrayContainsRule()`", "`Rule`"]
  - bool: ["`castBoolToInt()`", "`string`"]
  - map 取值: ["`mapPropertyAccess()`", "`string`"]
  - NULL 判断: ["`isNullCheck()`", "`string`"]
```

```callout
tone: amber
icon: ⚠
text: |
  **还有一点反直觉：方言不是 `buildWhere` 调的。**

  `buildWhere` 是静态方法，**签名里根本没有 dialect** —— 它压根不知道方言存在。

  ==全部方言调用都在 `crowd` 包里==，调用点是 `adapter()`。这是架构的一条裂缝。
```

### 什么时候决定用哪个实现

**不在翻译的时候决定，在最早的时候决定一次。**

```flow
grid: true
nodes:
  - { id: create, label: "SqlContext.create(dbType, options)", sub: "全库唯一入口", row: 0, kind: backend }
  - { id: q, label: "dbType 是什么？", row: 1, tone: amber, shape: note }
  - { id: bh, label: "Bytehouse 方言", sub: "无参即可", row: 2, tone: cloud }
  - { id: doris, label: "Doris 方言", sub: "必须传 eventTableMap", row: 2, tone: cloud }
  - { id: err, label: "throw", sub: "不支持的 dbType", row: 2, tone: red }
  - { id: mods, label: "注入三个模块", sub: "之后一路传下去", row: 3, kind: backend }
edges:
  - { from: create, to: q }
  - { from: q, to: bh, label: "Bytehouse" }
  - { from: q, to: doris, label: "Doris" }
  - { from: q, to: err, label: "其它", dashed: true }
  - { from: bh, to: mods }
  - { from: doris, to: mods }
```

```callout
tone: red
icon: ⚠
text: |
  **但每个条件类都写了兜底**：`dialect ?? new BytehouseDialect()`。

  意味着 ==忘了传 dialect 不会报错，会静默按 ByteHouse 生成 SQL==。
  Doris 场景下会生成**语法能跑但结果不对**的 SQL。

  这是设计上的一个取舍：向后兼容 vs 早点报错。它选了前者。
```

## 07 · 设计取舍

前面几节讲的都是「怎么工作」。这一节回答「**为什么这么设计**」。

```cards
cols: 2
items:
  - title: 为什么拆两个包
    tag: 边界
    tone: green
    desc: |
      因为 **core 里不许出现任何业务词汇**。

      守住这条，加一种数据库不用碰 crowd，加一种业务条件不用碰 core。
      ==这套设计的可扩展性就来自这一个约束。==

      验证方法：在 `core/src/` 里搜 `portrait` / `event_v2` / `crowd`，一个都搜不到。
  - title: 为什么方言不生成 SQL
    tag: 分层
    tone: violet
    desc: |
      因为方言只负责**「同一语义在不同库怎么写」**，不负责「表达式树怎么变成 SQL」。

      后者是 knex 的事。==如果把这两件事混在一起，方言接口会变成一堆 `buildWhere`。==

      所以方言方法的返回类型是「片段」或「节点」，不是「SQL」。
  - title: 为什么 Combination 和 Pkg 是两个类
    tag: 运算不同
    tone: amber
    desc: |
      因为**第一层要计数，第二层不计数**。

      AND / OR 靠 `HAVING count(uid) = N` 实现，必须知道谁命中了几次；
      include / exclude 只关心在不在，`NOT IN` 就够。

      ==运算性质不同，就没法合并。==
  - title: 为什么工厂直接 throw
    tag: 失败要响
    tone: red
    desc: |
      因为**静默失败更贵**。

      少一个条件的 SQL 语法完全合法，能跑，只是圈出来的人多了一批 ——
      这种 bug 会跑到生产才被发现。

      ==宁可构建时就炸。==
```

```callout
tone: amber
icon: ⚠
text: |
  **但也有一处是反过来的：`dialect ?? new BytehouseDialect()`。**

  同样是「出错」，这里选了**静默兜底**而不是 throw。
  理由是向后兼容（老调用方不传 dialect 也能跑）。

  ==同一个代码库里，两种相反的选择并存。== 这是真实工程的常态 ——
  新代码倾向「失败要响」，老代码倾向「别把现有调用方弄挂」。
```

## 08 · 扩展点

```cards
cols: 2
items:
  - title: 加一种数据库
    tag: 最容易
    tone: green
    desc: 实现方言的两个接口，在 `SqlContext` 里加一个 case。**core 完全不用改**
    code: |
      1. core/src/dialect/interface.ts
         → 实现 17 个方法
      2. crowd/src/dialect/
         → 再实现 getEventTable
      3. crowd/src/context.ts
         → _resolveDialect 加 case
  - title: 加一种条件入口
    tag: 中等
    tone: blue
    desc: 枚举加值 → 写一个类 → 在两个 switch 里注册
    code: |
      1. crowd/src/define.ts
         → Entrepots 枚举加值
      2. crowd/src/entrepots/<新文件>.ts
         → 实现 list / count
      3. crowd/src/entrepots/factory.ts
         → 两个 switch 各加 case
  - title: 加一个业务模块
    tag: 容易
    tone: blue
    desc: 写一个类持有方言，在 `SqlContext` 构造函数里加一行
  - title: 加一个通用 SQL 能力
    tag: ⚠ 有约束
    tone: amber
    desc: 加在 core。**注意：不能出现任何业务词**，否则两个包的边界就烂了
```

```callout
tone: green
icon: ✅
text: |
  ==这张表说明了一件事：所有扩展点都在边上，没有一个需要动中间。==

  - 加数据库 → 只碰方言
  - 加条件类型 → 只碰 entrepot
  - 加业务场景 → 只碰 module

  这正是「core 不知道业务」这个约束换来的。
```

## 09 · 自测

```quiz
- q: 「条件 A AND 条件 B」为什么不能用 SQL 的 AND 实现？
  a: |
    因为每个条件查的是**不同的表、不同的时间窗口**，没法拼进一个 WHERE。
    实际实现是**集合运算**：把各条件的 uid 用 `UNION ALL` 堆在一起，
    再 `GROUP BY uid` + `HAVING count(uid) = N`。
    OR 就是不加 HAVING，自定义数量就是 `>= N`。

- q: 两次翻译分别是谁在做，各自关心什么？
  a: |
    **第一次**在 `crowd` 包里：业务词汇 → 数据词汇，关心「最近 3 天」是什么意思。
    **第二次**在 `core` + knex：数据词汇 → SQL 文本，关心反引号、占位符、方言。
    这样分层换来的是 ==core 永远不知道「什么是相对时间」==，换业务场景时一行不用改。

- q: 方言是 `buildWhere` 调用的吗？
  a: |
    **不是。** `buildWhere` 是静态方法，签名里根本没有 dialect —— 它压根不知道方言存在。
    全部方言调用都在 `crowd` 包里，调用点是 `adapter()`。
    而且方言方法**不生成 SQL**，只返回「片段」或「表达式节点」，
    真正变成 SQL 的是 knex。

- q: include / exclude 为什么必须单独一层，不能并进 AND / OR 里？
  a: |
    因为**运算性质不同**：第一层（AND / OR）要**计数**（`HAVING count(uid) = N`），
    第二层（include / exclude）**不计数**，只关心在不在（`NOT IN` 就够）。
    这就是 `Combination` 和 `Pkg` 是两个类的原因。

- q: 工厂遇到未知的条件类型会怎样？为什么这样设计？
  a: |
    直接 `throw`，不静默返回空。
    因为少一个条件的 SQL **语法完全合法、能跑**，只是圈出来的人多了一批 ——
    这种 bug 会跑到生产才被发现。宁可构建时就炸。

- q: 为什么加数据库不用改 core？
  a: |
    因为 core 里的方言是**接口**，具体实现（ByteHouse / Doris）在各自的地方。
    加一种数据库只要实现接口 + 在 `SqlContext` 里加一个 case。
    更根本的原因是 ==core 里不许出现任何业务词汇== —— 守住这条边界，
    所有扩展点就都落在边上，没有一个需要动中间。
```
