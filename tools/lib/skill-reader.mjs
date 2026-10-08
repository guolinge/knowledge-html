import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { slugify, blocksPlugin } from './blocks.mjs';

export const SKILL_DIR = '.agents/skills/knowledge-html';
export const CHUNK_BYTES = 16 * 1024;
export const CHUNK_LINES = 240;
export const OUTPUT_BYTES = 32 * 1024;
export const OUTPUT_LINES = 600;
const md = new MarkdownIt({ html: true }).use(blocksPlugin);

/** Keep source offsets and line endings; parsing must not treat YAML as headings. */
function withoutFrontmatter(source) {
  return source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (s) => s.replace(/[^\r\n]/g, ' '));
}

function plainTitle(tokens = []) {
  return tokens.map((t) => {
    if (t.type === 'text' || t.type === 'code_inline') return t.content;
    if (t.type === 'softbreak' || t.type === 'hardbreak') return ' ';
    if (t.children) return plainTitle(t.children);
    return '';
  }).join('').trim();
}

function normalizeQuery(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

/** Index only real, top-level Markdown headings, not examples inside fences/lists. */
export function indexMarkdown(source, file = 'SKILL.md') {
  const lineOffsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineOffsets.push(i + 1);
  const env = {};
  const tokens = md.parse(withoutFrontmatter(source), env);
  const headings = [];
  const stack = [];
  const seen = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) continue;
    const level = Number(token.tag.slice(1));
    const title = plainTitle(tokens[i + 1]?.children);
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const numbered = title.match(/^(\d+[a-z]?)\s*[·:：]\s*(.+)$/);
    const base = slugify(numbered ? numbered[2] : title);
    const countKey = level === 2 || level === 3 ? base : `${level}:${base}`;
    const count = (seen.get(countKey) || 0) + 1;
    seen.set(countKey, count);
    const heading = {
      level, title,
      id: (level === 2 || level === 3 ? '' : `h${level}-`) + (count > 1 ? `${base}-${count}` : base),
      startLine: token.map[0] + 1, startOffset: lineOffsets[token.map[0]],
      ancestors: [...stack],
    };
    heading.key = [...stack.filter((h) => h.level > 1).map((h) => h.title), title].join(' / ');
    headings.push(heading);
    stack.push(heading);
  }
  for (let i = 0; i < headings.length; i++) {
    const next = headings.slice(i + 1).find((h) => h.level <= headings[i].level);
    const heading = headings[i];
    heading.endOffset = next ? next.startOffset : source.length;
    heading.endLine = source.slice(0, heading.endOffset).split('\n').length -
      (source[heading.endOffset - 1] === '\n' ? 1 : 0);
  }

  const notes = [];
  for (const token of tokens) {
    if (token.type !== 'blockquote_open' || token.level !== 0 || !token.map) continue;
    const raw = source.slice(lineOffsets[token.map[0]], lineOffsets[token.map[1]] ?? source.length);
    const text = raw.replace(/^ {0,3}> ?/gm, '').trim();
    if (!/^(执行前读取|按任务读取)：/.test(text)) continue;
    const owner = headings.filter((h) => h.startLine <= token.map[0] + 1).at(-1);
    for (const match of text.matchAll(/(?:^|\n)(执行前读取|按任务读取)：([\s\S]*?)(?=\n(?:执行前读取|按任务读取)：|$)/g)) {
      const links = [];
      const children = md.parseInline(match[2], env)[0].children || [];
      for (let i = 0; i < children.length; i++) {
        if (children[i].type !== 'link_open') continue;
        const href = children[i].attrGet('href');
        const labelTokens = [];
        while (++i < children.length && children[i].type !== 'link_close') labelTokens.push(children[i]);
        links.push({ href, label: plainTitle(labelTokens) });
      }
      const prefix = text.slice(0, match.index + (match[0].startsWith('\n') ? 1 : 0));
      const line = token.map[0] + 1 + (prefix.match(/\n/g) || []).length;
      notes.push({ owner, line, kind: match[1] === '执行前读取' ? 'required' : 'conditional', text: match[2].trim(), links });
    }
  }
  const lineCount = Math.max(1, lineOffsets.length - (source.endsWith('\n') ? 1 : 0));
  return { source, file, lineOffsets, lineCount, headings, notes, revision: createHash('sha256').update(source).digest('hex') };
}

