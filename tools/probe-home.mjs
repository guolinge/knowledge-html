#!/usr/bin/env node
/* ============================================================
   probe-home.mjs —— 首页外壳的冒烟探针
   ------------------------------------------------------------
   为什么要有它：

   `npm run check` / `visual-check` **都盖不到首页**。首页是
   `tools/lib/home.mjs` 拼出来的一个模板字符串，里面有两大块东西
   它们看不见：

     ① 内联的浏览器 JS —— `node --check` 看不到模板串里的代码，
        拼错了照样退出码 0，表现是「按钮点下去没反应」。
     ② 浏览器里的运行时状态 —— 抽屉开没开、遮罩盖没盖上、
        排序有没有真的重排、`el.hidden` 有没有被作者样式盖掉。

   这两个坑 SKILL.md「改了「站点外壳」要多做一步」里写了，
   但那条一直是**手写探针**：这次改一个抽屉，我手写了 7 个
   `_probe*.html`。所以收进这里，一条命令跑完。

     npm run probe:home
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* 探针文件**必须写在仓库根目录**：放 /tmp 跑的话，index.html 里
   相对路径引的 assets/*.css 全断了，你会测出「样式没生效」的假象。 */
const PROBE_FILE = path.join(ROOT, '_probe_home.html');

const PROBE = `
<pre class="PROBE" style="position:fixed;left:0;bottom:0;z-index:999;background:#000;color:#0f0;font:11px monospace;margin:0"></pre>
<script>
(function () {
  var fails = [], notes = [];
  function ok(name, cond, extra) { (cond ? notes : fails).push(name + (extra ? '(' + extra + ')' : '')); }
  var jsErrors = [];
  window.onerror = function (m, s, l, c) { jsErrors.push(m + ' @' + l + ':' + c); };
  window.addEventListener('unhandledrejection', function (e) { jsErrors.push('reject ' + e.reason); });

  function firstDates(n) {
    return [].slice.call(document.querySelectorAll('#dlist li')).slice(0, n)
      .map(function (x) { return x.getAttribute('data-date'); });
  }

  setTimeout(function () {
    var d = document.getElementById('drawer');
    var v = document.getElementById('drawerVeil');
    var b = document.getElementById('listBtn');

    ok('列表按钮存在', !!b);
    ok('初始是关闭的', !!d && !!v && d.hidden && v.hidden);

    if (b && d && v) {
      b.focus();
      b.click();
      var box = d.getBoundingClientRect();
      ok('点开后抽屉可见', d.hidden === false && getComputedStyle(d).display !== 'none');
      ok('遮罩可见', v.hidden === false && getComputedStyle(v).display !== 'none');
      ok('遮罩真的有色（alpha>0）', /\\/\\s*0?\\.\\d+\\s*\\)|rgba\\(/.test(getComputedStyle(v).backgroundColor),
        getComputedStyle(v).backgroundColor);
      ok('滚动作息生效', document.body.classList.contains('drawer-on'));
      ok('aria-expanded=true', b.getAttribute('aria-expanded') === 'true');
      ok('抽屉右缘贴边', Math.abs(box.right - window.innerWidth) <= 1, 'right=' + Math.round(box.right) + ' vw=' + window.innerWidth);
      ok('无横向溢出', [].slice.call(document.querySelectorAll('.drow'))
        .every(function (r) { return r.scrollWidth <= r.clientWidth + 1; }));
      ok('焦点落在第一行', (document.activeElement.getAttribute('href') || '').indexOf('notes/') === 0,
        document.activeElement.getAttribute('href') || document.activeElement.tagName);

      var sorted = document.querySelector('#drawerSort button[data-v="old"]');
      var before = firstDates(3).join(',');
      if (sorted) {
        sorted.click();
        var after = firstDates(3).join(',');
        ok('切「最早在前」真的重排了', before !== after, before + ' -> ' + after);
        var back = document.querySelector('#drawerSort button[data-v="new"]');
        if (back) { back.click(); ok('切回「最新在前」', before === firstDates(3).join(',')); }
      } else { ok('排序控件存在', false); }

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      ok('Esc 能关', d.hidden === true);
      ok('Esc 后滚动作息解除', !document.body.classList.contains('drawer-on'));
      ok('Esc 后焦点还给触发按钮', document.activeElement === b);

      b.click(); v.click();
      ok('点遮罩能关', d.hidden === true);
    }

    ok('内联 JS 没有运行时报错', jsErrors.length === 0, jsErrors.join(' ;; '));

    document.querySelector('.PROBE').textContent =
      'PROBE_START passes=' + notes.length + ' fails=' + fails.length +
      (fails.length ? ' || FAIL: ' + fails.join(' ; ') : '') +
      ' || ' + notes.join(' ; ') + ' PROBE_END';
  }, 700);
})();
</script>
`;

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('  ✗ 没有 index.html —— 先 npm run build');
  process.exit(1);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
fs.writeFileSync(PROBE_FILE, html.replace('</body>', PROBE + '</body>'));

let dom = '';
try {
  dom = execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--virtual-time-budget=4000',
      '--dump-dom',
      `file://${PROBE_FILE}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} finally {
  fs.rmSync(PROBE_FILE, { force: true });
}

const m = /PROBE_START([\s\S]*?)PROBE_END/.exec(dom);
if (!m) {
  console.error('  ✗ 探针没回数据 —— 页面脚本可能抛在建探针之前');
  process.exit(1);
}

const body = m[1];
const passes = Number(/passes=(\d+)/.exec(body)?.[1] ?? 0);
const fails = Number(/fails=(\d+)/.exec(body)?.[1] ?? 1);

if (fails === 0) {
  console.log(`  ✓ 首页外壳 ${passes} 项通过`);
  process.exit(0);
}

console.error(`  ✗ 首页外壳：${passes} 项过，${fails} 项没过`);
for (const line of (/FAIL: ([^|]+)/.exec(body)?.[1] ?? '').split(' ; ').filter(Boolean)) {
  console.error(`      ${line.trim()}`);
}
process.exit(1);
