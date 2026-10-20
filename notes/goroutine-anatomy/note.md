## 01 · 最小的那个例子

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    done := make(chan struct{})   // 一条带类型的管道，只能传 struct{}
    go func() {                   // go 后面是一个函数调用
        fmt.Println("我在另一个 G 里")
        close(done)               // 关掉管道，等于发一个「结束」信号
    }()
    <-done                        // 主 G 停在这里，等管道关闭
    fmt.Println("goroutines =", runtime.NumGoroutine())
}
```

这段程序打出两行：先「我在另一个 G 里」，后「goroutines = 1」。`go func(){...}()` 这一句执行完，主函数没有等它，而是继续往下走到 `<-done`；让主 G 停下来的是那行接收。

`go` 语句的参数是一个函数调用。编译器会把它改写成 `runtime.newproc`（`proc.go:5295`），把函数入口和参数打包，交给一个新的 G。这个 G 什么时候开始跑，取决于调度器什么时候把它从队列里取出来 —— 这也是为什么上面两行输出的顺序是确定的：`<-done` 把主 G 挂起了。

那这个被创建出来的东西是什么？

- 它不是函数：函数只是它的入口，函数返回它也不会立刻消失（还有一些收尾）。
- 它不是线程：它的创建不伴随系统调用，一百万条 G 也可能只对应十一条线程。
- 它不是进程：它没有自己的页表，也没有自己的文件描述符表。

它是 runtime 管理的一个**任务**：一个入口、一份栈、一份寄存器现场、一个状态。调度器把它搬到一个 M 上，它就跑；搬走，它就停。

## 02 · 一个 G 里装了什么

```arch
svg: go-g-anatomy
caption: 从中间那个 G 进入：左边是它自己的栈，右边是它排队和运行时要挂的东西，下面是 GC 和复用池。
frames:
  - id: rt
    boundary: 0
    kind: contains
    label: Go runtime 自己管
    detail: 函数入口、栈、g 结构体、队列、GC 的栈图都在进程里。调度、阻塞、栈扩容都不需要进内核。
bodies:
  g:
    badge: 一个任务
    rows:
      - { k: stack, v: "栈的起止地址（lo / hi）" }
      - { k: sched, v: "gobuf：sp / pc / g / ctxt / lr / bp 六个字" }
      - { k: atomicstatus, v: "当前状态，见下面的状态表" }
      - { k: goid, v: "runtime 内部编号；没有导出 API" }
      - { k: waitreason, v: "阻塞原因；pprof 里显示的就是它" }
      - { k: m, v: "此刻在哪个 M 上（不在跑时为 nil）" }
    note: g 结构体约 600 B；栈另算
  stack:
    badge: 2 KiB 起步
    rows:
      - { k: 不够时, v: 分配一块 2 倍大的连续内存，整体搬过去 }
      - { k: 搬家时要修, v: 栈内所有指针 }
      - { k: 上限, v: "64 位 1 GiB / 32 位 250 MiB（proc.go:160）" }
    note: 栈的地址会变，所以不能把栈上的地址长期交给别人
  fn:
    rows:
      - { k: 入口, v: startpc }
      - { k: 参数, v: "go 语句求值后复制到新 G 的栈上" }
      - { k: 闭包, v: "捕获的变量打包成一个 funcval" }
  p:
    rows:
      - { k: runnext, v: 1 格 }
      - { k: LRQ, v: "256 槽" }
    note: 排队时不占 M，只占队列里的一个位置
  m:
    rows:
      - { k: curg, v: 正在跑的那个 G }
      - { k: g0, v: 调度用的系统栈 }
    note: 一个 M 同时只跑一个 G
  gc:
    rows:
      - { k: 内容, v: "每个栈帧里哪些位置是指针" }
      - { k: 用途, v: "栈扩容时修指针；GC 扫描时找对象" }
    note: 这份信息是 G 能搬家的前提
  gfree:
    rows:
      - { k: 来源, v: "结束的 G 把结构体还回来" }
      - { k: 复用, v: "下次 newproc 先从这里拿" }
