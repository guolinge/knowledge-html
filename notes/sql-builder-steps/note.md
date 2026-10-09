SQL Builder 的全部工作是一句话：==把「圈了什么人」翻译成一条能跑的 SQL==。

输入两样，输出四条语句，中间分四步：

```text
DSL（圈了什么）  +  Catalog（名字对应哪个物理列）
        │
        ├─ ① Validate   形状对不对、字段存不存在
        ├─ ② Resolve    名字 → 表名 / 列名
        ├─ ③ Compile    条件树 → WHERE 片段
        └─ ④ Assemble   片段 → 四条语句
                          ↓
        countSql · listSql · uidsSql · droppedUidsSql
```

```callout
tone: blue
icon: 🎯
text: |
  这篇拆的是《技术方案》4.3 那一节 —— ==讲的是方案怎么定的，不是代码怎么写==。

  每一步都按同一个问题拆：**吃什么进来、吐什么出去、什么情况下吐不出来**。

  ++实现细节（哪个文件、哪个函数）在「@insight/dsl：把圈选条件翻译成 SQL」那篇里。++
  两篇的分工：那篇读代码，这篇读方案。代码在这篇里只当证据用。
```

---

## 01 · 先划线：它做什么、不做什么

划这条线很重要，因为它决定了「输入输出」怎么定义。

```compare
first: 维度
head: [SQL Builder 做, SQL Builder 不做]
rows:
  - 编译: ["把 DSL 里的名字换成物理列名，拼出一条完整 SQL", "决定跑到哪张表、要不要分区裁剪 —— 那是 Doris 的事"]
  - 连接: [{ text: "不连接任何数据库", tone: green }, { text: "连库、执行、拿结果", tone: red }]
  - 权限: ["按调用方传进来的 actor 拼出 `u.staff_id = 101` 这一句", "决定 actor 是谁 —— 那是 BFF 的事，前端说的不算"]
  - 字段语义: ["按传进来的 Catalog 解析字段", "维护 Catalog —— 那是 Data Admin 的事"]
  - 值: ["把 DSL 值按语义类型转成 SQL 字面量", "查候选值对不对 —— 枚举校验只对着 Catalog 里那一份"]
```

因为它不连库，所以它的**产出是文本**，不是 result set。方案里专门写了一条：编译对外返回一条完整 SQL 文本，不是「SQL + 参数数组」。

这一条决定了后面所有形状：值是拼进语句里的字面量，那就必须自己保证转义正确（07 节）。

---

## 02 · 四步的输入输出

```lane-stack
- badge: STEP 01
  title: Validate
  desc: 两段校验，都不产出新数据
  tone: amber
  nodes:
    - { title: validateStructure, sub: "只走 DSL 自身", tag: 形状 }
    - { title: validateSemantics, sub: "要 Catalog", tag: 语义, tone: violet }
  next: "输入 DSL + Catalog，输出还是一份 DSL：这一步只回答能过不能过"
- badge: STEP 02
  title: Resolve
  desc: 把业务名字换成物理位置
  tone: blue
  nodes:
    - { title: 画像字段 → 表 + 列, sub: "age → user_portraits_wide.birthday", tag: column }
    - { title: 关系 → 表名, sub: "holding → rel_holding", tag: table }
    - { title: 关系子项 → 列, sub: "先定位关系，再找 OBJECT / PROPERTY", tag: 两级查找, tone: amber }
  next: "输入 DSL + Catalog，输出每个名字都指向一张表和一列"
- badge: STEP 03
  title: Compile
  desc: 递归编译整棵条件树
  tone: violet
  nodes:
    - { title: 组节点, sub: "AND / OR → 括号", tag: 递归 }
    - { title: 叶子节点, sub: "4 类叶子 → 5 种 SQL 形状", tag: 核心, tone: green }
  next: "输入一棵树，输出一段 WHERE 片段（内部是 { sql, bindings }）"
- badge: STEP 04
  title: Assemble
  desc: 同一段 WHERE，套四个外层
  tone: green
  nodes:
    - { title: uidsSql, sub: "只查 uid" }
    - { title: countSql, sub: "SELECT COUNT(*) FROM ( uidsSql ) AS t" }
    - { title: listSql, sub: "带展示列 + uid 游标" }
    - { title: droppedUidsSql, sub: "点名 UID 里被权限挡掉的", tone: amber }
  next: "输入 WHERE 片段，输出四条完整 SQL 文本"
```

上台要讲的那张表就是这个。==输入输出列写的是代码里的真实类型==，不是名词缩写，
因为听众下一个问题一定是「具体长什么样」，而那个答案下面四节各有一份。

```compare
first: 步骤
head: [输入的真实类型, 输出的真实类型, 失败时]
rows:
  - "① Validate": ["`InsightQuery` + `Catalog`", "**`void`** —— 成功什么都不返回，只是没抛", "`throw new CompileError(code, message)`"]
  - "② Resolve": ["`Catalog` + 一个名字（字符串）", "`FieldDef` / `RelationDef` / `RelationPropDef` 对象", "字段没找到 → `UNKNOWN_FIELD`"]
  - "③ Compile": ["`BoolNode` + `CompileCtx`", "**`Apply | null`** —— 一个函数，不是字符串", "不该发生 —— 规则已经在 ①② 查完了"]
  - "④ Assemble": ["`Apply` 挂到 builder 上 + `page`", "`CompileResult`：4 个字符串 + 2 个数组", "拼装失败说明前一步的片段不合法"]
```

真实入口（都是代码里的签名，没改一个字符）：

