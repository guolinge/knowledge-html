```js
function makeCounter() {
  let count = 0;
  return function inc() {
    count++;
    return count;
  };
}

const counter = makeCounter();   // 这里，makeCounter 已经返回
counter();                       // 1
counter();                       // 2
```

`makeCounter` 返回之后，它的栈帧按规矩要弹掉。可 `counter()` 每调一次，`count` 就涨一次 —— 那个变量没跟着帧一起消失。

这篇要说清的就是这件事在内存里怎么发生：==函数对象活了下来，它身上有一个指针，指向另一个同样活下来的环境对象；变量住在环境对象里，从来不在栈帧里。==

往下按五步走：

1. 先把用户空间摆开，看清栈和堆各在哪、谁管（§01）
2. 把六个容易混的词钉死：环境记录、`[[OuterEnv]]`、`[[Environment]]`、绑定、执行上下文、Context（§02）
3. 看一次普通调用，确认帧确实会消失（§03）
4. 跟着 `makeCounter` 走完「建立 → 返回 → 再调用」（§04、§05）
5. 两个 counter 为什么互不影响，以及它什么时候真能被回收（§06、§07）

文中的实测来自本机 `Node 24.19.0`（V8 `13.6.233.17`，macOS arm64）。关键几处给出了能自己跑一遍的命令。

## 01 · 先摆地址空间：左边是栈，右边是堆

一个跑 JS 的进程，用户空间里同时住着两套性质完全不同的内存：

- **栈**：每条线程一根，创建线程时由系统划好。调用函数压一帧，返回弹出来。没有谁给它做回收 —— 弹出就是没了，那块内存立刻可能被下一次调用复用。
- **堆**：V8 的托管内存，全进程一份。`new` 出来的对象、函数对象、字符串，还有这篇的主角「环境对象」，都在这里。它不归调用栈管，归 GC 管，而且 GC 会搬动它们。

```arch
svg: js-closure-space
caption: 左边是线程的栈，右边是进程的堆。中间那根箭头是整篇文章的内容 —— 栈帧里放的只是指向堆对象的引用。
frames:
  - id: user
    boundary: 0
    kind: contains
    label: 用户空间 · 一块虚拟地址空间
    detail: 这块地址空间由内核映射，进程里的代码都能访问（只读段除外）。内核空间不在本图里。
  - id: stacks
    boundary: 1
    parent: user
    kind: contains
    label: 线程栈 · 每条线程一根
    detail: 栈归线程，不归进程。主线程的栈在地址空间的高处；线程池那几根是 mmap 出来的另一块。
  - id: heap
    boundary: 2
    parent: user
    kind: contains
    label: V8 托管堆 · 全进程一份
    detail: 堆归进程，由 GC 统一分配、搬运和回收。新生代和老生代不是两个堆，是同一个堆里的两块区域。
bodies:
  mainstack:
    badge: 每线程一根
    rows:
      - { k: 方向, v: 向低地址长，栈顶在低处 }
      - { k: 一帧多大, v: 约 96 字节（§03 实测） }
      - { k: 额度, v: 系统 8176 KB；V8 自己只认 984 KB }
      - { k: 返回时, v: 帧弹出，内存交给下一次调用 }
    note: 没有 GC，也没有延迟回收 —— 弹出就是没了
  poolstack:
    badge: libuv · 4 条
    rows:
      - { k: 谁在用, v: 文件系统、加密、DNS 的阻塞调用 }
      - { k: 跑不跑 JS, v: 不跑；JS 在主线程和 worker 线程上 }
      - { k: 栈从哪来, v: mmap 划出来的，线程结束就收回 }
    note: 它们的存在只说明一件事：栈是按线程配的
  newspace:
    badge: 两个半区
    rows:
      - { k: 谁先落这, v: 新创建的对象，包括 Context 和函数对象 }
      - { k: 一次 GC, v: 把活着的搬到另一半，旧的整块丢掉 }
      - { k: 两次之后, v: 还活着的搬进老生代 }
    note: 搬运会改地址，所有指向它的引用都要跟着改
  oldspace:
    badge: 长期对象
    rows:
      - { k: 谁在这, v: 活过两次 GC 的对象：闭包函数、它的 Context、原型 }
      - { k: 回收方式, v: 标记 + 压缩（Mark-Compact） }
      - { k: 上限, v: 实测约 4.2 GB，和指针压缩的 4 GB 保留区同量级 }
    note: 闭包的环境通常活到这里 —— 它必须比创建它的调用活得久
parts:
  mainstack:
    label: 主线程栈
    sub: 每线程一根 · 向低地址长
    detail: 正在执行的那些帧全在这。函数返回，帧被弹出，那块内存没有任何人再认领。==变量本身没有被销毁，是承载它的那块内存不再属于这次调用。==
    facts: { 归属: 每条线程, 份数: 一根, 跟着谁走: 随线程, 回收: 弹栈，不经 GC }
  poolstack:
    label: 线程池的 4 根原生栈
    sub: 跑 C++，不跑 JS
    detail: libuv 默认开 4 条线程处理文件系统、加密和 DNS 这类阻塞调用。它们有自己的 C 栈，但不执行 JS，所以不会持有 JS 的帧。
    facts: { 归属: 每条池线程, 份数: 4 根, 跟着谁走: 随线程, 回收: 线程结束收回 }
  newspace:
    label: 新生代 new space
    sub: 分两个半区，GC 一次搬一遍
    detail: 新对象先落在这里。一次 minor GC 把活着的对象复制到另一个半区，原来那半整块丢弃。==复制就是清理==：没被复制的自动算垃圾。
    facts: { 归属: 全进程, 份数: 一块, 跟着谁走: 随进程, 回收: 复制式（Scavenger） }
  oldspace:
    label: 老生代 old space
    sub: 活过两次 GC 的对象
    detail: 闭包的函数对象、它的 Context、内建原型通常都活到了这里。这里的回收是标记 + 压缩，压缩同样会移动对象、改写引用。
    facts: { 归属: 全进程, 份数: 一块, 跟着谁走: 随进程, 回收: 标记 + 压缩 }
tours:
  - id: ownership
    label: 按归属看
    steps:
      - { at: [mainstack, poolstack], text: "左边这两根栈各自属于一条线程。==线程结束，栈就没了，进程里其他人一点感觉都没有。==" }
      - { at: [newspace, oldspace], text: "右边这两块是同一个堆。堆归进程，所有线程共享；GC 在两块之间搬对象。" }
      - { at: [mainstack, newspace], text: "交界处那条箭头：栈上一个槽里放的是==指向堆对象的引用==。栈自己活多久，不影响堆里的对象活多久。" }
  - id: lifetime
    label: 一个对象的两站
    steps:
      - { at: [newspace], text: "对象刚创建，落在新生代。Context 和函数对象也是这样开始的。" }
      - { at: [oldspace], text: "活过一次 minor GC 被搬走，活过第二次就进老生代。之后每次压缩都可能再挪一次。" }
```

