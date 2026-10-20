## 01 · 一任务一线程，会依次撞上三堵墙

最朴素的并发模型是「一个任务一条线程」：

```java
// 每个连接一条线程，handler 里可以放心阻塞
while (true) {
    Socket conn = server.accept();
    new Thread(() -> handle(conn)).start();
}
```

它简单到不需要解释：线程替你挂起，代码是线性的，内核负责调度。C10K 之前，Apache 的 prefork（一连接一进程）和 JVM 的 servlet 容器（一请求一线程）都是这个思路。问题不在「一次处理一个请求」，在把这条路线推到规模上时，会按顺序撞上三堵墙。

```lane-stack
- badge: 第一堵
  title: 栈在创建时定死
  desc: 最先撞上，和负载无关
  tone: red
  nodes:
    - { title: 每条线程一份栈, sub: "Linux 常见 8 MiB，macOS pthread 默认 524 KiB" }
    - { title: 不能中途搬家, sub: "内核不知道栈里哪一格是指针，没法修" }
    - { title: 只能按最坏情况预留, sub: "1 万条就是 80 GiB 虚拟地址空间；32 位进程一两千条就到顶" }
  next: "内存能缓解一部分 :: :: 下一堵随负载出现"
- badge: 第二堵
  title: 切换成本随任务数放大
  desc: 有活了才显现
  tone: amber
  nodes:
    - { title: 直接成本, sub: "进出内核 + 保存恢复现场，微秒级" }
    - { title: 间接成本, sub: "缓存和 TLB 要换成另一条线程的工作集" }
    - { title: 总账, sub: "切换次数 × 任务数；单次不痛，规模上很痛" }
  next: "硬件更快能缓解 :: :: 第三堵不行"
- badge: 第三堵
  title: 内核看不懂「在等什么」
  desc: 最隐蔽，也最致命
  tone: violet
  nodes:
    - { title: 内核只有两种状态, sub: "可运行 / 阻塞" }
    - { title: 但等待有很多种, sub: "等 channel、等锁、等定时器、等下游返回" }
    - { title: 于是无法择优唤醒, sub: "谁先醒、醒了先跑谁，内核没有这份信息" }
```

前两堵墙可以靠更多内存、更快的 CPU 缓解。第三堵墙要求换一个调度者：一个知道「这条流在等什么」的调度器。这正是用户态调度的动机，也是 Go 后来做的事。

## 02 · 旧 M:N：一个阻塞，全船停

用户态调度不是 Go 的首创。Solaris 在 1992 年就有 M:N 线程，FreeBSD 5 的 KSE 也是这个模型：N 条用户线程复用到 M 条内核线程上，用户态库决定哪条用户线程跑。

想法是对的，死法很具体：

```flow
grid: true
groups:
  - { id: kse, label: "三条用户线程骑在同一条内核线程 K1 上", tone: red }
nodes:
  - { id: u1, label: "U1", sub: "发起一次磁盘 read", row: 0, tone: red, group: kse }
  - { id: k1, label: "K1 被内核整个挂起", sub: "执行权被内核收走", row: 1, tone: red, group: kse }
  - { id: u2, label: "U2", sub: "本来可以跑", row: 2, tone: muted, group: kse }
  - { id: u3, label: "U3", sub: "本来可以跑", row: 2, tone: muted, group: kse }
  - { id: dead, label: "U2、U3 一起停", sub: "用户态调度器想救也救不了", row: 3, tone: red, group: kse }
edges:
  - { from: u1, to: k1, label: "一个阻塞" }
  - { from: u2, to: dead, label: "骑在同一条线程上" }
  - { from: u3, to: dead }
```

关键在最后一步：内核挂起的是 K1，不是 U1。用户态调度器这时也在 K1 上，它没有机会运行，自然没法把 U2、U3 搬到别的内核线程上。

补救办法是「给每个可能阻塞的调用配一条专属内核线程」。可这样补下去，每条用户线程最终都要一条内核线程，就退化成了 1:1。两个系统都在同一个地方掉头：

```timeline
- when: 1992
  title: Solaris 引入 M:N
  desc: 用户线程复用到少量内核线程上，当时看起来是正确方向
  tone: blue
- when: 2002
  title: Solaris 回到 1:1
  desc: M:N 变成可选，默认模型改回一条用户线程对一条内核线程
  tone: red
- when: 2008
  title: FreeBSD 7.0 换成 1:1
  desc: KSE 的 M:N 实现被 1:1 的 libthr 取代，成为默认
  tone: red
```

一句话总结这次失败：==用户态调度器可以决定「谁跑」，但决定不了「谁醒」。== 阻塞发生在它看不见的那一层，它连补救的机会都没有。

## 03 · async/await：把「别阻塞」写进函数签名

第二条路线换了个方向：不救阻塞，而是要求代码永远不要阻塞。

```javascript
// 同步函数：内部不能 await
function parse(row) {
  return JSON.parse(row);          // 纯计算，没问题
}

// 一旦内部要等 I/O，就得变成 async
async function loadUser(id) {
  const row = await db.get(id);    // 断点：这里让出执行权
  return parse(row);
}

// 调用方也得是 async，颜色一路往上染
async function handle(req, res) {
  const user = await loadUser(req.params.id);
  res.json(user);
}
```

`await` 在编译后是一台状态机：函数被切成几段，每段之间保存局部变量，`await` 处登记一个回调，然后返回。等到 Promise 完成，再从断点恢复。执行流还是那条执行流，只是它不再对应一条线程 —— 事件循环在多个任务之间切换。

