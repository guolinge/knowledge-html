```text
用户空间                          内核空间
┌────────────────────┐           ┌──────────────────────────┐
│ 代码段  r-x        │           │ task_struct              │
│ 数据段  rw-        │           │   └─ mm ──> mm_struct    │
│ 堆      rw-        │  ← 描述 ←  │              ├─ VMA 集合 │
│ mmap 映射区 rw-/r-x│           │              └─ pgd ──┐  │
│ 栈      rw-        │           │                       │  │
└────────────────────┘           └───────────────────────┼──┘
                                                         ↓
                                                    页表（VA→PA）
```

一句话区分：

> **映射区是程序能用的虚拟地址范围；`mm_struct` 是内核里管理整个地址空间的那份档案。**

一个是被管理的地盘，一个是管理它的档案。中间还有两样东西经常被卷进来，凑成四件套：

| 东西 | 一句话 | 在哪 |
|---|---|---|
| 映射区 | 一段段用户虚拟地址范围 | 用户地址空间里（不是内核对象） |
| **VMA**（`vm_area_struct`） | 内核给**每一段**地址做的登记：范围、权限、来源 | 内核内存 |
| **`mm_struct`** | 管整个地址空间的**总档案**：VMA 集合、页表入口、各段范围 | 内核内存 |
| **页表** | 虚拟地址到物理页帧的**导航表** | 内核内存（受硬件格式约束） |

口诀：==映射区是地盘，VMA 是地契，`mm_struct` 是总档案，页表是导航表==。再加一样：物理页帧是真正的房间。

## 01 · 两个世界：谁在哪，谁描述谁

