> 单机程序脚下踩着七个**没写出来的假设**。它们不是靠你的代码成立的，是靠 CPU、线程、进程内存和函数调用替你保证的。
>
> 一旦拆到多台机器，==这七个假设全部失效，必须由系统显式补上==。这篇逐个拆开它们，以及业界各自的标准解法。

## 01 · 一段七行的代码，藏着七个假设

```java
while (true) {
    Order o = read();
    if (o.getAmount() <= 0) continue;
    total += o.getAmount();
    write(total);
}
```

看起来很朴素。但它默认下面这些事**已经成立**：

```compare
first: 代码里没写、但单机默认成立的假设
head: [单机里谁在保证它, 分布式里会变成什么]
rows:
  - 只有一个执行者:
      - 一个线程在跑这段循环
      - { text: 数据散在多台机器上，谁算全局值？, tone: red }
  - 内存随手可及:
      - 都在同一个进程地址空间里
      - { text: 跨机器只能走网络 —— 而网络会丢、会重、会乱序, tone: red }
  - 数据按一个顺序处理:
      - 循环天生就是顺序的
      - 多个节点同时改同一个 key，谁覆盖谁？
  - 变量更新不会冲突:
      - 单线程没有竞态这回事
      - 两个进程「读-改-写」交错，丢更新
  - 进程不出故障:
      - 挂了就整个停，不用想恢复
      - { text: 局部故障是常态，必须能精确恢复, tone: red }
  - 上下游速度差自然协调:
      - "`write()` 慢，`read()` 就自动跟着慢"
      - 中间会无限积压，直到 OOM
  - 机器数量不变:
      - 没有「扩容」这回事
      - 扩了容，历史状态还留在老机器上
```

```callout
tone: violet
icon: 🧭
tinted: true
text: |
  所以分布式带来的问题，==不是业务突然变复杂了== ——
  而是**单机环境里那些被默认保证的条件，到了多机环境必须被明确设计和实现**。

  下面七个假设逐个拆。每一节都按同样的三步走：
  **哪个假设失效了 → 会发生什么 → 业界的通用解法是什么。**
```

## 02 · 假设① 只有一个执行者 —— 数据该分给谁

单机只有一个 `total`：

```text
订单 → 同一个循环 → 同一个 total
```

分布式里，同一个变量变成了三份**互不知情**的副本：

```flow
grid: true
nodes:
  - { id: in, label: 订单流, sub: "所有人都在下", row: 0, kind: messagebus, tone: blue }
  - { id: a, label: 机器 A, sub: "totalA = 100", row: 1, tone: violet }
  - { id: b, label: 机器 B, sub: "totalB = 200", row: 1, tone: violet }
  - { id: c, label: 机器 C, sub: "totalC = 300", row: 1, tone: violet }
  - { id: out, label: 全局 total = ?", sub: "没有任何一台机器天然知道", row: 2, tone: red }
edges:
  - { from: in, to: a }
  - { from: in, to: b }
  - { from: in, to: c }
  - { from: a, to: out, dashed: true }
  - { from: b, to: out, dashed: true }
  - { from: c, to: out, dashed: true }
```

三台机器各算各的，加起来是 600 —— 但**没有一台机器知道这个数**。所以必须做选择：

```compare
first: 策略
head: [怎么做, 代价是什么]
rows:
  - 全都送到一台机器:
      - 多台机器把数据都发给同一个汇总节点
      - { text: 结果是对的，但没有并行度，汇总节点必然成瓶颈, tone: amber }
  - 局部聚合 + 二次汇总:
      - 每台先算局部值，再合并局部结果
      - 需要一个额外的聚合阶段；能用是因为 `sum` 满足结合律
  - 按 key 分区:
      - "`hash(key) % N`，让每个 key 固定由一台机器负责"
      - { text: 分布式计算的标准答案, tone: green }
```

### 但「取模」有个致命伤

按 key 分区听起来很简单，`hash(key) % N` 就够了。直到你要**扩缩容**：

