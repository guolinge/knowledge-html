## 01 · 先看一个能测出来的差别

同一个「等数据」的动作，写在不同类型的 fd 上，线程数完全不一样。下面两段程序各开 64 条 G 去读一个永远没有数据的 fd：

```go
// 路径 A：裸 socketpair + syscall.Read
fds, _ := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
go func() {
    buf := make([]byte, 8)
    syscall.Read(fds[0], buf)   // 没有数据，线程睡在内核里
}()

// 路径 B：net.Dial + conn.Read
c, _ := net.Dial("tcp", ln.Addr().String())
go func() {
    buf := make([]byte, 8)
    c.Read(buf)                 // 没有数据，G 挂起
}()
```

本机（Apple M4、macOS 26、Go 1.26.2）实测，`GOMAXPROCS=4`：

```text
路径 A（裸 socket）：goroutines=65  threads=66
路径 B（net 包）：   goroutines=66  threads=5
```

同样是 64 条 G 在等，路径 A 让进程多出 61 条线程，路径 B 几乎没变。差别不在「网络比文件快」，而在于：==这条等待能不能被事件机制接管。==

## 02 · 把两条路画在一张图上

```arch
svg: go-blocking
caption: 从顶上的 Read 进分叉点：注册进 netpoller 的走左边（只停 G），没注册的走右边（停整条 M，由 sysmon 把 P 交给别人）。点 G 看它停成什么状态，点 sysmon 看它多久来一次。
bodies:
  read:
    rows:
      - { k: 调用链, v: "conn.Read → net.(*conn).Read → internal/poll.FD.Read" }
      - { k: 返回, v: "n, err；数据没到时阻塞在这一行" }
  dec:
    badge: 创建 fd 时就定了
    rows:
      - { k: 网络 socket, v: "Dial / Listen 时注册进 netpoller" }
      - { k: 普通文件, v: "os.Open 时发现 epoll 不支持，不注册" }
      - { k: 结果, v: "注册了的 fd 是非阻塞的，EAGAIN 时 park；没注册的是阻塞的，read 直接睡线程" }
    note: 这个判断不在 Read 里做，在 fd 初始化时做
  np:
    badge: 只停 G
    rows:
      - { k: Linux, v: epoll }
      - { k: macOS, v: kqueue }
      - { k: 谁在等, v: "一条 M 在 epoll_wait 里等，或 sysmon 周期性来看" }
      - { k: 唤醒, v: "goready 把 G 放回某个 P 的 runnext" }
  mgo:
    rows:
      - { k: 动作, v: "gopark 返回后，M 直接调 schedule()" }
      - { k: 结果, v: "P 没有空转，队列里的下一个 G 接着跑" }
    note: 这就是「看起来阻塞、实际不阻塞」的字面含义
  park:
    rows:
      - { k: 状态, v: "_Gwaiting" }
      - { k: 原因, v: "waitReasonIOWait（pprof 里能看到）" }
      - { k: 栈, v: "还归它自己；可能被移动" }
  hand:
    badge: 停整条 M
    rows:
      - { k: 状态, v: "G 变 _Gsyscall；P 还挂着，但随时会被收走" }
      - { k: 谁收, v: "sysmon 的 retake，不是 entersyscall 自己" }
      - { k: 源码, v: "reentersyscall (proc.go:4627)" }
  sys:
    rows:
      - { k: 位置, v: "内核里，线程真的睡了" }
      - { k: 回来, v: "read 返回后走 exitsyscall" }
  sysmon:
    rows:
      - { k: 周期, v: "20µs 起，翻倍到 10ms" }
      - { k: 判断, v: "P 在系统调用里超过一个 tick，且有活要干" }
      - { k: 动作, v: "handoffp → startm" }
    note: 没有活干时，它可以等满 10ms 再收
  mnew:
    rows:
      - { k: 来源, v: "startm 新建，或唤醒空闲 M" }
      - { k: 之后, v: "P 继续被使用；旧 M 从内核返回后变备用" }
parts:
  read:
    label: 发起读
    sub: G 在用户态调用的那一行
    detail: 它不知道下面会 park 还是睡线程。这个差别由 fd 的注册状态决定。
  dec:
    label: 分叉点
    sub: 这个 fd 能不能被 epoll / kqueue 监视
    detail: 关键不在「读的时候」，在「创建 fd 的时候」。注册失败之后，Read 不会尝试等事件。
  np:
    label: netpoller
    sub: 等待被事件机制吸收
    detail: G 被挂起，M 回去干活。唤醒时把 G 放进 runnext，让它尽快接着跑。
  mgo:
    label: M 继续
    sub: 同一个 M，不用新建
    detail: 这条路上线程数不变，这是 goroutine 在 I/O 密集场景的优势来源。
  park:
    label: 挂起的 G
    sub: 只改状态和入队
    detail: 没有系统调用，没有线程切换。内核看不到这件事。
  hand:
    label: 进入系统调用
    sub: 线程要睡，P 得让出来
    detail: entersyscall 只是标记状态；handoff 由 sysmon 观察后执行，最多等 10ms。
  sys:
    label: 内核里的 read
    sub: 整条 M 停在这里
    detail: 对普通文件，这一步没有 poll 接口可用，只能等磁盘把数据搬上来。
  sysmon:
    label: sysmon
    sub: 后台监控线程
    detail: 除了 retake P，它还负责抢占长跑的 G、驱动 netpoll、触发 GC。它不执行业务代码。
  mnew:
    label: 新 M
    sub: 接管被让出的 P
    detail: P 是许可；旧 M 睡着时把许可交出去，别的 M 才能继续跑 Go 代码。
tours:
  - id: net
    label: 网络读：只停 G
    steps:
      - { at: [read, dec], text: "socket 在 Dial 时注册进了 netpoller，Read 走到 EAGAIN 后去 `waitRead`。" }
      - { at: [np, park], text: "`gopark` 把 G 改成 `_Gwaiting`，fd 留在 epoll 的监视列表里。" }
      - { at: [mgo], text: "M 没睡，直接取下一个 G。数据到了由 `goready` 放回 runnext。" }
  - id: file
    label: 文件读：停整条 M
    steps:
      - { at: [read, dec], text: "普通文件在 os.Open 时就没注册成功 —— epoll 不支持它。" }
      - { at: [hand, sys], text: "`entersyscall` 标记 `_Gsyscall`，线程进内核读盘。这一步没有事件可等。" }
      - { at: [sysmon, mnew], text: "sysmon 发现 P 卡住，`handoffp` 把 P 交给一条新 M；旧 M 留在内核里。" }
```

