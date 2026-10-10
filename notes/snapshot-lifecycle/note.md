你在圈选页点一下「创建快照」——

**0.05 秒**后它回你一个 `202`，说「收到了，`snapshotId = 1`」。
**6 秒**后，快照任务页上那一行变成了「成功，138,818 人」。

但预览明明 **0.2 秒**就能出结果。为什么快照要绕这么大一圈 —— 建任务、后台 worker、七个状态、还往 Doris 里下一个 `CREATE JOB`？

```callout
tone: blue
icon: 🎯
text: |
  **这篇讲三件事**：

  - 预览和快照，为什么是两种完全不同的东西
  - 一次快照从 `INIT` 到 `SUCCESS`，中间到底经过了什么
  - ==一条约束（分区只活 5 分钟）怎么决定了整个设计的每一个数字==

  全部结论都来自**一次真跑出来的快照**，不是读文档猜的。
```

---

## 01 · 预览是「查一下」，快照是「冻下来」

```compare
first: 维度
head: [预览（查询按钮）, 快照（创建快照按钮）]
rows:
  - 接口: ["`POST /api/preview`", "`POST /api/snapshots`"]
  - 返回时机: [{ text: "**同步** —— 等 SQL 跑完才返回", tone: blue }, { text: "**异步** —— 立刻返回 202", tone: amber }]
  - 返回什么: ["人数 + 一页名单 + SQL 原文", "只有一个 `snapshotId`"]
  - 谁在执行: ["后端进程直接连 Doris 查", "**Doris 服务端**跑一个 JOB"]
  - 耗时: ["0.2 秒", "几秒到几分钟"]
  - 结果落在哪: ["什么都没落，看完就没了", "`audience_snapshot` 表里，**持久化**"]
  - 失败了: ["当场报错给你看", "记在状态里，后台重试"]
```

```callout
tone: violet
icon: 💡
text: |
  ==**根本区别不是「快慢」，是「要不要留下东西」。**==

  预览是**读**：跑一条 `SELECT COUNT(*)`，把数字给你，然后什么都不留。

  快照是**写**：要往 Doris 里 `INSERT` 几十万行，而且要保证
  「要么全写进去，要么一个也别写」—— 这才是它必须异步、必须有状态机的原因。

  **一次写几十万行，不能占着 HTTP 连接不放。**
```

**为什么非得「冻下来」？**

```callout
tone: amber
icon: ⚠
text: |
  因为**圈选条件是活的**。

  今天「年龄 ≥ 18 且地区=美国」是 138,818 人；明天有人满 18 岁了，就是 138,819 人。

  ==「创建事项」需要的是**当时那一刻**的名单。==
  所以点「创建快照」= 把这一刻的 UID 全量复制一份，冻起来。
```

---

## 02 · 一次真实快照的全程

下面是我实际跑的一次。第一个命令建快照，然后每 3 秒看一眼状态：

```text
POST /api/snapshots   →  202   {"snapshotId": 1, "status": "INIT"}

  + 0s   INIT      尝试 0  行数 -       job -
  + 3s   INIT      尝试 0  行数 -       job -          ← 还在排队
  + 6s   SUCCESS   尝试 1  行数 138818  job snapshot_1_a1_20260930113858074
  + 9s   SUCCESS   ...
```

**中间那 6 秒发生了什么？** `snapshot_log` 表把它一步一步记下来了：

```json
[
  { "id": 1, "event": "created",   "message": "已创建，等待执行" },
  { "id": 2, "event": "claimed",   "message": "第 1 次执行，Job snapshot_1_a1_20260930113858074" },
  { "id": 3, "event": "submitted", "message": "已提交 Doris，Job Id 41645728950576" },
  { "id": 4, "event": "success",   "message": "写入 138818 人" }
]
```

