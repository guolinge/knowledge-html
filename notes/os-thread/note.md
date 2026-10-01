## 01 · 为什么需要线程

假设你要写一个视频播放器。核心功能就三个：

- 从视频文件里读数据
- 把读到的数据解压缩
- 把解压后的画面和声音放出来

用单进程写，最自然的写法是三个函数依次调用：

```lane-stack
- badge: 方案一
  title: 单进程
  desc: 三个功能串在一条执行流上
  tone: red
  nodes:
    - { title: Read, sub: "从硬盘读一帧", tag: 卡在这 }
    - { title: Decompress, sub: "解压这一帧", tag: 等 Read }
    - { title: Play, sub: "播出这一帧", tag: 等解压 }
  next: "拆成三个进程 :: :: 能并发了，但资源各一份"
- badge: 方案二
  title: 多进程
  desc: 三个进程各跑各的
  tone: amber
  nodes:
    - { title: 读进程, sub: "自己的地址空间" }
    - { title: 解压进程, sub: "自己的地址空间" }
    - { title: 播放进程, sub: "自己的地址空间" }
  next: "多进程的两个新问题 :: :: 怎么通信，怎么摊开销"
- badge: 方案三
  title: 多线程
  desc: 三条执行流，共用同一个地址空间
  tone: green
  nodes:
    - { title: 读线程, sub: "共享代码段和数据段" }
    - { title: 解压线程, sub: "各自独立的寄存器和栈" }
    - { title: 播放线程, sub: "共享打开的文件" }
```

### 单进程卡在哪

`Read` 要等硬盘。硬盘返回之前，整条执行流都停在那一行上。后面的解压和播放，全做不了。

结果是播放出来的画面和声音一顿一顿的。

看着像「性能不够」，真实原因是三个模块没办法同时推进：一个在等 I/O，另外两个明明可以干活，却被同一条执行流绑住了。

### 多进程为什么还不够

拆成三个进程确实能并发了。但新问题跟着来：

```compare
first: 问题
head: [具体表现, 有多贵]
rows:
  - 进程之间怎么通信: ["地址空间互不相通，要传数据得走管道 / 共享内存 / socket", "都要经过内核，一次拷贝起步"]
  - 创建和终止的开销: ["要分配资源、建 PCB；终止要回收、撤销 PCB", "比建一个线程贵一个量级"]
  - 切换的开销: ["两个进程的地址空间不一样，切的时候要换页表", "页表一换，TLB 就作废了"]
```

这三个进程明明在给同一个播放器干活，却被迫各自维护一整套地址空间、文件表、内存映射。它们需要共享的东西太多了，而进程在设计上是最小共享单位。

### 需要一个新东西

理一下需求，它要同时满足两条：

```
① 能并发执行        解决「Read 卡住，别的干不了」
② 共享同一个地址空间  解决「通信和开销」
```

线程就是这个东西。

```callout
tone: violet
icon: 🧵
text: |
  **线程是进程当中的一条执行流程。**

  同一个进程里的多个线程共享代码段、数据段、打开的文件，
  ==但每个线程有自己独立的一套寄存器和栈==。

  后面这句才是关键：共享的东西决定切换有多便宜，独享的东西决定切换要保存什么。
```

---

## 02 · 线程共享什么、独享什么

把「一个进程」拆开看，它的资源分成两类：

```tree
- label: 一个进程
  note: 进程是资源分配的单位，它拥有这些东西
  children:
    - label: 共享的部分
      note: 所有线程看到的是同一份
      children:
        - { label: 代码段, note: 编译出来的指令，只读 }
        - { label: 数据段 / 堆, note: 全局变量、malloc / new 出来的内存 }
        - { label: 打开的文件, note: "所有线程共用同一张文件描述符表" }
        - { label: "页表 / 地址空间", note: "同一份虚拟地址映射，线程切换便宜的根本原因" }
    - label: 独享的部分
      note: 每个线程各有一份，切换时才有东西要保存
      children:
        - { label: 寄存器, note: "含 PC，记录这个线程执行到哪一条指令" }
        - { label: 栈, note: "函数调用链、局部变量，互不干扰" }
```

### 页表：为什么它决定了切换的开销

每个进程有一张**页表**，记录「虚拟地址的哪一页对应物理内存的哪一页」。

查一次页表要多访问一次内存，太慢了。所以 CPU 里有一个**快表**（TLB），缓存最近用过的那些映射：

