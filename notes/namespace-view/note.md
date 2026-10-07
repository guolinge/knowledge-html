```arch
svg: ns-two-containers
caption: 上面那张表说的是「每种 namespace 在复制哪张表」。这张说的是另一件事：==两个容器之间，哪些各有一份、哪些是同一份。== 中间那个红色的是共用的。
parts:
  pidA:
    label: PID namespace
    detail: 一份**自己复制出来的进程列表**。容器里的 1 号进程，在宿主机上有个别的 PID。两个容器各有一份，互相看不见。
  mntA:
    label: MNT namespace
    detail: 一棵自己复制出来的挂载树。镜像层就是在这个 namespace 里被挂成根目录的。
  shared:
    label: NET + IPC namespace
    detail: '==这两个是同一个 Pod 里的容器**共用**的。==所以它们共享一个 localhost、一张网卡、一组共享内存段 —— 这正是「同 Pod 的容器像一个机上邻居」的原因。'
anchors:
  - { part: shared, label: "哪些是两个容器共用的" }
  - { part: pidA, label: "我从 PID 这头看" }
tours:
  - id: two-containers
    label: "两个容器：各自的和共用的"
    steps:
      - { at: [procA, pidA, mntA], text: "先看左边这个容器。它的进程 ==各有一份 PID namespace 和 MNT namespace== —— 自己的一份进程列表，自己的一棵 / 树。" }
      - { at: [procB, pidB, mntB], text: "右边那个也一样。==「隔离」这个词的具体内容，就是这一圈各复制一份。==" }
      - { at: [shared], text: "但中间这个不一样。\n\n==NET 和 IPC 是两个容器**共用同一份**的== —— 它们指着同一份表，不是各复制一份。" }
      - { at: [shared, procA, procB], text: "这就是 K8s 里「同一个 Pod 的容器像一个机上邻居」的全部机制：**保留几个 namespace 不复制**。\n\n反过来，不同 Pod 之间连这几个也复制了，所以互相看不见。" }
```

---

## 01 · 「隔离」这个词，说了等于没说

中台给你的定义是：

> namespace 负责「隔离你看得到什么」。

对，但它没告诉你**怎么做到的**。所以「隔离」听起来像给进程发了一个房间。而房间是实体的东西，得有地方造、得占地方。

==真实的机制要朴素得多：内核里那些「名字 → 对象」的表，被做成了可以有多份。==

先看内核自己需要哪些表：

```cards
cols: 2
items:
  - title: pid 表
    desc: pid 号 → 哪个进程
    tone: violet
    body: |
      你 `ps` 看到的一列数字，就是这张表。
      有了它，`kill 1234` 才知道该杀谁。
  - title: 网卡与路由表
    desc: 有哪些网卡、往哪发
    tone: violet
    body: |
      `ip addr` 列出的是它，`ip route` 也是它。
      还有一整套 iptables 规则表。
  - title: 挂载表
    desc: 哪个路径对应哪个文件系统
    tone: violet
    body: |
      `mount` 看到的就是它。它决定了「`/` 底下有什么」。
  - title: 主机名 / 用户 / IPC 对象
    desc: hostname、uid 映射、共享内存段
    tone: violet
    body: |
      三样东西各有一张表。
      IPC 那张决定了你能看到哪些共享内存和消息队列。
```

这些表**本来都只有一份**。namespace 做的事，就是**让它们可以有好几份**。

```flow
grid: true
groups:
  - { id: after, label: "有了 PID namespace 之后：同一批进程，两张表", tone: green }
nodes:
  - { id: b1, label: "一份 pid 表", sub: "没有 namespace 时，全机器只有这一份，1 号进程只能有一个", row: 0, tone: muted }
  - { id: a1, label: "宿主机看到的那份", sub: "pause 是 47900、nginx 是 48213", row: 1, tone: blue, group: after }
  - { id: a2, label: "容器里看到的那份", sub: "同一个 pause 叫 1、nginx 叫 7", row: 2, tone: green, group: after }
edges:
  - { from: b1, to: a1, label: "让它可以有多份", labelDy: 26 }
  - { from: a1, to: a2, label: "同一个进程，两张表里两个号" }
```

