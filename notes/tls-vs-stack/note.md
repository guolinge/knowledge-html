`thread_local int counter;` 和 `int b = 2;` 之间只隔一行，行为却完全不同：一个跟着线程活到退出，一个跟着函数活到返回。它们还都「每个线程一份」，于是很容易被当成同一种东西。

这篇把它们拆开。四件事要分开看：**放在哪、靠什么找到、里面放什么、什么时候没。**

```compare
first: 
head: [线程栈, TLS]
rows:
  - 一句话:
      - 线程的临时工作台：每次函数调用往上摆一层，返回就收走
      - 线程的私人储物柜：线程建好就有，线程退出才清
  - 用途:
      - 支撑函数调用：参数、局部变量、返回地址、保存的寄存器
      - 保存线程私有的长期数据：errno、分配缓存、请求上下文、计数器
  - 组织方式:
      - 按调用链：后调用的压在先调用的上面
      - 按变量：每个变量在块里有自己的固定偏移
  - 怎么找到:
      - RSP / RBP 加偏移（`mov -0x8(%rbp),%rax`）
      - "`fs` 基址加偏移（`mov %fs:0xffffffffffffffb0,%eax`）"
  - 生命周期:
      - 线程创建到退出，但里面每个帧随函数进出
      - 线程创建到退出，变量本人在整个期间有效
  - 函数返回后:
      - 这一帧作废，取地址就是悬空指针
      - 不受影响，还在这条线程的柜子里
  - 谁分配:
      - 内核给主线程，pthread 库给其余线程
      - glibc 在线程创建时一起划好
```

## 01 · 总图：两块区域，两个基址

先看空间关系。下面这张图里，两条线程各有一块 TLS 区和一根用户栈，底下是全进程共享的同一段代码。

