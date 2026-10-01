## 01 · 六个名字，一条判据

文件 I/O 的分类看着很杂，常见的说法有六种：

```cards
cols: 3
items:
  - { title: 缓冲 I/O, desc: "走标准库的缓冲", tag: 按「用不用标准库缓存」分, tone: blue }
  - { title: 非缓冲 I/O, desc: "直接走系统调用", tag: 按「用不用标准库缓存」分, tone: blue }
  - { title: 直接 I/O, desc: "不经过内核页缓存", tag: 按「用不用内核缓存」分, tone: violet }
  - { title: 非直接 I/O, desc: "默认走内核页缓存", tag: 按「用不用内核缓存」分, tone: violet }
  - { title: 同步 I/O, desc: "阻塞 / 非阻塞 / 多路复用都算", tag: 按「等不等」分, tone: amber }
  - { title: 异步 I/O, desc: "内核替你干完再通知你", tag: 按「等不等」分, tone: amber }
```

六种说法，只有三组问题：

| 问什么 | 分出来的名字 |
|---|---|
| 要不要经过**标准库**那层缓冲？ | 缓冲 I/O / 非缓冲 I/O |
| 要不要经过**内核**那层缓存？ | 直接 I/O / 非直接 I/O |
| 调用返回之前，**要不要等**？ | 同步 I/O / 异步 I/O |

前两组是「数据在路上经过谁」，第三组是「你本人要不要蹲在路边看着」。这三组可以自由组合，所以真实项目里会出现「非阻塞 + 直接 I/O + 多路复用」这种叠起来叫法。

==第三组才是最难的那个，也是面试里最爱问的。== 而它之所以容易混，是因为大家都在拿「名字」记，而不是拿「在哪一段等」记。

---

## 02 · 一次读盘要拆成两个阶段

先看一次 `read` 到底发生了什么：

```flow
grid: true
groups:
  - { id: ker, label: "内核空间", tone: violet }
nodes:
  - { id: call, label: "应用调用 read", sub: "你交出一个缓冲区", row: 0, tone: muted }
  - { id: wait, label: "① 数据准备", sub: "内核去磁盘把数据取回来", row: 1, tone: amber, group: ker }
  - { id: copy, label: "② 数据拷贝", sub: "从内核缓冲区拷进你的缓冲区", row: 2, tone: blue, group: ker }
  - { id: back, label: "read 返回", sub: "这时候数据才真的在手边", row: 3, tone: green }
edges:
  - { from: call, to: wait, label: "发起" }
  - { from: wait, to: copy, label: "磁盘的数据到了" }
  - { from: copy, to: back, label: "拷完了" }
```

==判据就是这两段：你在这个阶段会不会被挂起。==

把五种模型按「这两段卡不卡」列一遍，六种叫法就全部归位了。拖动时间指针，看每一刻应用到底能不能干别的：