四个能记住的量，本机实测：

| 量 | 值 | 怎么量 |
|---|---|---|
| 系统给主线程的栈 | 8176 KB（约 8 MB） | `ulimit -s` |
| V8 允许 JS 用的栈 | 984 KB | `node --v8-options \| grep stack-size` |
| V8 堆上限 | 4 496 293 888 字节（约 4.2 GB） | `v8.getHeapStatistics().heap_size_limit` |
| 一个 JS 栈帧 | 约 96 字节 | 见 §03 的递归实测 |

!!V8 只认 984 KB，远小于系统给的 8 MB。!! 所以递归太深时先撞上的是 V8 抛的 `RangeError`，不是操作系统的段错误 —— §03 的实测就是这个现象。

还有一件事要先说清：规范不管这些东西放在哪。ECMAScript 只规定「环境记录」是一种规范类型，并且明确写着 ==环境记录纯属规范机制，不必对应实现的任何具体产物==。所以下面所有的位置、对象形状和字节数都是 V8 的选择，不是 JS 语言的规矩。

## 02 · 六个词，先钉住再往下看

后面每一节都要用到这几个词，而它们经常被混着说。

```cards
cols: 2
items:
  - title: 环境记录 Environment Record
    desc: 规范里装「名字 → 绑定」的东西
    tag: 规范类型
    tone: blue
    body: |
      每次求值一个函数、一个块、一个 `catch` 子句，都会新建一个。它记的是**绑定**：名字 `count` 和它当前指向的值。

      规范说它是「纯属规范机制」，所以它不是你能 `console.log` 出来的对象。V8 里对应它的是下面的 Context。
  - title: "`[[OuterEnv]]`"
    desc: 每个环境记录都有的外层引用
    tag: 内部字段
    tone: violet
    body: |
      内层环境找不到某个名字，就去 `[[OuterEnv]]` 指的那个环境找，一直找到 `null`（全局环境的外层是 null）。

      查找走的是这条链，跟调用栈没有关系 —— 这一点是理解闭包的关键。
  - title: "`[[Environment]]`"
    desc: 函数对象身上的一个内部槽
    tag: 内部槽
    tone: violet
    body: |
      函数被**创建**的那一刻，把「我所在的环境」记在这里。规范原文：`[[Environment]]` 是 “The Environment Record that the function was closed over. Used as the outer environment when evaluating the code of the function.”

      这句就是闭包在规范里的定义。
  - title: 绑定 vs 值
    desc: 闭包捕获的是绑定，不是快照
    tag: 最容易记错
    tone: amber
    body: |
      `count` 的槽只有一个，`counter()` 每次读写同一个槽。所以三次调用看到 0 → 1 → 2，而不是各看各的副本。

      这也解释了为什么两个函数共享一个变量时，一个改完另一个立刻看得见。
  - title: 执行上下文 vs 栈帧
    desc: 一个是规范里的记录，一个是机器上的内存
    tag: 别混用
    tone: muted
    body: |
      规范用「执行上下文栈」描述「现在在跑哪段代码」，那是个抽象栈，你没法拿地址。

      实现里对应的是线程栈上真实的帧：返回地址、保存的寄存器、局部槽。讲内存时说的是后者，讲语义时说的是前者。
  - title: Context（V8 的实现）
    desc: 堆上的一个对象，槽位编译期定死
    tag: 实现
    tone: green
    body: |
      V8 给需要长期存在的变量建一个 Context 对象，形状像定长数组：头两个槽放 `scope_info`（变量名到槽位的映射）和 `previous`（外层），后面按顺序放变量。

      取 `count` 就是「当前 context 的第 3 个槽」，不是按名字查表。
```

