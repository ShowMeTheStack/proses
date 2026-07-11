// Running a thread-step machine under a scheduler, and saying how the run ended.
//   S.Sync.rng(seed) -> () => a number in [0, 1)            (the same seed, the same numbers)
//   S.Sync.run(spec, {policy: 'rr' | 'fifo' | 'random' | 'manual', seed, quantum, order: [name | id..], max,
//                     stop(M, step) -> bool}) -> {steps, end, machine}
//     rr: round robin over the threads in order (or in the order turns: [tid..]), quantum steps each (default 1); fifo: the ready queue in the order
//     threads became ready, each running until it blocks or ends; random: a seeded random runnable thread, for a
//     burst of 1 to quantum steps; manual: the threads named in order, one step each.
//     steps: the machine's trace steps, each with runnable (the threads that could have run) and why;
//     end: {kind: 'deadlock' | 'done' | 'limit' | 'stopped' | 'error', say, t, cycle, blocked}
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});

  Y.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  /** a scheduler: pick(M, runnable) -> {tid, why} or null when it has nothing left to run */
  Y.scheduler = function (opts) {
    const policy = opts.policy || 'rr', q = Math.max(1, opts.quantum || 1);
    let last = -1, used = 0, burst = 1, k = 0;
    const rand = Y.rng(opts.seed === undefined ? 1 : opts.seed);
    const ready = [];
    const names = (M, ids) => ids.map((i) => (typeof i === 'string' ? (i[0] === 'f' ? 'a flush of ' : 'a choice of ') + M.threads[M.owner(i)].name : M.threads[i].name)).join(', ');
    return function pick(M, run) {
      if (!run.length) return null;
      if (policy === 'manual') {
        const order = opts.order || [];
        if (k >= order.length) return null;
        const want = order[k++], th = typeof want === 'number' ? M.threads[want] : M.threads.find((x) => x.name === want);
        if (!th) return { tid: -1, why: 'no thread called ' + want };
        return { tid: th.id, why: 'chosen by hand' };
      }
      if (policy === 'fifo') {
        for (const i of ready.slice()) if (!run.includes(i)) ready.splice(ready.indexOf(i), 1);
        for (const i of run) if (!ready.includes(i)) ready.push(i);
        return { tid: ready[0], why: 'first in the ready queue ' + names(M, ready) };
      }
      if (policy === 'random') {
        if (last >= 0 && run.includes(last) && used < burst) { used++; return { tid: last, why: 'continues its burst' }; }
        const tid = run[Math.floor(rand() * run.length)];
        burst = 1 + Math.floor(rand() * q); used = 1; last = tid;
        return { tid, why: 'picked at random among ' + names(M, run) };
      }
      // round robin
      if (last >= 0 && run.includes(last) && used < q) { used++; return { tid: last, why: 'still in its quantum' }; }
      const turns = opts.turns || M.threads.map((th) => th.id), n = turns.length, at = turns.indexOf(last);
      for (let d = 1; d <= n; d++) { const i = turns[(at + d + n) % n]; if (run.includes(i)) { last = i; used = 1; return { tid: i, why: 'next in turn' }; } }
      return run.length ? { tid: run[0], why: 'the only choice left' } : null;
    };
  };

  /** how a run ended, in one sentence with the blocked threads and the wait cycle */
  Y.ending = function (M, kind) {
    const blocked = M.threads.filter((th) => th.state === 'blocked');
    const where = (th) => { const o = th.on, obj = { mutex: M.mutex, sem: M.sem, cond: M.cond, rw: M.rw, barrier: M.barrier }[o.kind][o.id]; return obj.name; };
    if (kind === 'deadlock') {
      const wf = M.waitFor();
      if (wf.cycle) {
        const parts = wf.cycle.map((c) => `${M.threads[c.tid].name} waits for ${c.on.name}, held by ${M.threads[c.holder].name}`);
        return { kind, t: M.t, cycle: wf.cycle, edges: wf.edges, blocked: blocked.map((th) => th.id), say: `Deadlock at step \`${M.t}\`: no thread can run, and the waits form a cycle: ${parts.join('; ')}. Nobody will ever release what the next one needs.` };
      }
      return { kind, t: M.t, cycle: null, edges: wf.edges, blocked: blocked.map((th) => th.id), say: `Stuck at step \`${M.t}\`: no thread can run; ${blocked.map((th) => th.name + ' waits on ' + where(th)).join(', ')}, and no running thread is left to wake ${blocked.length > 1 ? 'them' : 'it'}.` };
    }
    if (kind === 'done') return { kind, t: M.t, blocked: [], say: `Every thread has finished after \`${M.t}\` steps.` };
    if (kind === 'error') return { kind, t: M.t, blocked: blocked.map((th) => th.id), say: M.failure ? `The run stops at step \`${M.t}\`: ${M.failure}` : `The run stops at step \`${M.t}\`: a thread misused a primitive.` };
    return { kind, t: M.t, blocked: blocked.map((th) => th.id), say: `The run stops after \`${M.t}\` steps; ${blocked.length ? blocked.length + ' thread' + (blocked.length > 1 ? 's are' : ' is') + ' blocked' : 'no thread is blocked'}, and nothing is stuck.` };
  };

  Y.run = function (spec, opts) {
    opts = opts || {};
    const M = Y.machine(spec), pick = Y.scheduler(opts), max = opts.max || 500, steps = [];
    let end = null;
    while (!end) {
      const st = M.status();
      if (st !== 'running') { end = Y.ending(M, st); break; }
      if (steps.length >= max) { end = Y.ending(M, 'limit'); break; }
      const run = M.choices(), p = pick(M, run);
      if (!p) { end = Y.ending(M, 'limit'); break; }
      if (!run.includes(p.tid)) { end = { kind: 'error', t: M.t, blocked: [], say: `The schedule asks for ${typeof p.tid === 'string' ? 'a flush' : p.tid >= 0 ? M.threads[p.tid].name : 'a thread'} at step \`${M.t + 1}\`, but it cannot run now (${p.why || 'it is not ready'}).` }; break; }
      const step = M.step(p.tid);
      step.runnable = run; step.why = p.why;
      steps.push(step);
      if (step.kind === 'error' || step.kind === 'assert') { end = Y.ending(M, 'error'); end.say = step.say; break; }
      if (opts.stop && opts.stop(M, step)) { end = Y.ending(M, 'stopped'); break; }
    }
    return { steps, end, machine: M };
  };
  (S.engines = S.engines || []).push({ name: 'Threads and synchronisation' });
})(globalThis.Proses = globalThis.Proses || {});
