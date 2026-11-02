在浏览器里访问一个地址，客户端和服务器要交换 HTTP 请求与响应。底下的 TCP 负责传送字节，但它不会替 HTTP 标出“这一条请求到哪里结束”。

这篇用同一组可核对的字节，回答四个问题：字节和字符有什么关系？HTTP/1.1 怎么确定头部与消息体？`chunked` 在哪一层工作？HTTP/2 的帧又怎样分开、归属到不同请求？

先认识三个东西：**字节**是这里最小的计数单位，一个字节有 8 位；**报文**是一次 HTTP 请求或响应；**帧**是 HTTP/2 组织数据的单位，一条请求或响应可以由多个帧组成。

```arch
svg: http-wire
maxScale: 1.35
caption: 从左边的 TCP 字节流看起。上下是两种不同的协议场景，不是让一条连接同时使用两个版本；图中只展示连接的一个方向。
frames:
  - id: tcp
    boundary: 0
    kind: contains
    label: TCP 传给应用什么
    detail: 每个方向提供有序字节流，不提供 HTTP 报文边界。连接也可能因错误提前结束。
  - id: http
    boundary: 1
    kind: classification
    label: HTTP 怎样解释字节
    detail: 两个版本都表达请求、响应、字段和消息体，但编码、边界和多请求的组织方式不同。
bodies:
  wire:
    badge: 传输层
    rows:
      - { k: 交给应用, v: 有序字节 }
      - { k: 读到多少, v: 每次不固定 }
      - { k: 报文边界, v: 由 HTTP 判断 }
    note: 连接有两个方向，图中只看一个
  h1:
    badge: 报文
    rows:
      - { k: 起始行与字段, v: 按行读取 }
      - { k: 头部结束, v: 空行 }
      - { k: 消息体, v: 长度或分块等规则 }
    note: 空行不一定是整条报文的结尾
  h2:
    badge: 帧
    rows:
      - { k: 每帧开头, v: 固定 9 字节 }
      - { k: 前 3 字节, v: 本帧载荷长度 }
      - { k: 流编号, v: 识别帧的归属 }
    note: 帧长不是整条 HTTP 消息体的长度
  r1:
    badge: 响应顺序
    rows:
      - { k: 请求, v: 可以流水线发送 }
      - { k: 响应, v: 同连接按请求顺序 }
      - { k: 正文, v: 可以分批传送 }
    note: 不同响应的字节不能交错
  r2:
    badge: 多路复用
    rows:
      - { k: 一条连接, v: 多条逻辑流 }
      - { k: 不同流, v: 帧可以交错 }
      - { k: 结束发送, v: END_STREAM 标志 }
    note: 帧边界与消息结束是两件事
parts:
  wire:
    label: TCP 的有序字节流
    sub: 一次读取不是一条消息
    detail: 假设连接正常，TCP 按顺序交付字节。发送端一次写入的数据，接收端可能分多次读到；多次写入也可能被一次读到。
    facts: { 单位: 字节, "read 边界": 不代表报文边界, 方向: 各自有序 }
  h1:
    label: HTTP/1.1 报文
    sub: 先找头部结束，再确定消息体长度
    detail: 起始行和头字段按行读取；空行结束头部。消息体是否存在以及如何结束，还要看请求方法、状态码和长度字段等规则。
    facts: { 头部: 起始行 + 字段 + 空行, 消息体: 长度 / 分块等, 表达: 多数头部文字可读 }
  h2:
    label: HTTP/2 帧
    sub: 固定帧头加可变长度载荷
    detail: 每帧的 9 字节帧头包括长度、类型、标记和流编号。判断这一帧的边界不必在载荷里找分隔符；处理帧时仍需按类型解析必要内容。
    facts: { 帧头: 9 字节, 长度: 载荷的字节数, 归属: 流编号 }
  r1:
    label: HTTP/1.1 响应按序
    sub: 可以先发送多个请求，响应仍按顺序发回
    detail: 同一连接上的响应不能把各自的正文交错在一起，但一个响应本身可以流式地分多次发送。
    facts: { 请求流水线: 可以, 响应顺序: 与请求一致, 响应正文: 可分批 }
  r2:
    label: HTTP/2 多条流
    sub: 给帧编号后，接收方知道交给哪条流
    detail: 一条连接可以有多条流，不同流的帧按协议规则交错。每条流的请求和响应分别标记发送结束；TCP 丢包造成的阻塞仍可能影响整条连接。
    facts: { 帧归属: 流编号, 结束: END_STREAM, 传输层: 仍是 TCP }
tours:
  - id: path
    label: 从字节到消息
    steps:
      - at: [wire]
        text: TCP 把一个方向的数据交成有序字节流，一次读取的大小不代表一条请求。
      - at: [wire, h1]
        text: 在 HTTP/1.1 场景中，接收方先按行找到头部空行，再根据规则确定消息体边界。
      - at: [h1, r1]
        text: 一条连接可以复用，也可以流水线发送请求；响应仍要按请求顺序返回。
      - at: [wire, h2]
        text: 在 HTTP/2 场景中，接收方读取固定 9 字节帧头，再按其中的长度消费载荷。
      - at: [h2, r2]
        text: 帧头的流编号告诉接收方帧属于谁，不同流的帧可以按规则交错。
```

