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
    - { title: 生成 SQL, sub: "用 Knex 构造", tag: 不自己拼字符串 }
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

      !!注意 `name` 是 `age`，而 `column` 是 `birthday`。!! 这两者不一样 —— 第 04 节会讲为什么。
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
      - "界面上的「共 1413 人」。它数的就是 `uidsSql` 定义的那个集合 —— !!包一层不去重，这个代码里也没东西需要去重!!"
  - "`listSql`":
      - "比 uidsSql 多几列：`u.uid, u.customer_name, u.staff_name, TIMESTAMPDIFF(...) AS age`，末尾 `ORDER BY u.uid LIMIT 10 OFFSET 0`"
      - "表格那一屏。分页走 uid 游标，不走 OFFSET"
  - "`droppedUidsSql`":
      - { text: "只有用了「指定 UID」才有，否则是 null", tone: muted }
      - "你点名了 100 个人，权限只让你看 80 个 —— 用它查出剩下 20 个，好回话"
```

```callout
tone: red
icon: ⚠
text: |
  ==**「包一层」不是去重 —— 它防不住重复行。**==

  这是个高频误解，值得单独说清。继续读之前，先确认三件事实：

  | 事实 | 怎么核实的 |
  |---|---|
  | 关系条件编译成 `IN (子查询)`，**不是 JOIN** | 读 `compileRelation` —— detail / times / not_in 三个分支全是 `IN` / `EXISTS` |
  | 全库 318 条夹具 SQL 里只有 1 条含 JOIN | 而且那 1 条是分页用的 `CROSS JOIN`，不是关系表 |
  | 宽表的 `uid` 是 `UNIQUE KEY` | `SHOW CREATE TABLE`；实测 100 万行 = 100 万去重后 |

  所以 `COUNT(*) FROM (uidsSql)` 在这个代码里是个**语义 no-op** ——
  它数出来的人数，跟直接数宽表行数一样。

  ++它真正的价值是**结构上的一致**：把「人数」定义成「`uidsSql` 这个集合的元素个数」，
  而不是「宽表的行数」。将来 `uidsSql` 里加了会改变行数的东西，外层不用动。++

  !!但如果是**真的**出现了重复行（比如某个字段落在 1:N 的表上），包一层救不了它。!!
  下面这个可以点，看四种写法差多少。
```

```demo
widget: count-dedup-lab
title: 「包一层」到底去不去重
actions: false
config:
  universe: user_portraits_wide
  joinTable: rel_holding
  users:
    - { uid: 1001, name: 张三, holdings: [AAPL, TSLA, NVDA, MSFT, META] }
    - { uid: 1002, name: 李四, holdings: [AAPL] }
    - { uid: 1003, name: 王五, holdings: [] }
```

````callout
tone: green
icon: ✅
text: |
  **怎么判断一段 SQL 该不该担心重复？** 看两件事：

  1. **有没有 `JOIN` 一张一对多的表？** 有 → 行会变多。
  2. **重复的 key 会不会被 `DISTINCT` / `GROUP BY` / `UNION` 折掉？** 不会 → 它就一直多着。

  修法只有两种：

  ```sql
  -- 写法一：内层 DISTINCT
  SELECT COUNT(*) FROM (SELECT DISTINCT u.uid FROM users u JOIN rel_holding h ON …) t

  -- 写法二：直接 COUNT(DISTINCT)（通常更简洁）
  SELECT COUNT(DISTINCT u.uid) AS count FROM users u JOIN rel_holding h ON …
  ```

  ==回到这个库：因为关系条件走 `IN (子查询)`、画像字段全在宽表上，
  它**根本不会产生重复行** —— 所以那个「包一层」不是在补这个坑。==
````

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

      为什么必须这样，见第 04 节的「第三段 · 拼 SQL」。
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
  **上面那个演示的 SQL，语句内容跟真编译器逐字相同** —— 括号位置、反引号、子查询包装都一样。

  !!但它**换了行**，真编译器不换。!! 真输出是一整行（省字节），子句、权限、条件全挤在一起。

  ==换行只是排版，不改变语义 —— 而且 SQL 本来就不看换行。==
  想看真输出，直接打这个接口：

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

`compile()` 开头这几行，是整个包的结构：

```ts
validateStructure(query);                  // ① 只看形状
validateSemantics(query, catalog);         // ② 只看字段字典
// 两步都过了。后面不再重新判断形状或字段规则。

