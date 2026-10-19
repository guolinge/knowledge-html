> epoll 交给你的是一个「事件」。这个事件说的是「这条连接现在可以读」，还是「刚来了新数据」？
>
> 这两句话听起来差不多，差别决定了 LT 和 ET 的全部分歧，也决定了线上那种「连接还在、但再也不响应」的故障从哪里来。

## 01 · 可读是一个条件

在 TCP 的 `poll` 方法里，可读是这么判断的：

```c
if (tcp_stream_is_readable(sk, target))
    mask |= EPOLLIN | EPOLLRDNORM;
```

`target` 来自 `SO_RCVLOWAT`，默认是 1。也就是说，**接收队列里攒够 1 个字节，这条连接就算可读**。

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==「可读」的意思是：现在调用 read 不会阻塞。==

  它没有说有多少字节，没有说是不是一条完整的消息，也没有说这些字节是什么时候到的。
```

这个定义解释了几件事：

- 数据早就到了、只是你还没读，它仍然可读；
- 一次到了 2KB，你读了 1KB，剩下的 1KB 仍然可读；
- 对端关闭了连接，接收队列为空，但可读（EOF）也会成立 —— 这时候 `read` 返回 0。

所以「就绪」是**条件的快照**，不是「一条消息的送达证明」。

## 02 · 水平触发：条件还成立，就再报一次

LT 是默认模式。内核在把事件交给你之后，会做一件很朴素的事：

```c
/* ep_send_events_proc()：不是 ET 就放回就绪表 */
else if (!(epi->event.events & EPOLLET)) {
    list_add_tail(&epi->rdllink, &ep->rdllist);
}
```

放回去之后，下一次 `epoll_wait` 会再问一次这个 fd「现在什么状态」。只要接收队列里还有数据，它就再报一次。

```compare
first: 场景
head: [LT 会怎样, 风险]
rows:
  - 一次来 2KB，你只读了 1KB:
      - "下一轮 epoll_wait 立刻再报"
      - "没有风险。剩下的数据还在，你迟早会读到"
  - 收到事件但完全没读:
      - "下一轮还是它，再下一轮还是它"
      - "epoll_wait 立刻返回，变成忙循环，CPU 空转"
  - 一次读完了:
      - "条件不再成立，不再报"
      - "正常"
```

LT 的语义等于「**只要条件成立，每轮都提醒你**」。它的好处是不会丢事件：哪怕你这一轮只读了一半，下一轮还会有人提醒。代价是重复通知，以及「收到不读」会烧 CPU。

## 03 · 边缘触发：只在变化的那一下报

ET 模式下，事件交给你之后**不放回**就绪表。下一次什么时候再报？等这个 fd 上发生新的「状态变化」：

```c
/* ep_poll_callback()：已经在就绪表里就不重复挂 */
} else if (!ep_is_linked(epi)) {
    list_add_tail_lockless(&epi->rdllink, &ep->rdllist);
}
```

对接收方向来说，变化就是「从没数据变成有数据」。内核不记录「上次通知到哪了」，它靠的是一件更简单的事：回调只有在 epitem 不在就绪表时才会挂进去。

这带来两个后果：

```cards
cols: 2
items:
  - title: 两次 wait 之间来了多个包
    tag: 合并
    tone: blue
    desc: 第一个包把 epitem 挂进就绪表，后面的包看到它已经在表里，不会重复挂。一次 epoll_wait 只报一次。
  - title: 你只读了一半
    tag: 残留
    tone: red
    desc: 缓冲区里还有数据，但没有新的「无 → 有」，回调不会再触发。剩下的数据可能永远等不到下一次通知。
```

ET 的处理方式：

```checklist
items:
  - "fd 必须是非阻塞的。否则读到没有数据时会卡住整个事件循环"
  - "收到事件后必须循环 read，直到返回 EAGAIN"
  - "不要假设一次 read 能读完。返回的字节数可能小于你请求的长度"
  - "对端关闭时 read 返回 0，也要当作「读完了」处理"
```

```callout
tone: red
icon: ⚠
text: |
  ==ET 漏读的后果不是「延迟变大」，是「在下一次新数据到达之前，这条连接不会再有事件」。==

  数据还在内核缓冲区里，连接也是好的，但通知已经用掉了。
