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

      // 区域框：算成员节点的包围盒，把框画在它们外面
      root.querySelectorAll('[data-group-box]').forEach((boxEl) => {
        const gid = boxEl.getAttribute('data-group-box');
        const members = Array.from(root.querySelectorAll(`.fnode[data-group="${gid}"]`));
        if (!members.length) { boxEl.hidden = true; return; }
        boxEl.hidden = false;
        const pad = 20;
        const top = Math.min(...members.map((m) => gy + m.offsetTop)) - pad - 8;
        const left = Math.min(...members.map((m) => gx + m.offsetLeft)) - pad;
        const right = Math.max(...members.map((m) => gx + m.offsetLeft + m.offsetWidth)) + pad;
        const bottom = Math.max(...members.map((m) => gy + m.offsetTop + m.offsetHeight)) + pad;
        boxEl.style.top = `${top}px`;
        boxEl.style.left = `${left}px`;
        boxEl.style.width = `${right - left}px`;
        boxEl.style.height = `${bottom - top}px`;
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

        const cls = ['fedge', e.dashed && 'dashed', e.anim && 'anim'].filter(Boolean).join(' ');
        parts.push(
          `<path class="${cls}" d="${d}"${e.tone ? ` style="color:var(--${e.tone})"` : ''}${
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

      // 1) lifeline：从头部底部到主体底部
      const lifeTop = headH + 6;
      const lifeBottom = headH + 18 + bodyH;
      Object.values(cx).forEach((x) => {
        parts.push(
          `<line class="lifeline" x1="${x}" y1="${lifeTop}" x2="${x}" y2="${lifeBottom}"/>`,
        );
      });

      // 2) 消息箭头
      root.querySelectorAll('.smsg').forEach((row) => {
        const from = row.getAttribute('data-from');
        const to = row.getAttribute('data-to');
        const kind = row.getAttribute('data-kind') || 'sync';
        const note = row.getAttribute('data-note');
        const tone = row.getAttribute('data-tone');
        const toneAttr = tone ? ` style="color:var(--${tone})"` : '';
        const x1 = cx[from];
        const x2 = cx[to];
        if (x1 === undefined || x2 === undefined) return;

        const y = headH + 18 + row.offsetTop + row.offsetHeight / 2;

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

        if (note) {
          parts.push(
            `<text class="note" x="${(x1 + x2) / 2}" y="${y - 13}">${escapeXml2(note)}</text>`,
          );
        }
      });

      svg.innerHTML = svg.querySelector('defs').outerHTML + parts.join('');
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

  /* ---------- 挂载 ---------- */
  document.querySelectorAll('[data-widget]').forEach((root) => {
    var name = root.getAttribute('data-widget');
    var fn = WIDGETS[name];
    if (fn) { try { fn(root); } catch (e) { console.error('[widget:' + name + ']', e); } }
    else { console.warn('[widget] 未注册：' + name); }
  });
})();
