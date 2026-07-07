// The simulated kernel, part nine: threads and the kernel's synchronisation objects.
//   pthread_create(&t, attr, fn, arg)  a new thread of the caller's process: the same memory, its own stack (a
//       8 KB block of the heap, S.CLang.spawn) and registers, starting in fn(arg); it returns into a trampoline
//       that ends the thread (__thread_exit), as pthread_exit does. A thread's id is drawn from the pid numbers.
//   pthread_join(t, &ret)  waits for t to end and collects its value; pthread_self; pthread_exit(v).
//       When main returns or any thread calls exit, the whole process ends; when the last thread ends by
//       pthread_exit, the process exits with 0.
//   Mutexes, condition variables and semaphores are kernel objects named by the address of the program's
//   variable (sys.objs['mutex:pid:addr'], 'cond:..', 'sem:..'), each with a FIFO wait queue: unlock hands the
//   mutex straight to the first waiter; a condition wait releases the mutex and, when signalled, queues for it
//   again (Mesa semantics); sem_post hands the count to the first waiter.
//   Calls: pthread_create pthread_join pthread_exit pthread_self pthread_mutex_init/lock/trylock/unlock/destroy
//   pthread_cond_init/wait/signal/broadcast/destroy sem_init sem_wait sem_trywait sem_post sem_getvalue
//   sem_destroy sched_yield (sys.sysThread(t, name, args))
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;
  K.TSTACK = 8192;

  proto.threadExit = function (t, v) {
    const p = this.proc(t.pid);
    t.state = 'done'; t.retval = v; t.wait = null;
    this.queue = this.queue.filter((q) => q !== t.tid);
    // its stack was a block of the heap: give it back
    if (!t.main && t.vm && t.vm.stackLo) { try { S.CLang.free(t.vm, t.vm.stackLo, t.line); } catch (e) { /* already gone */ } }
    this.touch('thr:' + t.tid, 'w');
    const live = this.threads.filter((o) => o.pid === p.pid && o.state !== 'done');
    this.event('thread-exit', p, { tid: t.tid, value: v, line: t.line }, `${this.whoT(t)} ends with value \`${v}\`${live.length ? '; a join can collect it' : ''}.`);
    if (!live.length) { this.exit(p, 0, true); return { exit: 0 }; }
    this.procState(p);
    return { exit: v };
  };
  const key = (kind, p, a) => kind + ':' + p.pid + ':' + a;

  proto.sysThread = function (t, nm, a) {
    const C = S.CLang, p = this.proc(t.pid), vm = t.vm, who = this.whoT(t), at = ' at line `' + t.line + '`', E = K.ERR;
    const obj = (kind, addr, init) => { const k = key(kind, p, addr); this.touch(k, 'w'); if (!this.objs[k]) this.objs[k] = Object.assign({ kind, pid: p.pid, addr, q: [] }, init); return this.objs[k]; };
    const handed = (kind, addr) => { if (t.progress && t.progress.kind === kind && t.progress.key === key(kind, p, addr) && t.progress.got) { t.progress = null; return true; } return false; };
    switch (nm) {
      case 'pthread_create': {
        const fn = K.fnName(p.prog, a[2]);
        if (!fn) return this.fail(t, E.EINVAL, `${who} calls pthread_create${at} with something that is not a function`);
        // its own stack, a block of the shared heap, and its own registers, starting in fn(arg)
        const v = C.spawn(p.prog, vm, a[2], a[3], { stack: K.TSTACK }), tid = this.nextPid++;
        p.memKey = null;
        const nt = this.addThread(p, { tid, vm: v, state: 'ready', mask: t.mask, line: C.lineOf(p.prog, v) });
        if (a[0]) C.store(t.vm, a[0], 8, tid, 0);
        this.touch('thr:' + tid, 'w');
        this.ready(nt);
        this.event('thread', p, { tid, fn, arg: a[3], by: t.tid, line: t.line }, `${who} creates thread \`${tid}\`${at}: it shares the process's memory, has its own stack and registers, and starts in ${fn}(${a[3]}).`);
        return { v: 0 };
      }
      case 'pthread_self': return { v: t.tid };
      case 'pthread_exit': return this.threadExit(t, a[0]);
      case '__thread_exit': return this.threadExit(t, a[0]);
      case 'pthread_join': {
        const o = this.thread(a[0]);
        this.touch('thr:' + a[0], 'w');
        if (!o || o.pid !== p.pid || o.joined) return { v: E.ESRCH };
        if (o === t) return { v: E.EDEADLK };
        if (o.state !== 'done') {
          if (!t.wait) this.event('block', p, { why: 'join', on: o.tid, tid: t.tid, line: t.line }, `${who} calls pthread_join(${o.tid})${at}: that thread is still running, so it blocks.`);
          this.block(t, { kind: 'join', tid: o.tid });
          return { block: true };
        }
        o.joined = true;
        if (a[1]) C.store(vm, a[1], 8, o.retval, 0);
        this.event('join', p, { tid: t.tid, joined: o.tid, value: o.retval, line: t.line }, `${who}'s pthread_join${at} collects thread \`${o.tid}\`, which ended with \`${o.retval}\`.`);
        return { v: 0 };
      }
      case 'sched_yield': return { v: 0 };
      case 'pthread_mutex_init': { const m = obj('mutex', a[0], { owner: 0 }); m.owner = 0; m.q = []; return { v: 0 }; }
      case 'pthread_mutex_destroy': case 'pthread_cond_destroy': case 'sem_destroy': delete this.objs[key(nm.startsWith('sem') ? 'sem' : nm.includes('mutex') ? 'mutex' : 'cond', p, a[0])]; return { v: 0 };
      case 'pthread_mutex_trylock': case 'pthread_mutex_lock': {
        const m = obj('mutex', a[0], { owner: 0 });
        if (handed('mutex', a[0])) { this.event('lock', p, { obj: key('mutex', p, a[0]), tid: t.tid, line: t.line }, `${who} now holds the mutex at ${a[0]}${at}: it was handed over on unlock.`); return { v: 0 }; }
        if (!m.owner) { m.owner = t.tid; this.event('lock', p, { obj: key('mutex', p, a[0]), tid: t.tid, line: t.line }, `${who} locks the mutex at ${a[0]}${at}: it was free.`); return { v: 0 }; }
        if (nm === 'pthread_mutex_trylock') return { v: E.EBUSY };
        if (!m.q.includes(t.tid)) m.q.push(t.tid);
        this.block(t, { kind: 'mutex', key: key('mutex', p, a[0]) });
        t.progress = { kind: 'mutex', key: key('mutex', p, a[0]), got: false };
        this.event('block', p, { why: 'mutex', obj: key('mutex', p, a[0]), owner: m.owner, tid: t.tid, line: t.line }, `${who} tries to lock the mutex at ${a[0]}${at}: thread \`${m.owner}\` holds it, so it waits in the mutex's queue.`);
        return { block: true };
      }
      case 'pthread_mutex_unlock': {
        const m = obj('mutex', a[0], { owner: 0 });
        if (m.owner !== t.tid) return { v: E.EPERM };
        this.unlock(m, t, at);
        return { v: 0 };
      }
      case 'pthread_cond_init': obj('cond', a[0], {}); return { v: 0 };
      case 'pthread_cond_wait': {
        const c = obj('cond', a[0], {}), mk = key('mutex', p, a[1]);
        if (t.progress && t.progress.kind === 'mutex' && t.progress.key === mk && t.progress.got && t.progress.cond) { t.progress = null; this.event('wake', p, { why: 'cond', tid: t.tid, line: t.line }, `${who} returns from pthread_cond_wait${at} holding the mutex again.`); return { v: 0 }; }
        const m = this.objs[mk];
        if (!m || m.owner !== t.tid) return { v: E.EPERM };
        c.q.push(t.tid);
        this.unlock(m, t, at, true);
        this.block(t, { kind: 'cond', key: key('cond', p, a[0]), mutex: mk });
        t.progress = { kind: 'mutex', key: mk, got: false, cond: true };
        this.event('block', p, { why: 'cond', obj: key('cond', p, a[0]), tid: t.tid, line: t.line }, `${who} waits on the condition at ${a[0]}${at}: it releases the mutex and sleeps in the condition's queue.`);
        return { block: true };
      }
      case 'pthread_cond_signal': case 'pthread_cond_broadcast': {
        const c = obj('cond', a[0], {}), n = nm === 'pthread_cond_signal' ? Math.min(1, c.q.length) : c.q.length;
        const woke = c.q.splice(0, n);
        for (const tid of woke) {
          const w = this.thread(tid), m = this.objs[w.wait.mutex];
          if (!m.owner) { m.owner = tid; w.progress.got = true; this.ready(w); } else { m.q.push(tid); w.wait = { kind: 'mutex', key: w.wait.mutex }; }
        }
        this.event('signal-cond', p, { obj: key('cond', p, a[0]), woke, tid: t.tid, line: t.line }, woke.length ? `${who} signals the condition at ${a[0]}${at}: thread${woke.length > 1 ? 's' : ''} ${woke.map((x) => '`' + x + '`').join(', ')} leave${woke.length > 1 ? '' : 's'} its queue and queue${woke.length > 1 ? '' : 's'} for the mutex.` : `${who} signals the condition at ${a[0]}${at}: no thread waits, so nothing happens.`);
        return { v: 0 };
      }
      case 'sem_init': { const s = obj('sem', a[0], {}); s.value = a[2]; s.q = []; this.event('sem', p, { obj: key('sem', p, a[0]), value: a[2], tid: t.tid }, `${who} sets up a semaphore at ${a[0]} with value \`${a[2]}\`${at}.`); return { v: 0 }; }
      case 'sem_getvalue': { const s = obj('sem', a[0], { value: 0 }); C.store(vm, a[1], 4, s.value, 1); return { v: 0 }; }
      case 'sem_trywait': case 'sem_wait': {
        const s = obj('sem', a[0], { value: 0 });
        if (handed('sem', a[0])) { this.event('sem', p, { obj: key('sem', p, a[0]), value: s.value, tid: t.tid, line: t.line }, `${who} gets past sem_wait${at}: a post handed it the count.`); return { v: 0 }; }
        if (s.value > 0) { s.value--; this.event('sem', p, { obj: key('sem', p, a[0]), value: s.value, tid: t.tid, line: t.line }, `${who} calls ${nm}${at}: the value was positive, so it goes on and the value drops to \`${s.value}\`.`); return { v: 0 }; }
        if (nm === 'sem_trywait') return this.fail(t, E.EAGAIN, `${who} calls sem_trywait${at}: the value is 0`);
        if (!s.q.includes(t.tid)) s.q.push(t.tid);
        t.progress = { kind: 'sem', key: key('sem', p, a[0]), got: false };
        this.block(t, { kind: 'sem', key: key('sem', p, a[0]) });
        this.event('block', p, { why: 'sem', obj: key('sem', p, a[0]), tid: t.tid, line: t.line }, `${who} calls sem_wait${at}: the value is 0, so it waits in the semaphore's queue.`);
        return { block: true };
      }
      case 'sem_post': {
        const s = obj('sem', a[0], { value: 0 });
        if (s.q.length) {
          const w = this.thread(s.q.shift()); w.progress.got = true; this.ready(w);
          this.event('sem', p, { obj: key('sem', p, a[0]), value: s.value, woke: w.tid, tid: t.tid, line: t.line }, `${who} calls sem_post${at}: thread \`${w.tid}\` was waiting, so it is woken and the value stays \`${s.value}\`.`);
        } else { s.value++; this.event('sem', p, { obj: key('sem', p, a[0]), value: s.value, tid: t.tid, line: t.line }, `${who} calls sem_post${at}: the value rises to \`${s.value}\`.`); }
        return { v: 0 };
      }
    }
    return null;
  };
  /** release mutex m held by t: the first waiter, if any, gets it */
  proto.unlock = function (m, t, at, quiet) {
    const p = this.proc(t.pid), who = this.whoT(t);
    if (m.q.length) {
      const w = this.thread(m.q.shift());
      m.owner = w.tid; w.progress.got = true; this.ready(w);
      if (!quiet) this.event('unlock', p, { obj: 'mutex:' + m.pid + ':' + m.addr, to: w.tid, tid: t.tid, line: t.line }, `${who} unlocks the mutex at ${m.addr}${at}: thread \`${w.tid}\` was first in its queue, so it gets it.`);
    } else {
      m.owner = 0;
      if (!quiet) this.event('unlock', p, { obj: 'mutex:' + m.pid + ':' + m.addr, tid: t.tid, line: t.line }, `${who} unlocks the mutex at ${m.addr}${at}: no one waits, so it is free.`);
    }
  };
})(globalThis.Proses = globalThis.Proses || {});
