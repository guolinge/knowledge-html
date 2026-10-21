## 先把两个运行时的零件摆在一起

左边是 Go 二进制，右边是 Node 进程。两个框里各有四五个零件，底下都落到同一个操作系统。==同一个 read() 在两边会停在不同的零件上== —— 这就是「语言框架的差别」具体指什么。

```arch
svg: runtime-two-lanes
caption: 从 G 点进去看「任务怎么排队」，或者从 JS 主线程点进去看「回调交给谁」。两条导览各走一遍同一个读请求。
frames:
  - id: go
    boundary: 0
    kind: contains
    label: Go 二进制：runtime 编在里面
    detail: 调度器、netpoller、GC 都是这个二进制的一部分，和语言同版本。所以 Go 能自己决定「谁跑、谁等、谁停」。
  - id: node
    boundary: 1
    kind: contains
    label: Node 进程：V8 + libuv 拼起来
    detail: JS 引擎（V8）和 I/O 库（libuv）独立演进，Node 只是把它们和一堆内建模块装进一个进程。所以「升级 Node」其实是换这两样东西。
  - id: osf
    boundary: 2
    kind: contains
    label: 两个都落到这儿
    detail: 线程、系统调用、多路复用、核，都归内核。两套运行时的差别不在这一层，而在它们怎么用这一层。
bodies:
  g:
    badge: 几十万个
    rows:
      - { k: 栈, v: 2 KiB 起，不够就搬大的 }
      - { k: 现场, v: SP / PC / BP 三个值 }
      - { k: 状态, v: 一个整数，等于排队还是等 }
    note: 代码段、堆、fd 表都是进程的，G 不背
  netpoll:
    rows:
      - { k: 谁在等, v: G，不是线程 }
      - { k: 底层, v: epoll / kqueue / IOCP }
    note: 只有 socket 这类能 poll 的才走这条
  p:
    rows:
      - { k: runnext, v: 1 格 }
      - { k: runq, v: 256 槽环形数组 }
      - { k: mcache, v: 小对象分配不用锁 }
    note: 数量 = GOMAXPROCS；可以没有 M 持有
  m:
    rows:
      - { k: g0, v: 16 KiB 系统栈，调度代码在这跑 }
      - { k: 数量, v: 可以多于 P }
      - { k: 卡在系统调用, v: 不占 P }
  js:
    rows:
      - { k: JS 栈, v: 一条，固定大小 }
      - { k: 堆, v: 分代，归 V8 }
      - { k: 线程, v: 默认只有这一条在跑 JS }
    note: 你的回调、await 后面那段，都在这里
  uvpoll:
    rows:
      - { k: 走这条的, v: 网络 socket（非阻塞） }
      - { k: 主线程, v: 不陪着等，只处理回调 }
    note: 文件、DNS、crypto 不走这条
  queue:
    rows:
      - { k: 一轮六阶段, v: timers → pending → poll → check → close }
      - { k: 队列, v: 每个阶段一个 FIFO }
    note: 你的回调按阶段排队，不是「随便插队」
  pool:
    rows:
      - { k: 默认几条, v: 4（UV_THREADPOOL_SIZE） }
      - { k: 干什么, v: fs、dns.lookup、crypto、zlib }
      - { k: 谁在等, v: 池线程陪着阻塞 }
    note: 超出 4 个的任务在池子的队列里等
  os:
    rows:
      - { k: 系统调用, v: read / write / mmap }
      - { k: 多路复用, v: epoll / kqueue / IOCP }
      - { k: 线程, v: pthread_create，内核调度 }
    note: 两套运行时都在这一层之上各搭了一套
parts:
  g:
    label: G
    sub: goroutine
    detail: 一个任务 = 一块栈 + 一份现场 + 一个状态。它不绑定线程，谁拿到谁跑。
  netpoll:
    label: netpoll
    sub: 网络轮询器
    detail: socket 设成非阻塞，读不到就把 G 挂这儿。==等的时候没有线程在场==。
  p:
    label: P
    sub: 运行许可 + 本地队列
    detail: M 拿到 P 才能跑 Go 代码；M 卡在系统调用时，P 可以转手给别的 M。
  m:
    label: M
    sub: 内核线程
    detail: 真正被内核调度的东西。数量可以远多于 P —— 卡在系统调用里的那些不占 P。
  js:
    label: JS 主线程
    sub: 只有一条
    detail: 所有 JS 代码（包括 await 之后那段）都在这条线程上。它被卡住，整个进程就停摆。
  uvpoll:
    label: libuv poll
    sub: 网络那条路
    detail: 和 Go 的 netpoll 是同一个思路 —— 非阻塞 socket + epoll/kqueue/IOCP，只是主线程不陪着等。
  queue:
    label: 事件循环
    sub: 六个阶段的队列
    detail: 一轮里依次走完几个阶段，每个阶段把自己队列里的回调清空。你的代码只在「取回调」这一刻被调用。
  pool:
    label: 线程池
    sub: 4 条，全是阻塞操作
    detail: 文件、DNS、crypto、zlib 这些内核没有异步接口的活，交给池线程真阻塞。==等的是线程，不是回调==。
  os:
    label: 操作系统
    sub: 同一套接口
    detail: 线程、系统调用、多路复用、核 —— 两套运行时都得通过这一层，差别只在怎么用它。
tours:
  - id: go-read
    label: Go 侧：一次 socket 读
    steps:
      - at: [g]
        text: G 调 read，内核说数据没到。==挂起的是这个 G，不是那条线程。==
      - at: [netpoll]
        text: G 被登记到 pollDesc 上，状态改成 Gwaiting。线程转头去跑队列里的下一个 G。
      - at: [p]
        text: 数据到了，netpoll 把 G 放回某个 P 的本地队列 —— 还是那条 2 KiB 的栈，接着往下读。
  - id: node-read
    label: Node 侧：一次 fs.readFile
    steps:
      - at: [js]
        text: JS 调 fs.readFile，登记一个回调就立刻返回 —— 主线程一秒都不等。
      - at: [queue]
        text: 回调挂在队列上。这时主线程已经在跑别的 JS 了。
      - at: [pool]
        text: 真正的 read 在池子里的一条线程上阻塞。池子默认只有 4 条，第 5 个任务要排队。
      - at: [os]
        text: 池线程进内核等磁盘；读完了，回调被排进事件循环，等下一轮被取出来执行。
```