三个世界说的是同一件事，只是名字不一样：

```compare
first: 规范里
head: [V8 里, 用什么能看到]
rows:
  - 环境记录 Environment Record: ["Context 对象", "堆快照里的 `system / Context`"]
  - "`[[Environment]]`": ["`JSFunction.context` 字段", "`%DebugPrint(fn)` 打出的 `context:` 一行"]
  - "`[[OuterEnv]]`": ["Context 的 `previous` 槽", "堆快照里的 `internal:previous` 边"]
  - 绑定: ["Context 里的一个槽", "堆快照里的 `context:变量名` 边（值是指针时才有）"]
```

## 03 · 一次普通调用：帧上来，又下去

先看清一次调用在线程栈上留下什么。下面这张是示意，真实的一帧里还有字节码偏移、函数对象、被调用者保存的寄存器，这里只留下与闭包有关的几样。

```memmap
title: 一次 JS 调用在栈上的样子（示意）
sub: 高地址在上，栈向低地址长
high: "调用者的帧所在"
low: "栈顶：下一次压栈在这"
segments:
  - { label: 调用者的帧, sub: "上一层的局部槽和返回地址", tone: muted, size: 1.2 }
  - { label: 返回地址, sub: "call 压进来的，ret 用它回去", tone: amber, size: 0.7, mark: "一帧的边界" }
  - { label: 保存的帧指针, sub: "指回上一帧，栈回溯靠它", tone: muted, size: 0.7, mark: "一帧的边界" }
  - { label: 形参与 this, sub: "被调用者从这里读参数", tone: blue, size: 0.9 }
  - { label: 局部槽, sub: "没被捕获的变量留在这一层", tone: green, size: 1.0, mark: "帧弹出就没" }
  - { label: 当前 context 指针, sub: "指向堆里的 Context，也常驻在一个专用寄存器", tone: violet, size: 1.0, mark: "指向堆" }
note: 一帧的边界由返回地址和帧指针定住。返回时整帧弹掉，里面的局部槽没人再认领。
```

拿一次最普通的调用走一遍：

```js
function add(a, b) {
  const result = a + b;
  return result;
}
const value = add(10, 20);
```

调用时压一帧，`a`、`b`、`result` 落在这帧的槽或寄存器里；`return` 之后帧被弹出，那 96 字节回到「可用」状态。`value` 能留下，是因为它已经被写进了调用者的槽。==变量本身没有被销毁，是承载它的那块内存不再属于这次调用了。==

帧在原生栈上，这件事可以直接量。把 V8 的栈额度翻倍，递归深度几乎正好翻倍：

| `--stack-size` | 递归到第几层抛 `RangeError` | 折算每层 |
|---|---|---|
| 492 KB | 5165 | 97.5 字节 |
| 984 KB（默认） | 10413 | 96.8 字节 |
| 1968 KB | 20909 | 96.4 字节 |

```bash
# 自己量：改 --stack-size，看深度跟着变
node --stack-size=984 -e 'let n=0; function f(){ n++; f(); } try { f(); } catch (e) { console.log(n, e.name); }'
```

额度翻倍、帧数翻倍，说明这些帧就是系统栈上的内存，不是 V8 另开的一块。而且先抛 `RangeError` 而不是崩溃，因为 V8 在碰到系统的栈边界之前就自己叫停了。