const includeApply = compileTree(query.include, ctx);
const excludeApply = compileTree(query.exclude, ctx);
```

`compileTree` 返回的不是 SQL 字符串，是一个 `Apply` —— 一个「怎么把这段条件加到某个查询上」的函数。调用方拿到它之后，把它挂到 Knex 的查询对象上，最后 `renderSql()` 把整个查询转成字符串。

三段的边界很硬：**第一段不知道字段字典存在，第二段不知道 SQL 存在，第三段不做任何判断。**

第二步要拿字段字典对一遍 —— 字典由 Data Admin 维护，通过 `Catalog` 对象传进来。

```flow
grid: true
nodes:
  - { id: ast, label: 条件树, sub: "界面传过来的 JSON", row: 0, kind: external }
  - { id: v1, label: "① 形状校验", sub: "不需要字典（也会查值的形状）", row: 1, tone: amber }
  - { id: e1, label: EMPTY_GROUP, sub: "组里一个孩子都没有", row: 1, shape: note, tone: red }
  - { id: e1b, label: INCOMPLETE_LEAF, sub: "少了 field 或 op", row: 1, shape: note, tone: red }
  - { id: v2, label: "② 语义校验", sub: "要字段字典", row: 2, tone: violet }
  - { id: e2, label: UNKNOWN_FIELD, sub: "字典里没这个字段", row: 2, shape: note, tone: red }
  - { id: e2b, label: VALUE_TYPE, sub: "值跟字段类型对不上", row: 2, shape: note, tone: red }
  - { id: gen, label: "③ compileTree", sub: "返回 Apply，不再判断规则", row: 3, kind: backend }
  - { id: out, label: 四条 SQL, sub: "renderSql() 转成字符串", row: 4, tone: green }
edges:
  - { from: ast, to: v1 }
  - { from: v1, to: e1, dashed: true }
  - { from: v1, to: v2, label: 过了 }
  - { from: v2, to: e2, dashed: true }
  - { from: v2, to: gen, label: 过了 }
  - { from: gen, to: out }
