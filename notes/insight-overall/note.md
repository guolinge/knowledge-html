这是「理解客群洞察」这棵树的入口。树上五篇笔记各钻一层（配置、数据、组件、协议、机制）；这一篇把它们接到**同一张地图**上 —— 谁在哪个域、一条查询走哪些零件、一份名单怎么冻出来。

```callout
tone: blue
icon: 🧭
text: |
  **怎么玩这张图**：点零件看它的内容和直接关系；点区域标题看分组含义；
  「对比两个零件」出对照表；三条导览各回答一个问题 ——
  ==一次预览怎么走、一份名单怎么冻、元数据怎么流动==。
```

## 01 · 整体地图

读图顺序：==从左上角读元数据域==（Data Admin 写、读接口出投影），==沿前端一行往右读界面==，==两条竖直管线往下读执行==（左预览活查、右快照异步），最右列是下游跟进事项。

```arch
svg: insight-overall
maxScale: 0.9
caption: 元数据域在最左（Admin 写 crm_dc_*，读接口出两份投影）；前端一行四个页面；中间三个 npm 包；两条竖直管线是预览（活查）与快照（异步 Job）；最右列是跟进事项下游。
frames:
  - id: meta
    boundary: 0
    label: 元数据域
    kind: classification
    detail: Admin 写一份真相；读接口把它投影成两份 —— 组件版无物理列，编译版带 Catalog。
  - id: fe
    boundary: 1
    label: 洞察子应用 · 前端
    kind: contains
    detail: 四个页面共享一个组件包和一个草稿协议；勾选方式决定导出与下发是精准还是模糊。
  - id: pkgs
    boundary: 2
    label: 组件与协议
    kind: contains
    detail: 2026-10 拆成三个包：组件渲染、dsl 定协议、sql-builder 编译。组件和 BFF 共用同一份类型。
  - id: bff
    boundary: 3
    label: 洞察 Node BFF
    kind: contains
    detail: 预览是活查不建 Job；创建事项才走快照。权限谓词在服务端注入，不信前端。
  - id: exec
    boundary: 4
    label: 执行面
    kind: contains
    detail: 预览留在 normal 资源组；快照进专用限额。三个 Worker 用 CAS 推进状态机。
  - id: store
    boundary: 5
    label: 存储
    kind: contains
    detail: Doris 存业务数据与名单；MySQL 存元数据与任务状态机。
  - id: task
    boundary: 6
    label: 跟进事项 · 下游
    kind: classification
    detail: 另一个应用的领土。洞察只交出 snapshotId；名单由下游按页拉取、条数校验后落自己的库。
bodies:
  data-admin:
    badge: Go 服务
    rows:
      - { k: 写入, v: 特征 / 关系 / 属性 / 值集 / DSL 模板 }
      - { k: 停用, v: 历史条件回显保留 · 新建不可选 }
    note: 元数据是运行时真相，改这里就改界面
  mysql-meta:
    badge: crm_dc_*
    cells:
      - { label: portrait / relation / attr }
      - { label: value_set / domain }
      - { label: dsl_template ×2 }
    note: 读接口从这里投影出两份视图
  crowd-meta-api:
    badge: 三条读路径
    rows:
      - { k: /metadata, v: 组件版 · 无物理列 }
      - { k: /metadata, v: BFF 版 · 带 Catalog }
      - { k: 候选, v: value-sets · resolver-options }
  presets-page:
    rows:
      - { k: 类目, v: 所有分类 + 业务 Tab }
      - { k: 卡片, v: DSL 模板 · 只调白名单参数 }
    note: 点卡片把模板草稿灌进圈选页
  combiner-page:
    rows:
      - { k: 客户范围, v: 必挂 · dataLevel 收窄 }
      - { k: 包含区, v: 条件组 × 行 · AND/OR }
    code: v-model="query"
  result-page:
    rows:
      - { k: 汇总, v: 共 N 条 / 已选 N 条 }
      - { k: 分页, v: afterUid 游标 }
    note: 距上次查询 >1h 出「数据可能波动」横幅
  action-bar:
    rows:
      - { k: 导出, v: 实时重查 · 无快照 }
      - { k: 创建事项, v: 异步快照 → 新 tab }
  combo-pkg:
    badge: 12 个 .vue
    cells:
      - { label: ScopeBar, sub: 客户范围 }
      - { label: Group, sub: 组 / 行 / AND·OR }
      - { label: 三 Row, sub: 特征 / 关系 / UID }
      - { label: ValueControl, sub: 七种形态 }
      - { label: TemporalOps, sub: 时间模式 }
    code: 'buildQuery(draft): InsightQuery'
    note: 协议重导出自 @insight/dsl —— 组件和 BFF 共用一份类型
  dsl-pkg:
    badge: 纯 TS · 零依赖
    rows:
      - { k: draft.ts, v: "276 行 · 类型 + buildQuery" }
      - { k: audience.ts, v: CrowdMetadata 全家 }
      - { k: clock, v: 秒级时间戳 }
  builder-pkg:
    badge: 编译器
    rows:
      - { k: validate, v: 结构 + 语义 两层 }
      - { k: compile, v: 四步管道 }
    code: countSql · listSql · uidsSql · droppedUidsSql
  preview-api:
    rows:
      - { k: previewId, v: 5 分钟上下文 }
      - { k: 翻页, v: afterUid 游标 }
    note: 活查 —— 不建 Job，不出名单文件
  snapshot-api:
    rows:
      - { k: 创建, v: uidsSql → 建表 + Job }
      - { k: 详情 / 分页, v: 按 snapshotId }
    note: 重复提交得到新的 snapshotId
  dal-sql:
    rows:
      - { k: 资源组, v: normal }
      - { k: 形态, v: 同步活查 }
  dal-snapshot:
    rows:
      - { k: 一 Attempt, v: 一个 ONE_TIME Job }
      - { k: 资源组, v: 快照专用限额 }
    note: INSERT SELECT 要么全成要么全败，不留半份名单
  workers:
    badge: 2s / 5s / 30s
    cells:
      - { label: Execution, sub: 首次提交 }
      - { label: Monitor, sub: 状态同步 }
      - { label: Recovery, sub: 重试 / 对账 }
    note: 退避 1/5/15 分钟 ±20%；结果未知不自动重试
  doris-wide:
    cells:
      - { label: user_portraits_wide, sub: 宽表 }
      - { label: rel_holding, sub: 持仓长表 }
      - { label: rel_product, sub: 产品长表 }
    note: U = U_perm ∩ scope 从宽表起算
  doris-engine:
    rows:
      - { k: ONE_TIME Job, v: 一次 Attempt 一个 }
      - { k: 资源, v: 独立 Workload Group }
  doris-snapshot:
    rows:
      - { k: 表模型, v: 一快照一表 }
      - { k: 创建, v: 建表 → INSERT SELECT }
      - { k: 到期, v: 动态分区删表 }
    note: 查询必须带 snapshot_date + snapshot_id
  mysql-job:
    rows:
      - { k: 状态, v: 7 态 · 无 EXPIRED }
      - { k: attempt, v: ≤4 · 退避 ±20% }
  task-page:
    rows:
      - { k: 来源标签, v: 人数 / 生成时间 / 条件摘要 }
      - { k: 名单, v: UID 分页拉全 · 条数校验 }
    note: 失败整批丢弃，回洞察重新圈
  approval:
    rows:
      - { k: 触发, v: 圈选范围 = 全部 }
      - { k: 豁免, v: 本人 / 指定团队 }
  task-list:
    rows:
      - { k: 来源, v: 洞察圈选 / 其他入口 }
    note: 任务与机会实体在这里承载
parts:
  preview-api:
    facts: { 同步性: 同步活查, "Doris 资源": normal 组, 建 Job: 不建, 产物: 人数 + 一页名单 }
  snapshot-api:
    facts: { 同步性: 异步 Job, "Doris 资源": 快照专用限额, 建 Job: 建（INSERT SELECT）, 产物: snapshotId + 一快照一表 }
  doris-wide:
    facts: { 内容: 宽表 + 关系长表, 表模型: DUPLICATE, 生命周期: 长期, 查询方式: 活查 SELECT }
  doris-snapshot:
    facts: { 内容: encrypt_uid 名单, 表模型: 一快照一表, 生命周期: 到期删表, 查询方式: snapshot_date + snapshot_id }
  combo-pkg:
    facts: { 形态: "Vue 3 + element-plus", 职责: 渲染 + 产草稿, 依赖: 依赖 dsl, 校验: 宿主 e2e }
  dsl-pkg:
    facts: { 形态: 纯 TS 零依赖, 职责: 协议 + buildQuery, 依赖: 零依赖, 校验: fixtures + Doris }
tours:
  - id: preview
    label: 一次预览怎么走
    steps:
      - { at: [combiner-page, combo-pkg], text: "界面选条件，组件包把操作变成==草稿==；提交前 buildQuery 收窄成 DSL。" }
      - { at: [preview-api], text: "POST /api/preview —— 活查，不建 Job；previewId 复用人数与编译时钟。" }
      - { at: [builder-pkg], text: "结构校验、语义校验，四步编译出四条 SQL。" }
      - { at: [dal-sql, doris-wide], text: "countSql / listSql 同一段 WHERE 直查宽表，当场回人数和一页名单。" }
  - id: snapshot
    label: 一份名单怎么冻
    steps:
      - { at: [result-page, action-bar], text: "勾选决定精准 / 模糊；==创建事项才冻名单==，导出不冻。" }
      - { at: [snapshot-api], text: "uidsSql 异步执行：先建表再提交 Job，任务落 MySQL。" }
      - { at: [dal-snapshot, doris-engine], text: "CREATE JOB INSERT SELECT，快照专用资源组。" }
      - { at: [doris-snapshot, mysql-job], text: "名单落一快照一表；状态机在 MySQL 推进，终态只有 SUCCESS / FAILED。" }
      - { at: [workers], text: "三个 Worker 盯到终态：首次提交、状态同步、重试与对账。" }
      - { at: [task-page], text: "snapshotId 新 tab 跳转下发页；名单按页拉全、条数对上才落库。" }
  - id: metadata
    label: 元数据怎么流动
    steps:
      - { at: [data-admin, mysql-meta], text: "Admin 写一份真相进 crm_dc_*；停用不删除，历史条件照样回显。" }
      - { at: [crowd-meta-api], text: "读接口出两份投影：给组件的==没有物理列==，给编译的带 Catalog。" }
      - { at: [combo-pkg], text: "组件只认业务语义 —— 新增字段不改组件。" }
      - { at: [dsl-pkg, builder-pkg], text: "编译侧拿 Catalog 把 field_key 解析成表和列。" }
```

