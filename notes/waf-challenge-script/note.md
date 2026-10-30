> 同一个接口，浏览器打开是 200 和 JSON，curl 打过去是一行 403。
>
> 中间隔着的不是 header 没写全，而是一段必须在浏览器里执行、执行完才能换到通行证的 JS。
> 这篇把它拆成四样东西、一条时间线，再说清为什么「把脚本抄下来跑一遍」这条路走不通。

## 01 · 同一个地址，两种客户端

先看一组实测。同一个 JSON 接口，在同一台机器上先后各打一次：

```compare
first: 谁发的
head: [收到什么, 说明什么]
rows:
  - 浏览器: ["200，application/json，字段齐全", "被当成正常访客"]
  - "curl（同一个 URL）":
      - { text: "403，只有一行字：Seek IP Blacklisted", tone: red }
      - "在到达业务逻辑之前就被拦下了"
```

用 `opencli browser <会话名> analyze <url>` 抓同一个地址，判给它的评语是「像真数据」（`real_data_score` 0.87）：字段齐全、状态 200、body 是 JSON 对象。curl 那边只有 35 字节的一行字。

这说明拦截点在**边缘**：请求还没进到源站，就已经被决定了命运。它判定时看的不是你 URL 拼得对不对，而是**发请求的这个东西像不像浏览器**。

WAF（Web 应用防火墙）就是站在源站前面做这个判断的一层。它不处理业务，只决定一个请求能不能被转进去。

抓取时说的「撞 WAF」，指的就是这一步：请求在边缘被挡下来，拿回来的不是数据。

```callout
tone: amber
icon: ⚠
text: |
  上面那个 403 是**硬拦**，不是挑战。两者的区别在后面：硬拦直接结束，挑战会给你一次机会。

  但它们的判断依据是同一个：==你拿不出它要的证据==。
```

## 02 · 挑战：不拒绝，出一道题

挑战（challenge）的做法反过来：**不返回数据，返回一段 JS**。这段 JS 必须在浏览器里执行，执行完算出一个值，写进 cookie，然后带着这个 cookie 重新请求一次。第二次请求才是要数据的那一次。

这种「先做题，再放行」的机制在业界叫挑战脚本（challenge script），厂商文档里常写成 JavaScript challenge 或 JS 校验。

```compare
first: 边缘的三种做法
head: [你看到什么, 接下来会发生什么]
rows:
  - 硬拦: ["403 / 412，一行文本", "结束，没有第二次机会"]
  - 挑战:
      - { text: "200，但 body 是一段 JS", tone: amber }
      - "浏览器执行它，算出值写进 cookie，再请求一次"
  - 验证码: ["200，一个滑块或点选", "程序无从下手，只能人来做"]
```

阿里云 WAF 的文档把 JS 校验写成四步，每一步都说清了谁在做：

```text
① 请求命中规则
② WAF 返回一个 HTML 页面，里面装着生成挑战参数的算法
③ 浏览器加载这个页面，算出加密参数，写进 cookie，然后重新发起请求
④ WAF 收到请求后校验参数：通过了就转给源站；没有 cookie 或值不对，就再返回一次挑战页
```

第 ④ 步是整件事的关键。文档的原话是：

> If the client does not include the cookie inserted by the JavaScript challenge or the cookie value is invalid, WAF considers the request to be from a script and returns the JavaScript challenge page again.

翻译过来只有一句：**拿不出 cookie，就当作你是脚本**。它不需要证明你是机器人，只需要你没通过。

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==挑战的门槛不在「难」，在「没有就当你不是浏览器」。==

  所以 curl 拿到的不是「答错了」，是**连被评判的资格都没有**：它的请求里根本不存在那个值。
