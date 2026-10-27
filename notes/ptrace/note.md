## 00 · 原文：这次的四轮问答

`````popquote
label: 这次讨论的原文
sub: 4 轮问答 · 约 1 万字符
tone: violet
note: 原文照录；只把标题降了级，避免打乱本页目录，其余未改。原文里的 `[n](ai_center_quote)` 是原平台的引用标记，保留原样。
text: |
  问：“long ptrace(enum __ptrace_request request,
              pid_t pid,
              void *addr,
              void *data);

  以简单的方式来解释上面代码”
  答：“
  这是一条 **函数声明**，表示系统提供了一个叫 `ptrace` 的函数，用来让一个进程“观察、控制另一个进程”。它常用于调试器，例如 `gdb`。

  ```c
  long ptrace(enum __ptrace_request request,
              pid_t pid,
              void *addr,
              void *data);
  ```

  可以简单理解为：

  > 对进程 `pid` 执行一种由 `request` 指定的调试操作，操作时可能需要地址 `addr` 和额外数据 `data`。

  各部分含义：

  - `long`
    - 函数的返回值类型。
    - 成功时通常返回操作结果；失败时通常返回 `-1`，并设置 `errno` 来说明错误原因。

  - `ptrace`
    - 函数名称。
    - 名字来自 “process trace”，即“进程跟踪”。

  - `enum __ptrace_request request`
    - 要执行什么操作。
    - 例如：
      - 附加到某个进程；
      - 读取目标进程的内存；
      - 修改目标进程的寄存器；
      - 让暂停的目标进程继续运行等。

  - `pid_t pid`
    - 目标进程的进程号（PID）。
    - 例如进程号是 `1234`，就表示要操作进程 `1234`。

  - `void *addr`
    - 地址参数。
    - 某些操作中表示目标进程内存中的地址。
    - 如果当前操作不需要地址，通常传 `NULL` 或 `0`。

  - `void *data`
    - 附加数据。
    - 可能用于传入要写入的数据、保存读取结果的地址等。
    - 如果不需要，也可以传 `NULL`。

  例如，调试器要“附加”到 PID 为 `1234` 的进程，可能会调用类似：

  ```c
  ptrace(PTRACE_ATTACH, 1234, NULL, NULL);
  ```

  意思是：

  > 请求系统：让我开始调试/跟踪进程 `1234`。

  注意：`ptrace` 是 Linux/Unix 中较底层、权限敏感的接口，普通程序通常不需要直接使用它。
  ”

  问：“
  没太明白 enum __ptrace_request request 是什么意思

  ”

  答：“
  ```c
  enum __ptrace_request request
  ```

  可以拆成两部分理解：

  ```c
  enum __ptrace_request   // 参数的数据类型
  request                 // 参数的名字
  ```

  它的意思是：

  > `request` 是一个“操作类型”，用来告诉 `ptrace`：你到底想对目标进程做什么。

  ---

  ##### 1. `enum` 是什么？

  `enum` 是 C 语言里的“枚举类型”。

  可以把它理解成：**只能从一组预先定义好的选项中选择一个值**。

  例如：

  ```c
  enum Color {
      RED,
      GREEN,
      BLUE
  };
  ```

  这里 `Color` 类型的变量只能表示：

  ```c
  RED
  GREEN
  BLUE
  ```

  而不是随便写一个没有意义的内容。

  ---

  ##### 2. `__ptrace_request` 是什么？

  `__ptrace_request` 是 Linux 系统定义的一组 `ptrace` 操作选项。

  概念上大概像这样：

  ```c
  enum __ptrace_request {
      PTRACE_TRACEME,     // 声明“我要被调试”
      PTRACE_PEEKTEXT,    // 读取目标进程内存
      PTRACE_POKETEXT,    // 写入目标进程内存
      PTRACE_CONT,        // 让目标进程继续运行
      PTRACE_ATTACH,      // 附加到一个正在运行的进程
      PTRACE_DETACH       // 解除附加
  };
  ```

  实际 Linux 定义可能比这个更多，但理解上就是一组“操作命令”。

  所以：

  ```c
  enum __ptrace_request request
  ```

  就是：

  > `request` 变量保存一条 `ptrace` 命令，例如“附加进程”“读取内存”“继续执行”。

  ---

  ##### 3. 调用时的例子

  ```c
  ptrace(PTRACE_ATTACH, 1234, NULL, NULL);
  ```

  这里：

  ```c
  PTRACE_ATTACH
  ```

  就是传给 `request` 的值。

  完整意思是：

  | 参数 | 值 | 意义 |
  |---|---|---|
  | `request` | `PTRACE_ATTACH` | 要执行“附加/开始跟踪”操作 |
  | `pid` | `1234` | 要操作的进程号 |
  | `addr` | `NULL` | 这个操作不需要地址 |
  | `data` | `NULL` | 这个操作不需要额外数据 |

  也可以写成变量形式：

  ```c
  enum __ptrace_request request = PTRACE_ATTACH;

  ptrace(request, 1234, NULL, NULL);
  ```

  ---

  ##### 4. 类比

  把 `ptrace` 想成一个“遥控器函数”：

  ```c
  ptrace(操作命令, 目标进程, 地址, 附加数据);
  ```

  其中：

  ```c
  enum __ptrace_request request
  ```

  就相当于遥控器上的按钮，决定你按的是：

  - “暂停”
  - “继续”
  - “读取内存”
  - “写入内存”
  - “开始跟踪”

  例如：

  ```c
  ptrace(PTRACE_CONT, 1234, NULL, NULL);
  ```

  意思是：

  > 让进程 `1234` 继续运行。

  `__ptrace_request` 前面的两个下划线 `__` 通常表示它是系统库内部定义的类型名称；实际使用时，你更常接触的是其中的值，如 `PTRACE_ATTACH`、`PTRACE_CONT` 等。
  ”

  问：“
  其实这个函数挺有意思的，但是这个定义呢又让人摸不着头脑
  1、比如第三个参数，地址，哪里的地址，哪个进程的地址，栈地址还是堆地址，要地址来干什么
  2、data，这个data是调试进程用户态上的数据还是内核里的数据
  3、比如我执行了PTRACE_PEEKTEXT，然后呢，返回一个long，然后呢，我不是要读取内存吗，读到哪里去了，这个函数都没有交代

  上面的你简单的方式来解释
  ”

  答：“
  你的疑惑非常正常，因为 `ptrace` 的 4 个参数并不是固定含义，而是：

  > 第一个参数 `request` 决定后面三个参数分别是什么意思。

  它像一个“万能接口”，不同命令对 `addr` 和 `data` 的解释不同，所以单看函数声明确实很难理解。

  ---

  ##### 1. `addr` 是哪里的地址？

  对于读取/修改内存的操作，例如：

  ```c
  PTRACE_PEEKTEXT
  PTRACE_PEEKDATA
  PTRACE_POKETEXT
  PTRACE_POKEDATA
  ```

  `addr` 通常是：

  > 被调试进程 `pid` 的虚拟内存地址。

  例如：

  ```c
  ptrace(PTRACE_PEEKDATA, 1234, (void *)0x7fff12345678, NULL);
  ```

  意思是：

  > 从进程 `1234` 的虚拟地址 `0x7fff12345678` 读取数据。

  这个地址可以属于：

  - 代码区；
  - 栈；
  - 堆；
  - 动态库；
  - 其他已经映射的内存区域。

  所以它并不固定是栈地址或堆地址，具体是什么取决于你传入的地址。

  但并非所有命令都使用 `addr`。例如某些命令中它会被忽略：

  ```c
  ptrace(PTRACE_ATTACH, pid, NULL, NULL);
  ```

  这里不需要内存地址，所以传 `NULL`。

  ---

  ##### 2. `data` 是谁的数据？

  通常，调用 `ptrace` 的进程叫：

  - **调试进程**：tracer，例如 `gdb`
  - **被调试进程**：tracee，例如你正在调试的程序

  `data` 参数由调试进程传给内核，但它的具体含义同样由 `request` 决定。

  ###### 情况一：作为调试进程里的缓冲区地址

  例如读取目标进程的寄存器：

  ```c
  struct user_regs_struct regs;

  ptrace(PTRACE_GETREGS, pid, NULL, &regs);
  ```

  这里：

  ```c
  &regs
  ```

  是调试进程自己的用户态地址。

  内核会把目标进程的寄存器信息复制到调试进程的 `regs` 变量里：

  ```text
  被调试进程的寄存器
          ↓
         内核
          ↓
  调试进程的 regs 变量
  ```

  ###### 情况二：直接携带一个数值

  例如向目标进程写入一个机器字：

  ```c
  long value = 123;

  ptrace(PTRACE_POKEDATA, pid, target_addr, (void *)value);
  ```

  虽然参数类型写的是 `void *`，这里的 `data` 实际上被当成一个数值使用。

  这看起来很别扭，是因为 `ptrace` 是一个历史悠久的通用接口，用一个 `void *` 兼容了多种用途。

  ---

  ##### 3. `PTRACE_PEEKTEXT` 读到的数据在哪里？

  对于：

  ```c
  PTRACE_PEEKTEXT
  PTRACE_PEEKDATA
  ```

  读到的数据直接通过 `ptrace` 的返回值返回。

  例如：

  ```c
  errno = 0;

  long value = ptrace(
      PTRACE_PEEKTEXT,
      pid,
      target_addr,
      NULL
  );

  if (value == -1 && errno != 0) {
      perror("ptrace");
  }
  ```

  这里从目标进程读取的数据放进了：

  ```c
  value
  ```

  通常一次读取 `sizeof(long)` 个字节：

  - 64 位系统通常是 8 字节；
  - 32 位系统通常是 4 字节。

  所以可以理解为：

  ```c
  long value = 目标进程中从 target_addr 开始的一小块数据;
  ```

  `PTRACE_PEEKTEXT` 中的 `data` 参数一般不使用，因此传 `NULL`。

  ---

  ##### 一个完整例子

  ```c
  errno = 0;

  long value = ptrace(
      PTRACE_PEEKDATA,  // 做什么：读取内存
      pid,              // 读哪个进程
      target_addr,      // 读目标进程的哪个地址
      NULL              // 这个操作不需要 data
  );

  if (value == -1 && errno != 0) {
      perror("ptrace");
  } else {
      printf("读取结果：0x%lx\n", value);
  }
  ```

  可以翻译成一句话：

  > 请内核从进程 `pid` 的虚拟地址 `target_addr` 中读取一个 `long` 大小的数据，并通过返回值交给我。

  ---

  ##### 为什么它的定义这么让人摸不着头脑？

  因为它实际上把很多不同功能塞进了同一个函数：

  ```c
  ptrace(命令, 目标进程, 参数1, 参数2);
  ```

  更接近这样的思维：

  | `request` | `addr` 的含义 | `data` 的含义 | 结果在哪里 |
  |---|---|---|---|
  | `PTRACE_PEEKDATA` | 目标进程地址 | 不使用 | 函数返回值 |
  | `PTRACE_POKEDATA` | 目标进程地址 | 要写入的值 | 返回成功/失败 |
  | `PTRACE_GETREGS` | 不使用 | 调试进程的缓冲区地址 | `data` 指向的变量 |
  | `PTRACE_CONT` | 通常不使用 | 要传递的信号编号 | 返回成功/失败 |
  | `PTRACE_ATTACH` | 不使用 | 不使用 | 返回成功/失败 |

  所以，不能单独问：

  > `addr` 和 `data` 是什么意思？

  必须问：

  > 在某个具体的 `request` 下，`addr` 和 `data` 分别是什么意思？

  最后特别注意：读取结果也可能真的等于 `-1`，所以不能只根据返回值是否为 `-1` 判断失败，还需要同时检查 `errno`。
  ”

  问：“
  简单的方式说明
  1、调试进程怎么拿到addr的，它又没有目标进程的页表 ，而且，就算它拿到了地址，它怎么知道这个地址里放的什么东西，放的东西是不是它想要的，就算拿到了想要的，怎么知道能一次性拿回来，是不是得仿佛调用
  2、PTRACE_ATTACH 是什么意思，拿地址上的值，拿寄存器我还能理解，你这个“附加”是什么动作，就算附加成功了又能怎样，目标进程是一直执行的，你怎么读取它实时的状态做出反应

  诶呀，好多不懂，希望你能像讲故事一样娓娓道来
  ”

  答：“
  可以把 **调试进程（比如 GDB）** 想成一个侦探，把 **目标进程** 想成一栋正在运转的楼。

  - 目标进程有自己的房间编号、自己的布局、自己的物品；
  - 调试进程站在楼外，不能直接走进去翻东西；
  - 但它可以向 **内核这个物业管理员** 申请“调试权限”；
  - `ptrace` 就是侦探和物业之间的一套办事窗口。

  ---

  #### 1. 调试进程没有目标进程的页表，怎么知道 `addr`？

  你的想法是对的：

  > 调试进程不能拿自己的地址去访问目标进程的内存。

  例如同一个数值地址：

  ```text
  0x7fff12340000
  ```

  在调试进程中，可能根本没映射；在目标进程中，却可能是它栈上的一块内存。

  关键是：**调试进程不需要拥有目标进程的页表。**

  它只是把“房间号”告诉内核：

  ```text
  请读取 PID=1234 进程里，虚拟地址 0x7fff12340000 的内容。
  ```

  内核知道 PID `1234` 对应哪套页表，于是用**目标进程自己的地址空间**去翻译这个地址、读取对应内存，再把结果交给调试进程。

  所以：

  ```c
  ptrace(PTRACE_PEEKDATA, 1234, (void *)addr, NULL);
  ```

  中的 `addr` 是：

  > 按照 **PID 1234 的虚拟地址空间**解释的地址，绝不是按调试进程自己的地址空间解释。

  `ptrace` 本来就是让一个进程在内核许可和检查下，观察另一进程的内存、寄存器与执行状态的接口。[6](ai_center_quote)

  ---

  ##### 那调试器最开始从哪里获得地址？

  侦探不会凭空知道“重要文件放在 501 房”。地址一般来自下面几种线索。

  ###### 情况 A：程序有调试信息

  假设你自己编译程序：

  ```c
  int score = 100;
  ```

  并加上调试选项：

  ```bash
  gcc -g app.c -o app
  ```

  生成的可执行文件会带有调试信息，告诉 GDB：

  ```text
  变量 score 在哪里；
  函数 main 在哪里；
  某行源代码对应哪条机器指令；
  某个局部变量相对栈指针的偏移是多少。
  ```

  于是你可以说：

  ```gdb
  p score
  ```

  GDB 根据调试信息和当前寄存器，算出 `score` 此刻所在的目标进程地址，再通过 `ptrace` 读取它。

  ---

  ###### 情况 B：先看进程的“楼层平面图”

  Linux 为每个进程提供：

  ```text
  /proc/<pid>/maps
  ```

  里面记录该进程有哪些内存区域，例如：

  ```text
  代码段在哪
  堆在哪
  栈在哪
  动态库在哪
  ```

  `/proc/<pid>/maps` 反映的是**目标进程**的地址空间布局；而 `/proc/<pid>/mem` 可按指定偏移访问目标进程对应地址的内存。[2](ai_center_quote)

  例如概念上：

  ```text
  555555554000-555555556000   程序代码
  7ffffffde000-7ffffffff000   栈
  ```

  这至少让调试器知道：

  > 哪些地址有效、哪些是栈、哪些是堆、哪些来自动态库。

  ---

  ###### 情况 C：从寄存器和运行过程里顺藤摸瓜

  比如程序刚调用一个函数，寄存器可能保存着参数地址；栈上可能保存着局部变量、返回地址；一个对象里可能保存着指针，指向另一块堆内存。

  调试器先读取寄存器：

  ```text
  栈指针 RSP = 0x7fffffffd000
  ```

  然后读取目标进程栈附近的内存；发现一个指针：

  ```text
  0x5555555592a0
  ```

  再去读这个地址，逐层追踪。

  这就像侦探先拿到“你现在位于 10 楼”，然后翻桌上的便签，找到“文件在仓库 3”，再去仓库 3 查看。

  ---

  ##### 地址里的东西，调试器怎么知道它是什么？

  这里有一个很关键的事实：

  > **只读内存本身，调试器只能得到字节，不会天然知道这些字节的“含义”。**

  假设读回 8 字节：

  ```text
  01 00 00 00 00 00 00 00
  ```

  这可能是：

  - 整数 `1`；
  - `bool` 值 `true`；
  - 枚举值；
  - 指针的一部分；
  - 某个结构体的前几个字段；
  - 一条机器指令的数据。

  **字节没有自带标签。**

  所以“它是什么”主要依赖：

  1. **源代码和调试信息**：知道变量叫 `score`，类型是 `int`；
  2. **程序二进制与符号表**：知道函数、全局变量的大概位置；
  3. **调用约定与寄存器规则**：知道参数通常在哪些寄存器；
  4. **人工分析**：没有符号时，只能猜测、反汇编、结合上下文判断。

  这也是为什么调试自己带 `-g` 编译的程序时，GDB 能展示：

  ```gdb
  p user.name
  ```

  而面对没有符号信息的陌生程序时，往往只能看到：

  ```text
  0x7fff...:  0x00000001
  ```

  ---

  ##### 能不能一次读完？

  通常**不能，也不应该假设能一次读完**。

  传统的：

  ```c
  PTRACE_PEEKDATA
  ```

  一次通常只取一个 `long`：

  - 64 位系统一般是 8 字节；
  - 32 位系统一般是 4 字节。

  如果想读取 100 字节，调试器就要反复读取：

  ```text
  读 addr + 0
  读 addr + 8
  读 addr + 16
  ……
  ```

  直到读完 100 字节，或遇到无效地址、权限问题等。

  所以你的“是不是得反复调用”完全正确：**传统 `PTRACE_PEEK*` 的确通常需要循环调用。**

  ---

  #### 2. `PTRACE_ATTACH` 到底是什么？

  继续用侦探和大楼的故事。

  目标进程原本正在运行：

  ```text
  运行 → 运行 → 运行 → 运行……
  ```

  调试进程如果想认真查看它，不能一边让它高速变化，一边随手读取；否则刚看完一个变量，它可能已经变了，寄存器和内存也不再对应同一个时刻。

  于是调试器发出：

  ```c
  ptrace(PTRACE_ATTACH, pid, NULL, NULL);
  ```

  可以理解为：

  > 内核，请把这个正在运行的进程交给我调试，并先让它停下来。

  `PTRACE_ATTACH` 会把目标进程变成当前调试进程的 tracee（被跟踪者），并向它发送 `SIGSTOP`；但函数返回时它未必已经停止，因此还需要用 `waitpid()` 等待真正的停止事件。[6](ai_center_quote)

  概念流程是：

  ```text
  目标进程：        正在运行
  调试器：          发出 PTRACE_ATTACH
  内核：            向目标进程发送 SIGSTOP
  目标进程：        停止
  调试器：          waitpid() 得知“它停了”
  调试器：          读取寄存器、栈、内存等
  ```

  所以“附加”不是读取一个值，而是：

  > 建立“我正在调试它”的关系，并让内核把它的停止、信号、断点等事件通知给调试器。

  调试器如 GDB 会使用 `ptrace` 来控制被调试进程的执行，以及检查或修改其内存和寄存器。[2](ai_center_quote)

  ---

  ##### 附加成功以后能做什么？

  目标停住后，调试器就获得一个相对一致的“现场快照”。

  可以查看：

  ```text
  当前执行到哪条指令
  各寄存器是什么
  当前调用栈是什么
  当前线程有哪些
  变量当前值是什么
  某段内存内容是什么
  ```

  例如 GDB：

  ```gdb
  attach 1234
  ```

  之后可以：

  ```gdb
  bt        # 查看调用栈
  info reg  # 查看寄存器
  p value   # 查看变量
  x/16gx 地址 # 查看内存
  ```

  GDB 可以通过 `attach pid` 附加到已有进程，并在附加后控制其执行。[3](ai_center_quote)

  ---

  #### 3. “目标进程一直执行”，怎么实时观察并反应？

  核心答案是：

  > 调试器不是一直盯着一个高速变化的进程；它通过“让进程停下 → 查看状态 → 决定下一步 → 再让它运行”的循环工作。

  流程像这样：

  ```text
  ① 进程运行
  ② 出现调试器关心的事件
  ③ 内核暂停目标进程，并通知调试器
  ④ 调试器读取现场、做判断
  ⑤ 调试器要求它继续执行
  ⑥ 回到①
  ```

  ---

  ##### 什么事件会让它停下来？

  常见有：

  - 刚刚 `PTRACE_ATTACH`；
  - 命中断点；
  - 收到信号，例如 `SIGSEGV`（段错误）；
  - 单步执行完一条机器指令；
  - 进入或退出系统调用；
  - 调试器主动要求中断它。

  例如你给函数 `foo` 设置断点：

  ```text
  进程运行
     ↓
  执行到 foo 的入口
     ↓
  触发断点，进程暂停
     ↓
  GDB 得到通知
     ↓
  你查看参数、变量、调用栈
     ↓
  continue
     ↓
  进程继续运行
  ```

  于是所谓“实时”不是每个 CPU 时钟周期都查看，而是：

  > 在关键事件发生时，暂停并检查一致的状态。

  ---

  ##### 如果它一直运行，能直接读取吗？

  有些情况下可以尝试读取，但你可能看到不一致的数据：

  ```text
  刚读完变量 A
  目标进程立刻修改了变量 B
  你再读 B
  ```

  于是 A、B 并不属于同一个时刻的状态。

  因此调试器经常采用“停住再读”的方式。尤其对于多个线程的程序，情况更复杂：你停住一个线程，不代表其他线程一定也同时停住；调试器需要额外处理线程状态。`ptrace` 的附加和后续命令本质上是按线程进行的。[6](ai_center_quote)

  ---

  #### 一句话总结

  ```text
  PTRACE_ATTACH：
  “内核，把这个进程交给我调试，先让它停住，并把它之后的重要事件告诉我。”

  addr：
  “按目标进程自己的虚拟地址空间解释的地址。”

  调试器如何懂地址中的内容：
  “靠调试信息、符号、寄存器、内存布局和上下文；原始内存只有字节，自己不会说明类型。”

  实时调试：
  “不是永远盯着它跑，而是在断点、信号、单步等事件处暂停它，查看现场、做决定，再恢复运行。”
  ```
  ”
`````