```arch
svg: vma-mm-map
caption: 左边是程序看到的地址段，右边是内核里的档案。VMA 每一条描述左边的一段；页表负责把地址翻译到物理页。注意 mm_struct 不在左边的任何一个段里。
frames:
  - id: user
    boundary: 0
    kind: contains
    label: 用户空间 · 程序看到的虚拟地址范围
    detail: 这五段都是虚拟地址范围。程序读写它们时，地址要经过页表翻译才会落到物理内存。这里没有 mm_struct，也没有 VMA。
  - id: kernel
    boundary: 1
    kind: contains
    label: 内核空间 · 每个进程一份档案
    detail: mm_struct 本身是内核内存里的一个结构体。用户态拿不到它的指针，只能通过 mmap / munmap / mprotect / brk 这些系统调用让内核去改。
  - id: phys
    boundary: 2
    kind: contains
    label: 物理内存 · 真正放内容
    detail: 页表把虚拟页翻译成这里的物理页帧。内容可能来自文件（page cache），也可能是匿名页，也可能暂时不在内存里。
bodies:
  mmap:
    badge: 不是一个对象
    rows:
      - { k: 是什么, v: "一段段虚拟地址范围，不是一个结构体" }
      - { k: 里面有什么, v: "libc 的代码段、文件映射、匿名内存、线程栈" }
      - { k: 谁登记它, v: "内核为每一段建一条 VMA" }
      - { k: 谁翻译它, v: "页表（PTE 里记物理页帧）" }
    note: 你看到的「映射区」是几段地址，不是一个容器
  text:
    badge: 一条 VMA
    rows:
      - { k: 权限, v: "r-x（可读可执行，不可写）" }
      - { k: 来源, v: "可执行文件或 .so 的代码段" }
    note: 多个进程可以共享同一份物理代码页
  data:
    badge: 一条 VMA
    rows:
      - { k: 权限, v: "rw-" }
      - { k: 来源, v: ".data / .bss" }
  heap:
    badge: 一条 VMA
    rows:
      - { k: 权限, v: "rw-" }
      - { k: 增长, v: "brk 往上推" }
  stack:
    badge: 一条 VMA
    rows:
      - { k: 权限, v: "rw-" }
      - { k: 增长, v: "向低地址长" }
      - { k: 旁边, v: "通常有一条 guard VMA 挡溢出" }
  task:
    badge: 身份
    rows:
      - { k: 是什么, v: "进程 / 线程的描述结构" }
      - { k: 关键字段, v: "mm：指向地址空间档案" }
    note: 同进程的多个线程共用一个 mm
  mm:
    badge: 总档案
    rows:
      - { k: mm_mt, v: "VMA 集合（maple tree）" }
      - { k: pgd, v: "页表入口指针" }
      - { k: mmap_base, v: "mmap 区从哪开始长" }
      - { k: start_code / brk / start_stack, v: "各段范围的缓存" }
      - { k: mm_users / map_count, v: "引用计数 / VMA 条数" }
    note: 只存指针和范围，不存内容
  vmas:
    badge: 每条一段
    rows:
      - { k: 记什么, v: "起止地址、权限、来源文件、缺页怎么处理" }
      - { k: 谁遍历它, v: "缺页异常处理、/proc/pid/maps" }
    note: VMA 数量不等于 mmap 调用次数
  pt:
    badge: 导航表
    rows:
      - { k: 入口, v: "mm->pgd 指向最高一级" }
      - { k: 层级, v: "x86-64 常见 4 级，也可能 5 级" }
      - { k: 每项, v: "物理页帧号 + 权限位" }
    note: 页表不是 mm_struct 的成员，只是被它指着
  frames:
    badge: 真正的房间
    rows:
      - { k: 一页, v: "通常 4 KB" }
      - { k: 现在有没有内容, v: "可能来自文件、可能是匿名页、也可能还没分配" }
parts:
  mmap:
    label: mmap 映射区
    sub: 一堆地址段，不是一个对象
    detail: 动态库、文件映射、匿名内存、线程栈都落在这一段范围里。==它没有对应的内核结构体；对应的是一串 VMA。==
  mm:
    label: mm_struct
    sub: 内核里的总档案
    detail: 它记录「地址空间长什么样」：VMA 树、页表入口、各段的起止、统计和锁。它不含任何用户数据，也不在用户地址空间里。
  vmas:
    label: VMA 集合
    sub: 每段地址一条登记
    detail: 一条 VMA 覆盖 `[vm_start, vm_end)`，带权限、来源文件、缺页处理函数。缺页时内核就是靠它判断这个地址合不合法。
  pt:
    label: 页表
    sub: 地址翻译用
    detail: "`mm->pgd` 只是入口指针。页表本身是另一套结构，按页帧组织，硬件 MMU 直接遍历它。"
  frames:
    label: 物理页帧
    sub: 内容真正待的地方
    detail: 虚拟地址大不代表物理内存大：没访问过的页可以根本没有物理页，也可能还在文件或 swap 里。
tours:
  - id: two-worlds
    label: 两个世界各有什么
    steps:
      - { at: [text, data, heap, mmap, stack], text: "左边这五段都是==虚拟地址范围==。程序看到的就是这些数字，不是物理地址。" }
      - { at: [task, mm, vmas], text: "右边才是管理对象：task 指向 mm，mm 用一棵树管着所有 VMA。==mm 不在左边的任何一段里==。" }
      - { at: [mm, pt, frames], text: "mm 还持有页表入口，页表把左边的地址翻译到右边的物理页帧。" }
  - id: one-segment
    label: 一段地址的三种身份
    steps:
      - { at: [mmap], text: "对程序来说，它是一段能用的地址（地盘）。" }
      - { at: [vmas], text: "对内核来说，它是一条 VMA（地契）：范围、权限、来源。" }
      - { at: [mm, pt, frames], text: "对硬件来说，它是一个个虚拟页，要靠页表翻成物理页帧（导航表）。" }
```

三个最常见的混淆，正好对应这张图上的三条线：

- 把 `mm_struct` 当成「映射区」：它不在用户地址空间里，它是内核里的档案。
- 把 VMA 当成 `mm_struct`：VMA 是**一条**登记，`mm_struct` 是**整本**档案。
- 把映射区当成物理内存：映射区只是地址范围，内容是页表指过去的。

