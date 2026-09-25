```callout
tone: blue
icon: 🧭
text: |
  前置是 [④ core 篇](../sql-builder-v2-core/)。

  core 篇说 `utils.ts` 675 行是个杂物抽屉，时间表达式是里面最大的一块（**273 行**）。
  这篇把它拆开。

  读完你应该能说出：「==一个「最近 7 天」，代码里有三种完全不同的 SQL 形态。==」
```

## 01 · 概念：一个「最近 N 天」有多少种说法

业务侧说「最近 7 天」，一句话。但它落到 SQL 上要回答**三个问题**：

```compare
first: 问题
head: [有几种答案, 为什么要分]
rows:
  - 是绝对时间还是相对时间: ["2 种", "绝对时间就是一个值，相对时间要算"]
  - 底层存的是什么格式: ["**3 种**", "毫秒时间戳 / 秒时间戳 / `YYYYMMDD`"]
  - 要不要包含今天: ["2 种", "不包含就是「到今天 0 点」，包含就是「到此刻」"]
```

**三个问题相乘，就是 12 种组合。** 这就是为什么这个模块有 273 行。

### 描述一个时间条件的 9 个字段

```text
export type TimeExpr = {
    op: Op;                                  // > >= < <=
    name: string;                            // 列名
    value: number;                           // N（天数 / 小时数）
    dateType: DateType;                      // absolute | relative
    dateFormat: DateFormat;                  // timestamp | unixTimestamp | date
    includeToday: 0 | 1;                     // Tag 场景：包含当天吗
    latestIncludeToday: 0 | 1 | undefined;   // Crowd 场景：最近 N 天包含当天吗
    relativeDateType?: RelativeDateType;     // fromToday | singleDay
    dateUnit: DateUnit;                      // day | hour
};
```

```callout
tone: amber
icon: ⚠
text: |
  ==**注意中间那两个「包含今天」的参数。**==

  `includeToday` 和 `latestIncludeToday` —— 名字很像，但**管的是不同场景**，
  而且各有各的生效条件（下一节细说）。

  ==参数多到需要注释说明「这个字段只在某几个场景生效」，
  是这类模块的典型特征。==
```

## 02 · 组织：273 行分四块

```lane-stack
- title: 四个枚举
  desc: 定义「有哪几种可能」
  tone: muted
  nodes:
    - { title: "DateType", sub: "absolute / relative" }
    - { title: "RelativeDateType", sub: "fromToday / singleDay" }
    - { title: "DateFormat", sub: "timestamp / unixTimestamp / date" }
    - { title: "DateUnit", sub: "day / hour" }

- title: 两个生成器
  desc: 拼出最终的条件数组
  tone: green
  nodes:
    - { title: "generateLatestDaysRules", sub: "「最近 N 天」→ 两个条件" }
    - { title: "generatePrevDaysRules", sub: "「N 天前」→ 一个条件" }

- title: 三个实现
  desc: 按底层格式分
  tone: violet
  nodes:
    - { title: "getTimestampRules", sub: "毫秒时间戳（只给事件用）" }
    - { title: "getUnixTimestampRules", sub: "秒时间戳（画像）" }
    - { title: "getDateRules", sub: "YYYYMMDD（画像）" }

- title: 一个入口
  desc: 分派 + 校验
  tone: blue
  nodes:
    - { title: "getTimeRules", sub: "按 dateFormat 分到三条路" }
    - { title: "timeExprValidate", sub: "校验非法组合" }
```

```callout
tone: violet
icon: 💡
text: |
  **这个结构很清晰：四个枚举定义可能性，两个生成器负责拼装，
  三个实现各管一种格式，一个入口做分派。**

  ==三个实现都调同一个生成器 —— 差异只在「起止时间怎么算出来」。==
```

### 两个生成器

```text
// 「最近 N 天」→ 两个条件
export function generateLatestDaysRules(column, startRaw, endRaw, includeEnd = false) {
    return [
        { column, op: Op.Gte, rawValue: startRaw },
        { column, op: includeEnd ? Op.Lte : Op.Lt, rawValue: endRaw }
    ];
}

// 「N 天前」→ 一个条件
function generatePrevDaysRules(column, rawValue) {
    return [{ column, op: Op.Lt, rawValue }];
}
```

```callout
tone: amber
icon: ⚠
text: |
  **`includeEnd` 决定上界是 `<` 还是 `<=`。**

  这个布尔值一路从 `getUnixTimestampRules` 传进来（那里的 `exact` 变量）。

  ==「到此刻」和「到 0 点」的区别，最终就落在这一个符号上。==
```

