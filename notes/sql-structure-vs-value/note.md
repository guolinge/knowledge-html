这段 SQL 里，**哪些部分是我们写的，哪些部分是用户填的**？

```sql
SELECT COUNT(*) FROM user_portraits_wide AS u WHERE u.region = 'US'
└──────────────────┬─────────────────────────┘   └──┬──┘  └─┬─┘  └─┬─┘
              结构和名字（我们写死的）              列名    运算符   值
                                                              （用户填的）
```

```callout
tone: blue
icon: 🎯
text: |
  **这一句分得清，后面所有问题都能自己推出来。**

  拼接 SQL 上的每一个安全问题，**根都是同一条线被跨过了**：

  > ==值混进了结构。==

  这篇从这条线出发，讲清四件事：

  - 注入到底是怎么发生的（有实测数据）
  - 为什么 Knex 的 `raw` 是唯一需要单独管住的地方
  - 三个同源的设计手法：**把「可变」变成「常量」**
  - 一个跟它无关、但同样容易踩的东西：**两套机制重叠**
```

---

## 01 · 一条主线：每个部分归谁管

一段 SQL 拆开，每一块都有明确的**来源**：

```flow
grid: true
legend: true
nodes:
  - { id: user,  label: 用户填的, sub: '「美国」', row: 0, kind: external }
  - { id: meta,  label: Metadata, sub: "表名 / 列名 / 允许的操作符", row: 0, kind: database }
  - { id: code,  label: 代码里写死, sub: "SELECT / WHERE / COUNT(*) / uid", row: 0, kind: backend }
  - { id: ast,   label: DSL, sub: "条件树", row: 1, tone: violet }
  - { id: comp,  label: 编译器, sub: "把上面四样拼起来", row: 2, kind: backend }
  - { id: str,   label: "SQL 字符串", sub: "结构 + 值混在一段文本里", row: 3, tone: amber }
  - { id: db,    label: 数据库, sub: "先看结构，再看值", row: 4, kind: database }
edges:
  - { from: user, to: ast, label: 只影响「值」 }
  - { from: meta, to: ast, label: 决定行不行 }
  - { from: code, to: comp }
  - { from: ast, to: comp }
  - { from: comp, to: str }
  - { from: str, to: db, label: "解析 → 执行" }
```

**关键在最后一步**：数据库拿到一段文本，它做两件事 ——

```compare
first: 步骤
head: [数据库在做什么, 这一步决定什么]
rows:
  - "① 解析（parse）":
      - "把文本切成「结构」：哪些是关键字、哪个是表名、哪个是值"
      - "==这一步一旦定完，就改不了了== "
  - "② 执行":
      - "按刚才解析出的结构去跑"
      - "值只是「装进格子里」的东西，不参与结构"
```

**所以危险不在「用户填了什么」，而在「用户填的东西有没有参与第 ① 步」。**

**参数绑定（`?`）的全部意义就是**：让值在第 ① 步**不在场**。

```sql
-- 内联：值在文本里，要参与解析
WHERE u.region = 'US'          ← 数据库必须读这个 'US' 才知道结构

-- 绑定：先解析结构，值后到
WHERE u.region = ?             ← ① 步只看得到「这里有个格子」
bindings: ['US']               ← ② 步才填进去
```

```callout
tone: violet
icon: 💡
text: |
  ==**绑定不是「更安全的转义」，是「让值不参与解析」。**==

  这个区别很重要 —— 它解释了为什么绑定不会出现「漏了某个字符」的问题：
  它压根不需要猜哪些字符危险。
```

---

## 02 · 注入：值如何变成结构

### 一个正常值走完全程

```journey
- tag: ① 用户填
  tone: muted
  name: 界面输入框
  badge: 正常
  fields:
    - { k: region, v: "US" }
  note: 用户在「地区」下拉框里选了美国。
  next: "提交 :: :: DSL 里带的是字符串 US"

- tag: ② 编译器拼字符串
  tone: violet
  name: SQL 文本
  badge: 这一步是唯一的战场
  code: |
    WHERE u.region = 'US'
  note: 编译器要把「一个字符串」变成「SQL 里合法的一段文本」。
  next: "送去数据库 :: :: 从这里开始，值就只是文本了"

- tag: ③ 数据库解析
  tone: blue
  name: 解析结果
  fields:
    - { k: 结构, v: 'WHERE + 列 + 等号', note: 定死了, tone: ok }
    - { k: 值, v: "'US'", note: 装进等号右边, tone: ok }
  note: 一切正常。
```

