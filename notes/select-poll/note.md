```arch
svg: sp-journey
caption: 上面一排是睡之前的路：名单整份进来，挨个问、挨个挂。下面一排是醒来之后的路：重查、拆干净、整份发回。**虚线那一根是这一篇的重点：下一轮调用，整条链从头再来** —— 内核什么都没记住。
parts:
  usrin:
    label: 整份名单
    sub: select 是位图，poll 是数组
    detail: |
      你关心的 fd 全在里面。==它不是登记在内核里的，是每次调用现场传进去的参数==
      —— 这一句是整篇的根，05 节会回来收它。
      两代名单的形状不同，语义相同：**把「我关心谁」整份交代一遍**。
    code: |
      /* select：名单是一张位图，写死 FD_SETSIZE = 1024 格 */
      fd_set rset;
      FD_ZERO(&rset);
      FD_SET(conn_fd, &rset);        // 一个 fd 占一格

      /* poll：名单是一个数组，没有 1024 的上限 */
      struct pollfd fds[N];
      fds[0] = (struct pollfd){ conn_fd, POLLIN, 0 };
  usrsel:
    label: 你自己再扫返回集
    sub: 返回的是标记，不是就绪者
    detail: |
      两个调用返回的都是「改过标记的名单」：select 改写位图，poll 往每个元素里填 `revents`。
      ==谁就绪还得你自己挨个查== —— 这一步的成本跟名单长度成正比，一个都省不掉。
    code: |
      /* select 返回后：O(maxfd) 挨个查 */
      for (int fd = 0; fd <= maxfd; fd++)
          if (FD_ISSET(fd, &ready)) handle(fd);

      /* poll 返回后：O(nfds) 挨个看 */
      for (int i = 0; i < nfds; i++)
          if (fds[i].revents & POLLIN) handle(fds[i].fd);
  kcopy:
    label: 拷入内核
    sub: 整份 copy_from_user
    detail: |
      每次调用的第一件事：把整份名单从用户态拷进内核。
      select 拷的是三套位图（读 / 写 / 异常），poll 拷的是整个数组。
      ==名单多长，这一下就多贵==。
    code: |
      /* select：三套位图整份拷入（fs/select.c · core_sys_select） */
      get_fd_set(n, inp, fds.in);
      get_fd_set(n, outp, fds.out);
      get_fd_set(n, exp,  fds.ex);

      /* poll：整个 pollfd 数组拷入（fs/select.c · do_sys_poll；
         名单大时分块拷，语义等价于整份 copy_from_user） */
      copy_from_user(walk->entries, ufds, ...);
  kpass1:
    label: 第一遍全扫描
    sub: 挨个调 fd 自己的 poll 方法
    detail: |
      内核替你问，但问的姿势和上一篇你写的循环一样：==名单上每个都问一遍==。
      「问」不是空话 —— 它调每个 fd 自己的 poll 方法，驱动里真有一段代码回答「好了吗」。
    code: |
      /* fs/select.c · do_select 的核心循环（简化） */
      for (;;) {
          for (i = 0; i < n; i++) {                 // 名单上每个 fd
              mask = select_poll_one(i, wait, ...); // ← 里面调它自己的 poll
              if ((mask & POLLIN_SET) && (in & bit)) { res_in |= bit; retval++; }
          }
          if (retval || timed_out) break;           // 有一个就绪 → 不睡了
          poll_schedule_timeout(&table, TASK_INTERRUPTIBLE, to, slack);
      }
  kwq:
    label: 每个 fd 的等待队列
    sub: 问的时候顺手挂上 pollwake
    detail: |
      ==这一格是 select/poll 能「睡」的全部机关==，也是它和上一篇那个
      永不停的圈的真正区别。「问每个 fd」的动作会顺手办一件事：
      把一个叫 `pollwake` 的挂载挂到**这个 fd 自己的等待队列**上。
      挂载走的是 `poll_wait` 这扇门 —— ==内核里所有驱动的 poll 方法都从这扇门
      交出自己的等待队列==，下一篇 epoll 挂回调走的也是同一扇门。
    code: |
      /* include/linux/poll.h：所有驱动的 poll 方法都调它，交出自己的等待队列 */
      static inline void poll_wait(struct file *filp,
                        wait_queue_head_t *wait_address, poll_table *p)
      {
          if (p && p->_qproc)
              p->_qproc(filp, wait_address, p);   // ← 挂载动作
      }

      /* fs/select.c · __pollwait：select/poll 挂上去的东西 */
      init_waitqueue_func_entry(&entry->wait, pollwake); // 「只会敲门的」
      add_wait_queue(wait_address, &entry->wait);        // 挂到这个 fd 的队列
  ksleep:
    label: 线程睡了
    sub: 睡在这些队列上，不再烧 CPU
    detail: |
      全都没好，线程才走到这一步：睡。==这是三条需求里第 ③ 条第一次被满足==
      —— 等待不再占用执行资源。上一篇那个圈是「永不停也永不睡」，
      这里的线程是真的睡着了，CPU 转去跑别人。
    code: |
      /* fs/select.c · poll_schedule_timeout */
      set_current_state(TASK_INTERRUPTIBLE);   // 标记成可被唤醒的睡眠
      schedule_hrtimeout_range(expires, slack, HRTIMER_MODE_ABS);
      // 醒来的两种方式：被某个 pollwake 敲醒，或者超时
  nic:
    label: 网卡 · 数据到
    sub: 中断 → 协议栈 → wake_up
    detail: |
      数据落在某条连接的接收缓冲区里，内核沿着中断一路走到这条 socket，
      然后敲它自己的等待队列。==挂在上面的那些 pollwake 逐个被调用==
      —— 敲门声就是这么传到睡着的人耳朵里的。
    code: |
      /* net/core/sock.c · 数据到达的那一刻 */
      void sock_def_readable(struct sock *sk)
      {
          wq = rcu_dereference(sk->sk_wq);
          if (skwq_has_sleeper(wq))
              wake_up_interruptible_sync_poll(&wq->wait, EPOLLIN | ...);
              // ↑ 敲这条 socket 的等待队列，挂着的 pollwake 被调用
      }
  kpass2:
    label: 第二遍全扫描
    sub: 醒了重新挨个查：找出是谁醒了
    detail: |
      pollwake 是「只会敲门的」：它的全部工作就是把睡着的线程叫醒，
      ==不带任何「是谁把我叫醒」的记录==。所以醒来之后，
      内核只能把名单从头再扫一遍，用第二遍扫描把就绪的那几个找出来。
    code: |
      /* fs/select.c · pollwake 的全部工作 */
      static int pollwake(wait_queue_entry_t *wait, ...)
      {
          entry = container_of(wait, struct poll_table_entry, wait);
          if (key && !(key_to_poll(key) & entry->key)) return 0;
          return __pollwake(wait, mode, sync, key);   // → 只叫醒，不记账
      }
      // 所以醒来后 for(;;) 从头再来：挨个 f_op->poll 重问一遍
  kfree:
    label: 全部拆掉 · poll_freewait
    sub: 挂载拆除 —— 返回后内核立刻忘光
    detail: |
      找完就绪者，返回之前把这一轮挂在所有等待队列上的 pollwake 全部拆掉。
      名单本来就是调用者传进来的临时拷贝。==这一格就是「内核失忆」的现场==
      —— 下一轮调用从「整份拷入」重新开始。
    code: |
      /* fs/select.c · do_select 返回前 */
      poll_freewait(&table);
      // 这一轮挂的所有 pollwake 全部拆除；
      // 名单是调用者传进来的临时拷贝，返回即作废。
  kcopyout:
    label: 结果整份拷出
    sub: select 改位图，poll 填 revents
    detail: |
      内核把「谁就绪」写回名单的标记位，整份拷回用户态。
      ==你关心的是 2 个，发回来的是整份== —— select 发整张位图，poll 发整个数组。
    code: |
      /* select：结果位图整份拷回用户态（fs/select.c · core_sys_select） */
      set_fd_set(n, inp, fds.res_in);
      set_fd_set(n, outp, fds.res_out);

      /* poll：内核填好每个元素的 revents，整份拷回 */
anchors:
  - { part: usrin, label: "名单" }
  - { part: kwq, label: "等待队列" }
  - { part: ksleep, label: "线程睡了" }
tours:
  - id: lifecycle
    label: "一次调用的完整生命周期"
    steps:
      - { at: [usrin, kcopy], text: "起点是你手里的名单。==它不在内核里，是每次调用现场传的参数== —— 整份拷入，这是这一次调用的第一笔开销。", code: "/* 名单不在内核里，是每次调用的参数 */\nint n = select(maxfd + 1, &ready, NULL, NULL, NULL);" }
      - { at: [kpass1], text: "内核替你问：名单上每个 fd 都调一遍它自己的 poll 方法。==「问」的姿势和上一篇你自己写的循环一样==，一个都跳不掉。", code: "mask = select_poll_one(i, wait, ...);   // 里面调 fd 自己的 poll 方法" }
      - { at: [kwq], text: "问的同时顺手挂载：每个被问的 fd，它的等待队列上都多了一个 `pollwake`。==能睡，靠的就是这一步== —— 这些队列成了醒来的门铃。", code: "init_waitqueue_func_entry(&entry->wait, pollwake);\nadd_wait_queue(wait_address, &entry->wait);" }
      - { at: [ksleep], text: "全都没好，才走到这一步：睡。==三条需求里的第 ③ 条在这里第一次被满足==，等待终于不再占用执行资源。", code: "set_current_state(TASK_INTERRUPTIBLE);\nschedule_hrtimeout_range(expires, slack, HRTIMER_MODE_ABS);" }
      - { at: [nic], text: "数据到：中断沿着协议栈走到那条 socket，敲它自己的等待队列，==挂着的 pollwake 被调用==。", code: "/* 中断 → 协议栈 → 找到 socket → 敲它的等待队列 */\nwake_up_interruptible_sync_poll(&wq->wait, EPOLLIN | ...);" }
      - { at: [ksleep, kpass2], text: "pollwake 只会敲门，==不带「是谁敲的」的记录==。所以醒来之后内核把名单重扫一遍，用第二遍全扫描找出就绪者。", code: "/* pollwake：叫醒线程，仅此而已 */\nreturn __pollwake(wait, mode, sync, key);" }
      - { at: [kfree], text: "找到就绪者，返回之前先拆干净：这一轮挂的所有 pollwake 全部拆除。==「内核失忆」就发生在这一格==", code: "poll_freewait(&table);   // 这一轮挂的 pollwake 全部拆除" }
      - { at: [kcopyout, usrsel], text: "整份发回来。你拿着改过标记的名单，==自己挨个查谁就绪== —— 你关心 2 个，查的是 maxfd 个。", code: "set_fd_set(n, inp, fds.res_in);   // 结果整份拷回\nif (FD_ISSET(fd, &ready)) ...     // 你再挨个查谁就绪" }
      - { at: [usrin, kcopy], text: "处理完，下一轮调用：名单重新拷入、重新全扫、重新挂、重新拆。==每一轮都是完整的一生，内核两轮之间什么都不记得==。" }
  - id: three-needs
    label: "三条需求对一遍：治了哪条"
    steps:
      - { at: [ksleep], text: "==③ 治了==。线程真的睡了：睡在挂满 pollwake 的等待队列上，事件之间 CPU 跑别人。上一篇「永不停也永不睡」的圈到这一篇退役。" }
      - { at: [usrin, kcopy], text: "==① 没治==。名单是你每次现场交的参数，整份拷入整份拷出 —— 内核不记得你上一次交代过什么。" }
      - { at: [kpass1, kpass2, usrsel], text: "==② 没治==。内核还是得把名单整个扫一遍（睡了就再扫一遍），返回的还是标记位；==你关心的那几个和名单长度无关，付的钱和名单长度成正比==。" }
      - { at: [kfree], text: "病根就是这一格：返回时全拆干净。==要治它，得让内核那头记着== —— 记名单、记就绪、把挂载变成常驻。这是下一篇 epoll 的全部题目。" }
```

