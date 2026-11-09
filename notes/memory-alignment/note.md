> 在本机的 C 编译环境中，`char`、`int`、`double` 分别占 1、4、8 字节。把它们放进一个结构体，成员一共占 13 字节，整个结构体却占 16 字节。多出的 3 字节是填充，用来让成员放在满足对齐要求的位置。
>
> 这篇先解释对齐和填充，再看未对齐访问、数组为什么需要填充，以及调整成员顺序怎样节省空间。

## 00 · 原问题与三段摘录

```popquote
label: 问题与原文摘录
sub: 原问题和三段相关解释
tone: violet
note: 这里保留原问题和三段摘录，下面结合例子说明。
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

## 01 · 什么是对齐，13 字节为什么变成 16 字节

**对齐**是对数据起始地址的要求。例如，在本机的 C 编译环境中，`int` 的对齐值是 4：一个普通 `int` 的起始地址应当是 4 的倍数，如 `0x1000` 或 `0x1004`，而不是 `0x1001`。对齐值由平台和类型决定，不一定等于所有平台上的类型大小。

看 `struct A { char c; int i; double d; }`。本机 Apple clang 测得：结构体的 `sizeof` 是 16 字节，对齐值是 8。`sizeof` 表示整个结构体占多少字节，包括填充；**偏移**表示成员距离结构体起始位置有多少字节。

假设结构体从一个 8 字节对齐的地址开始，`c`、`i`、`d` 的偏移分别是 0、4、8。下图每格代表一个字节：

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
  <div style="font-size:12px;color:var(--muted);margin:2px 0 10px 132px">蓝 = char，紫 = int，绿 = double，斜纹 = 编译器补的填充（不保存成员的值）</div>
</div>
```

`c` 占第 0 个字节。下一个成员 `i` 需要从 4 的倍数开始，因此编译器在偏移 1–3 处留出 3 个填充字节。`i` 占 4–7，`d` 从 8 开始，占 8–15。填充不属于任何成员，也不保存成员的值。

在本机这个普通结构体的布局中，计算过程可以分成三步：

1. **安排每个成员。** 结构体起始地址已经满足对齐要求；各成员的偏移也要满足各自的对齐要求，所以 `i` 前面补 3 字节。
2. **确定结构体的对齐值。** 本例取成员中最大的对齐值，也就是 `double` 的 8。
3. **确定结构体的总大小。** 总大小要是结构体对齐值的倍数。`d` 结束后已经占了 16 字节，不需要再补。

这些布局规则由目标平台的 ABI（应用二进制接口）约定。ABI 包括类型对齐、结构体布局等规则，让遵循相同约定的二进制模块能够互相调用和传递数据。换一个平台，或使用不同的打包选项，结果可能不同。

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
  **填充会计入结构体的大小，也会影响后续成员的偏移。**

  `sizeof` 可以查看整个结构体的大小，`offsetof` 可以查看成员偏移。`#pragma pack` 和 `__attribute__((packed))` 等选项会改变布局；如果数据要在不同模块之间共享，双方需要使用兼容的布局。
```

## 02 · 未对齐访问一定会更慢吗

先看一种简化的读取方式：假设读取通道每次只能取一个按 8 字节对齐的范围，图中的偏移也从一个 8 字节对齐的位置开始。

4 字节的 `int` 从偏移 4 开始时，4 个字节都在第一个范围内；从偏移 5 开始时，它跨过了两个范围，按照这个假设需要读取两次。这个图是在说明一种可能的情况，不代表真实 CPU 一定采用这种读取方式。

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

在本机测试中，普通的未对齐读取没有表现出明显的额外开销。

测法是：用一个 32KB 的缓冲区，数据主要在 L1 缓存中；L1 是 CPU 靠近处理器核心的一层高速缓存。每轮做 1700 万次 4 字节读取，三组只改变读取的起始位置。每组跑 6 轮，取耗时最短的一轮。下表的「每次」是总耗时除以读取次数，表示平均开销，不是单次读取的延迟。

```c
memcpy(&v, buf + ((i * stride + off) & (BUF - 1)), 4);   // 编译成一条 ldr / ldur
```

```text
                 6 轮取最快      每次
对齐（偏移 0）      4.9 ms       0.29 ns
偏移 1             4.8 ms       0.28 ns
跨 128 字节行       4.9 ms       0.29 ns
```

三组的平均开销都在 0.28–0.29 ns，差别小于这次测试的噪声。表里的「行」指缓存行，即缓存管理数据的基本块；本机测试使用的缓存行大小是 128 字节。

```callout
tone: amber
icon: ⚠
text: |
  **这次结果不代表所有未对齐访问都一样快。**

  测试覆盖的是本机 L1 缓存中的普通 4 字节读取。数据不在缓存、访问跨越页边界，或者换成其他架构时，结果可能不同。

  除了性能，一些平台、指令和数据布局本身也有对齐要求。下面分别来看。
