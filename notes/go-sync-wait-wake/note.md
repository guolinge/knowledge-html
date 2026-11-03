三个 goroutine 同时遇到了麻烦：一个在等 channel 里的数据，一个在等空闲名额，另一个在等 `Mutex`。它们都“等住了”，但**等的条件不同，登记的位置也不同**。

这篇要把这些问题连起来：谁负责登记等待者？谁改变条件并唤醒它？唤醒后又是谁安排它继续执行？先看使用场景，再沿着一份整体图和三个分步例子往下走。

文中的 G1、G2 等名字是为了说明过程而选的**示意场景**，不是承诺调度器一定按这个顺序运行。运行时内部实现以本机 **Go 1.26.2** 为例；语言和标准库保证的行为会单独说明，内部字段、队列和调度策略可能随版本变化。

## 01 · 三个东西，各解决什么问题？

```cards
cols: 3
items:
  - title: channel · 交接数据或通知
    tone: blue
    body: |
      一个 goroutine 发送，另一个接收。没有可接收的数据时，接收操作可能需要等待。
    code: |
      ch := make(chan int)
      value := <-ch
  - title: 信号量 · 限制同时使用的人数
    tone: violet
    body: |
      假设只有两个名额，第三个使用者要等有人归还名额。带缓冲的 channel **可以**实现这种应用层限流。
    code: |
      slots := make(chan struct{}, 2)
      slots <- struct{}{} // 占一个名额
      <-slots             // 归还一个名额
  - title: Mutex · 保护共享数据
    tone: green
    body: |
      多个 goroutine 修改同一份数据时，用 `sync.Mutex` 让受保护的代码段互斥执行。
    code: |
      mu.Lock()
      count++
      mu.Unlock()
```

这三个东西有联系，但不是同义词：channel 本身可以传值；计数信号量描述“最多同时占用多少份资源”；Mutex 主要用于互斥访问。**容量为 2 的信号量不等于互斥锁**，因为它允许两个人同时进入，不能单靠它保护两个人共同修改的普通变量。

使用缓冲 channel 只是实现应用层信号量的一种选择。下面还会看到 `golang.org/x/sync/semaphore`，以及名字相近但作用不同的 **runtime 内部信号量**。

### 先认 G、M、P

| 名称 | 这里把它理解成什么 |
|---|---|
| **G** | 一个 goroutine，以及 runtime 为它保存的状态 |
| **M** | 执行 Go 代码的操作系统线程 |
| **P** | 执行 Go 代码所需的一组运行时资源和调度许可；不是一个 CPU 核心 |

**Go runtime（运行时）**是随 Go 程序一起工作的部分，负责 goroutine 调度、内存管理等事情。一个正在执行 Go 代码的 G，通常由持有 P 的 M 执行。G 因 channel 或 `sync.Mutex` 等待而挂起后，调度器可以安排其他可运行的 G；这不保证整个程序或操作系统线程永远不会因其他原因阻塞。

## 02 · 一张图：等待队列通向同一个调度器

先认识图中的一张“登记单”：**`sudog` 是 runtime 用来记录某个 G 正在参与等待的对象**。它不是 goroutine 本身；一个 G 在 `select` 中可能同时有多张等待登记单。