## 01 · 字节、十六进制和字符

先看 `GET` 的三个字节。下面三行只是同一份数据的不同展示方式：

```text
二进制写法     01000111   01000101   01010100
十六进制写法      47         45         54
按 ASCII 显示      G          E          T
```

例如，一个字节的值 `0x47`，按 ASCII 解释是 `G`。`47` 是十六进制**写法**，不代表传输了字符 `4` 和 `7`；那两个字符分别是字节 `0x34` 和 `0x37`。

ASCII 还约定了控制字符。回车是 `0x0d`，换行是 `0x0a`，两个连起来常写成 `\r\n`。==`\r\n` 是方便阅读的记号，实际是两个字节，不是反斜杠和字母组成的四个字节。==

```compare
first: 字节
head: [按 ASCII 看, 说明]
rows:
  - '`47`': ['`G`', 可打印字符]
  - '`20`': [空格, 可打印字符]
  - '`0d 0a`': ['`\r\n`', 回车加换行，不能直接显示成图形]
  - '`2e`': ['`.`', 真的英文句点]
```

### 十六进制转储左边的数字是什么？

下面是一次请求的开头。中间每两个十六进制数字代表一个字节；右边是按 ASCII 显示的样子。

```text
0000  47 45 54 20 2f 68 65 6c 6c 6f 20 48 54 54 50 2f  |GET /hello HTTP/|
0010  31 2e 31 0d 0a 48 6f 73 74 3a 20 31 32 37 2e 30  |1.1..Host: 127.0|
```

`0000`、`0010` 是工具加的**偏移量**：本行第一个字节从整份数据的哪里开始。偏移从 0 数起，用十六进制表示；`0x10` 等于十进制 16，所以第二行从第 16 个字节开始。偏移量本身没有在请求里传输。

右侧的 `.` 有时是不可打印字节的占位符，有时是真正的句点 `0x2e`，要结合中间一列看。本页的互动字节带用 `·` 标示不可打印字节，真实句点仍显示为 `.`。

```callout
tone: muted
icon: 📌
text: |
  这份请求的字母和标点可以按 ASCII 阅读，行尾还有不可打印的回车、换行。文本也不只限于 ASCII；例如中文通常会用 UTF-8 等编码。HTTP 消息体还可能是一张图片或其他任意字节。
```

## 02 · TCP 交付字节，不交付 HTTP 消息

TCP 在连接的每个方向上提供有序字节流。假设发送方一次写入以下内容：

```text
GET /hello HTTP/1.1\r\n
```

接收方完全可能分三次读到：

```text
第 1 次读取    GET /he
第 2 次读取    llo HTTP/1.
第 3 次读取    1\r\n
```

这是一个**示意**，三段拼起来还是发送方写出的字节。实际每次读到多少取决于缓冲区、数据到达时机等；一次读取也可能包含多次写入的数据。

```cards
cols: 2
items:
  - title: TCP 负责传输
    tone: blue
    body: |
      在连接正常时按顺序交付字节，并处理传输中的丢失和重传。连接也可能失败，应用需要处理提前结束或错误。
  - title: HTTP 负责解释
    tone: violet
    body: |
      HTTP 接收字节、保存解析进度，并按协议判断头部、消息体或帧的边界。不能把一次 `read` 当成一条完整报文。
```

发送方调用 `write` 的次数、TCP 分段、接收方调用 `read` 的次数，以及 HTTP 的消息或帧边界，是不同层面的事情。HTTP/1.1 和 HTTP/2 都要面对这个字节流。

## 03 · HTTP/1.1：空行之后，还要判断消息体

一条 HTTP/1.1 **请求报文**通常由起始行、头部字段、空行和可选的消息体组成。下面的 `\r\n` 用来标出真实的行尾；额外的排版换行、箭头和中文注释都不是传输的内容。

```text
GET /hello HTTP/1.1\r\n              ← 起始行
Host: 127.0.0.1:18080\r\n             ← 头部字段
User-Agent: curl/8.7.1\r\n            ← 头部字段
Accept: text/html\r\n                 ← 头部字段
\r\n                                  ← 空行：头部结束
```

