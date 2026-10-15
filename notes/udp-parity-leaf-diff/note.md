上一篇把现网条件翻成了我们的草稿。这一篇做第一次真正的对拍：**拿现网的 SQL 当标准答案，逐字比我们编译出来的谓词。**

先看这一篇要用的原料 —— 一条现网记录 `crowdFilter 1241598` 的两侧：

````callout
tone: blue
icon: 📦
text: |
  **现网那一行给的东西：**

  ```json
  {"op":"=","name":"futu_hk_account_basic_customer_type","value":"Organization"}
  ```
  ```sql
  select count(1) as `count` from `user_portrait`
   where (`futu_hk_account_basic_customer_type` = 'Organization')
  ```

  **我们编译器对同一条条件写出来的（同一个字段、同一个值）：**

  ```sql
  SELECT `u`.`uid` AS `uid` FROM `user_portrait` AS `u`
   WHERE ((`u`.`futu_hk_account_basic_customer_type` = 'Organization'))
  ```

  ==两边的差异只有三处：表限定名（`u.`）、两边的括号层数、以及外面套没套 `count(1)` 的壳。== 这张单子就是这一篇要处理的东西。
````

## 01 · 比什么：把三处差异抹掉，只留谓词

```compare
first: 差异
head: [现网的写法, 我们的写法, 归一化怎么做]
rows:
  - 表限定名: ["`futu_hk_account_basic_customer_type`", "`u`.`futu_hk_account_basic_customer_type`", "把我们列上的 `u.` / `user_portrait_wide.` 去掉"]
  - 括号层数: ["`where (谓词)`", "`where ((谓词))` —— 因为要跟权限谓词、其他条件拼", "两侧都脱掉最外层多余的括号"]
  - 壳: ["`select count(1) … from 表 where …`", "`select uid … from 表 where …`", "只抽 WHERE 后面那段，壳不管"]
  - 值引号: ["`'0'`（一律字符串字面量）", "`0`（按字段类型出）", "数字型的引号去掉"]
  - UDF: ["`UNIX_TIMESTAMP(DS_DATETIME_ADD('day',-3,NOW()))`", "编译期算好的常量 `1789…`", "按同一个业务时刻算成秒数替换"]
  - 大小写: ["`not in`", "`NOT IN`", "只统一关键词，不碰字符串值"]
```

要抹的就这六条。**抹平之后剩下的那一段，就是「字段 + 操作符 + 值」这一层的编译能力** —— 它错了后面全错，所以先验它。

```callout
tone: red
icon: 🩸
text: |
  **归一化的红线：只改「已登记为表象差异」的东西。**

  上面六条每一条都能指回一份差异文档。而语义层面的改写（把现网的 `not in` 改写成 `not exists`）
  一律不做 —— ==那等于替编译器作判断，「一致」就变得毫无意义。==
```

## 02 · 只比「单叶子 + 画像」：另外两种比法都注定失败

```cards
cols: 3
items:
  - title: 单叶子 · 画像
    tag: 能逐字比
    tone: green
    desc: 两边都是「这一列怎么比」，只差写法。归一化后应当完全相同 —— 这一篇比的就是它。
  - title: 单叶子 · 关系
    tag: 不能比文本
    tone: red
    desc: 现网写成 `uid not in (select uid from 关系表 where …)`，我们写成主表上的 `NOT EXISTS` 子查询 —— 形状不同、语义可以等价。留给第三篇比结果。
  - title: 多叶子（AND / OR）
    tag: 不能比文本
    tone: red
    desc: 现网用 `union all` + `having count = N` 表达 AND/OR，我们是单条 WHERE。没有一一对应。也留给第三篇。
```

还有第三种失败来源：**这条记录里有我不想翻、翻不了的叶子**。真实例子（现网 `tag 846335`）：

```sql
-- 现网这条记录的 SQL 里，除了特征条件，还混着一个「离线用户群」条件
select uid from user_portrait where (特征条件)
union all select uid from user_portrait where uid in (
  select uid from crowds where (crowd_id = '29178d-20260630095237-crowd' …))
--                                 ↑ 这个条件我们没翻，比出来的差异全是它造成的，必须整条排除
```

所以本步的取值条件是**三个同时成立**：翻译后正好一个叶子、该叶子是画像、这条记录里没有翻不了的叶子。

## 03 · 收敛流程：6500 条怎么变成 405 条

```lane-stack
- title: 取数
  tone: muted
  items:
    - "语料 6500 条"
    - "翻译器先翻一遍：拿到草稿 + notes"
  note: 翻不出条件树的直接丢
- title: 筛叶子
  tone: blue
  items:
    - "只剩一个叶子 · 且是 portrait"
    - "这条记录没有「翻不了的叶子」"
    - "没有 include / exclude 侧树（那是另外两棵树）"
  note: 6500 → 794 → 586
- title: 造形状
  tone: violet
  items:
    - "形状优先取我们真实元数据（18 个字段里有就用真的）"
    - "取不到就按叶子自身的 op / value 推断"
    - "推断不出来时依次换候选，试到能编译为止"
  note: 形状只决定「操作符允许不允许」，不影响谓词文本
- title: 取两侧谓词
  tone: green
  items:
    - "我们：compile() → countSql → 抽 WHERE 片段"
    - "现网：记录里的 countSql → 抽 WHERE → 去掉外层包装"
  note: 关系与多叶子要改用 listSql，那类已在上面被排除
- title: 归一化 + 比
  tone: amber
  items:
    - "六条归一化（上节）"
    - "逐字比对，不一致的留样本"
  note: 405 条比完，405 条一致
```