```

## 03 · 对齐有什么作用

```cards
cols: 2
items:
  - title: 不同架构的访问要求
    tag: 可移植性
    tone: amber
    desc: 不同 CPU 对未对齐访问的处理方式可能不同
    body: |
      Linux 内核文档列出四种可能的结果，具体出现哪一种取决于架构：

      1. 硬件自动处理，但访问可能变慢；
      2. 触发异常，由异常处理程序修复，开销更大；
      3. 触发异常，但处理程序无法修复；
      4. ==没有报错，却访问了错误的位置==。

      按目标平台的对齐要求放置数据，有助于代码在不同架构上正确运行。
  - title: 原子与独占访问
    tag: 指令对齐要求
    tone: red
    desc: 有些用于并发操作的指令要求地址对齐
    body: |
      原子操作保证单次操作不会被其他并发操作看到中间状态。arm64 的 `LDXR` / `STXR` 是实现这类操作时会用到的独占访问指令，地址必须按访问宽度对齐；不满足时会触发对齐异常。

      x86 带 `LOCK` 前缀的操作，即使未对齐，完成时也保证原子性；但操作数跨越两条缓存行时可能触发总线锁。Linux 内核文档指出，这可能耗费几千个处理器周期，并影响其他核。

      两种架构的处理方式不同；是否对齐也不是决定原子操作性能的唯一因素。
  - title: SIMD 指令的地址要求
    tag: 指令选择
    tone: violet
    desc: 某些向量读写指令要求内存地址对齐
    body: |
      SIMD 指令可以一次处理多个数据。x86 的 `movaps` / `vmovaps` 要求内存地址按指令宽度分别满足 16 / 32 / 64 字节对齐，否则会触发 `#GP` 异常。

      访问未对齐的数据可以使用 `movups` 等允许未对齐的指令。具体使用哪条指令取决于数据和编译器，不代表未对齐指令一定更慢。
  - title: 数组中的每个元素
    tag: 尾部填充
    tone: green
    desc: 结构体末尾可能需要填充，让数组元素依次对齐
    body: |
      数组元素紧挨着存放，相邻元素的起始地址相差一个结构体的大小。如果这个大小不是结构体对齐值的倍数，后面的元素就可能无法对齐。

      因此，编译器可能在结构体末尾补上字节。下面用一个例子说明。
```

### 数组为什么需要尾部填充

再看本机上的 `struct { int i; char c; }`：`i` 在偏移 0–3，`c` 在偏移 4，成员之间不需要填充。但为了让总大小成为对齐值 4 的倍数，编译器还会在末尾补 3 字节，得到 8 字节。

假设数组 `arr` 从地址 `0x1000` 开始。表中的数字是相对于 `arr[0]` 起始地址的偏移，不是实际地址：

| 排法 | sizeof | `arr[0].i` 偏移 | `arr[1]` 起始偏移 | `arr[1].i` 偏移 | 实际地址是 4 的倍数？ |
|---|---|---|---|---|---|
| 补到 8（本机实际布局） | 8 | 0 | 8 | 8 | ✓ |
| 不补（假设为 5 字节） | 5 | 0 | 5 | 5 | ✗ |

`i` 在每个结构体里的偏移都是 0。如果不做尾部填充，第二个元素从 `0x1005` 开始，里面的 `i` 也位于 `0x1005`，不满足 4 字节对齐。补到 8 字节后，第二个元素从 `0x1008` 开始，两个元素都能对齐。

```callout
tone: violet
icon: 🧭
text: |
  **布局规则和指令要求都可能涉及对齐。**

  ABI 规定类型和结构体的布局；数组中的每个元素都要满足相应的对齐要求。某些原子、独占访问和 SIMD 指令也有自己的地址要求，使用时要按具体指令判断。
