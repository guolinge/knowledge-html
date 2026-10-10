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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

/* 积木名的唯一真相源 —— 由 blocksPlugin 注册时回填。
   踩过：tools/block.mjs 里手抄了一份清单，加了 memmap 之后没同步，
   于是 `npm run block -- <slug> --list` 把它当成代码块，截图也走错分支。
   ==同一份东西抄两遍，改的时候一定漏。== */
let REGISTERED_BLOCKS = [];
export const blockNames = () => REGISTERED_BLOCKS;

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
    /* 三种写法都走 inline() —— 包括带 tone 的标签。

       ⚠️ 带 tone 的格子以前用的 esc()（纯文本）。后果：全仓库 8 篇笔记里
       `{ text: "**注入漏洞**", tone: red }` 这种写法，页面上显示的就是
       字面的 `**注入漏洞**`。

       8 篇、19 处、多个会话都这么写 —— 说明错的是实现不是作者：
       写单元格的人的直觉就是「这里能写 markdown」，而 `tone` 的作用只是上色，
       不该顺手把 markdown 也关掉。 */
    const inner =
      c && typeof c === 'object'
        ? `<span class="tag tone-${c.tone || 'muted'}">${inline(c.text)}</span>`
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
          ${it.title ? `<h4>${inline(it.title)}</h4>` : ''}
          ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
          ${it.body ? `<div class="cbody">${md.render(String(it.body))}</div>` : ''}
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
    return `<div class="flowd${cfg.grid ? ' has-grid' : ''}${
      groupBoxes ? ' has-groups' : ''
    }" data-flow data-edges="${edgeData}">
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
     几何全由 app.js 测量后画成 SVG（和 flow 同一套思路）。

     三个能力（对齐 UML 时序图的核心表达）：
       · activations —— 激活条，**从消息自动推导**，不用手写
       · segments    —— 时间段框，把消息分阶段（按序号指定）
       · gap         —— 消息前的额外留白，用来表达「这一步慢」 */
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
        (m, i) => `<div class="smsg${m.from === m.to ? ' is-self' : ''}" data-from="${esc(
          m.from,
        )}" data-to="${esc(m.to)}" data-kind="${esc(m.kind || 'sync')}" data-i="${i + 1}"${
          m.tone ? ` data-tone="${esc(m.tone)}"` : ''
        }${m.note ? ` data-note="${esc(m.note)}"` : ''
        }${m.gap ? ` style="margin-top:${Number(m.gap) || 0}px"` : ''}>${
          m.note ? `<span class="snote">${inline(String(m.note))}</span>` : ''
        }${m.label ? `<span class="slabel">${inline(m.label)}</span>` : ''}</div>`,
      )
      .join('');

    // segments：按消息序号圈出时间段。app.js 画成带标签的框
    const segs = (cfg.segments || [])
      .filter((g) => g && g.label && g.from)
      .map((g) => ({ from: Number(g.from), to: Number(g.to ?? g.from), label: g.label }));
    const segAttr = segs.length
      ? ` data-segs="${esc(JSON.stringify(segs))}"`
      : '';

    return `<div class="seqd${cfg.grid ? ' has-grid' : ''}" data-seq data-n="${n}"${segAttr}>
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
              ${
                kids.length
                  ? '<span class="tcaret" aria-hidden="true"></span>'
                  : '<span class="tdot" aria-hidden="true"></span>'
              }
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

  /* ===== 积木 16 · arch =====
     内联一张用 archify skill 生成的复杂图。
     SVG 由 tools/archify.mjs 预先抠好放 assets/arch/，这里只负责读进来。
     为什么不在构建时调 archify：那样别人 clone 仓库后没有 archify 就构建不了。 */
  function arch(body) {
    const cfg = YAML.parse(body) || {};
    const name = cfg.svg;
    if (!name) throw new Error('arch 积木需要 svg: <名字>（对应 assets/arch/<名字>.svg）');

    const file = path.join(ROOT, 'assets/arch', `${name}.svg`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `找不到 assets/arch/${name}.svg。\n` +
          `  先生成：node tools/archify.mjs archify/${name}.json ${name}`,
      );
    }
    const svg = fs.readFileSync(file, 'utf8');

    /* 可选的交互数据。
       ------------------------------------------------------------
       图还是 archify 出的（几何、校验、渲染都不归我们），这里加的只是
       **语义层**：每个零件的说明、几个「我熟悉 ___」的入口、几条导览。

       为什么要加：原则 ②「整体图」说得很清楚 —— 整体图零件多，
       读者需要一个**入口**（从他本来就懂的那个零件进去），而不是从头看起。
       而这件事 archify 的 viewer 不做（它做的是聚焦和 Semantic Passport）。

       写成 data-* 属性而不是内联 <script>：属性会被 escapeXml 处理，
       不用在 markdown 管道里再想办法防止闭合标签被破坏。 */
    const attrs = [];
    const put = (k, v) => {
      if (v === undefined) return;
      attrs.push(`data-${k}='${JSON.stringify(v).replace(/'/g, '&#39;')}'`);
    };
    put('parts', cfg.parts);
    put('anchors', cfg.anchors);
    put('tours', cfg.tours);

    /* 零件 id 的校验。
       ------------------------------------------------------------
       `parts` / `anchors` / `tours` 里的 id 必须和 Archify spec 里的组件 id 一致，
       但那是**两个文件**。改图时改了 spec、忘了同步 note —— 不会报错，
       只是那个「我熟悉 ___」的按钮点了没反应，或者面板里显示成 id。
       这种错只有人点上去才发现，所以在构建期就拦下来。 */
    const nodeIds = new Set();
    for (const m of svg.matchAll(/data-node-id="([^"]+)"/g)) nodeIds.add(m[1]);
    const refs = [];
    Object.keys(cfg.parts || {}).forEach((k) => refs.push([k, `parts.${k}`]));
    (cfg.anchors || []).forEach((a, i) => refs.push([a.part, `anchors[${i}]`]));
    (cfg.tours || []).forEach((t, i) => {
      (t.steps || []).forEach((st, j) => {
        (st.at || []).forEach((id) => refs.push([id, `tours[${i}].steps[${j}].at`]));
      });
    });
    const bad = refs.filter((r) => r[0] && !nodeIds.has(r[0]));
    if (bad.length) {
      throw new Error(
        `${name}.svg 里没有这些零件 id：\n` +
          bad.map(([id, where]) => `      ${where} → "${id}"`).join('\n') +
          `\n    图里实际有的是：${[...nodeIds].join(' ')}` +
          `\n    多半是改了 archify/${name}.json 的组件 id，忘了同步这一处。`,
      );
    }

    const hasUI = cfg.anchors || cfg.tours || cfg.parts;
    const hint = hasUI
      ? `<span class="idle">点头上的任意一个框看它的关系；或者从下面的「我熟悉」进去</span>`
        + `<span class="focused">再点一次空白处取消</span>`
      : `<span class="idle">点头上的任意一个框，只看它和它连出去的关系</span>`
        + `<span class="focused">再点一次空白处取消</span>`;

    return `<figure class="archfig" data-arch${hasUI ? ' data-pano' : ''}${attrs.length ? ' ' + attrs.join(' ') : ''}>
      ${svg}
      ${cfg.caption ? `<figcaption>${inline(cfg.caption)}</figcaption>` : ''}
      ${hasUI ? '<div class="pano-ui"></div>' : ''}
      <p class="arch-hint">${hint}</p>
    </figure>`;
  }

  /* ===== 积木 18 · memmap =====
     地址空间的分层图。
     ------------------------------------------------------------
     别的积木都画「谁连谁」「谁包含谁」，这个画的是**长度**：
     一块内存里被切成了几段、各自多高、朝哪个方向长。

     为什么单做一个：内存布局是「一段连续空间里的几个区间」这种形状，
     flow / lane-stack / tree 都表达不了「它们其实是同一根轴上的一段」。
     同类形状还有：磁盘分区、协议头、栈帧、位域的字段切分。

     cfg:
       title / sub      顶部标题与副标题
       axis: true       右侧画一根地址轴（用 segment 的 addr）
       low / high       轴两端的标注
       segments[]       { label, sub, tone, size, dir, addr, mark }
                          size  高度权重（默认 1）—— 不是真实字节数
                          dir   'up' / 'down' —— 画增长方向箭头
                          mark  右侧的旁注（比如「多个进程共享同一份物理页」）
       note             底部一句话
  ------------------------------------------------ */
  function memmap(body) {
    const cfg = YAML.parse(body) || {};
    const segs = cfg.segments || [];
    if (!segs.length) throw new Error('memmap 积木需要 segments: [...]');

    const rows = segs
      .map((s) => {
        const tone = s.tone || 'muted';
        const size = Math.max(0.4, Number(s.size) || 1);
        const arrow =
          s.dir === 'down' ? '<span class="mm-dir mm-down" title="向下增长">↓ 向下长</span>'
          : s.dir === 'up' ? '<span class="mm-dir mm-up" title="向上增长">↑ 向上长</span>'
          : '';
        return `<div class="mm-seg tone-${tone}" style="--mm-size:${size}">
        <div class="mm-body">
          <div class="mm-head"><b>${inline(s.label || '')}</b>${arrow}</div>
          ${s.sub ? `<p class="mm-sub">${inline(s.sub)}</p>` : ''}
        </div>
        ${cfg.axis !== false && (s.addr || s.mark)
          ? `<div class="mm-side">
              ${s.addr ? `<span class="mm-addr">${esc(s.addr)}</span>` : ''}
              ${s.mark ? `<span class="mm-mark">${inline(s.mark)}</span>` : ''}
            </div>`
          : ''}
      </div>`;
      })
      .join('');

    const ends =
      cfg.axis !== false && (cfg.high || cfg.low)
        ? `<div class="mm-ends">
            ${cfg.high ? `<span class="mm-end">高地址 ${esc(cfg.high)}</span>` : ''}
            ${cfg.low ? `<span class="mm-end">低地址 ${esc(cfg.low)}</span>` : ''}
          </div>`
        : '';

    return `<figure class="memmap" data-memmap>
      ${cfg.title ? `<figcaption class="mm-title">${inline(cfg.title)}${cfg.sub ? `<span class="mm-cap-sub">${inline(cfg.sub)}</span>` : ''}</figcaption>` : ''}
      <div class="mm-stack">${rows}</div>
      ${ends}
      ${cfg.note ? `<p class="mm-note">${inline(cfg.note)}</p>` : ''}
    </figure>`;
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
    arch,
    spec,
    callout,
    checklist,
    quiz,
    demo,
    memmap,
    summary,
    raw: (body) => body,
  };
  REGISTERED_BLOCKS = Object.keys(RENDERERS);

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
      // YAML 预检：裸标量以保留字符开头是最常见的坑，而 YAML 自己的报错很难懂
      // 同时覆盖块式（行首 key:）和流式（{ key: ... } 里）两种写法
      const lines4yaml = token.content.split('\n');

      /* ① 值以保留字符开头：`desc: **加粗**开头` */
      const badValue = lines4yaml.findIndex((l) => /(?:^|[{,]\s*)[\w."'-]+:\s+[*&!%@]/.test(l));
      /* ② 键以保留字符开头：`- **工具问题**:`（块式）或 `- **工具问题**: [...]`（流式）

         两个坑踩过：

         a. **块标量里的行不能当 YAML 看。** `text: |` / `body: |` 里的内容
            是字符串，里面写 `- **重点**: 为什么…` 完全合法。
            第一版没管这个，一下误报了 23 处 —— 而误报会阻塞全仓库的 check。

         b. 保留字符表里不能放 `{` / `[` —— `- { title: x, desc: y }` 是合法的流式映射。 */
      const scalarLines = new Array(lines4yaml.length).fill(false);
      {
        let base = -1;
        for (let i = 0; i < lines4yaml.length; i++) {
          const m = /^(\s*)[\w."'-]+:\s*[|>][-+]?\s*$/.exec(lines4yaml[i]);
          if (m) { base = m[1].length; continue; }
          if (base < 0) continue;
          if (!lines4yaml[i].trim()) { scalarLines[i] = true; continue; }
          const ind = lines4yaml[i].length - lines4yaml[i].trimStart().length;
          if (ind > base) scalarLines[i] = true;
          else base = -1;
        }
      }
      const badKey = lines4yaml.findIndex(
        (l, i) => !scalarLines[i] && /^\s*-\s+[*&!%@][^:]*:\s*(\S.*)?$/.test(l),
      );

      if (badKey >= 0) {
        const at = `${env?.file || 'note.md'}${line ? ':' + (line + badKey) : ''}`;
        throw new Error(
          `${at} 积木 \`${lang}\` 的 YAML 里有「以保留字符开头的键」\n` +
            `  ${lines4yaml[badKey].trim()}\n` +
            `  💡 \`*\` 是别名、\`&\` 是锚点、\`!\` 是标签 —— 它们不能直接当键的开头。\n` +
            `     键想加粗就加引号：\n` +
            `       - "**机制**（因果关系）": [...]\n`,
        );
      }

      if (badValue >= 0) {
        const at = `${env?.file || 'note.md'}${line ? ':' + (line + badValue) : ''}`;
        throw new Error(
          `${at} 积木 \`${lang}\` 的 YAML 有裸标量以保留字符开头\n` +
            `  ${lines4yaml[badValue].trim()}\n` +
            `  💡 \`*\` \`&\` \`!\` 在 YAML 里是别名/锚点/标签的起始符。给这个值加双引号：\n` +
            `     desc: "**加粗**开头也要加引号"\n`,
        );
      }

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
        /* “块标量内容忘了缩进”—— 第二个高频坑，而且 YAML 自己的报错完全看不懂
           （会说 Implicit keys need to be on a single line）。
           判据：某个 `key: |` 后面第一个非空行的缩进 <= 这个 key 的缩进。 */
        const lines = token.content.split('\n');
        for (let i = 0; i < lines.length && !hint; i++) {
          const m = /^(\s*)[\w."'-]+:\s*[|>][-+]?\s*$/.exec(lines[i]);
          if (!m) continue;
          for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j].trim()) continue;
            const ind = lines[j].length - lines[j].trimStart().length;
            if (ind <= m[1].length) {
              hint =
                `\n  💡 块标量（第 ${i + 1} 行的 \`${lines[i].trim()}\`）里的内容没缩进。\n` +
                `     它的内容必须比这一行多缩进：\n` +
                `       text: |\n` +
                `         ==这一行要缩进==\n` +
                `     现在第 ${j + 1} 行顶在 ${ind} 列，YAML 会把它当成新的键。\n`;
            }
            break;
          }
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
  /* 本行里所有「长度恰为 2」的 ** 串的位置。
     跳过更长的星号串（*** / ****）和反引号 code span 里的 ** ——
     后者不查的话，模拟会把 code 里的假 ** 当成配对对象。 */
  function scanRuns(state) {
    const src = state.src;
    const runs = [];
    let i = 0;
    while (i < state.posMax) {
      const c = src.charCodeAt(i);
      if (c === 0x0a) break; // 只看本行
      if (c === 0x60) {
        // 反引号串：找到等长的收尾，整段当 code 跳过（近似 markdown-it 的 code span 规则）
        let n = 0;
        while (src.charCodeAt(i + n) === 0x60) n++;
        let j = i + n;
        let close = -1;
        while (j < state.posMax) {
          if (src.charCodeAt(j) === 0x60) {
            let m = 0;
            while (src.charCodeAt(j + m) === 0x60) m++;
            if (m === n) {
              close = j;
              break;
            }
            j += m;
          } else j++;
        }
        i = close >= 0 ? close + n : i + n;
        continue;
      }
      if (
        c === 0x2a &&
        src.charCodeAt(i + 1) === 0x2a &&
        src[i - 1] !== '*' &&
        src[i + 2] !== '*'
      ) {
        runs.push(i);
        i += 2;
        continue;
      }
      i++;
    }
    return runs;
  }

  /* 整行从左到右模拟「原生 emphasis 会怎么配对」，决定哪些 ** 需要接管。

     ==为什么不能只看当前位置这一对== —— 踩过的坑：

       A**甲乙**。C**丁戊**。

     旧逻辑在收尾 **（乙**。）上做「它能不能当开头」的检查：后面跟着中文句号、
     前面是汉字 → 标准 flanking 拦下、宽松放行 → 误判成「需要接管的开头」，
     把前面那组原生本来会配好的对拆散，整行渲染成嵌套 <strong>。

     正确做法：先模拟原生怎么配（能关就先关，关不掉再当开），
     只在「标准开不了、宽松开得了」且后面还有 ** 能收尾时才接管。 */
  function planLine(state) {
    const src = state.src;
    const runs = scanRuns(state);
    const capsOf = (p) => {
      const before = p > 0 ? src[p - 1] : undefined;
      const next = src[p + 2];
      return {
        openStd: !flankBlocked(before, next, true, false),
        openLax: !flankBlocked(before, next, true, true),
        closeStd: !flankBlocked(before, next, false, false),
        closeLax: !flankBlocked(before, next, false, true),
      };
    };
    const consumed = new Set();
    const takeovers = new Map(); // 开头位置 → 收尾位置
    const stack = []; // 原生会当 opener 用、还没被关掉的 **
    for (let idx = 0; idx < runs.length; idx++) {
      const p = runs[idx];
      if (consumed.has(p)) continue;
      const c = capsOf(p);
      // ① 它能按标准规则闭合前面某个 opener —— 原生会配对，不要抢
      if (c.closeStd && stack.length) {
        consumed.add(stack.pop());
        consumed.add(p);
        continue;
      }
      // ② 标准开不了、宽松开得了 → 后面下一个 ** 能收尾就接管这一对
      if (!c.openStd && c.openLax && idx + 1 < runs.length) {
        const j = runs[idx + 1];
        const cj = capsOf(j);
        if (cj.closeStd || cj.closeLax) {
          takeovers.set(p, j);
          consumed.add(p);
          consumed.add(j);
          continue;
        }
      }
      if (c.openStd) stack.push(p);
    }
    return takeovers;
  }

  function rule(state, silent) {
    const src = state.src;
    const start = state.pos;

    if (src.charCodeAt(start) !== 0x2a || src.charCodeAt(start + 1) !== 0x2a) return false;
    if (src[start - 1] === '*') return false; // 属于更长的星号串，不插手

    const end = planLine(state).get(start);
    if (end === undefined) return false; // 原生 emphasis 自己能配对，不插手

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

  /* 标题文字是从**渲染后的 HTML** 里剥标签拿到的，所以实体还留着。
     不解码的话，标题里带 `"` / `'` / `&` 的笔记，目录里会原样显示
     `&quot;目录&quot;`（而且 slug 里会多出 `quot`）——
     模板再转义一次就成了 `&amp;quot;`，页面上看到的就是这串字符本身。
     踩过：`## 03 · "目录"是怎么来的` 这一节。 */
  const decode = (s) =>
    String(s)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => {
    // 「01 · 标题」→ 编号徽章
    let content = inner;
    const text = decode(inner.replace(/<[^>]+>/g, '').trim());
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

/* ============================================================
   渲染结果的约定检查（不是语法错，是「渲染出来但不是你想的那样」）

   放在这里而不是 render.mjs，是因为 **skill 自己的文档也要查**
   （`skill-view.mjs` 渲染 SKILL.md / blocks.md）。
   以前只有笔记查，于是 blocks.md 自己踩了「围栏里嵌围栏」而没人发现 ——
   那篇文档正是教人别踩这个坑的。
   ============================================================ */

/** 把「第一个内容行」回到源码里找行号 —— 只说内容不够用，得说在哪一行 */
function whereIn(srcLines, needle) {
  if (!srcLines.length || !needle) return '';
  const hit = srcLines.findIndex((l) => l.trim() && l.includes(needle));
  return hit >= 0 ? `note.md:${hit + 1} 附近 → ` : '';
}

/**
 * 检查「围栏里嵌围栏」—— 外层 ``` 会被内层的裸 ``` 提前闭合。
 *
 * 症状很隐蔽：页面看着正常，只是后面的段落错位、`**加粗**` 字面显示。
 * 因为剩下的 markdown 全被当成代码块的正文了。
 *
 * 信号：一个**没有语言标注**的代码块，内容里却出现了 markdown 强调标记。
 * 正常写的代码示例不会这样（已全站扫描确认无例外）。
 */
export function lintFences(html, src = '') {
  const issues = [];
  const srcLines = src ? src.split('\n') : [];

  /* ── ① 源码层面的围栏嵌套检查（确定性，不猜）──

     一个围栏块里，如果出现了「缩进 ≤3 且反引号数 ≥ 外层」的围栏，
     它就会**提前关掉外层** —— 因为 md 的关围栏规则是：
       行首 ≤3 空格 + ≥ 开围栏长度 的反引号 + 后面只有空白

     必须缩进 ≤3 的才算 —— 块标量里的内容（比如 YAML 里缩进 6 的代码块）
     关不掉外层，那是合法的。

     为什么需要这条：下面那个启发式（「代码块里出现 markdown 强调」）
     只看**渲染结果**，而围栏被提前关掉之后，被困的内容如果恰好没有 `**` / `==`，
     它就一声不响。实测漏报了 8 处真问题 —— 那些 ASCII 图全都渲染成了缩进段落。 */
  let i = 0;
  while (i < srcLines.length) {
    const open = /^(`{3,})(\S+)\s*$/.exec(srcLines[i]);
    if (!open) { i++; continue; }
    const ticks = open[1].length;
    let j = i + 1;
    while (j < srcLines.length && !new RegExp('^`{' + ticks + ',}\\s*$').test(srcLines[j])) j++;
    if (j >= srcLines.length) { i = j; continue; }

    let worst = 0;
    for (let k = i + 1; k < j; k++) {
      const m = /^( {0,3})(`{3,})/.exec(srcLines[k]);
      if (m) worst = Math.max(worst, m[2].length);
    }
    if (worst >= ticks) {
      /* 报第一处「真的会关掉外层」的那行的行号 —— 作者能直接跳过去改 */
      let at = i + 2;
      for (let k = i + 1; k < j; k++) {
        const m = /^ {0,3}(`{3,})/.exec(srcLines[k]);
        if (m && m[1].length >= ticks) { at = k + 1; break; }
      }
      issues.push(
        `note.md:${at} 附近 → 这一行的围栏会提前关掉外层「${open[2]}」\n` +
          `      外层在第 ${i + 1} 行，用了 ${ticks} 个反引号；\n` +
          `      而第 ${at} 行的围栏（缩进 ≤3）有 ${worst} 个 —— ` +
          `关围栏只要「不少于外层长度」，所以它把外层关了。\n` +
          `      → 把外层改成 ${worst + 1} 个反引号，或跑 npm run fix-fence`,
      );
    }
    i = j + 1;
  }

  /* ── ② 渲染结果的启发式（上一层的补充）──
     上一段已经能确定性地捉到嵌套；这一条留着兜「其他原因把 markdown 闷在代码块里」——
     但它是猜的，所以排在后面。 */
  for (const m of html.matchAll(/<pre><code>([^<]*)<\/code><\/pre>/g)) {
    const text = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    /* `==` 不能是 `===` 的一部分 —— 写 `typeof x === 'string'` 的示例会误报。 */
    if (/(?<!=)==(?!=)|!!|\+\+|(?<!\*)\*\*[^\s*]/.test(text)) {
      const first = (text.split('\n').find((l) => l.trim()) || '').trim();
      issues.push(
        `${whereIn(srcLines, first.slice(0, 30))}有 markdown 被困在代码块里` +
          `（第一个内容行：${first.slice(0, 40)}）—— ` +
          `多半是「围栏里嵌围栏」：外层 \`\`\` 被内层的裸 \`\`\` 提前闭合了。\n` +
          `      → 把那个外层围栏换成四个反引号 \`\`\`\``,
      );
    }
  }
  return issues;
}


/**
 * 检查源码里直接写了「会吃掉后面所有内容」的 HTML 标签。
 *
 * 积木里的正文和单元格都走 `html: true` 的行内渲染 —— 裸 HTML 是支持的。
 * 所以 `<script src="...">` 会被原样输出成一个**真的 script 元素**；
 * 而 HTML 解析器遇到没有 `</script>` 的 script 时，
 * ==会把后面整篇文档都当成脚本文本吃掉==。
 *
 * 实测代价：一篇笔记的 compare 单元格里写了
 * `<script src="https://cdn.example.com/app.js">`，
 * 页面上那之后的**所有积木、所有 demo 控件、连 app.js 本身**都不存在了 ——
 * 表现是「flow 的连线全空、控件全不挂载」，而 `npm run check` 全绿。
 *
 * 同类标签还有 style / textarea / title / xmp，都是 raw-text 元素：
 * 没闭合就会一路吞到下一个同名闭合标签。
 * 想展示这类标签，用反引号包起来（会转义成 &lt;script&gt;）。
 */
export function lintRawHtml(_html, src = '') {
  const issues = [];
  if (!src) return issues;
  const lines = src.split('\n');
  const RISKY = /<\s*(script|style|textarea|title|xmp)\b/i;

  /* 跳过围栏内部 —— 代码块里写脚本示例是正常的，而且那里会被转义。
     围栏规则同 lintFences：行首 ≤3 空格 + ≥ 开围栏长度的反引号 + 后面只有空白。 */
  let i = 0;
  while (i < lines.length) {
    const open = /^(`{3,})(\S+)\s*$/.exec(lines[i]);
    if (!open) {
      /* 行内的反引号片段要先摘掉 —— `` `<script ...>` `` 是正确写法，不该报。
         （多反引号的片段先处理，否则 `` `a `` b` `` 这种会被切错。） */
      const inlineCode = /(`+)[\s\S]*?\1/g;
      const stripped = lines[i].replace(/``[\s\S]*?``/g, '').replace(inlineCode, '');
      if (RISKY.test(stripped)) {
        const tag = RISKY.exec(stripped)[1].toLowerCase();
        issues.push(
          `note.md:${i + 1} 附近 → 源码里直接写了裸的 \`<${tag}>\`。\n` +
            `      积木会把它原样输出成真的 HTML 元素；\`${tag}\` 是 raw-text 元素，\n` +
            `      没有闭合标签时**浏览器会把后面整篇文档当成它的内容吃掉**：\n` +
            `      那之后的积木、控件、脚本全都不存在，而且不报错。\n` +
            `      → 用反引号包起来：\`<${tag} ...>\`（渲染成转义后的等宽文本）`,
        );
      }
      i += 1;
      continue;
    }
    const ticks = open[1].length;
    let j = i + 1;
    while (j < lines.length && !new RegExp('^`{' + ticks + ',}\\s*$').test(lines[j])) j++;
    i = j + 1;
  }
  return issues;
}


/**
 * 检查链接被 `**` 污染 —— `**https://x/**。` 这种写法。
 *
 * linkify-it 只在 `*` 位于字符串**末尾**时才把它从 URL 里裁掉。
 * 后面跟个中文句号，`*` 就不再是末尾，于是 `**。` 一起被算进 URL：
 * 加粗丢了，href 里还带着 `**` —— 链接是坏的。
 */
export function lintLinkifyStars(html, src = '') {
  const issues = [];
  const srcLines = src ? src.split('\n') : [];
  for (const m of html.matchAll(/<a href="([^"]*\*\*[^"]*)"/g)) {
    const href = m[1].replace(/&amp;/g, '&');
    issues.push(
      `${whereIn(srcLines, href.slice(0, 24))}链接里混进了 \`**\`（href = ${href.slice(0, 60)}）—— ` +
        `把 \`**URL**\` 后面直接跟了中文标点。\n` +
        `      → 两个改法：\n` +
        `        ① 去掉加粗，改成 \`URL\`（等宽，URL 本来就更适合）\n` +
        `        ② 保留加粗就在中间垫一个空格：\`**URL **\`\n` +
        `        （中文标点不是问题；问题是 linkify 把 \`**\` 当成了 URL 的一部分）`,
    );
  }
  return issues;
}
