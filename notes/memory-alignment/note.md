> 一个 `char` + `int` + `double`，直觉上是 1 + 4 + 8 = 13 字节，`sizeof` 却是 16。多出来的 3 个字节不存任何值，只为了让后面的 `int` 从 4 的倍数开始。
>
> 这篇先把这笔账算清楚，再核对一句最常见的解释：「未对齐要读两次，所以慢」。在这台机器上，这句话测不出来。对齐真正买到的是另外几样东西。

## 00 · 问题与原文里最值得核对的三段

```popquote
label: 问题与原文摘录
sub: 三问 · 原文只摘了要核对的部分
tone: violet
note: 问题原样保留；答案里的三段是逐字摘的，其余部分没有搬进来。
text: |
  #### 问

  > 什么是内存对齐，有什么作用，感觉有点浪费啊。

  #### 原文「13 变成 16」

  > 直觉上大小是：1 + 4 + 8 = 13 字节。但实际常常是 16 字节：
  >
  > ```
  > 0:  c       占 1 字节
  > 1~3: 填充（padding）3 字节
  > 4~7:  i      占 4 字节
  > 8~15: d      占 8 字节
  > ```

  #### 原文「CPU 读得更快」

  > 如果一个 4 字节整数刚好位于 4 字节边界上，CPU 往往一次读取就可以拿到。但如果它跨越了边界，CPU 可能需要：1. 读前一个内存块；2. 再读后一个内存块；3. 拼出完整的整数。

  #### 原文「调整顺序」

  > 仅仅调整成员顺序，就从 24 字节减少为 16 字节。
```

## 01 · 13 变成 16：那 3 个字节在哪

先把 `struct A` 摊开。本机 clang 量出来的结果是 `sizeof = 16`、`align = 8`，成员偏移是 `c=0`、`i=4`、`d=8`：

```raw
<div style="overflow-x:auto;margin:6px 0 14px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin:16px 0 4px">
    <div style="width:118px;font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2)">struct A</div>
    <div>
      <div style="display:grid;grid-template-columns:repeat(16,40px);height:34px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden">
        <div style="grid-column:span 1;background:var(--blue-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--blue)">c</span></div><div style="grid-column:span 3;border-left:1px solid var(--border);background:repeating-linear-gradient(45deg,var(--border) 0 2px,transparent 2px 7px),var(--surface-2);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--muted)">填充 3</span></div><div style="grid-column:span 4;border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="grid-column:span 8;border-left:1px solid var(--border);background:var(--green-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--green)">d</span></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(16,40px);margin-top:4px"><div style="grid-column:span 1;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">0</div><div style="grid-column:span 3;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">1–3</div><div style="grid-column:span 4;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">4–7</div><div style="grid-column:span 8;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">8–15</div></div>
    </div>
    <div style="font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2);white-space:nowrap">16 字节</div>
  </div>
  <div style="font-size:12px;color:var(--muted);margin:2px 0 10px 132px">蓝 = char，紫 = int，绿 = double，斜纹 = 编译器补的填充（不存任何值）</div>
</div>
```

`c` 后面那 3 个字节是填充。它不存任何值，读它也没有意义；编译器在 `c` 和 `i` 之间留出这段空位，只有一个目的：让 `i` 的地址是 4 的倍数。

规则只有三条，按顺序套一遍就得到 16：

1. **每个成员的偏移，必须是它自身对齐值的倍数。** `i` 要 4 的倍数，所以 `c` 后面补 3。
2. **结构体的对齐值，取成员里最大的那个。** 这里是 `double` 的 8。
3. **结构体的总大小，要补到对齐值的倍数。** `d` 结束在 16，正好是 8 的倍数，不用再补。

三条合起来，13 变成 16。这个布局不是编译器「顺手」排的，是 ABI 规定的：同一份头文件，所有编译器都要排出一样的偏移，否则两个模块没法互操作。

本机实测（Apple clang 21 · arm64）：

