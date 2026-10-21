```text
应用层      任务队列 · 连接池 · 业务锁
   ↓ 调用
库层        mutex · 读写锁 · 条件变量 · 信号量
   ↓ 抢不到时
内核层      futex · 等待队列 · 睡眠 · 唤醒 · 调度
   ↓ 依赖
硬件层      CAS · 原子加减 · 内存屏障 · 缓存一致性
```

这张清单大体是对的，只有一处要挪：**futex 不属于硬件层**。它是 Linux 的一个系统调用，坐在「硬件之上、库之下」—— 硬件提供原子性，内核提供睡眠和唤醒，库把两者包成 `mutex` 这样的接口。

一句话概括四层各自卖什么：

| 层 | 提供什么 | 不提供什么 |
|---|---|---|
| 应用 | 保护什么、锁粒度多大、几个原语怎么组合 | 不提供原子性，也不提供睡眠 |
| 库 | `lock()/unlock()` 的语义、阻塞、公平性策略 | 不自己造原子性，靠下面两层 |
| 内核 | 睡眠、唤醒、调度（futex 就是这套能力的入口） | 不管锁状态，也不判断谁能拿到锁 |
| 硬件 | 原子性（CAS / 原子加减）、可见性（屏障） | 不认识「锁」，不会排队，不会让线程睡 |

这篇按「一层怎么长出下一层」走：先看硬件能给什么，再看只用硬件会缺什么，然后看内核补上什么、库怎么包、应用怎么用，最后把一次加锁的完整配合串起来。

## 01 · 四层地图：谁调用谁，谁在什么时候出现

