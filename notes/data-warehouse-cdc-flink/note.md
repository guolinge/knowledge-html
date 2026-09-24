# 数据仓库 vs 数据库 · CDC vs Flink

## 01 · 数据库：服务「在线业务」

你平时接触的 MySQL、PostgreSQL、MongoDB 等，通常说的是 **数据库**。

它主要负责保存并支撑**正在发生**的业务操作：

```lane-stack
- title: 数据库在支撑什么
  desc: 每一件都要求「立刻写对、立刻查到」
  tone: blue
  nodes:
    - { title: 用户注册 }
    - { title: 用户登录 }
    - { title: 商品查询 }
    - { title: 提交订单 }
    - { title: 支付成功 }
    - { title: 修改收货地址 }
```

例如电商数据库里有这样的表：

```sql
users
products
orders
order_items
```

当用户下单时，后端会往 `orders` 表插入一条订单；用户查看订单时，又从这个表查询数据。

```callout
tone: violet
icon: 🎯
quote: true
text: |
  数据库的核心目标是：**保证每一笔业务数据正确地写入、修改和查询。**
```

它通常更关注单个用户、单笔订单这类「小范围、高频、低延迟」的读写操作。

## 02 · 数据仓库：服务「数据分析和报表」

**数据仓库（Data Warehouse，简称数仓）**，是把来自多个业务系统的数据收集、清洗、统一后，
专门用于分析、报表和商业决策的数据系统。

例如老板或运营会问：

```lane-stack
- title: 分析类问题
  desc: 共同点：要扫大量历史数据
  tone: green
  nodes:
    - { title: 今天总销售额多少？ }
    - { title: 哪个城市订单最多？ }
    - { title: 各渠道下单转化率？ }
    - { title: 近 30 天复购率？ }
    - { title: 哪个商品退款率最高？ }
```

这类问题需要**扫描、统计大量历史数据**，不适合直接频繁地在业务数据库上执行。

### 完整链路：从业务库到看板

整条链路可以拆成 **7 层**。左侧是每层的角色，右侧是这一层里真实存在的东西。

```lane-stack
- badge: LAYER 01
  title: 源系统层
  desc: 数据真正产生的地方，也是唯一「权威」的副本
  tone: muted
  nodes:
    - { title: MySQL 订单库, sub: "orders / order_items", tag: binlog }
    - { title: MySQL 用户库, sub: "users / user_profile", tag: binlog }
    - { title: 埋点日志, sub: "page_view / click", tag: Kafka }
    - { title: 支付系统, sub: "payments / refunds", tag: API / DB }
  next: "抽取 :: Extract :: 把数据从业务库「拿出来」"

- badge: LAYER 02
  title: 抽取层
  desc: 决定「多久同步一次」和「能不能拿到删除」
  tone: blue
  nodes:
    - { title: CDC 读 binlog, sub: "op = INSERT/UPDATE/DELETE", tag: 准实时 }
    - { title: 时间戳增量, sub: "WHERE updated_at > ?", tag: T+1 / 小时 }
    - { title: 全量快照, sub: "SELECT * 整表拉取", tag: 每天一次 }
    - { title: 日志采集, sub: "Flume / Filebeat", tag: 实时 }
  next: "落地 :: Load :: 先原样存下来，不做业务翻译"

- badge: LAYER 03
  title: ODS 贴源层
  desc: 与业务库表一一对应，只做类型转换 + 按天分区
  tone: amber
  group: ◈ 数仓内部：分层建模 ODS → DWD → DWS → ADS
  nodes:
    - { title: ods_order, sub: 订单原样落地 }
    - { title: ods_user, sub: 用户原样落地 }
    - { title: ods_page_view, sub: 埋点原样落地 }
    - { title: ods_payment, sub: 支付原样落地 }
  next: "清洗 :: Clean :: 去重 · 补空值 · 剔脏数据 · 统一编码/时区/单位"

- badge: LAYER 04
  title: DWD 明细层
  desc: 一行 = 一个业务事件，字段已翻译成业务语义
  tone: violet
  group: ◈ 数仓内部：分层建模 ODS → DWD → DWS → ADS
  nodes:
    - { title: dwd_order_detail, sub: 订单事件明细（已 join 用户 / 商品） }
    - { title: dwd_user_basic, sub: 用户基础信息 }
    - { title: dwd_pay_flow, sub: 支付流水明细 }
  next: "聚合 :: Aggregate :: 按 日期 / 城市 / 渠道 等维度 group by"

- badge: LAYER 05
  title: DWS 汇总层
  desc: 一行 = 一个统计口径，明细被压缩成指标
  tone: violet
  group: ◈ 数仓内部：分层建模 ODS → DWD → DWS → ADS
  nodes:
    - { title: dws_order_city_1d, sub: 日 · 城市 · 渠道 的订单与 GMV }
    - { title: dws_user_active_1d, sub: 日活 / 留存 }
    - { title: dws_channel_funnel_1d, sub: 渠道转化漏斗 }
  next: "加工 :: Serve :: 面向某张具体报表定制口径"

- badge: LAYER 06
  title: ADS 应用层
  desc: 直接给报表用的结果表，查询毫秒级
  tone: green
  group: ◈ 数仓内部：分层建模 ODS → DWD → DWS → ADS
  nodes:
    - { title: ads_gmv_report, sub: GMV 大盘 }
    - { title: ads_refund_rank, sub: 退款率排行 }
    - { title: ads_retention, sub: 复购 / 留存看板 }
  next: "查询 :: Query :: BI / 看板 / API 只读结果表，不碰业务库"

- badge: LAYER 07
  title: 应用层
  desc: 谁来消费这些数据
  tone: muted
  nodes:
    - { title: BI 报表, sub: 固定口径的日报周报 }
    - { title: 数据看板, sub: 实时大盘 }
    - { title: 即席查询, sub: 分析师临时取数 }
    - { title: 数据 API, sub: 反哺业务系统 }
    - { title: 算法特征, sub: 喂给推荐 / 风控模型 }
```