上面是这次讨论的原文。四轮问答从一条函数声明开始，一路问到「ATTACH 到底是什么」。原文已经说清了两件最关键的事：`request` 决定另外三个参数的含义，`addr` 按 tracee 的地址空间解释。

这篇在它上面补三层原文没有展开的东西：内核里实际走的那条路径、GDB 和 strace 这类真实工具的做法、以及这条路的边界。凡是原文的说法需要补充或纠正的地方，都会在对应章节里标出来。

## 01 · 一个函数，四个参数，为什么像在猜谜

先看声明本身：

```c
long ptrace(enum __ptrace_request request,
            pid_t pid,
            void *addr,
            void *data);
```

`ptrace` 的名字来自 process trace。它让一个进程（tracer）观察、控制另一个进程（tracee），读写它的内存和寄存器，让它停、让它走。GDB 的断点、strace 的系统调用记录，底下都是这套接口。

四个参数让人摸不着头脑，是因为它们没有固定含义。`request` 是动词，`pid` 是宾语，`addr` 和 `data` 是这次动作用到的两个槽位。同一个槽位，在一条命令里是目标地址，在另一条命令里是缓冲区指针，在第三条命令里干脆被忽略。

| `request` | `addr` | `data` | 结果在哪里 |
|---|---|---|---|
| `PTRACE_ATTACH` | 不用 | 不用 | 返回值 `0` / `-1` |
| `PTRACE_PEEKDATA` | tracee 的虚拟地址 | C 层传 `NULL`；内核实际把结果写到 glibc 的临时变量（见 §04） | 返回值：一个机器字 |
| `PTRACE_POKEDATA` | tracee 的虚拟地址 | 要写入的那个字 | 返回值 `0` / `-1` |
| `PTRACE_GETREGSET` | `NT_PRSTATUS` 之类的选择子 | tracer 里 `struct iovec *`（缓冲区 + 长度） | `iovec` 指向的缓冲区 |
| `PTRACE_CONT` | 不用 | 要注入的信号编号（`0` = 不注入） | 返回值 `0` / `-1` |
| `PTRACE_SETOPTIONS` | 不用 | `PTRACE_O_*` 位掩码 | 返回值 `0` / `-1` |
| `PTRACE_PEEKUSER` | **USER 区的偏移**，不是 tracee 地址 | 不用 | 返回值：一个机器字 |

