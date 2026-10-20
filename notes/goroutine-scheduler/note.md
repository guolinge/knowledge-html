## 01 · 一个 M 找活干，按这个顺序走

前一篇说 G 会被放进 P 的队列。这一篇看另一半：M 空闲下来之后，按什么顺序找下一个 G。

入口是 `findRunnable()`（`proc.go:3389`）。Go 1.26 的顺序是这样的（省略了 GC、trace、finalizer 这些旁路）：

```flow
grid: true
groups:
  - { id: order, label: "找不到就继续往下；到最后一格才睡觉", tone: violet }
nodes:
  - { id: g61, label: "每 61 次：看 GRQ", sub: "schedtick % 61 == 0 才查；有就拿一个", row: 0, tone: violet, group: order }
  - { id: rn, label: "runnext", sub: "1 格：刚刚被唤醒、最该接着跑的 G", row: 1, tone: green, group: order }
  - { id: lrq, label: "本地队列 LRQ", sub: "256 槽的环形数组，取队头", row: 2, tone: green, group: order }
  - { id: gb, label: "GRQ 批量", sub: "本地空了，一次搬一半到 LRQ", row: 3, tone: blue, group: order }
  - { id: np, label: "netpoll(0)", sub: "非阻塞看一眼网络，有就绪的就取", row: 4, tone: amber, group: order }
  - { id: steal, label: "偷别的 P", sub: "拿走对方队列的一半", row: 5, tone: amber, group: order }
  - { id: park, label: "停 P，睡 M", sub: "都没有活；等事件把它叫醒", row: 6, tone: muted, group: order }
edges:
  - { from: g61, to: rn, label: "没有" }
  - { from: rn, to: lrq }
  - { from: lrq, to: gb }
  - { from: gb, to: np }
  - { from: np, to: steal }
  - { from: steal, to: park }
```

==61 这一步在本地队列**之前**，这是 Go 1.26 源码里的顺序。== 它排在 `runqget` 前面（`proc.go:3458`），意思是「即使我本地有活，也要隔一段时间先看全局」——如果放在本地队列之后，本地一直有活的 P 就永远不会去取全局队列里的 G，那些 G 会饿死。旧版本和不少文章的写法是本地优先，读之前先对一下版本。

`GODEBUG=schedtrace` 能把每个 P 的队列长度打出来。本机跑 8 个计算任务：

```text
$ GOMAXPROCS=4 GODEBUG=schedtrace=200 ./sched
SCHED 209ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 runqueue=2 [ 1 1 0 0 ] schedticks=[ 8 6 8 7 ]
SCHED 415ms: gomaxprocs=4 idleprocs=1 threads=5 spinningthreads=0 runqueue=0 [ 0 0 0 0 ] schedticks=[ 10 9 10 13 ]
```

`runqueue=2` 是全局队列长度，方括号里是四个 P 各自的 LRQ 长度。`schedticks` 是每个 P 被调度的次数，它们不平均是正常的 —— 负载不会自动均分，这正是下面「窃取」要解决的事。

## 02 · 为什么要三层队列

最省事的实现是一条全局队列，所有 M 都从里面取。它会挨两下：

- **锁**：每次取/放都要拿 `sched.lock`，M 越多争得越凶；
- **缓存**：G 上次在核 0 上跑，这次被核 7 取走，工作集不在同一个缓存里。

所以每个 P 有一条自己的队列，取放只动 `runqhead` / `runqtail` 两个原子变量；全局队列降级成兜底。局部性有了，新的问题也来了：负载不均。