起始行里的 `GET` 是方法，`/hello` 是请求目标，`HTTP/1.1` 是版本。ASCII 告诉我们字节对应什么字符；**HTTP 的语法**告诉我们这些字符各代表什么。

先在下面选“按行解析”，再点“下一步”。这是本机 `curl 8.7.1` 发出的那 89 个字节；另一种读法可以对照字符和控制字节。

```demo
widget: byte-walker
title: 89 字节的请求：从字符走到 HTTP 结构
hint: 切换读法，再用上一步 / 下一步沿字节走
actions: false
config:
  bytes: "474554202f68656c6c6f20485454502f312e310d0a486f73743a203132372e302e302e313a31383038300d0a557365722d4167656e743a206375726c2f382e372e310d0a4163636570743a20746578742f68746d6c0d0a0d0a"
  lenses:
    - label: 按行解析
      sub: 看每一行在请求中的作用
      tone: violet
      steps:
        - span: [0, 20]
          tag: 起始行
          note: |
            以 `0d 0a` 结束。HTTP 按规则读出方法 `GET`、目标 `/hello` 和版本 `HTTP/1.1`。
        - span: [21, 43]
          tag: Host 字段行
          note: |
            `Host` 字段给出请求的目标主机和端口；末尾同样是 `0d 0a`。
        - span: [44, 67]
          tag: User-Agent 字段行
          note: |
            字段值是 `curl/8.7.1`；高亮包括这行末尾的两个控制字节。
        - span: [68, 86]
          tag: Accept 字段行
          note: |
            字段值是 `text/html`。最后的 `0d 0a` 结束这一行，但此时还要看后面有没有空行。
        - span: [85, 88]
          tag: 头部结束
          note: |
            前两个字节结束 `Accept` 行，后两个字节是空行。这条请求没有 `Transfer-Encoding` 或 `Content-Length`，因此按规则没有消息体；89 个字节就是整条请求。
    - label: 看字节与字符
      sub: 看同一批字节如何显示
      tone: blue
      steps:
        - span: [0, 2]
          tag: 三个字节，三个字母
          note: |
            `47 45 54` 按 ASCII 显示为 `GET`；数字和字母是同一份数据的两种展示。
        - span: [3, 3]
          tag: 空格
          note: |
            `0x20` 是空格。HTTP 在这一行用空格分隔方法、请求目标和版本。
        - span: [19, 20]
          tag: 控制字符
          note: |
            `0d 0a` 是回车和换行，不是可打印字符；右边用 `·` 占位。
        - span: [30, 30]
          tag: 真正的句点
          note: |
            这里的 `0x2e` 是 IP 地址里真实的 `.`，不是控制字符的占位符。
```

### 空行结束的是头部，不一定是整条报文

最后一个字段行的结尾是 `\r\n`；紧跟着的空行又是一个 `\r\n`。所以常在字节里看到 `0d 0a 0d 0a`。如果消息有 body，body 从这之后开始，但**不能只靠空行知道它有多长**。

下面是正常报文中的常见判断，按适用情况选择，不是完整的异常处理流程：

```compare
first: 场景
head: [消息体怎样结束, 例子或条件]
rows:
  - 对 HEAD 的响应，或状态码为 1xx / 204 / 304 的响应:
      - 空行之后这条响应结束，没有消息体
      - "HEAD 是请求方法；某些响应即使带 Content-Length 也没有消息体"
  - 使用 chunked 的普通报文:
      - 按每块长度读取，直到结束块和尾部结束
      - '`Transfer-Encoding: chunked`'
  - 有有效 Content-Length 的普通报文:
      - 空行之后读取 N 个字节
      - '`Content-Length: 5` 对应 5 字节内容'
  - 请求没有 Transfer-Encoding，也没有 Content-Length:
      - 消息体长度为 0
      - 本节的 89 字节 GET 请求
  - 普通响应没有上述长度信息:
      - 读到连接关闭
      - 只适用于需要以连接关闭确定边界的响应
```

这个表省略了成功的 `CONNECT` 响应切换为隧道、无效长度等特殊情形。完整优先级见 [RFC 9112 §6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3)。

`Content-Length` 里的数按**十进制**理解，单位是字节，不是字符。例如 `hello` 是 5 个 ASCII 字节；`你好` 用 UTF-8 编码是 6 个字节。

## 04 · chunked：HTTP 自己给每块写长度

当发送方开始发送时还不知道消息体总长度，可以使用 HTTP/1.1 的 `Transfer-Encoding: chunked`。它把内容编码成若干块，每块先写长度，再写数据；最后用长度为 0 的块收尾。

假设应用要发送 `Hello world`。下面是**编码后的消息体**；`\r\n` 仍代表两个真实字节，排版换行不另计：

```text
5\r\n
Hello\r\n
6\r\n
 world\r\n
0\r\n
\r\n
```