（C 那边的一帧怎么摆、`call` / `ret` 各做了什么，在 [函数调用时，栈上到底放了什么](../stack-call-return/) 里拆过一遍。JS 帧多了 context 和字节码相关的字段，弹栈行为一样。）

那变量到底住哪？三选一，由编译器的作用域分析决定：

```compare
first: 维度
head: [寄存器 / 栈槽, Context 的槽]
rows:
  - 谁能读: ["只有这次调用自己", "任何拿到这个 Context 的函数对象"]
  - 活多久: ["帧弹出就没了", "直到没有引用（§07）"]
  - 谁决定: ["编译器", "编译器：变量被内部函数用到，或遇到 `eval` / `with`"]
  - 怎么取: ["寄存器，或 `[帧指针 − 8]` 这类地址", "`[context + 固定偏移]`"]
```

普通局部变量走左列，被闭包用到的变量走右列。这个分配是**编译期**定下来的，不是运行时发现「咦有闭包」才搬家。

## 04 · 进入 makeCounter 时，Context 就已经建好了

很多人以为 Context 是在「创建闭包的那一刻」建的。V8 不是：==它在进入这个作用域时就建好==，因为编译期已经算出这个作用域里有变量会被内部函数用到。

V8 工程师 Vyacheslav Egorov 在拆 V8 闭包时写得更直白：Context 是在进入作用域时创建的，不是创建闭包时；一个作用域只要可能需要，就提前建好，**并且被这个作用域里创建的所有闭包共享**。

```arch
svg: js-closure-life
caption: 上半部分是「代码」和「栈」，下半部分是「堆」。四个箭头里，shared 是共用同一段代码，context 是函数记住创建它的环境，槽 counter 是外界找到这个函数的入口。
frames:
  - id: heap
    boundary: 0
    kind: contains
    label: V8 托管堆 · 函数对象和环境对象都在这
    detail: 这三个对象都住在堆里。栈上那个帧只放指针，不放 count 的值。
  - id: stack
    boundary: 1
    kind: contains
    label: 主线程栈 · 帧在返回时弹出
    detail: 切换下面的场景看帧的变化：调用中 → 返回之后 → 再调用。
bodies:
  stack:
    badge: 每线程一根
    rows:
      - { k: 此刻的帧, v: "makeCounter：局部槽 + context → E1", when: during }
      - { k: 此刻的帧, v: "顶层代码：makeCounter 的帧已经不在了", when: returned }
      - { k: 此刻的帧, v: "inc：形参 / 局部 / context → E1", when: call }
      - { k: 顶层帧的槽, v: "counter → JSFunction inc" }
      - { k: 返回时, v: "帧弹出，96 字节交给下一次调用" }
    notes:
      - { when: during, text: "帧活着，但它不是 count 的家：帧里只有指向 E1 的指针" }
      - { when: returned, text: "栈上找不到 makeCounter 的任何痕迹" }
      - { when: call, text: "新帧、旧 Context：count 加完写回 E1" }
  incfn:
    badge: 64 字节 · 堆上
    rows:
      - { k: shared, v: "→ 同一段字节码和槽位表", link: sfi }
      - { k: context, v: "→ 创建它时的环境", link: ctx1 }
      - { k: code, v: "没优化时只指向解释器入口" }
    note: 闭包的一半。它自己不含任何变量的值
  sfi:
    badge: 只有一份
    rows:
      - { k: 字节码, v: "所有 inc 共用这一段" }
      - { k: 槽位表, v: "count 在第 3 个槽：编译期定好" }
      - { k: 谁指向它, v: "每个函数对象的 shared" }
    note: 代码不复制，每次调用复制的是环境
  ctx1:
    badge: 每次调用一个
    rows:
      - { k: scope_info, v: "变量名 → 槽位的映射" }
      - { k: previous, v: "外层环境", link: outer }
      - { k: count, v: "0（刚初始化）", when: during }
      - { k: count, v: "0（没动过）", when: returned }
      - { k: count, v: "1（这次调用写完）", when: call }
    note: 同一个 Context，几次调用之间地址不变
  outer:
    badge: 外层
    rows:
      - { k: 是谁, v: "脚本 / 模块作用域" }
      - { k: previous, v: "再往外就是 NativeContext" }
    note: 查找只走 [[OuterEnv]] 这条链，跟栈无关
parts:
  stack:
    label: 主线程栈
    sub: 帧活一时，环境活很久
    detail: 帧里存的是**指针**，不是变量的副本。所以帧弹出不影响 E1 里的值，也不影响函数对象指向它。
  incfn:
    label: JSFunction inc
    sub: 闭包的另一半：函数对象
    detail: "堆里的一个 64 字节对象（`%DebugPrint` 打出 `instance size: 64`）。它记着自己是谁（`shared`）和出生在哪个环境（`context`），但不含变量本身。"
  sfi:
    label: SharedFunctionInfo inc
    sub: 代码和槽位表，一份
    detail: 同一条源码位置产生的所有函数对象共用一个 SharedFunctionInfo（下面简称 SFI）。这就是「闭包复制环境不复制代码」的落地方式。
  ctx1:
    label: Context E1
    sub: makeCounter 的作用域
    detail: 头两个槽固定是 `scope_info` 和 `previous`，后面按顺序放变量。`count` 占一个槽，`FunctionContext[3]` 里的 3 就是这个槽位数。
  outer:
    label: 外层 Context
    sub: 脚本 / 模块作用域
    detail: E1 的 `previous` 指向它。查找一路往外，直到 NativeContext（`globalThis` 和所有内建就挂在那里）。
scenarios:
  - id: during
    label: 调用中
    note: makeCounter 正在跑：E1 刚建好，count = 0
  - id: returned
    label: 返回之后
    note: 帧已经弹掉，堆里剩下函数对象和 E1
  - id: call
    label: 调用 counter()
    note: 新帧拿旧的 E1 当环境，count 写回同一个槽
tours:
  - id: birth
    label: 建起来
    steps:
      - { at: [stack, ctx1], text: "进入 makeCounter：先建 Context，再让帧记住它。==这时候 inc 还没创建，E1 就已经存在了。==" }
      - { at: [ctx1], text: "count 被放进 E1 的第 3 个槽。槽位号在编译期定死，取用是固定偏移，不是按名字查表。" }
      - { at: [incfn, sfi, ctx1], text: "创建 inc：函数对象的 context 指向 E1，shared 指向那份唯一的字节码。==闭包的两半在这里合起来。==" }
  - id: after
    label: 返回之后
    steps:
      - { at: [stack], text: "切到「返回之后」：makeCounter 的帧弹掉了，栈上找不到 count。" }
      - { at: [incfn, ctx1], text: "但顶层槽 counter 指向 inc，inc 指向 E1，E1 里装着 count。==这一整条链没有一环在栈上==。" }
  - id: run
    label: 再调一次
    steps:
      - { at: [stack, ctx1], text: "切到「调用 counter()」：新压一帧，它的 context 从 inc.context 来 —— 还是 E1。" }
      - { at: [ctx1], text: "count 加一，写回同一个槽。帧弹掉，值留着；下一次读到的就是它。" }
```