所以不能单独问「`addr` 和 `data` 是什么意思」。必须先问：在哪个 `request` 下？

==参数的含义由 `request` 决定，函数签名只是四个通用的槽位。==

这些命令在头文件里就是一组数字。`glibc` 的 `sys/ptrace.h` 把它们声明成 `enum __ptrace_request`，内核的 `include/uapi/linux/ptrace.h` 里是同一组数字的 `#define`：

```c
#define PTRACE_TRACEME     0
#define PTRACE_PEEKTEXT    1
#define PTRACE_PEEKDATA    2
#define PTRACE_POKEDATA    5
#define PTRACE_CONT        7
#define PTRACE_SINGLESTEP  9
#define PTRACE_ATTACH     16
#define PTRACE_DETACH     17
#define PTRACE_SYSCALL    24

#define PTRACE_SETOPTIONS 0x4200
#define PTRACE_GETREGSET  0x4204
#define PTRACE_SEIZE      0x4206
#define PTRACE_INTERRUPT  0x4207
```

0 到 24 这一段沿用了早期 Unix 的编号方式，`0x42xx` 是后来加「架构无关命令」时开的一段。看到一个陌生请求号，先查它属于哪一段，通常就知道它大概是老接口还是新接口。

```callout
tone: amber
icon: ℹ
text: |
  `glibc` 头文件里 `ptrace` 其实是**可变参数**声明：只有第一个参数的类型是固定的。
  `ptrace(2)` 的建议是**永远传满四个参数**，用不到的写 `0L` 或 `(void *)0`。
```

