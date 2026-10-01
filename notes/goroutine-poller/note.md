## 01 · 同样是「等」，内核给不给句柄

G 已经挂回了 M，那 G 阻塞了怎么办？

答案是**分流**。而分流的原因只有一条：**「等待」能不能被内核以外的机制接管，取决于内核给不给句柄。**

```compare
first: 等的是什么
head: [内核给不给句柄, 于是怎么处理]
rows:
  - 网络 fd: [{ text: "给。epoll / kqueue / IOCP 能统一监视", tone: green }, "注册一个事件，数据到了内核来喊你 → 交给 netpoller"]
  - 文件 I/O: [{ text: "不给。read 就是要在内核里睡到磁盘把数据搬上来", tone: red }, "只能真的阻塞一条 M → 走 hand-off"]
  - CGO / 部分同步系统调用: [{ text: "同理，没有 poll 接口", tone: red }, "同上"]
```

==这就是「网络 I/O 与阻塞系统调用为什么走两条路」的全部理由。== runtime 必须准备两条路，因为有一类等待它接管不了。

---

## 02 · 泳道一：网络 I/O，等待被 netpoller 吸收

```flow
grid: true
groups:
  - { id: np, label: "G 挂在 netpoller 上，M 全程没睡", tone: green }
nodes:
  - { id: g, label: "G 调 conn.Read", sub: "数据还没到", row: 0, tone: green, group: np }
  - { id: park, label: "gopark", sub: "fd 注册进 epoll，G 状态改成 Waiting", row: 1, tone: amber, group: np }
  - { id: m, label: "M 立刻取下一个 G", sub: "从 LRQ 拿一个继续跑", row: 2, tone: green, group: np }
  - { id: ready, label: "goready", sub: "fd 就绪，G 被放回 LRQ", row: 3, tone: green, group: np }
edges:
  - { from: g, to: park, label: "挂起" }
  - { from: park, to: m, label: "它去干别的了" }
  - { from: m, to: ready, label: "epoll 通知 fd 就绪" }
```

==gopark 和 goready 这两个名字值得记住：所谓「阻塞」在 Go 里就是一次状态改写加一次入队，没有任何内核参与。== 这正是第 ① 篇那趟「进出内核的旅程」被绕开的全部秘密。

谁在驱动 netpoller？两条路：**空闲的 M 取不到 G 时会顺带 poll 一次**；**后台的 sysmon 也会周期性检查**。就绪的 G 被批量放回 LRQ，等下一次被选中。

```seq
grid: true
participants:
  - { id: g1, label: "G1", sub: "要读网络", tone: green }
  - { id: rt, label: "runtime", sub: "netpoller 在这", tone: violet }
  - { id: m, label: "M", sub: "那条真线程", tone: blue }
messages:
  - { from: g1, to: rt, label: "conn.Read → 数据没到", kind: sync, note: 1 }
  - { from: rt, to: rt, label: "fd 注册进 epoll；G1 状态改为 Waiting", kind: self, note: 2 }
  - { from: rt, to: m, label: "M 转头去跑 LRQ 里的 G3", kind: sync, note: 3 }
  - { from: rt, to: rt, label: "epoll 通知 fd 就绪 → goready，G1 回 LRQ", kind: self, note: 4, gap: 40 }
  - { from: rt, to: g1, label: "下次被选中时，它像什么都没发生过", kind: reply, note: 5 }
```

---

## 03 · 泳道二：真阻塞，换一条 M 顶上

```flow
grid: true
groups:
  - { id: ho, label: "hand-off：M 与 P 解绑，P 交给别人", tone: amber }
nodes:
  - { id: g, label: "G 要读文件", sub: "没有 poll 接口可用", row: 0, tone: amber, group: ho }
  - { id: unbind, label: "先解绑 P", sub: "交出「运行 Go 代码的许可」", row: 1, tone: violet, group: ho }
  - { id: m1, label: "M1 陪 G 沉进内核", sub: "它这下是真的睡了", row: 2, tone: amber, group: ho }
  - { id: m2, label: "P 交给 M2", sub: "继续消费 LRQ，服务没停", row: 3, tone: green, group: ho }
  - { id: back, label: "read 返回", sub: "G 重新入队，M1 变成备用线程", row: 4, tone: muted, group: ho }
edges:
  - { from: g, to: unbind, label: "entersyscall" }
  - { from: unbind, to: m1, label: "解绑之后才敢进去睡" }
  - { from: m1, to: m2, label: "不能让它拖着 P 一起睡" }
  - { from: m2, to: back, label: "exitsyscall" }
```