```ts
// ① 两段校验，没有返回值 —— 过了就是没抛
export function validate(query: InsightQuery, catalog: Catalog): void

// ② 没有 resolve 函数。它是三次查表：
fieldByName(catalog, leaf.field)                  // → FieldDef | undefined
relationByName(catalog, leaf.relation)            // → RelationDef | undefined
rel.props.find((c) => c.name === item.field)      // → RelationPropDef | undefined

// ③ 返回的是一个闭包 ——「怎么把这段条件加到某个查询上」
type Gate  = 'and' | 'or'
type Apply = (query: Knex.QueryBuilder, gate: Gate) => void

// ④ 唯一对外的那一个
export function compile(query: InsightQuery, options: CompileOptions): CompileResult
```

### 两样输入都是 JSON，第二样长这样

第一样是那份 DSL（03 节有真实例子）。第二样是 **`Catalog`**：
它只有三个键，整个类型就三行：

```ts
type Catalog = {
  universeTable: string;      // 主表：SQL 的 FROM 哪张表
  fields:    FieldDef[];      // 画像字段
  relations: RelationDef[];   // 关系
};
```

真实的那一份（测试用的）是 3722 字节：12 个字段、2 个关系。骨架：

```json
{
  "universeTable": "user_portraits_wide",
  "fields":    [ { "name": "age", "table": "user_portraits_wide", "expr": { … } }, …, 共 12 个 ],
  "relations": [ { "name": "holding", "table": "rel_holding", "props": [ … ] }, …, 共 2 个 ]
}
```

从这个骨架能读出两件事：

- **`universeTable` 决定 `FROM` 哪张表。** 那 12 个字段的 `table` 全部是它，
  所以生成的 SQL 从头到尾只有一张主表 —— 对比 07 节的 `uidsSql`，`FROM` 后确实只有 `user_portraits_wide`。
- 每个字段都带 `table`，!!但在这份数据里它从不发挥作用!!。编译器里留着
  「字段在别的表上就 LEFT JOIN 过来」的分支，而这 12 个字段没有一例外。
  ==所以那段 JOIN 逻辑在这份 catalog 下永远不会跑==，读代码时容易误以为真的会联表。

`Catalog` 不是手写的，是从 Data Admin 那批配置表里投影出来的，
只收录 `ENABLED` 的字段与关系，对应接口 `GET /api/meta/catalog`。
那批表长什么样、怎么映射到这份 JSON，在「Data Admin 的 7 张配置表」那篇里。

==三步的边界很硬：第 ① 步不知道物理列存在，第 ② 步不拼 SQL，第 ③ 步不再做任何判断。==

上面表里有两格会让人意外，兩个都是方案里看不出来的：

```callout
tone: red
icon: ⚠
text: |
  **一、第 ① 步的输出是 `void`，不是「同一份 DSL」。**

  方案写的是「输出还是一份 DSL」，所以我把那张表的第一行写成了那样。
  代码里 `validate()` 的返回类型就是 `void` —— 它把 DSL 读一遍、对一遍字典，
  然后什么都不返回。==不存在一份「改过的 DSL」传给下一步==，下一步用的还是同一个对象。

  **二、第 ③ 步的输出是一个函数。**

  不是字符串，也不是 `{ sql, bindings }`。前半篇我把它写成了「片段 + 绑定值列表」，
  把两层的产物混成了一层。真实的层次在 05 节。
```

这个分工有个直接好处：==到 ③ 的时候，所有「查字典」都已经做完了==，编译只是一次纯递归。方案里那句「Resolve 之后，DSL 里每个名字都能直接对应到 Doris 里的一张表和一列」说的就是这件事。

---

## 03 · Validate：为什么分两段

两段校验的分界线不是「检查得严不严」，是**它需不需要字段字典**。

```flow
grid: true
nodes:
  - { id: dsl, label: "一份 DSL", sub: "界面传过来的 JSON", row: 0, kind: external }
  - { id: s1, label: "① 形状校验", sub: "不查任何字典 · 例：EMPTY_GROUP", row: 1, tone: amber }
  - { id: s2, label: "② 语义校验", sub: "必须拿到 Catalog · 例：UNKNOWN_FIELD", row: 2, tone: violet }
  - { id: ok, label: "放行", sub: "同步进下一步，后面不再重新判断", row: 3, tone: green }
edges:
  - { from: dsl, to: s1 }
  - { from: s1, to: s2, label: "形状先过" }
  - { from: s2, to: ok, label: "语义再过" }
```


两段各查什么，方案给了两张清单：

```compare
first: 分界
head: [形状校验（不看字典）, 语义校验（要字典）]
rows:
  - 检查内容: ["`version`、`scope` 合法性、`group` 非空、`uids` 是十进制整数字符串、`between` 得有两个值", "`field_key` 存在且 ENABLED、`op` 在这个字段的允许列表里、值类型匹配 `semantic_type`、枚举值在候选表里且 ENABLED"]
  - 错误码: ["`UNSUPPORTED_VERSION` `MISSING_SCOPE` `EMPTY_TEAM` `EMPTY_GROUP` `INCOMPLETE_LEAF` `UNKNOWN_NODE`", "`UNKNOWN_FIELD` `UNKNOWN_RELATION` `UNKNOWN_RELATION_PROP` `DISABLED_REF` `OP_NOT_ALLOWED` `VALUE_TYPE` `INVALID_SCOPE`"]
  - 谁能跑: ["**浏览器也能跑** —— 不需要字典", "只有服务端能跑 —— 字典在服务端"]
```

分两段的理由就藏在最后一行：形状校验不依赖任何外部数据，==圈选组件可以在发请求之前先在本地跑一遍==，用户填错结构当场就能提示，不用等一次网络往返。

