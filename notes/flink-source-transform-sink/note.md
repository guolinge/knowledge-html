> 九个 Transformation 算子看起来是平铺的，其实只分五类；而 ==`keyBy` 根本不产出数据== —— 它只决定后续计算「以什么为单位」。这两条想通了，整条流水线就顺了。

## 01 · 一条流水线，三段

Flink 作业的形状很像一座工厂：

```text
原料进厂  →  加工、质检、组装  →  成品送到仓库或商店
```

换成 Flink 的词就是：

```text
Source  →  Transformation  →  Sink
读进来      怎么加工           写出去
```

```lane-stack
- badge: 第一段
  title: Source
  desc: 数据从哪来
  tone: blue
  nodes:
    - { title: Kafka, sub: "order_topic", tag: 消息队列 }
    - { title: MySQL CDC, sub: "binlog 变更流", tag: 数据库 }
    - { title: 文件, sub: "OSS / S3 / HDFS", tag: 有界 }
  next: "接进来 :: :: 变成 Flink 内部的一条数据流"

- badge: 第二段
  title: Transformation
  desc: 数据怎么加工 —— 业务规则全在这里
  tone: violet
  nodes:
    - { title: 清洗 / 过滤, sub: "map · filter · flatMap" }
    - { title: 分组 / 聚合, sub: "keyBy · reduce · aggregate" }
    - { title: 合并 / 关联, sub: "union · join" }
    - { title: 复杂事件, sub: "process", tag: 状态 + 定时器, tone: red }

- badge: 第三段
  title: Sink
  desc: 结果写到哪
  tone: green
  nodes:
    - { title: ClickHouse, sub: "给 BI 看板查" }
    - { title: Kafka, sub: "继续给下游消费" }
    - { title: Elasticsearch, sub: "搜索 / 日志检索" }
```

```callout
tone: blue
icon: 🏭
tinted: true
text: |
  Source 只负责**把数据接进来**，Sink 只负责**把结果送出去**。
  ==真正承载业务规则的只有中间那段== —— 一个 Flink 作业写得对不对，八成取决于 Transformation。
```

## 02 · Source：五种入口

```cards
cols: 3
items:
  - { title: Kafka, desc: 最常见的实时源。订单、埋点、支付、日志都往这里写，Flink 持续消费, tag: 消息队列, tone: blue }
  - { title: MySQL CDC, desc: 读 binlog，拿到 INSERT / UPDATE / DELETE 变更流，而不是扫表, tag: 变更日志, tone: violet }
  - { title: 文件, desc: OSS / S3 / HDFS 上的 CSV、Parquet。读完就没了 —— 这是有界流, tag: 有界, tone: green }
  - { title: RocketMQ / Pulsar, desc: 和 Kafka 同类，公司已经在用哪个就用哪个, tag: 消息队列, tone: blue }
  - { title: Socket, desc: 本地起个端口手工敲几行字，用来学原理。生产环境不会用它, tag: 学习用, tone: muted }
```

```callout
tone: amber
icon: ⚠
text: |
  !!CDC 的源头是数据库的变更日志（binlog），不是 Flink 一遍遍全表扫描。!!
  全表扫描要么压垮业务库，要么漏掉两次扫描之间发生的删除 —— binlog 里这些都有。
```

文件这类源有个特点值得单独记住：**它有末尾**。读到文件结束，数据就没了，任务可以退出。
这在 Flink 的术语里叫**有界流**；而 Kafka 那种永远不会有「最后一条」的叫**无界流** ——
两者怎么区分、怎么分别处理，见 [Flink 的有界流与无界流](../flink-bounded-vs-unbounded/)。

## 03 · Transformation：九个算子，其实是五类

原文把九个算子平铺着讲了一遍。但它们不是并列的 —— 按「干什么活」分，只有五类：

```cards
cols: 3
items:
  - { title: 逐条处理, desc: map / filter / flatMap。每条数据独立处理，不看别人脸色, tag: 无状态, tone: blue }
  - { title: 分组, desc: keyBy。不加工数据，也不改变条数，只决定后续计算以什么为单位, tag: 不产出, tone: amber }
  - { title: 有状态聚合, desc: reduce / aggregate。跟在 keyBy 后面，每个 key 各存一份状态, tag: 需要状态, tone: green }
  - { title: 多流合并, desc: union 只是合并不关联；join 才把两条流的数据拼起来, tag: 两条流, tone: violet }
  - { title: 底层逃生口, desc: process。能读写状态、注册定时器、处理迟到数据, tag: 什么都能干, tone: red }
```

分完类，每个算子的定位就清楚了：

