> epoll 解决了「等」，但一次网络读还包括另外两件事：进内核、搬数据。
>
> 这一篇把这两件事说清楚，再看 `io_uring` 换掉的到底是哪一件。它没有把拷贝变没，它把「每次操作一次系统调用」这件事变没了。

## 01 · 先把 epoll 的账结清

```compare
first: 成本
head: [epoll 治了吗, 为什么]
rows:
  - 等待时占着一个执行单位:
      - { text: 治了, tone: green }
      - "挂在 socket 等待队列上的从 task 换成了回调。等待不再需要线程"
  - 从一万个 fd 里找出就绪的:
      - { text: 治了, tone: green }
      - "回调在事件发生时就把它写进就绪表。取的时候不用扫"
  - 每次操作进出内核:
      - { text: 没治, tone: amber }
      - "epoll_wait 要进一次，read 还要进一次"
  - 把数据从内核搬到用户:
      - { text: 没治, tone: amber }
      - "read 仍然是一次拷贝，epoll 只负责通知"
  - 消息边界:
      - { text: 没治, tone: amber }
      - "就绪只说明「可以读」，读多少、怎么拼包是应用的事"
```

前两项是 epoll 的功劳，后三项是它留下的。理解 epoll 的边界，就是理解这条分界线。

## 02 · 一次事件，两次系统调用

一个典型的 epoll 服务，处理一次网络读的路径是：

```text
epoll_wait()       ← 系统调用：进内核，取事件，回用户
read(fd, buf)      ← 系统调用：进内核，拷贝数据，回用户
```

两次进出，四次模式切换。一次调用本身的成本在亚微秒到几微秒量级，受 CPU、缓存和安全缓解影响很大，不是一个可以写死的数。但乘上事件数就不小了。下表按最坏情况算：一次 `epoll_wait` 只取一个事件。


| 每秒事件数 | 每秒系统调用 | 粗算占用（按 1µs / 次） |
|---|---|---|
| 1 万 | 2 万 | 约 2% 的一个核 |
| 10 万 | 20 万 | 约 20% 的一个核 |
| 100 万 | 200 万 | 两个核全花在进出内核上 |

数字只是量级示意，但趋势是真的：**事件越密，固定的进出成本越显形**。epoll 只把「等待」变便宜了，没有把「每次操作都要过一趟边界」变便宜。

## 03 · 拷贝也还在

一次 TCP 读，数据至少经过两次搬运：

```text
网卡  ──DMA──→  内核 skb（接收队列）  ──read 拷贝──→  你的 buf
```

`read()` 做的是后一段：把内核接收队列里的数据复制到用户缓冲区。这次拷贝由 CPU 执行，消耗内存带宽。你读 1GB，它就要搬 1GB。

epoll 在这里的角色只是「告诉你现在可以读了」。它不参与搬运，也没有把搬运变少。

```callout
tone: amber
icon: ⚠
text: |
  ==「epoll 很快」经常被理解成「数据到得很快」，这是两件事。==

  epoll 快在「知道谁有事」；数据到不到、要搬多久，取决于网络和拷贝。
```

## 04 · io_uring 换的是通信方式

`io_uring` 把内核和用户之间的通信，从「每次调用一次系统调用」换成了「两个共享内存里的环形队列」：

```text
用户写 SQE ──→ 提交队列 SQ（共享内存）
                    ↓
              内核执行这个操作
                    ↓
用户读 CQE ←── 完成队列 CQ（共享内存）
```

```seq
grid: true
participants:
  - { id: app, label: 你的线程, sub: 提交与收割, kind: backend }
  - { id: k, label: 内核, sub: 网络栈 / 文件系统, kind: database }
  - { id: nic, label: 网卡, sub: 中断 → 协议栈, kind: cloud }
segments:
  - { from: 1, to: 6, label: "epoll + read：一次事件两次系统调用" }
  - { from: 7, to: 10, label: "io_uring：提交和完成都走共享内存" }
messages:
  - { from: app, to: k, label: "epoll_wait() 系统调用", kind: sync, note: 1 }
  - { from: nic, to: k, label: 包到了，数据进接收队列, kind: async, gap: 30, note: 2 }
  - { from: k, to: app, label: 返回 EPOLLIN，线程醒来, kind: reply, note: 3 }
  - { from: app, to: k, label: "read(fd, buf) 系统调用", kind: sync, note: 4 }
  - { from: k, to: k, label: 从接收队列拷进你的 buf, kind: self, note: 5 }
  - { from: k, to: app, label: 返回字节数, kind: reply, note: 6 }
  - { from: app, to: app, label: 写一个 SQE 到共享 SQ, kind: self, note: 7, gap: 70 }
  - { from: k, to: k, label: 执行读，拷进你给的 buf, kind: self, note: 8 }
  - { from: k, to: k, label: 写一个 CQE 到共享 CQ, kind: self, note: 9 }
  - { from: app, to: app, label: 从 CQ 收割，不用系统调用, kind: self, note: 10 }
```

