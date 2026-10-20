排查一个卡住的进程时，两条命令常常给出两种答案。`top` 里是一个进程吃了 400% 的 CPU；`/proc/<pid>/status` 却写着它只有一条线程。再 `ls /proc/<pid>/task`，那里躺着好几个目录。

同一个东西在不同地方长得不一样，这就是本文要说的事：==一个进程或线程，在用户空间和内核里都有东西，但两边放的不是同一份副本==。全文按六个问题推进，其中五张整体图各回答一个：

- 一个进程在两边的家当分别是什么（§02）
- 一条线程的「上下文」分散在哪几处（§03）
- 进内核时用的是哪根栈（§04）
- 创建进程和创建线程各在哪边发生什么（§05）
- 切走时到底保存了什么（§06）
- 哪些「线程」内核根本不知道（§07）

## 01 · 两组词：谁在跑，访问哪块地址

「内核」和「用户态」经常被混着用，其实它们指两件不同的事。

- **用户态 / 内核态**：CPU 此刻的权限级。x86 用 `CS` 里的 CPL 判断能不能执行特权指令；Linux 只用两级，ring 0 和 ring 3。
- **用户空间 / 内核空间**：同一张虚拟地址空间里的两半。x86-64 上用户那半在低处（低 47 位，到 `0x0000_7fff_ffff_ffff`），内核那半在高处（从 `0xffff_8000_0000_0000` 起）。

两个维度互相独立，四种组合在现实里各有各的名字：

```compare
first: 组合
head: [CPU 在哪个态, 访问的是哪块地址, 现实里叫什么]
rows:
  - 正常执行:
      - 用户态
      - 用户空间
      - 程序自己跑：取指令、读写自己的全局变量、调自己的函数
  - 撞墙:
      - 用户态
      - 内核空间
      - 页表把内核那半标成「只有内核能访问」，CPU 拦下，进程收到 `SIGSEGV`
  - 替程序搬数据:
      - 内核态
      - 用户空间
      - 内核按程序给的指针读写那块缓冲，例如 `copy_from_user()`、`put_user()`
  - 内核自己干活:
      - 内核态
      - 内核空间
      - 分配内存页、改 fd 表、从运行队列挑下一个 task
```

==「进入内核态」不是换了一条线程。== 同一个 task 从 ring 3 掉进 ring 0，处理完再回来：tid 没变，引用的资源没变，地址空间也没变。变的只有权限级、当前的栈指针，以及此刻能碰哪些地址。

## 02 · 总图：一个进程在两边的家当

这张图把一个三线程进程的全部家当摊开。上半是它的用户空间，中间是内核里描述它的对象，底下是真在干活的硬件。读法是从左到右（用户地址由低到高），再从用户栈那根线走进内核。