### 一个恶意值走同样的路

```journey
- tag: ① 用户填
  tone: muted
  name: 界面输入框
  badge: 恶意
  fields:
    - { k: region, v: "x\\' OR 1=1 -- ", note: 一个精心构造的字符串 }
  note: 用户没有「选」地区，而是通过接口直接塞了一个字符串。

- tag: ② 编译器拼字符串
  tone: amber
  name: SQL 文本
  badge: 转义漏了一处
  code: |
    WHERE u.region = 'x\'' OR 1=1 -- '
  note: 只把单引号翻倍，**没管反斜杠** —— 而反斜杠在 SQL 里会把紧跟的引号转义掉。
  noteTone: bad

- tag: ③ 数据库解析
  tone: red
  name: 解析结果
  badge: 结构被改了
  fields:
    - { k: 结构, v: 'WHERE 列 = 值 OR 1=1', note: 多出来一段, tone: bad }
    - { k: 值, v: "'x'", tone: bad }
    - { k: 注释, v: "-- '", note: 把尾巴吃掉了, tone: bad }
  note: 那个 `OR 1=1` 已经不是「值」了 —— 它变成了**结构的一部分**。
```

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**注入的定义就这一句：用户的输入变成了 SQL 的结构。**==

  它不一定是恶意的。下面第二组数据里，一个**普通值**就足以让查询挂掉。
```

### 亲手试一下

下面四个预设是**真在 Doris 上跑出来的**（`crm_insight`，100 万行），不是模拟的。

```demo
widget: sql-inject-lab
title: 同一个值，两种进 SQL 的方式
actions: false
config:
  table: user_portraits_wide
  field: region
  totalRows: 1000000
  cases:
    - { tag: 正常值,   input: US,              inline: 151330,  bound: 151330 }
    - { tag: 带单引号, input: "O'Brien",       inline: 0,       bound: 0 }
    - { tag: 带反斜杠, input: "a\\",           inline: null,    bound: 0 }
    - { tag: 注入尝试, input: "x\\' OR 1=1 -- ", inline: 1000000, bound: 0 }
```

### 四组数据的读法

```compare
first: 输入
head: [内联能不能编对, 内联实测, 绑定实测]
rows:
  - 正常值（US）:
      - { text: "能", tone: green }
      - "151330"
      - "151330"
  - 带单引号（O'Brien）:
      - { text: "能 —— 单引号翻倍做对了", tone: green }
      - "0"
      - "0"
  - 带反斜杠（一个以反斜杠结尾的值）:
      - { text: "不能 —— 整条 SQL 语法错", tone: red }
      - { text: "ERROR", tone: red }
      - "0"
  - 注入尝试:
      - { text: "不能 —— 条件被整个绕过", tone: red }
      - { text: "1000000", tone: red }
      - "0"
```

```callout
tone: amber
icon: ⚠
text: |
  **前两行才是最难发现的。**

  正常值和带单引号的值，两种写法**结果一模一样** ——
  所以你在测试环境里随便点点，==永远看不到问题==。

  问题只在第三、四行这种边界值上暴露。而第三行尤其阴：

  ++`a\` 不是一个恶意输入，它是个可能真实存在的值。++
  一个以反斜杠结尾的字符串（自由文本字段、备注、地址）会让**整条查询报语法错** ——
  这不是安全漏洞，是**功能性 bug**，而且更难定位。
```

---

## 03 · 两层保护，一个破口

SQL 里要保护的东西有**两**类，方式不同：

```compare
first: 保护对象
head: [长什么样, 怎么保护, 谁在做]
rows:
  - "**值**":
      - "`'US'`、`100`、`TRUE`"
      - "用**引号**包起来，里面内容不当命令"
      - "Knex 的 `?` 绑定"
  - "**标识符**":
      - "`` `region` ``、`` `rel_holding` ``"
      - "用**反引号**包起来，告诉数据库「这是名字，不是关键字」"
      - "Knex 的 `.where()` / `.select()` 自动加"
```

