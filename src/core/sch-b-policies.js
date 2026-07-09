// CPU scheduling, part 2: the single-queue policies as pure functions from a workload and parameters to a trace.
//   S.Sched.run(work, 'fcfs' | 'sjf' | 'srtn' | 'prio' | 'rr', params) -> trace (see sch-a-work.js)
//   fcfs  first come, first served: the head of the ready queue runs until its burst ends
//   sjf   shortest job first: the ready job with the shortest next CPU burst runs until its burst ends (the
//         scheduler is told each burst's length exactly: the ideal that real systems can only estimate)
//   srtn  shortest remaining time next: as sjf, but a job that becomes ready with strictly less left than the
//         running job's remaining time preempts it
//   prio  priority: lower number is more urgent. params {preemptive: bool, age: n}: with age > 0 a waiting job's
//         priority number drops by 1 for every n ticks it has waited since it last joined the ready queue (never
//         below 0); a running job keeps the priority it was dispatched with until it leaves the CPU
//   rr    round robin: params {quantum: q}; a job that uses q ticks in a row goes to the back of the queue
// Options for every policy:
//   cs: n         a context switch costs n ticks: whenever the CPU starts a job other than the one that last ran
//                 on it, n ticks of overhead pass before the job's first tick (segments with cs: true, steps with
//                 cs: true); a switch, once begun, is not interrupted; metrics.overhead counts these ticks
// Options for sjf and srtn:
//   predict: {alpha, tau0}   the scheduler does not know burst lengths: it predicts each job's next CPU burst by
//                 exponential averaging, tau(n+1) = alpha * t(n) + (1 - alpha) * tau(n), starting from tau0, and
//                 ranks by the prediction (srtn: the prediction less what the job has run of this burst, never
//                 below 0); left out, the scheduler is an oracle that knows every burst. The trace then has
//                 predictions [{job, burst, predicted, actual, next}] and each step pred {id: tau}
// Options for prio (aging rules):
//   age: n        every n ticks of waiting improve a job's priority number by ageBy (default 1), never below
//                 ageFloor (default 0)
//   ageFrom       'joined' (default): the waiting counted since the job last joined the ready queue, so each
//                 dispatch resets it; 'arrival': all the time it has spent waiting since it arrived, never reset
// A running job keeps the priority it was dispatched with until it leaves the CPU.
// The tie rule and the order of events at a tick are in sch-a-work.js.
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  const NAMES = { fcfs: 'FCFS', sjf: 'SJF', srtn: 'SRTN', prio: 'Priority', rr: 'RR' };
  Sch.NAMES = NAMES;

  /** the policy's measure for a ready job at time t (lower is better), or null for queue order */
  function measure(policy, P) {
    if (policy === 'sjf' || policy === 'srtn') {
      if (P.predict) return policy === 'sjf' ? (x) => x.tau : (x) => Math.max(0, x.tau - x.ran);
      return (x) => x.left;
    }
    if (policy === 'prio') {
      if (!(P.age > 0)) return (x) => x.j.prio;
      const by = P.ageBy === undefined ? 1 : P.ageBy, floor = P.ageFloor === undefined ? 0 : P.ageFloor;
      return (x, t) => {
        const w = P.ageFrom === 'arrival' ? x.waited + (x.state === 'ready' ? t - x.since : 0) : t - x.since;
        return Math.max(Math.min(floor, x.j.prio), x.j.prio - by * Math.floor(w / P.age));
      };
    }
    return null;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const WHAT = { sjf: 'next CPU burst', srtn: 'remaining time', prio: 'priority' };

  Sch.run = function (work, policy, params) {
    const P = Object.assign({ quantum: 2, preemptive: false, age: 0, cs: 0 }, params || {});
    P.cs = Math.max(0, Math.round(P.cs || 0));
    if (P.predict) P.predict = { alpha: P.predict.alpha === undefined ? 0.5 : +P.predict.alpha, tau0: P.predict.tau0 === undefined ? 5 : +P.predict.tau0 };
    if (policy === 'rr') P.quantum = Math.max(1, Math.round(P.quantum));
    const preemptive = policy === 'srtn' || (policy === 'prio' && !!P.preemptive);
    const key = measure(policy, P);
    const jobs = Sch.norm(work);
    const X = jobs.map((j) => ({ j, b: 0, left: j.bursts[0], since: 0, slice: 0, state: 'future', ioUntil: -1, cur: null, tau: P.predict ? P.predict.tau0 : 0, ran: 0, waited: 0, sw: 0 }));
    const ready = [], steps = [], events = [], perTick = [], finish = {}, first = {}, predictions = [];
    let run = null, t = 0, lastOn = null, overhead = 0;
    const ev = (kind, x, say, more) => { const e = Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {}); events.push(e); return e; };
    const runVal = (x) => (policy === 'srtn' ? key(x, t) : x.cur);
    const fmtK = (v) => String(r2(v));
    /** a job takes the CPU: a context switch first if it is not the job that ran last */
    const load = (x) => { x.state = 'running'; x.slice = 0; x.sw = P.cs && lastOn && lastOn !== x ? P.cs : 0; lastOn = x; };
    /** the best ready job and the jobs it tied with */
    function best() {
      if (!key) return { x: ready[0], ties: [] };
      let b = ready[0];
      for (const x of ready) if (key(x, t) < key(b, t)) b = x;
      return { x: b, ties: ready.filter((x) => x !== b && key(x, t) === key(b, t)) };
    }
    const take = (x) => { ready.splice(ready.indexOf(x), 1); };
    const join = (x) => { x.state = 'ready'; x.since = t; ready.push(x); };
    const leave = (x) => { x.waited += t - x.since; };
    /** a CPU burst ended: learn from it */
    const learn = (x) => {
      if (!P.predict) return;
      const actual = x.j.bursts[x.b], next = P.predict.alpha * actual + (1 - P.predict.alpha) * x.tau;
      predictions.push({ job: x.j.id, burst: x.b / 2, predicted: r2(x.tau), actual, next: r2(next) });
      ev('predict', x, `${x.j.id}'s burst was ${actual} against a prediction of ${r2(x.tau)}: the next prediction is ${P.predict.alpha} × ${actual} + ${r2(1 - P.predict.alpha)} × ${r2(x.tau)} = ${r2(next)}`, { predicted: r2(x.tau), actual, next: r2(next) });
      x.tau = next; x.ran = 0;
    };
    const limit = 100000;
    while (t < limit) {
      const said = [], brief = [];
      let expired = null, prev = run;
      // 1. the job that ran the tick before
      if (run && !run.sw) {
        if (run.left === 0) {
          learn(run);
          if (run.b + 1 < run.j.bursts.length) {
            run.ioUntil = t + run.j.bursts[run.b + 1]; run.b += 2; run.left = run.j.bursts[run.b]; run.state = 'io';
            said.push(`${run.j.id} starts I/O until t = \`${run.ioUntil}\``); brief.push(`${run.j.id} to I/O`); ev('block', run, `${run.j.id} blocks for I/O until t = ${run.ioUntil}`);
          } else {
            run.state = 'done'; finish[run.j.id] = t;
            said.push(`${run.j.id} finishes`); brief.push(`${run.j.id} done`); ev('finish', run, `${run.j.id} finishes at t = ${t}`);
          }
          run = null;
        } else if (policy === 'rr' && run.slice >= P.quantum) { expired = run; run = null; }
      }
      // 2. arrivals and returns from I/O, in name order
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) {
        const back = x.state === 'io';
        join(x);
        ev(back ? 'io-done' : 'arrive', x, back ? `${x.j.id} is back from I/O` : `${x.j.id} arrives`);
      }
      if (come.length) said.push(come.map((x) => x.j.id + (x.b > 0 ? ' is back from I/O' : ' arrives')).join(', '));
      // 3. a job whose quantum ran out goes to the back
      let decision, why, reason;
      if (expired) {
        if (!ready.length) { run = expired; run.slice = 0; decision = 'renew'; why = `${run.j.id} runs on: no one else is ready`; reason = `${run.j.id}'s quantum of \`${P.quantum}\` is up but nothing else is ready, so it runs on with a new quantum`; ev('renew', run, reason); }
        else { join(expired); ev('expire', expired, `${expired.j.id}'s quantum of ${P.quantum} is up: it goes to the back`); said.push(`${expired.j.id}'s quantum of \`${P.quantum}\` is up, so it goes to the back`); brief.push(`${expired.j.id} to the back`); }
      }
      // 4. preemption, only by a strictly better job
      if (run && !run.sw && preemptive && ready.length && decision !== 'renew') {
        const { x: b, ties } = best();
        const rv = runVal(run);
        if (key(b, t) < rv) {
          const old = run;
          join(old); old.cur = null;
          b.cur = key(b, t); leave(b); take(b); run = b; load(b);
          decision = 'preempt';
          reason = `${b.j.id} preempts ${old.j.id}: ${b.j.id}'s ${WHAT[policy]} \`${fmtK(b.cur)}\` beats ${old.j.id}'s \`${fmtK(rv)}\`` + (ties.length ? `, and ${b.j.id} wins the tie with ${Sch.list(ties.map((x) => x.j.id))} by having waited longer` : '') + `, so ${old.j.id} goes to the back`;
          why = `${b.j.id} preempts ${old.j.id} (${fmtK(b.cur)} < ${fmtK(rv)})`;
          ev('preempt', b, reason, { from: old.j.id });
        } else if (come.length) {
          decision = 'keep';
          const bv = key(b, t);
          reason = `${run.j.id} keeps the CPU: the best waiting job, ${b.j.id}, has ${WHAT[policy]} \`${fmtK(bv)}\`, ${policy === 'prio' ? 'no more urgent' : 'no shorter'} than ${run.j.id}'s \`${fmtK(rv)}\``;
          why = `${run.j.id} keeps the CPU (${fmtK(rv)} ≤ ${fmtK(bv)})`;
        }
      }
      if (run && !decision) {
        decision = 'continue';
        if (run.sw) { why = `switching to ${run.j.id}`; reason = `the switch to ${run.j.id} goes on, \`${run.sw}\` ${run.sw === 1 ? 'tick' : 'ticks'} of overhead left`; }
        else {
          why = `${run.j.id} runs on (${run.left} left)`;
          reason = `${run.j.id} runs on, \`${run.left}\` left of its burst` + (policy === 'rr' ? `, tick ${run.slice + 1} of its quantum` : '');
        }
      }
      // 5. the CPU is free: pick
      if (!run && ready.length) {
        const { x: b, ties } = best();
        const others = ready.filter((x) => x !== b);
        const qbefore = ready.map((x) => x.j.id);
        const kvals = key ? ready.map((x) => `${x.j.id} (${fmtK(key(x, t))})`) : null;
        b.cur = key ? key(b, t) : null; leave(b); take(b); run = b; load(b);
        decision = 'dispatch';
        if (!others.length) { reason = `${b.j.id} runs, the only job ready`; why = `${b.j.id} runs: the only one ready`; }
        else if (!key) { reason = `${b.j.id} runs, first in the ready queue ${Sch.qtext(qbefore)}`; why = `${b.j.id} runs: first in the queue`; }
        else {
          const lowest = policy === 'prio' ? 'most urgent' : 'shortest';
          const what = (P.predict ? 'predicted ' : '') + WHAT[policy];
          reason = `${b.j.id} runs: its ${what} \`${fmtK(b.cur)}\` is the ${lowest} of ${Sch.list(kvals)}` + (ties.length ? `; it ties with ${Sch.list(ties.map((x) => x.j.id))} and wins by having waited longer` : '');
          why = `${b.j.id} runs: ${lowest} ${what} (${fmtK(b.cur)})` + (ties.length ? ', won a tie' : '');
        }
        ev('dispatch', b, reason);
      }
      if (run && run.sw && (decision === 'dispatch' || decision === 'preempt')) { reason += `, after a context switch of ${Sch.sv(P.cs, 'tick')}`; ev('switch', run, `switching to ${run.j.id} costs ${Sch.s(P.cs, 'tick')}`); }
      const left = X.filter((x) => x.state !== 'done');
      if (!left.length) {
        steps.push({ kind: 'end', t, run: null, ready: [], io: [], decision: 'end', why: 'all done', say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` });
        break;
      }
      if (!run) {
        decision = 'idle';
        const io = X.filter((x) => x.state === 'io').sort((a, b) => a.ioUntil - b.ioUntil), fut = X.filter((x) => x.state === 'future').sort((a, b) => a.j.arrive - b.j.arrive);
        const next = [io.length ? `${io[0].j.id} is in I/O until t = \`${io[0].ioUntil}\`` : null, fut.length ? `${fut[0].j.id} arrives at t = \`${fut[0].j.arrive}\`` : null].filter(Boolean);
        reason = `the CPU idles: nothing is ready (${next.join(', ')})`;
        why = 'idle: nothing is ready';
      }
      const step = { kind: 'tick', t, run: run ? run.j.id : null, ready: ready.map((x) => x.j.id), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), decision, why: brief.concat([why]).join('; '), prev: prev ? prev.j.id : null };
      if (run && run.sw) step.cs = true;
      if (P.predict) { step.pred = {}; for (const x of X) if (x.state !== 'done') step.pred[x.j.id] = r2(x.tau); }
      step.say = `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}${reason}.`;
      steps.push(step);
      if (run && run.sw) { perTick.push('~' + run.j.id); run.sw--; overhead++; }
      else {
        perTick.push(run ? run.j.id : null);
        if (run) { if (first[run.j.id] === undefined) first[run.j.id] = t; run.left--; run.slice++; run.ran++; }
      }
      t++;
    }
    const segs = Sch.segments(perTick);
    const tr = { policy, name: NAMES[policy] + (policy === 'rr' ? ' q = ' + P.quantum : ''), params: P, jobs, steps, events, segs, metrics: Sch.metrics(jobs, finish, first, { end: t, overhead }), end: t };
    if (P.predict) tr.predictions = predictions;
    return tr;
  };
})(globalThis.Proses = globalThis.Proses || {});