## 02 · 两条管线为什么分开

预览和快照是两条执行路径，图上它们是两根并排的竖管。分开的根据是资源与时效：预览是**当场要答案**的活查，留在 normal 资源组；快照是**异步冻名单**，进专用限额，慢一点不影响别人圈人。同一份 DSL、同一个编译器，出口不同 —— `countSql / listSql` 走左管，`uidsSql` 走右管。

边界线也讲了同一件事：下游用虚线外的领土表示 —— 洞察只交出 snapshotId，名单由下游拉取校验后落自己的库，洞察不替它管生命周期。

## 03 · 想深入哪一层

| 想搞清 | 去哪 |
|--------|------|
| 配置怎么变成界面 | [配置层](notes/data-admin-to-ui.html) |
| 表和一次查询的旅程 | [数据层](notes/insight-data-map.html) |
| 组件长什么样 | [组件图鉴](notes/combination-components.html) |
| 草稿协议逐字段 | [草稿协议](notes/combination-draft.html) |
| 条件怎么变成 SQL | [编译层](notes/insight-dsl.html) |
| 快照状态机 | [异步层](notes/snapshot-lifecycle.html) |

```quiz
- q: 为什么预览和快照在图上是两根竖管，而不是一根？
  a: |
    预览是同步活查（normal 资源组，当场回人数和名单页）；快照是异步冻名单
    （专用限额，CREATE JOB INSERT SELECT，状态机推进到终态）。
    同一份 DSL、同一个编译器，出口不同 —— 合成一根会掩盖「导出不建快照、
    预览不占快照配额」这两条资源边界。
- q: 组件包和协议包为什么是两个包？
  a: |
    组件包是 Vue + element-plus 的渲染层，协议包是零依赖纯 TS。
    拆开后 BFF 能直接 import 同一份 DraftQuery 类型和 buildQuery，
    组件和编译器共用一套错误码；类型断言 InsightQuery extends DraftQuery
    保证历史 DSL 回显免转换。依赖方向一条直线：组件依赖协议，从不反向。
- q: 元数据读接口为什么要出两份投影？
  a: |
    组件版（无物理列、含停用项回显）驱动界面，编译版（Catalog，带表名列名）
    供 SQL 解析。同一份 crm_dc_* 真相、两种安全等级：组件永远拿不到
    物理映射，DSL 与 Doris 物理模型的解耦在接口层就完成了。
```
