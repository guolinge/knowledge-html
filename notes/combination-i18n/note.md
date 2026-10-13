[组合器全景](../combination-overview/) 讲了组件包由哪些文件组成，[组件机制](../combination-mechanics/) 讲了它怎么工作。这一篇回答一个更小的问题：

**圈选界面上每一个字，是谁翻译出来的？**

答案有两个。组件自带的界面文案（`圈选条件`、`查询`）和 Data Admin 配置的数据名字（`近30天成交笔数`、`港股`），走的是两条完全不同的链路：一条是本地的三语词条，切语言下一帧就变；另一条是服务端按请求语言挑好的一种名字，切语言要重新拉。混在一起想，就会问出「组件为什么不自己带一套 i18n」这种看着合理、方向错了的问题。

```callout
tone: blue
icon: 🧭
text: |
  **两条线**：机制线 00–06（界面文案：谁翻译、怎么装、怎么查、切语言为什么立刻变），
  数据线 07–08（Data Admin 的字段名，单语、要重新请求）。

  **机制线的读法**：四个零件（02）→ 宿主装配（03）→ 组件实例（04）→ t() 查表（05）→
  切语言为什么重画（06）。卡在 `scope` 和 `t()` 就从 02 顺着读。

  机制结论都是实测：SSR 探针跑 vue-i18n 9.14.5 + 源码行号，协议取 FService 协议空间
  `crm-crowd-service` v1.0.3（commit `51ede78d`）。
```

## 00 · 界面上同时住着两种字

一个真实的圈选页上有这样两句话：

```text
圈选条件                              ← 组件包里写死的标题
  近30天成交笔数 >= 12                ← Data Admin 里配置的字段名
```

它们看起来一样，来源却完全不同。

`圈选条件` 写在 `packages/combination/src/messages.ts` 里，和代码一起发布，三个语言各一份。`近30天成交笔数` 写在 Data Admin 的元数据表里，请求时由服务端按调用方语言挑一种返回，浏览器拿到的时候已经是单语。

==界面文案是代码的一部分，数据名字是数据的一部分。== 发布节奏、语言份数、刷新时机都不同，所以它们各自有一套翻译机制。

## 01 · 两条链路的对照

```compare
first: 维度
head: [界面文案, 数据名字]
rows:
  - 例子: ["`圈选条件`、`查询`、`+ 条件`", "`近30天成交笔数`、`00700.HK`、`港股`"]
  - 谁写的: ["组件包和宿主各写各的", "Data Admin 里配置的元数据"]
  - 语言份数: [{ text: "三语都在本地（47 个 key × 3）", tone: green }, { text: "一次只有一种，看请求带什么语言", tone: amber }]
  - 谁翻译: ["浏览器：`t(key)` 查 global messages", "Data Admin：按 `clientLang` 本地化后下发"]
  - 切语言之后: ["下一帧就变", "要重新请求才变"]
  - 加一条要改哪: ["改组件包或宿主的词条文件", "Data Admin 加一条记录，前端不动"]
```

两条链路在本篇的例子里合流到同一个组件：`InsightCombiner` 用 `t('combinerTitle')` 取标题，用 `label(name)` 显示字段名。取法不同，是因为来源不同。

```callout
tone: amber
icon: 🧮
text: |
  `packages/combination/src/messages.ts` 实测：`zhCN` / `zhHK` / `en` 三个语言桶各 **47 个 key**，
  合计 141 行词条。三个桶共用同一个 `typeof zhCN` 约束，漏一个 key 编译不过。
```

## 02 · useI18n 给的四个东西

`useI18n()` 是 Vue 的 composable（组合式函数），只在 `setup()` 里调用一次。它返回一套「给当前组件用的」查词条 API，同时定下「查哪一份词条」。和本篇有关的四个：

```cards
cols: 2
items:
  - { title: "useI18n()", desc: "在 setup() 里调用一次，把 API 绑到当前组件实例，并决定用哪个 composer", tag: 入口, tone: blue }
  - { title: "composer", desc: "翻译器本体：locale + messages + fallback 规则打包成一个执行体。global 由宿主 app.use(i18n) 建，local 由组件自己建", tag: 两份来源, tone: violet }
  - { title: "messages", desc: "按语言分桶的树，key 用 `.` 走层级：`t('group.title')`", tag: 查什么, tone: green }
  - { title: "locale", desc: "当前语言，响应式；`t()` 每次调用都读它当时的値", tag: 查哪个桶, tone: amber }
```

四个东西在代码里长这样：

```ts
const { t, locale } = useI18n({ messages, useScope: 'local' });  // 略去 options 就是 global

t('combinerTitle');        // '圈选条件'（当前 locale = 'zh-cn'）
locale.value = 'en-us';    // 响应式：改它，用到 t 的模板会重渲染
t('combinerTitle');        // 'Conditions'
```

