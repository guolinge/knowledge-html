# sql_builder_v2 架构

## 01 · 这个库解决什么问题

**输入**：一棵「圈人条件」的 JSON 树。
**输出**：一段能在 Doris 或 ByteHouse 上跑的 SQL。

```compare
first: 输入
head: [说明, 对应类型]
rows:
  - 条件树: ["AND( 事件:加购, 画像:VIP )", "`BuildInfoTree`"]
  - 条件单元: [6 种，每种有自己的字段结构, "`EntrepotStruct`"]
  - 目标库: [同一个条件树要能出两种方言的 SQL, "`DbType.Doris` / `DbType.Bytehouse`"]
```

这个库的全部复杂度都来自一个矛盾：**条件树是业务语义，SQL 是数据库语义，而数据库有两种。**

```callout
tone: violet
icon: 🎯
quote: true
text: |
  架构的核心目标：把「业务条件」和「某个具体数据库怎么写 SQL」彻底隔开。
```

## 02 · 整体架构：一条条件要走 8 层

```lane-stack
- badge: LAYER 01
  title: 调用方
  desc: 业务代码 / 数据网关
  tone: muted
  nodes:
    - { title: 业务服务, sub: 传入条件树 JSON }
    - { title: 数据网关, sub: 只接受 UNION ALL，不接受 UNION }
  next: "SqlContext.create(dbType, options) :: :: 全库唯一入口"

- badge: LAYER 02
  title: 门面层
  desc: 解析目标库，构造方言与模块
  tone: blue
  group: "packages/crowd —— 用户域语义"
  nodes:
    - { title: SqlContext, sub: "static create()", tag: 唯一入口 }
    - { title: _resolveDialect, sub: "Bytehouse | Doris", tag: 策略选择 }
  next: "构造三个模块 :: :: 模块持有 dialect，不持有连接"

- badge: LAYER 03
  title: 领域模块
  desc: 面向具体业务场景的出口
  tone: blue
  group: "packages/crowd —— 用户域语义"
  nodes:
    - { title: TagModule, sub: "list / count" }
    - { title: CrowdModule, sub: "list / count / selectRaw" }
    - { title: SegmentModule, sub: "list / count", tone: violet }
  next: "组合与二次加工 :: :: AND/OR · include/exclude"

- badge: LAYER 04
  title: 组合层
  desc: 把多个条件拼成一个用户集合
  tone: violet
  group: "packages/crowd —— 用户域语义"
  nodes:
    - { title: Combination, sub: "UNION ALL + GROUP BY + HAVING", tag: AND/OR }
    - { title: Pkg, sub: "include: UNION ALL / exclude: NOT IN", tag: 二次加工 }
  next: "工厂分发 :: :: 按 condition.type 选实现"

- badge: LAYER 05
  title: 入口分发
  desc: 六种条件各自的 SQL 生成器
  tone: violet
  group: "packages/crowd —— 用户域语义"
  nodes:
    - { title: initEntrepotListSqlGen, sub: "返回 (condition, decode) => string" }
    - { title: initEntrepotCountSqlGen, sub: "返回 (condition) => string" }
  next: "switch (condition.type) :: :: 未知类型直接 throw"

- badge: LAYER 06
  title: 条件实现
  desc: 六种「入口」，每种一个类
  tone: violet
  group: "packages/crowd —— 用户域语义"
  nodes:
    - { title: Portrait, sub: "user_portrait" }
    - { title: Event, sub: "event_v2", tag: 最复杂 }
    - { title: Relation, sub: "关系条件" }
    - { title: Uid, sub: "直接给 uid 列表" }
    - { title: Crowd, sub: "crowds" }
    - { title: RawSql, sub: "裸 SQL 透传" }
  next: "DB.buildWhere / DB.raw :: :: 只在这里才碰 knex"

- badge: LAYER 07
  title: 通用 SQL 构造
  desc: 与具体数据库无关的表达式树 → knex builder
  tone: green
  group: "packages/core —— 与 DB 无关的通用层"
  nodes:
    - { title: "Expression / Condition / Rule", sub: "递归 AST", tag: 核心抽象 }
    - { title: DB.buildWhere, sub: "递归展开成 andWhere / orWhere" }
    - { title: DB.unionAllRaws, sub: "只支持 UNION ALL" }
    - { title: DB.formatField, sub: "反引号包裹列名" }
    - { title: "encodeUid / decodeUid", sub: "UID_ENCODE / UID_DECODE" }
  next: "knex 编译 :: :: mysql queryBuilder"

- badge: LAYER 08
  title: 输出
  desc: 一段 SQL 字符串
  tone: muted
  nodes:
    - { title: SQL 字符串, sub: "交给网关执行" }
```

