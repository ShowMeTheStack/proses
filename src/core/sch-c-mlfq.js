// CPU scheduling, part 3: the multi-level feedback queue, as a pure function from a workload and parameters to a
// trace.  S.Sched.mlfq(work, {levels, quantum: [q0, q1, ..], allot: [a0, a1, ..], boost}) -> trace
// The rules:
//   - there are `levels` ready queues, Q0 the most urgent; a job always runs from the highest non-empty queue,
//     round robin within it, and a job that becomes ready in a higher queue preempts a lower one at once;
//   - a new job enters Q0;
//   - a job may use allot[k] ticks of CPU in all at level k, however it splits them up (blocking for I/O does not
//     reset the count); when it has used them it drops one level, with a fresh count; the bottom level never drops;
//   - a job that uses its whole quantum quantum[k] in a row goes to the back of its queue;
//   - every `boost` ticks (0: never) all jobs move to Q0 with fresh counts: the ready ones in queue order, Q0
//     first, then the running job, which is stopped; a job in I/O will come back into Q0.
// Rule switches, so each rule can be turned off in turn and its reason seen:
//   allotMode: 'level' (default, as above) or 'reset-io': a job that blocks for I/O before using up its allotment
//              starts with a fresh count when it comes back (the older rule, which a program can game by running
//              just under its allotment and then doing a tiny I/O: it never drops)
//   preempt:   false lets the running job finish its quantum even when a higher queue gains a job
//   boost:     0 turns the boost off (long jobs at the bottom can then starve)
//   cs: n      a context switch costs n ticks, as in S.Sched.run (not interrupted, except by a boost)
// At a tick boundary: the running job's burst end, allotment or quantum; then arrivals and I/O returns (name
// order); then the job whose quantum ended joins the back of its queue; then a boost; then preemption; then the
// pick. Ties within a queue go to the job ahead in it, which is the one that has waited longest.
// The trace is as for S.Sched.run, and each tick step also has queues [[ids] per level], level (the running
// job's), used {id: ticks used at its level} and lv {id: level}; each Gantt segment has the level it ran at.
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  /** the parameters, filled in: {levels, quantum: [..] or [q0] (doubling per level), allot: n (every level) or [..]
   *  (default two quanta), boost}; the bottom level's allotment is unlimited */
  Sch.mlfqParams = function (p) {
    p = Object.assign({ levels: 3, boost: 0 }, p || {});
    const n = Math.max(1, Math.min(8, Math.round(p.levels)));
    const quantum = [], allot = [];
    for (let k = 0; k < n; k++) {
      quantum.push(Math.max(1, Math.round((p.quantum && p.quantum[k]) || (p.quantum && p.quantum[0] ? p.quantum[0] * Math.pow(2, k) : 2 * Math.pow(2, k)))));
      const a = typeof p.allot === 'number' ? p.allot : p.allot && p.allot[k];
      allot.push(k === n - 1 ? Infinity : Math.max(quantum[k], Math.round(a || quantum[k] * (p.allotQuanta || 2))));
    }
    return { levels: n, quantum, allot, boost: Math.max(0, Math.round(p.boost || 0)), allotMode: p.allotMode === 'reset-io' ? 'reset-io' : 'level', preempt: p.preempt !== false, cs: Math.max(0, Math.round(p.cs || 0)) };
  };

  Sch.mlfq = function (work, params) {
    const P = Sch.mlfqParams(params), n = P.levels;
    const jobs = Sch.norm(work);
    const X = jobs.map((j) => ({ j, b: 0, left: j.bursts[0], lv: 0, used: 0, slice: 0, state: 'future', ioUntil: -1 }));
    const Q = Array.from({ length: n }, () => []);
    const steps = [], events = [], perTick = [], perLevel = [], finish = {}, first = {};
    let run = null, t = 0, lastOn = null, overhead = 0;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {})); };
    const join = (x) => { x.state = 'ready'; Q[x.lv].push(x); };
    const top = () => Q.findIndex((q) => q.length);
    const al = (k) => (P.allot[k] === Infinity ? 'no limit' : P.allot[k]);
    while (t < 100000) {
      const said = [];
      let expired = null, decision = null, why = '', reason = '';
      // 1. the job that ran the tick before
      if (run && !run.sw) {
        const x = run, done = x.left === 0;
        if (x.used >= P.allot[x.lv] && x.lv < n - 1 && !(done && x.b + 1 >= x.j.bursts.length)) {
          ev('demote', x, `${x.j.id} has used its allotment of ${P.allot[x.lv]} at Q${x.lv}: it drops to Q${x.lv + 1}`, { from: x.lv, to: x.lv + 1 });
          said.push(`${x.j.id} has used its allotment of \`${P.allot[x.lv]}\` at Q${x.lv}, so it drops to Q${x.lv + 1}`);
          x.lv++; x.used = 0;
          if (!done) expired = x;
        } else if (!done && x.slice >= P.quantum[x.lv]) {
          expired = x;
          said.push(`${x.j.id}'s quantum of \`${P.quantum[x.lv]}\` at Q${x.lv} is up`);
          ev('expire', x, `${x.j.id}'s quantum at Q${x.lv} is up`);
        }
        if (done) {
          if (x.b + 1 < x.j.bursts.length) {
            x.ioUntil = t + x.j.bursts[x.b + 1]; x.b += 2; x.left = x.j.bursts[x.b]; x.state = 'io';
            if (P.allotMode === 'reset-io' && x.used > 0) { said.push(`${x.j.id} blocks before using up its allotment, so its count starts again at \`0\``); ev('reset', x, `${x.j.id}'s allotment count is reset by its I/O`); x.used = 0; }
            said.push(`${x.j.id} starts I/O until t = \`${x.ioUntil}\`${P.allot[x.lv] === Infinity ? ` (no allotment at the bottom level)` : `, having used \`${x.used}\` of its ${al(x.lv)} at Q${x.lv}`}`);
            ev('block', x, `${x.j.id} blocks for I/O until t = ${x.ioUntil}`);
          } else {
            x.state = 'done'; finish[x.j.id] = t;
            said.push(`${x.j.id} finishes`); ev('finish', x, `${x.j.id} finishes at t = ${t}`);
          }
        }
        if (done || expired) run = null;
      }
      // 2. arrivals and returns from I/O, in name order
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) { const back = x.state === 'io'; join(x); ev(back ? 'io-done' : 'arrive', x, back ? `${x.j.id} is back from I/O, into Q${x.lv}` : `${x.j.id} arrives in Q0`); }
      if (come.length) said.push(come.map((x) => x.j.id + (x.b > 0 ? ` is back from I/O into Q${x.lv}` : ' arrives in Q0')).join(', '));
      // 3. the job whose quantum ended goes to the back of its queue
      if (expired) join(expired);
      // 4. the boost: every queue, in order, then the running job, into Q0
      let boosted = false;
      if (P.boost > 0 && t > 0 && t % P.boost === 0) {
        const all = [].concat(...Q);
        if (run) { all.push(run); run = null; }
        for (const q of Q) q.length = 0;
        for (const x of all) { x.lv = 0; x.used = 0; join(x); }
        // jobs in I/O are lifted too: they come back into Q0
        const away = X.filter((x) => x.state === 'io');
        for (const x of away) { x.lv = 0; x.used = 0; }
        const ids = all.concat(away).map((x) => x.j.id).sort();
        if (ids.length) {
          boosted = true;
          said.push(`the boost every ${Sch.sv(P.boost, 'tick')} lifts ${Sch.list(ids)} to Q0 with fresh allotments`);
          ev('boost', null, `boost: ${Sch.list(ids)} ${ids.length === 1 ? 'goes' : 'go'} to Q0`, { ids });
        }
      }
      // 5. a job ready in a higher queue preempts the running one, which goes to the back of its own queue
      if (run && !run.sw && P.preempt && top() >= 0 && top() < run.lv) {
        const x = run;
        said.push(`Q${top()} is no longer empty, so ${x.j.id} (at Q${x.lv}) is preempted and goes to the back of Q${x.lv}`);
        ev('preempt', x, `${x.j.id} is preempted by a job in Q${top()}`);
        join(x); run = null; decision = 'preempt';
      }
      if (run) {
        decision = 'continue';
        reason = `${run.j.id} runs on at Q${run.lv}: tick ${run.slice + 1} of its quantum of \`${P.quantum[run.lv]}\`${P.allot[run.lv] === Infinity ? ' (no allotment at the bottom level)' : `, \`${run.used}\` of its ${al(run.lv)} used`}`;
        why = `${run.j.id} runs on at Q${run.lv}`;
      }
      // 6. the pick: the head of the highest non-empty queue
      const k = top();
      if (!run && k >= 0) {
        const x = Q[k].shift();
        const rest = Q[k].map((y) => y.j.id);
        x.state = 'running'; x.slice = 0; run = x;
        x.sw = P.cs && lastOn && lastOn !== x ? P.cs : 0; lastOn = x;
        if (x === expired && !boosted) { decision = 'renew'; reason = `${x.j.id} runs on at Q${k}: no other job is ready at Q${k} or above`; why = `${x.j.id} runs on at Q${k}`; }
        else {
          const pre = decision === 'preempt';
          decision = pre ? 'preempt' : 'dispatch';
          const above = k > 0 ? `Q0${k > 1 ? ' to Q' + (k - 1) : ''} ${k > 1 ? 'are' : 'is'} empty, so ` : '';
          reason = `${above}${x.j.id} runs from Q${k}` + (rest.length ? `, the head of ${Sch.qtext([x.j.id].concat(rest))},` : '') + ` with a quantum of \`${P.quantum[k]}\` ` + (P.allot[k] === Infinity ? '(no allotment at the bottom level)' : `(\`${x.used}\` of its ${al(k)} used)`);
          why = `${x.j.id} runs from Q${k}`;
        }
        ev('dispatch', x, reason, { level: k });
      }
      const live = X.filter((x) => x.state !== 'done');
      if (!live.length) { steps.push({ kind: 'end', t, run: null, level: null, queues: Q.map(() => []), io: [], decision: 'end', why: 'all done', boosted, used: {}, lv: {}, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` }); break; }
      if (!run) {
        decision = 'idle'; why = 'idle: nothing is ready';
        const io = X.filter((x) => x.state === 'io').sort((a, b) => a.ioUntil - b.ioUntil), fut = X.filter((x) => x.state === 'future').sort((a, b) => a.j.arrive - b.j.arrive);
        reason = 'the CPU idles: nothing is ready (' + [io.length ? `${io[0].j.id} is in I/O until t = \`${io[0].ioUntil}\`` : null, fut.length ? `${fut[0].j.id} arrives at t = \`${fut[0].j.arrive}\`` : null].filter(Boolean).join(', ') + ')';
      }
      const used = {}, lv = {};
      for (const x of X) if (x.state !== 'future' && x.state !== 'done') { used[x.j.id] = x.used; lv[x.j.id] = x.lv; }
      steps.push({ kind: 'tick', t, run: run ? run.j.id : null, level: run ? run.lv : null, queues: Q.map((q) => q.map((x) => x.j.id)), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), decision, why, boosted, used, lv, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}${reason}.` });
      if (run && run.sw) { perTick.push('~' + run.j.id); perLevel.push(run.lv); run.sw--; overhead++; }
      else {
        perTick.push(run ? run.j.id : null); perLevel.push(run ? run.lv : null);
        if (run) { if (first[run.j.id] === undefined) first[run.j.id] = t; run.left--; run.used++; run.slice++; }
      }
      t++;
    }
    const segs = Sch.segments(perTick, perLevel);
    return { policy: 'mlfq', name: 'MLFQ', params: P, jobs, steps, events, segs, metrics: Sch.metrics(jobs, finish, first, { end: t, overhead }), end: t };
  };
})(globalThis.Proses = globalThis.Proses || {});