用 `%DebugPrint` 能看到函数对象身上那个指针：

```bash
node --allow-natives-syntax -e '
function makeCounter() {
  let count = 0;
  return function inc() { count++; return count; };
}
const counter = makeCounter();
%DebugPrint(counter);
counter(); counter();
%DebugPrint(counter);'
```

只留关键三行，两次打印是这样的：

```text
DebugPrint: 0x04ea55a63991: [Function]
 - shared_info: 0x27ac57ea3601 <SharedFunctionInfo inc>
 - context:     0x04ea55a63969 <FunctionContext[3]>
...
DebugPrint: 0x04ea55a63991: [Function]        ← 同一个函数对象
 - shared_info: 0x27ac57ea3601 <SharedFunctionInfo inc>
 - context:     0x04ea55a63969 <FunctionContext[3]>   ← 同一个 Context
```

两件事：中间调用了两次 `counter()`，`context` 的地址一个字节都没变；`FunctionContext[3]` 里的 3 是槽位数 —— `scope_info`、`previous`、`count` 各占一个。

## 05 · 返回之后：栈没了，堆还在

`makeCounter` 返回时，它的帧照常弹掉。`counter` 这个顶层槽指向 `inc` 函数对象，`inc` 的 `context` 指向 E1，E1 里装着 `count`。这条链上没有任何一环在栈上 —— 所以帧弹掉不影响它。

再调用 `counter()` 时：

1. 新压一帧，给 `inc` 用
2. 这帧的「当前环境」从函数对象的 `context` 来。规范里就一步：`NewFunctionEnvironment` 把新环境的 `[[OuterEnv]]` 设成 `func.[[Environment]]`
3. 代码里读 `count`：先看本次调用的环境里有没有，没有就顺着 `[[OuterEnv]]` 往外走，在 E1 里命中
4. 写回的是 E1 的那个槽。帧弹掉，槽里的值留着

