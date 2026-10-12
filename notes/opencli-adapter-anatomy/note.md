## 01 · opencli 到底做了什么

我们要查「公司现网有哪些用户字段、口径是什么」，答案在 UDP 那个内部网站上（`cnudp.futuoa.com`）。以前的做法是开浏览器、登录、搜索框里打字、点开详情、把口径 SQL 抄下来。

现在这一趟不用开浏览器：

```bash
opencli udp portrait futu_hk_trade_overnight_count
```

出来的是这个（这里只截前几个字段；终端里直接跑是一张表格，这里是进了管道之后的样子）：

```yaml
- id: 474
  name: FutuHK累计夜盘交易次数
  enName: futu_hk_trade_overnight_count
  status: 4
  dataType: long
  variableType: range
  defaultValue: '0'
  defaultExplain: 没有夜盘交易过
  relationship: |-
    select nn_uid,count(distinct order_id) as overnight_count
    from futu_hk.hk.ods.trade.t3.main_order.us
    where enable_ba_trade=3 and cum_qty>0 group by nn_uid
```

opencli 不生产这些数据，它做的是把**一个网站**变成**一个命令**。规则写在一个 JS 文件里，那个文件叫 adapter（适配器），`portrait.js` 就是其中一个。

```compare
first: 环节
head: [自己开浏览器点, opencli 的一条命令]
rows:
  - 登录: ["人工登录，登录态在浏览器里", "复用同一个登录态，但不用你操作"]
  - 找数据: ["搜索框 → 列表 → 点进详情", { text: "一条命令（内部 1~2 个接口）", tone: green }]
  - 拿到什么: ["屏幕上的文字", { text: "结构化 JSON / YAML / CSV", tone: green }]
  - 再加工: ["复制粘贴，或者手写脚本", "管道接给别的程序；`-f csv` 直接进表格"]
  - 谁来维护: ["你每次都要重来一遍", "规则写在文件里，坏了改那个文件"]
```

一次命令里同时在场的有四样东西，后面每一节都会碰到它们：

```cards
cols: 2
items:
  - title: adapter（你写的那一个文件）
    tag: 业务逻辑
    tone: violet
    body: |
      `~/.opencli/clis/udp/portrait.js`。一个 `cli({...})` 调用，声明四件事：
      哪个网站、命令叫什么、要什么参数、函数体怎么取数。
  - title: opencli 本体
    tag: 调度
    tone: blue
    body: |
      全局装的 `@jackwener/opencli`。它负责**跑**你的 adapter：
      找到文件、校验参数、借浏览器、把返回值渲染成表格。
  - title: Browser Bridge
    tag: 借浏览器
    tone: amber
    body: |
      一个 daemon（`127.0.0.1:19825`）+ 一个 Chrome 扩展。
      作用是让命令能用上**你 Chrome 里已经登录的身份**。
  - title: 目标网站
    tag: 数据来源
    tone: green
    body: |
      `cnudp.futuoa.com`。真正有数据的地方。它不关心请求是人发的还是命令发的，
      只认请求头里的 Cookie。
```

## 02 · 一条命令经过了谁

下面这张图是一次 `opencli udp portrait` 里同时在场的所有部件。==矩形里的每一行都能点==，点了会跳到它指向的那个零件；「入口」按钮从你熟悉的那一块进去；底下三条导览把这条链讲完。

