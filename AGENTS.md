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

它包含讲解原则、工作流、积木选择和协作约定。
收到【图解】后按当前请求区分讨论、审阅、制作和修改，不自动新建页面或扩大范围。

先读 skill 开头的「怎么读取这份 skill」。文档较长，截断后要续读，不能只看原则和流程概览。
按 `skill-read` 输出的步骤必读章节继续读取，交付前读完第8步所有细则。
该工具的清单和完成提示只是输出范围，不证明读过关联正文或验收通过；保留实际读取与检查记录。

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

在当前会话的 worktree 中操作，不为执行命令切回主仓库。

```bash
npm run --silent skill-read -- step 6        # 原文分块和本步读取入口，按下一块命令续读
npm run --silent skill-read -- section 资料查证
npm run --silent skill-read -- list          # 当前标题与行号，不是正文
npm run new -- my-note-slug                 # 仅新建，修改已有笔记时不运行
npm run check                               # 校验语法、约定和文档一致性
npm run block -- my-note-slug 1             # 单块截图，默认不打开浏览器
npm run view -- my-note-slug --no-open      # 单篇预览构建
npm run visual-check -- my-note-slug        # 检查该篇 dist/ 产物
npm run build:standalone                    # 全量构建，交付前确认依赖与共享资源
npm run visual-check                        # 全站布局检查
npm run skill                               # 改 skill 文档后重建页面
```

## 验收与信息保留

制作前读七条原则、写作规范、硬约束和相应工作流，编辑或提交前读多会话协作；其他章节按步骤条件读取。
直接读文件或使用章节工具都要确认所需范围完整，读取被截断或上下文压缩丢失细节时，先补读再操作。

交付前执行 skill 第8步的各项检查，记录位置、证据、发现的问题、处理办法和复查结果。
可以共用一轮阅读或截图，但不能用「已自检」代替术语、事实、例子、结构、主线、图解和交互的具体结果。
未解决问题不标通过，自检不冒充用户验收或人工核对。

改写文档、skill 或工作流时，逐项核对原内容的关键动作、条件、判据、修法和重要例子。
合并或移置要有明确新位置；删除错误规则要保留仍成立的目的与方法。
旧锚点存在和构建通过，不等于重要信息已经保留。不为压缩篇幅省掉可执行方法。

## 交付与发布

交付时提供页面路径、修改范围和验证结果，说明未解决问题或既有工具局限。
全量构建不等于代提交别人的改动；检查本次相关源文件及重建产物，点名暂存并核对 staged 变更。

推送 `main` 会更新站点。约定包含上线时，推送后确认线上页面更新；只要求本地预览或暂不发布时，遵守已确认范围。
`.githooks/pre-push` 会在推送前重新构建和检查，不绕过失败的校验。