export function findSection(document, query) {
  const wanted = normalizeQuery(query);
  const byTitle = wanted.startsWith('#') ? [] :
    document.headings.filter((h) => normalizeQuery(h.title) === wanted || normalizeQuery(h.key) === wanted);
  if (byTitle.length > 1) {
    throw new Error(`章节名不唯一：${wanted}\n${byTitle.map((h) => `  L${h.startLine}: ${h.key} (#${h.id})`).join('\n')}\n用完整层级标题或 #锚点选择，不猜其中一节。`);
  }
  if (byTitle.length === 1) return byTitle[0];
  const id = wanted.startsWith('#') ? decodeURIComponent(wanted.slice(1)) : wanted;
  const byId = document.headings.filter((h) => h.id === id);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) throw new Error(`锚点不唯一：${id}。用完整层级标题选择。`);
  throw new Error(`找不到章节：${wanted || '（空）'}。先用 list 查看当前标题，不按模糊词匹配正文。`);
}

export function selectContent(document, mode, target = '') {
  if (mode === 'list') {
    const content = document.headings.map((h) => `L${h.startLine}-${h.endLine}  H${h.level}  ${h.key}  [#${h.id}]\n`).join('');
    return { mode, target: '', label: '章节索引（不是正文）', content, startOffset: null, heading: null };
  }
  if (mode === 'all') return { mode, target: '', label: '文件全文', content: document.source, startOffset: 0, heading: null };
  if (mode === 'principles') {
    const principles = document.headings.filter((h) => h.level === 2 && /^原则\s+/.test(h.title));
    if (!principles.length) throw new Error('当前文件没有原则章节。');
    const startOffset = principles[0].startOffset;
    const endOffset = principles.at(-1).endOffset;
    return { mode, target: '', label: '全部原则', content: document.source.slice(startOffset, endOffset), startOffset, heading: null };
  }
  let heading;
  if (mode === 'step') {
    if (!/^\d+$/.test(String(target))) throw new Error('step 需要非负整数步骤号。');
    const matches = document.headings.filter((h) => h.level === 3 && h.title.match(/^第 (\d+) 步/)?.[1] === String(Number(target)));
    if (matches.length !== 1) throw new Error(`步骤 ${target} 不存在或不唯一。用 list 核对当前工作流。`);
    heading = matches[0];
  } else if (mode === 'section') heading = findSection(document, target);
  else throw new Error(`未知读取方式：${mode}`);
  return { mode, target: mode === 'step' ? String(Number(target)) : target, label: heading.title,
    content: document.source.slice(heading.startOffset, heading.endOffset), startOffset: heading.startOffset, heading };
}

/** Split by natural lines, or by Unicode code point for an oversized single line. */
export function splitContent(content, { maxBytes = CHUNK_BYTES, maxLines = CHUNK_LINES, json = false } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4 || !Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error('分块大小至少 4 字节、1 行，且为整数。');
  }
  const chunks = [];
  let start = 0, end = 0, bytes = 0, lines = 0;
  const flush = () => {
    if (end > start) chunks.push({ content: content.slice(start, end), startOffset: start, endOffset: end });
    start = end; bytes = 0; lines = 0;
  };
  const sizeOf = json ? (s) => Buffer.byteLength(JSON.stringify(s)) - 2 : (s) => Buffer.byteLength(s);
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const length = sizeOf(line);
    if (length <= maxBytes) {
      if (bytes + length > maxBytes || lines >= maxLines) flush();
      end += line.length; bytes += length; lines++;
    } else {
      flush();
      for (const point of line) {
        const size = sizeOf(point);
        if (size > maxBytes) throw new Error('单个字符的编码超过分块上限。');
        if (bytes + size > maxBytes) flush();
        end += point.length; bytes += size;
      }
      flush();
    }
  }
  flush();
  return chunks.length ? chunks : [{ content: '', startOffset: 0, endOffset: 0 }];
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Read only Markdown under this repository; resolve symlinks before containment. */
export function loadDocument(root, file = 'SKILL.md') {
  const repo = fs.realpathSync(root);
  const candidate = file === 'SKILL.md' || file.startsWith('references/')
    ? path.resolve(repo, SKILL_DIR, file) : path.resolve(repo, file);
  if (!inside(repo, candidate) || path.extname(candidate).toLowerCase() !== '.md') throw new Error(`文件必须是当前仓库内的 Markdown：${file}`);
  const full = fs.realpathSync(candidate);
  if (!inside(repo, full)) throw new Error(`文件软链指向当前仓库之外：${file}`);
  const relative = path.relative(repo, full).split(path.sep).join('/');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(full)); }
  catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw new Error(`文件不是有效 UTF-8：${file}`);
    throw error;
  }
  const document = indexMarkdown(source, relative);
  const skillRelative = relative.startsWith(`${SKILL_DIR}/`) ? relative.slice(SKILL_DIR.length + 1) : null;
  document.optionFile = skillRelative === 'SKILL.md' || skillRelative?.startsWith('references/') ? skillRelative : relative;
  return document;
}