```arch
svg: opencli-trip
caption: ==左边一行是 Node 进程里发生的事，右下方是浏览器里发生的事。== 命令本身（① ~ ④）全在一个进程内跑完；读 Cookie 要往下绕一圈（⑤ 走到 Chrome 里再回来）；真正的取数请求是 ==Node 进程自己发出去的==（⑥），浏览器只借出了身份；函数体返回的 `rows` 最后回到进程里渲染成输出（⑦）。矩形里的每一行、每一格都能点 —— 点了跳到它指向的那个零件；用「场景」在 ==第一次拉列表 ↔ 之后每条补详情== 之间切换，看 ⑤ ⑥ 是怎么被重复的；用「对比两个零件」挑两个（比如 **adapter** 和 **扩展**）出一张对照表。
parts:
  term:
    label: 你的终端
    sub: 一次性
    detail: 命令从这里进，结果也从这里出。整个 Node 进程跑完就退出，不留驻。
  main:
    label: main.js
    sub: 入口
    detail: |
      进来先做四件事：补 `PATH`（GUI 启动的终端常常找不到 `gh` / `docker`）、
      处理 `--version` 这类不需要发现的快速路径、**发现所有 adapter**、把参数交给 commander。
      发现跑两轮：先内置的 `clis/`，再用户目录 `~/.opencli/clis/`。==后发现的同名命令覆盖先发现的==，
      这就是私有 adapter 能顶掉官方实现的原因。
  registry:
    label: 注册表
    sub: 内存里的 Map
    detail: |
      键是 `site/name`（这里是 `udp/portrait`），值是命令定义。
      每个 adapter 文件被 `import` 时执行的那次 `cli({...})`，就是往这里写一条。
      `opencli list` 读的就是它。这个进程里有 5 条 `udp` 开头的命令。
  execution:
    label: executeCommand()
    sub: 收口
    detail: |
      它做四件事：按 `args` 声明校验并补默认值、判断这条命令要不要浏览器、调 `func`、结束之后关掉标签页。
      它只认类型、必填和默认值；==`limit ≤ 1000` 这种业务上限是 adapter 自己的事==（portrait.js 第 29 行）。
  adapter:
    label: portrait.js 的 func
    sub: 44 行
    facts: { 归属: 本机 Node 进程, 生命周期: 命令跑完就退, 需要什么权限: 无（Cookie 靠扩展借）, 谁在用它: opencli 的 executeCommand() }
    detail: |
      整个文件里只有这一段在做业务：读 Cookie、调两个接口、把字段挑出来塞进 `rows`。
      它拿到 `page` 对象（能读 Cookie、能操作浏览器），但它**取数用的是 Node 自己的 `fetch`**。
  render:
    label: output.js 的 render()
    sub: 最后一步
    facts: { 归属: 本机 Node 进程, 生命周期: 命令跑完就退, 需要什么权限: 无, 谁在用它: cli.js }
    detail: |
      函数体只负责 `return rows`，它不知道输出格式。渲染是 opencli 本体做的：
      按 adapter 声明的 `columns` 出表格；==进了管道（非 TTY）就自动降级成 YAML==。
  userdir:
    label: 磁盘上的 adapter
    sub: 6 个文件
    facts: { 归属: 磁盘, 生命周期: 一直在，改完即生效, 需要什么权限: 无, 谁在用它: 每个 Node 进程启动时扫一次 }
    detail: |
      公司的私有 adapter，不属于 opencli 官方包，所以放在用户目录：免编译、改完立刻生效、
      `npm 升级 opencli` 也不会被覆盖。==它和内置目录只差一个发现顺序。==
  udp:
    label: cnudp.futuoa.com
    sub: 数据在这
    facts: { 归属: 公司内网, 生命周期: 它自己说了算, 需要什么权限: 一个有效的 Cookie, 谁在用它: adapter 的那句 fetch }
    detail: 它只认请求头里的 Cookie。命令能查到东西，是因为你的浏览器登录过。
  daemon:
    label: daemon :19825
    sub: 常驻
    facts: { 归属: 本机常驻小服务, 生命周期: 常驻，一次拉起之后都在, 需要什么权限: 一个本机回环端口, 谁在用它: 所有需要浏览器的命令 }
    detail: |
      CLI 和扩展之间没法直接通话（扩展在浏览器沙箱里，外面连不进去），中间就放了这个本地小服务：
      CLI 用 HTTP 敲它，扩展用 WebSocket 连它。第一次用到时**自动拉起**，之后一直活着。
  ext:
    label: OpenCLI 扩展
    sub: 开发者模式装的
    facts: { 归属: Chrome 里, 生命周期: 常驻到 Chrome 关闭, 需要什么权限: 浏览器权限（cookies / debugger / tabs）, 谁在用它: daemon }
    detail: |
      它才有权限碰浏览器：`chrome.cookies` 读登录态、`chrome.debugger` 走 CDP 执行 JS、
      `chrome.tabs` 开关标签页。==adapter 里那句 `page.getCookies()` 最终落在它身上。==
  jar:
    label: Chrome 的 Cookie 库
    sub: Chrome 自己管的
    facts: { 归属: Chrome 自己管, 生命周期: 跟着登录态，过期就没了, 需要什么权限: 只有扩展读得到, 谁在用它: 扩展 }
    detail: |
      登录 cookie 存在这里，包含 `HttpOnly` 的那些（页面 JS 读不到，扩展能读）。
      这一趟合并去重后取出了 26 个。
  tab:
    label: 自动化标签页
    sub: 会话锚点
    detail: |
      每条命令占一个标签页（会话名 `site:udp:<uuid>`），跑完就被关掉。
      ==实测这一次它停在 `about:blank`==，命令从头到尾没让浏览器打开任何一个页面。
anchors:
  - { part: adapter, label: "你要维护的那个文件" }
  - { part: udp, label: "数据从哪来" }
  - { part: daemon, label: "本机那个 :19825" }
scenarios:
  - { id: list, label: "第一次业务请求 · /list", note: "读一遍 Cookie，拉一次列表", dim: [] }
  - { id: detail, label: "接着每条补详情 · /detail", note: "同一套流程再来 N 次，Cookie 也重新读", dim: [term, main, registry, userdir] }
bodies:
  term:
    badge: 第 0 步
    code: "opencli udp portrait <kw>"
    rows:
      - { k: 输出, v: "表格 / YAML", link: render }
      - { k: 退出码, v: "0 / 2 / 66", tip: "77 要登录 · 75 超时 · 69 连不上浏览器" }
  main:
    badge: 入口
    cells:
      - { label: "内置 clis/", sub: "官方那一批", tip: "随 npm 升级一起更新" }
      - { label: "用户 clis/", sub: "只有 udp", tone: violet, link: userdir }
    rows:
      - { k: 先做, v: "补 PATH、发现" }
      - { k: 再做, v: "交给 commander" }
  registry:
    badge: 内存 Map
    rows:
      - { k: "udp/portrait", v: "portrait.js", link: adapter }
      - { k: "udp/relation", v: "relation.js", tip: "同一个网站的另一类查询" }
      - { k: "共 5 条", v: "还有 dc-*", tip: "dc-* 是两个「原始返回」版本" }
    note: 键是 site/name
  execution:
    badge: 收口
    rows:
      - { k: 校验, v: "必填 / 类型 / 默认" }
      - { k: 会话, v: "site:udp:<uuid>", tip: "跑完就释放" }
      - { k: 收尾, v: "关掉标签页" }
    note: 只读命令不占写锁
  adapter:
    badge: 业务逻辑
    rows:
      - { k: 读, v: "page.getCookies() ×（1+N）", link: daemon, tip: "一次调用读 3 个域，合并去重" }
      - { k: 调, v: "/list（一次）", when: list, link: udp }
      - { k: 调, v: "/detail?id=（每条一次）", when: detail, link: udp }
      - { k: 挑, v: "47 个字段 → 12 个", tip: "留下哪 12 个，就是 columns 那份清单" }
    code: "fetchUdpJson(page, '/api/udp/portrait/list', …)"
  render:
    badge: 输出
    rows:
      - { k: 默认, v: "表格（终端里）", tip: "前提是 TTY；重定向就不算" }
      - { k: 管道里, v: "自动降级 YAML", tip: "所以复制粘贴得来的多半是 YAML" }
      - { k: "-f", v: "json / csv / md", tip: "显式指定就不降级" }
    note: adapter 不知道格式
  userdir:
    badge: 磁盘
    rows:
      - { k: portrait.js, v: 特征搜索, tip: "本次解剖的主角" }
      - { k: relation.js, v: 关系表搜索, tip: "同一网站的另一类对象" }
      - { k: relation-fields.js, v: 字段明细, tip: "码表 JSON 能直接落库" }
      - { k: dc-portrait.js, v: 原始返回, tip: "排查用：不加工" }
      - { k: dc-relation.js, v: 原始返回, tip: "排查用：不加工" }
      - { k: utils.js, v: 共享工具, tip: "请求 / 枚举 / 码表都靠它" }
    note: 免编译、改完即生效
  udp:
    badge: 只认 Cookie
    pairs:
      - { from: "/list", to: "id + 46 个字段", link: adapter, tip: "回到函数体被拆信封" }
      - { from: "/detail?id=", to: "47 个字段", link: adapter, tip: "每个 id 一次" }
    note: 多的那个是 auditInfo
  daemon:
    badge: 常驻
    rows:
      - { k: 收, v: "HTTP POST /command", tip: "探针看到的第一条就是它" }
      - { k: 转, v: "WebSocket → 扩展", link: ext, tip: "扩展主动连上来并保活，daemon 只做转发" }
      - { k: 启停, v: "第一次用到时自动拉起", tip: "opencli daemon status 能看它" }
    note: CLI 和扩展没法直接通话
  ext:
    badge: MV3 service worker
    cells:
      - { label: chrome.cookies, sub: 读登录态, link: jar }
      - { label: chrome.debugger, sub: "CDP：执行 JS", tip: "navigate / exec / 截图都走它" }
      - { label: chrome.tabs, sub: 开关标签页, link: tab }
    note: 这一趟只用到读 Cookie
  jar:
    badge: 登录态
    rows:
      - { k: cnudp.futuoa.com, v: "本次那批", tip: "26 个 Cookie 的主力" }
      - { k: futuoa.com, v: "父域兜底", tip: "读不到再去父域拿" }
      - { k: passport.futuoa.com, v: 登录中心, tip: "SSO 会话在这" }
    note: 含 HttpOnly
  tab:
    badge: 会话锚点
    rows:
      - { k: 地址, v: "about:blank", tip: "实测没导航过任何网址" }
      - { k: 会话, v: "site:udp:<uuid>" }
    note: 命令结束就关掉
tours:
  - id: trip
    label: "这条命令经过了谁"
    steps:
      - { at: [term, main], text: "终端把 `opencli udp portrait <关键词>` 交给 `main.js`，进程起来。①" }
      - { at: [userdir, registry], text: "发现阶段：扫 `~/.opencli/clis/udp/`，`import` 每个 `.js`；文件里的 `cli({...})` 把自己写进注册表。②" }
      - { at: [registry, execution], text: "按 `udp/portrait` 查到定义，交给执行器：校验参数、补默认值（`page=1`、`limit=10`）。③" }
      - { at: [execution, adapter], text: "调 `func(page, args)`。==从这一刻起，跑的都是你的代码。==④" }
      - { at: [adapter, daemon, ext, jar], text: "`page.getCookies()` 往下绕一圈：daemon 转发 → 扩展 → Chrome 的 Cookie 库，把登录态取回来。⑤" }
      - { at: [adapter, udp], text: "拿到 Cookie 串之后，==请求是 Node 进程自己发出去的==：`/api/udp/portrait/list`。⑥ 数据从这一步进来，后面全是本地加工。" }
      - { at: [render, term], text: "函数体 `return rows`，opencli 按 `columns` 渲染成表格；==它自己去管道里时换成 YAML==。⑦ 结果回到你的屏幕。" }
  - id: loop
    label: "为什么请求数是 1+N"
    steps:
      - { at: [adapter, udp], text: "列表接口一次返回 N 条，每条只给了 `id` 和 46 个字段。" }
      - { at: [adapter], text: "adapter 对每个 id 再调一次 `/detail?id=`；而 ==detail 只多一个 `auditInfo`，函数体还没有用它==。" }
      - { at: [adapter, daemon, ext, jar], text: "每转一圈，`readCookie()` 都会把 3 个域重新读一遍。==Cookie 没有缓存。==" }
      - { at: [term, render], text: "结果：`--limit 3` 实测 18 个 HTTP 请求、305ms。limit 越大，这个倍率越贵。" }
  - id: split
    label: "浏览器和请求，各干各的"
    steps:
      - { at: [ext, tab], text: "这一趟浏览器被用到的地方只有两处：读 Cookie，和准备一个标签页当会话锚点。" }
      - { at: [jar], text: "实测标签页停在 `about:blank`，没导航过任何网址。" }
      - { at: [adapter, udp], text: "取数的 HTTPS 请求由 Node 发出，==不走浏览器==。它带着从 Chrome 借来的 Cookie，所以服务端认为是同一个登录用户。" }
```

