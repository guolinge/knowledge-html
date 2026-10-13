组件篇讲了受控数据流和控件决策，配置层讲了 metadata 从哪来。这一篇只回答一个问题：**点开下拉框的那一下，候选值是从哪来的。**

先给结论：`metadata` 里**没有候选值**，只有两个引用键，`fieldType.setKey` 和 `fieldType.resolverKey`。真正的取值是那一刻现取的，走两条不同的管道，各自穿过五层。两条管道的形状也不同：值集合是「字段被选中时自动拉一次，之后一直用」，动态候选是「每次输入关键词都发一次请求」。

```callout
tone: blue
icon: 🧭
text: |
  **读这篇之前**：需要知道组件是受控的、`metadata` 是 Data Admin 的 pb 读模型、`valueSource` 有四态（`NONE` / `VALUE_SET` / `DYNAMIC` / `CUSTOM`）——
  这些在[组件机制篇](../combination-mechanics/)的 02、04 两节。

  本仓库 `crm-dsl-stru` 停在 `7f2ec46`，行号按这个提交。凡是「实测」字样，都是 `wc -l` / `grep` 跑出来的，不是估的。
```

### 先看 metadata 长什么样

`GET /api/crowd/metadata` 的真实响应（demo 数据：**41 个画像 / 3 条关系 / 7 个业务域**）。它整体只有四个顶层键：

```spec
title: 整体：四个顶层键
subtitle: 41 个画像 / 3 条关系 / 7 个业务域 · revision f4badf35
tone: blue
rows:
  - k: 信封
    code: |
      {
        "revision":  "f4badf35",     // 投影内容哈希：任一条状态或文案变了它就变
        "domains":   [ /* 7 个 */ ],
        "portraits": [ /* 41 个 */ ],
        "relations": [ /* 3 条 */ ]
      }
  - k: "domains 7 个"
    code: |
      { "key": "futu",     "name": { "zhCn": "富途" }, "level": 1, "sortOrder": 10, "status": 1 }
      { "key": "identity", "parentKey": "futu", "level": 2, ... }    // 子域才有 parentKey
      { "key": "legacy",   "level": 1, "status": 0 }                 // 停用的域也在
      // 其余 4 个：account / asset / trade / service
  - k: "portraits 41 个"
    code: |
      { "key": "age",  "fieldType": { "variableType": "range", "dataType": "long", "enumType": "none" } }
      { "key": "city", "fieldType": { "enumType": "value_set", "setKey": "city" } }
      { "key": "open_city", "status": 0, ... }    // 停用的字段也在 —— 回显历史条件要用
      // 其余 38 个：gender / region / aum_hkd / ...（只有一个带 defaultValue）
  - k: "relations 3 条"
    code: |
      { "key": "holding",
        "object":     { "key": "stock", "fieldType": { "enumType": "dynamic", "resolverKey": "stock_search" } },
        "properties": [ { "key": "market" }, { "key": "qty" } ] }
      // 其余 2 条：product / hk_main_category_position
```

三个字段各长什么样，从这 41 + 3 里各挑一个看细节：

```spec
title: 三种字段的细节
subtitle: 枚举字段 / 关系的客体 / 连续型默认值 · revision f4badf35
tone: blue
rows:
  - k: ① 枚举字段
    code: |
      {
        "key": "city",
        "name": { "zhCn": "常驻城市", "zhHk": "常駐城市", "en": "City" },
        "fieldType": { "variableType": "enum", "dataType": "string",
                       "contentType": 7, "enumType": "value_set", "setKey": "city" },
        "domainKey": "identity", "status": 1, "frequency": 2, "entity": "niuniu"
      }
  - k: ② 关系的客体
    code: |
      {
        "key": "holding",
        "object": { "key": "stock",
                    "fieldType": { "variableType": "range", "dataType": "string",
                                   "enumType": "dynamic", "resolverKey": "stock_search" } },
        "properties": [ { "key": "market", "isPrimaryKey": 0,
                          "fieldType": { "enumType": "value_set", "setKey": "market" } } ]
      }
  - k: ③ 连续型 + 默认值
    code: |
      {
        "key": "trade_count_30d",
        "fieldType": { "variableType": "range", "dataType": "long", "enumType": "none" },
        "defaultValue": "0", "defaultValueExplain": "未发生交易"
      }
  - k: ④ 里面没有什么
    v: |
      没有候选值，没有表名 / 列名，没有操作符表。看得到的 `setKey` / `resolverKey` 是**指针**；
      `defaultValue` 也是 JSON 字符串（`"0"`，不是数字 `0`）。候选值要靠这两个指针再去请求一次。
```

## 01 · 先看全图：一次取值穿过五层

每一层只做一件事：组件决定「用哪个 key」，注入层转发函数，宿主决定「缓存还是发 HTTP」，适配层把 pb 变形，服务端读内存投影或查常量表。

外层的框回答「它属于谁」：组件包和宿主同处浏览器；两条路由与动态候选的常量表同处 BFF 进程 —— ==所以只有值集合这一条链路要出进程去查库，动态候选不出==（demo 的常量表就在进程里；生产换成检索服务时会挪出这个框）。

