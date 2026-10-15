**这一篇要解决的事**：手上有一份现网的「条件 JSON → SQL」记录（124 万行），想拿它当标准答案来验我自己的编译器。可是两边协议不是一套，得先写翻译器把现网条件翻成我的草稿。

在讲怎么做之前，先把**原料**摊开 —— 后面每一节都会回到同一份记录上。下面这条来自现网记录 `crowdFilter 1241598`，就是最小的一个例子：**一个字段、一个等于、翻出一条 SQL。**

````callout
tone: blue
icon: 📦
text: |
  **现网记录里那一行，长这样（原文，只截了关键部分）：**

  ```json
  {"main":{"logic":"AND","conditions":[
    {"logic":"OR","conditions":[
      {"type":"portrait",
       "condition":{"op":"=","name":"futu_hk_account_basic_customer_type","value":"Organization"}}
    ]}]},"include":[],"exclude":[]}
  ```

  ```sql
  select count(1) as `count` from `user_portrait`
   where (`futu_hk_account_basic_customer_type` = 'Organization')
  ```

  ==左边是用户在界面上配的东西，右边是平台把它编译出来的 SQL。== 我的任务是：让**我的**编译器对同一份左边，写出**同样语义**的右边。
````

## 01 · 先把四个词说清楚（都从上面那份记录里认）

```cards
cols: 2
items:
  - title: 叶子（leaf）
    tag: 就是「一个字段 + 怎么比 + 比什么」
    tone: violet
    body: |
      上面 JSON 里那个 `{"type":"portrait","condition":{…}}` 就是一片**叶子**。

      一个条件里可以有多片叶子，用 `{"logic":"AND","conditions":[…]}` 这样的**树枝**串起来。
      叶子是「叶子」，因为它下面没有别的东西了 —— 它就是一个具体的判断。

      真实的多叶子例子（现网 `tag 1235865`，两片叶子用 AND 串）：

      ```json
      {"conditions":[
        {"condition":{"items":[{"name":"alex_ftest_character_1778315960","op":"<=","value":99,
                                "dateType":"relative","dateUnit":"day"}]},"type":"portrait"},
        {"condition":{"items":[{"relationName":"alex_ftest_relation_1778490595","op":"NOT IN",
                                "value":["k1"],"formulaType":1}]},"type":"relation"}]}
      ```
  - title: 谓词（predicate）
    tag: SQL 里 WHERE 后面的那个判断
    tone: green
    body: |
      「谓词」不是新东西，就是 SQL 里 `WHERE` 后面**一个具体的判断**：

      ```sql
      WHERE `futu_hk_account_basic_customer_type` = 'Organization'
            └────────────── 这一整段就是一个谓词 ──────────────┘
      ```

      「**把条件编译成谓词**」= 把界面上那句「客户类型 = 机构」，落成上面这串列名+比较符+值。

      对照之下，现网在**别的地方**是「**编译成一个 uid 集合**」—— 不是一段判断，而是一条自己去查人的子查询：

      ```sql
      -- 现网对关系条件的写法（一条完整子查询，结果是一批 uid）
      select uid from niuniu_user_security_special_watchlist
       where object_id in ('75900664355662') group by uid
      ```

      ==这两种写法的区别，就是后面所有「比不了」的根源。==
  - title: 单叶子（single leaf）
    tag: 我这一步只比这个
    tone: blue
    body: |
      一条记录里**只有一片叶子**，没有 AND / OR 树枝。

      为什么只比它：多叶子时现网会用 `union all` + `having count = N` 表达 AND / OR，
      而我写的是单条 WHERE 里的 `(... OR ...)` —— 形状不同，逐字比永远不相等。

      真实对照（同一份 OR 条件，现网 case `1191481`）：

      ```sql
      -- 现网：两个叶子 → union all + group by
      select uid from (select uid from 关系表A where … group by uid
                       union all
                       select uid from 关系表B where … group by uid) ct1 group by uid

      -- 我们：同一条 WHERE 里写 OR
      WHERE (uid IN (SELECT …关系表A…) OR uid IN (SELECT …关系表B…))
      ```

      语义相同、文本不同 —— 这类只能靠**跑数比结果**（第三篇），不能比文本。
  - title: 无跳过叶子
    tag: 这条记录我们全翻得出来
    tone: amber
    body: |
      现网的叶子有六类：特征 / 关系 / 实时用户群 / 离线用户群 / 事件 / 原始 SQL。
      **我只支持前三类**（特征、关系、UID），其余会被「跳过」。

      「无跳过叶子」= 这条记录里的所有叶子我都翻出来了。
      如果有一条被跳过，那条记录的对账就没有意义 —— 因为现网的 SQL 里还带着我没翻的那个条件：

      ```sql
      -- 现网 tag 846335 的 SQL：除了特征，还混着一个「离线用户群」条件
      select uid from user_portrait where (特征条件)
      union all select uid from user_portrait where uid in (
        select uid from crowds where (crowd_id = '29178d-20260630095237-crowd' …))
      --                                 └── 这个条件我没翻，比出来的差异全是它造成的 ──┘
      ```
```

