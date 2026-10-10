[全景篇](notes/combination-overview.html)讲了这个包的位置和地图，[组件图鉴](notes/combination-components.html)里有每个组件的真实渲染截图。这一篇往下钻一层：草稿更新的具体写法、一行条件的诞生过程、控件怎么决策、候选值怎么加载、坏草稿在哪里被拦。三处交互里的错误码、操作符表、控件形态，都是 2026-10-10 用 `tsx` 实跑包内源码得到的输出，不是照文档抄的。

```callout
tone: blue
icon: 🧭
text: |
  **读这篇之前**：先过全景篇的 02（受控组件）、03（草稿 vs DSL）、04（形状四元组与值来源）。
  05 节会碰到 `@insight/dsl` 的 `validateStructure`，那条线在 [@insight/dsl 篇](notes/insight-dsl.html)。
```

## 01 · 受控数据流的四种更新模式

包里所有状态更新都是同一个形状：**拷一份、改一片、抛出去**。组件里找不到一处对 `props.modelValue` 的就地修改。具体到代码，更新只从四个入口发生（值控件那层用了 Vue 的 `defineModel`，但赋值同样编译成 `emit('update:modelValue')`，只是由行组件包成新叶子再往上抛）：

```spec
title: 四个更新入口，同一种写法
subtitle: 全部「新对象 + emit」，没有例外
tone: blue
rows:
  - k: 壳上合并
    code: |
      // InsightCombiner.vue —— scope 或 include 变了
      function commit(next: DraftQuery) {
        emit('update:modelValue', next);
      }
      function onScope(scope: ScopeLeaf) {
        commit({ ...props.modelValue, scope });   // 拷外层，换 scope
      }
  - k: 组内替换
    code: |
      // ConditionGroup.vue —— 第 index 行变成 leaf
      function replace(index: number, leaf: Leaf) {
        const children = [...props.modelValue.children];  // 拷数组
        children[index] = leaf;
        emit('update:modelValue', { ...props.modelValue, children });
      }
  - k: 整段删除
    code: |
      // setProps 顺带做了一件事：属性删光时把 props 键整个拿掉
      const { props: _props, ...rest } = props.modelValue;
      patch(items.length === 0 ? rest : { ...rest, props: { logic, items } });
  - k: 守卫后追加
    code: |
      // query.ts —— 一组里最多一个 UID，第二个直接忽略
      export function addLeaf(group: DraftTree, leaf) {
        if (leaf.type === 'uid' && group.children.some((c) => c.type === 'uid')) {
          return group;                          // 静默拦截
        }
        return { ...group, children: [...group.children, leaf] };
      }
```

第三种值得停一下。`props` 在草稿里是**可选键**：一行关系条件没有属性过滤时，草稿上根本不应该有 `props` 字段。所以删光属性行不是写成 `props: { logic, items: [] }`，而是用解构把键整个拿掉。这样草稿 JSON 才和「这条关系没配属性过滤」一一对应，回显时不会多出一个空节点。

UID 那个守卫是双保险的另一半：`addLeaf` 拦数据，界面上的「+ 指定UID」按钮也用 `hasUid` 计算属性藏起来了。数据层拦、入口层藏，两层说的是同一条规则。

## 02 · 一行怎么长出来

### 幽灵行：空组里的那行「不存在」的条件

打开自定义组合，界面上已经有一行「请选择条件」。但这行条件**不在草稿里** —— 空组的 `children` 是 `[]`，草稿是 `{ type:'group', logic:'AND', children:[] }`。

```journey
- tag: ① 空组
  tone: muted
  name: ConditionGroup 渲染
  code: |
    children: []            ← 草稿里什么都没有
    EMPTY_PORTRAIT          ← 组件里的常量 { field:'', op:'eq' }
  note: leaves.length === 0 时渲染一个**虚拟行**，喂的是常量，不是草稿。
  next: "用户选了「常驻城市」 :: ::"

- tag: ② 落地
  tone: blue
  name: commitDraft → addLeaf
  code: |
    function commitDraft(leaf: Leaf) {
      if (leaf.type === 'portrait' && !leaf.field) return;   // 还没选字段，不落地
      emit('update:modelValue', addLeaf(props.modelValue, leaf));
    }
  note: 虚拟行上抛的 leaf 第一次真正进树。
  next: ":: ::"

- tag: ③ 树里有了一行
  tone: green
  name: DraftQuery
  code: |
    children: [ { type:'portrait', field:'city', op:'eq' } ]
  note: 虚拟行消失（leaves.length 变成 1），此后走 replace 原位更新。
```

