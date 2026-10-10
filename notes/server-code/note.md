```arch
svg: conn-establish
caption: ==从左到右读，这就是「accept 干的事」的全部。== 四个虚线框是四个世界（你的代码 / 你的进程 / 内核 / 硬件），它们**两两不重叠** —— 这么排是为了让每个世界的范围一眼看得出来。注意两根不顺主流程走的线：中间那根往下，accept 队列挂在监听 socket 名下；最底下那根**竖直的虚线**是交付本身 —— fd 表里新开的那一格，指回内核里已经建好的连接 socket。
parts:
  calls:
    label: socket() bind() listen()
    sub: 起手三件事
    detail: ==这三个调用只是让内核里出现一个对象，并给它一个地址。== 它们不产生任何连接，也不收发任何数据。
  lsock:
    label: 监听 socket
    sub: TCP_LISTEN · 没有对端
    detail: 一个端口一个。==它自己不传数据==，全部工作就是等新连接。从进程启动到进程结束，它一直在那守着。
  nic:
    label: 网卡
    detail: SYN 从这里进来。网卡不认识 socket，它只认识包。
  tcp:
    label: TCP 协议栈
    sub: 拆包 / 完成握手
    detail: ==三次握手是内核替你完成的，你的程序不需要在场。==
  conn:
    label: 连接 socket
    sub: 握手完成的这一刻就建好了
    detail: ==它出现的时候，还没有 fd，也不属于任何进程。== 一个完整的、但没有主人的内核对象 —— 这是理解 accept 的关键。
  accq:
    label: accept 队列
    detail: 已经建好、等你去取的连接排在这。长度由 `listen()` 的 `backlog` 决定，上限是 `net.core.somaxconn`。
  fdtable:
    label: fd 表
    sub: accept 在这里开一格
    detail: ==这才是 accept 真正动过的地方。== 它不在连接 socket 上动任何手脚，只是在你的 fd 表里新建一格，指过去 —— 图上那根竖直的虚线就是它的全部效果。
anchors:
  - { part: conn, label: "我想搞清「一条连接」" }
  - { part: fdtable, label: "accept 到底动了什么" }
  - { part: lsock, label: "我从监听 socket 看" }
tours:
  - id: establish
    label: "一条连接的一生"
    steps:
      - { at: [calls, lsock], text: "起手三件事，内核里出现==一个监听 socket==。它守着 `0.0.0.0:80`，不传数据，也不知道会跟谁说话。" }
      - { at: [nic, tcp], text: "浏览器发来 SYN。包从==网卡==进来，被==协议栈==拆开。" }
      - { at: [tcp, conn], text: "==握手完成的那一刻，内核就把连接 socket 建好了== —— 就在协议栈里。" }
      - { at: [conn], text: "注意它现在的处境：==对象已经完整存在，但还没有 fd，也不属于任何进程。== 你的代码够不到它。" }
      - { at: [conn, accq, lsock], text: "它被放进==accept 队列== —— 这条队列挂在监听 socket 名下。" }
      - { at: [accq, fdtable, conn], text: "看那根**竖直的虚线**：从 fd 表指回内核里那个已经存在的连接 socket。旁边横着的那根是它的前半句 —— 从队列里**取走**。==accept 做的事只有一件：在你的 fd 表里开一格，指向那个已经存在的连接 socket。==\n\n所以 accept 干的是**交付**，不是**创建** —— 它不产生任何新的内核对象，只是把一根线接上了。" }
```

