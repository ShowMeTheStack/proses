// Part 7, a queue lock (the MCS idea): each waiter brings its own node, swaps itself into the tail of a queue and
// spins on its own node's flag, and the holder hands the lock to the next node directly. The nodes, their locked
// flags and next pointers, and the tail are drawn from the machine's memory at every step (S.Sync.spinlock 'mcs');
// the model checker proves the two-thread lock correct and starvation-free.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;
  const nm = (i) => (i < 0 ? 'none' : 'T' + i);

  H.topic({
    id: 'sync-mcs', family: 'p07-atomic', order: 30, title: 'A queue lock: each waiter spins on its own flag',
    blurb: 'With a ticket lock every waiter spins on the same word, so each release disturbs every waiting core. A queue lock gives each waiter its own node: it joins the queue with one atomic swap on the tail, links itself behind its predecessor, and spins on its own flag. The holder, leaving, clears the flag of the node behind it: the lock passes hand to hand, in order.',
    inputs: [
      { id: 'threads', kind: 'number', label: 'Threads', def: 2, min: 2, max: 3 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 5, min: 1, max: 999 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 40, min: 12, max: 70 },
    ],
    presets: [
      { label: 'Two threads', values: { threads: 2, seed: 5, steps: 40 } },
      { label: 'Two, fine interleaving', values: { threads: 2, seed: 8, steps: 50 } },
      { label: 'Three threads queue up', values: { threads: 3, seed: 3, steps: 60 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'handoffs', label: 'hand-overs' }],
    run(inp) {
      const n = inp.threads, spec = Y().spinlock('mcs', n), lines = H.lines(spec.threads[0]);
      const run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 3, max: inp.steps });
      const F = new S.Frames(['step', 'handoffs']), strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      const nx = 470, ny = 70, nw = 104;
      function draw(st, o) {
        o = o || {};
        const items = [], V = st.vars, n0 = st.threads.length;
        // queue order: chains of next pointers, each from a node no one points at; then the rest
        const into = new Set(V.next.filter((j) => j >= 0)), order = [];
        for (let i = 0; i < n0; i++) if (!into.has(i)) for (let j = i; j >= 0 && !order.includes(j); j = V.next[j]) order.push(j);
        for (let i = 0; i < n0; i++) if (!order.includes(i)) order.push(i);
        const slot = (i) => order.indexOf(i);
        items.push(...H.code('cd', 0, 0, spec, st, st.threads.map((t) => t.id), { lines, act: o.act, line: o.line, textW: 316, size: 13, lh: 25, markW: 30, title: 'every thread, for ever:' }).items);
        const tx = nx + (V.tail < 0 ? 0 : slot(V.tail) * (nw + 30)) + (nw - 92) / 2;
        items.push({ key: 'tail', kind: 'cell', x: tx, y: 0, w: 92, h: 34, rx: 7, text: 'tail', size: 15, cls: 'varval' + (o.obj === 'tail' ? ' act' : '') });
        if (V.tail < 0) items.push(H.text('tailv', tx + 104, 23, 'tail = none: no one holds or waits', 'p7note', 13));
        st.threads.forEach((th, i) => {
          const x = nx + slot(i) * (nw + 30), inQ = V.tail === i || V.next.includes(i) || th.cs > 0 || V.locked[i] === 1;
          items.push({ key: 'nd' + i, kind: 'cell', x, y: ny, w: nw, h: 32, rx: 7, text: th.cs > 0 ? th.name + ' holds it' : th.name + '’s node', size: 14, cls: 'thcard ' + S.Kit.sync7.stateCls(th.state === 'ready' && o.act === i ? 'running' : th.state) + (o.act === i ? ' act' : '') + (inQ ? '' : ' dim') });
          items.push({ key: 'lk' + i, kind: 'cell', x, y: ny + 36, w: nw, h: 28, rx: 5, text: 'locked = ' + V.locked[i], size: 13, cls: 'regcell' + (V.locked[i] ? ' hot' : '') });
          items.push({ key: 'nx' + i, kind: 'cell', x, y: ny + 68, w: nw, h: 28, rx: 5, text: 'next = ' + nm(V.next[i]), size: 13, cls: 'regcell' });
        });
        if (V.tail >= 0) items.push({ key: 'et', kind: 'edge', from: 'tail', to: 'nd' + V.tail, cls: 'act' });
        st.threads.forEach((th, i) => { const j = V.next[i]; if (j >= 0) items.push({ key: 'en' + i, kind: 'edge', from: 'nx' + i, to: 'nx' + j, bend: slot(j) === slot(i) + 1 ? 0 : 34, cls: 'p' + i }); });
        const spinning = st.threads.filter((t) => t.state !== 'done' && t.reg.l === 1).map((t) => t.name);
        items.push(H.text('spin', nx, ny + 150, spinning.length ? 'spinning on its own flag: ' + spinning.join(', ') : 'no one is spinning', spinning.length ? 'strong' : 'p7note', 14));
        items.push(...K7().strip({ prefix: 'sc', x: nx, y: ny + 180, w: 420, steps: strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 12, title: 'the schedule' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: nx, y: ny + 360, w: 400 }, o.verdict)).items);
        return items;
      }
      F.add({ items: draw(Y().machine(spec).snap(), { upto: 0 }), say: `${H.plural(n, 'thread')}, each with its own node (a locked flag and a next pointer), and one shared word, tail, naming the last node in the queue (none at first). The scheduler picks a random thread for a burst of 1 to 3 steps (seed ${inp.seed}).`, meta: { vals: [n, 1, 3, inp.seed] } });
      let hand = 0;
      run.steps.forEach((s, k) => {
        if (s.op === 'write' && /hand over/.test(s.label || '')) hand++;
        F.set('step', k + 1).set('handoffs', hand);
        F.add({ items: draw(s.state, { act: s.tid, line: s.pc, obj: s.obj, upto: k + 1 }), say: s.say + (/hand over/.test(s.label || '') ? ' The waiter behind, spinning on that flag, sees it fall and goes in.' : ''), meta: { vals: H.nums(s.say).concat([k + 1, hand]), next: run.steps[k + 1] ? run.steps[k + 1].name : null, options: spec.threads.map((t) => t.name) } });
      });
      const spec2 = n === 2 ? spec : Y().spinlock('mcs', 2), chk = H.check(spec2);
      F.add({ items: draw(run.machine.snap(), { upto: strip.length, verdict: { kind: chk.lasso || chk.res.safety.violation ? 'bad' : 'ok', head: 'Correct and fair', lines: [chk.stats.states + ' states searched (2 threads)', 'every waiter gets in, in queue order'] } }), say: `${H.plural(hand, 'hand-over')} in this run. For two threads the model checker searched all ${chk.stats.states} states: never two holders, and every waiter gets the lock. Each waiter spun only on its own node's flag, so a release touches one waiter's cache line, not everyone's.`, meta: { vals: [hand, chk.stats.states, 2] } });
      return { frames: F.list, def: H.def('Queue lock (one node per waiter)', ['acquire: my.next = none; my.locked = 1', '  pred = swap(&tail, me)', '  if (pred) { pred.next = me;', '    while (my.locked) ; }', 'release: if (my.next == none)', '  if (cas(&tail, me, none)) return', '  wait for my.next to be linked', '  my.next.locked = 0']) };
    },
    predict: [H.predictNext('Which thread takes the next step?')],
    quiz: [
      { q: 'Why does a queue lock scale better than a ticket lock on many cores?', options: ['each waiter spins on its own word, so a release disturbs only the next waiter', 'it never spins', 'it uses no atomic instructions', 'it skips waiters'], answer: 0, why: 'Spinning on a private flag stays in that core\'s cache until the one write that matters.' },
      { q: 'What does the atomic swap on tail do?', options: ['appends my node and tells me who was before me, in one step', 'takes the lock', 'releases the lock', 'counts waiters'], answer: 0, why: 'Two arrivals cannot both see the same predecessor.' },
      { q: 'A releaser finds my.next empty but tail is not itself. Why wait?', options: ['a newcomer has swapped itself in but not yet linked its node', 'the lock is broken', 'to be fair', 'tail is stale'], answer: 0, why: 'The swap and the link are two steps; the releaser waits for the link to hand over.' },
      { q: 'In what order do waiters get a queue lock?', options: ['the order of their swaps on tail', 'random', 'thread id order', 'reverse order'], answer: 0, why: 'The queue is built by the swaps; the lock walks down it.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
