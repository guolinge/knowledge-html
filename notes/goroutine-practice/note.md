## 01 · 选型只看两个变量

一个任务值不值得为 G 付费，看**等待比例**（等 I/O 的时间占比）和**单任务计算量**。选这两个，是因为它们正好对应 G 的两个能力边界：等待能不能被 netpoller 吸收，以及并行度需求是多少。

```matrix
x: { label: 等待比例, from: 低等待, to: 高等待 }
y: { label: 单任务计算量, from: 小计算, to: 大计算 }
cells:
  - { title: 先并行化计算, desc: "批处理、报表。G 的并发帮不上忙，先把计算拆开再说", tone: amber }
  - { title: 直接 goroutine, desc: "流水线、扇出扇入。每任务一条 G，这是 G 的主场", tone: green }
  - { title: 连 G 都省了, desc: "低等待小计算：直接同步执行，开 G 只多一份开销", tone: muted }
  - { title: 有界 worker 池, desc: "网络服务、每请求一条 G。等待被 netpoller 吸收", tone: blue }
```

两个变量都会漂移 —— 等待比例随负载和下游延迟变化，计算量随数据规模变化。所以这张表是**对话框架，不是一次性答案**。

`G` 的主场是「高等待 + 小计算」那一格：等待被 netpoller 吸收，M 全程在干别的。反过来，**CPU 密集任务里 G 帮不上忙**：

```demo
widget: tuner
title: CPU 密集任务：G 数超过核数之后，吞吐反而往下掉
actions: false
hint: 拖动滑块换 G 的数量
config:
  param: { label: 并发执行流的数量, unit: 条, values: [1, 2, 4, 8, 16, 32, 64] }
  outputs:
    - { label: 相对吞吐（8 核）, unit: "", values: [12, 25, 50, 100, 92, 78, 61], tone: red }
```

```go
// 反例：CPU 密集任务无限开 G。十万个 G 抢 8 个核，
// 切换与缓存还债吃掉大量有效时间
for _, job := range jobs {
    go compute(job)
}

// 正例：worker 数贴住核数。并行度决定执行流数量，
// 多余的任务在队列里等，不参与抢核
for w := 0; w < runtime.NumCPU(); w++ {
    go worker(jobCh)
}
```

把「G 太多反而慢」落到缓存机制上：每个被换上的 G 都要把自己的工作集拉回 L1，被换下的则被逐出。**切换频率超过工作集复用窗口时，CPU 的有效时间大量花在缓存搬进搬出上。** 算力由核数决定，G 只决定有多少条执行流来分这块算力 —— 分的人太多，切来切去的开销反而把总吞吐往下拖。

### 扇出扇入：最典型的 G 拓扑

```flow
grid: true
groups:
  - { id: topo, label: "并发骨架画在 channel 拓扑上 —— 这就是「用通信共享内存」的直观形态", tone: violet }
nodes:
  - { id: src, label: "任务源", sub: "一个 G 读任务", row: 0, tone: blue, group: topo }
  - { id: ch0, label: "ch0", sub: "分发", row: 1, tone: muted, group: topo }
  - { id: w1, label: "worker", sub: "并行处理", row: 2, tone: green, group: topo }
  - { id: w2, label: "worker", sub: "并行处理", row: 2, tone: green, group: topo }
  - { id: w3, label: "worker", sub: "并行处理", row: 2, tone: green, group: topo }
  - { id: agg, label: "汇总器", sub: "一个 G 收结果", row: 3, tone: violet, group: topo }
edges:
  - { from: src, to: ch0, label: "扇出：一个发多个收" }
  - { from: ch0, to: w1, label: "" }
  - { from: ch0, to: w2, label: "" }
  - { from: ch0, to: w3, label: "" }
  - { from: w1, to: agg, label: "扇入：多个发一个收" }
  - { from: w2, to: agg, label: "" }
  - { from: w3, to: agg, label: "" }
```

每一级 channel 都要回答三个问题：**谁发、谁收、谁关。** 回答不上来，就是下面那一节的泄漏。

---

## 02 · 泄漏：轻量不等于没有生命周期成本

官方定义很严格：**「一个 goroutine 被阻塞，且解除阻塞所需的条件永远无法满足」**。

关键词是「永远」：暂时等得久的 G 不是泄漏，条件永不到达的才是。

```compare
first: 现象
head: [是什么, 怎么查]
rows:
  - 泄漏: ["卡住且永不恢复", "看 G 数是不是单调上涨"]
  - 死锁: ["互相等对方", "看等待环"]
  - 饥饿: ["等得到，但排不上", "看等待时间的分布"]
```