```lane-stack
- badge: 第 1 块
  title: "5 → Hello"
  desc: 长度是 5，接收方读取后面的 5 个字节
  tone: blue
  nodes:
    - { title: 大小行, sub: "5\\r\\n", tag: 长度 5 }
    - { title: 数据, sub: Hello, tag: 5 字节 }
    - { title: 块后行尾, sub: "\\r\\n", tag: 2 字节 }
  next: "继续读下一块 :: :: 接收方已经知道第一块结束在哪里"
- badge: 第 2 块
  title: "6 → 空格 + world"
  desc: 前面的空格也是内容，所以一共 6 个字节
  tone: violet
  nodes:
    - { title: 大小行, sub: "6\\r\\n", tag: 长度 6 }
    - { title: 数据, sub: "␠world", tag: 6 字节 }
    - { title: 块后行尾, sub: "\\r\\n", tag: 2 字节 }
  next: "没有更多数据 :: :: 仍要读取结束块和尾部结束"
- badge: 结束
  title: "0 → 不再有数据块"
  desc: 本例没有尾部字段，0 行后面的空行标记编码结束
  tone: green
  nodes:
    - { title: 结束块, sub: "0\\r\\n", tag: 长度 0 }
    - { title: 尾部结束, sub: "\\r\\n", tag: 空行 }
```

把大小行、行尾和结束标记去掉，应用拿到的是 `Hello world`，共 11 字节。本机的完整 HTTP/1.1 响应是 99 字节，其中下面展示的分块编码部分占 26 字节。

```demo
widget: byte-walker
title: 一步一步读取两个 chunk
actions: false
hint: 先按接收方的步骤走，再切到“应用拿到的内容”
config:
  bytes: "350d0a48656c6c6f0d0a360d0a20776f726c640d0a300d0a0d0a"
  lenses:
    - label: 接收方逐块读
      sub: 长度行、数据、块结束
      tone: violet
      steps:
        - span: [0, 2]
          tag: 第一块的大小行
          note: |
            `35` 是字符 `5`；按十六进制读出长度 5。后面的 `0d 0a` 结束大小行。
          out: 长度 = 5 字节
        - span: [3, 7]
          tag: 读取第一块数据
          note: |
            接着准确读取 5 个字节，得到 `Hello`。
          out: 已得到 Hello
        - span: [8, 9]
          tag: 第一块结束
          note: |
            读取这块数据后面的 `0d 0a`。它属于分块格式，不属于应用内容。
        - span: [10, 12]
          tag: 第二块的大小行
          note: |
            字符 `6` 表示后面有 6 个字节，行尾仍是 `0d 0a`。
          out: 长度 = 6 字节
        - span: [13, 18]
          tag: 读取第二块数据
          note: |
            这 6 字节是一个空格加 `world`；空格也是内容。
          out: 已得到 Hello world
        - span: [19, 20]
          tag: 第二块结束
          note: |
            第二块数据后的 `0d 0a` 也是分块格式的一部分。
        - span: [21, 23]
          tag: 长度为 0
          note: |
            `0\r\n` 表示没有更多数据块。后面还可能有尾部字段；本例没有。
        - span: [24, 25]
          tag: 尾部结束
          note: |
            没有尾部字段时，再读一个空行；到这里分块编码才完整结束。
    - label: 应用拿到的内容
      sub: 只拼接数据块
      tone: green
      steps:
        - span: [3, 7]
          tag: 内容的前 5 字节
          note: |
            第一块中的 `Hello` 会交给应用。大小行和两侧的行尾不会成为内容。
          out: Hello
        - span: [13, 18]
          tag: 内容的后 6 字节
          note: |
            第二块是空格加 `world`；两块拼起来是 `Hello world`。
          out: Hello world（11 字节）
```

块长度写成**十六进制字符**：例如 `A` 表示十进制 10，字符 `A` 自己的字节值是 `0x41`。解析器读完长度行后，按长度读取数据；即使数据内部包含 `\r\n`，也不会误当成块结束。

```callout
tone: blue
icon: 💡
text: |
  `chunked` 是 ==HTTP/1.1 对消息体的编码方式==，不是 TCP 的发送开关。一个 chunk 可以被分多次 TCP 读取，一个读取也可能包含多个 chunk。已知总长度时，`Content-Length` 也可以用于边生成边发送。
```

## 05 · 找边界的工作与出错的风险

### 扫描头部，不等于扫描整份消息体

HTTP/1.1 的头部没有固定的总长度；接收方要找到每行结尾和结束头部的空行。头部越长，要检查的头部字节通常越多。

但头部解析完之后，如果规则给出 `Content-Length: 8`，接收方就按数量读取 8 个字节；如果是 chunked，就逐块读长度行，再按该块长度读取。**不需要在整段 body 里搜索 `\r\n\r\n` 来找结束位置。** 接收和消费数据本身仍然要花时间，也不能跳到 TCP 中尚未到达的字节。

