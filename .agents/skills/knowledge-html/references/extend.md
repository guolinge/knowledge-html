# 加新积木 / 新控件

> **前提：先读 `principles.md` 的「原则 ⑦ · 积木是词汇，不是语法」。**
> 积木是词汇不是语法。表达不顺手时，优先试**组合**和**给现有积木加字段**，
> 最后才新建。而如果只是一次性排版，**直接用 `raw` 块写 HTML/CSS 完全合法** ——
> 别为了「合规」把内容塞进不合适的积木。

**新建的时机**：**一类表达会反复出现，就直接做。** 不用等「第三次」。

用户的原话：==积木越多越好，越积累越好，到时候用的时候就顺手了。==

所以策略是**主动积累**，不是按需克制。但也不是什么都做：

- **一类表达会反复出现** → 直接做成积木（比如「带分支的流程图」每个系统都画）
- 只是配色/间距不同 → 那是 `tone` 和 CSS 的事，不是新积木
- 只出现一次的一次性排版 → 用 `raw`

给现有积木加字段往往比新建更划算 —— 先想这个。
例：`demo` 原本只能做双栏日志式，加一个 `html` 字段就支持任意自定义布局了，
比再造一个 `custom-demo` 积木干净得多。

---

## 第 1 步 · 在 `tools/lib/blocks.mjs` 写渲染函数

找到文件里 `/* ---------- 注册 ---------- */` 上面的区域，加一个函数：

```js
/* ===== 积木 11 · my-block ===== */
function myBlock(body) {
  const cfg = YAML.parse(body) || {};
  const items = cfg.items || (Array.isArray(cfg) ? cfg : []);
  return `<div class="my-block">${items
    .map(
      (it) => `<div class="mcard tone-${it.tone || 'muted'}">
        <b>${inline(it.title)}</b>
        ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
      </div>`,
    )
    .join('')}</div>`;
}
```

可用的三个辅助函数（都定义在 `blocksPlugin` 内部，闭包里就能拿到）：

| 函数 | 作用 |
|---|---|
| `inline(s)` | 渲染**行内** Markdown（粗体、代码、链接），并转义 HTML |
| `esc(s)` | 纯转义，当纯文本用 |
| `md.render(s)` | 渲染**整块** Markdown（可含多段、列表） |

## 第 2 步 · 注册

```js
const RENDERERS = {
  'lane-stack': laneStack,
  journey,
  // ...
  'my-block': myBlock,     // ← 加这里
};
```

**注册名就是围栏语言名。** 名字里带连字符没问题（`lane-stack` 就是）。
漏注册的话，`npm run check` 会报「未知围栏语言」—— 不会静默失效。

## 第 3 步 · 在 `assets/blocks.css` 写样式

```css
.my-block { display: grid; gap: 12px; margin: 0 0 20px; }
.mcard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--tone, var(--border-strong));
  border-radius: 12px; padding: 14px 16px;
}
```

**只准用 `theme.css` 里的 CSS 变量，不准写死色值。**
`--tone` / `--tone-soft` 由 `.tone-*` 类自动提供，只要给元素加上 `tone-xxx` 类就能着色。
这条规矩换来的是：换肤不用动任何内容。

## 类名必须加前缀（踩过的坑）

**所有积木的 CSS 类名要用自己独有的前缀**，否则会和别的积木撞车。

真实事故：`spec`（拆解卡）用了 `.srow`，后来 `seq`（时序图）也用了 `.srow` ——
结果时序图每一行都多出一条横线（`spec` 的 `.srow + .srow { border-top }` 生效了），
**而且不报错**，只是默默画错。

约定：

| 积木 | 前缀 | 例子 |
|---|---|---|
| `lane-stack` | `.lane` `.pnode` `.conn` | |
| `flow` | `.flowd` `.fnode` `.fedge` | |
| `seq` | `.seqd` `.spart` `.smsg` | |
| `spec` | `.spec` `.srow` `.sk` `.sv` | |
| `journey` | `.jcard` `.rec` `.jnote` | |
| `cards` | `.cards` `.ccard` | |

**加新积木前先 grep 一下你要用的类名。** 短类名（`.row` `.cell` `.item`）几乎一定会撞。

一条命令查出前缀有没有被占（写新控件前后各跑一次）：

```bash
grep -oE '^\.[a-z0-9-]+' assets/blocks.css | sort -u | grep '^\.pl-'
```

真实事故（控件版）：写 `prune-lab` 时用了 `.pl-cell`，而 `partition-prune` 的 `.pl-cell` 早就在喊
`height: 14px`。==`check` 是绿的、不报任何错==，只在截图里表现为「格子挤成一条线」——
因为两条规则都是合法的 CSS，后写的那条只盖住了它认识的那些属性。
换个前缀（`.pnl-`）就好了。

## 加交互控件（不是积木，但同样要积累）

