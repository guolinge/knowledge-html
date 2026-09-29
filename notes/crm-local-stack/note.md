> 本机跑这个项目要同时伺候**四个东西** —— 前端、后端、一个装元数据的 MySQL、一个装业务数据的 Doris。
>
> ==想直接开工 → 看 01 节抄命令。想知道为什么这么写 → 从 02 节开始读。==
>
> 所有命令都在本机冷启动实测过。

## 01 · 命令速查

```callout
tone: blue
icon: 🧭
text: |
  这一节是给你**直接抄**的，不讲道理。

  ==每条命令的**右上角**悬停会出现「复制」按钮==，点一下就进剪贴板。想看「为什么要这样」，
  从 02 节开始 —— 那里解释了这四样东西怎么协作、命令里的每个动作在干什么。

  ==如果只有 30 秒：抄「启动」，跑完开 `localhost:5173`。==
```

### 启动

```bash
podman machine start >/dev/null 2>&1; podman-compose -f metadata/docker-compose.yml up -d >/dev/null 2>&1; podman start doris_fe_1 doris_be_1 >/dev/null 2>&1; printf '等待 元数据 MySQL'; until podman exec crm-dc-mysql mysqladmin ping -uroot -pcrm_meta --silent >/dev/null 2>&1; do printf '.'; sleep 2; done; echo ' ✓'; printf '等待 Doris FE'; until podman exec doris_fe_1 mysql -h127.0.0.1 -P9030 -uroot -e 'SHOW DATABASES' >/dev/null 2>&1; do printf '.'; sleep 2; done; echo ' ✓'; pnpm run dev
```

期望输出：

```text
等待 元数据 MySQL... ✓
等待 Doris FE. ✓
apps/client dev:  ➜  Local:   http://localhost:5173/
apps/server dev:  Server listening at http://127.0.0.1:8787
```

然后开 `http://localhost:5173/`。

### 停止

```compare
first: 命令
head: [停掉什么, 数据还在吗, 下次怎么起]
rows:
  - "`Ctrl+C`": ["只停 dev（前端 + 后端）", { text: 在, tone: green }, "只要 `pnpm run dev`"]
  - "`podman stop crm-dc-mysql doris_fe_1 doris_be_1`": ["三个容器（容器保留）", { text: 在, tone: green }, "完整那条启动命令"]
  - "`podman-compose -f metadata/docker-compose.yml down`": ["MySQL 容器被**删掉**", { text: 在, tone: green }, "同上（走 `up` 重建）"]
  - "`podman machine stop`": ["整台虚拟机，四个全停", { text: 在, tone: green }, "同上"]
```

==四个层次全都不丢数据==，怎么选看你要停多彻底。原理见 05 节。

### 确认环境是好的

```bash
# 后端活着吗
curl -s http://127.0.0.1:8787/api/health
# → {"ok":true}

# 元数据读得到吗（这一步证明 MySQL 通了）
curl -s http://127.0.0.1:8787/api/meta/catalog | head -c 80
# → {"universeTable":"user_portraits_wide","fields":[...],"relations":[...]}

# Doris 通了吗（这一步证明业务数据能查）
curl -s -X POST http://127.0.0.1:8787/api/preview \
  -H 'Content-Type: application/json' -H 'X-Staff-Id: 301' \
  -d '{"query":{"version":1,"scope":{"type":"scope","kind":"all"},"include":null,"exclude":null},"page":1,"pageSize":3}'
# → {"count":1000000, "rows":[{"uid":"10001","customerName":"向治文",...}]}
```

**三条依次通过，说明整条链路都对。** 第三条返回 `count: 1000000`
就是你当初灌进去的那个数，对得上说明 Doris 没被动过。

```callout
tone: blue
icon: 🧭
text: |
  **卡住了按这个顺序查**：

  1. `podman ps` —— 三个容器都在吗？（`crm-dc-mysql` 最容易忘）
  2. `podman machine start` —— 虚拟机在跑吗？
  3. 上面三条 `curl` —— 卡在哪一条，就是哪个部件的问题
```

### 一次性的两条

只有**重装环境**后才需要跑。日常启动不用。

```checklist
tone: warn
items:
  - "`pnpm --filter @insight/server metadata:seed` —— 重新灌元数据（3 数据源 / 46 字段 / 18 算子），0.3 秒"
  - "`pnpm run seed` —— 重建 Doris 的 100 万行，很慢，除非数据坏了否则别碰"
```

---

## 02 · 机器上跑着四个东西

