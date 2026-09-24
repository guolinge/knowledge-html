#!/usr/bin/env node
/* ============================================================
   new.mjs — 新建一篇笔记
   npm run new -- <slug>
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];

if (!slug) {
  console.error('用法：npm run new -- <slug>');
  console.error('例：  npm run new -- mysql-index-internals');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('slug 只能用小写字母、数字和连字符，且以字母数字开头。');
  process.exit(1);
}

const dir = path.join(ROOT, 'notes', slug);
if (fs.existsSync(dir)) {
  console.error(`notes/${slug} 已存在。`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'meta.json'),
  JSON.stringify(
    {
      title: '在这里写标题',
      summary: '一句话说清这篇笔记解决什么问题。',
      eyebrow: '知识笔记',
      tags: ['待分类'],
      status: 'draft',
      generated: today,
      updated: today,
      model: '',
      sources: [],
      verified: null,
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(path.join(dir, 'note.md'), fs.readFileSync(path.join(ROOT, 'tools/templates/note.md'), 'utf8'));

console.log(`
  ✓ notes/${slug}/
      meta.json   改标题、标签、status
      note.md     写正文（积木语法见 tools/templates/note.md）

  下一步：
      npm run build
      npm run serve
`);
