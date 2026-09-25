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

  // 行内语义标记：==关键结论== / !!坑!! / ++推荐++
  inlineMarksPlugin(md);
  // 中文加粗修复：**「术语」** 这类写法不被 CommonMark 的 flanking 规则误杀
  cjkStrongPlugin(md);

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

  /* ===== 积木 7 · demo =====
  /* 两种形态：
     - panes: 双栏日志式（默认），配合 app.js 里的日志型控件
     - html:  自定义内容，控件自己渲染内部结构 */
  function demo(body) {
    const cfg = YAML.parse(body) || {};
    const actions = cfg.actions !== false;
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
    // 三种形态：
    //   panes  —— 双栏日志式（默认）
    //   html   —— 作者手写标记，控件只负责接线
    //   config —— 数据驱动，控件自己渲染整个 body（推荐给通用控件）
    const bodyHtml = cfg.html
      ? `<div class="demo-body custom">${cfg.html}</div>`
      : cfg.config
        ? '<div class="demo-body custom" data-mount></div>'
        : `<div class="demo-body">${panes}</div>`;
    return `<div class="demo" data-widget="${esc(cfg.widget)}"${
      cfg.config ? ` data-config="${esc(JSON.stringify(cfg.config))}"` : ''
    }>
      <div class="demo-head">
        <span class="title">${esc(cfg.title || '')}</span>
        <span class="status" data-status>${esc(cfg.hint || (actions ? '未开始' : ''))}</span>
        <span class="spacer"></span>
        ${
          actions
            ? '<button class="btn" data-run>▶ 开始模拟</button>' +
              '<button class="btn ghost" data-reset>重置</button>'
            : ''
        }
      </div>
      ${bodyHtml}
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

  /* ===== 积木 9 · cards ===== */
  function cards(body) {
    const cfg = YAML.parse(body) || {};
    const items = cfg.items || (Array.isArray(cfg) ? cfg : []);
    const inner = items
      .map((it) => {
        const tone = it.tone || 'muted';
        return `<div class="ccard tone-${tone}">
          ${it.tag ? `<span class="tag tone-${tone}">${esc(it.tag)}</span>` : ''}
          <h4>${inline(it.title)}</h4>
          ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
          ${it.code ? `<pre>${esc(it.code)}</pre>` : ''}
        </div>`;
      })
      .join('');
    return `<div class="cards"${cfg.cols ? ` data-cols="${esc(cfg.cols)}"` : ''}>${inner}</div>`;
  }

  /* ===== 积木 10 · timeline ===== */
  function timeline(body) {
    const items = YAML.parse(body) || [];
    return `<div class="timeline">${items
      .map((it) => {
        const tone = it.tone || 'blue';
        return `<div class="titem tone-${tone}">
          ${it.when ? `<span class="when">${esc(it.when)}</span>` : ''}
          <h4>${inline(it.title)}</h4>
          ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
        </div>`;
      })
      .join('')}</div>`;
  }

  /* ===== 积木 11 · spec =====
     拆解卡：把一个东西按固定维度拆开。
     常用维度：输入 / 处理 / 输出 / 怎么调用 / 为什么这么设计 / 业务价值。
     维度不固定，但**同一个页面里的几张卡要用同一套维度**。 */
  function spec(body) {
    const cfg = YAML.parse(body) || {};
    const tone = cfg.tone || 'muted';
    const rows = (cfg.rows || [])
      .map((r) => {
        const val = r.code
          ? `<div class="code-wrap" style="margin:0"><button class="copy" data-copy>复制</button><pre>${esc(
              r.code,
            )}</pre></div>`
          : md.render(String(r.v || ''));
        return `<div class="srow">
          <div class="sk">${inline(r.k)}</div>
          <div class="sv">${val}</div>
        </div>`;
      })
      .join('');
    return `<div class="spec tone-${tone}">
      ${
        cfg.title
          ? `<div class="spec-head"><b>${inline(cfg.title)}</b>${
              cfg.subtitle ? `<span>${inline(cfg.subtitle)}</span>` : ''
            }</div>`
          : ''
      }
      <div class="spec-body">${rows}</div>
    </div>`;
  }

/* ---------- 语义节点类型 ----------
   kind 同时决定图标和配色，让图有「结构感」而不只是文字盒子。
   （学自 archify 的 component types：frontend/backend/database/cloud/security/messagebus/external） */
const KIND_ICONS = {
  frontend:   '<rect x="2.5" y="3" width="11" height="8.5" rx="1.5"/><path d="M2.5 6h11"/>',
  backend:    '<path d="M6 3.5L3 8l3 4.5M10 3.5L13 8l-3 4.5"/>',
  database:   '<ellipse cx="8" cy="4.2" rx="5" ry="1.9"/><path d="M3 4.2v7.6c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9V4.2"/>',
  cloud:      '<path d="M4.8 12.2a2.6 2.6 0 0 1 .2-5.18 3.6 3.6 0 0 1 6.9-.8 2.5 2.5 0 0 1-.4 5.98z"/>',
  security:   '<path d="M8 2.2l4.8 1.9v4c0 2.9-2.1 4.8-4.8 5.7-2.7-.9-4.8-2.8-4.8-5.7v-4z"/>',
  messagebus: '<path d="M3 5h10M3 8h10M3 11h6"/>',
  external:   '<rect x="2.5" y="2.5" width="7.5" height="7.5" rx="1"/><path d="M8.5 9.5l4.5 4.5M13 9.8V13H9.8"/>',
};
const KIND_TONE = {
  frontend: 'muted', backend: 'green', database: 'violet',
  cloud: 'amber', security: 'red', messagebus: 'amber', external: 'muted',
};

  /* ===== 积木 12 · flow =====
     带分支/汇合的流程图。lane-stack 只能画直线，这个能画图。
     节点按 row 分行，列位置自动均分；连线由 app.js 测量后画成 SVG 路径。 */
  function flow(body) {
    const cfg = YAML.parse(body) || {};
    const nodes = cfg.nodes || [];
    const edges = cfg.edges || [];

    // 按 row 分行，row 不写就按数组顺序
    const rows = [];
    nodes.forEach((n, i) => {
      const r = n.row ?? i;
      (rows[r] = rows[r] || []).push(n);
    });

    // 哪些节点有自环 —— 它要往上画弧，得给那一行留出空间
    const selfLoopIds = new Set(
      edges.filter((e) => e.self || e.from === e.to).map((e) => e.from),
    );

    // kind 决定图标和配色；显式 tone 优先
    const toneOf = (n) => n.tone || KIND_TONE[n.kind] || 'muted';
    const iconOf = (n) =>
      KIND_ICONS[n.kind]
        ? `<svg class="ficon" viewBox="0 0 16 16" fill="none" stroke="currentColor"` +
          ` stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">` +
          `${KIND_ICONS[n.kind]}</svg>`
        : '';

    const grid = rows
      .map(
        (row) => `<div class="flowd-row${
          (row || []).some((n) => selfLoopIds.has(n.id)) ? ' has-selfloop' : ''
        }">${(row || [])
          .map(
            (n) => `<div class="fnode tone-${toneOf(n)}${
              n.shape ? ` shape-${n.shape}` : ''
            }${n.initial ? ' is-initial' : ''}" data-id="${esc(n.id)}"${
              n.group ? ` data-group="${esc(n.group)}"` : ''
            }>
              ${n.initial ? '<span class="finit" title="初始状态"></span>' : ''}
              ${iconOf(n)}
              <b>${inline(n.label)}</b>
              ${n.sub ? `<small>${inline(n.sub)}</small>` : ''}
            </div>`,
          )
          .join('')}</div>`,
      )
      .join('');

    // 区域框：节点用 group 引用，这里只声明框本身（位置由 app.js 算包围盒）
    const groupBoxes = (cfg.groups || [])
      .map(
        (g) => `<div class="fgroup tone-${g.tone || 'muted'}" data-group-box="${esc(g.id)}">
          <span class="fgroup-label">${inline(g.label)}</span>
        </div>`,
      )
      .join('');

    // 图例：按 kind 自动汇总，作者不用手写
    const kinds = [...new Set(nodes.map((n) => n.kind).filter(Boolean))];
    const legend =
      cfg.legend && kinds.length
        ? `<div class="flegend">${kinds
            .map((k) => {
              const c = nodes.filter((n) => n.kind === k).length;
              return `<span class="fleg-item tone-${KIND_TONE[k] || 'muted'}">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"
                     stroke-linecap="round" stroke-linejoin="round">${KIND_ICONS[k] || ''}</svg>
                ${esc(k)} <em>${c}</em></span>`;
            })
            .join('')}</div>`
        : '';

    const edgeData = esc(JSON.stringify(edges));
    return `<div class="flowd${cfg.grid ? ' has-grid' : ''}" data-flow data-edges="${edgeData}">
      <svg class="flowd-svg" aria-hidden="true">
        <defs>
          <marker id="fa" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
          </marker>
        </defs>
      </svg>
      <div class="flowd-groups">${groupBoxes}</div>
      <div class="flowd-grid">${grid}</div>
      ${legend}
    </div>`;
  }

  /* ===== 积木 13 · seq =====
     时序图。参与者横排，时间向下流，消息是水平箭头。
     依据 UML 2.5：每条消息线必须「水平或向下」，不能向上。
     几何全由 app.js 测量后画成 SVG（和 flow 同一套思路）。 */
  function seq(body) {
    const cfg = YAML.parse(body) || {};
    const parts = cfg.participants || [];
    const msgs = cfg.messages || [];
    const n = parts.length || 1;

    const head = parts
      .map((p) => {
        const tone = p.tone || KIND_TONE[p.kind] || 'muted';
        const icon = KIND_ICONS[p.kind]
          ? `<svg class="ficon" viewBox="0 0 16 16" fill="none" stroke="currentColor"` +
            ` stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">` +
            `${KIND_ICONS[p.kind]}</svg>`
          : '';
        return `<div class="scell"><div class="spart tone-${tone}${
          icon ? ' has-icon' : ''
        }" data-id="${esc(p.id)}">
          ${icon}<b>${inline(p.label)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}
        </div></div>`;
      })
      .join('');

    const rows = msgs
      .map(
        (m) => `<div class="smsg${m.from === m.to ? ' is-self' : ''}" data-from="${esc(
          m.from,
        )}" data-to="${esc(m.to)}" data-kind="${esc(m.kind || 'sync')}"${
          m.tone ? ` data-tone="${esc(m.tone)}"` : ''
        }${m.note ? ` data-note="${esc(m.note)}"` : ''}>${
          m.label ? `<span class="slabel">${inline(m.label)}</span>` : ''
        }</div>`,
      )
      .join('');

    return `<div class="seqd${cfg.grid ? ' has-grid' : ''}" data-seq data-n="${n}">
      <svg class="seqd-svg" aria-hidden="true">
        <defs>
          <marker id="s-fill" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
          </marker>
          <marker id="s-open" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="currentColor" stroke-width="1.4"/>
          </marker>
        </defs>
      </svg>
      <div class="seqd-head">${head}</div>
      <div class="seqd-body">${rows}</div>
    </div>`;
  }

  /* ===== 积木 14 · matrix =====
     2x2 定位矩阵。
     设计依据：阈值线的位置决定分类结果，所以它是主角；
     轴标签放在两端、极简，不写 HIGH/LOW 这类修饰。 */
  function matrix(body) {
    const cfg = YAML.parse(body) || {};
    const cells = cfg.cells || [];
    const x = cfg.x || {};
    const y = cfg.y || {};

    const cell = (c, i) =>
      c
        ? `<div class="mcell tone-${c.tone || 'muted'}">
            <b>${inline(c.title)}</b>
            ${c.desc ? `<span>${inline(c.desc)}</span>` : ''}
          </div>`
        : `<div class="mcell tone-muted is-empty"></div>`;

    return `<div class="mx">
      ${y.label ? `<div class="mx-ylab">${inline(y.label)}</div>` : ''}
      <div class="mx-body">
        <div class="mx-y mx-yto">${inline(y.to || '')}</div>
        <div class="mx-grid">
          ${cell(cells[0], 0)}
          ${cell(cells[1], 1)}
          ${cell(cells[2], 2)}
          ${cell(cells[3], 3)}
        </div>
        <div class="mx-y mx-yfrom">${inline(y.from || '')}</div>
        <div class="mx-xrow">
          <span>${inline(x.from || '')}</span><span>${inline(x.to || '')}</span>
        </div>
        ${x.label ? `<div class="mx-xlab">${inline(x.label)}</div>` : ''}
      </div>
    </div>`;
  }

  /* ===== 积木 15 · tree =====
     层级结构图：谁包含谁、谁继承谁、目录长什么样。
     横向缩进 + 肘形连接线 —— 任意深度都不会挤，比纵向树紧凑得多。
     节点可点击折叠，适合展示代码结构。 */
  function tree(body) {
    const items = YAML.parse(body) || [];
    const render = (nodes, depth) =>
      `<ul class="tlist">${nodes
        .map((n) => {
          const kids = Array.isArray(n.children) ? n.children : [];
          const tone = n.tone || (depth === 0 ? 'violet' : 'muted');
          return `<li${kids.length ? ' class="has-kids"' : ''}>
            <div class="tnode tone-${tone}" data-tree-node>
              ${kids.length ? '<span class="tcaret" aria-hidden="true"></span>' : ''}
              <b>${inline(n.label)}</b>
              ${n.sub ? `<code>${esc(n.sub)}</code>` : ''}
              ${n.note ? `<span class="tnote">${inline(n.note)}</span>` : ''}
            </div>
            ${kids.length ? render(kids, depth + 1) : ''}
          </li>`;
        })
        .join('')}</ul>`;
    return `<div class="tree" data-tree>${render(items, 0)}</div>`;
  }

  /* ---------- 注册 ---------- */
  const RENDERERS = {
    'lane-stack': laneStack,
    journey,
    compare,
    cards,
    timeline,
    flow,
    seq,
    matrix,
    tree,
    spec,
    callout,
    checklist,
    quiz,
    demo,
    summary,
    raw: (body) => body,
  };

  /** 已知的代码语言。不在这张表里、也不在 RENDERERS 里的围栏名会被报警告 ——
   *  否则积木名拼错会静默退化成普通代码块，作者根本发现不了。 */
  const CODE_LANGS = new Set([
    'bash', 'sh', 'shell', 'zsh', 'console', 'text', 'txt', 'plain',
    'js', 'javascript', 'ts', 'typescript', 'tsx', 'jsx', 'json', 'jsonc',
    'sql', 'python', 'go', 'java', 'rust', 'ruby', 'php', 'c', 'cpp', 'kotlin', 'swift',
    'yaml', 'yml', 'toml', 'ini', 'env', 'diff', 'patch',
    'html', 'xml', 'css', 'scss', 'vue', 'svelte', 'md', 'markdown',
    'http', 'graphql', 'proto', 'dockerfile', 'makefile', 'nginx',
  ]);

  md.renderer.rules.fence = (tokens, idx, _opts, env) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    const lang = info.split(/\s+/)[0];
    const line = token.map ? token.map[0] + 1 : null;
    const render = RENDERERS[lang];

    if (render) {
      try {
        return render(token.content);
      } catch (e) {
        // 把 YAML 报错定位到具体文件和行号，并回显原始内容 ——
        // 这是 agent 自纠的唯一依据，不能只丢一个堆栈。
        const at = `${env?.file || 'note.md'}${line ? ':' + line : ''}`;
        const body = token.content
          .split('\n')
          .map((l) => `  | ${l}`)
          .join('\n');

        // 最高频的坑单独给解法，不要只丢 YAML 的原始报错
        const raw = String(e.message);
        let hint = '';
        if (/reserved character|Plain value cannot start/i.test(raw)) {
          hint =
            '\n  💡 裸标量不能以反引号等特殊字符开头。给这个值加双引号：\n' +
            '     - q: "`xxx` 是什么？"   ← 外面包一层 " " 就行\n';
        }

        throw new Error(
          `${at} 积木 \`${lang}\` 解析失败\n` +
            `  ${raw.split('\n').join('\n  ')}\n` +
            hint +
            `  --- 原始内容 ---\n${body}`,
          { cause: e },   // 保留原始堆栈，便于定位是渲染器还是 markdown-it 内部出错
        );
      }
    }

    // 拼错积木名 / 未知语言：报警告，不要静默
    if (lang && !CODE_LANGS.has(lang) && env) {
      env.warnings = env.warnings || [];
      env.warnings.push({
        line,
        lang,
        message:
          `未知围栏语言 \`${lang}\`` +
          `。如果这是想用积木，可用的是：${Object.keys(RENDERERS).join(' / ')}` +
          `；否则请换成已知的代码语言（如 text、sql、js）。`,
      });
    }

    // 普通代码块：包一层以便放复制按钮
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    return `<div class="code-wrap"><button class="copy" data-copy>复制</button><pre><code${cls}>${esc(
      token.content,
    )}</code></pre></div>\n`;
  };

  /** 供校验脚本使用的元信息 */
  md.blockNames = Object.keys(RENDERERS);
  md.codeLangs = CODE_LANGS;
}