```flow
grid: true
legend: true
nodes:
  - { id: br,  label: 浏览器,         sub: "打开 localhost:5173",  row: 0, kind: frontend }
  - { id: cl,  label: 前端 vite,      sub: "client · 5173",        row: 1, kind: frontend, tone: blue }
  - { id: sv,  label: 后端 fastify,   sub: "server · 8787",        row: 2, kind: backend,  tone: green }
  - { id: my,  label: MySQL 8,        sub: "crm_dc · 3307",        row: 3, kind: database, tone: violet }
  - { id: dor, label: Doris FE,       sub: "crm_insight · 9030",   row: 3, kind: database, tone: violet }
edges:
  - { from: br,  to: cl,  label: 加载页面 }
  - { from: cl,  to: sv,  label: "/api 原样转发", tone: green }
  - { from: sv,  to: my,  label: 读元数据, tone: violet }
  - { from: sv,  to: dor, label: 跑圈选 SQL, tone: violet }
```

前端不直接连数据库。它的 `/api` 请求由 vite **原样转发**给后端：

```js
// apps/client/vite.config.ts
server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } }
```

所以**浏览器只需要记住 5173 一个端口**。8787 是内部约定，不用手动访问。

### 两个数据库装的是完全不同的东西

这是最容易搞混的地方 —— 它们都叫「数据库」，但一个是**配置**，一个是**数据**。

```compare
first: 维度
head: [metadata MySQL, Doris]
rows:
  - 端口: ["3307", "9030"]
  - 库名: ["`crm_dc`", "`crm_insight`"]
  - 装什么: ["**能圈什么** —— 有哪些数据源、字段、算子、值集", "**真有人** —— 一百万条客户画像和关系"]
  - 谁来灌: ["`metadata:seed`（0.3 秒）", "`npm run seed`（很慢）"]
  - 表: ["5 张：data_source / data_field / business_domain / operator / value_set", "4 张：user_portraits_wide / rel_holding / rel_product / insight_uid_job_meta"]
  - 实际行数: ["3 / 46 / 0 / 18 / 1", "1000000 / 1328471 / 1138855 / 0"]
  - 容器: ["`crm-dc-mysql`（mysql:8）", "`doris_fe_1` + `doris_be_1`（4.1.3）"]
  - 跑在: [{ text: podman 虚拟机, tone: muted }, { text: podman 虚拟机, tone: muted }]
```

**两个都必须活着，后端才起得来。** 后端启动时会挨个连：

```ts
// apps/server/src/app.ts
await getCatalog();        // → MySQL 3307，读元数据
...
await ensureSnapshotEnv(); // → Doris 9030，建快照环境
```

任何一步连不上，进程直接退出。**缺一个都不行** —— 这也是 01 节那条启动命令里要等两个 `until` 的原因。

## 03 · 那条命令的六个动作

### 每一步在干什么

```spec
title: 一条命令的六个动作
subtitle: 每一步都可以单独敲
tone: violet
rows:
  - k: ①
    v: |
      `podman machine start` —— 启动那台跑容器的 Linux 虚拟机。

      **约 25 秒**，是整个启动里最慢的一步。已经在跑时会报 `already running`，
      所以用 `>/dev/null 2>&1` 把它吞掉。
  - k: ②
    v: |
      `podman-compose ... up -d` —— 起元数据 MySQL。

      ==用 `up` 而不是 `podman start`== —— `up` 是幂等的：容器在就起、不在就建。
      见 05 节，`down` 会把容器删掉。
  - k: ③
    v: |
      `podman start doris_fe_1 doris_be_1` —— 起 Doris。

      理论上不用写（Doris 的 compose 里有 `restart: unless-stopped`，
      跟着虚拟机自动回来），但写上无害，而且虚拟机第一次启动时更稳。
  - k: ④
    v: |
      **等 MySQL 真能回答** —— 不是等端口在听。

      `mysqladmin ping` 是让 MySQL 自己回一句话，回不了就继续等。
  - k: ⑤
    v: |
      **等 Doris 真能执行查询** —— 同上。

      `SHOW DATABASES` 会真的走一遍 FE 的查询链路，比只连 TCP 严格。
  - k: ⑥
    code: |
      pnpm run dev
      # = pnpm --filter @insight/server --filter @insight/client --parallel dev
      # 两个 dev server 并行跑
```

## 04 · 为什么要用 `until` 等 —— 端口在听，不等于能用

!!这一步不能省。我省过一次，冷启动连撞两次，报的错还各不相同。!!

### 让它自己走一遍