## 03 · 架构：`getTimeRules` 分派到三条路

```flow
grid: true
nodes:
  - { id: in, label: "getTimeRules(rule, isTag)", sub: "一个 TimeExpr", row: 0, kind: backend }
  - { id: q0, label: "dateType 是 relative？", row: 1, tone: amber, shape: note }
  - { id: abs, label: "直接一个条件", sub: "{ op, column, value }", row: 2, tone: muted }
  - { id: v, label: "timeExprValidate", sub: "校验非法组合", row: 2, tone: amber }
  - { id: q, label: "switch (dateFormat)", row: 3, tone: violet, shape: note }
  - { id: ts, label: "getTimestampRules", sub: "毫秒时间戳", row: 4, tone: violet }
  - { id: unix, label: "getUnixTimestampRules", sub: "秒时间戳", row: 4, tone: green }
  - { id: date, label: "getDateRules", sub: "YYYYMMDD", row: 4, tone: blue }
  - { id: bad, label: throw, sub: "非法 dateFormat", row: 4, tone: red }
  - { id: out, label: "Expression[]", sub: "一个或多个条件", row: 5, kind: database }
edges:
  - { from: in, to: q0 }
  - { from: q0, to: abs, label: "否（绝对时间）", dashed: true }
  - { from: q0, to: v, label: "是" }
  - { from: v, to: q }
  - { from: q, to: ts, label: "timestamp" }
  - { from: q, to: unix, label: "unixTimestamp" }
  - { from: q, to: date, label: "date" }
  - { from: q, to: bad, label: "其它", dashed: true }
  - { from: ts, to: out }
  - { from: unix, to: out }
  - { from: date, to: out }
```

```callout
tone: green
icon: ✅
text: |
  ==**注意最上面那个分支：绝对时间不展开。**==

  ```text
  if (dateType !== DateType.Relative) {
      return [{ op, column: name, value }];
  }
  ```

  「2026-03-01 那天」就是一个值，不需要算。
  ==只有相对时间才需要「展开成多个条件」。==
```

### 谁在调它

```text
getTimeRules 被三个文件调用：
  crowd/src/entrepots/portrait.ts    ← 画像条件
  crowd/src/entrepots/event.ts       ← 事件条件
  crowd/src/entrepots/relation.ts    ← 关系条件
```

```callout
tone: amber
icon: ⚠
text: |
  ==**改这个函数要同时考虑三条调用路径。**==

  而且 `isTag` 这个参数就是从调用方传进来的
  （`this._type === Modules.Tag`）—— 意味着**同一个时间条件在「标签」和「分群」
  两个场景下行为不一样**。

  ==这是它参数多的根本原因：它要服务三个调用方 × 两个场景。==
```

## 04 · 细节：三条路各生成什么

### ① `Timestamp` —— 毫秒时间戳（只给事件用）

```text
// 注释写得很明确：
// 目前仅有 事件使用 ms 时间戳形式，而事件仅支持 最近N 天的相对时间
if (!isLatestDays(op)) {
    throw new Error(`相对时间操作符错误，timestamp 当前仅支持 > 和 >=`);
}
```

**生成的东西**（`gap = 7`）：

```sql
`event_time` >= UNIX_TIMESTAMP(DS_DATETIME_ADD('day', -7, FROM_UNIXTIME(UNIX_TIMESTAMP(), '%Y-%m-%d 00:00:00'))) * 1000
`event_time` <  UNIX_TIMESTAMP(FROM_UNIXTIME(UNIX_TIMESTAMP(), '%Y-%m-%d 00:00:00')) * 1000
```

```callout
tone: violet
icon: 💡
text: |
  ==**注意最外层那个 `* 1000`。**==

  因为 `event_time` 存的是**毫秒**时间戳，
  而 `UNIX_TIMESTAMP()` 返回的是**秒**。

  这就是为什么 [⑥ 方言篇](../sql-builder-v2-core-dialect/) 里
  Doris 要自己实现一遍 —— Doris 的 `event_time` 是 `DATETIME`，
  不能套这层包装。
```

### ② `UnixTimestamp` —— 秒时间戳（画像）

```text
const isLastestDayExactFlag = dateUnit === DateUnit.Day && isLatestDays(op) && latestIncludeToday;
// 是否记录精确值
const exact = isTag || dateUnit !== DateUnit.Day || isLastestDayExactFlag;

const border = exact ? 'NOW()' : `FROM_UNIXTIME(UNIX_TIMESTAMP(), '${pattern}')`;
```

