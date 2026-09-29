运营同学在界面上点几下：**年龄 ≥ 18、地区 = 美国、总资产 ≥ 1000**，然后点「查询」。

下一秒她看到「共 1413 人」，还有一份名单表格。

中间发生了什么？

一个 1700 行的包 —— `@insight/dsl` —— 把「她点出来的条件」翻译成了数据库能跑的 SQL。

```callout
tone: blue
icon: 🎯
text: |
  **这篇回答三个问题**：

  - 这个包由什么组成、怎么工作？
  - 它为什么这么设计（三处反直觉的地方）？
  - 它现在缺什么？

  ==读完你应该能自己说出「用户勾的条件是怎么变成 SQL 的」，而不是记住一张架构图。==
```

---

## 01 · 它解决什么问题

### 先看一条真实的链路

```lane-stack
- badge: 用户那侧
  title: 运营在界面上点
  desc: 她说的是业务语言：「美国的高净值客户」
  tone: muted
  nodes:
    - { title: 圈选界面, sub: "下拉框 + 条件组", tag: 前端 }
    - { title: 条件树, sub: "AND(年龄≥18, 地区=US, 资产≥1000)", tag: JSON }
  next: "HTTP :: POST /api/preview :: 条件树原样传过去"

- badge: 后端 · 这个包在的地方
  title: 翻译
  desc: 把业务语言变成数据库语言
  tone: violet
  group: "@insight/dsl"
  nodes:
    - { title: 语法检查, sub: "形状对不对", tag: 不需要数据库 }
    - { title: 语义检查, sub: "字段存在吗、值类型对吗", tag: 要字段字典 }
    - { title: 生成 SQL, sub: "4 段字符串", tag: 纯字符串拼接 }
  next: "SQL :: :: 到这里为止，一行数据都没查"

- badge: 数据库那侧
  title: Doris 执行
  desc: 真的去 100 万行里捞人
  tone: green
  nodes:
    - { title: 宽表扫描, sub: "user_portraits_wide", tag: 100 万行 }
    - { title: 结果, sub: "1413 个人", tag: 毫秒级 }
```

**注意中间那一层里最关键的一句**：==这个包只产字符串，它不认识数据库、不认识 HTTP。==

### 为什么不能让前端直接拼 SQL

看起来「拼个 WHERE」很简单。真做起来有四个坑：

```checklist
tone: cross
items:
  - 前端能拼 SQL，就等于把表结构和字段名暴露给了浏览器
  - 权限会做成「查完再过滤」—— 总有某个接口忘了过滤，于是越权
  - 每个页面自己拼一套，同一个「年龄」在不同页面算法不一样
  - 注入、NULL、枚举值、分页…… 每个坑都要每个页面各踩一遍
```

换成这个包之后，上面四条各自有了一个明确的对策：

```compare
first: 坑
head: [对策, 落在哪]
rows:
  - 表结构暴露: ["界面只说 `age`，物理列名 `birthday` 留在服务端", "字段字典"]
  - 权限漏过滤: ["权限编进 WHERE，不是查完再过滤", "身份（Actor）"]
  - 口径不一致: ["「年龄」怎么算只有一处定义", "派生字段"]
  - 注入 / NULL / 分页: ["只在这一个包里踩一次，332 个测试看住", "校验器 + 夹具"]
```

```callout
tone: green
icon: ✅
text: |
  ==一句话：把「业务条件 → SQL」这件事，从「每个页面各做一遍」变成「一个包做一遍」。==

  这就是它存在的理由。剩下的所有设计，都是为了让这件事做得住。
```

---

## 02 · 先搞清五个词

后面全篇都用这五个词。**每个都配了真实数据的样子。**

```cards
cols: 2
items:
  - title: 圈选
    desc: "按条件从全部客户里筛出一批人，筛出来的这批人叫「人群」。"
    tag: 业务词
    tone: muted
    body: |
      运营的日常：给「美国的高净值客户」推一个新产品，得先知道**这批人是谁**，才能发券、打电话、做报表。

      这批人可能几十个，也可能几百万个 —— 所以不能手点，得用条件描述。
  - title: 条件树（AST）
    desc: "把「年龄≥18 且 地区=US」写成一份 JSON。它是**用户圈了什么**的唯一表达。"
    tag: 输入
    tone: blue
    body: |
      ```json
      { "type": "group", "logic": "AND", "children": [
        { "type": "portrait", "field": "age", "op": "gte", "value": 18 },
        { "type": "portrait", "field": "region", "op": "eq", "value": "US" }
      ]}
      ```

      ==它只有形状，没有语义== —— `field: "不存在的字段"` 也是合法 JSON，
      对不对要等下一步查字典。
  - title: 字段字典（Catalog）
    desc: "回答「有哪些字段、每个字段长什么样」。它是**能圈什么**的唯一真相。"
    tag: 输入
    tone: violet
    body: |
      一条字典长这样：

      ```json
      { "name": "age", "label": "年龄",
        "table": "user_portraits_wide", "column": "birthday",
        "valueType": "int", "ops": ["gt","gte","lt","lte","eq","between"],
        "derive": { "kind": "age_years" } }
      ```

      !!注意 `name` 是 `age`，而 `column` 是 `birthday`。!! 这两者不一样 —— 第 05 节会讲为什么。
  - title: 身份（Actor）
    desc: "回答「谁在圈、他能看多少人」。它不参与「圈什么」，只决定**你能碰到的边界**。"
    tag: 输入
    tone: amber
    body: |
      ```json
      { "staffId": 301, "dataLevel": "all", "groupIds": [1,2,3] }
      ```

      三种口径：

      | dataLevel | 能看到 |
      |---|---|
      | `self` | 只有自己名下的客户 |
      | `team` | 自己所在的组 |
      | `all` | 全部 |

      它会被**编进 SQL 的 WHERE**，不是查完再过滤。
  - title: 四条 SQL
    desc: "输出。同一次圈选生成四段字符串，各干各的活。"
    tag: 输出
    tone: green
    body: |
      | 名字 | 干什么 |
      |---|---|
      | `uidsSql` | 只查 uid —— 冻名单用 |
      | `countSql` | 外面包一层 COUNT —— 界面上的「共 N 人」 |
      | `listSql` | 带展示列 + 分页 —— 表格 |
      | `droppedUidsSql` | 「指定 UID」里被权限挡掉的那些 |
```