```arch
svg: conn-wakeup
caption: 数据来了之后，内核怎么把你那条被冻住的执行流重新捡起来。==全程你的程序只参与了最后一步。== 这张**没有框** —— 它的流向在三个世界之间来回穿（硬件→内核→你的进程→内核→硬件→你的进程），围成连续的框必然互相压。所以改成**颜色 = 它属于哪个世界**（看下面的图例）。
parts:
  nic:
    label: 网卡
    detail: 包到达。网卡不认识 socket，它只知道「来了一串字节」。
  tcp:
    label: TCP 协议栈
    detail: 拆开包，看四元组（服务端 IP/端口 + 客户端 IP/端口）。
  conn:
    label: 连接 socket
    detail: ==按四元组找到这是哪条连接，数据落进它的接收缓冲。== 注意这是**每条连接各自一份**的。
  thread:
    label: 主线程 · 栈
    detail: 唤醒之前，这条执行流被冻在这里。==被冻住的是「一条执行流」，不是整个进程。==
  runq:
    label: 就绪队列
    detail: 被唤醒的 task 回到这里，等调度器挑。
  cpu:
    label: CPU 核
    detail: 真正执行你代码的地方。
  rw:
    label: read() 返回
    detail: 数据到了你的手上。
anchors:
  - { part: conn, label: "我想搞清「一条连接」" }
  - { part: thread, label: "我熟悉线程" }
  - { part: nic, label: "我从网卡这头看" }
tours:
  - id: wakeup
    label: "数据到了，怎么唤醒你的代码"
    steps:
      - { at: [nic, tcp], text: "包到达==网卡==，被==协议栈==拆开 —— 协议栈认的是包，不是 socket。" }
      - { at: [conn], text: "按四元组找到属于哪条连接，数据落进==这条连接自己的接收缓冲==。" }
      - { at: [thread, conn], text: "数据到了，内核==唤醒==挂在这条连接等待队列上的那条执行流。\n\n唤醒之前，你的线程就在==主线程的栈==上被冻着 —— 冻住的是**一条执行流**，不是整个进程。" }
      - { at: [runq, cpu], text: "被唤醒的 task 回到==就绪队列==，==调度器==挑中它，==CPU== 开始跑。" }
      - { at: [rw], text: "`read` 返回，数据到了你手上。\n\n==从网卡到这里，你的程序只参与了最后一步。==" }
```

---

## 01 · 先看那段代码

一个最朴素的服务器，核心就这十几行：

```text
listen_fd = socket(AF_INET, SOCK_STREAM, 0);
bind(listen_fd, 0.0.0.0, 80);
listen(listen_fd, 128);

for (;;) {
    conn_fd = accept(listen_fd, ...);
    pthread_create(&t, NULL, handle_request, &conn_fd);
}

void handle_request(int fd) {
    char buf[1024];
    read(fd, buf, sizeof buf);
    ...
}
```

它跑起来之后，会变成内存和内核里的什么？==**这一篇只问一个问题：哪些东西是一份，哪些是 N 份。**==

这个问题看着朴素，但它是一大片困惑的根源，尤其是「每个线程里是不是复制了一份服务端代码」。

---

## 02 · 内核里先站住一个东西：监听 socket

前三个调用干的事，是**让内核里出现一个对象，并给它一个身份证**：

```cards
cols: 3
items:
  - { title: "socket()", desc: "造一个空的 socket 对象，返回它的 fd", tag: 第 1 步, tone: blue }
  - { title: "bind()", desc: "给它绑上 `0.0.0.0:80`，这是它的地址", tag: 第 2 步, tone: blue }
  - { title: "listen()", desc: "让它进入 `LISTEN` 状态，开始接客", tag: 第 3 步, tone: blue }
```

`listen_fd` 就是一个普通的 fd，顺下去还是那条链（读文件系统那篇的 04 节）：`fd → 打开文件表 → struct file → struct socket → struct sock`。

```callout
tone: blue
icon: 🪧
text: |
  这个 socket 和后面那些**不一样的地方**，在它的地址和状态：

  | | 监听 socket |
  |---|---|
  | 地址 | `0.0.0.0:80`，`0.0.0.0` 是**通配地址**，意思是「本机所有网卡上的 80 端口都归我」 |
  | 状态 | `LISTEN` |
  | 有没有对端 | **没有**。它不知道会跟谁说话 |

  ==它不传业务数据。== 它的全部工作就是「等新连接」。
```

---

## 03 · 浏览器来了：内核里多了什么

三个浏览器几乎同时连上来。**注意顺序**：

```seq
grid: true
participants:
  - { id: b, label: 浏览器, sub: "三个客户端", tone: blue }
  - { id: k, label: 内核, sub: "协议栈 + 监听 socket", tone: violet }
  - { id: a, label: 你的程序, sub: "卡在 accept 上", tone: green }
messages:
  - { from: b, to: k, label: "SYN", note: 三次握手 }
  - { from: k, to: b, label: "SYN + ACK", kind: reply }
  - { from: b, to: k, label: "ACK", note: 连接建立 }
  - { from: k, to: k, label: "造一个连接 socket，放进 accept 队列", kind: self }
  - { from: k, to: a, label: "accept 返回一个新 fd", kind: reply }
```

==**连接是在三次握手完成的那一刻就在内核里建好的**，不等你 accept。==

`accept` 做的事只有一件：**从队列里取出一个已经建好的连接，把它的 fd 交给你**。所以：

```text
listen_fd  →  一直守着 0.0.0.0:80
conn_fd 1  →  浏览器 A
conn_fd 2  →  浏览器 B
conn_fd 3  →  浏览器 C
```

