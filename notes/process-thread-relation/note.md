排查线上服务时打开 htop，同一台机器上有两类并发生物：一个 Node 进程内部挂着几十条线程，Chrome 却开着几十个进程。`ps aux` 和 `ps -eLf` 各讲了一半真相；到了选型时刻，「CPU 密集用进程、I/O 密集用线程」这句口诀一半对、一半坑。这篇沿一条主线走完全程：一次执行如何从磁盘上的静态文件，变成内核里被调度、被隔离、又裂变成多条执行流的对象，最后落到选型。

## 01 · 一张地图：进程和线程到底什么关系

先把答案放在最前面，全文都在展开这两个词：

- **进程回答「拥有什么」**：一块地址空间、一张打开文件表、一套凭证和命名空间。这一整份叫**资源域**。
- **线程回答「从哪里继续执行」**：一个程序计数器、一组寄存器、一根栈。这一套叫**执行流**。

一个多线程进程，就是「一份资源域 + 多条执行流」。下面这张图分两层：

- **顶行是「出生」**：静态字节 → `execve` → 进程实例。§02 讲的三件事就列在中间那个框里。
- **下面两行是「结构」**：左边一列是全组共享的那份，右边一列是每条执行流自己那份。

怎么玩：==点矩形里的任意一行 / 一个格子 / 一段==，会跳到它指向的那个零件（比如点 `mm` 里的「mmap 区」，会亮起三根线程栈）；用「场景」在 **1 条 ↔ 3 条执行流** 之间切换，看多线程到底多了什么；用「对比两个零件」挑两个（比如**堆**和**用户栈**）出一张对照表。底下三条导览各讲一个问题。