```compare
first: exact
head: [起点怎么算, 终点怎么算]
rows:
  - true: [{ text: "`NOW()` —— 精确到此刻", tone: blue }, "`UNIX_TIMESTAMP()` —— 此刻"]
  - false: [{ text: "`FROM_UNIXTIME(UNIX_TIMESTAMP(), '%Y-%m-%d 00:00:00')` —— 今天 0 点", tone: green }, "今天 0 点"]
```

```callout
tone: violet
icon: 💡
text: |
  **`exact` 由三件事决定：**

  - `isTag` —— 标签场景要精确
  - `dateUnit !== Day` —— 小时粒度必须精确
  - `latestIncludeToday` —— 明确要求包含当天

  ==三个条件里任意一个成立，就从「今天 0 点」变成「此刻」。==
```

### ③ `Date` —— `YYYYMMDD`

```text
const startGap = isTag && includeToday ? gap - 1 : gap;
const endGap   = isTag && includeToday ? 0 : 1;

return generateLatestDaysRules(
    column,
    `DS_DATE_ADD(NOW(), ${-startGap})`,
    `DS_DATE_ADD(NOW(), ${-endGap})`,
    true
);
```

```callout
tone: amber
icon: ⚠
text: |
  **`YYYYMMDD` 是日期字符串，所以加减要按「天」算 ——
  用 `DS_DATE_ADD` 而不是 `DS_DATETIME_ADD`。**

  ==三条路用的函数完全不同：==

  | 格式 | 加减函数 |
  |---|---|
  | 毫秒时间戳 | `DS_DATETIME_ADD('day', ...)` |
  | 秒时间戳 | `DS_DATETIME_ADD('${dateUnit}', ...)` |
  | `YYYYMMDD` | `DS_DATE_ADD(NOW(), ...)` |
```

## 05 · 细节：三个容易踩的地方

### ① 两个「包含今天」的参数，管的不是一回事

```text
includeToday: 0 | 1;
// "Tag 下 日期类 是否包含当天"；Module Tag + dateFormat = 'date' 专用，其它场景会被忽略

latestIncludeToday: 0 | 1 | undefined;
// "Crowd 下时间类 最近 X 天 是否包含当天"；
// Module Crowd + DateType === 'relative' + dateUnit === DateUnit.Day 专用，其它场景会被忽略
```

```compare
first: 参数
head: [生效条件, 影响谁]
rows:
  - "`includeToday`": ["`Module Tag` + `dateFormat = 'date'`", "`getDateRules`"]
  - "`latestIncludeToday`": ["`Module Crowd` + `relative` + `dateUnit = Day`", "`getUnixTimestampRules` 的 `exact`"]
```

```callout
tone: red
icon: ⚠
text: |
  ==**两个参数的注释里都写着「其它场景会被忽略」。**==

  也就是说：**传了不一定生效**。传错场景等于没传。

  这种设计很难说是好的 —— 但它反映了真实情况：
  ==「包含当天」在不同场景下语义不同，硬合成一个参数会更糟。==
```

### ② 有些组合被校验挡掉

```text
function timeExprValidate(expr) {
    if (expr.dateUnit === DateUnit.Hour && expr.dateFormat !== DateFormat.UnixTimestamp) {
        throw new Error(`只有 ${DateFormat.UnixTimestamp} 支持"小时"粒度...`);
    }

    if (expr.relativeDateType === RelativeDateType.SingleDay
        && expr.dateFormat !== DateFormat.Timestamp) {
        throw new Error(`【距今 X 天】，目前仅支持 ${DateFormat.Timestamp}...`);
    }
}
```

```compare
first: 组合
head: [合法吗, 为什么]
rows:
  - "小时 + 毫秒时间戳": [{ text: "❌", tone: red }, "只有画像支持小时粒度"]
  - "小时 + YYYYMMDD": [{ text: "❌", tone: red }, "日期字符串没有小时"]
  - "单天 + 非时间戳": [{ text: "❌", tone: red }, "「距今 X 天」是事件专有的说法"]
  - "单天 + 毫秒时间戳": [{ text: "✅", tone: green }, "合法"]
```

```callout
tone: green
icon: ✅
text: |
  **校验放在展开之前（`getTimeRules` 里调），不是各个实现里。**

  好处是**错误信息统一、早失败**。
  ==而不是等进了 `getTimestampRules` 才发现「这个组合不该进来」。==
```

### ③ 为什么 `<` 必须补一个 `> 0`