export function readingNotes(document, selection) {
  if (!selection.heading) return [];
  const owners = new Set([...selection.heading.ancestors, selection.heading]);
  return document.notes.filter((note) => owners.has(note.owner) ||
    (note.owner?.startOffset >= selection.heading.startOffset && note.owner?.startOffset < selection.heading.endOffset));
}

export function resolveReadingLinks(root, document, notes) {
  const resources = new Map();
  for (const note of notes) {
    if (!note.links.length) throw new Error(`${document.file}:L${note.line} 读取提示没有章节链接。`);
    for (const link of note.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.href)) {
        throw new Error(`${document.file}:L${note.line} 读取提示只接受本地 Markdown/章节链接：${link.href}`);
      }
      const hashAt = link.href.indexOf('#');
      const filePart = decodeURIComponent(hashAt >= 0 ? link.href.slice(0, hashAt) : link.href);
      const anchor = hashAt >= 0 ? link.href.slice(hashAt + 1) : '';
      let target = document;
      if (filePart) {
        const fromFile = path.resolve(root, path.dirname(document.file), filePart);
        const repoFile = path.resolve(root, filePart);
        const full = fs.existsSync(fromFile) ? fromFile : repoFile;
        target = loadDocument(root, path.relative(root, full));
      }
      const heading = anchor ? findSection(target, `#${anchor}`) : null;
      const key = `${target.file}:${heading?.startOffset ?? 'all'}`;
      const existing = resources.get(key);
      if (existing) {
        if (note.kind === 'required') existing.kind = 'required';
        continue;
      }
      const selector = heading && target.headings.filter((h) => h.key === heading.key).length > 1
        ? `#${heading.id}` : heading?.key || '';
      resources.set(key, { kind: note.kind, label: link.label || heading?.title || target.optionFile,
        file: target.file, optionFile: target.optionFile, sourceRevision: target.revision, mode: heading ? 'section' : 'all',
        target: selector, startLine: heading?.startLine || 1, endLine: heading?.endLine || target.lineCount,
        from: note.owner?.title || '', hintLine: note.line });
    }
  }
  return [...resources.values()];
}

