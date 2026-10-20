## 01 · 先把四个说法校准

把这段对话里的判断摆在一起，逐条改准：

```compare
first: 你原来的说法
head: [更准确的说法, 差在哪]
rows:
  - "goroutine 是 Go runtime 创建出来的一个对象":
      - "它是 runtime 里的一条任务记录：一块栈、一份保存的现场、一个状态字段"
      - "叫「对象」容易以为它自己有行为。它不会动 —— 让它动起来的是某条操作系统线程"
  - "G 和线程一样，有自己的栈、寄存器、要执行的代码":
      - "有自己的栈（2 KiB 起步），寄存器是跑起来时借 CPU 的；让出时才把 SP、PC、BP 存进自己的 gobuf"
      - "代码在进程的代码段里只有一份，G 只记住自己执行到哪一行"
  - "一个进程里有很多 goroutine，最后都由线程执行":
      - "对。内核只认线程，G 是 runtime 在用户态排的队；同一刻最多 GOMAXPROCS 个 G 在跑 Go 代码"
      - "不用改，只需要补上「同一刻几个在跑」这个上限"
  - "goroutine 比线程快":
      - "单次交接快两个数量级；真正的差别是每条任务的固定成本低"
      - "「快」要看比什么：一次切换、一次创建，还是同一台机器上能同时开多少个"
```

```callout
tone: violet
icon: 🧭
text: |
  ==一句话：G 是 runtime 维护的任务，M 是内核调度的线程，G 借 M 的 CPU 时间跑。==

  下面四节分别答：G 里装了什么（02）、它比线程少背了什么（03）、换一个 G 时到底动了什么（04）、
  三者怎么把 G 送到核上（05），最后用两个交互看它的好处和代价（06）。
```

## 02 · 一个进程里到底站着谁

先给全貌。这张图上同时有：进程里共享的那一份、runtime 的调度器、排队和在跑的 G、线程 M、许可 P、netpoller，以及外面的内核和核。点任意一个零件能看到它的结构和实际连线。