```text
struct A { char c; int i; double d; }   sizeof 16  align 8   c=0 i=4 d=8
struct B { char c; double d; int i; }   sizeof 24  align 8   c=0 d=8 i=16
struct C { double d; int i; char c; }   sizeof 16  align 8   d=0 i=8 c=12
packed   { char type; int length; }     sizeof 5   align 1   type=0 length=1
标量对齐：char 1 · short 2 · int 4 · double 8 · 指针 8
```

```callout
tone: violet
icon: 🧭
text: |
  **填充不是「编译器忘了优化」。**

  它是布局契约的一部分。`sizeof` 里含填充，`offsetof` 里也含；你用 `#pragma pack` 或 `__attribute__((packed))` 可以改，但那等于单方面改了契约，代价在第 05 节。
```

## 02 · 「未对齐要读两次」在这台机器上测不出来

最常见的解释是这样：一条读通道一次取一个 8 字节对齐窗口；4 字节的 `int` 如果横跨两个窗口，就要取两次，再拼起来。

```raw
<div style="overflow-x:auto;margin:6px 0 10px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin:18px 0 6px">
    <div style="width:118px;font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2);padding-top:18px">i 在 4</div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px">偏移 0–7</div>
        <div style="display:grid;grid-template-columns:repeat(8,40px);height:38px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden"><div style="background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"></div></div>
      </div>
      <div style="width:6px"></div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px">偏移 8–15</div>
        <div style="display:grid;grid-template-columns:repeat(8,40px);height:38px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden"><div style="background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div></div>
      </div>
    <div style="font-size:12px;line-height:1.5;color:var(--green);padding-top:22px;max-width:260px">一次读就装下</div>
  </div>
  <div style="display:flex;align-items:flex-start;gap:14px;margin:18px 0 6px">
    <div style="width:118px;font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2);padding-top:18px">i 在 5</div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px">偏移 0–7</div>
        <div style="display:grid;grid-template-columns:repeat(8,40px);height:38px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden"><div style="background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"></div></div>
      </div>
      <div style="width:6px"></div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px">偏移 8–15</div>
        <div style="display:grid;grid-template-columns:repeat(8,40px);height:38px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden"><div style="background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div><div style="border-left:1px solid var(--border);background:var(--surface-2);display:flex;align-items:center;justify-content:center"></div></div>
      </div>
    <div style="font-size:12px;line-height:1.5;color:var(--red);padding-top:22px;max-width:260px">跨过边界：读两次，再拼起来</div>
  </div>
  <div style="font-size:12px;color:var(--muted);margin:6px 0 0 132px">每个方框是一次 8 字节读；紫 = int 的 4 个字节，灰 = 其余的字节。两个方框之间的缝就是偏移 8 的边界</div>
</div>
```

这个模型解释了规则为什么存在。但它同时预测「未对齐一定更慢」。本机量了一下，这个预测不成立。

测法：32KB 的缓冲（装得进 L1），每轮做 1700 万次 4 字节读，三组只差读的起始地址；跑 6 轮取最快的一次。

```c
memcpy(&v, buf + ((i * stride + off) & (BUF - 1)), 4);   // 编译成一条 ldr / ldur
```

```text
                 6 轮取最快      每次
对齐（偏移 0）      4.9 ms       0.29 ns
偏移 1             4.8 ms       0.28 ns
跨 128 字节行       4.9 ms       0.29 ns
```

三组都落在 0.28–0.29 ns，差别比噪声小。数据在 L1、顺序扫、4 字节读，这台 M4 的硬件把未对齐访问直接处理掉了。

```callout
tone: amber
icon: ⚠
text: |
  **「未对齐要读两次」可以用来理解规则，不能用来解释线上变慢。**

  这个结果只覆盖一种情况：普通标量读、数据在 L1。数据不在缓存、跨页边界、别的架构，都是另外的账。更要紧的是，对齐的硬要求并不来自「标量读慢」，而是下面四件事。
