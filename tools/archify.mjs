#!/usr/bin/env node
/* ============================================================
   archify.mjs — 用 archify skill 生成复杂图，抠成我们能内联的片段
   ------------------------------------------------------------
   node tools/archify.mjs <spec.json> <名字>
     spec.json   archify 的架构图 JSON（放 archify/ 目录）
     名字        输出 assets/arch/<名字>.svg

   为什么需要这一步：
   archify 的 HTML 有 600KB（viewer 运行时），但 SVG 本体只有 ~20KB。
   抠出来内联，既拿到它的排版质量，又不把页面撑大。

   关键坑：archify 在 :root 定义了 32 个 CSS 变量，名字和我们完全一样
   （--bg / --text / --panel …）。直接嵌会把我们整页变成深色。
   所以这里给它的变量统一加 --af- 前缀。
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIFY = process.env.ARCHIFY_DIR || path.join(os.homedir(), '.agents/skills/archify');

const [specArg, name, typeArg] = process.argv.slice(2);
if (!specArg || !name) {
  console.error('用法：node tools/archify.mjs <spec.json> <名字> [diagram_type]');
  console.error('  diagram_type 默认从 spec 的 diagram_type 字段读，读不到才当 architecture。');
  console.error('  可选：architecture / workflow / sequence / dataflow / lifecycle');
  process.exit(1);
}

if (!fs.existsSync(path.join(ARCHIFY, 'bin/archify.mjs'))) {
  console.error(`找不到 archify skill：${ARCHIFY}\n  用 ARCHIFY_DIR 环境变量指定。`);
  process.exit(1);
}

const spec = path.resolve(specArg);

/* spec 本来就是自描述的（里面写着 diagram_type）。
   以前这里写死成 architecture，等于把 archify 的 5 种图类型只暴露了 1 种 ——
   workflow / sequence / dataflow / lifecycle 全用不了。现在从 spec 读。 */
const TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
let TYPE = typeArg;
if (!TYPE) {
  try {
    TYPE = JSON.parse(fs.readFileSync(spec, 'utf8')).diagram_type;
  } catch { /* 读不到就走下面的兜底 */ }
}
TYPE = TYPE || 'architecture';
if (!TYPES.includes(TYPE)) {
  console.error(`  ✗ 未知的 diagram_type：${TYPE}\n    可选：${TYPES.join(' / ')}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
const outHtml = path.join(tmp, 'out.html');

console.log(`  1/4  archify validate…（${TYPE}）`);
try {
  execFileSync(
    process.execPath,
    [path.join(ARCHIFY, 'bin/archify.mjs'), 'validate', TYPE, spec, '--quality', 'showcase', '--json'],
    { stdio: 'pipe' },
  );
} catch (e) {
  const raw = String(e.stdout || e.stderr || '');
  const i = raw.indexOf('{');
  let msg = raw;
  try { msg = JSON.parse(raw.slice(i)).error || raw; } catch { /* 原样输出 */ }
  console.error(`  ✗ 校验没过：\n${msg}`);
  process.exit(1);
}

console.log('  2/4  archify deliver…');
execFileSync(
  process.execPath,
  [path.join(ARCHIFY, 'bin/archify.mjs'), 'deliver', TYPE, spec, outHtml, '--quality', 'showcase', '--json'],
  { stdio: 'pipe' },
);

const html = fs.readFileSync(outHtml, 'utf8');
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const svg = (html.match(/<svg[\s\S]*?<\/svg>/g) || []).sort((a, b) => b.length - a.length)[0];
if (!svg) { console.error('  ✗ 没抠到 SVG'); process.exit(1); }

console.log('  3/4  抠 SVG + 相关 CSS，加 --af- 命名空间…');

// 顶层规则切分（处理 @media 嵌套）
function splitRules(css) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of css) {
    buf += ch;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { out.push(buf.trim()); buf = ''; } }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const ns = (t) => t.replace(/(?<![\w-])--([a-z][a-z0-9-]*)/g, '--af-$1');

const archDir = path.join(ROOT, 'assets/arch');
fs.mkdirSync(archDir, { recursive: true });
fs.writeFileSync(path.join(archDir, `${name}.svg`), ns(svg));

/* archify-embed.css 是「全站共用」的，所以不能只按刚生成的这一张图筛 class ——
   那样跑第二张图时，会把第一张图需要的 class 从共用 CSS 里删掉，
   第一张图的节点就掉样式了（踩过：跑 core-package 删掉了 flink-cluster 要的 .c-messagebus）。
   所以扫 assets/arch/ 下所有 SVG，取 class 的并集 —— 幂等，不会因为跑的顺序而变。 */
const classes = new Set();
for (const f of fs.readdirSync(archDir)) {
  if (!f.endsWith('.svg')) continue;
  const text = fs.readFileSync(path.join(archDir, f), 'utf8');
  for (const m of text.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && classes.add(c));
  }
}

const kept = splitRules(style).filter((rule) => {
  const sel = rule.split('{', 1)[0];
  // ① SVG 用到的 class ② 主题变量块（两边都用 data-theme，所以能同步）
  const hasCls = [...classes].some((c) => new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(sel));
  const isTheme = sel.includes('[data-theme') || sel.trim().startsWith(':root');
  return hasCls || isTheme;
});

fs.writeFileSync(path.join(ROOT, 'assets/archify-embed.css'), ns(kept.join('\n')));

console.log('  4/4  写入');
console.log(`     assets/arch/${name}.svg          ${(svg.length / 1024).toFixed(1)} KB  （${TYPE}）`);
console.log(`     assets/archify-embed.css         ${(kept.join('').length / 1024).toFixed(1)} KB（全站共用）`);
