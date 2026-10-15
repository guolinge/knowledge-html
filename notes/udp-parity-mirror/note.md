第三篇跑完第一轮，结论是：**对拍跑通了，但只测到 7 条真东西。** 根因很直接 —— 语料用的字段九成以上不在我们的 18 个特征里。这一篇讲怎么把这个限制拆掉。

要看清楚缺什么，最直接的办法是看一条**跑不起来**的真实记录（现网 `tag 1235865` 的那条关系条件）：

````callout
tone: blue
icon: 📦
text: |
  **现网记录里引用了一个字段/关系，我的库里没有：**

  ```json
  {"relationName":"niuniu_user_security_special_watchlist","op":"IN","value":["75900664355662"]}
  ```

  翻译没问题（我能翻成 `{relation:"niuniu_user_security_special_watchlist", formula:"detail", op:"in"}`），
  但一编译就报 `UNKNOWN_RELATION`，就算硬编出 SQL 来，跑的时候也会报：

  ```text
  Unknown column 'futu_hk_account_basic_customer_type' in 'table list'
  ```

  ==因为本地库里根本没有这些字段和关系表。== 这一篇要做的，就是**把现网用到的词表搬一份到本地**：
  语料里出现过什么字段、什么关系、什么取值，我就在本地建出对应的表和数。
````

## 01 · 缺口有多大（数字）

```compare
first: 事实
head: [数字, 后果]
rows:
  - 语料里的画像字段: ["几百个（我抽到的词表里 98 个）", "我的 Catalog 只有 18 个 → 大部分记录编译就过不了"]
  - 语料里的关系: ["28 张", "我只有 8 张，而且现网记录里这 8 张几乎没被用过"]
  - 本地已有的种子表: ["只建了真实词表的表（10 万行）", "现网 SQL 引用的列在本地不存在，跑起来直接报「未知列」"]
```

```callout
tone: red
icon: 🩸
text: |
  **这个缺口是可量化的**：`字段不在我们的 Catalog` 一条筛选，就刷掉了 **2727 / 6500** 条语料。

  而被刷掉的恰恰是**最有价值的那批**：关系、OR / 否定 / 计数、多叶组合 ——
  那些只有跑数才能验的语义，全藏在这些记录里。
```

## 02 · 三步：抽词表 → 建表灌数 → 重新生成 case

```flow
legend: true
groups:
  - { id: crm, label: "从语料里抽", tone: amber }
  - { id: local, label: "本地建", tone: green }
nodes:
  - { id: vocab, label: "① 抽词表", sub: "98 字段 / 28 关系 / 真实取值", row: 0, kind: backend, group: crm }
  - { id: cat, label: "合成 Catalog", sub: "表名按现网的说法", row: 1, kind: security, group: local }
  - { id: seed, label: "② 建表 + 灌数", sub: "10k × 92 列 + 28 张关系表", row: 2, kind: database, group: local }
  - { id: cases, label: "③ 重新生成 case", sub: "可跑 1417 对", row: 3, kind: backend, group: local }
  - { id: run, label: "跑 + 比 uid 集合", sub: "一致 1209", row: 4, kind: backend, group: local }
edges:
  - { from: vocab, to: cat, tone: amber }
  - { from: cat, to: seed, label: "决定表结构", tone: green }
  - { from: seed, to: cases, label: "表和数据就位" }
  - { from: cases, to: run, label: "两侧 SQL → Doris" }
```

词表抽出来真实长这样（`parity-vocab.json` 里的三条）：

```json
{"key":"futu_hk_asset_basic_total_assets",
 "variableType":"range","dataType":"long","contentType":3,
 "ops":["=",">","<"], "values":["0","200","1000"]}

{"key":"niuniu_login_client_device_type",
 "variableType":"enum","dataType":"long","contentType":0,
 "ops":["IN","="], "values":["11","12","23"]}

{"key":"alex_ftest_relation_1779177182", "objects":["1"], "props":[
   {"key":"attrr1","variableType":"range","dataType":"string","primary":false,"values":["a","b"]},
   {"key":"attrr2","variableType":"enum","dataType":"string","primary":true,"values":["x","y"]}]}
```

三个设计决定（都是被坑出来的，见 04 节）：