```arch
svg: tls-map
caption: 左右两条线是两条线程，各有自己的 TLS 区和用户栈；底下是同一段代码。四条线说明「同一条指令靠不同的基址落到不同副本」。点零件看它装了什么。
frames:
  - id: a
    boundary: 0
    kind: classification
    label: 线程 A 私有
    detail: TLS 区和用户栈都是 A 自己的。fs 指向 A 的 TCB，RSP 指在 A 的栈顶；B 跑到同一个函数时，这两个值换成 B 的。
  - id: b
    boundary: 1
    kind: classification
    label: 线程 B 私有
    detail: 布局和 A 一样，偏移也一样，只有基址不同。所以「同一个变量名 → 不同副本」不是靠不同的指令实现的。
bodies:
  tlsA:
    badge: 每线程一块
    stack:
      - { label: TCB（fs 基址 / TP）· 存放 DTV、canary, mark: TP }
      - { label: .tdata / .tbss · 你声明的 thread_local, mark: TP−80 }
      - { label: 静态 TLS 剩余余量, tone: idle }
    rows:
      - { k: 谁分配的, v: 线程创建时 glibc 一起划好 }
      - { k: 谁能写, v: 只有这条线程的代码 }
    note: 偏移是编译期算好的常量，只有基址随线程换
  stackA:
    badge: 每线程一根
    stack:
      - { label: main 的帧, mark: 高地址 }
      - { label: foo 的帧 }
      - { label: bar 的帧（正在跑）, mark: ← RSP }
      - { label: 栈顶以下还没用, tone: idle }
    rows:
      - { k: 谁在动它, v: call / ret、push / pop }
      - { k: 什么时候没, v: 函数返回，帧就作废 }
    note: 向下长；RSP 指在最上面那一帧的底
  tlsB:
    badge: 每线程一块
    stack:
      - { label: TCB（fs 基址 / TP） }
      - { label: 同一个变量，B 的副本, mark: TP−80 }
      - { label: 静态 TLS 剩余余量, tone: idle }
    rows:
      - { k: 和 A 的区别, v: 只有基址不同，偏移一模一样 }
      - { k: 互相看得见吗, v: 看不见，除非你显式传出去 }
    note: 100 条线程就有 100 份
  stackB:
    badge: 每线程一根
    stack:
      - { label: main 的帧 }
      - { label: 别的函数的帧 }
      - { label: 正在跑的那一帧, mark: ← RSP }
      - { label: 栈顶以下还没用, tone: idle }
    rows:
      - { k: 和 A 的区别, v: 另一根栈，地址不相邻也无所谓 }
      - { k: 谁在动它, v: 只有这条线程自己 }
    note: 栈的「一份」是一条线程一根，不是每个变量一份
  insn:
    badge: 全进程一份
    rows:
      - { k: 访问 TLS, v: "mov %fs:0xffffffffffffffb0,%eax" }
      - { k: 访问局部变量, v: "mov -0x8(%rbp),%rax" }
      - { k: 微妙的地方, v: 两条指令里的偏移都是常量，变的只是基址 }
    note: 编译器在编译期就算好了每个变量离基址多远
parts:
  tlsA:
    label: 线程 A 的 TLS 区
    sub: TCB 加一块静态 TLS
    detail: 这块区域在线程创建时由 glibc 一起划好。`fs` 基址（也叫线程指针 TP）指着 TCB，你声明的 `thread_local` 变量在 TCB 的**负偏移**处。==同一个偏移在两块区域里都存在，只是基址不同。==
    facts: { 归属: 只有这条线程, 谁分配: glibc, 什么时候没: 线程退出, 访问方式: fs + 偏移 }
  stackA:
    label: 线程 A 的用户栈
    sub: 函数调用的工作区
    detail: 每次函数调用压一帧，返回就弹一帧。栈本身只有一根，但里面每一格的有效期由函数决定：`bar` 返回后，它的帧就作废了。
    facts: { 归属: 只有这条线程, 谁分配: 内核或 pthread 库, 什么时候没: 线程退出（帧随函数返回）, 访问方式: RSP / RBP + 偏移 }
  tlsB:
    label: 线程 B 的 TLS 区
    sub: 同一批变量，另一份副本
    detail: 偏移和 A 完全一样，只有 TP 不同。所以对同一条指令来说，==「变量名」在编译期就定了偏移，「哪个副本」在运行期由基址决定==。
    facts: { 归属: 只有这条线程, 谁分配: glibc, 什么时候没: 线程退出, 访问方式: fs + 偏移 }
  stackB:
    label: 线程 B 的用户栈
    sub: 另一根，互不相干
    detail: 两根栈在同一块地址空间里，通常彼此不相邻。B 无论怎么递归，都碰不到 A 的栈帧。
    facts: { 归属: 只有这条线程, 谁分配: 内核或 pthread 库, 什么时候没: 线程退出, 访问方式: RSP / RBP + 偏移 }
  insn:
    label: 代码段 · 同一条指令
    sub: 两条线程执行的是同一段机器码
    detail: 这行代码只有一份，被所有线程共享。它之所以能为不同线程服务，是因为==没有一个寄存器是「全进程唯一」的==：`fs`、`rsp`、`rbp` 都是每条线程各自的值。
    facts: { 归属: 全进程共享, 谁分配: 加载器, 什么时候没: 进程退出, 访问方式: 取指执行 }
tours:
  - id: two-copies
    label: 两条线程为什么读到不同值
    steps:
      - at: [tlsA, stackA]
        text: A 在跑的时候，`fs` 指着 A 的 TCB，`rsp` 指在 A 的栈顶。同一条指令把偏移加上去，落到 A 的那一份。
      - at: [tlsB, stackB]
        text: 换成 B 跑，这两个基址一起换成 B 的。==指令一个字节都没变，落点却换了。==
      - at: [insn]
        text: 这就是全部秘密：编译期固定偏移，运行期换基址。栈的局部变量也是同一套把戏，只是基址是 `rbp` 而不是 `fs`。
```

这里有个容易忽略的细节：**偏移在链接时就定死了**。我在 Debian 12 / glibc 2.36 上编了一段代码，`get_g()` 链接之后长这样：

```text
0000000000401200 <get_g>:
  401200:	mov    %fs:0xffffffffffffffb0,%eax
  401208:	ret
```

`0xffffffffffffffb0` 就是 −80。运行起来核对一下：`&g - fs 基址 = -80`，而且 `pthread_self()` 返回的就是 fs 基址——在 glibc 的 x86-64 实现里，线程指针（TP）就是 TCB 的地址。

## 02 · 栈：函数调用的工作台

栈只做一件事：让函数调用能嵌套。

一次 `foo(1)` 调用通常是这样：先把参数和返回地址放好，把栈指针往下挪出一帧的空间，再跳进去执行。帧里装着局部变量、保存的寄存器，以及对齐用的空隙。`foo` 里再调 `bar`，就在更低的地址上再压一帧。`bar` 返回，帧被弹掉；`foo` 返回，它那一帧也作废。

```c
int *bad(void) {
    int x = 42;
    return &x;      /* 函数一返回，这块就作废 */
}
```

==栈的「每线程一份」指的是那根栈，不是里面的变量。== 每个局部变量都是这一帧里的一个位置，帧一撤，它的地址就不再指向任何有效的东西。

两个具体的机制值得记住：

- **栈顶以下不一定是「空」**：System V AMD64 ABI 给叶子函数留了 128 字节的红色区域（red zone），不调函数时可以往里写，不动 RSP。
- **栈有硬上限**：递归太深或者开个大数组就会撞上保护页。实测拿一根 64 KiB 的线程栈做无限递归，进程直接 `Segmentation fault`（exit 139）。