/** Validate navigation at check time; links are the policy source, not a second map. */
export function validateReadingNavigation(root, document, { requireStepHints = true } = {}) {
  const errors = [];
  if (requireStepHints) {
    for (const step of document.headings.filter((h) => h.level === 3 && /^第 \d+ 步/.test(h.title))) {
      if (!document.notes.some((note) => note.owner === step && note.kind === 'required')) {
        errors.push(`${document.file}:L${step.startLine} ${step.title} 缺少执行前读取提示。`);
      }
    }
  }
  for (const note of document.notes) {
    try { resolveReadingLinks(root, document, [note]); }
    catch (error) { errors.push(error.message); }
  }
  return errors;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function readCommand({ mode, target = '', file = 'SKILL.md', part, revision, json = false }) {
  const args = [];
  if (file !== 'SKILL.md') args.push('--file', shellQuote(file));
  args.push(mode);
  if (mode === 'step') args.push(target);
  else if (mode === 'section' && !String(target).startsWith('-')) args.push(shellQuote(target));
  if (part) args.push('--part', String(part));
  if (revision) args.push('--revision', revision);
  if (json) args.push('--json');
  if (mode === 'section' && String(target).startsWith('-')) args.push('--', shellQuote(target));
  return `npm run --silent skill-read -- ${args.join(' ')}`;
}

export function createReadResult(root, { mode, target = '', file = 'SKILL.md', part = 1, revision, json = false }) {
  const document = loadDocument(root, file);
  const selection = selectContent(document, mode, target);
  const resources = resolveReadingLinks(root, document, readingNotes(document, selection)).map((resource) => ({
    ...resource, command: readCommand({ mode: resource.mode, target: resource.target, file: resource.optionFile }),
  }));
  const readingHints = readingNotes(document, selection).map((note) => ({ kind: note.kind, text: note.text, from: note.owner?.title || '', line: note.line }));
  const readingRevision = createHash('sha256').update(JSON.stringify({
    sourceRevision: document.revision, mode, target: selection.target, json, resources, readingHints,
  })).digest('hex');
  if (revision && readingRevision !== revision) {
    throw new Error('源文件、关联导航或输出模式已变化，不能沿旧版本续读。重新读取第一块并核对范围。');
  }
  const metadata = {
    file: document.file, sourceRevision: document.revision, revision: readingRevision,
    mode, target: selection.target, title: selection.label, readingHints, requiredReads: resources,
  };
  // Reserve space for all navigation and worst-case range/continuation numbers.
  // Do not hide required links or rely on the host tool truncating the output.
  const maxNumber = Number.MAX_SAFE_INTEGER;
  const overhead = formatReadResult({
    ...metadata, part: maxNumber, totalParts: maxNumber, complete: false, content: '',
    range: { startLine: maxNumber, endLine: maxNumber, startOffset: maxNumber, endOffset: maxNumber,
      startByte: maxNumber, endByte: maxNumber },
    nextCommand: readCommand({ mode, target: selection.target, file: document.optionFile,
      part: maxNumber, revision: readingRevision, json }),
  }, json);
  const maxBytes = Math.min(CHUNK_BYTES, OUTPUT_BYTES - Buffer.byteLength(overhead) - 1024);
  const maxLines = Math.min(CHUNK_LINES, OUTPUT_LINES - overhead.split('\n').length - 20);
  if (maxBytes < 4 || maxLines < 1) throw new Error('读取导航自身超过安全预算，未输出正文。请缩小目标章节，不删除必读内容来绕过。');
  const chunks = splitContent(selection.content, { maxBytes, maxLines, json });
  if (!Number.isSafeInteger(part) || part < 1 || part > chunks.length) throw new Error(`分块 ${part} 不存在，当前共 ${chunks.length} 块。`);
  if (part > 1 && !revision) throw new Error('续读必须带读取版本。请执行第一块输出的下一条命令，不单独指定 --part。');
  const chunk = chunks[part - 1];
  const start = selection.startOffset === null ? null : selection.startOffset + chunk.startOffset;
  const end = start === null ? null : selection.startOffset + chunk.endOffset;
  const startLine = start === null ? null : document.source.slice(0, start).split('\n').length;
  const endLine = end === null ? null : Math.max(startLine,
    document.source.slice(0, end).split('\n').length - (document.source[end - 1] === '\n' ? 1 : 0));
  return {
    ...metadata,
    part, totalParts: chunks.length, complete: part === chunks.length,
    range: { startLine, endLine, startOffset: start, endOffset: end,
      startByte: start === null ? null : Buffer.byteLength(document.source.slice(0, start)),
      endByte: end === null ? null : Buffer.byteLength(document.source.slice(0, end)) },
    content: chunk.content,
    nextCommand: part < chunks.length ? readCommand({ mode, target: selection.target, file: document.optionFile,
      part: part + 1, revision: readingRevision, json }) : null,
  };
}

export function formatReadResult(result, json = false) {
  if (json) return JSON.stringify(result, null, 2) + '\n';
  const related = result.requiredReads.map((r) => `${r.kind === 'required' ? '必读' : '按任务'}：${r.label} (${r.optionFile}:L${r.startLine}-${r.endLine})\n  ${r.command}`).join('\n');
  const conditions = [...new Set(result.readingHints.filter((hint) => hint.kind === 'conditional').map((hint) => hint.text))];
  const range = result.range.startLine === null ? '生成的章节索引' :
    `L${result.range.startLine}-${result.range.endLine}; UTF-8 字节 [${result.range.startByte}, ${result.range.endByte})`;
  return `文件：${result.file}\n章节：${result.title}\n源文件 SHA256：${result.sourceRevision}\n读取版本 SHA256：${result.revision}\n范围：${range}\n分块：${result.part}/${result.totalParts}（只输出当前原文块，不代表全文已读）\n` +
    (related ? `相关读取入口（未输出这些章节；按任务项须判断条件）：\n${related}\n` : '') +
    (conditions.length ? `按任务读取的原始条件：\n${conditions.map((text) => `  ${text}`).join('\n')}\n` : '') +
    `--- 原文开始 ---\n${result.content}${result.content.endsWith('\n') ? '' : '\n'}--- 原文结束 ---\n` +
    (result.nextCommand ? `尚未输出完。下一块：\n${result.nextCommand}\n` : '当前目标已全部输出；只有此前各块都读取后才算内容完整，不表示理解或验收通过。\n');
}

export function assertOutputBounded(output) {
  if (Buffer.byteLength(output) > OUTPUT_BYTES || output.split('\n').length > OUTPUT_LINES) {
    throw new Error('输出超过安全上限（32KiB / 600行），没有输出正文。请缩小章节或检查读取提示；不能静默截断。');
  }
}