这套模型能扛住很多连接，代价写在类型里：

```compare
first: 维度
head: [async/await 的做法, 带来的约束]
rows:
  - 谁能调用谁: ["async 可以调同步；同步不能直接调 async", { text: "要拿到结果就得自己变 async，把 Promise 继续往上传", tone: red }]
  - 函数签名: ["返回 Promise<T>，而不是 T", "接口、回调、中间件都被迫跟着改"]
  - 阻塞调用: ["任何一次同步阻塞都会冻住整个事件循环", "数据库驱动、文件读写、加密库都要提供异步版本"]
  - 生态: ["同步库和异步库分成两套", "选型时先看它有没有 async 版本"]
```

这不是语法问题，是契约问题。「这段代码会不会让出线程」变成了编译期可见的信息，函数被分成两种颜色，颜色沿着调用链传染。Bob Nystrom 在 2015 年把这个现象写成《What Color is Your Function?》，它到今天还是理解 async/await 成本的最好入口。

## 04 · Go 的第三条路：不消灭阻塞，分流

Go 既没有要求你写 `await`，也没有让每条 G 独占一条线程。它做的是把「等」分成两类，分别处理：

```compare
first: 等待的类型
head: [谁来接管, 线程会怎样]
rows:
  - 网络 I/O（socket、pipe）: ["netpoller（epoll / kqueue）", { text: "G 被挂起，M 回去跑别的 G", tone: green }]
  - 不能 poll 的 I/O（普通文件、部分 cgo）: ["只能真的阻塞", { text: "一条 M 陪着睡，P 交给别的 M", tone: amber }]
```

这套分流有一个前提：runtime 必须能看见每一次可能阻塞的调用。Go 能做到，是因为标准库的 I/O 路径和 runtime 是一起设计的 —— `net` 包知道自己要注册 netpoller，`os` 包知道普通文件注册不上，`syscall` 包知道什么时候该进 `_Gsyscall`。

四条路线放在一起：

```compare
first: 路线
head: [承载单位, 阻塞怎么处理, API 侵入, 主要代价]
rows:
  - 1:1 线程: ["一条线程一个任务", "线程自己睡", "无", { text: "栈预留 + 切换成本封顶", tone: red }]
  - 旧 M:N: ["N 条用户线程 / M 条内核线程", { text: "一个阻塞，整条内核线程连坐", tone: red }, "无（同步外观）", "需要内核配合，补到最后退化成 1:1"]
  - async/await: ["事件循环 + 状态机", "代码里不能阻塞", { text: "高：函数被染色", tone: red }, "同步库要重写一套"]
  - Go: ["G / M / P，G 由 runtime 调度", { text: "能 poll 的交给 netpoller，不能的换 M", tone: green }, { text: "无：代码是同步外观", tone: green }, "不能 poll 的 I/O 仍然要一条 M 陪着"]
```

Go 的代价不是零：文件 I/O 密集时，线程数会随并发读增长（第 ⑤ 篇实测 64 条 G → 66 条线程）。它换到的是：代码里没有颜色，写阻塞式代码不会冻住整个进程。

## 05 · 为什么这一次能成

把旧 M:N 和 Go 放在一起，差别不在「调度算法更聪明」，而在三个前提：

1. **I/O 层在 runtime 手里。** 网络 fd 能注册进 netpoller，等待被事件机制接管；旧式线程库只能包裹既有系统调用，改不了等待方式。
2. **栈能增长。** 每条任务 2 KiB 起步，不需要按最坏情况预留；旧式用户线程仍然要给每条线程一份固定栈，规模上限没有消失。
3. **语言和 runtime 一起设计。** `go` 语句、channel、`conn.Read` 的同步外观，让 runtime 能在每一次可能阻塞的地方接手；async/await 把这件事推给了类型系统，旧 M:N 推给了库。

三个前提缺一个，结果就会退化成前面某条路线。这也是为什么「自己实现一个用户态调度器」很难成功：调度算法不是难点，接管等待才是。

## quiz

```quiz
- q: 旧 M:N 线程为什么「一个阻塞全船停」？
  a: |
    多条用户线程复用在一条内核线程上。其中一条进入阻塞系统调用后，
    内核挂起的是整条内核线程，用户态调度器也在这条线程上，没机会运行，
    所以搬不动另外两条。补救办法是给每个可能阻塞的调用配专属内核线程，
    补到最后就退化成 1:1。
- q: async/await 的「函数颜色」为什么不能靠语法糖解决？
  a: |
    因为颜色不是语法问题，是契约问题：它把「这段代码会不会让出线程」
    写进了函数签名。同步函数调用 async 函数时，要么自己变 async，
    要么阻塞事件循环。颜色只能沿着调用链传染，编译器没法替你消除。
- q: Go 为什么不需要给函数染色？
  a: |
    因为 Go 允许代码保持同步外观，把「等」的处理收进 runtime：
    能 poll 的 fd 交给 netpoller，G 挂起、M 继续；
    不能 poll 的才真的阻塞一条 M，并把 P 交给别人。
    前提是标准库 I/O 和 runtime 一起设计，runtime 能看见每一次等待。
- q: 三条路线各自的主要代价是什么？
  a: |
    1:1 线程：栈预留和切换成本把并发数量封顶；
    旧 M:N：内核挂起整条线程，用户态调度器救不了；
    async/await：函数被染色，同步库要重写，任何阻塞都会冻住事件循环。
    Go 的代价是：不能 poll 的 I/O 仍然要一条 M 陪着。
```
