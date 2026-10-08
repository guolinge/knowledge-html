import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  SKILL_DIR, OUTPUT_BYTES, OUTPUT_LINES,
  indexMarkdown, findSection, selectContent, splitContent, loadDocument,
  readingNotes, resolveReadingLinks, validateReadingNavigation, readCommand,
  createReadResult, formatReadResult, assertOutputBounded,
} from '../lib/skill-reader.mjs';
import { parseArguments } from '../skill-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'tools/skill-read.mjs');

function fixture(t, source, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-read-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skill = path.join(root, SKILL_DIR, 'SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, source);
  for (const [file, content] of Object.entries(extra)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const SAMPLE = `---
name: sample
description: test
---
# 文档
## 工作流
### 第 0 步 · 确认范围
> 执行前读取：[细节](#细节)。
> 按任务读取：需要数据时读[例子](#例子)。

正文。
### 第 1 步 · 写作
> 执行前读取：[细节](#细节)、[参考](references/blocks.md#参考)。

#### 提交
> 执行前读取：[例子](#例子)。

提交动作。
## 细节
不会被当作摘要。
## 例子
真实原文。
`;

test('index ignores frontmatter, fenced examples, HTML comments and nested headings', () => {
  const source = `---\nname: sample\ndescription: '# fake'\n---\n# 文档\n<!--\n## 注释假标题\n-->\n## **真实**标题\n\n\`\`\`\`text\n## 围栏假标题\n\`\`\`\n### 还在围栏\n\`\`\`\`\n\n~~~text\n## 波浪围栏\n~~~\n\n> ## 引用里的标题\n\n- 项目\n\n  ### 列表中的标题\n\n下一节\n------\n\n#### 小节 \`a == b\`\n正文`;
  const doc = indexMarkdown(source);
  assert.deepEqual(doc.headings.map(h => h.title), ['文档', '真实标题', '下一节', '小节 a == b']);
  assert.equal(doc.headings.at(-1).key, '下一节 / 小节 a == b');
  assert.equal(doc.headings.at(-1).endOffset, source.length);
  assert.equal(selectContent(doc, 'section', '下一节').content, source.slice(source.indexOf('下一节\n')));
});

test('raw source range preserves CRLF, code and a missing trailing newline', () => {
  const source = '# 文档\r\n## 细节\r\n中文😀\r\n```js\r\nconst x = "\\n";\r\n```\r\n## 结束\r\n最后';
  const doc = indexMarkdown(source);
  const selected = selectContent(doc, 'section', '细节');
  assert.equal(selected.content, '## 细节\r\n中文😀\r\n```js\r\nconst x = "\\n";\r\n```\r\n');
  assert.equal(selected.heading.startLine, 2);
  assert.equal(selected.heading.endLine, 6);
  assert.equal(selectContent(doc, 'all').content, source);
});

test('exact title or full hierarchy selects duplicate sections without guessing', () => {
  const doc = indexMarkdown('# 文档\n## A\n### 相同\n一\n## B\n### 相同\n二\n');
  assert.throws(() => findSection(doc, '相同'), /章节名不唯一/);
  assert.equal(findSection(doc, 'A / 相同').startLine, 3);
  assert.equal(findSection(doc, 'B / 相同').startLine, 6);
  assert.equal(findSection(doc, '#相同-2').startLine, 6);
  assert.throws(() => findSection(doc, 'A相'), /找不到章节/);
});

test('heading IDs and inline titles support numbered and marked Chinese titles', () => {
  const doc = indexMarkdown('## 01 · **内容**\n一\n### 内容\n二\n## 表格 \`compare\`\n三\n');
  assert.equal(findSection(doc, '#内容').title, '01 · 内容');
  assert.equal(findSection(doc, '#内容-2').title, '内容');
  assert.equal(findSection(doc, '表格 compare').title, '表格 compare');
});

test('step selection includes every sub-check and stops at the next peer', () => {
  const doc = indexMarkdown(SAMPLE);
  const step = selectContent(doc, 'step', '01');
  assert.equal(step.target, '1');
  assert(step.content.includes('#### 提交'));
  assert(!step.content.includes('\n## 细节'));
  assert.throws(() => selectContent(doc, 'step', '2'), /不存在或不唯一/);
  assert.throws(() => selectContent(doc, 'step', '-1'), /非负整数/);
});

test('principles selection is verbatim and excludes the workflow', () => {
  const source = '# 文档\n## 原则 ① · A\n一\n## 原则 ② · B\n二\n## 工作流\n三\n';
  const selected = selectContent(indexMarkdown(source), 'principles');
  assert.equal(selected.content, '## 原则 ① · A\n一\n## 原则 ② · B\n二\n');
  assert.throws(() => selectContent(indexMarkdown('## A\n一'), 'principles'), /没有原则章节/);
});

test('chunks preserve every Unicode code point, blank line and line ending', () => {
  const source = ('中文😀\\"\r\n\n'.repeat(900)) + '长行'.repeat(5000) + '\0\t末尾';
  for (const json of [false, true]) {
    const chunks = splitContent(source, { maxBytes: 128, maxLines: 7, json });
    assert.equal(chunks.map(c => c.content).join(''), source);
    for (const c of chunks) {
      const size = json ? Buffer.byteLength(JSON.stringify(c.content)) - 2 : Buffer.byteLength(c.content);
      assert(size <= 128);
      assert(c.content.split('\n').length - (c.content.endsWith('\n') ? 1 : 0) <= 7);
      assert.equal(Buffer.from(c.content).toString('utf8'), c.content);
      assert.equal(source.slice(c.startOffset, c.endOffset), c.content);
    }
  }
});

test('empty content and invalid chunk limits have explicit behavior', () => {
  assert.deepEqual(splitContent(''), [{ content: '', startOffset: 0, endOffset: 0 }]);
  assert.throws(() => splitContent('x', { maxBytes: 0 }), /分块大小/);
  assert.throws(() => splitContent('x', { maxLines: 0 }), /分块大小/);
  assert.throws(() => splitContent('\0', { maxBytes: 4, json: true }), /单个字符/);
});

test('combined reading hints retain required/conditional scope and descendant requirements', (t) => {
  const root = fixture(t, SAMPLE, { [`${SKILL_DIR}/references/blocks.md`]: '# 参考\n## 参考\n用法\n' });
  const doc = loadDocument(root);
  const step0 = selectContent(doc, 'step', '0');
  const notes0 = readingNotes(doc, step0);
  assert.deepEqual(notes0.map(n => n.kind), ['required', 'conditional']);
  assert.equal(notes0[1].line, notes0[0].line + 1);
  const reads0 = resolveReadingLinks(root, doc, notes0);
  assert.equal(reads0.find(r => r.label === '细节').kind, 'required');
  assert.equal(reads0.find(r => r.label === '例子').kind, 'conditional');
  assert.match(formatReadResult(createReadResult(root, { mode: 'step', target: '0' })), /需要数据时读/);
  const result1 = createReadResult(root, { mode: 'step', target: '1' });
  assert.deepEqual(result1.requiredReads.map(r => r.label), ['细节', '参考', '例子']);
  assert(result1.requiredReads.every(r => r.kind === 'required'));
  assert.equal(result1.requiredReads.find(r => r.label === '参考').optionFile, 'references/blocks.md');
  assert.deepEqual(validateReadingNavigation(root, doc), []);
});

test('reference-style reading links resolve against Markdown document definitions', (t) => {
  const source = '## 工作流\n### 第 0 步 · 开始\n> 执行前读取：[基础][base]。\n\n## 基础\n重要内容\n\n[base]: #基础\n';
  const root = fixture(t, source);
  const result = createReadResult(root, { mode: 'step', target: '0' });
  assert.equal(result.requiredReads.length, 1);
  assert.equal(result.requiredReads[0].target, '基础');
  assert.deepEqual(validateReadingNavigation(root, loadDocument(root)), []);
});

test('ancestor reading hints also apply when a nested review is selected', (t) => {
  const source = '## 工作流\n> 执行前读取：[基础](#基础)。\n\n### 第 8 步 · 检查\n> 执行前读取：[基础](#基础)。\n\n#### 子项\n检查正文。\n## 基础\n原文\n';
  const root = fixture(t, source);
  const result = createReadResult(root, { mode: 'section', target: '工作流 / 第 8 步 · 检查 / 子项' });
  assert.equal(result.requiredReads.length, 1);
  assert.equal(result.requiredReads[0].label, '基础');
  assert.equal(result.readingHints.length, 2);
});

test('missing hints, empty notes, external links and broken anchors fail navigation validation', (t) => {
  for (const body of [
    '### 第 0 步 · 开始\n正文\n',
    '### 第 0 步 · 开始\n> 执行前读取：无链接。\n',
    '### 第 0 步 · 开始\n> 执行前读取：[坏](#不存在)。\n',
    '### 第 0 步 · 开始\n> 执行前读取：[外](https://example.com)。\n',
  ]) {
    const root = fixture(t, `# 文档\n## 工作流\n${body}`);
    assert(validateReadingNavigation(root, loadDocument(root)).length > 0);
  }
});

test('hint-looking text in code or ordinary quotes is not a reading requirement', () => {
  const source = '## 工作流\n### 第 0 步 · 开始\n```text\n> 执行前读取：[假](#不存在)。\n```\n\n> 用户说：\n> 执行前读取：[也不是导航](#不存在)。\n\n正文。\n';
  const doc = indexMarkdown(source);
  assert.equal(doc.notes.length, 0);
});

test('same-parent duplicate headings stay distinct when linked by suffixed IDs', (t) => {
  const source = '## 工作流\n### 第 0 步 · 开始\n> 执行前读取：[一](#相同)、[二](#相同-2)。\n\n## 相同\n一\n## 相同\n二\n';
  const root = fixture(t, source);
  const result = createReadResult(root, { mode: 'step', target: '0' });
  assert.equal(result.requiredReads.length, 2);
  assert.equal(result.requiredReads[0].target, '#相同');
  assert.equal(result.requiredReads[1].target, '#相同-2');
  assert(result.requiredReads[1].command.includes("'#相同-2'"));
  assert.deepEqual(validateReadingNavigation(root, loadDocument(root)), []);
});

test('source lines are recalculated after edits and stale continuation is rejected', (t) => {
  const root = fixture(t, '# 文档\n## 长节\n' + '数据😀\n'.repeat(1000) + '## 尾节\n尾\n');
  const first = createReadResult(root, { mode: 'section', target: '长节', json: true });
  assert(first.nextCommand.includes(`--revision ${first.revision}`));
  assert(first.nextCommand.endsWith('--json'));
  const second = createReadResult(root, { mode: 'section', target: '长节', part: 2, revision: first.revision, json: true });
  assert.equal(first.range.endOffset, second.range.startOffset);
  assert.equal(first.range.endByte, second.range.startByte);
  assert.throws(() => createReadResult(root, { mode: 'section', target: '长节', part: 2, json: true }), /续读必须带读取版本/);
  const full = path.join(root, SKILL_DIR, 'SKILL.md');
  fs.writeFileSync(full, '\n\n' + fs.readFileSync(full, 'utf8'));
  assert.throws(() => createReadResult(root, { mode: 'section', target: '长节', part: 2, revision: first.revision }), /源文件、关联导航或输出模式已变化/);
  assert.equal(createReadResult(root, { mode: 'section', target: '长节' }).range.startLine, first.range.startLine + 2);
  assert.throws(() => createReadResult(root, { mode: 'section', target: '长节', part: 9999 }), /分块 9999 不存在/);
});

test('continuation also rejects changed linked documents and output mode', (t) => {
  const source = '## 工作流\n### 第 8 步 · 检查\n> 执行前读取：[参考](references/blocks.md#参考)。\n\n' + '检查内容\n'.repeat(800);
  const root = fixture(t, source, { [`${SKILL_DIR}/references/blocks.md`]: '## 参考\n旧内容\n' });
  const first = createReadResult(root, { mode: 'step', target: '8', json: true });
  assert(first.totalParts > 1);
  assert.throws(() => createReadResult(root, { mode: 'step', target: '8', part: 2, revision: first.revision }), /输出模式已变化/);
  fs.writeFileSync(path.join(root, SKILL_DIR, 'references/blocks.md'), '## 参考\n新版补充\n');
  assert.throws(() => createReadResult(root, { mode: 'step', target: '8', part: 2, revision: first.revision, json: true }), /关联导航/);
});

test('empty files report a valid empty range and are not confused with failures', (t) => {
  const root = fixture(t, '');
  const result = createReadResult(root, { mode: 'all' });
  assert.equal(result.content, '');
  assert.equal(result.range.startLine, 1);
  assert.equal(result.range.endLine, 1);
  assert.equal(result.range.startByte, 0);
  assert.equal(result.range.endByte, 0);
  assert.equal(result.complete, true);
  assertOutputBounded(formatReadResult(result));
});

test('file reads are repository-contained, including symlink targets', (t) => {
  const root = fixture(t, '# 文档\n正文\n', {
    [`${SKILL_DIR}/references/blocks.md`]: '# 参考\n内容\n',
    'notes/example/note.md': '# 笔记\n例子\n',
    [`${SKILL_DIR}/guide.md`]: '# 额外文档\n内容\n',
    'not-markdown.txt': 'text',
  });
  assert.equal(loadDocument(root, 'references/blocks.md').optionFile, 'references/blocks.md');
  assert.equal(loadDocument(root, 'notes/example/note.md').optionFile, 'notes/example/note.md');
  assert.equal(loadDocument(root, `${SKILL_DIR}/guide.md`).optionFile, `${SKILL_DIR}/guide.md`);
  assert.throws(() => loadDocument(root, '../outside.md'), /仓库内/);
  assert.throws(() => loadDocument(root, 'not-markdown.txt'), /Markdown/);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-read-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'outside.md'), '# outside');
  fs.symlinkSync(path.join(external, 'outside.md'), path.join(root, 'external.md'));
  assert.throws(() => loadDocument(root, 'external.md'), /软链指向/);
});

test('UTF-8 source including a BOM is preserved; malformed byte sequences are rejected', (t) => {
  const source = '\uFEFF---\r\nname: sample\r\ndescription: test\r\n---\r\n# 文档\r\n## 章节\r\n中文😀';
  const root = fixture(t, source, { 'bad.md': Buffer.from([0xc3, 0x28]) });
  const doc = loadDocument(root);
  assert.equal(doc.source, source);
  assert.deepEqual(doc.headings.map(h => h.title), ['文档', '章节']);
  assert.throws(() => loadDocument(root, 'bad.md'), /不是有效 UTF-8/);
  const result = createReadResult(root, { mode: 'all', json: true });
  assert.equal(JSON.parse(formatReadResult(result, true)).content, source);
});

test('oversized navigation fails explicitly without discarding required instructions', (t) => {
  const source = '## 工作流\n### 第 0 步 · 开始\n> 执行前读取：[' + '长标签'.repeat(7000) + '](#细节)。\n\n## 细节\n重要内容\n';
  const root = fixture(t, source);
  assert.throws(() => createReadResult(root, { mode: 'step', target: '0', json: true }), /导航自身超过安全预算/);
});

test('plain and JSON output stay bounded; completion claims only an output range', (t) => {
  const root = fixture(t, '# 文档\n## 大节\n' + ('"\\\0\t中文😀\n'.repeat(3000)));
  for (const json of [false, true]) {
    const first = createReadResult(root, { mode: 'all', json });
    let recovered = '';
    for (let part = 1; part <= first.totalParts; part++) {
      const result = createReadResult(root, { mode: 'all', part, revision: first.revision, json });
      const output = formatReadResult(result, json);
      assertOutputBounded(output);
      assert(Buffer.byteLength(output) <= OUTPUT_BYTES);
      assert(output.split('\n').length <= OUTPUT_LINES);
      recovered += json ? JSON.parse(output).content : result.content;
      assert.equal(result.complete, part === first.totalParts);
      assert.equal(result.nextCommand === null, result.complete);
    }
    assert.equal(recovered, loadDocument(root).source);
    if (!json) assert.match(formatReadResult(first), /不代表全文已读/);
  }
  assert.throws(() => assertOutputBounded('x'.repeat(OUTPUT_BYTES + 1)), /没有输出正文/);
  assert.throws(() => assertOutputBounded('\n'.repeat(OUTPUT_LINES + 1)), /没有输出正文/);
});

test('list is an independently paginated index, not selected body text', () => {
  const doc = indexMarkdown('## A\n正文A\n## B\n正文B');
  const selected = selectContent(doc, 'list');
  assert(selected.content.includes('L1-2'));
  assert(selected.content.includes('L3-4'));
  assert(!selected.content.includes('正文'));
  assert.equal(selected.startOffset, null);
});

test('CLI arguments reject malformed values rather than silently ignoring them', () => {
  assert.equal(parseArguments(['step', '8', '--part', '2', '--json']).part, 2);
  assert.equal(parseArguments(['section', '资料查证']).target, '资料查证');
  assert.equal(parseArguments(['--file', 'references/blocks.md', 'all']).file, 'references/blocks.md');
  assert.equal(parseArguments(['section', '--', '-title']).target, '-title');
  for (const args of [[], ['step'], ['step', '-1'], ['step', '1.2'], ['step', '9007199254740992'], ['section'],
    ['all', 'extra'], ['list', '--part', '0'], ['all', '--file'], ['all', '--json', '--json'],
    ['all', '--unknown'], ['all', '--revision', 'bad']]) {
    assert.throws(() => parseArguments(args), Error, JSON.stringify(args));
  }
});

test('generated commands quote shell-sensitive titles and preserve continuation format', () => {
  const command = readCommand({ mode: 'section', target: "foo'; echo unsafe", file: 'references/blocks.md', part: 2, revision: 'a'.repeat(64), json: true });
  assert(command.includes("'foo'\\''; echo unsafe'"));
  assert(command.includes("--file 'references/blocks.md'"));
  assert(command.endsWith('--json'));
  const dashCommand = readCommand({ mode: 'section', target: '-title', part: 2, revision: 'a'.repeat(64), json: true });
  assert.match(dashCommand, /--part 2 --revision a+ --json -- '-title'$/);
});

test('live skill navigation and every selected raw range remain complete and bounded', () => {
  const doc = loadDocument(ROOT);
  assert.deepEqual(validateReadingNavigation(ROOT, doc), []);
  const modeTargets = [
    ['list', ''], ['all', ''], ['principles', ''],
    ...Array.from({ length: 10 }, (_, i) => ['step', String(i)]),
    ...doc.headings.filter(h => h.level === 2).map(h => ['section', h.key]),
  ];
  for (const [mode, target] of modeTargets) {
    for (const json of [false, true]) {
      const first = createReadResult(ROOT, { mode, target, json });
      const recovered = [];
      for (let part = 1; part <= first.totalParts; part++) {
        const result = createReadResult(ROOT, { mode, target, part, revision: first.revision, json });
        const output = formatReadResult(result, json);
        assertOutputBounded(output);
        recovered.push(json ? JSON.parse(output).content : result.content);
        if (mode !== 'list') {
          assert.equal(doc.source.slice(result.range.startOffset, result.range.endOffset), result.content);
          assert.equal(Buffer.from(doc.source).subarray(result.range.startByte, result.range.endByte).toString(), result.content);
        }
      }
      assert.equal(recovered.join(''), selectContent(doc, mode, target).content);
    }
  }
  for (const file of ['references/blocks.md', 'references/extend.md', 'notes/blocks-cheatsheet/note.md']) {
    const source = loadDocument(ROOT, file).source;
    for (const json of [false, true]) {
      const first = createReadResult(ROOT, { mode: 'all', file, json });
      const contents = [];
      for (let part = 1; part <= first.totalParts; part++) {
        const result = createReadResult(ROOT, { mode: 'all', file, part, revision: first.revision, json });
        assertOutputBounded(formatReadResult(result, json));
        contents.push(result.content);
      }
      assert.equal(contents.join(''), source);
    }
  }
  const step0 = createReadResult(ROOT, { mode: 'step', target: '0' });
  assert.equal(step0.requiredReads.filter(r => /^原则/.test(r.label)).length, 7);
  const step6 = createReadResult(ROOT, { mode: 'step', target: '6' });
  assert(step6.requiredReads.some(r => r.kind === 'required' && r.target === '笔记元信息'));
  assert(step6.requiredReads.some(r => r.kind === 'required' && r.target === '硬约束'));
  assert(step6.requiredReads.some(r => r.kind === 'conditional' && r.optionFile === 'references/blocks.md'));
  const step8 = selectContent(doc, 'step', '8').content;
  assert.equal([...step8.matchAll(/^#### 复盘 /gm)].length, 10);
  const parts8 = createReadResult(ROOT, { mode: 'step', target: '8' });
  assert(parts8.totalParts > 1, 'Long acceptance checks must paginate, not disappear');
});

test('step 4 requires source verification before relation modeling and tool validation', () => {
  const result = createReadResult(ROOT, { mode: 'step', target: '4' });
  assert.equal(result.title, '第 4 步 · 核实事实与关系，再确定画法');
  const evidence = result.requiredReads.find(r => r.target === '资料查证');
  assert(evidence, 'Source verification must remain reachable from step 4');
  assert.equal(evidence.kind, 'required', 'Source verification is not an optional add-information hint');
  const source = selectContent(loadDocument(ROOT), 'step', '4').content;
  const stages = [
    '#### 4.1 · 核实事实与适用条件',
    '#### 4.2 · 根据核实后的关系选择图',
    '#### 4.3 · 验证工具能否完整表达',
  ];
  let last = -1;
  for (const stage of stages) {
    const at = source.indexOf(stage);
    assert(at > last, `Required stage missing or out of order: ${stage}`);
    last = at;
  }
  for (const phrase of ['要表达的断言', '当前依据', '适用条件', '核对结果', '对图的影响',
    '不能作为确定事实进入交付图', '已核实且条件未变', '不要因为流程图好排版',
    '用 `tree`', '用 `compare`', '用 `cards`', '先验证正确用法再判断能力']) {
    assert(source.includes(phrase), `Execution detail missing: ${phrase}`);
  }
  const finalReview = selectContent(loadDocument(ROOT), 'step', '8').content;
  assert(finalReview.includes('先对照第 4 步的查证记录'));
  assert(finalReview.includes('对照第 4 步核实后的对象与关系安排'));
});

test('emitted continuation commands execute and reassemble all step-8 acceptance checks', () => {
  const first = spawnSync(process.execPath, [CLI, 'step', '8', '--json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  let result = JSON.parse(first.stdout);
  const contents = [result.content];
  let parts = 1;
  while (result.nextCommand) {
    const next = spawnSync('/bin/bash', ['-c', result.nextCommand], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(next.status, 0, next.stderr);
    result = JSON.parse(next.stdout);
    contents.push(result.content);
    assert.equal(result.part, ++parts);
    assertOutputBounded(next.stdout);
    assert(parts < 50);
  }
  assert.equal(contents.join(''), selectContent(loadDocument(ROOT), 'step', '8').content);
  assert.equal([...contents.join('').matchAll(/^#### 复盘 /gm)].length, 10);
});

test('CLI uses its repository instead of cwd, prints errors to stderr and makes no source changes', () => {
  const before = fs.readFileSync(path.join(ROOT, SKILL_DIR, 'SKILL.md'));
  const ok = spawnSync(process.execPath, [CLI, 'step', '6', '--json'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(ok.stdout);
  assert.equal(result.file, `${SKILL_DIR}/SKILL.md`);
  assert.match(result.content, /^### 第 6 步/);
  const bad = spawnSync(process.execPath, [CLI, 'section', '不存在'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /找不到章节/);
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /不生成摘要/);
  assert.deepEqual(fs.readFileSync(path.join(ROOT, SKILL_DIR, 'SKILL.md')), before);
});
