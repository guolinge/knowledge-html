# AGENTS.md

这个仓库是一个**知识库**：用 Markdown 写内容，用自定义围栏积木画图，构建成可离线打开的单文件 HTML。

## 你要做的第一件事

如果你要**写或改笔记**，先读 skill：

```
.agents/skills/knowledge-html/SKILL.md
```

它包含：怎么把一段内容变成图、10 个积木的选择表、以及会踩的坑。

- 积木完整 DSL → `.agents/skills/knowledge-html/references/blocks.md`
- 积木不够用时怎么加 → `.agents/skills/knowledge-html/references/extend.md`
- 可运行的积木示例 → `notes/blocks-cheatsheet/note.md`

## 核心事实

| | |
|---|---|
| **唯一真相源** | `notes/<slug>/note.md`（+ `meta.json`） |
| **产物（别手改）** | `notes/<slug>/index.html`、`index.html`、`dist/*.html` |
| **构建** | `npm run build` · 校验 `npm run check` · 构建并打开 `npm run view -- <slug>` |
| **新建** | `npm run new -- <slug>` |

## 三条硬约束

1. **怎么讲清楚怎么来，不要拘泥积木。** 积木是省力工具，不是验收标准。
   表达不顺手就组合 / 给积木加字段 / 新建积木 / 用 `raw` 直接写 HTML。
   **「合规但没讲清楚」比不画图更糟。**
2. **不要在正文写 `# 一级标题`** —— 标题只写在 `meta.json` 的 `title`。
3. **agent 生成的内容 `status` 一律是 `draft`** —— `verified` 表示人工核对过，
   它会渲染成页内的溯源头。漂亮的页面会自带「这应该是对的」的暗示，别让它撒谎。

## 唯一的质量判据

**用户卡住的那个环节，有没有变成一张图或一个交互。**

不是「内容完整」，不是「排版好看」，也不是「符合积木规范」。
图是稀缺资源，只有卡点值得画图。

## 常用命令

```bash
npm install
npm run new -- my-note-slug      # 新建一篇
npm run check                    # 校验（YAML 错误会定位到行）
npm run view -- my-note-slug     # 构建 + 浏览器打开
npm run build:standalone         # 产出 dist/*.html（内联全部资源，可直接发人）
```

推送即上线；`.githooks/pre-push` 会在推送前重新构建，产物过期时拒绝推送。