## 02 · `mm_struct`：总档案里到底记了什么

下面是从 Linux 内核源码 `include/linux/mm_types.h` 里摘的真实字段（省略了与这篇无关的）：

```c
struct mm_struct {
    struct maple_tree mm_mt;          /* VMA 集合：所有 vm_area_struct */
    unsigned long mmap_base;          /* mmap 区从哪开始 */
    unsigned long task_size;          /* 这个地址空间有多大 */
    pgd_t *pgd;                       /* 页表最高一级的入口 */

    atomic_t mm_users;                /* 有多少个线程在用这个地址空间 */
    int map_count;                    /* 一共有多少条 VMA */
    struct rw_semaphore mmap_lock;    /* 改 VMA 时要拿的读写锁 */

    unsigned long start_code, end_code, start_data, end_data;
    unsigned long start_brk, brk, start_stack;
    unsigned long arg_start, arg_end, env_start, env_end;

    struct percpu_counter rss_stat[NR_MM_COUNTERS];
    unsigned long total_vm;           /* 一共映射了多少页 */
    unsigned long pgtables_bytes;     /* 页表本身占了多少字节 */
};
```

从这些字段能读出三件事：

- **它管的是「范围」，不是「内容」。** 代码段的起止、堆顶在哪、栈从哪开始、映射区从哪长 —— 全是地址和边界。
- **它只是「持有」页表入口。** `pgd` 是个指针，页表本体是另一套结构，按页帧组织。
- **它有锁和计数。** 改地址空间（`mmap` / `munmap`）要拿 `mmap_lock`；引用计数 `mm_users` 决定它什么时候能被释放。

还有一条最容易被忽略：==`mm_struct` 里的 `start_code` 这些范围，和 VMA 里记的范围有重叠，但用途不同==。前者是为了快速回答「代码段大概在哪」，后者才是真正决定某次访问合不合法的登记。两者不一致时，以 VMA 为准。

## 03 · VMA：地契上写了什么

一条 VMA 的形状（同样摘自内核源码，删掉了 RCU、userfaultfd 之类）：

```c
struct vm_area_struct {
    unsigned long vm_start;   /* 覆盖 [vm_start, vm_end) */
    unsigned long vm_end;
    struct mm_struct *vm_mm;  /* 属于哪个地址空间 */
    vm_flags_t vm_flags;      /* 读 / 写 / 执行 / 共享 / 可增长 ... */

    struct file *vm_file;     /* 文件映射时指向文件；匿名为 NULL */
    unsigned long vm_pgoff;   /* 在文件里的偏移（按页计） */
    const struct vm_operations_struct *vm_ops;  /* 缺页时调哪个处理函数 */
    struct anon_vma *anon_vma;                  /* 匿名页反向映射 */
};
```

一条 VMA 回答四个问题：

1. 这段地址从哪到哪（`vm_start` / `vm_end`）；
2. 允许怎么访问（`vm_flags`：可读、可写、可执行、私有还是共享）；
3. 内容从哪来（`vm_file` + `vm_pgoff`，或者匿名为空）；
4. 缺页时怎么办（`vm_ops->fault`）。

这些 VMA 现在放在 `mm_mt` 这棵 maple tree 里（老内核是红黑树 + 链表，读旧资料时会看到）。你不需要记数据结构名，只要知道：==按地址找 VMA 是一次树查找==，因为缺页处理每次都要问「这个地址归哪条地契管」。

## 04 · 映射区不是一块，是上千段

「映射区」这个词容易让人以为是一整块连续区域。实际不是：

```text
$ cat /proc/<pid>/maps        # Linux：一行一条 VMA
7f2c7078c000-7f2c70790000 r--p 00000000 fd:01 1234 /usr/lib/libc.so.6
7f2c70790000-7f2c70920000 r-xp 00001000 fd:01 1234 /usr/lib/libc.so.6
7f2c70920000-7f2c70960000 r--p 001a0000 fd:01 1234 /usr/lib/libc.so.6
7fffb2c0d000-7fffb2c2e000 rw-p 00000000 00:00 0   [stack]
7fffb2d48000-7fffb2d49000 r-xp 00000000 00:00 0   [vdso]
7f2c6ff8c000-7f2c7078c000 rw-p 00000000 00:00 0   [stack:986]   ← 线程栈
```

