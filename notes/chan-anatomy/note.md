````popquote
label: 这两轮的问答原文
sub: 2 轮问答 · 约 1 万字
tone: violet
note: 原文照录，只把标题降了一级（否则它们会进本页目录）。代码块和表格保持原样，错别字没改。
text: |
  #### 问

  如何理解 go 里的 chan，它是一块堆上面的内存吗？

  #### 答

  可以把 Go 的 `chan` 理解为：**一个由 runtime 管理的、用于 goroutine 通信与同步的“并发队列对象”**。它通常会分配在堆上，但不能简单等同于“一块堆内存”。

  #### 1. `chan` 变量本身像一个引用

  例如：

  ```go
  ch := make(chan int, 10)
  ```

  这里的 `ch` 是一个 channel 类型的值。底层它可以近似理解为指向 runtime 内部 channel 对象的引用：

  ```go
  type hchan struct {
      qcount   uint           // 当前缓冲区中的元素数量
      dataqsiz uint           // 缓冲区容量
      buf      unsafe.Pointer // 环形缓冲区
      elemsize uint16
      closed   uint32

      sendq    waitq          // 等待发送的 goroutine
      recvq    waitq          // 等待接收的 goroutine
      // 还有锁、元素类型信息等
  }
  ```

  真实定义会随 Go 版本变化，但核心概念差不多。

  因此：

  ```go
  var ch chan int
  ```

  这个 `ch` 变量本身只是一个很小的值（可理解为引用/指针语义）；而 `make(chan int)` 创建的底层 channel 运行时对象，通常位于堆上。

  #### 2. 有缓冲 channel：内部确实有一块存元素的内存

  ```go
  ch := make(chan int, 3)
  ```

  这是一个容量为 3 的 buffered channel。

  内部大致包括：

  1. channel 元数据：容量、当前元素数、是否关闭、锁等；
  2. 一个**环形缓冲区**，可以容纳 3 个 `int`；
  3. 等待发送和接收的 goroutine 队列。

  可以粗略画成：

  ```text
  ch
   │
   ▼
  +------------------------------------+
  | hchan                              |
  |  qcount = 2                        |
  |  dataqsiz = 3                      |
  |  buf ───────────────┐              |
  |  sendq               |              |
  |  recvq               |              |
  +----------------------|-------------+
                         ▼
                +---+---+---+
                | 1 | 2 |   |
                +---+---+---+
                  环形缓冲区
  ```

  所以，对 buffered channel 来说，确实存在用于暂存元素的堆内存。

  但要注意，channel 发送的是“元素的值”：

  ```go
  ch <- x
  ```

  - 若 `x` 是 `int`、结构体等，通常会将值复制进 channel 的缓冲区。
  - 若 `x` 是指针、slice、map、接口等，复制进去的是它们的引用头/指针；它们指向的实际数据不一定被复制。

  例如：

  ```go
  ch := make(chan []int, 1)

  data := []int{1, 2, 3}
  ch <- data
  ```

  channel 缓冲区里保存的是 slice header（指向底层数组的引用、长度、容量），不是把 `[1,2,3]` 的数组内容完整复制一份。

  #### 3. 无缓冲 channel：没有“存消息的队列”

  ```go
  ch := make(chan int)
  ```

  这是无缓冲 channel，容量为 0。

  它不用于积压数据；发送和接收必须配对发生：

  ```go
  ch <- 1     // 必须等某个 goroutine 接收
  x := <-ch   // 必须等某个 goroutine 发送
  ```

  例如：

  ```go
  ch := make(chan int)

  go func() {
      ch <- 42
  }()

  fmt.Println(<-ch)
  ```

  无缓冲 channel 仍然有底层 runtime 对象，也通常在堆上；只是没有用于缓存多个元素的环形数组。

  它内部更重要的是维护：

  - 等待发送的 goroutine；
  - 等待接收的 goroutine；
  - 同步和唤醒机制。

  当发送方和接收方相遇时，数据可以直接从发送方交给接收方（具体实现细节由 runtime 决定），然后双方继续执行。

  所以无缓冲 channel 的本质更偏向：**同步点（rendezvous）**。

  #### 4. channel 不只是内存，还是同步原语

  channel 最重要的价值不只是“存数据”，而是提供 goroutine 间的：

  - 通信；
  - 阻塞与唤醒；
  - 并发同步；
  - 内存可见性保证。

  例如：

  ```go
  var x int
  done := make(chan struct{})

  go func() {
      x = 100
      close(done)
  }()

  <-done
  fmt.Println(x) // 可以可靠地看到 100
  ```

  这里 `<-done` 不仅是在等待 goroutine 完成，也建立了同步关系：在 `close(done)` 前的写入，对收到关闭信号的一方是可见的。

  可以粗略理解为：

  - `ch <- v` 与对应的 `<-ch`
  - `close(ch)` 与收到关闭状态的 `<-ch`

  之间，提供了 Go 内存模型定义的 happens-before 关系。

  #### 5. `chan` 是引用类型，赋值不会复制底层 channel

  ```go
  ch1 := make(chan int, 1)
  ch2 := ch1

  ch1 <- 10
  fmt.Println(<-ch2) // 10
  ```

  `ch1` 和 `ch2` 指向的是同一个底层 channel 对象，不会复制出两个队列。

  同样：

  ```go
  func f(ch chan int) {
      ch <- 1
  }
  ```

  把 channel 传给函数时，传递的是 channel 这个引用值的副本，底层仍然是同一个 channel。

  #### 6. `nil channel` 和已关闭 channel

  ##### `nil channel`

  ```go
  var ch chan int // nil
  ```

  它没有关联任何底层 runtime channel 对象：

  - 向它发送：永久阻塞；
  - 从它接收：永久阻塞；
  - `close(ch)`：panic。

  ```go
  var ch chan int
  // ch <- 1       // 永久阻塞
  // <-ch          // 永久阻塞
  // close(ch)     // panic
  ```

  ##### 已关闭 channel

  ```go
  ch := make(chan int, 1)
  close(ch)
  ```

  底层对象还在，只是状态变成关闭：

  - 再发送：panic；
  - 接收：可以继续读完缓冲区已有的数据；
  - 缓冲区为空后继续接收：立刻返回元素类型零值和 `ok == false`。

  ```go
  v, ok := <-ch
  ```

  #### 总结

  可以这样记：

  > `chan` 是一个由 Go runtime 管理的引用类型并发对象；底层通常在堆上，包含同步状态、等待 goroutine 的队列，以及（如果是 buffered channel）用于保存元素的环形缓冲区。

  因此：

  - **它通常涉及堆内存，但不只是“一块内存”**；
  - **无缓冲 channel 主要是同步机制，不存积压消息**；
  - **有缓冲 channel 才有真正用于暂存元素的内部队列**；
  - **channel 的发送、接收、关闭还带有重要的并发同步语义**。

  #### 问

  channel 的出现是为了解决 goroutine 的一些信息同步问题？

  #### 答

  可以。先不管 Go 的底层实现，把 `goroutine` 和 `channel` 想象成现实中的“工人”和“传送带”。

  #### 一、先理解 goroutine：同时工作的“小工人”

  普通代码通常从上到下一步步执行：

  ```go
  fmt.Println("第一件事")
  fmt.Println("第二件事")
  ```

  而在函数前加 `go`：

  ```go
  go doSomething()
  ```

  就相当于安排了一个“小工人”去执行 `doSomething()`，原来的代码不会站在原地等它完成，而是继续向下执行。

  例如：

  ```go
  func work() {
      fmt.Println("工作完成")
  }

  func main() {
      go work()

      fmt.Println("主程序继续执行")
  }
  ```

  这里可能会同时存在：

  - 主 goroutine：执行 `main`
  - 新 goroutine：执行 `work`

  你暂时可以把 goroutine 理解为：

  > 一个可以和其他代码同时工作的轻量级任务。

  #### 二、多个 goroutine 同时工作会遇到什么问题？

  假设有两个 goroutine：

  - goroutine A 负责计算数据；
  - goroutine B 负责使用数据。

  那么就会遇到几个问题：

  1. A 如何把数据交给 B？
  2. B 怎么知道 A 已经把数据准备好了？
  3. 如果 B 先执行，它是否应该等待 A？
  4. A 完成后，如何通知 B？
  5. 如果要停止所有 goroutine，该如何通知？
  6. 多个 goroutine 同时修改同一个变量，会不会发生混乱？

  `channel` 就是 Go 用来解决这类 goroutine **通信和协作问题**的重要工具。

  #### 三、channel 可以理解成“传送带”或“邮箱”

  假设有两个工人：

  ```text
  工人 A  ----数据---->  工人 B
  ```

  channel 就是它们中间的传送带：

  ```text
  工人 A  --->  channel  --->  工人 B
  ```

  在 Go 中可以这样创建 channel：

  ```go
  ch := make(chan int)
  ```

  它的意思是：

  > 创建一个只能传递 `int` 类型数据的 channel。

  向 channel 里发送数据：

  ```go
  ch <- 42
  ```

  从 channel 里接收数据：

  ```go
  value := <-ch
  ```

  箭头可以帮助理解数据方向：

  ```go
  ch <- 42       // 42 进入 ch
  value := <-ch  // 从 ch 取出数据，放入 value
  ```

  #### 四、最简单的完整例子

  ```go
  package main

  import "fmt"

  func main() {
      ch := make(chan int)

      go func() {
          ch <- 42
      }()

      value := <-ch
      fmt.Println(value)
  }
  ```

  运行结果：

  ```text
  42
  ```

  逐步解释：

  ##### 第一步：创建 channel

  ```go
  ch := make(chan int)
  ```

  创建一条用来传递整数的“传送带”。

  ##### 第二步：启动 goroutine

  ```go
  go func() {
      ch <- 42
  }()
  ```

  新 goroutine 把 `42` 发送进 channel。

  ##### 第三步：接收数据

  ```go
  value := <-ch
  ```

  主 goroutine 从 channel 中接收数据。

  如果新 goroutine 还没有发送，主 goroutine会在这里等待。

  这种等待叫作**阻塞**：

  > 当前 goroutine 暂时停下来，直到它等待的事情发生。

  ##### 第四步：继续执行

  收到 `42` 后，主 goroutine继续运行：

  ```go
  fmt.Println(value)
  ```

  #### 五、channel 同时完成两件事

  上面的代码中：

  ```go
  ch <- 42
  value := <-ch
  ```

  不仅仅是在传递一个数字，它实际上完成了两件事。

  ##### 1. 传递数据

  `42` 从一个 goroutine 传递给了另一个 goroutine。

  ##### 2. 同步执行时机

  如果接收方先运行：

  ```go
  value := <-ch
  ```

  但现在还没有数据，那么接收方会等待。

  对于无缓冲 channel，如果发送方执行：

  ```go
  ch <- 42
  ```

  但还没有接收方，那么发送方也会等待。

  所以 channel 不只是“装数据的盒子”，它还可以控制 goroutine 什么时候等待、什么时候继续。

  这就是这里所说的**同步**。

  #### 六、什么是“无缓冲 channel”？

  下面创建的是无缓冲 channel：

  ```go
  ch := make(chan int)
  ```

  无缓冲可以理解为：

  > channel 中间没有仓库，发送方必须把数据直接交到接收方手里。

  像两个人面对面交文件：

  ```text
  发送方拿着文件等待  <---->  接收方伸手接文件
  ```

  只有发送方和接收方都准备好了，这次传递才会完成。

  例如：

  ```go
  ch := make(chan int)

  go func() {
      ch <- 100
  }()

  value := <-ch
  ```

  这里发送和接收形成了一次配对。

  无缓冲 channel 特别适合：

  - 传递数据；
  - 同时确认对方已经接收；
  - 让两个 goroutine 在某个时间点同步。

  #### 七、什么是“有缓冲 channel”？

  也可以创建一个带容量的 channel：

  ```go
  ch := make(chan int, 3)
  ```

  这里的 `3` 表示 channel 最多可以暂时存放 3 个整数。

  可以把它理解成一个有 3 个位置的小仓库：

  ```text
  发送方 ---> [ 数据 ][ 数据 ][ 空位 ] ---> 接收方
  ```

  发送方可以先把数据放进去：

  ```go
  ch <- 10
  ch <- 20
  ch <- 30
  ```

  只要仓库还没满，发送方通常不需要等接收方立刻来取。

  当仓库满了以后，如果继续发送：

  ```go
  ch <- 40
  ```

  发送方就需要等待，直到接收方取走一个数据、腾出位置。

  同样，如果仓库空了，接收方执行：

  ```go
  value := <-ch
  ```

  接收方会等待，直到有新数据到来。

  简单对比：

  | 类型 | 创建方式 | 特点 |
  |---|---|---|
  | 无缓冲 channel | `make(chan int)` | 发送方和接收方需要直接配对 |
  | 有缓冲 channel | `make(chan int, 3)` | 可以暂时存放一定数量的数据 |

  #### 八、为什么不直接使用普通变量？

  当然可以让多个 goroutine 使用同一个变量：

  ```go
  var value int
  ```

  一个 goroutine 写：

  ```go
  value = 42
  ```

  另一个 goroutine读：

  ```go
  fmt.Println(value)
  ```

  但问题是：它们可能同时执行。

  接收方可能在发送方写入之前就读了：

  ```text
  接收方先读取：得到 0
  发送方后写入：改成 42
  ```

  如果多个 goroutine 同时修改同一个数据，还可能出现 **data race（数据竞争）**。

  数据竞争可以简单理解为：

  > 多个 goroutine 在没有协调的情况下，同时读写同一份数据，导致结果不可预测。

  传统做法是使用：

  - 共享变量；
  - 锁 `sync.Mutex`；
  - 表示数据是否准备好的状态，例如 `ready`。

  大概会变成：

  ```go
  var value int
  var ready bool
  var mu sync.Mutex
  ```

  写入方需要加锁、修改、解锁：

  ```go
  mu.Lock()
  value = 42
  ready = true
  mu.Unlock()
  ```

  读取方还需要反复检查数据是否准备好。

  这样需要程序员自己处理：

  - 什么时候加锁；
  - 什么时候解锁；
  - 数据有没有准备好；
  - 如何让等待方暂停；
  - 如何唤醒等待方；
  - 如何避免不断检查产生的 CPU 浪费；
  - 如何避免忘记解锁。

  而使用 channel：

  ```go
  ch := make(chan int)

  go func() {
      ch <- 42
  }()

  value := <-ch
  ```

  “数据是 `42`”和“数据已经准备好了”这两件事，被合并在了一起：

  - 没有数据时，接收方自动等待；
  - 有数据时，接收方得到数据并继续运行。

  #### 九、Go 推荐的是“通过通信来协作”

  Go 的 channel 借鉴了 CSP（Communicating Sequential Processes，通信顺序进程）的思想。

  Go 中有一句常见的话：

  > 不要通过共享内存来通信；应该通过通信来共享内存。

  英文是：

  > Don't communicate by sharing memory; share memory by communicating.

  简单理解：

  ##### 方式一：直接共享数据

  ```text
  goroutine A ─┐
               ├─ 同时操作同一个变量
  goroutine B ─┘
  ```

  这时通常需要锁来保护数据。

  ##### 方式二：通过 channel 交接数据

  ```text
  goroutine A ---> channel ---> goroutine B
  ```

  数据明确地从一个 goroutine 交给另一个 goroutine，很多时候会更容易理解。

  这并不意味着 Go 禁止使用锁，也不意味着 channel 可以替代所有锁。它只是提供了另一种更适合某些场景的协作方式。

  #### 十、channel 的常见用途

  ##### 1. 传递数据或任务

  一个 goroutine 生产任务，另一个 goroutine 处理任务：

  ```go
  jobs := make(chan string)

  go func() {
      jobs <- "任务1"
      jobs <- "任务2"
      close(jobs)
  }()

  for job := range jobs {
      fmt.Println("正在处理：", job)
  }
  ```

  执行过程可以理解为：

  ```text
  生产者 ---> jobs channel ---> 消费者
  ```

  这里：

  ```go
  close(jobs)
  ```

  表示：

  > 不会再向这个 channel 发送新任务了。

  接收方使用：

  ```go
  for job := range jobs
  ```

  会不断接收数据，直到 channel 被关闭并且里面的数据全部取完。

  这是典型的**生产者—消费者模式**。

  如果有多个处理任务的 goroutine，就可以构成 **worker pool（工作池）**。

  如果数据依次经过多个处理阶段，就可以构成 **pipeline（流水线）**。

  ##### 2. 等待 goroutine 完成

  有时不需要传递具体数据，只需要知道：

  > 这个 goroutine 已经完成了。

  可以这样写：

  ```go
  done := make(chan struct{})

  go func() {
      // 做一些工作

      close(done)
  }()

  <-done
  fmt.Println("工作已经完成")
  ```

  解释：

  ```go
  <-done
  ```

  会等待 `done` 被关闭。

  `struct{}` 是一个不包含字段的空结构体：

  ```go
  struct{}{}
  ```

  当 channel 只用来发送信号、不需要携带具体数据时，经常使用：

  ```go
  chan struct{}
  ```

  ##### 3. 发送停止通知

  一个 goroutine 可能一直运行，我们希望通知它停止：

  ```go
  stop := make(chan struct{})

  go func() {
      for {
          select {
          case <-stop:
              fmt.Println("收到停止通知")
              return
          default:
              // 继续工作
          }
      }
  }()

  close(stop)
  ```

  这里：

  ```go
  close(stop)
  ```

  相当于广播：

  > 不会再有新的信号了，现在停止吧。

  所有正在等待：

  ```go
  <-stop
  ```

  的 goroutine 都能发现 `stop` 已经关闭。

  其中 `select` 可以简单理解为：

  > 同时等待多个 channel 操作，看哪一个先准备好。

  不过，在真实项目里，如果涉及：

  - 请求取消；
  - 超时；
  - 跨越多个函数的停止通知；
  - 一整条调用链的生命周期控制；

  通常优先使用：

  ```go
  context.Context
  ```

  它是 Go 专门提供的取消和超时机制。

  ##### 4. 限制同时工作的 goroutine 数量

  假设有 100 个任务，但最多只允许 3 个任务同时执行。

  可以使用容量为 3 的 channel：

  ```go
  sem := make(chan struct{}, 3)
  ```

  执行任务前，先往里面放一个标记：

  ```go
  sem <- struct{}{}
  ```

  任务完成后，取出一个标记：

  ```go
  <-sem
  ```

  示例：

  ```go
  sem := make(chan struct{}, 3)

  for i := 0; i < 10; i++ {
      sem <- struct{}{}

      go func(id int) {
          defer func() {
              <-sem
          }()

          fmt.Println("执行任务", id)
      }(i)
  }
  ```

  因为 channel 最多只能放 3 个标记，所以最多只有 3 个任务能够同时进入执行阶段。

  这种使用方式类似于**信号量**。

  ##### 5. 同时等待多个事件

  例如程序可能需要等待：

  - 收到任务；
  - 收到停止通知；
  - 到达超时时间。

  可以使用 `select`：

  ```go
  select {
  case job := <-jobs:
      fmt.Println("收到任务：", job)

  case <-stop:
      fmt.Println("收到停止通知")

  case <-time.After(3 * time.Second):
      fmt.Println("等待超时")
  }
  ```

  哪个事件先发生，就执行对应的分支。

  这是 channel 非常重要的能力。

  #### 十一、channel 不只是传递信息，还保证“前面的修改能被看到”

  看一个例子：

  ```go
  var x int
  done := make(chan struct{})

  go func() {
      x = 100
      close(done)
  }()

  <-done
  fmt.Println(x)
  ```

  这里的执行逻辑是：

  1. 新 goroutine 把 `x` 修改为 `100`；
  2. 新 goroutine 关闭 `done`；
  3. 主 goroutine 等待 `done` 关闭；
  4. 等待结束后读取 `x`。

  主 goroutine能够可靠地看到：

  ```text
  100
  ```

  channel 不只是让 goroutine 等待，它还提供了 Go 内存模型中的同步保证。

  简单理解就是：

  > 当 channel 告诉你“前面的工作已经完成”时，这个工作产生的修改也能被正确看到。

  更专业的说法是，它建立了某种 **happens-before（先发生于）关系**，但初学时只需要记住：

  > channel 不仅同步执行顺序，还保证同步之前写入的数据对另一方可见。

  #### 十二、channel 不是所有同步问题的最佳答案

  虽然 channel 很重要，但不能把所有并发问题都改成 channel。

  ##### 适合使用 channel 的情况

  channel 通常适合：

  - 在 goroutine 之间传递数据；
  - 传递任务或事件；
  - 生产者—消费者模式；
  - pipeline（流水线）；
  - worker pool（工作池）；
  - 等待任务完成；
  - 发送停止信号；
  - 控制并发数量；
  - 使用 `select` 等待多个事件。

  ##### 适合使用 Mutex 的情况

  如果只是保护一个大家都要访问的共享变量，使用锁可能更直接：

  ```go
  type Counter struct {
      mu sync.Mutex
      n  int
  }

  func (c *Counter) Inc() {
      c.mu.Lock()
      c.n++
      c.mu.Unlock()
  }
  ```

  这里 `mu` 是锁。

  执行：

  ```go
  c.mu.Lock()
  ```

  表示：

  > 我要修改数据，其他 goroutine 先不要同时修改。

  执行：

  ```go
  c.mu.Unlock()
  ```

  表示：

  > 我修改完了，其他 goroutine 可以继续了。

  如果只是对计数器做一次简单的 `n++`，为了使用 channel 专门启动一个 goroutine，再向它发送加一请求，反而可能更复杂、开销更大。

  #### 十三、不同问题应该选择不同工具

  可以先记住下面这张表：

  | 需求 | 常用工具 |
  |---|---|
  | goroutine 之间传递数据、任务、事件 | `channel` |
  | 等待某个事件发生 | `channel` |
  | 同时等待多个事件 | `channel + select` |
  | 保护共享变量 | `sync.Mutex` / `sync.RWMutex` |
  | 等待多个 goroutine 全部完成 | `sync.WaitGroup` |
  | 简单的原子计数或状态修改 | `sync/atomic` |
  | 取消、超时、请求生命周期控制 | `context.Context` |

  因此，channel 不是锁的完全替代品。

  一个简单的判断方式是：

  - **重点是“把东西交给另一个 goroutine”**：考虑 channel；
  - **重点是“保护大家共同访问的东西”**：考虑锁；
  - **重点是“等一批 goroutine 全部结束”**：考虑 `WaitGroup`；
  - **重点是“通知整条调用链取消或超时”**：考虑 `context`。

  #### 十四、回到你的问题：channel 是为了解决信息同步吗？

  答案是：

  > 是，但不只是“同步信息”。

  更准确地说，channel 主要帮助 goroutine 完成三件事：

  ##### 1. 传递信息

  ```go
  ch <- 42
  value := <-ch
  ```

  把数据从一个 goroutine 传给另一个。

  ##### 2. 同步执行时机

  没有数据时，接收方等待；某些情况下没有接收方时，发送方也等待。

  ##### 3. 保证内存可见性

  发送、接收或关闭 channel，可以让一个 goroutine 在前面完成的修改被另一个 goroutine正确看到。

  最后可以用一句话记住：

  > goroutine 是同时工作的“小工人”，channel 是它们之间传递数据、发送通知和协调工作节奏的“传送带”。它通常用于通信和同步，但不是所有并发问题都应该使用 channel。