为什么要这么做？如果空组在草稿里预先放一行 `{field:''}` 的占位条件，`buildQuery` 就得区分「用户想要的空行」和「用户删剩下的空行」，两种情况语义不一样。幽灵行让草稿保持一个干净的不变量：**树里的每一行都是用户真实想要的**。

### convert：一行条件的类型转换

特征和关系混在同一个级联菜单里（`ConditionNameSelect` 用 `field:` / `relation:` 前缀区分）。选完之后行类型可能要变：特征行选到关系名，就得变成关系行。

```flow
grid: true
groups:
  - { id: row, label: "行组件内部", tone: violet }
  - { id: grp, label: "ConditionGroup", tone: blue }
nodes:
  - { id: pick,  label: 级联下拉选中, sub: "field:city 或 relation:holding", row: 0, group: row }
  - { id: same,  label: 同类 → patch, sub: "改 field，重置 op 为该字段第一个合法 op", row: 1, group: row }
  - { id: conv,  label: 异类 → emit convert, sub: "PortraitRow 发 blankDetail(relation)，反向发 portraitDraft(field)", row: 1, group: row, tone: violet }
  - { id: ghost, label: 幽灵行 → commitDraft, sub: "addLeaf 追加进空组", row: 2, group: grp }
  - { id: rep,   label: 已有行 → replace, sub: "原位置换类型，其他行不动", row: 2, group: grp }
edges:
  - { from: pick, to: same }
  - { from: pick, to: conv, label: 类型不同 }
  - { from: conv, to: ghost, label: 空组 }
  - { from: conv, to: rep, label: 已有行 }
```

转换时 op 取新类型的第一个合法操作符（`applicableOps(shape)[0]`），旧值整个丢弃 —— 两个类型的值形状不同，保留只会留下非法草稿。

### UID 行的输入契约

`UidRow` 是唯一的文本输入叶子，规则全在 `parseUids` 一个函数里：

```compare
first: 规则
head: [实现, 为什么]
rows:
  - "分隔符": ["`/[\\s,，;；]+/` —— 空格、逗号、分号、中文逗号、中文分号都算", "需求原文：从 Excel 里整列粘贴进来时自动分隔"]
  - "只留正整数": ["/^[1-9]\\d*$/，其余片段丢弃", "UID 不会以 0 开头，也不会是负数或小数"]
  - "去重保序": ["Set 判重，先到的留下", "粘贴的名单常有重复行"]
  - "保字符串": ["不转 number", "`9007199254740993` 超出 `Number.isSafeInteger`，转了就错"]
  - "500 截断": ["`slice(0, MAX_UIDS)`，MAX_UIDS 是组件里写死的常量", "技术方案的暂定上限，编译侧不校验"]
```

输入框还有一个反向同步：`watch(modelValue.uids)` 比对「当前文本解析出来的结果」和「草稿里的 uids」，不一致才重写文本。作用是外部草稿变化（比如切换预设回填）时刷新输入框，但用户正在打字时不会被自己的中间态（输入到一半还没构成合法 UID 的片段）干扰。

```callout
tone: amber
icon: 📏
text: |
  **层级和条数上限的现状**（2026-10-10 实查）：技术方案约定条件树最大 2 层、条件最多 15 个。
  代码里没有这两个数字的检查 —— 界面的 2 层是**按构造保证的**：
  条件组只能加在 Section 层，行只能加在 Group 层，界面上不存在第三层入口；
  15 条上限则完全没有实现。UID 的 500 截断是三者里唯一落了地的。
```

## 03 · 控件决策引擎：四个元数据字段决定一切

一个字段出现在界面上，组件要回答三个问题：能用哪些操作符？操作符定了用什么输入控件？候选值从哪来？前两问的答案不在组件里，在 `@insight/dsl/fieldType.ts` 的两个纯函数里；第三问看字段的 `valueSource`。