```arch
svg: ts-map
caption: 上半用户空间、中间内核、底下硬件。点零件看它装了什么、被谁引用；用「导览」按问题走一遍。图里只画了三条代表性的引用线，实际上每条 task 都引用全部六个共享对象。
frames:
  - id: user
    boundary: 3
    kind: classification
    label: 用户空间 · 低半地址
    detail: 一块虚拟地址空间，从左到右依次是代码与全局数据、堆、映射区、用户栈。程序直接读写这里，不需要经过内核。
  - id: kernel
    boundary: 0
    kind: classification
    label: 内核空间 · 高半地址
    detail: 同一份内核内存，里面装着每个进程各自的一组对象。用户程序看不见它们，只能通过系统调用间接改。
  - id: perproc
    boundary: 1
    parent: kernel
    kind: shared
    label: 每进程一份 · 三条线程共用
    detail: 这六个对象是「进程」这个名字在内核里的落点。三条线程的 task 里存着指向它们的指针，所以一份资源被三条执行流共用。
  - id: perthread
    boundary: 2
    parent: kernel
    kind: contains
    label: 每条线程一份 · task_struct
    detail: 内核调度的单位是 task。三条 task 平级，各自有 tid、调度状态、寄存器现场和内核栈；没有一条 task 包含另外两条。
  - id: hw
    boundary: 4
    kind: classification
    label: 硬件 · 两边都在用
    detail: CPU 执行 task，页表把用户虚拟地址翻译到物理帧。它们被进程使用，但不属于进程。
bodies:
  text:
    badge: ① 程序本体
    bars:
      - { label: .text 指令, weight: 4 }
      - { label: .data 初值, weight: 2 }
      - { label: .bss 补零, weight: 2, tone: idle }
    rows:
      - { k: 谁写进来, v: 加载器按 ELF 的段映射 }
      - { k: 谁能改, v: 全局变量任何线程直接写 }
    note: 代码段只读；同一个程序跑多份可共享同一批代码页
  heap:
    badge: ① 全组共享
    rows:
      - { k: 谁管, v: malloc / free（用户态分配器） }
      - { k: 怎么长, v: brk / mmap 向内核要 }
      - { k: 谁能改, v: 任何线程，指针直接读写 }
    note: free 不保证把空间还给内核
  mmap:
    badge: ① 全组共享
    rows:
      - { k: 谁映射, v: 动态加载器 / mmap(2) }
      - { k: 装什么, v: .so 代码、文件页、线程的用户栈 }
      - { k: 文件改了呢, v: 共享映射跟着变 }
    note: 线程的用户栈也从这块划出来，创建后大小固定
  ustack:
    badge: 每线程一组
    cells:
      - { label: T0, sub: tid 1025, link: task0 }
      - { label: T1, sub: 1026, link: task1 }
      - { label: T2, sub: 1027, link: task2 }
    rows:
      - { k: 装什么, v: 用户栈 + TLS（thread_local） }
      - { k: 找 TLS, v: fs 基址指向本线程那块 }
      - { k: 栈顶上方, v: 启动时压进来的 argv / envp }
    note: 三根栈在同一块地址空间里，没有硬件隔离
  libc:
    badge: 内核不认识
    rows:
      - { k: 装什么, v: pthread_t、取消状态、join 状态 }
      - { k: TLS 在哪, v: 就挂在线程库的结构里 }
      - { k: 谁维护, v: libc 自己，全程在用户态 }
    note: 内核只认识 task，不认识这些结构
  sig:
    badge: ② 拆成两半
    rows:
      - { k: 处置表, v: 全组一份（sighand_struct） }
      - { k: 掩码, v: 每条 task 各一份, link: task1 }
      - { k: 待处理信号, v: 每条 task 各自排队 }
    note: 处置共享、掩码私有，所以「谁先收到」要看各自的掩码
  files:
    badge: ② 全组共享
    rows:
      - { k: fd 0–2, v: 标准输入、输出、错误 }
      - { k: fd 3…, v: 打开的文件、socket、管道 }
    note: A 线程 open 的 fd，B 立刻能用；连读写偏移都是同一份
  walls:
    badge: ② 全组共享
    rows:
      - { k: uid / gid, v: 能开谁的文件、能不能杀别人 }
      - { k: namespace, v: 看得见哪些进程、网卡、挂载点 }
      - { k: IPC, v: 共享内存、消息队列、信号量 }
      - { k: cgroup / rlimit, v: 能用多少 CPU、内存、fd }
    note: 都只能由内核改，程序只能申请
  fs:
    badge: ② 全组共享
    rows:
      - { k: cwd, v: 相对路径的起点 }
      - { k: root, v: chroot 之后的根 }
      - { k: umask, v: 新建文件的默认权限 }
    note: 一条线程 chdir，全组的工作目录都变
  mm:
    badge: ② 每进程一份
    stack:
      - { label: 用户栈, mark: 0x7fff…, link: ustack }
      - { label: mmap 区, mark: 0x7f…, link: mmap }
      - { label: 堆, mark: 0x55…, link: heap }
      - { label: .data .bss, link: text }
      - { label: .text, mark: 0x400000, link: text }
    pairs:
      - { from: VA 0x601000, to: 帧 42, note: 别的进程另一帧 }
    note: 用户内存本体不在内核，这里只有描述与页表
  group:
    badge: ② 每进程一份
    rows:
      - { k: tgid, v: getpid() 三条都返回它 }
      - { k: ppid, v: 三条线程的父进程相同 }
      - { k: group_leader, v: 主线程那条 task }
      - { k: 线程列表, v: 同组的 task 挂在一起 }
    note: 「进程」这个名字，在内核里就是这个组
  task0:
    badge: 主线程
    rows:
      - { k: 调度状态, v: 运行 / 可运行 / 睡眠 / 停止 }
      - { k: 现场, v: RIP / RSP / 通用寄存器 }
      - { k: 内核栈, v: 16 KiB，进内核才用 }
      - { k: 指向, v: mm / files / fs / sighand, link: mm }
    note: task 是索引，资源不在它肚子里
  task1:
    badge: pthread_create
    rows:
      - { k: tid, v: 1026，tgid 还是 1024 }
      - { k: 新分配的, v: 内核栈 + 用户栈 + TLS }
      - { k: 照抄的, v: mm / files / fs / sighand, link: files }
    code: clone(CLONE_VM | CLONE_FILES | ...)
    note: 一份资源没复制，所以线程便宜
  task2:
    badge: 同组
    rows:
      - { k: tid, v: 1027 }
      - { k: 优先级, v: nice 值、vruntime }
      - { k: CPU 亲和, v: 允许上哪些核 }
      - { k: 统计, v: 用户/内核态耗时、切换次数 }
    note: 三条 task 平级，没有一条包含另外两条
  pmem:
    badge: 4 KiB 一页
    cells:
      - { label: 帧 42, sub: 进程 A 的 x = 1 }
      - { label: 帧 87, sub: 进程 B 的 x = 2 }
    note: 哪个虚拟地址落到哪一帧，由各自的页表决定
  cpu:
    badge: 核 ×4
    cells:
      - { label: T0, sub: 在跑, link: task0 }
      - { label: T1, sub: 在跑, link: task1 }
      - { label: T2, sub: 在跑, link: task2 }
      - { label: 空闲, sub: 没人排上, tone: idle }
    note: 调度器面前只有 task，它不认识「进程」
parts:
  text:
    label: 代码与全局数据
    sub: 程序本体，映射自可执行文件
    detail: 加载器按 ELF 的 `PT_LOAD` 段把这几块映射进地址空间。代码段只读可执行，写它会触发段错误；`.bss` 在文件里不占空间，加载时补零。==这两类内容的权限不同，所以同一个程序的多份实例可以共享代码页。==
    facts: { 归属: 全进程共享, 谁分配: 加载器, 谁能改: 代码段谁都不能，全局变量谁都能, 要不要进内核: 不用 }
  heap:
    label: 堆
    sub: malloc / new 的地盘
    detail: 用户态分配器在堆上切块，只有空间不够时才用 `brk` / `mmap` 向内核要更多。堆的边界变化由内核完成，堆里面的分配完全在用户态。
    facts: { 归属: 全进程共享, 谁分配: malloc / free, 谁能改: 任何线程, 要不要进内核: 不用 }
  mmap:
    label: 映射区
    sub: 共享库、文件映射、线程栈
    detail: 动态库、`mmap` 的文件页、以及 `pthread_create` 给新线程划的用户栈都在这一块。私有映射写入时复制，共享映射的修改会写回文件。
    facts: { 归属: 全进程共享, 谁分配: 动态加载器 / pthread 库, 谁能改: 映射权限说了算, 要不要进内核: 建映射要 }
  ustack:
    label: 用户栈与 TLS
    sub: 每条执行流一组
    detail: 每条线程一根用户栈，存局部变量、返回地址和栈帧；TLS 是 `thread_local` 变量的家，用 `fs` 基址定位。三根栈在同一块地址空间里，所谓「私有」只是约定。
    facts: { 归属: 每条线程一组, 谁分配: 主线程由内核给，其余由 pthread 库 mmap, 谁能改: 同进程任何线程都能越界写, 要不要进内核: 不用 }
  libc:
    label: libc 与线程库的数据
    sub: 内核完全不认识
    detail: 句柄 `pthread_t` 是线程库自己的东西，指向一块用户态结构；取消状态、join 状态、TLS 块都挂在这套结构上。==内核只知道 task，不知道这些结构存在。==
    facts: { 归属: 每条线程一份（句柄）/ 全进程一份（库状态）, 谁分配: libc, 谁能改: 程序自己, 要不要进内核: 不用 }
  sig:
    label: 信号
    sub: 处置共享，掩码私有
    detail: 信号处置表 `sighand_struct` 存的是「忽略、默认、还是某个处理函数」，全组一份，一条线程用 `sigaction` 改了别的线程立刻看到。掩码和待处理队列不在这里，每条 task 各一份。
    facts: { 归属: 处置全组、掩码每线程, 谁分配: 内核, 谁能改: 经 sigaction / sigprocmask, 要不要进内核: 要 }
  files:
    label: files_struct · fd 表
    sub: 开着的文件、socket、管道
    detail: 一张把整数 fd 映射到打开文件的表。线程 A `open()` 出来的 fd，线程 B 立刻能用，因为表只有一份；连文件读写偏移都共享——两条线程交替 `read` 同一个 fd，会各读各的片段。
    facts: { 归属: 全进程共享, 谁分配: 内核, 谁能改: 经 open / dup / close, 要不要进内核: 要 }
  walls:
    label: 凭证、命名空间与配额
    sub: 能碰什么，能用多少
    detail: 这一组决定进程的边界：uid / gid 决定文件权限和能不能给别人发信号；namespace 决定它看得见哪些进程、网卡、挂载点；IPC 命名空间管着共享内存和消息队列；cgroup 与 rlimit 决定能用多少资源。
    facts: { 归属: 全进程共享, 谁分配: 内核, 谁能改: 只能经系统调用, 要不要进内核: 要 }
  fs:
    label: fs_struct · 目录
    sub: 当前目录、根目录、umask
    detail: 它记的是相对路径从哪算起（cwd）、chroot 之后的根、以及新建文件的默认权限。一条线程 `chdir`，同组其余线程的 cwd 也跟着变，因为它们指向同一个 `fs_struct`。
    facts: { 归属: 全进程共享, 谁分配: 内核, 谁能改: 经 chdir / chroot / umask, 要不要进内核: 要 }
  mm:
    label: mm_struct 与页表
    sub: 地址空间的描述，不是内存本体
    detail: 它记着各段 VMA 在哪、权限是什么，并指向页表；页表把虚拟地址翻译成物理帧。==用户空间里的代码、堆、栈都不在这个结构体里，这里只有描述。==
    facts: { 归属: 每进程一份, 谁分配: 内核, 谁能改: 经 mmap / brk / munmap, 要不要进内核: 要 }
  group:
    label: 线程组与父子关系
    sub: 「进程」在内核里的落点
    detail: 同一线程组的 task 共用一个 tgid，`getpid()` 返回它；`gettid()` 返回各自的 tid。父子关系记在 task 上，同组线程的 ppid 相同。
    facts: { 归属: 每进程一份, 谁分配: 内核, 谁能改: 经 clone / exit, 要不要进内核: 要 }
  task0:
    label: task T0 · 主线程
    sub: 进程里第一条执行流
    detail: 一个 `task_struct`。它存 tid、调度状态、优先级、寄存器现场、信号掩码，以及指向 `mm` / `files` / `fs` / `sighand` 的指针。==资源不在它肚子里，它只是索引。==
    facts: { 归属: 每条执行流一份, 谁分配: 内核, 谁能改: 调度器和系统调用, 要不要进内核: 要 }
  task1:
    label: task T1
    sub: pthread_create 造出来
    detail: 线程库先在新线程的用户空间里备好栈和 TLS，再调 `clone()` 让内核造出这个 task。创建线程没有复制任何资源，只多了一个 task、一根内核栈和一份现场。
    facts: { 归属: 每条执行流一份, 谁分配: 内核（由 pthread 库触发）, 谁能改: 调度器和系统调用, 要不要进内核: 要 }
  task2:
    label: task T2
    sub: 同组，tid 不同
    detail: 同一线程组的 task 共用 tgid。`ps -eLf` 的 LWP 列就是这些 tid。调度器逐条挑，所以三条 task 可以同时在三个核上跑。
    facts: { 归属: 每条执行流一份, 谁分配: 内核, 谁能改: 调度器和系统调用, 要不要进内核: 要 }
  pmem:
    label: 物理内存
    sub: 翻译后的落点
    detail: 页表既是翻译器也是隔离墙：两个进程的同一个虚拟地址，各自查表，落到不同的物理帧。写时复制就是让两份页表暂时指向同一帧，并把它标成只读。
    facts: { 归属: 硬件, 谁分配: 内核的页分配器, 谁能改: 通过映射, 要不要进内核: 要 }
  cpu:
    label: CPU 核
    sub: task 轮流上
    detail: 调度器在运行队列里挑 task，而不是挑进程。三条执行流各自排队、各自上核——这是并行的来源，也是线程切换比进程切换便宜的地方（同进程不用换页表）。
    facts: { 归属: 硬件, 谁分配: 调度器, 谁能改: 不适用, 要不要进内核: 要 }
tours:
  - id: split
    label: 两边各负责什么
    steps:
      - at: [text, heap, mmap, ustack, libc]
        text: 上半是用户空间：程序自己取指令、读写变量、压栈出栈的地方，还有线程库自己的句柄。==这些内容程序直接访问，不需要进内核。==
      - at: [mm, files, fs, walls, sig, group]
        text: 中间左边是内核替它记的账：地址空间怎么映射、开了哪些文件、站在哪个目录、能碰什么、信号怎么处理、这个组有几条线程。一份资源只有一份。
      - at: [task0, task1, task2]
        text: 中间右边是每条执行流各自的 task —— 内核调度时看的就是它。三条平级，共用左边那六个对象。
      - at: [pmem, cpu]
        text: 底下是硬件。==进程使用它们，但不拥有它们==：页表决定哪个虚拟地址落到哪一帧，调度器决定哪条 task 上哪个核。
  - id: one-thread
    label: 一条线程在跑的时候
    steps:
      - at: [ustack, task0]
        text: 用户栈和 task 是配对的：这根栈上压着 T0 的局部变量和返回地址，那个 task 里存着它此刻的 RIP 和 RSP。
      - at: [task0, mm]
        text: T0 读一个全局变量时，得由 `mm` 里的页表把地址翻译成物理帧。==翻译规则全组共用一份。==
      - at: [task0, cpu]
        text: 轮到 T0 跑时，调度器把它的寄存器现场恢复到某个核上；换下来时再把现场存回去。切换只动 task 和栈，不动那六个共享对象。
```