```raw
<div class="keyspace">
  <div class="ks-case tone-red">
    <h5>取模分区 · hash(key) % N</h5>
    <p>节点数一变，key 的归属几乎全部重算 —— 因为对 3 取模和对 5 取模，是两个完全无关的函数。</p>
    <div class="ks-row">
      <b>N = 3</b>
      <div class="ks-bar">
        <div class="ks-seg">A</div><div class="ks-seg">B</div><div class="ks-seg">C</div>
      </div>
    </div>
    <div class="ks-row">
      <b>N = 5</b>
      <div class="ks-bar">
        <div class="ks-seg moved">A</div><div class="ks-seg moved">B</div>
        <div class="ks-seg moved">C</div><div class="ks-seg moved">D</div>
        <div class="ks-seg moved">E</div>
      </div>
    </div>
    <div class="ks-verdict"><b>3 → 5 时，约 2/3 的 key 要搬家。</b>节点越多越糟 —— N 从 10 变成 11，也有约 90% 的 key 换主人。这不只是性能问题，它意味着扩容时几乎全部状态都要跨网络迁移。</div>
  </div>

  <div class="ks-case tone-green">
    <h5>一致性哈希 · 把 key 和节点放到同一个环上</h5>
    <p>key 顺时针找到第一个节点就算归它。加一个节点，它只从「前一个节点」手里接管自己那一段。</p>
    <div class="ks-row">
      <b>N = 3</b>
      <div class="ks-bar">
        <div class="ks-seg">A</div><div class="ks-seg">B</div><div class="ks-seg">C</div>
      </div>
    </div>
    <div class="ks-row">
      <b>加一台 D</b>
      <div class="ks-bar">
        <div class="ks-seg">A</div><div class="ks-seg">B</div>
        <div class="ks-seg moved" style="--w: .6">C</div>
        <div class="ks-seg fresh" style="--w: .4">D</div>
      </div>
    </div>
    <div class="ks-verdict"><b>只有 D 接管的那一小段要搬家，其余 key 一动不动。</b>业界把这一段再切细（虚拟节点，一个物理节点管几百个虚拟节点），用来解决负载倾斜和快速恢复。Cassandra 用的就是这套。</div>
  </div>
</div>
```

```callout
tone: green
icon: ✅
text: |
  **判断一个分片方案好不好，别只看「能不能路由对」——要看扩容时要搬多少东西。**

  `hash % N` 满足前半句，输在后半句。一致性哈希的价值不在「哈希更高级」，
  而在==它保证「加一个节点，只影响一小段 key」==。
```

## 03 · 假设② 内存随手可及 —— 数据必须走网络

单机里这一句，就是一次内存读写：

```java
total += amount;   // total 就在当前进程地址空间里
```

分布式里，订单在 A，而它需要的状态在 B：

```text
订单在机器 A
user_1 的累计状态在机器 B
```

A 没法访问 B 的内存，只能发网络消息。而网络比内存**多了六种坏脾气**：

```cards
cols: 3
items:
  - { title: 会延迟, desc: 什么时候到不保证。平时 1ms，抖动起来 1s, tone: amber }
  - { title: 会丢失, desc: 发出去了，不一定会到, tone: red }
  - { title: 会重复, desc: 到了，可能到两次 —— 你没发两次，但它真的到了两次, tone: red }
  - { title: 会乱序, desc: 先发的可能后到, tone: amber }
  - { title: 会断, desc: 连接随时可能中断，而且断的时候你不知道对面收到没, tone: red }
  - { title: 无法判断, desc: 超时只说明「你等够了」，不说明对面没做, tone: violet }
```

### 最麻烦的是最后一条

