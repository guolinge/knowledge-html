#!/usr/bin/env node
/* ============================================================
   gaps.mjs — 图解缺口审计
   ------------------------------------------------------------
   npm run gaps -- <slug>         列出该篇的「正文段落」清单
   npm run gaps -- --all          全仓库扫一遍

   为什么要有这个工具：
     「图是稀缺资源，只有卡点值得画图」这句话被误读成了门槛，
     结果一堆「空间 / 顺序 / 状态」的内容退回成了文字。
     而用户手上本来就有文字版 —— 搬一遍排版等于没干活。

   为什么不用关键词 grep：
     试过。用户指着问的那几段，一个信号词都没命中。
     「进程 A 发出读盘请求后，CPU 立刻转去执行进程 B」
     —— 这句话里没有「先」「然后」「接着」里的任何一个。
     ==顺序是语义，不是词汇。== 所以这里只做一件事：
     把该被逐段审的对象**原样列出来**，判还是得人来判。

   什么算「正文段落」：
     非围栏内容、非标题、非列表、非表格、非引用、非行内强调行。
     剩下的就是那些「一段一段的话」—— 它们就是审的对象。
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES = path.join(ROOT, 'notes');

/* 一个段落要短到什么程度就不必看了 —— 过渡句、结论句本来就是用来断句的 */
const TRIVIAL = 22;
/* 超过这个长度，几乎一定有结构可画 */
const HEAVY = 90;

const args = process.argv.slice(2);
if (!args.length) {
  console.error('用法：npm run gaps -- <slug>    或    npm run gaps -- --all');
  process.exit(1);
}

const listSlugs = () => {
  if (!args.includes('--all')) return args.filter((a) => !a.startsWith('-'));
  return fs.readdirSync(NOTES).filter((d) => fs.existsSync(path.join(NOTES, d, 'note.md'))).sort();
};

/** 把一篇的正文切成「该被审的段落」 */
function paragraphs(md) {
  const lines = md.split('\n');
  const out = [];
  let fence = false;
  let buf = [];
  let start = 0;

  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(' ').trim();
    if (text) out.push({ line: start, text, chars: text.replace(/\s/g, '').length });
    buf = [];
  };

  lines.forEach((ln, i) => {
    if (/^`{3,}/.test(ln)) { flush(); fence = !fence; return; }
    if (fence) return;
    /* 标题 / 列表 / 表格 / 引用 / 分隔线：都不是「段落」 */
    if (/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|---|===)/.test(ln)) { flush(); return; }
    if (!ln.trim()) { flush(); return; }
    if (!buf.length) start = i + 1;
    buf.push(ln.trim());
  });
  flush();
  return out;
}

/** 这一篇用了多少个积木 / 图 */
function figures(md) {
  const kinds = {};
  let fence = false;
  for (const ln of md.split('\n')) {
    const m = ln.match(/^(`{3,})(\w[\w-]*)\s*$/);
    if (m) {
      if (!fence) kinds[m[2]] = (kinds[m[2]] || 0) + 1;
      fence = !fence;
      continue;
    }
    if (/^`{3,}\s*$/.test(ln)) fence = !fence;
  }
  return kinds;
}

let grand = { paras: 0, figs: 0 };
const report = [];

for (const slug of listSlugs()) {
  const file = path.join(NOTES, slug, 'note.md');
  if (!fs.existsSync(file)) { console.error(`  找不到 notes/${slug}/note.md`); continue; }
  const md = fs.readFileSync(file, 'utf8');
  const ps = paragraphs(md);
  const figs = figures(md);
  const figCount = Object.values(figs).reduce((a, b) => a + b, 0);

  const heavy = ps.filter((p) => p.chars >= HEAVY);
  const mid = ps.filter((p) => p.chars >= TRIVIAL && p.chars < HEAVY);
  const ratio = figCount ? (ps.length / figCount) : Infinity;

  report.push({ slug, ps, figs, figCount, heavy, mid, ratio });
  grand.paras += ps.length;
  grand.figs += figCount;
}

/* ---------- 打印 ---------- */
const bar = (n, max) => '█'.repeat(Math.max(1, Math.round((n / max) * 18)));

console.log('');
for (const r of report) {
  const flag = r.ratio > 3 ? '  ⚠ 段落偏多' : '';
  console.log(`  ${r.slug}`);
  console.log(`    ${r.ps.length} 个正文段落 · ${r.figCount} 个积木 · 段落/积木 = ${r.ratio === Infinity ? '—' : r.ratio.toFixed(1)}${flag}`);
  console.log(`    用到的：${Object.entries(r.figs).map(([k, v]) => `${k}×${v}`).join('  ') || '（一个都没有）'}`);

  if (r.heavy.length) {
    console.log(`    ── 重点看这几段（≥ ${HEAVY} 字，几乎一定有结构可画）`);
    for (const p of r.heavy.sort((a, b) => b.chars - a.chars)) {
      console.log(`       L${String(p.line).padEnd(4)} ${String(p.chars).padStart(3)} 字  ${p.text.slice(0, 62)}…`);
    }
  }
  if (r.mid.length) {
    console.log(`    ── 顺手扫一眼（${TRIVIAL}~${HEAVY} 字）`);
    for (const p of r.mid) {
      console.log(`       L${String(p.line).padEnd(4)} ${String(p.chars).padStart(3)} 字  ${p.text.slice(0, 62)}`);
    }
  }
  console.log('');
}

console.log(`  全仓库：${grand.paras} 个正文段落 / ${grand.figs} 个积木`);
console.log(`  段落/积木 = ${(grand.paras / grand.figs).toFixed(1)}${grand.paras / grand.figs > 3 ? '  ← 偏文字' : ''}`);
console.log('');
console.log('  怎么看这份清单：');
console.log('    · 「谁指向谁 / 先发生什么 / X 变成 Y / 按时间演进」→ 该画图，只是还没画');
console.log('    · 「为什么不用 X / 这么做会怎样」→ 判断和理由，就该留在文字里');
console.log('    · ①②③④ 的操作清单 → 步骤之间没有空间关系，画了反而多绕一层');
console.log('');