控件注册在 `assets/app.js` 的 `WIDGETS` 对象里。**优先做数据驱动的**：

```js
WIDGETS.myWidget = (root) => {
  const cfg = cfgOf(root);            // 读 data-config
  const box = mountOf(root);          // 找到 [data-mount]
  const statusEl = root.querySelector('[data-status]');

  const btn = el('button', 'mw-btn', '点我');
  box.append(btn);
  btn.addEventListener('click', () => {
    statusEl.textContent = '已点击';   // 标题栏右侧的状态文字
  });
};
```

**三个现成的工具函数（已定义在 app.js 顶部）：**

| 函数 | 作用 |
|---|---|
| `el(tag, cls, text)` | 建元素，省掉 createElement + className + textContent 三行 |
| `cfgOf(root)` | 读并解析 `data-config` |
| `mountOf(root)` | 拿到 `[data-mount]` 容器 |

````callout
tone: red
icon: ⚠
text: |
  ==`el` 的第三参只收**字符串**，不是 children。==

  写控件时最容易顺手写成 `el('div', 'head', el('span', 'tag', '标签'))` ——
  它不报错，渲染出来的是字面的 `[object HTMLSpanElement]`
  （textContent = String(元素)）。要在盒子里塞多个节点，
  只能建完再 `append`：

  ```js
  const head = el('div', 'head');
  head.append(el('span', 'tag', '标签'), el('span', '', '说明'));
  pane.appendChild(head);
  ```

  同一段里的另一个坑：==DOM 的 `append()` 返回 `undefined`==，
  `a.append(x).append(y)` 会在第二个 append 上直接抛 TypeError。
  这次写 combination-control-lab 两个坑都踩了，`check` 全绿，只有截图看得见。
````

**三条约定**：

1. **数据驱动优先。** 能用 `config` 表达的，别让作者手写 HTML。
2. **初始状态也要从 `config` 读。** 控件把初始值写死，笔记里写的 `config` 就是一句空话 ——
   页面照样渲染、`check` 照样绿，只有作者以为「这个交互默认从那个例子开始」。
   实测：`prune-lab` 第一版 `const st = { q: 1 }`，笔记里写 `config: { q: 2 }`，
   截图里高亮的却是另一个查询。改成 `cfg.q` 之后，笔记才真的说得算。
3. **CSS 类名加前缀。** 控件样式同样会撞车 —— 参考上面「类名必须加前缀」。

## 改 CSS 不要用「区间替换」

真实事故：改 `flow` 的样式时，用脚本从 `.flowd {` 切到某个标记，
把区间**整个换掉** —— 结果区间里的 `.flowd-svg { position: absolute }` 也被删了。
SVG 变成在流元素占了 414px，把节点全推下去，**图完全错位**。

**正确做法**：

- 改一条规则就替换那一条，别用大区间
- 如果非要大区间替换，**替换后 grep 一遍原来的选择器**，确认没丢东西
- 加新积木/大改样式后，**一定要截图看**，别只看 `npm run check` 过了就完事
  —— 构建通过 ≠ 画对了

## 第 4 步 · 加示例（必做）

积木没有示例就等于不存在 —— 下次没人记得怎么用。

1. `tools/templates/note.md` 加一段（新建笔记时的模板）
2. `notes/blocks-cheatsheet/note.md` 加一段（可运行示例）
3. `.agents/skills/knowledge-html/references/blocks.md` 加一节（agent 的参考）

## 第 5 步 · 验证

```bash
npm run check                      # 语法与约定
npm run view -- blocks-cheatsheet  # 打开示例页看效果
```

先在 **1280px 宽屏**看图是否清楚，并走完完整交互；再看一眼深色模式。
只有新增或修改了**共享积木 / 共享控件**时，才补一次约 500px 的窄屏冒烟。
普通笔记使用现有积木，不为移动端单独开一轮检查。

窄屏冒烟只修内容被不可恢复地裁掉、关键控件不可达、外壳遮住正文这类致命问题。
如果只是不能一屏看全，保留桌面画布并允许局部横向滚动即可，不继续做移动端精修。

---

## 设计积木时的两条经验

**① 数据驱动，不要为每个用例写一个积木。**
`demo` 是唯一一个例外（它必须挂外部 JS），其余积木都是纯 YAML → HTML。
如果新积木的 body 里出现了 HTML 字符串，说明它应该被拆成「积木 + 数据」。

**② 先保住图义，再决定窄屏怎么安全降级。**

判断积木是否太密，以 **1280px 宽屏**为准。宽屏清楚、只在手机上拥挤，
不代表它需要拆图或简化。按内容类型选降级方式：

- 空间关系图、时序图、交互画布 → 保留最小画布宽度，局部横向滚动或缩放
- 表格、普通卡片 → 只有在不改变关系时才折成卡片或纵向堆叠
- 网格 → 可以用 `auto-fit` 降列数，但不能因此删掉信息
- 导航和页面外壳 → 保证正文不被遮住、关键控件可到达