### 条件树长什么样

上面那张卡只给了一个最小的例子。真实的条件树是可以无限嵌套的 —— 这正是「树」这个词的来源：

```tree
- label: group
  sub: "logic: AND"
  tone: violet
  note: 最外层永远是一个组
  children:
    - label: group
      sub: "logic: AND"
      note: 一个子组 —— 界面上那层灰底的方框
      children:
        - { label: "portrait  age ≥ 18" }
        - { label: "portrait  region = US" }
        - { label: "portrait  aum_usd ≥ 1000" }
    - label: "portrait  cash_hkd ≥ 1"
      note: 和上面那个子组平级
    - label: group
      sub: "logic: OR"
      note: 也可以是 OR
      children:
        - { label: "portrait  vip_level = GOLD" }
        - { label: "portrait  hold_semiconductor = true" }
```

**节点只有四种**，没有第五种：

| 类型 | 长什么样 | 说人话 |
|---|---|---|
| `group` | `{ logic: 'AND'\|'OR', children: [...] }` | 「并且 / 或者」，可以套娃 |
| `portrait` | `{ field, op, value }` | 「某个属性 满足 某个条件」 |
| `relation` | `{ relation, formula, objects, props }` | 「他持有的某个东西 满足 某个条件」 |
| `uid` | `{ op, uids: [...] }` | 「就这几个人，我点名要」 |

```callout
tone: violet
icon: 💡
text: |
  **`relation` 值得单独说一句**，因为它有两种截然不同的问法：

  - `formula: 'detail'` —— **「他有没有持有腾讯？」** 问的是存在性
  - `formula: 'times'` —— **「他持有几个标的？」** 问的是数量

  这两种在 SQL 里长得完全不一样（一个是 `IN (SELECT ...)`，一个是 `GROUP BY ... HAVING COUNT(*)`），
  但界面上的表现只差一个下拉框。
```

### 四条 SQL 各是什么样

用「年龄 ≥ 18」这一个条件，三条 SQL 分别长这样：

```compare
first: 名字
head: [长什么样, 干什么用]
rows:
  - "`uidsSql`":
      - "`SELECT u.uid AS uid FROM user_portraits_wide AS u WHERE u.staff_id = 101 AND (TIMESTAMPDIFF(YEAR, u.birthday, CURRENT_DATE()) >= 18)`"
      - "把命中的 uid 全捞出来。**冻名单**（做快照）用的就是它"
  - "`countSql`":
      - "`SELECT COUNT(*) AS count FROM ( <上面那句> ) AS t`"
      - "界面上的「共 1413 人」。==包一层是因为展示列会 LEFT JOIN 出重复行==，包一层才数的是人不数行"
  - "`listSql`":
      - "比 uidsSql 多几列：`u.uid, u.customer_name, u.staff_name, TIMESTAMPDIFF(...) AS age`，末尾 `ORDER BY u.uid LIMIT 10 OFFSET 0`"
      - "表格那一屏。分页走 uid 游标，不走 OFFSET"
  - "`droppedUidsSql`":
      - { text: "只有用了「指定 UID」才有，否则是 null", tone: muted }
      - "你点名了 100 个人，权限只让你看 80 个 —— 用它查出剩下 20 个，好回话"
```

```callout
tone: amber
icon: ⚠
text: |
  ==别被 `countSql` 的「包一层」骗了，它不是脱裤子放屁。==

  展示列要从 `rel_holding` 这类关系表 LEFT JOIN 过来 —— 一个人持有 5 个标的就出 5 行。
  直接 `COUNT(*)` 会把「1 个人」数成「5 行」。
  包一层子查询（里面只选 uid），数出来才是人数。
```

---

## 03 · 走一遍完整编译

下面这个可以点。**勾条件、换身份、把它放进 exclude** —— 右边两段 SQL 会实时变。

```demo
widget: dsl-lab
title: 勾条件，看 SQL 怎么长出来
config:
  table: user_portraits_wide
  actors:
    - { staffId: 101, dataLevel: self, label: 客户经理, note: "只看自己名下的客户" }
    - { staffId: 201, dataLevel: team, label: 组长, note: "看整个组" }
    - { staffId: 301, dataLevel: all,  label: 运营, note: "看全部" }
  conds:
    - { key: age,      label: "年龄 ≥",         kind: num,  col: birthday, derive: age, op: gte, def: 18 }
    - { key: region,   label: "地区 =",         kind: enum, col: region,   def: US,
        options: [{v: US, t: 美国}, {v: HK, t: 中国香港}, {v: CN, t: 中国大陆}, {v: SG, t: 新加坡}] }
    - { key: aum_usd,  label: "总资产(USD) ≥",  kind: num,  col: aum_usd,  op: gte, def: 1000 }
    - { key: cash_hkd, label: "现金(HKD) ≥",    kind: num,  col: cash_hkd, op: gte, def: 1 }
    - { key: vip_level, label: "客户等级 =",     kind: enum, col: vip_level, def: GOLD,
        options: [{v: GOLD, t: 黄金}, {v: PLATINUM, t: 铂金}, {v: DIAMOND, t: 钻石}] }
actions: false
```

### 三个值得亲手试的东西

