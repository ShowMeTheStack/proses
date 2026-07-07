// The simulated kernel, part eight: signals and job control.
//   Each process has dispositions (p.sig.handlers[sig]: absent = default, 'ign', or {fn, mask, flags}) and a
//   pending set (p.sig.pending, a bit per signal); each thread has a mask. Default actions: terminate (most),
//   ignore (SIGCHLD), stop (SIGSTOP, SIGTSTP, SIGTTIN, SIGTTOU), continue (SIGCONT). SIGKILL and SIGSTOP can be
//   neither caught, ignored nor blocked.
//   A signal is delivered when a thread that does not block it next runs (and at once after the system call that
//   sent it to its own process). A handler runs on the thread's own stack, as a call the kernel makes; it
//   returns into a trampoline that traps back (__sigreturn), and the thread carries on where it was. A thread
//   blocked in a call is woken: the call restarts after the handler if the handler has SA_RESTART (signal() sets
//   it) and the call can restart (read, write, wait), else it fails with EINTR; sleep returns the seconds left.
//   Calls: kill signal sigaction sigprocmask sigemptyset sigfillset sigaddset sigdelset sigismember sigpending
//   sigsuspend pause alarm raise abort setpgid getpgid getpgrp tcsetpgrp tcgetpgrp (sys.sysSignal(t, name, args))
//   struct sigaction (c-h-consts.js): the handler (8 bytes) at 0, sa_mask (4) at 8, sa_flags (4) at 12.
//   sys.post(p, sig, from)   generate a signal for process p     sys.deliver(t) -> 'killed' | 'stopped' | null
//   sys.press(char)          the terminal's ^C, ^Z or ^\: SIGINT, SIGTSTP or SIGQUIT to the foreground group
//   sys.type(text), sys.endInput()   what the user types at the terminal, and end-of-file (^D)
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;
  const bit = (s) => (s >= 1 && s <= 31 ? 1 << (s - 1) : 0);
  K.sigbit = bit;
  const SG = () => K.SIG;
  /** the default action of a signal: 'term' | 'ign' | 'stop' | 'cont' */
  K.sigDefault = (s) => (s === 17 || s === 28 || s === 23 ? 'ign' : s === 18 ? 'cont' : s === 19 || s === 20 || s === 21 || s === 22 ? 'stop' : 'term');
  const name = (s) => K.SIGNAME[s] || 'signal ' + s;
  const UNBLOCKABLE = bit(9) | bit(19);
  const RESTARTABLE = new Set(['read', 'write', 'wait', 'flush']);

  /** generate sig for process p (from: the sender's pid, or 0 for the kernel) */
  proto.post = function (p, sig, from) {
    if (!p || p.state === 'zombie' || p.state === 'reaped' || !sig) return;
    this.touch('sig:' + p.pid, 'w');
    const h = p.sig.handlers[sig], act = h === 'ign' ? 'ign' : h ? 'handle' : K.sigDefault(sig);
    const sender = from === p.pid ? this.who(p) + ' sends ' + name(sig) + ' to itself' : (from ? this.who(from) : 'the kernel') + ' sends ' + name(sig) + ' to ' + this.who(p);
    if (sig === 19 || sig === 20 || sig === 21 || sig === 22) p.sig.pending &= ~bit(18);
    if (act === 'ign' && sig !== 9 && sig !== 19 && sig !== 18) { if (h === 'ign') this.event('signal', p, { sig, from, ignored: true }, `${sender}, which ignores it.`); return; }
    if (sig !== 18 || act === 'handle') p.sig.pending |= bit(sig);
    this.event('signal', p, { sig, from, pending: p.sig.pending }, sig === 18 && act !== 'handle' ? `${sender}.` : `${sender}: it is pending until a thread that does not block it runs.`);
    if (sig === SG().SIGCONT) {
      p.sig.pending &= ~(bit(19) | bit(20) | bit(21) | bit(22));
      if (p.state === 'stopped') this.cont(p);
    }
    if (sig === 9 && p.state === 'stopped') this.cont(p, true);
    // a thread that will take it, if it sleeps in an interruptible call, is woken to do so
    for (const t of this.threads) {
      if (t.pid !== p.pid || t.state === 'done') continue;
      if ((t.mask & bit(sig)) && !(bit(sig) & UNBLOCKABLE)) continue;
      if (t.state === 'blocked' && t.wait && !/^(mutex|cond|join|reap)$/.test(t.wait.kind)) { t.intr = t.wait; this.ready(t); }
      break;
    }
  };
  /** the process continues: its stopped threads go back to what they were doing */
  proto.cont = function (p, quiet) {
    for (const t of this.threads) if (t.pid === p.pid && t.state === 'stopped') { const w = t.stopWait; t.stopWait = null; if (w) this.block(t, w); else this.ready(t); }
    p.state = 'ready'; this.procState(p);
    p.report = { kind: 'cont' };
    if (!quiet) this.event('cont', p, {}, `${this.who(p)} is continued by SIGCONT: its threads carry on.`);
    const par = this.proc(p.ppid);
    if (par && par.role === 'prog') this.post(par, SG().SIGCHLD, p.pid);
  };
  proto.stop = function (p, sig) {
    for (const t of this.threads) if (t.pid === p.pid && t.state !== 'done' && t.state !== 'stopped') { t.stopWait = t.state === 'blocked' ? t.wait : null; t.state = 'stopped'; }
    this.queue = this.queue.filter((q) => this.thread(q).pid !== p.pid);
    p.state = 'stopped'; p.report = { kind: 'stop', sig };
    this.event('stop', p, { sig }, `${this.who(p)} is stopped by ${name(sig)}: none of its threads runs until SIGCONT.`);
    const par = this.proc(p.ppid), h = par && par.sig.handlers[SG().SIGCHLD];
    if (par && par.role === 'prog' && !(h && h.flags & 1)) this.post(par, SG().SIGCHLD, p.pid);
  };

  /** deliver t's next deliverable signal: a default action, or a handler set up on its stack */
  proto.deliver = function (t) {
    const p = this.proc(t.pid);
    for (let guard = 0; guard < 32; guard++) {
      const ready = p.sig.pending & ~(t.mask & ~UNBLOCKABLE);
      if (!ready) break;
      let sig = 1; while (!(ready & bit(sig))) sig++;
      p.sig.pending &= ~bit(sig);
      this.touch('sig:' + p.pid, 'w');
      const h = p.sig.handlers[sig], act = sig === 9 || sig === 19 ? K.sigDefault(sig) : h === 'ign' ? 'ign' : h ? 'handle' : K.sigDefault(sig);
      const intr = t.intr; t.intr = null;
      if (act === 'term') { this.exit(p, 0, false, sig); return 'killed'; }
      if (act === 'stop') { if (intr) this.block(t, intr); this.stop(p, sig); return 'stopped'; }
      if (act !== 'handle') { if (intr) { this.block(t, intr); return 'blocked'; } continue; }
      if (!p.prog || !t.vm) { this.exit(p, 0, false, sig); return 'killed'; }
      // a call it was blocked in: restarted after the handler, or failed with EINTR
      let note = '';
      if (intr) {
        const restart = (h.flags & K.CONST.SA_RESTART) && RESTARTABLE.has(intr.kind);
        if (intr.kind === 'sleep') { const left = Math.max(0, Math.round((t.wakeAt - this.ms) / 1000)); t.vm.ops[t.vm.ops.length - 1] = left; t.wakeAt = null; note = '; sleep is cut short and will return ' + left; }
        else if (!restart && intr.kind !== 'flush') { this.completeIntr(t, intr); note = '; the ' + intr.kind + ' it was blocked in fails with EINTR'; }
        else note = '; the ' + intr.kind + ' it was blocked in will start again after the handler';
        if (intr.kind === 'sigsuspend') t.mask = intr.old;
      }
      t.ctx.push({ pc: t.vm.pc, ops: t.vm.ops.slice(), sp: t.vm.sp, fp: t.vm.fp, line: t.vm.line, depth: t.vm.frames.length, mask: intr && intr.kind === 'sigsuspend' ? intr.old : t.mask, sig });
      t.mask |= bit(sig) | (h.mask || 0);
      K.pushCall(p.prog, t.vm, h.fn, [sig], p.prog.kt.sig);
      t.state = 'running'; t.wait = null;
      t.line = S.CLang.lineOf(p.prog, t.vm);
      this.event('handler', p, { sig, fn: h.fn, tid: t.tid, depth: t.ctx.length, line: t.line }, `${this.whoT(t)} takes ${name(sig)}: the kernel saves where it was and runs its handler ${h.fn}(${sig}) on its own stack${note}.`);
      return 'handler';
    }
    return null;
  };
  /** a call interrupted by a handler returns -1 with errno EINTR */
  proto.completeIntr = function (t, intr) {
    const C = S.CLang, ins = this.proc(t.pid).prog.code[t.vm.pc];
    if (ins && ins[0] === 'sys') { C.complete(t.vm, ins[2], -1); this.fail(t, K.ERR.EINTR, null); }
    if (intr.kind === 'sem' && this.objs[intr.key]) this.objs[intr.key].q = this.objs[intr.key].q.filter((x) => x !== t.tid);
    t.progress = null;
  };
  proto.sigreturn = function (t) {
    const p = this.proc(t.pid), c = t.ctx.pop();
    if (!c) throw new S.CLang.CError(t.line, 'a return from a signal handler with no handler running');
    Object.assign(t.vm, { pc: c.pc, ops: c.ops, sp: c.sp, fp: c.fp, line: c.line });
    t.vm.frames.length = c.depth;
    t.mask = c.mask; t.line = c.line;
    this.event('sigreturn', p, { sig: c.sig, tid: t.tid, line: c.line }, `${this.whoT(t)} returns from its ${name(c.sig)} handler: the kernel puts back its registers and mask, and it carries on at line \`${c.line}\`.`);
  };

  const readSet = (C, vm, a) => (a ? C.load(vm, a, 4, 0) : 0);
  proto.sysSignal = function (t, nm, a) {
    const C = S.CLang, p = this.proc(t.pid), vm = t.vm, who = this.whoT(t), at = ' at line `' + t.line + '`', E = K.ERR;
    const disp = (v) => (v === 0 ? undefined : v === 1 ? 'ign' : K.fnName(p.prog, v));
    const val = (h) => (h === undefined ? 0 : h === 'ign' ? 1 : K.fnAddr(p.prog, h.fn));
    const set = (sig, h) => {
      if (sig < 1 || sig > 31 || sig === 9 || sig === 19) return false;
      if (h === undefined) delete p.sig.handlers[sig]; else p.sig.handlers[sig] = h;
      this.touch('sig:' + p.pid, 'w');
      if (h === 'ign') p.sig.pending &= ~bit(sig);
      return true;
    };
    switch (nm) {
      case 'signal': {
        const old = val(p.sig.handlers[a[0]]), d = disp(a[1]);
        if (a[1] > 1 && !d) return this.fail(t, E.EINVAL, `${who} calls signal${at} with something that is not a function`);
        if (!set(a[0], d === undefined || d === 'ign' ? d : { fn: d, mask: 0, flags: K.CONST.SA_RESTART })) return this.fail(t, E.EINVAL, `${who} calls signal(${a[0]})${at}: that signal cannot be caught`);
        this.event('disposition', p, { sig: a[0], to: d || 'default', tid: t.tid }, `${who} sets ${name(a[0])} to ${d === undefined ? 'its default action' : d === 'ign' ? 'be ignored' : 'run ' + d}${at}.`);
        return { v: old };
      }
      case 'sigaction': {
        if (a[2]) { const h = p.sig.handlers[a[0]]; C.store(vm, a[2], 8, val(h), 0); C.store(vm, a[2] + 8, 4, h && h.mask || 0, 0); C.store(vm, a[2] + 12, 4, h && h.flags || 0, 1); }
        if (!a[1]) return { v: 0 };
        const fv = C.load(vm, a[1], 8, 0), mask = C.load(vm, a[1] + 8, 4, 0), flags = C.load(vm, a[1] + 12, 4, 1), d = disp(fv);
        if (fv > 1 && !d) return this.fail(t, E.EINVAL, null);
        if (!set(a[0], d === undefined || d === 'ign' ? d : { fn: d, mask, flags })) return this.fail(t, E.EINVAL, `${who} calls sigaction(${a[0]})${at}: that signal cannot be caught`);
        this.event('disposition', p, { sig: a[0], to: d || 'default', tid: t.tid }, `${who} sets ${name(a[0])} to ${d === undefined ? 'its default action' : d === 'ign' ? 'be ignored' : 'run ' + d + (flags & K.CONST.SA_RESTART ? ', restarting interrupted calls' : '')}${at}.`);
        return { v: 0 };
      }
      case 'sigprocmask': {
        if (a[2]) C.store(vm, a[2], 4, t.mask, 0);
        if (a[1]) { const s = readSet(C, vm, a[1]); t.mask = a[0] === 0 ? t.mask | s : a[0] === 1 ? t.mask & ~s : s; t.mask &= ~UNBLOCKABLE; }
        this.touch('sig:' + p.pid, 'r');
        if (a[1]) this.event('mask', p, { mask: t.mask, tid: t.tid }, `${who} sets its signal mask${at}: ${maskText(t.mask)}.`);
        return { v: 0 };
      }
      case 'sigemptyset': C.store(vm, a[0], 4, 0, 0); return { v: 0 };
      case 'sigfillset': C.store(vm, a[0], 4, 0xffffffff, 0); return { v: 0 };
      case 'sigaddset': C.store(vm, a[0], 4, (readSet(C, vm, a[0]) | bit(a[1])) >>> 0, 0); return { v: 0 };
      case 'sigdelset': C.store(vm, a[0], 4, (readSet(C, vm, a[0]) & ~bit(a[1])) >>> 0, 0); return { v: 0 };
      case 'sigismember': return { v: readSet(C, vm, a[0]) & bit(a[1]) ? 1 : 0 };
      case 'sigpending': this.touch('sig:' + p.pid, 'r'); C.store(vm, a[0], 4, (p.sig.pending & t.mask) >>> 0, 0); return { v: 0 };
      case 'pause': case 'sigsuspend': {
        if (nm === 'sigsuspend' && (!t.wait || t.wait.kind !== 'sigsuspend')) {
          const old = t.mask; t.mask = readSet(C, vm, a[0]) & ~UNBLOCKABLE;
          // a signal the new mask lets through is already pending: it is taken at once
          if (p.sig.pending & ~t.mask) { t.intr = { kind: 'sigsuspend', old }; this.event('block', p, { why: nm, tid: t.tid, line: t.line }, `${who} calls sigsuspend${at}: a signal it now lets through is already pending, so it is taken at once.`); return { block: true }; }
          this.block(t, { kind: 'sigsuspend', old });
        }
        else if (nm === 'pause') this.block(t, { kind: 'pause' });
        this.event('block', p, { why: nm, tid: t.tid, line: t.line }, `${who} calls ${nm}${at}: it sleeps until a signal is handled.`);
        return { block: true };
      }
      case 'alarm': {
        const left = p.alarmAt === null ? 0 : Math.max(0, Math.ceil((p.alarmAt - this.ms) / 1000));
        p.alarmAt = a[0] ? this.ms + a[0] * 1000 : null;
        this.touch('sig:' + p.pid, 'w');
        this.event('alarm', p, { secs: a[0], tid: t.tid }, a[0] ? `${who} sets an alarm${at}: SIGALRM comes in ${a[0]} s${this.o.sleep === 'free' ? ' (at any moment, here)' : ', at ' + p.alarmAt / 1000 + ' s'}.` : `${who} cancels its alarm${at}.`);
        return { v: left };
      }
      case 'raise': this.post(p, a[0], p.pid); return { v: 0, deliver: true };
      case 'abort': p.sig.handlers[6] = p.sig.handlers[6] === 'ign' ? undefined : p.sig.handlers[6]; t.mask &= ~bit(6); this.post(p, 6, p.pid); return { v: 0, deliver: true };
      case 'kill': {
        const pid = a[0], sig = a[1];
        if (sig < 0 || sig > 31) return this.fail(t, E.EINVAL, `${who} calls kill${at} with no such signal`);
        const targets = pid > 0 ? this.procs.filter((q) => q.pid === pid) : pid === 0 ? this.procs.filter((q) => q.pgid === p.pgid) : pid === -1 ? this.procs.filter((q) => q.role === 'prog' && q.pid !== p.pid) : this.procs.filter((q) => q.pgid === -pid);
        const live = targets.filter((q) => q.state !== 'reaped' && q.role !== 'init');
        for (const q of live) this.touch('sig:' + q.pid, 'w');
        if (!live.length) return this.fail(t, E.ESRCH, `${who} calls kill(${pid}, ${sig})${at}: there is no such process`);
        if (!sig) return { v: 0 };
        for (const q of live) this.post(q, sig, p.pid);
        return { v: 0, deliver: true };
      }
      case 'setpgid': {
        const q = a[0] ? this.proc(a[0]) : p, g = a[1] || (q && q.pid);
        if (!q || (q !== p && q.ppid !== p.pid)) return this.fail(t, E.ESRCH, `${who} calls setpgid(${a[0]}, ${a[1]})${at}: not itself or its child`);
        q.pgid = g; this.touch('proc:' + q.pid, 'w');
        this.event('pgid', q, { pgid: g, tid: t.tid }, `${who} puts ${q === p ? 'itself' : this.who(q)} in process group \`${g}\`${at}.`);
        return { v: 0 };
      }
      case 'getpgid': { const q = a[0] ? this.proc(a[0]) : p; return q ? { v: q.pgid } : this.fail(t, E.ESRCH, null); }
      case 'getpgrp': return { v: p.pgid };
      case 'tcsetpgrp': this.tty.fg = a[1]; this.touch('tty', 'w'); this.event('foreground', p, { pgid: a[1], tid: t.tid }, `${who} gives the terminal to process group \`${a[1]}\`${at}: ^C and ^Z now go to it.`); return { v: 0 };
      case 'tcgetpgrp': this.touch('tty', 'r'); return { v: this.tty.fg };
      case '__sigreturn': this.sigreturn(t); return { block: true, resumed: true };
    }
    return null;
  };
  const maskText = (m) => { const out = []; for (let s = 1; s <= 31; s++) if (m & bit(s)) out.push(name(s)); return out.length ? 'blocking ' + out.join(', ') : 'blocking nothing'; };

  // the terminal, from the outside
  proto.press = function (ch) {
    const sig = { C: 2, Z: 20, '\\': 3 }[String(ch).toUpperCase()];
    if (!sig) return;
    const fg = this.procs.filter((q) => q.pgid === this.tty.fg && q.role === 'prog' && q.state !== 'zombie' && q.state !== 'reaped');
    this.event('key', null, { ch, sig, pgid: this.tty.fg }, `The user types ^${ch}: the terminal sends ${name(sig)} to the foreground group \`${this.tty.fg}\`${fg.length ? '' : ', which is empty'}.`);
    for (const q of fg) this.post(q, sig, 0);
    this.recheck();
  };
  proto.type = function (text) { this.tty.input += text; this.event('typed', null, { text }, `The user types ${K.show(text)} at the terminal.`); this.recheck(); };
  proto.endInput = function () { this.tty.eof = true; this.event('typed', null, { eof: true }, 'The user types ^D: the terminal reports end of file to the next read.'); this.recheck(); };
})(globalThis.Proses = globalThis.Proses || {});
