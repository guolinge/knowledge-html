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
          lx = a.cx + (e.labelDx || 0);
          ly = a.top - r * 1.32 + (e.labelDy || 0);   // 标签放在弧顶上方，不压线
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

        /* 作者手动微调标签位置。
           为什么需要：群组框（groups）的标签画在框的左上角，
           而边标签默认落在那条缝的**水平中点** ——
           缝一窄，两个标签就叠在一起（字都在，只是读不通）。
           ==工具算不出「那里已经有群组标签了」，但作者一眼就知道该往哪挪。==
           所以给一条手动通道，比让人改文案凑位置靠谱。 */
        if (e.labelDx) lx += e.labelDx;
        if (e.labelDy) ly += e.labelDy;

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

      /* 有 segments 时给顶部留余量。
         时间段框的标签画在框顶上方 7px —— 而头部（参与者卡片）底边
         和第一行是**紧挨着的**（间隙 0），不放余量的话标签只能落进
         头部或第一行，两边都撞。 */
      let segs = [];
      try {
        segs = JSON.parse(root.getAttribute('data-segs') || '[]');
      } catch (e) {
        segs = [];
      }
      const SEG_PAD = segs.length ? 30 : 0;
      /* 余量必须加在 **DOM** 上，不能只加进 SVG 的 y ——
         否则箭头下移了、消息文字没动，两边错位。
         加在 body 的 padding-top，row.offsetTop 就自带它。 */
      body.style.paddingTop = SEG_PAD ? SEG_PAD + 'px' : '';

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
      const xs = Object.values(cx);
      if (xs.length) {
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        segs.forEach((g) => {
          const inRange = msgGeom.filter((m) => m.i >= g.from && m.i <= g.to);
          if (!inRange.length) return;
          /* 留白要比「消息行的一半」大 —— .smsg 高 56px，半高 28。
             以前写 14，框顶和标签都落在第一行**内部**，
             正好撞上自调用放在 lifeline 左边那个序号。 */
          const PAD = 30;
          const top = Math.min(...inRange.map((m) => m.y)) - PAD;
          const bottom = Math.max(...inRange.map((m) => m.y)) + PAD;
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

  /* 行内轻量标记 —— 控件这边拼出来的文字要用到和积木一样的强调写法。
     积木那边是构建期的 tools/lib/blocks.mjs 在做，控件跑在浏览器里拿不到它，
     所以这里实现一份**最小**的：==强调== / **重音** / `代码`。
     只处理这三种，别往里加东西 —— 两边逻辑越像，越容易漂移。 */
  const richText = (host, text) => {
    const src = String(text == null ? '' : text);
    const re = /==([^=]+)==|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) host.append(document.createTextNode(src.slice(last, m.index)));
      if (m[1] !== undefined) host.append(el('span', 'hl-tag', m[1]));
      else if (m[2] !== undefined) host.append(el('strong', '', m[2]));
      else host.append(el('code', '', m[3]));
      last = m.index + m[0].length;
    }
    if (last < src.length) host.append(document.createTextNode(src.slice(last)));
    return host;
  };

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
        /* ⚠️ 必须跳过**已经脱离 DOM** 的元素。
           踩过：锚点按钮的点击处理里会重建按钮条，事件冒泡到这里时
           ev.target 已经是那个被换掉的旧按钮 —— fig.contains() 返回 false，
           于是一条「点到图外了」把刚点亮的高亮当场清掉，表现为「点了没反应」。 */
        if (!ev.target.isConnected) return;
        if (!fig.contains(ev.target)) { uiClear(); clear(); }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { uiClear(); clear(); }
      });

      /* ============================================================
         语义层：入口 / 导览 / 面板
         ------------------------------------------------------------
         图是 archify 出的（几何、校验、渲染都不归我们）。
         这里加的只有**语义**：每个零件的说明、几个「我熟悉 ___」的入口、
         几条导览。原则 ②「整体图」要的就是这三样 ——
         整体图零件多，读者需要一个入口，而不是从头看起。

         实现上全部复用上面那两个函数（focus / clear）：它们已经在
         SVG 的属性上做筛选，不需要再解析拓扑。
         ============================================================ */
      if (!fig.hasAttribute('data-pano')) return;
      var mount = fig.querySelector('.pano-ui');
      if (!mount) return;

      var meta = {};
      ['parts', 'anchors', 'tours'].forEach(function (k) {
        try { meta[k] = JSON.parse(fig.getAttribute('data-' + k) || 'null'); }
        catch (e) { meta[k] = null; }
      });
      var partsMeta = meta.parts || {};
      var anchors = meta.anchors || [];
      var tours = meta.tours || [];
      var tourIdx = -1, stepIdx = 0;

      var bar = el('div', 'pano-anchors');
      var tabs = el('div', 'pano-tabs');
      var panel = el('div', 'pano-panel');
      mount.append(bar, tabs, panel);
      // UI 区里的点击不参与「点空白取消」—— 它和图是两件事
      mount.addEventListener('click', function (ev) { ev.stopPropagation(); });

      /** 点亮一组节点（导览用）。和 focus 的区别：focus 是「一个 + 它的邻居」，这里是「指定的几个」 */
      function focusMany(ids) {
        clear();
        var want = {};
        ids.forEach(function (i) { want[i] = true; });
        nodes.forEach(function (n) {
          var on = !!want[n.getAttribute('data-node-id')];
          n.classList.toggle('is-hot', on);
        });
        edges.forEach(function (e) {
          var on = want[e.getAttribute('data-edge-from')] && want[e.getAttribute('data-edge-to')];
          e.classList.toggle('is-hot', on);
        });
        fig.setAttribute('data-focus', 'tour');
      }

      function uiClear() { tourIdx = -1; stepIdx = 0; }

      function drawBar() {
        if (!anchors.length) { bar.hidden = true; return; }
        bar.textContent = '';
        bar.append(el('span', 'pano-tlabel', '我熟悉'));
        anchors.forEach(function (a) {
          var b = el('button', 'pano-anchor');
          b.type = 'button';
          b.textContent = a.label;
          b.addEventListener('click', function () {
            uiClear();
            focus(a.part);
            showPart(a.part);
            drawBar(); drawTabs();
          });
          return bar.append(b);
        });
      }

      function relRow(arrow, otherId, label) {
        var row = el('div', 'pano-relrow');
        row.append(el('span', 'pano-arrow', arrow));
        var m = partsMeta[otherId];
        row.append(el('span', 'pano-relname', (m && m.label) || otherId));
        var t = el('span', 'pano-rellab');
        richText(t, label || '（连线）');
        row.append(t);
        if (partsMeta[otherId]) {
          var go = el('button', 'pano-goto', '看它');
          go.type = 'button';
          go.addEventListener('click', function () { uiClear(); focus(otherId); showPart(otherId); });
          row.append(go);
        }
        return row;
      }

      function showPart(id) {
        var m = partsMeta[id] || {};
        panel.textContent = '';
        var head = el('div', 'pano-phead');
        head.append(el('b', '', m.label || id));
        if (m.sub) head.append(el('span', 'pano-pen', m.sub));
        panel.append(head);
        if (m.detail) {
          var d = el('p', 'pano-pdetail');
          richText(d, m.detail);
          panel.append(d);
        }
        /* archify 的 SVG 里，一条边的**标签**是另一个元素，也带着
           data-edge-from/to —— 直接遍历会把同一条边数两遍（面板里出现两行一样的）。
           所以按 from|to 去重：一头一尾只算一条关系。 */
        var outs = [], ins = [], seen = {};
        var addRel = function (list, other, e) {
          var k = e.getAttribute('data-edge-from') + '|' + e.getAttribute('data-edge-to');
          if (seen[k]) return;
          seen[k] = 1;
          list.push({ other: other, e: e });
        };
        edges.forEach(function (e) {
          var from = e.getAttribute('data-edge-from'), to = e.getAttribute('data-edge-to');
          if (from === id) addRel(outs, to, e);
          else if (to === id) addRel(ins, from, e);
        });
        var rel = el('div', 'pano-rel');
        outs.forEach(function (o) { rel.append(relRow('→', o.other, o.e.getAttribute('data-edge-label'))); });
        ins.forEach(function (o) { rel.append(relRow('←', o.other, o.e.getAttribute('data-edge-label'))); });
        if (!outs.length && !ins.length) rel.append(el('p', 'pano-relrow', '它在这张图上没有连线。'));
        panel.append(rel);
        var back = el('button', 'pano-clear', '✕ 取消选中，看全图');
        back.type = 'button';
        back.addEventListener('click', function () { uiClear(); clear(); drawTabs(); showHint(); });
        panel.append(back);
      }

      function showTour() {
        var t = tours[tourIdx];
        if (!t) return;
        var st = t.steps[stepIdx];
        focusMany(st.at || []);
        panel.textContent = '';
        var head = el('div', 'pano-phead');
        head.append(el('b', '', t.label));
        head.append(el('span', 'pano-pen', '第 ' + (stepIdx + 1) + ' / ' + t.steps.length + ' 步'));
        panel.append(head);
        var d = el('p', 'pano-pdetail');
        richText(d, st.text);
        panel.append(d);
        var nav = el('div', 'pano-nav');
        var prev = el('button', 'pano-nb', '‹ 上一步');
        prev.type = 'button';
        prev.disabled = stepIdx === 0;
        prev.addEventListener('click', function () { if (stepIdx > 0) { stepIdx--; showTour(); } });
        var next = el('button', 'pano-nb pano-next',
          stepIdx >= t.steps.length - 1 ? '走完了，回到自由探索' : '下一步 ›');
        next.type = 'button';
        next.addEventListener('click', function () {
          if (stepIdx < t.steps.length - 1) { stepIdx++; showTour(); }
          else { tourIdx = -1; clear(); drawTabs(); showHint(); }
        });
        nav.append(prev, next);
        panel.append(nav);
      }

      function showHint() {
        panel.textContent = '';
        var head = el('div', 'pano-phead');
        head.append(el('b', '', '从你已经知道的那个东西出发'));
        panel.append(head);
        var p1 = el('p', 'pano-pdetail');
        richText(p1, '上面那排「我熟悉」是==入口== —— 挑一个你本来就懂的零件，'
          + '图会只点亮==它和它直接相关的那几个==，这里同时列出每一根线是什么意思。');
        panel.append(p1);
        var p2 = el('p', 'pano-pdetail');
        richText(p2, '之后 ==点图上任何被点亮的零件，它就变成新的中心==，邻域跟着走 —— '
          + '你就是这么一步步把不熟的东西接到熟的东西上的。');
        panel.append(p2);
        if (tours.length) {
          var p3 = el('p', 'pano-phint');
          richText(p3, '要按顺序一次看完，用上面的「导览」。');
          panel.append(p3);
        }
      }

      function drawTabs() {
        if (!tours.length) { tabs.hidden = true; return; }
        tabs.textContent = '';
        tabs.append(el('span', 'pano-tlabel', '导览'));
        tours.forEach(function (t, i) {
          var b = el('button', 'pano-tab' + (i === tourIdx ? ' is-on' : ''));
          b.type = 'button';
          b.textContent = t.label;
          b.addEventListener('click', function () {
            tourIdx = i; stepIdx = 0; showTour(); drawTabs();
          });
          tabs.append(b);
        });
        var f = el('button', 'pano-tab pano-free' + (tourIdx === -1 ? ' is-on' : ''));
        f.type = 'button';
        f.textContent = '自由探索';
        f.addEventListener('click', function () { uiClear(); clear(); drawTabs(); showHint(); });
        tabs.append(f);
      }

      drawBar();
      drawTabs();
      showHint();
    });
  })();

  /* ============================================================
     通用控件库
     ------------------------------------------------------------
     约定：控件从 root.dataset.config 读配置，自己渲染 [data-mount] 里的内容。
     这样作者只写 YAML，不用手写 HTML。
  ============================================================ */
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


  /* ============================================================
     控件：row-to-catalog —— 数据库的一行怎么变成一个下拉项
     左：MySQL 里的原始行   中：转换规则（可点）   右：Catalog 里的条目
     点中间任一条规则 → 高亮它读了哪些列、写出了哪些字段。
     config:
       rules: [{ title, from:[srcKey], out:[outKey], note, code }]
       tabs:  [{ key, srcLabel, outLabel, src:[[k,v]], out:[[k,v]] }]
         —— 规则共享，标签只换「左边那一行」和「右边那个条目」
     ============================================================ */
  WIDGETS['row-to-catalog'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const rules = cfg.rules || [];
    const tabs = cfg.tabs || [];
    if (!rules.length || !tabs.length) return;
    let cur = 0;

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    // 标签栏
    const bar = el('div', 'r2c-tabs');
    tabs.forEach((t, i) => {
      const b = el('button', 'r2c-tab' + (i === 0 ? ' on' : ''), t.key);
      b.addEventListener('click', () => { cur = i; bar.querySelectorAll('.r2c-tab').forEach((n, j) => n.classList.toggle('on', j === i)); draw(); });
      bar.appendChild(b);
    });
    box.appendChild(bar);

    // 三栏骨架
    const wrap = el('div', 'r2c');
    const L = el('div', 'r2c-col'); const Lhead = el('div', 'r2c-colhead'); L.appendChild(Lhead);
    const srcBox = el('div', 'r2c-box'); L.appendChild(srcBox);
    const M = el('div', 'r2c-mid'); M.appendChild(el('div', 'r2c-colhead', '转换'));
    const R = el('div', 'r2c-col'); const Rhead = el('div', 'r2c-colhead'); R.appendChild(Rhead);
    const outBox = el('div', 'r2c-box'); R.appendChild(outBox);
    wrap.appendChild(L); wrap.appendChild(M); wrap.appendChild(R);
    box.appendChild(wrap);

    const note = el('div', 'r2c-note');
    box.appendChild(note);

    let srcRows = {}, outRows = {};
    let pickIdx = rules.length - 1;

    function fillRows(boxEl, list, store) {
      boxEl.textContent = '';
      const m = {};
      list.forEach(([k, v]) => {
        const r = el('div', 'r2c-row');
        r.appendChild(el('code', 'r2c-k', k));
        r.appendChild(el('code', 'r2c-v', v));
        boxEl.appendChild(r);
        m[k] = r;
      });
      return m;
    }
    function clearHot() {
      wrap.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot'));
    }
    function pick(i, scroll) {
      pickIdx = i;
      clearHot();
      const r = rules[i];
      (r.from || []).forEach((k) => srcRows[k] && srcRows[k].classList.add('is-hot'));
      (r.out || []).forEach((k) => outRows[k] && outRows[k].classList.add('is-hot'));
      M.querySelectorAll('.r2c-rule').forEach((n, j) => n.classList.toggle('is-hot', j === i));
      const hitFrom = (r.from || []).filter((k) => srcRows[k]).length;
      const hitOut = (r.out || []).filter((k) => outRows[k]).length;
      note.innerHTML =
        '<b class="r2c-rt">' + r.title + '</b> ' +
        '<span class="r2c-from">' + (r.from || []).join(' + ') + '</span>' +
        '<span class="r2c-arrow">→</span>' +
        '<span class="r2c-to">' + (r.out || []).join(' + ') + '</span>' +
        (hitOut === 0
          ? '<span class="r2c-skip">这条规则对这个字段不产出东西</span>'
          : (hitFrom === 0 ? '<span class="r2c-skip">这个字段用不到它</span>' : '')) +
        (r.code ? '<pre class="r2c-code">' + r.code + '</pre>' : '');
      /* 规则注释走 richText，和积木正文一样支持 ==高亮== / **加粗** / `代码`。
         config 走的是 JSON，构建期不会解析 markdown，直接拼 innerHTML 会按字面显示。 */
      note.insertBefore(richText(el('div', 'r2c-note1'), r.note || ''), note.querySelector('.r2c-code'));
      if (statusEl) statusEl.textContent = tabs[cur].key + ' · ' + r.title;
    }
    function draw() {
      const t = tabs[cur];
      Lhead.textContent = t.srcLabel || 'MySQL 原始行';
      Rhead.textContent = t.outLabel || 'Catalog 条目';
      srcRows = fillRows(srcBox, t.src || [], srcRows);
      outRows = fillRows(outBox, t.out || [], outRows);
      pick(pickIdx, false);
    }

    if (!M.querySelector('.r2c-rule')) {
      rules.forEach((r, i) => {
        const n = el('div', 'r2c-rule');
        n.appendChild(el('span', 'r2c-n', String(i + 1)));
        n.appendChild(el('span', 'r2c-t', r.title));
        n.addEventListener('click', () => pick(i, true));
        M.appendChild(n);
      });
    }
    draw();
  };

  /* ============================================================
     控件：validate-lab —— 喂几个坏输入，看它在哪一段被拦

     它对应的是「一个条件到底被哪一段挡下的」这个问题 ——
     光看两张校验清单表很难记住边界在哪，但看几个真实的反例就清楚了。

     config:
       cases: [{ label, stage: 'shape'|'semantic', code, mark, err, why }]
  ============================================================ */
  WIDGETS['validate-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const cases = cfg.cases || [];
    if (!cases.length) return;

    const H_ = (tag, cls, text) => el(tag, cls, text);
    let cur = 0;

    const pick = H_('div', 'vl-pick');
    const btns = cases.map((c, i) => {
      const b = H_('button', null, c.label);
      b.addEventListener('click', () => { cur = i; draw(); });
      pick.append(b);
      return b;
    });

    /* 三段流程条：当前案例会在其中一段停住 */
    const STAGES = [
      { k: 'shape', name: '① 形状校验', sub: '不看字段字典' },
      { k: 'semantic', name: '② 语义校验', sub: '看字段字典' },
      { k: 'compile', name: '③ 拼 SQL', sub: '不再判断规则' },
    ];
    const flow = H_('div', 'vl-flow');
    const steps = STAGES.map((s) => {
      const d = H_('div', 'vl-step');
      d.append(H_('span', null, s.name), H_('small', null, s.sub));
      flow.append(d);
      return d;
    });

    const out = H_('div', 'vl-out');
    const where = H_('div', 'vl-where');
    const codeEl = H_('span', 'vl-code');
    const inp = H_('div', 'vl-input');
    const pre = document.createElement('pre');
    inp.append(pre);
    const why = H_('div', 'vl-why');
    out.append(where, codeEl, inp, why);

    const legend = H_('div', 'vl-legend');
    [['var(--green)', '这一段过去了'], ['var(--red)', '在这里被拦下'], ['var(--muted)', '根本没走到']]
      .forEach(([c, t]) => {
        const sp = H_('span');
        const i = H_('i'); i.style.background = c;
        sp.append(i, H_('span', null, t));
        legend.append(sp);
      });

    /* 四块要套一层 .vl-wrap —— gap: 16px 定义在它上面。
       直接 append 到 mount 上的话，mount 是 .demo-body.custom，
       没有那个 gap —— 实测按钮行和流程条之间是 0px。 */
      /* 四块要套一层 .vl-wrap —— gap: 16px 定义在它上面。
         直接 append 到 mount 上的话，mount 是 .demo-body.custom，
         没有那个 gap —— 实测按钮行和流程条之间 0px，挤在一起。 */
      const wrap = H_('div', 'vl-wrap');
      wrap.append(pick, flow, out, legend);
      box.append(wrap);

    function draw() {
      const c = cases[cur];
      btns.forEach((b, i) => b.classList.toggle('on', i === cur));

      const order = STAGES.map((s) => s.k);
      const at = order.indexOf(c.stage);
      steps.forEach((d, i) => {
        d.classList.toggle('passed', i < at);
        d.classList.toggle('blocked', i === at);
        d.classList.toggle('notreached', i > at);
      });

      where.textContent = c.stage === 'shape'
        ? '第 ① 段拦下的 —— 它不需要字段字典'
        : '第 ② 段拦下的 —— 形状没问题，是跟字段字典对不上';
      codeEl.textContent = c.err;
      out.style.setProperty('--tone', 'var(--red)');

      /* 输入：把出问题的那一段标红 */
      const code = c.code || '';
      if (c.mark && code.includes(c.mark)) {
        const i = code.indexOf(c.mark);
        fill(pre, [
          document.createTextNode(code.slice(0, i)),
          H_('span', 'bad', c.mark),
          document.createTextNode(code.slice(i + c.mark.length)),
        ]);
      } else {
        pre.textContent = code;
      }
      why.textContent = c.why;

      if (statusEl) statusEl.textContent = c.label + ' → ' + c.err;
    }
    draw();
  };

  /* ============================================================
     控件：调度算法对比
     ------------------------------------------------------------
     同一组作业，换一种调度算法，执行顺序和三个指标全变。
     静态图只能画一种算法的结果，说不出「换一种就全变了」。

     算法在页面里现算（不预先烤好），所以改作业只需改 config。

     config:
       jobs:     [{ id, arrive, burst, priority }]
       quantum:  2          RR 的时间片
       mlfq:     [1,2,4]    多级反馈队列三级的时间片
       algos:    [{ id, name, note }]   可选，覆盖内置说明
  ============================================================ */

  /* —— 模拟内核：逐时间单位推进，六种算法共用 ——
     pick     从就绪队列里挑一个（必须从数组里摘掉）
     quantum  (level) => 时间片
     levels   有几级（多级反馈队列用）
     preempt  (正在跑的, 就绪队列) => 要不要换下来 */
  const simulate = (jobs, opt) => {
    const js = jobs.slice()
      .sort((a, b) => a.arrive - b.arrive || String(a.id).localeCompare(String(b.id)))
      .map((j) => ({ ...j, left: j.burst, end: null, level: 0, used: 0, resp: null }));
    const segs = [];
    const ready = [];
    let t = 0, nextIdx = 0, cur = null, requeue = null, guard = 0;

    while ((nextIdx < js.length || ready.length || cur || requeue) && guard++ < 4000) {
      while (nextIdx < js.length && js[nextIdx].arrive <= t) ready.push(js[nextIdx++]);
      /* 上一轮用完时间片的排到队尾 —— 要在新到的之后，否则 RR 会让刚跑过的又插队 */
      if (requeue) { ready.push(requeue); requeue = null; }

      if (cur && opt.preempt && opt.preempt(cur, ready)) { ready.push(cur); cur = null; }
      if (!cur) {
        if (!ready.length) { t++; continue; }
        cur = opt.pick(ready, t);
        if (cur.resp === null) cur.resp = t;
        cur.used = 0;
      }

      cur.left -= 1; cur.used += 1; t += 1;
      const last = segs[segs.length - 1];
      if (last && last.id === cur.id && last.end === t - 1 && last.level === cur.level) last.end = t;
      else segs.push({ id: cur.id, start: t - 1, end: t, level: cur.level });

      if (cur.left === 0) { cur.end = t; cur = null; continue; }
      if (opt.quantum && cur.used >= opt.quantum(cur.level)) {
        if (opt.levels) cur.level = Math.min(cur.level + 1, opt.levels - 1);
        requeue = cur; cur = null;
      }
    }
    for (const j of js) { j.turn = j.end - j.arrive; j.wait = j.turn - j.burst; }
    return { jobs: js, segs, total: t };
  };

  const takeMin = (arr, key) => {
    let b = 0;
    for (let i = 1; i < arr.length; i++) if (key(arr[i]) < key(arr[b])) b = i;
    return arr.splice(b, 1)[0];
  };

  const SCHED_ALGOS = (jobs, quantum, mlfq) => [
    {
      id: 'FCFS', name: '先来先服务',
      note: '谁先到谁先跑，跑完才换人。长作业排在前面时，后面的人一起倒霉。',
      run: () => simulate(jobs, { pick: (r) => r.shift() }),
    },
    {
      id: 'SJF', name: '最短作业优先',
      note: '每次挑运行时间最短的。平均周转能压到最低，代价是长作业一直被往后推。',
      run: () => simulate(jobs, { pick: (r) => takeMin(r, (j) => j.left) }),
    },
    {
      id: 'HRRN', name: '高响应比优先',
      note: '每次算 (等待时间 + 要求服务时间) / 要求服务时间，谁高谁上。等得越久响应比越高。',
      run: () => simulate(jobs, {
        pick: (r, t) => {
          let b = 0, bv = -1;
          for (let i = 0; i < r.length; i++) {
            const v = (t - r[i].arrive + r[i].burst) / r[i].burst;
            if (v > bv) { bv = v; b = i; }
          }
          return r.splice(b, 1)[0];
        },
      }),
    },
    {
      id: 'RR', name: '时间片轮转 · q=' + quantum,
      note: '每人只跑一个时间片，跑不完就回队尾。响应通常最快，但切换次数最多、周转通常不好。',
      run: () => simulate(jobs, { pick: (r) => r.shift(), quantum: () => quantum }),
    },
    {
      id: 'HPF', name: '最高优先级优先 · 抢占式',
      note: '优先级数字越小越优先。一旦就绪队列里出现更高优先级的，立刻换人。低优先级的会被饿着。',
      run: () => simulate(jobs, {
        pick: (r) => takeMin(r, (j) => j.priority),
        preempt: (c, r) => r.some((j) => j.priority < c.priority),
      }),
    },
    {
      id: 'MLFQ', name: '多级反馈队列 · ' + mlfq.join('/'),
      note: '新作业进第一级（时间片最短），没跑完就降到下一级（时间片变长）。短作业快速通过，长作业在后面慢慢跑。',
      run: () => simulate(jobs, {
        pick: (r) => takeMin(r, (j) => j.level),
        quantum: (lv) => mlfq[lv],
        levels: mlfq.length,
        preempt: (c, r) => r.some((j) => j.level < c.level),
      }),
    },
  ];

  const JOB_TONES = ['blue', 'violet', 'green', 'amber', 'red', 'muted'];

  WIDGETS['sched-lab'] = (root) => {
    const cfg = cfgOf(root);
    const jobs = cfg.jobs || [];
    if (!jobs.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const quantum = cfg.quantum || 2;
    const mlfq = cfg.mlfq || [1, 2, 4];
    const algos = SCHED_ALGOS(jobs, quantum, mlfq);
    const toneOf = new Map(jobs.map((j, i) => [j.id, JOB_TONES[i % JOB_TONES.length]]));

    const results = algos.map((a) => ({ a, r: a.run() }));
    const total = Math.max(...results.map((x) => x.r.total));
    const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

    /* —— 算法按钮 —— */
    const bar = el('div', 'sl-algos');
    const note = el('p', 'sl-note');
    const gantt = el('div', 'sl-gantt');
    const cards = el('div', 'sl-cards');
    const rank = el('div', 'sl-rank');

    /* —— 甘特图：时间轴 + 每个作业一行 + 一条 CPU 占用行 —— */
    const fmtSeg = (s) => s.id + ' ' + s.start + '→' + s.end;
    const drawGantt = (res) => {
      gantt.textContent = '';
      const grid = el('div', 'sl-plot');
      grid.style.setProperty('--sl-ticks', String(total));

      /* 刻度：密了反而看不清，所以按 total 挑一个步长，首尾两个一定标出来 */
      const axis = el('div', 'sl-axis');
      const step = Math.max(1, Math.ceil(total / 10));
      const marks = [];
      for (let i = 0; i <= total; i += step) marks.push(i);
      if (marks[marks.length - 1] !== total) {
        /* 末尾那个刻度如果离 total 太近，两个数字会糊在一起 —— 直接把它换成 total */
        if (total - marks[marks.length - 1] < step * 0.6) marks[marks.length - 1] = total;
        else marks.push(total);
      }
      marks.forEach((i) => {
        const tick = el('span', 'sl-tick', String(i));
        tick.style.left = (i / total) * 100 + '%';
        /* 两端的字不能被裁掉一半，所以 0 靠左、total 靠右 */
        if (i === 0) tick.style.transform = 'none';
        else if (i === total) tick.style.transform = 'translateX(-100%)';
        axis.append(tick);
      });
      grid.append(axis);

      const rowFor = (label, segs, tone, sub) => {
        const row = el('div', 'sl-row');
        const name = el('div', 'sl-name');
        name.append(el('b', '', label));
        if (sub) name.append(el('span', 'sl-sub', sub));
        const track = el('div', 'sl-track');
        segs.forEach((s) => {
          const b = el('div', 'sl-block' + (s.level ? ' lv' + s.level : ''), String(s.start) + '–' + s.end);
          b.style.left = (s.start / total) * 100 + '%';
          b.style.width = ((s.end - s.start) / total) * 100 + '%';
          b.style.setProperty('--sl-tone', 'var(--' + tone + ')');
          b.style.setProperty('--sl-soft', 'var(--' + tone + '-soft)');
          b.title = fmtSeg(s);
          track.append(b);
        });
        row.append(name, track);
        grid.append(row);
      };

      /* 每个作业一行：只画它自己占 CPU 的那几段 */
      jobs.forEach((j) => {
        const mine = res.segs.filter((s) => s.id === j.id);
        rowFor(j.id, mine, toneOf.get(j.id), '到达 ' + j.arrive + ' · 需要 ' + j.burst);
      });

      /* CPU 占用行：把所有人拼成一条时间轴，看谁在哪个时刻占着 CPU。
         这一行只写作业名 —— 时间已经由位置表达了，再写一遍反而看不清。 */
      const cpuSegs = res.segs.slice().sort((a, b) => a.start - b.start);
      const cpuTrack = el('div', 'sl-track sl-cpu-track');
      cpuSegs.forEach((s) => {
        const b = el('div', 'sl-block sl-cpu', s.id);
        b.style.left = (s.start / total) * 100 + '%';
        b.style.width = ((s.end - s.start) / total) * 100 + '%';
        b.style.setProperty('--sl-tone', 'var(--' + toneOf.get(s.id) + ')');
        b.style.setProperty('--sl-soft', 'var(--' + toneOf.get(s.id) + '-soft)');
        cpuTrack.append(b);
      });
      const cpuRow = el('div', 'sl-row sl-cpu-row');
      const cpuName = el('div', 'sl-name');
      cpuName.append(el('b', '', 'CPU'));
      cpuName.append(el('span', 'sl-sub', '谁在跑'));
      cpuRow.append(cpuName, cpuTrack);
      grid.append(cpuRow);

      gantt.append(grid);
    };

    /* —— 三个指标卡 + 六种算法横向对比 —— */
    const avg = (r, f) => r.jobs.reduce((s, j) => s + f(j), 0) / r.jobs.length;

    const drawStats = (res) => {
      cards.textContent = '';
      [
        { k: '平均周转时间', v: avg(res, (j) => j.turn), d: '从到达完成用了多久 = 等待 + 运行' },
        { k: '平均等待时间', v: avg(res, (j) => j.wait), d: '在就绪队列里干等了多久' },
        { k: '平均响应时间', v: avg(res, (j) => j.resp - j.arrive), d: '从到达第一次拿到 CPU 用了多久' },
      ].forEach((m) => {
        const c = el('div', 'sl-card');
        c.append(el('small', '', m.k));
        c.append(el('b', 'sl-num', fmt(m.v)));
        c.append(el('span', 'sl-desc', m.d));
        cards.append(c);
      });

      rank.textContent = '';
      const sorted = results.slice().sort((a, b) => avg(a.r, (j) => j.turn) - avg(b.r, (j) => j.turn));
      const worst = Math.max(...results.map((x) => avg(x.r, (j) => j.turn)));
      rank.append(el('div', 'sl-rank-head', '六种算法的平均周转时间（越短越好）'));
      sorted.forEach(({ a, r }) => {
        const v = avg(r, (j) => j.turn);
        const line = el('div', 'sl-rank-row' + (a.id === cur.id ? ' on' : ''));
        line.append(el('span', 'sl-rank-name', a.id));
        const track = el('div', 'sl-rank-track');
        const fill = el('i');
        fill.style.width = (v / worst) * 100 + '%';
        track.append(fill);
        line.append(track, el('span', 'sl-rank-val', fmt(v)));
        line.addEventListener('click', () => pick(a.id));
        rank.append(line);
      });
    };

    /* —— 算法按钮 ——
       按钮上永远只写缩写，选中时把全名放进下面的说明行。
       否则选中态会把按钮撑宽，每点一下整排都跳一下。 */
    let cur = results[0].a;
    const btns = algos.map((a) => {
      const b = el('button', 'sl-btn', a.id);
      b.title = a.name;
      b.addEventListener('click', () => pick(a.id));
      bar.append(b);
      return { b, a };
    });
    const noteName = el('b', 'sl-name-inline');
    const noteText = el('span');
    note.append(noteName, noteText);

    function pick(id) {
      const hit = results.find((x) => x.a.id === id);
      if (!hit) return;
      cur = hit.a;
      btns.forEach(({ b, a }) => b.className = 'sl-btn' + (a.id === id ? ' on' : ''));
      noteName.textContent = cur.name + ' —— ';
      noteText.textContent = cur.note;
      drawGantt(hit.r);
      drawStats(hit.r);
      if (statusEl) statusEl.textContent = cur.name + ' · 平均周转 ' + fmt(avg(hit.r, (j) => j.turn));
    }

    box.append(bar, note, gantt, cards, rank);
    pick(cfg.default && results.some((x) => x.a.id === cfg.default) ? cfg.default : results[0].a.id);
  };

  /* ============================================================
     控件：切换开销对照（同进程内切线程 vs 跨进程切）
     ------------------------------------------------------------
     一步一条地走，看哪些动作两边都要做、哪一步开始分叉。
     分叉点只有一个：换不换页表。后面所有代价都从它衍生。

     config:
       steps: [{ title, detail, thread: 'yes'|'no', proc: 'yes'|'no',
                 threadWhy, procWhy, branch }]
       tail:  一句话，放在最后一步下面
  ============================================================ */
  WIDGETS['switch-cost'] = (root) => {
    const cfg = cfgOf(root);
    const steps = cfg.steps || [];
    if (!steps.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const bar = el('div', 'sc-bar');
    const prev = el('button', 'sc-btn', '‹ 上一步');
    const next = el('button', 'sc-btn sc-primary', '下一步 ›');
    const counter = el('span', 'sc-count');
    bar.append(prev, next, counter);

    const head = el('div', 'sc-head');
    const blurb = el('div', 'sc-blurb');
    const table = el('div', 'sc-table');
    const meter = el('div', 'sc-meter');
    box.append(head, blurb, bar, table, meter);
    if (cfg.tail) box.append(el('p', 'sc-tail', cfg.tail));

    /* 表头 */
    const hdr = el('div', 'sc-hrow sc-hdr');
    hdr.append(el('div', 'sc-hcell', '这一步要做什么'));
    hdr.append(el('div', 'sc-hcell', '同进程内切线程'));
    hdr.append(el('div', 'sc-hcell', '跨进程切换'));
    table.append(hdr);

    /* 三个格子的列标签在宽屏上由表头提供；
       窄屏表头会被藏掉，所以每个格子自带一个只能在窄屏看见的标签。 */
    const rows = steps.map((s, i) => {
      const row = el('div', 'sc-row' + (s.branch ? ' is-branch' : ''));
      const t = el('div', 'sc-cell sc-what');
      t.append(el('span', 'sc-idx', String(i + 1)), el('span', '', s.title));
      const mk = (colLabel) => {
        const c = el('div', 'sc-cell sc-do');
        const tag = el('span', 'sc-coltag', colLabel);
        const markEl = el('span', 'sc-mark');
        const whyEl = el('span', 'sc-why');
        c.append(tag, markEl, whyEl);
        return { c, markEl, whyEl };
      };
      const a = mk('同进程内切线程');
      const b = mk('跨进程切换');
      row.append(t, a.c, b.c);
      table.append(row);
      return { row, a, b, s };
    });

    /* 两条进度条共用 proc 那个分母 —— 同一把尺子才看得出「谁做的动作多」 */
    const total = steps.filter((s) => s.proc === 'yes').length;
    const meters = {};
    meter.append(el('div', 'sc-meter-cap', '切换要做的动作，累计到这一步做了几样'));
    [['thread', '同进程内切线程', 'blue'], ['proc', '跨进程切换', 'amber']].forEach(([key, label, tone]) => {
      const w = el('div', 'sc-meter-row');
      w.append(el('span', 'sc-meter-label', label));
      const track = el('div', 'sc-meter-track');
      const fill = el('i');
      fill.style.setProperty('--sl-tone', 'var(--' + tone + ')');
      track.append(fill);
      const num = el('span', 'sc-meter-num');
      w.append(track, num);
      meter.append(w);
      meters[key] = { fill, num };
    });

    let i = 0;
    function go(k) {
      i = Math.max(0, Math.min(steps.length - 1, k));
      const s = steps[i];
      head.textContent = '第 ' + (i + 1) + ' / ' + steps.length + ' 步 · ' + s.title;
      blurb.textContent = s.detail || '';

      const mark = (cell, v, why) => {
        cell.c.className = 'sc-cell sc-do ' + (v === 'yes' ? 'ok' : 'skip');
        cell.markEl.textContent = v === 'yes' ? '要做' : '不用做';
        cell.whyEl.textContent = why || '';
      };

      rows.forEach(({ row, a, b, s: st }, n) => {
        mark(a, st.thread, st.threadWhy);
        mark(b, st.proc, st.procWhy);
        row.classList.toggle('on', n === i);
        row.classList.toggle('done', n < i);
      });

      /* 累计到当前步为止已经做了几样 */
      const upTo = (key) => steps.slice(0, i + 1).filter((x) => x[key] === 'yes').length;
      const tDone = upTo('thread'), pDone = upTo('proc');
      meters.thread.fill.style.width = (tDone / total) * 100 + '%';
      meters.proc.fill.style.width = (pDone / total) * 100 + '%';
      meters.thread.num.textContent = tDone + ' / ' + total;
      meters.proc.num.textContent = pDone + ' / ' + total;
      if (statusEl) statusEl.textContent = '第 ' + (i + 1) + ' 步：' + (s.branch ? '这里开始分叉' : s.title);
    }

    prev.addEventListener('click', () => go(i - 1));
    next.addEventListener('click', () => go(i + 1));
    go(0);
  };

  /* ============================================================
     控件：同步 I/O 与异步 I/O 的时间轴
     ------------------------------------------------------------
     五种模型并排放在同一条时间轴上，拖一根时间指针走过去，
     看每一刻「应用到底能不能干别的」。

     要讲清的那一件事：
       六个名字听着像六件事，判据只有一条 ——
       数据准备、数据拷贝两个阶段，分别卡不卡你。
       所有同步模型都卡在「拷贝」上，只有异步 I/O 两段都不卡。

     config:
       tMax:   10                       时间轴总长
       models: [{ id, name, sub, tag, tone, sync, segs: [{ from, to, state, text }] }]
         state: wait 等数据准备 / copy 等数据拷贝 / free 能干别的 / done 已就绪
         sync:  'sync' | 'async' —— 决定它归到哪一边
  ============================================================ */
  const IO_STATE = {
    wait: { label: '卡住等数据', tone: 'red' },
    copy: { label: '卡住等拷贝', tone: 'amber' },
    free: { label: '可以干别的', tone: 'green' },
    done: { label: '已就绪 / 拿到数据', tone: 'blue' },
  };

  WIDGETS['io-models'] = (root) => {
    const cfg = cfgOf(root);
    const models = cfg.models || [];
    if (!models.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const T = cfg.tMax || 10;

    /* —— ① 图例 —— */
    const legend = el('div', 'io-legend');
    Object.entries(IO_STATE).forEach(([k, v]) => {
      const item = el('span', 'io-lg-item');
      item.append(el('i', 'io-lg-dot tone-' + v.tone), el('span', '', v.label));
      legend.append(item);
    });

    /* —— ② 时间轴：一行一个模型 —— */
    const stage = el('div', 'io-stage');
    const axis = el('div', 'io-axis');
    for (let i = 0; i <= T; i++) {
      const tk = el('span', 'io-tick', String(i));
      tk.style.left = (i / T) * 100 + '%';
      axis.append(tk);
    }
    stage.append(axis);

    const rows = models.map((m) => {
      const row = el('div', 'io-row');
      const name = el('div', 'io-name');
      name.append(el('b', '', m.name));
      if (m.sub) name.append(el('span', 'io-sub', m.sub));
      const track = el('div', 'io-track');

      const blocks = (m.segs || []).map((s) => {
        const st = IO_STATE[s.state] || IO_STATE.wait;
        const b = el('div', 'io-seg', '');
        b.style.left = (s.from / T) * 100 + '%';
        b.style.width = ((s.to - s.from) / T) * 100 + '%';
        b.classList.add('tone-' + st.tone);
        if (s.text) b.title = s.text;
        track.append(b);
        return b;
      });
      /* 时间指针：一根竖线扫过所有行 */
      const cursor = el('div', 'io-cursor');
      track.append(cursor);
      row.append(name, track);
      stage.append(row);
      return { m, row, blocks, cursor };
    });

    /* —— ③ 此刻各模型在干什么 —— */
    const now = el('div', 'io-now');

    /* —— ④ 两个阶段的判定表 —— */
    const verdict = el('div', 'io-verdict');

    /* —— ⑤ 时间滑块 —— */
    const bar = el('div', 'io-bar');
    const range = el('input', 'io-range');
    range.type = 'range'; range.min = '0'; range.max = String(T * 10); range.value = '0';
    const clock = el('b', 'io-clock', 't = 0');
    bar.append(clock, range);

    box.append(legend, stage, now, bar, verdict);

    /* —— 拖动：把时刻落到某个区间里 —— */
    const segAt = (m, t) => (m.segs || []).find((s) => t >= s.from && t < s.to) ||
      (t >= T ? (m.segs || [])[m.segs.length - 1] : null);

    function draw(t) {
      clock.textContent = 't = ' + (Math.round(t * 10) / 10);
      rows.forEach(({ m, blocks, cursor, row }) => {
        const hit = segAt(m, t);
        cursor.style.left = (t / T) * 100 + '%';
        blocks.forEach((b, i) => b.classList.toggle('on', hit === (m.segs || [])[i]));
        row.classList.toggle('idle', !hit || hit.state === 'free');
      });
      /* 此刻每一行在干什么 */
      now.textContent = '';
      now.append(el('div', 'io-now-head', '这一刻，哪个进程真的在干活？'));
      rows.forEach(({ m }) => {
        const hit = segAt(m, t);
        const st = hit ? (IO_STATE[hit.state] || IO_STATE.wait) : IO_STATE.done;
        const line = el('div', 'io-now-row');
        line.append(el('span', 'io-now-name', m.name));
        const chip = el('span', 'io-chip tone-' + st.tone, st.label);
        line.append(chip, el('span', 'io-now-text', hit && hit.text ? hit.text : ''));
        now.append(line);
      });
      if (statusEl) statusEl.textContent = 't = ' + (Math.round(t * 10) / 10);
    }

    /* 判定表是静态的 —— 它回答的是「这两个阶段卡不卡」，跟时刻无关 */
    verdict.textContent = '';
    verdict.append(el('div', 'io-verdict-head', '把名字去掉，只看两个阶段卡不卡'));
    const vh = el('div', 'io-vrow io-vhrow');
    ['模型', '数据准备阶段', '数据拷贝阶段', '归到哪边'].forEach((x) => vh.append(el('div', 'io-vcell', x)));
    verdict.append(vh);
    models.forEach((m) => {
      const r = el('div', 'io-vrow');
      r.append(el('div', 'io-vcell io-vname', m.name));
      [m.wait, m.copy].forEach((v) => {
        const c = el('div', 'io-vcell');
        c.append(el('span', 'io-chip tone-' + (v === 'no' ? 'green' : v === 'poll' ? 'amber' : 'red'),
          v === 'no' ? '不卡' : v === 'poll' ? '轮询 / 卡在 select' : '卡住'));
        r.append(c);
      });
      const c = el('div', 'io-vcell');
      c.append(el('span', 'io-chip tone-' + (m.sync === 'async' ? 'green' : 'red'),
        m.sync === 'async' ? '异步 I/O' : '同步 I/O'));
      r.append(c);
      verdict.append(r);
    });
    verdict.append(el('p', 'io-vtail', cfg.tail || ''));

    range.addEventListener('input', () => draw(Number(range.value) / 10));
    draw(0);
  };

  /* ============================================================
     控件：一个文件偏移量，走哪条指针路径
     ------------------------------------------------------------
     Unix inode 的 13 个指针不是平均分给所有文件的：
     小文件走直接指针，文件一大就往多级索引上爬。
     拖一根滑块看一个具体的偏移量落在哪一条路上、要多读几次磁盘。

     config:
       blockSize:      4096    一个数据块多少字节
       directCount:    10      直接指针个数
       pointerPerBlock: 1024   一个索引块能装多少个块号
       maxLog:         12      滑块上限 = 10^12 字节（1TB）
  ============================================================ */
  WIDGETS['inode-trace'] = (root) => {
    const cfg = cfgOf(root);
    const BS = cfg.blockSize || 4096;
    const D = cfg.directCount || 10;
    const N = cfg.pointerPerBlock || 1024;
    const MAXLOG = cfg.maxLog || 12;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    /* —— 四档的容量边界（直接算出来，不写死） —— */
    const caps = [
      { key: 'direct', name: '直接指针', ptrs: D, extra: 0, blocks: D },
      { key: 'L1', name: '一次间接', ptrs: 1, extra: 1, blocks: N },
      { key: 'L2', name: '二次间接', ptrs: 1, extra: 2, blocks: N * N },
      { key: 'L3', name: '三次间接', ptrs: 1, extra: 3, blocks: N * N * N },
    ];
    let acc = 0;
    caps.forEach((c) => { c.from = acc; acc += c.blocks; c.to = acc; });   /* 单位：块 */

    const fmtBytes = (n) => {
      if (n < 1024) return n + ' B';
      const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
      let i = -1, x = n;
      while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
      return (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) + ' ' + u[i];
    };
    const fmtInt = (n) => n.toLocaleString('en-US');

    /* —— 滑块：对数刻度，否则小文件区域根本拉不到 —— */
    const bar = el('div', 'it-bar');
    const range = el('input', 'it-range');
    range.type = 'range'; range.min = '0'; range.max = '1000'; range.value = '0';
    const readout = el('b', 'it-readout', '0 B');
    bar.append(readout, range);

    /* —— 预设：四档的分界点，点一下直接跳过去 —— */
    const presets = el('div', 'it-presets');
    const marks = [
      { label: '文件第一个字节', bytes: 0 },
      { label: '最后一个直接指针', bytes: D * BS - 1 },
      { label: '刚跨进一次间接', bytes: D * BS },
      { label: '刚跨进二次间接', bytes: caps[2].from * BS },
      { label: '刚跨进三次间接', bytes: caps[3].from * BS },
    ];
    const presetBtns = marks.map((m) => {
      const b = el('button', 'it-btn', m.label);
      b.title = fmtBytes(m.bytes);
      b.addEventListener('click', () => setBytes(m.bytes));
      presets.append(b);
      return { b, m };
    });

    /* —— 结果：走哪条路 + 逐层展开 —— */
    const answer = el('div', 'it-answer');
    const path = el('div', 'it-path');
    const table = el('div', 'it-table');

    box.append(bar, presets, answer, path, table);

    const bytesToVal = (n) => (n <= 1 ? 0 : (Math.log10(n) / MAXLOG) * 1000);
    const valToBytes = (v) => (v <= 0 ? 0 : Math.round(Math.pow(10, (v / 1000) * MAXLOG)));

    /* —— 容量表：当前档高亮 —— */
    const capRows = caps.map((c) => {
      const r = el('div', 'it-trow');
      r.append(el('div', 'it-tcell it-tname', c.name));
      r.append(el('div', 'it-tcell', c.ptrs + ' 个指针'));
      r.append(el('div', 'it-tcell', fmtBytes(c.blocks * BS) + '（' + fmtInt(c.blocks) + ' 块）'));
      r.append(el('div', 'it-tcell', c.extra === 0 ? '不用额外读' : '额外读 ' + c.extra + ' 次'));
      table.append(r);
      return { r, c };
    });

    /* —— 把字节偏移展开成一条路径 —— */
    function trace(bytes) {
      const blk = Math.floor(bytes / BS);
      const inBlk = bytes % BS;
      const tier = caps.find((c) => blk >= c.from && blk < c.to) || caps[caps.length - 1];
      const off = blk - tier.from;
      const steps = [];
      steps.push({ k: '字节偏移', v: fmtBytes(bytes), note: '第 ' + fmtInt(bytes) + ' 个字节' });
      steps.push({ k: '除以块大小', v: '逻辑块号 ' + fmtInt(blk) + '（块内第 ' + inBlk + ' 字节）', note: '一个块 ' + fmtBytes(BS) });
      steps.push({ k: '查 inode 的指针', v: tier.name, note: '这一号已经超出前面 ' + fmtInt(tier.from) + ' 块了' });

      if (tier.key === 'direct') {
        steps.push({ k: '取地址', v: '直接指针[' + off + '] 里就是数据块号', note: '不用再读别的块' });
      } else if (tier.key === 'L1') {
        steps.push({ k: '第 1 层', v: '一次间接块的第 ' + fmtInt(off) + ' 格', note: '先把这一个索引块读进内存' });
      } else if (tier.key === 'L2') {
        const a = Math.floor(off / N), b = off % N;
        steps.push({ k: '第 1 层', v: '二级索引块的 第 ' + fmtInt(a) + ' 格', note: '读第 1 个索引块' });
        steps.push({ k: '第 2 层', v: '下面那个索引块的 第 ' + fmtInt(b) + ' 格', note: '再读第 2 个索引块，这里才是数据块号' });
      } else {
        const a = Math.floor(off / (N * N)), b = Math.floor((off % (N * N)) / N), c = off % N;
        steps.push({ k: '第 1 层', v: '三级索引块的 第 ' + fmtInt(a) + ' 格', note: '读第 1 个索引块' });
        steps.push({ k: '第 2 层', v: '下一层索引块的 第 ' + fmtInt(b) + ' 格', note: '读第 2 个索引块' });
        steps.push({ k: '第 3 层', v: '再下一层的 第 ' + fmtInt(c) + ' 格', note: '读第 3 个索引块，终于拿到数据块号' });
      }
      steps.push({ k: '最后', v: '读出那个数据块', note: tier.extra === 0 ? '总共 1 次磁盘读' : '总共 ' + (tier.extra + 1) + ' 次磁盘读' });
      return { tier, blk, steps };
    }

    function draw(bytes) {
      readout.textContent = fmtBytes(bytes);
      const { tier, blk, steps } = trace(bytes);

      answer.textContent = '';
      const a = el('div', 'it-ans');
      a.append(el('span', 'it-ans-tag', tier.name));
      a.append(el('span', 'it-ans-text',
        tier.extra === 0
          ? 'inode 里那一格直接写着数据块号，不用再读别的块'
          : '得先读 ' + tier.extra + ' 个索引块才能找到数据块号'));
      answer.append(a);

      path.textContent = '';
      steps.forEach((s, i) => {
        const r = el('div', 'it-prow');
        r.append(el('span', 'it-pidx', String(i + 1)));
        r.append(el('span', 'it-pk', s.k));
        r.append(el('span', 'it-pv', s.v));
        r.append(el('span', 'it-pnote', s.note));
        path.append(r);
      });

      capRows.forEach(({ r, c }) => r.classList.toggle('on', c === tier));
      presetBtns.forEach(({ b, m }) => {
        const on = bytes >= m.bytes && (marks.indexOf(m) === marks.length - 1 || bytes < marks[marks.indexOf(m) + 1].bytes);
        b.classList.toggle('on', on);
      });
      if (statusEl) statusEl.textContent = '逻辑块 ' + fmtInt(blk) + ' → ' + tier.name;
    }

    function setBytes(n) {
      const v = Math.max(0, Math.min(1000, bytesToVal(Math.max(0, n))));
      range.value = String(Math.round(v));
      draw(valToBytes(v));
    }

    range.addEventListener('input', () => draw(valToBytes(Number(range.value))));
    setBytes(0);
  };

  /* ============================================================
     控件：硬链接的引用计数 —— 删一个名字，到底删掉了什么
     ------------------------------------------------------------
     硬链接就是在目录项层多写一个名字，inode 里只多一个计数。
     点任何一个名字的「删除」，看计数怎么变、数据什么时候真的没。
     软链接另算一条线 —— 它自己占一个 inode，内容是路径字符串。

     config:
       inode:      100                      被链接的 inode 号
       names:      [{ path, dir, kind }]    kind: 'origin' | 'hard'
       symlink:    { path, dir, inode, target }
       blocks:     "5 / 9 / 12"             数据块号，只是显示用
  ============================================================ */
  WIDGETS['link-refcount'] = (root) => {
    const cfg = cfgOf(root);
    const names = (cfg.names || []).map((n) => ({ ...n, alive: true }));
    if (!names.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const sym = cfg.symlink ? { ...cfg.symlink, alive: true } : null;
    const inoNo = cfg.inode || 100;

    const head = el('div', 'lr-head');
    const grid = el('div', 'lr-grid');
    const inode = el('div', 'lr-inode');
    const log = el('div', 'lr-log');
    const acts = el('div', 'lr-acts');
    const reset = el('button', 'lr-btn lr-ghost', '重置');
    acts.append(reset);
    box.append(head, grid, inode, acts, log);

    let lines = [];
    const say = (text, tone) => { lines.push({ text, tone }); };

    function draw() {
      const aliveHard = names.filter((n) => n.alive);
      const count = aliveHard.length;
      const dataAlive = count > 0;

      head.textContent = '现在有 ' + count + ' 个目录项指向 inode ' + inoNo;

      /* —— 目录列表 —— */
      grid.textContent = '';
      const mkRow = (dirLabel, item, onDelete) => {
        const r = el('div', 'lr-row' + (item.alive ? '' : ' dead'));
        const l = el('div', 'lr-name');
        l.append(el('span', 'lr-dir', dirLabel));
        l.append(el('span', 'lr-file', item.alive ? item.path : item.path + '（已删）'));
        r.append(l);
        if (onDelete && item.alive) {
          const b = el('button', 'lr-btn', '删除');
          b.addEventListener('click', onDelete);
          r.append(b);
        } else {
          r.append(el('span', 'lr-arrow', item.kind === 'sym' ? '指向路径' : '指向 inode ' + inoNo));
        }
        grid.append(r);
      };
      names.forEach((n) => mkRow(n.dir, n, () => {
        n.alive = false;
        say('删除目录项 ' + n.path + '：名字没了，inode ' + inoNo + ' 的引用计数减 1', 'amber');
        if (names.filter((x) => x.alive).length === 0) {
          say('引用计数降到 0 —— 现在才真的回收 inode ' + inoNo + ' 和数据块', 'red');
        } else {
          say('数据块没事，因为还有 ' + names.filter((x) => x.alive).length + ' 个名字指着它', 'green');
        }
        draw();
      }));
      if (sym) mkRow(sym.dir, { ...sym, kind: 'sym' }, () => {
        sym.alive = false;
        say('删掉软链接 ' + sym.path + '：它自己的 inode ' + sym.inode + ' 被回收，目标文件完全不受影响', 'green');
        draw();
      });

      /* —— 被链接的 inode —— */
      inode.textContent = '';
      inode.className = 'lr-inode ' + (dataAlive ? 'live' : 'freed');
      inode.append(el('div', 'lr-ino-title', 'inode ' + inoNo + (dataAlive ? '' : ' · 已回收')));
      const rc = el('div', 'lr-rc');
      rc.append(el('span', 'lr-rc-label', '引用计数'));
      rc.append(el('b', 'lr-rc-num', String(count)));
      rc.append(el('span', 'lr-rc-note', dataAlive ? '数据块 ' + (cfg.blocks || '') + ' 还占着' : '数据块已释放，空间可以给别人'));
      inode.append(rc);

      /* 软链接单独一条线：目标是死是活，它自己都在 */
      if (sym) {
        const s = el('div', 'lr-sym ' + (sym.alive ? '' : 'dead'));
        s.append(el('div', 'lr-ino-title', '软链接自己的 inode ' + sym.inode + (sym.alive ? '' : ' · 已回收')));
        s.append(el('div', 'lr-sym-body',
          sym.alive
            ? '内容就是一个字符串「' + sym.target + '」，存在它自己的数据块里' +
              (names.some((n) => n.alive) ? '' : '。目标已经没了，它现在是悬空链接')
            : '已经删掉了'));
        inode.append(s);
      }

      log.textContent = '';
      log.append(el('div', 'lr-log-head', '做了什么，发生了什么'));
      if (!lines.length) log.append(el('div', 'lr-line lr-dim', '从上面随便删一个名字试试'));
      lines.forEach((l) => log.append(el('div', 'lr-line tone-' + (l.tone || 'muted'), l.text)));
      if (statusEl) statusEl.textContent = '引用计数 = ' + count;
    }

    reset.addEventListener('click', () => {
      names.forEach((n) => { n.alive = true; });
      if (sym) sym.alive = true;
      lines = [];
      draw();
    });
    draw();
  };

  /* ============================================================
     控件：GMP 调度台
     ------------------------------------------------------------
     一个真的会跑的迷你调度器：每个 tick 就是一次 schedule()。
     想让人看到的四件事：
       ① G 只是一堆数据，自己不会跑；P 是「运行 Go 代码的许可」
       ② 新 G 落在创建者的本地队列里，所以一边倒才是常态
       ③ 本地队列空了会去膛别的 P 偷「一半」
       ④ 从网络里醒来的 G 进runnext，下一轮第一个被取

     config:
       gomaxprocs: 3      P 的个数
       goroutines: 14     一共多少个 G
       ioRatio:   0.4     多大比例的 G 会先去等网络
       seed:      7       固定随机种子，结果可重放
  ============================================================ */
  const makeRng = (seed) => {
    let s = seed || 1;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  };

  WIDGETS['gmp-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    /* —— 控制条 —— */
    const ctl = el('div', 'gl-ctl');
    const mk = (label, min, max, val) => {
      const w = el('div', 'gl-sl');
      w.append(el('span', 'gl-sl-lab', label));
      const r = el('input', 'gl-range');
      r.type = 'range'; r.min = String(min); r.max = String(max); r.value = String(val);
      const v = el('b', 'gl-sl-val', String(val));
      w.append(r, v);
      ctl.append(w);
      return { r, v };
    };
    const sP = mk('GOMAXPROCS', 1, 4, cfg.gomaxprocs || 3);
    const sG = mk('G 的总数', 4, 24, cfg.goroutines || 14);

    const btns = el('div', 'gl-btns');
    const bStep = el('button', 'gl-btn gl-primary', '跑一步');
    const bRun = el('button', 'gl-btn', '跑 10 步');
    const bReset = el('button', 'gl-btn gl-ghost', '重置');
    btns.append(bStep, bRun, bReset);
    const clock = el('span', 'gl-clock', 'tick 0');
    btns.append(clock);

    /* —— 舞台 —— */
    const stage = el('div', 'gl-stage');
    const grqBox = el('div', 'gl-pool');
    const netBox = el('div', 'gl-pool');
    const pool = el('div', 'gl-pools');
    pool.append(grqBox, netBox);
    const logBox = el('div', 'gl-log');

    box.append(ctl, btns, stage, pool, logBox);

    /* —— 状态 —— */
    let rnd = makeRng(cfg.seed || 7);
    let ps = [], grq = [], netpoll = [], done = 0, tick = 0, lines = [];

    function reset() {
      rnd = makeRng(cfg.seed || 7);
      const P = Number(sP.r.value), N = Number(sG.r.value);
      const ioRatio = cfg.ioRatio == null ? 0.4 : cfg.ioRatio;
      ps = []; grq = []; netpoll = []; done = 0; tick = 0; lines = [];

      const all = [];
      for (let i = 1; i <= N; i++) {
        all.push({ id: 'G' + i, left: 1 + Math.floor(rnd() * 4), io: rnd() < ioRatio });
      }
      /* 新 G 由 `go` 语句创建在本地 P —— 所以先全落到 P0 的队列里，
         这正是「扇出型任务把一百个新 G 全灌进创建者队列」的那个场景 */
      ps = Array.from({ length: P }, (_, i) => ({ id: 'P' + i, m: 'M' + i, runnext: null, lrq: [], cur: null, idle: 0 }));
      ps[0].lrq = all;
      say('tick 0', `新建 ${N} 个 G，全部落在 P0 的本地队列里（新 G 挂在创建者身上）`, 'violet');
      render();
    }

    const say = (t, text, tone) => {
      lines.push({ t, text, tone: tone || 'muted' });
      if (lines.length > 60) lines.shift();
    };

    /* —— 一次 schedule()：从 P 的角度睑一个 G —— */
    function take(p) {
      if (p.runnext) { const g = p.runnext; p.runnext = null; say('tick ' + tick, `${p.id} 取 runnext 里的 ${g.id}（刚从网络醒来，数据还热着）`, 'green'); return g; }
      if (p.lrq.length) return p.lrq.shift();
      if (tick > 0 && tick % 61 === 0 && grq.length) {
        say('tick ' + tick, `${p.id} 每 61 次抽查一次全局队列，带走 ${grq[0].id}`, 'blue');
        return grq.shift();
      }
      /* 偷一半：先找本地队列最长的那个 P */
      let victim = null;
      for (const q of ps) if (q !== p && q.lrq.length > (victim ? victim.lrq.length : 1)) victim = q;
      if (victim) {
        const n = Math.max(1, Math.floor(victim.lrq.length / 2));
        const stolen = victim.lrq.splice(victim.lrq.length - n, n);
        p.lrq.push(...stolen);
        say('tick ' + tick, `${p.id} 本地空了 → 从 ${victim.id} 偷走一半（${n} 个）`, 'amber');
        return p.lrq.shift();
      }
      if (grq.length) { const g = grq.shift(); say('tick ' + tick, `${p.id} 从全局队列取到 ${g.id}`, 'blue'); return g; }
      return null;
    }

    function step() {
      tick++;
      /* ① 正在跑的 G 走一格 */
      for (const p of ps) {
        if (!p.cur) continue;
        p.cur.left--;
        if (p.cur.left <= 0) {
          say('tick ' + tick, `${p.cur.id} 跑完了（累计 ${done + 1} 个）`, 'muted');
          p.cur = null; done++;
        }
      }
      /* ② 网络就绪：把 netpoll 里的一个 G 放回某个 P 的 runnext */
      if (netpoll.length && rnd() < 0.55) {
        const g = netpoll.pop();
        const p = ps[Math.floor(rnd() * ps.length)];
        if (p.runnext) p.lrq.unshift(p.runnext);
        p.runnext = g;
        say('tick ' + tick, `${g.id} 的网络数据到了 → 进 ${p.id} 的 runnext`, 'green');
      }
      /* ③ 每个 P 各取一个 G */
      for (const p of ps) {
        /* 一个 G 去等网络后 P 不能就停在那里 —— 它会转头再取一个，
           真的没活才空转（真实 runtime 也是循环到取不着为止） */
        let guard = 0;
        while (!p.cur && guard++ < 8) {
          const g = take(p);
          if (!g) { p.idle++; break; }
          if (g.io) {
            g.io = false;
            netpoll.push(g);
            say('tick ' + tick, `${g.id} 要等网络 → 挂到 netpoller，${p.id} 转头去跑别的`, 'amber');
            continue;
          }
          p.cur = g;
        }
      }
      render();
    }

    /* —— 渲染：只画状态，不改变状态 —— */
    function chip(g, cls) {
      return el('span', 'gl-chip' + (cls ? ' ' + cls : ''), g.id);
    }
    function render() {
      clock.textContent = 'tick ' + tick + '　已完成 ' + done + ' / ' + Number(sG.r.value);
      stage.textContent = '';
      ps.forEach((p) => {
        const card = el('div', 'gl-p');
        const hd = el('div', 'gl-p-head');
        hd.append(el('b', 'gl-p-id', p.id));
        hd.append(el('span', 'gl-p-m', p.m));
        if (p.cur) {
          hd.append(el('span', 'gl-p-run', '正在跑'), chip(p.cur, 'run'));
          hd.append(el('span', 'gl-p-left', '剩 ' + p.cur.left + ' tick'));
        } else {
          hd.append(el('span', 'gl-p-idle', p.idle ? '空转 ' + p.idle + ' tick' : '还没轮到'));
        }
        card.append(hd);
        const rn = el('div', 'gl-slot');
        rn.append(el('span', 'gl-slot-lab', 'runnext'));
        rn.append(p.runnext ? chip(p.runnext, 'next') : el('span', 'gl-empty', '—'));
        card.append(rn);
        const q = el('div', 'gl-queue');
        q.append(el('span', 'gl-slot-lab', 'LRQ'));
        if (!p.lrq.length) q.append(el('span', 'gl-empty', '空'));
        p.lrq.slice(0, 12).forEach((g) => q.append(chip(g)));
        if (p.lrq.length > 12) q.append(el('span', 'gl-empty', '+' + (p.lrq.length - 12)));
        card.append(q);
        stage.append(card);
      });

      const mkPool = (host, label, arr, tone, empty) => {
        host.textContent = '';
        const h = el('div', 'gl-pool-head');
        h.append(el('span', 'gl-pool-lab tone-' + tone, label));
        h.append(el('b', 'gl-pool-n', String(arr.length)));
        host.append(h);
        const list = el('div', 'gl-pool-list');
        if (!arr.length) list.append(el('span', 'gl-empty', empty));
        arr.slice(0, 16).forEach((g) => list.append(chip(g)));
        if (arr.length > 16) list.append(el('span', 'gl-empty', '+' + (arr.length - 16)));
        host.append(list);
      };
      mkPool(grqBox, '全局队列 GRQ', grq, 'violet', '空');
      mkPool(netBox, 'netpoller（在等网络的 G）', netpoll, 'amber', '空');

      logBox.textContent = '';
      logBox.append(el('div', 'gl-log-head', '调度日志（只记值得看的）'));
      lines.slice(-7).reverse().forEach((l) => {
        const r = el('div', 'gl-line tone-' + l.tone);
        r.append(el('span', 'gl-line-t', l.t));
        r.append(el('span', '', l.text));
        logBox.append(r);
      });
      if (statusEl) statusEl.textContent = 'tick ' + tick + ' · 完成 ' + done;
    }

    bStep.addEventListener('click', step);
    bRun.addEventListener('click', () => { for (let i = 0; i < 10; i++) step(); });
    bReset.addEventListener('click', reset);
    sP.r.addEventListener('input', () => { sP.v.textContent = sP.r.value; reset(); });
    sG.r.addEventListener('input', () => { sG.v.textContent = sG.r.value; reset(); });
    reset();
  };

  /* ============================================================
     控件：netpoller vs hand-off —— 同样是等，代价不一样
     ------------------------------------------------------------
     拖动「同时阻塞的 G 数」，看两条路的 M 数量分道扬镳：
       网络 I/O：等待被 netpoller 吸收，M 数量不变
       文件 I/O：每个 G 要一个 M 陪着沉进内核，M 线性膨胀
     这就是「为什么重文件 I/O 场景里 goroutine 的优势会打折」。

     config:
       gomaxprocs: 4
       blocked:    30     初始阻塞的 G 数
       max:        120    滑块上限
  ============================================================ */
  WIDGETS['handoff-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const P = cfg.gomaxprocs || 4;
    const MAX = cfg.max || 120;

    const ctl = el('div', 'ho-ctl');
    const range = el('input', 'ho-range');
    range.type = 'range'; range.min = '1'; range.max = String(MAX); range.value = String(cfg.blocked || 30);
    const readout = el('b', 'ho-readout', String(cfg.blocked || 30));
    ctl.append(el('span', 'ho-lab', '同时阻塞的 G 数'), range, readout);

    const grid = el('div', 'ho-grid');
    const net = el('div', 'ho-col tone-green');
    const file = el('div', 'ho-col tone-red');
    grid.append(net, file);

    const verdict = el('div', 'ho-verdict');
    box.append(ctl, grid, verdict);

    function draw(n) {
      readout.textContent = String(n);
      const build = (host, title, tagline, mCount, tone, note) => {
        host.textContent = '';
        const h = el('div', 'ho-head');
        h.append(el('b', '', title));
        h.append(el('span', 'ho-tag tone-' + tone, tagline));
        host.append(h);
        const mrow = el('div', 'ho-mrow');
        mrow.append(el('span', 'ho-mlab', 'M 的数量'));
        mrow.append(el('b', 'ho-mnum', String(mCount)));
        mrow.append(el('span', 'ho-mnote', mCount === P ? '没变' : '比 GOMAXPROCS 多了 ' + (mCount - P) + ' 个'));
        host.append(mrow);
        const bar = el('div', 'ho-bar');
        const fill = el('i');
        fill.style.width = Math.min(100, (mCount / (P + MAX)) * 100) + '%';
        bar.append(fill);
        host.append(bar);
        const dots = el('div', 'ho-dots');
        const shown = Math.min(mCount, 40);
        for (let i = 0; i < shown; i++) {
          dots.append(el('span', 'ho-dot' + (i < P ? ' bound' : '')));
        }
        if (mCount > 40) dots.append(el('span', 'ho-more', '＋' + (mCount - 40)));
        host.append(dots);
        host.append(el('p', 'ho-note', note));
      };
      build(net, '网络 I/O · 走 netpoller', 'M 数量不变', P, 'green',
        `${n} 个 G 挂在 netpoller 上等 fd 就绪，M 从头到尾没睡。它转头就去跑 LRQ 里的下一个 G —— 内核看到的是一台一直在干活的机器。`);
      build(file, '文件 I/O · 走 hand-off', 'M 线性膨胀', P + n, 'red',
        `每个 G 都要一个 M 陪着沉进内核。${n} 个 G 同时做文件 I/O，就要维持 ${P + n} 个 M —— 内核又要开始调度这一大堆线程了。`);

      const ratio = (P + n) / P;
      verdict.textContent = '';
      verdict.append(el('div', 'ho-vhead', '两条路的差别'));
      verdict.append(el('div', 'ho-vline',
        `同样 ${n} 个 G 在等，网络那条路的 M 数量是 ${P}，文件那条是 ${P + n}：` +
        (ratio >= 3 ? `差了 ${Math.round(ratio)} 倍。` : `差了 ${Math.round((ratio - 1) * 100)}%。`)));
      verdict.append(el('div', 'ho-vline ho-dim',
        'hand-off 是兜底，不是免费。这就是重文件 I/O 场景里 goroutine 优势会打折的原因。'));
      if (statusEl) statusEl.textContent = n + ' 个 G 阻塞 → 文件路径下 M = ' + (P + n);
    }

    range.addEventListener('input', () => draw(Number(range.value)));
    draw(Number(range.value));
  };

  /* ============================================================
     控件：三种 IPC 的数据流并排跑
     ------------------------------------------------------------
     把三种机制摆在同一排，点「下一步」同步推进，
     看数据到底停在哪里、被拷贝了几次。

     想让人看到的一件事：
       管道和消息队列的缓冲区确实在内核内存里，
       但进程碰不到它 —— 得让内核搬两次。
       只有共享内存是「两个进程真的在看同一块内存」。

     config:
       payload: "hello"     传送的内容，只影响显示
       interval: 900        自动播放的间隔
  ============================================================ */
  WIDGETS['ipc-flow-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const payload = cfg.payload || 'hello';

    /* 三列的定义：每列描述「数据在三个位置的哪一格」以及各步的计数
       位置取值：a = 发送方用户空间，k = 中转站，b = 接收方用户空间
       三列的步数完全一样（0 ~ 3），所以可以同步推进对比 */
    const COLS = [
      {
        id: 'pipe', name: '管道', tone: 'blue', badge: '两次拷贝',
        kLabel: '管道缓冲区（内核）', kNote: '环形队列。A 和 B 都看不见它',
        steps: [
          { at: 'a', copy: 0, sys: 0, what: '还没有人动作，数据就在 A 自己的缓冲区里' },
          { at: 'k', copy: 1, sys: 1, what: 'A 调 write()，陷入内核，内核把数据拷进管道缓冲区' },
          { at: 'b', copy: 2, sys: 2, what: 'B 调 read()，陷入内核，内核再把数据拷进 B 的缓冲区' },
          { at: 'b', copy: 2, sys: 2, what: 'B 拿到了数据。管道缓冲区空了 —— 水已经流过去了' },
        ],
      },
      {
        id: 'mq', name: '消息队列', tone: 'violet', badge: '两次拷贝',
        kLabel: '消息队列（内核）', kNote: '一条一条排着，带 type 字段',
        steps: [
          { at: 'a', copy: 0, sys: 0, what: 'A 把要发的数据装成一条消息' },
          { at: 'k', copy: 1, sys: 1, what: 'A 调 msgsnd()，内核把整条消息拷进队列' },
          { at: 'b', copy: 2, sys: 2, what: 'B 调 msgrcv()，内核把整条消息拷出去' },
          { at: 'b', copy: 2, sys: 2, what: 'B 收到了完整的一条，边界还在' },
        ],
      },
      {
        id: 'shm', name: '共享内存', tone: 'green', badge: '零拷贝',
        kLabel: '同一块物理内存', kNote: '两边的虚拟地址不同，但指向同一块物理内存',
        steps: [
          { at: 'a', copy: 0, sys: 0, what: '两边都已经 shmat() 映射好了，之后就不再需要系统调用' },
          { at: 'k', copy: 0, sys: 0, what: 'A 写 ptr[0] —— 这就是一条普通的内存写指令' },
          { at: 'b', copy: 0, sys: 0, what: 'B 读 ptr[0] —— 普通的内存读指令，它直接看到了' },
          { at: 'b', copy: 0, sys: 0, what: '全程 0 次拷贝、0 次系统调用。代价是没人给你保证秩序' },
        ],
      },
    ];

    /* —— 控制条 —— */
    const bar = el('div', 'ipc-bar');
    const bNext = el('button', 'ipc-btn ipc-primary', '下一步');
    const bPlay = el('button', 'ipc-btn', '▶ 自动跑');
    const bReset = el('button', 'ipc-btn ipc-ghost', '重置');
    const stepTag = el('span', 'ipc-step', '第 0 / 3 步');
    bar.append(bNext, bPlay, bReset, stepTag);

    /* —— 三列 —— */
    const grid = el('div', 'ipc-grid');
    const built = COLS.map((c) => {
      const col = el('div', 'ipc-col tone-' + c.tone);
      const hd = el('div', 'ipc-colhead');
      hd.append(el('b', '', c.name), el('span', 'ipc-badge', c.badge));
      col.append(hd);
      const zones = {};
      [['a', '进程 A 的用户空间'], ['k', c.kLabel], ['b', '进程 B 的用户空间']].forEach(([key, lab]) => {
        const z = el('div', 'ipc-zone' + (key === 'k' ? ' ipc-mid' : ''));
        const l = el('div', 'ipc-zlab', lab);
        z.append(l);
        if (key === 'k') z.append(el('div', 'ipc-znote', c.kNote));
        const slot = el('div', 'ipc-slot');
        z.append(slot);
        col.append(z);
        zones[key] = { z, slot };
      });
      const cnt = el('div', 'ipc-count');
      col.append(cnt);
      const say = el('p', 'ipc-say', '');
      col.append(say);
      grid.append(col);
      return { c, col, zones, cnt, say };
    });

    /* —— 收尾结论 —— */
    const verdict = el('div', 'ipc-verdict');
    box.append(bar, grid, verdict);

    let step = 0;
    let timer = null;

    const token = (c, copy) => {
      const t = el('span', 'ipc-token', c.id === 'shm' ? payload : payload);
      if (copy) t.classList.add('ipc-copied');
      return t;
    };

    function draw() {
      stepTag.textContent = `第 ${step} / 3 步`;
      bNext.disabled = step >= 3;
      built.forEach(({ c, zones, cnt, say, col }) => {
        const st = c.steps[step];
        Object.entries(zones).forEach(([k, z]) => {
          z.z.classList.toggle('on', k === st.at);
          z.slot.textContent = '';
        });
        /* 数据画在它当前所在的那一格 */
        zones[st.at].slot.append(token(c, st.copy > 0));
        if (c.id === 'shm' && st.at === 'k') zones.k.slot.append(el('span', 'ipc-both', 'A 和 B 都看得见'));
        cnt.textContent = `拷贝 ${st.copy} 次 · 系统调用 ${st.sys} 次`;
        cnt.className = 'ipc-count ' + (st.copy === 0 ? 'ipc-zero' : 'ipc-nonzero');
        say.textContent = st.what;
        col.classList.toggle('is-done', step === 3);
      });

      verdict.textContent = '';
      verdict.append(el('div', 'ipc-vhead', step === 3 ? '跑完了，看计数' : '往下走，看计数怎么变'));
      const done = built.map((b) => ({ name: b.c.name, copy: b.c.steps[step].copy, sys: b.c.steps[step].sys }));
      verdict.append(el('div', 'ipc-vline',
        done.map((d) => `${d.name}：拷贝 ${d.copy} 次、系统调用 ${d.sys} 次`).join('　·　')));
      if (step === 3) {
        verdict.append(el('div', 'ipc-vline ipc-vdim',
          '管道和消息队列的缓冲区确实在内核内存里，但进程碰不到它 —— 得让内核搬两次。只有共享内存是真正「两个进程在看同一块内存」。'));
      }
      if (statusEl) statusEl.textContent = `第 ${step} / 3 步`;
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; bPlay.textContent = '▶ 自动跑'; } }
    bNext.addEventListener('click', () => { stop(); if (step < 3) { step++; draw(); } });
    bReset.addEventListener('click', () => { stop(); step = 0; draw(); });
    bPlay.addEventListener('click', () => {
      if (timer) return stop();
      if (step >= 3) step = 0;
      bPlay.textContent = '⏸ 暂停';
      draw();
      timer = setInterval(() => {
        if (step >= 3) return stop();
        step++; draw();
      }, cfg.interval || 900);
    });
    draw();
  };

  /* ============================================================
     控件：运行时进程的生命周期
     ------------------------------------------------------------
     一行一个进程，横轴是时间。推着时间往前走，看谁常驻、谁只是
     一闪而过、谁跟谁根本没有父子关系。

     要弄死的一个误会：
       「containerd 上面是 shim，shim 上面是容器」——
       实际上 runc 建完就退，shim 是容器进程的爹，
       而 containerd 重启根本不影响容器。

     config:
       procs: [{ id, name, sub, tone, spans: [[起点, 终点]], note }]
       steps: [{ at, what }]
       tMax:  8
  ============================================================ */
  WIDGETS['runtime-timeline'] = (root) => {
    const cfg = cfgOf(root);
    const procs = cfg.procs || [];
    const steps = cfg.steps || [];
    if (!procs.length || !steps.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const T = cfg.tMax || 8;

    /* —— 控制条 —— */
    const bar = el('div', 'rt-bar');
    const bNext = el('button', 'rt-btn rt-primary', '下一步');
    const bPlay = el('button', 'rt-btn', '▶ 自动跑');
    const bReset = el('button', 'rt-btn rt-ghost', '重置');
    const clock = el('span', 'rt-clock', 't = 0');
    bar.append(bNext, bPlay, bReset, clock);

    /* —— 时间轴 + 每个进程一行 —— */
    const grid = el('div', 'rt-grid');
    const axis = el('div', 'rt-axis');
    for (let i = 0; i <= T; i++) {
      const tk = el('span', 'rt-tick', String(i));
      tk.style.left = (i / T) * 100 + '%';
      axis.append(tk);
    }
    grid.append(axis);

    const rows = procs.map((p) => {
      const row = el('div', 'rt-row');
      const name = el('div', 'rt-name');
      name.append(el('b', '', p.name));
      if (p.sub) name.append(el('span', 'rt-sub', p.sub));
      const track = el('div', 'rt-track');
      const bars = (p.spans || []).map(([a, b]) => {
        const seg = el('div', 'rt-span', '');
        seg.style.left = (a / T) * 100 + '%';
        seg.style.width = ((b - a) / T) * 100 + '%';
        track.append(seg);
        return seg;
      });
      /* 一次性的那些，在条上标个「就一下」 */
      const oneShot = (p.spans || []).every(([a, b]) => b - a <= 1);
      if (oneShot) {
        const tag = el('span', 'rt-shot', '只存在一瞬间');
        tag.style.left = (p.spans[0][0] / T) * 100 + '%';
        track.append(tag);
      }
      const cursor = el('div', 'rt-cursor');
      track.append(cursor);
      row.append(name, track);
      grid.append(row);
      return { p, row, bars, cursor, oneShot };
    });

    /* —— 这一刻发生了什么 —— */
    const now = el('div', 'rt-now');
    box.append(bar, grid, now);

    let i = 0;
    let timer = null;

    function draw() {
      const st = steps[i];
      const t = st.at;
      clock.textContent = `t = ${t}`;
      bNext.disabled = i >= steps.length - 1;
      rows.forEach(({ p, bars, cursor, oneShot, row }) => {
        /* 已经消失的进程整体变灰 —— “它已经不在了” */
        const alive = (p.spans || []).some(([a, b]) => t >= a && t < b);
        row.classList.toggle('is-gone', !alive && (p.spans || []).some(([a]) => t >= a));
        row.classList.toggle('is-future', !(p.spans || []).some(([a]) => t >= a));
        cursor.style.left = (t / T) * 100 + '%';
        bars.forEach((b, k) => {
          const [a, e] = p.spans[k];
          b.classList.toggle('on', t >= a && t < e);
          b.classList.toggle('past', t >= e);
        });
      });

      now.textContent = '';
      now.append(el('div', 'rt-now-head', `t = ${t}　·　第 ${i + 1} / ${steps.length} 步`));
      now.append(richText(el('div', 'rt-now-text'), st.what));
      /* 点一个进程看它到底是个什么角色 */
      const alive = rows.filter(({ p }) => (p.spans || []).some(([a, b]) => t >= a && t < b));
      if (alive.length) {
        const list = el('div', 'rt-notes');
        alive.forEach(({ p }) => {
          const n = el('div', 'rt-note');
          n.append(el('b', '', p.name));
          const txt = el('span', '');
          richText(txt, p.note || '');   /* append() 不返回节点，所以要先把 span 拿出来 */
          n.append(txt);
          list.append(n);
        });
        now.append(list);
      }
      if (statusEl) statusEl.textContent = `t = ${t}`;
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; bPlay.textContent = '▶ 自动跑'; } }
    bNext.addEventListener('click', () => { stop(); if (i < steps.length - 1) { i++; draw(); } });
    bReset.addEventListener('click', () => { stop(); i = 0; draw(); });
    bPlay.addEventListener('click', () => {
      if (timer) return stop();
      if (i >= steps.length - 1) i = 0;
      bPlay.textContent = '⏸ 暂停';
      draw();
      timer = setInterval(() => {
        if (i >= steps.length - 1) return stop();
        i++; draw();
      }, cfg.interval || 1400);
    });
    draw();
  };

  /* ============================================================
     控件：ns-view —— 站外 vs 站里，同一台机器的两套视图
     ------------------------------------------------------------
     一个切换开关，下面一排「你会看到什么」。切的时候整组刷掉，
     每张卡上标着是哪类 namespace 在管这件事。

     要让人一眼看到的：同一个内核，`ps` 却能给出两份完全不同的答案。

     config:
       views:  [{ id, name, sub }]                两个视角（外 / 里）
       facets: [{ id, cmd, ns, host: [...], ct: [...], tone }]
  ============================================================ */
  WIDGETS['ns-view'] = (root) => {
    const cfg = cfgOf(root);
    const views = cfg.views || [];
    const facets = cfg.facets || [];
    if (views.length < 2 || !facets.length) return;
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    /* —— 视角切换 —— */
    const seg = el('div', 'nw-seg');
    const btns = views.map((v, k) => {
      const b = el('button', 'nw-seg-btn');
      b.append(el('b', '', v.name));
      if (v.sub) b.append(el('span', 'nw-seg-sub', v.sub));
      b.addEventListener('click', () => pick(k));
      seg.append(b);
      return b;
    });

    /* —— 一栏归一个可见的东西 —— */
    const grid = el('div', 'nw-grid');
    const cards = facets.map((f) => {
      const c = el('div', 'nw-card');
      const hd = el('div', 'nw-head');
      hd.append(el('code', 'nw-cmd', f.cmd));
      hd.append(el('span', 'nw-ns', f.ns));
      c.append(hd);
      const body = el('div', 'nw-body');
      c.append(body);
      grid.append(c);
      return { f, c, body };
    });

    const hint = el('p', 'nw-hint', cfg.hint || '');
    box.append(seg, grid, hint);

    let cur = 0;
    function pick(k) {
      const prev = cur;
      cur = k;
      btns.forEach((b, i) => b.classList.toggle('on', i === k));
      cards.forEach(({ f, c, body }) => {
        const lines = (k === 0 ? f.host : f.ct) || [];
        c.classList.toggle('nw-tone', !!f.tone);
        if (f.tone) c.style.setProperty('--nw-tone', 'var(--' + f.tone + ')');
        /* 切了视角且内容真的不同 —— 闪一下，让人看到「这一项变了」 */
        const changed = k !== prev && JSON.stringify(f.host) !== JSON.stringify(f.ct);
        c.classList.toggle('nw-changed', changed);
        body.textContent = '';
        lines.forEach((ln) => {
          const isKey = lns(ln);
          body.append(el('div', 'nw-line' + (isKey ? ' nw-key' : ''), ln.replace(/^\*/, '')));
        });
      });
      if (statusEl) statusEl.textContent = views[k].name;
    }
    /* 行首带 * = 这一行是重点 */
    const lns = (s) => typeof s === 'string' && s.startsWith('*');

    btns.forEach((b, i) => b.addEventListener('click', () => pick(i)));
    pick(0);
  };

  /* ============================================================
     控件：cg-limit —— 配额卡不住的时候，内存和 CPU 的下场不一样
     ------------------------------------------------------------
     进程想要多少是固定的，拖的是「给它多少配额」。
     然后看两个完全不同的结局：内存超了直接被杀，CPU 超了只是变慢。

     config:
       demand: { mem: 1229, cpu: 2.5 }              进程想要多少（MB / 核）
       mem:  { min, max, step, def }
       cpu:  { min, max, step, def }
  ============================================================ */
  WIDGETS['cg-limit'] = (root) => {
    const cfg = cfgOf(root);
    const d = cfg.demand || { mem: 1229, cpu: 2.5 };
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const mk = (label, spec, unit) => {
      const w = el('div', 'cg-sl');
      const lab = el('span', 'cg-sl-lab', label);
      const r = el('input', 'cg-range');
      r.type = 'range'; r.min = String(spec.min); r.max = String(spec.max);
      r.step = String(spec.step); r.value = String(spec.def);
      const v = el('b', 'cg-sl-val');
      w.append(lab, r, v);
      return { w, r, v, unit };
    };
    const sMem = mk('内存配额 memory.max', cfg.mem || { min: 256, max: 2048, step: 64, def: 512 }, 'MB');
    const sCpu = mk('CPU 配额 cpu.max', cfg.cpu || { min: 0.25, max: 4, step: 0.25, def: 1 }, '核');
    const sliders = el('div', 'cg-sls');
    sliders.append(sMem.w, sCpu.w);

    const out = el('div', 'cg-out');
    const files = el('div', 'cg-files');
    box.append(sliders, out, files);

    const card = (title, tone, verdict, detail) => {
      const c = el('div', 'cg-card');
      c.style.setProperty('--cg-tone', 'var(--' + tone + ')');
      c.append(el('div', 'cg-card-ttl', title));
      c.append(el('div', 'cg-verdict', verdict));
      c.append(richText(el('p', 'cg-detail'), detail));
      return c;
    };

    function draw() {
      const mem = Number(sMem.r.value), cpu = Number(sCpu.r.value);
      sMem.v.textContent = mem + ' MB';
      sCpu.v.textContent = cpu + ' 核';

      const memDead = mem < d.mem;
      const cpuThrottled = cpu < d.cpu;

      out.textContent = '';
      out.append(card('进程想要 1.2 GB 内存，你给它 ' + mem + ' MB',
        memDead ? 'red' : 'green',
        memDead ? '进程被杀（OOM kill）' : '正常跑着',
        memDead
          ? '内存是「要么给够、要么去死」的：一旦触及上限且回收不出足够内存，内核直接给整个 cgroup 发 SIGKILL。==它不会让你跑慢一点。=='
          : '配额够用，内存这一个维度上它不受约束。'));
      out.append(card('进程想要 2.5 个核，你给它 ' + cpu + ' 核',
        cpuThrottled ? 'amber' : 'green',
        cpuThrottled ? '被节流，变慢' : '正常跑着',
        cpuThrottled
          ? 'CPU 是「按配额排队」的：每个周期里最多只能用这么多时间，用超了就被暂停到下一个周期。==它被杀不掉，只是变慢。=='
          : '配额够用，它可以占满想要的核数。'));

      files.textContent = '';
      const fh = el('div', 'cg-files-head');
      richText(fh, '你在 `docker run` 里写的参数，最后就是这几个文件');
      files.append(fh);
      const f = (path, val, note) => {
        const r = el('div', 'cg-frow');
        r.append(el('code', 'cg-fpath', path));
        r.append(el('code', 'cg-fval', val));
        r.append(el('span', 'cg-fnote', note));
        files.append(r);
      };
      f('/sys/fs/cgroup/<容器>/memory.max', String(mem * 1024 * 1024),
        memDead ? '比 current 小 → 触发回收，回收不出来就 OOM' : '比 current 大 → 不管');
      f('/sys/fs/cgroup/<容器>/memory.current', String(Math.round(d.mem * 1024 * 1024)), '实际用了多少（只读）');
      f('/sys/fs/cgroup/<容器>/cpu.max', `${Math.round(cpu * 100000)} 100000`,
        '格式是「配额 周期」：每 100ms 里最多用这么多微秒');
      if (statusEl) statusEl.textContent = `内存 ${mem}MB · CPU ${cpu} 核`;
    }

    sMem.r.addEventListener('input', draw);
    sCpu.r.addEventListener('input', draw);
    draw();
  };

  /* ============================================================
     控件：poll-lab —— 一个线程挨个问过去，两个病一起恶化
     ------------------------------------------------------------
     拖「连接数」，同时看到两件事变差：
       ① 白问率   —— 线程手里只有一张连接号清单，它不知道谁有数据
       ② 每次调用要交多少份名单 —— select/poll 是 3N，epoll 只拿就绪的那几个

     「这格有没有数据」按**下标算一个稳定的散列**，不用 Math.random ——
     否则同一组参数每次渲出来都不一样，截图和自检都没法比对。

     config: conn / busy 各一个 { min, max, step, def }
  ============================================================ */
  WIDGETS['poll-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const runBtn = root.querySelector('[data-run]');
    const resetBtn = root.querySelector('[data-reset]');
    const C = cfg.conn || { min: 8, max: 200, step: 4, def: 64 };
    const B = cfg.busy || { min: 5, max: 100, step: 5, def: 10 };

    const sl = (label, spec, unit) => {
      const w = el('div', 'pl-sl');
      w.append(el('span', 'pl-sl-lab', label));
      const r = el('input', 'pl-range');
      r.type = 'range';
      r.min = String(spec.min); r.max = String(spec.max);
      r.step = String(spec.step); r.value = String(spec.def);
      const v = el('b', 'pl-sl-val');
      w.append(r, v);
      return { w, r, v, unit };
    };
    const sConn = sl('同时在线的连接数', C, ' 条');
    const sBusy = sl('此刻真有数据的比例', B, '%');
    const sliders = el('div', 'pl-sls');
    sliders.append(sConn.w, sBusy.w);

    const line    = el('div', 'pl-line');
    const cells   = el('div', 'pl-cells');
    const stats   = el('div', 'pl-stats');
    const cost    = el('div', 'pl-cost');
    const costHead = el('div', 'pl-cost-head', '而这才是后面要解决的问题：每调用一次，名单要重新交一遍');
    box.append(sliders, line, cells, stats, costHead, cost);

    let n = 0, pct = 0;
    let state = [], cursor = -1, hits = 0, miss = 0, timer = null;
    let totalHits = 0, totalMiss = 0;   // 跑完一轮才有意义

    /* Node.append() / Element.append() **返回 undefined**（它不是 jQuery）。
       所以 `richText(x.append(el(...)), t)` 会把 undefined 传进去然后抛掉 ——
       而且是在 render() 中途抛，后面半张面板全空、动画也一起停。
       包一层：建节点 → 填富文本 → 返回节点。 */
    const richIn = (tag, cls, text) => {
      const node = el(tag, cls);
      richText(node, text);
      return node;
    };

    /* Knuth 黄金比例乘数 —— 分布够散，而且完全确定 */
    const isReady = (i, p) => (((i * 2654435761) >>> 0) % 10000) < p * 100;

    function readyCount() {
      let c = 0;
      for (let i = 0; i < n; i++) if (isReady(i, pct)) c++;
      return c;
    }

    function drawCells() {
      cells.textContent = '';
      for (let i = 0; i < n; i++) {
        let cls = 'pl-cell';
        if (state[i] === 'hit') cls += ' is-hit';
        else if (state[i] === 'miss') cls += ' is-miss';
        if (i === cursor) cls += ' is-cursor';
        cells.append(el('span', cls));
      }
    }

    function stat(tone, label, value, sub) {
      const c = el('div', 'pl-stat');
      c.style.setProperty('--pl-tone', 'var(--' + tone + ')');
      c.append(el('div', 'pl-stat-lab', label));
      c.append(el('div', 'pl-stat-val', value));
      c.append(richIn('div', 'pl-stat-sub', sub));
      return c;
    }

    function render() {
      sConn.v.textContent = n + sConn.unit;
      sBusy.v.textContent = pct + sBusy.unit;
      drawCells();

      const asked = hits + miss;
      // richText 是 append，不清空 —— 每次重画前先把这一行擦掉，
      // 否则跑一轮会看到「正在问第 2 号…正在问第 3 号…」连成一大串
      line.textContent = '';
      if (asked === 0) {
        richText(line, '线程手里只有一张==连接号清单==，它并不知道谁有数据 —— 只能一个一个问过去。');
      } else if (asked < n) {
        richText(line, '正在问第 **' + (asked + 1) + '** 号连接…');
      } else {
        richText(line, '问完一轮：**' + hits + '** 次有收获，**' + miss + '** 次白问 —— 一共 ' + n + ' 次系统调用。');
      }

      const done = asked === n && n > 0;
      const h = done ? hits : readyCount();
      const m = done ? miss : n - readyCount();
      const rate = n ? Math.round((m / n) * 100) : 0;

      stats.textContent = '';
      stats.append(
        stat('green', '真有数据的', String(h), '这些才是你想要的'),
        stat('red', '白问的次数', String(m), '==问了等于没问=='),
        stat('amber', '白问率', rate + '%', '连接越多，这一格越难看'),
      );

      cost.textContent = '';
      const row = (name, tone, mid, total, note) => {
        const r = el('div', 'pl-cost-row');
        r.style.setProperty('--pl-tone', 'var(--' + tone + ')');
        r.append(el('span', 'pl-cost-name', name));
        r.append(richIn('span', 'pl-cost-mid', mid));
        r.append(el('b', 'pl-cost-total', total));
        r.append(richIn('span', 'pl-cost-note', note));
        return r;
      };
      cost.append(row('select / poll', 'red',
        '搬进去 **' + n + '** 份 + 内核走 **' + n + '** 遍 + 拷回来再走 **' + n + '** 遍',
        String(3 * n) + ' 份',
        '每次调用都要重交整份名单，内核不记得你上次关心谁'));
      cost.append(row('epoll', 'green',
        '名单早就交过了，这次只拿回就绪的那几个',
        String(h) + ' 份',
        '==不随连接数涨=='));

      if (statusEl) statusEl.textContent = n + ' 条连接 · 一轮 ' + n + ' 次系统调用 · 白问 ' + rate + '%';
    }

    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ 跑一轮'; }
    }

    function reset() {
      stop();
      n = Number(sConn.r.value);
      pct = Number(sBusy.r.value);
      state = new Array(n).fill('idle');
      cursor = -1; hits = 0; miss = 0;
      render();
    }

    function step() {
      cursor++;
      if (cursor >= n) { cursor = -1; stop(); render(); return; }
      if (isReady(cursor, pct)) { state[cursor] = 'hit'; hits++; }
      else { state[cursor] = 'miss'; miss++; }
      render();
      // 总时长控制在 2.5 秒左右 —— 连接多了不能一格一格慢慢爬
      timer = setTimeout(step, Math.max(8, Math.min(40, Math.round(2500 / n))));
    }

    function run() {
      if (timer) { stop(); return; }
      if (hits + miss > 0) { reset(); }
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '❙❙ 暂停'; }
      timer = setTimeout(step, 60);
    }

    sConn.r.addEventListener('input', reset);
    sBusy.r.addEventListener('input', reset);
    if (runBtn) runBtn.addEventListener('click', run);
    if (resetBtn) resetBtn.addEventListener('click', reset);
    reset();
  };

  /* ============================================================
     控件：epoll-tables —— epoll 的全部就是这两张表
     ------------------------------------------------------------
     左边是登记表（interest list），`epoll_ctl` 登记一次，长期有效。
     右边是就绪表（ready list），谁有数据了**谁自己挂进来**（内核里的回调干的）。

     点左边的格子 = 这个 fd 来数据了 → 它跳到右边。
     点 epoll_wait = 把右边清空并计数，格子回左边（登记还在，只是不再"就绪"）。
     底部两行把差别算出来：select/poll 每轮都要看**全部**，epoll 只看右边有几个。

     config: conn { min, max, step, def } —— 登记多少个 fd
  ============================================================ */
  WIDGETS['epoll-tables'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const runBtn = root.querySelector('[data-run]');
    const resetBtn = root.querySelector('[data-reset]');
    const C = cfg.conn || { min: 8, max: 40, step: 4, def: 24 };

    // Node.append() 返回 undefined —— 建节点 → 填富文本 → 返回节点，别写成链式
    const richIn = (tag, cls, text) => {
      const node = el(tag, cls);
      richText(node, text);
      return node;
    };

    const sl = el('div', 'et-sl');
    sl.append(el('span', 'et-sl-lab', '登记进来的连接数'));
    const rng = el('input', 'et-range');
    rng.type = 'range';
    rng.min = String(C.min); rng.max = String(C.max);
    rng.step = String(C.step); rng.value = String(C.def);
    const val = el('b', 'et-sl-val');
    sl.append(rng, val);

    const panes = el('div', 'et-panes');
    const mkPane = (title, sub) => {
      const w = el('div', 'et-pane');
      const h = el('div', 'et-pane-head');
      h.append(el('span', 'et-pane-ttl', title));
      const n = el('span', 'et-pane-n');
      h.append(n);
      w.append(h, el('div', 'et-pane-sub', sub));
      const body = el('div', 'et-pane-body');
      w.append(body);
      return { w, n, body };
    };
    const L = mkPane('登记表 interest list', 'epoll_ctl 登记进来的。登记一次，一直在');
    const R = mkPane('就绪表 ready list', '谁有数据了谁把自己挂进来');
    panes.append(L.w, R.w);

    const btns = el('div', 'et-btns');
    const bWait = el('button', 'et-btn on', 'epoll_wait() 取一次');
    const bRand = el('button', 'et-btn', '随机来一批数据');
    btns.append(bWait, bRand);

    const line = el('div', 'et-line');
    const cmp  = el('div', 'et-cmp');
    box.append(sl, panes, btns, line, cmp);

    let n = 0, ready = new Set(), syscalls = 0, scanned = 0, hits = 0;

    function reset() {
      n = Number(rng.value);
      ready = new Set();
      syscalls = 0; scanned = 0; hits = 0;
      render();
    }

    function render() {
      val.textContent = n + ' 条';
      L.n.textContent = n + ' 个';
      R.n.textContent = ready.size + ' 个';
      R.n.className = 'et-pane-n' + (ready.size ? ' is-hot' : '');

      L.body.textContent = '';
      for (let i = 0; i < n; i++) {
        const c = el('button', 'et-chip', 'fd ' + (i * 3 + 3));
        if (ready.has(i)) { c.classList.add('is-out'); c.disabled = true; }
        else c.addEventListener('click', () => { ready.add(i); render(); });
        L.body.append(c);
      }
      R.body.textContent = '';
      if (!ready.size) {
        R.body.append(el('span', 'et-empty', '（空）'));
      } else {
        [...ready].sort((a, b) => a - b).forEach((i) => {
          R.body.append(el('span', 'et-chip is-ready', 'fd ' + (i * 3 + 3)));
        });
      }

      line.textContent = '';
      if (!syscalls) {
        richText(line, '点左边任意一个格子 = ==这个 fd 来数据了==，它会自己跳到右边。');
      } else {
        richText(line, '已经 `epoll_wait` 了 **' + syscalls + '** 次，取回 **' + hits + '** 个就绪事件。');
      }

      cmp.textContent = '';
      const row = (name, tone, per, total, note) => {
        const r = el('div', 'et-cmp-row');
        r.style.setProperty('--et-tone', 'var(--' + tone + ')');
        r.append(el('span', 'et-cmp-name', name));
        r.append(richIn('span', 'et-cmp-mid', per));
        r.append(el('b', 'et-cmp-total', total));
        r.append(richIn('span', 'et-cmp-note', note));
        return r;
      };
      const rounds = syscalls || 1;
      const spTotal = rounds * n;                       // 每轮都要看全部
      // 还没 wait 过就显示「现在 wait 会拿回几个」，这样两行是同一个口径：
      // select/poll 是「跑一轮要碰多少个」，epoll 是「跑一轮会拿回多少个」
      const epTotal = syscalls ? hits : ready.size;
      cmp.append(row('select / poll', 'red',
        '每轮都要挨个检查 **' + n + '** 个（协议没变：名单每次重交）',
        spTotal.toLocaleString() + ' 次',
        '和登记了多少条无关地，永远看全部'));
      cmp.append(row('epoll', 'green',
        '只看就绪表上挂了几个',
        epTotal.toLocaleString() + ' 次',
        '==登记表只用来登记，等待时根本不看它=='));

      if (statusEl) statusEl.textContent = n + ' 条登记 · ' + ready.size + ' 条就绪 · wait ' + syscalls + ' 次';
    }

    bWait.addEventListener('click', () => {
      syscalls++;
      hits += ready.size;
      scanned += ready.size;
      ready = new Set();
      render();
    });
    bRand.addEventListener('click', () => {
      // 随机让几条来数据 —— 这里是**演示**，真到内核里是网卡中断把它们挂上去的
      const k = Math.max(1, Math.round(n * 0.15));
      for (let t = 0; t < k; t++) {
        const i = Math.floor(Math.random() * n);
        if (i < n) ready.add(i);
      }
      render();
    });
    rng.addEventListener('input', reset);
    if (runBtn) runBtn.style.display = 'none';
    if (resetBtn) resetBtn.addEventListener('click', reset);
    reset();
  };

  /* ============================================================
     控件：lt-vs-et —— 「就绪」说的是状态，不是数据
     ------------------------------------------------------------
     缓冲区里还有数据、但没人再来通知你 —— 那就是 ET 最经典的坑。
     LT 和 ET 的差别只有一句话：**从就绪表上摘下来之后，要不要放回去。**

     config: total（一次来多少字节）, chunk（一次 read 多少）
  ============================================================ */
  WIDGETS['lt-vs-et'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const resetBtn = root.querySelector('[data-reset]');
    const runBtn = root.querySelector('[data-run]');
    const TOTAL = cfg.total || 128;
    const CHUNK = cfg.chunk || 64;

    const richIn = (tag, cls, text) => {
      const node = el(tag, cls);
      richText(node, text);
      return node;
    };

    const modes = el('div', 'le-modes');
    const bLt = el('button', 'le-mode on', '水平触发 LT');
    const bEt = el('button', 'le-mode', '边缘触发 ET');
    modes.append(bLt, bEt);

    const bars = el('div', 'le-bars');
    const mkBar = (name, sub) => {
      const w2 = el('div', 'le-bar');
      const h = el('div', 'le-bar-head');
      h.append(el('span', 'le-bar-ttl', name));
      const v = el('b', 'le-bar-val');
      h.append(v);
      const track = el('div', 'le-bar-track');
      const fill = el('div', 'le-bar-fill');
      track.append(fill);
      w2.append(h, el('div', 'le-bar-sub', sub), track);
      return { w: w2, v, fill };
    };
    const B1 = mkBar('内核的接收缓冲区', '这是内核的内存，不是你的');
    const B2 = mkBar('你的应用缓冲区', 'read 把数据拷过来，才归你');
    bars.append(B1.w, B2.w);

    const btns = el('div', 'le-btns');
    const bArrive = el('button', 'le-btn on', '网卡来数据了');
    const bWait   = el('button', 'le-btn', 'epoll_wait()');
    const bRead   = el('button', 'le-btn', 'read 一次（' + CHUNK + ' 字节）');
    const bDrain  = el('button', 'le-btn', 'read 到空');
    btns.append(bArrive, bWait, bRead, bDrain);

    const logs = el('div', 'le-logs');
    const verdict = el('div', 'le-verdict');
    box.append(modes, bars, btns, logs, verdict);

    let mode = 'lt', buf = 0, mine = 0, pending = false, lines = [];

    const say = (tone, html) => {
      lines.push({ tone, html });
      if (lines.length > 40) lines.shift();
    };

    function reset() {
      buf = 0; mine = 0; pending = false; lines = [];
      say('muted', '缓冲区是空的。点「网卡来数据了」开始。');
      render();
    }

    function arrive() {
      buf = TOTAL;
      pending = true;
      say('blue', '数据到了，进内核的接收缓冲区（' + TOTAL + ' 字节）→ ==回调把 fd 挂进就绪表==');
      render();
    }

    function wait() {
      if (!pending) {
        say('red', '`epoll_wait` 返回 0：就绪表是空的' + (buf > 0 ? '。**但缓冲区里还有 ' + buf + ' 字节没人读**' : ''));
        render(); return;
      }
      say('green', '`epoll_wait` 返回：这个 fd 可读');
      pending = false;
      if (buf > 0 && mode === 'lt') {
        pending = true;
        say('amber', 'LT：摘下来一看**缓冲区还有 ' + buf + ' 字节** → 重新挂回就绪表，下次还会通知你');
      } else if (buf > 0 && mode === 'et') {
        say('red', 'ET：==摘下来就不挂回去了==，缓冲区还剩 ' + buf + ' 字节也当没看见');
      }
      render();
    }

    function doRead(k) {
      const got = Math.min(k, buf);
      if (!got) { say('muted', '`read` 没东西可读，返回 `EAGAIN`'); render(); return; }
      buf -= got; mine += got;
      say('violet', '`read` 拿走 ' + got + ' 字节，内核缓冲区还剩 **' + buf + '** 字节');
      render();
    }

    function setMode(m) {
      if (m === mode) return;
      mode = m;
      bLt.classList.toggle('on', m === 'lt');
      bEt.classList.toggle('on', m === 'et');
      // 换模式 = 换一个连接重来。缓冲区要清空，否则「你的应用缓冲区」会
      // 把两次实验的读入量加在一起（128 字节），看着像同一条连接。
      // 日志**故意留着** —— 对照两种模式的表现正是这个控件的用途。
      buf = 0; mine = 0; pending = false;
      say('muted', '—— 切到 ' + (m === 'lt' ? '水平触发 LT' : '边缘触发 ET') + '，缓冲区清空，重来一遍 ——');
      render();
    }

    function render() {
      B1.v.textContent = buf + ' 字节';
      B2.v.textContent = mine + ' 字节';
      B1.fill.style.width = Math.round((buf / TOTAL) * 100) + '%';
      B1.fill.className = 'le-bar-fill' + (buf > 0 && !pending ? ' is-strand' : '');
      B2.fill.style.width = Math.round((mine / TOTAL) * 100) + '%';

      logs.textContent = '';
      lines.forEach((l) => {
        const row = el('div', 'le-log tone-' + l.tone);
        richText(row, l.html);
        logs.append(row);
      });
      logs.scrollTop = logs.scrollHeight;

      const stranded = buf > 0 && !pending;
      verdict.className = 'le-verdict' + (stranded ? ' is-warn' : '');
      verdict.textContent = '';
      if (stranded) {
        richText(verdict,
          '⚠ 缓冲区里还有 **' + buf + '** 字节，但就绪表上没有这个 fd —— ' +
          '==你的线程在 `epoll_wait` 上睡得很安稳，那份数据没人管。== ' +
          (mode === 'et' ? '这是 ET 下最常见的 bug。' : ''));
      } else {
        richText(verdict,
          mode === 'lt'
            ? 'LT：只要缓冲区还有数据，每次 `epoll_wait` 都会告诉你。**可以一次只读一点。**'
            : 'ET：只在「从空变成非空」的那一刻通知一次。==所以你必须一次读到 `EAGAIN`==，不能读一半就走。');
      }

      if (statusEl) {
        statusEl.textContent = (mode === 'lt' ? 'LT' : 'ET') + ' · 缓冲区 ' + buf + ' 字节 · 就绪表 ' + (pending ? '有它' : '没它');
      }
    }

    bLt.addEventListener('click', () => setMode('lt'));
    bEt.addEventListener('click', () => setMode('et'));
    bArrive.addEventListener('click', arrive);
    bWait.addEventListener('click', wait);
    bRead.addEventListener('click', () => doRead(CHUNK));
    bDrain.addEventListener('click', () => doRead(buf));
    if (runBtn) runBtn.style.display = 'none';
    if (resetBtn) resetBtn.addEventListener('click', reset);
    reset();
  };

  /* ============================================================
     控件：clone-lab —— 「进程」和「线程」在 Linux 里差在哪几个开关
     ------------------------------------------------------------
     这个控件存在的理由：把「进程 vs 线程」从两个**类**降级成
     一组**逐资源的开关**。用户自己勾一勾就会看到：
       · 全不勾       -> fork()，两个独立的资源域（进程）
       · 四个全勾     -> pthread_create()，共享一份资源（线程）
       · 勾一部分     -> Linux 允许，而且没有标准名字
       · 一个不勾但开 NEW* -> 同一套机制造出来的是容器
     最后一档是关键：共享在 clone 里是**连续刻度**，不是二选一。

     config:
       shared:   默认勾上的正向开关（数组）
       unshared: 默认勾上的反向开关（数组）
  ============================================================ */
  WIDGETS['clone-lab'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const FWD = [
      { k: 'CLONE_VM', d: '共享地址空间', why: '页表指针直接复用 —— 两个 task 看同一片内存' },
      { k: 'CLONE_FILES', d: '共享打开文件表', why: 'A 打开的 fd，B 立刻看得见，连偏移量都共享' },
      { k: 'CLONE_FS', d: '共享文件系统信息', why: '根目录、工作目录、umask 一起共享（chroot/chdir 改这里）' },
      { k: 'CLONE_SIGHAND', d: '共享信号处理函数表', why: '任一线程改 SIGTERM 的处置，全组立即可见' },
    ];
    const REV = [
      { k: 'CLONE_NEWNS', d: '另立 mount 命名空间', why: '挂载点自己一套 —— 容器的文件树从这来' },
      { k: 'CLONE_NEWPID', d: '另立 PID 命名空间', why: '容器里看到的 PID 从 1 开始' },
      { k: 'CLONE_NEWNET', d: '另立网络命名空间', why: '自己的网卡、路由表、端口空间' },
    ];

    const on = new Set(cfg.shared || ['CLONE_VM', 'CLONE_FILES', 'CLONE_FS', 'CLONE_SIGHAND']);
    const rev = new Set(cfg.unshared || []);

    const ctl = el('div', 'cl-ctl');

    function group(title, list, set, cls) {
      const g = el('div', 'cl-group ' + cls);
      g.append(el('div', 'cl-ghead', title));
      list.forEach((it) => {
        const row = el('label', 'cl-row');
        const cb = el('input', 'cl-cb');
        cb.type = 'checkbox';
        cb.checked = set.has(it.k);
        cb.addEventListener('change', () => {
          if (cb.checked) set.add(it.k); else set.delete(it.k);
          draw();
        });
        const txt = el('div', 'cl-txt');
        txt.append(el('code', 'cl-key', it.k));
        txt.append(el('span', 'cl-desc', it.d));
        row.append(cb, txt);
        row.append(el('span', 'cl-why', it.why));
        g.append(row);
      });
      return g;
    }

    ctl.append(group('clone() 的共享开关 · 正向', FWD, on, 'cl-fwd'));
    ctl.append(group('反向开关 · 勾上表示「另立一个」', REV, rev, 'cl-rev'));

    const verdict = el('div', 'cl-verdict');
    const board = el('div', 'cl-board');
    box.append(ctl, verdict, board);

    /* 一个资源槽：左边 taskA 的指针，右边 taskB 的指针，
       中间那条线是「指向同一份」还是「各指一份」。 */
    function slot(name, shared, note) {
      const row = el('div', 'cl-slot' + (shared ? ' is-shared' : ' is-own'));
      row.append(el('span', 'cl-sname', name));
      const left = el('span', 'cl-ptr', 'A');
      const mid = el('span', 'cl-link', shared ? '※ 同一份' : ' ✕ 各有各的');
      const right = el('span', 'cl-ptr', 'B');
      row.append(left, mid, right);
      if (note) row.append(el('span', 'cl-snote', note));
      return row;
    }

    function draw() {
      const nFwd = FWD.filter((f) => on.has(f.k)).length;
      const nRev = REV.filter((f) => rev.has(f.k)).length;

      let kind, tone, line1, line2;
      if (nFwd === 0 && nRev === 0) {
        kind = 'fork() —— 一个进程';
        tone = 'violet';
        line1 = '一个开关都没勾：资源全部各来一份。这正是 fork()。';
        line2 = '新建的那份要付地址空间、页表、文件表的全套账。';
      } else if (nFwd === 4 && nRev === 0) {
        kind = 'pthread_create() —— 一个线程';
        tone = 'green';
        line1 = '四个正向开关全勾上：资源一份都不复制，只新建一个执行流。';
        line2 = '新线程只复制几个指针 + 一个新内核栈 —— 这就是它便宜的全部原因。';
      } else if (nFwd === 0 && nRev > 0) {
        kind = '容器 —— 一组进程';
        tone = 'amber';
        line1 = '没有共享，但开了反向开关：资源照旧各一份，另外还切出了独立的命名空间。';
        line2 = '注意容器的「轻」和线程的「轻」不是一回事：容器共享的是**内核**，隔离的是命名空间。';
      } else if (nFwd > 0 && nRev > 0) {
        kind = '半共享 + 独立命名空间';
        tone = 'red';
        line1 = '共享了一部分、又切出去一部分 —— 这是 Linux 允许的合法组合。';
        line2 = '容器的实现正是「共享内核 + 切出命名空间」，而线程是「共享全部」。';
      } else {
        kind = '半共享的任务 —— 没有标准名字';
        tone = 'amber';
        line1 = `勾了 ${nFwd} 个正向开关，剩下的各来一份。`;
        line2 = '这在别的内核里往往表达不出来 —— 共享在这里是**连续刻度**，不是二选一。';
      }

      const badge = el('div', 'cl-kind tone-' + tone);
      badge.append(el('span', 'cl-klabel', '你造出来的是'));
      badge.append(el('b', '', kind));
      const p1 = el('p', 'cl-line'); richText(p1, line1);
      const p2 = el('p', 'cl-line cl-dim'); richText(p2, line2);
      fill(verdict, [badge, p1, p2]);

      fill(board, [
        slot('mm_struct · 地址空间', on.has('CLONE_VM'), on.has('CLONE_VM') ? '页表指针复用' : '整套页表要新造'),
        slot('files_struct · 文件表', on.has('CLONE_FILES'), on.has('CLONE_FILES') ? 'fd 直接互相可见' : 'fd 从零开始'),
        slot('fs_struct · 根目录/工作目录', on.has('CLONE_FS'), ''),
        slot('sighand_struct · 信号处置', on.has('CLONE_SIGHAND'), ''),
        slot('nsproxy · 命名空间', nRev === 0,
          nRev === 0 ? '继承父进程的那一套' : `另立了 ${nRev} 个`),
      ]);

      if (statusEl) statusEl.textContent = kind;
    }

    draw();
  };

  /* ============================================================
     控件：isolation-spectrum —— 把「容器/进程/线程/协程」摆在同一根轴上
     ------------------------------------------------------------
     这个控件存在的理由：这四个概念平时是分开背的，但它们其实是
     **同一个刻度尺上的四个位置** —— 共享得越来越多、调度得越来越轻。

     点一个，下面展开它的三行账：隔离什么 / 谁调度 / 故障传到哪。
     让人自己发现：协程省的是调度，不是故障域；
     容器和线程虽然都「轻」，轻的完全不是一回事。

     config:
       selected: 初始选中的项（默认 thread）
  ============================================================ */
  WIDGETS['isolation-spectrum'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const ITEMS = [
      {
        k: 'container', name: '容器', en: 'namespace + cgroup',
        axis: '切出去',
        iso: '进程视图 / 文件树 / 网络栈',
        sched: '内核调度器',
        fault: '关在容器内，不波及宿主机',
        light: '共享的是**内核**',
        q: '谁和谁共享一个世界？',
      },
      {
        k: 'process', name: '进程', en: '资源域',
        axis: '各一份',
        iso: '地址空间',
        sched: '内核调度器',
        fault: '关在进程内，可单独清算',
        light: '什么都要重新建一份',
        q: '我拥有什么？',
      },
      {
        k: 'thread', name: '线程', en: '执行流',
        axis: '共享一份资源',
        iso: '无',
        sched: '内核调度器',
        fault: '同进程的线程共担',
        light: '省掉地址空间与文件表',
        q: '我从哪里继续执行？',
      },
      {
        k: 'coroutine', name: '协程 / goroutine', en: '用户态执行单元',
        axis: '共享得最多',
        iso: '无',
        sched: '用户态调度器',
        fault: '整个进程陪葬',
        light: '连内核都不进',
        q: '等的时候还能干嘛？',
      },
    ];

    const axis = el('div', 'is-axis');
    axis.append(el('span', 'is-axlabel', '共享得少 · 调度得重'));
    axis.append(el('span', 'is-axline'));
    axis.append(el('span', 'is-axlabel', '共享得多 · 调度得轻'));

    const strip = el('div', 'is-strip');
    const detail = el('div', 'is-detail');
    box.append(axis, strip, detail);

    let cur = cfg.selected || 'thread';

    function draw() {
      fill(strip, ITEMS.map((it) => {
        const c = el('button', 'is-card' + (it.k === cur ? ' is-on' : ''));
        c.type = 'button';
        c.append(el('b', 'is-name', it.name));
        c.append(el('span', 'is-en', it.en));
        c.append(el('span', 'is-axis-tag', it.axis));
        c.addEventListener('click', () => { cur = it.k; draw(); });
        return c;
      }));

      const it = ITEMS.filter((x) => x.k === cur)[0] || ITEMS[2];
      const rows = [
        ['隔离什么', it.iso],
        ['谁调度', it.sched],
        ['故障传到哪', it.fault],
        ['它省下的是什么', it.light],
      ];
      const head = el('div', 'is-head');
      head.append(el('b', '', it.name));
      head.append(el('span', 'is-en', it.en));
      const q = el('span', 'is-q'); richText(q, '它回答的问题是：' + it.q);

      const tbl = el('div', 'is-tbl');
      rows.forEach((r) => {
        const row = el('div', 'is-trow' + (r[0] === '故障传到哪' ? ' is-fault' : ''));
        row.append(el('span', 'is-tk', r[0]));
        const tv = el('span', 'is-tv'); richText(tv, r[1]);
        row.append(tv);
        tbl.append(row);
      });

      fill(detail, [head, q, tbl]);
      if (statusEl) statusEl.textContent = it.name;
    }

    draw();
  };

  /* ============================================================
     控件：fork-or-thread —— 走一遍真实的检查顺序
     ------------------------------------------------------------
     这个控件存在的理由：那句口诀「CPU 密集用进程、I/O 密集用线程」
     把一个多维权衡压成了一维。让人**自己走一遍**检查顺序，
     比在正文里列七条维度有用 —— 因为走完之后他会发现，
     阻塞特征（口诀讲的那个）排在第五问，前面还有四问挡着。

     走完后把**路径**也留着：那是「我为什么得到这个结论」的凭据，
     不是黑箱给的一个答案。

     config:
       start: 起始节点
  ============================================================ */
  WIDGETS['fork-or-thread'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');

    const T = {
      q0: {
        q: '任务之间需要独立的故障域 / 安全边界吗？',
        why: '跑不可信代码、崩溃必须隔离时，这一条是硬需求 —— 没有替代方案。',
        opts: [
          { label: '需要', to: 'v_isolation', note: '跑用户脚本、渲染不可信内容、高风险计算' },
          { label: '不需要', to: 'q1' },
        ],
      },
      q1: {
        q: '任务之间要直接共享同一份内存状态吗？',
        why: '共享多且读写频繁时，线程的零拷贝优势明显；反过来，高频小消息走 IPC 的序列化成本会吃掉一切。',
        opts: [
          { label: '要，而且读写频繁', to: 'v_share' },
          { label: '不要，或者本来就靠消息通信', to: 'q2' },
        ],
      },
      q2: {
        q: '任务的主要特征是什么？',
        why: '到这里才轮到口诀讲的那个维度 —— 它排在第五问，不是第一问。',
        opts: [
          { label: '大量等待 I/O', to: 'v_eventloop' },
          { label: 'CPU 密集', to: 'q3' },
        ],
      },
      q3: {
        q: '运行时里，线程能不能真并行？',
        why: '同一个问题，答案随语言运行时改变 —— 这是口诀最坑人的地方。',
        opts: [
          { label: '能（C++ / Java / Go）', to: 'v_thread' },
          { label: '不能（Python 的 GIL）', to: 'v_gil' },
        ],
      },
      v_isolation: {
        verdict: '进程', tone: 'violet',
        line: '隔离是硬需求，直接进程化，不用往下问。',
        cost: '代价：固定开销更高（每个进程一套页表与资源结构），跨进程共享要走 IPC。',
        ex: '浏览器站点隔离、跑用户脚本的沙箱、第三方编译服务。',
      },
      v_share: {
        verdict: '线程 —— 但要准备好锁', tone: 'green',
        line: '共享状态直接读写，省掉拷贝和序列化。',
        cost: '代价：数据竞争、原子操作、内存可见性都要自己扛；故障域也变成整个进程。',
        ex: '共享只读缓存 + 频繁读写同一份内存状态的计算任务。',
      },
      v_eventloop: {
        verdict: '事件循环 + 小线程池', tone: 'amber',
        line: '高连接数场景的正确答案通常不是「更多线程」。',
        cost: '事件循环负责等待，线程池负责会阻塞的活（磁盘、同步库）；线程池规模取核数级别即可。',
        ex: '十万连接的网关 —— 不靠十万线程，靠 epoll/kqueue 加一个核数级线程池。',
      },
      v_thread: {
        verdict: '线程', tone: 'green',
        line: 'CPU 密集 + 运行时支持真并行 → 线程最轻。',
        cost: '代价：缓存工作集互相污染（两头都逃不掉），线程数上限受内核资源限制。',
        ex: 'C++ / Rust / Go 里的并行计算；Java 的 fork-join。',
      },
      v_gil: {
        verdict: '进程', tone: 'violet',
        line: 'Python 的 GIL 让线程拿不到真并行，CPU 密集只能靠进程绕过去。',
        cost: '代价：IPC 复杂度 + 更高的内存开销（每个进程一份解释器状态）。',
        ex: 'Python 的 multiprocessing / concurrent.futures.ProcessPoolExecutor。',
      },
    };

    const trail = el('div', 'ft-trail');
    const quiz = el('div', 'ft-quiz');
    const out = el('div', 'ft-out');
    box.append(trail, quiz, out);

    let path = [];
    let cur = cfg.start || 'q0';

    function draw() {
      fill(trail, [el('span', 'ft-tlabel', '你走过的路')].concat(
        path.length
          ? path.map((p) => el('span', 'ft-step', p))
          : [el('span', 'ft-step ft-start', '从第一问开始')]
      ));

      const node = T[cur];
      if (node.opts) {
        const q = el('div', 'ft-q');
        q.append(el('b', '', node.q));
        const why = el('p', 'ft-why'); richText(why, node.why);
        q.append(why);
        const btns = el('div', 'ft-btns');
        node.opts.forEach((o) => {
          const b = el('button', 'ft-opt' + (o.to[0] === 'v' ? ' ft-final' : ''));
          b.type = 'button';
          b.append(el('span', 'ft-optlab', o.label));
          if (o.note) b.append(el('span', 'ft-optnote', o.note));
          b.addEventListener('click', () => {
            path = path.concat([o.label]);
            cur = o.to;
            draw();
          });
          btns.append(b);
        });
        fill(quiz, [q, btns]);
        fill(out, []);
      } else {
        fill(quiz, []);
        const v = el('div', 'ft-verdict tone-' + node.tone);
        const head = el('div', 'ft-vhead');
        head.append(el('span', 'ft-vlabel', '结论'));
        head.append(el('b', '', node.verdict));
        const l = el('p', 'ft-vline'); richText(l, node.line);
        const c = el('p', 'ft-vcost'); richText(c, node.cost);
        const e = el('p', 'ft-vex'); richText(e, '典型：' + node.ex);
        const again = el('button', 'ft-again', '↺ 换一组条件再走一遍');
        again.type = 'button';
        again.addEventListener('click', () => { path = []; cur = cfg.start || 'q0'; draw(); });
        fill(out, [v, head, l, c, e, again]);
        v.append(head); v.append(l); v.append(c); v.append(e); v.append(again);
        fill(out, [v]);
      }
      if (statusEl) statusEl.textContent = node.opts ? node.q : node.verdict;
    }

    draw();
  };

  /* ============================================================
     控件：thread-audit —— 一连接一线程，亏的到底是什么
     ------------------------------------------------------------
     这个控件存在的唯一理由，是拆掉那个被到处引用的错误论据：
     「一万个线程 × 8MB 栈 = 80GB」。

     8MB 是**虚拟地址空间预留**，页按需分配。真实每线程开销是
     内核栈（约 8KB）+ task_struct（约 8KB）+ 实际用到的用户栈。
     所以内存栏爬得很温和 —— 难看的是「调度器名单上有多少个实体，
     其中多少个什么也没干」那一栏。

     config: conn { min, max, step, def }
  ============================================================ */
  WIDGETS['thread-audit'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const runBtn = root.querySelector('[data-run]');
    const resetBtn = root.querySelector('[data-reset]');
    const C = cfg.conn || { min: 100, max: 50000, step: 100, def: 10000 };

    const richIn = (tag, cls, text) => {
      const node = el(tag, cls);
      richText(node, text);
      return node;
    };

    const sl = el('div', 'ta-sl');
    sl.append(el('span', 'ta-sl-lab', '同时在线的连接数'));
    const rng = el('input', 'ta-range');
    rng.type = 'range';
    rng.min = String(C.min); rng.max = String(C.max);
    rng.step = String(C.step); rng.value = String(C.def);
    const val = el('b', 'ta-sl-val');
    sl.append(rng, val);

    const barWrap = el('div', 'ta-barwrap');
    const bar = el('div', 'ta-bar');
    const segRun = el('div', 'ta-seg is-run');
    const segWait = el('div', 'ta-seg is-wait');
    bar.append(segRun, segWait);
    const legend = el('div', 'ta-legend');
    barWrap.append(bar, legend);

    const tbl = el('div', 'ta-tbl');
    const verdict = el('div', 'ta-verdict');
    box.append(sl, barWrap, tbl, verdict);

    // 每线程的**实际**开销（不是那个 8MB 虚拟预留）
    const KSTACK = 8 * 1024;      // 内核栈，通常一页
    const TASK   = 8 * 1024;      // task_struct，依内核配置
    const USTACK = 16 * 1024;     // 实际触碰到的用户栈，通常几十 KB 量级
    const PER = KSTACK + TASK + USTACK;

    const fmtBytes = (b) => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB'
      : b >= 1024 ** 2 ? Math.round(b / 1024 ** 2) + ' MB'
      : Math.round(b / 1024) + ' KB';
    const fmtN = (n) => n.toLocaleString();

    function render() {
      const n = Number(rng.value);
      const busy = Math.max(1, Math.round(n * 0.01));   // 假设任意时刻约 1% 真在跑
      const idle = n - busy;

      val.textContent = fmtN(n) + ' 条';
      segRun.style.flex = '0 0 ' + Math.max(0.4, (busy / n) * 100) + '%';
      segWait.style.flex = '1 1 auto';

      legend.textContent = '';
      legend.append(
        el('span', 'ta-lg is-run', '真在跑 ' + fmtN(busy)),
        el('span', 'ta-lg is-wait', '在等 ' + fmtN(idle)),
      );

      tbl.textContent = '';
      const row = (label, a, b, tone) => {
        const r = el('div', 'ta-row');
        if (tone) r.style.setProperty('--ta-tone', 'var(--' + tone + ')');
        r.append(el('span', 'ta-row-lab', label));
        r.append(richIn('span', 'ta-row-a', a));
        r.append(richIn('span', 'ta-row-b', b));
        return r;
      };
      const head = el('div', 'ta-row is-head');
      head.append(el('span', 'ta-row-lab', ''));
      head.append(el('span', 'ta-row-a', '一连接一线程'));
      head.append(el('span', 'ta-row-b', '事件驱动'));
      tbl.append(head);
      tbl.append(row('线程数（执行单位）', '**' + fmtN(n) + '** 个', '**1** 个'));
      tbl.append(row('其中真在跑', fmtN(busy) + ' 个', '1 个'));
      tbl.append(row('其中在等', '==' + fmtN(idle) + ' 个==', '0 个', 'red'));
      tbl.append(row('线程栈等开销（按实算）',
        fmtBytes(n * PER) + '（≈ ' + Math.round(PER / 1024) + ' KB/线程）', '几十 KB', 'green'));
      tbl.append(row('调度器要管的实体', fmtN(n) + ' 个', '1 个', 'red'));

      // 那个错误论据：虚拟预留
      const myth = n * 8 * 1024 * 1024;

      verdict.textContent = '';
      verdict.className = 'ta-verdict';
      richText(verdict,
        '**内存没爆。** ' + fmtN(n) + ' 个线程按实算才 **' + fmtBytes(n * PER) +
        '**。（网上常说的「× 8MB 栈 = ' + fmtBytes(myth) +
        '」是错的 —— 8MB 是==虚拟地址空间预留==，页按需分配，不是真占内存。）\n' +
        '难看的不是内存，是**调度器名单上有 ' + fmtN(n) + ' 个实体，其中 ' + fmtN(idle) +
        ' 个什么也没干**。');

      if (statusEl) {
        statusEl.textContent = fmtN(n) + ' 条连接 · ' + fmtN(idle) + ' 个线程在等 · 实占约 ' + fmtBytes(n * PER);
      }
    }

    rng.addEventListener('input', render);
    if (runBtn) runBtn.style.display = 'none';
    if (resetBtn) resetBtn.addEventListener('click', () => { rng.value = String(C.def); render(); });
    render();
  };

  /* ============================================================
     控件：code-and-stacks —— 一份代码，N 个执行现场
     ------------------------------------------------------------
     这个控件专治一个误解：「每个线程里是不是复制了服务端代码」。
     上面代码段**只有一份**（只读的机器指令），下面每个线程一份栈，
     那个 `char buf[1024]` 因此有 N 份 —— 它在各自的栈上。

     点任意一个栈 = 让它阻塞在 read。用来演示「一个线程等的不是别人」：
     它自己停住，其余线程照跑，因为它们执行的是同一份代码。

     config: threads { min, max, step, def }
  ============================================================ */
  WIDGETS['code-and-stacks'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const runBtn = root.querySelector('[data-run]');
    const resetBtn = root.querySelector('[data-reset]');
    const T = cfg.threads || { min: 1, max: 6, step: 1, def: 3 };

    const richIn = (tag, cls, text) => {
      const node = el(tag, cls);
      richText(node, text);
      return node;
    };

    const LINES = [
      'void handle_request(int fd) {',
      '    char buf[1024];',
      '    read(fd, buf, sizeof buf);',
      '    ...',
      '}',
    ];

    const sl = el('div', 'cs-sl');
    sl.append(el('span', 'cs-sl-lab', '同时跑几个线程'));
    const rng = el('input', 'cs-range');
    rng.type = 'range';
    rng.min = String(T.min); rng.max = String(T.max);
    rng.step = String(T.step); rng.value = String(T.def);
    const val = el('b', 'cs-sl-val');
    sl.append(rng, val);

    const code = el('div', 'cs-code');
    const cHead = el('div', 'cs-code-head');
    cHead.append(el('span', 'cs-code-ttl', '代码段'));
    cHead.append(el('span', 'cs-code-tag', '只读 · 全进程一份'));
    code.append(cHead);
    const cBody = el('div', 'cs-code-body');
    LINES.forEach((t, i) => {
      const r = el('div', 'cs-line');
      r.append(el('span', 'cs-ln', String(i + 1)));
      r.append(el('span', 'cs-code-txt', t));
      cBody.append(r);
    });
    code.append(cBody);

    const arrow = el('div', 'cs-arrow');

    const stacks = el('div', 'cs-stacks');
    const verdict = el('div', 'cs-verdict');
    box.append(sl, code, arrow, stacks, verdict);

    let n = 0, blocked = new Set();

    function render() {
      val.textContent = n + ' 个';

      stacks.textContent = '';
      for (let i = 0; i < n; i++) {
        const isB = blocked.has(i);
        const c = el('button', 'cs-stack' + (isB ? ' is-blocked' : ''));
        const h = el('div', 'cs-stack-head');
        h.append(el('span', 'cs-stack-ttl', '线程 ' + (i + 1)));
        h.append(el('span', 'cs-stack-badge', isB ? '阻塞在 read' : '运行中'));
        c.append(h);
        const b = el('div', 'cs-stack-body');
        b.append(el('span', 'cs-stack-seg', 'buf[1024]'));
        b.append(el('span', 'cs-stack-note', isB ? 'read 没返回，卡在这' : '正在执行 read'));
        c.append(b);
        c.append(el('div', 'cs-stack-hint', isB ? '点一下让它继续' : '点一下让它阻塞'));
        c.addEventListener('click', () => {
          if (blocked.has(i)) blocked.delete(i); else blocked.add(i);
          render();
        });
        stacks.append(c);
      }

      arrow.textContent = '';
      richText(arrow, '**↑** ==下面这 ' + n + ' 个线程，执行的都是上面那一份指令==');

      const nb = blocked.size;
      verdict.textContent = '';
      verdict.className = 'cs-verdict' + (nb ? ' is-warn' : '');
      richText(verdict,
        '**代码段 1 份 · 栈 ' + n + ' 份 · `buf` 也是 ' + n + ' 份**（每个栈上一块）。' +
        (nb
          ? ' 现在有 **' + nb + '** 个线程卡在 `read` 上 —— 但它们卡住的**不是同一件事**：' +
            '各自等各自的 fd。余下 ' + (n - nb) + ' 个照常在跑，==因为它们执行的本就是同一份代码，互不干扰==。'
          : ' 点任意一张栈，让它阻塞在 `read` —— 你会看到只有它自己停住。'));

      if (statusEl) {
        statusEl.textContent = n + ' 线程 · 代码段 1 份 · 阻塞中 ' + nb;
      }
    }

    rng.addEventListener('input', () => {
      n = Number(rng.value);
      for (const i of [...blocked]) if (i >= n) blocked.delete(i);
      render();
    });
    if (runBtn) runBtn.style.display = 'none';
    if (resetBtn) resetBtn.addEventListener('click', () => { blocked = new Set(); render(); });
    n = Number(rng.value);
    render();
  };

  /* ============================================================
     控件：schema-walk —— 沿着列名在几张表之间走
     ------------------------------------------------------------
     中间是「现在这一行」，左边是它用哪些列指着别处，右边是谁指着它。
     点任意一条邻居 → 那一头变成新的中心，走出来的路径记在面包屑上。

     config:
       start:   起始记录 id
       hint:    底部一句话
       jump:    { <邻居id>: "为什么这个邻居值得跳过去" }   可选
       records: [{ id, table, title, sub, fields:[[k,v]], note, off }]
       edges:   [{ from, to, via }]     from 这一行里有一个列指着 to
     ============================================================ */
  WIDGETS['schema-walk'] = (root) => {
    const cfg = cfgOf(root);
    const box = mountOf(root);
    const statusEl = root.querySelector('[data-status]');
    const recs = cfg.records || [];
    const edges = cfg.edges || [];
    if (!recs.length) return;
    const byId = {};
    recs.forEach((r) => { byId[r.id] = r; });
    const jump = cfg.jump || {};
    let path = [cfg.start || recs[0].id];

    const bar = el('div', 'sw-crumbs');
    const grid = el('div', 'sw-grid');
    const left = el('div', 'sw-side');
    const mid = el('div', 'sw-mid');
    const right = el('div', 'sw-side');
    grid.append(left, mid, right);
    const hint = el('p', 'sw-hint', '');
    box.append(bar, grid, hint);

    function chip(other, via) {
      const r = byId[other] || { title: other, table: '?', sub: '（这里没放它的内容）' };
      const c = el('button', 'sw-chip');
      c.append(el('code', 'sw-chip-title', r.title));
      c.append(el('span', 'sw-chip-tbl', String(r.table).replace(/^crm_dc_/, '')));
      c.append(el('span', 'sw-chip-via', via));
      if (jump[other]) c.append(el('span', 'sw-chip-why', jump[other]));
      if (r.off) c.classList.add('sw-chip-off');
      if (!r.fields) c.classList.add('sw-chip-stub');
      c.addEventListener('click', () => { path.push(other); render(); });
      return c;
    }

    function render() {
      const cur = byId[path[path.length - 1]];

      bar.textContent = '';
      path.forEach((id, i) => {
        if (i) bar.append(el('span', 'sw-sep', '›'));
        const b = el('button', 'sw-crumb' + (i === path.length - 1 ? ' on' : ''), (byId[id] || {}).title || id);
        b.addEventListener('click', () => { path = path.slice(0, i + 1); render(); });
        bar.append(b);
      });
      if (path.length > 1) {
        const back = el('button', 'sw-back', '← 退回');
        back.addEventListener('click', () => { path.pop(); render(); });
        bar.append(back);
      }

      left.textContent = '';
      left.append(el('div', 'sw-head', '这一行里有哪些列指着别处'));
      const os = edges.filter((e) => e.from === cur.id);
      if (!os.length) left.append(el('p', 'sw-empty', '没有。'));
      os.forEach((e) => left.append(chip(e.to, e.via)));

      mid.textContent = '';
      const h = el('div', 'sw-cur');
      h.append(el('span', 'sw-cur-tbl', String(cur.table).replace(/^crm_dc_/, '')));
      h.append(el('b', 'sw-cur-title', cur.title));
      if (cur.sub) h.append(el('span', 'sw-cur-sub', cur.sub));
      mid.append(h);
      const ft = el('div', 'sw-fields');
      (cur.fields || []).forEach((pair) => {
        const row = el('div', 'sw-field');
        row.append(el('code', 'sw-k', String(pair[0])));
        row.append(el('code', 'sw-v' + (String(pair[1]) === 'NULL' ? ' sw-null' : ''), String(pair[1])));
        ft.append(row);
      });
      mid.append(ft);
      if (cur.note) { const n = el('p', 'sw-note'); richText(n, cur.note); mid.append(n); }

      right.textContent = '';
      right.append(el('div', 'sw-head', '谁用列指着这一行'));
      const is = edges.filter((e) => e.to === cur.id);
      if (!is.length) right.append(el('p', 'sw-empty', '没有。'));
      is.forEach((e) => right.append(chip(e.from, e.via)));

      if (statusEl) statusEl.textContent = cur.table + ' · ' + cur.title + '（走了 ' + (path.length - 1) + ' 跳）';
      hint.textContent = '';
      richText(hint, cfg.hint || '');
    }
    render();
  };

  /* ---------- 挂载 ---------- */
  document.querySelectorAll('[data-widget]').forEach((root) => {
    var name = root.getAttribute('data-widget');
    var fn = WIDGETS[name];
    if (fn) { try { fn(root); } catch (e) { console.error('[widget:' + name + ']', e); } }
    else { console.warn('[widget] 未注册：' + name); }
  });
})();