```arch
svg: gv-map
maxScale: 1.3
caption: 从「队列里的 G」进来：它怎么落到一条线程上、又怎么用进程的代码和堆。点 M0 看线程多背了什么，点内核看谁在调度谁。
frames:
  - id: process
    boundary: 0
    kind: contains
    label: 一个 Go 进程 · 用户态
    detail: 这里面的东西都属于同一个进程：共享的代码、堆、fd 表、页表，加上 runtime 维护的 G 和 P，以及内核替它开出来的线程 M。内核不认识 G。
  - id: os
    boundary: 1
    kind: classification
    label: 内核态
    detail: 内核只管两件事：调度 M、把 M 放到核上。G 的排队、让出、恢复都发生在上面那一层，内核看不到。
  - id: hw
    boundary: 2
    kind: classification
    label: 硬件
    detail: 核上跑的永远是 M。G 能不能并行，取决于有多少个 M 同时握着 P 站在不同的核上。
bodies:
  shared:
    badge: 只有一份
    rows:
      - { k: 属于, v: 进程，不属于任何线程或 G }
    cells:
      - { label: 代码段 }
      - { label: 堆, tone: violet }
      - { label: 全局变量 }
      - { label: fd 表 }
      - { label: 页表 }
    note: 所有 G 读写同一份堆；并发读写要自己加锁。
  gq:
    badge: 排队
    rows:
      - { k: 每条, v: 一块栈 + 一份 gobuf + 状态 }
      - { k: 状态, v: Grunnable：能跑，还没线程 }
      - { k: 代价, v: 不占线程、不占核 }
    note: 队列在 P 里，全局队列兜底。
  p0:
    badge: 许可
    rows:
      - { k: runnext, v: 刚唤醒、最该接着跑的 G }
      - { k: runq, v: 256 槽的环形数组 }
      - { k: mcache, v: 分配缓存，省一把锁 }
      - { k: 数量, v: GOMAXPROCS 个 }
    note: M 要先拿到 P，才有资格执行 Go 代码。
  m0:
    badge: 内核线程
    rows:
      - { k: 身份, v: task_struct · TID · 时间片 }
      - { k: 两个栈, v: g0 栈 + 当前 G 的栈 }
      - { k: TLS, v: 线程本地存储，不属于 G }
      - { k: 数量, v: 可以多于 P }
    note: 调度代码在 g0，Go 代码在 curg 的栈上。
  g1:
    badge: 正在跑
    rows:
      - { k: 现场, v: 在 CPU 寄存器里 }
      - { k: 状态, v: Grunning }
      - { k: 归属, v: m.curg 指着它 }
    note: 一个 M 同一刻只跑一个 G。
  rt:
    badge: 代码 + 数据
    rows:
      - { k: 是什么, v: 进程里的代码和数据 }
      - { k: 管什么, v: 调度 · GC · 分配 }
    note: 链接进可执行文件的一段代码。
  netpoll:
    badge: 吸收等待
    rows:
      - { k: 等什么, v: socket 可读 / 可写 }
      - { k: 好处, v: 一个 M 看住很多 G }
    note: 等网络不占线程。
  kern:
    badge: 调度 M
    rows:
      - { k: 它管, v: 线程调度 · 时间片 · 页表基址 }
      - { k: 它不知道, v: G 的存在和队列 }
    note: 换下核时，它保存的是线程的现场。
  core:
    badge: 真正执行
    rows:
      - { k: 上面跑的是, v: M，不是 G }
      - { k: Go 能影响的, v: 只有 GOMAXPROCS }
    note: 迁移和时间片归内核，Go 不参与。
parts:
  shared:
    label: 进程共享的那一份
    sub: 代码 · 堆 · 全局变量 · fd 表 · 页表
    detail: 这一份不随执行流走。任何 G 调用的函数、读写的对象、打开的文件，都在这份共享资产里。所以「G 很轻」说的是它自己的那点东西轻，不是它用的内存轻。
  gq:
    label: 队列里的 G
    sub: 能跑，但还没有线程
    detail: 每个 G 的全部家当就是一块栈加一份记录。它排在哪个 P 的队列里，就等那个 P 被某条 M 拿走。
  p0:
    label: P0 · 运行许可
    sub: 本地队列 + 分配缓存
    detail: P 不是线程，也不是任务。它是一张许可证：一个 M 握着它，才能执行 Go 代码。它同时装着两样省锁的东西 —— 本地队列和 mcache。
  m0:
    label: M0 · 内核线程
    sub: 真正被内核调度的东西
    detail: M 上跑什么由 runtime 决定，M 什么时候上核由内核决定。这两件事分开，才有「用户态调度」这回事。
  g1:
    label: 正在跑的 G1
    sub: 借 M 的 CPU 时间
    detail: 严格说，G1 不是在「M 里面」，而是 M 的寄存器此刻指向它的代码、栈指针指着它的栈。换下去以后，它就只是内存里的一条记录。
  rt:
    label: Go runtime
    sub: 调度、GC、分配、poller
    detail: 它不是和进程并列的东西，也不是一个服务。它是一个普通程序里被链接进来的代码，加上它自己维护的数据结构。
  netpoll:
    label: netpoller
    sub: 一条线程照看很多个等待
    detail: 网络 I/O 的 G 不睡在 M 上：它把 fd 登记给 netpoller，自己变成 Gwaiting。事件到了，netpoller 把它放回某个 P 的 runnext。
  kern:
    label: 内核
    sub: 只调度 M
    detail: 内核对 G 一无所知。它保存和恢复的永远是线程的现场，这也是线程切换贵的根源。
  core:
    label: 核
    sub: 并行度最终受它限制
    detail: 同一刻一个核跑一条线程。GOMAXPROCS 大于核数时，多出来的 P 只是在轮流用同一批核。
tours:
  - id: path
    label: 一个 G 怎么落到核上
    steps:
      - { at: [gq], text: "`go f()` 执行时，新 G 被放进当前 P 的 ==runnext==。它此刻只占队列里的一个指针。" }
      - { at: [p0], text: "P 是许可证：谁握着它，谁才能从队列里取 G。本地队列不够用时，还会去全局队列或别的 P 那里拿。" }
      - { at: [m0], text: "M 调 `schedule()` 取出这个 G，`execute` 把它的 gobuf 装回寄存器 —— 到这一步 G 才开始跑。" }
      - { at: [g1], text: "跑起来的 G 在 ==M 的寄存器里==，不在 M 的结构体里。它一旦让出，现场就回到 gobuf。" }
      - { at: [shared], text: "它调用的代码、读写的堆，一直都在进程共享的那一份里 —— 这部分从来不属于某个 G。" }
  - id: cost
    label: 线程比 G 多背了什么
    steps:
      - { at: [m0, kern], text: "线程有内核身份：内核要替它维护 task_struct、内核栈和时间片。G 没有，内核不知道它存在。" }
      - { at: [g1], text: "G 只有自己的栈和 gobuf。==换 G 时内核不参与==，因为换的是用户态的三个寄存器和一个栈指针。" }
      - { at: [core], text: "但两者最终都要落到核上：并行度由核数封顶，G 再多也不能让一个核同时跑两条流。" }
```