---

## 01 · 轮询篇留下的三条，现在开始还

上一篇结尾列了三条需求：①内核得记住我关心哪些 fd；②内核得只把就绪的还给我；③等待不能再占用执行资源。

`select` 和 `poll` 是第一版答案，方向一句话就能说清：==把你上一篇亲手写的那个 for 循环，搬进内核==。

```compare
first: 需求
head: [select / poll 给的答案, 满足了没有]
rows:
  - "① 内核记住我关心哪些 fd": ["没记住。名单是你每次调用的参数，用完就忘", { text: "没治", tone: red }]
  - "② 只把就绪的还给我": ["返回的是改过标记的整份名单，谁就绪还得你自己查", { text: "没治", tone: red }]
  - "③ 等待不占用执行资源": ["线程真的睡了，睡在每个 fd 的等待队列上", { text: "==治了==", tone: green }]
```

治了一条，留着两条。怎么治的、为什么剩下两条治不了，是这一篇的正文。

---

## 02 · 两个调用长什么样

先看代码，因为这两个调用的差别小到可以用一句话说完。

```text
// select：名单是位图
fd_set rset;
FD_ZERO(&rset);
FD_SET(listen_fd, &rset);
FD_SET(conn_fd, &rset);

for (;;) {
    fd_set ready = rset;                 // select 会改写位图，每轮从备份复制
    int n = select(maxfd + 1, &ready, NULL, NULL, NULL);
    for (int fd = 0; fd <= maxfd; fd++)
        if (FD_ISSET(fd, &ready))        // 标记位要自己数
            handle(fd);
}

// poll：名单是数组
struct pollfd fds[N];
fds[0] = (struct pollfd){ listen_fd, POLLIN, 0 };
fds[1] = (struct pollfd){ conn_fd,  POLLIN, 0 };
int nfds = 2;

for (;;) {
    int n = poll(fds, nfds, -1);
    for (int i = 0; i < nfds; i++)
        if (fds[i].revents & POLLIN)     // revents 内核填，你挨个看
            handle(fds[i].fd);
}
```