```arch
svg: go-sync-map
maxScale: 1.30
caption: 从左上角的 channel 或左下角的 Mutex 进入。上面的“应用层信号量”只画出用缓冲 channel 实现限流这一种例子；虚线框按讲解路径分组，不表示对象一定在同一块内存里。
frames:
  - id: channel-path
    boundary: 0
    kind: logical
    label: channel 路径 · 限流只是一个使用例子
    detail: 计数信号量是一种用途；图中只画出用缓冲 channel 实现的一种方式。普通 channel 也可以用来传数据，等待者放在该 channel 的 sendq 或 recvq 中。
  - id: mutex-path
    boundary: 1
    kind: logical
    label: sync.Mutex 竞争路径
    detail: Go 1.26.2 的 sync.Mutex 在竞争慢路径上使用 runtime 信号量登记等待者；并不是把 channel 的等待者放进这条队列。
  - id: scheduler-path
    boundary: 2
    kind: logical
    label: 唤醒后的调度
    detail: 解除等待后，G 先变成 runnable，再由调度器安排 M 和 P 执行。对象等待队列与调度器的可运行队列承担不同职责。
bodies:
  permit:
    badge: 应用语义
    rows:
      - { k: 目的, v: 限制同时占用数 }
      - { k: 例子, v: 缓冲 chan 容量 2 }
      - { k: 拿 / 还, v: 发送 / 接收 }
    note: 也有其他实现，不等于 runtime sema
  channel:
    badge: 用户 API
    rows:
      - { k: 数据, v: 可直接交接或缓冲 }
      - { k: 等待, v: sendq / recvq }
      - { k: 内部保护, v: runtime.mutex }
    note: 发送、接收或关闭可能解除等待
  chanwait:
    badge: 等条件
    rows:
      - { k: 登记, v: sudog 指向 G }
      - { k: 存放, v: 该 channel 的等待队列 }
      - { k: 挂起, v: gopark → waiting }
    note: 匹配或关闭后从等待队列取出
  mutex:
    badge: 用户 API
    rows:
      - { k: 内部, v: state + sema 字段 }
      - { k: 无争用, v: 原子尝试获取 }
      - { k: 有争用, v: 可能自旋后等待 }
    note: 唤醒等待者不一定马上取得锁
  semawait:
    badge: 等唤醒
    rows:
      - { k: 定位, v: sema 地址 → semaRoot }
      - { k: 登记, v: sudog 指向 G }
      - { k: 挂起, v: goparkunlock }
    note: 不同 Mutex 可能映射到同一个桶
  scheduler:
    badge: Go runtime
    rows:
      - { k: goready, v: waiting → runnable }
      - { k: 就绪, v: runnext / P 队列等 }
      - { k: 调度, v: M 持有 P 后执行 G }
      - { k: 继续, v: 从等待调用处返回 }
    note: 可运行不代表已经运行
parts:
  permit:
    label: 应用层计数信号量
    sub: 控制有多少工作可以同时占用资源
    detail: 图里只示范一种写法：向容量为 2 的 channel 发送空值表示占用，接收一个值表示归还。它和 sync.Mutex 用的 runtime 信号量不是同一个对象。
    facts: { 意图: 限制并发数, 一种实现: 缓冲 channel, 另一种实现: x/sync/semaphore }
  channel:
    label: channel 对象
    sub: 可以传值，也能让收发双方等待
    detail: Go 1.26.2 的 hchan 保存可选缓冲区、发送和接收等待队列，以及一把 runtime 内部锁。直接配对、写缓冲区或等待是不同分支。
    facts: { 缓冲: 可选, 等待队列: sendq / recvq, 内部锁: runtime.mutex }
  chanwait:
    label: channel 等待队列
    sub: 还不能完成收发的 G
    detail: 普通阻塞操作把等待记录 sudog 放入对应 channel 的 sendq 或 recvq，然后通过 gopark 进入等待。匹配的对端或关闭操作会处理这些等待者。
    facts: { 队列归属: 具体 hchan, 记录: sudog → G, 挂起: gopark }
  mutex:
    label: sync.Mutex
    sub: 保护应用中的共享数据
    detail: 无争用时先尝试原子操作；有争用时可能先短暂自旋，再通过内部信号量等待。G1 是示例中的持锁者，但 sync.Mutex 不记录“只能由谁解锁”的所有权。
    facts: { 快路径: 原子比较并设置, 慢路径: 可能自旋或等待, 实现字段: state / sema }
  semawait:
    label: runtime 信号量等待队列
    sub: sync.Mutex 慢路径使用的睡眠 / 唤醒设施
    detail: Mutex 的 sema 字段地址被映射到 semaRoot；root 按地址查找等待记录。多个地址可能落在同一个 root，但不会因此变成同一把锁。
    facts: { 键: sema 地址, 登记: sudog, 唤醒入口: Semrelease }
  scheduler:
    label: 调度器
    sub: 把已解除等待的 G 安排回执行
    detail: goready 使 G 从 waiting 变为 runnable，并放到可运行队列相关位置。M 和 P 之后选择它运行；对于普通模式的 Mutex，恢复后仍可能需要竞争锁。
    facts: { 首先: waiting → runnable, 然后: 等待被选中, 执行: runnable → running }
tours:
  - id: channel-wake
    label: channel 等数据怎么醒
    steps:
      - at: [channel]
        text: 接收方执行 `<-ch`，如果没有数据或匹配的发送方，就需要等待。
      - at: [channel, chanwait]
        text: runtime 在这个 channel 的 recvq 登记 sudog，并通过 gopark 挂起接收方 G。
      - at: [chanwait, scheduler]
        text: 发送方配对后取出等待者；释放内部锁，再通过 goready 让它变为 runnable。
      - at: [scheduler]
        text: G 在可运行队列等待调度，后来由 M 和 P 执行，接收调用才继续返回。
  - id: mutex-wake
    label: Mutex 等锁怎么醒
    steps:
      - at: [mutex]
        text: G2 竞争一把已经被使用的 Mutex；如果快路径失败，它可能先短暂自旋。
      - at: [mutex, semawait]
        text: 仍拿不到时，慢路径以该 Mutex 的 sema 地址登记等待者并挂起 G2。
      - at: [semawait, scheduler]
        text: 解锁路径可能调用 Semrelease，找出等待者并让 G2 重新变为 runnable。
      - at: [scheduler]
        text: 普通模式下 G2 醒来并不等于已经拿到锁；它恢复执行后仍可能与后来者竞争。
  - id: permit-example
    label: 信号量和 channel 什么关系
    steps:
      - at: [permit, channel]
        text: 应用可以用容量为 2 的缓冲 channel 记录两个占用名额；这只是计数信号量的一种实现。
      - at: [channel, chanwait]
        text: 两个名额都占用时，第三个发送者会在这个 channel 的 sendq 等待。
      - at: [chanwait, scheduler]
        text: 有人接收并归还名额后，等待者可被唤醒；之后仍要经过调度才能继续执行。
```