```

## 03 · 四样东西

先不看请求怎么走。这件事只有四样东西：一个环境、一段脚本、一个 cookie、一个判定者。

```arch
svg: waf-parts
maxScale: 1.24
caption: 从右边往里看：源站收到的请求，都是 WAF 判过「答过题」的那些；从左边往外看：脚本要的答案长在浏览器里。
frames:
  - id: bproc
    boundary: 0
    kind: contains
    label: 浏览器进程
    detail: 脚本和 cookie 都在这个进程里；脚本能读到的环境也在这里，出不去。
  - id: edge
    boundary: 1
    kind: contains
    label: 站点边缘
    detail: 请求先到 WAF。命中规则就下发挑战页，只有校验通过，请求才被转给源站。
  - id: origin
    boundary: 2
    kind: contains
    label: 源站
    detail: 它只看见「带合法 cookie 的请求」，看不见挑战这一层。
bodies:
  browser:
    badge: 答案的来源
    rows:
      - { k: JS 引擎, v: 能跑这段代码 }
      - { k: canvas · WebGL, v: 显卡画的像素 }
      - { k: 字体 · 时区, v: 这台机器的样子 }
      - { k: 鼠标键盘, v: 真的动过没有 }
    note: 这些能力本身不值钱，值钱的是**别人抄不走**
  challenge:
    badge: 三步都由它自己跑
    rows:
      - { k: ① 取证, v: "读 canvas / 字体 / 事件" }
      - { k: ② 计算, v: "种子 + 指纹 + 时间" }
      - { k: ③ 回填, v: "写 cookie，然后重发" }
    note: 浏览器只是照着执行，不审查它从哪来
  jar:
    badge: 通行证
    cells:
      - { label: cf_clearance }
      - { label: acw_sc__v2 }
      - { label: _abck }
    note: 名字不同，作用一样：证明「这道题我答过」
  waf:
    badge: 三种结局
    rows:
      - { k: 没有 cookie, v: 再发一次题 }
      - { k: 值对不上, v: 当作脚本 }
      - { k: 都对, v: 放行到源站 }
    note: 它不判断你是谁，只判断这道题你答过没有
  api:
    rows:
      - { k: 收到的, v: 带合法 cookie 的请求 }
    note: 它在整件事里没有选择权
parts:
  browser:
    label: 浏览器环境
    sub: 答案的来源
    detail: ==脚本要的每一样东西都在这里。== 换一台机器、换一块显卡，算出来的值就不同。
  challenge:
    label: 挑战脚本
    sub: 服务器下发
    detail: 它不携带数据，只携带三个动作：取指纹、算值、写 cookie。
  jar:
    label: cookie
    sub: 通行证
    detail: 这是脚本唯一留在你机器上的东西，也是 WAF 唯一认的东西。
  waf:
    label: WAF 边缘
    sub: 判定者
    detail: 它只管两件事：有没有通行证，值对不对。没有就再发一次题。
  api:
    label: 源站 API
    sub: 终点
    detail: 它不会收到「没答过题」的请求，所以它不需要关心挑战这回事。
tours:
  - id: flow
    label: 一次挑战里，东西怎么走
    steps:
      - { at: [waf, challenge], text: "命中的请求拿到一段 JS。" }
      - { at: [challenge, browser], text: "==脚本读的是这台机器的样子==，不是代码里的常量。" }
      - { at: [challenge, jar], text: "算完写进 cookie。" }
      - { at: [jar, waf, api], text: "带着它重发，WAF 才放行。" }
  - id: why-bot
    label: 为什么程序卡在这里
    steps:
      - { at: [browser], text: "程序可以伪造 UA、IP、header，但==它没有显卡、没有字体、没有鼠标==。" }
      - { at: [challenge], text: "脚本要的正是这些，于是算出的值对不上。" }
      - { at: [jar], text: "没有合法的 cookie。" }
      - { at: [waf], text: "于是再发一次题，循环不会结束。" }
