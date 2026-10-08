#!/usr/bin/env node
/* ============================================================
   handoff.mjs —— 交付前把规矩推到你眼前
   ------------------------------------------------------------
   为什么要有这个脚本：

     skill 里那些「让人返工」的规矩，写成了散文，散在 3000 行文档的不同角落。
     实测过一次：同一件事写了三处（顶部 callout / 多会话协作 / 四条硬规矩），
     agent 漏了后两处**但照做了**；而只写在一处的（第 9 步的写回）它就漏了。

   结论不是「把文档重排」，是「把规矩挂到命令上」——
   命令的输出每次都有人看，而且它会失败。文档不会。

   所以这个脚本只做一件事：在交付那一刻，把那几条打出来。
   它不代替 `check` / `visual-check` / pre-push —— 那三道是闸门，这个是提醒。

     npm run done      （check → skill → build:standalone → visual-check → 这里）
   ============================================================ */

const RULES = [
  ['会话隔离', '优先开 worktree；在共用目录里干活就点名 `git add`，别用 `-A`'],
  ['产物全量', '`dist/` · `notes/*/index.html` · `index.html` · `skill/` 每次全带上'],
  ['不替别人改', '别人的笔记有问题 → 报告，不擅自改'],
  ['图必须量', '改完图跑 `npm run visual-check`，构建通过不等于画对了'],
  ['收尾写回', '这次跟工具较劲的地方，回「第 9 步」写进 SKILL.md'],
];

const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log('');
console.log('  交付纪律（这五条是让人返工最多的）');
console.log('');
for (const [k, v] of RULES) console.log(`    ${pad(k, 12)}${v}`);
console.log('');
console.log('  下一步');
console.log('    改了什么    node tools/status.mjs');
console.log('    提交前再看  node tools/status.mjs --cached');
console.log('');
console.log('  临时文件（`_` 开头的预览、截图、.bak）别带进去。');
console.log('');