### body 里有空行，会不会误判？

下面的 body 是 `ab\r\n\r\ncd`。其中 `\r\n\r\n` 确实出现在内容里，但它总共仍是 8 个字节：

```text
Content-Length: 8\r\n
\r\n
ab\r\n\r\ncd

body 的 8 个字节：61 62 0d 0a 0d 0a 63 64
```

正确的解析器已经在第一个空行后进入了“读取 body”的阶段；按长度读满 8 个字节即可。body 中的换行是数据，不会被当成第二个头部结束符。

### 如果长度给错了呢？

假设发送方本来想把 `hello` 作为第一条请求的 body，后面紧接着下一条请求 `GET /next…`。保持字节不变，只改变**假设声明的长度**，看接收方会把哪里当成下一条的开头：

```demo
widget: byte-walker
title: 同一串字节，长度错一位会怎样？
hint: 分别点长度 4、5、6；每个读法再点“下一步”
actions: false
config:
  bytes: "68656c6c6f474554202f6e657874"
  lenses:
    - label: 长度 = 5
      sub: 符合发送方预期
      tone: green
      steps:
        - span: [0, 4]
          tag: 第一条 body
          note: 读取 5 字节，body 是 `hello`。
          out: body = hello
        - span: [5, 7]
          tag: 下一条请求的开头
          note: 接下来的字节从 `GET` 开始，正好是预期位置。
          out: 下一条从 GET 开始
    - label: 长度 = 4
      sub: 声明偏短
      tone: amber
      steps:
        - span: [0, 3]
          tag: 第一条 body
          note: 只读 4 字节，接收方认为 body 是 `hell`。
          out: body = hell
        - span: [4, 7]
          tag: 下一条请求的开头
          note: 原本属于 body 的 `o` 留了下来，后续从 `oGET` 开始，而不是预期的 `GET`。
          out: 下一条从 oGET 开始
    - label: 长度 = 6
      sub: 声明偏长
      tone: red
      steps:
        - span: [0, 5]
          tag: 第一条 body
          note: 如果后续请求已经到达，第 6 个字节 `G` 会被算进前一条 body。
          out: body = helloG
        - span: [6, 7]
          tag: 下一条请求的开头
          note: 剩下的起点变成 `ET`。如果第 6 字节还没到，接收方则会继续等待。
          out: 下一条从 ET 开始
```

在客户端、前端代理和后端服务器之间，如果不同设备对同一段请求使用了不同的边界，后端可能把前端当作 body 的一部分字节解释成另一条请求。这类**请求走私**的关键是解析结果不一致；不是 body 里出现 `\r\n\r\n` 就会发生。

```callout
tone: amber
icon: ⚠
text: |
  发送方不得在同一条 HTTP/1.1 报文中同时发送 `Transfer-Encoding` 和 `Content-Length`。对收到这两个字段的普通请求，`Transfer-Encoding` 优先；服务器可以拒绝，或仅按它处理，但响应后必须关闭连接。选择转发的中间设备还须先移除收到的 `Content-Length`。完整条件见 [RFC 9112 §6.1](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.1) 和 [§6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3)。
```

## 06 · HTTP/2：每帧开头固定 9 个字节

HTTP/2 不再用 HTTP/1.1 的 chunked 格式组织消息体。它把通信数据组织成**帧**：每帧先有固定 9 字节的帧头，后面跟长度可变的载荷。

HTTP/2 仍然可以有 `Content-Length` 头字段，但它和帧头里的 `Length` 不是同一个东西：后者只说明**当前帧的载荷**有多长。

```memmap
title: 先看帧头，再读取载荷
sub: HTTP/2 帧头固定 9 字节；偏移从本帧的第 0 字节开始
segments:
  - label: Length
    sub: 前 3 字节拼成无符号整数，表示本帧载荷有多少字节；不含帧头
    tone: amber
    size: 3
    mark: "偏移 0–2 · 3 字节"
  - label: Type
    sub: "帧类型：DATA、HEADERS、SETTINGS 等"
    tone: blue
    size: 1
    mark: "偏移 3 · 1 字节"
  - label: Flags
    sub: 标志位；每个帧类型定义自己使用的标志
    tone: blue
    size: 1
    mark: "偏移 4 · 1 字节"
  - label: Stream Identifier
    sub: 最高 1 位保留，其余 31 位是流编号；编号 0 用于连接级帧
    tone: violet
    size: 4
    mark: "偏移 5–8 · 4 字节"
note: 9 字节的是帧头；后面还有 Length 指定数量的载荷字节。
```

