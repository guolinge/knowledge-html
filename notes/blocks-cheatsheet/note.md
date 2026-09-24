# 积木速查

> 这份文件既是新建笔记的模板，也是积木语法参考。**写笔记之前先读一遍。**
> 正文用标准 Markdown，需要更强表达力时用下面的自定义围栏块（围栏内是 YAML）。

## 01 · 基本约定

- **一级标题只写在 `meta.json` 的 `title`**，正文再写一遍会被构建时剥掉。
- **`## 01 · 标题`** 会自动把 `01` 渲染成编号徽章，并生成锚点进目录。
- **`### 标题`** 进目录，作为二级项。
- 行内支持 `**粗体**`、`` `代码` ``、`[链接](url)`，以及裸 HTML（用于 `<span class="en">` 这类微调）。
- **每篇结尾必须有 `quiz`** —— 见下面第 09 节。

## 02 · lane-stack —— 分层 / 泳道流程

适合：ETL 链路、请求生命周期、系统分层、任何「一层接一层」的结构。

```lane-stack
- badge: LAYER 01
  title: 源系统层
  desc: 数据真正产生的地方
  tone: muted
  nodes:
    - { title: MySQL 订单库, sub: "orders / order_items", tag: binlog }
    - { title: 埋点日志, sub: "page_view / click", tag: Kafka, tone: blue }
  next: "抽取 :: Extract :: 把数据从业务库拿出来"

- title: 抽取层
  desc: 决定多久同步一次
  tone: blue
  group: 数仓内部：分层建模
  nodes:
    - { title: CDC 读 binlog, sub: "op = INSERT/UPDATE/DELETE", tag: 准实时 }
    - { title: 全量快照, sub: "SELECT * 整表拉取", tag: 每天一次 }
```

要点：

- `tone` 可选 `muted` / `blue` / `violet` / `green` / `amber` / `red`，控制左侧色条、`LAYER` 字样和默认标签色。
- `next` 是两层之间的连接条，格式 `"中文名 :: 英文名 :: 补充说明"`，三段都可省略。
- **相邻且 `group` 相同的层会被自动包进虚线分组框**，用来表示「这几个是一伙的」。
- `nodes[].tag` / `tone` 覆盖单个节点的标签和配色。

## 03 · journey —— 每一步的形态快照

适合：一个东西（一行数据、一个请求、一次支付）在流转过程中**长什么样**的变化。

```journey
- tag: ① 源系统
  tone: muted
  name: MySQL · orders
  badge: 只存最终状态
  badgeTone: red
  fields:
    - { k: id, v: "1001" }
    - { k: status, v: "1", note: 魔法数字, tone: warn }
    - { k: dt, v: "2024-05-20", note: 新增分区, tone: ok }
  note: 业务库只关心「现在是什么」，**没有城市、渠道**。
  noteTone: bad
  next: "CDC 订阅 binlog :: :: 只传变化的那一行，不扫全表"

- tag: ② 抽取
  tone: blue
  name: binlog event
  badge: 含 before / after
  code: |
    {"op": "UPDATE", "table": "orders"}
  note: 拿到 before / after 才知道「哪一行被删了」。
```

要点：

- `fields[].tone` 支持 `warn`（黄）和 `ok`（绿），用来标出「这里有问题」和「这里修好了」。
- `noteTone: bad` 把行首的 `→` 换成 `!`。
- `code` 会转义显示；想上色就改用 `codeHtml`（内容按原始 HTML 输出）。

## 04 · compare —— 多维对比

适合：两个及以上方案的横向对比。

```compare
first: 维度
head: [数据库, 数据仓库]
rows:
  - 主要目的: [支撑线上业务, 数据分析、报表、决策]
  - 是否直接承接用户请求:
      - { text: 是, tone: green }
      - { text: 通常不是, tone: muted }
```

要点：单元格写字符串就是普通文本，写 `{text, tone}` 就渲染成彩色标签。窄屏会自动折叠成卡片。

## 05 · cards —— 并列概念网格

适合：一堆**没有先后关系**的并列概念。用文字排会很平，卡片能一眼扫完。

```cards
cols: 3
items:
  - { title: ODS 贴源层, desc: 与业务库一一对应，只做类型转换 + 按天分区, tag: LAYER 03, tone: amber }
  - { title: DWD 明细层, desc: 一行 = 一个业务事件，字段已翻译成业务语义, tag: LAYER 04, tone: violet }
  - { title: ADS 应用层, desc: 直接给报表用的结果表，查询毫秒级, tag: LAYER 06, tone: green }
```

要点：`cols` 可选 `2` / `3` / `4`，不写则按宽度自动排。卡片还可带 `code` 字段放一小段代码。