## 02 · 全局地图：两个进程，中间隔着内核

现在把四个参数放进真实的位置里。这张图有三层：左边是 tracer 的用户态，中间是内核，右边是 tracee 的用户态。内核里又有一份 tracee 的「档案」，每次操作都要先按 `pid` 找到它。

```arch
svg: ptrace-map
caption: |
  从 `ptrace_request()` 进内核：找 `task`、读寄存器走上面；读内存走下面的 `ptrace_access_vm()`。图里只画静态归属，ATTACH 的先后顺序在 §05 的时序图。
maxScale: 1
frames:
  - id: tracer
    boundary: 0
    kind: logical
    label: tracer 用户态 · 它是另一个进程
    detail: |
      tracer 有自己的地址空间和自己的页表。它读 tracee 的内存时，用的不是这张页表。
  - id: kernel
    boundary: 1
    kind: classification
    label: 内核态 · 所有请求先到这里
    detail: |
      用户态只能通过系统调用进来。命令的分发、权限检查、地址翻译都在这一层。
  - id: archive
    boundary: 2
    parent: kernel
    kind: contains
    label: tracee 的内核侧档案 · 按 pid 定位
    detail: |
      这些对象属于 tracee，不属于 tracer。tracer 只是拿着 pid 来借阅。
  - id: tracee
    boundary: 3
    kind: logical
    label: tracee 用户态 · 另一张地址空间
    detail: |
      这是 tracee 自己看到的地址空间。同一个 `0x7fff…` 在 tracer 里可能根本没有映射。
bodies:
  tracer:
    badge: 循环里的两步
    rows:
      - { k: "pid", v: "1234（内核眼里是 TID）" }
      - { k: "等", v: "waitpid(pid, &st, __WALL)" }
      - { k: "看", v: "WIFSTOPPED → 读；WIFEXITED → 收工" }
    note: ptrace 只是它循环里的一步
  tbuf:
    rows:
      - { k: "regs", v: "struct user_regs_struct" }
      - { k: "buf", v: "char buf[4096]" }
    note: data 传地址时，内核把结果写到这里
  dispatch:
    code: long ptrace(request, pid, addr, data);
    rows:
      - { k: "request", v: "这次要做什么（命令号）" }
      - { k: "pid", v: "哪条线程（TID）" }
      - { k: "addr / data", v: "由 request 解释" }
    note: 返回值：PEEK 的字 / 0 / -1
  access:
    rows:
      - { k: "①", v: "get_task_mm(task)" }
      - { k: "②", v: "access_remote_vm(mm, addr, …)" }
      - { k: "③", v: "拷进内核缓冲，再交给 tracer" }
    note: 只在 ptrace-stop 里可用（否则 ESRCH）
  task:
    badge: 按 pid 找到
    rows:
      - { k: "ptrace", v: "PT_PTRACED / PT_SEIZED（内核标记）" }
      - { k: "parent", v: "= tracer（ptrace_link）" }
      - { k: "state", v: "TASK_TRACED（停住）" }
    note: mm 指针指向同一份 mm_struct
  regs:
    rows:
      - { k: "rip", v: "下一条要执行的指令" }
      - { k: "rsp", v: "栈顶" }
      - { k: "rax", v: "返回值 / 系统调用号" }
    note: 运行时不在这里；停下才保存
  mm:
    rows:
      - { k: "owner", v: "task->mm（线程组共享）" }
      - { k: "页表", v: "根在 mm 里，逐级翻译 VA" }
      - { k: "范围", v: "只描述这一个进程" }
    note: 内核拿它替 tracee 翻地址
  vas:
    badge: 由 mm 描述
    stack:
      - { label: 栈, mark: "0x7fff…", tone: blue }
      - { label: 动态库, mark: "0x7f…" }
      - { label: 堆, mark: "0x5555…" }
      - { label: 代码段, mark: "0x5555…", tone: amber }
    note: addr 落在哪一段，由你传的值决定
parts:
  tracer:
    label: tracer · 调试器进程
    sub: gdb / strace
    detail: |
      它有自己的地址空间和页表。读 tracee 时，它只把 `pid` 和一个数字地址交给内核，自己不碰目标内存。
  tbuf:
    label: tracer 自己的缓冲区
    sub: data 指向这里
    detail: |
      当 `request` 的意思是「把结果给我」时，`data` 是这块 tracer 用户态内存里的地址。
  dispatch:
    label: ptrace_request()
    sub: 内核里的总入口
    detail: |
      按 `request` 分发。大多数命令要求 tracee 已经停在 ptrace-stop，否则返回 `ESRCH`。
  access:
    label: ptrace_access_vm()
    sub: 内存类请求的必经之路
    detail: |
      先 `get_task_mm()` 拿到 tracee 的 mm，再 `access_remote_vm()` 用那张页表翻译 `addr`。读写的临时缓冲在内核里，最后由 `put_user` 交给 tracer。
  task:
    label: tracee 的 task_struct
    sub: 一条线程
    detail: |
      `ptrace_link()` 会把它 `parent` 指针暂时改成 tracer；`state` 在停住时是 `TASK_TRACED`。
  regs:
    label: 停住时的寄存器
    sub: struct pt_regs
    detail: |
      用户寄存器在停住时保存在内核里的 `pt_regs`；`PTRACE_GETREGS` 把它们拷到 tracer 的 `data` 缓冲区。
  mm:
    label: mm_struct + 页表
    sub: tracee 的地址空间描述
    detail: |
      每个进程（线程组）一份。页表根和 VMA 集合都挂在它名下；tracee 换了地址空间，换的是它。
  vas:
    label: tracee 的虚拟地址空间
    sub: 代码 / 堆 / 栈 / 动态库
    detail: |
      这些段由 `mm` 描述。`addr` 只是一个数字；它落在哪一段，取决于你传的值。
tours:
  - id: peek
    label: 一次 PEEKDATA 走哪条路
    steps:
      - { at: [tracer, dispatch], text: "调试器把 `request`、`pid`、`addr` 交给内核。此时 tracee 必须已经停住。" }
      - { at: [access], text: "`ptrace_access_vm()` 先按 pid 找到 task，再取它的 mm。" }
      - { at: [mm], text: "用 tracee 的页表翻译 `addr`，不是 tracer 的。" }
      - { at: [vas], text: "地址落在哪一段，由 `addr` 的值决定：栈、堆、代码段或库。" }
      - { at: [dispatch, tbuf], text: "读到的字先回到内核缓冲，再经 `data` 指针写进 tracer；glibc 把它做成返回值。" }
  - id: regs
    label: 读一次寄存器
    steps:
      - { at: [tracer, dispatch], text: "`PTRACE_GETREGSET` 带着 `NT_PRSTATUS` 和一块 iovec 进来。" }
      - { at: [task], text: "按 pid 找到 task；停住时它的用户寄存器在 `pt_regs` 里。" }
      - { at: [regs, tbuf], text: "内核把 `pt_regs` 拷进 tracer 的缓冲区。`data` 是这块缓冲区的地址。" }
  - id: why
    label: 为什么 tracer 不需要 tracee 的页表
    steps:
      - { at: [tracer], text: "tracer 手里只有 pid 和一个数字地址。" }
      - { at: [access, mm], text: "翻译发生在内核里，用的是 tracee 的 mm。" }
      - { at: [vas], text: "所以同一个数字，在 tracer 和 tracee 里可以是完全不同的东西。" }
```