```compare
first: 
head: [select, poll]
rows:
  - 名单的形状: ["位图，`FD_SETSIZE` = 1024 格", "数组，没有 1024 这个上限"]
  - 返回之后: ["位图被改写，每轮要从备份复制一份", "每个元素的 `revents` 被内核填好"]
  - 上限: ["1024", "只受内存和进程 fd 数限制"]
```

形状的差别就这些。==语义两个完全一样：整份名单交进去，改过标记的名单发回来==。上面整体图里的每一步，两个调用走的是同一条路。

---

## 03 · 一次调用，从头走到尾

开头那张整体图是一条完整的链，导览「一次调用的完整生命周期」会带着代码走一遍。这里只把三件最容易被略过的事说开：

**「睡」是怎么实现的。** 上一篇的轮询圈永不停也永不睡，因为用户态的代码挂不到任何队列上。进了内核就不一样了：==问每个 fd 的时候，内核顺手把一个 `pollwake` 挂到这个 fd 自己的等待队列上==（走的是 `poll_wait` 这扇门，所有驱动的 poll 方法都会从这扇门交出自己的队列）。全都没好，线程就睡；任何一个 fd 来了数据，中断敲它的队列，挂着的 `pollwake` 把线程叫醒。上一篇已经见过等待队列了 —— 阻塞 `read` 把线程挂上去的，就是这同一种东西。