图上有两类不同的队列：左侧是“**条件还不满足，谁在等**”；右侧是“**条件已允许它继续，谁可以被调度**”。它们不是同一条队列。

## 03 · 等待、可运行、运行：G 走过哪几种状态？

以下是一次典型的阻塞和恢复过程，不包含超时、取消、系统调用等所有分支：

```lane-stack
- badge: ① 运行
  title: G 正在执行
  desc: 调用 channel 接收、发送或 Mutex.Lock
  tone: blue
  nodes:
    - { title: G, sub: "_Grunning", tag: 正在执行 }
    - { title: M + P, sub: 运行当前 G, tag: 执行资源 }
  next: "条件不满足 :: :: 登记等待，再调用 gopark"
- badge: ② 等待
  title: G 暂时不能继续
  desc: 等待记录放在对应同步对象的等待结构里
  tone: amber
  nodes:
    - { title: G, sub: "_Gwaiting", tag: 不在运行队列 }
    - { title: 等待记录, sub: "sudog → G", tag: 等待条件 }
  next: "别的操作改变条件 :: :: 取出等待者并调用 goready"
- badge: ③ 可运行
  title: G 已经有资格继续
  desc: 状态变为 runnable，等待调度器选择
  tone: violet
  nodes:
    - { title: G, sub: "_Grunnable", tag: 还没执行 }
    - { title: 运行队列, sub: "runnext / P 的队列等", tag: 等 CPU }
  next: "调度器选择 G :: :: 某个 M 持有 P 执行它"
- badge: ④ 再次运行
  title: G 恢复执行
  desc: 从原来暂停的调用附近继续；是否取得锁要看具体机制
  tone: green
  nodes:
    - { title: G, sub: "_Grunning", tag: 已被调度 }
    - { title: M + P, sub: 执行 G 的代码, tag: 继续 }
```