这张图只解决「谁在哪、谁属于谁」。真正让 tracee 停下来的顺序，是下一节之后的事。

## 03 · addr 是谁的地址：内核替它翻页表

原文说的是对的：`addr` 是 tracee 的虚拟地址。它没有展开的是，tracer 没有这张页表，为什么还能读。

因为读的动作根本不发生在 tracer 里。`ptrace` 是一句请求，翻译由内核完成。内核按 `pid` 找到 tracee 的 `task_struct`，取出它的 `mm_struct`，再用这张 mm 里的页表把 `addr` 翻成物理页。

```c
/* kernel/ptrace.c，删掉了错误处理 */
int ptrace_access_vm(struct task_struct *tsk, unsigned long addr,
                     void *buf, int len, unsigned int gup_flags)
{
    struct mm_struct *mm = get_task_mm(tsk);
    ...
    ret = access_remote_vm(mm, addr, buf, len, gup_flags);
    mmput(mm);
    return ret;
}

/* PEEKDATA 最后落到这里：读一个 unsigned long，再写到 tracer 的 data 指针 */
int generic_ptrace_peekdata(struct task_struct *tsk, unsigned long addr,
                            unsigned long data)
{
    unsigned long tmp;
    int copied = ptrace_access_vm(tsk, addr, &tmp, sizeof(tmp), FOLL_FORCE);
    if (copied != sizeof(tmp))
        return -EIO;
    return put_user(tmp, (unsigned long __user *)data);
}
```

三步：按 pid 找 task，取它的 mm，用这张 mm 翻译地址。`access_remote_vm()` 里走的是 `get_user_pages` 那一套，和内核读自己的用户态内存是同一条路，只是换了一张页表。

```callout
tone: blue
icon: 🧭
text: |
  ==tracer 不需要拥有 tracee 的页表。==

  它交出去的是一个数字。`mm` 在内核里，属于 tracee；翻译也在内核里发生。
  这就是为什么 GDB 不需要先把目标进程的页表「拿过来」。
```

`addr` 可以落在任何一段已经映射的区域：栈、堆、代码段、动态库、`mmap` 出来的匿名区。它不「是」栈地址或堆地址；它就是一个虚拟地址，落在哪一段由你传的值决定。

```memmap
title: tracee 的一张虚拟地址空间
sub: Linux x86-64 · 示意布局
high: "0x7fff_ffff_ffff"
low: "0x0000_0000_0000"
segments:
  - { label: 栈, sub: "局部变量、返回地址", tone: blue, size: 2.4, dir: down, addr: "0x7fff…", mark: "addr 可以指这里" }
  - { label: 动态库 / vdso, sub: "libc、ld.so、内核提供的 vdso", size: 1.8, addr: "0x7f…", mark: "addr 可以指这里" }
  - { label: 堆, sub: "malloc / new", tone: violet, size: 2.8, dir: up, addr: "0x5555…", mark: "addr 可以指这里" }
  - { label: 代码段, sub: "只读、可执行；断点的 0xCC 写在这里", tone: green, size: 1.6, addr: "0x5555…", mark: "addr 可以指这里" }
note: 一张图里只有一张地址空间。**同一个 `0x7fff…` 在 tracer 里可能是另一块内存，也可能根本没映射。**
```

同一个数字，在两个进程里可以是完全不同的东西。这不是 `ptrace` 的特殊规则，而是虚拟内存的常态：

```compare
first: 同一个地址 0x7fff12340000
head: [在 tracer 里, 在 tracee 里]
rows:
  - 它是什么:
      - "可能是 tracer 自己栈上的某个变量，也可能是空的"
      - "tracee 栈上的某个变量（如果这个地址在它的 maps 里）"
  - 谁翻译它:
      - "CPU 用 tracer 的页表（x86 上由 CR3 指向）"
      - "内核用 tracee 的 mm 里那套页表"
  - 翻译失败会怎样:
      - "tracer 自己收到 SIGSEGV"
      - "`ptrace` 返回 `-1`，`errno` 是 `EIO` 或 `EFAULT`"
```

那么地址最初是从哪来的？原文给了三条线索，这里补上它们各自能回答什么、不能回答什么：

```compare
first: 线索
head: [它告诉你什么, 它不告诉你什么]
rows:
  - "调试信息（DWARF，`gcc -g`）":
      - "变量叫什么、什么类型、位置表达式；某条指令对应哪一行源码"
      - "变量此刻的值；运行时才分配的地址"
  - "`/proc/<pid>/maps`":
      - "哪些地址段被映射、权限、文件偏移；栈和堆大致在哪"
      - "哪块内存里放的是哪个变量"
  - "符号表（`nm` / `objdump`）":
      - "函数、全局变量的名字和链接地址"
      - "类型信息；局部变量；PIE（位置无关可执行文件）的加载基址（要从 maps 里取）"
  - "寄存器和栈":
      - "运行到这一刻，参数、栈顶、返回地址是什么"
      - "这些值是整数、指针，还是碰巧长得像指针的字节"
```