（样例按常见布局整理，地址、inode 是示意的；末行是线程栈，属于同一个 mm。）

每一行的第一列就是一段虚拟地址范围，权限列里的 `p` 表示私有（copy-on-write）、`s` 表示共享。同一个 libc 会拆成好几条（代码一条、只读数据一条、可写数据一条），因为它们的权限不同 —— ==一条 VMA 里的所有页权限必须一样==。

本机用另一种操作系统的工具量了一遍，结论一样（macOS 的 `vmmap`，对应 Linux 的 maps）：

| 量 | 值 | 怎么量 |
|---|---|---|
| 一个 Node 进程的映射段数 | **1909 段** | `vmmap -summary <pid>` 的最后一行 REGION 计数 |
| 这些段加起来多大（虚拟） | **2.2 GB** | 同上 TOTAL 行 |
| 其中真正驻留物理内存 | **589.7 MB** | 同上 RESIDENT 列 |
| 动态库部分 | 975.1 MB 映射，只有 234.7 MB 驻留 | 同上 Libraries 行 |

两件事一起成立：**段数很多**（不是一块），**虚拟远大于驻留**（映射不等于占内存）。最后一行尤其典型：库被映射了 975 MB，真正读进内存的只有 235 MB，其余还在文件里 —— 这就是 §07 要讲的按需加载。

## 05 · 页表：导航表不在 `mm_struct` 里

`mm_struct` 只存一个 `pgd` 指针。真正的页表是一棵树，按页帧组织：

```text
CR3 ──> PGD ──> P4D ──> PUD ──> PMD ──> PTE ──> 物理页帧
         (每一级都是 512 项，每项指向下一级的页帧)
```

x86-64 常见两种布局：

| 布局 | 用户空间能寻址 | 页表级数 |
|---|---|---|
| 4 级 | 128 TB | PGD → PUD → PMD → PTE |
| 5 级 | 64 PB | 多一级 P4D |

PTE 里记的是**物理页帧号 + 权限位**（可写、可执行、用户态能不能访问……）。页表本身由内核维护，但硬件 MMU 会直接遍历它 —— 这也是为什么页表必须按硬件规定的格式放在内存里，而不是随便一个结构体。

地址翻译的加速靠 TLB：MMU 把最近用过的「虚拟页 → 物理页」翻译结果缓存起来，命中时不用走整棵树。

## 06 · 访问一个地址：三条路，代价差三个数量级

```lane-stack
- badge: PATH 01
  title: TLB 命中
  desc: 绝大多数访问走这条，不经过内核
  tone: green
  nodes:
    - { title: MMU 查 TLB, sub: 虚拟页 → 物理页帧, tag: 几个周期 }
    - { title: 直接读写, sub: 不经过内核 }
  next: "TLB 没命中 → 走页表遍历"

- title: 页表命中，TLB 未命中
  desc: 翻译关系已经有了，只是缓存里没有
  tone: blue
  nodes:
    - { title: 硬件遍历页表, sub: PGD → … → PTE, tag: 十到几十个周期 }
    - { title: 填进 TLB, sub: 下次就快了 }
  next: "PTE 无效 → 缺页异常进内核"

- title: 缺页
  desc: 这条才用到 mm_struct 和 VMA
  tone: amber
  nodes:
    - { title: 陷入内核, sub: 带着出错的虚拟地址 }
    - { title: 找 mm 和 VMA, sub: 按地址在 mm_mt 里查 }
    - { title: 判断与准备, sub: 权限对不对 / 分配匿名页 / 从文件读 page cache }
    - { title: 写 PTE, sub: 填物理页帧和权限 }
    - { title: 返回用户态, sub: 重新执行同一条指令 }
  next: "没有 VMA，或权限不符 → 失败"

- title: 失败
  desc: 没有 VMA，或者权限不允许
  tone: red
  nodes:
    - { title: SIGSEGV, sub: 程序看到 Segmentation fault }
```