```flow
grid: true
groups:
  - { id: steal, label: "空闲的 P 主动去偷；一次拿走一半", tone: amber }
nodes:
  - { id: p1, label: "P1 的 LRQ", sub: "G1 G2 G3 G4 G5 G6", row: 0, tone: blue, group: steal }
  - { id: p2, label: "P2 的 LRQ：空", sub: "M2 自旋了一小会儿", row: 1, tone: muted, group: steal }
  - { id: take, label: "偷走 G4 G5 G6", sub: "只偷一半", row: 2, tone: green, group: steal }
  - { id: why, label: "为什么是一半", sub: "摊薄「动别人队列」的同步成本，也给被偷的 P 留活", row: 3, tone: violet, group: steal }
edges:
  - { from: p1, to: p2, label: "P2 空了" }
  - { from: p2, to: take, label: "盯上队列最长的那个" }
  - { from: take, to: why }
```

源码里「一半」写得很直白（`runqgrab`，`proc.go:7662`）：

```go
n := t - h        // 队列长度
n = n - n/2       // 留一半，偷另一半（向上取整）
```

不是随便定的：偷一个的话，本地一空就要再上门一次；每次「动别人队列」都有同步成本，为一个小任务反复上门不划算。一次拿一半，把这份成本摊薄，同时被偷的 P 还剩一些活干。

去偷的 M 在源码里叫 **spinning M**。它自旋的时候不是空转，眼睛同时盯着别的 P 的队列和 netpoller。自旋的 M 数量也有限制（`proc.go:3571`）：

```go
if mp.spinning || 2*sched.nmspinning.Load() < gomaxprocs-sched.npidle.Load() {
    // 才允许进入窃取
}
```

大意是：自旋的 M 不超过「正在干活的 P」的一半。自旋本身烧 CPU，太多了反而干扰正在跑的 G。

## 03 · runnext：刚醒的 G 为什么先跑

`runnext` 只有一格，放的是「刚刚被 `goready` 唤醒的 G」。`runqget`（`proc.go:7598`）先取它，源码注释给的理由是：

> 一批 G 如果卡在 communicate-and-wait 模式里（一个发、一个收，收完再发），把它们当作一个单元调度，可以消除「把刚唤醒的 G 放到队列尾部」带来的调度延迟。

换句话说：刚刚从 channel 或网络醒来的 G，数据很可能还在缓存里，让它接着跑，比让队列里的另一个 G 先跑更划算。`execute` 时它还会继承当前时间片剩下的部分（`inheritTime`），不重新开始计时。

代价是它可能被别的 P 偷走。`runqgrab` 里偷 runnext 的分支会先睡 3µs（`usleep(3)`），给对方一个先跑的机会，避免两个 P 把同一个 G 来回抢（`proc.go:7690` 附近）。这是一个针对「抢来抢去」的退避，不是调度正确性的一部分。

## 04 · 抢占：正在跑的 G 不撒手怎么办

队列解决「取谁」，抢占解决「上一个赖着不走」。

协作抢占很早就有了：`sysmon` 发现某个 G 跑得太久，就把它的 `stackguard0` 改成 `stackPreempt`（`preemptone`，`proc.go:6866`）。Go 的函数序言本来就要检查栈边界，检查到这个毒值就调用 `morestack`，顺带把 G 让出去。栈检查本来就要做，所以这条路径几乎没有额外成本。

但它有一个死穴：**没有函数调用的紧循环永远走不到序言**。`for {}` 里没有栈检查，毒值没人查收，P 就被占死了。Go 1.14 之前，这种代码能把调度器和 GC 一起拖住。

Go 1.14 加了异步抢占：`sysmon` 给目标 M 发 `SIGURG`（`signal_unix.go` 里 `sigPreempt = _SIGURG`），信号处理器把 PC 改到 `asyncPreempt` 入口，保存用户寄存器，再转入 `gopreempt_m` 让出 P。这就是为什么 Go 1.14 之后，Unix 程序会收到更多信号，一些慢系统调用会更常以 `EINTR` 失败。

可以自己验证。同一个程序，`GOMAXPROCS=1`，先开一个 `for {}` 的 G，再让主 G 睡 100ms：

```go
runtime.GOMAXPROCS(1)
go func() {
    for {}          // 没有函数调用，协作抢占找不到安全点
}()
time.Sleep(100 * time.Millisecond)
fmt.Println("main 醒了")
```