```arch
svg: lock-layers
caption: 从上往下读：应用调库，库在抢不到时才把地址交给内核，内核让线程睡；快路径那条线从库直接下到硬件，跳过内核。
frames:
  - id: app
    boundary: 0
    kind: classification
    label: 应用层 · 你要保护的东西
    detail: 这一层关心的是「哪段代码要互斥」「锁粒度多大」，不关心锁怎么实现。
  - id: lib
    boundary: 1
    kind: classification
    label: 语言 / 库层 · 你调用的接口
    detail: 这一层决定语义：互斥、acquire/release、可重入、超时、公平性。它自己用原子指令和 futex 拼出这些语义。
  - id: kern
    boundary: 2
    kind: classification
    label: 内核层 · 只有睡和醒才进来
    detail: 内核只做两件事：把线程挂起、把它放回就绪队列。它不知道「锁」是什么，只知道「这个地址上有人在等」。
  - id: hw
    boundary: 3
    kind: classification
    label: 硬件层 · 原子性与可见性
    detail: 原子指令保证读改写不被打断，缓存一致性保证一行只有一个主人，屏障保证顺序。
bodies:
  queue:
    badge: 应用
    rows:
      - { k: 临界区, v: 队列的头尾指针 }
      - { k: 常用组合, v: mutex + 条件变量 }
    note: 空队列时消费者要等，所以光有 mutex 不够
  pool:
    badge: 应用
    rows:
      - { k: 临界区, v: 空闲连接表 }
      - { k: 常用组合, v: 信号量，或 mutex + 条件变量 }
    note: 连接是有限资源，计数天然适合信号量
  mutex:
    badge: 库
    rows:
      - { k: 状态字, v: 32 位：0 空闲 / 1 占用 / 2 有等待者 }
      - { k: 快路径, v: 用户态 CAS，不进内核 }
      - { k: 慢路径, v: 抢不到就 futex_wait }
      - { k: 语义, v: 加锁 acquire，解锁 release }
    note: 它把「原子性 + 睡眠」包成一个接口
  cond:
    badge: 库
    rows:
      - { k: 等什么, v: 一个谓词（比如「队列非空」） }
      - { k: 内部, v: 一个 futex 字 + 一条等待队列 }
      - { k: 规矩, v: 必须和 mutex 配对使用 }
    note: 条件变量不存状态，谓词要自己用 mutex 保护
  sem:
    badge: 库
    rows:
      - { k: 状态, v: 一个非负计数 }
      - { k: 计数为 0, v: 和条件变量一样，最终落到 futex }
    note: 计数在用户态减，减不动才进内核
  futex:
    badge: 内核
    rows:
      - { k: 是什么, v: 一个系统调用 + 每个地址一条等待队列 }
      - { k: 管什么, v: 睡（WAIT）和醒（WAKE） }
      - { k: 不管什么, v: 锁状态、谁能拿锁、公平性 }
    note: 内核在无竞争时完全不知道这个地址存在
  sched:
    badge: 内核
    rows:
      - { k: 何时出场, v: 线程真的要睡，或者被叫醒 }
      - { k: 代价, v: 一次唤醒 + 调度，实测 ~1.8 µs }
    note: 这一步比用户态原子操作贵两个数量级
  atomic:
    badge: 硬件
    rows:
      - { k: 有什么, v: CAS / xchg / 原子加 }
      - { k: 保证什么, v: 读改写三步之间插不进别人 }
      - { k: 实测, v: 一次原子加一 2.2 ns }
    note: 这是「互斥」在机器上的唯一来源
  cache:
    badge: 硬件
    rows:
      - { k: 单位, v: 本机 128 字节一行 }
      - { k: 写的前提, v: 拿到这一行的独占 }
      - { k: 换手, v: 整行在两个核之间搬 }
    note: 锁的争用，本质是这一行在核之间来回搬
  barrier:
    badge: 硬件
    rows:
      - { k: 保证, v: 前面的写发布之后，后面的读才执行 }
      - { k: 不保证, v: 不刷缓存，只等写缓冲和失效队列排空 }
    note: 细节见「锁为什么慢」那篇
parts:
  queue:
    label: 任务队列
    sub: 最典型的「锁 + 条件变量」
    detail: 生产者加锁放任务、通知；消费者加锁取任务，没活儿就 wait。==wait 会原子地放锁并睡下==，醒来后再把锁拿回来。
  mutex:
    label: mutex
    sub: 库层的核心抽象
    detail: 它只保证三件事：同一时刻一个持有者、进出有 acquire/release 语义、抢不到会阻塞。可重入、超时、优先级继承都是在这一层加的。
  cond:
    label: 条件变量
    sub: 等谓词，不等锁
    detail: 它自己不记状态。判断「队列空不空」必须拿着 mutex 做，否则会出现「判断完、睡下之前，条件已经成立」的窗口。
  sem:
    label: 信号量
    sub: 一个会阻塞的计数器
    detail: P 操作（减一）减不动就睡，V 操作（加一）加完唤醒一个。它和 mutex 的区别是允许多个持有者。
  futex:
    label: futex
    sub: 内核提供的睡眠入口
    detail: 它只认一个 32 位字和它的地址。==用户态告诉内核「这个地址上有人在等」，内核负责让他们睡和醒==。
  atomic:
    label: 原子指令
    sub: 互斥的物理基础
    detail: 一条 CAS 就能把「读、比较、写」变成不可分割的一步。没有它，用户态根本没法实现互斥。
tours:
  - id: fast
    label: 无竞争：一路到底，不进内核
    steps:
      - { at: [queue, mutex], text: "任务队列调 `lock()`。这时没有别人抢，库层只需要一条原子指令。" }
      - { at: [mutex, atomic, cache], text: "CAS 把状态字从 0 改成 1，==全程用户态==；内核完全不知道这把锁存在。" }
      - { at: [futex, sched], text: "这条路径上，内核层两个零件一次都没被调用。" }
  - id: slow
    label: 有竞争：把地址交给内核
    steps:
      - { at: [mutex, futex], text: "CAS 失败了。库层不再空转，把状态字地址交给内核，说「这个地址上有人在等」。" }
      - { at: [futex, sched], text: "内核把线程挂进等待队列，调度器换别人上核。==这一刻 CPU 才真正被让出来==。" }
      - { at: [queue], text: "等持锁的人解锁并唤醒，线程回到就绪队列，再从 CAS 重试。" }
```

四条边里最值得记住的是 `mutex → atomic` 那条：==它绕过了整个内核层==。无竞争时锁的成本几乎只有硬件那 2 纳秒级的原子操作加一点库的开销，这也是「锁其实很快」这个说法的来源。

## 02 · 硬件层：它只卖三样东西

硬件不认识「锁」。它能提供的只有三样，而这三样刚好够拼出互斥：

1. **原子读改写**：CAS、xchg、原子加减。保证「读、改、写」三步之间别的核插不进来。实测一次原子加一 **2.2 ns**。
2. **缓存行与一致性**：写之前要先拿到这一行的独占，别的核的副本作废。一行只有一个主人，这是「同一时刻只有一个线程改」的物理基础。
3. **内存屏障**：保证前面的写真的发布出去，后面的读不会提前。

