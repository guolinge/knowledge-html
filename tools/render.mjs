#!/usr/bin/env node
/* ============================================================
   render.mjs — 构建
   ------------------------------------------------------------
   node tools/render.mjs                  # → notes/<slug>/index.html + index.html
   node tools/render.mjs --standalone     # 额外输出 dist/<slug>.html（内联 CSS/JS）
   node tools/render.mjs --only <slug>    # 只构建一篇
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { blocksPlugin, addAnchors } from './lib/blocks.mjs';
import { renderPage } from './lib/page.mjs';
import { renderHome } from './lib/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES = path.join(ROOT, 'notes');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const STANDALONE = argv.includes('--standalone');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

const md = new MarkdownIt({ html: true, linkify: true });
md.use(blocksPlugin);

/* ---------- 工具 ---------- */
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};

/** 读 meta.json；文件不存在或格式错误都给出可定位的提示，不静默吞掉 */
function readMeta(metaPath, slug) {
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(read(metaPath));
  } catch (e) {
    console.error(`  ✗ notes/${slug}/meta.json 解析失败：${e.message}`);
    process.exitCode = 1;
    return {};
  }
}

/** 从 HTML 里抽纯文本，供首页检索用 */
function toPlain(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 剥掉正文开头的 H1。
 * 约定：一级标题只写进 meta.json 的 title，由页面外壳渲染成 hero，
 * 正文再写一遍就会重复。若 meta 没写 title，则回退到 H1。
 */
function stripLeadingH1(src) {
  const m = src.match(/^\s*#\s+(.+?)\s*\n/);
  return { title: m ? m[1].trim() : null, body: src.replace(/^\s*#\s+[^\n]*\n/, '') };
}

/** 把外链 CSS/JS 内联，产出可单文件分发的版本 */
function inlineAssets(html) {
  return html
    .replace(
      /<link\s+rel="stylesheet"\s+href="[^"]*assets\/([\w.-]+)"\s*\/?>/g,
      (m, f) => `<style>\n${read(path.join(ROOT, 'assets', f))}\n</style>`,
    )
    .replace(
      /<script\s+src="[^"]*assets\/app\.js"\s*>\s*<\/script>/g,
      () => `<script>\n${read(path.join(ROOT, 'assets', 'app.js'))}\n</script>`,
    );
}

/* ---------- 主流程 ---------- */
function main() {
  if (!fs.existsSync(NOTES)) {
    console.error('找不到 notes/ 目录');
    process.exit(1);
  }

  const slugs = fs
    .readdirSync(NOTES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(NOTES, d.name, 'note.md')))
    .map((d) => d.name)
    .filter((s) => !ONLY || s === ONLY)
    .sort();

  if (!slugs.length) {
    console.log('notes/ 下还没有笔记。用 npm run new -- <slug> 创建第一篇。');
    return;
  }

  const entries = [];
  const now = new Date().toISOString().slice(0, 10);

  for (const slug of slugs) {
    const dir = path.join(NOTES, slug);
    const metaPath = path.join(dir, 'meta.json');
    const meta = readMeta(metaPath, slug);

    const raw = read(path.join(dir, 'note.md'));
    const { title: h1, body: src } = stripLeadingH1(raw);
    const { html: anchored, toc } = addAnchors(md.render(src));

    const full = renderPage({
      meta: { site: '知识笔记', ...meta, title: meta.title || h1 || slug },
      body: anchored,
      toc,
      assetPrefix: '../../',
      backHref: '../../index.html',
    });

    write(path.join(dir, 'index.html'), full);

    if (STANDALONE) {
      // 内联后不应再有任何外部资源标签，否则单文件分发会缺样式
  // 注意：只查真实标签，正文里提到 assets/ 路径属于正常内容
  const standalone = inlineAssets(full);
  const leftover = standalone.match(/<(?:link|script)[^>]*(?:href|src)="[^"]*assets\/[^"]*"/g);
  if (leftover) {
    console.error(`  ✗ ${slug}: standalone 仍残留外部引用 ${leftover.join(', ')}`);
    process.exitCode = 1;
  }
  write(path.join(DIST, `${slug}.html`), standalone);
    }

    entries.push({
      slug,
      title: meta.title || h1 || slug,
      summary: meta.summary || '',
      tags: meta.tags || [],
      status: meta.status || 'draft',
      generated: meta.generated || now,
      updated: meta.updated || '',
      plain: toPlain(anchored).slice(0, 4000),
    });

    console.log(
      `  ✓ ${slug}  ${toc.length} 个章节${STANDALONE ? `  → dist/${slug}.html` : ''}`,
    );
  }

  // 首页（只构建单篇时，仍从磁盘汇总全部条目，避免索引被截断）
  const allEntries = ONLY ? collectAll() : entries;
  write(
    path.join(ROOT, 'index.html'),
    renderHome(allEntries, { site: '知识笔记', assetPrefix: '' }),
  );
  console.log(`  ✓ index.html (${allEntries.length} 篇)`);
}

/** 只读 meta，用于 --only 时重建完整索引 */
function collectAll() {
  return fs
    .readdirSync(NOTES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const p = path.join(NOTES, d.name, 'meta.json');
      const meta = readMeta(p, d.name);
      const note = path.join(NOTES, d.name, 'note.md');
      const h1 = fs.existsSync(note)
        ? stripLeadingH1(read(note)).title
        : null;
      return {
        slug: d.name,
        title: meta.title || h1 || d.name,
        summary: meta.summary || '',
        tags: meta.tags || [],
        status: meta.status || 'draft',
        generated: meta.generated || '',
        updated: meta.updated || '',
        plain: fs.existsSync(note) ? toPlain(read(note)).slice(0, 4000) : '',
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

main();