/* ---------- 行内强调标记 ----------
   问题：全文都是 `**加粗**` 时，等于没有重点 —— 术语、结论、坑长得一模一样。

   所以给三个语义各一个颜色，对应已有的 tone 系统：
     ==文字==  关键结论 / 最该记住的一句   → 蓝
     !!文字!!  坑 / 反直觉 / 注意           → 橙
     ++文字++  正确做法 / 推荐              → 绿

   `**加粗**` 降级为「句子内的重音」，不再承担强调职责。
------------------------------------------------ */
const INLINE_MARKS = [
  { marker: '==', cls: 'mk-blue' },
  { marker: '!!', cls: 'mk-amber' },
  { marker: '++', cls: 'mk-green' },
];

function inlineMarksPlugin(md) {
  const isSpace = (ch) => ch === undefined || /\s/.test(ch);

  function rule(state, silent) {
    const src = state.src;
    const start = state.pos;

    for (const { marker, cls } of INLINE_MARKS) {
      if (src.slice(start, start + 2) !== marker) continue;

      const openPos = start + 2;
      const end = src.indexOf(marker, openPos);

      // 内容非空、不以空白开头/结尾 —— 否则会把 `a == b` 误判成标记
      if (end < 0 || end >= state.posMax) continue;
      if (end === openPos) continue; // `====` 这种空内容
      if (isSpace(src[openPos]) || isSpace(src[end - 1])) continue;
      // 前面紧贴同类字符（如 ====）不算
      if (src[start - 1] === marker[0]) continue;

      if (!silent) {
        const openTok = state.push('mark_open', 'mark', 1);
        openTok.attrSet('class', cls);

        // 内部再走一遍行内解析 —— 否则 ==含 `代码` 的重点== 里的反引号会原样显示。
        //
        // ⚠️ 必须先解析到临时数组再追加。若直接把 state.tokens 传给嵌套解析，
        // 嵌套 state 的 delimiter 索引会从 0 开始，而它写入的却是外层数组 ——
        // emphasis 的 postProcess 按下标取值就会拿到 undefined 而崩。
        const inner = [];
        state.md.inline.parse(src.slice(openPos, end), state.md, state.env, inner);
        for (const t of inner) {
          state.tokens.push(t);
          if (Array.isArray(state.tokens_meta)) state.tokens_meta.push(null);
        }

        state.push('mark_close', 'mark', -1);
      }
      state.pos = end + 2;
      return true;
    }
    return false;
  }

  // 放在 emphasis 之前，但要在 code 之后 —— 反引号里的 == 不应被解析
  md.inline.ruler.before('emphasis', 'inline_marks', rule);
}