```flow
grid: true
nodes:
  - { id: frame, label: "inc 的这次调用", sub: "形参 / 局部里没有 count", row: 0, kind: backend }
  - { id: e1, label: "E1：makeCounter 的环境", sub: "count 在第 3 个槽 → 命中", row: 1, kind: database }
  - { id: outer, label: "外层环境", sub: "脚本 / 模块作用域，这次不会走到", row: 2, kind: database }
  - { id: native, label: "NativeContext", sub: "globalThis 与内建，[[OuterEnv]] 链的尽头", row: 3, kind: database }
edges:
  - { from: frame, to: e1, label: "没找到，往外一层" }
  - { from: e1, to: outer, label: "命中就停在这", dashed: true }
  - { from: outer, to: native, label: "再往外", dashed: true }
```

这张图讲的是规范里的查找：一层一层找名字，在 E1 命中。V8 在编译期就把这件事结算了 —— ==变量被解析成「第几层 context + 第几个槽」，运行时按层数沿 `previous` 走指针，再取固定偏移==，`scope_info` 就是那张表。按名字查找的动作不存在了，但沿链跳过几层指针仍然要做。

还有一个细节：V8 按需分配 Context。`inc` 的作用域里没有被任何内部函数捕获的变量，所以它没有属于自己的 Context —— 调用时帧直接拿 `inc` 的 context（也就是 E1）当环境。堆快照能证实这一点 —— `inc` 的 `context` 指向的，正是装着 `makeCounter` 那些变量的对象：

```text
#7181 closure "inc" size=64
   --internal:shared-->   #97819  "inc"（SharedFunctionInfo）   72 字节
   --internal:context-->  #103261 "system / Context"           48 字节
  └─ Context #103261
       --context:payload-->      #103263 "Object"       ← 被捕获的那个对象
       --internal:scope_info-->  #97825  "system / ScopeInfo"
       --internal:previous-->    #7063   "system / NativeContext"
```

`count` 不在这几条边里，因为它是小整数（Smi），值直接存在槽里，不是指针。堆快照的边只画指针。

```bash
# 自己看：生成堆快照，在 Chrome DevTools 的 Memory 面板里打开
node -e 'const v8 = require("node:v8");
function makeCounter() { let count = 0; return function inc() { count++; return count; }; }
const counter = makeCounter(); counter(); counter();
v8.writeHeapSnapshot("closure.heapsnapshot");'
```

## 06 · 两个 counter：一份代码，两份环境

每调一次 `makeCounter`，就新建一个 Context；`inc` 的函数对象也是新的。但两个函数对象共用同一份 SharedFunctionInfo —— 代码和槽位表只有一份，`count` 的槽位号也一样（都是第 3 个槽），只是两个 Context 各是各的。

```arch
svg: js-two-counters
caption: 上面是共用的一份代码，下面两列是各自的环境。同一个槽位号，两个不同的对象 —— 这就是两个计数器互不影响的原因。
bodies:
  sfi:
    badge: 一份
    rows:
      - { k: 字节码, v: "两个 inc 跑的是同一段指令" }
      - { k: 槽位表, v: "count → 第 3 个槽，两边一样" }
    note: 不一样的是槽里的内容，不是槽的位置
  inc1:
    badge: 64 字节
    rows:
      - { k: shared, v: "→ SFI（同一份）", link: sfi }
      - { k: context, v: "→ E1（自己这次调用的）", link: ctx1 }
    note: counter1 是外界对它的唯一引用
  inc2:
    badge: 64 字节
    rows:
      - { k: shared, v: "→ SFI（同一份）", link: sfi }
      - { k: context, v: "→ E2（自己这次调用的）", link: ctx2 }
    note: 和 inc1 是同一段代码生出来的两个对象
  ctx1:
    badge: 第一次调用
    rows:
      - { k: count, v: "2（counter1 调了两次）" }
      - { k: payload, v: "那次调用里创建的其它对象" }
    note: E1 与 E2 是两个对象，地址不同
  ctx2:
    badge: 第二次调用
    rows:
      - { k: count, v: "1（counter2 只调了一次）" }
      - { k: payload, v: "另一次调用里创建的另一份" }
    note: 改 E2 的槽，E1 一点感觉都没有
parts:
  sfi:
    label: SharedFunctionInfo
    sub: 代码和槽位表
    detail: 同一条源码位置产生的所有函数对象共用一个 SFI。==代码不复制，复制的是环境==。
    facts: { 归属: 全进程共用, 份数: 一份, 谁指向它: 两个函数对象, 内容: 字节码 + 槽位表 }
  inc1:
    label: 第一个 JSFunction
    sub: counter1 指向它
    detail: 创建于第一次 `makeCounter()`。它自己的 `context` 指向 E1。
    facts: { 归属: 第一次调用, 份数: 一个对象, context: E1, count 存在哪: E1 的第 3 个槽 }
  inc2:
    label: 第二个 JSFunction
    sub: counter2 指向它
    detail: 创建于第二次 `makeCounter()`。它和 inc1 共享代码，但不共享环境。
    facts: { 归属: 第二次调用, 份数: 一个对象, context: E2, count 存在哪: E2 的第 3 个槽 }
  ctx1:
    label: Context E1
    sub: 第一次调用的环境
    detail: "`count` 在这里，值 2。只要 counter1 还被引用，E1 就不会被回收。"
    facts: { 归属: 第一次调用, 份数: 一个对象, count: 2, 和 E2 的关系: 互不相干 }
  ctx2:
    label: Context E2
    sub: 第二次调用的环境
    detail: 形状和 E1 一模一样，槽位号也一样，但它是另一个对象。
    facts: { 归属: 第二次调用, 份数: 一个对象, count: 1, 和 E1 的关系: 互不相干 }
tours:
  - id: share
    label: 哪些共用、哪些各一份
    steps:
      - { at: [sfi], text: "代码和槽位表只有一份。两个函数对象的 `shared` 都指着它。" }
      - { at: [inc1, inc2], text: "但函数对象是两个 —— 创建两次就是两个堆对象，各有自己的 `context`。" }
      - { at: [ctx1, ctx2], text: "环境也是两个。同一个槽位号，各自一份 `count`。==互不影响靠的是这个「各自一份」==。" }
```