`gopark` 和 `goready` 是 runtime 内部接口，不需要在普通业务代码中直接调用。Go 1.26.2 中，`gopark` 经过 `park_m` 把当前 G 变成 waiting；`goready` 经过 `ready` 把它变成 runnable，再交给可运行队列。

图里的 `runnext` 是 P 上一个可以优先考虑的槽位；除此之外还有 P 的本地运行队列和全局运行队列。G 最终放在哪里、什么时候运行取决于当时状态，不是“放进 runnext 就一定立即运行”。

```callout
tone: violet
icon: 💡
text: |
  ==唤醒 = 从等待变为可运行。== 调度器什么时候选中它是下一步；对于普通模式的 Mutex，即使它随后运行，也未必已经获得锁。
```

## 04 · channel：接收方没数据，谁把它叫醒？

假设 `ch := make(chan int)`，是一个**无缓冲 channel**。G接收先执行 `<-ch`，G发送稍后发送 `42`。下面只描绘一个可能的顺序，省略其他 G 和 P。

```demo
widget: stepper
title: 接收 → 排队 → 发送 → 唤醒 → 继续
hint: 点下一步，对照 channel 等待队列与可运行队列
actions: false
config:
  steps:
    - label: G接收先运行
      code: |
        当前执行：G接收 准备执行 <-ch
        channel：无缓冲，没有发送者
        recvq： [空]                 可运行队列：[G发送]
      note: |
        没有等待的发送者，接收操作暂时不能完成。G发送已经可运行，但此刻还没有执行发送。
    - label: G接收登记并挂起
      code: |
        channel.recvq： [sudog → G接收]
        G接收：waiting              可运行队列：[G发送]
        M + P：进入调度，寻找下一个 G
      note: |
        `chanrecv` 创建等待记录，放入该 channel 的 `recvq`，随后经 `gopark` 挂起。登记和释放内部锁由 runtime 协调，避免在交接期间丢失唤醒。
    - label: G发送被选中
      code: |
        channel.recvq： [sudog → G接收]
        G接收：waiting              可运行队列：[空]
        M + P：正在执行 G发送
      note: |
        G接收没有占用运行队列；示意中调度器选择 G发送，它准备执行 `ch <- 42`。
    - label: 发送并唤醒
      code: |
        G发送：发送 42，取出 recvq 的等待记录
        channel.recvq： [空]        G接收：runnable
        P 的 runnext / 运行队列：[G接收]（示意）
      note: |
        在此例中发送方把值交给接收方，释放 channel 内部锁后调用 `goready`。G接收已经可运行，但不必此刻就执行。
    - label: G接收再次运行
      code: |
        调度器选中：G接收
        M + P：执行 G接收           <-ch 返回 42
        channel.recvq： [空]
      note: |
        G接收在被安排运行后，从暂停处继续，接收表达式返回 `42`。实际调度次序和使用哪个 M / P 不作保证。
```

Go 1.26.2 的 `chanrecv` 在需要阻塞时把记录放入 `recvq`，然后调用 `gopark(chanparkcommit, ...)`。匹配的发送路径从 `recvq` 取出记录，完成数据交接，释放 channel 内部锁，再调用 `goready`。

反方向也类似：发送方不能完成时进入该 channel 的 `sendq`，匹配的接收方可以解除它的等待。`close(ch)` 也会唤醒等待者，但结果不同：等待的接收者按关闭规则返回，等待的发送者恢复后会 panic。

完整的缓冲区和发送分支可回看 [channel 的组成与三条发送路径](../chan-anatomy/)。

## 05 · Mutex：有人占着锁，等待者会去哪？

先看无争用：`Lock` 尝试用原子操作改变锁状态，成功就直接进入受保护的代码。这里的 **CAS（比较并交换）**可以理解为“只有当前值等于预期值，才把它原子地改成新值”。例如锁状态为 0 时，多个 G 同时尝试把它改成已加锁状态，只有一个能成功。