```demo
widget: io-models
title: 五种 I/O 模型挨在同一条时间轴上
actions: false
hint: 拖动下面的时间滑块
config:
  tMax: 10
  tail: 橙色那一段是「数据拷贝」。它出现在除异步 I/O 之外的每一个模型里，这就是「同步 / 异步」的真正分界线。
  models:
    - id: blocking
      name: 阻塞 I/O
      sub: "默认就是这样"
      sync: sync
      wait: block
      copy: block
      segs:
        - { from: 0, to: 7, state: wait, text: "read 一调用就交出了控制权，一直等到内核把数据准备好" }
        - { from: 7, to: 9, state: copy, text: "数据到了，内核往你的缓冲区里拷，这个过程你也得等" }
        - { from: 9, to: 10, state: done, text: "read 返回，终于能用这份数据了" }
    - id: noblock
      name: 非阻塞 I/O
      sub: "设置 O_NONBLOCK"
      sync: sync
      wait: poll
      copy: block
      segs:
        - { from: 0, to: 1, state: wait, text: "read 立刻返回 EWOULDBLOCK：还没好，你走吧" }
        - { from: 1, to: 2, state: free, text: "这段时间应用可以干别的事" }
        - { from: 2, to: 3, state: wait, text: "又来问一次：好了没？还是没有" }
        - { from: 3, to: 4, state: free, text: "再去干点别的" }
        - { from: 4, to: 6, state: wait, text: "反复问。轮询本身也占着 CPU" }
        - { from: 6, to: 7, state: wait, text: "这次有了" }
        - { from: 7, to: 9, state: copy, text: "最后一次 read 得等拷贝完成，这一段和非阻塞无关" }
        - { from: 9, to: 10, state: done, text: "拿到数据" }
    - id: select
      name: I/O 多路复用
      sub: "select / poll / epoll"
      sync: sync
      wait: poll
      copy: block
      segs:
        - { from: 0, to: 7, state: wait, text: "卡在 epoll_wait 上，但是同时盯着几百个 fd" }
        - { from: 7, to: 8, state: done, text: "内核通知：这几个 fd 可读了" }
        - { from: 8, to: 9, state: copy, text: "去 read 一下，还得等拷贝" }
        - { from: 9, to: 10, state: done, text: "拿到数据" }
    - id: sigio
      name: 信号驱动 I/O
      sub: "注册 SIGIO"
      sync: sync
      wait: no
      copy: block
      segs:
        - { from: 0, to: 1, state: done, text: "注册完就回来了，不用守着" }
        - { from: 1, to: 7, state: free, text: "这段时间完全属于应用自己" }
        - { from: 7, to: 8, state: done, text: "信号到了：数据准备好了" }
        - { from: 8, to: 9, state: copy, text: "信号处理里发起 read，还是得等拷贝" }
        - { from: 9, to: 10, state: done, text: "拿到数据" }
    - id: aio
      name: 异步 I/O
      sub: "aio_read / io_uring"
      sync: async
      wait: no
      copy: no
      segs:
        - { from: 0, to: 1, state: done, text: "aio_read 立刻返回，剩下的事全交给内核" }
        - { from: 1, to: 9, state: free, text: "内核自己准备数据、自己拷贝，全程不打扰应用" }
        - { from: 9, to: 10, state: done, text: "收到完成通知，数据已经在缓冲区里了" }
```

把图上的话翻译成一句：

> **同步 I/O**：数据准备和拷贝这两段里，至少有一段是你自己在等。
> **异步 I/O**：两段都不用你等，内核干完了通知你。

```callout
tone: red
icon: ⚠
text: |
  **「非阻塞」不是「异步」。这是这里最容易错的一处。**

  非阻塞解决的只是「数据准备阶段不用干等」，
  最后一次 `read` 把数据从内核拷进你的缓冲区时，==你照样被卡住==。

  所以：非阻塞 I/O、多路复用、信号驱动 I/O，**三个都是同步 I/O**。
  只有 `aio_read` 那一类才是真的异步。
```

### 逐个看一眼区别在哪

```compare
first: 模型
head: [数据准备阶段, 数据拷贝阶段, 这段时间应用在干嘛]
rows:
  - 阻塞 I/O: [{ text: 卡住, tone: red }, { text: 卡住, tone: red }, "什么也干不了"]
  - 非阻塞 I/O: [{ text: 轮询, tone: amber }, { text: 卡住, tone: red }, "反复问，问的间隙能干点别的"]
  - I/O 多路复用: [{ text: "卡在 select 上", tone: amber }, { text: 卡住, tone: red }, "一次等很多个 fd，但等的这段时间还是干不了别的"]
  - 信号驱动 I/O: [{ text: 不卡, tone: green }, { text: 卡住, tone: red }, "内核准备好了才来找你"]
  - 异步 I/O: [{ text: 不卡, tone: green }, { text: 不卡, tone: green }, "全过程都不管，最后收货"]
```

非阻塞和多路复用常被合起来用：==多路复用的价值不在于「不卡」，而在于「一次卡着等很多个 fd」。== 一个个用非阻塞去轮询 500 个连接，CPU 会烧在那 500 次系统调用上。

---

## 03 · 缓冲 I/O：标准库那一层

这一组跟等不等无关，问的是「路上经不经过标准库」。

