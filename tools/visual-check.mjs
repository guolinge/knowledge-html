#!/usr/bin/env node
/* ============================================================
   visual-check.mjs — 用无头浏览器量图有没有画坏
   ------------------------------------------------------------
   node tools/visual-check.mjs [slug...]

   为什么需要它：
   改样式时踩过两次坑，两次 `npm run check` 都是绿的：
     ① 用「区间替换」改 CSS，把 .flowd-svg 的 position:absolute 删了
        → SVG 变成在流元素占 414px，节点被推下去，图完全错位
     ② 区域框画在容器外 28px，溢出到上面的段落里
   构建通过 ≠ 画对了。所以要有东西真的去量。

   检查两件事：
     1. 积木容器内有没有元素溢出边界（含绝对定位的区域框）
     2. 整页有没有横向滚动条
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* ---------- 要检查哪些积木容器 ---------- */
const CONTAINERS = [
  '.pipe',        // lane-stack
  '.journey',     // journey
  '.compare-wrap',// compare
  '.cards',       // cards
  '.timeline',    // timeline
  '[data-flow]',  // flow
  '[data-seq]',   // seq
  '.mx',          // matrix
  '.tree',        // tree
  '.archfig',     // arch（内联 archify 的图）
  '.spec',        // spec
  '.streamshape', // streamshape（raw 写的）
  '.keyby-viz',   // keyby-viz（raw 写的）
  '.flarch',      // flarch（raw 写的）
  '.demo',        // demo
];

/* ---------- 注入浏览器的探针 ---------- */
/* 探针是独立文件，见 tools/probe/visual-check.js。
   以前是这里的模板字符串 —— 踩了四次「反引号提前闭合 / \n 变真换行」，
   报错还都长成「探针没回数据」，查不出来。 */
const PROBE = fs
  .readFileSync(path.join(ROOT, 'tools', 'probe', 'visual-check.js'), 'utf8')
  /* 兜底：探针正文里万一出现能闭合 script 标签的字面串（哪怕在注释里），
     注入后会把外层 script 提前闭合、探针不完整 —— 症状又是「探针没回数据」。
     转义掉，这类问题就不再可能发生。 */
  .replace(/<\/(script)/gi, '<\\/$1');

/* ---------- 主流程 ---------- */
const argv = process.argv.slice(2);
const files = (
  argv.length
    ? argv.map((s) => path.join(ROOT, 'dist', `${s}.html`))
    : fs
        .readdirSync(path.join(ROOT, 'dist'))
        .filter((f) => f.endsWith('.html'))
        .map((f) => path.join(ROOT, 'dist', f))
).filter((f) => fs.existsSync(f));

if (!files.length) {
  console.error('dist/ 下没有可检查的文件。先跑 npm run build:standalone。');
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}\n  用 CHROME_PATH 环境变量指定。`);
  process.exit(2);
}

/* 注入前先自检 PROBE 的语法。

   踩过：PROBE 里写错一个符号，注入后浏览器**整个脚本不执行** ——
   症状是「探针没回数据」，看不出是哪错。而探针是模板字符串，
   在外面用 node 检查它也检查不到（${...} 没被插值）。
   所以这里插值完立刻 new Function 一次，报出真正的语法错。 */
try {
  new Function(PROBE);
} catch (e) {
  console.error(`\n  ✗ visual-check 的探针自身语法错：${e.message}`);
  console.error('    这是工具的问题，不是笔记的。修 tools/visual-check.mjs 里的 PROBE。\n');
  process.exit(2);
}

let total = 0;
let known = 0;
const tmp = path.join(ROOT, 'node_modules', '.vc-tmp.html');

/* ---------- 已知问题基线 ----------

   有些问题**不是笔记写错了，是积木画不了**。典型的：
   flow 没有边路由，所以「阶梯式判定 + 一个公共出口」这种拓扑，
   所有「是」边都得跨好几行、必然穿过阶梯上的节点。试过 5 种排法都无解。

   这类问题如果直接判失败，pre-push 会把整个仓库锁死 ——
   而谁也没法「修」它，除非重画那张图（那是作者的决定，不是机械修复）。

   所以：基线里列出的**照旧报出来**（⚠），但不阻塞。
   新出现的问题照旧 ✗ 阻塞。

   基线里的条目不匹配了，会提示删掉 —— 基线只该缩小，不该腐烂。
*/
const BASELINE_FILE = path.join(ROOT, 'tools', 'visual-baseline.json');
const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  : { known: [] };
const baselineHits = new Set();

/** 一条诊断算不算「已知」—— slug 相同，且命中任一 match 子串 */
function isKnown(slug, text) {
  const hit = baseline.known.find(
    (k) => k.slug === slug && k.match.some((mm) => text.includes(mm)),
  );
  if (hit) baselineHits.add(JSON.stringify(hit));
  return !!hit;
}

/* 跑一次浏览器，拿回诊断。
   返回 { ok:true, problems } 或 { ok:false, why }。

   为什么单独抽出来：**这台机器上它会假阳性。**
   并行会话也在跑无头浏览器时，load average 会到 20~47 —— 那时布局
   还没稳定，量出来的矩形和上一次不一样，同一份代码会给出不同的
   失败集合。实测：同一篇笔记连跑三次，分别挂 2 处 / 1 处 / 0 处。

   所以下面按「重试 + 比对」判定，不拿单次结果当结论。 */
function probeOnce(html) {
  fs.writeFileSync(tmp, html);
  let dom = '';
  try {
    dom = execFileSync(
      CHROME,
      ['--headless', '--disable-gpu', '--dump-dom', '--virtual-time-budget=6000',
       '--window-size=1280,900', `file://${tmp}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 },
    );
  } catch {
    return { ok: false, why: '浏览器没跑起来' };
  }
  const m = dom.match(/<pre id="vc-result">([\s\S]*?)<\/pre>/);
  /* 探针没回数据 = 它自己抛了异常。**不能算通过** ——
     踩过：探针里引用了一个已删除的变量，抛 ReferenceError，
     结果所有图都「检查通过」，而实际上一个都没检查。 */
  if (!m) return { ok: false, why: '探针没回数据（多半是探针自己抛了异常，或没跑完）' };
  try {
    return {
      ok: true,
      problems: JSON.parse(
        m[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>'),
      ),
    };
  } catch {
    return { ok: false, why: `探针返回的不是合法 JSON：${m[1].slice(0, 100)}` };
  }
}