**只有争用时才可能走到等待路径**；Go 1.26.2 在合适条件下还可能先短暂自旋。自旋就是暂时占用 CPU、反复尝试获取锁，而不是立刻挂起；能否自旋以及持续多久由运行时当时的条件决定。

下面假设处于 Mutex 的**普通模式**。G1 在示例里先取得锁，G2 等待，后来 G3 也来竞争；这只是一种可能的执行顺序。

```demo
widget: stepper
title: 普通模式：被唤醒不等于已经拿到锁
hint: 点下一步，观察 Mutex、等待队列和可运行队列
actions: false
config:
  steps:
    - label: G2 遇到占用的锁
      code: |
        Mutex：已加锁（示意：G1 先取得）
        G2：正在执行 Lock()         信号量等待队列：[空]
      note: |
        G2 的快路径失败。图中说 G1 持锁是为了描述这个场景；`sync.Mutex` 本身不记录“只能由哪个 goroutine 解锁”的所有权。
    - label: G2 等待
      code: |
        Mutex：仍被使用              信号量等待队列：[sudog → G2]
        G2：waiting                 G1：可以继续工作
      note: |
        如果慢路径仍不能获得锁，G2 通过 `runtime_SemacquireMutex` 登记并挂起。实际是否先自旋取决于当时条件。
    - label: G1 解锁并唤醒 G2
      code: |
        Mutex：解锁                  信号量等待队列：[空]
        G2：runnable                可运行队列：[G2，G3]（示意）
      note: |
        解锁慢路径可以通过 `Semrelease` 唤醒一个等待者。此刻 G2 是可运行，不表示它已经执行或拿到了锁。
    - label: G3 先取得锁
      code: |
        Mutex：已加锁（本例中 G3 先取得）
        G2：runnable                等待队列：[空]
      note: |
        在普通模式下，这是允许的一种情况：后来者可能在被唤醒的 G2 真正运行并竞争前取得锁。它不是每次都会发生。
    - label: G2 再次等待
      code: |
        Mutex：G3 仍在使用           信号量等待队列：[sudog → G2]
        G2：再次 waiting
      note: |
        在这个示意分支中，G2 恢复运行后没有竞争成功，随后再次进入等待。真实过程还可能包含自旋或其他竞争结果。
    - label: G3 解锁，G2 再次就绪
      code: |
        G3：Unlock()                信号量等待队列：[空]
        G2：runnable                可运行队列：[G2]（示意）
      note: |
        释放路径再次选中 G2；它先变为 runnable，仍需等待调度器选择。
    - label: G2 运行并取得锁
      code: |
        M + P：执行 G2              G2：Lock() 成功返回
        Mutex：已加锁（本例中 G2 取得）
      note: |
        假设这次没有其他竞争者先取得锁，G2 才进入受保护的代码段。这个结局是示例，不是固定调度顺序。
```

Go 1.26.2 的 Mutex 还实现了**饥饿模式**：等待时间较长时，可能改变竞争方式并将锁交给等待者。源码中的约 1 毫秒阈值是实现细节，不是“最多等待 1 毫秒”的保证，也不是业务代码能依赖的公平性契约。

## 06 · Mutex 里的 runtime 信号量，和应用限流是什么关系？

`sync.Mutex` 在 Go 1.26.2 中包含一个内部实现，后者维护 `state` 和 `sema` 字段。`state` 记录锁及等待相关状态；`sema` 的地址用于运行时等待与唤醒。

```tree
- label: "runtime 的 semtable（全局散列表）"
  note: 输入 &m1.sema，经地址映射找到一个桶；这张表不属于 m1
  tone: blue
  children:
    - label: "semaRoot：散列表中的一个桶"
      note: Go 1.26.2 中按地址查找；不同地址可能映射到同一个桶
      children:
        - { label: "地址 &m1.sema", note: 对应该地址的等待记录，例如 sudog → G2 / G3 }
        - { label: "地址 &m2.sema", note: "示意另一个地址碰巧落在同一桶；仍是不同的等待对象" }
```