```cards
cols: 3
items:
  - title: 换身份，看权限怎么进去
    desc: "把①从「客户经理」换成「运营」，看 WHERE 最前面那段。"
    tone: amber
    body: |
      ==权限是从「谁在圈」推出来的，不是用户圈出来的。==

      客户经理 → `u.staff_id = 101`
      组长     → `u.group_id IN (1, 2, 3)`
      运营     → 什么都不加

      所以界面**不需要**有一个「只看我的客户」开关 ——
      它是身份自带的，想关也关不掉。
  - title: 把条件放进 exclude
    desc: "把③从「包含」切成「排除」，看那段 SQL 变成了什么。"
    tone: red
    body: |
      ```
      include:  (cond1 AND cond2)
      exclude:  NOT COALESCE((cond1 AND cond2), FALSE)
      ```

      ==两个方向不对称 —— 一个裸着，一个包了 `NOT COALESCE`。==

      为什么必须这样，是第 05 节的主题。
  - title: 取消所有条件
    desc: "把②里的勾全去掉，看 SQL 还剩什么。"
    tone: muted
    body: |
      WHERE 里只剩权限。

      这对应真代码里的一句注释：

      ```
      // 没有 include 也没有 exclude 时，
      // 结果就是 U（权限范围内的所有人）
      ```

      ==「什么都不圈」是一个合法输入，不是错误。它返回你权限内的全部人。==
```

````callout
tone: violet
icon: 💡
text: |
  **上面那个演示的 SQL 是按真编译器的输出格式写的** —— 括号位置、反引号、子查询包装都一样。

  所以你可以拿它跟真实接口的返回对照：

  ```bash
  curl -s -X POST http://127.0.0.1:8787/api/preview \
    -H 'Content-Type: application/json' -H 'X-Staff-Id: 301' \
    -d '{"query":{"version":1,"scope":{"type":"scope","kind":"all"},
         "include":{"type":"group","logic":"AND","children":[
           {"type":"portrait","field":"age","op":"gte","value":18}]},
         "exclude":null},"page":1,"pageSize":5}' | jq -r .countSql
  ```

  ==一个演示如果不忠实于真代码，它就是在教错的。==
````

---

## 04 · 三段管道

`compile()` 这个函数开头只有两行，但它们是整个包最重要的设计：

```text
validateStructure(query)              ← ① 只看形状
validateSemantics(query, catalog)     ← ② 只看字段字典
// 两步都过了。后面不再重新判断形状或字段规则。
...拼 SQL
```

```flow
grid: true
nodes:
  - { id: ast,  label: 条件树, sub: "用户圈了什么", row: 0, kind: external }
  - { id: v1,   label: ① 形状校验, sub: "不需要字段字典", row: 1, tone: amber }
  - { id: v2,   label: ② 语义校验, sub: "要字段字典", row: 2, tone: violet }
  - { id: gen,  label: ③ 拼 SQL, sub: "不再判断任何规则", row: 3, kind: backend }
  - { id: out,  label: 四条 SQL, sub: "纯字符串", row: 4, tone: green }
  - { id: err1, label: "① EMPTY_GROUP", sub: "组是空的", row: 1, shape: note, tone: red }
  - { id: err2, label: "② UNKNOWN_FIELD", sub: "没有这个字段", row: 2, shape: note, tone: red }
edges:
  - { from: ast, to: v1 }
  - { from: v1, to: v2, label: 过了 }
  - { from: v2, to: gen, label: 过了 }
  - { from: gen, to: out }
  - { from: v1, to: err1, dashed: true }
  - { from: v2, to: err2, dashed: true }
```

### 一个条件走完三段

```demo
widget: stepper
title: 「年龄 ≥ 18」走完三段管道
actions: false
config:
  steps:
    - label: 拿到条件树
      code: |
        { "type": "portrait",
          "field": "age", "op": "gte", "value": 18 }
      note: 界面传过来的就是这段 JSON。此刻它没有任何含义。
    - label: ① 形状校验
      code: |
        version === 1            ✓
        field 和 op 都在         ✓
        op=gte 要一个值，有       ✓
        value 是数字，不是数组    ✓
      note: 这一步完全不知道「age」是什么。它只回答「这棵树的形状合法吗」。
    - label: ② 语义校验
      code: |
        字段字典里找 "age"        ✓ 找到了
        gte 在 age 的 ops 里      ✓ 允许
        value 类型匹配 int        ✓ 18 是整数
      note: 这一步需要字段字典，但不重新检查形状。
    - label: ③ 拼 SQL
      code: |
        age 的 column 是 birthday
        derive 是 age_years
          ↓
        TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE()) >= 18
      note: 到这里才开始生成字符串。前面两步已经把「不合法的输入」全都挡掉了。
```

### 为什么要分两段

这是这个包**最容易被误解**的设计。看起来「两次校验」是重复劳动 —— 一次遍历就能全查完。

```compare
first: 好处
head: [说明, 谁受益]
rows:
  - 不需要字段字典: ["① 只看形状，所以**前端能在本地跑**", "前端：输入框失焦就能报错，不用往返后端"]
  - 错误码不串味: ["`EMPTY_GROUP` 一定来自 ①，`UNKNOWN_FIELD` 一定来自 ②", "排障：看到错误码就知道是哪一段"]
  - 职责不重叠: ["② 假定形状已合法，**不重复检查空的 children / uids**", "维护：改一段不会误伤另一段"]
  - 测试能分开写: ["44 个用例专测校验器，不掺 SQL", "测试：`validate.spec.ts` 一个文件搞定"]
```

````callout
tone: amber
icon: ⚠
text: |
  ==边界的写法是硬性的，不是「尽量」。==

  `validate.ts` 里两个函数的注释就在划这条线：

  ```ts
  // 不需要 catalog。检查非空 children / uids / groupIds / detail.objects / in 值。
  export function validateStructure(query: InsightQuery): void

  // 只看 catalog：字段、关系、属性、允许的操作符、值类型、枚举。
  // 必须先调 validateStructure。这一步不重新检查空列表。
  export function validateSemantics(query: InsightQuery, catalog: Catalog): void
  ```

  ++「不重新检查」是写进注释的承诺。++ 谁违反了，测试会红。
````

