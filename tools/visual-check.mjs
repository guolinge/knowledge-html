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
const PROBE = `
setTimeout(function () {
  var CONTAINERS = ${JSON.stringify(CONTAINERS)};
  var problems = [];
  var TOL = 2;   // 2px 容差，避免亚像素误差误报

  CONTAINERS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (box, i) {
      var br = box.getBoundingClientRect();
      if (!br.width || !br.height) return;
      var where = sel + '[' + i + ']';

      // ① 容器自己有没有被内容撑破（scrollWidth/Height 比可视区大）
      if (box.scrollWidth > box.clientWidth + TOL) {
        problems.push(where + ' 内容横向溢出 ' + (box.scrollWidth - box.clientWidth) + 'px');
      }

      // ② 子元素有没有跑出容器边界（绝对定位的区域框就是这类）
      box.querySelectorAll('*').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        var over = [];
        if (r.left   < br.left   - TOL) over.push('左 ' + Math.round(br.left - r.left) + 'px');
        if (r.right  > br.right  + TOL) over.push('右 ' + Math.round(r.right - br.right) + 'px');
        if (r.top    < br.top    - TOL) over.push('上 ' + Math.round(br.top - r.top) + 'px');
        if (r.bottom > br.bottom + TOL) over.push('下 ' + Math.round(r.bottom - br.bottom) + 'px');
        if (over.length) {
          var id = el.getAttribute('data-id') || el.getAttribute('data-group-box')
                || el.className.toString().split(' ')[0] || el.tagName.toLowerCase();
          problems.push(where + ' → <' + id + '> 溢出容器：' + over.join('、'));
        }
      });
    });
  });

  // ③ 区域框之间有没有重叠 / 有没有盖住非成员节点
  document.querySelectorAll('[data-flow]').forEach(function (root, i) {
    var boxes = Array.from(root.querySelectorAll('[data-group-box]')).filter(function (b) { return !b.hidden; });
    if (boxes.length < 2) return;
    var where = '[data-flow][' + i + ']';
    for (var a = 0; a < boxes.length; a++) {
      for (var b = a + 1; b < boxes.length; b++) {
        var ra = boxes[a].getBoundingClientRect();
        var rb2 = boxes[b].getBoundingClientRect();
        var ox = Math.min(ra.right, rb2.right) - Math.max(ra.left, rb2.left);
        var oy = Math.min(ra.bottom, rb2.bottom) - Math.max(ra.top, rb2.top);
        if (ox > TOL && oy > TOL) {
          problems.push(where + ' 区域框重叠：' +
            boxes[a].getAttribute('data-group-box') + ' ↔ ' + boxes[b].getAttribute('data-group-box') +
            '（重叠 ' + Math.round(Math.min(ox, oy)) + 'px）');
        }
      }
    }
  });

  // ④ 整页横向滚动
  var de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) {
    problems.push('整页横向滚动 ' + (de.scrollWidth - window.innerWidth) + 'px');
  }

  var pre = document.createElement('pre');
  pre.id = 'vc-result';
  pre.textContent = JSON.stringify(problems);
  document.body.appendChild(pre);
}, 900);
`;

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

let total = 0;
const tmp = path.join(ROOT, 'node_modules', '.vc-tmp.html');

for (const file of files) {
  const slug = path.basename(file, '.html');
  const html = fs.readFileSync(file, 'utf8').replace('</body>', `<script>${PROBE}</script></body>`);
  fs.writeFileSync(tmp, html);

  let dom = '';
  try {
    dom = execFileSync(
      CHROME,
      ['--headless', '--disable-gpu', '--dump-dom', '--virtual-time-budget=2500',
       '--window-size=1280,900', `file://${tmp}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 },
    );
  } catch {
    console.error(`  ? ${slug}  浏览器没跑起来`);
    continue;
  }

  const m = dom.match(/<pre id="vc-result">([\s\S]*?)<\/pre>/);
  if (!m) { console.error(`  ? ${slug}  探针没回数据`); continue; }

  /* 探针把诊断塞在 <pre> 的 textContent 里，读回来得先反转义。
     这一步必须包住：解析失败时要报出「哪一篇、内容长什么样」，
     不能让 pre-push 钩子丢一个没有上下文的 SyntaxError 出来。 */
  let problems;
  try {
    problems = JSON.parse(
      m[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'),
    );
  } catch {
    console.error(`  ? ${slug}  探针返回的内容不是合法 JSON：${m[1].slice(0, 120)}`);
    continue;
  }

  if (problems.length) {
    console.error(`  ✗ ${slug}  ${problems.length} 处`);
    problems.slice(0, 12).forEach((p) => console.error(`      ${p}`));
    if (problems.length > 12) console.error(`      …还有 ${problems.length - 12} 处`);
    total += problems.length;
  } else {
    console.log(`  ✓ ${slug}`);
  }
}

if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

if (total) {
  console.error(`\n  ${total} 处布局问题。构建通过不等于画对了 —— 去修。`);
  process.exit(1);
}
console.log('\n  所有图的布局都正常。');
