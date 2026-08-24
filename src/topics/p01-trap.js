// Part 1, one trap end to end: an interrupt, an exception or a system call takes the same path into the kernel.
// The hardware sets the mode bit, switches to the kernel stack and saves the user SP, flags and PC; the entry code
// saves the registers (the trap frame); the trap table picks the handler; the handler runs; the registers come
// back and return-from-trap resumes the program (or the kernel ends it). The CPU's registers, the kernel stack
// growing word by word and the trap table are drawn from S.Os.trap's snapshots.
(function (S) {
  'use strict';
  const H = S.PX;
  const O = () => S.Os;
  const CAUSES = [{ value: 'interrupt', label: 'an interrupt (a device)' }, { value: 'exception', label: 'an exception (the instruction failed)' }, { value: 'syscall', label: 'a system call (on purpose)' }];
  const VEC = { interrupt: [32, 33, 46], exception: [14, 13, 0, 6], syscall: [128] };

  S.topic({
    id: 'p01-trap', family: 'p01-traps', order: 10, title: 'A trap, step by step',
    blurb: 'Interrupts, exceptions and system calls differ in why they happen, but the CPU handles them all the same way. It sets the mode bit to kernel, moves to the kernel\'s own stack, saves where the program was, and jumps to the handler that the trap table names for that vector. When the handler is done, return-from-trap restores what was saved and the program carries on, unless the handler decided it should not.',
    inputs: [
      { id: 'cause', kind: 'choice', label: 'What happens', def: 'syscall', options: CAUSES },
      { id: 'vector', kind: 'choice', label: 'Vector', def: '128', options: [32, 33, 46, 14, 13, 0, 6, 128].map((v) => ({ value: String(v), label: v + ': ' + S.Os.VECTORS.find((e) => e.vector === v).name })), check: (v, inp) => (VEC[inp.cause].includes(Number(v)) ? null : 'Vector: ' + v + ' is not ' + (inp.cause === 'interrupt' ? 'an interrupt' : inp.cause === 'exception' ? 'an exception' : 'the system-call entry') + '; choose one of ' + VEC[inp.cause].join(', ')) },
      { id: 'pc', kind: 'number', label: 'User PC (decimal)', def: 4100, min: 4096, max: 8191 },
      { id: 'r0', kind: 'number', label: 'r0 (a system call\'s number)', def: 39, min: 0, max: 999 },
      { id: 'result', kind: 'number', label: 'The call\'s result', def: 100, min: -999, max: 99999 },
      { id: 'mode', kind: 'choice', label: 'Mode when it happens', def: 'user', options: [{ value: 'user', label: 'user' }, { value: 'kernel', label: 'kernel (a trap inside the kernel)' }] },
    ],
    presets: [
      { label: 'getpid: a system call', values: { cause: 'syscall', vector: '128', pc: 4100, r0: 39, result: 100, mode: 'user' } },
      { label: 'The timer interrupts a program', values: { cause: 'interrupt', vector: '32', pc: 4200, r0: 7, result: 0, mode: 'user' } },
      { label: 'A key is pressed', values: { cause: 'interrupt', vector: '33', pc: 4310, r0: 3, result: 0, mode: 'user' } },
      { label: 'A page fault: the instruction runs again', values: { cause: 'exception', vector: '14', pc: 4404, r0: 12, result: 0, mode: 'user' } },
      { label: 'Division by zero ends the program', values: { cause: 'exception', vector: '0', pc: 4500, r0: 9, result: 0, mode: 'user' } },
      { label: 'A disk interrupt during kernel code', values: { cause: 'interrupt', vector: '46', pc: 4600, r0: 1, result: 0, mode: 'kernel' } },
    ],
    counters: [{ id: 'words', label: 'words on the kernel stack' }],
    run(inp) {
      const vector = Number(inp.vector);
      const cpu0 = O().cpu({ mode: inp.mode, pc: inp.pc, sp: inp.mode === 'kernel' ? 0x8f00 : 0x7ff0, regs: { r0: inp.r0, r1: 12, r2: 0, r3: 5 } });
      const t = O().trap({ cause: inp.cause, vector, cpu: cpu0, result: inp.result, kstack: 0x9000 });
      const table = O().table();
      const F = new S.Frames(['words']);
      const C = { x: 0, y: 30 }, K = { x: 260, y: 30, w: 250 }, T = { x: 560, y: 30 };
      const base = [H.title('ct', C.x, 14, 'the CPU'), H.title('kt', K.x, 14, 'kernel stack, growing down'), H.title('tt', T.x, 14, 'trap table')];
      const maxWords = 7;
      let prev = { mode: cpu0.mode, pc: cpu0.pc, sp: cpu0.sp, IF: cpu0.IF, regs: Object.assign({}, cpu0.regs) }, prevLen = 0, dispatched = null;
      t.steps.forEach((s, i) => {
        const items = base.slice();
        if (s.kind === 'dispatch') dispatched = s.vector;
        if (s.kind === 'restore' || s.kind === 'return' || s.kind === 'kill') { /* the entry stays lit */ }
        const kern = s.mode === 'kernel';
        const inKernelCode = s.pc >= 0xc000;
        const rows = [['mode', s.mode, 'modebit ' + (kern ? 'kern' : 'user'), s.mode !== prev.mode], ['PC', inKernelCode ? H.hex(s.pc) + ' (kernel)' : H.hex(s.pc), 'reg', s.pc !== prev.pc], ['SP', H.hex(s.sp), 'reg', s.sp !== prev.sp], ['interrupts', s.IF ? 'on' : 'off', 'reg', s.IF !== prev.IF]];
        for (const r of Object.keys(s.regs)) rows.push([r, String(s.regs[r]), 'reg', s.regs[r] !== prev.regs[r]]);
        rows.forEach((r, k) => {
          const y = C.y + k * 34;
          items.push(H.cell('cn' + k, C.x, y, 90, 30, r[0], 'regname', { size: 13 }));
          items.push(H.cell('cv' + k, C.x + 94, y, 128, 30, r[1], r[2] + (r[3] && r[0] !== 'mode' ? ' changed' : ''), { size: 13 }));
        });
        // the kernel stack, the top first; each word with its address
        for (let k = 0; k < maxWords; k++) {
          const y = K.y + k * 34, w = s.kstack[k], addr = 0x9000 - 4 * (k + 1);
          items.push(H.text('ka' + k, K.x + 62, y + 20, H.hex(addr), 'mono', 13, 'end'));
          items.push(H.cell('ks' + k, K.x + 70, y, K.w - 70, 30, w ? w.name + ' = ' + (w.name === 'pc' || w.name === 'user sp' ? H.hex(w.value) : w.value) : '', 'kslot' + (w ? (k >= prevLen ? ' new' : '') : ' empty'), { size: 13 }));
        }
        if (s.kstack.length) {
          const spY = K.y + (s.kstack.length - 1) * 34 + 20;
          items.push(H.text('ksp', K.x + K.w + 6, spY, '◀ SP', 'act', 14));
        }
        // the trap table
        table.forEach((e, k) => {
          const y = T.y + k * 34, lit = e.vector === dispatched;
          items.push(H.cell('tv' + k, T.x, y, 46, 30, e.vector, 'vec mono' + (lit ? ' act' : ''), { size: 13 }));
          items.push(H.cell('th' + k, T.x + 50, y, 196, 30, e.handler, 'vec mono' + (lit ? ' act' : ''), { size: 13 }));
        });
        const meta = { phase: s.kind, kind: s.kind, vector, words: s.kstack.length, regs: s.regs, kstack: s.kstack, nregs: Object.keys(s.regs).length, result: inp.result, r0: inp.r0 };
        F.set('words', s.kstack.length);
        F.add({ items, say: H.say(s.say), meta, title: s.kind });
        prev = { mode: s.mode, pc: s.pc, sp: s.sp, IF: s.IF, regs: Object.assign({}, s.regs) };
        prevLen = s.kstack.length;
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The trap frame', text: ['pushed by the hardware:', '  user SP, flags, PC', 'pushed by the entry code:', '  r0, r1, r2, r3', '', 'the PC saved is', '  the next instruction (call, interrupt)', '  the same one (a fault to retry)', 'return-from-trap pops them back'].join('\n') }] };
      return { frames: F.list, def, result: { outcome: t.outcome, resumePc: t.resumePc, cpu: t.cpu, handler: t.handler } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.kind === 'dispatch', pick: 'item', ask: 'The trap frame is saved. Click the trap-table entry the hardware will jump through.', answer: (fr, i) => { const k = S.Os.table().findIndex((e) => e.vector === fr[i + 1].meta.vector); return ['th' + k, 'tv' + k]; }, explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => f.meta.kind === 'handle', pick: 'option', ask: 'Where will the program carry on?', options: ['at the next instruction', 'at the same instruction, run again', 'nowhere: it is ended'], answer: (fr, i, inp) => { const n = fr.find((x) => x.meta.kind === 'return' || x.meta.kind === 'kill'); return n.meta.kind === 'kill' ? 'nowhere: it is ended' : /same instruction|not yet run/.test(n.say) && !/next instruction/.test(n.say) ? 'at the same instruction, run again' : 'at the next instruction'; }, explain: (fr) => fr.find((x) => x.meta.kind === 'return' || x.meta.kind === 'kill').say },
    ],
    quiz: [
      { q: 'Why does the CPU switch to a kernel stack instead of pushing onto the program\'s own stack?', options: ['the program\'s SP could point anywhere, even at memory the kernel must not trust or touch', 'the user stack is too slow', 'to save memory', 'it does not switch'], answer: 0, why: 'The kernel needs a stack it controls; the user SP is saved and restored like any other register.' },
      { q: 'What does the trap table hold?', options: ['for each vector, the address of its handler, set by the kernel at boot', 'the program\'s saved registers', 'the list of running processes', 'the system-call results'], answer: 0, why: 'Programs cannot choose where the kernel is entered: only through the table the kernel set up.' },
      { q: 'A page fault returns to the same PC; a system call returns to the next one. Why?', options: ['the faulting instruction did not complete and must run again; the syscall instruction did', 'page faults are slower', 'by accident', 'system calls cannot return'], answer: 0, why: 'The handler fixed what was missing; re-running the instruction now succeeds.' },
      { q: 'How does a system call give its result back to the program?', options: ['the handler writes it into the saved r0 in the trap frame, which return-from-trap restores', 'it prints it', 'it writes it into the program\'s stack directly', 'through a global variable'], answer: 0, why: 'The registers come back from the frame, so changing the saved r0 changes what the program sees.' },
      { q: 'Why are interrupts turned off while the hardware saves the state of an interrupt?', options: ['so a second interrupt cannot arrive halfway through the save', 'to save power', 'so the program can finish', 'they are not'], answer: 0, why: 'The kernel turns them back on once the frame is complete and safe.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
