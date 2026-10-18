# 加新积木 / 新控件

> **前提：先读 [主 Skill 的「原则 ⑨ · 积木是词汇，不是语法」](../SKILL.md#原则-⑨-积木是词汇不是语法)。**
> 积木是词汇不是语法。表达不顺手时，优先试**组合**和**给现有积木加字段**，
> 确认需要通用能力后再新建。一次性结构可直接选 `raw`，不用把前面几条路都试完，
> 但仍遵守主 Skill 的 [版面原则 ⑩](../SKILL.md#原则-⑩-版面服务阅读图按内容铺开) 和 [写作原则 ⑪](../SKILL.md#原则-⑪-平实连贯准确地写)，不以一次性排版为由覆盖全站样式。

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

## 获批原型接入：复用，不重新画

用户认可一个临时 HTML 后，把它当验收基准。迁入共享积木时复用节点坐标、内容、边界、
配色和操作链；删除的只是「临时」外壳文案，不以工程整理为由重新排图。

进程 / 线程多层图的做法：

- 几何仍放 `archify/pt-map.json`，生成 SVG 保留成员元数据。
- 节点内容仍用 `bodies`；区域说明和父子关系用新增的 `frames`，不是另造积木。
- `tools/lib/arch-frames.mjs` 管完整包围盒与区域校验；`app.js` 复用聚焦、导览和恢复全图。
- 临时页的显示倍率写成 `maxScale`。全站正文可以变宽，但 SVG 不因此无上限放大。
- 对照原型检查每个节点的文字、坐标和字号，并测区域点击、祖先路径、键盘、场景和对比。
- 基图校验不能证明后处理后的图正确；跑最终页面的量图探针，再看深浅色截图。

遇到工具不支持时，先查正确用法再做扩展。成员集合的嵌套已有，但标题留白、完整底边、
语义父子关系和交互需要单独检查；不要把「能画两个框」等同于「递归归属已经完整」。

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

````callout
 tone: red
 icon: ⚠
 text: |
   ==`classList.toggle(name, force)` 的 `force` 是 `undefined` 时是**翻转**，不是「移除」。==

   真实事故（arch 积木的导览）：点亮逻辑写的是
   `var on = want[from] && want[to]` —— 键不存在时得到的是 `undefined`，不是 `false`。
   而前面的 `clear()` 刚把 `is-hot` 摘掉，`toggle('is-hot', undefined)` 又把它**翻回来** ——
   表现是「导览模式下所有边永远全亮，淡出从来没生效过」。
   节点那边写了 `!!want[...]` 就没事。修法一行：`!!` 布尔化。

   这类状态 bug `check` / `visual-check` 都查不到 ——
   ==它们不点交互==。点亮/淡出这类东西要自己写探针点一遍
   （headless Chrome 注入脚本点按钮，再 dump class / computed opacity）。
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

设计与验收范围统一按 [主 Skill 的原则 ⑩](../SKILL.md#原则-⑩-版面服务阅读图按内容铺开)：先在目标桌面看最终字号和完整交互，检查双主题，再做固定布局回归。改缩放策略时增加 1920px 检查；共享积木、共享控件或外壳变更增加一次约 500px 安全冒烟，不为此另做手机版。

多层区域与共享 arch 逻辑的回归样例：`node tools/probe-arch.mjs process-thread-relation`；区域校验单测：`node --test tools/lib/arch-frames.test.mjs`。本篇有 `frames` 时可用自己的 slug 跑探针；当前只操作第一张带 `frames` 的图，附带三档宽度与双主题，其他图仍需按覆盖范围检查。普通笔记不为移动端再开专项测试。

窄屏只处理不可恢复的裁切、关键控件不可达或外壳遮挡。局部滚动和缩放要有实际实现，不能只在文案里宣称；不能一屏看全不等于要删内容或精修移动端。

---

## 设计积木时的两条经验

**① 可复用能力优先数据驱动，不为每个用例写一个积木。**
普通积木用 YAML 描述内容；`demo` 可以挂控件逻辑或自定义结构，`raw` 用于一次性 HTML。
新建可复用积木时，若每个用例都要手写大段 HTML，先考虑把结构做进积木、把内容改成数据，不把这个建议当成禁止所有自定义结构。

**② 先保住图义，再决定窄屏怎么安全降级。**

判断密度与回归范围按主 Skill 原则 ⑩，不在这里另用屏幕像素或节点数划门槛。
目标桌面清楚、只在手机上拥挤，不代表需要拆图或简化。下面是组件维护时的降级选择，不是每篇笔记都要实现的手机版：

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

积木的价值在于复用同类表达，不在于数量多或少。已有组合或字段能表达时不造同义工具；明确缺少可复用能力时就补，不必等重复三次。一次性结构可用 `raw`，不要让内容迁就工具，也不为一个实例扩展整套共享系统。


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

## 架构图里的 N×M 引用关系（insight-refresh 实测）

这次画「三张表各自引用三本字典」时，3×3 全连在当时的布局中触发
`proper-crossing` / `ambiguous-corridor`。改 `labelAt` 只能挪标签，不能解决路径相交。
多对多引用不是只能画代表线；默认保留真实引用，先调节点布局或路由。
这次采用了代表线加完整关系表的折中：

- 每本字典挑一张有代表性的表画引用线，**把 ×N 和代表标记写进 sublabel 或边标签**（如「value_set_id 引用 ×3（代表线）」），图注列明它代表哪三张表的引用
- 笔记的 `compare` 表里补全每一条引用，图上的归属和共享份数不变
- 图注说明点选只追踪 SVG 实际边；`parts.detail` 或导览能补解释，但不会自动恢复被省略的邻居。任务要求逐对象追踪完整关系时，不采用这个折中

另两条调试用的实底：

- `label-route-clearance` 报错里的 label rect 是以 `labelAt` 为**中心**算的（rect = labelAt ± w/2）。
  修碰撞优先把标签挪到自己那条边的水平段上，而不是和另一条边的竖直走廊挤
- 两条边共用走廊报 `ambiguous-corridor` 时，给其中一条加 `via` 强制专属走廊；
  平行竖走廊的间距要 ≥ 边标签的宽度，否则标签压走廊照样报
