## 01 · 为什么不是一条大队列

最省脑子的实现是：所有可运行 G 放一条全局队列，任何 M 都从这里取。它会挨两刀，刀刀致命。

```flow
grid: true
groups:
  - { id: bad, label: "一条全局队列 + 一把锁", tone: red }
nodes:
  - { id: m1, label: "M1", sub: "要取 G", row: 0, tone: blue, group: bad }
  - { id: m2, label: "M2", sub: "也要取 G", row: 0, tone: blue, group: bad }
  - { id: m3, label: "M3 … 都要取 G", sub: "M 越多，锁越烫", row: 0, tone: blue, group: bad }
  - { id: grq, label: "全局队列 GRQ", sub: "所有人抢同一把锁", row: 1, tone: red, group: bad }
  - { id: k1, label: "第一刀：锁竞争", sub: "取 G 这件事本身成了瓶颈", row: 2, tone: red, group: bad }
  - { id: k2, label: "第二刀：缓存失配", sub: "G 上次在核 0 跑，这次被核 7 取走", row: 3, tone: red, group: bad }
edges:
  - { from: m1, to: grq, label: "一起抢锁" }
  - { from: m2, to: grq, label: "" }
  - { from: m3, to: grq, label: "" }
  - { from: grq, to: k1, label: "M 一多就显现" }
  - { from: k1, to: k2, label: "工作集刚被逐出，又要在新核重建" }
```

这两刀都有历史证据：**Go 1.1 之前真的只有一条全局队列**，当时的调度 trace 里锁竞争一望便知。今天的 per-P 本地队列就是那个教训的产物。

改进来自内核自己的教科书 —— 学 per-CPU 运行队列：

```flow
grid: true
groups:
  - { id: good, label: "每个 P 一条本地队列：平时只碰自己那份", tone: green }
nodes:
  - { id: p0, label: "P0", sub: "M0 绑定", row: 0, tone: green, group: good }
  - { id: q0, label: "LRQ: G1 G2 G3", sub: "无锁或低竞争", row: 1, tone: blue, group: good }
  - { id: p1, label: "P1", sub: "M1 绑定", row: 2, tone: green, group: good }
  - { id: q1, label: "LRQ: G8 G9", sub: "同样无锁", row: 3, tone: blue, group: good }
  - { id: grq2, label: "GRQ 降级为兜底队列", sub: "只在本地空了的时候才看", row: 4, tone: muted, group: good }
edges:
  - { from: p0, to: q0, label: "各吃各的" }
  - { from: p1, to: q1, label: "各吃各的" }
  - { from: q1, to: grq2, label: "本地空了才回头找全局", dashed: true }
```

但局部性会带来新毛病：**负载不均**。任务长短不一，新 G 又都由 `go` 语句创建在本地 P —— 一个扇出型任务会把一百个新 G 全灌进创建者的队列，别的 P 却空转。

```callout
tone: violet
icon: ⚖️
text: |
  ==负载不均不需要极端场景。==

  一个扇出任务在新 G 落进本地队列的那一刻，不均衡就已经注定了。

  所以在多核上，**工作窃取不是锦上添花的优化，而是这套设计的常态机制。**
```

```flow
grid: true
groups:
  - { id: steal, label: "空闲的 P 主动去偷 —— 一次拿走一半", tone: amber }
nodes:
  - { id: p1, label: "P1 的 LRQ", sub: "G1 G2 G3 G4 G5 G6", row: 0, tone: blue, group: steal }
  - { id: p2, label: "P2 的 LRQ: 空", sub: "M2 先原地自旋一小会儿", row: 1, tone: muted, group: steal }
  - { id: half, label: "偷走 G4 G5 G6", sub: "只偷一半", row: 2, tone: green, group: steal }
  - { id: why, label: "为什么偷一半", sub: "摊薄「动别人队列」的同步成本，也避免为一个小任务反复上门", row: 3, tone: violet, group: steal }
edges:
  - { from: p1, to: p2, label: "P2 空转" }
  - { from: p2, to: half, label: "盯上最长的那个" }
  - { from: half, to: why, label: "" }
```

干这事的 M 在源码里叫 **spinning M**：它先原地自旋一小会儿，实在没活才去睡 —— 因为「马上可能有活」的概率很高。它自旋时不是盲转，同时盯着其他 P 的队列和 netpoller。

---

## 02 · 取下一个 G 的顺序

