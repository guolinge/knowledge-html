> 一个 `?values=a&values=b` 的请求，回来只有一条。
>
> 前端说「我传了两个」，下游说「我只收到一个」，中间那段代码看起来还「考虑过数组」。
> 这一篇把这条链走一遍，指出坏点落在第几环，再讲它为什么能活得这么久。

## 01 · 三方都说自己没错

```compare
first: 谁
head: [他看到的, 真实情况]
rows:
  - 浏览器: ["URL 里有两个 values", "对，原样发出去了两个"]
  - BFF 控制器: ["`queryList` 里写了数组判断", { text: "那个分支永远走不到", tone: red }]
  - Data Admin: ["收到的 values 只有一项", "对，它就按一项办事"]
  - 用户: ["只显示了第一个名称", { text: "数据在 BFF 就读丢了一个", tone: red }]
```

四行里没有一行是「报错」。丢数据发生在**读参数**这一步，而读参数不报错——它只是安静地给了你一个合法值。

```callout
tone: red
icon: ⚠
text: |
  ==静默丢一半，比抛异常难查十倍。==

  异常会给你一个堆栈；静默丢数据只给你一个「看起来正常」的结果 ——
  于是排查方向从一开始就是错的。
```

## 02 · 把这条链走一遍

```seq
grid: true
participants:
  - { id: b, label: 浏览器, tone: blue }
  - { id: s, label: audience BFF, tone: violet }
  - { id: d, label: Data Admin, tone: green }
messages:
  - { from: b, to: s, label: "GET ?values=a&values=b", kind: sync, note: 1 }
  - { from: s, to: s, label: 解析, kind: self, note: 2 }
  - { from: s, to: s, label: 取第一个, kind: self, note: 3, tone: red }
  - { from: s, to: d, label: "values: ['a']", kind: sync, note: 4, tone: red }
  - { from: d, to: s, label: 只回来 1 条, kind: reply, note: 5 }
  - { from: s, to: b, label: 只回来 1 条, kind: reply, note: 6 }
```

第 ② 步是对的：解析器把两个同名参数**堆成了数组**，一个都没丢。
第 ③ 步把数组压成了一个值。从这一步开始，下游再怎么正确都救不回来——它压根不知道曾经有两个。

```callout
tone: violet
icon: 💡
quote: true
text: |
  ==下游没救，是因为上游没递。==

  「结果少了一条」这类现象，第一反应通常是查下游；但判断根因有一个更快的办法：
  **先看下游实际收到的入参是什么形状**，而不是看它返回了什么。
```

## 03 · 同一份 URL，两种读法

egg 从同一份解析结果出发，给你两个 getter。它们的区别只有一个「过滤函数」：

```compare
first: 形态
head: [ctx.query, ctx.queries]
rows:
  - 值的类型: ["字符串", "字符串数组"]
  - 传一个 values: ["`'a'`", "`['a']`"]
  - 传两个 values: [{ text: "`'a'` —— 第二个没了", tone: red }, "`['a','b']`"]
  - 适合谁: ["只会出现一次的参数", "可能重复出现的参数"]
```

底层解析用的是 Node 内置模块，它的规则只有一条：**同一个 key 出现多次，就把值堆成数组**。本机实测（Node v22.23.2）：

```js
querystring.parse('resolverKey=security&values=a&values=b')
// { resolverKey: 'security', values: [ 'a', 'b' ] }      ← 已经两个都在

querystring.parse('values=a')
// { values: 'a' }                                        ← 只出现一次，就是一个字符串

querystring.parse('values[]=a&values[]=b')
// { 'values[]': [ 'a', 'b' ] }                           ← 方括号写法，key 名不同
```

所以**参数叫什么名字完全不影响结果**。把 `values` 换成 `foo`，行为分毫不差。决定形状的是「这个 key 出现了几次」，不是它叫 `values`。

```callout
tone: amber
icon: ⚠
text: |
  方括号那种写法还有第二个坑：`values[]=a` 走 `ctx.query` 会**完全取不到**——
  因为 key 实际是 `values[]`，而你去读 `values` 自然是 `undefined`。
```

## 04 · 差的那一行

```ts
// egg 3.27.1 · app/extend/request.js
get query()   { return this._customQuery(_querycache,   firstValue); }
get queries() { return this._customQuery(_queriesCache, arrayValue); }

function firstValue(v) { return Array.isArray(v) ? v[0] : v; }   // 只留第一个
function arrayValue(v) { return Array.isArray(v) ? v : [ v ]; }  // 统一成数组

// 两个 getter 共用同一份解析结果，只是喂给不同的过滤函数：
const query = str ? querystring.parse(str) : {};
```

出问题的那一行读的是 `ctx.query`（`server/app/controller/crowd.ts:147`），于是拿到的是 `firstValue` 过滤之后的字符串。

更值得注意的是它旁边那个「体贴」的兜底：

```ts
const raw = Array.isArray(value) ? value : value == null ? [] : [ value ];
//          ↑ 看着很稳，实际是死代码
```

`ctx.query` 永远不会把数组交给它，所以 `Array.isArray` 那一路永远走不到。**这段兜底不但没帮上忙，还让读代码的人以为「这里已经处理过重复参数了」。**

```callout
tone: red
icon: ⚠
text: |
  ==看起来防御性的代码，可能只是把错误包装得更像正确。==

  判断标准很简单：这个分支能不能被走到？走不到的类型判断，比没有更危险。
```

## 05 · 为什么框架要准备两套