这张图要记住两句话：**用户空间是内容，内核是描述加执行流**；**一份资源只画一份，三条 task 用指针引用它**。

两侧各自负责什么，可以并排看：

```compare
first: 这一侧
head: [装什么, 谁能改, 性质]
rows:
  - 用户空间:
      - 程序真正读写的内容：指令、全局变量、堆、映射区、每线程的栈和 TLS、线程库的句柄
      - 程序自己直接读写，不需要进内核
      - 内容本身，程序想怎么改就怎么改
  - 内核里:
      - 描述与调度：mm 与页表、fd 表、目录、凭证、命名空间、信号处置、线程组、每条线程的 task 与内核栈
      - 只能经系统调用改，用户程序看不见
      - 账本与规则，程序只能申请，不能直接写
```

改动内核里那些对象要走哪扇门，看几个常见调用：`open()` 改 fd 表、`mmap()` 改 VMA 和页表、`clone()` 造 task、`sigaction()` 改处置表、`chdir()` 改 fs_struct。==用户程序能碰的只有这扇门，这也是「用户态进内核态」在现实里的样子。==

一条判据说清了什么东西该放哪边：**这份东西，一条线程改了，另一条线程要不要立刻看见？** 要，就放内核里全组一份（fd 表、cwd、信号处置）；不要，就每线程一份（用户栈、TLS、调度状态）。

## 03 · 一条线程的完整上下文，散在三个地方

线程被换下、过一会儿再换回来，得能接着往下跑。凡是「下次从哪继续」需要的信息，都算它的**上下文**。这些信息不在一个地方：

- **用户空间里**：用户栈、TLS 块、线程库的句柄
- **CPU 寄存器里**：PC、SP、通用寄存器、浮点与 SIMD 寄存器——跑的时候在核里
- **内核里**：`task_struct`（线程控制结构）的几组字段，加上一根内核栈

这张图把三处摊在一条线上，读法是从上往下：用户在跑 → 进内核 → 换下时现场停在哪。