```

### 第一段 · 形状校验

入口是 `validateStructure(query)`。它递归走完整棵树，只回答一个问题：**这棵树的形状合法吗。**

它不看字段字典。所以 `{ "type": "portrait", "field": "根本不存在的字段", "op": "gte", "value": 1 }` 在这一段是**合法**的 —— 名字对不对是第二段的事。

它查的东西分四组：

| 组 | 查什么 | 什么情况报错 | 错误码 |
|---|---|---|---|
| **scope** | `version` | 不是 `1` | `UNSUPPORTED_VERSION` |
| | `scope` 存在且 kind 认识 | 缺失或 kind 不认识 | `MISSING_SCOPE` |
| | `kind: 'team'` 要有 `groupIds` | 空数组 | `EMPTY_TEAM` |
| | `groupIds` 元素类型 | 有非整数 | `VALUE_TYPE` |
| | `kind: 'self'` / `'all'` | 却带了 `groupIds` | `INVALID_SCOPE` |
| **树结构** | `include` / `exclude` 的根 | 不是 group | `UNKNOWN_NODE` |
| | 每个 group 的 `children` | 空数组 | `EMPTY_GROUP` |
| | 节点 `type` | 不认识 | `UNKNOWN_NODE` |
| **各叶子的字段** | `portrait` 的 `field` 和 `op` | 少任何一个 | `INCOMPLETE_LEAF` |
| | `relation` 的 `relation` / `formula` / `op` | 少任何一个 | `INCOMPLETE_LEAF` |
| | `uid` 的 `uids` | 不是数组 / 空数组 | `INCOMPLETE_LEAF` |
| | `uid` 的每个元素 | 不是十进制整数字符串 | `VALUE_TYPE` |
| **关系专属** | `formula: 'detail'` 的 `op` | 不是 `in` / `not_in` | `OP_NOT_ALLOWED` |
| | `formula: 'detail'` 的 `value` | 带了 value（detail 不看值） | `INCOMPLETE_LEAF` |
| | `formula: 'detail'` 的 `objects` | 空数组 | `INCOMPLETE_LEAF` |
| | `formula: 'times'` 的 `op` | 不是六个比较符或 `between` | `OP_NOT_ALLOWED` |
| | `formula: 'times'` 的 `value` | 不是非负整数 | `INCOMPLETE_LEAF` |
| | `between` 的区间 | `min > max` | `VALUE_TYPE` |
| | `props.logic` / `props.items` | 不是 AND/OR、空数组 | `INCOMPLETE_LEAF` |
| **谓词的值** | `isNull` / `isNotNull` | 却带了 value | `VALUE_TYPE` |
| | `in` / `not_in` | 不是数组、空数组、元素不是标量 | `VALUE_TYPE` / `INCOMPLETE_LEAF` |
| | `between` | 不是两元、端点不是标量 | `VALUE_TYPE` |
| | 相对时间操作符 | 不是正整数 | `VALUE_TYPE` |

> 这些检查分散在 6 个函数里：`validateScope`、`validateNodeStructure`、`validatePortraitStructure`、`validateRelationStructure`、`validatePropsStructure`、`validateUid`、`validatePredicateShape`。前两个管 scope 和树，后五个各管一种叶子。

**一个细节**：`INCOMPLETE_LEAF` 和 `VALUE_TYPE` 在这一段都会出现 —— 前者是「少了东西」，后者是「东西在但不对」（比如 `uids` 里有个 `"abc"`）。

下面可以点。八种坏输入，看它在哪一段停下来：

```demo
widget: validate-lab
title: 喂几个坏输入，看它在哪一段被拦
actions: false
config:
  cases:
    - label: 空组
      stage: shape
      code: |-
        { "type": "group", "logic": "AND", "children": [] }
      mark: '"children": []'
      err: EMPTY_GROUP
      why: 一个组里一个孩子都没有，界面上不该产生这种输入，所以当成 bug 拦掉，而不是当成「空条件」放过。
    - label: 缺 op
      stage: shape
      code: |-
        { "type": "portrait", "field": "age", "value": 18 }
      mark: '"value": 18 }'
      err: INCOMPLETE_LEAF
      why: field 有、value 有，但 op 没给。这一段只看到「少了一个必填项」，不知道 age 是什么。
    - label: between 给一个值
      stage: shape
      code: |-
        { "type": "portrait", "field": "age", "op": "between", "value": [18] }
      mark: '[18]'
      err: VALUE_TYPE
      why: between 要两个端点。注意这里是 VALUE_TYPE 不是 INCOMPLETE_LEAF —— value 在，只是形状不对。
    - label: uids 不是数字
      stage: shape
      code: |-
        { "type": "uid", "op": "in", "uids": ["1001", "abc"] }
      mark: '"abc"'
      err: VALUE_TYPE
      why: uids 必须是十进制整数字符串。原因是这些值会被直接拼进 SQL 的 IN 列表，不能带引号和反斜杠。
    - label: 字段不存在
      stage: semantic
      code: |-
        { "type": "portrait", "field": "user_age", "op": "gte", "value": 18 }
      mark: '"user_age"'
      err: UNKNOWN_FIELD
      why: 形状没问题，是拿字段字典查不到这个 field_key。
    - label: 操作符不允许
      stage: semantic
      code: |-
        { "type": "portrait", "field": "region", "op": "gte", "value": "US" }
      mark: '"gte"'
      err: OP_NOT_ALLOWED
      why: region 是枚举类型，允许的操作符里没有 gte。允许哪些是字段定义里带的 ops 数组。
    - label: 枚举值不在候选里
      stage: semantic
      code: |-
        { "type": "portrait", "field": "region", "op": "eq", "value": "XX" }
      mark: '"XX"'
      err: VALUE_TYPE
      why: region 的 options 里没有 XX。枚举字段会逐个比对候选值，所以拼不出意料之外的字符串。
    - label: 年龄给了字符串
      stage: semantic
      code: |-
        { "type": "portrait", "field": "age", "op": "gte", "value": "18" }
      mark: '"18"'
      err: VALUE_TYPE
      why: age 的 valueType 是 int，字符串 18 不匹配。
```

### 第二段 · 语义校验

入口是 `validateSemantics(query, catalog)`。它按同样的方式再走一遍树，但这次每片叶子都要跟字段字典对。

三类检查，顺序固定：

**① 名字存在吗** —— `fieldByName(catalog, leaf.field)` / `relationByName(...)` / `rel.props.find(...)`。找不到就报 `UNKNOWN_FIELD` / `UNKNOWN_RELATION` / `UNKNOWN_RELATION_PROP`。

**② 操作符允许吗** —— 看字段定义里的 `ops` 数组。

| 字段类型 | `ops` 是怎么来的 |
|---|---|
| 数值 / 日期 | `eq` `neq` `lt` `lte` `gt` `gte` `between` `isNull` `isNotNull` |
| 枚举 | `eq` `neq` `in` `notIn` `isNull` `isNotNull` |
| 布尔 | `eq` `isNull` `isNotNull` |

这三个数组在 `catalog.ts` 里叫 `RANGE` / `SET` / `BOOL`。元数据从 MySQL 读的时候，是按 `semantic_type` 从 `crm_dc_operator` 查出来的。

**③ 值类型对吗** —— `isValidValue(value, valueType, options)` 的五个分支：

| `valueType` | 怎么判 | 例子 |
|---|---|---|
| `int` | `typeof === 'number'` 且是整数 | `18` ✓，`"18"` ✗ |
| `decimal` | `typeof === 'number'` 且有限 | `1000.5` ✓ |
| `string` | `typeof === 'string'` | 任何字符串都过 |
| `bool` | `typeof === 'boolean'` | `true` ✓，`1` ✗ |
| `enum` | **有 `options` 就逐个比对**；没有就只查类型 | `"US"` 在候选里 ✓，`"XX"` ✗ |

注意 `enum` 那一行：**有候选值列表时，校验会收紧**。这是枚举字段拼不出任意字符串的原因。

**关系对象走的是另一条路。** `relations[].objectType` 决定值类型，候选值来自 `objectSource`：

```text
holding 的 objectSource 是 { kind: 'provider', key: 'stock_search' }
  → 没有本地候选值，只查是不是字符串