**标识符为什么也要保护**：

```sql
SELECT order FROM t          -- ✗ order 是 SQL 关键字，语法错
SELECT `order` FROM t        -- ✅ 加反引号才行
```

### Knex 平时两层都管

```js
knex('user_portraits_wide').select('uid').where('region', 'US')
// 生成：SELECT `uid` FROM `user_portraits_wide` WHERE `region` = ?
//       ↑ 反引号它加      ↑ 反引号它加          ↑ 值走 ?
```

### 但 `whereRaw` 是逃生口 —— 两层都不管了

```js
.whereRaw('`rel_holding`.`uid` = `u`.`uid`')
//         ↑ 这一串反引号是我们手打的，Knex 完全不知道这里有标识符
```

```callout
tone: red
icon: ⚠
text: |
  `whereRaw` 的意思是 ==**「这段我自己写的，你别管」**==。

  所以它同时绕过了两层保护：

  | | 平时 | 在 raw 里 |
  |---|---|---|
  | 值的转义 | Knex 管 | 不管 —— 你自己写对 |
  | 标识符的反引号 | Knex 管 | 不管 —— 你自己打对 |

  ++这就是为什么整条编译链里，只有 raw 需要单独约定。++
```

### 为什么绕不过它：关联子查询

Knex 的常规 API 全是**「列 比 值」**的形状：

```js
.where('qty', '>=', 100)          // 列 = qty，值 = 100
.whereIn('object_id', [...])      // 列 = object_id，值 = 数组
```

**「列 比 列」它没有对应写法。** 而关联子查询恰好就是这种：

```sql
SELECT uid FROM user AS u WHERE NOT EXISTS (
  SELECT 1 FROM rel_holding AS h
  WHERE h.uid = u.uid                    -- ← 两个列在比，不是「列 = 值」
)
```

**用中文读**：「对每一个用户 u，看看有没有一条 h 满足 `h.uid = u.uid`」。

这个结构**必须**用 `whereRaw`：

```js
knex('rel_holding')
  .whereRaw('`rel_holding`.`uid` = `u`.`uid`')   // ← 只能这么写
  .whereIn('object_id', objects)                  // ← 值又回到 ? 绑定
```

---

## 04 · 怎么管住 raw

两条约定，都很短：

### ① 白名单：raw 里只允许出现这些

```
· 列名                        —— Metadata 给的常量，反引号由代码拼
· COUNT(*)                    —— times 节点的计数
· CURRENT_DATE()              —— 相对时间的基准
· `rel`.`uid` = `u`.`uid`     —— 关联子查询的关联条件
```

**白名单比黑名单好** —— 加新东西的时候必须先想「它该不该进白名单」。

### ② 一眼可查的判据

```callout
tone: green
icon: ✅
quote: true
text: |
  ==**在 `whereRaw` / `havingRaw` 里看到 `${}` 插值，就是红灯。**==

  因为那意味着有变量被拼进了 SQL 文本。

  它不需要你理解整段逻辑 —— **看一个符号就够**。
```

**对错对照**：

```js
// ✅ 对：列名是常量，objects 走 ?
.whereRaw('`rel_holding`.`uid` = `u`.`uid`')
.whereIn('object_id', objects)

// ❌ 错：把用户的值拼进 raw
.whereRaw(`... AND object_id = '${obj}'`)
//                               ↑ 红灯
```

### 为什么 `COUNT(*)` 也要专门说一句

`times` 节点（「他持有几只标的」）编译出来是：

```sql
HAVING COUNT(*) >= ?
       └───┬───┘    └┬┘
         常量       值（走 ? 绑定）
```

`COUNT(*)` **不是一个列**，它是个函数调用 —— 所以 Knex 的 `having()` 表达不了，只能走 `havingRaw`。

**这时候 `havingRaw('COUNT(*) >= ?', [n])` 一行里，常量和值混在同一个字符串中** ——
读的人会本能地想「这里安全吗？」

**所以「说明它是常量」不是安全机制，是沟通约定**：让读的人知道那半段是写死的。

