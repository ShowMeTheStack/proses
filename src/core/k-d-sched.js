// The simulated kernel, part four: the scheduler hook, stepping, time, and what a model checker needs.
// The scheduler runs threads. One step runs one thread for one statement (or up to its next system call); a
// signal due to it is delivered first; init and the shell step by reaping. Who runs next is the policy's choice:
//   fifo    the running thread keeps the CPU until it blocks or ends; then the front of the ready queue
//   rr      round robin: each thread runs `quantum` steps, then goes to the back of the queue
//   random  any ready thread, chosen by a generator seeded with `seed` (same seed, same run)
//   hand    opts.choose(choices, sys) picks
// Time: the clock (sys.ms, in milliseconds) moves 1 ms a step (with tick: false, not at all); when nothing can run
// it jumps to the next wake-up or alarm. With sleep: 'free' a sleep only yields, and each pending alarm is a choice of its own
// ('a' + pid), so a model checker can fire it at any moment.
//   sys.choices() -> [tid | 'a' + pid]      sys.step(choice) -> [events]      sys.pick() -> a choice | null
//   sys.status() -> 'running' | 'done' | 'deadlock' | 'input' (blocked on the terminal)
//   sys.footprint(choice) -> {r: [..], w: [..]}  what the step reads and writes: 'out', 'pid', 'proc:N', 'sig:N',
//     'of:N', 'pipe:N', 'ino:N', 'fs', 'tty', 'thr:N', 'mutex:..', 'cond:..', 'sem:..', 'mem:N:addr' (a word of
//     a process's memory outside the thread's own stack, when the process has several threads), 'sys' (any call that is not purely local)
//   sys.advance() -> bool   sys.run(max) -> sys     S.Kern.run(src, opts) -> sys (compile and run to the end)
//   opts.granularity: 'statement' (the default) or 'machine': a thread of a process with several threads stops
//   after each load from and store to shared memory too (count++ is a load, an add and a store), for the race
//   views; such a step's event carries mstep {what, addr, value}
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;

  proto.touch = function (res, rw) { if (this.fp) (rw === 'r' ? this.fp.r : this.fp.w).add(res); };

  // Which memory a step touches, for the footprint of a thread in a process with several threads: the machine
  // reports every access (S.CLang.watch) while a footprint is being taken; what lies outside the thread's own
  // stack is shared.
  /** run fn while recording t's memory accesses outside its own stack as touches of its process's memory */
  proto.watchMem = function (t, p, fn) {
    if (!this.fp || this.threads.filter((o) => o.pid === p.pid && o.state !== 'done').length < 2) return fn();
    const C = S.CLang, lo = t.vm.stackLo, hi = t.vm.stackHi, prev = C.watch;
    C.watch = (a, n, rw) => { if (a < lo || a >= hi) this.touch('mem:' + p.pid + ':' + (a - (a % 4)), rw); };
    try { return fn(); } finally { C.watch = prev; }
  };
  proto.random = function () {
    let s = (this.rng = (this.rng + 0x6D2B79F5) >>> 0);
    s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
  proto.choices = function () {
    const out = this.runnable().map((t) => t.tid).sort((a, b) => a - b);
    if (this.o.sleep === 'free') for (const p of this.procs) if (p.alarmAt !== null && p.state !== 'zombie' && p.state !== 'reaped') out.push('a' + p.pid);
    return out;
  };
  proto.pick = function () {
    const all = this.choices();
    if (!all.length) return null;
    const tids = all.filter((c) => typeof c === 'number'), cur = this.cur && tids.includes(this.cur) ? this.cur : null;
    switch (this.o.policy) {
      case 'hand': { const c = this.o.choose(all, this); if (!all.includes(c)) throw new Error('the scheduler hook chose ' + c + ', which is not ready'); return c; }
      case 'random': return all[Math.floor(this.random() * all.length)];
      case 'rr': if (cur && this.slice < this.o.quantum) return cur; break;
      default: if (cur) return cur;
    }
    const q = this.queue.filter((tid) => tids.includes(tid) && tid !== cur);
    return q.length ? q[0] : cur || all[0];
  };

  proto.step = function (choice) {
    const C = S.CLang, from = this.trace.length;
    if (typeof choice === 'string') {
      const p = this.proc(+choice.slice(1));
      this.t++;
      p.alarmAt = null;
      this.event('alarm-fire', p, {}, `${this.who(p)}'s alarm goes off: the kernel sends it SIGALRM.`);
      this.post(p, K.SIG.SIGALRM, 0);
      this.after(null);
      return this.trace.slice(from);
    }
    const t = this.thread(choice);
    if (!t || (t.state !== 'ready' && t.state !== 'running')) throw new Error('thread ' + choice + ' is not ready to run');
    if (this.cur !== choice) {
      const was = this.thread(this.cur);
      if (was && was.state === 'running') this.ready(was);
      this.cur = choice; this.slice = 0;
    }
    this.queue = this.queue.filter((q) => q !== choice);
    t.state = 'running'; this.slice++; this.t++; if (this.o.tick !== false) this.ms++;
    const p = this.proc(t.pid);
    this.procState(p);
    if (p.role === 'init' || p.role === 'shell') { this.stepReaper(t); this.after(p); return this.trace.slice(from); }
    this.privatize(p); p.memKey = null;
    // a step of a process with a handler reads its signal state: a kill may land before or after it
    if (Object.values(p.sig.handlers).some((h) => h && h.fn) || p.sig.pending) this.touch('sig:' + p.pid, 'r');
    const d = this.deliver(t);
    if (d && d !== 'handler') { this.after(p); return this.trace.slice(from); }
    if (t.progress && t.progress.kind === 'flush') { this.resumeFlush(t); this.after(p); return this.trace.slice(from); }
    if (p.image === 'builtin') { p.steps++; this.stepBuiltin(t); this.afterSys(t, p); this.after(p); return this.trace.slice(from); }
    t.vm.key = null;
    const line = C.lineOf(p.prog, t.vm);
    t.line = line; t.stmtPc = t.vm.pc;
    let r;
    try {
      // machine granularity matters where memory is shared: a process with several threads
      const mode = this.o.granularity === 'machine' && this.threadsOf(p).length > 1 ? 'machine' : 'stmt';
      r = this.watchMem(t, p, () => C.run(p.prog, t.vm, (name, args, st, info) => this.sys(t, name, args, info), { mode }));
    } catch (err) {
      if (!(err instanceof C.CError)) throw err;
      const sig = err.signal || K.SIG.SIGSEGV;
      if (!this.failure) this.failure = { pid: p.pid, tid: t.tid, line: err.line, message: err.msg, signal: sig, ub: err.ub || null };
      this.event('error', p, { line: err.line, message: err.msg, tid: t.tid, signal: sig, ub: err.ub || null }, `${this.whoT(t)} fails at line \`${err.line}\`: ${err.msg}.`);
      this.exit(p, 0, false, sig);
      this.after(p);
      return this.trace.slice(from);
    }
    p.steps++; t.steps++;
    const ms = r.why === 'mstep' && r.step, what = ms ? (ms.what === 'load' ? 'loads ' + ms.value + ' from ' + ms.addr : ms.what === 'store' ? 'stores ' + ms.value + ' to ' + ms.addr : ms.what === 'op' ? 'computes ' + ms.value : 'copies memory') : '';
    this.trace.splice(from, 0, Object.assign({ kind: 'step', t: this.t, clock: this.ms / 1000, pid: p.pid, tid: t.tid, line, say: ms ? `${this.whoT(t)}, at line \`${line}\`, ${what}.` : `${this.whoT(t)} runs line \`${line}\`.` }, ms ? { mstep: ms } : {}));
    if (t.vm && p.prog) t.line = C.lineOf(p.prog, t.vm);
    if (r.why === 'sys' || r.why === 'block') this.afterSys(t, p);
    this.after(p);
    return this.trace.slice(from);
  };
  /** after a system call: a signal it raised for its own process is taken at once */
  proto.afterSys = function (t, p) {
    if (p.state !== 'zombie' && p.state !== 'reaped' && t.state === 'running' && (p.sig.pending & ~t.mask)) this.deliver(t);
  };
  /** after every step: copy-on-write, wake whoever can go on now, process states */
  proto.after = function (p) {
    if (p && p.M && p.state !== 'zombie' && p.state !== 'reaped') this.checkCow(p);
    this.recheck();
    for (const p of this.procs) this.procState(p);
  };
  /** blocked threads whose condition now holds become ready */
  proto.recheck = function () {
    for (const t of this.threads) {
      if (t.state !== 'blocked' || !t.wait) continue;
      const p = this.proc(t.pid), w = t.wait;
      let go = false, why = '';
      switch (w.kind) {
        case 'read': { const of = this.ofOf(p, w.fd); go = !of || this.canRead(of); why = 'there is something to read (or end of file) on descriptor ' + w.fd; break; }
        case 'write': case 'flush': { const of = this.ofOf(p, w.fd); go = !of || this.canWrite(of); why = 'there is room to write on descriptor ' + w.fd; break; }
        case 'wait': { const r = this.waitable(p, w.pid, w.opts || 0); go = !!r; if (r && r.child) why = 'its child ' + r.child.pid + (r.report === 'exit' ? ' has exited' : r.report === 'stop' ? ' has stopped' : ' has continued'); break; }
        case 'join': { const o = this.thread(w.tid); go = !o || o.state === 'done'; why = 'thread ' + w.tid + ' has ended'; break; }
        case 'reap': go = this.kids(p).some((k) => k.state === 'zombie'); if (go) { this.ready(t); continue; } break;
      }
      if (!go) continue;
      this.ready(t);
      this.event('wake', p, { why: w.kind === 'wait' ? 'child' : w.kind, tid: t.tid }, `${this.whoT(t)} is woken from ${w.fn || w.kind}: ${why}.`);
    }
  };
  /** time for the due sleepers and alarms; when nothing can run, the clock jumps to the next one */
  proto.fireDue = function () {
    if (this.o.sleep === 'free') return;
    for (const t of this.threads) if (t.state === 'blocked' && t.wakeAt !== null && t.wakeAt <= this.ms) {
      t.wakeAt = null; this.ready(t);
      this.event('wake', this.proc(t.pid), { why: 'sleep', clock: this.ms / 1000, tid: t.tid }, `The clock reaches ${this.ms / 1000} s: ${this.whoT(t)} wakes from sleep and is ready again.`);
    }
    for (const p of this.procs) if (p.alarmAt !== null && p.alarmAt <= this.ms && p.state !== 'zombie' && p.state !== 'reaped') {
      p.alarmAt = null;
      this.event('alarm-fire', p, { clock: this.ms / 1000 }, `The clock reaches ${this.ms / 1000} s: ${this.who(p)}'s alarm goes off, and the kernel sends it SIGALRM.`);
      this.post(p, K.SIG.SIGALRM, 0);
    }
  };
  proto.advance = function () {
    this.fireDue();
    if (this.choices().length) return true;
    if (this.o.sleep === 'free') return false;
    const due = [];
    for (const t of this.threads) if (t.state === 'blocked' && t.wakeAt !== null) due.push(t.wakeAt);
    for (const p of this.procs) if (p.alarmAt !== null && p.state !== 'zombie' && p.state !== 'reaped') due.push(p.alarmAt);
    if (!due.length) return false;
    this.ms = Math.max(this.ms, Math.min(...due));
    this.fireDue();
    this.recheck();
    return this.choices().length > 0 || this.advance();
  };
  proto.status = function () {
    if (this.choices().length) return 'running';
    const left = this.threads.filter((t) => t.state === 'blocked' && this.proc(t.pid).role === 'prog');
    if (!left.length) return this.procs.some((p) => p.role === 'prog' && p.state === 'stopped') ? 'stopped' : 'done';
    if (this.o.sleep !== 'free' && left.some((t) => t.wakeAt !== null)) return 'running';
    if (left.some((t) => t.wait && t.wait.kind === 'read' && this.ofOf(this.proc(t.pid), t.wait.fd) && this.ofOf(this.proc(t.pid), t.wait.fd).kind === 'tty')) return 'input';
    return 'deadlock';
  };
  proto.footprint = function (choice) {
    const c = this.clone();
    c.trace = []; c.o = Object.assign({}, c.o, { snap: false });
    c.fp = { r: new Set(), w: new Set() };
    c.step(choice);
    return { r: [...c.fp.r], w: [...c.fp.w] };
  };
  proto.run = function (max) {
    max = max || 500000;
    for (let n = 0; n < max; n++) {
      if (!this.advance()) { this.done(); return this; }
      this.step(this.pick());
    }
    this.event('limit', null, {}, `The run stops after ${max} steps: the program may loop forever.`);
    return this;
  };
  proto.done = function () {
    if (this.finished) return;
    this.finished = true;
    const left = this.procs.filter((p) => p.role === 'prog' && p.state !== 'reaped');
    this.event('done', null, { left: left.map((p) => p.pid), status: this.status() }, left.length ? `No process can run again; ${left.map((p) => this.who(p) + ' is ' + p.state).join(', ')}.` : 'Every process of the program has exited and been reaped: the run is over.');
  };
  K.run = (src, opts) => new K.System(src, opts).run();
})(globalThis.Proses = globalThis.Proses || {});
