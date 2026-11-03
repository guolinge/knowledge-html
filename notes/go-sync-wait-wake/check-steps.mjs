import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';

const note = await readFile(new URL('./note.md', import.meta.url), 'utf8');
const fenced = (kind) => [...note.matchAll(new RegExp('^```' + kind + '[\\t ]*\\r?\\n([\\s\\S]*?)^```[\\t ]*$', 'gm'))]
  .map((match) => parse(match[1]));
const demos = fenced('demo').filter((demo) => demo.widget === 'stepper');

function demo(title) {
  const matches = demos.filter((item) => item.title === title);
  assert.equal(matches.length, 1, `expected one stepper: ${title}`);
  return matches[0].config.steps;
}

function containsAll(text, snippets) {
  for (const snippet of snippets) assert.ok(text.includes(snippet), `missing ${snippet}`);
}

test('all three steppers have meaningful snapshots and explanations', () => {
  assert.equal(demos.length, 3);
  for (const item of demos) {
    for (const [index, step] of item.config.steps.entries()) {
      assert.ok(step.label && step.code && step.note, `${item.title}: empty step ${index + 1}`);
    }
  }
});

test('channel example separates waiting, runnable, and running', () => {
  const steps = demo('接收 → 排队 → 发送 → 唤醒 → 继续');
  assert.equal(steps.length, 5);
  containsAll(steps[1].code, ['recvq', 'sudog → G接收', 'G接收：waiting']);
  containsAll(steps[3].code, ['recvq： [空]', 'G接收：runnable', '运行队列']);
  containsAll(steps[4].code, ['执行 G接收', '<-ch 返回 42']);
});

test('normal mutex mode includes the wake-and-lose race', () => {
  const steps = demo('普通模式：被唤醒不等于已经拿到锁');
  assert.equal(steps.length, 7);
  containsAll(steps[1].code, ['sudog → G2', 'G2：waiting']);
  containsAll(steps[2].code, ['G2：runnable', 'G2，G3']);
  containsAll(steps[3].code, ['G3 先取得', 'G2：runnable']);
  containsAll(steps[4].code, ['sudog → G2', 'G2：再次 waiting']);
  containsAll(steps[6].code, ['执行 G2', 'Lock() 成功返回']);
});

test('buffered-channel semaphore handoff preserves two logical slots', () => {
  const steps = demo('容量为 2：第三个工作者怎样等到名额？');
  assert.equal(steps.length, 4);
  containsAll(steps[1].code, ['[G1 ●] [G2 ●]', 'sudog → G3', 'G3：waiting']);
  containsAll(steps[2].code, ['[G2 ●] [G3 ●]', 'sendq：[空]', 'G3：runnable']);
  containsAll(steps[3].code, ['[G2 ●] [G3 ●]', '执行 G3', '发送调用返回']);
});

test('the two tree diagrams preserve actual object ownership', () => {
  const trees = fenced('tree');
  assert.equal(trees.length, 2);
  const semtable = trees[0][0];
  assert.ok(semtable.label.includes('semtable'));
  const root = semtable.children[0];
  assert.ok(root.label.includes('semaRoot'));
  assert.deepEqual(root.children.map((node) => node.label), ['地址 &m1.sema', '地址 &m2.sema']);
  const weighted = trees[1][0];
  const waiters = weighted.children.find((node) => node.label.includes('waiters'));
  assert.deepEqual(waiters.children[0].children.map((node) => node.label), ['n', 'ready · channel']);
});

test('knowledge tree points to the self-contained note', async () => {
  let meta;
  try {
    meta = JSON.parse(await readFile(new URL('./meta.json', import.meta.url), 'utf8'));
  } catch (error) {
    assert.fail(`cannot read or parse metadata: ${error.message}`);
  }
  const plan = parse(await readFile(new URL('../../plans/go-goroutine.yaml', import.meta.url), 'utf8'));
  const node = plan.nodes.find((item) => item.id === meta.tree.id);
  assert.equal(meta.tree.topic, plan.topic);
  assert.equal(node?.artifact, 'go-sync-wait-wake');
  assert.deepEqual(node?.needs, []);
});
