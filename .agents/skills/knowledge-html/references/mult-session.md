# 多会话协作

> 从 SKILL.md 拆出来的。板子协议本身在 `multi-session-board.md`。

## 多会话协作

**这个仓库会被多个 agent 会话同时编辑** —— 用户会同时开好几个窗口，每个窗口一个 agent。

这不是假设，是常态。所以有一套规则必须共同遵守。

````callout
tone: green
icon: 📌
text: |
  **开工第一件事：读会话板。**

  ```bash
  BOARD="$(dirname "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")/.kh-board.md"
  tail -30 "$BOARD"
  ```

  ==那是几个会话之间唯一的通信渠道。== 谁在改什么、谁要推了、谁给你留了话，都在上面。

  完整协议见 [`references/multi-session-board.md`](multi-session-board.md)，
  一句话版：**看 `tail -30`；发 `printf '...\n' >> "$BOARD"`；永远不要重写整个文件。**

  **动共享源之前、推送之前，各读一次。** 这个板子不会通知你 —— 只有你去读的时候才生效。
````

### 先搞清楚：这不是分支的问题

```callout
tone: violet
icon: ⚠
quote: true
text: |
  ==多个会话**共用一个工作目录**，才是根因。==

  开分支解决不了 —— `git checkout -b` 只改 HEAD 指向哪，
  **工作区里的文件一个都没变**。两个 agent 在同一目录里，改的还是同一批文件。
```

**真实发生过**（2026-09-29）：

```text
提交 8575596
信息：crm-local-stack：命令速查提到 01 节，原理和流程图往后挪

实际：44 个文件，+39461 行，其中包括
  notes/data-admin-to-ui/note.md        428 行   ← 另一个会话 17:41 建的
  dist/data-admin-to-ui.html           6382 行
  archify/data-admin-flow.json          112 行
  assets/arch/data-admin-flow.svg       138 行
```

反向也一样：另一个提交用 `git add -A` 把别人做到一半的 13 个 `meta.json` 一并带走了。

三个设计放大了它 —— 它们本身都没错，错的是**假设只有一个改动人**：

| 设计 | 本意 | 共用目录时 |
|---|---|---|
| `git add -A` | 提交一个自洽快照 | **仓库级** —— 分不清谁改的 |
| 产物是全量的 | clone 下来就能开 | 我 build 会重建**所有人**的产物 |
| 保存即有竞态 | —— | A 保存、B 正在 build → B 构建出 A 的半成品 |

### 先做这件事：每个会话一个 worktree

```bash
cd ~/works/codes/knowledge-html
git worktree add ~/works/codes/kh-<会话名> -b <会话名>
cd ~/works/codes/kh-<会话名>
ln -s ~/works/codes/knowledge-html/node_modules node_modules
```

每个目录是**完整独立的工作区**：文件互不可见，`git add -A` 只会扫到自己的改动。
==误提交从根上消失。==

**三个实测出来的坑**：

| 坑 | 怎么办 |
|---|---|
| `node_modules` 不跟着 worktree 来 | 软链过去（上面那条），或各自 `npm install` |
| 软链显示成 `?? node_modules` | `.gitignore` 里写的是 `node_modules/`（带斜杠 = 目录），**匹配不上软链** —— 改成 `node_modules` |
| skill 的符号链接固定在主目录 | worktree 里改 skill **不生效**。skill 只有一份，这是好事 |

````callout
tone: amber
icon: 🪢
text: |
  **但「worktree 里改 skill 不生效」这句话会误导人走错一步。**

  真实布局是这样：

  ```
  ~/.agents/skills/knowledge-html  ──软链──→  <主仓库>/.agents/skills/knowledge-html
                                              <worktree>/.agents/skills/knowledge-html   ← 独立副本
  ```

  `.agents/skills/**` 是**进仓库的跟踪文件**，所以每个 worktree 各有一份。
  你按直觉去改 `~/.agents/skills/knowledge-html/SKILL.md`，==改的其实是**主仓库的工作区**==，
  而 `npm run check` 读的是 **worktree 里那份** —— 于是：

  | 你看到的 | 实际发生的 |
  |---|---|
  | 文件确实改了，内容也对 | 主仓库工作区脏了（别的会话会看到） |
  | `npm run check` 还是报「SKILL.md 说 20 个控件」 | worktree 那份没动 |

  ++正确做法：在 **worktree 里**改 `.agents/skills/knowledge-html/SKILL.md`。++
  主仓库那份等分支合并时自然更新。

  ==这次先改错了地方，`check` 报的却是「代码 22 个 vs 文档 20 个」，
  完全看不出是「改的是另一个副本」。==
````