```seq
grid: true
participants:
  - { id: a, label: 机器 A, sub: 订单在这里, tone: blue }
  - { id: b, label: 机器 B, sub: user_1 的 total 在这里, tone: violet }
messages:
  - { from: a, to: b, label: "total += 100", kind: sync, note: ① 发出 }
  - { from: b, to: b, label: "执行了，total = 100", kind: self, note: ② 但回包丢了 }
  - { from: a, to: a, label: 超时了：它到底做没做？, kind: self, note: ③ 不知道 }
  - { from: a, to: b, label: "重试 total += 100", kind: sync, note: ④ 重试 }
  - { from: b, to: b, label: "total = 200 —— 多算了一次", kind: self, note: ⑤ 重复了 }
```

重试可能重复累加，不重试可能漏算。**这个两难没有便宜的解法**，只能把语义摊开来选：

```compare
first: 投递语义
head: [会不会丢, 会不会重, 怎么做到]
rows:
  - 至多一次 At-most-once:
      - { text: 可能丢, tone: red }
      - { text: 不会重, tone: green }
      - 发出去就不管了。实现最省事，但会丢数据
  - 至少一次 At-least-once:
      - { text: 尽量不丢, tone: green }
      - { text: 可能重, tone: red }
      - 失败就重试。==这是绝大多数系统的默认选择==
  - 恰好一次 Exactly-once:
      - { text: 不丢, tone: green }
      - { text: 不重, tone: green }
      - 不是「一种协议」，而是「事务 + 幂等 + 去重」组合出来的效果，最贵
```

````callout
tone: red
icon: ⚠
text: |
  !!「恰好一次」不是买来的，是拼出来的 —— 而且端到端由**最弱的一环**决定。!!

  投递语义是一个三层栈：

  ```text
  Source 读进来  →  引擎内部处理  →  Sink 写出去
  ```

  引擎内部可以做到恰好一次，但你 Sink 出去如果是「调一个第三方 HTTP 接口」，
  那一环就是至少一次 —— ==整条链路的保证，等于最弱那一环==。

  Kafka 从 0.11 起有幂等生产者（`ProducerID` + 每个分区的 `SequenceNumber` 去重），
  Flink 有 `TwoPhaseCommitSinkFunction` —— 但它们都有边界：
  ==**Kafka 的恰好一次只管 Kafka-to-Kafka**==，写数据库、调接口、发短信不在保护范围内。
````

**那业界怎么补上「至少一次」的缺口**：

```checklist
items:
  - 幂等写入 —— 让「重复写一次」和「写一次」结果相同，最省心的做法
  - 去重表 / 唯一键 —— 每条消息带唯一 ID，处理前查一下，处理完记一笔
  - 事务 —— 靠外部系统的事务能力，把「写结果」和「记位点」绑成一个原子操作
  - 两阶段提交 —— 一个 checkpoint 对应一个事务：先预提交，checkpoint 成功才正式提交
```

## 04 · 假设③ 顺序执行 —— 同一秒改同一个 key

单机这个循环是顺序的，永远不会有两个线程同时执行 `total += amount`。

分布式里可以：

```seq
grid: true
participants:
  - { id: a, label: 写者 A, sub: user_1 +100, tone: blue }
  - { id: s, label: 存储, sub: user_1 的 total, tone: violet }
  - { id: b, label: 写者 B, sub: user_1 +200, tone: amber }
messages:
  - { from: a, to: s, label: 读 total, kind: sync, note: ① }
  - { from: b, to: s, label: 读 total, kind: sync, note: ② 也读 }
  - { from: s, to: b, label: "返回 0", kind: reply, note: ③ }
  - { from: s, to: a, label: "返回 0", kind: reply, note: ④ 两边都拿到旧值 }
  - { from: a, to: s, label: "写 100", kind: sync, note: ⑤ }
  - { from: b, to: s, label: "写 200", kind: sync, note: ⑥ 覆盖了 A }
  - { from: s, to: s, label: "最终 total = 200，A 的 100 丢了", kind: self, note: ⑦ }
```

这叫**丢失更新（lost update）**。正确结果应该是 300。

### 一个比「加锁」更深的洞察

第一反应是「加锁」。但先看清 ==`total += amount` 其实是三步：读、改、写==。

