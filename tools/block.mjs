#!/usr/bin/env node
/* ============================================================
   block.mjs — 只看一个积木
   ------------------------------------------------------------
   node tools/block.mjs <slug> <n>            # 只看第 n 个积木（1 起）：量高 + 截图
   node tools/block.mjs <slug> <n> --open     # 顺便在浏览器里打开（人看时才用）
   node tools/block.mjs <slug> --list         # 列出这一篇有哪些块

   为什么需要它
   -----------
   原来的反馈回路是「写完一整篇 → run check → build → 截图 → 肉眼看」。
   一篇 22 个积木的笔记，问题会**一次性**暴露，然后每个都要单独一轮
   「改 → 构建 → 截图 → 看」。

   真实数据（写 notes/crm-local-stack 那次）：
     22 个积木单元、19 张截图、8 个问题
     其中 check 抓到 1 个、visual-check 抓到 0 个
     剩下 7 个全是靠截图肉眼看出来的

   把回路缩短到「写完一块 → 看一眼」，每个问题就只花一分钟。

   它做的事
   --------
   1. 按 markdown 的围栏规则切出第 n 个块（正确处理 4/5 个反引号的外层）
   2. 用一个**完整的页面外壳**渲染它 —— 不是裸 HTML：
      theme.css + blocks.css + archify-embed.css + app.js 全都在，
      所以积木的 JS 测量（flow 的连线、seq 的 lifeline）会真的跑。
   3. 先量内容高度、再截图 —— 写死高度会把高积木截断
   4. 截图到 /tmp/kb-<slug>-<n>.png，并打印路径

   **默认不开浏览器。** agent 看的是截图文件，开标签页对它没用，
   只会给你留下一个个要手动关的标签。人要看时加 --open。
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { blocksPlugin, blockNames, addAnchors, lintFences, lintLinkifyStars } from './lib/blocks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* 先把插件跑一遍 —— 积木名从渲染器的注册表拿，注册发生在 use() 的那一刻。
   ==原来这里手抄了一份清单，加了 memmap 之后没同步：==
   `npm run check` 是绿的，但 block 把它当成代码块，--list 的编号和截图全错。
   同一份东西抄两遍，改的时候一定漏。 */
const md = new MarkdownIt({ html: true, linkify: true }).use(blocksPlugin);
const BLOCK_LANGS = blockNames();

const [, , slug, nthArg] = process.argv;
const OPEN = process.argv.includes('--open');

if (!slug) {
  console.error('用法：npm run block -- <slug> <n>');
  console.error('      npm run block -- <slug> --list');
  console.error('例：  npm run block -- crm-local-stack 3');
  process.exit(1);
}

const NOTE = path.join(ROOT, 'notes', slug, 'note.md');
if (!fs.existsSync(NOTE)) {
  console.error(`找不到 notes/${slug}/note.md`);
  process.exit(1);
}
const src = fs.readFileSync(NOTE, 'utf8');

/* ---------- ① 切块 ----------
   按 markdown 的围栏规则切。**必须自己实现**，不能用 /\`\`\`([\s\S]*?)\`\`\`/ ——
   那个在「围栏里嵌围栏」时会切错，而「围栏里嵌围栏」正是这个仓库最常踩的坑之一。

   规则（和 markdown-it 的 fence 规则一致）：
   - 开围栏：行首 ≤3 空格 + ≥3 个反引号 + 语言标注
   - 关围栏：行首 ≤3 空格 + **≥ 开围栏长度** 的反引号 + **后面只有空白**
     ````yaml 这种后面带字的**不关**（所以 4 个反引号的外层能装下 3 个反引号的内层）
*/
function splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^ {0,3}(`{3,})(\w[\w-]*)\s*$/);
    if (!open) {
      i++;
      continue;
    }
    const [, fence, lang] = open;
    const startLine = i;
    let j = i + 1;
    while (j < lines.length) {
      const close = lines[j].match(/^ {0,3}(`{3,})([^\S\n]*)$/);
      if (close && close[1].length >= fence.length) break;
      j++;
    }
    if (j >= lines.length) {
      // 没关 —— 这本身是个 bug，报出来比默默跳过有用
      blocks.push({
        lang,
        startLine: startLine + 1,
        endLine: lines.length,
        text: lines.slice(startLine, lines.length).join('\n'),
        unclosed: true,
      });
      break;
    }
    blocks.push({
      lang,
      startLine: startLine + 1,
      endLine: j + 1,
      text: lines.slice(startLine, j + 1).join('\n'),
    });
    i = j + 1;
  }
  return blocks;
}

