# AGENTS.md

这个仓库是一个**知识库**：用 Markdown 写内容，用自定义围栏积木画图，构建成可离线打开的单文件 HTML。

## 开工第一件事：读会话板

```bash
BOARD="$(dirname "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")/.kh-board.md"
tail -30 "$BOARD"
```

==这个仓库会被多个 AI 会话同时编辑，那是它们之间唯一的通信渠道。==
谁在改什么、谁要推了、谁给你留了话，都在上面。

- 完整协议：`.agents/skills/knowledge-html/references/multi-session-board.md`
- 一句话版：**看 `tail -30`；发 `printf '...\n' >> "$BOARD"`；永远不要重写整个文件**
- **动共享源之前、推送之前，各读一次**

## 你要做的第二件事

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

1. **按表达需要使用积木。** 积木是省力工具，语法通过后仍要检查实际表达。
   表达不顺手就组合 / 给积木加字段 / 新建积木 / 用 `raw` 直接写 HTML。
   不为迁就布局而删掉关键关系或改变过程顺序。
2. **不要在正文写 `# 一级标题`** —— 标题只写在 `meta.json` 的 `title`。
3. **agent 生成的内容 `status` 一律是 `draft`** —— `verified` 表示人工核对过，
   它会渲染成页内的溯源头。漂亮的页面会自带「这应该是对的」的暗示，别让它撒谎。

## 内容质量

检查用户卡住的环节是否得到解释，以及他能否看出关键关系、讲清关键步骤。
与理解有关的位置、归属、分支和状态变化要在图上呈现，卡点决定详略，不决定画不画。
比较和并列信息可以用表格或卡片；简单操作清单、判断和过渡句可以留文字。

## 两个容易忽略的写作原则

1. **先判断读者需要哪一层解释**：概念、组织，还是架构 / 实现。
   「看不懂」不足以说明卡在概念层，先看他已熟悉什么、具体哪里接不上。
   介绍新概念时从具体场景和数据例子开始，不用代码标识符代替概念说明。
2. **按表达需要使用和扩展积木**：见上面第 1 条硬约束。

## 常用命令

```bash
npm install
npm run new -- my-note-slug      # 新建一篇
npm run check                    # 校验（YAML 错误会定位到行）
npm run view -- my-note-slug     # 构建 + 浏览器打开
npm run build:standalone         # 产出 dist/*.html（内联全部资源，可直接发人）
```

推送即上线；`.githooks/pre-push` 会在推送前重新构建，产物过期时拒绝推送。
