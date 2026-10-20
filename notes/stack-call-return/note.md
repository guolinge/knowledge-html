## 01 · 卡点：两个「返回」根本不是一回事

原始说法是「调用函数前保存返回位置」。这句话里的「返回位置」很容易被读成「返回值放在哪」，但两者互不相干。

拿一个能编译、能单步的函数对来分：

```c
int add(int a, int b) { return a + b; }
int calc(int x)      { int s = add(x, 3); return s * 2; }
```

`add` 执行完，CPU 要同时处理两件事：

- 回到 `calc` 里继续执行。去哪个地址，由一个**地址**决定，这个地址叫**返回地址**。
- 把算出来的 13 交给 `calc`。这个 13 叫**返回值**，x86-64 上放在 `eax`，AArch64 上放在 `x0`。

本机实测（Apple clang 21，`-arch x86_64 -O0`）：`calc` 里的 `callq _add` 在 `0x100000373`，所以 `add` 看到的返回地址是 `0x100000378`；同一时刻它的返回值是 13。

```compare
first: 看哪一面
head: [返回地址 return address, 返回值 return value]
rows:
  - 一句话: [执行完去哪条指令继续, 函数算出了什么]
  - 谁产生: ["调用方的那条 `call` / `bl` 指令", 被调用的函数自己算]
  - 长什么样: ["一个指令地址，如 `0x100000378`", "一个数据值，如 `13`"]
  - 存在哪: ["x86-64 压在栈顶；AArch64 先进 `x30`", "x86-64 在 `eax`；AArch64 在 `x0`"]
  - 谁来用: ["`ret`：弹出它，跳过去", 调用者的下一段代码]
  - 丢了会怎样: [回到错误的地址，程序跑飞, 算出来的结果对不上]
```

`ret` 不读返回值，也不改返回值。它只做一件事：从栈顶取一个地址，跳过去。==返回地址管「往哪走」，返回值管「算出什么」==，两套机制各走各的路。

把原句改写一下就没有歧义了：==`call` 在跳进去之前，先把「回来接着执行的那条指令地址」记下来==。记的是地址，不是值。

原始材料里「书签」的类比在这里是贴的：书签记的是**页码**（位置），不是你在附录里查到的那段**内容**（值）。两者都会「带回来」，但一个决定你翻回哪一页，一个被你抄进笔记。

## 02 · 栈：一段内存加一根指针

教材里的「栈」容易被讲成一个抽象容器。在真实机器上它简单得多：

```cards
cols: 2
items:
  - title: 栈 = 一段连续内存
    desc: 进程地址空间里划出来的一块，地址从高到低。
    tone: blue
    body: |
      函数调用的所有临时数据都写在这块内存里：返回地址、旧帧指针、局部变量。

      它没有类型、没有名字，就是一块可读可写的地址区间。
  - title: SP = 一个记位置的寄存器
    desc: x86-64 叫 `RSP`，AArch64 叫 `SP`。
    tone: violet
    body: |
      CPU 不知道「栈」是什么，它只知道有个寄存器里存着一个地址。

      ==「压栈」就是把这个地址改小，然后往新地址写东西==；「弹栈」就是读出东西，再把地址改大。
```

```memmap
title: 栈在这张地址地图的哪儿
sub: Linux x86-64 的典型布局（macOS 的分段不同，栈同样在最上面）
high: "0x7fff_ffff_ffff"
low: "0x0000_0000_0000"
segments:
  - { label: 内核空间, sub: 用户态代码碰不到, tone: muted, size: 1.0, addr: "0xffff_8000…" }
  - { label: 栈, sub: 返回地址、局部变量都在这；向低地址长, tone: blue, size: 1.9, dir: down, mark: 每个线程一份 }
  - { label: 共享库 / mmap, sub: libc、动态库映射进来的区域, tone: muted, size: 1.1, mark: 进程共享 }
  - { label: 堆, sub: malloc / new，向高地址长, tone: violet, size: 2.2, dir: up, mark: 进程共享 }
  - { label: 数据段, sub: 全局变量、静态变量, tone: amber, size: 1.1, mark: 进程共享 }
  - { label: 代码段, sub: 指令本身，只读, tone: green, size: 1.6, mark: 可共享 }
note: 一次函数调用只动最上面那一段：**RSP 往下走，帧就压进去；RSP 回来，帧就没了**。
```

压栈的具体动作，Intel 手册的伪代码只有两行：

```text
IF OperandSize = 64 THEN
    RSP := RSP − 8;
    Memory[SS:RSP] := SRC;
```

