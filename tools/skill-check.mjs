#!/usr/bin/env node
/**
 * skill-check —— 校验 skill 文档和代码是否一致。
 *
 * 防的是「文档里的数字/清单过时了」这类错误。真实发生过三次：
 *   · SKILL.md 写「已有 13 个积木」，实际 16 个
 *   · SKILL.md 写「16 个积木」，实际 17 个（漏数了 arch）
 *   · blocks.md 编号重复（两个 `## 9.`），且完全没文档化 arch 积木
 *
 * 这些都是「只追加、没回头对齐」留下的债。让脚本去数，别靠人记。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(ROOT, '.agents/skills/knowledge-html');
const read = (p) => fs.readFileSync(p, 'utf8');

const problems = [];
const note = (msg) => problems.push(msg);

/* ─────────── 真相源：代码 ─────────── */

// 积木：tools/lib/blocks.mjs 的 RENDERERS
const blocksSrc = read(path.join(ROOT, 'tools/lib/blocks.mjs'));
const renderersBody = blocksSrc.match(/const RENDERERS = \{([\s\S]*?)\n {2}\};/)?.[1];
if (!renderersBody) {
  console.error('✗ 解析不出 tools/lib/blocks.mjs 的 RENDERERS');
  process.exit(1);
}
const blocks = [...renderersBody.matchAll(/^ {4}(?:'([\w-]+)'|([\w-]+)) *[,:]/gm)].map(
  (m) => m[1] || m[2],
);