方案把这条写成了「为什么分两段」。这一节值得单列，就是因为这一条。

`validate-lab` 那个交互就是照这张表做的：喂几个坏输入，看它在哪一段被拦。

### 真实形态

输入就是那份 DSL 本身，没有任何包装：

```json
{
  "version": 1,
  "scope":   { "type": "scope", "kind": "self" },
  "include": { "type": "group", "logic": "AND", "children": [
    { "type": "portrait", "field": "age", "op": "gte", "value": 18 }
  ]},
  "exclude": null
}
```

输出是 **`void`**。成功就是没抛异常；失败抛出来的东西长这样（真实实例，不是我编的）：

```text
CompileError {
  name:    'CompileError'
  code:    'UNKNOWN_FIELD'
  message: 'unknown field nope'
}
// instanceof Error === true
// 自有属性：['stack', 'message', 'code', 'name']
```

所以调用方看到的是两种结果：安静返回，或者一个带 `code` 的 Error。
后者直接拿去当接口的错误码用，不需要再映射一层。

`code` 是一张**联合类型写死的**表（13 个），不是自由字符串：

```ts
MISSING_SCOPE  INVALID_SCOPE  EMPTY_TEAM  EMPTY_GROUP  SCOPE_DENIED
UNSUPPORTED_VERSION  UNKNOWN_FIELD  UNKNOWN_RELATION  UNKNOWN_RELATION_PROP
OP_NOT_ALLOWED  VALUE_TYPE  INCOMPLETE_LEAF  UNKNOWN_NODE
```

对照一下方案列的 13 个：代码里有而方案没写的是 `SCOPE_DENIED`；
方案里有而代码里一个都没有的是 !!`DISABLED_REF`!!（10 节展开）。

---

## 04 · Resolve：把名字换成物理位置

四种解析，三种查法：

```compare
first: DSL 里出现的东西
head: [怎么查, 查出来什么]
rows:
  - "画像字段 `field`": ["`field_type = PORTRAIT` 且 `field_key` 匹配", "该字段的 `column_name`，如 `user_portraits_wide.birthday`"]
  - "关系 `relation`": ["`field_type = RELATION` 且 `field_key` 匹配", "该关系的物理表名，如 `rel_holding`"]
  - "关系子项 `objects[]`": [{ text: "**两次查找**：先定位关系，再在子项里取 `item_role = OBJECT` 的那一条", tone: amber }, "该子项的 `column_name`，如 `rel_holding.object_id`"]
  - "关系子项 `props.items[]`": [{ text: "同上，取 `item_role = PROPERTY` 的那一条", tone: amber }, "该子项的 `column_name`，如 `rel_holding.qty`"]
```

关系子项为什么要两次查找，方案单独画了一张图解释：

```flow
grid: true
nodes:
  - { id: leaf, label: "DSL 的关系叶子", sub: "relation=holding · objects=['00700.HK'] · props=[qty >= 100]", row: 0, kind: external }
  - { id: rel, label: "关系本体那一行", sub: "field_key=holding · parent_id=0", row: 1, tone: violet }
  - { id: obj, label: "子项 · OBJECT", sub: "field_key=stock → column_name=symbol", row: 2, tone: blue }
  - { id: prop, label: "子项 · PROPERTY", sub: "field_key=qty → column_name=qty", row: 2, tone: blue }
  - { id: c1, label: "rel_holding.symbol", sub: "objects 落这一列", row: 3, tone: green }
  - { id: c2, label: "rel_holding.qty", sub: "props 落这一列", row: 3, tone: green }
edges:
  - { from: leaf, to: rel, label: "按 field_key 找关系" }
  - { from: rel, to: obj, label: "按 parent_id" }
  - { from: rel, to: prop, label: "按 parent_id" }
  - { from: obj, to: c1 }
  - { from: prop, to: c2 }
```

多这一步的原因很实在：**`qty` 这种 `field_key` 只在自己所属的关系内唯一**。同一个名字挂在两个关系下可以指向两个不同的列，所以查找时必须先定位关系，再查它自己的子项。

方案里还有一条硬约束：!!一个关系最多配置一个 OBJECT!!。因为 `objects[]` 到底落在哪一列，取决于该关系下哪条子项的 `item_role` 是 `OBJECT`；配了两条就无法确定用哪一条。这条由 Data Admin 在写入时拦截，不会进到编译阶段。

### 真实形态

这一层最能落地：它返回的不是“映射关系”，而是两个真真实实的对象。
拿 `age` 和 `holding` 去查，回来的就是下面这两个（实际跑出来的，一个字段没改）：

```json
// fieldByName(catalog, 'age')
{
  "name": "age", "label": "年龄",
  "table": "user_portraits_wide",
  "expr": { "fn": "years_between", "args": [ { "col": "birthday" }, { "ctx": "today" } ] },
  "valueType": "int",
  "ops": ["eq","neq","lt","lte","gt","gte","between","is_null","is_not_null"]
}
```

```json
// relationByName(catalog, 'holding')
{
  "name": "holding", "label": "持仓标的",
  "table": "rel_holding",
  "objectType": "string",
  "objectSource": { "kind": "provider", "key": "stock_search" },
  "props": [
    { "name": "market", "column": "market", "valueType": "enum",
      "options": [ { "value": "HK", "label": "港股" }, { "value": "US", "label": "美股" } ] },
    { "name": "qty", "column": "qty", "valueType": "decimal" },
    { "name": "market_value", "valueType": "decimal",
      "expr": { "fn": "div", "args": [ { "col": "market_value_hkd" }, { "lit": 10000 } ] } }
  ]
}
```

