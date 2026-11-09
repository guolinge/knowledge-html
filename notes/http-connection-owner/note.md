> 页面里 `fetch("/user")` 和 `new EventSource("/events")` 是两个不同的调用点，它们拿到的响应最后都走在同一条 HTTP/2 连接上。既然字节共用一条 TCP 连接，回来的数据凭什么不会串？
>
> 这篇回答三件事：谁在操作 HTTP、一条连接怎么分给多个请求、连接在什么条件下关闭。

## 01 · 执行 HTTP 的不是协议，是程序

TCP 和 HTTP 都是规则。规则的执行者是具体的程序：TCP 由操作系统的协议栈执行，HTTP 由拿到连接的代码执行 —— 浏览器里的网络组件、`curl`、`nginx`、Go 的 `net/http`。

所以「HTTP 收到数据以后，怎么找到那个 JSON 解释器」这个问题里，没有「找」这个动作可讲。原因在时序：==请求发出去之前，调用方就已经和它绑好了。==

```compare
first: 页面里的写法
head: [谁发出请求, 谁决定怎么读响应体]
rows:
  - "`fetch('/user')`":
      - 浏览器网络组件
      - 你的代码：调 `.json()`、`.text()`，或者直接读 `Response.body` 这条流
  - "`new EventSource('/events')`":
      - 浏览器网络组件（HTML 规范里，这一步就是一次 Fetch 请求）
      - "`EventSource` 自己：按 SSE 规则逐行解释"
  - script 标签加载的脚本:
      - 浏览器网络组件
      - 浏览器把它交给 JS 引擎执行
  - 地址栏或链接跳转:
      - 浏览器网络组件
      - 浏览器按响应头里的类型选渲染方式
```

这几行里只有「谁决定怎么读」不同，「谁发出请求」是同一个：浏览器的网络栈。下面这张图把这条连接两端的东西都摆出来。

```arch
svg: http-conn-owner
caption: 从左边 `fetch` 的调用点进去。它先在登记表里占一个流编号，数据回来时也靠这个编号回到它。右边服务端同一个道理，只是登记表换成了路由表。
frames:
  - id: browser
    boundary: 0
    label: 浏览器
    kind: logical
    detail: 这两个调用点属于页面，不属于网络栈。它们只是向网络栈要连接、要流。
  - id: stack
    boundary: 1
    parent: browser
    label: 网络栈
    kind: contains
    detail: 组帧、拆帧、按流编号分拣都在这一层。`fetch` 和 `EventSource` 都没有自己的一套。
  - id: server
    boundary: 2
    label: 服务端
    kind: logical
    detail: 路由表在启动时填好，之后每个连接都查同一张表。
parts:
  js:
    label: 网页 JavaScript
    sub: 两个调用点
    detail: "`fetch` 和 `new EventSource` 都是页面主动发起的调用。发起的时候，它们都不知道这次请求会落在哪条连接上。"
  fa:
    label: Promise A
    detail: 调 `fetch` 立刻返回的对象。它代表「这次请求的结果」，但结果还没到。
  es:
    label: EventSource B
    detail: 创建时就开始请求，同时注册好了解析 SSE 的回调。
  reg:
    label: 流的登记表
    detail: ==每次请求分到一个流编号，表里记下「这个编号的结果交给谁」。==这张表只有一份，两个调用点共用。
  h2:
    label: HTTP/2 实现
    detail: 把请求变成帧，把收到的字节整理成帧，再按帧头里的流编号交给表里对应的那一项。
  sockb:
    label: socket
    detail: 一个文件描述符。TCP 的字节从它进出，但它不认识 HTTP，也不认识 JSON。
  socks:
    label: socket
    detail: 服务端 `accept` 出来的一条连接，每个连接一个 fd。
  h2s:
    label: HTTP/2 实现
    detail: 与浏览器侧同一类组件。它把帧还原成方法、路径和头部，再交给路由。
  router:
    label: 路由表
    detail: 启动时把 `GET /user` 和 `getUser` 绑在一起。请求进来时查表，不是去搜索代码。
  handler:
    label: getUser 处理函数
    detail: 被调用，返回数据。响应沿同一条路回去，字节再按流编号分一次。
bodies:
  reg:
    badge: 每个连接一张
    rows:
      - ["流 1", "Promise A"]
      - ["流 3", "EventSource B"]
    note: 编号由发起方分配，回来时按它查表
tours:
  - id: binding
    label: 一个请求怎么绑上它的调用方
    steps:
      - at: [js, fa]
        text: 页面调用 `fetch("/user")`，拿到一个 Promise。这个时候请求还没发出去。
      - at: [reg, fa]
        text: 网络栈给这次请求分配一个流编号，在表里记一行：流 1 交给这个 Promise。
      - at: [es, reg]
        text: 另一个调用点 `new EventSource("/events")` 走同一张表，占流 3。
      - at: [h2, sockb]
        text: 两条流各自变成帧，写进同一个 socket。TCP 只负责把这些字节按顺序送到对端。
      - at: [h2s, router, handler]
        text: 服务端拆帧，看到 `GET /user`，查路由表命中 `getUser`，再调用它。
      - at: [reg, fa, es]
        text: 响应回来时，浏览器按帧头里的流编号查同一张表，把数据交回对应的调用点。
  - id: server-side
    label: 服务端为什么能立刻找到处理函数
    steps:
      - at: [handler, router]
        text: 处理函数在启动时注册进路由表。之后每个请求都只是查表，不是现找。
      - at: [h2s, router]
        text: 请求到达时先还原成方法、路径，再拿这两个值查表。少了这一步，服务端也不知道该跑哪段代码。
```

