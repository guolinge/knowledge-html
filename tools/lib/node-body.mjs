/* ============================================================
   node-body.mjs —— 给 arch 图的节点矩形里填「内容」
   ------------------------------------------------------------
   为什么要有这个文件
   ------------------------------------------------------------
   archify 的节点只认三样文字：label / sublabel / tag，都是**一行居中**。
   于是一张整体图不管有多少零件，画出来都是「一堆小矩形 + 一行字 + 一些线」——
   读者拿到的是一张目录，不是一张地图。

   但节点该说的话往往不止一句：fd 表里有哪几个 fd、CPU 有四个核在跑几个、
   地址空间从高到低分成哪几段、一个 task 的现场存了哪几样。
   这些是**结构**和**量**，塞进一行 sublabel 就只剩名词。

   这个模块在**构建期**把 archify 抠好的 SVG 改一遍：对有 `bodies` 的节点，
   隐掉它自带的 label/sublabel，改画一个「标题 + 结构化内容」的内部布局。
   几何、路由、校验仍然全部归 archify —— 我们只往已经算好的矩形里填内容。

   八种内容（可以叠加，按这个顺序从上往下排）：
     badge  右上角徽标   "全组共享"
     rows   键值行      [["fd 0", "stdin → 终端"], { k: "内核栈", v: "16KB", link: "task0" }]
     cells  小格子      [{ label: "T0", tone: "hot", link: "task0" }, { label: "空闲" }]
     bars   横条带      [{ label: ".text", weight: 3 }, ...]        按比例分
     stack  纵向段      [{ label: "栈", mark: "0x7fff…", link: "ustacks" }, ...]
     pairs  左右映射    [{ from: "VA 0x601000", to: "帧 42" }, ...]  画一条箭头
     meter  计量条      { label: "内核栈", value: 3.2, total: 16, unit: "KB" }
     code   一行代码    'mm = mm_alloc();'
     note   末行小字    "3 个在跑，1 个闲着"

   **每一项都可以是「可点的格子」**：给它 `link`（跳到哪个零件）和 `tip`
   （一句话说明），渲染出来就带 data-nb-spot / data-nb-link / data-nb-tip，
   app.js 接上 hover 提示与点击聚焦。于是入口从「整个零件」细化到「零件里的一行」。

   放不下就**报错，不静默溢出**：算一遍这个 body 需要多高，和 archify 给的
   size 一比，不够就抛异常并告诉你要把 size 改成多少。
   宁可构建失败，也不要一张「看着对、其实挤到框外」的图。
   ============================================================ */

/* ---------- 排版常量（SVG 用户单位，跟着 viewBox 一起缩放） ---------- */
const PAD_X = 12;        // 左右内边距
const HEAD_H = 34;       // 标题区高度（含分隔线）
const TITLE_FS = 10.5;   // 标题字号
const TITLE_MIN_FS = 8.5;
const BODY_FS = 9;       // 内容字号
const BADGE_FS = 8;
const ROW_H = 14;        // 一行键值
const CELL_H = 23;       // 格子高度
const CELL_H2 = 32;      // 带副标题的格子
const CELL_GAP = 6;
const CELL_MAX_W = 104;
const BAR_H = 17;        // 条带高度
const STACK_ROW_H = 15;  // 纵向段每段高度
const PAIR_H = 14;       // 一行映射
const METER_H = 22;      // 计量条（一行字 + 一条槽）
const CODE_H = 12;       // 一行代码
const GAP = 7;           // 两块内容之间
const BOTTOM_PAD = 8;
const SIGIL_W = 22;      // archify 的图标占掉的横向位置
const BLOCK_ORDER = ['rows', 'cells', 'bars', 'stack', 'pairs', 'meter', 'code'];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 宽度估算：和 archify renderers/shared/text-fit.mjs 同一口径
   （全角 2 单位、半角 1 单位，1 单位 = 0.6 × 字号）。
   用同一套算法，量出来的结果才对得上它自己的校验。 */