顺带一个把两件事连起来的细节：开了栈保护之后，编译器会从 **TLS** 里取一个值放进栈帧。

```text
mov %fs:0x28,%rax      # 从 TCB 读出这个线程的栈保护值
mov %rax,-0x8(%rbp)    # 放进当前帧
...
sub %fs:0x28,%rdx      # 返回前和 TLS 里的原值比对
je  .ok                # 不一致就 __stack_chk_fail
```

`0x28` 是 TCB 里的一个固定字段。==所以「栈里的东西全在栈上」也不对：帧里有个值来自 TLS。==

在 Debian 12 + glibc 2.36 上实测的默认值：

```text
pthread default stack = 8192 KiB     guard = 4 KiB
RLIMIT_STACK soft     = 8 MiB        PTHREAD_STACK_MIN = 16 KiB
新建线程的实际栈       = 8192 KiB，guard 4 KiB
```

主线程那根栈受 `ulimit -s` 管，可以往上长；`pthread_create` 出来的栈在创建时就定好大小，之后不增长。所以「栈能装多少」是一条线程级别的常量，和你调了多少层函数无关。

## 03 · TLS：同一个变量名，两条线程为什么读到不同值

TLS 也是「基址 + 偏移」，只是基址换成了每线程一个的线程指针。

```cpp
thread_local int g = 7;      /* 同一个名字 */
```

A 和 B 执行同一段代码，`g` 落到哪，取决于此刻 `fs` 指在谁身上。上面已经看过偏移是 −80，这里看**访问方式本身**：编译器会按变量所在的位置挑一种模型。

```compare
first: 访问模型
head: [什么时候用, 实际生成的指令]
rows:
  - local-exec:
      - 变量在可执行文件里，编译时就知道它在 TP 后面多远
      - "`mov %fs:0xffffffffffffffb0,%eax`（偏移是常量，链接期定死）"
  - initial-exec:
      - 变量在初始加载的共享库里；每次先查一次 GOT 里的偏移
      - "`mov 0x2ec1(%rip),%rax` 然后 `mov %fs:(%rax),%eax`"
  - general-dynamic:
      - 变量在运行时才加载的模块里（`dlopen`），得问运行时
      - "`lea 0x2ea4(%rip),%rdi` 然后 `call __tls_get_addr`，返回值就是地址"
```

这三种都是我在容器里实际编出来、`objdump` 看到的，不是从记忆里写的。区别在于「偏移什么时候确定」：local-exec 是链接期，initial-exec 是加载期查 GOT，general-dynamic 是每次调用 `__tls_get_addr` 去查**动态线程向量**（DTV）——一张「模块 id → 该模块在这条线程里的 TLS 块」的表。

`errno` 也在这套机制里。实测它落在 `TP − 208`：

```text
&g - fs_base    = -80
errno - fs_base = -208
pthread_self()  = 0xffff8cc18780    fs_base = 0xffff8cc18780
```

==所以「errno 是线程私有的」不是约定，是寻址方式决定的==：每个线程的 `fs` 不同，同一个偏移自然读到各自的格子。这个说法有硬证据：`errno` 在 libc 里就是一个 TLS 符号。

```text
$ readelf -sW libc.so.6 | grep -w errno
   876: 0000000000000010     4 TLS  GLOBAL DEFAULT  24 errno@@GLIBC_PRIVATE
```

这里还有一个坑，实测能复现：如果共享库用了 initial-exec 模型，而它是在进程启动后才被 `dlopen` 的，一旦 TLS 体积超过预留的余量，加载就会失败。

```text
dlopen(liby.so) = ./liby.so: cannot allocate memory in static TLS block
```

glibc 为这种「运行时才来」的模块预留的静态 TLS 余量很小（2.44 手册里默认 512 字节，可以用 `glibc.rtld.optional_static_tls` 调大）。上面那个库只声明了 64 KiB 的 `thread_local`，就已经装不下了。

## 04 · 柜子里到底放什么

TLS 里放的东西五花八门，但可以按「谁放进去的」分三类，再加一个「放的是不是对象本身」的问题。