const blocks = splitBlocks(src);

/* ---------- --list ---------- */
if (nthArg === '--list' || nthArg == null) {
  console.log(`\n  notes/${slug}/note.md —— 共 ${blocks.length} 个块\n`);
  blocks.forEach((b, k) => {
    const isBlock = BLOCK_LANGS.includes(b.lang);
    const flag = isBlock ? '积木' : '代码';
    const first = b.text
      .split('\n')
      .slice(1)
      .find((l) => l.trim());
    console.log(
      `  ${String(k + 1).padStart(2)}  [${flag}] ${b.lang.padEnd(12)} ` +
        `L${b.startLine}-${b.endLine}   ${(first || '').trim().slice(0, 46)}`,
    );
  });
  console.log(`\n  看第 n 个：npm run block -- ${slug} <n>\n`);
  process.exit(0);
}

const n = Number(nthArg);
if (!Number.isInteger(n) || n < 1 || n > blocks.length) {
  console.error(`第 ${nthArg} 个块不存在（这一篇有 1~${blocks.length} 个）`);
  console.error(`  npm run block -- ${slug} --list`);
  process.exit(1);
}

const target = blocks[n - 1];
if (target.unclosed) {
  console.error(`\n  ✗ 第 ${n} 个块没有闭合的围栏（从 L${target.startLine} 到文件末尾）`);
  console.error('    多半是「围栏里嵌围栏」：内层的裸围栏把外层提前闭合了。');
  process.exit(1);
}

/* ---------- ② 渲染 ---------- */
const env = { file: `notes/${slug}/note.md`, warnings: [] };

let body;
try {
  ({ html: body } = addAnchors(md.render(target.text, env)));
} catch (e) {
  console.error(`\n  ✗ 第 ${n} 个块（${target.lang}）渲染失败\n`);
  console.error(e.message.replace(/^/gm, '      '));
  process.exit(1);
}

/* 渲染结果的检查也要跑 —— 这一块正是「看着对、实际错」的高发区 */
const issues = [...lintFences(body, target.text), ...lintLinkifyStars(body, target.text)];

/* ---------- ③ 拼一个完整页面 ---------- */
/* 用 file:// 绝对路径引资源，而不是相对路径 —— 临时页放在 /tmp 下，
   相对路径会全 404，积木的 JS 测量就跑不起来，看到的是没画线的图。 */
const assets = ['theme.css', 'blocks.css', 'archify-embed.css']
  .map((f) => `<link rel="stylesheet" href="file://${path.join(ROOT, 'assets', f)}">`)
  .join('\n');
const script = `<script>
  /* 把内容真实高度写进 <title>，让 block.mjs 先量后截。

     为什么不只监听 load：外链资源（字体、嵌图）只要有一个没回来，
     load 就永远不触发 —— 实测过，那会让高度静默地回退成默认值，
     而截图看着又「没问题」，很难发现。

     所以挂三个钩子，谁先跑算谁。后跑的会覆盖前面的，
     所以测量本身是幂等的（量的都是同一个文档高度）。 */
  function kbMeasure() {
    const m = document.querySelector('main');
    const h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      m ? m.getBoundingClientRect().bottom + window.scrollY : 0,
    );
    if (h > 0) document.title = 'H=' + Math.ceil(h);
  }
  /* 积木的 JS（flow 的连线、seq 的 lifeline）在 DOMContentLoaded 之后才画 SVG，
     所以第一次测要等一帧，否则量到的是没画线的媫个子。 */
  document.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(kbMeasure);
    setTimeout(kbMeasure, 600);
  });
  window.addEventListener('load', () => requestAnimationFrame(kbMeasure));
  setTimeout(kbMeasure, 2500);
<\/script><script src="file://${path.join(ROOT, 'assets', 'app.js')}"></script>`;

