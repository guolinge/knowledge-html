# 版面与样式

> 从 SKILL.md 拆出来的。

## 版面与样式

### 改 theme.css，不要改单篇笔记

所有页面共用 `assets/theme.css` + `assets/blocks.css` + `assets/app.js`。
遇到这些症状，**改共享文件，一次全站生效**：

| 症状 | 改哪 |
|---|---|
| 屏幕利用率低 / 留白太多 | `theme.css` 的 `--shell` / `--prose` / `--gutter` |
| 某个积木在窄屏塌得不好 | `blocks.css` 里那个积木的 `@media` |
| 目录 / 交互别扭 | `app.js` + `lib/page.mjs` |
| 颜色不对 | `theme.css` 的 token |

**不要为了某一篇笔记在 `note.md` 里塞 `<style>`** —— 那是把全局问题当局部问题修，
下一篇还得再修一遍。

### 版面原则：文字窄，图宽

屏幕越宽，**不要把文字拉长**（长行伤可读性），而是把多出来的宽度给图。

`theme.css` 里三层控制：

- `--prose`（880px）管**文字元素**（`p` / `h2` / `h3` / `ul` / `.callout` / `.quiz`）
- `main` 的 `max-width`（1280px）管**整列上限**，防 4K 屏上积木被拉飞
- **积木不受 `--prose` 限制**，自动用满整列

判断一个新积木该不该限宽：**它主要是文字还是图形？** 文字限，图形不限。

### 行内强调与颜色：别让一种标记承担所有重点

| 写法 | 语义 | 颜色 |
|---|---|---|
| `==文字==` | 关键结论 / 最该记住的一句 | 蓝 |
| `!!文字!!` | 坑 / 反直觉 / 注意 | 橙 |
| `++文字++` | 正确做法 / 推荐 | 绿 |
| `**文字**` | 句子内的重音（降级用） | 加粗不变色 |

**一屏之内不要超过 3 个 `==`** —— 到处都是重点等于没有重点。
写完后扫一眼：如果整页加粗密密麻麻，说明该用彩色标记做取舍了。

#### `callout` 的颜色也一样 —— 别让红色承担所有重点

```callout
tone: red
icon: ⚠
text: |
  ==**这份 skill 自己踩过这个坑。**==

  有一轮自检时统计：48 个 `callout` 里 **36 个是红/橙**（75%）。
  然后逐条看内容 —— 红的那 20 个里**有一半根本不是警告**：

  | 写的内容 | 它其实是 |
  |---|---|
  | 「六层不是某个项目的专属结构」 | **结论** |
  | 「构建产物是全量的」 | **事实** |
  | 「`npm run check` 是全仓库的」 | **事实** |
  | 「多个会话共用一个工作目录才是根因」 | **诊断** |
  | 「每次交付完回头问一遍」 | **方法** |
  | 「优先点名 add」 | **规则** |

  ++红色一多，「这里真的会出事」就没人当回事了。++
```

**按这句话选颜色：这条是「会出错」，还是只是「值得知道」？**

| tone | 什么时候用 | 判据 |
|---|---|---|
| `red` | **真的会出事** | 会丢数据 / 会被拦 / 会静默出错 |
| `amber` | 注意、已知局限、容易忽略的规则 | 不遵守会返工，但不会立刻炸 |
| `violet` | **结论 / 洞察**（「所以…」） | 读到这里该记住的一句话 |
| `green` | 正确做法 / 已验证 | 照着做就对了 |
| `blue` | 入口提示（「先读第 0 步」这类导航） | 很少用 |
| `muted` | 纯事实陈述 | 不劝你做任何事 |

> 拿不准时问自己：**如果读者跳过这条，会发生什么？**
> 答「没影响，只是不知道」→ 不配红。

### 代码块：**先分行，再谈分色**

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**粘一段单行 SQL 进笔记，等于没写。**==

  子句、权限、条件全挤在一行，读者要在脑子里自己断句。
  这跟「把图挤成一团」是同一种偷懒 —— 只是不容易被截图抓出来。
