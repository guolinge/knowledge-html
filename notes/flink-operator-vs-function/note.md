> 这篇回答两个问题：**算子到底是什么**（拆到进程 / 线程 / 内存那一层），以及**上一篇里用过但没解释的那些词**都是什么意思。
>
> 上一篇讲「有哪些算子」，这一篇讲「算子这个东西本身」。

## 01 · 先给结论：算子不是函数

### 先把「lambda」这个词说清

````callout
tone: muted
icon: 📎
text: |
  **lambda 就是「匿名函数」** —— 一段没有名字、直接写在调用点的函数。各语言的写法：

  ```text
  Java    (Order o) -> o.getAmount() > 0
  JS      (o) => o.amount > 0
  Python  lambda o: o.amount > 0        ← Python 直接用了 lambda 这个词
  ```

  平时把它当「一段逻辑」看就够了。但有一件事必须先知道，因为它就是下面整篇的起点：

  ==在 Java 里，lambda 不是一个函数，而是一个**对象**。==
  编译器会把它变成一个实现了某个接口的实例（比如 `FilterFunction<Order>`）。
  所以「把 lambda 传给 `map`」，实际是**把一个对象存进了算子**。

  更关键的是：Flink 的这些函数接口除了 `@FunctionalInterface`，还额外继承了 `Serializable` ——
  ==因为这些对象要被序列化后发到别的机器上去执行==。
  这是普通函数永远不需要的能力，也是「算子 ≠ 函数」的第一道缝。
````

### 逐项对比

把同一个「过滤金额 ≤ 0 的订单」分别写成普通函数和 Flink 算子，逐项对比：

```compare
first: 维度
head: [普通函数, Flink 算子]
rows:
  - 在 Java 里它到底是什么:
      - 一段代码
      - { text: 一个实现了接口、能被序列化的对象, tone: violet }
  - 谁调用谁:
      - 你在代码里调用它
      - { text: 框架调用你 —— 你不调用它, tone: amber }
  - 活多久:
      - 一次调用，返回即结束
      - 一个对象，活到整个 task 结束
  - 生命周期:
      - 没有这个概念
      - "`open` → 处理 N 条 → `snapshotState` → `close`"
  - 状态:
      - 局部变量在栈上，返回就没了
      - 托管状态：住在内存里，能快照、能恢复、能重分配
  - 有几份:
      - 一份代码
      - N 份并行实例（N = 并行度），各持一份状态分片
  - 跑在哪个线程:
      - 调用者的线程
      - task 线程；**链上的几个算子共用一个线程**
  - 之间怎么传数据:
      - 参数压栈 / 进寄存器
      - 同链走方法调用；跨链要序列化 + 走网络
  - 谁看得见它:
      - 编译器
      - 调度器 —— 并行、checkpoint、failover 全拿它当单位
```

```callout
tone: amber
icon: 🔑
tinted: true
text: |
  ==最本质的一条是「谁调用谁」。==

  普通函数：**你**在代码里调用它，调用点长在你的程序里。
  算子：**框架**在循环里调用你，你只是把一段逻辑**注册**进去。

  所以 Flink 代码看起来像在调方法，实际上是在**填一张表格** ——
  表格交上去之后，什么时候执行、在哪个线程执行、执行几份，都不再由你决定。
```

## 02 · 先看清物理图景：机器上到底有什么

抽象的词先放一边。一个跑起来的 Flink 作业，在机器上是这些**具体的东西**：

```tree
- label: 一台机器
  sub: 物理机 / 容器 · 带操作系统
  tone: muted
  note: 下面全是这台机器上真实存在的对象
  children:
    - label: TaskManager
      sub: 一个 JVM 进程
      tone: violet
      note: 进程内存 = JVM Heap + Managed Memory（堆外，Flink 自己管）+ 网络缓冲
      children:
        - label: Slot
          sub: 一份资源凭证
          note: 不是线程，也不是 CPU 核 —— 是「可以放一个 task 进来」的名额
          children:
            - label: Task
              sub: 一个线程 + 一个 StreamTask 对象
              tone: blue
              note: 这个线程由框架建，不由你的代码建
              children:
                - { label: SourceOperator, note: 算子对象 ①，长在这个线程里 }
                - label: StreamMap
                  note: 算子对象 ②，和 ① 共享同一个线程
                - { label: StreamFilter, note: 算子对象 ③，同上 }
                - label: 托管状态
                  sub: ValueState / ListState / MapState
                  tone: green
                  note: 落在堆上、RocksDB 或远端 —— 由状态后端决定
```