```text
// crowd/src/entrepots/portrait.ts
function addHackRules(columnName: string, op: Op, rules: Expression[]): Expression[] {
    // 对于 < 和 <= 的时间范围，需要加上 `> 0` 的限制条件
    // 否则会筛选出值为 0 的数据
    if ([Op.Lt, Op.Lte].includes(op)) {
        return rules.concat({ op: Op.Gt, column: columnName, value: 0 });
    }
    return rules;
}
```

```journey
- tag: 场景
  tone: muted
  name: 业务说
  code: |
    「开户时间在 7 天前之前」（op = '<'）
  note: |
    意思是「老用户」。
  next: "展开 :: :: 生成一个条件"

- tag: 展开后
  tone: violet
  name: 一个条件
  code: |
    `opened_time` < 开始时间
  note: |
    看起来没问题。
  next: "但 :: :: 库里有一批值是 0"

- tag: 问题
  tone: red
  name: 值为 0 的行也被选中
  code: |
    `opened_time` = 0  <  开始时间   → true
  note: |
    ==在时间戳语义里，`0` 代表「从没发生过」。==

    这个人从来没开过户，但 `0 < 开始时间` 成立 ——
    **他被当成了「很久以前开过户的老用户」。**
  next: "补丁 :: :: 加一个下限"

- tag: 修复
  tone: green
  name: 加一个 `> 0`
  code: |
    `opened_time` < 开始时间
    AND `opened_time` > 0
  note: |
    把「从没发生过」的人排除掉。==语义就对了。==
```

```callout
tone: amber
icon: ⚠
text: |
  **这个补丁叫 `addHackRules` —— 名字里的 `Hack` 是诚实的。**

  它不是设计的一部分，是**修补一个语义漏洞**：
  「0 代表没发生过」这个约定没有在数据模型里表达出来，
  只能在查询时手工排除。

  ==而它在 `portrait.ts` 和 `relation.ts` 里各有一份，逐字节相同。==
  （⑧ crowd 篇讲过这个重复。）
```

## 06 · 自测

```quiz
- q: "一个「最近 7 天」在代码里有几种 SQL 形态？为什么？"
  a: |
    **三种**，按底层存的格式分：
    - `Timestamp`（毫秒时间戳）—— 只给事件用，且只支持 `>` / `>=`
    - `UnixTimestamp`（秒时间戳）—— 画像
    - `Date`（`YYYYMMDD`）—— 画像
    三条路用的加减函数都不同（`DS_DATETIME_ADD` vs `DS_DATE_ADD`），
    起止时间算法也不同。

- q: "为什么毫秒时间戳那条路要 `* 1000`？"
  a: |
    因为 `event_time` 存的是**毫秒**时间戳，而 `UNIX_TIMESTAMP()` 返回**秒**。
    这也是 [⑥ 方言篇](../sql-builder-v2-core-dialect/) 里 Doris 要自己实现一遍的原因 ——
    Doris 的 `event_time` 是 `DATETIME`，不能套这层包装。

- q: "`includeToday` 和 `latestIncludeToday` 是同一回事吗？"
  a: |
    **不是。** `includeToday` 是 `Module Tag` + `dateFormat = 'date'` 专用；
    `latestIncludeToday` 是 `Module Crowd` + `relative` + `dateUnit = Day` 专用。
    两个参数的注释里都写着「其它场景会被忽略」——
    ==也就是说传了不一定生效。==

- q: "`getTimeRules` 处理绝对时间时会展开吗？"
  a: |
    **不会。** 它直接返回一个条件：`[{ op, column: name, value }]`。
    因为「2026-03-01 那天」就是一个值，不需要算。
    ==只有相对时间才需要展开成多个条件。==

- q: "为什么 `<` 的时间条件要额外补一个 `> 0`？"
  a: |
    因为时间戳语义里 `0` 代表「**从没发生过**」。
    比如「开户时间在 7 天前之前」意思是「老用户」，
    但一个从没开过户的人 `opened_time = 0`，`0 < 开始时间` 成立 ——
    ==他被当成了老用户==。补一个 `> 0` 把这些人排除掉。

- q: "改 `getTimeRules` 时要注意什么？"
  a: |
    它被**三个文件**调用：`portrait.ts` / `event.ts` / `relation.ts`。
    而且 `isTag` 参数是从调用方传进来的（`this._type === Modules.Tag`）——
    ==同一个时间条件在「标签」和「分群」两个场景下行为不一样。==
    这就是它参数多的根本原因：服务三个调用方 × 两个场景。
```
