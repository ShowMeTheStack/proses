// The race made visible, and the catalogue of every ready-made program.
//   S.Sync.raceTree(spec?) -> {nodes, leaves, finals, say}   every interleaving of a small program as a tree (no
//     state merging, so each path is one schedule): by default two threads doing count++ as load, add, store.
//     nodes: [{id, parent, depth, choice, tid, name, label, say, count (the shared value after the step), regs:
//       [each thread's r], x (a horizontal place: leaves 0, 1, 2 ..; a parent at the middle of its children)}]
//     leaves: [node ids]; finals: [{value, leaves}] the final values reachable and how many schedules give each
//   S.Sync.catalog -> [{id, part, family, title, build() -> spec | system, system: true for a ready system}]
//     every program of parts 7 to 9 at the small size the model checker handles at once; each spec carries
//     check, expect, expectLive and about (see sync-d-classic.js)
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});

  Y.raceTree = function (spec, opts) {
    spec = spec || Y.counter('race', 2);
    const v = (opts && opts.watch) || 'count', max = (opts && opts.maxNodes) || 5000;
    const nodes = [], leaves = [];
    const root = Y.machine(spec, { light: true });
    const regsOf = (M) => M.threads.map((th) => (th.reg.r === undefined ? null : th.reg.r));
    nodes.push({ id: 0, parent: null, depth: 0, choice: null, tid: null, name: null, label: 'start', say: `Both threads are ready; ${v} = \`${root.vars[v]}\`.`, count: root.vars[v], regs: regsOf(root), kids: [] });
    const stack = [[root, 0]];
    while (stack.length) {
      const [M, id] = stack.pop();
      const ch = M.status() === 'running' ? M.choices() : [];
      if (!ch.length) { leaves.push(id); continue; }
      for (const c of ch.slice().reverse()) {
        if (nodes.length >= max) throw new Error('the interleaving tree is too big to draw');
        const M2 = M.clone(), st = M2.step(c), nid = nodes.length;
        nodes.push({ id: nid, parent: id, depth: nodes[id].depth + 1, choice: c, tid: st.tid, name: st.name, label: st.label, say: st.say, count: M2.vars[v], regs: regsOf(M2), kids: [] });
        nodes[id].kids.unshift(nid);
        stack.push([M2, nid]);
      }
    }
    // leaves left to right in schedule order (T0 first), parents over the middle of their children
    const order = [];
    const walk = (id) => { const nd = nodes[id]; if (!nd.kids.length) { nd.x = order.length; order.push(id); return; } nd.kids.forEach(walk); nd.x = (nodes[nd.kids[0]].x + nodes[nd.kids[nd.kids.length - 1]].x) / 2; };
    walk(0);
    const byVal = new Map();
    for (const id of order) { const c = nodes[id].count; byVal.set(c, (byVal.get(c) || 0) + 1); }
    const finals = [...byVal.entries()].sort((a, b) => a[0] - b[0]).map(([value, n]) => ({ value, leaves: n }));
    const n = spec.threads.length;
    return { nodes, leaves: order, finals, say: `${order.length} schedules in all; they end with ${v} = ${finals.map((f) => '`' + f.value + '` (' + f.leaves + ')').join(' or ')}${finals.some((f) => f.value !== n) ? ': every ending below ' + n + ' lost an update' : ''}.` };
  };

  const C = [];
  const add = (part, family, id, title, build, system) => C.push({ id, part, family, title, build, system: !!system });
  // part 7: the critical section and its tools
  for (const v of ['race', 'mutex', 'atomic']) add(7, 'counter', 'counter-' + v, 'count++ (' + v + ')', () => Y.counter(v, 2));
  for (const v of ['correct', 'flags-only', 'turn-only', 'check-then-set', 'tso', 'tso-fence']) add(7, 'peterson', 'peterson-' + v, "Peterson's algorithm (" + v + ')', () => Y.peterson(v));
  for (const k of ['tas', 'cas', 'ticket', 'mcs']) add(7, 'spinlock', 'lock-' + k, k + ' lock', () => Y.spinlock(k, 2));
  // part 8: classic problems and concurrency bugs
  for (const v of ['naive', 'ordered', 'seats', 'arbiter']) add(8, 'philosophers', 'phil-' + v, 'dining philosophers (' + v + ')', () => Y.philosophers(3, v));
  for (const v of ['correct', 'cyclic']) add(8, 'philosophers', 'chandy-' + v, 'Chandy–Misra (' + v + ')', () => Y.chandy(3, v), true);
  for (const v of ['sem', 'no-mutex', 'swapped']) add(8, 'buffer', 'buffer-' + v, 'bounded buffer with semaphores (' + v + ')', () => Y.buffer(2, 2, 2, { check: true, variant: v }));
  add(8, 'buffer', 'cvbuffer-while', 'bounded buffer, mutex and conditions (while)', () => Y.cvBuffer(1, 1, 2));
  add(8, 'buffer', 'cvbuffer-if', 'bounded buffer, mutex and conditions (if, Mesa)', () => Y.cvBuffer(1, 1, 2, { variant: 'if' }));
  add(8, 'buffer', 'cvbuffer-if-hoare', 'bounded buffer, mutex and conditions (if, Hoare)', () => Y.cvBuffer(1, 1, 2, { variant: 'if', hoare: true }));
  add(8, 'buffer', 'cvbuffer-one-cv', 'bounded buffer with one condition variable', () => Y.cvBuffer(1, 2, 2, { variant: 'one-cv' }));
  for (const v of ['reader', 'writer', 'fair', 'lock-reader', 'lock-writer', 'lock-fair']) add(8, 'readers-writers', 'rw-' + v, 'readers–writers (' + v + ')', () => (v.endsWith('writer') ? Y.readersWriters(v, 1, 2) : Y.readersWriters(v, 2, 1)));
  for (const v of ['correct', 'no-mutex']) add(8, 'barber', 'barber-' + v, 'sleeping barber (' + v + ')', () => Y.barber(2, 1, { variant: v }));
  for (const v of ['naive', 'helpers']) add(8, 'smokers', 'smokers-' + v, 'cigarette smokers (' + v + ')', () => Y.smokers(v));
  // the id barrier-two-phase is kept for the labs; the program is the two-gate barrier
  add(8, 'barrier', 'barrier-primitive', 'a barrier (primitive)', () => Y.barrierProblem(3, 'primitive', 2));
  add(8, 'barrier', 'barrier-two-phase', 'a barrier (two gates)', () => Y.barrierProblem(3, 'two-gates', 2));
  add(8, 'barrier', 'barrier-racy', 'a barrier (racy)', () => Y.barrierProblem(3, 'racy', 2));
  for (const v of ['correct', 'early-release']) add(8, 'crews', 'crews-' + v, 'boat crews (' + v + ')', () => Y.crews(2, v));
  for (const k of ['atomicity', 'order', 'lost-wakeup']) { add(8, 'bugs', 'bug-' + k, 'a ' + k + ' bug', () => Y.bug(k, false)); add(8, 'bugs', 'fix-' + k, 'the ' + k + ' bug fixed', () => Y.bug(k, true)); }
  // part 9: deadlock and livelock in programs
  add(9, 'lock-order', 'lock-order-ab-ba', 'two locks in opposite orders', () => Y.lockOrder('ab-ba'));
  add(9, 'lock-order', 'lock-order-ordered', 'two locks in one order', () => Y.lockOrder('ordered'));
  add(9, 'livelock', 'livelock', 'polite threads that back off', () => Y.livelock());
  Y.catalog = C;
})(globalThis.Proses = globalThis.Proses || {});