```arch
svg: tls-payloads
caption: 中间是这条线程的 TLS 区，四周是往里放东西的三方，右边那条虚线是「柜子里只放指针」的情况。点零件看每一方具体放了什么。
frames:
  - id: tlsframe
    boundary: 0
    kind: contains
    label: 这条线程的 TLS 区
    detail: 一块由线程指针定位的固定区域。里面既有运行库自己的东西，也有你声明的变量；谁的偏移在前、谁的在后，由链接器和加载器排。
  - id: heapframe
    boundary: 1
    kind: classification
    label: 堆 · 全进程共享
    detail: TLS 里放指针时，对象本体在堆上。线程退出只清柜子，不清堆——那要你自己释放。
bodies:
  tls:
    badge: 每线程一块
    stack:
      - { label: TCB（TP）· 线程指针、DTV、canary, mark: TP }
      - { label: 静态 TLS · errno、tcache、你的变量, mark: TP−80 }
      - { label: 动态库的 TLS（DTV 指过去）, tone: idle }
    rows:
      - { k: 有多小, v: 几百字节起，按你声明的东西长 }
      - { k: 线程多了呢, v: 每条线程都来一份 }
    note: 柜子的门牌是线程指针，不是变量名
  libc:
    badge: glibc 放的
    rows:
      - { k: errno, v: 每个线程一份错误码 }
      - { k: 分配缓存, v: tcache：小块内存先放自己这儿 }
      - { k: 栈保护值, v: canary，在 TCB 里（fs:0x28） }
      - { k: pthread_self, v: 返回的就是 TP 本身 }
    note: 这些东西程序员一般看不见
  cxx:
    badge: 编译器 / 运行时放的
    rows:
      - { k: guard 字节, v: 这个 thread_local 构造过没有 }
      - { k: 析构清单, v: 线程退出时要跑哪些析构 }
      - { k: 对象本体, v: 没有指针的 thread_local 就在这儿 }
    note: 有构造函数的 thread_local 才需要这两样
  app:
    badge: 业务放的
    rows:
      - { k: 计数器, v: 这条线程处理了多少请求 }
      - { k: 请求上下文, v: request_id、当前用户 }
      - { k: 随机数引擎, v: 每条线程自己一个，不用抢锁 }
      - { k: 日志缓冲, v: 自己拼串，拼完再提交 }
    note: 省掉层层传参，也省掉一把锁
  ptr:
    badge: 只放指针
    rows:
      - { k: 柜子里, v: 一个地址，不是对象本体 }
      - { k: 对象在哪, v: 堆上，size 再大也不进 TLS }
      - { k: 线程退出时, v: 指针没了，对象还在（泄漏点） }
    note: pthread_setspecific 的键值槽也是这个形状
  heap:
    badge: 全进程共享
    rows:
      - { k: 装什么, v: UserContext、vector 的缓冲、连接对象 }
      - { k: 谁释放, v: 你；线程退出不会替你 free }
      - { k: 怎么跨线程, v: 得显式把指针传出去 }
    note: 柜子里的指针指到这儿
parts:
  tls:
    label: 线程的 TLS 区
    sub: 一块按线程定位的固定区域
    detail: 它是线程私有的内存，但不是「每个变量一块」，而是所有 TLS 变量按偏移排在同一块里。第一条是 TCB，后面接着静态 TLS；动态加载的模块各有一块，由 DTV 索引。
    facts: { 归属: 只有这条线程, 谁分配: glibc, 什么时候没: 线程退出, 地址怎么算: TP + 偏移 }
  libc:
    label: glibc 放进去的
    sub: 不写在你的代码里，但每条线程都有一份
    detail: 错误码 `errno`、分配缓存 `tcache`、栈保护值、`pthread_self` 都靠这块。它们的存在解释了「同一个函数在不同线程里行为不一样」的很多细节。
    facts: { 属于: 运行时, 举例: errno / tcache / canary, 你要管吗: 不用 }
  cxx:
    label: 编译器与 C++ 运行时放的
    sub: 让 thread_local 对象能「每线程构造一次」
    detail: 有构造函数的 `thread_local` 需要两样东西：一个每线程的 guard 字节，和一份「线程退出时要析构谁」的清单。它们也是 TLS 变量。
    facts: { 属于: 编译器 / C++ 运行时, 举例: guard 字节、析构登记, 你要管吗: 不用 }
  app:
    label: 业务代码放进去的
    sub: 这条线程自己的长期状态
    detail: 计数器、请求上下文、随机数引擎、日志缓冲都适合放这儿：每条线程各用各的，不用加锁，也不用一层层传参。
    facts: { 属于: 业务, 举例: 计数器 / request_id / 引擎状态, 你要管吗: 要 }
  ptr:
    label: 柜子里只放指针
    sub: 对象本体留在堆上
    detail: 写成 `thread_local DatabaseConnection *conn` 时，放的是地址；真正的连接对象在堆上。线程退出时指针没了，对象不会自动释放——这是常见的泄漏点。
    facts: { 属于: 业务, 举例: 连接、上下文、缓存对象, 你要管吗: 要（释放） }
  heap:
    label: 堆上的对象本体
    sub: 全进程共享
    detail: 柜子里的指针指到这儿。堆不随线程退出回收，所以「每线程一个连接」很容易变成「线程池一扩，连接数爆掉」。
    facts: { 属于: 全进程共享, 谁分配: malloc / new, 什么时候没: 你释放时 }
tours:
  - id: locker
    label: 柜子里有什么
    steps:
      - at: [libc]
        text: 先看你看不见的那层：`errno`、分配缓存、栈保护值。==它们都是 TLS 变量，所以同一个函数在不同线程里各算各的。==
      - at: [cxx]
        text: 有构造函数的 `thread_local` 还多两样：一个 guard 字节，一份待析构清单。
      - at: [app]
        text: 业务放的更直白：计数器、请求上下文、随机数引擎、日志缓冲。共同点是「每条线程各用各的，不用加锁」。
      - at: [ptr, heap]
        text: 如果柜子里只放指针，对象本体在堆上。==线程退出只清柜子，不清堆==，所以每线程一个连接要自己收。
```