```callout
tone: amber
icon: ⚠
text: |
  `useI18n()` 有两个前提，踩了都不报在页面上，只报在控制台：

  - `createI18n({ legacy: false })`：用 legacy 模式（默认）时 `useI18n()` 抛 `Not available in legacy mode`。
  - 宿主得先 `app.use(i18n)`：没装时抛 `Need to install with app.use function`。
```

## 03 · 宿主装配：global composer 是怎么建起来的

装配发生在宿主的入口文件里，一共四步：

```ts
// client/src/main.ts
const i18n = createI18n({ legacy: false, locale, fallbackLocale, messages: {...} });  // ① 词条在这里合并
app.use(i18n);                                                                        // ② 触发 vue-i18n 的 install
```

`createI18n` 收到的 `messages` 已经是「宿主词条 + 组件词条」合并后的树；`app.use(i18n)` 调用 vue-i18n 的 `install(app)`，它做两件事：把 i18n 实例 `provide` 到 app 上（`vue-i18n.mjs:2271` 的 `app.provide(app.__VUE_I18N_SYMBOL__, i18n)`），再给 Options API 挂 `$t`。做完这两步，==全应用就有了一根注入管和一份共用的 composer==：

```arch
svg: i18n-setup
maxScale: 1.3
caption: 装配期四个零件。词条在 createI18n 之前就合并好；app.use(i18n) 之后，provide 出一根贯穿组件树的注入管。点零件看它装了什么。
frames:
  - id: entries
    flat: true
    boundary: 0
    kind: contains
    label: 宿主工程 · 两处词条（跟代码一起发布）
    detail: 宿主的业务文案在 common/i18n/*.json，组件包的界面文案在 messages.ts（47 个 key × 3 语）。两处都跟各自的代码一起发布。
  - id: vuei18n
    boundary: 1
    kind: contains
    label: vue-i18n 实例（createI18n 产物）
    detail: i18n.global 就是 04 节说的 global composer：locale、messages、fallback 规则都装在里面。
  - id: appinst
    flat: true
    boundary: 2
    kind: contains
    label: Vue app 实例（createApp 产物）· provide 发生在这里
    detail: install 把 i18n 实例 provide 到 app 上。这个 symbol 之后被每一个组件 inject。
bodies:
  hostmsg:
    rows:
      - { k: 内容, v: "页面标题、按钮、提示语" }
      - { k: 发布, v: 跟宿主一起发版 }
      - { k: 与组件词条, v: 合并时宿主优先 }
  combomsg:
    rows:
      - { k: 内容, v: "圈选条件 / 包含 / 查询…" }
      - { k: 体量, v: "47 个 key × 3 语言" }
      - { k: 发布, v: "@futuweb/audience-combination 发版" }
      - { k: 谁合并, v: "宿主，见左下的 client/src/locale.ts" }
  merge:
    rows:
      - { k: 宿主词条, v: "common/i18n/*.json" }
      - { k: 组件词条, v: "combinationMessages（47 key × 3）" }
      - { k: 同名 key, v: 宿主覆盖组件 }
  i18n:
    badge: createI18n 的产物
    rows:
      - { k: i18n.global, v: global composer 本体, link: composer }
      - { k: legacy, v: "false（useI18n 的前提）" }
  composer:
    rows:
      - { k: locale, v: "ref('zh-cn')，响应式" }
      - { k: messages, v: 两处词条合并后的树 }
      - { k: fallbackLocale, v: "'zh-cn'（vue-i18n 默认 en-US）" }
      - { k: fallbackRoot, v: "true（local 缺键时回落 root）" }
  app:
    rows:
      - { k: 产物, v: "一个 Vue 应用实例" }
      - { k: 它提供, v: "组件树 + 依赖注入的根" }
      - { k: 谁在用, v: "app.use(i18n) → install" }
  provide:
    rows:
      - { k: 注什么, v: "(symbol, i18n) 这一对" }
      - { k: symbol, v: "app.__VUE_I18N_SYMBOL__" }
      - { k: 谁取, v: "每个组件的 inject(symbol)（下一张图）" }
      - { k: 取回后, v: "还要读 i18n.global 才是 composer" }
  install:
    rows:
      - { k: ①, v: "app.provide(symbol, i18n)", link: provide }
      - { k: ②, v: "injectGlobalFields：给 Options API 挂 $t" }
      - { k: ③, v: "注册 <i18n-t> 组件与 v-t 指令" }
tours:
  - id: boot
    label: 装配顺序
    steps:
      - { at: [hostmsg, combomsg], text: "两处词条在宿主工程里合并，==同名 key 宿主覆盖组件==。" }
      - { at: [merge, i18n], text: "合并结果作为 messages 传给 createI18n；它返回 i18n，i18n.global 就是那个 composer。" }
      - { at: [install, provide], text: "app.use(i18n) 触发 install：provide 出注入管，再给 Options API 挂 $t。" }
```