```arch
svg: candidate-paths
bodies:
  meta:
    badge: 只有引用键
    rows:
      - { k: portraits, v: 41 个（1 个停用） }
      - { k: relations, v: "3 条" }
      - { k: domains, v: "7 个（1 个停用）" }
    code: "value_set → setKey: city"
    note: 没有候选值，也没有表名列名
  ui:
    rows:
      - { k: PortraitRow, v: useStoredItems, link: inj, tip: 换字段才拉；改操作符、改值都不拉 }
      - { k: RelationRow, v: propSetItems }
      - { k: ValueControl, v: remote-method }
    note: grep 'fetch(' 零命中
  inj:
    badge: 组件与宿主的全部契约
    rows:
      - { k: loadValueSet, v: 值集合, link: host, tip: 宿主侧负责缓存与 HTTP }
      - { k: searchValues, v: 搜索, link: host }
      - { k: lookupValues, v: 回显, link: host }
    code: "inject(key, async () => [])"
    note: 没给就是空实现，不报错
  host:
    badge: 唯一发 HTTP 的地方
    rows:
      - { k: cache, v: 按 setKey 缓存 }
      - { k: inflight, v: 同 key 复用 }
      - { k: 失效, v: staffId / revision }
    note: 预热结果列的 setKey
  adp:
    pairs:
      - { from: "\"440300\"", to: "440300", note: JSON 标量 }
      - { from: zhCn, to: "zh-CN" }
      - { from: "status: 0", to: DISABLED }
    note: 只做形状转换，不做业务判断
  routeA:
    badge: 5 秒投影
    rows:
      - { k: 入参, v: setKey 必填 }
      - { k: 出参, v: "items[] 含停用" }
      - { k: 错误, v: 400 / 404 }
  routeB:
    rows:
      - { k: keyword, v: 子串匹配 }
      - { k: values, v: 按 value 反查 }
      - { k: limit, v: 默认 20 / 最大 50 }
    note: values 优先，忽略 keyword
  proj:
    badge: 进程内 · 5 秒 TTL
    rows:
      - { k: 内容, v: 六张元数据表的全量读模型 }
      - { k: 刷新, v: 过期才重读，并发共用一次查询 }
      - { k: 谁在读, v: "value-sets / metadata / catalog / 预览 / 建快照" }
    code: "const CACHE_TTL_MS = 5_000"
    note: 改一行 MySQL，最多 5 秒后整条链路一起变
  mysql:
    badge: 值的原型
    rows:
      - { k: value, v: "\"440300\"" }
      - { k: label, v: 深圳 / Shenzhen }
      - { k: status, v: "0（停用）" }
    code: "// 停用改 status，不删行"
  stocks:
    cells:
      - { label: SEMI, sub: 板块 }
      - { label: "00700.HK" }
      - { label: "09988.HK" }
    note: 共 21 条，没有停用态
caption: 一次取值穿过五层；值集合和动态候选到服务端才分开 —— 而且一个要出进程去查库，另一个不出。点区域看归属说明，点零件看完整归属路径，或按两条导览各走一遍；「多层归属框 / 只留一层分区」比较两种组织方式。
parts:
  meta:
    label: metadata 字典
    sub: 41 个画像 / 3 条关系 / 7 个业务域
    detail: |
      字段字典。每个字段带 `fieldType`（类型 + 枚举来源），来源写在 `setKey` 或 `resolverKey` 里。
      ==候选值一条都不在这里==：所以它只有几 KB，而值集合可以有上万条。
  ui:
    label: 组件子树
    sub: PortraitRow · RelationRow · ValueControl
    detail: |
      三个消费点：画像行 `useStoredItems(() => feature.valueSource)`；关系行的 `propSetItems` 批量预取；值控件的 remote-method。
      组件包里 `grep 'fetch('` 零命中 —— 它不认识 HTTP。
  inj:
    label: 注入层
    sub: InsightCombiner 的三行 provide
    detail: |
      把宿主的函数转给子组件，没给就退化成 `async () => []`。
      `loadValueSetKey` / `searchValuesKey` / `lookupValuesKey` 就是组件与宿主之间的全部契约。
  host:
    label: 宿主 App
    sub: useValueSets 缓存 + loadSearch / loadLookup
    detail: |
      决定「缓存还是请求」：按 `setKey` 缓存，inflight 复用；`staffId` 或 metadata `revision` 变化就清空。
      `prefetchColumns` 还会在预览返回后预热结果列涉及的 setKey。
  adp:
    label: 适配层 api.ts
    sub: pb → 组件内部形状
    detail: |
      1:1 转换：反序列化 `value`、`zhCn / zhHk / en` 转 `zh-CN / zh-HK / en`、`status: 0` 转 `DISABLED`。
      ==只做形状转换，不做业务判断==；四步变形见 2.3。
  routeA:
    label: GET /api/crowd/value-sets
    sub: setKey 必填
    detail: |
      从**内存快照**（`MetadataRows`，5 秒 TTL）里找集合，`JSON.stringify(item.value)` 之后返回 pb 形状。
      集合停用、条目停用都照样返回，只为回显历史条件。什么是这份快照，见 05 节。
  routeB:
    label: GET /api/crowd/resolver-options
    sub: keyword 搜索 / values 反查
    detail: |
      `values` 非空时忽略 `keyword` 和 `limit`；`keyword` 为空返回空列表。
      当前解析器 `stock_search` 用一份 21 条的常量表同时实现搜索和反查。
  proj:
    label: 内存投影 · MetadataRows
    sub: 六张表全量读模型 · 5 秒 TTL
    detail: |
      `getMetadataRows()` 在服务端进程里只留一份快照：5 秒内直接复用，过期才重读六张表，
      同一个窗口里的并发请求共用一次查询（`inflight`，防缓存击穿）。
      ==它不只喂 `value-sets`== —— `/metadata`、`/catalog`、预览和建快照读的都是它。
  mysql:
    label: crm_dc_value_set
    sub: enum_content JSON
    detail: |
      值的原型。每项带 `value` / `label` / `status` / `sortOrder`；停用是改 `status`，不是删行。
  stocks:
    label: resolvers.ts · STOCKS
    sub: 21 条常量
    detail: |
      动态候选没有元数据表。真实实现是一次检索服务，demo 里是写死的数组；没有停用态，也不缓存。
frames:
  - id: browser
    boundary: 0
    kind: contains
    label: 浏览器 · 用户侧
    detail: 组件包和宿主跑在同一个页面里。HTTP 只发生在宿主这一侧，组件包只消费注入的函数。
  - id: pkg
    boundary: 1
    parent: browser
    kind: contains
    label: 圈选组件包（@insight/combination）
    detail: 组件子树加注入层。它不认识 HTTP，所有数据入口都是注入进来的三个函数。
  - id: app
    boundary: 2
    parent: browser
    kind: contains
    label: 宿主应用（apps/client）
    detail: 缓存、HTTP 和 pb → 内部形状的适配都在这一侧；它是这条链上唯一真正发请求的地方。
  - id: bff
    boundary: 3
    kind: contains
    label: Node BFF 进程（apps/server）
    detail: 两条路由和动态候选的常量表同在这一个进程里 —— 链路 B 到这就结束了，不出进程；生产里常量表会换成外部检索服务，那时它也会被挪出这个框。
  - id: db
    boundary: 4
    kind: contains
    label: 外部数据源 · crm_dc_value_set
    detail: 值集合的原型，在 BFF 进程外；BFF 的 5 秒内存投影从它来。动态候选不查它。
tours:
  - id: valueset
    label: 链路 A · 值集合
    steps:
      - { at: [ui], text: "用户选中「常驻城市」，这个字段的 valueSource 变成 `{ VALUE_SET, setKey: city }`。" }
      - { at: [ui, inj], text: "`useStoredItems` 调注入的 `loadValueSet(city)`。==只有换字段才拉==，改操作符、改值都不拉。" }
      - { at: [inj, host], text: "宿主先查缓存：有就返回，没有才发请求。" }
      - { at: [host, adp, routeA, proj, mysql], text: "缓存没命中才发请求：`routeA` 从内存投影（5 秒 TTL）里 find 这个 setKey；投影过期时才回表重读。" }
      - { at: [adp, ui], text: "回来先过适配层（反序列化 value、转 I18n 键、status 0 → DISABLED），再上屏；停用项是灰的，名字仍在。" }
  - id: dynamic
    label: 链路 B · 动态候选
    steps:
      - { at: [ui, inj], text: "用户敲「腾讯」，值控件先取 `searchToken` 票据，再调 search(stock_search, 腾讯)。" }
      - { at: [inj, host, adp], text: "一路转发。动态候选不打缓存：每次都重新问。" }
      - { at: [routeB, stocks], text: "`GET resolver-options?keyword=腾讯` 在 21 条常量里做子串匹配。" }
      - { at: [ui], text: "回来时票据不相等就整包丢弃 —— 旧响应永远盖不掉新结果。" }
      - { at: [inj, host], text: "回显是另一条路：草稿里已存的取值用 `values=` 反查名字。" }
      - { at: [adp, routeB], text: "同一个接口，`values` 非空时忽略 keyword 和 limit。" }
```

