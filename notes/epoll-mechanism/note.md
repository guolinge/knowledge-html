```arch
svg: epoll-flow
caption: 两张表是**结果**，这张图是**过程**：事件从网卡走到你的数组，每一步的内核代码都标了出处。**两条等待队列**是这张图的骨架 —— 每个 fd 一份回调（挂在它自己的队列上），epoll_wait 自己睡在实例的队列上。
parts:
  thr:
    label: 你的线程
    sub: 三个调用，一个循环
    detail: |
      你写的代码就这么多：==登记一次，然后循环收货==。
      阻塞等待、找就绪者、挂回调、叫醒 —— 这些都不在这段代码里，
      在内核里。下面每个格子都配了对应的内核代码，标了文件和函数名。
    code: |
      int epfd = epoll_create1(0);

      struct epoll_event ev = { .events = EPOLLIN, .data.fd = listen_fd };
      epoll_ctl(epfd, EPOLL_CTL_ADD, listen_fd, &ev);  // 每个 fd 只登记这一次
      // 以后 accept 来的 conn_fd 也各 ADD 一次，之后不用再管

      struct epoll_event out[64];
      for (;;) {
          int n = epoll_wait(epfd, out, 64, -1);  // 睡到有事为止
          for (int i = 0; i < n; i++)
              handle(out[i].data.fd);             // out 里全是就绪的
      }
  rbr:
    label: 红黑树 · 登记表
    sub: epoll_ctl 往里加，一直在
    detail: |
      ==「内核那头记着」的数据结构就是它==。ADD 建一个 epitem 插进树，
      DEL 摘掉；不删它就一直在，所以你不用每轮重新交代。
      登记时它还顺手办了一件事：调这个 fd 自己的 poll 方法 ——
      ==队列在哪，fd 自己最清楚==。
    code: |
      // fs/eventpoll.c · do_epoll_ctl(EPOLL_CTL_ADD) → ep_insert
      epi = ep_alloc_epitem(ep, event, tf);  // 每个 fd 一个 epitem
      ep_register_epitem(ctx, ep, epi, ...); // 挂到文件、进程
      ep_rbtree_insert(ep, epi);             // 插进红黑树：登记长期有效

      init_poll_funcptr(&epq.pt, ep_ptable_queue_proc);
      revents = ep_item_poll(epi, &epq.pt, 1);
      // ↑ 调这个 fd 自己的 poll 方法。socket 的 tcp_poll 会调
      //   poll_wait(file, sk_sleep(sk), pt) —— 它自己的等待队列
      //   就从这扇门交出来（select/poll 走的是同一扇门）
  wqA:
    label: 连接 A 的等待队列
    sub: A 的回调挂在这 —— 每个 fd 一份
    detail: |
      ==这张图最关键的一格==。「回调挂在这」的完整意思是：
      **每个登记的 fd，都会在它自己的等待队列上挂一份
      `ep_poll_callback`**。A 有一份，B 也有一份（左边的格子），互不相干。
      挂一次一直在，直到 DEL 或 fd 关闭。
    code: |
      /* 挂载：epoll_ctl(ADD) 时，每个登记的 fd 走一遍
         fs/eventpoll.c · ep_ptable_queue_proc */
      init_waitqueue_func_entry(&pwq->wait, ep_poll_callback); // 回调是谁
      pwq->base = epi;                     // 记住：我为哪个 fd 服务
      add_wait_queue(whead, &pwq->wait);   // 挂到这个 fd 自己的队列上

      /* 触发：数据到的那一刻（同一个函数的另一半）
         fs/eventpoll.c · ep_poll_callback */
      epi = ep_item_from_wait(wait);              // 找回：我是为谁挂的
      list_add_tail(&epi->rdllink, &ep->rdllist); // ① 把它挂进就绪表
      if (waitqueue_active(&ep->wq))
          wake_up(&ep->wq);                       // ② 顺手叫醒 epoll_wait
  wqB:
    label: 连接 B 的等待队列
    sub: B 的那份 —— 此刻还没响
    detail: |
      B 也有一份一模一样的挂载：同一个回调函数、同样记着「我为 B 服务」，
      挂在 B 自己的队列上。
      ==「每一个 fd 都一样吗」的答案：是== —— 每个登记的 fd
      都有属于自己的一份，区别只是有没有被敲响过。
  sockA:
    label: 连接 A · socket
    sub: 这一刻有数据（B 没有）
    detail: |
      数据落进 A 的接收缓冲区，内核沿着中断一路找到这条 socket，
      然后敲它自己的等待队列。敲的是 ==socket 自己的==队列，
      不是 epoll 实例里的什么东西 —— 这就是「回调挂在目标 fd 上」的确切含义。
    code: |
      // net/core/sock.c · 数据到达的那一刻
      void sock_def_readable(struct sock *sk)
      {
          wq = rcu_dereference(sk->sk_wq);
          if (skwq_has_sleeper(wq))
              wake_up_interruptible_sync_poll(&wq->wait, EPOLLIN | ...);
              // ↑ 敲这条 socket 自己的等待队列：
              //   挂在上面的每份 ep_poll_callback 逐个被调用
      }
  nic:
    label: 网卡 · 数据到
    sub: 中断 → 协议栈 → 接收缓冲区
    detail: |
      整条链路的物理起点：网卡收到包，中断，协议栈按四元组找到这条 socket，
      把数据放进它的接收缓冲区，然后才有右边那记 wake_up。
      ==「谁把 fd 放进就绪表」的第一推动力在这里，不在你的循环里==。
  ewq:
    label: 实例的等待队列 ep->wq
    sub: epoll_wait 睡在这里
    detail: |
      ==图里的第二张等待队列==，也是「谁通知 epoll_wait」的答案所在：
      epoll_wait 进来先看一眼就绪表，空的话就睡在这条队列上。
      叫醒它的是 ①里那记 `wake_up(&ep->wq)` ——
      ==发通知的和往就绪表挂东西的，是同一个回调==。
    code: |
      // fs/eventpoll.c · ep_poll（epoll_wait 的内核实现）
      eavail = ep_events_available(ep);         // 先看一眼：就绪表空吗
      while (1) {
          if (eavail)
              return ep_try_send_events(ep, events, maxevents); // 有货 → 拷走
          if (timed_out) return 0;
          __add_wait_queue_exclusive(&ep->wq, &wait);  // 空 → 睡到 ep->wq 上
          schedule_hrtimeout_range(to, slack, HRTIMER_MODE_ABS);
      }
  rdl:
    label: 就绪链表 rdllist
    sub: 只装这一刻真有事的
    detail: |
      回调①把它放进来，epoll_wait 把它拷走。
      ==这张表永远很短==：没有人遍历去找就绪者，
      就绪是「事件经过时顺手挂进来」的。
      拷走之后登记表一个字节都不动 —— LT 模式下没处理完的
      还会被挂回来，那是下一篇的正题。
    code: |
      // fs/eventpoll.c · ep_send_events：把就绪表逐项拷回用户数组
      ep_start_scan(ep, &scan_batch);  // 把 rdllist 整体摘下来
      list_for_each_entry_safe(epi, tmp, &scan_batch, rdllink)
          ep_deliver_event(ep, epi, &pt, &events, &scan_batch); // 逐项拷给用户
anchors:
  - { part: thr, label: "我写的三个调用" }
  - { part: wqA, label: "回调挂在哪" }
  - { part: ewq, label: "谁通知 epoll_wait" }
tours:
  - id: journey
    label: "一条事件的完整旅程"
    steps:
      - { at: [thr, rbr], text: "起点是你写的三个调用。`epoll_ctl` 把 fd 登记进红黑树，==加完一直在== ——「内核那头记着」落到数据结构上就是这棵树。", code: "epi = ep_alloc_epitem(ep, event, tf);\nep_rbtree_insert(ep, epi);" }
      - { at: [rbr, wqA, wqB], text: "登记的同时，每个 fd 都得到==一份属于自己的回调==，挂在它自己的等待队列上 —— A 一份、B 一份，互不相干。", code: "init_waitqueue_func_entry(&pwq->wait, ep_poll_callback);\npwq->base = epi;                        // 记住我为谁服务\nadd_wait_queue(whead, &pwq->wait);      // 挂到它自己的队列上" }
      - { at: [nic], text: "数据到：中断、协议栈、接收缓冲区。==整条链的第一推动力在硬件这一格==，从这一刻起，主动权在内核手里。" }
      - { at: [sockA, wqA], text: "内核找到这条 socket，敲它自己的等待队列 —— 挂在上面的那份回调被调用。", code: "wake_up_interruptible_sync_poll(&wq->wait, EPOLLIN | ...);" }
      - { at: [wqA, rdl], text: "回调做第一件事：==把这个 fd 挂进就绪表==。放进去的动作发生在「数据到的时刻」，不是「你去问的时刻」。", code: "epi = ep_item_from_wait(wait);\nlist_add_tail(&epi->rdllink, &ep->rdllist);" }
      - { at: [wqA, ewq], text: "同一个回调顺手做第二件事：==`wake_up(&ep->wq)`==。==「谁通知 epoll_wait」的答案就是这一行== —— 记账的和敲门的是同一个函数。", code: "if (waitqueue_active(&ep->wq))\n    wake_up(&ep->wq);" }
      - { at: [ewq, rdl], text: "睡在 ep->wq 上的 epoll_wait 醒来，确认就绪表非空，把这一批拷回用户数组。==「取走」是拷贝，登记表不动==。", code: "return ep_try_send_events(ep, events, maxevents);" }
      - { at: [thr], text: "你的循环拿到 n 个就绪事件，挨个处理。==从睡到醒，你一行代码都没跑== —— 收包、分发、记账、叫醒，全是内核在干活。" }
  - id: per-fd
    label: "回调挂在哪：每个 fd 一份"
    steps:
      - { at: [rbr], text: "epoll_ctl 怎么知道该把回调挂到哪？==它不猜== —— 调这个 fd 自己的 poll 方法，驱动按 `poll_wait` 协议把自己的等待队列交出来。select / poll 挂 pollwake 走的也是这扇门。", code: "init_poll_funcptr(&epq.pt, ep_ptable_queue_proc);\nrevents = ep_item_poll(epi, &epq.pt, 1);  // ← fd 自己的 poll 方法" }
      - { at: [wqA], text: "A 的那份：一个回调函数、一句「我为谁服务」、一次 `add_wait_queue`。==挂在 A 自己的队列上，不是挂在 epoll 实例里==。", code: "init_waitqueue_func_entry(&pwq->wait, ep_poll_callback);\npwq->base = epi;\nadd_wait_queue(whead, &pwq->wait);" }
      - { at: [wqB], text: "B 的那份一模一样，挂在 B 自己的队列上，此刻还没响过。==所以「回调挂在这」不是一个格子，是每个登记的 fd 各自的一份==" }
  - id: wake
    label: "epoll_wait 什么时候拿、谁通知它"
    steps:
      - { at: [ewq], text: "epoll_wait 进来==先查再睡==：就绪表非空就直接拷走返回，一行都不多跑；空了才睡到 ep->wq 上。", code: "eavail = ep_events_available(ep);\nif (eavail) return ep_try_send_events(...);\n__add_wait_queue_exclusive(&ep->wq, &wait);  // 空 → 睡" }
      - { at: [wqA], text: "通知者是它：数据到 → 敲 socket 队列 → 回调被调 → 回调顺手 `wake_up(&ep->wq)`。==通知不需要任何新机制，就是挂就绪表的那个回调多说了一句话==" }
      - { at: [rdl], text: "醒来后从就绪表把这一批拷走。==取走的是拷贝== —— 登记还在、LT 模式下没处理完的还会挂回来。", code: "ep_start_scan(ep, &scan_batch);\nlist_for_each_entry_safe(epi, tmp, &scan_batch, rdllink)\n    ep_deliver_event(ep, epi, &pt, &events, &scan_batch);" }
      - { at: [thr], text: "你的线程拿到 n 个事件，继续跑 handle。==整个「等待」期间它睡在 ep->wq 上，不占 CPU==" }
```

