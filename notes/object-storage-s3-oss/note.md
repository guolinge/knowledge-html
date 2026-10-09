## 01 · 为什么需要对象存储：三种存储范式的分工

先摆场景。假设你在为一个内容平台设计存储方案，数据画像是：几亿张用户上传的图片和视频，总量 PB 级；单文件从几 KB 的缩略图到几十 GB 的 4K 原片；全球用户通过浏览器直接下载，峰值 QPS 数十万。

第一反应大概是「买硬盘挂到服务器上」。但一台机器的本地磁盘几十 TB 就到头了；换 NAS？共享文件系统在百万级文件下目录遍历已经卡顿，跨地域访问延迟不可控。传统方案的问题归为两类：

- ==纵向扩展有天花板== —— 单机磁盘、单 NAS 控制器有物理极限；
- ==互联网不可直达== —— 块设备和文件系统从来不是为 HTTP 访问设计的，用户没有任何办法直接读到一块远端磁盘上的内容。

正是这类场景逼出了存储架构的三分天下：块存储、文件存储、对象存储各守一段生态位。

### 01.1 块设备的世界观：一排编了号的格子

先看最底下那层。块存储（云盘、EBS、SAN LUN）眼里，整个磁盘长这样：

```raw
<div class="oss-blockrow">
  <div class="oss-blockrow-grid">
    <div class="oss-cell"><b>块 0</b><span>512B</span></div>
    <div class="oss-cell"><b>块 1</b><span>512B</span></div>
    <div class="oss-cell"><b>块 2</b><span>512B</span></div>
    <div class="oss-cell"><b>块 3</b><span>512B</span></div>
    <div class="oss-cell"><b>块 4</b><span>512B</span></div>
    <div class="oss-cell"><b>块 5</b><span>512B</span></div>
    <div class="oss-cell"><b>块 6</b><span>512B</span></div>
    <div class="oss-cell"><b>块 7</b><span>512B</span></div>
  </div>
  <p class="oss-blockrow-note">接口只有两个：读第 N 块 → 返回这 512 字节；写第 N 块 → 把 512 字节覆盖进去。就这样，没了。</p>
</div>
```

它完全不知道这些东西：什么是「文件」、什么是「文件夹」、什么是「文件名」、哪些块属于同一个文件、哪些块是空闲的。它就是一排编了号的格子，像一面墙上的储物柜 —— ==柜子本身不知道里面放的是什么==。

为什么叫「块」设备？和另一种设备对比就清楚了：

```compare
first: 设备类型
head: [典型代表, 读写单位]
rows:
  - "字符设备": ["键盘、鼠标、串口", "一个字节一个字节地流式读写"]
  - "块设备": ["硬盘、SSD、云盘", "必须以「一整块」为单位（通常 512B 或 4KB）"]
```

你不能说「我只要第 100 块里的第 3 个字节」—— 必须把整个第 100 块读出来，自己从中取第 3 个字节。这个「按整块读写」的约束，决定了它上面必须再套一层软件才能给人用。

### 01.2 文件系统：把编号的格子组织成文件和目录

文件系统（File System）就是装在块设备之上的一层软件，负责把「一堆编号的块」组织成「文件和目录」：

- 没有它，你面对的是块 0、块 1、块 2 …… 块 999999999，根本无从知道「我的照片在哪」；
- 有了它，你面对的是 `/photos/cat.jpg`（2.3MB）这样的树。它负责维护映射：「cat.jpg 的内容存在块 1024~1028」。

一次「打开 /photos/cat.jpg」在四层里的完整旅程：

```lane-stack
- badge: LAYER 01
  title: 应用程序
  desc: 你的代码
  tone: muted
  nodes:
    - { title: open("/photos/cat.jpg"), sub: "我要这个文件的内容", tag: 系统调用 }
  next: "文件名换块号 :: lookup :: 文件系统查自己的映射"

- badge: LAYER 02
  title: 文件系统（ext4 / NTFS / APFS）
  desc: 块与文件之间的翻译官
  tone: violet
  nodes:
    - { title: "cat.jpg → 块 1024~1028", sub: "查元数据，共 5 个块", tag: 映射表 }
  next: "块号换指令 :: 命令队列 :: 一个块一条"

- badge: LAYER 03
  title: 块设备驱动
  desc: 只认识「读第 N 块 / 写第 N 块」
  tone: blue
  nodes:
    - { title: "读块 1024 · 1025 · … · 1028", sub: "按块下发", tag: 块 I/O }
  next: "电信号/磁信号 :: 物理读写 :: 到硬件了"

- badge: LAYER 04
  title: 物理硬盘
  desc: 磁头移动 / 闪存芯片读取
  tone: muted
  nodes:
    - { title: 返回原始字节, sub: "它不知道自己存的是照片", tag: 512B × N }
```

文件系统要扛的职责，远不止「记个映射」：

```cards
cols: 3
items:
  - { title: 命名, desc: 给数据取名字（文件名、路径）, tone: muted }
  - { title: 组织, desc: 目录树结构（文件夹嵌套文件夹）, tone: muted }
  - title: 空间分配
    desc: 记录哪些块空闲、新文件放哪
    tone: muted
  - title: 块 ↔ 文件映射
    desc: 记录「这个文件的内容分布在哪些块上」
    tone: violet
  - title: 元数据
    desc: 文件大小、创建/修改时间、权限
    tone: violet
  - title: 一致性 / 日志
    desc: 断电不丢数据、崩溃后能恢复（journal）
    tone: amber
```

### 01.3 一块云盘只能挂一台机器：多机共享怎么办

对「几亿对象 + 全球下载」的场景，块存储还有一个致命伤：==一块云盘同一时刻只能挂载到一台机器==（少数支持多挂载，但需要集群文件系统协调）。让多台机器同时读写同一块盘，靠的是集群文件系统 —— 它的核心是分布式锁管理器（DLM）：谁要改数据先举手，拿到锁才能改。

```seq
grid: true
participants:
  - { id: a, label: 机器 A, tone: blue }
  - { id: dlm, label: DLM 分布式锁, tone: amber }
  - { id: b, label: 机器 B, tone: violet }
messages:
  - { from: a, to: dlm, label: "我要写 /data/log.txt，申请写锁", kind: sync, note: 1 }
  - { from: dlm, to: a, label: "没人持有，授予", kind: reply, note: 2 }
  - { from: a, to: a, label: A 开始写入, kind: self }
  - { from: b, to: dlm, label: "我也想写，申请写锁", kind: sync, note: 4 }
  - { from: dlm, to: b, label: "A 正持有 → 等待", kind: reply, tone: red, note: 5 }
  - { from: a, to: dlm, label: 写完，释放锁, kind: sync, note: 6 }
  - { from: dlm, to: b, label: "锁可用了", kind: reply, tone: green, note: 7 }
  - { from: b, to: b, label: B 开始写入, kind: self }
```

两次写入有序进行，不会互相覆盖；因为锁保证了顺序，B 能看到 A 刚写的内容。除了数据本身，元数据（目录结构、空闲块表）也要同步：一台机器建了文件，其他节点的目录缓存要失效重读 —— 靠日志和心跳机制完成。

集群文件系统容易和分布式文件系统混为一谈，两者的差别是根本性的：

```compare
first: 对比
head: [集群文件系统（GFS2 / OCFS2）, 分布式文件系统（HDFS / Ceph）]
rows:
  - 存储形态: [多台机器共享**同一块物理存储**（SAN / 多重挂载云盘）, 数据分散存在多台机器**各自的硬盘**上]
  - 核心问题: [如何协调多人同时读写同一块盘, 如何把多台机器的盘拼成一个大文件系统]
  - 关键机制: [分布式锁（DLM）, 数据分片 + 复制]
  - 一句话: ["「同一块盘」上的交通规则", "「一堆盘」组成的虚拟大盘"]
```

它和数据库集群架构的关系也常被问到：共享存储架构（如 Oracle RAC，多实例挂同一块存储）==需要==集群文件系统；无共享架构（Shared Nothing，如 TiDB、MySQL 主从，每节点自己的盘 + 网络同步）==不需要==，普通 ext4 就行。一个是「存储共享」，一个是「数据逻辑管理」—— 一个管字节放哪，一个管数据是什么含义。

再补一个容易被追问的点：集群文件系统已经有分布式锁了，数据库为什么还要自己实现锁？==粒度和语义完全不同==。文件系统锁的是「这段字节我在写，别人别碰」，不知道文件里面装的是什么；数据库锁的是「id=1024 这一行我在改」，知道数据的逻辑结构。集群文件系统是仓库管理员（“3 号货架 3 层别人在用”），数据库是会计（“张三的账户正在转账”）—— 会计的账本确实放在仓库里，但会计的工作代替不了仓库管理员，反过来也一样。

### 01.4 三种范式各守一段生态位

有了对底两层的认识，再看三种范式的分工就是一张全景：

```flow
grid: true
groups:
  - { id: spectrum, label: "抽象层级 ↑ · 语义约束 ↓ · 扩展能力 ↑", tone: blue }
nodes:
  - { id: block, label: 块存储, sub: "EBS / 云盘 / SAN\n裸字节数组 · 低延迟", row: 0, group: spectrum, tone: muted }
  - { id: file, label: 文件存储, sub: "NFS / CIFS / NAS\n目录树 · POSIX", row: 0, group: spectrum, tone: violet }
  - { id: object, label: 对象存储, sub: "S3 / OSS / R2\nkey + blob · HTTP", row: 0, group: spectrum, tone: green }
edges:
  - { from: block, to: file, label: "GB~TB" }
  - { from: file, to: object, label: "TB~PB → EB" }
```

三种范式不是替代关系，而是==抽象层级递增、扩展能力递增、语义约束递减==的互补格局。落到维度上：