上面是**地图**（谁在哪、归谁、两条链路在哪分叉）；下面这张是**分层流程** —— 同一批零件，换成从上到下的顺序，每一层挂着哪几个零件一眼扫完。

```lane-stack
- badge: LAYER 01
  title: 组件子树
  desc: 只认 metadata 和三个注入进来的函数
  tone: blue
  nodes:
    - { title: PortraitRow, sub: "useStoredItems(() => feature.valueSource)", tag: 画像行 }
    - { title: RelationRow, sub: "propSetItems 批量 + 客体 remote select", tag: 关系行, tone: violet }
    - { title: ValueControl, sub: "remote-method → onSearch(keyword)", tag: 值控件, tone: violet }
  next: "loadValueSet(setKey) :: :: 组件自己不发请求"
- badge: LAYER 02
  title: 注入层
  desc: InsightCombiner 把调用方给的函数 provide 下去
  tone: violet
  nodes:
    - { title: loadValueSetKey, sub: "props.loadValueSet?.(setKey)", tag: 值集合 }
    - { title: searchValuesKey, sub: "props.searchValues?.(resolverKey, kw)", tag: 搜索 }
    - { title: lookupValuesKey, sub: "props.lookupValues?.(resolverKey, values)", tag: 回显 }
  next: "宿主 App :: :: 函数体在这里，组件看不见"
- badge: LAYER 03
  title: 宿主 App
  desc: 决定缓存、决定打哪个接口
  tone: green
  nodes:
    - { title: useValueSets, sub: "按 setKey 缓存 + inflight 复用", tag: 缓存 }
    - { title: loadSearch / loadLookup, sub: "薄薄一层，透传 api.ts", tag: 透传 }
    - { title: prefetchColumns, sub: "预览结果回来后预热结果列的 setKey", tag: 预热 }
  next: "api 适配层 :: :: pb → 组件内部形状"
- badge: LAYER 04
  title: api 适配层
  desc: value 是 JSON 字符串、I18n 是 zhCn/zhHk、status 是数字 —— 全在这里转
  tone: amber
  nodes:
    - { title: getValueSet, sub: "toValueItems → parsePbScalar", tag: value-sets }
    - { title: searchValues / lookupValues, sub: "toResolverItems → toI18nText", tag: resolver-options }
  next: "服务端 :: :: 两个 GET，无 body"
- badge: LAYER 05
  title: 服务端
  desc: 一个查投影，一个查内存常量表
  tone: red
  nodes:
    - { title: GET /api/crowd/value-sets, sub: "内存快照（5 秒 TTL）里找 set → toValueSet", tag: setKey 必填 }
    - { title: GET /api/crowd/resolver-options, sub: "values 优先，否则 keyword 子串匹配", tag: resolverKey 必填 }
  next: "数据 :: :: 一份在 MySQL，一份在代码里"
- badge: LAYER 06
  title: 数据
  desc: 两条链路的终点完全不同
  tone: muted
  nodes:
    - { title: crm_dc_value_set, sub: "enum_content JSON，原生标量", tag: MySQL }
    - { title: resolvers.ts · STOCKS, sub: "21 条写死的股票，value + 三语 label", tag: 常量表, tone: amber }
```
五层各管一件事，出问题时的表现也各不相同：

```compare
first: 这一层
head: [只做一件事, 坏了会怎样]
rows:
  - 组件子树:
      - "决定用哪个 `setKey` / `resolverKey`，渲染候选"
      - "没给注入函数 → 下拉永远为空，但不报错"
  - 注入层:
      - "把宿主的函数 provide 给子组件"
      - "key 对不上 → 子组件拿到默认空实现"
  - 宿主 App:
      - "缓存 / 失效 / 打哪个接口"
      - "`staffId` 或 `revision` 变了不清缓存 → 看到上一个人的候选"
  - 适配层:
      - "pb 形状 → 组件形状，不改语义"
      - "少转一个字段 → 停用项变成可选、标签变空"
  - 服务端:
      - "查投影或常量表，返回 pb"
      - "`values` 和 `keyword` 传混 → 返回空列表"
```