### 那错误码长什么样

12 个错误码，按来源分成两组：

```cards
cols: 2
items:
  - title: 形状类（来自 ①）
    tag: 不需要字段字典
    tone: amber
    body: |
      | 码 | 什么时候 |
      |---|---|
      | `UNSUPPORTED_VERSION` | `version` 不是 1 |
      | `MISSING_SCOPE` | 没给 `scope` |
      | `EMPTY_TEAM` | `kind: team` 但 `groupIds` 是空的 |
      | `EMPTY_GROUP` | 一个 `AND` 组里一个孩子都没有 |
      | `INCOMPLETE_LEAF` | `field` 或 `op` 少了一个 |
      | `UNKNOWN_NODE` | `include` 不是组 |
  - title: 语义类（来自 ②）
    tag: 要字段字典
    tone: violet
    body: |
      | 码 | 什么时候 |
      |---|---|
      | `UNKNOWN_FIELD` | 字段字典里没这个字段 |
      | `UNKNOWN_RELATION` | 没有这个关系 |
      | `UNKNOWN_RELATION_PROP` | 关系里没这个属性 |
      | `OP_NOT_ALLOWED` | 这个字段不允许这个操作符 |
      | `VALUE_TYPE` | 值类型不对（枚举值不在选项里、整数给成了字符串） |
      | `INVALID_SCOPE` | `kind: self` 却带了 `groupIds` |
```

**两组各自负责的事情，从错误码上就能看出来。** 这就是「分两段」最实际的好处。

---

## 05 · 三处反直觉的设计

前面都是「它是什么」。这一节讲**它为什么这么做** —— 三处不看源码就想不到的地方。

### 5.1 为什么 include 和 exclude 写法不一样

先看真代码里那个函数，一共四行：

```text
function whereSql(universe, includeExpr, excludeExpr) {
  const parts = [...universe];
  if (includeExpr) parts.push(includeExpr);                              // ← 裸的
  if (excludeExpr) parts.push(`NOT COALESCE((${excludeExpr}), FALSE)`);  // ← 包了两层
  ...
}
```

```callout
tone: red
icon: ⚠
text: |
  ==一个裸着，一个包了 `NOT COALESCE`。这不是笔误。==

  正常人第一次看到都会觉得「应该统一一下」。
  ==但统一会引入一个只在 NULL 上暴露的 bug。==
```

#### 亲手试一遍

下面 6 行数据，其中两行「性别」是**未知（NULL）**。

条件固定是 `gender = 'M'`。**换「放进哪边」和「包不包 COALESCE」，看哪几行留下来。**

```demo
widget: null-lab
title: 6 行数据 · 一个条件 · 四种写法
actions: false
config:
  col: gender
  label: 性别
  matchVal: M
  rows:
    - { id: 1, name: 张三, v: M }
    - { id: 2, name: 李四, v: F }
    - { id: 3, name: 王五, v: null }
    - { id: 4, name: 赵六, v: M }
    - { id: 5, name: 孙七, v: F }
    - { id: 6, name: 周八, v: null }
```

#### 试出来的是什么

**把 `gender = 'M'` 放进 exclude，期望是「排除掉男性，留下其余 4 人」。**

| 写法 | NULL 那两行 | 为什么 |
|---|---|---|
| `NOT COALESCE((gender = 'M'), FALSE)` | **留下** ✓ | `COALESCE` 把 UNKNOWN 压成 FALSE，`NOT FALSE` = TRUE |
| `NOT (gender = 'M')` | **丢掉** ✗ | `NOT UNKNOWN` 还是 UNKNOWN，而 WHERE 把 UNKNOWN 当 false |

```compare
first: 值
head: [为什么 include 不用包, 为什么 exclude 必须包]
rows:
  - 想要的语义:
      - "「满足条件的才进来」→ 不满足就该被挡在外面"
      - "「满足条件的出去」→ ==不满足的（包括不知道的）应该留下=="
  - UNKNOWN 该怎么办:
      - "当成「不满足」→ 不进来"
      - "当成「不在 E 里」→ 留下"
  - SQL 默认行为:
      - { text: "WHERE 天然把 UNKNOWN 当 false ✓", tone: green }
      - { text: "NOT UNKNOWN 还是 UNKNOWN → 被当成 false ✗", tone: red }
  - 结论:
      - { text: "不用包，语义已经对了", tone: green }
      - { text: "必须包，否则误伤", tone: amber }
```

```callout
tone: violet
icon: 💡
text: |
  **用集合的说法**：`include` 要的是 `U ∩ I`，`exclude` 要的是 `U − E`。

  ==减法必须二值 —— 一个人要么在 E 里，要么不在，不能「不知道」。==
  而 `gender = 'M'` 对 NULL 行给的是「不知道」，不是「不在」。
  `COALESCE` 的作用就是把这个「不知道」强行归到「不在」那一侧。
```

#### 这个约定被测试钉死了

包里有一个专门的文件看着它：`test/includeCoalesce.spec.ts`。

它甚至带了一对**构造反例**的工具（`wrapIncludeCoalesce` / `unwrapIncludeCoalesce`），
专门用来验证两件事：

```text
it('does not wrap include-only trees')                              // include 不该包
it('still wraps exclude with NOT COALESCE so missing rows stay')    // exclude 必须包
```

==将来谁「顺手统一一下」，测试立刻红。== 这就是把设计意图写进测试的样子。

### 5.2 为什么「年龄」在数据库里不存在

字段字典里 `age` 这一行长这样：

```json
{ "name": "age", "label": "年龄",
  "column": "birthday",
  "valueType": "int",
  "derive": { "kind": "age_years" } }
```

**`name` 和 `column` 不是一回事。**

