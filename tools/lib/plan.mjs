/* ============================================================
   lib/plan.mjs — 读取「嵌套产物树」的计划文件
   ------------------------------------------------------------
   为什么要有这个：一篇笔记只讲一件事，但「先读哪篇」这件事
   不属于任何一篇。所以单独放一个 plans/<topic>.yaml 描述整棵树。

   它驱动两件事：
     · 首页的树视图（我在哪、下一步看什么、哪些还没写）
     · 每篇笔记顶部的「前置」区块（来自 needs）
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLANS = path.join(ROOT, 'plans');

/** 深度优先展开成数组，带上 depth / 自动编号 / 父节点 */
function flatten(nodes, depth = 1, parent = null, counter = { n: 0 }) {
  const out = [];
  for (const node of nodes || []) {
    const item = {
      ...node,
      depth,
      num: ++counter.n,
      parent,
      children: undefined,
    };
    out.push(item);
    out.push(...flatten(node.children, depth + 1, node.id, counter));
  }
  return out;
}

/** 读一个 plan 文件，返回 { topic, title, summary, source, nodes(扁平), raw(树), byId } */
export function readPlan(file) {
  const full = path.isAbsolute(file) ? file : path.join(PLANS, file);
  if (!fs.existsSync(full)) return null;

  const raw = YAML.parse(fs.readFileSync(full, 'utf8'));
  if (!raw?.topic) throw new Error(`${path.basename(full)} 缺少 topic 字段`);

  const nodes = flatten(raw.nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // needs 里引用不存在的节点 —— 这类错会静默让「前置」区块少一条，必须报出来
  for (const n of nodes) {
    for (const need of n.needs || []) {
      if (!byId.has(need)) {
        throw new Error(
          `plans/${path.basename(full)}: 节点「${n.id}」的 needs 引用了不存在的「${need}」`,
        );
      }
    }
  }

  return {
    topic: raw.topic,
    title: raw.title || raw.topic,
    summary: raw.summary || '',
    source: raw.source || '',
    nodes,
    tree: raw.nodes || [],
    byId,
    file: path.relative(ROOT, full),
  };
}

/**
 * 读 plans/ 下全部 plan 文件。
 * @returns {{ plans: Array, errors: string[] }}
 *   坏掉的 plan 不该静默跳过 —— 首页会少一整棵树，而没人发现。
 */
export function readAllPlans() {
  if (!fs.existsSync(PLANS)) return { plans: [], errors: [] };
  const plans = [];
  const errors = [];
  for (const f of fs.readdirSync(PLANS).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    try {
      plans.push(readPlan(f));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { plans, errors };
}

/**
 * 把笔记挂到树上。
 * @param {Array} plans  readAllPlans() 的结果
 * @param {Array} entries 笔记列表（每项含 slug / title / tree 字段）
 * @returns {{ attached: Map<slug, node>, orphan: Array }}
 */
export function attachNotes(plans, entries) {
  const byArtifact = new Map();
  for (const plan of plans) {
    for (const n of plan.nodes) {
      if (n.artifact) byArtifact.set(n.artifact, { plan, node: n });
    }
  }

  const attached = new Map();
  const orphan = [];
  for (const e of entries) {
    const hit = byArtifact.get(e.slug) ?? (e.tree?.id ? null : null);
    if (hit) attached.set(e.slug, hit);
    else orphan.push(e);
  }
  return { attached, orphan };
}

/**
 * 给一篇笔记生成「前置」区块的 HTML。
 * @param {object} plan  所属 plan
 * @param {string} nodeId 本节点 id
 * @param {Set<string>} existing  已产出的笔记 slug 集合
 *   —— artifact 在「计划要写」时就填好了，不能拿它判断有没有写出来，
 *      否则前置区块会给一个 404 的死链接
 */
export function needsHtml(plan, nodeId, existing = new Set()) {
  const node = plan.byId.get(nodeId);
  if (!node || !(node.needs || []).length) return '';

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const items = node.needs
    .map((id) => plan.byId.get(id))
    .filter(Boolean)
    .map((n) => {
      const label = `${n.num}. ${n.title}`;
      const body = n.blurb ? `<span>${esc(n.blurb)}</span>` : '';
      // 已产出的前置直接可点；还没写的就只显示，不做成死链接
      return n.artifact && existing.has(n.artifact)
        ? `<a class="need" href="../${esc(n.artifact)}/">← <b>${esc(label)}</b>${body}</a>`
        : `<span class="need is-planned">← <b>${esc(label)}</b>${body}<em>待产出</em></span>`;
    })
    .join('');

  return `<aside class="needs">
      <p class="needs-title">读这篇之前，你需要先知道</p>
      ${items}
    </aside>`;
}