```js
// 更好的写法：把常量提出来命名 —— 一眼看出它是写死的
const COUNT_ALL = 'COUNT(*)'
qb.havingRaw(`${COUNT_ALL} >= ?`, [n])
```

```callout
tone: amber
icon: ⚠
text: |
  **诚实说一句：这一条的风险等级不高。**

  因为列名和 `COUNT(*)` 全部来自 Metadata（数据库里的常量），**不是用户输入**。

  但它仍然值得写进文档，理由有三个：

  1. 将来可能有人图省事，把某个字段名拼进 raw
  2. 这条规矩**一眼可查**，不依赖读者理解上下文
  3. ==不加这条，评审时说不清「为什么 raw 是安全的」==
```

---

## 05 · 把「可变」变成「常量」

前面讲的是**怎么防**。这一节讲**怎么从源头少一个变量**。

三个看起来不相关的地方，用的是**同一个手法**：

```cards
cols: 3
items:
  - title: 关联键写死成 uid
    desc: "不给它配「这表用哪个列关联」的选项。"
    tone: blue
    body: |
      **做法**：任何要接进来的表都必须有一列叫 `uid`。
      **而且这个列名不入库** —— `crm_dc_data_field` 里永远不会有
      「`uid` 映射到 `xxx`」这样一行。SQL Builder 直接写死。

      ```sql
      LEFT JOIN rel_holding AS h ON h.uid = u.uid
      --                             ↑↑↑  ↓↓↓  写死的
      ```

      | 好处 | 说明 |
      |---|---|
      | SQL 一眼能看懂 | 所有关联都是 `a.uid = b.uid` |
      | 能 grep | 一条 `grep 'uid ='` 找出所有关联点 |
      | 排障不用追上下文 | 看到 `uid` 就知道是关联键 |

      ==打个比方：所有电器统一用同一种插座。==
      如果允许「有的两孔有的三孔」，那每个插座都得先查表。
      ++统一标准，是为了不用查表。++
  - title: 计数写成常量
    desc: "COUNT(*) 不是从 DSL 拼出来的，它是写死的字符串。"
    tone: violet
    body: |
      ```js
      const COUNT_ALL = 'COUNT(*)'
      qb.havingRaw(`${COUNT_ALL} >= ?`, [n])
      ```

      对比「内联用户值」的写法 —— 那段 `COUNT(*)` **不来自任何输入**，
      它是代码里的一个字符串字面量。

      这一条的价值不在安全（它本来就安全），而在**让读的人一眼确认安全**。
  - title: 挂载点约定
    desc: "递归编译函数只接受一个「挂载点」，不自己决定怎么挂。"
    tone: green
    body: |
      **问题**：Knex 里括号内第一个孩子要用 `where`，后面的才能用
      `andWhere` / `orWhere`。而递归函数**不知道自己是第几个孩子** ——
      那个信息在父层。

      **做法**：把「挂载点」当第一个参数传下去。

      ```js
      function compileInto(qb, node) {   // qb = 往哪儿加
        if (isGroup(node)) {
          qb.where(function () {
            const inner = this          // 括号里的新挂载点
            node.children.forEach((child, i) => {
              // 只在这一处判断用哪个方法
              if (i === 0) inner.where(cb)
              else if (node.logic === 'AND') inner.andWhere(cb)
              else inner.orWhere(cb)
            })
          })
          return
        }
        qb.where(...)   // 叶子只管加什么，不管怎么挂
      }
      ```

      | 好处 | 说明 |
      |---|---|
      | 出错只有一个地方 | 「用哪个方法」只写一次 |
      | 叶子能单独测 | 给它一个空白 qb，看它加了什么 |
      | 加新节点不用懂挂法 | 只需实现「往 qb 上加什么」 |
```

**三条同一个手法**：

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==**把「每次都要判断的东西」变成「不用判断的东西」。**==

  | 原本是可变的 | 变成常量之后 |
  |---|---|
  | 关联键叫什么 | 就叫 `uid`，不用查表 |
  | `COUNT(*)` 从哪来 | 写死的字符串，不用想 |
  | 该用 where 还是 andWhere | 父层决定，子层不用管 |

  ++这是设计里最省事的一类改动 —— 它不增加代码，只是**砍掉一种可能性**。++