| 算子 | 一条进几条出 | 要不要 `keyBy` | 有没有状态 |
|---|---|---|---|
| `map` | 1 → 1 | 不要 | 无 |
| `filter` | 1 → 0 或 1 | 不要 | 无 |
| `flatMap` | 1 → 0 到多条 | 不要 | 无 |
| `keyBy` | **条数不变** | 它自己 | 无 |
| `reduce` | N → N（每条都出一条） | **要** | 有 |
| `aggregate` | N → N（每条都出一条） | **要** | 有 |
| `union` | 两条流 → 一条流，条数相加 | 不要 | 无 |
| `join` | 两条流 → 一条流，按 key 配对 | **要** | 有（要缓存等待） |
| `process` | 随便 | 通常要 | 有（自己管） |

```callout
tone: amber
icon: 🔑
tinted: true
text: |
  ==`keyBy` 不产出数据。== 它做的事只有一件：**告诉 Flink「接下来的计算按这个 Key 分开算」**。
  所以 `keyBy` 单独用是看不出任何效果的 —— 它必须跟着 reduce / aggregate / window / process 才有意义。
```

## 04 · 亲手跑一遍：同一批订单，过不同算子

下面 6 条订单，点算子看产出。盯三件事：**输入栏哪几条被划掉了**、**输出栏多了还是少了几行**、**输出到底是一条条记录还是一堆桶**。

```demo
widget: operator-lab
title: 同一批订单，过不同算子
hint: 点一个算子
html: |-
  <div class="ol" data-ol>
    <div class="ol-top">
      <div class="seg" data-ol-modes></div>
    </div>
    <p class="ol-rule tone-blue" data-ol-rule></p>
    <div class="ol-cols">
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-blue">输入</span>
          <span data-ol-inhead>输入 · 6 条订单</span>
        </div>
        <div class="log" data-log="in"></div>
      </div>
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-green">输出</span>
          <span data-ol-outhead>输出</span>
        </div>
        <div class="log" data-log="out"></div>
      </div>
    </div>
    <div class="ol-io tone-muted" data-ol-io></div>
  </div>
```

三个值得注意的地方：

- **`filter` 划掉了两条，但输出还是「记录」**：`1002`（金额 0）和 `1003`（金额 -10）在输入栏被划掉，输出栏干干净净剩 4 条。丢数据是 `filter` 的本职。
- **`flatMap` 让条数变多了**：6 条订单拆成 7 条商品行。而订单 `1006` 一个商品都没有 —— ==它一条也不产出==，这就是 `flatMap` 的「1 → 0」。
- **`keyBy` 的输出不是列表，是三个桶**：6 条进、6 条出，**一条没多一条没少**，但数据被分成了 `u01 / u02 / u03` 三堆。这是全篇最该记住的一张图。

### `keyBy` 到底做了什么

它同时做了三件事，缺一不可：

1. **路由** —— 相同 Key 的数据被送到**同一个并行实例**上。`u01` 的三笔订单一定落在同一个 slot。
2. **开状态** —— 因为路由确定了，Flink 才能按 Key 存状态：`u01` 的累计值存在 `u01` 名下，`u02` 的存在 `u02` 名下，互不干扰。
3. **为后续操作铺路** —— 按 Key 的聚合、窗口、定时器，全都建立在「同一 Key 在同一实例」这个前提上。

上面交互里点 `keyBy + sum`，你会看到 `u01` 那三笔订单各自吐出一行「当前累计」（99 → 89 → 109）。
那不是「最后算出一个数」，而是**每来一条就更新一次**。

### `reduce` 和 `aggregate` 差在哪

两个都是「同一个 Key 的多条数据不断合并成一个结果」，区别在**输入、状态、输出是不是同一个类型**：

```compare
first: 维度
head: [reduce, aggregate]
rows:
  - 输入 / 输出类型:
      - 必须同类型（进来 Order，出去还得是 Order）
      - 可以不同（进来 Order，出去 UserTotal）
  - 中间状态:
      - 就是上一条结果本身
      - 自己定义累加器对象，想放几个字段放几个
  - 适合:
      - 简单的「两条同类型数据合并」，比如求和、取最大值
      - 复杂统计，比如同时算总额 / 笔数 / 均值 / 最大值
  - 例子:
      - "keyBy(uid).sum(amount)"
      - "keyBy(uid).aggregate(new CitySalesAggregate())"
```

```callout
tone: green
icon: ✅
text: |
  判断标准很简单：**如果算到一半的中间结果和最终结果长得不一样，就用 `aggregate`。**
  比如「总额 / 笔数 / 均值 / 最大值」四个指标，中间要同时维护四个数，最终只输出一个对象 ——
  这用 `reduce` 表达起来就很别扭。
```