```journey
- tag: ① 界面说
  tone: muted
  name: 逻辑字段
  badge: 用户看到的
  fields:
    - { k: name, v: age }
    - { k: label, v: 年龄 }
  note: 界面上的下拉框写的是「年龄」。**用户不知道 birthday 是什么。**
  next: "查字段字典 :: :: 这一步发生在服务端"

- tag: ② 字典说
  tone: violet
  name: 物理列 + 变换
  badge: 推导规则
  fields:
    - { k: column, v: birthday, note: 真实存在的列, tone: ok }
    - { k: derive, v: "age_years", note: 不是直接读，要算 }
  note: 字典把「逻辑字段」翻译成「物理列 + 一个变换」。
  next: "编译 :: :: 变换决定 SQL 长什么样"

- tag: ③ SQL 里
  tone: green
  name: 表达式
  code: |
    TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE())
  note: ==数据库里没有「年龄」这一列，它是每次查询现算的。==
```

**为什么绕这一圈？** 因为「年龄」有两个麻烦：

```cards
cols: 2
items:
  - title: 它会变
    desc: "生日是不变的，年龄每年涨一岁。存年龄就要每天刷一遍全表。"
    tone: amber
    body: |
      如果真存一列 `age`：

      - 每个人生日那天要 UPDATE
      - 忘了刷就会推出「这个人 30 岁」而实际 31
      - 跨时区还要考虑「算哪一天」

      ==存生日，年龄每次算 —— 只有一处逻辑，永远不会过期。==
  - title: 口径必须唯一
    desc: "「年龄」可能是周岁、可能是虚岁、可能按自然年算。三处各写一遍就会不一致。"
    tone: violet
    body: |
      `derive` 只有两个取值，**整个系统里「年龄怎么算」只有一处定义**：

      | kind | 生成什么 |
      |---|---|
      | `age_years` | `TIMESTAMPDIFF(YEAR, col, CURRENT_DATE())` |
      | `days_since` | `DATEDIFF(CURRENT_DATE(), col)` |

      ==所以「距上次成交天数」和「年龄」用的是同一套机制。==
```

**同一个 `days_since` 用在四个字段上**，它们各自映射到不同的物理列：

```tree
- label: "derive: days_since"
  sub: "DATEDIFF(CURRENT_DATE(), col)"
  tone: green
  note: 一个变换，四个字段在用
  children:
    - { label: register_days,      sub: "→ register_time",     note: 开户天数 }
    - { label: last_deposit_days,  sub: "→ last_deposit_time", note: 距上次入金天数 }
    - { label: last_trade_days,    sub: "→ last_trade_time",   note: 距上次成交天数 }
    - { label: last_touch_days,    sub: "→ last_touch_time",   note: 距上次触达天数 }
```

### 5.3 权限不是「过滤」，是「编进 WHERE」

直觉上，权限应该是「查完再筛掉不该看的」。真代码不是这样：

```text
function universePreds(actor, scope) {
  const preds = [];
  if (scope.kind === 'team' && actor.dataLevel === 'team') {
    pushGroups(preds, scope.groupIds.filter(id => actor.groupIds.includes(id)));  // 取交集
  } else if (scope.kind === 'team') {
    pushGroups(preds, scope.groupIds);
  } else if (actor.dataLevel === 'team') {
    pushGroups(preds, actor.groupIds);
  }
  if (actor.dataLevel === 'self' || scope.kind === 'self') {
    preds.push(`\`u\`.\`staff_id\` = ${actor.staffId}`);
  }
  return preds;
}
```

**它产出的是一段 WHERE 谓词，和用户圈的条件拼在一起。**

```compare
first: 做法
head: [查完再过滤, 编进 WHERE]
rows:
  - SQL 长什么样:
      - "两段：先查全量，再筛"
      - "一段：`WHERE u.staff_id = 101 AND (用户条件)`"
  - 扫描的数据量:
      - { text: "全表 100 万行", tone: red }
      - { text: "只有自己名下那部分", tone: green }
  - 「忘了过滤」的后果:
      - { text: "越权数据已经查出来了，只是没显示", tone: red }
      - { text: "==数据库层面就不可能返回==，没有这个 bug 类型", tone: green }
  - 谁能绕过:
      - "任何一个走捷径的新接口"
      - "绕过不了 —— 谓词是 `compile()` 的必经步骤"
```

````callout
tone: green
icon: ✅
text: |
  ==这是「让错误的做法写不出来」，不是「提醒大家别写错」。==

  `compile()` 的签名就决定了：**你不给它 actor，它就没法工作。**

  ```ts
  export function compile(query: InsightQuery, options: CompileOptions): CompileResult
  //                                    options 里 actor 是必填的
  ```

  不存在「这个接口先不接权限，以后再补」的路径。
````

**还有一个细节**：`team` 身份只能圈自己的组。看第一段那个 `filter`：

```js
scope.groupIds.filter(id => actor.groupIds.includes(id))
```

组长传 `{ kind: 'team', groupIds: [1, 2, 3] }`，但他只有组 1 —— **交集之后只剩 [1]**。
越权的那部分不是被拒绝，是**悄悄消失了**。

---

## 06 · 它由什么组成

`src/` 下 **10 个文件、1717 行**。按行数排：

```tree
- label: packages/dsl/src
  tone: violet
  note: 10 个文件 · 1717 行（wc -l 实测）
  children:
    - label: catalog.ts
      sub: 474 行
      tone: amber
      note: 最大。字段字典的**默认值**（测试夹具），外加两个查名字的小函数
      children:
        - { label: defaultCatalog, note: "46 个字段 + 2 个关系的硬编码副本" }
        - { label: fieldByName, note: 找不到就返回 undefined —— 由调用方决定怎么办 }
        - { label: relationByName, note: 同上 }
    - label: compile.ts
      sub: 424 行
      note: 编排者。三段管道都在这里串起来
      children:
        - { label: compile, sub: "(query, options)", note: "对外唯一入口" }
        - { label: compileNode, note: "递归展开条件树 —— 一个 switch 分派四种节点" }
        - { label: whereSql, note: "拼 WHERE。include/exclude 的不对称就写在这里" }
        - { label: universePreds, note: "权限下推" }
        - { label: compileListSql, note: "分页 —— 走 uid 游标，不走 OFFSET" }
    - label: validate.ts
      sub: 356 行
      tone: blue
      note: 两段校验器。**不含任何 SQL**
      children:
        - { label: validateStructure, note: "只查形状，不需要字典" }
        - { label: validateSemantics, note: "只查字典，假定形状已合法" }
    - label: schema.ts
      sub: 319 行
      tone: green
      note: 类型定义 + 类型守卫 + 几个构造器
      children:
        - { label: "Ops", note: "14 个操作符常量" }
        - { label: "BoolNode / PortraitLeaf / RelationLeaf / UidLeaf", note: "四种节点" }
        - { label: "isGroup / isPortrait / isRelation / isUid", note: "类型守卫，编译器和校验器都用" }
    - label: sql.ts
      sub: 53 行
      note: 只干一件事：**安全地拼字符串**。不做任何规则判断
      children:
        - { label: ident, note: "加反引号，内部反引号翻倍" }
        - { label: sqlString, note: "单引号翻倍 —— 转义" }
        - { label: sqlLiteral, note: "按值类型给字面量：数字不加引号、布尔给 TRUE/FALSE" }
    - label: metadata.ts
      sub: 53 行
      note: 字段字典、关系、Catalog 的**类型定义**。纯类型，运行时是空的
    - label: errors.ts
      sub: 23 行
      note: 12 个错误码 + 一个 CompileError 类
    - label: index.ts
      sub: 7 行
      note: 包的出口。决定哪些是公开契约
    - label: context.ts
      sub: 7 行
      note: Actor 和 DataLevel 两个类型。**没有依赖**
    - label: ast.ts
      sub: 1 行
      note: "只有一行：export * from './schema.ts'"