假设流 1 已由之前的 HEADERS 帧建立，下面是一个 DATA 帧。它的载荷是 `hello`；此例没有填充字节。竖线仅用于分组，不是实际传输的字节。

```text
00 00 05 | 00 | 01 | 00 00 00 01 | 68 65 6c 6c 6f
  长度     类型  标志      流编号           载荷
   5      DATA  结束       1              hello
```

```demo
widget: byte-walker
title: 14 字节的 HTTP/2 DATA 帧
hint: 逐步读取帧头，再看后面的载荷
actions: false
config:
  bytes: "00000500010000000168656c6c6f"
  lenses:
    - label: 按帧解析
      sub: 9 字节帧头 + 5 字节载荷
      tone: violet
      steps:
        - span: [0, 2]
          tag: Length · 3 字节
          note: |
            `00 00 05` 按高位在前拼成 `0x000005`，值为 5。这是载荷长度，不包含帧头。
          out: 本帧载荷 = 5 字节
        - span: [3, 3]
          tag: Type · 1 字节
          note: |
            `0x00` 表示 DATA 帧，可承载请求或响应的消息体数据。
          out: 类型 = DATA
        - span: [4, 4]
          tag: Flags · 1 字节
          note: |
            对 DATA 帧，`0x01` 设置了 `END_STREAM`：发送方在这条流上的发送方向结束；另一方向可能仍在进行。
          out: END_STREAM = 1
        - span: [5, 8]
          tag: Stream Identifier · 4 字节
          note: |
            最高位是保留位，剩下 31 位表示流编号；这里的编号是 1。
          out: 流编号 = 1
        - span: [9, 13]
          tag: 读取 5 字节载荷
          note: |
            `68 65 6c 6c 6f` 按 ASCII 显示为 `hello`。本帧共 9 + 5 = 14 字节，接下来的偏移 14 是下一帧起点。
          out: 本帧结束；下一帧从偏移 14 开始
    - label: 看字符显示
      sub: 帧头和载荷不必都是可读字符
      tone: blue
      steps:
        - span: [0, 8]
          tag: 二进制帧头
          note: |
            这些字节按固定位置解释为数值，不是 ASCII 字符串 `005`。例如长度里的 `05` 是一个值为 5 的字节。
        - span: [9, 13]
          tag: 恰好可读的载荷
          note: |
            此例载荷恰好是 ASCII 字母；DATA 载荷也可以包含不可打印字节。
```

判断**这一帧**到哪结束，只需知道帧头位置和载荷长度：`00 00 05` 是整数 5，接收方在 9 字节帧头后再消费 5 字节。它不需要在载荷中搜索结束符，但仍需接收字节、校验帧，并按帧类型处理内容。

这个长度不一定等于整条 HTTP 消息体长度，也不总是应用正文长度：例如 DATA 帧可以带填充；HEADERS 或 SETTINGS 帧的载荷装的是其他信息。

每帧都要额外带 9 字节帧头；帧头里的整数和标志也不能像普通文本一样直接阅读，排查时通常需要协议解码工具。分帧带来的组织能力并不保证每次请求都比 HTTP/1.1 快。

### 帧结束和消息结束，是两个边界

```compare
first: 要判断什么
head: [依据, 例子]
rows:
  - 当前帧在哪里结束: [9 字节帧头里的 Length, 本例是帧头 9 + 载荷 5]
  - 这一方向的请求或响应是否发送结束: [HEADERS 或 DATA 上的 END_STREAM 标志, 本例 DATA 的 Flags 是 0x01]
  - TCP 连接是否结束: [连接关闭或出错, 与某一个帧的结束不是同一回事]
```

Length 是 24 位，能表示的最大载荷长度是 `2²⁴ − 1 = 16,777,215` 字节。实际每帧能发多少由**接收方**的 `SETTINGS_MAX_FRAME_SIZE` 限定，初始为 16,384 字节，可设置得更大；部分帧类型还有自己的大小限制。一个较大的消息体可以分成多个 DATA 帧。

## 07 · 流编号让不同请求的帧可以交错

**流（stream）**是 HTTP/2 一条连接中的逻辑通道。一次请求及其响应通常使用同一流编号：客户端和服务器各自按这个编号发送帧。流不是另一条 TCP 连接。

下面只看**服务器发回响应的方向**。假设响应 1 很长，响应 2 比较短：