三个最容易以为错的地方，先摆出来：

```compare
first: 直觉
head: [代码里实际是什么, 结果]
rows:
  - metadata 接口里带着候选值:
      - "只带 `setKey` / `resolverKey` 两个引用键；`CUSTOM` 才会把 items 一起带 —— 而 pb 投影已经不产出 `CUSTOM` 了"
      - "字典和值是两次请求"
  - 组件自己发 HTTP:
      - "组合器源码里 `grep -rn 'fetch(\\|axios'` ==零命中==；注入函数没给时默认 `async () => []`"
      - "组件可以脱离宿主单跑，下拉只是空的"
  - 值集合是静态的、全局缓存:
      - "服务端 5 秒 TTL 全量刷新（`CACHE_TTL_MS = 5000`）；宿主按 `setKey` 缓存，`staffId` 或 metadata `revision` 变了就清空"
      - "停用值仍会回来，只是渲染成灰色不可选"
```

## 02 · 链路 A · 值集合：点一下字段，十一行时序回来

### 2.1 触发点是「换字段」，不是「换操作符」

`PortraitRow` 把 `feature.valueSource` 交给 `useStoredItems`，`values.ts` 里 watch 的就是这个 source：

```text
// packages/combination/src/values.ts —— 值集合分支
watch(source, async (next) => {
  const current = ++ticket;
  if (!next || next.type === 'NONE' || next.type === 'DYNAMIC') { items.value = []; return; }
  if (next.type === 'CUSTOM') { items.value = next.items; return; }
  items.value = [];
  const loaded = await loadValueSet(next.setKey).catch(() => []);   // ← 只有 VALUE_SET 走到这
  if (current === ticket) items.value = loaded;
}, { immediate: true });
```

所以：**同一个字段上改操作符、改值，都不会再拉一次；换成另一个字段（或另一个 setKey）才会拉。** `ticket` 是防串道的票据：快速连换两次字段时，先发的响应回来晚了会被丢掉。

### 2.2 十一步时序

```seq
grid: true
participants:
  - { id: u, label: 用户, tone: muted }
  - { id: vc, label: PortraitRow + ValueControl, tone: blue }
  - { id: inj, label: 注入层, tone: violet }
  - { id: host, label: 宿主 App, tone: green }
  - { id: srv, label: 服务端, tone: red }
messages:
  - { from: u, to: vc, label: 选中字段「常驻城市」, kind: sync }
  - { from: vc, to: vc, label: "valueSource = { VALUE_SET, setKey: 'city' }", kind: self }
  - { from: vc, to: inj, label: "loadValueSet('city')", kind: sync, note: 1 }
  - { from: inj, to: host, label: "props.loadValueSet('city')", kind: sync, note: 2 }
  - { from: host, to: host, label: 查 cache / inflight, kind: self }
  - { from: host, to: srv, label: "GET /api/crowd/value-sets?setKey=city", kind: sync, note: 3 }
  - { from: srv, to: host, label: "items[] · 从 5 秒投影里取，value 是 JSON 标量字符串", kind: reply, note: 4 }
  - { from: host, to: host, label: 适配 + 写缓存, kind: self }
  - { from: host, to: inj, label: "ValueItem[]", kind: reply }
  - { from: inj, to: vc, label: "ResolvedOption[] · DISABLED → disabled", kind: reply, note: 5 }
  - { from: vc, to: u, label: 下拉出现候选（深圳是灰的）, kind: reply }
  - { from: u, to: vc, label: 选中「深圳」, kind: sync }
  - { from: vc, to: vc, label: "emit('update:modelValue')", kind: self }
  - { from: vc, to: u, label: "{ field: 'city', op: 'eq', value: '440300' }", kind: reply }
```

三处对应代码：

```spec
title: 这条链上的三个关键点
subtitle: 组件 → 注入层 → 宿主
tone: blue
rows:
  - k: 1 · 组件不认 HTTP
    code: |
      // packages/combination/src/values.ts:8
      const loadValueSet = inject(loadValueSetKey, async () => []);
      // 组件包里 grep 'fetch(' / 'axios' —— 零命中
  - k: 2 · 注入层只转发
    code: |
      // packages/combination/src/InsightCombiner.vue:59
      provide(loadValueSetKey, (setKey) => props.loadValueSet?.(setKey) ?? Promise.resolve([]));
  - k: 3 · 宿主决定缓存还是请求
    code: |
      // apps/client/src/useValueSets.ts —— 三级：cache → inflight → getValueSet
      const cached = cache.value[setKey];
      if (cached) return cached;
      const pending = inflight.get(setKey);
      if (pending) return pending;
      const promise = getValueSet(requestedStaff, setKey).then((body) => {
        if (staffId.value === requestedStaff && run === generation) cache.value = { ...cache.value, [setKey]: body.items };
        return body.items;
      })
```

### 2.3 值的一路变形

同一条数据在这条链上换了四次形状。看仔细：**MySQL 里是原生标量，HTTP 上是 JSON 字符串，组件内部又变回原生标量。**

