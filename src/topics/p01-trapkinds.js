// Part 1, interrupts, exceptions and system calls side by side: one program runs, devices interrupt it between
// instructions, it makes a system call on purpose, and an instruction may fail. The instruction stream is drawn
// as a row of cells with each trap dropping into a kernel lane under it, and a table fills in: where the trap
// came from, whether it was synchronous, what the handler did and where the program carried on. From S.Os.run.
(function (S) {
  'use strict';
  const H = S.PX;
  const O = () => S.Os;
  const KEEP = new Set(['exec', 'privileged', 'fault', 'raise', 'handle', 'return', 'kill']);
  const CAUSE = { interrupt: 'interrupt', exception: 'exception', syscall: 'system call' };

  S.topic({
    id: 'p01-trapkinds', family: 'p01-traps', order: 20, title: 'Interrupts, exceptions and system calls compared',
    blurb: 'Three things stop a program and run the kernel. An interrupt comes from a device, at any moment, for reasons unrelated to the instruction running (asynchronous). An exception is the instruction itself failing: a division by zero, a forbidden instruction, a missing page. A system call is the program asking on purpose. The last two are synchronous: they happen at the same instruction every time the program runs.',
    inputs: [
      { id: 'prog', kind: 'text', label: 'Program', def: 'load r0 7; load r1 2; syscall; add r0 r1; load r1 0; div r0 r1; store r0', check: (v) => { const r = H.modesParse(v); return typeof r === 'string' ? r : null; } },
      { id: 'irqs', kind: 'text', label: 'Interrupts after instruction (a list)', def: '1, 4', check: (v) => (String(v).trim() === '' || /^\s*\d\s*(,\s*\d\s*)*$/.test(v) ? (String(v).split(',').filter((x) => x.trim()).length > 4 ? 'Interrupts: at most 4' : null) : 'Interrupts: numbers from 0 to 9, separated by commas') },
      { id: 'dev', kind: 'choice', label: 'Interrupting device', def: '32', options: [{ value: '32', label: 'timer (32)' }, { value: '33', label: 'keyboard (33)' }, { value: '46', label: 'disk (46)' }] },
    ],
    presets: [
      { label: 'All three kinds in one run', values: { prog: 'load r0 7; load r1 2; syscall; add r0 r1; load r1 0; div r0 r1; store r0', irqs: '1, 4', dev: '32' } },
      { label: 'Interrupts only: the program never notices', values: { prog: 'load r0 1; load r1 2; add r0 r1; add r0 r1; store r0', irqs: '1, 2, 4', dev: '33' } },
      { label: 'Two system calls', values: { prog: 'load r0 39; syscall; load r0 1; syscall; store r0', irqs: '', dev: '32' } },
      { label: 'A forbidden instruction', values: { prog: 'load r0 5; hlt; store r0', irqs: '1', dev: '46' } },
      { label: 'An instruction that does not exist', values: { prog: 'load r0 5; jump r0; store r0', irqs: '', dev: '32' } },
    ],
    counters: [{ id: 'async', label: 'asynchronous traps' }, { id: 'sync', label: 'synchronous traps' }],
    run(inp) {
      const prog = H.modesParse(inp.prog), dev = Number(inp.dev);
      const at = String(inp.irqs).split(',').map((x) => x.trim()).filter(Boolean).map(Number);
      const r = O().run(prog, { mode: 'user', interrupts: at.map((a) => ({ at: a, vector: dev })) });
      const F = new S.Frames(['async', 'sync']);
      // the order things happened in: instructions and traps, as columns
      const cols = [];
      let trapNo = -1;
      for (const s of r.steps) {
        if (s.kind === 'exec' || s.kind === 'privileged' || s.kind === 'fault') { if (!(s.kind === 'exec' && cols.length && cols[cols.length - 1].type === 'ins' && cols[cols.length - 1].pc === s.pc && cols[cols.length - 1].bad)) cols.push({ type: 'ins', pc: s.pc, op: prog[s.pc] ? prog[s.pc].op : '?', bad: s.kind !== 'exec' }); }
        if (s.kind === 'raise' && s.cause === 'syscall') cols.push({ type: 'ins', pc: s.at, op: 'syscall', bad: false });
        if (s.kind === 'raise') { trapNo++; cols.push({ type: 'trap', n: trapNo, cause: s.cause, vector: s.vector, pc: s.at }); }
      }
      const CW = 62, X0 = 110, iy = 50, ky = 130, W = X0 + cols.length * CW;
      const tbY = 200;
      const traps = [];
      let colUpTo = -1, trapIdx = -1, nA = 0, nS = 0;
      const base = [H.title('t1', 0, 14, 'what the CPU did, in order'), H.text('lu', 0, iy + 20, 'user', 'userlbl', 14), H.text('lk', 0, ky + 20, 'kernel', 'boundary', 14)];
      r.steps.forEach((s) => {
        if (!KEEP.has(s.kind)) return;
        if (s.kind === 'exec' || s.kind === 'privileged' || s.kind === 'fault') colUpTo = cols.findIndex((c, k) => k > colUpTo && c.type === 'ins' && c.pc === s.pc);
        if (s.kind === 'raise') {
          trapIdx++; colUpTo = cols.findIndex((c) => c.type === 'trap' && c.n === trapIdx);
          const e = O().VECTORS.find((v) => v.vector === s.vector);
          traps.push({ cause: s.cause, vector: s.vector, name: e ? e.name : 'vector ' + s.vector, pc: s.at, handler: e ? e.handler : '', out: null });
          if (s.cause === 'interrupt') nA++; else nS++;
        }
        if (s.kind === 'return') { const t = traps[traps.length - 1]; t.out = 'PC ' + H.hex(s.pc); t.retry = s.pc === t.pc && t.cause !== 'interrupt'; }
        if (s.kind === 'kill') traps[traps.length - 1].out = 'ended';
        F.set('async', nA).set('sync', nS);
        const items = base.slice();
        cols.forEach((c, k) => {
          if (k > colUpTo) return;
          const x = X0 + k * CW, cur = k === colUpTo;
          if (c.type === 'ins') items.push(H.cell('c' + k, x, iy, CW - 6, 30, c.op, 'vec mono' + (c.bad ? ' bad' : cur ? ' act' : ''), { size: 13 }));
          else {
            items.push(H.cell('c' + k, x, ky, CW - 6, 30, String(c.vector), 'trapcell ' + c.cause + (cur ? ' act' : ''), { size: 13 }));
            items.push({ key: 'cl' + k, kind: 'line', x1: x + (CW - 6) / 2, y1: iy + 34, x2: x + (CW - 6) / 2, y2: ky - 4, cls: 'trapline' + (cur ? ' act' : ''), audit: 'ignore', layer: 'back' });
          }
        });
        // the table
        const tcols = [{ w: 34, label: '#' }, { w: 78, label: 'at PC' }, { w: 120, label: 'kind' }, { w: 70, label: 'timing' }, { w: 150, label: 'what' }, { w: 120, label: 'carries on' }];
        const rows = traps.map((t, k) => [String(k + 1), H.hex(t.pc), { text: CAUSE[t.cause], cls: 'kind-' + t.cause }, t.cause === 'interrupt' ? 'async' : 'sync', t.name, { text: t.out === null ? '…' : t.out === 'ended' ? 'never: ended' : t.out + (t.retry ? ' (again)' : ''), cls: t.out === 'ended' ? 'bad' : '' }]);
        if (rows.length) items.push(...H.table({ prefix: 'tb', x: 0, y: tbY, cols: tcols, rows, rowH: 28, size: 13 }).items);
        else items.push(H.text('tbn', 0, tbY + 18, 'no traps yet', '', 13));
        F.add({ items, say: H.say(s.say), meta: { phase: s.kind, kind: s.kind, cause: s.cause, vector: s.vector, at: s.at, nTraps: traps.length, nA, nS }, title: s.kind });
      });
      F.list.forEach((f) => { f.view = H.box(-10, -8, Math.max(W, 600) + 20, tbY + 28 * (traps.length + 1) + 20); });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Three ways in', text: ['interrupt: a device, any moment', '  async; resumes where it was', 'exception: the instruction fails', '  sync; retried (page fault)', '  or the program is ended', 'system call: on purpose', '  sync; resumes after it'].join('\n') }] };
      return { frames: F.list, def, result: { traps: r.traps, killed: r.killed } };
    },
    camera: 'follow',
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.kind === 'raise', pick: 'option', ask: 'The kernel is about to run. What brings it in?', options: ['an interrupt', 'an exception', 'a system call'], answer: (fr, i) => ({ interrupt: 'an interrupt', exception: 'an exception', syscall: 'a system call' })[fr[i + 1].meta.cause], explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Run the same program twice: which traps happen at the same instruction both times?', options: ['exceptions and system calls', 'interrupts', 'all of them', 'none of them'], answer: 0, why: 'They are caused by the instruction itself; an interrupt depends on when a device happens to be ready.' },
      { q: 'A key is pressed while a program adds two numbers. What does the program notice?', options: ['nothing: the kernel saves and restores its state around the handler', 'its add gives a wrong answer', 'it is ended', 'it must call read to let the handler run'], answer: 0, why: 'An interrupt is invisible to the program it interrupts, apart from the time it takes.' },
      { q: 'Which trap is a request, not an accident?', options: ['the system call', 'the page fault', 'the timer interrupt', 'the division by zero'], answer: 0, why: 'The program runs the syscall instruction on purpose to ask for a service.' },
      { q: 'After which trap does the CPU run the very same instruction again?', options: ['a page fault that the kernel fixed', 'a system call', 'a timer interrupt taken after the instruction', 'a division by zero'], answer: 0, why: 'The faulting instruction never completed; once the page is there it can.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