## 03 · 路径一：netpoller 把等待接过去

网络 fd 在创建时会被注册进 runtime 的 netpoller。之后每次读，走到内核返回 `EAGAIN`（数据还没到）时，Go 不会重试，而是把当前 G 挂起：

```go
// runtime/netpoll.go
func netpollblock(pd *pollDesc, mode int32, waitio bool) bool {
    ...
    if waitio || netpollcheckerr(pd, mode) == pollNoError {
        gopark(netpollblockcommit, unsafe.Pointer(gpp), waitReasonIOWait, traceBlockNet, 5)
    }
    ...
}
```

`gopark` 把 G 改成 `_Gwaiting`，然后当前 M 返回调度器，去取队列里的下一个 G。==这一步没有系统调用，也没有线程切换 —— 只是把一条执行流标成「等」，然后换一条跑。==

谁来发现数据到了？

- `findRunnable` 在本地队列和全局队列都空了之后，会做一次非阻塞的 `netpoll(0)`；
- `sysmon` 每 10ms 检查一次网络（`lastpoll + 10ms < now` 时调 `netpoll(0)`）；
- 实在没活干的 M，会带着一个超时值阻塞在 `epoll_wait` 里。

就绪的 G 被 `goready` 放回某个 P 的 `runnext`，下一次调度就轮到它。G 醒来时看到的是 `Read` 返回了数据，调用栈和挂起前一模一样 —— 它不知道自己中间被搬过。

```seq
grid: true
participants:
  - { id: g, label: "G", sub: "发起 Read", tone: green }
  - { id: rt, label: "runtime", sub: "netpoller", tone: violet }
  - { id: m, label: "M", sub: "执行线程", tone: blue }
messages:
  - { from: g, to: rt, label: "Read → EAGAIN", kind: sync, note: 1 }
  - { from: rt, to: g, label: "gopark：_Gwaiting", kind: reply, note: 2 }
  - { from: rt, to: m, label: "返回 schedule，取下一个 G", kind: sync, note: 3 }
  - { from: rt, to: rt, label: "epoll_wait 返回：fd 就绪", kind: self, note: 4, gap: 46 }
  - { from: rt, to: g, label: "goready：放回 runnext", kind: reply, note: 5 }
```

## 04 · 路径二：P 不是立刻交出去的

文件读走另一条路。`os.Open` 在创建 `*os.File` 时会判断这个 fd 能不能注册进 netpoller（`os/file_unix.go:155` 起）：

```go
pollable := kind == kindOpenFile || kind == kindPipe || kind == kindSock || nonBlocking

// darwin / *BSD：普通文件和目录不进 kqueue
if err == nil && (typ == syscall.S_IFREG || typ == syscall.S_IFDIR) {
    pollable = false
}

// 注册失败（Linux 上的普通文件会 EPERM），也当作不可 poll
if pollErr := f.pfd.Init("file", pollable); pollErr != nil && clearNonBlock {
    ...
}
```

注册失败之后，这个 fd 仍然是阻塞模式：`syscall.Read` 直接睡到数据回来，没有 `EAGAIN`、也没有人去等事件。这时：

1. `entersyscall` 把 G 标成 `_Gsyscall`，保存 sp/pc/bp（`reentersyscall`，`proc.go:4627`）。P 还挂在 M 上，但已经处于「随时会被收走」的状态。
2. M 进内核，睡在 `read` 里。
3. `sysmon` 周期性检查所有 P（`retake`，`proc.go:6630`）。如果发现某个 P 的 G 在系统调用里超过一个 tick，而且有活要干，就调 `handoffp`（`proc.go:3131`）：
   - P 的本地队列非空，或全局队列非空 → `startm` 直接开一条（或唤醒一条）M；
   - 没有活，但也没有空闲/自旋的 M → 还是开一条；
   - 否则把 P 标成 idle，等需要时再用。