图上有几条关系被简化了：所有 G 共用 `shared` 这一份，只画了一条代表线；netpoller 可以把就绪的 G 放进任何一个 P 的 runnext，也只画了一条。

## 03 · 线程比 goroutine 多背了什么

两边都要「暂停之后还能接着跑」，所以都有栈和现场。差别不在有没有，而在**谁保存、存在哪、要不要进内核**。

```compare
first: 维度
head: [操作系统线程, goroutine]
rows:
  - 谁创建 / 谁调度:
      - "内核（clone 出来的），由内核调度器决定谁上核"
      - "runtime（`newproc`）创建，由 Go 调度器决定谁跑"
  - 栈:
      - "Linux / glibc 默认预留 8 MiB，大小创建时定死，不能搬"
      - "2 KiB 起步，不够就换一块两倍大的内存整段搬过去，上限 1 GB"
  - 保存现场:
      - "内核栈 + 寄存器现场，由内核保存"
      - "gobuf 里三个值：SP、PC、BP；被异步抢占时另外保存完整寄存器"
  - 内核里的身份:
      - "task_struct、TID、优先级、时间片"
      - "没有。goid 在结构体里，但不导出给程序用"
  - 阻塞时:
      - "线程睡在内核里，内核换别的线程上核"
      - "状态改成 Gwaiting，M 转头再取一个 G"
  - 切换路径:
      - "用户态 → 陷入内核 → 内核调度 → 回到用户态"
      - "用户态内 `mcall` / `gogo`，不进内核"
  - 切换成本:
      - "微秒级；这台机器上跨线程唤醒一个 G 实测 13 µs"
      - "约 150 ns；这台机器上同一条线程内交接实测"
  - 额外的独占资源:
      - "TLS、信号掩码、内核栈"
      - "没有。TLS 属于 M；G 想固定在某条线程上要 `LockOSThread`"
  - 数量级:
      - "几千到几万条，再往上内核开始吃力"
      - "百万级。本机实测 100 万个 G，进程里只有 12 条线程"
```

### 栈：线程先留一大块，G 用多少长多少

```memmap
title: 一条线程的栈：先预留 8 MiB
sub: Linux / glibc pthread 默认值（macOS 上这个数更小）
high: "（栈底）"
low: "（栈往这个方向长）"
segments:
  - { label: 已经用到的部分, sub: "真正提交了物理页的只有这一小段", tone: blue, size: 0.9, dir: down, mark: 线程独享 }
  - { label: 还没碰过的预留, sub: "剩下几 MiB：只占着地址空间，不占物理内存", tone: muted, size: 3.6, mark: 预留 }
  - { label: 护栏页, sub: "栈的下边界，碰到就报错", tone: red, size: 0.35, mark: 保护页 }
note: ==8 MiB 不是一上来就吃 8 MiB 内存；但它把「最多能用多少」和「同时能开多少条」都定死了。==
```

线程栈的麻烦不只是大，是**不能搬**：内核不知道栈里哪一格是整数、哪一格是指针，扩容时没法把栈里的指针都改到新地址。

