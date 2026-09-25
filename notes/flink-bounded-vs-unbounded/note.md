> 「无界」说的不是数据量大到装不下，而是 ==你不知道它什么时候结束==。这一条想通了，窗口、批流一体这些词就都顺了。

## 01 · 先看一条订单流

一笔订单落库的瞬间，往往会同时变成一条消息，推到 Kafka 这类消息队列里：

```json
{"order_id":"1001","user_id":"u01","amount":99.0,"event_time":"2026-09-23 10:00:01"}
{"order_id":"1002","user_id":"u02","amount":50.0,"event_time":"2026-09-23 10:00:03"}
```

把 `event_time` 摊开，它们就是两件刚刚发生的事：

```text
10:00:01  用户 u01 下了一笔  99 元的订单
10:00:03  用户 u02 下了一笔  50 元的订单
10:00:05  用户 u03 下了一笔 120 元的订单
10:00:08  用户 u01 下了一笔  20 元的订单
……
```

只要电商业务还在跑，这一列就会一直往下长。Flink 处理的基本对象就是它。

```callout
tone: blue
icon: 🌊
tinted: true
text: |
  所以 ==流不是「某一条数据」，而是一连串按时间到达的数据==。
  「处理流」不是处理一条记录，是**让一个程序一直坐在那里接数据**。
```

## 02 · 两种形状：有末尾，和没有末尾

```raw
<div class="streamshape">
  <div class="ss-row">
    <div class="ss-side">
      <b>无界流</b>
      <span class="tag tone-blue">Unbounded</span>
      <small>不知道什么时候结束</small>
    </div>
    <div class="ss-track tone-blue">
      <i class="ss-ev tone-blue">10:00:01</i>
      <i class="ss-ev tone-blue">10:00:03</i>
      <i class="ss-ev tone-blue">10:00:05</i>
      <i class="ss-ev tone-blue">10:00:08</i>
      <i class="ss-ev ss-tail tone-blue">⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯</i>
      <span class="ss-open tone-blue">没有「最后一条」</span>
    </div>
  </div>
  <div class="ss-row">
    <div class="ss-side">
      <b>有界流</b>
      <span class="tag tone-green">Bounded</span>
      <small>有明确的开始和结束</small>
    </div>
    <div class="ss-track tone-green">
      <i class="ss-ev tone-green">第 1 条</i>
      <i class="ss-ev tone-green">第 2 条</i>
      <i class="ss-ev tone-green">第 3 条</i>
      <i class="ss-ev ss-gap">⋯⋯</i>
      <i class="ss-ev tone-green">第 100 万条</i>
      <span class="ss-cap tone-green"><span>文件末尾</span></span>
    </div>
  </div>
</div>
```

无界的例子：Kafka 里的订单消息、埋点、服务器日志、IoT 上报、MySQL 的 CDC 变更记录、股票价格。

有界的例子：一个 CSV 文件、某天导出的订单表、`SELECT * FROM orders WHERE create_date = '2026-09-23'` 的结果。

!!「无界」不是「数据量大到机器装不下」。!!

```callout
tone: amber
icon: 🔑
text: |
  一个一天只有 100 条消息的 Kafka topic 也是无界流 —— 它很小，但它没有最后一条。
  一个 100 万行的 CSV 文件是有界流 —— 它很大，但它读得完。
  ==判断依据是「有没有末尾」，不是「有多少条」。==
```

## 03 · 亲手跑一遍：同一条流，三种跑法

下面这 12 条订单，三种跑法用的是**同一份数据、同一段业务逻辑**。切换跑法，盯着两个地方看：**输出栏什么时候出东西**，以及**任务最后停不停**。