```callout
tone: amber
icon: 🧱
tinted: true
text: |
  为什么要分这么多层？因为**每一层只解决一个问题**：
  ODS 保证「拿全了」、DWD 保证「看懂了」、DWS 保证「算快了」、ADS 保证「用着顺手」。
  中间任何一层算错，都能回到上一层重跑，而不用去动业务库。
```

### 细节：一行订单数据是怎么被搬走的

上面是宏观分层。下面用一条真实订单（`id = 1001`）走一遍，
看它在每一层的**数据形态**到底发生了什么变化。

```journey
- tag: ① 源系统
  tone: muted
  name: MySQL · orders
  badge: 只存最终状态
  badgeTone: red
  fields:
    - { k: id, v: "1001" }
    - { k: user_id, v: "88" }
    - { k: status, v: "1", note: 魔法数字, tone: warn }
    - { k: amount, v: "9900", note: 单位：分, tone: warn }
    - { k: updated_at, v: "2024-05-20 10:03:12" }
  note: |-
    业务库只关心「现在是什么」：**没有城市、渠道、会员等级**，
    历史状态会被覆盖，而且这台库不能随便跑大统计。
  noteTone: bad
  next: "CDC 订阅 binlog :: :: 只传变化的那一行，不扫全表"

- tag: ② 抽取
  tone: blue
  name: binlog event
  badge: 含 before / after
  code: |
    {"op": "UPDATE", "table": "orders",
     "before": {"id": 1001, "status": 1},   // 改之前
     "after":  {"id": 1001, "status": 2}}   // 改之后
  note: |-
    拿到 **before / after** 意味着：既知道「改成了什么」，也知道「哪一行被删了」
    —— 这正是轮询做不到的。
  next: "原样落地 :: :: 不翻译业务语义，先存下来"

- tag: ③ ODS
  tone: amber
  name: ods_order
  badge: 只加分区字段
  fields:
    - { k: id, v: "1001" }
    - { k: user_id, v: "88" }
    - { k: status, v: "2" }
    - { k: amount, v: "9900" }
    - { k: updated_at, v: "2024-05-20 10:03:12" }
    - { k: dt, v: "2024-05-20", note: 新增分区, tone: ok }
  note: |-
    只做了**字段类型转换**和**加分区字段 dt**，不做任何业务翻译。
    好处是：上游口径改了、或者下游算错了，都能回到这一层原样重跑。
  next: "清洗 + 统一 + 关联 :: :: 枚举翻译 · 单位换算 · 多次 join"

- tag: ④ DWD
  tone: violet
  name: dwd_order_detail
  badge: 业务可读
  fields:
    - { k: order_id, v: "1001" }
    - { k: order_status, v: "'已支付'", note: 枚举翻译, tone: ok }
    - { k: amount, v: "99.00 元", note: 分 → 元, tone: ok }
    - { k: city, v: "'杭州'", note: join ods_user, tone: ok }
    - { k: channel, v: "'APP'", note: join 埋点, tone: ok }
    - { k: user_level, v: "'VIP'", note: join 用户标签, tone: ok }
  note: |-
    到这一层，**一行 = 一次订单事件**，字段已经能被业务直接读懂。
    原来要 join 三张表才能回答的问题，现在查一张表就够。
  next: "聚合 :: :: group by 日期 + 城市 + 渠道"

- tag: ⑤ DWS
  tone: violet
  name: dws_order_city_1d
  badge: 明细 → 指标
  fields:
    - { k: dt, v: "2024-05-20" }
    - { k: city, v: "'杭州'" }
    - { k: channel, v: "'APP'" }
    - { k: order_cnt, v: "1820", tone: ok }
    - { k: gmv, v: "182340.00", tone: ok }
  note: |-
    一行 1001 的订单，在这里被「溶解」成杭州当天 1820 单里的一份子。
    数据量通常会下降 **2~3 个数量级**，但已经无法再还原到单笔订单。
  next: "面向看板加工 :: :: 只留报表要用的字段和口径"

- tag: ⑥ ADS
  tone: green
  name: ads_gmv_report
  badge: 毫秒返回
  fields:
    - { k: 指标, v: "今日 GMV" }
    - { k: 值, v: "1,284,930" }
    - { k: 环比, v: "+12.4%" }
    - { k: 城市 Top1, v: "杭州" }
  note: |-
    看板查询从「扫几亿行明细」变成「读几千行结果」，所以能秒开。
    代价是这张表**只服务于这一个口径**，换一个问法就要再建一张。
```