```callout
tone: red
icon: ⚠
text: |
  **hand-off 是兜底，不是免费。**

  每个真阻塞的调用都要一条 M 沉底陪着。一百个 G 同时做文件 I/O，
  runtime 就要维持一百条 M —— ==M 膨胀，内核调度压力回升，第 ① 篇的线程成本原样回来。==

  这也是为什么重文件 I/O 场景里，goroutine 的优势会打折：
  netpoller 才是优势的主引擎，hand-off 只是止损。
```

拖一下滑块，看两条路的代价怎么分道扬镳：

```demo
widget: handoff-lab
title: 同样在等，M 的数量不一样
actions: false
hint: 拖动滑块改阻塞的 G 数
config:
  gomaxprocs: 4
  blocked: 30
  max: 120
```

顺带解释一个常见疑问：**为什么 M2 是「新建或唤醒」，而不是等 M1 回来复用？** 因为阻塞的 M1 何时醒来无人知晓，runtime 不会把赌注压在它身上 —— 先补一个可用的，等 M1 回来再收编。

---

## 04 · 旧 M:N 为什么没有这条路

```cards
cols: 2
items:
  - title: 缺一半：没有 netpoller
    tag: 机制缺口
    tone: red
    desc: 没人把网络等待统一收进用户态调度器
    body: |
      旧式线程库只能**包裹既有的系统调用接口**，
      它无法要求内核把等待语义交出来。

      于是网络等待只能和文件等待一样，一条 M 配一个 —— 或者干脆连坐。
  - title: 缺另一半：语言级封装
    tag: 契约缺口
    tone: amber
    desc: 没有语言级 I/O 封装来保证「每次阻塞前都先解绑」
    body: |
      就算有 netpoller，也得保证**每一次**可能阻塞的调用都走正确的路径。
      这件事只能由语言和标准库一起保证。

      ==Go 能做成，是因为 runtime 与标准库是一起设计的== ——
      netpoller 是 runtime 的一部分，net 包天生知道该怎么配合它。
```

---

## 05 · 内核看到的，和 runtime 看到的

```compare
first: 视角
head: [看到的画面, 结论]
rows:
  - OS 看到的: ["M 一直在跑，**从未进入等待态**", { text: "「这个进程是 CPU 密集的」", tone: violet }]
  - runtime 看到的: ["G 在等：等网络、等 channel、等定时器", { text: "「绝大多数 G 只是暂时睡着」", tone: green }]
```

==从 OS 的视角看，那条线程从未进入等待态。== Go 在操作系统层面，把 I/O 密集型活折叠成了 CPU 密集型活。

这就是「看起来会阻塞、实际不阻塞」的完整含义 —— 阻塞的语义被 netpoller 与 hand-off 消化在用户态，内核看到的只是一台一直在干活的机器。

```callout
tone: amber
icon: 🔄
text: |
  **一个正在发生的变化。**

  io_uring 让普通文件也能提交异步读、由内核完成队列回调，正在改变文件 I/O 的处境。

  但截至 Go 1.27，标准库的文件 I/O 仍走**阻塞系统调用加 hand-off**，
  io_uring 的集成仍在演进。==读这类文档时要分清版本。==
```

---

```quiz
- q: 为什么网络 I/O 和文件 I/O 在 Go 里走两条完全不同的路？
  a: |
    因为「等待」能不能被内核以外的机制接管，取决于内核给不给句柄。
    网络 fd 可以被 epoll/kqueue/IOCP 统一监视，所以能交给 netpoller；
    文件 read 在经典模型里没有 poll 接口，就是要在内核里睡到磁盘把数据搬上来，
    只能走 hand-off，让一条 M 陪着沉下去。
- q: hand-off 的代价是什么，什么时候会显出来？
  a: |
    每个真阻塞的调用都要一条 M 陪着。一百个 G 同时做文件 I/O，
    runtime 就要维持一百条 M，内核调度压力回升，线程成本原样回来。
    所以在重文件 I/O 或 CGO 场景里，goroutine 的优势会明显打折 ——
    netpoller 才是优势主引擎，hand-off 只是止损。
- q: 为什么说「从 OS 视角，那条线程从未进入等待态」？
  a: |
    因为网络等待被 netpoller 消化了：G 被挂起，M 转头去跑别的 G，内核看不到 M 睡过。
    文件 I/O 确实会让一条 M 睡下去，但那条 M 已经把 P 交了出去，
    剩下的 P 继续在跑 Go 代码。所以内核看到的是一台一直在干活的机器，
    而 runtime 看到的是「绝大多数 G 只是暂时睡着」。
```