```journey
- tag: ① MySQL 行
  tone: muted
  name: crm_dc_value_set
  badge: 原生标量
  badgeTone: ok
  code: |
    set_key = 'city'
    enum_content = [
      { "value": "440300", "label": { "zh-CN": "深圳", "zh-HK": "深圳", "en": "Shenzhen" },
        "status": 0, "sortOrder": 100 }
    ]
  note: status 0 = 停用。它仍在数组里 —— 停用是改状态，不是删行。
  next: "toValueSet :: :: value 变成 JSON 标量字符串"

- tag: ② HTTP 响应
  tone: red
  name: pb 形状
  badge: value 是字符串
  badgeTone: red
  fields:
    - { k: key, v: city }
    - { k: "items[0].value", v: "\"440300\"", note: 带引号的 JSON 标量, tone: warn }
    - { k: "items[0].label", v: "{ zhCn, zhHk, en }", note: 键名也换了, tone: warn }
    - { k: "items[0].status", v: "0", note: 数字不是布尔, tone: warn }
  note: 服务端 `toValueSet` 里一句 `JSON.stringify(item.value)`，把标量变成可逆的字符串。
  noteTone: bad
  next: "api.ts 适配 :: :: parsePbScalar + toI18nText"

- tag: ③ 宿主拿到
  tone: green
  name: ValueItem[]
  badge: 恢复成标量
  badgeTone: ok
  code: |
    { value: '440300', label: { 'zh-CN': '深圳', 'zh-HK': '深圳', en: 'Shenzhen' },
      sortOrder: 100, status: 'DISABLED' }
  note: parsePbScalar 做一次 JSON.parse；status 0 → 'DISABLED'；I18n 键转会 zh-CN / zh-HK。
  next: "useResolvedItems :: :: 只给渲染要用的三样"

- tag: ④ 喂给 el-option
  tone: violet
  name: ResolvedOption
  badge: 给控件用
  code: |
    { value: '440300', label: '深圳', disabled: true }
  note: "`disabled` 由 status 推出。新条件里它选不了；回显历史条件时它照样显示。停用值回来就是为了这个。"
  next: "选中之后 :: :: 又变回原生标量"

- tag: ⑤ 草稿
  tone: amber
  name: DraftPortrait
  badge: 落进 DSL
  code: |
    { type: 'portrait', field: 'city', op: 'eq', value: '440300' }
  note: 写进草稿的永远是原生标量，不是字符串 —— DSL 和 pb 的那层区别在这里被抹平了。
```

### 2.4 关系属性走的是另一条路：批量预取

`RelationRow` 不用 `useStoredItems`。一条关系可能挂好几个枚举属性，它索性在一个 watch 里把**所有** `VALUE_SET` 属性一起拉回来，结果存在 `propSetItems`：

```text
// packages/combination/src/components/RelationRow.vue —— 换关系时一次性拉齐
watch(relationDef, async (relation) => {
  const next: Record<string, ResolvedOption[]> = {};
  const ticket = ++propLoadToken;
  for (const prop of relation?.properties ?? []) {
    if (prop.valueSource.type !== 'VALUE_SET') continue;
    const items = await loadValueSet(prop.valueSource.setKey).catch(() => []);
    next[prop.key] = items.map((item) => ({ value: item.value, label: label(item.label), disabled: item.status === 'DISABLED' }));
  }
  if (ticket === propLoadToken) propSetItems.value = next;
}, { immediate: true });
```

对象（客体）的候选又是第三条路：`DYNAMIC` 走远程搜索，`CUSTOM` 用 metadata 自带 items，`NONE` 直接空数组，分支落在 `propItemsFor()` 里。

## 03 · 链路 B · 动态候选：每次输入都是一次请求

### 3.1 搜索：打开下拉或敲字都会发

```seq
grid: true
participants:
  - { id: u, label: 用户, tone: muted }
  - { id: vc, label: 值控件, tone: blue }
  - { id: inj, label: 注入层, tone: violet }
  - { id: host, label: 宿主 App, tone: green }
  - { id: srv, label: 服务端, tone: red }
messages:
  - { from: u, to: vc, label: 输入「腾讯」, kind: sync }
  - { from: vc, to: vc, label: searchToken++ 取票据, kind: self }
  - { from: vc, to: inj, label: "search('stock_search', '腾讯')", kind: sync, note: 1 }
  - { from: inj, to: host, label: "props.searchValues(resolverKey, keyword)", kind: sync }
  - { from: host, to: srv, label: "GET /resolver-options?…&keyword=腾讯", kind: sync, note: 2 }
  - { from: srv, to: host, label: "items[] · 常量表子串匹配，label 是 zhCn / zhHk / en", kind: reply, note: 3 }
  - { from: host, to: inj, label: 键转 zh-CN / zh-HK / en, kind: reply }
  - { from: inj, to: vc, label: "ResolvedOption[]", kind: reply }
  - { from: vc, to: vc, label: 票据相等才写 remoteItems, kind: self, note: 4 }
  - { from: vc, to: u, label: "下拉里出现「腾讯 `00700.HK`」", kind: reply }
```

四个细节，图上标了号：

| # | 细节 | 代码 |
|---|---|---|
| 1 | `<ValueControl :search="valueSearchFn">` 只在 `valueSource.type === 'DYNAMIC'` 且控件不是 `NONE` 时给出；`valueResolve` 同理 | `PortraitRow.vue` 的两个 computed |
| 2 | 打开下拉也会搜一次（空关键词）；敲字时 el-select 的 `remote-method` 每次输入都调 | `ValueControl.onOpen(open)` → `onSearch('')` |
| 3 | 服务端返回的 label 是 pb 键名；`api.ts` 的 `toResolverItems` 转成组件内部形状 | `api.ts` |
| 4 | `searchToken` 是一个自增整数：**发出前取号，回来时比对**，不相等就整包丢弃 | `ValueControl.onSearch` |

!!这个包**没有防抖**。技术方案里写着「输入关键词后防抖调用 searchValues」，但 `packages/combination/src/` 里 `grep debounce` 零命中、也没有 `setTimeout`。每次输入（以及每次打开下拉）都是一次真实请求。!!

### 3.2 第二处注入函数：用 `values=` 把已保存的取值换回中文名

搜索结果里不会总是有草稿里那个值（换个关键词、或者对方已下架）。这时用第二处注入函数按 value 精确反查：