````callout
tone: amber
icon: 🕳
text: |
  数据库里有个反直觉的事实：**即使你加了行锁，结果仍可能是错的。**

  ```sql
  -- 这是「相对值」：不管谁先谁后，加起来都对
  UPDATE counter SET value = value + 1;

  -- 这是「绝对值」：第二个写者拿着过期的读，写回一个错的数
  UPDATE counter SET value = 101;
  ```

  ==加锁只保证「三步不被打断」，不保证「你写回的数是正确的合约」。==
  第二个写法即使严格串行执行，也会把前一个的修改抹掉。

  这是**语义问题，不是锁问题** —— 分布式里也一样：写回绝对值，谁也救不了你。
````

### 业界的三种解法

```compare
first: 解法
head: [怎么保证不冲突, 什么时候用]
rows:
  - 悲观锁:
      - 改之前先锁住（`SELECT ... FOR UPDATE`），强制串行
      - 冲突高、必须严格串行时。代价是等待和死锁风险
  - 乐观锁:
      - 写的时候校验版本号（`WHERE version = 旧值`），影响 0 行就是冲突了
      - 冲突低、重试便宜时。==注意要校验版本号而不是值 —— 否则会踩 ABA==
  - 单写者:
      - { text: 让同一个 key 永远只有一个处理者，从根上消除并发, tone: green }
      - { text: 分布式计算的标准答案, tone: green }
```

```callout
tone: green
icon: 🔑
tinted: true
text: |
  ==分布式里最优雅的解法不是「锁得更聪明」，而是「让冲突不可能发生」。==

  ```text
  hash(userId) % 并行度  →  同一个 user 的所有订单，永远落到同一个处理者
  ```

  没有并发，就不需要锁 —— 也不需要处理锁带来的一切麻烦（死锁、超时、重试风暴）。

  这就是 `keyBy`、分区、shuffle、路由这一整套机制存在的真正原因：
  ==**它们不是为了「分发」而存在，是为了「让同一个 key 只有一个主人」而存在。**==
```

## 05 · 假设④ 变量就在那儿 —— 状态得活过重启

单机里 `total` 放在 JVM 内存里，天经地义。但分布式里，一个进程随时可能：

```text
宕机 · 被容器平台杀掉 · 因为发版重启 · 机器断电 · OOM · 被调度到别的机器
```

状态只在内存里的话，`机器 A 挂掉` 就意味着 `A 负责的那些用户状态全部丢失`。所以状态必须能被存下来、并且**恢复得刚刚好**：

```journey
- tag: ① 运行时
  tone: blue
  name: 算子的状态
  badge: 只在内存里
  badgeTone: red
  fields:
    - { k: user_1, v: "1000" }
    - { k: user_2, v: "250" }
  note: 进程一挂，这一整块就没了 —— 而且==没有别人知道它原本是多少==。
  noteTone: bad

- tag: ② 拍快照
  tone: violet
  name: checkpoint
  badge: 两个东西一起存
  fields:
    - { k: 状态快照, v: "user_1 = 1000", note: 写到可靠存储, tone: ok }
    - { k: 输入位点, v: "offset = 50000", note: 我处理到哪了, tone: ok }
  note: |
    这两样**必须成对保存**。只存状态，你不知道从哪继续；
    只存位点，你不知道重新开始时累计值该是多少。

- tag: ③ 恢复
  tone: green
  name: 重启之后
  badge: 必须对得上
  fields:
    - { k: 恢复的状态, v: "user_1 = 1000" }
    - { k: 从哪继续, v: "offset = 50001", note: 正好接上, tone: ok }
  note: 状态和位点**必须来自同一次快照**。配错了，要么漏数据、要么重复算。
```

```callout
tone: blue
icon: 📌
text: |
  **「存状态」和「存位点」要当成一件事来做。**

  ```text
  状态快照：user_1 的 total = 1000
  输入位点：Kafka 已处理到 offset = 50000
  ```

  ==这两行必须来自同一个时间点。== 拿 10:00 的状态配 10:05 的位点，中间那 5 分钟的数据就永远算不进去了。
```