```lane-stack
- badge: 缓冲 I/O
  title: 带走标准库的缓存
  desc: 数据先攒在用户态，攒够了再进内核
  tone: blue
  nodes:
    - { title: 你的代码, sub: "printf(\"...\\n\")" }
    - { title: 标准库缓冲区, sub: "用户在进程内存里", tag: 攒着 }
    - { title: 系统调用, sub: "write(2)", tag: 攒够才发 }
    - { title: 内核页缓存, sub: "内核里的那一层" }
  next: "非缓冲 I/O :: :: 少一层，代价是多发系统调用"
- badge: 非缓冲 I/O
  title: 直接调系统调用
  desc: 每次写都真的进内核
  tone: amber
  nodes:
    - { title: 你的代码, sub: "write(2)" }
    - { title: 系统调用, sub: "每一次都发", tag: 开销大 }
    - { title: 内核页缓存, sub: "内核里的那一层" }
```

这一层的价值全在「减少系统调用次数」上。系统调用不是免费的函数调用，它要陷入内核，涉及 CPU 上下文的保存和恢复。

真实感受一下：

```cards
cols: 1
items:
  - title: 为什么 printf 不带换行就不输出
    desc: "不是坏了，是标准库还在替你把内容攒着"
    tone: blue
    body: |
      写 C 的时候常遇到这种情况：`printf("hello");` 之后程序还在跑，
      可终端上什么都没有；改成 `printf("hello\n");` 立刻就出来了。

      这不是终端的问题，也不是 printf 的问题。

      标准库积累到一定量、或者遇到换行（行缓冲模式）、或者你主动 `fflush(stdout)`，
      才会真的发起 `write(2)`。==攒着不发，本身就是这一层存在的全部意义。==

      ```c
      printf("hello");          // 还在标准库缓冲区里
      fflush(stdout);           // 现在才真的发出去
      ```
  - title: 对，就是用「多出来的内存」换「少下去的陷内核次数」
    desc: "一次 write 要陷入内核，攒十次发一次就省了九次"
    tone: violet
    body: |
      每次系统调用都要经历：用户态切到内核态、保存现场、执行、再切回来。
      这个开销在单次调用里很小，但百万次累积起来就非常可观。

      标准库的这一层缓冲，就是把 N 次 `write(2)` 合成一次。
```

---

## 04 · 直接 I/O：内核那一层

这一组问的是「路上经不经过内核的页缓存」。

```journey
- tag: 非直接 I/O
  tone: blue
  name: 默认路径
  badge: 经过内核缓存
  fields:
    - { k: 第 1 站, v: "应用缓冲区", note: 你 malloc 出来的那块内存 }
    - { k: 第 2 站, v: "内核页缓存", note: 多一次内存拷贝, tone: warn }
    - { k: 第 3 站, v: "磁盘", note: 内核自己挑时机刷下去 }
  note: 读的时候方向反过来：磁盘 → 页缓存 → 你的缓冲区
  next: "加一个 O_DIRECT 标志 :: :: 少坐一站"
- tag: 直接 I/O
  tone: green
  name: O_DIRECT
  badge: 绕过页缓存
  fields:
    - { k: 第 1 站, v: "应用缓冲区" }
    - { k: 第 2 站, v: "磁盘", note: 中间不再经手内核缓存, tone: ok }
  note: 省掉一次内存拷贝，也省掉两份缓存占同一份内存
```

```compare
first: 类型
head: [数据在内存里走了几趟, 怎么开启]
rows:
  - 非直接 I/O: ["用户缓冲区 → 内核页缓存（读时反向）", "默认行为，什么都不用设"]
  - 直接 I/O: ["用户缓冲区 ↔ 磁盘，中间不经内核页缓存", "`open()` 时带 `O_DIRECT` 标志"]
```

==页缓存的存在是为了让「读第二次」变便宜。== 第一次读文件时数据会被留在内核里，第二次读同一个文件，直接从内存返回，根本不碰磁盘。

用 `O_DIRECT` 把它绕开，通常只有一个理由：**你有自己的缓存策略**（比如数据库自己管缓冲池），不想让内核再缓存一份，省掉一次内存拷贝、也省掉两份缓存争内存。

### 非直接 I/O 什么时候才真的落盘

