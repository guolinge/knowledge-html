## 01 · 它只是把线程的执行流那一半拆出来了

官方 FAQ 的原话是最好的定义：

> goroutine 的核心想法，是把独立执行的函数 —— 协程 —— **多路复用**到一组线程上。当某个协程阻塞时，运行时自动把同一 OS 线程上的其他协程搬到另一个可运行的线程。**程序员完全看不到这些，这正是重点。**

拆出三个关键词：独立执行的函数、多路复用、程序员看不到。它替代的是线程「承担执行流」的那一半职责，**不是**进程「承担隔离」的职责。

```lane-stack
- badge: 硬件
  title: CPU 核
  desc: 它看见的只有线程
  tone: muted
  nodes:
    - { title: 不知道进程是什么, sub: "更不知道 G 是什么" }
    - { title: 谁上核由内核决定, sub: "Go 在这一层说不上话" }
  next: "往上 :: :: 内核这一层"
- badge: OS 内核
  title: 只认识两样东西
  desc: 进程与线程
  tone: violet
  group: 操作系统管的
  nodes:
    - { title: 进程, sub: "页表 = 隔离边界", tag: 资源容器 }
    - { title: 线程, sub: "内核可见的执行实体", tag: 调度单位 }
    - { title: Goroutine, sub: "完全不在它的视野里", tag: 不认识, tone: red }
  next: "再往上 :: :: 换一个视角"
- badge: 进程
  title: 资源容器
  desc: 地址空间、FD、权限
  tone: amber
  group: 操作系统管的
  nodes:
    - { title: 页表把这一圈围起来, sub: "外面的东西碰不到里面" }
    - { title: 线程共享这里的一切, sub: "共享的代价是数据竞争自己扛" }
  next: "进到进程内部 :: :: 这里的调度者换了人"
- badge: Go runtime
  title: 看见 G、P、M
  desc: 但它指挥不动 CPU
  tone: green
  group: Go 自己管的
  nodes:
    - { title: P 决定谁能跑 Go 代码, sub: "「运行 Go 代码的许可」", tag: 许可 }
    - { title: M 怎么上核, sub: "仍然归内核管", tag: 管不着, tone: muted }
  next: "再往下 :: :: 最下面这层只有它看得见"
- badge: Goroutine
  title: 逻辑执行流
  desc: 只被 runtime 看见
  tone: blue
  group: Go 自己管的
  nodes:
    - { title: 没有公开的 ID, sub: "匿名的工人" }
    - { title: 上下文只有两个值, sub: "栈指针 + 指向 g 结构的指针", tag: 所以便宜 }
```

它的生命周期，和线程的「阻塞 / 就绪 / 运行」完全同构。==唯一变化的是调度者：线程的状态由内核切换，G 的状态由 runtime 切换。==

```flow
grid: true
groups:
  - { id: fsm, label: "G 的三态 —— 和线程同构，只是换了个调度者", tone: violet }
nodes:
  - { id: runnable, label: Runnable, sub: "想要 M 上的一个时间片", row: 0, tone: blue, shape: pill, group: fsm }
  - { id: exec, label: Executing, sub: "正在某个 M 上跑", row: 0, tone: green, shape: pill, group: fsm }
  - { id: wait, label: Waiting, sub: "在等系统调用或同步原语", row: 1, tone: amber, shape: pill, group: fsm }
edges:
  - { from: runnable, to: exec, label: "被调度器选中" }
  - { from: exec, to: runnable, label: "让出 / 被抢占", dashed: true }
  - { from: exec, to: wait, label: "阻塞：channel、mutex、网络" }
  - { from: wait, to: runnable, label: "等的条件满足" }
```

整个状态机里，==「阻塞」就是一次状态改写加一次入队==，没有任何内核参与。这是后面那套东西能跑起来的前提。

还有一个刻意的设计：**Goroutine 没有公开的 ID**。

```compare
first: 世界
head: [怎么组织并发, 问题出在哪]
rows:
  - pthread 世界: ["按身份组织 —— 查 thread id 分活，靠 TLS 读自己那份配置", "身份即契约：谁是谁，决定了怎么交互，程序结构被身份耦合"]
  - Go 世界: ["按通信组织 —— G1 从 channel 收任务，G2 把结果发出去", { text: "匿名。真正需要区分身份时用 channel，而不是查「我在几号线程」", tone: green }]
```

---

## 02 · 栈：2KB 起步，不够就长

```journey
- tag: 线程
  tone: amber
  name: 创建时一次定死
  badge: 8MiB 预留
  fields:
    - { k: 创建时, v: "按最坏情况预留 8MiB" }
    - { k: 运行时, v: "内核不会帮你搬家，只能用这么多" }
    - { k: 结果, v: "大部分根本用不到，但额度已经被占住" }
  noteTone: bad
  note: 预留锁死了数量上限，而且把「最坏情况是多少」压给了开发者估算
  next: "G 把这份估算责任收回了 runtime :: :: 不够就现场扩容"
- tag: Goroutine
  tone: green
  name: 2KB 起步，按需增长
  badge: 运行时源码 stackMin = 2048
  fields:
    - { k: 起步, v: "2KB", note: 对比线程的 8MiB, tone: ok }
    - { k: 不够时, v: "现场分配一块 2 倍大的连续栈" }
    - { k: 上限, v: "64 位 1GB / 32 位 250MB" }
  note: 同一个线程的预留，能装 4096 个初始 G —— 这就是「开几十万个很现实」的内存基础
```

扩容的机制和哈希表扩容同构。**难的只有一步：修正栈内指针。**

