# sql_builder_v2 架构

```callout
tone: blue
icon: 🧭
text: |
  这篇笔记按 **概念 → 组织 → 架构** 三层写。如果你完全没接触过这套代码，
  从第 01 节顺着读；已经懂业务的可以直接跳到第 07 节。
```

```cards
cols: 3
items:
  - { title: 概念, desc: 圈人是什么、画像和事件有什么区别、六种条件各是什么东西, tag: "01 ~ 04", tone: green }
  - { title: 组织, desc: 为什么需要这个库、一个需求怎么变成条件树、条件怎么组合, tag: "05 ~ 06", tone: blue }
  - { title: 架构, desc: 代码怎么分层、两个包怎么切、AND/OR 到底怎么实现的, tag: "07 ~ 13", tone: violet }
```

## 01 · 这个库是给谁用的

先忘掉代码。想象一个真实场景。

> 运营要发一张优惠券，==只发给「最近 7 天加购过、并且是 VIP」的用户==。

这句话要落地，系统必须回答一个问题：==这批人是谁？==

而数据是长这样的：

```text
用户 1001 最近 7 天加购过 3 次，VIP 等级 3   →  要发
用户 1002 最近 7 天没加购，VIP 等级 5        →  不发（没加购）
用户 1003 最近 7 天加购过 1 次，不是 VIP      →  不发（不是 VIP）
用户 1004 最近 7 天加购过 8 次，VIP 等级 4   →  要发
```

要找出这批人，得去数据库里查。**这就是「圈人」。**

```callout
tone: violet
icon: 🎯
quote: true
text: |
  圈人 = 按一组条件，从数据里筛出符合条件的用户 ID 列表。
```

## 02 · 四个基础概念

圈人系统里有几个词天天出现。**先搞懂它们，后面才看得懂。**

### uid —— 用户的唯一标识

一串代表「一个人」的编号。系统里到处都用它串起来。

有个细节：uid 在存储时是**加密**的，所以 SQL 里会出现两个函数：

```text
UID_ENCODE(1001)   -- 查询时把明文 uid 加密，用来跟库里的值比对
UID_DECODE(`uid`)  -- 取出时把加密的 uid 解密，给业务用
```

### 画像 Portrait —— 用户的「静态属性」

描述用户==当前是什么样==，存在 `user_portrait` 表。一行 = 一个人。

```text
uid    | futu_hk_account_gender_type | vip_level | city   | ...
-------|-----------------------------|-----------|--------|----
1001   | 1                           | 3         | 杭州   | ...
1002   | 2                           | 5         | 深圳   | ...
```

==关键特征：属性会被覆盖，只存当前值。== 用户今天改成 VIP 4，昨天是 VIP 3 这件事就没了。

### 事件 Event —— 用户的「行为流水」

描述用户**做过什么**，存在 `event_v2`（或 ByteHouse 的 `event_biz_N`）。一行 = 一个人 + 一个时刻 + 一个动作。

```text
$user_id | event_type | event_time      | 商品ID | ...
---------|------------|-----------------|--------|----
1001     | 加购       | 1758... 10:03   | A001   | ...
1001     | 加购       | 1758... 15:20   | B007   | ...
1001     | 下单       | 1758... 15:31   | B007   | ...
1004     | 加购       | 1758... 09:12   | A001   | ...
```

==关键特征：只追加，不覆盖。== 是流水账，所以能回答「最近 7 天加购了**几次**」。

```callout
tone: amber
icon: ⚠
text: |
  **注意两件事：**

  !!① 画像表的用户列叫 `uid`，事件表的叫 `$user_id`。!!
  名字不一样，所以事件查询必须做一次 join 把两边接起来：
  `left join ... on t1.uid = t2.$user_id`。
  这不是设计失误，是两个系统各自的历史遗留。

  !!② 事件表在 ByteHouse 里被拆成 8 张。!!
  按事件名哈希（`murmurhash(eventName) % 8 + 1`）决定去哪张，
  所以同一个查询里不同事件可能落在 `event_biz_3` 和 `event_biz_7`。
```

### 人群包 Crowd —— 预先算好的一批人

运营今天圈了一批人，明天还想用同一批。于是把结果**存下来**，给个编号，存在 `crowds` 表。

```text
crowd_id | crowd_version | uid
---------|---------------|------
C_888    | v3            | 1001
C_888    | v3            | 1002
C_888    | v3            | 1004
```

`crowd_version` 是版本号 —— 同一批人重新算一遍，结果可能变，所以要用版本区分「当时那批人」。

### 关系 Relation —— 用户和某个「对象」的关系