第三样最容易误解，展开在 [锁为什么慢：写缓冲、失效队列和内存屏障](../lock-memory-barriers/) 里。这里只留一句：屏障不是刷缓存，是等写缓冲和失效队列排空。

硬件**不提供**的东西同样重要：

- 它不会排队。两个线程同时 CAS，谁赢是硬件仲裁的结果，没有先来后到。
- 它不会让线程睡。抢不到只能继续占着 CPU 自旋。
- 它不知道「锁」这个概念。锁是软件在这一层之上造出来的约定。

## 03 · 只用硬件：能拼出自旋锁，但有两个硬伤

先证明硬件确实够用。下面这把锁只用了 C11 原子操作，没有任何系统调用：

```c
#include <stdatomic.h>

typedef struct { _Atomic int word; } spinlock_t;   // 0 空闲，1 占用

static void spin_lock(spinlock_t *l) {
    // exchange 返回旧值：旧值是 0 说明我抢到了
    while (atomic_exchange_explicit(&l->word, 1, memory_order_acquire)) {
        // 抢不到：原地打转，等对方放锁
        while (atomic_load_explicit(&l->word, memory_order_relaxed)) {
            // 这里可以插一条 pause / yield 指令，减少总线压力
        }
    }
}

static void spin_unlock(spinlock_t *l) {
    atomic_store_explicit(&l->word, 0, memory_order_release);
}
```

它能工作，但有两个硬伤：

- **抢不到就烧 CPU。** 线程没有「让出」的能力，只能一直问「好了吗」。
- **没有排队。** 谁手快谁赢，饥饿是可能的；优先级低的线程拿着锁时，高优先级线程也只能干等（优先级反转）。

第一个硬伤可以量。4 个线程、每次临界区约 2 ms、同样的总工作量：

| 实现 | 墙钟时间 | CPU 时间 | CPU / 墙钟 |
|---|---|---|---|
| `pthread_mutex` | 181.8 ms | 181.4 ms | **1.00** |
| 自旋锁 | 186.0 ms | 465.0 ms | **2.50** |

墙钟几乎一样，但自旋版多烧了 1.5 倍的 CPU —— 那些时间全花在「转着圈问」上。==临界区越长、线程越多，这个比例越难看。==

要让线程在等的时候真的把 CPU 交出去，就需要一种用户态没有的能力：**把一条正在运行的线程从 CPU 上摘下来，之后再放回去**。这就是内核存在的理由。

## 04 · 内核补上的那块：睡眠、唤醒、调度

内核能做三件用户态做不到的事：

| 能力 | 为什么用户态做不到 |
|---|---|
| 把线程挂起 | 线程的运行状态由内核维护，用户态改不了 |
| 按地址维护等待队列 | 队列在内核里，用户态没有权限操作别人的调度状态 |
| 把睡着的线程放回就绪队列 | 需要调度器参与，还要处理优先级、CPU 亲和性 |

但内核**不应该**接管整把锁。如果每次加锁都进内核，无竞争这个最常见的情况就要付一次系统调用的钱。实测本机一次最便宜的系统调用（`getpid()`）**约 134 ns**，已经是一把无竞争锁（~9 ns）的 15 倍。

于是 Linux 的设计是：**内核只提供「睡」和「醒」两个动作，锁的策略全部留在用户态。**

这套机制叫 futex（Fast Userspace Mutex）。它的关键设计只有一句话：

> ==状态字在用户态，内核只按地址管等待队列。==

无竞争时，用户态原子指令直接改状态字，内核连这个地址存在都不知道；只有抢不到、准备睡时，才把地址交给内核。futex 手册的原话是：这个 32 位字「把用户态的同步和内核的阻塞实现连了起来」。

## 05 · futex 的两个动作，和那个救命的 expected

系统调用的样子（通常由 C 库包一层，你平时不会直接写）：

```c
long futex(uint32_t *uaddr, int op, uint32_t val,
           const struct timespec *timeout, uint32_t *uaddr2, uint32_t val3);
```

- `FUTEX_WAIT`：**如果这个地址还是我以为的值，就让我睡。**
- `FUTEX_WAKE`：**把这个地址上等着的线程，最多叫醒 N 个。**