// 控件：assets/app.js 的 WIDGETS
const appSrc = read(path.join(ROOT, 'assets/app.js'));
const widgets = [
  ...appSrc.matchAll(/WIDGETS(?:\[['"]([\w-]+)['"]\]|\.([\w-]+)) *=/g),
]
  .map((m) => m[1] || m[2])
  .filter((n) => /^[a-z][a-z0-9-]*$/.test(n)); // 排掉注释里的占位名

/* ─────────── 待检：skill 文档 ─────────── */

const skillSrc = read(path.join(SKILL_DIR, 'SKILL.md'));
const blocksDoc = read(path.join(SKILL_DIR, 'references/blocks.md'));

// 1. SKILL.md 的积木清单表：| `name` | 说明 |
const skillBlocksTable = skillSrc.match(/### 积木清单（(\d+) 个）([\s\S]*?)\n###/);
if (!skillBlocksTable) {
  note('SKILL.md 里找不到「积木清单（N 个）」小节');
} else {
  const claimed = Number(skillBlocksTable[1]);
  const listed = [...skillBlocksTable[2].matchAll(/^\| `([\w-]+)`/gm)].map((m) => m[1]);

  if (claimed !== blocks.length) {
    note(`SKILL.md 说「${claimed} 个积木」，代码里实际 ${blocks.length} 个`);
  }
  const missing = blocks.filter((b) => !listed.includes(b));
  const extra = listed.filter((b) => !blocks.includes(b));
  if (missing.length) note(`SKILL.md 积木清单少了：${missing.join(' ')}`);
  if (extra.length) note(`SKILL.md 积木清单多了（代码里没有）：${extra.join(' ')}`);
}

// 2. SKILL.md 的控件清单：一行反引号包着的名字
const widgetLine = skillSrc.match(/交互控件 (\d+) 个[^\n]*\n([\s\S]*?)\n\n/);
if (!widgetLine) {
  note('SKILL.md 里找不到「交互控件 N 个」那一行');
} else {
  const claimed = Number(widgetLine[1]);
  const listed = [...widgetLine[2].matchAll(/`([\w-]+)`/g)].map((m) => m[1]);
  if (claimed !== widgets.length) {
    note(`SKILL.md 说「${claimed} 个控件」，代码里实际 ${widgets.length} 个`);
  }
  const missing = widgets.filter((w) => !listed.includes(w));
  const extra = listed.filter((w) => !widgets.includes(w));
  if (missing.length) note(`SKILL.md 控件清单少了：${missing.join(' ')}`);
  if (extra.length) note(`SKILL.md 控件清单多了（代码里没有）：${extra.join(' ')}`);
}

// 3. blocks.md 是否每个积木都有文档（标题里出现名字即算，summary/raw 共用一个标题）
const docHeadings = [...blocksDoc.matchAll(/^## \d+\. (.+)$/gm)].map((m) => m[1]);
const undocumented = blocks.filter((b) => !docHeadings.some((h) => h.includes(`\`${b}\``)));
if (undocumented.length) note(`blocks.md 没文档化：${undocumented.join(' ')}`);

// 4. blocks.md 编号是否连续、有无重复
const nums = [...blocksDoc.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
if (dupes.length) note(`blocks.md 编号重复：${[...new Set(dupes)].join(' ')}`);
const gaps = nums.filter((n, i) => i > 0 && n !== nums[i - 1] + 1);
if (gaps.length) note(`blocks.md 编号不连续：跳到了 ${gaps.join(' ')}`);

// 5. SKILL.md 引用的路径是否真实存在
const refs = [...skillSrc.matchAll(/`(notes\/[\w./-]+|assets\/[\w./-]+|tools\/[\w./-]+)`/g)].map(
  (m) => m[1],
);
for (const r of new Set(refs)) {
  if (!fs.existsSync(path.join(ROOT, r))) note(`SKILL.md 引用了不存在的路径：${r}`);
}

// 6. 交叉引用：其它文件里「SKILL.md 的「xxx」」必须真能在 SKILL.md 里找到
//    （真实发生过：原则改名后 extend.md 还在引旧名字）
for (const f of ['references/blocks.md', 'references/extend.md']) {
  const src = read(path.join(SKILL_DIR, f));
  for (const m of src.matchAll(/SKILL\.md 的「([^」]+)」/g)) {
    const target = m[1].replace(/\*\*/g, '').trim();
    if (!skillSrc.includes(target)) {
      note(`${f} 引用了 SKILL.md 里不存在的章节：「${target}」`);
    }
  }
}

// 6b. SKILL.md 里提到的 npm run <script> 必须真的存在
const pkgScripts = Object.keys(JSON.parse(read(path.join(ROOT, 'package.json'))).scripts);
for (const f of ['SKILL.md', 'references/blocks.md', 'references/extend.md']) {
  const src = f === 'SKILL.md' ? skillSrc : read(path.join(SKILL_DIR, f));
  for (const m of src.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
    if (!pkgScripts.includes(m[1])) note(`${f} 引用了不存在的脚本：npm run ${m[1]}`);
  }
}

// 7. SKILL.md 的「第 N 步」编号必须从 0 开始且连续
const steps = [...skillSrc.matchAll(/^### 第 (\d+) 步/gm)].map((m) => Number(m[1]));
if (steps.length) {
  const expected = steps.map((_, i) => i);
  if (steps.join() !== expected.join()) {
    note(`SKILL.md 的工作流步骤编号不连续：${steps.join(' ')}（应为 0~${steps.length - 1}）`);
  }
}

// 8. 标题结构：空章节（下个标题同级或更浅）+ 层级跳级
const heads = [...skillSrc.matchAll(/^(#{2,4}) (.+)$/gm)].map((m) => ({
  level: m[1].length,
  text: m[2],
  end: m.index + m[0].length,
}));
for (let i = 0; i < heads.length; i++) {
  const cur = heads[i];
  const next = heads[i + 1];
  const body = skillSrc.slice(cur.end, next ? next.end : skillSrc.length);
  const hasOwnContent = body.replace(/^#{2,4} .*$/gm, '').trim().length > 0;

  // 空章节：下一标题同级或更浅，且中间没有属于自己的内容
  if (next && next.level <= cur.level && !hasOwnContent) {
    note(`SKILL.md 空章节：「${cur.text}」`);
  }
  // 跳级：### → ##### 这类（只允许逐级）
  if (next && next.level > cur.level + 1) {
    note(`SKILL.md 标题跳级：「${cur.text}」→「${next.text}」`);
  }
}

// 9. archify 的 SVG 用到的 class，必须在全站共用的 archify-embed.css 里有定义
//    真实事故：CSS 丢了 .a-dashed / .a-security（少 fill:none），
//    图里的边被填成黑色三角形，而构建、visual-check 全绿。
const ARCH = path.join(ROOT, 'assets/arch');
const ARCH_CSS = path.join(ROOT, 'assets/archify-embed.css');
if (fs.existsSync(ARCH) && fs.existsSync(ARCH_CSS)) {
  const css = read(ARCH_CSS);
  const defined = new Set(
    [...css.matchAll(/\.([a-z][\w-]*)\s*(?=[,{: ])/g)].map((m) => m[1]),
  );
  const used = new Map(); // class → 哪些 svg 用了
  for (const f of fs.readdirSync(ARCH).filter((x) => x.endsWith('.svg'))) {
    const svg = read(path.join(ARCH, f));
    for (const m of svg.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (!c || c.startsWith('semantic-sigil')) continue;
        if (!used.has(c)) used.set(c, []);
        if (!used.get(c).includes(f)) used.get(c).push(f);
      }
    }
  }
  const missing = [...used.entries()].filter(([c]) => !defined.has(c));
  if (missing.length) {
    const detail = missing.map(([c, fs_]) => `${c}（${fs_.join(', ')}）`).join(' · ');
    note(
      `assets/archify-embed.css 缺 ${missing.length} 个 class 定义：${detail}\n` +
        `      → 图的样式会掉（踩过：.a-dashed 少了 fill:none，边被填成黑三角，构建却是绿的）\n` +
        `      → 修法：重跑任意一张图 node tools/archify.mjs archify/<名字>.json <名字>`,
    );
  }
}

/* ─────────── 报告 ─────────── */

if (problems.length === 0) {
  console.log(`  ✓ skill 与代码一致（${blocks.length} 积木 · ${widgets.length} 控件）`);
  process.exit(0);
}
console.log(`  ✗ skill 与代码不一致（${problems.length} 处）：\n`);
for (const p of problems) console.log(`      ${p}`);
console.log('');
process.exit(1);