### 抽取方式怎么选

「怎么把数据拿出来」是整条链路里最关键的一步。常见有 5 种做法，差别主要在
**延迟**、**能不能感知删除**、**对业务库的压力**。

```compare
first: 方式
head: [怎么做, 延迟, 删除, 压力, 适用]
rows:
  - 全量快照:
      - 每天 `SELECT *` 整表拉一遍
      - T+1
      - { text: 能, tone: green }
      - { text: 高, tone: red }
      - 小表、维表
  - 时间戳增量:
      - "`WHERE updated_at > 上次时间`"
      - 分钟 ~ 小时
      - { text: 不能, tone: red }
      - { text: 中, tone: amber }
      - 有 `update_time` 的表
  - 自增 ID 增量:
      - "`WHERE id > 上次最大 id`"
      - 分钟 ~ 小时
      - { text: 不能（改也漏）, tone: red }
      - { text: 中, tone: amber }
      - 只追加的流水表
  - 触发器:
      - 建 trigger 写影子表
      - 秒级
      - { text: 能, tone: green }
      - { text: 高（写放大）, tone: red }
      - 老系统兜底
  - CDC 读 binlog:
      - 订阅数据库变更日志，只读不写
      - { text: 秒级 / 准实时, tone: green }
      - { text: 能, tone: green }
      - { text: 低, tone: green }
      - 现在的主流方案
```

数据仓库存储的是经过处理、适合分析的数据；它通常面向报表、仪表盘和商业智能场景。

## 03 · 最核心的区别

```compare
first: 维度
head: [数据库, 数据仓库]
rows:
  - 主要目的: [支撑线上业务, 数据分析、报表、决策]
  - 典型操作: [下单、支付、修改资料, 统计 GMV、转化率、复购率]
  - 数据来源: [往往是一个业务系统, 通常汇集多个业务系统]
  - 数据范围: [当前业务数据为主, 大量历史数据]
  - 数据形态: [更贴近原始业务表, 清洗、统一、汇总后的分析数据]
  - 查询特点: [查一位用户、一笔订单, 查全量，按天 / 月 / 地区 / 渠道聚合]
  - 使用者: [后端服务、业务系统, 数据分析师、运营、管理者、BI 系统]
  - 是否直接承接用户请求:
      - { text: 是, tone: green }
      - { text: 通常不是, tone: muted }
```