## 06 · timeline —— 时间线 / 版本演进

适合：按时间顺序发生的事件、技术选型的演进、事故时间线。

```timeline
- when: 2020
  title: Hive on MR
  desc: 只能跑批，报表 T+1，半夜跑数
  tone: muted
- when: 2022
  title: Flink 实时数仓
  desc: 开始用 CDC 读 binlog，大盘做到分钟级
  tone: blue
- when: 2024
  title: 湖仓一体
  desc: Iceberg + Flink，批流同一份存储
  tone: violet
```

要点：`when` 会渲染成等宽小字并着色，`tone` 同时决定时间轴圆点的颜色。

## 07 · callout —— 提示 / 陷阱 / 引用

```callout
tone: amber
icon: 🧱
tinted: true
text: |
  为什么要分这么多层？因为**每一层只解决一个问题**。
  中间任何一层算错，都能回到上一层重跑。
```

要点：`quote: true` 会把正文放大加粗，用于一句话结论。`text` 里可以写多行 Markdown。

## 08 · checklist —— 正例 / 反例

```checklist
tone: cross
items:
  - 延迟高，最快也要等下一次轮询
  - 删除数据不容易准确识别
```

要点：`tone` 可选 `cross`（红叉）和 `warn`（黄叹号），不写就是绿勾。

## 09 · quiz —— 自测

**这是最容易被忽略、但最重要的一块。** 知识库死于「收藏代替理解」，
每篇笔记结尾放 2~3 题，逼自己合上答案复述一遍。

```quiz
- q: CDC 是 Flink 独有的功能吗？
  a: |
    不是。CDC 是通用技术，Flink CDC 只是 Flink 生态里的一个连接器方案。
- q: 为什么不用定时轮询？
  a: 延迟高、压业务库、漏中间状态、识别不到删除。
```

同一时刻只允许展开一题，避免一口气看完答案。

## 10 · demo —— 可交互模拟

**只在「静态图讲不清」时用。** 判据：用一句话说不清「A 和 B 差在哪」，
但让用户亲手跑一遍就秒懂。

需要两步。先在 `assets/app.js` 的 `WIDGETS` 里注册控件：

```js
WIDGETS['my-widget'] = (root) => {
  const log = root.querySelector('[data-log="main"]');   // 对应下面的 log: main
  root.querySelector('[data-run]').addEventListener('click', () => { /* ... */ });
};
```

可用钩子：`[data-log="<name>"]`、`[data-run]`、`[data-reset]`、`[data-status]`。

再在 note.md 里声明外壳：

```demo
widget: polling-vs-cdc
title: 订单表变更流
panes:
  - log: poll
    tag: 轮询
    tone: amber
    head: 定时查表
    sub: 每 10 分钟一次
    foot: [延迟高, 中间状态丢失, 删除难识别]
  - log: cdc
    tag: CDC
    tone: violet
    head: 订阅变更日志
    sub: 每条变化实时推送
    foot: [近实时, 含删除, 只读 binlog]
```

两边靠 `log` 这个 key 对接。页面只声明外壳，逻辑全在 `app.js`。

## 11 · summary / raw

```summary
title: 一句话总结
text: |
  `CDC` 负责把变化**实时通知出来**；`Flink` 负责**加工变化**。
```

`raw` 块直接输出 HTML，是一次性排版实验的逃生口，**不要长期使用** ——
它绕过了积木系统，换肤和校验都管不到它。

## 12 · 写完之后

```bash
npm run check              # 先校验。会指出第几行哪个积木有问题
npm run view -- <slug>     # 构建 + 在浏览器打开
npm run build:standalone   # 产出 dist/*.html（内联全部资源，可直接发给别人）
```

## 13 · 自测

```quiz
- q: 什么时候该用 journey 而不是 lane-stack？
  a: |
    lane-stack 描述**结构**（有哪几层、每层是什么）；
    journey 描述**变化**（同一个东西在每一步长什么样）。
    如果重点是「字段从 status=1 变成 '已支付'」，那是 journey。
- q: 什么时候该用 cards 而不是 compare？
  a: |
    compare 是**同一组维度下的横向对比**（每行一个维度，每列一个方案）。
    cards 是**一堆并列概念**，彼此之间没有共同维度可比。
- q: 为什么每页必须带 meta.json 里的 status 和 sources？
  a: |
    因为漂亮的 HTML 会自带「这应该是对的」的暗示。
    status=draft 会在页面顶部挂黄条，sources 让半年后的你能查证。
- q: 积木名拼错了会怎样？
  a: |
    围栏会静默退化成普通代码块 —— 页面看着正常，但图没了。
    所以写完一定要跑 npm run check，它会报「未知围栏语言」。
```