/* ---------- 中文加粗修复 ----------
   问题：`**「术语」**` 这种写法在中文里很常见，但 CommonMark 的 flanking 规则
   把「（等 CJK 标点当作 punctuation，导致：

     它是**「业务条件」和「SQL」之间的一层**。

   中的 `**` 不算合法的开分隔符 —— 于是星号原样显示，**静默失效**。

   做法：只在「标准规则会失败、但把 CJK 标点当普通字符就能成功」时接管，
   其余情况仍交给 markdown-it 原生的 emphasis，不影响嵌套和 `***` 等用法。
------------------------------------------------ */
const CJK_PUNCT = '「」『』（）〈〉《》【】〔〕，。！？；：、“”‘’…—·～';

const isSpaceish = (ch) => ch === undefined || /\s/.test(ch);
const isAsciiPunct = (ch) =>
  ch !== undefined && /[!-/:-@[-`{-~]/.test(ch);
const isCjkPunct = (ch) => ch !== undefined && CJK_PUNCT.includes(ch);

/**
 * 复现 CommonMark 的 flanking 判定。
 * treatCjkPunctAsLetter=true 时把 CJK 标点当普通字符（即我们要的宽松版）。
 */
function flankBlocked(before, next, isOpening, treatCjkPunctAsLetter) {
  const isPunct = (ch) =>
    isAsciiPunct(ch) || (!treatCjkPunctAsLetter && isCjkPunct(ch));

  const beforeSpace = isSpaceish(before);
  const beforePunct = isPunct(before);
  const nextSpace = isSpaceish(next);
  const nextPunct = isPunct(next);

  if (isOpening) {
    if (nextSpace) return true;
    if (!nextPunct) return false;
    return !(beforeSpace || beforePunct);
  }
  if (beforeSpace) return true;
  if (!beforePunct) return false;
  return !(nextSpace || nextPunct);
}

function cjkStrongPlugin(md) {
  function rule(state, silent) {
    const src = state.src;
    const start = state.pos;

    if (src.charCodeAt(start) !== 0x2a || src.charCodeAt(start + 1) !== 0x2a) return false;
    if (src[start - 1] === '*') return false; // 属于更长的星号串，不插手

    const before = start > 0 ? src[start - 1] : undefined;
    const next = src[start + 2];

    // 先把配对的收尾 ** 找出来（不跨行，且不是更长星号串的一部分）
    let end = -1;
    for (let i = start + 3; i < state.posMax - 1; i++) {
      const c = src.charCodeAt(i);
      if (c === 0x0a) break;
      if (c === 0x2a && src.charCodeAt(i + 1) === 0x2a) {
        if (src[i - 1] !== '*' && src[i + 2] !== '*') { end = i; break; }
        i++;
      }
    }
    if (end < 0 || end === start + 2) return false;

    // 开分隔符和收分隔符都要查 —— 两边都可能被 CJK 标点卡住
    const closeBefore = src[end - 1];
    const closeNext = end + 2 < state.posMax ? src[end + 2] : undefined;

    const pairs = [
      [before, next, true],
      [closeBefore, closeNext, false],
    ];

    let needsHelp = false;
    for (const [b, n, isOpen] of pairs) {
      if (!flankBlocked(b, n, isOpen, false)) continue; // 标准能过
      if (flankBlocked(b, n, isOpen, true)) return false; // 宽松也过不了，不是 CJK 的问题
      needsHelp = true;
    }
    if (!needsHelp) return false; // 两边标准都能过，交给原生 emphasis

    if (!silent) {
      state.push('strong_open', 'strong', 1);
      // 先解析到临时数组再追加 —— 否则嵌套 delimiter 索引会错位
      const inner = [];
      state.md.inline.parse(src.slice(start + 2, end), state.md, state.env, inner);
      for (const t of inner) {
        state.tokens.push(t);
        if (Array.isArray(state.tokens_meta)) state.tokens_meta.push(null);
      }
      state.push('strong_close', 'strong', -1);
    }
    state.pos = end + 2;
    return true;
  }

  md.inline.ruler.before('emphasis', 'cjk_strong', rule);
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