**合并时冲突面比想象的小**。量过：==全仓库只有 `index.html` 一个文件是全量的==
（`dist/<slug>.html` 和 `notes/<slug>/index.html` 都是**每篇一个文件**，只有作者会动）：

| 文件 | 合并时 |
|---|---|
| `dist/<slug>.html`、`notes/<slug>/index.html` | 各改各的 → **不冲突** |
| `index.html`（首页树视图） | 所有人都动 → **必然冲突** |

`index.html` 冲突时**别手动 merge** —— 它是生成的：

```bash
git checkout --theirs index.html   # 随便选一边，反正是生成的
npm run build:standalone           # 用合并后的源重建
git add index.html && git commit
```

### 没条件开 worktree 时：点名 add，别用 `-A`

```callout
tone: amber
icon: ⚠
text: |
  ==把 `git add -A` 换成 `git add <具体路径>`。==
```

```bash
git add notes/<你的 slug>/ archify/<你的名字>.json assets/arch/<你的名字>.svg
git add assets/blocks.css assets/app.js      # 只在你确实改了它们时
git add index.html dist/                     # 产物是全量的，必须一起带上
```

**为什么这样更安全**：`-A` 是仓库级的，它不问「这是谁改的」。
点名 add 只带走你确认过的东西。

### 还有第二个矛盾：产物是全量的

即使分了 worktree，合并时还有一道坎。