```callout
tone: green
icon: ↗
tinted: true
text: |
  **依赖方向是单向的**：`crowd` 依赖 `core`，`core` 不知道 `crowd` 存在。
  core 里搜不到任何 `portrait` / `crowd` / `event_v2` 这类业务词 —— 这是两个包能拆开的前提。
```

## 03 · 两个包的边界

```compare
first: 维度
head: ["packages/core", "packages/crowd"]
rows:
  - 定位: [与数据库无关的通用 SQL 构造, 用户域的圈人语义]
  - 知道业务吗: [{ text: 完全不知道, tone: green }, 知道，且有大量枚举]
  - 核心导出: ["DB · Expression · SqlDialect · encodeUid", "SqlContext · 三个 Module · 六种 Entrepot"]
  - 依赖: [knex, "core + knex + lodash + murmurhash"]
  - 能单独用吗: [{ text: 能, tone: green }, { text: 不能，必须带 core, tone: amber }]
```

core 提供的通用能力：

```cards
cols: 3
items:
  - { title: Expression 表达式树, desc: "Normal / RawValue / RawColumn / Raw 四种形态，可递归嵌套 Condition", tone: green }
  - { title: DB.buildWhere, desc: 把表达式树递归展开成 knex 的 andWhere / orWhere 调用, tone: green }
  - { title: SqlDialect 接口, desc: 14 个方法，覆盖类型转换、JSON 数组、时间范围、多条件选择, tone: green }
  - { title: UID 编解码, desc: "encodeUid / decodeUid 包成网关函数 UID_ENCODE / UID_DECODE", tone: green }
  - { title: treeMinimizer, desc: 递归压掉只有一个子节点的组合结构, tone: green }
  - { title: 时间表达式, desc: "getTimeRules / generateLatestDaysRules 等，把相对时间转成 SQL 条件", tone: green }
```

## 04 · 六个核心角色

```cards
cols: 3
items:
  - { title: SqlContext, desc: 唯一入口。解析 dbType、选方言、把方言注入三个模块, tag: 门面, tone: blue }
  - { title: Module, desc: "对外出口，一个业务场景一个。持有 dialect 和组合器", tag: 领域层, tone: blue }
  - { title: Combination, desc: 把多个条件的用户集合做 AND / OR / 自定义数量, tag: 组合, tone: violet }
  - { title: Entrepot, desc: "「条件入口」。六种，每种知道自己该查哪张表", tag: 条件, tone: violet }
  - { title: GroupSqlDialect, desc: "SqlDialect + getEventTable。所有数据库差异都在这里", tag: 策略, tone: amber }
  - { title: DB, desc: "core 里的静态工具，唯一直接碰 knex 的地方", tag: 基础设施, tone: green }
```

## 05 · 最不直觉的设计：AND / OR 不是 SQL 的 AND / OR

看到「条件 A **AND** 条件 B」，直觉会写：

```sql
-- ❌ 直觉写法：对同一个用户，既要命中 A 又要命中 B
SELECT uid FROM event_add_cart WHERE ... AND uid IN (SELECT uid FROM user_portrait WHERE ...)
```

但这里每个条件查的是**不同的表、不同的时间窗口**，没法拼成一个 WHERE。
所以实际实现是**集合运算**：

```callout
tone: amber
icon: ⚠
quote: true
text: |
  AND / OR 被实现成「对 uid 做集合运算」，而不是 SQL 的 AND / OR。
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

一句话总结这套机制：

```compare
first: 逻辑
head: [SQL 怎么写, 结果]
rows:
  - OR: ["GROUP BY uid，不加 HAVING", "任一条件命中即保留"]
  - AND: ["GROUP BY uid，HAVING count(uid) = N", "N 个子查询里都出现才保留"]
  - 自定义数量: ["GROUP BY uid，HAVING count(uid) >= 2", "至少 N 个条件命中"]
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
  还有一个细节：`DB.unionAllRaws` 的注释写着 **「网关只支持 union all，不支持 union」**。
  所以这里用 UNION ALL + GROUP BY 去重，而不是 UNION —— 这不只是性能选择，是下游能力约束。
```

## 06 · 一条条件是怎么变成 SQL 的

```journey
- tag: ① 入参
  tone: muted
  name: BuildInfoTree
  badge: 四种形态
  code: |
    {
      main:     { type: 'event', condition: {...} },   // 主体条件
      include:  [ { entrepot: {...}, type: 'include' } ],  // 二次包含
      exclude:  [ { entrepot: {...}, type: 'exclude' } ]   // 二次排除
    }
  note: |
    也可能是裸的 `EntrepotStruct`，或者是 `{ logic, conditions }` 组合树。
    三种形态都要能处理。
  next: "SqlContext.create :: :: 先定方言"