```journey
- tag: ①
  tone: green
  name: 查快表
  badge: 命中
  fields:
    - { k: 虚拟页号, v: "0x4", note: 就在表里, tone: ok }
    - { k: 物理页号, v: "0xC", note: 直接拿到 }
  note: 表在 CPU 内部，几个周期就有结果
  next: "没命中 :: :: 只能老实去内存里查页表"
- tag: ②
  tone: amber
  name: 查页表
  badge: 没命中
  fields:
    - { k: 虚拟页号, v: "0x4" }
    - { k: 物理页号, v: "0xC", note: 顺手填进快表, tone: ok }
  note: 这一次多访问了一次内存，但同样的地址下一次就快了
```

关键在这一句：

> ==快表里缓存的映射，只对当前这个地址空间成立。==

因为「虚拟地址 0x4000」这个数本身不带任何信息，同一串地址在两个进程里可以指向完全不同的物理页：

```flow
grid: true
groups:
  - { id: mem, label: "同一串虚拟地址，落到完全不同的物理页上", tone: blue }
nodes:
  - { id: ava, label: 进程 A 的程序里, sub: "虚拟地址 0x4000", row: 0, tone: blue, group: mem }
  - { id: bva, label: 进程 B 的程序里, sub: "同一个 0x4000", row: 0, tone: amber, group: mem }
  - { id: aph, label: 物理页 12, sub: "A 的数据", row: 1, tone: blue, group: mem }
  - { id: bph, label: 物理页 87, sub: "B 的数据", row: 1, tone: amber, group: mem }
edges:
  - { from: ava, to: aph, label: "查 A 的页表" }
  - { from: bva, to: bph, label: "查 B 的页表" }
```

==同一串虚拟地址，靠页表才落到不同的物理页上。== 所以「换不换页表」直接决定了快表里那些缓存还能不能用。这一点在第 04 节成了一个分水岭。

### 栈：每个线程一个

栈不是一块被动分配的内存，它是**运行时的函数调用链**。每调一层函数就往上压一帧，返回时弹掉：

```flow
grid: true
nodes:
  - { id: a0, label: "main()", sub: "线程 A 的栈底", row: 0, tone: green }
  - { id: b0, label: "main()", sub: "线程 B 的栈底", row: 0, tone: blue }
  - { id: a1, label: "loop()", sub: "A 调进来了一层", row: 1, tone: green }
  - { id: b1, label: "loop()", sub: "B 也调了一层，是它自己那份", row: 1, tone: blue }
  - { id: a2, label: "decode()", sub: "A 现在停在这", row: 2, tone: green }
  - { id: b2, label: "handle_input()", sub: "B 现在停在这", row: 2, tone: blue }
edges:
  - { from: a0, to: a1, label: "调用" }
  - { from: a1, to: a2 }
  - { from: b0, to: b1 }
  - { from: b1, to: b2 }
```

!!!两个线程不可能共用一个栈。!! 共用的话，B 的调用会把 A 压在下面的返回地址覆盖掉，两个人都回不去。

所以：

| 独享的是 | 大小 | 装什么 |
|---|---|---|
| 寄存器 | 几百字节 | 当前这条指令的临时状态，含 PC |
| 栈 | 通常几 MB | 调用链、局部变量、返回地址 |

这两个加起来就是「切换时要保存和恢复的东西」，也就是第 04 节要算的账。

### 共享带来的代价

共享省钱，但也省出了麻烦：

```checklist
tone: cross
items:
  - 一个线程崩溃（比如空指针、栈溢出），整个进程一起崩，它们共用同一个地址空间
  - 共享数据被两个线程同时改，结果取决于谁先动手，这叫竞态
  - 出错的现场是共享的，很难判断是哪个线程写坏的
```

游戏里的用户状态就很容易踩第一个坑：如果用多线程实现，一个玩家线程挂掉会带走同一进程里所有玩家。

---

## 03 · 线程和进程各管一段

一句话把两者的分工说清楚：

> **进程是资源分配的单位，线程是 CPU 调度的单位。**

操作系统实际调度的是线程，不是进程。进程做的事情是给线程提供资源：虚拟内存、全局变量、打开的文件。

所以「进程切换」这个词稍微有点歧义。准确地说，是把 CPU 从一个线程还给另一个线程，只是有时候这两个线程属于不同进程。

### 线程比进程省在哪

