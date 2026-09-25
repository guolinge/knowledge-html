# 积木 DSL 完整参考

围栏内是 **YAML**。行内支持 Markdown（`**粗体**`、`` `代码` ``）和裸 HTML。

> 可运行示例：`notes/blocks-cheatsheet/note.md`

---

## 通用：行内强调

**全文都是 `**加粗**` 时，等于没有重点** —— 术语、结论、坑长得一模一样。
所以把三个语义拆成三种颜色：

| 写法 | 语义 | 颜色 |
|---|---|---|
| `==文字==` | **关键结论** / 最该记住的一句 | 蓝 |
| `!!文字!!` | **坑 / 反直觉 / 注意** | 橙 |
| `++文字++` | **正确做法 / 推荐** | 绿 |
| `**文字**` | 句子内的重音（降级用，不再承担强调职责） | 加粗，不变色 |
| `` `文字` `` | 术语 / 标识符 | 等宽 |

```text
AND / OR 被实现成 ==对 uid 做集合运算==，而不是 SQL 的 AND / OR。

!!忘了传 dialect 不会报错，会静默按 ByteHouse 生成 SQL。!!

++新加一种数据库：实现两个接口，core 完全不用改。++
```

> **一屏之内不要超过 3 个 `==`。** 到处都是重点等于没有重点。

反引号里的内容不会被解析（`` `a == b` `` 安全），带空格的 `a == b`
和 `====` 这种空内容也不会被误判。

---

## 通用：tone 配色

所有积木的 `tone` 都取这几个值，控制色条、标签和强调色：

| tone | 用在哪 |
|---|---|
| `muted` | 中性、背景信息（默认） |
| `blue` | 主流程、当前关注点 |
| `violet` | 加工/转换环节 |
| `green` | 结果、正确做法 |
| `amber` | 注意、待优化 |
| `red` | 错误、危险、删除 |

---

## 1. `lane-stack` — 分层 / 泳道流程

**什么时候用**：一层接一层、有明确先后顺序的链路。

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
  group: 数仓内部
  nodes:
    - { title: CDC 读 binlog, sub: "op = INSERT/UPDATE/DELETE", tag: 准实时 }
```

| 键 | 说明 |
|---|---|
| `badge` | 左侧小字，如 `LAYER 01`。颜色跟随 `tone` |
| `title` / `desc` | 左侧主标题 / 说明 |
| `tone` | 层的配色，也是层内节点 `tag` 的默认色 |
| `nodes[]` | 右侧的节点。`title` 粗体，`sub` 等宽小字，`tag` 彩色标签，`tone` 可覆盖 |
| `next` | 与下一层之间的连接条，格式 `"中文 :: English :: 补充说明"`，三段都可省 |
| `group` | **相邻且相同**的层会被自动包进虚线框，表示「这几个是一伙的」 |

---

## 2. `journey` — 每一步的形态快照

**什么时候用**：一个东西（一行数据、一个请求、一次支付）在流转中**长什么样**的变化。

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
  next: "CDC 订阅 binlog :: :: 只传变化的那一行"

- tag: ② 抽取
  tone: blue
  name: binlog event
  code: |
    {"op": "UPDATE", "table": "orders"}
  note: 拿到 before / after 才知道「哪一行被删了」。
```

| 键 | 说明 |
|---|---|
| `tag` / `tone` | 左上角标签及其配色 |
| `name` | 表名 / 对象名（等宽字体） |
| `badge` / `badgeTone` | 右上角徽章 |
| `fields[]` | 字段快照。`k` 键、`v` 值、`note` 黄色小注、`tone` 取 `warn`(黄) / `ok`(绿) |
| `code` | 等宽代码块，**会转义** |
| `codeHtml` | 同上但按原始 HTML 输出（想上色时用） |
| `note` / `noteTone` | 底部说明。`noteTone: bad` 把行首 `→` 换成 `!` |
| `next` | 同 `lane-stack` |

---

## 3. `compare` — 多维对比