---

## 01 · 三条需求，三样东西

《轮询》把题目列了出来，《select / poll》还了第 ③ 条。剩下的，在 epoll 这里一一对上：

```compare
first: 需求
head: [谁去满足它, 它做到了什么]
rows:
  - ① 内核得记住我关心哪些 fd: ["`epoll_create` + `epoll_ctl`", "在内核里**建一个对象**，把 fd 登记进去。登记一次，长期有效"]
  - ② 内核得只把就绪的还给我: ["`epoll_wait`", "它返回的是**就绪的那几个本身**，不是「整份名单 + 几个标记位」"]
  - ③ 等待不能再占用执行资源: ["①② 合起来", "名单存在内核里、谁就绪内核自己知道，线程才能真的睡到有事为止"]
```

==第三条是目的，前两条是手段。== 这个顺序别搞反，反过来就会把 epoll 记成三个 API。

开头那张整体图就是三条需求的运行时样子：①是红黑树，②是就绪链表加拷回，③是 `epoll_wait` 睡在 `ep->wq` 上。上一篇 `select` / `poll` 的「拉」走到哪一步都全是内核在挨个查 —— 那张图和这张图对着看，分水岭会自己浮出来。

---

## 02 · 内核里它就是两张表

这是 epoll 的全部。左边的表登记，右边的表就绪：