每个连接 socket 在内核里记着这些（都是**各自独立**的）：

```cards
cols: 2
items:
  - { title: 四元组, desc: "谁和谁在说话，下一篇会专门讲它", tone: violet }
  - { title: 接收缓冲区, desc: "网卡收到的数据先落在这里", tone: amber }
  - { title: 发送缓冲区, desc: "你 write 进去、还没发出去的", tone: amber }
  - { title: TCP 序列号 / 状态 / 窗口 / 超时, desc: "这条连接自己的账本", tone: muted }
```

---

## 04 · 为什么一堆连接能共用 80 端口

这是最容易卡住的一处：**80 端口只有一个，怎么可能同时被一百条连接用着？**

因为==一条 TCP 连接不是靠「端口」认的，是靠**四元组**认的==：

```compare
first: 四元组里的那一项
head: ["连接 1", "连接 2", "连接 3"]
rows:
  - 服务端 IP: ["192.168.1.10", "192.168.1.10", "192.168.1.10"]
  - 服务端端口: ["80", "80", "80"]
  - 客户端 IP: ["10.0.0.1", "==10.0.0.2==", "10.0.0.1"]
  - 客户端端口: ["50001", "50001", "==50002=="]
```

!!看第 1 和第 2 列：**客户端端口都是 50001，服务端也是同一个 80**，照样是两条不同的连接，因为客户端 IP 不一样。!!

==所以「80 端口被占用了」这个说法不准确。== 准确的说法是：**这 N 条连接都把 80 当作自己的那一端。** 内核靠四元组的任意一位不同来区分它们。

监听 socket 的 `0.0.0.0:80` 也不是「一条连接」，它是一个**通配的接收条件**，「凡是发到本机 80 端口的、我还没见过的连接，都送到我这来」。

---

## 05 · 线程里发生了什么：一份代码，N 个栈

现在回答那个正题：**每个线程里是不是复制了一份服务端代码？**

**不是。** 而且这件事用一个函数就看清楚了：

```demo
widget: code-and-stacks
title: 一份代码，N 个执行现场
hint: 点任意一张栈，让它阻塞在 read
config:
  threads: { min: 1, max: 6, step: 1, def: 3 }
```

上面那个 `handle_request` 函数，**编译出来的机器指令在整个进程里只有一份**，放在只读的代码段。三个线程谁被调度到，谁就执行同一份指令。

但下面那三块 `char buf[1024]` 是 **3 份**，因为它是**局部变量**，局部变量住在**各自的栈**上。

```compare
first: 东西
head: [几份, 为什么]
rows:
  - 函数代码（机器指令）: [{ text: "1 份", tone: green }, "只读的代码段。==所有线程执行的是同一份指令=="]
  - "`char buf[1024]`": [{ text: "N 份", tone: red }, "局部变量住在栈上，每个线程有自己的栈"]
  - 全局变量 / 堆: [{ text: "1 份", tone: amber }, "共享：==所以多线程改它要加锁=="]
  - 文件描述符表: [{ text: "1 份", tone: amber }, "共享：==所以 fd 7 在哪个线程里指的都是同一个 socket=="]
  - 寄存器 / 程序计数器: [{ text: "N 份", tone: red }, "每个线程执行到哪、手上有什么，各记各的"]
```

!!所以准确的说法不是「复制了代码」，而是：**同一份代码，N 个执行现场。**!!

==「代码」和「正在执行代码」是两件事。== 前者是只读的字节，谁都能跑；后者需要寄存器、需要栈、需要一个「执行到哪了」的位置，这些才是一个线程真正独有的东西。

---

## 06 · 一张表把「一份 / N 份」列清

这一篇的所有内容，压缩成一张表：

```compare
first: 东西
head: [一份还是 N 份, 后果]
rows:
  - 服务端代码: [{ text: "一份", tone: green }, "一万个线程也不会多占一个字节"]
  - 监听 socket: [{ text: "一份", tone: green }, "一个端口一个；它只负责接新连接"]
  - 连接 socket: [{ text: "N 份", tone: red }, "每条连接一个，各带自己的缓冲区和状态"]
  - 接收 / 发送缓冲区: [{ text: "N 份", tone: red }, "内核的内存，每个 socket 自己的"]
  - 线程栈 + 寄存器: [{ text: "N 份", tone: red }, "局部变量在这里，所以 `buf` 有 N 份"]
  - 打开文件表 / 堆: [{ text: "一份", tone: amber }, "共享，所以需要同步"]
```