product 的 objectSource 是 { kind: 'inline', options: [...] }
  → 有候选值，逐个比对
```

`times` 分支的值不走 `isValidValue` —— 它是计数，另外判「非负整数」和「`between` 时 min ≤ max」。

### 第三段 · 拼 SQL

#### 挂载点：返回一个函数，而不是字符串

`compileTree` 的返回类型是：

```ts
type Gate = 'and' | 'or';
type Apply = (query: Knex.QueryBuilder, gate: Gate) => void;
```

**它不返回 SQL 文本，返回一个「怎么加条件」的函数。** 调用方决定什么时候、以什么方式调用它。

原因是 Knex 拼嵌套条件时的形状：

```js
// AND 组：第一个用 where，后面的也用 where（Knex 默认就是 AND）
qb.where(a).where(b)

// OR 组：第一个用 where，后面的用 orWhere
qb.where(a).orWhere(b)

// 嵌套：每一层要开一个括号，括号里重新数第一个
qb.where(function () {
  this.where(a).orWhere(b)
})
```

**递归函数不知道自己是第几个。** 这个信息只有父层有。所以父层在循环里决定，通过 `gate` 传下去：

```ts
const grouped = function (this: Knex.QueryBuilder) {
  children.forEach((child, index) => {
    child(this, index === 0 ? 'and' : logic === 'OR' ? 'or' : 'and');
  });
};
if (gate === 'or') query.orWhere(grouped);
else query.where(grouped);
```

第一个孩子永远拿到 `'and'` —— 因为在它前面没有东西可以 `or`。

这样安排之后，叶子那一层完全不知道 `where` / `andWhere` / `orWhere` 的存在，它只管「我加什么条件」。好处是叶子能单独测，新增节点类型时不用碰挂载逻辑。

#### 四种叶子各自的形状

| 叶子 | 生成的 SQL |
|---|---|
| `portrait` | `` `u`.`region` = ? `` |
| `portrait` + `derive` | `` TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE()) >= ? `` |
| `relation` + `detail` | `` `u`.`uid` IN (SELECT `rel_holding`.`uid` FROM `rel_holding` AS `rel_holding` WHERE ...) `` |
| `relation` + `detail` + `not_in` | `` NOT EXISTS (SELECT 1 FROM `rel_holding` AS `rel_holding` WHERE `rel_holding`.`uid` = `u`.`uid` AND ...) `` |
| `relation` + `times` | `` `u`.`uid` IN (SELECT uid FROM ... GROUP BY uid HAVING COUNT(*) >= ?) `` |
| `uid` | `` `u`.`uid` IN (?, ?, ...) `` |

`detail` 的 `objects` 和 `props` 都进子查询的 WHERE：

```sql
-- objects：落在 object_id 列
WHERE `rel_holding`.`object_id` IN ('00700.HK')

-- props：落在各自的物理列，按 logic 组合
WHERE (`rel_holding`.`qty` >= ? AND `rel_holding`.`market` = ?)
```

#### 派生字段走的不是普通比较

`portraitExpr(field)` 决定这个字段的「表达式」是什么：

```ts
if (field.derive?.kind === 'days_since')
  return db.raw('DATEDIFF(CURRENT_DATE(), ??)', [ref])          // 距上次 X 天数
if (field.derive?.kind === 'age_years')
  return db.raw('TIMESTAMPDIFF(YEAR, ??, CURRENT_DATE())', [ref]) // 年龄
