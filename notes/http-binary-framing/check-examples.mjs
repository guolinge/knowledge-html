import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';

// Check the actual byte-walker configurations in the note, not duplicate fixtures.
const source = await readFile(new URL('./note.md', import.meta.url), 'utf8');
const demos = [...source.matchAll(/^```demo[\t ]*\r?\n([\s\S]*?)^```[\t ]*$/gm)]
  .map((match) => parse(match[1]))
  .filter((demo) => demo.widget === 'byte-walker');

function example(title) {
  const matches = demos.filter((demo) => demo.title === title);
  assert.equal(matches.length, 1, `expected exactly one demo: ${title}`);
  const demo = matches[0];
  const hex = String(demo.config.bytes).replace(/\s/g, '');
  assert.match(hex, /^(?:[a-f\d]{2})+$/i, `${title}: invalid byte sequence`);
  return { ...demo, bytes: Buffer.from(hex, 'hex') };
}

function lens(demo, label) {
  const matches = demo.config.lenses.filter((entry) => entry.label === label);
  assert.equal(matches.length, 1, `${demo.title}: missing lens ${label}`);
  return matches[0];
}

function stepBytes(demo, entry, index) {
  const step = entry.steps[index];
  assert.ok(step, `${demo.title}: missing step ${index}`);
  return demo.bytes.subarray(step.span[0], step.span[1] + 1);
}

function h2Frame(bytes, offset) {
  assert.ok(offset + 9 <= bytes.length, 'incomplete HTTP/2 frame header');
  const length = bytes.readUIntBE(offset, 3);
  const end = offset + 9 + length;
  assert.ok(end <= bytes.length, 'incomplete HTTP/2 frame payload');
  return {
    offset,
    length,
    type: bytes[offset + 3],
    flags: bytes[offset + 4],
    stream: bytes.readUInt32BE(offset + 5) & 0x7fffffff,
    payload: bytes.subarray(offset + 9, end),
    end,
  };
}

test('all byte-walker spans are valid inclusive byte offsets', () => {
  assert.equal(demos.length, 5);
  for (const entry of demos) {
    const demo = example(entry.title);
    assert.ok(demo.config.lenses.length > 0);
    for (const current of demo.config.lenses) {
      assert.ok(current.steps.length > 0, `${demo.title}: empty lens`);
      for (const step of current.steps) {
        assert.equal(step.span.length, 2, `${demo.title}: invalid span`);
        const [start, end] = step.span;
        assert.ok(Number.isInteger(start) && Number.isInteger(end));
        assert.ok(start >= 0 && start <= end && end < demo.bytes.length,
          `${demo.title}: out-of-range span ${start}–${end}`);
      }
    }
  }
});

test('89-byte request highlights the correct HTTP lines and CRLF bytes', () => {
  const demo = example('89 字节的请求：从字符走到 HTTP 结构');
  const lines = lens(demo, '按行解析');
  assert.equal(demo.bytes.length, 89);
  assert.deepEqual(lines.steps.map((step) => step.span), [
    [0, 20], [21, 43], [44, 67], [68, 86], [85, 88],
  ]);
  assert.equal(stepBytes(demo, lines, 0).toString('ascii'), 'GET /hello HTTP/1.1\r\n');
  assert.equal(stepBytes(demo, lines, 1).toString('ascii'), 'Host: 127.0.0.1:18080\r\n');
  assert.equal(stepBytes(demo, lines, 2).toString('ascii'), 'User-Agent: curl/8.7.1\r\n');
  assert.equal(stepBytes(demo, lines, 3).toString('ascii'), 'Accept: text/html\r\n');
  assert.equal(stepBytes(demo, lines, 4).toString('ascii'), '\r\n\r\n');
  const chars = lens(demo, '看字节与字符');
  assert.deepEqual(stepBytes(demo, chars, 0), Buffer.from('GET'));
  assert.deepEqual(stepBytes(demo, chars, 2), Buffer.from('\r\n'));
  assert.deepEqual(stepBytes(demo, chars, 3), Buffer.from('.'));
});