```flow
grid: true
nodes:
  - { id: remote, label: 搜索命中, sub: remoteItems, row: 0, kind: frontend, tone: blue }
  - { id: stored, label: 值集合候选, sub: stored.resolved(), row: 0, kind: frontend }
  - { id: remembered, label: 回显缓存, sub: rememberedObjects, row: 0, tone: amber }
  - { id: shown, label: shownItems, sub: 候选 + 选中但缺失的, row: 1, tone: violet }
  - { id: option, label: el-option, sub: "disabled 来自 status", row: 2, kind: frontend, tone: green }
edges:
  - { from: remote, to: shown, label: 候选 }
  - { from: stored, to: shown, label: 候选 }
  - { from: remembered, to: shown, label: 换名字, dashed: true }
  - { from: shown, to: option, label: 渲染 }
```

图里的「选中但缺失的」是这样补上的：

```text
// packages/combination/src/components/ValueControl.vue —— shownItems
const selected = Array.isArray(modelValue.value) ? modelValue.value : modelValue.value == null ? [] : [modelValue.value];
return [...items,
  ...selected.filter(v => !items.some(i => i.value === v))
             .map(v => selectedLabels.get(String(v)) ?? { value: v, label: String(v) })];   // ← 兜底：原值显示原值
```

`selectedLabels` 有两个来源：当前 items，以及 `resolveSelected`（也就是注入的 `lookupValues`）对已选值反查回来的条目：

```text
// 同一文件的 watch —— 已选值不在候选里时，向解析器换名字
watch(() => [modelValue.value, props.resolveSelected] as const, async () => {
  const values = selected.filter(isScalar);
  if (values.length === 0) return;
  const items = await resolve(values).catch(() => []);
  for (const item of items) remember(item);
}, { immediate: true });
```

服务端对应分支只有三行：

```text
// apps/server/src/metadata/resolvers.ts —— values 非空时忽略 keyword 和 limit
if (values.length > 0) {
  const byValue = new Map(STOCKS.map((item) => [item.value, item]));
  return { items: values.flatMap((value) => { const item = byValue.get(value); return item ? [item] : []; }), nextCursor: null };
}
```

`RelationRow` 的客体（如持仓标的）走的是同一对函数，只是调用点换成 `onObjectSearch` / `objectOptions`。它还多修了一个 Element Plus 的坑：远程搜索后组件会自己清一次查询并再次触发 `remote-method`，如果不判断输入框里还有没有关键词，刚拿到的结果会被一次空搜索覆盖掉。

## 04 · 函数是怎么「注入」进去的

组件和宿主之间是一份四行的契约：三个函数 prop + 三个 injection key。组件不 import 宿主，宿主也不 import 组件。

```spec
title: 注入契约
subtitle: InsightCombiner.vue（154 行）里的三行 provide
tone: violet
rows:
  - k: 组件侧消费
    code: |
      // values.ts
      const loadValueSet  = inject(loadValueSetKey,  async () => []);   // 没给 → 空数组
      const searchValues  = inject(searchValuesKey,  async () => []);
      const lookupValues  = inject(lookupValuesKey,  async () => []);
  - k: 壳侧转发
    code: |
      // InsightCombiner.vue:59-61
      provide(loadValueSetKey, (setKey) => props.loadValueSet?.(setKey) ?? Promise.resolve([]));
      provide(searchValuesKey, (resolverKey, keyword) => props.searchValues?.(resolverKey, keyword) ?? Promise.resolve([]));
      provide(lookupValuesKey, (resolverKey, values) => props.lookupValues?.(resolverKey, values) ?? Promise.resolve([]));
  - k: 宿主侧实现
    code: |
      // apps/client/src/App.vue:392 —— 三个 prop 传进去
      <InsightCombiner v-model="query" :metadata="metadata"
        :load-value-set="loadValueSet" :search-values="loadSearch" :lookup-values="loadLookup" ... />
  - k: 为什么这么设计
    v: |
      组件包不绑定具体 HTTP 接口：它要的只是「给我 setKey 的候选值」，至于你从哪儿取、要不要缓存、什么时候清，都是宿主的事。
      代价是多一层转发；好处是同一个组件包换一个宿主（另一个页面、另一种鉴权、甚至 mock 数据）不用改代码。
```

三个 prop 的来源接口不一样，第一个和第三个尤其容易混：

```compare
first: prop
head: [谁给的, 打哪个接口]
rows:
  - metadata:
      - "GET /api/crowd/metadata"
      - "字段字典。里面只有 `setKey` / `resolverKey`"
  - loadValueSet:
      - "宿主 useValueSets → getValueSet"
      - "GET /api/crowd/value-sets?setKey="
  - searchValues:
      - "宿主 loadSearch → api.searchValues"
      - "GET /api/crowd/resolver-options?resolverKey=&keyword=&limit="
  - lookupValues:
      - "宿主 loadLookup → api.lookupValues"
      - "GET /api/crowd/resolver-options?resolverKey=&values=（可重复）"
```

### 4.1 那为什么不把 pb 直接当组件模型

```compare
first: 方案
head: [代价, 结果]
rows:
  - 组件内部直接用 pb 形状:
      - "pb 的字段==全部可选==（proto 生成类型就是 optional），每个消费点都要兜底：`fieldType?.dataType ?? string`、`name?.zhCn ?? ''`、`status === 0` 判断是否停用"
      - "省掉一个 300 行的 resolve，换来模板和 computed 里到处都是 `??`"
  - 组件内部用规范化模型（现在的做法）:
      - "多一次转换（`resolveCrowdMetadata` + `api.ts` 的 `toValueItems`）"
      - "子树只认穷尽联合 `{ type: VALUE_SET, setKey }`，模板里不用兜底"
```

!!真正的理由不是「不好改组件内部模型」，而是线路形状还没定稿。!!

技术方案自己写着：字段名按 proto 走 snake_case，但「HTTP 序列化后是否转成 camelCase、I18nText 的键是不是 zh-CN，待确认」；`value` 现在还是 JSON 标量字符串（proto 里用 string 传标量的通用约定）。如果把组件的公开模型钉死在这些还没定的线路细节上，协议一改成 snake_case 或 `zh_cn`，组件、宿主、测试就得跟着改一轮。