G 的栈可以搬，因为 Go 知道每个栈帧里哪些位置是指针（GC 的栈图就是这份信息）。于是 G 的栈从 2 KiB 起步：

```flow
grid: true
nodes:
  - { id: s2, label: "2 KiB", sub: "新 G 的栈", row: 0, shape: pill, tone: green }
  - { id: s4, label: "4 KiB", sub: "装不下：换新栈，整段复制", row: 0, shape: pill, tone: blue }
  - { id: s8, label: "8 KiB", sub: "再装不下，再复制一次", row: 0, shape: pill, tone: blue }
  - { id: smax, label: "1 GB", sub: "上限，到顶就栈溢出", row: 0, shape: pill, tone: red }
edges:
  - { from: s2, to: s4 }
  - { from: s4, to: s8 }
  - { from: s8, to: smax }
```

复制不是免费的：一次扩容要拷走整段旧栈，然后靠栈图把栈内指针改到新地址。所以「栈小」省的是预留，不是完全没有成本。

```callout
tone: amber
icon: ⚖
text: |
  **8 MiB 这个数是平台默认值，不是定律。** Linux / glibc 上是 8 MiB，macOS 的 pthread 上更小（同系列实测 524 KiB），
  也可以自己设。真正关键的不是具体数字，是**线程栈创建时定死、不能搬**。
```

## 04 · 同一条线程里换一个 G

你问的那句「CPU 在运行某条线程时，能不能不切换线程就换 goroutine 来跑」—— 能，这正是 Go 调度器的主要工作。下面这条时序是完整的一轮：G1 让出、调度器挑到 G2、G2 接着跑。

```seq
grid: true
participants:
  - { id: g1, label: G1, tone: green }
  - { id: m, label: M0 · g0 栈, tone: violet }
  - { id: s, label: schedule(), tone: blue }
  - { id: g2, label: G2, tone: amber }
segments:
  - { from: 1, to: 6, label: "整段都在用户态：内核里的 M0 一次也没被切走" }
messages:
  - { from: g1, to: m, label: "gopark：channel 上没有数据", kind: sync, note: 1 }
  - { from: m, to: m, label: "mcall：SP/PC/BP 存进 g1.sched", kind: self, note: 2 }
  - { from: m, to: s, label: "park_m：G1 改成 Gwaiting", kind: sync, note: 3 }
  - { from: s, to: s, label: "findRunnable：runnext 里是 G2", kind: self, note: 4 }
  - { from: s, to: m, label: "execute(G2)：curg = G2", kind: sync, note: 5 }
  - { from: m, to: g2, label: "gogo：装回 SP/BP/LR/PC，跳过去", kind: sync, note: 6 }
```

一条一条走一遍，看寄存器、gobuf 和状态各自怎么变：