```seq
title: 一次快照从建到成
participants:
  - { id: fe, label: 圈选页, sub: browser }
  - { id: be, label: 后端, sub: "8787" }
  - { id: my, label: "MySQL snapshot_job", sub: 状态机 }
  - { id: wk, label: 后台 worker, sub: "3 个循环" }
  - { id: do, label: Doris, sub: "crm_insight" }
messages:
  - { from: fe, to: be, label: "POST /api/snapshots", kind: sync, note: ① 建快照 }
  - { from: be, to: be, label: "编译出 uidsSql", kind: self }
  - { from: be, to: my, label: "写一行 status = INIT", kind: sync }
  - { from: be, to: fe, label: "202 { snapshotId: 1 }", kind: reply, note: ② 立刻返回 }
  - { from: wk, to: my, label: "扫到 INIT → 抢占", kind: sync, note: ③ 1 秒扫一次 }
  - { from: wk, to: do, label: "CREATE JOB …", kind: sync, note: ④ 下 JOB，Doris 服务端自己跑 INSERT }
  - { from: do, to: wk, label: "Job Id 41645728950576", kind: reply }
  - { from: wk, to: my, label: "status = SUBMITTED", kind: sync }
  - { from: wk, to: do, label: "轮询任务状态", kind: async, note: ⑤ 2 秒扫一次 }
  - { from: do, to: wk, label: "success", kind: reply }
  - { from: wk, to: do, label: "SELECT COUNT(*) 数行数", kind: sync }
  - { from: wk, to: my, label: "SUCCESS + 行数", kind: sync, note: ⑥ 收尾 }
segments:
  - { from: 1, to: 4, label: 同步段：毫秒级 }
  - { from: 5, to: 11, label: 异步段：后台慢慢跑 }
```

**最终写在 `snapshot_job` 里的一行：**

```json
{
  "id": 1,
  "snapshot_date": "2026-09-30",
  "snapshot_minute": "2026-09-30 03:38:00",
  "status": "SUCCESS",
  "attempt": 1,
  "doris_job_name": "snapshot_1_a1_20260930113858074",
  "doris_job_id": 41645728950576,
  "doris_task_id": 41645931408192,
  "result_row_count": 138818,
  "staff_id": 301
}
```

前端「快照任务」页显示的就是这一行：

```text
快照  状态  日期        人数     尝试  Doris Job                     Job Id           操作人  创建
1     成功  2026-09-30  138818  1    snapshot_1_a1_202609301...   41645728950576   301     11:38:57
```

```callout
tone: violet
icon: 💡
text: |
  **注意 `doris_job_id` 和 `doris_task_id` 是两个不同的东西。**

  - `job_id` = Doris 那边的**调度任务**（`CREATE JOB` 建的那个）
  - `task_id` = 这次**具体执行**（Job 可能被调度多次，每次一个 task）

  它们都存下来了，排障时能直接去 Doris 里按 id 查。
```

---

## 03 · 七个状态，三个 worker

```arch
svg: snapshot-states
caption: 正常路径一条直线；可重试的错落到 RETRY_WAIT 等一会儿再上来；不能重试的直接 FAILED。
```

**三条路径，三句话：**

```cards
cols: 3
items:
  - title: 正常路径
    tag: 绿色
    tone: green
    body: |
      `INIT → CREATING → SUBMITTED → RUNNING → SUCCESS`

      五个状态一条直线，全程由后台 worker 推着走，
      **没有人在等它**。

      `SUCCESS` 时才去数一次真实行数（`SELECT COUNT(*)`），
      写进 `result_row_count`。

  - title: 可重试的错
    tag: 橙色
    tone: amber
    body: |
      落到 `RETRY_WAIT`，退避 `10 / 20 / 40` 秒后**从 `CREATING` 重来**。

      `MAX_ATTEMPTS = 4` —— 试满 4 次就 `FAILED`。

      ==为什么这么急？因为分区只活 5 分钟。== 见下一节。

  - title: 不能重试的错
    tag: 红色
    tone: red
    body: |
      直接 `FAILED`，不重试。

      **分界线是「我确定没写」还是「我不确定」**：

      - 下 JOB 时就失败（确定没写）→ 能重试
      - 「结果未知」（可能写了）→ **不能**，宁可报失败


```
**三个 worker 在后台一直转：**

```compare
first: worker
head: [扫描间隔, 干什么, 对应哪些状态]
rows:
  - "`claimAndSubmit`": ["1 秒", "抢一个任务，给它下 JOB", "`INIT` → `CREATING` → `SUBMITTED`"]
  - "`monitorOne`": ["2 秒", "问 Doris「跑完了吗」", "`SUBMITTED` / `RUNNING`"]
  - "`recoverOne`": ["5 秒", "捞那些卡住不动的", "所有未完成的"]
  - "分区维护": ["15 秒", "建新分区、删老分区", "——"]
```