```arch
svg: ts-context
caption: 从上往下三条线：线程库的句柄与 TLS 在用户空间，寄存器在核里，被换下时存进 task 和内核栈。中间那个框是同一个 task_struct 里的几组字段。
frames:
  - id: user
    boundary: 3
    kind: classification
    label: 用户空间 · 这条线程自己的内容
    detail: 线程库的句柄、TLS 块、用户栈。这三样内核都不认识，它们全部由用户态代码维护。
  - id: kernel
    boundary: 0
    kind: classification
    label: 内核空间 · 这条线程的内核侧状态
    detail: 身份、换下时的寄存器、调度信息、信号状态、统计，都在同一个 task_struct 里；系统调用执行到哪，则记在它自己的内核栈上。
  - id: taskframe
    boundary: 1
    parent: kernel
    kind: contains
    label: task_struct · 一个结构体里的几组字段
    detail: 这五块不是五个对象，而是同一个 task_struct 里的五组字段。分开画只是为了每块能写清楚。
  - id: kstackframe
    boundary: 2
    parent: kernel
    kind: contains
    label: 内核栈 · 系统调用执行到哪
    detail: 一条线程一根，16 KiB。系统调用进来时，用户现场压在这根栈上，内核自己的调用链也长在这根栈上。
  - id: hw
    boundary: 4
    kind: classification
    label: 硬件 · 线程在跑时现场在核里
    detail: PC、SP、通用寄存器、浮点寄存器物理上就在 CPU 里。线程被换下时，它们的值被写进内核；换回来时再读出来。
bodies:
  libc:
    badge: 用户态
    rows:
      - { k: pthread_t, v: 线程库的句柄 }
      - { k: 取消 / join, v: 线程库自己维护的状态 }
      - { k: 谁用, v: pthread_join 之类的调用 }
    note: 内核完全不知道这个结构
  tls:
    badge: 每线程一块
    rows:
      - { k: 装什么, v: thread_local 变量、errno }
      - { k: 怎么找, v: fs 基址指向它 }
    note: 换线程时这个基址也要换
  ustack:
    badge: 每线程一根
    stack:
      - { label: 调用者的栈帧 }
      - { label: 局部变量 }
      - { label: 返回地址, mark: ← SP }
    note: 向下长，SP 指在当前栈顶
  ident:
    badge: 身份
    rows:
      - { k: tid, v: 1026 }
      - { k: tgid, v: 1024，三条一样 }
      - { k: 谁给的, v: clone 时内核分配 }
    note: gettid 各不相同，getpid 返回 tgid
  saved:
    badge: 换下时存这里
    rows:
      - { k: thread.sp, v: 内核栈的位置, link: kstack }
      - { k: fsbase, v: TLS 的位置, link: tls }
      - { k: 其余, v: 少数 callee-saved 寄存器 }
      - { k: 恢复点, v: 在旁边那根内核栈上, link: kstack }
    note: 换线程时，这两个字段都换成另一条 task 的
  sched:
    badge: 调度器看的
    cells:
      - { label: 运行 }
      - { label: 可运行 }
      - { label: 睡眠 }
      - { label: 停止 }
    rows:
      - { k: 优先级, v: nice 值、vruntime }
      - { k: 时间片, v: 由调度类决定 }
      - { k: CPU 亲和, v: 允许上哪些核 }
    note: 状态一变，调度器就可能换人
  sigf:
    badge: 信号状态
    rows:
      - { k: 掩码, v: 哪些信号先挡着 }
      - { k: 待处理, v: 这条线程自己的队列 }
      - { k: 处置表, v: 不在这里，全组共享 }
    note: 「发给进程」的信号，谁先处理看各自的掩码
  stats:
    badge: 账本
    rows:
      - { k: 耗时, v: 用户态 / 内核态各多少 }
      - { k: 切换, v: 被换下过几次 }
      - { k: 页错误, v: 触发过几次 }
    note: 读 /proc 时看到的就是这些
  kstack:
    badge: 16 KiB
    stack:
      - { label: pt_regs · 用户现场, mark: SP / RIP / CS }
      - { label: 内核函数栈帧 }
      - { label: 阻塞在哪一行, tone: idle }
    note: 在用户态跑的时候，这根栈基本是空的
  cpu:
    badge: 运行时
    cells:
      - { label: PC }
      - { label: SP }
      - { label: 通用 }
      - { label: 浮点 }
    note: 换下时写进 task，换上时从这里恢复
parts:
  libc:
    label: 线程库的句柄
    sub: pthread_t 指向的用户态结构
    detail: 句柄 `pthread_t` 的值通常就是一个指向 `struct pthread` 的指针，取消状态、join 状态、清理函数都挂在那块结构上。==它属于用户空间，内核完全不知道。==
    facts: { 归属: 每条线程一份, 谁维护: libc, 换线程时要不要动: 不动（跟着线程走） }
  tls:
    label: TLS 块
    sub: thread_local 与 errno 的家
    detail: 每个线程一块，用 `fs` 基址定位（x86-64 上 `fsbase` 存在 task 里）。`errno` 就是 TLS 变量，所以两个线程同时出错不会互相覆盖。
    facts: { 归属: 每条线程一块, 谁分配: 线程库, 换线程时要不要动: 要换 fsbase }
  ustack:
    label: 用户栈
    sub: 函数调用用的那根栈
    detail: 存局部变量、返回地址和栈帧。它和 task 里的 RSP 是一对：SP 一变，这条线程「执行到哪」就变了。
    facts: { 归属: 每条线程一根, 谁分配: 内核给主线程，pthread 库给其余线程, 换线程时要不要动: 要换 SP }
  ident:
    label: 身份
    sub: tid 与 tgid
    detail: 同一线程组的 task 共用 tgid，各自有自己的 tid。==`getpid()` 返回 tgid，`gettid()` 返回 tid。==
    facts: { 归属: 每条 task 各一份字段, 谁分配: 内核, 换线程时要不要动: 不动（身份不随调度变） }
  saved:
    label: 换下时的寄存器
    sub: thread_struct 里的少数几个字段
    detail: 切换时内核只把 callee-saved 寄存器和栈指针写进 `thread_struct`；用户态的完整现场则在进入内核那一刻就压在内核栈的 `pt_regs` 里了。==恢复点不在这里，在内核栈上。==
    facts: { 归属: 每条 task 一份, 谁写: 内核的切换代码, 换线程时要不要动: 要换 }
  sched:
    label: 调度信息
    sub: 状态、优先级、亲和
    detail: 状态决定调度器要不要换人：运行中的 task 被抢占或主动让出后变成可运行或睡眠。优先级和 CPU 亲和决定它排在哪个队列、能上哪些核。
    facts: { 归属: 每条 task 一份, 谁写: 调度器与系统调用, 换线程时要不要动: 随线程走 }
  sigf:
    label: 信号状态
    sub: 掩码与待处理队列
    detail: 掩码和待处理队列都是每条线程一份；处置表（忽略 / 默认 / 处理函数）是全组共享的。所以同一个信号发给不同线程，可能一个被挡住、一个立刻处理。
    facts: { 归属: 掩码与队列每线程一份, 谁写: 内核与 sigprocmask, 换线程时要不要动: 随线程走 }
  stats:
    label: 统计
    sub: 内核记的账
    detail: 用户态和内核态各花了多少时间、被换下过几次、触发过几次页错误。`/proc/<pid>/stat` 和 `/proc/<pid>/task/<tid>/stat` 里的字段就是它们。
    facts: { 归属: 每条 task 一份, 谁写: 内核, 换线程时要不要动: 随线程走 }
  kstack:
    label: 内核栈
    sub: 系统调用执行到哪
    detail: 每条线程一根 16 KiB 的栈。进入内核时，CPU 换成这根栈的栈顶，用户现场作为 `pt_regs` 压在上面；内核自己的调用链也长在这上面。==线程在用户态跑的时候，这根栈基本是空的。==
    facts: { 归属: 每条线程一根, 谁分配: 内核, 换线程时要不要动: 要换栈指针 }
  cpu:
    label: CPU 核与寄存器
    sub: 线程真正在跑的地方
    detail: 线程正在跑的时候，PC、SP 和通用寄存器在 CPU 里；被换下时内核把它们写进 task 和内核栈。==「保存上下文」保存的就是这几样东西。==
    facts: { 归属: 硬件, 谁写: CPU 与切换代码, 换线程时要不要动: 要换 }
tours:
  - id: places
    label: 上下文分布在哪三处
    steps:
      - at: [libc, tls, ustack]
        text: 用户空间这一层是线程自己的内容：栈、TLS、线程库的句柄。==内核一份都不知道==，它们由用户态代码维护。
      - at: [ident, sched, sigf, stats]
        text: 内核这一层是线程的账：它是谁、什么状态、优先级多少、哪些信号先挡着、花了多少时间。这些都在同一个 task_struct 里。
      - at: [saved, kstack]
        text: 线程被换下时，寄存器写进 `thread_struct`，而完整的用户现场躺在内核栈的 `pt_regs` 里。==下次从这里接着跑。==
      - at: [cpu]
        text: 换上时，内核把现场读回寄存器，线程继续在核上跑。
  - id: switch
    label: 被换下时搬了什么
    steps:
      - at: [cpu, saved]
        text: 第一步是存：callee-saved 寄存器写进 task，栈指针写进 `thread.sp`。
      - at: [saved, kstack]
        text: 字段 `thread.sp` 指向的那根内核栈上，还压着进入内核时的用户现场和内核调用链。==恢复点就在这根栈上。==
      - at: [sched, ident]
        text: 同时改状态和记账：这条 task 变成可运行或睡眠，统计里多一次切换。
      - at: [tls, ustack]
        text: 换到另一条线程时，`fsbase` 和 SP 都跟着换成那条线程的，所以 TLS 和用户栈自然就换了。
```

==所以「完整线程上下文」不是一个东西，而是四处状态的集合==：CPU 寄存器（运行时在核里）、内核栈（进内核后的执行现场）、`task_struct` 里的那几组字段、以及用户空间的栈与 TLS。表里是按项对照：

```compare
first: 上下文项
head: [存在哪, 谁维护, 什么时候被读]
rows:
  - PC、SP、通用寄存器:
      - CPU 里；被换下时写进 task 与内核栈
      - CPU 与内核的切换代码
      - 恢复上核时
  - 浮点 / SIMD 寄存器:
      - 同上（这部分是惰性保存的）
      - 内核
      - 新线程用到浮点时
  - 调度状态:
      - task_struct
      - 调度器
      - 挑下一条时
  - 优先级 / 时间片 / CPU 亲和:
      - task_struct
      - 调度器
      - 排队与抢占时
  - 信号掩码 / 待处理信号:
      - task_struct
      - 内核与 sigprocmask
      - 投递信号时
  - 内核栈:
      - 一块独立的内核内存，16 KiB
      - 内核
      - 进内核、切出、恢复
  - TLS:
      - 用户空间；fsbase 记住位置
      - 线程库分配，内核记基址
      - 每次访问 thread_local
  - 线程库的句柄 / 取消 / join:
      - 用户空间
      - libc
      - pthread_join 之类的调用
  - 统计:
      - task_struct
      - 内核
      - 读 /proc 时
```

