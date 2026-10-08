#!/usr/bin/env node
/* ============================================================
   skill-view.mjs — 用我们自己的工具链渲染 skill 自己
   ------------------------------------------------------------
   skill 的文档里用了 callout / compare 这些积木，渲染出来读比看
   markdown 源码舒服得多 —— 而且顺带验证了「积木能不能表达复杂文档」。

   node tools/skill-view.mjs        # 渲染到 skill/ + 打开浏览器
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import MarkdownIt from 'markdown-it';
import { blocksPlugin, addAnchors, lintFences, lintLinkifyStars } from './lib/blocks.mjs';
import { renderPage } from './lib/page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, '.agents/skills/knowledge-html');
/* 渲染到 skill/ —— 这个目录**进仓库**，所以首页能链到它、手机上也能看。
 `.preview/` 留给临时预览（那些不进仓库）。 */
const OUT = path.join(ROOT, 'skill');

const md = new MarkdownIt({ html: true, linkify: true }).use(blocksPlugin);
const CHECK = process.argv.includes('--check');

const DEFAULT_PAGES = [
  {
    slug: 'skill',
    file: 'SKILL.md',
    title: 'knowledge-html skill',
    summary: '总入口：原则 · 工作流 · 规范 · 多会话协作 · 硬约束',
  },
  {
    slug: 'blocks',
    file: 'references/blocks.md',
    title: '积木参考',
    summary: '18 个积木的完整 DSL（示例都是真的，能直接跑）',
  },
  {
    slug: 'extend',
    file: 'references/extend.md',
    title: '加新积木 / 新控件',
    summary: '积木不够用时怎么办',
  },
];

/* 也支持直接给文件路径：node tools/skill-view.mjs plans/xxx.md
   —— 方案、设计文档这类也该能渲染出来读 */
const argvFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PAGES = argvFiles.length
  ? argvFiles.map((f) => {
      const rel = path.relative(ROOT, path.resolve(ROOT, f));
      const base = path.basename(rel, '.md');
      // 从 markdown 的第一个 # 标题当页面标题
      const head = fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/^#\s+(.+)$/m);
      return {
        slug: base,
        file: rel,
        title: head ? head[1].trim() : base,
        summary: rel,
        root: ROOT,
      };
    })
  : DEFAULT_PAGES.map((p) => ({ ...p, root: SKILL }));

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
let warned = 0;

for (const p of PAGES) {
  const src = stripLeadingH1(stripFrontmatter(fs.readFileSync(path.join(p.root, p.file), 'utf8')));
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
  /* skill 自己的文档也要查渲染结果。

     教训：blocks.md 是「教人别把围栏套围栏」的那篇，它自己就套了 ——
     而当时只有笔记跑 lint，于是这份文档的下半截全被困在代码块里，没人发现。 */
  /* SKILL.md 里的链接是**相对它自己目录**写的（`.agents/skills/knowledge-html/`），
   渲染到 `skill/` 之后全都指不到。这里换一遍：
     · 两个 reference → 同目录的 HTML
     · 仓库里的笔记 → ../notes/<slug>/
   （不换的话线上点进去是 404 —— 链接检查能查出来，但没人会去查整个 skill。） */
function relink(html) {
  /* 页面链接按目标文档名映射，兼容 references/X.md 和 ../SKILL.md。
     保留锚点，避免 reference 页返回总入口时仍然指向 Markdown 文件。 */
  const slugOf = {};
  PAGES.forEach((p) => { slugOf[path.basename(p.file, '.md')] = p.slug; });
  let out = html.replace(/href="(?:\.\.\/|\.\/)*(?:references\/)?([\w-]+)\.md(#[^"]*)?"/g, (m, name, hash) => {
    const slug = slugOf[name];
    return slug ? `href="./${slug}.html${hash || ''}"` : m;
  });
  return out
    .replace(/href="(\.\.\/)*notes\/([a-z0-9-]+)\/note\.md"/g, 'href="../notes/$2/"')
    .replace(/href="(?:\.\.\/)*(plans|tools|assets)\//g, 'href="../$1/');
}
const anchored2 = relink(anchored);
const issues = [...lintFences(anchored2, src), ...lintLinkifyStars(anchored2, src)];
  if (issues.length) {
    warned += issues.length;
    console.error(`\n  ⚠ ${p.file}`);
    for (const it of issues) console.error(`      ${it.replace(/\n/g, '\n      ')}`);
  }

  const full = renderPage({
    meta: {
      site: 'knowledge-html skill',
      eyebrow: 'skill 文档',
      title: p.title,
      summary: p.summary,
      status: 'reference', // 不是笔记，不显示 draft 横幅
    },
    body: anchored2,
    toc,
    assetPrefix: '../',
    /* 品牌和「← 全部笔记」都回站点首页 —— 读者可能是从首页点进来的 */
    backHref: '../index.html',
    topNav: `<nav class="topnav">${PAGES.map(
      (q) => `<a href="./${q.slug}.html"${q.slug === p.slug ? ' class="on"' : ''}>${q.title}</a>`,
    ).join('')}</nav>`,
  });

  /* --check：只渲染 + 检验，不写文件。
     挂进 `npm run check` —— 否则「check 绿了、skill 才报错」要跑两趟才发现。 */
  if (!CHECK) {
    fs.writeFileSync(path.join(OUT, `${p.slug}.html`), full);
    built.push({ ...p, toc: toc.length });
  } else {
    built.push({ ...p, toc: toc.length });
  }
  if (!CHECK) console.log(`  ✓ ${p.file.padEnd(24)} ${toc.length} 个章节`);
}

if (CHECK) {
  for (const b of built) console.log(`  ✓ ${b.file.padEnd(24)} ${b.toc} 个章节`);
  if (failed || warned) {
    console.error(`\n  ✗ skill 文档渲染有问题（${failed} 个失败，${warned} 个警告）`);
    process.exit(1);
  }
  console.log('  ✓ skill 文档渲染干净');
  process.exit(0);
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
  .back { display: inline-block; color: var(--text-muted); text-decoration: none;
    font-size: 13px; margin-bottom: 20px; }
  .back:hover { color: var(--blue); }
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
  <a class="back" href="../index.html">← 全部笔记</a>
<h1>knowledge-html skill</h1>
<p class="lead">这个 skill 用自己的工具链渲染自己 —— 文档里用的 <code>callout</code> / <code>compare</code>
就是它要教的积木。</p>
${nav}
</main></body></html>`,
);

console.log(`  ✓ skill/index.html (${built.length} 页)`);
if (warned) console.log(`  ⚠ ${warned} 个渲染问题（见上）—— 这些正是文档会「看着对、实际错位」的原因`);
if (failed) process.exitCode = 1;

/* 默认不开浏览器。agent 看的是这里的构建结果和退出码，
   每跑一次留一个标签页给它，只会让人收拾。人要看时加 --open。
   （block.mjs 同此约定。）*/
if (process.argv.includes('--open')) {
  execFileSync('open', [path.join(OUT, 'index.html')]);
  console.log('\n  → 已在浏览器打开（收尾时自己关掉）\n');
} else {
  console.log(`\n  页面  skill/index.html\n`);
}