return { kind: 'column', ref }                                   // 普通列
```

返回值有两种形态：`{ kind: 'column' }` 和 `{ kind: 'sql' }`。后面 `applyIn` / `applyBetween` / `applyScalar` 都要按这两种形态分叉：

| 形态 | 怎么加条件 |
|---|---|
| `column` | 用 Knex 的 `where(ref, op, value)` / `whereIn` / `whereBetween` |
| `sql` | 用 `whereRaw(sql, values)`，表达式里用 `??` 占位列、`?` 占位值 |

**这就是「年龄」在数据库里不存在的原因。** 字段字典里 `age` 的 `column_name` 是 `birthday`、`derive_kind` 是 `age_years`，编译时现算。

好处是它不会过期（存年龄要每天刷全表），口径也只有一处（周岁还是虚岁、按哪天算，只有一个答案）。

同一个机制还用在四个「距上次 X 天数」的字段上，它们都是 `days_since`：

```tree
- label: "derive_kind: days_since"
  sub: "DATEDIFF(CURRENT_DATE(), col)"
  tone: green
  note: 一个模板，四个字段在用
  children:
    - { label: register_days, sub: "→ register_time", note: 开户天数 }
    - { label: last_deposit_days, sub: "→ last_deposit_time", note: 距上次入金天数 }
    - { label: last_trade_days, sub: "→ last_trade_time", note: 距上次成交天数 }
    - { label: last_touch_days, sub: "→ last_touch_time", note: 距上次触达天数 }
```

#### 权限谓词插在最前面

`applyUniverse(query, actor, scope)` 在拼条件之前先跑一遍。它的输入 `actor` 不是 DSL 里的东西，是调用方传进来的：

```ts
actor = { staffId: number; dataLevel: 'self' | 'team' | 'all'; groupIds: number[] }
```

| `scope.kind` | `actor.dataLevel` | 加什么谓词 |
|---|---|---|
| `team` | `team` | `group_id IN (scope 和 actor 的交集)` |
| `team` | 其它 | `group_id IN (scope.groupIds)` |
| 其它 | `team` | `group_id IN (actor.groupIds)` |
| `self` 或 `actor` 是 `self` | | `staff_id = ?` |

**它是编进 WHERE 的，不是查完再筛。** 所以不存在「某个接口忘了过滤」这种漏洞 —— 想绕过就得改 `compile()` 本身。

两个细节：

- **交集那个分支**：组长传 `groupIds: [1, 2, 3]` 但他只有组 1，交集之后只剩 `[1]`。越权的组不是被拒绝，是从谓词里消失了。
- **空交集**：`applyGroups` 拿到空数组时生成 `FALSE`。一个恒假条件，等于查不到任何人 —— 这比生成一个空 `IN ()`（语法错误）安全。

#### include 和 exclude 的写法不一样

```
include  →  谓词本身                          (cond1 AND cond2)
exclude  →  NOT COALESCE((谓词), FALSE)
```

exclude 外面套了一层 `COALESCE`。原因是 SQL 的三值逻辑：

```
gender = 'M' 对 NULL 行求值 → UNKNOWN（不是 TRUE 也不是 FALSE）
NOT UNKNOWN                 → 还是 UNKNOWN
WHERE 里的 UNKNOWN          → 按 false 处理 → 这行被丢掉
```

所以「排除男性」写成 `NOT (gender = 'M')` 时，**性别为 NULL 的人会被一并排除** —— 他们既不满足「是男性」，也不满足「不是男性」。

`COALESCE` 把 UNKNOWN 归到 FALSE 一侧，排除集恢复成二值判断：要么在里面，要么不在。

include 不需要这一层。「满足条件的进来」和 WHERE 的默认行为一致。

这个约定有个测试文件专门看着它（`includeCoalesce.spec.ts`），里面带了一对构造反例的工具 —— 将来谁想把两边写法统一，测试会红。

#### 关系为什么用 `IN` 子查询，不用 `LEFT JOIN`

三个分支（`detail` / `detail + not_in` / `times`）全走子查询，没有一个是 JOIN。

```sql
-- 一个人持 5 个标的
LEFT JOIN rel_holding 之后  →  出 5 行
COUNT(*)                   →  把「1 个人」数成「5」
```

`IN` 子查询只回答「这个 uid 在不在结果集里」，一行对应一个人。

**有一件事容易搞错**：包一层 COUNT 解决不了这个问题。

```sql
-- 结果还是 5，不是 1
SELECT COUNT(*) FROM (
  SELECT u.uid FROM users u LEFT JOIN rel_holding h ON h.uid = u.uid
) t
```

子查询里只写 `SELECT u.uid` **不会自动去重**，要去重得写 `DISTINCT` 或 `GROUP BY`。

本设计从语句形状上避免重复行产生，而不是在统计时去重。

#### `not_in` 为什么是 `NOT EXISTS`

`not_in` 是**关系集合级**的否定，不是对象列上的否定。

```
需求：「不持有腾讯」

✅ NOT EXISTS (SELECT 1 FROM rel_holding
               WHERE rel_holding.uid = u.uid AND object_id IN ('00700.HK'))
   → 不存在「这个人与腾讯的关系记录」