```callout
tone: violet
icon: 🧭
text: |
  组件**对外 prop** 收的确实是 pb（`metadata: CrowdMetadata`），但那是入口处一次性 resolve。
  **注入函数的返回值**用的是组件自己的 `ValueItem` —— 这两个位置性质不同：前者是「进来的数据要翻译一次」，
  后者是「公开契约不该被某个协议的当前写法绑住」。适配层就是那条缝：线路怎么变，只改一处。
```

## 05 · 服务端这两个接口

两个 GET，都没有 body。区别在参数语义和数据的住处。

```spec
title: GET /api/crowd/value-sets
subtitle: 一份共享候选值集合 · 数据在 MySQL
tone: green
rows:
  - k: 输入
    v: |
      `setKey` 必填。
  - k: 处理
    code: |
      const setKey = queryString(request.query, 'setKey');
      if (!setKey) return reply.status(400).send({ code: 'MISSING_SET_KEY', message: 'setKey is required' });
      const set = (await getMetadataRows()).valueSets.find((item) => item.setKey === setKey);
      if (!set) return reply.status(404).send({ code: 'UNKNOWN_VALUE_SET', message: `Unknown value set: ${setKey}` });
      return toValueSet(set);
  - k: 输出
    v: |
      pb 形状：`{ key, name, dataType, status, items[] }`。
      `items[].value` 是 **JSON 标量字符串**（服务端 `JSON.stringify`），`label` 是 `zhCn / zhHk / en`，`status` 是数字。
  - k: 两个「照样返回」
    v: |
      集合已停用照样返回；集合里某一条已停用也照样返回（带 `status: 0`）。两者都是为了回显历史条件。
```

```spec
title: GET /api/crowd/resolver-options
subtitle: 动态候选 · 数据在内存常量表（demo 是 21 只股票）
tone: amber
rows:
  - k: 输入
    v: |
      `resolverKey` 必填。`keyword` 搜索；`values` 按已保存取值回显名称（可重复传多值）。
  - k: 优先级
    v: |
      ==`values` 非空时，`keyword` 和 `limit` 都不看==；两者都空时返回空列表，所以「打开下拉但不输入」在 demo 里就是空的。
  - k: 搜索规则
    code: |
      const matched = STOCKS.filter((item) => {
        if (item.value.toLowerCase().includes(needle)) return true;
        return Object.values(item.label).some((label) => label.toLowerCase().includes(needle));
      }).slice(0, limit);
  - k: limit
    v: |
      默认 20，最大 50（`queryLimit`），**只限制搜索**，不影响 `values` 回显。
  - k: 错误码
    v: |
      缺参 400 `MISSING_RESOLVER_KEY`；未知解析器 404 `UNKNOWN_RESOLVER`。
```

### 5.1 那两个接口读的「内存快照」是什么

上面说 `value-sets` 从「内存快照」里取集合 —— 这份快照就是**六张元数据表的全量读模型**（`MetadataRows`），服务端进程里只留一份，5 秒过期。它由 `getMetadataRows()` 维护：

```text
// apps/server/src/metadata/source.ts
const CACHE_TTL_MS = 5_000;

export async function getMetadataRows(): Promise<MetadataRows> {
  if (cached && Date.now() < expiresAt) return cached;   // 5 秒内：直接用快照
  if (inflight) return inflight;                          // 并发请求复用同一个查询
  const pending = loadMetadataRows({ enabledOnly: false }) // 六张表全量读一次
    .then(rows => { assertMetadataRows(rows); cached = rows; expiresAt = Date.now() + CACHE_TTL_MS; return rows; });
  inflight = pending;
  return pending;
}
```

三个字段各管一件事：`cached` 是快照本身，`expiresAt` 是它的死期，`inflight` 让同一个 5 秒窗口内的并发请求共用一次 MySQL 查询（避免缓存击穿时打出一串重复查询）。

==这份快照不只喂 `value-sets`：`/api/crowd/metadata`、`/api/crowd/catalog`、预览（`/api/preview`）和创建快照（`/api/snapshots`）读的都是它== —— 所以「改一行 MySQL，最多 5 秒后整条链路一起变」。这也是为什么 demo 里改配置能立刻在界面上看到效果。

```compare
first: 位置
head: [快照在哪, 多久变一次]
rows:
  - 服务端进程（demo）:
      - "`getMetadataRows()` 的 `cached`，全量读本机 MySQL"
      - "5 秒 TTL，或 `resetCatalogCache()` 立即失效"
  - 线上（技术方案）:
      - "元数据归 Data Admin，BFF 通过 Metadata API 取；缓存退到 BFF 或 Data Admin 一侧"
      - "语义不变：==不是每个请求都去问上游=="
  - 浏览器:
      - "页面重新获得焦点时重新拉一份 `metadata`；`revision` 没变就复用原对象、也不清值集合缓存"
      - "跟着服务端的 5 秒走"
```

宿主那边则是另一层：页面重新获得焦点时刷新字典，`revision` 没变就不重建对象、也不清缓存。

## 06 · 边界：六处不那么直觉的地方