```compare
first: applicableOps 的规则
head: [形状, 得到的操作符集]
rows:
  - "`enum` 枚举（不看 dataType）": [{ text: "eq · neq · in · not_in · is_null · is_not_null", tone: blue }]
  - "`string`（非枚举也一样）": [{ text: "同上 —— TEXT_OPS", tone: blue }]
  - "`boolean`": [{ text: "eq · is_null · is_not_null", tone: blue }]
  - "其余（long / double）": [{ text: "eq · neq · lt · lte · gt · gte · is_null · is_not_null · between", tone: blue }]
  - "contentType = 1（日期）再追加": [{ text: "last_n_days · before_n_days", tone: violet }]
  - "contentType = 2（时间）再追加": [{ text: "last_n_days · before_n_days · last_n_hours · before_n_hours", tone: violet }]
```

操作符定了，`controlFor(shape, op)` 决定值控件长什么样。分派顺序有讲究，从上往下第一条命中即停：

```compare
first: controlFor 的分派
head: [条件, 控件, 值类型]
rows:
  - "is_null / is_not_null": [{ text: "NONE —— 不渲染输入框", tone: red }, "-"]
  - "相对时间四种": [{ text: "INPUT", tone: blue }, "long（填 N 本身，单位在操作符上）"]
  - "between 且字段是日期/时间": [{ text: "RANGE（日期范围选择器）", tone: violet }, "unix_date / unix_time"]
  - "between 且字段是数字": [{ text: "RANGE（两个数字输入）", tone: violet }, "long / double"]
  - "in / not_in": [{ text: "MULTI_SELECT", tone: blue }, "随 dataType"]
  - "枚举或 dynamic 上的 eq / neq": [{ text: "SELECT（带候选）", tone: green }, "随 dataType"]
  - "boolean 的 eq": [{ text: "SWITCH（是 / 否）", tone: green }, "boolean"]
  - "日期 / 时间字段的普通比较": [{ text: "DATETIME_PICKER", tone: violet }, "unix_date / unix_time"]
  - "其余": [{ text: "INPUT", tone: muted }, "long / double / string"]
```

==日期和时间的 DSL 值是 Unix 毫秒==，界面上看到的是日期选择器给的人话串，`ValueControl` 用 `@insight/dsl/clock` 在两者之间换算（`zonedToUnixMs` / `startOfDayMs`）。换算逻辑同样在 dsl 包里，组件只调用。

下面的交互是真数据：左边 7 个字段全部取自 demo 种子（`apps/seed/src/demoCatalog.ts`）的真实形状，操作符和控件形态是实跑 `applicableOps` / `controlFor` 的输出。点操作符看控件怎么跟着变。