```

**两条规矩，按优先级：**

#### ① 分行 —— 一个子句一行，嵌套的缩进

```compare
first: 写法
head: [读者要做什么, 什么时候必须分行]
rows:
  - 一整行塞完:
      - { text: "在脑子里断句、数括号、找 AND 在哪", tone: red }
      - "永远不要。除非真的只有 `SELECT 1` 这么短"
  - 一个子句一行:
      - { text: "从上往下读，一眼看出结构", tone: green }
      - "SELECT / FROM / WHERE / GROUP BY 各占一行"
  - 嵌套再缩进:
      - { text: "子查询、AND 续行看层级", tone: green }
      - "子查询整体缩进两格；`AND` 接在下一行、再缩两格"
```

**实测对照**（`notes/insight-dsl` 那个交互）：

```text
❌ 挤成一行（真编译器就是这么输出的）
SELECT COUNT(*) AS `count` FROM (SELECT `u`.`uid` AS `uid` FROM `user_portraits_wide` AS `u` WHERE `u`.`staff_id` = 101 AND (TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE()) >= 18)) AS `t`

✅ 按子句分行
SELECT COUNT(*) AS `count`
FROM (
  SELECT `u`.`uid` AS `uid`
  FROM `user_portraits_wide` AS `u`
  WHERE `u`.`staff_id` = 101
    AND (TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE()) >= 18)
) AS `t`
```

```callout
tone: amber
icon: ⚠
text: |
  **但如果原文就是这样（比如真编译器的输出），分行之后要说明。**

  ==读者会以为「真代码就长这样」。==

  正确做法是分行展示 + 一句注明：

  > 语句内容跟真输出逐字相同；真输出是一整行（省字节），这里换了行。
  > **换行只是排版，不改变语义 —— SQL 本来就不看换行。**
```

#### ② 分色 —— 分的是**来源**，不是语法

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==**不要做语法高亮（SELECT 蓝、字符串橙）—— 那是编辑器的事，不是笔记的事。**==

  笔记里分色的价值在另一件事：**一段代码里混了多个「来源」时，
  用颜色把来源分开。**
```

**照 `notes/insight-dsl` 那个交互的做法**：

```compare
first: 颜色
head: [代表什么, 为什么值得一色]
rows:
  - 琥珀:
      - "**权限** —— 演员身份决定的"
      - "它不是用户圈出来的，==读者最容易把它当成条件的一部分== "
  - 白（默认）:
      - "**用户圈的条件** —— 界面上点出来的"
      - "主体，不需要额外颜色"
  - 紫:
      - "**派生表达式** —— 逻辑字段到物理列的变换"
      - "`age` → `TIMESTAMPDIFF(YEAR, birthday, ...)`，==这是最反直觉的一层=="
```

**判据**：一段代码里如果有 **2 个以上来源不同**的东西混在一起，
分色讲得清；只有一种来源就别上色（纯噪音）。

#### ③ 做成交互时，分色是**自动**的

那个演示不是手写的 HTML —— 它按语义片段拼出来：

```js
[['SELECT ', 'kw'], ['`u`.`uid`', 'cond'], ['WHERE ', 'kw'], ['`u`.`staff_id` = 101', 'perm']]
//                    ↑ 默认色            ↑ 关键字          ↑ 琥珀（权限）
```

所以**换身份、勾条件、切 include/exclude 时颜色一直是对的**，
不需要作者维护两套东西。

> 写这类 demo 时：**先想清楚有几种语义来源，再定颜色。**
> 不要先挑颜色再往里塞内容。

---

### 响应式：宽屏和竖屏都要能读

- **宽屏（≥1081px）**：目录是一列，点顶栏 ☰ 可收成 0
- **窄屏 / 竖屏（≤1080px）**：目录变成左侧抽屉，点遮罩或 Esc 关闭
- 状态记在 `<html data-toc>` 上，样式全在 `theme.css`，JS 只切属性

加新积木时**必须看一眼 400px 宽和深色模式** —— 这是最容易崩的两个地方。

### 改样式之后必须量图

```bash
npm run visual-check
```

