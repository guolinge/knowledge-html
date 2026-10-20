## 01 · 三个看起来合理、实际会出事的写法

先看三种在代码评审里很容易被放过的写法。

**第一种：给每个小任务开一条 G。**

```go
for _, job := range jobs {   // jobs 有 20 万个元素
    go compute(job)          // CPU 密集，每个任务算 5ms
}
```

算力由核数决定，G 只决定有多少条执行流来分这块算力。二十万条 G 抢八个核，多出来的时间花在切换和缓存来回上，总吞吐反而下降。这类问题的信号是：CPU 打满、G 数很高、单任务延迟变长。

**第二种：在 handler 里做文件 I/O。**

```go
func handle(w http.ResponseWriter, r *http.Request) {
    data, _ := os.ReadFile("/data/report.csv")   // 普通文件，不能 poll
    w.Write(data)
}
```

第 ⑤ 篇量过：64 条 G 同时读不可 poll 的裸 socket，进程多出 61 条线程。QPS 一高，线程数跟着涨，内核调度压力和内存都上来。信号是 `schedtrace` 里 `threads` 远大于 `gomaxprocs`。

**第三种：父流程早退，子 G 还在发结果。**

```go
func fetchAll(ids []int) ([]Result, error) {
    ch := make(chan Result)          // 无缓冲
    for _, id := range ids {
        go func(id int) { ch <- query(id) }(id)
    }
    for range ids {
        r := <-ch
        if r.Err != nil {
            return nil, r.Err       // 直接返回，剩下的发送者永远等不到接收者
        }
    }
    return nil, nil
}
```

每命中一次错误，就漏掉 `len(ids)-1` 条 G。信号是 G 数单调上涨，`pprof` 里能看到一堆停在 `chan send` 的栈。

## 02 · 泄漏：什么叫「永远」等不到

官方定义很严格：一个 G 被阻塞，而且解除阻塞所需的条件**永远**不可能满足，才算泄漏。等得久不算，等得到就不算。

Go 1.27 把泄漏检测做进了标准库：`runtime/pprof` 多了一个 `goroutineleak` profile，HTTP 端点是 `/debug/pprof/goroutineleak`。它的判定方式写在发布说明里：

> 如果 G 阻塞在并发原语 P 上，而 P 从任何可运行的 G（以及它们能唤醒的 G）都不可达，那么 P 不可能被解除阻塞，G 也就永远醒不过来。运行时用 GC 的可达性来判断。

这个定义也说明了它的边界：从全局变量、或者从可运行 G 的局部变量能到达的阻塞原语，检测不到。它不是万能的，但能抓住一大类。

用第 01 节第三种写法跑一下（Go 1.27）：

```text
$ curl -s localhost:6060/debug/pprof/goroutineleak?debug=1
goroutineleak profile: total 3
3 @ 0x102e84688 0x102e158a4 0x102e154b8 0x10302fd08 0x102e8b6a4
#	0x10302fd07	main.leak.func1+0x27	/tmp/goexp/leakhttp.go:11
```

三条泄漏的 G 全部指向那行 `ch <- 1`，正常等信号的 worker 没有被算进去。对照组是同一个进程里的 `goroutine` profile：

```text
$ go tool pprof -top http://127.0.0.1:18080/debug/pprof/goroutine
Showing nodes accounting for 8, 100% of 8 total
      flat  flat%   sum%        cum   cum%
         7 87.50% 87.50%          7 87.50%  runtime.gopark
```

它只告诉你「有 8 条 G 停在 gopark」，不区分哪条是泄漏、哪条是正常等待。==这就是 `goroutineleak` 的价值：它把「在等」和「永远等不到」分开了。==

## 03 · 四类常见形态，和各自的修法

