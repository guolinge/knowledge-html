> 一个 TCP 服务，`accept()` 拿到连接后马上就 `read()`。客户端还没来得及发数据，这一行就停住了。
>
> 进程没有退出，CPU 也没有烧起来。它去了哪里？这一篇只回答这一件事，因为后面所有方案都建立在它上面。

## 01 · 停在这一行

```c
int fd = accept(listen_fd, NULL, NULL);

char buf[1024];
ssize_t n = read(fd, buf, sizeof buf);   /* 客户端还没发数据，停在这里 */
```

「停在这里」不是比喻。这条线程确实不再执行下一条指令了，但它也没有消失：

- 它的栈还在，`buf` 还在栈上；
- 它的 task 结构还在内核里，进程表里还能查到它；
- 它只是不在 CPU 的运行队列上了。

要理解它去了哪，先得看清 `fd` 背后是什么。fd 到打开文件表这一段，[VFS 与文件的使用](../fs-vfs-layers/) 里已经拆过，这里只取结论。

## 02 · fd 只是下标，连接在内核里长这样

`accept()` 还给你的只是一个整数。这个整数是进程 fd 表里的下标，顺着它才能找到内核里那条连接：

```tree
- label: 进程的 fd 表
  sub: files_struct
  tone: muted
  note: fd 是这张表的下标，不是连接本身
  children:
    - label: "fd 4"
      sub: 指向一个打开文件
      children:
        - label: struct file
          note: 打开文件的描述，多个 fd 可以指向同一份
          children:
            - label: struct socket / struct sock
              note: 这条连接在内核里的本体
              children:
                - label: 接收队列 sk_receive_queue
                  note: 对端发来的数据先排在这里
                  children:
                    - { label: skb, note: 一个包。队列空的时候，read 没有东西可拷 }
                - label: 等待队列 sk_wq
                  note: 等这条连接的人挂在这里
                  children:
                    - label: wait_queue_entry
                      sub: "{ func, private, entry }"
                      note: 阻塞 read 挂上去的那一份
                      children:
                        - { label: func, sub: woken_wake_function, note: 唤醒时内核调用它 —— 这个位置可以换成别的函数 }
                        - { label: private, sub: task, note: 指向谁 —— 阻塞 read 指向自己 }
```

这两个队列分工很明确：

- **接收队列**装的是「数据已经到了，还没被取走」；
- **等待队列**装的是「有人想取，但现在没有」。

`read()` 卡住的时候，接收队列是空的。线程要做的第一件事，是把自己登记到等待队列上。

## 03 · 睡下之前，内核做了三件事

顺序很重要，三步都在 `sk_wait_data()` 这条路径里：

```cards
cols: 3
items:
  - title: 先挂上
    tag: add_wait_queue
    tone: blue
    desc: 把自己的 wait 条目加进 socket 的等待队列。
    code: |
      add_wait_queue(sk_sleep(sk), &wait);
  - title: 再检查一次
    tag: 条件
    tone: amber
    desc: 挂好之后才看接收队列。如果这时已经有数据，就不用睡了。
    code: |
      sk_wait_event(sk, &timeo,
        skb_peek_tail(&sk->sk_receive_queue) != skb, &wait);
  - title: 最后让出 CPU
    tag: schedule
    tone: violet
    desc: 状态改成 TASK_INTERRUPTIBLE（可被信号打断），然后调度走人。
    code: |
      wait_woken(wait, TASK_INTERRUPTIBLE, timeo);
```

为什么必须先挂上、再检查？

因为「检查」和「睡下」之间有一个空档。如果先检查发现没数据，再去挂队列，那么在这两步之间到达的数据会找不到任何等待者 —— 它敲门的时候屋里还没人。等线程挂好再睡下，这两步之间到达的数据也能看见队列里的等待者，不会丢掉那次唤醒。

先挂、后查，让这两步之间到达的数据一定能看见队列里的条目。

```callout
tone: amber
icon: ⚠
text: |
  这个顺序是「不丢唤醒」的全部要害。自己写等待逻辑时，顺序反过来会出现偶发的挂死 —— 概率低到测不出来。
```

## 04 · 一条数据从网卡到线程

下面这张时序图把一次完整的 `read()` 画完。中间的空白是线程睡着的那段时间，可能是几毫秒，也可能是几十秒。

```seq
grid: true
participants:
  - { id: app, label: 你的线程, sub: "read(fd, buf, 1024)", kind: backend }
  - { id: sock, label: socket, sub: 接收队列 + 等待队列, kind: database }
  - { id: nic, label: 网卡与协议栈, sub: 硬中断 → 软中断, kind: cloud }
messages:
  - { from: app, to: sock, label: "read(fd, buf, 1024)", kind: sync, note: 1 }
  - { from: sock, to: sock, label: "看接收队列：空", kind: self, note: 2 }
  - { from: sock, to: sock, label: "把自己的 wait 条目挂进等待队列", kind: self, note: 3 }
  - { from: app, to: app, label: "状态置 TASK_INTERRUPTIBLE，schedule() 让出 CPU", kind: self, note: 4 }
  - { from: nic, to: sock, label: "包到了：协议栈把它放进接收队列", kind: async, note: 5, gap: 72 }
  - { from: sock, to: sock, label: "sk_data_ready() → wake_up(等待队列)", kind: self, note: 6 }
  - { from: sock, to: app, label: "遍历队列调 func：task 改回 RUNNING", kind: async, note: 7 }
  - { from: app, to: sock, label: "回到 read：从接收队列拷 1024 字节到 buf", kind: sync, note: 8 }
  - { from: sock, to: app, label: "返回 1024", kind: reply, note: 9 }
```