```callout
tone: green
icon: ✅
text: |
  **为什么要三个，不能一个循环搞定？**

  因为它们的**关注点不同**：

  - `claimAndSubmit` 关心「有没有人干活」—— 慢了任务就排队
  - `monitorOne` 关心「干完没」—— 慢了用户就多等
  - `recoverOne` 关心「有没有卡死的」—— ==比如进程重启后，任务停在 `CREATING` 没人管==

  `recoverOne` 那一条最容易被忘掉：**进程崩了，内存里的状态全没了，但数据库里那一行还在。**
  它扫的就是这种「孤儿」。
```

---

## 04 · ★ 5 分钟的分区，决定了所有超时数字

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==**整个设计里最要紧的一条约束：`audience_snapshot` 的分区，只活 5 分钟。**==
```

**分区长什么样？** 我实际查了一下：

```text
PartitionName      VisibleVersion
pm202609300335     1
pm202609300336     1
pm202609300337     1
pm202609300338     2        ← 我的快照写进了这一格
pm202609300339     1
pm202609300340     1
pm202609300341     1
pm202609300342     1
```

```cards
cols: 3
items:
  - title: 按分钟切
    tag: 粒度
    tone: blue
    body: |
      分区名 = `pm` + `YYYYMMDDHHMM`。

      ```
      pm202609300338
        └ 2026-09-30 03:38（UTC）
      ```

      **每分钟一个分区。**

  - title: 只活 5 分钟
    tag: TTL
    tone: amber
    body: |
      ```ts
      export const PARTITION_TTL_MS = 5 * 60 * 1000;
      export const PARTITION_WIDTH_MS = 60 * 1000;
      ```

      后台每 15 秒维护一次：建未来 2 个、保留过去 6 个，
      **超过 5 分钟的老分区直接 `DROP`。**

  - title: 为什么这么短
    tag: 本机 demo
    tone: muted
    body: |
      真实系统里是 **15 个自然日**（`snapshot_date` 日分区，D-14 至 D，
      由 Doris 动态分区滚动删除；demo 还是手工维护的分钟分区）。

      本机把它压成 5 分钟 —— 这样开发时不用等两周就能看到
      「分区过期 → 名单没了」这条路径。

      ==但也正因为压短了，才把超时约束逼到台面上。==
```

### 于是所有超时数字都是从这里推出来的

```compare
first: 常量
head: [值, 为什么是这个值]
rows:
  - "`RETRY_BACKOFF_MS`": ["`[10s, 20s, 40s]`", "三次重试一共 70 秒 —— **必须在 5 分钟里跑完**"]
  - "`MAX_ATTEMPTS`": ["`4`", "第 4 次失败就放弃，不再无限重试"]
  - "`UNKNOWN_WINDOW_MS`": ["`60s`", "「结果未知」最多等 60 秒就要去查 —— **再等分区就没了**"]
  - "`STALE_THRESHOLD_MS`": ["`15s`", "超过 15 秒没更新就算卡住，`recoverOne` 来捞"]
  - "`EXECUTION_SCAN_MS`": ["`1s`", "抢占要快 —— 慢了任务就排队"]
  - "`MONITOR_SCAN_MS`": ["`2s`", "监控可以慢一点 —— 反正用户不看这一行"]
```

同一张表对着方案的量级看一遍（方案 4.5，日分区 15 天）：

```compare
first: 项
head: [本机 demo, 方案（生产）]
rows:
  - 分区: ["分钟分区，TTL 5 分钟，手工维护", "`snapshot_date` 日分区，15 个自然日，Doris 动态分区滚动"]
  - 名单列: ["`user_id BIGINT`（明文）", "`encrypt_uid CHAR(32)`（密文），分桶 `HASH(encrypt_uid)` BUCKETS 3"]
  - 重试退避: ["10s / 20s / 40s", "1 / 5 / 15 分钟，±20% 抖动"]
  - 停滞阈值 / 未知窗口: ["15s / 60s", "2 分钟 / 12 小时（受 Doris Job 历史 24h 保留约束）"]
  - worker 扫描: ["1s / 2s / 5s", "2s / 5s / 30s"]
  - 状态机与并发: ["七态 + CAS + Job 名当幂等键", "==一样== —— demo 验证的就是这套机制"]
