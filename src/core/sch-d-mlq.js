// CPU scheduling, part 4: the multilevel queue, with fixed classes.
//   S.Sched.mlq(work, {classes: [{name, policy: 'fcfs' | 'rr', quantum}], mode: 'strict' | 'share', shares: [w0, w1, ..],
//                      window, cs}) -> trace
// Every job belongs to one class for its whole life (job.cls, 0 the most important; a class past the last is the
// last). Each class has its own ready queue and its own policy inside it: fcfs, or rr with its quantum.
//   mode 'strict': a class runs only when every more important class is empty, and a job arriving in a more
//                  important class preempts at once (the preempted job goes to the back of its queue);
//   mode 'share':  the CPU is shared out in windows of `window` ticks (default 10): class k may use
//                  shares[k] / Σ shares of each window (rounded, largest remainders first, so the budgets add up
//                  to the window). The most important class that still has budget and a ready job runs; when no
//                  class with budget has a ready job, the most important class with a ready job runs anyway (the
//                  CPU never idles while a job is ready). A job whose class runs out of budget is preempted by a
//                  class that still has some. Budgets refill at every multiple of the window.
// The order of events at a tick, the tie rule and the trace are as for S.Sched.run (sch-a-work.js); each step
// also has queues [[ids] per class], cls (the running job's class) and, in share mode, budget [ticks left per
// class]; each segment has its cls.
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  Sch.MLQ_CLASSES = [{ name: 'system', policy: 'fcfs' }, { name: 'interactive', policy: 'rr', quantum: 2 }, { name: 'batch', policy: 'fcfs' }];

  /** budgets per window from shares, adding up to the window exactly */
  Sch.mlqBudgets = function (shares, window) {
    const tot = shares.reduce((a, b) => a + b, 0) || 1;
    const raw = shares.map((s) => (s / tot) * window), out = raw.map(Math.floor);
    let rest = window - out.reduce((a, b) => a + b, 0);
    const order = raw.map((r, k) => [r - Math.floor(r), k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let i = 0; rest > 0; i++, rest--) out[order[i % order.length][1]]++;
    return out;
  };

  Sch.mlq = function (work, params) {
    const P = Object.assign({ classes: Sch.MLQ_CLASSES, mode: 'strict', window: 10, cs: 0 }, params || {});
    const C = P.classes.map((c) => ({ name: c.name, policy: c.policy === 'rr' ? 'rr' : 'fcfs', quantum: Math.max(1, Math.round(c.quantum || 2)) }));
    const n = C.length, share = P.mode === 'share';
    P.shares = (P.shares || C.map((_, k) => n - k)).slice(0, n);
    while (P.shares.length < n) P.shares.push(1);
    P.window = Math.max(n, Math.round(P.window));
    const full = share ? Sch.mlqBudgets(P.shares, P.window) : null;
    const jobs = Sch.norm(work);
    const X = jobs.map((j) => ({ j, c: Math.min(n - 1, j.cls), b: 0, left: j.bursts[0], slice: 0, state: 'future', ioUntil: -1, sw: 0 }));
    const Q = C.map(() => []), steps = [], events = [], perTick = [], perCls = [], finish = {}, first = {};
    let run = null, t = 0, lastOn = null, overhead = 0, budget = full ? full.slice() : null;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {})); };
    const join = (x) => { x.state = 'ready'; Q[x.c].push(x); };
    const load = (x) => { x.state = 'running'; x.slice = 0; x.sw = P.cs && lastOn && lastOn !== x ? P.cs : 0; lastOn = x; };
    /** the class that should run now: in strict mode the most important non-empty one; in share mode the most
     *  important with budget and a job, else the most important with a job */
    const want = (extra) => {
      const has = (k) => Q[k].length || (extra && extra.c === k);
      if (share) for (let k = 0; k < n; k++) if (budget[k] > 0 && has(k)) return k;
      for (let k = 0; k < n; k++) if (has(k)) return k;
      return -1;
    };
    while (t < 100000) {
      const said = [];
      let expired = null, decision = null, reason = '', why = '';
      if (run && !run.sw) {
        const x = run;
        if (x.left === 0) {
          if (x.b + 1 < x.j.bursts.length) { x.ioUntil = t + x.j.bursts[x.b + 1]; x.b += 2; x.left = x.j.bursts[x.b]; x.state = 'io'; said.push(`${x.j.id} starts I/O until t = \`${x.ioUntil}\``); ev('block', x, `${x.j.id} blocks for I/O until t = ${x.ioUntil}`); }
          else { x.state = 'done'; finish[x.j.id] = t; said.push(`${x.j.id} finishes`); ev('finish', x, `${x.j.id} finishes at t = ${t}`); }
          run = null;
        } else if (C[x.c].policy === 'rr' && x.slice >= C[x.c].quantum) { expired = x; run = null; said.push(`${x.j.id}'s quantum of \`${C[x.c].quantum}\` is up`); ev('expire', x, `${x.j.id}'s quantum is up`); }
      }
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) { const back = x.state === 'io'; join(x); ev(back ? 'io-done' : 'arrive', x, `${x.j.id} ${back ? 'is back from I/O' : 'arrives'} in the ${C[x.c].name} queue`); }
      if (come.length) said.push(come.map((x) => `${x.j.id} ${x.b > 0 ? 'is back from I/O' : 'arrives'} (${C[x.c].name})`).join(', '));
      if (expired) join(expired);
      if (share && t > 0 && t % P.window === 0) { budget = full.slice(); said.push(`a new window of ${Sch.sv(P.window, 'tick')} refills the budgets to ${budget.join(':')}`); ev('refill', null, `budgets refilled: ${budget.join(', ')}`); }
      if (run && !run.sw) {
        const k = want(run);
        if (k !== run.c) {
          const x = run;
          said.push(share && budget[x.c] <= 0 ? `the ${C[x.c].name} class has used its share of the window, so ${x.j.id} is preempted for the ${C[k].name} class` : `the ${C[k].name} class outranks ${C[x.c].name}, so ${x.j.id} is preempted`);
          ev('preempt', x, `${x.j.id} is preempted by the ${C[k].name} class`);
          join(x); run = null; decision = 'preempt';
        }
      }
      if (run) {
        decision = 'continue';
        why = run.sw ? `switching to ${run.j.id}` : `${run.j.id} runs on (${C[run.c].name})`;
        reason = run.sw ? `the switch to ${run.j.id} goes on` : `${run.j.id} runs on in the ${C[run.c].name} class, \`${run.left}\` left of its burst`;
      }
      const k = want(null);
      if (!run && k >= 0) {
        const x = Q[k].shift();
        load(x); run = x;
        const pre = decision === 'preempt';
        decision = x === expired ? 'renew' : pre ? 'preempt' : 'dispatch';
        const above = [];
        for (let i = 0; i < k; i++) above.push(Q[i].length ? (share ? `${C[i].name} has no budget left` : null) : `${C[i].name} is empty`);
        reason = (above.filter(Boolean).length ? above.filter(Boolean).join(', ') + ', so ' : '') + `${x.j.id} runs from the ${C[k].name} queue (${C[k].policy === 'rr' ? 'round robin, quantum ' + C[k].quantum : 'first come, first served'})` + (share ? `, with \`${budget[k]}\` of its ${Sch.s(full[k], 'tick')} left in this window` : '');
        if (share && budget[k] <= 0) reason += '; no class with budget has a job, so the CPU is not left idle';
        why = `${x.j.id} runs (${C[k].name})`;
        ev('dispatch', x, reason, { cls: k });
      }
      if (!X.some((x) => x.state !== 'done')) { steps.push({ kind: 'end', t, run: null, cls: null, queues: Q.map(() => []), io: [], decision: 'end', why: 'all done', say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` }); break; }
      if (!run) { decision = 'idle'; why = 'idle: nothing is ready'; reason = 'the CPU idles: nothing is ready'; }
      const st = { kind: 'tick', t, run: run ? run.j.id : null, cls: run ? run.c : null, queues: Q.map((q) => q.map((x) => x.j.id)), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), decision, why, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}${reason}.` };
      if (share) st.budget = budget.slice();
      if (run && run.sw) st.cs = true;
      steps.push(st);
      if (run && run.sw) { perTick.push('~' + run.j.id); perCls.push(run.c); run.sw--; overhead++; if (share) budget[run.c] = Math.max(0, budget[run.c] - 1); }
      else {
        perTick.push(run ? run.j.id : null); perCls.push(run ? run.c : null);
        if (run) { if (first[run.j.id] === undefined) first[run.j.id] = t; run.left--; run.slice++; if (share) budget[run.c] = Math.max(0, budget[run.c] - 1); }
      }
      t++;
    }
    return { policy: 'mlq', name: 'MLQ (' + (share ? 'shares ' + P.shares.join(':') : 'strict') + ')', params: Object.assign({}, P, { classes: C, budgets: full }), jobs, steps, events, segs: Sch.segments(perTick, perCls, 'cls'), metrics: Sch.metrics(jobs, finish, first, { end: t, overhead }), end: t };
  };
})(globalThis.Proses = globalThis.Proses || {});