```compare
first: 维度
head: [数据库, 数据仓库]
rows:
  - 主要目的: [支撑线上业务, 数据分析、报表、决策]
  - 是否直接承接用户请求:
      - { text: 是, tone: green }
      - { text: 通常不是, tone: muted }
```

- `first`：第一列表头。`head`：其余列表头数组。
- `rows`：每行是**单键映射**，键是第一列，值是单元格数组。
- 单元格写字符串 → 普通文本；写 `{ text, tone }` → 彩色标签。
- 窄屏自动折叠成卡片（靠 `head` 生成 `data-label`）。

---

## 4. `cards` — 并列概念网格

**什么时候用**：一堆**没有先后关系**的并列概念，用文字排会很平。

```cards
cols: 3
items:
  - { title: ODS 贴源层, desc: 与业务库一一对应，只做类型转换, tag: LAYER 03, tone: amber }
  - { title: DWD 明细层, desc: 一行 = 一个业务事件, tag: LAYER 04, tone: violet }
  - { title: ADS 应用层, desc: 直接给报表用的结果表, tag: LAYER 06, tone: green }
```

- `cols`：`2` / `3` / `4`，不写则按宽度自动排（`auto-fit`）。
- `items[]`：`title`、`desc`、`tag`、`tone`、`code`（可选代码块）。

---

## 5. `timeline` — 时间线

```timeline
- when: 2020
  title: Hive on MR
  desc: 只能跑批，T+1
  tone: muted
- when: 2022
  title: Flink 实时数仓
  desc: 分钟级，开始用 CDC 读 binlog
  tone: blue
```

`when` 会渲染成等宽小字并着色，`tone` 同时决定时间轴圆点的颜色。

---

## 6. `flow` —— 带分支的流程图

**什么时候用**：流程有**分支或汇合**，一条直线讲不了。

> `lane-stack` 只能画直线。需要「分两路再合起来」「中途有判断」时用这个。

```flow
grid: true
legend: true
groups:
  - { id: aws, label: "AWS Region: us-east-1", tone: amber }
nodes:
  - { id: in,   label: 内部状态, sub: "{ table: 'user_portrait' }", row: 0, kind: backend, group: aws }
  - { id: id1,  label: 标识符加反引号, sub: "表名 → `表名`", row: 1, tone: amber }
  - { id: id2,  label: 值变占位符, sub: "[1,2,3] → ?", row: 1, tone: amber }
  - { id: out,  label: 一段 SQL, sub: "带反引号、值待填", row: 2, tone: green }
edges:
  - { from: in, to: id1 }
  - { from: in, to: id2 }
  - { from: id1, to: out }
  - { from: id2, to: out, anim: true }
  - { from: id2, to: id1, dashed: true, label: 备选 }
```

| 键 | 说明 |
|---|---|
| `nodes[].id` | 唯一标识，连线靠它引用 |
| `nodes[].row` | 第几行。不写就按数组顺序。**同一 row 的节点并排** |
| `nodes[].label` / `sub` | 主文字 / 等宽小字 |
| `nodes[].tone` | 节点配色 |
| `nodes[].kind` | **语义类型**，同时决定图标和配色。见下表 |
| `nodes[].group` | 归属的区域框 id |
| `nodes[].shape` | `pill`（状态机用）/ `note`（判定节点，虚线框）。不写是普通方框 |
| `nodes[].initial` | `true` 时左侧加一个实心圆点，表示初始状态 |
| `edges[].from` / `to` | 两端节点的 id |
| `edges[].label` | 连线上的小字 |
| `edges[].dashed` | 虚线（表示「可选」「备选」「弱关系」） |
| `edges[].anim` | 流动虚线动画（表示「这一步在动」「强调」） |
| `edges[].tone` | 连线配色 |
| `edges[].both` | 双向箭头 |
| `edges[].self` | 自环（`from` 和 `to` 相同也会自动识别）。状态机的「状态不变但有事件」 |
| `edges[].on` | 同 `label`。状态机里写触发条件 |

**顶层键**：

| 键 | 说明 |
|---|---|
| `groups` | 区域框声明：`[{ id, label, tone }]`。位置由 app.js 算成员节点的包围盒 |
| `grid: true` | 背景网格（给图「工程图纸」的质感，也让空白不飘） |
| `legend: true` | 按 `kind` 自动汇总图例，作者不用手写 |

