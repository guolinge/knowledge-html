#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadResult, formatReadResult, assertOutputBounded } from './lib/skill-reader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `按章节读取 skill 原文；每次只输出安全大小的一块，不生成摘要。

npm run --silent skill-read -- list
npm run --silent skill-read -- principles
npm run --silent skill-read -- step 6
npm run --silent skill-read -- section 资料查证
npm run --silent skill-read -- section '工作流 / 第 8 步 · 交付前检查 / 复盘 ① · 术语与前置知识'
npm run --silent skill-read -- --file references/blocks.md list
npm run --silent skill-read -- --file references/blocks.md section '3. compare — 多维对比'
npm run --silent skill-read -- all

选项：
  --file <path>     当前仓库内的 Markdown；默认 SKILL.md，references/ 相对 skill 目录
  --part <N>        从 1 开始的分块号；续读请使用输出中的下一条命令
  --revision <sha>  核对读取版本（源文件、关联导航和输出模式）；变化后拒绝沿旧分块续读
  --json           输出含精确原文 content、范围和 nextCommand 的 JSON
  --help           显示帮助

章节标题精确匹配，也支持完整层级标题或 #锚点；不猜重复标题。
普通输出的每块原文最多 16KiB/240行，完整输出最多 32KiB/600行。
相关读取入口只是清单，未自动输出那些章节；输出完成不等于已读或已验收。
`;

export function parseArguments(args) {
  const options = { file: 'SKILL.md', part: 1, json: false };
  const seen = new Set();
  const positional = [];
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (literal) { positional.push(arg); continue; }
    if (arg === '--') { literal = true; continue; }
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg.startsWith('-')) {
      if (!['--file', '--part', '--revision', '--json'].includes(arg)) throw new Error(`未知选项：${arg}`);
      if (seen.has(arg)) throw new Error(`选项重复：${arg}`);
      seen.add(arg);
      if (arg === '--json') { options.json = true; continue; }
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值。`);
      if (arg === '--file') options.file = value;
      if (arg === '--part') {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('--part 需要从 1 开始的整数。');
        options.part = Number(value);
      }
      if (arg === '--revision') {
        if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('--revision 需要完整 SHA256。');
        options.revision = value.toLowerCase();
      }
    } else positional.push(arg);
  }
  const [mode, ...target] = positional;
  if (!['list', 'all', 'principles', 'step', 'section'].includes(mode)) throw new Error('需要 list / all / principles / step / section。用 --help 查看例子。');
  if (mode === 'step' && (target.length !== 1 || !/^\d+$/.test(target[0]) || !Number.isSafeInteger(Number(target[0])))) {
    throw new Error('step 需要一个非负整数步骤号。');
  }
  if (mode === 'section' && !target.join(' ').trim()) throw new Error('section 需要精确章节标题。先用 list 查看。');
  if (['list', 'all', 'principles'].includes(mode) && target.length) throw new Error(`${mode} 不接受额外的章节参数。`);
  return { ...options, mode, target: target.join(' ') };
}

export function main(args = process.argv.slice(2), root = ROOT) {
  try {
    const options = parseArguments(args);
    const output = options.help ? HELP : formatReadResult(createReadResult(root, options), options.json);
    assertOutputBounded(output);
    process.stdout.write(output);
    return 0;
  } catch (error) {
    process.stderr.write(`skill-read: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
