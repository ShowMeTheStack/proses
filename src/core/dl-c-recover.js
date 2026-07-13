// Recovery from a deadlock found by the detection algorithm (dl-a-banker.js), as traces with the matrices in each
// step.
//   S.Banker.terminate({avail, alloc, request, names, res, cost: [..]}, {policy: 'cheapest' | 'all'}) -> {steps,
//     aborted: [i..], state}   'cheapest' aborts one deadlocked process at a time, the one of least cost (ties: the
//     lowest number), runs detection again, and stops when nobody is deadlocked; 'all' aborts every deadlocked
//     process at once.
//   S.Banker.preempt({avail, alloc, request, names, res, cost, checkpoint: [[..]..], penalty}) -> {steps, victims,
//     rollbacks: [count per process], state}   takes resources from a victim by rolling it back to its checkpoint
//     (what it held then; by default nothing): the units it gained since go back to Available and it must ask
//     for them again. The victim is the deadlocked process of least cost + penalty × its rollbacks so far, so the
//     same process is not picked for ever (starvation).
//   steps: {kind: 'detect' | 'abort' | 'rollback' | 'clear', say, avail, alloc, request, deadlocked, i, freed}
(function (S) {
  'use strict';
  const B = (S.Banker = S.Banker || {});
  const vec = (v) => '(' + v.join(', ') + ')';
  const cp = (m) => m.map((r) => r.slice());
  const names = (o, n) => o.names || Array.from({ length: n }, (_, i) => 'P' + i);

  function detectStep(st, P) {
    const d = B.detect(st);
    return { d, step: { kind: d.deadlocked.length ? 'detect' : 'clear', deadlocked: d.deadlocked.slice(), avail: st.avail.slice(), alloc: cp(st.alloc), request: cp(st.request), say: d.deadlocked.length ? `Detection finds ${d.deadlocked.map((i) => P[i]).join(', ')} deadlocked, with Available \`${vec(st.avail)}\`.` : `Detection runs again: every process can now finish, with Available \`${vec(st.avail)}\`. The deadlock is broken.` } };
  }

  B.terminate = function (o, opts) {
    const policy = (opts && opts.policy) || 'cheapest', n = o.alloc.length, P = names(o, n);
    const cost = o.cost || Array(n).fill(1), steps = [], aborted = [];
    const st = { avail: o.avail.slice(), alloc: cp(o.alloc), request: cp(o.request), names: P, res: o.res };
    for (let round = 0; round <= n; round++) {
      const { d, step } = detectStep(st, P);
      steps.push(step);
      if (!d.deadlocked.length) break;
      const victims = policy === 'all' ? d.deadlocked : [d.deadlocked.reduce((a, b) => (cost[b] < cost[a] ? b : a))];
      for (const i of victims) {
        const freed = st.alloc[i].slice();
        st.avail = st.avail.map((x, j) => x + freed[j]);
        st.alloc[i] = freed.map(() => 0); st.request[i] = freed.map(() => 0);
        aborted.push(i);
        steps.push({ kind: 'abort', i, freed, deadlocked: d.deadlocked.slice(), avail: st.avail.slice(), alloc: cp(st.alloc), request: cp(st.request),
          say: policy === 'all' ? `Abort ${P[i]} (one of all the deadlocked): its \`${vec(freed)}\` returns, so Available is \`${vec(st.avail)}\`.` : `Abort ${P[i]}, the cheapest deadlocked process (cost ${cost[i]}): its \`${vec(freed)}\` returns, so Available is \`${vec(st.avail)}\`; its work so far is lost.` });
      }
    }
    return { steps, aborted, state: st };
  };

  B.preempt = function (o) {
    const n = o.alloc.length, m = o.avail.length, P = names(o, n), cost = o.cost || Array(n).fill(1), pen = o.penalty === undefined ? 10 : o.penalty;
    const ck = o.checkpoint || o.alloc.map(() => Array(m).fill(0));
    const st = { avail: o.avail.slice(), alloc: cp(o.alloc), request: cp(o.request), names: P, res: o.res };
    const rollbacks = Array(n).fill(0), steps = [], victims = [];
    for (let round = 0; round <= 3 * n; round++) {
      const { d, step } = detectStep(st, P);
      steps.push(step);
      if (!d.deadlocked.length) break;
      const score = (i) => cost[i] + pen * rollbacks[i];
      // a victim must have something to give back since its checkpoint
      const can = d.deadlocked.filter((i) => st.alloc[i].some((x, j) => x > ck[i][j]));
      if (!can.length) { steps.push({ kind: 'stuck', deadlocked: d.deadlocked.slice(), avail: st.avail.slice(), alloc: cp(st.alloc), request: cp(st.request), say: 'Every deadlocked process is already back at its checkpoint: rolling back frees nothing more, so one must be aborted.' }); break; }
      const i = can.reduce((a, b) => (score(b) < score(a) ? b : a));
      const freed = st.alloc[i].map((x, j) => x - ck[i][j]);
      st.avail = st.avail.map((x, j) => x + freed[j]);
      st.alloc[i] = ck[i].slice();
      st.request[i] = st.request[i].map((x, j) => x + freed[j]);
      rollbacks[i]++; victims.push(i);
      steps.push({ kind: 'rollback', i, freed, deadlocked: d.deadlocked.slice(), avail: st.avail.slice(), alloc: cp(st.alloc), request: cp(st.request), rollbacks: rollbacks.slice(),
        say: `Preempt from ${P[i]} (cost ${cost[i]}${rollbacks[i] > 1 ? ', rolled back ' + (rollbacks[i] - 1) + ' time' + (rollbacks[i] > 2 ? 's' : '') + ' before' : ''}): roll it back to its checkpoint, so \`${vec(freed)}\` goes back to Available, now \`${vec(st.avail)}\`; ${P[i]} must ask for those units again, its request now \`${vec(st.request[i])}\`.` });
    }
    return { steps, victims, rollbacks, state: st };
  };
})(globalThis.Proses = globalThis.Proses || {});