```compare
first: 操作
head: [进程, 同进程内的线程, 差在哪]
rows:
  - 创建: [{ text: 慢, tone: red }, { text: 快, tone: green }, "进程还要准备内存管理信息、文件管理信息，线程直接共用现成的"]
  - 终止: [{ text: 慢, tone: red }, { text: 快, tone: green }, "线程要还的资源少很多"]
  - 切换: [{ text: 慢, tone: red }, { text: 快, tone: green }, "同进程的线程共用一张页表，切的时候不用换"]
  - 数据传递: [{ text: 慢, tone: red }, { text: 快, tone: green }, "共享内存和文件，线程之间传数据不用过内核"]
```

四个里最有意思的是切换，因为它的差别不是「快一点」，是「要不要动一整套地址空间」。

---

## 04 · 线程的上下文切换差在哪

时钟走一格，是把 CPU 从一个线程交给另一个线程。这两个线程可能有两种关系：

- **同一个进程内的两个线程**：地址空间是同一套
- **不同进程的两个线程**：各自一套地址空间，这时它就等于一次进程切换

### 把切换要做的动作逐步拆开

这个动作可以一步步拆开看：

```demo
widget: switch-cost
title: 同进程内切线程 vs 跨进程切换
actions: false
hint: 一步步走
config:
  tail: 前 3 步和后 1 步两边完全一样。分叉只在第 4、5 步。而这两步一旦发生，新线程接下来每次访存都要重新填 TLB，这笔账是切换之后才付的。
  steps:
    - title: 保存当前线程的寄存器和 PC
      detail: 寄存器里是这个线程执行到哪、算到了哪。存进它自己的内核栈或 TCB 里。
      thread: "yes"
      proc: "yes"
      threadWhy: 每个线程一份
      procWhy: 一样
    - title: 切换内核栈和栈指针
      detail: 每个线程在内核里也有一套栈，系统调用执行到哪就码在它上面。不进内核就切不了。
      thread: "yes"
      proc: "yes"
      threadWhy: 内核栈也是独享的
      procWhy: 一样
    - title: 把新线程标成「运行中」
      detail: 更新两个线程的状态字段，就绪队列里也跟着调整。
      thread: "yes"
      proc: "yes"
      threadWhy: 和地址空间无关
      procWhy: 一样
    - title: 换掉页表基址寄存器
      detail: 这一步决定了 CPU 接下来用哪一张页表翻译地址。x86-64 上就是写 CR3 这个寄存器。
      thread: "no"
      proc: "yes"
      threadWhy: 两个线程共用同一张页表，寄存器里的值本来就不用改
      procWhy: 新进程有一整套自己的地址空间，得换掉
      branch: true
    - title: 处理快表 TLB
      detail: TLB 缓存的是「虚拟页 → 物理页」的映射，而这些映射只对一个地址空间成立。
      thread: "no"
      proc: "yes"
      threadWhy: 地址空间没变，缓存里的项还能继续用
      procWhy: 换了地址空间，旧项全部作废，接下来要一项项重新填
      branch: true
    - title: 恢复新线程的寄存器和 PC，跳过去
      detail: 从新线程存下来的那份现场恢复，CPU 接着它上次停下的地方继续跑。
      thread: "yes"
      proc: "yes"
      threadWhy: 存了什么就恢复什么
      procWhy: 一样
```

### 分叉点只有一步

==分叉只有一处：换不换页表。== 第 5 步是它的连锁反应，不是独立的一笔开销。

```cards
cols: 2
items:
  - title: 同进程内切线程
    desc: 页表不动，TLB 不作废
    tone: green
    body: |
      切换完之后，新线程接着用同一批 TLB 项和 CPU 缓存。

      它要访问的内存，很可能刚刚就被前一个线程访问过，全是热的。

      ++这就是线程切换便宜的真正原因，不是「保存的东西少了几行代码」。++
  - title: 跨进程切换
    desc: 换页表，TLB 作废
    tone: amber
    body: |
      切换本身只是写一个寄存器，很快。

      贵的是**切换之后**：新进程要用的映射一条都不在 TLB 里，
      接下来每次访存都要走一遍「查页表 → 填 TLB」。
      CPU 的缓存也是冷的。

      ==这笔账不会出现在切换的耗时里，而是摊在后面几十微秒的运行中。==
```