const ATTEMPTS = 3;

for (const file of files) {
  const slug = path.basename(file, '.html');
  const html = fs
    .readFileSync(file, 'utf8')
    .replace(
      '</body>',
      `<script>window.__VC_CONTAINERS = ${JSON.stringify(CONTAINERS)};</script>\n` +
        `<script>${PROBE}</script></body>`,
    );

  /* 重试到「干净」为止。三次都没干净就比对：
       · 诊断完全一样 → 是真的，阻塞
       · 诊断不一样   → 是环境不稳（探测量到的是不同状态），不阻塞但报出来
     不能只看一次 —— 单次结果在这台机器上没有判别力。 */
  const runs = [];
  let clean = false;
  for (let i = 0; i < ATTEMPTS; i++) {
    const r = probeOnce(html);
    runs.push(r);
    /* 只有「真的干净」才提前收工。
       ==写 `!r.ok || …` 会直接 break —— 那等于一次失败就不重试了。== */
    if (r.ok && r.problems.length === 0) { clean = true; break; }
  }

  if (clean) {
    /* 中途挂过 = 这篇笔记的检查不稳定。不阻塞，但要让人知道 ——
       否则「某次跑过了」会掩盖一个真的偶发问题。 */
    const flaky = runs.some((r) => !r.ok || r.problems.length);
    if (flaky) console.error(`  ⚠ ${slug}  第 ${runs.length} 次才通过 —— 检查不稳定，见上（不阻塞）`);
    else console.log(`  ✓ ${slug}`);
    continue;
  }

  const last = runs[runs.length - 1];
  if (!last.ok) {
    console.error(`  ✗ ${slug}  ${last.why}（连试 ${ATTEMPTS} 次）`);
    total++;
    continue;
  }

  const same = runs.every((r) => r.ok && JSON.stringify(r.problems) === JSON.stringify(last.problems));
  if (!same) {
    console.error(
      `  ⚠ ${slug}  ${ATTEMPTS} 次的诊断不一致（${runs.map((r) => (r.ok ? r.problems.length : '?')).join('/')} 处）` +
        `\n      → 多半是机器负载高、探针量到的是不同时刻的布局。**不阻塞**。` +
        `\n      → 负载降下来重跑；还挂同样的位置才是真问题。`,
    );
    continue;
  }

  const problems = last.problems;
  const fresh = problems.filter((p) => !isKnown(slug, p));
  const old = problems.length - fresh.length;
  known += old;

  if (fresh.length) {
    console.error(`  ✗ ${slug}  ${fresh.length} 处`);
    fresh.slice(0, 12).forEach((p) => console.error(`      ${p}`));
    if (fresh.length > 12) console.error(`      …还有 ${fresh.length - 12} 处`);
    total += fresh.length;
  }
  if (old) {
    // 已知问题照旧写出来 —— 只是不阻塞。看不到就等于没有。
    console.error(`  ⚠ ${slug}  ${old} 处已知问题（在 tools/visual-baseline.json 里）`);
  }
}

if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

/* 基线里的条目不再命中 = 问题已经被修了。提示删掉，让基线只能变小。 */
const stale = baseline.known.filter((k) => !baselineHits.has(JSON.stringify(k)));
if (stale.length) {
  console.error(`\n  基线里有 ${stale.length} 条已经不成立了：`);
  for (const k of stale) console.error(`      ${k.slug} — ${k.why || k.match[0]}`);
  console.error('  这些问题已经不存在（好事）—— 把对应条目从 tools/visual-baseline.json 里删掉。');
  total += stale.length;
}

if (total) {
  console.error(
    `\n  ${total} 处新问题。构建通过不等于画对了 —— 去修。` +
      (known ? `\n  （另有 ${known} 处已知问题，不阻塞，见 tools/visual-baseline.json）` : ''),
  );
  process.exit(1);
}
console.log(
  '\n  没有新问题。' + (known ? `（${known} 处已知问题未阻塞，见 tools/visual-baseline.json）` : '所有图的布局都正常。'),
);
