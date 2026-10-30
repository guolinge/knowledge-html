`docs/ui-probe.mjs` 不是测试框架。它**临时搭一个小页面挂上真组件**，再由**你自己的 Chrome** 去读计算后的宽度、颜色和浮层位置。

仓库里的自动化测试跑在 happy-dom 上——它能告诉你「DOM 里有没有这个类名」，但量不出「这个框多宽、有没有换行、提示条弹在哪」。这类问题只能交给真浏览器。

## 01 · 单测为什么摸不到像素

同一个组件，两种运行环境差在这些地方：

```compare
first: 要验的东西
head: [happy-dom（单测）, 真 Chromium（探针）]
rows:
  - 类名接线、DOM 结构: [{ text: 能验，而且是强项, tone: green }, { text: 也能，但没必要, tone: muted }]
  - 布局计算（flex 收缩、`min-content`、`max-content`）: [{ text: 完全不实现, tone: red }, { text: 按浏览器规则算, tone: green }]
  - 伪元素（`::before` / `::after`）: [{ text: 不算样式, tone: red }, { text: 真实绘制，可读计算值, tone: green }]
  - 被 teleport 到 `body` 的浮层（下拉、提示条）: [{ text: 拿不到位置, tone: red }, { text: 能查可见性与坐标, tone: green }]
  - "`:hover` / `:focus-within` 这类状态": [{ text: 没有鼠标, tone: red }, { text: 可以真的移上去, tone: green }]
  - 字体度量（同一条时间串在不同字体下宽度不同）: [{ text: 无字体引擎, tone: red }, { text: 可实测文字宽度, tone: green }]
```

一个具体例子：`condition-ui.spec.ts` 能断言「关系行有删除按钮」，但它量不出这个按钮离客体框 **368px**。而这个数字正是产品截图里那条空白的来源。

## 02 · 三步

```lane-stack
- badge: STEP 01
  title: 写三个文件
  desc: 在 packages/combination/.play/ 下生成临时项目
  tone: blue
  nodes:
    - { title: index.html, sub: "<div id=\"app\"> + 引 main.ts", tag: 12 行 }
    - { title: main.ts, sub: "写死 metadata 与 draft，再挂组件", tag: 场景内容 }
    - { title: vite.config.mts, sub: "root 指到 .play，端口 5199", tag: strictPort }
  next: "启动 :: spawn :: 用仓库里已装的 vite，不额外装依赖"

- badge: STEP 02
  title: 起一个开发服务器
  desc: vite 把 .vue / .ts 编译成浏览器能跑的模块
  tone: violet
  nodes:
    - { title: npx vite --config .play/vite.config.mts, sub: "--port 5199 --strictPort" }
    - { title: 得到 http://localhost:5199/, tag: 真 URL }
  next: "量 :: measure :: 数据全部来自浏览器自己算的结果"

- badge: STEP 03
  title: 用你的 Chrome 读值
  desc: opencli 通过浏览器扩展驱动本机已登录的 Chrome
  tone: green
  nodes:
    - { title: hover / click, sub: "真的把鼠标移上去", tag: 交互态 }
    - { title: eval, sub: "getComputedStyle / getBoundingClientRect", tag: 数字 }
    - { title: screenshot, sub: "人眼复核", tag: 截图 }
```

按 `Ctrl+C` 结束：脚本杀掉 vite，并删掉 `.play/`。加 `--keep` 就保留，方便手改 `main.ts` 看热更新。

## 03 · 那三个文件里，真正起作用的是 main.ts

```tree
- label: packages/combination/.play/
  tone: violet
  note: 临时目录，已在 .gitignore 里
  children:
    - { label: index.html, note: 只有挂载点和一个 script 标签 }
    - label: main.ts
      sub: 由脚本的 PRELUDE + 场景片段拼成
      note: 全部内容就是「有哪些字段」+「要显示哪些条件」
      children:
        - { label: META, note: 假 metadata：特征 / 关系 / 属性 / 客体 }
        - { label: mount(draft, extra), note: createApp + h(InsightCombiner) + .mount('#app') }
    - { label: vite.config.mts, note: root 指到本目录，端口写死 }
```

`main.ts` 的核心只有一句：

```ts
import { InsightCombiner } from '../src/index.ts';   // ← 源码，不是 dist

createApp({
  render: () => h(InsightCombiner, { modelValue: draft, metadata: META }),
}).use(i18n).mount('#app');
```

两个细节决定了它的实用性：

- ==导入的是 `../src/index.ts`，也就是你正在改的那份源码== —— 改了组件，Vite 热更新，探针页面立刻变，不用重新构建、不用重新安装。
- 样式层同时引了 `element-plus/dist/index.css` 和 `@futuweb/crm-ui-theme/styles`。**不引主题，量到的圆角、颜色、控件高度全都不是线上值。**

## 04 · 为什么这样量出来的值可信

```cards
cols: 2
items:
  - { title: 同一个组件, desc: 真实 SFC 的 template / script / scoped CSS，没有替身、没有 stub, tag: 真, tone: violet }
  - { title: 同一套样式栈, desc: Element Plus + CRM 主题，和宿主加载的顺序一致, tag: 真, tone: blue }
  - { title: 同一个布局引擎, desc: Chromium 算 flex 收缩、min-content、伪元素，全按真实规则, tag: 真, tone: green }
  - { title: 真实的浮层与状态, desc: popper teleport 到 body、hover、focus-within 都是真的, tag: 真, tone: amber }
```

换句话说：==它量的是「线上会是什么样」；DOM 结构对不对，交给单测。==

## 05 · 一次真实排障：826px 宿主里的浅蓝底