```arch
svg: pt-map
caption: ==最上面一行是「出生」，下面两行是「结构」。== 顶行从磁盘上的静态字节走起：execve 一次做完三件事（① 按段映射进新地址空间 ② 初始化 fd 表 / 信号 / 凭证 ③ 创建至少一条执行流），返回时它已经是一个进程。下面两行才是「一份资源、多条执行流」在内核里的样子：左边一列是全组共享的那份，右边一列是每条执行流自己那份。==矩形里的每一行、每个格子、每段都能点== —— 点了会跳到它指向的那个零件。
bodies:
  elf:
    badge: 静态 · 不执行
    bars:
      - { label: ELF 头, weight: 2 }
      - { label: .text, weight: 4, link: text, tip: 只读代码段。加载时按 PT_LOAD 建一段 VMA；同一程序跑多份，可共享同一批物理页 }
      - { label: .data, weight: 2 }
      - { label: .bss, weight: 2, tone: idle, tip: .bss 是未初始化全局变量，在文件里不占空间，加载时补零 }
      - { label: 段表, weight: 2 }
    note: 按段映射，不是整块拷进内存
  loader:
    badge: 三件事
    rows:
      - { k: "①", v: 按段映射进新地址空间, link: text, tip: 把 ELF 的段映射成一块全新地址空间里的 VMA }
      - { k: "②", v: 初始化 fd 表 / 信号 / 凭证, link: files, tip: files_struct、sighand_struct 这些内核对象在这一步建好 }
      - { k: "③", v: 创建至少一条执行流, link: task0, tip: 主线程：第一个 task_struct，带 PC、寄存器现场和内核栈 }
    code: 'execve("./a.out", argv, envp)'
    note: 返回时，静态字节已经是一个进程
  text:
    badge: ① 全组共享
    rows:
      - { k: 权限, v: r-x 只读可执行 }
      - { k: 物理页, v: 多实例共享同一批, tip: 同一个二进制跑 N 份，text 的物理页只有一份——只读是省法，不是约束 }
    code: load_elf_binary()
  heap:
    badge: ① 全组共享
    rows:
      - { k: malloc, v: "↑ 向上长，free 回缩" }
      - { k: brk / mmap, v: 内核调容量 }
    note: 全组只有一份，多线程改它要想锁
  ustacks:
    title:
      - { when: multi, text: 用户栈 ×3 }
      - { when: one, text: 用户栈 ×1 }
    badge: 每线程一根
    cells:
      - { label: T0 栈, sub: 默认 8MB, link: task0, tip: 主线程的栈。它有个特别之处：只有主线程的栈能动态变大 }
      - { label: T1 栈, sub: 默认 8MB, link: task1, when: multi, tip: pthread_create 新开的栈从 mmap 区划出来，创建后大小固定 }
      - { label: T2 栈, sub: 默认 8MB, link: task2, when: multi, tip: 三根栈摆在同一块地址空间里，「私有」是约定，不是硬件隔离 }
    notes:
      - { when: multi, text: 三根栈在同一张页表之下相邻摆放 }
      - { when: one, text: 只有主线程一根栈，大小由 RLIMIT_STACK 决定（常见 8MB） }
  files:
    badge: ② 全组共享
    cells:
      - { label: fd 0, sub: stdin }
      - { label: fd 1, sub: stdout }
      - { label: fd 2, sub: stderr }
      - { label: fd 3, sub: socket, tip: A 线程 open 出来的 fd，B 线程立刻可见——连读写偏移量都是同一份 }
    note: 进程里任何一条执行流都能用这些 fd
  sighand:
    badge: ② 全组共享
    cells:
      - { label: 处置, sub: 全组共享, tip: SIGTERM 挂哪个函数，改一处全组立即可见 }
      - { label: 掩码, sub: 每线程一份, tone: idle, tip: 屏蔽哪些信号是这条执行流自己的选择，不共享 }
    note: 一张表里，两半分属不同层级
  mm:
    badge: 每进程一张表
    stack:
      - { label: 栈 · 向下长, mark: 0x7fff…, link: ustacks, tip: 主线程的栈在这；线程栈是 mmap 出来的另一块 }
      - { label: mmap 区 · 线程栈在这, link: ustacks, when: multi, tip: 共享库、文件映射，以及每条线程的栈都从这划 }
      - { label: mmap 区 · 共享库 / 文件映射, when: one, tip: 还没有线程，这块暂时只放共享库和文件映射 }
      - { label: 堆 · 向上长（brk）, link: heap, tip: malloc 在这里长；全组一份 }
      - { label: .data / .bss / .text, mark: 0x400000, link: text, tip: 从 ELF 映射来的那几段 }
    pairs:
      - { from: VA 0x601000, to: 帧 42, note: A 的 x = 1, tip: 同一个虚拟地址，两个进程各自查表，落到不同的物理帧 }
    note: 页表把 VA 翻成物理帧
  task0:
    badge: ③ 主线程
    rows:
      - { k: PC / 寄存器, v: 16 × 8 字节 }
      - { k: 内核栈, v: 16KB · 4 页, tip: x86-64 上 THREAD_SIZE = 4 × PAGE_SIZE = 16KB，切换时落脚的地方 }
      - { k: task_struct, v: 约 8KB · 155 字段 }
    note: 第 1 条执行流，execve 亲手造的
  task1:
    badge: pthread_create
    rows:
      - { k: tid, v: 1025 }
      - { k: 新建的, v: 栈 + 寄存器现场 }
      - { k: 复用的, v: mm / files / sighand 指针, link: files, tip: 资源一份没复制，只多了几个引用——这就是线程便宜的全部原因 }
    code: clone(CLONE_VM|CLONE_FILES|CLONE_FS|CLONE_SIGHAND)
  task2:
    badge: 同组
    rows:
      - { k: tid, v: 1026 }
      - { k: getpid, v: 和 T0 / T1 相同, tip: getpid 返回的是线程组 ID；ps -eLf 的 LWP 列才是 tid }
    code: gettid()  // 各不相同
  pmem:
    badge: 4KB 一页
    cells:
      - { label: 帧 42, sub: A 的 x = 1 }
      - { label: 帧 87, sub: B 的 x = 2 }
    note: 物理内存只有一条，分区不存在
  cpu:
    badge: 核 ×4
    cells:
      - { label: T0, sub: 在跑, link: task0 }
      - { label: T1, sub: 在跑, link: task1, when: multi }
      - { label: T2, sub: 在跑, link: task2, when: multi }
      - { label: 空闲, tone: idle, when: multi, tip: 调度器面前没有进程，只有 task——挑谁上核是 task 级的事 }
      - { label: 空闲, tone: idle, when: one, tip: 只有一条执行流，另外三个核闲着 }
      - { label: 空闲, tone: idle, when: one }
      - { label: 空闲, tone: idle, when: one }
    notes:
      - { when: multi, text: 4 个核，3 个在跑 }
      - { when: one, text: 4 个核，1 个在跑 }
parts:
  elf:
    label: 可执行文件 a.out
    sub: 1 份 · 静态字节
    detail: 磁盘上的 ELF 文件：只读代码段、数据段、映射元数据。==它不执行，也不持有任何「进行中」的状态。== 同一个文件可以被加载 N 次，变成 N 个互不相干的实例。
    facts: { 归属: 磁盘（不在任何进程里）, 份数: 一份静态字节, 跟着谁走: 不随任何东西, 隔离: 不参与 }
  loader:
    label: execve：加载器
    sub: 三件事一次做完
    detail: 内核里的加载器。它做的三件事正好对应这张图下面三个区：==① 造地址空间 ② 建内核资源 ③ 造第一条执行流==。做完返回用户态时，「程序」这个词已经变成「进程」了。
    facts: { 归属: 内核代码, 份数: 一次调用, 跟着谁走: 不随任何东西, 隔离: "—" }
  text:
    label: 代码段 / 全局数据
    sub: 映射自 ELF
    detail: execve 把 ELF 的各段映射进一块全新的虚拟地址空间。text 只读不是约束而是省法：==同一程序的多个实例可以共享同一批物理页。==
    facts: { 归属: 全组共享, 份数: 一份映射, 跟着谁走: 随进程, 隔离: 同一张页表——往外有墙，对内没墙 }
  heap:
    label: 堆
    sub: 1 份 · 全组共用
    detail: malloc 向上长，free 回缩；容量调整最终由内核经 brk/mmap 完成。==全组只有一份==，所以多线程改它要想锁。
    facts: { 归属: 全组共享, 份数: 一份, 跟着谁走: 随进程, 隔离: 同一张页表——谁也不挡谁 }
  ustacks:
    label: 用户栈
    sub: 每条执行流一根
    detail: 三根栈在==同一块地址空间里相邻摆放==。「私有」是约定（各线程只维护自己的栈），不是硬件隔离——野指针可以跨栈踩，见 §03。
    facts: { 归属: 每条执行流一根, 份数: 3 根（单线程时 1 根）, 跟着谁走: 随线程, 隔离: 同一张页表——私有只是约定 }
  files:
    label: files_struct · fd 表
    sub: 1 份 · 偏移量都共享
    detail: 线程 A open 出来的 fd，线程 B ==立刻可见==，连读写偏移量都是同一份。两个线程对同一个 fd 交替 read，会各读各的片段——共享的能力，也是共享的坑。
    facts: { 归属: 全组共享, 份数: 一份, 跟着谁走: 随进程, 隔离: 连读写偏移量都共享 }
  sighand:
    label: sighand_struct · 信号
    sub: 处置共享，掩码私有
    detail: 任一线程改了 SIGTERM 的处置函数，全组立即可见。信号掩码反而是每线程私有的——屏蔽哪些信号是「这条执行流自己的选择」。
    facts: { 归属: 处置共享 / 掩码私有, 份数: 一份 + 每线程一份掩码, 跟着谁走: 混合, 隔离: "—" }
  mm:
    label: mm_struct · 地址空间
    sub: 1 份 · 页表 + 各段 VMA
    detail: §01 说的「独立地址空间」的实体：页表加各段 VMA（虚拟内存区域）的描述。==每进程一张页表==，翻译之后才落到物理内存。内核线程没有它（mm 为 null），因为没有用户态内存可管。
    facts: { 归属: 每进程一份, 份数: 一份（页表 + VMA）, 跟着谁走: 随进程, 隔离: 每进程一张表 = 有墙 }
  task0:
    label: task T0 · 主线程
    sub: execve 造出第一个
    detail: 内核描述「一个任务」的结构叫 task_struct，实测约 8KB、155 个字段。==它存的是指针，不是资源本体==——PC、寄存器、内核栈才是它自己的东西。
    facts: { 归属: 每条执行流一份, 份数: 一个 task_struct, 跟着谁走: 随线程, 隔离: 资源全是引用 }
  task1:
    label: task T1
    sub: pthread_create 造出
    detail: 和 T0 平级的另一个 task。创建它没有复制任何资源，只复制了几个指针外加一个新内核栈（§06 算这笔账）。
    facts: { 归属: 每条执行流一份, 份数: 一个 task_struct, 跟着谁走: 随线程, 隔离: 资源全是引用 }
  task2:
    label: task T2
    sub: 同组 · getpid 相同
    detail: 同一线程组的 task 共享 PID、各持自己的 tid。==getpid 返回的是线程组 ID==，`ps -eLf` 的 LWP 列就是这些 tid。
    facts: { 归属: 每条执行流一份, 份数: 一个 task_struct, 跟着谁走: 随线程, 隔离: 资源全是引用 }
  pmem:
    label: 物理内存
    sub: 翻译后的落点
    detail: 页表既是翻译器也是隔离墙：两个进程的同一个虚拟地址，翻译到不同的物理帧（§03 展开）。
    facts: { 归属: 硬件, 份数: 一条物理内存, 跟着谁走: 不随任何东西, 隔离: 同不同靠页表分 }
  cpu:
    label: CPU 核
    sub: task 轮流上
    detail: ==调度器面前没有进程，只有 task。== 三条执行流各自排队、各自上核，这是并行的来源（§04 展开）。
    facts: { 归属: 硬件, 份数: 4 个核, 跟着谁走: 不随任何东西, 隔离: task 轮流上 }
anchors:
  - { part: task0, label: "task（执行流的本体）" }
  - { part: mm, label: "地址空间" }
  - { part: files, label: "fd 表" }
  - { part: elf, label: "程序（还没跑的）" }
  - { part: loader, label: "execve 那三件事" }
scenarios:
  - id: multi
    label: 3 条执行流
    note: pthread_create 之后：多了两条执行流，资源一份没多
  - id: one
    label: 1 条执行流
    note: execve 刚返回：只有主线程。淡掉的那两个零件这时还没被创建
    dim: [task1, task2]
tours:
  - id: become
    label: "从程序到一个进程"
    steps:
      - { at: [elf, loader], text: "磁盘上只有一份静态字节。execve 把它交给内核里的加载器——==它不执行，也不持有任何「进行中」的状态==。" }
      - { at: [text, heap, ustacks], text: "第一件事：==按段映射进一块全新的地址空间==。代码段从 ELF 来，堆是空的等着 malloc 长，栈等着函数调用压。" }
      - { at: [files, sighand], text: "第二件事：==初始化内核资源== —— fd 表、信号处置、凭证。注意这一步还没有任何线程，这些对象先建好、就位。" }
      - { at: [task0], text: "第三件事：==创建至少一条执行流==。到这里程序变成了进程：静态字节有了 PC、寄存器和内核栈。" }
      - { at: [mm, pmem], text: "同一条路径再走一遍之前，先记住一件事：==每进程一张页表==。同一个 ELF 加载 N 次，就是 N 个各自独立的实例。" }
  - id: threads
    label: "多出来的线程从哪来"
    steps:
      - { at: [task0, task1], text: "pthread_create 不复制任何资源。它在内核里新建一个 ==task==——右边这样一个执行现场，然后把它加进 T0 的线程组。" }
      - { at: [mm, files, sighand], text: "新 task 的 mm、files、sighand 指针==直接指向 T0 那几份对象==。资源没有翻倍，多出来的只是引用。" }
      - { at: [ustacks], text: "真正新建的只有==栈和寄存器现场==。切到「1 条执行流」看看少的是什么，就明白多线程多在哪了。" }
      - { at: [cpu], text: "调度器面前==没有进程，只有 task==。三条执行流各自排队、各自上核——这就是并行的来源。" }
  - id: ownership
    label: "什么东西归谁"
    steps:
      - { at: [text, heap], text: "代码和堆：==全组一份==。线程间共享数据不用走 IPC（进程间通信），直接读写——代价是数据竞争要自己加锁。" }
      - { at: [ustacks], text: "栈：每条执行流一根。但三根栈都在==同一张页表之下==，「私有」是约定，不是硬件隔离。" }
      - { at: [files], text: "fd 表：A 打开的 fd，B ==立刻看得见==，连偏移量都是共享的。" }
      - { at: [sighand, mm], text: "信号处置、地址空间同理。==归进程所有的东西，线程组里人人共享==——这就是下面那张清单的来源。" }
```