```demo
widget: epoll-tables
title: epoll 的全部就是这两张表
config:
  conn: { min: 8, max: 40, step: 4, def: 24 }
```

三个要点，都能从上面点出来：

```cards
cols: 1
items:
  - title: "登记表（interest list）：`epoll_ctl` 往里加，一直在"
    tone: blue
    body: |
      它对应轮询篇的第一条需求。==因为**内核那头一直记着**，
      所以调用一次之后你不需要再交代一遍==，这正是 `select` / `poll` 做不到的事。
  - title: "就绪表（ready list）：谁有数据了，谁自己挂进来"
    tone: green
    body: |
      它不是内核遍历找出来的，是**回调放进去的**。这一条是下一篇的主线，
      这里先记住：==放进去这个动作发生在「数据到的那一刻」，不是「你问的那一刻」。==
  - title: "`epoll_wait` 只是把就绪表拿走"
    tone: violet
    body: |
      它不清空登记表，上面点完 `epoll_wait` 之后格子会回到左边，
      因为**登记还在，只是不再"就绪"了**。这两张表的职责完全不同，别混。
```

!!注意右边那张表永远是短的。!! 不是「短一点」，是**量级上的不同**，它只装这一刻真有事的那几个。

---

## 03 · 分水岭：谁把 fd 放进就绪表