```

图里最容易看错的一点：**脚本不是数据的中转站**。它从头到尾没碰过数据，它只做一件事：把「这台机器的样子」变成一个值。所以它必须跑在浏览器里，而且必须是**有显卡、有字体、有人在用的**那个浏览器。

还有一点值得单独说。这三步没有一步是浏览器主动做的，浏览器只是把服务器给的代码当普通脚本执行掉，既不判断来源，也不判断意图。它不知道这是挑战，也不知道执行完会发生什么。==这正是挑战能成立的前提==：站点可以往任何访客的浏览器里塞一段代码，而浏览器会老实跑完。

## 04 · 时间线：一条线在第二步就断了

把两边的请求按时间铺开，差异只有一处：

```seq
grid: true
participants:
  - { id: c, label: curl, sub: 不执行 JS, kind: external }
  - { id: b, label: 浏览器, sub: 会执行 JS, kind: frontend }
  - { id: w, label: WAF, sub: 边缘, kind: security }
  - { id: a, label: 源站 API, sub: 有数据, kind: backend }
messages:
  - { from: c, to: w, label: "GET /api/quotec", kind: sync, note: 1 }
  - { from: b, to: w, label: "GET /api/quotec", kind: sync, note: 1 }
  - { from: w, to: c, label: "200 + 挑战脚本", kind: reply, note: 2 }
  - { from: w, to: b, label: "200 + 挑战脚本", kind: reply, note: 2 }
  - { from: b, to: b, label: "取证 → 计算 → 回填", kind: self, note: 3 }
  - { from: b, to: w, label: "同一个请求 + cookie", kind: sync, note: 4 }
  - { from: w, to: a, label: 校验通过，转发, kind: sync, note: 5 }
  - { from: a, to: b, label: "JSON 数据", kind: reply, note: 6 }
```

两条线在第 ② 步拿到的东西**一模一样**：都是那份 HTML。区别在后面：浏览器的第 ③ 步是「跑」，curl 的那一栏什么都没有，它只是把这段 HTML 存进了内存，然后就没有下一步了。

所以「curl 被拦了」这个说法不准确。它没有被拦，它是**走到一半停住了**，因为它的世界里没有能执行那段代码的东西。

## 05 · 四种挑战，三种交卷节奏

「挑战」是一个统称，各家实现差别很大。下面四种是抓取时最常撞到的：

```compare
first: 谁家的
head: [你看到的线索, 交卷方式, 通行证]
rows:
  - 阿里云 WAF:
      - "HTML 里出现 `arg1='…'` 和一大段混淆函数"
      - "算完写 cookie，整页重发"
      - "`acw_sc__v2` / `acw_sc__v3`"
  - Cloudflare:
      - "隐藏 iframe 加载 `/cdn-cgi/challenge-platform/…`"
      - { text: "静默，页面不刷新，每个 HTML 请求都跑一次", tone: amber }
      - "`cf_clearance`"
  - Akamai:
      - "页面加载后持续上报 sensor data"
      - { text: "持续上报，若干次请求之后才翻转", tone: amber }
      - "`_abck`（不透明，绑定会话）"
  - 极验:
      - "一个滑块或点选图"
      - { text: "让人来拖，服务端判轨迹", tone: red }
      - "验证票据"
```

交卷的节奏不一样，取数据的时机也不一样：

```cards
cols: 3
items:
  - title: 整页重载
    tag: 一次性
    tone: blue
    desc: 要等它刷新完。在这之前读页面，读到的是挑战页本身
  - title: 静默
    tag: 每次请求
    tone: violet
    desc: 要等脚本跑完，而页面不会有任何变化提示
  - title: 持续上报
    tag: 有时序
    tone: amber
    desc: 要等几次请求之后。打开就取，拿到的还是挑战页