```cards
cols: 3
items:
  - title: 默认安全
    tag: 主因
    tone: green
    desc: 重复参数是攻击面，扁平化等于「只认第一个」
  - title: 好用
    desc: 绝大多数参数只出现一次，谁都希望它直接是字符串
  - title: 兼容
    desc: query 是老 API，补能力时新增 queries 而不是改掉旧行为
```

第一条是最实在的动机。重复参数（HTTP Parameter Pollution）是经典攻击面：不同框架对「同名参数取哪个」处理方式不同，攻击者就利用这个差异，让校验层取到的值和业务层取到的值不一样。

```text
?resolverKey=security&resolverKey=evil
        ↓ ctx.query 只取第一个
{ resolverKey: 'security' }     ← 攻击者塞的第二个进不来
```

如果框架默认就交给你一个数组，那**每个接口**都得自己写 `Array.isArray` 判一下再决定取哪个，漏一个就是漏洞。默认扁平 = 默认安全；要保真就显式用 `ctx.queries`。

代价也很明确：**两套 API 长得很像，拿错的后果是静默少数据**，而且类型上看不出任何异常——`ctx.query.values` 就是 `string`，天经地义。

## 06 · 为什么它活了很久

```cards
cols: 2
items:
  - title: 单选场景完全不现形
    tone: amber
    desc: 回显 1 个值时 `['a']` 和 `'a'` 都能用，只有多选才炸
  - title: 死代码替它挡枪
    tone: amber
    desc: 那个 Array.isArray 分支让读代码的人以为已处理
  - title: 症状指向反方向
    tone: amber
    desc: 返回条数少，第一反应是查下游，而下游一直是对的
  - title: 没有多值测试
    tone: red
    desc: 测试里只有单值回显和关键词搜索，多值这条路从来没跑过
```

四条里最后一条才是根因级别的。前三条解释了「为什么难发现」，第四条解释了「为什么一直没人发现」。

## 07 · 修法与防线

```diff
- const values = queryList(this.ctx.query, 'values');
+ const values = queryList(this.ctx.queries, 'values');

- function queryList(query: unknown, key: string): string[] {
-   const value = (query as Record<string, unknown>)[key];
-   const raw = Array.isArray(value) ? value : value == null ? [] : [ value ];
-   return raw.filter(...).map(...).filter(Boolean);
+ function queryList(queries: Record<string, unknown[]>, key: string): string[] {
+   const value = queries[key];
+   return Array.isArray(value) ? value.filter(...).map(...).filter(Boolean) : [];
```

三处改动，价值递增：

```checklist
items:
  - 换数据源：`ctx.query` → `ctx.queries`，重复的 key 全部保留
  - 把约定写进类型：参数从 `unknown` 改成 `Record<string, unknown[]>`，以后谁再传错，编译期就报错
  - 删掉「贴心兜底」：读不到就返回空数组，宁可一个都不显示，也不悄悄只显示一半
```

第三条是这次最值得学的：**兜底要往「少给」的方向兜，不能往「凑一个」的方向兜。**

````callout
tone: green
icon: ✅
text: |
  但这三道防线都还是「靠人记住」。真正的防线是**一条测试**：

  ```ts
  it('values 传多个时全部转发给下游', async () => {
    // 断言下游收到的 values 长度是 2，而不是 1
  });
  ```

  ==这个 bug 活了那么久，不是因为难查，是因为没人测那条路。==
````

## 08 · 速查

```summary
title: 一句话
text: |
  HTTP 的 query string 里**没有数组这个类型**，数组只能靠约定表达。
  `ctx.query` 是「精简版」（重复 key 只留第一个），`ctx.queries` 是「完整版」（每个 key 都是数组）。
  **参数名不重要，重要的是它会不会出现多次。**
```

| 要读的参数 | 用什么 | 顺手做什么 |
|---|---|---|
| 只可能出现一次（`page`、`keyword`） | `ctx.query` | 校验一下类型，别假设它一定是字符串 |
| 可能出现多次（`values`、`ids`、`tags`） | `ctx.queries` | 参数类型写死成数组，读不到就返回空 |

两条工程建议，来自这个 bug：

- **一个 endpoint 别同时承载「全单值」和「天然多值」两种语义**。搜索（`keyword`）和批量回显（`values`）挤在一起，就注定有人会踩到重复参数。拆成 GET 搜索 + POST body 回显，数组只出现在 body 里，这类问题从根上消失。
- **多值参数本来就有长度上限**。几十个值拼进 URL，网关或浏览器一截断，丢的不是一个，是一整段。批量操作走 POST body，不只是洁癖。

## 09 · 自测

```quiz
- q: 请求是 `?ids=1&ids=2&ids=3`，用 `ctx.query.ids` 拿到什么？
  a: |
    拿到字符串 `'1'` —— 后两个被 `firstValue` 丢掉了。
    `ctx.queries.ids` 才是 `['1','2','3']`。
- q: 把参数名从 `ids` 改成 `id`，行为会变吗？
  a: |
    不会。解析器不认识参数名，它只按「同一个 key 出现了几次」决定数组还是标量。
    真正影响结果的是「调用方会不会重复传」。
- q: 为什么 `ctx.query` 要设计成只取第一个，而不是给数组？
  a: |
    默认安全。重复参数是经典攻击面（同名参数让校验层和业务层各取到一个值）。
    扁平化等于「只认第一个」，攻击者塞的第二个进不来；要保真的场景显式用 `ctx.queries`。
- q: "代码里写了 `Array.isArray(value) ? value : [value]`，为什么还是丢了一个？"
  a: |
    因为 `ctx.query` 永远只给标量，那个数组分支是死代码。
    防御性写法如果走不到，就只是把错误包装得更像正确 —— 比不写更危险。
```
