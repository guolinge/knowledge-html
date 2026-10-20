## 01 · 三个动作分开看

你的问题里其实混了三件事，先拆开：

```compare
first: 动作
head: [谁决定, 谁真正执行 / 什么时候]
rows:
  - 得到第一条线程:
      - "操作系统。进程启动（exec）时就带着一条主线程"
      - "内核。Go 的代码还没开始跑，线程已经在了"
  - "造 g0、P、main G":
      - "Go runtime。rt0_go → schedinit → newproc"
      - "就在那条主线程上跑，不经过内核调度"
  - "再开一条新线程":
      - "Go runtime 决定（startm），内核执行（clone / pthread_create）"
      - "有活要干、又没有空闲 M 时；或者某个 M 沉进了阻塞的系统调用"
```

```callout
tone: violet
icon: 🧭
text: |
  ==线程的创建权在内核，决定权在 runtime；G 的创建完全不经过内核。==

  所以「Go 运行时负责创建线程」这句话要改成：**runtime 按需请求，内核真正 clone**。
```

## 02 · 启动前：一条线程，零个 goroutine

程序启动不是从 `main()` 开始的。内核把可执行文件 exec 起来，只会给进程一条主线程，栈指针指向内核准备好的那块栈。这时候进程里：

- 没有 g、没有 P、没有调度器；
- 入口是 `runtime·rt0_go`（汇编），不是 `main`；
- 后面所有的对象，都是这条线程自己一步步搭出来的。

先看 `main` 跑起来时，进程里已经站着谁，以及每个东西是哪一步造出来的：