- tag: ② 门面
  tone: blue
  name: SqlContext.create(dbType, options)
  code: |
    Doris     → new DorisGroupDialect(eventTableMap)   // 不传 eventTableMap 直接 throw
    Bytehouse → new BytehouseGroupDialect()
  note: |
    方言在这里被选定，然后注入三个模块。**之后再也不会变**。
  next: "module.list(tree, decode) :: :: 按业务场景选模块"

- tag: ③ 模块
  tone: blue
  name: CrowdModule.list
  code: |
    const _main   = getMainStruct(tree);              // 取主体
    const _ieInfo = checkAndGetIncluOrExcluRule(tree); // 取 include/exclude
  note: |
    把「一棵树」拆成「主体 + 二次加工规则」两部分，分别处理。
  next: "initMajorListSqlGen :: :: 进组合层"

- tag: ④ 组合
  tone: violet
  name: Combination.combineSql
  badge: 核心
  code: |
    conditions.map(c => entrepotListGen(c, false))   // 每个条件一段子 SQL
      → DB.unionAllRaws(sqls)                        // UNION ALL 拼起来
      → GROUP BY uid                                 // 按用户归并
      → HAVING count(uid) = sqls.length              // AND 时才有
  note: |
    递归处理嵌套的 `{ logic, conditions }`，内层不解码，**只有最外层 decode**。
  next: "Pkg.list :: :: 二次加工"

- tag: ⑤ 二次加工
  tone: violet
  name: Pkg.list(majorSql, rules, decode)
  code: |
    include → UNION ALL(major, minor) + GROUP BY uid   // 并集，顺带去重
    exclude → major WHERE uid NOT IN (minor)           // 差集
  note: |
    多条规则时按 `options.order` 排序，**order 越小权重越大**，
    然后从 main 开始依次 reduce。
  next: "decodeUid :: :: 出口统一包一层"

- tag: ⑥ 出口
  tone: green
  name: decodeUid
  code: |
    SELECT UID_DECODE(`uid`) as `uid` FROM ( ... ) ct1
  note: |
    所有模块对外暴露的列名都是 `uid`，加密与否由 decode 参数决定。
    `noDecodedSqlGen()` 可以反向把这一层剥掉。
```

## 07 · 六种条件入口

```cards
cols: 3
items:
  - { title: Portrait, desc: 查 user_portrait 表，属性过滤。支持树形条件, tag: "type: portrait", tone: blue }
  - { title: Event, desc: 查事件表，最复杂的一个（906 行）。含时间范围、属性过滤、公式聚合, tag: "type: event", tone: violet }
  - { title: Relation, desc: 关系条件，检查是否存在某种排除操作, tag: "type: relation", tone: amber }
  - { title: Uid, desc: 直接给 uid 列表，最简单。可标记是否已加密, tag: "type: uid", tone: green }
  - { title: Crowd, desc: 查 crowds 表，按 crowdId + crowdVersion 圈人, tag: "type: crowd", tone: green }
  - { title: RawSql, desc: 裸 SQL 透传，逃生口, tag: "type: rawSql", tone: muted }
```

分发方式是工厂 + switch，**未知类型直接抛错**而不是静默返回空：

```text
// packages/crowd/src/entrepots/factory.ts
switch (condition.type) {
    case Entrepots.Portrait: return _portraitInstance.list(condition.condition, decode);
    ...
    default:
        throw new Error('无效的条件结构（未知条件类型）: ' + JSON.stringify(condition));
}
```

```callout
tone: amber
icon: 🔍
text: |
  注意 `factory.ts` 里每个 `initXxxSqlGen` 都**提前 new 好六个实例**，
  只有 `Event` 因为要传 `options` 而每次新建。
  这是个刻意的取舍：常用路径零分配，特殊路径牺牲一点性能换正确性。
```

## 08 · 方言策略：同一套条件，两种数据库

```compare
first: 维度
head: [ByteHouse, Doris]
rows:
  - 事件表怎么定位: ["按事件名 murmurhash 分片", "调用方传入 eventTableMap"]
  - 事件表名: ["`dws.event_biz_N` / `dws.event_monitoring_N`", 由调用方决定]
  - 分片规则: ["`murmurhash.v3(eventName, 0) % 8 + 1` → 8 张表", { text: 无分片, tone: muted }]
  - 构造要求: [{ text: 无参即可, tone: green }, { text: 必须传 eventTableMap，否则 throw, tone: red }]
  - 默认值: [{ text: 是（各构造函数 fallback）, tone: green }, { text: 否，必须显式传, tone: amber }]