三者共享「阻塞」的表象，但查法完全不同。**泄漏的代价是三重**：G 的栈内存、G 引用着不肯放手的对象、GC 每轮还要扫描它们。

### 原型：一个早退的父 G

```flow
grid: true
groups:
  - { id: leak, label: "无缓冲 channel：发送必须有接收者在场", tone: red }
nodes:
  - { id: dad, label: "父 G", sub: "收到一个 error，直接 return", row: 0, tone: red, group: leak }
  - { id: w2, label: "worker2", sub: "ch <- result2", row: 1, tone: red, group: leak }
  - { id: w3, label: "worker3", sub: "ch <- result3", row: 1, tone: red, group: leak }
  - { id: stuck, label: "永远等不到接收者", sub: "卡死在发送语句上", row: 2, tone: red, group: leak }
  - { id: fossil, label: "变成化石", sub: "连同它引用的中间数据一起，GC 每轮还要扫一遍", row: 3, tone: red, group: leak }
edges:
  - { from: dad, to: w2, label: "人走了" }
  - { from: w2, to: stuck, label: "发不出去" }
  - { from: w3, to: stuck, label: "也发不出去" }
  - { from: stuck, to: fossil, label: "内存 + CPU 双重账单" }
```

修复有两条，第二条更通用：

```flow
grid: true
groups:
  - { id: fix, label: "两条修复路径", tone: green }
nodes:
  - { id: f1, label: "修一：缓冲匹配 worker 数", sub: "make(chan result, len(queries))", row: 0, tone: green, group: fix }
  - { id: f1w, label: "发送不再需要接收者在场", sub: "结果先落地，worker 发完就走", row: 1, tone: green, group: fix }
  - { id: f2, label: "修二：用 context 把「不再需要」通知出去", sub: "select { case ch <- r: case <-ctx.Done(): return }", row: 2, tone: violet, group: fix }
  - { id: f2w, label: "任何深度、任何分支都能收到", sub: "不靠 channel 巧合，靠显式广播", row: 3, tone: violet, group: fix }
edges:
  - { from: f1, to: f1w, label: "针对这一种形态" }
  - { from: f1w, to: f2, label: "但它只在「接收者缺席」时成立" }
  - { from: f2, to: f2w, label: "更通用" }
```

```flow
grid: true
groups:
  - { id: bcast, label: "context 取消：一次广播，所有 worker 收敛", tone: violet }
nodes:
  - { id: cancel, label: "父 G 调 cancel()", sub: "一次调用", row: 0, tone: violet, group: bcast }
  - { id: w1, label: "worker1 收到 ctx.Done()", sub: "return", row: 1, tone: green, group: bcast }
  - { id: w2, label: "worker2 收到 ctx.Done()", sub: "return", row: 1, tone: green, group: bcast }
  - { id: w3, label: "worker3 收到 ctx.Done()", sub: "return", row: 1, tone: green, group: bcast }
  - { id: free, label: "全部退出，引用释放", sub: "G 正常结束，不是泄漏", row: 2, tone: green, group: bcast }
edges:
  - { from: cancel, to: w1, label: "广播" }
  - { from: cancel, to: w2, label: "" }
  - { from: cancel, to: w3, label: "" }
  - { from: w1, to: free, label: "" }
  - { from: w2, to: free, label: "" }
  - { from: w3, to: free, label: "" }
```

### 另外三类，以及一个共性

```compare
first: 类型
head: [长什么样, 修复]
rows:
  - timeout 分支获胜: ["select 里 ctx.Done() 先赢，发送永远没有接收者", "channel 改成缓冲 1：让发送先落地，再被遗弃"]
  - range 一个永不关闭的 channel: ["range 循环永远阻塞在等下一个值", "明确所有权：发送方负责 close，接收方 range 加退出条件"]
  - 同步原语失约: ["忘了 Unlock 的 mutex、忘了 Done 的 WaitGroup、忘了 cancel 的 context", "锁用 defer 释放；Wait 放循环外"]
```

真实世界的案例都是第三类：CockroachDB 在 break 前漏了 Unlock，etcd 的 channel 操作顺序竞态让 `Status()` 永久阻塞，Kubernetes 把 `WaitGroup.Wait` 误写进循环体。

==所有四类的共性是同一个：发送方的「结束条件」依赖了接收方会不会出现。==

```callout
tone: red
icon: 💧
text: |
  **长期服务里，泄漏的典型表现是 G 数平缓单调上涨** —— 每次异常路径漏一个，一天漏几万。

  数量级给个直觉：一个每请求泄漏一个 G 的服务，QPS 一千，**一天就是八千六百万个**。
  再轻的 G 也扛不住线性堆积。

  ++泄漏的根因不是 G 本身，而是所有权不明 —— 没人声明这个 G 由谁等、等多久、等不到怎么办。++
```