## 02 · 四步全景

```arch
svg: udp-parity-harness
caption: ==四步是「先量 → 再判 → 最后跑」三件事==。上面一行是 ①② 只碰协议文本，下面一行是 ④③ 要真的建表跑数。点零件看它的输入输出与数字。
frames:
  - id: corpus
    boundary: 0
    kind: classification
    flat: true
    label: 现网记录 · 只读，不能改也不能重跑
    detail: 唯一的标准答案来源。124 万行里每行是「用户配的条件 JSON」+「平台编译出的 SQL」。只能读 —— 这是整个 harness 的前提。
  - id: proto
    boundary: 1
    kind: contains
    flat: true
    label: ① 翻译 + ② 文本对拍 · 不跑数就能出结论
    detail: 只碰协议文本：把现网条件翻成我们的草稿，再把两侧 SQL 的谓词片段归一化后逐字比。快、便宜，先在这里把「写法错」清掉。
  - id: mirror
    boundary: 2
    kind: contains
    label: ④ 镜像词表到本地 · 让语料的字段真的能跑起来
    detail: 语料里的字段九成以上不在我们元数据里。这一步把它们的词表（字段名/关系名/类型/取值）镜像到本地建表灌数，是 ③ 能跑起来的前置。
  - id: result
    boundary: 3
    kind: contains
    label: ③ 结果级对拍 · 同一份数据上比 uid 集合
    detail: 只有跑数才能验 OR / 否定 / 计数这些「写法不同但语义可能相同」的地方。两侧 SQL 拔掉 UDF 后在同一个 Doris 上跑，比 uid 集合。
bodies:
  corpus:
    badge: 1,242,215 行
    rows:
      - { k: 表, v: sql_gen_record }
      - { k: 我抽样, v: 6500 条（4 个类别） }
      - { k: 每行给, v: input 条件 JSON + output SQL }
    code: "crowdFilter 1944 / tag 2000 / crowd 2000 / segment 500"
    note: 四个类别：圈选页预览 22.9 万 · 标签计算 6 万 · 人群产出 2.1 万 · 分群 746
  translate:
    badge: 第 ① 步
    rows:
      - { k: 输入, v: 上面那种条件 JSON }
      - { k: 输出, v: 我们的 DraftQuery 草稿 }
      - { k: 翻得出, v: 3415 / 6500（52.5%） }
    code: "new Translator().translateQuery(input)"
    note: 翻完立刻用 buildQuery() 过一遍，100% 通过才算映射写对
  report:
    badge: 先量再对
    rows:
      - { k: 翻译率, v: crowdFilter 73.6% · crowd 67.8% · tag 31.5% }
      - { k: 叶子分布, v: portrait 3806 · uid 1061 · 关系明细 914 }
      - { k: 跳过原因, v: 不支持叶子 6857 · 老形状 1527 }
    note: 没有这张报告，后面「405 条可比」就没有出处
  leafdiff:
    badge: 405 / 405
    rows:
      - { k: 从 6500 收敛到, v: 405 条真的能逐字比的 }
      - { k: 判据, v: 单叶子 + 画像 + 无跳过叶子 }
      - { k: 结论, v: 谓词级逐字一致 }
    note: 四类「假差异」被显式排除并计数，见第二篇
  vocab:
    badge: 98 字段 · 28 关系
    rows:
      - { k: 抽什么, v: 语料里出现过的字段/关系/取值 }
      - { k: 为什么, v: 建表用它的形状、灌数用它的取值 }
      - { k: 产物, v: 词表 JSON + 合成 Catalog }
    code: "node build-parity-vocab.mjs --input corpus.sample.json"
    note: 取值必须抄现网真出现过的，否则条件命中不到行
  mirror:
    badge: 10k × 92 列
    rows:
      - { k: 建表, v: user_portrait + 28 张关系表 }
      - { k: 灌数, v: 10,000 个 uid · 92 列宽表 }
      - { k: 关系行, v: 194,547 行 }
    note: 表名跟现网一样（user_portrait），现网 SQL 不改表名就能跑
  seed10w:
    badge: 先跑通流程
    rows:
      - { k: 做法, v: 从真实 Catalog 生成 DDL 再灌数 }
      - { k: 规模, v: 10 万用户 · 86.5 万关系行 }
      - { k: 数据权限, v: 3 组 4 个客户经理 }
    note: 验我们自己的 18 个字段；也是 ③ 的第一批靶子
  cases:
    badge: 1417 对
    rows:
      - { k: 输入, v: 翻译后的草稿 + Catalog }
      - { k: 输出, v: 一对可跑的 SQL（写盘） }
      - { k: 我们侧, v: compile() 的 uidsSql }
    code: "ourSql / udpSql 两个字段"
    note: 两侧都要先拔 UDF、对齐时间基准，否则没法在一个库上跑
  runner:
    badge: 1209 一致
    rows:
      - { k: 做法, v: 两侧都跑 · 比 uid 集合 }
      - { k: 结果, v: 85.3% 一致 · 191 待分诊 · 17 报错 }
      - { k: 集中区, v: 关系明细 138 · 关系计数 45 }
    note: 17 条报错暴露了一个真问题：array 字段该用 find_in_set
  doris:
    badge: FE 9030
    rows:
      - { k: 库, v: crm_insight }
      - { k: 住着, v: 镜像表 + 真实字段种子 }
      - { k: 为什么本地, v: 想怎么灌就怎么灌 }
    note: 共享测试库只能读，跑对拍会互相干扰
```