## 05 · 两个真正难的地方

### 流式 `join`：两条数据不一定同时到

`join` 就是把数据库里那套 `JOIN` 思想搬到流上。但搬过去之后，最大的变化是**时间**：

```text
10:00:01  订单先到    order_id=1001, user_id=u01, amount=99
10:00:03  用户资料后到 user_id=u01, user_name=小明, city=北京
```

数据库里两张表都是完整的，查询那一刻配得上就配上了。流里不是 —— 订单到的时候，用户资料可能还没来。

```compare
first: 维度
head: [数据库里的 JOIN, 流里的 join]
rows:
  - 两边数据的状态:
      - 都在表里躺着，完整且随时可查
      - 各自在流动，谁先到、晚多久都不一定
  - 关联发生在:
      - 查询执行的那一瞬间
      - 数据到达的那一刻，必须当场决定怎么办
  - 「等不到对面」怎么办:
      - 没有「等」这回事，一次算完
      - { text: 要自己决定等多久、等不到怎么算，这才是难点, tone: amber }
  - 靠什么解决:
      - SQL 一条语句
      - 时间窗口 / 维表 join / 广播状态 / temporal join
```

所以「把 10 分钟内能按 `user_id` 配上的订单和用户更新关联起来」这句话里，**「10 分钟内」不是优化，是语义的一部分** ——
它回答了「等不到怎么办」。

### `process`：需要「等一会儿再检查」时

`map` / `filter` / `reduce` 都是「来一条处理一条，处理完就完事」。但有些需求必须**记住过去、并且在未来某个时刻回头看**：

> 某用户下单后 30 分钟仍未支付，就发一条「未支付订单提醒」。

这个需求里有三样东西是前面那些算子给不了的：**状态**（记住这笔订单）、**定时器**（30 分钟后叫我）、**侧输出**（提醒走另一条流）。

```flow
grid: true
nodes:
  - { id: e, label: 收到「创建订单」, sub: "order_id = 1001", row: 0, kind: messagebus, tone: blue }
  - { id: s, label: 存进状态, sub: "keyBy(userId) 的状态里", row: 1, kind: database, tone: violet }
  - { id: t, label: 注册定时器, sub: "30 分钟后触发", row: 1, kind: backend, tone: violet }
  - { id: chk, label: 30 分钟后回头看, sub: "这笔订单支付了吗", row: 2, kind: backend, tone: amber }
  - { id: yes, label: 什么都不做, sub: "状态里已标记已支付", row: 3, tone: green }
  - { id: no, label: 输出未支付提醒, sub: "侧输出流 → 告警系统", row: 3, tone: red }
edges:
  - { from: e, to: s, label: 存下来 }
  - { from: e, to: t, label: 定个闹钟 }
  - { from: s, to: chk, label: 读出状态 }
  - { from: t, to: chk, label: 到点了 }
  - { from: chk, to: yes, label: 已支付 }
  - { from: chk, to: no, label: 未支付 }
```

判断该不该用 `process`，看需求里有没有这两个信号：

```checklist
tone: warn
items:
  - 需求里出现「等 N 分钟 / 等到某个时刻」—— 这是定时器，前面所有算子都没有
  - 需求里出现「之前发生过什么」—— 这是状态，只有 reduce / aggregate / process 有
  - 需求要输出不止一条流（主流 + 告警流）—— 这是侧输出，只有 process 有
```

## 06 · Sink：结果写到哪

```cards
cols: 3
items:
  - { title: Kafka, desc: 清洗后的数据继续交给下游消费，解耦上下游、搭多级实时链路, tag: 继续流转, tone: blue }
  - { title: MySQL / PostgreSQL, desc: 用户画像、运营后台要查的中小规模结果。它不是高吞吐分析库，要配批量写和幂等更新, tag: 给业务查, tone: violet }
  - { title: Elasticsearch, desc: 商品搜索、日志检索。日志清洗后进 ES，再用 Kibana 看板, tag: 搜索, tone: violet }
  - { title: Redis, desc: 要极低延迟读的结果：商品浏览量、库存、购物车数量。接口直读, tag: 毫秒级读, tone: red }
  - { title: ClickHouse / Doris / StarRocks, desc: 高性能分析查询，BI 看板的标配组合, tag: 看板, tone: green }
  - { title: HDFS / Hive / Iceberg / Paimon, desc: 明细长期存储、数据湖、湖仓一体。供 Flink SQL / Spark / Trino 再查, tag: 长期存储, tone: green }
```