这就是全部。所谓「栈指针往下走」，不是比喻，是 `RSP` 这个数值真的变小了。原始材料里 `SP = 1000 → 996` 那段示意图，说的是同一件事。

!!「栈顶」在纸上要画在下面。!! 栈顶 = 当前最低的那个已用地址。所以画栈的时候，高地址在上、低地址在下，压栈的动作是**向下**长 —— 这跟「书堆越堆越高」的直觉正好相反，是最容易画反的一处。

x86-64 的 ABI 还规定了两条与位置有关的约束：函数刚进门时，`RSP` 正指着返回地址，且 `RSP + 8` 是 16 的倍数；AArch64 要求 `SP` 始终 16 字节对齐。原因不在栈本身，而在 SSE / AVX 的一些指令要求操作数对齐，编译器靠这条约定保证局部变量和临时缓冲区落在对齐的地址上。这也是为什么 `sub rsp, 0x10` 里常有几字节根本没用上（见 04）。

## 03 · call 只做两件事：压地址、跳过去

Intel 手册对近调用（near call）的描述是明确的一句：

```callout
tone: muted
icon: 📖
quote: true
text: |
  When executing a near call, the processor pushes the value of the EIP register
  (which contains the offset of the instruction following the CALL instruction)
  on the stack (for use later as a return-instruction pointer). The processor then
  branches to the address in the current code segment specified by the target operand.
```

也就是说：`call` 把「`call` 之后那条指令」的地址压进栈，然后跳到目标地址。

伪代码同样是两步：

```text
tempRIP := RIP + tempDEST;      (* 目标地址 *)
Push(RIP);                      (* 压的是「下一条指令」的地址 *)
RIP := tempRIP;                 (* 跳过去 *)
```

注意压进去的是 `RIP`，而此时 `RIP` 已经指向 `call` 的**下一条**指令了。所以：

- 存 `call` 自己的地址 → 返回时会再执行一次 `call`，死循环。
- 存函数第一条指令的地址 → 返回时又从函数开头跑一遍，也死循环。
- ++只有存「下一条」，返回才等于「接着往下走」。++

==原文说「可以粗略理解为 push 下一条地址 + jmp」，对近调用来说这不是近似 —— CPU 做的就是这两步。==

### 单步走一遍

下面这个控件把 `main → calc → add` 三层的现场放在一屏里：左边是代码段（`▶` 是下一条要执行的指令），右边是栈。点「下一步」，看 `RSP` 怎么动、栈上多了什么。

```demo
widget: call-stack-lab
title: 一次调用，栈上多了什么
actions: false
```

几个值得停下来看的位置：

- **第 2 步**：`call calc` 之后，`0x100a` 出现在栈顶。这个值就是「返回地址」。
- **第 6 步**：`call add` 之后，栈上同时有两个返回地址 —— 一个属于 `main → calc`，一个属于 `calc → add`。它们不会互相覆盖，因为压在不同的格子里。
- **第 7 步**：`ret` 弹走 `0x2012`，`RSP` 涨回去，而 `eax` 里的 13 完全没受影响。返回地址和返回值在这一刻分道扬镳。

### 在真机上验一次

光看示意图容易将信将疑。下面这段代码（省略了全局变量和打印）在被调用函数的入口读两样东西：栈指针，以及栈顶那一格（x86-64）或 `x30`（AArch64）。因为加了 `-fomit-frame-pointer`，函数入口没有 `push rbp` 挡在栈顶前面。

```c
__attribute__((noinline))
void probe(void) {
#if defined(__x86_64__)
    __asm__ volatile("movq %%rsp, %0"          : "=r"(sp_in_callee));
    __asm__ volatile("movq (%%rsp), %0"        : "=r"(ret_in_callee));
#elif defined(__aarch64__)
    __asm__ volatile("mov %0, sp"              : "=r"(sp_in_callee));
    __asm__ volatile("mov %0, x30"             : "=r"(ret_in_callee));
#endif
}
```

两个架构各跑一次，再和反汇编里的地址对照：

| 架构 | 探针读到的值 | 反汇编里 `call` 的地址 | 它的下一条 |
|---|---|---|---|
| x86-64（Rosetta） | `0x104ffd58e` | `0x100000589` `callq _probe` | `0x10000058e` |
| AArch64（原生） | `0x104fcc584` | `0x100000580` `bl _probe` | `0x100000584` |

两行都差了同一个加载偏移（ASLR 每次运行不同），把偏移减掉，探针读到的值和「`call` 的下一条」逐位相同。==返回地址就是调用指令后面那条指令的地址。== 这句话到此不是比喻，是量出来的。