```demo
widget: combination-control-lab
title: 换字段、换操作符，看控件怎么跟着变
actions: false
config:
  default: { field: city, op: eq }
  fields:
    - key: city
      name: 常驻城市
      shape: enum · string · 城市(7) · value_set
      source: VALUE_SET
      sample: [{ v: 广州, l: 广州 }, { v: 深圳, l: 深圳 }, { v: 杭州, l: 杭州 }, { v: 厦门, l: 厦门 }]
      ops:
        - { op: eq, control: "SELECT / string" }
        - { op: neq, control: "SELECT / string" }
        - { op: in, control: "MULTI_SELECT / string" }
        - { op: not_in, control: "MULTI_SELECT / string" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: nationality
      name: 国籍
      shape: enum · string · 国家(5) · custom
      source: CUSTOM
      sample: [{ v: CN, l: 中国大陆 }, { v: HK, l: 中国香港 }, { v: US, l: 美国 }, { v: SG, l: 新加坡 }]
      ops:
        - { op: eq, control: "SELECT / string" }
        - { op: neq, control: "SELECT / string" }
        - { op: in, control: "MULTI_SELECT / string" }
        - { op: not_in, control: "MULTI_SELECT / string" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: has_hk_account
      name: 已开港股账户
      shape: range · boolean · 普通(0) · none
      source: NONE
      sample: []
      ops:
        - { op: eq, control: "SWITCH / boolean" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: aum_hkd
      name: 总资产(HKD)
      shape: range · double · 金额(3) · none
      source: NONE
      sample: []
      ops:
        - { op: eq, control: "INPUT / double" }
        - { op: neq, control: "INPUT / double" }
        - { op: lt, control: "INPUT / double" }
        - { op: lte, control: "INPUT / double" }
        - { op: gt, control: "INPUT / double" }
        - { op: gte, control: "INPUT / double" }
        - { op: between, control: "RANGE / double" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: trade_count_30d
      name: 近30天成交笔数
      shape: range · long · 普通(0) · none
      source: NONE
      sample: []
      ops:
        - { op: eq, control: "INPUT / long" }
        - { op: neq, control: "INPUT / long" }
        - { op: lt, control: "INPUT / long" }
        - { op: lte, control: "INPUT / long" }
        - { op: gt, control: "INPUT / long" }
        - { op: gte, control: "INPUT / long" }
        - { op: between, control: "RANGE / long" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: stock
      name: 持仓标的(动态)
      shape: enum · string · 普通(0) · dynamic
      source: DYNAMIC
      sample: [{ v: 00700.HK, l: "腾讯控股 00700.HK" }, { v: 09988.HK, l: "阿里巴巴 09988.HK" }, { v: 01810.HK, l: "小米集团 01810.HK" }]
      ops:
        - { op: eq, control: "SELECT / string" }
        - { op: neq, control: "SELECT / string" }
        - { op: in, control: "MULTI_SELECT / string" }
        - { op: not_in, control: "MULTI_SELECT / string" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
    - key: last_trade_time
      name: 末次成交时间
      shape: range · long · 时间(2) · none
      source: NONE
      mark: 示意 —— demo 种子没有时间字段，这是引擎分支
      sample: []
      ops:
        - { op: eq, control: "DATETIME_PICKER / unix_time" }
        - { op: neq, control: "DATETIME_PICKER / unix_time" }
        - { op: lt, control: "DATETIME_PICKER / unix_time" }
        - { op: lte, control: "DATETIME_PICKER / unix_time" }
        - { op: gt, control: "DATETIME_PICKER / unix_time" }
        - { op: gte, control: "DATETIME_PICKER / unix_time" }
        - { op: between, control: "RANGE / unix_time" }
        - { op: last_n_days, control: "INPUT / long" }
        - { op: before_n_days, control: "INPUT / long" }
        - { op: last_n_hours, control: "INPUT / long" }
        - { op: before_n_hours, control: "INPUT / long" }
        - { op: is_null, control: "NONE / -" }
        - { op: is_not_null, control: "NONE / -" }
```

```callout
tone: violet
icon: 💡
text: |
  **这就是「Metadata 驱动 UI」的全部含义。** 决策引擎只认四个字段
  （variableType / dataType / contentType / enumType），组件里没有任何一行
  `if (field === 'city')`。接入一个新字段 = Data Admin 插一行元数据，组件和
  SQL Builder 都不用发版。

  两个诚实的事实：`last_trade_time` 这类时间字段在 demo 种子里**不存在**，
  上面那组操作符是引擎能力的实跑（种子没有覆盖 contentType 1/2 的分支）；
  `stock` 的 DYNAMIC 形状在真实 demo 里出现在**关系客体**上（holding 的 object），
  画像字段用它是示意。
```

## 04 · 候选值：三条管道，四处票据

### 三条管道

| 管道 | 加载时机 | 竞态防护 | 缓存在谁那 |
|------|----------|----------|-----------|
| `CUSTOM` | 不加载，Metadata 里自带 | 不需要 | 无处不在（就在字段上） |
| `VALUE_SET` | 下拉打开 / 关系行挂载时 | 组件侧票据 + 宿主侧缓存 | 宿主（`useValueSets`） |
| `DYNAMIC` | 每次关键词变化 | 组件侧票据 | 不缓存（每次都搜） |

`VALUE_SET` 的宿主侧实现值得一看，它解决了两件事：同一 setKey 的并发请求只发一次（inflight 去重），身份切换时全部作废（generation 递增）：

```ts
// apps/client/src/useValueSets.ts —— 宿主注入的 loadValueSet
async function loadValueSet(setKey: string): Promise<ValueItem[]> {
  const cached = cache.value[setKey];
  if (cached) return cached;                    // ① 命中缓存
  const pending = inflight.get(setKey);
  if (pending) return pending;                  // ② 在途请求直接复用
  const promise = getValueSet(requestedStaff, setKey)
    .then((body) => {
      if (staffId.value === requestedStaff && run === generation) {   // ③ 回来时身份没变才入缓存
        cache.value = { ...cache.value, [setKey]: body.items };
      }
      return body.items;
    })
  inflight.set(setKey, promise);
  return promise;
}
```

