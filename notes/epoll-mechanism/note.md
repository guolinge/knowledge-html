> 上一篇留下的题目是两句话：内核要记住「谁在关心什么」，还要记住「谁已经就绪」。
>
> epoll 的答案就是这两张表。这一篇拆开看，重点不在数据结构，在一个容易被讲反的地方：**是谁把「就绪」这件事写进表里的。**

## 01 · 三个调用，各管一件事

```compare
first: 调用
head: [做什么, 和 poll 的差别]
rows:
  - epoll_create1:
      - "建一个 eventpoll 对象，返回一个 fd 指向它"
      - "poll 没有这一步。实例本身就是一个可以长期存在的内核对象"
  - epoll_ctl:
      - "ADD / MOD / DEL：把 fd 登记进这个实例，可以设关心哪些事件"
      - "名单交一次就一直有效，不用每轮重交"
  - epoll_wait:
      - "取走这一刻就绪的事件，最多 maxevents 个"
      - "只取就绪的那几个，不扫全部登记项"
```

注意 `epoll_create1` 返回的也是一个 fd。它和普通 fd 一样可以放进别的 epoll 实例里被监视，只是很少有人这么做。

## 02 · 实例里就三样东西

下面这张图是整篇的地图。左边是你的进程，中间是 epoll 实例，右边是两条连接，其中只有 A 有数据。

```arch
svg: epoll-map
caption: 实线是登记与通知的路径。每个登记的 fd 在它自己的等待队列上各有一份回调，不是集中挂在 epoll 实例里。
parts:
  thr:
    label: 你的线程
    sub: epoll_ctl / epoll_wait / read
    detail: 线程只在两个时刻进内核 —— 登记时、取事件时。数据到达时它可以在睡，也可以在处理别的事。
  rbr:
    label: 登记表 · rbr
    sub: 红黑树，每个登记的 fd 一个 epitem
    detail: 登记一次就在这，直到 DEL 或关闭 fd。==epoll_wait 不查这棵树==，它只在增删改时被用到。
  rdl:
    label: 就绪表 · rdllist
    sub: 双向链表，只装这一刻真有事的 epitem
    detail: 由回调在数据到达时挂进来。epoll_wait 取的是这里，取完按 LT / ET 决定要不要放回去。
  ewq:
    label: 实例的等待队列 · ep->wq
    sub: epoll_wait 没事件时睡在这
    detail: 和 socket 的等待队列是同一类东西。回调把条目放进就绪表后，会顺手 wake_up 它。
  sockA:
    label: 连接 A · socket
    sub: 接收队列非空，等待队列上挂着回调
    detail: ==回调挂在这个 socket 自己的等待队列上==，不是挂在 epoll 实例里。所以每个登记的 fd 各有一份，互不影响。
  sockB:
    label: 连接 B · socket
    sub: 接收队列空，回调待命
    detail: 每个登记的 fd 都有这样一份。B 没数据，所以它的回调一次都没被调用。
  nic:
    label: 网卡
    sub: 中断 → 协议栈
    detail: 包从这进来，协议栈把它放进对应 socket 的接收队列。
tours:
  - id: event
    label: "一次数据到达走哪条路"
    steps:
      - at: [nic, sockA]
        text: "包从网卡进来，协议栈把它放进连接 A 的接收队列。此刻 epoll 还不知道这件事。"
      - at: [sockA]
        text: "接收队列从空变成非空，协议栈调用 socket 的 `sk_data_ready`，敲响它自己的等待队列。"
      - at: [sockA, rdl]
        text: "队列上挂的不是线程，是回调。==回调在数据到达的上下文里直接执行==：把 A 的 epitem 挂进就绪表。"
      - at: [rdl, ewq, thr]
        text: "回调顺手 `wake_up(ep->wq)`。如果线程正睡在 `epoll_wait` 里，它被叫醒，从就绪表取走这一批。"
  - id: register
    label: "登记的时候做了什么"
    steps:
      - at: [thr, rbr]
        text: "`epoll_ctl(ADD)` 建一个 epitem，放进红黑树。这一步是 O(log n)，只在登记时发生。"
      - at: [rbr, sockA, sockB]
        text: "紧接着调一次这个 fd 自己的 poll 方法，通过 `poll_wait` 把回调挂到 fd 的等待队列上。==每个 fd 各一份，挂完就一直待命。=="
bodies:
  thr:
    rows:
      - { k: epoll_ctl, v: 登记 / 修改 / 删除 }
      - { k: epoll_wait, v: 取就绪事件 }
      - { k: read, v: 从接收队列拷数据 }
  rbr:
    badge: 登记一次，一直在
    rows:
      - { k: epitem, v: 12 个登记项 }
      - { k: key, v: "fd + 打开文件描述" }
  rdl:
    badge: 只装这一刻有事的
    rows:
      - { k: A, v: 可读 }
      - { k: 长度, v: 1 }
  ewq:
    badge: epoll_wait 睡这
    rows:
      - { k: 等待者, v: 1 个线程 }
      - { k: 唤醒, v: 一次只叫一个 }
  sockA:
    badge: 两个队列
    rows:
      - { k: 接收队列, v: 3 个 skb }
      - { k: 等待队列, v: 挂着 ep_poll_callback }
      - { k: private, v: eppoll_entry → epitem }
  sockB:
    badge: 没数据
    rows:
      - { k: 接收队列, v: 空 }
      - { k: 等待队列, v: 回调待命 }
  nic:
    rows:
      - { k: 动作, v: 中断 → 协议栈 → 入队 }
```