```raw
<div class="ow">
  <div class="ow-case">
    <div class="ow-head">
      <span class="tag tone-blue">HTTP/1.1</span>
      <b>响应按请求顺序发送</b>
      <small>客户端可以不等响应就继续发送请求；服务器仍按请求顺序发送对应响应。</small>
    </div>
    <div class="ow-axis">服务器 → 客户端：只画这一方向的字节顺序</div>
    <div class="ow-band" style="overflow-x: auto;">
      <div class="ow-blk tone-blue">响应 1<em>头部</em></div>
      <div class="ow-blk tone-blue">响应 1<em>body 第一部分</em></div>
      <div class="ow-blk tone-blue">响应 1<em>body 剩余部分</em></div>
      <div class="ow-blk tone-violet">响应 2<em>头部与 body</em></div>
    </div>
    <div class="ow-note">响应 1 可以分多次发送，但响应 2 的字节不能插进响应 1 的消息体。</div>
  </div>
  <div class="ow-case">
    <div class="ow-head">
      <span class="tag tone-violet">HTTP/2</span>
      <b>不同流的帧可以交错</b>
      <small>示意每个 HEADERS 块都在一个帧内结束；两条流此前已经建立。</small>
    </div>
    <div class="ow-axis">服务器 → 客户端：同一连接上的帧依次送出</div>
    <div class="ow-band" style="overflow-x: auto;">
      <div class="ow-blk tone-blue">HEADERS<em>流 1</em></div>
      <div class="ow-blk tone-violet">HEADERS<em>流 3</em></div>
      <div class="ow-blk tone-blue">DATA<em>流 1</em></div>
      <div class="ow-blk tone-violet">DATA<em>流 3</em></div>
      <div class="ow-blk tone-blue">DATA<em>流 1</em></div>
    </div>
    <div class="ow-note">接收方按帧头里的流编号归属数据；帧仍通过同一个方向的字节流依次到达。</div>
  </div>
</div>
```

这里依靠的是**分帧、流编号和流状态等规则一起工作**，不只是“知道长度就能交错”。例如，一组尚未结束的 HEADERS / CONTINUATION 字段块必须连续发送，不能在中间插入其他流的帧。

HTTP/2 可以减少 HTTP/1.1 在同一连接上等待前一个响应的限制，但它仍运行在 TCP 之上：如果 TCP 某段字节丢失，后面的字节可能都得等待重传，这会影响同一连接上的多个流。实际快慢还取决于网络、实现和服务器行为。

## 08 · 延伸：把真实 HTTP/2 字节和 HPACK 对起来

上面的 14 字节帧是为学习构造的例子。下面这一组是本机复现的明文 HTTP/2 连接：`curl 8.7.1` 使用 `--http2-prior-knowledge` 请求本地服务。服务端**累计**读到 110 字节，不代表它们必须在一个 TCP 包或一次读取中到达。

先是 24 字节的客户端连接前言，然后是三个帧：

```demo
widget: byte-walker
title: 110 字节：前言、两个控制帧、一个请求头帧
hint: 按顺序点“下一步”；第二种读法对应 HEADERS 的内容
actions: false
config:
  bytes: "505249202a20485454502f322e300d0a0d0a534d0d0a0d0a000012040000000000000300000064000400a000000002000000000000040800000000003e7f00010000250105000000018286418b089d5c0b8170dc0bc0783f04856272d141ff7a8825b650c3cbbab87f53032a2f2a"
  lenses:
    - label: 从前言走到帧
      sub: 24 字节前言 + 3 个帧
      tone: violet
      steps:
        - span: [0, 23]
          tag: 客户端连接前言
          note: |
            这是 24 字节的固定前言，包含 16 个可打印 ASCII 字节和 8 个回车／换行控制字节；它本身不是帧。
          out: 前言 = 24 字节
        - span: [24, 32]
          tag: SETTINGS 帧头
          note: |
            前三字节 `00 00 12` 按十六进制是 18；类型 `04` 是 SETTINGS，流编号为 0，表示连接级帧。
          out: 帧头 9 字节；载荷 18 字节
        - span: [33, 50]
          tag: SETTINGS 载荷
          note: |
            这是三个 6 字节的设置项。确定这一帧的边界靠帧头长度；处理设置时仍要解析载荷。
        - span: [51, 59]
          tag: WINDOW_UPDATE 帧头
          note: |
            `00 00 04` 表示载荷 4 字节，类型 `08` 是 WINDOW_UPDATE，流编号为 0。
          out: 帧头 9 字节；载荷 4 字节
        - span: [60, 63]
          tag: WINDOW_UPDATE 载荷
          note: |
            这 4 字节携带连接级流量控制的窗口增量。
        - span: [64, 72]
          tag: HEADERS 帧头
          note: |
            `00 00 25` 按十六进制是 37；类型 `01` 是 HEADERS，流编号为 1。标志 `05` 包含 END_HEADERS 和 END_STREAM。
          out: 帧头 9 字节；载荷 37 字节
        - span: [73, 109]
          tag: HEADERS 载荷
          note: |
            这 37 字节是 HPACK 编码后的请求头字段块。客户端的请求发送方向已结束，服务器仍可以在流 1 上返回响应。
    - label: 从字节看头字段
      sub: 本例的 HPACK 编码
      tone: blue
      steps:
        - span: [73, 73]
          tag: 一个字节对应一条字段
          note: |
            `82` 是 HPACK 的索引表示：查静态表第 2 项，得到 `:method: GET`。
          out: ":method: GET"
        - span: [74, 74]
          tag: 第二个静态表索引
          note: |
            `86` 对应静态表第 6 项，得到 `:scheme: http`。
          out: ":scheme: http"
        - span: [75, 87]
          tag: 主机和端口
          note: |
            这一段包含字段名的索引和 Huffman 编码的值；解码后是 `:authority: 127.0.0.1:18081`。
        - span: [88, 94]
          tag: 请求路径
          note: |
            这一段解码后得到 `:path: /hello`。
        - span: [95, 104]
          tag: User-Agent
          note: |
            这一段解码后得到 `user-agent: curl/8.7.1`。
        - span: [105, 109]
          tag: Accept
          note: |
            这一段解码后得到 `accept: */*`；末尾三个字节是可直接显示的 `*/*`。
```