图上没有、但一直在场的四个东西（第一篇后面会逐个用到）：

| 在场者 | 它是什么 | 真实长相 |
|---|---|---|
| 协议包 | 我们自己的 `@audience-dsl` 包 —— 定义「条件怎么写、操作符有哪些」 | 翻译器从它取 `Ops` 表 |
| 编译器 | `@audience-sql-builder`：把草稿编译成 SQL | `compile(query, {actor, catalog, today, now})` |
| 真实 Catalog | BFF 的 `GET /api/crowd/catalog`：字段 → 物理表名列名的映射 | `universeTable = crm_portrait_realtime` · 18 特征在 `user_portrait_wide` |
| 本地种子 | 我自己造的 10 万行测试数据（见 07 节） | `user_portrait_wide` 10 万行 + 8 张关系表 |

## 03 · 为什么要翻译，而不是直接比两条 SQL

现网记录里已经有它自己的 SQL，我也有自己的输出。最直觉的做法是抓两条直接 diff —— 但那样**永远不相等**，因为两边把条件变成 SQL 的思路根本不同：

```compare
first: 层面
head: [现网：条件 → uid 集合, 我们：条件 → 谓词]
rows:
  - 一片叶子: ["`select uid from 表 where (条件)` —— 结果是一批人", "`列 比较符 值` —— 结果是一个判断"]
  - AND: ["嵌套 `group by uid having count = N`", "直接 `AND`"]
  - OR: ["`union all` + `having count = N`", "`(… OR …)`"]
  - 否定: ["`uid not in (select uid …)`", "`NOT EXISTS` 相关子查询"]
```