比如「领过 coupon001 这张券的人」。存在各种业务明细表里，用 `object_id` 表示那个对象。

```text
uid  | object_id
-----|-----------
1001 | coupon001
1002 | coupon001
1003 | coupon007
```

### 一张表看清区别

```compare
first: 概念
head: [回答什么问题, 存哪张表, 一行代表, 会变吗]
rows:
  - uid: [这是谁, { text: 到处都有, tone: muted }, 一个人, { text: 不变, tone: green }]
  - 画像 Portrait: [他现在是什么样, "`user_portrait`", 一个人的所有属性, { text: 会被覆盖, tone: amber }]
  - 事件 Event: [他做过什么、几次, "`event_v2` / `event_biz_N`", 一个人某一刻的一个动作, { text: 只追加, tone: green }]
  - 人群包 Crowd: [预先算好的一批人是谁, "`crowds`", 人群包 + 版本 + 一个人, { text: 只追加, tone: green }]
  - 关系 Relation: [他和某个对象什么关系, 各种业务明细表, 一个人 + 一个对象, { text: 只追加, tone: green }]
```

## 03 · 一个需求怎么变成「条件树」

回到那句话：**「最近 7 天加购过、并且是 VIP」**。

拆开看，它其实是两件事用 **并且** 连起来：

```text
        AND  ← 「并且」
       ╱    ╲
  事件条件    画像条件
  「加购」    「VIP」
  最近 7 天   等级 ≥ 3
  至少 1 次
```

- 左边是**事件条件**：查行为流水，算「加购了几次」
- 右边是**画像条件**：查属性表，看「VIP 等级是多少」
- 中间的 `AND` 是**逻辑**，说明两边都要满足

如果运营说「最近 7 天加购过 **或者** 是 VIP」，那中间的 `AND` 就换成 `OR`。

```callout
tone: green
icon: 🌳
tinted: true
text: |
  这种「用 AND / OR 把条件串起来的树形结构」，就叫**条件树**。

  叶子节点是**具体条件**（加购、VIP），中间节点是**逻辑**（AND / OR）。
  树可以嵌套：AND 里套 OR，OR 里再套 AND。
```

换成 JSON，大概长这样：

```json
{
  "logic": "AND",
  "conditions": [
    { "type": "event",    "condition": { "事件": "加购", "时间": "最近7天", "次数": ">0" } },
    { "type": "portrait", "condition": { "vip_level": ">= 3" } }
  ]
}
```

## 04 · 六种条件单元

树的叶子不只有「事件」和「画像」。系统里一共支持 **6 种**，这是这个库的**词汇表**：

```cards
cols: 3
items:
  - { title: 画像 portrait, desc: 用户的静态属性。查 user_portrait 表, tag: 最常见, tone: green }
  - { title: 事件 event, desc: 做过什么事、几次。查事件表，最复杂的一个, tag: 功能最多, tone: violet }
  - { title: 人群包 crowd, desc: 预先算好的一批人。查 crowds 表, tag: 可复用, tone: blue }
  - { title: uid, desc: 直接给一批用户 ID，不查表。常用于「这批人再加上…」, tag: 最简单, tone: muted }
  - { title: 关系 relation, desc: 和某个对象的关系。查各种业务明细表, tag: 按对象, tone: amber }
  - { title: rawSql, desc: 直接塞一段 SQL。逃生口，前五种表达不了时用, tag: 兜底, tone: red }
```

### 每种条件的最小例子（真实入参 → 真实 SQL）

**① 画像：查性别是 1、2、3 的人**

```text
入参：{ op: 'IN', name: 'futu_hk_account_gender_type', value: [1, 2, 3] }

SQL ：select `uid` from `user_portrait`
      where (`futu_hk_account_gender_type` in (1, 2, 3))
```

**② uid：直接给三个人**

```text
入参：['111', '222', '333']

SQL ：select `uid` from (
        select arrayJoin(array(UID_ENCODE('111'), UID_ENCODE('222'), UID_ENCODE('333'))) as `uid`
      ) uidt group by `uid`
```

**③ 关系：领过 coupon001 或 coupon002 的人**

```text
入参：{ op: 'IN', table: 'niuniu_user_coupon_receive_last', objectIds: ['coupon001', 'coupon002'] }

SQL ：select `uid` from `niuniu_user_coupon_receive_last`
      where `object_id` in ('coupon001', 'coupon002')
      group by `uid`          -- 一个人领两张券会出现两次，要去重
```

**④ 人群包：C_888 这个包的 v3 版本**

```text
入参：{ crowdId: 'C_888', crowdVersion: 'v3' }

SQL ：select `uid` from `crowds`
      where `crowd_id` = 'C_888' and `crowd_version` = 'v3'
      group by `uid`
```