实测的地址关系（同一次运行里取）：

```compare
first: 对象
head: [counter1, counter2]
rows:
  - JSFunction 地址: ["`0x…68b1`", "`0x…6919`（不同）"]
  - SharedFunctionInfo: [{ text: "同一份", tone: green }, { text: "同一份", tone: green }]
  - Context 地址: ["`0x…6889`", "`0x…68f1`（不同）"]
  - count: ["2", "1"]
```

「闭包 = 函数 + 环境」这句话，在这里落成两个堆对象：一个 64 字节的 `JSFunction`，一个装着变量的 Context。代码和槽位表挂在 SFI 上，被所有同字面量的闭包共享。所以「复制环境不复制代码」不是一句比喻，是三个对象之间的关系。

## 07 · 什么时候能回收：看可达性，不看 return

`makeCounter` 返回不释放任何东西，`counter = null` 也不「释放」—— 它只是把最后一个引用拿掉。真正决定命运的是下一次 GC 的标记：从 roots 出发还能不能走到这个对象。能走到就活，走不到就清。

roots 是几处起点：栈上的槽、`globalThis` / NativeContext 里的引用，以及 C++ 侧（编译器、优化器）握着的句柄。V8 描述年轻代回收时说的也是这几个词：==栈和全局==。

```compare
first: 那一刻
head: [还活着的东西, 下一轮 GC 会做什么]
rows:
  - "`counter` 还指向 `inc`": ["函数对象、E1、E1 里指向的对象都还在链上", "一个都不动"]
  - "`counter = null`": ["链从根上断开；函数对象、E1、被捕获的对象都不可达", "标记走不到它们，清扫时回收"]
  - "还有第二个闭包指向同一个 E1": [{ text: "E1 仍然可达，被回收的只是那个函数对象", tone: amber }, "只回收走不到的那部分"]
```

实测保留量（`node --expose-gc`；每个数字都是 `global.gc()` 跑两次之后读 `process.memoryUsage().heapUsed`）：

```js
// ① 数组只是局部变量，没有任何内部函数用到它
function makeA() {
  const big = new Array(2_000_000).fill(1);
  const small = { text: 'kept' };
  return function useSmall() { return small.text; };   // 不碰 big
}

// ② 同一作用域里两个闭包，一个用 small，一个用 big；只留第一个
function makeB() {
  const big = new Array(2_000_000).fill(1);
  const small = { text: 'kept' };
  return {
    useSmall() { return small.text; },
    useBig() { return big.length; },
  };
}

// ③ 直接捕获 big
function makeC() {
  const big = new Array(2_000_000).fill(1);
  return function useBig() { return big.length; };
}

let pair = makeB();
let onlySmall = pair.useSmall;
pair = null;                    // 放掉 useBig，只留 useSmall
const keepBig = makeC();        // 对照组：环境里只有一个被捕获的大数组
```

