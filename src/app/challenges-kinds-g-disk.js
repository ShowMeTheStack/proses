// Challenge kind 'disk-sched': a disk-arm schedule within a seek budget.
//   x: {kind: 'disk-sched', cases: [{start, cylinders, dir, requests: [cyl..]}] or hidden: {seed, count, n,
//       cylinders} (queues made from a seed), queue: {start, cylinders, dir, requests} (one visible queue: the answer
//       may then be an explicit order of it), limits: {policies: [..], maxPassed: k (no request may be overtaken by
//       more than k requests queued after it), order: true (an explicit order is allowed)}}
//   answer: {policy, dir: 'up' | 'down'} or {order: [request indexes]} (a permutation of the visible queue)
//   score: the arm's total movement in cylinders, the mean over the cases (lower is better)
(function (S) {
  'use strict';
  const C = S.Challenges;
  const NAMES = { fcfs: 'FCFS', sstf: 'SSTF', scan: 'SCAN', cscan: 'C-SCAN', look: 'LOOK', clook: 'C-LOOK' };

  function cases(x) {
    if (x.queue) return [x.queue];
    if (x.cases) return x.cases;
    const g = x.hidden || {}, out = [];
    for (let k = 0; k < (g.count || 3); k++) {
      const r = S.Sched.rng((g.seed || 1) * 7919 + k), cyl = g.cylinders || 200, int = (n) => Math.floor(r() * n);
      out.push({ start: int(cyl), cylinders: cyl, dir: r() < 0.5 ? 'up' : 'down', requests: Array.from({ length: g.n || 10 }, () => int(cyl)) });
    }
    return out;
  }
  /** the order a policy serves a queue in: [request indexes] and the movement */
  function serve(q, a) {
    if (a.order) {
      let at = q.start, mv = 0;
      for (const i of a.order) { mv += Math.abs(q.requests[i] - at); at = q.requests[i]; }
      return { order: a.order.slice(), movement: mv };
    }
    const r = S.Storage.schedule(a.policy, { requests: q.requests.slice(), start: q.start, cylinders: q.cylinders, dir: a.dir || q.dir || 'up' });
    return { order: r.served.map((s) => s.id), movement: r.totals.movement };
  }
  /** for each request, how many requests queued after it were served before it; the largest */
  function maxPassed(order) {
    let worst = 0;
    order.forEach((i, pos) => { const n = order.slice(0, pos).filter((j) => j > i).length; worst = Math.max(worst, n); });
    return worst;
  }
  function shape(x, a) {
    const L = x.limits || {};
    if (!a) return ['choose a policy or give an order'];
    if (a.order) {
      if (!L.order || !x.queue) return ['this challenge asks for a policy, not an order'];
      const n = x.queue.requests.length, ok = Array.isArray(a.order) && a.order.length === n && [...a.order].sort((p, q) => p - q).every((v, i) => v === i);
      return ok ? [] : ['the order must list every request of the queue exactly once (' + n + ' of them)'];
    }
    if (!NAMES[a.policy]) return ['choose a policy'];
    if (L.policies && !L.policies.includes(a.policy)) return [NAMES[a.policy] + ' is not one of the policies allowed here (' + L.policies.map((p) => NAMES[p]).join(', ') + ')'];
    if (a.dir && a.dir !== 'up' && a.dir !== 'down') return ['the direction is up or down'];
    return [];
  }

  C.kinds['disk-sched'] = {
    cases, serve, maxPassed, NAMES,
    start: (x) => ({ policy: ((x.limits && x.limits.policies) || ['fcfs'])[0], dir: 'up' }),
    evaluate(x, a) {
      if (shape(x, a).length) return { score: null };
      const cs = cases(x), runs = cs.map((q) => serve(q, a));
      const score = Math.round((runs.reduce((s, r) => s + r.movement, 0) / runs.length) * 100) / 100;
      return { score, n: cs.length, details: ['Movement per queue: ' + runs.map((r) => r.movement).join(', ') + ' cylinders.'] };
    },
    limitsProblems(x, a) {
      const out = shape(x, a), L = x.limits || {};
      if (out.length || L.maxPassed === undefined) return out;
      for (const q of cases(x)) { const m = maxPassed(serve(q, a).order); if (m > L.maxPassed) { out.push('some request is overtaken by ' + m + ' requests queued after it, more than the ' + L.maxPassed + ' allowed'); break; } }
      return out;
    },
    limitSentences(x) {
      const L = x.limits || {}, out = [];
      if (L.policies) out.push('Policies allowed: ' + L.policies.map((p) => NAMES[p]).join(', ') + (L.order && x.queue ? ', or your own order of the queue' : '') + '.');
      if (L.maxPassed !== undefined) out.push('No request may be overtaken by more than ' + L.maxPassed + ' requests that were queued after it.');
      out.push(x.queue ? 'Scored on the queue shown.' : 'Scored by the mean movement over ' + cases(x).length + ' hidden queues.');
      return out;
    },
    lint(x) {
      const out = [];
      if (!cases(x).length) out.push('no queues');
      if (x.higher !== false) out.push('movement is better when less: give the challenge higher: false');
      return out;
    },
    workspace(host, x, draft, onChange) { return S.DiskSchedWorkspace(host, x, draft, onChange); },
    example: () => ({
      id: 'sample-disk-budget', n: 904, title: 'The archive arm', level: 1, kind: 'disk-sched', sample: true,
      story: 'A library keeps its scanned maps on an old disk whose arm wears out by the cylinder. The night jobs ask for scattered maps, and the curator has a budget of arm travel per batch. But a map request that waits behind a crowd of newer ones makes a reader complain.\n\nChoose how the arm serves each batch.',
      task: 'Choose a disk-arm policy and the direction the arm starts in.',
      metricName: 'mean arm movement', unit: 'cylinders', higher: false,
      hidden: { seed: 5, count: 4, n: 10, cylinders: 200 },
      limits: { policies: ['fcfs', 'scan', 'cscan', 'look', 'clook'] },
      target: 235, marks: { silver: 215, gold: 200 },
      hints: ['First come, first served sends the arm back and forth across the disk: every request can be far from the one before.', 'A sweep (SCAN or LOOK) serves everything on its way, so the arm crosses the disk about once. LOOK turns at the last request instead of the edge.', 'The circular sweeps pay for the jump back. LOOK starting upwards moves about 199 cylinders a batch on these queues.'],
      solution: { policy: 'look', dir: 'up' },
      wrong: [{ policy: 'fcfs', dir: 'up' }, { policy: 'scan', dir: 'up' }, { policy: 'cscan', dir: 'up' }, { policy: 'sstf', dir: 'up' }],
    }),
  };
})(globalThis.Proses = globalThis.Proses || {});