这张图同时纠正一个直觉：进程不是「一块大内存」。

```compare
first: 
head: [直觉（错）, 实际]
rows:
  - 进程的内核结构: ["一个大结构体，把代码、数据、堆、栈全装进去", "一张对象关系图：task_struct 只存==指向资源的指针=="]
  - 结构体大小: ["应该很大吧", "task_struct 实测约 8KB、155 个字段，它描述的资源以 MB 计——永远装不下"]
  - 资源放哪: ["内联在进程结构体里", "独立成对象（mm / files / sighand…），因为多个执行流要共享，且文件、映射的生灭比进程本体细"]
```

内联模型表达不了「两份描述共享一份资源」，也跟不上「文件先于进程 close、映射随时 munmap」的粒度。Linux 的做法和文件系统同构：task_struct 之于进程资源，正如 inode 之于文件数据：存元数据和指针，不内联内容。`/proc/<pid>/` 目录（fd、maps、status）就是这张对象关系图的只读投射，排查「进程开了哪些文件、映射了哪些内存」全在这。

## 02 · 从程序到进程：加载器做了三件事

这三件事不用另画一张图 —— ==§01 那张图的顶行就是它==：左边的 ELF 进去，中间的「加载器」按 ①②③ 列着三件事，右下角那条线接到主线程。这里只补图里放不下的部分。

**① 按段映射进新地址空间。** 映射的单位是段，不是整个文件：`text` 只读，所以同一程序的多个实例能共享同一批物理页；`bss` 在文件里根本不占空间，映射时补零。这一步建的是**一张全新的页表**，不是从谁那里复制来的——复制页表是 fork 的事，而且有 COW 打折（§06）。

**② 初始化内核资源。** 文件表、信号处置、凭证、命名空间各就各位。注意这一步里**有继承、也有重置**：fd 表默认继承（0 / 1 / 2 就是 shell 递过来的），凭证据说继承；而==被 `catch` 过的信号会被重置成默认处置==，只有本来就设成 `SIG_IGN` 的保持忽略（`SIGCHLD` 是个特例）。所以 execve 之后的程序不会莫名其妙撞上一个自己没设过的信号处理函数。

**③ 创建至少一条执行流。** 主线程的寄存器现场被设置成「从 ELF 头里记的入口点开始执行」。所以 execve 成功之后，代码**不是**从 C 的 `main` 开始跑的——`main` 是 C 运行时库接手的，内核眼里只有 ELF 那个入口地址。

这个「静态内容 vs 运行实例」的关系，和 git 里 commit 与 working tree 同构：

```compare
first: 
head: [git 世界, 进程世界]
rows:
  - 静态的: ["commit 对象：不可变快照，躺在 .git 里", "可执行文件：静态字节，躺在磁盘上"]
  - 实例: ["working tree：可改、可删、有未提交的中间态", "进程：寄存器、栈、打开文件随时在变"]
  - 一对多: ["同一个 commit 能 checkout 出 N 个互不相干的工作区", "同一个二进制能拉起 N 个互不相干的进程"]
  - 差异点: ["工作区的状态是文件内容", "进程的状态是执行现场（§04 的主角）"]
```

### 为什么非要这套抽象：四个冲突逼出四个机制

「进程拥有自己的内存」并不是天然的。让两个程序裸跑在同一块物理内存和同一个 CPU 上，四件人祸依次发生：A、B 都从固定地址加载，互相覆盖；A 的一条 store 直接写进 B 的数据区，没有东西拦；A 死循环，B 永远轮不到 CPU；A 的野指针写穿内存，B 陪葬，还说不清该杀谁。

```compare
first: 冲突
head: [化解机制, 新引入的边界]
rows:
  - 地址冲突: ["虚拟地址空间 + 页表", "每进程一张表，地址视图私有"]
  - 越权访问: ["特权级（用户态 / 内核态）", "系统调用是唯一的门"]
  - 长期占用: ["时钟中断 + 调度器", "时间片到期必须让出"]
  - 故障扩散: ["资源记账（进程控制块 PCB 的雏形）", "可以单独清算、单独回收"]
```

组合起来就是 OSTEP 说的**受限直接执行**：为了性能让用户程序直接跑在 CPU 上；为了控制权，内核只在三类事件上收回现场。

```text
// 受限直接执行：用户代码全速直跑，内核守住三个「回收点」
while (true) {
  enter_user_mode(proc->pc);   // 降特权级，全速执行
  switch (event) {             // 内核不在场，直到硬件抛回三类事件之一
    case TRAP:  syscall_dispatch(proc); break;  // 系统调用：主动请求服务
    case FAULT: handle_fault(proc);     break;  // 异常：缺页补页，段错误终止
    case TIMER: schedule_next(proc);    break;  // 时钟中断：时间片尽，强制换人
  }
}
```

「受限」限制的不是用户程序能做什么，而是内核现身的时机。直跑换性能，三个回收点换控制权。这段骨架就是任何现代内核的调度入口。

## 03 · 地址空间：墙在页表上，不在布局里

一个典型 Linux 用户进程的虚拟地址空间，从高到低：

```memmap
title: 一个进程的虚拟地址空间
sub: "Linux · 布局是静态结构，隔离能力不来自它"
high: "0x7fff_ffff_ffff"
low: "0x0000_0000_0000"
segments:
  - { label: 内核保留区, sub: "内核态才可见，用户代码够不到", tone: muted, size: 1.1, mark: "用户态不可达" }
  - { label: 栈, sub: "函数调用压栈向下长，返回回缩", tone: blue, size: 1.6, dir: down, mark: "随线程走" }
  - { label: （空洞）, sub: "给栈和堆各留增长空间，相距很远", tone: muted, size: 0.8, mark: "" }
  - { label: 堆, sub: "malloc 向上长；容量由内核经 brk/mmap 调整", tone: violet, size: 1.6, dir: up, mark: "随进程走 · 全组一份" }
  - { label: mmap 区, sub: "共享库、文件映射；线程栈也是 mmap 出来的一块", tone: blue, size: 1.2, mark: "随进程走" }
  - { label: bss / data, sub: "未初始化 / 已初始化全局变量", tone: blue, size: 0.9, mark: "随进程走" }
  - { label: text, sub: "只读代码段；多实例可共享同一批物理页", tone: green, size: 1.0, mark: "只读 · 可共享" }
note: 分界线画在「随线程走 / 随进程走」：栈每条执行流一根，其余全组一份。
```