```callout
tone: amber
icon: ⚠
text: |
  ==两个「没装好」都发生在这一步==，报错也在控制台：

  - 没 `app.use(i18n)`：组件里 `useI18n()` 抛 `Need to install with app.use function`，
    因为 `inject` 找不到 symbol（`vue-i18n.mjs:2437`）。
  - `createI18n({ legacy: true })`（默认）：`useI18n()` 抛 `Not available in legacy mode`。
```
## 04 · 组件实例：provide 一根管，inject 拿 composer

挂载之后，组件树里每个实例在 `setup()` 里各自调用一次 `useI18n()`。它内部只做了三步（`vue-i18n.mjs:2339`）：

```ts
const instance = getCurrentInstance();          // ① 当前组件实例；setup 外调用直接抛错
const i18n = inject(app.__VUE_I18N_SYMBOL__);   // ② 沿注入管拿回 i18n 实例
const gl = i18n.global;                         // ③ scope=global 时，返回值就是 gl 本体
```

```arch
svg: i18n-instances
maxScale: 1.3
caption: 左侧的 app 实例提供一根注入管；右边组件树里每个实例 inject 到的是同一个 gl。声明 local 的那个组件会自建一份 composer，挂在实例注册表上，并拿一根 __root 指针指回 gl。
frames:
  - id: tree
    flat: true
    boundary: 0
    kind: contains
    label: 挂载后的组件实例树（每个实例 setup 时各自 useI18n()）
    detail: 12 个组件（组合器本体 + 11 个子组件）都调 useI18n()，没有任何一处自建 i18n 实例。
  - id: localscope
    boundary: 1
    parent: tree
    kind: contains
    label: 声明 local 的实例 · local composer 挂在这一层，不往下传
    detail: 框里只有声明它的那一个实例。local composer 存在实例注册表里（Map<instance, composer>），从不 provide，右边的子组件虽然在组件树上属于它，inject 到的仍然是 gl。
bodies:
  host:
    rows:
      - { k: 做过什么, v: "provide(symbol, i18n)（03 节）" }
      - { k: 现在干嘛, v: "被每个实例 inject" }
      - { k: 它不认识, v: "任何组件里的 t()" }
  combiner:
    rows:
      - { k: setup, v: "useI18n()" }
      - { k: 内部, v: "getCurrentInstance → inject(symbol)", link: host }
      - { k: scope, v: "global → 返回 gl 本体", link: gl }
  parentLocal:
    badge: 带 local composer
    rows:
      - { k: setup, v: "useI18n({ useScope: 'local' })" }
      - { k: 内部, v: "createComposer({ __root: gl })", link: gl }
      - { k: 注册, v: "__setInstance(instance, composer)", link: registry }
  child:
    rows:
      - { k: 体量, v: "11 个组件，逐个都调 useI18n()" }
      - { k: scope, v: "global（不传 options）" }
      - { k: 内部, v: "同 combiner：inject(symbol) → gl" }
  kid:
    rows:
      - { k: 父组件, v: "左边那个有 local 的实例" }
      - { k: 自己 inject, v: "只认 symbol → gl" }
      - { k: 结果, v: "父的 local 里的 key 在这里查不到" }
  gl:
    rows:
      - { k: locale, v: "ref('zh-cn')，响应式（06 节讲它怎么触发重渲染）" }
      - { k: messages, v: 两处词条合并后的树 }
      - { k: fallbackLocale, v: "'zh-cn'" }
      - { k: fallbackRoot, v: "true（05 节的回落开关读它）" }
  registry:
    rows:
      - { k: key, v: 组件实例 }
      - { k: value, v: 该实例的 composer }
      - { k: local 缺键, v: "沿 __root 回到 gl" }
tours:
  - id: inject
    label: 一次 useI18n() 的诞生（global）
    steps:
      - { at: [host], text: "装配期 provide(symbol, i18n)，即上一张图的那根管。" }
      - { at: [combiner], text: "setup() 里 useI18n()：getCurrentInstance() 拿到当前实例，inject(symbol) 拿回 i18n。" }
      - { at: [gl], text: "scope=global（不传 options）→ 返回值就是 gl 本体。" }
  - id: localbirth
    label: 一次 local composer 的诞生
    steps:
      - { at: [parentLocal], text: "useScope: 'local' → createComposer({ messages, __root: gl })：__root 指回全局那一份。" }
      - { at: [registry], text: "__setInstance(instance, composer)，挂在实例注册表上，==只属于这个实例==。" }
      - { at: [kid], text: "子组件 useI18n() 仍然 inject(symbol) 拿到 gl：父的 local 从来不在这根管里。" }
facts:
  combiner: { "composer": gl 本体, "messages": 宿主 + 组件词条, "生命周期": 跟组件实例 }
  parentLocal: { "composer": 自己建的 local, "messages": "useI18n 传入的那份", "缺键回落": "沿 __root 回 gl" }
  kid: { "composer": gl 本体, "messages": 宿主 + 组件词条, "父子传递": 看不到父的 local }
```