用了页缓存，`write` 返回不代表数据在磁盘上。它只是在内存里。触发真正写盘的场合：

```cards
cols: 2
items:
  - { title: write 的时候攒太多了, desc: "内核发现页缓存里堆得太多，顺手就刷一批下去", tag: 自动, tone: blue }
  - { title: 你主动调 sync / fsync, desc: "sync 刷所有文件；fsync(fd) 只刷这一个文件", tag: 手动, tone: green }
  - { title: 内存不够用了, desc: "分配不出新页面时，内核会回收脏页换出空间", tag: 被动, tone: amber }
  - { title: 缓存时间到了, desc: "脏页在内存里待够一定时间，就被刷下去", tag: 定时, tone: muted }
```

!!所以 `write` 成功 ≠ 数据落盘。断电时丢的就是页缓存里的那部分。!! 真要保证落盘，得在 `write` 之后显式 `fsync`。

---

## 05 · 换成饭堂打饭

这几个模型干讲很抽象，换成去饭堂打饭就非常直观：

```cards
cols: 1
items:
  - title: "阻塞 I/O：站在窗口前一直等"
    tone: red
    body: |
      菜还没做好，你就在窗口前干站着。等菜做好（数据准备），再等阿姨打到你的饭盒里（数据拷贝），
      两个过程都在等，全程你都走不开。
  - title: "非阻塞 I/O：问一句就走，过会儿再来问"
    tone: amber
    body: |
      你跑到窗口问「好了没」，阿姨说没好，你就走了。过一会儿再来问，还是没好。
      反复问了很多次之后终于好了。

      但==阿姨往你饭盒里打菜这段，你还是得站着等==。这就是最后那次 `read` 的拷贝阶段。
  - title: "I/O 多路复用：一次问一排窗口"
    tone: violet
    body: |
      饭堂有一排窗口，你告诉管理员「哪个窗口好了叫我」（`select` / `epoll_wait`），
      然后你就等着。等管理员喊你，你还得自己一个个窗口看是哪个好了。

      好处是：**你只排了一次队，就把所有窗口都盯上了**。
  - title: "信号驱动 I/O：留个电话，好了叫我"
    tone: blue
    body: |
      你留个电话给阿姨，然后就回去干别的。菜好了阿姨打电话给你。

      但你接到电话之后还得跑过去、还得等阿姨打菜。==那段等待没省掉，只是从「准备阶段」挪到了「拷贝阶段」==。
  - title: "异步 I/O：让阿姨打好送到你面前"
    tone: green
    body: |
      你跟阿姨说「菜做好、打到我饭盒里，然后送我桌上」，然后就回去干别的了。

      中间所有环节你都不用管，送到你面前时你直接吃。==这才叫异步==，两项都不用等。
```

---

```quiz
- q: 非阻塞 I/O 为什么还是同步 I/O？
  a: |
    因为「非阻塞」只作用在数据准备阶段：没准备好就立刻返回，不让你干等。
    但最后一次 read 把数据从内核缓冲区拷进你的缓冲区时，你还是要等。
    这一段跟阻塞不阻塞无关。只要拷贝阶段要等，它就是同步 I/O。
- q: 那我干脆用多路复用，是不是就异步了？
  a: |
    不是。多路复用（select/poll/epoll）解决的是「一次等很多个 fd」，
    它在数据准备阶段照样是卡着的，只是卡在一个地方等很多个来源。
    真正的异步 I/O 是 aio_read / io_uring 那一类：连拷贝都由内核代劳，完成后才通知你。
- q: 页缓存和标准库缓冲是同一个东西吗？
  a: |
    不是。标准库缓冲在用户空间，属于你的进程；页缓存在内核空间，属于操作系统，
    所有进程共用。所以「缓冲/非缓冲 I/O」和「直接/非直接 I/O」是两组独立的分法：
    前者问走不走标准库，后者问走不走内核页缓存。
- q: 写完文件立刻断电，数据一定丢吗？
  a: |
    不一定，但不能假设它在。默认（非直接 I/O）下 write 只是把数据交给页缓存，
    内核什么时候刷盘由它自己决定。要确保落盘，得在 write 之后调 fsync。
```
