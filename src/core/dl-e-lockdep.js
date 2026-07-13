// Lock-order checking, in the manner of a kernel lock validator: every time a thread acquires a lock while holding
// others, record "held before acquired" edges in a lock graph. A cycle in that graph is a possible deadlock, even
// in a run that never deadlocked: some other timing of the same code can close it.
//   S.Lockdep.check(events) -> {edges: [{from, to, thread, at}], cycles: [[lock..]], steps, say}
//     events: [{thread, op: 'acquire' | 'release', lock}] in the order they happened (an acquire is recorded when
//     it is attempted, so a thread that blocks still adds its edges)
//     steps: one per new edge or cycle {kind: 'edge' | 'cycle', say, edge | cycle}
//   S.Lockdep.fromRun(steps) -> events   from the trace of S.Sync.run (lock, trylock and unlock steps)
(function (S) {
  'use strict';
  const L = (S.Lockdep = S.Lockdep || {});

  L.fromRun = function (steps) {
    const ev = [];
    for (const s of steps) {
      if (s.op === 'lock' && (s.kind === 'acquire' || s.kind === 'block')) ev.push({ thread: s.name, op: 'acquire', lock: lockOf(s) });
      if (s.op === 'trylock' && s.kind === 'acquire') ev.push({ thread: s.name, op: 'acquire', lock: lockOf(s) });
      if (s.op === 'unlock' && (s.kind === 'release' || s.kind === 'handoff')) ev.push({ thread: s.name, op: 'release', lock: lockOf(s) });
    }
    return ev;
  };
  const lockOf = (s) => s.obj;

  L.check = function (events) {
    const held = new Map(), edges = [], steps = [], cycles = [], key = new Set();
    const adj = new Map();
    const reach = (a, b) => { const seen = new Set([a]), st = [[a, [a]]]; while (st.length) { const [v, path] = st.pop(); if (v === b) return path; for (const w of adj.get(v) || []) if (!seen.has(w)) { seen.add(w); st.push([w, path.concat(w)]); } } return null; };
    events.forEach((e, at) => {
      const h = held.get(e.thread) || [];
      if (e.op === 'acquire') {
        for (const x of h) {
          if (x === e.lock || key.has(x + '>' + e.lock)) continue;
          key.add(x + '>' + e.lock);
          const back = reach(e.lock, x);
          const edge = { from: x, to: e.lock, thread: e.thread, at };
          edges.push(edge);
          if (!adj.has(x)) adj.set(x, []);
          adj.get(x).push(e.lock);
          steps.push({ kind: 'edge', edge, say: `${e.thread} takes ${e.lock} while holding ${x}: record ${x} → ${e.lock}.` });
          if (back) {
            const cyc = back;
            cycles.push(cyc);
            steps.push({ kind: 'cycle', cycle: cyc, say: `That closes a cycle ${cyc.concat([cyc[0]]).join(' → ')}: the locks are taken in opposite orders in different places, so some timing can deadlock.` });
          }
        }
        held.set(e.thread, h.concat([e.lock]));
      } else held.set(e.thread, h.filter((x) => x !== e.lock));
    });
    const say = cycles.length ? `${cycles.length} possible deadlock${cycles.length > 1 ? 's' : ''}: ${cycles.map((c) => c.concat([c[0]]).join(' → ')).join('; ')}.` : `${edges.length} order${edges.length === 1 ? '' : 's'} recorded, all consistent: no cycle, so these locks cannot deadlock among themselves.`;
    return { edges, cycles, steps, say };
  };
})(globalThis.Proses = globalThis.Proses || {});