**为什么醒了还要再扫一遍。** `pollwake` 只做一件事：叫醒线程。它不记「是谁敲的我」。==所以要找出就绪的那几个，只能把名单从头再问一遍==。这就是图上两排「全扫描」的来历：第一遍在睡之前，第二遍在醒之后。

**「白问」去哪了。** 没消失。以前每次白问是一次系统调用；现在一整轮白问被合并进一次系统调用里，在内核里发生。==每轮的成本变成：1 次系统调用 + 一遍 O(名单长度) 的内核扫描（睡一觉就再来一遍）+ 名单进、出各一次整份拷贝==。

---

## 04 · 治好的那一条：线程终于能睡了

把两个世界放在 CPU 上看：

```compare
first: 
head: [上一篇 · 用户态轮询, 这一篇 · select / poll]
rows:
  - 没事件的时候: ["线程在跑：accept、read、EAGAIN、再问", "==线程在睡==，CPU 跑别的进程"]
  - 一轮的成本: ["n 次 read 系统调用，每次都可能白问", "1 次系统调用；名单在里头扫一遍（睡了就再加一遍）"]
  - 等待占用的执行资源: ["一个从头到尾不睡的线程", "==零== —— 睡着的线程不占 CPU"]
```

第 ③ 条需求「等待不能再占用执行资源」，到这里是真的成立了。上一篇说「问得太密 CPU 烧满、问得太疏延迟上去」，那个两难也松了：==频率这件事交给了内核== —— 有事它敲你，没事它让你睡。