图上这两侧是同一种结构：**拿数据的一方，都是提前登记过的。** 浏览器登记的是流编号，服务端登记的是路径。

表里的「流」是这条连接里的一条逻辑通道，一次请求占一条。

`Content-Type` 不参与这个选择。同一个地址，`fetch` 拿到的是一段文本，`EventSource` 拿到的是一串事件；差别来自调用者是谁，不来自响应头。

`EventSource` 那一行值得单独说：HTML 规范里，它发起的就是一次 Fetch 请求 —— 和小节标题里那个 `fetch` 走同一套机制。所以它没有第二套 HTTP 实现，只在响应体上多了一个 SSE 解析器。

## 02 · 一条连接分给两个请求，凭什么不串

上图画的是位置关系。真正让人不放心的是字节交错的时候会发生什么，所以走一遍到达顺序。

HTTP/2 把请求和响应切成带头的片段，叫帧（frame）。每个帧开头写着它属于哪条流，接收方据此分开。帧的字节长什么样（9 字节帧头、流编号在哪几位）在[从字节看懂 HTTP/1.1 与 HTTP/2](../http-binary-framing/)里逐字节拆过。

```demo
widget: stepper
title: 同一条 TCP 连接上，两条流的帧依次到达
actions: false
config:
  steps:
    - label: ① HEADERS 流 1
      code: 'HEADERS  stream=1  :method=GET  :path=/user'
      note: 流 1 的响应头到了。Response 对象这时已经有了，响应体还在后面。
    - label: ② HEADERS 流 3
      code: "HEADERS  stream=3  :status=200\ncontent-type: text/event-stream"
      note: 流 3 的响应头。EventSource 检查状态码和类型，合格才开始解析。
    - label: ③ DATA 流 1
      code: 'DATA  stream=1  {"name":'
      note: 流 1 的响应体只到一半。
    - label: ④ DATA 流 3
      code: 'DATA  stream=3  data: hello'
      note: 另一条流的数据插在中间。TCP 不知道这些字节属于谁。
    - label: ⑤ DATA 流 1
      code: 'DATA  stream=1  "小林"}'
      note: 流 1 的后半段。两段接起来才是完整 JSON。
    - label: ⑥ END_STREAM 流 1
      code: 'DATA  stream=1  END_STREAM'
      note: 这条流结束。response.json() 这时才能解析成功。
    - label: ⑦ DATA 流 3
      code: 'DATA  stream=3  data: world'
      note: 流 3 没有结束。SSE 一直开着，连接也一直开着。
```