## 04 · 两套栈：进内核时 SP 换到哪

一条线程至少有两根栈。用户态跑的时候用自己那根用户栈；进内核以后，SP 换成这个 task 的内核栈。

```arch
svg: ts-stacks
caption: 从代码段那条线进去，看一件事：进门那一刻栈指针换了，task 没换。右边那条长线是回来的路。中断栈是例外，它不属于任何一条线程。
frames:
  - id: user
    boundary: 0
    kind: classification
    label: 用户空间 · 程序自己的内存
    detail: 代码段和用户栈都在这里。执行到一条 syscall 指令，才谈得上进内核。
  - id: kernel
    boundary: 1
    kind: classification
    label: 内核空间 · 内核的内存
    detail: task 和内核栈在这里。中断栈也在内核里，但它属于某个 CPU，不属于某条线程。
bodies:
  code:
    badge: 用户态执行
    rows:
      - { k: RIP, v: 指在下一条指令上 }
      - { k: 其中一条, v: syscall 指令 }
      - { k: 取指, v: 不需要内核 }
    note: 代码段只读，执行它只用用户态权限
  ustack:
    badge: 每线程一根
    stack:
      - { label: 调用者的栈帧 }
      - { label: 局部变量 }
      - { label: 返回地址, mark: ← SP }
    note: 向下长；SP 指在当前栈顶
  entry:
    badge: 权限级 3 → 0
    rows:
      - { k: 谁进来, v: syscall / 缺页 / 异常 / 中断 }
      - { k: 换了什么, v: 权限级、SP、GS 基址 }
      - { k: 没换什么, v: task、地址空间、tid, link: task }
    note: 同一条执行流，只是换了权限和栈
  task:
    badge: 现场的家
    rows:
      - { k: thread.sp, v: 内核栈的位置, link: kstack }
      - { k: fsbase, v: 用户态 TLS 的基址 }
      - { k: 换线程, v: 换成另一条 task 的 sp }
    note: 一个 task 一根内核栈，一一对应
  kstack:
    badge: 16 KiB · 每线程一根
    stack:
      - { label: pt_regs · 用户现场, mark: SP / RIP / CS }
      - { label: 内核函数栈帧 }
      - { label: 空着的部分, tone: idle }
    note: 在用户态跑时基本是空的
  irqstack:
    badge: 每 CPU 一根
    rows:
      - { k: 什么时候, v: 第一次外部硬件中断 }
      - { k: 为什么, v: 不占用某条线程的 16 KiB }
      - { k: 归属, v: 不属于任何一条线程 }
    note: 中断处理不代表某条线程在跑
parts:
  code:
    label: 代码段 · RIP 在这儿
    sub: 执行到 syscall 就进门
    detail: 用户态执行时 RIP 指向代码段里的下一条指令。`syscall` 本身也是一条指令：执行到它，CPU 才切权限级。
    facts: { 位置: 用户空间（低半）, 谁在用: 线程自己, 需要内核吗: 不用 }
  ustack:
    label: 用户栈
    sub: SP 指向这里
    detail: 函数调用、局部变量、返回地址都在这一根栈上。SP 变，说明线程执行的位置变了。
    facts: { 位置: 用户空间（高地址）, 谁在用: 线程自己, 需要内核吗: 不用 }
  entry:
    label: 进门
    sub: 系统调用、缺页、异常、中断
    detail: 系统调用是主动的，缺页和异常是被动的，中断来自硬件。它们共同的效果是：CPU 换了权限级，SP 换成内核栈，原来的用户现场被压进 `pt_regs`。==task 一直是同一个。==
    facts: { 位置: 边界, 谁触发: 线程自己或硬件, 需要内核吗: 就是进内核 }
  task:
    label: task T1
    sub: 内核记着这条执行流
    detail: 字段 `thread_struct.sp` 指向这条线程自己的内核栈。切换线程时，这个字段换成另一条 task 的值，栈也就跟着换了。
    facts: { 位置: 内核空间, 谁在用: 调度器, 需要内核吗: 是 }
  kstack:
    label: 内核栈
    sub: 16 KiB，一条线程一根
    detail: 系统调用进来后，内核在这根栈上跑。用户现场（SP、RIP、CS、RFLAGS、通用寄存器）作为 `pt_regs` 压在最上面，返回时从这里恢复。==线程在用户态跑时，这根栈基本是空的。==
    facts: { 位置: 内核空间, 谁分配: 内核, 大小: THREAD_SIZE，x86-64 上是 4 页 = 16 KiB }
  irqstack:
    label: 中断栈
    sub: 每 CPU 一根
    detail: 外部硬件中断默认不借用当前线程的栈：第一次外部中断时，内核切到该 CPU 自己的中断栈。这样中断处理不会挤占某条线程那 16 KiB。
    facts: { 位置: 内核空间, 谁分配: 内核（每 CPU）, 需要内核吗: 是 }
tours:
  - id: roundtrip
    label: 进门再回来这一趟
    steps:
      - at: [code, ustack]
        text: 用户态跑着：RIP 指在代码段，SP 指在这条线程的用户栈上。
      - at: [entry]
        text: 执行到 syscall（或触发缺页），CPU 从 ring 3 进 ring 0。==task 没变，变的是权限级和栈。==
      - at: [kstack, task]
        text: SP 换成这根内核栈的栈顶，用户现场压成 `pt_regs`；`thread.sp` 记着这根栈的位置。
      - at: [kstack, ustack]
        text: 处理完返回，内核从 `pt_regs` 里恢复用户 SP 和 RIP，栈又换回用户栈。
```

为什么要单独一根内核栈，而不是接着用用户栈？内核不能相信用户给的 SP：它可能指向一块随时会被换掉的页，也可能是故意构造的地址。栈一坏，内核自己就崩了。

x86-64 上这根栈有多大，内核文档写得很直接：==「x86_64 has a kernel stack for every active thread. These thread stacks are THREAD_SIZE (4*PAGE_SIZE) big.」== 4 KiB 一页，四页就是 16 KiB。同一份文档还写了一句容易被忽略的话：线程在用户空间跑的时候，只有栈底留着一点信息，其余是空的——**内核栈是进内核才用的，不是常驻的工作区**。

外部硬件中断是例外：它默认切到该 CPU 自己的中断栈（`IRQ_STACK_SIZE`），而不是当前线程那根。所以「进内核就用这条线程的内核栈」这句话，严格来说只对系统调用、缺页和异常成立。

## 05 · 创建时，两边各发生了什么

`fork()` 和 `pthread_create()` 都让内核多造一个可调度的对象，但两边做的工作完全不同：一个在用户空间复刻内容，一个只多一条执行流。