原文说得最准的是这一句：**字节没有自带标签**。`01 00 00 00 00 00 00 00` 可能是整数 `1`、`true`、枚举值、结构体的第一个字段，也可能是一条指令的一部分。GDB 能把 `p user.name` 显示成人能读的东西，是因为它在读内存之外，还读了 DWARF 里的类型和位置信息；面对一个没有符号的陌生程序，它也只能给你一串十六进制。

## 04 · PEEKDATA 的值到底去哪了

原文说「读到的数据通过返回值返回」。这句话在 C 语言这一层是对的，但它遮住了 `data` 参数真正的用途。

在系统调用这一层，`PEEKDATA` 的 `data` 是一个**指针**：内核把读到的机器字写到这个地址。`glibc` 的包装函数在中间放了一个临时变量，把内核写进来的值再作为返回值交给你。所以你看到的 `long value = ptrace(...)`，底下是这么一趟：

```text
tracee 的页
   │  get_user_pages + copy
   ▼
内核里的 unsigned long tmp
   │  put_user(tmp, (unsigned long __user *)data)
   ▼
glibc 包装函数里的临时变量
   │  return tmp
   ▼
你的 long value
```

`ptrace(2)` 的 NOTES 把这件事写得很直白：在系统调用层，`PEEKTEXT` / `PEEKDATA` / `PEEKUSER` 把结果存放在 `data` 指向的地址，返回值只表示成功或失败；是 `glibc` 的包装函数把它变成了「结果从返回值出来」。这也解释了为什么 `PEEKDATA` 的 `data` 看起来「不用」，内核却仍然要读它。

顺带一个必须记住的坑：

```c
errno = 0;
long value = ptrace(PTRACE_PEEKDATA, pid, addr, NULL);

if (value == -1 && errno != 0) {
    perror("ptrace");
} else {
    printf("读到的字：0x%lx\n", value);
}
```

`-1` 是一个合法的数据值（八个字节全是 `0xff`）。只判断 `value == -1` 会把一次成功的读取当成失败。

一次能读多少？`PEEKDATA` 一次只搬一个机器字。64 位 Linux 上是 8 字节（内核里就是 `sizeof(unsigned long)`），32 位上是 4 字节。读 100 字节要 13 次：前 12 次各 8 字节，最后一次从偏移 96 开始读 8 字节，只用前 4 个。

```c
size_t left = 100, off = 0;
while (left) {
    errno = 0;
    long w = ptrace(PTRACE_PEEKDATA, pid, (char *)addr + off, NULL);
    if (w == -1 && errno) break;
    size_t n = left < sizeof(w) ? left : sizeof(w);
    memcpy(buf + off, &w, n);
    off += n;
    left -= n;
}
```

!!最后几个字节如果正好贴着映射边界，最后一次 8 字节读可能跨进未映射页而失败 —— 哪怕你要的那 4 个字节本身是有效的。!!

这就是为什么真实的调试器不这么读内存。

```compare
first: 读法
head: [一次搬多少, 要不要停住, 权限, 谁在用]
rows:
  - "`PTRACE_PEEKDATA`":
      - "一个机器字（64 位 8 字节）"
      - "要，必须在 ptrace-stop 里"
      - "已 attach 的 tracer"
      - "老调试器；理解 `data` 用"
  - "`/proc/<pid>/mem`":
      - "一次 `read()` 想读多少读多少"
      - "不用；线程在跑也能读"
      - "打开时做 `PTRACE_MODE_ATTACH` 检查"
      - "==GDB 首选==；能写只读页，用来下断点"
  - "`process_vm_readv`":
      - "一次多个 iovec，按页搬"
      - "不用"
      - "`PTRACE_MODE_ATTACH_REALCREDS`"
      - "批量读写的工具；写只读页不行"
```

GDB 的源码里有一段很清楚的说明：它**优先用 `/proc/PID/mem`**，只有在 `/proc/PID/mem` 不可写时才退回 `PTRACE_PEEKTEXT/POKETEXT`。理由列了四条，其中三条正好回答这篇的问题：

- 一次 `read`/`write` 就搬一段，不用一个词一个词地敲 `ptrace`。
- `/proc/PID/mem` 能写只读页，GDB 需要这个能力来放断点指令；`process_vm_writev` 不行。
- 所有线程都在跑的时候也能访问内存；`PTRACE_PEEK*` 则必须传一个停住的 tid。

所以原文那句「停住再读」是经典路径，不是今天的全部。**要读得一致，仍然要停住；只是想读，现代调试器可以在目标运行时读。**

```callout
tone: amber
icon: ⚠
text: |
  运行时读到的内容可能不属于同一个时刻：刚读完变量 A，目标进程就改了变量 B，你再读 B。
  多个线程时更明显。要一份一致的现场，还是得让相关线程停下来。
```

## 05 · ATTACH 不是「读一个值」，是把一条线程挂到调试器名下

原文把 ATTACH 解释成「让目标停下」，方向对，但动作不止这一下。它做了三件事：检查权限、在内核里建立一条「谁在跟踪谁」的关系、再让目标停住。停下来只是结果，关系才是后面所有命令能用的前提。

```seq
grid: true
participants:
  - { id: g, label: tracer · gdb, tone: green }
  - { id: k, label: 内核, tone: violet }
  - { id: t, label: tracee · 一条线程, tone: blue }
segments:
  - { from: 1, to: 6, label: attach 的握手 }
  - { from: 7, to: 9, label: 开始干活 }
messages:
  - { from: g, to: k, label: "PTRACE_ATTACH(pid)", kind: sync, note: 1 }
  - { from: k, to: k, label: "__ptrace_may_access + 记关系", kind: self, note: 2 }
  - { from: k, to: k, label: "ptrace_link：task->parent = tracer", kind: self, note: 3 }
  - { from: k, to: t, label: SIGSTOP, kind: async, note: 4 }
  - { from: t, to: t, label: "→ TASK_TRACED", kind: self, note: 5 }
  - { from: k, to: g, label: "waitpid 返回 WIFSTOPPED", kind: reply, note: 6 }
  - { from: g, to: k, label: PTRACE_GETREGS, kind: sync, note: 7 }
  - { from: k, to: g, label: regs, kind: reply, note: 8 }
  - { from: g, to: k, label: "PTRACE_CONT(0)", kind: sync, note: 9 }
```

第 2 步的权限检查会看 uid、`dumpable`、`CAP_SYS_PTRACE`，再让 Yama 之类的 LSM 过一遍。第 3 步是很多人不知道的：内核把 tracee 的 `parent` 指针暂时改成 tracer（`real_parent` 不变），所以调试器能用 `waitpid` 收它的停止和退出事件。

```c
/* kernel/ptrace.c: ptrace_attach() 摘录 */
task->ptrace = flags;              /* PT_PTRACED（或 PT_SEIZED） */
ptrace_link(task, current);        /* task->parent = tracer */
ptrace_set_stopped(task, seize);   /* ATTACH 时向 tracee 发 SIGSTOP */
```

`PTRACE_ATTACH` 返回的时候，目标不一定已经停了。它只是把 `SIGSTOP` 发出去了；真正的同步点在 `waitpid`。

```callout
tone: red
icon: ⚠
text: |
  ==`ptrace(PTRACE_ATTACH, pid, 0, 0)` 返回 0，不等于「已经停住」。==

  接下来必须 `waitpid(pid, &status, __WALL)`，等到 `WIFSTOPPED(status)` 为真，才能读寄存器。
  另外，`PTRACE_ATTACH` 只挂**一条线程**：`pid` 在内核眼里是 tid（线程 ID）。
```