## 06 · 假设⑤ 进程不会挂 —— 局部故障是常态

单机只有一个进程，挂了就是「整个程序停了」，好理解也好处理。分布式是另一回事：

```text
100 台机器 · 1000 个容器 · 数万个网络连接
```

规模一上来，==局部故障不是「会不会发生」，而是「哪台机器什么时候坏」==。

最难受的是**故障发生在中间**：

```text
订单算完了  →  状态更新了  →  ✗ 进程在这里挂了  →  结果没写出去
                                    ↑
                              恢复时该怎么办？
```

```compare
first: 恢复策略
head: [会怎样]
rows:
  - 从旧位点重放:
      - { text: 可能重复写 —— 状态被加了两遍, tone: red }
  - 不重放:
      - { text: 可能丢结果 —— 这条订单永远没写出去, tone: red }
  - 去问下游收没收到:
      - { text: 下游可能也答不上来（比如它自己刚重启）, tone: amber }
```

所以容错不是一件事，是一组机制配合：

```checklist
items:
  - Checkpoint / 快照 —— 定期把状态存到可靠存储
  - Replay —— 出事后从上次的输入位点重放
  - 幂等写入 —— 让「重复写」无害，这是最实在的一道保险
  - 去重 —— 认出「这条我已经处理过了」
  - 事务 / 两阶段提交 —— 让「提交状态」和「写出结果」原子化
  - 故障检测与重启 —— 得先知道谁挂了，才谈得上恢复
```

```callout
tone: amber
icon: ⚠
text: |
  注意这份清单里，==只有第 1、2 条是「算」的事，后面全是在「写」上做文章==。

  这也解释了为什么「恰好一次」这么贵：真正的难点不在状态本身，
  而在**把状态的变化和对外部世界的写入，绑成一个不会只做一半的动作**。
```

## 07 · 假设⑥ 快慢自然协调 —— 反压

单机循环里，`write()` 慢，`read()` 自然就跟着慢 —— **这是一种天然的节流**，你什么都不用做。

分布式里，各步骤在不同进程里，谁也不知道谁的速度：

```raw
<div class="flowviz">
  <div class="fv-grid">
    <div class="fv-node tone-blue"><b>Source</b><small>10 万/秒</small></div>
    <div class="fv-arrow">→</div>
    <div class="fv-node tone-violet"><b>Filter</b><small>10 万/秒</small></div>
    <div class="fv-arrow">→</div>
    <div class="fv-node tone-violet"><b>Aggregate</b><small>10 万/秒</small></div>
    <div class="fv-arrow">→</div>
    <div class="fv-node slow"><b>Database Sink</b><small>1 万/秒</small></div>
  </div>
  <div class="fv-back"><span>反压　Sink 忙 → Aggregate 暂停发送 → Filter 减速 → Source 少拉一点</span></div>
  <div class="fv-note">
    <b>差 10 倍。</b>第 1 秒积压 9 万条，第 2 秒 18 万条，第 N 秒把内存、磁盘或者消息队列撑爆。<br>
    所以必须让下游的「慢」<b>沿数据流的反方向传回去</b> —— 这个机制叫<b>反压（backpressure）</b>。
  </div>
</div>
```

```callout
tone: blue
icon: 🧠
tinted: true
text: |
  ==一句话记住反压的本质：==

  **一条流水线的整体速度，最终由最慢的那一环决定。
  系统必须让积压可感知、可传回，而不能靠「无限缓存」把问题藏起来。**

  缓冲只能买时间，不能解决问题 —— 缓存越深，故障时炸得越响。
```

### 一个很少被讲、但很要命的细节

早年的 Flink（1.5 之前）反压是靠 TCP 自己的流控做的。它有两个坑：

