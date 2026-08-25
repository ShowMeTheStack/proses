// Part 2, the context switch: from process P to process Q on one CPU. The CPU's registers sit in the middle; on
// each side a process with its process entry (the kernel context switch() saves there) and its kernel stack (the
// trap frame of its user registers). Every value comes from S.Os.contextSwitch.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const hx = (n) => H.hex(n, 4);
  const REGS = [['pc', (c) => hx(c.pc)], ['sp', (c) => hx(c.sp)], ['a0', (c) => String(c.regs.a0)], ['a1', (c) => String(c.regs.a1)], ['ra', (c) => hx(c.regs.ra)], ['s0', (c) => hx(c.regs.s0)], ['s1', (c) => hx(c.regs.s1)], ['ptbr', (c) => H.hex(c.ptbr, 2)]];

  function column(name, pr, x, y, w, step, act) {
    const items = [], st = pr.state;
    items.push(H.cell('ph' + name, x, y, w, 30, 'process ' + name + ' · ' + st, 's-' + (st === 'running' ? 'running' : 'ready') + (act ? ' act' : ''), { size: 14 }));
    items.push(H.text('pe' + name, x, y + 52, 'process entry: saved context', 'title', 13));
    const ctx = pr.context, kw = 54;
    ['ra', 'sp', 's0', 's1'].forEach((r, k) => {
      const yy = y + 60 + k * 26;
      items.push(H.cell('ck' + name + r, x, yy, kw, 24, r, 'regname', { size: 13 }));
      items.push(H.cell('cv' + name + r, x + kw, yy, w - kw, 24, ctx ? hx(ctx[r]) : 'empty', 'reg' + (ctx ? '' : ' muted') + ((step.kind === 'save' && act) || (step.kind === 'load' && act) ? ' act' : ''), { size: 13 }));
    });
    items.push(H.text('ks' + name, x, y + 186, 'kernel stack: trap frame', 'title', 13));
    const ks = pr.kstack;
    for (let k = 0; k < 4; k++) {
      const e = ks[k], yy = y + 194 + k * 26;
      items.push(H.cell('kk' + name + k, x, yy, kw, 24, e ? e.name.replace('user ', '') : '', 'regname', { size: 13 }));
      items.push(H.cell('kv' + name + k, x + kw, yy, w - kw, 24, e ? (/pc|sp/.test(e.name) ? hx(e.value) : String(e.value)) : k ? '' : 'empty', 'kslot' + (e ? (step.kind === 'trap' && act ? ' new' : '') : ' empty'), { size: 13 }));
    }
    return items;
  }

  S.topic({
    id: 'p02-switch', family: 'p02-states', order: 20, title: 'The context switch',
    blurb: 'To switch the CPU from process P to process Q, the kernel must save everything P will need to carry on and load what Q saved last time. P\'s user registers are already on its kernel stack, put there by the trap that brought the kernel in. The switch routine then saves P\'s kernel registers in P\'s process entry and loads Q\'s, which moves the CPU onto Q\'s kernel stack: from that instant it is running Q. If Q has its own address space the page-table base changes too, and the TLQ\'s translations are lost unless they are tagged.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'From P to Q', def: 'procs', options: [{ value: 'procs', label: 'two processes' }, { value: 'asid', label: 'two processes, TLB tagged with address-space ids' }, { value: 'threads', label: 'two threads of one process' }] },
      { id: 'a0', kind: 'number', label: 'P\'s a0', def: 7, min: 0, max: 999 },
      { id: 'b0', kind: 'number', label: 'Q\'s a0', def: 3, min: 0, max: 999 },
    ],
    presets: [
      { label: 'Two processes: the TLB is flushed', values: { kind: 'procs' } },
      { label: 'Tagged TLB: nothing flushed', values: { kind: 'asid' } },
      { label: 'Two threads: the page table stays', values: { kind: 'threads', a0: 12, b0: 40 } },
    ],
    counters: [{ id: 'saved', label: 'registers saved' }, { id: 'loaded', label: 'registers loaded' }],
    run(inp) {
      const r = S.Os.contextSwitch({ from: { name: 'P', regs: { a0: inp.a0, a1: 42 } }, to: { name: 'Q', regs: { a0: inp.b0, a1: 99 } }, sameSpace: inp.kind === 'threads', asid: inp.kind === 'asid' });
      const F = new S.Frames(['saved', 'loaded']);
      let prev = null, saved = 0, loaded = 0;
      r.steps.forEach((s) => {
        const items = [];
        if (s.kind === 'trap') saved += 4;
        if (s.kind === 'save') saved += 4;
        if (s.kind === 'load') loaded += 4;
        if (s.kind === 'return') loaded += 4;
        F.set('saved', saved).set('loaded', loaded);
        const onB = ['load', 'space', 'ret', 'return', 'cost'].includes(s.kind);
        items.push(...column('P', s.procs.P, 0, 0, 250, s, !onB && s.kind !== 'user' || s.kind === 'save'));
        items.push(...column('Q', s.procs.Q, 620, 0, 250, s, onB));
        // the CPU
        const cx = 300, cw = 270, kw = 60;
        items.push(H.text('cput', cx, 13, 'the CPU', 'title', 13));
        items.push(H.cell('mode', cx, 22, cw, 28, 'mode: ' + s.cpu.mode, 'modebit ' + (s.cpu.mode === 'kernel' ? 'kern' : 'user'), { size: 14 }));
        REGS.forEach(([n, f], k) => {
          const yy = 60 + k * 26, v = f(s.cpu), was = prev ? f(prev.cpu) : v;
          items.push(H.cell('rn' + n, cx, yy, kw, 24, n, 'regname', { size: 13 }));
          items.push(H.cell('rv' + n, cx + kw, yy, cw - kw, 24, v, 'reg' + (v !== was ? ' changed' : ''), { size: 13 }));
        });
        const tlb = s.kind === 'cost' || s.kind === 'return' || s.kind === 'ret' || s.kind === 'space' ? (r.cost.tlbFlush ? 'TLB flushed: Q starts cold' : r.cost.pageTable ? 'TLB keeps entries, tagged P and Q' : 'TLB keeps P\'s entries: same space') : 'TLB: P\'s translations';
        items.push(H.cell('tlb', cx, 284, cw, 30, tlb, 'vec' + (s.kind === 'space' ? ' act' : ''), { size: 13 }));
        items.push(H.text('who', cx + cw / 2, 344, onB ? 'running Q' : 'running P', onB ? 'act' : 'strong', 15, 'middle'));
        F.add({ items, say: s.say, meta: { phase: s.kind, cpu: s.cpu, cost: r.cost, saved, loaded, a0: inp.a0, b0: inp.b0, regs4: 4 }, title: s.kind });
        prev = s;
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'A switch, in order', text: ['1. trap: user registers saved', '   on P\'s kernel stack', '2. the scheduler picks Q', '3. switch(P, Q): save P\'s kernel', '   registers in P\'s entry,', '   load Q\'s: now on Q\'s stack', '4. new page table if Q is', '   another process (TLB flush)', '5. return-from-trap: Q\'s user', '   registers come back'].join('\n') }] }, result: r.cost };
    },
    predict: [
      { at: (f) => f.meta.phase === 'save', once: true, pick: 'option', ask: 'switch is about to load Q\'s saved context. At which moment does the CPU start running Q?', options: ['when SP is loaded from Q\'s entry, onto Q\'s kernel stack', 'when return-from-trap runs', 'when the timer fired', 'when the page table changes'], answer: 'when SP is loaded from Q\'s entry, onto Q\'s kernel stack', explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'cost', once: true, pick: 'option', ask: 'Is the TLB flushed by this switch?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.cost.tlbFlush ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Where are P\'s user registers while Q runs?', options: ['in the trap frame on P\'s kernel stack', 'in Q\'s registers', 'on P\'s user stack', 'lost'], answer: 0, why: 'The trap saved them there; return-from-trap will restore them when P runs again.' },
      { q: 'Why is a switch between two threads of one process cheaper?', options: ['the page table stays, so the TLB keeps its translations', 'fewer registers exist', 'threads need no kernel', 'it is not cheaper'], answer: 0, why: 'Same address space: no page-table change, no cold TLB.' },
      { q: 'What do address-space ids in the TLB buy?', options: ['entries of several processes can stay, so no flush at a switch', 'more registers', 'faster traps', 'bigger pages'], answer: 0, why: 'Each entry says whose translation it is.' },
      { q: 'Beyond the registers it saves, what makes a context switch expensive?', options: ['cold caches and TLB afterwards', 'copying the whole memory', 'writing to disk', 'restarting the program'], answer: 0, why: 'The direct cost is small; the new process then misses in caches the old one warmed.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
