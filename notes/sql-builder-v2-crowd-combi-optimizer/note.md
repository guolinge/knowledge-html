```callout
tone: blue
icon: 🧭
text: |
  前置是 [⑧ crowd 篇](../sql-builder-v2-crowd/)。

  架构篇画的主干图是**从 `Rule[]` 开始的**。这篇讲它前面那一步 ——
  在翻译之前，条件树会先被**重写**一遍。

  读完你应该能说出：「==它同时做「合」和「拆」两件相反的事，目标只有一个：少一次 UNION ALL。==」
```

## 01 · 概念：在翻译之前，还有一步

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**完整的主干是三步，不是两步。**==

  ```
  业务条件
    ↓ ① treeSimplifier 重写      ← 这篇
  重写后的条件树
    ↓ ② adapter 翻译
  Rule[]
    ↓ ③ buildWhere 编译
  SQL
  ```
```

**它在代码里的位置**：

```text
// crowd/src/combi/utils.ts · initMajorListSqlGen
return (entrepot, decode = true) => {
    const _entrepot = treeSimplifier(entrepot);        // ← 第一步就是它

    if (isMultiEntrepot(_entrepot)) {
        return decodeValue(_combinationInstance.list(_entrepot, decode));
    }
    if (isEntrepot(_entrepot)) {
        return decodeValue(_entrepotListSqlGen(_entrepot, decode));
    }
    throw new Error('条件错误(判断单个模块 or 联合)');
};
```

```callout
tone: amber
icon: ⚠
text: |
  **这意味着 `Rule[]` 和原始业务条件不是一一对应的。**

  原始条件有 3 个叶子，重写后可能变成 1 个（合并了），
  也可能变成 5 个（拆开了）。

  ==读代码时对不上号，往往就是漏了这一步。==
```

## 02 · 架构：它做七件事

```text
// combi/utils.ts · treeSimplifier()
① checkHasCustomCountCombination  → 有「自定义计数」就整个跳过，不优化
② cloneDeep                       → 不改调用方传进来的对象
③ _checkAndConvertTreeNodeToPortraitEntrepot  → 把能转的节点转成画像
④ _mergePortraitEntrepot          → 合并同一层的画像节点
⑤ _partitionSpecialCondition      → 拆开特殊条件（人群包 / rawSql / 关系）
⑥ _mainTreeMinimizer              → 压缩：去掉空节点、消掉单子节点
⑦ 空了就兜底 → select `uid` from user_portrait
```

```flow
grid: true
nodes:
  - { id: in, label: 业务条件树, row: 0, kind: frontend }
  - { id: q, label: "有自定义计数？", row: 1, tone: amber, shape: note }
  - { id: skip, label: "原样返回", sub: "不优化", row: 2, tone: muted }
  - { id: conv, label: "③ 转换", sub: "uid → 画像", row: 2, tone: green }
  - { id: merge, label: "④ 合并画像", sub: "同表的合成一个", row: 3, tone: green }
  - { id: part, label: "⑤ 拆开特殊条件", sub: "人群包 / rawSql / 关系", row: 4, tone: violet }
  - { id: mini, label: "⑥ 压缩", sub: "去空节点、提单子节点", row: 5, tone: violet }
  - { id: out, label: 重写后的条件树, row: 6, kind: backend }
edges:
  - { from: in, to: q }
  - { from: q, to: skip, label: "是", dashed: true }
  - { from: q, to: conv, label: "否" }
  - { from: conv, to: merge }
  - { from: merge, to: part }
  - { from: part, to: mini }
  - { from: mini, to: out }
```

```callout
tone: violet
icon: 💡
text: |
  ==**看第 ④ 和第 ⑤ 步：它们是相反的动作。**==

  - **④ 合并** —— 把多个画像条件合成一个
  - **⑤ 拆开** —— 把一个人群包条件拆成多个

  看起来矛盾，其实同一个判断标准：**能不能少一次 `UNION ALL`。**
```

## 03 · 核心：该合的合，该拆的拆

### 画像：合并（因为查的是同一张表）

```text
「城市是杭州 AND 城市是深圳」
```

```compare
first: 阶段
head: [SQL, 代价]
rows:
  - 不优化: ["两个子查询 `UNION ALL` + `GROUP BY` + `HAVING count = 2`", { text: "两次扫表", tone: red }]
  - 优化后: ["`where city = '杭州' and city = '深圳'`", { text: "一次扫表", tone: green }]