```callout
tone: amber
icon: ⚠
quote: true
text: |
  ==构建产物是**全量**的。==

  `index.html`、`dist/*.html` 里包含**所有人的内容**。
  所以你没法「只提交自己的部分」—— 那样仓库就停在「产物新、源旧」的不一致状态，
  pre-push 钩子会直接拦下。
```

**推论**：提交 = **提交一个自洽快照** = 当前所有源 + 由它们构建出的所有产物。

这意味着**你必然会把别人的改动一起提交**。这不是错误，是设计。关键是把这件事做**安全**。

### 三类文件

| 类别 | 例子 | 谁负责 |
|---|---|---|
| **共享产物** | `index.html`、`dist/*.html`、`notes/<任意 slug>/index.html`、**`skill/*.html`** | **每次提交都要带上全部** |
| **共享源** | `assets/theme.css` `blocks.css` `app.js`、`tools/*.mjs`、`package.json`、`.agents/skills/**` | 谁改谁提交，但**要小心** |
| **私有源** | `notes/<你的 slug>/`、`archify/<你的名字>.json`、`assets/arch/<你的名字>.svg` | 只有你改 |

### 开工前（30 秒）

```bash
npm run status
```

它会把你工作区的改动**分类列出来**（临时文件 / 共享产物 / 共享源 / 笔记源），
并标出每项的修改时间。

- 干净 → 直接干活
- **有别人的改动** → 两种走法：
  - 你在 worktree 里 → 与你无关，但合并时要注意
  - 你在共用目录里 → 记住它们，但**不要用 `-A`**，点名 add
- 有别人的改动**且明显是半成品**（写了一半、构建不过）→ **先问用户**

### 干活时

1. **只改自己的文件。** 不要顺手改别人的 `note.md`，哪怕发现它写错了 —— 报告，不擅自改。
2. **改共享源要小步。** `blocks.css` / `app.js` 有别人在用：
   - ==改一条 CSS 规则就替换那一条，别用大区间替换==
   - 加控件 / 积木用**新名字**，别改别人的
   - 改完尽快提交，别攒着
3. **临时文件进 `.gitignore`。** 预览副本、截图、草稿别留在 `notes/` 里。
   约定：以 `_` 开头的文件是临时的（`_p.html`、`_wip.html`）。

### 提交时

```bash
npm run status              # ① 分类看清 —— 这一条不能省
npm run check               # ② 校验（含 skill 一致性）
npm run build:standalone    # ③ 重建全部产物
npm run skill               # ③b 重建 skill/（改了 skill 文档才需要）
npm run visual-check        # ④ 量图
git add <点名清单>          # ⑤ 优先点名；确认过才用 `-A`
node tools/status.mjs --cached   # ⑥ 再看一遍 staged 的
```

```callout
tone: amber
icon: ⚠
quote: true
text: |
  ==第 ⑤ 步优先点名 add。==

  共用目录里 `git add -A` 会把你**没看过的**东西一起带走 ——
  包括别人正在写的半成品。它不问「这是谁改的」。

  只有在你确实逐项确认过（第 ① 和 ⑥ 步都看过）时，`-A` 才可以。
```

```callout
tone: amber
icon: ⚠
text: |
  **但有一条例外：如果别人的源是半成品，不要提交。**

  半成品 = 明显写了一半、或构建不过。

  这时**停下来问用户**，别替别人改，也别把它带上。
  ==替别人提交一个坏文件，比漏提交更糟 —— 它会被当成「已经完成」。==
```

### 别人的改动怎么处理

| 情况 | 怎么办 |
|---|---|
| 别人的源完整、构建能过 | **一起提交**，提交信息里注明来源 |
| 别人的源是半成品 | **停下来问用户** |
| 只有别人的产物、没有源 | 说明源被漏了 → 找到源一起提交，或者问用户 |
| 别人改了共享源（`blocks.css`） | 一起提交，**在信息里说明你确认过它的改动** |

**提交信息里的注明格式**（已有先例）：

```text
来自并行会话（非本次工作，为保持产物与源一致一并提交）：
- notes/flink-source-transform-sink/（Flink 算子笔记）
- tools/visual-check.mjs（加 .keyby-viz 容器 + JSON 解析错误上下文）
```

### 构建和提交之间的竞态（真实踩过）

```callout
tone: red
icon: ⚠
text: |
  **`npm run build` 和 `git add` 之间，别人的文件可能又变了。**

  于是你提交的是「**源是新的、产物是旧的**」——
  pre-push 钩子一重建就发现对不上，直接拦下。
```

**时间线**（真实发生）：

```text
① 我 npm run build:standalone   → 从 note.md 的版本 A 构建出产物 A
② 我 git add -A && commit       → 期间别人保存了版本 B
                                  结果提交的是：源 B + 产物 A   ← 不一致
③ pre-push 重建                 → 从 B 构建出产物 B ≠ 产物 A → 拦下
```

**修法**：源已经提交了，只是产物过期 —— 重建后 amend：

```bash
npm run build:standalone
git add -A
git commit --amend --no-edit
git push
```

```callout
tone: amber
icon: ⚠
text: |
  ==如果这样还反复被拦，说明别人正在持续编辑。==

  那就别再重试了 —— **停下来问用户**，等对方告一段落。
  反复 amend 只会把你的提交变成「别人半成品的快照」。
```

### 别人的文件坏了，阻塞了共享构建

```callout
tone: amber
icon: ⚠
text: |
  ==`npm run check` 是全仓库的。别人一篇笔记写坏，你这边也过不了。==
```

**先分清是哪一类**：

| | 例子 | 怎么办 |
|---|---|---|
| **机械性问题** | YAML 裸标量以反引号开头 · 积木名拼错 · 引号没闭合 | ✅ **可以修**。工具自己会给出修法，改的是语法不是意思 |
| **语义性问题** | 内容写错了 · 数字不对 · 结构乱 | ❌ **不碰**。报告用户 |

```callout
tone: green
icon: ✅
text: |
  **判断标准：这个修改会不会改变别人想表达的意思？**

  加一对引号不会。改一个数字会。

  机械性修复要在提交信息里**单独列出来并注明**，别混在自己的改动里。
```

**真实案例**：并行会话的 Flink 笔记里有两行 `- q: \`xxx\` 是什么？` ——
YAML 里裸标量不能以反引号开头，整个仓库的 `check` 都挂了。
预检工具直接给出了修法（外面包一层双引号），修它零风险。

### 冲突处理

| 冲突的文件 | 怎么办 |
|---|---|
| `index.html`、`dist/*`、`notes/*/index.html` | **重新构建**，不要手动 merge。产物是生成的，冲突无意义 |
| `package.json` | 通常两边都加了 script → **两边都保留** |
| `blocks.css` / `app.js` | 真冲突，逐条看，**两边的改动都要留** |
| `note.md` | 不该发生。如果发生，说明两个会话改了同一篇 → **问用户** |

### 推送被拦下来怎么办

pre-push 会重建 + 量图。**它拦下来通常不是你的问题。**

```text
✗ 构建产物有变化（note.md 改了但没提交构建结果）
```
→ 有人（可能是你）改了源没重建。`git add` 上产物，`--amend` 重新提交。

```text
✗ 有图被画坏了
```
→ 看是哪个积木、哪一篇。**如果是别人笔记里的图坏了，报告用户，别去改别人的内容。**

### 四条硬规矩

1. **优先开 worktree。** 没条件就在共用目录里点名 `git add`，别用 `-A` ——
   共用目录里 `-A` 会带走别人正在写的半成品。
2. **产物和源必须一起提交。** 只交产物 → 来源不明；只交源 → 构建过期。
3. **不替别人改东西。** 发现问题 → 报告，不擅自改。
4. **提交前跑 `npm run status` —— 而且要看完。**
   别 `| head -45` 只扫前面一截就往下走。

---