图中省略了 `io_uring_enter`：一批 SQE 提交时调用一次；开了 SQPOLL，内核线程会轮询 SQ，这一次也可以省。

对比两条路：

```compare
first: 维度
head: [epoll + read, io_uring]
rows:
  - 模型:
      - "就绪：告诉你能读了，你自己读"
      - "完成：你告诉我读哪，做完通知你"
  - 通信方式:
      - "每次操作一次系统调用"
      - "共享内存里的 SQ / CQ；一批 SQE 一次 enter，SQPOLL 模式可以省掉这次 enter"
  - 一次事件要几次系统调用:
      - "两次：wait + read"
      - "摊到每次操作接近零；要睡等完成时才有一次 enter"
  - 数据拷贝:
      - "内核缓冲区 → 用户 buf，一次"
      - "内核 → 用户 buf，仍然一次"
  - 错误怎么返回:
      - "read 返回 -1，errno 有值"
      - "CQE.res 里是负的 errno，进程的 errno 不参与"
  - 缓冲区生命周期:
      - "read 返回后 buf 归你"
      - "提交后内核可能异步使用，缓冲区要保持有效到完成；或者提前注册"
```

最关键的一行是「数据拷贝」。`io_uring` 去掉的是**每次操作的进出开销**，不是那次内存拷贝。普通的 `IORING_OP_READ` 仍然要把数据从内核缓冲区复制到你给的缓冲区。

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==epoll 治的是「等」，io_uring 治的是「来回」。==

  两个不同的成本，两个不同的解法。数据搬运要靠零拷贝的专门手段，不在这一层的默认路径里。
```

## 05 · 它不是免费的

```checklist
tone: warn
items:
  - "内核要够新。io_uring 在 5.1 引入，很多能力是后面几个版本才补齐的"
  - "API 更复杂：SQE / CQE、队列游标、内存屏障、缓冲区和文件注册"
  - "不是所有操作、所有文件系统都一样成熟；行为要按内核版本核实"
  - "容器里可能被 seccomp 拦掉。部署前先确认目标环境允许"
  - "单次、低延迟的小 I/O 上，省下的系统调用可能还抵不过额外的一次队列操作"
  - "生态和调试工具都比 epoll 年轻，出问题时能查的资料少"
```

它适合的是「系统调用本身成为瓶颈」的场景：高 IOPS、批量操作、每次 I/O 数据量不大但次数很多。连接多、空闲多、每次事件都伴随一次不小的读写，epoll 仍然够用，也更简单。

## 06 · 这棵树的收束

回到最开始那个问题：一万条连接，怎么等得起。

```compare
first: 方案
head: [等的人, 它欠下的]
rows:
  - 阻塞 read: ["一个线程", "一条连接一个执行单位"]
  - 忙轮询: ["一个还在跑的线程", "CPU 空转，白问"]
  - select / poll: ["一个线程 + N 个临时条目", "名单重交，醒来全扫"]
  - epoll: ["一段回调", "系统调用与拷贝还在"]
  - io_uring: ["没有人等：内核做完写一条完成记录", "复杂度、版本与环境限制"]
```

前四代都在把「等」的载体变轻，io_uring 换掉的是另一层：

```summary
title: 一句话
text: |
  从「一个要被调度的线程」，到「一个链表节点 + 一个函数指针」，
  等待越来越不像一个动作，越来越像一次记账。
  io_uring 把记账也挪进了共享内存：你不再等，只负责提交和收割。
```

这一棵树讲的是「让等待不占执行单位」。让执行单位本身变轻，是另一侧的事，可以接着看 [netpoller 与 hand-off 两条路](../goroutine-poller/)。

如果只记一件事：

```callout
tone: green
icon: ✅
text: |
  ==先分清你卡在哪一层：等不起、找不着就绪的，还是每次进出太贵。==

  等不起、找不着 → 事件驱动（epoll 的登记表 + 就绪表）；
  每次进出太贵 → 批量提交与共享环（io_uring）。
```

```quiz
- q: epoll 解决了哪两件事，没解决哪两件事？
  a: |
    解决了「等待占执行单位」和「从大量 fd 里找出就绪的」；
    没解决「每次操作进出内核」和「数据从内核拷到用户」。
- q: io_uring 把一次网络读的系统调用从两次降到了多少？拷贝变少了吗？
  a: |
    提交可以批量，一批 SQE 一次 io_uring_enter，SQPOLL 模式下连这次都能省；
    收割 CQ 可以只读共享内存。但普通 read 操作仍然要把数据从内核缓冲区拷到你给的缓冲区，拷贝没有消失。
- q: 什么情况下不该急着换 io_uring？
  a: |
    连接多而空闲、事件不密集、每次 I/O 数据量不小的时候，系统调用不是瓶颈，
    epoll 更简单也更成熟。还要确认内核版本、容器 seccomp 策略和运维工具是否支持。
```
