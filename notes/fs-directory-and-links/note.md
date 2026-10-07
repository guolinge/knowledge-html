```arch
svg: fs-name-to-inode
caption: 三条带从上到下是三层：==名字表 → inode → inode 指向的东西==。硬链接和软链接的区别，就是中间那条边怎么走。
parts:
  n1:
    label: a.txt
    detail: 目录里的一项，内容是「`a.txt` → inode 100」。==名字不是文件的一部分==，只是目录这张表里的一个条目。
  n2:
    label: b.txt · 硬链接
    detail: '`ln` 出来的。它的目录项写着**同一个 inode 号**。==所以两个名字完全平等== —— 没有谁是原件、谁是副本。'
  n3:
    label: link · 软链接
    detail: '`ln -s` 出来的。它指向**另一个 inode** —— 这是它和硬链接唯一的、也是全部的区别。'
  i100:
    label: inode 100
    detail: 引用计数 = 2，因为有两个名字指着它。==删掉一个名字，计数减一；减到 0 才真的释放数据块。==
  i205:
    label: inode 205
    detail: '==软链接自己就是一个文件==，有自己的 inode。这也是为什么它可以跨文件系统、也可以指向目录 —— 它压根不关心目标在哪。'
  path:
    label: 一段路径字符串
    detail: 软链接的 inode 里存的不是数据，是一段路径。==所以每次打开都要多解析一次==，而且目标不在时它照样存在（变成悬空链接）。
anchors:
  - { part: i100, label: "硬链接和软链接差在哪" }
  - { part: n2, label: "我从硬链接看" }
  - { part: n3, label: "我从软链接看" }
tours:
  - id: two-links
    label: "硬链接和软链接，差在哪一条边"
    steps:
      - { at: [n1, n2, i100], text: "硬链接做的是：让**另一个目录项写上同一个 inode 号**。\n\n==所以两个名字完全平等==，改任何一个，另一个看到的都一样。引用计数记着现在有几个名字。" }
      - { at: [n3, i205], text: "软链接做的是另一件事：==它新建一个文件==（有自己的 inode），而不是给原文件加名字。" }
      - { at: [i205, path], text: "这个新文件的内容是一段**路径字符串**。打开它的时候，内核读出来是路径，再解析一遍。" }
      - { at: [n1, n2, n3, path], text: "两条路线的后果完全不同：\n\n**硬链接**不能跨文件系统、不能指向目录（因为 inode 号只在文件系统内有意义，而且指向目录会造出环）。\n\n**软链接**两个都行 —— 它只是个记着路径的文件，不关心目标在哪，目标没了它也不会消失。" }
```

---

## 01 · 目录也是文件

在 Linux 里敲 `vim .`，你会发现目录真的能被打开、能看到内容。这不是什么特殊待遇：

==目录就是一个文件。== 它有自己的 inode，inode 里也指向一些数据块。

和普通文件的区别只在**数据块里装的是什么**：

```compare
first: 文件类型
head: [inode 里有什么, 数据块里装的是什么]
rows:
  - 普通文件: ["大小、权限、时间、数据块位置", "文件真正的内容，也就是字节流"]
  - 目录文件: ["也一样，它并不特殊", { text: "一张「名字 → inode 号」的对照表", tone: violet }]
```

所以「按路径找文件」这件事，本质上是**一路查表**：

```journey
- tag: ①
  tone: muted
  name: 从根目录开始
  badge: inode 2
  fields:
    - { k: 已知, v: "根目录的 inode 是固定的" }
    - { k: 要查, v: "home" }
  note: 读根目录的数据块，在里面找名字叫 home 的那一项
  next: "查到 home 的 inode 号 :: :: 进去继续查"
- tag: ②
  tone: blue
  name: /home 目录
  badge: 找到 xiaolin
  fields:
    - { k: 读到, v: "home → inode 300" }
    - { k: 要查, v: "xiaolin" }
  note: 读 inode 300 指向的数据块，再找名字叫 xiaolin 的那一项
  next: "又一个 inode 号 :: :: 再下一层"
- tag: ③
  tone: violet
  name: 终于到文件本身
  badge: 拿到 inode
  fields:
    - { k: 读到, v: "notes.md → inode 100" }
    - { k: 到手, v: "inode 100", note: 元信息全在这, tone: ok }
  note: 到这里路径才解析完，接下来才是真正读文件内容
```

==每经过一层目录，就是一次「读目录的数据块 + 查表」==。路径越长，这个链就越长。这也是为什么深目录下的文件打开会慢一点。

### 查表用列表还是哈希表

最朴素的存法是**列表**：一项一项往下排。

```text
inode  长度  名字
  100    12  .
  200    10  ..
  300     8  notes.md
  412    14  README.md
```