三条路的差别值得记住：TLB 命中是纯硬件；页表遍历还是硬件，只是慢一点；==只有缺页才进内核，而进内核之后第一件事就是拿 `mm_struct` 去找 VMA==。所以「VMA 跟访问合法性有关」这句话，只在缺页这条路上成立。

## 07 · 映射区里放的是物理地址，还是内容？

直接回答：**都不是。** 映射区是一段虚拟地址范围：

- 物理地址的对应关系记在**页表项**里，不在映射区里；
- 真正的内容在**物理页帧**里；
- 而物理页帧里的内容，可能是从**文件**读进来的，也可能是匿名分配的新页，也可能此刻根本不在内存（还在文件或 swap 里）。

一个文件页从「刚映射」到「被写过」，走的是这几步：

```journey
- tag: ① 建立映射
  tone: muted
  name: mmap(file)
  badge: 只有地址，没有内容
  badgeTone: warn
  fields:
    - { k: 内核做了什么, v: 找一段空闲地址，建一条 VMA }
    - { k: VMA 里记的, v: 对应哪个文件、偏移、权限 }
    - { k: 物理页, v: 一页都还没有 }
  note: 映射 1 GB 文件，不等于占 1 GB 内存。
  next: "第一次访问才会真的要内容"

- tag: ② 第一次读
  tone: amber
  name: 缺页异常
  badge: 进内核
  fields:
    - { k: 谁发现, v: MMU 查页表，PTE 无效 }
    - { k: 内核做什么, v: 按地址找到 VMA，确认这是文件映射 }
    - { k: 从哪取内容, v: 文件的 page cache（没有就从磁盘读进来） }
  note: 这一页现在在 page cache 里，内核把 PTE 指向它。
  next: "多个进程映射同一个文件，会指向同一批页"

- tag: ③ 只读访问
  tone: green
  name: 共享 page cache
  badge: 一份物理页，多个映射
  fields:
    - { k: 物理页, v: page cache 里的那一页 }
    - { k: 映射方式, v: 只读、可共享 }
    - { k: 谁省了, v: 十个进程跑同一个 libc，代码页只有一份 }
  note: 「共享」发生在物理页这一层，不是虚拟地址。
  next: "一旦要写，就得先复制一份"

- tag: ④ 写这一页
  tone: violet
  name: copy-on-write
  badge: MAP_PRIVATE 的写
  fields:
    - { k: 触发条件, v: PTE 是只读的、VMA 是私有的 }
    - { k: 内核做什么, v: 复制一页新的，改 PTE 指向新页，标记可写 }
    - { k: 谁受影响, v: 只有自己，别的进程仍看原页 }
  note: MAP_SHARED 不复制，直接改 page cache（再由内核回写）。
  next: "脏页最后由内核回写或回收"

- tag: ⑤ 收尾
  tone: muted
  name: 回写 / 回收 / 换出
  badge: 内容不一定一直在内存里
  fields:
    - { k: 文件页, v: 脏了会回写到文件 }
    - { k: 匿名页, v: 内存紧张时可能换出到 swap }
    - { k: 释放, v: munmap 只删 VMA，页由回收器处理 }
  note: 所以「映射区里有内容」只在被访问过的那几页上成立。
```

五种东西各记什么，一张表钉死：

| 东西 | 记录或存放什么 | 有没有「内容」 |
|---|---|---|
| 映射区 | 虚拟地址范围 | 没有，它本身就是范围 |
| VMA | 范围、权限、来源文件、缺页处理函数 | 没有 |
| 页表（PTE） | 虚拟页 → 物理页帧 + 权限位 | 没有 |
| 物理页帧 | 当前驻留的代码和数据 | **有** |
| 文件 / page cache / swap | 还没进内存或已被换出的备份 | 有（在别处） |