布局本身给不了隔离。隔离来自**翻译**：进程里的地址全是虚拟地址，CPU 每次访存都要过页表翻成物理地址；每进程一张页表，寄存器里存着当前那张的地址，上下文切换换表等于给 CPU 换一个翻译器。

```arch
svg: pt-mm
caption: ==左边有墙，右边没有。== 左边两个进程各有各的页表，同一个虚拟地址 0x601000 查表落到不同物理帧，同名同址的变量互不相干。右边三条线程共用一张页表，所以 T1 的野指针能直接写进 T2 的栈，页表拦不住。墙的判定标准只有一条：查的是哪张表。每个零件里也写着自己那几行：谁指向它、TLB 缓存了什么、隔壁那根栈谁能写。
bodies:
  procA:
    badge: 进程 A
    rows:
      - { k: x 的地址, v: 0x601000（虚拟） }
      - { k: 它以为, v: 这就是真实位置, tip: 进程给出的永远是虚拟地址：它以为的地址，不是物理位置 }
  ptA:
    badge: A 的翻译器
    rows:
      - { k: 谁指向它, v: PTBR 寄存器, tip: 上下文切换换页表，等于给 CPU 换一个翻译器 }
      - { k: 谁在用, v: 只有进程 A }
  frame42:
    badge: 物理帧 42
    rows:
      - { k: 住着, v: A 的 x = 1 }
      - { k: TLB, v: 把这条翻译缓存起来, tip: TLB 摊薄「每次访存都查表」的开销 }
  procB:
    badge: 进程 B
    rows:
      - { k: x 的地址, v: 也是 0x601000 }
      - { k: 含义, v: 同名同址，毫不相干 }
  ptB:
    badge: 另一张表
    rows:
      - { k: 谁在用, v: 只有进程 B }
      - { k: 切换成本, v: PCID / ASID 给 TLB 项打标签, tip: 所以进程切换不必全量刷 TLB —— 没有直觉里那么贵 }
  frame87:
    badge: 物理帧 87
    rows:
      - { k: 住着, v: B 的 x = 2 }
      - { k: 和帧 42, v: 毫无关系 }
  t1s:
    badge: T1 的栈
    rows:
      - { k: 私有, v: 约定，不是硬件墙 }
      - { k: 隔壁, v: T2 的栈 }
  t2s:
    badge: T2 的栈
    rows:
      - { k: 摆在, v: T1 栈隔壁 }
      - { k: 谁能写, v: T1 的野指针能直接写进来, tip: 权限上同进程任何线程都能读写任何栈区 }
  t3s:
    badge: T3 的栈
    rows:
      - { k: 在哪, v: 同一张页表之下 }
      - { k: 谁管的, v: mmap 出来的一块 }
  sharedheap:
    badge: 全组一份
    rows:
      - { k: 共享, v: 直接读写，不用 IPC }
      - { k: 代价, v: 数据竞争 · 内存可见性, tip: 省了序列化和拷贝，换来锁与原子操作 }
    note: 连显式的消息边界都没有
parts:
  procA:
    label: 进程 A
    sub: VA 0x601000
    detail: 跑的是同一份程序的另一个实例。它读写 x 时给出的都是虚拟地址——==它以为的地址==，不是物理位置。
  ptA:
    label: 页表 A
    sub: A 的翻译器
    detail: 每进程一张，页表基址寄存器（PTBR）指向当前那张。==上下文切换换页表，等于换一个翻译器==，也换了一个世界。
  frame42:
    label: 物理帧 42
    sub: A 的 x = 1
    detail: A 写 x=1，经页表 A 落到帧 42。TLB 把（虚拟页号→物理帧号）缓存起来，摊薄「每次访存都查表」的开销。
  procB:
    label: 进程 B
    sub: VA 0x601000
    detail: 和 A 同名同址的那个 x，在 B 的世界里也是 0x601000——==虚拟地址相同不代表任何共享==。
  ptB:
    label: 页表 B
    sub: 另一张表
    detail: 现代 CPU 用 PCID/ASID 给 TLB 项打进程标签，切换不必全量刷 TLB——==进程切换没有直觉里那么贵==（§04 回来看这笔账）。
  frame87:
    label: 物理帧 87
    sub: B 的 x = 2
    detail: B 写 x=2 落到帧 87，A 毫无感知。物理内存只有一条，分区不存在——==隔离是查表查出来的==。
  t1s:
    label: T1 的栈
    sub: 「私有」= 约定
    detail: 编译器与运行时保证各线程只维护自己的栈。==权限上同进程任何线程都能读写任何栈区==。
  t2s:
    label: T2 的栈
    sub: 摆在 T1 栈隔壁
    detail: 野指针、缓冲区溢出可以跨线程踩坏别人的栈——==故障域是进程级==，这是线程与进程最本质的差别之一（§07）。
  t3s:
    label: T3 的栈
    sub: 同一张页表之下
    detail: 「线程拥有栈、进程拥有堆」只是使用权约定，不是结构事实。栈同样在进程地址空间内部，是 mmap 出来的一块。
  sharedheap:
    label: 堆 · 全组一份
    sub: 直接读写
    detail: 共享是能力也是坑：省了 IPC 的序列化和拷贝，换来数据竞争、锁、原子操作和内存可见性问题——==共享内存连显式的消息边界都没有==。
anchors:
  - { part: ptA, label: "页表" }
  - { part: frame42, label: "物理内存" }
  - { part: t1s, label: "线程的栈" }
  - { part: procA, label: "进程" }
tours:
  - id: translate
    label: "同一个虚拟地址，两个世界"
    steps:
      - { at: [procA], text: "进程 A 读 0x601000。这个地址只是它自己世界里的门牌号，==不是物理内存的位置==。" }
      - { at: [ptA], text: "CPU 拿门牌号查 ==A 的页表==。每个进程一张表，寄存器里记着当前那张。" }
      - { at: [frame42], text: "翻译结果：物理帧 42。A 写 x=1，落在这。" }
      - { at: [procB, ptB, frame87], text: "进程 B 读==同样的 0x601000==，查的是另一张表，落到帧 87。两个 x 同名同址，互不相干。" }
      - { at: [frame42, frame87], text: "物理内存从头到尾只有一条。==墙不在内存分区上，在页表上==——切换换一张表，世界就换了。" }
  - id: nowall
    label: "线程之间没有墙"
    steps:
      - { at: [t1s, t2s], text: "三根栈相邻摆在同一块地址空间里。T1 的野指针可以==直接写进 T2 的栈==——它俩用的是同一张页表，页表拦不住自己人。" }
      - { at: [sharedheap], text: "堆更是明着共享：==直接读写，不用 IPC==。省了拷贝，换来数据竞争和内存可见性问题。" }
      - { at: [t1s, t2s, t3s, sharedheap], text: "所以线程的==故障域是整个进程==：一条执行流写坏内存，全组陪葬。Chrome 给每个标签页独立进程，买的就是左半边那堵墙。" }
```

