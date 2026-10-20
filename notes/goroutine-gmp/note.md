## 01 · 一个 `go` 语句之后，谁在管这条执行流

先看一个能跑的服务。它和 Node、JVM 里最常见的写法只差一行：

```go
func main() {
    ln, err := net.Listen("tcp", ":8080")
    if err != nil {
        panic(err)
    }
    for {
        conn, err := ln.Accept()   // 没有连接时，这里等
        if err != nil {
            continue
        }
        go handle(conn)            // 只把任务排进队列，handle 还没开始跑
    }
}

func handle(conn net.Conn) {
    defer conn.Close()
    buf := make([]byte, 4096)
    n, _ := conn.Read(buf)         // 看起来会阻塞
    conn.Write(process(buf[:n]))
}
```

Node 要写 `await handle(conn)`，控制权在 `await` 处交回事件循环；JVM 通常写 `new Thread(() -> handle(conn)).start()`，每个连接一条线程。Go 的 `go` 语句不一样：`main` 里这一行执行完立刻进入下一轮循环，`handle` 什么时候跑、在哪个线程上跑，代码里看不出来。

这不是语法糖。`go` 后面那串东西被交给了一个用户态的调度器，由它决定何时把这条执行流放到哪条线程上。所以要理解它，先认清三个角色：

| 角色 | 它是什么 | 没有什么就不能跑 |
|---|---|---|
| G（goroutine） | 一个任务：函数入口、一份栈、一份寄存器现场、一个状态 | 它自己不会动，必须被 M 取走 |
| M（machine） | 一条内核线程 | 没有 M，任何 Go 代码都不执行 |
| P（processor） | 一份「运行 Go 代码的许可」，里面装着本地队列和分配缓存 | M 没绑上 P，就不能跑 Go 代码 |

`P` 最容易误会。它不是线程，也不是任务，而是一个 M 从「准备跑 Go 代码」到「交还许可」之间必须握着的东西。后面会看到，P 里装的两样东西（本地队列、mcache）各自省掉一把锁，这才是它存在的理由。

## 02 · 把三个角色放进一张图

