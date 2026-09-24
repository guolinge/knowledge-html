> 六个 JOIN 的区别，可以压缩成一句话：==配对之后，落单的那一行，留还是不留。==

## 01 · 先把两张表摆出来

电商系统不会把用户和订单塞进一张表。拆开之后，**把两边的信息拼回同一行**就成了每天都要做的事。

`users` —— 用户表

| id | name |
|---:|---|
| 1 | 小明 |
| 2 | 小红 |
| 3 | 小刚 |

`orders` —— 订单表

| id | user_id | product |
|---:|---:|---|
| 101 | 1 | 键盘 |
| 102 | 1 | 鼠标 |
| 103 | 2 | 显示器 |
| 104 | 99 | 测试商品 |

配对规则只有一条，写在 `ON` 后面：

```sql
ON users.id = orders.user_id
```

拿 `orders.user_id` 去 `users.id` 里找人。==能配上的只有 3 对==：

```text
小明(1) ── 101 键盘
小明(1) ── 102 鼠标
小红(2) ── 103 显示器
```

剩下两行谁也配不上，而它们正是全篇的主角：

- **小刚(3)** —— 没下过单，左表落单
- **订单 104** —— `user_id = 99` 查无此人，右表落单

```callout
tone: blue
icon: 🎯
tinted: true
text: |
  后面所有 JOIN 的差别，**全都体现在这两行上**。
  能配上的那 3 对，六种 JOIN 的处理完全一样。
```

## 02 · JOIN 只做三件事

不管写哪种 JOIN，数据库干的都是同一套动作：

```lane-stack
- badge: STEP 01
  title: 配对
  desc: 拿 ON 的条件去比对
  tone: muted
  nodes:
    - { title: 逐行比对, sub: "users.id = orders.user_id", tag: ON }
  next: "配不上的行怎么办 :: :: 分歧从这里开始"

- badge: STEP 02
  title: 留谁
  desc: 由 JOIN 关键字决定
  tone: blue
  nodes:
    - { title: INNER, sub: "两边都要有", tag: 都丢 }
    - { title: LEFT, sub: "左表全留", tag: 保左, tone: green }
    - { title: RIGHT, sub: "右表全留", tag: 保右, tone: violet }
    - { title: FULL, sub: "两边全留", tag: 都留, tone: amber }
  next: "留下来的行拼成一行 :: :: 缺的那一侧补 NULL"

- badge: STEP 03
  title: 拼行
  desc: SELECT 取哪些字段
  tone: green
  nodes:
    - { title: 缺的一侧填 NULL, sub: "o.product → NULL", tag: 补空 }
```

==第 1 步和第 3 步，六种 JOIN 完全相同。== 你真正在选的只有第 2 步：配不上的行，丢还是留。

```callout
tone: amber
icon: 🔑
text: |
  所以遇到一个没见过的 JOIN 名字，只问一句：**「配不上的行留不留？」**
  答案出来，行为就定了，不用背。
```

## 03 · 亲手切一遍：同一份数据，五种 JOIN

下面就是上面那两张表。点按钮换 JOIN 类型，盯着两个地方看：**左边哪些行变灰，右边结果表多了或少了一行。**

```demo
widget: join-lab
title: 同一份数据，切五种 JOIN
hint: 点上面的按钮切换
actions: false
html: |-
  <div class="jl" data-jl>
    <div class="jl-top">
      <div class="seg" data-jl-modes></div>
    </div>
    <p class="seg-rule tone-blue" data-jl-rule></p>
    <div class="jl-cols">
      <div>
        <div class="jl-out-head">① 配对 · ON users.id = orders.user_id</div>
        <div class="jl-stage" data-jl-stage>
          <svg class="jl-lines" data-jl-lines aria-hidden="true"></svg>
          <div class="jl-col" data-jl-col="users"></div>
          <div class="jl-gap"></div>
          <div class="jl-col" data-jl-col="orders"></div>
        </div>
      </div>
      <div class="jl-out">
        <div class="jl-out-head" data-jl-outhead>② 结果表</div>
        <div data-jl-table></div>
      </div>
    </div>
    <pre class="seg-sql" data-jl-sql></pre>
  </div>
```

!!整张页面里真正在动的只有两条记录：小刚（左表落单）和订单 104（右表落单）。!!

### 谁是「左表」？看 SQL 里的书写位置

`LEFT JOIN` 保的是**写在 `FROM` 后面那张表**：