```callout
tone: blue
icon: 🎯
text: |
  ==选 Sink 就是选「下游怎么读」==，不是选「哪个技术更厉害」：
  下游要毫秒级点查 → Redis；要 SQL 分析 → ClickHouse；要全文检索 → ES；
  要长期存明细 → 数据湖；要给别人继续加工 → 回到 Kafka。
```

## 07 · 连起来：一个电商实时大盘

需求：大盘每分钟展示订单数量、GMV、各城市销售额、销量 Top 10。

```flow
grid: true
legend: true
nodes:
  - { id: svc, label: 订单服务, sub: "下单 / 支付", row: 0, kind: backend, tone: blue }
  - { id: mq, label: Kafka · order_topic, sub: "订单消息一条条进", row: 1, kind: messagebus }
  - { id: clean, label: map + filter, sub: "JSON → Order，丢掉非法和未支付", row: 2, kind: backend, tone: violet }
  - { id: agg, label: keyBy + 窗口聚合, sub: "按城市 / 商品，每分钟一次", row: 2, kind: backend, tone: violet }
  - { id: ch, label: ClickHouse, sub: "每分钟的聚合结果", row: 3, kind: database, tone: green }
  - { id: bi, label: BI 大盘, sub: "订单量 · GMV · 城市 · Top10", row: 4, kind: frontend, tone: green }
edges:
  - { from: svc, to: mq, label: 写消息 }
  - { from: mq, to: clean, label: Source 消费 }
  - { from: clean, to: agg, label: 清洗后 }
  - { from: agg, to: ch, label: Sink 写入 }
  - { from: ch, to: bi, label: 查询 }
```

写成一行就是：

```text
Kafka → Flink 读取 → 清洗 → 分组 → 窗口聚合 → ClickHouse → 数据大盘
```

对应的代码骨架（伪代码，重点是形状）：

```java
// ① Source：从 Kafka 拿订单 JSON
DataStream<String> jsonStream = readFromKafka("order_topic");

// ② Transformation：解析 → 过滤 → 只留已支付
DataStream<Order> orders = jsonStream
    .map(json -> parseJsonToOrder(json))
    .filter(order -> order.getAmount() > 0)
    .filter(order -> "PAID".equals(order.getStatus()));

// ③ Transformation：按城市分组，每分钟聚合一次
DataStream<CitySales> citySales = orders
    .keyBy(order -> order.getCity())
    .window(TumblingEventTimeWindows.of(Time.minutes(1)))
    .aggregate(new CitySalesAggregate());

// ④ Sink：写 ClickHouse
citySales.sinkTo(clickHouseSink);
```

```summary
title: 一句话总结
text: |
  `Source` 把数据接进来，`Transformation` 按业务规则实时加工，`Sink` 把结果写给下游。
  九个算子只分五类，==而 `keyBy` 是唯一一个「不产出数据」的算子== —— 它的作用是让后续计算按 Key 分开算。
  剩下两个难点，本质上都是**时间**：`join` 要处理「对面还没到」，`process` 要处理「等一会儿再回头看」。
```

## 自测

```quiz
- q: 九个 Transformation 算子能不能按「一条进几条出」分成三类？`keyBy` 属于哪类？
  a: |
    逐条处理的那三个可以：==`map` 是 1 → 1，`filter` 是 1 → 0 或 1，`flatMap` 是 1 → 0 到多条==。
    但 `keyBy` **哪一类都不属于** —— 它不改变条数，也不改变内容，
    它改变的是「后续计算以什么为单位」。所以它单独用看不出任何效果。
- q: 为什么只有 `keyBy` 之后才能算「每个用户的累计消费」？
  a: |
    因为 `keyBy` 把相同 Key 的数据**路由到同一个并行实例**，
    Flink 才能按 Key 保存状态：`u01` 的累计值存在 `u01` 名下，`u02` 的存在 `u02` 名下，互不干扰。
    没有 `keyBy`，就没有「按 Key 的状态」可言。
- q: 流里的 `join` 比数据库里的 `JOIN` 难在哪？
  a: |
    数据库里两张表都是完整的，查询那一刻就配上了。
    流里两条数据各自在动，==订单先到、用户资料可能三秒后才到==。
    所以流式 join 必须自己决定「等多久、等不到怎么算」——
    时间窗口、维表 join、广播状态这些机制，存在的意义就是回答这个问题。
- q: 什么信号说明你该用 `process` 而不是 `map` / `filter` / `reduce`？
  a: |
    需求里出现「**等一段时间再检查**」或者「**要记住之前发生过什么**」的时候。
    比如「下单 30 分钟还没支付就提醒」—— 需要状态（记住这笔订单）、
    定时器（30 分钟后叫我）、侧输出（提醒走另一条流），这三样只有 `process` 给得了。
```