```arch
svg: go-gmp
caption: 从左边 GRQ 进入，沿一条横线走到核。点 P 看它的队列和 mcache，点 M 看它为什么可以多于 P，点核看哪一层决定它跑谁。
frames:
  - id: goruntime
    boundary: 0
    kind: contains
    label: Go runtime 自己管
    detail: GRQ、四个 P、四条 M 都在 Go 进程里。M 是内核线程，但它什么时候上核由内核决定 —— 这一层只说「谁持有谁」，不看时间片。
  - id: oslayer
    boundary: 1
    kind: contains
    label: 操作系统管
    detail: 核、时间片、迁移都归内核。Go 能影响的只有「同时跑 Go 代码的 M 最多几个」，也就是 P 的个数。
bodies:
  grq:
    badge: 兜底队列
    rows:
      - { k: 结构, v: 链式队列（gQueue），不是定长数组 }
      - { k: 容量, v: 没有固定上限 }
      - { k: 代价, v: 取放要拿 sched.lock }
    note: 每个 P 每 61 次调度才抽查一次（proc.go:3458）
  p0:
    badge: 一个许可
    rows:
      - { k: runnext, v: "1 格：刚被唤醒、最该接着跑的 G" }
      - { k: runq, v: "256 槽的环形数组（runtime2.go 的 runq [256]）" }
      - { k: mcache, v: 小对象分配缓存，M 靠它无锁分配 }
      - { k: 数量, v: GOMAXPROCS 个，启动时建齐 }
    note: 本地队列的取放只动原子变量，不拿全局锁
  p1:
    rows:
      - { k: runnext, v: 1 格 }
      - { k: runq, v: "256 槽" }
      - { k: mcache, v: 一份 }
    note: 结构一样。P 之间只差队列里装了什么
  p2:
    rows:
      - { k: runnext, v: 1 格 }
      - { k: runq, v: "256 槽" }
      - { k: mcache, v: 一份 }
    note: 本地队列空了，会去别的 P 偷一半（第 ⑥ 篇）
  p3:
    rows:
      - { k: runnext, v: 1 格 }
      - { k: runq, v: "256 槽" }
      - { k: mcache, v: 一份 }
    note: 同一时刻最多 P 个 M 在跑 Go 代码
  m0:
    rows:
      - { k: curg, v: 此刻在跑的 G }
      - { k: g0, v: 调度用的系统栈 }
      - { k: 身份, v: 内核线程，内核只认它 }
    note: Go 代码跑在 curg 的栈上，调度代码跑在 g0 上
  m1:
    rows:
      - { k: 数量, v: 可以多于 P }
      - { k: 为什么多, v: 卡在系统调用里的 M 不占 P }
    note: 第 ⑤ 篇的主角
  m2:
    note: 空闲的 M 会被回收，需要时再开
  m3:
    note: 一条 M 同一时刻只跑一个 G
  c0:
    rows:
      - { k: 谁挑线程, v: 内核 }
      - { k: Go 能做什么, v: 只能设 GOMAXPROCS }
    note: 核上跑的是 M，不是 G
  c1:
    note: 线程被迁移到哪个核，Go 不参与
  c2:
    note: 一个 P 在某一刻只被一个 M 持有
  c3:
    note: 并行度由核数和 P 数共同封顶
parts:
  grq:
    label: 全局队列
    sub: 所有 P 共用的兜底队列
    detail: 本地队列都拿不到活时才会来这里。它要加锁，所以正常路径尽量不碰。
  p0:
    label: P0
    sub: 许可 + 本地队列 + 分配缓存
    detail: GOMAXPROCS 是几就有几个 P。新建的 G 先落在创建它的那个 P 上，所以「一边倒」是常态，不是 bug。
  p1:
    label: P1
    sub: 另一个许可
    detail: P 的数量由 GOMAXPROCS 决定，M 的数量不固定。这条不对称是理解 GOMAXPROCS 的入口。
  p2:
    label: P2
    sub: 队列空了会去偷
    detail: 偷的是「一半」，不是「一个」。第 ⑥ 篇讲为什么。
  p3:
    label: P3
    sub: 同时跑 Go 代码的上限
    detail: 四个 P 不等于四条线程，也不等于四个核；它表示「最多四个 M 同时执行 Go 代码」。
  m0:
    label: M0
    sub: 被内核调度的线程
    detail: M 上没有 G 时，它可能自旋找活、也可能停在一个 note 上睡觉。
  m1:
    label: M1
    sub: 可能多于 P
    detail: 一旦有 M 沉进系统调用，runtime 会把 P 交给别的 M，并可能再开一条新 M。
  m2:
    label: M2
    sub: 弹性资源
    detail: 空闲 M 会被回收；需要时 startm 再开。P 不会这样。
  m3:
    label: M3
    sub: 一条线程一次只能跑一个 G
    detail: 所谓「并发」是多个 M 各跑一个 G，「并行」是它们同时在核上。
  c0:
    label: 核 0
    sub: 内核调度
    detail: 内核看见的只有 M。G 在核上这件事，是 runtime 把 G 交给 M 的结果。
  c1:
    label: 核 1
    sub: 内核调度
    detail: 线程可能被迁移；缓存局部性因此是个概率问题。
  c2:
    label: 核 2
    sub: 内核调度
    detail: 同一时刻，一个 P 只属于一个 M。
  c3:
    label: 核 3
    sub: 内核调度
    detail: GOMAXPROCS 大于核数时，多出来的 P 只是在轮流用同一批核。
tours:
  - id: birth
    label: 一个新 G 怎么排上队
    steps:
      - { at: [p0], text: "`go handle(conn)` 执行时，新 G 被放进当前 P 的 ==runnext==，下一轮优先跑它。" }
      - { at: [m0], text: "M 调 `schedule()`，从 runnext 取走它；取的时候继承当前时间片剩下的部分。" }
      - { at: [c0], text: "`execute` 把 G 的 gobuf 装回寄存器，跳到 `handle` 的第一条指令 —— 到这一步它才真的开始跑。" }
  - id: empty
    label: 本地队列空了之后
    steps:
      - { at: [grq], text: "每 61 次调度抽查一次 GRQ；有活就拿一个，防止全局队列里的 G 饿死。" }
      - { at: [p1], text: "GRQ 也空，就去别的 P 偷一半。偷一半是为了把「动别人队列」的同步成本摊薄。" }
```

图上有一条边是省略的：四个 P 都能从 GRQ 取，也都可能去偷别的 P，图上只画了一条代表边。点开 P 的说明能看到完整关系。

## 03 · 三者的数量与生命周期

```compare
first: 维度
head: [G, M, P]
rows:
  - 是什么: ["一个任务：栈 + 现场 + 状态", "一条内核线程", "一份许可：本地队列 + mcache"]
  - 谁创建: ["`go` 语句、runtime 内部", "runtime 按需（startm）", "按 GOMAXPROCS 建齐；改值时增删"]
  - 数量: [{ text: "海量，想看多少开多少", tone: green }, { text: "弹性，可多于 P", tone: amber }, { text: "= GOMAXPROCS", tone: violet }]
  - 用完去哪: ["回 gFree 池复用", "空闲后回收", "改小时被 procresize 销毁"]
  - 生命周期由谁管: ["你的代码 + runtime", "runtime + 内核", "runtime"]
```

