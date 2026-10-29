# 积木 DSL 完整参考

围栏内是 **YAML**。行内支持 Markdown（`**粗体**`、`` `代码` ``）和裸 HTML。

````callout
tone: red
icon: ⚠
text: |
  ==「支持裸 HTML」意味着：你在单元格 / `desc` / `text` 里写的字面 HTML 标签会真的成为元素。==

  踩过的真实事故（2026-10-09）：compare 单元格里写了字面的
  `<script src="https://cdn.../app.js">`（本意是展示一段示例代码）——
  它成了**真标签**，把后面 app.js 的整个 script 块吞掉，
  ==全页 JS 静默全灭==：所有控件空着、flow/seq 一张都没画，
  而 `check` 全绿、单块截图全正常（单块预览页不含出事的那个块，掩护了它）。

  ++正文要展示 HTML 标签时，一律写实体（`&lt;` `&gt;`），或改用不含尖括号的措辞。++
  探针已有兑底：全部 `[data-mount]` 为空时直接报「app.js 没跑」，并指出这个根因。
````

> 可运行示例：`notes/blocks-cheatsheet/note.md`

> 常规任务只设计电脑阅读的页面。下面的窄屏行为说明组件实际实现，不要求每篇另做手机版。
> 目标页面、图的尺度和验收范围统一见 [原则 ⑩ · 版面](../SKILL.md#原则-⑩-版面服务阅读图按内容铺开)；这里只写字段与已有能力，不另设固定画幅或字号标准。

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
HTTP 缓存 ==默认只按 URL 区分==，不看请求头。

!!`Cache-Control: no-cache` 不是「不缓存」，是「每次都要去校验」。!!

++要彻底不存用 `no-store`；要存但每次校验用 `no-cache`。++
```

> 强调选择按 [原则 ⑪ · 写作](../SKILL.md#原则-⑪-平实连贯准确地写)：每段最多一处 `==`，每节通常两三处，一屏最多三处。不为计数删信息，也不把其他文字换色再全篇强调。

反引号里的内容不会被解析（`` `a == b` `` 安全），带空格的 `a == b`
和 `====` 这种空内容也不会被误判。

### 坑：`**URL**` 后面不要紧跟中文标点

```text
❌ 然后开 **http://localhost:5173/**。
```

渲染出来是这样：

```html
❌ 然后开 **<a href="http://localhost:5173/**%E3%80%82">…</a>
```

**加粗丢了，而且 `href` 里带着 `**` —— 链接是坏的。**

根因在 `linkify-it`：它只在 `*` 位于字符串**末尾**时才把它从 URL 里裁掉。
后面跟了个中文句号，`*` 就不再是末尾了，于是 `**。` 一起被算进 URL。

```compare
first: 写法
head: [渲染结果, 建议]
rows:
  - "`**http://x/**`（行尾）": ["✅ 正常", "可以用"]
  - "`**http://x/**。`": ["❌ href 被污染", "改成下面两种之一"]
```

**两个改法**（`npm run check` 会直接告诉你这两条）：

```markdown
① 去掉加粗，用等宽 —— URL 本来就更适合用反引号
   然后开 `http://localhost:5173/`。

② 保留加粗，在 `**` 前面垫一个空格
   然后开 **http://localhost:5173/ **。
```

### 坑：标签里的 `u.id` 会变成假链接

linkify 不只认 `http://`，它认**所有像域名的串** —— 而 `.id` 是真 TLD。
图标签里写裸的 `u.id`（或任何 `x.id`），页面上会变成一条蓝色下划线的假链接。

```text
❌ label: ON u.id = o.user_id        → 「u.id」被渲染成链接
✅ label: "ON `u.id` = `o.user_id`"  → 反引号阻止 linkify，渲染成代码 chip
```

同样的还有 `.io`、`.ai`、`.so`、`.sh` 这类一字符/两字符 TLD。
++标签里写标识符，顺手都套反引号，不额外费心记哪些后缀是真 TLD。++

```callout
tone: amber
icon: ⚠
text: |
  ==不要试图改渲染器修这个。==

  把 `*` 从 URL 字符集里拿掉的代价是：`http://x/**/y` 这种**合法** URL 会被切坏。
  而且 `linkify-it` 没有暴露可配项（实测 `md.linkify.__opts` 是空的）。

  ++一个检查比一个聪明的渲染器更安全。++
  `npm run check` 里有 `lintLinkifyStars`，会直接报出行号和两种改法。
```

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
- 单元格写字符串 → 普通文本；写 `{ text, tone }` → 彩色徽章。
- ==两种写法都走行内 Markdown==（`**粗体**` / `` `code` `` / `==标记==`）。
  `tone` 只负责上色，不会关掉 Markdown。

````callout
tone: green
icon: ✅
text: |
  **徽章里可以放心写 Markdown**：

  ```yaml
  - 值怎么处理: ["原样", { text: "整段透传 `whereRaw`", tone: red }]
  ```

  渲染结果是 «整段透传 <code>whereRaw</code>» 装在一个红色徽章里。

  ⚠️ 早期版本这里用的是 `esc()`（纯文本），导致全仓库 8 篇笔记里
  `{ text: "**注入漏洞**", tone: red }` 在页面上显示成**字面的 `**注入漏洞**`**。
  已修 —— 写单元格的直觉本来就是「这里能写 Markdown」。
````

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

- `cols`：`1` / `2` / `3` / `4`，不写则按宽度自动排（`auto-fit`）。
- `items[]` 的字段：

| 字段 | 能写什么 |
|---|---|
| `title` | 卡片标题 |
| `desc` | **一行**，走行内 Markdown（`**粗**` / `` `代码` `` / `==标记==`） |
| `body` | **完整 Markdown** —— 多段、列表、`#####` 小标题、围栏代码块。要「标题 + 解释 + 例子 + 代码」就用它 |
| `tag` / `tone` | 左上角标签 / 配色 |
| `code` | 单个代码块（会转义） |

`desc` 和 `body` 可以只用一个，也可以都写（`desc` 当一句话摘要，`body` 接详细内容）。

> ==内容一多，卡片就不能再窄== —— 用 `body` 时配 `cols: 1` 或 `cols: 2`。
> 卡片本来就是「一眼扇完」的东西，一屏放四张又要每张读三段，就不如用 `spec`。

`````callout
tone: amber
icon: ⚠
text: |
  **`body` 里放代码块，外层也要四个反引号**（同 `callout`）：

  外层用四个，内层正常用三个，这样就是对的。（去 `notes/blocks-cheatsheet/note.md` 看可运行的例子 —— 那里是真代码，比看描述准。）

  ++记住一句话：==外层反引号的数量，永远要比内容里打算出现的多。==++
`````

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
| `edges[].labelDx` / `labelDy` | **手动把边标签挪开**。群组框的标签画在框的左上角，而边标签默认落在那条缝的水平中点 —— 缝一窄两个标签就叠在一起。工具算不出「那里已经有群组标签了」，所以留了这条手动通道 |
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

#### 四条**可判定**的规则（不是抽象提醒）

下面的形状 **`npm run visual-check` 会直接报出来**，不用等看截图：

```compare
first: 形状
head: [会怎样, 怎么改]
rows:
  - 一条边跳过了整整一行: ["它必然从那行穿过去", "让边只跨相邻两行"]
  - 同一 row 两个节点各自往下连: ["连线从对方框上穿过去", "改成纵向一条链"]
  - 两个节点之间的边带标签: ["标签比间隙宽就压在框上", "要么拆到不同 row，要么把标签改短"]
  - 两条反向边（A→B 和 B→A）: ["两个标签画在同一个空隙里，叠成乱码", "现在会自动上下错开 15px"]
```

#### 两个 group 不要在同一批 row 里并排

`groups` 的框是成员节点的包围盒算出来的。两个 group 的成员交错排在同几行时，
两个包围盒会相交 —— 先画的那个框，边线从另一个 group 的节点上穿过去。

!!`visual-check` 不报这个：它查的是边、标签和溢出，不看 group 框。!!

```compare
first: 症状
head: [会怎样, 怎么改]
rows:
  - "左右两列各一个 group，行号交错（row 0/1/2 左边、row 1/2/3 右边）":
      - "先画的 group 框右边线穿过右边的节点"
      - "把右边那个 group 整体挪到下面的行（先画完一条链，再画另一条）"
```

实测：2026-10-13 写 combination-i18n 的 global / local 作用域图，
最初两列并排，蓝色框的右边线从「local messages」「某个组件」两个节点中间穿过；
改成上下两条带（global 占 row 0~2，local 占 row 3~4）后干净，两个框不相邻也不相交。

#### 阶梯 + 公共出口：这个形状 `flow` 画不了

```text
   [第一个判定]
        ↓
   [第二个判定] ──→ ┐
        ↓          │ 每条「是」都要跨好几行
   [第三个判定] ──→ ├─→ [公共出口]
        ↓          │
   [第四个判定] ──→ ┘
```

阶梯节点在同一列上，而所有「是」边都得跨 2~4 行到公共出口 —— **必然穿过阶梯**。
实测 5 种排法（出口放第 1 / 2 / 5 / 6 行、阶梯节点挪行）**全部无解**。

这是「不上 dagre/elkjs」的直接代价：100KB~1.5MB 换自动布局，而「单文件发人」是这个仓库的核心价值。

```callout
tone: green
icon: ✅
text: |
  **遇到这种拓扑怎么办**：

  1. **拆成两张图** —— 阶梯一张（只画「否」的下行链），出口一张
  2. **改用 `compare`** —— 「形态 → 怎么处理」本来就是一张对照表
  3. **真的画不了又不想改** → 加进 `tools/visual-baseline.json`，
     它会照旧报（⚠）但不阻塞推送
```

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
grid: true
participants:
  - { id: c, label: 客户端, tone: blue }
  - { id: g, label: API 网关, tone: violet }
  - { id: d, label: 数据库, tone: green }
segments:
  - { from: 1, to: 1, label: 请求 }
  - { from: 2, to: 4, label: 查询 }
messages:
  - { from: c, to: g, label: "POST /orders", kind: sync, note: 1 }
  - { from: g, to: d, label: "SELECT * FROM orders", kind: sync, note: 2 }
  - { from: d, to: g, label: 结果集, kind: reply, note: 3 }
  - { from: g, to: c, label: "200 OK", kind: reply, note: 4, gap: 40 }
  - { from: g, to: g, label: 重试, kind: self }
```

| 键 | 说明 |
|---|---|
| `participants[].id` | 唯一标识，消息靠它引用 |
| `participants[].label` / `sub` | 参与者名字 / 辅助等宽小字；现有窄屏实现会隐藏 `sub`，关键身份或关系不能只写在这里，按原则 ⑩ 保留可到达的信息 |
| `participants[].tone` | 配色（显式写了会覆盖 `kind` 的默认色） |
| `participants[].kind` | 同 `flow` 的语义类型，带图标 |
| `messages[].from` / `to` | 两端参与者。**相同就是自调用** |
| `messages[].label` | 消息文字 |
| `messages[].note` | 序号或旁注，画在箭头上方 |
| `messages[].kind` | 箭头样式，见下 |
| `messages[].tone` | 消息着色（箭头和标签一起变色） |
| `messages[].gap` | 这条消息**前面**额外留白（px）。用来表达「这一步慢」 |
| `segments[]` | 时间段框：`{ from, to, label }`，`from`/`to` 是**消息序号**（1 起） |

**激活条是自动的，不用写。** 它按「这个参与者收到过什么、发出过什么」推导：
取所有相关消息的 y 区间。==纯发起方（先发后收，比如客户端）不画== ——
激活条表示「在处理」，而它在等待。

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
- **最后一个参与者的「自调用」，标签压到 5~6 个字以内。**
  自调用的标签是绝对定位的（`left: lx + 58px; max-width: 38%`），
  ==越靠右的参与者，留给它的宽度越小== —— 最右边那个可能只剩 130px 左右。
  写长一点就会换行，然后溢出那一行容器。细节挪到正文里，图上只留两三个字。
- **序号和消息文字都对齐到「箭头的实际中点」**，不是容器中点 ——
  所以三条泳道取相邻两条时，标签也指得准。
- 序号在消息文字**上方**（纵排，不会压住）。
- 自调用那一行分三段：**序号在 lifeline 左边、环在中间、消息在右边**。
- **`segments` 的框会自动给时序图顶部留 30px 余量** —— 这段余量加在 DOM 上
  （`.seqd-body` 的 `padding-top`），不是加在 SVG 坐标里。
  ==两边的坐标必须一起动，只动 SVG 会让箭头和消息文字错开。==
  时间段框的标签画在框顶上方 7px，而**参与者卡片和第一行是紧挨着的**（间隙 0），
  不留余量的话标签只能落进卡片或第一行，两边都撞。

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
- X 轴两端标签**各自居中于自己那一列**（不是贴在整个宽度的左右边缘）。贴边缘时两个标签隔着半屏，
  读者会以为右边那个是给整张图的。
- 竖排的 y 轴名只用 `writing-mode: vertical-rl`。**不要加 `transform: rotate(180deg)`** ——
  汉字竖排本来就该逐字直立、自上而下；转 180° 之后每个字都是倒的，看起来像乱码。
  （2026-10-19 真踩过：一句话让四篇笔记的 matrix 轴名全变成倒字。）

### 写 matrix 时最容易错的两处

| 症状 | 根因 | 修法 |
|---|---|---|
| 四个格子和轴标签对不上 | `cells` 是 `[左上, 右上, 左下, 右下]`，而 `y.to` 在**上**、`y.from` 在**下** | 先把两个轴的方向写在纸上，再按期望象限顺序填四格 |
| 轴名方向反了 | `y` 的 `from` / `to` 写反（很多人下意识按「从大到小」写） | 记住：`to` = 上面那一端、`from` = 下面那一端；箭头 `↑` 指向 `to` |

改完一定截图看一眼 —— `npm run check` 只验 YAML 能不能解析，==不验四格内容和坐标轴对不对得上==。

---

## 9. `tree` —— 层级结构图

**什么时候用**：表达「谁包含谁」「谁继承谁」「目录长什么样」。

> 横向缩进 + 肘形连接线。任意深度都不会挤，比纵向树紧凑得多。

```tree
- label: src
  tone: violet
  note: 源码根目录
  children:
    - label: api
      note: 对外接口层
      children:
        - { label: routes.ts, note: 路由定义 }
        - { label: middleware.ts, note: 鉴权 / 日志 / 限流 }
    - label: core
      sub: 不依赖框架
      note: 业务逻辑
      children:
        - { label: order.ts, note: 下单主流程 }
        - { label: pricing.ts, note: 计价规则 }
    - label: infra
      note: 外部依赖的适配
      children:
        - { label: db.ts, note: 连接池 + 查询封装 }
        - { label: cache.ts, note: Redis 封装 }
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
- **有孩子的节点带一层底色**（子树锚点），叶子保持透明、hover 才浮出来。
- 连接线是 **2px**（细了在 retina 上看不见），缩进 32px，兄弟行之间留 5px。
- `sub` 用的是节点的 `tone` 色 —— 它和 `note` 不是同一层信息，不该都是灰的。
- 目录树、类层次、对象组成、调用栈都适合。**纯线性链条用 `lane-stack`，别用这个。**

---

## 10. `spec` —— 拆解卡

**什么时候用**：要把一个东西按固定维度拆开讲透。

常用六个维度：**输入 / 处理 / 输出 / 怎么调用 / 为什么这么设计 / 业务价值**。
维度不固定，但**同一页里的几张卡要用同一套维度**，否则没法横向对比。

```spec
title: 连接池
subtitle: 数据库连接复用 · 被调用 43 处
tone: violet
rows:
  - k: 输入
    v: |
      一次查询请求：需要一个连接来执行 SQL。
  - k: 输出
    v: 一条**已建立的连接**，用完必须还回去。
  - k: 怎么调用
    code: |
      const conn = await pool.acquire();
      try { await conn.query('select 1'); }
      finally { pool.release(conn); }
  - k: 为什么这么设计
    v: |
      **① 为什么不是每次新建连接？**

      建连接要 TCP 握手 + 认证，几十毫秒；查询本身可能只要 1 毫秒。
      连接池把这部分开销摊掉了。
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

## 11. `callout` — 提示 / 陷阱 / 引用

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

`````callout
tone: red
icon: ⚠
text: |
  ==`text` 里要放**代码块**时，外层必须用四个反引号。==

  这是全仓库踩得最多的坑。而且它有**两个**层：

  ① 外层写三个 → 内层的代码块会把它提前闭合
  ② 就算外层写了四个，**围栏内容里也不能出现字面的三个反引号** —— 那同样会提前闭合

  所以最稳的写法：

  ```
  ✅ 外层用四个反引号（或更多）
  ✅ 想表达「三个反引号」时，就用汉字写，别真的打三个出来
  ```

  症状：==页面看着正常，但后面的段落全错位、`**加粗**` 字面显示。==

  `npm run check` 的 `lintFences` 会报出来并告诉你哪一行。
  ++但更好的做法是：写代码块的时候顺手就把外层写成四个。++
`````

---

## 12. `checklist` — 正例 / 反例

```checklist
tone: cross
items:
  - 延迟高，最快也要等下一次轮询
  - 删除数据不容易准确识别
```

`tone`：`cross` → 红叉；`warn` → 黄叹号；不写 → 绿勾。

---

## 13. `quiz` — 自测

**每篇必带。**

```quiz
- q: CDC 是 Flink 独有的功能吗？
  a: |
    不是。CDC 是通用技术，Flink CDC 只是 Flink 生态里的一个连接器方案。
- q: 为什么不用定时轮询？
  a: 延迟高、压业务库、漏中间状态、识别不到删除。
```

同一时刻只允许展开一题，避免一口气看完答案。

#### 复用：把一段原文折起来

想在一篇里附上「读者可能想看、但不该占主线」的材料（讨论原文、会议记录、外部文章、完整日志），
直接借 `quiz` 的外壳：`q` 写引子，`a` 写正文。收起时只占一行，点开才是全文。

| 要做对的三件事 | 为什么 |
| --- | --- |
| 外层围栏用 **四个** 反引号 | 原文里的 ``` 代码块就不会提前闭合围栏 |
| 原文的标题降成 `####` / `#####` | 内容在围栏里，不进目录 —— 但 `#` `##` `###` 会按页面 h2/h3 的大小渲染，在折叠区里很突兵 |
| 正文第一句交代「这是什么、为什么收在这里」 | 否则读者点开后不知道自己在看什么 |

实例：`notes/goroutine-derivation/note.md` 的开头（把这次讨论的问答原文折在首屏）。

---

## 14. `popquote` — 原文收进悬浮弹窗

**什么时候用**：手头有一段不该占主线、但读者可能想通读的原文（AI 问答、会议记录、外部文章）。
收起时它只是一块小卡；点开是原生 `<dialog>` 悬浮层，正文自己滚动，Esc / 点背景 / 右上角都能关。

```popquote
label: 这次的问答原文
sub: 4 轮问答 · 约 6800 字
tone: violet
note: 原文照录；只把标题降了一级，避免打乱本页目录。
text: |
  #### 问

  这里放第一轮的问题。

  #### 答

  第一轮的答案，可以有多段、代码块、表格。
```

| 键 | 说明 |
|---|---|
| `label` / `sub` | 收起时和弹窗标题上的名字 / 一行等宽小字 |
| `tone` | 左侧色条与按钮强调色 |
| `note` | 弹窗标题下的一条小字，用来交代「原文有没有改」 |
| `text` | 原文，走完整 Markdown。要放代码块时，外层围栏比内容里最多的反引号再多一层 |

**和 `quiz` 折叠的区别**：`quiz` 是原地展开，适合一段补充说明；`popquote` 是悬浮层，
适合长原文 —— 打开时页面不跟着滚，关上回到原位，不会把下面的章节推走。

**正文用 `breaks: true` 渲染**：聊天记录常常一行就是一行，默认的软换行会把几行压成一段。
`popquote` 的 `text` 走单独的 markdown-it 实例，保留原文换行；代码围栏仍然照常渲染。

**长原文的两个约定**：

- 原文里的 `#` / `##` / `###` 降成 `####` / `#####` / `######`，否则它们会进本页目录，
  而且在弹窗里按页面 h2/h3 的字号渲染。只改标题级别，正文不要动。
- 第一句说明这是什么、为什么收在这里。读者点开时得知道自己在看什么。

## 15. `demo` — 可交互模拟

**只在「静态图讲不清」时用。** 需要两步：

**① 在 `assets/app.js` 里注册控件：**

!!注册代码必须放在文件里「`/* ---------- 挂载 ---------- */`」那一段**之前**。!!
挂载段在脚本加载时就跑 `querySelectorAll('[data-widget]')` 逐个查注册表；
把新控件追加到文件末尾（挂载段之后），加载到挂载行时它还没注册，
控件全空、只有一条 `console.warn('[widget] 未注册')`，页面看着正常。
踩过一次（mysql-2pc-crash，2026-10-11）：追加到末尾后 demo 全空，探针才抓到。

```js
WIDGETS['my-widget'] = (root) => {
  const log = root.querySelector('[data-log="main"]');   // 对应下面的 log: main
  const run = root.querySelector('[data-run]');
  run.addEventListener('click', () => { /* ... */ });
};
```

可用的钩子：`[data-log="<name>"]`、`[data-run]`、`[data-reset]`、`[data-status]`。

控件自己就带按钮（用 `config` 渲染整块 body）时，写上 `actions: false` —— 
否则 demo 外壳还会多出一条「开始模拟 / 重置」工具栏，而它绑的 `[data-run]` 没人接，点了没反应。

**body 的三种形态，按「有没有 `panes`」选**：有 `panes` → 双栏日志式；写了 `html` → 你的标记，控件只接线；都没有 → 一个带 18px 内边距的 `[data-mount]`，控件自己往里渲染。

```callout
tone: amber
icon: ⚠
text: |
  ==控件不写 `config` 时，也要走第三种形态。==

  早期实现按「有没有 `config`」判断，于是 `call-stack-lab` / `frame-anchor-lab` /
  `micro-op-lab` 三个控件的 `demo` 块（只有 `widget:` 和 `actions: false`）落进了一个
  空的 `.demo-body`：18px 内边距挂在 `.demo-body.custom` 上，没拿到，控件内容就紧贴卡片边缘。
  `check` 和 `visual-check` 都是绿的 —— 只有截图看得出来。

  ++现在渲染器按 `panes` 判断：只要没写 panes，就给 `.custom` + `data-mount`。++
```

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

#### `join-fanout-lab` —— 一对多乘一对多

**讲 join 的基数效应**：两张一对多的子表同时挂到主表上，行数相乘，`SUM` 被重复累加。
两个按钮从 `config` 里各取一条记录加进去 —— 金额全部来自配置，控件运行时不造数，所以页面上每个数字都能在正文里对上。

```demo
widget: join-fanout-lab
title: 一对多 × 一对多：行数乘出来，金额也跟着重复
actions: false
config:
  items:
    - { name: A 商品, amount: 100 }
    - { name: B 商品, amount: 200 }
    - { name: C 商品, amount: 50 }
  payments:
    - { name: 支付 1, amount: 150 }
    - { name: 支付 2, amount: 150 }
    - { name: 补款, amount: 50 }
  startItems: 2
  startPayments: 2
```

左边列出 join 后的全组合明细，右边并排给出「直接 join 再 SUM」和「先聚合再 join」的合计。
`startItems` / `startPayments` 是初始条数；按钮加到底后自动置灰。

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

#### `sched-lab` —— 甘特图对比器

**讲「同一个输入，换个规则结果全变」**：一行一条时间轴，切换方案看它们重排。
配三个指标卡 + 一排横向对比条，谁好谁坏一眼看出来。

```demo
widget: sched-lab
title: 四个作业，六种算法
actions: false
config:
  default: FCFS
  quantum: 2
  mlfq: [1, 2, 4]
  jobs:
    - { id: P1, arrive: 0, burst: 3, priority: 3 }
    - { id: P2, arrive: 2, burst: 6, priority: 1 }
```

`config.jobs[]`：`id` / `arrive`（到达时刻）/ `burst`（需要运行多久）/ `priority`（1 最高）。
控件**现算**，不预先烤结果 —— 换作业集只改这几行。

内置六种算法，`id` 是固定的：`FCFS` `SJF` `HRRN` `RR`（用 `quantum`）
`HPF`（抢占式）`MLFQ`（用 `mlfq` 三级时间片）。
`default` 只是决定初始选中谁。

> 它的形状是「一行 = 一个作业、横轴 = 时间」，所以**换个领域也能用**：
> 把 `jobs` 想成「作业」就行 —— 交给谁、什么时候开始、要多久。
> 但它是**离散槽位**、不是连续时间轴，别拿它画真实的耗时曲线。

#### `switch-cost` —— 双栏逐步对照

**讲「A 和 B 差在哪一步」**：左栏列动作，右边两列并排回答「这次要不要做」，
一步步走，走到分叉处自己会看出来。底部两条进度条是「累计做了几样动作」。

```demo
widget: switch-cost
title: 同进程内切线程 vs 跨进程切换
actions: false
config:
  tail: 分叉只在第 4 步 —— 而这一步一旦发生，代价摊在之后。
  steps:
    - title: 保存寄存器和 PC
      detail: 寄存器里是这个线程执行到哪。
      thread: "yes"
      proc: "yes"
      threadWhy: 每个线程一份
      procWhy: 一样
    - title: 换掉页表基址寄存器
      detail: 决定 CPU 接下来用哪一张页表翻译地址。
      thread: "no"
      proc: "yes"
      threadWhy: 两个线程共用同一张页表
      procWhy: 新进程有一整套自己的地址空间
      branch: true
```

`steps[].thread` / `steps[].proc` 取 `"yes"` 或 `"no"`；`branch: true` 的那一行
会带一条琥珀色左边条，把「分叉点」钉出来。

> `tail` 用一句话收尾。==别让分叉点超过两个，也别在 `no` 的那一栏写长句==
> —— 那一栏本来就窄。

#### `io-models` —— 同一条时间轴上的多方案对比

**讲「一堆名字听着像不同的事」**：把每种模型铺在同一条时间轴上，
拖一根时间指针走过去，看每一刻「谁在等、谁能干活」。

```demo
widget: io-models
title: 五种 I/O 模型挨在同一条时间轴上
actions: false
config:
  tMax: 10
  tail: 橙色那一段是「数据拷贝」，只有异步 I/O 没有它。
  models:
    - id: blocking
      name: 阻塞 I/O
      sub: "默认就是这样"
      sync: sync
      wait: block
      copy: block
      segs:
        - { from: 0, to: 7, state: wait, text: "一直等到内核把数据准备好" }
        - { from: 7, to: 9, state: copy, text: "数据到了，拷贝这段也得等" }
        - { from: 9, to: 10, state: done, text: "read 返回" }
```

`segs[].state` 取四个值，配四种颜色：

| state | 含义 | 颜色 |
|---|---|---|
| `wait` | 卡住等数据准备 | 红 |
| `copy` | 卡住等数据拷贝 | 橙（**带斜纹**，这是全篇的分界线） |
| `free` | 应用可以干别的 | 绿 |
| `done` | 已就绪 / 拿到数据 | 蓝 |

下面那张判定表由 `wait` / `copy` 两个字段直接生成（取值 `block` / `poll` / `no`），
`sync` 决定归到「同步」还是「异步」。==这两个字段和上面的色块是同一份数据==，
改一处两边一起变，不会对不上。

#### `inode-trace` —— 一个偏移量走哪条路

**讲「同一个操作，随输入大小落进不同的实现分支」**：拖滑块给一个字节偏移，
看它落在哪一档、要经过几层、多读几次磁盘。底部那张容量表是现算的。

```demo
widget: inode-trace
title: 文件的第 N 个字节，inode 靠什么找到它
actions: false
config:
  blockSize: 4096
  directCount: 10
  pointerPerBlock: 1024
  maxLog: 12
```

滑块是**对数刻度**（`maxLog: 12` 表示拉到底 = 10¹² 字节），
否则前 40KB 只占滑块的前 0.001%，根本拖不到。

> 它算的是 Unix inode 的「直接 + 多级间接」那一套。换个领域也能用，
> 只要那个东西是「按大小分档、每档代价不同」—— 例如缓存层级、分片路由。

#### `link-refcount` —— 删一个名字会发生什么

**讲「引用计数」**：点任意一个名字的删除按钮，看计数怎么掉、数据什么时候真的没。
每个名字可以带一条自己的「删除说明」。

```demo
widget: link-refcount
title: 点「删除」，看引用计数怎么动
actions: false
config:
  inode: 100
  blocks: "5 / 9 / 12"
  names:
    - { path: "/a/file", dir: "原来的名字", kind: origin }
    - { path: "/b/hardlink1", dir: "硬链接 1", kind: hard }
  symlink: { path: "/c/symlink1", dir: "软链接", inode: 200, target: "/a/file" }
```

`names[].kind` 只影响显示（`origin` 与 `hard` 在语义上完全平等，这正是要讲的点）。
`symlink` 是可选的 —— 给了它，控件会多画一条独立的 inode 线，
用来说明「软链接有自己的 inode，目标是死是活它都在」。

#### `gmp-lab` —— 一个真的会跑的迷你调度器

**讲「有队列的调度器」**：点「跑一步」，看每个 P 取 G、偷 G、被阻塞 G 挂到 netpoller。
它不是动画 —— 背后就是一份简化过的 `schedule()`。

```demo
widget: gmp-lab
title: GMP 调度台
actions: false
config:
  gomaxprocs: 3
  goroutines: 16
  ioRatio: 0.4
  seed: 7
```

`gomaxprocs` 是 P 的个数，`goroutines` 是 G 的总数。
`ioRatio` 控制多大比例的 G 会先去等网络，`seed` 固定随机种子让结果可重放。

创建时**所有 G 都落在 P0 的队列里**（新 G 挂在创建者身上）——
这是刻意的，因为「一边倒」才是真实常态，也让工作窃取立刻可见。

> 换个领域也能用：只要那个东西是「一堆任务 + 若干执行许可 + 本地/全局两级队列」。

#### `gswitch-lab` —— 同一条线程里换一个任务

**讲「用户态换任务，内核不知道」**：左边是正在跑的线程和它的寄存器，
右边是每个任务的保存现场（sp / pc / bp / lr），中间一行行跑调度器的代码。
一步一步点过去，看「谁存了什么、谁恢复了什么、内核那边发生了什么」。

```demo
widget: gswitch-lab
title: 同一条线程上，从 A 换到 B
actions: false
config:
  steps:
    - title: "A 在跑"
      code: ["A: <-ch   // 取不到值"]
      kernel: "内核看到的：M0 一直在运行"
      curg: "A"
      cpu: { pc: "0x10a2f0", sp: "0x40001f80", bp: "0x40001fb0", lr: "0x10a2c8", who: "A 的代码" }
      g1: { st: Grunning, tone: green, where: "在 M0 上跑", buf: null }
      g2: { st: Grunnable, tone: amber, where: "排在队列里", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "此刻 CPU 上跑的是 A。"
    - title: "让出：把现场存进自己的 gobuf"
      code: ["mcall(park)"]
      kernel: "内核看到的：M0 一直在运行"
      curg: "A"
      cpu: { pc: "0x1009f40", sp: "0x40008000", bp: "0x0", lr: "0x10a2f8", who: "调度栈" }
      g1: { st: Grunning, tone: green, where: "刚存好，还没改状态", buf: { sp: "0x40001f80", pc: "0x10a2f8", bp: "0x40001fb0", lr: "0" } }
      g2: { st: Grunnable, tone: amber, where: "还在队列里", buf: { sp: "0x40003f20", pc: "0x10b140", bp: "0x40003f50", lr: "0" } }
      note: "==只存 SP、BP、PC。=="
```

`steps[]` 里每项：`title`（这一步的标题）、`code`（等宽代码行数组）、`kernel`（内核视角那一行，
建议每一步都写同一句，让「没变」自己显形）、`curg`（此刻在跑的 id）、
`cpu`（PC/SP/BP/LR 和一句注释）、`g1` / `g2`（每个任务的 `st` 状态、`tone` 配色、`where` 在哪、
`buf` 为 `null` 表示现场在寄存器里）、`note`（支持 `==` `**` 行内标记）。

> 固定两栏任务卡是刻意的：这个控件的卖点是「两个任务互相交接」，不是画任意多个。

#### `handoff-lab` —— 同样是等，代价不一样

**讲「两条路径的成本差」**：一根滑块拖动「同时阻塞的数量」，
左右两栏的 M 数量分道扬镳。

```demo
widget: handoff-lab
title: 同样在等，M 的数量不一样
actions: false
config:
  gomaxprocs: 4
  blocked: 30
  max: 120
```

左栏 = 等待被某种 poller 吸收（M 数量不变），右栏 = 每个等待都要一个执行体陪着沉下去
（M 线性膨胀）。`gomaxprocs` 是基线，`max` 是滑块上限。

> 它在讲一件很通用的事：**「等」有两种 —— 能被事件驱动接管的，和不能的。**
> 缓存未命中、锁竞争、外部 API 调用，都能套这个模型。

#### `gmp-lab` —— 一个真的会跑的迷你调度器

**讲「有队列的调度器」**：点「跑一步」，看每个执行许可怎么取任务、怎么从别人那儿偷、
被阻塞的任务又挂到哪儿去。它不是动画 —— 背后就是一份简化过的 `schedule()`。

```demo
widget: gmp-lab
title: GMP 调度台
actions: false
config:
  gomaxprocs: 3
  goroutines: 16
  ioRatio: 0.4
  seed: 7
```

`gomaxprocs` 是执行许可的个数，`goroutines` 是任务总数。
`ioRatio` 控制多大比例的任务会先去等外部事件，`seed` 固定随机种子让结果可重放。

创建时**所有任务都落在第一个许可的队列里**（新任务挂在创建者身上）——
这是刻意的：一边倒才是真实常态，也让工作窃取立刻可见。

> 换个领域也能用：只要那个东西是「一堆任务 + 若干执行许可 + 本地/全局两级队列」。

#### `handoff-lab` —— 同样是等，代价不一样

**讲「两条路径的成本差」**：一根滑块拖动「同时阻塞的数量」，
左右两栏的「陪着沉下去的执行体」数量分道扬镳。

```demo
widget: handoff-lab
title: 同样在等，数量不一样
actions: false
config:
  gomaxprocs: 4
  blocked: 30
  max: 120
```

左栏 = 等待被某种 poller 吸收（数量不变），右栏 = 每个等待都要一个执行体陪着沉下去
（数量线性膨胀）。`gomaxprocs` 是基线，`max` 是滑块上限。

> 它在讲一件很通用的事：**「等」有两种 —— 能被事件驱动接管的，和不能的。**
> 缓存未命中、锁竞争、外部 API 调用，都能套这个模型。

#### `spawn-budget-lab` —— 同样的任务数，两条路的固定成本

**讲「规模效应」**：一根滑块从十个任务拖到一百万个，左右两栏同时算三件事 ——
内核里有多少个调度实体、栈要预留多少、切换一次多少钱。

```demo
widget: spawn-budget-lab
title: 10 个任务到 100 万个任务
actions: false
config:
  stops: [10, 100, 1000, 10000, 100000, 1000000]
  p: 10
  threadStack: 8
  gStack: 2048
  start: 3
  tail: 线程栈按 8 MiB 保守算，是虚拟地址预留；G 的 2 KiB 是 stackMin。
```

`stops` 是任务数档位；`p` 是左栏线程数固定为 P 的那一栏（G 这边同时跑 Go 代码的线程数）；
`threadStack`（MiB）和 `gStack`（字节）是两个方案的单任务成本。
滑块下面会按档位换一句判断，`tail` 是固定脚注。

> 它不绑定 Go：任何「一个任务一个执行体」和「一个任务一条记录」的方案都能套。
> 数字是算出来的，别拿它当实测 —— 实测写进 `tail`。

#### `ipc-flow-lab` —— 几种机制的数据流并排跑

**讲「同一件事，不同实现路径」**：每一列都是同构的三格（发送方 / 中转站 / 接收方），
点「下一步」同步推进，看数据停在哪一格、计数怎么变。

```demo
widget: ipc-flow-lab
title: 同一份数据，三种走法
actions: false
config:
  payload: hello
  interval: 900
```

控件里**写死了三个机制**（管道 / 消息队列 / 共享内存），因为它们的步数被刻意对齐成一样
（0~3 步），这样三列才能同步对比。想换领域的话，得改 `app.js` 里那份 `COLS`。

每一步要提供：`at`（数据在哪一格：`a` / `k` / `b`）、`copy`（累计拷贝次数）、
`sys`（累计系统调用次数）、`what`（这一步在干什么）。
每列还要给中转站的 `kLabel` / `kNote` —— **有差别的只有中间那一格**，所以它值得单独写。

#### `runtime-timeline` —— 一行一个进程，看谁常驻谁一次性

**讲「生命周期」**：横轴是时间，一行一个进程。想说明「A 是长期依赖、B 只是来一趟」时，
一条时间轴比任何分层图都清楚 —— ==长度差得一眼就看见==。

```demo
widget: runtime-timeline
title: 创建、重启、删除：谁在，谁不在
actions: false
config:
  tMax: 8
  procs:
    - id: containerd
      name: containerd
      sub: 一个节点一个
      note: ==重启它，容器照跑==
      spans: [[0, 5], [6, 8]]
    - id: runc
      name: runc
      sub: 建进程用的
      note: 一次性，建完就退出
      spans: [[2, 3]]
  steps:
    - { at: 0, what: 机器刚起来，只有管理平面 }
    - { at: 2, what: containerd fork 出一个 runc }
```

- `procs[].spans` 是**左闭右开**的区间数组 —— 一个进程可以有**多段**（上面 containerd
  在 5~6 之间断了一下，用来表达「重启」）
- 生命周期只有 1 格的进程会自动标上「只存在一瞬间」
- `steps[].at` 是时间点，推着走的时候：还没出现的行整体变淡、已经消失的行**保留它的条子**
  （==那样才看得出它曾经存在过多久，否则「一次性的」和「从没出现过」就分不清了==）

> **`note` 是点开给好奇的人看的**：某一行还活着时才显示。
> 面板上的 `what` 是主线，`note` 是「它到底是个什么角色」。

#### `ns-view` —— 两个视角，两套视图

**讲「同一套东西，换个视角就变样」**：一排卡片，每张是一类「你会看到什么」。
上面切视角，整组一起刷掉；==哪几张变了，就是哪几类东西被隔离着==。

```demo
widget: ns-view
title: 同一台机器，切换视角看同一批命令
actions: false
config:
  views:
    - { id: host, name: 站在宿主机上, sub: root@web-node-01 }
    - { id: ct, name: 站在容器里, sub: root@3f2a8c1b9e04 }
  facets:
    - id: proc
      cmd: ps aux
      ns: pid
      tone: blue
      host: ["root 48213 nginx: master", "…共 137 个进程"]
      ct: ["*root   1   nginx: master", "*…共 3 个进程"]
```

- `facets[].host` / `ct` 是**两个视角下的输出行**，一一对应
- 行首写 `*` 的那一行会被加粗 —— 用来标「这一行是重点」
- `facets[].ns` 是右上角那个小标签，写清楚**是哪类 namespace 在管这一栏**
- `facets[].tone` 决定左边色条，用同一个色系表示「这是同一类东西」

> 换个领域照样能用：只要那个东西是「同一批对象，在不同作用域下看到的不一样」——
> 多租户的视野、权限过滤后的列表、feature flag 开关前后的界面。

#### `epoll-tables` —— 两张表就是 epoll 的全部

**讲「登记」和「就绪」是两件事**：左边的格子点一下 = 这个 fd 来数据了，它自己跳到右边。
==那个「跳」就是内核回调干的事，不是遍历找出来的。==

```demo
widget: epoll-tables
title: epoll 的全部就是这两张表
config:
  conn: { min: 8, max: 40, step: 4, def: 24 }
```

左边是**登记表**（`epoll_ctl` 登记一次，一直在），右边是**就绪表**（谁有数据谁挂进来）。
点「`epoll_wait()`」把右边清空并计数 —— 格子回左边，因为**登记还在，只是不再就绪**。

底部两行是重点：`select / poll` 每轮都要碰**全部** N 个，`epoll` 只看右边挂了几个。
拖连接数，两行的差距越拉越开。

> 换领域照样能用：任何「**一次登记、长期有效**」vs「**每次都要重交**」的对照 ——
> 订阅制 vs 轮询、watch vs poll、推送 vs 拉取。

#### `lt-vs-et` —— 缓冲区还有数据，但你不知道

**讲「就绪 ≠ 数据到手」**：跑一遍 LT，再切 ET 跑一遍，看第二轮的差别。

```demo
widget: lt-vs-et
title: 缓冲区还有数据，但你不知道
config:
  total: 128
  chunk: 64
```

推荐路径：**数据到达 → `epoll_wait` → `read` 一次 → 再 `epoll_wait`**。

- **LT**：第二次还会返回这个 fd（缓冲区还剩一半，内核把 fd 挂回了就绪表）
- **ET**：第二次返回 0，而缓冲区里明明白白还剩 64 字节 ——
  ==那条红色警告「你的线程在 epoll_wait 上睡得很安稳，那份数据没人管」就是 ET 最经典的 bug==

切模式时会**清空缓冲区但保留日志** —— 缓冲清空是为了让两次实验可比
（否则「你的应用缓冲区」会把两次的读入量加起来），日志留着正是为了对照。

#### `code-and-stacks` —— 一份代码，N 个执行现场

**讲「线程不会复制代码」**：上面一份代码段，下面 N 张栈。
==那个 `char buf[1024]` 有几份线程就有几份 —— 它在各自的栈上。==

```demo
widget: code-and-stacks
title: 一份代码，N 个执行现场
config:
  threads: { min: 1, max: 6, step: 1, def: 3 }
```

点任意一张栈 = 让它阻塞在 `read`。用来演示**一个线程等的不是别人**：
它自己停住，其余线程照跑，因为它们执行的本就是同一份代码，互不干扰。

代码块的内容是**写死的**（`handle_request` 那五行）—— 这个控件是为这一个例子做的，
不是通用代码查看器。要换例子得改 `LINES` 数组。

> 换领域照样能用：任何「**共享的东西只有一份、每个执行者各有一份现场**」的结构 ——
> 一份配置 + N 个 worker 的运行时状态、一份 schema + N 个租户的实例。

#### `thread-audit` —— 拆掉「一万线程 × 8MB = 80GB」

**讲「亏的不是内存」**：拖连接数，盯住「内存」和「调度器要管的实体」两行的差别。

```demo
widget: thread-audit
title: 一连接一线程，亏的到底是什么
config:
  conn: { min: 100, max: 50000, step: 100, def: 10000 }
```

按 32 KB/线程实算：一万个线程才 **313 MB**，一点都不吓人。
==难看的是「调度器名单上有 10000 个实体，其中 9900 个什么也没干」。==

> **这个控件有一半的功能是「纠正」而不是「展示」**：内存那一行给绿色，
> 「在等」和「调度实体」两行给红色。颜色本身就在表态。
> 做这类控件时值得照搬 —— 屏幕上的红绿比正文里的一句「其实不是这样」有说服力得多。

#### `poll-lab` —— 一个滑块，让两个病一起恶化

**讲「一个线程挨个问过去」**：格子默认全是灰的 —— 因为在问之前，**线程并不知道谁有数据**，
这正是它必须一个个问过去的原因。跑完一轮再看那片格子，一片灰里几个绿点。

```demo
widget: poll-lab
title: 一个线程挨个问过去
config:
  conn: { min: 8, max: 200, step: 4, def: 64 }
  busy: { min: 5, max: 100, step: 5, def: 10 }
```

`conn` / `busy` 各是一个滑块的 `{ min, max, step, def }`。

**「这格有没有数据」是按格子下标算的稳定散列，不是 `Math.random`。**
==同一组参数必须每次渲出同一个画面==，否则截图没法比对、自检也会飘。
散列用 Knuth 黄金比例乘数 `(i * 2654435761) >>> 0`，分布够散且完全确定。

上半是白问（`绿 = 有数据 / 粉 = 白问`），下半是**每次调用要重交多少份名单** ——
两个数字由同一个 `conn` 驱动，所以拖一下就能看到「连接数一涨，两件事一起变差」。

> 换领域照样能用：只要那个东西是「**用执行资源去承载等待**」——
> 忙等锁、同步 RPC 的线程池、任何「问一遍才知道」的轮询。

#### `cg-limit` —— 配额卡不住的时候，两种资源的结局不一样

**讲「超限的后果」**：进程想要多少是固定的，拖的是给它多少配额。
==然后你会看到内存超了直接被杀、CPU 超了只是变慢== —— 这两件事完全不一样。

```demo
widget: cg-limit
title: 拖配额，看进程的两种结局
actions: false
config:
  demand: { mem: 1229, cpu: 2.5 }
  mem: { min: 256, max: 2048, step: 64, def: 1024 }
  cpu: { min: 0.25, max: 4, step: 0.25, def: 3 }
```

`demand` 是「进程想要多少」，两个滑块是「你给它多少」，判定就是简单的比大小。
下面那张 `cgroup 文件` 表是**按当前滑块值算出来的**（`cpu.max` 会换算成 `配额 周期`），
不是写死的文案。

> 它讲的是一个很通用的形状：**同样是「不够用」，有的资源只能给或不给（死了），
> 有的可以切分和延后（慢了）。** 内存 vs CPU、连接数 vs 带宽，都是这个区别。

#### `innodb-visual-lab` —— 查询页路径、页内查找与索引优化

```demo
widget: innodb-visual-lab
title: 访问哪些页，哪些页需要读盘
actions: false
config:
  mode: path
```

`config.mode` 可选 `path`（逐页导航与缓存切换）、`page`（页内物理偏移与逻辑键序）、`joint`（字典序区间）、`optimize`（覆盖/ICP/MRR）、`split`（页分裂）。所有数据是教学示意，不连接数据库；逻辑页访问和缺页加载分别计数，回表不冒充真实 IO。

#### `schema-walk` —— 沿着一列在几张表之间走

**讲「表跟表怎么连」**：中间是当前这一行，左边是它用哪些列指着别处，
右边是谁指着它。点任意一张卡，那一头变成新的中心，路径记在面包屑上。

```demo
widget: schema-walk
title: 顺着列名走一遍
start: city
hint: |
  ==点左右两边的卡就接着往下走==，路径记在面包屑里。
records:
  - id: city
    table: crm_dc_data_field
    title: city
    fields:
      - [id, 33]
      - [value_set_id, 32]
  - id: vs
    table: crm_dc_value_set
    title: city
    fields:
      - [id, 32]
      - [set_key, city]
edges:
  - { from: city, to: vs, via: "value_set_id = 32" }
```

- `records[].fields` 是 `[键, 值]` 数组，值那栏等宽显示；写 `NULL` 会变灰
- `edges[].via` 是卡片底下那行灰字（写「靠哪一列连的」）
- `jump` 是可选的一层旁注：给某个邻居加一句「为什么值得点过去」
- `records[].off: true` 给卡片换一条黄色左条（表达「这一行已停用」这类状态）

> 换领域也能用：只要那个东西是「**一批带主键的记录 + 记录之间互相引用**」——
> 外键图、模块依赖、组织架构、文件互相 import，都是这个形状。

#### `two-path-lab` —— 一条指令为什么要走两遍内存

**讲「取指令和取数据是两条独立通道」**：两条泳道并排（通道 A 取指令、通道 B 取数据），
点一步两边同时前进。通道 B 只在「解码」那一步才启动 —— 这是最常见的那处卡点。

```demo
widget: two-path-lab
title: 同一条 x + 1，两条通道各走一遍
actions: false
```

- 三个页签是三条路线：全局变量 / 栈上的局部变量 / 已被编译器优化掉。第三档里整条通道 B 不启动
- 每步的 `a` / `b` 是两条泳道各自的阶段下标，`-1` 表示这一条还没参与；`skipB: true` 会把通道 B 整条调暗
- 地址和每一步的说明写在 `MODES[].steps[]` 里（`aSub` / `bSub` / `note`），改内容直接改 `assets/app.js`
- 它不是 `config` 驱动的：和 `micro-op-lab` / `rip-lab` 一样，数据就写死在控件里

> 想讲别的「两条并行通道」——读路径与写路径、用户态与内核态、请求与响应 ——
> 复制这个控件改 `A_STAGES` / `B_STAGES` 和 `MODES` 就行，外壳不用动。

### 数据驱动的写法（`config`）

上面三个控件都用 `config`，作者**只写 YAML，不写 HTML**：

- `panes` → 双栏日志式（配合日志型控件）
- `html` → 作者手写标记，控件只负责接线
- **`config` → 控件自己渲染整个 body（推荐）**

`config` 会序列化成 JSON 塞进 `data-config`，控件用 `cfgOf(root)` 读。

**控件自己渲染的文本要支持行内标记时，用 `richText(host, text)` 写进节点**，
别拼 `innerHTML`：`config` 走的是 JSON，构建期不会替你解析 markdown，
拼进去的 `**加粗**` 会按字面显示（`row-to-catalog` 的规则注释踩过一次）。

---

## 16. `arch` —— 内联 archify 生成的图

archify 负责底图：零件放在哪、区域怎么套、线怎么绕、字会不会撞。页面上的整体图再按解释需要补区域含义、节点内容、点选说明和导览，帮助读者把局部放回全貌；涉及运行过程时，也在底图上标清方向。

### 页面上有的

| 能力 | 说明 |
|---|---|
| **语义类型** | 节点声明 `type`（backend / database / cloud / messagebus / security / external），自动带图标 + 配色 |
| **自动图例** | 按用到的 `type` 自动汇总，不用手写 |
| **精确区域框** | `boundaries` 自动包住成员，标签嵌在框线上 |
| **真边路由** | 折线绕行，不是两点直连 |
| **校验器** | ==量文字宽度、检测标签碰撞、给坐标级修复建议== —— 这是底图最值钱的部分 |
| **点选聚焦** | 点一个零件，看它和相邻的边。空白处取消 |

archify 查看器的预设切换、引导视图和动画控制没有接入内联页面。`meta.visual_preset` 的部分静态 SVG 样式会随底图保留，例如 blueprint / editorial 的网格和区域样式，但不等于完整预设体验。`meta.views` 的导航和 `meta.animation: "trace"` 的动画运行时未接入；SVG 保留属性不代表页面支持相应交互。页面上的导览用 `tours`，不靠查看器能力补全图义。

### 整体图的默认配置

效果见 [原则 ② · 整体图](../SKILL.md#原则-②-整体图)，版面和验收见 [原则 ⑩](../SKILL.md#原则-⑩-版面服务阅读图按内容铺开)。默认把整体图做丰富，但先判断每项增加什么解释价值，不把字段数量当验收标准。

1. **宽的手工底图。** 顶层不写 `layout`，零件写 `pos`，按目标页面可用宽度排。要铺开时，改源 spec 的 `meta.viewBox: [宽, 高]`，同时重排 `pos`、`size` 和路由，再生成 SVG；只扩画布不会自动重排。
2. **`frames`。** 按真实分类、包含或逻辑归属声明区域。再加一层，就要多一条原先看不见的归属；没有需要解释的区域时可以省略，不虚构层级或共用区。
3. **`bodies`。** 关键零件要有自己的结构和量，通常用这个字段放进格子：有几个、多大、朝哪长、属于谁。省略其他交互不能把关键节点收成一行名字。
4. **格子上的 `link` / `tip`。** 有真实跳转对象时写 `link`；需要一句补充说明时写 `tip`。无跨节点引用时，可以只写提示或不设格子入口，不为了可点而编造关联。
5. **`parts`。** 复杂图默认提供零件的作用、详细说明和关系面板。全图上的名字和主要关系仍然要看得见；面板不代替真实连线，也不会恢复被省略的可追踪邻居。
6. **`tours`。** 复杂图默认至少一条，每条只讲一个问题。运行图沿实际路径走，静态图按归属层级或理解顺序走，不强造运行方向或因果链。

这些是写作默认，不是字段全部必填。省略前确认该配置不增加解释价值：简单图已经能直接读懂，就可以不加面板或导览；有真实多级归属就展开，不为省事压掉层级。即使省略交互，关键节点仍要有内容，全貌和主要关系仍能在图上读出。

同一张图上要比较不同状态，写 `scenarios`。要并排看两个零件，写 `parts.<id>.facts`。小图可以只写 `svg` 和 `caption`；需要讲结构和机制的整体图不能只停在名字与连线。

### 它能画 5 种底图

由 spec 里的 `diagram_type` 决定（`tools/archify.mjs` 会自动读，不用在命令里传）。整体图用 `architecture`。有运行过程时，把方向画在这张图的箭头上，不为了顺序另造一张位置不同的地图；节点尺度讲不清楚的局部，仍可以保留位置和对外关系后补详解。

| diagram_type | 底图画什么 | spec 里的主数组 |
|---|---|---|
| `architecture` | 零件、区域、关系。整体图用这一种 | `components` · `boundaries` · `connections` |
| `sequence` | 调用链、握手 | `participants` · `messages` · `activations` |
| `workflow` | 跨角色的流程 | `lanes` · `phases` · `mainPath` · `nodes` · `edges` |
| `dataflow` | 流水线、血缘 | `stages` · `nodes` · `flows` |
| `lifecycle` | 写死的阶段带 + 结局带 | `lanes` · `states` · `transitions` |

写法参考 `~/.agents/skills/archify/examples/*.<type>.json`。通用状态机用 `flow`（`shape: pill`），不用 `lifecycle`。

### 什么时候用

要把握一件事的全貌、层级和对象关系，局部格子里还要有细节，就用 `arch` 的整体图。按上面的默认配置判断每项是否适用；有运行过程时，同时画清整体方向。

| 要表达的 | 用什么 |
|---|---|
| 一件事的全貌、层级、对象关系，局部里还有细节 | `arch` 的整体图；涉及运行时同时标清方向 |
| 只剩一条没有位置、没有归属的短顺序 | `flow` / `lane-stack` / `seq` |
| 同一个东西从 X 变成 Y | `journey` / `flow` |
| 按维度对比，或并列而没有指向 | `compare` / `cards` |
| 通用状态机 | `flow`（`shape: pill`） |

### 它的硬边界（踩过）

- **边不能穿过无关节点。** 直接报 `crosses component "xxx" (unrelated to this relationship)`，
  ==它不会帮你绕过去==。先改布局，或手填 `route` / `via` 航点。同一整体不因为线穿节点就拆散；彼此独立的主题按原则 ② 分开。
- **组件尺寸是每个显式声明的**（默认 120×60），不随 `layout.cellW` 变。
  标签长了要么裁文案，要么给它加 `size`。
- **边有几何下限**：微段短于 8px、两条边挤在同一条走廊里，都会判失败。
- 产出是**静态 SVG**，不跟着容器宽度重排（靠 viewBox 缩放）。
- **同一页可以有好几张 arch 图，而每张图自带的 id 是固定的**（`arrowhead` / `grid` /
  `archify-diagram-title` / `node-*`）。HTML 要求 id 全页唯一 —— 不加前缀时，
  后面几张图的 `url(#arrowhead)` 和 `aria-labelledby` 都会落到**第一张图**上。
  今天各图定义一样所以看不出来，但读屏会把它们的图名念成第一张的；哪天某张图换了箭头，
  它改了也不生效。

  ++解法在构建期，不在图源：++ `arch` 内联时给全部 id 加图名前缀（定义、`url(#…)`、
  `href="#…"`、`aria-labelledby` 里的每个 token 一起改），同一张图在同一页出现两次时自动加序号。
  `assets/arch/*.svg` 本身不用重生成。同理 `flow` / `seq` 的箭头改成按图唯一的 id + 
  CSS 变量（`--flow-marker` / `--seq-fill` / `--seq-open`）。

  ==`npm run check` 会扫全页重复 id，直接报出来== —— 新增积木时若在模板里写死了 `id="xxx"`，
  这一步会拦下。

下面是最小格式示例，不是整体图的完整交付标准。

```arch
svg: core-package
caption: packages/core 的组成与数据流
```

| 键 | 说明 |
|---|---|
| `svg` | **必填**。对应 `assets/arch/<名字>.svg`，由 `tools/archify.mjs` 生成 |
| `caption` | 格式可选，图注走行内 Markdown；整体图用它指引阅读入口 |
| `maxScale` | 可选有限正数，默认 1。画布最大宽度 = SVG viewBox 宽 × maxScale；空间不足时按实际 CSS 缩小或在已有通道内滚动。默认不自动放大，显式大于 1 会等比放大节点和字号。新整体图优先重排源布局；pt-map 的 0.87 只属于那张获批图 |
| `frames` | 格式可选，写作时按真实区域关系配置。区域可点，显示祖先路径，可在一层 / 多层之间切换；不声明就不增加区域控件，见下面「多层区域」 |
| `parts` | 格式可选，复杂整体图默认配置。`{ <零件id>: { label, sub, detail, code } }`，键要**和 spec 里的组件 id 一致**；`code` 可选，是纯文本代码（`pre` 渲染，不走行内标记），放在说明之后、关系列表之前 |
| `tours` | 格式可选，复杂整体图默认至少一条。`[{ id, label, steps: [{ at: [零件id...], text, code }] }]`，按运行路径或理解顺序推进；`code` 可选，渲染在说明文字下面 |

#### 多层区域：节点外部也能逐层展开

spec 的 `boundaries` 负责几何；note 的 `frames` 负责区域含义和父子关系。
`wraps` 仍然只写**节点 id**，父框列全体后代节点，不把区域 id 塞进 wraps。

```json
"boundaries": [
  { "kind": "region", "label": "进程资源域", "wraps": ["heap", "task"], "pad": 78 },
  { "kind": "region", "label": "用户态", "wraps": ["heap"], "pad": 40 }
]
```

```yaml
svg: pt-map
maxScale: 0.87
frames:
  - id: process
    boundary: 0
    kind: logical
    label: 进程 A · 逻辑资源域
    detail: 用户态映射和关联内核对象共同组成资源域，不是一块连续内存。
  - id: user
    boundary: 1
    parent: process
    kind: classification
    flat: true
    label: 用户态 · 同一块虚拟地址空间
    detail: 代码、堆和用户栈属于同一地址空间；mm_struct 在内核。
```

上面是字段片段；可运行的完整八区域示例是 `notes/process-thread-relation/note.md` 的 §01。

| frames 项 | 含义 |
|---|---|
| `id` | 图内唯一的区域 id，与节点 id 不混用 |
| `boundary` | spec.boundaries 的 **0 起始下标**；改数组顺序时一起核对 |
| `parent` | 可选，父区域 id；省略表示根区域 |
| `kind` | 必填：`contains`（组成）、`classification`（分类）、`shared`（共享区）、`logical`（逻辑域）；与 spec.boundaries.kind 不是同一个字段 |
| `label` | 可选，覆盖图上区域标题；省略用生成 SVG 的标题 |
| `detail` | 必填，点区域时说明这一层为何分组。逻辑域、共享区必须标清限定条件 |
| `flat` | 可选布尔值，默认 false；切到「只留一层分区」时保留哪些区域 |

父区域可以包含子区域和直接归属节点，不要求每个节点的深度相同。
一个共享资源只画一份，用连线说明引用，不能复制进多个使用者的框。

**生成与检查链**：

1. `node tools/archify.mjs archify/<名字>.json <名字>` 先通过 archify showcase 校验。
2. 提取 SVG 时恢复成员包围盒 + pad，保存 `data-frame-members`；如 bottom 超出画布，只扩高，不挪节点。
3. `arch` 构建阶段用 `frames.parent` 检查父子环、成员、完整包含、同级不相交、父子标题至少间隔 24 画布单位。
4. 最终页面仍需 `visual-check` 和截图，按原则 ⑩ 检查目标视口。页面有 `frames` 时可用 `node tools/probe-arch.mjs <slug>` 检查本篇；当前探针只操作第一张带 `frames` 的图，自动覆盖 1280 / 1920 / 500 三档宽度及双主题，不等于其他图也已验收。没有 `frames` 的页面不能拿它当通用 arch 探针。
   修改共享区域或内联 id 策略时，再用 `process-thread-relation` 与同时有 flow / seq / arch 的笔记（例：`mysql-sql-execution-flow`）作回归样例。
   基图校验不覆盖后处理、实际字号或点击状态，不能代替最终页面检查。

沿用获批首图的三层 pad：40 / 78 / 122。它们是本图实测值，不是通用模板；
画布边缘先留余量，父子标题各有独立带，底边不能贴合。内框 pad 太小会让标题藏在节点后面。

**交互**：

- 点区域标题：解释分组依据，点亮成员；键盘 Enter / Space 同样可用。
- 点零件 / 格子：保留祖先框，并在画布上方显示完整归属路径。
- 一层 / 多层切换只改变边界显示；节点、内容与连线位置保持不变。
- 导览、取消聚焦、恢复全图共用同一张地图，不另画近似版。
- 当前 `blocks.css` 在视口 ≤700px 时，为带 `frames` 的 arch 图保留最小画布并提供局部横向滚动；没有 `frames` 的图没有这条专用滚动规则。SVG 自适应等比缩放不等于内置缩放控件，内联页面没有搬入 archify 查看器的缩放操作。
- 默认同一种虚线语言；标题、留白、轻底色和虚线节奏分层，不每层铺一种鲜艳色。

#### `parts` 和 `tours`：点进局部，按问题导览

底图几何和走线由 archify 负责。`parts` 和 `tours` 不另画一张图。全图先给出全貌、层级和主要关系；有运行过程时标清方向。`parts` 用来点开一个零件看说明和实际连线关系。`tours` 围绕一个问题按运行路径或理解顺序推进。

archify 的查看器不做这两样，它做的是聚焦和 Semantic Passport。曾经有过一排「我熟悉 ___」按钮（`anchors`），2026-10-12 下线：点下去和自由点选是同一个动作。旧笔记里的 `anchors:` 不再渲染，check 会提醒删掉。

| 字段 | 他得到什么 | 怎么用 |
|---|---|---|
| `parts` | 这个零件的说明，以及图上实际连线的含义 | 配了零件说明时，点它后列出「它指向谁 / 谁指向它 / 那根线什么意思」 |
| `tours` | 围绕一个问题按运行路径或理解顺序看图 | 一步一步高亮本步所需零件，配一句解释 |

全图、点选和导览共用同一份 SVG。不为每条路径另造一张位置不同的地图。整体图按前面的默认配置提供内容和语义层，不增加解释价值的交互可以省略，小图可以只写 `svg` 和 `caption`。

点选邻域和面板关系列表只读取 SVG 中实际画出的边。代表线省略的关系不会因写入 `parts.detail` 就自动成为邻居；需要代表线时，标清基数和代表范围，用完整关系表补全，并在图注说明点选限制。需要逐对象追踪完整关系时，保留真实边。

全貌、实际运行方向、什么时候另补详解、什么时候分开独立主题，见 [原则 ② · 整体图](../SKILL.md#原则-②-整体图)。格子里装什么，见下面的 `bodies`；是否补详解看节点尺度能否讲清楚，不只看文字能否放下。

写这两段时，检查下面几件事：

- `parts` 解释节点的作用和关系；详细说明放面板，节点名称和主要关系仍在全图可辨
- `tours` 可以有多条，但每条只讲一个问题；每一步的 `at` 只列本步所需对象，不反复点亮大半张图
- 自由探索、导览、取消聚焦之间切换时，不移动节点、不重排区域；随时能回全图
- 聚焦只降低无关对象的视觉权重，不能代替修复文字重叠或边穿节点
- 面板文本支持 `==高亮==` / `**加粗**` / 行内代码标记，且==可以嵌套一层==（比如在高亮里再放代码）——
  以前不支持，嵌套会把内层反引号按字面显示（2026-10-10 修的 `richText`，见 `assets/app.js`）

```yaml
# 例：server-code 首图，在同一张地图上讲连接建立与交付
svg: conn-establish
parts:
  conn:
    label: 连接 socket
    sub: 握手完成就建好了
    detail: ==它出现的时候，还没有 fd，也不属于任何进程。==
tours:
  - id: establish
    label: "一条连接的一生"
    steps:
      - { at: [calls, lsock], text: "起手三件事，内核里出现==一个监听 socket==。" }
      - { at: [conn], text: "==握手完成的那一刻，内核就把连接 socket 建好了== —— 但还没有 fd。" }
```

**`code` 字段（2026-10-11 加）：** 导览步和零件面板都能带一段代码，用来回答「这一步的代码落在哪」。
说明文字走 `richText`（行内标记），代码走纯文本 `pre`（`textContent`，不解析标记，横向溢出给滚动）。
写法上代码要短（几行到十几行）、带中文注释、用真实函数名；代码里的注释想强调就用 `// ←` 这种箭头，
别往里写 `==`（不会解析，会按字面显示）。

**`bodies` 字段（2026-10-11 加）：往节点矩形里装内容。**

整体图的关键零件要有内容，通常用 `bodies`。零件数 ≥ 12、又没写 `bodies` / `scenarios` 时，`npm run check` 会打一条 `·` 提醒（不阻塞），说这张图现在是目录风格；这不是字段必填校验。少于 12 个也可以是目录：只有一行名字，局部里就没有细节。示例：`notes/process-thread-relation/note.md` 的 §01。

==archify 的节点只认三行居中文字（label / sublabel / tag）。== 于是一张整体图不管多少零件，
画出来都是「一堆小矩形 + 一行字 + 一些线」—— 读者拿到的是一张**目录**，不是地图。

而节点该说的话往往不止一句：fd 表里有哪几个 fd、CPU 四个核在跑几个、
地址空间从高到低分成哪几段、一个 task 的现场存了哪几样。
那些是**结构**和**量**，塞进一行 sublabel 就只剩名词。

```yaml
bodies:
  files:
    badge: ② 全组共享
    cells:                                   # 小格子：有几个、哪个在跑
      - { label: fd 0, sub: stdin }
      - { label: fd 3, sub: socket, tip: A 线程 open 的 fd，B 立刻看得见 }
    note: 进程里任何一条执行流都能用这些 fd
  mm:
    badge: 每进程一张表
    stack:                                   # 高低段：带地址、带方向的结构
      - { label: 栈 · 向下长, mark: 0x7fff…, link: ustacks, tip: 线程栈是 mmap 出来的另一块 }
      - { label: 堆 · 向上长（brk）, link: heap }
    pairs:                                   # 左右映射：这边是什么，那边变成什么
      - { from: VA 0x601000, to: 帧 42, note: A 的 x = 1 }
```

| 内容 | 用来讲 | 字段 |
|---|---|---|
| `badge` | 右上角一个短标记（全组共享 / 每线程一根） | 字符串 |
| `rows` | 键值行：一个对象有哪几样字段 | `[{k, v}]` 或 `[[k, v]]` |
| `cells` | 有几个、哪个在跑、哪个空着（`tone: idle` 是空位） | `[{label, sub, tone}]` |
| `bars` | 按比例分的东西（一条横条带） | `[{label, weight, tone}]` |
| `stack` | 有地址、有方向的段（地址空间、栈） | `[{label, mark, tone}]` |
| `pairs` | 左右两栏 + 一条箭头（VA → 物理帧） | `[{from, to, note}]` |
| `meter` | 用了多少 / 一共多少 | `{label, value, total, text}` |
| `code` | 一行真实代码，把机制对到函数名 | 字符串 |
| `note` | 末行小字 | 字符串；或 `notes: [{when, text}]` 按场景各写一句 |

**结构化内容项可以变成「可点的格子」**：`rows` / `cells` / `bars` / `stack` / `pairs` 的对象项，以及 `meter`，可按需要写 `link`（一个真实目标零件 id）和 `tip`（悬停的一句话）。
渲染出来带 `data-nb-spot` / `data-nb-link` / `data-nb-tip`，`app.js` 接上 hover 提示与点击聚焦。
两字段都可省略；只写 `tip` 时，点击聚焦它所在的零件，不会凭空得到跨节点关系。入口从「整个零件」细化到「零件里的一行」：点 `mm` 里的「mmap 区」→ `ustacks` 节点亮起。

**`scenarios` + `when`：同一张地图演两种状态。**

```yaml
scenarios:
  - { id: one,   label: 1 条执行流, note: execve 刚返回，只有主线程, dim: [task1, task2] }
  - { id: multi, label: 3 条执行流, note: pthread_create 之后 }
bodies:
  cpu:
    cells:
      - { label: T0, sub: 在跑 }
      - { label: T1, sub: 在跑, when: multi }
      - { label: 空闲, tone: idle, when: one }
    title:
      - { when: multi, text: 用户栈 ×3 }
      - { when: one,   text: 用户栈 ×1 }
```

`when` 能加在任何一项上（row / cell / seg / stack 段 / pair / note），也能加在 `title` 上。
==切场景不是把元素藏起来，而是按场景各排一遍版== —— 藏起来会留下空洞（一排格子少一个就歪了）。
节点高度取最胖的那一版。场景还能声明 `dim: [零件id]`：这个状态下**还没出现**的零件变淡（不消失）。

**`facts`：挑两个零件比一比。**

```yaml
parts:
  heap:
    facts: { 归属: 全组共享, 份数: 一份, 跟着谁走: 随进程, 隔离: 同一张页表——谁也不挡谁 }
  ustacks:
    facts: { 归属: 每条执行流一根, 份数: 3 根, 跟着谁走: 随线程, 隔离: 同一张页表——私有只是约定 }
```

页面就多出一个「对比两个零件」按钮：点两个零件，下面出一张对照表（顺序按声明先后）。
==键名要跨零件通用==（归属 / 份数 / 谁在用…），否则表格里全是「—」。

```compare
first: 这三个字段共同的坑
head: [症状, 怎么办]
rows:
  - 内容装不下:
      - "渲染到框外，看着对、其实挤出去了"
      - "==构建期直接报错==，并告诉你 size 第二项该给多少。改 `archify/<图>.json` 的 size"
  - "写了 `when` 却没写 `scenarios`":
      - "图会按「所有情况都画上」排，页面却没有开关能切"
      - "构建期报错。要么补 `scenarios`，要么去掉 `when`"
  - 行高看着很空:
      - "内容少、框很高"
      - "内容会垂直居中 + 末行小字钉底部；实在空就先删内容，或按 `requiredHeight` 把 size 改小"
```

**三个都依赖「零件 id 和 archify spec 里的组件 id 一致」。** 写错的表现是：
按钮点了没反应、或者面板里显示成 id。
==所以改图的时候，`archify/*.json` 和 note 里的这三段要一起改。==

**`tours` 的 `at` 是数组**：一步能同时点亮好几个零件（比如「这几样是并列的」）。
它的高亮和图自带聚焦**不是一回事** —— 聚焦是「一个 + 它的邻居」，
导览是「指定的这几个」。两套逻辑都在 `assets/app.js` 的 `.archfig` 处理器里。

```callout
tone: amber
icon: 🕳
text: |
  画整体图时踩过的三个坑（`conn-cost`，2026-10-10）：

  - **想让人一眼看到的属性写进 `sublabel`，别用组件的 `tag`。**
    `tag` 在 archify viewer 里是 LENS 才展开的细字，进我们的内联 SVG 后
    是一行 7px 的 `data-detail="fine"` —— 份数这类关键标记要写在 `sublabel` 开头。
  - **一根贯穿画布的长横边会把纵向走廊切断。** 这次两列排布（一份 / N 份）中，
    跨带纵向连接与长横边相交，触发 `proper-crossing`。先调布局或改路由，
    例如让有关系的零件纵向相邻。确实采用代表线时，标清范围并补完整关系表；
    `parts` 的文字和导览能补解释，但不能恢复被省略边的点选邻域。

  画整体图时又踩的三个坑（`mysql-btree-why`，2026-10-11）：

  - **`labelAt` 是标签矩形的中心点**，不是左上角 —— 想把标签挪到某个位置时按中心算。
  - **`via` 的第一段必须垂直于 `fromSide`。** 从组件顶部出边，第一段就得竖直向上，
    否则报 `endpoint-side-direction`；航点接着拐就行。
  - **组件出口贴着 region 边框会报 `container-border-run`。** region 的 pad 会把边框
    推到组件外约 24px，==从侧边出边时让边先横向穿过边框（垂直相交），别顺着框走==；
    用 `via` 把线引到离框十几像素外的走廊里再下行。

  同一天画 `sp-journey` / `epoll-flow` 又摞了三条（都是校验器救回来的）：

  - **`via` 连接的出口/到达点取的是组件边的中心**，`via[0]` 和最后一个航点
    必须分别落在出口/到达的正下方/正上方（同一 x），否则校验器会拿真实出口
    和你填的航点拼斜线，报 `endpoint-side-direction`。校验器报错时会把
    实际出口坐标打出来 —— ==先跑一遍拿到真实出口，再把 `via` 填准==。
  - **两个连接同走一条边时，一个走直线（不加 `via`），另一个绕 `via`**；
    两个都加 `via` 会都从中心出，前一段重叠。
  - **带弯的边标签别挤在拐点附近**：`labelAt` 放到横段中点、同一水平带里
    错开 x，比 `labelDy` 盲调快；跨 boundary 的标签要留出边界线两侧的余量。
  - **两行之间那段竖直边，默认标签会落进上一行的节点里。** 缝只有 100~150px 时
    （上下两排零件之间），标签默认摆在线段中点偏上，正好压住上面那个矩形的底边，
    校验器报 `Label "…" overlaps component "…"`。直接给 `labelAt` 写在缝的中间
    （x 取列中心、y 取缝中点），比 `labelDy` 试数值快。
```

**生成步骤**：

```bash
# 1. 写 archify 的 JSON spec 放 archify/ 目录
# 2. 生成并抠图（会顺便加 --af- 变量前缀）
node tools/archify.mjs archify/<名字>.json <名字>
```

### 它自带「聚焦 + 关系追踪」

````callout
tone: green
icon: ✅
text: |
  **点图上任意一个框，只看它、它的邻居和相连的边。** 再点空白处取消。

  ==不用额外写任何东西== —— archify 抠出来的 SVG 里自带这些数据：

  ```html
  <g data-node-id="rule" data-node-kind="backend" tabindex="0" role="button">
  <path data-edge-from="caller" data-edge-to="rule" data-edge-label="① 传入条件">
  ```

  `app.js` 按属性筛一遍就有聚焦效果了（键盘也能用，Enter / Esc）。
````

```callout
tone: amber
icon: ⚠
text: |
  **archify 完整 HTML 有 627KB 的 viewer runtime** ——
  缩放、搜索、演示、导出 PNG/SVG/WebM、引导式分章（`views`）……
  我们只搬了**聚焦**这一个。

  ==因为「单文件发人」是这个仓库的底线==：抠出来的 SVG 只有 20KB，
  嵌完整 HTML 会让每篇笔记多 600KB。

  真需要那些能力时，直接跑 archify 生成独立 HTML，别走这个积木。
```

### 实现要点

==五种图都验证过能走我们的管线==（`node tools/archify.mjs` 直接吃它们的 spec）。
下面这些是「管线怎么搭的」，不是「怎么写 spec」：

- **SVG 是预先抠好提交进仓库的**，构建时不调 archify ——
  否则别人 clone 后没有 archify 就构建不了。
- `tools/archify.mjs` 会给 archify 的 CSS 变量加 `--af-` 前缀。
  ==archify 在 `:root` 定义了 32 个变量，名字和我们完全一样，不隔离会把整页变深色。==
- `assets/archify-embed.css` 是**全站共用**的，按 `assets/arch/*.svg` 的 class **并集**生成 ——
  所以多张图共存不会互相删样式，重复跑也不会变。
- 两边都用 `data-theme` 属性，所以**深浅色天然同步**，不用额外处理。
- 找不到 SVG 时**会直接报错并告诉你怎么生成**，不会静默画空白。

---

## 17. `shot` —— 构建期内联的真实截图

**什么时候用**：讲 UI 组件、讲界面行为 —— 文字和示意 SVG 都画不出来的「真实长这样」。
图先放进 `notes/<slug>/assets/<名字>.png`，构建时读出来转 base64 塞进页面。

```text
shot:
  img: portrait-row        # ← notes/<slug>/assets/portrait-row.png
  alt: PortraitRow         # 可选，无障碍描述
  caption: 构建期内联的实拍  # 可选，图注
  width: 720               # 可选，最大显示宽度 px
```

（shot 依赖 note 的 slug 定位 assets，在 skill 页里不能实渲染；可运行示例见 blocks-cheatsheet 的 16 节。）

| 键 | 说明 |
|---|---|
| `img` | **必填**。对应 `notes/<slug>/assets/<名字>.png`（名字不带扩展名） |
| `caption` | 可选。图注（走行内 Markdown），卡片底部一条 |
| `alt` | 可选。无障碍描述，默认用名字 |
| `width` | 可选。最大显示宽度 px，默认容器宽 |

**要点**：

- ==单文件发人是底线== —— 相对路径的 `<img>` 出了 dist 就断，所以截图必须内联；
  PNG 先量化到 256 色（UI 截图几乎无损，体积降一半以上）。
- 截图要用**真实渲染**（比如把组件单独挂到空页面、Playwright 逐元素截），
  ==不要手绘示意图冒充实拍== —— 这类「图上说它是实拍」的信用只有一次。
- 深色模式下截图里的 UI 还是浅色 —— 白底卡片包着它（`.shot` 自带白底），不算错。

## 18. `memmap` —— 地址空间 / 分区图

**什么时候用**：一段**连续空间**被切成了几段，你要说清各自的位置、大小和增长方向。

> `flow` 画「谁连谁」，`memmap` 画「谁在哪一段」。区别在于它有一根**隐式的地址轴**。

```memmap
title: 一个进程的虚拟地址空间
sub: Linux x86-64
high: "0x7fff_ffff_ffff"
low: "0x0000_0000_0000"
segments:
  - { label: 内核空间, sub: "用户程序碰不到", tone: muted, size: 1.1, addr: "0xffff_8000..." }
  - { label: 线程 A 的栈, sub: "pthread 默认 8MB 上限，定死不变", tone: blue, size: 2.2, dir: down, mark: "线程独享" }
  - { label: 堆, sub: "malloc / new，向上长", tone: violet, size: 3.4, dir: up, mark: "全进程共享" }
  - { label: 代码段, sub: "只读。多进程可共享同一份物理页", tone: green, size: 1.9, mark: "可共享" }
note: 分界线只有一条：**栈随线程走，其余全随进程走**。
```

| 键 | 说明 |
|---|---|
| `title` / `sub` | 顶部标题与副标题（`sub` 渲染成等宽小字） |
| `high` / `low` | 轴两端的标注，画在底部 |
| `segments[]` | 从上到下就是高地址到低地址（**顺序有意义，别乱排**） |
| `segments[].label` / `sub` | 主文字 / 说明。`sub` 是放机制和数字的地方 |
| `segments[].size` | **高度权重**（默认 1），不是真实字节数 |
| `segments[].dir` | `up` / `down`，画一个增长方向标记 |
| `segments[].addr` | 右侧的地址标注 |
| `segments[].mark` | 右侧的旁注，比如「线程独享」/「可共享」 |
| `note` | 底部一句话 |

**要点**：

- **`mark` 那一列是这张图最值钱的地方。** 共享 / 独享、可读 / 可写这类属性，
  竖着排一列，读者扫一眼就拿到了边界 —— 散在正文里要读三段。
- `size` 是权重不是比例。真实比例会让大部分段小到看不见 ——
  ==地址空间里 99% 是空的，按真实比例画出来就是一张空白==。
- 地址用 `0x` 前缀 + 等宽字体渲染，所以写 `0x7fff_ffff_ffff` 这种带下划线的形式最易读。

**同类形状都能用**：磁盘分区、ELF 文件布局、TCP 头部字段、位域切分、栈帧。

## 19. `summary` / `raw`

```summary
title: 一句话总结
text: |
  `CDC` 负责把变化**实时通知出来**；`Flink` 负责**加工变化**。
```

`raw` 直接输出 HTML，不自动替作者完成布局、主题适配或交互。一次性结构可以使用，按原则 ⑨⑩ 复用主题变量与样式，并检查最终页面；不能用它绕过图义、HTML 或版面约束。同类结构需要反复编写时再抽成数据或积木，不把「一次性」误解为页面不能长期保存。

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

**裸标量以反引号开头也会解析失败**（写代码标识符时常踩）：

```yaml
# ❌ 解析失败
note: `POKEDATA` 一次写一个机器字
# ✅ 加双引号
note: "`POKEDATA` 一次写一个机器字"
```


**裸标量里的「空格 + `#`」会被当成注释，值被悄悄截断** —— 而 `check` 照样全绿：

```yaml
# ❌ 渲染出来只剩「反汇编里是 sub sp, sp,」，后面全没了
sub: 反汇编里是 sub sp, sp, #0x40
# ✅ 加引号
sub: "反汇编里是 sub sp, sp, #0x40"
```

==这个坑比解析失败更坏：页面照常出图，只是那半句话消失了。== 写地址、`#define`、`# 注释`时顺手加引号。

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

**键以 `*` / `&` / `!` 开头也要加引号** —— 而且报错完全看不出是同一回事：

```yaml
# ❌ 报「保留字符」或「序列对齐」或「隐式键」，就是不说「你的键以星号开头」
rows:
  - **机制**（因果关系）:
      - ...

# ✅
rows:
  - "**机制**（因果关系）":
      - ...
```

**键要加引号时，引号后的冒号容易漏** —— 漏了就不是单键映射，而是「标量 + 嵌套序列」：

```yaml
# ❌ 报「All sequence items must start at the same column」，不会说「少了冒号」
rows:
  - "带 `代码` 的键"
    - [a, b]

# ✅ 引号后仍然要有冒号
rows:
  - "带 `代码` 的键":
      - [a, b]
```

````callout
tone: amber
icon: ⚠
text: |
  ==**但块标量里面不算。**==

  `text: |` / `body: |` 的内容是**字符串** —— 里面写什么都没关系：

  ```yaml
  text: |
    - 这一行以短横线开头，完全合法，因为它在字符串里
  ```

  ==工具第一版没管这件事，一下误报了 23 处。==
  误报会阻塞全仓库的 `check`，比漏报还麻烦。
````

> `npm run check` 有预检会直接报这两条（块式和流式都覆盖，且会跳过块标量内部）。

**围栏里要放代码块时，外层用四个反引号**：

`````text
❌ 外层 3 个反引号：内层的裸 ``` 会把外层提前闭合
````callout
text: |
  上面一段

  ```
  core ──┬──→ crowd
  ```

  下面一段 —— 这段会被当成代码块正文，**加粗** 字面显示
````
`````

`````markdown
✅ 外层 4 个反引号：内层的 ``` 正常渲染成代码块
````callout
text: |
  上面一段

  ```
  core ──┬──→ crowd
  ```

  下面一段 —— **加粗** 正常生效
````
`````

```callout
tone: red
icon: ⚠
text: |
  ==这个坑非常隐蔽：页面**看着正常**，只是后面的段落错位、`**加粗**` 字面显示。==

  因为剩下的 markdown 全被当成代码块的正文了 —— 你不会看到任何报错。

  `npm run check` 有专门检查（`lintFences`）：发现「没有语言标注的代码块里
  出现 markdown 强调标记」就报出来，并提示把外层换成四个反引号。
```

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