## 04 · 在 CPU 上流转：一切都是两条队列之间的搬运

进程状态常被画成一堆标签，更准确的视角是：==状态是任务此刻挂在哪条队列上的投影==。排进运行队列的才有资格上核；阻塞的任务在等待队列里，调度器看都不看它。

```arch
svg: pt-run
caption: ==调度器在两条队列之间搬任务。== A 在核上全速直跑时内核不在场；时钟中断到点，调度器从运行队列挑下一个上核，A 回队尾。A 调 read 时是自己走进等待队列的；数据到了，中断把它移回去。阻塞高效的原因就写在图上：等待队列里的任务不占「等核」的名额。两条队列这次画成了==一排格子== —— 谁在队里、还剩几个空位，一眼看得见。
bodies:
  taskA:
    badge: 用户态 · 全速直跑
    rows:
      - { k: 此刻, v: 在核上执行，内核不在场 }
      - { k: PC / 寄存器, v: 在它自己的现场里 }
    note: 能被收走，靠的是下面那三样硬件机制
  sched:
    badge: 内核
    rows:
      - { k: 挑谁, v: 从运行队列里选一个 }
      - { k: 怎么挑, v: 优先级 / 公平性 / 缓存亲和 }
    note: 动作只有一件事：选一个 —— 规则可以很复杂
  runq:
    badge: 排队的才有资格上核
    cells:
      - { label: A, sub: 在跑, tone: blue }
      - { label: B, sub: 等核 }
      - { label: C, sub: 等核 }
      - { label: 空, tone: idle, tip: 排进这条队列的才有资格上核 }
    note: SMP 下每个 CPU 一条自己的运行队列
  waitq:
    badge: 调度器看都不看
    cells:
      - { label: D, sub: 等 read }
      - { label: E, sub: 等锁 }
      - { label: 空, tone: idle }
      - { label: 空, tone: idle }
    note: 不占「等核」的名额 —— 阻塞高效的原因就写在这
  timer:
    badge: 硬件
    rows:
      - { k: 周期, v: CONFIG_HZ（常见 250 / 1000） }
      - { k: 到点了, v: 时间片尽，强制换人 }
  cpu:
    badge: 并行只在这发生
    cells:
      - { label: 核 0, sub: 跑 A, tone: blue, tip: 同一时刻，一个核只跑一条执行流 }
      - { label: 核 1, sub: 跑别的 }
      - { label: 核 2, sub: 空闲, tone: idle }
      - { label: 核 3, sub: 空闲, tone: idle }
    note: 核数决定同一时刻真正并行几条
  dev:
    badge: 硬件
    rows:
      - { k: 数据到了, v: 设备发中断 }
      - { k: 中断处理, v: 把等它的任务移回运行队列 }
    note: 阻塞的任务由中断叫回来，不靠轮询
parts:
  taskA:
    label: 任务 A
    sub: 正在核上全速直跑
    detail: 此刻内核不在场，「受限直接执行」里不受限的那一半。它能被收走，靠的是下面那三样硬件机制。
  sched:
    label: 调度器
    sub: 挑下一个上核
    detail: 规则可以很复杂（优先级、公平性、缓存亲和），动作只有一件事：==从运行队列里选一个==。多核（SMP）下每个 CPU 一条自己的运行队列，跨 CPU 唤醒和负载均衡是额外机制。
  runq:
    label: 运行队列
    sub: 排队等核
    detail: 每条队列是一个 CPU 的候选名单。时间片耗尽或被更高优先级抢占的 task ==回这里排队==，等待下一次点名。
  waitq:
    label: 等待队列
    sub: 一事件一条队
    detail: 挂在设备、锁、定时器上。==阻塞的任务不在这里排队等核，而是等事件==——这就是「状态是队列的投影」。内核在 wait_event/wake_up 两侧防死锁：先入队再查条件（防睡过头），schedule 前再查一次信号（防带信号睡死）。
  timer:
    label: 时钟
    sub: 硬件定时器
    detail: 周期性打断 CPU，把控制权交还内核。==没有它，一个死循环就独占整台机器==——四冲突里的「长期占用」就是它治的。
  cpu:
    label: CPU 核
    sub: 核 0 跑着 A
    detail: 真正执行指令的地方。核就那么几个，task 永远比核多，所以需要队列，所以空着的核就是真的在闲着。
  dev:
    label: 磁盘 / 网卡
    sub: 数据的来源
    detail: read 的数据最终从这里来。设备就绪后发中断，==唤醒是设备干的，不是进程干的==——进程只参与最后一步：被挑中后继续跑。
anchors:
  - { part: cpu, label: "CPU 核" }
  - { part: runq, label: "运行队列" }
  - { part: waitq, label: "等待队列" }
  - { part: timer, label: "时钟中断" }
tours:
  - id: preempt
    label: "时间片到点：换人"
    steps:
      - { at: [taskA], text: "A 在核上全速直跑，==内核不在场==。" }
      - { at: [timer], text: "硬件定时器到点，==时钟中断==把控制权从 A 手里收回来——内核现身的三个回收点之一。" }
      - { at: [sched], text: "schedule() 挑下一个。规则可以很复杂，==动作只有一件事：从运行队列里选一个==。" }
      - { at: [runq, cpu], text: "被挑中的 task 上核；==A 的寄存器现场存进它的 task_struct，人回到队尾==。下次它从断点继续。" }
  - id: block
    label: "一次 read 的阻塞与唤醒"
    steps:
      - { at: [taskA, waitq], text: "A 调 read() 但数据没到。它把自己挂进==等待队列==，调度器从此不再看它。" }
      - { at: [runq], text: "阻塞高效的原因就在这：==它不在运行队列里==，不占「等核」的名额，别的 task 该跑照跑。" }
      - { at: [dev, waitq], text: "磁盘把数据备好，==发中断==。内核把 A 从等待队列移出来。" }
      - { at: [runq, sched], text: "A ==回到运行队列==，重新变成「有资格上核」的 task，等调度器下一次点名。" }
```

把这套搬运写成状态，就是经典的五个概念状态：

```flow
grid: true
nodes:
  - { id: ready,   label: ready,   sub: 排队等 CPU, row: 0, tone: blue, shape: pill, initial: true }
  - { id: running, label: running, sub: 唯一在 CPU 上的状态, row: 0, tone: green, shape: pill }
  - { id: zombie,  label: terminated, sub: 已退出 · 退出码留着等父进程来收, row: 0, tone: red, shape: pill }
  - { id: stopped, label: stopped, sub: 被信号挂起, row: 2, tone: muted, shape: pill }
  - { id: blocked, label: blocked, sub: 等事件 · 不在运行队列里, row: 1, tone: amber, shape: pill }
  - { id: reaped,  label: 回收（reap）, sub: 进程表项消失, row: 1, tone: violet, shape: pill }
edges:
  - { from: ready, to: running, label: 上核, labelDy: 30 }
  - { from: running, to: ready, label: 被换下, labelDy: 52 }
  - { from: running, to: blocked, label: 主动阻塞 }
  - { from: blocked, to: ready, label: 事件到 }
  - { from: blocked, to: stopped, label: 暂停, labelDy: -18 }
  - { from: stopped, to: blocked, label: 继续, labelDy: 18 }
  - { from: running, to: zombie, label: 退出, labelDy: 28 }
  - { from: zombie, to: reaped, label: wait() }
```

