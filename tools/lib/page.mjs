/* ============================================================
   lib/page.mjs — 页面外壳（顶栏 / 目录 / 溯源头 / 页脚）
   ============================================================ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 溯源头：来源 / 生成时间 / 模型 / 状态 —— 对抗「漂亮但不可信」 */
function provenance(meta) {
  const bits = [];
  if (meta.sources && meta.sources.length) {
    bits.push(
      `<span><b>来源</b> ${meta.sources
        .map((s) =>
          /^https?:/.test(s)
            ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(
                s.replace(/^https?:\/\//, '').slice(0, 48),
              )}</a>`
            : esc(s),
        )
        .join(' · ')}</span>`,
    );
  }
  if (meta.generated) bits.push(`<span><b>生成</b> ${esc(meta.generated)}</span>`);
  if (meta.model) bits.push(`<span><b>模型</b> ${esc(meta.model)}</span>`);
  if (meta.verified) bits.push(`<span><b>核对</b> ${esc(meta.verified)}</span>`);
  // 没有任何溯源信息时不要输出空 div —— 它会渲染成一条莫名的灰色空条
  return bits.length ? `<div class="provenance">${bits.join('')}</div>` : '';
}

function draftBanner(meta) {
  if (meta.status !== 'draft') return '';
  return `<div class="draft-banner">
    <span>⚠</span>
    <span>本页状态为 <b>draft</b>：内容尚未人工核对，引用前请自行验证。</span>
  </div>`;
}

function tocHtml(toc, backHref) {
  if (!toc.length) return '';
  const links = toc
    .map(
      (t) =>
        `<a href="#${esc(t.id)}"${t.level === 3 ? ' class="sub"' : ''}>${esc(t.text)}</a>`,
    )
    .join('\n      ');
  return `<p class="toc-title">目录</p>
      <a href="${esc(backHref)}" class="sub">← 全部笔记</a>
      ${links}`;
}

/**
 * @param {object} o
 * @param {object} o.meta         meta.json
 * @param {string} o.body         正文 HTML
 * @param {Array}  o.toc          目录项
 * @param {string} o.assetPrefix  资源前缀（子目录页面用 '../../'）
 * @param {string} o.backHref     返回索引的链接
 * @param {string} [o.assets]     内联资源 { theme, blocks, app }，用于 --standalone
 */
export function renderPage({ meta, body, toc, assetPrefix, backHref, assets }) {
  const head = assets
    ? `<style>\n${assets.theme}\n</style>\n<style>\n${assets.blocks}\n</style>`
    : `<link rel="stylesheet" href="${assetPrefix}assets/theme.css" />
  <link rel="stylesheet" href="${assetPrefix}assets/blocks.css" />
  <link rel="stylesheet" href="${assetPrefix}assets/archify-embed.css" />`;
  const foot = assets
    ? `<script>\n${assets.app}\n</script>`
    : `<script src="${assetPrefix}assets/app.js"></script>`;

  const eyebrow = meta.eyebrow || '知识笔记';
  const tags = (meta.tags || []).length
    ? `<div class="provenance"><span><b>标签</b> ${meta.tags
        .map((t) => `<span class="tag tone-muted">${esc(t)}</span>`)
        .join(' ')}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light"${toc.length ? ' data-has-toc="1"' : ''}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.summary || '')}" />
${head}
</head>
<body>
<div id="progress"></div>
<div id="tocScrim"></div>

<header class="topbar">
  <div class="topbar-inner">
    <button class="icon-btn" id="tocBtn" title="目录" aria-label="展开目录" aria-controls="toc">☰</button>
    <a class="brand" href="${esc(backHref)}"><span class="dot"></span>${esc(meta.site || '知识笔记')}</a>
    <span class="spacer"></span>
    <button class="icon-btn" id="themeBtn" title="切换主题" aria-label="切换主题">◐</button>
  </div>
</header>

<div class="shell">
  <aside class="toc" id="toc">
      ${tocHtml(toc, backHref)}
  </aside>

  <main>
    <div class="hero">
      <span class="eyebrow">● ${esc(eyebrow)}</span>
      <h1>${esc(meta.title)}</h1>
      ${meta.summary ? `<p class="lede">${esc(meta.summary)}</p>` : ''}
    </div>

    ${draftBanner(meta)}
    ${provenance(meta)}
    ${tags}

${body}

    <footer>
      <span>${esc(meta.title)}</span>
      <span>最后更新 ${esc(meta.updated || meta.generated || '—')} · 单文件可离线打开</span>
    </footer>
  </main>
</div>

${foot}
</body>
</html>
`;
}
