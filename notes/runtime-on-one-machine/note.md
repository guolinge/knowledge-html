```arch
svg: container-machine
caption: 「容器」不是一个东西，是一个**框** —— 把「一个进程 + 它挂的三样属性」圈起来的那个圈。注意框外面那两样：内核和镜像层不在任何容器里，这才是「容器轻」的答案。
parts:
  procA:
    label: nginx 进程
    sub: 真实存在的东西
    detail: ==内核里根本没有「容器」这个对象==。`docker ps` 看到的那一行，在系统眼里就是**这一个普通进程** —— 跟你在本机直接跑一个 nginx 没有区别。
  nsA:
    label: 一组 namespace
    detail: 决定它**能看见什么**：哪些别的进程、哪块网卡、哪棵树。不是「隔离出一块内存」，而是「换一份名字表」。
  cgA:
    label: 一个 cgroup
    detail: 决定它**最多能用多少** CPU、内存、IO。
  rootA:
    label: 一个 rootfs
    detail: 它看到的 `/` 长什么样 —— 由镜像的只读层叠出来，再加一层可写的。
  procB:
    label: java 进程
    sub: 完全同构
    detail: 第二个容器。它的价值和第一个一样，只是**证明这不是特例**。
  kernel:
    label: Linux 内核
    sub: 全机器就一个
    detail: ==容器共享的就是它。== 一个内核服务这台机器上所有的容器 —— 这就是「容器轻」的全部原因：不用为每个容器启动一个操作系统。注意它在这个框里，但**不在任何容器框里**。
  image:
    label: 镜像只读层
    sub: 磁盘上只有一份
    detail: 所有基于同一个镜像的容器，==在磁盘上共用同一份只读层==。多出来的只是各自那层可写的。
anchors:
  - { part: procA,  label: "我想看清「一个容器」" }
  - { part: kernel, label: "我从内核这头看" }
  - { part: image,  label: "我从镜像这头看" }
tours:
  - id: what-is-container
    label: "「容器」到底是什么"
    steps:
      - { at: [procA], text: "先从最实在的东西开始：==一个普通进程==。把你的 `docker ps` 和 `ps aux` 对上，就是这一个。" }
      - { at: [procA, nsA, cgA, rootA], text: "`docker run nginx` 在系统眼里是：==fork 一个进程，然后给这个进程挂上三样属性==。\n\n注意这三样是**并列挂在进程上**的 —— 不是「进程导致 namespace 导致 cgroup」那种链。" }
      - { at: [procA, nsA, cgA, rootA], text: "==把「进程 + 它挂的这几样」圈起来，那个圈就是「容器」。==\n\n圈是人画的，不是内核画的 —— 内核里没有这个对象。" }
      - { at: [kernel], text: "圈外面是==共用的内核==。一个内核服务这台机器上所有容器 —— 容器共享的是它，不是「又一个操作系统」。" }
      - { at: [kernel, procA, procB], text: "==同一个内核，1 对 N==。这是「容器轻」的全部原因。" }
      - { at: [image, rootA, rootB], text: "镜像的只读层也一样：==磁盘上一份，N 个容器共用==。每个容器多出来的只是自己那层可写的。" }
```

---

## 01 · 那张「分层图」错在哪

你手上那份回答，把这几样东西叠成了一根竖轴：

```
Deployment → Pod → Container → Image → containerd + runc → Linux 内核 → 硬件
```

==这张图里混了四种完全不同的关系，所以越看越糊：==

```compare
first: 关系
head: [谁和谁, 是长久的吗]
rows:
  - 谁创建谁: ["镜像 → 容器 → Pod → Deployment", { text: "创建完就结束了，不是持续关系", tone: amber }]
  - 谁在内存里跑着: ["dockerd / containerd / kubelet / 容器进程", { text: "只有这个是「谁压着谁」", tone: green }]
  - 谁管谁: ["Deployment 管 Pod，kubelet 管容器", "常驻的命令关系，但**双方不一定在同一台机器上**"]
  - 谁依赖谁的代码: ["containerd 调用 runc", { text: "**代码依赖**，不是进程层级", tone: red }]
```