❌ WHERE object_id NOT IN ('00700.HK')
   → 变成「这条关系记录不是腾讯」——行级否定，语义完全不同
```

用一句话验：**同时持有腾讯和阿里的人，不满足「不持有腾讯」。**

写成 `NOT EXISTS` 时结论正确。写成对象列上的 `NOT IN` 时，那个人会因为有阿里这条记录而被留下 —— 错的。

代码里那句注释就是记这个：

```ts
// Set negation. filters stay a positive match; object_id is never NOT IN.
```

### 组装：从一段 WHERE 到四条 SQL

四段条件都准备好之后，`compile()` 用一个内部函数 `filtered()` 把它们拼到一个 Knex 查询上：

```ts
const filtered = (joins, seek) => {
  const builder = db(`${universeTable} as u`);
  if (seek) crossJoin(builder, seek);
  for (const table of joins) builder.leftJoin(...);
  applyUniverse(builder, actor, scope);       // 权限
  if (includeApply) includeApply(builder, 'and');
  if (exclude) builder.whereRaw(`NOT COALESCE((${exclude.sql}), FALSE)`, [...exclude.bindings]);
  return builder;
};
```

四条 SQL 都是从这个函数长出来的：

| 输出 | 怎么来 |
|---|---|
| `uidsSql` | `filtered(filterJoins).select('u.uid')` |
| `countSql` | `count(*) from (uidsSql) as t` |
| `listSql` | `filtered(listJoins)` + 展示列 + 排序 + 分页 |
| `droppedUidsSql` | 把点名的 uid 拼成派生表，再 `NOT EXISTS` 反查 |

**`countSql` 外面包一层子查询**，统计的是 `uidsSql` 返回的行数。本期 `uidsSql` 不产生重复行（关系条件用子查询而非 JOIN，宽表的 `uid` 是唯一键），所以包一层不改变结果。它的作用是把「人数」定义成「`uidsSql` 这个集合的大小」，后续 `uidsSql` 里加入会改变行数的逻辑时，外层不用动。

两个构造细节：

- **`filterJoins` 和 `listJoins` 是两个不同的集合。** 前者是条件里用到的表，后者是展示列用到的表。`uidsSql` 和 `countSql` 只需要前者，`listSql` 两个都要。
- **`droppedUidsSql` 只在用过 `uid` 叶子时才有值**，否则返回 `null`。它是给界面回话用的：「你点名的 100 个人里，有 20 个不在你的数据范围内」。代码里那句注释说明了它只核对 `in`：

```ts
// droppedUidsSql 只核对 in 点名要纳入的人。not_in 的 id 不是纳入请求。
```

**分页走 uid 游标。** `listSql` 有三种分页形态：

| 情况 | 生成的 SQL |
|---|---|
| 第一页 | `ORDER BY u.uid LIMIT ?` |
| 带 `afterUid` | `WHERE u.uid > ? ORDER BY u.uid LIMIT ?` |
| 只有页码、没有游标 | `CROSS JOIN (SELECT u.uid ... LIMIT 1 OFFSET ?) AS prev` 再 `WHERE u.uid > prev.after_uid` |

第三种是为了兼容「跳页」：先查目标页前一行的 uid，再按游标取。**深分页时 `OFFSET` 会越翻越慢，所以正常翻页走游标。**

还有两处 Knex 的补偿（都在 `knex.ts` 里）：

- **`applyOffset`** —— Knex 在 offset 为 0 时会省略 `OFFSET`，而夹具要求它显式出现。
- **`crossJoin`** —— Knex 没有 cross join 的一等 API，用 `joinRaw` 补。

## 05 · 它由什么组成

`src/` 下 **11 个文件、1507 行**。按行数排：

```tree
- label: packages/dsl/src
  tone: violet
  note: 11 个文件 · 1507 行（wc -l 实测）
  children:
    - label: compile.ts
      sub: 533 行
      note: 编排者。三段管道都在这里串起来
      children:
        - { label: compile, sub: "(query, options)", note: "对外唯一入口" }
        - { label: compileNode, note: "递归展开条件树，返回 Apply" }
        - { label: compileRelation, note: "关系条件的三个分支" }
        - { label: applyUniverse, note: "权限谓词" }
        - { label: filtered, note: "内部函数 —— 四条 SQL 都从它长出来" }
    - label: validate.ts
      sub: 357 行
      tone: blue
      note: 两段校验器。**不含任何 SQL**
      children:
        - { label: validateStructure, note: "只查形状，不需要字典" }
        - { label: validateSemantics, note: "只查字典，假定形状已合法" }
    - label: schema.ts
      sub: 320 行
      tone: green
      note: 类型定义 + 类型守卫 + 几个构造器
      children:
        - { label: Ops, note: "15 个操作符常量" }
        - { label: "BoolNode / PortraitLeaf / RelationLeaf / UidLeaf", note: "四种节点" }
        - { label: "isGroup / isPortrait / isRelation / isUid", note: "类型守卫，编译器和校验器都用" }
    - label: knex.ts
      sub: 129 行
      note: Knex 的包装层。四处补偿
      children:
        - { label: db, note: "client 是 mysql，**不连库**，只用来拼 SQL" }
        - { label: "_escapeBinding（覆盖）", note: "布尔输出大写 TRUE/FALSE，字符串用 ANSI 的 ''" }
        - { label: whereFragment, note: "把一段条件单独编译成 { sql, bindings } —— exclude 要套 NOT COALESCE" }
        - { label: renderSql, note: "toString() 之后把关键字转大写（Knex 输出小写）" }
        - { label: crossJoin, note: "Knex 没有 cross join 的一等 API" }
    - label: metadata.ts
      sub: 61 行
      note: Catalog 的类型定义 + 两个查名字的函数
      children:
        - { label: "FieldDef / RelationDef / Catalog", note: 纯类型 }
        - { label: "fieldByName / relationByName", note: "找不到返回 undefined，由调用方决定怎么报错" }
    - label: sql.ts
      sub: 52 行
      note: 重构前是唯一的拼 SQL 入口，**现在不在生成路径上**
      children:
        - { label: compileScalarOp, note: "把 op 映射成 = / != / < / <= / > / >=" }
        - { label: "ident / qualify / sqlString / sqlLiteral / joinSql / inList", note: "旧的手拼辅助函数，测试还在跑，生产不再调用" }
    - label: errors.ts
      sub: 23 行
      note: 12 个错误码 + 一个 CompileError 类
    - label: page.ts
      sub: 17 行
      note: 只有一个函数，处理分页游标的入参
      children:
        - { label: parseAfterUid, note: "把 bigint / number / string 统一成十进制整数字符串，不合法返回 undefined" }
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
  desc: 一个依赖都没有，任何一层都能引用
  tone: muted
  nodes:
    - { title: context.ts, sub: 7 行, tag: Actor 类型 }
    - { title: errors.ts, sub: 23 行, tag: 错误码 }
    - { title: schema.ts, sub: 320 行, tag: 四种节点 + 类型守卫 }
  next: "被引用 :: :: 单向，不回头"

