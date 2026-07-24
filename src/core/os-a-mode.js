// The hardware boundary, part 1: user and kernel mode, privileged instructions, the trap table, and the one
// sequence every interrupt, exception and system call follows: raise, enter kernel mode, switch to the kernel
// stack, save the user state, dispatch through the table, handle, restore, return-from-trap.
//   S.Os.INSTR                         name -> {priv, what}: the toy instruction set (priv: kernel mode only)
//   S.Os.VECTORS                       the default trap table [{vector, name, kind, handler, what}]
//   S.Os.table(extra?)                 a trap table (a copy of VECTORS, entries from extra replacing or adding)
//   S.Os.cpu(o?)                       a CPU state {mode, pc, sp, IF, regs} (user mode by default)
//   S.Os.trap({cause, vector, cpu, table, kstack, result, fault, between})
//       -> {steps, cpu (after), kstack, handler, entry, outcome: 'resume' | 'retry' | 'kill', resumePc}
//       cause: 'interrupt' (asynchronous, from a device), 'exception' (synchronous, the instruction failed) or
//       'syscall' (synchronous and on purpose). Every step carries a snapshot {mode, pc, sp, IF, kstack}.
//       An interrupt resumes after the instruction at pc, or at pc itself with between: true (taken before it ran).
//   S.Os.run(program, {mode, table, interrupts: [{at, vector}], regs, maxSteps})
//       -> {steps, cpu, executed, traps: [{at, vector, cause, outcome}], killed}
//       program: [{op, args?}] in the toy instruction set; a privileged instruction in user mode raises a
//       general-protection exception (vector 13) and the process is killed; div by zero raises vector 0.
//   S.Os.rng(seed) -> () => [0, 1)      S.Os.hex(n, digits)         S.Os.list(xs)
// Steps are {kind, say, ...data}: say is one plain sentence with the actual values.
(function (S) {
  'use strict';
  const O = (S.Os = S.Os || {});

  O.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  O.hex = (n, d) => '0x' + (n >>> 0).toString(16).padStart(d || 4, '0');
  O.list = function (xs) { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  O.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  /** 'a' or 'an' for the word or number that follows (an 8, an 11, an 18, an hour; a user, a one) */
  O.article = function (next, cap) {
    const w = String(next).trim(), lw = w.toLowerCase();
    let an;
    if (/^\d/.test(w)) an = /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
    else if (/^[A-Z]{2,}/.test(w)) an = /^[AEFHILMNORSX]/.test(w);
    else an = /^[aeiou]/.test(lw) ? !/^(use|usa|uni|uin|one|once|eu|ur[aeiou])/.test(lw) : /^(hour|honest|honou)/.test(lw);
    const a = an ? 'an' : 'a';
    return cap ? a[0].toUpperCase() + a.slice(1) : a;
  };

  O.INSTR = {
    load: { priv: false, what: 'copies a word from memory into a register' },
    store: { priv: false, what: 'copies a register into memory' },
    add: { priv: false, what: 'adds two registers' },
    div: { priv: false, what: 'divides one register by another' },
    jmp: { priv: false, what: 'jumps to another instruction' },
    call: { priv: false, what: 'calls a function in the same program' },
    syscall: { priv: false, what: 'asks the kernel for a service on purpose (a trap)' },
    cli: { priv: true, what: 'turns interrupts off' },
    sti: { priv: true, what: 'turns interrupts on' },
    hlt: { priv: true, what: 'stops the CPU until the next interrupt' },
    in: { priv: true, what: 'reads a device register' },
    out: { priv: true, what: 'writes a device register' },
    lcr3: { priv: true, what: 'loads the page-table base register' },
    lidt: { priv: true, what: 'loads the trap-table base register' },
    settimer: { priv: true, what: 'programs the timer interrupt' },
    iret: { priv: true, what: 'returns from a trap to the mode and place saved on the kernel stack' },
  };

  O.VECTORS = [
    { vector: 0, name: 'divide error', kind: 'exception', handler: 'divide_error', what: 'sends the process SIGFPE, which by default ends it', outcome: 'kill' },
    { vector: 6, name: 'invalid opcode', kind: 'exception', handler: 'invalid_op', what: 'sends the process SIGILL, which by default ends it', outcome: 'kill' },
    { vector: 13, name: 'general protection', kind: 'exception', handler: 'general_protection', what: 'sends the process SIGSEGV for a forbidden operation, which by default ends it', outcome: 'kill' },
    { vector: 14, name: 'page fault', kind: 'exception', handler: 'page_fault', what: 'brings the missing page in and lets the instruction run again', outcome: 'retry' },
    { vector: 32, name: 'timer', kind: 'interrupt', handler: 'timer_tick', what: 'counts the tick and lets the scheduler decide who runs next', outcome: 'resume' },
    { vector: 33, name: 'keyboard', kind: 'interrupt', handler: 'keyboard', what: 'reads the key code from the keyboard controller into the input buffer', outcome: 'resume' },
    { vector: 46, name: 'disk', kind: 'interrupt', handler: 'disk_done', what: 'marks the finished request done and wakes the process that waited for it', outcome: 'resume' },
    { vector: 128, name: 'system call', kind: 'syscall', handler: 'syscall_entry', what: 'looks the call number up in the system-call table and runs that call', outcome: 'resume' },
  ];
  O.table = function (extra) {
    const t = O.VECTORS.map((e) => Object.assign({}, e));
    for (const e of extra || []) { const i = t.findIndex((x) => x.vector === e.vector); if (i >= 0) t[i] = Object.assign({}, t[i], e); else t.push(Object.assign({ kind: 'interrupt', outcome: 'resume' }, e)); }
    return t.sort((a, b) => a.vector - b.vector);
  };
  O.cpu = (o) => Object.assign({ mode: 'user', pc: 0x1000, sp: 0x7ff0, IF: true, regs: { r0: 0, r1: 0, r2: 0, r3: 0 } }, o || {});
  const clone = (c) => ({ mode: c.mode, pc: c.pc, sp: c.sp, IF: c.IF, regs: Object.assign({}, c.regs) });
  const snap = (c, kstack) => ({ mode: c.mode, pc: c.pc, sp: c.sp, IF: c.IF, regs: Object.assign({}, c.regs), kstack: kstack.map((x) => Object.assign({}, x)) });

  const WHY = {
    interrupt: 'a device raised its interrupt line, unrelated to the instruction running (asynchronous)',
    exception: 'the instruction at the PC could not complete (synchronous, not on purpose)',
    syscall: 'the program ran the syscall instruction on purpose (synchronous)',
  };

  /** One trap, end to end. o.kstack: the kernel-stack top (default 0x9000); o.result: r0 for a system call. */
  O.trap = function (o) {
    const cause = o.cause || 'interrupt', table = o.table || O.table();
    const cpu = clone(O.cpu(o.cpu)), user = clone(cpu), H = (n) => O.hex(n);
    const vector = o.vector === undefined ? { interrupt: 32, exception: 13, syscall: 128 }[cause] : o.vector;
    const entry = table.find((e) => e.vector === vector);
    const steps = [], kstack = [], top = o.kstack === undefined ? 0x9000 : o.kstack;
    const add = (kind, say, data) => steps.push(Object.assign({ kind, say }, data || {}, snap(cpu, kstack)));
    // where to resume: an interrupt or a trap resumes after the instruction, a fault re-runs it
    const outcome = entry ? entry.outcome : 'kill';
    // o.between: the interrupt came between instructions, so pc is the one not yet run and resumes as it is
    const nextPc = cause === 'exception' || o.between ? user.pc : user.pc + 1;
    add('raise', O.article(entry ? entry.name : 'vector ' + vector, true) + ' ' + (entry ? entry.name : 'vector ' + vector) + (cause === 'syscall' ? '' : ' ' + cause) + ' at PC ' + H(user.pc) + ': ' + WHY[cause] + '.', { cause, vector });
    if (user.mode === 'kernel') add('note', 'The CPU is already in kernel mode, so it stays on the kernel stack at ' + H(cpu.sp) + '; the steps are the same without the stack switch.');
    const wasUser = user.mode === 'user';
    cpu.mode = 'kernel';
    if (cause === 'interrupt') cpu.IF = false;
    add('mode', 'The hardware sets the mode bit to kernel' + (cause === 'interrupt' ? ' and turns interrupts off so a second one cannot interrupt the save' : '') + '.');
    if (wasUser) { cpu.sp = top; add('stack', 'The hardware switches from the user stack at ' + H(user.sp) + ' to this process\'s kernel stack at ' + H(top) + ': the kernel never trusts the user stack.'); }
    const push = (name, value) => { cpu.sp -= 4; kstack.push({ name, value, at: cpu.sp }); };
    push('user sp', user.sp); push('flags', user.IF ? 1 : 0); push('pc', nextPc);
    add('save', 'The hardware pushes the user SP ' + H(user.sp) + ', the flags and the PC ' + H(kstack[2].value) + ' onto the kernel stack; SP is now ' + H(cpu.sp) + '.');
    for (const r of Object.keys(user.regs)) push(r, user.regs[r]);
    add('save', 'The kernel\'s entry code pushes the ' + Object.keys(user.regs).length + ' general registers (' + Object.keys(user.regs).join(', ') + '), completing the trap frame; SP is now ' + H(cpu.sp) + '.');
    if (!entry) {
      add('dispatch', 'Entry ' + vector + ' of the trap table is empty, so the kernel treats it as a fatal error and ends the process.', { vector, handler: null });
      return finish('kill');
    }
    cpu.pc = 0xc000 + entry.vector * 16;
    add('dispatch', 'The hardware reads entry ' + vector + ' of the trap table, set up by the kernel at boot, and jumps to ' + entry.handler + ' at ' + H(cpu.pc) + '.', { vector, handler: entry.handler });
    let handled = entry.what;
    if (cause === 'syscall') {
      const r = o.result === undefined ? 0 : o.result;
      const slot = kstack.find((x) => x.name === 'r0'); if (slot) slot.value = r;
      handled = 'runs call ' + (user.regs.r0 || 0) + ' and writes its result ' + r + ' into the saved r0 in the trap frame';
    }
    if (o.fault && outcome === 'kill') handled = entry.what + ' (' + o.fault + ')';
    add('handle', 'The handler ' + entry.handler + ' ' + handled + '.', { handler: entry.handler, outcome });
    return finish(outcome);

    function finish(out) {
      if (out === 'kill') {
        add('kill', 'The process does not return: the kernel frees it and its kernel stack, and the scheduler runs another.', { outcome: 'kill' });
        return { steps, cpu, kstack, handler: entry && entry.handler, entry, outcome: 'kill', resumePc: null };
      }
      const frame = kstack.slice();
      for (const r of Object.keys(user.regs).reverse()) { const x = kstack.pop(); cpu.regs[r] = x.value; cpu.sp += 4; }
      add('restore', 'The kernel pops the general registers from the trap frame' + (cause === 'syscall' ? ', r0 now holding the result ' + cpu.regs.r0 : '') + '.');
      const pc = kstack.pop().value, fl = kstack.pop().value, usp = kstack.pop().value;
      cpu.sp = usp; cpu.pc = pc; cpu.IF = !!fl; cpu.mode = user.mode;
      add('return', 'Return-from-trap pops the PC, flags and user SP: the CPU is back in ' + cpu.mode + ' mode at PC ' + H(pc) + (out === 'retry' ? ', the same instruction, which now runs again' : o.between ? ', the instruction it had not yet run' : ', the next instruction') + ', on the stack at ' + H(usp) + '.', { outcome: out });
      return { steps, cpu, kstack: frame, handler: entry.handler, entry, outcome: out, resumePc: pc };
    }
  };

  /** Run a small program instruction by instruction, trapping where the hardware would. */
  O.run = function (program, o) {
    o = o || {};
    const table = o.table || O.table();
    const cpu = O.cpu({ mode: o.mode || 'user', pc: 0, regs: Object.assign({ r0: 0, r1: 0, r2: 0, r3: 0 }, o.regs || {}) });
    const steps = [], traps = [], irq = (o.interrupts || []).slice().sort((a, b) => a.at - b.at);
    let executed = 0, killed = null;
    const max = o.maxSteps || 200, H = (n) => O.hex(n);
    const sub = (t, at) => { for (const s of t.steps) steps.push(Object.assign({}, s, { phase: 'trap', at })); };
    while (cpu.pc < program.length && executed < max) {
      if (cpu.IF && irq.length && irq[0].at <= executed) {
        const e = irq.shift(), t = O.trap({ cause: 'interrupt', vector: e.vector || 32, cpu, table, between: true });
        traps.push({ at: cpu.pc, vector: e.vector || 32, cause: 'interrupt', outcome: t.outcome });
        sub(t, cpu.pc);
        Object.assign(cpu, { pc: t.cpu.pc, sp: t.cpu.sp, IF: t.cpu.IF, mode: t.cpu.mode, regs: t.cpu.regs });
        continue;
      }
      const ins = program[cpu.pc], op = ins.op, d = O.INSTR[op], args = ins.args || [];
      executed++;
      if (!d) {
        const t = O.trap({ cause: 'exception', vector: 6, cpu, table, fault: op + ' is not an instruction' });
        traps.push({ at: cpu.pc, vector: 6, cause: 'exception', outcome: t.outcome }); sub(t, cpu.pc); killed = { pc: cpu.pc, op, vector: 6 }; break;
      }
      if (d.priv && cpu.mode === 'user') {
        steps.push({ kind: 'privileged', op, pc: cpu.pc, mode: cpu.mode, say: 'PC ' + H(cpu.pc) + ': ' + op + ' ' + d.what + ', which only kernel mode may do; in user mode the CPU refuses it and raises a general-protection exception.' });
        const t = O.trap({ cause: 'exception', vector: 13, cpu, table, fault: 'the ' + op + ' instruction in user mode' });
        traps.push({ at: cpu.pc, vector: 13, cause: 'exception', outcome: t.outcome }); sub(t, cpu.pc);
        if (t.outcome === 'kill') { killed = { pc: cpu.pc, op, vector: 13 }; break; }
        Object.assign(cpu, { pc: t.cpu.pc + 1, sp: t.cpu.sp, IF: t.cpu.IF, mode: t.cpu.mode, regs: t.cpu.regs });
        continue;
      }
      if (op === 'div' && !cpu.regs[args[1] || 'r1']) {
        steps.push({ kind: 'fault', op, pc: cpu.pc, mode: cpu.mode, say: 'PC ' + H(cpu.pc) + ': div by ' + (args[1] || 'r1') + ' = 0 cannot complete.' });
        const t = O.trap({ cause: 'exception', vector: 0, cpu, table, fault: 'division by zero' });
        traps.push({ at: cpu.pc, vector: 0, cause: 'exception', outcome: t.outcome }); sub(t, cpu.pc);
        if (t.outcome === 'kill') { killed = { pc: cpu.pc, op, vector: 0 }; break; }
        Object.assign(cpu, { pc: t.cpu.pc + 1, sp: t.cpu.sp, IF: t.cpu.IF, mode: t.cpu.mode, regs: t.cpu.regs });
        continue;
      }
      if (op === 'syscall') {
        const t = O.trap({ cause: 'syscall', vector: 128, cpu, table, result: ins.result === undefined ? 0 : ins.result });
        traps.push({ at: cpu.pc, vector: 128, cause: 'syscall', outcome: t.outcome }); sub(t, cpu.pc);
        Object.assign(cpu, { pc: t.cpu.pc, sp: t.cpu.sp, IF: t.cpu.IF, mode: t.cpu.mode, regs: t.cpu.regs });
        continue;
      }
      // ordinary effects, enough to show the state changing
      if (op === 'add') cpu.regs[args[0] || 'r0'] = (cpu.regs[args[0] || 'r0'] || 0) + (cpu.regs[args[1] || 'r1'] || 0);
      if (op === 'div') cpu.regs[args[0] || 'r0'] = Math.trunc((cpu.regs[args[0] || 'r0'] || 0) / cpu.regs[args[1] || 'r1']);
      if (op === 'load') cpu.regs[args[0] || 'r0'] = args[1] === undefined ? 0 : args[1];
      if (op === 'cli') cpu.IF = false;
      if (op === 'sti') cpu.IF = true;
      steps.push({ kind: 'exec', op, pc: cpu.pc, mode: cpu.mode, IF: cpu.IF, regs: Object.assign({}, cpu.regs), say: 'PC ' + H(cpu.pc) + ' in ' + cpu.mode + ' mode: ' + op + ' ' + d.what + (d.priv ? ', allowed because the mode bit says kernel' : '') + '.' });
      if (op === 'jmp') { cpu.pc = args[0] === undefined ? cpu.pc + 1 : args[0]; continue; }
      if (op === 'hlt') break;
      cpu.pc++;
    }
    if (executed >= max) steps.push({ kind: 'limit', say: 'Stopped after ' + O.plural(max, 'instruction') + '.' });
    return { steps, cpu, executed, traps, killed };
  };

  (S.engines = S.engines || []).push({ name: 'Modes, traps and system calls' });
})(globalThis.Proses = globalThis.Proses || {});