```text
① 一条 TCP 连接上复用了多个 channel，
   只要其中一个 channel 被堵，整条连接上其它 channel 全被拖住 —— 队头阻塞。

② 更麻烦的是：反压一旦形成，checkpoint 的 barrier 也传不过去了。
   而 barrier 传不过去 → checkpoint 超时 → checkpoint 失败 → 触发更多重试。
   一个性能问题，滚成了一个可靠性问题。
```

1.5 之后改成了 **credit-based 流控**：下游主动告诉上游「我还有多少缓冲空间（credit）」，上游有 credit 才发数据。==这样每条 channel 独立受限，且 barrier 始终能穿过去。==

## 08 · 假设⑦ 机器数量不变 —— 状态要搬家

最后一个假设最容易被忽略，因为单机时代根本不存在「扩容」这回事。

现在假设按 `hash(userId) % 3` 分区，每台机器管着一部分用户的状态。你要把并行度从 3 改成 5：

```raw
<div class="keyspace">
  <div class="ks-case tone-amber">
    <h5>状态不是「请求」，不能只是重新分配就完事</h5>
    <p>无状态服务扩容很简单：多起两个进程，负载均衡把新请求分过去就行。</p>
    <div class="ks-row">
      <b>并行度 3</b>
      <div class="ks-bar">
        <div class="ks-seg">A · 分区 0</div><div class="ks-seg">B · 分区 1</div><div class="ks-seg">C · 分区 2</div>
      </div>
    </div>
    <div class="ks-row">
      <b>并行度 5</b>
      <div class="ks-bar">
        <div class="ks-seg moved">A</div><div class="ks-seg fresh">D</div>
        <div class="ks-seg moved">B</div>
        <div class="ks-seg fresh">E</div>
        <div class="ks-seg moved">C</div>
      </div>
    </div>
    <div class="ks-verdict"><b>但 <code>user_1</code> 的历史状态还在 A 上。</b>请求重新分配了，状态却没跟过来 —— 新接手的 D 从零开始算，结果直接算错。所以扩容必须做完整套动作：<b>存下状态 → 按新规则拆分 → 把状态搬给新实例 → 从正确的位点恢复。</b></div>
  </div>
</div>
```

### Flink 是怎么解这一题的

关键在于：**不要让「并行度」直接决定「状态的归属」。**

```text
hash(userId) % 3   ← 并行度一变，归属全变（取模的问题，第 02 节见过）

                ↓ 换一种做法

先把 key 空间切成固定份数：key group（数量 = maxParallelism）
每个并行实例负责一段连续的 key group
                     ↓
扩缩容时，只是在重新分配这些「固定的块」——
状态搬家的粒度从「一个个 key」变成了「一块块 key group」
```

```callout
tone: green
icon: 📦
text: |
  ==key group 的存在，就是为了让「改并行度」不必重算每一个 key 的哈希。==

  代价是：**key group 的数量（最大并行度）在作业第一次提交时就定死了**，
  之后改不了 —— 因为一旦改，所有历史的 key group 下标就全对不上了。

  这是分布式系统里很典型的一种权衡：==**用一个提前锁死的常量，换运行时的灵活。**==
  类似的设计你在别处也见过 —— 比如 Kafka 的分区数一旦定了就不好改。
```

## 09 · 收束：这些复杂性，被「算子」封装了

回头看：这七个问题，**没有一个跟你的业务有关**。它们全都来自「把单机程序放到多台机器上」这一件事。