```arch
svg: go-boot
maxScale: 1.3
caption: 从「内核」进来：它只交出一条线程；M0、g0、P 池、main G 都是 runtime 在这条线程上顺手搭的。点 sysmon 看启动后第一条真正新开的线程。
frames:
  - id: process
    boundary: 0
    kind: contains
    label: 一个 Go 进程 · 用户态
    detail: 启动阶段造出来的东西都在这层：M0 是接管来的线程，g0 是它的调度栈，P 是一批许可，main G 是第一个任务。内核只在下面那一层。
  - id: kernel
    boundary: 1
    kind: classification
    label: 内核态
    detail: 内核只做两件事：exec 时给一条线程；之后按 runtime 的请求 clone 新线程。它不知道 G 和 P。
bodies:
  kern:
    badge: exec / clone
    rows:
      - { k: 启动时, v: 给进程一条主线程 }
      - { k: 之后, v: 按请求 clone 新线程 }
    note: 它不认识 G 和 P；线程的创建在这里，什么时候要由 runtime 说。
  m0:
    badge: 接管来的
    rows:
      - { k: 从哪来, v: 进程的主线程 }
      - { k: 在 Go 里, v: runtime.m0，一个 m 结构 }
      - { k: 它跑什么, v: g0 上的启动代码 }
    note: M0 不是 Go 创建的，Go 只是把它登记下来。
  g0:
    badge: 调度栈
    rows:
      - { k: 是什么, v: 一个 g 结构，栈就是线程的栈 }
      - { k: 干什么, v: schedule / gopark / morestack }
      - { k: 和 M, v: 每个 M 各有一条 g0 }
    note: 用户 G 的代码不会跑在 g0 上。
  rt:
    badge: 启动代码
    rows:
      - { k: 启动时, v: rt0_go → schedinit → procresize }
      - { k: 造什么, v: g0 绑定、P 池、main G }
      - { k: 之后, v: newproc 造 G、startm 要线程 }
    note: runtime 是链接进二进制的代码，不是独立进程。
  ps:
    badge: 一次建齐
    rows:
      - { k: 什么时候, v: schedinit 里一次建齐 }
      - { k: 数量, v: GOMAXPROCS 个 }
      - { k: P0, v: 分给正在跑的 M0 }
    note: P 是许可和队列，自己不执行代码。
  maing:
    badge: 第一个任务
    rows:
      - { k: 怎么来, v: newproc(mainPC) 造的普通 G }
      - { k: 栈, v: 2 KiB 起，和别的 G 一样 }
      - { k: 起点, v: runtime.main，再进 main.main }
    note: 它和 `go f()` 造出来的 G 走同一条创建路径。
  sysmon:
    badge: 第一条新线程
    rows:
      - { k: 怎么来, v: runtime.main 里 newm }
      - { k: 身份, v: 一条没有 P 的 M }
      - { k: 干什么, v: 抢占、handoff、netpoll }
    note: 启动过程中 GC 和清扫也会再要几条，不只有它。
parts:
  kern:
    label: 内核
    sub: 线程的出生地
    detail: 内核在 exec 时创建进程的主线程，之后 Go 每次需要新线程都走 clone（Linux）或 pthread_create（Darwin）。内核不参与 G 的排队。
  m0:
    label: M0 · 初始线程
    sub: 内核给的那一条
    detail: m0 是 BSS 里一个全零的 m 结构，不是 malloc 出来的。rt0_go 把 g0 和它互相指好，从此这条线程就有了 Go 的身份。
  g0:
    label: g0 · 调度用 G
    sub: 不是零号任务
    detail: g0 有自己的 g 结构，但它不跑用户函数。调度器、栈扩容、gopark 这些需要在「干净栈」上跑的代码都用它。新 M 的 g0 在 Linux 上是 malg(16 KiB)，Darwin 上直接借 pthread 的栈。
  rt:
    label: Go runtime
    sub: 启动阶段的总调度
    detail: rt0_go 之后依次是 args / osinit / schedinit；schedinit 里把栈池、堆、GC、P 都建好；最后 newproc 造 main G、mstart 进调度循环。
  ps:
    label: P0 … Pn
    sub: GOMAXPROCS 个
    detail: 启动时当前 M 还没有 P，procresize 建完 P 后把 allp[0] 交给它。P 的数量决定「同时跑 Go 代码的 M 最多几条」，不决定线程总数。
  maing:
    label: main G
    sub: 第一个被 newproc 造出来的 G
    detail: 它的入口是 runtime.main。runtime.main 把最大栈设成 1 GB、标记 mainStarted、开 sysmon、锁住 M0，跑完所有包的 init 才进 main.main。
  sysmon:
    label: sysmon 的 M
    sub: 没有 P 的监控线程
    detail: 它不持有 P，所以不参与「同时跑 Go 代码」的并发度；它负责抢占跑太久的 G、从系统调用里收回 P、在没人 poll 网络时叫醒一条 M。
tours:
  - id: boot
    label: 启动按什么顺序搭
    steps:
      - { at: [kern], text: "内核 exec：==只给一条主线程==，栈指针指向它的栈。" }
      - { at: [m0, g0], text: "rt0_go：把这条线程登记成 m0，把它的栈划给 g0，两者互相指好。" }
      - { at: [rt, ps], text: "schedinit：建栈池、堆、GC；`procresize(GOMAXPROCS)` 一次建齐 P，P0 交给 M0。" }
      - { at: [maing], text: "newproc(mainPC)：造出 main G，放进 P0 的 runnext。" }
      - { at: [sysmon], text: "mstart → schedule 取到 main G → runtime.main；它先 newm(sysmon)，==启动后第一条新线程==。" }
  - id: who
    label: 谁创建了谁
    steps:
      - { at: [kern, m0], text: "内核 → M0：这是唯一不是 Go 创建的线程。" }
      - { at: [rt, g0], text: "runtime → g0：只是把 M0 的栈登记成 g0 的栈，没有分配新栈。" }
      - { at: [rt, ps], text: "runtime → P 池：一次建齐，之后不再按需新建。" }
      - { at: [rt, maing], text: "runtime → main G：和 `go f()` 同一条 newproc 路径。" }
      - { at: [rt, sysmon], text: "runtime → sysmon 的 M：这里才第一次向内核要新线程。" }
```