一张 20 行的探针就能验证（`vue` + `vue-i18n` 9.14.5，SSR 渲染）：

```ts
const child = defineComponent({
  setup() {
    const { t } = useI18n();                                    // 不传 options = global
    return () => h('span', `child: combinerTitle=${t('combinerTitle')} | onlyLocal=${t('onlyLocal')}`);
  },
});
const parent = defineComponent({
  setup() {
    const { t } = useI18n({ messages: { 'zh-cn': { onlyLocal: '只写在 local 里' } }, useScope: 'local' });
    return () => h('div', [`parent: ${t('onlyLocal')}`, h(child)]);
  },
});
// 宿主只合并了组件词条里的 combinerTitle，没有 onlyLocal
```

真实输出：

```text
parent: 只写在 local 里
child:  combinerTitle=圈选条件 | onlyLocal=onlyLocal
```

三件事一次说清：

| 观察 | 说明 |
|---|---|
| 父组件 `onlyLocal` 渲染成 `只写在 local 里` | local scope 对**自己**生效 |
| 子组件 `combinerTitle` 渲染成 `圈选条件` | 子组件能从 global 拿到**宿主合并进来**的组件词条 |
| 子组件 `onlyLocal` 渲染成 `onlyLocal` | 子组件读不到父的 local，vue-i18n 找不到 key 就把 key 原样返回 |


### 为什么 local 不会传给子组件


==子组件永远读不到父组件的 local scope。== 这不是配置问题，是 vue-i18n 的设计：local scope 只服务于声明它的那个实例，不做树形继承。

!!笔记里的 `useScope: 'local'` 常被当成「给这棵子树设置语言」，实际只覆盖当前组件一层。!!


```callout
tone: violet
icon: 🔬
text: |
  源码里这条规则看得见（`vue-i18n.mjs:2378`）：local composer 通过
  `i18nInternal.__setInstance(instance, composer)` 存进**以组件实例为键的注册表**，
  从不 `provide`。子组件的 `useI18n()` 只会 `inject(symbol)` 拿回应用级的 i18n，
  再走一遍 global 分支，父实例的 local 不在这根管里。

  顺带：local composer 身上带着 `__root = gl`（创建时塞进去的），
  05 节「local 缺键回落 root」那条线走的就是它。
```
## 05 · t() 是一次查表

把 `t()` 当作「按 key 查表」的函数，后面就好读了：==t 的行为 = 查哪一份表 × 查哪个语言桶 × 没查到怎么办。==

```flow
grid: true
nodes:
  - { id: use, label: "useI18n()", sub: "拿到 composer + locale", row: 0, kind: frontend }
  - { id: t, label: "t('combinerTitle')", sub: "在当前 composer 上执行", row: 1 }
  - { id: find, label: "messages[locale] 按 key 逐层找", sub: "key 里的 . 就是层级", row: 2 }
  - { id: hit, label: "返回字符串", sub: "'圈选条件'", row: 3, tone: green }
  - { id: miss, label: "按顺序回落", sub: "root → fallbackLocale", row: 3, tone: amber }
  - { id: key, label: "返回 key 本身", sub: "控制台 warn", row: 4, tone: red }
edges:
  - { from: use, to: t }
  - { from: t, to: find }
  - { from: find, to: hit, label: "命中" }
  - { from: find, to: miss, label: "没命中" }
  - { from: miss, to: key, label: "仍未命中" }
```

回落的顺序（每步命中就停）：

```compare
first: 步骤
head: [命中就返回, 没命中就往下]
rows:
  - "① `composer.messages[locale]` 按 key 逐层找": ["返回字符串，最常见的一条", "往下走"]
  - "② 回落 root（local → global）": ["返回 global 里的值", "往下走"]
  - "③ 回落 fallbackLocale": ["返回 fallback 语言里的值", "往下走"]
  - "④ 都没有": ["—", "返回 key 本身 + 控制台 warn"]
```

### 实测：六种输入的真实输出