```

### 依赖是单向的

```lane-stack
- badge: LAYER 01
  title: 底层
  desc: 一个依赖都没有 —— 所以任何一层都能引用它们
  tone: muted
  nodes:
    - { title: context.ts, sub: 7 行, tag: Actor 类型 }
    - { title: errors.ts, sub: 23 行, tag: 错误码 }
    - { title: schema.ts, sub: 319 行, tag: 四种节点 + 类型守卫 }
  next: "被引用 :: :: 单向，不回头"

- badge: LAYER 02
  title: 类型与工具
  desc: 只依赖 LAYER 01。三个文件彼此不引用
  tone: green
  nodes:
    - { title: metadata.ts, sub: 53 行, tag: 纯类型定义 }
    - { title: sql.ts, sub: 53 行, tag: 转义与字面量 }
    - { title: catalog.ts, sub: 474 行, tag: 查名字 }
  next: "校验器要用字典 :: :: 而字典要用类型"

- badge: LAYER 03
  title: 校验
  desc: 两道门。不含任何 SQL
  tone: blue
  nodes:
    - { title: validate.ts, sub: 356 行, tag: 形状 + 语义 }
  next: "两道都过了才轮到 :: :: 这样拼 SQL 时不用再判断规则"

- badge: LAYER 04
  title: 编排
  desc: 在顶端，依赖下面所有层
  tone: violet
  nodes:
    - { title: compile.ts, sub: 424 行, tag: 对外唯一入口 }
```

```callout
tone: green
icon: ✅
text: |
  ==**每一层只依赖它下面那层，没有回环。**==

  这个形状换来一个很实际的好处：

  **`sql.ts` 只负责「怎么安全地拼一个字符串」，它不判断任何规则。**
  所以 `compile.ts` 可以随便复用它，而不会产生「编译器 ↔ 校验器互相依赖」。

  **三个底层文件（`context` / `errors` / `schema`）一个依赖都没有** ——
  所以它们能被任何一层引用，包括测试。
```

### 一个诚实的问题

`catalog.ts` 是最大的文件（474 行），但它的注释写着：

```ts
// Seed and compiler-test fixture. The server loads the live catalog from MySQL.
```

**它是测试夹具，不是运行时真相。** 但同一个文件里也导出了 `fieldByName` / `relationByName` ——
而这两个函数**生产代码在用**（`compile.ts` 和 `validate.ts` 都 import）。

```compare
first: 混在一起的问题
head: [实际情况, 更好的做法]
rows:
  - 474 行里是什么: ["约 460 行是硬编码的 46 个字段 + 2 个关系", "那些应该搬去 test/fixtures/"]
  - 谁在用这个文件: ["生产代码用两个查找函数；测试用整个 defaultCatalog", "两个查找函数留在 src/，夹具搬走"]
  - 后果: ["读源码的人会以为字段字典是写死的", "一眼能看出「字典是运行时的，这只是测试数据」"]
```

**这不是 bug，是组织问题。** 但它会让第一次读代码的人多花几分钟 —— 所以值得指出。

---

## 07 · 怎么保证它是对的

332 个测试，553ms 跑完。分三层，每层管不同的事。

### 第一层：单元测试

```cards
cols: 3
items:
  - title: 按特性分文件
    desc: "一个特性一个 spec，共 11 个文件 163 个用例。"
    tone: blue
    body: |
      | 文件 | 测什么 | 用例 |
      |---|---|---|
      | `validate.spec.ts` | 两段校验器 | 44 |
      | `compile.relation.spec.ts` | 关系节点 | 24 |
      | `compile.operators.spec.ts` | 14 个操作符 | 16 |
      | `compile.sql.spec.ts` | 生成的 SQL 形状 | 16 |
      | `compile.scope.spec.ts` | 权限口径 | 13 |
      | `compile.formula.spec.ts` | detail vs times | 11 |
      | `compile.uid.spec.ts` | 指定 UID | 11 |
      | `compile.null.spec.ts` | NULL 语义 | 8 |
      | `includeCoalesce.spec.ts` | 那个不对称 | 9 |
      | `schema.spec.ts` | 类型守卫与构造器 | 9 |
      | `sql.spec.ts` | 转义 | 2 |
  - title: 断言的是错误码
    desc: "不是「抛了异常」，而是「抛了带这个码的异常」。"
    tone: violet
    body: |
      ```ts
      export function expectCode(fn, code) {
        try { fn(); expect.fail(`expected ${code}`) }
        catch (e) {
          expect(e).toBeInstanceOf(CompileError)
          expect((e as CompileError).code).toBe(code)
        }
      }
      ```

      ==这让「校验器有没有换过分类」变得可测。==
      如果哪天 `EMPTY_GROUP` 被改成了 `INCOMPLETE_LEAF`，测试会红。
  - title: 三个现成的身份
    desc: "每个测试用例都从三个演员里挑一个，不用自己构造。"
    tone: amber
    body: |
      ```ts
      export const selfRm  = { staffId: 101, dataLevel: 'self', groupIds: [1] }
      export const leader  = { staffId: 201, dataLevel: 'team', groupIds: [1] }
      export const ops     = { staffId: 301, dataLevel: 'all',  groupIds: [1,2,3] }
      ```

      跟 `doris/seed.mjs` 里灌的那 10 个员工是同一批人。