具体实现使用按地址组织的树和等待记录链表；图里的 `m1`、`m2` 和“落在同一桶”是示意。==等待者不直接排在 Mutex 对象内部；`sema` 的地址用来找到对应的 runtime 等待记录。==

`runtime/sema.go` 的注释特别强调：这组内部函数主要为其他同步原语提供**配对的睡眠与唤醒**，即使唤醒和睡眠发生竞争也要避免遗漏。它不是业务代码直接调用的公共计数信号量 API。

### 如果“唤醒”比“准备睡觉”更早到呢？

以某个 runtime 信号量的一个等待者为例，假设同一桶里没有其他等待者，简化成两种先后顺序：

```compare
first: 顺序
head: [释放先到, 等待登记先到]
rows:
  - 第一次检查:
      - 等待者发现计数暂时不可用，准备登记
      - 等待者发现计数暂时不可用，准备登记
  - 发生竞争:
      - 释放方先增加计数；此时没有已登记等待者
      - 等待者在 root 锁下登记、再次检查，随后入队并挂起
  - 如何继续:
      - 等待者在 root 锁下再次检查，发现并消费已增加的计数，不再入睡
      - 释放方看到有等待者，按地址取出它并唤醒
```

Go 1.26.2 的 `semacquire1` 会在持有 `semaRoot` 的锁时先登记 `nwait`、再检查一次计数；`semrelease1` 先增加计数，再判断和查找等待者。这样上面两种竞态都不会因为“通知太早”而无期限睡下去。真实实现还处理其他竞争、队列顺序和交接细节。

## 07 · 应用层计数信号量：用 channel 限制两个名额

下面约定：向 `slots` **发送**一个空值表示占用名额；从中**接收**一个空值表示归还。这个方向是本例的约定，也可以设计成相反方向。

```go
var slots = make(chan struct{}, 2)

func work() {
    slots <- struct{}{}         // 取得一个名额；满时等待
    defer func() { <-slots }() // work 返回时归还

    // 使用受限资源
}
```

图中的两个圆点是**逻辑上的两个占用名额**。`struct{}` 是零大小类型，不能据此推断 channel 一定分配了两个存数据的物理字节。

```demo
widget: stepper
title: 容量为 2：第三个工作者怎样等到名额？
hint: 从占满名额走到等待者恢复执行
actions: false
config:
  steps:
    - label: 两个名额已占用
      code: |
        slots 容量：2      逻辑占用：[G1 ●] [G2 ●]
        channel.sendq：[空]
        G3：准备发送一个空值来占名额
      note: |
        按本例约定，已经有两个发送完成，G1、G2 占用两个名额。G3 还没有取得名额。
    - label: G3 发送并等待
      code: |
        slots 容量：2      逻辑占用：[G1 ●] [G2 ●]
        channel.sendq：[sudog → G3]
        G3：waiting
      note: |
        缓冲 channel 已满，G3 的发送不能立刻完成；普通阻塞路径把它登记在这个 channel 的 `sendq`，然后挂起。
    - label: G1 归还，名额交给 G3
      code: |
        G1 执行 <-slots，归还名额
        逻辑占用：[G2 ●] [G3 ●]（交接后）
        channel.sendq：[空]         G3：runnable
      note: |
        Go 1.26.2 的满缓冲接收路径会取走队头元素，并把等待发送者的元素补进槽位，再唤醒 G3。因此占用数可能仍是 2；交接已由接收方完成，但 G3 的发送调用要等它被调度后才返回。
    - label: G3 被调度后开始工作
      code: |
        逻辑占用：[G2 ●] [G3 ●]   channel.sendq：[空]
        M + P：执行 G3             G3 的发送调用返回
      note: |
        G3 被调度后继续执行。等它的工作结束，`defer` 中的接收操作归还名额。真实程序要保证每次成功占用都对应一次归还。
```

### 另一种实现：`x/sync/semaphore.Weighted`