每条边由谁触发，各不相同：**上核**与**被换下**是调度器的决定（时间片耗尽或被更高优先级抢占）；**主动阻塞**是任务自己发起的（read、拿锁、sleep）；**事件到**由唤醒方触发（I/O 完成、锁释放、定时到期）；**暂停**与**继续**由信号完成（SIGSTOP / SIGCONT）。退出可以从任何状态到达（`exit()` 或 SIGKILL），图上只画了 running 这一条代表。

两处校准。其一，Linux 的真实枚举比教材五状态更细，不能机械映射：

```compare
first: 教材状态
head: [Linux 枚举, 差别在哪]
rows:
  - running / ready: ["TASK_RUNNING（合并成一个）", "「正在跑」和「排队等跑」是同一个标志位；被换上换下，标志不变"]
  - blocked: ["TASK_INTERRUPTIBLE / TASK_UNINTERRUPTIBLE", "区分可被信号打断与不可打断的睡眠（等磁盘的 D 状态属于后者）"]
  - stopped: ["TASK_STOPPED", "由信号进出"]
  - terminated: ["EXIT_ZOMBIE", "已退出、等父进程收尸"]
```

其二，现代内核真正被调度的单位是 task（线程）：「进程状态」严格说是教学层面的简化说法。

### 一次上下文切换，保存的是三层现场

「切换 = 记下 PC」是漏的。执行现场至少三层：

```compare
first: 现场层
head: [内容, 切换时怎么处理, 成本]
rows:
  - 执行上下文: ["寄存器 + 栈（用户态栈 + 内核栈）", "显式保存恢复；PC 不用单独存——恢复点就在自己内核栈上", "微秒级直接成本"]
  - 地址空间上下文: ["页表基址", "mm 不同才换；同进程线程间免了这一步", "PCID/ASID 已大幅缓解"]
  - 缓存工作集: ["留在 L1/L2、TLB 里的热数据", "==没有归属，只能靠下次运行重新热身==", "难测，往往是大头"]
```

两个细节值得点破。只保存 callee-saved 寄存器，是因为调用约定保证 caller-saved 在函数边界处已经失效，内核只需保存自己承诺保存的那几个，切换代码因此能短成几行汇编。切换必须进内核，是因为页表与运行队列只有内核态能写：没有哪个任务能把自己换下 CPU，切换永远是「内核替 A 收摊、替 B 摆摊」。

数字给个体感（2018 年 Haswell i7-4771 实测，taskset 固定单核）：线程切换约 1.2–1.5 微秒，同机 memcpy 64 KiB 约 3 微秒，一次切换比复制 64 KiB 还快；Go 的 goroutine 切换约 170 纳秒，因为完全不进内核。「进程切换比线程切换慢几个数量级」是过时说法：PCID/ASID 让进程切换不必全刷 TLB，线程省的主要是地址空间这一块，==缓存热身谁都逃不掉==（不同线程的工作集不同，照样互相污染）。

### 从创建到消亡：fork、exec、exit、wait

```journey
- tag: ① fork
  tone: blue
  name: 一分为二
  badge: 返回值区分身份
  fields:
    - { k: 父进程拿到, v: "子进程的 PID" }
    - { k: 子进程拿到, v: "0" }
    - { k: 内存, v: "共享只读页（写时复制 COW）" }
  note: 复制全部内存太贵，写时复制：谁先写谁触发缺页，内核复制那一页再放行。
  next: "execve :: ::"

- tag: ② exec
  tone: violet
  name: 换一个程序
  badge: 替换地址空间
  fields:
    - { k: 动作, v: "用新二进制替换当前映像" }
    - { k: 之前共享的页, v: "直接丢弃，连复制都省了" }
  note: shell 启动命令都是先 fork 再 exec：fork 出一个可以随便挥霍的牺牲品，exec 把它变成目标程序。两步之间的窗口期里重定向 stdin/stdout、建管道，全靠这个时序。
  next: "exit :: ::"

- tag: ③ exit
  tone: amber
  name: 已死未葬 (zombie)
  badge: PCB 还在
  fields:
    - { k: 退出状态, v: "退出码 / 终结信号" }
    - { k: 谁来收, v: "父进程 wait()" }
  note: 退出状态是父子之间唯一的临终交接，必须留着。父进程不调 wait()，zombie 就一直占着进程表项，ps 里标 Z (defunct)。
  next: "wait :: 收尸"

- tag: ④ wait
  tone: green
  name: 回收 (reap)
  badge: 进程表项消失
  fields:
    - { k: 动作, v: "释放 PCB" }
    - { k: 若父先退出, v: "子被过继给 init" }
  note: zombie 是「子死了父没回收」，orphan 是「父死了子还活着」。两个词经常被混成一谈。
```

顺带一个族类：内核线程是「没有用户态资源的任务」，没有地址空间和打开文件，专供内核与驱动做需要阻塞的操作，ps 里以 `[kworker]`、`[ksoftirqd]` 的名字出现。§06 会看到它在谱系上的位置。

## 05 · 线程：为什么不是「再多开几个进程」

一个 web 服务器要同时服务多个请求。最省事的单线程串行有一个结构性病根：所有任务共用同一个执行位置（一个 PC、一条调用栈），B 的 read() 一阻塞，整条执行流停住，没人去 accept 下一个连接。「等」与「算」永远无法重叠。

早期 web 服务器的答案是 fork-per-request：每来一个请求 fork 一个子进程。它有真隔离，但代价清单很长：每个子进程一份代码、堆、页表（COW 省不掉页表和进程管理的固定开销）；共享状态只能走管道、共享内存、消息队列，要序列化、要拷贝、要协议；并发量上去后内存与调度开销线性膨胀。

```compare
first: 
head: [单线程串行, 每任务一进程, 单进程多线程]
rows:
  - 阻塞时谁停: ["整个进程停摆", { text: "别的进程照跑", tone: green }, { text: "只有那条线程停", tone: green }]
  - 共享状态: ["没有共享问题：只有一个执行者", "要走 IPC：序列化 + 拷贝 + 协议", "直接读写同一块堆"]
  - 隔离: ["不存在", { text: "一个崩，其余无感", tone: green }, "一条线程写坏内存，全组陪葬"]
  - 开销: ["最低", "地址空间重复 + 固定资源开销", { text: "只多一根栈和一份寄存器现场", tone: green }]
```

线程被逼出来，解决的是「同一资源域内允许多个执行位置并存」。它的私有与共享清单，man7 的 pthreads(7) 逐项列过：

```compare
first: 
head: [每条线程私有, 全组共享]
rows:
  - 执行现场: ["程序计数器、寄存器组、栈指针、用户栈、内核栈", "—"]
  - 身份: ["线程 ID（pthread_t，进程内唯一）、tid", "PID、父进程 PID、进程组与会话"]
  - 调度: ["调度策略与优先级、CPU affinity（Linux 下 per-thread）", "nice 值、资源限制、CPU 时间统计"]
  - 数据: ["TLS（线程局部存储）、errno", "代码段、全局数据、堆、内存映射"]
  - 其他: ["信号掩码（屏蔽哪些信号是这条流自己的选择）", "文件描述符表、信号处置、umask、当前目录与根目录、定时器"]
```

共享侧有个容易被忽略的后果：线程 A open 出来的 fd，线程 B 直接可见，==连偏移量都是共享的==。两个线程对同一个 fd 交替 read，会各读各的片段。errno 必须每线程一份的原因最直白：它记录「最近一次调用的错误码」，共享一份会互相覆盖。

## 06 · 同一扇门，两种走法

Linux 内核里根本没有「线程对象」。只有一种对象 task_struct；「进程」和「线程」的区别不在类型，在资源共享程度：创建线程与创建进程走的是同一个系统调用 clone()，区别只在一串开关。