```

## 03 · 那对齐买到了什么

```cards
cols: 2
items:
  - title: 可移植：别的架构会出错
    tag: 最重要的一条
    tone: amber
    desc: 不是所有 CPU 都像 x86 / 这台 arm64 这样容忍未对齐访问
    body: |
      Linux 内核文档把未对齐访问的后果分成四档：

      1. 硬件透明处理，但有明显的性能代价；
      2. 触发异常，异常处理程序修好它，代价更大；
      3. 触发异常，但异常里没有足够信息修；
      4. ==不报错，静默做了一次「别的」内存访问，留下很难查的 bug==。

      同一份 C 代码要在第 4 档的机器上也是对的，就得按自然对齐写。
  - title: 原子与独占访问：硬要求
    tag: 不对齐就报错
    tone: red
    desc: 这类指令不对齐不是「慢一点」，是直接失败
    body: |
      arm64 的 `LDXR` / `STXR` 要求地址按访问宽度对齐；不对齐会触发 Alignment fault（Arm 手册在 STXR 那一页写明）。

      x86 的 `LOCK` 前缀不受对齐影响（Intel 手册原话），但操作数跨两条缓存行时，处理器会退回去锁总线：Linux 内核文档记的代价是几千个周期，而且会挡住其他核。

      两边的处理不同，结论一样：==对齐的原子操作才是便宜的原子操作==。
  - title: SIMD：对齐指令会 fault
    tag: 一条指令的选择
    tone: violet
    desc: 对齐版本和未对齐版本是两条不同指令
    body: |
      `movaps` / `vmovaps` 要求内存操作数按 16 / 32 / 64 字节对齐，不对齐直接 `#GP`；想读未对齐的数据，得换成 `movups` 这一支。

      编译器看到你的数据没对齐，就不会选最快的那条指令。所以「对齐」有时不是省了几个周期，而是决定了能不能用上某个指令。
  - title: 数组：每个元素都要对齐
    tag: 决定了尾部填充
    tone: green
    desc: 这是「整个结构体也要补齐」的唯一原因
    body: |
      如果结构体大小不是对齐值的倍数，数组里第二个元素的成员就会落在错误的位置。

      内核文档的原话是：尾部填充「是为了满足这类结构体数组的对齐约束」。下一节把账算出来。
```

### 尾部填充到底在防什么

拿一个更小的结构体：`struct { int i; char c; }`。内部不用补（`i` 在 0，`c` 在 4），但总大小会补到 8。

| 排法 | sizeof | `arr[0].i` 地址 | `arr[1]` 起始 | `arr[1].i` 地址 | 4 的倍数？ |
|---|---|---|---|---|---|
| 补到 8（实际） | 8 | 0 | 8 | 8 | ✓ |
| 不补（5 字节） | 5 | 0 | 5 | 5 | ✗ |

`i` 在结构体内部的偏移是 0，所以 `arr[n].i` 的地址就是 `n × sizeof`。`sizeof` 不是 4 的倍数，第二个元素就歪了 —— 这才是尾部填充存在的理由，不是为了「让结构体好看」。

```callout
tone: violet
icon: 🧭
text: |
  **对齐不是 CPU 的偏好，是两份契约加几条硬指令。**

  契约一：ABI 规定了每个类型的对齐值和结构体布局；契约二：数组要求每个元素都满足成员的对齐。硬指令则是原子/独占和 SIMD 那几条 —— 它们不对齐就直接报错。
