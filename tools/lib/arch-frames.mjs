/* 整体图的区域语义与画布尺度。
 * 坐标、节点、连线仍由 archify 生成；这里只修正被截平的区域底边并包装可探索的框。
 * frames 未声明时不增加区域交互。父子关系显式声明，不把相交集合猜成包含。
 */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (text, key) => (text.match(new RegExp(`\\b${key}="([^"]*)"`)) || [])[1];
const decode = (text) => String(text).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const FRAME = /<rect\b[^>]*data-composition-frame-id="\d+"[^>]*\/>\s*<text\b[^>]*>[\s\S]*?<\/text>/g;

/** archify 会将父子框底边截到相同坐标。恢复成员包围盒 + pad，并留下成员身份供离线构建读取。 */
export function restoreBoundaryBoxes(svg, spec) {
  if (spec.diagram_type !== 'architecture') return svg;
  let bottom = 0;
  const result = svg.replace(FRAME, (match) => {
    const index = Number(attr(match, 'data-composition-frame-id'));
    const boundary = spec.boundaries?.[index];
    if (!boundary) throw new Error(`区域 ${index} 在 spec.boundaries 中不存在`);
    const members = spec.components.filter((c) => boundary.wraps.includes(c.id));
    if (members.length !== boundary.wraps.length) throw new Error(`区域 ${index} 的 wraps 引用了不存在或重复的零件`);
    const positions = members.map((c) => {
      const node = svg.slice(svg.indexOf(`id="node-${c.id}"`));
      const rect = (node.match(/<rect\b[^>]*>/) || [])[0];
      if (!rect) throw new Error(`区域 ${index} 的零件 ${c.id} 没有矩形`);
      return Number(attr(rect, 'y')) + Number(attr(rect, 'height'));
    });
    // 默认 pad 与 archify 默认值一致；显式 pad 更适合多层区域。
    const y = Number(attr(match, 'y'));
    const end = Math.max(...positions) + (boundary.pad ?? 24);
    bottom = Math.max(bottom, end);
    return match.replace(/height="[^"]*"/, `height="${end - y}"`)
      .replace(/data-composition-frame-id="\d+"/, `$& data-frame-members="${esc(boundary.wraps.join(' '))}"`);
  });
  // 有的外框原本被 viewBox 截平；只增加画布高度，不移动任何节点或边。
  return result.replace(/viewBox="([^"]+)"/, (match, value) => {
    const box = value.trim().split(/\s+/).map(Number);
    if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) throw new Error('整体图 viewBox 无效');
    box[3] = Math.max(box[3], bottom + 24 - box[1]);
    return `viewBox="${box.join(' ')}"`;
  });
}

/** SVG 的字号以画布单位定义。限制整体倍率，不单独缩字而破坏标题、badge 和命中区布局。 */
export function archWidth(svg, maxScale = 1) {
  if (typeof maxScale !== 'number' || !Number.isFinite(maxScale) || maxScale <= 0) {
    throw new Error('arch.maxScale 必须是正数（默认 1，不放大原画布）');
  }
  const value = attr(svg.match(/<svg\b[^>]*>/)?.[0] || '', 'viewBox');
  if (!value) throw new Error('arch SVG 缺少 viewBox');
  const box = value.trim().split(/\s+/).map(Number);
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[2] <= 0) throw new Error('arch SVG viewBox 无效');
  return Math.round(box[2] * maxScale * 10) / 10;
}