```flow
grid: true
groups:
  - { id: old, label: "旧栈 2KB", tone: muted }
  - { id: neo, label: "新栈 4KB", tone: green }
nodes:
  - { id: o1, label: "局部变量在旧地址上", sub: "整体拷贝", row: 0, tone: muted, group: old }
  - { id: o2, label: "栈内指针全部悬空", sub: "它们还指着旧地址", row: 1, tone: red, group: old }
  - { id: n1, label: "内容原样搬过来", sub: "分配 2 倍大的连续内存", row: 0, tone: green, group: neo }
  - { id: n2, label: "指针全部改指新地址", sub: "靠 GC 记录的「哪里是指针」", row: 1, tone: green, group: neo }
edges:
  - { from: o1, to: n1, label: "拷贝" }
  - { from: o2, to: n2, label: "修正指针" }
```

==runtime 能修指针，是因为 GC 扫描栈时本来就要记录「哪里是指针」。== 内核做不到，因为内核根本不懂栈里哪一格是整数、哪一格是指针。这也是 Go 的栈和 GC 深度耦合的原因。

```compare
first: 方案
head: [怎么接续, 热路径开销, 什么时候在用]
rows:
  - 分段栈: ["不够就链一块新段，栈变成链表", { text: "每次跨段边界都有开销", tone: red }, "Go 1.3 之前"]
  - 连续栈: ["分配 2 倍大的一块，整体搬过去", { text: "热路径零开销，只在扩容时付一次拷贝", tone: green }, "Go 1.3 起至今"]
```

这次演进本身就是一次 why-not：**省拷贝的方案，败给了热路径稳定的方案。** 而且 2 倍扩容的摊销成本是均摊常数 —— 每 KB 栈空间平均只被搬过一次，和哈希表扩容把单次插入均摊到常数时间是同一个道理。

可增长不代表无限。上限是 **64 位 1GB、32 位 250MB**（`debug.SetMaxStack` 可调），涨栈越界程序直接崩溃。这面墙的意义是给失控递归立个界 —— 栈增长永远发生在最深的调用链上，那条链往往就是 bug 所在。

最后是切换的基础：**上下文小到只剩两个值。**

```compare
first: 切换时要搬什么
head: [线程, Goroutine]
rows:
  - 上下文: ["全套寄存器 + 信号掩码", { text: "一个栈指针 + 一个指向 g 结构的指针", tone: green }]
  - 出处: ["内核的 PCB / TCB", "runtime 团队原话：「真的只有两个值」"]
```

但小栈只是入场券。==栈内存 KB 对 KB 那个差距被叙事放大了，真正的魔法是用户态调度器与非阻塞 I/O 的深度集成 —— 调度器比内核更懂每个 G 在等什么。== 那是下一篇和第五篇的事。

---

## 03 · 三层，不是三档

「轻量」这个词会诱导人把进程、线程、goroutine 排成「重、中、轻」三档。它们是**三层**：

```flow
grid: true
groups:
  - { id: layers, label: "三层各自回答不同的问题，不存在替代链", tone: violet }
nodes:
  - { id: proc, label: "进程", sub: "解决资源容器与隔离", row: 0, tone: violet, group: layers }
  - { id: th, label: "线程", sub: "内核可见的执行实体", row: 1, tone: amber, group: layers }
  - { id: g, label: "Goroutine", sub: "runtime 可见的逻辑执行实体", row: 2, tone: green, group: layers }
  - { id: m, label: "M（真线程）", sub: "G 最终还是要落在某条 M、某个核上", row: 3, tone: muted, group: layers }
edges:
  - { from: proc, to: th, label: "进程提供隔离，线程在里面跑" }
  - { from: th, to: g, label: "G 没有自己的页表和 FD 表" }
  - { from: g, to: m, label: "逻辑独立，承载复用" }
```

G 没有自己的页表，也没有文件描述符表 —— ==隔离职责它根本没接。== 所以「G 替代线程、线程替代进程」这条链不成立；能被替代的只有「谁承担执行流」这一件事。

回到那个 HTTP/2 的类比收个尾：**stream 有独立的流控与生命周期，承载它的 TCP 连接只有几条；G 有独立的栈与状态，承载它的线程只有核数那么多。逻辑独立，承载复用。**

---

```quiz
- q: Goroutine 为什么没有公开的 ID？
  a: |
    官方理由是：一旦给工人命名、围绕名字建立模型，它就变得特殊，程序结构会被身份耦合扭曲。
    真正需要区分身份时应该用 channel 通信，而不是查「我在几号线程」。
    这和 pthread 世界形成鲜明对照 —— 那边靠线程 ID 与 TLS 组织业务，Go 把这条路主动关掉了。
- q: 为什么线程没法用小栈加动态扩容，而 G 可以？
  a: |
    因为线程栈的大小在创建时一次定死，内核不会在运行中帮你搬家，所以只能按最坏情况预留。
    G 的栈由 runtime 管：不够就分配一块两倍大的连续内存，整体拷过去，再修正栈内指针。
    runtime 敢修指针，是因为 GC 扫描栈时本来就记录了「哪里是指针」；内核没有这份信息。
- q: 进程、线程、Goroutine 为什么说是「三层」而不是「三档」？
  a: |
    因为三者回答的是不同的问题：进程解决资源容器与隔离，线程是内核可见的执行实体，
    G 是 runtime 可见的逻辑执行实体。G 没有自己的页表和文件描述符表，隔离职责它根本没接。
    所以不存在「G 替代线程、线程替代进程」的替代链，被替代的只有「谁承担执行流」这一件事。
```