头两项永远是 `.`（当前目录）和 `..`（上一级目录），后面才是真正的文件。

```compare
first: 存法
head: [怎么找, 好在哪, 差在哪]
rows:
  - 列表: ["从第一项开始一项项比名字", "结构简单，加一项就往后面追加", { text: "目录里文件一多，查找就是线性扫描", tone: red }]
  - 哈希表: ["对文件名算哈希，直接跳到对应的桶", { text: "查找、插入、删除都快", tone: green }, "要额外处理哈希冲突"]
```

Linux 的 Ext 系列用的是**哈希表**版本的目录。一个目录下有几十万个文件时，列表法每找一次都是灾难，而哈希表还是常数级。

哈希冲突这件事不算难处理，但它是真实存在的：==哈希相同不代表名字相同，还得把名字再比一遍。==

### 目录项缓存

路径解析每层都要读磁盘，太贵了。所以内核会把读过的目录留在内存里，这个内存结构叫**目录项**（dentry）。

!!记住一个区别：**目录**是文件，在磁盘上；**目录项**是内核的数据结构，只在内存里。!!

它俩名字像，但不是一回事：

| | 目录 | 目录项 |
|---|---|---|
| 是什么 | 一种文件 | 内核的一个数据结构 |
| 在哪 | 磁盘上（有 inode、有数据块） | 只在内存里 |
| 内容 | 「名字 → inode 号」的完整对照表 | 一条「名字 → inode」的解析结果 |
| 作用 | 持久保存目录结构 | 让下一次路径解析不用再读磁盘 |

一个目录项也可以指向普通文件，不只是目录。而且多个目录项可以指向同一个 inode，这就是下面要说的硬链接。

---

## 02 · 硬链接：多写几个名字

既然目录里存的是「名字 → inode 号」，那让两个不同的名字写同一个 inode 号，会怎样？

```flow
grid: true
groups:
  - { id: dirs, label: "三个不同的路径，指向同一个文件", tone: muted }
nodes:
  - { id: h1, label: "/home/xiaolin/file", sub: "原本的名字", row: 0, tone: blue, group: dirs }
  - { id: h2, label: "/home/jay/hardlink1", sub: "硬链接", row: 0, tone: blue, group: dirs }
  - { id: h3, label: "/tmp/hardlink2", sub: "硬链接", row: 0, tone: blue, group: dirs }
  - { id: i100, label: "inode 100", sub: "引用计数 = 3", row: 1, tone: violet }
  - { id: data, label: "数据块", sub: "从头到尾只有一份", row: 2, tone: blue }
edges:
  - { from: h1, to: i100 }
  - { from: h2, to: i100 }
  - { from: h3, to: i100 }
  - { from: i100, to: data, label: "块地址" }
```

Linux 里的命令是 `ln 原文件 新名字`。

==三个名字完全平等。== 没有哪个是「原件」、哪个是「副本」，它们只是同一份文件在三个目录里的三个入口。改任何一个，另外两个看到的都一样。

### 硬链接的两条硬限制

```checklist
tone: cross
items:
  - 不能跨文件系统：inode 号只在同一个文件系统里有意义，另一个文件系统里的 100 号是另一个文件
  - 不能指向目录：这会让目录结构出现环，路径解析会绕不出去
```

第一条的根因就是 inode 号是**文件系统内部**的编号。跨了文件系统，同一个数字代表完全不同的东西。

---

## 03 · 软链接：另起一个新文件

软链接（`ln -s`）走的完全是另一条路：**它不是给文件加名字，而是新建一个文件。**

```flow
grid: true
groups:
  - { id: dirs, label: "目录里能看到两个名字，但它们根本不是同一个文件", tone: muted }
nodes:
  - { id: real, label: "/home/xiaolin/file", sub: "真正的文件", row: 0, tone: blue, group: dirs }
  - { id: sym,  label: "/tmp/symlink1", sub: "软链接", row: 0, tone: amber, group: dirs }
  - { id: i100, label: "inode 100", sub: "引用计数 1", row: 1, tone: violet }
  - { id: i200, label: "inode 200", sub: "软链接自己的 inode", row: 1, tone: amber }
  - { id: d2,   label: "软链接的数据块", sub: "内容是字符串 /home/xiaolin/file", row: 2, tone: amber }
edges:
  - { from: real, to: i100 }
  - { from: sym,  to: i200 }
  - { from: i200, to: d2, label: "也有自己的数据块" }
  - { from: i200, to: i100, label: "内容是路径", dashed: true }
```

软链接自己有 inode、有自己的数据块，==只不过那个数据块里存的是一个路径字符串。==