三种把进程变成 tracee 的方式，差别在这里：

```compare
first: 做法
head: [谁发起, 会不会立刻停, 典型用途]
rows:
  - "`PTRACE_TRACEME`":
      - "tracee 自己"
      - "不会；通常接一个 `raise(SIGSTOP)`，让父进程收到停止事件"
      - "自己启动的子进程；`gdb ./a.out` 这条路"
  - "`PTRACE_ATTACH`":
      - "tracer"
      - "发 `SIGSTOP`，但返回时不一定已停，要 `waitpid`"
      - "attach 一个已经在跑的进程"
  - "`PTRACE_SEIZE`":
      - "tracer"
      - "不会；要停时用 `PTRACE_INTERRUPT`，还可以 `PTRACE_LISTEN`"
      - "现代调试器、需要细粒度控制的场景"
  - "`PTRACE_O_TRACECLONE`":
      - "tracer（在父 tracee 上设选项）"
      - "新 clone 出来的线程自动挂到同一个 tracer，并先停住等它"
      - "追多线程程序；不用手动一条条 attach"
```

把这套握手写成代码，最短的 tracer 是这样：

```c
#include <stdio.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <unistd.h>

int main(void) {
    pid_t child = fork();
    if (child == 0) {
        ptrace(PTRACE_TRACEME, 0, 0, 0);
        execl("./target", "target", NULL);
        _exit(127);
    }

    int status;
    waitpid(child, &status, 0);            /* execve 后的 SIGTRAP */
    struct user_regs_struct regs;
    ptrace(PTRACE_GETREGS, child, 0, &regs);
    printf("entry: rip = 0x%llx\n", regs.rip);

    ptrace(PTRACE_CONT, child, 0, 0);
    waitpid(child, &status, 0);            /* 下一次停止 / 退出 */
}
```

这段是 x86-64 的写法（`struct user_regs_struct`）；换架构时，`PTRACE_GETREGS` 换成 `PTRACE_GETREGSET` + `NT_PRSTATUS`。

这里只走到目标程序的第一条指令。后面要单步、下断点、看系统调用，都是在这个「等停 → 读现场 → 继续」的循环里换 `request`。

多线程程序的规则要单独说：**attach 是按线程算的**。`ptrace(2)` 的原话是「tracee 永远指一条线程，不是一个多线程进程」。你想看所有线程，就得遍历 `/proc/<pid>/task` 一条条挂，或者在挂上主线程时打开 `PTRACE_O_TRACECLONE`，让之后新建的线程自动进来。已经存在的线程不会因为主线程被 attach 就自动停下。

还有两条边界：一条线程同时只能有一个 tracer（再 attach 会 `EPERM`）；同一个线程组里的线程不能互相 attach。

## 06 · 目标一直在跑，怎么「实时」看

原文的答案是「停 → 看 → 走」。这一节把它拆成可核对的机制：谁让谁停、`waitpid` 里看到的是什么、断点到底是怎么生效的。

### 一次迭代长什么样

```seq
grid: true
participants:
  - { id: t, label: tracee, tone: blue }
  - { id: k, label: 内核, tone: violet }
  - { id: g, label: tracer · gdb, tone: green }
segments:
  - { from: 1, to: 3, label: 出事 → 停下 → 通知 }
  - { from: 4, to: 7, label: 看现场 → 放它走 }
messages:
  - { from: t, to: k, label: "断点 / 信号 / 单步 / syscall", kind: async, note: 1 }
  - { from: k, to: k, label: "ptrace_stop()：TASK_TRACED", kind: self, note: 2 }
  - { from: k, to: g, label: "waitpid → WIFSTOPPED", kind: reply, note: 3 }
  - { from: g, to: k, label: "GETREGS / PEEKDATA", kind: sync, note: 4 }
  - { from: k, to: g, label: 现场, kind: reply, note: 5 }
  - { from: g, to: k, label: "PTRACE_CONT(sig)", kind: sync, note: 6 }
  - { from: k, to: t, label: 恢复运行, kind: async, note: 7 }
```

这段会重复到 `PTRACE_DETACH` 或 tracee 退出。所谓「实时」，是在这些事件点上拿到一致的现场，不是每个时钟周期都盯着它。

tracee 停下来的原因不止一种，但 `waitpid` 都用同一个 `WIFSTOPPED` 报给你。要区分它们，得看 `status` 的高位：

```c
int status;
pid_t pid = waitpid(tracee, &status, __WALL);

if (WIFSTOPPED(status)) {
    int sig   = WSTOPSIG(status);   /* (status >> 8) & 0xff */
    int event = status >> 8;        /* 低 8 位是停止信号，高 8 位是事件号 */

    if (event == (SIGTRAP | (PTRACE_EVENT_CLONE << 8))) {
        /* 新线程被 clone 出来 */
    } else if (sig == (SIGTRAP | 0x80)) {
        /* 系统调用停：设了 PTRACE_O_TRACESYSGOOD 才有 0x80 这一位 */
    }
}
```

| 停下来的原因 | `waitpid` 看到什么 | 怎么确认 |
|---|---|---|
| 信号投递（signal-delivery-stop） | `WIFSTOPPED`，`WSTOPSIG` 是那个信号 | 信号还没投递给 tracee，tracer 可以压制或换一个 |
| 组停（group-stop） | `WSTOPSIG` 是 `SIGSTOP` / `SIGTSTP` / `SIGTTIN` / `SIGTTOU` | `PTRACE_GETSIGINFO` 返回 `EINVAL` 就是组停 |
| 系统调用停（syscall-stop） | `SIGTRAP`；设了 `PTRACE_O_TRACESYSGOOD` 后是 `SIGTRAP\|0x80` | 进入 / 退出系统调用各停一次 |
| `PTRACE_EVENT` 停 | `status >> 8 == (SIGTRAP \| (PTRACE_EVENT_xxx << 8))` | fork / clone / exec / exit / seccomp 等事件 |
| 单步停 | `SIGTRAP` | 上一条命令是 `PTRACE_SINGLESTEP` |

### 断点不是 CPU 的特殊功能

GDB 在 x86 上放软件断点，做的事非常朴素：把目标地址的第一个字节改成 `0xCC`。`0xCC` 是 `int3` 指令，CPU 执行到它就会触发一个陷阱，内核把它变成 `SIGTRAP` 交给 tracer。

```journey
- tag: ① 下断点
  tone: blue
  name: "0x401136"
  badge: 写一个字节
  badgeTone: warn
  fields:
    - { k: 原字节, v: "0x55", note: "push rbp" }
    - { k: 新字节, v: "0xCC", note: "int3", tone: warn }
  code: |
    long w = ptrace(PTRACE_PEEKDATA, pid, 0x401136, NULL);  /* 先按 §04 检查 errno */
    w = (w & ~0xffL) | 0xCC;                    /* 只换最低字节 */
    ptrace(PTRACE_POKEDATA, pid, 0x401136, (void *)w);
  note: "`POKEDATA` 一次写一个机器字，所以要先读、改最低字节、再整字写回；内核带 `FOLL_FORCE`，只读代码段也写得进去。"
  next: "tracee 继续跑 :: :: 它并不知道这个字节被换了"

- tag: ② 命中
  tone: red
  name: "0x401136"
  badge: SIGTRAP
  badgeTone: red
  fields:
    - { k: 执行到, v: "0xCC", note: "int3", tone: warn }
    - { k: 内核, v: "转成 SIGTRAP" }
    - { k: tracee, v: "TASK_TRACED" }
  note: 断点命中时，`rip` 指向 `0x401136` 之后的那条指令（x86 的 `int3` 长度是 1）。
  next: "tracer 撤掉断点 :: :: 把 0x55 写回去，才能执行原指令"

- tag: ③ 单步
  tone: violet
  name: "0x401136"
  badge: 执行原指令
  fields:
    - { k: 原字节, v: "0x55", note: "已写回" }
    - { k: 方式, v: "PTRACE_SINGLESTEP" }
  note: 执行完这一条，tracee 又停在 `0x401137`。
  next: "装回 0xCC :: :: 下次再经过这里还会命中"

- tag: ④ 继续
  tone: green
  name: "0x401136"
  badge: 断点还在
  fields:
    - { k: 断点, v: "0xCC", note: "重新写回" }
    - { k: 状态, v: "继续运行" }
  note: 断点重新装回这条指令的开头。GDB 默认走「撤掉 → 单步 → 装回」；某些平台会用 displaced stepping，把原指令挪到别处执行，省掉这一来一回。
```