用 SSR 探针跑（vue 3.5.43 + vue-i18n 9.14.5，global messages 是 `{ 'zh-cn': { g: '全局中文', group: { title: '分组标题' } }, 'en-us': {...} }`，local messages 是 `{ 'zh-cn': { l: '本地中文', g: '本地覆盖' } }`）：

```compare
first: 调用
head: [真实输出, 说明]
rows:
  - "`t('group.title')`": ["`分组标题`", "key 里的 `.` 就是层级"]
  - "`t('l')`（只在 local 里）": ["`本地中文`", "local 里有就用 local 的"]
  - "`t('g')`（local 和 global 都有）": ["`本地覆盖`", "同名时 local 赢"]
  - "`t('hostOnly')`（local 没有、global 有）": ["`宿主中文`", "回落 root（global）"]
  - "`t('nope')`（哪都没有）": ["`nope`", "原样返回 key，控制台一条 warn"]
  - "`locale` 改成 `en-us` 后再 `t('combinerTitle')`": ["`Conditions`", "`t()` 每次读当前 locale"]
```

下面这个控件把这些行为做成可点的查表器：选 composer、语言、key，看它一步步落。

```demo
widget: i18n-lookup
actions: false
title: t(key) 在哪里命中，又在哪里落空
config:
  langs:
    - { id: zh-cn, label: 简体中文 }
    - { id: en-us, label: English }
  fallbackLocale: zh-cn
  global:
    zh-cn: { combinerTitle: 圈选条件, hostOnly: 宿主中文, group: { title: 分组标题 } }
    en-us: { combinerTitle: Conditions, group: { title: Group title } }
  local:
    zh-cn: { combinerTitle: 本地覆盖, localOnly: 只在 local 里 }
    en-us: { combinerTitle: local override }
  keys:
    - { key: combinerTitle, note: 两份都有 }
    - { key: hostOnly, note: 只在 global }
    - { key: localOnly, note: 只在 local }
    - { key: group.title, note: 嵌套键，只在 global }
    - { key: nope, note: 哪都没有 }
```

> 控件按上面的查找顺序模拟；`fallbackLocale` 那一步简化成「在 global 里再找一次」。

### 一个反直觉的细节：fallbackRoot 在 local 上取的是 root 的

````callout
tone: red
icon: 🩸
text: |
  local composer 找不到 key 时会回落 global（`fallbackRoot` 默认 `true`）。想关掉它，
  在组件里写 `useI18n({ useScope: 'local', fallbackRoot: false })` ==不生效==：

  ```js
  // vue-i18n 9.14.5 · vue-i18n.mjs:2601
  const _fallbackRoot = isLocalScope
      ? root.fallbackRoot                              // ← local 用 root 上那一份
      : isBoolean(options.fallbackRoot) ? options.fallbackRoot : true;
  ```

  实测：组件里写 `false` 仍会回落（拿到 `宿主中文`）；改在 `createI18n({ fallbackRoot: false })`
  上写，才真的不回落（拿到 key `hostOnly`）。demo 里那个开关模拟的就是 root 上这一份。
````

## 06 · locale 一变，为什么整片文案立刻重画

前两节讲的是「谁持有哪份 composer」。这一节回答另一个问题：切语言之后，为什么界面文案**下一帧就变**，而字段名不变。

秘密只有一句话：==`composer.locale` 是一个响应式 ref，而 `t()` 在渲染时读了它。==

```ts
// vue-i18n.mjs:466：composer.locale 是个 computed，背后是 _locale 这个 ref
const locale = computed({
  get: () => _locale.value,
  set: (val) => { _locale.value = val; /* ... */ },
});
```

组件渲染时调用 `t('combinerTitle')`，解析过程读了 `_locale.value`，Vue 就把「这个渲染 effect 依赖 locale」记进依赖表。之后宿主执行 `i18n.global.locale.value = 'en-us'`，Vue 把依赖它的渲染函数重新执行一遍 —— 整片文案就换了：