### 四处同款的「过期票据」

组件内部的竞态防护是同一个模式复制了四次，一次都没抽成公共函数：

| 位置 | 票据变量 | 防的是什么 |
|------|----------|-----------|
| `values.ts` useStoredItems | `ticket` | 字段切换后，旧 setKey 的响应覆盖新字段 |
| `RelationRow.vue` | `propLoadToken` | 换关系后，旧关系的属性值集合继续写入 |
| `RelationRow.vue` | `objectSearchToken` | 换关系或换关键词后，旧客体搜索结果覆盖新结果 |
| `ValueControl.vue` | `searchToken` | 同上，作用在值控件的动态候选上 |

```demo
widget: combination-values-lab
title: 慢请求回来时，输入框已经往前走了
actions: false
config:
  resolverKey: stock_search
  selected: 00700.HK
  selectedLabel: "腾讯控股 00700.HK"
  steps:
    - label: 输入「0070」
      kw: "0070"
      items: null
      ledger:
        - { id: R1, kw: "0070", state: 已发出, tone: amber }
      note: "搜索是 ==异步的==。此刻界面上只有已选值的回显（黄色那条），还没有任何候选。"
    - label: 继续输入「00700.」
      kw: "00700."
      items: null
      ledger:
        - { id: R1, kw: "0070", state: 票据过期, tone: muted }
        - { id: R2, kw: "00700.", state: 已发出, tone: amber }
      note: "又发了一个请求 R2。组件先 `++searchToken` 再发请求 —— ==R1 的票据在这一刻作废==，哪怕它很快回来也不算数。"
    - label: R2 先回来了
      kw: "00700."
      items: ["00700.HK · 腾讯控股"]
      ledger:
        - { id: R1, kw: "0070", state: 票据过期, tone: muted }
        - { id: R2, kw: "00700.", state: 采纳渲染, tone: green }
      note: "`token === searchToken` 成立，候选列表渲染。同时每个返回项都存进 `selectedLabels` —— 这一步在为回显做准备。"
    - label: R1 慢吞吞地回来了
      kw: "00700."
      items: ["00700.HK · 腾讯控股"]
      ledger:
        - { id: R1, kw: "0070", state: 整包丢弃, tone: red }
        - { id: R2, kw: "00700.", state: 采纳渲染, tone: green }
      note: "`token !== searchToken`，==一行都不落地==。没有这层防护，用户会看着列表从「00700.」的结果闪回「0070」的旧结果。"
    - label: 清空输入
      kw: ""
      items: []
      ledger:
        - { id: R1, kw: "0070", state: 票据过期, tone: muted }
        - { id: R2, kw: "00700.", state: 采纳渲染, tone: muted }
      note: "清空触发空关键词搜索，组件显示空态。黄色那条已选值始终在 —— 回显不依赖搜索结果。"
```

### 回显：已选值可以不在候选里

`DYNAMIC` 的候选是搜出来的，用户先前选的值完全可能从搜索结果里消失（停售、改名、接口没返回）。组件的兜底是**记住**：

```ts
// ValueControl.vue
const selectedLabels = new Map<string, ResolvedOption>();
watch(() => props.items, items => {
  for (const item of items ?? []) selectedLabels.set(String(item.value), item);
}, { immediate: true });
const shownItems = computed(() => {
  const items = props.search ? remoteItems.value : (props.items ?? []);
  const selected = Array.isArray(modelValue.value) ? modelValue.value : [modelValue.value];
  return [...items,
    ...selected.filter(v => !items.some(i => i.value === v))
      .map(v => selectedLabels.get(String(v)) ?? { value: v, label: String(v) })];
});
```

已选值不在候选列表里时，用记过的 label 补回列表；连 label 都没有（比如刷新后第一次回显）就显示原值。`RelationRow` 的客体多选有一份一模一样的兜底（`rememberedObjects`）。技术上这是「选项 = 结果 ∪ 已选」，业务上是 ==不静默丢掉用户已经选的条件==。

## 05 · buildQuery：草稿的守门员

调用方在提交前调 `buildQuery(draft)`。它只做**结构完整性检查**：字段选了没有、op 和值配对了吗、数组非空吗。字段存不存在、值类型对不对、枚举值合不合法，那是**语义校验**，需要 Catalog，在服务端跑。这个分工让组件能本地把「还没填完」拦下来，不用等一次网络往返。