const OUT = path.join(ROOT, 'node_modules', '.block-preview.html');
fs.writeFileSync(
  OUT,
  `<!DOCTYPE html><html lang="zh-CN" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>block ${n} · ${slug}</title>
${assets}
<style>
  /* 不加这个的话，宽屏上积木会被拉满整个窗口，看不出它在文章里的真实宽度 */
  body { margin: 0; background: var(--bg); }
  main { max-width: 1280px; margin: 0 auto; padding: 24px; }
  .bp-bar { max-width: 1280px; margin: 0 auto; padding: 10px 24px 0;
    font: 12px/1.6 ui-monospace, monospace; color: var(--text-faint); }
  .bp-bar b { color: var(--text-2); }
  /* 截图/量高都跑在 --virtual-time-budget 下，而**那个模式下 CSS 过渡不会被推进** ——
     元素会停在过渡的起点。控件一旦点了按钮（切状态），截出来就是点击前的样子，
     而 DOM 里的 class 其实已经是对的。实测：按钮的 class 和计算样式完全对调。
     ==所以预览页里一律关掉过渡==，截到的永远是最终态。
     （transition 只在值**改变**时触发，初次渲染不受影响 —— 所以 visual-check 量静态布局没事，
       只有「点一下再截图」会踩到。） */
  *, *::before, *::after { transition: none !important; animation: none !important; }
</style></head>
<body>
<div class="bp-bar">第 <b>${n}</b>/${blocks.length} 个块 · <b>${target.lang}</b> · L${target.startLine}–${target.endLine}</div>
<main>${body}</main>
${script}
</body></html>`,
);

/* ---------- ④ 截图 + 打开 ----------
   截图分两趟，**先量高度再截** ——
   写死高度会把高积木截断（写完一块看一眼，结果看的是半块，等于没看）。
   第一趟只量 [data-mount] 底部到文档顶的距离，第二趟用量的高度重新截。 */
const SHOT = `/tmp/kb-${slug}-${n}.png`;
const WIDTH = 1280;

function contentHeight() {
  /* 第一趟：把量到的高度写进 <title>，再从 --dump-dom 里读回来 */
  try {
    const dump = execFileSync(
      CHROME,
      ['--headless', '--disable-gpu', '--hide-scrollbars',
       /* 必须和截图那趟同宽 —— 不同宽度会重排，量出来的高度就对不上。
          高度故意给得很矮：scrollHeight 至少等于视口高，
          给 900 的话短积木会被量成 900，截图就多出一大截空白。 */
       `--window-size=${WIDTH},200`,
       '--virtual-time-budget=4000', '--dump-dom', `file://${OUT}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, maxBuffer: 32 << 20 },
    );
    const m = dump.match(/<title>H=(\d+)<\/title>/);
    if (m) return Math.min(20000, Math.max(400, Number(m[1]) + 48));
  } catch {
    /* 量不到就用默认 —— 不能因为量高度失败就看不到图 */
  }
  console.error('  ⚠ 量不到内容高度，截图按 900 高。高积木可能被截断。');
  return 900;
}

if (fs.existsSync(CHROME)) {
  const h = contentHeight();
  try {
    execFileSync(
      CHROME,
      ['--headless', '--disable-gpu', '--hide-scrollbars', '--screenshot=' + SHOT,
       `--window-size=${WIDTH},${h}`, '--virtual-time-budget=4000', `file://${OUT}`],
      { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 },
    );
  } catch {
    /* 截图失败不影响预览，别把这条路堵死 */
  }
}

const isBlock = BLOCK_LANGS.includes(target.lang);
console.log(`\n  第 ${n}/${blocks.length} 个块  [${isBlock ? '积木' : '代码'}] ${target.lang}  L${target.startLine}–${target.endLine}`);
if (fs.existsSync(SHOT)) console.log(`  截图  ${SHOT}`);
console.log(`  页面  ${path.relative(ROOT, OUT)}`);

if (issues.length) {
  console.error(`\n  ⚠ 这一块的渲染结果有问题（正是「看着对、实际错」那类）：`);
  for (const it of issues) console.error(`      ${it.replace(/\n/g, '\n      ')}`);
} else {
  console.log('  ✓ 渲染结果的约定检查通过');
}

if (OPEN) {
  execFileSync('open', [OUT]);
  console.log('\n  → 已打开（收尾时自己关掉）\n');
} else {
  console.log('');
}