```

### 第二层：夹具 —— 这是最有意思的一层

**一份用例，两处验证。**

```flow
grid: true
nodes:
  - { id: cases, label: "test/fixtures/cases.ts", sub: "用例的唯一真相源", row: 0, tone: violet }
  - { id: json,  label: "test/fixtures/*.json",  sub: "10 个文件 · 6100 行 SQL 快照", row: 1, tone: amber }
  - { id: unit,  label: "fixtures.spec.ts",      sub: "169 个断言：输出 === 快照吗", row: 2, kind: backend }
  - { id: doris, label: "test/doris/*.spec.ts",  sub: "真连 Doris 跑，跟快照对账", row: 2, kind: database }
edges:
  - { from: cases, to: json, label: "update-fixtures 生成" }
  - { from: json, to: unit, label: 读 }
  - { from: json, to: doris, label: 读 }
  - { from: unit, to: doris, dashed: true }
```

**一条夹具长这样：**

```json
{ "id": "count-joins-used-tables",
  "from": "compile.sql.spec.ts#countSql joins only tables used in filters",
  "actorStaffId": 101,
  "query": { "version": 1, "scope": {...}, "include": {...}, "exclude": null },
  "expected": {
    "countSql": "SELECT COUNT(*) AS `count` FROM (SELECT `u`.`uid` AS `uid` FROM `user_portraits_wide` AS `u` WHERE `u`.`staff_id` = 101 AND (TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE()) > 18)) AS `t`",
    "listSql": "SELECT `u`.`uid` AS `uid`, ... ORDER BY `u`.`uid` LIMIT 10 OFFSET 0",
    "uidsSql": "...",
    "usedTables": ["user_portraits_wide"],
    "listColumns": [{ "key": "age", "label": "年龄", ... }]
  }}
```

```compare
first: 设计
head: [为什么这样, 换来什么]
rows:
  - "`from` 字段回指源头":
      - "夹具不是凭空长出来的，每个都能追溯到一条真实断言"
      - "排查时知道该去看哪个 spec"
  - SQL 是逐字符快照:
      - "精确到括号和空格"
      - "==改一行编译器，169 个夹具立刻告诉你「哪些 SQL 变了」=="
  - 同一批夹具喂给真 Doris:
      - "编译器输出 → 直接执行"
      - "验证的不只是「SQL 长得对」，还有「SQL 跑得对」"
  - 用例写在 TS 里而不是 JSON 里:
      - "TS 能调 `and()` / `portrait()` 这些构造器，写起来短"
      - "JSON 只是**产物**，可以随时重新生成"
```

### 第三层：真库验证 + 一个「数据体检」闸门

`test/doris/` 是单独一套配置（跑得慢，120 秒超时，文件串行）。

**但在跑任何测试之前，先过一道闸门** —— `assertSeed()`：

```text
✓ 三张该有的表都在（user_portraits_wide / rel_holding / rel_product）
✓ 五张早该删掉的表确实没有了
✓ user_portraits_wide 一共 1000000 行
✓ uid 范围是 10001 ~ 1010000
✓ 去重后有 10 个 staff_id
✓ 101 / 201 / 301 三个人的客户数分别对得上
✓ 年龄 ≥ 18 的人数是 136655
✗ 持有 SEMI 的人数是 10256
```

````callout
tone: violet
icon: 💡
text: |
  ==**它不只检查「数据对不对」，还检查「数据是不是够脏」。**==

  这一段是我见过最反直觉、也最有道理的测试设计：

  ```ts
  const missingGender = ... WHERE gender IS NULL
  if (missingGender <= 0 || missingGender >= expected.universe_total)
    throw new Error('messy seed must leave some portrait columns empty')
  ```
````

**为什么故意要脏数据？** 因为第 5.1 节那个 `COALESCE` 的不对称，**只有在「有些行画像列是 NULL」时才会暴露**。

干净数据会让所有边界测试**假绿**。

同样套路的还有三条：

```compare
first: 断言
head: [要求什么, 为什么必须有]
rows:
  - 有些行 `gender IS NULL`:
      - "NULL 不能是 0 行，也不能是全部"
      - "否则测不出 NULL 三值逻辑"
  - 画像标记 ≠ 关系表:
      - "`hold_semiconductor = 1` 但关系表里没有 SEMI 的人必须 > 0"
      - "否则测不出「两处数据不一致时以谁为准」"
  - 组长名下有跨组脏数据:
      - "staff 101 名下有 `group_id <> 1` 的客户"
      - "否则测不出权限交集那个 `filter`"
  - 标的代码和市场要对得上:
      - "`.HK` 结尾的必须是港股，`.US` 的必须是美股"
      - "==前三条要脏，这一条要干净 —— 数据得脏得讲道理=="