## 04 · 数据怎么流动

同样的订单数据，两条完全不同的路径。

```lane-stack
- title: 写入路径
  desc: 用户下单 —— 这应该直接写业务数据库，而不是直接写数据仓库
  tone: blue
  nodes:
    - { title: 前端 }
    - { title: 后端服务 }
    - { title: "MySQL orders 表", tone: blue }

- title: 分析路径
  desc: 今日成交额实时大盘 —— 走异步链路，不碰业务库
  tone: violet
  nodes:
    - { title: 订单数据 }
    - { title: CDC / 消息队列 }
    - { title: Flink }
    - { title: 数据仓库 / 实时分析库 }
    - { title: 大盘 }
```

## 05 · 一个容易混淆的点

```callout
tone: amber
icon: 💡
text: |
  数据仓库**不一定是某个固定产品**，而是一类用途 / 架构。
```

例如这些产品可能被用作数仓或数仓中的查询引擎：

```lane-stack
- title: 常见选择
  desc: 它们不都是「数仓」，但都可以充当数仓或数仓里的查询引擎
  tone: green
  nodes:
    - { title: ClickHouse }
    - { title: Apache Doris }
    - { title: StarRocks }
    - { title: Snowflake }
    - { title: BigQuery }
    - { title: Redshift }
    - { title: Hive }
```

而 MySQL 既是数据库，也能勉强做少量报表；但当**数据量、查询复杂度、并发分析需求**变大时，
直接在业务 MySQL 上跑大统计很容易影响线上下单、支付等业务。

## 06 · CDC 是 Flink 的一个功能吗？

```callout
tone: violet
icon: 🧩
quote: true
text: |
  严格来说：CDC 不是 Flink 独有、也不是只有 Flink 才有的功能。
```

CDC 是一种通用技术 / 思路，完整名称是 **Change Data Capture：变更数据捕获**。

它用于捕捉数据库中数据的三种变化：

```lane-stack
- title: CDC 捕获什么
  desc: 对应数据库变更日志里的三种操作
  tone: blue
  nodes:
    - { title: INSERT, sub: 新增, tone: green }
    - { title: UPDATE, sub: 修改, tone: blue }
    - { title: DELETE, sub: 删除, tone: red }
```

例如 MySQL 的订单表发生了变化：

```text
新增订单 A001
订单 A001 从“待支付”改为“已支付”
删除一条测试订单
```

CDC 会把这些变化捕捉出来，作为持续的数据流发给下游。

### Flink 和 CDC 的关系

```lane-stack
- title: 分工
  desc: 一个负责「发现变化」，一个负责「加工变化」
  tone: violet
  nodes:
    - { title: 数据库的变更日志, sub: 例如 MySQL binlog, tone: muted }
    - { title: CDC, sub: 读取并识别「新增、修改、删除」, tone: blue }
    - { title: Flink, sub: 实时清洗、转换、计算、关联、写入目标系统, tone: violet }
    - { title: 下游, sub: 数仓 / 湖仓 / ES / Kafka / 风控, tone: green }
```

```checklist
items:
  - "**CDC**：负责「发现数据库发生了什么变化」"
  - "**Flink**：负责「拿到变化后，实时怎么加工和处理」"
```

## 07 · 那么什么是 Flink CDC？

**Flink CDC** 是 Flink 生态中的一个 CDC 项目 / 连接器方案。

它可以让 Flink 读取 MySQL、PostgreSQL、Oracle、SQL Server 等数据库的变更，
并把变更作为 Flink 的流数据来处理。其底层常会使用 **Debezium** 提供的数据库变更捕获连接器。

```lane-stack
- title: 一个典型用法
  desc: MySQL 表变化 → Flink 加工 → 写进各种下游
  tone: blue
  nodes:
    - { title: MySQL users 表变化, tone: muted }
    - { title: Flink CDC 捕获 binlog, tone: blue }
    - { title: Flink 清洗或补充字段, tone: violet }
    - { title: Kafka / ClickHouse / Doris / Iceberg, tone: green }
```