`golang.org/x/sync/semaphore` 是单独的模块，不是 Go 标准库。它提供可以一次申请多个名额、并能用 `context` 取消等待的 `Weighted`。以 **v0.18.0** 源码为例，它把几种东西组合在一起：

```tree
- label: semaphore.Weighted
  note: 一个应用层计数信号量实现，不是 runtime/sema.go 里的内部设施
  tone: violet
  children:
    - { label: size / cur, note: 总名额与当前已占用的权重 }
    - { label: mu · sync.Mutex, note: 保护计数和等待者列表的并发修改 }
    - label: waiters · 等待者列表
      note: 下面展开其中一个等待者；列表可以有多个
      children:
        - label: 一个 waiter
          children:
            - { label: n, note: 此等待者申请的名额数 }
            - { label: ready · channel, note: 条件满足后关闭，用于通知对应等待者 }
```

在这个版本中，`Acquire` 不能立即取得名额时，会登记等待者，再通过 `select` 等待其 `ready` 或传入的 `context.Done()`；后者是外部取消信号，不是 `waiter` 的字段。`Release` 更新占用数并通知可满足的等待者。这是**这个库的一种实现**，不是说所有信号量都必须由 Mutex 和 channel 实现。

## 08 · 两把容易混淆的锁，以及内存可见性

channel 内部也有一个叫 `lock` 的字段，但它的类型是 **runtime 内部的 `mutex`**，不是业务代码中的 `sync.Mutex`。它负责短暂保护 `hchan` 及相关等待记录；channel 操作因为“没数据 / 没空间”而等待，则是上面看到的登记 `sudog` 和 `gopark` 路径。

```compare
first: 对比
head: [sync.Mutex, runtime 内部 mutex]
rows:
  - 主要使用者: [应用代码和标准库, Go runtime 内部]
  - 保护什么: [调用者约定的共享数据, runtime 的内部共享结构，例如 hchan]
  - 竞争等待: [可能自旋，再通过 runtime 信号量挂起 G, 内部锁竞争时可能直接阻塞 M]
  - 可否直接当业务 API: [可以，属于标准库, 不可以，属于内部实现]
```

所以，不能简单地说“所有锁都只会挂起 G，也绝不会影响线程”。对于本篇的 channel 收发等待和 `sync.Mutex` 慢路径，G 可以通过调度器挂起；但 runtime 内部锁、系统调用等情况的线程行为不同。

同步还涉及数据可见性，不只是“谁先执行”：

- channel 的一次发送，按 Go 内存模型发生在**对应接收完成之前**。
- 对同一把 `sync.Mutex`，前面的 `Unlock` 与后续的 `Lock` 建立文档规定的同步关系。
- 信号量容量大于 1 时，多个人可以同时进入；对其中共享变量的并发读写，仍要有合适的同步。

## 09 · 本机观察：三个等待者，三种原因

用本篇的实验源码 `notes/go-sync-wait-wake/examples/waiters/main.go`，在 **Go 1.26.2、darwin/arm64** 上运行一次：一个 G 等 channel 接收，一个 G 等 Mutex，一个 G 在用 channel 取得名额时等发送。下面省略了函数参数地址；goroutine 编号和顺序每次可能不同。

```text
main.waitChannel
  goroutine 22 [chan receive]

main.waitMutex
  goroutine 23 [sync.Mutex.Lock]
  internal/sync.runtime_SemacquireMutex
  internal/sync.(*Mutex).lockSlow

main.waitPermit
  goroutine 24 [chan send]

改变条件后：channel、mutex、permit 三个等待者都继续完成
```

同一次运行的 runtime trace 中，三个 G 都出现了下面的状态变化：

```compare
first: 示例中的 G
head: [从运行进入等待, 唤醒与恢复]
rows:
  - G22 · 等待 channel 数据:
      - 'Running → Waiting，原因 chan receive'
      - 'Waiting → Runnable → Running'
  - G23 · 等待 Mutex:
      - 'Running → Waiting，trace 原因 sync'
      - 'Waiting → Runnable → Running'
  - G24 · 等待 channel 名额:
      - 'Running → Waiting，原因 chan send'
      - 'Waiting → Runnable → Running'
```