```

```callout
tone: green
icon: ✅
text: |
  ==这四条断言锁住的是「测试数据的病态程度」。==

  如果谁重灌了一批太干净的数据，所有边界测试都会通过 ——
  但那是**因为边界不存在了**，不是因为代码没问题。

  这些断言会拦住他。
```

---

## 08 · 它现在缺什么

诚实说几处。不是 bug，是「现在这样也能跑，但迟早要处理」。

```cards
cols: 2
items:
  - title: 目录缓存永远不会刷新
    tag: 最要紧
    tone: red
    body: |
      `source.ts` 里有一个进程内缓存：

      ```ts
      let cached: MetadataRows | null = null
      export function getMetadataRows() {
        if (!cached) cached = await loadMetadataRows()   // 只读一次
        return cached
      }
      ```

      同时有一个 `resetCatalogCache()` —— **全项目搜下来只有定义，没有任何调用点。**

      ==后果：改了元数据必须重启后端才生效。==

      这在目标架构里是个真缺口：等 Data Admin 上线，
      运营在配置台改完，用户看到的还是旧的。
  - title: 字段字典在代码里有一份副本
    tone: amber
    body: |
      `catalog.ts` 474 行，是 46 个字段 + 2 个关系的硬编码版本。

      注释说它是「seed and compiler-test fixture」，
      但它和 `fieldByName` / `relationByName` 混在同一个文件里。

      ==读源码的人容易误以为字典是写死的。==

      物理列类型也一样：元数据结构里没存，所以要在
      `metadata/project.ts` 里再维护一份 `PHYSICAL_TYPES` 兜底。

      !!两个真源 —— 迟早会不一致。!!
  - title: 时间类操作符没有 SQL 实现
    tone: amber
    body: |
      `schema.ts` 里定义了四个相对时间操作符：

      ```
      last_n_days / before_n_days / last_n_hours / before_n_hours
      ```

      校验器**放行**它们，但编译器里写着：

      ```ts
      if (isRelativeTimeOp(op)) {
        throw new Error(`no SQL compiler for op ${op}`)
      }
      ```

      ==类型系统允许、校验通过、编译时才炸。==

      现在没炸是因为字典里没有字段声明这几个操作符 ——
      靠的不是设计，是没人用。
  - title: "`ast.ts` 只有一行"
    tone: muted
    body: |
      ```ts
      export * from './schema.ts';
      ```

      纯转发。存在的意义大概是「概念上区分 AST 和 schema」，
      但实际它增加了「同一个类型有两个导入路径」的困惑。

      小问题，但可以删。
```

```callout
tone: amber
icon: ⚠
text: |
  **这四条里，第一条最值得先做** —— 因为它已经从「将来会出问题」变成
  「现在就挡着路」了：

  我已经实测过：改完 MySQL 里的字段中文名，接口**仍然返回旧值**，
  必须 `touch` 一下源码让 `tsx watch` 重启后端才生效。

  ==修复也不难：给 `resetCatalogCache` 挂一个接口，或者加个 TTL。==
```

---

## 09 · 自测

```quiz
- q: 为什么校验要分两段，一段遍历不是更快吗？
  a: |
    因为两段需要的东西不同：**形状校验不需要字段字典**。

    实际好处有四个：
    1. 前端能在本地跑第一段 —— 输入框失焦就能报错，不用往返后端
    2. 错误码不串味 —— `EMPTY_GROUP` 一定来自第一段，`UNKNOWN_FIELD` 一定来自第二段
    3. 职责不重叠 —— 第二段假定形状已合法，不重复检查空列表
    4. 测试能分开写 —— 44 个用例专测校验器，不掺 SQL

    注释里那句「这一步不重新检查空列表」是硬性承诺，不是「尽量」。
- q: 为什么 include 是裸谓词，exclude 要包 NOT COALESCE？
  a: |
    因为 SQL 的三值逻辑：`NOT UNKNOWN` 还是 `UNKNOWN`，而 WHERE 把 UNKNOWN 当 false。

    拿「排除男性」`NOT (gender = 'M')` 举例，性别未知的那一行：
    - `gender = 'M'` → UNKNOWN
    - `NOT UNKNOWN` → 还是 UNKNOWN
    - WHERE 当成 false → **这行被弄丢了**

    但它既不是男性、也不该被排除。包上 `COALESCE(expr, FALSE)` 之后：
    - UNKNOWN 被压成 FALSE
    - `NOT FALSE` → TRUE → 正确留下

    include 不用包，是因为 `U ∩ I` 要的正是「不满足就不进来」——
    而 WHERE 本身就把 UNKNOWN 当 false，语义已经对了。
- q: 数据库里为什么没有 `age` 这一列？
  a: |
    因为字段字典里 `age` 的 `name` 是 `age`，但 `column` 是 `birthday`，
    还带一个 `derive: { kind: 'age_years' }`。

    编译时会生成 `TIMESTAMPDIFF(YEAR, birthday, CURRENT_DATE())` —— 年龄是现算的。

    好处有两个：
    1. **它不会过期** —— 存年龄就得每天刷全表，忘了刷就会推出「30 岁」而实际 31
    2. **口径只有一处** —— 周岁还是虚岁、按哪天算，整个系统只有一个答案

    同一个机制还用在四个「距上次 X 天数」的字段上（都是 `days_since`）。
- q: 权限为什么不是「查完再过滤」？
  a: |
    因为「查完再过滤」意味着越权数据**已经被查出来了**，
    只是没显示 —— 任何一个走捷径的新接口都可能忘掉那一步。

    编进 WHERE 之后，数据库层面就不可能返回越权数据。
    而且这不是靠自觉：`compile()` 的签名里 `actor` 是必填的，
    ==不存在「这个接口先不接权限，以后再补」的路径。==

    还有一个细节：`team` 身份圈别的组时，`scope.groupIds` 会和
    `actor.groupIds` 取交集 —— 越权那部分不是被拒绝，是**悄悄消失**。
```