参数拆开看：

| 参数 | 大白话 | 细节 |
|---|---|---|
| `uaddr` | 指向那个 32 位状态字 | 必须 4 字节对齐；线程间放全局变量，进程间要放共享内存 |
| `op` | 要干什么 | `FUTEX_WAIT` / `FUTEX_WAKE`；带 `_PRIVATE` 表示只在本进程内用，内核可以少做点事 |
| `val` | WAIT 时是「期望值」，WAKE 时是「最多叫醒几个」 | WAIT：值不等于 `val` 就立刻返回 `EAGAIN`，不睡；WAKE：常用 `1` 或 `INT_MAX` |
| `timeout` | 最多睡多久 | 相对时间（毫秒级精度）；传 `NULL` 表示一直睡 |
| `uaddr2` / `val3` | 给 requeue 这类高级操作用的 | 普通的 wait / wake 用不到 |

返回值也要看清楚：

- `FUTEX_WAIT` 返回 0，只说明「我被叫醒了」，**不代表条件成立** —— 手册明确说可能是伪唤醒，所以必须回到循环里重新检查。
- `FUTEX_WAKE` 返回实际叫醒了几个；返回 0 说明队列里没人。

### 为什么 WAIT 必须带 expected

这是 futex 最关键的一步。假设没有这个检查：

1. 线程 B 读锁字，发现是 1（有人占着），决定睡；
2. 就在 B 真正睡下去之前，线程 A 解锁，把锁字改成 0，然后 `FUTEX_WAKE`；
3. 但 B 还没进队列，这次唤醒没找到人，返回 0；
4. B 这才睡下去 —— 而锁已经空了，没有人会再来叫它。

```seq
grid: true
participants:
  - { id: b, label: 线程 B, sub: "想拿锁" }
  - { id: k, label: 内核 futex, sub: "按地址的等待队列", kind: security }
  - { id: a, label: 线程 A, sub: "持锁者" }
messages:
  - { from: b, to: b, label: "读锁字 = 1", kind: self, note: ① }
  - { from: b, to: b, label: "决定睡（还没进内核）", kind: self, note: ② }
  - { from: a, to: a, label: "写锁字 = 0", kind: self, note: ③ }
  - { from: a, to: k, label: "FUTEX_WAKE(1)", kind: sync, note: ④ }
  - { from: k, to: a, label: "队列空，返回 0", kind: reply, note: ⑤ }
  - { from: b, to: k, label: "FUTEX_WAIT(addr, 1)", kind: sync, note: ⑥ }
  - { from: k, to: b, label: "值已是 0，立刻 EAGAIN", kind: reply, note: ⑦ }
  - { from: b, to: b, label: "没睡成，回去重试 CAS", kind: self, note: ⑧ }
```

第 ⑥ 步就是 `expected` 起作用的地方：内核在把 B 挂进队列之前，会**原子地**做「读值 → 和 1 比较 → 决定睡不睡」。因为 A 已经把值改成 0，比较失败，B 直接拿到 `EAGAIN` 返回，不会睡死。手册把这个参数的目的写得很直接：==防止丢唤醒==。

## 06 · 库层：把「原子 + 睡眠」包成一个接口

到了 `mutex` 这一层，程序员看到的是契约，不是机制。POSIX 对 `pthread_mutex_lock` 的约定是：

- 锁已经被别的线程持有，调用线程**必须阻塞**，直到锁可用；
- 返回时，调用线程成为持有者；
- 类型决定重入行为：普通锁重复加锁会死锁，`ERRORCHECK` 返回错误，`RECURSIVE` 计数加一；
- 还有 robust（持有者死掉时返回 `EOWNERDEAD`）、优先级继承这些变体。

这些语义 futex 一个都不提供。==futex 只会睡和醒，是库把它们组织成「锁」。==

一个典型实现只要三样东西：一个 32 位状态字、一条快路径、一条慢路径。状态字常写成三种值：

| 值 | 含义 | 谁会看到 |
|---|---|---|
| 0 | 空闲 | 下一个来抢的人 |
| 1 | 已占用，没人等 | 持锁者自己 |
| 2 | 已占用，**有人在等** | 解锁的人：看到 2 才知道要 `FUTEX_WAKE` |

第三种值是个优化：如果解锁时看到的是 1（没人等），就完全不用进内核。futex 手册也提到解锁路径「可以进一步优化以避免不必要的唤醒」。