```cards
cols: 2
items:
  - title: 算子替你处理的
    tag: 通用复杂性
    tone: violet
    body: |
      你只写业务逻辑：

      ```
      filter → keyBy → sum → sink
      ```

      而下面这些全部由引擎接走：

      - **并行化** —— 你说要几个实例，它去起线程
      - **分区路由** —— `keyBy` 之后，同一个 key 落到同一个实例
      - **状态管理** —— 状态怎么存、存多少、怎么换后端
      - **故障恢复** —— checkpoint + replay，不用你写
      - **反压** —— credit-based 流控，自动的
      - **状态迁移** —— 改并行度时，key group 自动重分配

    code: |
      orders
        .filter(o -> o.getAmount() > 0)
        .keyBy(Order::getUserId)
        .sum("amount")
        .sinkTo(clickHouse);
  - title: 你仍然要负责的
    tag: 不该甩锅给引擎
    tone: amber
    body: |
      引擎解决的是**通用**问题。有几件事它替不了你：

      - **幂等边界** —— Sink 写出去那一步的语义，取决于下游系统，
        引擎只能帮你到「至少一次 + 事务化写」
      - **消息 ID 生成** —— 去重表要的唯一键，得你的业务提供
      - **`keyBy` 选哪个字段** —— 选错了，热点全压在一个实例上
      - **状态大小** —— 状态会不会无限长？要不要设 TTL？
      - **下游能不能被反复写** —— 你调的那个第三方接口，幂等吗？

      ==这些是「业务语义」问题，引擎看不见，也管不了。==
```

```summary
title: 一句话总结
text: |
  单机依赖的是：**唯一状态 + 顺序执行 + 本地内存 + 不走网络 + 少量故障**。
  分布式面对的是：**多份状态 + 并行执行 + 网络通信 + 节点故障 + 动态扩缩容**。

  所以一句 `total += amount;` 在分布式里会展开成一串问题：
  这个 amount 路由到哪？这个 total 属于谁？会不会并发修改？状态可恢复吗？
  重试会不会重复？下游慢了怎么办？扩容后旧状态怎么搬？

  ==而「算子」就是把这些通用复杂性打包收走的那个抽象。==
  你表达计算逻辑，引擎负责让它在多机上正确地活下去。
```

## 自测

```quiz
- q: 为什么分布式里「加锁」不一定能解决丢失更新？
  a: |
    因为 `total += amount` 其实是**读、改、写**三步。
    加锁只保证这三步不被打断，但它保证不了「你写回的数是正确的合约」——
    如果写回的是**绝对值**（`SET value = 101`）而不是**相对值**（`value = value + 1`），
    即使严格串行执行，第二个写者也会拿着过期的读把前一个的修改抹掉。
    ==这是语义问题，不是锁问题。==
- q: 一致性哈希比 `hash(key) % N` 好在哪？为什么值钱？
  a: |
    好在**扩容时搬的东西少**。
    `hash % N` 里节点数一变，几乎所有 key 的归属都重算 —— 3 改 5 时约 2/3 的 key 换主人，
    N 从 10 变 11 也有约 90%。对「有状态」的系统来说，这意味着大半个状态都要跨网络迁移。
    一致性哈希把 key 和节点放在同一个环上，加一个节点只接管一小段，
    ==代价从「几乎全部」降到「约 1/N」。== 再加虚拟节点，就顺手解决了负载倾斜。
- q: 「恰好一次」是一套协议吗？为什么 Kafka 的 exactly-once 不能保证你写数据库也不重复？
  a: |
    不是一套协议，是**事务 + 幂等 + 去重组合出来的效果**。
    而且投递语义是一个三层栈 —— Source / 引擎 / Sink，==端到端由最弱的一环决定==。
    Kafka 从 0.11 起的幂等生产者（`ProducerID` + 每个分区的 `SequenceNumber`）
    和事务，只管 **Kafka-to-Kafka** 这一段。
    你 Sink 出去如果写的是数据库或者调第三方接口，那一环仍然是至少一次 ——
    要自己去补幂等键、去重表或者事务。
- q: 为什么「无限缓冲」不能解决上下游速度不一致？
  a: |
    缓冲只能**买时间**，不能解决问题。差 10 倍的话，积压是 9 万、18 万、27 万这样线性涨上去的，
    内存/磁盘/消息队列迟早撑爆 —— 而且缓存越深，故障时炸得越响、恢复时重放得越久。
    正确的做法是让下游的慢**沿数据流反向传回去**（反压），
    让 Source 主动少拉一点。==本质是：流水线的速度由最慢一环决定，系统必须控制积压而不是藏起积压。==
```