按 op 分派的检查，每条规则下面都是实跑的真实报错。想自己试就点左边：

```demo
widget: combination-build-lab
title: 喂 16 份草稿，看哪份活下来
actions: false
config:
  groups:
    - name: 特征行（portrait）
      cases:
        - name: 值没填
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait age requires a value"
          draft: |
            { "type": "portrait", "field": "age", "op": "gte" }
        - name: 字段没选
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait requires field and op"
          draft: |
            { "type": "portrait", "field": "", "op": "eq" }
        - name: in 的值不是数组
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait city in requires an array"
          draft: |
            { "type": "portrait", "field": "city",
              "op": "in", "value": "深圳" }
        - name: between 只填一端
          verdict: err
          code: INCOMPLETE_LEAF
          message: "portrait aum_hkd between requires [min, max]"
          draft: |
            { "type": "portrait", "field": "aum_hkd",
              "op": "between", "value": [1000000] }
        - name: 相对时间填了 0
          verdict: err
          code: VALUE_TYPE
          message: "portrait x last_n_days requires a positive integer"
          draft: |
            { "type": "portrait", "field": "x",
              "op": "last_n_days", "value": 0 }
        - name: is_null 带了值
          verdict: err
          code: VALUE_TYPE
          message: "portrait age is_null does not take a value"
          draft: |
            { "type": "portrait", "field": "age",
              "op": "is_null", "value": 1 }
    - name: 关系行（relation）
      cases:
        - name: detail 的 objects 空
          verdict: ok
          draft: |
            { "type": "relation", "relation": "holding",
              "formula": "detail", "op": "in", "objects": [] }
          out: |
            { "type": "relation", "relation": "holding",
              "formula": "detail", "op": "in", "objects": [] }
          server: "**buildQuery 放过了它** —— `[]` 是真值，`if (!objects)` 拦不到。
            但它活不到编译：服务端 `canonicalizeQuery` 先跑 `validateStructure`，
            第 150 行抛 `INCOMPLETE_LEAF: detail requires objects`。
            ==两层防线里组件这层漏的一个，被服务端这层接住了==（实跑 + 读源码确认）。"
        - name: detail 带了 value
          verdict: err
          code: INCOMPLETE_LEAF
          message: "detail does not take a value"
          draft: |
            { "type": "relation", "relation": "holding",
              "formula": "detail", "op": "in",
              "objects": ["00700.HK"], "value": 3 }
        - name: times 填负数
          verdict: err
          code: INCOMPLETE_LEAF
          message: "times requires a non-negative integer"
          draft: |
            { "type": "relation", "relation": "trade",
              "formula": "times", "op": "gte", "value": -1 }
        - name: times between 写反
          verdict: err
          code: VALUE_TYPE
          message: "times between requires min <= max"
          draft: |
            { "type": "relation", "relation": "trade",
              "formula": "times", "op": "between", "value": [3, 1] }
        - name: times 用了相对时间
          verdict: err
          code: OP_NOT_ALLOWED
          message: "times only allows eq/neq/lt/lte/gt/gte/between, got last_n_days"
          draft: |
            { "type": "relation", "relation": "trade",
              "formula": "times", "op": "last_n_days", "value": 7 }
        - name: props 的 items 空
          verdict: err
          code: INCOMPLETE_LEAF
          message: "relation props require items"
          draft: |
            { "type": "relation", "relation": "holding",
              "formula": "detail", "op": "in", "objects": ["00700.HK"],
              "props": { "logic": "AND", "items": [] } }
    - name: 结构与 UID
      cases:
        - name: uid 列表为空
          verdict: err
          code: INCOMPLETE_LEAF
          message: "uid leaf requires uids"
          draft: |
            { "type": "uid", "op": "in", "uids": [] }
        - name: version 写成 2
          verdict: err
          code: UNSUPPORTED_VERSION
          message: "only version 1 is supported"
          draft: |
            { "version": 2, "scope": { "type": "scope", "kind": "self" },
              "include": null, "exclude": null }
        - name: 组缺 logic
          verdict: err
          code: INCOMPLETE_LEAF
          message: "group requires AND or OR"
          draft: |
            { "version": 1, "scope": { "type": "scope", "kind": "self" },
              "include": { "type": "group", "children": [] }, "exclude": null }
        - name: 合法的 times ✓
          verdict: ok
          draft: |
            { "type": "relation", "relation": "trade",
              "formula": "times", "op": "gte", "value": 3 }
          out: |
            { "type": "relation", "relation": "trade",
              "formula": "times", "op": "gte", "value": 3 }
```

