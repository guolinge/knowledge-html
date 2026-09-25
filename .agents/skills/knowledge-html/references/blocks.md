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
nodes:
  - { id: in,   label: 内部状态, sub: "{ table: 'user_portrait' }", row: 0, tone: violet }
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

## 7. `spec` —— 拆解卡

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

## 8. `callout` — 提示 / 陷阱 / 引用

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

## 9. `checklist` — 正例 / 反例

```checklist
tone: cross
items:
  - 延迟高，最快也要等下一次轮询
  - 删除数据不容易准确识别
```

`tone`：`cross` → 红叉；`warn` → 黄叹号；不写 → 绿勾。

---

## 10. `quiz` — 自测

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

## 11. `demo` — 可交互模拟

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

---

## 12. `summary` / `raw`

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

---

## 校验

```bash
npm run check    # 只校验不写文件；有问题退出码 1
```

会报出：YAML 解析失败（带文件和行号 + 原文回显）、未知围栏语言（积木名拼错的典型症状）、
`meta.json` 缺字段、缺 `quiz`。