4. 新 M 拿着 P 继续跑队列里的 G。旧 M 从 `read` 返回后走 `exitsyscall`，能抢回一个 P 就继续跑，抢不到就把 G 放进全局队列、自己睡觉。

```callout
tone: amber
icon: ⏱
text: |
  **「最多 10ms」是个容易读错的数字。**

  `retake` 的判断是：这个 P 的 G 在系统调用里待了超过一个 sysmon tick，
  ==并且== 有活要干（队列非空，或没有可用的 M）。
  两个条件都满足才立刻 handoff；否则它可以等满 10ms ——
  这就是「短系统调用不值得为它开线程」的折中。
```

代价也直接：每一个真的阻塞在系统调用里的 G，都要一条 M 陪着。64 条 G 读文件，就是 64 条 M。这部分成本没有被消除，只是从「所有 I/O」缩小到了「不能 poll 的 I/O」。

## 05 · 边界：哪些 fd 走哪条路

| fd 类型 | 能不能注册进 netpoller | 等待时发生什么 | 怎么观测 |
|---|---|---|---|
| 网络 socket（`net` 包） | 能（epoll / kqueue） | G 变 `_Gwaiting`，M 继续跑 | 线程数不变；pprof 里是 `IO wait` |
| pipe / `os.Pipe` | 能 | 同上 | 同上 |
| 普通文件（`os.File`） | 不能（Linux 的 epoll 不支持；darwin 明确排除） | M 睡在 `read(2)`，P 可能被 handoff | 线程数随并发读增长 |
| `syscall.Read` 裸调用 | 不经过 netpoller | 同普通文件 | 线程数增长（上面的实测） |
| cgo 调用 | 不一定 | M 可能被标记为系统调用 | `CGO_CALLS` / trace |

几个会变的地方：

- **io_uring**：Linux 上它可以让普通文件也走异步提交。截至 Go 1.27，标准库的 `os` / `internal/poll` 里没有 io_uring 的接入（`grep -r io_uring /usr/local/go/src` 没有结果），文件 I/O 仍然走阻塞系统调用 + handoff。这是一条会随版本变化的边界，读旧文章时要先看它写的版本。
- **`SetDeadline`**：对不可 poll 的 fd 设置读超时会返回 `ErrNoDeadline`，因为 runtime 没法用定时器把它叫醒。这不是 bug，是这条路的边界。
- **`GOMAXPROCS` 不影响这条边界**：它限制的是同时跑 Go 代码的 M 数；睡在 `read` 里的 M 不算，所以文件 I/O 并发高时线程数照样能涨到几百。

## 06 · 这条边界决定了 Go 的优势在哪打折

把两条路放回业务里看：

```compare
first: 场景
head: [等待被谁吸收, 结果]
rows:
  - 网关 / RPC / 消息消费: ["netpoller，M 不睡", { text: "G 的主场：几万条连接、几十条线程", tone: green }]
  - 本地文件读写 / 大日志: ["阻塞系统调用，一条 M 陪一个 G", { text: "线程数随并发增长，goroutine 的优势打折", tone: amber }]
  - cgo / 某些驱动调用: ["同样没有 poll 接口", { text: "同上，且更难预测", tone: amber }]
```

所以「Go 用 goroutine 就能扛十万并发」这句话要加限定：它成立的前提是等待能被 netpoller 接管。文件密集的服务里，G 仍然比线程轻（栈小、切换不走内核），但「不阻塞线程」这一条不成立。

## quiz

```quiz
- q: 同样是 64 条 G 在等数据，为什么一个进程只有 5 条线程，另一个有 66 条？
  a: |
    因为等待能不能被 netpoller 接管，取决于 fd 在创建时有没有注册进去。
    网络 socket 注册了，G 用 gopark 挂起，M 回去干活，线程数不变；
    裸 socket 或普通文件没注册，read 只能睡在内核里，每个等待的 G 要一条 M 陪着。
- q: "`entersyscall` 会立刻把 P 交出去吗？"
  a: |
    不会。它只是把 G 标成 _Gsyscall、保存现场，P 还挂在 M 上。
    handoff 由 sysmon 的 retake 执行：发现 P 在系统调用里超过一个 tick、
    并且有活要干，才调 handoffp → startm。没有活时它可以等满 10ms。
- q: 为什么普通文件不能交给 netpoller？
  a: |
    因为 epoll / kqueue 不支持普通文件：Linux 上 epoll_ctl 会返回 EPERM，
    darwin 上标准库明确把普通文件和目录排除。
    注册失败之后，read 没有事件可等，只能阻塞线程。
- q: goroutine 在文件 I/O 密集的服务里还有优势吗？
  a: |
    有，但不是「不阻塞线程」那条。栈更小、切换不走内核、创建更便宜仍然成立；
    但每个阻塞的读要一条 M 陪着，线程数会随并发读增长。
    这正是 hand-off 的代价，也是 io_uring 这类机制值得关注的原因。
```