```demo
widget: stepper
title: 冷启动的 40 秒里，谁什么时候真就绪
actions: false
config:
  steps:
    - label: 0s
      code: "podman machine start"
      note: 虚拟机开始启动。5173 / 3307 / 8787 / 9030 全都没在听。
    - label: 23.5s
      code: "gvproxy   IPv6  *:3307 (LISTEN)\ngvproxy   IPv6  *:9030 (LISTEN)"
      note: 端口转发层起来了。lsof 现在说「3307 和 9030 都在听」。但容器里的数据库还没醒。
    - label: 24.6s
      code: "socket connect 127.0.0.1:9030  →  成功"
      note: TCP 层能握手了。看起来一切就绪 —— 但 Doris FE 内部还在加载元数据。
    - label: 25s
      code: "apps/server dev: Error: Connection lost:\n  The server closed the connection.\n  at execSql (apps/server/src/doris.ts:33)"
      note: ← 如果此时启动后端，就死在这里。报的错跟「Doris 没起」看不出关系。
    - label: 32.2s
      code: "SHOW DATABASES  →  __internal_schema\n                     crm_insight\n                     information_schema\n                     mysql"
      note: Doris 真就绪。从「端口在听」到这里，中间有 7.6 秒是假的。
```

### 实测数字

| 时刻 | 事件 | 说明 |
|---|---|---|
| `23.5s` | 3307 端口能连上 | 转发层就绪，MySQL 还没 |
| `24.6s` | 9030 端口能握手 | 转发层就绪，Doris 还没 |
| `32.2s` | **Doris 真能跑查询** | !!从「端口在听」到这里 **7.6 秒**!! |

```callout
tone: red
icon: ⚠
quote: true
text: |
  ==`lsof` 看到端口在听，和「这个数据库能回答问题」，中间隔着 7.6 秒。==

  podman 的端口转发层（gvproxy）比容器里的数据库**先起来**。
  它一开就开始 LISTEN，但转发过去的连接会被拒绝或直接断开。
```

```callout
tone: amber
icon: ⚠
text: |
  **为什么手动敲命令常常没事？**

  因为人的节奏天然慢 —— 打完 `podman machine start`、再打下一步，
  中间那 7 秒你正好在看屏幕。

  ==脚本没有这个运气，它是毫秒级连着跑的。==
  所以我们得显式写 `until` 把「人的等待」补进去。
```

### 两次失败长什么样

```compare
first: 第几次
head: [后端报的错, 真实原因, 怎么修]
rows:
  - 第一次: ["`connect ECONNREFUSED 127.0.0.1:3307`", "MySQL 还在初始化", "加 `mysqladmin ping` 的 until"]
  - 第二次: ["`Connection lost: The server closed the connection.`", "换 Doris 没就绪了", "加 `SHOW DATABASES` 的 until"]
```

> **第二次那个错更难查** —— 它出现在 `apps/server/src/doris.ts`，
> 看起来像「Doris 挂了」，但 Doris 其实活得好好的，只是慢了 7 秒。

## 05 · 停止：`down` 和 `stop` 的区别

01 节那张表说了「哪条命令停掉什么」。这一节说**为什么它们不一样**。

### 容器的三种状态

```flow
grid: true
nodes:
  - { id: run,  label: running, sub: "容器在跑",          row: 0, tone: green, shape: pill }
  - { id: stop, label: exited,  sub: "容器还在，只是停了", row: 1, tone: amber, shape: pill }
  - { id: gone, label: removed, sub: "容器没了，卷还在",   row: 2, tone: red,   shape: pill }
edges:
  # 回路只跨相邻两行 —— 跨两行的边会从中间那个节点身上穿过去
  - { from: run,  to: stop, on: "podman stop", tone: amber }
  - { from: stop, to: run,  on: "podman start", tone: green }
  - { from: stop, to: gone, on: "podman-compose down", tone: red }
  - { from: gone, to: stop, on: "up -d 重建", tone: green }
```

**这就是启动命令里用 `up` 而不是 `start` 的原因** —— `up` 三种状态都能处理：

| 容器现在 | `podman start` | `podman-compose up -d` |
|---|---|---|
| running | 无动作 | 无动作 |
| exited | 起得来 | 起得来 |
| removed | !!失败（找不到容器）!! | ++重建++ |

### 一个容易忽略的不对称

```compare
first: 容器
head: [重启策略, 虚拟机启动后会怎样]
rows:
  - "`doris_fe_1` / `doris_be_1`": ["`unless-stopped`", { text: 自动起来, tone: green }]
  - "`crm-dc-mysql`": ["`no`", { text: "**不会**自动起，要显式 `up -d`", tone: red }]
```

