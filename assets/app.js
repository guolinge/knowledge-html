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
    var targets = links
      .map((a) => document.querySelector(a.getAttribute('href')))
      .filter(Boolean);

    function update() {
      var y = window.scrollY + 110;
      var current = targets[0];
      targets.forEach((t) => { if (t.offsetTop <= y) current = t; });
      links.forEach((a) => {
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
      (k, i) => `SELECT \`uid\` FROM ${['event_add_cart', 'user_portrait', 'crowds'][i]} WHERE ...`,
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

  /* ---------- 挂载 ---------- */
  document.querySelectorAll('[data-widget]').forEach((root) => {
    var name = root.getAttribute('data-widget');
    var fn = WIDGETS[name];
    if (fn) { try { fn(root); } catch (e) { console.error('[widget:' + name + ']', e); } }
    else { console.warn('[widget] 未注册：' + name); }
  });
})();