```demo
widget: stream-modes
title: 同一条订单流，三种跑法
hint: 选一种跑法，看输出栏
html: |-
  <div class="sm" data-sm>
    <div class="sm-top">
      <div class="seg" data-sm-modes></div>
    </div>
    <p class="seg-rule tone-green" data-sm-rule></p>
    <div class="sm-cols">
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-blue">输入</span>事件流
          <span class="sub" data-sm-count>0 / 12 条</span>
        </div>
        <div class="log" data-log="in"></div>
      </div>
      <div class="pane">
        <div class="pane-head">
          <span class="tag tone-green">输出</span>Flink 吐出来的结果
        </div>
        <div class="log" data-log="out"></div>
      </div>
    </div>
    <div class="sm-task tone-muted" data-sm-task></div>
  </div>
```

三个值得注意的地方：

- **有界跑法**：输入栏一直在涨，==输出栏全程是空的==，直到最后才吐出一行 `总销售额 = 978 元`，然后任务结束。批处理就是这样 —— 中间不出结果。
- **持续累计**：每来一条就更新一次「当前累计」。它永远给不出一个「最终答案」，因为后面还会有新订单。
- **每分钟窗口**：窗口关闭才结算，所以 `10:02` 那个窗口的结果只能一直攒着 —— ==它要等 `10:03` 的第一条数据到来才会关闭==。

## 04 · 怎么产出结果：窗口，和一次算完

### 无界流：把永不结束的流切成窗口

无界流没有「全部数据到齐」这个时刻，所以不能等。做法是**按时间切段**，每段单独结算：

```raw
<div class="streamshape winsplit">
  <div class="ws-stream">
    <span>无界流 · 事件一直在来</span>
    <span class="ws-arrow">———————————▶</span>
  </div>
  <div class="ws-grid">
    <div class="ws-col">
      <div class="ws-seg tone-blue">
        <b>10:00 窗口</b>
        <span>6 笔 · 443 元</span>
      </div>
      <div class="ws-res tone-green"><b>窗口关闭</b> → 输出一个结果</div>
    </div>
    <div class="ws-col">
      <div class="ws-seg tone-blue">
        <b>10:01 窗口</b>
        <span>4 笔 · 425 元</span>
      </div>
      <div class="ws-res tone-green"><b>窗口关闭</b> → 输出一个结果</div>
    </div>
    <div class="ws-col">
      <div class="ws-seg open tone-amber">
        <b>10:02 窗口</b>
        <span>2 笔 · 110 元</span>
      </div>
      <div class="ws-res open tone-amber"><b>窗口还开着</b> → 结果只能攒着</div>
    </div>
  </div>
</div>
```

!!最后一个窗口永远等不到关闭 —— 因为流不结束。!!

这就是「实时」的真实含义：不是「立刻算出全量」，而是**新数据来了就处理，处理完就更新统计、告警或推荐**。

### 有界流：全部读完，给一个最终答案

数据是固定的，所以可以直接从头算到尾：

```text
读取整份历史数据 → 清洗 → 按城市分组 → 求和 → 输出报表 → 任务结束
```

```compare
first: 城市
head: [销售额]
rows:
  - 北京: ["120 万"]
  - 上海: ["98 万"]
  - 广州: ["75 万"]
```

这种任务不追求「每来一条就出结果」，它在意的是另外几件事：

```checklist
items:
  - 全部数据是否都读到了（有没有漏文件、漏分区）
  - 最终结果是否正确（能反复重跑、对得上账）
  - 成本是否可控（跑一次要多少机器、多少时间）
  - 能不能在要求的时间内跑完
```

## 05 · 同一套逻辑，两种跑法

这是 Flink 最值得记的一点：==有界和无界不是两套 API，是同一个程序接不同的源==。

```flow
grid: true
nodes:
  - { id: f, label: 历史文件, sub: "orders_2026-09-23.csv", row: 0, kind: database, tone: green }
  - { id: k, label: Kafka 订单消息, sub: "一条条实时到达", row: 0, kind: messagebus, tone: blue }
  - { id: logic, label: 同一段业务逻辑, sub: "过滤 → 按城市分组 → 求和", row: 1, kind: backend, tone: violet }
  - { id: r1, label: 一份最终报表, sub: "任务结束", row: 2, tone: green }
  - { id: r2, label: 持续更新的结果, sub: "任务继续跑", row: 2, tone: blue }
edges:
  - { from: f, to: logic, label: 有界 }
  - { from: k, to: logic, label: 无界 }
  - { from: logic, to: r1, label: 读完就停 }
  - { from: logic, to: r2, label: 一直跑 }
```