/** frames = [{id, boundary, parent?, label?, detail, kind, flat?}]；成员取自生成 SVG，不在 note 重抄。 */
export function applyArchFrames(svg, definitions = []) {
  if (!Array.isArray(definitions)) throw new Error('arch.frames 必须是区域数组');
  if (!definitions.length) return { svg, frames: [] };
  const bounds = new Map();
  for (const match of svg.matchAll(FRAME)) {
    const index = Number(attr(match[0], 'data-composition-frame-id'));
    const text = (match[0].match(/<text[^>]*>([\s\S]*?)<\/text>/) || [])[1];
    const members = attr(match[0], 'data-frame-members');
    if (!members) throw new Error('区域 SVG 缺少成员元数据，请重新运行 node tools/archify.mjs');
    bounds.set(index, {
      label: decode(text), members: decode(members).split(/\s+/),
      x: Number(attr(match[0], 'x')), y: Number(attr(match[0], 'y')),
      w: Number(attr(match[0], 'width')), h: Number(attr(match[0], 'height')),
    });
  }
  const ids = new Set(), indexes = new Set();
  const frames = definitions.map((f) => {
    if (!f || !/^[a-zA-Z][\w-]*$/.test(f.id) || ids.has(f.id)) throw new Error(`arch.frames id 无效或重复：${f?.id}`);
    if (!Number.isInteger(f.boundary) || indexes.has(f.boundary) || !bounds.has(f.boundary)) throw new Error(`区域 ${f.id} 的 boundary 不存在或重复`);
    if (!['contains', 'classification', 'shared', 'logical'].includes(f.kind)) throw new Error(`区域 ${f.id} 需要 kind: contains / classification / shared / logical`);
    if (typeof f.detail !== 'string' || !f.detail.trim()) throw new Error(`区域 ${f.id} 缺少 detail：每层框必须说明分组依据`);
    if (f.flat !== undefined && typeof f.flat !== 'boolean') throw new Error(`区域 ${f.id} 的 flat 必须是布尔值`);
    ids.add(f.id); indexes.add(f.boundary);
    const b = bounds.get(f.boundary);
    return { ...f, label: f.label || b.label, members: b.members };
  });
  const byId = new Map(frames.map((f) => [f.id, f]));
  const nodes = new Set([...svg.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]));
  for (const f of frames) {
    if (f.members.some((id) => !nodes.has(id))) throw new Error(`区域 ${f.id} 引用不存在的零件`);
    const seen = new Set([f.id]);
    let current = f;
    let depth = 1;
    while (current.parent) {
      const parent = byId.get(current.parent);
      if (!parent || seen.has(parent.id)) throw new Error(`区域 ${f.id} 的 parent 不存在或形成环`);
      seen.add(parent.id); depth++;
      if (current.members.some((id) => !parent.members.includes(id))) throw new Error(`区域 ${current.id} 的成员不完全属于父区域 ${parent.id}`);
      const a = bounds.get(parent.boundary), b = bounds.get(current.boundary);
      if (a.x >= b.x || a.y >= b.y || a.x + a.w <= b.x + b.w || a.y + a.h <= b.y + b.h) {
        throw new Error(`区域 ${parent.id} 没有完整包住 ${current.id}；增大父框 pad，不能让底边贴合或裁掉`);
      }
      // 标题保留独立带，不能靠把两层文字缩小或藏起来解决。
      if (b.y - a.y < 24) throw new Error(`区域 ${parent.id} / ${current.id} 标题间距不足 24px，请调整 pad`);
      current = parent;
    }
    f.depth = depth;
  }
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i], b = frames[j];
      if (a.parent !== b.parent) continue;
      const ra = bounds.get(a.boundary), rb = bounds.get(b.boundary);
      const intersects = Math.min(ra.x + ra.w, rb.x + rb.w) > Math.max(ra.x, rb.x)
        && Math.min(ra.y + ra.h, rb.y + rb.h) > Math.max(ra.y, rb.y);
      if (intersects) throw new Error(`同级区域 ${a.id} / ${b.id} 相交；共享引用不能冒充嵌套`);
    }
  }
  const wrapped = svg.replace(FRAME, (match) => {
    const f = frames.find((item) => item.boundary === Number(attr(match, 'data-composition-frame-id')));
    if (!f) return match;
    const frame = match.replace(/(<text[^>]*>)[\s\S]*?(<\/text>)/, `$1${esc(f.label)}$2`);
    return `<g class="arch-frame" data-frame="${esc(f.id)}" data-depth="${f.depth}" data-frame-flat="${f.flat ? 'true' : 'false'}" data-frame-kind="${f.kind}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(f.label)}"><title>${esc(f.detail)}</title>${frame}</g>`;
  });
  return { svg: wrapped, frames };
}