```sql
FROM users            -- 左表：它的行全部保留
LEFT JOIN orders      -- 右表：配不上就补 NULL
  ON users.id = orders.user_id
```

!!不是看表名，不是看关联字段，只看它写在 `JOIN` 关键字的哪一边。!!

换个写法就换了主角 —— 下面两句等价，但一句保用户、一句保订单：

```sql
FROM users  RIGHT JOIN orders ON users.id = orders.user_id;
FROM orders LEFT  JOIN users  ON orders.user_id = users.id;
```

## 04 · 交互之外的三个坑

### LEFT JOIN 的招牌用法：找「从来没有过」的行

「哪些用户从没下过单？」答案不在订单表里，在 ==LEFT JOIN 补出来的那个 NULL 里==：

```sql
SELECT users.id, users.name
FROM users
LEFT JOIN orders ON users.id = orders.user_id
WHERE orders.id IS NULL;
```

结果只有小刚一行。注意 `WHERE` 里判的是 `orders.id IS NULL` —— 意思是「这次 JOIN 没给它配上任何订单」。

### RIGHT JOIN 为什么基本没人写

因为它总能翻个面写成 `LEFT JOIN`。而同一个团队里两种方向混着用，读代码的人每次都要重新确认「保的到底是哪边」。

### FULL OUTER JOIN 在 MySQL 里得自己拼

MySQL 直接报语法错误。==用 LEFT JOIN 和 RIGHT JOIN 的结果做 UNION==：

```sql
SELECT users.name, orders.product
FROM users LEFT JOIN orders ON users.id = orders.user_id

UNION

SELECT users.name, orders.product
FROM users RIGHT JOIN orders ON users.id = orders.user_id;
```

PostgreSQL / SQL Server / Oracle 一般直接支持 `FULL OUTER JOIN`，不用这么绕。

```callout
tone: green
icon: ✅
text: |
  这里必须用 `UNION` 而不是 `UNION ALL` —— 能配上的 3 行在两半里都会出现，
  `UNION` 会去重，`UNION ALL` 会让它们重复一遍。
```

## 05 · 两个特例：CROSS JOIN 和 SELF JOIN

### CROSS JOIN：不是关联，是乘法

`CROSS JOIN` 没有 `ON`，==它把「配对」这件事直接取消了== —— 左表每一行和右表每一行各组合一次：

```text
3 个用户  ×  4 个订单  =  12 行
```

在上面的交互里点一下 `CROSS JOIN`，连线会炸成一张网。那不是「关联变多了」，而是**根本不再判断谁配得上谁**。

!!两张大表一交叉就是灾难：10 万 × 10 万 = 100 亿行。!!

它真正有用的场景是**造组合骨架**：日期 × 商品 × 地区先铺满，再把实际数据挂上去。

### SELF JOIN：不是关键字，是同一张表看两次

`SELF JOIN` 不是 SQL 关键字，而是「一张表和它自己 JOIN」这个套路。

员工表里，`manager_id` 指向的也是员工表的 `id`：

| id | name | manager_id |
|---:|---|---:|
| 1 | 张总 | `NULL` |
| 2 | 小李 | 1 |
| 3 | 小王 | 1 |
| 4 | 小赵 | 2 |

查「员工 + 他的直属领导」，要让同一张表 ==当成两个角色各出现一次==：

```sql
SELECT e.name AS employee_name, m.name AS manager_name
FROM employees AS e
LEFT JOIN employees AS m
  ON e.manager_id = m.id;
```

| employee_name | manager_name |
|---|---|
| 张总 | `NULL` |
| 小李 | 张总 |
| 小王 | 张总 |
| 小赵 | 小李 |

- `e` 是**员工视角**：拿自己的 `manager_id` 去找人
- `m` 是**领导视角**：拿自己的 `id` 去被找

!!不加别名，`employees` 出现两次时数据库不知道你在说哪一个。!!

张总没有领导，所以这里用 `LEFT JOIN` 而不是 `INNER JOIN` —— 用 `INNER JOIN` 张总会从结果里消失。

分类树、评论回复、组织架构，都是同一个套路。

## 06 · 最容易踩的坑：条件写在 ON 还是 WHERE

需求：**列出所有用户，以及他们已支付的订单。**

同一个 `o.status = 'PAID'`，写在 `ON` 里和写在 `WHERE` 里，结果不一样。切一下看：