```

## 04 · 一次完整的对照

LT 和 ET 是在登记时选定的。下面是同一个场景里，两种模式各自的下一次 `epoll_wait`。写端写 2KB，你读 1KB：

```flow
grid: true
nodes:
  - { id: w, label: 写端写入 2KB, sub: 缓冲区 0 → 2048, row: 0, kind: external }
  - { id: wait1, label: "epoll_wait 返回", sub: "EPOLLIN · 可读成立", row: 1, kind: backend }
  - { id: read, label: "read(fd, buf, 1024)", sub: "缓冲区 2048 → 1024", row: 2, kind: backend }
  - { id: lt, label: "LT 的下一轮 epoll_wait", sub: 还报可读 · 缓冲区 1024, row: 3, kind: database }
  - { id: et, label: "ET 的下一轮 epoll_wait", sub: 不报 · 没有新边沿, row: 3, kind: security }
  - { id: lt2, label: 直到你读到空, sub: 这期间每一轮都会提醒, row: 4, kind: database }
  - { id: et2, label: 直到新数据到达, sub: 新数据 = 新的边沿, row: 4, kind: security }
edges:
  - { from: w, to: wait1, label: 数据入队，回调进就绪表, tone: green }
  - { from: wait1, to: read, label: 按事件去读 }
  - { from: read, to: lt, label: 还就绪 }
  - { from: read, to: et, label: 但没变化 }
  - { from: lt, to: lt2, label: 每轮都提醒 }
  - { from: et, to: et2, label: 等下一次边沿 }
```

亲手点一遍这两条分支：

```demo
widget: lt-vs-et
title: 缓冲区里剩下的那点数据
hint: 切到 ET，写入 128 字节，只读 64 字节，再点一次 epoll_wait
config:
  total: 128
  chunk: 64
```

写方向同理：**可写 = 发送缓冲区还有空间**，对端读得慢、缓冲区快满时它才会变成不可写。

```callout
tone: amber
icon: ⚠
text: |
  LT 模式下长期登记 `EPOLLOUT`，几乎每一轮都会报「可写」，等于让事件循环空转。

  更常见的做法是：发送缓冲区满时再关注可写，写出去之后立刻取消关注。
  这和 ET / LT 无关，是「可写条件大部分时间都成立」带来的问题。
```

## 05 · 那到底该用哪个

```compare
first: 维度
head: [水平触发 LT, 边缘触发 ET]
rows:
  - 默认:
      - { text: 是。不设 EPOLLET 就是它, tone: green }
      - "要显式设置 EPOLLET"
  - 通知频率:
      - "只要还就绪，每轮都报"
      - "每次状态变化只报一次"
  - 写错的后果:
      - "收到不读 → 忙循环，CPU 高但连接还能救"
      - { text: "漏读 → 连接永久静默", tone: red }
  - 对代码的要求:
      - "收到就读，读多少都行"
      - "非阻塞 + 读到 EAGAIN + 处理 EOF"
  - 适合:
      - "大多数业务；连接数多、逻辑复杂、怕丢事件"
      - "高吞吐代理、能严格排空的循环；想减少重复通知"
```

如果拿不准，用 LT。man7 里写得很直接：LT 的语义和 `poll` 一样，可以当成更快的 `poll` 来用。ET 是在你能保证排空的前提下，换来更少的重复通知。

## 06 · 几个能对上号的故障

```checklist
tone: cross
items:
  - "用了 ET，但 fd 还是阻塞的 —— 某次 read 读到空，整个事件循环卡在这条连接上"
  - "用了 ET，每次只 read 一次 —— 大包被截断，后半截数据再也没有事件"
  - "用了 ET，忘了 read 返回 0 表示 EOF —— 对端关闭后一直等"
  - "用了 LT，收到事件但没读 —— epoll_wait 立刻返回同一个 fd，CPU 打满"
  - "把 EPOLLIN 当成「有新数据」—— 于是以为每次事件都对应一条完整消息"
  - "忘了 EPOLLERR / EPOLLHUP 不登记也会报 —— 处理循环里必须有这两个分支"
```

这几条都能用同一句话解释：

```callout
tone: green
icon: ✅
text: |
  ==事件描述的是条件，不是数据。== LT 反复告诉你条件还在；ET 只在条件变化时告诉你一次。

  所以 LT 的处理是「读一点也行」；ET 的处理是「负责读到没有」。
```

下一篇换个角度：epoll 被说成「O(1)」，这个说法在什么条件下成立，什么条件下不成立。

```quiz
- q: 「可读」在 TCP socket 上具体指什么条件？
  a: |
    接收队列里的数据达到了 SO_RCVLOWAT（默认 1 字节），或者收到了 EOF / 错误。
    它只说明现在 read 不会阻塞，不说明有多少数据、是不是新数据。
- q: 为什么 ET 模式下必须读到 EAGAIN？
  a: |
    ET 只在状态变化时通知一次。如果只读了一部分，缓冲区里还有数据，
    但没有新的「无 → 有」，回调不会再触发，剩下的数据可能要等到下一次新数据到达才有通知。
- q: LT 模式下收到事件却不读，会发生什么？
  a: |
    条件仍然成立，epoll_wait 下一轮立刻又返回同一个 fd。
    程序会在事件循环里空转，CPU 占用升上去。
```