parts:
  g:
    label: G
    sub: 纯数据，不持有执行权
    detail: 它自己不会动。必须有一个 M 把它的 gobuf 装回寄存器，它才继续执行。
  stack:
    label: 栈
    sub: 2 KiB 起步，按需增长
    detail: 增长靠整体搬家，不是原地扩张。搬家用 GC 的栈图修正指针，这也是内核做不到的部分。
  fn:
    label: 函数入口
    sub: go 语句包装的那个调用
    detail: 参数在 go 语句处求值并复制；闭包捕获的变量通过 funcval 带过去。
  p:
    label: 队列
    sub: 排队的地方
    detail: 新 G 先落在当前 P 的 runnext 或 LRQ。队列里的 G 不占线程。
  m:
    label: M
    sub: 执行代码的线程
    detail: 只有 M 才能上核。G 被 M 取走之前，只是一份数据。
  gc:
    label: GC 的栈图
    sub: 哪里是指针
    detail: 没有这份信息就不能搬栈，也不能准确扫描对象。
  gfree:
    label: gFree 池
    sub: 结构体复用
    detail: G 结束不等于内存还给操作系统，结构体留在池里等下一次。
tours:
  - id: inside
    label: 一个 G 自己带着什么
    steps:
      - { at: [fn, g], text: "`go f()` 把函数入口和参数打包，放进一个新的 g 结构体。" }
      - { at: [stack, g], text: "g.stack 指向一块 2 KiB 的栈；不够时换一块更大的，把内容整体搬过去。" }
      - { at: [g], text: "gobuf 里只有六个字：sp、pc、g、ctxt、lr、bp。切换时 `gogo` 装回它们，不换页表。" }
  - id: outside
    label: 它挂在谁身上
    steps:
      - { at: [p], text: "没在跑的时候，它挂在某个 P 的队列上 —— 只是队列里的一个指针。" }
      - { at: [m], text: "被取走之后，g.m 指向那条 M；M 的 curg 指向它。" }
```

## 03 · 栈：2 KiB 起步，不够就搬家

`stackMin = 2048`（`stack.go:78`）。新 G 的栈就是这个大小，比一页还小。

不够用的时候，`newstack` 会调 `copystack`（`stack.go:900`）：

1. 分配一块两倍大的连续内存；
2. 把旧栈里已用的部分整体拷过去；
3. 修正栈内的指针 —— 旧栈里指向旧地址的指针，要改成新地址；
4. 旧栈释放。

第 3 步是难点，也是「为什么内核做不到」的答案。要修正指针，必须先知道栈里哪一格是指针、哪一格是整数。Go 的 GC 本来就要扫描栈来找对象，所以它有一份栈图（stack map），记录了每个栈帧的指针位图。内核没有这份信息 —— 它只看见一段字节。

搬栈还有一个副作用：**栈的地址会变**。所以不能把栈上的地址长期交给别人，比如把它存进全局变量、或者让别的 G 直接持有。channel 里如果存了指向某个 G 栈的指针，`copystack` 必须和 channel 操作同步（`g.activeStackChans` 就是干这个的），否则搬到一半会有指针指向旧栈。

上限在 `proc.go:160`：64 位进程 1 GiB，32 位 250 MiB。超过就直接崩，不是慢慢退化。这条上限的意义是给失控递归一个界；栈增长永远发生在最深的调用链上，那条链通常就是 bug 所在。

## 04 · 状态：Go 里的「阻塞」是什么意思

`g.atomicstatus` 不止三个值。`runtime2.go` 里定义了一串状态，常用的有八个：

| 状态 | 含义 | 需要知道的 |
|---|---|---|
| `_Gidle` | 刚分配，还没初始化 | 几乎看不到 |
| `_Grunnable` | 在队列里，等着被取走 | 不持有栈 |
| `_Grunning` | 正在某个 M 上执行 | 持有栈和 P |
| `_Gsyscall` | 正在执行系统调用 | 可能已经把 P 交出去 |
| `_Gwaiting` | 被 runtime 阻塞住了 | 栈不归它；可能被搬 |
| `_Gdead` | 没在用的 G | 回 gFree 池 |
| `_Gcopystack` | 正在搬栈 | 短暂的中间状态 |
| `_Gpreempted` | 被抢占，停下来 | 和 waiting 类似，但原因不同 |

平时只需要记三类：可运行、在跑、在等（系统调用单独算一类）。三类的切换都在用户态完成 —— 除了 `_Gsyscall`。

```compare
first: 事件
head: [状态变化, 谁在做]
rows:
  - schedule 选中: ["Runnable → Running", "M 从队列里取走它"]
  - 时间片用完 / 被抢占: ["Running → Runnable", "sysmon 下毒或发信号"]
  - gopark（等 channel、锁、网络）: ["Running → Waiting", "runtime 改状态并入队"]
  - goready（等的条件满足）: ["Waiting → Runnable", "runtime 放回某个 P 的队列"]
  - entersyscall: ["Running → Syscall", "系统调用包装层"]
  - exitsyscall: ["Syscall → Runnable", "runtime 尝试拿回 P"]
