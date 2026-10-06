## 01 · 「限制资源」也太笼统

中台给的定义同样是对的、但同样不告诉你形状：

> cgroup 用于对一组进程进行资源限制、统计、优先级控制和进程管理。

==它的具体形状是一棵树：**每个节点是一组配额，配额对整棵子树生效，进程挂在某个节点上。**==

记住这一句，后面所有东西都是从它推出来的。

---

## 02 · 一棵树

```tree
- label: /
  note: cgroup 的根。机器上所有进程都在这棵树下
  children:
    - label: system.slice
      note: systemd 管的系统服务都挂在这
      children:
        - label: containerd.service
          sub: memory.max = max
          note: containerd 自己也在一个 cgroup 里，也受管
    - label: kubepods.slice
      note: K8s 会把自己的 cgroup 树挂在这一支下面
      children:
        - label: pod3f2a8c1b
          sub: memory.max = 1073741824
          note: 一个 Pod 一个节点。这一层的配额，下面所有容器一起分
          children:
            - label: <nginx 容器 id>
              sub: cpu.max = 200000 100000
              note: 真正挂进程的叶子节点
              children:
                - { label: "PID 48213 · nginx" }
            - label: <sidecar 容器 id>
              sub: cpu.max = 100000 100000
              note: 同一个 Pod 里的另一个容器，各有一份自己的配额
```

三件事从这张树上直接看出来：

```compare
first: 树上的位置
head: [意味着什么, 实际的后果]
rows:
  - 配额挂在节点上: ["写一次，整棵子树都受约束", "在 Pod 这一层写 memory.max = 1G，就是 Pod 里所有容器合起来不超过 1G"]
  - 一个进程只在一个节点上: [{ text: "不能同时在两个 cgroup 里", tone: blue }, "所以「这个容器用了多少」是个确定的问题"]
  - 一个进程的所有线程: ["跟它的主进程在同一个 cgroup 里", "==不能把同一个进程的线程拆到两个 cgroup=="]
```

```flow
grid: true
groups:
  - { id: sup, label: "父节点的配额，是给整棵子树的总量", tone: amber }
nodes:
  - { id: pod, label: "pod3f2a8c1b", sub: "memory.max = 1G", row: 0, tone: amber, group: sup }
  - { id: a, label: "nginx 容器", sub: "自己没写 memory.max，所以继承 pod 那层的约束", row: 1, tone: green, group: sup }
  - { id: b, label: "sidecar 容器", sub: "同上。它俩合起来不能超过 1G", row: 1, tone: green, group: sup }
edges:
  - { from: pod, to: a, label: "把它和它的后代一起管住" }
  - { from: pod, to: b, label: "" }
```

---

## 03 · 超限了会发生什么：内存和 CPU 完全不是一回事

这条中台完全没讲，但它是最实用的一条。==内存超了是**死**，CPU 超了只是**慢**。==

```demo
widget: cg-limit
title: 拖配额，看进程的两种结局
actions: false
hint: 拖两个滑块，把配额拖到进程想要的值以下
config:
  demand: { mem: 1229, cpu: 2.5 }
  mem: { min: 256, max: 2048, step: 64, def: 1024 }
  cpu: { min: 0.25, max: 4, step: 0.25, def: 3 }
```

为什么差别这么大？因为这两件事的物理约束不一样：

```compare
first: 资源
head: [内核能怎么处理, 于是结局是]
rows:
  - 内存: ["要么给它页，要么不给。==没有「给一半慢慢跑」这个选项==", { text: "触及上限且回收不出内存 → OOM killer 给整个 cgroup 发 SIGKILL", tone: red }]
  - CPU: ["时间是可分割的。这一毫秒没轮到它，下一毫秒再给", { text: "被节流：每个周期里最多用配额那么多时间，用超了就等到下个周期", tone: amber }]
  - 磁盘 I/O: ["同 CPU，可以排队", "被限速，请求在队列里等"]
  - 进程数: ["创建是即时的，超额就直接拒绝", "fork 失败，返回错误"]
```

!!所以「容器莫名其妙被 OOM kill 了」和「容器变慢了」是两个完全不同的排查方向。!!

```callout
tone: violet
icon: 💡
text: |
  **OOM 的判定单位是 cgroup，不是整台机器。**

  内核在触发 OOM 时，会先在这棵子树上找人杀（选内存占用最大的那个）。
  所以经常出现「机器还剩很多内存，但我的容器被杀」：==它超出的是自己那份配额，不是机器的容量。==

  反过来也成立：`memory.high` 是个「软上限」，超了先节流（直接回收 + 让进程变慢），
  而不是直接杀。想要「别死但可以慢」，配的就是它。
```