左边一个任务只花 2 KiB，所以能开几十万个；右边只有一条 JS 线程，所以你的代码一秒都不能卡。==这两句话已经把后面所有差别都框住了。==

## 你说对的那半句，和「只是内存和线程」

你画的梯子是对的，而且是对的层次：

```text
你的代码 → 语言/运行时给的抽象 → 系统调用 → 硬件
```

不管 Go 还是 Node，最后都得用内核给的那一套：创建线程、申请内存、读写文件、收发网络包。==这一层两边没有差别，差别在「谁去用、什么时候用、用完怎么收」。==

但「差别就是怎么利用内存和利用线程」把结果说成了原因。内存和线程是**材料**，真正分开两条路的是四个职责的分工：

```compare
first: 职责
head: [Go runtime, Node（V8 + libuv）]
rows:
  - 下一条执行什么: ["调度器：G/M/P + 本地队列 + 窃取", "事件循环：一轮六个阶段，按阶段取回调"]
  - 阻塞的调用谁去等: ["能 poll 的交给 netpoll（G 挂起）；不能的让 M 陪着，P 转交", "网络交给 libuv poll；文件/DNS/crypto 交给线程池"]
  - 内存谁回收: ["runtime 的 GC：并发标记清扫，非分代、非压缩", "V8 的 GC：分两代，Scavenger 复制 + Mark-Compact"]
  - 并行度谁决定: ["`GOMAXPROCS` 个 P，同一刻最多这么多条 M 跑 Go 代码", "JS 只有一条线程；要更多就自己开 `worker_threads`"]
```

四行里最要命的是第二行。==Go 让「等」变成任务的一个状态；Node 让「等」变成池子里一条线程的差事，而你的代码只负责处理回调。==

这一条分岔，往下长出了后面所有差别：栈要不要可搬、GC 要不要抢占、代码能不能写出「阻塞」、并发到底是不是并行。

## Go 侧：一次 socket 读，线程走人

先看 Go。读一个 socket，数据还没到：

```seq
grid: true
participants:
  - { id: g, label: "G · 读 socket", tone: green }
  - { id: m, label: "M · 内核线程", tone: blue }
  - { id: np, label: netpoller, tone: violet }
  - { id: p, label: "P 的本地队列", tone: amber }
messages:
  - { from: g, to: m, label: "read(fd)：内核返回 EAGAIN", kind: sync, note: 1 }
  - { from: m, to: np, label: "G 登记到 pollDesc，状态改成 Gwaiting", kind: sync, note: 2 }
  - { from: m, to: p, label: "同一条线程接着取下一个 G", kind: sync, note: 3 }
  - { from: np, to: p, label: "数据到了：G 放回 runnext", kind: sync, note: 4 }
```