```arch
svg: i18n-render
maxScale: 1.3
caption: 一次切语言的完整链路：宿主改 locale ref → Vue 依赖表把读过它的渲染函数标为失效 → 重跑 → DOM 换文案。右下角那条虚线是对照：字段名不在这条链上，要重新请求才变。
frames:
  - id: trigger
    flat: true
    boundary: 0
    kind: contains
    label: 触发 · 宿主切语言
    detail: 用户在语言选择器上点一下，或者主应用 context 的 locale 变了；applyLocale 把新值写进 composer 的 locale ref。
  - id: reactive
    boundary: 1
    kind: contains
    label: 响应式 · Vue 记得谁读过 locale，谁就得重跑
    detail: 渲染函数执行时读过 _locale.value（t 内部读的），这个 effect 就被登记在 locale 的依赖里。locale 一变，它们全部失效。
  - id: paint
    boundary: 2
    kind: contains
    label: 渲染 · 重新执行一次
    detail: 重新执行的是渲染函数，不是重新挂载组件，setup() 不会再跑一遍。
  - id: contrast
    flat: true
    boundary: 3
    kind: contains
    label: 对照 · 不在这条链上的一半
    detail: Data Admin 下发的字段名是普通数据，没有依赖 locale，服务端也不会回调浏览器，它要重新请求才会变，见 08 节。
bodies:
  apply:
    rows:
      - { k: 写什么, v: "i18n.global.locale.value = 'en-us'", link: dep }
      - { k: 谁触发, v: "宿主 locale 变化（applyLocale）" }
      - { k: 还会做, v: "dayjs / Element Plus 的语言也跟着切" }
  dep:
    rows:
      - { k: 谁在里面, v: "渲染时调过 t() 的那些组件" }
      - { k: 怎么登记, v: "t() 读 _locale.value，effect 被收集" }
      - { k: 没读过的, v: "不受影响，不重跑" }
  rerender:
    rows:
      - { k: 是重跑, v: 不是重新挂载 }
      - { k: setup(), v: 不会再执行一次 }
      - { k: 代价, v: "一次 diff，通常只有文本节点变化" }
  render:
    rows:
      - { k: 这次读到, v: "locale = 'en-us'" }
      - { k: 查表过程, v: "就是 05 节那条链", link: dom }
  name:
    rows:
      - { k: 来源, v: "GET /api/crowd/metadata" }
      - { k: 生命周期, v: "跟页面数据走，不跟 locale" }
      - { k: 切语言, v: "重新请求才变（08 节）", link: dom }
tours:
  - id: switch
    label: 切一次语言的完整路径
    steps:
      - { at: [switch, apply], text: "宿主切语言 → applyLocale：把 'en-us' 写进 composer 的 locale ref。" }
      - { at: [dep], text: "Vue 的依赖表里，渲染时读过 locale 的那些 effect 全部失效。" }
      - { at: [rerender, render], text: "它们被重新执行；这一次 t('combinerTitle') 读到的是 'en-us'。" }
      - { at: [dom], text: "DOM 里的文案换掉。==全程没有任何网络请求。==" }
      - { at: [name], text: "字段名在另一条链上：它是服务端下发的一份普通数据，不跟着重跑。" }
facts:
  dom: { 值从哪来: "i18n.global.messages", 切语言: 重跑渲染函数, 要请求吗: 不要 }
  name: { 值从哪来: "宿主自己那份 ref", 切语言: 重新请求 Data Admin, 要请求吗: 要 }
```

实测（`watchEffect` 等价于组件渲染 effect）：

```ts
const i18n = createI18n({ legacy: false, locale: 'zh-cn', messages: {
  'zh-cn': { title: '圈选条件' }, 'en-us': { title: 'Conditions' } } });

let runs = 0;
const stop = watchEffect(() => { runs += 1; i18n.global.t('title'); });  // 渲染时调 t()
await nextTick();                     // runs = 1
i18n.global.locale.value = 'en-us';   // 宿主切语言
await nextTick();                     // runs = 2，且 t('title') === 'Conditions'
```

对照：一个什么都不读的 effect，locale 变了它不重跑（`runs` 1 → 1）。

三件事从这里长出来：

| 观察 | 为什么 |
|---|---|
| 界面文案不用重新请求 | 三语词条都在内存里，重跑渲染函数就够了 |
| 整个子树一起变 | 读过 locale 的组件都重跑；没读过的（比如纯渲染 props 的）不动 |
| 字段名不变 | 它是 Data Admin 下发的一份普通数据，不在这条依赖链上 |

```callout
tone: amber
icon: ⚠
text: |
  ==「下一帧就变」有两个边界==，踩了会觉得响应式失灵：

  - 只重跑**读过 locale 的**渲染函数；组件不会重新挂载，`setup()` 不会再执行一次。
  - 词条如果在 `setup()` 里读出来存进普通变量（`const title = t('x')`），它不会跟着变：
    响应式只在渲染函数、`computed`、`watch` 里生效。
```

## 07 · 组件库的契约：词条交出去，实例借用宿主的

组件的 12 个组件全部用 `useLabel()`（内部就是 `useI18n()`），没有一处自建 i18n 实例。这是刻意的：