还有一个更根本的错：==**`runc` 根本不是一层。**== 它只在「创建容器」那一瞬间存在，建完就退出了。

```timeline
- when: t = 2
  title: containerd fork 出 runc
  desc: 它要干的是调 clone / unshare / setns，把进程建出来
  tone: blue
- when: t = 3
  title: runc 就退出了
  desc: 活了一瞬间。它不是「容器进程运行的依赖」，只是「容器进程的接生婆」
  tone: red
- when: t = 3 之后
  title: 真正留下来陪容器的是 containerd-shim
  desc: 它才是容器进程的父进程，一直活到容器被删
  tone: green
```

看这条时间轴，比看任何分层图都清楚：一起吃住的和只来一趟的，长度差得很远。

```demo
widget: runtime-timeline
title: 创建、重启、删除：谁在，谁不在
actions: false
hint: 点「下一步」或「自动跑」
config:
  tMax: 8
  procs:
    - id: kubelet
      name: kubelet
      sub: K8s 在这台机器上的代表
      note: systemd 拉起来的。它只管下命令，自己不碰容器
      spans: [[0, 8]]
    - id: containerd
      name: containerd
      sub: 拉镜像 · 备 rootfs
      note: 一个节点一个。==重启它，容器照跑==
      spans: [[0, 5], [6, 8]]
    - id: runc
      name: runc
      sub: 根据 namespace / cgroup 建进程
      note: 一次性。建完就退出，不留下来
      spans: [[2, 3]]
    - id: shim
      name: containerd-shim
      sub: 容器进程的父进程
      note: 每个容器一个，常驻到容器被删
      spans: [[3, 7]]
    - id: nginx
      name: nginx（容器进程）
      sub: 容器里真正跑的东西
      note: 它的爹是 shim。它和 containerd 之间没有任何层级关系
      spans: [[3, 7]]
  steps:
    - at: 0
      what: 机器刚起来，只有管理平面。kubelet 和 containerd 由 systemd 拉起，跟容器没有任何关系。
    - at: 1
      what: kubelet 从 apiserver 收到「要有一个 nginx Pod」，通过 CRI 接口告诉本机的 containerd。所以在这个视角里，控制面只是个消息来源，不在这一层里。
    - at: 2
      what: containerd 动手，fork 出一个 runc。
    - at: 3
      what: runc 调 clone / unshare / setns，把进程建出来、套上 namespace 和 cgroup，然后它自己就退出了。==它不是常驻的一层==。
    - at: 4
      what: containerd fork 出 shim。这个 shim 才是容器进程的亲爹：它负责 waitpid 收尸、转发 stdio（所以 kubectl logs 能看到东西）、向 containerd 汇报退出码。
    - at: 5
      what: nginx 跑起来了。==它和 containerd 之间没有父子关系==，它的爹是 shim，而它和 containerd 都只是内核上的普通进程。
    - at: 6
      what: 重启 containerd。==容器照跑，一点没受影响==，因为顶着的是 shim，不是 containerd。这就是 shim 存在的全部理由。
    - at: 7
      what: 删掉容器：nginx 和 shim 一起消失。管理平面上那两位不受影响。
```

---

## 02 · 真实的样子：两个平面 + 一个内核

```arch
svg: runtime-planes
caption: 管理平面（一个节点一套）和每个容器的 shim 是两拨人。==容器进程不经过它们，直接站在内核上。==
```

这张图上有三处值得盯着看：

```checklist
tone: warn
items:
  - containerd 和容器进程之间没有箭头：它们不是父子，是两个各自的进程
  - shim 的箭头是实线加粗的，那才是唯一的父子关系
  - 内核那一段标着 namespace / cgroup / 网络栈，这就是「容器」在系统里的全部痕迹
```

---

## 03 · 那「容器」到底是个什么东西

直说：==**内核里没有「容器」这个对象。**==

它是一个纯约定俗成的说法，指代的是这么一组东西：