用大白话说，这张图就是：**每个线程有一个储物柜**。柜子里的物品名称是一样的（`errno`、`counter`、`g`），但每个线程拿到的都是自己那一份；运行库会往里塞工牌和记录本，业务往里塞计数器和草稿纸。有些人图省事，柜子里只放一张取件单，东西存在堆这个大仓库里。

## 05 · 为什么放进去，什么时候别放

放 TLS 通常是为了三件事：

1. **互不干扰**：计数器、错误码、随机数状态，本来就不该共享。
2. **少一把锁**：共享变量要 `mutex`，TLS 变量不用。注意它换不来「全局计数」：想统计总数，最后还得汇总。
3. **省掉层层传参**：`request_id` 这类上下文放柜子里，日志函数就不用每层都收一个参数。代价是隐式依赖，滥用会让代码难测。

反过来，三类东西不该放进去：

- **特别大的对象**：`thread_local char cache[100 * 1024 * 1024]`，100 条线程就是 10 GB 级别的账。
- **需要所有人看见的数据**：全局用户数、总计数。每线程一份，各看各的就是错的。
- **跟着「请求」或「任务」走的状态**：这是最危险的一条。

最后这条要展开，因为它不是风格问题，是会出错的问题。

**TLS 跟的是线程，不是请求。** 线程池里的线程会连续处理不同的请求：先做张三的，再做李四的。如果处理完张三没清柜子，李四进来就会看到张三的 `request_id` 和用户身份——日志串号、权限判断错、甚至在响应里带出别人的数据。

更隐蔽的是异步和协程。我用 `ucontext` 造了两个 fiber 放在**同一个线程**里跑，各自改一次 `counter`：

```text
main   : &counter=0xffffaeded73c counter=0
fiber A: &counter=0xffffaeded73c counter=1
fiber B: &counter=0xffffaeded73c counter=2
main   : &counter=0xffffaeded73c counter=2
```

==两个 fiber 拿到的是同一个地址==——因为切换 fiber 不会换 `fs`，只有换线程才会。所以「用 TLS 存协程上下文」这种做法，在 N:1 的协程实现里根本不成立；任务从线程 A 切到线程 B 时，柜子也不会跟着走。

实务上的替代方案：显式传上下文对象（最稳）、`pthread_key_create` 的键值槽（每个线程一块，`PTHREAD_KEYS_MAX` 在 glibc 里是 1024）、或者干脆用连接池 / 上下文参数，而不是「每线程永久一个连接」。

## 06 · 生命周期：一个到线程退出，一个到函数返回

两者都「每线程一份」，但「什么时候有、什么时候没」完全不同。下面是一个 `thread_local` 对象的一生，和旁边那行局部变量对照着看。