四步里最关键的是第 2 步：==挂起的是 G，不是线程。== G 的栈（2 KiB 起步）还留在原地，寄存器里的现场被存进 `g.sched`，这条 M 转头就去跑别的 G 了 —— 内核从头到尾不知道发生过什么。

第 4 步之后，G 被某条 M 取到，从 `gopark` 里返回，接着往下读。它可能换了条线程，但代码里看不出来：`conn.Read(buf)` 就是一次普通调用。

```callout
tone: amber
icon: ⚖
text: |
  这条路只对**能 poll 的东西**成立：socket、管道。

  普通文件在 Linux 上加不进 epoll（`epoll_ctl` 直接返回 `EPERM`），Darwin/BSD 的 kqueue 对普通文件也不可靠 —— 所以读磁盘时线程只能陪着进内核。这时候保命的是另一条设计：==M 陪内核，P 交出去==，别的 G 继续跑。
```

## Node 侧：一次 file 读，池子里的一条线程替你去等

同样一句「读」，Node 的走法完全不同：

```seq
grid: true
participants:
  - { id: js, label: "JS 主线程", tone: green }
  - { id: pool, label: "libuv 线程池", tone: violet }
  - { id: disk, label: 磁盘, tone: amber }
  - { id: q, label: "事件循环队列", tone: blue }
messages:
  - { from: js, to: pool, label: "fs.readFile：包成 uv_fs_t 投进池", kind: sync, note: 1 }
  - { from: pool, to: disk, label: "池线程真的阻塞在 read 上", kind: sync, note: 2 }
  - { from: disk, to: pool, label: 读完，数据在内核缓冲里, kind: reply, note: 3 }
  - { from: pool, to: q, label: "回调排进队列", kind: sync, note: 4 }
  - { from: q, to: js, label: "下一轮取出来执行", kind: sync, note: 5, gap: 30 }
```

第 1 步返回得极快：主线程只是把一个任务投进池子，然后立刻回去跑别的 JS。真正阻塞的是**池子里的那条线程**，和你写的 JS 没有关系。

所以「Node 是单线程的」这句话只在说一件事：==你的 JS 只在一条线程上跑==。进程里其实有好几条：

```cards
cols: 4
items:
  - { title: 空转的 Node 进程, desc: 本机 7 条线程 —— 主线程 + V8 后台 + libuv 的几条, tag: "7 条", tone: muted }
  - { title: 同时 8 个 fs 读, desc: 变成 11 条：只多了 4 条，正好是池子的默认大小, tag: "+4 条", tone: green }
  - { title: 24 个 fs 读, desc: 还是 11 条 —— 多出来的 20 个在池子的队列里等, tag: "+4 条", tone: green }
  - { title: UV_THREADPOOL_SIZE=8, desc: 同样 8 个读，变成 15 条：池子按这个值开线程, tag: "+8 条", tone: blue }
```

上面四个数字是 `ps -M` 数出来的（Node 24.19.0 / macOS 26 / Apple M4）。池子默认 4 条，启动时可以用 `UV_THREADPOOL_SIZE` 改，上限 1024 —— 但改大只是让更多阻塞调用同时等，不会让你的 JS 变快。

```callout
tone: red
icon: ⚠
text: |
  **反过来说，主线程一卡，整个进程就停摆。**

  本机实测：一段 200 ms 的纯计算循环里，一个 10 ms 的定时器==触发 0 次==。所以 `readFileSync`、大 `JSON.parse`、同步 crypto，在 Node 里不是「慢一点」，是把所有连接一起冻住。

  要跑 CPU 密集的活，得自己开 `worker_threads` —— 它共享内存，但不共享事件循环。
```

## Node 那个循环，一轮到底转几圈

「池子完成之后回调排进队列」，这个队列不是一个，而是按阶段分的几个：

