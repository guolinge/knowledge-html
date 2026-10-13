import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyArchFrames, archWidth, namespaceFigureIds, restoreBoundaryBoxes } from './arch-frames.mjs';

const svg = `<svg viewBox="0 0 500 240">
<rect data-composition-frame-id="0" x="10" y="10" width="450" height="200"/><text>outer</text>
<rect data-composition-frame-id="1" x="50" y="50" width="130" height="140"/><text>inner</text>
<g id="node-a" data-node-id="a"><rect x="90" y="90" width="50" height="50"/></g>
<g id="node-b" data-node-id="b"><rect x="300" y="150" width="50" height="50"/></g></svg>`;
const spec = { diagram_type: 'architecture', components: [{id:'a'}, {id:'b'}], boundaries: [
  {wraps:['a','b'],pad:60}, {wraps:['a'],pad:40},
] };
const corrected = restoreBoundaryBoxes(svg, spec);
const frames = [
  {id:'outer',boundary:0,kind:'logical',detail:'logical domain'},
  {id:'inner',boundary:1,parent:'outer',kind:'classification',detail:'user mode',flat:true},
];

test('restore clipped bottom, preserve nodes and routes, extend viewBox only when needed', () => {
  assert.match(corrected, /viewBox="0 0 500 284"/);
  assert.match(corrected, /height="250"/);
  assert.match(corrected, /data-frame-members="a b"/);
  assert.match(corrected, /<rect x="90" y="90" width="50" height="50"/);
});
test('explicit parent creates recursive context and leaves direct parent nodes outside child', () => {
  const out = applyArchFrames(corrected, frames);
  assert.deepEqual(out.frames.map(f=>[f.id,f.depth,f.members]), [['outer',1,['a','b']],['inner',2,['a']]]);
  assert.match(out.svg,/data-depth="2"/);
  assert.match(out.svg,/data-frame-flat="true"/);
});
test('no frames leaves bytes untouched and no controls', () => {
  assert.deepEqual(applyArchFrames(svg),{svg,frames:[]});
});
test('missing metadata asks to regenerate SVG', () => {
  assert.throws(()=>applyArchFrames(svg,frames),/元数据/);
});
test('unknown boundary, duplicate id, missing semantics reject', () => {
  assert.throws(()=>applyArchFrames(corrected,[{...frames[0],boundary:8}]),/boundary/);
  assert.throws(()=>applyArchFrames(corrected,[frames[0],{...frames[1],id:'outer'}]),/重复/);
  assert.throws(()=>applyArchFrames(corrected,[{...frames[0],kind:'region'}]),/kind/);
  assert.throws(()=>applyArchFrames(corrected,[{...frames[0],detail:''}]),/detail/);
});
test('unknown parent and cycles reject', () => {
  assert.throws(()=>applyArchFrames(corrected,[frames[0],{...frames[1],parent:'missing'}]),/parent/);
  assert.throws(()=>applyArchFrames(corrected,[{...frames[0],parent:'outer'},frames[1]]),/形成环/);
});
test('membership mismatch, intersecting siblings, clipped child, title crowding reject', () => {
  assert.throws(()=>applyArchFrames(corrected,[
    {...frames[0],boundary:1}, {...frames[1],boundary:0},
  ]),/成员/);
  assert.throws(()=>applyArchFrames(corrected,[frames[0],{...frames[1],parent:undefined}]),/同级区域/);
  assert.throws(()=>applyArchFrames(corrected.replace('height="250"','height="80"'),frames),/完整包住/);
  assert.throws(()=>applyArchFrames(corrected.replace('x="50" y="50"','x="50" y="20"'),frames),/24px/);
});
test('inlined figures get prefixed ids; references follow; data-* stay untouched', () => {
  const raw = '<svg viewBox="0 0 10 10" aria-labelledby="archify-diagram-title archify-diagram-description" data-node-id="a" data-composition-frame-id="0"><title id="archify-diagram-title">t</title><marker id="arrowhead"/><pattern id="grid"/><g id="node-a" data-nb-link="b"><rect fill="url(#grid)" marker-end="url(#arrowhead)"/></g><use href="#node-a"/></svg>';
  const out = namespaceFigureIds(raw, 'pt-map');
  assert.match(out, / aria-labelledby="pt-map-archify-diagram-title pt-map-archify-diagram-description"/);
  assert.match(out, /<marker id="pt-map-arrowhead"\/>/);
  assert.match(out, /fill="url\(#pt-map-grid\)" marker-end="url\(#pt-map-arrowhead\)"/);
  assert.match(out, /<g id="pt-map-node-a" data-nb-link="b">/);
  assert.match(out, /<use href="#pt-map-node-a"\/>/);
  assert.match(out, /data-composition-frame-id="0"/);
  assert.doesNotMatch(out, /id="arrowhead"/);
});
test('two figures with the same name must not collide', () => {
  const raw = '<svg viewBox="0 0 10 10"><pattern id="grid"/><rect fill="url(#grid)"/></svg>';
  const a = namespaceFigureIds(raw, 'dup');
  const b = namespaceFigureIds(raw, 'dup');
  assert.match(a, /id="dup-grid"/);
  assert.match(b, /id="dup-2-grid"/);
  assert.match(b, /url\(#dup-2-grid\)/);
});
test('maxScale defaults to native width; authored prototype ratio preserved', () => {
  assert.equal(archWidth(svg),500);
  assert.equal(archWidth(svg,0.87),435);
  for(const value of [0,-1,'1',Infinity,NaN])assert.throws(()=>archWidth(svg,value),/正数/);
});
test('labels and details are escaped; members stay plain data', () => {
  const out=applyArchFrames(corrected,[{...frames[0],label:'<img onerror="bad">',detail:'a & <b>'},frames[1]]);
  assert.match(out.svg,/&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.match(out.svg,/a &amp; &lt;b&gt;/);
  assert.doesNotMatch(out.svg,/<img/);
});
test('approved process map keeps all 13 component geometries and three nesting levels', () => {
  const current=fs.readFileSync(new URL('../../assets/arch/pt-map.svg',import.meta.url),'utf8');
  const config=[['process',0,null,'logical'],['user',1,'process','classification'],['shared',2,'user','shared'],
    ['stacks',3,'user','contains'],['kernel',4,'process','classification'],['resources',5,'kernel','shared'],
    ['threads',6,'kernel','contains'],['hardware',7,null,'classification']]
    .map(([id,boundary,parent,kind])=>({id,boundary,parent,kind,detail:'meaning'}));
  const out=applyArchFrames(current,config);
  assert.equal(out.frames.length,8);
  assert.equal(out.frames.find(f=>f.id==='threads').depth,3);
  assert.equal([...out.svg.matchAll(/data-node-id=/g)].length,13);
  assert.equal(archWidth(current,0.87),1224.1);
});