**⑤ 事件：最近 3 天点过某事件、且 fdid 为空、超过 3 次的人**

```text
入参：{ 事件: 'ClickSimStockMatchedEvent', 时间: '最近3天', 过滤: 'fdid is null', 次数: '> 3' }

SQL ：select `uid` as `uid`
      from `user_portrait` as `t1`
      left join (
        select `$user_id`, count(1) as `cnt`
        from `dws`.`event_biz_5`                    -- ← 哈希分片后的表名
        where (`event_type` = 'ClickSimStockMatchedEvent'
          and `event_time` >= UNIX_TIMESTAMP(DS_DATETIME_ADD('day', -3, ...)) * 1000
          and `event_time` <  UNIX_TIMESTAMP(...) * 1000
          and ((isNull(`fdid`))))
        group by `$user_id`                          -- ← 按人算次数
      ) as `t2` on `t1`.`uid` = `t2`.`$user_id`      -- ← 画像表 join 事件表
      where ifNull(`t2`.`cnt`, 0) > 3                -- ← 没做过的人 cnt 是 NULL，当 0 处理
```

```callout
tone: violet
icon: 💡
text: |
  事件条件的 SQL 明显比其他五种复杂，因为它要同时处理四件事：
  **事件名 + 时间范围 + 属性过滤 + 次数阈值**。
  这也解释了为什么 `entrepots/event.ts` 有 906 行，是第二名的两倍多。
```

**⑥ rawSql：直接透传一段 SQL。** 没有结构，原样拼进去。

## 05 · 所以这个库到底在做什么

到这里可以一句话说清了：

```callout
tone: blue
icon: ⚙
quote: true
text: |
  输入一棵**条件树**（业务语言），输出一段 **SQL**（数据库语言）。
```

最小的例子只需要一行映射：

```compare
first: 输入（业务语言）
head: [输出（SQL）]
rows:
  - "{ op: 'IN', name: 'gender_type', value: [1,2,3] }": ["`select uid from user_portrait where gender_type in (1,2,3)`"]
```

**那为什么需要一个库？** 因为真实的输入输出不是一对一，有三个矛盾：

```cards
cols: 3
items:
  - { title: 矛盾一 · 语义不同, desc: 条件树是业务概念（加购、VIP），SQL 是数据库概念（表、列、join）。中间要有一层翻译, tag: 翻译, tone: blue }
  - { title: 矛盾二 · 库有两种, desc: 同一棵条件树，要能在 Doris 和 ByteHouse 上跑。两个库的函数名、表结构都不一样, tag: 方言, tone: violet }
  - { title: 矛盾三 · 条件要能任意组合, desc: AND / OR 要能无限嵌套。而每个条件查的是不同的表，没法拼进一个 WHERE, tag: 组合, tone: amber }
```

矛盾一和二在后面的架构里很好认。==矛盾三最难，它导致了一个反直觉的设计== —— 第 10 节专门讲。

## 06 · 组织：一棵树 + 六种叶子 + 两层组合

把概念层的东西组织起来看，整个系统就三个部分：

```lane-stack
- title: 一棵树
  desc: 用户提交进来的东西
  tone: blue
  nodes:
    - { title: 条件树, sub: "logic + conditions", tag: 可嵌套 }
    - { title: 叶子 = 六种条件, sub: "portrait / event / crowd / uid / relation / rawSql" }
  next: "拆开 :: :: 树归树，叶子归叶子"

- title: 两层组合
  desc: 「组合」有两种，很容易混
  tone: violet
  nodes:
    - { title: 第一层：条件之间, sub: "AND / OR，用 UNION ALL + GROUP BY + HAVING 实现", tag: 集合运算 }
    - { title: 第二层：二次加工, sub: "include 加一批人 / exclude 减一批人", tag: 增删 }
  next: "翻译 :: :: 交给具体的条件实现"

- title: 六种叶子各自的翻译器
  desc: 每种条件知道自己该查哪张表、怎么写 WHERE
  tone: green
  nodes:
    - { title: Portrait / Event / Relation }
    - { title: Uid / Crowd / RawSql }
```

```callout
tone: amber
icon: ⚠
text: |
  ==「两层组合」是最容易混的地方。==

  - **第一层**是「条件之间怎么连」：`加购 AND VIP` —— 这是**集合运算**
  - **第二层**是「算完一批人之后再增删」：先算出「加购的人」，再 `include` 一批白名单、`exclude` 一批黑名单

  第 09 节会讲第二层为什么必须单独存在。
```

---