```lane-stack
- badge: 阶段 1
  title: timers
  desc: 到期的定时器和 interval 回调先跑
  tone: green
  nodes:
    - { title: setTimeout / setInterval, sub: "delay 到了才执行", tag: 到期 }
  next: "阶段 2 :: pending callbacks :: 上一轮推迟下来的 I/O 回调"

- badge: 阶段 2
  title: pending callbacks
  desc: 上一轮没做完的 I/O 回调在这里补跑
  tone: blue
  nodes:
    - { title: 被推迟的 I/O 回调, sub: "例如某些 TCP 错误", tag: 补跑 }
  next: "阶段 3 :: poll :: 取新 I/O —— 没事干就在这里等"

- badge: 阶段 3
  title: poll
  desc: 取新的 I/O 事件；没有活的时候，循环就停在这里等
  tone: violet
  nodes:
    - { title: 可读 / 可写的 socket, sub: "libuv poll 返回就绪", tag: 主战场 }
    - { title: 线程池完成的任务, sub: "fs / DNS / crypto 的回调", tag: 汇入 }
  next: "阶段 4 :: check :: setImmediate 的回调在这一站"

- badge: 阶段 4
  title: check
  desc: setImmediate 的回调在这里跑
  tone: amber
  nodes:
    - { title: setImmediate, sub: "排在 poll 之后、下一轮之前", tag: 立即 }
  next: "阶段 5 :: close callbacks :: socket.on('close') 这类"

- badge: 阶段 5
  title: close callbacks
  desc: 句柄关闭时的收尾回调
  tone: muted
  nodes:
    - { title: socket.on('close'), sub: "句柄关掉之后触发", tag: 收尾 }
  next: "一轮结束 :: 回到 timers :: 每个阶段之间，先清 nextTick，再清 Promise 微任务"
```

每一轮就是这五站，每站有自己的 FIFO 队列，进站之后把这个队列清空（或者达到回调上限）才走下一站。官方文档里还有一站 `idle, prepare`，只给内部用，写业务遇不到。

两个容易被忽略的位置：

- **poll 会阻塞。** 没有定时器、没有 `setImmediate` 的时候，循环就停在 poll 等 I/O —— 这不是浪费，是省 CPU。
- **每个阶段之间要清队列。** `process.nextTick` 排的回调，文档的原话是「在当前调用栈结束后、事件循环继续之前、任何其他排队的任务或阶段之前」执行；`await` 之后的代码（微任务）也插在这些间隙里。

==Node 的「并发」不是同时执行，是排队轮流执行。== 一条线程上，回调之间永远不会真的并行 —— 这也解释了为什么一个慢回调会拖住后面所有人。

## 内存：一个要扫几十万个栈，一个只扫一个堆

两种模型的差别，落到内存上就一句话：**要扫的东西不一样多。**

```compare
first: 维度
head: [Go, Node（V8）]
rows:
  - 栈: ["每条任务一块，2 KiB 起；不够就换一块两倍大的，整段搬过去（上限 1 GB）", "只有一条 JS 栈，大小固定；本机递归 10384 层就 RangeError"]
  - 堆怎么分: ["一个堆，按 P 切分配区（mcache），常见路径不抢锁", "分两代：新生代（nursery / intermediate）+ 老生代"]
  - 回收算法: ["并发标记清扫，**非分代、非压缩**（源码注释原话）", "两套：Scavenger 复制新生代；Mark-Compact 收全堆并压缩"]
  - 停世界要等什么: ["等所有 P 到安全点；有 G 不肯让就用 SIGURG 抢它", "等主线程到安全点；堆上限本机约 4288 MiB"]
  - 为什么这么选: ["精度换并发：栈要能扫、能搬，所以必须有精确栈图和抢占", "分代假设：大多数对象很快死，复制活下来的少数更便宜"]
```

第五行是因果，值得单独说：Go 的 GC 是**并发**的，但它仍然需要短暂停世界，让所有 P 到一个「内存状态一致」的点。而 P 上跑的是几十万个 G —— 如果某个 G 在死循环里不肯到安全点，这次 GC 就卡住了。这就是 Go 必须有异步抢占的原因。

V8 这边没有这个问题：只有一个栈、一条主线程，等它到安全点就行。**「要不要抢占」不是风格选择，是「你有多少个栈要停」的直接后果。**

## 「语言框架」这个词，两边指的不是一回事

你说「它们各自实现了自己的一套抽象的系统，简单来说就是一个运行时」—— 这句在 Go 上很贴切，在 Node 上要拆开看。

```tree
- label: 装进一个进程里的东西
  tone: violet
  note: 两边的「运行时」都不是一个东西，是一组零件的装配方式
  children:
    - label: Go 的二进制
      note: 静态编译，一次装好，版本和语言绑死
      children:
        - { label: 编译器产物, note: 机器码，运行时不再改 }
        - label: runtime
          sub: src/runtime
          note: 编进每一个二进制，不是外部依赖
          children:
            - { label: 调度器 G / M / P, note: 几十万个任务压到十几条线程上 }
            - { label: netpoller, note: socket 就绪通知 }
            - { label: GC, note: 并发标记清扫 }
            - { label: 栈管理, note: 2 KiB 起步，按需搬 }
        - { label: 标准库, note: net 包直接用 netpoller，不经过 libc }
    - label: Node 的进程
      note: 一个宿主程序，把三样东西装在一起，各自独立升版本
      children:
        - { label: V8, sub: 13.6.233.17, note: 执行 JS、JIT、管堆和 GC }
        - { label: libuv, sub: 1.52.1, note: 事件循环、线程池、poll }
        - { label: 内建模块, note: fs / net / crypto / zlib —— 决定哪些活进线程池 }
        - { label: node 可执行文件, note: 把上面三样接起来，再暴露 process / Buffer 这些全局 }
```