const FULLWIDTH = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u3000-\u303f]/;
function textUnits(text) {
  const chars = Array.from(String(text ?? ''));
  let units = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const cp = chars[i].codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue;   // variation selector
    units += FULLWIDTH.test(chars[i]) ? 2 : 1;
  }
  return units;
}
function textW(text, fs) {
  return textUnits(text) * fs * 0.6;
}
function fitFontSize(text, width, preferred, min) {
  const u = Math.max(1, textUnits(text));
  return Math.max(min, Math.floor(Math.min(preferred, width / (u * 0.6)) * 10) / 10);
}

/* 在 svg 里找到 <g id="node-<id>"> 这个组的起止下标（要处理嵌套的 <g>）。

   ⚠️ 踩过一次：扫描从 `id="node-x"` 那个位置起算，却**没把节点自己的 <g> 计进深度**，
   于是内层第一个 </g>（archify 的语义图标那个）就被当成了组的结尾 ——
   表现是「图标之后的旧文字没被删掉、新内容上下文错位」这种安静的错误。
   正确的做法是从开标签的 `>` 之后开始扫，深度从 0 起。 */
function findNodeGroup(svg, id) {
  const at = svg.indexOf(`id="node-${id}"`);
  if (at < 0) return null;
  const start = svg.lastIndexOf('<g ', at);
  let i = svg.indexOf('>', at) + 1;
  let depth = 0;
  while (i < svg.length) {
    const open = svg.indexOf('<g ', i);
    const close = svg.indexOf('</g>', i);
    if (close < 0) return null;
    if (open >= 0 && open < close) {
      depth += 1;
      i = open + 3;
    } else {
      if (depth === 0) return { start, end: close + 4 };
      depth -= 1;
      i = close + 4;
    }
  }
  return null;
}