对着这张图问三个问题，很多困惑就散了：

```checklist
items:
  - 你的 lambda 在哪？→ 它是 StreamMap 对象里的一个字段，不是独立的东西
  - 状态在哪？→ 挂在算子对象上，但实际存储由「状态后端」决定
  - 线程是谁的？→ 框架的。你的代码只是被它调用的
```

```callout
tone: red
icon: ⚠
text: |
  !!「一个算子一个线程」是错的。!!
  ==一个 **Task** 一个线程，而一个 Task 里通常链了好几个算子。==
  10 个算子如果全都能链在一起，那就只占 1 个线程。
```

## 03 · 八个区别，逐个拆

### 3.1 谁调用谁：控制反转

这是「算子 ≠ 函数」的根，其他区别都是从它派生出来的。

```raw
<div class="stackviz">
  <div class="sv-col tone-blue">
    <h5>普通函数调用</h5>
    <p>栈从你的代码长出来，返回就整摞弹掉</p>
    <div class="sv-stack">
      <div class="sv-frame base">main() <small>你的程序</small></div>
      <div class="sv-frame yours gone">parseOrder(json) <small>你写的函数</small></div>
    </div>
    <div class="sv-note"><b>调用栈是「你」建的。</b>函数返回、栈帧弹出，它存在过的痕迹一点不剩。想跨调用记住点什么，只能自己找地方存。</div>
  </div>
  <div class="sv-col tone-violet">
    <h5>Flink 算子</h5>
    <p>栈底永远是一个框架的循环，它转一圈就调你一次</p>
    <div class="sv-stack">
      <div class="sv-frame base">runMailboxLoop() <small>框架的循环，一直转</small></div>
      <div class="sv-frame">processElement(record) <small>框架调你</small></div>
      <div class="sv-frame yours">record.amount &gt; 0 <small>你写的 lambda</small></div>
    </div>
    <div class="sv-note"><b>调用栈是「框架」建的。</b>你的 lambda 只是循环体里的一行。<mark class="mk-blue">循环不结束，算子就一直活着、一直记着。</mark></div>
  </div>
</div>
```

```compare
first: 写法
head: [看起来, 实际发生]
rows:
  - "`stream.map(f)`":
      - 像在调用一个方法
      - 往图里加了一个 `StreamMap` 节点，`f` 被存进这个 Nodes 对象
  - "`env.execute()`":
      - 像一句收尾
      - { text: 提交作业、建线程、开始消费数据，到这一步 f 才可能被调用, tone: green }
```

### 3.2 生命周期：函数是一次性的，算子要「上电」和「断电」

`StreamOperator` 的完整一生，==按调用顺序==：

```text
算子被创建
   │
   ├── open()              ← 只跑一次。建连接、加载维表、初始化本地缓存
   │
   ├── processElement()    ← 每条数据一次（或每条数据多次，看算子）
   │      …重复 N 次…
   │
   ├── snapshotState()     ← 做 checkpoint 时被调，把状态写出去
   │
   └── close()             ← 结束、失败、取消时都会调，释放资源
```

这一条直接解释了一个高频 bug：**把「建数据库连接」写在 `processElement` 里**，等于每条数据建一次连接。
正确位置是 `open()` —— 它只跑一次。

### 3.3 状态：函数用完就扔，算子得记住

普通函数想把「累计值」留住，只能塞进全局变量或外部存储 —— 那就**脱离了框架的管理**：框架不知道它存在，扩缩容时不会帮你搬，宕机时不会帮你恢复。

算子的做法是**声明**一份托管状态：

```java
public class SumOperator extends KeyedProcessFunction<String, Order, Long> {
    // 声明的不是「变量」，是「算子的一块状态」
    private ValueState<Long> total;

    public void open(Configuration cfg) {
        total = getRuntimeContext().getState(
            new ValueStateDescriptor<>("total", Long.class));
    }

    public void processElement(Order o, Context ctx, Collector<Long> out) throws Exception {
        long next = (total.value() == null ? 0 : total.value()) + o.getAmount();
        total.update(next);        // 写进状态，不是写进普通变量
        out.collect(next);
    }
}
```