```cards
cols: 3
items:
  - title: 实例借宿主的
    desc: vue-i18n 是 peerDependency，组件不自己 createI18n
    tag: peerDependency
    tone: blue
    body: |
      `packages/combination/package.json` 里 vue-i18n、vue、element-plus 都是 peerDependency：
      组件用宿主 `app.use(i18n)` 装好的那一个实例，保证 `locale` 只有一份真相。
  - title: 词条交出去
    desc: 导出 combinationMessages，由宿主合并进 global
    tag: combinationMessages
    tone: violet
    body: |
      `messages.ts` 导出 `{ 'zh-CN': ..., 'zh-HK': ..., en: ... }` 三个语言桶共 47 个 key，
      宿主把它们并进自己的 global messages，组件再 `t()` 查。
  - title: 只查不装
    desc: 组件内部不建自己的 i18n，也不读本地存储
    tag: 单一真相
    tone: green
    body: |
      语言由宿主决定（这里来自主应用 context 的 locale）。组件跟着走，不参与语言状态管理。
```

宿主侧要做的事一共三步，第三句就是合并：

```ts
// client/src/locale.ts
import { combinationMessages } from '@futuweb/audience-combination';

export const i18n = createI18n({
  locale: normalizeLocale(getHostContext()?.locale),
  fallbackLocale: LANG.ZH_CN,
  legacy: false,
  messages: {
    [LANG.ZH_CN]: { ...combinationMessages['zh-CN'], ...zhCnMessages },
    [LANG.ZH_HK]: { ...combinationMessages['zh-HK'], ...zhHkMessages },
    [LANG.EN_US]: { ...combinationMessages.en, ...enUsMessages },
  },
});
```

`...combinationMessages['zh-CN']` 在前，宿主自己的词条在后：同名 key 时宿主覆盖组件，业务文案优先。

为什么不让组件自建实例 + local scope？对照一下就清楚了：

```compare
first: 做法
head: [会发生什么, 结论]
rows:
  - "组件自建 `createI18n`，每个组件带自己的词条":
      - "一棵组件树里出现多份 locale 状态，宿主切语言要挨个通知；组件包还得自己装一个 vue-i18n 版本，和宿主那份不是同一个实例时会有两份运行时"
      - { text: 不选, tone: red }
  - "组件用 `useScope: 'local'` 声明词条":
      - "local 只覆盖声明它的那个组件一层（04 节实测），11 个子组件要各自声明一遍，47 个 key 抄 12 份"
      - { text: 不选, tone: red }
  - "词条导出、宿主合并、组件读 global":
      - "locale 只有一份真相，子组件天然能查到词条，组件包不锁 vue-i18n 版本"
      - { text: 当前做法, tone: green }
```

!!只 `app.use(i18n)`、忘了合并 `combinationMessages`，页面上会直接显示 `combinerTitle` 这样的 key。!! vue-i18n 找不到 key 时返回 key 本身，不报错，也不空白。03 节的探针里 `onlyLocal=onlyLocal` 就是同一个行为。

## 08 · 数据名字那一半：由服务端翻译

字段名、关系名、值集合的 label 不归 SDK 管。它们在 Data Admin 里配置，请求时按调用方的语言本地化成**单个字符串**再下发：

```seq
grid: true
participants:
  - { id: b, label: "浏览器 · 宿主 + 组件", sub: "t(key) / label(name)", kind: frontend }
  - { id: n, label: "Node BFF", sub: "GET /api/crowd/*", kind: backend }
  - { id: d, label: "Data Admin", sub: "crm_crowd_service", kind: database }
messages:
  - { from: b, to: b, label: 宿主合并词条, kind: self }
  - { from: b, to: n, label: "拉元数据", kind: sync, note: 1 }
  - { from: n, to: d, label: "header 带 clientLang", kind: sync, note: 2 }
  - { from: d, to: n, label: "name 已是当前语言", kind: reply, note: 3 }
  - { from: n, to: b, label: "portraits[].name", kind: reply, note: 4 }
  - { from: b, to: b, label: 文案立刻变, kind: self }
  - { from: b, to: n, label: "数据名字要再拉", kind: sync, note: 5, gap: 30 }
```

语言参数不是前端传的 query，而是 BFF 的调用头里带下去的：

```js
// @futu/agudo 的 helper：把当前请求的语言塞进下游 header
const { ..., lang = 0 } = this.ctx.env || {};
return { ..., clientLang: lang };
```

`crm_crowd_service` 的 proto 里，`name` / `label` 的注释写的就是「当前请求语言下的名称」，形状是一个 `string`：

```proto
message CrowdPortrait {
  optional string key = 1;    // 特征标识 field_key
  optional string name = 2;   // 当前请求语言下的名称
  optional FieldTypeMeta field_type = 3;
  ...
}
```

所以组件的 `label()` 现在要接两种入参。这是 03 与 04 两条链路的分界线：