````

Go 的 channel 让 goroutine 交换数据，也让发送和接收在必要时等待对方。例如，`ch := make(chan int, 3)` 创建一个容量为 3 的 channel，`ch <- 1` 发送一个值，`<-ch` 接收一个值。接收方还没取走数据时，发送方最多可以先放入 3 个 `int`；容量为 0 时则没有暂存槽位，收发双方需要配合才能完成交接。

这些行为靠什么实现？channel 是一块存放元素的堆内存，还是一种同步机制？代码里的 `ch` 变量和 `make` 创建的 runtime 对象 `hchan` 不是同一件事：`ch` 保存指针，`hchan` 管理缓冲区和等待队列。

这篇先区分代码里的变量、runtime 的对象和等待队列，再看一次发送会走哪条路。

文中的 runtime 实现、字节数和分配次数以本机的 Go 1.26.2 darwin/arm64 为准，不代表所有版本和平台。先把「一块堆内存」这个说法中混在一起的三层分开：

```compare
first: 你在说哪一层
head: [它是什么, 在哪, 本机实测占多少]
rows:
  - "那个变量 `ch`":
      - 代码里的 channel 变量，保存一个 8 字节的指针；nil 时不指向对象
      - 跟着它所在的作用域走，通常在栈上或者结构体里
      - 8 字节
  - "runtime 的 `hchan` 对象":
      - "`make(chan ...)` 创建的运行时对象，保存 channel 的状态"
      - 堆
      - 112 字节（arm64）
  - "装元素的那块 `buf`":
      - 环形缓冲区，只在容量大于 0、且元素不是零大小时才有
      - 堆（可能和 `hchan` 同一块，也可能分开，见 §04）
      - "`容量 × 元素大小`"
```