---

## 04 · `docker run` 的参数最后落在哪

```flow
grid: true
groups:
  - { id: all, label: "同一条命令，最后落在这些文件上", tone: violet }
nodes:
  - { id: cmd, label: "docker run", sub: "--memory=1g --cpus=2", row: 0, tone: blue, group: all }
  - { id: max, label: "memory.max", sub: "1073741824", row: 1, tone: violet, group: all }
  - { id: cmax, label: "cpu.max", sub: "200000 100000", row: 1, tone: violet, group: all }
  - { id: cur, label: "memory.current", sub: "实际用量，只读", row: 2, tone: muted, group: all }
  - { id: stat, label: "cpu.stat", sub: "被节流了多久", row: 2, tone: muted, group: all }
edges:
  - { from: cmd, to: max, label: "写成字节" }
  - { from: cmd, to: cmax, label: "拆成配额链" }
  - { from: max, to: cur, label: "" }
  - { from: cmax, to: stat, label: "" }
```

`cpu.max` 的格式是 `$MAX $PERIOD`，单位都是微秒，默认周期是 100000（=100ms）。

```
cpu.max = 200000 100000   →  每 100ms 里最多用 200ms 的 CPU 时间
                             也就是说：它最多能占满 2 个核
```

==所以「几个核」这个说法，底层其实是「每个周期给多少微秒」。== `--cpus=2` 就是配额 200000。写成 `--cpus=0.5`，就是 `50000 100000`。

````callout
tone: amber
icon: 📁
text: |
  **查看的位置（cgroup v2）：**

  ```
  /sys/fs/cgroup/<容器所在的那条路径>/
      ├── memory.max        上限（"max" = 不限）
      ├── memory.current    当前用了多少
      ├── memory.high       软上限：超了先节流，不杀
      ├── memory.events     oom_kill 次数就在这
      ├── cpu.max           "配额 周期"
      └── cpu.stat          被节流了多久（throttled_usec）
  ```

  ++`cpu.stat` 里的 `nr_throttled` 和 `throttled_usec` 是排查「容器为什么变慢」的第一站。++
````

---

## 05 · 限制和统计是同一份数据的两面

中台把「限制」和「统计」列成两件事，其实它们就是同一个机制的两个方向：

```flow
grid: true
groups:
  - { id: one, label: "同一个 cgroup 节点，同一份计数器", tone: violet }
nodes:
  - { id: write, label: "你写入 memory.max", sub: "这是「限制」", row: 0, tone: blue, group: one }
  - { id: cnt, label: "内核在记账", sub: "每次分配/释放都更新那个计数器", row: 1, tone: violet, group: one }
  - { id: read, label: "你读 memory.current", sub: "这是「统计」", row: 2, tone: green, group: one }
edges:
  - { from: write, to: cnt, label: "设一条线" }
  - { from: cnt, to: read, label: "读出来就是当前值" }
```

==没有单独的「统计机制」。== 内核本来就是一边记账一边判断有没有超线：账本就是统计，那条线就是限制。

这也解释了为什么 cgroup 能顺带提供「这个容器实际用了多少 CPU / 内存」：它本来就在记。

---

## 06 · 为什么从「好几棵树」变成「一棵树」

你看到的 `cgroup v2` 是 2016 年之后的新方案。之前（v1）不是一棵树：

```flow
grid: true
groups:
  - { id: v1, label: "cgroup v1：每种资源一棵独立的树", tone: red }
  - { id: v2, label: "cgroup v2：只有一棵树", tone: green }
nodes:
  - { id: c1, label: "cpu 树", sub: "进程 A 在 /web 下", row: 0, tone: red, group: v1 }
  - { id: m1, label: "memory 树", sub: "同一个进程 A 在 /batch 下", row: 1, tone: red, group: v1 }
  - { id: i1, label: "io 树", sub: "它又在 /web/high 下", row: 2, tone: red, group: v1 }
  - { id: u1, label: "一棵树管所有控制器", sub: "cpu / memory / io / pids 都在同一个节点上生效", row: 0, tone: green, group: v2 }
  - { id: u2, label: "一个进程一个位置", sub: "不再可能出现「在 CPU 树里属于 A，在内存树里属于 B」", row: 1, tone: green, group: v2 }
  - { id: u3, label: "子树的总量更好算", sub: "一个节点就是一份完整的配额", row: 2, tone: green, group: v2 }
edges:
  - { from: c1, to: m1, label: "同一个进程在三棵树里位置可以不同" }
  - { from: m1, to: i1, label: "" }
  - { from: u1, to: u2, label: "统一了" }
  - { from: u2, to: u3, label: "" }
```