一次 `--limit 3` 的时间线实测 305ms。慢的不是某一次请求，而是次数：4 次业务请求各 26~82ms，12 次读 Cookie 的 RPC 各 6~17ms，剩下的二三十毫秒是进程启动和会话开销。

## 03 · portrait.js 是怎么被找到、又是怎么被调起来的

`portrait.js` 全文 66 行。官方模板把它叫三段（declaration / args / func），这里按四块读它 —— 因为 `columns` 单独管着「输出长什么样」。==上面那张图里的 ② ④ 两步，对应的就是下面这两块。==

```cards
cols: 2
items:
  - title: 第一段 · 声明（第 5~14 行）
    tag: 谁来发现我
    tone: violet
    body: |
      一次 `cli({...})` 调用：

      `site: 'udp'` + `name: 'portrait'` → 命令名 `opencli udp portrait`
      `strategy: Strategy.COOKIE` → 需要登录态，所以要有浏览器
      `browser: true` → 这条命令要一个 `page` 对象
      `domain: 'cnudp.futuoa.com'` → 登录域
      `navigateBefore: false` → ==不预先打开网站页面==
  - title: 第二段 · 参数（第 15~19 行）
    tag: 谁来校验
    tone: blue
    body: |
      三个参数，声明成数据而不是写成解析代码：

      `keyword` 必填、位置参数
      `page` 整数、默认 1
      `limit` 整数、默认 10

      opencli 按这份声明校验类型、补默认值、生成 `--help`。
      传 `--limit 1001`：类型校验能过（它确实是整数），进了函数体、走到==第 29 行被 adapter 自己的检查==拦下，退出码 2。
  - title: 第三段 · 返回哪些列（第 20~21 行）
    tag: 输出长什么样
    tone: emerald
    body: |
      `columns` 列 12 个字段名，它们决定**表格输出的列和顺序**。

      它只影响显示：函数体返回的对象里字段比这多也不显示，
      少一个就显示空。`extras` 是嵌套对象，表格里直接渲染成字面的
      `[object Object]` —— ==这条命令实际上只有 YAML / JSON 好用==。
  - title: 第四段 · 函数体（第 22~65 行）
    tag: 业务逻辑都在这里
    tone: amber
    body: |
      44 行，全是「取数 + 挑字段」。它不解析 HTML、不点按钮、不管输出格式，
      因为它拿到的不是网页，而是两个接口的 JSON。
```

