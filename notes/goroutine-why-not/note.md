## 01 · 两种并发模型

最朴素的方案是「一个任务一条线程」。它简单到不需要解释，但和「多路复用」放在一起看，差别立刻出来：

```compare
first: 维度
head: [1:1（一个任务一条线程）, M:N（任务交给用户态调度器）]
rows:
  - 任务和线程的关系: ["一一对应，开一个任务就开一条线程", "本来就是两条队伍，任务先排进队列"]
  - 谁决定「下一个跑谁」: [{ text: "内核调度器", tone: violet }, { text: "用户态调度器 —— 整套逻辑在你自己的进程里", tone: green }]
  - 每条任务占多少栈: ["每条都要预留（pthread 默认 8MB）", "2KB 起步，用到才长"]
  - 线程数上限: [{ text: "被栈预留和内核成本卡死", tone: red }, "跟任务数无关，约等于核数"]
```

把 M:N 这条链一路画到硬件上，就是下面这张。==注意它是一条完整的通路：任务在哪儿排队、谁在挑、挑完交给谁、最后落在哪个核上。==

```flow
grid: true
groups:
  - { id: q,   label: "① 任务先在这一排格子里排队", tone: green }
  - { id: m,   label: "③ 内核线程 —— 同一时刻只有这几条在外面", tone: blue }
  - { id: hw,  label: "④ 硬件：三个核占满，一个从头到尾空着", tone: muted }
nodes:
  - { id: t1, label: T1, sub: "", row: 0, tone: green, group: q }
  - { id: t2, label: T2, sub: "", row: 0, tone: green, group: q }
  - { id: t3, label: T3, sub: "", row: 0, tone: green, group: q }
  - { id: t4, label: T4, sub: "", row: 0, tone: green, group: q }
  - { id: t5, label: T5, sub: "", row: 0, tone: green, group: q }
  - { id: t6, label: T6, sub: "", row: 0, tone: green, group: q }
  - { id: sch, label: 用户态调度器, sub: "② 在自己进程里挑下一个，不惊动内核", row: 1, tone: green }
  - { id: m1, label: M1, sub: "正跑着某个 T", row: 2, tone: blue, group: m }
  - { id: m2, label: M2, sub: "正跑着某个 T", row: 2, tone: blue, group: m }
  - { id: m3, label: M3, sub: "正跑着某个 T", row: 2, tone: blue, group: m }
  - { id: c1, label: 核 0, sub: "满的", row: 3, tone: green, group: hw }
  - { id: c2, label: 核 1, sub: "满的", row: 3, tone: green, group: hw }
  - { id: c3, label: 核 2, sub: "满的", row: 3, tone: green, group: hw }
  - { id: c4, label: 核 3, sub: "从头到尾空着", row: 3, tone: muted, group: hw }
edges:
  - { from: t1, to: sch }
  - { from: t2, to: sch }
  - { from: t3, to: sch }
  - { from: t4, to: sch }
  - { from: t5, to: sch }
  - { from: t6, to: sch }
  - { from: sch, to: m1 }
  - { from: sch, to: m2 }
  - { from: sch, to: m3 }
  - { from: m1, to: c1 }
  - { from: m2, to: c2 }
  - { from: m3, to: c3 }
```

顺着这张图讲一遍就是整个模型：

> 六个任务排在队列里（**T1..T6**）→ 用户态调度器一次取一个，不惊动内核 →
> 同一时刻只放 **3 个**在外面，交给 3 条真线程 → 3 条线程各自占住一个核 →
> **第 4 个核从头到尾没被用上**。

最后那句就是这套模型的问题所在，也是后面要讲的：线程数约等于核数是**理想情况**；
真正的麻烦是其中一条线程一旦阻塞在系统调用上，它占着的核就空转了 ——
==而用户态调度器管不了这件事，因为阻塞发生在它看不见的那一层。==

````callout
tone: amber
icon: 🔍
text: |
  **顺带看一眼 1:1 在这张图上会长什么样。**

  同样 6 个任务，1:1 会开出 **6 条线程**去抢 **4 个核**。
  核还是那 4 个，但队伍变成两排：

  ```
  任务  T1 T2 T3 T4 T5 T6
  线程  M1 M2 M3 M4 M5 M6      ← 六条真实线程，每条占着 8MB 栈预留
  核    [核0][核1][核2][核3]    ← 同一时刻只有 4 条能真的在跑
         ↑ M1~M4 在跑，M5 M6 在队列里等内核调度
  ```

  多出来的那两条线程不是「更并发」，是**在等核**。
  任务数一大，等核的线程就排成长龙，光是它们之间的上下文切换就把收益吃光了。
````

1:1 的好处很实在：每个任务的逻辑是一条线性同步代码，阻塞就阻塞，线程替你挂起；内核视角也最简单。它曾经是主流 —— Apache 每个连接一个 worker，JVM servlet 每个请求一个线程。衰败从 C10K 开始。

把 1:1 往规模上推，会**按顺序**撞上三重天花板：