## 08 · 为什么不直接定时查数据库，而要 CDC？

不用 CDC 的方式可能是这样：

```sql
-- 每隔 10 分钟执行一次
SELECT * FROM orders WHERE update_time > 上次同步时间
```

这种方式简单，但会有问题：

```checklist
tone: cross
items:
  - 延迟高，最快也要等下一次轮询
  - 不断查询业务数据库，可能增加压力
  - 更新频繁时，容易漏数据、重复数据
  - 删除数据不容易准确识别
  - 很难做到真正接近实时
```

CDC 则直接基于数据库的**变更日志**读取变化，只同步新增、更新、删除的部分，
而不是反复扫描整张表。

```demo
widget: polling-vs-cdc
title: 订单表变更流
panes:
  - log: poll
    tag: 轮询
    tone: amber
    head: 定时查表
    sub: 每 10 分钟一次
    foot: [延迟高, 中间状态丢失, 删除难识别, 反复压业务库]
  - log: cdc
    tag: CDC
    tone: violet
    head: 订阅变更日志
    sub: 每条变化实时推送
    foot: [近实时, 含删除, 只读 binlog, 不反复扫表]
```

## 09 · 前端类比

把数据库想象成前端的状态：

```js
const user = {
  name: '小明',
  vip: false
}
```

如果你每隔一秒都重新读取整个对象，看看它有没有变化，这有点像**定时轮询查表**。

CDC 更像是**状态变化时立即收到事件**：

```js
// 用户升级会员时，马上收到变化事件
{
  type: 'UPDATE',
  before: { name: '小明', vip: false },
  after:  { name: '小明', vip: true }
}
```

Flink 则相当于订阅这个事件后继续处理：

```js
if (after.vip === true) {
  // 同步会员系统、更新数据看板、触发营销任务等
}
```

## 10 · 一句话总结

```summary
title: 记住这条链路
text: |
  `CDC` 负责把数据库变化**「实时通知出来」**；

  `Flink CDC` 是让 Flink 能方便读取这些变化的工具；

  `Flink` 再对这些变化做实时处理和同步。
```

```lane-stack
- title: 三句话收尾
  desc: 三个层次，各管一件事
  tone: blue
  nodes:
    - { title: 数据库, sub: 面向「正在发生的操作」，要求正确、快、稳, tone: blue }
    - { title: 数据仓库, sub: 面向「已经发生的历史」，要求能扫、能聚合, tone: violet }
    - { title: CDC + Flink, sub: 一个负责发现变化，一个负责加工变化, tone: green }
```

## 11 · 自测

```quiz
- q: 数据仓库一定要用某个固定产品吗？
  a: |
    不是。数仓是一类**用途 / 架构**，不是产品。
    ClickHouse、Doris、StarRocks、Snowflake、BigQuery、Hive 都可以充当数仓或数仓里的查询引擎。
- q: CDC 是 Flink 的功能吗？
  a: |
    不是。CDC（Change Data Capture）是通用技术。
    Flink CDC 只是 Flink 生态里的一个连接器方案，底层常复用 Debezium。
- q: 为什么 ODS 层不做业务翻译？
  a: |
    为了保住「可回溯」。ODS 与业务库一一对应，只做类型转换和分区。
    上游口径变了、下游算错了，都能回到这一层原样重跑，而不用重新抽一遍业务库。
- q: 定时轮询为什么识别不到删除？
  a: |
    增量轮询的写法是 `WHERE update_time > 上次时间`，被删掉的行不会再出现在结果集里。
    只有整表比对才能发现少了一行，但那等于每次全表扫描。
    CDC 读 binlog 能直接拿到 `op=DELETE` 事件。
- q: DWD 和 DWS 的分界线在哪？
  a: |
    DWD 是**明细**：一行 = 一个业务事件，字段已翻译成业务语义，但还没聚合。
    DWS 是**汇总**：一行 = 一个统计口径（日期 + 城市 + 渠道），明细已被压缩成指标。
    过了 DWS 就回不到单笔订单了。
```