两个细节看这两个 JSON 就够了：

- `age` 有 `table` 但**没有 `column`**，它靠 `expr` 算出值；同形状的直连字段有 `column` 没 `expr`。
  编译器不需要分支，它读的是同一个位置，只是那个位置可能是列名、也可能是一棵表达式。
- 关系的 `table` 是 `rel_holding`（一张表，不是一个列），
  而对象本身没有列名，它靠 `objectSource` 说“值从哪里来”：
  `provider` 是一个搜索服务，所以 `stock_search` 才会被叫成 resolver。

### 有个东西库里没有对应的列

`age` 就是例子。表里没有 `age` 列，它的值由 `birthday` 算出来。方案用 `derive_kind` 描述这种换算关系：

```text
age_years   →  TIMESTAMPDIFF(YEAR, col, CURRENT_DATE())
days_since  →  DATEDIFF(CURRENT_DATE(), col)
```

`derive_kind` 的取值**写死在代码里**，Metadata 只能从里面挑，不能自己新增。理由是很直接的一条：每增加一种派生方式，编译器就要多一个对应的 SQL 模板。也就是说，==这一列看起来是数据，改它就是在改代码==。

本条还有一句限定：派生方式决定的是「`column_name` 这个位置填什么」。`column_name` 和 `derive_kind` 的关系是「填了列名就不再填派生」。

---

## 05 · Compile：一棵树怎么变成一段 WHERE

### 先看这一步要交什么货

输入是一棵条件树，输出是 `WHERE` 里的一段条件。拿一棵最小的真树走一遍，
条件读作「年龄 ≥ 18」且「地区是美国或中国香港」：

```json
{ "type": "group", "logic": "AND", "children": [
  { "type": "portrait", "field": "age", "op": "gte", "value": 18 },
  { "type": "group", "logic": "OR", "children": [
    { "type": "portrait", "field": "region", "op": "eq", "value": "US" },
    { "type": "portrait", "field": "region", "op": "eq", "value": "HK" }
  ]}
]}
```

真实编译出来的那一段（`uidsSql` 的 WHERE 部分；`staff_id = 101` 是权限谓词，
由服务端按调用方身份加上，02 节讲过）：

```sql
WHERE `u`.`staff_id` = 101
  AND (`u`.`birthday` <= '2008-10-09'
  AND (`u`.`region` = 'US' OR `u`.`region` = 'HK'))
```

树的嵌套结构，原样变成了括号的嵌套。这一步的难点全在括号上，其余部分是照着类型往下抄。

### 如果让每个节点返回一个字符串

最省事的做法是：每个节点把自己那截 SQL 拼成字符串返回，父节点拿 `AND` 或 `OR` 连起来。

内层那个 OR 组会返回：

```sql
`u`.`region` = 'US' OR `u`.`region` = 'HK'
```

外层 AND 组把两个孩子连起来，再让权限谓词接在前面，拿到的是：

```sql
WHERE `u`.`staff_id` = 101 AND `u`.`birthday` <= '2008-10-09' AND `u`.`region` = 'US' OR `u`.`region` = 'HK'
```

这行是错的，而且错得危险。SQL 的规矩是 `AND` 比 `OR` 先算，所以它实际等于：

```sql
WHERE (`u`.`staff_id` = 101 AND `u`.`birthday` <= '2008-10-09' AND `u`.`region` = 'US')
   OR (`u`.`region` = 'HK')
```

最后那一截独立出去了。==它把权限和年龄条件全甩掉==：只要地区是中国香港，
不管是不是这位员工名下的客户、不管年龄多大，都会被选出来。

这个优先级可以拿数据库直接验，把 `0` 换成假条件、`1` 换成真条件就是上面那件事：

```bash
$ mysql -e "SELECT 1 WHERE 0=1 AND 0=1 OR 1=1"
1 row      # 前面那两个假条件没拦住它
$ mysql -e "SELECT 1 WHERE 0=1 AND (0=1 OR 1=1)"
0 rows     # 加上括号才拦得住
```

那让父节点自己补括号行不行？也不行。父节点手上只有一截字符串，
==它看不出这截字符串里有没有 `OR`==，也就不知道要不要包。
想判断就得把字符串再解析回树，等于把刚做完的活倒着做一遍。

### 那就不返回值，返回一个动作

既然括号是父节点猜不出来的，就换个方向：把「加到哪」和「用哪个连接词」交给子节点，
让它当场把自己加上去。于是这一步的产物不是字符串，是一段还没执行的动作：

```ts
type Gate  = 'and' | 'or';
type Apply = (query: Knex.QueryBuilder, gate: Gate) => void;

function compileNode(node: BoolNode, ctx: CompileCtx): Apply | null
```

`Apply` 读作==怎么把这段条件加到某个查询上==。两个参数各管一件事：

| 参数 | 管什么 | 值从哪来 |
|---|---|---|
| `query` | 加到哪个查询上 | 组节点把自己括号里那个 builder 传下来，子节点的条件就落在括号内 |
| `gate` | 用 `and` 还是 `or` | 父节点按 `logic` 决定后传下来 |

`gate` 为什么非得当参数传？因为 ==Knex 把连接词写进了方法名==，没有「加一个条件、连接词另外指定」这种写法：

```ts
// compile.ts 261 行附近：同一个子查询，按 gate 挑不同方法
if (gate === 'or') query.orWhereIn(`${UNIVERSE_ALIAS}.uid`, inner);
else               query.whereIn(`${UNIVERSE_ALIAS}.uid`, inner);
```

所以 `gate` 不是可有可无的提示，它决定调哪个方法。