## 07 · 架构：一条条件要走 8 层

概念讲完了。下面是代码怎么实现这套东西。

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
    - { title: Combination, sub: "UNION ALL + GROUP BY + HAVING", tag: 第一层 }
    - { title: Pkg, sub: "include: UNION ALL / exclude: NOT IN", tag: 第二层 }
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

## 08 · 两个包的边界

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
  - { title: 时间表达式, desc: "getTimeRules / generateLatestDaysRules 等，把「最近 7 天」转成 SQL 条件", tone: green }
```

## 09 · 六个核心角色

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

## 10 · 最不直觉的设计：AND / OR 不是 SQL 的 AND / OR

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

## 11 · 一条条件是怎么变成 SQL 的

```journey
- tag: ① 入参
  tone: muted
  name: BuildInfoTree
  badge: 四种形态
  code: |
    {
      main:     { type: 'event', condition: {...} },        // 主体条件
      include:  [ { entrepot: {...}, type: 'include' } ],   // 二次包含
      exclude:  [ { entrepot: {...}, type: 'exclude' } ]    // 二次排除
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
    const _main   = getMainStruct(tree);               // 取主体
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

### 为什么「二次加工」必须单独存在

第 06 节提到的第二层组合。举一个具体场景：

> 「先圈出最近 7 天加购的人，**但要把内部测试账号剔掉**，**再加上运营给的白名单**。」

这是三步，不是一步：

```text
① 主体条件 → 算出「最近 7 天加购的人」
② include  → 并上白名单（UNION ALL + GROUP BY 去重）
③ exclude  → 减掉测试账号（NOT IN）
```

`exclude` 之所以能写成 `NOT IN`，是因为它只需要**排除**，不需要保留谁出现过几次 —— 这和第一层的 AND（必须计数）是不同的运算。

```callout
tone: amber
icon: ⚠
tinted: true
text: |
  这就是为什么 `Combination` 和 `Pkg` 是两个类而不是一个：
  **第一层做集合运算（要计数），第二层做集合增删（不计数）。**
```

## 12 · 方言策略：同一套条件，两种数据库

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
  - { title: "getRelativeTimestampRules", desc: "把「最近 7 天」转成 SQL" }
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
  这是向后兼容的默认值 —— 意味着!!忘了传 dialect 不会报错，会静默按 ByteHouse 生成 SQL!!。
  Doris 场景下这会生成语法能跑但结果不对的 SQL，是个真实的坑。
```

## 13 · 扩展点

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
  这套设计的可扩展性来自一个约束：==core 里不许出现业务词汇==。
  只要守住这条，加数据库不用碰 crowd，加业务条件不用碰 core。
```

## 14 · 自测

```quiz
- q: 画像和事件最本质的区别是什么？
  a: |
    画像存的是**当前状态**，会被覆盖 —— 只回答「他现在是什么样」。
    事件存的是**行为流水**，只追加 —— 能回答「他做过什么、几次」。
    所以「最近 7 天加购了 3 次」只能查事件表，画像表里没有这个信息。
- q: 为什么事件条件的 SQL 里要 `left join` 画像表？
  a: |
    因为两边用户列的名字不一样：画像表叫 `uid`，事件表叫 `$user_id`。
    而且事件条件是「按人算次数」——子查询里 `group by $user_id` 得到每个人的次数，
    再 join 回画像表才能输出统一的 `uid` 列。
    用 `left join` + `ifNull(cnt, 0)` 是为了让「一次都没做过」的人也能被算成 0 次。
- q: 条件树里的 AND，为什么不能直接写成 SQL 的 `WHERE A AND B`？
  a: |
    因为每个条件查的是**不同的表、不同的时间窗口**，没法拼进同一个 WHERE。
    实际实现是集合运算：`UNION ALL` 把各条件的 uid 堆在一起，
    `GROUP BY uid` 计数，`HAVING count(uid) = N` 表示「N 个条件都命中」。
- q: "`Combination.combineSql` 里 OR 和 AND 的差别体现在哪一行？"
  a: |
    只差在要不要加 HAVING。
    AND 会执行 `query.having(havingCount(UID), Op.Eq, sqls.length)`；
    OR 不加 HAVING，`GROUP BY uid` 后任一子查询命中就保留。
- q: 为什么 `Combination` 和 `Pkg` 是两个类？
  a: |
    因为它们做的是两种运算：
    `Combination` 做**集合运算**（AND 要数 count，靠 HAVING）；
    `Pkg` 做**集合增删**（include 是并集，exclude 是 NOT IN，不需要计数）。
    混在一起会让「计数」这个语义变得含糊。
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
```