- badge: LAYER 02
  title: 类型与工具
  desc: 只依赖 LAYER 01
  tone: green
  nodes:
    - { title: metadata.ts, sub: 61 行, tag: 类型 + 查名字 }
    - { title: page.ts, sub: 17 行, tag: 分页入参 }
    - { title: sql.ts, sub: 52 行, tag: 比较符映射 }
    - { title: knex.ts, sub: 129 行, tag: 外部库的包装 }
  next: "校验器要用字典 :: :: 而字典要用类型"

- badge: LAYER 03
  title: 校验
  desc: 两道门。不含任何 SQL
  tone: blue
  nodes:
    - { title: validate.ts, sub: 357 行, tag: 形状 + 语义 }
  next: "两道都过了才轮到 :: :: 这样拼 SQL 时不用再判断规则"

- badge: LAYER 04
  title: 编排
  desc: 在顶端，依赖下面所有层
  tone: violet
  nodes:
    - { title: compile.ts, sub: 533 行, tag: 对外唯一入口 }
```

```callout
tone: green
icon: ✅
text: |
  ==**每一层只依赖它下面那层，没有回环。**==

  三个底层文件（`context` / `errors` / `schema`）一个依赖都没有，所以能被任何一层引用，包括测试。

  `knex.ts` 的位置也在这里 —— 它包着外部库，被 `compile.ts` 用，**校验器完全不碰它**。
  所以校验逻辑可以脱离 Knex 单独测。
```

## 06 · 怎么保证它是对的

334 个测试，878ms 跑完。分三层，每层管的事不一样。

| 层 | 规模 | 管什么 |
|---|---|---|
| 单元测试 | 11 个文件 166 个用例 | 一个特性一个文件，断言「抛的是哪个错误码」而不是「抛没抛」 |
| 夹具 | 168 条 | 锁住输出 —— 每条夹具是一份 `{ query, expected }`，`expected` 里是**逐字符**的 SQL 快照 |
| 真库验证 | 单独一套配置 | 同一批夹具喂给真 Doris 跑，跟快照对账 |

### 夹具为什么值得单独说

一份用例，两处验证：

```
test/fixtures/cases.ts          ← 用例的唯一真相源（TS，能调构造器，写起来短）
        │  npx tsx scripts/update-fixtures.ts
        ▼