**`kind` 语义类型**（有图标，配色自动）：

| kind | 图标 | 配色 | 用在哪 |
|---|---|---|---|
| `frontend` | 窗口 | 灰 | 浏览器、App |
| `backend` | `<>` | 绿 | 服务、API |
| `database` | 圆柱 | 紫 | 数据库、缓存 |
| `cloud` | 云 | 橙 | CDN、负载均衡、云服务 |
| `security` | 盾牌 | 红 | 认证、网关 |
| `messagebus` | 队列 | 橙 | MQ、异步 |
| `external` | 外链框 | 灰 | 第三方、用户 |

`tone` 显式写了会覆盖 `kind` 的默认配色。

**要点**：

- **不用写坐标。** 节点用 flex 排版，连线由 `app.js` 测量后画成 SVG 路径 ——
  文字多长、屏幕多窄都会自动重算。
- **连线走节点背后**，所以看起来是「从盒子到盒子」，不用手动算边框交点。
- 同排节点之间的连线会自动画成左右方向的曲线。

### 能力边界（重要）

`flow` 是**「测量 + 直线/贝塞尔连接」**，没有边路由引擎。所以：

| 画得好看 | 会翻车 |
|---|---|
| DAG：从上往下、有分支汇合 | 大量**交叉边**（比如「第一个节点直接连到最后一个节点」） |
| 干净的状态机（每个状态只连相邻的） | 稠密的状态机（任意两个状态都可能连） |
| 3~5 行 | 10 行以上，连线会穿过中间的节点 |

**翻车了怎么办**：

1. **拆成两张图** —— 主流程一张，异常分支一张
2. **用 `compare` 列转移表** —— 状态机的完整转移用表格表达反而更清楚
3. 别硬画。==一张挤成一团的图比没有图更糟。==

> 为什么不上 dagre / elkjs 做自动布局？因为它们 100KB~1.5MB，
> 而「单文件发人」是这个仓库的核心价值。**用体积换一点排版，不划算。**

---

## 7. `seq` —— 时序图

**什么时候用**：讲**调用链** —— 谁在什么时候调谁、等不等回复、返回什么。

> 记法依据 UML 2.5：参与者横排，**时间向下流**，消息是水平箭头。
> 核心约束是「每条消息线必须水平或向下」—— 所以不可能出现向上的箭头（回复除外）。

```seq
participants:
  - { id: c, label: 客户端, tone: blue }
  - { id: g, label: 数据网关, tone: violet }
  - { id: d, label: ByteHouse, tone: green }
messages:
  - { from: c, to: g, label: "POST /query", kind: sync, note: 1 }
  - { from: g, to: d, label: "SELECT uid FROM ...", kind: sync, note: 2 }
  - { from: d, to: g, label: 结果集, kind: reply, note: 3 }
  - { from: g, to: c, label: "200 OK", kind: reply, note: 4 }
  - { from: g, to: g, label: 重试, kind: self }
```

| 键 | 说明 |
|---|---|
| `participants[].id` | 唯一标识，消息靠它引用 |
| `participants[].label` / `sub` | 参与者名字 / 等宽小字（窄屏会隐藏 `sub`） |
| `participants[].tone` | 配色（显式写了会覆盖 `kind` 的默认色） |
| `participants[].kind` | 同 `flow` 的语义类型，带图标 |
| `messages[].from` / `to` | 两端参与者。**相同就是自调用** |
| `messages[].label` | 消息文字 |
| `messages[].note` | 序号或旁注，画在箭头上方 |
| `messages[].kind` | 箭头样式，见下 |
| `messages[].tone` | 消息着色（箭头和标签一起变色） |

顶层加 `grid: true` 会有背景网格。

**箭头样式（`kind`）**：

| kind | 画成 | 语义 |
|---|---|---|
| `sync`（默认） | 实心三角箭头 | 同步调用，等回复 |
| `async` | 空心箭头 | 异步调用，不等 |
| `reply` | **虚线** + 空心箭头 | 回复 |
| `self` | 右侧小环 | 自调用（`from` 等于 `to` 时自动识别） |