```

Cloudflare 那种静默模式，真实抓到的注入是这样的：

```js
window.__CF$cv$params={r:'a52877852aaa7a89',t:'MTc5MzM0MjgyOA=='};
var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=a52877852aaa7a89';
```

`r` 是这次请求的编号，`t` 是 base64 之后的时间戳。官方文档说这段东西是「轻量、不可见的片段，在每个 HTML 请求上运行」，寿命 15 分钟，过期前会再注入一次；结果写进 `cf_clearance`，字段叫 `js_detection.passed`。

```callout
tone: amber
icon: ⚠
text: |
  ==「页面看起来正常」不能说明挑战没发生。==

  Cloudflare 的脚本在隐藏 iframe 里跑，页面该显示什么还显示什么。
  真正能说明问题的只有一件事：**你的请求里有没有那个 cookie**。
```

## 06 · 为什么抄不出答案

最容易想到的办法是：把那段 JS 抄下来，在自己的环境里跑一遍，拿到值，再塞进请求。这条路走不通，原因在脚本的输入上。

```compare
first: 它验什么
head: [怎么验, 为什么伪造不了]
rows:
  - 渲染: ["canvas 上画一段字，把像素读回来", "每块 GPU / 每版驱动 / 每套字体的抗锯齿都不一样"]
  - 硬件: ["WebGL 报出 renderer 字符串", "显卡型号要和 UA 声明的系统对得上"]
  - 行为: ["鼠标轨迹、点击节奏、停顿", "人是抖的，脚本是均匀的"]
  - 上下文: ["TLS 指纹、HTTP/2 头顺序、cookie 连续性", "换一层就全对不上"]
```

四条里前两条最要紧，因为它们说明**值不是常量**：

- 同一段脚本，在你的 Mac 上和在 Linux 容器里，算出来的值不同。
- 你在 Node 里跑同一个函数，它拿到的 canvas 是假的、字体是空的、时区是 UTC，算出来的值是**第三种**。
- 结果对不上，WAF 不会告诉你差在哪，只会再发一次题。

Akamai 的做法更彻底：它不是一次性计算，而是让页面里的脚本持续采集环境信号和行为时序，交给服务端打分，再拿分数和 UA、系统、cookie 历史做交叉验证。文档里把这叫 sensor data。所以「跑一遍脚本」连理论上都不成立：它要的是一段**时间**。

极验那类滑块更直白。它的官方说明是：判断依据是操作路径、点击节奏、滑动轨迹，这些特征「机器极难伪造」。

```callout
tone: red
icon: ⚠
text: |
  ==这段脚本没有自己的答案。它算的就是你。==

  所以「破解脚本」这个方向一开始就错了：脚本是公开的，难的是它读的那些东西。
  一个没有显卡、没有字体、没有鼠标进程的客户端，跑出来的值天生就是错的。
```

## 07 · 那就在真浏览器里交一次

方向转过来：不去伪造答案，而是让一个真的浏览器把答案算出来，然后把结果带走。做法只有两条。

```flow
grid: true
nodes:
  - { id: need, label: 需要一个真浏览器会话, sub: 登录态 + 指纹都在里面, row: 0, kind: frontend }
  - { id: pass, label: 页面打开，挑战跑完, sub: 静默或整页刷新都算, row: 1, kind: frontend }
  - { id: page, label: 在页面里发请求, sub: "fetch + credentials: include", row: 2, kind: backend }
  - { id: node, label: 在 Node 里发请求, sub: 带上取出来的 cookie, row: 2, kind: backend }
  - { id: out, label: 数据, row: 3, kind: database }
edges:
  - { from: need, to: pass }
  - { from: pass, to: page, label: 留在页面里, labelDy: -16 }
  - { from: pass, to: node, label: 取 cookie 离场, labelDy: 16 }
  - { from: page, to: out }
  - { from: node, to: out }