真正不同的只有两处：**数据源**，和**任务什么时候结束**。

```callout
tone: green
icon: ✅
text: |
  上面那个交互里，三种跑法读的是同一份 `EVENTS`，算的是同一个 `sum(amount)`。
  变的只是「源有没有末尾」和「结果什么时候往外吐」。
```

## 06 · 用前端的方式类比

如果你写过前端，这两种东西你其实都碰过：

```cards
cols: 2
items:
  - title: 有界流 ≈ 一个固定数组
    tag: array.reduce
    tone: green
    desc: 数组就摆在那里，遍历完就结束，算出来的值是最终值。
    code: |
      const orders = [{amount:99},{amount:50},{amount:120}];
      const total = orders.reduce((s,o) => s + o.amount, 0);
      console.log(total);   // 269 —— 不会变了
  - title: 无界流 ≈ 一直开着的 WebSocket
    tag: socket.onmessage
    tone: blue
    desc: 你不知道还会来多少条，连接可能一直挂着；每来一条就更新一次。
    code: |
      let total = 0;
      socket.onmessage = (e) => {
        total += JSON.parse(e.data).amount;
        console.log('当前累计：', total);   // 一直在变
      };
```

`reduce` 跑完就是跑完了 —— 这是有界。`onmessage` 你永远不知道下一次触发是什么时候 —— 这是无界。

## 07 · 一张表收尾

```compare
first: 维度
head: [有界流 Bounded, 无界流 Unbounded]
rows:
  - 数据什么时候结束:
      - { text: 有明确末尾, tone: green }
      - { text: 不知道，或者根本不会, tone: blue }
  - 数据来源:
      - 文件、某天的导出表、一次固定查询的结果
      - Kafka、埋点、服务器日志、CDC 变更、IoT 上报
  - 程序什么时候退出:
      - { text: 处理完就退出, tone: green }
      - { text: 通常一直挂着, tone: blue }
  - 产出什么:
      - 一个最终结果，不会再变
      - 不断被更新的结果
  - 怎么算:
      - 全部读完再一次算
      - 按窗口切段，每段出一个结果
  - 典型场景:
      - 离线报表、历史数据重算
      - 实时大盘、告警、风控、实时同步
```

```summary
title: 一句话总结
text: |
  `Flink` 不把数据看成一张静态的表，而是看成一串按时间到来的事件。
  ==有界流有末尾，读完给一个最终答案；无界流没有末尾，只能持续更新结果。==
  而这两者可以用同一段业务逻辑去算 —— 不同的只是**源**，和**任务什么时候停**。
```

## 自测

```quiz
- q: 「无界流」是不是指数据量大到装不下？
  a: |
    不是。==无界指的是「不知道它什么时候结束，或者它本来就不会结束」。==
    一天只有 100 条消息的 Kafka topic 也是无界流 —— 它很小，但它没有最后一条；
    一个 100 万行的 CSV 文件是有界流 —— 它很大，但它读得完。
    判断依据是**有没有末尾**，不是**有多少条**。
- q: 为什么无界流不能等「所有数据都到齐」再算？
  a: |
    因为不存在「到齐」这个时刻。程序只能一边收一边算，
    用**窗口**把永不结束的流切成小段（每分钟 / 每 5 分钟），
    每段关闭时输出一个结果 —— 而最后一个窗口永远等不到关闭。
- q: 有界流和无界流，业务逻辑要写两套吗？
  a: |
    不用。同一段「读取 → 过滤 → 按城市分组 → 求和」在两种源上都能跑，
    真正不同的只有两处：**数据源**，和**任务什么时候结束**。
    这就是 Flink 强调「批流一体」的意思。
```