/* 节点矩形：组里第一个 <rect>（archify 画两个：mask + 填充，几何一样） */
function nodeRect(inner) {
  const m = inner.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  if (!m) return null;
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

/* 一行/一格只要是对象，就能带 link / tip / tone / id —— 它就是「可点的格子」 */
function spotAttrs(o) {
  const a = [];
  if (o.link) a.push(`data-nb-link="${esc(o.link)}"`);
  if (o.tip) a.push(`data-nb-tip="${esc(o.tip)}"`);
  if (o.id) a.push(`data-nb-id="${esc(o.id)}"`);
  if (o.tone) a.push(`data-tone="${esc(o.tone)}"`);
  if (!a.length) return '';
  return ` class="nb-spot" data-nb-spot="1" tabindex="0" role="button" ${a.join(' ')}`;
}
const isSpot = (o) => !!(o && typeof o === 'object' && (o.link || o.tip || o.id));
/* 场景开关：一项内容可以只在某个场景里出现（when: 'multi' / ['multi','one']）。
   渲染成 data-when，app.js 切换场景时按属性显隐 —— 于是一张地图能演两种状态。 */
function whenAttr(o) {
  if (!o || typeof o !== 'object' || !o.when) return '';
  const v = Array.isArray(o.when) ? o.when.join(' ') : String(o.when);
  return ` data-when="${esc(v)}"`;
}
/* 需要包一层 <g> 的情况：可点（spot）或带场景条件 */
function wrapItem(o, inner) {
  if (!isSpot(o) && !whenAttr(o)) return inner.join('');
  const attrs = (isSpot(o) ? spotAttrs(o) : ' class="nb-when"') + whenAttr(o);
  return `<g${attrs}>${inner.join('')}</g>`;
}
const asObj = (x, key) => (typeof x === 'object' && x !== null ? x : { [key]: x });

/* ---------- 每块内容需要多高 ---------- */
function blockH(spec) {
  let h = 0;
  if (spec.rows) h += spec.rows.length * ROW_H;
  if (spec.cells) h += spec.cells.some((c) => c && c.sub) ? CELL_H2 : CELL_H;
  if (spec.bars) h += BAR_H;
  if (spec.stack) h += spec.stack.length * STACK_ROW_H;
  if (spec.pairs) h += spec.pairs.length * PAIR_H;
  if (spec.meter) h += METER_H;
  if (spec.code) h += CODE_H;
  return h;
}
function blocksCount(spec) {
  return BLOCK_ORDER.filter((k) => spec[k]).length + (spec.notes ? 1 : 0);
}

/* 一个 body 需要多高 —— 给「自动定尺寸」和写作时的自查用 */
export function requiredHeight(spec, scenarios = []) {
  const ids = (scenarios || []).map((s) => (typeof s === 'string' ? s : s.id));
  return Math.max.apply(null, variantsFor(spec, ids).map(oneHeight));
}
function oneHeight(spec) {
  const noteH = spec.note ? 14 : (spec.notes ? spec.notes.length * 13 + 2 : 0);
  return HEAD_H + blockH(spec) + blocksCount(spec) * GAP + noteH + BOTTOM_PAD;
}

/* 按场景拆成几份「内容清单」。
   一项内容可以只在某个场景出现（when: 'multi'），那么：
     · 每个场景各排一遍版 —— 不是简单地把那一项藏起来（藏起来会留下空洞，
       一排格子少一个就歪了）
     · 节点高度取最胖的那一版
   没有任何 when 时，就只有一个「默认版」。 */
function inScenario(item, sid) {
  if (!item || typeof item !== 'object' || !item.when) return true;
  if (!sid) return true;
  const list = Array.isArray(item.when) ? item.when : [item.when];
  return list.indexOf(sid) >= 0;
}
function variantsFor(spec, scenIds) {
  const list = scenIds && scenIds.length ? scenIds : [null];
  return list.map((sid) => {
    const pick = (items) => (items || []).filter((it) => inScenario(it, sid));
    const v = { sid };
    ['rows', 'cells', 'bars', 'stack', 'pairs'].forEach((k) => { if (spec[k]) v[k] = pick(spec[k]); });
    if (spec.meter) v.meter = spec.meter;
    if (spec.code) v.code = spec.code;
    if (spec.note) v.note = spec.note;
    if (spec.notes) v.notes = pick(spec.notes);
    return v;
  });
}

/* ---------- 画每一块（top = 这一块的顶边；返回画出来的 SVG 片段） ---------- */
function drawRows(rows, rect, top) {
  /* 键列宽度 = 最长键，整列对齐（像一张真表格）。
     ⚠️ 数组和对象两种写法都要算 —— 只认 Array.isArray 的话，
     写成 { k, v } 的那一行键列宽度会算成 0，值和键就粘在一起了。 */
  let kw = 0;
  rows.forEach((r) => {
    const k = Array.isArray(r) ? r[0] : (r && typeof r === 'object' ? r.k : undefined);
    if (k !== undefined) kw = Math.max(kw, textW(k, BODY_FS));
  });
  const out = [];
  rows.forEach((r, i) => {
    const ty = top + i * ROW_H + BODY_FS + 2;
    const o = Array.isArray(r) ? { k: r[0], v: r[1] } : asObj(r, 'v');
    const inner = [];
    if (o.k === undefined) {
      inner.push(`<text class="nb-v" x="${rect.x + PAD_X}" y="${ty}" font-size="${BODY_FS}">${esc(o.v)}</text>`);
    } else {
      inner.push(`<text class="nb-k" x="${rect.x + PAD_X}" y="${ty}" font-size="${BODY_FS}">${esc(o.k)}</text>`);
      inner.push(`<text class="nb-v" x="${(rect.x + PAD_X + kw + 9).toFixed(1)}" y="${ty}" font-size="${BODY_FS}">${esc(o.v)}</text>`);
    }
    if (isSpot(o)) inner.unshift(`<rect class="nb-hit" x="${rect.x + PAD_X - 5}" y="${top + i * ROW_H}" width="${(rect.w - PAD_X * 2 + 10).toFixed(1)}" height="${ROW_H}"/>`);
    out.push(wrapItem(o, inner));
  });
  return out.join('\n          ');
}

function drawCells(cells, rect, top) {
  const twoLine = cells.some((c) => c && c.sub);
  const h = twoLine ? CELL_H2 : CELL_H;
  const total = rect.w - PAD_X * 2;
  const cw = Math.min(CELL_MAX_W, (total - (cells.length - 1) * CELL_GAP) / cells.length);
  const out = [];
  cells.forEach((c, i) => {
    const o = asObj(c, 'label');
    const x = rect.x + PAD_X + i * (cw + CELL_GAP);
    const tone = o.tone ? ` data-tone="${esc(o.tone)}"` : '';
    const mid = (x + cw / 2).toFixed(1);
    const inner = [
      `<rect class="nb-cell"${tone} x="${x.toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${h}" rx="4"/>`,
    ];
    if (twoLine) {
      inner.push(`<text class="nb-cell-t"${tone} x="${mid}" y="${top + 13}" font-size="${BODY_FS}" text-anchor="middle">${esc(o.label)}</text>`);
      if (o.sub) inner.push(`<text class="nb-cell-s" x="${mid}" y="${top + 24}" font-size="7.5" text-anchor="middle">${esc(o.sub)}</text>`);
    } else {
      inner.push(`<text class="nb-cell-t"${tone} x="${mid}" y="${top + 15}" font-size="${BODY_FS}" text-anchor="middle">${esc(o.label)}</text>`);
    }
    out.push(wrapItem(o, inner));
  });
  return out.join('\n          ');
}

function drawBars(bars, rect, top) {
  const total = rect.w - PAD_X * 2;
  const sum = bars.reduce((a, b) => a + (b.weight || 1), 0);
  const out = [];
  let x = rect.x + PAD_X;
  bars.forEach((b, i) => {
    const w = i === bars.length - 1 ? rect.x + PAD_X + total - x : (total * (b.weight || 1)) / sum;
    const tone = b.tone ? ` data-tone="${esc(b.tone)}"` : '';
    const inner = [`<rect class="nb-seg"${tone} x="${x.toFixed(1)}" y="${top}" width="${Math.max(1, w - 2).toFixed(1)}" height="${BAR_H}" rx="3"/>`];
    if (w > 30) {
      const fs = textW(b.label, 8) > w - 8 ? 6.5 : 8;
      inner.push(`<text class="nb-seg-t"${tone} x="${(x + w / 2).toFixed(1)}" y="${top + 12}" font-size="${fs}" text-anchor="middle">${esc(b.label)}</text>`);
    }
    out.push(wrapItem(b, inner));
    x += w;
  });
  return out.join('\n          ');
}

function drawStack(stack, rect, top) {
  const out = [];
  stack.forEach((s, i) => {
    const y = top + i * STACK_ROW_H;
    const tone = s.tone ? ` data-tone="${esc(s.tone)}"` : '';
    const inner = [
      `<rect class="nb-seg"${tone} x="${rect.x + PAD_X}" y="${y}" width="${(rect.w - PAD_X * 2).toFixed(1)}" height="${STACK_ROW_H - 3}" rx="3"/>`,
      `<text class="nb-seg-t"${tone} x="${rect.x + PAD_X + 7}" y="${y + 9}" font-size="8">${esc(s.label)}</text>`,
    ];
    if (s.mark) inner.push(`<text class="nb-note" x="${rect.x + rect.w - PAD_X - 7}" y="${y + 9}" font-size="7.5" text-anchor="end">${esc(s.mark)}</text>`);
    out.push(wrapItem(s, inner));
  });
  return out.join('\n          ');
}

/* 左右两栏 + 一条箭头：页表那种「这边是什么，那边变成什么」 */
function drawPairs(pairs, rect, top) {
  const inner0 = rect.x + PAD_X;
  const w = rect.w - PAD_X * 2;
  const arrowX = inner0 + w * 0.44;
  const toX = inner0 + w * 0.52;
  const out = [];
  pairs.forEach((p, i) => {
    const y = top + i * PAIR_H + 10;
    const o = asObj(p, 'from');
    const inner = [
      `<text class="nb-pair-from" x="${inner0}" y="${y}" font-size="8.5">${esc(o.from)}</text>`,
      `<text class="nb-pair-arrow" x="${arrowX.toFixed(1)}" y="${y}" font-size="8.5">→</text>`,
      `<text class="nb-pair-to" x="${toX.toFixed(1)}" y="${y}" font-size="8.5">${esc(o.to)}</text>`,
    ];
    if (o.note) inner.push(`<text class="nb-note" x="${rect.x + rect.w - PAD_X}" y="${y}" font-size="7.5" text-anchor="end">${esc(o.note)}</text>`);
    if (isSpot(o)) inner.unshift(`<rect class="nb-hit" x="${inner0 - 5}" y="${top + i * PAIR_H}" width="${(w + 10).toFixed(1)}" height="${PAIR_H}"/>`);
    out.push(wrapItem(o, inner));
  });
  return out.join('\n          ');
}

/* 计量条：一个东西用了多少 / 一共多少（原则 ②：「容器要画出容量」） */
function drawMeter(m, rect, top) {
  const w = rect.w - PAD_X * 2;
  const pct = Math.max(0.02, Math.min(1, (m.value || 0) / (m.total || 1)));
  const y = top + 9;
  const inner = [
    `<text class="nb-k" x="${rect.x + PAD_X}" y="${y}" font-size="8.5">${esc(m.label || '')}</text>`,
    `<text class="nb-note" x="${rect.x + rect.w - PAD_X}" y="${y}" font-size="8" text-anchor="end">${esc(m.text || `${m.value} / ${m.total}${m.unit || ''}`)}</text>`,
    `<rect class="nb-meter-track" x="${rect.x + PAD_X}" y="${top + 13}" width="${w.toFixed(1)}" height="6" rx="3"/>`,
    `<rect class="nb-meter-fill"${m.tone ? ` data-tone="${esc(m.tone)}"` : ''} x="${rect.x + PAD_X}" y="${top + 13}" width="${(w * pct).toFixed(1)}" height="6" rx="3"/>`,
  ];
  return wrapItem(m, inner);
}

export function applyNodeBodies(svg, bodies, figure = '图', scenarios = []) {
  if (!bodies || !Object.keys(bodies).length) return svg;
  const scenIds = (scenarios || []).map((s) => s.id);
  let out = svg;

  Object.entries(bodies).forEach(([id, spec]) => {
    const g = findNodeGroup(out, id);
    if (!g) {
      throw new Error(
        `${figure} 的 bodies.${id} 在图里找不到这个零件。\n` +
          `    图里实际有的是：${[...out.matchAll(/id="node-([^"]+)"/g)].map((m) => m[1]).join(' ')}`,
      );
    }
    const inner = out.slice(g.start, g.end);
    const rect = nodeRect(inner);
    if (!rect) throw new Error(`${figure} 的节点 ${id} 里找不到矩形，SVG 结构可能变了。`);

    /* 放得下吗？（按最胖的那个场景算） */
    const variants = variantsFor(spec, scenIds);
    const need = Math.max.apply(null, variants.map(oneHeight));
    if (need > rect.h + 0.5) {
      throw new Error(
        `${figure} 的节点「${id}」装不下这些内容：需要 ${Math.ceil(need)}px 高，现在只有 ${rect.h}px。\n` +
          `    → 改 archify/${figure}.json 里这个零件的 size 第二项，至少给到 ${Math.ceil(need)}（留点余量更好）。`,
      );
    }

    const defaultTitle = (inner.match(/data-node-label="([^"]*)"/) || [])[1] || id;
    const titles = Array.isArray(spec.title)
      ? spec.title
      : [{ text: spec.title || defaultTitle }];

    /* 隐掉 archify 自带的那几行文字（label / sublabel / tag），标题我们自己画。
       <title> 和语义图标留着。 */
    let body = inner.replace(/<text[\s\S]*?<\/text>/g, '');
    body = body.replace(/\n\s*\n/g, '\n');

    const parts = [];
    const badgeW = spec.badge ? textW(spec.badge, BADGE_FS) + 12 : 0;
    if (spec.badge) {
      parts.push(`<rect class="nb-badge" x="${(rect.x + rect.w - PAD_X - badgeW).toFixed(1)}" y="${rect.y + 8}" width="${badgeW.toFixed(1)}" height="15" rx="7.5"/>`);
      parts.push(`<text class="nb-badge-t" x="${(rect.x + rect.w - PAD_X - badgeW / 2).toFixed(1)}" y="${rect.y + 19}" font-size="${BADGE_FS}" text-anchor="middle">${esc(spec.badge)}</text>`);
    }
    const room = rect.w - PAD_X * 2 - SIGIL_W - (badgeW ? badgeW + 6 : 0);
    /* 标题也能分场景：用户栈在单线程时叫「×1」，多线程时叫「×3」 */
    titles.forEach((t) => {
      const txt = t.text || defaultTitle;
      const fs = Math.min.apply(null, titles.map((x) => fitFontSize(x.text || defaultTitle, room, TITLE_FS, TITLE_MIN_FS)));
      parts.push(`<text class="nb-title"${whenAttr(t)} x="${rect.x + PAD_X + SIGIL_W}" y="${rect.y + 21}" font-size="${fs}" font-weight="600">${esc(txt)}</text>`);
    });
    parts.push(`<line class="nb-hr" x1="${rect.x + PAD_X - 4}" y1="${rect.y + 28}" x2="${rect.x + rect.w - PAD_X + 4}" y2="${rect.y + 28}"/>`);

    /* 内容整块在框里**垂直居中**（落款钉在底部）。
       不居中的话，行数少的节点会变成「上半截有字、下半截空着」——
       节点一多，整张图看起来就像没排完版。 */
    function drawVariant(v) {
      const out = [];
      const noteH = v.note ? 14 : (v.notes ? v.notes.length * 13 + 2 : 0);
      const roomTop = rect.y + HEAD_H;
      const roomBottom = rect.y + rect.h - BOTTOM_PAD - noteH;
      const used = blockH(v) + Math.max(0, blocksCount(v) - 1) * GAP;
      let top = roomTop + Math.max(0, (roomBottom - roomTop - used) / 2);

      if (v.rows) { out.push(drawRows(v.rows, rect, top)); top += v.rows.length * ROW_H + GAP; }
      if (v.cells) { out.push(drawCells(v.cells, rect, top)); top += (v.cells.some((c) => c && c.sub) ? CELL_H2 : CELL_H) + GAP; }
      if (v.bars) { out.push(drawBars(v.bars, rect, top)); top += BAR_H + GAP; }
      if (v.stack) { out.push(drawStack(v.stack, rect, top)); top += v.stack.length * STACK_ROW_H + GAP; }
      if (v.pairs) { out.push(drawPairs(v.pairs, rect, top)); top += v.pairs.length * PAIR_H + GAP; }
      if (v.meter) { out.push(drawMeter(v.meter, rect, top)); top += METER_H + GAP; }
      if (v.code) out.push(`<text class="nb-code" x="${rect.x + PAD_X}" y="${top + 9}" font-size="7.5">${esc(v.code)}</text>`);
      if (v.notes) {
        v.notes.forEach((n, i) => {
          out.push(`<text class="nb-note" x="${rect.x + PAD_X}" y="${(rect.y + rect.h - BOTTOM_PAD - (v.notes.length - 1 - i) * 13).toFixed(1)}" font-size="8">${esc(n.text || n)}</text>`);
        });
      } else if (v.note) {
        out.push(`<text class="nb-note" x="${rect.x + PAD_X}" y="${rect.y + rect.h - BOTTOM_PAD}" font-size="8">${esc(v.note)}</text>`);
      }
      return out.join('\n          ');
    }

    variants.forEach((v) => {
      const html = drawVariant(v);
      parts.push(v.sid ? `<g data-when="${esc(v.sid)}">\n          ${html}\n          </g>` : html);
    });

    let next = body.replace(/\s*<\/g>\s*$/, `\n          ${parts.join('\n          ')}\n        </g>`);
    next = next.replace(/data-node-id="/, 'data-nb="1" data-node-id="');
    out = out.slice(0, g.start) + next + out.slice(g.end);
  });

  return out;
}