```flow
grid: true
groups:
  - { id: order, label: "一个 M 要取材时，按这个顺序找下去", tone: violet }
nodes:
  - { id: rn, label: "runnext", sub: "单槽缓存：刚刚让出的那个 G", row: 0, tone: amber, group: order }
  - { id: lrq, label: "本 P 的 LRQ", sub: "本地优先：无锁 + 缓存友好", row: 1, tone: green, group: order }
  - { id: grq, label: "全局队列 GRQ", sub: "每 61 次取 G 才查一次", row: 2, tone: violet, group: order }
  - { id: th, label: "偷其他 P 的 LRQ", sub: "拿一半", row: 3, tone: amber, group: order }
  - { id: np, label: "netpoller", sub: "都没有了，看网络事件唤醒了谁", row: 4, tone: blue, group: order }
edges:
  - { from: rn, to: lrq, label: "没有就往下" }
  - { from: lrq, to: grq, label: "本地空了" }
  - { from: grq, to: th, label: "兜底也没拿到" }
  - { from: th, to: np, label: "还是没有，才去问网络" }
```

**runnext 值得单独说一句。** 它放的是「刚刚变得可运行的那个 G」—— 比如刚从一次短阻塞里醒来。调度器优先取它，是因为==这个 G 最可能马上要接着跑，它的数据还热在缓存里==。优先取它，等于白捡一次局部性。

**1/61 这个比例也有它的道理。** 局部性与公平性是对头：LRQ 偏袒局部性，GRQ 维护公平性。定期抽查一次全局队列，既防止 GRQ 里的 G 被饿死，又不让 GRQ 成为常态竞争点。

换个熟悉的锚点：==这和 git 的对象访问同构 —— 平时只看本地对象库，隔一段时间 fetch 一次 origin，1/61 就是那个「定期 fetch」的节流阀。==

```callout
tone: amber
icon: 🔧
text: |
  **这个顺序和 1/61 都是 runtime 实现细节，随时可变。**

  业务代码不应依赖它们。理解它的价值在于知道「平衡点在哪」——
  而不是把它当成一份稳定的 API 契约。
```

---

## 03 · 正在跑的 G 不撒手怎么办

队列决定「取谁」，抢占解决「上一个赖着不走」。先纠正一句过时的话：**「Go 调度器是协作式的」对 Go 1.14 之后的紧循环已经不成立。**

```flow
grid: true
groups:
  - { id: coop, label: "协作抢占（Go 1.2 起）：给栈守卫下毒", tone: blue }
nodes:
  - { id: sm, label: "sysmon", sub: "后台监控线程，发现某 G 跑超 10ms", row: 0, tone: violet, group: coop }
  - { id: poison, label: "把 stackguard0 改成毒值", sub: "stackPreempt", row: 1, tone: red, group: coop }
  - { id: prologue, label: "等 G 走到下一次函数序言", sub: "序言本来就要检查栈边界", row: 2, tone: blue, group: coop }
  - { id: yield, label: "触发 morestack，发现守卫被下毒", sub: "当作它自己调了 Gosched，让出 P", row: 3, tone: green, group: coop }
edges:
  - { from: sm, to: poison, label: "下单" }
  - { from: poison, to: prologue, label: "毒就这样等在那" }
  - { from: prologue, to: yield, label: "搭了个便车" }
```

妙处是**零额外成本**：栈检查本来就要做，抢占只是搭便车。

```compare
first: 为什么不能任意点切换
head: [说明]
rows:
  - 栈可能正在搬迁: ["上一节说的连续栈扩容，拷贝到一半把 G 换下去，指针修正就乱套了"]
  - GC 可能正在扫描栈找指针: ["扫到一半换人，GC 的记录和实际栈就对不上了"]
  - 所以需要「安全点」: [{ text: "安全点就是「这些不变量都不处于中途」的代码位置", tone: green }]
```

但协作抢占有一个死穴，而且非常致命：

```flow
grid: true
groups:
  - { id: bug, label: "没有函数调用的紧循环，毒值永远没人查收", tone: red }
nodes:
  - { id: loop, label: "for { i++ }", sub: "一个函数调用都没有", row: 0, tone: red, group: bug }
  - { id: nope, label: "没有序言可查", sub: "毒值躺在守卫里，没人看", row: 1, tone: red, group: bug }
  - { id: starve, label: "P 被占死", sub: "其他 G 饿死，GC 的 STW 也拖不动", row: 2, tone: red, group: bug }
edges:
  - { from: loop, to: nope, label: "" }
  - { from: nope, to: starve, label: "Go 1.14 之前就是这样" }
```