想改它的行为，就是改那个文件：

```callout
tone: green
icon: ✏
text: |
  把一份 adapter 放进 `~/.opencli/clis/<site>/` 就生效（同名覆盖内置的），改完不用编译、不用重启。

  改坏了先跑 `opencli validate <site>`，它检查语法和声明；过了再真跑一次命令看输出。
  `opencli list` 随时能看到当前这个进程里注册了哪些命令。
```

## 04 · 从关键词到一行表格：数据走了六步

这一段是整篇的重点。同一个字段数据在命令里换了六种形态，每一步都丢一点、加一点：

```demo
widget: stepper
title: 一个关键词的六次变形
actions: false
config:
  steps:
    - label: 你给的字符串
      note: 起点只有一个词，谁都不知道它对应几条记录。
      code: |
        "futu_hk_trade_overnight_count"
    - label: 第一层 API 包裹
      note: |
        `GET /api/udp/portrait/list?page=1&pageSize=1&keyword=…` 的原始返回。
        ==有两层 `data`==：外层是 API 信封（`code` / `message`），内层是分页信封（`data` / `totalCount` / `page` / `pageSize`）。
      code: |
        {
          "code": 0,                       // ← API 信封
          "message": "成功",
          "data": {                        // ← 分页信封
            "data": [ {"id": 474, "enName": "…", …} ],   // ← 46 个字段
            "totalCount": 1, "page": 1, "pageSize": 1
          }
        }
    - label: 拆信封，拿到数组
      note: |
        `fetchUdpJson()` 里 `return data?.data` 剥掉第一层，
        adapter 里 `Array.isArray(payload?.data) ? payload.data : []` 剥掉第二层。
        ==剥完之后这里只剩下 `id` 有用==，下一步要拿它去问详情。
      code: |
        [ { id: 474, name: "FutuHK累计夜盘交易次数", … }, … ]
    - label: 按 id 补详情
      note: |
        对每个 id 再调 `GET /api/udp/portrait/detail?id=474`，返回 47 个字段。
        ==实测：detail 只比 list 多一个 `auditInfo`，而函数体没有用它。==
      code: |
        { "code": 0, "data": { "id": 474, "caliber": "…", "relationship": "…", … } }
    - label: 挑字段 + 抹平差异
      note: |
        12 个字段被挑进 `rows`，其中三处做了加工：
        `enumContent` → `enumMapping("0:否;1:是")`；`developers` 可能是字符串也可能是数组，统一成 `;` 拼接；
        `extras` 把 10 个零散字段收成一个对象。==剩下的二十多个字段在这里被丢掉。==
      code: |
        rows.push({
          id: d.id ?? null,
          name: d.name ?? null,
          enumMapping: enumMapping(d.enumContent),
          extras: {
            developers: Array.isArray(d.developers) ? d.developers.join(';') : str(d.developers),
            updatedAt: d.updatedAt ?? null,
            …
          },
        });
    - label: 渲染
      note: |
        函数体 `return rows` 就结束了，==它完全不知道输出格式==。
        渲染是 opencli 本体做的：按 `columns` 出表格。
        管道里跑（非 TTY）时 `table` 会自动降级成 YAML，所以复制粘贴得来的多半是 YAML 的样子。
      code: |
        - id: 474
          name: FutuHK累计夜盘交易次数
          enName: futu_hk_trade_overnight_count
          …
```