==同一个进程，在同一时刻，可以有两个 PID。== 因为它同时出现在两张表里，而每个人只能看见自己绑定的那张。

这就是「隔离」的全部机制。没有房间，没有沙箱，只是**换了一张表看**。

---

## 02 · 看一眼就懂了：同一个内核，两个 `ps`

```demo
widget: ns-view
title: 同一台机器，切换视角看同一批命令
actions: false
hint: 点上面的两个视角来回切
config:
  hint: 进程列表和网卡变化最直观。留意「我是谁」那一栏：两边的 uid 都是 0，但底下指向的不是同一个身份。
  views:
    - { id: host, name: 站在宿主机上, sub: root@web-node-01（运维登进来的） }
    - { id: ct, name: 站在容器里, sub: root@3f2a8c1b9e04（exec 进去的） }
  facets:
    - id: proc
      cmd: ps aux
      ns: pid
      tone: blue
      host:
        - "USER  PID  COMMAND"
        - "root   1   systemd"
        - "root 47900 containerd-shim"
        - "root 48213 nginx: master"
        - "…共 137 个进程"
      ct:
        - "USER  PID  COMMAND"
        - "*root   1   nginx: master"
        - "*root   7   nginx: worker"
        - "*…共 3 个进程"
    - id: net
      cmd: ip addr
      ns: net
      tone: violet
      host:
        - "1: lo     127.0.0.1/8"
        - "2: eth0   10.0.1.7/24"
        - "*11: veth3a2  10.0.1.7 的一端"
        - "…还有 9 张 veth 网卡，每个容器一张"
      ct:
        - "1: lo     127.0.0.1/8"
        - "*2: eth0   172.17.0.2/16"
        - "*（它就是宿主机上那张 veth3a2 的另一头）"
    - id: uts
      cmd: hostname
      ns: uts
      tone: green
      host:
        - "*web-node-01"
      ct:
        - "*3f2a8c1b9e04"
    - id: user
      cmd: id
      ns: user
      tone: amber
      host:
        - "uid=0(root) gid=0(root)"
        - "（这就是真的 root）"
      ct:
        - "uid=0(root) gid=0(root)"
        - "*（看着一样，但它在宿主机上实际是 uid 100000）"
    - id: mnt
      cmd: ls /
      ns: mnt
      tone: blue
      host:
        - "bin boot dev etc home …"
        - "*（宿主机的真根目录）"
      ct:
        - "bin dev etc usr var …"
        - "*（是镜像层叠出来的另一个根，看不到上面的 /home）"
    - id: cg
      cmd: cat /proc/self/cgroup
      ns: cgroup
      tone: muted
      host:
        - "0::/system.slice/containerd.service"
      ct:
        - "*0::/"
        - "（它以为自己就在 cgroup 树的根上）"
```

六栏里，每一栏上面都标着**是哪一类 namespace 在管它**。你可以挨个切两遍，看哪几栏会变。

==一栏都不变的那种，就是没被 namespace 管的东西。==

---

## 03 · 八种 namespace，各自在复制哪张表

```compare
first: namespace
head: [它复制的是哪张表, 于是你能看到什么, 容器里怎么用]
rows:
  - PID: ["pid 号 → 进程", "一份独立的进程列表，自己的 1 号进程", "容器里的 nginx 是 PID 1，宿主机上它是 48213"]
  - NET: ["网卡 · 路由 · iptables · 端口", "一套独立的网络栈，假的 localhost", "每个容器一张 veth，配一段自己的 IP 段"]
  - MNT: ["路径 → 挂载的文件系统", "一棵独立的挂载树，自己的 /", "镜像层在这个 namespace 里被挂成根目录"]
  - UTS: ["主机名 · 域名", "一个独立的主机名", "容器名变成 hostname，`hostname` 命令看得出差别"]
  - USER: ["uid / gid 的映射关系", "一套可以让 root 不等于真 root 的映射", "容器里的 uid 0 落到宿主机上是个普通用户"]
  - IPC: ["共享内存段 · 消息队列 · 信号量", "一组独立的 IPC 对象", "同 Pod 的容器共享它，不同 Pod 互相看不见"]
  - CGROUP: ["`/proc/pid/cgroup` 的输出", { text: "一个独立的 cgroup 树视图（**不是** cgroup 本身）", tone: amber }, "容器里看到自己在「根」上，看不到宿主机那棵大树"]
  - TIME: ["单调时钟与启动时间的偏移", "一组不同的时间基准", "少用。做检查点恢复之类的需要"]
```