==区别在「谁管」：普通变量归 JVM 管，托管状态归 Flink 管。== 归 Flink 管的，才能被快照、被恢复、被重分配。

### 3.4 并行：函数是一份代码，算子是 N 份实例

并行度设为 3，`StreamMap` 就变成 3 个**互相独立的实例**，可能跑在 3 台不同的机器上。

它们**不共享内存** —— 每个实例有自己那份状态分片。所以：

```text
并行度 3 时，u01 的累计值不会「大家一起算」，
而是 u01 全部落到同一个实例上，由它一个人算。
```

这也是上一篇里 `keyBy` 那条哈希规则的由来。

### 3.5 数据怎么在算子之间走：方法调用 vs 序列化 + 网络

这一条是最容易被忽略、但性能差别最大的一条：

```text
算子 A → 算子 B，两者能链在一起（不需要重分区）
    数据传递 = 一次方法调用
    对象引用直接传，零拷贝、零序列化

算子 A → 算子 B，中间必须重分区（比如 keyBy 之后）
    数据传递 = 序列化 → 写进网络缓冲 → 发给另一个进程 → 反序列化
    对象被拆成字节，跨进程重建
```

```callout
tone: violet
icon: ⚡
text: |
  所以「算子链」不是一个美观问题，是**性能问题**：
  它把跨进程的数据传递降级成同线程的方法调用。

  ==反过来说，`keyBy` 是一条硬边界== —— 它必须重分区，链在这里断开，
  数据从这里开始要走网络。这条线上下的算子，代价完全不同。
```

## 04 · 算子这个概念是怎么产生的

从一个最朴素的单机版开始：

```java
// 一个进程，一个循环，一条条处理
while (true) {
    Order o = read();
    if (o.getAmount() <= 0) continue;
    total += o.getAmount();
    write(total);
}
```

这段代码想变成分布式的，得自己解决一长串问题：

```text
数据怎么分给多个进程？       → 分片 + 路由
某个 key 的数据散在两台机器上怎么办？ → 重分区
状态放哪？                    → 内存 / 磁盘 / 外部存储
进程挂了怎么恢复？             → 快照 + 重放
下游处理不过来怎么办？         → 反压
想从 3 并行度改成 5 并行度？    → 状态重新分配
```

```callout
tone: blue
icon: 🧩
tinted: true
text: |
  ==算子就是把「一条数据怎么处理」从这段循环里抽出来，交给框架。==

  你只回答一个问题：**一条数据进来，出去的是什么。**
  剩下的 —— 复制几份、放哪台机器、状态存哪儿、什么时候快照、挂了怎么恢复 ——
  全部由框架按「算子」这个单位来安排。

  所以算子的完整定义是：
  ==**一个可被调度、可被并行复制、可持有托管状态的处理单元。**==
```

## 05 · 一个算子的完整一生

点按钮逐步走一遍，注意每一步**是谁在动**：

```demo
widget: stepper
title: 一个算子从生到死
actions: false
config:
  steps:
    - { label: ① 代码被收集, code: "stream.map(o -> o.getAmount() > 0)", note: "你在客户端写下这行。此时还没有任何算子实例，只是往图里加了条记录" }
    - { label: ② 提交作业, code: "env.execute(\"job\")", note: "图被发到 JobMaster。到这一步为止，都还没有数据被处理" }
    - { label: ③ 建线程和实例, code: "TaskManager 上：\nnew StreamTask()\nnew StreamMap(f)", note: "框架建线程、建算子对象。你的 lambda 现在是这个对象里的一个字段" }
    - { label: ④ open, code: "operator.open()", note: "只跑一次。建连接、加载维表都写在这里 —— 不是 processElement" }
    - { label: ⑤ 循环处理, code: "while (running) {\n  record = input.next()\n  operator.processElement(record)\n}", note: "框架的循环转一圈，你的逻辑被调一次。这一步会重复几百万次" }
    - { label: ⑥ 快照, code: "operator.snapshotState(checkpointId)", note: "checkpoint 触发时被调，把状态写成快照。你的代码一行都不用改" }
    - { label: ⑦ close, code: "operator.close()", note: "正常结束、失败、取消，都会走到这里。连接在这里关" }
```

```callout
tone: green
icon: ✅
text: |
  看完这七步，回头再看「算子不是函数」就很具体了：

  - 第 ③ 步之前，==算子还不存在==（只是图里的一条记录）
  - 第 ④⑤⑥⑦ 步都是**框架在调你**，不是你在调框架
  - 第 ⑤ 步那个循环**属于框架**，你的逻辑只是循环体
```

