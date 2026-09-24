/* ============================================================
   lib/blocks.mjs — markdown-it 插件：把自定义围栏块渲染成积木
   ------------------------------------------------------------
   note.md 里这样写：

     ```lane-stack
     - title: 源系统层
       nodes: [...]
     ```

   围栏内的 body 是 YAML。未注册的语言名会退化成普通代码块。
   ============================================================ */

import YAML from 'yaml';

/* ---------- 小工具 ---------- */

/** 把 "抽取 :: Extract :: 把数据从业务库拿出来" 拆成三段 */
function splitConn(spec) {
  const [main = '', en = '', note = ''] = String(spec).split('::').map((s) => s.trim());
  return { main, en, note };
}

/** 生成锚点 id；保留中文，去掉标点 */
function slugify(text) {
  const s = String(text)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'sec';
}

export { slugify };

/* ---------- 插件 ---------- */

export function blocksPlugin(md) {
  const esc = (s) => md.utils.escapeHtml(String(s ?? ''));
  const inline = (s) => md.renderInline(String(s ?? '').trim());

  /* ===== 积木 1 · lane-stack ===== */
  function conn(spec) {
    if (!spec) return '';
    const { main, en, note } = splitConn(spec);
    return `<div class="conn">
      <span class="stem"></span>
      <span class="pill">${inline(main)}${en ? ` <span class="en">${esc(en)}</span>` : ''}${
        note ? `<span class="note">${inline(note)}</span>` : ''
      }</span>
      <span class="stem"></span><span class="head"></span>
    </div>`;
  }

  function lane(l) {
    const tone = l.tone || 'muted';
    const nodes = (l.nodes || [])
      .map(
        (n) => `<div class="pnode${n.tone ? ` tone-${n.tone}` : ''}">
        <b>${inline(n.title)}</b>
        ${n.sub ? `<small>${esc(n.sub)}</small>` : ''}
        ${n.tag ? `<span class="tag tone-${n.tone || tone}">${esc(n.tag)}</span>` : ''}
      </div>`,
      )
      .join('');
    return `<div class="lane tone-${tone}">
        <div class="lane-meta">
          ${l.badge ? `<span class="ln">${esc(l.badge)}</span>` : ''}
          <b>${inline(l.title)}</b>
          ${l.desc ? `<small>${inline(l.desc)}</small>` : ''}
        </div>
        <div class="lane-body">${nodes}</div>
      </div>${conn(l.next)}`;
  }

  function laneStack(body) {
    const layers = YAML.parse(body) || [];
    const out = [];
    let i = 0;
    while (i < layers.length) {
      const group = layers[i].group;
      if (group) {
        const chunk = [];
        while (i < layers.length && layers[i].group === group) chunk.push(layers[i++]);
        out.push(
          `<div class="wgroup"><div class="wgroup-label">${inline(group)}</div>${
            chunk.map(lane).join('')
          }</div>`,
        );
      } else {
        out.push(lane(layers[i++]));
      }
    }
    return `<div class="pipe">${out.join('')}</div>`;
  }

  /* ===== 积木 2 · journey ===== */
  function journey(body) {
    const items = YAML.parse(body) || [];
    return items
      .map((it) => {
        const tone = it.tone || 'muted';
        const fields = (it.fields || [])
          .map(
            (f) => `<div class="${f.tone || ''}">
            <b>${esc(f.k)}</b><span>${esc(f.v)}</span>${
              f.note ? `<em>${esc(f.note)}</em>` : ''
            }</div>`,
          )
          .join('');
        const code = it.codeHtml
          ? `<div class="code-wrap" style="margin:0">${it.codeHtml}</div>`
          : it.code
            ? `<div class="code-wrap" style="margin:0"><button class="copy" data-copy>复制</button><pre>${esc(
                it.code,
              )}</pre></div>`
            : '';
        return `<div class="jcard">
          <div class="jcard-head">
            ${it.tag ? `<span class="tag tone-${tone}">${esc(it.tag)}</span>` : ''}
            ${it.name ? `<span class="name">${esc(it.name)}</span>` : ''}
            <span class="spacer"></span>
            ${it.badge ? `<span class="tag tone-${it.badgeTone || tone}">${esc(it.badge)}</span>` : ''}
          </div>
          ${fields ? `<div class="rec">${fields}</div>` : ''}
          ${code}
          ${it.note ? `<p class="jnote${it.noteTone === 'bad' ? ' bad' : ''}">${inline(it.note)}</p>` : ''}
        </div>${conn(it.next)}`;
      })
      .join('');
  }

  /* ===== 积木 3 · compare ===== */
  function cell(c, label) {
    const inner =
      c && typeof c === 'object'
        ? c.tone
          ? `<span class="tag tone-${c.tone}">${esc(c.text)}</span>`
          : inline(c.text)
        : inline(c);
    return `<td data-label="${esc(label || '')}">${inner}</td>`;
  }

  function compare(body) {
    const cfg = YAML.parse(body) || {};
    const head = cfg.head || [];
    const rows = cfg.rows || [];
    const thead = `<thead><tr><th>${esc(cfg.first || '')}</th>${head
      .map((h) => `<th>${inline(h)}</th>`)
      .join('')}</tr></thead>`;
    const tbody = `<tbody>${rows
      .map((r) => {
        const [k, vals] = Object.entries(r)[0] || ['', []];
        return `<tr><th>${inline(k)}</th>${(vals || [])
          .map((v, i) => cell(v, head[i]))
          .join('')}</tr>`;
      })
      .join('')}</tbody>`;
    return `<div class="compare-wrap"><table class="compare">${thead}${tbody}</table></div>`;
  }

  /* ===== 积木 4 · callout ===== */
  function callout(body) {
    const cfg = YAML.parse(body) || {};
    const tone = cfg.tone || 'blue';
    const cls = ['callout', `tone-${tone}`];
    if (cfg.tinted) cls.push('tinted');
    if (cfg.quote) cls.push('quote');
    return `<div class="${cls.join(' ')}">
      ${cfg.icon ? `<span class="ic">${esc(cfg.icon)}</span>` : ''}
      <div>${md.render(String(cfg.text || ''))}</div>
    </div>`;
  }

  /* ===== 积木 5 · checklist ===== */
  function checklist(body) {
    const cfg = YAML.parse(body) || {};
    const items = cfg.items || (Array.isArray(cfg) ? cfg : []);
    const cls = cfg.tone ? ` ${cfg.tone}` : '';
    return `<ul class="check${cls}">${items
      .map((it) => `<li>${inline(typeof it === 'string' ? it : it.text)}</li>`)
      .join('')}</ul>`;
  }

  /* ===== 积木 6 · quiz ===== */
  function quiz(body) {
    const items = YAML.parse(body) || [];
    return `<div class="quiz">${items
      .map(
        (it) => `<details>
        <summary>${inline(it.q)}</summary>
        <div class="a">${md.render(String(it.a || ''))}</div>
      </details>`,
      )
      .join('')}</div>`;
  }

  /* ===== 积木 7 · demo ===== */
  function demo(body) {
    const cfg = YAML.parse(body) || {};
    const panes = (cfg.panes || [])
      .map(
        (p) => `<div class="pane">
        <div class="pane-head">
          ${p.tag ? `<span class="tag tone-${p.tone || 'muted'}">${esc(p.tag)}</span>` : ''}
          ${inline(p.head || '')}
          ${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ''}
        </div>
        <div class="log" data-log="${esc(p.log)}"></div>
        ${
          p.foot && p.foot.length
            ? `<div class="pane-foot">${p.foot
                .map((f) => `<span class="tag tone-${p.tone || 'muted'}">${esc(f)}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>`,
      )
      .join('');
    return `<div class="demo" data-widget="${esc(cfg.widget)}">
      <div class="demo-head">
        <span class="title">${esc(cfg.title || '')}</span>
        <span class="status" data-status>未开始</span>
        <span class="spacer"></span>
        <button class="btn" data-run>▶ 开始模拟</button>
        <button class="btn ghost" data-reset>重置</button>
      </div>
      <div class="demo-body">${panes}</div>
    </div>`;
  }

  /* ===== 积木 8 · summary ===== */
  function summary(body) {
    const cfg = YAML.parse(body) || {};
    return `<div class="summary">
      ${cfg.title ? `<h3>${inline(cfg.title)}</h3>` : ''}
      ${md.render(String(cfg.text || ''))}
    </div>`;
  }

  /* ---------- 注册 ---------- */
  const RENDERERS = {
    'lane-stack': laneStack,
    journey,
    compare,
    callout,
    checklist,
    quiz,
    demo,
    summary,
    raw: (body) => body,
  };

  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0];
    const render = RENDERERS[lang];
    if (render) return render(token.content);

    // 普通代码块：包一层以便放复制按钮
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    return `<div class="code-wrap"><button class="copy" data-copy>复制</button><pre><code${cls}>${esc(
      token.content,
    )}</code></pre></div>\n`;
  };
}

/* ---------- 正文后处理：给 h2/h3 加锚点并收集目录 ---------- */

export function addAnchors(html) {
  const toc = [];
  const seen = new Map();

  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => {
    // 「01 · 标题」→ 编号徽章
    let content = inner;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const m2 = text.match(/^(\d+[a-z]?)\s*[·:：]\s*(.+)$/);
    if (m2 && lvl === '2') {
      // 从原始 HTML 里剥掉开头的编号，保留其余行内标记
      content = `<span class="num">${m2[1]}</span>${inner.replace(
        /^\s*\d+[a-z]?\s*[·:：]\s*/,
        '',
      )}`;
    }

    const base = slugify(m2 ? m2[2] : text);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = n > 1 ? `${base}-${n}` : base;

    toc.push({ level: Number(lvl), id, text: m2 ? m2[2] : text });
    return `<h${lvl} id="${id}">${content}</h${lvl}>`;
  });

  return { html: out, toc };
}
