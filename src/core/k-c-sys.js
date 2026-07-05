// The simulated kernel, part three: the system-call dispatcher, and the calls about processes.
//   sys.sys(t, name, args) -> what the machine expects: {v}, {v, block: true} (done, then wait), {block: true}
//     (wait and try again later) or {exit}. Failing calls return -1 and set errno (sys.fail).
//   fork      the child copies the caller: memory (shared copy-on-write, k-j-cow.js), registers, the descriptor
//             table (sharing every open file), signal dispositions and mask, the unflushed stdio buffer; it gets
//             one thread, a copy of the caller
//   exit      flush stdio, close every descriptor, free memory, become a zombie, give the children to init,
//             send SIGCHLD to the parent; _exit: the same without the flush
//   wait, waitpid(pid, &status, options)   pid -1 any child, > 0 that child, 0 the caller's group, < -1 group
//             -pid; WNOHANG, WUNTRACED, WCONTINUED. status: exit code << 8 | the killing signal | sig << 8 | 0x7f
//             (stopped) | 0xffff (continued)
//   execl execlp execv execvp: the image is replaced (a C program registered by name, or a built-in program);
//             pid, descriptors, ignored signals, mask and pending signals stay; handlers return to default
//   getpid getppid sleep
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;

  proto.fail = function (t, errno, say) {
    t.errno = errno;
    const p = this.proc(t.pid);
    if (p.prog && p.prog.errnoAt && t.vm) S.CLang.st_(t.vm, p.prog.errnoAt, 'i', errno);
    if (say) this.event('fail', p, { errno, name: K.ERRNAME[errno], tid: t.tid, line: t.line }, say + ` (errno ${K.ERRNAME[errno] || errno}: ${K.STRERROR[errno] || ''}).`);
    return { v: -1 };
  };

  proto.sys = function (t, name, args, info) {
    t.line = t.vm.line;
    this.info = info || null;
    this.lastSys = name;
    if (!K.LOCAL.has(name) && !K.STDIO.has(name)) this.touch('sys', 'w');
    const r = this.sysStdio(t, name, args) || this.sysFile(t, name, args) || this.sysSignal(t, name, args) || this.sysThread(t, name, args) || this.sysProc(t, name, args);
    if (r) return r;
    throw new S.CLang.CError(t.line, name + ' is not a call the simulated kernel knows');
  };

  /** a process gets a fresh image of prog, with argv */
  proto.loadImage = function (p, prog, argv) {
    const C = S.CLang, vm = K.image(prog, argv);
    p.prog = prog; p.image = 'c'; p.M = vm.M; p.memKey = null; p.own = true;
    let t = this.mainThread(p);
    if (!t) t = this.addThread(p, { tid: p.pid, state: 'blocked' });
    t.vm = vm; t.line = C.lineOf(prog, vm); t.bs = null; t.ctx = []; t.progress = null;
    this.initPages(p);
  };

  proto.sysProc = function (t, name, a) {
    const C = S.CLang, p = this.proc(t.pid), vm = t.vm, who = this.whoT(t), at = ' at line `' + t.line + '`';
    switch (name) {
      case 'getpid': return { v: p.pid };
      case 'getppid': this.touch('proc:' + p.pid, 'r'); this.shared = true; return { v: p.ppid };
      case 'fork': return { v: this.fork(t) };
      case 'exit': case '_exit': {
        if (name === 'exit' && p.buf && this.flushOut(t, p.buf.length, `${this.who(p)} exits, and exit flushes its stdout buffer first: {} goes out.`) === 'block') return { block: true };
        this.exit(p, a[0] & 255, name === 'exit', 0, this.endLine(t));
        return { exit: a[0] & 255 };
      }
      case 'wait': return this.waitFor(t, -1, a[0], 0, 'wait');
      case 'waitpid': return this.waitFor(t, a[0], a[1], a[2], 'waitpid');
      case 'sleep': {
        const n = a[0] >>> 0;
        if (this.o.sleep === 'free' || n === 0) { this.event('sleep', p, { secs: n, line: t.line, tid: t.tid }, `${who} calls sleep(${n})${at}: it gives up the CPU for a moment.`); return { v: 0 }; }
        t.wakeAt = this.ms + n * 1000;
        this.block(t, { kind: 'sleep', secs: n });
        this.event('block', p, { why: 'sleep', secs: n, line: t.line, tid: t.tid }, `${who} calls sleep(${n})${at}: it is blocked until the clock reaches ${t.wakeAt / 1000} s, and the others run meanwhile.`);
        return { v: 0, block: true };
      }
      case 'execl': case 'execlp': case 'execv': case 'execvp': {
        const path = C.readStr(vm, a[0]);
        let argv = [];
        if (name === 'execl' || name === 'execlp') { for (let i = 1; i < a.length && a[i]; i++) argv.push(C.readStr(vm, a[i])); }
        else for (let i = 0; i < 256; i++) { const q = C.load(vm, a[1] + 8 * i, 8, 0); if (!q) break; argv.push(C.readStr(vm, q)); }
        if (!argv.length) argv = [path];
        return this.exec(t, path, argv, name);
      }
    }
    return null;
  };

  proto.fork = function (t) {
    const C = S.CLang, p = this.proc(t.pid);
    this.touch('pid', 'w'); this.touch('proc:' + p.pid, 'w');
    const pid = this.nextPid++;
    const child = this.add({ pid, ppid: p.pid, pgid: p.pgid, role: 'prog', g: p.g + '.' + p.forks++, fds: p.fds.slice(), sig: { handlers: Object.assign({}, p.sig.handlers), pending: 0 }, buf: p.buf, bufMode: p.bufMode, inbuf: p.inbuf, prog: p.prog, image: p.image, state: 'ready' });
    for (const id of child.fds) if (id !== null && id !== undefined) this.ofiles[id].refs++;
    const ct = this.addThread(child, { tid: pid, state: 'ready', mask: t.mask, ctx: JSON.parse(JSON.stringify(t.ctx)), line: t.line, errno: t.errno, bs: t.bs ? JSON.parse(JSON.stringify(t.bs)) : null });
    if (t.vm) { ct.vm = C.clone(t.vm); child.M = ct.vm.M; C.complete(ct.vm, 0, 0); }
    // the caller's mutexes and semaphores, at the same addresses in the copy
    for (const [k, o] of Object.entries(this.objs)) if (o.pid === p.pid) { const c = JSON.parse(JSON.stringify(o)); c.pid = pid; c.q = []; if (c.owner === t.tid) c.owner = pid; this.objs[k.replace(/^(\w+):\d+:/, '$1:' + pid + ':')] = c; }
    this.forkPages(p, child);
    this.ready(ct);
    const copy = p.buf ? `, and its unflushed stdout buffer ${K.show(p.buf)} is copied too` : '';
    this.event('fork', p, { child: pid, line: t.line, buf: p.buf, tid: t.tid, pages: child.pages.slice() },
      `${this.whoT(t)} calls fork at line \`${t.line}\`: the kernel copies it into ${this.who(child)}${copy}; fork returns \`${pid}\` to the parent and \`0\` to the child.`);
    return pid;
  };

  /** p exits with code: the zombie, its children to init, its parent told. crash: the signal that killed it */
  /** the line that ended the process: the exit call's, or, when main has returned, its return statement's (or
   *  main's closing brace, when it ran off the end) */
  proto.endLine = function (t) {
    const p = this.proc(t.pid), prog = p.prog, vm = t.vm;
    if (!vm || vm.frames.length) return t.line;
    const main = prog.funcs.get('main');
    let pc = t.stmtPc === undefined ? -1 : t.stmtPc;
    const first = prog.code[pc];
    if (!first || first[0] !== 'stmt') return main.end ? main.end.line : t.line;
    for (pc++; pc < prog.code.length && prog.code[pc][0] !== 'stmt'; pc++) if (prog.code[pc][0] === 'ret') return prog.lines[pc] || first[1];
    return main.end ? main.end.line : t.line;
  };
  proto.exit = function (p, code, flush, crash, at) {
    if (p.state === 'zombie' || p.state === 'reaped') return;
    this.touch('proc:' + p.pid, 'w'); this.touch('proc:' + p.ppid, 'w');
    if (!flush && p.buf) this.event('lost', p, { text: p.buf }, `${this.who(p)} calls _exit: its unflushed buffer ${K.show(p.buf)} is thrown away.`);
    const mt = this.mainThread(p), line = at || (mt ? mt.line : 0);
    p.buf = ''; p.exitCode = crash ? null : code; p.termsig = crash || 0; p.status = crash ? crash : (code & 255) << 8; p.died = this.t; p.alarmAt = null;
    for (const t of this.threads) if (t.pid === p.pid && t.state !== 'done') { t.state = 'done'; t.wait = null; t.wakeAt = null; }
    this.queue = this.queue.filter((q) => this.thread(q) && this.thread(q).pid !== p.pid);
    this.closeAll(p);
    this.freePages(p);
    p.M = null;
    p.state = 'zombie';
    const par = this.proc(p.ppid);
    this.event('exit', p, { code, line, crash: crash || 0 }, crash ? `${this.who(p)} is killed by ${K.SIGNAME[crash] || 'signal ' + crash}.` : p.image === 'builtin' ? `${this.who(p)} (${mt && mt.bs ? mt.bs.name : 'a built-in'}) exits with \`${code}\`.` : `${this.who(p)} ${mt && mt.vm && mt.vm.frames.length === 0 ? 'returns `' + code + '` from main' : 'calls ' + (flush ? 'exit' : '_exit') + '(' + code + ')'} at line \`${line}\`: its memory is freed, but its process-table entry stays to hold the status.`);
    const pw = par && this.threads.find((t) => t.pid === par.pid && t.state === 'blocked' && t.wait && t.wait.kind === 'wait' && this.waitMatch(par, t.wait.pid, p));
    const how = crash ? 'is killed by ' + (K.SIGNAME[crash] || 'signal ' + crash) : p.image === 'builtin' ? '(' + (mt && mt.bs ? mt.bs.name : 'a built-in') + ') exits with `' + code + '`' : mt && mt.vm && mt.vm.frames.length === 0 ? 'returns `' + code + '` from main at line `' + line + '`' : 'calls ' + (flush ? 'exit' : '_exit') + '(' + code + ') at line `' + line + '`';
    this.event('zombie', p, { parent: p.ppid, waiting: !!pw, code: crash ? null : code, termsig: crash || 0 },
      `${this.who(p)} ${how} and is a zombie now: ${par && par.role === 'init' ? 'init will reap it' : pw ? 'its parent ' + this.who(par) + ' is already waiting, so it is woken to reap it' : 'its memory is freed, but its entry keeps the ' + (crash ? 'signal' : 'code `' + code + '`') + ' until its parent ' + this.who(par) + ' waits for it'}.`);
    for (const k of this.kids(p)) {
      const from = k.ppid; k.ppid = K.INIT;
      this.event('reparent', k, { from, to: K.INIT }, `${this.who(k)} has lost its parent, ${this.who(from)}, so it is re-parented to init (pid 1), which will reap it ${k.state === 'zombie' ? 'at once, since it is a zombie already' : 'when it exits'}.`);
    }
    if (par && par.role === 'prog') this.post(par, K.SIG.SIGCHLD, p.pid);
  };

  /** does child c match a wait for pid by parent p? */
  proto.waitMatch = function (p, pid, c) {
    return c.ppid === p.pid && c.state !== 'reaped' && (pid === -1 || (pid > 0 && c.pid === pid) || (pid === 0 && c.pgid === p.pgid) || (pid < -1 && c.pgid === -pid));
  };
  /** what a wait would collect now: {child, report: 'exit' | 'stop' | 'cont'} or none, or {none: true} */
  proto.waitable = function (p, pid, opts) {
    const kids = this.procs.filter((c) => this.waitMatch(p, pid, c));
    if (!kids.length) return { none: true };
    const z = kids.find((c) => c.state === 'zombie');
    if (z) return { child: z, report: 'exit' };
    if (opts & 2) { const s = kids.find((c) => c.report && c.report.kind === 'stop'); if (s) return { child: s, report: 'stop' }; }
    if (opts & 8) { const s = kids.find((c) => c.report && c.report.kind === 'cont'); if (s) return { child: s, report: 'cont' }; }
    return null;
  };
  proto.waitFor = function (t, pid, ptr, opts, fn) {
    const C = S.CLang, p = this.proc(t.pid), at = ' at line `' + t.line + '`', who = this.whoT(t);
    this.touch('proc:' + p.pid, 'w');
    const w = this.waitable(p, pid, opts);
    if (w && w.none) { this.event('wait', p, { ret: -1, fn, line: t.line, tid: t.tid }, `${who}'s ${fn}${at} returns \`-1\`: it has no ${pid === -1 ? '' : 'such '}child to wait for.`); return this.fail(t, K.ERR.ECHILD, null); }
    if (w) {
      const c = w.child, status = w.report === 'exit' ? c.status : w.report === 'stop' ? (c.report.sig << 8) | 127 : 65535;
      if (ptr) C.store(t.vm, ptr, 4, status, 1);
      this.touch('proc:' + c.pid, 'w');
      const what = w.report === 'exit' ? (c.termsig ? 'killed by ' + K.SIGNAME[c.termsig] : 'exit code ' + c.exitCode) : w.report === 'stop' ? 'stopped by ' + K.SIGNAME[c.report.sig] : 'continued';
      this.event('wait', p, { ret: c.pid, fn, code: c.exitCode, status, report: w.report, line: t.line, tid: t.tid }, `${who}'s ${fn}${at} returns \`${c.pid}\`${ptr ? ' and stores status ' + status : ''} (${what}).`);
      if (w.report === 'exit') this.reap(c, p); else c.report = null;
      return { v: c.pid };
    }
    if (opts & 1) { this.event('wait', p, { ret: 0, fn, line: t.line, tid: t.tid }, `${who}'s ${fn} with WNOHANG${at} returns \`0\`: no child has exited yet, so it does not wait.`); return { v: 0 }; }
    if (!t.wait || t.wait.kind !== 'wait') {
      this.event('block', p, { why: fn, line: t.line, on: pid, tid: t.tid }, `${who} calls ${fn}${at}: ${pid === -1 ? 'none of its children has' : 'child ' + pid + ' has not'} exited yet, so it is blocked.`);
    }
    this.block(t, { kind: 'wait', pid, opts, fn });
    return { block: true };
  };
  /** the zombie z leaves the process table; by is its parent or init */
  proto.reap = function (z, by) {
    z.state = 'reaped'; z.reapedBy = by.pid;
    this.touch('proc:' + z.pid, 'w');
    this.event('reap', z, { by: by.pid, code: z.exitCode, who: this.who(z) }, `${this.who(z)} is reaped by ${this.who(by)}: its ${z.termsig ? 'signal' : 'exit code `' + z.exitCode + '`'} is collected and its entry leaves the process table.`);
  };
  /** init and the shell are the kernel's own: each step of theirs reaps one zombie child */
  proto.stepReaper = function (t) {
    const p = this.proc(t.pid), z = this.kids(p).find((k) => k.state === 'zombie');
    if (z) { if (p.role === 'shell') this.event('wait', p, { ret: z.pid, fn: 'waitpid', code: z.exitCode }, `The shell's waitpid returns \`${z.pid}\` with ${z.termsig ? 'its killing signal, ' + K.SIGNAME[z.termsig] : 'exit code `' + z.exitCode + '`'}: the program has finished.`); this.reap(z, p); }
    if (p.role === 'shell' && !this.kids(p).length) p.idle = true;
    if (!this.kids(p).some((k) => k.state === 'zombie')) this.block(t, { kind: 'reap' });
  };

  /** the image of p becomes the program named by path (argv its arguments): a C program or a built-in */
  proto.exec = function (t, path, argv, fn) {
    const p = this.proc(t.pid), name = path.split('/').pop(), at = ' at line `' + t.line + '`', who = this.whoT(t);
    const src = (this.o.programs || {})[name] || (this.o.programs || {})[path] || (K.programs || {})[name];
    const bi = !src && K.BUILTIN_PROGS && K.BUILTIN_PROGS[name];
    if (!src && !bi) return this.fail(t, K.ERR.ENOENT, `${who} calls ${fn}("${path}")${at}: there is no program by that name`);
    let prog = null;
    if (src) { try { prog = K.compile(src); } catch (e) { return this.fail(t, K.ERR.ENOEXEC, `${who} calls ${fn}("${path}")${at}: it does not compile (${e.message})`); } }
    this.touch('proc:' + p.pid, 'w');
    for (const o of this.threads) if (o.pid === p.pid && o !== t && o.state !== 'done') { o.state = 'done'; o.wait = null; }
    this.queue = this.queue.filter((q) => q === t.tid || this.thread(q).pid !== p.pid);
    if (t.tid !== p.pid) { t.main = true; } // the caller carries on as the new image's only thread
    const lost = p.buf;
    p.buf = ''; p.bufMode = null; p.inbuf = '';
    for (const [s, h] of Object.entries(p.sig.handlers)) if (h !== 'ign') delete p.sig.handlers[s];
    t.ctx = []; t.progress = null;
    this.freePages(p);
    if (prog) this.loadImage(p, prog, argv);
    else { p.prog = null; p.image = 'builtin'; p.M = null; t.vm = null; t.bs = { name, argv, pc: 0 }; t.line = 0; p.pages = []; }
    this.event('exec', p, { path, argv, image: prog ? 'c' : 'builtin', lost, tid: t.tid }, `${who} calls ${fn}("${path}")${at}: its image is replaced by ${prog ? 'the program ' + name : 'the built-in ' + name}, with argv ${K.show(argv.join(' '))}; the pid and the open descriptors stay${lost ? ', and the unflushed buffer ' + K.show(lost) + ' is lost' : ''}.`);
    return { v: 0, exec: true };
  };
})(globalThis.Proses = globalThis.Proses || {});