**要点**：

- 参与者按 **grid 均分**，lifeline（虚线）和箭头由 `app.js` 测量后画成 SVG。
- **一行 = 一条消息**，行高固定，所以时间轴是等距的。
- 参与者不要超过 5 个，否则列会太窄。

---

## 8. `matrix` —— 2x2 定位矩阵

**什么时候用**：做**取舍判断** —— 重要度 × 紧急度、使用频率 × 学习成本、影响面 × 改动成本。

```matrix
x: { label: 使用频率, from: 偶尔用, to: 每天都用 }
y: { label: 学习成本, from: 一学就会, to: 要啃很久 }
cells:
  - { title: 值得投入, desc: 用得多又难学，值得系统学一遍, tone: amber }
  - { title: 先跳过, desc: 又难学又不常用，用到再说, tone: muted }
  - { title: 顺手记住, desc: 简单又常用，自然会, tone: green }
  - { title: 用时再查, desc: 简单但不常用，查文档就行, tone: blue }
```

| 键 | 说明 |
|---|---|
| `x.from` / `x.to` | 横轴两端（左 / 右）的标签 |
| `y.from` / `y.to` | 纵轴两端（**下 / 上**）的标签 |
| `x.label` / `y.label` | 轴名称，可选 |
| `cells` | **四个格子，按阅读顺序**：`[左上, 右上, 左下, 右下]` |
| `cells[].tone` | 象限配色（染背景 + 象限名上色） |

```callout
tone: amber
icon: ⚠
text: |
  ==阈值线的位置决定分类结果，而它往往很随意。==
```

写完先问自己：**分界线放在这里，理由是什么？** 如果说不出来，
不如直接用 `compare` 列表格 —— 至少不会假装有量化依据。

**设计约定**（写死在样式里，别改）：

- 阈值线是这个积木的**主角**，所以单元格不画自己的色条 —— 否则两种线撞在一起分不清谁是阈值。
- 轴标签放**两端**，不写「高 / 低」「HIGH / LOW」这类修饰 —— 轴名本身就该说明方向。

---

## 9. `tree` —— 层级结构图

**什么时候用**：表达「谁包含谁」「谁继承谁」「目录长什么样」。

> 横向缩进 + 肘形连接线。任意深度都不会挤，比纵向树紧凑得多。

```tree
- label: DB
  sub: core/src/db.ts
  tone: violet
  note: 唯一直接碰 knex 的地方
  children:
    - label: getInstance
      sub: "name?: string"
      note: 两种入口，共享同一个 Builder.prototype
    - label: buildWhere
      sub: "(builder, rules, logic)"
      note: 递归展开表达式树
      children:
        - { label: isCondition, note: 有 logic 字段就是子树 }
        - { label: isRawExpr, note: "whereRaw 片段" }
    - { label: formatField, note: 反引号包裹列名 }
```

| 键 | 说明 |
|---|---|
| `label` | 主文字（等宽字体） |
| `sub` | 签名 / 类型，渲染成代码 chip |
| `note` | 补充说明（灰色小字） |
| `tone` | 左侧色条。顶层默认紫，子层默认灰 |
| `children` | 子节点数组，可无限嵌套 |

**要点**：

- **有孩子的节点可点击折叠** —— 适合展示大结构，读者先看骨架再展开细节。
- 顶层节点有底色（树的锚点），子层默认透明，hover 才浮出来 —— 每行都染色会很吵。
- 目录树、类层次、对象组成、调用栈都适合。**纯线性链条用 `lane-stack`，别用这个。**

---

## 9. `spec` —— 拆解卡

**什么时候用**：要把一个东西按固定维度拆开讲透。

常用六个维度：**输入 / 处理 / 输出 / 怎么调用 / 为什么这么设计 / 业务价值**。
维度不固定，但**同一页里的几张卡要用同一套维度**，否则没法横向对比。