差别在升级方式上：换 Go 版本，你换的是**编译器和 runtime**（调度器、GC 的策略可能一起变）；换 Node 版本，你同时换掉**V8 和 libuv**，JS 语法、GC 行为、I/O 实现都可能变。所以「Node 24 的 fs 比 Node 18 快」这种事，跟「Go 1.22 的调度器比 1.20 好」不是同一类变化。

## 把这套对照缩成一张词表

```compare
first: 这件事
head: [Go, Node]
rows:
  - 你的代码跑在: ["某条 M 上；G 会被换到任意 M", "主线程；默认只有这一条"]
  - 一次并发的单位: ["goroutine（2 KiB 起步）", "一个回调 / 一条 Promise 链（不另占栈）"]
  - 等网络: ["netpoll，挂起 G", "libuv poll，主线程不陪"]
  - 等磁盘 / DNS / crypto: ["M 陪着进内核，P 转交给别人", "线程池里的一条线程陪着，池子默认 4 条"]
  - 并行度: ["`GOMAXPROCS` 个 P", "1（JS）+ 自己开的 worker"]
  - 能不能被强行打断: ["能：Go 1.14 起用 SIGURG 异步抢占", "不能：回调必须自己让出"]
  - 栈: ["每条任务一块，可搬", "一条，固定"]
  - 有没有「可转交的工位」: [{ text: "有：P", tone: green }, { text: "没有对应物 —— 没有并行度可调，也就没有工位要转交", tone: red }]
```

最后一行是你原来那句话里缺的那块：==Go 和 Node 的差别不是「同一个东西的两种实现」，而是「两套零件清单」。== 你在 Go 里能指出 P、g0、本地队列，在 Node 里找不到对应物，只能找到事件循环、线程池、poll。

## 回到你那句话

原话是：

> 底层的差别就是怎么利用内存和利用线程，各自实现了自己的一套抽象的系统，最终接口都是操作系统规定的那一套。

前半句要改，后半句完全对。改完是这样：

```summary
title: 一句话
text: |
  两套运行时都站在同一套系统调用上。==真正的分岔是「阻塞归谁承担」==：Go 把它记进一个任务的状态（G 挂起、P 可转交），Node 把它外包给有限的线程池（主线程只处理回调）。

  栈、GC、抢占、并行度，都是这条分岔的下游结果。
```

如果只能记三句话：

1. **Go 的任务多、线程少，因为「等」不占线程；Node 的线程也少，因为「等」被外包给了 4 条池线程。**
2. **Go 的代码允许阻塞（那是任务级事件）；Node 的代码不允许阻塞（那是进程级事故）。**
3. **Go 能抢你的代码，Node 不能 —— 因为 Go 有几十万个栈要停，Node 只有一个。**

## 自测

```quiz
- q: 为什么 Node 里一段 200 ms 的纯计算会把所有请求一起拖住，而 Go 里一个死循环只影响它自己？
  a: |
    Node 的 JS 只有一条线程：这段计算占着主线程，事件循环转不动，所有回调都排不上。
    Go 里一个 G 占着一条 M 和 P，但 sysmon 会在 10 ms 后抢它，把 P 让给别的 G —— 受影响的是调度延迟，不是整个进程。
- q: '"Node 是单线程的" 这句话哪里不准确？'
  a: |
    只对 JS 成立。进程里还有 V8 的后台线程、libuv 的事件循环和线程池（默认 4 条）、inspector 等。
    本机实测：空转的 Node 进程 7 条线程，8 个并发 fs 读变成 11 条。
- q: 同样是读 4 KiB，读 socket 和读普通文件在 Go 里为什么走两条路？
  a: |
    socket 能设成非阻塞并用 epoll/kqueue 等就绪：G 挂起，线程走人。
    普通文件在 Linux 上连 epoll 都注册不进去（EPERM），read 只能真的进内核阻塞 —— 这时让 M 陪着，把 P 交给别的 M。
- q: 为什么 Go 需要异步抢占，V8 不需要？
  a: |
    Go 的 GC 要停世界、让所有 P 到安全点，而这些 P 上跑着几十万个 G，必须保证每个都能被打断。
    V8 只有一个 JS 栈、一条主线程，等它自己到安全点就够了。
```
