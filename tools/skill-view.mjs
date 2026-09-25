#!/usr/bin/env node
/* ============================================================
   skill-view.mjs — 用我们自己的工具链渲染 skill 自己
   ------------------------------------------------------------
   skill 的文档里用了 callout / compare 这些积木，渲染出来读比看
   markdown 源码舒服得多 —— 而且顺带验证了「积木能不能表达复杂文档」。

   node tools/skill-view.mjs        # 渲染 + 打开浏览器
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import MarkdownIt from 'markdown-it';
import { blocksPlugin, addAnchors } from './lib/blocks.mjs';
import { renderPage } from './lib/page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, '.agents/skills/knowledge-html');
const OUT = path.join(ROOT, '.preview');

const md = new MarkdownIt({ html: true, linkify: true }).use(blocksPlugin);

const PAGES = [
  {
    slug: 'skill',
    file: 'SKILL.md',
    title: 'knowledge-html skill',
    summary: '总入口：原则 · 工作流 · 规范 · 硬约束',
  },
  {
    slug: 'blocks',
    file: 'references/blocks.md',
    title: '积木参考',
    summary: '17 个积木的完整 DSL（示例都是真的，能直接跑）',
  },
  {
    slug: 'extend',
    file: 'references/extend.md',
    title: '加新积木',
    summary: '积木不够用时怎么办',
  },
];

/** 去掉 SKILL.md 顶部的 YAML frontmatter（name / description 是给 agent 读的） */
function stripFrontmatter(src) {
  return src.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/** 去掉正文里的一级标题 —— 标题由 renderPage 从 meta 生成 */
function stripLeadingH1(src) {
  return src.replace(/^\s*#\s+.*\n/, '');
}

fs.mkdirSync(OUT, { recursive: true });

const built = [];
let failed = 0;

for (const p of PAGES) {
  const src = stripLeadingH1(stripFrontmatter(fs.readFileSync(path.join(SKILL, p.file), 'utf8')));
  const env = { file: p.file, warnings: [] };

  let anchored;
  let toc;
  try {
    ({ html: anchored, toc } = addAnchors(md.render(src, env)));
  } catch (e) {
    // 一篇写坏不该阻塞其他页 —— 报出文件、行号、原因
    console.error(`\n  ✗ ${p.file}\n${e.message.replace(/^/gm, '      ')}\n`);
    failed++;
    continue;
  }

  // 相对链接在预览里会 404（reference 指向 SKILL.md 这类），标注一下不阻断
  const full = renderPage({
    meta: {
      site: 'knowledge-html skill',
      eyebrow: 'skill 文档',
      title: p.title,
      summary: p.summary,
      status: 'reference', // 不是笔记，不显示 draft 横幅
    },
    body: anchored,
    toc,
    assetPrefix: '../',
    backHref: './index.html',
  });

  fs.writeFileSync(path.join(OUT, `${p.slug}.html`), full);
  built.push({ ...p, toc: toc.length });
  console.log(`  ✓ ${p.file.padEnd(24)} ${toc.length} 个章节`);
}

if (!built.length) {
  console.error('\n  没有渲染出任何页面。');
  process.exit(1);
}

/* 迷你索引：三页互相跳转 */
const nav = built
  .map(
    (p) => `<a class="navcard" href="./${p.slug}.html">
      <b>${p.title}</b>
      <span>${p.summary}</span>
      <em>${p.toc} 个章节</em>
    </a>`,
  )
  .join('\n');

fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!DOCTYPE html><html lang="zh-CN" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>knowledge-html skill</title>
<link rel="stylesheet" href="../assets/theme.css"><link rel="stylesheet" href="../assets/blocks.css">
<style>
  main { max-width: 720px; margin: 0 auto; padding: 60px 24px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .lead { color: var(--text-muted); margin: 0 0 32px; }
  .navcard { display: block; text-decoration: none; color: inherit;
    border: 1px solid var(--border); border-left: 3px solid var(--blue);
    border-radius: 12px; padding: 16px 18px; margin-bottom: 12px;
    background: var(--surface); transition: transform .15s, border-color .15s; }
  .navcard:hover { transform: translateX(3px); border-color: var(--blue); }
  .navcard b { display: block; font-size: 16px; margin-bottom: 4px; }
  .navcard span { display: block; color: var(--text-muted); font-size: 13px; }
  .navcard em { display: block; color: var(--text-faint); font-size: 12px;
    font-style: normal; margin-top: 8px; }
</style></head><body><main>
<h1>knowledge-html skill</h1>
<p class="lead">这个 skill 用自己的工具链渲染自己 —— 文档里用的 <code>callout</code> / <code>compare</code>
就是它要教的积木。</p>
${nav}
</main></body></html>`,
);

console.log(`  ✓ .preview/index.html (${built.length} 页)`);
if (failed) process.exitCode = 1;

if (!process.argv.includes('--no-open')) {
  execFileSync('open', [path.join(OUT, 'index.html')]);
  console.log('\n  → 已在浏览器打开\n');
}