产品截图里，只读宿主（对方页面）的条件行明显超出浅蓝底面板。探针把这条链路拆成了可量的数字：

```timeline
- when: 第 1 步
  title: 拉起探针的只读场景
  desc: 826px 的宿主画框 + 时间类特征行 + 带日期区间的关系属性
  tone: blue
- when: 第 2 步
  title: 量到「行比面板宽」
  desc: 行 1138px、面板 984px —— 差 154px，正好是截图里溢出的那一块
  tone: amber
- when: 第 3 步
  title: "第一次修：面板改 min-content"
  desc: 826 宿主里面板变成 1234px，行全部落进蓝底（本地通过）
  tone: green
- when: 第 4 步
  title: 线上仍然溢出
  desc: "宿主给我们的内部类写了 min-width: 0，特异性更高，把 min-content 顶掉了"
  tone: red
- when: 第 5 步
  title: "第二次修：改用 width: max-content"
  desc: 外部没碰 width，所以压不掉；探针里注入同样的覆盖再量，面板 1044px 仍然包住行
  tone: green
```

第 4 步是最值钱的一步：==探针绿了不等于线上对==。它跑的是「组件自己的 CSS」，而线上还叠着宿主的 CSS。这条只能在探针里**手动注入那条覆盖**才能复现。

## 06 · 它不做的事

```checklist
tone: cross
items:
  - 不发网络请求 —— 组件本来就不发，值集和名称都靠 props 传假数据
  - 不做断言、不进 CI —— 它只提供现场；判定靠临时写的 eval 或看截图
  - 不是真宿主 —— 没有 micro-app 的选择器改写，也没有宿主的 scoped 覆盖
  - 不替你判断设计好坏 —— 它只回答「多宽、有没有换行、颜色是什么」
```

## 07 · 场景表：每个场景就是一段复现条件

```compare
first: 场景（第一参数）
head: [复现什么, 典型用途]
rows:
  - "`default`": [编辑态：特征 / 关系 / 属性过滤，含配了 placeholder 的格子, 日常改样式]
  - "`readonly`": [只读态：客户范围三个灰格 + 条件树, 对外展示的观感]
  - "`readonly-narrow`": [只读态塞进 826px 宿主画框, 复现宿主里的溢出]
  - "`temporal-range`": [时间类字段的日期控件在窄容器里的显示, 日期被截断]
  - "`money`": [金额取整：ct3 + long 取整，ct0 / double 不取整, 数值格式化]
  - "`hint`": [条件名旁的「?」详情, 文案与浮层]
  - "`long-desc`": [6 个超长标的名称, 橙色摘要换行与删除 × 位置]
```

加场景的方式就是往脚本的 `SCENARIOS` 表里加一段 `main.ts` 文本 —— 写法就是「写死 metadata + 写死 draft」。==线上出现什么问题，就把那天的条件抄进来当一个场景。==

## 08 · 三个必须知道的局限

````callout
tone: amber
icon: ⚠
text: |
  **一、字体是本机的，不是线上的。**

  同一条 `2026-10-24 00:00:00`，Arial 量出 130px，PingFang SC / 微软雅黑 是 147px。
  日期区间框曾因此差 8px：本地够宽、线上被 `-` 挤住。
  ++要验这种，得在探针里换上目标字体再量文字宽度。++

  **二、宿主样式叠不进来。**

  线上是 `micro-app` 注入宿主文档，宿主的 scoped CSS 会以更高特异性覆盖组件内部类。
  探针里没有这一层，必须**手动注入那条覆盖**才复现。

  **三、它不证明业务正确。**

  它量的是几何与颜色。人数对不对、SQL 语义对不对，那是编译器与对拍的事。
````

## 09 · 怎么用

```bash
# 起探针（默认 5199）
node docs/ui-probe.mjs

# 换场景 / 保留临时目录 / 换端口
node docs/ui-probe.mjs readonly-narrow
node docs/ui-probe.mjs --keep --port 5300
```

起来后屏幕上有现成命令，通常是这四行：

```bash
opencli browser probe open http://localhost:5199/
opencli browser probe hover '.portrait-field--value'
opencli browser probe eval "…读 getBoundingClientRect / getComputedStyle…"
opencli browser probe screenshot /tmp/x.png
```

`eval` 里就是普通浏览器 JS，读什么由问题决定：宽度看 `getBoundingClientRect().width`，换行看 `scrollWidth` 或元素高度，悬停底色看 `getComputedStyle(el).backgroundColor`，浮层是否弹出看 `.el-popper` 的 `offsetParent`。

## 10 · 自测

```quiz
- q: 为什么不让组件测试直接覆盖这类问题，非要起一个真浏览器？
  a: |
    happy-dom 不实现布局：flex 收缩、min-content、伪元素、teleport 的浮层位置、
    hover 状态、字体度量全都没有。它能断言「类名接上了」，但量不出「多宽、换不换行」。
    而线上反馈的问题恰恰都是后面这一类。
- q: 探针里量到「行 1138、面板 984」，为什么改完 CSS 本地通过、线上还溢出？
  a: |
    探针只跑组件自己的样式。线上还叠着宿主的 scoped CSS，它能以更高特异性覆盖组件内部类
    （那次就是给 `.condition-section__body` 设了 `min-width: 0`）。
    复现办法是在探针里手动注入同一条覆盖，再量一次。
- q: 它和单测的分工是什么？
  a: |
    单测管结构与接线（有没有这个按钮、点击后 emit 什么），进 CI、跑得快、不会漂。
    探针管几何与观感（多宽、换不换行、什么颜色、浮层在哪），人工触发、不进 CI。
    两边都要，互相不能替代。
```