但只看分配了多少内存还不够：channel 还靠两条等待队列和一把锁协调收发。§03 会看到，一次发送甚至可以不经过缓冲区。

## 01 · 四块东西，各在哪

图中的 `G` 是 goroutine，`sudog` 是 runtime 用来记录等待者的结构。`sendq` 和 `recvq` 分别是等待发送和等待接收的队列；`park` 表示挂起当前 goroutine。

```arch
svg: chan-parts
maxScale: 1.22
caption: 从右边的 `ch` 看进去。`hchan` 管理 `buf` 和两条 sudog 链；关闭时置 `closed`、清空等待队列并唤醒等待者，但不会清掉缓冲区里的元素。点零件查看内容，或用下面的导览走一遍。
frames:
  - id: stack
    boundary: 0
    kind: classification
    label: 栈 · ch 变量
    detail: 你写的 `ch` 变量本身只有 8 字节，存的是一个指针。把它赋给别的变量、当参数传进函数，复制的都是这 8 字节 —— 底层还是同一个 hchan。
  - id: heap
    boundary: 1
    kind: contains
    label: 堆 · hchan、缓冲区和等待记录
    detail: 一次 `make` 创建 hchan；buf 是否单独分配取决于 makechan 的三个分支（§04）。sudog 则在 goroutine 等待时取得。
bodies:
  chvar:
    badge: 8 字节
    rows:
      - { k: 内容, v: 一个指针 }
      - { k: 赋给别的变量, v: 复制这 8 字节 }
      - { k: 传进函数, v: 同上 }
    note: 它不装元素，也不记录状态
  hchan:
    badge: 112 字节
    rows:
      - { k: 队列状态, v: qcount / dataqsiz }
      - { k: 两个游标, v: sendx / recvx }
      - { k: 关闭标记, v: closed }
      - { k: 元素类型, v: elemtype / elemsize }
      - { k: 两条链, v: sendq / recvq }
      - { k: 一把锁, v: lock 保护以上全部 }
    note: 一次 make 一定分配它
  ring:
    badge: 装元素
    rows:
      - { k: 多大, v: dataqsiz × elemsize }
      - { k: 怎么用, v: 环形，靠 sendx / recvx 两个游标 }
      - { k: 容量 0 时, v: 这块不存在 }
    note: buf 指向它
  suds:
    badge: 有人等才有
    rows:
      - { k: 谁造的, v: acquireSudog }
      - { k: 记住什么, v: 值在哪个地址 }
      - { k: 挂在哪, v: sendq 或 recvq 上 }
    note: sudog 记录收发地址；地址不为 nil 时通常指向栈，也可能指向堆
parts:
  chvar:
    label: ch 变量
    sub: 你代码里的那个名字
    detail: 它和 `make` 造出来的对象是两样东西。`var ch chan int` 声明了一个 8 字节的变量，但它是 nil —— 没有指向任何 hchan，所以发送和接收都会永久阻塞。`make` 之后它才指向一个真实对象。
    facts: { 大小: 8 字节, 在哪: 跟着作用域, 是 nil 时: 没有 hchan }
  hchan:
    label: runtime 的 hchan
    sub: 元数据、两条链、一把锁
    detail: 这个类型的字段随版本变化，但四组东西一直在：队列状态（qcount / dataqsiz）、两个游标（sendx / recvx）、两条等待链（sendq / recvq）、以及保护它们的锁。qcount 是缓冲区里的元素数，dataqsiz 是容量；sendx 和 recvx 分别记录下一次写、读的位置，走到末尾后各自回到开头。
    facts: { 分配: mallocgc, 本机实测: 112 字节, 为什么加锁: 多个 G 会同时进来 }
  ring:
    label: 环形缓冲区
    sub: 用来暂存元素的地方
    detail: 元素按 sendx 写进去、按 recvx 读出来，游标各自在走到末尾时环回。容量 0 时 runtime 不给它分配内存，`buf` 指向 hchan 自己 —— 见 §04。
    facts: { 多大: dataqsiz × elemsize, 谁写: chansend 路径② / chanrecv 路径①（缓冲满时）, 谁读: chanrecv 路径①（缓冲满时）或② }
  suds:
    label: sudog 链
    sub: 被挂住的 G
    detail: 发送方放不下时不会把值复制到缓冲区 —— runtime 取得一个 sudog，记录当前 goroutine 和待发送值的地址，挂到 sendq 上然后 park。待发送值仍在发送方提供的地址，通常在栈上，也可能在堆上。
    facts: { 谁造: acquireSudog, 记住: 值的地址, 什么时候消失: 被唤醒 }
tours:
  - id: blocks
    label: 数一数一共几块
    steps:
      - at: [chvar]
        text: 最外层是代码里的 `ch` 变量。在本机，它保存一个 8 字节的指针；这个变量不是 `make` 创建的 hchan 对象。
      - at: [hchan]
        text: 一次 `make` 一定造出这个。所有状态都在这 112 字节里：装了几个、能装几个、两个游标、关没关、谁在等。
      - at: [ring]
        text: 这是暂存元素的地方。容量 0 时它不存在；即使只分配一个 hchan，也没有装元素的缓冲区。
      - at: [suds]
        text: 有人被卡住时才有它。注意 sudog 里存的是值的地址，不是值的副本。
  - id: swap
    label: 变的是什么
    steps:
      - at: [chvar, hchan]
        text: 复制 `ch` 只是复制那 8 字节，两个名字指同一个 hchan。这是「引用类型」的全部含义。
      - at: [hchan, ring]
        text: 关闭 channel 时，runtime 置位 `closed`，清空 recvq 和 sendq，再唤醒等待者；缓冲区里的元素不会被清掉，已经放进去的还能读完。
```