## 04 · 栈帧：一次调用占的那一段

一次调用在栈上占的那段，叫**栈帧**（stack frame）。`calc` 的真机反汇编（macOS x86-64，`clang -O0`，去掉 `.cfi_*` 与注释）：

```text
_calc:
0x100000360  pushq  %rbp              ; 保存调用者的帧底
0x100000361  movq   %rsp, %rbp        ; 给这一帧插桩
0x100000364  subq   $0x10, %rsp       ; 给局部变量腾 16 字节
0x100000368  movl   %edi, -0x4(%rbp)  ; 参数 x 落到本地
0x10000036b  movl   -0x4(%rbp), %edi
0x10000036e  movl   $0x3, %esi
0x100000373  callq  _add              ; ← 返回地址 = 0x100000378
0x100000378  movl   %eax, -0x8(%rbp)  ; 返回值 s 存回来
0x10000037b  movl   -0x8(%rbp), %eax
0x10000037e  shll   %eax              ; s * 2
0x100000380  addq   $0x10, %rsp       ; 撤掉局部变量
0x100000384  popq   %rbp              ; 还回旧帧底
0x100000385  retq                     ; 弹出返回地址，跳回去
```

前三条是**序言**（prologue），后三条是**尾声**（epilogue）。框架是固定的：进门先占地方，出门前把自己的地方收拾干净、把调用者的状态还回去。

`call` 和 `ret` 也是成对的：`call` 压一个 8 字节地址进栈，`ret` 弹掉它。所以 `calc` 这一帧在栈上的实际高度是 `0x10 + 8 = 24` 字节，不是 `subq` 里写的 16。

```memmap
title: 一个栈帧里装了什么
sub: x86-64 · calc() 的帧（clang -O0 反汇编对照）
high: 调用者的方向
low: RSP 的方向
segments:
  - { label: 调用者压进来的参数, sub: 第 7 个及以后的整数参数才走栈，本例没有, tone: muted, size: 0.8, mark: "RBP+16 起" }
  - { label: 返回地址, sub: "call 压的 8 字节：0x100000378", tone: blue, size: 1.0, mark: "RBP+8 · ret 弹走它" }
  - { label: 旧的 RBP, sub: "push rbp 压的：调用者的帧底", tone: violet, size: 1.0, mark: "RBP+0 · RBP 指这里" }
  - { label: 局部变量, sub: "int x 在 RBP-4，int s 在 RBP-8（同一格的上半部分）", tone: amber, size: 1.4, mark: "RBP-8 附近" }
  - { label: 没用上的 8 字节, sub: "sub rsp, 0x10 腾了 16 字节，两个 int 只用掉 8", tone: muted, size: 1.0, mark: "对齐的余量" }
  - { label: 红区（leaf 可用）, sub: "RSP 以下 128 字节，信号处理不会碰，叶子函数可以白用", tone: green, size: 1.0, mark: "RSP 以下" }
note: 帧底由 **RBP** 钉住，帧顶由 **RSP** 跟着调用走 —— 两个指针各管一件不同的事。
```

### 为什么两个指针都要有

`RBP` 在序言里被设成当时的 `RSP`，之后**不动**；`RSP` 还会继续变（`sub` 腾局部变量、`call` 又压返回地址）。有了这根桩：

- 局部变量用固定偏移（`RBP-4`、`RBP-8`）就能找到，不随 `RSP` 的变化而漂移。
- 调试器和异常处理靠它把一帧一帧串起来，还原调用链。

`RBP` 不是必须的。加上 `-fomit-frame-pointer`（`-O2` 通常默认打开）后，编译器改用 `RSP` 偏移寻址，省掉两条指令和一个寄存器；此时「帧」还在，只是没有那根桩，靠 `.eh_frame` 这类 unwind 信息来描述每一帧多大。03 节里的探针程序就是这么编的：栈顶第一格直接就是返回地址。

!!「栈顶」和「这一帧的底」不是一个东西。!! 把 `SP` 直接当成「帧指针」用，是读汇编时最常见的错位来源。

## 05 · 为什么必须存：同一个函数会被从不同地方调用

`call` 每次都现场压返回地址，不是为了好看。`foo` 被两个地方调用时，它执行完该回哪，取决于**这一次**是谁调的：

```c
void main(void) {
    foo();          // 返回地址 A
    bar();
    foo();          // 返回地址 B
}
```

`foo` 自己不知道调用者是谁，也没有地方记住上一次。所以每个 `call` 各压各的，谁调的、回谁那儿。

嵌套调用也是同一件事。`main → calc → add` 三层同时活着，栈上就同时有三份「我在哪」：

