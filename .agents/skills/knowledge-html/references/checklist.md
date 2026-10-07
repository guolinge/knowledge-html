# 写完检查 / 参考

> 从 SKILL.md 拆出来的。==硬约束那张表留在 SKILL.md 里了== ——
> 它是随时要看的，不适合藏进子文件。

## 写完检查

- [ ] `npm run check` 零问题
- [ ] `npm run visual-check` 零问题
- [ ] **前三节能让外行说出「这东西是干嘛的」吗**？（原则 ⑤）
- [ ] 概念层里**没有类型名 / 类名 / 文件名**
- [ ] 用户说的那个卡点，**有没有变成一张图或一个交互**？（唯一的成功判据）
- [ ] **没有为了迁就积木而扭曲表达**；需要时改了积木或用了 `raw`
- [ ] **用了不熟的积木，render 之后截图看过** —— `check` 只验 YAML 能不能解析，
      ==不验字段名对不对==。我拿 `matrix` 当表格用过一次：写了 `rows`/`cols`/`cells`，
      它其实只认 `x`/`y`/`cells`（四个格子），结果静默渲染成一片空白，`check` 报 0 错
- [ ] `flow` 的**每条边都能说出一句关系**；没有「为了排在一列」而加的空边
- [ ] 图里没有把**过渡句**做成节点（「从这里开始分叉」这类该写在图外面）
- [ ] 原文里的铺垫、重复、客套删掉了没有
- [ ] 每个概念都配了**真实数据的例子**（复盘 ②）
- [ ] 结尾有 `quiz`
- [ ] `meta.json` 的 `status` 是 `draft`，`sources` 填了原文出处
- [ ] 走的是「一个面」时，**知识树的每个节点都有归属**（单独一篇 / 并入哪篇）
- [ ] 改了 skill 的话，**`npm run check` 会顺带渲染一遍 SKILL.md / blocks.md / extend.md**
      （不用再单独跑 `npm run skill` 才发现围栏崩了）
- [ ] 改了 skill 的话，**`skill/*.html` 要一起提交** —— 它是进仓库的产物，
      不提交的话线上那一份会停在你改之前的版本

### 改了「站点外壳」要多做一步

外壳 = `tools/lib/home.mjs`（首页）、`assets/theme.css` / `blocks.css`。
下面两个坑 **`npm run check` 一个都报不出来**，而且都是**静默**的：属性设上了、JS 里读也是对的，只有屏幕上不对。

````callout
tone: red
icon: ⚠
text: |
  **一、内联在模板字符串里的浏览器 JS，语法检查查不出 `ReferenceError`。**

  首页那段 `<script>` 是拼在 JS 模板字符串里的，`node --check` 看不到它。
  我重构时把旧函数整个换掉，**连同里面声明的 `var mode` 一起删了** ——
  语法完全合法，表现是「排序按钮点下去毫无反应」。

  → 在真实页面里跑一遍，并把 `window.onerror` 收上来（否则连报错都看不到）。

  ```bash
  # ==探针文件必须写在仓库根目录==，再让 python 把 <script> 注入进去。
  # 放 /tmp 跑的话，相对路径引的 assets/*.css 全断了 ——
  # 你会测出「样式没生效」的假象，然后去修一个根本不存在的 CSS 问题。（真踩过）
  cp index.html .probe.html   # 注入探针
  chrome --headless=new --virtual-time-budget=6000 \
    --dump-dom "file://$PWD/.probe.html" | grep -o 'class="PROBE">[^<]*'
  ```
````

````callout
tone: red
icon: ⚠
text: |
  **二、`el.hidden = true` 会被作者样式里的 `display` 盖掉。**

  浏览器自带的 `[hidden] { display: none }` 在 **UA 样式表**里，
  而 **作者样式表里任何一条 `display` 都会盖掉它** —— 跟优先级无关。

  所以 `.tnode { display: grid }` 一写，`n.hidden = true` 就完全失效：
  属性在、`el.hidden` 读出来是 `true`、屏幕上还画着。
  首页的**搜索和标签筛选因此哑了很久**（实测：32 个节点全被标了 `hidden`，32 个全在显示）。

  `theme.css` 里已经加了兜底，==站内新写的组件不用再操心==：

  ```css
  [hidden] { display: none !important; }
  ```

  但要是哪天自己写页面 / 导出 HTML，记得补上这条。