`??`（空值合并）铺满整个 `rows.push`：接口字段缺了、类型不对，这里都不报错，只是变成 `null`。==数据变少了不会有人告诉你。==

## 05 · 三个反直觉的地方

第一条最反直觉：**取数请求不是浏览器发的。**

```callout
tone: red
icon: ⚠
text: |
  adapter 里那句 `fetch(url, { headers: { Cookie: cookie } })` 执行在 **Node 进程**里，
  不是浏览器。浏览器只借出了 Cookie 串。

  证据有两条，都是这一趟实测的：

  - `--trace on` 抓的 `network.jsonl` 是 **0 字节**：追踪只抓浏览器侧的网络，这条请求不经过浏览器
  - 标签页最后停在 `about:blank`，它压根没被用到

  ++所以排查这条命令时，别去 Chrome 的开发者工具里找那个请求。++
```

第二条：**`detail` 那次请求，这一趟是白打的。**

```compare
first: 接口
head: [返回字段数, 独有字段]
rows:
  - "`/list` 的每一条": ["46 个", "——"]
  - "`/detail?id=`": ["47 个", "只多一个 `auditInfo`，==而且函数体没用它=="]
```

`portrait.js` 对每个 id 都打一次 detail，所以一次命令的请求数不是 2 次，而是 **1 + N 次**。这件事在 `--limit` 变大时会被放大：

