// The hardware boundary, part 3: limited direct execution and the context switch. Processes run directly on the
// CPU in user mode; the OS gets the CPU back only through a trap: a system call, an exit, or the timer interrupt it
// programmed at boot. Without the timer, a process that never makes a system call keeps the CPU for ever.
//   S.Os.lde({procs: [{name, work, syscalls?: [local tick..], loop?}], quantum, timer: true, switchCost: 0,
//            maxTicks: 60})
//       -> {steps, segs: [{who, start, end, mode}], switches, timerInterrupts, syscalls, finish: {name: t}, end,
//           stuck: name | null}
//       work: CPU ticks the process needs; syscalls: after which of its own ticks it makes a system call (with the
//       timer the OS returns to the caller; without it the OS takes the chance to switch, cooperatively);
//       loop: true runs for ever and never makes a system call. switchCost: kernel ticks per context switch.
//   S.Os.contextSwitch({from, to, sameSpace?: false, asid?: false})
//       from/to: {name, pc, sp, regs: {a0, a1}, ksp} (defaults supplied)
//       -> {steps, cost: {saved, restored, pageTable, tlbFlush}}; every step carries {cpu, procs} snapshots:
//       cpu {mode, pc, sp, regs, ptbr}, procs {name: {state, kstack: [{name, value}], context}}
(function (S) {
  'use strict';
  const O = (S.Os = S.Os || {});

  O.lde = function (o) {
    o = o || {};
    const q = Math.max(1, o.quantum || 3), timer = o.timer !== false, cost = Math.max(0, o.switchCost || 0), max = o.maxTicks || 60;
    const procs = (o.procs || [{ name: 'A', work: 5 }, { name: 'B', work: 4, syscalls: [2] }]).map((p, i) => ({
      name: p.name || String.fromCharCode(65 + i), left: p.loop ? Infinity : Math.max(1, p.work || 1), done: 0, sys: new Set(p.syscalls || []), loop: !!p.loop,
    }));
    const steps = [], segs = [], finish = {};
    let t = 0, switches = 0, timerInterrupts = 0, syscalls = 0, stuck = null, nextTimer = q;
    const ready = procs.map((p) => p.name), by = Object.fromEntries(procs.map((p) => [p.name, p]));
    const seg = (who, start, end, mode) => { if (end > start) { const last = segs[segs.length - 1]; if (last && last.who === who && last.mode === mode && last.end === start) last.end = end; else segs.push({ who, start, end, mode }); } };
    const add = (kind, say, data) => steps.push(Object.assign({ kind, say, t, ready: ready.slice() }, data || {}));
    add('boot', 'At boot the kernel, in kernel mode, installs its trap table' + (timer ? ' and programs the timer to interrupt every ' + O.plural(q, 'tick') : ' but starts no timer') + '.', { mode: 'kernel' });
    let cur = ready.shift();
    add('start', 'The kernel sets up ' + cur + '\'s registers and stack and runs return-from-trap: ' + cur + ' starts in user mode, straight on the CPU.', { run: cur, mode: 'user' });
    const kernelTime = (why) => { if (cost) { seg('OS', t, t + cost, 'kernel'); t += cost; if (timer) while (nextTimer <= t) nextTimer += q; } return why; };
    const switchTo = (why) => {
      const prev = cur;
      cur = ready.shift() || null;
      if (cur && cur !== prev) {
        switches++;
        kernelTime();
        add('switch', why + ': the kernel saves ' + prev + '\'s registers in its process entry, loads ' + cur + '\'s, and return-from-trap resumes ' + cur + ' in user mode' + (cost ? ' (' + cost + ' tick' + (cost > 1 ? 's' : '') + ' of kernel time)' : '') + '.', { from: prev, run: cur, mode: 'user' });
      } else if (cur) add('resume', why + ': no one else is ready, so the kernel returns to ' + cur + '.', { run: cur, mode: 'user' });
    };
    let runStart = t;
    while (cur && t < max) {
      const p = by[cur];
      // one tick of direct execution
      seg(cur, t, t + 1, 'user'); t++; p.done++; if (p.left !== Infinity) p.left--;
      const endRun = (why) => { add('run', cur + ' ran directly on the CPU in user mode from t = ' + runStart + ' to t = ' + t + ', with no help from the kernel, until ' + why + '.', { run: cur, from: runStart, to: t, mode: 'user' }); };
      if (p.left === 0) {
        endRun('it called exit');
        finish[cur] = t; syscalls++;
        add('exit', cur + ' calls exit at t = ' + t + ': a trap hands the CPU back, and the kernel frees ' + cur + '.', { run: cur, mode: 'kernel' });
        const i = ready.indexOf(cur); if (i >= 0) ready.splice(i, 1);
        // a timer tick due at this same moment is used up by the exit's trap, so the next one stays on the beat
        if (timer) while (nextTimer <= t) nextTimer += q;
        switchTo('The kernel picks the next process');
        runStart = t; continue;
      }
      if (p.sys.has(p.done)) {
        endRun('it made a system call'); syscalls++;
        if (timer) {
          add('syscall', cur + ' makes a system call at t = ' + t + ': the kernel does the work and returns to ' + cur + '; the timer, not this call, decides when ' + cur + ' stops.', { run: cur, mode: 'kernel' });
        } else {
          add('syscall', cur + ' makes a system call at t = ' + t + ': the kernel has the CPU again, its only chance in a cooperative system, and moves ' + cur + ' to the back of the queue.', { run: cur, mode: 'kernel' });
          ready.push(cur); switchTo('Cooperative switch');
        }
        runStart = t; continue;
      }
      if (timer && t >= nextTimer) {
        endRun('the timer went off');
        timerInterrupts++;
        while (nextTimer <= t) nextTimer += q;
        add('timer', 'The timer interrupts ' + cur + ' at t = ' + t + ': the hardware saves its user registers on its kernel stack and jumps to the kernel\'s timer handler.', { run: cur, mode: 'kernel' });
        ready.push(cur); switchTo('The scheduler moves ' + cur + ' to the back of the queue');
        runStart = t; continue;
      }
    }
    if (cur && t >= max) {
      stuck = by[cur].loop && !timer ? cur : null;
      add('limit', stuck ? cur + ' has run from t = ' + runStart + ' to t = ' + t + ' and will never make a system call: with no timer the kernel never runs again, and only a reboot takes the CPU back.' : 'Stopped at t = ' + t + ' (the limit), with ' + cur + ' running.', { run: cur, stuck });
    } else add('end', 'Every process has finished by t = ' + t + ', after ' + O.plural(switches, 'context switch', 'context switches') + ' and ' + O.plural(timerInterrupts, 'timer interrupt') + '.');
    return { steps, segs, switches, timerInterrupts, syscalls, finish, end: t, stuck };
  };

  O.contextSwitch = function (o) {
    o = o || {};
    const H = (n) => O.hex(n);
    const A = Object.assign({ name: 'A', pc: 0x1040, sp: 0x7f80, regs: { a0: 7, a1: 42 }, ksp: 0x9000, ptbr: 0x30 }, o.from || {});
    const B = Object.assign({ name: 'B', pc: 0x2210, sp: 0x6fc0, regs: { a0: 3, a1: 99 }, ksp: 0xa000, ptbr: 0x58 }, o.to || {});
    if (o.sameSpace) B.ptbr = A.ptbr;
    const uregs = ['pc', 'sp'].concat(Object.keys(A.regs));
    const kctx = ['ra', 'sp', 's0', 's1'];
    const cpu = { mode: 'user', pc: A.pc, sp: A.sp, regs: Object.assign({}, A.regs, { ra: 0, s0: 0x11, s1: 0x22 }), ptbr: A.ptbr };
    // B was switched out earlier: its kernel stack holds its trap frame, its process entry its kernel context
    const bFrame = uregs.map((r) => ({ name: 'user ' + r, value: r === 'pc' ? B.pc : r === 'sp' ? B.sp : B.regs[r] }));
    const procs = {
      [A.name]: { state: 'running', kstack: [], context: null },
      [B.name]: { state: 'ready', kstack: bFrame, context: { ra: 0xc3a0, sp: B.ksp - 4 * bFrame.length, s0: 0x55, s1: 0x66 } },
    };
    const steps = [];
    const snap = () => ({ cpu: { mode: cpu.mode, pc: cpu.pc, sp: cpu.sp, regs: Object.assign({}, cpu.regs), ptbr: cpu.ptbr }, procs: JSON.parse(JSON.stringify(procs)) });
    const add = (kind, say) => steps.push(Object.assign({ kind, say }, snap()));
    add('user', A.name + ' runs in user mode at PC ' + H(A.pc) + ' with SP ' + H(A.sp) + ', a0 = ' + A.regs.a0 + ', a1 = ' + A.regs.a1 + '.');
    cpu.mode = 'kernel'; cpu.sp = A.ksp;
    for (const r of uregs) { cpu.sp -= 4; procs[A.name].kstack.push({ name: 'user ' + r, value: r === 'pc' ? A.pc : r === 'sp' ? A.sp : A.regs[r] }); }
    cpu.pc = 0xc200;
    add('trap', 'The timer interrupts ' + A.name + ': the hardware and the trap entry save its ' + uregs.length + ' user registers (' + uregs.join(', ') + ') as a trap frame on ' + A.name + '\'s kernel stack; SP = ' + H(cpu.sp) + '.');
    procs[A.name].state = 'ready';
    cpu.regs.ra = 0xc240;
    add('sched', 'The timer handler finds ' + A.name + '\'s time slice used up, marks it ready and calls switch(' + A.name + ', ' + B.name + '), which will return to ' + H(cpu.regs.ra) + ' when ' + A.name + ' runs again.');
    procs[A.name].context = { ra: cpu.regs.ra, sp: cpu.sp, s0: cpu.regs.s0, s1: cpu.regs.s1 };
    add('save', 'switch saves ' + A.name + '\'s kernel context, ' + kctx.join(', ') + ', into ' + A.name + '\'s process entry: ' + A.name + ' is now frozen mid-call, with SP ' + H(cpu.sp) + '.');
    const c = procs[B.name].context;
    cpu.regs.ra = c.ra; cpu.sp = c.sp; cpu.regs.s0 = c.s0; cpu.regs.s1 = c.s1;
    add('load', 'switch loads ' + B.name + '\'s saved context: SP jumps to ' + B.name + '\'s kernel stack at ' + H(c.sp) + ' and ra = ' + H(c.ra) + '. From here on the CPU is running ' + B.name + '.');
    const flush = B.ptbr !== A.ptbr && !o.asid;
    if (B.ptbr !== A.ptbr) { cpu.ptbr = B.ptbr; add('space', 'The page-table base register changes from frame ' + O.hex(A.ptbr, 2) + ' to ' + B.name + '\'s frame ' + O.hex(B.ptbr, 2) + (flush ? ', and the TLB is flushed: its translations belonged to ' + A.name + '.' : '; the TLB keeps its entries, tagged with address-space ids.')); }
    procs[B.name].state = 'running';
    cpu.pc = c.ra;
    add('ret', 'switch returns to ' + H(c.ra) + ', where ' + B.name + ' once called it, and ' + B.name + '\'s own trap handler unwinds back to its trap frame.');
    for (const r of uregs.slice().reverse()) {
      const x = procs[B.name].kstack.pop(); const name = x.name.slice(5);
      if (name === 'pc') cpu.pc = x.value; else if (name === 'sp') cpu.sp = x.value; else cpu.regs[name] = x.value;
    }
    cpu.mode = 'user';
    add('return', 'Return-from-trap pops ' + B.name + '\'s trap frame: user mode, PC ' + H(B.pc) + ', SP ' + H(B.sp) + ', a0 = ' + B.regs.a0 + ', a1 = ' + B.regs.a1 + '. ' + B.name + ' carries on as if nothing happened.');
    const costv = { saved: uregs.length + kctx.length, restored: uregs.length + kctx.length, pageTable: B.ptbr !== A.ptbr, tlbFlush: flush };
    steps.push(Object.assign({ kind: 'cost', say: 'The switch saved ' + costv.saved + ' registers and restored ' + costv.restored + (costv.pageTable ? ', changed the page table' + (flush ? ' and flushed the TLB, so ' + B.name + ' starts with cold translations' : '') : ', and kept the page table (threads of one process)') + '.', cost: costv }, snap()));
    return { steps, cost: costv };
  };
})(globalThis.Proses = globalThis.Proses || {});