```flow
grid: true
groups:
  - { id: notobj, label: "你在 docker ps 里看到的那一行，在内存里对应的就是这些", tone: blue }
nodes:
  - { id: proc, label: "一个（组）普通进程", sub: "nginx、java，跟你在本机直接跑的一模一样", row: 0, tone: blue, group: notobj }
  - { id: ns, label: "一组 namespace 标签", sub: "决定它能看见哪些别的进程、哪块网卡", row: 1, tone: violet, group: notobj }
  - { id: cg, label: "一个 cgroup", sub: "决定它最多能用多少 CPU、内存、IO", row: 2, tone: violet, group: notobj }
  - { id: root, label: "一个 rootfs", sub: "镜像叠出来的只读根目录，加上一层可写层", row: 3, tone: violet, group: notobj }
edges:
  - { from: proc, to: ns, label: "把标签挂到这个进程上" }
  - { from: ns, to: cg, label: "同上" }
  - { from: cg, to: root, label: "同上" }
```

`docker run nginx` 在你眼里是「启动了一个容器」，在系统眼里是「**fork 一个进程，然后给这个进程挂上几样属性**」。

这也解释了一件让你困惑的事：**为什么 `docker ps` 看到的容器、`ps aux` 看到的 nginx 进程、`kubectl get pods` 看到的 Pod，是同一件事的三个说法。**

```compare
first: 视角
head: [看到的是什么, 同一个东西的不同包装]
rows:
  - docker ps: ["容器 ID + 名字 + 镜像", "给「那个进程」起了个人类友好的名字"]
  - ps aux: ["nginx: master process", { text: "==这才是真实存在的东西==：一个进程", tone: green }]
  - lsns / systemd-cgls: ["namespace 列表 / cgroup 树", "那个进程身上挂的属性"]
  - kubectl get pods: ["Pod 名字 + 状态", "K8s 给一组共享标签的进程打的另一个名字"]
```

---

## 04 · 一台机器上的进程家族树

按「谁 fork 了谁」画，比按「谁调用谁」画清楚得多：

```tree
- label: systemd (PID 1)
  note: 机器上所有进程的根
  children:
    - label: kubelet
      sub: 由 systemd 拉起
      note: 它不 fork 容器，只跟 containerd 说话
    - label: containerd
      sub: 由 systemd 拉起
      note: 管理平面。它 fork 的是 shim，不是容器进程
      children:
        - label: containerd-shim
          note: 每个运行中的容器一个。它是容器进程真正的父进程
          children:
            - { label: nginx, note: "==容器进程在这里==。" }
        - label: containerd-shim
          note: 另一个容器的
          children:
            - { label: java, note: 它也是别人的孩子，不是你想象的那个层级 }
```

`runc` 不在这棵树里，==因为它活不到你能 `ps` 到它的时候。== 它在 shim 被创建的那一刻出现，建完进程就走。

```callout
tone: violet
icon: 🧬
text: |
  **「容器」和「Pod」都不在这棵树上，因为它们都不是进程。**

  它们是**标签的集合**：

  - ==容器== = 一个进程 + 那四样属性（namespace / cgroup / rootfs / 自己的 shim）
  - ==Pod== = 几个共享 Network / IPC / UTS namespace 的容器，再加一个 `pause` 容器当它们的共享骨架

  所以「Pod 里有哪些容器」这个问题问得通，
  而「Pod 进程的 PID 是多少」问不通：**它自己没有 PID。**
```

---

## 05 · 那镜像呢

镜像**不在内存里**。它在磁盘上睡大觉：

