/* ============================================================
   lib/home.mjs — 首页知识地图（自动生成）
   ------------------------------------------------------------
   两种视图并存：
     · 挂了 plans/<topic>.yaml 的笔记 → 按「嵌套产物树」展示
       （读者一眼知道：我在哪、下一步看什么、哪些还没写）
     · 没挂树的笔记 → 平铺卡片，不影响它们照常存在
   ============================================================ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STATUS_TONE = { verified: 'green', reviewed: 'blue', draft: 'amber' };

/** 1 → ①，11 → ⑪（超过 20 就退回普通数字） */
const circled = (n) =>
  n >= 1 && n <= 20 ? String.fromCodePoint(0x245f + n) : String(n);

/** 把一条笔记渲染成一张卡片（未归类区用） */
function card(e) {
  return `<a class="ncard" href="notes/${esc(e.slug)}/" data-slug="${esc(e.slug)}"
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
  </a>`;
}

/** 把一棵 plan 渲染成树 */
function tree(plan, entryBySlug) {
  const total = plan.nodes.length;
  const done = plan.nodes.filter((n) => n.artifact && entryBySlug.has(n.artifact)).length;

  const rows = plan.nodes
    .map((n) => {
      const e = n.artifact ? entryBySlug.get(n.artifact) : null;
      const state = e ? 'done' : 'planned';
      const tags = e ? (e.tags || []).join(',') : '';
      const searchText = [n.title, n.blurb, e?.title, e?.summary].filter(Boolean).join(' ');
      const inner = `
      <span class="tnode-num">${circled(n.num)}</span>
      <span class="tnode-title">${esc(n.title)}</span>
      <span class="tnode-layer">${esc(n.layer || '')}</span>
      <span class="tnode-blurb">${esc(n.blurb || '')}</span>
      <span class="tnode-state">${e ? '已产出' : '待产出'}</span>`;

      // 已产出的做成链接；待产出的只展示（不做死链接）
      return e
        ? `<a class="tnode is-done" data-depth="${n.depth}" data-slug="${esc(n.artifact)}"
             data-tags="${esc(tags)}" data-text="${esc(searchText.toLowerCase())}"
             href="notes/${esc(n.artifact)}/">${inner}</a>`
        : `<div class="tnode is-planned" data-depth="${n.depth}"
             data-text="${esc(searchText.toLowerCase())}">${inner}</div>`;
    })
    .join('\n');

  return `<section class="plan" data-plan="${esc(plan.topic)}">
    <div class="plan-head">
      <h2>${esc(plan.title)}</h2>
      <span class="plan-progress${done === total ? ' is-full' : ''}">${done} / ${total} 篇</span>
      ${plan.summary ? `<p class="plan-summary">${esc(plan.summary)}</p>` : ''}
      ${plan.source ? `<p class="plan-source">源码：${esc(plan.source)}</p>` : ''}
    </div>
    <div class="plan-body">${rows}</div>
  </section>`;
}

