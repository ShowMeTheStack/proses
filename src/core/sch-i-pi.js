// CPU scheduling, part 9: priority inversion, and the protocols that bound it.
//   S.Sched.inversion(tasks, {protocol: 'none' | 'inherit' | 'ceiling'}) -> trace
//   S.Sched.PI_TASKS: the default: L (priority 3) locks mtx for 4 ticks; H (1) arrives and needs mtx; M (2) only
//   computes, for 6 ticks
// A task is {id, prio, arrive, script: [['run', n], ['lock', 'mtx'], ['run', n], ['unlock', 'mtx'], ...]}; a lower prio
// number is more urgent. Scheduling is preemptive by effective priority on one CPU: the most urgent ready task runs
// (a running task keeps the CPU on a tie; among waiting tasks, the one ready first, then the one listed first).
// lock and unlock take no time: they happen at a tick boundary, when the task reaches them while it is on the CPU
// (a task whose next step is a lock does it when it is next picked). A lock of a mutex
// that is held blocks the task in the mutex's queue; unlock hands the mutex to the most urgent waiter (ties:
// the one that waited first), which becomes ready.
//   none     effective priority = base priority: a middle task can run while the urgent task waits for a mutex
//            held by the least urgent one (unbounded priority inversion);
//   inherit  a task holding a mutex runs at the most urgent priority of the tasks blocked on it (through chains);
//   ceiling  a task holding a mutex runs at that mutex's ceiling, the most urgent base priority of any task whose
//            script locks it (the immediate priority-ceiling idea), from the moment it locks.
// The trace: steps [{kind: 'tick', t, run, ready, blocked: [{id, on}], holders {mutex: id}, waiters {mutex: [ids]},
// eff {id: prio}, decision, say}], events, segs [{job, start, end, boosted}] (boosted: running above its own
// priority), metrics.rows [{id, prio, arrive, finish, response, turnaround, blockedOnMutex, inversion}] where
// inversion counts the ticks the task was waiting (ready or blocked) while a task of less urgent base priority ran.
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  Sch.PI_TASKS = [
    { id: 'L', prio: 3, arrive: 0, script: [['run', 1], ['lock', 'mtx'], ['run', 4], ['unlock', 'mtx'], ['run', 1]] },
    { id: 'H', prio: 1, arrive: 3, script: [['run', 1], ['lock', 'mtx'], ['run', 2], ['unlock', 'mtx'], ['run', 1]] },
    { id: 'M', prio: 2, arrive: 4, script: [['run', 6]] },
  ];

  Sch.inversion = function (tasks, params) {
    tasks = tasks || Sch.PI_TASKS;
    const P = Object.assign({ protocol: 'none' }, params || {});
    const T = tasks.map((k, i) => ({ id: k.id, idx: i, prio: k.prio, arrive: k.arrive || 0, ops: k.script.map((o) => o.slice()), pc: 0, left: 0, state: 'future', on: null, since: 0, holds: [], finish: null, first: null, blockedTicks: 0, inv: 0 }));
    for (const x of T) if (x.ops[0] && x.ops[0][0] === 'run') x.left = x.ops[0][1];
    const ceil = {};
    for (const x of T) for (const o of x.ops) if (o[0] === 'lock') ceil[o[1]] = Math.min(ceil[o[1]] === undefined ? Infinity : ceil[o[1]], x.prio);
    const holder = {}, waiters = {};
    const steps = [], events = [], perTick = [], boosted = [];
    let run = null, t = 0;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.id : null, say }, more || {})); };
    /** effective priorities under the protocol */
    function effective() {
      const e = {};
      for (const x of T) e[x.id] = x.prio;
      if (P.protocol === 'ceiling') for (const x of T) for (const m of x.holds) e[x.id] = Math.min(e[x.id], ceil[m]);
      if (P.protocol === 'inherit') {
        for (let changed = true, g = 0; changed && g < 50; g++) {
          changed = false;
          for (const m of Object.keys(holder)) {
            const h = holder[m];
            if (!h) continue;
            for (const w of waiters[m] || []) if (e[w.id] < e[h.id]) { e[h.id] = e[w.id]; changed = true; }
          }
        }
      }
      return e;
    }
    /** a task at its boundary carries out lock and unlock ops until it reaches a run, blocks or ends */
    function ops(x, said) {
      for (;;) {
        const o = x.ops[x.pc];
        if (!o) { x.state = 'done'; x.finish = t; said.push(`${x.id} finishes`); ev('finish', x, `${x.id} finishes at t = ${t}`); return; }
        if (o[0] === 'run') { if (x.left > 0) return; x.pc++; if (x.ops[x.pc] && x.ops[x.pc][0] === 'run') x.left = x.ops[x.pc][1]; continue; }
        if (o[0] === 'lock') {
          const m = o[1];
          if (!holder[m]) { holder[m] = x; x.holds.push(m); said.push(`${x.id} locks ${m}` + (P.protocol === 'ceiling' && ceil[m] < x.prio ? `, rising to the ceiling priority \`${ceil[m]}\`` : '')); ev('lock', x, `${x.id} locks ${m}`, { mutex: m }); x.pc++; if (x.ops[x.pc] && x.ops[x.pc][0] === 'run') x.left = x.ops[x.pc][1]; continue; }
          x.state = 'blocked'; x.on = m; (waiters[m] = waiters[m] || []).push(x);
          said.push(`${x.id} tries to lock ${m}, held by ${holder[m].id}, and blocks`); ev('block', x, `${x.id} blocks on ${m}`, { mutex: m, holder: holder[m].id });
          return;
        }
        if (o[0] === 'unlock') {
          const m = o[1];
          holder[m] = null; x.holds = x.holds.filter((y) => y !== m); x.pc++;
          if (x.ops[x.pc] && x.ops[x.pc][0] === 'run') x.left = x.ops[x.pc][1];
          const ws = waiters[m] || [];
          if (ws.length) {
            let w = ws[0];
            for (const y of ws) if (y.prio < w.prio) w = y;
            ws.splice(ws.indexOf(w), 1);
            holder[m] = w; w.holds.push(m); w.on = null; w.state = 'ready'; w.since = t; w.pc++;
            if (w.ops[w.pc] && w.ops[w.pc][0] === 'run') w.left = w.ops[w.pc][1];
            said.push(`${x.id} unlocks ${m}, which passes to ${w.id}`); ev('unlock', x, `${x.id} unlocks ${m}; ${w.id} gets it`, { mutex: m, to: w.id });
          } else { said.push(`${x.id} unlocks ${m}`); ev('unlock', x, `${x.id} unlocks ${m}`, { mutex: m }); }
          continue;
        }
        x.pc++;
      }
    }
    while (t < 10000) {
      const said = [];
      if (run && run.left === 0) { const x = run; ops(x, said); if (x.state !== 'running') run = null; }
      for (const x of T) if (x.state === 'future' && x.arrive === t) { x.state = 'ready'; x.since = t; said.push(`${x.id} (priority ${x.prio}) arrives`); ev('arrive', x, `${x.id} arrives`); }
      // pick; a picked task that stands at a lock or unlock carries it out first, which may block it: pick again
      let decision = 'continue', e = effective();
      for (let guard = 0; guard < 100; guard++) {
        e = effective();
        let best = null;
        for (const x of T) {
          if (x.state !== 'ready' && x.state !== 'running') continue;
          if (!best || e[x.id] < e[best.id]) { best = x; continue; }
          if (e[x.id] > e[best.id] || best === run) continue;
          if (x === run || x.since < best.since || (x.since === best.since && x.idx < best.idx)) best = x;
        }
        if (best && best !== run) {
          if (run) { run.state = 'ready'; run.since = t; said.push(`${best.id} (priority ${e[best.id]}) preempts ${run.id} (priority ${e[run.id]})`); ev('preempt', best, `${best.id} preempts ${run.id}`, { from: run.id }); decision = 'preempt'; }
          else { said.push(`${best.id} runs at priority \`${e[best.id]}\`` + (e[best.id] < best.prio ? ` (its own is ${best.prio})` : '')); if (decision !== 'preempt') decision = 'dispatch'; }
          best.state = 'running'; run = best;
        }
        if (run && run.left === 0) { const x = run; ops(x, said); if (x.state !== 'running') { run = null; continue; } }
        break;
      }
      e = effective();
      if (run && run.first === null) run.first = t;
      if (!T.some((x) => x.state !== 'done')) { steps.push({ kind: 'end', t, run: null, ready: [], blocked: [], holders: {}, waiters: {}, eff: {}, decision: 'end', say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every task has finished.` }); break; }
      if (!run) { decision = 'idle'; said.push('the CPU idles'); }
      else if (decision === 'continue') said.push(`${run.id} runs on at priority \`${e[run.id]}\`` + (e[run.id] < run.prio ? ` (${P.protocol === 'inherit' ? 'inherited' : 'the ceiling'}; its own is ${run.prio})` : ''));
      const hs = {}, ws = {};
      for (const m of Object.keys(ceil)) { hs[m] = holder[m] ? holder[m].id : null; ws[m] = (waiters[m] || []).map((x) => x.id); }
      steps.push({ kind: 'tick', t, run: run ? run.id : null, ready: T.filter((x) => x.state === 'ready').map((x) => x.id), blocked: T.filter((x) => x.state === 'blocked').map((x) => ({ id: x.id, on: x.on })), holders: hs, waiters: ws, eff: e, decision, say: `At t = \`${t}\` ${said.join('; ')}.` });
      perTick.push(run ? run.id : null); boosted.push(run ? e[run.id] < run.prio : false);
      for (const x of T) {
        if (x === run) continue;
        if (x.state === 'blocked') x.blockedTicks++;
        if ((x.state === 'blocked' || x.state === 'ready') && run && run.prio > x.prio) x.inv++;
      }
      if (run) run.left--;
      t++;
    }
    const segs = Sch.segments(perTick, boosted, 'boosted');
    const rows = T.map((x) => ({ id: x.id, prio: x.prio, arrive: x.arrive, finish: x.finish, response: x.first - x.arrive, turnaround: x.finish - x.arrive, blockedOnMutex: x.blockedTicks, inversion: x.inv }));
    return { policy: 'pi', name: { none: 'no protocol', inherit: 'priority inheritance', ceiling: 'priority ceiling' }[P.protocol] || P.protocol, params: P, tasks: T.map((x) => ({ id: x.id, prio: x.prio, arrive: x.arrive })), ceilings: ceil, steps, events, segs, metrics: { rows }, end: t };
  };
})(globalThis.Proses = globalThis.Proses || {});