## 02 · 变量不等于对象

下面三种写法分别说明 nil、创建 channel 和复制 channel 变量：

```go
var a chan int          // a = nil，没有 hchan。发送、接收都永久阻塞
b := make(chan int, 3)  // b 指向一个 hchan，buf 里有 3 格
c := b                  // c 和 b 是同一个 hchan 的两个名字
```

`c := b` 复制的是那 8 字节指针，不是 hchan 或其中的元素。给函数传 channel 也是传指针的副本：函数往同一个 channel 发送值，调用方可以接收；但函数给自己的参数换一个 channel，不会改变调用方的变量。

`make` 才会分配 channel 的运行时对象。下面是本机用 `testing.Benchmark` 测得的每次操作分配字节数和次数（B/op 和 allocs/op）：

```text
Go go1.26.2 darwin/arm64
make(chan int)          容量0         112.0 B/op   1.00 allocs/op
make(chan int, 3)        容量3        144.0 B/op   1.00 allocs/op
make(chan int, 100)      容量100     1024.0 B/op   1.00 allocs/op
make(chan []int)         元素含指针    112.0 B/op   1.00 allocs/op
make(chan []int, 3)      元素含指针    192.0 B/op   2.00 allocs/op
make(chan struct{})      零大小元素    112.0 B/op   1.00 allocs/op
make(chan struct{}, 100) 零大小+容量   112.0 B/op   1.00 allocs/op
```