每个对象从哪一刻开始存在，可以按时间轴走一遍：

```demo
widget: runtime-timeline
title: 启动过程中，每个对象从哪一刻开始存在
actions: false
config:
  tMax: 8
  procs:
    - { name: 内核给的线程, sub: 进程的主线程, spans: [[0, 8]], note: "exec 之后就在，Go 一进来就接管它" }
    - { name: M0, sub: "runtime.m0", spans: [[0, 8]], note: "BSS 里的静态结构，rt0_go 把它和 g0 指好" }
    - { name: g0, sub: 栈就是这条线程的栈, spans: [[1, 8]], note: "没有新分配栈，只是登记" }
    - { name: P0 … P9, sub: GOMAXPROCS 个, spans: [[3, 8]], note: "schedinit 里一次建齐，P0 归 M0" }
    - { name: main G, sub: 2 KiB 栈, spans: [[4, 8]], note: "newproc 造出来的普通 G" }
    - { name: sysmon 的 M, sub: 第一条新线程, spans: [[5, 8]], note: "runtime.main 里 newm 请求内核 clone" }
  steps:
    - { at: 0, what: "内核 exec：给进程一条主线程，栈指针指向它的栈" }
    - { at: 1, what: "rt0_go：把这条线程登记成 m0，把栈划给 g0" }
    - { at: 2, what: "schedinit：栈池、堆、GC、m0 的 gsignal 都在这一步准备好" }
    - { at: 3, what: "procresize(GOMAXPROCS)：一次建齐 P，P0 交给 M0" }
    - { at: 4, what: "newproc(mainPC)：造出 main G，进 P0 的 runnext" }
    - { at: 5, what: "mstart → schedule → runtime.main；先 newm(sysmon) 开第一条新线程" }
    - { at: 6, what: "doInit：跑所有包的 init，包括 main 包的" }
    - { at: 7, what: "main.main 开始跑；到这一步，M0 已经在调度循环里来回换 G 了" }
    - { at: 8, what: "之后每来一个 `go f()`，只是往某个 P 的队列里再放一个 G" }
```

## 03 · rt0_go：把这条线程登记成 M0，顺手造 g0

`m0` 和 `g0` 不是运行时 malloc 出来的对象，它们是 BSS 里两个全零的全局结构。`rt0_go` 做的是「登记」：

```text
// runtime/asm_arm64.s, rt0_go 的前几行
MOVD  $runtime·g0(SB), g
MOVD  RSP, R7
MOVD  $(-64*1024)(R7), R0
MOVD  R0, (g_stack+stack_lo)(g)      // g0 的栈底 = 当前 SP - 64 KiB
MOVD  R7, (g_stack+stack_hi)(g)      // g0 的栈顶 = 当前 SP
MOVD  $runtime·m0(SB), R0
MOVD  g, m_g0(R0)                    // m0.g0 = g0
MOVD  R0, g_m(g)                     // g0.m = m0
```

这段代码说明两件事：

- **g0 没有新栈**。它借的就是内核给的那条线程的栈，只划了 64 KiB 出来。
- **M 和 g0 是一对**。之后每条新 M 也都有一条自己的 g0：Linux（非 cgo）上是 `malg(16 KiB)`，Darwin 上直接借 pthread 给的栈。

`g0` 不是「零号 goroutine」那种任务。它没有用户函数要跑，只承载调度器的代码：`schedule`、`gopark`、栈扩容这些需要在「干净栈」上执行的动作，都在 g0 上。用户 G 的代码永远跑在它自己的栈上。

每个 M 还有第三条 g：`gsignal`（Linux / Darwin 都是 32 KiB），专门给信号处理用。它在 `mcommoninit → mpreinit` 里建。

## 04 · schedinit：P 是一次建齐的