三层各管一段：

| 层 | 这一层负责什么 | 这一层不管什么 |
|---|---|---|
| TCP | 字节的先后顺序 | 这些字节属于哪个请求 |
| HTTP/2 实现 | 每个帧属于哪个流（帧头里有 31 位的流标识） | 这个流的数据要交给页面里的谁 |
| 登记表 | 流 1 交给 Promise A，流 3 交给 EventSource B | 数据是 JSON 还是 SSE |

```callout
tone: amber
icon: ⚠
text: |
  !!流编号不表示响应是什么内容。!!它是一个由发起方分配的整数（客户端用奇数），作用只是让帧和发请求时登记的那一条对上。

  数据交给调用方之后才被解析：`.json()` 按 JSON 规则读，`EventSource` 按 SSE 规则读。
```

还有一层要说清：如果这两次请求各走一条 TCP 连接，这张表根本不需要 —— 一个 socket 只有一个主人。**共用连接省下了握手和慢启动，代价就是多一层分拣。**

## 03 · HTTP/1.1 的六条连接是六条什么

HTTP/1.1 没有流编号。它的规范 RFC 9112 §9.2 把这个限制写得很直接：它不包含用来关联请求和响应的标识，只能靠响应到达的顺序；客户端必须维护一张未完成请求的列表，按发送顺序把每个响应配给最早的、还没拿到最终响应的那个请求。

那张列表就是 HTTP/1.1 的登记表，一条队列。一条连接上同一时刻只有一个响应在传，因为多传就没法按顺序认领。

```raw
<div class="ow">
  <div class="ow-case">
    <div class="ow-head">
      <span class="tag tone-blue">HTTP/1.1</span>
      <b>同时 6 个请求，开 6 条连接</b>
      <small>一条 HTTP 连接对应一条 TCP 连接，所以并行只能靠多开。</small>
    </div>
    <div class="ow-axis">每条连接各自占一条 TCP 连接</div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 1<em>GET /a.js</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 1 · TCP 1</div></div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 2<em>GET /b.css</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 2 · TCP 2</div></div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 3<em>GET /c.png</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 3 · TCP 3</div></div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 4<em>GET /user</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 4 · TCP 4</div></div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 5<em>GET /events</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 5 · TCP 5</div></div>
    <div class="ow-band"><div class="ow-blk tone-blue grow">连接 6<em>GET /d.json</em></div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 6 · TCP 6</div></div>
  </div>
  <div class="ow-case">
    <div class="ow-head">
      <span class="tag tone-violet">HTTP/2</span>
      <b>同一批请求，共用 1 条连接</b>
      <small>每条流一个编号，帧交错着走同一条 TCP 连接。</small>
    </div>
    <div class="ow-axis">一条 HTTP 连接，仍然只对应一条 TCP 连接</div>
    <div class="ow-band"><div class="ow-blk tone-violet">流 1</div><div class="ow-blk tone-violet">流 3</div><div class="ow-blk tone-violet">流 5</div><div class="ow-blk tone-violet">流 7</div><div class="ow-blk tone-violet">流 9</div><div class="ow-blk tone-violet">流 11</div><div style="display:flex;align-items:center;font:600 13px var(--mono);color:var(--muted)">→</div><div class="ow-fill">socket 1 · TCP 1</div></div>
  </div>
</div>
```

「6」不是一个标准值。MDN 的描述是：早期浏览器对每个域名开 2 到 3 条，后来普遍涨到 6 条。它是浏览器的实现选择，具体数字看版本。