把三条路径写在一起，就是 `mutex` 的全部骨架：

```c
// futex_wait / futex_wake 就是 §05 那两个系统调用的包装
// 状态字：0 空闲，1 占用，2 占用且有等待者
static void mutex_lock(_Atomic int *w) {
    int expected = 0;
    // ① 快路径：一次 CAS 0 → 1
    if (atomic_compare_exchange_strong_explicit(w, &expected, 1,
            memory_order_acquire, memory_order_relaxed))
        return;

    // ② 慢路径：抢不到，标记「有人在等」，然后睡
    do {
        if (atomic_exchange_explicit(w, 2, memory_order_acquire) == 0)
            return;                       // 刚好在这期间被放开了
        futex_wait(w, 2);                 // 值仍是 2 才睡；不是就立刻回来
    } while (atomic_exchange_explicit(w, 2, memory_order_acquire) != 0);
}

static void mutex_unlock(_Atomic int *w) {
    // ③ 解锁：如果有人在等（值 2），改回 0 并唤醒一个
    if (atomic_exchange_explicit(w, 0, memory_order_release) == 2)
        futex_wake(w, 1);
}
```

三行注释对应三条路径：快路径不进内核，慢路径睡，解锁路径按需唤醒。C++ 的 `std::mutex`、Java 的 `synchronized`（HotSpot 的 monitor）、Rust 的 `Mutex` 在各自的运行时里都是这个形状，差别在状态字怎么编码、自旋多久、是否支持优先级继承。

## 07 · 应用层：四种常见组合

库层给了积木，应用层负责选组合：

| 要保护的东西 | 典型组合 | 关键点 |
|---|---|---|
| 任务队列 | `mutex` + 条件变量 | 消费者要等「非空」，光有 mutex 会忙等 |
| 连接池 | 信号量，或 `mutex` + 条件变量 | 连接数是计数，减到 0 就等 |
| 读写锁 | 一个状态字 + 两条等待队列 | 读多写少才有意义；写者可能饿死 |
| 业务锁（按 key） | 分段锁 / 锁表 | 锁粒度决定并发度，粒度太粗等于没分 |

一个容易忽略的点：**条件变量等的是谓词，不是锁。** 「队列非空」这个判断必须和 `wait` 在同一个互斥区间里完成，否则又会出现「判断完、睡下之前，条件已经成立」的窗口 —— 这和 §05 那个丢唤醒是同一个坑，只是发生在库层。

## 08 · 全链路：一次有竞争的加锁，四个角色怎么配合

把前面的零件按时间顺序摆开，就是一次完整的「程序 / 库 / 内核 / 硬件」配合：

```seq
grid: true
participants:
  - { id: a, label: 线程 A, sub: "先拿到锁" }
  - { id: lib, label: mutex（库）, sub: "状态字 + futex", kind: backend }
  - { id: k, label: 内核, sub: "等待队列 + 调度器", kind: security }
  - { id: b, label: 线程 B, sub: "抢不到的那个" }
messages:
  - { from: a, to: lib, label: "lock()", kind: sync, note: ① }
  - { from: lib, to: a, label: "CAS 0→1 成功", kind: reply, note: ② }
  - { from: a, to: a, label: "临界区", kind: self, note: ③ }
  - { from: b, to: lib, label: "lock()", kind: sync, note: ④ }
  - { from: lib, to: lib, label: "CAS 失败，自旋", kind: self, note: ⑤ }
  - { from: lib, to: k, label: "FUTEX_WAIT(addr, 2)", kind: sync, note: ⑥ }
  - { from: k, to: b, label: "挂进队列，调度走", kind: reply, note: ⑦ }
  - { from: a, to: lib, label: "unlock()", kind: sync, note: ⑧ }
  - { from: lib, to: k, label: "FUTEX_WAKE(1)", kind: sync, note: ⑨ }
  - { from: k, to: b, label: "放回就绪队列", kind: reply, note: ⑩ }
  - { from: b, to: lib, label: "醒来，重试 CAS", kind: sync, note: ⑪ }
  - { from: lib, to: b, label: "成功，进入临界区", kind: reply, note: ⑫ }
```

逐段看角色分工：