不要为了手机一屏放下而删节点、隐藏关键标签、把关系图改成普通列表，
或另做一套缩水交互。只有用户明确要求手机使用时，才设计移动端专属形态。

---

## 什么时候**不该**加积木

- 只出现一次的表达方式 → 用 `raw` 块，或者用现有积木拼
- 只是配色/间距不同 → 那是 `tone` 和 CSS 的事，不是新积木
- 「想要一个更漂亮的列表」 → 先用 `cards` 或 `checklist`，别急着造新的
- **只是缺一个字段** → 给现有积木加字段，别新建

积木是资产，页面只是实例。**资产越少越锋利。**

但反过来说：**锋利是为了好用，不是为了整齐。**
如果现有积木真的表达不了你要讲的东西，**就去加** ——
让内容去迁就工具是本末倒置。


### 加新积木时的两条硬要求

1. **`flow` 的能力边界要记住**：它是「测量 + 直连」，没有边路由。
   稠密图会翻车 —— 翻车就拆图、改用 `compare` 列表格、或换 `arch`。
2. **`flow` 横向边上的标签，宽度上限是 30px。**
   行内间隙默认 `.flowd-row { gap: 30px }`，而 `.flowd.has-groups .flowd-row`
   才是 72px —— 也就是说：**写了 `groups`（哪怕只有一个）才有地方放横向标签。**

   所以「创建 → 就绪 → 运行」这种横排链，标签一超过 3 个汉字就会被两边的框压住。
   两条出路：

   - **给这个 flow 加一个 `groups`**（一个框住全部节点也行）—— 顺便拿到「这几个是一伙的」这层信息
   - **把横排改竖排** —— `.flowd-grid { gap: 58px }`，竖向标签有 58px

   ==这次画「进程五态」时，横排四个状态 + 六条标签，前两版全被压住；加了 `groups` 才一次过。==
3. **`flow` 里单节点的 `groups` 会把标签挤没。**
   框只包住一个窄节点时，`groups[].label` 会折成两三行、盖住下面的连线。
   要么把 label 压到 3~4 个字，要么让这个组包住**整张图的所有节点**（框顶就跑到最上面去了）。

   ==但「包住所有节点」也有翻车的时候==：节点分两三行时，框会变成一个盖住整张图的大色块，
   比不画还难看。这次画「索引数据块 → 数据块」时试过，最后退回**不加 groups**。
4. **两个区域框水平相邻、又各自跨多行时，会重叠。**
   这次画「两条修复路径」时，两个 `groups` 各包 2~3 行，实测重叠了 40px。
   出路：让每个组只包**一行**节点，或者干脆**拆成两张图** ——
   图上写着「路径一 / 路径二」的两块东西，本来也常常该是两张图。

5. **不同 row 的节点连向同一个下游，同样会穿过中间那一行。**
   不只是「同一 row 的两个节点各自往下连」会翻车 —— 排成两行的 M1、M2
   各自连向下游的 GRQ 时，`M1 → GRQ` 一样会从 `M2` 身上穿过去。
   ++把并列的节点放进同一 row。++

6. **`flow` 画不了「跳过中间那一层」的拓扑。**
   想表达「A 到 C，但绕过了中间的 B」，边必然穿过 B，`visual-check` 会直接报
   `边 A→C 穿过了无关节点「B」`。

   ++改用 `journey` 表达「数据少坐了一站」++ —— 每一站是一个 `tag`，
   绕过的那一站就是不写它。语义上比硬画一条穿越线清楚得多。
7. **响应式目前按视口宽度写（`@media`）**。只有积木确定会被复用到窄容器
   （比如并排两栏），并且真的在那个容器里失效时，才改用 **container queries**
   （Chrome 105 / FF 110 / Safari 16 已广泛可用）。不要为了预想中的手机场景提前改一遍；
   当前所有积木都还没改。

8. **`demo` 不写 `config` 就没有 `[data-mount]`，而 `mountOf()` 会静默回退到 root。**

   `demo` 积木有三种形态：`panes`（默认，日志式）、`html`、`config`。
   **只有后两种会在页面上生成 `<div data-mount>`。** 不写 `config` 时：

   ```js
   const mountOf = (root) => root.querySelector('[data-mount]') || root;   // 回退到 root
   ```

   控件照样能渲染（内容 append 到 `.demo` 上），肉眼看不出问题 ——
   于是「这个控件挂载了没有」这个信号就没了：

   - `visual-check` 的探针数 `[data-mount]` 的子元素 → 它报 0
   - 你会以为是控件抛异常，去 `app.js` 里翻半天

   ++凡是 `config` 驱动的控件，`demo` 块里一律写上 `config:`（哪怕是 `{}`）。++
   ==这次写 `authz-lab` 时漏了，白查了一轮「为什么它没挂载」。==
