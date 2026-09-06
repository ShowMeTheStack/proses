// Part 9, locks in programs: two threads taking two locks in opposite orders (S.Sync.lockOrder) with the model
// checker's deadlocking schedule; a lock-order checker (S.Lockdep) that sees the danger in a run that did not
// deadlock; and livelock (S.Sync.livelock), found by the liveness checker (S.MC.live) as a fair cycle of steps.
(function (S) {
  'use strict';
  const H = S.P09, KR = () => S.Kit.rag, Y = () => S.Sync;
  const stCls = { ready: 's-ready', blocked: 's-blocked', done: 's-done' };
  const opLine = (o) => o.label || (o.op === 'enter' ? 'critical' : o.op === 'leave' ? 'leave' : o.op);
  const resolved = (prog) => prog.filter((e) => !(e && e.label !== undefined && !e.op));

  /** listings side by side, each thread's place marked, and the threads-and-locks graph */
  H.threadPic = function (spec, snap, o) {
    o = o || {};
    const items = [], ths = spec.threads, lw = o.lw || 200, lh = 30;
    ths.forEach((th, t) => {
      const lines = resolved(th.prog).map(opLine), s = snap.threads[t], done = s.state === 'done' || s.pc >= lines.length;
      const marks = lines.map((_, k) => (k === s.pc && !done ? [{ name: th.name, cls: (stCls[s.state] || 's-ready') + (o.act === t ? ' act' : '') }] : []));
      const c = S.Kit.sync.code({ prefix: 'c' + t, x: t * (lw + 50), y: 30, lines, marks, act: o.act === t ? o.actPc : undefined, lh, size: 14, title: th.name + (done ? ': finished' : s.state === 'blocked' ? ': blocked' : ''), titleCls: done ? 'good' : s.state === 'blocked' ? 's-blocked' : 'strong', textW: lw - 50 });
      items.push(...c.items);
    });
    if (o.noGraph) return { items };
    const locks = (spec.mutexes || []).map((m) => (typeof m === 'string' ? m : m.id));
    const hold = [], want = [];
    locks.forEach((m, j) => { const x = snap.mutex[m]; if (x.owner !== null && x.owner !== undefined) hold.push([x.owner, j]); });
    snap.threads.forEach((s, t) => { if (s.state === 'blocked' && s.on && s.on.kind === 'mutex') want.push([t, locks.indexOf(s.on.id)]); });
    const g = { procs: ths.map((t) => t.name), res: locks.map((name) => ({ name, units: 1 })), hold, want };
    const gg = S.Rag.graph(g), cyc = o.cycle ? S.Rag.cycle(gg).cycle : null, hot = new Set();
    if (cyc) cyc.forEach((v, k) => hot.add(v + '>' + cyc[(k + 1) % cyc.length]));
    const gx = ths.length * (lw + 50) + 120;
    const d = KR().draw({ prefix: 'g', g, pos: o.pos, x: gx, y: o.gy || 180, hot, procCls: (t) => (stCls[snap.threads[t].state] || 's-ready') + (o.act === t ? ' act' : '') });
    items.push(H.title('gt', gx - 120, 6, 'threads and locks'), ...d.items);
    return { items, gx, cycle: cyc, g };
  };
  const SQ = { p0: { x: -95, y: 0 }, r0: { x: 0, y: -95 }, p1: { x: 95, y: 0 }, r1: { x: 0, y: 95 } };
  /** run a spec on a full machine along a schedule (then round robin), keeping every step and snapshot */
  H.runSync = (spec, sched, max) => {
    const M = Y().machine(spec), steps = [];
    let k = 0, last = -1;
    while (M.status() === 'running' && steps.length < (max || 80)) {
      const c = M.choices(), rr = c.find((x) => x > last), pick = k < sched.length && c.includes(sched[k]) ? sched[k] : rr === undefined ? c[0] : rr;
      k++; last = pick; steps.push(M.step(pick));
    }
    return { M, steps, status: M.status() };
  };

  S.topic({
    id: 'dl-lock-order', family: 'p09-locks', order: 10, title: 'Two locks in opposite orders',
    blurb: 'T0 locks A then B; T1 locks B then A. Most of the time one thread gets both and finishes before the other starts, and nothing goes wrong. But if each takes its first lock before the other takes its second, each waits for the lock the other holds, for ever. The model checker tries every schedule and finds the bad one; taking the locks in one agreed order makes it impossible.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Program', def: 'ab-ba', options: [{ value: 'ab-ba', label: 'T0: A then B; T1: B then A' }, { value: 'ordered', label: 'both: A then B' }] },
      { id: 'sched', kind: 'choice', label: 'Schedule', def: 'worst', options: [{ value: 'worst', label: 'the bad interleaving (model checker)' }, { value: 'rr', label: 'round robin, one step each' }, { value: 'whole', label: 'T0 runs to the end first' }] },
    ],
    presets: [
      { label: 'Opposite orders, the bad interleaving', values: { variant: 'ab-ba', sched: 'worst' } },
      { label: 'Opposite orders, T0 first: fine', values: { variant: 'ab-ba', sched: 'whole' } },
      { label: 'One order, the same interleaving', values: { variant: 'ordered', sched: 'worst' } },
      { label: 'One order, round robin', values: { variant: 'ordered', sched: 'rr' } },
    ],
    counters: [{ id: 'steps', label: 'steps' }, { id: 'states', label: 'states searched' }],
    run(inp) {
      const spec = Y().lockOrder(inp.variant), mc = S.MC.check(S.MC.maker(spec), spec.check, {});
      const bad = H.once('ab-ba-sched', () => { const s = Y().lockOrder('ab-ba'); return S.MC.check(S.MC.maker(s), s.check, {}).violation.schedule; });
      const sched = inp.sched === 'worst' ? bad : inp.sched === 'rr' ? Array.from({ length: 12 }, (_, k) => k % 2) : Array(6).fill(0).concat(Array(6).fill(1));
      const R = H.runSync(spec, sched), F = new S.Frames(['steps', 'states']);
      const M0 = Y().machine(spec), snap0 = M0.snap();
      F.set('states', mc.stats.states);
      const pic = (snap, o) => H.threadPic(spec, snap, Object.assign({ pos: SQ }, o)).items;
      F.add({ items: pic(snap0), say: inp.variant === 'ab-ba' ? 'T0 takes A then B; T1 takes B then A. Both locks are free.' : 'Both threads take A first, then B. Both locks are free.', meta: { phase: 'start' } });
      F.add({ items: pic(snap0), say: mc.violation ? `The model checker tried every schedule (${mc.stats.states} states) and found one that deadlocks: ${mc.violation.schedule.map((t) => spec.threads[t].name).join(', ')}, one step each.` : `The model checker tried every schedule (${mc.stats.states} states): none deadlocks, because nobody can hold B while waiting for A.`, meta: { phase: 'search', found: !!mc.violation, states: mc.stats.states } });
      R.steps.forEach((st, k) => {
        F.count('steps');
        F.add({ items: pic(st.state, { act: st.tid, actPc: st.pc }), say: H.plain(st.say), meta: { phase: 'step', kind: st.kind, tid: st.tid, k }, title: st.name + ' · ' + (st.label || st.op) });
      });
      const last = R.steps[R.steps.length - 1];
      if (R.status === 'deadlock') F.add({ items: pic(last.state, { cycle: true }).concat([H.text('vd', 0, 30 + 28 + 6 * 30 + 30, 'deadlock: each holds the lock the other wants', 'verdict2 hot', 16)]), say: 'Neither thread can move: T0 holds A and waits for B, T1 holds B and waits for A. The pink cycle is the deadlock, and no amount of waiting ends it.', meta: { phase: 'end', status: 'deadlock' }, title: 'deadlock', hold: 3000 });
      else F.add({ items: pic(last.state).concat([H.text('vd', 0, 30 + 28 + 6 * 30 + 30, 'both finished', 'verdict2 good', 16)]), say: `Both threads finished after ${H.plural(R.steps.length, 'step')}.` + (inp.variant === 'ab-ba' ? ' This schedule was lucky: the same code deadlocks under another.' : ' With one order, whoever gets A first gets B too; the other simply waits at A.'), meta: { phase: 'end', status: 'done', n: R.steps.length }, title: 'done', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Why one order works', text: ['number the locks: A < B', 'always take a lower lock before a higher one', 'a cycle of waits would need someone', '  holding a higher lock to wait for a lower one', 'so no cycle, so no deadlock'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Can any schedule of this program deadlock?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.found ? 'yes' : 'no'), explain: (fr) => fr[1].say },
    ],
    quiz: [
      { q: 'T0 takes A then B, T1 takes B then A. A deadlock needs…', options: ['each to take its first lock before either takes its second', 'both to start at the same instant', 'a third thread', 'A and B to be the same lock'], answer: 0, why: 'That interleaving leaves each holding what the other wants.' },
      { q: 'Testing the program a thousand times without a deadlock proves…', options: ['nothing: the bad interleaving may simply not have happened', 'that it is correct', 'that the locks are ordered', 'that the scheduler is fair'], answer: 0, why: 'Only a search of every schedule, or an argument like lock ordering, proves it.' },
      { q: 'With one global lock order, a thread waiting for B…', options: ['may hold A, but whoever holds B never waits for A', 'holds nothing', 'will deadlock', 'must release everything'], answer: 0, why: 'Whoever holds B already passed A, so it can finish.' },
      { q: 'Two locks of the same kind, as in transferring money between two accounts. A simple order is…', options: ['lock the account with the lower number first', 'lock the source account first', 'lock the destination first', 'any order, as long as it is quick'], answer: 0, why: 'Source and destination swap between transfers; account numbers do not.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const two = (a, b) => [{ op: 'lock', m: a, label: 'lock(' + a + ')' }, { op: 'lock', m: b, label: 'lock(' + b + ')' }, { op: 'enter', mark: 'progress' }, { op: 'leave' }, { op: 'unlock', m: b, label: 'unlock(' + b + ')' }, { op: 'unlock', m: a, label: 'unlock(' + a + ')' }];
  const LD = {
    three: { label: 'Three threads: A→B, B→C, C→A', threads: [['A', 'B'], ['B', 'C'], ['C', 'A']], locks: ['A', 'B', 'C'] },
    abba: { label: 'Two threads: A→B and B→A', threads: [['A', 'B'], ['B', 'A']], locks: ['A', 'B'] },
    ordered: { label: 'Three threads, all in order A < B < C', threads: [['A', 'B'], ['B', 'C'], ['A', 'C']], locks: ['A', 'B', 'C'] },
  };
  const ldSpec = (k) => ({ threads: LD[k].threads.map(([a, b], i) => ({ name: 'T' + i, prog: two(a, b) })), mutexes: LD[k].locks, check: { invariants: [], liveness: [], deadlock: true } });
  const triPos = (names, R, cx, cy) => { const pos = {}; names.forEach((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / names.length; pos['p' + i] = { x: Math.round(cx + R * Math.cos(a)), y: Math.round(cy + R * Math.sin(a)) }; }); return pos; };

  S.topic({
    id: 'dl-lockdep', family: 'p09-locks', order: 20, title: 'A lock-order checker',
    blurb: 'Waiting for a deadlock to happen in testing is hopeless: the bad timing is rare. A lock-order checker watches every run instead. Each time a thread takes a lock while holding others, it records "held before taken" in a graph of locks. A cycle in that graph means two places in the code take the same locks in opposite orders, so some timing can deadlock, even though this run did not.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'three', options: Object.entries(LD).map(([value, p]) => ({ value, label: p.label })) }],
    presets: [{ label: 'Three threads in a ring', values: { prog: 'three' } }, { label: 'Two threads, opposite orders', values: { prog: 'abba' } }, { label: 'Everyone in one order', values: { prog: 'ordered' } }],
    counters: [{ id: 'edges', label: 'orders recorded' }],
    run(inp) {
      const spec = ldSpec(inp.prog), n = spec.threads.length;
      // one thread at a time, each to the end: a run that never deadlocks
      const R = H.runSync(spec, spec.threads.flatMap((_, t) => Array(6).fill(t)));
      const ev = S.Lockdep.fromRun(R.steps), L = S.Lockdep.check(ev), F = new S.Frames(['edges']);
      const mc = S.MC.check(S.MC.maker(spec), spec.check, {});
      const lw = 170, gx = n * (lw + 50) + 70, gy = 150, lpos = triPos(spec.mutexes, 80, 0, 0);
      const lockGraph = (k, hot) => {
        const items = [H.title('lt', gx - 100, 6, 'lock-order graph')];
        spec.mutexes.forEach((m, i) => items.push({ key: 'lk' + i, kind: 'state', x: gx + lpos['p' + i].x, y: gy + lpos['p' + i].y, r: 24, text: m, cls: 'ragp ' + (hot && hot.some((c) => c.includes(m)) ? 's-blocked' : 's-ready') }));
        L.edges.slice(0, k).forEach((e) => { const a = spec.mutexes.indexOf(e.from), b = spec.mutexes.indexOf(e.to), back = L.edges.slice(0, k).some((f) => f.from === e.to && f.to === e.from); items.push({ key: 'le' + e.from + e.to, kind: 'edge', from: 'lk' + a, to: 'lk' + b, bend: back ? 0.3 : 0, cls: 'ragwf' + (hot && hot.some((c) => { const i = c.indexOf(e.from); return i >= 0 && c[(i + 1) % c.length] === e.to; }) ? ' hot' : '') }); });
        L.edges.slice(0, k).forEach((e, j) => items.push(H.text('ll' + j, gx - 100, gy + 130 + j * 22, e.from + ' → ' + e.to + ' (' + e.thread + ')', 'ledger', 14)));
        return items;
      };
      const snapAt = (k) => (k < 0 ? Y().machine(spec).snap() : R.steps[k].state);
      const pic = (k, edges, hot, o) => H.threadPic(spec, snapAt(k), Object.assign({ lw, noGraph: true }, o || {})).items.concat(lockGraph(edges, hot));
      F.add({ items: pic(-1, 0), say: `${H.list(spec.threads.map((t, i) => t.name + ' takes ' + LD[inp.prog].threads[i].join(' then ')))}. They run one at a time here, so this run cannot deadlock. The checker watches anyway.`, meta: { phase: 'start' } });
      let e = 0, si = 0;
      // walk the run; a frame at each lock taken while another is held (a new order recorded), and at each cycle
      R.steps.forEach((st, k) => {
        const isAcq = st.op === 'lock' && st.kind === 'acquire';
        const ls = L.steps[si];
        if (isAcq && ls && ls.kind === 'edge' && ls.edge.thread === st.name && ls.edge.to === st.obj) {
          e++; si++; F.count('edges');
          F.add({ items: pic(k, e, null, { act: st.tid, actPc: st.pc }), say: H.plain(ls.say), meta: { phase: 'edge', k, from: ls.edge.from, to: ls.edge.to }, title: ls.edge.from + ' → ' + ls.edge.to });
          if (L.steps[si] && L.steps[si].kind === 'cycle') { const c = L.steps[si]; si++; F.add({ items: pic(k, e, [c.cycle], { act: st.tid, actPc: st.pc }), say: H.plain(c.say), meta: { phase: 'cycle', cycle: c.cycle }, title: 'cycle' }); }
        }
      });
      const done = R.steps.length - 1;
      F.add({ items: pic(done, e, L.cycles).concat([H.text('vd', 0, 30 + 28 + 6 * 30 + 30, L.cycles.length ? 'this run finished, but a deadlock is possible' : 'no cycle: these locks cannot deadlock', 'verdict2 ' + (L.cycles.length ? 'hot' : 'good'), 16)]), say: `The run finished without a deadlock. ${H.plain(L.say)}` + (mc.violation ? ` The model checker agrees: the schedule ${mc.violation.schedule.map((t) => spec.threads[t].name).join(', ')} deadlocks.` : ` The model checker agrees: none of ${mc.stats.states} states is a deadlock.`), meta: { phase: 'end', cycles: L.cycles.length, edges: L.edges.length, found: !!mc.violation, states: mc.stats.states }, title: 'verdict', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Recording lock orders', text: ['a thread holding X takes Y: record X → Y', 'a cycle X → Y → … → X:', '  some timing can deadlock', 'found from one run, without the deadlock', 'cost: a check at every lock taken'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'This run will finish. Will the checker still report a possible deadlock?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.cycles ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'The checker records X → Y when…', options: ['a thread takes Y while holding X', 'X and Y are free', 'a thread releases X', 'two threads take X'], answer: 0, why: 'X was held before Y was taken.' },
      { q: 'Why can it warn about a deadlock in a run that did not deadlock?', options: ['the orders it recorded are in the code, whatever the timing', 'it guesses', 'it runs every schedule', 'it slows the threads down'], answer: 0, why: 'A cycle of orders means some interleaving closes the cycle of waits.' },
      { q: 'Three threads take A→B, B→C and C→A. Each pair alone…', options: ['is consistent; only the three together form a cycle', 'deadlocks', 'needs a fourth lock', 'is a livelock'], answer: 0, why: 'The cycle runs through all three orders.' },
      { q: 'A cycle in the lock-order graph is fixed by…', options: ['changing the code so every path takes the locks in one order', 'running the threads faster', 'adding more threads', 'using a spinlock'], answer: 0, why: 'Then the graph has no cycle and deadlock among these locks is impossible.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'dl-livelock', family: 'p09-locks', order: 30, title: 'Livelock: busy, but going nowhere',
    blurb: 'Two polite threads each take one lock and then try the other without waiting. If it is taken, they back off, release their own lock and start again. Nobody ever blocks, so there is no deadlock, yet in lock step they can back off and retry for ever: a livelock. The liveness checker finds the loop of steps, and shows it is fair: both threads keep running and neither makes progress.',
    inputs: [{ id: 'rounds', kind: 'number', label: 'Times round the loop', def: 2, min: 1, max: 4 }],
    presets: [{ label: 'Twice round the loop', values: { rounds: 2 } }, { label: 'Once round', values: { rounds: 1 } }, { label: 'Three times round', values: { rounds: 3 } }],
    counters: [{ id: 'steps', label: 'steps' }, { id: 'backoffs', label: 'back-offs' }, { id: 'progress', label: 'critical sections' }],
    run(inp) {
      const spec = Y().livelock(), live = H.once('livelock', () => S.MC.live(S.MC.maker(spec), spec.check.liveness));
      const safe = H.once('livelock-safe', () => S.MC.check(S.MC.maker(spec), spec.check, {}));
      const res = live.results.find((r) => !r.holds), las = res.lasso;
      const sched = las.prefix.concat(...Array(inp.rounds).fill(las.cycle));
      const M = Y().machine(spec), F = new S.Frames(['steps', 'backoffs', 'progress']);
      const pic = (snap, o) => H.threadPic(spec, snap, Object.assign({ pos: SQ, lw: 230, gy: 200 }, o)).items;
      F.add({ items: pic(M.snap()), say: 'T0 locks A, then tries B without waiting; T1 locks B, then tries A. If the try fails, each backs off: it unlocks its own lock and starts again.', meta: { phase: 'start', states: safe.stats.states } });
      F.add({ items: pic(M.snap()), say: `First, safety: the model checker searched ${safe.stats.states} states and found no deadlock, since a try never blocks. Then liveness: ${H.plain(res.say)}`, meta: { phase: 'search', states: safe.stats.states, prefix: las.prefix.length, cycle: las.cycle.length } });
      let backs = 0, prog = 0;
      sched.forEach((c, k) => {
        const st = M.step(c);
        F.count('steps');
        if (/back off/.test(st.label || '')) { backs++; F.count('backoffs'); }
        if (st.mark === 'progress') { prog++; F.count('progress'); }
        const round = k < las.prefix.length ? 0 : 1 + Math.floor((k - las.prefix.length) / las.cycle.length);
        const lead = k === las.prefix.length ? 'The loop begins. ' : k > las.prefix.length && (k - las.prefix.length) % las.cycle.length === 0 ? `Round ${round} of the loop, back where round ${round - 1} began. ` : '';
        F.add({ items: pic(st.state, { act: st.tid, actPc: st.pc }), say: lead + H.plain(st.say), meta: { phase: 'step', k, round, prev: round - 1, kind: st.kind, tid: st.tid, label: st.label }, title: (round ? 'loop ' + round + ' · ' : '') + st.name + ' · ' + (st.label || st.op) });
      });
      F.add({ items: pic(M.snap()).concat([H.text('vd', 0, 30 + 28 + resolved(spec.threads[0].prog).length * 30 + 30, 'livelock: ' + H.plural(backs, 'back-off') + ', ' + (prog ? H.plural(prog, 'critical section') : 'no critical section'), 'verdict2 hot', 16)]), say: `After ${H.plural(sched.length, 'step')} both threads have run all the time and never blocked, yet they backed off ${backs} times and ${prog ? 'entered the critical section only ' + H.plural(prog, 'time') : 'never once entered the critical section'}. The state is the one the loop began in, so this can go on for ever. Random back-off times, or one lock order, break the lock step.`, meta: { phase: 'end', steps: sched.length, backs, prog }, title: 'livelock', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Deadlock against livelock', text: ['deadlock: everyone blocked, nothing moves', 'livelock: everyone runs, nothing progresses', 'starvation: some progress, one never gets in', 'cures for livelock: random back-off,', '  one lock order, or a fair lock'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'search', pick: 'option', ask: 'Will either thread ever block in this run?', options: ['yes, both end up blocked', 'no, they only back off and retry'], answer: 'no, they only back off and retry', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'In a livelock the threads are…', options: ['running but making no progress', 'all blocked', 'finished', 'waiting for I/O'], answer: 0, why: 'They change state constantly, in a loop that achieves nothing.' },
      { q: 'Why does the deadlock search not find this problem?', options: ['no state is stuck: some thread can always move', 'the search is too small', 'the locks are spinlocks', 'it does, under another name'], answer: 0, why: 'A liveness check is needed: it looks for a loop in which nobody progresses.' },
      { q: 'A common cure is…', options: ['waiting a random time before retrying', 'retrying faster', 'adding more locks', 'removing the try'], answer: 0, why: 'Random delays break the lock step, so one thread soon gets both locks.' },
      { q: 'Two people step aside to let each other pass, both the same way, again and again. This is…', options: ['a livelock', 'a deadlock', 'starvation', 'a race'], answer: 0, why: 'Both keep moving; neither gets past.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