```journey
- tag: 第 1 站
  tone: muted
  name: 镜像仓库（别的机器）
  badge: 躺着
  fields:
    - { k: 长什么样, v: "registry.example.com/backend:v1" }
    - { k: 在哪, v: "Harbor / Docker Hub / 云厂商的仓库" }
  note: 这一步只在「拉取」时发生，拉完就跟它没关系了
  next: "containerd 把它拉下来 :: :: 落到这台机器的磁盘上"
- tag: 第 2 站
  tone: blue
  name: 节点磁盘
  badge: ==睡在这里，不在内存里==
  fields:
    - { k: 解压后的层, v: "/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/" }
    - { k: 原始压缩包, v: "/var/lib/containerd/io.containerd.content.v1.content/" }
    - { k: 用 Docker 的话, v: "/var/lib/docker/overlay2/", note: 另一套目录, tone: warn }
  noteTone: bad
  note: 镜像层是只读的，所有容器共用同一份
  next: "创建容器时 :: :: 叠成一个文件系统给进程看"
- tag: 第 3 站
  tone: green
  name: 容器进程眼里的根目录
  badge: 只是挂载视图
  fields:
    - { k: 看到的是, v: "一个完整的根目录 /" }
    - { k: 实际是, v: "几个只读层叠起来 + 一层可写层", note: 写时才复制, tone: ok }
  note: 这一站才和内存有关系。但进内存的是「被读到的那些块」，不是整个镜像
```

==所以「镜像跑起来需要容器吗」这个问题，答案要分两半：==

```compare
first: 说法
head: [对不对, 准确的问法]
rows:
  - "镜像运行起来需要容器": [{ text: "大致对，但不准确", tone: amber }, "镜像自己永远不会运行。真正运行的是**进程**，容器只是这个进程的包装说法"]
  - "一个镜像可以有多个容器": [{ text: "对", tone: green }, "准确说：同一份只读镜像，可以给多个进程当根目录。100 个副本 = 一份镜像 + 100 个进程"]
  - "容器是镜像的实例": [{ text: "对，但别当成面向对象", tone: amber }, "没有「类」和「对象」那种实体；就是同一批只读层被挂到不同的进程上"]
```

---

## 06 · Docker 单机 和 K8s 节点，差在哪

```compare
first: 有什么
head: [只管 Docker 的机器, K8s 工作节点]
rows:
  - 容器进程: [{ text: "有", tone: green }, { text: "有，一模一样", tone: green }]
  - containerd: [{ text: "有", tone: green }, { text: "有", tone: green }]
  - containerd-shim: [{ text: "有", tone: green }, { text: "有，一模一样", tone: green }]
  - runc: [{ text: "有，一样是一次性的", tone: green }, { text: "有，一样是一次性的", tone: green }]
  - dockerd: [{ text: "有", tone: amber }, { text: "==没有== —— K8s 不需要它", tone: red }]
  - docker CLI: [{ text: "有", tone: amber }, { text: "没有", tone: red }]
  - kubelet: [{ text: "没有", tone: red }, { text: "有", tone: green }]
  - pause 容器: [{ text: "没有", tone: red }, { text: "每个 Pod 一个", tone: green }]
```

==底下三层完全一样。== K8s 不是「在 Docker 之上加了一层」，而是**换掉了最上面那层用户界面**：

```flow
grid: true
groups:
  - { id: dk, label: "Docker 单机的入口", tone: blue }
  - { id: k8, label: "K8s 节点的入口", tone: green }
  - { id: same, label: "这两边一样", tone: muted }
nodes:
  - { id: cli, label: "docker CLI", sub: "你说 docker run", row: 0, tone: blue, group: dk }
  - { id: dockerd, label: "dockerd", sub: "把命令翻译一下，再往下交", row: 1, tone: blue, group: dk }
  - { id: api, label: "kubectl", sub: "你说 kubectl apply", row: 0, tone: green, group: k8 }
  - { id: kube, label: "kubelet", sub: "盯着期望状态，有差距就去补", row: 1, tone: green, group: k8 }
  - { id: cd, label: "containerd", sub: "一个节点一个", row: 2, tone: violet, group: same }
  - { id: shim, label: "containerd-shim", sub: "每个容器一个", row: 3, tone: violet, group: same }
  - { id: ctn, label: "容器进程", sub: "nginx / java", row: 4, tone: green, group: same }
edges:
  - { from: cli, to: dockerd, label: "" }
  - { from: api, to: kube, label: "" }
  - { from: dockerd, to: cd, label: "gRPC" }
  - { from: kube, to: cd, label: "CRI", labelDx: 46 }
  - { from: cd, to: shim, label: "fork" }
  - { from: shim, to: ctn, label: "亲爹" }
```