```lane-stack
- badge: 天花板一
  title: 栈预留封顶数量
  desc: 最硬性，最先撞上
  tone: red
  nodes:
    - { title: 每线程固定预留, sub: "Linux 8MiB / JVM 1MB", tag: 创建时定死 }
    - { title: 不能中途搬家, sub: "内核不会帮你扩栈", tag: 只能按最坏情况留 }
    - { title: 结果, sub: "32 位约 1500 条；JVM 实测 1.15 万条 OOM", tag: 想开十万先问内存 }
  next: "内存缓解不了 :: :: 下一重天花板随负载显现"
- badge: 天花板二
  title: 切换成本随任务数放大
  desc: 其次，负载一上来就显现
  tone: amber
  nodes:
    - { title: 直接成本, sub: "微秒级，单次不痛" }
    - { title: 间接成本, sub: "缓存与 TLB 污染，乘以任务数" }
    - { title: 一笔账, sub: "单核每秒的切换预算只养得起约十万线程", tag: 还没算干活时间 }
  next: "前两重还能靠硬件缓解 :: :: 第三重不行"
- badge: 天花板三
  title: 内核看不懂等待语义
  desc: 最隐蔽，规模够大才成为主要矛盾
  tone: violet
  nodes:
    - { title: 内核只认两个状态, sub: "可运行 / 阻塞", tag: 没有第三种 }
    - { title: 但等待有四种, sub: "等 channel、等定时器、等业务结果、等网络" }
    - { title: 于是只能干等, sub: "调度器无法择优唤醒", tag: 要靠换调度者解决 }
```

第三重是真正把需求逼出来的那一重。前两重可以靠「更多内存、更快切换」缓解，第三重要求**换一个更懂业务的调度者** —— 而这正是 Go 后来做的事。

同一个需求在别处出现过 —— 而且解法长得几乎一样：

```compare
first: 层次
head: ["HTTP/1.1 → HTTP/2", "线程 → Goroutine"]
rows:
  - 承载单位: ["每个请求独占一条 TCP 连接", "每个任务独占一条线程"]
  - 上限卡在哪: ["连接数上限 + 队头阻塞", "栈预留 + 切换成本"]
  - 解法: ["多个逻辑 stream 复用到少量连接上", "多个 G 复用到少量 M 上"]
  - 逻辑单元: ["stream 有独立的流控与生命周期", "G 有独立的栈与三态"]
  - 承载单元: [{ text: "TCP 连接只有几条", tone: green }, { text: "M 只有核数那么多", tone: green }]
```

---

## 02 · 前人两条路线，各栽在哪

用户态调度不是 Go 首创。Java 1.1 有 green threads，Solaris 和 FreeBSD 都有 M:N 线程库。先看它们怎么死的。

```timeline
- when: SunOS 5.2
  title: Solaris 开始做 M:N
  desc: 把用户线程多路复用到少量内核线程上，当时的「正确答案」
  tone: blue
- when: Solaris 9 · 2002
  title: Solaris 放弃 M:N
  desc: 退回 1:1，十几年试验结束
  tone: red
- when: FreeBSD 5 · 2003
  title: FreeBSD 也做 M:N
  desc: 换了个系统，同一个方向又来一遍
  tone: blue
- when: FreeBSD 7 · 2008
  title: 默认回到 1:1
  desc: 一年后彻底移除 M:N
  tone: red
```

两个系统、十几年、同一个结论。死法只有一条主线：

```flow
grid: true
groups:
  - { id: kt, label: "三个用户线程骑在同一个内核线程 K1 上", tone: red }
nodes:
  - { id: u1, label: "U1", sub: "发起一次磁盘 read", row: 0, tone: blue, group: kt }
  - { id: kern, label: "内核把 K1 整个挂起", sub: "执行权被内核收走了", row: 1, tone: red, group: kt }
  - { id: u2, label: "U2", sub: "本来能跑", row: 2, tone: muted, group: kt }
  - { id: u3, label: "U3", sub: "本来能跑", row: 2, tone: muted, group: kt }
  - { id: dead, label: "U2 / U3 全部连坐", sub: "用户态调度器想救都救不了", row: 3, tone: red, group: kt }
edges:
  - { from: u1, to: kern, label: "一个阻塞" }
  - { from: u2, to: dead, label: "骑在同一根线程上" }
  - { from: u3, to: dead, label: "" }
```

一句话总结这件事：**M:N 线程是操作系统支持不足的产物，核心问题是系统调用会阻塞。**

补救方向本来是「给每个易阻塞的调用配一个专属内核线程」—— 可补着补着，就退化成 1:1 了。

第二条现代路线不救阻塞，而是**消灭「阻塞的线程」**：