```

`GroupSqlDialect` 只比 core 的 `SqlDialect` 多一个方法：

```text
// packages/crowd/src/dialect/interface.ts
export interface GroupSqlDialect extends SqlDialect {
    getEventTable(params: EventTableParams): string;
}
```

而 `SqlDialect` 本身有 14 个方法，全是**「同一种语义在不同库怎么写」**：

```cards
cols: 4
items:
  - { title: mapPropertyAccess, desc: "map 取值：mapElement(p,'k') vs p['k']", tone: amber }
  - { title: "castToInt / castToFloat", desc: 类型转换 }
  - { title: "regexpMatchExpr", desc: 正则匹配表达式 }
  - { title: "jsonArrayContainsRule", desc: JSON 数组包含 / 相等 }
  - { title: "getRelativeTimestampRules", desc: 相对时间范围 }
  - { title: "getAbsoluteTimestampRules", desc: 绝对时间范围 }
  - { title: multiIf, desc: 多条件选择 }
  - { title: arrayExpandSql, desc: "UNION ALL 展开数组" }
```

```callout
tone: amber
icon: ⚠
tinted: true
text: |
  **每个条件类都写着 `dialect ?? new BytehouseDialect()`。**
  这是向后兼容的默认值 —— 意味着**忘了传 dialect 不会报错，会静默按 ByteHouse 生成 SQL**。
  Doris 场景下这会生成语法能跑但结果不对的 SQL，是个真实的坑。
```

## 09 · 组合层还有个「压缩」步骤

```journey
- tag: 输入
  tone: muted
  name: 嵌套组合树
  badge: 可能很啰嗦
  code: |
    { logic: 'AND', conditions: [
        { logic: 'OR', conditions: [ { type: 'portrait', ... } ] }   // 只有一个子节点
    ]}
  note: 外部系统可能生成这种「只有一个孩子的组合」，直接翻译会多出一层 UNION ALL。
  next: "Combination.minimize :: :: 递归压平"

- tag: 输出
  tone: green
  name: 压缩后
  code: |
    { type: 'portrait', ... }
  note: |
    `treeMinimizer(tree, 'conditions')` 递归下去，
    单节点组合直接塌缩成那个节点本身。
```

## 10 · 扩展点

```cards
cols: 2
items:
  - { title: 加一种数据库, desc: "实现 SqlDialect + GroupSqlDialect 两个接口，在 SqlContext._resolveDialect 加一个 case。core 完全不用改", tone: green }
  - { title: 加一种条件入口, desc: "在 Entrepots 枚举加值 → 写一个类实现 list/count → 在 factory 的两个 switch 里注册", tone: blue }
  - { title: 加一个业务模块, desc: "写一个 Module 类持有 dialect，在 SqlContext 构造函数里加一行", tone: blue }
  - { title: 加一个通用 SQL 能力, desc: "加在 core。注意：**不能出现任何业务词**，否则两个包的边界就烂了", tone: amber }
```

```callout
tone: green
icon: ✅
text: |
  这套设计的可扩展性来自一个约束：**core 里不许出现业务词汇**。
  只要守住这条，加数据库不用碰 crowd，加业务条件不用碰 core。
```

## 11 · 自测

```quiz
- q: 为什么 AND 不能直接写成 SQL 的 `WHERE A AND B`？
  a: |
    因为每个条件查的是**不同的表、不同的时间窗口**，没法拼进同一个 WHERE。
    实际实现是集合运算：`UNION ALL` 把各条件的 uid 堆在一起，
    `GROUP BY uid` 计数，`HAVING count(uid) = N` 表示「N 个条件都命中」。
- q: "`Combination.combineSql` 里 OR 和 AND 的差别体现在哪一行？"
  a: |
    只差在要不要加 HAVING。
    AND 会执行 `query.having(havingCount(UID), Op.Eq, sqls.length)`；
    OR 不加 HAVING，`GROUP BY uid` 后任一子查询命中就保留。
- q: 为什么用 UNION ALL 而不是 UNION？
  a: |
    两个原因：一是 `DB.unionAllRaws` 的注释写明**网关只支持 union all**；
    二是这里本来就要 `GROUP BY uid` 去重，UNION 的去重是多余的。
- q: 忘传 dialect 会发生什么？
  a: |
    **不会报错。** 每个条件类的构造函数都写着 `dialect ?? new BytehouseDialect()`，
    会静默按 ByteHouse 生成 SQL。Doris 场景下会生成语法能跑但结果不对的 SQL。
- q: core 和 crowd 的边界靠什么维持？
  a: |
    靠一条约束：**core 里不出现任何业务词汇**。
    core 不知道 portrait / crowd / event_v2 这些概念，
    所以加数据库不用改 crowd，加业务条件不用改 core。
- q: "`Pkg` 的 include 和 exclude 分别生成什么 SQL？"
  a: |
    include → `UNION ALL(major, minor)` + `GROUP BY uid`（并集，顺带去重）；
    exclude → `major WHERE uid NOT IN (minor)`（差集）。
    多条规则按 `options.order` 排序，order 越小权重越大。
```