在这组测量里，hchan 本身占 112 字节。容量为 3 的 `chan int`，hchan 加上三个 8 字节元素共需 112 + 3×8 = 136 字节，分配器取整后实测为 144 字节。最后两行显示，**容量为 100 的 `chan struct{}` 也只分配了 112 字节**：元素大小是 0，`buf` 不需要空间。

## 03 · 一次 `ch <- v` 走哪条路

下面讨论一个已经创建、尚未关闭的 channel，以及普通的阻塞发送。runtime 处理 `ch <- v` 时，按顺序尝试三条路径。这里的 `qcount` 是缓冲区已有的元素数，`dataqsiz` 是容量，`sendx` 记录下一次写入的位置。

```cards
cols: 3
items:
  - title: ① recvq 有人等
    tone: amber
    desc: 直接交接，绕过缓冲区
    tag: 先试这条
    body: |
      `chansend` 取得锁并确认 channel 未关闭后，先试 `c.recvq.dequeue()`。拿到一个在等的接收者，就把 v **直接拷进它的目标地址**：

      ```go
      if sg := c.recvq.dequeue(); sg != nil {
          // We pass the value we want to send
          // directly to the receiver, bypassing
          // the channel buffer (if any).
          send(c, sg, ep, func() { unlock(&c.lock) }, 3)
          return true
      }
      ```

      注释里的 `bypassing the channel buffer (if any)` 是原文。==这条路不读取或写入缓冲区里的元素。==

      无缓冲 channel 有接收方等待时走这条；没有接收方等待时走 ③。它没有缓冲区可存放元素。
  - title: ② 缓冲区有空位
    tone: blue
    desc: 写进环形缓冲区
    tag: 有缓冲才有
    body: |
      条件 `c.qcount < c.dataqsiz`。成立就把 v 拷进 `buf[sendx]`，sendx 前进一格，qcount 加一。

      ```go
      qp := chanbuf(c, c.sendx)
      typedmemmove(c.elemtype, qp, ep)
      c.sendx++
      if c.sendx == c.dataqsiz { c.sendx = 0 }
      c.qcount++
      ```

      这条路径由发送方把值存进缓冲区。缓冲区满时，先挂起的发送也可能由接收方把待发值填进缓冲区，见 ③。`typedmemmove` 是值拷贝 —— 元素类型里有什么就拷什么（§05）。
  - title: ③ 没有接收者，也没有空位
    tone: red
    desc: 挂到 sendq 上，park
    tag: 阻塞
    body: |
      前两条都不成立，就造一个 sudog：

      ```go
      mysg := acquireSudog()
      mysg.elem.set(ep)   // 记住值在哪个地址
      mysg.g = gp
      c.sendq.enqueue(mysg)
      gopark(chanparkcommit, ...)
      ```

      **注意 `mysg.elem.set(ep)` 存的是地址，不是值的副本。** 挂起时，待发送值仍在发送方提供的地址，通常在栈上，也可能在堆上；sudog 对这个值只记录地址。

      如果等来的是接收方：无缓冲时，它直接从该地址取值；有缓冲且已满时，它先取走缓冲区队头，再把待发值填进空出的同一槽位。随后唤醒发送方。
```