有一处文档和代码不一致，按代码算。技术方案说 `buildQuery` 会做规范化，「times 的空 objects 数组移除」。实跑下来 `objects: []` 原样保留在产物里；对空数组的宽容发生在校验层 —— `validateStructure` 明确注释 `times.objects [] is allowed: it means unrestricted, same as omitting objects`。效果一致（[] 和省略同义），但实现位置和方案描述的不同。

```callout
tone: red
icon: ⚠
text: |
  **组件检查不代替服务端校验。** 组件这层只查结构，Catalog 它根本没见过；
  服务端在编译前把 `validateStructure` 和 `validateSemantics` 都重跑一遍
  （`canonicalizeQuery` 里先结构后语义），信任的只有这条链，不是前端。
```

## 06 · scope：组件做的权限只到「收窄」

可选范围跟着 `dataLevel` 走，`allowedScopeKinds` 是一张三行的表：

| dataLevel | 可选 scope | 理由 |
|-----------|-----------|------|
| `self` | 只有 self | 一线客经只看自己的户 |
| `team` | self · team | 团队长可以圈本组 |
| `all` | self · team · all | 中台全量 |

`clampScope` 负责把已有的草稿收窄到合法值，三步：

```flow
grid: true
nodes:
  - { id: s, label: scope.kind 在允许集里吗, sub: "不在 → 整个换成 self", row: 0, shape: pill }
  - { id: t, label: 是 team 且 dataLevel 是 team 吗, sub: "不是 → 原样返回（引用不变）", row: 1, shape: pill }
  - { id: f, label: groupIds 过滤, sub: "只留 groups 里有的；过滤后空 → 回 self", row: 2, shape: pill }
  - { id: same, label: 引用没变 → 不 emit, sub: "clampScope 返回同一个对象时界面不动", row: 3, tone: muted }
  - { id: emit2, label: 变了 → commit 新草稿, row: 3, tone: green }
edges:
  - { from: s, to: t, label: 在 }
  - { from: t, to: f, label: 是 }
  - { from: f, to: same, label: 没变化 }
  - { from: f, to: emit2, label: 有变化 }
```

触发时机是 `onMounted` 加一个 `watch([scopeReady, dataLevel, groups])`：身份异步加载完成的那一刻、切换模拟用户的那一刻、团队列表变化的那一刻，草稿都会被重新收窄。`scopeReady` 为 false 时跳过 —— 不能拿还没加载的数据去裁剪用户的草稿。

```callout
tone: amber
icon: ⚖
text: |
  组件侧收窄只是**交互反馈**：越权团队从下拉里消失、选不了「全部」。
  权限的权威在服务端 —— `assertScopePermitted` 发现 scope 超出
  `actor.dataLevel` 时整单抛 `SCOPE_DENIED`，不裁剪、不降级。
  那条线在 [@insight/dsl 篇](notes/insight-dsl.html)的权限谓词一节。
```

## 07 · 设计取舍：六个「为什么」

```compare
first: 决定
head: [为什么]
rows:
  - "受控组件 + 草稿外置": ["草稿的真相在宿主手里，组件可以随时销毁重建；宿主也有机会在接收前处理（如异步收窄 scope）", "代价是每次操作都要拷对象 —— 草稿很小，这个代价可以忽略"]
  - "加载函数注入而非组件发请求": ["组件不绑 HTTP 接口，才能在测试里替换、在不同宿主里复用", "`provide/inject` 让深层控件不用逐层透传 props"]
  - "错误码复用 @insight/dsl": ["`buildQuery` 抛的 `CompileError` 和服务端编译器是同一套码", "调用方只需要认识一张错误码表；类型断言 `InsightQuery extends DraftQuery` 还保证了回显免转换"]
  - "界面只渲染 include": ["本期需求只圈人不做排除编辑", "但 `commit` 用 spread 合并，exclude 键==原样保留==，不会被界面清掉"]
  - "UID 保字符串": ["`Number` 上限 2^53-1，UID 是十进制整数字符串，比较和传输都不该过 number", "`parseUids` 的正则把这一条钉死了"]
  - "conditionKey 前缀": ["特征和关系混在同一个级联菜单里，一个 `value` 装不下两种含义", "`field:city` / `relation:holding` 让 `parseConditionKey` 一行就能分回去"]
```

