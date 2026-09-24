/* ============================================================
   lib/home.mjs — 首页知识地图（自动生成）
   ============================================================ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STATUS_TONE = { verified: 'green', reviewed: 'blue', draft: 'amber' };

export function renderHome(entries, { site, assetPrefix = '' }) {
  const allTags = [...new Set(entries.flatMap((e) => e.tags || []))].sort();

  const cards = entries
    .map(
      (e) => `<a class="ncard" href="notes/${esc(e.slug)}/" data-slug="${esc(e.slug)}"
        data-tags="${esc((e.tags || []).join(','))}">
      <div class="ncard-top">
        <span class="tag tone-${STATUS_TONE[e.status] || 'muted'}">${esc(e.status || 'draft')}</span>
        <span class="ncard-date">${esc(e.updated || e.generated || '')}</span>
      </div>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.summary || '')}</p>
      <div class="ncard-tags">${(e.tags || [])
        .map((t) => `<span class="tag tone-muted">${esc(t)}</span>`)
        .join('')}</div>
    </a>`,
    )
    .join('\n');

  const chips = allTags
    .map(
      (t) =>
        `<button class="chip" data-tag="${esc(t)}">${esc(t)}<span class="n">${
          entries.filter((e) => (e.tags || []).includes(t)).length
        }</span></button>`,
    )
    .join('');

  // 检索语料：标题 + 摘要 + 标签 + 正文纯文本
  const index = entries.map((e) => ({
    slug: e.slug,
    text: [e.title, e.summary, (e.tags || []).join(' '), e.plain || ''].join(' ').toLowerCase(),
  }));

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(site)}</title>
<link rel="stylesheet" href="${assetPrefix}assets/theme.css" />
<link rel="stylesheet" href="${assetPrefix}assets/blocks.css" />
<style>
.home-shell { max-width: var(--shell); margin: 0 auto; padding: 48px var(--gutter) 100px; }
.home-hero h1 { font-size: clamp(30px, 5vw, 44px); margin-bottom: 12px; }
.home-count { font-size: 14px; color: var(--muted); margin-bottom: 28px; }
.searchbar { display: flex; gap: 10px; margin-bottom: 14px; }
.searchbar input {
  flex: 1; min-width: 0; font: 15px/1 var(--sans); color: var(--text);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 11px; padding: 13px 16px; outline: none;
}
.searchbar input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 30px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font: 550 12.5px/1 var(--sans); color: var(--text-2);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 100px; padding: 7px 12px; cursor: pointer; transition: .15s;
}
.chip:hover { border-color: var(--border-strong); color: var(--text); }
.chip.on { background: var(--blue-soft); border-color: var(--blue); color: var(--blue); }
.chip .n { font-family: var(--mono); font-size: 10.5px; opacity: .6; }
.ngrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; }
.ncard {
  display: block; text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow);
  transition: transform .18s, border-color .18s;
}
.ncard:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.ncard-top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ncard-date { margin-left: auto; font: 400 11.5px/1 var(--mono); color: var(--muted); }
.ncard h3 { margin: 0 0 8px; font-size: 17px; letter-spacing: -.015em; line-height: 1.4; }
.ncard p { margin: 0 0 14px; font-size: 13.5px; color: var(--muted); line-height: 1.65; }
.ncard-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.empty { color: var(--muted); font-size: 14.5px; padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<div class="home-shell">
  <div class="home-hero">
    <span class="eyebrow">● 知识地图</span>
    <h1>${esc(site)}</h1>
    <p class="home-count">共 <b id="count">${entries.length}</b> 篇 · 每篇都是可离线打开的单文件页面</p>
  </div>

  <div class="searchbar">
    <input id="q" type="search" placeholder="搜索标题、标签或正文…" autocomplete="off" />
    <button class="icon-btn" id="themeBtn" title="切换主题">◐</button>
  </div>
  <div class="chips" id="chips">${chips}</div>
  <div class="ngrid" id="grid">${cards}</div>
  <div class="empty" id="empty" hidden>没有匹配的笔记</div>
</div>

<script id="search-index" type="application/json">${JSON.stringify(index).replace(
    /</g,
    '\\u003c',
  )}</script>
<script>
(function () {
  var IDX = JSON.parse(document.getElementById('search-index').textContent);
  var byslug = {};
  IDX.forEach(function (r) { byslug[r.slug] = r.text; });

  var q = document.getElementById('q');
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var count = document.getElementById('count');
  var cards = [].slice.call(grid.querySelectorAll('.ncard'));
  var activeTags = new Set();

  function apply() {
    var term = q.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var slug = c.getAttribute('data-slug');
      var tags = (c.getAttribute('data-tags') || '').split(',').filter(Boolean);
      var okTag = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
      var okTerm = !term || (byslug[slug] || '').indexOf(term) !== -1;
      var show = okTag && okTerm;
      c.hidden = !show;
      if (show) shown++;
    });
    count.textContent = shown;
    empty.hidden = shown !== 0;
  }

  q.addEventListener('input', apply);

  document.getElementById('chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    var t = b.getAttribute('data-tag');
    if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
    b.classList.toggle('on', activeTags.has(t));
    apply();
  });

  document.getElementById('themeBtn').addEventListener('click', function () {
    var root = document.documentElement;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('kh-theme', next); } catch (e) {}
  });

  // 复用页面级的主题偏好
  try {
    var saved = localStorage.getItem('kh-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}
})();
</script>
</body>
</html>
`;
}