## 06 · 从代码到进程：四层图

你写的一行 `stream.map(...)`，到机器上真的跑起来，中间经过了四张图：

```flow
grid: true
nodes:
  - { id: sg, label: StreamGraph, sub: "你写的算子拓扑 · 在客户端生成", row: 0, kind: backend, tone: blue }
  - { id: jg, label: JobGraph, sub: "算子链合并成 JobVertex · 仍在客户端", row: 1, kind: backend, tone: violet }
  - { id: eg, label: ExecutionGraph, sub: "加上并行度 · 提交后在 JobMaster 生成", row: 2, kind: backend, tone: violet }
  - { id: phy, label: 物理执行图, sub: "哪个 subtask 落在哪台机器的哪个线程", row: 3, kind: cloud, tone: green }
edges:
  - { from: sg, to: jg, label: 优化：算子链 }
  - { from: jg, to: eg, label: 提交后加并行度 }
  - { from: eg, to: phy, label: 调度 }
```

```compare
first: 图
head: [一个节点代表什么, 在哪生成]
rows:
  - StreamGraph:
      - 一个**算子**（你代码里的 map / filter / keyBy）
      - 客户端
  - JobGraph:
      - 一个 **JobVertex** —— ==可能包含好几个算子==（被链在一起的）
      - 客户端
  - ExecutionGraph:
      - 一个 **ExecutionVertex** —— 即一个 subtask
      - JobMaster
  - 物理执行图:
      - 不是数据结构；就是实际跑在哪些机器/线程上
      - 运行时
```

==上一节说的「Task 常常不是算子，而是一串算子」，就发生在 StreamGraph → JobGraph 这一步。==

## 07 · 文中用过但没解释的词，一次讲完

```cards
cols: 2
items:
  - title: DataStream 和执行环境
    tag: 你写的代码在哪一层
    tone: blue
    body: |
      你在代码里一直在操作两个对象：

      - `env`：执行环境，作业的「配置句柄」
      - `DataStream`：一条**逻辑上的**数据流，不是真实的数据集合

      `stream.map(...)` 返回的还是 DataStream —— ==它只是一张图上的一个节点，里面没有一条数据。==

      真正开始跑是在最后那一下：`env.execute()`。
    code: |
      StreamExecutionEnvironment env = ...;
      DataStream<String> raw = env.fromSource(kafka);
      DataStream<Order> orders = raw.map(parse);
      env.execute("order-job");   // ← 到这才真的开始
  - title: 事件时间、处理时间、水印
    tag: 流里「时间」不是时间
    tone: violet
    body: |
      同一个事件，其实有三个时间：

      - **事件时间**：事情**发生**的时刻（订单系统写下的 `event_time`）
      - **处理时间**：Flink **处理**它的时刻
      - 摄取时间：Flink **读到**它的时刻

      它们能差很远 —— 网络抖动、Kafka 堆积、上游重放，都会让一条 10:00 的数据在 10:05 才被处理。

      **水印（Watermark）**是一根「我认为早于这个时刻的数据都到齐了」的线。它让 Flink 能在乱序流上判定「这个窗口可以结算了」。
    code: |
      // 用 event_time 当时间，容忍 5 秒乱序
      WatermarkStrategy
        .<Order>forBoundedOutOfOrderness(Duration.ofSeconds(5))
        .withTimestampAssigner((o, ts) -> o.getEventTime());
  - title: 窗口
    tag: 无界流怎么切出结果
    tone: green
    body: |
      无界流没有「全部到齐」的时刻，所以不能等。做法是**按时间切段**，每段单独结算。

      - **滚动窗口**：首尾相接，不重叠（每 1 分钟）
      - **滑动窗口**：有重叠（每 1 分钟统计最近 5 分钟）
      - **会话窗口**：按「多久没数据」切

      ==窗口关闭时输出结果；而最后一个窗口永远等不到关闭。==
    code: |
      orders.keyBy(o -> o.getCity())
            .window(TumblingEventTimeWindows.of(
                Time.minutes(1)))
  - title: 托管状态与状态后端
    tag: 状态住在哪
    tone: amber
    body: |
      状态是**逻辑概念**，状态后端是**物理存放位置**。同一个算子，换个后端就换了个存法：

      | 后端 | 状态存在哪 |
      |---|---|
      | `HashMapStateBackend` | JVM 堆上的 Java 对象 |
      | `RocksDBStateBackend` | TaskManager 本地磁盘，容量只受磁盘限制 |
      | 分离式（ForSt） | 远端存储（HDFS/S3），本地只留缓存 |

      状态大到堆里放不下时，就要换 RocksDB —— 这是选型时最先要问的问题。
    code: |
      env.setStateBackend(new RocksDBStateBackend("hdfs://..."));
  - title: Checkpoint
    tag: 状态怎么被保存和恢复
    tone: green
    body: |
      定期给所有算子的状态拍一次快照，写到可靠存储里。

      恢复时做两件事：

      1. **从最近一次 Checkpoint 把状态读回来**
      2. **从 Kafka 对应位点重新消费**

      两件事对上，就能做到**不丢不重**（Exactly-Once）。

      ==前提是「状态必须是托管的」。== 自己塞在 `static` 变量里的东西，快照拍不到。
    code: |
      env.enableCheckpointing(60_000);       // 每分钟一次
      env.getCheckpointConfig()
         .setCheckpointingMode(EXACTLY_ONCE);
  - title: 背压
    tag: 下游慢了会怎样
    tone: red
    body: |
      下游处理不过来，数据就会堆在中间。Flink 不丢数据 —— 它把压力**向上游传回去**：

      ```text
      Sink 慢 → 上游算子慢 → Source 减速
      ```

      所以看到「Source 出现背压告警」，问题几乎总在**下游**，不在 Source。看背压要从下游往上游查。

      底层是三层缓冲在顶：TaskManager 网络缓冲 → Netty 缓冲 → Socket 缓冲。
    code: |
      # 三个指标之和约等于 1000ms
      busyTimeMsPerSecond
      idleTimeMsPerSecond
      backPressuredTimeMsPerSecond
```