想确认某段地址此刻有没有物理页，Linux 上可以用 `mincore(2)` 问「哪些页当前在内存里」，或者看 `/proc/<pid>/smaps` 里的 `Rss` / `Pss`。虚拟大小和驻留大小从来不是一回事。

## 08 · 线程、fork、exec 与这份档案

`mm_struct` 是按**地址空间**算的，不是按线程算的：

```text
线程 1 的 task_struct ─┐
线程 2 的 task_struct ─┼──> 同一个 mm_struct
线程 3 的 task_struct ─┘
```

- **线程**：`clone(CLONE_VM)` 共享同一个 `mm`，所以能直接看到彼此的全局变量、堆对象、动态库映射。
- **线程栈**：每个线程有自己的栈，但那是**同一个 `mm` 里的一条 VMA**（通常是匿名映射，`maps` 里可能显示成匿名段或 `[stack:tid]`）。「每线程一个栈」说的是地址范围不同，不是地址空间不同。
- **fork**：复制一份 `mm`，页表项设成只读、两边共享物理页，谁写谁触发 COW。
- **execve**：丢掉旧的 `mm`，换一套新的地址空间（新的代码段、堆、栈）。

所以看到 `maps` 里有好几段栈，不要以为有多个地址空间 —— 它们都在同一个 `mm_struct` 下面。

## 09 · 自己看：一行命令验证一遍

| 想看什么 | Linux | 说明 |
|---|---|---|
| 有哪些段、权限如何 | `cat /proc/<pid>/maps` | 一行一条 VMA |
| 每段驻留多少 | `cat /proc/<pid>/smaps` | `Rss` 实际驻留、`Pss` 按共享比例分摊 |
| 总虚拟 / 总驻留 | `grep Vm /proc/<pid>/status` | `VmSize` vs `VmRSS` |
| 某地址有没有物理页 | `mincore(2)` | 返回每页是否驻留 |
| macOS 对应工具 | `vmmap -summary <pid>` | 段数、虚拟、驻留一次看全 |

```bash
# Linux：看一眼自己 shell 的地址空间
grep -E 'Vm(Size|RSS|Data|Stk)' /proc/self/status
cat /proc/self/maps | head -20
```

```bash
# macOS：段数 + 虚拟/驻留（本机实测 1909 段 / 2.2G / 589.7M）
vmmap -summary $$
```

```summary
title: 一句话总结
text: |
  映射区是一段段用户虚拟地址，VMA 是内核给每一段做的登记，mm_struct 是把这些登记和页表入口收在一起的总档案。
  ==映射区里没有物理地址，也没有内容：物理映射在页表里，内容在物理页里，而物理页可能来自文件、可能是匿名页，也可能还没分配。==
```

```quiz
- q: 映射区和 mm_struct 最本质的区别是什么？
  a: |
    映射区是用户虚拟地址空间里的一段段地址范围，是「被管理的地盘」；
    mm_struct 是内核内存里的一个结构体，是「管理这份地址空间的档案」。
    前者没有对应的内核对象，后者持有 VMA 集合、页表入口和各段范围。
- q: 一条 VMA 至少记录哪四件事？
  a: |
    起止地址（vm_start/vm_end）、权限（vm_flags）、内容来源（vm_file + vm_pgoff，匿名为空）、
    缺页时怎么处理（vm_ops->fault）。缺页异常就是靠这四样判断地址合不合法、该从哪取内容。
- q: mmap 一个 1 GB 的文件，会立刻占 1 GB 物理内存吗？
  a: |
    不会。mmap 只建立 VMA，页表里还没有有效 PTE。第一次访问触发缺页，
    内核才把对应页从文件读进 page cache 并填 PTE。没访问过的页可以一直没有物理页。
- q: 映射区里存的是物理地址吗？
  a: |
    不是。映射区是虚拟地址范围；物理地址的对应关系记录在页表项里；
    真正的内容在物理页帧里，可能来自文件、可能是匿名页、也可能已被换出。
```