这三条路解释了为什么「一块内存」的说法站不住：

- 无缓冲 channel 永远走 ① 或 ③，**一次也不写缓冲区**；
- 进入 ③ 挂起时，只记录待发送值的地址，**不把值复制到缓冲区**；值仍在发送方提供的地址，通常在栈上，也可能在堆上；
- 走 ② 时由发送方写缓冲区；如果缓冲区已满且发送方在 ③ 等待，接收方到来时会先取走队头，把待发值填入空出的槽位，再唤醒发送方。

下面的交互给发送和接收各自的路径编号。上面三张卡片说的是**发送**路径；接收的路径 ① 则是先处理 `sendq` 里的等待者。

```demo
widget: chan-lab
title: 有缓冲 · 亲手走一遍三条路
hint: 先连点三次「发送一个值」填满缓冲区，再发送一次，最后接收
actions: false
config:
  cap: 3
```

按这个顺序点，你会看到三条路：

1. **发送 ×3** → 路径 ②，三个值依次进入 `buf[0]`、`buf[1]`、`buf[2]`，sendx 环回到 0，qcount 到 3
2. **发送** → 路径 ③，缓冲区满了，发送方带着值的地址挂到 sendq（qcount 没变）
3. **接收** → 接收路径 ①，先拿走队头，再把等待发送的值填进同一个槽位，并唤醒发送方；qcount 仍是 3

最后一步的 ① 是接收路径，不是卡片里的发送路径 ①。想看发送路径 ①，可以点「重置」，先点「接收一个值」让接收方进入 `recvq`，再点「发送一个值」。