```

---

## 06 · 另一种问题：两套机制重叠

前面五节讲的是「怎么防」。这一节是另一条线 —— 它跟安全无关，但同样容易踩。

### 同一个业务语义，两条路都通

「最近 30 天成交过」这个需求，DSL 里**两种写法都对**：

```jsonc
// A · 时间字段 + 相对时间操作符
{ "field": "last_trade_time", "op": "last_n_days", "value": 30 }

// B · 派生字段（天数）+ 普通比较
{ "field": "last_trade_days", "op": "lte", "value": 30 }
```

```journey
- tag: A · 相对时间操作符
  tone: amber
  name: last_n_days
  badge: 把「最近 N 天」做进操作符
  fields:
    - { k: 字段, v: last_trade_time, note: 还是那个时间点 }
    - { k: 操作符, v: last_n_days, note: 单位藏在操作符里, tone: warn }
    - { k: 值, v: "30" }
  note: SQL 是 `last_trade_time >= CURRENT_DATE() - INTERVAL 30 DAY`。
  next: "要反向呢？ :: :: 得再加一个操作符"

- tag: B · 派生字段
  tone: green
  name: derive（days_since）
  badge: 先把时间点算成一个数字
  fields:
    - { k: 字段, v: last_trade_days, note: 「距上次成交天数」, tone: ok }
    - { k: 操作符, v: lte, note: 普通比较符, tone: ok }
    - { k: 值, v: "30" }
  note: SQL 是 `DATEDIFF(CURRENT_DATE(), last_trade_time) <= 30`。
  next: "要反向呢？ :: :: 把 lte 改成 gte 就行"
```

### 决定的差别

```compare
first: 维度
head: [A · last_n_days, B · derive]
rows:
  - 要反向（60 天没来）:
      - { text: "得再加一个操作符 before_n_days", tone: red }
      - { text: "把 lte 改成 gte 就行", tone: green }
  - 能当表格一列吗:
      - { text: "不能 —— 操作符产不出一列值", tone: red }
      - { text: "能 —— 它就是个字段", tone: green }
  - 能按它排序吗:
      - { text: "不能", tone: red }
      - { text: "能", tone: green }
  - 单位能是「年」吗:
      - { text: "不能 —— 只有天和小时", tone: red }
      - { text: "能 —— age_years 就是年", tone: green }
```

**最后一条是决定性的**。「年龄 ≥ 18」**只能**用 B：

```sql
-- ✅ B · derive(age_years)
TIMESTAMPDIFF(YEAR, birthday, CURRENT_DATE()) >= 18     -- 闰年也正确

-- ❌ A 想做也做不了
birthday <= CURRENT_DATE() - INTERVAL 6570 DAY          -- 单位是天，且闰年差几天
```

### 所以两套都留着会怎样

````callout
tone: red
icon: ⚠
text: |
  **两套并存 = 四处要同步：**

  ```
  圈选组件   → 要为两种写法做两种 UI
  测试       → 两条路径都要覆盖
  改口径     → 两处都要改（比如改成「按自然日算」）
  评审       → 有人问「这俩有什么区别」时你得答得上来
  ```

  ==这就叫「不自洽」：同一个意思有两种说法。==

  而且 A 的能力是 B 的子集 —— ++删 A 不损失任何表达力。++
````

---

## 07 · 值的个数由输入决定

大部分条件的值都是「一个数」或「几个枚举」。但有一种特殊：

```json
{ "type": "uid", "op": "in", "uids": ["1001", "1002", "1003", ...] }
```

**它编译出来长这样**：

```sql
WHERE u.uid IN (?, ?, ?, ...)
bindings: ['1001', '1002', '1003', ...]
```

**这是唯一一种「值的个数由输入决定」的条件** —— 别的条件都只有一两个值。

```callout
tone: amber
icon: ⚠
text: |
  **所以它需要一条别的条件不需要的规则：上限。**

  三个约束叠在一起：

  | 约束 | 说明 |
  |---|---|
  | SQL 文本长度 | 5000 个 `?,` 大概 15KB |
  | 绑定参数个数 | 驱动和协议有上限（MySQL 是 65535；==Doris 没实测过，不确定==） |
  | 业务意图 | 「指定 UID」是「我手里有一小批人」，不是「上传一万个」 |

  ==三个里最该写清的是第三个 —— 它决定「超了怎么办」。==