三样东西：

```cards
cols: 3
items:
  - title: 登记表
    tag: rbr · 红黑树
    tone: blue
    desc: 每个登记的 fd 一个 epitem。管增删改、去重，也管「这个 fd 我关心哪些事件」。
  - title: 就绪表
    tag: rdllist · 双向链表
    tone: violet
    desc: 只装这一刻真有事件的 epitem。epoll_wait 取的就是它，取完之后清空或按模式放回。
  - title: 实例自己的等待队列
    tag: ep->wq
    tone: amber
    desc: epoll_wait 没有事件时睡在这里。注意它和 socket 的等待队列不是同一个。
```

拖一下这个控件，看两张表怎么配合：

```demo
widget: epoll-tables
title: 登记表与就绪表，各自装什么
hint: 点登记表里的一格 = 这条连接来数据了；点 epoll_wait = 取走这一批
config:
  conn: { min: 8, max: 40, step: 4, def: 24 }
```


## 03 · 登记：把回调挂到别人的队列上

`epoll_ctl(ADD)` 的内核路径里，有一件事决定了 epoll 的全部性能：

```text
ep_insert()
  ├─ 建 epitem，插进红黑树 rbr
  ├─ 调一次这个 fd 的 poll 方法，看它现在是否已经就绪
  │    如果已经就绪 → 直接挂进就绪表
  └─ 通过 poll_wait 协议，把 ep_poll_callback 挂到这个 fd 的等待队列上
       init_waitqueue_func_entry(&pwq->wait, ep_poll_callback);
       add_wait_queue(whead, &pwq->wait);
```

对比一下第 ② 篇里阻塞 read 挂上去的东西：

```compare
first: 挂在 socket 等待队列上的条目
head: [阻塞 read, epoll]
rows:
  - func:
      - "`woken_wake_function`：把 task 改回可运行"
      - "`ep_poll_callback`：把 epitem 挂进就绪表"
  - private:
      - "指向那个 task"
      - "指向 eppoll_entry，里面记着 epitem 和 epoll 实例"
  - 被唤醒时的代价:
      - "要调度一个线程，等调度器挑中它"
      - "执行一段常数时间的代码，跑完就返回"
  - 谁持有它:
      - "线程自己。read 返回时摘掉"
      - "epoll 实例。DEL 或关闭 fd 时才摘掉"
```

==同一个队列，同一种节点，只是换了一个函数指针。==

这就是「epoll 不用遍历名单」的机制来源。不是因为它有一棵更聪明的树，而是因为**「谁在等」从「一个要被调度的线程」变成了「一段在数据到达上下文里就能跑完的函数」**。

还有两个容易忽略的点：

- 回调挂在**每个 fd 自己的等待队列**上，不是集中挂在 epoll 实例里。所以连接 B 有 B 的一份，A 有 A 的一份。
- 同一个 fd 可以被多个 epoll 实例监视，那它就会挂多份回调。回调只对自己那个实例负责。

## 04 · 数据到达：回调干了三件小事

连接 A 收到数据，协议栈把 skb 放进接收队列，然后调用 `sk_data_ready`（TCP 默认是 `sock_def_readable`），它唤醒这个 socket 的等待队列。队列上的条目逐个执行自己的 `func`。

轮到 `ep_poll_callback` 时，它做的是：

```lane-stack
- badge: 第一件
  title: 看这个事件我关不关心
  desc: 登记时设过事件掩码
  tone: muted
  nodes:
    - { title: "key 是唤醒时带的事件位", sub: "EPOLLIN / EPOLLOUT / ..." }
    - { title: "和 epi->event.events 按位与，不关心就退出", sub: "关心 EPOLLIN 的连接不会被一次 EPOLLOUT 吵醒" }
  next: "关心 :: 继续"

- badge: 第二件
  title: 把自己挂进就绪表
  desc: 只挂一次
  tone: violet
  nodes:
    - { title: "epi 不在链表上，list_add_tail 到 rdllist", sub: "同一轮里来十份数据，也只占一个位置" }
    - { title: "已经在了就不重复挂", sub: "链表位置就是「还没被取走」的标记" }
  next: "挂好了 :: 看看有没有人在等"

- badge: 第三件
  title: 叫醒可能睡着的线程
  desc: 没有人睡就跳过
  tone: blue
  nodes:
    - { title: "ep->wq 上有等待者，wake_up(&ep->wq)", sub: "把睡在 epoll_wait 里的线程叫醒" }
```