```journey
- tag: ① 线程创建
  tone: muted
  name: 线程还没跑，柜子已经就位
  badge: 空间先有
  badgeTone: ok
  fields:
    - { k: TLS 区, v: glibc 划好，静态 TLS 部分按 .tbss 归零 }
    - { k: thread_local 对象, v: 还没构造 }
  note: 「线程创建就初始化」是错的，构造发生在**第一次执行到声明处**。
  next: "第一次执行到 thread_local 那一行 :: :: 看到 guard 字节还是 0"

- tag: ② 第一次用到
  tone: blue
  name: 编译器插的守卫
  badge: 只构造一次
  badgeTone: ok
  code: |
    cmpb $0, %fs:_ZGVZ1fvE1t@tpoff   # 这条线程构造过吗
    jne  .L5
    movq %fs:0,%rax                  # 取 TP
    leaq _ZZ1fvE1t@tpoff(%rax),%rbx  # 算出这一份的地址
    call _ZN1MC1Ev                   # 构造 M::M
    movb $1, %fs:_ZGVZ1fvE1t@tpoff    # 打上标记
    call __cxa_thread_atexit         # 登记：线程退出时析构
  note: guard 字节本身也是 TLS 变量，所以每条线程各有一个。
  next: "之后每次访问 :: :: 只查一次 guard，然后直接按偏移读"

- tag: ③ 之后每次访问
  tone: green
  name: 就是一条 fs 相对寻址
  badge: 没有锁，没有函数调用
  badgeTone: ok
  fields:
    - { k: 代价, v: 和读普通全局变量几乎一样 }
    - { k: 区别, v: 基址是 fs，不是固定的地址 }
  note: local-exec 模型下就一条 `mov` 指令。

- tag: ④ 线程退出
  tone: amber
  name: 按登记逆序析构
  badge: 只有线程退出才清
  badgeTone: warn
  fields:
    - { k: 谁触发, v: 线程函数返回时，glibc 跑析构清单 }
    - { k: 主线程, v: 在进程退出时才跑 }
  note: 和栈完全不同：栈上的局部变量在函数返回时就没了。
```

实测的打印顺序（同一个 `f()` 被主线程调两次、工作线程调一次）：

```text
main f() #1
  ctor local        tid=48
  ctor static       tid=48
  ctor thread_local tid=48
  dtor local        tid=48        ← 函数返回，局部变量先没
main f() #2
  ctor local        tid=48        ← 又一个新的局部变量
  dtor local        tid=48
spawn thread
 thread f()
  ctor local        tid=51
  ctor thread_local tid=51        ← 工作线程自己的那份
  dtor local        tid=51
 thread exits
  dtor thread_local tid=51        ← 线程退出，才轮到它
after join
  dtor thread_local tid=48        ← 主线程的那份，等到进程退出
  dtor static       tid=48
  dtor global       tid=48
```

三件事从这段输出里能直接看出来：局部变量每次调用都重新构造；`thread_local` 每条线程只构造一次；主线程的 `thread_local` 析构被推迟到进程退出，而不是 `main` 返回时。

## 07 · 线程池里，柜子会串号

把「柜子」放进线程池，就会碰到它最危险的一面：柜子是按**线程**存的，而线程池里的线程会被反复借用。

下面这张时序图里，请求 A 用完 T1 就走了，A 的 `request_id` 和用户身份留在柜子里；T1 被池子收回去，紧接着服务请求 B。

```seq
grid: true
participants:
  - { id: ra, label: "请求 A · 张三", tone: blue }
  - { id: rb, label: "请求 B · 李四", tone: blue }
  - { id: t1, label: "线程 T1（池里复用）", tone: violet }
  - { id: tls, label: "TLS：request_id / user", tone: amber }
  - { id: log, label: 日志, tone: muted }
segments:
  - { from: 1, to: 4, label: 请求 A 处理中 }
  - { from: 7, to: 9, label: 李四的请求，读到张三的身份 }
messages:
  - { from: ra, to: t1, label: 提交下单任务, kind: sync, note: 1 }
  - { from: t1, to: tls, label: "写入 A / 张三", kind: sync, note: 2 }
  - { from: t1, to: log, label: "A 下单成功", kind: sync, note: 3 }
  - { from: t1, to: ra, label: 200 OK, kind: reply, note: 4 }
  - { from: t1, to: t1, label: 没清柜子, kind: self, tone: red, note: 5 }
  - { from: rb, to: t1, label: 提交查询任务, kind: sync, note: 6 }
  - { from: t1, to: tls, label: "读 request_id", kind: sync, note: 7 }
  - { from: tls, to: t1, label: "A（张三）", kind: reply, tone: red, note: 8 }
  - { from: t1, to: log, label: "A 查询完成", kind: sync, tone: red, note: 9 }
  - { from: t1, to: rb, label: "200 OK（串了）", kind: reply, tone: red, note: 10 }
```

==第 5 步什么也没发生，那才是问题。== 线程归还池子时，柜子不会自动清空；下一个任务进来，读到的还是上一个人的东西。

这不是「代码写得不小心」这么简单。日志库的手册直接把这句话写在文档里：

> Since MDC manages data on a *per thread* basis, a server that recycles threads might lead to false information contained in the MDC.

（Logback 手册，MDC 一节。MDC 就是 Java 里那个典型的「TLS 存 request_id」实现。）

同一条路上还有三种走法会出错：

- **异步、跨线程**：主线程把任务丢给另一个线程，TLS 是另一份，值是空的。
- **协程 / 虚拟线程**：切换不换线程，多条任务共用一份柜子，后一个覆盖前一个。
- **忘了删**：柜子里的值活到线程退出。JDK 的 ScopedValue 提案里把这条的后果写得很直白：数据比需要的活得久，线程池里「values can leak into unrelated tasks」，还可能造成长期的内存泄漏。