```spec
title: knex
subtitle: SQL 查询构造器 · 被调用 43 处
tone: violet
rows:
  - k: 输入
    v: |
      链式调用累积出来的查询状态：表名 + 筛选条件 + 选取列。
  - k: 输出
    v: 一段**可直接执行的 SQL 字符串**。
  - k: 怎么调用
    code: |
      DB.getInstance().select('uid').rawQuery();
  - k: 为什么这么设计
    v: |
      **① 为什么要加 `rawQuery()`？**

      因为 knex 原生的取值方式返回值结构不同，而这个库对外只交付字符串。
```

| 键 | 说明 |
|---|---|
| `title` / `subtitle` | 卡头。`title` 用等宽字体，`subtitle` 是灰色小字 |
| `tone` | 卡头左侧色条 + `k` 标签的颜色 |
| `rows[].k` | 维度名，左栏固定宽度 |
| `rows[].v` | 内容，走完整 Markdown（可多段、列表、`==` 标记） |
| `rows[].code` | 要放代码块时用这个替代 `v`（会转义） |

> ⚠️ **`spec` 看起来像图，本质还是两栏文字。**
> 它适合**速查**（10 个文件各是什么），**不适合讲机制**（这个东西怎么工作）。
> 讲机制请用 `flow` / `lane-stack` / `journey`。
>
> **别滥用。** 只有当「一个东西值得按 6 个维度拆」时才用。
> 一个只有 2 处调用的小工具，写 6 行就是凑字数 —— 那种用 `compare` 一行说清就行。

---

## 10. `callout` — 提示 / 陷阱 / 引用

```callout
tone: amber
icon: 🧱
tinted: true
text: |
  为什么要分这么多层？因为**每一层只解决一个问题**。
  中间任何一层算错，都能回到上一层重跑。
```

- `quote: true` → 正文放大加粗，用于一句话结论。
- `tinted: true` → 背景染色（默认只有左边框）。
- `text` 是 Markdown，可以多段、可以列表。

---

## 11. `checklist` — 正例 / 反例

```checklist
tone: cross
items:
  - 延迟高，最快也要等下一次轮询
  - 删除数据不容易准确识别
```

`tone`：`cross` → 红叉；`warn` → 黄叹号；不写 → 绿勾。

---

## 12. `quiz` — 自测

**每篇必带。**

```quiz
- q: CDC 是 Flink 独有的功能吗？
  a: |
    不是。CDC 是通用技术，Flink CDC 只是 Flink 生态里的一个连接器方案。
- q: 为什么不用定时轮询？
  a: 延迟高、压业务库、漏中间状态、识别不到删除。
```

同一时刻只允许展开一题，避免一口气看完答案。

---

## 13. `demo` — 可交互模拟

**只在「静态图讲不清」时用。** 需要两步：

**① 在 `assets/app.js` 里注册控件：**

```js
WIDGETS['my-widget'] = (root) => {
  const log = root.querySelector('[data-log="main"]');   // 对应下面的 log: main
  const run = root.querySelector('[data-run]');
  run.addEventListener('click', () => { /* ... */ });
};
```

可用的钩子：`[data-log="<name>"]`、`[data-run]`、`[data-reset]`、`[data-status]`。

**② 在 note.md 里声明外壳：**

```demo
widget: my-widget
title: 订单表变更流
panes:
  - log: main
    tag: 轮询
    tone: amber
    head: 定时查表
    sub: 每 10 分钟一次
    foot: [延迟高, 中间状态丢失]
  - log: other
    tag: CDC
    tone: violet
    head: 订阅变更日志
    sub: 每条变化实时推送
    foot: [近实时, 含删除]
```

两边的 `log` key 必须对得上。页面只声明外壳，逻辑全在 `app.js`。

### 通用控件库（推荐优先用这些）

这几个控件**不绑定具体知识**，只写 YAML 就能用。比手写 `html` 省事得多。

#### `stepper` —— 逐步执行器

**讲算法、协议、状态机**：点下一步，看代码/状态逐行走。