````

## 参考

### 命令

| 命令 | 干什么 |
|---|---|
| `npm run status` | **开工前 / 提交前先跑这个** —— 把改动分类列出来 |
| **`npm run gaps -- <slug>`** | **图解缺口审计**：把该被逐段审的正文段落列出来（带行号 + 字数），并给出「段落 / 积木」比值。==写完之后必跑，见复盘 ⑦== |
| `npm run check` | 校验积木语法 + YAML + 约定 + skill 与代码一致 + **skill 文档自己能不能渲染** |
| `npm run view -- <slug>` | 构建单篇 + 打开（**默认就开**，它的用途就是这个；agent 验证时加 `--no-open`） |
| **`npm run block -- <slug> <n>`** | **只看第 n 个积木**：量高 + 截图，打印截图路径。==默认不开浏览器==（人要看加 `--open`） |
| `npm run block -- <slug> --list` | 列出这一篇的块（编号 + 行号 + 语言） |
| `npm run build:standalone` | 重建全部产物（`dist/*.html` + 首页） |
| `npm run visual-check` | 无头浏览器量每个积木有没有溢出。==读的是 `dist/`==，不是 `notes/` |
| `npm run build` | 只重建 `notes/*/index.html` —— **`visual-check` 不看这个** |
| `npm run skill` | 把这份 skill 渲染到 **`skill/`**（**进仓库**，首页链得到）+ 三个页面互链。默认不开浏览器，加 `--open` |
| `npm run new -- <slug>` | 新建一篇笔记 |
| `npm run serve` | 起本地服务器 |
### 文档

- `plans/<topic>.yaml` —— **嵌套产物树的唯一真相源**（树 + 依赖 + 进度）
- `tools/lib/plan.mjs` —— 读 plan、生成「前置」区块
- `tools/lib/home.mjs` —— 首页：树视图 + 未归类区
- [`references/blocks.md`](blocks.md) —— 17 个积木的完整 DSL
- [`references/extend.md`](extend.md) —— 积木不够用时怎么加一个
- `skill/` —— **skill 文档渲染出来的站点页**（`npm run skill` 生成，进仓库）
- `tools/skill-view.mjs` —— 渲染 skill 到 `skill/`；`.preview/` 留给临时预览（不进仓库）
- `tools/probe/visual-check.js` —— 浏览器探针（独立文件，不是模板字符串）
- `tools/visual-baseline.json` —— 已知问题基线（积木画不了的那些）
- `notes/blocks-cheatsheet/note.md` —— 可运行的积木示例
- `notes/data-warehouse-cdc-flink/note.md` —— 长文转图的实战案例

### 实战：一棵完整的树

`notes/sql-builder-v2-*` 是一棵**已完成的嵌套产物树**（12 篇），
从 [① 概念篇](notes/sql-builder-v2-concepts/note.md) 开始。

值得看的几篇：

| 看什么 | 去哪 |
|---|---|
| 递归六层怎么落到具体一篇 | [④ core 篇](notes/sql-builder-v2-core/note.md) · [⑨ crowd 篇](notes/sql-builder-v2-crowd/note.md) |
| 一个抽象怎么讲透 | [⑤ Rule[] 篇](notes/sql-builder-v2-core-rule/note.md) —— 四种形态的 2×2 |
| 怎么把「架构裂缝」写成一篇 | [⑧ 数组条件的两种路径](notes/sql-builder-v2-core-dialect-array/note.md) |
| 树长出来的新节点长什么样 | [⑫ 条件树重写](notes/sql-builder-v2-crowd-combi-optimizer/note.md) |

（`sql-builder-v2-code-map` 和 `sql-builder-v2-core-abstractions` 是**旧版**，
内容已拆进上面 12 篇，只作为历史素材保留。）
