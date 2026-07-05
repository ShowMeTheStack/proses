// The simulated kernel, part one: processes and threads. A System runs one C program as process 100, a child of
// the shell (pid 2, which waits for it) under init (pid 1, which reaps every orphan). A process has a pid, a ppid,
// a process group, its threads, its memory (shared by its threads), its descriptor table, its signal dispositions
// and pending set, its stdio buffer and, once it exits, its status. A thread has its own registers and stack (its
// machine state, c-f-vm.js), its state and its signal mask. The thread is what the scheduler runs; a
// single-threaded process's main thread has the process's pid as its tid.
//   new S.Kern.System(prog | source, opts)   opts:
//     tty: true            stdout is the terminal (line-buffered) | false: a pipe to the outside (fully buffered)
//     input: '', eof: true what the terminal will type, and whether end-of-file follows it (else reads block)
//     sleep: 'timed'       a sleeper wakes when nothing else can run | 'free': sleep only yields (for enumeration)
//     policy: 'fifo' | 'rr' | 'random' | 'hand', seed, quantum, choose(choices, sys) -> choice
//     shell: true, names: {pid: 'A'}, argv: ['a.out', ..], files: {name: text}, programs: {name: source}
//     bufSize 4096 (stdio), pipeCap 4096, pageSize 4096, cow (track shared pages; default true, false with sleep: 'free'), snap: false (each event
//     carries snap, a snapshot of every process, ks, the kernel's tables, and nterm, the count of terminal writes)
//   sys.procs [..], sys.threads [..], sys.proc(pid), sys.thread(tid), sys.trace [{kind, say, t, pid, tid, ...}],
//   sys.term [{pid, fd, text, t}], sys.out (everything written to stdout's outside end)
//   sys.snapshot() -> [{pid, ppid, pgid, state, line, name, role, exitCode, status, buf, why, fds, threads, pages,
//     pending, handlers}]     sys.ksnap() -> {ofiles, pipes, files, frames, tty, objs, clock, table (sys.fsSnapshot(): the
//     File-system lab's shape)}
//   sys.clone(), sys.key(sym) / sys.hash()  - a copy, and a string naming the whole state: with every process's
//     exit code and killing signal (reaped ones too) and sys.failure, the first crash {pid, tid, line, message,
//     signal, ub}, so runs that differ only in how they ended are different states
// States: ready, running, blocked, stopped, zombie (exited, not reaped), reaped; a thread: ready, running,
// blocked, stopped, done.
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  K.INIT = 1; K.SHELL = 2; K.FIRST = 100;
  const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  class System {
    constructor(prog, opts) {
      this.o = Object.assign({ tty: true, input: '', eof: true, sleep: 'timed', policy: 'fifo', seed: 1, quantum: 1, shell: true, bufSize: 4096, pipeCap: 4096, pageSize: 4096, programs: {}, files: {} }, opts || {});
      // page tracking is for pictures: off by default when checking (sleep: 'free')
      if (this.o.cow === undefined) this.o.cow = this.o.sleep !== 'free';
      this.prog = typeof prog === 'string' ? K.compile(prog) : prog;
      this.procs = []; this.threads = []; this.trace = []; this.term = []; this.out = '';
      this.t = 0; this.nextPid = K.FIRST; this.cur = null; this.queue = []; this.slice = 0;
      this.rng = this.o.seed >>> 0;
      this.failure = null; this.ofiles = {}; this.nextOf = 1; this.pipes = {}; this.nextPipe = 1; this.objs = {}; this.frames = {}; this.nextFrame = 1; this.keep = {}; this.ms = 0;
      this.tty = { input: String(this.o.input || ''), eof: this.o.eof !== false, fg: 0 };
      this.fsInit(this.o.files);
      const init = this.add({ pid: K.INIT, ppid: 0, pgid: 1, role: 'init', name: 'init' });
      this.addThread(init, { tid: K.INIT, state: 'blocked', wait: { kind: 'reap' } });
      const top = this.o.shell ? K.SHELL : K.INIT;
      if (this.o.shell) { const sh = this.add({ pid: K.SHELL, ppid: K.INIT, pgid: K.SHELL, role: 'shell', name: 'sh' }); this.addThread(sh, { tid: K.SHELL, state: 'blocked', wait: { kind: 'reap' } }); }
      const pid = this.nextPid++;
      const main = this.add({ pid, ppid: top, pgid: pid, role: 'prog', g: 'm' });
      const tty = this.newOfile({ kind: 'tty', flags: 2 }), out = this.o.tty ? tty : this.newOfile({ kind: 'sink', flags: 1 });
      main.fds = [tty, out, tty];
      for (const id of main.fds) this.ofiles[id].refs++;
      this.tty.fg = pid;
      this.loadImage(main, this.prog, this.o.argv || ['a.out']);
      this.ready(this.thread(pid));
      const t0 = this.thread(pid);
      this.event('start', main, { line: t0.line }, `${this.who(top)} starts the program as process \`${pid}\`, its child; it begins at line \`${t0.line}\`, the start of main.`);
    }
    add(p) {
      const q = copyProc(Object.assign({ pid: 0, ppid: 0, pgid: 0, role: 'prog', g: String(p.pid), forks: 0, fds: [], sig: { handlers: {}, pending: 0 }, buf: '', bufMode: null, inbuf: '', status: null, born: this.t, died: null, reapedBy: null, exitCode: null, termsig: 0, report: null, idle: false, name: null, steps: 0, alarmAt: null, pages: [], tids: [], prog: null, image: p.role === 'prog' ? 'c' : 'kern', state: 'ready', own: true, M: null, memKey: null }, p));
      q.own = true;
      if (this.o.names && this.o.names[q.pid]) q.name = this.o.names[q.pid];
      this.procs.push(q);
      return q;
    }
    addThread(p, t) {
      const q = copyThread(Object.assign({ tid: 0, pid: p.pid, main: !p.tids.length, vm: null, state: 'ready', wait: null, wakeAt: null, retval: 0, mask: 0, pending: 0, ctx: [], progress: null, errno: 0, line: 0, steps: 0, bs: null, joined: false, intr: null, stopWait: null }, t));
      this.threads.push(q);
      p.tids.push(q.tid);
      this.procState(p);
      return q;
    }
    proc(pid) { return this.procs.find((p) => p.pid === pid) || null; }
    thread(tid) { return this.threads.find((t) => t.tid === tid) || null; }
    threadsOf(p) { return this.threads.filter((t) => t.pid === p.pid && t.state !== 'done'); }
    mainThread(p) { return this.threads.find((t) => t.pid === p.pid && t.main) || null; }
    kids(p) { return this.procs.filter((q) => q.ppid === p.pid && q.state !== 'reaped'); }
    /** how a sentence names a process: process 101, or the shell, or init */
    who(pid) { const p = typeof pid === 'number' ? this.proc(pid) : pid; if (!p) return 'process ' + pid; return p.role === 'init' ? 'init (pid 1)' : p.role === 'shell' ? 'the shell (pid ' + p.pid + ')' : 'process `' + p.pid + '`' + (p.name ? ' (' + p.name + ')' : ''); }
    whoT(t) { const p = this.proc(t.pid); return t.main ? this.who(p) : 'thread `' + t.tid + '` of ' + this.who(p); }
    event(kind, p, data, say) {
      // one full stop at the end, even when a sentence ends with a message that brought its own
      if (say) say = (say[0].toUpperCase() + say.slice(1)).replace(/(^|[^.])\.\.(?!\.)/g, '$1.');
      const e = Object.assign({ kind, t: this.t, clock: this.ms / 1000, pid: p ? p.pid : 0, say }, data || {});
      if (this.o.snap) { e.snap = this.snapshot(); e.ks = this.ksnap(); e.nterm = this.term.length; }
      this.trace.push(e);
      return e;
    }
    /** a thread becomes ready: it joins the back of the ready queue */
    ready(t) { t.state = 'ready'; t.wait = null; if (!this.queue.includes(t.tid)) this.queue.push(t.tid); this.procState(this.proc(t.pid)); }
    block(t, wait) { t.state = 'blocked'; t.wait = wait; this.queue = this.queue.filter((q) => q !== t.tid); this.procState(this.proc(t.pid)); }
    /** a process's state is its threads': running if one runs, ready if one could, else stopped or blocked */
    procState(p) {
      if (!p || p.state === 'zombie' || p.state === 'reaped') return;
      const ts = this.threads.filter((t) => t.pid === p.pid && t.state !== 'done');
      p.state = ts.some((t) => t.state === 'running') ? 'running' : ts.some((t) => t.state === 'ready') ? 'ready' : ts.some((t) => t.state === 'stopped') ? 'stopped' : 'blocked';
    }
    runnable() { return this.threads.filter((t) => t.state === 'ready' || t.state === 'running'); }
    /** the states of every process, for a picture */
    snapshot() {
      return this.procs.map((p) => {
        const ts = this.threads.filter((t) => t.pid === p.pid), m = ts.find((t) => t.main) || ts[0];
        const why = (t) => (!t || !t.wait ? '' : t.wait.kind === 'wait' ? t.wait.fn : t.wait.kind === 'reap' ? (p.idle ? 'idle' : '') : t.wait.kind);
        return {
          pid: p.pid, ppid: p.ppid, pgid: p.pgid, state: p.state, line: m ? m.line : 0, name: p.name, role: p.role, image: p.image, exitCode: p.exitCode, status: p.status, buf: p.buf, reapedBy: p.reapedBy, why: why(m),
          fds: p.fds.map((f) => (f === null || f === undefined ? null : f)), pages: p.pages.slice(), pending: p.sig.pending, handlers: Object.assign({}, p.sig.handlers),
          threads: ts.map((t) => ({ tid: t.tid, main: t.main, state: t.state, line: t.line, why: why(t), mask: t.mask })),
        };
      });
    }
    ksnap() {
      return { ofiles: plain(this.ofiles), pipes: plain(this.pipes), files: plain(this.fs), frames: plain(this.frames), tty: plain(this.tty), objs: plain(this.objs), clock: this.ms / 1000, table: this.fsSnapshot() };
    }

    clone() {
      const s = Object.create(System.prototype);
      Object.assign(s, this);
      // memories and machine states are shared until a thread of that process runs again (privatize copies)
      for (const p of this.procs) p.own = false;
      s.procs = this.procs.map(copyProc);
      s.threads = this.threads.map(copyThread);
      s.trace = this.trace.slice(); s.term = this.term.slice(); s.queue = this.queue.slice(); s.keep = Object.assign({}, this.keep);
      const each = (o, f) => { const r = {}; for (const k in o) r[k] = f(o[k]); return r; };
      const sh = (v) => Object.assign({}, v);
      s.ofiles = each(this.ofiles, sh); s.pipes = each(this.pipes, sh); s.frames = each(this.frames, sh); s.tty = sh(this.tty);
      s.fs = { dir: sh(this.fs.dir), inodes: each(this.fs.inodes, sh), nextIno: this.fs.nextIno };
      s.objs = each(this.objs, (o) => Object.assign({}, o, { q: o.q.slice() }));
      return s;
    }
    /** give p its own memory and machine states before one of its threads runs */
    privatize(p) {
      if (p.own) return;
      const C = S.CLang;
      if (p.M) {
        const ts = this.threads.filter((t) => t.pid === p.pid && t.vm), cs = C.cloneProcess(ts.map((t) => t.vm));
        ts.forEach((t, i) => { t.vm = cs[i]; });
        p.M = cs.length ? cs[0].M : C.cloneMem(p.M);
      }
      p.own = true;
    }
    /** the whole state as a string: two states with the same key behave the same from here on. sym: name each
     *  process by its place in the fork tree instead of its pid (states that differ only in which process got
     *  which pid are one) */
    key(sym) {
      const name = (pid) => { if (!sym || pid <= K.SHELL) return pid; const q = this.proc(pid); return q ? q.g : pid; };
      const parts = [this.out, this.o.sleep === 'timed' ? this.ms : '', this.failure ? 'F' + name(this.failure.pid) + ':' + this.failure.signal + ':' + this.failure.line : '', sym ? '' : this.nextPid, this.o.policy === 'fifo' || this.o.policy === 'rr' ? this.queue.join(',') : '', JSON.stringify([this.ofiles, this.pipes, this.fs, this.objs, this.tty.input, this.tty.fg])];
      const list = sym ? this.procs.slice().sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : 0)) : this.procs;
      for (const p of list) {
        // a reaped process keeps how it ended: two runs that differ only in an exit code or a crash differ
        if (p.state === 'reaped') { parts.push(name(p.pid) + 'R' + p.exitCode + ':' + p.termsig); continue; }
        let s = [name(p.pid), name(p.ppid), p.pgid === p.pid ? '=' : name(p.pgid), p.state, p.exitCode, p.alarmAt, JSON.stringify(p.buf), p.bufMode, JSON.stringify(p.inbuf), p.fds.join(','), JSON.stringify(p.sig), p.image].join(':');
        for (const t of this.threads) {
          if (t.pid !== p.pid) continue;
          s += '|' + [t.main ? 'M' : name(t.tid), t.state, t.wakeAt, t.mask, t.pending, t.errno, JSON.stringify(t.wait && Object.assign({}, t.wait, t.wait.pid > K.SHELL ? { pid: name(t.wait.pid) } : {})), JSON.stringify(t.ctx), JSON.stringify(t.progress), JSON.stringify(t.bs), t.retval].join(':');
          if (t.vm && t.state !== 'done') s += ':' + (t.vm.key || (t.vm.key = t.vm.pc + ':' + t.vm.sp + ':' + t.vm.fp + ':' + t.vm.ops.join(',') + ':' + t.vm.frames.map((f) => f.ret + '/' + f.fp).join(',')));
        }
        if (p.M && p.state !== 'zombie') {
          // memory in use (data, heap blocks, live stacks), as the machine hashes it
          if (!p.memKey) { const cs = this.threads.filter((t) => t.pid === p.pid && t.vm && t.state !== 'done').map((t) => t.vm); p.memKey = cs.length ? S.CLang.hash(p.prog, cs).split('|')[0] : ''; }
          s += ':' + p.memKey;
        }
        parts.push(s);
      }
      return parts.join('|');
    }
    hash() { return this.key(false); }
  }
  // copies with one fixed shape (fast to make, fast to read)
  const sh = (v) => v && Object.assign({}, v);
  function copyProc(p) {
    return { pid: p.pid, ppid: p.ppid, pgid: p.pgid, role: p.role, g: p.g, forks: p.forks, fds: p.fds.slice(), sig: { handlers: Object.assign({}, p.sig.handlers), pending: p.sig.pending }, buf: p.buf, bufMode: p.bufMode, inbuf: p.inbuf,
      status: p.status, born: p.born, died: p.died, reapedBy: p.reapedBy, exitCode: p.exitCode, termsig: p.termsig, report: sh(p.report), idle: p.idle, name: p.name, steps: p.steps, alarmAt: p.alarmAt, pages: p.pages.slice(), tids: p.tids.slice(),
      prog: p.prog, image: p.image, state: p.state, own: false, M: p.M, memKey: p.memKey };
  }
  function copyThread(t) {
    return { tid: t.tid, pid: t.pid, main: t.main, vm: t.vm, state: t.state, wait: sh(t.wait), wakeAt: t.wakeAt, retval: t.retval, mask: t.mask, pending: t.pending, ctx: t.ctx.length ? JSON.parse(JSON.stringify(t.ctx)) : [], progress: sh(t.progress), errno: t.errno, line: t.line, steps: t.steps,
      bs: t.bs && JSON.parse(JSON.stringify(t.bs)), joined: t.joined, intr: sh(t.intr), stopWait: sh(t.stopWait) };
  }
  K.System = System;
})(globalThis.Proses = globalThis.Proses || {});