用无头浏览器真的去量每个积木容器：子元素有没有溢出边界、有没有横向滚动。
**已经接进 pre-push 钩子，推送前自动跑。**

#### 七次踩坑记录

| 症状 | 根因 |
|---|---|
| 图整体错位，节点被推下去 414px | 用脚本「**区间替换**」改 CSS，把区间里的 `.flowd-svg { position: absolute }` 一起删了 |
| 区域框溢出到上面的段落里 | **设计缺陷**：框比节点大一圈，第一行就是被分组节点时框顶跑到容器外 |
| 加 padding 后所有图错位 | **坐标系不统一**：节点坐标相对 `.flowd-grid`，SVG/区域框相对 `.flowd` |
| 两个区域框重叠 | **每行独立居中** → 同组节点跨行会水平错位，两组包围盒几乎相接，框一往外扩就重叠 |
| `cards` 里的 `<pre>` 撑破容器 | **grid item 默认 `min-width: auto`**，不会缩到内容宽度以下 |
| **切换深浅色后，某个色块停在旧主题的颜色上** | `transition: background` + `background: color-mix(...)` —— 见下面第六次 |
| **点了按钮再截图，样式还是点击前的** | `--virtual-time-budget` 下过渡不推进 —— 见下面第七次 |

#### 第七次：`--virtual-time-budget` 下 CSS 过渡不会被推进 —— 截图会骗你

````callout
tone: red
icon: 📸
text: |
  **点一下控件再截图，截到的是点击前的样式 —— 而 DOM 里 class 已经是对的。**

  实测：一个「选中态」按钮。点第二个之后，
  ==class 和计算样式完全对调== —— 掉了 `.on` 的那个显示成选中态，加上 `.on` 的显示成未选中。

  ```
  0 [nw-seg-btn]     bg=rgb(234,241,255)   ← 看起来是选中的，其实不是
  1 [nw-seg-btn on]  bg=rgb(255,255,255)   ← 明明是选中的
  ```
````

**根因**：所有无头截图都跑在 `--virtual-time-budget` 下，而**那个模式下 CSS 过渡（transition）不会随虚拟时间推进** ——
元素停在过渡的起点，再也不会动。

**怎么确认是它**：注入 `* { transition: none !important }` 之后再读一次计算样式，样式立刻归位。
上面那个例子，关掉过渡后两个按钮的颜色正好对调回来。

**已经修在工具里**：`tools/block.mjs` 生成的预览页现在带一条

```css
*, *::before, *::after { transition: none !important; animation: none !important; }
```

==过渡只在值**改变**时触发，初次渲染不受影响== —— 所以量静态布局的 `visual-check` 基本不受影响，
只有「点一下再截图」这条路会踩到。

**自己写截图脚本时也要记得加这条**，否则会像我一样，花时间去找一个根本不存在的 CSS bug。

#### 第五次：archify 的共用 CSS 被削薄

```callout
tone: red
icon: 🌗
text: |
  **写过 `transition: background` 的元素，只要它的背景是 `color-mix(...)`，
  换主题时颜色会卡在旧主题上。**

  不是过渡一下就到了 —— 是**永远不更新**，直到这个元素因为别的原因重新布局。

  ==这个 bug 只在切主题时出现，`npm run check` / `visual-check` 全是绿的。==
  （它们不切主题，只量布局。）
```

**真实经过**（写「三种 IPC 数据流」那个控件时）：

| | |
|---|---|
| 症状 | 浅色模式下，未激活的格子渲染成深色；但同一张卡片的外壳是白的 |
| 第一反应 | 以为变量作用域错了 —— 打印 `--surface-2`，发现是 `#f2f4f7`（正确的浅色） |
| 打印元素的实际值 | `oklab(0.283 0.003 -0.029)` —— 一个**暗色**，和变量对不上 |
| 排除法 | 把 `transition: background .2s` 删掉，**立刻正确**（`rgb(234,231,246)`，正是手算出来的淡紫） |

**根因**：元素在 `data-theme` 还是 `dark` 时完成首次渲染，主题切成 `light` 后
背景值要变，但 Chrome 对**两个 `color-mix()` 计算值之间的插值**处理不了，
于是停在起点。改成普通 `var(--x)` 的颜色不会中招（那是两个具体颜色之间的插值）。