### 括号究竟是谁加的

组节点的真实代码（`compileNode` 开头，226 行附近）：

```ts
const grouped = function (this: Knex.QueryBuilder) {
  children.forEach((child, index) => {
    child(this, index === 0 ? 'and' : logic === 'OR' ? 'or' : 'and');
  });
};
if (gate === 'or') query.orWhere(grouped);
else               query.where(grouped);
```

三件事值得读出来：

1. `query.where(函数)` 里传的是函数，Knex 会把它整个用括号包起来。括号是这么来的，全文没有一处手写 `(`。
2. `forEach` 里第一个孩子拿 `'and'`。它前面还没有条件，连接词用不上，但参数总得给一个。
3. 后面每个孩子按 `logic` 拿 `'or'` 或 `'and'`。连接词由父节点定，方法名由孩子自己挑。

树的形状和产物对应起来是这样（最下面一行是各叶子那段 SQL）：

```tree
- label: 组节点 · AND
  tone: violet
  sub: "logic=AND"
  note: "query.where( grouped )，整体自带一层括号"
  children:
    - label: portrait 叶子
      sub: "age gte 18"
      note: "→ `u`.`birthday` <= '2008-10-09'"
    - label: 组节点 · OR
      tone: violet
      sub: "logic=OR"
      note: "query.orWhere( grouped )，再包一层括号"
      children:
        - { label: portrait 叶子, sub: "region eq US", note: "→ `u`.`region` = 'US'" }
        - { label: portrait 叶子, sub: "region eq HK", note: "→ `u`.`region` = 'HK'" }
```

方案里「技术选型：Knex」讲的三件事之一就是括号嵌套：条件树是嵌套的，手拼括号要自己数层数。

---

## 06 · 三类叶子，五种形状

前面讲的是「怎么算出来」，这一节讲「算出来有几种」。`WHERE` 里能出现的条件形状一共五种，
任何一个叶子节点编出来都落在这五种里。

能进这棵树的节点，`schema.ts` 里只有四种：

```ts
type BoolNode = BoolTree | PortraitLeaf | RelationLeaf | UidLeaf;
```

`BoolTree` 是上面讲完的组节点，另外三种是叶子：画像字段、关系、点名的 uid。

三种叶子按 `formula` 和 `op` 再分，落到 SQL 上是五种形状：

```compare
first: 叶子
head: [编译成什么形状, 真实 SQL（简化）]
rows:
  - "`portrait`": ["`col op 值`", "`u`.`birthday` >= ?"]
  - "`relation` + `detail` + `in`": ["`uid IN ( 子查询 )`", "`u.uid IN (SELECT uid FROM rel_holding WHERE object_id IN (...))`"]
  - "`relation` + `detail` + `not_in`": [{ text: "`NOT EXISTS ( 相关子查询 )`", tone: amber }, "`NOT EXISTS (SELECT 1 FROM rel_holding WHERE rel_holding.uid = u.uid AND ...)`"]
  - "`relation` + `times`": ["`uid IN ( 子查询 GROUP BY uid HAVING COUNT(*) op 值 )`", "`u.uid IN (SELECT uid FROM rel_trade WHERE ... GROUP BY uid HAVING COUNT(*) >= 3)`"]
  - "`uid`": ["`u.uid IN ( 一串字面量 )`", "`u.uid IN (11, 22)`"]
```

关系的三行是这么来的：`formula` 有两种（`detail` 看有没有、`times` 数几条），
`detail` 又按 `op` 分成正向和 `not_in` 反向，加起来三种，和画像、uid 一起就是五种。
分支点就在 compileRelation 的开头两行判断上。

==同一批数据换一个 `op` 就换一种形状==，这是 4.3 里最该讲清楚的一处扭转。看实测出来的两条：

```sql
-- detail + in：存在一条匹配的关系记录
SELECT `u`.`uid` AS `uid`
FROM `user_portraits_wide` AS `u`
WHERE `u`.`staff_id` = 101
  AND (`u`.`uid` IN (
        SELECT `rel_holding`.`uid`
        FROM `rel_holding` AS `rel_holding`
        WHERE `rel_holding`.`object_id` IN ('SEMI', 'NVDA.US')
      ))
```

```sql
-- times + gte：匹配的关系记录条数不少于 2
SELECT `u`.`uid` AS `uid`
FROM `user_portraits_wide` AS `u`
WHERE `u`.`staff_id` = 101
  AND (`u`.`uid` IN (
        SELECT `rel_holding`.`uid`
        FROM `rel_holding` AS `rel_holding`
        WHERE `rel_holding`.`object_id` IN ('SEMI')
        GROUP BY `rel_holding`.`uid`
        HAVING COUNT(*) >= 2
      ))
```

同一张 `rel_holding`，同一批 `objects`，差别只在把「存在」换成「数一数」。于是子查询从「查有哪些 uid」变成「按 uid 分组再筛」。

### 一个例外：`{ sql, bindings }` 只在 exclude 时出现

前面一直说这一步不返回字符串。`compile()` 内部确实有一处把 `Apply` 变成了字符串，
只有 exclude 走这道手续，因为它要把整段条件塞进 `NOT COALESCE( ... , FALSE )`：

```ts
// compile.ts 130 行附近
builder.whereRaw(`NOT COALESCE((${exclude.sql}), FALSE)`, [...exclude.bindings]);
```

`exclude.sql` 是 `whereFragment(apply)` 的返回值：把 `Apply` 在一个空 builder 上跑一遍，
再取 `where` 后面那截字符串。真实跑出来的值：

```json
{
  "sql": "`u`.`gender` = ? and u.uid > ?",
  "bindings": ["M", 100]
}
```

