第二篇把「写法」验完了。但它有个硬边界：**只要两边的 SQL 结构不一样，文本就没法比**。而现网和我们的结构差异正好集中在三件事上 —— **OR、否定、计数**。

这一篇就是去啃这三件事。先看它们长什么样（同一条 OR 条件，取自现网 case `1191481`）：

````callout
tone: blue
icon: 📦
text: |
  **同一条「A 关系 OR B 关系」的条件，两边写出来的 SQL：**

  ```sql
  -- 现网：每个条件 = 一批人 → OR 就是两批人并起来
  select `uid` from (
    select `uid` from `niuniu_user_security_special_watchlist` where `object_id` in (…) group by `uid`
    union all
    select `uid` from `futu_hk_user_security_position`        where `object_id` in (…) group by `uid`
  ) ct1 group by `uid`

  -- 我们：每个条件 = 一个判断 → OR 就是同一段 WHERE 里的 OR
  SELECT `u`.`uid` FROM `user_portrait` AS `u` WHERE ((
    `u`.`uid` IN (SELECT `uid` FROM `niuniu_user_security_special_watchlist` WHERE …)
    OR `u`.`uid` IN (SELECT `uid` FROM `futu_hk_user_security_position` WHERE …)))
  ```

  ==两条 SQL 长得完全不像，但语义可能完全一致。要证明这一点，只有一条路：都跑一遍，看圈出来的人是不是同一批。==
````

## 01 · 只有跑数才能验的三件事

```compare
first: 语义
head: [现网怎么写, 我们怎么写]
rows:
  - OR: ["`union all` 后 `group by uid`（并集）", "单条 WHERE 里的 `(… OR …)`"]
  - AND: ["`union all` + `having count(uid) = N`（交集）", "直接 `AND`"]
  - 否定（关系明细）: ["`uid not in (select uid from 关系表 where …)`", "`NOT EXISTS` 相关子查询"]
  - 计数: ["`left join` 一个 count 子查询 + `IFNULL(cnt,0) op N`", "`uid IN (select uid … group by uid having COUNT(*) op N)`"]
```

这四件事的正确性**只能靠结果证明**。但一旦开始跑数，就先得解决三个环境问题：

| 问题 | 事实 | 我的处理 |
|---|---|---|
| 用哪份数据 | 共享测试库只能读；我的镜像表也建不进去 | 用**本地 Doris**（`crm_insight`） |
| 现网的 UDF | `UID_ENCODE` / `UNIX_TIMESTAMP(DS_DATETIME_ADD('day',-3,NOW()))` / `DS_DATE_ADD` 我库里没有 | 编译期替换成常量 |
| 表名不同 | 现网全部特征在一张 `user_portrait`；我真实 Catalog 下特征表叫 `user_portrait_wide` | 按模式映射（见 03 节） |

## 02 · 为什么要拆成两个仓的脚本

```flow
nodes:
  - { id: corpus, label: 现网语料, sub: "sql_gen_record（数据侧那个仓能连）", row: 0, kind: external }
  - { id: cases, label: 编译成一对 SQL, sub: "audience_web/scripts/udp-parity", row: 1, kind: backend }
  - { id: runner, label: 两侧都跑 · 比 uid 集合, sub: "crm-dsl-stru/doris（有 mysql2）", row: 2, kind: backend }
  - { id: report, label: 报告, sub: "一致 / 不一致 / 报错", row: 3, kind: backend }
edges:
  - { from: corpus, to: cases, label: "抽语料 + 翻译", tone: blue }
  - { from: cases, to: runner, label: "parity-cases.json" }
  - { from: runner, to: report, label: "在同一个 Doris 上跑" }
```

拆开的原因很实际：**MySQL 客户端只装在数据侧那个仓**（`crm-dsl-stru`），而编译要用 SDK 侧的包（`audience_web`）。硬凑在一起的结果是给 SDK 仓加一个它根本不该有的数据库依赖。

好处是分工干净：`build-cases.mjs` 只负责「把语料编译成一对 SQL」并写盘，`run-parity.mjs` 只负责「读文件、跑、比」。中间的 JSON 就是两边的契约 —— 出问题能直接看文件。

磁盘上那个文件真实长这样（`parity-cases.json` 的第 2 条）：

```json
{
 "id": "1233829",
 "category": "crowdFilter",
 "leaves": "uid",
 "ourSql": "SELECT `u`.`uid` AS `uid` FROM `user_portrait` AS `u` WHERE ((`u`.`uid` IN (242077285)))",
 "udpSql": "select uid from user_portrait where (`uid` in ('242077285'))"
}
```

## 03 · 把两侧拉到同一基准

