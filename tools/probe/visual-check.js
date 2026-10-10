/* ============================================================
   visual-check 的浏览器探针
   ------------------------------------------------------------
   这个文件被 tools/visual-check.mjs 读进来、注入到页面里跑。

   为什么是**独立文件**而不是嵌在 visual-check.mjs 里的模板字符串
   ------------------------------------------------------------
   以前它是个模板字符串。代价是里面不能出现反引号（会提前闭合），
   而且 \n 会被求值成真换行、注入后变成语法错 ——
   「探针没回数据」这种报错看不出原因。**这个坑踩了四次。**

   抽成普通 .js 之后：
     · 没有转义问题，随便写反引号
     · node --check 能直接检查它
     · 编辑器有语法高亮和补全

   要传数据进来就用挂全局变量：
     visual-check.mjs 先注入一段设置 window.__VC_CONTAINERS 的 script，
     再注入本文件。

   ⚠️ 本文件里**不要写出能闭合 script 标签的字面串**（即使写在注释里）。
      踩过：我在注释里写了一次，注入后把外层 script 提前闭合 ——
      症状还是「探针没回数据」，又一次看不出原因。
      visual-check.mjs 那边也做了转义兜底。
   ============================================================ */

setTimeout(function () {
  /* 整个探针包在 try 里。
     以前探针自己抛异常时，外面只能看到「探针没回数据」——
     知道坏了，不知道坏在哪。现在把异常也写进 vc-result。 */
  try {
  var CONTAINERS = (typeof window !== "undefined" && window.__VC_CONTAINERS) || [];
  /* 需要换行时用 NL，**不要在字符串里写 \\n**。
     踩过三次：PROBE 是模板字符串，里面的 \\n 会被求值成**真换行**，
     注入后会变成「单引号字符串中间断了一行」的语法错 ——
     症状是「探针没回数据」，看不出哪错。用 NL 就完全绕开这类转义。 */
  var NL = String.fromCharCode(10);
  var problems = [];
  var TOL = 2;   // 2px 容差，避免亚像素误差误报

  /* 有 SVG 的积木：必须真画出东西来。
     踩过：app.js 里一段代码放错位置（两个积木的绘制函数尾部长得一样，
     字符串替换打中了另一个），运行时抛异常，结果 SVG 是空的 ——
     但空 SVG 没有溢出，布局检查全绿。==所以「画出来没有」要单独查。== */
  var SVG_BLOCKS = ['[data-flow]', '[data-seq]'];
  SVG_BLOCKS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (box, i) {
      var svg = box.querySelector('svg');
      if (!svg) { problems.push(sel + '[' + i + '] 没有 svg 元素'); return; }
      /* 只数「真正画在图上」的图元 —— 要排除 <defs> 里的。
         别用 defs * 去减：那会把 marker 元素本身也算进去，
         边少的图（比如只有 2 条边）会被误判成空。踩过这个坑。
         （PROBE 是模板字符串，注释里不能出现反引号 —— 也别踩。） */
      var drawn = Array.prototype.filter.call(
        svg.querySelectorAll('line, rect, path, circle, ellipse, polygon, polyline, text'),
        function (el) { return !el.closest('defs'); },
      ).length;
      if (drawn < 2) {
        problems.push(
          sel + '[' + i + '] 的 svg 是空的（只有 ' + drawn + ' 个图元）' +
            ' —— 多半是绘制时抛了异常',
        );
      }
    });
  });


  CONTAINERS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (box, i) {
      var br = box.getBoundingClientRect();
      if (!br.width || !br.height) return;
      var where = sel + '[' + i + ']';

      // ① 容器自己有没有被内容撑破（scrollWidth/Height 比可视区大）
      if (box.scrollWidth > box.clientWidth + TOL) {
        problems.push(where + ' 内容横向溢出 ' + (box.scrollWidth - box.clientWidth) + 'px');
      }

      // ② 子元素有没有跑出容器边界（绝对定位的区域框就是这类）
      box.querySelectorAll('*').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        var over = [];
        if (r.left   < br.left   - TOL) over.push('左 ' + Math.round(br.left - r.left) + 'px');
        if (r.right  > br.right  + TOL) over.push('右 ' + Math.round(r.right - br.right) + 'px');
        if (r.top    < br.top    - TOL) over.push('上 ' + Math.round(br.top - r.top) + 'px');
        if (r.bottom > br.bottom + TOL) over.push('下 ' + Math.round(r.bottom - br.bottom) + 'px');
        if (over.length) {
          var id = el.getAttribute('data-id') || el.getAttribute('data-group-box')
                || el.className.toString().split(' ')[0] || el.tagName.toLowerCase();
          problems.push(where + ' → <' + id + '> 溢出容器：' + over.join('、'));
        }
      });
    });
  });

  /* ④ 控件自己拼的几块，上下之间有没有留白。
     踩过：validate-lab 把 pick / flow / out / legend 直接 append 到
     [data-mount] 上，而 gap 定义在一个**没被用上**的 .vl-wrap 上 ——
     结果按钮行和流程条之间 0px，挤在一起。
     ==「没套那层 wrapper」是静默的：渲染出来有东西，只是挤。==
     只查 [data-mount]：panes 形态的 .demo 没有它，不会被误报。 */
  document.querySelectorAll('[data-mount]').forEach(function (mount) {
    var kids = Array.prototype.filter.call(mount.children, function (k) {
      var r = k.getBoundingClientRect();
      return r.width && r.height;
    });
    for (var k = 1; k < kids.length; k++) {
      var a = kids[k - 1].getBoundingClientRect();
      var b = kids[k].getBoundingClientRect();
      if (b.left >= a.right - TOL) continue;   // 并排的不算
      var gap = Math.round(b.top - a.bottom);
      if (gap < 8) {
        var w = mount.closest('[data-widget]');
        problems.push(
          '控件 ' + (w ? w.getAttribute('data-widget') : '?') +
          '：第 ' + k + ' 块（' + (kids[k-1].className || kids[k-1].tagName) + '）' +
          ' 和第 ' + (k + 1) + ' 块之间只有 ' + gap + 'px' +
          ' —— 多半是没套那层带 gap 的 wrapper',
        );
      }
    }
  });

  /* ⓪ app.js 到底跑没跑：每个 [data-mount] 都该被控件填满。
     踩过（2026-10-09）：compare 单元格里写了字面的 script 开标签（<script src=...>，构建期不会转义），
     单元格允许裸 HTML → 它成了**真标签**，把后面 app.js 的 <script>
     整个吞掉 → 全页 JS 没跑、所有控件空着、所有 flow/seq 没画 ——
     而 check 全绿、单块截图全正常（单块预览页不含全页脚本顺序，
     掩护了这个 bug）。挂载检查是这类事故的兜底。 */
  var mountsAll = document.querySelectorAll('[data-mount]');
  if (mountsAll.length) {
    var emptyMounts = 0;
    mountsAll.forEach(function (m) { if (m.children.length === 0) emptyMounts++; });
    if (emptyMounts === mountsAll.length) {
      problems.push(
        '全部 ' + mountsAll.length + ' 个 [data-mount] 都是空的 —— app.js 没跑或中途断了'
        + '（常见根因：正文单元格出现了字面的 script 开标签，吞掉了后面的 app.js）',
      );
    }
  }

  // ③ 区域框之间有没有重叠 / 有没有盖住非成员节点
  document.querySelectorAll('[data-flow]').forEach(function (root, i) {
    var boxes = Array.from(root.querySelectorAll('[data-group-box]')).filter(function (b) { return !b.hidden; });
    if (boxes.length < 2) return;
    var where = '[data-flow][' + i + ']';
    for (var a = 0; a < boxes.length; a++) {
      for (var b = a + 1; b < boxes.length; b++) {
        var ra = boxes[a].getBoundingClientRect();
        var rb2 = boxes[b].getBoundingClientRect();
        var ox = Math.min(ra.right, rb2.right) - Math.max(ra.left, rb2.left);
        var oy = Math.min(ra.bottom, rb2.bottom) - Math.max(ra.top, rb2.top);
        if (ox > TOL && oy > TOL) {
          problems.push(where + ' 区域框重叠：' +
            boxes[a].getAttribute('data-group-box') + ' ↔ ' + boxes[b].getAttribute('data-group-box') +
            '（重叠 ' + Math.round(Math.min(ox, oy)) + 'px）');
        }
      }
    }
  });

  // ⑤ flow：边有没有穿过无关节点、边标签有没有压在节点上
  /*
     真实踩过：把「前端」和「后端」放在同一 row，后端再往下连到两个库 ——
     于是 (a) 前端→后端这条同排边变成两个框之间的一小段水平线，
     标签「/api 原样转发」比间隙还宽，直接压到两个框上；
     (b) 后端往下走的边从旁边折过去，看着像从前端出发。

     ==光看截图分不清「真的穿过」还是「只是看着像」。== 所以这里真的算。
  */
  document.querySelectorAll('[data-flow]').forEach(function (root, i) {
    var svg = root.querySelector('.flowd-svg');
    if (!svg) return;
    var where = '[data-flow][' + i + ']';
    var sr = svg.getBoundingClientRect();
    if (!sr.width) return;

    /* 节点矩形。fnode 可能有多个（含 ficon 子元素），只取顶层那个。 */
    var nodes = Array.prototype.map.call(
      root.querySelectorAll('.fnode[data-id]'),
      function (el) { return { id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }; },
    );
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n.r; });

    /* SVG 的 viewBox 就是它自身尺寸（app.js 里设的），所以
       用户坐标 ↔ 屏幕坐标是 1:1 平移 —— 不用算缩放。 */
    function toScreen(pt) { return { x: sr.left + pt.x, y: sr.top + pt.y }; }
    function inside(r, x, y, inset) {
      return x > r.left + inset && x < r.right - inset &&
             y > r.top + inset && y < r.bottom - inset;
    }

    // (a) 边穿过无关节点
    Array.prototype.forEach.call(svg.querySelectorAll('path.fedge'), function (p) {
      var from = p.getAttribute('data-edge-from');
      var to = p.getAttribute('data-edge-to');
      /* 没有 data 属性 = 不能检查。**不能默默跳过** ——
         踩过：dist 是旧构建（app.js 改了但没重建），属性不存在，
         于是所有边都被跳过，“检查通过”。沉默的检查比没有检查更糟。 */
      if (!from || !to) {
        if (!window.__vcEdgeWarned) { window.__vcEdgeWarned = 1; }
        if (!problems.some(function (x) { return x.indexOf('边没有 data-edge') >= 0; })) {
          problems.push(
            where + ' 边没有 data-edge-from / to 属性，无法检查有没有穿过节点' + NL +
              '        → 多半是 dist 是旧构建（app.js 改了但没重建）。跑 npm run build:standalone。' + NL +
              '          如果重建后还这样，就是 app.js 里建边的那段代码掉了这两个属性',
          );
        }
        return;
      }
      var len = p.getTotalLength();
      if (!len) return;
      var step = Math.max(2, len / 400);   // 最多采 400 个点
      var hit = null;
      for (var d = 0; d <= len && !hit; d += step) {
        var s = toScreen(p.getPointAtLength(d));
        for (var k = 0; k < nodes.length; k++) {
          if (nodes[k].id === from || nodes[k].id === to) continue;
          // 内缩 3px：从节点旁边擦过不算
          if (inside(nodes[k].r, s.x, s.y, 3)) { hit = nodes[k].id; break; }
        }
      }
      if (hit) {
        problems.push(
          where + ' 边 ' + from + '→' + to + ' 穿过了无关节点「' + hit + '」' + NL +
            '        → 同一 row 上的节点不要各自往下连；改成纵向一条链，或者拆成两张图',
        );
      }
    });

    // (c) 边标签互相重叠
    /* 踩过：`stop→gone` 和 `gone→stop` 两个标签画在同一个空隙的同一条 y 上，
       叠成了「podmup.pod重建down」。而当时只查「标签 vs 节点」，报的是 ✓。
       两个标签叠在一起比压到节点上更难发现 —— 字还在，只是读不通。 */
    var labelRects = [];
    Array.prototype.forEach.call(svg.querySelectorAll('text.felabel'), function (t) {
      var r = t.getBoundingClientRect();
      if (r.width) labelRects.push({ t: (t.textContent || '').trim(), r: r });
    });
    for (var a1 = 0; a1 < labelRects.length; a1++) {
      for (var b1 = a1 + 1; b1 < labelRects.length; b1++) {
        var r1 = labelRects[a1].r, r2 = labelRects[b1].r;
        var ox1 = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
        var oy1 = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
        if (ox1 > TOL && oy1 > TOL) {
          problems.push(
            where + ' 两个边标签叠在一起：「' + labelRects[a1].t + '」↔「' + labelRects[b1].t +
              '」（重叠 ' + Math.round(Math.min(ox1, oy1)) + 'px）' + NL +
              '        → 多半是两条反向边（A→B 和 B→A）的标签落在同一个空隙里',
          );
        }
      }
    }

    // (b) 边标签压在节点上
    /* 同排两个节点之间的边，标签居中在间隙里 —— 间隙比标签窄就压上去了。
       这类错看着不报错、只是「字被挡住」，最容易滑过去。 */
    Array.prototype.forEach.call(svg.querySelectorAll('text.felabel'), function (t) {
      var tr = t.getBoundingClientRect();
      if (!tr.width) return;
      for (var k = 0; k < nodes.length; k++) {
        var r = nodes[k].r;
        var ox = Math.min(tr.right, r.right) - Math.max(tr.left, r.left);
        var oy = Math.min(tr.bottom, r.bottom) - Math.max(tr.top, r.top);
        if (ox > TOL && oy > TOL) {
          problems.push(
            where + ' 边标签「' + (t.textContent || '').trim() + '」压在节点「' + nodes[k].id +
              '」上（重叠 ' + Math.round(Math.min(ox, oy)) + 'px）' + NL +
              '        → 标签比两个节点之间的间隙宽。把节点拆到不同 row，或把标签改短',
          );
          break;
        }
      }
    });
  });

  // ⑥ 文字压文字 —— 全块通用
  /*
     用户原话：「线可能你判断线的重叠是比较有难度的，但判断文字重叠应该比较轻松」
     以及：「尽量不要出现文字被挡到的情况」。

     ==这里只查**文字 vs 文字**。== 文字被线/边框穿过不查 —— 那个要判断
     「这条线是不是本来就应该在那」，机器判不了，而且排查成本高于收益。

     为什么用 Range 取矩形，而不是拿父元素的 getBoundingClientRect：
       · 父元素带 padding，盒子比字大一圈，会把「挨着」误判成「压着」
       · 一段话跨行时，父盒子是一整个大方块，实际墨迹是好几条
       Range 给的是**每个文本节点自己的墨迹矩形**，跨行会返回多个，正好。

     踩过的真实漏检：flow 的群组标签和边标签叠在一起（字都在，只是读不通），
     而当时的检查只覆盖了 flow 的 `text.felabel`，其它积木一概没查。
  */
  (function () {
    var scopes = CONTAINERS.concat(['.memmap']);
    var rects = [];
    scopes.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (box) {
        /* archify 的图自己带校验器（会量文字宽度、查标签碰撞），
           而且 SVG 里有大量装饰性文字（图例、刻度），再查一遍全是噪声。 */
        if (box.closest('.archfig')) return;
        var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
        var n;
        while ((n = walker.nextNode())) {
          if (!n.nodeValue || !n.nodeValue.trim()) continue;
          var el = n.parentElement;
          if (!el) continue;
          var cs = window.getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
          var rg = document.createRange();
          rg.selectNodeContents(n);
          var rs = rg.getClientRects();
          for (var i = 0; i < rs.length; i++) {
            var rr = rs[i];
            if (rr.width < 2 || rr.height < 2) continue;
            rects.push({ r: rr, el: el, t: n.nodeValue.trim().slice(0, 26) });
          }
        }
      });
    });

    var seen = {};
    for (var a = 0; a < rects.length; a++) {
      for (var b = a + 1; b < rects.length; b++) {
        var A = rects[a], B = rects[b];
        if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
        var ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
        var oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
        if (ox <= TOL || oy <= TOL) continue;
        var key = A.t + '\u0000' + B.t;
        if (seen[key]) continue;
        seen[key] = 1;
        problems.push(
          '文字压文字：「' + A.t + '」↔「' + B.t + '」（重叠 ' +
            Math.round(Math.min(ox, oy)) + 'px）' + NL +
            '        → ' + (A.el.className || A.el.tagName) + ' 与 ' +
            (B.el.className || B.el.tagName) + ' 碰上了。' +
            '最常见的原因是标签比它所在的那条缝还宽',
        );
      }
    }
  })();

  // ④ 整页横向滚动
  var de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) {
    problems.push('整页横向滚动 ' + (de.scrollWidth - window.innerWidth) + 'px');
  }

  var pre = document.createElement('pre');
  pre.id = 'vc-result';
  pre.textContent = JSON.stringify(problems);
  document.body.appendChild(pre);
  } catch (err) {
    var e = document.createElement('pre');
    e.id = 'vc-result';
    e.setAttribute('data-probe-error', '1');
    e.textContent = JSON.stringify([
      '探针自己抛了异常：' + (err && err.message ? err.message : String(err)) +
        ' —— 这是 visual-check 的 bug，不是笔记的。位置：' +
        (err && err.stack ? String(err.stack).split(String.fromCharCode(10))[1] : '?'),
    ]);
    document.body.appendChild(e);
  }
}, 900);