export function renderHome(entries, { site, assetPrefix = '', plans = [] }) {
  const entryBySlug = new Map(entries.map((e) => [e.slug, e]));

  // 挂了树的 slug 集合 —— 剩下的进「未归类」
  const inTree = new Set();
  for (const plan of plans) {
    for (const n of plan.nodes) {
      if (n.artifact && entryBySlug.has(n.artifact)) inTree.add(n.artifact);
    }
  }
  const orphans = entries.filter((e) => !inTree.has(e.slug));

  const trees = plans.map((p) => tree(p, entryBySlug)).join('\n');
  const cards = orphans.map(card).join('\n');

  const allTags = [...new Set(entries.flatMap((e) => e.tags || []))].sort();
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

/* ── 产物树 ─────────────────────────────────────────── */
.plan { margin-bottom: 46px; }
.plan-head { margin-bottom: 18px; }
.plan-head h2 { font-size: 22px; letter-spacing: -.02em; margin: 0 0 6px; }
.plan-progress {
  display: inline-block; font: 550 12px/1 var(--mono); color: var(--text-2);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 100px; padding: 5px 10px; margin-bottom: 10px;
}
.plan-progress.is-full { color: var(--green); border-color: var(--green); }
.plan-summary { margin: 0 0 4px; font-size: 14px; color: var(--text-2); line-height: 1.65; }
.plan-source { margin: 0; font: 400 12px/1.5 var(--mono); color: var(--muted); }
.plan-body { display: flex; flex-direction: column; gap: 2px; }

.tnode {
  display: grid; grid-template-columns: 30px auto 62px 1fr auto;
  align-items: baseline; gap: 12px; text-decoration: none; color: inherit;
  border-radius: 9px; padding: 11px 14px 11px 0;
  border-left: 2px solid var(--border);
  transition: background .15s, border-color .15s;
}
.tnode[data-depth="1"] { padding-left: 16px; }
.tnode[data-depth="2"] { margin-left: 30px; }
.tnode[data-depth="3"] { margin-left: 60px; }
.tnode.is-done { cursor: pointer; }
.tnode.is-done:hover { background: var(--surface); border-left-color: var(--blue); }
.tnode.is-done:hover .tnode-title { color: var(--blue); }
.tnode.is-planned { opacity: .5; border-left-style: dashed; }
.tnode-num { font-family: var(--mono); font-size: 12px; color: var(--muted); text-align: right; }
.tnode-title { font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
.tnode.is-done .tnode-title { color: var(--text); }
.tnode-layer {
  font: 500 11px/1 var(--sans); color: var(--muted);
  background: var(--surface-2, var(--surface)); border: 1px solid var(--border);
  border-radius: 100px; padding: 4px 8px; text-align: center;
}
.tnode-blurb { font-size: 13px; color: var(--muted); line-height: 1.5; }
.tnode-state { font: 500 11.5px/1 var(--sans); color: var(--muted); white-space: nowrap; }
.tnode.is-done .tnode-state { color: var(--green); }

/* ── 未归类 ─────────────────────────────────────────── */
.orphan-head { margin: 0 0 16px; }
.orphan-head h2 { font-size: 22px; letter-spacing: -.02em; margin: 0 0 6px; }
.orphan-head p { margin: 0; font-size: 14px; color: var(--text-2); }
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

@media (max-width: 720px) {
  .tnode { grid-template-columns: 24px 1fr auto; gap: 8px; padding-left: 10px; }
  .tnode-layer, .tnode-blurb { display: none; }
  .tnode[data-depth="2"] { margin-left: 16px; }
  .tnode[data-depth="3"] { margin-left: 32px; }
}
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

  <div id="trees">${trees}</div>
  ${
    orphans.length
      ? `<div class="orphan-head">
    <h2>未归类</h2>
    <p>还没挂到任何一棵产物树上的笔记。</p>
  </div>
  <div class="ngrid" id="grid">${cards}</div>`
      : ''
  }
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
  var empty = document.getElementById('empty');
  var count = document.getElementById('count');
  var trees = [].slice.call(document.querySelectorAll('.plan'));
  var cards = [].slice.call(document.querySelectorAll('.ncard'));
  var activeTags = new Set();

  function apply() {
    var term = q.value.trim().toLowerCase();
    var shown = 0;

    // 树节点：搜索匹配自身文字，标签匹配它对应笔记的标签
    trees.forEach(function (plan) {
      var any = false;
      [].slice.call(plan.querySelectorAll('.tnode')).forEach(function (n) {
        var tags = (n.getAttribute('data-tags') || '').split(',').filter(Boolean);
        var okTag = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
        var own = (n.getAttribute('data-text') || '');
        var slug = n.getAttribute('data-slug');
        var full = slug ? (byslug[slug] || '') : own;
        var okTerm = !term || full.indexOf(term) !== -1 || own.indexOf(term) !== -1;
        var show = okTag && okTerm;
        n.hidden = !show;
        if (show) { any = true; if (n.classList.contains('is-done')) shown++; }
      });
      plan.hidden = !any;
    });

    cards.forEach(function (c) {
      var slug = c.getAttribute('data-slug');
      var tags = (c.getAttribute('data-tags') || '').split(',').filter(Boolean);
      var okTag = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
      var okTerm = !term || (byslug[slug] || '').indexOf(term) !== -1;
      var show = okTag && okTerm;
      c.hidden = !show;
      if (show) shown++;
    });

    var head = document.querySelector('.orphan-head');
    if (head) head.hidden = !cards.some(function (c) { return !c.hidden; });
    if (document.getElementById('grid'))
      document.getElementById('grid').hidden = !cards.some(function (c) { return !c.hidden; });

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
