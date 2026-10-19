> 「epoll 是 O(1) 的」这句话流传很广，但它省略了主语：哪个操作是 O(1)？
>
> 这一篇把三段成本拆开算，看它在什么条件下成立、在什么条件下不成立，再补上多线程共用一个实例时的那几个坑。

## 01 · 三段成本，分开算

epoll 的一次完整使用包含三段，复杂度各不相同：

```compare
first: 阶段
head: [做什么, 成本, 什么时候发生]
rows:
  - 登记 epoll_ctl:
      - "在红黑树里插入 / 查找 / 删除一个 epitem"
      - "O(log n)，n 是登记的 fd 数"
      - "连接建立、关闭，或改关心的事件时"
  - 事件到达:
      - "回调过滤事件、把 epitem 挂进就绪表、可能唤醒线程"
      - { text: "每个事件 O(1)", tone: green }
      - "数据到达时，在收包的内核上下文里"
  - 收割 epoll_wait:
      - "取走就绪表的这一批，逐个检查状态并拷到用户数组"
      - "O(ready)，ready 是这一刻真有事的事件数"
      - "你的线程调用时"
```

「O(1)」说的是第二段，以及第三段里「跟登记总数无关」这件事。第一段不是 O(1)，但它在连接生命周期里只发生几次，不在热路径上。

## 02 · 真正决定成本的是活跃率

把三段放在一起，一次 `epoll_wait` 的工作量大致是：

```text
系统调用 + 就绪事件数 × 每个事件的检查与拷贝
```

登记的 fd 总数只影响红黑树的大小，不影响这个式子。这是它和 `poll` 的分水岭：

```text
poll：每次调用 ≈ 拷贝 N 项名单 + 检查 N 个 fd
epoll：每次调用 ≈ 拷贝 ready 项 + 检查 ready 个 fd
```

拉一个示意表。假设 10,000 条连接，只比较「每一轮要碰多少个条目」，不包含两边的常数开销：

| 这一刻真有事 | poll 每轮碰 | epoll 每轮碰 | 谁更省 |
|---|---|---|---|
| 10 条（0.1%） | 10,000 | 10 | epoll，差三个数量级 |
| 100 条（1%） | 10,000 | 100 | epoll |
| 1,000 条（10%） | 10,000 | 1,000 | epoll，但差距缩小 |
| 10,000 条（100%） | 10,000 | 10,000 | 基本持平，epoll 还要多付回调开销 |

最后一行是很多人忽略的：**如果每条连接每一轮都有数据，epoll 也要拷一万个事件，优势就没了。** 这时候决定成本的是「你一次搬多少数据」，不是「你怎么等」。

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==epoll 不是把成本变成了零，是把计费方式从「按连接数」换成了「按活跃事件数」。==

  连接多、活跃少，它便宜；连接多、每条都一直有数据，它和 poll 差不多。
```

这也解释了它适合什么场景：IM、推送、长连接网关、代理 —— 大量连接大部分时间闲着。反过来，短连接服务（每条连接一来一回就关）里，epoll 的优势有限，因为每个连接本来就要处理。

## 03 · 每次 wait 仍然是一次系统调用

`epoll_wait` 没有事件时会睡，有事件时返回。但**返回这件事本身**要经过一次系统调用：

```text
用户态 ──epoll_wait──→ 内核态：检查就绪表 / 睡 / 被唤醒
        ←──返回──────── 拷贝事件、回到用户态
```

一次事件通常至少配两次系统调用：一次 `epoll_wait` 拿到它，一次 `read` 把数据读走。如果事件稀疏，这两次调用的固定开销就摊不开。

能省的地方是**批量**：`maxevents` 设大一点，一次取走一批，`epoll_wait` 的次数就降下来了。省不了的是每条连接上的 `read`。

```compare
first: 场景
head: [系统调用次数, 说明]
rows:
  - 1 个事件，取 1 个:
      - "2 次（wait + read）"
      - "固定开销全摊在这一个事件上"
  - 100 个事件，一次取 100 个:
      - "101 次（wait + 100 次 read）"
      - "wait 被摊薄了，read 摊不掉"
  - 100 个事件，一次取 1 个，循环 100 次:
      - "200 次"
      - "wait 也被重复付了 100 次"
```

## 04 · 就绪事件要拷进你的数组

`epoll_wait` 返回的不是内核里的链表，而是一份拷贝。内核逐个把就绪的 epitem 检查一遍，把事件掩码和 `data` 写进你传进来的 `events` 数组，最多 `maxevents` 个。

这带来两个实际选择：

```cards
cols: 2
items:
  - title: maxevents 太小
    tag: 取不完
    tone: amber
    desc: 就绪表里还有事件没取走。下一轮还要再进来一次；如果一直是 LT，可能会反复看到同一批。
  - title: maxevents 太大
    tag: 用不上
    tone: muted
    desc: 用户态要分配更大的数组。内核不会填满它，只填真正就绪的那些，所以浪费的是你自己的内存。