!!最后一行那个 CGROUP namespace 最容易看错。!!

```callout
tone: red
icon: ⚠
text: |
  **cgroup namespace 隔离的不是资源，是「你看 cgroup 树的视野」。**

  它只影响 `/proc/<pid>/cgroup` 和 `/proc/<pid>/mountinfo` 这两处输出。
  ==cgroup 本身完全没有被虚拟化==：限额还是那份限额，树还是那棵树，
  只是让容器里的人误以为自己在根上，看不到宿主机的 cgroup 结构（主要是隐私与整洁）。

  中台那张表把它和别的 namespace 并列写成「让进程看到独立的 cgroup 层级视图」，
  措辞是对的，但==很容易让人以为「cgroup 被隔离了」==，那就错了。
```

---

## 04 · 三个特写

### PID：容器里的 1 号进程

```journey
- tag: 宿主机视角
  tone: blue
  name: 真实的 pid
  badge: 一个普通数字
  fields:
    - { k: pause 容器, v: "47900" }
    - { k: nginx, v: "48213" }
    - { k: 你 exec 进去的 shell, v: "48310" }
  note: 在这张表里，它们只是三个普通的进程号，和别的进程没有区别
  next: "换成容器的 pid namespace 再看 :: :: 同一批进程，号码全变了"
- tag: 容器视角
  tone: green
  name: 同一批进程的另一套号
  badge: 从 1 开始编号
  fields:
    - { k: pause 容器, v: "1", note: 它在容器里是「1 号进程」, tone: ok }
    - { k: nginx, v: "7" }
    - { k: 你的 shell, v: "23" }
  note: ==PID namespace 里的 1 号就是「这个 namespace 的 init」== —— 它挂了，整个 namespace 一起被内核清掉
```

所以容器里那个几乎什么都不干的 `pause` 放在 1 号，是有原因的：==它得活着当那根柱。==

### NET：`veth` 是两头各一个网卡

```flow
grid: true
groups:
  - { id: h, label: "宿主机那边", tone: blue }
  - { id: c, label: "容器那边", tone: green }
nodes:
  - { id: eth, label: "eth0", sub: "10.0.1.7", row: 0, tone: blue, group: h }
  - { id: veth, label: "veth3a2", sub: "宿主机这一头，看不见 IP", row: 0, tone: violet, group: h }
  - { id: veth2, label: "eth0", sub: "172.17.0.2 —— veth 的另一头", row: 1, tone: green, group: c }
  - { id: lo, label: "lo", sub: "127.0.0.1，也是独立的一个", row: 2, tone: green, group: c }
edges:
  - { from: eth, to: veth, label: "宿主机本来就有" }
  - { from: veth, to: veth2, label: "像一根网线的两端" }
  - { from: veth2, to: lo, label: "容器里的 localhost 只指它自己" }
```

==`veth` 永远成对出现，一头在宿主机、一头在容器。== 这就是「容器有独立网络，但又能出网」的实现方式。

也顺带解释了同 Pod 的容器为什么 `localhost` 互通：它们的 NET namespace 是**同一个**，根本不需要走网络。

### USER：容器里的 root 不是真 root

```flow
grid: true
nodes:
  - { id: root, label: "uid 0（root）", sub: "容器里看到的：它以为自己就是 root", row: 0, tone: amber }
  - { id: map, label: "uid_map 这张映射表", sub: "0 → 100000", row: 1, tone: violet }
  - { id: real, label: "uid 100000", sub: "宿主机上实际落的：一个没有特权的普通用户", row: 2, tone: green }
edges:
  - { from: root, to: map, label: "它以为自己是谁" }
  - { from: map, to: real, label: "内核判定权利时用的是这个" }
```