```

## 04 · 调整成员顺序，减少填充

本机的 `struct B` 和前面的 `struct A` 有相同的三个成员，只是声明顺序不同：`char` 在最前，`double` 在中间。结果大小从 16 字节变成了 24 字节：

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

`c` 后面需要补 7 字节，才能让 `d` 从偏移 8 开始。`i` 占到偏移 19；此时总共用了 20 字节，还要在末尾补 4 字节，才能成为结构体对齐值 8 的倍数。

把成员按本例的对齐值从大到小排列，得到 `struct C`，总大小降到 16 字节：

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

`d` 占 0–7，`i` 占 8–11，`c` 占 12，末尾补 3 字节。与 `struct B` 相比，填充从 11 字节减少到 3 字节。

**按对齐值从大到小排列成员**，常常能减少填充；本机这个例子的顺序是 `double` → `int` → `char`。调整之前还要考虑：

- 减少结构体大小不保证访问一定更快，缓存和实际访问方式也会影响性能。
- 如果结构体直接用于序列化、`mmap` 或跨语言共享，要先确认外部是否依赖现有布局；随意调整可能破坏兼容性。
- C 结构体的成员按声明顺序存放。要改变顺序，需要修改声明，并检查使用该布局的代码。

## 05 · packed：减少填充的代价

`#pragma pack(1)` 或 `__attribute__((packed))` 可以让编译器采用更紧凑的布局。在本机的简单例子 `struct { char type; int length; }` 中，结构体从 8 字节变成 5 字节，`length` 从偏移 1 开始。

```compare
first: 对比项
head: [正常布局, packed]
rows:
  - sizeof: ["8", "5"]
  - 成员访问: ["按正常对齐要求访问", "编译器可能生成多条指令或调用辅助函数"]
  - 对齐保证: ["`length` 的地址满足 4 字节对齐", "`length` 的偏移是 1，地址不保证对齐"]
  - 取成员地址: ["得到满足对齐要求的指针", "指针可能未对齐，GCC 默认会警告"]
  - 常见用途: ["普通内存结构", "需要匹配固定布局的数据"]
```

编译器知道这个成员可能未对齐，会根据目标平台选择访问方式，必要时生成额外指令。因此 `packed` 可能节省空间，也可能增加访问开销。

```callout
tone: amber
icon: ⚠
text: |
  **取 packed 成员的地址时要特别小心。**

  `&p.length` 得到的指针可能不满足 `int` 的对齐要求。把它传给按普通 `int *` 访问的函数，可能产生未定义行为或触发硬件异常。GCC 默认开启的 `-Waddress-of-packed-member` 会对此发出警告。

  网络包、文件头等外部格式可能要求紧凑布局；还要按格式处理字节序。普通业务结构体如果只是想减少填充，可以先考虑调整成员顺序。
```

## 06 · 小结

1. 对齐规定数据可以从哪些地址开始。在本机的结构体例子中，编译器通过内部和尾部填充，让成员和数组元素满足布局要求。
2. 本机测试中，L1 缓存里的普通 4 字节未对齐读没有明显变慢；其他架构、访问位置和指令可能有不同结果。
3. 调整成员顺序可以减少一些结构体的填充，但要先检查是否影响外部布局。`packed` 可以使布局更紧凑，同时需要处理访问开销和未对齐指针的问题。

```summary
title: 一句话
text: |
  结构体中的填充是为了让成员和数组元素满足对齐要求。
  ==对齐是否影响速度，要结合处理器、指令和实际访问位置判断。==
```

```quiz
- q: 本机的 struct A { char c; int i; double d; } 为什么是 16 字节，不是 13？
  a: |
    i 要求从 4 的倍数开始，所以 c 后面补 3 字节；i 在偏移 4–7，d 在偏移 8–15。
    结构体的对齐值是 8，16 已经是 8 的倍数，末尾不用再补。13 字节是三个成员的大小之和，16 字节还包括填充。
- q: 本机测试中，未对齐的 4 字节读为什么没有明显变慢？
  a: |
    在这台 M4 上，本次测试的普通 4 字节读取由硬件处理，数据主要在 L1 缓存中。每组 6 轮取最快，平均开销都在 0.28–0.29 ns。
    这不代表其他情况下也一样：不同架构、跨页访问，以及有特殊对齐要求的指令，都可能出现不同结果。
- q: 本机的 struct B { char c; double d; int i; } 是 24 字节，怎样减少到 16 字节？
  a: |
    把顺序改成 double、int、char：d 在偏移 0–7，i 在 8–11，c 在 12，末尾补 3 字节，共 16 字节。
    填充从 11 字节减少到 3 字节。修改前要确认外部数据格式和其他模块没有依赖原来的布局。
- q: packed 之后 sizeof 从 8 变成 5，为什么仍需要小心？
  a: |
    length 位于偏移 1，地址不保证满足 int 的对齐要求。编译器访问它时可能需要额外指令。
    如果取 &p.length 并作为普通 int 指针传给别处，访问该指针可能出错；GCC 默认会警告。
    使用外部数据格式时，还要检查字段布局和字节序。
```

相关内容：[锁为什么慢](../lock-memory-barriers/) 介绍缓存行和伪共享；[CAS 是缓存一致性协议实现的吗](../cas-coherence-layers/) 介绍原子操作与缓存一致性的关系。