test/fixtures/*.json            ← 10 个文件，6100 行 SQL 快照
        │
        ├── fixtures.spec.ts    → 断言「现在的编译器输出 === 快照」
        └── test/doris/*.spec.ts → 真的连 Doris 执行，跟快照对账
```

一条夹具长这样：

```json
{ "id": "count-joins-used-tables",
  "from": "compile.sql.spec.ts#countSql joins only tables used in filters",
  "actorStaffId": 101,
  "query": { "version": 1, "scope": {...}, "include": {...}, "exclude": null },
  "expected": {
    "countSql": "SELECT COUNT(*) AS `count` FROM (SELECT `u`.`uid` AS `uid` FROM `user_portraits_wide` AS `u` WHERE ...) AS `t`",
    "listSql": "...",
    "uidsSql": "...",
    "usedTables": ["user_portraits_wide"],
    "listColumns": [{ "key": "age", "label": "年龄", ... }]
  }}
```

两点设计：

- **`from` 字段回指源头测试**。夹具不是凭空长出来的，每个都能追溯到一条真实断言，排查时知道该去看哪个 spec。
- **SQL 是逐字符快照**。改一行编译器，168 条夹具立刻告诉你哪些 SQL 变了。

用 Knex 之后这层更值钱 —— 链式 API 调用的顺序会影响生成的 SQL，光看代码不容易发现。

### 真库验证之前有一道闸门

`test/doris/gate.ts` 在跑任何测试之前，先核对数据是不是那一份：

```
✓ user_portraits_wide 一共 1000000 行
✓ uid 范围是 10001 ~ 1010000
✓ 去重后有 10 个 staff_id
✓ 101 / 201 / 301 三个人的客户数分别对得上
✓ 年龄 ≥ 18 的人数是 136655
```

它还检查数据**够不够脏**：

```ts
const missingGender = ... WHERE gender IS NULL
if (missingGender <= 0 || missingGender >= expected.universe_total)
  throw new Error('messy seed must leave some portrait columns empty')
```

「性别」全空或全不空，测试数据都测不出 NULL 三值逻辑那类问题（见第 04 节 include / exclude 那一段）。同一套思路还有三条：

| 断言 | 要求 |
|---|---|
| 有些行 `gender IS NULL` | 不能是 0 行，也不能是全部 |
| 画像标记 ≠ 关系表 | `hold_semiconductor = 1` 但关系表里没有 SEMI 的人必须 > 0 |
| 组长名下有跨组脏数据 | staff 101 名下有 `group_id <> 1` 的客户 |
| 标的代码和市场要对得上 | `.HK` 结尾的必须是港股 —— **这条要干净，前三条要脏** |

这四条锁住的是「测试数据的病态程度」。谁重灌一批太干净的数据，边界测试会通过 —— 但那是**因为边界不存在了**，不是因为代码没问题。

## 07 · 它现在缺什么

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

## 08 · 自测

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
- q: "`countSql` 的「包一层」是在去重吗？"
  a: |
    **不是。** 而且在这个代码里它没有东西可去 —— 它是个**语义 no-op**。

    三条证据：
    1. 关系条件编译成 `IN (子查询)`，不是 JOIN（读 `compileRelation`）
    2. 全库 318 条夹具 SQL 里只有 1 条含 JOIN，而且是分页的 `CROSS JOIN`
    3. 宽表的 `uid` 是 `UNIQUE KEY`（`SHOW CREATE TABLE`）

    ==「子查询里只选 uid 就会去重」是个很常见的错觉。== 不会 —— 去重必须写
    `DISTINCT` 或 `GROUP BY`。一个人持 5 个标的，`LEFT JOIN` 之后就是 5 行，
    包一层之后还是 5 行。

    它真正的价值是**结构上的一致**：把「人数」定义成「`uidsSql` 这个集合的元素个数」，
    而不是「宽表的行数」。
- q: 那什么情况下要担心重复？
- q: 为什么 include 是裸谓词，exclude 要包 NOT COALESCE？
  a: |
    看两件事：

    1. **有没有 `JOIN` 一张一对多的表？** 有 → 行会变多
    2. **重复的 key 会不会被 `DISTINCT` / `GROUP BY` / `UNION` 折掉？** 不会 → 它就一直多着

    修法两种：内层 `SELECT DISTINCT` 再外层 `COUNT(*)`，或者直接 `COUNT(DISTINCT uid)`。

    ==回到这个库：因为关系条件走 `IN (子查询)`、画像字段全在宽表上，
    它根本不会产生重复行。==
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