这只是一次实验，不代表 G 的编号、队列位置或谁先运行总是如此。要在本仓库复现并保存一份新的临时 trace：

```bash
go run ./notes/go-sync-wait-wake/examples/waiters/main.go -trace

# 把下面的路径换成上一条命令输出的 trace 路径
go tool trace -d=parsed /实际输出的临时文件.trace
```

Go 1.26.2 的 `go tool trace` 调试模式使用 `-d=parsed`；不同 Go 版本的工具参数可能不同。需要可视化查看时，也可以对那份文件运行 `go tool trace <路径>`。

## 10 · 遇到问题时，先问哪一层？

```compare
first: 现象或疑问
head: [先检查什么, 不要直接推断什么]
rows:
  - channel 发送或接收一直不返回:
      - 是否有匹配方、缓冲区是否满或空、channel 是否为 nil、退出和取消路径
      - 所有 goroutine 都在占用 CPU
  - Mutex 等待很久:
      - 持锁代码是否做了慢操作，是否存在高竞争；结合 mutex / block profile 和 trace
      - 每个等待者醒来都会按 FIFO 取得锁
  - 信号量限流卡住:
      - 成功取得的名额是否都能归还，取消时是否会退出等待
      - channel 缓冲区只要非空就一定有 goroutine 在执行
  - 已经收到唤醒:
      - G 是否只是 runnable，是否仍在等待被调度或重新竞争锁
      - 唤醒等于立刻运行、等于 Mutex 已经拿到手
```

排查时可以结合 goroutine 栈、block profile、mutex profile 和 `go tool trace`；这些工具观察的是具体运行情况，采集方式和开销各不相同。不要只根据一次快照判断所有 goroutine 的完整生命周期。

```summary
title: 把三条线收回来
text: |
  channel 负责交接数据；应用层信号量负责表达可用名额；`sync.Mutex` 负责互斥。它们的等待条件和登记位置不同：channel 等待者属于 channel，Mutex 慢路径等待者通过 runtime 信号量按地址登记。

  ==共同的后半段是：解除等待 → G 变为 runnable → 调度器选择 → G 继续执行。==
```

## 自测

```quiz
- q: channel 的 recvq、Mutex 的 runtime 信号量等待结构和 P 的运行队列是同一条队列吗？
  a: |
    不是。前两者记录还在等条件的 G；P 的运行队列用于保存可运行的 G。条件满足并唤醒后，G 才会进入调度器的可运行状态。
- q: 被 Mutex 唤醒的 G 是不是一定马上运行，并且已经拿到锁？
  a: |
    不是。唤醒首先让 G 变成 runnable；之后才由调度器选择。在 Go 1.26.2 的普通模式下，恢复后仍可能与后来者竞争。饥饿模式有不同的交接策略。
- q: 容量为 2 的 channel 已满，第三个发送者正在等待。有人接收后，为什么占用数可能仍是 2？
  a: |
    在 Go 1.26.2 的满缓冲接收路径中，runtime 可以把队头元素交给接收方，同时把等待发送者的元素补到槽位，再唤醒发送者。接收方已完成交接，但被唤醒的 G 还要等待调度，发送调用才会返回。
- q: 为什么 runtime 信号量的唤醒即使先于等待登记，也不会简单地丢失？
  a: |
    释放方先增加计数；等待方登记后在 root 锁下再次检查计数。如果释放先发生，等待方可以消费已有计数而不入睡；如果等待登记先完成，释放方可以找到并唤醒等待者。
- q: channel 或 sync.Mutex 让一个 G 等待，是不是说明所有情况下操作系统线程都不会阻塞？
  a: |
    不是。它们的典型 goroutine 等待路径可以通过 gopark 让 G 挂起，M 和 P 可调度其他 G；但 runtime 内部锁、系统调用等其他情况可能阻塞线程。
```