数量关系用一句话说清：==P 有定数、M 弹性、G 海量。== 数量稳定的是 P，流动的是 M 和 G。

这不是设计口号，可以直接量。本机（Apple M4、macOS、Go 1.26.2）跑两个程序：

```text
$ ./mem 100000
goroutines=100000 stack_inuse=196 MiB heap_inuse=61 MiB sys=276 MiB
  rss=256 MiB   threads=11

$ ./mem 1000000
goroutines=1000000 stack_inuse=1954 MiB heap_inuse=609 MiB sys=2635 MiB
  rss=1800 MiB  threads=11
```

一百万条 G 只用了 11 条内核线程。平均下来每条 G 的栈和结构体约 2.6 KiB —— 栈 2 KiB 起步，`g` 结构体约 600 B。这个数字来自实测，不是「很轻」这种形容词。

## 04 · 一个 G 从创建到落核，源码里发生了什么

把上面那张图的横线走一遍，每一站都能在 `runtime` 里找到入口（行号按 Go 1.26.2）：

1. **`go handle(conn)` 变成一次函数调用。** 编译器把它编译成 `runtime.newproc`（`proc.go:5295`），参数会先复制到新 G 的栈上。
2. **取一个 G 结构体。** `newproc1`（`proc.go:5313`）先从 `gFree` 池里拿一个，没有才新分配；给它分配栈（`stackMin = 2048`，`stack.go:78`），从 `sched.goidgen` 取一个 `goid`（`proc.go:2533`），记下入口 `startpc`。
3. **排进当前 P。** `runqput(pp, newg, true)`（`proc.go:7478`）把它放进 `runnext`。如果 runnext 已经有 G，原来的会被挤到 LRQ 尾部。
4. **换人。** 当前 G 用完时间片或被阻塞，进入 `schedule()`（`proc.go:4135`），它调用 `findRunnable()`（`proc.go:3389`）。
5. **取一个。** `runqget`（`proc.go:7598`）先看 runnext，再看 LRQ。取到之后 `execute`（`proc.go:3331`）执行 `gogo(&gp.sched)`（`asm_arm64.s:281`），把 sp、pc、lr、ctxt、bp 装回寄存器，跳过去。
6. **阻塞时再换一次。** 如果这个 G 读 channel 没读到，`gopark`（`proc.go:445`）把状态改成 `_Gwaiting`、记下 `waitreason`，再调 `schedule()`。整个过程没有系统调用。

第 6 步值得停一下：==Go 里的「阻塞」首先是一次状态改写，不是一次内核调用。== 只有真的要和磁盘、网卡之外的设备打交道时，才会进内核。

`GODEBUG=schedtrace` 能把第 3~5 步的队列状态打出来。本机跑 8 个计算任务、`GOMAXPROCS=4`：

```text
$ GOMAXPROCS=4 GODEBUG=schedtrace=200 ./sched
SCHED 0ms:   gomaxprocs=4 idleprocs=1 threads=4 spinningthreads=1 runqueue=0 [ 0 0 0 0 ] schedticks=[ 0 0 0 0 ]
SCHED 209ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 runqueue=2 [ 1 1 0 0 ] schedticks=[ 8 6 8 7 ]
SCHED 415ms: gomaxprocs=4 idleprocs=1 threads=5 spinningthreads=0 runqueue=0 [ 0 0 0 0 ] schedticks=[ 10 9 10 13 ]
```

字段逐个读：`gomaxprocs` 是 P 的个数；`threads` 是 M 的数量（这里是 5，比 4 多一条）；`runqueue` 是 GRQ 的长度；方括号里是四个 P 各自的 LRQ 长度；`schedticks` 是每个 P 被调度的次数。209ms 那一行能看到两个任务在跑、两个在队列里，四个 P 的调度次数并不平均 —— 负载不会自动均分，第 ⑥ 篇的窃取就是干这个的。

## 05 · 为什么一定要有 P：一把锁和一块缓存

最省事的实现是只有一条全局队列，任何 M 都从里面取。它会挨两下：

```compare
first: 方案
head: [取 G 要做什么, 代价]
rows:
  - 一条全局队列: ["每次取/放都拿 sched.lock", "M 一多，锁就是热点；G 上次在核 0 跑，这次可能被核 7 取走，工作集要重建"]
  - 每个 P 一条本地队列: ["取放只动 runqhead / runqtail 两个原子变量", "大多数时候不碰锁；同一个 P 倾向在同一个 M 上继续跑"]
```

P 里的第二样东西是 `mcache`。Go 分配小对象时先看当前 P 的 mcache，不够才去中心缓存拿一批 —— 这条路径也是无锁的。所以「M 必须先绑 P 才能跑 Go 代码」不是一句约定：==没有 P，连一次小对象分配都没有快路径。==