修复原则四条：**缓冲容量匹配消费者缺口**（而不是默认无缓冲）、**取消信号沿 context 传播**、**close 责任单点化**、**结构化等待**（Wait 放循环外、锁用 defer 释放）。

---

## 03 · 一批随版本过期的「常识」

```timeline
- when: Go 1.14
  title: 紧循环不再饿死调度器
  desc: 异步抢占兜底。之前 for { i++ } 能把 P 占死
  tone: blue
- when: Go 1.22
  title: 闭包共享循环变量的坑被填平
  desc: 每轮迭代新建变量。之前 go func(){ fmt.Println(v) }() 会打出 c,c,c
  tone: green
- when: Go 1.25
  title: GOMAXPROCS 默认感知 cgroup
  desc: 之前默认取宿主机核数，容器限 4 核却配出 64 个 P，触发 CFS 节流
  tone: amber
- when: Go 1.27
  title: 内置 goroutine 泄漏检测器
  desc: 但只覆盖 channel 与 sync 原语上的阻塞，文件/网络 I/O 与自旋不检测
  tone: violet
```

版本表的读法**按角色对号入座**，比按时间顺序背版本有效：

```compare
first: 你是谁
head: [最该关心, 为什么]
rows:
  - 写并发库的人: ["Go 1.14", "紧循环能不能被抢占，直接关系到库的公平性"]
  - 写闭包的人: ["Go 1.22", "循环变量捕获的语义变了，旧写法在新版本上含义不同"]
  - 容器部署者: ["Go 1.25", "GOMAXPROCS 算错会直接把延迟打抖"]
  - SRE: ["Go 1.27", "泄漏检测器能查到什么、查不到什么，决定你还需不需要 goleak"]
```

调试入口按**现象**分工，不要一把抓：

```tree
- label: 先看现象，再挑工具
  note: 数据竞争、死锁、泄漏是三类问题，别混成一种去查
  children:
    - label: 偶发错误结果
      sub: 数据竞争
      note: 工具是 go run -race
      children:
        - { label: "边界：只覆盖执行过的路径", note: "没跑到的那条分支里的竞争，它看不见" }
    - label: G 数单调上涨
      sub: 泄漏
      note: goroutine profile、goleak、synctest、1.27 内置 profiler
      children:
        - { label: "边界：1.27 那个只认 channel 与 sync 阻塞", note: "文件、网络 I/O 与自旋不检测" }
    - label: 卡死不前进
      sub: 死锁或饥饿
      note: goroutine profile 看阻塞栈
      children:
        - { label: "边界：需要现场触发", note: "复现不了就很难抓到" }
    - label: 慢
      sub: 调度与等待
      note: execution trace、block profile
      children:
        - { label: "边界：解读成本高", note: "trace 的信息量大，要有明确假设再去读" }
```

使用顺序的直觉：**先用 `-race` 排除数据竞争 → 再看 goroutine profile 数 G 和看栈 → 最后用 trace 理解时间线。**

---

```quiz
- q: 一个任务该不该开 goroutine，看哪两个变量？
  a: |
    等待比例和单任务计算量。这两个正好对应 G 的两个能力边界：
    等待能不能被 netpoller 吸收，以及并行度需求是多少。
    高等待 + 小计算是 G 的主场；低等待 + 大计算时 G 帮不上忙，
    该用贴住核数的有界 worker 池。两个变量都会漂移，所以这是对话框架而不是标准答案。
- q: goroutine 泄漏的根因是什么？为什么说「轻量不代表没有生命周期成本」？
  a: |
    根因是所有权不明 —— 没人声明这个 goroutine 由谁等、等多久、等不到怎么办。
    四类泄漏（父流程早退、timeout 分支获胜、range 永不关闭的 channel、同步原语失约）
    的共性是同一个：发送方的结束条件依赖了接收方会不会出现。
    单个 G 轻，但一个每请求漏一个、QPS 一千的服务一天就漏八千六百万个，
    再轻也扛不住线性堆积 —— 轻量改变的是单个成本，不是生命周期纪律。
- q: 为什么 CPU 密集任务里开更多 goroutine 反而更慢？
  a: |
    因为算力由核数决定，G 只决定有多少条执行流来分这块算力。
    超过并行度之后，调度器白白切来切去：每个被换上的 G 要把工作集拉回 L1，
    被换下的被逐出；切换频率超过工作集复用窗口时，
    CPU 的有效时间大量花在缓存搬进搬出上，吞吐不升反降。
```