```cards
cols: 2
items:
  - title: 停用值要回来
    desc: 停用是改 status，不是删行
    tone: amber
    body: |
      `enum_content` 里的条目 `status: 0` 之后仍然出现在响应里，宿主把它映射成 `disabled: true`。
      这样历史条件回显时下拉里还找得到「深圳」，只是新条件选不了它。
      ==如果服务端过滤掉停用值，历史条件会显示成一个裸的 `440300`。==
  - title: 空关键词 = 空列表
    desc: demo 的解析器不返回「默认一批」
    tone: blue
    body: |
      `if (!needle) return { items: [], nextCursor: null }`。打开下拉会发一次空搜索，但结果是空的。
      真实解析器可能返回热门项 —— 那是 `searchResolver` 的实现自由，不是协议的约定。
  - title: 没有防抖
    desc: 方案里写了，代码里没有
    tone: red
    body: |
      `packages/combination/src/` 里没有 `debounce`、没有 `setTimeout`。每次输入都发一次请求，
      靠的是 token 丢弃旧响应，而不是合并请求。==请求量按流量算，不按意图算。==
  - title: Element Plus 会自清查询
    desc: 远程搜索后的那次回调是坑
    tone: amber
    body: |
      远程搜索结束后，el-select 会把查询清空并再触发一次 `remote-method`，回调参数是空串。
      不判断的话，刚写进 `remoteItems` 的结果会被这次空搜索覆盖成空列表。
      `RelationRow` 用 `currentObjectQuery()` 读真实输入框来挡。
  - title: 缓存的两级失效
    desc: 一级在宿主，一级在页面
    tone: green
    body: |
      宿主：`staffId` 变化或 metadata `revision` 变化 → `reset()` 清 `cache` 与 `inflight`。
      页面：重新获得焦点 → `loadMeta()`；`revision` 相同则复用原 metadata 对象，不触发下游 watch。
  - title: 兜底显示原值
    desc: 换不到名字也要能看
    tone: violet
    body: |
      解析器里查不到那个 value 时，`shownItems` 用 `{ value, label: String(value) }` 兜底 ——
      标签位上显示原始的 `00700.HK`。==宁可难看，不可留空。==
```

### 跑一遍两条链路

下面这个模拟按真实顺序放四幕：值集合（一次请求）、动态搜索（两次，其中一次被丢弃）、回显（一次）。左边是事件流，右边是组件里那几个 `ref` 的值。

```demo
widget: cand-pipe-lab
title: 四幕：值集合 → 搜索 → 竞态 → 回显
hint: 点「开始模拟」
panes:
  - log: main
    tag: 事件流
    tone: blue
    head: 组件 → 注入层 → 宿主 → 服务端
    sub: 每一条都是链路上真实发生的动作
    foot: [4 次请求, 1 次被 token 丢弃]
  - log: state
    tag: 状态快照
    tone: violet
    head: 组件里的 ref
    sub: 每一步之后这些值是什么
    foot: [setKey, remoteItems, shownItems]
```

## 07 · 速查

```compare
first: 维度
head: [值集合 VALUE_SET, 动态候选 DYNAMIC]
rows:
  - 触发时机:
      - "选中字段时自动拉一次（watch valueSource）"
      - "打开下拉 / 每次输入关键词"
  - 请求参数:
      - "`setKey`"
      - "`resolverKey` + `keyword`，回显时用重复的 `values`"
  - 接口:
      - "`GET /api/crowd/value-sets`"
      - "`GET /api/crowd/resolver-options`"
  - 数据在哪:
      - "MySQL `crm_dc_value_set.enum_content`，经 5 秒 TTL 投影"
      - "代码里的常量表（demo 21 条）"
  - 返回值:
      - "整集合（含停用项），宿主缓存"
      - "命中的一小批，不缓存，每次覆盖 remoteItems"
  - 停用态:
      - "有：`status: 0` → `disabled: true`"
      - "没有：动态候选不带停用"
  - 覆盖风险:
      - "快速换字段：`ticket` 丢弃旧响应"
      - "快速改关键词：`searchToken` 丢弃旧响应"
  - 缺失时怎么办:
      - "整集都在，不会缺"
      - "`values=` 反查换名字，查不到就用原值显示"
```

```checklist
tone: warn
items:
  - 以为 metadata 里带着候选值（它只有 setKey / resolverKey）
  - 以为「打开下拉没数据」是 bug（空关键词本来就返回空）
  - 给动态候选加了缓存（它是每次覆盖的实时结果）
  - 在组件包里找 HTTP 请求（没有，全在宿主）
```

```checklist
items:
  - 组件只消费 metadata + 三个注入函数，不碰 HTTP
  - value 集合按 setKey 缓存，inflight 复用，staffId / revision 变化即清
  - 停用项照常返回、渲染成 disabled，保证历史条件可回显
  - 每条异步链路都有票据（ticket / searchToken / objectSearchToken / propLoadToken）
  - 换不到名字时用原值兜底，不留空
```

```quiz
- q: 为什么 metadata 接口里看不到候选值？
  a: |
    设计和消费解耦：metadata 只是字段字典，回答「这个字段有没有候选值来源、去哪取」（`enumType` + `setKey` / `resolverKey`）。
    候选值可能很大、可能是实时的（股票搜索），塞进字典会让每次刷新字典都带上几万条数据。所以值是另一条按需的请求。
- q: 值集合字段，改一下操作符会再发一次请求吗？
  a: |
    不会。`useStoredItems` watch 的是 `valueSource`，只有换字段（换 setKey）才重新拉。
    改 op、改值都只是草稿变化，不触发取值。
- q: 动态候选下拉打开后是空的，怎么排查？
  a: |
    先看服务端：`searchResolver` 对空关键词直接返回空列表，这是当前实现的选择（打开时的空搜索拿不到候选）。
    再看请求有没有带上关键词；如果关键词有值仍然是空的，看 `values`/`keyword` 是否传混（`values` 非空会忽略 `keyword`）。
    最后看 `remoteItems` 是否被 Element Plus 的二次空搜索覆盖。
- q: 两个注入函数都返回 `undefined` 会怎样？
  a: |
    组件不会抛错：`inject(key, async () => [])` 给了默认空实现，壳里又用 `?? Promise.resolve([])` 兜了一层。
    表现是下拉永远为空、搜索无结果 —— 组件可以脱离宿主独立渲染，只是没有候选值。
- q: 草稿里有一个搜索不到的历史取值，下拉里会显示成什么？
  a: |
    `watch(modelValue, resolveSelected)` 会用 `values=` 向解析器反查一次名字；查到就用中文名，查不到用 `String(value)` 兜底。
    两种情况都能在列表里看到它，不会因为不在候选里就消失。
```

```summary
title: 一句话
text: |
  `metadata` 是**字典**（只有 `setKey` / `resolverKey`）；候选值是**现取的**：值集合一次拉全集并按 setKey 缓存，动态候选每次输入都打一次 `resolver-options`，两条路都在「宿主 App」这一层落成 HTTP。
```
