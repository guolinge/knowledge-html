#!/usr/bin/env node
/* 最终 arch 页面探针：宽屏倍率、完整包含、区域/零件/格子/场景/导览/对比/键盘。
 * node tools/probe-arch.mjs [slug] [--screenshots]；只写独立 temp，绝不覆盖 dist。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const slug = process.argv[2] || 'process-thread-relation';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-arch-probe-'));
try {
  const source = fs.readFileSync(path.join(ROOT, 'dist', `${slug}.html`), 'utf8');
  const browser = `
window.__archErrors=[];
window.addEventListener('error',e=>window.__archErrors.push(e.message));
setTimeout(()=>{
 const results=[];
 const check=(name,pass,detail='')=>results.push({name,pass,detail});
 const rect=n=>n.getBoundingClientRect();
 const visible=n=>{const r=rect(n);return r.width>0&&r.height>0&&getComputedStyle(n).display!=='none';};
 const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1.5;
 const fig=document.querySelector('[data-arch][data-frames]');
 check('存在多层归属图',!!fig);
 if(!fig){finish();return;}
 const svg=fig.querySelector('svg'),nodes=[...svg.querySelectorAll('[data-node-id]')],frames=[...svg.querySelectorAll('[data-frame]')];
 const figureIds=[...document.querySelectorAll('[data-arch] svg [id]')].map(n=>n.id);
 const repeated=[...new Set(figureIds.filter((id,i)=>figureIds.indexOf(id)!==i))];
 check('同页多张 arch 图的内部 id 不重复',!repeated.length,JSON.stringify(repeated));
 check('每张图的图名指向自己',[...document.querySelectorAll('[data-arch] svg')].every(s=>{
  const labels=(s.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean);
  return labels.length>0&&labels.every(id=>s.querySelector('#'+CSS.escape(id)));
 }));
 const meta=JSON.parse(fig.dataset.frames), byId=id=>frames.find(f=>f.dataset.frame===id);
 const bounds=id=>rect(byId(id).querySelector('rect'));
 check('所有声明区域都可读可点',frames.length===meta.length&&frames.every(f=>visible(f)&&f.getAttribute('tabindex')==='0'));
 check('框线真的可见',frames.every(f=>getComputedStyle(f.querySelector('rect')).stroke!=='none'));
 check('父框完整包住子框',meta.every(f=>{if(!f.parent)return true;const a=bounds(f.parent),b=bounds(f.id);return a.left<=b.left&&a.top<=b.top&&a.right>=b.right&&a.bottom>=b.bottom;}));
 const natural=svg.viewBox.baseVal.width, scale=rect(svg).width/natural;
 const maximum=Number(fig.style.getPropertyValue('--arch-max-width').replace('px',''));
 check('画布不超过声明倍率',rect(svg).width<=maximum+2,JSON.stringify({svgWidth:rect(svg).width,natural,scale,maximum}));
 check('所有 arch 图不超过原画布尺度上限',[...document.querySelectorAll('[data-arch]')].every(f=>{const s=f.querySelector('svg'),max=Number(f.style.getPropertyValue('--arch-max-width').replace('px',''));return !max||rect(s).width<=max+2;}));
 if(window.innerWidth>=1280){
  const texts=[...svg.querySelectorAll('text')].filter(visible);
  const collisions=[];
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++)if(intersects(rect(texts[i]),rect(texts[j])))collisions.push(texts[i].textContent+' / '+texts[j].textContent);
  check('文字没有重叠',!collisions.length,JSON.stringify(collisions));
 }
 const crosses=[];
 svg.querySelectorAll('path[data-edge-from]').forEach(p=>{
  const matrix=p.getScreenCTM();
  for(let distance=0;distance<=p.getTotalLength();distance+=3){
   const pt=p.getPointAtLength(distance),point=new DOMPoint(pt.x,pt.y).matrixTransform(matrix);
   nodes.forEach(n=>{
    if([p.dataset.edgeFrom,p.dataset.edgeTo].includes(n.dataset.nodeId))return;
    const b=rect(n.querySelector('rect'));
    if(point.x>b.left+1&&point.x<b.right-1&&point.y>b.top+1&&point.y<b.bottom-1)crosses.push(p.dataset.edgeFrom+'→'+p.dataset.edgeTo+' / '+n.dataset.nodeId);
   });
  }
 });
 check('最终连线不穿无关节点',!crosses.length,JSON.stringify([...new Set(crosses)]));
 const before=nodes.map(n=>[n.dataset.nodeId,rect(n).x,rect(n).y,rect(n).width]);
 fig.querySelector('[data-boundary-mode=flat]').click();
 check('一层视图只保留 flat 区域',frames.filter(visible).length===meta.filter(f=>f.flat).length);
 fig.querySelector('[data-boundary-mode=nested]').click();
 check('恢复全部边界',frames.every(visible));
 check('切边界不移动节点',JSON.stringify(before)===JSON.stringify(nodes.map(n=>[n.dataset.nodeId,rect(n).x,rect(n).y,rect(n).width])));
 const heap=svg.querySelector('[data-node-id=heap]')||nodes[0];heap.dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check('点节点聚焦并显示完整祖先路径',fig.dataset.focus===heap.dataset.nodeId&&fig.querySelector('[data-arch-address]').textContent.includes(heap.dataset.nodeLabel));
 check('聚焦保留祖先边界',meta.filter(f=>f.members.includes(heap.dataset.nodeId)).every(f=>visible(byId(f.id))&&byId(f.id).classList.contains('is-current')));
 const target=meta.find(f=>f.id==='threads')||meta[0];
 byId(target.id).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 check('键盘选中区域及所有成员',fig.dataset.focus==='region'&&target.members.every(id=>svg.querySelector('[data-node-id='+id+']').classList.contains('is-hot')));
 check('区域说明显示',fig.querySelector('[data-arch-frame-detail]').textContent===target.detail);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 check('Escape 清除聚焦与区域选中',!fig.dataset.focus&&frames.every(f=>!f.classList.contains('is-current')));
 fig.querySelector('[data-arch-reset]').click();
 const spot=svg.querySelector('[data-nb-link]');
 if(spot){spot.dispatchEvent(new MouseEvent('click',{bubbles:true}));check('格子入口跳转关联零件',fig.dataset.focus===spot.dataset.nbLink);}
 fig.querySelector('[data-arch-reset]').click();
 const one=fig.querySelector('[data-scenario=one]');
 if(one){one.click();check('单线程场景生效',fig.dataset.scenario==='one'&&svg.querySelector('[data-node-id=task1]').classList.contains('is-dim'));fig.querySelector('[data-scenario=multi]').click();}
 const tour=fig.querySelector('.pano-tab');
 if(tour){tour.click();check('导览与祖先边界联动',!!fig.querySelector('.pano-next')&&frames.some(f=>f.classList.contains('is-current')));fig.querySelector('.pano-next').click();}
 fig.querySelector('[data-arch-reset]').click();
 const compare=fig.querySelector('.pano-chip-cmp');
 if(compare){compare.click();nodes[2].dispatchEvent(new MouseEvent('click',{bubbles:true}));nodes[3].dispatchEvent(new MouseEvent('click',{bubbles:true}));check('对比表显示',!!fig.querySelector('.pano-cmp-table'));}
 fig.querySelector('[data-arch-reset]').click();
 check('恢复全图清除对比和聚焦',!fig.dataset.focus&&nodes.every(n=>!n.classList.contains('is-picked')));
 check('无整页横向溢出',document.documentElement.scrollWidth<=window.innerWidth);
 check('无运行时错误',!window.__archErrors.length,JSON.stringify(window.__archErrors));
 const title=svg.querySelector('.nb-title'),body=svg.querySelector('.nb-v');
 results.push({name:'显示字号',pass:true,detail:JSON.stringify({title:title?Number(getComputedStyle(title).fontSize.replace('px',''))*scale:null,body:body?Number(getComputedStyle(body).fontSize.replace('px',''))*scale:null})});
 if(window.innerWidth<700)check('窄屏宽图有局部滚动通道',getComputedStyle(fig.querySelector('.arch-canvas')).overflowX==='auto');
 finish();
 function finish(){const result=document.createElement('pre');result.id='arch-probe-result';result.textContent=JSON.stringify(results);document.body.append(result);}
},1000);
`;
  const reports=[];
  for (const width of [1280, 1920, 500]) {
    for (const theme of ['light','dark']) {
      const html=source.replace('</head>','<style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head>')
        .replace('</body>',`<script>document.documentElement.dataset.theme='${theme}';</script><script>${browser}</script></body>`);
      const file=path.join(temp,`${width}-${theme}.html`);
      fs.writeFileSync(file,html);
      const raw=execFileSync(CHROME,['--headless','--disable-gpu','--no-first-run','--dump-dom','--virtual-time-budget=8000',`--window-size=${width},1000`,`file://${file}`],{encoding:'utf8',maxBuffer:64*1024*1024,timeout:90000,stdio:['ignore','pipe','ignore']});
      const result=raw.match(/<pre id="arch-probe-result">([\s\S]*?)<\/pre>/)?.[1];
      if(!result)throw new Error(`探针没有返回：${width} ${theme}`);
      const tests=JSON.parse(result.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
      reports.push({width,theme,tests});
      console.log(`${width} ${theme}: ${tests.filter(t=>t.pass).length}/${tests.length}`);
      tests.filter(t=>!t.pass).forEach(t=>console.error(`  ✗ ${t.name}: ${t.detail}`));
      if(process.argv.includes('--screenshots')&&width>=1280){
        const graph=source.match(/<figure class="archfig"[\s\S]*?<\/figure>/)?.[0];
        const styles=source.match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.join('')||'';
        const script=source.match(/<script\b[^>]*>[\s\S]*?<\/script>/g)?.join('')||'';
        const screenshot=path.join(temp,`${width}-${theme}-diagram.html`);
        fs.writeFileSync(screenshot,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${styles}<style>body{margin:0;padding:28px;background:var(--bg)}main{max-width:none}</style></head><body><main>${graph}</main>${script}<script>document.documentElement.dataset.theme='${theme}';</script></body></html>`);
        execFileSync(CHROME,['--headless','--disable-gpu',`--screenshot=${path.join(temp,`${width}-${theme}.png`)}`,`--window-size=${width},2200`,'--virtual-time-budget=3000',`file://${screenshot}`],{timeout:90000,stdio:'ignore'});
      }
    }
  }
  fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify(reports,null,2));
  console.log(`证据：${temp}`);
  if(reports.some(r=>r.tests.some(t=>!t.pass)))process.exitCode=1;
} catch(error){console.error(error);console.error(`诊断目录：${temp}`);process.exitCode=1;}