```

`gopark`（`proc.go:445`）做三件事：把状态改成 `_Gwaiting`、记下 `waitreason`、调 `schedule()` 换下一个 G。`goready`（`proc.go:481`）反过来：把 G 放回队列，等下一次被选中。

`waitreason` 有三十多个取值（`runtime2.go` 里的 `waitReason...` 常量），比如 `chan receive`、`chan send`、`sync.Mutex.Lock`、`IO wait`、`select`。这不是内部细节：用 `pprof` 看 goroutine 时，每一组的阻塞原因就是它。第 ⑦ 篇排障时会用到。

## 05 · 没有公开的 ID

`g` 结构体里有一个 `goid` 字段，创建时从 `sched.goidgen` 取号（`proc.go:2533`）。但它没有导出 API，标准库也不提供查询函数。Go FAQ 里专门有一节：「Why is there no goroutine ID?」

这和 pthread 世界是相反的。pthread 可以查线程 ID，按 ID 找到线程私有的配置（TLS），再决定怎么处理。Go 主动关掉了这条路：

- 一旦能查到「我在几号 G」，就会有人围绕这个身份建模型（每 G 一份缓存、每 G 一个路由键、按 ID 分片）；
- 这些模型都假设 G 是稳定的、可归属的，而 G 会被复用、会被搬栈、会被换到别的 M 上；
- 需要「这条请求是谁」的时候，应该把身份作为参数传下去，而不是从执行流的身份里反推。

```compare
first: 做法
head: [长什么样, 问题]
rows:
  - 从 runtime.Stack 里刮 goid: ["解析 `goroutine 123 [chan receive]`，正则取出 123", { text: "慢、依赖内部格式、版本一变就坏", tone: red }]
  - 用全局 map 存每 G 的状态: ["key 是 goid，value 是上下文", { text: "G 结束时谁负责删？复用后旧值还在", tone: red }]
  - 把需要的东西作为参数传: ["`handle(ctx, conn, userID)`", { text: "没有隐藏状态，生命周期跟着调用走", tone: green }]
```

`context.Context` 就是这条路的产物：它不查「我是谁」，而是把截止时间、取消信号、请求级的值显式传下去。

## 06 · 三层，不是三档

「轻量」这个词容易让人把进程、线程、G 排成「重、中、轻」三档。它们是三层，各自回答不同的问题：

```compare
first: 层
head: [回答什么问题, 谁在调度, 它没有什么]
rows:
  - 进程: ["资源容器与隔离", "内核", "没有执行流（至少有一条主线程）"]
  - 线程: ["内核可见的执行实体", "内核", "没有自己的地址空间和 fd 表"]
  - G: ["逻辑执行流", "Go runtime", { text: "没有页表、没有 fd 表、没有公开 ID", tone: violet }]
```

所以不存在「G 替代线程、线程替代进程」这条链。G 接过来的只有「承担执行流」这一件事；隔离仍然由进程负责，和内核打交道仍然由 M 负责。

## quiz

```quiz
- q: "`go f()` 执行完，f 开始跑了吗？"
  a: |
    没有。`go` 语句把 f 的入口和参数打包成一个 G，放进当前 P 的队列，
    然后当前 G 继续执行。要等某个 M 调 schedule 取到它，它才从入口开始跑。
- q: G 的栈为什么能扩容，而线程的栈不能？
  a: |
    扩容要复制栈、修正栈内指针，前提是知道栈里哪些位置是指针。
    runtime 有 GC 的栈图，所以能修；内核没有这份信息，只能按最坏情况预留。
    代价是 G 的栈地址会变，不能把栈上的地址长期交给别人。
- q: 「G 阻塞了」在 runtime 里具体发生了什么？
  a: |
    gopark 把 atomicstatus 改成 _Gwaiting，记下 waitreason，
    然后当前 M 调 schedule() 去跑下一个 G。
    整个过程没有系统调用；只有进入 _Gsyscall 才是真的进了内核。
- q: 为什么 Go 不暴露 goroutine ID？
  a: |
    一旦能查到身份，就会有人围绕身份建每 G 一份的状态、按 ID 分片。
    但 G 会被复用、搬栈、换 M，身份不是稳定的归属。
    Go 让你把需要的东西作为参数传下去，需要取消和截止时间就用 context。
```
