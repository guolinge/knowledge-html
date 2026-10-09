#!/usr/bin/env node
/* ============================================================
   board.mjs — 会话板：多个 agent 会话之间唯一的通信渠道
   ------------------------------------------------------------
   协议全文：.agents/skills/knowledge-html/references/multi-session-board.md

   为什么要有这个脚本，而不是一段「请大家记得」的约定：

     · 读 —— 板子从来不会通知谁，它只在有人去读的时候生效。
       所以「读」的成本必须低到一行命令，否则没人读。
     · 写 —— 原来所有会话共用一个 `.kh-board.md`，任何一次重写都会
       抹掉别人刚写的行。改成「一人一个文件」之后，写只能碰自己那份：
       从「靠约定」换成了「结构上做不到」。

   位置推导（在任何 worktree 里结果都一样）：

     git-common-dir 是所有 worktree 共享的那一个 .git，
     从它往上退两级，就落在所有 worktree 的共同父目录。

       ~/works/codes/knowledge-html/.git
       ~/works/codes/kh-xxx/.git            ← 同一个 .git
       ~/works/codes/.kh-board/<会话名>.md  ← 板子在这里，三个都看得见

   node tools/board.mjs                       # 读：最近 30 行
   node tools/board.mjs --tail 60             # 读更多
   node tools/board.mjs --path                # 只打印板子位置
   node tools/board.mjs --post 进行中 "在做 X; 会动 Y; 需要 无"
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/* ── 位置：从 git-common-dir 往上退两级 ───────────────────── */

const COMMON = path.dirname(
  path.dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir')),
);
const BOARD_DIR = path.join(COMMON, '.kh-board');
const LEGACY = path.join(COMMON, '.kh-board.md');
const NAME = path.basename(git('rev-parse', '--show-toplevel'));

/* ── 消息格式 ───────────────────────────────────────────────
   [<会话名> | <月-日 时:分> | <状态>] 在做…; 会动…; 需要…
   ---------------------------------------------------------- */

const STATUS = ['进行中', '帮助', '冲突', '收工'];
const MSG = /^\[([^\]|]+?)\s*\|\s*(\d{2}-\d{2} \d{2}:\d{2})\s*\|\s*([^\]]+?)\]\s*(.*)$/;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 要读的文件：旧的单文件（如果还在）+ 板子目录里的每人一个文件 */
function sources() {
  const out = [];
  if (fs.existsSync(LEGACY)) out.push(LEGACY);
  if (fs.existsSync(BOARD_DIR)) {
    for (const f of fs.readdirSync(BOARD_DIR).sort()) {
      if (f.endsWith('.md')) out.push(path.join(BOARD_DIR, f));
    }
  }
  return out;
}

/* ── 读 ─────────────────────────────────────────────────── */

function read(tail) {
  const files = sources();
  const rows = [];
  let skipped = 0;

  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const m = line.match(MSG);
      if (!m) {
        skipped++;
        continue;
      }
      rows.push({ at: m[2], who: m[1], status: m[3].trim(), body: m[4], line });
    }
  }

  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  console.log('');
  if (!rows.length) {
    console.log('  板子上还没有消息。\n');
    return;
  }

  const shown = rows.slice(-tail);
  if (shown.length < rows.length) {
    console.log(`  …… 更早的 ${rows.length - shown.length} 条略过（--tail 看更多）\n`);
  }
  for (const r of shown) console.log(`  ${r.line}`);
  console.log('');

  const live = [...new Map(rows.map((r) => [r.who, r])).values()]
    .filter((r) => r.status !== '收工')
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const legacy = fs.existsSync(LEGACY) ? '旧的单文件当档案，读完为止' : '旧单文件已不在';
  console.log(
    `  共 ${rows.length} 条 · 读了 ${files.length} 个文件（${path.relative(COMMON, BOARD_DIR)}/ 一个会话一个；${legacy}）`,
  );
  if (live.length) {
    console.log(`  ⚠ 还有 ${live.length} 个会话没标「收工」：`);
    for (const r of live.slice(-6)) console.log(`      ${r.who}  ${r.at}  ${r.status}`);
    console.log('      → 要动共享源就先看它们；撞上了发一条「帮助 / 冲突」再干活');
  } else {
    console.log('  ✓ 没有未收工的会话');
  }
  if (skipped) console.log(`  （跳过了 ${skipped} 行表头/非消息内容）`);
  console.log('');
}

/* ── 写 ─────────────────────────────────────────────────── */

function post(status, body) {
  if (!STATUS.includes(status)) {
    console.error(`  ✗ 状态只能是：${STATUS.join(' / ')}`);
    process.exit(1);
  }
  if (!body || !body.trim()) {
    console.error('  ✗ 正文不能为空。格式：--post <状态> "在做…; 会动…; 需要…"');
    process.exit(1);
  }

  const file = path.join(BOARD_DIR, `${NAME}.md`);
  const fresh = !fs.existsSync(file);
  const line = `[${NAME} | ${stamp()} | ${status}] ${body.trim()}`;

  fs.mkdirSync(BOARD_DIR, { recursive: true });
  /* 一次 append = 一次 O_APPEND 写。自己的文件里只有自己写，所以不会和任何人交错。 */
  fs.appendFileSync(
    file,
    (fresh ? `# ${NAME} · 会话消息（一行一条；只追加，不重写）\n\n` : '') + line + '\n',
  );

  console.log('');
  console.log(`  ✓ 已追加到 ${file}`);
  console.log(`  ${line}`);
  console.log('');
}

/* ── 入口 ───────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? true;
};

if (argv.includes('--path')) {
  console.log(BOARD_DIR);
  console.log(LEGACY);
} else if (argv.includes('--post')) {
  const i = argv.indexOf('--post');
  post(argv[i + 1] ?? '', argv[i + 2] ?? '');
} else {
  read(Number(flag('--tail')) || 30);
}