```demo
widget: chan-lab
title: 无缓冲 · 同样的按钮，完全不同的走法
hint: 点「发送」看它直接卡住
actions: false
config:
  cap: 0
```

容量 0 时状态栏里的 `dataqsiz` 是 0，缓冲区那块直接显示「没有这块」。这时：

其中，发送和接收分别从重置后的初始状态开始。

- **发送** → 路径 ③，直接挂起（`qcount < dataqsiz` 变成 `0 < 0`，永远不成立）
- **接收** → 路径 ③，也挂起
- 只有「一边已经在等、另一边来了」才走 ① —— 两个 goroutine 在那里碰头

## 04 · makechan：堆上到底几块

§02 的实测中，有的 `make` 分配一次，有的分配两次。runtime 的 `makechan` 会先算出 `mem = 容量 × 元素大小`，再按 `mem` 是否为 0、元素是否含指针，选择三个分支之一：

```compare
first: 你写的
head: [走哪个分支, 分配几次, 本机实测]
rows:
  - '`make(chan int)`':
      - '`mem == 0`'
      - 1 次（只有 hchan）
      - 112 B
  - '`make(chan struct{}, 100)`':
      - '`mem == 0`（元素大小是 0）'
      - 1 次（只有 hchan）
      - 112 B
  - '`make(chan int, 3)`':
      - 元素不含指针：hchan 和 buf 一次分配完
      - 1 次
      - 144 B
  - '`make(chan []int, 3)`':
      - 元素含指针：分两次
      - 2 次
      - 192 B
```

源码里的 `switch` 按顺序判断。因此，即使元素含指针，只要容量为 0、`mem` 为 0，也会先走第一条分支：

```go
switch {
case mem == 0:
    // 容量 0，或者元素大小 0
    c = (*hchan)(mallocgc(hchanSize, nil, true))
    // Race detector uses this location for synchronization.
    c.buf = c.raceaddr()
case !elem.Pointers():
    // 元素里没有指针：hchan 和 buf 一次分配完，buf 紧跟在后面
    c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
    c.buf = add(unsafe.Pointer(c), hchanSize)
default:
    // 元素里有指针：分开分配，让 GC 单独盯着 buf
    c = new(hchan)
    c.buf = mallocgc(mem, elem, true)
}
```

==第一条分支是最关键的一行：`c.buf = c.raceaddr()`。== 无缓冲 channel 的 `buf` 指向 `hchan` 自己 —— 不是「一块空的缓冲区」，是「根本没有缓冲区」。这里 `raceaddr()` 返回的是 `hchan` 内部 `buf` 字段的地址，不是另行分配的元素数组。所以对 `make(chan int)` 来说，堆上就是一块 112 字节，里面不含任何元素槽位。

第三条分支解释了为什么本机的 `chan []int` 无缓冲时只分配 1 次（112 B），加了容量后变成 2 次（192 B）：只有这时候才需要一块能被 GC 单独标记的 buf。

## 05 · 缓冲区里放的是什么

数据从发送方复制到缓冲区时，`typedmemmove` 做的是**值拷贝**，不是把原变量搬进去。复制出的值包含什么，取决于 channel 的元素类型：

```compare
first: 元素类型
head: [缓冲区里存的, 原来的变量还能改吗]
rows:
  - '`int`、`struct{}`、普通结构体':
      - 整个值的一份副本
      - 能。改原变量不影响 channel 里那份
  - '指针、`slice`、`map`、`interface`':
      - 各自值的一份副本（本机 slice 是三个字，interface 是两个字）
      - 指针、slice、map 可共享所指数据；interface 是否共享取决于动态类型，比如 int 是独立的值，slice 可共享底层数组
```

结构体本身也可能包含指针或 slice：复制结构体时，这些字段的值同样被复制，但它们指向的数据仍可能被双方共享。下面的 `T` 只有整数，不包含这样的字段。

```go
type T struct{ A, B int }

ch1 := make(chan T, 1)
t := T{1, 2}
ch1 <- t        // 整个 T 拷进去
t.A = 99        // 对 ch1 里那份没有影响

ch2 := make(chan []int, 1)
data := []int{1, 2, 3}
ch2 <- data     // 只拷 slice header（指针 + len + cap）
data[0] = 99    // 会影响 ch2 里那份 —— 它们指向同一个底层数组
```

因此，缓冲区里保存的值由**元素类型**决定。用 channel 传大结构体时，复制的是整个结构体；如果不想复制整个结构体，可以传指针。

## 06 · 三条跟着来的语义

除了内存布局，channel 还有三类需要留意的语义：nil、关闭和内存可见性。先看直接发送、接收和关闭的结果；表里的 `ok` 来自 `v, ok := <-ch`，表示这次接收是否成功。

```compare
first: channel 的状态
head: [发送, 接收, 关闭]
rows:
  - nil（`var ch chan int`）:
      - 永久阻塞
      - 永久阻塞
      - panic
  - 正常，但缓冲满了 / 空了:
      - 阻塞（挂到 sendq）
      - 阻塞（挂到 recvq）
      - 唤醒所有等待者
  - 已关闭，缓冲区里还有元素:
      - panic
      - 继续读完，然后返回零值
      - panic（重复关闭）
  - 已关闭，缓冲区已空:
      - panic
      - 立刻返回零值 + `ok == false`
      - panic
```

对 nil channel 直接发送或接收会永久阻塞，不是超时。下面是源码中 nil 发送分支的调用：

```go
gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
```

`traceBlockForever` —— 永不被唤醒。

关闭的顺序也值得记住：`closechan` 先把 `closed` 置 1，然后**清空 recvq**（把每个等待接收者的目标地址写成零值）和 **sendq**（这些发送者被唤醒后 panic），最后才 unlock 并逐个唤醒。所以「关闭时缓冲区里剩下的元素」不会被清掉，它们还能被读出来。

### happens-before：收发和关闭的顺序保证

Go 内存模型用「发生在之前」（happens-before）描述操作之间的先后关系，并据此判断一个 goroutine 的写入对另一个 goroutine 的读取是否可见。channel 的四条规则把这种顺序关系与发送、接收和关闭联系起来：