++规矩：给「背景是 `color-mix`」的元素写 transition 时，只写具体属性，不写 `background`、更不要写 `all`。++

```css
/* ❌ 换主题会卡住 */
.pill { background: color-mix(in srgb, var(--blue) 14%, transparent); transition: .18s; }

/* ✅ 只过渡真正会动的东西 */
.pill { background: color-mix(in srgb, var(--blue) 14%, transparent);
        transition: color .18s, box-shadow .18s; }
```

**查法**（一条命令扫全站）：

```bash
python3 - <<'EOF'
import re, pathlib
css = pathlib.Path('assets/blocks.css').read_text()
for sel, body in re.findall(r'([^{}]+)\{([^}]*)\}', css):
    if 'transition' not in body: continue
    if not any('color-mix' in l for l in body.split(';') if l.strip().startswith('background')): continue
    t = re.search(r'transition:\s*([^;]+)', body).group(1).strip()
    if 'background' in t or re.fullmatch(r'\.?\d+(\.\d+)?(m?s)?', t):
        print(sel.strip()[:60], '→', t)
EOF
```

==写新控件时顺手跑一次，比等用户在浅色模式下发现便宜得多。==

#### 第五次：archify 的共用 CSS 被削薄

```callout
tone: red
icon: ⚠
text: |
  ==`assets/archify-embed.css` 是全站共用的，但它是**每次跑 archify 时重新导出**的。==

  导出时会按「`assets/arch/` 下所有 SVG 用到的 class」筛规则。
  一旦筛漏，图里的元素就掉样式 —— 而且**构建、visual-check 全是绿的**。
```

**真实事故**：CSS 丢了 `.a-dashed` / `.a-security`（少 `fill: none`），
图里的虚线边被**填成黑色三角形**，压在节点上。

| 症状 | 根因 |
|---|---|
| 图里出现大块黑色三角/色块 | `archify-embed.css` 缺了某个 class 的规则，`fill` 回退成黑色 |
| 控件里几块**贴在一起** | `gap` 写在某个 wrapper 上，而控件**没套它** —— 直接 append 到 `[data-mount]` 上了 |

````callout
tone: green
icon: ✅
text: |
  **修法**：重跑任意一张图，它会按并集重新导出共用 CSS。

  ```bash
  node tools/archify.mjs archify/<名字>.json <名字>
  ```

  `npm run check` 有专门检查（对比 SVG 用到的 class 和 CSS 里定义的 class），
  缺了会直接报出来并告诉你重跑哪条命令。
````

#### 改共享文件的四条硬规矩

1. **改一条 CSS 规则就替换那一条，别用大区间。** 非要大改，改完 grep 一遍原来的选择器。
2. **绝对定位的装饰元素要考虑「会不会超出容器」。** 加了就配 padding。
3. **坐标计算必须统一参照系。** 容器一有 padding，相对不同父元素量的坐标就会错开。
4. **放进 grid / flex 的元素要设 `min-width: 0`**，否则内容会把容器撑破。
5. **`background: color-mix(...)` 的元素，别写 `transition: background` 或 `transition: .2s`。**
   换主题时 Chrome 插值不了两个 `color-mix` 计算值，颜色会卡在旧主题上 ——
   `visual-check` 抓不到（它不切主题）。详见上面「第六次」。

## 依赖策略：默认零依赖

页面要能**单文件发人**，所以每加一个库都在增加分发成本。

| 需求 | 用什么 | 要不要库 |
|---|---|---|
| 高亮、淡入、位移 | CSS transition / animation | 不要 |
| 元素沿路径移动 | CSS `offset-path` | 不要 |
| 流程连线 | 测量 + 内联 SVG（见 `flow` 积木） | 不要 |
| 数字滚动、按步播放 | Web Animations API / setTimeout | 不要 |
| 复杂时间轴编排、物理弹簧 | —— | 到这一步再说 |

**先零依赖做到极限。** 真不够时再讨论装什么，并且要把决定写回这一节。

---