`rt0_go` 接着调 `args`、`osinit`、`schedinit`。`schedinit` 是启动阶段最长的一步，顺序大致是：

1. 初始化各种锁；
2. `stackinit` 建栈池，`mallocinit` 建堆，`randinit` 初始化随机数；
3. `mcommoninit(m0)` 给 M0 补上 id、`gsignal`、`allm` 链表；
4. `gcinit` 初始化 GC；
5. `procresize(GOMAXPROCS)` **一次建齐所有 P**。

`procresize` 建完 P 后会发现当前 M 还没有 P，于是 `acquirep(allp[0])`，P0 归 M0。这一步之后：

- P 的数量定死了，运行时不会为「多来几个 G」临时加 P；
- GOMAXPROCS 默认是 CPU 数（Go 1.25 起会看容器配额），也可以用环境变量或 `runtime.GOMAXPROCS` 改；
- 每个 P 里装着 `runnext`（1 格）、`runq`（256 槽环形数组）、`mcache`；
- P 只是许可和队列，**不执行代码**。执行代码的永远是 M。

## 05 · main G：newproc 造出来的普通 G

`rt0_go` 的最后两步是：

```text
MOVD $runtime·mainPC(SB), R0   // 入口是 runtime.main
BL   runtime·newproc(SB)       // 造 main G，放进 P0 的 runnext
BL   runtime·mstart(SB)        // 进入调度循环
```

`newproc → newproc1` 对 main G 和 `go f()` 造的 G 是同一套流程：先从当前 P 的 gFree 池里拿一个空闲 g，没有就 `malg(2048)` 新建一块 2 KiB 的栈；然后设好入口和栈指针，状态从 `Gdead` 改成 `Grunnable`，放进 `runnext`。

区别只有两个：main G 的入口是 `runtime.main`，而且是在 `mstart` 之前造好的。

`mstart → mstart1` 会把 g0 的「回来的位置」记成 `mstart0` 里的下一条指令，然后调 `schedule()`。`schedule` 从 P0 的 `runnext` 取到 main G，`execute` 把它挂到 M0 上，`gogo` 恢复它的 SP/PC 跳过去 —— 到这一刻，`runtime.main` 才开始跑。

`runtime.main` 做的第一件“额外”的事是：

```text
newm(sysmon, nil, -1)
```

这是启动后第一次向内核要新线程。sysmon 的 M 不持有 P，只做三件事：抢占跑太久的 G、从阻塞的系统调用里收回 P、在没人 poll 网络时叫醒一条 M。

之后 `runtime.main` 才 `doInit`（跑所有包的 init）、`gcenable`，最后 `main.main`。

```callout
tone: amber
icon: 📏
text: |
  **所以「到 main 时只有一条线程」是不对的。** 本机空程序实测（`GODEBUG=schedtrace=1`）：
  GOMAXPROCS=10 时 `threads=5`，GOMAXPROCS=1 时 `threads=3`。
  多出来的那几条，是 sysmon 和 GC / 清扫这些后台工作要的；具体条数随版本、GOMAXPROCS 和负载变，不是固定值。
```

## 06 · `go f()`：把 G 放进队列，仅此而已

一句 `go f()` 的运行时路径是：

```text
go f()
 └─ runtime.newproc
     ├─ newproc1：从 gFree 复用，或 malg(2048) 新建
     ├─ 设入口、栈指针、状态 Gdead → Grunnable
     ├─ runqput(pp, newg, true)：放进当前 P 的 runnext
     └─ wakep()：如果有空闲 P、又没有 spinning 的 M，叫一条 M 来干活
```

注意最后那一步：`go` 语句本身**不创建线程**，但它会调 `wakep`。`wakep` 只做一件事 —— 如果「有可运行的 G、有空闲的 P、没有正在找活的 M」，就让 `startm` 去唤醒或创建一条 M。它不会为这一个 G 专门开线程，一条 M 服务的是整个 P 的队列。

