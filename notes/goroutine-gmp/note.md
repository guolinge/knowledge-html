## 01 · 三件套

上一篇把 G 拆出来了：小栈、小上下文、三态。但它终究要落在真线程、真 CPU 上。中间有**三样东西**在接力：

```spec
title: G / M / P
subtitle: 谁持有执行权，谁只是数据
tone: violet
rows:
  - k: G（goroutine）
    v: |
      **执行流的完整状态**：栈在哪、指令走到哪了、它在等什么。

      关键的一条：==G 是纯数据，它不持有执行权。== 一个 G 自己不会跑，
      它必须被某个 M 取走才能动。
  - k: M（machine）
    v: |
      **一条真实的内核线程。**

      Go 不接管 M 在核上怎么被调度 —— 那部分照旧归内核管。
      M 的职责就是「把 G 跑起来」。
  - k: P（processor）
    v: |
      **调度资源包**，里面装着三样东西：

      - 本地运行队列 LRQ（一堆等着跑的 G）
      - runnext 槽（一个单槽缓存）
      - 内存分配缓存 mcache

      还有最关键的一条：==P 是「运行 Go 代码的许可」。==
      M 必须先绑到一个 P 上，才能从它的队列里取 G 执行。
```

为什么需要 P 这个东西？为什么不让 M 直接从全局队列取 G？

因为**无锁**。多个 M 抢一条全局队列要加锁，M 越多锁越烫。有了 P，每个 M 平时只碰自己那份队列，不需要抢。第 ⑥ 篇会细讲这件事的来龙去脉。

那 mcache 为什么也挂在 P 上？因为小对象的内存分配走 P 本地缓存，全程无锁。==所以没有 P，连分配内存都没有一条无锁通道。== P 不只是队列，它是「无锁执行 Go 代码所需的全部上下文」。

---

## 02 · 三样东西的生命周期各管各的

```compare
first: 角色
head: [数量, 生命周期]
rows:
  - G: [{ text: "海量", tone: blue }, "跑完就退出。它那个 g 结构体被回收进 gFree 池，下次复用"]
  - M: [{ text: "弹性", tone: amber }, "多了会被回收，少了会新建 —— runtime 按需求维持着一个够用的数量"]
  - P: [{ text: "固定", tone: green }, "启动时一次建齐，直到进程结束都不销毁"]
```

==P 不变、M 弹性、G 海量。== 这个设计把「稳定的骨架」和「流动的资源」分开了。

P 的个数在启动时按逻辑核数分配，这个数就是 **GOMAXPROCS**（默认等于 `runtime.NumCPU()`）。每个 P 一条本地队列；另有一条**全局队列 GRQ** 当兜底。

而阻塞在系统调用里的 M 会暂时和 P 解绑 —— 所以 ==M 的数量可以多于 P==。这条正是下一篇的主角。

---

## 03 · GOMAXPROCS 不是线程数

这是最容易误解的一个参数。

```callout
tone: red
icon: ⚠
text: |
  ==`GOMAXPROCS` 限制的是**同时执行 Go 代码的 G 数量**，不是线程数量。==

  官方 FAQ 说得很直白：runtime 可以分配比 `GOMAXPROCS` **更多**的线程去服务多个未完成的
  I/O 请求 —— 那些 M 阻塞在系统调用里，**不算「在执行 Go 代码」**。

  所以看到「M 的数量比 GOMAXPROCS 大」不是 bug，是设计。
```

```flow
grid: true
groups:
  - { id: one, label: "GOMAXPROCS = 1", tone: amber }
  - { id: four, label: "GOMAXPROCS = 4", tone: green }
nodes:
  - { id: p1, label: P0, sub: "就这一个许可", row: 0, tone: amber, group: one }
  - { id: g1, label: 一堆 G, sub: "轮流上这一个 P", row: 1, tone: amber, group: one }
  - { id: p2, label: "P0 P1 P2 P3", sub: "四个许可", row: 0, tone: green, group: four }
  - { id: g2, label: 同样多的 G, sub: "同时最多四个在跑", row: 1, tone: green, group: four }
edges:
  - { from: p1, to: g1, label: "并发有，并行没有" }
  - { from: p2, to: g2, label: "并行度上限就是 4" }
```

`GOMAXPROCS = 1` 时，一万个 G 可以并发推进（一个让出、下一个接上），但任何瞬间只有一个 G 在执行 Go 代码。这时候的 Go ==就是一个「每个任务都有独立栈、而且能写阻塞式代码」的 Node==。

```callout
tone: amber
icon: 🐳
text: |
  **容器里的坑。**

  Go 1.25 之前，`GOMAXPROCS` 默认取**宿主机**的逻辑核数。
  宿主机 64 核、容器限 4 核时，runtime 以为有 64 个并行度，
  把 64 个 P 挤在 4 核上 —— 触发 CFS 节流，延迟开始抖。

  Go 1.25 起默认感知 cgroup 的 CPU 限额，取较小值并周期性更新。
  旧版本要么显式设 `GOMAXPROCS`，要么用 `automaxprocs` 这类库。
```

---

## 04 · 让它跑起来

上面说的都是静态结构。点几下「跑一步」，看调度器真的动起来：

```demo
widget: gmp-lab
title: GMP 调度台
actions: false
hint: 点「跑一步」或「跑 10 步」
config:
  gomaxprocs: 3
  goroutines: 16
  ioRatio: 0.4
  seed: 7
```

几件值得盯着看的事：

```checklist
tone: warn
items:
  - tick 0 时新建的 16 个 G 全都在 P0 的队列里 —— 新 G 挂在创建它的那个 P 身上，所以「一边倒」是常态
  - 过几个 tick，P1、P2 的队列空了，日志里会出现「从 P0 偷走一半」—— 这就是工作窃取
  - 随便哪个 P 的 runnext 里有 G 时，它下一轮先取那一个 —— 刚从网络醒来的 G，数据还热在缓存里
  - 有 G 去「等网络」时，它被挂到 netpoller 上，而那个 P 转头就去跑队列里的下一个 —— 它没有等
```

==把 G 的总数拉到 24、GOMAXPROCS 压到 1，再跑几步== —— 你会看到 G 在一个 P 上老老实实排队，谁也别想并行。那就把 P 加到 4 再看看。

---

```quiz
- q: P 里到底装了什么，为什么说它是「运行 Go 代码的许可」？
  a: |
    P 里装着本地运行队列 LRQ、runnext 单槽、以及内存分配缓存 mcache。
    说它是许可，是因为 M 必须先绑上一个 P 才能取 G 来跑 —— 其中一个硬理由是
    mcache：没有 P，连分配小对象都没有无锁通道。所以 P 是「无锁执行 Go 代码所需的全部上下文」。
- q: 我把 GOMAXPROCS 设成 2，是不是表示我的程序最多只有 2 条线程？
  a: |
    不是。GOMAXPROCS 限制的是「同时执行 Go 代码的 G 有几个」。
    runtime 可以创建比它更多的 M 去服务阻塞的 I/O ——
    那些 M 睡在系统调用里，不算在执行 Go 代码，所以不计入这个限制。
- q: G 跑完之后，它的那个结构体去哪了？
  a: |
    被回收进 gFree 池，等下次新建 G 时复用。
    这正是「G 海量」能成立的原因：G 不是每次都重新分配一整套结构，
    大部分是复用来的。相比之下 P 是启动时一次建齐、永不销毁的。
```
