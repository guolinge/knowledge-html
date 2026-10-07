## 01 · accept 还给你的只是一个整数

服务器代码大概长这样：

```text
listen_fd = socket(...); bind(...); listen(listen_fd, 128);

while (1) {
    conn_fd = accept(listen_fd, ...);   // ← 这里拿到一个 int
    handle(conn_fd);
}
```

`accept` 返回的 `conn_fd` 就是个 **int**，通常是 7、8、9 这样的小数字。

==一条 TCP 连接，在内核里那么复杂的东西，交到你手上就变成一个整数。== 这个系列要讲的所有麻烦，都是从「它只是个编号」这件事开始的。

---

## 02 · 前半段和普通文件一模一样

如果你读过文件系统那一篇的「文件描述符与打开文件表」，这里可以直接接上：

```flow
grid: true
groups:
  - { id: common, label: "这一段 socket 和普通文件完全一样", tone: blue }
nodes:
  - { id: fd, label: "fd 7", sub: "只是一个下标，本身不含任何数据", row: 0, tone: blue, group: common }
  - { id: tbl, label: "进程的打开文件表", sub: "fd 是这张表的下标", row: 1, tone: blue, group: common }
  - { id: file, label: "内核的 `struct file`", sub: "这一次「打开」的现场：读写位置、标志位", row: 2, tone: blue, group: common }
edges:
  - { from: fd, to: tbl, label: "fd 是这张表的下标" }
  - { from: tbl, to: file, label: "表项指向它" }
```

==到这里为止，socket 和普通文件走的是同一条路。== 分叉在下一步：看这个 `file` 往下指向什么。

```compare
first: file 指向
head: [再往下是什么, 数据在哪]
rows:
  - 普通文件: ["dentry → inode → 磁盘上的块", "==数据在磁盘上，早就在那了=="]
  - socket: ["`struct socket` → `struct sock`", { text: "数据在网络上，还没来", tone: amber }]
```

==前半段（fd → 打开文件表 → file）两者一模一样。== 这就是为什么 socket 也能用 `read` / `write` / `close` 那一套，它确实是个文件，走的是同一张表。

---

## 03 · 后半段分叉了

`struct sock` 里挂着网络协议栈需要的那些东西。==它们是并列的成员，不是一条流程==，所以下面这张图用的是归属线而不是箭头：

```tree
- label: struct sock
  tone: violet
  note: 一个 socket 的协议层状态。它下面挂着这些，==彼此并列，没有先后==
  children:
    - { label: 接收队列, note: "网卡收到的数据先落在这里，等你 read", tone: amber }
    - { label: 发送队列, note: "你 write 进去的、还没发出去的数据", tone: amber }
    - { label: "连接状态 / 序号 / 窗口 / 超时…", note: TCP 要记的一大堆东西, tone: muted }
```

!!接收队列就是下一篇的主角。!! 记住它现在的位置：**它在内核里，它是内核的内存，数据到了先在这里待着**。

---

## 04 · 这就是为什么 socket 会「等」

对比一下就明白，为什么磁盘 I/O 和网络 I/O 是完全两回事：

```compare
first: 你想读一个字节
head: [数据在哪, 会发生什么]
rows:
  - 普通文件: ["磁盘上。==它一直在那==", "内核去取（慢，但**一定会拿到**）。所以你不需要「等通知」"]
  - socket: [{ text: "网络上。还没来", tone: red }, "内核只能告诉你「现在还没有」。==什么时候有，不由你定==——所以你必须等，或者过会儿再来问"]
```

==「等」不是 socket 的实现缺陷，是它面对的世界决定的。== 对方什么时候发包、包什么时候到，你无从控制。

这也是为什么 epoll 帮不了磁盘 I/O（后面会看到内核直接拒绝）：**epoll 解决的是「等」，磁盘只是「慢」。**

---

## 05 · 监听 fd 是另一个东西

注意第一节那段代码里有**两个** fd，它们不是一回事：

```compare
first: fd
head: [它是干什么的, accept 之后]
rows:
  - "`listen_fd` · 监听 fd": ["一个就够。它不接受数据，只负责**等新连接**", "还在。继续等下一个"]
  - "`conn_fd` · 连接 fd": ["每来一个客户端就多一个", "用它收发数据"]
```

一个服务器跑起来，内核里是 **1 个监听 socket + N 个连接 socket**。

而监听 socket 特别的地方在于，它自己带着**两条队列**：