- **程序（线程 A / B）**：只调 `lock()` / `unlock()`，不知道下面发生了什么。
- **库（mutex）**：决定什么时候用原子指令（②）、什么时候自旋（⑤）、什么时候交给内核（⑥）、什么时候唤醒（⑨）。
- **内核**：只做两件事 —— 把 B 挂起（⑦）、把 B 放回就绪队列（⑩）。它从头到尾不知道「锁」是什么。
- **硬件**：提供 ② 里那条 CAS 的原子性，以及 ② / ⑧ 两条边界上的顺序保证（acquire / release）。

第 ⑪ 步值得单独说：==被唤醒不等于拿到锁==。可能是别人先抢到了，也可能是伪唤醒，所以醒来必须回到 `while` 里重新检查 —— 这也是 §05 里 `EAGAIN` 和伪唤醒那两个细节的用途。

## 09 · 为什么不能只用一层

| 方案 | 会缺什么 | 依据 / 例子 |
|---|---|---|
| 只用 CAS（自旋） | 抢不到就烧 CPU，没有排队 | 同样工作量，CPU 时间 1.00× → 2.50× |
| 每次加锁都进内核 | 无竞争也要付系统调用 | 一次 `getpid()` ~134 ns，是无竞争锁（~9 ns）的 15 倍 |
| 只给 futex、不给库 | 没有互斥语义、没有 acquire/release、没有可重入 / 超时 / 优先级继承 | 这些全是库层的约定，内核不提供 |
| 只给 mutex、不给应用层选择 | 锁粒度和组合方式决定成败，接口替代不了设计 | 分段锁 / 读写锁 / 条件变量各有适用场景 |

这张表也解释了题面那个疑问：**futex 和 mutex 不在同一层，因为它们是两种不同的东西** —— futex 是「让你睡」的机制，mutex 是「保证互斥」的语义。把 futex 归到硬件层会漏掉内核；把 mutex 归到内核层会把语义当成机制。

最后，分层不是绝对的，几种常见的例外：

- **自旋锁**：只碰硬件，一次系统调用都不进。适合临界区只有几条指令的场景。
- **读写锁 / 条件变量 / 信号量**：在 Linux 上通常共用 futex，但各自维护不同的状态字和等待队列。
- **Java 的 `synchronized`**：历史上分了偏向锁、轻量级锁、重量级锁几级；JDK 15 起偏向锁默认关闭（JEP 374），理由之一是现代 CPU 上那条 CAS 已经很便宜，维护偏向锁不划算。
- **Go 的 `sync.Mutex`**：在自旋和排队之间做了折中，竞争久了会切到「饥饿模式」，把锁直接交给等待最久的 goroutine。
- **跨机器的「锁」**：没有共享内存，也没有 futex，只能靠租约、超时和一致性协议 —— 那是另一套分层。

```summary
title: 一句话总结
text: |
  硬件给原子性，内核给睡眠与唤醒，库把两者包成 mutex 的语义，应用层决定锁的粒度与组合。
  ==无竞争时这条链只走「库 → 硬件」；有竞争时才往下走到内核。==
```

```quiz
- q: futex 为什么不算硬件层？它到底提供了什么？
  a: |
    硬件只提供原子指令和缓存一致性，不会让线程睡。futex 是 Linux 的系统调用，
    负责「按地址把线程挂起、再唤醒」，属于内核层。
    它不管锁状态，也不决定谁能拿到锁 —— 那些是库层的事。
- q: FUTEX_WAIT 里的 expected 参数，少了会出什么问题？
  a: |
    会丢唤醒：线程检查到锁被占用、准备睡，但还没真睡下去时，持锁者解锁并发出唤醒，
    这次唤醒找不到人；线程随后睡死，锁却空着。
    expected 让内核在挂起前原子地比较值：值已经变了就返回 EAGAIN，不睡，回去重试。
- q: 为什么被 FUTEX_WAKE 叫醒之后还要再抢一次锁？
  a: |
    WAKE 只是把线程放回就绪队列，不把锁交给它。它可能被别人抢先，
    也可能遇到伪唤醒，所以必须回到 while 循环里重新 CAS，直到成功。
- q: 只用 CAS 写自旋锁，代价具体体现在哪？
  a: |
    抢不到的线程会一直占着 CPU 空转。实测：4 线程、每次临界区约 2ms 时，
    mutex 的 CPU/墙钟 = 1.00，自旋锁 = 2.50 —— 墙钟差不多，但多烧了一倍半的 CPU。
```