```

`data` 字段是你登记时自己写进去的（通常放 fd，也可以放指针），内核原样带回。它不参与任何判断。

## 05 · 多个线程共用一个实例

这是一个常见的用法：起 N 个工作线程，都阻塞在同一个 epoll fd 上，谁被叫醒谁处理。

`epoll_wait` 的等待项是 **exclusive** 的，所以一次 `wake_up(&ep->wq)` 只会叫醒其中一个线程。这避免了「一个事件叫醒所有线程」的惊群。

但只叫醒一个，不等于只有一个线程能处理同一个 fd：

- 线程 A 拿到 fd 7 的事件，还没处理完；
- 线程 B 下一轮 `epoll_wait` 又看到 fd 7 还可读（LT），也拿到它；
- 两个线程同时 `read(fd 7)`，数据被分走，顺序和完整性都没了。

要保证「同一个 fd 同一时刻只有一个线程在处理」，用 `EPOLLONESHOT`：

```seq
grid: true
participants:
  - { id: ta, label: 线程 A, sub: 工作线程, kind: backend }
  - { id: ep, label: epoll 实例, sub: 就绪表 + ep->wq, kind: database }
  - { id: tb, label: 线程 B, sub: 工作线程, kind: backend }
messages:
  - { from: ta, to: ep, label: epoll_wait 睡下, kind: sync }
  - { from: tb, to: ep, label: epoll_wait 也睡下, kind: sync }
  - { from: ep, to: ep, label: 数据到 fd 7，回调挂进就绪表, kind: self, note: 1 }
  - { from: ep, to: ta, label: 只叫醒一个, kind: async, note: 2 }
  - { from: ep, to: ta, label: "epoll_wait 返回：fd 7 可读", kind: reply, note: 3 }
  - { from: ta, to: ta, label: 处理 fd 7, kind: self }
  - { from: ta, to: ep, label: "EPOLL_CTL_MOD：重新武装 fd 7", kind: sync, note: 4 }
  - { from: ep, to: tb, label: 下一次事件可能给 B, kind: async, note: 5 }
```

四个要点：

1. `EPOLLONESHOT` 登记后，这个 fd 被报告一次就**禁用**，直到你重新 MOD。
2. 两个线程都在 `epoll_wait` 里睡时，一次唤醒只叫一个。
3. 醒来的线程拿到事件，处理期间不会有第二个线程拿到同一个 fd —— 因为它在实例里已经被禁用了。
4. 处理完必须 `EPOLL_CTL_MOD` 重新武装，否则这个 fd 再也不会有事件。

另一种忙等场景在多进程：几个进程各自有一个 epoll 实例，都监听同一个 listen fd。新连接到达时会唤醒所有实例，造成惊群。用 `EPOLLEXCLUSIVE` 可以让内核只唤醒其中一个：

```compare
first: 标志
head: [解决什么, 限制]
rows:
  - EPOLLONESHOT:
      - "同一个 fd 分派给多个线程时，保证同一时刻只有一个在处理"
      - "处理完要 MOD 重新武装；不加这一步，这个 fd 就静默了"
  - EPOLLEXCLUSIVE:
      - "多个 epoll 实例监听同一个 fd 时，只唤醒一个，避免惊群"
      - "只能在 ADD 时设置，不能 MOD；不能嵌套 epoll；不能和 ONESHOT 一起用"
```

## 06 · 几个会咬人的细节

```checklist
tone: warn
items:
  - "关闭 fd 前最好先 EPOLL_CTL_DEL。fd 的所有副本都关闭后，它才从 interest list 移除；dup 出来的 fd 仍可能让你收到事件"
  - "epoll 实例可以嵌套，但内核限制深度（EP_MAX_NESTS 是 4 层），用来防止唤醒路径成环"
  - "登记的 fd 数有上限 max_user_watches。每个登记项在内核里约 160 字节（64 位），上限默认跟可用内存挂钩"
  - "ET + 多线程共读同一个 fd：即使没有 ONESHOT，也可能两个线程同时看到事件。ET 只减少通知，不提供互斥"
  - "maxevents 不要小于你的批量处理能力，否则 wait 的系统调用会被重复付"
  - "把 EPOLLIN 当成「有新数据」会导致消息边界判断错误（见上一篇）"
```

## 07 · 这一篇的结论

```summary
title: 一句话
text: |
  epoll 把「等待」的成本按活跃度收，不按连接数收；
  但每次通知仍是一次系统调用，每个事件仍要拷进你的数组。
```

它治好了「等」，没有治「每次 I/O 都要进一次内核、搬一次数据」。下一篇看后半句，以及 `io_uring` 换掉的是什么。

```quiz
- q: 「epoll 是 O(1)」这个说法，准确的主语是什么？
  a: |
    事件到达的处理是 O(1)：回调只做过滤、挂就绪表、可能唤醒，
    跟登记了多少 fd 无关。epoll_ctl 是 O(log n)，epoll_wait 是 O(ready)。
- q: 什么情况下 epoll 相对 poll 的优势会消失？
  a: |
    当几乎所有登记的 fd 每一轮都有事件时。epoll 也要逐个检查并拷贝 ready 个事件，
    工作量与 poll 的 O(N) 接近，还要多付回调的开销。
- q: EPOLLONESHOT 解决什么问题？忘了重新武装会怎样？
  a: |
    解决同一个 fd 被多个工作线程同时拿到的问题。报告一次后 fd 在实例里被禁用，
    处理完必须 EPOLL_CTL_MOD 重新武装；忘了的话这个 fd 再也不会有事件。
```