三件事都是常数时间，而且都在**数据到达的那个内核上下文**里完成：可能是软中断，可能是收包的内核线程。整个过程中没有调度你的线程，也没有遍历登记表。

```callout
tone: violet
icon: 💡
text: |
  这就是「O(1)」真正的落点：==一次事件的处理量，跟登记了多少个 fd 无关。==

  第一万零一条连接的事件，和第一条连接的事件，走的是同样三段代码。
```

## 05 · 收割：epoll_wait 取走这一批

`epoll_wait` 进来先看就绪表：

- 非空：直接开始取，不睡。
- 空：睡到 `ep->wq` 上。等待项是 **exclusive** 的，所以多个线程共用一个实例时，一次唤醒只会叫醒其中一个。

取的时候，内核不是把回调当时记下的事件原样交给你，而是对每个就绪的 epitem **再问一次它的 fd**「现在到底什么状态」，把最新的掩码拷进你的 `events` 数组。这一步在 `ep_send_events` 里完成。

取完之后，按模式决定要不要放回就绪表：

```compare
first: 模式
head: [取走后, 结果]
rows:
  - 水平触发 LT（默认）:
      - "只要还就绪，就把 epitem 放回就绪表"
      - "下一次 epoll_wait 还会报它，直到你真的把数据读空"
  - 边缘触发 ET:
      - "不放回。等下一次状态变化，回调再挂进来"
      - "这一轮没读完的数据，可能永远不会再触发通知"
```

LT 和 ET 的分歧、以及「为什么必须先读到 EAGAIN」，是下一篇的全部内容。

## 06 · 那棵红黑树到底干什么

很多人把 epoll 的快归因于红黑树。这棵树确实存在，但它不在热路径上：

```compare
first: 操作
head: [走不走红黑树]
rows:
  - epoll_ctl(ADD / MOD / DEL):
      - "走。插入、查找、删除都是 O(log n)，n 是登记的 fd 数"
  - 数据到达:
      - "不走。回调直接拿 epitem，挂进就绪表"
  - epoll_wait 取事件:
      - "不走。只遍历就绪表，长度等于这一刻真有事的那几个"
```

树的作用是**让登记这件事可控**：支持去重（同一个 fd 重复 ADD 会得到 `EEXIST`）、支持按 fd 快速找到并修改或删除、支持关闭 fd 时清理。它是一个账本。

让它比 `poll` 快的，是通知路径不碰这个账本。

顺带一个数量级：man7 里写，每个登记的 fd 在内核里大约占 90 字节（32 位内核）到 160 字节（64 位内核）。这是一笔和连接数成正比的固定开销，很小，但也是为什么 `max_user_watches` 会有上限。

## 07 · 和 poll 并排看一次事件

```compare
first: 步骤
head: [select / poll, epoll]
rows:
  - 事件发生前:
      - "线程把 N 个 fd 的名单拷进内核，挂 N 个临时条目"
      - "没有动作。登记的条目和回调一直待命"
  - 数据到达:
      - "socket 唤醒线程挂的那些条目 → 线程被唤醒"
      - "socket 唤醒回调 → 回调把 epitem 挂进就绪表"
  - 找出是哪个 fd:
      - "线程醒来后重扫 N 个 fd"
      - "不用找。就绪表里就是"
  - 返回给用户:
      - "就绪个数 + 每个 fd 的 revents"
      - "就绪事件数组，最多 maxevents 个"
  - 返回后要清理什么:
      - "拆掉 N 个临时条目；名单下次重交"
      - "没有。登记表还在，就绪表按模式处理"
```

```callout
tone: green
icon: ✅
text: |
  ==epoll 把「谁就绪」这件事，从「醒来以后找」提前到了「事件发生时就记下来」。==

  这一步提前，发生在数据到达的内核上下文里，不需要你的线程参与。
```

下一篇把「就绪」这个词拆开。它是理解 LT、ET，以及理解线上为什么会「连接还在、但再也不响应」的关键。

```quiz
- q: epoll 挂在 socket 等待队列上的是什么？它和阻塞 read 挂的东西有什么共同点？
  a: |
    挂的是 ep_poll_callback 这个函数指针，外面包一个 eppoll_entry。
    共同点是它们都是 wait_queue_entry：阻塞 read 的 func 唤醒 task，
    epoll 的 func 把 epitem 挂进就绪表。同一个队列、同一种节点，换了 func。
- q: 数据到达时，ep_poll_callback 做了哪三件事？
  a: |
    先按事件掩码过滤，看这个事件是否在登记时关心；
    再把自己这个 epitem 挂进就绪表（已经在表里就不重复挂）；
    最后如果有人在 ep->wq 上等，wake_up 叫醒它。
- q: epoll 为什么快？红黑树在其中起什么作用？
  a: |
    快在通知路径：一次事件只做常数工作，跟登记了多少 fd 无关。
    红黑树只服务 epoll_ctl 的增删改查和去重，事件到达和取事件都不走它。
```