几个容易看漏的点：

- 第 ⑤ 步之前，接收队列一直是空的，线程一直在睡。**等待期间没有任何线程在检查这条连接。**
- 第 ⑥ 步是 socket 自己的方法 `sk_data_ready`，TCP 默认指向 `sock_def_readable`。协议栈把数据放进队列后调用它。
- 第 ⑦ 步才回到你的线程。内核遍历等待队列，对每个条目调它的 `func`。阻塞 read 的 `func` 是 `woken_wake_function`，它做的是把 `private` 指向的 task 改回可运行状态，挂回运行队列。
- 第 ⑧ 步是真正的数据搬运：从内核的接收队列拷进你的 `buf`。**数据不是唤醒时到你手里的**，唤醒只是告诉你「现在可以读了」。

## 05 · 被叫醒不等于拿到数据

这里值得停一下。`wake_up` 做的事情里，没有一件和你的缓冲区有关：

```compare
first: 时刻
head: [内核里发生了什么, 你的 buf 里有什么]
rows:
  - 数据到达:
      - "协议栈分配 skb，挂进接收队列；唤醒等待队列"
      - "还是空的。一个字节都没进来"
  - 线程被唤醒:
      - "task 回到运行队列。等调度器挑中它"
      - "还是空的"
  - read 继续执行:
      - "重新检查接收队列，把 skb 里的数据拷进用户缓冲区"
      - "这时才有数据"
  - read 返回:
      - "拷贝完成，可能还有没读完的数据留在接收队列里"
      - "拿到了 n 个字节"
```

最后一行埋着下一篇的一个伏笔：**接收队列里可能还留着数据**。「就绪」的判断和怎么处理这点残留，是 LT 与 ET 全部分歧的来源。

## 06 · 这一刻，什么被占住了

线程睡下之后，CPU 是自由的，但下面这些东西仍被这条连接占着：

```cards
cols: 4
items:
  - title: 一个 task
    tag: task_struct
    desc: 内核里的任务描述，大小随内核配置变化，通常在几 KB 到十几 KB 量级。
  - title: 一个内核栈
    tag: 16 KB · x86-64
    desc: 线程在内核态执行时需要自己的栈。Linux 在 x86-64 上给它四页。
  - title: 一片用户栈
    tag: 按需分配
    desc: pthread 默认预留 8MB 虚拟地址空间，但只有真正碰到的页才占物理内存。
  - title: 一个执行现场
    tag: 最贵的一项
    desc: read 还没有返回，这条线程就不能去服务别的连接。它被这一条连接绑住了。
```

前三项是内存。第四项不是。

一个线程的栈再小，只要它停在 `read()` 里，它就不能同时替另一条连接等。所以「一连接一线程」的真正上限，不是内存条有多长，而是**你愿意为「等待」维持多少个执行单位**。

下一篇把这笔账算细。这里先记一个观察：

```callout
tone: violet
icon: 💡
quote: true
text: |
  看等待队列上的那个条目：`{ func, private }`。

  内核唤醒它的时候，只是调用 `func`。它并不关心里面装的是什么。
  阻塞 read 让 `private` 指向一个 task，所以唤醒的代价是「唤醒一个线程」。

  ==换个 `func`，等待就可以由一段函数来承载。==
```

这不是空想。数据到达时，内核能做的其实只有两件小事：把某个条目放进一个链表、叫醒可能在等的线程。如果 `func` 做的就是这两件事，那么「等」的载体就不需要是一个 task —— 没有栈，也不需要被调度。

epoll 的全部设计，就建立在这个位置上。下一篇先看没有它的时候，账是怎么算的。

```quiz
- q: 阻塞 read 的线程，在等待期间处于什么状态？它还在运行队列上吗？
  a: |
    它被置为 `TASK_INTERRUPTIBLE`，从运行队列上摘下来，挂进了 socket 的等待队列。
    它不占 CPU，但 task 结构、内核栈和用户栈都还在。
- q: 为什么必须先把自己挂进等待队列，再检查有没有数据？
  a: |
    否则「检查完、还没睡下」这段空档里到达的数据找不到等待者，唤醒会丢。
    先挂后查，保证这期间到达的数据一定能在队列里看到你的条目。
- q: read 返回时，数据是从哪里拷过来的？
  a: |
    从 socket 的接收队列（内核内存）拷进你的用户缓冲区。
    数据到达时先入接收队列，唤醒只表示「现在读不会阻塞」。
```
