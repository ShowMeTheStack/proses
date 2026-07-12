// Schedules for state spaces too big to search: seeded random schedules and PCT (probabilistic concurrency testing:
// random thread priorities, with d − 1 points where the running thread drops to the lowest priority, which finds
// any bug of depth d with a known probability), and the replay of a schedule step by step.
//   S.MC.random(make, spec, {runs: 200, seed: 1, maxSteps: 500}) -> {verdict, violation, runs, steps, say}
//   S.MC.pct(make, spec, {runs: 200, seed: 1, depth: 3, maxSteps: 500}) -> the same
//     violation: {kind, name, say, schedule, run} (the schedule replays to the same failure)
//   S.MC.replay(make, schedule, spec) -> {steps: [the system's step records], end: {kind, name, say} | null, at}
//     at: how many steps were replayed (a choice that is not enabled stops the replay there)
//   S.MC.rng(seed) -> () => [0, 1)
(function (S) {
  'use strict';
  const MC = (S.MC = S.MC || {});
  MC.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  /** the property a state breaks (as in the search), without collecting outputs */
  function judge(sys, spec) {
    const st = sys.status();
    if (st === 'error') return { kind: 'assert', name: 'assertion', say: sys.failure || 'a thread failed' };
    if (st === 'deadlock' && spec.deadlock !== false) return { kind: 'deadlock', name: 'deadlock', say: 'No thread can move, yet some are blocked: a deadlock.' };
    for (const inv of spec.invariants || []) if (!inv.holds(sys)) return { kind: 'invariant', name: inv.name, say: 'The invariant "' + inv.name + '" is broken.' };
    return null;
  }
  MC.judge = judge;

  /** run many schedules, each choosing by pick(sys, enabled, k) */
  function many(make, spec, opts, start, label) {
    opts = Object.assign({ runs: 200, seed: 1, maxSteps: 500 }, opts || {});
    let steps = 0;
    for (let run = 0; run < opts.runs; run++) {
      const sys = make(), pick = start(run), sched = [];
      let bad = judge(sys, spec);
      for (let k = 0; !bad && k < opts.maxSteps && sys.status() === 'running'; k++) {
        const en = sys.choices(), c = pick(sys, en, k);
        sys.step(c); sched.push(c); steps++;
        bad = judge(sys, spec);
      }
      if (bad) return { verdict: 'violation', violation: Object.assign(bad, { schedule: sched, run }), runs: run + 1, steps, say: `${label} run ${run + 1} of ${opts.runs} breaks it: ${bad.say}` };
    }
    return { verdict: 'none found', violation: null, runs: opts.runs, steps, say: `${opts.runs} ${label} runs of up to ${opts.maxSteps} steps found nothing wrong: likely, not proven.` };
  }
  MC.random = function (make, spec, opts) {
    const o = Object.assign({ seed: 1 }, opts || {});
    return many(make, spec || {}, o, (run) => { const r = MC.rng(o.seed * 1009 + run); return (sys, en) => en[Math.floor(r() * en.length)]; }, 'random');
  };
  MC.pct = function (make, spec, opts) {
    const o = Object.assign({ seed: 1, depth: 3, maxSteps: 500 }, opts || {});
    return many(make, spec || {}, o, (run) => {
      const r = MC.rng(o.seed * 7919 + run), prio = new Map(), change = new Set();
      while (change.size < o.depth - 1) change.add(Math.floor(r() * o.maxSteps));
      let low = 0;
      const who = (sys, c) => { const w = sys.runner ? sys.runner(c) : c; return w === null ? 'x' + c : w; };
      return (sys, en, k) => {
        for (const c of en) { const w = who(sys, c); if (!prio.has(w)) prio.set(w, o.depth + r()); }
        let best = en[0];
        for (const c of en) if (prio.get(who(sys, c)) > prio.get(who(sys, best))) best = c;
        if (change.has(k)) prio.set(who(sys, best), (low += 0.001));
        return best;
      };
    }, 'PCT');
  };

  MC.replay = function (make, schedule, spec) {
    const sys = make(), steps = [];
    let at = 0, end = null;
    for (const c of schedule) {
      if (sys.status() !== 'running' || !sys.choices().some((x) => x === c)) break;
      steps.push(sys.step(c)); at++;
    }
    end = judge(sys, spec || {});
    return { steps, end, at, sys };
  };
})(globalThis.Proses = globalThis.Proses || {});