```arch
svg: pt-clone
caption: ==fork 和 pthread_create 落到同一个调用 clone()。== 左边开关全关：资源整套复制（COW 打折），出来的是两个资源域，也就是进程。右边开关全开：资源一份不复制，只新建一个执行流，也就是线程。往反方向拧（CLONE_NEW*）：资源照旧各一份，再另立命名空间，也就是容器。中间那个框里列的==就是四个开关本身==。
bodies:
  taskA:
    badge: 父 task
    rows:
      - { k: 握着的, v: mm · files · sighand 指针 }
      - { k: 要点, v: 复制指针 = 共享；复制资源 = 隔离, tip: 「指针味」是理解这张图的钥匙 }
  clone:
    badge: 同一扇门
    cells:
      - { label: CLONE_VM, sub: 地址空间, tip: 带上 = 页表指针复用，不带 = 复制一套 }
      - { label: CLONE_FILES, sub: fd 表 }
      - { label: CLONE_FS, sub: cwd / umask }
      - { label: CLONE_SIGHAND, sub: 信号处置 }
    note: 全不带 → fork；全带上 → pthread_create
  taskBf:
    badge: fork
    rows:
      - { k: getpid, v: 不同 }
      - { k: 从哪继续, v: fork 的下一行 }
      - { k: 返回值, v: 父拿到子的 PID，子拿到 0 }
    note: 从此谁也看不见谁
  resBf:
    badge: 资源 ×2 套
    cells:
      - { label: 页表, sub: 各一份 }
      - { label: 文件表, sub: 各一份 }
      - { label: 信号, sub: 各一份 }
    note: COW 打折：第一次写才真复制那一页
  taskTp:
    badge: pthread_create
    rows:
      - { k: getpid, v: 相同 · tid 不同 }
      - { k: 真正新建的, v: 栈 · 寄存器现场 · 内核栈 · TLS · 掩码 }
    note: 其余全是引用
  resSp:
    badge: 资源 ×1 套
    rows:
      - { k: mm / files / sighand, v: 还是 A 那份（指针）, tip: 创建便宜的全部原因就在这：几个指针加一个新内核栈 }
    note: NPTL 时代线程创建比旧实现快约 7 倍
  container:
    badge: 反向开关 NEW*
    cells:
      - { label: CLONE_NEWNS, sub: 挂载点 }
      - { label: CLONE_NEWIPC, sub: IPC }
      - { label: CLONE_NEWNET, sub: 网络 }
    note: 带标志 = 「另立一个」：资源照旧各一份，命名空间也切开
parts:
  taskA:
    label: task A · 父
    sub: 握着一套资源指针
    detail: 它的 mm、files、sighand 字段指向内核里几份独立的资源对象。「指针味」是理解这张图的钥匙：==复制指针 = 共享，复制资源 = 隔离==。
  clone:
    label: clone()
    sub: 同一扇门
    detail: fork() 等于不带任何共享标志的 clone()；pthread_create() 等于四个标志全带。==共享程度是 clone 参数里的连续刻度==，不是二选一——勾一部分也是合法组合。
  taskBf:
    label: task B · 子进程
    sub: getpid 不同
    detail: 从 fork 那一行继续跑，靠返回值区分身份：父拿到子的 PID，子拿到 0。==从此谁也看不见谁==。
  resBf:
    label: 资源 ×2 套
    sub: COW 打折的深拷贝
    detail: 页表、文件表、信号处置各来一份。fork 后父子共享物理页、页表项标只读，==谁先写谁触发缺页，内核复制那一页再放行==——对 exec 尤其划算，反正要全部覆盖。
  taskTp:
    label: task T · 新线程
    sub: getpid 相同 · tid 不同
    detail: 新建的东西只有：task_struct 本体、寄存器现场、一根用户栈、一个内核栈、TLS、信号掩码。==其余全是引用==。
  resSp:
    label: 资源 ×1 套
    sub: 还是 A 那份
    detail: mm/files/sighand 的指针直接复用。==创建便宜的全部原因就在这==：NPTL 时代线程创建比旧实现快约 7 倍，结构基础就是几个指针加一个新内核栈。
  container:
    label: 容器 · 一组进程
    sub: 反向开关 NEW*
    detail: CLONE_NEWNS / CLONE_NEWIPC / CLONE_NEWNET 方向是反的——clone 默认继承父进程的命名空间，带标志表示「另立一个」。==容器共享的是内核，隔离的是命名空间；线程共享的是进程资源域==。两种「轻」不是一回事。
anchors:
  - { part: clone, label: "clone()" }
  - { part: taskBf, label: "fork" }
  - { part: taskTp, label: "线程" }
  - { part: container, label: "容器" }
tours:
  - id: fork
    label: "fork 的账单"
    steps:
      - { at: [taskA, clone], text: "fork() 和 pthread_create() 在内核里落到==同一个系统调用 clone()==。区别全在一串开关。" }
      - { at: [taskBf], text: "fork 一个开关都不带：得到一个新 task，==从 fork 那一行继续跑==。父进程拿到子的 PID，子进程拿到 0。" }
      - { at: [resBf], text: "资源整套复制。复制是贵的，==COW 打了折==：到第一次写才真复制那一页。" }
      - { at: [taskBf, resBf], text: "从此==两个资源域==。一个崩了另一个无感，共享状态只能走 IPC——这就是「进程」的全部含义。" }
  - id: pthread
    label: "pthread_create 的账单"
    steps:
      - { at: [clone, taskTp], text: "四个开关全开（CLONE_VM · FILES · FS · SIGHAND）：==还是一扇门，走出来的却是线程==。" }
      - { at: [resSp], text: "资源==一份没复制==。新线程只带自己的执行现场，mm/files/sighand 全是 A 那几份的引用。" }
      - { at: [taskTp, resSp], text: "这就是线程便宜的全部原因。==深的不是创建，是共享的后果==——锁、竞争、故障域，§07 算这笔账。" }
  - id: reverse
    label: "往反方向拧"
    steps:
      - { at: [clone, container], text: "开关往反方向拧：CLONE_NEW* 表示==「另立一个」==。资源照旧各一份，命名空间也切开。" }
      - { at: [container], text: "这就是容器。==容器的「轻」和线程的「轻」不是一回事==：一个隔离命名空间、共享内核；一个共享资源域、毫无隔离。谱系的两端，§08 收拢。" }
```

```text
tid = clone(fn, stack,
  CLONE_VM      |   // 共享地址空间：页表指针直接复用
  CLONE_FILES   |   // 共享打开文件表：fd 直接互相可见
  CLONE_FS      |   // 共享根目录/工作目录/umask
  CLONE_SIGHAND);   // 共享信号处置表
                    // 全部去掉 -> fork()；全部带上 -> 创建线程
```

为什么统一成一种对象？两套类意味着两套调度、两套同步逻辑，凡「阻塞与唤醒」都要写两份，两个类还要互相引用。只有一种 task_struct 时，调度器、同步原语、内存管理只面对一种对象；==wait() 只等子 task、杀进程遍历线程组，都只是统一模型上的分支==。Kernel Labs 的原话直接用了 OO 类比：把 clone 想成 deep copy 与 shallow copy 的参数化版本。

在机器上可以直接验证两层说法同时成立：同一进程的所有线程 getpid 相同、gettid 不同：getpid 返回的是线程组 ID。内核里是平级的 task；应用层看到的「进程」，是这组 task 共享的那层身份。Linux 的一对一实现叫 NPTL，2005 年前后随内核 2.6 落地，线程创建比旧的 LinuxThreads 快约 7 倍。旧实现把每个线程塞成轻量级进程，getpid、信号、wait 的语义全对不齐 POSIX，这段历史的教训是：把线程硬塞进进程模型，语义裂缝会在各处漏出来。