```demo
widget: gswitch-lab
title: 同一条线程上，从 G1 换到 G2
actions: false
config:
  steps:
    - title: "G1 在跑，收到一个空的 channel"
      code:
        - "G1: <-ch          // 没有发送者，取不到值"
        - "// 不能原地等：这条线程还要去跑别的 G"
      kernel: "内核看到的：M0 一直在运行"
      curg: "G1"
      cpu: { pc: "0x10a2f0", sp: "0x40001f80", bp: "0x40001fb0", lr: "0x10a2c8", who: "G1 的代码" }
      g1: { st: Grunning, tone: green, where: "在 M0 上跑，现场就在寄存器里", buf: null }
      g2: { st: Grunnable, tone: amber, where: "排在 P0 的 runnext 上，等一个 M", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "此刻 CPU 上跑的是 G1，m0.curg 指着它。G2 已经排好队 —— 它只需要一条线程。"
    - title: "gopark → mcall：把现场写进 g1.sched"
      code:
        - "gopark(..., waitReasonChanReceive, ...)"
        - "  mcall(park_m)"
        - "    g1.sched.sp = RSP"
        - "    g1.sched.bp = R29"
        - "    g1.sched.pc = LR"
        - "    RSP = g0.sched.sp      // 换成调度栈"
      kernel: "内核看到的：M0 一直在运行"
      curg: "G1"
      cpu: { pc: "0x1009f40", sp: "0x40008000", bp: "0x0", lr: "0x10a2f8", who: "g0 的调度栈" }
      g1: { st: Grunning, tone: green, where: "刚把自己存进 g1.sched，还没改状态", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunnable, tone: amber, where: "还在 P0 的 runnext 上", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "==只存 SP、BP、PC 三个值。== 因为 G1 是在一次普通函数调用上让出的：活着的寄存器值早被编译器放进了 G1 自己的栈帧。恢复 SP 和 PC 之后，栈帧会把它们一个个装回来。"
    - title: "park_m：状态改成 Gwaiting"
      code:
        - "park_m(g1)"
        - "  casgstatus(g1, _Grunning, _Gwaiting)"
        - "  g1.waitreason = waitReasonChanReceive"
        - "  schedule()"
      kernel: "内核看到的：M0 一直在运行"
      curg: "—"
      cpu: { pc: "0x100a0a8", sp: "0x40008000", bp: "0x0", lr: "0x100a0b4", who: "g0：跑 park_m" }
      g1: { st: Gwaiting, tone: amber, where: "等 channel 上的数据；不属于任何 M", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunnable, tone: amber, where: "还在 P0 的 runnext 上", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "从这一刻起，G1 只是 runtime 里的一条记录和一块 2 KiB 的栈。**谁都可以接着用这条线程。**"
    - title: "schedule → findRunnable：从 runnext 取走 G2"
      code:
        - "findRunnable()"
        - "  if pp.schedtick%61 == 0 { GRQ 抽一个 }   // 每 61 次看一眼全局"
        - "  if pp.runnext != nil { return runqget(pp) }"
        - "  // 本地队列 → 偷一半 → netpoll"
        - "execute(g2)"
      kernel: "内核看到的：M0 一直在运行"
      curg: "—"
      cpu: { pc: "0x100a120", sp: "0x40008000", bp: "0x0", lr: "0x100a12c", who: "g0：跑 findRunnable" }
      g1: { st: Gwaiting, tone: amber, where: "等 channel 上的数据", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunnable, tone: violet, where: "被取走了，正要变成 Grunning", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "挑 G 不经过内核：就是在这条线程的 g0 栈上，跑一段 Go 代码。runnext 优先是为了让刚被唤醒的 G 接着跑，缓存还热。"
    - title: "execute：把 G2 挂到这条 M 上"
      code:
        - "execute(g2)"
        - "  mp.curg = g2"
        - "  g2.m = mp"
        - "  casgstatus(g2, _Grunnable, _Grunning)"
        - "  gogo(&g2.sched)"
      kernel: "内核看到的：M0 一直在运行"
      curg: "G2"
      cpu: { pc: "0x100a1c0", sp: "0x40008000", bp: "0x0", lr: "0x100a1cc", who: "g0：跑 execute" }
      g1: { st: Gwaiting, tone: amber, where: "等 channel 上的数据", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunning, tone: green, where: "挂在 M0 上，还没真正开始执行", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "状态先改，再跳。此刻 m0.curg 已经是 G2，但 CPU 还在 g0 的栈上跑调度代码。"
    - title: "gogo：装回寄存器，跳到 G2"
      code:
        - "gogo(&g2.sched)"
        - "  RSP = g2.sched.sp"
        - "  R29 = g2.sched.bp"
        - "  LR  = g2.sched.lr"
        - "  PC  = g2.sched.pc     // 跳过去"
        - "  g2.sched.sp = 0 ...   // 清空"
      kernel: "内核看到的：M0 一直在运行"
      curg: "G2"
      cpu: { pc: "0x10b140", sp: "0x40003f20", bp: "0x40003f50", lr: "0x10b120", who: "G2 的代码" }
      g1: { st: Gwaiting, tone: amber, where: "等 channel 上的数据", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunning, tone: green, where: "正在 M0 上跑，现场回到寄存器", buf: null }
      note: "换掉的只有三个寄存器和一条栈指针。**还是同一条线程、同一张页表、同一个核。**"
    - title: "整轮结束：内核从头到尾没参与"
      code:
        - "// 内核侧：没有 trap、没有调度、没有换页表"
        - "// 本机实测：这样一次交接约 150 ns"
      kernel: "内核看到的：M0 一直在运行；线程号、时间片、页表都没变"
      curg: "G2"
      cpu: { pc: "0x10b140", sp: "0x40003f20", bp: "0x40003f50", lr: "0x10b120", who: "G2 的代码" }
      g1: { st: Gwaiting, tone: amber, where: "等 channel 上的数据", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunning, tone: green, where: "正在 M0 上跑", buf: null }
      note: "三件事要说清：① 这不是**线程切换**，内核只是继续跑 M0；② 缓存还是要重新热 —— G2 的工作集和 G1 不一样，只是 TLB 不用换；③ G 不绑定 M：如果 G2 是被别的 P 抢走的，它会在那条 M 上恢复。"
```