本机实测（Go 1.26.2，Apple M4，`ThreadCreateProfile` 数 M）：

| 场景 | 线程（M）数 |
|---|---|
| 空程序，刚进 main，GOMAXPROCS=10 | 5 |
| 空程序，刚进 main，GOMAXPROCS=1 | 3 |
| 10 万个 G 停在 channel 上，GOMAXPROCS=10 | 11 |
| 10 万个 G 停在 channel 上，GOMAXPROCS=1 | 3 |
| 50 个 `syscall.Read` 真阻塞在管道上，GOMAXPROCS=10 | 53 |

两件事从这张表里能直接看出来：

- **G 多不等于线程多**。P=1 时 10 万个 G 也没多出一条线程；P=10 时多出来的 6 条是为了把 10 个 P 填满，不是「每个 G 一条」。
- **真正拉高线程数的是阻塞的系统调用**。50 个 G 卡在 `read` 上，每个都拖着一条 M 沉在内核里，线程数直接到 53。

## 07 · 什么时候才会真的 clone 一条线程

新线程只有一条路：`startm` 找不到空闲 M，于是 `newm`。

```flow
grid: true
nodes:
  - { id: call, label: "G 发起阻塞系统调用", sub: "read / fsync / …", row: 0, kind: backend }
  - { id: sys, label: "M 沉进内核", sub: "P 变成 _Psyscall，队列里还有别的 G", row: 1, tone: amber }
  - { id: mon, label: "sysmon 发现", sub: "巡检间隔 20 µs 起，最长 10 ms", row: 2, tone: violet }
  - { id: ho, label: "handoffp 把 P 交出去", sub: "交给一条能跑 Go 代码的 M", row: 3, kind: backend }
  - { id: idle, label: "有 idle M？", row: 4, shape: note }
  - { id: wake, label: "唤醒它", sub: "mget + notewakeup", row: 5, tone: green }
  - { id: newm, label: "newm → clone 新线程", sub: "allocm：新 M、新 g0", row: 5, tone: red }
edges:
  - { from: call, to: sys }
  - { from: sys, to: mon }
  - { from: mon, to: ho }
  - { from: ho, to: idle }
  - { from: idle, to: wake, label: "有" }
  - { from: idle, to: newm, label: "没有" }
```

`startm` 的顺序是：先从 `sched.midle` 拿一条空闲 M（`mget`），有就唤醒它；没有才 `newm`：

- `allocm` 为这条 M 建新的 g0（Linux 非 cgo 是 16 KiB，Darwin 借 pthread 的栈）和 gsignal；
- `newosproc` 调 `clone`（Linux）或 `pthread_create`（Darwin），新线程从 `mstart` 开始跑；
- 新 M 拿到交出来的 P，从队列里取 G 继续跑。

什么时候会走到这条路上，常见四种：

| 触发 | 谁发起 | 条件 |
|---|---|---|
| 系统调用阻塞 | sysmon → `retake` → `handoffp` → `startm` | M 沉在内核里，P 交出去后队列里还有活 |
| 有 G 可跑、P 空着 | `newproc` / `ready` → `wakep` | 没有 spinning M，且有 idle P |
| 后台任务要线程 | `runtime.main` 的 `newm(sysmon)`、GC/清扫 | 启动和后台工作需要不占 P 的 M |
| cgo / 锁线程 | `newm` / 模板线程 | 调用了 C，或 `LockOSThread` 的线程不能直接 clone |

```callout
tone: amber
icon: ⚖
text: |
  **线程不是越多越好，运行时也一直在省。** 空闲 M 会 park 在 `sched.midle` 上等着被复用，
  不会用完就销毁；`startm` 优先拿 idle M，拿不到才 clone。
  同时有上限：`sched.maxmcount = 10000`，超过会直接 fatal（`program exceeds 10000-thread limit`）。
```

