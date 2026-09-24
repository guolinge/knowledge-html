# 知识笔记

把知识**讲清楚**的个人知识库。每篇笔记最终产出两个东西：

1. **站点页面** —— 挂在 GitHub Pages 上，可检索、可浏览；
2. **单文件 HTML** —— 内联全部样式和脚本，发给同事双击就开，不登录、不联网、不装软件。

> Notion 链接会烂，飞书要权限，Obsidian 要装软件。
> 一个 `.html` 文件放十年还能打开，这是这个仓库唯一真正独特的价值。

---

## 快速开始

```bash
npm install

npm run new -- mysql-index-internals   # 新建一篇（会生成 meta.json + note.md）
# ...编辑 notes/mysql-index-internals/note.md...

npm run build              # 构建页面 + 首页索引
npm run serve              # → http://localhost:4321 本地预览
npm run build:standalone   # 额外产出 dist/<slug>.html（单文件，可直接发人）
```

---

## 目录结构

```
.
├─ index.html                     # 首页知识地图（自动生成，含搜索与标签筛选）
├─ assets/
│  ├─ theme.css                   # 设计 token + 页面骨架（改这里 = 全站换肤）
│  ├─ blocks.css                  # 积木原语
│  └─ app.js                      # 主题、目录高亮、复制、自测、交互控件
├─ notes/
│  └─ data-warehouse-cdc-flink/
│     ├─ meta.json                # 标题 / 标签 / 来源 / 状态  ← 元数据
│     ├─ note.md                  # 唯一真相源                   ← 你只改这里
│     └─ index.html               # 构建产物
├─ dist/                          # 单文件版本（构建产物，已 gitignore）
└─ tools/
   ├─ render.mjs                  # 构建入口
   ├─ serve.mjs                   # 零依赖预览服务器
   ├─ new.mjs                     # 新建笔记
   ├─ templates/note.md           # 模板 + 积木语法参考
   └─ lib/{blocks,page,home}.mjs  # 积木渲染 / 页面外壳 / 首页
```

**唯一的真相源是 `note.md`。** `index.html` 是产物，改了会被覆盖。
好处是：全文可搜索、可 `git diff`、可喂回给 AI、可换主题重渲染、可导出 Anki。

---

## 表达原语（积木）

正文用标准 Markdown。需要更强表达力时用自定义围栏块，围栏内是 YAML：

| 积木 | 解决什么 |
|---|---|
| `lane-stack` | 分层 / 泳道流程（ETL 链路、请求生命周期、系统分层） |
| `journey` | 一个东西在每一步的**形态快照**（字段怎么变的） |
| `compare` | 多维对比表，窄屏自动折叠成卡片 |
| `callout` | 提示 / 陷阱 / 一句话结论 |
| `checklist` | 正例 / 反例清单 |
| `quiz` | 折叠式自测 |
| `demo` | 可交互模拟 |
| `summary` / `raw` | 收尾总结卡 / HTML 逃生口 |

完整语法和可运行示例见 **[`notes/blocks-cheatsheet/`](notes/blocks-cheatsheet/note.md)**，
或新建一篇时生成的模板 `tools/templates/note.md`。

### 为什么是「积木」而不是「模板」

模板是填内容，积木是选表达方式。同一段知识，用 `journey` 还是 `lane-stack`，
取决于你要讲的是**结构**还是**变化** —— 这个选择才是笔记质量的分水岭。

积木只消费 `theme.css` 的 token，不写死色值，所以换肤不用动内容。

---

## 三条约定

### 1. 每篇必带溯源头

`meta.json`：

```json
{
  "title": "数据仓库 vs 数据库 · CDC vs Flink",
  "summary": "一句话说清这篇解决什么问题。",
  "tags": ["数据仓库", "CDC"],
  "status": "draft",
  "generated": "2026-09-24",
  "model": "deepseek-v4.1-flash",
  "sources": ["https://..."],
  "verified": null
}
```

`status` 三档：`draft`（页面顶部挂黄条警告）→ `reviewed` → `verified`。

**这条约定是这个仓库最重要的设计。** 漂亮的 HTML 会自带「这应该是对的」的暗示，
而它可能只是某次对话的产物。半年后你打开一个页面，必须能一眼看出：
哪个数字是编的、哪个结论没人核对过。纯文本笔记不会有这个问题，因为丑的东西天然让人警惕。

### 2. 一级标题只写在 `meta.json` 里

正文再写一遍 `# 标题` 会被构建时剥掉（并作为 `title` 的兜底）。

### 3. 想复用就抽象成积木

同一类知识写第三遍的时候，别再复制 HTML —— 去 `tools/lib/blocks.mjs` 加一个渲染器，
在 `assets/blocks.css` 加对应样式。积木是资产，页面只是实例。

---

## 部署到 GitHub Pages

```bash
git push
```

仓库 Settings → Pages → Source 选 `main` / `root`。
根目录的 `.nojekyll` 已经放好了，避免 Jekyll 干扰。

---

## 这个仓库会怎么死

写在这里提醒自己：

1. **死于「生成成本 >> 消费频率」** —— 做一页 20 分钟，看一页 3 分钟，看完就完了。
   攒到第 30 页时自己都不记得有什么。**对策：每篇结尾必须有 `quiz`，逼自己复述一遍。**
2. **死于「漂亮但不可信」** —— 对策：上面的第 1 条约定。
3. **死于「收藏代替理解」** —— 对策：`index.html` 显示的是「共 N 篇」而不是「已收藏 N 篇」。