| 场景 | `heapUsed` | 那些内存在哪 |
|---|---|---|
| 基线 | 3.4 MB | 只有运行时自己的东西 |
| ① 闭包还活着，`big` 没被捕获 | 3.7 MB | `big` 从来没进过 Context，函数一返回就没主了 |
| ② 只留 `useSmall`，`big` 被同一作用域的另一个闭包用到 | 19.0 MB | `big` 在共用的 Context 里，`useSmall` 间接替它续了命 |
| ③ 直接留一个捕获 `big` 的闭包 | 19.0 MB | `big` 在 Context 里，闭包可达它就可达 |
| 全部置空 | 3.7 MB | 链断了，下一轮 GC 清掉 |

②这一行是 19 MB，哪怕 `useBig` 已经被丢掉了。原因在下一节。

## 08 · 「只保留用到的变量」只对了一半

常见的说法是「引擎只保留闭包真正用到的变量」。方向对，粒度错了：==V8 保留的单位是作用域，不是单个变量。==

一个作用域里，只要**有任何一个**内部函数用到了某个变量，这个变量就得进 Context；而同一个作用域产生的所有闭包共享**同一个** Context。所以只留下 `useSmall` 时，那个 Context 里 `big` 的槽还在，`big` 就跟着活着。

堆快照里能直接看到：

```text
closure "useSmall"
   --internal:context-->  Context #103219
Context #103219
   --context:big-->    Array     ← useBig 已经没人引用了，数组还在这
   --context:small-->  Object
   --internal:previous-->  ...
```

另一次快照里，同一个 Context 被两个函数对象同时指着（`useSmall` 和 `useBig` 的 `context` 是同一个地址）。这也解释了 §04 那句「被这个作用域里创建的所有闭包共享」。

```compare
first: 说法
head: [对不对, 依据]
rows:
  - 引擎只保留「这个闭包用到的」变量: [{ text: "❌ 粒度错了", tone: red }, "保留单位是作用域：同作用域里被任一内部函数用到的变量都留着"]
  - 引擎只保留「必须长期存在的」绑定: [{ text: "✅ 基本对", tone: green }, "没被任何内部函数用到、也没遇到 eval / with 的局部变量，仍然留在栈槽或寄存器里（① 的 3.7 MB）"]
  - 闭包会把整个栈帧保存下来: [{ text: "❌ 不对", tone: red }, "栈帧照常销毁，活下来的是另建的 Context；帧里只有指针"]
```

三种情况会强制把变量放进 Context，即使它看起来没被闭包用到：直接调用 `eval`、`with` 语句、非严格函数里引用 `arguments`。它们都会让编译器无法确定「谁可能访问这个名字」。

反过来，想让一个大对象早点走，能做的不是「让闭包少用一点」，而是==把它放进另一个作用域==：不同作用域的变量进不同的 Context，丢掉那个作用域的闭包就能放掉它；同一个作用域里的，只能一起留着。

## 09 · 三句话收尾

```compare
first: 常见说法
head: [实际发生的事]
rows:
  - 闭包把变量的值复制进了函数: ["复制的是引用：函数指向环境，环境里的槽只有一份，所以多次调用能累加"]
  - 闭包延长了栈帧的寿命: ["栈帧照常销毁。活下来的是另一个堆对象（Context），帧里只有指向它的指针"]
  - 函数返回后内存就该回收: ["回收看可达性。没有引用之后，还要等 GC 真正跑到那一轮"]
  - "`counter = null` 立刻释放内存": ["只是断开了最后一个引用；释放发生在下一轮 GC 的清扫"]
```

```summary
title: 一句话总结
text: |
  进入作用域时，V8 把会被内部函数用到的变量搬进堆上的 Context；函数对象记住这个 Context。
  ==栈帧照常销毁，环境留在堆上，所以函数返回后还能读写那些变量。==
```

```quiz
- q: makeCounter 返回之后，count 住在哪里？谁指向它？
  a: |
    住在堆上的 Context（V8 里是 FunctionContext）的一个槽里，不在栈帧里。
    指向它的有两处：函数对象 inc 的 context 字段，以及 Context 自己的 previous 指向外层。
    外界的入口是顶层槽 counter → 函数对象 → context。
- q: 为什么只留下 useSmall，另一个闭包用过的 200 万元素数组还在？
  a: |
    V8 按作用域分配 Context：两个闭包来自同一次 makeB 调用，共用同一个 Context。
    只留 useSmall 时 Context 仍然可达，里面 big 那个槽也还在，所以数组不会被回收。
- q: 规范里的「查找变量」和 V8 运行时的「读变量」，差在哪？
  a: |
    规范是一层层找名字：当前环境找不到，就沿 [[OuterEnv]] 往外，直到命中或到 null。
    V8 在编译期就把变量解析成「哪一层 context + 第几个槽」，运行时是一条固定偏移的读取；
    本例里 inc 的作用域不需要自己的 Context，所以直接读 E1 的第 3 个槽。
```