==所以「容器里是 root、会不会把宿主机搞坏」这个问题，取决于用户命名空间怎么配的。==

没开 user namespace 的容器（默认的 Docker 就是），容器里的 root **就是**宿主机的 root。这是「容器不等于安全边界」的原因之一。

---

## 05 · 怎么确认自己绑的是哪一份表

````callout
tone: violet
icon: 🔍
text: |
  **`/proc/<pid>/ns/` 下面每个文件都是一个 inode，inode 号相同就是同一个 namespace。**

  ```console
  $ ls -l /proc/48213/ns
  lrwxrwxrwx 1 root root 0 ... cgroup -> 'cgroup:[4026531835]'
  lrwxrwxrwx 1 root root 0 ... ipc    -> 'ipc:[4026531839]'
  lrwxrwxrwx 1 root root 0 ... mnt    -> 'mnt:[4026532501]'
  lrwxrwxrwx 1 root root 0 ... net    -> 'net:[4026532563]'
  lrwxrwxrwx 1 root root 0 ... pid    -> 'pid:[4026532566]'
  lrwxrwxrwx 1 root root 0 ... uts    -> 'uts:[4026532500]'
  ```

  两个进程的 `net` 一栏 inode 号一样 → 它们共用同一套网络栈（同 Pod 的容器就是这样）。
  `pid` 不一样 → 它们各自一套进程表。

  ==这个 inode 号就是 namespace 的身份证。== 有了它，「谁和谁在一个 namespace 里」
  就不再是概念问题，而是 `diff` 一下的事。
````

---

## 06 · 但 namespace 一点都不管「用多少」

到这儿可以把 namespace 的一句话结论说死了：

```compare
first: 说法
head: [对不对]
rows:
  - "namespace 让进程以为自己独占一台机器" : [{ text: "对（视角层面）", tone: green }]
  - "namespace 会阻止进程占满 CPU" : [{ text: "✗ 完全不会", tone: red }]
  - "namespace 会阻止进程吃光内存" : [{ text: "✗ 完全不会", tone: red }]
  - "namespace 会阻止 fork 炸弹" : [{ text: "✗ 完全不会", tone: red }]
```

一个只用了 namespace 的「容器」，里面跑一个 `yes > /dev/null`，照样能把整台机器的 CPU 吃干净。它只是**看不见别人**，不是**动不了别人的东西**。

==这就是为什么容器必须同时有 cgroup。== 下一篇讲它。

---

```quiz
- q: namespace 到底做了什么？用一句话说清机制，不要说「隔离」。
  a: |
    它让内核里那些「名字 → 对象」的全局表可以有多份。
    pid 表、网卡表、挂载表、uid 映射表各有一份，进程在创建时被绑定到其中一份上。
    所以同一个进程可以在两张 pid 表里有两个不同的号：能看到它的那一份，决定了它叫什么。
- q: cgroup namespace 和 cgroup 是一回事吗？
  a: |
    不是。cgroup 是资源限制机制（真实的限额、一棵树）；
    cgroup namespace 只虚拟化「你看这棵树的视野」，影响 /proc/<pid>/cgroup 和 mountinfo 的输出，
    让容器里的人以为自己就在根上。
    限额本身完全没有被虚拟化。这是最容易记混的一处。
- q: 为什么容器里的 1 号进程通常是个几乎不干活的 pause？
  a: |
    因为 PID namespace 里的 1 号就是这个 namespace 的 init：它一挂，内核会把整个 namespace 清掉。
    所以得放一个最不可能崩、也最不需要干活的进程在那儿当柱子。
    业务容器崩了重建，Pod 的网络身份不受影响，靠的就是它。
- q: 一个容器只用了 namespace、没配 cgroup，会有什么后果？
  a: |
    容器会「看起来」很隔离：看不到别人的进程、有自己的网卡和主机名，
    但它可以毫无阻碍地吃光宿主机的 CPU、内存，或者 fork 出一堆进程把机器拖死。
    namespace 管的是「看得见什么」，不是「能用多少」。这两件事从来是分开的。
```