```text
$ ./preempt
main 醒了：紧循环被抢占了

$ GODEBUG=asyncpreemptoff=1 ./preempt
（挂住，1.5 秒后被 kill）
```

关掉异步抢占就挂住，打开就能醒 —— 这就是 Go 1.14 那条路径在起作用。

```compare
first: 维度
head: [协作抢占, 异步抢占]
rows:
  - 触发: ["G 自己走到安全点（函数序言等）", "runtime 发 SIGURG 打断"]
  - 时机: ["下一次函数调用 / 栈检查", "任意用户态代码点"]
  - 代价: [{ text: "几乎为零（搭栈检查的便车）", tone: green }, { text: "要保存整套用户寄存器", tone: amber }]
  - 边界: [{ text: "紧循环永远不触发", tone: red }, "runtime 关键段和信号处理中不能打断"]
```

## 05 · 怎么读调度器

三个入口，按「你想回答什么问题」选：

| 你想知道 | 用什么 | 看什么 |
|---|---|---|
| 某个 P 队列是不是堆住了、M 是不是太多 | `GODEBUG=schedtrace=1000` | `runqueue`、方括号里的每 P 长度、`threads`、`idleprocs` |
| 某个请求为什么等了 200ms | `go tool trace` 的 goroutine analysis | runnable 到 running 的延迟、阻塞原因、被谁唤醒 |
| 线上偶发卡顿，不想一直开 trace | `runtime/trace.FlightRecorder`（Go 1.25） | 环形缓冲，出事时 `WriteTo` 把最近几秒落盘 |

`schedtrace` 是最便宜的：它只打印，不记录，开销小，适合在容器里临时开。读的时候先看三件事：

1. `gomaxprocs` 和你以为的一样吗？容器里默认值在 Go 1.25 之后跟随 cgroup 限额。
2. `runqueue` 和方括号里的数字长期不空？说明 P 不够，或者有 G 在长时间占着 P。
3. `threads` 远大于 `gomaxprocs`？说明有大量 M 卡在系统调用里（第 ⑤ 篇的 hand-off）。

`go tool trace` 的信息量大得多，适合带着假设去读：比如「这个接口的 p99 高，是不是因为它在等 P」，就去 goroutine analysis 里找 runnable 时间长的 G，再看它被哪个 M 跑、中间被抢占了几次。没有假设地打开 trace，通常只会看到一片看不懂的色块。

## quiz

```quiz
- q: "`findRunnable` 里「每 61 次看一次全局队列」为什么排在本地队列之前？"
  a: |
    为了公平。如果先取本地队列，本地一直有活的 P 就永远不会去看全局队列，
    GRQ 里的 G 会饿死。放在前面，等于强制每个 P 隔一段时间先看全局，
    再回到本地。61 是经验值，不是 API 契约。
- q: 工作窃取为什么偷一半，而不是偷一个？
  a: |
    偷一个会让本地一空就再上门一次，而「动别人的队列」有同步成本，
    为一个小任务反复上门不划算。偷一半把这份成本摊薄，
    也给被偷的 P 留一些活，避免它马上又变成空队列。
- q: Go 1.14 之前，一个 `for {}` 为什么能把调度器饿死？
  a: |
    协作抢占靠函数序言里的栈边界检查触发。紧循环没有函数调用，也就没有序言，
    sysmon 把 stackguard0 改成毒值后没人查收，P 一直被占着。
    Go 1.14 起用 SIGURG 直接打断，才不再依赖安全点。
- q: "`schedtrace` 里 `threads` 远大于 `gomaxprocs`，说明什么？"
  a: |
    说明有很多 M 卡在系统调用里，或者曾经卡过还没被回收。
    GOMAXPROCS 限制的是同时执行 Go 代码的 M 数量，不是线程总数；
    文件 I/O、cgo 这类不能 poll 的等待，每条都要一条 M 陪着。
```