```arch
svg: ts-create
caption: 中间是父进程，右边是 fork 出来的子进程（每样都有自己的一份），左边一列是 pthread_create 出来的新线程（只有 task、用户栈和 TLS 是新的），最上面那格是线程库在用户态先做的事。
frames:
  - id: parent
    boundary: 0
    kind: classification
    label: 父进程 P · 现在
    detail: 创建之前的样子：一份用户空间内容、一张 fd 表、一个 task、一份 mm。
  - id: forked
    boundary: 1
    kind: classification
    label: fork() 之后 · 子进程 C
    detail: 每样都有自己的一份：新的页表、复制出来的 fd 表、新的 task。但物理页暂时共用，写入时才复制。
  - id: thread
    boundary: 2
    kind: classification
    label: pthread_create() 之后 · 新线程 T1
    detail: 只有执行流是新的：一个新的 task、一根新用户栈、一块新 TLS。资源一个都没复制，task 里存的是同一批指针。
  - id: libcframe
    boundary: 3
    kind: classification
    label: 用户态的那一半
    detail: 线程库先在自己这侧备好用户栈和 TLS，再调 clone() 让内核造 task。fork() 没有这一半，它直接就是一个系统调用。
bodies:
  p_user:
    badge: 父进程
    cells:
      - { label: 代码 }
      - { label: 堆 }
      - { label: 栈 }
    note: 程序直接读写，不需要内核
  p_files:
    badge: 全组共享
    rows:
      - { k: fd 0–2, v: 标准输入输出错误 }
      - { k: fd 3…, v: 文件、socket }
    note: 一张表，指向若干打开文件
  p_task:
    badge: pid 1024
    rows:
      - { k: pid / tgid, v: 1024 / 1024 }
      - { k: 现场, v: 寄存器 + 内核栈 }
    note: 主线程的那条 task
  p_mm:
    badge: 一份
    stack:
      - { label: 用户栈 }
      - { label: 堆 }
      - { label: 代码段 }
    note: 页表把这几段映射到物理帧
  c_user:
    badge: 看起来一样
    rows:
      - { k: 复制了什么, v: 各段的映射关系 }
      - { k: 物理页, v: 先共用，写时才复制 }
      - { k: 地址, v: 两份页表各自独立 }
    note: 子进程看到的地址值和父进程一样
  c_files:
    badge: 复制但共用文件
    rows:
      - { k: 表, v: 新的 fd 表 }
      - { k: 表项, v: 指向同一批打开文件 }
      - { k: 偏移, v: 还是共享的 }
    note: 关掉自己的 fd 不影响父进程
  c_task:
    badge: 新 PID
    rows:
      - { k: pid, v: 1030（示例，内核分配） }
      - { k: ppid, v: 指回 P }
      - { k: 调度, v: 新内核栈 + 新调度上下文 }
    note: 一创建就进了运行队列
  c_mm:
    badge: 新页表
    rows:
      - { k: 描述, v: 复制一份 }
      - { k: 页表, v: 新的 }
      - { k: 物理页, v: 标只读，谁写谁复制 }
    note: 这就是写时复制
  libc:
    badge: 用户态先做
    rows:
      - { k: ①, v: mmap 出用户栈 }
      - { k: ②, v: 备好 TLS 与线程库结构 }
      - { k: ③, v: 准备入口函数和参数 }
      - { k: ④, v: 调 clone 让内核造 task }
    note: 这四步全在用户态
  t_task:
    badge: tid 1026
    rows:
      - { k: 新给的, v: 内核栈、调度上下文、初始寄存器 }
      - { k: 照抄的, v: mm / files / fs / sighand 指针 }
      - { k: 一创建就, v: 可运行，等调度器挑 }
    code: clone(CLONE_VM | CLONE_FILES | CLONE_SIGHAND | ...)
    note: 资源一个都没复制
  t_ustack:
    badge: 新分配
    rows:
      - { k: 谁给的, v: pthread 库，用户态 mmap }
      - { k: 大小, v: 创建时定死，不随用随长 }
    note: 主线程的栈才受 ulimit -s 管
  t_tls:
    badge: 新分配
    rows:
      - { k: 装什么, v: thread_local、errno }
      - { k: 谁指向它, v: fsbase }
    note: 换线程时这个基址也要换
parts:
  p_user:
    label: 父进程的用户空间内容
    sub: 代码、全局、堆、栈
    detail: fork 之前它就是程序本身的样子。子进程会拿到一份「看起来一样」的地址空间。
    facts: { 归属: 父进程, fork 之后: 子进程有一份副本, 物理页: 写时复制 }
  p_files:
    label: 父进程的 fd 表
    sub: 指向打开文件
    detail: fork 时这张表被复制一份，但表项指向同一批 `struct file`，引用计数加一。所以父子进程的读写偏移仍然共享。
    facts: { 归属: 父进程, fork 之后: 子进程有一张复制的表, 打开文件: 共用 }
  p_task:
    label: 父进程的 task
    sub: pid 1024
    detail: 里面存着调度状态、现场、以及指向 mm / files / fs / sighand 的指针。
    facts: { 归属: 父进程, fork 之后: 子进程有自己的 task, 共享: 无 }
  p_mm:
    label: 父进程的 mm 与页表
    sub: 地址空间的描述
    detail: fork 会复制一份 `mm_struct` 和一套新页表。复制时把父子双方的页表项都改成只读，这样谁写谁触发缺页。
    facts: { 归属: 父进程, fork 之后: 子进程有新的 mm 与页表, 共享: 物理页先共用 }
  c_user:
    label: 子进程的用户空间
    sub: 和父进程一模一样的内容
    detail: 代码、全局变量、堆、栈在子进程里都能读到同样的值，因为页表指向同一批物理页。但两份页表是独立的，任何一方写入都会先复制一页。
    facts: { 归属: 子进程, 谁复制的: 内核（fork）, 物理页: 写时复制 }
  c_files:
    label: 子进程的 fd 表
    sub: 复制一张表
    detail: 表是新的，表项指向同一批打开文件。子进程 `close` 自己的 fd 不影响父进程，但两边读到的是同一个文件偏移。
    facts: { 归属: 子进程, 谁复制的: 内核（fork）, 打开文件: 共用 }
  c_task:
    label: 子进程的 task
    sub: 新 PID
    detail: 内核建了一个新 task，分配新 PID，把父子关系记在 task 上，并给它一根新的内核栈和一个新的调度上下文。之后它和父进程抢同一个 CPU。
    facts: { 归属: 子进程, 谁创建的: 内核, 新分配: 内核栈、调度上下文 }
  c_mm:
    label: 子进程的 mm 与页表
    sub: 新的，但物理页先共用
    detail: 页表是新的，里面的页表项暂时指向父进程正在用的那些物理帧，全部标成只读。写时复制就发生在这里。
    facts: { 归属: 子进程, 谁复制的: 内核（fork）, 物理页: 只读，写时复制 }
  libc:
    label: 线程库（用户态）
    sub: pthread_create 的前半段
    detail: 线程库先在用户空间把新线程要用的东西备好：一根用户栈、一块 TLS、一个 `struct pthread`，以及入口函数和参数。然后才调 `clone()`。
    facts: { 归属: 用户空间, 谁做: libc, 需要内核吗: 前四步不用 }
  t_task:
    label: 新线程的 task
    sub: tid 1026，tgid 还是 1024
    detail: 内核给它一个新的 task、新的 tid、一根新的内核栈和一个调度上下文，然后用 `clone` 的开关决定哪些资源共享。多线程进程用的开关是：地址空间、fd 表、信号处置全部共享。
    facts: { 归属: 新线程, 谁创建的: 内核（clone）, 共享: mm / files / fs / sighand }
  t_ustack:
    label: 新线程的用户栈
    sub: 线程库 mmap 出来的
    detail: 这块栈在创建时就定好大小，之后不增长（主线程的栈才受 `ulimit -s` 管）。它落在映射区里，和三根线程栈互不相邻也无所谓。
    facts: { 归属: 新线程, 谁分配的: pthread 库, 位置: 映射区 }
  t_tls:
    label: 新线程的 TLS
    sub: 用 fsbase 定位
    detail: TLS 块通常就放在线程库结构旁边，由 `CLONE_SETTLS` 把 `fsbase` 设过去。之后这条线程访问 `thread_local` 和 `errno` 都走这块。
    facts: { 归属: 新线程, 谁分配的: pthread 库, 谁记住位置: task.fsbase }
tours:
  - id: two-paths
    label: 两条创建路径差在哪
    steps:
      - at: [p_user, p_mm, p_task, p_files]
        text: 起点是同一个父进程：一份用户空间内容、一份 mm 与页表、一个 task、一张 fd 表。
      - at: [c_user, c_mm, c_task, c_files]
        text: fork 这一路，==每一样都复制了一份==：新页表、新 task、新 PID、复制的 fd 表。物理页先共用，写时才复制。
      - at: [libc, t_task, t_ustack, t_tls]
        text: pthread_create 这一路，线程库先在用户态备好栈和 TLS，内核只多造一个 task。==mm、fd 表、fs、信号处置全是同一批指针。==
```