```demo
widget: stepper
title: 二分查找怎么缩小范围
actions: false
config:
  steps:
    - { label: 初始, code: "low = 0, high = 9", note: 范围是全部 10 个元素 }
    - { label: 第 1 次, code: "mid = 4\ntarget > a[4] → low = 5", note: 砍掉一半 }
    - { label: 命中, code: "mid = 5\na[5] === target ✓", note: 共比较 3 次 }
```

`steps[]`：`label`（按钮文字）、`code`（等宽代码，`\n` 换行）、`note`（说明）。

#### `tuner` —— 参数调节器

**讲公式、阈值、性能曲线**：拖动滑块，多个指标实时变化。

```demo
widget: tuner
title: 数据量增长时两种方案的耗时
actions: false
config:
  param: { label: 数据量, unit: 万行, values: [1, 10, 100, 1000] }
  outputs:
    - { label: 全表扫描, unit: ms, values: [8, 80, 800, 8000], tone: red }
    - { label: 走索引,   unit: ms, values: [0.1, 0.15, 0.3, 0.9], tone: green }
```

**注意**：`values` 是**离散档位**，不是公式。==不要指望它算数== ——
你给什么值就显示什么值。这样设计是为了避免 `eval`，安全且可控。

#### `diff` —— 并排差异对比

**讲「改前 vs 改后」**：行首写 `- ` / `+ ` 自动标红绿，悬停两边对应行联动高亮。

```demo
widget: diff
title: 从字符串拼接改成参数绑定
actions: false
config:
  left:
    title: 改前 · 字符串拼接
    code: |
      const sql =
      -   "SELECT ... WHERE city = '" + city + "'";
  right:
    title: 改后 · 参数绑定
    code: |
      const sql =
      +   "SELECT ... WHERE city = ?";
      + db.query(sql, [city]);
```

### 数据驱动的写法（`config`）

上面三个控件都用 `config`，作者**只写 YAML，不写 HTML**：

- `panes` → 双栏日志式（配合日志型控件）
- `html` → 作者手写标记，控件只负责接线
- **`config` → 控件自己渲染整个 body（推荐）**

`config` 会序列化成 JSON 塞进 `data-config`，控件用 `cfgOf(root)` 读。

---

## 14. `summary` / `raw`

```summary
title: 一句话总结
text: |
  `CDC` 负责把变化**实时通知出来**；`Flink` 负责**加工变化**。
```

`raw` 块直接输出 HTML，是一次性排版实验的逃生口，**不要长期使用** ——
它绕过了积木系统，换肤和校验都管不到它。

---

## YAML 常见坑

**裸标量里不能出现 `: `（冒号 + 空格）**，会被当成新的键：

```yaml
# ❌ 解析失败
desc: 注意: 这里有问题
# ✅ 三种写法
desc: "注意: 这里有问题"
desc: '注意: 这里有问题'
desc: |-
  注意: 这里有问题
```

**`>` 开头的标量会被当成折叠块**：

```yaml
sub: "WHERE updated_at > ?"    # ✅ 加引号
```

**多行文本用块标量**，比转义引号干净：

```yaml
note: |-
  第一行
  第二行，可以写 **Markdown**
```

**列表里的行内映射要加空格**：`- { k: v }` 而不是 `- {k: v}`。

**值以 `*` / `&` / `!` 开头必须加引号** —— YAML 里它们是别名 / 锚点 / 标签的起始符：

```yaml
# ❌ Unresolved alias: *这里以星号开头**会炸
- { title: x, desc: **加粗**开头 }
# ✅
- { title: x, desc: "**加粗**开头" }
```

> `npm run check` 有预检会直接报这一条（块式和流式都覆盖）。

**值里有 `[` 或 `{` 时也要加引号**：

```yaml
# ❌ Rule[] 里的方括号会被当成数组起始
- { title: Rule[], desc: "..." }
# ✅
- { title: "Rule[]", desc: "..." }
```

**值以反引号 `` ` `` 开头也要加引号**（YAML 会当成保留字符）。


---

## 校验

```bash
npm run check    # 只校验不写文件；有问题退出码 1
```

会报出：YAML 解析失败（带文件和行号 + 原文回显）、未知围栏语言（积木名拼错的典型症状）、
`meta.json` 缺字段、缺 `quiz`。
