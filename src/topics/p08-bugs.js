// Part 8, concurrency bugs: the four kinds that make up most real ones, each as a two-thread program the model
// checker breaks and then proves fixed (S.Sync.bug: an atomicity violation, an order violation, a lost wake-up;
// S.Sync.lockOrder: two locks taken in opposite orders). Both threads' code is drawn with their places, beside the
// shared variables and the locks; for the lock-order deadlock the locks and threads are drawn as a small graph of
// who holds what and who waits for what.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;

  /** both threads' code side by side, the shared variables, the locks, semaphores and conditions */
  function bugPicture(spec, o) {
    o = o || {};
    const vars = Object.keys(spec.vars || {});
    const LN = spec.threads.map((t) => P7().lines(t)), L = LN.map((l) => l.length), codeH = 34 + Math.max(...L) * 30;
    const textW = Math.ceil(Math.max(...LN.flat().map((x) => S.textWidth(x, 14, { mono: true, bold: true })))) + 24, colW = textW + 56;
    const objY = codeH + 20, rows = (spec.mutexes || []).length + (spec.sems || []).length + (spec.conds || []).length;
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const items = [];
      st.threads.forEach((th, i) => {
        items.push(...P7().code('cd' + i, i * colW, 0, spec, st, [i], { act: ctx.act, line: ctx.step ? ctx.step.pc : undefined, hot: ctx.end && th.state !== 'done' ? th.pc : undefined, lh: 30, size: 14, markW: 34, textW, title: th.name + (th.state === 'done' ? ' (done)' : th.state === 'blocked' ? ' (blocked)' : th.state === 'error' ? ' (failed)' : '') }).items);
      });
      if (vars.length) items.push(...K7().vars({ prefix: 'vv', x: 0, y: objY, title: 'shared', rows: vars.map((n) => ({ name: n, value: P7().show(st.vars[n]), act: ctx.step && ctx.step.obj === n })), nameW: 60, valW: 70 }).items);
      if (rows) items.push(...H.objects('ob', vars.length ? 180 : 0, objY + 20, spec, st, { lit: ctx.step ? ctx.step.obj : null, nameW: 64 }).items);
      if (o.graph) items.push(...lockGraph(spec, st, ctx, draw.gx));
      return items;
    };
    const below = objY + Math.max(vars.length ? 24 + vars.length * 34 : 0, 20 + rows * 50) + 20;
    draw.place = { strip: { x: 0, y: below + (o.graph ? 0 : 0), w: 600, cw: 36 }, verdict: o.graph ? { x: 2 * colW, y: 30, w: 270 } : { x: Math.max(colW, 400), y: objY + 10, w: 270 } };
    draw.gx = 2 * colW + 30;
    return draw;
  }
  /** the locks and threads as a graph: a lock points at the thread holding it, a blocked thread at the lock it wants */
  function lockGraph(spec, st, ctx, gx) {
    const x0 = gx, y0 = 250, items = [];
    const T = [{ k: 'g:T0', x: x0, y: y0 }, { k: 'g:T1', x: x0 + 220, y: y0 }], Lk = { A: { k: 'g:A', x: x0 + 110, y: y0 - 80 }, B: { k: 'g:B', x: x0 + 110, y: y0 + 80 } };
    st.threads.forEach((th, i) => items.push({ key: T[i].k, kind: 'state', x: T[i].x, y: T[i].y, r: 26, text: th.name, size: 15, cls: K7().stateCls(th.state) + (ctx.act === i ? ' act' : '') }));
    const cyc = st.threads.every((th) => th.state === 'blocked');
    for (const id of ['A', 'B']) {
      const m = st.mutex[id], p = Lk[id];
      items.push({ key: p.k, kind: 'state', x: p.x, y: p.y, w: 52, h: 36, rx: 6, text: id, size: 15, cls: 'lockbox' + (m.owner !== null ? ' held' : '') });
      if (m.owner !== null) items.push({ key: 'g:h' + id, kind: 'edge', from: p.k, to: T[m.owner].k, cls: 'holds' });
    }
    st.threads.forEach((th, i) => { if (th.state === 'blocked' && th.on.kind === 'mutex') items.push({ key: 'g:w' + i, kind: 'edge', from: T[i].k, to: Lk[th.on.id].k, cls: 'waitfor' + (cyc ? ' hot' : '') }); });
    items.push(...S.Kit.sync.legend({ prefix: 'gl', x: x0 - 30, y: y0 + 140, entries: [{ cls: 'holds8', text: 'held by', line: true }, { cls: '', text: 'waits for', line: true }], gap: 22 }).items);
    void x0;
    return items;
  }

  // ---- 1. atomicity and order violations -------------------------------------------------------------------------
  const V1 = { atomicity: 'atomicity violation', 'atomicity-fixed': 'atomicity, fixed with a lock', order: 'order violation', 'order-fixed': 'order, fixed with a semaphore' };
  S.P07.topic({
    id: 'classic-bug-violations', family: 'p08-bugs', order: 10, title: 'Atomicity and order violations',
    blurb: 'Most concurrency bugs in real programs are one of two kinds. An atomicity violation: code meant to run as one piece (check that a pointer is set, then use it) is split by another thread clearing it in between. An order violation: one thread uses something before another has set it up, because nothing makes the set-up happen first. The checker finds each in a few steps; a lock and a semaphore fix them.',
    inputs: [{ id: 'variant', kind: 'choice', label: 'Program', def: 'atomicity', options: Object.entries(V1).map(([value, label]) => ({ value, label })) }],
    presets: Object.entries(V1).map(([v, label]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), values: { variant: v } })),
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const kind = inp.variant.replace('-fixed', ''), fixed = inp.variant.endsWith('fixed'), spec = Y().bug(kind, fixed), F = new S.Frames(['step']), draw = bugPicture(spec);
      const { c } = H.checkAndReplay(F, { spec, picture: draw, ...draw.place, intro: `${kind === 'atomicity' ? 'T0 checks that p is set and then uses it; T1 clears p.' : 'T0 sets up an object (init = 1); T1 uses it.'} ${spec.about}`, why: () => (kind === 'atomicity' ? 'The check and the use were one idea but two steps, and T1 ran between them.' : 'T1 ran first: the program assumed an order nothing enforced.') });
      if (c.res.verdict === 'ok') { const n0 = F.length; H.randomRun(F, { spec, seed: 2, steps: 12, picture: draw, lead: 'One schedule of the fixed program: ' }); }
      return { frames: F.list, def: P7().def(kind === 'atomicity' ? 'Check, then use' : 'Set up, then use', kind === 'atomicity' ? ['T0: if (p != NULL) use(p)', 'T1: p = NULL', 'fix: lock(m) around both,', '  in both threads'] : ['T0: init = 1 (set up)', 'T1: use the object', 'fix: T0 posts ready after the set-up;', '  T1 waits on ready first']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Can this program fail?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'bad' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'An atomicity violation is…', options: ['a sequence meant to be indivisible that another thread can interrupt', 'two threads using different locks', 'a thread that runs too early', 'a deadlock'], answer: 0, why: 'The programmer assumed atomicity the code does not provide.' },
      { q: 'An order violation is fixed by…', options: ['making the second action wait for a signal from the first', 'a longer sleep', 'a bigger lock', 'running on one core'], answer: 0, why: 'A semaphore or condition variable enforces happens-before.' },
      { q: 'Why does a sleep() before the use not fix an order violation?', options: ['it only makes the bad order rarer, never impossible', 'sleep is not allowed', 'it does fix it', 'it causes a deadlock'], answer: 0, why: 'Timing is not synchronisation.' },
      { q: 'Does the atomicity fix need the lock in both threads?', options: ['yes: a lock only excludes other code that takes the same lock', 'no, only in T0', 'no, only in T1', 'no lock is needed'], answer: 0, why: 'T1 must not clear p while T0 holds the lock.' },
    ],
  });

  // ---- 2. deadlocks and lost wake-ups ------------------------------------------------------------------------------
  const V2 = { 'ab-ba': 'two locks, opposite orders', ordered: 'two locks, one order', 'lost-wakeup': 'a lost wake-up', 'lost-fixed': 'the wake-up, tested under the lock' };
  S.P07.topic({
    id: 'classic-bug-deadlock', family: 'p08-bugs', order: 20, title: 'Deadlocks and lost wake-ups',
    blurb: 'Two more bug patterns end with threads asleep for ever. Two threads take two locks in opposite orders: each can get its first and wait for the other\'s. A waiter tests a flag outside the lock and then goes to sleep, but the signal came in between and is gone: condition variables keep no memory. Take locks in one global order, and test the condition under the lock in a loop.',
    inputs: [{ id: 'variant', kind: 'choice', label: 'Program', def: 'ab-ba', options: Object.entries(V2).map(([value, label]) => ({ value, label })) }],
    presets: Object.entries(V2).map(([v, label]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), values: { variant: v } })),
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const v = inp.variant, lockCase = v === 'ab-ba' || v === 'ordered';
      const spec = lockCase ? Y().lockOrder(v) : Y().bug('lost-wakeup', v === 'lost-fixed'), F = new S.Frames(['step']), draw = bugPicture(spec, { graph: lockCase });
      const { c } = H.checkAndReplay(F, { spec, picture: draw, ...draw.place, intro: lockCase ? `T0 takes A then B; T1 takes ${v === 'ab-ba' ? 'B then A' : 'A then B too'}. ${spec.about} On the right, a lock points to the thread holding it and a blocked thread points to the lock it waits for.` : `W waits until S has set flag; S sets it and signals. ${spec.about}`, why: () => (lockCase ? 'The graph closes a cycle: T0 → B → T1 → A → T0.' : 'S signalled while no one was waiting, so the signal was lost; W then slept on a condition that was already true.') });
      if (c.res.verdict === 'ok') { const n0 = F.length; H.randomRun(F, { spec, seed: 3, steps: 14, picture: draw, lead: 'One schedule of the fixed program: ' }); }
      return { frames: F.list, def: P7().def(lockCase ? 'Lock ordering' : 'Waiting for a flag', lockCase ? ['T0: lock(A); lock(B) … unlock both', 'T1: lock(B); lock(A) … (the bug)', 'fix: every thread takes A before B', 'a global order makes a cycle impossible'] : ['bug: if (!flag) { lock(m); wait(c, m); … }', 'fix: lock(m)', '     while (!flag) wait(c, m)', '     unlock(m)', 'the test and the sleep happen', '  with no gap a signal can fall into']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Can both threads end up asleep for ever?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'bad' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'How does a global lock order prevent deadlock?', options: ['every wait points to a lock later in the order, so waits cannot form a cycle', 'it makes locks faster', 'it removes waiting', 'only one thread may run'], answer: 0, why: 'A cycle would need some thread to wait for an earlier lock while holding a later one.' },
      { q: 'Why is the signal "lost"?', options: ['a condition variable remembers nothing; a signal with no waiter does nothing', 'the kernel drops it', 'S never sends it', 'W was too slow to run'], answer: 0, why: 'Unlike a semaphore, there is no count to keep it.' },
      { q: 'Which change alone fixes the lost wake-up?', options: ['test the flag while holding the lock that S also takes, in a while loop', 'signal twice', 'sleep before waiting', 'use broadcast'], answer: 0, why: 'S cannot set the flag between W\'s test and W\'s wait.' },
      { q: 'Are deadlocks easy to find by testing?', options: ['no: they need a particular interleaving, often a rare one', 'yes, always', 'only on one core', 'they cannot be found'], answer: 0, why: 'A checker explores every interleaving instead.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