写时复制（copy-on-write）值得单独看一遍，因为它解释了「看起来复制了，其实没有」：

```flow
grid: true
nodes:
  - { id: fork, label: "fork 返回", sub: "父子两份页表都指向同一帧，两边都改成只读", row: 0, tone: violet }
  - { id: read, label: "只是读", sub: "按页表读，什么都不发生", row: 1, tone: green }
  - { id: write, label: "有一方要写", sub: "页表项是只读的 → 触发缺页异常", row: 1, tone: amber }
  - { id: copy, label: "内核复制这一页", sub: "只给要写的那一方换一帧新的，改成可写", row: 2, tone: blue }
edges:
  - { from: fork, to: read, label: "没写" }
  - { from: fork, to: write, label: "写了" }
  - { from: write, to: copy, label: "缺页处理" }
```

创建路径逐项对照：

```compare
first: 项目
head: [fork 出的子进程, pthread_create 出的线程]
rows:
  - 用户空间内容:
      - 复制一份（先把物理页标只读共用）
      - 不复制，就是同一份
  - mm / 页表:
      - 新 mm + 新页表
      - 同一个 mm、同一张页表
  - fd 表:
      - 复制一张表，表项指向同一批打开文件
      - 同一张表
  - cwd / 凭证 / 命名空间 / 信号处置:
      - 复制一份
      - 同一批引用
  - task 与内核栈:
      - 新的 task、新的内核栈
      - 新的 task、新的内核栈
  - 编号:
      - 新 PID（tgid 也是新的）
      - 新 tid，tgid 不变
  - 用户栈 / TLS:
      - 复制调用 fork 的那条线程的栈与 TLS
      - 新划一根栈、新的一块 TLS
  - 之后能不能换映像:
      - 可以，子进程通常接着 `execve`
      - 不能，线程不单独 exec
  - 代价:
      - 建页表、复制表、改只读标记，重
      - 只多一个 task 和一根栈，轻
```

`fork` 之后常见的下一步是 `execve`：它把当前进程的用户地址空间整个换掉，装载新程序，但 ==PID 不变、task 不变==。它换的是「用户空间里的内容」，不是「这条执行流」。所以 `fork` + `execve` 是两件事：前者造一个新进程，后者给这个进程换一副身体。

## 06 · 切走时，保存的到底是什么

线程切换常被说成「保存上下文、恢复上下文」。看完 §03 那张图，这句话可以拆得更具体：保存的是**寄存器**，加上**栈指针**和**地址空间标识**。

```compare
first: 换掉的东西
head: [同进程两条线程之间, 两个进程之间]
rows:
  - 通用寄存器 / PC / SP:
      - 要换
      - 要换
  - 浮点 / SIMD 寄存器:
      - 要换（用到才存）
      - 要换
  - 内核栈指针:
      - 要换，换成另一条 task 的
      - 要换
  - 调度状态 / 优先级:
      - 随线程走，本来就是分开的
      - 随线程走
  - 用户栈与 TLS（fsbase）:
      - 要换
      - 要换
  - 地址空间（mm / 页表）:
      - 不换，三条线程同一份
      - 要换，换成另一个进程的页表
  - TLB:
      - 通常不清
      - 要清或打标记（PCID 可以只打标签）
  - 内核栈上的现场:
      - 各自一份，切过去就是另一根栈
      - 各自一份
```

==分界线在「地址空间换不换」这一条上。== 同进程的两条线程用同一张页表，切换时只要换寄存器和栈；换进程要连页表一起换，代价更大。不过现代 CPU 有 PCID 之类的机制，加上各种安全缓解措施，实际开销和「线程一定比进程便宜很多」这句口诀并不完全对得上。

## 07 · 有些「线程」，内核根本不知道

前面说的都是 Linux 的 1:1 模型：一个用户线程对应一个内核 task。但「线程」这个词被用得更宽，至少有三种东西都被叫成线程。

```arch
svg: ts-models
caption: 三列是三种模型，三行分别是用户空间有什么、内核看得见几条、一条阻塞会怎样。右上角那片空白是有意的：内核线程没有用户空间。
frames:
  - id: userspace
    boundary: 0
    kind: classification
    label: 用户空间 · 这里的执行流内核不一定知道
    detail: 左边和中间两列都有用户空间的栈；右上角是空的，因为内核线程不执行用户代码。
  - id: kernelspace
    boundary: 1
    kind: classification
    label: 内核空间 · 内核真正调度的那几条
    detail: 内核只认识 task。用户空间有几条执行流，和内核里有几条 task，可以是一对一、多对一，也可以没有用户空间。
  - id: outcome
    boundary: 2
    kind: classification
    label: 后果 · 一条执行流阻塞时
    detail: 阻塞发生在哪一层，决定了它会不会拖住别人。协程在用户态阻塞，内核看不到，整个 task 一起等。
bodies:
  t_stacks:
    badge: 1:1 · Linux
    cells:
      - { label: T0, sub: 栈 + TLS }
      - { label: T1, sub: 栈 + TLS }
      - { label: T2, sub: 栈 + TLS }
    note: pthread_create 建的，每条一套
  c_stacks:
    badge: N:1 · 绿色线程
    cells:
      - { label: 协程 A }
      - { label: B }
      - { label: C }
    rows:
      - { k: 谁切换, v: 语言运行时，在用户态切 }
      - { k: 保存什么, v: 少量寄存器 + 自己的栈 }
    note: 内核不知道这三条的存在
  t_tasks:
    badge: 内核看得见 3 条
    cells:
      - { label: task }
      - { label: task }
      - { label: task }
    note: 每条有自己的内核栈和调度状态
  c_task:
    badge: 内核只看得见 1 条
    rows:
      - { k: tid, v: 一个 }
      - { k: 内核栈, v: 一根，三条协程共用 }
      - { k: 阻塞, v: 一条协程卡住，整个 task 一起等 }
    note: 内核按 task 记账，不按协程
  k_thread:
    badge: 内核线程
    rows:
      - { k: 用户地址空间, v: 没有（mm 为空） }
      - { k: 内核栈, v: 有一根 }
      - { k: 跑什么, v: 只有内核代码 }
    note: kworker、kswapd 之类
  t_ok:
    badge: 后果
    rows:
      - { k: 一条阻塞, v: 其余两条照跑 }
      - { k: 调度, v: 内核逐条挑 }
    note: 这是「多线程能并发」的根据
  c_block:
    badge: 后果
    rows:
      - { k: 一条阻塞, v: 整个进程一起停 }
      - { k: 为什么, v: 内核不知道还有别的协程 }
    note: 所有阻塞调用都要换成非阻塞 + 事件循环
  k_none:
    badge: 后果
    rows:
      - { k: 不涉及, v: 没有用户态可阻塞 }
      - { k: 典型工作, v: 回收内存、刷脏页 }
    note: 只在内核里干活
parts:
  t_stacks:
    label: 1:1 · 内核级线程
    sub: 每条用户线程一个内核 task
    detail: Linux 的 pthread 就是这种：每条线程有自己的用户栈、TLS，以及一个独立的 task 和内核栈。==内核能单独调度、单独阻塞每一条。==
    facts: { 用户空间: 每条一套栈和 TLS, 内核里: 每条一个 task, 一条阻塞: 其余照跑 }
  c_stacks:
    label: N:1 · 用户态线程
    sub: 协程、绿色线程
    detail: 语言运行时在用户态自己管一批执行流，每个有自己的栈和保存的寄存器。它们共用一个（或少数几个）内核 task，切换全在用户态完成，不用进内核。
    facts: { 用户空间: 运行时管的多条栈, 内核里: 一个 task, 一条阻塞: 整个进程停 }
  t_tasks:
    label: 3 个 task
    sub: 内核能分别调度
    detail: 三个 task 各自排队、各自上核，谁阻塞谁让出，互不牵连。
    facts: { 用户空间: 三条执行流, 内核里: 三个 task, 一条阻塞: 其余照跑 }
  c_task:
    label: 1 个 task
    sub: 三条协程的家
    detail: 内核只看到一个 task，它阻塞时这三条协程都跑不了。所以运行时必须把阻塞调用换成「注册事件 + 让出」。
    facts: { 用户空间: 三条协程, 内核里: 一个 task, 一条阻塞: 整个进程停 }
  k_thread:
    label: 内核线程
    sub: kworker、kswapd
    detail: 内核自己造的 task，没有用户地址空间（`mm` 为空），只跑内核代码。它也有自己的 task_struct 和内核栈，也由调度器挑。
    facts: { 用户空间: 没有, 内核里: 一个 task，一根内核栈, 一条阻塞: 不涉及用户态 }
  t_ok:
    label: 一条阻塞，其余照跑
    sub: 1:1 的结果
    detail: 因为每条线程是一个独立的调度实体，一条等 I/O 时别的照样上核。
  c_block:
    label: 一条阻塞，整个进程停
    sub: N:1 的代价
    detail: 协程的阻塞发生在内核里（一次 `read`），内核把整个 task 挂起，运行时就再也没机会切到别的协程。
  k_none:
    label: 不涉及用户态
    sub: 内核线程的后果
    detail: 内核线程只跑内核代码，没有用户态可言，也不存在「用户态阻塞」。
tours:
  - id: three
    label: 三种模型对内看
    steps:
      - at: [t_stacks, t_tasks]
        text: 1:1 是 Linux 的做法：用户空间三条栈，内核里三个 task，一对一。
      - at: [c_stacks, c_task]
        text: N:1 是协程的做法：用户空间三条栈，内核里只有一个 task。==切换在用户态完成，内核完全不知道。==
      - at: [k_thread]
        text: 反过来还有内核线程：没有用户空间，只有一个 task。这一列的上面是空的，就是这个意思。
      - at: [t_ok, c_block, k_none]
        text: 后果从这里看得出来：同样一条执行流阻塞，1:1 只停它自己，N:1 会拖住整个进程。
```

