/* ============================================================
   lib/blocks.mjs — markdown-it 插件：把自定义围栏块渲染成积木
   ------------------------------------------------------------
   note.md 里这样写：

     ```lane-stack
     - title: 源系统层
       nodes: [...]
     ```

   围栏内的 body 是 YAML。未注册的语言名会退化成普通代码块。
   ============================================================ */

import YAML from 'yaml';

/* ---------- 小工具 ---------- */

/** 把 "抽取 :: Extract :: 把数据从业务库拿出来" 拆成三段 */
function splitConn(spec) {
  const [main = '', en = '', note = ''] = String(spec).split('::').map((s) => s.trim());
  return { main, en, note };
}

/** 生成锚点 id；保留中文，去掉标点 */
function slugify(text) {
  const s = String(text)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'sec';
}

export { slugify };

/* ---------- 插件 ---------- */

export function blocksPlugin(md) {
  const esc = (s) => md.utils.escapeHtml(String(s ?? ''));
  const inline = (s) => md.renderInline(String(s ?? '').trim());

  /* ===== 积木 1 · lane-stack ===== */
  function conn(spec) {
    if (!spec) return '';
    const { main, en, note } = splitConn(spec);
    return `<div class="conn">
      <span class="stem"></span>
      <span class="pill">${inline(main)}${en ? ` <span class="en">${esc(en)}</span>` : ''}${
        note ? `<span class="note">${inline(note)}</span>` : ''
      }</span>
      <span class="stem"></span><span class="head"></span>
    </div>`;
  }

  function lane(l) {
    const tone = l.tone || 'muted';
    const nodes = (l.nodes || [])
      .map(
        (n) => `<div class="pnode${n.tone ? ` tone-${n.tone}` : ''}">
        <b>${inline(n.title)}</b>
        ${n.sub ? `<small>${esc(n.sub)}</small>` : ''}
        ${n.tag ? `<span class="tag tone-${n.tone || tone}">${esc(n.tag)}</span>` : ''}
      </div>`,
      )
      .join('');
    return `<div class="lane tone-${tone}">
        <div class="lane-meta">
          ${l.badge ? `<span class="ln">${esc(l.badge)}</span>` : ''}
          <b>${inline(l.title)}</b>
          ${l.desc ? `<small>${inline(l.desc)}</small>` : ''}
        </div>
        <div class="lane-body">${nodes}</div>
      </div>${conn(l.next)}`;
  }

  function laneStack(body) {
    const layers = YAML.parse(body) || [];
    const out = [];
    let i = 0;
    while (i < layers.length) {
      const group = layers[i].group;
      if (group) {
        const chunk = [];
        while (i < layers.length && layers[i].group === group) chunk.push(layers[i++]);
        out.push(
          `<div class="wgroup"><div class="wgroup-label">${inline(group)}</div>${
            chunk.map(lane).join('')
          }</div>`,
        );
      } else {
        out.push(lane(layers[i++]));
      }
    }
    return `<div class="pipe">${out.join('')}</div>`;
  }

  /* ===== 积木 2 · journey ===== */
  function journey(body) {
    const items = YAML.parse(body) || [];
    return items
      .map((it) => {
        const tone = it.tone || 'muted';
        const fields = (it.fields || [])
          .map(
            (f) => `<div class="${f.tone || ''}">
            <b>${esc(f.k)}</b><span>${esc(f.v)}</span>${
              f.note ? `<em>${esc(f.note)}</em>` : ''
            }</div>`,
          )
          .join('');
        const code = it.codeHtml
          ? `<div class="code-wrap" style="margin:0">${it.codeHtml}</div>`
          : it.code
            ? `<div class="code-wrap" style="margin:0"><button class="copy" data-copy>复制</button><pre>${esc(
                it.code,
              )}</pre></div>`
            : '';
        return `<div class="jcard">
          <div class="jcard-head">
            ${it.tag ? `<span class="tag tone-${tone}">${esc(it.tag)}</span>` : ''}
            ${it.name ? `<span class="name">${esc(it.name)}</span>` : ''}
            <span class="spacer"></span>
            ${it.badge ? `<span class="tag tone-${it.badgeTone || tone}">${esc(it.badge)}</span>` : ''}
          </div>
          ${fields ? `<div class="rec">${fields}</div>` : ''}
          ${code}
          ${it.note ? `<p class="jnote${it.noteTone === 'bad' ? ' bad' : ''}">${inline(it.note)}</p>` : ''}
        </div>${conn(it.next)}`;
      })
      .join('');
  }

  /* ===== 积木 3 · compare ===== */
  function cell(c, label) {
    const inner =
      c && typeof c === 'object'
        ? c.tone
          ? `<span class="tag tone-${c.tone}">${esc(c.text)}</span>`
          : inline(c.text)
        : inline(c);
    return `<td data-label="${esc(label || '')}">${inner}</td>`;
  }

  function compare(body) {
    const cfg = YAML.parse(body) || {};
    const head = cfg.head || [];
    const rows = cfg.rows || [];
    const thead = `<thead><tr><th>${esc(cfg.first || '')}</th>${head
      .map((h) => `<th>${inline(h)}</th>`)
      .join('')}</tr></thead>`;
    const tbody = `<tbody>${rows
      .map((r) => {
        const [k, vals] = Object.entries(r)[0] || ['', []];
        return `<tr><th>${inline(k)}</th>${(vals || [])
          .map((v, i) => cell(v, head[i]))
          .join('')}</tr>`;
      })
      .join('')}</tbody>`;
    return `<div class="compare-wrap"><table class="compare">${thead}${tbody}</table></div>`;
  }

  /* ===== 积木 4 · callout ===== */
  function callout(body) {
    const cfg = YAML.parse(body) || {};
    const tone = cfg.tone || 'blue';
    const cls = ['callout', `tone-${tone}`];
    if (cfg.tinted) cls.push('tinted');
    if (cfg.quote) cls.push('quote');
    return `<div class="${cls.join(' ')}">
      ${cfg.icon ? `<span class="ic">${esc(cfg.icon)}</span>` : ''}
      <div>${md.render(String(cfg.text || ''))}</div>
    </div>`;
  }

  /* ===== 积木 5 · checklist ===== */
  function checklist(body) {
    const cfg = YAML.parse(body) || {};
    const items = cfg.items || (Array.isArray(cfg) ? cfg : []);
    const cls = cfg.tone ? ` ${cfg.tone}` : '';
    return `<ul class="check${cls}">${items
      .map((it) => `<li>${inline(typeof it === 'string' ? it : it.text)}</li>`)
      .join('')}</ul>`;
  }

  /* ===== 积木 6 · quiz ===== */
  function quiz(body) {
    const items = YAML.parse(body) || [];
    return `<div class="quiz">${items
      .map(
        (it) => `<details>
        <summary>${inline(it.q)}</summary>
        <div class="a">${md.render(String(it.a || ''))}</div>
      </details>`,
      )
      .join('')}</div>`;
  }

  /* ===== 积木 7 · demo =====
  /* 两种形态：
     - panes: 双栏日志式（默认），配合 app.js 里的日志型控件
     - html:  自定义内容，控件自己渲染内部结构 */
  function demo(body) {
    const cfg = YAML.parse(body) || {};
    const actions = cfg.actions !== false;
    const panes = (cfg.panes || [])
      .map(
        (p) => `<div class="pane">
        <div class="pane-head">
          ${p.tag ? `<span class="tag tone-${p.tone || 'muted'}">${esc(p.tag)}</span>` : ''}
          ${inline(p.head || '')}
          ${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ''}
        </div>
        <div class="log" data-log="${esc(p.log)}"></div>
        ${
          p.foot && p.foot.length
            ? `<div class="pane-foot">${p.foot
                .map((f) => `<span class="tag tone-${p.tone || 'muted'}">${esc(f)}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>`,
      )
      .join('');
    const bodyHtml = cfg.html
      ? `<div class="demo-body custom">${cfg.html}</div>`
      : `<div class="demo-body">${panes}</div>`;
    return `<div class="demo" data-widget="${esc(cfg.widget)}">
      <div class="demo-head">
        <span class="title">${esc(cfg.title || '')}</span>
        <span class="status" data-status>${esc(cfg.hint || '未开始')}</span>
        <span class="spacer"></span>
        ${
          actions
            ? '<button class="btn" data-run>▶ 开始模拟</button>' +
              '<button class="btn ghost" data-reset>重置</button>'
            : ''
        }
      </div>
      ${bodyHtml}
    </div>`;
  }

  /* ===== 积木 8 · summary ===== */
  function summary(body) {
    const cfg = YAML.parse(body) || {};
    return `<div class="summary">
      ${cfg.title ? `<h3>${inline(cfg.title)}</h3>` : ''}
      ${md.render(String(cfg.text || ''))}
    </div>`;
  }

  /* ===== 积木 9 · cards ===== */
  function cards(body) {
    const cfg = YAML.parse(body) || {};
    const items = cfg.items || (Array.isArray(cfg) ? cfg : []);
    const inner = items
      .map((it) => {
        const tone = it.tone || 'muted';
        return `<div class="ccard tone-${tone}">
          ${it.tag ? `<span class="tag tone-${tone}">${esc(it.tag)}</span>` : ''}
          <h4>${inline(it.title)}</h4>
          ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
          ${it.code ? `<pre>${esc(it.code)}</pre>` : ''}
        </div>`;
      })
      .join('');
    return `<div class="cards"${cfg.cols ? ` data-cols="${esc(cfg.cols)}"` : ''}>${inner}</div>`;
  }

  /* ===== 积木 10 · timeline ===== */
  function timeline(body) {
    const items = YAML.parse(body) || [];
    return `<div class="timeline">${items
      .map((it) => {
        const tone = it.tone || 'blue';
        return `<div class="titem tone-${tone}">
          ${it.when ? `<span class="when">${esc(it.when)}</span>` : ''}
          <h4>${inline(it.title)}</h4>
          ${it.desc ? `<p>${inline(it.desc)}</p>` : ''}
        </div>`;
      })
      .join('')}</div>`;
  }

  /* ---------- 注册 ---------- */
  const RENDERERS = {
    'lane-stack': laneStack,
    journey,
    compare,
    cards,
    timeline,
    callout,
    checklist,
    quiz,
    demo,
    summary,
    raw: (body) => body,
  };

  /** 已知的代码语言。不在这张表里、也不在 RENDERERS 里的围栏名会被报警告 ——
   *  否则积木名拼错会静默退化成普通代码块，作者根本发现不了。 */
  const CODE_LANGS = new Set([
    'bash', 'sh', 'shell', 'zsh', 'console', 'text', 'txt', 'plain',
    'js', 'javascript', 'ts', 'typescript', 'tsx', 'jsx', 'json', 'jsonc',
    'sql', 'python', 'go', 'java', 'rust', 'ruby', 'php', 'c', 'cpp', 'kotlin', 'swift',
    'yaml', 'yml', 'toml', 'ini', 'env', 'diff', 'patch',
    'html', 'xml', 'css', 'scss', 'vue', 'svelte', 'md', 'markdown',
    'http', 'graphql', 'proto', 'dockerfile', 'makefile', 'nginx',
  ]);

  md.renderer.rules.fence = (tokens, idx, _opts, env) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    const lang = info.split(/\s+/)[0];
    const line = token.map ? token.map[0] + 1 : null;
    const render = RENDERERS[lang];

    if (render) {
      try {
        return render(token.content);
      } catch (e) {
        // 把 YAML 报错定位到具体文件和行号，并回显原始内容 ——
        // 这是 agent 自纠的唯一依据，不能只丢一个堆栈。
        const at = `${env?.file || 'note.md'}${line ? ':' + line : ''}`;
        const body = token.content
          .split('\n')
          .map((l) => `  | ${l}`)
          .join('\n');
        throw new Error(
          `${at} 积木 \`${lang}\` 解析失败\n` +
            `  ${String(e.message).split('\n').join('\n  ')}\n` +
            `  --- 原始内容 ---\n${body}`,
        );
      }
    }

    // 拼错积木名 / 未知语言：报警告，不要静默
    if (lang && !CODE_LANGS.has(lang) && env) {
      env.warnings = env.warnings || [];
      env.warnings.push({
        line,
        lang,
        message:
          `未知围栏语言 \`${lang}\`` +
          `。如果这是想用积木，可用的是：${Object.keys(RENDERERS).join(' / ')}` +
          `；否则请换成已知的代码语言（如 text、sql、js）。`,
      });
    }

    // 普通代码块：包一层以便放复制按钮
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    return `<div class="code-wrap"><button class="copy" data-copy>复制</button><pre><code${cls}>${esc(
      token.content,
    )}</code></pre></div>\n`;
  };

  /** 供校验脚本使用的元信息 */
  md.blockNames = Object.keys(RENDERERS);
  md.codeLangs = CODE_LANGS;
}

/* ---------- 正文后处理：给 h2/h3 加锚点并收集目录 ---------- */

export function addAnchors(html) {
  const toc = [];
  const seen = new Map();

  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => {
    // 「01 · 标题」→ 编号徽章
    let content = inner;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const m2 = text.match(/^(\d+[a-z]?)\s*[·:：]\s*(.+)$/);
    if (m2 && lvl === '2') {
      // 从原始 HTML 里剥掉开头的编号，保留其余行内标记
      content = `<span class="num">${m2[1]}</span>${inner.replace(
        /^\s*\d+[a-z]?\s*[·:：]\s*/,
        '',
      )}`;
    }

    const base = slugify(m2 ? m2[2] : text);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = n > 1 ? `${base}-${n}` : base;

    toc.push({ level: Number(lvl), id, text: m2 ? m2[2] : text });
    return `<h${lvl} id="${id}">${content}</h${lvl}>`;
  });

  return { html: out, toc };
}