```journey
- tag: 起点
  tone: blue
  name: 一个普通的同步函数
  badge: 一个颜色
  fields:
    - { k: 写起来, v: "顺序、直观、好读" }
    - { k: 问题, v: "它内部要发网络请求" }
  note: 编译器把 async 函数切成状态机，每个 await 是一个断点
  next: "想拿异步结果 :: :: 调用链开始变色"
- tag: 传染
  tone: red
  name: 颜色沿调用链往上爬
  badge: 两种颜色
  fields:
    - { k: helper, v: "自己也得改成 async" }
    - { k: 上层, v: "一路传染到入口" }
    - { k: 断不开, v: "同步代码无法直接调用异步函数" }
  noteTone: bad
  note: 「这段代码会不会让出线程」变成了编译期可见的契约，中间层必须站队
- tag: 代价
  tone: amber
  name: 语法糖解决不了
  badge: 契约问题
  fields:
    - { k: 好处, v: "线程永不睡眠，调度权在 runtime 手里" }
    - { k: 代价, v: "函数签名里多了不可消除的信息" }
  note: 两条路线只是把「异步的难」放在了不同位置
```

```compare
first: 路线
head: [阻塞怎么处理, 谁在调度, API 侵入性]
rows:
  - 旧式 M:N 线程: [{ text: "连坐：一个阻塞全船停", tone: red }, "用户态库，但被内核架空", "无（同步外观）"]
  - async / await: ["消灭阻塞：状态机 + 非阻塞 I/O", "runtime 的事件循环", { text: "高：颜色侵入函数签名", tone: red }]
  - Goroutine: [{ text: "分流：能异步的走 netpoller，真阻塞换 M", tone: green }, "Go runtime（用户态）", { text: "无（同步外观）", tone: green }]
```

---

## 03 · Go 的第三条路

Go 回到了 green thread，但把当年的死穴逐个补上：

Go 的两条修复路径是分开的两张图 —— 它们要解决的根本不是同一件事。

```flow
grid: true
groups:
  - { id: p1, label: "路径一 · 网络 I/O：等待移交给 netpoller", tone: green }
nodes:
  - { id: g1, label: "G1 等待网络数据", sub: "注册 epoll，然后被挂起", row: 0, tone: green, group: p1 }
  - { id: m1, label: "M 没睡", sub: "转头继续跑 G3、G4", row: 1, tone: green, group: p1 }
  - { id: ok, label: "连坐没有发生的机会", sub: "P 一直有 M 在跑 Go 代码", row: 2, tone: green, group: p1 }
edges:
  - { from: g1, to: m1, label: "挂起的只是 G" }
  - { from: m1, to: ok, label: "" }
```

```flow
grid: true
groups:
  - { id: p2, label: "路径二 · 真阻塞系统调用：换一个 M 顶上", tone: amber }
nodes:
  - { id: g2, label: "G2 进入文件 read", sub: "没有 poll 接口可用", row: 0, tone: amber, group: p2 }
  - { id: m2, label: "M1 陪 G2 沉进内核", sub: "先把 P 解绑交出去", row: 1, tone: amber, group: p2 }
  - { id: m3, label: "M2 接管 P", sub: "继续跑 G5，没受影响", row: 2, tone: green, group: p2 }
  - { id: back, label: "read 返回后 M1 变备用", sub: "P 早已还回来了", row: 3, tone: muted, group: p2 }
edges:
  - { from: g2, to: m2, label: "解绑 P" }
  - { from: m2, to: m3, label: "P 交给别人" }
  - { from: m3, to: back, label: "" }
```

同一个 `conn.Read`，在两种语言里的样子差别就在这：

```go
// Go：同步外观。conn.Read 可能真的阻塞 —— 但阻塞的是 G，不是 M
func handle(conn net.Conn) {
    data, err := conn.Read(buf)   // 底层走 netpoller；M 转头去跑别的 G
    if err != nil {
        return
    }
    conn.Write(process(data))
}
```

```javascript
// JS：显式异步。每多一个 await，签名就多一个 async，颜色一路传上去
async function handle(conn) {
  const data = await conn.read();   // 状态机断点
  await conn.write(process(data));
}
```

==Go 的代码没有颜色，但「读完之后再写」的顺序感完整保留。== 哪种更好没有标准答案 —— 这是两条路线，不是「goroutine 完胜 async」。

---

```quiz
- q: 旧式 M:N 线程的死穴到底是什么？
  a: |
    多个用户线程骑在同一个内核线程上，只要其中一个进入阻塞系统调用，
    整个内核线程被内核挂起，骑在它身上的其他人全部连坐。
    用户态调度器救不了，因为执行权已经被内核整个收走了。
    补救办法是给每个易阻塞的调用配专属内核线程 —— 补着补着就退化成 1:1 了。
- q: async/await 的「函数颜色」问题为什么语法糖解决不了？
  a: |
    因为颜色不是语法问题，是契约问题。它把「这段代码会不会让出线程」
    变成了编译期可见的信息，于是函数的签名里多了一样东西。
    同步代码一旦要调用异步函数，自己也得变异步，颜色只能沿调用链往上传染。
    Go 回避这件事的方式是让阻塞留在同步外观里，把复杂度收进 runtime。
- q: 三重天花板是按什么顺序撞上的？
  a: |
    内存最硬性，最先到（栈预留把线程数锁死）；
    切换成本其次，随负载显现（直接成本加缓存还债，再乘任务数）；
    语义盲区最隐蔽，规模大到一定程度才成为主要矛盾。
    前两重可以靠更多内存和更快切换缓解，第三重要求换一个更懂业务的调度者。
```