参数绑定确实存在，但它不是这一层的产物，也不对外。它只活在「把片段拼成字符串再包一次」这一个环节里。
include 那段根本不经过 `whereFragment`，它是直接 `includeApply(builder, 'and')` 挂到主查询上的。

### 权限谓词，写在所有条件之前

上面那些条件都还没算权限时，`WHERE` 的第一段已经固定下来了。
`scope` 描述的「客户范围」不由 DSL 决定，而是由服务端按调用方身份补上的一小段条件：

```compare
first: actor 与 scope
head: [追加的谓词]
rows:
  - "`dataLevel = self`": ["`u.staff_id = 101`（当前登录人的 staffId）"]
  - "`dataLevel = team`": ["`u.group_id IN (1, 2, 3)`（当前登录人可见的 groupId）"]
  - "`scope.kind = team` 且调用方是组长": ["两者取交集，越权的 groupId 被过滤掉"]
```

它和业务条件是 AND 关系，写在 WHERE 的哪个位置语义上都一样。方案给了「为什么放最前面」的理由：让生成的语句有一个固定形状：任何身份、任何条件下，都是先限权限、再谈业务。排查问题时一眼就能找到权限那一段。

顺带一句边界：`scope` 越权（比如只有「本人」权限却传了 `team`）整次查询拒绝，不做「默默裁剪成权限内」。

---

---

## 07 · Assemble：同一段 WHERE，四条语句

```compare
first: 语句
head: [外层长什么样, 分页，四条的共用部分, 谁在用]
rows:
  - uidsSql: ["SELECT uid FROM 宽表 WHERE 片段", "不分页，全量", "创建快照 —— 交给 DAL 做 INSERT SELECT"]
  - countSql: ["SELECT COUNT(*) FROM ( uidsSql ) AS t", "不分页", "预览页显示「共 N 条」"]
  - listSql: ["SELECT 展示列 + ORDER BY uid LIMIT n", "uid 游标翻页", "预览页的表格"]
  - droppedUidsSql: ["SELECT v.uid FROM ( 点名的 uid ) AS v WHERE NOT EXISTS ( ... )", "只在点名了 UID 时才有值，其余是 null", "提示「点名的 N 人里有 M 人不在你的数据范围内」"]
```


四条语句为什么要分开返回，方案说得很直白：因为 DAL 的三个接口需要的东西不同：预览要人数、预览要一页名单、创建快照要全量 uid。

### 真实形态

对外只有这一个对象。拿「年龄≥18 且持有 00700.HK 数量≥100，排除 UID 11/22，第 2 页 10 条」跑一遍，
`CompileResult` 的六个字段是这些（长度也是量出来的）：

```text
countSql        string   404 字符
listSql         string   547 字符
uidsSql         string   363 字符
droppedUidsSql  string   184 字符   ← 没点名 UID 时这里是 null
usedTables      string[] ["rel_holding", "user_portraits_wide"]
listColumns     object[] [ { key, label, kind, valueType } ]
```

看得出来的两件事：

- **四个 SQL 字段都是纯字符串**，值已经渲染进去了，旁边没有 `bindings`。方案那句「不是 SQL + 参数数组」在这一层是对的。
- `usedTables` 是本次查询涉及的物理表（去重、排序后）；`listColumns` 是给前端渲染表头的列定义。
  两个都不是给 DAL 的，是给调用方自己看的。

`listColumns` 的真实内容（只有一列，因为条件里只用到 `age` 作为展示列）：

```json
[ { "key": "age", "label": "年龄", "kind": "portrait", "valueType": "int" } ]
```

而 `droppedUidsSql` 是四条里唯一一条不派生自主查询的：
它把点名的 uid 当成一张临时表 `v`，再问一遍“这些人里谁不在我的权限内”：

```sql
SELECT `v`.`uid` FROM (SELECT 11 AS `uid` UNION ALL SELECT 22) AS `v`
WHERE NOT EXISTS (
  SELECT 1 FROM `user_portraits_wide` AS `u`
  WHERE `u`.`uid` = `v`.`uid` AND `u`.`staff_id` = 101
)
```

### countSql 为什么要包一层

```sql
SELECT COUNT(*) AS `count`
FROM (
  SELECT `u`.`uid` AS `uid`
  FROM `user_portraits_wide` AS `u`
  WHERE `u`.`staff_id` = 101 AND ( ... )
) AS `t`
```

包一层是为了==数人不数行==：主查询里如果有 JOIN 或关系子查询，外层直接 `COUNT(*)` 数到的可能不是人数。`uidsSql` 那一层只 `SELECT uid`，所以它数出来的人数和名单长度天然对得上。

!!但这里有个坑：包一层本身不去重。!! 如果 `uidsSql` 真的出现了重复 uid，这个 `COUNT(*)` 会照样把它数成两个人。去重靠的是语句形状，关系条件走 `IN` 子查询而不是 JOIN，就是为了不产生重复行。这一点在 08 节。

### listSql 用 uid 游标，不用 OFFSET

```sql
SELECT
  `u`.`uid`           AS `uid`,
  `u`.`customer_name` AS `customer_name`,
  `u`.`staff_name`    AS `staff_name`,
  TIMESTAMPDIFF(YEAR, `u`.`birthday`, '2026-09-30') AS `age`
FROM `user_portraits_wide` AS `u`
WHERE ( ... )
ORDER BY `u`.`uid`
LIMIT 10
```

翻第二页时不加 `OFFSET`，而是把上一页最后一个 uid 带上（真实夹具里的形态）：

