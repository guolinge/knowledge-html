#!/usr/bin/env node
/* ============================================================
   fix-fence.mjs — 自动把「外层反引号不够长」的围栏加长
   ------------------------------------------------------------
   node tools/fix-fence.mjs            # 修所有笔记 + skill 文档
   node tools/fix-fence.mjs --dry      # 只报不写

   为什么需要它
   ------------
   「围栏里嵌围栏」是这个仓库踩得最多的坑，而且有个残酷的性质：
   **页面看着正常，只是后面的段落全错位** —— 不看细节发现不了。

   `npm run check` 会报出来并告诉你怎么改，但每次都要：
     跑 check → 看报错 → 找那一行 → 手动改两个围栏 → 再跑 check
   而这个会话里光我自己就踩了 6 次。

   规则（和 markdown-it 的 fence 规则一致）
   ------------------------------------
   开围栏：行首 ≤3 空格 + ≥3 个反引号 + 语言标注
   关围栏：行首 ≤3 空格 + **≥ 开围栏长度** 的反引号 + 后面只有空白

   所以：**外层反引号的数量，必须比内容里打算出现的多。**
   内层是 3 个、缩进 2 个空格，外层就得 4 个 —— 因为缩进 ≤3 的关围栏能关掉外层。
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** 找出一段文本里所有「外层不够长」的围栏，返回 {line, lang, from, to} */
function scan(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(`{3,})(\S+)\s*$/.exec(lines[i]);
    if (!open) { i++; continue; }
    const ticks = open[1].length;
    const lang = open[2];
    let j = i + 1;
    while (j < lines.length && !new RegExp('^`{' + ticks + ',}\\s*$').test(lines[j])) j++;
    if (j >= lines.length) { i = j; continue; }

    /* 块内有没有「缩进 ≤3 且 tick 数 ≥ 外层」的围栏 —— 那才会真的关掉外层。
       缩进 >3 的（比如 YAML 块标量里的内容）关不掉，不用管。 */
    let worst = 0;
    for (let k = i + 1; k < j; k++) {
      const m = /^( {0,3})(`{3,})/.exec(lines[k]);
      if (m) worst = Math.max(worst, m[2].length);
    }
    if (worst >= ticks) out.push({ line: i + 1, lang, from: ticks, to: worst + 1, end: j + 1 });
    i = j + 1;
  }
  return out;
}

const TARGETS = [
  ...fs.readdirSync(path.join(ROOT, 'notes'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join('notes', d.name, 'note.md')),
  path.join('.agents', 'skills', 'knowledge-html', 'SKILL.md'),
  path.join('.agents', 'skills', 'knowledge-html', 'references', 'blocks.md'),
  path.join('.agents', 'skills', 'knowledge-html', 'references', 'extend.md'),
];

let total = 0;
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const hits = scan(lines);
  if (!hits.length) continue;

  for (const h of hits) {
    console.log(`  ${rel}:${h.line}  [${h.lang}] 外层 ${h.from} → ${h.to} 个反引号`);
    lines[h.line - 1] = '`'.repeat(h.to) + h.lang;
    lines[h.end - 1] = '`'.repeat(h.to);
  }
  total += hits.length;
  if (!DRY) fs.writeFileSync(abs, lines.join('\n'), 'utf8');
}

if (!total) {
  console.log('  ✓ 没有需要修的围栏');
} else if (DRY) {
  console.log(`\n  ${total} 处待修（加 --dry 只是预览，去掉它就写）\n`);
  process.exitCode = 1;
} else {
  console.log(`\n  ✓ 修了 ${total} 处。跑 npm run check 确认\n`);
}