还有一条划界的总账。组件和服务端各管一段，边界落在「需不需要 Catalog」上：

| 组件本地做 | 服务端做 |
|-----------|---------|
| 结构校验（buildQuery，不需要 Metadata） | 语义校验（字段存在、op 合法、值类型、枚举值 ENABLED） |
| 控件形态与候选值（AudienceMetadata 就够） | 权限谓词（actor 注入，SCOPE_DENIED 整单拒绝） |
| scope 收窄的交互反馈 | 编译 SQL；UID 上限、层级上限的最终裁决 |

## 08 · 速查

几处容易被问到的实现细节：

```spec
title: 实现细节速查
subtitle: 每条都在源码里核对过
tone: muted
rows:
  - k: 多语言回退
    v: |
      `useLabel()` 取 Metadata 多语言名的顺序：当前语言 → `zh-CN` → `zh-HK` → `en` → 空串。
      界面文案本身走 `messages.ts`（三语言同 key），两套体系。
  - k: 操作符名字的两个来源
    v: |
      行上的操作符下拉用 `metadata.operators` 的多语言名；
      关系 detail 的 op 用写死的 `t('exists') / t('notExists')`（存在/不存在）。
      `ops.ts` 里还有一份中文硬编码 `OP_LABELS`，==导出了但组件内部没有用==，属于对外暴露的工具。
  - k: AND/OR 的连接线
    v: |
      `LogicToggle` 的竖线和横线是 CSS 伪元素画的，长度靠 `ResizeObserver` 量
      **最后一行的高度**算出来（`syncLogicMargin` / `syncGroupLogic`）。
      行增删时 `nextTick` 后重新量。纯界面 concern，不影响草稿。
  - k: 值控件的属性过滤隐藏
    v: |
      `RelationRow` 的「+ 属性过滤」只在 `relationDef.properties.length > 0` 时出现；
      属性删光时 `props` 键从草稿里整个拿掉（01 节第三种模式）。
  - k: 测试现状
    v: |
      包内单测只有两份：`build.spec.ts`（buildQuery 的拒绝与产物）和 `query.spec.ts`
      （parseUids / addLeaf 守卫 / clampScope 基础），共 171 行。
      组件渲染没有测试，界面行为靠宿主 `apps/client` 的 Playwright e2e 兜着。
  - k: 组间逻辑的默认值
    v: |
      `createEmptyInclude` 的组间 logic 默认是 `'OR'`（组内默认 `'AND'`），
      和需求稿示意图里「默认并且」不一致 —— 单组时无所谓，
      ==但读代码的人容易在这是停一下==。
```

```quiz
- q: 组件里的「过期票据」模式出现了几次？它防的是什么？
  a: |
    四次：values.ts 的 useStoredItems、RelationRow 的 propLoadToken 和
    objectSearchToken、ValueControl 的 searchToken。
    防的都是同一件事：慢的旧异步响应回来时，把界面上已经更新的新结果覆盖掉。
    做法是每次发请求前 `++token`，响应回来先比 token，不等就整包丢弃。
- q: detail 的 objects 传空数组，buildQuery 会不会拦？
  a: |
    不会。`[]` 在 JS 里是真值，`if (!objects)` 拦不到它，buildQuery 原样放行。
    它活不到编译：服务端 canonicalizeQuery 先跑 validateStructure，
    抛 INCOMPLETE_LEAF「detail requires objects」。组件检查不代替服务端校验，
    这正是两层防线存在的理由。
- q: 为什么「新建条件」和「回显旧条件」看到的候选值不一样？
  a: |
    新建条件只用 ENABLED 的字段、操作符和候选值（下拉里根本不出现停用项）。
    回显已有草稿时按 value 找 label，包括 DISABLED 的 —— 已写进 DSL 的取值
    要让人看懂自己圈过什么，只是标成不可选。DYNAMIC 没有停用态，
    已选值不在搜索结果里时用草稿原值回显。
```