真实的两条 SQL 摆在一起看（同一条 OR 条件，现网 `1191481`）：

```sql
-- 现网：每个条件是「一批人」，于是 OR 就是两批人并起来
select uid from (
  select uid from niuniu_user_security_special_watchlist where object_id in (…) group by uid
  union all
  select uid from futu_hk_user_security_position        where object_id in (…) group by uid
) ct1 group by uid

-- 我们：每个条件是「一个判断」，于是 OR 就是同一段 WHERE 里的 OR
SELECT u.uid FROM user_portrait u WHERE (
  u.uid IN (SELECT uid FROM 关系表A WHERE object_id IN (…))
  OR u.uid IN (SELECT uid FROM 关系表B WHERE object_id IN (…)))
```

==所以「直接 diff」只有两种结局：全红，或者一条条手工认定「等价」—— 后者等于用眼睛当编译器。==

分成两层之后就好办了：

| 层 | 比什么 | 能证明什么 | 在哪篇 |
|---|---|---|---|
| 谓词级 | **单叶子**的 WHERE 片段，归一化后逐字比 | 「字段 + 操作符 + 值」这层编译对不对 | 第二篇 |
| 结果级 | 两侧 SQL 在同一份数据上跑出来的 **uid 集合** | OR / 否定 / 计数 这层语义对不对 | 第三篇 |

两层都要求**先把现网条件翻成我的草稿** —— 因为「我的 SQL」只能从我的草稿编译出来。这就是 ① 存在的理由。

## 04 · 现网条件的三种形状（都是真实记录）

```cards
cols: 1
items:
  - title: 现代形状（主流）
    tag: crowdFilter · crowd
    tone: green
    body: |
      ```json
      {"main":{"logic":"AND","conditions":[
        {"type":"portrait",
         "condition":{"op":"=","name":"futu_hk_account_basic_customer_type","value":"Organization"}}]}}
      ```
      `type` 在外、真正的条件行在 `condition.items` 里。这是我遇到最多的一种。
  - title: 老一版形状
    tag: 1527 处
    tone: amber
    body: |
      ```json
      {"key":"futu_hk_account_status","val":["1"],"cmp":"=","op":"AND",
       "condition":[...],"type":"","filter_type":2}
      ```
      字段名是 `key` / `val` / `cmp`；分组看 `op` + `condition`，叶子看 `cmp` + `val`，`type` 还会写成大写 `Portrait`。
  - title: 文档里的简写
    tag: 很少
    tone: muted
    body: |
      ```json
      {"type":"portrait","condition":{"op":"IN","name":"niuniu_register_platform","value":[0]}}
      ```
      没有 `items` 这一层 —— 文档示例用它，但现网记录里极少见。
```

同一张表里混着三代前端的记录，所以翻译器要先 `detect()` 判方言再走两条路径。

## 05 · 映射：把现网的写法翻成我们的写法

```compare
first: 维度
head: [现网怎么写, 我们怎么写, 依据]
rows:
  - 等值: ["`\"op\":\"=\"`", "`eq`", "文档操作符表"]
  - 多值: ["`\"op\":\"IN\"` / `\"NOT IN\"`", "`in` / `not_in`", "同上"]
  - 相对时间: ["`dateType:'relative'` + `op:'>='` + `dateUnit:'day'`", "`dateType:'relative'` + `op:'gte'` + `dateUnit:'day'`", "它源码里 `>=`/`>` 都归一成「最近 N」"]
  - 含不含当天: ["`latestIncludeToday: 1` 才算含当天", "`includeToday: true` 才是滚动窗口", "源码只看真值"]
  - 计数的客体: ["「次数」没有客体", "times 不带 objects", "源码注释 + 语料 0 条"]
```

一个真实的翻译对照（record `1235865` 的第二片叶子）：

```text
现网： {"relationName":"alex_ftest_relation_1778490595","op":"NOT IN","value":["k1"],"formulaType":1}
            ↓ 翻译
我们： {"type":"relation","relation":"alex_ftest_relation_1778490595",
        "formula":"detail","op":"not_in","objects":["k1"]}