```callout
tone: amber
icon: 🔧
text: |
  **硬件后来打了一个补丁。**

  既然「地址空间没换就别刷 TLB」，那换个更细的问法：
  「换了地址空间，但新地址空间也有自己的条目，能不能别全刷？」

  可以。给每个地址空间发一个编号，TLB 项上带着这个编号：
  ARM 叫 **ASID**，x86 叫 **PCID**。

  打上这个补丁之后，跨进程切换时 TLB 里属于旧进程的项可以留着不清，
  只会命中不到而已。==代价是 TLB 能用到的条目变少了。==
```

另外，跨进程的两个线程之间切换，和进程切换是同一件事。它们没有共享地址空间，该做的第 4、5 步一步都不会少。

---

## 05 · 线程的三种实现

线程这个概念，可以放在用户态实现，也可以放在内核里实现。这是两套完全不同的东西。

```cards
cols: 3
items:
  - title: 用户线程
    tag: User Thread
    tone: blue
    desc: 在用户态用线程库实现，内核不知道它的存在
    body: |
      线程控制块（TCB）放在用户态线程库里。
      创建、终止、同步、调度，**全由库函数完成**，操作系统不参与。

      内核看到的只是「一个进程」。
  - title: 内核线程
    tag: Kernel Thread
    tone: violet
    desc: 由内核直接管理的线程
    body: |
      TCB 在内核里，创建、终止、调度都要通过系统调用。

      内核对每个线程一视同仁，能单独调度它。
  - title: 轻量级进程
    tag: LWP
    tone: amber
    desc: 内核支持的用户线程
    body: |
      一个进程可以有一个或多个 LWP。
      每个 LWP 和内核线程一对一映射，由内核管理和调度。

      它是「用户线程」和「内核线程」之间的桥。
```

### 两边的优缺点

```compare
first: 维度
head: [用户线程, 内核线程]
rows:
  - 谁在管: ["用户态的线程库", "操作系统内核"]
  - 切换: [{ text: 不用进内核，非常快, tone: green }, { text: 要走系统调用，慢一些, tone: amber }]
  - 一个线程阻塞了: [{ text: "整个进程都跑不了", tone: red }, { text: "其他线程照常跑", tone: green }]
  - 一个线程霸占 CPU: [{ text: "除非它主动让出，否则同进程其他线程没机会", tone: red }, "内核可以抢，按时间片轮转"]
  - 时间片算给谁: ["给进程，所以进程内的线程分到的时间片更少", "直接给线程，多线程的进程能拿到更多 CPU 时间"]
  - 能不能用多核: ["不能，内核只看到一个执行流", "能，多个内核线程可以分到不同的核上"]
```

!!用户线程最致命的缺陷是第一条。!!

```flow
grid: true
nodes:
  - { id: p,   label: "一个进程", sub: "U1 / U2 / U3 由用户态的线程库管着", row: 0, tone: violet }
  - { id: u1,  label: "用户线程 U1", sub: "发起一次读盘系统调用", row: 1, tone: green }
  - { id: u2,  label: "用户线程 U2", sub: "手头还有活要算", row: 1, tone: blue }
  - { id: u3,  label: "用户线程 U3", sub: "也有活要算", row: 1, tone: blue }
  - { id: k,   label: "内核只看到「这个进程」", sub: "它根本不知道 U2 和 U3 存在", row: 2, tone: violet }
  - { id: stop, label: "整个进程被挂起", sub: "U2 和 U3 明明能干活，也一起停了", row: 3, tone: red }
edges:
  - { from: p,  to: u1 }
  - { from: p,  to: u2 }
  - { from: p,  to: u3 }
  - { from: u1, to: k, label: "只有 U1 走进了内核", labelDx: -44 }
  - { from: k,  to: stop, label: "于是内核把整个进程挂起" }
```

看这张图：U2 和 U3 下面**一根线都没有** —— 它们压根到不了内核。所以内核做决定时，世界里只有「这个进程要等 I/O」这一件事。

### 用户线程和内核线程怎么对应

```flow
grid: true
groups:
  - { id: u, label: "用户态", tone: blue }
  - { id: k, label: "内核态", tone: violet }
nodes:
  - { id: u1, label: "U1", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: u2, label: "U2", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: u3, label: "U3", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: k1, label: "K1", sub: "内核线程", row: 1, tone: violet, group: k }
edges:
  - { from: u1, to: k1, dashed: true }
  - { from: u2, to: k1, dashed: true }
  - { from: u3, to: k1, dashed: true }
```

**多对一。** 实现最简单，不用改内核。代价是上面那条：一个线程阻塞、整个进程停摆，而且用不上多核。