```compare
first: 维度
head: [块存储, 文件存储, 对象存储]
rows:
  - 访问单位: [扇区 / 固定块, 文件（字节流）, 对象（完整 blob）]
  - 命名空间: [无（靠上层文件系统）, 树形目录, 扁平 key 空间]
  - 扩展方式: [{ text: 纵向（加盘 / 换大盘）, tone: red }, { text: 有限横向（元数据瓶颈）, tone: amber }, { text: 近乎无限横向, tone: green }]
  - 访问协议: [iSCSI / NVMe（块协议）, NFS / SMB（POSIX）, { text: HTTP REST API, tone: green }]
  - 随机写: [支持, 支持, { text: 不支持（整对象覆盖）, tone: red }]
  - 一致性成本: [单机，低, 跨机，高（锁 / rename）, { text: 极低（对象级原子）, tone: green }]
```

### 01.5 对象存储的取舍：用「能力」换「规模」

要在 EB 量级做水平扩展，必须放弃层级树结构和 POSIX 语义。对象存储的设计正是对这个结论的兑现 —— 它**显式放弃**了三样东西：

```compare
first: 显式放弃的
head: [具体含义]
rows:
  - 就地修改: ["对象不可变。改一个字节 = 重新 PUT 整个对象覆盖"]
  - 目录树: ["命名空间完全扁平，只有 key → object 的映射"]
  - POSIX 语义: ["没有 lock、没有原子 rename（要靠 copy + delete 模拟）、没有 append（部分厂商提供非标准 append，但不是核心语义）"]
```

换来的是三样：

```cards
cols: 3
items:
  - title: 近乎无限的水平扩展
    desc: key 按哈希打散到任意多节点，加机器即加容量与吞吐
    tone: green
  - title: HTTP 原生可寻址
    desc: 每个对象天然是一个 URL，浏览器 / CDN 直接可达
    tone: green
  - title: 极低的存储单价
    desc: 运维复杂度低、硬件利用率高，单 GB 成本远低于块存储
    tone: green
```

这套取舍和数据库领域的一个经典模式同构：从关系型数据库（强约束、SQL、事务）退化到 KV 存储（只认 key-value、放弃 JOIN 和事务）—— 接口越简单、约束越少，水平扩展的空间就越大。==对象存储就是存储领域的 KV 化==：用接口的极简换吞吐与规模的极大。

```callout
tone: violet
icon: 💡
quote: true
text: |
  对象存储不是「功能不足的文件系统」，而是**为无限规模主动做了架构级 trade-off 的专用存储范式**。
```

## 02 · 核心模型：一张巨型分布式 Map

### 02.1 一切都是扁平的 key-value

把 01 节的结论拧紧一步，对象存储最精确的心智模型是：

```callout
tone: blue
icon: 🗺
quote: true
text: |
  对象存储 ≈ 一个全局的、持久化的、高可用的 `Map<string, {bytes, metadata}>`
```

这张巨型分布式哈希表有三个核心概念：

```cards
cols: 3
items:
  - title: Bucket（桶）
    desc: 命名空间。类比 DNS 顶级域名 —— 全局唯一、不可重名，用来隔离租户或业务域；一个桶就是一张独立的哈希表
    tone: blue
  - title: Key（键）
    desc: "完整的 UTF-8 字符串，最长通常 1024 字节。它不是「路径」—— `photos/2024/a.jpg` 就是一个 key 字符串"
    tone: violet
  - title: Object（对象）
    desc: 这张表的值，由三块组成：data blob + system metadata + user metadata
    tone: green
```

一个对象内部的三段结构：

```spec
title: one object
subtitle: "GET /my-app-assets/photos/a.jpg 返回的到底是什么"
tone: violet
rows:
  - k: data blob
    v: |
      原始字节流本体（图片 / 视频 / 任意二进制）。
  - k: system metadata
    v: |
      系统自动维护：`size`、`ETag`、`Content-Type`、`Last-Modified` 等。
      `Content-Type` 决定浏览器是「显示图片」还是「触发下载」（第 07 节有它惹的祸）。
      `ETag` 用于 HTTP 条件请求（`If-None-Match`）和去重校验。
  - k: user metadata
    v: |
      用户自定义键值对，如 `x-amz-meta-author: tom` —— 业务标记、检索索引用。
```

为什么这个模型天然可分片？因为==扁平 key 空间可以按哈希无限打散==：key 经过哈希落到某个分片（partition / shard），分片分布在不同存储节点上。增加节点只需要迁移少量分片 —— 没有层级依赖，就没有中心元数据瓶颈。

```flow
grid: true
nodes:
  - { id: k1, label: "photos/a.jpg", sub: key, row: 0, tone: muted }
  - { id: k2, label: "logs/err.log", sub: key, row: 0, tone: muted }
  - { id: k3, label: "avatar.png", sub: key, row: 0, tone: muted }
  - { id: h, label: 一致性哈希, sub: "hash(key)", row: 1, tone: amber }
  - { id: shard, label: 分片（partition）, sub: "按哈希均匀散落", row: 2, tone: violet }
  - { id: node, label: "Node A · B · C · D …", sub: "加机器 = 搬少量分片", row: 3, tone: green }
edges:
  - { from: k1, to: h }
  - { from: k2, to: h }
  - { from: k3, to: h }
  - { from: h, to: shard }
  - { from: shard, to: node }
```

和 01.2 里文件存储那棵「所有 readdir / rename 压向根」的目录树对比：一边的元数据收敛在少数节点上，一边按哈希均匀散落、无中心瓶颈。这就是「扁平换扩展」的落地形态。

这套模型下，所有操作都简单到不像话：`PUT = map.set(key, object)`，`GET = map.get(key)`，`DELETE = map.delete(key)`，`LIST = map.keys().filter(prefix)`。==正是这种极简接口让它能在 EB 量级上运转。==

Bucket 名是**全局唯一**的（同一服务商内、甚至跨区域），像注册域名 —— 一旦被占就不能重名。它的作用是==限定 key 的作用域 + 承载桶级别的配置==（权限、生命周期规则、版本控制开关等）。第 08 节会看到这些规则设一次就管住几十亿个对象 —— 这就是桶存在的意义之一。

## 03 · 目录是幻觉：prefix / delimiter / CommonPrefixes

这是前端工程师最容易踩的认知误区。在 S3 / OSS 控制台里你看到的「文件夹」结构：

```
photos/
  2024/
    summer/
      beach.jpg
      sunset.jpg
    winter/
      snow.jpg
    cover.jpg
  2025/
    a.png
```

会让人下意识认为 `photos/` 和 `2024/` 是真实存在的目录节点。==不是的==。底层根本没有目录这个实体，实际存储的是一堆完全扁平的 key：`"photos/2024/summer/beach.jpg"`、`"photos/2024/cover.jpg"`、`"photos/2025/a.png"` …… ==key 里的 `/` 只是普通字符，不存在目录节点，不占空间。==

那控制台里那棵「树」是怎么来的？靠 ListObjectsV2 接口的 prefix + delimiter 两个参数**在查询期即时聚合**出来的。三个词各管一件事：

```cards
cols: 3
items:
  - title: Prefix —— 过滤
    desc: "「只返回以这个字符串开头的 key」。`Prefix: \"photos/2024/\"` → 不匹配的 key 连看都不看"
    tone: blue
  - title: Delimiter —— 分层（折叠）
    desc: "「遇到这个字符就别往下展开，折叠起来」。传 `\"/\"` 时：去掉前缀后剩余部分里含 `/` 的，截到第一个 `/` 归入 CommonPrefixes"
    tone: violet
  - title: CommonPrefixes —— 折叠出来的组名
    desc: "被折叠的那些组的名字。控制台里显示成「文件夹图标」的来源"
    tone: green