| 决定 | 为什么 |
|---|---|
| 表名跟现网一致（`user_portrait` + 关系名即表名） | 现网 SQL 不改表名就能直接跑，少一层映射就少一个出错点 |
| 取值必须**包含语料里真实出现过的值** | 否则 `object_id in ('00')`、`uid in (242077285)` 这类条件两边都命中不到行 → 都是空集 → 假一致 |
| 行数只取 1 万（不是 10 万） | 字段多了 5 倍、关系多了 3 倍，先把流程跑通，需要更大样本再放大 |

## 03 · 建出来什么、灌了多少

```text
== 建表（库 crm_insight）==
  user_portrait（92 列）+ 28 张关系表

== 灌种子（10000 个 uid，其中语料 uid 60 个）==
  user_portrait: 10000 行
  关系表合计: 194547 行

完成。跳过 ct1（YYYYMMDD 日期列）字段 6 个：alex_ftest_character_1778315960, princetest2, …
```

建表 DDL 的头几行长这样（列名直接来自词表）：

```sql
CREATE TABLE crm_insight.user_portrait (
  uid BIGINT NOT NULL,
  futu_hk_account_status BIGINT NULL,
  futu_hk_asset_basic_total_assets BIGINT NULL,
  niuniu_login_client_device_type VARCHAR(128) NULL,
  … 共 92 列 …
) UNIQUE KEY(uid) DISTRIBUTED BY HASH(uid) BUCKETS 16
```

值也不是乱造的 —— 三条规则，目的是让**边界真的被测到**：

```text
时间戳列：0（从未发生，20%）· NULL（10%）· 最近 30 天（30%）· 30~365 天（25%）· 一年以上（15%）
数值列：  0（兜底，15%）· NULL（10%）· 小值 · 大值 · 边界值
枚举列：  从语料里观察到的取值里取（如 day_count 的 1/7/30/90/180/365/当季/历史至今）
```

## 04 · 三个坑

```journey
- tag: 坑 ①
  tone: red
  name: 一个字段被两种操作符用
  badge: 656 → 11
  code: |
    同一个字段：{"op":"IN","value":["0","1"]}   ← 按这个推成 enum
    同一个字段：{"op":">=","value":["1"]}        ← enum 不允许比较符 → 编译报错
  note: 形状是按**整份语料**推的（一个字段一个形状），但同一个字段在不同记录里可能被不同操作符用。形状决定「操作符允许不允许」，于是必然打架。
  noteTone: bad
  next: "改成按**叶子**推形状：一个字段在不同 case 里可以有不同形状候选"

- tag: 坑 ②
  tone: amber
  name: 弱类型 vs 强类型
  badge: 637 条
  code: |
    现网: {"op":"gte","value":["1"]}    ← 数值也落成字符串
    我们: gte 要求 long 类型的标量
  note: 我们的 DSL 是强类型的，现网是弱类型（靠 SQL 隐式转换）。所以「修形状」的同时必须**把值也转成对应类型** —— 只改形状、值还是字符串，校验照样拒。
  noteTone: bad
  next: "repairCase()：按叶子定形状，并把值与操作符一起修好（枚举多值时把 `=` 翻成 in）"

- tag: 坑 ③
  tone: violet
  name: 日期列必须排除
  badge: 6 个字段
  code: |
    现网日期列: 20261015        ← YYYYMMDD 整数
    我们时间戳: 1791552000      ← 秒级
  note: 两侧数值口径不同，同一列比出来的结果没有意义；而我们真实 Catalog 里也没有日期类字段（contentType=1）可以先对齐。
  noteTone: warn
  next: "从合成 Catalog 与镜像表里一起去掉，让「字段不在 Catalog」这条筛选自然过滤掉相关记录"
```

## 05 · 结果，以及一个真问题的浮现

```summary
title: 第 ④ 步的结果
text: |
  - 可跑 case 从 **86 对涨到 1417 对**（16 倍）
  - **一致 1209 / 1417（85.3%）**；不一致 191；执行报错 17
  - 不一致集中：**关系明细 138 · 关系计数 45 · 画像 8**
  - 17 条报错全是同一个原因：我们给 array 字段编译出 `array_contains`，而现网这类列是逗号分隔串
```