## 08 · 一张表收尾

```compare
first: 词
head: [一句话, 它属于哪一层]
rows:
  - 函数:
      - 你调用它，返回就结束
      - 语言层
  - 算子 Operator:
      - 处理逻辑的**声明**，还没有实例
      - 逻辑图（StreamGraph）
  - Subtask:
      - 算子的一个并行实例，各持一份状态
      - 运行时的对象
  - Task:
      - 一个线程 + 一串链起来的算子
      - 执行单元
  - TaskManager:
      - 一个 JVM 进程
      - 进程
  - Slot:
      - 进程里的一份资源名额
      - 资源
  - 托管状态:
      - 归 Flink 管的状态，能快照能恢复
      - 内存 / 磁盘 / 远端
```

```summary
title: 一句话总结
text: |
  `Flink` 算子不是函数，而是==**一个可被调度、可并行复制、可持有托管状态的处理单元**==。
  你写的 lambda 只是这个对象里的一个字段 —— **是框架在循环里调你，不是你在调用它**。
  想清楚这一点，「为什么要有算子链」「为什么状态必须是托管的」「为什么 keyBy 之后要走网络」就都是同一件事的不同侧面。
```

## 自测

```quiz
- q: 你写下 `stream.map(o -> o.getAmount() > 0)` 这一行，然后「挂上」Kafka 的 Source。此时这个 lambda 被执行了吗？
  a: |
    没有。这一行只是往**图里加了一个节点**，lambda 被存成一个字段；
    Kafka 也还没被消费。真正开始跑是在 `env.execute()` —— 到那一步框架才建线程、
    建算子实例、开始拉数据。==写代码 ≠ 跑代码==，这也正是「算子不是函数」的第一层含义。
- q: 为什么「一个算子一个线程」是错的？
  a: |
    因为线程的单位是 **Task**，而一个 Task 里通常链了好几个算子。
    链上的算子==在同一个线程里同步顺序调用== —— 这也是算子链的价值：
    把跨进程的数据传递降级成同线程的方法调用，省掉序列化和网络。
    10 个算子如果全能链在一起，只占 1 个线程。
- q: 把「建数据库连接」写在 `processElement` 里会怎样？应该写在哪？
  a: |
    会==每条数据建一次连接==。`processElement` 是每条记录调一次的，
    而 `open()` 才是算子初始化时**只跑一次**的地方，连接、维表加载都放那儿。
    这题的通用版是：**先问这个回调被调几次**，再决定把什么写进去。
```