```memmap
title: 三层同时活着，栈上就有三份「我在哪」
sub: main → calc → add · 地址是示意值
high: （main 进来时的方向）
low: （压栈的方向）
segments:
  - { label: main 的帧, sub: "它自己的局部变量", tone: muted, size: 1.2 }
  - { label: 返回地址 → main 的 0x100a, sub: "calc 的 call 压进来的", tone: blue, size: 1.1 }
  - { label: calc 的帧, sub: "旧 RBP + 它的局部变量", tone: amber, size: 1.2 }
  - { label: 返回地址 → calc 的 0x2012, sub: "add 的 call 压进来的", tone: blue, size: 1.1 }
  - { label: add 的帧, sub: "正在跑的这一层", tone: green, size: 1.2, mark: "RSP 在这里" }
note: 视觉上从上往下压，弹出的顺序正好反过来。
```

后压的在下面，先弹。`add` 先返回，`calc` 后返回 —— 这个顺序刚好是「最后调用的最先结束」，也就是栈的 LIFO。==用栈不是因为栈这种数据结构优雅，是因为函数调用本身是嵌套的。==

递归只是把这件事重复很多次。`fact(4)` 在 AArch64 上实测（同一次运行打印四层 `sp`）：

```memmap
title: fact(4) 的四个帧
sub: "AArch64 · 本机实测 sp；反汇编里是 sub sp, sp, #0x40"
high: "0x16ae_4b0c0"
low: "0x16ae_4b000"
segments:
  - { label: "fact(4)", sub: "sp = 0x16ae4b0c0", tone: blue, size: 1, addr: "0x…b0c0" }
  - { label: "fact(3)", sub: "sp = 0x16ae4b080 · 少了 0x40", tone: blue, size: 1, addr: "0x…b080" }
  - { label: "fact(2)", sub: "sp = 0x16ae4b040 · 又少 0x40", tone: blue, size: 1, addr: "0x…b040" }
  - { label: "fact(1)", sub: "sp = 0x16ae4b000 · 到底了，开始往回走", tone: green, size: 1, dir: down, mark: "栈顶", addr: "0x…b000" }
note: '每帧 0x40 字节是 `sub sp, sp, #0x40` 一次腾出来的；递归多深，栈就压多深。'
```

x86-64 上同一段程序每层是 `0x20` 字节（`subq $0x18` 加的 24，再加 `call` 压的 8）。两个架构帧大小不同，但规律一样：**每层一帧，帧大小由编译器算好，固定不变**。

### 栈有上限，这是真的会崩

栈是进程地址空间里划出的一段，不是无限的。本机 `ulimit -s` 是 8176 KB，同一段递归程序（每帧只放 64 字节的数组）：

| 递归层数 | 结果 |
|---|---|
| 10 000 | 正常返回 |
| 60 000 | 正常返回 |
| 100 000 | `Segmentation fault: 11` |

60 000 × 每帧约 140 字节 ≈ 8 MB，和 `ulimit -s` 对得上。!!「递归太深会栈溢出」不是比喻!!：`RSP` 一路往下，走出了这段内存，下一次写就撞上别的页，操作系统直接给进程一个 SIGSEGV。

## 06 · AArch64 不一样：返回地址先放寄存器

x86 把返回地址压栈，AArch64 不是。AAPCS64 对 `BL` 的描述是：

```callout
tone: muted
icon: 📖
quote: true
text: |
  The effect of executing BL is to transfer the sequentially next value of the
  program counter — the return address — into the link register (LR) and the
  destination address into the program counter.
