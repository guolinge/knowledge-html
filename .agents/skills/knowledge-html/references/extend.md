# 积木不够用时，怎么加一个

> **前提：先读 SKILL.md 的「第二原则」。**
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

三个现成的工具函数（已定义在 app.js 顶部）：

| 函数 | 作用 |
|---|---|
| `el(tag, cls, text)` | 建元素，省掉 createElement + className + textContent 三行 |
| `cfgOf(root)` | 读并解析 `data-config` |
| `mountOf(root)` | 拿到 `[data-mount]` 容器 |

**两条约定**：

1. **数据驱动优先。** 能用 `config` 表达的，别让作者手写 HTML。
2. **CSS 类名加前缀。** 控件样式同样会撞车 —— 参考上面「类名必须加前缀」。

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

顺便看一眼**深色模式**和**窄屏**（浏览器窗口拖到 400px 左右）——
积木最容易在这两个地方崩。

---

## 设计积木时的两条经验

**① 数据驱动，不要为每个用例写一个积木。**
`demo` 是唯一一个例外（它必须挂外部 JS），其余积木都是纯 YAML → HTML。
如果新积木的 body 里出现了 HTML 字符串，说明它应该被拆成「积木 + 数据」。

**② 想清楚它在窄屏下怎么塌。**
参考已有做法：

- 横向排列 → 改纵向（`lane`、`demo-body`）
- 表格 → 折叠成卡片，用 `data-label` 保留表头（`compare`）
- 网格 → `auto-fit` 自动降列数（`cards`）

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