```

## 04 · 换个顺序：同样的成员，24 变 16

`struct B` 只是把 `A` 的成员换了个顺序：`char` 在最前，`double` 在中间。大小从 16 涨到 24：

```raw
<div style="overflow-x:auto;margin:6px 0 14px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin:16px 0 4px">
    <div style="width:118px;font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2)">struct B</div>
    <div>
      <div style="display:grid;grid-template-columns:repeat(24,40px);height:34px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden">
        <div style="grid-column:span 1;background:var(--blue-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--blue)">c</span></div><div style="grid-column:span 7;border-left:1px solid var(--border);background:repeating-linear-gradient(45deg,var(--border) 0 2px,transparent 2px 7px),var(--surface-2);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--muted)">填充 7</span></div><div style="grid-column:span 8;border-left:1px solid var(--border);background:var(--green-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--green)">d</span></div><div style="grid-column:span 4;border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="grid-column:span 4;border-left:1px solid var(--border);background:repeating-linear-gradient(45deg,var(--border) 0 2px,transparent 2px 7px),var(--surface-2);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--muted)">填充 4</span></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(24,40px);margin-top:4px"><div style="grid-column:span 1;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">0</div><div style="grid-column:span 7;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">1–7</div><div style="grid-column:span 8;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">8–15</div><div style="grid-column:span 4;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">16–19</div><div style="grid-column:span 4;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">20–23</div></div>
    </div>
    <div style="font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2);white-space:nowrap">24 字节</div>
  </div>
</div>
```

`c` 后面补 7 个字节才能让 `double` 从 8 开始；`i` 结束在 20，总大小要补到 8 的倍数，于是再补 4 个。

把顺序换成「对齐要求从大到小」，同样的三个成员只要 16：

```raw
<div style="overflow-x:auto;margin:6px 0 14px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin:16px 0 4px">
    <div style="width:118px;font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2)">struct C</div>
    <div>
      <div style="display:grid;grid-template-columns:repeat(16,40px);height:34px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden">
        <div style="grid-column:span 8;background:var(--green-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--green)">d</span></div><div style="grid-column:span 4;border-left:1px solid var(--border);background:var(--violet-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--violet)">i</span></div><div style="grid-column:span 1;border-left:1px solid var(--border);background:var(--blue-soft);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--blue)">c</span></div><div style="grid-column:span 3;border-left:1px solid var(--border);background:repeating-linear-gradient(45deg,var(--border) 0 2px,transparent 2px 7px),var(--surface-2);display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:var(--muted)">填充 3</span></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(16,40px);margin-top:4px"><div style="grid-column:span 8;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">0–7</div><div style="grid-column:span 4;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">8–11</div><div style="grid-column:span 1;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">12</div><div style="grid-column:span 3;border-left:1px solid transparent;font-size:9px;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap">13–15</div></div>
    </div>
    <div style="font-family:var(--mono);font-size:12px;line-height:34px;color:var(--text-2);white-space:nowrap">16 字节</div>
  </div>
</div>
```

`d` 占 0–7，`i` 占 8–11，`c` 占 12，尾部补 3 个凑到 16。填充从 11 个字节降到 3 个。

经验规则：**按对齐值从大到小排**（`double` / 指针 → `int` → `short` → `char`）。这只是减少 `sizeof` 的经验，不是通用优化：

- 它不改变访问速度。字段顺序只影响布局，不影响某个字段读起来快不快。
- 如果结构体会被序列化、`mmap`、或者和别的语言共享，**不要为了省字节改顺序** —— 那时布局是协议的一部分。
- C 保证成员按声明顺序存放，Go 的实现也按声明来：想省字节，得自己调顺序。

## 05 · packed：什么时候值得

`#pragma pack(1)` 或 `__attribute__((packed))` 会告诉编译器「不要插填充」。`struct { char type; int length; }` 从 8 变成 5。

```compare
first: 对比项
head: [正常布局, packed]
rows:
  - sizeof: ["8", "5"]
  - 成员访问: ["一条普通 load / store", "编译器可能要拆成多条字节访问，或者调用 memcpy 一类的辅助"]
  - 对齐保证: ["`length` 在 4 的倍数上", "`length` 在偏移 1 —— 未对齐"]
  - 取成员地址: ["得到对齐的指针", "得到未对齐的指针，GCC 默认就会警告"]
  - 适合: ["内存里的业务结构", "网络包、文件头、硬件寄存器这类布局固定的东西"]
```