```compare
first: 问题
head: [HTTP/1.1, HTTP/2, HTTP/3]
rows:
  - 一条连接上同时能传几个响应:
      - 一个，按顺序
      - 多个流交错
      - 多个流交错
  - 同时发 6 个请求要几条传输连接:
      - 6 条 TCP
      - 1 条 TCP
      - 1 条 QUIC，走 UDP
  - 响应靠什么认领:
      - 到达顺序
      - 帧头里的流编号
      - QUIC 的流编号
  - 一条 HTTP 连接对应几条传输连接:
      - 一条
      - 一条
      - 一条 QUIC 连接，没有 TCP
```

最后一行的依据是 RFC 9112 §9.1 的原文：每条 HTTP 连接对应一条底下的传输连接（"Each HTTP connection maps to one underlying transport connection"）。所以那 6 条 HTTP/1.1 连接是 6 条 TCP 连接，不是 6 条 HTTP 叠在 1 条 TCP 上。

```callout
tone: violet
icon: 🧭
text: |
  **这个 1:1 说的是「每一段」。**

  经过代理时，浏览器到代理是一条 HTTP 连接，代理到源站是另一条，两条各自对应自己的传输连接。端到端看过去是两段，不是一条 HTTP 连接横跨两条 TCP。

  HTTP/3 换掉了传输层：RFC 9114 把 HTTP 语义映射到 QUIC 上 —— QUIC 是 HTTP/3 用的传输协议，跑在 UDP 上，自己管流和重传。那里没有 TCP 连接可对应。
```

## 04 · 一次响应读完，连接并不关

现在的连接默认留着复用：HTTP/1.1 的规范 RFC 9112 §9.3 写明它默认使用持久连接（persistent connection），一条连接上可以跑多个请求和响应。空下来的连接不是丢掉，而是放回浏览器内部的一组里等下一个请求，这组连接叫连接池。

既然留着，就必须能自己判断「这次响应到哪结束」，否则后面的字节会被当成下一个响应。判断方式按协议不同：

```compare
first: 情形
head: [HTTP/1.1 怎么判断, HTTP/2 怎么判断]
rows:
  - 响应头写了 `Content-Length`:
      - 读够这么多字节
      - 帧头自带长度，收到带 `END_STREAM` 标志的帧才算这条流结束
  - "响应头写了 `Transfer-Encoding: chunked`":
      - 一直读到长度为 0 的那一块
      - 同上
  - 两个都没有:
      - 只能等服务端关闭连接（HTTP/1.0 的兼容做法）
      - 不出现这种情况：帧必然有边界
  - 读完这一刻:
      - 连接不关，回到连接池等下一个请求
      - 这条流关闭，连接和别的流继续
```

==读到本次响应的结尾，只说明这一次传完了；连接关不关是另一件事。==

HTTP/2 里「一条流结束」和「整条连接结束」差得更远：`END_STREAM` 只是把这一条流送进 closed，同一条连接上其他流照常收发。一条流的两个方向各自结束，两个都结束了，这条流才彻底关闭。

## 05 · 连接什么时候关

连接关闭有几种来源，发起的时机和后果不一样。一条连接会服务多个请求，所以它有明确的状态。从建好到关掉，中间只有这几种转移：

```compare
first: 发生什么
head: [从哪个状态, 到哪个状态]
rows:
  - 发出请求:
      - 连接建好，空闲
      - 请求在途
  - 读到本次响应的结尾（长度读满、读到 0 块、收到 `END_STREAM`）:
      - 请求在途
      - 响应读完，连接进池
  - 又来一个请求:
      - 响应读完，连接进池
      - 请求在途
  - 空闲超时、被连接池淘汰、对端发来 `GOAWAY`:
      - 响应读完，连接进池
      - 连接关闭
  - 取消、协议出错、链路断开:
      - 请求在途
      - 连接关闭
```