---

## 05 · 没治的两条：全扫描没少，名单照样重交

睡是睡了，账还是那笔账。

你关心 2 条连接，名单上有 500 条。每次调用：500 条全拷进内核，内核挨个问（没问到就睡，醒来再问一遍），整份名单改好标记再拷回来，你再把 500 条挨个数一遍找出那 2 个。==每一项成本都跟名单长度成正比，跟「这次真有几条就绪」无关==。

病根在哪，上一篇 §06 已经点过一次：**内核不记得你上次关心谁**。`select` 和 `poll` 的内核实现是无状态的，像个每次都要重新填表的窗口 —— 你交一份表，它办完把表还给你，下一次来它完全不认识你。整体图上那根虚线就是这件事：每一轮调用都是完整的一生，两轮之间内核干干净净。

```callout
tone: violet
icon: 💡
text: |
  把三条需求摆在一起看，epoll 要做的事就剩一件了：

  让内核那头「记着」。记名单（你就不用每次重交），
  记就绪（它就不用再把整份名单扫一遍），
  把「问的时候临时挂、返回就拆」的 pollwake，
  换成「登记一次、长期有效」的常驻回调。

  ==下一篇的「两张表 + 回调」，就是对着这三句写的。==
```

---

## 06 · 同一扇门，不同的挂法

这一篇和下一篇共用一个机关，值得单独钉住：**`poll_wait` 这扇门**。内核里所有驱动的 poll 方法都会调它，把自己的等待队列交出来；谁想「等这个 fd」，就从这扇门把东西挂上去。

```compare
first: 谁从门里进来
head: [挂的是什么, 待多久, 敲门之后]
rows:
  - "`select` / `poll`": ["`pollwake`", "==临时==：问的时候挂，返回就拆", "只叫醒线程，谁就绪靠重扫"]
  - "epoll": ["`ep_poll_callback`", "==常驻==：`epoll_ctl` 挂一次，一直在", "敲门 + 记账：把 fd 挂进内核的就绪表"]
```

`select` / `poll` 每次调用重挂一遍、用完全拆，所以内核什么都记不住。epoll 把同一扇门上的挂载变成常驻的，顺手让它多干一件事（记账），「失忆」才被治好。下一篇整体图里「连接 A / B 的等待队列」那两格，挂的就是这个常驻回调。

---

```quiz
- q: select 和 poll 的差别是什么？哪些东西没变？
  a: |
    差别只在名单的形状：select 是位图、被 FD_SETSIZE 卡在 1024，
    poll 是数组、没有这个上限；另外 select 会改写位图（要备份），
    poll 是内核往每个元素里填 revents。
    没变的：整份名单交进去、改过标记的整份发回来、
    内核每轮把名单全扫两遍 —— 语义和成本结构完全一样。
- q: select 睡觉的机制是什么？和上一篇「永不停的圈」差在哪？
  a: |
    问每个 fd 的时候，内核走 poll_wait 这扇门，把 pollwake
    挂到那个 fd 自己的等待队列上；全都没好，线程就睡
    （TASK_INTERRUPTIBLE）。数据到 → 中断 → 敲 socket 的等待队列 →
    pollwake 把线程叫醒。上一篇的圈是用户态代码，挂不上任何队列，
    只能一直问；进了内核才睡得着。
- q: 为什么醒来之后内核还要把名单再扫一遍？
  a: |
    因为 pollwake 只会敲门，不记「是谁敲的我」。唤醒路径上没有任何
    「哪个 fd 就绪了」的记录，所以只能从头把名单重问一遍
    （第二遍全扫描）找出就绪者。epoll 治的就是这一点：
    它的回调敲门时顺手把 fd 挂进就绪表，醒来直接拿。
- q: 三条需求，select / poll 治了哪条？没治的病根是什么？
  a: |
    治了第 ③ 条：线程真的睡了，等待不再占用执行资源。
    第 ① 条没治（名单每次现场重交），第 ② 条没治（返回标记位，
    内核两遍全扫）。病根是内核失忆：无状态的实现，
    返回时 poll_freewait 拆掉全部挂载，两轮之间什么都没记住。
    要治它就得让内核记着 —— 这是 epoll 的题目。
```