内核文档对 packed 的说明很直接：编译器知道对齐约束，会生成额外的指令来避免未对齐访问，所以「只有当你确实在意结构体填充时才该用」。

```callout
tone: amber
icon: ⚠
text: |
  **packed 不是「省内存」的开关。**

  省下的字节，可能换来每次访问的多条指令；而且 `&p.length` 这种取地址传给别的函数时，对方拿到的是一个未对齐的指针 —— 编译器管不了跨函数的那次访问。GCC 的 `-Waddress-of-packed-member` 默认就会为它报警。

  真正需要 packed 的场合，布局是外部协议定死的：网络包、磁盘文件格式、硬件寄存器。普通业务结构体，先考虑调字段顺序。
```

## 06 · 三条带走

1. 填充是布局规则的结果：每个成员落在自己对齐值的倍数上，整个结构体补到最大对齐的倍数，数组里每个元素才都对齐。
2. 「未对齐读一定慢」在这台机器上测不出来。有硬要求的是另外几样：别的架构、原子与独占访问、SIMD、以及 ABI 和数组。
3. 想少占内存，先调字段顺序；要固定二进制布局，才用 packed，并且知道它的代价。

```summary
title: 一句话
text: |
  那 3 个字节买的不是速度，是**保证**：保证每个成员都落在该在的倍数上，保证数组里第二个元素不会歪，保证原子和 SIMD 指令不报错。
  ==在这台机器上，普通未对齐读甚至不慢 —— 但规则不只为这台机器写。==
```

```quiz
- q: struct A { char c; int i; double d; } 为什么是 16 字节，不是 13？
  a: |
    i 要求偏移是 4 的倍数，所以 c 后面补 3 个字节，i 在 4–7；d 要求 8 的倍数，正好在 8–15。
    最后总大小要补到结构体对齐值（成员里最大的 8）的倍数；16 已经是 8 的倍数，不用再补。
    13 是数据的字节数，16 是布局的字节数。
- q: 既然对齐是为了快，为什么这台机器上未对齐的 4 字节读和对齐读一样快？
  a: |
    因为普通标量读不是对齐的硬要求。现代核在 L1 里直接处理未对齐的 4 字节读，本机 6 轮取最快，三组都在 0.28–0.29 ns。
    对齐真正的硬要求来自别处：别的架构可能 fault 或静默做错事；arm64 的独占访问不对齐会触发对齐异常；
    SIMD 的对齐指令不对齐会 #GP；还有 ABI 和数组的布局约束。
- q: struct B { char c; double d; int i; } 是 24，怎么把它变成 16？
  a: |
    按对齐值从大到小重排：double、int、char，变成 d 在 0–7、i 在 8–11、c 在 12，尾部补 3 个，正好 16。
    填充从 11 个字节降到 3 个。注意这只有在结构体是纯内存结构时才能做；
    如果它要被序列化或和别的语言共享，字段顺序就是协议，不能动。
- q: packed 之后 sizeof 从 8 变成 5，为什么访问可能变慢，甚至出错？
  a: |
    成员的偏移不再满足对齐要求，编译器要么生成多条字节访问来拼，要么走辅助函数，所以变慢。
    更麻烦的是取成员地址：&p.length 会得到一个未对齐的指针，传给别的函数时对方按对齐访问就会出错，
    GCC 的 -Waddress-of-packed-member 默认就会警告这一点。所以 packed 只适合布局由外部协议定死的场合。
```

顺手接着看两处：[锁为什么慢](../lock-memory-barriers/) 讲缓存行和伪共享（为什么两个变量在同一行，比不对齐更影响性能）；[CAS 是缓存一致性协议实现的吗](../cas-coherence-layers/) 讲原子操作要独占一整条缓存行，以及跨行的原子操作为什么会退化成锁总线。