### 三个容易记反的细节

| 容易记成的样子 | 实际发生的 |
|---|---|
| 换 G 要保存「全部寄存器」 | 同步让出只存 **SP、PC、BP**。活着的值已经在 G 自己的栈帧里，恢复 SP/PC 之后栈帧会把它们装回来 |
| 抢占也走同一条路 | 异步抢占（Go 1.14 起，runtime 发一个信号，Linux 上是 SIGURG）可能打断在任意一条指令上，那时寄存器里还有活值 —— 所以 `asyncPreempt` 把完整寄存器存到 **G 的栈上**，扩展状态存进 `g.xRegs` |
| G 换下去以后就固定在一条线程上 | 唤醒时哪个 P 取到它，就在哪条 M 上恢复；G 和 M 没有绑定关系 |

## 05 · GMP：三个角色把 G 送到核上

只要记住三句话：

- **G** 是任务：栈 + 现场 + 状态，数量可以很大；
- **M** 是线程：内核真正调度的东西，数量可以多于 P；
- **P** 是许可：握着它才能跑 Go 代码，数量由 `GOMAXPROCS` 决定。

一个 `go` 语句之后，过程是这样的：

1. `newproc` 造出一个新 G，放进**当前 P 的 runnext**（不是随机分给别的 P）；
2. 某个握着 P 的 M 调 `schedule()`，按顺序取：每 61 次调度抽查一次全局队列 → 本地 runnext / 本地队列 → 本地空了去别的 P **偷一半** → 最后看 netpoller；
3. `execute` 把取到的 G 挂到 M 上（`curg`），`gogo` 把它的现场装回寄存器 —— 到这一步 G 才真的开始跑；
4. G 阻塞（等 channel、等锁、等网络）就变成 `Gwaiting`，M 不陪着等，转头再取一个；等网络的那部分交给 netpoller；
5. G 卡在系统调用里时，M 会陪着进内核，`sysmon` 发现后把这个 P 交给别的 M —— 所以 M 的数量可能远多于 P。

```demo
widget: gmp-lab
title: GMP 调度台：自己跑一遍
actions: false
config:
  gomaxprocs: 3
  goroutines: 16
  ioRatio: 0.4
  seed: 7
```

创建时所有 G 都落在 P0 的队列里 —— 这是真实情况，也是「一边倒」的常态。点「跑一步」看 P 怎么取、怎么偷、网络就绪的 G 又回到哪儿；把 GOMAXPROCS 调到 1，再看同样的 16 个 G。

`GOMAXPROCS` 限制的**不是线程总数**，而是「同一刻最多几个 M 在执行 Go 代码」。卡在系统调用里的 M 不算，空闲的 M 可以很多。

## 06 · 好处：不是更快，是敢开更多

三条好处，各有各的边界：

| 好处 | 来自哪 | 什么时候不成立 |
|---|---|---|
| 开得起 | 每个 G 2 KiB 栈起步，按需长 | 每个 G 真的要深递归、大数组时，栈还是会涨上去 |
| 等得起 | 网络等待交给 netpoller，不占线程 | 文件 I/O 这类真阻塞的系统调用仍要一条 M 陪着；锁和 channel 只是把 G 改成 Gwaiting |
| 切得动 | 用户态交接，约 150 ns | 切换次数 × 任务数很大时，总量仍然可观（缓存也会被打散） |