Doris 的 `docker-compose.yaml` 里写了 `restart: unless-stopped`，
而 `metadata/docker-compose.yml` 的 mysql 服务**没写**。

所以**每次重启电脑后，MySQL 都需要手动起一次** —— 这就是启动命令第 ② 步存在的原因。

```callout
tone: amber
icon: ⚠
text: |
  `pnpm run metadata:up` **在这台机器上用不了**。

  它内部写的是 `docker compose -f metadata/docker-compose.yml up -d`，
  而这台机器只装了 podman，没有 `docker` 命令。

  ++用 `podman-compose -f metadata/docker-compose.yml up -d` 代替。++
```

## 06 · 数据到底存在哪

```tree
- label: 宿主机（你的 Mac）
  note: 这两处都是真实文件，删容器不影响
  children:
    - label: "~/works/crm/crm-dsl-stru/doris/data/"
      sub: 250 MB
      note: Doris 的数据目录，compose 里 bind mount 进去的
      children:
        - { label: be/, note: "后端存储（表数据）" }
        - { label: fe/, note: "前端元数据（库表定义）" }
- label: podman 虚拟机内部
  note: 卷活在这里，容器删了它还在
  children:
    - label: "volume: metadata_crm_dc_mysql"
      note: MySQL 的 datadir，被挂到 /var/lib/mysql
    - label: "image: mysql:8"
      note: 镜像本体，832 MB
```

**为什么删容器不丢数据**：容器里放的只是**进程和你装的东西**，
数据落在这两处**容器外部**的地方。`podman rm` 碰不到它们。

````callout
tone: amber
icon: ⚠
text: |
  **唯一会真正丢数据的操作**是显式删卷：

  ```bash
  podman volume rm metadata_crm_dc_mysql   # ← 别敲这个
  podman-compose down -v                   # ← -v 也会删卷
  ```

  删了之后 `metadata:seed` 能重新灌回元数据（0.3 秒），
  但 Doris 那 100 万行要重跑 `npm run seed`，很慢。
````

```quiz
- q: 前端页面上的「查询」按钮，数据是经过几个进程才拿到的？
  a: |
    三个：浏览器 → vite（5173，只做 /api 代理转发）→ 后端 fastify（8787）。
    后端再去连两个数据库 —— MySQL 3307 读「能圈什么」，Doris 9030 跑「圈出来谁」。
    所以浏览器只认 5173 一个端口，8787 是内部约定。
- q: 为什么启动命令里要用 `until ... ping` 等，而不是直接跑 `pnpm run dev`？
  a: |
    因为 podman 的端口转发层比容器里的数据库先起来 —— 实测有 7.6 秒的窗口，
    lsof 说 9030 在听，但连上去会被断开。

    不等的话后端正好死在这个窗口里，报 `Connection lost: The server closed the connection.`
    这个错还出现在 doris.ts，看起来像 Doris 挂了，其实它只是慢了几秒。
- q: 跑 `podman-compose down` 之后，Doris 那 100 万行数据会没了，对吗？
  a: |
    不对。`down` 只删容器，不删卷，也碰不到 Doris 的数据。

    Doris 的数据是宿主机上的目录 `doris/data/`（bind mount，248 MB），
    MySQL 的数据在 podman 卷 `metadata_crm_dc_mysql` 里。两处都在容器外面。

    真正会丢的只有显式删卷（`podman volume rm` 或 `down -v`）。
    四个停止层次全都不丢数据。
- q: 重启电脑后，为什么 MySQL 要手动起、Doris 却不用？
  a: |
    因为重启策略不一样：Doris 的两个容器是 `restart: unless-stopped`，
    虚拟机起来它们就跟着回来；`crm-dc-mysql` 是 `restart: no`，不会自动起。

    所以启动命令里必须有 `podman-compose ... up -d` 这一步。
    顺带：`pnpm run metadata:up` 在这台机器上用不了，它内部调的是 `docker compose`。
```

```summary
title: 记住这三句就够了
text: |
  ==一条命令起、四个层次停、数据从来不丢。==

  - **起**：`machine start` → `compose up -d` → `podman start doris` → 等两个 until → `pnpm run dev`
  - **停**：`Ctrl+C` 最常用；`podman machine stop` 最彻底。都不丢数据。
  - **查**：三条 curl 依次过，卡在哪条就是哪个部件的问题。

  ++忘了命令长什么样，回 01 节抄。++
```