```

机制层（状态机、CAS、幂等键、probe 数行数）两边一致，变的只是数字 ——
因为数字全部从「分区活多久」推出来。

````callout
tone: violet
icon: 💡
text: |
  ==**这一条值得单独记下来：**==

  ```
  分区只活 5 分钟
        ↓
  重试必须快（10s / 20s / 40s，总共 70s）
        ↓
  「结果未知」最多等 60 秒就要去查
        ↓
  分区过期了连查都查不了 → 只能保持原状
  ```

  **一行 `PARTITION_TTL_MS = 5 * 60 * 1000`，定住了上面所有数字的上限。**

  真实系统里 TTL 是 15 天，所以那边可以放宽得多 ——
  方案里重试退避是 1 / 5 / 15 分钟（±20% 抖动）、停滞阈值 2 分钟、「结果未知」窗口 12 小时，
  全都比 demo 宽两个数量级。但**约束的形状是一样的**：**重试窗口不能超过数据还在的时间。**
````

---

## 05 · ★「结果未知」不猜，去查事实

最难的一种情况：**Doris 那边的任务记录查不到了。**

```text
我们的状态：SUBMITTED，attempt = 1
Doris 那边：jobs() 查不到这个 JOB，tasks() 也查不到这个 task

→ 它到底写进去了没有？
```

**猜是没用的。** 代码的做法是 —— **等一会儿，然后直接去表里数**：

```ts
// workers.ts
if (action.type === 'probe') {
  // 去 audience_snapshot 里数：这个 snapshot_id 有没有落进去行
  const hit = await audienceHasRow(row.snapshotDate, row.id);

  if (hit == null) {
    // 分区已经过期了，查不了 → 什么都不做，保持原状
    await casJob(row.id, row.status, checked);
    return;
  }
  if (hit) {
    // 有行！其实成功了 → 按真实行数收尾
    await finishFromCount(row, checked, now);
    return;
  }
  // 确定没写进去 → FAILED，而且**禁止自动重试**
  await casJob(row.id, row.status, {
    status: 'FAILED',
    error: 'Doris execution result is unknown; automatic retry is disabled.',
    nextRetryAt: null,          // ← 关键：不重试
  });
}
```

```flow
grid: true
legend: true
nodes:
  - { id: q, label: "Doris 状态查不到", sub: "SUBMITTED 但 jobs() 没有", row: 0, tone: amber }
  - { id: w, label: "等 60 秒", sub: "UNKNOWN_WINDOW_MS", row: 1, tone: muted }
  - { id: p, label: "去数行 (probe)", sub: "audienceHasRow(snapshot_id)", row: 2, tone: violet }
  - { id: yes, label: "有行", sub: "其实成功了", row: 3, tone: green }
  - { id: no, label: "没行", sub: "确定失败", row: 3, tone: red }
  - { id: gone, label: "分区没了", sub: "查不了", row: 3, tone: muted }
  - { id: ok, label: "SUCCESS", sub: "按真实行数收尾", row: 4, tone: green }
  - { id: bad, label: "FAILED", sub: "不重试，等人工", row: 4, tone: red }
  - { id: keep, label: "保持原状", sub: "什么都不做", row: 4, tone: muted }
edges:
  - { from: q, to: w }
  - { from: w, to: p }
  - { from: p, to: yes }
  - { from: p, to: no }
  - { from: p, to: gone }
  - { from: yes, to: ok, anim: true }
  - { from: no, to: bad }
  - { from: gone, to: keep }
```

```callout
tone: red
icon: ⚠
text: |
  ==**「结果未知」为什么不重试？**==

  因为「未知」意味着**可能已经写进去了**。

  这时候重试，会造成 ==**重复数据**== —— 同一个 `snapshot_id` 下同一个人出现两次，
  下游拉名单的时候人数就对不上了。

  **宁可报失败让人来看，也不能悄悄写重。**

  | 情况 | 能不能重试 |
  |---|---|
  | 下 JOB 的时候就失败了（还没执行） | ✅ 能 —— 肯定没写 |
  | Doris 明确说「跑失败了」 | ✅ 能 —— 肯定没写成功 |
  | **状态未知（可能写了）** | ❌ **不能** —— 去查，查不到就让人看 |

  这条分界线就是：==**「我确定没写」可以重试，「我不确定」不行。**==
