#!/usr/bin/env node
/* ============================================================
   worktree-audit.mjs — 残留工作区的只读审计
   ------------------------------------------------------------
   为什么需要它：

     `git worktree add` 是一条随时能开的命令，
     但没有任何一条命令会提醒你关掉它。

     实测（2026-10-09）：这个仓库留下了 8 个工作区目录、约 300MB。
     全部已经并入 main，却没人敢删 —— 因为「还有人在用吗」只能靠猜。

   为什么它**只读**：
     删除不可逆。所以这只脚本只做三件事：分类、给命令、报数。
     删不删由人拍板 —— 「可删候选」是建议，不是许可。

   安全门（四条，照抄 pstack 的 worktree-cleanup）：

     1. 路径只从 `git worktree list` 读，不手打
        —— 手打的路径会漏掉别处的工作区（比如某次开在 /tmp 的）
     2. 主仓库和当前所在的工作区永远不进候选
     3. `wip:N`（有未提交的改动）必须停下来问人：
        删掉一个干净的工作区可以从分支恢复，未提交的东西不能
     4. 板子上最后一次提到它的时间一起打出来 —— 钉住哪个会话只有人知道

   node tools/worktree-audit.mjs          # 审计
   node tools/worktree-audit.mjs --json   # 机器读
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};

/* ── 位置（和 board.mjs 同一套推导）───────────────────────── */

const COMMON = path.dirname(
  path.dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir')),
);
const MAIN = path.dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
const BOARD_DIR = path.join(COMMON, '.kh-board');
const LEGACY = path.join(COMMON, '.kh-board.md');

/* ── 列工作区（只从 git 读，不手打路径）──────────────────── */

function worktrees() {
  const raw = git('worktree', 'list', '--porcelain').split('\n');
  const out = [];
  let cur = null;
  for (const line of raw) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (cur && line.startsWith('HEAD ')) {
      cur.head = line.slice(5);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (cur && line.startsWith('detached')) {
      cur.detached = true;
    } else if (!line.trim() && cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 板子上最后一次提到这个会话名是什么时候（旧单文件 + 每人一个文件都读） */
function lastBoardMention(name) {
  const files = [];
  if (fs.existsSync(LEGACY)) files.push(LEGACY);
  if (fs.existsSync(BOARD_DIR)) {
    for (const f of fs.readdirSync(BOARD_DIR)) {
      if (f.endsWith('.md')) files.push(path.join(BOARD_DIR, f));
    }
  }
  let last = null;
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\[([^\]|]+?)\s*\|\s*(\d{2}-\d{2} \d{2}:\d{2})\s*\|\s*([^\]]+?)\]/);
      if (m && m[1].trim() === name) {
        if (!last || m[2] > last.at) last = { at: m[2], status: m[3].trim() };
      }
    }
  }
  return last;
}

const human = (n) => {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  return `${Math.round(n / 1024)}KB`;
};
const daysAgo = (d) => Math.round((Date.now() - d.getTime()) / 86400000);

/* ── 分类 ─────────────────────────────────────────────────── */

const rows = [];
for (const wt of worktrees()) {
  if (path.resolve(wt.path) === path.resolve(MAIN)) continue; // 主仓库不进候选

  const name = path.basename(wt.path);
  const isCurrent = path.resolve(wt.path) === path.resolve(ROOT);

  let wip = 0;
  let scratch = 0;
  const scratchFiles = [];
  const status = tryGit('-C', wt.path, 'status', '--porcelain');
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('??')) {
      scratch++;
      scratchFiles.push(line.slice(3).trim());
    } else {
      wip++;
    }
  }

  const mergedOk = (() => {
    if (!wt.head) return false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', wt.head, 'main'], {
        cwd: MAIN,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  })();

  let size = 0;
  try {
    const du = execFileSync('du', ['-sk', wt.path], { encoding: 'utf8' }).trim();
    size = Number(du.split('\t')[0]) * 1024;
  } catch {
    size = 0;
  }

  let age = null;
  try {
    age = daysAgo(fs.statSync(wt.path).mtime);
  } catch {
    age = null;
  }

  const board = lastBoardMention(name);

  let bucket;
  if (isCurrent) bucket = '当前所在';
  else if (wip > 0) bucket = `wip:${wip} 停下问人`;
  else if (!mergedOk) bucket = '未并入 main';
  else if (scratch > 0) bucket = `scratch:${scratch} 可删但先看文件名`;
  else bucket = '可删候选';

  rows.push({ name, path: wt.path, branch: wt.branch ?? '(detached)', head: (wt.head ?? '').slice(0, 8), merged: mergedOk, wip, scratch, scratchFiles, size, age, board, current: isCurrent, bucket });
}

/* ── 报数 ─────────────────────────────────────────────────── */

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const total = rows.reduce((s, r) => s + r.size, 0);
let df = '';
try {
  df = execFileSync('df', ['-h', '/'], { encoding: 'utf8' }).trim().split('\n').pop();
} catch {
  df = '';
}

console.log('');
console.log(`  非主仓库的工作区 ${rows.length} 个（含当前所在）· 合计 ${human(total)}  —— 路径全部来自 git worktree list`);
if (df) console.log(`  磁盘（删之前先记一笔，删完再跑一次对比）：${df.replace(/\s+/g, '  ')}`);
console.log('');

for (const r of rows) {
  const flag = r.bucket.startsWith('可删') ? '✓' : r.current ? '•' : '⚠';
  console.log(`  ${flag} ${r.name}  →  ${r.bucket}`);
  console.log(
    `      分支 ${r.branch} · head ${r.head} · ${r.merged ? '已并入 main' : '未并入 main'}` +
      ` · ${human(r.size)}${r.age === null ? '' : ` · 目录 ${r.age} 天没动`}` +
      ` · 改 ${r.wip} / 未跟踪 ${r.scratch}`,
  );
  if (r.board) console.log(`      板子最后提到：${r.board.at}  ${r.board.status}`);
  if (r.scratchFiles.length) {
    console.log(`      未跟踪（scratch）: ${r.scratchFiles.slice(0, 6).join('  ')}${r.scratchFiles.length > 6 ? `  …共 ${r.scratchFiles.length}` : ''}`);
  }
}

const prunable = rows.filter((r) => r.bucket.startsWith('可删'));
const held = rows.filter((r) => r.bucket.startsWith('wip') || r.bucket.startsWith('未并入'));
console.log('');
console.log('  下一步（脚本不自己删 —— 删除不可逆，得你拍板）：');
console.log('');
console.log('    1. 先点名：哪些会话是你还钉着的？钉住的不进候选（bucket 只是建议，不是许可）');
if (prunable.length) {
  console.log(`    2. 确认之后，逐个删（${prunable.length} 个候选）：`);
  for (const r of prunable) {
    console.log(`         git worktree remove --force ${r.path}`);
    console.log(`         git branch -d ${r.branch}     # 已并入 main 才删得掉，删不掉说明判断错了`);
  }
  console.log('       最后：git worktree prune && df -h /   （和上面的数字对比）');
} else {
  console.log('    2. 没有可删候选');
}
if (held.length) {
  console.log(`    3. ${held.length} 个要停下来问人（有未提交 / 没并入 main）：${held.map((r) => r.name).join('  ')}`);
}
console.log('');