```compare
first: 差异
head: [现网 SQL, 我们编译的 SQL, 处理]
rows:
  - uid 编解码: ["`UID_ENCODE('1001')` / `UID_DECODE(uid)`", "明文整数", "直接去掉函数（本地 uid 是明文）"]
  - 时间基准: ["`UNIX_TIMESTAMP(DS_DATETIME_ADD('day',-3,NOW()))`", "编译期算好的常量", "按同一个业务时刻算成秒数替换"]
  - 值引号: ["`col = '2'`", "`col = 2`", "Doris 自己会隐式转，不处理"]
  - 表名: ["`user_portrait`（全部特征一张表）", "`user_portrait_wide`（真实 Catalog）或 `user_portrait`（镜像模式）", "按当前用哪份 Catalog 决定映不映射"]
```

时间基准是**唯一必须对齐的运行时变量**：我们编译时传 `today/now`，现网的 SQL 里是 `NOW()`。两边要用同一个时刻（这里取 `2026-10-15 12:00`），否则相对时间必然错位。

## 04 · 踩到的三个坑

```journey
- tag: 坑 ①
  tone: red
  name: 关系条件的 countSql 不是「where 谓词」
  badge: 5 条报错
  code: |
    select count(1) as count from (
      select uid from 关系表 where object_id in ('00') group by uid
    ) rt
  note: 我按画像的形状去抽谓词，抽出来的是 `object_id in ('00') group by uid) rt` —— 完全不是可跑的东西。关系条件的 countSql 里根本没有可比谓词。
  noteTone: bad
  next: "关系/多叶子改走 listSql；只有 countSql 时取它内层的 uid 子查询"

- tag: 坑 ②
  tone: amber
  name: 表名映射搞反了
  badge: 全量假不一致
  code: |
    我们: SELECT uid FROM user_portrait   ← 镜像表（1 万行）
    现网: select uid from user_portrait_wide ← 被错误映射（10 万行）
  note: 真实 Catalog 模式下要把现网的 `user_portrait` 映射到我们的特征表；但**镜像模式下表名就叫 `user_portrait`**。同一个映射用错模式，两边跑在不同表上 → 人数差 10 倍。
  noteTone: bad
  next: "按 Catalog 的 universeTable 判断，不写死"

- tag: 坑 ③
  tone: violet
  name: uid 字面量在种子里不存在
  badge: 79 / 86
  code: |
    我们: WHERE ((`u`.`uid` IN (242077285)))
    现网: where (`uid` in ('242077285'))
  note: 两侧 SQL 一模一样，但**本地 10 万行种子里没有 242077285 这个人** → 两边都是空集 → 判成「一致」，没有任何信息量。
  noteTone: warn
  next: "把语料里的 uid 塞进种子（第四篇做的正是这件事）"
```

## 05 · 结果，以及它暴露的真问题

```summary
title: 第 ③ 步的结果
text: |
  - 86 对 case：uid 集合一致 **86 / 86（100%）**，0 报错
  - 但形态分布是 **79 uid / 5 relation / 2 portrait** —— 真正有信息量的只有 **7 条**
  - 被筛掉的主因：**叶子字段必须在我们 Catalog 里**（18 特征 + 8 关系），一条就刷掉 **2727** 条
  - 结论：对拍跑通了，但「语料 × 我们的 Catalog」交集太小 —— 语料里九成字段不在我们的元数据里
```

```callout
tone: amber
icon: ⚠
text: |
  ==这一步真正的产出不是「100% 一致」，而是知道了「100% 一致」有多廉价。==

  79 条 uid case 的两侧 SQL 本来就只是同一串字面量，跑出来都是空集。
  不看形态分布，很容易得出「结果级对拍已经全过了」的错觉。
  **所以每份对拍报告都要同时给「分母 + 形态分布」，只给分子等于自欺。**
```

这直接决定了下一步：**要让语料里的字段真的跑起来** —— 把 UDP 的词表镜像到本地。这是第四篇。

## 06 · 自测

```quiz
- q: 为什么这一层必须跑数，而第二篇不用？
  a: |
    第二篇比的是「同一个条件两边是不是同一件事」，看文本就够。
    但 OR / 否定 / 计数这三类的差异是**结构性**的：现网用集合运算
    （`union all` + `having count`、`uid not in (…)`），我们用单条 WHERE 里的谓词 ——
    文本没有对应关系，只有跑出来比 uid 集合才能证明语义相同。
- q: 现网 SQL 要跑在我们的库上，必须处理哪两件事？
  a: |
    ① **UDF**：`UID_ENCODE` / `UNIX_TIMESTAMP(DS_DATETIME_ADD('day',-N,NOW()))` / `DS_DATE_ADD` 我库里没有，
    要按同一个业务时刻替换成常量；
    ② **表名**：现网全部特征在一张 `user_portrait`，而我们真实 Catalog 下特征表是 `user_portrait_wide`
    —— 映射与否取决于当前用的是哪份 Catalog，写死就会把两侧跑在不同表上（真踩过，人数差 10 倍）。
- q: 「86 条 100% 一致」为什么不能当结论？
  a: |
    因为要看形态分布：其中 79 条是「指定 UID」，两侧只是同一串 uid 字面量，
    而且这些 uid 在本地种子里根本不存在 —— 两侧都是空集，一致但没有任何信息量。
    真正有意义的只有 7 条。对拍报告必须同时给分子、分母与形态分布。
```