```

两条路的区别只在「谁发后续请求」，收益是同一个：**通行证是在浏览器里产生的**。

- 留在现场：请求由页面发出，同源、带 cookie、带指纹，最不容易出问题。代价是每次都要驱动浏览器。
- 取 cookie 离场：把浏览器当一次性的「交卷机」，之后用 Node 批量请求。代价是 cookie 会过期。

过期这件事不能靠感觉。两个具体数字：

| 来源 | 有效期 | 说明 |
|---|---|---|
| Azure WAF 的 JS 挑战 | 5–1440 分钟，默认 30 | 策略里配的，过期要重新挑战 |
| Cloudflare 的 JavaScript Detections | 15 分钟 | 过期前会重新注入，不是等你过期才补 |

还有一条容易被忽略的：**换 IP 会重新挑战**。微软的文档写得很直接：客户端答完题之后如果 IP 变了，挑战会重新下发。所以「在一台机器上取 cookie，拿去另一台机器用」这条路，在不少站上是走不通的。

这也是 `analyze` 输出的 `anti_bot` 字段存在的意义：它在你动手之前就告诉你挂的是哪家、下一步该走哪条路。

```compare
first: analyze 的输出
head: [它在说什么, 你接下来做什么]
rows:
  - "`anti_bot.detected = true`": ["挂的是哪家 WAF，以及它给的一句处理建议", "按这句走：先在浏览器上下文里探，再决定 cookie 策略"]
  - "`pattern`": ["数据从哪来：A 走 API、B 读首屏内嵌数据、C 抓 HTML、D 要鉴权", "决定读哪里，不决定要不要过挑战"]
  - "`api_candidates[].verdict`": ["这条响应像不像真数据", "`likely_data` 才值得拿去 replay"]
```

有个反直觉的实测结果：对一个确实挂着 Cloudflare 的站跑 `analyze`，`anti_bot.detected` 是 `false`。

```callout
tone: violet
icon: 🧭
text: |
  ==挑战成功是无声的。==

  浏览器已经把那段脚本跑完、cookie 也种上了，页面干净得像什么都没发生。
  只有失败的时候才会留下痕迹：403、滑块页、或者一个空壳 HTML。

  ++所以判断「这个站有没有反爬」，不能只看页面长得正不正常。++
```

```summary
title: 一句话
text: |
  WAF 不判断你是谁，只判断这道题你答过没有。题是公开的，答案长在机器上。
  所以别去解题，==让真浏览器答一次，把通行证带走==。
```

逛完这篇可以接着看 [opencli 做了什么](../opencli-adapter-anatomy/)：`analyze` 那条命令具体采了哪些信号、怎么打分。

```quiz
- q: curl 拿到的是「挑战页」，为什么它永远过不了这一关？
  a: |
    因为它拿到的是文本，不是可执行的程序。挑战的第二步要求「算出一个值写进 cookie」，
    而 curl 没有 JS 引擎、没有 canvas、没有字体、没有鼠标事件，它连输入都凑不齐。
    下一次请求仍然没有 cookie，WAF 就再发一次题，循环不会结束。
- q: 把挑战脚本抄下来，在 Node 里跑一遍，为什么算出来的值也不对？
  a: |
    因为脚本算的不是自己，是运行它的环境：canvas 渲染出的像素、WebGL 报出的显卡、
    安装的字体、当前时区、鼠标轨迹。Node 里这些东西是缺失或伪造的，
    算出的值是第三种，和真机不一致，WAF 照样拒绝。
- q: 为什么「在一台机器上取到 cookie，复制到另一台机器用」经常失效？
  a: |
    这类 cookie 通常绑定了 IP、浏览器指纹和会话。官方文档明确写了 IP 变化会重新挑战；
    Akamai 那类还会校验 cookie 与当前会话的连续性。所以跨机器、跨出口复用基本不成立，
    只能在同一会话里尽快用掉。
- q: 页面显示完全正常，能说明这个站没有反爬吗？
  a: |
    不能。Cloudflare 的 JavaScript Detections 就是静默的：脚本在隐藏 iframe 里跑，
    页面照常渲染，结果写进 cf_clearance。判断依据只能是请求里有没有那个 cookie，
    以及接口响应是否真的带数据。
```