```demo
widget: on-vs-where
title: 过滤条件写在 ON 还是 WHERE
hint: 点按钮切换
actions: false
html: |-
  <div class="ow" data-ow>
    <div class="ow-top">
      <div class="seg" data-ow-modes></div>
    </div>
    <p class="seg-rule tone-green" data-ow-rule></p>
    <div data-ow-matrix></div>
    <pre class="seg-sql" data-ow-sql></pre>
  </div>
```

原因只有一句话：

- `ON` 决定**两张表怎么配对** —— 条件不满足只是「配不上」，`LEFT JOIN` 照样保留左表的行
- `WHERE` 在**JOIN 完成之后**才执行 —— 补出来的 `NULL` 不满足 `= 'PAID'`，整行被删掉

所以 `WHERE o.status = 'PAID'` 等于 ==悄悄把 `LEFT JOIN` 退化成了 `INNER JOIN`==。

```callout
tone: amber
icon: 🕳️
tinted: true
text: |
  判断标准很简单：这个条件是在**挑配对对象**，还是在**挑结果行**？
  挑配对对象 → 写 `ON`；挑结果行 → 写 `WHERE`。
  过滤主表自己的字段时两者都行（主表字段永远不会是 NULL），过滤关联表字段时只有 `ON` 安全。
```

```checklist
tone: warn
items:
  - 写了 LEFT JOIN，又在对关联表的字段加条件 —— 先问一句「这会不会把没关联上的行也筛掉」
  - 用 LEFT JOIN + WHERE 关联表字段 来「过滤」，实际得到的是 INNER JOIN 的结果
  - 需要保留主表全部数据时，把关联表条件挪进 ON
```

## 07 · 速查表

```compare
first: JOIN 类型
head: [保留什么, 上面的数据会得到几行, 常见用途]
rows:
  - INNER JOIN:
      - 只保留两边都配得上的行
      - { text: 3 行, tone: blue }
      - 查「有订单的用户」
  - LEFT JOIN:
      - 左表全留，右表配不上补 NULL
      - { text: 4 行, tone: green }
      - 查全部用户及其订单；找没有订单的用户
  - RIGHT JOIN:
      - 右表全留，左表配不上补 NULL
      - { text: 4 行, tone: violet }
      - 少见，通常翻面改写成 LEFT JOIN
  - FULL OUTER JOIN:
      - 两边都全留；MySQL 需用 UNION 拼
      - { text: 5 行, tone: amber }
      - 对账、找两边对不上的数据
  - CROSS JOIN:
      - 不做配对，左表每行 × 右表每行
      - { text: 12 行, tone: red }
      - 生成「日期 × 商品 × 地区」这类组合骨架
  - SELF JOIN:
      - 同一张表当成两个角色各出现一次
      - 看数据
      - 员工—领导、分类树、评论回复
```

```summary
title: 一句话总结
text: |
  `JOIN` 永远是「先配对、再决定留谁、最后缺的补 NULL」三步，
  六种 JOIN 只在第二步不同：==配不上的行，丢还是留==。
  而 `ON` 是配对规则、`WHERE` 是结果过滤 —— 这一条比记住六个名字重要得多。
```

## 自测

```quiz
- q: 「LEFT JOIN 和 RIGHT JOIN 的区别」能不能不看 SQL 就回答？
  a: |
    不能。==左和右指的是 SQL 里 `JOIN` 关键字两边的书写位置==，不是表名，也不是关联字段。
    所以 `FROM users RIGHT JOIN orders` 和 `FROM orders LEFT JOIN users` 是同一个结果。
- q: 为什么 `LEFT JOIN ... WHERE o.status = 'PAID'` 会丢掉从没下单的用户？
  a: |
    因为 `WHERE` 在 JOIN 完成之后才执行。没下单的用户在 `o.status` 上是 `NULL`，
    `NULL = 'PAID'` 不成立，整行被过滤掉 —— 效果上退化成 `INNER JOIN`。
    要让这些用户留下，条件得写进 `ON`。
- q: MySQL 里怎么做出 FULL OUTER JOIN 的效果？为什么用 UNION 而不是 UNION ALL？
  a: |
    把 `LEFT JOIN` 和 `RIGHT JOIN` 的结果 `UNION` 起来。
    能配上的行在两半里都会出现，`UNION` 会去重，`UNION ALL` 会让它们重复一遍。
- q: 什么情况下 CROSS JOIN 才是有用的？
  a: |
    需要「全组合骨架」的时候，比如日期 × 商品 × 地区先铺满，再把实际销量挂上去。
    它不是关联查询，是笛卡尔积；两张大表交叉会直接把结果集炸掉。
```