```sql
SELECT `u`.`uid` AS `uid`, `u`.`customer_name` AS `customer_name`
FROM `user_portraits_wide` AS `u`
WHERE `u`.`staff_id` = 101
  AND (`u`.`birthday` <= '2006-09-30' AND `u`.`birthday` > '2005-09-30')
  AND `u`.`uid` > 10010
ORDER BY `u`.`uid`
LIMIT 10
```

翻第二页时不是 `OFFSET 10`，而是把上一页最后一个 uid 带上：`AND u.uid > 10010`。方案给的理由是避免深分页时的性能衰减。

分页只影响 `listSql`，`countSql` 和 `uidsSql` 不带分页。这就是为什么它们共享同一段 WHERE，却要分成三条。

### 为了产出「一条能直接执行的文本」，Knex 上有四处要补

方案选 Knex 做 SQL 构造器（括号、别名、引号转义这三件事手写容易错），但它的默认行为和 Doris、和这份契约对不上。四处补偿：

```compare
first: Knex 的默认行为
head: [怎么办, 为什么]
rows:
  - 字符串用反斜杠转义：`'O\\'Brien'`": ["覆盖转义函数，改成单引号翻倍 `'O''Brien'`", "Doris 走 ANSI 语法"]
  - 布尔值输出小写 `true` / `false`": ["改成 `TRUE` / `FALSE`", "Doris 要大写"]
  - "`offset` 为 0 时省略 `OFFSET` 子句": ["显式补一个 `OFFSET 0`", "让分页语句的形状保持固定，不随参数变"]
  - 关键字输出小写": ["渲染之后统一转成大写", "fixture 和调用方看的是大写形态"]
```

方案还限定了一件界外的事：**只把 Knex 当 SQL 构造器用**：不用它的 model、migration、seed 和连接池。因为本包不连数据库，只生成文本。

---

## 08 · 三处扭转

这三处是评审时最容易被挑的地方，也是方案专门用「实现约定」一节写的。

### 扭转一：关系条件用 `IN` 子查询，不用 LEFT JOIN

```compare
first: 写法
head: [一个人持 5 个标的会怎样, 结论]
rows:
  - LEFT JOIN: [{ text: "JOIN 之后这个人变成 5 行，`COUNT(*)` 把 1 个人数成 5 个人", tone: red }, "不能用"]
  - "`IN` 子查询": ["只回答「这个 uid 在不在结果集里」，一行对应一个人", "采用"]
```

方案在这里补了一句容易被忽略的话：==子查询里只写 `SELECT uid` 不会去重==，去重需要 `DISTINCT` 或 `GROUP BY`。而本设计是==从语句形状上避免重复行的产生==，不是在统计时去重。 这正是 countSql 那一层不写 `DISTINCT` 的前提。

### 扭转二：`not_in` 编译成 `NOT EXISTS`

这个坑值得单独演示一遍。三个人，条件都写「不持有腾讯」：

```compare
first: 人
head: [他的关系记录, "正确写法 `NOT EXISTS( object = 腾讯 )`", "错误写法 `object NOT IN ('腾讯')`"]
rows:
  - A: ["腾讯、阿里", { text: "排除（他确实有腾讯那条记录）", tone: green }, { text: "**留下** —— 因为他还有一条阿里记录", tone: red }]
  - B: ["阿里", "留下", "留下"]
  - C: ["（无持仓）", "留下", "留下"]
```

`not_in` 表达的是**关系集合级的否定**：不存在这个人与腾讯的关系记录。改写成对象列上的 `NOT IN` 就变成了**行级否定**，只判断「某一行是不是腾讯」。同时持有腾讯和阿里的人因为还有一行阿里，就被错误地留下了。

对应的真实 SQL 形状也完全不同：

```sql
-- 不是：WHERE object_id NOT IN ('腾讯')
NOT EXISTS (
  SELECT 1
  FROM rel_holding
  WHERE rel_holding.uid = u.uid
    AND rel_holding.object_id IN ('00700.HK', '00800.HK')
)
```

### 扭转三：include 和 exclude 的写法差一层 `COALESCE`

```text
include  →  (cond1 AND cond2)
exclude  →  NOT COALESCE((cond1 AND cond2), FALSE)
```

不写 `COALESCE` 的话，一个性别为 NULL 的记录会被「排除男性」一并排除掉。这部分 `null-lab` 那个交互讲的正是它：同一批数据、同一个条件，只换「放进哪边」和「包不包 COALESCE」，看哪几行被留住。

方案给的机制解释是：SQL 里 `NOT UNKNOWN` 的结果**仍是 `UNKNOWN`**，在 WHERE 中按 false 处理，于是「是男性」和「不是男性」两个集合都没收留它。

这三处扭转让「同一段 WHERE」这句描述变得不准确。准确的说法是：==include 和 exclude 共用一套叶子编译规则，但最外层包法不同。==

---

## 09 · 扩展点：常见改动各要动哪里

方案专门列了这一张表，它回答的是「这个组件的可演进性在哪」。改动分两边：数据在 Data Admin 里配，配完即生效；代码改完要重新发布。

```compare
first: 需要新增
head: [改哪里, 说明]
rows:
  - 一个数据源: ["`crm_dc_data_source` 与 `crm_dc_data_field` 增加记录", "SQL Builder 不感知有几个数据源，只认传进来的字段字典"]
  - 一个操作符: ["`schema.ts` 加定义；`compile.ts` 加编译分支；`crm_dc_operator` 加记录", "**前三处缺一不可** —— 前两处决定它怎么变成 SQL，第三处决定哪些字段能用它"]
  - 一个叶子类型: ["`schema.ts` 加类型和类型判断；`validate.ts` 与 `compile.ts` 各加分支", "叶子类型是 DSL 结构的一部分，校验和编译都要认识它"]
  - 一种派生方式: ["`metadata.ts` 的 `FieldDerive` 加取值与 SQL 模板；`crm_dc_data_field` 补取值", "可选取值写死在代码里，Metadata 只能从中挑"]