---

## 07 · Pod 多出来的那个东西

K8s 比 Docker 多出来的核心概念是 **Pod**，而 Pod 在内存里的实现，靠的是一个几乎什么都不干的容器：

```flow
grid: true
groups:
  - { id: pod, label: "一个 Pod 在内存里 = 一个 pause 容器 + 若干业务容器", tone: green }
nodes:
  - { id: pause, label: "pause 容器", sub: "镜像只有几百 KB，跑起来就干一件事：sleep", row: 0, tone: violet, group: pod }
  - { id: a, label: "nginx 容器", sub: "共享 pause 的 Network namespace", row: 1, tone: green, group: pod }
  - { id: b, label: "sidecar 容器", sub: "共享同一个 Network namespace", row: 1, tone: green, group: pod }
  - { id: why, label: "为什么要有它", sub: "它持有那组共享的 namespace。业务容器崩了重建，Pod 的网络身份不变", row: 2, tone: amber, group: pod }
edges:
  - { from: pause, to: a, label: "把 NET 这个 namespace 借给它" }
  - { from: pause, to: b, label: "同一个" }
  - { from: b, to: why, label: "" }
```

所以同一个 Pod 里的两个容器，`localhost` 能互相访问，==因为它们共用同一张网卡，不是因为它们之间有网络。==

```callout
tone: violet
icon: 📦
text: |
  **从这里就能看出 Pod 的定位：它不是「更大的容器」，是「共享命名空间的一小组容器」。**

  它带来的实际约束是：

  - 同一 Pod 里的容器**必须被调度到同一台机器上**（因为要共享 namespace）
  - 它们**一起生、一起死**（生命周期绑在一起）
  - 端口是按 Pod 分的：==同一个 Pod 里两个容器不能都监听 80==

  这三条都不是人为规定，是「共享 namespace」这个实现方式的直接推论。
```

---

```quiz
- q: containerd 和容器进程是什么关系？
  a: |
    不是父子，也不是上下级。containerd 是节点级的管理进程，它 fork 出的是 shim；
    shim 才是容器进程的父进程（负责 waitpid 收尸、转发 stdio、汇报退出码）。
    containerd 直接和容器进程之间没有任何层级关系，它们都只是内核上的普通进程。
    这也是为什么重启 containerd 不会影响正在运行的容器：顶着的是 shim。
- q: runc 在系统里长期存在吗？
  a: |
    不存在。它是「一次性」的：containerd 在创建容器时 fork 出它，
    它调 clone / unshare / setns 把进程建出来、套上 namespace 和 cgroup，
    然后就退出了。它更像接生婆而不是保姆，所以任何把它画成「一层」的图都是错的。
- q: 「容器」在 Linux 里对应哪个内核对象？
  a: |
    没有这样一个对象。内核里没有 container 这个东西，
    「容器」是一个约定俗成的说法，指代「一个（组）普通进程 + 一组 namespace 标签
    + 一个 cgroup 限额 + 一个 rootfs」这一整包。
    所以 docker ps 看到的条目、ps 看到的 nginx 进程、kubectl get pods 看到的 Pod，
    是同一个东西的三种不同命名方式。
- q: 我一个镜像起了 3 个副本，磁盘上会存 3 份镜像吗？
  a: |
    不会。镜像层是只读的，3 个副本共用同一份。
    它们各自的差别只在那一层「可写层」，而且写时才复制。
    所以磁盘占用是「一份镜像 + 三份改动」，不是三份镜像。
- q: cd 进一个容器里改的东西，会在别的副本里出现吗？
  a: |
    不会。你改的落在那个容器自己的可写层上，只对该容器可见。
    镜像的那些层始终是只读的，这是容器能秒级启动、能复用的前提。
    要持久化得挂 volume，要固化成新镜像得 commit / build。
```