```ts
/** string：Data Admin 下发的名称，已本地化，直接透传；I18nText：SDK 自带的本地词条，按 locale 挑键。 */
export type LabelText = string | I18nText | undefined;

function label(text: LabelText): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  const current = normalizeLabelLocale(locale.value as string);
  return text[current] || text['zh-CN'] || text['zh-HK'] || text.en || '';
}
```

SDK 自带的操作符表（`OPERATOR_DISPLAY` 的「等于」「最近 {0} 天」）仍然是三语的 `I18nText`，走 `label()` 的第二条分支；Data Admin 下发的名字走第一条分支，不再查 locale。

下面的控件把两条链路放在同一个页面上切一次语言：左栏文案立刻换，右栏的数据名字会先标记成「过期」，等你点重新请求才更新。

```demo
widget: i18n-lab
actions: false
title: 切一次语言，看两种字各自怎么变
config:
  langs:
    - { id: zh-cn, label: 简体中文 }
    - { id: zh-hk, label: 繁體中文 }
    - { id: en-us, label: English }
  copy:
    zh-cn: { title: 圈选条件, include: "包含(应在用户群内的用户)", query: 查询 }
    zh-hk: { title: 圈選條件, include: "包含(應在用戶群內的用戶)", query: 查詢 }
    en-us: { title: Conditions, include: "Users who should be in the group", query: Query }
  names:
    zh-cn: { field: 近30天成交笔数, option: 港股 }
    zh-hk: { field: 近30天成交筆數, option: 港股 }
    en-us: { field: Trades in 30 days, option: HK equity }
```

!!切语言时不能只按 `revision` 判断要不要换元数据。!! `revision` 是投影内容哈希，它不保证随语言变化；圈选页的做法是 `watch(locale)` 时带 `force: true` 直接换一份新的，并清掉值集合缓存。

## 09 · 检查清单

```checklist
tone: warn
items:
  - "页面上出现了 `combinerTitle` 这样的 key：宿主只 app.use(i18n)，没合并 combinationMessages"
  - "切了语言，标题/按钮没变：组件词条没并进 global，或宿主没有响应 locale 变化"
  - "切了语言，字段名还是旧语言：元数据要重新拉一次，且不能只靠 revision 判断"
  - "英文环境下字段名仍是中文：检查下游 header 的 clientLang 有没有带下去"
  - "把 Data Admin 的 name 当 I18nText 查 locale：它是单语字符串，查了也不会变"
```

```callout
tone: amber
icon: ⏳
text: |
  **时效（2026-10-13）**：SDK 的读模型原本按三键（`zhCn` / `zhHk` / `en`）设计，
  与当时的 proto 快照一致；Data Admin 确认「按 FRPC header 的语言返回单一语言」后，
  `packages/dsl` 已改成 `name?: string`，BFF 适配层只剩两件事：JSON 标量字符串解成标量、
  status 数字转 `ENABLED` / `DISABLED`。改动当时在 `audience_web` 工作区尚未提交，
  引用这段结论前先看一眼 `packages/dsl/src/audience.ts` 的注释。
```

```quiz
- q: "`t('x.y')` 没命中时，vue-i18n 按什么顺序往下找？"
  a: |
    ① 当前 composer 的 `messages[locale]` 按 `.` 逐层找；
    ② local composer 的话，回落 root（global）的同语言桶；
    ③ 回落 `fallbackLocale`；
    ④ 都没有就返回 key 本身，并在控制台 warn。每一步命中就停。
- q: "组件里的 12 个组件都调用 useI18n()，为什么不能各自声明 useScope: 'local' 把自己的词条带进去？"
  a: |
    local scope 只对声明它的那个组件实例生效，子组件调用 useI18n() 拿到的还是 global。
    12 个组件要各自复制一份 47 个 key 的词条，仍然是各查各的；
    把词条导出、宿主合并进 global，才是一份真相喂到所有层。
- q: 界面文案和数据名字，切一次语言之后各自多久生效？为什么？
  a: |
    界面文案下一帧就变，因为三语词条都在本地（组件包 + 宿主各一份，合并进 global messages）。
    数据名字要重新请求才变，因为 Data Admin 按请求头里的 clientLang 本地化后只下发一种语言，
    浏览器手里那份是上一次请求拿到的旧语言。
- q: 为什么 BFF 的适配层不把单语言的 name 包装成三键？
  a: |
    包装只是过渡期的权宜。proto 的契约是单语言 name，SDK 已经按它改成 string；
    再包一层会让「谁翻译」这件事变得含糊，而且三键里另外两个键填的是同一个值，
    切语言也不会变。语言在服务端决定，前端只负责在切语言后重新拉。
```