```compare
first: 你做的动作
head: [保证了什么]
rows:
  - '发送 `ch <- v`':
      - 发送**发生在**对应接收完成之前
  - '关闭 `close(ch)`':
      - 关闭**发生在**「因为已关闭而返回零值」的接收之前
  - '无缓冲接收 `<-ch`':
      - 接收**发生在**对应发送完成之前（所以两边真的碰头了）
  - '第 k 次接收':
      - 发生在容量为 C 的 channel 上第 k+C 次发送完成之前
```

例如，一个 goroutine 先把共享变量写为 1，再向 channel 发送；另一个 goroutine 完成对应接收后再读取。假设没有其他写入，读取会看到 1：写入先于发送，发送先于对应接收完成，接收完成又先于读取。

第四条推广的是无缓冲接收那一条规则：它让一个容量为 C 的 channel 可以当计数信号量用 —— channel 里的元素个数就是「正在使用的人数」，容量就是「同时最多几个人」。

例如 C=3、k=1 时，规则说第 1 次接收发生在第 4 次发送完成之前。假设 channel 起初为空、前三次发送先填满缓冲区，后续发送要等一次接收腾出位置。计数信号量是一种特定用法：开始使用前发送一个值，使用结束后接收一个值；按这套约定使用时，缓冲区里的元素数才表示正在使用的人数。

==这四条是 channel 除了搬数据之外真正给你的东西。== 前三条在本机都能复现；第四条是内存模型文档里的原话，不在 runtime 代码里。

## 07 · 什么时候别用 channel

channel 适合在 goroutine 之间交接值，但不是每种并发任务都需要 channel。可以先按要完成的事情选择工具：

```compare
first: 你真正要做的
head: [先考虑, 为什么]
rows:
  - 把一个东西交给另一个 goroutine:
      - "`chan` 或 `chan` + `select`"
      - 交接本身就是语义，channel 的阻塞正好表达「还没准备好」
  - 等一批 goroutine 全部结束:
      - "`sync.WaitGroup`"
      - 不需要传数据，只需要等待；`WaitGroup` 用计数完成这件事
  - 保护一个共享变量:
      - "`sync.Mutex` / `RWMutex`"
      - 为了 `n++` 专门起一个 goroutine 再发消息过去，比加锁更慢也更绕
  - 一个计数器自增:
      - "`sync/atomic`"
      - "`n++` 在多核上不是一步，但 `atomic.AddInt64` 是"
  - 取消、超时、整条调用链:
      - "`context.Context`"
      - 关闭一个 channel 只能广播一次，`context` 能带值和截止时间往下传
```

一个简单的判断是：**重点在「把东西交给谁」就用 channel，重点在「保护同一份东西」就用锁。**

```summary
title: 回到那个问题
text: |
  本机用 `make` 创建的 `chan` 不只是「一块装元素的堆内存」：在 Go 1.26.2 darwin/arm64 中，它有==一个 112 字节的 hchan 对象，以及一块可能不存在的元素缓冲区==。

  `hchan` 通过两条等待队列和一把锁协调收发：发送方和接收方可以在队列上碰头，数据从发送方的地址直接拷到接收方的目标地址；这些地址通常在栈上，也可能在堆上。缓冲区则用来暂存元素。
```

## 速查

这里的字节数和分配次数仍以开头的本机环境为准。

```compare
first: 你手上这个
head: [它是什么, 关键点]
rows:
  - '`var ch chan int`':
      - 8 字节的 nil
      - 没有 hchan，收发都永久阻塞，close 会 panic
  - '`make(chan int)`':
      - 112 字节的 hchan
      - "`buf` 指向自己，没有元素槽位"
  - '`make(chan int, 3)`':
      - 112 + 24 字节，一次分配
      - "`buf` 紧跟在 hchan 后面"
  - '`make(chan []int, 3)`':
      - 两次分配
      - 元素含指针，buf 要被 GC 单独盯着
  - '`ch <- v` 返回了':
      - 走了路径 ①、②，或在路径 ③ 被接收方唤醒后返回
      - ③ 时有缓冲则接收方取队头并补入待发值，无缓冲则直接交接；若被关闭唤醒则 panic
  - '`ch <- v` 卡住了':
      - 走了路径 ③
      - 值仍在发送方提供的地址（通常在栈上，也可能在堆上）；sendq 上只挂了记录地址的 sudog
  - '`close(ch)`':
      - 置 `closed`，清空 recvq/sendq 并唤醒等待者
      - 关闭操作不清除缓冲区里的元素，还能读完
```

```quiz
- q: 无缓冲 channel 上有「一块装元素的堆内存」吗？
  a: |
    没有。

    `make(chan int)` 只分配 hchan 那 112 字节，`makechan` 走的是 `mem == 0` 分支，`c.buf = c.raceaddr()` —— buf 指向 hchan 自己，一个元素槽位也没有。

    所以无缓冲 channel 的发送只有两条路：recvq 上有人等就**直接交接**（路径 ①），没人等就**挂起**（路径 ③）。它从来没有把数据存进缓冲区的动作。
- q: "`ch <- v` 卡住的时候，v 被复制进 channel 了吗？"
  a: |
    尚未由这次阻塞操作复制到缓冲区。发送方取得一个 sudog，`mysg.elem.set(ep)` 存的是 **v 的地址**，然后挂到 sendq 上 park。

    待发送值仍在发送方提供的地址，通常在栈上，也可能在堆上。如果等来接收方：无缓冲时直接从该地址拷到接收方的目标地址；缓冲区已满时先取队头，再把待发值填进同一个槽位。随后唤醒发送方。

    阻塞发送本身不为这个待发送值在 channel 中增加一份副本；有缓冲 channel 仍可能存着之前发送的元素。
- q: "`make(chan []int, 3)` 为什么比 `make(chan int, 3)` 多一次分配？"
  a: |
    因为元素里有指针。两个例子的容量都是 3，元素大小也都不是 0，所以都不会先走 `mem == 0` 分支。

    `makechan` 看 `elem.Pointers()`：不含指针时把 hchan 和 buf 放在**同一次** `mallocgc` 里（`hchanSize+mem`），buf 紧跟在 hchan 后面；含指针时分两次，让 GC 能单独扫描 buf 那块。

    本机实测：`chan int, 3` = 144 B / 1 次分配，`chan []int, 3` = 192 B / 2 次分配。
```