```

---

## 06 · 并发安全：casJob + job 名字当幂等键

三个 worker 同时在跑，**同一行任务可能被两个 worker 同时处理**。怎么防？

````callout
tone: blue
icon: 🔒
text: |
  **两把锁：**

  **① 状态 CAS（Compare-And-Set）**

  ```ts
  await casJob(row.id, row.status, { status: 'CREATING', ... })
  //         ↑ 期望它现在是这个状态
  //           变了就更新 0 行 → 说明别人抢走了 → 放弃
  ```

  ==每次状态变更都带上「我以为它现在是什么」，变了就不改。==

  **② JOB 名字当幂等键**

  ```ts
  const jobName = snapshotDorisJobName(row.id, attempt, timestamp);
  // → snapshot_1_a1_20260930113858074
  //     ↑快照id ↑第几次 ↑时间戳
  ```

  下 JOB 之前先查 `jobs()` 里有没有这个名字：

  ```ts
  const existing = await findDorisJob(row.dorisJobName);
  if (existing || isJobAlreadyExists(err)) {
    // 上次其实提交成功了，只是没收到回包 → 当作已提交
    await markSubmitted(row, existing?.jobId ?? null, new Date());
    return;
  }
  ```
````

```callout
tone: violet
icon: 💡
text: |
  **注意 job 名字里带了 `attempt`：`a1`、`a2`……**

  这意味着**每次重试都是一个新名字** —— 不是同名重试。

  为什么？因为**重试意味着「上一次确定没写成功」**，
  那次建 JOB 的痕迹（如果还在）不该跟这次混在一起。
  ==新名字 = 干净的一次。==

  而同一次 attempt 内如果崩了重启，名字是一样的 →
  `findDorisJob` 能查到 → **不会重复下 JOB**。
```

---

```summary
title: 三句话
text: |
  **预览是读，快照是写。** 读可以同步等 0.2 秒；写几十万行不能占着 HTTP 连接，
  所以有七个状态、三个 worker、一段 `CREATE JOB`。

  **一条约束定住了所有数字。** ==`audience_snapshot` 的分区只活 5 分钟==，
  于是重试只能 10/20/40 秒、「结果未知」最多等 60 秒。真实系统里 TTL 是 15 天，
  但形状是一样的：**重试窗口不能超过数据还在的时间。**

  **「不确定」不重试。** ==确定没写才重试；不确定就去表里数== ——
  数到有行就当成功，数到没行就报失败等人工。宁可慢，不能写重。
```

```quiz
- q: "为什么快照不能像预览那样同步返回？"
  a: |
    因为**快照要写入几十万行**。

    预览是一条 `SELECT COUNT(*)`，0.2 秒就回来，什么都不留。
    快照是一条 `INSERT ... SELECT`，可能跑几分钟，而且必须保证
    「要么全写、要么不写」。

    ==占着 HTTP 连接等几分钟不现实，而且进程一崩结果就丢了。==
    所以改成「先登记一个任务，后台慢慢跑」—— 这就是异步。

- q: "重试为什么只给 10 / 20 / 40 秒，三次就放弃？"
  a: |
    因为 `audience_snapshot` 的分区**只活 5 分钟**。

    三次退避一共 `10 + 20 + 40 = 70 秒`，加上每次的检查间隔，
    还在 5 分钟窗口里。==超过 5 分钟，连「结果到底写没写」都查不到了。==

    真实系统里 TTL 是 15 天，所以那边可以放宽 ——
    但约束的形状一样：**重试窗口不能超过数据还在的时间。**

- q: "Doris 那边查不到任务状态了，为什么不直接重试一次？"
  a: |
    因为**「未知」可能是「已经写进去了，只是没收到回包」**。

    直接重试会造成**重复数据** —— 同一个 `snapshot_id` 下同一个人出现两次，
    下游拉名单时人数就对不上。

    ==代码的处理是「去查事实」==：等 60 秒，然后直接数
    `audience_snapshot` 里这个 `snapshot_id` 有没有行。
    有行 → 当成功；没行 → 报失败**并禁止重试**，等人工介入。
```