```demo
widget: tuner
title: 一次命令要发多少个 HTTP 请求
actions: false
config:
  param: { label: limit（要几条记录）, values: [1, 3, 10, 50, 200] }
  outputs:
    - { label: 业务请求（1 + N）, values: [2, 4, 11, 51, 201], tone: amber }
    - { label: 读 Cookie 的 RPC（3 × 上面那个数）, values: [6, 12, 33, 153, 603], tone: red }
    - { label: HTTP 请求总数, values: [10, 18, 46, 206, 806], tone: muted }
```

`values` 是把实测公式代进去算出来的数字：1 和 3 这两档真跑过（10 个、18 个），其余按同一条公式推算 —— 总数 = 1（探活）+ 3(1+N)（读 Cookie）+ (1+N)（业务）+ 1（关标签页）。公式本身来自代码：`readCookie()` 每次调用打 3 个域（`cnudp` / `futuoa.com` / `passport`），而 `fetchUdpJson()` 每次调用都重新读一遍。

第三条：`trace` 抓不到业务请求，但抓到了别的东西。

````callout
tone: amber
icon: 🌀
text: |
  `--trace on` 的产物在 `~/.opencli/profiles/default/traces/<时间戳>-<随机>/`：
  `summary.md` 是能读的行动时间线，`network.jsonl` 是空的（见上一条），
  `state/` 存着最后页面状态，`screenshots/` 存着截图。

  这次的时间线只有两行，恰好把命令的骨架说清了：

  ```text
  06:54:38.053Z command start {"args":{"keyword":"…","page":1,"limit":2}}
  06:54:38.640Z command end
  ```

  ==两行之间 587ms，就是上面那一整趟。==
