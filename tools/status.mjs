#!/usr/bin/env node
/* ============================================================
   status.mjs — 提交前的仓库状态分类
   ------------------------------------------------------------
   这个仓库会被多个 agent 会话同时编辑。麻烦在于：

     · 构建产物（首页 index.html / dist / 各篇的 index.html）是**全量**的
       —— 它们包含所有人的内容，所以「只提交自己的」就自洽不了
     · 而别人的源可能正在被改，不该被替提交

   所以提交前必须先看清「哪些是自己的、哪些是别人的、哪些是垃圾」。
   这个脚本把 git status 分成几类，让判断变简单。

   node tools/status.mjs
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).toString();

/* ── 分类规则 ───────────────────────────────────────────── */

const RULES = [
  // 顺序有意义：先匹配到的赢
  {
    key: 'temp',
    label: '临时文件（不该提交）',
    hint: '加进 .gitignore 或删掉',
    test: (p) =>
      /(^|\/)_[^/]*\.html$/.test(p) || // _p.html 这类预览副本
      /\.(png|jpg|jpeg|gif|webp|bak|tmp|orig|rej)$/i.test(p) ||
      /(^|\/)(node_modules|\.preview|\.cache)\//.test(p),
  },
  {
    key: 'artifact',
    label: '共享产物（构建生成，自动同步）',
    hint: '每次提交都要带上全部 —— 它们是全量的',
    test: (p) =>
      p === 'index.html' ||
      p.startsWith('dist/') ||
      /^notes\/[^/]+\/index\.html$/.test(p),
  },
  {
    key: 'shared',
    label: '共享源（改这里要小心别的会话）',
    hint: '小步精确编辑，改完尽快提交',
    test: (p) =>
      p.startsWith('assets/') ||
      p.startsWith('tools/') ||
      p === 'package.json' ||
      p.startsWith('.agents/') ||
      p.startsWith('.githooks/') ||
      p === '.gitignore',
  },
  {
    key: 'note',
    label: '笔记源',
    hint: '自己的就直接提交；别人的看是否完整',
    test: (p) => /^notes\/[^/]+\/(note\.md|meta\.json)$/.test(p),
  },
  {
    key: 'arch',
    label: 'archify 源',
    hint: '生成物 assets/arch/*.svg 要一起提交',
    test: (p) => p.startsWith('archify/') || p.startsWith('assets/arch/'),
  },
];

const classify = (p) => RULES.find((r) => r.test(p)) ?? { key: 'other', label: '其它', hint: '' };

/* ── 收集 ───────────────────────────────────────────────── */

const raw = git('status', '--porcelain=v1', '-z');
const entries = [];

// -z 用 \0 分隔，重命名会有两个路径（R 后面跟旧路径和新路径）
const parts = raw.split('\0').filter(Boolean);
for (let i = 0; i < parts.length; i++) {
  const line = parts[i];
  const code = line.slice(0, 2).trim() || '?';
  const file = line.slice(3);
  if (code === 'R' || code === 'C') {
    const to = parts[++i];
    entries.push({ code, file: to, from: file });
  } else {
    entries.push({ code, file });
  }
}

const groups = new Map();
for (const e of entries) {
  const r = classify(e.file);
  if (!groups.has(r.key)) groups.set(r.key, { ...r, items: [] });
  groups.get(r.key).items.push(e);
}

/* ── 报告 ───────────────────────────────────────────────── */

const CODE_LABEL = { M: '改', A: '新', '?': '新', D: '删', R: '移', C: '拷', U: '冲', '!!': '冲' };
const cwd = process.cwd();
const ago = (f) => {
  try {
    const m = fs.statSync(path.join(ROOT, f)).mtimeMs;
    const mins = Math.round((Date.now() - m) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    return `${Math.round(mins / 60)} 小时前`;
  } catch {
    return '';
  }
};

console.log('');
if (!entries.length) {
  console.log('  ✓ 工作区干净，没有未提交的改动。\n');
  process.exit(0);
}

const order = ['temp', 'artifact', 'shared', 'note', 'arch', 'other'];
for (const key of order) {
  const g = groups.get(key);
  if (!g) continue;
  console.log(`  ${g.label}${g.hint ? `  —— ${g.hint}` : ''}`);
  for (const e of g.items) {
    const tag = CODE_LABEL[e.code] ?? e.code;
    const dir = path.dirname(e.file);
    console.log(
      `    ${tag}  ${e.file}${e.from ? `  (原 ${e.from})` : ''}` +
        `\n        ${dir === '.' ? '' : dir + '/  '}${ago(e.file)}`,
    );
  }
  console.log('');
}

/* ── 提示 ───────────────────────────────────────────────── */

const temps = groups.get('temp')?.items ?? [];
if (temps.length) {
  console.log('  ⚠ 有临时文件。先处理掉，别让它们进提交：');
  console.log(`      ${temps.map((t) => t.file).join('  ')}`);
  console.log('      → 加进 .gitignore，或者删掉\n');
}

const notes = groups.get('note')?.items ?? [];
const slugs = [...new Set(notes.map((n) => n.file.split('/')[1]))];
if (slugs.length) {
  console.log(`  涉及 ${slugs.length} 篇笔记：${slugs.join('  ')}`);
  console.log('  → 如果某篇不是你在改的，它是别的会话的改动');
  console.log('    · 内容完整 → 一起提交，提交信息里注明来源');
  console.log('    · 明显是半成品 → 停下来问用户，别替别人改\n');
}

console.log('  提交前：npm run check && npm run build:standalone && npm run visual-check');
console.log('  推送前：pre-push 钩子会重建 + 量图；产物和源不一致会直接拦下\n');
