## 01 · 为什么要多一层

文件系统的种类太多了。磁盘上有 Ext2/3/4、XFS、Btrfs，内存里有 `/proc`、`/sys`，网络上有 NFS、SMB。

如果每个程序都要认识这些格式，写一个读文件的代码就得写十份。所以操作系统在中间塞了一层：

```
应用程序
   ↓  只认这一套接口
虚拟文件系统（VFS）
   ↓  向下适配
Ext4    XFS    NFS    /proc    ...
```

==VFS 定义了一组所有文件系统都要支持的数据结构和标准接口。== 程序员只要学会这一套，底下换成什么文件系统都不用改代码。

这一层带来的好处是直接的：`open("/mnt/nfs/data.csv")` 和 `open("/tmp/data.csv")` 在写代码的人看来没有任何区别，虽然前者的数据要从网络另一头拿。**差异被 VFS 吃掉了。**

---

## 02 · 一次 write 要穿过几层

从你的代码到磁盘，中间隔着这么几层：

```lane-stack
- badge: 用户空间
  title: 你的程序
  desc: 调的是库函数
  tone: blue
  group: 用户空间
  nodes:
    - { title: 应用程序, sub: "write(fd, buf, n)" }
    - { title: 库函数, sub: "标准库可能先攒一攒", tag: 缓冲 }
  next: "陷入内核 :: syscall :: 从这里开始，CPU 切到内核态"
- badge: 内核空间
  title: 系统调用
  desc: 统一入口
  tone: violet
  group: 内核
  nodes:
    - { title: sys_write, sub: "检查参数、找到 fd 对应的文件" }
  next: "往下交给 VFS :: :: 它负责屏蔽差异"
- badge: 内核空间
  title: VFS
  desc: 这一层是抽象的，不干实事
  tone: violet
  group: 内核
  nodes:
    - { title: 统一的文件模型, sub: "inode / dentry / file 三个结构" }
    - { title: 挑一个具体文件系统, sub: "这个挂载点下面是谁" }
  next: "往下找具体实现 :: :: 规律被抹平了"
- badge: 内核空间
  title: 三层缓存
  desc: 能不能不碰磁盘，全看它们
  tone: amber
  group: 内核
  nodes:
    - { title: 页缓存, sub: "文件内容的副本" }
    - { title: dentry 缓存, sub: "路径解析的结果" }
    - { title: inode 缓存, sub: "用过没释放的 inode" }
  next: "缓存里没有 :: :: 这才需要真去读磁盘"
- badge: 内核空间
  title: 具体文件系统
  desc: 到这里才有真正的算法
  tone: green
  group: 内核
  nodes:
    - { title: Ext4 / XFS / Btrfs, sub: "本地磁盘" }
    - { title: NFS / SMB, sub: "网络文件系统" }
    - { title: /proc /sys, sub: "是内核数据的窗口" }
  next: "要读写块了 :: :: 再往下就是设备了"
- badge: 内核空间
  title: 块层与驱动
  desc: 把文件操作翻译成硬件操作
  tone: muted
  group: 内核
  nodes:
    - { title: 通用块层, sub: "合并请求、排序、调度" }
    - { title: 设备驱动, sub: "对磁盘控制器说话" }
  next: ""
- badge: 硬件
  title: 存储设备
  desc: 数据真正落地的地方
  tone: muted
  group: 存储
  nodes:
    - { title: 本地磁盘, sub: "SSD / HDD" }
    - { title: 网络存储, sub: "另一台机器上的盘" }
```

==每一层都只解决一个问题。== 库函数管「少发系统调用」，VFS 管「抹平差异」，缓存管「能不去磁盘就别去」，具体文件系统管「块怎么摆在磁盘上」，块层管「怎么把请求有效率地发给设备」。

### 三层缓存分别缓存什么

这三层都叫「缓存」，但缓存的东西完全不同，混起来就说不清了：

```compare
first: 缓存
head: [缓存的是什么, 命中之后省掉了什么]
rows:
  - 页缓存: ["文件内容本身（按页/块）", { text: "不用读磁盘", tone: green }]
  - dentry 缓存: ["路径解析的结果：名字 → inode", { text: "不用逐层读目录文件", tone: green }]
  - inode 缓存: ["已经读进来的 inode", { text: "不用再从 inode 区读一次元信息", tone: green }]
```

第 ⑥ 篇讲的「缓冲 I/O」和「直接 I/O」，说的就是在这个图里**绕不绕过页缓存**这一问题。

---

## 03 · 三类文件系统与挂载

按数据存在哪，Linux 的文件系统分三类：

```cards
cols: 3
items:
  - title: 磁盘文件系统
    desc: 数据真的存到磁盘上
    tag: 最常见
    tone: blue
    body: |
      Ext2 / 3 / 4、XFS、Btrfs、NTFS……

      这是「文件系统」这个词最原始的含义：把磁盘上的块组织成文件。
  - title: 内存文件系统
    desc: 数据在内存里，不在磁盘
    tag: 不落盘
    tone: violet
    body: |
      `/proc`、`/sys`、`tmpfs` 都是这一类。

      ==读写这类文件，实际上是在读写内核里的数据结构。==
      比如 `/proc/cpuinfo` 并不是一个真实存在的文件，
      是内核在你读它的时候临时拼出来的。
  - title: 网络文件系统
    desc: 访问别的机器上的数据
    tag: 跨网络
    tone: amber
    body: |
      NFS、SMB、CIFS。

      在你看来 `/mnt/nfs/a.txt` 就是一个普通路径，
      底下 VFS 会把 read 请求打包成网络请求发出去。
```