```flow
grid: true
groups:
  - { id: u, label: "用户态", tone: blue }
  - { id: k, label: "内核态", tone: violet }
nodes:
  - { id: u1, label: "U1", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: u2, label: "U2", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: k1, label: "K1", sub: "内核线程", row: 1, tone: violet, group: k }
  - { id: k2, label: "K2", sub: "内核线程", row: 1, tone: violet, group: k }
edges:
  - { from: u1, to: k1 }
  - { from: u2, to: k2 }
```

**一对一。** 一个线程阻塞不影响别人，多核也能用上。代价是每个用户线程都要在内核里建一个对应的线程。创建和切换都得进内核。

```flow
grid: true
groups:
  - { id: u, label: "用户态", tone: blue }
  - { id: k, label: "内核态", tone: violet }
nodes:
  - { id: u1, label: "U1", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: u2, label: "U2", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: u3, label: "U3", sub: "用户线程", row: 0, tone: blue, group: u }
  - { id: k1, label: "K1", sub: "内核线程", row: 1, tone: violet, group: k }
  - { id: k2, label: "K2", sub: "内核线程", row: 1, tone: violet, group: k }
edges:
  - { from: u1, to: k1 }
  - { from: u2, to: k1, dashed: true }
  - { from: u3, to: k2, dashed: true }
```

**多对多。** 多个用户线程映射到多个内核线程，中间隔着 LWP。绝大部分线程调度发生在用户态（便宜），同时又能利用多核。

| 模型 | 一个线程阻塞 | 用多核 | 谁在调度 |
|---|---|---|---|
| 多对一（用户线程） | 整个进程停 | 不能 | 用户态线程库 |
| 一对一（内核线程） | 其他线程照跑 | 能 | 内核 |
| 多对多（LWP） | 其他线程照跑 | 能 | 两级：库 + 内核 |

### 共享带来的矛盾，以及怎么写代码

到这里可以回答一个更实际的问题：既然线程共享数据，两个线程同时改同一份数据会怎样？

````callout
tone: red
icon: ⚠
text: |
  **`count++` 不是一个原子操作。**

  它在机器层面是三步：

  ```
  ① 从内存读 count 到寄存器
  ② 寄存器里的值加一
  ③ 把寄存器写回内存
  ```

  两个线程各跑一遍，如果交错成「A 读 → B 读 → A 写 → B 写」，
  ==最终结果是加了一次，不是两次。==

  这就是竞态。它不会报错，只会在某个概率下算错。
````

开发者手上的工具，按「共享得越少越安全」排：

```compare
first: 做法
head: [怎么用, 代价]
rows:
  - 不共享: ["每个线程只用自己栈上的数据，线程之间不传可变状态", { text: "最安全，但很多场景做不到", tone: green }]
  - 加锁: ["临界区外面套一把互斥锁，同一时刻只让一个线程进去", "锁竞争会让并发退化成串行，用不好还会死锁"]
  - 用现成的原子操作 / 无锁结构: ["用 CPU 提供的原子指令，或语言标准库里的并发容器", "难写，出错时更难查"]
  - 把共享的边界划清: ["谁拥有哪块数据写清楚，跨线程只传副本或消息", { text: "需要设计，但换来的是可维护性", tone: green }]
```

!!真正的坑不在于「忘了加锁」，而在于「哪些数据是共享的」没想清楚。!! 一旦没想清楚，就会在某个线程里悄悄改了一个别人也在读的变量。

---

```quiz
- q: 为什么同一个进程内切换线程，比跨进程切换便宜？
  a: |
    因为两个线程共用同一张页表。切换时不用写页表基址寄存器，TLB 里的映射也继续有效，
    CPU 缓存还是热的。跨进程切换要换页表，TLB 跟着作废，
    之后每次访存都得重新填。这笔开销摊在切换之后的运行中。
- q: 用户线程最大的问题是什么？
  a: |
    内核看不见它。所以一个用户线程发起系统调用被阻塞时，内核认为「这个进程阻塞了」，
    会把整个进程挂起。同进程里其他用户线程明明能跑，也一起停了。
    另外内核只按进程给时间片、也只看到一个执行流，所以用户线程用不上多核。
- q: 每个线程为什么必须有自己的栈？
  a: |
    栈是函数调用链的载体。线程 A 正停在 read_frame() 里，返回地址和局部变量都码在栈上；
    线程 B 可能在完全不同的调用深度。共用一个栈的话，B 的调用会覆盖 A 的返回地址，
    两边都回不去。
```