```cards
cols: 2
items:
  - title: 无接收者的发送
    tag: 无缓冲 channel
    tone: red
    desc: 父流程 return 或走了别的分支，发送方永远等不到接收者。
    body: |
      ```go
      go func() { ch <- result }()   // 没有人在收
      ```

      修法：缓冲容量按「最多几个发送者」给；或者 `select` 里加 `ctx.Done()`。
  - title: range 一个永不关闭的 channel
    tag: 所有权不明
    tone: amber
    desc: 生产者忘了 close，消费者永远停在 range 的下一轮。
    body: |
      ```go
      go func() {
          for v := range ch { use(v) }
      }()
      ```

      修法：明确「谁生产、谁关闭」，只让一个地方 close。
  - title: 同步原语失约
    tag: 忘了 Done / Unlock
    tone: amber
    desc: 提前 return 的分支漏了 `wg.Done()` 或 `mu.Unlock()`，等待方永远等。
    body: |
      ```go
      if err != nil {
          return          // 忘了 wg.Done()
      }
      defer wg.Done()
      ```

      修法：`defer` 放在最前面，别放在可能不执行的位置。
  - title: context 没有取消
    tag: 生命周期
    tone: violet
    desc: 创建了 `WithCancel` 却把 cancel 丢掉，worker 永远等不到取消信号。
    body: |
      ```go
      ctx, _ := context.WithCancel(parent)  // cancel 丢了
      go worker(ctx)
      ```

      修法：`defer cancel()`；或者用 `errgroup.WithContext` 统一收口。
```

四类的共性是一句话：==发送方的结束条件，依赖了接收方会不会出现。== 修法也对应一句话：让「不再需要」这件事变成显式信号（缓冲、close、context），而不是靠对方恰好还在。

## 04 · 版本敏感的常识

Go 的运行时在变，很多「常识」有版本前提。按现象查，比按版本背更有用：

```timeline
- when: Go 1.14 · 2020
  title: 异步抢占
  desc: 紧循环不再能饿死调度器；Unix 上慢系统调用会更常返回 EINTR
  tone: blue
- when: Go 1.22 · 2024
  title: 循环变量每轮新建
  desc: go func(){ use(v) }() 不再需要 v := v；旧写法在新版本上语义不同
  tone: green
- when: Go 1.25 · 2025
  title: GOMAXPROCS 跟随 cgroup
  desc: 容器限 4 核时默认不再按宿主机 64 核开 64 个 P；GODEBUG 可关
  tone: amber
- when: Go 1.26 · 2026
  title: goroutineleak profile 实验特性
  desc: 需要 GOEXPERIMENT=goroutineleakprofile
  tone: violet
- when: Go 1.27 · 2026
  title: goroutineleak 转正
  desc: 默认可用，端点 /debug/pprof/goroutineleak
  tone: violet
```

```compare
first: 你遇到的现象
head: [先看哪个版本, 为什么]
rows:
  - 紧循环把服务卡住: ["Go 1.14", "异步抢占之前，`for {}` 真的能把 P 占死"]
  - 闭包打出一串相同的值: ["Go 1.22", "循环变量语义变了，旧代码在新版本上含义不同"]
  - 容器里延迟抖动、CPU 没打满: ["Go 1.25", "GOMAXPROCS 是否跟随了 cgroup 限额"]
  - 想知道 G 数为什么只涨不降: ["Go 1.26 / 1.27", "leak profile 在 1.26 是实验，1.27 才默认可用"]
```

## 05 · 从现象到工具

```tree
- label: 先看现象，再挑工具
  note: 竞争、死锁、泄漏、变慢是四类问题，不要一把抓
  children:
    - label: G 数单调上涨
      sub: 泄漏
      note: goroutineleak profile（1.27）、goroutine profile、测试里用 goleak
      children:
        - { label: "边界：leak profile 依赖 GC 可达性", note: "从全局变量或可运行 G 的局部变量可达的原语，检不出来" }
    - label: 卡死不前进
      sub: 死锁或互相等待
      note: goroutine profile 看全部栈；SIGQUIT 打全量栈
      children:
        - { label: "边界：要有活着的进程", note: "core dump 里没有 goroutine 栈" }
    - label: 偶发错误结果
      sub: 数据竞争
      note: go run -race / go test -race
      children:
        - { label: "边界：只覆盖执行过的路径", note: "没跑到的分支里的竞争看不见" }
    - label: 慢，但 CPU 不高
      sub: 等锁 / 等 P / 等 I/O
      note: execution trace、block profile、mutex profile
      children:
        - { label: "边界：trace 开销大", note: "线上用 FlightRecorder 抓最近几秒，别常开" }
```