前面所有差别到这里收束成一件事。

```compare
first: 谁主动
head: [什么时候干活, 成本跟什么成正比, 一句话]
rows:
  - "`select` / `poll` · 拉": ["**你调用**的那一刻，内核才挨个去查", { text: "你登记了多少条", tone: red }, "问了才知道"]
  - "epoll · 推": ["**数据到**的那一刻，内核顺手把它挂进就绪表", { text: "这一刻真有几个就绪", tone: green }, "谁好了谁来排队"]
```

==这是整棵树上最该记住的一句：**从「我去查」变成「你来告诉我」。**==

一旦换过来，两件事同时变好：

- 你不用每轮重交名单了（内核记着）
- 内核不用每轮遍历全部了（只有真就绪的才发生那次「挂进链表」）

上一版那个「白问」也没了：**没人再问，就没人白问。**

```callout
tone: violet
icon: 🔁
text: |
  「推」是怎么实现的，看开头那张图的 ⑥ 两步就够：

  每个 socket 上本来就挂着一个**等待队列**。`epoll_ctl` 登记的时候，
  经由这个 fd 自己的 poll 方法，把 `ep_poll_callback` 挂到
  **它自己的等待队列**上 —— 每个登记的 fd 一份；
  数据一来，内核敲这个队列，回调被调用，它做两件事：
  把对应的 epitem 挂进就绪表（回调①），顺手 `wake_up(&ep->wq)`
  叫醒正在 `epoll_wait` 的线程（回调②）。

  所以「挂进就绪表」不是 epoll 主动做的，是**事件经过时顺手做的**。
  epoll 只是提供了两张表、一份常驻回调，和一条能让线程睡着睡醒的队列。
```

顺带把「内核在整条链上干了什么」一次说清，因为这事散在图的每个格子里：==收包中断、按四元组找到 socket、敲它自己的等待队列、跑回调记账、睡和醒你的线程、把就绪事件拷回你的数组== —— 六件事全部在内核。你的代码只出现在两端：登记，和收货。

---

## 04 · 复杂度要怎么说才诚实

几乎每篇讲 epoll 的文章都会写「O(1)」。这句话的方向对，但**说满了**。

```compare
first: 说法
head: [对不对, 该怎么讲]
rows:
  - "epoll 是 O(1)": [{ text: "不严谨", tone: red }, "登记要走红黑树、回调要加锁、事件要拷贝到用户态，这些都有成本"]
  - "epoll 不随监听的 fd 总数变差": [{ text: "准", tone: green }, "==这才是它和 select/poll 的真正分野==，那两位的成本必然和登记数成正比"]
```

对比着看就很清楚：