## 04 · 一次真实的比对过程（含三轮修正）

```journey
- tag: 第一轮
  tone: red
  name: 一致率 27%
  badge: 133 条假差异
  code: |
    我们: niuniu_number_tail = 2
    现网: uid in (select uid from user_portrait where (niuniu_number_tail = 2))
  note: 现网对那些嵌在分组里的条件会**多包一层 `uid in (select …)`**，而且标识符带反引号 —— 我的去壳正则没考虑反引号，于是拿「谓词」去比「整个包装」。
  noteTone: bad
  next: "先去反引号再递归去壳 → 54%"

- tag: 第二轮
  tone: amber
  name: 一致率 54% → 95.8%
  badge: 关键词大小写
  code: |
    我们: niuniu_config_switch_email_type NOT IN (1)
    现网: niuniu_config_switch_email_type not in (1)
  note: 纯写法差异。归一化时只把**关键词**统一大写，不碰字符串值（否则会把 'CN' 与 'cn' 判成同一个）。
  noteTone: warn
  next: "统一关键词大小写"

- tag: 第三轮
  tone: green
  name: 405 / 405
  badge: 最后 1 条
  code: |
    我们: col = CAST(1000.5 AS DECIMAL(38,10))
    现网: col = 1000.5
  note: 我们给 double 套 CAST 是刻意的（避免浮点误差），属于「字面量风格」→ 归一化时抹平。
  noteTone: ok
  next: "100%"
```

## 05 · 四类「假差异」必须显式排除

比到后面会发现：不一致的那些大多不是编译器的错，而是**记录里还有别的条件**，或者**两边口径本来就不同**。四类都要排除 **并计数**：

```compare
first: 假差异来源
head: [为什么会出现, 处理]
rows:
  - 有翻不了的叶子: ["tag / crowd / event / rawSql 叶子我们不翻，但现网 SQL 里带着它们", "整条跳过，计数 3572 条"]
  - 带 include / exclude 侧树: ["那是另外两棵树，翻译器只翻 main", "整条跳过，计数 154 条"]
  - tag 模块的相对时间: ["现网 Tag 模块按「实时、可含当天」算，我们实现的是 Crowd 分支（自然日、默认不含当天）", "tag 记录里的相对时间不参与文本对比"]
  - 日期列（YYYYMMDD）: ["现网日期列存 `20261015` 这样的整数，我们的时间戳是秒级；而且我们 Catalog 里根本没有日期类字段", "排除并记入待办（等上日期字段时单独验）"]
```

## 06 · 输入输出与数字

```compare
first: 环节
head: [输入, 输出]
rows:
  - "比对": ["语料 + 真实 Catalog 的形状 + 翻译器", "逐条结论：一致 / 不一致（附两侧谓词片段）"]
  - "统计": [同上, "实际比对 405 条 · 一致 405（100%）"]
  - "跳过明细": [同上, "日期列 178 · 带侧树 154 · tag 相对时间 6"]
```

```summary
title: 第 ② 步的结论
text: |
  - **405 条可比样本，谓词逐字一致 100%** —— 「字段 + 操作符 + 值 + 时间窗口」这一层的编译没问题
  - 一致率从 **27% 提到 100%**，靠的是修 3 个工具 bug + 6 条归一化 + 4 类假差异排除
  - 排除掉的四类都**记了数与原因**，不是默默丢掉
  - 这一层验不了 OR / 否定 / 计数：它们结构不同，只能靠第三篇比 uid 集合
```

**这一篇的边界**（别把它当全绿）：一致只发生在「单叶子 + 画像 + 无跳过叶子」这个交集里；关系与多叶子一条都没验。

## 07 · 自测

```quiz
- q: 归一化的边界在哪？举一个「绝不能抹」的例子。
  a: |
    只抹平**已登记为表象差异**的东西：表限定名、括号层数、值引号、UDF 求值时机、关键词大小写、外层包装。
    绝不能做的例子：把现网的 `uid not in (select uid …)` 改写成我们的 `NOT EXISTS` ——
    那是在替编译器作判断，改完之后「一致」就不再证明任何东西了。
- q: 一条记录里如果有我们翻不了的叶子，为什么必须整条排除？
  a: |
    因为现网编译那条记录时，把那个叶子也编译进了 SQL（例如 `uid in (select uid from crowds …)`）。
    我们这边没有它，于是两侧比的不是同一件事 —— 差异全来自那个没翻的条件，
    留下来只会污染结论。真实的例子是 tag 846335，它的 SQL 里混着一个离线用户群条件。
- q: 一致率从 27% 到 100% 的三次修正，分别修的是什么？
  a: |
    ① 去壳正则没考虑反引号 → 拿「谓词」比了「整个 `uid in (select …)` 包装」（27% → 54%）；
    ② 关键词大小写不一致（`not in` vs `NOT IN`）→ 归一化时统一关键词、不碰字符串值（→ 95.8%）；
    ③ 给 double 套的 `CAST(… AS DECIMAL)` 与现网裸字面量的差异（→ 100%）。
    三次都不是编译器的问题，而是我的比对工具写错了。
```
