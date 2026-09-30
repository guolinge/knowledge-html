/* ============================================================
   app.js — 全站交互
   ------------------------------------------------------------
   1. 主题切换（跟随系统 + localStorage）
   2. 目录开合（宽屏收起 / 窄屏抽屉）
   3. 阅读进度条
   4. 目录滚动高亮
   5. 代码块复制
   6. 自测题（原生 <details>，这里只做增强）
   7. 交互演示控件注册表 WIDGETS
   ============================================================ */
(() => {
  /* localStorage 在隐私模式、部分 file:// 场景下会抛异常。
     统一包一层，失败就静默降级成「不记忆」，不阻断页面。 */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
  };

  /* createElement 简写：控件拼 DOM 用它，不用 innerHTML。
     内容虽然是写死的常量，但习惯一旦养成，真带用户输入时就会忘转义。 */
  function h(tag, opts, kids) {
    const el = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) el.className = opts.cls;
    if (opts.text !== undefined && opts.text !== null) el.textContent = String(opts.text);
    if (opts.attrs) Object.keys(opts.attrs).forEach((k) => el.setAttribute(k, opts.attrs[k]));
    (kids || []).forEach((k) => { if (k) el.appendChild(k); });
    return el;
  }
  /** 清空并填入子节点（不用 innerHTML） */
  function fill(el, kids) {
    while (el.firstChild) el.removeChild(el.firstChild);
    (kids || []).forEach((k) => el.appendChild(k));
  }

  /* ---------- 1. 主题 ---------- */
  (function theme() {
    const root = document.documentElement;
    const saved = store.get('kh-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));

    const btn = document.getElementById('themeBtn');
    if (btn) btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('kh-theme', next);
    });
  })();

  /* ---------- 2. 目录开合 ----------
     宽屏：目录是一列，收起时宽度变 0；窄屏：变成左侧抽屉。
     两者的开合状态都记在 <html data-toc> 上，样式在 theme.css。
  ------------------------------------------------ */
  (function tocToggle() {
    const root = document.documentElement;
    const btn = document.getElementById('tocBtn');
    if (!btn || root.getAttribute('data-has-toc') !== '1') return;

    const narrow = () => window.matchMedia('(max-width: 1080px)').matches;

    // 窄屏不恢复「展开」—— 否则一进页就弹抽屉
    root.setAttribute('data-toc', narrow() ? 'closed' : store.get('kh-toc') || 'open');

    function set(state) {
      root.setAttribute('data-toc', state);
      btn.setAttribute('aria-expanded', state === 'open' ? 'true' : 'false');
      store.set('kh-toc', state);
    }

    btn.addEventListener('click', () => {
      set(root.getAttribute('data-toc') === 'open' ? 'closed' : 'open');
    });

    // 窄屏点目录项后自动收起
    document.querySelectorAll('#toc a').forEach((a) =>
      a.addEventListener('click', () => { if (narrow()) set('closed'); }),
    );

    // 遮罩、Esc 关闭
    var scrim = document.getElementById('tocScrim');
    if (scrim) scrim.addEventListener('click', () => set('closed'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && narrow()) set('closed');
    });

    btn.setAttribute('aria-expanded', root.getAttribute('data-toc') === 'open' ? 'true' : 'false');
  })();

  /* ---------- 3. 阅读进度 ---------- */
  (function progress() {
    var bar = document.getElementById('progress');
    if (!bar) return;
    function update() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  })();

  /* ---------- 4. 目录滚动高亮 ---------- */
  (function scrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('#toc a'));
    if (!links.length) return;
    /* 目录里混着非锚点链接（如「← 全部笔记」），它的 href 不是合法选择器，
       直接丢给 querySelector 会抛错 —— 而抛在这里会把后面所有初始化（复制、
       quiz、所有 demo 控件）一起带走。所以先筛成锚点，再用 getElementById 找目标。 */
    var anchors = links.filter((a) => (a.getAttribute('href') || '').startsWith('#'));
    var targets = anchors
      .map((a) => document.getElementById((a.getAttribute('href') || '').slice(1)))
      .filter(Boolean);
    if (!targets.length) return;

    function update() {
      var y = window.scrollY + 110;
      var current = targets[0];
      targets.forEach((t) => { if (t.offsetTop <= y) current = t; });
      anchors.forEach((a) => {
        a.classList.toggle('active', !!current && a.getAttribute('href') === '#' + current.id);
      });
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  })();

  /* ---------- 5. 复制 ---------- */
  (function copy() {
    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pre = btn.parentElement.querySelector('pre');
        const text = pre ? pre.innerText : '';
        function done() {
          btn.textContent = '已复制';
          setTimeout(() => { btn.textContent = '复制'; }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch { /* 忽略 */ }
          document.body.removeChild(ta); done();
        }
      });
    });
  })();

  /* ---------- 6. 自测题：只允许同时展开一题，避免一口气看答案 ---------- */
  (function quiz() {
    document.querySelectorAll('.quiz').forEach((box) => {
      var items = box.querySelectorAll('details');
      items.forEach((d) => {
        d.addEventListener('toggle', () => {
          if (!d.open) return;
          items.forEach((o) => { if (o !== d) o.open = false; });
        });
      });
    });
  })();

  /* ---------- 7. 交互演示控件注册表 ----------
     新增控件：WIDGETS['名字'] = function (root, opts) { ... }
     在 note.md 里用：
       ```demo
       widget: 名字
       title: 标题
       ```
  ------------------------------------------------ */
  var WIDGETS = {};

  /* —— 控件：轮询 vs CDC —— */
  WIDGETS['polling-vs-cdc'] = (root) => {
    var STEP = 620;
    var EVENTS = [
      { t: 0,  type: 'INSERT', text: '新增订单 A001（待支付）' },
      { t: 3,  type: 'UPDATE', text: 'A001：待支付 → 已支付' },
      { t: 6,  type: 'UPDATE', text: 'A001：已支付 → 已发货' },
      { t: 9,  type: 'DELETE', text: '删除测试订单 A002' },
      { t: 12, type: 'UPDATE', text: 'A001：已发货 → 已完成' },
      { t: 15, type: 'INSERT', text: '新增订单 A003（待支付）' }
    ];
    var POLLS = [
      { t: 0,  warn: false, text: '查到 A001 = 待支付' },
      { t: 10, warn: true,  text: '查到 A001 = 已发货。中间「已支付」状态从未被同步；A002 的删除在增量查询下不可见' },
      { t: 20, warn: false, text: '查到 A001 = 已完成、A003 = 待支付，但已经晚了最多 10 分钟' }
    ];

    var pollLog = root.querySelector('[data-log="poll"]');
    var cdcLog  = root.querySelector('[data-log="cdc"]');
    var statusEl = root.querySelector('[data-status]');
    var runBtn  = root.querySelector('[data-run]');
    var resetBtn = root.querySelector('[data-reset]');
    var timers = [];

    function addLine(box, badge, tone, time, text, warn) {
      var el = document.createElement('div');
      el.className = 'line' + (warn ? ' warn' : '');

      var b = document.createElement('span');
      b.className = 'badge tone-' + tone;
      b.textContent = badge;

      var tm = document.createElement('span');
      tm.className = 'time';
      tm.textContent = time;

      var tx = document.createElement('span');
      tx.className = 'txt';
      tx.textContent = text;

      el.append(b, tm, tx);
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function reset() {
      clearTimers();
      pollLog.innerHTML = ''; cdcLog.innerHTML = '';
      statusEl.textContent = '未开始';
      runBtn.disabled = false; runBtn.textContent = '▶ 开始模拟';
    }

    function run() {
      reset();
      runBtn.disabled = true; runBtn.textContent = '模拟中…';
      statusEl.textContent = 't = 0 分钟';

      EVENTS.forEach((e) => {
        timers.push(setTimeout(() => {
          addLine(cdcLog, e.type, e.type.toLowerCase() === 'delete' ? 'red'
                 : e.type === 'insert' ? 'green' : 'blue', 't=' + e.t + 'min', e.text, false);
          statusEl.textContent = 't = ' + e.t + ' 分钟';
        }, e.t * STEP + 40));
      });
      POLLS.forEach((p) => {
        timers.push(setTimeout(() => {
          addLine(pollLog, 'POLL', 'amber', 't=' + p.t + 'min', p.text, p.warn);
        }, p.t * STEP + 200));
      });
      timers.push(setTimeout(() => {
        statusEl.textContent = '模拟结束 · 共 6 次真实变更，轮询只看到 3 个时间点';
        runBtn.disabled = false; runBtn.textContent = '▶ 再跑一次';
      }, 22 * STEP));
    }

    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', reset);
  };

  /* —— 控件：条件组合怎么变成 AND / OR ——
     演示 Combination.combineSql 的核心机制：
       UNION ALL 把各条件的 uid 堆在一起 → GROUP BY uid 计数 → HAVING 筛选
     OR   = 不加 HAVING（任一条命中）
     AND  = HAVING count = 子查询数（每一条都命中）
     自定义 = HAVING count >= N（至少 N 个条件命中）
  ------------------------------------------------ */
  WIDGETS['combination-count'] = (root) => {
    const sqlBox = root.querySelector('[data-cc-sql]');
    const countBox = root.querySelector('[data-cc-count]');
    const statusEl = root.querySelector('[data-status]');
    const rows = Array.from(root.querySelectorAll('[data-cc-row]'));
    const buttons = Array.from(root.querySelectorAll('[data-cc-mode]'));

    const N = 3; // 条件个数
    const SUB = ['A', 'B', 'C'].map(
      (_k, i) => `SELECT \`uid\` FROM ${['event_add_cart', 'user_portrait', 'crowds'][i]} WHERE ...`,
    );

    const MODES = {
      or: {
        label: 'OR',
        having: null,
        hint: '不加 HAVING：任一条子查询命中就保留',
        desc: '任一条件命中',
      },
      and: {
        label: 'AND',
        having: `HAVING count(\`uid\`) = ${N}`,
        hint: `HAVING count(uid) = ${N}：必须在 ${N} 个子查询里都出现`,
        desc: '全部条件命中',
      },
      n2: {
        label: '至少 2 个',
        having: 'HAVING count(`uid`) >= 2',
        hint: 'HAVING count(uid) >= 2：至少 2 个条件命中（unionCount 写法）',
        desc: '自定义数量',
      },
    };

    function render(mode) {
      const cfg = MODES[mode];
      buttons.forEach((b) => b.classList.toggle('on', b.getAttribute('data-cc-mode') === mode));

      let hit = 0;
      rows.forEach((tr) => {
        const n = Number(tr.getAttribute('data-count'));
        let keep;
        if (mode === 'or') keep = n >= 1;
        else if (mode === 'and') keep = n === N;
        else keep = n >= 2;
        tr.classList.toggle('keep', keep);
        tr.classList.toggle('drop', !keep);
        if (keep) hit++;
      });

      countBox.textContent = String(hit);
      statusEl.textContent = cfg.desc;
      sqlBox.textContent =
        'SELECT UID_DECODE(`uid`) as `uid`\nFROM (\n  ' +
        SUB.join('\n  UNION ALL\n  ') +
        '\n) ct1\nGROUP BY `uid`' +
        (cfg.having ? '\n' + cfg.having : '') +
        '\n\n-- ' +
        cfg.hint;
    }

    buttons.forEach((b) =>
      b.addEventListener('click', () => render(b.getAttribute('data-cc-mode'))),
    );
    render('or');
  };

  /* —— 控件：join-lab ——
     同一份数据，切换 5 种 JOIN，看「哪些行被留下」。
     左边是两列行 + 配对连线（坐标实测，不写死）；右边是结果表；下面是 SQL。
     数据固定成 3 用户 × 4 订单，所以连线逻辑可以写成一张常量表。 */
  WIDGETS['join-lab'] = (root) => {
    var NS = 'http://www.w3.org/2000/svg';

    var USERS = [
      { key: 'u1', id: '1', name: '小明' },
      { key: 'u2', id: '2', name: '小红' },
      { key: 'u3', id: '3', name: '小刚' },
    ];
    var ORDERS = [
      { key: 'o101', id: '101', uid: '1', product: '键盘' },
      { key: 'o102', id: '102', uid: '1', product: '鼠标' },
      { key: 'o103', id: '103', uid: '2', product: '显示器' },
      { key: 'o104', id: '104', uid: '99', product: '测试商品' },
    ];
    // ON users.id = orders.user_id 能配上的三对
    var MATCH = [['u1', 'o101'], ['u1', 'o102'], ['u2', 'o103']];

    var MODES = [
      {
        id: 'inner', label: 'INNER JOIN', tone: 'blue',
        rule: '配不上的行，两边都丢掉。',
        stat: '结果 3 行 · 丢掉「小刚」和「订单 104」',
        sql: 'SELECT u.name, o.product\nFROM users u\nINNER JOIN orders o\n  ON u.id = o.user_id;',
      },
      {
        id: 'left', label: 'LEFT JOIN', tone: 'green',
        rule: '左表全部保留；右表配不上就填 NULL。',
        stat: '结果 4 行 · 只丢掉「订单 104」',
        sql: 'SELECT u.name, o.product\nFROM users u\nLEFT JOIN orders o\n  ON u.id = o.user_id;',
      },
      {
        id: 'right', label: 'RIGHT JOIN', tone: 'violet',
        rule: '右表全部保留；左表配不上就填 NULL。',
        stat: '结果 4 行 · 只丢掉「小刚」',
        sql: 'SELECT u.name, o.product\nFROM users u\nRIGHT JOIN orders o\n  ON u.id = o.user_id;',
      },
      {
        id: 'full', label: 'FULL OUTER JOIN', tone: 'amber',
        rule: '两边都全部保留；谁配不上就填 NULL。MySQL 不直接支持，要 UNION 拼。',
        stat: '结果 5 行 · 谁都不丢',
        sql: '-- MySQL 没有 FULL OUTER JOIN，只能拼两半\nSELECT u.name, o.product\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nUNION\nSELECT u.name, o.product\nFROM users u\nRIGHT JOIN orders o ON u.id = o.user_id;',
      },
      {
        id: 'cross', label: 'CROSS JOIN', tone: 'red',
        rule: '不写 ON，左表每一行 × 右表每一行，全组合。',
        stat: '结果 12 行 = 3 用户 × 4 订单',
        sql: 'SELECT u.name, o.product\nFROM users u\nCROSS JOIN orders o;   -- 没有 ON，3 × 4 = 12 行',
      },
    ];

    var stage = root.querySelector('[data-jl-stage]');
    var svg = root.querySelector('[data-jl-lines]');
    var colUsers = root.querySelector('[data-jl-col="users"]');
    var colOrders = root.querySelector('[data-jl-col="orders"]');
    var modesBox = root.querySelector('[data-jl-modes]');
    var ruleEl = root.querySelector('[data-jl-rule]');
    var outHead = root.querySelector('[data-jl-outhead]');
    var tableBox = root.querySelector('[data-jl-table]');
    var sqlEl = root.querySelector('[data-jl-sql]');
    var statusEl = root.querySelector('[data-status]');

    var byKey = (list, k) => list.find((x) => x.key === k);
    var cur = 'inner';

    /* ---- 每个模式下：哪些行留下来、哪些连线存在 ---- */
    function linksFor(id) {
      if (id !== 'cross') return MATCH;
      var all = [];
      USERS.forEach((u) => ORDERS.forEach((o) => all.push([u.key, o.key])));
      return all;
    }
    function stateFor(id) {
      var links = {}, users = {}, orders = {};
      linksFor(id).forEach((p) => {
        links[p[0] + '|' + p[1]] = 1; users[p[0]] = 1; orders[p[1]] = 1;
      });
      if (id === 'left' || id === 'full') users.u3 = 1;      // 左表落单
      if (id === 'right' || id === 'full') orders.o104 = 1;  // 右表落单
      return { links: links, users: users, orders: orders };
    }
    function rowsFor(id) {
      if (id === 'cross') {
        var grid = [];
        USERS.forEach((u) => ORDERS.forEach((o) => grid.push({ u: u, o: o, kind: 'cross' })));
        return grid;
      }
      var rows = MATCH.map((p) => ({ u: byKey(USERS, p[0]), o: byKey(ORDERS, p[1]), kind: 'match' }));
      if (id === 'left' || id === 'full') rows.push({ u: byKey(USERS, 'u3'), o: null, kind: 'lone' });
      if (id === 'right' || id === 'full') rows.push({ u: null, o: byKey(ORDERS, 'o104'), kind: 'lone' });
      return rows;
    }

    /* ---- 左：两列行 ---- */
    function buildCol(colEl, rows, side) {
      fill(colEl, [h('div', { cls: 'jl-col-head', text: side === 'users' ? 'users' : 'orders' })]);
      rows.forEach((r) => {
        const kids = [h('b', { text: r.id })];
        if (side === 'orders') kids.push(h('i', { text: 'u' + r.uid }));
        kids.push(h('span', { text: side === 'users' ? r.name : r.product }));
        colEl.appendChild(h('div', { cls: 'jl-row', attrs: { 'data-row': r.key } }, kids));
      });
    }

    /* ---- 配对连线：坐标实测，宽屏窄屏都不会错位 ---- */
    function svgNode(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    }
    function drawLines(id) {
      var box = stage.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return;
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      linksFor(id).forEach((p) => {
        var uEl = stage.querySelector('[data-row="' + p[0] + '"]');
        var oEl = stage.querySelector('[data-row="' + p[1] + '"]');
        if (!uEl || !oEl) return;
        var ur = uEl.getBoundingClientRect();
        var orr = oEl.getBoundingClientRect();
        var sx = ur.right - box.left, sy = ur.top - box.top + ur.height / 2;
        var tx = orr.left - box.left, ty = orr.top - box.top + orr.height / 2;
        var dx = Math.max(10, Math.abs(tx - sx) * 0.45);
        var cls = id === 'cross' ? ' cross' : '';
        svg.appendChild(svgNode('path', {
          class: 'jl-link' + cls,
          d: 'M ' + sx + ' ' + sy + ' C ' + (sx + dx) + ' ' + sy + ', ' +
             (tx - dx) + ' ' + ty + ', ' + tx + ' ' + ty,
        }));
        [[sx, sy], [tx, ty]].forEach((pt) =>
          svg.appendChild(svgNode('circle', { class: 'jl-dot' + cls, cx: pt[0], cy: pt[1], r: 2.6 })),
        );
      });
    }

    /* ---- 右：结果表 ---- */
    function renderTable(id) {
      const rows = rowsFor(id);
      const head = h('tr', null, ['u.name', 'o.product', '这行怎么来的']
        .map((t) => h('th', { text: t })));
      const body = rows.map((r) => {
        let tag;
        if (r.kind === 'match') tag = h('span', { cls: 'tag tone-green', text: '匹配' });
        else if (r.kind === 'cross') tag = h('span', { cls: 'tag tone-red', text: '组合' });
        else tag = h('span', {
          cls: 'tag tone-amber',
          text: r.u ? '左表独有 · 补 NULL' : '右表独有 · 补 NULL',
        });
        return h('tr', { cls: r.kind === 'match' ? '' : r.kind }, [
          h('td', r.u ? { text: r.u.name } : { cls: 'nul', text: 'NULL' }),
          h('td', r.o ? { text: r.o.product } : { cls: 'nul', text: 'NULL' }),
          h('td', null, [tag]),
        ]);
      });
      fill(tableBox, [h('div', { cls: 'mini-wrap' }, [
        h('table', { cls: 'mini-table' }, [h('thead', null, [head]), h('tbody', null, body)]),
      ])]);
      outHead.textContent = '② 结果表 · ' + rows.length + ' 行';
    }

    function render(id) {
      cur = id;
      const cfg = MODES.find((m) => m.id === id);
      var st = stateFor(id);

      Array.prototype.forEach.call(modesBox.children, (b) =>
        b.classList.toggle('on', b.getAttribute('data-jl-mode') === id));
      ruleEl.className = 'seg-rule tone-' + cfg.tone;
      ruleEl.textContent = cfg.rule;

      [[colUsers, 'users'], [colOrders, 'orders']].forEach((pair) => {
        var colEl = pair[0], side = pair[1];
        Array.prototype.forEach.call(colEl.querySelectorAll('.jl-row'), (el) => {
          var key = el.getAttribute('data-row');
          var keep = side === 'users' ? st.users[key] : st.orders[key];
          var alone = (side === 'users' && key === 'u3') || (side === 'orders' && key === 'o104');
          el.classList.toggle('drop', !keep);
          el.classList.toggle('lone', alone && id !== 'cross');
        });
      });

      drawLines(id);
      renderTable(id);
      sqlEl.textContent = cfg.sql;
      if (statusEl) statusEl.textContent = cfg.stat;
    }

    /* ---- 装配 ---- */
    buildCol(colUsers, USERS, 'users');
    buildCol(colOrders, ORDERS, 'orders');
    MODES.forEach((m) => {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tone-' + m.tone;
      b.textContent = m.label;
      b.setAttribute('data-jl-mode', m.id);
      b.addEventListener('click', () => render(m.id));
      modesBox.appendChild(b);
    });

    var raf = 0;
    function redraw() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawLines(cur));
    }
    window.addEventListener('resize', redraw);
    if (window.ResizeObserver) new ResizeObserver(redraw).observe(stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);

    render('inner');
    redraw();
  };

  /* —— 控件：on-vs-where ——
     同一个过滤条件 o.status = 'PAID'，写在 ON 里和写在 WHERE 里，结果不一样。
     4 行候选结果的「命运」列成矩阵，切换时高亮当前那一列。 */
  WIDGETS['on-vs-where'] = (root) => {
    // LEFT JOIN 之后可能出现的全部 4 行。订单 104 永远进不来（它在右表、且没人要保留它）。
    var CAND = [
      { u: '小明', o: '键盘', st: "'PAID'",
        on: { t: '保留', tone: 'green' },
        wh: { t: '保留', tone: 'green' } },
      { u: '小明', o: '鼠标', st: "'UNPAID'",
        on: { t: '没配上 · 这行不存在', tone: 'muted' },
        wh: { t: '✕ 被过滤', tone: 'red' } },
      { u: '小红', o: '显示器', st: "'PAID'",
        on: { t: '保留', tone: 'green' },
        wh: { t: '保留', tone: 'green' } },
      { u: '小刚', o: 'NULL', st: 'NULL',
        on: { t: '保留 · 补 NULL', tone: 'amber' },
        wh: { t: '✕ 被过滤', tone: 'red' } },
    ];

    var MODES = {
      on: {
        label: '写在 ON 里',
        rule: '过滤条件参与配对：配不上的行，LEFT JOIN 照样保留。',
        stat: '结果 3 行 · 小刚还在',
        sql: "SELECT u.name, o.product\nFROM users u\nLEFT JOIN orders o\n  ON u.id = o.user_id\n AND o.status = 'PAID';   -- 过滤写在 ON 里",
      },
      wh: {
        label: '写在 WHERE 里',
        rule: '过滤条件在 JOIN 之后才生效：补出来的 NULL 不满足条件，整行被删。',
        stat: '结果 2 行 · 小刚被干掉了',
        sql: "SELECT u.name, o.product\nFROM users u\nLEFT JOIN orders o\n  ON u.id = o.user_id\nWHERE o.status = 'PAID';  -- 过滤写在 WHERE 里",
      },
    };

    var modesBox = root.querySelector('[data-ow-modes]');
    var matrix = root.querySelector('[data-ow-matrix]');
    var sqlEl = root.querySelector('[data-ow-sql]');
    var ruleEl = root.querySelector('[data-ow-rule]');
    var statusEl = root.querySelector('[data-status]');

    function tagEl(c) {
      return h('span', { cls: 'tag tone-' + c.tone, text: c.t });
    }
    function colCls(mode, mine) {
      return 'col' + (mode === mine ? ' on' : '');
    }

    function render(mode) {
      Array.prototype.forEach.call(modesBox.children, (b) =>
        b.classList.toggle('on', b.getAttribute('data-ow-mode') === mode));

      const thead = h('tr', null, [
        h('th', { text: 'LEFT JOIN 之后可能出现的行' }),
        h('th', { text: 'o.status' }),
        h('th', { cls: colCls(mode, 'on'), text: '写在 ON 里' }),
        h('th', { cls: colCls(mode, 'wh'), text: '写在 WHERE 里' }),
      ]);
      const body = CAND.map((r) => h('tr', null, [
        h('th', { text: r.u + ' · ' + r.o }),
        h('td', { text: r.st }),
        h('td', { cls: colCls(mode, 'on') }, [tagEl(r.on)]),
        h('td', { cls: colCls(mode, 'wh') }, [tagEl(r.wh)]),
      ]));
      body.push(h('tr', { cls: 'sum' }, [
        h('th', { text: '结果行数' }),
        h('td'),
        h('td', { cls: colCls(mode, 'on'), text: '3' }),
        h('td', { cls: colCls(mode, 'wh') }, [h('span', { cls: 'gone', text: '2' })]),
      ]));

      fill(matrix, [h('div', { cls: 'mini-wrap plain' }, [
        h('table', { cls: 'ow-matrix' }, [h('thead', null, [thead]), h('tbody', null, body)]),
      ])]);

      ruleEl.className = 'seg-rule tone-' + (mode === 'on' ? 'green' : 'amber');
      ruleEl.textContent = MODES[mode].rule;
      sqlEl.textContent = MODES[mode].sql;
      if (statusEl) statusEl.textContent = MODES[mode].stat;
    }

    Object.keys(MODES).forEach((k) => {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = k === 'on' ? 'tone-green' : 'tone-red';
      b.textContent = MODES[k].label;
      b.setAttribute('data-ow-mode', k);
      b.addEventListener('click', () => render(k));
      modesBox.appendChild(b);
    });
    render('on');
  };

  /* ---------- 8. 流程图连线 ----------
     节点用 flex 排版，这里测量它们的位置，再把连线画成 SVG 路径。
     好处：文字多长都不用调坐标，换行/窄屏自动重算。
  ------------------------------------------------ */
  (function flowDiagram() {
    const roots = Array.from(document.querySelectorAll('[data-flow]'));
    if (!roots.length) return;

    function draw(root) {
      const svg = root.querySelector('.flowd-svg');
      const grid = root.querySelector('.flowd-grid');
      if (!svg || !grid) return;

      let edges = [];
      try { edges = JSON.parse(root.getAttribute('data-edges') || '[]'); } catch { edges = []; }

      // ⚠️ 节点的 offsetTop/Left 是相对 .flowd-grid 的，
      // 而 SVG 和区域框是相对 .flowd 定位的（inset:0 填的是 padding box）。
      // 所以必须加上 grid 自身的偏移 —— 否则 .flowd 一有 padding 就会错位。
      const gx = grid.offsetLeft;
      const gy = grid.offsetTop;

      const nodes = {};
      root.querySelectorAll('.fnode').forEach((el) => {
        const t = gy + el.offsetTop;
        const l = gx + el.offsetLeft;
        nodes[el.getAttribute('data-id')] = {
          cx: l + el.offsetWidth / 2,
          cy: t + el.offsetHeight / 2,
          top: t,
          bottom: t + el.offsetHeight,
          left: l,
          right: l + el.offsetWidth,
          h: el.offsetHeight,
        };
      });

      // ---- 区域框 ----
      // 先算每个框的「成员包围盒」（不含 padding），再统一决定水平留白。
      //
      // 为什么不能直接用固定 padding：
      //   .flowd-row 是「每行独立居中」，所以同一组的节点跨行时会水平错位
      //   （行总宽不同 → 居中起点不同）。结果两组的包围盒可能只差 2px，
      //   而框要往外扩 20px → 必然重叠。
      // 所以这里先按名义留白算，检测到重叠就整体收缩，直到不重叠。
      const PAD_Y = 20;      // 上下留白（放标签 + 呼吸）
      const PAD_X_MAX = 18;  // 左右名义留白

      const boxes = [];
      root.querySelectorAll('[data-group-box]').forEach((boxEl) => {
        const gid = boxEl.getAttribute('data-group-box');
        const members = Array.from(root.querySelectorAll(`.fnode[data-group="${gid}"]`));
        if (!members.length) { boxEl.hidden = true; return; }
        boxEl.hidden = false;
        boxes.push({
          el: boxEl,
          minL: Math.min(...members.map((m) => gx + m.offsetLeft)),
          maxR: Math.max(...members.map((m) => gx + m.offsetLeft + m.offsetWidth)),
          minT: Math.min(...members.map((m) => gy + m.offsetTop)),
          maxB: Math.max(...members.map((m) => gy + m.offsetTop + m.offsetHeight)),
        });
      });

      // 水平留白自适应：找到让所有框互不重叠的最大值
      let padX = PAD_X_MAX;
      const overlaps = (p) => {
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            if (a.minL - p < b.maxR + p && b.minL - p < a.maxR + p) return true;
          }
        }
        return false;
      };
      while (padX > 0 && overlaps(padX)) padX -= 2;

      boxes.forEach((b) => {
        const top = b.minT - PAD_Y - 8;
        const left = b.minL - padX;
        const right = b.maxR + padX;
        const bottom = b.maxB + PAD_Y;
        b.el.style.top = `${top}px`;
        b.el.style.left = `${left}px`;
        b.el.style.width = `${right - left}px`;
        b.el.style.height = `${bottom - top}px`;
      });

      // viewBox 用 SVG 元素自身尺寸 —— 用 grid 的尺寸会让 preserveAspectRatio
      // 做一次等比缩放+居中，和节点坐标对不上。
      const W = svg.clientWidth || root.clientWidth;
      const H = svg.clientHeight || root.clientHeight;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      // 同一对节点之间可能有多条边（或同一目标有多条汇入），
      // 给它们一个水平偏移，否则会完全重叠
      const pairCount = {};
      for (const e of edges) {
        const k = `${e.from}->${e.to}`;
        pairCount[k] = (pairCount[k] || 0) + 1;
      }
      const pairSeen = {};
      /* 标签错位要按「**同一个空隙**」算，不是按「同一对节点」。

         踩过：`stop→gone` 和 `gone→stop` 是不同的节点对，却把标签画在
         同一个空隙、同一个 y 上 —— 两者的 idx 都是 0，于是两个标签
         重叠成乱码（「podmup.pod重建down」），而 visual-check 那时
         还只查「标签 vs 节点」，报的是 ✓。

         所以 key 用「这条边标签会落在哪」（坐标取整），同一处的第二个标签往下错 15px。 */
      const labelSpots = {};

      const parts = [];
      for (const e of edges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;

        const pk = `${e.from}->${e.to}`;
        const idx = pairSeen[pk] = (pairSeen[pk] || 0);
        pairSeen[pk] += 1;
        // 同对多边时，向外散开
        const spread = pairCount[pk] > 1 ? (idx - (pairCount[pk] - 1) / 2) * 26 : 0;

        let d;
        let lx;
        let ly;

        // 自环：状态不变但有事件触发，画成节点上方的一个弧
        if (e.self || e.from === e.to) {
          const r = 30;
          d = `M ${a.cx - 16} ${a.top} C ${a.cx - 34} ${a.top - r * 1.7}, ${a.cx + 34} ${
            a.top - r * 1.7
          }, ${a.cx + 16} ${a.top}`;
          lx = a.cx;
          ly = a.top - r * 1.32;   // 标签放在弧顶上方，不压线
          const cls0 = ['fedge', 'self', e.dashed && 'dashed', e.anim && 'anim']
            .filter(Boolean)
            .join(' ');
          parts.push(`<path class="${cls0}" d="${d}"/>`);
          if (e.on || e.label) {
            parts.push(
              `<text class="felabel" x="${lx}" y="${ly}">${escapeXml(e.on || e.label)}</text>`,
            );
          }
          continue;
        }

        const vertical = Math.abs(b.cy - a.cy) > (a.h + b.h) / 2 + 6;
        if (vertical) {
          const y1 = a.cy < b.cy ? a.bottom : a.top;
          const y2 = a.cy < b.cy ? b.top : b.bottom;
          const my = (y1 + y2) / 2;
          const ox = a.cx + spread;
          const ix = b.cx + spread;
          d = `M ${a.cx} ${y1} C ${ox} ${my}, ${ix} ${my}, ${b.cx} ${y2}`;
          lx = (ox + ix) / 2;
          ly = my + idx * 13;   // 标签也错开，不互相压
        } else {
          const [l, r] = a.cx < b.cx ? [a, b] : [b, a];
          const mx = (l.right + r.left) / 2;
          d = `M ${l.right} ${l.cy} C ${mx} ${l.cy}, ${mx} ${r.cy}, ${r.left} ${r.cy}`;
          lx = mx;
          ly = (l.cy + r.cy) / 2 - 7;
        }

        /* 同一位置已经有标签了，就往下错开。
           （spread 已经把边上分开了，标签再跟着错。） */
        const spotKey = Math.round(lx) + ':' + Math.round(ly / 13);
        const spot = labelSpots[spotKey] = labelSpots[spotKey] || 0;
        labelSpots[spotKey] += 1;
        if (spot) ly += spot * 15;

        const cls = ['fedge', e.dashed && 'dashed', e.anim && 'anim'].filter(Boolean).join(' ');
        /* data-edge-from / to 不只是给「聚焦」用的 ——
           visual-check 靠它判断一条边连的是谁，才能查出「边穿过了无关节点」。
           属性名跟 archify 的 SVG 保持一致（那边也是这两个名字）。 */
        parts.push(
          `<path class="${cls}" data-edge-from="${escapeXml(e.from)}" data-edge-to="${escapeXml(e.to)}" ` +
            `d="${d}"${e.tone ? ` style="color:var(--${e.tone})"` : ''}${
              e.both ? ' marker-start="url(#fa)"' : ''
            }/>`,
        );
        const edgeText = e.on || e.label;
        if (edgeText) {
          parts.push(`<text class="felabel" x="${lx}" y="${ly}">${escapeXml(edgeText)}</text>`);
        }
      }
      svg.innerHTML = svg.querySelector('defs').outerHTML + parts.join('');
    }

    function escapeXml(s) {
      return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    }

    function drawAll() { roots.forEach(draw); }

    drawAll();
    window.addEventListener('resize', drawAll);
    // 字体加载完宽度会变，重画一次
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
  })();

  /* —— 控件：knex 链式调用到底在干什么 ——
     点方法按钮 → 看内部状态累积；点 rawQuery() → 才编译成 SQL。
     要讲清的就一件事：==链式调用不生成 SQL，取值时才编译。==
  ------------------------------------------------ */
  WIDGETS['knex-chain'] = (root) => {
    const stateBox = root.querySelector('[data-kc-state]');
    const sqlBox = root.querySelector('[data-kc-sql]');
    const hintBox = root.querySelector('[data-kc-hint]');
    const btns = Array.from(root.querySelectorAll('[data-kc-step]'));
    const statusEl = root.querySelector('[data-status]');

    const STEPS = {
      select: { state: { columns: ['uid'] }, hint: '只是把「要查哪些列」记在对象上' },
      from: { state: { table: 'user_portrait' }, hint: '再把「查哪张表」记上去' },
      where: { state: { where: [['uid', 'in', [1, 2, 3]]] }, hint: '再把「筛选条件」记上去' },
    };
    const ORDER = ['select', 'from', 'where'];

    const SQL_PLACEHOLDER =
      'select `uid` from `user_portrait` where (`uid` in (?))';
    const SQL_INLINED =
      'select `uid` from `user_portrait` where (`uid` in (1, 2, 3))';

    let applied = [];   // 只放 select / from / where
    let compiled = false; // 是否已调过 rawQuery()

    function renderState() {
      if (!applied.length) {
        stateBox.textContent = '{}   // 空空如也';
        return;
      }
      const merged = {};
      applied.forEach((k) => Object.assign(merged, STEPS[k].state));
      stateBox.textContent = JSON.stringify(merged, null, 2);
    }

    function render() {
      renderState();
      const done = applied.length === ORDER.length;
      btns.forEach((b) => {
        const k = b.getAttribute('data-kc-step');
        if (k === 'raw') {
          b.classList.toggle('on', compiled);
          b.disabled = !done;
        } else {
          b.classList.toggle('on', applied.includes(k));
          b.disabled = applied.includes(k);
        }
      });

      if (compiled) {
        sqlBox.textContent = SQL_INLINED;
        hintBox.textContent =
          '✅ rawQuery() 触发了编译：加反引号 + 值内联。这才是最终交给数据库的东西。';
        statusEl.textContent = '已编译';
      } else if (done) {
        sqlBox.textContent = SQL_PLACEHOLDER;
        hintBox.textContent =
          '🔍 三个方法都调完了，但 SQL 里的值还是 ? —— 因为还没取值。点 .rawQuery() 试试。';
        statusEl.textContent = '状态齐了，还没编译';
      } else {
        sqlBox.textContent = '// 还没编译。链式调用只往对象上记东西，不生成 SQL。';
        hintBox.textContent = '点上面的方法，看内部状态怎么一点点攒起来。';
        statusEl.textContent = '攒状态中';
      }
    }

    btns.forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.getAttribute('data-kc-step');
        if (k === 'raw') {
          compiled = !compiled;
        } else {
          compiled = false; // 改了链式调用，之前的编译结果作废
          applied.includes(k)
            ? applied.splice(applied.indexOf(k), 1)
            : applied.push(k);
        }
        render();
      }),
    );

    render();
  };

  /* ---------- 9. 时序图 ----------
     参与者横排，时间向下，消息是水平箭头。
     lifeline（虚线）和消息箭头都画在 SVG 里，标签用 HTML 居中。
  ------------------------------------------------ */
  (function sequenceDiagram() {
    const roots = Array.from(document.querySelectorAll('[data-seq]'));
    if (!roots.length) return;

    function draw(root) {
      const svg = root.querySelector('.seqd-svg');
      const head = root.querySelector('.seqd-head');
      const body = root.querySelector('.seqd-body');
      if (!svg || !head || !body) return;

      // 每个参与者的中心 x（grid 均分，所以可以直接算）
      const n = Number(root.getAttribute('data-n')) || 1;
      const W = head.offsetWidth;
      const cellW = W / n;
      const cx = {};
      root.querySelectorAll('.spart').forEach((el, i) => {
        const id = el.getAttribute('data-id');
        cx[id] = i * cellW + cellW / 2;
      });

      const headH = head.offsetHeight;
      const bodyH = body.offsetHeight;
      const totalH = headH + 18 + bodyH;
      svg.setAttribute('viewBox', `0 0 ${W} ${totalH}`);
      svg.setAttribute('width', W);
      svg.setAttribute('height', totalH);

      const parts = [];
      const lifelines = [];   // 先攒着 —— 激活条要压在生命线上面
      const acts = [];        // 激活条
      const segBoxes = [];    // 时间段框
      const msgGeom = [];     // 每条消息的 { i, from, to, y }

      // 1) lifeline：从头部底部到主体底部
      const lifeTop = headH + 6;
      const lifeBottom = headH + 18 + bodyH;
      Object.values(cx).forEach((x) => {
        lifelines.push(
          `<line class="lifeline" x1="${x}" y1="${lifeTop}" x2="${x}" y2="${lifeBottom}"/>`,
        );
      });

      // 2) 消息箭头
      root.querySelectorAll('.smsg').forEach((row) => {
        const from = row.getAttribute('data-from');
        const to = row.getAttribute('data-to');
        const kind = row.getAttribute('data-kind') || 'sync';
        const tone = row.getAttribute('data-tone');
        const toneAttr = tone ? ` style="color:var(--${tone})"` : '';
        const x1 = cx[from];
        const x2 = cx[to];
        if (x1 === undefined || x2 === undefined) return;

        const y = headH + 18 + row.offsetTop + row.offsetHeight / 2;
        /* 把标签移到「这条箭头的中点」下方 ——
           它默认是 flex 居中的，落在**容器**中点；
           参与者不是对称两个时（比如三条泳道取相邻两条），
           容器中点和箭头中点差很远，标签就指错线了。
           用 translateX 补偿：不脱离文档流、不影响行高。
           夹一下范围，别把标签推出容器。 */
        if (from !== to && x1 !== undefined && x2 !== undefined) {
          const label = row.querySelector('.slabel');
          const half = Math.max(label ? label.offsetWidth / 2 : 0, 40);
          const want = (x1 + x2) / 2 - W / 2;
          const lim = Math.max(0, W / 2 - half - 4);
          row.style.setProperty('--dx', `${Math.round(Math.max(-lim, Math.min(lim, want)))}px`);
        }

        msgGeom.push({
          i: Number(row.getAttribute('data-i')) || msgGeom.length + 1,
          from,
          to,
          y,
        });

        if (from === to) {
          // 自调用：右侧一个环，标签的 x 交给 CSS 用
          row.style.setProperty('--lx', `${x1}px`);
          const r = 34;
          parts.push(
            `<path class="msg self"${toneAttr} d="M ${x1 + 6} ${y - 11} L ${x1 + r} ${
              y - 11
            } ` + `L ${x1 + r} ${y + 11} L ${x1 + 8} ${y + 11}"/>`,
          );
        } else {
          const dir = x2 > x1 ? 1 : -1;
          // 留出箭头位置，别被标签盖住
          const pad = 8;
          parts.push(
            `<path class="msg ${kind}"${toneAttr} d="M ${x1 + dir * pad} ${y} L ${
              x2 - dir * pad
            } ${y}"/>`,
          );
        }

        /* note（序号/旁注）不画在 SVG 里 —— 它是 HTML，和 label 纵向排列。
           画在 SVG 上的话两者都在水平中点，必然重叠（踩过）。 */
      });

      /* 3) 激活条 —— **从消息自动推导**，不用手写。
            取这个参与者「所有相关消息」的 y 区间。

            **纯发起方不画**（比如客户端）：激活条表示「在处理」，
            而它从发出请求到收到响应之间是在**等待**，不是处理。
            这也是 UML 惯例 —— archify 生成的图同样不给客户端画。 */
      const byPart = {};
      msgGeom.forEach((m, idx) => {
        (byPart[m.from] ||= { ys: [], firstIn: Infinity, firstOut: Infinity }).ys.push(m.y);
        (byPart[m.to] ||= { ys: [], firstIn: Infinity, firstOut: Infinity }).ys.push(m.y);
        byPart[m.from].firstOut = Math.min(byPart[m.from].firstOut, idx);
        byPart[m.to].firstIn = Math.min(byPart[m.to].firstIn, idx);
      });
      Object.entries(byPart).forEach(([id, { ys, firstIn, firstOut }]) => {
        // 纯发起方（先发后收，比如客户端）不画 —— 它在等待，不在处理
        if (firstOut < firstIn) return;
        const x = cx[id];
        if (x === undefined) return;
        const first = Math.min(...ys);
        const last = Math.max(...ys);
        acts.push(
          `<rect class="activation" x="${x - 5}" y="${first}" width="10" height="${Math.max(
            last - first,
            20,
          )}" rx="4"/>`,
        );
      });

      /* 4) 时间段框 —— 按消息序号圈出一段，左上方带标签。
            画在生命线后面，所以放前面。 */
      let segs = [];
      try {
        segs = JSON.parse(root.getAttribute('data-segs') || '[]');
      } catch (e) {
        segs = [];
      }
      const xs = Object.values(cx);
      if (xs.length) {
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        segs.forEach((g) => {
          const inRange = msgGeom.filter((m) => m.i >= g.from && m.i <= g.to);
          if (!inRange.length) return;
          const top = Math.min(...inRange.map((m) => m.y)) - 14;
          const bottom = Math.max(...inRange.map((m) => m.y)) + 14;
          segBoxes.push(
            `<rect class="segbox" x="${left - 30}" y="${top}" width="${
              right - left + 60
            }" height="${bottom - top}" rx="10"/>` +
              `<text class="seglabel" x="${left - 30}" y="${top - 7}">${escapeXml2(
                g.label,
              )}</text>`,
          );
        });
      }

      svg.innerHTML =
        svg.querySelector('defs').outerHTML +
        segBoxes.join('') +
        lifelines.join('') +
        acts.join('') +
        parts.join('');
    }

    function escapeXml2(s) {
      return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    }

    function drawAll() { roots.forEach(draw); }
    drawAll();
    window.addEventListener('resize', drawAll);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
  })();

  /* ============================================================
     arch 积木的聚焦交互
     ------------------------------------------------------------
     archify 抠出来的 SVG 里自带：
       · 节点：<g data-node-id="rule" data-node-kind="backend">
       · 边：  <path data-edge-from="caller" data-edge-to="rule">
     所以「聚焦一个节点，只看它和它连出去的关系」不用重新解析，按属性筛就行。

     archify 完整 HTML 有 627KB 的 viewer runtime（缩放/搜索/演示/导出…）。
     我们把单文件体积看得很重，所以只搬最常用的两个：**聚焦 + 关系追踪**。
  ============================================================ */
  (function () {
    var figs = Array.prototype.slice.call(document.querySelectorAll('[data-arch]'));
    if (!figs.length) return;

    figs.forEach(function (fig) {
      var svg = fig.querySelector('svg');
      if (!svg) return;

      var nodes = Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      var edges = Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from]'));

      function clear() {
        fig.removeAttribute('data-focus');
        nodes.forEach(function (n) {
          n.classList.remove('is-hot');
          n.setAttribute('aria-pressed', 'false');
        });
        edges.forEach(function (e) { e.classList.remove('is-hot'); });
      }

      function focus(id) {
        clear();
        if (!id) return;
        var keep = { };          // 要保留的节点 id
        keep[id] = true;

        edges.forEach(function (e) {
          var from = e.getAttribute('data-edge-from');
          var to = e.getAttribute('data-edge-to');
          var hit = from === id || to === id;
          e.classList.toggle('is-hot', hit);
          if (hit) { keep[from] = true; keep[to] = true; }
        });

        nodes.forEach(function (n) {
          var on = !!keep[n.getAttribute('data-node-id')];
          n.classList.toggle('is-hot', on);
          n.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        // 一个节点都没连出去也要能聚焦（否则点了像没反应）
        fig.setAttribute('data-focus', id);
      }

      svg.addEventListener('click', function (ev) {
        var g = ev.target.closest && ev.target.closest('[data-node-id]');
        var id = g && g.getAttribute('data-node-id');
        // 点同一个再取消
        if (!id || fig.getAttribute('data-focus') === id) return clear();
        focus(id);
      });

      // 键盘可达 —— archify 的节点本来就带 tabindex 和 role="button"
      svg.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var g = ev.target.closest && ev.target.closest('[data-node-id]');
        if (!g) return;
        ev.preventDefault();
        var id = g.getAttribute('data-node-id');
        if (fig.getAttribute('data-focus') === id) clear();
        else focus(id);
      });

      // 点图以外的空白 / Esc 取消
      document.addEventListener('click', function (ev) {
        if (!fig.contains(ev.target)) clear();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') clear();
      });
    });
  })();

  /* ============================================================
     通用控件库
     ------------------------------------------------------------
     约定：控件从 root.dataset.config 读配置，自己渲染 [data-mount] 里的内容。
     这样作者只写 YAML，不用手写 HTML。
  ============================================================ */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const cfgOf = (root) => {
    try { return JSON.parse(root.getAttribute('data-config') || '{}'); }
    catch { return {}; }
  };
  const mountOf = (root) => root.querySelector('[data-mount]') || root;

  /* —— 控件：逐步执行器 ——
     点下一步，看代码/状态逐行走。适合讲算法、协议、状态机。
     config:
       steps: [{ label, code, note }]
  ------------------------------------------------ */
  WIDGETS.stepper = (root) => {
    const cfg = cfgOf(root);
    const steps = cfg.steps || [];
    if (!steps.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    let i = 0;
    let timer = null;

    const bar = el('div', 'st-bar');
    const dots = el('div', 'st-dots');
    const list = el('div', 'st-list');
    const pane = el('div', 'st-pane');
    const code = el('pre', 'st-code');
    const note = el('p', 'st-note');

    const prev = el('button', 'st-btn', '‹ 上一步');
    const next = el('button', 'st-btn st-primary', '下一步 ›');
    const play = el('button', 'st-btn', '▶ 自动播放');
    const reset = el('button', 'st-btn st-ghost', '重置');
    bar.append(prev, next, play, reset);

    const items = steps.map((s, k) => {
      const d = el('button', 'st-item');
      d.append(el('span', 'st-idx', String(k + 1)), el('span', 'st-label', s.label || ''));
      d.addEventListener('click', () => { stop(); go(k); });
      list.append(d);
      const dot = el('span', 'st-dot');
      dots.append(dot);
      return { d, dot };
    });

    pane.append(code, note);
    box.append(dots, list, pane, bar);

    function go(k) {
      i = Math.max(0, Math.min(steps.length - 1, k));
      const s = steps[i];
      items.forEach(({ d, dot }, n) => {
        d.classList.toggle('on', n === i);
        d.classList.toggle('done', n < i);
        dot.classList.toggle('on', n === i);
        dot.classList.toggle('done', n < i);
      });
      code.textContent = s.code || '';
      note.textContent = s.note || '';
      code.hidden = !s.code;
      note.hidden = !s.note;
      prev.disabled = i === 0;
      next.disabled = i === steps.length - 1;
      if (statusEl) statusEl.textContent = `第 ${i + 1} / ${steps.length} 步`;
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; play.textContent = '▶ 自动播放'; }
    }
    prev.addEventListener('click', () => { stop(); go(i - 1); });
    next.addEventListener('click', () => { stop(); go(i + 1); });
    reset.addEventListener('click', () => { stop(); go(0); });
    play.addEventListener('click', () => {
      if (timer) return stop();
      play.textContent = '⏸ 暂停';
      timer = setInterval(() => {
        if (i >= steps.length - 1) return stop();
        go(i + 1);
      }, 1100);
    });
    go(0);
  };

  /* —— 控件：参数调节器 ——
     拖动滑块，看多个指标实时变化。
     config:
       param:  { label, unit, values: [...] }
       outputs:[{ label, unit, values: [...], tone }]
  ------------------------------------------------ */
  WIDGETS.tuner = (root) => {
    const cfg = cfgOf(root);
    const param = cfg.param || {};
    const vals = param.values || [];
    if (!vals.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const head = el('div', 'tn-head');
    const val = el('b', 'tn-val', String(vals[0]));
    const lab = el('span', 'tn-lab', (param.label || '') + (param.unit ? `（${param.unit}）` : ''));
    const range = el('input', 'tn-range');
    range.type = 'range';
    range.min = '0';
    range.max = String(vals.length - 1);
    range.value = '0';
    head.append(lab, val);

    const out = el('div', 'tn-out');
    const cards = (cfg.outputs || []).map((o) => {
      const c = el('div', `tn-card tone-${o.tone || 'muted'}`);
      c.append(el('small', '', o.label || ''));
      const v = el('b', 'tn-num');
      c.append(v);
      if (o.unit) c.append(el('span', 'tn-unit', o.unit));
      out.append(c);
      return { v, o };
    });

    // 刻度：显示首尾，避免滑到哪都不知道范围
    const scale = el('div', 'tn-scale');
    scale.append(el('span', '', String(vals[0])));
    if (vals.length > 2) scale.append(el('span', 'tn-mid', String(vals[Math.floor(vals.length / 2)])));
    scale.append(el('span', '', String(vals[vals.length - 1])));

    box.append(head, range, scale, out);

    function apply() {
      const i = Number(range.value);
      val.textContent = String(vals[i]);
      cards.forEach(({ v, o }) => {
        const x = (o.values || [])[i];
        v.textContent = x === undefined ? '—' : String(x);
      });
      if (statusEl) statusEl.textContent = `${param.label || '参数'} = ${vals[i]}`;
    }
    range.addEventListener('input', apply);
    apply();
  };

  /* —— 控件：分区裁剪 ——
     一张按天分区的共享表。点一个分区，再点一天里的一个快照，
     看这一次查询实际要扫多少行 —— 从「全表」一路降到「一个快照」。
     讲透「一张表装了 14 亿行，为什么读一个快照不用扫 14 亿」。
     config:
       days:              14      # 分区数（一天一个）
       snapshotsPerDay:   100     # 每天几个快照
       rowsPerSnapshot:   1000000 # 每个快照几行
  ------------------------------------------------ */
  WIDGETS['partition-prune'] = (root) => {
    const cfg = cfgOf(root);
    const days = cfg.days || 14;
    const perDay = cfg.snapshotsPerDay || 100;
    const rowsPer = cfg.rowsPerSnapshot || 1000000;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const TOTAL = days * perDay * rowsPer;   // 全表
    const DAY = perDay * rowsPer;            // 一天
    const fmt = (n) => n.toLocaleString('en-US');

    // 当前选择：day = -1 表示没选分区（全表）；snap = -1 表示选了整天
    // 默认停在「全表」—— 那正是读者的默认误解，点一下才看到裁剪生效
    let day = -1;
    let snap = -1;

    /* ---------- 第一层：分区条 ---------- */
    const stage1 = el('div', 'pp-stage');
    stage1.append(el('div', 'pp-cap', `snapshot_users · 按 snapshot_date 分成 ${days} 个分区`));

    const strip = el('div', 'pp-days');
    const allBtn = el('button', 'pp-all');
    allBtn.type = 'button';
    allBtn.innerHTML = '<b>全表</b><span>不分分区</span>';
    strip.append(allBtn);

    const dayCells = [];
    for (let i = 0; i < days; i += 1) {
      const c = el('button', 'pp-day');
      c.type = 'button';
      c.innerHTML = `<b>D${i + 1}</b><span>${perDay} 个</span>`;
      c.addEventListener('click', () => { day = i; snap = -1; apply(); });
      dayCells.push(c);
      strip.append(c);
    }
    allBtn.addEventListener('click', () => { day = -1; snap = -1; apply(); });
    stage1.append(strip);
    box.append(stage1);

    /* ---------- 第二层：这一天里的快照 ---------- */
    const stage2 = el('div', 'pp-stage');
    const cap2 = el('div', 'pp-cap');
    const snapStrip = el('div', 'pp-snaps');
    const snapCells = [];
    for (let i = 0; i < perDay; i += 1) {
      const c = el('button', 'pp-snap');
      c.type = 'button';
      c.title = `第 ${i + 1} 个快照`;
      c.addEventListener('click', () => { snap = i; apply(); });
      snapCells.push(c);
      snapStrip.append(c);
    }
    stage2.append(cap2, snapStrip);
    box.append(stage2);

    /* ---------- 第三层：这三档各要扫多少 ---------- */
    const stair = el('div', 'pp-stair');
    const levels = [
      { n: TOTAL, label: '不分区 · 整张表',   hint: '基线',            tone: 'red' },
      { n: DAY,   label: '分区裁剪 · 只扫一天', hint: `砍掉 ${days - 1}/${days}`, tone: 'amber' },
      { n: rowsPer, label: '再按 snapshot_id 定位', hint: '只读那一段', tone: 'green' },
    ].map((L, i) => {
      const r = el('div', `pp-row tone-${L.tone}`);
      r.append(el('span', 'pp-idx', String(i + 1)));
      const mid = el('div', 'pp-mid');
      mid.append(el('span', 'pp-lab', L.label));
      mid.append(el('span', 'pp-hint', L.hint));
      r.append(mid);
      r.append(el('b', 'pp-num', fmt(L.n)));
      r.append(el('span', 'pp-unit', '行'));
      stair.append(r);
      return r;
    });
    box.append(stair);

    const foot = el('div', 'pp-foot');
    box.append(foot);

    /* ---------- 联动 ---------- */
    function apply() {
      const onAll = day < 0;

      allBtn.classList.toggle('is-on', onAll);
      dayCells.forEach((c, i) => c.classList.toggle('is-on', i === day));
      snapCells.forEach((c, i) => c.classList.toggle('is-on', i === snap));

      // 没选分区时，第二层整个不可用 —— 因为没有分区可展开
      stage2.classList.toggle('is-off', onAll);
      cap2.textContent = onAll
        ? '选一个分区，才能看到它里面的快照'
        : `D${day + 1} 里的 ${perDay} 个快照 · 点一个看只读那一个要扫多少`;

      const lvl = onAll ? 0 : (snap < 0 ? 1 : 2);
      levels.forEach((r, i) => r.classList.toggle('is-on', i === lvl));

      const scan = onAll ? TOTAL : (snap < 0 ? DAY : rowsPer);
      const pct = (scan / TOTAL * 100);
      const shown = pct < 0.01 ? '< 0.01%' : (pct >= 1 ? pct.toFixed(0) : pct.toFixed(2)) + '%';

      const what = onAll ? '整张表'
        : (snap < 0 ? `D${day + 1} 这一天` : `D${day + 1} 的第 ${snap + 1} 个快照`);
      // 这里直接拼 HTML，不走 markdown —— 控件渲染的是 DOM，`==` 不会被解析
      foot.innerHTML = `这次查询读 <b>${what}</b>：实际扫描 <b>${fmt(scan)}</b> 行，`
        + `<em>是全表量的 ${shown}</em>`;

      if (statusEl) statusEl.textContent = `扫描 ${fmt(scan)} 行 · 全表的 ${shown}`;
    }

    apply();
  };

  /* —— 控件：并排差异对比 ——
     行首写 `- ` / `+ ` 自动识别为删除/新增；悬停时两边对应行联动高亮。
     config:
       left:  { title, code }
       right: { title, code }
       link:  true   # 是否联动高亮（默认 true）
  ------------------------------------------------ */
  WIDGETS.diff = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const link = cfg.link !== false;

    const cols = ['left', 'right'].map((side) => {
      const c = cfg[side] || {};
      const col = el('div', `df-col df-${side}`);
      col.append(el('div', 'df-title', c.title || ''));
      const pre = el('div', 'df-code');
      const rows = String(c.code || '')
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => {
          let kind = '';
          let text = line;
          if (/^- /.test(line)) { kind = 'del'; text = line.slice(2); }
          else if (/^\+ /.test(line)) { kind = 'add'; text = line.slice(2); }
          else if (/^  /.test(line)) { text = line.slice(2); }
          const r = el('div', `df-row${kind ? ' ' + kind : ''}`);
          r.append(el('span', 'df-mark', kind === 'del' ? '−' : kind === 'add' ? '+' : ''));
          r.append(el('span', 'df-text', text || ' '));
          pre.append(r);
          return r;
        });
      col.append(pre);
      return { col, rows };
    });

    box.append(cols[0].col, cols[1].col);

    if (!link) return;
    // 悬停联动：把另一边对应的「有标记行」也高亮
    ['del', 'add'].forEach(() => {});
    const markRows = (side, kind) => cols[side].rows.filter((r) => r.classList.contains(kind));
    cols[0].rows.forEach((r, i) => {
      r.addEventListener('mouseenter', () => {
        const other = cols[1].rows[i];
        if (other) other.classList.add('hover');
        r.classList.add('hover');
      });
      r.addEventListener('mouseleave', () => {
        cols[0].rows.forEach((x) => x.classList.remove('hover'));
        cols[1].rows.forEach((x) => x.classList.remove('hover'));
      });
    });
    cols[1].rows.forEach((r, i) => {
      r.addEventListener('mouseenter', () => {
        const other = cols[0].rows[i];
        if (other) other.classList.add('hover');
        r.classList.add('hover');
      });
    });
    void markRows;
  };

  /* ---------- 10. 结构图折叠 ----------
     点节点收起/展开它的子树。纯属性切换，样式在 blocks.css。 */
  (function treeFold() {
    document.querySelectorAll('[data-tree] li.has-kids > [data-tree-node]').forEach((node) => {
      node.addEventListener('click', () => node.parentElement.classList.toggle('folded'));
    });
  })();

  /* —— 控件：stream-modes ——
     同一条订单流，三种跑法。三种模式共用同一份事件、同一段业务逻辑，
     只在「源有没有末尾」和「任务什么时候结束」上不同。
       有界·一次读完   —— 输入栏一直涨，输出栏一直是空的，最后只吐一行
       无界·持续累计   —— 每来一条就更新一次当前结果
       无界·每分钟窗口 —— 窗口关闭才结算，而最后一个窗口永远等不到关闭 */
  WIDGETS['stream-modes'] = (root) => {
    var EVENTS = [
      { t: '10:00:01', u: 'u01', amt: 99 },
      { t: '10:00:03', u: 'u02', amt: 50 },
      { t: '10:00:05', u: 'u03', amt: 120 },
      { t: '10:00:08', u: 'u01', amt: 20 },
      { t: '10:00:10', u: 'u04', amt: 88 },
      { t: '10:00:14', u: 'u02', amt: 66 },
      { t: '10:01:02', u: 'u05', amt: 150 },
      { t: '10:01:05', u: 'u01', amt: 30 },
      { t: '10:01:09', u: 'u03', amt: 45 },
      { t: '10:01:15', u: 'u06', amt: 200 },
      { t: '10:02:01', u: 'u02', amt: 77 },
      { t: '10:02:04', u: 'u05', amt: 33 },
    ];
    var TOTAL = EVENTS.reduce((s, e) => s + e.amt, 0);

    var MODES = [
      {
        id: 'batch', label: '有界 · 一次读完', tone: 'green', step: 180,
        rule: '源是文件，有末尾。全部读完 → 一个最终结果 → 任务结束。',
      },
      {
        id: 'cum', label: '无界 · 持续累计', tone: 'blue', step: 420,
        rule: '源是 Kafka，没有末尾。每来一条就更新一次当前结果，任务永不结束。',
      },
      {
        id: 'win', label: '无界 · 每分钟窗口', tone: 'violet', step: 420,
        rule: '把永不结束的流按分钟切段。窗口关闭才结算 —— 而最后一个窗口永远等不到关闭。',
      },
    ];

    var modesBox = root.querySelector('[data-sm-modes]');
    var ruleEl = root.querySelector('[data-sm-rule]');
    var inBox = root.querySelector('[data-log="in"]');
    var outBox = root.querySelector('[data-log="out"]');
    var countEl = root.querySelector('[data-sm-count]');
    var taskEl = root.querySelector('[data-sm-task]');
    var statusEl = root.querySelector('[data-status]');
    var runBtn = root.querySelector('[data-run]');
    var resetBtn = root.querySelector('[data-reset]');

    var mode = 'batch';
    var timers = [];

    function addLine(box, badge, tone, time, text, cls) {
      box.appendChild(h('div', { cls: 'line' + (cls ? ' ' + cls : '') }, [
        badge ? h('span', { cls: 'badge tone-' + tone, text: badge }) : null,
        time ? h('span', { cls: 'time', text: time }) : null,
        h('span', { cls: 'txt', text: text }),
      ]));
      box.scrollTop = box.scrollHeight;
    }
    /** 输入栏里的窗口分界线 */
    function addDivider(box, text) {
      box.appendChild(h('div', { cls: 'line divider' }, [h('span', { cls: 'txt', text: text })]));
      box.scrollTop = box.scrollHeight;
    }
    function setTask(label, tone, note) {
      taskEl.className = 'sm-task tone-' + tone;
      fill(taskEl, [
        h('span', { text: '任务状态：' }),
        h('b', { text: label }),
        h('span', { text: note }),
      ]);
    }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function reset() {
      clearTimers();
      fill(inBox, []); fill(outBox, []);
      countEl.textContent = '0 / ' + EVENTS.length + ' 条';
      setTask('未开始', 'muted', '点「开始模拟」跑一遍');
      statusEl.textContent = '未开始 · ' + EVENTS.length + ' 条订单等着被处理';
      runBtn.disabled = false;
      runBtn.textContent = '▶ 开始模拟';
    }

    function play() {
      reset();
      var cfg = MODES.filter((m) => m.id === mode)[0];
      var step = cfg.step;
      runBtn.disabled = true;
      runBtn.textContent = '模拟中…';
      setTask('运行中', 'blue', '正在接收事件');
      statusEl.textContent = '已到达 0 / ' + EVENTS.length + ' 条';

      var cum = 0, win = null, winSum = 0, winCount = 0;

      if (mode === 'batch') {
        addLine(inBox, 'FILE', 'muted', '', '打开 orders_2026-09-23.csv');
      }

      EVENTS.forEach((e, i) => {
        timers.push(setTimeout(() => {
          // 窗口模式：分钟一变，先把上一个窗口结算掉
          if (mode === 'win') {
            var w = e.t.slice(0, 5);
            if (win && w !== win) {
              addLine(outBox, 'WINDOW', 'green', win,
                win + ' 窗口关闭 → ' + winCount + ' 笔 · ' + winSum + ' 元');
              addDivider(inBox, win + ' 窗口关闭');
            }
            if (w !== win) { win = w; winSum = 0; winCount = 0; }
            winSum += e.amt; winCount++;
          }

          addLine(inBox, 'EVENT', 'blue', e.t, e.u + ' 下单 ' + e.amt + ' 元');
          countEl.textContent = (i + 1) + ' / ' + EVENTS.length + ' 条';
          cum += e.amt;

          if (mode === 'cum') {
            addLine(outBox, 'UPDATE', 'blue', e.t, '当前累计销售额 = ' + cum + ' 元');
            statusEl.textContent = '已到达 ' + (i + 1) + ' / ' + EVENTS.length + ' 条 · 当前累计 ' + cum + ' 元';
          } else if (mode === 'win') {
            statusEl.textContent = win + ' 窗口攒到 ' + winCount + ' 笔 · ' + winSum + ' 元';
          } else {
            statusEl.textContent = '正在读取文件 … ' + (i + 1) + ' / ' + EVENTS.length;
          }
        }, i * step + 60));
      });

      timers.push(setTimeout(() => {
        if (mode === 'batch') {
          addLine(inBox, 'EOF', 'green', '', '文件末尾 —— 没有更多数据了', 'eof');
          addLine(outBox, 'FINAL', 'green', '', '总销售额 = ' + TOTAL + ' 元 · 共 ' + EVENTS.length + ' 笔');
          addLine(outBox, 'DONE', 'green', '', '任务结束 ✓');
          setTask('已结束', 'green', '批任务：读完就退出');
          statusEl.textContent = '任务已结束 · 这个结果是最终答案，不会再变';
        } else if (mode === 'cum') {
          addLine(inBox, '…', 'muted', '', '还在等下一条 —— 不知道什么时候来，也不知道有没有最后一条');
          setTask('持续运行中', 'blue', '流任务：不会自己退出');
          statusEl.textContent = '任务不会结束 · 每来一条就更新一次结果';
        } else {
          addLine(outBox, 'OPEN', 'amber', win,
            win + ' 窗口还在攒（' + winCount + ' 笔 · ' + winSum + ' 元）', 'warn');
          addLine(outBox, 'WAIT', 'amber', '', '要等 10:03 的第一条数据到来，这个窗口才会结算', 'warn');
          setTask('持续运行中', 'amber', '最后一个窗口还开着');
          statusEl.textContent = '任务不会结束 · 最后一个窗口永远等不到关闭';
        }
        runBtn.disabled = false;
        runBtn.textContent = '▶ 再跑一次';
      }, EVENTS.length * step + 480));
    }

    function setMode(id, autoplay) {
      mode = id;
      var cfg = MODES.filter((m) => m.id === id)[0];
      Array.prototype.forEach.call(modesBox.children, (b) =>
        b.classList.toggle('on', b.getAttribute('data-sm-mode') === id));
      ruleEl.className = 'seg-rule tone-' + cfg.tone;
      ruleEl.textContent = cfg.rule;
      if (autoplay) play();
      else reset();
    }

    MODES.forEach((m) => {
      var b = h('button', { cls: 'tone-' + m.tone, text: m.label, attrs: { 'data-sm-mode': m.id } });
      b.type = 'button';
      b.addEventListener('click', () => setMode(m.id, true));
      modesBox.appendChild(b);
    });
    runBtn.addEventListener('click', play);
    if (resetBtn) resetBtn.addEventListener('click', reset);

    // 初始只把状态摆好，不自动跑 —— 读者滚到这里时应该看到一个「还没开始」的场
    setMode('batch', false);
  };

  /* —— 控件：operator-lab ——
     同一批 6 条订单，过不同的 Transformation 算子，看产出怎么变。
     想说的就一件事：==算子之间的区别是「一条进几条出」和「以什么为单位」==。
       map / filter / flatMap —— 逐条处理，条数会变
       keyBy                —— 条数不变，变的是「桶」
       keyBy + sum          —— 每条输入都产出一条「当前累计」 */
  WIDGETS['operator-lab'] = (root) => {
    var ORDERS = [
      { id: '1001', uid: 'u01', amount: 99, status: 'PAID', products: ['A100', 'B200'] },
      { id: '1002', uid: 'u02', amount: 0, status: 'PAID', products: ['A100'] },
      { id: '1003', uid: 'u01', amount: -10, status: 'UNPAID', products: ['C300'] },
      { id: '1004', uid: 'u03', amount: 50, status: 'PAID', products: ['B200', 'C300'] },
      { id: '1005', uid: 'u01', amount: 20, status: 'PAID', products: ['A100'] },
      { id: '1006', uid: 'u02', amount: 80, status: 'UNPAID', products: [] },
    ];

    var OPS = [
      {
        id: 'map', label: 'map', tone: 'blue',
        rule: '1 条进 → 1 条出。只换内容，条数不变。',
        head: '输出 · Order → (uid, amount)',
        io: '6 条进 → 6 条出', note: '字段从 5 个变成 2 个，条数一个没少',
        keep: function () { return true; },
      },
      {
        id: 'filter', label: 'filter 金额 > 0', tone: 'green',
        rule: '1 条进 → 0 或 1 条出。条件不满足的，连人带记录一起消失。',
        head: '输出 · 留下来的订单',
        io: '6 条进 → 4 条出', note: '丢掉 2 条金额非法的',
        keep: function (o) { return o.amount > 0; },
      },
      {
        id: 'flatMap', label: 'flatMap 拆商品', tone: 'violet',
        rule: '1 条进 → 0 到多条出。一条记录拆成好几条。',
        head: '输出 · 商品行（一条订单拆成 N 行）',
        io: '6 条进 → 7 条出', note: '订单 1006 没有商品，一条也不出',
        keep: function () { return true; },
      },
      {
        id: 'keyBy', label: 'keyBy(uid)', tone: 'amber',
        rule: '条数一点没变 —— keyBy 不产出数据，它只决定后续计算以什么为单位。',
        head: '输出 · 按 uid 分的桶',
        io: '6 条进 → 6 条出，分成了 3 个桶', note: '这就是 keyBy：不加工，只分堆',
        keep: function () { return true; },
      },
      {
        id: 'sum', label: 'keyBy + sum', tone: 'green',
        rule: '每个 key 各维护一份状态，每条输入都产出一条「当前累计」。',
        head: '输出 · 每个 key 的当前累计',
        io: '6 条进 → 6 条出', note: '不是最后才出一条，是每条都出',
        keep: function () { return true; },
      },
    ];

    var modesBox = root.querySelector('[data-ol-modes]');
    var ruleEl = root.querySelector('[data-ol-rule]');
    var inBox = root.querySelector('[data-log="in"]');
    var outBox = root.querySelector('[data-log="out"]');
    var inHead = root.querySelector('[data-ol-inhead]');
    var outHead = root.querySelector('[data-ol-outhead]');
    var ioEl = root.querySelector('[data-ol-io]');
    var statusEl = root.querySelector('[data-status]');
    var runBtn = root.querySelector('[data-run]');
    var resetBtn = root.querySelector('[data-reset]');

    var cur = 'map';
    var timers = [];

    function rec(parts, cls) {
      return h('div', { cls: 'ol-rec' + (cls ? ' ' + cls : '') },
        parts.map((p) => h(p.t, { cls: p.c || '', text: p.v })));
    }
    function inputParts(o) {
      return [
        { t: 'b', v: o.id },
        { t: 'i', v: o.uid },
        { t: 'u', v: o.amount + ' 元' },
        { t: 's', c: o.status === 'PAID' ? 'paid' : 'unpaid', v: o.status },
        { t: 'em', v: o.products.length ? o.products.join(', ') : '（无商品）' },
      ];
    }
    function byId(id) { return OPS.find((o) => o.id === id); }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    /* 每个算子的产出，逐条（或逐桶）排好，交给动画按时序吐出来 */
    function outputs(op) {
      var out = [];
      if (op.id === 'map') {
        ORDERS.forEach((o) => out.push({
          parts: [{ t: 'b', v: o.uid }, { t: 'u', v: o.amount + ' 元' }, { t: 'em', v: '← 订单 ' + o.id }],
        }));
      } else if (op.id === 'filter') {
        ORDERS.filter(op.keep).forEach((o) => out.push({ parts: inputParts(o), cls: 'kept' }));
      } else if (op.id === 'flatMap') {
        ORDERS.forEach((o) => o.products.forEach((p) => out.push({
          parts: [{ t: 'b', v: p }, { t: 'em', v: '← 订单 ' + o.id }],
        })));
      } else if (op.id === 'sum') {
        var acc = {};
        ORDERS.forEach((o) => {
          acc[o.uid] = (acc[o.uid] || 0) + o.amount;
          out.push({
            parts: [{ t: 'b', v: o.uid }, { t: 'u', v: '累计 ' + acc[o.uid] + ' 元' },
              { t: 'em', v: '← 订单 ' + o.id }],
          });
        });
      }
      return out;
    }

    function buckets() {
      var order = [], map = {};
      ORDERS.forEach((o) => {
        if (!map[o.uid]) { map[o.uid] = []; order.push(o.uid); }
        map[o.uid].push(o);
      });
      return order.map((uid) => ({ uid: uid, items: map[uid] }));
    }

    function reset() {
      clearTimers();
      fill(inBox, []); fill(outBox, []);
      inHead.textContent = '输入 · 6 条订单';
      outHead.textContent = '输出';
      ioEl.className = 'ol-io tone-muted';
      fill(ioEl, [h('span', { text: '点一个算子，看它把数据变成了什么' })]);
      statusEl.textContent = '未开始';
      runBtn.disabled = false;
      runBtn.textContent = '▶ 重放';
    }

    function play(id) {
      clearTimers();
      var op = byId(id);
      cur = id;

      Array.prototype.forEach.call(modesBox.children, (b) =>
        b.classList.toggle('on', b.getAttribute('data-ol-mode') === id));
      ruleEl.className = 'ol-rule tone-' + op.tone;
      ruleEl.textContent = op.rule;
      outHead.textContent = op.head;
      inHead.textContent = '输入 · 6 条订单';
      statusEl.textContent = op.io;

      ioEl.className = 'ol-io tone-' + op.tone;
      fill(ioEl, [h('b', { text: op.io }), h('span', { text: op.note })]);

      // 输入栏：全在，被丢掉的标灰
      fill(inBox, ORDERS.map((o) => rec(inputParts(o), op.keep(o) ? '' : 'drop')));

      // 输出栏：逐条 / 逐桶吐出来
      fill(outBox, []);
      var step = 90;
      if (op.id === 'keyBy') {
        buckets().forEach((bk, i) => {
          timers.push(setTimeout(() => {
            var kids = [h('div', { cls: 'ol-bhead' }, [
              h('span', { text: 'key = ' + bk.uid }),
              h('span', { cls: 'cnt', text: bk.items.length + ' 条' }),
            ])];
            bk.items.forEach((o) => kids.push(rec(inputParts(o))));
            outBox.appendChild(h('div', { cls: 'ol-bucket tone-amber' }, kids));
            outBox.scrollTop = outBox.scrollHeight;
          }, i * 220 + 40));
        });
      } else {
        outputs(op).forEach((r, i) => {
          timers.push(setTimeout(() => {
            outBox.appendChild(rec(r.parts, r.cls));
            outBox.scrollTop = outBox.scrollHeight;
          }, i * step + 40));
        });
      }

      runBtn.disabled = false;
      runBtn.textContent = '▶ 重放';
    }

    OPS.forEach((op) => {
      var b = h('button', { cls: 'tone-' + op.tone, text: op.label, attrs: { 'data-ol-mode': op.id } });
      b.type = 'button';
      b.addEventListener('click', () => play(op.id));
      modesBox.appendChild(b);
    });
    runBtn.addEventListener('click', () => play(cur));
    if (resetBtn) resetBtn.addEventListener('click', reset);

    // 初始直接把 map 的结果摆好 —— 这个控件的重点是「对比产出」，
    // 上来就空着反而不知道该干什么。点其它算子才是探索。
    play('map');
  };

  /* —— 控件：hashring ——
     把 key 和节点都放到同一个环上，切换分配规则看「搬了多少」。
     想说的就一件事：取模把「节点数」写进了路由公式，所以 N 一变几乎全搬；
     一致性哈希里节点只是环上的点，加一个只截走相邻的一段。 */
  WIDGETS.hashring = (root) => {
    const cfg = cfgOf(root);
    const SVGNS = 'http://www.w3.org/2000/svg';
    const CX = 140, CY = 140, R_OUT = 100, R_IN = 64, R_KEY = 82, R_NODE = 111;
    const COLORS = ['blue', 'green', 'violet', 'amber', 'red'];
    const NAMES = ['A', 'B', 'C', 'D', 'E'];

    /* 哈希值 0~99 → 角度（0 在正上方，顺时针增长） */
    const ang = (v) => (-90 + (v / 100) * 360) * (Math.PI / 180);
    const pt = (v, r) => [CX + r * Math.cos(ang(v)), CY + r * Math.sin(ang(v))];

    /* 节点的位置是写死的：加一台 D 时，它落在 40 和 80 之间 ——
       这正是要看的：A/B/C 一动没动。 */
    const NODE_POS = [10, 40, 80, 65, 92];
    /* 虚拟节点：每台机器在环上铺 6 个点，位置固定（伪随机但确定） */
    const VNODE_POS = [
      [3, 19, 27, 51, 68, 91],
      [11, 34, 45, 58, 79, 88],
      [7, 24, 39, 63, 72, 85],
      [16, 30, 47, 55, 77, 94],
      [22, 42, 61, 70, 83, 96],
    ];

    /* key 集合：位置固定，两种分布 */
    const KEYS = cfg.keys === 'hot'
      ? Array.from({ length: 44 }, (_, i) => 40 + (i * 25) / 43)
      : Array.from({ length: 52 }, (_, i) => (i * 100) / 52);

    let kindIdx = 0;
    let size = cfg.sizes[0];

    const kind = () => cfg.kinds[kindIdx];

    /** 当前策略下，环上有哪些「点」：{ v: 环上位置, node: 第几个物理节点 } */
    function points(k, n) {
      if (k.mode === 'mod') return null; // 取模不是「点」，是等分区间
      const vn = k.vnodes || 1;
      const out = [];
      for (let i = 0; i < n; i++) {
        if (vn === 1) out.push({ v: NODE_POS[i], node: i });
        else VNODE_POS[i].forEach((v) => out.push({ v, node: i }));
      }
      return out.sort((a, b) => a.v - b.v);
    }

    /** 一个 hash 值归哪个物理节点 */
    function ownerOf(v, k, n) {
      if (k.mode === 'mod') return Math.min(n - 1, Math.floor((v / 100) * n));
      const ps = points(k, n);
      for (const p of ps) if (v <= p.v) return p.node;
      return ps[0].node; // 绕回开头
    }

    /** 每个区间：[起始位置, 结束位置, 归属节点]；取模时是等分，环上时是节点之间 */
    function spans(k, n) {
      if (k.mode === 'mod') {
        return Array.from({ length: n }, (_, i) => [
          (i * 100) / n, ((i + 1) * 100) / n, i,
        ]);
      }
      const ps = points(k, n);
      return ps.map((p, i) => {
        const next = ps[(i + 1) % ps.length];
        const end = i === ps.length - 1 ? ps[0].v + 100 : next.v;
        return [p.v, end, p.node];
      });
    }

    const svgEl = (tag, attrs) => {
      const el = document.createElementNS(SVGNS, tag);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    };

    /** 环形扇区路径（v1 → v2） */
    function donut(v1, v2) {
      const [x1, y1] = pt(v1, R_OUT), [x2, y2] = pt(v2, R_OUT);
      const [x3, y3] = pt(v2, R_IN), [x4, y4] = pt(v1, R_IN);
      const large = v2 - v1 > 50 ? 1 : 0;
      return `M${x1} ${y1}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2}` +
        `L${x3} ${y3}A${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4}Z`;
    }

    /* ---- 组装外壳 ---- */
    const top = h('div', { cls: 'hr-top' }, [
      h('div', { cls: 'hr-group' }, [h('label', { text: '分配规则' }),
        h('div', { cls: 'seg', attrs: { 'data-hr-kinds': '' } })]),
      h('div', { cls: 'hr-group' }, [h('label', { text: '节点数' }),
        h('div', { cls: 'seg', attrs: { 'data-hr-sizes': '' } })]),
    ]);
    const svg = svgEl('svg', { viewBox: '0 0 280 280' });
    const side = h('div', { cls: 'hr-side' }, [
      h('div', { cls: 'hr-loads', attrs: { 'data-hr-loads': '' } }),
      h('div', { cls: 'hr-verdict', attrs: { 'data-hr-verdict': '' } }),
    ]);
    const mount = root.querySelector('[data-mount]');
    fill(mount, [h('div', { cls: 'hr' }, [
      top,
      h('div', { cls: 'hr-body' }, [
        h('div', { cls: 'hr-ring' }, [svg]),
        side,
      ]),
    ])]);

    const kindsBox = root.querySelector('[data-hr-kinds]');
    const sizesBox = root.querySelector('[data-hr-sizes]');
    const loadsBox = root.querySelector('[data-hr-loads]');
    const verdict = root.querySelector('[data-hr-verdict]');
    const statusEl = root.querySelector('[data-status]');

    cfg.kinds.forEach((k, i) => {
      const b = h('button', { cls: 'tone-blue', text: k.label, attrs: { 'data-hr-kind': String(i) } });
      b.type = 'button';
      b.addEventListener('click', () => { kindIdx = i; render(); });
      kindsBox.appendChild(b);
    });
    cfg.sizes.forEach((n) => {
      const b = h('button', { cls: 'tone-violet', text: n + ' 台', attrs: { 'data-hr-size': String(n) } });
      b.type = 'button';
      b.addEventListener('click', () => { size = n; render(); });
      sizesBox.appendChild(b);
    });

    function render() {
      const k = kind();
      Array.prototype.forEach.call(kindsBox.children, (b) =>
        b.classList.toggle('on', Number(b.getAttribute('data-hr-kind')) === kindIdx));
      Array.prototype.forEach.call(sizesBox.children, (b) =>
        b.classList.toggle('on', Number(b.getAttribute('data-hr-size')) === size));

      const sp = spans(k, size);
      /* 和上一档节点数比，哪些 key 换了主人 */
      const base = cfg.sizes.indexOf(size) > 0 ? cfg.sizes[cfg.sizes.indexOf(size) - 1] : null;
      const moved = base === null ? [] : KEYS.map((v) => ownerOf(v, k, base) !== ownerOf(v, k, size));
      const movedCount = moved.filter(Boolean).length;

      /* 环 */
      const kids = [];
      sp.forEach(([a, b, node]) => {
        kids.push(svgEl('path', {
          class: 'hr-seg',
          d: donut(a, b),
          fill: `color-mix(in srgb, var(--${COLORS[node % COLORS.length]}) 34%, var(--surface))`,
          stroke: 'var(--border-strong)',
          'stroke-width': 1,
        }));
      });
      /* key 点 */
      KEYS.forEach((v, i) => {
        const node = ownerOf(v, k, size);
        const [x, y] = pt(v, R_KEY);
        kids.push(svgEl('circle', {
          class: 'hr-keyspot' + (moved[i] ? ' moved' : ''),
          cx: x, cy: y, r: moved[i] ? 4.2 : 3.2,
          fill: `var(--${COLORS[node % COLORS.length]})`,
        }));
      });
      /* 节点标记（取模没有「点」，就不画） */
      const ps = points(k, size);
      /* 取模模式没有「节点」这个点，扇区就是节点 —— 所以把标签打在扇区中点，
         否则环上光是有颜色，看不出哪段归谁。 */
      if (!ps) {
        sp.forEach(([a, b, node]) => {
          const [tx, ty] = pt((a + b) / 2, R_NODE + 13);
          const t = svgEl('text', {
            class: 'hr-nodetext', x: tx, y: ty,
            style: `--tone: var(--${COLORS[node % COLORS.length]})`,
          });
          t.textContent = NAMES[node];
          kids.push(t);
        });
      }
      if (ps) {
        const vn = k.vnodes || 1;
        ps.forEach((p) => {
          const [x, y] = pt(p.v, R_NODE);
          const [tx, ty] = pt(p.v, R_NODE + 13);
          kids.push(svgEl('circle', {
            class: 'hr-nodepos', cx: x, cy: y,
            r: vn === 1 ? 5.5 : 3.4,
            style: `--tone: var(--${COLORS[p.node % COLORS.length]})`,
          }));
          if (vn === 1) {
            const t = svgEl('text', {
              class: 'hr-nodetext', x: tx, y: ty,
              style: `--tone: var(--${COLORS[p.node % COLORS.length]})`,
            });
            t.textContent = NAMES[p.node];
            kids.push(t);
          }
        });
      }
      fill(svg, kids);

      /* 负载条 */
      const counts = new Array(size).fill(0);
      KEYS.forEach((v) => counts[ownerOf(v, k, size)]++);
      const max = Math.max(1, ...counts);
      fill(loadsBox, counts.map((c, i) => h('div', {
        cls: 'hr-load',
        attrs: { style: `--tone: var(--${COLORS[i % COLORS.length]})` },
      }, [
        h('i', { text: NAMES[i] }),
        h('span', { text: String(c) }),
        h('div', { cls: 'bar' }, [h('span', { attrs: { style: `width:${(c / max) * 100}%` } })]),
        h('em', { text: Math.round((c / KEYS.length) * 100) + '%' }),
      ])));

      /* 结论 */
      const worst = Math.max(...counts), best = Math.min(...counts);
      verdict.className = 'hr-verdict tone-' + (movedCount > KEYS.length * 0.5 ? 'red' : 'green');
      if (base === null) {
        fill(verdict, [
          h('span', { text: '当前：' }),
          h('b', { text: k.label + ' · ' + size + ' 台' }),
          h('span', { text: '。把节点数切到 ' + cfg.sizes[cfg.sizes.length - 1] +
            ' 台，环上会标出哪些 key 换了主人。' }),
        ]);
      } else {
        fill(verdict, [
          h('span', { text: '从 ' + base + ' 台加到 ' + size + ' 台：' }),
          h('b', { text: movedCount + ' / ' + KEYS.length + ' 个 key 换了主人' }),
          h('span', { text: `（${Math.round((movedCount / KEYS.length) * 100)}%）。节点负载 ${best}~${worst} 个 key。` }),
        ]);
      }
      if (statusEl) {
        statusEl.textContent = k.label + ' · ' + size + ' 台 · 换了主人 ' + movedCount + '/' + KEYS.length;
      }
    }

    render();
  };

  /* ============================================================
     控件：dsl-lab —— 条件 → SQL
     勾条件、选身份，右栏实时看 SQL 变。
     SQL 生成逻辑**照抄真编译器的输出格式**（包括括号、反引号、子查询包装）。
     config:
       actors: [{ id, staffId, dataLevel, label, note }]
       conds:  [{ key, label, kind, sql|col, options?, unit?, def, op }]
       table:  宇宙表名
  ============================================================ */
  WIDGETS['dsl-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const TABLE = cfg.table || 'user_portraits_wide';
    const actors = cfg.actors || [];
    const conds = cfg.conds || [];
    if (!actors.length || !conds.length) return;

    const st = { actor: 0, mode: 'include', pick: {}, val: {} };
    conds.forEach((c, i) => { st.pick[c.key] = i === 0; st.val[c.key] = c.def; });

    const H = (tag, cls, text) => el(tag, cls, text);
    const q = (col) => '`u`.' + col;

    /* ---- 左栏 ---- */
    const left = H('div', 'dl-left');

    const secActor = H('div', 'dl-sec');
    secActor.append(H('h5', null, '① 谁在圈'));
    const segA = H('div', 'dl-seg');
    const actorBtns = actors.map((a, i) => {
      const b = H('button');
      b.append(H('span', null, a.label));
      if (a.note) b.append(H('small', null, a.note));
      b.addEventListener('click', () => { st.actor = i; draw(); });
      segA.append(b);
      return b;
    });
    secActor.append(segA);
    left.append(secActor);

    const secCond = H('div', 'dl-sec');
    secCond.append(H('h5', null, '② 圈什么'));
    const condBox = H('div', 'dl-conds');
    const inputs = {};
    conds.forEach((c) => {
      const row = H('div', 'dl-cond');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = st.pick[c.key];
      cb.addEventListener('change', () => { st.pick[c.key] = cb.checked; draw(); });
      row.append(cb, H('span', 'nm', c.label));
      let input;
      if (c.kind === 'enum') {
        input = document.createElement('select');
        (c.options || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.v; opt.textContent = o.t;
          input.append(opt);
        });
      } else {
        input = document.createElement('input');
        input.type = 'number';
      }
      input.value = String(st.val[c.key]);
      input.addEventListener('input', () => { st.val[c.key] = input.value; draw(); });
      input.addEventListener('change', () => { st.val[c.key] = input.value; draw(); });
      row.append(input);
      inputs[c.key] = { row, cb, input };
      condBox.append(row);
    });
    secCond.append(condBox);
    left.append(secCond);

    const secMode = H('div', 'dl-sec');
    secMode.append(H('h5', null, '③ 这批条件是「包含」还是「排除」'));
    const modeBox = H('div', 'dl-mode');
    const modeBtns = [
      { m: 'include', t: '包含 (include)' },
      { m: 'exclude', t: '排除 (exclude)' },
    ].map((o) => {
      const b = H('button', null, o.t);
      b.setAttribute('data-m', o.m);
      b.addEventListener('click', () => { st.mode = o.m; draw(); });
      modeBox.append(b);
      return b;
    });
    secMode.append(modeBox);
    left.append(secMode);

    /* ---- 右栏 ---- */
    const right = H('div', 'dl-right');
    function sqlBox(title, sub) {
      const wrap = H('div', 'dl-sql');
      const head = document.createElement('header');
      head.append(H('b', null, title));
      if (sub) head.append(H('span', null, sub));
      const pre = document.createElement('pre');
      wrap.append(head, pre);
      right.append(wrap);
      return pre;
    }
    const preUids = sqlBox('uidsSql', '只查 uid —— 冻名单用它');
    const preCount = sqlBox('countSql', '包一层 COUNT(*) —— 界面上的「共 N 人」');

    const legend = H('div', 'dl-legend');
    [['var(--amber)', '权限（演员决定，不是用户圈出来的）'],
     ['var(--text)', '用户圈的条件'],
     ['var(--violet)', '派生表达式（逻辑字段 → 物理列）']]
      .forEach(([c, t]) => {
        const s = H('span');
        const i = H('i'); i.style.background = c;
        s.append(i, H('span', null, t));
        legend.append(s);
      });
    right.append(legend);

    const wrap2 = H('div', 'dl-wrap');
    wrap2.append(left, right);
    box.append(wrap2);

    /* ---- SQL 生成 ---- */
    /* segs 是一行内的片段；lines 是一行一个数组。
       为什么要分行：真编译器吐出来的是一整行（省字节），但一整行读不了 ——
       子句挤在一起，「权限 / 条件 / 派生表达式」三色也分不出来。 */
    function render(pre, lines) {
      const nodes = [];
      lines.forEach((segs, i) => {
        if (i) nodes.push(document.createTextNode('\n'));
        segs.forEach((s) => nodes.push(s[1] ? H('span', s[1], s[0]) : document.createTextNode(s[0])));
      });
      fill(pre, nodes);
    }

    function universeSegs(a) {
      const out = [];
      if (a.dataLevel === 'team') out.push(['`u`.`group_id` IN (1, 2, 3)', 'perm']);
      if (a.dataLevel === 'self') out.push(['`u`.`staff_id` = ' + a.staffId, 'perm']);
      return out;
    }

    function condSeg(c) {
      const v = st.val[c.key];
      if (c.kind === 'enum') {
        const o = (c.options || []).find((x) => x.v === v) || { v: v, t: v };
        return [q(c.col) + " = '" + o.v + "'", 'cond'];
      }
      /* 派生字段：逻辑名 → 物理列的表达式。和 slug 的 derive 字段同构。 */
      const derived = c.derive === 'age'
        ? ['TIMESTAMPDIFF(YEAR, `u`.`birthday`, CURRENT_DATE())', 'cast']
        : c.derive === 'days'
          ? ['DATEDIFF(CURRENT_DATE(), ' + q(c.col) + ')', 'cast']
          : [q(c.col), 'cond'];
      const opSql = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' }[c.op || 'gte'];
      return [derived[0] + ' ' + opSql + ' ' + v, derived[1]];
    }

    /* 把若干片用 AND 连起来，外层加括号 —— 跟真编译器一样，单条也包括号 */
    function groupSegs(parts) {
      const out = [['(', 'kw']];
      parts.forEach((p, i) => {
        if (i) out.push([' AND ', 'kw']);
        out.push(p);
      });
      out.push([')', 'kw']);
      return out;
    }

    /* WHERE 按谓词拆行：
         WHERE <第一条>
           AND <第二条>
       开头是 WHERE / AND，不在同一行堆一串 AND。 */
    function whereLines(indent, a, tree) {
      const pad = ' '.repeat(indent);
      const preds = [];
      universeSegs(a).forEach((s) => preds.push([s]));
      if (tree) {
        preds.push(st.mode === 'include'
          ? tree
          : [['NOT COALESCE(', 'kw']].concat(tree, [[', FALSE)', 'kw']]));
      }
      return preds.map((p, i) => [[pad + (i === 0 ? 'WHERE ' : '  AND '), 'kw']].concat(p));
    }

    /* uidSql 拆成多行；indent 给 countSql 的内层用 */
    function coreLines(indent, a, tree) {
      const pad = ' '.repeat(indent);
      return [
        [[pad + 'SELECT ', 'kw'], ['`u`.`uid`', 'cond'], [' AS ', 'kw'], ['`uid`', 'cond']],
        [[pad + 'FROM ', 'kw'], ['`' + TABLE + '`', 'cond'], [' AS ', 'kw'], ['`u`', 'cond']],
      ].concat(whereLines(indent, a, tree));
    }

    function draw() {
      const a = actors[st.actor];
      actorBtns.forEach((b, i) => b.classList.toggle('on', i === st.actor));
      modeBtns.forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === st.mode));
      conds.forEach((c) => {
        const { row, cb, input } = inputs[c.key];
        cb.checked = st.pick[c.key];
        row.classList.toggle('on', st.pick[c.key]);
        input.disabled = !st.pick[c.key];
      });

      const picked = conds.filter((c) => st.pick[c.key]);
      const condParts = picked.map(condSeg);
      /* 条件树本身保持一行 —— 它本来就是一个括号组，
         拆开反而看不出「这是一整块条件」。 */
      const tree = condParts.length ? groupSegs(condParts) : null;

      render(preUids, coreLines(0, a, tree));
      /* countSql：把 uidSql 缩进两格嵌进 FROM ( … ) 里，
         跟真编译器的包装关系一致（它就是 uid 再包一层）。 */
      render(preCount, [
        [['SELECT ', 'kw'], ['COUNT(*)', 'kw'], [' AS ', 'kw'], ['`count`', 'cond']],
        [['FROM (', 'kw']],
      ].concat(coreLines(2, a, tree), [
        [[') AS ', 'kw'], ['`t`', 'cond']],
      ]));

      if (statusEl) {
        const n = picked.length;
        statusEl.textContent = a.label + ' · ' + (n ? n + ' 个条件' : '无条件') +
          ' · ' + (st.mode === 'include' ? '包含' : '排除');
      }
    }
    draw();
  };

  /* ============================================================
     控件：null-lab —— include / exclude 的 NULL 三态
     同一批数据、同一个条件，只换「放进哪边」和「包不包 COALESCE」，
     看哪几行被留住。讲透 `NOT COALESCE(expr, FALSE)` 为什么要写。
     config:
       col:      谓词里的列名
       label:    列的中文名
       matchVal: 谓词的值
       rows:     [{ id, name, v }]   v 为 null 表示 NULL
  ============================================================ */
  WIDGETS['null-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const COL = cfg.col || 'gender';
    const MATCH = cfg.matchVal || 'M';
    const rows = cfg.rows || [];
    if (!rows.length) return;

    const st = { side: 'include', coalesce: true };
    const H = (tag, cls, text) => el(tag, cls, text);

    const wrap = H('div', 'nt-wrap');

    /* 开关 */
    const ctrl = H('div', 'nt-ctrl');
    function grp(title, opts, get, set) {
      const g = H('div', 'nt-grp');
      g.append(H('h5', null, title));
      const o = H('div', 'opts');
      const btns = opts.map((x) => {
        const b = H('button', null, x.t);
        b.addEventListener('click', () => { if (!b.disabled) { set(x.v); draw(); } });
        o.append(b);
        return { b, v: x.v };
      });
      g.append(o);
      ctrl.append(g);
      return { btns, get };
    }
    const sideG = grp('把 `gender = \'M\'` 放进',
      [{ v: 'include', t: 'include' }, { v: 'exclude', t: 'exclude' }],
      () => st.side, (v) => { st.side = v; });
    const coG = grp('exclude 写法',
      [{ v: true, t: 'NOT COALESCE((expr), FALSE)' }, { v: false, t: 'NOT (expr)' }],
      () => st.coalesce, (v) => { st.coalesce = v; });
    wrap.append(ctrl);

    /* WHERE 片段 */
    const where = H('div', 'nt-where');
    where.append(H('b', null, 'WHERE 片段'));
    const code = H('code');
    where.append(code);
    wrap.append(where);

    /* 数据表 */
    const tbl = H('div', 'nt-tbl');
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['uid', 'name', COL, 'SQL 判定', '结果'].forEach((t) => trh.append(H('th', null, t)));
    thead.append(trh);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    tbl.append(table);
    wrap.append(tbl);

    /* 汇总 */
    const sum = H('div', 'nt-sum');
    wrap.append(sum);

    box.append(wrap);

    /* 三值逻辑：和 SQL 引擎一致 */
    function truth(v) {
      if (v === null) return null;      // UNKNOWN
      return v === MATCH;                // TRUE / FALSE
    }
    function keeps(v) {
      const t = truth(v);
      if (st.side === 'include') return t === true;         // WHERE 把 UNKNOWN 当 false
      if (st.coalesce) return !(t === true);                // NOT COALESCE(t, FALSE)：UNKNOWN → 留下
      return t === false;                                   // NOT (UNKNOWN) = UNKNOWN → 丢掉
    }
    function verdict(v) {
      const t = truth(v);
      const tName = t === null ? 'UNKNOWN' : String(t).toUpperCase();
      if (st.side === 'include') return tName + '  →  ' + (t === true ? '留下' : '丢掉');
      if (st.coalesce) return 'NOT COALESCE(' + tName + ', FALSE)  →  ' + (t === true ? '丢掉' : '留下');
      return 'NOT (' + tName + ')  →  ' + (t === false ? '留下' : '丢掉');
    }

    function draw() {
      sideG.btns.forEach((x) => {
        x.b.classList.toggle('on', x.v === st.side);
        x.b.disabled = false;
      });
      coG.btns.forEach((x) => {
        x.b.classList.toggle('on', x.v === st.coalesce);
        x.b.disabled = st.side !== 'exclude';
      });

      const expr = COL + " = '" + MATCH + "'";
      fill(code, st.side === 'include'
        ? [document.createTextNode('(' + expr + ')')]
        : st.coalesce
          ? [H('span', 'co', 'NOT COALESCE'), document.createTextNode('((' + expr + '), '), H('span', 'nt2', 'FALSE'), document.createTextNode(')')]
          : [H('span', 'co', 'NOT'), document.createTextNode(' (' + expr + ')')]);

      fill(tbody, rows.map((r) => {
        const keep = keeps(r.v);
        const tr = document.createElement('tr');
        if (!keep) tr.className = 'drop';
        tr.append(H('td', null, String(r.id)));
        tr.append(H('td', null, r.name));
        const td = H('td', 'v', r.v === null ? 'NULL' : String(r.v));
        if (r.v === null) td.classList.add('null');
        tr.append(td);
        tr.append(H('td', 'v', verdict(r.v)));
        tr.append(H('td', 'res', keep ? '✓ 留下' : '✗ 丢掉'));
        return tr;
      }));

      const kept = rows.filter((r) => keeps(r.v)).length;
      const nulls = rows.filter((r) => r.v === null).length;
      const nullKept = rows.filter((r) => r.v === null && keeps(r.v)).length;
      fill(sum, [
        h('div', {}, [h('small', { text: '留下' }), h('b', { cls: kept === rows.length || kept === 0 ? 'bad' : 'good', text: kept + ' / ' + rows.length })]),
        h('div', {}, [h('small', { text: '其中 NULL 行' }), h('b', { cls: nullKept === nulls ? 'bad' : 'good', text: nullKept + ' / ' + nulls })]),
        h('div', {}, [h('span', { cls: 'verdict', text: st.side === 'exclude'
          ? (st.coalesce
            ? '排除了 M，但 NULL 行留下了 —— 它们既不「是 M」也不「不是 M」。'
            : '这个写法会把 NULL 行一起弄丢 —— 它们被当成「是 M」排掉了。')
          : '命中 M 的才留下。NULL 行不命中，自然丢掉 —— 这是 include 该有的行为。' })]),
      ]);
      if (statusEl) {
        statusEl.textContent = st.side + (st.side === 'exclude' ? ' · ' + (st.coalesce ? 'NOT COALESCE(expr, FALSE)' : 'NOT (expr)') : '') + ' · 留下 ' + kept + '/' + rows.length;
      }
    }
    draw();
  };


  /* ============================================================
     控件：config-to-ui —— 配置怎么变成界面
     左边是 MySQL 里的元数据行（可改），右边是照着它渲染出来的界面。
     点任一边，另一边高亮来源/去向。改左边的字，右边当场变。
     config:
       rows: [{ key, zh, col, vt, on }]        元数据行（crm_dc_data_field）
       conds: [{ key, op, val }]               初始条件行
       ops:  { valueType: [opKey, ...] }       类型 → 可用操作符（crm_dc_operator）
       opLabels: { opKey: 中文 }
       vtLabels: { valueType: 中文 }
     ============================================================ */
  WIDGETS['config-to-ui'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const rows = (cfg.rows || []).map((r) => ({ ...r }));
    const conds = (cfg.conds || []).map((c) => ({ ...c }));
    const OPS = cfg.ops || {};
    const OPL = cfg.opLabels || {};
    const VTL = cfg.vtLabels || {};
    if (!rows.length || !conds.length) return;

    const enabled = () => rows.filter((r) => r.on);
    const byKey = (k) => rows.find((r) => r.key === k);
    let hot = null; // 当前高亮的 field_key

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    // ---------- 左：元数据 ----------
    const left = el('div', 'c2u-pane');
    left.appendChild(el('div', 'c2u-head')).append(
      Object.assign(el('span', 'tag tone-violet', 'MySQL'), {}),
      el('b', '', 'crm_dc_data_field'),
      el('span', 'sub', 'Data Admin 写这里'),
    );
    const recsBox = el('div', 'c2u-recs');
    left.appendChild(recsBox);

    // ---------- 右：界面 ----------
    const right = el('div', 'c2u-pane');
    right.appendChild(el('div', 'c2u-head')).append(
      el('span', 'tag tone-blue', '前端'),
      el('b', '', '圈选界面'),
      el('span', 'sub', '浏览器里看到的'),
    );
    const uiBox = el('div', 'c2u-ui');
    right.appendChild(uiBox);

    const mid = el('div', 'c2u-mid');
    mid.innerHTML = '<span>双向<br>联动</span>';

    const grid = el('div', 'c2u');
    grid.appendChild(left);
    grid.appendChild(mid);
    grid.appendChild(right);
    box.appendChild(grid);

    // ---------- 高亮 ----------
    function setHot(key, silent) {
      hot = key;
      recsBox.querySelectorAll('.c2u-rec').forEach((n) => {
        n.classList.toggle('is-hot', n.getAttribute('data-key') === key);
      });
      uiBox.querySelectorAll('[data-from]').forEach((n) => {
        n.classList.toggle('is-hot', n.getAttribute('data-from') === key);
      });
      if (statusEl && !silent) {
        if (!key) {
          statusEl.textContent = '点左边任意一条记录，或右边任意一个控件';
        } else {
          // 真的数一遍，别写死 —— 不同字段影响的元素数不一样
          const hits = uiBox.querySelectorAll('[data-from="' + key + '"]').length;
          const f = byKey(key);
          if (hits) {
            statusEl.textContent = '右侧亮起来的 ' + hits + ' 个元素，都来自 ' + key + ' 这一条记录';
          } else if (f && f.on) {
            // 启用了，但没有条件用到它 —— 它只在字段下拉的选项列表里
            statusEl.textContent = key + ' 只出现在字段下拉的选项里，当前没有条件用到它';
          } else {
            statusEl.textContent = key + ' 被停用了（status = 0），界面上已经没有它';
          }
        }
      }
    }

    // ---------- 渲染右侧 ----------
    function renderUI() {
      uiBox.textContent = '';
      const on = enabled();
      conds.forEach((c, ci) => {
        if (!byKey(c.key) || !byKey(c.key).on) {
          const fb = on[0];
          if (fb) { c.key = fb.key; c.op = (OPS[fb.vt] || ['eq'])[0]; }
        }
        const f = byKey(c.key);
        if (!f) return;

        const line = el('div', 'c2u-cond');
        line.setAttribute('data-from', f.key);

        const pk = el('select', 'c2u-sel');
        pk.setAttribute('data-from', f.key);
        on.forEach((r) => {
          const o = el('option', '', r.zh + '  ·  ' + r.key);
          o.value = r.key;
          if (r.key === c.key) o.selected = true;
          pk.appendChild(o);
        });
        pk.addEventListener('change', () => {
          c.key = pk.value;
          const nf = byKey(c.key);
          const ops = OPS[nf.vt] || ['eq'];
          if (!ops.includes(c.op)) c.op = ops[0];
          renderUI();
          setHot(c.key);
        });

        const ops = OPS[f.vt] || ['eq'];
        const ok = el('select', 'c2u-sel narrow');
        ok.setAttribute('data-from', f.key);
        ok.setAttribute('data-src', 'operator');
        ops.forEach((o) => {
          const oo = el('option', '', OPL[o] || o);
          oo.value = o;
          if (o === c.op) oo.selected = true;
          ok.appendChild(oo);
        });
        ok.addEventListener('change', () => { c.op = ok.value; setHot(c.key); });
        ok.addEventListener('mouseenter', () => setHot(f.key, true));

        const val = el('input', 'c2u-in');
        val.setAttribute('data-from', f.key);
        val.value = c.val;

        line.addEventListener('click', (e) => { if (e.target === line) setHot(f.key); });
        line.append(pk, ok, val);
        uiBox.appendChild(line);
      });

      // 结果表头（同一份元数据的另一种投影）
      const th = el('div', 'c2u-thead');
      th.setAttribute('data-from', '__head');
      const tHead = el('div', 'c2u-thead-t', '结果表头 —— 同样来自那 46 条记录');
      th.appendChild(tHead);
      const tr = el('div', 'c2u-tr');
      ['UID', '客户名称', '跟进人'].forEach((t) => tr.appendChild(el('span', 'c2u-th2 fixed', t)));
      on.slice(0, 5).forEach((r) => {
        const s = el('span', 'c2u-th2', r.zh);
        s.setAttribute('data-from', r.key);
        s.addEventListener('click', () => setHot(r.key));
        s.addEventListener('mouseenter', () => setHot(r.key, true));
        tr.appendChild(s);
      });
      th.appendChild(tr);
      uiBox.appendChild(th);

      const add = el('div', 'c2u-add', '+ 条件');
      add.title = '界面上没有硬编码的字段 —— 它只是把 status=1 的记录列出来';
      uiBox.appendChild(add);

      // 右下这块留白不是 bug：界面本来就比元数据表短。
      // 把结论放在这里，比空着强。
      // 数字由笔记提供（facts），控件不硬编码内容 —— 否则改数据要改控件
      const F = cfg.facts;
      if (F) {
        const note = el('div', 'c2u-note');
        note.innerHTML =
          '左边 <b>' + rows.length + '</b> 条记录，右边渲染出 <b>' + on.length +
          '</b> 个字段下拉 + <b>' + on.length + '</b> 列表头。<br>' +
          '真实表里有 <b>' + F.total + '</b> 条记录，但只有 <b>' + F.feature +
          '</b> 条是画像字段进了下拉 —— 另外 <b>' + F.rel + '</b> 条是关系，走另一条路。<br>' +
          '<span class="c2u-note-hi">前端代码从头到尾没多一行。</span>';
        uiBox.appendChild(note);
      }
    }

    // ---------- 渲染左侧 ----------
    function renderRecs() {
      recsBox.textContent = '';
      rows.forEach((r) => {
        const n = el('div', 'c2u-rec');
        n.setAttribute('data-key', r.key);

        const top = el('div', 'c2u-rec-top');
        top.appendChild(el('code', 'c2u-k', r.key));
        const sw = el('label', 'c2u-sw');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = r.on;
        cb.addEventListener('change', () => { r.on = cb.checked; renderRecs(); renderUI(); setHot(r.key); });
        sw.appendChild(cb);
        sw.appendChild(el('span', '', r.on ? 'status = 1' : 'status = 0'));
        top.appendChild(sw);
        n.appendChild(top);

        const body = el('div', 'c2u-rec-body');

        const f1 = el('label', 'c2u-f');
        f1.appendChild(el('span', 'c2u-fk', 'display_name_i18n.zh-CN'));
        const inp = el('input', 'c2u-edit');
        inp.value = r.zh;
        inp.addEventListener('input', () => { r.zh = inp.value; renderUI(); });
        inp.addEventListener('focus', () => setHot(r.key));
        f1.appendChild(inp);
        body.appendChild(f1);

        const f2 = el('div', 'c2u-f wide');
        f2.appendChild(el('span', 'c2u-fk', 'column_name'));
        const cw = el('span', 'c2u-cvw');
        cw.appendChild(el('code', 'c2u-cv', r.col));
        cw.appendChild(el('span', 'c2u-dot', '·'));
        cw.appendChild(el('code', 'c2u-cv dim', (VTL[r.vt] || r.vt) + ' / ' + (OPS[r.vt] || ['eq']).length + ' op'));
        f2.appendChild(cw);
        body.appendChild(f2);

        n.appendChild(body);
        n.addEventListener('click', () => setHot(r.key));
        n.addEventListener('mouseenter', () => setHot(r.key, true));
        recsBox.appendChild(n);
      });
    }

    renderRecs();
    renderUI();
    setHot(null);
  };


  /* ============================================================
     控件：field-lineage —— 一个字段的五层血缘
     界面上的字 → 元数据字段表 → 元数据数据源表 → 真实表 → 代码
     只回答一件事：**这个界面元素，底下到底连着哪张表、哪一列、哪段代码**。
     config:
       tabs: [{
         key,
         ui:     { label, src }                       界面那一格
         field:  { rows: [[k,v]], hint }              crm_dc_data_field
         source: { rows: [[k,v]], hint }              crm_dc_data_source
         table:  { name, cols: [[col,type,sample]], absent }   物理表
         code:   { rows: [[file,rule]] }              代码（不在数据库里）
       }]
     ============================================================ */
  WIDGETS['field-lineage'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const tabs = cfg.tabs || [];
    if (!tabs.length) return;
    let cur = 0;

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const row = (k, v, cls) => {
      const r = el('div', 'fl-row');
      r.appendChild(el('span', 'fl-k', k));
      r.appendChild(el('code', 'fl-v' + (cls ? ' ' + cls : ''), v));
      return r;
    };

    // —— 层外壳 ——
    function layer(n, name, tag, tone) {
      const L = el('div', 'fl-layer tone-' + tone);
      const h = el('div', 'fl-head');
      h.appendChild(el('span', 'fl-n', n));
      h.appendChild(el('b', '', name));
      if (tag) h.appendChild(el('span', 'fl-tag', tag));
      L.appendChild(h);
      return L;
    }

    // —— 箭头 ——
    function arrow(text, down) {
      const a = el('div', 'fl-arrow' + (down ? '' : ' up'));
      a.appendChild(el('span', 'fl-arrow-line', down ? '↓' : '↑'));
      if (text) a.appendChild(el('span', 'fl-arrow-t', text));
      return a;
    }

    function render() {
      box.textContent = '';
      const t = tabs[cur];

      // 切换标签
      const bar = el('div', 'fl-tabs');
      tabs.forEach((x, i) => {
        const b = el('button', 'fl-tab' + (i === cur ? ' on' : ''), x.key);
        b.addEventListener('click', () => { cur = i; render(); });
        bar.appendChild(b);
      });
      box.appendChild(bar);

      const body = el('div', 'fl-body');

      // ① 界面
      const L1 = layer('①', '界面', t.ui.tag || '前端实时渲染', 'blue');
      const uiBox = el('div', 'fl-ui');
      uiBox.appendChild(el('span', 'fl-ui-label', t.ui.label));
      L1.appendChild(uiBox);
      L1.appendChild(el('div', 'fl-note', '← ' + t.ui.src));
      body.appendChild(L1);

      body.appendChild(arrow('前端不认识业务，照配置渲染', true));

      // ② crm_dc_data_field
      const L2 = layer('②', 'crm_dc_data_field', '元数据 · Data Admin 改这里', 'violet');
      (t.field.rows || []).forEach((r) => L2.appendChild(row(r[0], r[1])));
      if (t.field.hint) L2.appendChild(el('div', 'fl-note', '← ' + t.field.hint));
      body.appendChild(L2);

      body.appendChild(arrow('data_source_id 指向', true));

      // ③ crm_dc_data_source
      const L3 = layer('③', 'crm_dc_data_source', '元数据 · 逻辑名 → 物理表', 'violet');
      (t.source.rows || []).forEach((r) => L3.appendChild(row(r[0], r[1])));
      if (t.source.hint) L3.appendChild(el('div', 'fl-note', '← ' + t.source.hint));
      body.appendChild(L3);

      body.appendChild(arrow('table_name 指向', true));

      // ④ 真实表
      const L4 = layer('④', 'Doris 真实表', t.table.name, 'amber');
      const tb = el('table', 'fl-table');
      const th = el('tr');
      ['列名', '类型', '真实值'].forEach((x) => th.appendChild(el('th', '', x)));
      tb.appendChild(th);
      (t.table.cols || []).forEach((c) => {
        const tr = el('tr');
        c.forEach((x, i) => tr.appendChild(el('td', i === 2 ? 'fl-sample' : '', x)));
        tb.appendChild(tr);
      });
      L4.appendChild(tb);
      if (t.table.absent) L4.appendChild(el('div', 'fl-absent', '✗ ' + t.table.absent));
      body.appendChild(L4);

      // ⑤ 代码（向上指）
      body.appendChild(arrow('这一层不在数据库里', false));
      const L5 = layer('⑤', '代码', '硬编码 · Data Admin 管不到', 'red');
      (t.code.rows || []).forEach((r) => {
        const x = el('div', 'fl-row');
        x.appendChild(el('code', 'fl-file', r[0]));
        x.appendChild(el('code', 'fl-v', r[1]));
        L5.appendChild(x);
      });
      body.appendChild(L5);

      box.appendChild(body);

      if (statusEl) statusEl.textContent = t.key + ' —— 五层，前四层是数据，第五层是代码';
    }

    render();
  };
  /* ============================================================
     控件：count-dedup-lab —— 「包一层」到底去不去重

     数据集：3 个人，其中一个人持 5 个标的。LEFT JOIN 之后是 7 行。
     四种写法对比：
       JOIN 后直接 COUNT(*)   → 7（数的是行）
       包一层（只选 uid）      → 7（==没变！这就是重点==）
       DISTINCT 再包一层       → 3（数的是人）
       COUNT(DISTINCT uid)    → 3

     为什么值得单做一块：这是 SQL 里高频的误解 ——
     「子查询里只 select uid 就去重了」是错的，去重必须写 DISTINCT 或 GROUP BY。
     config:
       universe: 宽表名
       joinTable: 关系表名
       users: [{ uid, name, holdings: [...] }]
  ============================================================ */
  WIDGETS['count-dedup-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const U = cfg.universe || 'user_portraits_wide';
    const H = cfg.joinTable || 'rel_holding';
    const users = cfg.users || [];
    if (!users.length) return;

    const H_ = (tag, cls, text) => el(tag, cls, text);

    /* 展开成 LEFT JOIN 之后的行 —— 没持仓的也留一行（object 为 null） */
    const rows = [];
    users.forEach((u) => {
      if (u.holdings && u.holdings.length) {
        u.holdings.forEach((o) => rows.push({ uid: u.uid, name: u.name, obj: o }));
      } else {
        rows.push({ uid: u.uid, name: u.name, obj: null });
      }
    });
    const people = users.length;
    const joined = rows.length;

    const MODES = [
      { k: 'join',      label: 'JOIN 后直接 COUNT(*)', n: joined,  ok: false },
      { k: 'wrap',      label: '包一层（只选 uid）',    n: joined,  ok: false },
      { k: 'distinct',  label: 'DISTINCT 再包一层',     n: people,  ok: true  },
      { k: 'cd',        label: 'COUNT(DISTINCT uid)',   n: people,  ok: true  },
    ];
    let mode = 'wrap';

    const modes = H_('div', 'cd-modes');
    MODES.forEach((m) => {
      const b = H_('button', null, m.label);
      b.addEventListener('click', () => { mode = m.k; draw(); });
      m.btn = b;
      modes.append(b);
    });

    const wrap = H_('div', 'cd-wrap');
    wrap.append(modes);

    const sqlBox = H_('div', 'cd-sql');
    const sqlPre = document.createElement('pre');
    sqlBox.append(sqlPre);
    wrap.append(sqlBox);

    const cols = H_('div', 'cd-cols');
    const rowsBox = H_('div', 'cd-rows');
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['uid', '客户', 'object_id'].forEach((t) => trh.append(H_('th', null, t)));
    thead.append(trh);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    rowsBox.append(table);
    const out = H_('div', 'cd-out');
    cols.append(rowsBox, out);
    wrap.append(cols);

    const verdict = H_('div', 'cd-verdict');
    wrap.append(verdict);
    box.append(wrap);

    function sqlLines(k) {
      const S = (t, c) => [t, c];
      const join = 'LEFT JOIN ' + H + ' AS `h` ON `h`.`uid` = `u`.`uid`';
      const from = [S('FROM ', 'kw'), S(U + ' AS `u`', null)];
      if (k === 'cd') {
        return [
          [S('SELECT ', 'kw'), S('COUNT(DISTINCT `u`.`uid`)', 'good'), S(' AS `count`', null)],
          from,
          [S(join, null)],
        ];
      }
      const inner = (sel) => [
        [S('SELECT ', 'kw'), S(sel, sel === 'DISTINCT `u`.`uid`' ? 'good' : 'bad')],
        [S('FROM ', 'kw'), S(U + ' AS `u`', null)],
        [S(join, null)],
      ];
      if (k === 'join') {
        return [
          [S('SELECT ', 'kw'), S('COUNT(*)', 'bad'), S(' AS `count`', null)],
          from,
          [S(join, null)],
        ];
      }
      return [
        [S('SELECT ', 'kw'), S('COUNT(*)', null), S(' AS `count`', null)],
        [S('FROM (', 'kw')],
        /* 注意展开：inner() 返回的是**多行**（行数组），
           直接放进去会变成「一行里的一个片段是数组」，渲染出来就是 ",kw" 那种乱码。
           展开后每行只给第一个片段加缩进。 */
        ...inner(k === 'distinct' ? 'DISTINCT `u`.`uid`' : '`u`.`uid`').map((line) =>
          line.map((s, i) => [i === 0 ? '  ' + s[0] : s[0], s[1]])),
        [S(') AS `t`', 'kw')],
      ];
    }

    function draw() {
      const m = MODES.find((x) => x.k === mode);
      MODES.forEach((x) => x.btn.classList.toggle('on', x.k === mode));

      const nodes = [];
      sqlLines(mode).forEach((line, i) => {
        if (i) nodes.push(document.createTextNode('\n'));
        line.forEach((s) => nodes.push(s[1] ? H_('span', s[1], s[0]) : document.createTextNode(s[0])));
      });
      fill(sqlPre, nodes);

      /* 哪几行被「合并」了 —— DISTINCT / COUNT(DISTINCT) 会把重复 uid 折掉 */
      const seen = new Set();
      fill(tbody, rows.map((r) => {
        const dup = seen.has(r.uid);
        seen.add(r.uid);
        const tr = document.createElement('tr');
        if (dup && m.ok) tr.className = 'dup';
        tr.append(H_('td', null, String(r.uid)), H_('td', null, r.name));
        tr.append(H_('td', 'mk', r.obj === null ? 'NULL' : r.obj));
        if (dup && m.ok) tr.append(H_('td', '', ''));
        return tr;
      }));

      out.className = 'cd-out ' + (m.ok ? 'good' : 'bad');
      fill(out, [
        H_('small', null, 'COUNT 结果'),
        H_('b', null, String(m.n)),
        H_('em', null, m.ok ? `= 人数（${people} 人）` : `✗ 不是人数（${people} 人）`),
      ]);

      fill(verdict, [
        h('div', {}, [m.ok
          ? h('span', {}, [h('b', { text: '对的。' }), h('span', { text: ' DISTINCT 或 GROUP BY 才会去重 —— 内层先把 uid 折成一群人，外层再数。' })])
          : (mode === 'wrap'
            ? h('span', {}, [h('b', { text: '关键点：包一层没用。' }), h('span', { text: ' 子查询里只写 ' }), h('code', { text: 'SELECT `u`.`uid`' }), h('span', { text: ' 不会自动去重 —— 它还是原样吐出 ' + joined + ' 行。' })])
            : h('span', {}, [h('b', { text: '数的是行，不是人。' }), h('span', { text: ' 张三持 5 个标的就占 5 行，直接 COUNT(*) 把他算成了 5 个人。' })]))]),
        h('div', {}, [h('span', { text: '这批数据：' }), h('code', { text: String(people) }), h('span', { text: ' 个人，LEFT JOIN 之后 ' }), h('code', { text: String(joined) }), h('span', { text: ' 行。' })]),
      ]);

      if (statusEl) statusEl.textContent = m.label + ' → ' + m.n;
    }
    draw();
  };

  /* ============================================================
     控件：sql-inject-lab —— 同一个值，两种进 SQL 的方式

     左边「内联」用的是**现有实现的转义规则**（只把单引号翻倍）；
     右边「参数绑定」模拟 Knex 的输出形状（? + bindings）。

     两边的行数不是算出来的 —— 是拿真 Doris（crm_insight，100 万行）
     跑出来的，写在 config 里。所以页面上展示的“1000000 行”是实测值。
     config:
       table, field, totalRows
       cases: [{ tag, input, inline: <行数|null=语法错>, bound: <行数> }]
  ============================================================ */
  WIDGETS['sql-inject-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const T = cfg.table || 'user_portraits_wide';
    const F = cfg.field || 'region';
    const cases = cfg.cases || [];
    if (!cases.length) return;

    const H_ = (tag, cls, text) => el(tag, cls, text);

    /* 现有实现的转义：只把单引号翻倍。**故意保留这个缺陷** —— 它就是被演示的东西。 */
    const inlineEsc = (v) => "'" + v.replace(/'/g, "''") + "'";

    let idx = 0;
    let typed = null;                       // 用户手输时用它

    const wrap = H_('div', 'si-wrap');

    /* 输入行 */
    const row = H_('div', 'si-input');
    row.append(H_('label', null, '用户填的值'));
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.spellcheck = false;
    inp.addEventListener('input', () => { typed = inp.value; draw(); });
    row.append(inp);
    const presets = H_('div', 'si-presets');
    const pbtns = cases.map((c, i) => {
      const b = H_('button', null, c.tag);
      b.addEventListener('click', () => { idx = i; typed = null; draw(); });
      presets.append(b);
      return b;
    });
    row.append(presets);
    wrap.append(row);

    /* 两个面板 */
    const panes = H_('div', 'si-panes');
    function pane(tone, head, sub) {
      const p = H_('div', 'si-pane');
      p.style.setProperty('--tone', tone);
      const h = document.createElement('header');
      h.append(H_('b', null, head), H_('span', null, sub));
      const pre = document.createElement('pre');
      const foot = H_('div', 'si-foot');
      p.append(h, pre, foot);
      panes.append(p);
      return { pre, foot };
    }
    const L = pane('var(--red)', '内联', '现在的实现：把值抄进 SQL');
    const R = pane('var(--green)', '参数绑定', 'Knex：值单独给');
    wrap.append(panes);

    const verdict = H_('div', 'si-verdict');
    wrap.append(verdict);
    box.append(wrap);

    function segs(nodes) { return nodes; }
    function render(pre, nodes) {
      fill(pre, nodes.map((n) =>
        n[1] ? H_('span', n[1], n[0]) : document.createTextNode(n[0])));
    }

    function draw() {
      const c = typed === null ? cases[idx] : null;
      const value = typed === null ? c.input : typed;
      inp.value = value;
      pbtns.forEach((b, i) => b.classList.toggle('on', typed === null && i === idx));

      const lit = inlineEsc(value);
      render(L.pre, segs([
        ['SELECT COUNT(*) ', 'kw'], ['FROM ', 'kw'], [T + ' AS u'],
        ['\nWHERE ', 'kw'], ['u.`' + F + '` = '], [lit, 'bad'],
      ]));
      render(R.pre, segs([
        ['SELECT COUNT(*) ', 'kw'], ['FROM ', 'kw'], [T + ' AS u'],
        ['\nWHERE ', 'kw'], ['u.`' + F + '` = '], ['?', 'ph'],
        ['\nbindings: ', 'kw'], [JSON.stringify([value]), 'ok'],
      ]));

      /* 行数：预设的看实测值；手输的说明“没实测过” */
      const inlineRows = c ? c.inline : null;
      const boundRows = c ? c.bound : null;
      const fmt = (n) => (n === null ? '—' : n.toLocaleString('en-US'));

      fill(L.foot, c
        ? [H_('small', null, '实测行数'),
           H_('b', null, inlineRows === null ? '语法错' : fmt(inlineRows)),
           H_('em', null, inlineRows === null
             ? '整条查询挂了'
             : inlineRows >= cfg.totalRows ? '全表！条件被绕过了' : '（这一条碰巧是对的）')]
        : [H_('small', null, '手输的值没实测过'), H_('em', null, '点上面的预设看真实数据')]);
      fill(R.foot, c
        ? [H_('small', null, '实测行数'), H_('b', null, fmt(boundRows)),
           H_('em', null, '正确答案：没人叫这个值')]
        : [H_('small', null, '手输的值没实测过'), H_('em', null, '点上面的预设看真实数据')]);

      /* 判词 */
      let tone = 'var(--blue)';
      let v = [];
      if (!c) {
        tone = 'var(--muted)';
        v = [h('span', { text: '手输的值只能看 SQL 长什么样 —— 行数是实测数据，只对上面四个预设有效。' })];
      } else if (c.tag === '正常值') {
        v = [h('span', {}, [h('b', { text: '两边一样。' }), h('span', { text: ' 正常值上看不出区别 —— 所以这个问题在测试环境里很容易漏掉。' })])];
      } else if (c.tag === '带单引号') {
        v = [h('span', {}, [h('b', { text: '两边还是一样。' }), h('span', { text: ' 因为单引号翻倍这一步做对了 —— ' }), h('code', { text: "'O''Brien'" }), h('span', { text: ' 在 SQL 里就是一个合法的字符串字面量。' })])];
      } else if (c.tag === '带反斜杠') {
        tone = 'var(--amber)'; L.pre.parentElement.style.setProperty('--tone', 'var(--amber)');
        v = [h('span', {}, [h('b', { text: '内联炸了 —— 而且这不是恶意输入。' }), h('span', { text: ' 一个以反斜杠结尾的值（比如某个自由文本字段）会把结尾的单引号转义掉，整条 SQL 变成未闭合字符串。' }), h('code', { text: ' 只把单引号翻倍不够，反斜杠也要处理。' })])];
      } else {
        tone = 'var(--red)';
        v = [h('span', {}, [h('b', { text: '内联返回了 100 万行 —— 全表。' }), h('span', { text: ' 输入里的 ' }), h('code', { text: '\\\'' }), h('span', { text: ' 把结尾单引号转义掉，于是后面的 ' }), h('code', { text: 'OR 1=1' }), h('span', { text: ' 变成了真正的 SQL 命令。右边因为值不参与解析，什么都不发生。' })])];
      }
      verdict.style.setProperty('--tone', tone);
      fill(verdict, v);

      if (statusEl) statusEl.textContent = c ? c.tag : '手输';
    }
    draw();
  };

  /* ---------- 挂载 ---------- */
  document.querySelectorAll('[data-widget]').forEach((root) => {
    var name = root.getAttribute('data-widget');
    var fn = WIDGETS[name];
    if (fn) { try { fn(root); } catch (e) { console.error('[widget:' + name + ']', e); } }
    else { console.warn('[widget] 未注册：' + name); }
  });
})();