````callout
tone: green
icon: ✅
text: |
  **那 17 条报错是本轮最有价值的产出。**

  它不是「跑不起来」，而是**编译器的一条真实差异被数据抓出来了**：

  ```text
  Can not find the compatibility function signature: array_contains(VARCHAR(1024), VARCHAR(1))
  ```

  现网的数组列是**逗号分隔字符串**（该用 `find_in_set`），我们按真正的 `ARRAY` 列写（`array_contains`）。
  在这之前这条差异只是「我怀疑」，现在是**本地可复现**。

  ==这正是结果级对拍的价值：文本层面看不出来的东西，数据会把它顶出来。==
````

191 条不一致里的一条真实样本（现网 case `1191481`，关系明细）：

| | SQL（节选） | 人数 |
|---|---|---|
| 我们 | `WHERE ((u.uid IN (SELECT uid FROM 关系表A WHERE object_id IN (…)) OR u.uid IN (SELECT uid FROM 关系表B …)))` | 待分诊 |
| 现网 | `select uid from (select uid from 关系表A where object_id in (…) group by uid union all select uid from 关系表B …) ct1 group by uid` | 待分诊 |

```compare
first: 剩下的 191 条
head: [现在的判断, 下一步]
rows:
  - "关系明细 138 · 关系计数 45": ["最值得查的一批：关系路径在第二篇里一条都没被验过（现网记录里我们那 8 条关系几乎没被用过）", "按「两侧 SQL 的结构差异」自动归类，再逐类分诊"]
  - "画像 8 条": ["大概率是形状推断的边缘情况", "单独看样本"]
  - "array 报错 17 条": ["确认的真差异（差异文档 §8.2-A）", "拍板：改 `find_in_set`，还是给 Catalog 加数组形态开关"]
```

## 06 · 边界与代价

```checklist
title: 镜像能证明什么、不能证明什么
good:
  - "能证明：编译器语义（关系 / 否定 / 计数 / 多叶组合）在**同一份数据**上与现网一致"
  - "能证明：某些差异是真实存在的（array 函数签名）"
  - "能证明：某个字段形状下的操作符映射没错"
bad:
  - "不能证明：我们 18 个字段的真实口径（那要用真实 Catalog 对拍，见第二篇）"
  - "不能证明：生产数据上的性能与正确性（本地是随机数据 + 合成形状）"
  - "不能替代：单测与 fixtures（那些才是回归防线，对拍是抽样验证）"
```

代价也说清楚：本地多了 29 张表（1 张 92 列的宽表 + 28 张关系表）、19.4 万行关系数据，生成一次约 1.5 分钟。合算的原因是**它可重复**：语料抽样、词表、合成 Catalog、镜像表、case 文件全部落盘，谁都能重跑一遍拿到同一批数字。

## 07 · 自测

```quiz
- q: 为什么必须把语料里出现过的「取值」也一起镜像，而不是只建表结构？
  a: |
    因为现网记录里的条件是**带值的**：`object_id in ('00')`、`uid in (242077285)`。
    如果本地数据里没有这些值，条件在两边都命中 0 行 —— uid 集合都是空集，
    会判成「一致」但没有任何信息量。所以种子必须包含语料里真实出现过的取值。
- q: 为什么形状要「按叶子推」而不是「按字段推」？
  a: |
    因为同一个字段在不同记录里可能被不同操作符使用：枚举既用 `IN` 也用 `=`；数值既用 `>=` 也用 `IN`。
    而形状决定「操作符允许不允许」（applicableOps），一个字段一个形状就必然打架（656 条报错就是它）。
    按叶子推等于每个 case 用自己那份形状 —— 形状只影响「能不能编译」，不影响谓词文本，不污染比对结果。
- q: 这一轮 17 条执行报错说明了什么？
  a: |
    它不是环境问题，而是**编译器的一条真实差异**：现网的数组字段是逗号分隔字符串（该用 `find_in_set`），
    我们按真正的 ARRAY 列写了 `array_contains`，Doris 直接报函数签名不存在。
    文本级的对拍看不出来（两边都「有一种写法」），只有真跑起来才会炸 —— 这就是结果级对拍的价值。
```
