#!/usr/bin/env node
/* ============================================================
   view.mjs — 构建并在浏览器里打开
   ------------------------------------------------------------
   node tools/view.mjs               # 全部重建，打开首页
   node tools/view.mjs <slug>        # 只重建一篇，打开它的单文件版
   node tools/view.mjs <slug> --no-open   # 只构建，不开浏览器

   这个命令**默认就打开** —— 它的用途就是「给我看」。
   agent 验证「构建完不完整」时加 --no-open，别留标签页给人收拾。
   （block.mjs / skill-view.mjs 相反：它们默认不开。）
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NO_OPEN = process.argv.includes('--no-open');
const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;

const args = ['tools/render.mjs', '--standalone'];
if (slug) args.push('--only', slug);

try {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error('\n构建失败，没有打开浏览器。先修掉上面的错误。');
  process.exit(1);
}

// 单文件版最省事：自包含、无需服务器，双击就能开，也能直接发人
const target = slug
  ? path.join(ROOT, 'dist', `${slug}.html`)
  : path.join(ROOT, 'index.html');

if (!fs.existsSync(target)) {
  console.error(`找不到 ${path.relative(ROOT, target)}`);
  process.exit(1);
}

if (NO_OPEN) {
  console.log(`\n  ✓ 构建好了：${path.relative(ROOT, target)}\n`);
} else {
  execFileSync('open', [target]);
  console.log(`\n  → 已在浏览器打开 ${path.relative(ROOT, target)}\n`);
}