这个表里有两次「连接关闭」，但发起方不同。下一张表把它们分开。

```compare
first: 谁发起
head: [怎么表示, 正在传的请求会怎样]
rows:
  - 服务端要关（维护、缩容）:
      - "HTTP/1.1 响应头带 `Connection: close`；HTTP/2 发 `GOAWAY` 帧"
      - 1.1：本次响应传完才关；2：`GOAWAY` 带上最后处理过的流编号，编号更大的流没被处理，可以重试
  - 浏览器空闲超时:
      - 直接关闭底层 socket
      - 只有没有在途请求时才会走到这一步
  - 服务端空闲超时:
      - 直接关闭底层 socket（nginx 的 `keepalive_timeout` 默认 75 秒）
      - 客户端下一个请求会失败，需要重连
  - 取消请求或协议出错:
      - 1.1：关掉整条连接；2：发 `RST_STREAM`，只关这一条流
      - 1.1：后面的字节没法认领；2：其他流不受影响
  - 链路断开:
      - TCP 的 `FIN` / `RST`，或者超时
      - 两种协议都直接看到连接没了；HTTP/2 里没传完的流需要重试
```

为什么 HTTP/1.1 取消一个请求要关掉整条连接：响应只能按到达顺序对应请求，中间丢了一段，后面的字节就配不上任何一个请求。HTTP/2 有 `RST_STREAM`，它把一条流直接送进 closed，同一条连接上的其他流继续。

`GOAWAY` 值得单看一眼，因为它回答了「服务端要下线，正在跑的请求怎么办」：

```callout
tone: violet
icon: 🧭
text: |
  `GOAWAY` 里带着**最后处理过的流编号**。编号比它大的流，服务端要么没收到、要么没开始处理，客户端可以换条连接重试。

  HTTP/2 的规范 RFC 9113 §6.8 建议关连接之前先发 `GOAWAY`：不发的话，客户端不知道那个 POST 到底有没有被处理过。

  常见做法是发两次：第一次把编号放到最大（2³¹-1），意思是「先别开新流」；等手头的流跑完，再发一次带真实编号的，然后关传输连接。
```

## 06 · 三句带走

1. 执行 HTTP 的是程序，不是协议。请求发出去之前，「结果交给谁」已经写进了登记表 —— 浏览器写流编号，服务端写路径。
2. 一条连接分给多个请求，靠的是流编号。HTTP/1.1 没有编号，只能靠顺序，所以并行就要多开连接。
3. 一次响应结束和连接关闭是两件事。关闭有协议信号（`Connection: close`、`GOAWAY`、`RST_STREAM`），也有超时和断链。

```quiz
- q: 同一个页面里，`fetch` 和 `EventSource` 各自有一套 HTTP 实现吗？
  a: |
    没有。浏览器只有一套网络栈，两者都向它要连接；HTML 规范里，`EventSource` 发起的请求就是一次 Fetch 请求。

    区别在拿到响应体之后：`fetch` 把响应体交给你的代码决定怎么读，`EventSource` 按 SSE 规则逐行解析。
- q: 一条 HTTP/2 连接上同时有两条响应在传，浏览器靠什么分清哪段字节属于谁？
  a: |
    帧头里的流编号。发请求时已经登记了「流 1 交给这个对象」，数据到达时按编号查表。

    TCP 只保证字节顺序，不认识这个编号；`Content-Type` 也不负责把响应交给谁。
- q: 一条 HTTP/1.1 连接上，浏览器怎么知道这次响应读完了？
  a: |
    有 `Content-Length` 就读够那么多字节；有 `chunked` 就等长度为 0 的那一块；两个都没有时，只能等服务端关闭连接。

    读完这次响应不会关闭连接 —— 连接默认留着复用，直到空闲超时或者某一方发了 `Connection: close`。
```