### 换一种传法：把上下文当参数

同一件事，改成显式传一个 `Context`，就没有「谁的柜子」这个问题了：谁需要，谁拿到；跨线程时一起传过去。

```seq
grid: true
participants:
  - { id: req, label: 请求, tone: blue }
  - { id: t1, label: "线程 T1", tone: violet }
  - { id: ctx, label: "Context（显式传）", tone: green }
  - { id: t2, label: "线程 T2 / 异步任务", tone: violet }
  - { id: log, label: 日志, tone: muted }
messages:
  - { from: req, to: t1, label: "处理(ctx)", kind: sync, note: 1 }
  - { from: t1, to: ctx, label: 读 ctx.requestId, kind: sync, note: 2 }
  - { from: ctx, to: t1, label: A, kind: reply, note: 3 }
  - { from: t1, to: t2, label: "派发(ctx 一起传)", kind: async, note: 4 }
  - { from: t2, to: log, label: 用传进来的 ctx, kind: sync, note: 5 }
  - { from: t2, to: t1, label: 完成, kind: reply, note: 6 }
  - { from: t1, to: req, label: 200 OK, kind: reply, note: 7 }
```

代价是每个函数多一个参数。这就是为什么语言和框架会在这上面做取舍：

- **Go 干脆不给隐式的柜子**。提案 [#21355](https://github.com/golang/go/issues/21355)「用 goroutine-local storage 替代 Context」被否了，官方立场是显式传 `context.Context`。
- **Java 把柜子改成有作用域的**：`ScopedValue`（JDK 25 正式，JEP 506）不可变、生命周期只在 `run()` 期间，子任务不用复制一份。
- **Python 把柜子改成按任务隔离的**：`contextvars`（PEP 567）。提案里的原话是「Thread-local variables are insufficient for asynchronous tasks that execute concurrently in the same OS thread」，asyncio 每个 Task 创建时复制一份 context。
- **.NET 把柜子挂到执行流上**：`AsyncLocal<T>` 跟着 `ExecutionContext` 跨 `await` 流动，而 `ThreadLocal<T>` 在 `await` 之后就读不到了。

### 那什么时候还能用 TLS

把上面这些收成一张判断表：

```compare
first: 场景
head: [能不能用 TLS, 该怎么做]
rows:
  - 请求从进到出都在同一条线程，没有异步:
      - 能
      - 入口写、出口删（filter / finally），别让值活过请求
  - 线程池处理请求（Tomcat、自建池、协程池）:
      - 能，但风险高
      - 每个任务开头重置、结尾清理；漏一次就串号
  - 起线程 / 线程池跑子任务:
      - 不能，TLS 不跟
      - 显式传 context，或用框架的传播机制
  - 协程、虚拟线程（N:1 / M:N）:
      - 不能，TLS 是线程级
      - 运行时 context：contextvars / ScopedValue / ExecutionContext
  - 跨进程、跨服务（trace、租户）:
      - 不能
      - 放进请求头或消息体，用 OTel 的 Context 传播
  - 只是「每线程一个小状态」（计数器、随机数引擎）:
      - 正好合适
      - 不用清也不会串：它本来就不带请求身份
```

各语言里「线程级的老办法」和「任务级的正解」对照一下：

```compare
first: 语言 / 生态
head: [线程级的老办法, 任务级的正解, 关键差别]
rows:
  - Java:
      - "`ThreadLocal` / `InheritableThreadLocal`、SLF4J MDC"
      - "`ScopedValue`（JDK 25）、`MDC.getCopyOfContextMap()` + `setContextMap()` 手动传"
      - 值留到线程退出 vs 只在作用域内有效
  - .NET:
      - "`ThreadLocal<T>`"
      - "`AsyncLocal<T>`（随 `ExecutionContext` 流动）"
      - "`await` 之后 ThreadLocal 丢掉，AsyncLocal 还在"
  - Python:
      - "`threading.local()`"
      - "`contextvars`（PEP 567）"
      - asyncio 每个 Task 复制一份 context
  - Go:
      - 没有 goroutine-local（提案被否）
      - "`context.Context` 显式传"
      - 语言层面就不提供隐式柜子
  - C / C++:
      - "`thread_local`"
      - 显式传结构体或参数
      - 语言不提供跨线程传播
```

一句话：**TLS 适合放「和线程绑定」的状态，不适合放「和请求绑定」的状态。** 前者天然不会串，后者一旦线程被复用、任务被搬走，就一定会串——只是早晚。

## 08 · 容量与代价

栈和 TLS 都会「每条线程一份」，但一份的大小和增长方式不同。

```compare
first: 维度
head: [线程栈, TLS 区]
rows:
  - 一份多大:
      - 默认 8 MiB（实测），可以用 `pthread_attr_setstacksize` 改，最小 16 KiB
      - 从几百字节起，按你声明的东西长；放个大数组就是几 MiB
  - 谁在变:
      - 栈指针随调用上下移动，帧反复压弹
      - 大小在线程创建时就定，之后不变
  - 危险动作:
      - 深递归、大局部数组 → 撞保护页，SIGSEGV
      - 每个线程一份大对象 → 线程越多，总内存越大
  - 保护机制:
      - guard 页（实测 4 KiB）：越界写直接崩，不会悄悄踩到别人的栈
      - 没有保护页；但访问只经由这段偏移，越界就是踩到 TLS 里的别的变量
  - 跨线程可见性:
      - 完全不可见，除非把指针传出去
      - 同上
```

TLS 的账要按线程数乘。实测 32 条线程、每条一个 1 MiB 的 `thread_local` 数组：每个线程拿到的地址都不一样，说明确实是 32 份。

```text
sizeof(t) per thread = 1 MiB, threads = 32
thread  0: &t=0xffff99a096c0
thread  1: &t=0xffff991b86c0
thread  2: &t=0xffff88f326c0
...
RSS after = 21 MiB   （只碰了 TLS，没别的分配）
```

==每个线程都保留完整的 1 MiB，所以这笔账要按线程数乘。== 真正把它们写满时，100 条线程就是 100 MiB —— 这就是为什么柜子适合放「小而长期」的东西，不适合放缓存。

## 09 · 速查

| 问题 | 答案 |
|---|---|
| 局部变量和 `thread_local` 变量都能「每线程一份」吗 | 局部变量不是每线程一份，是每次调用一份 |
| 两者都靠什么寻址 | 基址 + 编译期偏移；栈的基址是 RSP/RBP，TLS 的基址是 `fs`（TP） |
| TLS 里第一个东西是什么 | TCB，线程指针就指着它；静态 TLS 变量在它的负偏移处 |
| `errno` 在哪 | TLS 里（实测 `TP − 208`），所以每个线程各有一份 |
| `thread_local` 什么时候构造 | 这条线程第一次执行到声明处（guard 字节为 0 时） |
| 什么时候析构 | 线程退出时（主线程在进程退出时），由 `__cxa_thread_atexit` 登记的清单驱动 |
| 函数返回后 `thread_local` 还能用吗 | 能，只要线程还活着 |
| 栈上的局部变量返回后还能用吗 | 不能，帧已作废 |
| 协程/fiber 之间 TLS 共享吗 | 共享：同一个线程里 `fs` 不变（我实测两个 fiber 拿到同一个地址） |
| TLS 适合放多大的东西 | 小而长期；每线程一份，线程数一乘就放大 |

一句话收尾：

- **栈是线程的临时工作台**：摆上、收走，跟着函数走。
- **TLS 是线程的私人储物柜**：一人一个，钥匙是线程指针，东西放到线程退出。

```quiz
- q: "同一个 `thread_local int g`，两条线程执行同一条 `mov %fs:...,%eax`，为什么读到不同值？变的是哪一样？"
  a: |
    指令里的偏移是编译期/链接期定死的常量，变的是基址：`fs` 指到各自的 TCB（线程指针 TP）。偏移一样、基址不同，就落到各自的副本上。
- q: 为什么不能把「当前请求的 request_id」长期放在 TLS 里？
  a: |
    因为 TLS 跟的是线程，不是请求。线程池里的线程会连续处理不同请求，异步任务还可能换线程；不清就会串号（日志、权限、响应里带出别人的数据）。要跟请求走，就把上下文显式往下传，或者放进任务对象。
- q: "`thread_local` 对象是什么时候构造、什么时候析构的？"
  a: |
    构造发生在这条线程第一次执行到声明处（guard 字节为 0 时），不是线程创建时；析构在线程退出时（主线程推迟到进程退出），由 __cxa_thread_atexit 登记的清单驱动。
- q: 栈和 TLS 都「每条线程一份」，为什么栈上的局部变量取地址返回会出错，而 TLS 变量不会？
  a: |
    栈的「一份」是那根栈；局部变量只是某一帧里的位置，函数返回帧就作废。TLS 的「一份」是变量本身，它在线程的整个生命周期里都占着同一块位置，只有线程退出才失效。
```

想接着看这两块区域放在进程的哪里、和内核里的 task 是什么关系，见 [两套空间：进程和线程各在两个空间里放着什么](../two-spaces/)。