````

## 06 · 它会怎么坏

知道每一步谁负责，就能知道坏了该找谁。三种常见失效：

```compare
first: 现象
head: [真实原因, 该找谁]
rows:
  - "`AUTH_REQUIRED`：提示 session expired":
      - "`utils.js` 自己判出来的：响应跳到了 `/login`，或者返回的是 HTML 而不是 JSON"
      - "**去 Chrome 里重新登录 futuoa**，命令不用改"
  - "`BROWSER_CONNECT`：extension not connected":
      - "扩展没连上 daemon：没启用、被禁用、或者 Chrome 没开"
      - "跑 `opencli doctor`；再不行就打开 chrome://extensions 确认它是启用状态"
  - "某几个字段突然全变 `null`":
      - "接口字段改名或改类型了，`?? null` 把它静静吃掉"
      - { text: "==最难查的一种==：去 `detail` 的原始返回里对键名", tone: red }
```

还有两类「不是坏，但会误导你」的情况：

```cards
cols: 2
items:
  - title: 输出变成了 YAML
    tag: 不是坏了
    tone: muted
    body: |
      非 TTY（管道、重定向、CI）下，`table` 会自动降级成 YAML。
      屏幕上看着是表格、`| head` 之后变成 YAML，是同一个原因。
      想固定格式就显式写 `-f json` / `-f csv`。
  - title: 退出码不是 0
    tag: 拿来写脚本
    tone: muted
    body: |
      `ARGUMENT` = 2（比如 `--limit 1001`）；
      `EMPTY_RESULT` = 66（这个关键词搜不到东西）；
      `AUTH_REQUIRED` = 77；`TIMEOUT` = 75。
      ==脚本里判 `exit 66` 比 grep 输出文字稳。==
```

## 07 · 自测

```quiz
- q: opencli 自己会取数据吗？这一趟里真正取数的是谁？
  a: |
    不会。opencli 负责发现 adapter、校验参数、提供浏览器通道、渲染输出；
    取数那两行是 adapter 的函数体，用 Node 自己的 `fetch` 发的，浏览器只借出 Cookie。
- q: 为什么一次命令要读 1 + N 次 Cookie？
  a: |
    因为 `fetchUdpJson()` 每次调用都重新 `readCookie()`，而它每次打 3 个域的 RPC。
    代码里没有缓存。是浪费，还是「每次都拿最新的登录态」，看你怎么判。
- q: "`--limit 1` 和 `--limit 200` 的请求数差多少？"
  a: |
    `limit 1` 实测 10 个 HTTP 请求；`limit 200` 按同一条公式是 806 个
    （业务请求 1+N，读 Cookie 的 RPC 是它的 3 倍）。
    这就是 N+1 请求在小数据上无感、在大数据上致命的原因。
- q: "这条命令为什么不需要预先打开网站页面（`navigateBefore: false`）？"
  a: |
    因为它只用到 Cookie，不需要页面里的任何东西。
    代价是：哪天接口要求一个只存在于页面里的 CSRF token，这条命令就会失败。
```