所以你访问 `/tmp/symlink1` 时，内核读到「哦，内容是 `/home/xiaolin/file`」，然后**重新做一次完整的路径解析**，才找到真正的文件。多了一次跳转。

### 两条限制反过来了

```compare
first: 特性
head: [硬链接, 软链接]
rows:
  - 有自己的 inode 吗: [{ text: 没有，共用目标文件的, tone: muted }, { text: 有，独立的, tone: green }]
  - 能跨文件系统吗: [{ text: 不能, tone: red }, { text: 能, tone: green }]
  - 能指向目录吗: [{ text: 不能, tone: red }, { text: 能, tone: green }]
  - 目标删了会怎样: [{ text: "文件还在（还有别的名字指过来）", tone: green }, { text: "链接还在，但变成悬空链接", tone: amber }]
  - 相对路径怎么算: ["不影响，同一个 inode 没有路径问题", "**相对目标文件的路径**算，不是相对当前目录"]
```

最后一行是软链接最容易踩的坑：`ln -s` 里写的相对路径，是**站在链接所在目录**去看的。

---

## 04 · 删掉一个文件，到底删了什么

这是把上面所有东西串起来的地方。动手删几个试试：

```demo
widget: link-refcount
title: 点「删除」，看引用计数怎么动
actions: false
hint: 三个名字随便删
config:
  inode: 100
  blocks: "5 / 9 / 12"
  names:
    - { path: "/home/xiaolin/file", dir: "原来的名字", kind: origin }
    - { path: "/home/jay/hardlink1", dir: "硬链接 1", kind: hard }
    - { path: "/tmp/hardlink2", dir: "硬链接 2", kind: hard }
  symlink:
    path: "/tmp/symlink1"
    dir: "软链接"
    inode: 200
    target: "/home/xiaolin/file"
```

从上面能看出三件事：

```cards
cols: 1
items:
  - title: 删一个名字，只是删了目录里的那一行
    tone: blue
    body: |
      `rm /home/jay/hardlink1` 做的事，就是在 `/home/jay` 这个目录的数据块里，
      把 `hardlink1` 那一项抹掉，然后把 inode 100 的引用计数减 1。

      ==数据块一个字节都没动。== 所以删硬链接是极快的操作，跟文件大小无关。
  - title: 引用计数归零，才是真的删
    tone: green
    body: |
      三个名字全删光，计数降到 0，内核这时候才：

      1. 释放数据块（在数据位图里把对应位清 0）
      2. 释放 inode（在 inode 位图里清 0）
      3. 目录里那一行早就不在了

      这就是为什么「删除一个 10GB 的文件」在 Linux 上是瞬间完成的。
      它并没有去擦数据，只是把记账改了一下。
  - title: 软链接是另一条命
    tone: amber
    body: |
      删软链接删的是它**自己的** inode 200 和数据块，目标文件完全不受影响。

      反过来也成立：把目标文件删光了，软链接还在。你去访问它，内核照着那个路径字符串找过去，
      发现什么都没有，返回「没有那个文件」，这叫==悬空链接==。

      ```console
      $ ln -s /nonexistent /tmp/dangling
      $ cat /tmp/dangling
      cat: /tmp/dangling: No such file or directory
      ```
```

---

```quiz
- q: 目录和目录项是同一个东西吗？
  a: |
    不是。目录是一种文件，有自己的 inode 和数据块，持久存在磁盘上。
    目录项（dentry）是内核在内存里维护的一个数据结构，记录「某个名字解析到了哪个 inode」，
    目的是让下次路径解析不用再读磁盘。名字像，但一个在磁盘、一个只在内存。
- q: 硬链接为什么不能跨文件系统，软链接可以？
  a: |
    硬链接的本质是「两个目录项写同一个 inode 号」。而 inode 号是文件系统内部的编号，
    换个文件系统，同一个数字指的是完全不同的 inode，所以跨不过去。
    软链接存的是一个路径字符串，访问时重新做一次路径解析，
    路径本身可以跨越挂载点，所以能跨文件系统。
- q: rm 一个 10GB 的文件为什么是瞬间完成的？
  a: |
    因为删除只是改记账。rm 做的事是把目录里那一行去掉、把 inode 的引用计数减 1；
    只有计数降到 0 时，内核才在数据位图和 inode 位图里把对应的位清掉。
    整个过程跟文件有多少数据块基本无关，擦数据这件事根本不会发生。
- q: 一个文件的硬链接有 3 个，删掉其中 2 个之后，文件内容还在吗？
  a: |
    在。硬链接之间完全平等，没有「原件」和「副本」之分。
    只要引用计数还没到 0，inode 和数据块就一直有效，
    剩下那一个名字照常能读能写，读到的内容也是完整的。
```