v1 最麻烦的地方就是那个「位置可以不同」：==一个进程在 CPU 树里属于「Web 组」，在内存树里属于「批处理组」，于是「这个容器的配额是多少」根本答不上来。==

| | v1 | v2 |
|---|---|---|
| 树的棵数 | 每种控制器一棵，可以有任意多棵 | **只有一棵** |
| 一个进程的位置 | 每棵树里各有一个，互不相干 | 全树唯一 |
| 新控制器 | 只能挂到没被占用的那棵树上 | 自动挂到统一树上 |
| 默认启用 | 老发行版 | systemd 243（2019-09）起 |

---

## 07 · 那「cgroup namespace」是什么

```callout
tone: red
icon: ⚠
text: |
  **它和 cgroup 完全是两件事，只是名字像。**

  | | 管什么 |
  |---|---|
  | cgroup | 真实的配额。限制进程能用多少 CPU / 内存 |
  | cgroup namespace | ==只影响 `/proc/<pid>/cgroup` 的输出==，让容器里的人以为自己就在根上 |

  它带来的唯一好处是：容器里 `cat /proc/self/cgroup` 看到的是 `0::/`，
  而不是 `/kubepods.slice/pod3f2a8c1b.slice/<一长串>`，
  既整洁，也不泄露宿主机的 cgroup 结构。

  ++限额一点没变。++ 别把它当成「cgroup 被隔离了」。
```

---

## 08 · 两个机制合起来，才是「容器」

```compare
first: 机制
head: [它负责, 它不负责]
rows:
  - namespace: [{ text: "进程能看到哪些对象", tone: blue }, { text: "一点都不管用了多少", tone: red }]
  - cgroup: [{ text: "进程能用多少资源", tone: blue }, { text: "一点都不管能看到什么", tone: red }]
  - rootfs（镜像叠出来的挂载视图）: ["进程看到的 / 是什么", "同上，不限制资源"]
```

==所以「容器」这个词底下没有新东西==：它就是三样现成的机制拼起来，再给那个进程起个名字。

这也解释了为什么容器启动那么快：**没有虚拟机、没有 Guest OS、没有新的内核** —— 只是 fork 一个进程，然后给它挂上标签和配额。

---

```quiz
- q: cgroup 的「一棵树」这个形状，直接推出了哪些性质？
  a: |
    三条。第一，配额挂在节点上、对整棵子树生效 —— 所以「Pod 这一层写 1G」是给整个 Pod 的总量。
    第二，一个进程只能在一个节点上，不能同时在两个 cgroup 里，所以「这个容器用了多少」是确定的。
    第三，一个进程的所有线程必须在同一个 cgroup 里，不能把线程拆开。
- q: 容器内存超限和 CPU 超限，处理方式有什么本质区别？
  a: |
    内存是「要么给、要么不给」，没有中间状态，所以触及上限又回收不出内存时，
    内核直接给整个 cgroup 发 SIGKILL（OOM kill）。
    CPU 是时间，可以切分也可以延后，所以超限只是被节流 —— 每个周期最多用配额那么多，
    用超了就等到下个周期，进程变慢但不会死。
    「被 kill」和「变慢」是两个完全不同的排查方向。
- q: 为什么经常出现「机器还剩很多内存，但我的容器被 OOM 杀了」？
  a: |
    因为 OOM 判定的单位是 cgroup，不是整台机器。
    内核在你的那个 cgroup 子树上发现超出配额、又回收不出足够内存时，
    就在这棵子树上挑一个进程杀掉（通常选占得最多的那个）。
    机器整体的剩余内存和这件事无关 —— 它超出的是自己那份配额。
- q: cgroup namespace 会让容器里的进程不受配额限制吗？
  a: |
    不会。它只虚拟化 /proc/<pid>/cgroup 和 mountinfo 这两处输出，
    让容器里的人以为自己在 cgroup 树的根上。
    配额本身完全没有被虚拟化 —— 该限多少还是多少。
    名字里带 cgroup，但它和「资源限制」是两件事。
```