需要 `needs` 深挖的，回这两篇：线程共享/独享的完整清单在 `os-thread` 的 02 节；一个 socket 在内核里长什么样在 `socket-fd`。

---

## 07 · 于是「一连接一线程」的代价就清楚了

一万个浏览器连上来，一连接一线程，那么：

```flow
grid: true
groups:
  - { id: one, label: "全进程只有一份", tone: green }
  - { id: many, label: "每个连接各一份", tone: red }
nodes:
  - { id: code, label: "服务端代码", sub: "机器指令，只读", row: 0, tone: green, group: one }
  - { id: sock, label: "一万个连接 socket", sub: "各带自己的接收缓冲区", row: 1, tone: red, group: many }
  - { id: stack, label: "一万个线程栈", sub: "各带自己的局部变量", row: 2, tone: red, group: many }
  - { id: sched, label: "一万个调度实体", sub: "==都排在调度器名单上==", row: 3, tone: red, group: many }
edges:
  - { from: code, to: sock, label: "" }
  - { from: sock, to: stack, label: "" }
  - { from: stack, to: sched, label: "" }
```

**但注意：一万份「N 份」的东西里，代码不在其中。** 所以亏的不是内存里的代码，而是：

> **一万份「因为要等而必须养着」的执行资源。**

==这就是下一段故事的开头，也是「等待不该占用执行资源」那句话的具体样子。==

---

## 08 · 顺带回答第二个问题：监听 socket 和连接 socket 的区别

```compare
first: 对比项
head: [监听 socket, 已连接 socket]
rows:
  - 怎么来的: ["`socket → bind → listen`", "`accept()` 从队列里取出来的"]
  - TCP 状态: ["`LISTEN`", "通常 `ESTABLISHED`"]
  - 地址: ["`0.0.0.0:80`（通配）", "服务端 IP:80 ↔ 对端 IP:端口"]
  - 有没有对端: [{ text: "没有", tone: amber }, { text: "有，就那一个", tone: green }]
  - 干什么: ["只接新连接，不传数据", "收发这条连接的业务数据"]
  - 平时调什么: ["`accept()`", "`read()` / `write()`"]
  - 数量: ["一个端口一个（就一个）", "每条连接一个"]
  - 关掉它: ["再也不能接新连接", "只断开那一个客户端"]
```

!!最常见的误解是「`accept()` 把监听 socket 变成了连接 socket」。!! 不是：==`accept` 不动监听 socket，它只是**另外**给你一个新的。== `listen_fd` 从进程启动到进程结束，一直在那守着。

---

```quiz
- q: 一个连接是什么时候在内核里被建出来的？accept 那一刻吗？
  a: |
    不是。三次握手完成的那一刻，内核就已经为这条连接建好了 socket 对象，
    并放进 accept 队列。accept 做的事只是「从队列里取出来，把 fd 交给你」。
    所以握手是内核替你完成的，你的程序不需要在场。
- q: 为什么一堆连接可以共用 80 端口？
  a: |
    因为一条 TCP 连接是靠四元组（服务端 IP、服务端端口、客户端 IP、客户端端口）
    唯一确定的，不是靠端口。
    只要四元组里有任意一位不同，就是两条不同的连接 ——
    哪怕客户端端口都一样，客户端 IP 不同也能区分开。
    所以「80 端口被占用了 N 次」这个说法不准确，
    准确说是这 N 条连接都把 80 当作自己的那一端。
- q: 一万个线程会不会复制一万份服务端代码？
  a: |
    不会。代码段是只读的，整个进程一份，所有线程执行的是同一份机器指令。
    每个线程独有的是栈、寄存器、程序计数器这些「执行现场」。
    准确的说法不是「复制了代码」，而是「同一份代码，N 个执行现场」。
    「代码」和「正在执行代码」是两件事。
- q: 那 `handle_request` 里的 `char buf[1024]` 有几份？
  a: |
    有几份线程就有几份。它是局部变量，局部变量住在栈上，
    每个线程有自己的栈，所以 buf 在各自的栈上各有一块。
    这也是这段代码能安全地同时处理多个连接的原因：
    只要不碰全局变量和堆，线程之间就互不干扰。
- q: 一连接一线程时，一万个连接真正被浪费掉的是什么？
  a: |
    不是代码（代码始终只有一份），而是「因为要等而必须养着」的执行资源：
    一万个线程栈、一万个调度实体，其中绝大部分时间什么也没干。
    连接 socket 和它的缓冲区是必须的（每个连接本来就要有），
    线程不是，它只是因为「阻塞式代码需要一个线程来承接等待」才被创建。
```