先看「同样的任务数，两条路的固定成本差多少」：

```demo
widget: spawn-budget-lab
title: 10 个任务到 100 万个任务：两条路的账
actions: false
config:
  stops: [10, 100, 1000, 10000, 100000, 1000000]
  p: 10
  threadStack: 8
  gStack: 2048
  start: 3
  tail: 线程栈按 Linux / glibc 的 8 MiB 默认值算，是虚拟地址预留，不是常驻内存；G 的 2 KiB 是 Go 源码里的 stackMin。
```

真正的分水岭在「等」上。网络 I/O 的等待被 netpoller 吸收，M 的数量不变；文件 I/O 的等待要一条 M 陪着沉进内核，M 跟着 G 一起涨：

```demo
widget: handoff-lab
title: 同样是等，线程数不一样
actions: false
config:
  gomaxprocs: 4
  blocked: 30
  max: 120
```

```callout
tone: amber
icon: ⚖
text: |
  **便宜不等于免费。** 栈扩容要复制整段旧栈；GC 要扫每一个 G 的栈；100 万个 G 都能开出来，
  难的是让它们都能结束 —— 一个卡在 channel 上的 G，会连着它的栈一起留到进程退出。
```

## quiz

```quiz
- q: "一个 goroutine 自己持有哪些东西？"
  options:
    - "栈、保存的现场（gobuf）、状态；代码和堆属于进程"
    - "独立的地址空间、页表、fd 表"
    - "内核栈、TLS、时间片"
  answer: 0
  why: "G 只有自己的栈和一条任务记录。代码段、堆、fd 表、页表都在进程里，所有 G 共用；内核栈和 TLS 属于 M。"
- q: "G1 阻塞后，Go 在同一个 M0 上换成 G2 执行。内核知道这件事吗？"
  options:
    - "知道，每次换 G 都要陷入内核"
    - "不知道：保存和恢复的是用户态的寄存器与栈指针，内核看到的还是同一条线程"
    - "只有网络 I/O 时内核才知道"
  answer: 1
  why: "mcall 把 SP/PC/BP 存进 G1 的 gobuf，gogo 把 G2 的装回寄存器，全程在用户态。内核没有 trap、没有换页表，M0 一直是同一条线程。"
- q: "GOMAXPROCS=4 时，这个进程最多有几条操作系统线程？"
  options:
    - "4 条，和 P 一样多"
    - "不固定：同时执行 Go 代码的最多 4 条，卡在系统调用里的 M 可以更多"
    - "1 条，Go 调度器会把所有 G 排在一条线程上"
  answer: 1
  why: "P 的个数卡住的是「同时跑 Go 代码的 M 数」。M 可以多于 P：卡在系统调用里的 M 会让出 P，runtime 可能再开新 M。"
```

## 接着往下读

这四节是入口，每一块在系列里都有一篇更细的：

| 想看什么 | 去哪 |
|---|---|
| 一条执行流到底由什么构成、一次切换贵在哪 | [① 一条执行流有多重](../goroutine-weight/) |
| 1:1、旧 M:N、async/await 各死在哪 | [② 前人两条路线怎么死的](../goroutine-why-not/) |
| G 的结构、栈怎么长、状态有哪些 | [③ Goroutine 到底是什么](../goroutine-anatomy/) |
| GMP 三件套、源码路径、GOMAXPROCS 与容器 | [④ GMP · G 怎么挂回线程](../goroutine-gmp/) |
| 网络走 netpoller、真阻塞走 hand-off | [⑤ 阻塞了怎么办 · 两条路](../goroutine-poller/) |
| 61 次抽查、偷一半、异步抢占 | [⑥ 调度器怎么挑 G](../goroutine-scheduler/) |
| 泄漏、版本敏感、排障入口 | [⑦ 该开还是不该开](../goroutine-practice/) |