**HPACK 是 HTTP/2 的头字段压缩格式**。它既能引用预定义的静态表，也能在条件允许时使用动态表和 Huffman 编码；动态表会受大小限制并可能淘汰条目，通信双方需要维持各自方向上的编码／解码状态。37 字节的字段块经解码后得到：

```text
:method:    GET
:scheme:    http
:authority: 127.0.0.1:18081
:path:      /hello
user-agent: curl/8.7.1
accept:     */*
```

帧边界与头字段压缩是两件事：帧头告诉解析器**载荷在哪里**，HPACK 才告诉它**这些字节表示哪些字段**。一个字段块也可能跨 HEADERS 和 CONTINUATION 帧，不能只靠“跳过载荷”来完成 HTTP 的全部处理。

本例使用明文的本地 HTTP/2。通常访问 HTTPS 时，HTTP/2 帧会经过 TLS 加密后再交给 TCP；直接查看网络上的 TCP 字节，通常先看到的是 TLS 记录和密文，需要解密才能看到帧。

## 09 · 放回整体：HTTP/1.1、HTTP/2、HTTP/3

```compare
first: 对比的问题
head: [HTTP/1.1, HTTP/2, HTTP/3]
rows:
  - 底下的传输: [TCP, TCP, QUIC over UDP]
  - 主要组织方式: [文本形式的起始行与字段；消息体另按规则定界, 固定 9 字节帧头加可变载荷, QUIC 流中的帧；类型和长度用变长整数]
  - 多个请求: [可复用连接和流水线请求；响应按顺序返回, 同一连接上不同流的帧可按规则交错, 不同请求使用 QUIC 流]
  - 头字段压缩: [没有 HTTP/2 的 HPACK 机制, HPACK, QPACK]
```

HTTP/3 的 QUIC 流在传输层分别交付：丢失某条流的数据时，不必像 TCP 的单条字节流那样等待缺失位置之后的所有流。若一个丢失的 QUIC 包包含多个流的数据，这些流都可能受影响；共享拥塞控制、流量控制或 QPACK 状态也可能带来等待。因此它不是“任何情况下都没有阻塞”。

```summary
title: 回到最初的问题
text: |
  TCP 传的是字节；ASCII 是解释部分字节的一种方式。HTTP/1.1 先按行读头部，再用长度、分块等规则确定消息体；HTTP/2 用固定帧头中的长度确定帧边界，再用流编号组织帧。

  ==头部结束、一个帧结束、整条消息结束，是不同的问题。==
```

## 自测

```quiz
- q: 一条 HTTP/1.1 请求没有 Content-Length，也没有 Transfer-Encoding。空行后还要等 body 吗？
  a: |
    不需要。按 HTTP/1.1 的请求定界规则，这种请求的消息体长度为 0。普通响应在没有其他长度规则时，则可能以连接关闭确定结束。
- q: chunked 是 TCP 的分包开关吗？
  a: |
    不是。它是 HTTP/1.1 对消息体的编码：每块写十六进制长度和数据，最后用 0 长度块与尾部结束。TCP 的发送、分段和读取边界不等于 chunk 边界。
- q: Content-Length 为 8，body 是 ab\r\n\r\ncd，内容里的空行会结束消息吗？
  a: |
    不会。解析器已经进入读取 body 的阶段，并按长度消费 8 个字节；其中的 `\r\n\r\n` 是内容。
- q: HTTP/2 帧头里 Length 是 5，是不是整个响应只剩 5 字节？
  a: |
    不是。它只表示当前帧的载荷是 5 字节，不含 9 字节帧头；一条响应可以有多个帧。发送方向是否结束还要看 `END_STREAM` 等流状态。
```