```

也就是说：`bl` 把「顺序的下一条 PC」送进 `x30`，把目标地址送进 PC —— 返回地址先进寄存器，内存先不动。

`LR` 就是 `x30`。跳转时地址进寄存器，不进内存。那栈上的返回地址是哪来的？是被调用函数自己存进去的 —— 前提是它还会调用别人。真机对照：

```text
_calc:
0x100000348  sub  sp, sp, #0x20          ; 腾 32 字节
0x10000034c  stp  x29, x30, [sp, #0x10]  ; 旧帧指针 + 返回地址，一起存栈
0x100000350  add  x29, sp, #0x10         ; 帧指针插桩
…
0x100000360  bl   0x100000328            ; 调用 add，x30 被覆盖成 0x100000364
…
0x100000370  ldp  x29, x30, [sp, #0x10]  ; 取回
0x100000374  add  sp, sp, #0x20
0x100000378  ret                          ; 跳到 x30

_add:
0x100000328  sub  sp, sp, #0x10
0x10000032c  str  w0, [sp, #0xc]
…                                        ; 没有 stp x29, x30 —— 它不再调别人
0x100000344  ret
```

`add` 是**叶子函数**（不再调用别人），`bl` 不会覆盖它的 `x30`，所以它一条也不用存。`calc` 不是叶子，一旦执行 `bl`，`x30` 里「回到 main」的地址就被冲掉了，只能提前存到栈上。

用 lldb 停在 `calc` 的 `call` 之前，可以直接读出来：

```text
(lldb) register read x29 x30 sp
      fp = 0x000000016fdfef50
      lr = 0x0000000100000394   demo-arm64`main + 24
      sp = 0x000000016fdfef40
(lldb) memory read -s8 -c2 0x000000016fdfef50
0x16fdfef50: 0x000000016fdfef70  0x0000000100000394
```

第二格 `0x1000000394` 就是 `main` 里 `bl _calc`（在 `0x100000390`）的下一条。它正躺在栈上、`sp + 0x10` 的位置 —— 和 `stp x29, x30, [sp, #0x10]` 对得上。

```compare
first: 对比项
head: [x86-64（System V）, AArch64（AAPCS64）]
rows:
  - 返回地址放哪: ["`call` 直接压到栈顶", "`bl` 写进 `x30`（LR）"]
  - 谁负责存到栈上: ["CPU 在 `call` 里做", "被调用函数自己，且只在它不是叶子时"]
  - 帧指针: ["`RBP`（可选）", "`x29`（可选）"]
  - 栈对齐: ["进函数时 `RSP+8` 是 16 的倍数", "`SP` 始终 16 的倍数"]
  - 返回值: ["`rax`（第二个在 `rdx`）", "`x0`（第二个在 `x1`）"]
  - 前几个参数走寄存器: ["`rdi` `rsi` `rdx` `rcx` `r8` `r9`", "`x0`–`x7`"]
```

==所以通用说法是「调用时要保存返回地址」，不是「必须压栈」。== 存哪、谁存、什么时候存，由架构和 ABI 定。原始材料第 8 点说得对，这里只是把它落到两段真实汇编上。

## 07 · 速查：容易记反的六件事

```checklist
tone: cross
items:
  - "「返回地址」等于函数的返回值。—— 一个是地址，一个是值，存在不同的地方。"
  - "返回地址是 `call` 自己那条指令的地址。—— 是它的**下一条**。"
  - "返回地址是函数的第一条指令。—— 那是入口地址，返回时跳过去就死循环了。"
  - "`SP` 永远指向这一帧的底部。—— 帧底通常由 `RBP` / `x29` 钉住，`SP` 会随 `sub` 和 `call` 变。"
  - "栈在内存里向高地址增长。—— x86-64 和 AArch64 都是向低地址，所以「栈顶」画在下面。"
  - "所有函数的栈帧一样大。—— 每个函数的帧大小由编译器按它的局部变量算，函数之间可以差很多。"
```

```summary
title: 一句话
text: |
  `call` 把「下一条指令的地址」压到栈顶，`ret` 把它弹出来跳回去；
  被调用函数在中间用 `SP` 往下要地方、用 `RBP` 钉住帧底。
  ==返回地址是控制流的回程票，返回值是数据的结果，别混。==
```

```quiz
- q: 一个函数被 A 和 B 两处调用，它的返回地址是谁决定的？
  a: |
    由**每一次调用时的那条 `call`** 决定：压进栈的是 `call` 的下一条指令地址。
    函数本身不知道调用者是谁，也不保存「上一次」的返回地址 —— 所以每次调用各压一份。
- q: 为什么 x86-64 的 `sub rsp, 0x10` 里常常只用掉一半的字节？
  a: |
    ABI 要求对齐：`call` 之前 `RSP` 要是 16 的倍数，SSE / AVX 的一些指令要求 16 字节对齐访问。
    编译器宁可多腾几个字节，也不让局部变量落在不对齐的地址上。
- q: AArch64 上，为什么 `add` 没有 `stp x29, x30`，而 `calc` 有？
  a: |
    `add` 是叶子函数，不再执行 `bl`，`x30` 里的返回地址不会被覆盖，所以不用存。
    `calc` 要调 `add`，`bl` 会把 `x30` 冲掉，所以进函数时先把它存到栈上。
- q: 递归 10 万层崩掉，是算法写错了吗？
  a: |
    不是。每层都要占一帧，帧叠起来就是栈的高度。栈是进程地址空间里一段有限的内存
    （本机 `ulimit -s` 约 8 MB），`RSP` 走出这段就是栈溢出，进程收到 SIGSEGV。
```