```

这张表值得在讲解时点一句：==四行里只有第一行是纯配置==。加字段不加代码，加操作符和加叶子要发版。这是设计上刻意的取舍，不是疏漏。

---

## 10 · 讲的时候留意：方案和实现现在的差异

4.3 是设计稿，`packages/dsl` 是按它实现的。==哪边说了算，按代码。==
两份对不上的地方列在这里。==前两行不是“实现落后了”，是方案写错了==。

```compare
first: 项
head: [技术方案 4.3, 代码里的事实]
rows:
  - 第 ① 步的输出: ["「输出还是一份 DSL」", { text: "`validate(): void` —— 什么都不返回", tone: red }]
  - 停用字段的错误码: ["语义校验返回 `DISABLED_REF`", { text: "**零处**。这个码在 `packages/dsl` 里一次都没出现", tone: red }]
  - 越权客户范围: ["未单独列错误码", { text: "有 `SCOPE_DENIED`（3 处引用）", tone: amber }]
  - 关系对象落到哪一列: ["取 Metadata 里 OBJECT 子项的 `column_name`，例子里叫 `symbol`", { text: "**写死 `object_id`**（`compile.ts:356`）—— 这个列名不来自 Catalog", tone: red }]
  - 派生字段: ["`derive_kind` 两种取值：`age_years` / `days_since`", "换成声明式表达式 `expr`，原语 12 个（`div` / `mul` / `years_between` …）"]
  - "`age >= 18` 编成什么": ["`TIMESTAMPDIFF(YEAR, u.birthday, CURRENT_DATE()) >= 18`", "**下推成 `birthday <= '2008-10-09'`**，让条件落在裸列上，Doris 能用分区裁剪和前缀索引"]
  - 今天/现在从哪来: ["SQL 里直接写 `CURRENT_DATE()`", "由调用方传入 `today` / `now`（`CompileOptions` 上的可选字段），SQL 不写 `CURDATE()` / `NOW()`"]
  - 数值字面量: ["直接写 `1000`", "`CAST('1000' AS DECIMAL(38,10))`，避免参数被当 DOUBLE 丢精度"]
```

前两行合起来看：**`DISABLED_REF` 不存在，正是因为 `validate` 什么都不返回。**
想说“你引用了一个已停用的字段”，就得拿得到“这个字段曾经存在”这个事实，
而 Catalog 只收录 ENABLED 的字段（Data Admin 那份投影里只姿势两种状态），
停用字段在编译器眼里和“从来没写过这个字段”长得一模一样，
所以它只能报 `UNKNOWN_FIELD`。这不是忘了写，是**这一层拿不到区分两者所需的信息**。

**共用的部分仍然一致**：四步的切分、五种叶子形状、三处扭转、IN 子查询而不是 JOIN、
uid 游标、Knex 的四处补偿、对外只给字符串。这些是 4.3 的骨架，也是上台要讲的主线。

````callout
tone: amber
icon: 🔩
text: |
  `object_id` 那一行值得单独说一句，因为它是**唯一一行会直接变成硬约束的差异**。

  方案的设计是：对象列名由 Metadata 的 `column_name` 给，所以每个关系可以不一样
  （持仓叫 `symbol`、产品叫 `product_code` 都行）。
  实现把 `object_id` 写死在 `compile.ts:356`：

  ```ts
  query.whereIn(`${rel.table}.object_id`, values)
  ```

  ==后果：所有关系表的对象列都必须叫 `object_id`==，否则生成的 SQL 找不到列。
  demo 里两张关系表也都遵守了（`rel_holding.object_id` / `rel_product.object_id`）。
````

```callout
tone: violet
icon: 🧭
text: |
  `age >= 18` 那一行是最好用的一个例子：==同一份 DSL，方案和实现编出来的 WHERE 完全不一样，
  但结果相同==。这正好说明 4.3 的承诺是什么 —— DSL 与物理模型解耦，
  换一条编译路径不影响上层协议。
```

---

```quiz
- q: 为什么校验要分成两段，而不是一次查完？
  a: |
    因为两段依赖的东西不同。形状校验只需要 DSL 本身，不依赖字段字典，
    所以圈选组件能在发请求之前先在浏览器里跑一遍，用户填错结构当场提示，不用等一次网络往返。
    语义校验必须拿到 Catalog，只能在服务端做。
- q: 「不持有腾讯」为什么不能编成 `object_id NOT IN ('腾讯')`？
  a: |
    因为那是行级否定。「不持有腾讯」的语义是「不存在这个人与腾讯的关系记录」，是集合级否定。
    同时持有腾讯和阿里的人，用 `NOT IN` 判断时还有一行阿里，于是被错误地留下。
    所以编译成 `NOT EXISTS ( ... object_id IN ('腾讯') )`。
- q: 为什么关系条件用 IN 子查询，countSql 里却还要包一层 `SELECT COUNT(*) FROM ( ... ) AS t`？
  a: |
    两者解决的不是同一件事。IN 子查询是为了「不产生重复行」——
    LEFT JOIN 会让一个人持 5 个标的变成 5 行，`COUNT(*)` 就把 1 个数成 5。
    包一层是为了「数人不数行」，保证外层数到的和 uidsSql 的行数一致。
    注意包一层本身不去重，去重靠的是语句形状。
```