### 同样是「等」，代价不一样

```compare
first: 阻塞在哪
head: [G 的状态, 线程会怎样]
rows:
  - "channel / 锁 / timer":
      - "Gwaiting，挂到等待队列上"
      - "M 转头跑别的 G，线程数不变"
  - 网络 I/O:
      - "Gwaiting，fd 登记给 netpoller"
      - "事件到了把 G 放回某个 P 的 runnext，线程数不变"
  - 阻塞的系统调用（文件、部分设备）:
      - "Gsyscall，M 陪着沉进内核"
      - "sysmon 把 P 交出去；没有 idle M 就 clone 一条，线程数跟着涨"
```

## 08 · 速查

| 问题 | 答案 |
|---|---|
| 第一条线程谁给的 | 内核，exec 时给进程的主线程 |
| M0 是 Go 创建的吗 | 不是。它是 BSS 里的静态 `m` 结构，rt0_go 把这条线程登记成 M0 |
| g0 的栈是哪来的 | 借 M0 的栈，划出 64 KiB；新 M 的 g0 在 Linux 上是 16 KiB |
| P 什么时候建 | `schedinit → procresize(GOMAXPROCS)`，一次建齐，之后不按需加 |
| main G 什么时候建 | `rt0_go` 最后调 `newproc(mainPC)`，进 P0 的 runnext |
| `go f()` 会创建线程吗 | 不会。只造 G、进队列；只有 `wakep` 在「有活 + 空闲 P + 无 spinning M」时才会要线程 |
| 什么时候真的 clone 线程 | `startm` 没有 idle M 可复用时：系统调用 handoff、wakep、后台任务、cgo |
| 线程数有上限吗 | 有，`maxmcount = 10000`，超过直接 fatal |

## quiz

```quiz
- q: "Go 程序启动时，第一条操作系统线程是谁创建的？"
  options:
    - "Go runtime 在 rt0_go 里用 clone 创建的"
    - "内核在 exec 时给进程的主线程，Go 只是接管它"
    - "运行时分配 m0 结构时顺带创建的"
  answer: 1
  why: "m0 和 g0 都是 BSS 里的静态结构。rt0_go 做的是登记：把内核给的主线程指成 m0，把它的栈划给 g0。"
- q: "执行 `go f()` 之后，什么时候会新增一条操作系统线程？"
  options:
    - "每次 `go` 都新增一条，执行完回收"
    - "只有 startm 找不到空闲 M、又确实需要执行 Go 代码时才 newm → clone"
    - "G 进入阻塞状态时一定新增一条"
  answer: 1
  why: "`go` 只造 G 放进队列；wakep 可能叫一条 M，但优先复用 idle M。G 停在 channel 上不需要新线程，阻塞的系统调用才会拖着 M 一起沉下去。"
- q: "P 的数量和 M 的数量是什么关系？"
  options:
    - "一一对应，P 有几个 M 就有几条"
    - "P 的数量决定同时跑 Go 代码的 M 上限，M 可以更多（阻塞在系统调用里的不占 P）"
    - "P 是线程的别名，只是叫法不同"
  answer: 1
  why: "GOMAXPROCS 个 P 限制的是「同时执行 Go 代码的 M 数」。卡在系统调用里的 M 不持有 P，所以线程总数可以远超 P。"
```

## 接着往下读

| 想看什么 | 去哪 |
|---|---|
| G、M、P 各自是什么、怎么排队 | [goroutine 与线程 · 四个问题的答案](../goroutine-vs-thread/) |
| GMP 三件套与源码路径 | [GMP · G 怎么挂回线程](../goroutine-gmp/) |
| 阻塞的两条路：netpoller 与 hand-off | [阻塞了怎么办 · 两条路](../goroutine-poller/) |
| 抢占、偷队列、runnext | [调度器怎么挑 G](../goroutine-scheduler/) |