| | 成本跟什么走 |
|---|---|
| `select` / `poll` | **登记了多少条**，每次都全拷、全遍历 |
| `epoll` | **这一刻真有几个就绪**，返回量只跟这个走 |

==记住的是这个**函数关系**，不是那个「1」。== 面试答「不随 fd 总数增长」比答「O(1)」准确，而且显得你真读过实现。

---

## 05 · 三个调用分别管什么

```cards
cols: 1
items:
  - title: "`epoll_create()`，建那个内核对象"
    tone: blue
    body: |
      它返回的**也是一个 fd**。epoll 实例本身就是一个文件描述符，
      所以能进 `select`、能被子进程继承、能被 `close`。
      常见误解：以为 epoll 是个「全局的机制」—— 它是**你建出来的一个对象**，一个进程可以有好几个。
  - title: "`epoll_ctl()`，改登记表"
    tone: violet
    body: |
      三个动作：`ADD` 加一条、`MOD` 改关注的事件、`DEL` 删一条。
      ==它就是轮询篇那三条需求里第一条的落地==：名单交一次就够了，
      以后要改，改的也是内核里那份，不是重新交一份。
  - title: "`epoll_wait()`，把就绪表拿走"
    tone: green
    body: |
      它一次返回**一批**就绪事件（一个数组），不是一个。
      常见误解：以为它像 `read` 一样「取走」就绪状态。
      实际上**取走之后那个 fd 还在登记表里**，而且下一篇会看到：
      LT 模式下它可能马上又被挂回就绪表。
```

---

## 06 · 到这里，还剩一个词没交代

上面每一句都用了「**就绪**」：就绪表、就绪事件、这个 fd 就绪了。

但你有没有想过：==epoll 说「可读」的时候，**数据已经在你手里了吗**？==

没有。那是下一篇要抠开的那个词，而 `epoll` 最有名的两个触发模式（LT / ET），争的也正是这件事。

---

```quiz
- q: epoll 的三个系统调用分别对应轮询篇留下的哪条需求？
  a: |
    epoll_create + epoll_ctl 对应「内核得记住我关心哪些 fd」——
    在内核里建一个对象，把 fd 登记进去（红黑树），登记一次长期有效。
    epoll_wait 对应「内核得只把就绪的还给我」——返回的是就绪的那几个本身。
    第三条「等待不该占用执行资源」是目的：线程睡在 ep->wq 上，
    事件之间不占 CPU。
- q: 「拉」和「推」的区别，一句话怎么说？
  a: |
    select/poll 是拉：你调用的那一刻内核才挨个去查，成本跟「登记了多少条」成正比。
    epoll 是推：数据到的那一刻内核顺手把它挂进就绪表，
    成本跟「这一刻真有几个就绪」成正比。
    从「我去查」变成「你来告诉我」——白问也没了，因为没人再问。
- q: 「回调挂在目标 fd 的等待队列上」——每个 fd 挂几份？挂在哪里？怎么知道队列在哪？
  a: |
    每个登记的 fd 一份。epoll_ctl 登记时先建这个 fd 的 epitem（进红黑树），
    然后调它自己的 poll 方法；驱动按 poll_wait 协议把自己等待队列的头交出来，
    ep_ptable_queue_proc 就把 ep_poll_callback 挂上去（pwq->base = epi，
    记住我为哪个 fd 服务）。挂一次一直在，直到 DEL 或 fd 关闭。
    A 的挂在 A 的队列上，B 的挂在 B 的队列上，互不相干。
- q: epoll_wait 是什么时候拿走就绪列表的？是谁通知它的？
  a: |
    先查再睡：epoll_wait 进来先看 ep_events_available ——
    就绪表非空就直接 ep_try_send_events 拷回用户数组返回；
    空才把自己挂到 epoll 实例自己的等待队列 ep->wq 上睡觉。
    通知者是 ep_poll_callback：它往就绪表挂完 epitem 之后顺手
    wake_up(&ep->wq)。记账的和敲门的是同一个函数，
    所以不需要任何额外的通知机制。
- q: 为什么说「epoll 是 O(1)」不够严谨？该怎么讲？
  a: |
    因为登记要走红黑树、回调要加锁、事件要拷贝到用户态，这些都有成本。
    准确的说法是：epoll 的成本**不随监听的 fd 总数变差**，
    而 select/poll 的成本必然和登记数成正比。
    记住这个函数关系，而不是那个「1」。
```
