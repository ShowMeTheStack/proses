// Challenge kind 'sched-tune': choose a scheduling policy and its parameters; the choice is scored on workloads
// the reader never sees.
//   x: {kind: 'sched-tune', metric: 'response' | 'turnaround' | 'waiting' | 'mix', weights: {response, turnaround}
//       (mix: the weighted sum of the means), cs: context-switch cost in ticks (default 0),
//       hidden: {seed, count, n, spread, maxCpu, maxIo, io} (count workloads from S.Sched.random(seed + k, ..)) or
//       workloads: [[job..]..], preview: [job..] (the visible workload the workspace draws),
//       limits: {policies: [..], quantum: [lo, hi], levels: [lo, hi], allot: [lo, hi], boost: [lo, hi], age: [lo, hi],
//       minFair: a Jain index of the jobs' slowdowns (turnaround over their own work) every hidden workload must reach}}
//   answer: {policy: 'fcfs' | 'sjf' | 'srtn' | 'prio' | 'rr' | 'mlfq', quantum, preemptive, age, levels, q0, allot, boost}
//     mlfq: level k has quantum q0·2^k and allotment allot·2^k; boost every `boost` ticks (0: never)
//   score: the metric's mean over the hidden workloads (lower is better: give the challenge higher: false)
// Several cores (mode: 'multi', cores: n, migrate: ticks to warm a new core's cache): the answer is
//   {policy: 'multi', queue: 'shared' | 'per-core', quantum, push (rebalance every n ticks, 0: never), pull (steal)},
//   run by S.Sched.multi; limits {queues: [..], quantum, push}; the metrics as above, and 'util' (higher: true).
// Real time (mode: 'rt'): hidden task sets, taskSets: [[{id, C, T, D, phase}..]..] or hidden {seed, count, n, util}
//   (generated: n tasks with periods 4..12 and a total utilisation near util), horizon (default the hyperperiod,
//   at most 60); the answer is {policy: 'rm' | 'edf'}, run by S.Sched.rt; metric 'misses' (deadline misses a task
//   set, on average) or 'response' (the mean response of the jobs released); limits {policies}.
(function (S) {
  'use strict';
  const C = S.Challenges, KIT = () => S.ChallengeKit;
  const NAMES = { fcfs: 'FCFS', sjf: 'SJF', srtn: 'SRTN', prio: 'Priority', rr: 'Round robin', mlfq: 'MLFQ', multi: 'Round robin on every core', rm: 'Rate monotonic', edf: 'Earliest deadline first' };
  const METRIC = { response: 'mean response time', turnaround: 'mean turnaround time', waiting: 'mean waiting time', mix: 'weighted time', util: 'CPU utilisation', misses: 'deadline misses a task set' };
  const modeOf = (x) => (x.mode === 'multi' || x.mode === 'rt' ? x.mode : 'single');
  const POLICIES = { single: ['fcfs', 'sjf', 'srtn', 'prio', 'rr', 'mlfq'], multi: ['multi'], rt: ['rm', 'edf'] };
  /** a seeded real-time task set: n tasks, periods 4..12, utilisation near u */
  function rtSet(seed, n, u) {
    const r = S.Sched.rng(seed), T = Array.from({ length: n }, () => 4 + Math.floor(r() * 9));
    const share = T.map(() => 0.5 + r()), tot = share.reduce((a, b) => a + b, 0);
    const ts = T.map((t, i) => ({ id: String.fromCharCode(65 + i), T: t, C: Math.max(1, Math.round((u * share[i] / tot) * t)) }));
    // rounding may overshoot: take ticks back from the heaviest task until the load is at most u
    const U = () => ts.reduce((a, k) => a + k.C / k.T, 0);
    while (U() > u + 1e-9) { const k = ts.filter((q) => q.C > 1).sort((a, b) => b.C / b.T - a.C / a.T)[0]; if (!k) break; k.C--; }
    return ts;
  }
  const lcm = (a, b) => { const g = (p, q) => (q ? g(q, p % q) : p); return (a * b) / g(a, b); };
  const horizon = (x, tasks) => x.horizon || Math.min(60, tasks.reduce((a, t) => lcm(a, t.T), 1));
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const workloads = (x) => {
    if (modeOf(x) === 'rt') {
      if (x.taskSets) return x.taskSets;
      const g = x.hidden || {}, out = [];
      for (let k = 0; k < (g.count || 4); k++) out.push(rtSet((g.seed || 1) + k, g.n || 3, g.util || 0.85));
      return out;
    }
    if (x.workloads) return x.workloads;
    const g = x.hidden || {}, out = [];
    for (let k = 0; k < (g.count || 4); k++) out.push(S.Sched.random((g.seed || 1) + k, g));
    return out;
  };
  const defaults = { policy: 'rr', quantum: 2, preemptive: true, age: 0, levels: 3, q0: 2, allot: 4, boost: 20, queue: 'shared', push: 0, pull: true };
  /** run one workload (or task set) under an answer: the scheduler's trace; x gives the cores or the horizon */
  function simulate(work, a, cs, x) {
    a = Object.assign({}, defaults, a);
    const Sch = S.Sched;
    if (a.policy === 'rm' || a.policy === 'edf') return Sch.rt(work, { policy: a.policy, horizon: horizon(x || {}, work) });
    if (a.policy === 'multi') return Sch.multi(work, { cores: (x && x.cores) || 2, queue: a.queue === 'per-core' ? 'per-core' : 'shared', quantum: a.quantum, push: Math.round(a.push || 0), pull: a.pull !== false, migrate: (x && x.migrate) || 0, cs });
    if (a.policy === 'mlfq') {
      const L = Math.round(a.levels);
      return Sch.mlfq(work, { levels: L, quantum: Array.from({ length: L }, (_, k) => a.q0 * 2 ** k), allot: Array.from({ length: L }, (_, k) => a.allot * 2 ** k), boost: Math.round(a.boost), cs });
    }
    const p = { cs };
    if (a.policy === 'rr') p.quantum = a.quantum;
    if (a.policy === 'prio') { p.preemptive = !!a.preemptive; p.age = Math.round(a.age); }
    return Sch.run(work, a.policy, p);
  }
  function metricOf(x, tr) {
    const m = x.metric || (modeOf(x) === 'rt' ? 'misses' : 'response');
    if (modeOf(x) === 'rt') { if (m === 'misses') return tr.misses.length; const js = tr.jobs.filter((j) => j.response !== null && j.response !== undefined); return js.length ? js.reduce((s, j) => s + j.response, 0) / js.length : 0; }
    if (m === 'util') return tr.metrics.util;
    const avg = tr.metrics.avg;
    if (m === 'mix') { const w = x.weights || { response: 1, turnaround: 0.25 }; return Object.entries(w).reduce((s, [k, v]) => s + v * avg[k], 0); }
    return avg[m];
  }
  /** Jain's index of the slowdowns: 1 when every job is slowed alike */
  function fairness(tr) {
    if (!tr.metrics) return 1;
    const need = {};
    for (const j of tr.jobs) need[j.id] = j.bursts.reduce((s, b) => s + b, 0);
    return S.Sched.jain(tr.metrics.rows.map((r) => r.turnaround / need[r.id]));
  }
  function paramProblems(x, a) {
    const L = x.limits || {}, out = [], R = KIT().range;
    if (!a || !a.policy) return ['choose a policy'];
    if (!NAMES[a.policy]) return ['there is no policy ' + a.policy];
    if (L.policies && !L.policies.includes(a.policy)) out.push(NAMES[a.policy] + ' is not one of the policies allowed here (' + L.policies.map((p) => NAMES[p]).join(', ') + ')');
    if (!POLICIES[modeOf(x)].includes(a.policy)) out.push(NAMES[a.policy] + ' does not fit this challenge: ' + (modeOf(x) === 'rt' ? 'its tasks are periodic, so choose rate monotonic or earliest deadline first' : modeOf(x) === 'multi' ? 'it has ' + (x.cores || 2) + ' cores, each running round robin' : 'it has one CPU'));
    const chk = (name, v, r) => { const e = R(name, v, r); if (e) out.push(e); };
    const whole = (name, v) => { if (!Number.isInteger(v)) out.push(name + ' must be a whole number of ticks'); };
    if (a.policy === 'rr' || a.policy === 'multi') { whole('the quantum', a.quantum); chk('the quantum', a.quantum, L.quantum || [1, 50]); }
    if (a.policy === 'multi') {
      if (!['shared', 'per-core'].includes(a.queue)) out.push('the queue is shared or per core');
      else if (L.queues && !L.queues.includes(a.queue)) out.push((a.queue === 'shared' ? 'a shared queue' : 'a queue per core') + ' is not allowed here');
      whole('the rebalancing period', a.push || 0); chk('the rebalancing period', a.push || 0, L.push || [0, 100]);
    }
    if (a.policy === 'prio') { whole('the aging step', a.age); chk('the aging step', a.age, L.age || [0, 50]); }
    if (a.policy === 'mlfq') {
      for (const [n, k, d] of [['the number of levels', 'levels', [2, 6]], ['the top quantum', 'q0', [1, 50]], ['the top allotment', 'allot', [1, 100]], ['the boost period', 'boost', [0, 500]]]) { whole(n, a[k]); chk(n, a[k], L[k === 'q0' ? 'quantum' : k] || d); }
    }
    return out;
  }

  const kind = (C.kinds['sched-tune'] = {
    simulate, fairness, workloads, NAMES,
    modeOf, POLICIES, rtSet, horizon,
    start: (x) => Object.assign({}, defaults, { policy: (x.limits && x.limits.policies && x.limits.policies[0]) || POLICIES[modeOf(x)][0] }),
    evaluate(x, a) {
      const bad = paramProblems(x, a);
      if (bad.length) return { score: null, problems: [] };
      const ws = workloads(x), vals = ws.map((w) => metricOf(x, simulate(w, a, x.cs || 0, x)));
      const score = r3(vals.reduce((s, v) => s + v, 0) / vals.length);
      return { score, n: ws.length, details: ['Per hidden workload: ' + vals.map((v) => String(r3(v))).join(', ') + '.'] };
    },
    async evaluateAsync(x, a) { await new Promise((r) => setTimeout(r, 30)); return kind.evaluate(x, a); },
    limitsProblems(x, a) {
      const out = paramProblems(x, a);
      const L = x.limits || {};
      if (!out.length && L.minFair) {
        const worst = Math.min(...workloads(x).map((w) => fairness(simulate(w, a, x.cs || 0, x))));
        if (worst < L.minFair - 1e-9) out.push('on some hidden workload the jobs are slowed unevenly: the fairness index falls to ' + r3(worst) + ', below ' + L.minFair);
      }
      return out;
    },
    limitSentences(x) {
      const L = x.limits || {}, out = [];
      if (L.policies) out.push('Policies allowed: ' + L.policies.map((p) => NAMES[p]).join(', ') + '.');
      if (L.quantum) out.push('Quanta from ' + L.quantum[0] + ' to ' + L.quantum[1] + ' ticks.');
      if (L.levels) out.push('MLFQ levels from ' + L.levels[0] + ' to ' + L.levels[1] + '.');
      if (L.boost) out.push('Boost period from ' + L.boost[0] + ' to ' + L.boost[1] + ' ticks (0 for none).');
      if (x.cs) out.push('Every context switch costs ' + x.cs + ' tick' + (x.cs === 1 ? '' : 's') + '.');
      if (L.minFair) out.push('Fairness: on every hidden workload, Jain\'s index of the slowdowns (turnaround over the job\'s own work) is at least ' + L.minFair + '.');
      if (L.queues) out.push('Queues allowed: ' + L.queues.map((q) => (q === 'shared' ? 'one shared queue' : 'a queue per core')).join(', ') + '.');
      if (modeOf(x) === 'multi') out.push((x.cores || 2) + ' cores' + (x.migrate ? '; moving a job to another core costs ' + x.migrate + ' tick' + (x.migrate === 1 ? '' : 's') + ' to warm its cache' : '') + '.');
      out.push('Scored by the ' + (x.metricName || METRIC[x.metric || (modeOf(x) === 'rt' ? 'misses' : 'response')]) + ', the mean over ' + workloads(x).length + ' hidden ' + (modeOf(x) === 'rt' ? 'task sets' : 'workloads') + '.');
      return out;
    },
    lint(x) {
      const out = [];
      const m = x.metric || (modeOf(x) === 'rt' ? 'misses' : 'response');
      if (!METRIC[m]) out.push('unknown metric ' + x.metric);
      if (modeOf(x) === 'rt' && !['misses', 'response'].includes(m)) out.push('a real-time challenge is scored by misses or response');
      if (!workloads(x).length) out.push('no hidden workloads');
      if (m === 'util' ? x.higher === false : x.higher !== false) out.push(m === 'util' ? 'utilisation is better when higher: leave higher out' : 'a time is better when lower: give the challenge higher: false');
      for (const p of (x.limits && x.limits.policies) || []) if (!NAMES[p]) out.push('unknown policy ' + p);
      return out;
    },
    workspace(host, x, draft, onChange) { return S.SchedTuneWorkspace(host, x, draft, onChange); },
    example: () => ({
      id: 'sample-sched-tune', n: 901, title: 'A fair deal for the night shift', level: 2, kind: 'sched-tune', sample: true,
      story: 'The night shift on a small render farm mixes quick previews that an artist is waiting for with long frame renders that nobody watches. The artists complain that their previews take ages to start; the render owners complain whenever their frames are starved.\n\nPick a policy and tune it so that work starts promptly on average, without slowing some jobs far more than others.',
      task: 'Choose a policy and its parameters. Each context switch costs a tick, so a tiny quantum is not free.',
      metric: 'mix', weights: { response: 1, turnaround: 0.25 }, metricName: 'response + turnaround/4', unit: 'ticks', higher: false,
      cs: 1, hidden: { seed: 41, count: 5, n: 5, spread: 10, maxCpu: 9, maxIo: 4 },
      preview: [{ id: 'A', arrive: 0, bursts: [8] }, { id: 'B', arrive: 1, bursts: [2, 3, 2] }, { id: 'C', arrive: 2, bursts: [6] }, { id: 'D', arrive: 4, bursts: [1] }],
      limits: { policies: ['fcfs', 'prio', 'rr', 'mlfq'], quantum: [1, 12], levels: [2, 4], boost: [0, 60], minFair: 0.55 },
      target: 12.5, marks: { silver: 11.5, gold: 11 },
      hints: ['First come, first served lets one long job hold up every short one behind it: the response time suffers, and the short jobs are slowed far more than the long one.', 'Round robin starts everything quickly, but with a switch costing a tick a small quantum wastes time, and a large one drifts back towards first come, first served. No quantum reaches the target on its own.', 'An MLFQ keeps the quick start of a small quantum for short jobs and lets long jobs sink to longer quanta, where they switch less: three levels, a top quantum of 2 and a top allotment of 2, with a boost every 20 ticks, reaches silver.'],
      solution: { policy: 'mlfq', levels: 3, q0: 2, allot: 2, boost: 20 },
      wrong: [{ policy: 'fcfs' }, { policy: 'rr', quantum: 3 }, { policy: 'rr', quantum: 1 }, { policy: 'srtn' }],
    }),
    examples() {
      return [kind.example(), {
        id: 'sample-sched-tune-multi', n: 902, title: 'Two cores, no idle hands', level: 2, kind: 'sched-tune', sample: true, mode: 'multi', cores: 2, migrate: 1,
        story: 'A build server has two cores. Jobs arrive in bursts; a job moved to the other core loses a tick warming its cache.\n\nChoose how the cores share their work so that jobs start quickly.',
        task: 'Choose the queue (one shared, or one per core), the quantum and how often the queues are rebalanced.',
        metric: 'response', metricName: 'mean response time', unit: 'ticks', higher: false, cs: 0, hidden: { seed: 7, count: 4, n: 6, spread: 6, maxCpu: 7, maxIo: 3 },
        preview: [{ id: 'A', arrive: 0, bursts: [6] }, { id: 'B', arrive: 0, bursts: [2, 2, 2] }, { id: 'C', arrive: 1, bursts: [5] }, { id: 'D', arrive: 2, bursts: [1] }, { id: 'E', arrive: 3, bursts: [3] }],
        limits: { quantum: [1, 10], push: [0, 20] },
        target: 0, marks: {},
        hints: ['Long quanta keep short jobs waiting behind long ones.', 'A shared queue never leaves a core idle while a job waits, but jobs wander between cores.', 'Try the smallest quantum with each kind of queue and compare.'],
      }, {
        id: 'sample-sched-tune-rt', n: 903, title: 'Every deadline, every time', level: 1, kind: 'sched-tune', sample: true, mode: 'rt',
        story: 'A small controller runs periodic tasks whose total load is high. A missed deadline is a dropped sensor reading.\n\nChoose the scheduling rule that misses the fewest deadlines.',
        task: 'Choose rate monotonic or earliest deadline first.',
        metric: 'misses', metricName: 'deadline misses a task set', unit: '', higher: false, taskSets: [[{ id: 'A', C: 2, T: 5 }, { id: 'B', C: 4, T: 7 }], [{ id: 'A', C: 3, T: 6 }, { id: 'B', C: 4, T: 9 }], [{ id: 'A', C: 1, T: 4 }, { id: 'B', C: 2, T: 6 }, { id: 'C', C: 3, T: 8 }], [{ id: 'A', C: 2, T: 4 }, { id: 'B', C: 3, T: 7 }]],
        target: 0, marks: {},
        hints: ['Rate monotonic is only sure to meet every deadline up to a utilisation of about 0.78 for three tasks.', 'Earliest deadline first meets every deadline whenever the utilisation is at most 1.', 'Choose earliest deadline first.'],
        solution: { policy: 'edf' }, wrong: [{ policy: 'rm' }, { policy: 'rr', quantum: 2 }],
      }].map((y) => {
        if (y.mode !== 'multi') return y;
        // the target sits just above the best shared-queue score, so only a tuned answer reaches it
        const sc = (a) => kind.evaluate(y, a).score;
        const best = { policy: 'multi', queue: 'shared', quantum: 1, push: 0, pull: true };
        y.target = Math.round((sc(best) + 0.05) * 100) / 100; y.marks = {};
        y.solution = best; y.wrong = [{ policy: 'multi', queue: 'shared', quantum: 8, push: 0, pull: true }, { policy: 'fcfs' }];
        return y;
      });
    },
  });
  void kind;
})(globalThis.Proses = globalThis.Proses || {});