```

**4.3 应该做的**：

```compare
first: 事项
head: [怎么做]
rows:
  - 定一个数字:
      - "跟界面输入框能装多少、驱动参数上限，取小的那个"
  - 说清超了怎么办:
      - "==在 Validate 阶段就拒绝==，返回明确错误码 —— 别让它跑到数据库再报语法错"
  - 留一句演进方向:
      - "如果 UID 规模真的上千上万，`IN (?, ?, ...)` 这个形状本身就不合适了 —— 那是换机制（临时表 / 数组参数），不是调上限"
```

---

## 08 · 自测

```quiz
- q: 「参数绑定」到底安全在哪？
  a: |
    ==不在于「它转义得更好」，在于「值不参与解析」。==

    数据库收到带 `?` 的 SQL 时，第 ① 步解析**只看得到「这里有个格子」**，
    值在第 ② 步才到。

    所以它不需要猜「哪些字符危险」—— **压根不存在「漏了某个字符」这种问题**。
    而内联就必须把所有危险字符列全：单引号、反斜杠、控制字符……
    漏一个就是一个洞（实测里漏的就是反斜杠）。
- q: 为什么 `whereRaw` 需要单独约定？
  a: |
    因为它**同时绕过两层保护**：

    · 值的转义（要自己写对）
    · 标识符的反引号（要自己打对）

    Knex 的其他 API 两层都管，只有 `raw` 是「这段我自己写的，你别管」。
    ==而关联子查询 `h.uid = u.uid` 是「列 比 列」，Knex 表达不了，必须用它。==

    所以整条编译链里，**只有 raw 里的那几段是我们写的裸文本** —— 管住它 = 管住唯一的破口。
- q: 那用什么规则管住 raw？
  a: |
    两条：

    ① **白名单** —— raw 里只允许出现：列名、`COUNT(*)`、`CURRENT_DATE()`、
       关联条件。加新东西要先想「它该不该进白名单」。
    ② **一眼可查的判据** —— ==看到 `${}` 插值就是红灯==。

    第二条的价值在于：**它不依赖读者理解整段逻辑**，看一个符号就够。
- q: 一个以反斜杠结尾的正常值，会造成什么后果？
  a: |
    如果只把单引号翻倍（不管反斜杠）：**整条 SQL 报语法错**。

    因为 `\` 在 SQL 里会把紧跟的 `'` 转义掉，于是字符串没闭合，
    后面所有内容都被当成 SQL 代码 —— 而它是残缺的，所以解析失败。

    ==这不是安全漏洞，是功能性 bug，而且更难定位 ——==
    报错信息里看不出「是一个值引起的」。
    实测：`'a\'` 直接 ERROR 1105，绑定版本正常返回 0。
- q: "`last_n_days` 和 `derive` 为什么建议只留一个？"
  a: |
    因为**它们能表达同一件事**（「最近 30 天」两条路都通），
    而 `derive` 是 `last_n_days` 的**超集**：

    · 反向不用加新操作符（`lte` 改 `gte`）
    · 能当展示列、能排序
    · **能表达「年」这个量纲** —— `last_n_days` 只有天和小时

    最后一条是决定性的：「年龄 ≥ 18」用 `last_n_days` **根本表达不了**
    （6570 天和 18 岁的实岁算法不是一回事，闰年会差）。

    两套都留着 → 两套 UI、两套测试、改口径改两处。==删掉子集，不损失任何表达力。==
- q: 「把可变变成常量」这个手法，在这套设计里有哪三处？
  a: |
    | 原本可变的 | 变成什么 |
    |---|---|
    | 关联键叫什么 | 就叫 `uid`，而且某列名不入库 |
    | `COUNT(*)` 从哪来 | 代码里的字符串字面量 |
    | 该用 where 还是 andWhere | 父层决定，递归函数只拿「挂载点」 |

    ==共同点：它不增加代码，只是**砍掉一种可能性**。==
    每砍掉一种，「出错的方式」就少一种。
```