test('chunked example contains two payload chunks and the last-chunk terminator', () => {
  const demo = example('一步一步读取两个 chunk');
  const steps = lens(demo, '接收方逐块读');
  assert.equal(demo.bytes.length, 26);
  const expected = ['5\r\n', 'Hello', '\r\n', '6\r\n', ' world', '\r\n', '0\r\n', '\r\n'];
  assert.deepEqual(steps.steps.map((_, index) => stepBytes(demo, steps, index).toString('ascii')), expected);
  assert.equal(Buffer.concat([stepBytes(demo, steps, 1), stepBytes(demo, steps, 4)]).toString('ascii'), 'Hello world');
  const completeResponse = Buffer.concat([
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n'),
    demo.bytes,
  ]);
  assert.equal(completeResponse.length, 99);
});

test('body length example counts octets and permits CRLF in content', () => {
  assert.equal(Buffer.from('ab\r\n\r\ncd').length, 8);
  assert.equal(Buffer.byteLength('你好', 'utf8'), 6);
  assert.equal(Buffer.from('text/html').length, 9);
});

test('changing the declared length changes the next request start', () => {
  const demo = example('同一串字节，长度错一位会怎样？');
  assert.equal(demo.bytes.toString('ascii'), 'helloGET /next');
  for (const [label, body, next] of [
    ['长度 = 4', 'hell', 'oGET'],
    ['长度 = 5', 'hello', 'GET'],
    ['长度 = 6', 'helloG', 'ET'],
  ]) {
    const current = lens(demo, label);
    assert.equal(stepBytes(demo, current, 0).toString('ascii'), body);
    assert.equal(stepBytes(demo, current, 1).toString('ascii'), next);
  }
});

test('illustrative HTTP/2 DATA frame has a 9-byte header and 5-byte payload', () => {
  const demo = example('14 字节的 HTTP/2 DATA 帧');
  const frame = h2Frame(demo.bytes, 0);
  assert.deepEqual([frame.length, frame.type, frame.flags, frame.stream, frame.end], [5, 0, 1, 1, 14]);
  assert.equal(frame.payload.toString('ascii'), 'hello');
  const current = lens(demo, '按帧解析');
  assert.deepEqual(current.steps.map((step) => step.span), [[0, 2], [3, 3], [4, 4], [5, 8], [9, 13]]);
});

test('110-byte captured HTTP/2 stream has the documented preface and frames', () => {
  const demo = example('110 字节：前言、两个控制帧、一个请求头帧');
  assert.equal(demo.bytes.length, 110);
  const preface = demo.bytes.subarray(0, 24);
  assert.equal(preface.toString('ascii'), 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
  assert.equal([...preface].filter((value) => value >= 0x20 && value <= 0x7e).length, 16);
  let offset = preface.length;
  const frames = [];
  while (offset < demo.bytes.length) {
    const frame = h2Frame(demo.bytes, offset);
    frames.push(frame);
    offset = frame.end;
  }
  assert.deepEqual(frames.map(({ offset: start, length, type, flags, stream }) =>
    [start, length, type, flags, stream]), [
    [24, 18, 0x04, 0x00, 0],
    [51, 4, 0x08, 0x00, 0],
    [64, 37, 0x01, 0x05, 1],
  ]);
  assert.deepEqual(frames[2].payload.subarray(0, 2), Buffer.from([0x82, 0x86]));
  const frameLens = lens(demo, '从前言走到帧');
  assert.deepEqual(frameLens.steps.map((step) => step.span), [
    [0, 23], [24, 32], [33, 50], [51, 59], [60, 63], [64, 72], [73, 109],
  ]);
  const fieldLens = lens(demo, '从字节看头字段');
  assert.deepEqual(fieldLens.steps.map((step) => step.span), [
    [73, 73], [74, 74], [75, 87], [88, 94], [95, 104], [105, 109],
  ]);
});