另外，文件系统**得挂载到某个目录才能用**。

```journey
- tag: 没有挂载时
  tone: muted
  name: 一块有数据的磁盘
  badge: 用不了
  fields:
    - { k: 设备, v: "/dev/sdb1", note: 内核能看到它 }
    - { k: 里面, v: "Ext4 格式的数据" }
  noteTone: bad
  note: 内核知道有这块盘，但没有路径能通向它
  next: "挂载到一个目录 :: :: 让路径能走到它"
- tag: 挂载之后
  tone: green
  name: mount /dev/sdb1 /mnt/data
  badge: 能用了
  fields:
    - { k: 挂载点, v: "/mnt/data", note: 访问入口, tone: ok }
    - { k: 效果, v: "访问 /mnt/data/x 就是在访问 sdb1" }
  note: 从此这个目录下面的东西，都来自那块盘
```

Linux 启动时会把根文件系统挂到 `/`，之后其他文件系统再一层层挂上去。==所以整棵目录树可以由好几块不同的物理磁盘拼成。==

---

## 04 · 文件描述符与打开文件表

打开一个文件时，操作系统要记住「这个进程开着哪些文件、每个读到哪了」。

用起来很简单：

```c
int fd = open("notes.md", O_RDONLY);   // 打开，拿到一个整数
read(fd, buf, 100);                    // 之后只用这个整数，不再用文件名
close(fd);                             // 用完要关，不然会泄漏
```

那个整数就是**文件描述符**（file descriptor）。它是==一个下标，指向进程自己的一张表。==

```arch
svg: fs-open-file-table
caption: 进程 A 和进程 B 各自 open 同一个文件，会得到两个不同的表项（各自的读写偏移），但它们指向同一个 inode。
```

打开文件表里记着四样东西：

```compare
first: 记什么
head: [什么意思, 为什么需要]
rows:
  - 文件指针: ["这个文件读到第几个字节了", "同一个文件被两个进程打开时，各自的进度要分开算"]
  - 打开计数器: ["有几个进程正开着它", "计数到 0 才能删掉这个表项 —— 不然会把别人正在用的关掉"]
  - 文件磁盘位置: ["inode 在哪、数据块在哪", "缓存在内存里，省得每次操作都去磁盘读一遍"]
  - 访问权限: ["只读 / 读写 / 追加……", "打开之后要能判断某次 read 或 write 合不合法"]
```

==文件指针是「每个打开动作一份」，不是「每个文件一份」。== 这就是为什么两个进程同时读同一个文件时，各自读到的地方互不影响。

---

## 05 · 用户按字节，内核按块

到这里有个绕不开的错位：

```cards
cols: 2
items:
  - title: 你看到的
    desc: 文件是一条连续的字节流
    tag: 用户视角
    tone: blue
    body: |
      你 `read(fd, buf, 1)` 读一个字节，就真的拿到一个字节。

      文件在程序看来就是一个长长的数组，下标是字节偏移量。
  - title: 磁盘上真实的
    desc: 一块一块的 4KB 方块，散落在各处
    tag: 内核视角
    tone: amber
    body: |
      磁盘不认字节，只认块。文件的数据块可能根本不连续，
      前后两块可能隔了半个磁盘。

      ==操作系统完全不关心你在内存里把它理解成什么数据结构。==
```

**把这两个视角对上的工作，就是文件系统。**

```flow
grid: true
nodes:
  - { id: one, label: "用户读 1 个字节", sub: "read(fd, buf, 1)", row: 0, tone: blue }
  - { id: which, label: "算出这是第几块", sub: "字节偏移 ÷ 块大小", row: 1, tone: violet }
  - { id: get, label: "把那一块读进来", sub: "从磁盘读一整个 4KB", row: 2, tone: amber }
  - { id: back, label: "只返回那 1 个字节", sub: "剩下的先留在缓存里", row: 3, tone: green }
edges:
  - { from: one, to: which, label: "定位" }
  - { from: which, to: get, label: "要整块" }
  - { from: get, to: back, label: "按需切出你要的那一段" }
```

写的时候是反过来的：找到那一块、**把整块读进来**、只改其中你要写的那几个字节、再把整块写回去。

==所以文件系统的最小操作单位是块，不是字节。== 读 1 个字节和读 4096 个字节，在磁盘层面是完全一样的代价。这也是为什么「小文件随机读」在磁盘上特别慢 —— 每次都要捞一整块回来，而你可能只用了其中几个字节。

---

```quiz
- q: 有了 VFS，是不是就不需要具体文件系统了？
  a: |
    恰恰相反，VFS 自己不干活。它只是一个统一的接口层和抽象模型，
    真正的读写算法还是各文件系统自己实现的（Ext4 怎么找块、NFS 怎么发网络请求都不一样）。
    VFS 的价值在于让上层不用关心这些差异。
- q: 两个进程同时读同一个文件，一个读到第 100 字节，另一个会受影响吗？
  a: |
    不会。每次 open 都会创建一个独立的「打开文件表项」，各自的读写偏移记在自己的表项里。
    两个表项指向同一个 inode（所以看到的是同一份数据），但进度是分开算的。
    fork 出来的子进程则不同 —— 它共享父进程的表项，所以父子会共用同一个偏移。
- q: 页缓存、dentry 缓存、inode 缓存，这三个是同一回事吗？
  a: |
    不是。页缓存存的是文件内容；dentry 缓存存的是「路径名解析到哪个 inode」这个结果；
    inode 缓存存的是已经读进内存的 inode（元信息）。
    它们分别省掉了「读磁盘」「逐层遍历目录」「读 inode 区」三种不同的开销。
```