## 07 · 三条边界：故障、一致性、成本

资源域与执行流的差异，落到工程上是三条边界。它们没有一条是免费的：

```compare
first: 边界
head: [多进程, 多线程]
rows:
  - 故障域: [{ text: "地址空间隔离，崩了可单独结束、单独回收", tone: green }, "共享内存，一条线程写坏共享数据，可能全进程陪葬"]
  - 共享数据: ["要走 IPC：管道 / 共享内存 / 消息队列，要序列化", { text: "直接读写同一块内存，零拷贝", tone: green }, "代价：数据竞争、锁、原子操作、内存可见性——共享内存连显式的消息边界都没有"]
  - 切换与创建: ["换页表（PCID/ASID 已缓解）+ 创建时复制整套资源", { text: "不换页表、创建只复制指针", tone: green }, "缓存工作集照样互相污染；省的是「地址空间切换」这一块"]
```

两个绝对结论都站不住。「线程一定快所以优先线程」无视了故障域和同步代价：一次数据竞争排查可能吃掉全部切换收益；「进程安全所以全部多进程」无视了 IPC 复杂度：高频小消息的序列化会反过来成为瓶颈。Chrome 给每个标签页独立进程而非线程，买的就是第一行：单个渲染器的 bug 或失控脚本不连累浏览器整体，隔离优先于开销。

还有一层容易漏的：线程怎么映射到内核。历史上分三种模型：

```compare
first: 模型
head: [阻塞系统调用时, 多核并行, 现状]
rows:
  - Many-to-One: ["整个进程阻塞", "不能", "已非主流（Solaris Green Threads）"]
  - One-to-One: [{ text: "只阻塞该线程", tone: green }, { text: "能", tone: green }, "Linux（NPTL）与 Windows 的主流"]
  - Many-to-Many: ["不拖垮进程", "能", "实现最复杂，历史实现（Solaris 9 以前）"]
```

一对一模型下每条线程就是一个内核 task，这是今天读这篇文章的默认背景。协程、fiber、goroutine 是第三层：用户态调度，内核看不见，切换约 170 纳秒且不经内核，但它不提供任何隔离，省的是调度成本，不是故障域。「线程之上的线程」这个说法概括了它的位置。

## 08 · 选型与谱系：口诀只配做注脚

「CPU 密集用进程、I/O 密集用线程」把多维权衡压成了一维，而且它自己还依赖运行时：Python 线程因 GIL（全局解释器锁）拿不到真并行，CPU 密集要用进程；C++/Java/Go 的线程就是真并行；Node 单线程事件循环，计算要用 worker_threads 或子进程。同一句口诀，三个运行时三个结论。真实的检查顺序是逐维记账：

```compare
first: 结构约束
head: [问的问题, 偏向]
rows:
  - 故障隔离与安全边界: ["崩了能不能连坐？跑的是不是不可信代码？", "隔离是硬需求时没有替代方案 → 进程"]
  - 共享数据规模与通信频率: ["共享多且读写频繁，还是高频小消息？", "前者线程零拷贝占优；后者 IPC 序列化会吃掉一切"]
  - 单任务内存与调度规模: ["千级线程（默认 8 MiB 虚拟栈 ≈ 8 GiB 虚拟）还是千级进程？", "64 位 Linux 单进程实测可跑约 32K 线程；再往上答案是事件循环，不是更多线程"]
```

```compare
first: 环境约束
head: [问的问题, 偏向]
rows:
  - 运行时限制: ["线程在这个运行时里等于并行吗？", "GIL / 事件循环 / M:N 调度，各自的答案完全不同"]
  - 可观测性: ["perf、ps、崩溃栈按进程分层；线程共享进程级统计", "线程粒度的观测要另找工具，排障成本要记账"]
  - 部署模型: ["要独立发布、独立限流、独立重启、灰度放量吗？", "这已经不是性能问题，是交付问题 → 进程"]
```

生产架构几乎从不二选一，而是分层叠加：

```lane-stack
- badge: 进程层
  title: 按故障域切进程
  desc: 决定「谁跟谁一起死」
  tone: violet
  nodes:
    - { title: Chrome：每个站点一个渲染进程, sub: 一个 tab 崩不带走浏览器, tag: 隔离 }
    - { title: Web 服务：master + N 个 worker, sub: worker 崩了自动拉起、平滑重启, tag: 多核 }
  next: "进程内部再叠 :: ::"

- badge: 线程层
  title: 按并发度上线程
  desc: 决定「谁跟谁一起跑」
  tone: blue
  nodes:
    - { title: 渲染进程内部几十条线程, sub: 主线程渲染 / 合成器 / IO / worker, tag: 并行 }
    - { title: worker 内事件循环 + 小线程池, sub: 多核靠进程数；阻塞任务靠线程, tag: 混合 }
  next: "等待再叠一层 :: ::"

- badge: 异步层
  title: 按等待量用异步
  desc: 决定「谁等的时候别人在干嘛」
  tone: green
  nodes:
    - { title: epoll/kqueue 事件循环, sub: 等待不占线程；10 万连接不靠 10 万线程, tag: 高并发 }
    - { title: 线程池只接真正会阻塞的活, sub: 磁盘、同步库；栈大小可用 pthread_attr 控制, tag: 兜底 }
```

最后把全文的坐标轴拉到底。四个概念共用同一把刻度尺：共享与隔离。

```compare
first: 
head: [共享什么, 谁调度, 故障传到哪]
rows:
  - 容器: ["只共享内核；命名空间（视图 / 文件树 / 网络）独立", "内核", "容器内，不波及宿主机"]
  - 进程: ["什么都不共享（地址空间私有）", "内核", "进程内"]
  - 线程: ["整个进程资源域", "内核", "同组线程共担，全进程陪葬"]
  - 内核线程: ["没有用户态资源可共享（mm 为 null）", "内核", "内核态：没有页表把它和用户进程隔开"]
  - 协程: ["整个进程资源域", "==用户态调度器，内核看不见==", "整个进程"]
```

从容器到协程，是「共享越来越多、调度越来越轻」的连续谱。一句话收束：进程回答「拥有什么」，线程回答「从哪里继续执行」，协程回答「等的时候还能干嘛」，容器回答「谁和谁共享一个世界」。理解了共享与隔离这把尺子，再学调度器、虚拟内存和容器原理时，每个新概念都能在谱系上找到自己的位置。

```quiz
- q: 同一个程序跑两份，变量 x 的虚拟地址都是 0x601000，为什么互不干扰？
  a: 各有一张页表。同一个虚拟地址经各自的表翻译到不同物理帧——页表既是翻译器也是隔离墙，物理内存从头到尾只有一条，分区不存在。
- q: pthread_create 新建了哪些东西？为什么说它便宜？
  a: 只有一条执行流的现场：task_struct 本体、寄存器、用户栈、内核栈、TLS、信号掩码。mm / files / sighand 全是复用父进程的指针——不复制资源，所以创建便宜；代价是故障域变成进程级、共享数据要自己处理竞争。
- q: ps -eLf 里同一个 PID 出现 44 行、LWP 各不相同，这说明什么？
  a: 内核里平级排着 44 个 task，共享同一个资源域——这就是「一个进程 44 条线程」。getpid 相同是因为它返回的是线程组 ID；每个 task 的 tid（LWP 列）才是调度器眼里的身份。
```