Go 1.14 官方发布说明承认了这件事：紧循环「可能饿死调度器或严重拖延 GC」。

于是有了异步抢占：

```flow
grid: true
groups:
  - { id: async, label: "异步抢占（Go 1.14 起）：直接发信号打断", tone: green }
nodes:
  - { id: sig, label: "sysmon 发 SIGURG", sub: "选它正因为它是「无事发生」型信号", row: 0, tone: violet, group: async }
  - { id: hdl, label: "信号处理器确认在异步安全点", sub: "不在 runtime 关键段里", row: 1, tone: blue, group: async }
  - { id: pc, label: "把 PC 改成 asyncPreempt 入口", sub: "一段汇编：保存全部用户寄存器", row: 2, tone: amber, group: async }
  - { id: done, label: "转入 gopreempt_m，让出 P", sub: "紧循环不再可能饿死调度器", row: 3, tone: green, group: async }
edges:
  - { from: sig, to: hdl, label: "打断" }
  - { from: hdl, to: pc, label: "确认安全" }
  - { from: pc, to: done, label: "接管" }
```

```timeline
- when: Go 1.2 · 2013
  title: 协作抢占
  desc: 靠函数序言里的栈边界检查搭便车。成本几乎为零，但紧循环会饿死 GC
  tone: blue
- when: Go 1.14 · 2020
  title: 异步抢占兜底
  desc: 用 SIGURG 打断任意用户态代码点。紧循环饿死成为历史，代价是每次打断要保存全套寄存器
  tone: green
```

```compare
first: 维度
head: [协作抢占, 异步抢占]
rows:
  - 触发: ["G 自己跑到安全点", "runtime 发 SIGURG 打断"]
  - 时机: ["函数序言、同步操作处", "任意用户态代码点（异步安全点）"]
  - 代价: [{ text: "几乎为零（搭栈检查的便车）", tone: green }, { text: "每次打断要保存全部寄存器", tone: amber }]
  - 边界: [{ text: "紧循环永不触发", tone: red }, "runtime 关键段与信号处理中不可打断"]
```

!!副作用要知道：Unix 下信号会打断慢速系统调用，使它们更常以 EINTR 失败。!!

标准库的多数调用已经按契约自动重试了，但自己写 raw syscall 或包装 C 库时，要保留「错误是 EINTR 就重试」的循环。

所以今天准确的定性是：**协作为主、异步抢占兜底**。正常代码在安全点自己让出（便宜），长期不合作者被信号打断（兜底）。

```callout
tone: violet
icon: 🎲
text: |
  **这也解释了一个观感：Go 的调度「看起来像抢占式、行为不可预测」。**

  因为决策权在 runtime 手里，不在开发者手里 ——
  ==你永远不知道 G 会在哪两条语句之间被换下去。==

  sysmon 除了抢占，还负责：把 GRQ 里的 G 灌给空闲 P、唤醒休眠的 M、
  驱动 netpoll、回收空闲资源。它是调度器里唯一「不管业务」的角色。
```

---

```quiz
- q: 为什么每个 P 要有一条自己的本地队列，而不是共用一条全局队列？
  a: |
    因为共用一条会挨两刀：一是锁竞争（每个 M 每次取 G 都要抢同一把锁，M 越多越烫），
    二是缓存局部性差（G 上次在核 0 跑，下次被核 7 取走，工作集刚被逐出又要重建）。
    本地队列让 M 平时只碰自己那份，无锁且缓存友好。代价是负载不均，于是有了工作窃取。
- q: 工作窃取为什么偷一半，而不是偷一个？
  a: |
    偷一个的话，每次本地队列空了都要上门一次，而「动别人队列」本身有同步成本 ——
    为一个小任务反复上门不划算。一次拿一半把这份同步成本摊薄了，
    同时也让被偷的 P 还能剩下一些活干。
- q: Go 1.14 之前，一个 `for { i++ }` 为什么能把调度器饿死？
  a: |
    因为协作抢占只在安全点生效，而安全点之一是函数序言里的栈边界检查。
    紧循环里没有任何函数调用，也就没有序言 ——
    sysmon 把 stackguard0 改成毒值后，那个毒值永远没人查收，P 被占死，
    其他 G 饿死，GC 的 STW 也拖不动。
    Go 1.14 起改用 SIGURG 直接打断，这个问题才消失。
```