```

翻完立刻用我们自己的 `buildQuery()` 过一遍 —— 这一步是免费的自动化检查：**翻出来的草稿连结构校验都过不了，就说明映射写错了**。第一版有 15 条过不了，全是映射 bug。

## 06 · 五个坑（每个都是真实记录）

```journey
- tag: 坑 ①
  tone: red
  name: 值也是数组
  badge: 1074 处
  code: |
    {"op": "gte", "value": ["1"]}
    {"op": "!=", "value": [1]}
  note: 现网把**比较符**的值也落成数组 —— `gte` 带 `["1"]`。而我们的 DSL 是强类型：`gte` 要标量、`in` 要数组。
  noteTone: bad
  next: "比较符取第一个元素；`=`/`!=` 配多值时翻成 in / not_in"

- tag: 坑 ②
  tone: amber
  name: EXIST 必须带值
  badge: 2 处
  code: |
    {"op": "EXIST", "name": "plan_external_id",
     "value": ["1000450", "1000449", "1000451"]}
  note: 我按「无值操作符」把 value 丢了，结果我们的 exist 要一个数组（主键属性要命中的值）→ 结构校验直接拒。
  noteTone: bad
  next: "只有 eq_default / neq_default 无值；exist / not_exist 要带"

- tag: 坑 ③
  tone: red
  name: 关系叶子用 relationName
  badge: 228 处
  code: |
    {"type":"relation","condition":{"relationName":"…","op":"IN"}}
  note: 我的「挑条件行」函数只认 name，而关系叶子用的是 relationName → 228 条关系条件全被判成「形状不认识」，关系明细叶子从 686 掉到 914 才补回来。
  noteTone: bad
  next: "同时认 name 与 relationName"

- tag: 坑 ④
  tone: violet
  name: 老一版前端
  badge: 1527 处
  code: |
    {"key":"futu_hk_account_status","val":["1"],"cmp":"=","type":"Portrait"}
  note: 不认它就等于把 1527 处语料当不存在 —— 翻译率卡在 42% 上不去。
  noteTone: bad
  next: "加 legacy 路径并在报告里单独标方言"

- tag: 坑 ⑤
  tone: green
  name: 英文与中文混排的 operator
  badge: 收尾
  code: |
    {"op":"EXISTENCE"}  vs  {"op":"EXIST"}
  note: 现网在不同记录里混用 EXIST / EXISTENCE，映射表要两种都认。
  noteTone: ok
  next: "映射表里补齐同义词"
```

修完这五个，翻译率 **42.4% → 52.5%**，`buildQuery` 通过率 **98.9% → 100%**。

## 07 · 两个被追问的概念：本地种子 / 镜像表

```compare
first: 概念
head: [它是什么, 怎么造出来的, 多少量]
rows:
  - "本地种子（seed-realtime）": ["我按**真实 Catalog** 建表灌的一批测试数据 —— 用我们自己那 18 个特征和 8 条关系", "① 从 Catalog 生成 DDL（14 个特征列 + 8 张关系表）→ ② 按字段形状生成值 → ③ 批量 INSERT", "10 万用户 · 86.5 万关系行 · 7 分钟"]
  - "镜像表（seed-parity）": ["我按**现网语料的词表**建的另一批 —— 语料里出现过什么字段，就建什么列、灌什么值", "① 从语料抽词表（98 字段 / 28 关系 / 真实取值）→ ② 生成合成 Catalog → ③ 建表灌数", "10,000 uid × 92 列 · 28 张关系表 · 19.4 万行"]