这段也回答了「ATTACH 之后能做什么」：能读能写寄存器、能读能写内存、能单步、能设断点、能收发信号、能决定它什么时候继续。==所有这些动作都要求 tracee 停在 ptrace-stop 里==；在它跑的时候发 `PEEK` / `GETREGS`，内核会返回 `ESRCH`。

多线程下还有一个容易忽略的差别：你停住的只是被 attach 的那条线程。其他线程可能还在跑，还在改内存。GDB 默认的 all-stop 模式会把所有线程都停下来，再给你一份一致的现场；如果只停一条，你看到的是「这一条线程停下的瞬间，别人还在动」。

## 07 · 边界：谁能用、代价是什么、还能用什么

`ptrace` 能读别人的内存、改别人的寄存器、把别人的系统调用改掉，所以它从设计上就是权限敏感的。Linux 在能力检查之外，还叠了 `dumpable` 和 LSM（Linux Security Module）。Yama 是其中最常见的一层：

```compare
first: ptrace_scope
head: [允许谁 attach, 典型场景]
rows:
  - "`0` classic":
      - "同 uid、目标可 dump 的进程"
      - "老式桌面；最宽松"
  - "`1` restricted（Yama 默认）":
      - "只允许自己的后代（tracee 是 tracer 的后代），或有 `CAP_SYS_PTRACE`，或被目标用 `PR_SET_PTRACER` 点名"
      - "`gdb ./a.out` / `strace ./a.out` 正常；`gdb -p 别人的 pid` 被挡"
  - "`2` admin-only":
      - "只有 `CAP_SYS_PTRACE`"
      - "服务器；调试要提权"
  - "`3` no attach":
      - "谁都不行，且写下去就改不回来"
      - "高安全环境"
```

`dumpable` 是另一条线：目标如果执行过 setuid / setgid 程序，或者自己调了 `prctl(PR_SET_DUMPABLE, 0)`，普通 tracer 就 attach 不上。`ssh-agent` 用这个办法防止别人通过 ptrace 偷密钥。容器里还要注意：新建 user namespace 可能削弱 Yama 的保护，`ptrace(2)` 专门写了这件事。

还有一条控制边界：tracer 自己崩掉时，Linux 会自动 detach 所有 tracee 并让它们继续跑（正停在 group-stop 里的除外）；做沙箱或监牢的进程会打开 `PTRACE_O_EXITKILL`，让 tracer 一死就把 tracee 一起杀掉，避免它逃出控制。

代价也很具体。每次 `ptrace` 调用都是一次系统调用，读一个机器字就要来回一趟；`PTRACE_PEEK*` 还要把 tracee 停在 ptrace-stop 里。GDB 之所以能流畅地刷一屏内存，是因为它绕开了逐字 `PEEK`，改用 `/proc/PID/mem` 一次读一段。strace 则是另一种用法：它用 `PTRACE_SEIZE` 挂上，靠 `PTRACE_O_TRACESYSGOOD` 和 `PTRACE_GET_SYSCALL_INFO` 记录每次系统调用的进出，不需要逐字读内存。

所以今天要观测一个进程，ptrace 不是唯一的路：

```compare
first: 手段
head: [能做什么, 不能做什么, 典型工具]
rows:
  - "ptrace":
      - "停 / 走 / 单步 / 读写寄存器和内存 / 收发信号；控制力最全"
      - "逐次调用，逐字读很慢；默认要停住"
      - "gdb、strace、ltrace、rr"
  - "`/proc/<pid>/mem`":
      - "批量读写内存；能写只读页；线程运行时也能读"
      - "不能控制执行；打开要 attach 权限"
      - "GDB 读内存的首选"
  - "`process_vm_readv` / `writev`":
      - "一次多个 iovec、按页搬；比逐字 PEEK 快"
      - "不能控制执行；写只读页不行"
      - "批量注入 / 转储工具"
  - "eBPF / uprobes":
      - "在内核里挂探针，统计调用、延迟、参数；不拦停整个进程"
      - "改控制弱；需要较新的内核和权限"
      - "bpftrace、perf"
  - "seccomp user notification":
      - "过滤器把某个系统调用交给用户态进程处理"
      - "只覆盖系统调用；不是通用调试器"
      - "容器运行时、沙箱"
```

`ptrace` 从 Unix V6 时代就在了（名字就是 process trace）。它带着那个年代的印子：一个函数、一堆命令号、一个 `void *` 兼容多种用途。今天的调试器仍然用它，但只在需要「停住并控制」的时候用；读内存、读系统调用这些事，已经有更合适的接口。

## 08 · 带走

```summary
title: 五句话带走
text: |
  1. `request` 是动词，`pid` 是宾语，`addr` / `data` 的含义由它决定。
  2. `addr` 是 tracee 的虚拟地址；翻译由内核用 tracee 的 mm 完成，tracer 不需要它的页表。
  3. `PEEKDATA` 一次读一个机器字；系统调用层把结果写进 `data` 指针，glibc 把它变成返回值；`-1` 可能是合法数据，要看 `errno`。
  4. `ATTACH` 先建关系（`task->parent = tracer`）再发 `SIGSTOP`；返回不等于停了，要 `waitpid`。它挂的是一条线程。
  5. 观察是「停 → 看 → 走」的循环；断点就是写进代码段的 `0xCC`。现代调试器读内存走 `/proc/pid/mem`，不逐字 `PEEK`。
```

```quiz
- q: 为什么 `ptrace(PTRACE_ATTACH, pid, 0, 0)` 返回 0 之后，还不能马上读寄存器？
  a: |
    因为 ATTACH 只是把 `SIGSTOP` 发给目标，函数返回时目标不一定已经停在 ptrace-stop 里。
    要 `waitpid(pid, &status, __WALL)` 等到 `WIFSTOPPED(status)`，才能发 `GETREGS` / `PEEKDATA`。

- q: "`addr` 是 tracer 的地址还是 tracee 的地址？tracer 没有 tracee 的页表，为什么能读？"
  a: |
    是 tracee 的虚拟地址。翻译发生在内核里：`ptrace_access_vm()` 先用 `get_task_mm()` 拿到 tracee 的 mm，
    再用 `access_remote_vm()` 走那张页表。tracer 只交了一个数字，不需要拥有目标页表。

- q: 为什么不能只用 `if (value == -1)` 判断 `PEEKDATA` 失败？
  a: |
    因为读到的八个字节全是 `0xff` 时，返回值也是 `-1`。必须先 `errno = 0`，
    调用后检查 `value == -1 && errno != 0`。

- q: 读 100 字节，`PEEKDATA` 要调用几次？为什么 GDB 不这么干？
  a: |
    每次读 8 字节，要 13 次（最后一次只用到 4 个字节）。GDB 优先用 `/proc/PID/mem`，
    一次 `read()` 读一段，还能在线程运行时读、能写只读页来放断点。
```