```

**实现**：

```text
// _mergePortraitEntrepot
if (isPortraitEntrepotOnly(tree)) {
    return integratePortraitEntrepot(tree);      // 整棵树全是画像 → 合成一个
}
// 否则把同一层的画像挑出来合并成一个节点，非画像的保持原样
return {
    logic: tree.logic,
    conditions: [
        ..._others,
        { type: Entrepots.Portrait,
          condition: { items: _portraits.map(p => p.condition), logic: tree.logic } }
    ]
};
```

### 人群包：拆开（因为每个 item 是一次独立查询）

```text
// _partitionSpecialCondition
if (tree.type === Entrepots.Crowd) {
    return CrowdEntrepotClass.partition(tree);
}
```

```text
// crowd.ts · partitionCrowdTree
const partitionCrowdTree = (tree, options) => {
    if (isConditionNode(tree)) {
        return { logic: tree.logic,
                 conditions: tree.items.map((item) => partitionCrowdTree(item, options)) };
    } else {
        return { type: Entrepots.Crowd, condition: tree, options };
    }
};
```

```callout
tone: violet
icon: 💡
text: |
  **人群包为什么不能像画像那样合并？**

  因为一个人群包条件**本身就是一次独立查询** ——
  `select uid from crowds where crowd_id = 'C_888'`。

  「C_888 **或** C_999」没法写成一个 `where` ——
  它们是两行数据，不是两个字段值。

  ==所以只能拆成组合结构，交给组合层用 `UNION ALL` 处理。==
```

```compare
first: 条件
head: [底层是什么, 优化动作, 为什么]
rows:
  - 画像: ["同一张表上的**字段值**", { text: "合并", tone: green }, "一个 `where` 能表达所有组合"]
  - 人群包: ["**每一行**都是一次独立查询", { text: "拆开", tone: violet }, "`where` 表达不了「或」"]
```

```callout
tone: green
icon: ✅
quote: true
text: |
  ==**这就是「该合的合、该拆的拆」的判据：**==

  问一句：**这些条件能不能写进同一个 `WHERE`？**

  - 能 → 合并（画像）
  - 不能 → 拆成组合结构（人群包 / rawSql / 关系）
```

## 04 · 细节：三种情况它不优化

### ① 有「自定义计数」就整个跳过

```text
// checkHasCustomCountCombination
/**
 * 判断是否有 "自定义计数" （unionCount） 的 combines
 * 对于 "自定义计数" 的结构，需要保留 combines 的结构，不进行合并
 * （比如，udp 有个场景：用一批 uid 去 union all 另外一批，
 *   然后找到计数为 1 的 uid，把这批 uid 标记为无效的）
 */
```

```callout
tone: amber
icon: ⚠
text: |
  **「自定义计数」是「至少命中 N 个条件」那种查询** ——
  它**依赖 UNION ALL 的结构**（因为要数「命中了几次」）。

  一旦合并，计数就变了。所以这种情况**整个优化跳过**。

  ==宁可慢，不能错。==
```

### ② 有些 uid 条件不能转成画像

```text
// uid.ts
static checkCanBeConvertToPortraitEntrepot(condition) {
    return !(condition.op === ScopeOp.In && condition.ignoreNoExist !== true);
}
```

```callout
tone: red
icon: ⚠
text: |
  **这个条件看着绕，语义很直白：**

  「给一批 uid」转成「查画像表 `where uid in (...)`」有个前提 ——
  ==画像表里得有这些人。==

  - **原始语义**（`ignoreNoExist = false`）：这批人**都要算上**
  - **转成画像后**：`where uid in (...)` 查不出不存在的人，==会静默丢掉==

  所以只有 `ignoreNoExist = true`（不存在就忽略）时才允许转。
```

### ③ 空树有兜底

```text
// treeSimplifier 最后
if (!mini) {
    return createRawSqlEntrepot('select `uid` from user_portrait');
}
```

```callout
tone: violet
icon: 💡
text: |
  **优化后整棵树可能是空的**（所有节点都被压掉了）。

  这时候不能返回空 —— 那会生成一段没有 `WHERE` 的 SQL，等于「所有人」。

  ==兜底成「查画像表所有人」，语义明确。==