几个能直接抄的命令：

```bash
# G 数、每类阻塞原因（debug=1 是文本，debug=2 带完整栈）
curl -s localhost:6060/debug/pprof/goroutine?debug=1

# 只看泄漏的 G（Go 1.27）
curl -s localhost:6060/debug/pprof/goroutineleak?debug=1

# 每 1 秒打印一次调度器状态，开销很小
GODEBUG=schedtrace=1000 ./server

# 找数据竞争；只覆盖跑到的路径
go test -race ./...

# 线上抓最近几秒的 trace（Go 1.25 的 FlightRecorder）
# 在代码里：trace.NewFlightRecorder + WriteTo，不用一直开 trace
```

一个读 `goroutine?debug=1` 的顺序：先看总条数，再按 `waitreason` 分组（`chan receive`、`IO wait`、`select`、`sync.Mutex.Lock`），最后看每一组的第一条栈。如果某一组的条数随请求量线性增长，基本就是泄漏或饱和。

## 06 · 什么时候不该开

```matrix
x: { label: 等待比例, from: 低等待, to: 高等待 }
y: { label: 单任务计算量, from: 小计算, to: 大计算 }
cells:
  - { title: 先并行化计算, desc: "批处理、报表。G 帮不上忙，先把计算拆开再说", tone: amber }
  - { title: goroutine 的主场, desc: "流水线、扇出扇入。等待能被 netpoller 吸收", tone: green }
  - { title: 直接同步执行, desc: "低等待小计算：开 G 的 128ns 和调度都可能比计算本身贵", tone: muted }
  - { title: 有界 worker 池, desc: "高等待大计算：并发数贴住下游容量，不要无限扇出", tone: blue }
```

这张表是对话框架，不是答案。两个变量都会漂移：等待比例随下游延迟变，计算量随数据规模变。要问的是下面五个问题：

1. **这个任务值得一条执行流吗？** 计算只有几十微秒，同步执行更快。
2. **等待能被接住吗？** 网络 I/O 可以；普通文件、cgo 不行，后者会占一条 M。
3. **并发数有上限吗？** 没有上限的扇出会把下游打垮，也会把内存打垮。用信号量或 worker 池。
4. **谁负责让它结束？** 有没有 context、超时、close 的所有者。答不上来，就是潜在泄漏。
5. **出问题怎么看见？** 有没有 G 数、`schedtrace`、pprof 端点。看不见的并发不要上生产。

## quiz

```quiz
- q: 一个 G 阻塞在 channel 发送上，怎么判断它是「等得久」还是「泄漏」？
  a: |
    看解除阻塞的条件还会不会成立。如果是父流程早退、没有别的接收者，
    那就是泄漏；如果接收者只是慢，条件还会成立，就不算。
    Go 1.27 的 goroutineleak profile 用 GC 可达性判断：
    阻塞原语从任何可运行 G 都不可达，就判定为永远不会被解除。
- q: 为什么 CPU 密集任务开更多 G 反而更慢？
  a: |
    算力由核数决定，G 只决定有多少条执行流来分这块算力。
    超过并行度之后，多出来的 G 在排队，切换和缓存来回把有效时间吃掉，
    总吞吐不升反降。CPU 密集任务应该用贴住核数的 worker 池。
- q: 容器里 GOMAXPROCS 默认值和宿主机核数的关系，从哪个版本开始变了？
  a: |
    Go 1.25。之前默认取 runtime.NumCPU()，也就是宿主机逻辑核数；
    1.25 起在 Linux 上会读 cgroup 的 CPU bandwidth 限额，取较小值，
    并且周期性更新。手动设置 GOMAXPROCS 会关闭这两项自动行为。
- q: 线上服务变慢但 CPU 不高，先看什么？
  a: |
    先看它在等什么：goroutine profile 按 waitreason 分组，
    再看 execution trace 里的 runnable 延迟和阻塞时间，
    必要时开 block/mutex profile。trace 开销大，用 FlightRecorder 抓最近几秒。
```