```

两张表的差别就是「按谁的词表」：

| | 本地种子 | 镜像表 |
|---|---|---|
| 词表来源 | 我们真实的 Catalog（18 字段） | 现网语料里出现过的字段（98 个） |
| 表名 | `crm_portrait_realtime` + `user_portrait_wide` | `user_portrait`（跟现网同名） |
| 用来干什么 | 验**我们自己的字段**（第一期上线的那些） | 验**编译器语义**（关系 / OR / 否定 / 计数） |
| 一句话 | 「我们的数据长这样」 | 「现网的条件能在本地跑起来」 |

**值是怎么造的**（三条规则，都是为了让边界被测到）：

```text
时间戳列：0（从未发生，20%）· NULL（10%）· 最近 30 天（30%）· 30~365 天（25%）· 一年以上（15%）
数值列：  0（兜底，15%）· NULL（10%）· 小值 · 大值 · 边界值
枚举列：  从真实值集合里取（如 day_count 的 1/7/30/90/180/365/当季/历史至今）
镜像表额外：**必须包含语料里真实出现过的取值**（否则条件命中不到行）
```

## 08 · 输入输出与命令

```compare
first: 环节
head: [输入, 输出]
rows:
  - "取语料": ["现网 MySQL 的 sql_gen_record", "corpus.sample.json（6500 条）"]
  - "翻译": ["语料 + @audience-dsl", "每条记录的草稿 + notes（跳过/降级原因）"]
  - "报告": [同上, "翻译率 / 叶子分布 / 跳过原因 / buildQuery 失败原因"]
  - "看样本": ["某个失败原因", "该原因下的原始条件 JSON 片段"]
```

```bash
node dump-corpus.mjs 2000                                                  # 抽语料（在数据侧那个仓）
node scripts/udp-parity/translate-report.mjs --input corpus.sample.json     # 覆盖率报告
node scripts/udp-parity/translate-samples.mjs --input corpus.sample.json --reason relation-malformed
```

`Translator` 是纯函数式的类：`translateQuery(input)` 返回草稿，`notes` 数组记录每个跳过/降级点。**把翻译和判定分开**，②③ 才能复用同一份翻译结果。

## 09 · 数字与结论

```summary
title: 第 ① 步的结论
text: |
  - 语料 **6500 条 → 翻译出条件树 3415 条（52.5%）**，其中 `buildQuery` 通过 **100%**
  - 按类别：crowdFilter **73.6%** · crowd **67.8%** · tag **31.5%** · segment **0%**
  - 叶子：portrait **3806** · uid **1061** · 关系明细 **914** · 相对时间 **522** · 关系计数 **127**
  - 翻不过去的主因是「我们不支持的叶子」（tag / crowd / event / rawSql 共 **6857** 处），不是翻译器不够用
  - segment 整个类别 0%：它是标签分桶的形状，不属于圈选，整体排除
```

下一步是第二篇：只取「**单叶子 + 画像 + 无跳过叶子**」的 405 条，把两侧谓词归一化后逐字比 —— 第一次拿现网当标准答案。

## 10 · 自测

```quiz
- q: 「谓词」和「uid 集合」这两种编译方式，差别到底在哪？
  a: |
    谓词是 SQL 里 WHERE 后面的一个判断（`列 比较符 值`），它本身不产出人；
    uid 集合是一条完整的子查询（`select uid from 表 where …`），它产出一批人。
    现网走的是后者，我走的是前者 —— 所以 OR 在现网是「两批人并起来」（`union all`），
    在我这里就是同一段 WHERE 里的 `... OR ...`。语义可以相同，文本必然不同。
- q: 为什么这一步只比「单叶子 + 画像 + 无跳过叶子」的记录？
  a: |
    ① 单叶子：多叶子时现网用 `union all` + `having count = N` 表达 AND/OR，我是单条 WHERE，文本没法对应；
    ② 画像：关系条件现网写成 `uid in (select uid from 关系表 …)`，我是 `NOT EXISTS` 子查询，形状不同；
    ③ 无跳过叶子：如果记录里有我没翻的叶子（tag / crowd / event / rawSql），现网的 SQL 里还带着它，
    比出来的差异全是它造成的。三条都满足的谓词，两边应当是同一件事。
- q: 本地种子和镜像表，为什么要造两张不同的表？
  a: |
    因为要验的东西不同。**本地种子**按我们真实的 Catalog 造（18 个特征），用来验我们自己的字段口径；
    **镜像表**按现网语料的词表造（98 个字段、28 张关系表），让语料里的条件能在本地真的跑起来 ——
    后者才是验 OR / 否定 / 计数这些语义的前提。两张表名字与列都不同，互不干扰。
```