```

## 05 · 细节：压缩 —— 消掉只有一个孩子的节点

```text
// core/src/utils.ts · treeMinimizer
export function treeMinimizer(tree, forkKey) {
    let _subNodes = tree[forkKey];
    if (_subNodes) {
        _subNodes = _subNodes.map(递归).filter(非 null);

        if (_subNodes.length === 0) return null;            // ① 全空 → 删掉这个节点
        if (_subNodes.length === 1) return _subNodes[0];    // ② 单子节点 → 提上来
        return { ...tree, [forkKey]: _subNodes };
    } else {
        return tree;                                        // 叶子
    }
}
```

**三条规则**：

```compare
first: 情况
head: [怎么做, 效果]
rows:
  - 子节点全被删了: [{ text: "返回 null（自己也被删）", tone: red }, "整枝消失"]
  - 只剩一个子节点: [{ text: "**返回那个子节点**", tone: green }, "消掉一层树枝"]
  - 还有多个: ["保留结构，递归处理过的子节点塞回去", "结构不变"]
```

```callout
tone: violet
icon: 💡
text: |
  **规则 ② 是关键：`AND( X )` 等价于 `X`。**

  一个只有单个孩子的组合节点是**纯噪音** ——
  它不改变语义，只让树更深、SQL 多一层括号。

  ==递归地做这件事，树会自动收敛到最简形状。==
```

````callout
tone: amber
icon: ⚠
text: |
  **注意它的第二个参数 `forkKey`。**

  树的分支字段有两种名字：`items`（条件树用）和 `conditions`（组合树用）。
  所以压缩函数要知道自己在处理哪一种。

  这就是 `core/src/tree.ts` 里那 8 行的用途：

  ```
  export type TreeForkKey = 'items' | 'conditions';
  ```
````

## 06 · 自测

```quiz
- q: "架构篇画的主干图，缺了哪一步？"
  a: |
    缺了**重写**那一步。完整的主干是三步：
    业务条件 →（treeSimplifier 重写）→ 重写后的条件树 →（adapter 翻译）→
    `Rule[]` →（buildWhere 编译）→ SQL。
    重写在 `crowd/src/combi/utils.ts` 里，不在 core。
    这也意味着 ==`Rule[]` 和原始业务条件不是一一对应的==。

- q: "优化器为什么要做「合并」和「拆开」两件相反的事？"
  a: |
    因为判据是同一个：**这些条件能不能写进同一个 `WHERE`？**
    - 画像：同一张表上的字段值 → 能 → **合并**（省掉 UNION ALL）
    - 人群包：每一行都是一次独立查询 → 不能 → **拆成组合结构**
    ==目标只有一个：少一次 UNION ALL。==

- q: "人群包为什么不能像画像那样合并？"
  a: |
    因为一个人群包条件**本身就是一次独立查询**
    （`select uid from crowds where crowd_id = 'C_888'`）。
    「C_888 **或** C_999」没法写成一个 `where` ——
    它们是两行数据，不是两个字段值。

- q: "什么情况下优化器会「整个跳过」？"
  a: |
    有「自定义计数」（`unionCount`）的时候。
    那种查询**依赖 `UNION ALL` 的结构**（要数「命中了几次」），
    一旦合并计数就变了。
    ==宁可慢，不能错。==

- q: "为什么有些 uid 条件不能转成画像查询？"
  a: |
    因为「给一批 uid」和「查画像表 `where uid in (...)`」有个前提差异 ——
    画像表里得有这些人。
    如果有人不在画像表，转过去会**静默丢掉**他们，
    而原始语义（`ignoreNoExist = false`）是「这批人都要算上」。
    所以只有 `ignoreNoExist = true` 时才允许转。

- q: "`treeMinimizer` 对「只有一个子节点」的树枝做了什么？"
  a: |
    **返回那个子节点** —— 也就是把树枝提上来，消掉一层。
    因为 `AND( X )` 等价于 `X`，单孩子的组合节点是纯噪音：
    不改变语义，只让树更深、SQL 多一层括号。
    递归地做，树会自动收敛到最简形状。
```