补一个介于两者之间的：Go 的 G-M 模型属于 M:N —— 用户态有 N 个 goroutine，内核里有 M 个线程，M 由 `GOMAXPROCS` 和运行时决定。它拿到的是「协程便宜」和「能并行」两样好处，代价是调度器要自己重写一遍。

## 08 · 速查：每个名词在哪张图上

前面五张图加起来覆盖了这些概念。下表按名词查，别按图查：

```compare
first: 名词
head: [在哪张图上, 它在图上是什么]
rows:
  - 代码段 / 全局变量 / 堆:
      - §02（家当）
      - 「代码与全局数据」「堆」两个零件
  - 动态库 / mmap 文件 / 线程用户栈:
      - §02
      - 「映射区」零件
  - 用户栈 / 局部变量 / 返回地址:
      - §02、§03、§04
      - §02「用户栈 ×3 + TLS」；§03 / §04 里的栈段
  - TLS / thread_local / errno:
      - §02、§03
      - TLS 块；「找 TLS：fs 基址」
  - pthread_t / 取消状态 / join 状态:
      - §02、§03
      - 「libc 与线程库」「线程库的句柄」
  - 命令行参数 / 环境变量:
      - §02
      - 「用户栈 ×3 + TLS」的说明（启动时压在主线程栈顶）
  - mm_struct / VMA / 页表:
      - §02
      - 「mm_struct + 页表」
  - fd 表 / 打开的文件:
      - §02、§05
      - 「files_struct · fd 表」
  - cwd / root / umask:
      - §02
      - 「fs_struct · 目录」
  - uid / gid / 权限:
      - §02
      - 「凭证 / 命名空间」里的 uid、gid
  - IPC / 命名空间 / cgroup / rlimit:
      - §02
      - 「凭证 / 命名空间」的四行
  - 信号处置 / 掩码 / 待处理信号:
      - §02、§03
      - 「信号」零件；§03 的「信号状态」
  - PID / TGID / 父子关系 / 线程列表:
      - §02
      - 「线程组与父子」
  - task_struct（线程控制结构）:
      - §02、§03、§07
      - 三个 task 零件；§03 的 task_struct 框
  - tid:
      - §02、§03
      - task 的 badge；§03 的「身份」
  - 调度状态 / 优先级 / 时间片 / CPU 亲和:
      - §03、§07
      - 「调度信息」组件；§07 的「3 个 task」
  - 寄存器现场（PC / SP / 通用 / 浮点）:
      - §03、§04
      - 「换下时的寄存器」；§04 的 CPU 零件
  - 内核栈:
      - §02、§03、§04
      - task 的「内核栈」一行；§03 与 §04 的内核栈零件
  - 系统调用执行现场（pt_regs）:
      - §03、§04
      - 「内核栈」里的 pt_regs 段
  - 中断栈:
      - §04
      - 右边那个「中断栈 · 例外」
  - 指向共享资源的引用:
      - §02、§05
      - task 到六个对象的连线
  - COW / 写时复制:
      - §05 的图 + 流程
      - 「新 mm + 新页表」；流程图四步
  - execve:
      - §05 末尾
      - 不在图上（它换映像，不建对象）
  - clone 的共享开关:
      - §05
      - 新 task 零件里的那行代码
  - 1:1 / N:1 / 内核线程:
      - §07
      - 三列
  - 线程上下文 / 上下文切换:
      - §03、§06
      - §03 的上下文表；§06 的「换掉的东西」表
```

最后两句话收尾：

- **进程**回答「拥有什么」：一份地址空间的内容，加上内核里那批描述资源的对象。
- **线程**回答「从哪里继续执行」：一条用户栈、一块 TLS、一个 task、一根内核栈，以及那句「下次接着跑」需要的全部寄存器。

```quiz
- q: 一个线程进入内核态时，它还是同一个线程吗？哪三样东西变了？
  a: |
    还是同一个 task。变的是：CPU 的权限级（ring 3 → ring 0）、栈指针（换成这个 task 的内核栈）、以及 GS 基址之类的内核侧寻址。tid、地址空间和引用的资源都没变。
- q: 内核栈平时是空的吗？为什么它必须和用户栈分开？
  a: |
    是。线程在用户态跑的时候，内核栈基本空着（只剩栈底一点信息），进内核才用。
    分开是因为内核不能相信用户给的 SP：那个地址可能指向随时会被换掉的页，也可能是故意构造出来的。栈一坏，整台机器跟着崩。
- q: pthread_create 创建一条线程时，哪两样东西是新建的，哪些是照抄的？
  a: |
    新建的是 task（连同它的内核栈、调度上下文、初始寄存器）、用户栈、TLS。
    照抄的是指针：mm、fd 表、fs、信号处置，一条都没复制，所以线程比进程轻。
- q: 协程（N:1 绿色线程）里一条执行流阻塞了，为什么整个进程会停？
  a: |
    因为三条协程共用一根内核栈和一个 task。阻塞发生在内核里（例如一次 read），内核看到的是「这个 task 要等」，于是把整个 task 挂起，用户态运行时也就没机会切到别的协程。
```

想接着往下看：进程和线程在资源域 / 执行流这把尺子上的位置，见 [一把尺子：资源域 × 执行流](../resource-domain-and-flow/)；内核里为什么只有一种结构、`clone` 那一串开关怎么逐项生效，见 [内核里没有「进程对象」](../kernel-task-model/)。
