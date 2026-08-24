// Part 1, user and kernel mode: a toy program runs instruction by instruction on a CPU whose mode bit decides
// what it may do. The privileged instructions (cli, hlt, in, out, lcr3, settimer...) run only in kernel mode; in
// user mode the CPU refuses them and traps to the kernel, which ends the program. The listing, the CPU's mode bit,
// PC, interrupt flag and registers, and the traps so far are drawn; every value comes from S.Os.run.
(function (S) {
  'use strict';
  const H = S.PX;
  const O = () => S.Os;

  /** "load r0 7; add r0 r1; cli" -> [{op, args}] or an error sentence */
  function parse(text) {
    const lines = String(text).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return 'Program: at least one instruction';
    if (lines.length > 9) return 'Program: at most 9 instructions, so the listing fits';
    return lines.map((l) => {
      const w = l.split(/[\s,]+/);
      const args = w.slice(1).map((a) => (/^-?\d+$/.test(a) ? Number(a) : a));
      return { op: w[0].toLowerCase(), args };
    });
  }
  const show = (ins) => ins.op + (ins.args && ins.args.length ? ' ' + ins.args.join(', ') : '');
  const REGS = ['r0', 'r1', 'r2', 'r3'];
  H.modesParse = parse;

  S.topic({
    id: 'p01-modes', family: 'p01-modes', order: 10, title: 'User mode, kernel mode and privileged instructions',
    blurb: 'The CPU carries one bit that says who is running: the kernel or a user program. Most instructions work in either mode. A few could take over the machine (turn interrupts off, halt, talk to a device, change the page table or the timer), so the CPU runs them only when the bit says kernel. In user mode it refuses them and traps to the kernel, which ends the program that tried.',
    inputs: [
      { id: 'prog', kind: 'text', label: 'Program (one instruction per line or after a semicolon)', def: 'load r0 7; load r1 5; add r0 r1; cli; store r0', check: (v) => { const r = parse(v); return typeof r === 'string' ? r : null; } },
      { id: 'mode', kind: 'choice', label: 'Mode it starts in', def: 'user', options: [{ value: 'user', label: 'user mode (an ordinary program)' }, { value: 'kernel', label: 'kernel mode (kernel code)' }] },
      { id: 'irq', kind: 'number', label: 'Timer interrupt after instruction (0: none)', def: 0, min: 0, max: 8 },
    ],
    presets: [
      { label: 'cli in user mode', values: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'user', irq: 0 } },
      { label: 'The same code in kernel mode', values: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'kernel', irq: 0 } },
      { label: 'An ordinary program, interrupted', values: { prog: 'load r0 40; load r1 2; add r0 r1; store r0; load r2 1', mode: 'user', irq: 2 } },
      { label: 'Writing to a device from user mode', values: { prog: 'load r0 65; out r0; load r1 1', mode: 'user', irq: 0 } },
      { label: 'Changing the page table', values: { prog: 'load r0 48; lcr3 r0; load r1 1', mode: 'user', irq: 0 } },
      { label: 'Divide by zero', values: { prog: 'load r0 9; load r1 0; div r0 r1; store r0', mode: 'user', irq: 0 } },
      { label: 'An instruction that does not exist', values: { prog: 'load r0 3; fly r0; load r1 4', mode: 'user', irq: 0 } },
      { label: 'Kernel code turns interrupts off and on', values: { prog: 'cli; load r0 1; store r0; sti; load r1 2', mode: 'kernel', irq: 1 } },
    ],
    counters: [{ id: 'exec', label: 'instructions run' }, { id: 'traps', label: 'traps' }],
    run(inp) {
      const prog = parse(inp.prog);
      const r = O().run(prog, { mode: inp.mode, interrupts: inp.irq ? [{ at: inp.irq, vector: 32 }] : [] });
      const F = new S.Frames(['exec', 'traps']);
      const L = { x: 0, y: 30, w: 360, rowH: 32 }, C = { x: 400, y: 30 }, NW = 96, VW = 104;
      const base = [H.title('lt', 0, 14, 'program'), H.title('ct', C.x, 14, 'the CPU')];
      const ran = new Map();
      let prevRegs = { r0: 0, r1: 0, r2: 0, r3: 0 }, nexec = 0;
      const trapLog = [];
      let cpu = { mode: inp.mode, pc: 0, IF: true, regs: Object.assign({}, prevRegs) };
      r.steps.forEach((s, i) => {
        const inTrap = s.phase === 'trap';
        if (s.kind === 'exec') { nexec++; ran.set(s.pc, 'ok'); }
        if (s.kind === 'privileged' || s.kind === 'fault') ran.set(s.pc, 'bad');
        if (s.kind === 'raise') trapLog.push({ at: s.at, vector: s.vector, cause: s.cause, out: null });
        if (s.kind === 'kill' || s.kind === 'return') trapLog[trapLog.length - 1].out = s.kind === 'kill' ? 'ended' : 'resumed';
        if (s.kind === 'dispatch' && inTrap) trapLog[trapLog.length - 1].handler = s.handler;
        if (s.kind === 'kill' && trapLog.length) { const lt = trapLog[trapLog.length - 1]; if (lt.vector !== 32) ran.set(lt.at, 'bad'); }
        F.set('exec', nexec).set('traps', trapLog.length);
        // the CPU as this step leaves it
        if (s.mode) cpu.mode = s.mode;
        if (s.regs) cpu.regs = Object.assign({}, s.regs);
        if (s.IF !== undefined) cpu.IF = s.IF;
        const curPc = inTrap ? s.at : s.pc;
        const items = base.slice();
        prog.forEach((ins, k) => {
          const y = L.y + k * L.rowH, d = O().INSTR[ins.op], st = ran.get(k);
          const cls = k === curPc ? (st === 'bad' ? ' bad' : ' act') : st === 'bad' ? ' bad' : '';
          items.push(H.cell('pc' + k, L.x, y, 74, L.rowH - 4, H.hex(k), 'vec mono' + cls, { size: 13 }));
          items.push(H.cell('in' + k, L.x + 78, y, 170, L.rowH - 4, show(ins), 'vec mono' + cls, { size: 13, align: 'left' }));
          const tag = !d ? 'not an instruction' : d.priv ? 'kernel only' : '';
          if (tag) items.push(H.cell('tg' + k, L.x + 254, y + 3, !d ? 126 : 86, L.rowH - 10, tag, 'privtag' + (!d ? ' unknown' : ''), { size: 12 }));
          if (st) items.push(H.text('mk' + k, L.x - 10, y + 19, st === 'bad' ? '✗' : '✓', st === 'bad' ? 'bad' : 'good', 15, 'end'));
        });
        // the CPU panel
        const kern = cpu.mode === 'kernel';
        items.push(H.cell('mbn', C.x, C.y, NW, 30, 'mode bit', 'regname', { size: 13 }), H.cell('mb', C.x + NW + 4, C.y, NW, 30, cpu.mode, 'modebit ' + (kern ? 'kern' : 'user'), { size: 14 }));
        items.push(H.cell('pcn', C.x, C.y + 36, NW, 30, 'PC', 'regname', { size: 13 }), H.cell('pcv', C.x + NW + 4, C.y + 36, NW, 30, inTrap && s.kind !== 'raise' && s.kind !== 'return' ? 'kernel code' : H.hex(curPc), 'reg' + (inTrap && s.kind !== 'raise' && s.kind !== 'return' ? ' act' : ''), { size: 13 }));
        items.push(H.cell('ifn', C.x, C.y + 72, NW, 30, 'interrupts', 'regname', { size: 13 }), H.cell('ifv', C.x + NW + 4, C.y + 72, NW, 30, cpu.IF ? 'on' : 'off', 'reg' + (cpu.IF ? '' : ' changed'), { size: 13 }));
        REGS.forEach((g, k) => {
          const y = C.y + 118 + k * 36, v = cpu.regs[g] === undefined ? 0 : cpu.regs[g];
          items.push(H.cell('rn' + g, C.x, y, NW, 30, g, 'regname', { size: 13 }), H.cell('rv' + g, C.x + NW + 4, y, NW, 30, v, 'reg' + (v !== prevRegs[g] && s.kind === 'exec' ? ' changed' : ''), { size: 13 }));
        });
        // the traps so far
        const ty = C.y + 118 + 4 * 36 + 18;
        items.push(H.title('tt', C.x, ty, 'traps'));
        if (!trapLog.length) items.push(H.text('tn', C.x + 64, ty, 'none yet', '', 13));
        trapLog.slice(-3).forEach((t, k) => {
          const e = O().VECTORS.find((v) => v.vector === t.vector);
          const txt = 'PC ' + H.hex(t.at) + ' · ' + (e ? e.name : 'vector ' + t.vector) + (t.out ? ' → ' + t.out : '');
          items.push(H.cell('tr' + k, C.x, ty + 12 + k * 32, 330, 28, txt, 'vec' + (t.out === 'ended' ? ' bad' : t.out ? ' good' : ' act'), { size: 13, align: 'left' }));
        });
        if (s.kind === 'exec') prevRegs = Object.assign({}, cpu.regs);
        const meta = Object.assign({ phase: s.kind }, s, { kstack: undefined, regs: s.regs, nexec, ntraps: trapLog.length, nregs: 4 });
        F.add({ items, say: H.say(s.say), meta, title: inTrap ? 'trap: ' + s.kind : s.kind });
      });
      const end = r.killed ? 'The program was ended at PC ' + H.hex(r.killed.pc) + ' by ' + (O().VECTORS.find((v) => v.vector === r.killed.vector) || { name: 'a fault' }).name + ': ' + (r.executed === 1 ? '1 instruction was' : r.executed + ' instructions were') + ' started.' : 'The program ran to its end: ' + H.plural(r.executed, 'instruction') + ', ' + H.plural(r.traps.length, 'trap') + ', none fatal.';
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Kernel-only instructions', text: ['cli, sti   interrupts off, on', 'hlt        stop until an interrupt', 'in, out    device registers', 'lcr3       the page-table base', 'lidt       the trap-table base', 'settimer   the timer interrupt', 'iret       return from a trap', '', 'in user mode each one traps:', 'general protection, vector 13'].join('\n') }] };
      F.list[F.list.length - 1].say += ' ' + end;
      F.list[F.list.length - 1].meta.executed = r.executed;
      F.list[F.list.length - 1].meta.trapsTotal = r.traps.length;
      return { frames: F.list, def, result: { traps: r.traps, killed: r.killed, executed: r.executed, cpu: r.cpu } };
    },
    predict: [
      {
        at: (f, i, fr) => { const n = fr[i + 1]; return n && (n.meta.kind === 'privileged' || (n.meta.kind === 'exec' && S.Os.INSTR[n.meta.op] && S.Os.INSTR[n.meta.op].priv)); },
        pick: 'option', ask: (fr, i) => 'The next instruction is ' + fr[i + 1].meta.op + ', which only kernel mode may run, and the mode bit says ' + fr[i].meta.mode + '. What will the CPU do?',
        options: ['run it', 'refuse it and trap to the kernel'], answer: (fr, i) => (fr[i + 1].meta.kind === 'privileged' ? 'refuse it and trap to the kernel' : 'run it'), explain: (fr, i) => fr[i + 1].say,
      },
      { at: (f, i, fr) => f.meta.kind === 'handle' && fr[i + 1] && (fr[i + 1].meta.kind === 'kill' || fr[i + 1].meta.kind === 'restore'), pick: 'option', ask: 'The handler has run. Does the program get the CPU back?', options: ['yes, it carries on', 'no, it is ended'], answer: (fr, i) => (fr[i + 1].meta.kind === 'kill' ? 'no, it is ended' : 'yes, it carries on'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does the CPU refuse cli (interrupts off) in user mode?', options: ['a program with interrupts off could never be interrupted by the timer, so it could keep the CPU for ever', 'cli is slow', 'cli needs a register that user mode lacks', 'it does not: any program may run it'], answer: 0, why: 'Interrupts are how the kernel gets the CPU back; only the kernel may switch them off.' },
      { q: 'Who sets the mode bit to kernel?', options: ['the hardware, as part of a trap or interrupt', 'the program, with an ordinary instruction', 'the compiler', 'the disk'], answer: 0, why: 'If a program could set it, the protection would mean nothing; the only way in is through the trap table the kernel set up.' },
      { q: 'Which of these may an ordinary program run?', options: ['add', 'lcr3 (load the page-table base)', 'out (write a device register)', 'settimer'], answer: 0, why: 'Arithmetic touches only the program\'s own registers; the others change the machine everyone shares.' },
      { q: 'What happens to a user program that runs a privileged instruction?', options: ['a general-protection exception traps to the kernel, which ends it', 'the instruction is skipped quietly', 'the machine reboots', 'it runs, but slowly'], answer: 0, why: 'The kernel\'s handler sends the program a signal whose default action ends it.' },
      { q: 'A timer interrupt arrives between two user instructions. After the handler, where does the program go on?', options: ['at the instruction it had not yet run', 'at the start of the program', 'at the instruction after that one', 'it does not: it is ended'], answer: 0, why: 'An interrupt is unrelated to the program; the saved PC lets it carry on exactly where it was.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