全局队列没有被删掉，它降级成兜底：`sched.runq` 是一条链式队列，没有 256 这种上限。取它的频率被刻意压低：

```go
// runtime/proc.go:3458
// Check the global runnable queue once in a while to ensure fairness.
if pp.schedtick%61 == 0 && !sched.runq.empty() {
    lock(&sched.lock)
    gp := globrunqget()
    unlock(&sched.lock)
    if gp != nil {
        return gp, false, false
    }
}
```

`61` 这一次的用途是公平性检查：即使本地有活，也要隔一段时间看一眼全局。本地队列为空时还会去全局队列批量取（`globrunqgetbatch`），那条路径走得更频繁。本地队列偏向局部性，全局队列维护公平性，两个目标本来就是对头。

`runnext` 是另一处偏向：它只有一个槽，放的是「刚刚被唤醒的 G」。`runqget` 先取它，注释里写得很直白 —— 这批 G 通常在 communicate-and-wait 模式里成组出现，优先跑它们能省掉一轮调度延迟（`proc.go:7598` 上方注释）。

## 06 · GOMAXPROCS 限制的不是线程数

```callout
tone: red
icon: ⚠
text: |
  ==`GOMAXPROCS` 限制的是「同时执行 Go 代码的 M 有几个」，不是进程里线程的总数。==

  卡在系统调用里的 M 不算「在执行 Go 代码」，所以 M 的总数可以比它大。
  本机上面那份 `schedtrace` 里 `gomaxprocs=4`、`threads=5` 就是这件事。
```

它等于 P 的个数，默认值在 Go 1.25 之后变了：

- 以前：`runtime.NumCPU()`，也就是宿主机的逻辑核数。
- 现在（Linux）：先看进程所在 cgroup 的 CPU bandwidth 限额，取较小的那个；并且在运行期间周期性更新。设了 `GOMAXPROCS` 环境变量或调用过 `runtime.GOMAXPROCS(n)` 之后，这两项自动更新都会关闭。
- 想关掉：`GODEBUG=containermaxprocs=0`（不看 cgroup）、`GODEBUG=updatemaxprocs=0`（不周期更新）。依据是 Go 1.25 发布说明的 “Container-aware GOMAXPROCS” 一节。

本机把同一个程序压到 `GOMAXPROCS=1`，对比很直接：

```text
$ GOMAXPROCS=1 GODEBUG=schedtrace=200 ./sched
SCHED 211ms: gomaxprocs=1 idleprocs=0 threads=3 ... runqueue=4 [ 3 ] schedticks=[ 10 ]
SCHED 419ms: gomaxprocs=1 idleprocs=0 threads=3 ... runqueue=0 [ 5 ] schedticks=[ 16 ]
```

八个任务挤在一个 P 上，`runqueue=4`、`[3]` 表示全局队列还有 4 个、本地队列还有 3 个在等。它们都能跑，只是没有并行。此时 Go 像一个「每条任务有独立栈、还能写阻塞式代码」的 Node。

## quiz

```quiz
- q: "`go handle(conn)` 这一行执行完，`handle` 开始跑了吗？"
  a: |
    没有。`go` 语句把函数包装成一个 G，放进当前 P 的 runnext 或本地队列，
    然后当前 G 继续往下执行。要等某个 M 调 `schedule()` 取到它、
    `execute` 把 gobuf 装回寄存器，`handle` 才从第一条指令开始跑。
- q: P 里到底装了什么？为什么说没有 P 就不能跑 Go 代码？
  a: |
    P 里装着 runnext（1 格）、本地运行队列（256 槽）和 mcache。
    M 必须先绑上一个 P 才能从它的队列里取 G；更硬的约束是 mcache：
    小对象分配的快路径要走当前 P 的缓存，没有 P 就没有这条无锁路径。
    所以 P 不是「队列的容器」，而是「运行 Go 代码所需的全部本地状态」。
- q: 我把 `GOMAXPROCS` 设成 2，进程里是不是最多只有两条线程？
  a: |
    不是。它限制的是同时执行 Go 代码的 M 数量，也就是 P 的个数。
    M 可以更多：一旦有 M 卡在系统调用里，runtime 会再开一条 M 来接替它的 P。
    `schedtrace` 里 `gomaxprocs=4`、`threads=5` 就是常态。
- q: 一个 G 阻塞在 channel 上，内核知道吗？
  a: |
    不知道。`gopark` 把 G 的状态改成 `_Gwaiting`、记下 waitreason，
    然后当前 M 直接调 `schedule()` 去跑下一个 G。整个过程没有系统调用，
    内核看到的只是这条线程一直在执行用户态代码。
```