```flow
grid: true
groups:
  - { id: lq, label: "监听 socket 内部：握手还没走完的连接排在这", tone: amber }
nodes:
  - { id: syn, label: "SYN 队列（半连接）", sub: "收到 SYN、回了 SYN+ACK，还没等到对方的 ACK", row: 0, tone: amber, group: lq }
  - { id: acc, label: "accept 队列（全连接）", sub: "三次握手完成了，就等你的 accept 来取", row: 1, tone: green, group: lq }
  - { id: app, label: "你的 accept() 取走一个", sub: "从这一步起，它才变成 conn_fd", row: 2, tone: blue }
edges:
  - { from: syn, to: acc, label: "握手完成" }
  - { from: acc, to: app, label: "你来取" }
```

```callout
tone: amber
icon: 📋
text: |
  **两条队列的长度是两套参数管的**，这也是线上排障常见的坑：

  | | 拿什么控制 |
  |---|---|
  | SYN 队列（半连接） | `net.ipv4.tcp_max_syn_backlog` |
  | accept 队列（全连接） | `listen()` 的 `backlog` 参数，上限是 `net.core.somaxconn` |

  `ss` / `netstat` 里的 **`Recv-Q` 就是当前 accept 队列里堆了几个**，
  **`Send-Q` 是它的上限**，对一个监听 socket 来说，这两列不是「收了多少字节」。

  ==队列满了内核会丢包或回 `RST`==，客户端看到的现象是「连不上」或者「时通时不通」，
  而你的应用日志里什么都看不到，因为它根本没排到 `accept`。
```

---

## 06 · 所以「很多连接」在内核里长什么样

拆开来看是两件完全不同的事：

```cards
cols: 2
items:
  - title: "好办的那一半：N 个编号"
    tone: green
    body: |
      打开文件表里多 N 个表项而已。==编号这件事是便宜的== ——
      fd 就是个整数，存多少都无所谓。
  - title: "难办的那一半：N 份等待"
    tone: red
    body: |
      每个 socket 都有自己的接收队列，都在等自己的数据。
      ==「等」这件事，一个连接一份。== 下一篇的全部内容就是
      「谁来承受这 N 份等待」。
```

---

## 07 · 于是问题变得很具体

一条连接交到你手上是个整数，便宜。但它背后拖着一条**随时可能来数据、也随时可能一直不来的队列**。

那问题就是：**「等这 N 条队列」这件事，该由谁来做？**

最直觉的答案是「谁开的连接谁等」—— 下一篇看它亏在哪。

---

```quiz
- q: accept() 返回的那个整数是什么？
  a: |
    是文件描述符（fd）。它就是进程打开文件表的一个下标，
    本身不含任何数据。顺着它能查到这个进程的打开文件表项，
    再指向内核的 struct file。
    所以「一条 TCP 连接」交到手上只是一个编号，这个系列后面的麻烦都从这里开始。
- q: socket 和普通文件，在内核结构上哪里一样、哪里不一样？
  a: |
    前半段完全一样：fd → 打开文件表 → struct file。
    这也是为什么 socket 能直接用 read/write/close，它确实是个文件。
    分叉在 file 往下指的地方：普通文件指向 dentry → inode → 磁盘块（数据早就在那），
    socket 指向 struct socket → struct sock，里面挂着接收队列和发送队列（数据还没来）。
- q: 为什么 socket 会「等」，而普通文件不会？
  a: |
    因为数据在哪不一样。普通文件的数据就在磁盘上，内核去取就行，
    慢但一定会拿到，所以不需要「等通知」。
    socket 的数据在网络上，什么时候来不由你定。
    「等」不是实现缺陷，是它面对的世界决定的。
- q: 监听 fd 和连接 fd 有什么区别？监听 socket 里的两条队列是什么？
  a: |
    监听 fd 只有一个，它不收发数据，只负责等新连接；每来一个客户端 accept 就多一个连接 fd。
    监听 socket 内部有 SYN 队列（半连接，握手没完成）和 accept 队列（全连接，等 accept 取走）。
    SYN 队列由 tcp_max_syn_backlog 影响，accept 队列由 listen 的 backlog 参数决定、
    上限是 somaxconn。ss 里监听 socket 的 Recv-Q 是当前 accept 队列长度，Send-Q 是上限。
- q: 「一万条连接」这件事，便宜的那一半和难的那一半分别是什么？
  a: |
    便宜的是编号：打开文件表里多一万个表项而已，fd 就是个整数。
    难的是等待：每个 socket 都有自己的接收队列，都在等自己的数据 ——
    「等」这件事是一个连接一份，没法合并。
    下一篇讲的就是「这 N 份等待该由谁承受」。
```