```

Delimiter 逐个 key 的判定过程（请求 `Prefix: "photos/2024/"`、`Delimiter: "/"`）：

```demo
widget: stepper
title: 四个 key，怎么被折叠成「两棵子文件夹 + 一个文件」
actions: false
config:
  steps:
    - label: photos/2024/cover.jpg
      code: "去掉前缀 → \"cover.jpg\"\n剩余部分里没有 \"/\""
      note: 不折叠 → 放进 **Contents**（当前层级的文件）
    - label: photos/2024/summer/beach.jpg
      code: "去掉前缀 → \"summer/beach.jpg\"\n剩余部分里有 \"/\" → 在 \"summer/\" 处折叠"
      note: 归入 CommonPrefix：**photos/2024/summer/**
    - label: photos/2024/summer/sunset.jpg
      code: "去掉前缀 → \"summer/sunset.jpg\"\n同样折叠到 \"summer/\""
      note: 和 beach.jpg 共享同一段前缀 → 归入**同一个** CommonPrefix（去重后只有一条）
    - label: photos/2024/winter/snow.jpg
      code: "去掉前缀 → \"winter/snow.jpg\"\n在 \"winter/\" 处折叠"
      note: 归入 CommonPrefix：**photos/2024/winter/**
    - label: 响应
      code: "Contents: [\"photos/2024/cover.jpg\"]\nCommonPrefixes: [\"photos/2024/summer/\",\n                \"photos/2024/winter/\"]"
      note: 控制台把它渲染成「winter/、summer/ 两个文件夹 + cover.jpg 一个文件」—— 树是查询时演出来的
```

CommonPrefixes 不是什么、是什么，值得单独钉一遍：

```callout
tone: amber
icon: ⚠
text: |
  CommonPrefixes ==不是一个真实存在的「目录对象」==，不是存储系统里的一个节点，不需要创建也删不掉。
  它是**查询时即时计算出来的聚合结果** —— 「恰好有一批 key 共享了这段前缀」的证据。
```

### 亲手折叠一遍

下面这个模拟器左边是「真实存储」的扁平 key 列表，右边是这次请求真正返回的东西。切 Prefix、切 Delimiter，看「文件夹」什么时候出现、什么时候消失；再往里面 PUT 一个以 `/` 结尾的 key，看「空文件夹」是怎么被造出来的：

```demo
widget: s3-list-lab
title: ListObjectsV2 折叠模拟器
actions: false
config:
  keys:
    - photos/2024/summer/beach.jpg
    - photos/2024/summer/sunset.jpg
    - photos/2024/winter/snow.jpg
    - photos/2024/cover.jpg
    - photos/2025/a.png
    - docs/resume.pdf
    - avatar.png
    - logs/2026/08/17/app.log.gz
  prefixes: ["", "photos/", "photos/2024/", "logs/"]
  defPrefix: "photos/2024/"
  defDelim: true
```

### 三个直接后果

「目录是幻觉」不是冷知识，它决定了几个日常操作的形态：

```cards
cols: 3
items:
  - title: 没有 mv 目录
    body: |
      想把 `photos/2024/` 「重命名」为 `images/2024/`？只能逐个对象 copy 到新 key + delete 旧 key。百万个文件就是百万次操作。
    tone: amber
  - title: 「空目录」不存在
    body: |
      除非显式创建一个 key 为 `photos/2024/` 且 body 为空的对象来「占位」，否则删光文件后「目录」就消失了 —— 上面模拟器里 PUT 进去的那个就是这种占位对象。
    tone: amber
  - title: list 大前缀要分页
    body: |
      默认单次最多返回 1000 个 key。亿级前缀下必须用 `ContinuationToken` 迭代，不能一把拉完。
    tone: amber
```

### 为什么这么设计

如果真搞目录：要维护目录节点的元数据、创建 / 删除 / 移动文件时要更新父目录、目录一致性要跨节点保证 —— 01 节讲过的「中心元数据瓶颈」原样回来了，扩展性受限。用前缀模拟目录之后：key 就是一个字符串，存在哪台机器只看 hash；没有「父目录」要更新；删一个对象不需要通知任何「目录」；创建对象也不需要「先创建父目录」。==真正的扁平化，无限扩展；「目录感」只在查询时按需生成 —— 读的体验好，写的开销小。==

```summary
title: 三句话收束这一节
text: |
  **Prefix** = 「我只要以这个字符串开头的 key」（过滤）。
  **Delimiter** = 「遇到这个字符就别往下展开了，折叠起来」（分层）。
  **CommonPrefixes** = 「被折叠的那些组的名字」（模拟出的子文件夹）。
  三者配合 —— 在扁平的 key 空间上，用查询参数「演」出了一棵目录树。
```

## 04 · 可靠性与不可变：为什么改一个字节要重传整个文件

### 04.1 硬盘一定会坏

一个残酷的现实：一块硬盘的年故障率大约 1%~3%。一万块硬盘（对象存储的典型规模）意味着 ==每天大约坏 1 块、每年坏 100~300 块==。如果数据只存一份，盘一坏数据就永久丢失 —— 所以必须做冗余，同一份数据存多处。

### 04.2 方案一：3 副本

一个 1MB 的对象，在三台不同地方的机器上各放一份完整副本：

```journey
- tag: 副本 1
  tone: blue
  name: 机器 A · 北京机房
  fields:
    - { k: 内容, v: "完整 1MB" }
    - { k: 状态, v: 随时可读, tone: ok }
  note: 三份副本分布在不同机器、不同机房。
- tag: 副本 2
  tone: violet
  name: 机器 B · 北京另一机房
  fields:
    - { k: 内容, v: "完整 1MB" }
    - { k: 状态, v: 随时可读, tone: ok }
  note: A 的盘坏了 → 从 B 或 C 读，完全不受影响；系统再自动复制一份到新机器，恢复 3 副本。
- tag: 副本 3
  tone: green
  name: 机器 C · 上海机房
  fields:
    - { k: 内容, v: "完整 1MB" }
    - { k: 状态, v: 随时可读, tone: ok }
  note: 整个北京断电 → 上海这份照样能读。A、B、C 同时坏（三台不同机器同时故障）才丢数据，概率低到可以忽略。
```

实际占用 3MB —— 原始数据的 **3 倍**。这是 3 副本的代价。

### 04.3 方案二：EC 纠删码

典型方案 EC(4,2)：4 个数据块 + 2 个校验块。三步：

1. 把 1MB 切成 4 等份（每份 256KB）：D1、D2、D3、D4；
2. 用数学公式（类似多项式插值）算出 2 个校验块 P1、P2；
3. 6 个块分别放在 6 台不同的机器上。

```compare
first: 对比
head: [3 副本, "EC(4,2)"]
rows:
  - 存储开销: [{ text: 3 倍, tone: amber }, { text: 1.5 倍, tone: green }]
  - 可容忍故障数: [2 台机器, 2 台机器]
  - 读取速度: [{ text: 快（直接读副本）, tone: green }, { text: 稍慢（可能要拼数据块 + 反算）, tone: amber }]
  - 恢复方式: [简单（整体复制）, 较复杂（数学计算）]
  - 适用场景: [热数据、小文件, 冷数据、大文件]
  - 典型用户: [Redis、HDFS 默认, S3、Ceph]
```

对象存储通常选 EC：数据量巨大（EB 级），3 倍空间太贵；而且对象存储大多是「写一次读多次」，恢复计算的开销可以接受。

### 点坏几台机器试试

```demo
widget: ec-lab
title: 3 副本 vs EC(4,2)：同样是坏 2 台，恢复路径完全不同
actions: false
config:
  mode: replica
```

### 04.4 不可变：写一致性问题的解法

3 副本 / EC 都意味着同一个对象的数据散在多台机器上。如果允许就地修改某几个字节，系统必须把「部分修改」同步传播到所有副本，并保证过程中任何读者不会拿到半新半旧的数据 —— ==跨副本的部分写一致性问题==，代价极高、实现极复杂。

对象存储的解法是釜底抽薪：**对象一旦写入，不可修改**。要改？上传一个完整的新版本，旧的不动：

```journey
- tag: 时刻 T1
  tone: muted
  name: 旧版本在服务
  fields:
    - { k: 版本指针, v: 旧对象, tone: ok }
    - { k: 读者, v: "读到旧对象（一致）", tone: ok }
  note: 旧副本在机器 A、B、C，完全不动、不改、不碰。
- tag: 时刻 T2
  tone: amber
  name: 新版本写入中
  fields:
    - { k: 新对象, v: "正在写入 D、E、F（未写完）" }
    - { k: 版本指针, v: 旧对象, tone: ok }
  note: 写到一半的新对象**不可见** —— 指针还没切，读者仍然读到完整的旧对象。
- tag: 时刻 T3
  tone: green
  name: 指针原子切换
  fields:
    - { k: 版本指针, v: 新对象, tone: ok }
    - { k: 读者, v: "从此读到新对象（一致）" }
  note: 全程没有任何「部分修改」。旧副本可以异步清理，或留给版本控制。
```

写操作退化为「整对象 PUT（覆盖 / 新建）」：要么成功（所有副本写完才返回 200），要么失败，不存在中间态 —— 读者永远拿到完整的旧版或完整的新版，这就是==对象级的原子性==。用极简的写语义换来分布式场景下极低的一致性成本。

```callout
tone: violet
icon: 💡
text: |
  这和 git 的 blob 对象同构：git 里一个 blob 是 content-addressable、不可变的；
  你改了文件内容，git 生成一个**全新的 blob**，而不是 patch 旧的。对象存储对「对象」的处理方式完全一样。
```

## 05 · S3：一个产品如何变成事实标准

2006 年，AWS 推出 Amazon S3（Simple Storage Service），业界第一个商用云对象存储服务。它定义了一套基于 HTTP REST 的操作接口（PUT / GET / DELETE Object、ListObjectsV2、CreateBucket ……）和一套签名鉴权协议（Signature V4）。十几年下来，S3 的 API 规范从一个产品的私有接口演变为整个行业的事实标准 —— 不是因为 AWS 推了什么标准化组织，而是==用户太多、生态太厚、所有人都照着它写==。阿里云 OSS、腾讯云 COS、MinIO、Cloudflare R2、Backblaze B2 等几乎所有后来者都选择提供 S3 兼容接口。

```timeline
- when: 2006
  title: AWS S3 发布
  desc: 定义核心 API（REST + SigV4）
  tone: blue
- when: 2009~2012
  title: 阿里云 OSS、OpenStack Swift 跟进
  desc: 早期各自独立 API
  tone: muted
- when: 2014+
  title: S3 兼容成为行业共识
  desc: OSS / COS 纷纷提供 S3 兼容端点
  tone: violet
- when: 2020
  title: S3 宣布强一致性读
  desc: "12 月 1 日起，PUT 后立即 GET / LIST 一定看到最新数据（此前 list-after-write 是最终一致的）"
  tone: green
- when: 2022
  title: Cloudflare R2 入场
  desc: 「零出网流量费 + S3 兼容」
  tone: amber
```

这里的关键认知：

```callout
tone: blue
icon: 🔌
quote: true
text: |
  S3 API 之于对象存储，相当于 HTTP 之于 Web 服务 —— 协议一旦成为标准，实现可以百花齐放，而客户端代码几乎不变。
```

具体来说：用 AWS SDK 写的上传代码，只要把 endpoint 从 `s3.amazonaws.com` 换成 OSS 的 S3 兼容端点或 MinIO 地址，代码可以不改一行就跑通。这意味着**降低锁定风险**（迁移时应用层几乎不动）和**生态复用**（rclone、Terraform S3 backend、各种备份工具自动适用于所有兼容实现）。

但要注意：==兼容 ≠ 100% 对齐==。OSS 与 S3 在 ACL 粒度、存储类型命名、某些 header 行为、请求风格（path-style vs virtual-hosted）上存在差异；S3 Select、Object Lambda、Intelligent-Tiering 等高级特性往往是 AWS 专有。选型时要验证你实际用到的接口子集是否被目标厂商覆盖。

```compare
first: 维度
head: [AWS S3, 阿里云 OSS, 腾讯云 COS, MinIO（自建）, Cloudflare R2]
rows:
  - 定位: [行业标杆，功能最全, 国内生态最深, 国内第二，绑定腾讯系, 私有化 / 混合云, 低成本 / 零出网费]
  - S3 兼容度: [100%（自己就是）, 高（主流接口全覆盖，细节有差异）, 高, 极高（目标就是 S3 替代）, 高（核心接口全覆盖）]
  - 出网流量费: [{ text: 较高, tone: amber }, 中, 中, { text: 自建无流量费, tone: green }, { text: 免费（卖点）, tone: green }]
  - 生态绑定: [AWS 全家桶, 阿里云全家桶, 腾讯云全家桶, K8s / 自建设施, Cloudflare Workers]
  - 适用人群: [全球化业务 / 已在 AWS, 国内业务 / 已在阿里云, 国内 / 已在腾讯云, 合规 / 私有化 / 成本敏感, 出网流量大 / 边缘优先]
```

**选型判据一句话**：先看你已在哪朵云（生态绑定成本远高于 API 差异），再看流量账单（出网费往往比存储费贵一个量级），最后看是否有私有化合规要求。

迁移成本的关键不在代码 —— S3 兼容意味着客户端改个 endpoint 就行。真正的成本在于：**(1) 数据搬运量**（PB 级数据跨厂商传输要数天到数周）和 **(2) 搬运过程中的出网流量费**。所以选型时最重要的不是「哪家便宜 1 分钱」，而是==选错后搬家要花多少==。

## 06 · 访问与鉴权：从明文密钥到预签名 URL

### 06.1 它就是一个 HTTP 服务

对象存储的接口就是 `Map<key, object>` 上的 CRUD，暴露给外部世界的形态是一套标准 HTTP REST API：

```compare
first: HTTP 动词
head: [对象操作, 语义]
rows:
  - PUT: [PutObject, 上传 / 覆盖对象]
  - GET: [GetObject, 下载对象]
  - HEAD: [HeadObject, 取元数据（不下载 body）]
  - "GET + ?list-type=2": [ListObjectsV2, 列举 key（带分页）]
  - DELETE: [DeleteObject, 删除对象]
```

对前端工程师来说，这意味着对象存储==就是你每天在调的 HTTP 资源接口==—— 用 fetch 就能操作：

```js
// 方式一：直接用 fetch 下载一个公开对象（无鉴权）
const res = await fetch('https://my-bucket.s3.amazonaws.com/photos/a.jpg');
const blob = await res.blob();
// 这和调任何 REST API 完全一样 —— 因为它本来就是

// 方式二：等价的 SDK 调用
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
const client = new S3Client({ region: 'us-east-1' });
const { Body } = await client.send(new GetObjectCommand({
  Bucket: 'my-bucket', Key: 'photos/a.jpg',
}));
// SDK 帮你做了：签名计算、重试、流式读取、错误解析
// 底层依然是一个 GET https://my-bucket.s3.us-east-1.amazonaws.com/photos/a.jpg
```

SDK 只是在 HTTP 请求之上做了两件事：帮你算请求签名（见下一节），封装分片上传 / 重试 / 流控等运维逻辑。

### 06.2 鉴权演进链：每一步堵什么漏洞

既然是 HTTP 服务，怎么防止任何人都能读写你的数据？从朴素到正确，是一条清晰的演进链：

```journey
- tag: 方案一
  tone: red
  name: AK/SK 明文放进请求
  badge: 否决
  badgeTone: red
  fields:
    - { k: 做法, v: "请求里带上 AccessKey + SecretKey，服务端查表验证" }
    - { k: 缺陷 1, v: "前端代码 / APK 里内嵌 SK？反编译一下就全拿到", tone: warn }
    - { k: 缺陷 2, v: "SK 泄露 = 对方拥有全部权限，能删光整个 bucket", tone: warn }
    - { k: 缺陷 3, v: "无法限定「只许上传某个 key」「5 分钟有效」", tone: warn }
  note: 密钥绝不能出现在请求的明文中。
- tag: 方案二
  tone: blue
  name: 请求签名（Signature V4）
  fields:
    - { k: 做法, v: "用 SK 对「方法 + URL + headers + 时间戳 + payload hash」做 HMAC-SHA256" }
    - { k: 传输, v: "只传签名结果 + AK（公钥，可暴露）" }
    - { k: 堵住, v: "SK 不上网；请求被篡改则签名不匹配；带时间戳，过期自动失效", tone: ok }
  note: 证明你持有密钥，但不暴露密钥 —— 和 HMAC 的设计哲学一致。服务端用同一个 SK 重算一遍比对即可。
- tag: 方案三
  tone: violet
  name: STS 临时凭证
  fields:
    - { k: 做法, v: "后端向 STS 申请「短时效 + 最小权限」的临时 AK/SK/Token" }
    - { k: 时效, v: "15 分钟到 1 小时" }
    - { k: 权限, v: "可限定为「只能 PUT 到 uploads/user-123/*」", tone: ok }
  note: 前端 / 移动端不应持有任何长期密钥。被截获也只能在有限时间内对有限路径做有限操作。
- tag: 方案四
  tone: green
  name: 预签名 URL（Presigned URL）
  fields:
    - { k: 做法, v: "后端提前对一个「指定操作 + 指定 key + 指定时效」的请求签好名，编码进 URL query" }
    - { k: 前端, v: "拿着 URL 直接 PUT，零签名逻辑、零 SDK 依赖", tone: ok }
  note: 签发后在时效内任何拿到它的人都能用 —— 控制时效（建议不超过 15 分钟）和传输通道（HTTPS）。
```

这条演进链的每一步都在回答同一个问题 —— ==如何让最不可信的端（浏览器 / 移动端）也能安全地直接操作对象存储==。答案是：密钥永远不出后端，前端只拿短命、受限的临时凭证。

### 06.3 STS 直传的完整时序

```seq
grid: true
participants:
  - { id: fe, label: 前端, kind: frontend, tone: blue }
  - { id: be, label: 业务后端, kind: backend, tone: violet }
  - { id: sts, label: STS, kind: security, tone: amber }
  - { id: oss, label: 对象存储, kind: database, tone: green }
messages:
  - { from: fe, to: be, label: "① 登录（账号密码 / OAuth）", kind: sync, note: 1 }
  - { from: be, to: be, label: 验证用户身份（你自己的业务逻辑）, kind: self }
  - { from: fe, to: be, label: "③ 请求上传凭证（带登录 token）", kind: sync, note: 3 }
  - { from: be, to: sts, label: "④ 用后端永久 AK/SK 申请临时凭证（限定权限 + 时效）", kind: sync, note: 4 }
  - { from: sts, to: be, label: "⑤ 临时 AK + SK + Token（15 分钟）", kind: reply, note: 5 }
  - { from: be, to: fe, label: "⑥ 下发临时凭证", kind: reply, note: 6 }
  - { from: fe, to: oss, label: "⑦ 用临时凭证签名，直传 PUT", kind: sync, note: 7 }
  - { from: oss, to: fe, label: "200 OK", kind: reply, note: 8 }
```

一个高频疑问值得钉在这里：**用 STS 是不是就不用做登录验证了？** 分两层：

- STS 本身的调用==不需要==用户登录验证 —— 它只认「调用者的 AK/SK 有没有权限」。你的后端用永久密钥调 STS，STS 验证的是**后端**身份，它根本不知道最终用户是谁；
- 但你的后端在调 STS 之前==应该自己验证用户身份==。因为要回答「这是 user-123 还是 user-456」，才能构造「只能写 `uploads/user-123/*`」这样的最小权限。不验证的话，任何人都能冒充 user-123 拿到他的上传权限，往你桶里传垃圾或覆盖他的文件。

例外确实存在但很少见：匿名上传（如反馈表单附件）可以跳过身份验证，但权限要收到极严（只能 PUT、只能写 `anonymous/`、限文件大小、按 IP 限频、时效压到最短）。

### 06.4 预签名 URL：把一次性授权塞进一个 URL

STS 路径能让前端直传，但前端要集成 SDK 来算签名。有没有更简单的方式 —— 给前端一个 URL，它拿着直接 PUT，不需要任何签名逻辑？这就是 Presigned URL：

```spec
title: 一个预签名 PUT URL 的解剖
subtitle: "签名参数全部在 query string 里"
tone: green
rows:
  - k: URL 本体
    code: |
      https://my-bucket.s3.amazonaws.com/uploads/file-xyz.mp4
        ?X-Amz-Algorithm=AWS4-HMAC-SHA256
        &X-Amz-Credential=AKID.../20260812/us-east-1/s3/aws4_request
        &X-Amz-Date=20260812T100000Z
        &X-Amz-Expires=900          <- 15 分钟后失效
        &X-Amz-SignedHeaders=host
        &X-Amz-Signature=a3b8f...   <- 预计算好的签名
  - k: 后端只做一件事
    code: |
      const url = await getSignedUrl(client, new PutObjectCommand({
        Bucket: 'my-bucket',
        Key: `uploads/${userId}/${fileId}.mp4`,
        ContentType: 'video/mp4',
      }), { expiresIn: 900 });
      // 返回给前端即可
  - k: 前端只做一件事
    code: |
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: file,
      });
      // 不 import 任何 SDK、不接触任何密钥
```

它解决的核心痛点：大文件上传如果走「前端 → 后端 → 对象存储」，后端要承受全部上行带宽和内存压力。预签名 URL 让前端==绕开后端直传==，后端只做轻量的「签发 URL」：

```compare
first: 对比
head: [传统中转（后端扛流量）, 预签名直传]
rows:
  - 文件流经过谁: [浏览器 → 后端 → 对象存储, 浏览器 → 对象存储（后端零流量）]
  - 后端压力: [{ text: 承受全部上行带宽 + 内存, tone: red }, { text: 只做签发，毫秒级轻请求, tone: green }]
  - 上传通道: [多一跳，慢, 直连对象存储]
  - 完成通知: [后端天然知道传完了, 需要对象存储回调（可选配置）]
  - 限制手段: [后端代码随便写, 时效 / key / Content-Type 锁在签名里；限大小要配 POST Policy 的 content-length-range]
```

注意事项：URL 一旦签发，时效内任何拿到它的人都能用；签名里锁定了 key 和 Content-Type，前端不能用这个 URL 传到别的路径。

### 06.5 权限模型：ACL / Bucket Policy / IAM 三层叠加

```cards
cols: 3
items:
  - title: ACL（已过时倾向）
    desc: 最早期的机制，直接附着在 Bucket 或 Object 上，粒度很粗（private / public-read / public-read-write 几种预设）。AWS 自 2023 年起对新建桶默认关闭 ACL（BucketOwnerEnforced），保留只为向后兼容
    tone: amber
  - title: Bucket Policy（主力）
    desc: 基于 JSON 声明的桶级策略：Effect（Allow/Deny）+ Principal（谁）+ Action（什么操作）+ Resource（哪些 key）+ Condition（附加条件）。能表达「允许某 IP 段 GET public/ 前缀」「拒绝一切非 HTTPS」
    tone: green
  - title: IAM（身份维度）
    desc: 账号 / 角色维度的权限，附着在「调用者身份」上而不是桶上。比如给某个角色授权「只能访问 bucket-A 的 logs/* 前缀」
    tone: blue
```

三层叠加时谁说了算？判定流程是一条固定顺序的链：

```flow
grid: true
legend: false
groups:
  - { id: judge, label: "一次请求的权限判定", tone: blue }
nodes:
  - { id: req, label: 请求到达, row: 0, group: judge, tone: muted }
  - { id: iam, label: IAM 策略, sub: 有显式 Deny？, row: 1, group: judge, tone: blue }
  - { id: pol, label: Bucket Policy, sub: 有显式 Deny？, row: 2, group: judge, tone: violet }
  - { id: acl, label: "ACL（若启用）", sub: 有显式 Deny？, row: 3, group: judge, tone: amber }
  - { id: allow, label: 三层中任一有 Allow？, row: 4, group: judge, tone: muted }
  - { id: ok, label: "200 放行", row: 5, tone: green }
  - { id: no, label: "403 拒绝（默认拒绝）", row: 5, tone: red }
edges:
  - { from: req, to: iam }
  - { from: iam, to: pol, label: No }
  - { from: pol, to: acl, label: No }
  - { from: acl, to: allow, label: No }
  - { from: allow, to: ok, label: 有, labelDy: 14 }
  - { from: allow, to: no, label: 没有, labelDy: 14 }
```

图里没画出来的那条规则用文字钉死：==显式 Deny 优先于一切 Allow==——上面任何一层说 Deny，链条直接进 403，后面的 Allow 救不了它。两条原则合起来：

```callout
tone: green
icon: ✅
text: |
  ++默认私有（没有任何 Allow 也拒绝）：忘了配不会泄露数据，配错了才会。++
  ++新项目直接关闭 ACL，用 Bucket Policy + IAM 管权限；ACL 只在极少数遗留场景才需要。++
```

## 07 · 场景一：静态资源托管 + CDN 回源

把前端构建产物直接放进 Bucket、CDN 配置回源，是前端工程师最常碰的对象存储用法。先看整体：

```arch
svg: oss-web-hosting
caption: 蓝色的读路径、紫色的发版路径、虚线的是控制面。对象存储当源站，CDN 当全球缓存层，业务后端只碰「签发凭证」这种轻活。
anchors:
  - { part: users, label: 我想搞清「用户怎么拿到资源」 }
  - { part: ci, label: 我想搞清「代码怎么发出去」 }
tours:
  - id: read
    label: 一次静态资源请求
    steps:
      - { at: [users, cdn], text: "浏览器请求 cdn.example.com，DNS 把它解析到==最近的边缘节点==。" }
      - { at: [cdn], text: "节点查本地缓存：命中直接返回（毫秒级），==根本不碰源站==。" }
      - { at: [cdn, bucket], text: "未命中才回源到 Bucket —— 对象存储检查 Bucket Policy 放行 GET，按 key 读出对象返回。" }
      - { at: [users, bucket], text: "用户上传则是另一条路：凭预签名 URL ==直连 Bucket==，不经过后端。" }
  - id: deploy
    label: 一次发版
    steps:
      - { at: [ci, bucket], text: "CI 用永久 AK/SK 把构建产物传上桶 —— 注意顺序：==先传带 hash 的 JS/CSS，最后传 index.html==（后文细说）。" }
      - { at: [ci], text: "传完刷新 CDN 的 index.html 缓存。" }
      - { at: [cdn, bucket], text: "下一个用户请求到来时，节点缓存已失效，回源拿到新页面。" }
```

### 07.1 构建产物为什么天生适合对象存储

`npm run build` 产出的 dist/ 有一组特点，和对象存储的设计哲学严丝合缝：

```raw
<div class="oss-dist">
  <div class="oss-dist-code">
<pre>dist/
├── index.html          <span>入口页面</span>
├── css/
│   ├── app.3f2a1b.css  <span>带 hash</span>
│   └── vendor.8c4d2e.css
├── js/
│   ├── app.7b3e9f.js   <span>业务逻辑 · 带 hash</span>
│   ├── vendor.2a4c8d.js<span>第三方库</span>
│   └── chunk-login.1f5a3b.js <span>按需加载块</span>
├── images/logo.png · banner.webp
└── fonts/iconfont.woff2</pre>
  </div>
  <div class="oss-dist-points">
    <div class="oss-pt tone-blue"><b>纯静态</b><span>不需要服务器「运行」，原样返回给浏览器就行</span></div>
    <div class="oss-pt tone-green"><b>不变性</b><span>同一个 hash 对应同一个内容 —— app.7b3e9f.js 的内容永远不变</span></div>
    <div class="oss-pt tone-violet"><b>读多写少</b><span>千万用户读，只有发版时才写</span></div>
    <div class="oss-pt tone-amber"><b>适合缓存</b><span>内容不变，可以缓存很久</span></div>
  </div>
</div>
```

==完美契合「写一次，读无数次，不修改」。== 对比传统做法 —— 自己的 Nginx 服务器扛静态资源：带宽压力全在一台机器、距离远的用户延迟 300ms+、服务器挂了网站全挂、要自己运维证书 / 扩容 / 防 DDoS、热点事件流量突增扛不住。换成对象存储 + CDN：几百上千个边缘节点分散全球、就近访问延迟通常 < 50ms、带宽由 CDN 承担、不需要运维服务器、自动扩容扛任意流量，桶本身还有 11 个 9（99.999999999%）的持久性宣称。

### 07.2 初始配置：五步

```lane-stack
- badge: STEP 1
  title: 创建 Bucket
  desc: 名称全局唯一（像域名）；区域选离主要用户近的
  tone: muted
  nodes:
    - { title: my-website-bucket, sub: "区域：华东", tag: 控制台 / API }
- badge: STEP 2
  title: 开启「静态网站托管」
  desc: 让桶表现得像一个 web 服务器
  tone: blue
  nodes:
    - { title: "访问 / → 返回 index.html", sub: "默认首页" }
    - { title: "访问 /about → 先找 about，没有就找 about.html", sub: "SPA 场景：所有路径回落到 index.html" }
    - { title: 404 时返回配置的 404.html, sub: 错误文档 }
- badge: STEP 3
  title: 设置公共读
  desc: Bucket Policy 只给读
  tone: violet
  nodes:
    - { title: "Principal: * + Action: s3:GetObject", sub: "全世界能读；没给 Put/Delete，别人不能改不能删", tag: "arn:...:bucket/*" }
- badge: STEP 4
  title: 配置 CDN
  desc: 加速域名指向源站
  tone: amber
  nodes:
    - { title: "源站：my-website-bucket.oss-...aliyuncs.com", sub: "回源协议 HTTPS" }
    - { title: "缓存规则：*.html 不缓存/60s · *.js/*.css 缓存 1 年 · 图片 30 天", sub: 依据文件名是否带 hash }
- badge: STEP 5
  title: 配 DNS
  desc: CNAME 指到 CDN 厂商给的地址
  tone: green
  nodes:
    - { title: "cdn.example.com → cdn.example.com.w.cdnhwc1.com", sub: "用户访问域名时 DNS 自动指向最近的 CDN 节点" }
```

### 07.3 一次用户访问的完整链路

```seq
grid: true
participants:
  - { id: br, label: 浏览器, kind: frontend, tone: blue }
  - { id: dns, label: DNS, kind: external, tone: muted }
  - { id: edge, label: CDN 边缘节点, kind: cloud, tone: amber }
  - { id: src, label: 对象存储（源站）, kind: database, tone: green }
segments:
  - { from: 1, to: 2, label: 命中缓存（5~30ms） }
  - { from: 3, to: 6, label: 未命中 → 回源（首次 500~1500ms） }
messages:
  - { from: br, to: dns, label: "cdn.example.com 的 IP？", kind: sync, note: 1 }
  - { from: dns, to: br, label: "按用户位置返回最近节点（北京→1.2.3.4，纽约→5.6.7.8）", kind: reply, note: 2 }
  - { from: br, to: edge, label: "GET /index.html", kind: sync, note: 3 }
  - { from: edge, to: src, label: "缓存失效 → 回源 GET /index.html", kind: sync, note: 4 }
  - { from: src, to: edge, label: "200 OK + body（顺带校验 Policy 放行）", kind: reply, note: 5 }
  - { from: edge, to: br, label: "返回，并缓存一份（下次不回源）", kind: reply, note: 6 }
  - { from: br, to: edge, label: "GET /js/app.7b3e9f.js（解析 HTML 后并行请求）", kind: sync, note: 7 }
  - { from: edge, to: br, label: "带 hash 的资源几乎永远命中缓存", kind: reply, note: 8 }
```

典型耗时：CDN 缓存命中全程 100~500ms；首次回源 500~1500ms；对比直接从源站读（无 CDN）的 1000~3000ms+。

### 07.4 发版时序：为什么先传 JS、最后传 index.html

```seq
grid: true
participants:
  - { id: dev, label: 开发者, kind: external, tone: muted }
  - { id: ci, label: CI 流水线, kind: backend, tone: violet }
  - { id: oss, label: 对象存储, kind: database, tone: blue }
  - { id: cdn, label: CDN, kind: cloud, tone: amber }
  - { id: user, label: 用户, kind: frontend, tone: green }
messages:
  - { from: dev, to: ci, label: "push 到 main（T0）", kind: sync, note: 1 }
  - { from: ci, to: ci, label: "npm run build → 新 hash 的 JS/CSS + 新 index.html", kind: self }
  - { from: ci, to: oss, label: "T1：先传 js/app.NEW222.js（旧 js/app.OLD111.js 不删）", kind: async, note: 3 }
  - { from: ci, to: oss, label: "T2：最后传 index.html（覆盖旧的，引用 NEW222）", kind: sync, note: 4 }
  - { from: ci, to: cdn, label: "T3：刷新 index.html 的缓存", kind: async, note: 5 }
  - { from: user, to: cdn, label: "T4：GET / → 缓存失效 → 回源拿新 index.html", kind: sync, note: 6 }
  - { from: user, to: cdn, label: "GET app.NEW222.js → 未命中 → 回源 → 返回新版本", kind: sync, note: 7 }
  - { from: ci, to: oss, label: "T5（稍后，可选）：清理 app.OLD111.js", kind: async, tone: muted, note: 8 }
```

顺序是刻意设计的（原子发布）。文件名带 hash 的含义：内容变 → hash 变 → 文件名变 → 是一个全新对象，==新 JS 传上去并不会覆盖旧 JS==。于是任何时刻用户拿到的都是一致的版本：

- 只传了 JS、还没传新 index.html：用户拿旧 HTML → 引用旧 JS → 正常工作（新 JS 在桶里躺着没人引用）；
- 新 index.html 传完：用户拿新 HTML → 引用新 JS → 正常工作（旧 JS 还在，给那些缓存了旧 HTML 的用户用）。

```callout
tone: red
icon: ⚠
text: |
  顺序反过来（先传 index.html 再传 JS）就会出现「新 HTML + 旧 JS 还没传上去」的窗口 ——
  ==用户在 T1~T2 之间打开网站，引用一个不存在的对象，404==。CI 脚本里这两步的顺序不能换。
```

### 07.5 Content-Type：不设就「下载一坨乱码」

对象存储不像 Nginx 会根据扩展名自动判断类型。上传时不设置 Content-Type，可能默认为 `application/octet-stream`：

```checklist
tone: cross
items:
  - index.html 被标成 octet-stream → 浏览器弹出下载对话框，而不是渲染页面
  - app.css 被标成 octet-stream → 浏览器拒绝作为样式表使用，控制台报警告
  - 字体 / 图片同理 —— 用户看到的是「下载」或空白
```

++上传时明确指定：++ `ossutil cp dist/index.html oss://bucket/ --meta Content-Type:text/html`；JS → `application/javascript`，CSS → `text/css`。大多数 SDK 支持按扩展名自动推断。

### 07.6 Cache-Control：带 hash 的长缓存，不带 hash 的短缓存

```compare
first: 文件
head: [Cache-Control 设置, 原因]
rows:
  - index.html: ["no-cache 或 max-age=60", "入口文件，每次都要检查是否有新版本"]
  - "app.7b3e9f.js / app.3f2a1b.css": ["max-age=31536000, immutable（1 年）", "文件名含 hash：内容变→名字变；名字不变 = 内容不变，可以永久缓存"]
  - "logo.png（不带 hash 的图片）": ["max-age=2592000（30 天）", "图片不常变；变了就换文件名或加参数"]
```

`no-cache` 是常见误解重灾区：

```callout
tone: amber
icon: ⚠
text: |
  `no-cache` ==不是「不缓存」==，是「可以缓存，但每次使用前必须向服务器确认」：
  浏览器带 `If-None-Match: "<ETag>"` 去问，没变 → 304 Not Modified（不传内容，很快）；变了 → 200 + 新内容。
  ++「完全不缓存」是 `no-store`。++ `immutable` 则告诉浏览器「这个 URL 的内容永远不会变，连协商缓存都不用做」，彻底消除请求。
```

两种文件的一次请求走下来，差别是数量级的：

```demo
widget: stepper
title: 同样是第二次访问，index.html 和 app.js 的请求路径
actions: false
config:
  steps:
    - label: "index.html（no-cache）"
      code: "GET /index.html\nIf-None-Match: \"a1b2c3d4\""
      note: 入口文件每次都要问一嘴
    - label: 服务器对比 ETag
      code: "没变 → 304 Not Modified\n（响应只有 header，没有 body）"
      note: 小但不是零 —— 每个访问者每次进站都要发这一次
    - label: "app.7b3e9f.js（max-age=1年, immutable）"
      code: "不发请求。\n直接用本地缓存的副本。"
      note: immutable 让浏览器连「要不要问」都不问 —— 命中即零流量
    - label: 结论
      code: "入口：每进站一次 → 1 个 304\n静态资源：→ 0 个请求"
      note: 这就是「带 hash 长缓存 + 入口短缓存」这套组合的意义
```

### 07.7 CORS：哪些场景真的需要

你的网站在 `www.example.com`，资源在 `cdn.example.com` —— 跨源了，但不是所有跨源都报错：

```compare
first: 场景
head: [需要 CORS 吗, 为什么]
rows:
  - "&lt;script src=\"https://cdn.../app.js\"&gt;": [{ text: 不需要, tone: green }, "script 标签不受同源策略限制"]
  - "&lt;img src=\"https://cdn.../logo.png\"&gt;": [{ text: 不需要, tone: green }, "img 标签同样豁免"]
  - "CSS 里 @font-face 引跨域字体": [{ text: 需要, tone: red }, "字体文件受同源策略限制"]
  - "fetch / XHR 拉 JSON": [{ text: 需要, tone: red }, "XHR / fetch 受同源策略限制"]
  - "&lt;canvas&gt; 画跨域图片后想导出": [{ text: 需要, tone: red }, "不配 CORS 画布会被「污染」，toDataURL 抛异常"]
```

CORS 规则配在**对象存储的 Bucket 上**（CDN 要把源站返回的 CORS 头原样透传给浏览器，否则浏览器照样报跨域）：

```json
{
  "AllowedOrigins":  ["https://www.example.com"],
  "AllowedMethods":  ["GET", "HEAD"],
  "AllowedHeaders":  ["*"],
  "ExposeHeaders":   ["ETag", "Content-Length"],
  "MaxAgeSeconds":   86400
}
```

### 07.8 这套架构里谁有什么权限

```compare
first: 谁
head: [做什么, 需要什么权限, 怎么获得]
rows:
  - CI 流水线: [上传构建产物 / 删除旧文件, "PutObject · DeleteObject", "永久 AK/SK，存在 CI 密钥库（GitHub Secrets 等）"]
  - CDN 回源: [从桶读文件, GetObject, "两种方式：桶设公共读，或回源鉴权（CDN 持专用签名密钥）"]
  - 用户浏览器: [从 CDN 获取资源（不直接访问桶）, { text: 无需任何权限, tone: green }, "CDN 直接返回 —— 这就是你打开任何网站从不需要「登录对象存储」的原因"]
  - 运维人员: [管理桶配置（CORS / 生命周期等）, Full Control, 控制台 / IAM 角色]
  - CDN 管理: [刷新 / 预热缓存, CDN 相关权限, "单独的 AK/SK 或 IAM 角色（如 RefreshObjectCaches）"]
```

公共读 vs 回源鉴权怎么选：

```compare
first: 方案
head: [优点, 缺点与缓解]
rows:
  - "A：桶设公共读（简单，常见）": ["配置简单", "知道桶地址的人可绕过 CDN 直连源站 → 高额流量费。++配 Referer 防盗链缓解：只放行来自你域名的请求++"]
  - "B：桶私有 + CDN 回源鉴权（更安全）": ["即使知道桶地址也访问不了，只有经 CDN 才能拿到内容", "配置稍复杂"]
```

费用结构上：存储费极便宜（构建产物通常 < 50MB）；对象存储请求费很少（CDN 缓存后极少回源；S3 标准 GET 约 $0.0004/千次，示意价）；==大头是 CDN 流量费==（约 0.1~0.3 元/GB，示意价）。对比自建服务器（最低配 ECS 约 50 元/月起 + 带宽费），中小网站用对象存储 + CDN 通常更便宜。

## 08 · 场景二三：冷热分层、生命周期规则与备份归档

### 08.1 数据有温度

日志、数据库备份、历史合规数据这类「写完就不怎么读」的数据，占的空间往往比热数据大得多。按访问频率给数据定温度：

```cards
cols: 4
items:
  - title: 热数据
    desc: 今天的日志、活跃用户头像、最近订单。频繁读写、要求低延迟。占比通常只有 10%~20%
    tone: red
  - title: 温数据
    desc: 上个月的日志、30 天前的订单详情。偶尔读、可接受稍高延迟。约 20%~30%
    tone: amber
  - title: 冷数据
    desc: 半年前的日志、历史备份。几乎不读但法规要求保留。约 50%~70%
    tone: blue
  - title: 冰冻数据
    desc: 三年前的合规记录、审计留痕、诉讼证据。可能永远不会读，但万一要必须取得出来
    tone: muted
```

核心矛盾：热数据需要快速存储（贵），冷数据只是占空间 —— 还用贵的存储就是浪费钱，但又不能删（法规 / 业务要求保留）。解法是==分层存储：不同温度的数据放不同价格的存储里==。

### 08.2 存储类型：越便宜的，取回越慢、取回费越贵

```compare
first: 存储类型
head: [存储费（示意价）, 读取延迟, 取回的代价, 适合]
rows:
  - 标准存储: ["¥0.12/GB/月", 毫秒级, 无取回费, 频繁访问]
  - 低频访问（IA）: ["¥0.08/GB/月（省 33%）", 毫秒级（和标准一样快）, "读时有取回费；最小计费对象 128KB；最短存 30 天", 偶尔访问]
  - 归档（Archive）: ["¥0.033/GB/月（省 72%）", "不能直接读！要先「解冻」", "解冻要等 1 分钟~12 小时（分三档，见 08.5）", 几乎不读]
  - 深度归档: ["¥0.01/GB/月（省 92%）", 解冻更久，解冻费更高, 很少取用, 合规留存]
```

（价格为 AWS S3 各档的示意量级，各厂商各区域有差异。）这是一道「存储成本 vs 取回成本」的权衡题，类比很直观：标准存储 = 办公桌上的文件夹（随手可取，桌子贵）；低频 = 办公室柜子（走几步，柜子便宜些）；归档 = 公司仓库的箱子（要等快递送来，租金便宜）；深度归档 = 外包档案库（要预约，几天后拿到，租金极便宜）。

### 08.3 版本控制开关：同一份覆盖，两种命运

桶级配置里的「版本控制」值得单独展开，因为它改变的是每一次 PUT / DELETE 的语义：

```journey
- tag: 关闭（默认）
  tone: red
  name: 只有「当前态」，没有历史
  fields:
    - { k: "PUT cat.jpg（版本 A）", v: 存入, tone: ok }
    - { k: "PUT cat.jpg（版本 B）", v: "A 被覆盖，永久丢失", tone: warn }
    - { k: "DELETE cat.jpg", v: "永久删除，无法恢复", tone: warn }
  note: 时间线上只有一格：B（A 消失）→ 删除（B 消失）。
- tag: 开启
  tone: green
  name: 每个 key 一条版本链
  fields:
    - { k: v001, v: "版本 A 的完整数据（旧版本）" }
    - { k: v002, v: "版本 B 的完整数据（旧版本）" }
    - { k: v003, v: "删除标记（最新）", tone: warn }
  note: "DELETE 不是真删，只是放一个删除标记：GET 返回 404，但 GET ?versionId=v001 还在！删掉删除标记，文件就「复活」了。"
```

四个典型场景：防误删（运维手滑 DELETE 备份 → 只是加了删除标记，删掉标记即恢复）；防覆盖（开发者 B 传错 config.json 覆盖了 A 的正确版本 → 回滚即可）；审计与合规（金融要求数据修改有记录、医疗要求病历保留历史 —— 版本控制天然满足「不可篡改历史」）；并发写保护（两个进程同时 PUT 同一个 key，两个版本都保留，事后决定用哪个）。

代价也要看清：==每个版本都是一份完整数据==。一个 1GB 文件每天更新一次、保留所有版本，30 天后存了 30GB、付 30GB 的钱。所以它通常和生命周期规则成对出现：

```callout
tone: green
icon: ✅
text: |
  ++版本控制 + 生命周期规则 = 最佳实践：++
  规则设「非当前版本（旧版本）保留 30 天后自动删除」—— 30 天内误操作都能恢复，30 天前历史自动清理。
  兼顾安全性和成本。
```

顺带钉一遍「桶级配置」的意义：这些规则设置在**桶**上而不是每个对象上。桶 = 一个容器 + 一套规则（版本控制、生命周期、权限），对桶内所有对象生效 —— 几十亿个对象遵守同一套规则，不需要逐个设置。这就是桶作为「配置的作用域」存在的意义。

### 08.4 生命周期规则：设一次，永远自动执行

生命周期规则支持四类动作：

```cards
cols: 2
items:
  - title: 转储存类型（Transition）
    desc: "「30 天后标准 → 低频」「90 天后低频 → 归档」—— 冷热分离自动化"
    tone: blue
  - title: 过期删除（Expiration）
    desc: "「365 天后自动永久删除」"
    tone: amber
  - title: 清理未完成的分片上传
    desc: "「上传了一半中断的碎片，7 天后自动清理」（AbortIncompleteMultipartUpload）"
    tone: muted
  - title: 删除过期的旧版本
    desc: "配合版本控制用：「非当前版本保留 90 天后自动删除」"
    tone: violet
```

规则按前缀匹配，一个生产环境桶可以配一组规则各管各的前缀：

```json
{
  "Rules": [
    { "ID": "日志自动降级和清理",
      "Filter": { "Prefix": "logs/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER" }
      ],
      "Expiration": { "Days": 365 } },
    { "ID": "临时文件7天后删除",
      "Filter": { "Prefix": "tmp/" },
      "Status": "Enabled",
      "Expiration": { "Days": 7 } }
  ]
}
```

云厂商的调度系统每天在后台扫描执行（通常凌晨低峰期）：对每个对象，按创建时间算出「年龄」，命中哪条规则就转储或删除。有四件事值得知道：执行不是精确到秒的（通常有 1 天误差）；转换对你透明（key 不变、元数据不变，只是底层介质从 SSD → HDD → 磁带）；不需要你的 AK/SK（系统级操作）；小于 128KB 的对象默认不会转入低频档（不够付最低计费）。

一个日志对象的完整一生：

```journey
- tag: Day 0
  tone: blue
  name: 标准存储
  fields:
    - { k: 存储费, v: "¥0.12/GB/月（示意）" }
    - { k: 读取, v: 毫秒级，随时可读, tone: ok }
  note: 运维排查今天的问题。
- tag: Day 30
  tone: violet
  name: 自动转低频
  fields:
    - { k: 存储费, v: "¥0.08/GB/月（降 33%）" }
    - { k: 读取, v: "仍是毫秒级！差别在读时收「取回费」+ 最低计费 128KB", tone: warn }
  note: 偶尔要看上个月的日志。
- tag: Day 90
  tone: muted
  name: 自动转归档
  fields:
    - { k: 存储费, v: "¥0.033/GB/月（降 72%）" }
    - { k: 读取, v: "不能直接读，要先解冻（Restore）", tone: warn }
  note: 几乎不看，除非重大事故要追溯。
- tag: Day 365
  tone: red
  name: 自动删除
  fields:
    - { k: 存储费, v: ¥0 }
    - { k: 状态, v: 对象永久删除，空间释放 }
  note: 如果开了版本控制，会变成「删除标记」，对象仍可恢复。
```

没有生命周期规则的世界：数据只增不减、存储费用无限增长、热冷数据混在最贵的存储里、要写脚本定期扫描删除。有规则的世界：设一次永远自动执行，成本通常能降 60%~80%（评论里给的量级）。

### 08.5 解冻：归档数据怎么取回

场景：一年后要查某个已经归档的日志。五步走完：

```demo
widget: stepper
title: logs/2026/08/17/app.log.gz 的解冻取回
actions: false
config:
  steps:
    - label: 直接下载 → 失败
      code: "ossutil cp oss://bucket/logs/2026/08/17/app.log.gz ./\nError: InvalidObjectState\n\"Object is in ARCHIVE storage. Please restore it first.\""
      note: 归档状态的对象不能直接读 —— 它可能躺在离线磁带库或高密度 HDD 上
    - label: 发起解冻（Restore）
      code: "ossutil restore --type Standard \\\n  oss://bucket/logs/2026/08/17/app.log.gz\n（days=3：解冻后保持可读 3 天）"
      note: 返回 202 Accepted —— 异步开始处理
    - label: 等待（后台在干什么）
      code: "机械臂取磁带 → 读数据\n→ 复制到在线存储（SSD/HDD）\n→ 标记「已解冻」"
      note: "现代实现多是「从低性能高密度介质解压复制到高性能层」；可轮询 x-oss-restore: ongoing-request"
    - label: 解冻完成 → 正常下载
      code: "ossutil cp oss://bucket/logs/...app.log.gz ./\n成功 ✓"
      note: 这 3 天内它就是普通对象
    - label: 3 天后自动回档
      code: "对象自动回到「归档」状态\n再读要重新解冻"
      note: 「已解冻」= 数据复制进了在线存储、占着高性能空间 —— 不能让它永远占着
```

解冻分三档速度（S3 Glacier Flexible Retrieval，示意）：

```compare
first: 档位
head: [时长, 费用, 适合]
rows:
  - "Expedited（快速）": ["1~5 分钟", { text: 最贵, tone: red }, 紧急事故排查]
  - "Standard（标准）": ["3~5 小时", 中等, 大多数「想起来要看」的场景]
  - "Bulk（批量）": ["5~12 小时", { text: 最便宜, tone: green }, 大批量演练 / 不着急的追溯]
```

### 08.6 合规三件套：不许删、不许改、异地有

某些场景下数据不仅要保留，还要保证不被任何人动：

```cards
cols: 3
items:
  - title: 对象锁定（Object Lock / WORM）
    body: |
      Write Once Read Many —— 写入后不可改、不可删。COMPLIANCE 模式下==连 root 都不能删==、不能缩短保留期（可延长）。
      用于金融交易流水、医疗病历、审计日志。防「离职员工删库跑路」。
    tone: red
  - title: 版本控制
    body: |
      覆盖 / 删除都留旧版本，可恢复任意历史。防误操作的第一道防线（08.3 已展开）。
    tone: blue
  - title: 跨区域复制（CRR）
    body: |
      桶 A（北京）的数据自动同步到桶 B（上海）。容灾（机房炸了另一区还有）+ 合规（法规要求异地备份）。
    tone: green
```

### 08.7 备份：全量和增量为什么缺一不可

先分清两种备份：

```cards
cols: 2
items:
  - title: 全量备份（Full Backup）
    body: |
      把数据库里**所有数据**完整导出一份 —— 给整个房间拍一张完整照片。
      产物：一个完整的 `.sql.gz`（比如 5GB）；耗时：长（扫所有表）；体积：大。
    tone: blue
  - title: 增量备份（Incremental）
    body: |
      只记录**自上次备份以来变化的部分** —— 只拍「房间里移动过的东西」。
      产物：binlog（二进制日志，记录每条 INSERT / UPDATE / DELETE）；耗时：短；体积：小。
    tone: violet
```

只做其中一种都会出事：

```compare
first: 方案
head: [会发生什么]
rows:
  - 只做全量（每天一次）: ["凌晨 3:00 备份，下午 14:00 崩库 → 只能恢复到 3:00。==11 小时的订单 / 转账记录全没== —— 灾难性后果", { text: 最多丢 24 小时, tone: red }]
  - 只做增量（每小时）: ["binlog 记录的是「变化过程」不是「完整状态」。没有基准状态就没法重放 —— ==像只有修改记录没有原书，还原不出这本书==。且一年不补全量，恢复 = 重放 8760 个增量，几天都跑不完，任何一个文件损坏整条链断掉", { text: 没有起点无法恢复, tone: red }]
  - 全量（每天）+ 增量（每小时）: ["崩库后：恢复凌晨 3:00 的全量 → 依次重放 4:00~13:00 的增量 → 恢复到 13:00。==最多丢不到 1 小时==，恢复只需几分钟", { text: 正确方案, tone: green }]
```

组合方案的一次完整时间轴：

```timeline
- when: 03:00
  title: 全量备份
  desc: "5GB 基准状态写入桶（db-backup/full/）"
  tone: blue
- when: "04:00 ~ 13:00"
  title: 每小时一个增量
  desc: "binlog 逐小时落桶（db-backup/incr/），每个几 MB"
  tone: muted
- when: 14:00
  title: 数据库崩溃
  desc: 从这里开始抢救
  tone: red
- when: 14:05
  title: 恢复 = 全量 + 逐个重放增量
  desc: "拉回 3:00 全量 → 重放 11 个增量 → 数据回到 13:00"
  tone: green
- when: 结果
  title: 最多丢 13:00 ~ 14:00 之间的一小时
  desc: 增量越密丢得越少，全量越新恢复链越短
  tone: violet
```

==全量备份的真正作用是「缩短恢复链」==：每做一次全量，之前的增量就不再被依赖。一年只做一次全量 + 每小时增量 → 恢复要重放 8736 个文件、耗时十几小时、任一文件损坏链条断裂；每天全量 + 每小时增量 → 只依赖最近 11 个文件、几分钟恢复。频率越高恢复越快越安全，但成本越高 —— 每天一次全量是常见平衡点（恢复链最长 24 小时，成本可控）。

### 08.8 备份上桶的工程细节

三类典型数据源进桶的样子（评论里的完整脚本，摘关键动作）：

```cards
cols: 3
items:
  - title: 应用日志：cron + 轮转
    body: |
      每天凌晨压缩昨天的 access.log → `ossutil cp` 到 `logs/2026/08/17/nginx-access.log.gz`（带 Content-Type: application/gzip）→ 校验退出码，失败告警。
      服务器上的 AK/SK 对应的 IAM 策略==只允许 PutObject 到 logs/ 前缀==。
    tone: blue
  - title: 数据库备份：mysqldump + 元数据
    body: |
      `mysqldump --all-databases --single-transaction | gzip` → 计算 md5 → 上传时写进自定义元数据（`x-oss-meta-md5`、`x-oss-meta-db-version`）→ 上传后 stat 验证。
      先以标准存储上传再让生命周期降级 —— ==最近的备份随时要用来恢复，不能一上来就归档==。
    tone: violet
  - title: 50GB 大文件：分片上传
    body: |
      单次上传不可靠 → Multipart Upload：InitiateMultipartUpload 拿 upload_id → 逐片 UploadPart（每片 100MB，4 线程并行）→ CompleteMultipartUpload 合并。
      网络中断==只重传失败的分片==，不用重传整个 50GB；每片独立校验。
    tone: green
```

一个真实桶里按前缀分区的规则组（和 08.4 的 JSON 对上）：

```tree
- label: my-backup-bucket
  tone: violet
  note: 每个前缀一套生命周期规则
  children:
    - label: logs/
      note: "30 天→低频 · 90 天→归档 · 365 天→删除"
      children:
        - { label: "2026/08/17/nginx-access.log.gz", note: 今天刚传（标准） }
        - { label: "2026/07/15/nginx-access.log.gz", note: 33 天前（已自动转低频） }
        - { label: "2026/05/01/nginx-access.log.gz", note: 108 天前（已自动转归档） }
    - label: db-backup/
      note: "7 天→低频 · 60 天→归档 · 730 天→深度归档 · 不删除（合规）"
      children:
        - { label: "full/2026-08-17.sql.gz", note: 今天全量（标准） }
        - { label: "incr/2026-08-17-13.binlog", note: 小时级增量 }
    - label: archive/
      note: "上传即归档 · 5 年后→深度归档 · 永不删除"
      children:
        - { label: "contracts/2024/...", note: 用户上传的历史合同 }
```

最后一个坑，也是最贵的一个：

```callout
tone: red
icon: ⚠
text: |
  ==备份没有验证过 = 没有备份。==
  备份了 2 年，真要恢复时发现文件是坏的（上传中断不完整 / 脚本 bug 导出坏 SQL / 压缩损坏）—— 这是最经典的备份事故。
  ++每月做一次恢复演练：随机挑一个备份 → 下载（归档先解冻）→ 恢复到测试库 → 验证行数。++
```

## 09 · 选型判据与踩坑清单

### 09.1 选型判据（优先级从高到低）

```checklist
items:
  - 已有云生态 —— 业务已在阿里云，用 OSS 内网传输免流量费、与 CDN / 函数计算零摩擦；跨云反而多一层公网出口
  - 出网流量成本 —— CDN 回源量大、用户直接下载多的场景，流量费可能占总成本 60%+；R2 免出网费可能是颠覆性选项
  - 一致性要求 —— S3 已于 2020 年底升级为强一致读写，不再有「PUT 后立即 list 可能看不到」；但部分 S3 兼容实现未必跟进，选型时确认
  - 私有化 / 合规 —— 数据不出境或私有部署，MinIO 是首选
```

### 09.2 踩坑清单

```checklist
tone: warn
items:
  - 费用结构不只看存储单价 —— 请求次数费（S3 标准 GET 约 $0.0004/千次，示意价；每天几亿次就不是小数）+ 出网流量费往往才是大头。高频小文件场景请求费可能比存储费高
  - 存储分层取回有代价 —— 归档取回延迟 1 分钟~12 小时；低频有最低计费 128KB 和 30 天最短存储；提前删除照收费
  - CORS 与防盗链 —— 浏览器直传必须在桶上配 CORS 允许的 Origin 和 Method，否则预检请求直接 403；Referer 白名单防止别人盗用你的流量账单
  - 误开公开权限 —— 历史上无数次数据泄露都是桶被配成 public。坚持默认私有，公开路径走 CDN + 签名 URL
  - 上传没设 Content-Type —— 页面变下载、样式被拒载（07.5）
  - 发版顺序错了 —— 先传 index.html 后传 JS，会出现「新 HTML 引用还没上传的 JS」的 404 窗口（07.4）
  - 忘了备份验证 —— 恢复时发现备份是坏的（08.7）
```

```summary
title: 一句话总结
text: |
  对象存储是**为海量非结构化数据做了极致 trade-off 的分布式 KV**（放弃目录树、就地修改和 POSIX，换来近乎无限的横向扩展与 HTTP 直达）；
  **S3 是它的事实标准协议**（换 endpoint 即换厂商）；**鉴权的全部思路是让最不可信的端拿短命、受限的凭证**；
  **选型先看生态绑定，再看流量账单**。
```

### 可追问的钩子

想更深可以继续挖：分片上传与断点续传的实现细节、生命周期规则的状态机、跨区域复制（CRR）的一致性保证、S3 Event Notification + Lambda 的事件驱动架构、S3 Select（在存储侧做 SQL 过滤减少出网量）。

```quiz
- q: 控制台里的「文件夹」到底是什么？往「空文件夹」里放文件之前，那个文件夹存在吗？
  a: |
    不存在。底层只有扁平的 key 字符串，斜杠是普通字符。「文件夹」是 ListObjectsV2 用 Prefix + Delimiter 在查询期聚合出来的视图 —— CommonPrefixes 是「有一批 key 共享这段前缀」的即时计算结果，不是存储里的节点。想留一个「空目录」，只能创建一个 key 以 / 结尾、body 为 0 字节的占位对象。
- q: 为什么对象存储敢把「改一个字节 = 重传整个对象」做得这么狠？换个角度：它靠这个放弃了什么、换来了什么？
  a: |
    因为对象的数据以 3 副本或 EC 块形式散在多台机器上，就地修改要处理「跨副本部分写一致性」（半新半旧不可见），代价极高。改成整对象 PUT + 写完后原子切版本指针，读者永远看到完整的旧版或完整的新版 —— 对象级原子性，一致性成本极低。它放弃的是细粒度随机写，换来的是多副本下极简的写语义和无限横向扩展。
- q: 浏览器直传大文件，密钥和签名分别在哪？为什么不把 AK/SK 直接给前端？
  a: |
    永久 AK/SK 只在后端（调 STS 申请临时凭证或预签 URL）。前端拿到的要么是 15 分钟有效的临时 AK/SK/Token（配合 SDK 签名），要么是已经签好的预签名 URL（零签名逻辑）。给前端长期密钥 = 反编译即全权沦陷；临时凭证即使被截获，也只能在有限时间内对有限路径做有限操作。
- q: 发版时为什么必须「先传带 hash 的 JS/CSS，最后传 index.html」？
  a: |
    hash 文件名保证新 JS 不会覆盖旧 JS —— 先传新 JS，它只是「躺着没人引用」，旧 HTML 引用旧 JS 照常工作；最后覆盖 index.html，新 HTML 引用的新 JS 已经在了。反过来先传 HTML，就会出现「新 HTML 引用一个还没上传的对象」的 404 窗口。这是用「文件名不变 = 内容不变」做出的原子发布。
```
