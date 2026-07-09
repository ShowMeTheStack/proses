// CPU scheduling, part 7: several cores.
//   S.Sched.multi(work, {cores, queue: 'shared' | 'per-core', quantum, push, pull, migrate, cs}) -> trace
// Each core runs round robin with the quantum (default 2). Cores act in id order (core 0 first) at every tick.
//   queue 'shared':   one ready queue; a free core takes the first job in it that may run there (job.affinity).
//   queue 'per-core': each core has its own queue. A new job goes to the least loaded core it may use (load: the
//                     jobs queued plus the one running; ties to the lowest id); a job back from I/O goes back to
//                     the core it last ran on (its cache may still be warm), if it may.
//     push: n   every n ticks (0: never) a balancer moves jobs from the most loaded core to the least loaded,
//               one at a time from the back of the queue, while their loads differ by 2 or more;
//     pull      (default on) a core whose queue is empty takes the job at the back of the busiest other queue
//               that may run on it (work stealing).
//   migrate: n  a job that starts on a core other than the one it last ran on spends n ticks warming that core's
//               cache before its burst moves on (segments with warm: true); 0 by default.
//   cs: n       a context switch costs n ticks on a core when it starts a job other than its last.
// The order of events at a tick, as in sch-a-work.js, is followed per core; jobs queue in name order, ahead of jobs
// whose quantum ran out. Each step has cores [{id, run, queue, warm, cs}], shared (the shared queue), io,
// migrations so far; each segment has its core. metrics.util is over all cores; the trace adds perCore [{id,
// busy, util}], migrations [{t, job, from, to}] (a job starting on a core other than the one it last ran on) and
// moves [{t, job, from, to, why}] (queue-to-queue moves by push or pull).
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});

  Sch.multi = function (work, params) {
    const P = Object.assign({ cores: 2, queue: 'per-core', quantum: 2, push: 0, pull: true, migrate: 0, cs: 0 }, params || {});
    const N = Math.max(1, Math.round(P.cores)), shared = P.queue === 'shared';
    P.quantum = Math.max(1, Math.round(P.quantum)); P.migrate = Math.max(0, Math.round(P.migrate || 0)); P.cs = Math.max(0, Math.round(P.cs || 0)); P.push = Math.max(0, Math.round(P.push || 0));
    const jobs = Sch.norm(work);
    const X = jobs.map((j) => ({ j, b: 0, left: j.bursts[0], slice: 0, state: 'future', ioUntil: -1, last: null, home: null, warm: 0, sw: 0 }));
    // affinity to cores that do not exist is ignored; a job with none left may run anywhere
    const aff = jobs.map((j) => { const a = j.affinity ? j.affinity.filter((c) => c >= 0 && c < N) : null; return a && a.length ? a : null; });
    const ok = (x, c) => !aff[x.j.idx] || aff[x.j.idx].includes(c);
    const cores = Array.from({ length: N }, (_, c) => ({ id: c, run: null, q: [], lastOn: null, ticks: [] }));
    const SQ = [], steps = [], events = [], migrations = [], moves = [], finish = {}, first = {};
    let t = 0, overhead = 0;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {})); };
    const load = (c) => c.q.length + (c.run ? 1 : 0);
    const place = (x) => {
      if (shared) { SQ.push(x); return null; }
      let c = x.home !== null && ok(x, x.home) ? cores[x.home] : null;
      if (!c) for (const k of cores) if (ok(x, k.id) && (!c || load(k) < load(c))) c = k;
      if (!c) c = cores[0];
      c.q.push(x); x.home = c.id;
      return c.id;
    };
    const move = (x, from, to, why) => { from.q.splice(from.q.indexOf(x), 1); to.q.push(x); x.home = to.id; moves.push({ t, job: x.j.id, from: from.id, to: to.id, why }); ev(why.startsWith('push') ? 'push' : 'pull', x, `${x.j.id} moves from core ${from.id} to core ${to.id} (${why})`, { from: from.id, to: to.id }); };
    while (t < 100000) {
      const said = [];
      const expired = [];
      // 1. each core's job from the tick before
      for (const c of cores) {
        const x = c.run;
        if (!x || x.sw || x.warm) continue;
        if (x.left === 0) {
          if (x.b + 1 < x.j.bursts.length) { x.ioUntil = t + x.j.bursts[x.b + 1]; x.b += 2; x.left = x.j.bursts[x.b]; x.state = 'io'; said.push(`${x.j.id} (core ${c.id}) starts I/O until t = \`${x.ioUntil}\``); ev('block', x, `${x.j.id} blocks for I/O`, { core: c.id }); }
          else { x.state = 'done'; finish[x.j.id] = t; said.push(`${x.j.id} finishes on core ${c.id}`); ev('finish', x, `${x.j.id} finishes`, { core: c.id }); }
          c.run = null;
        } else if (x.slice >= P.quantum) { expired.push([x, c]); c.run = null; }
      }
      // 2. arrivals and returns, in name order
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) {
        const back = x.state === 'io';
        x.state = 'ready';
        const at = place(x);
        said.push(`${x.j.id} ${back ? 'is back from I/O' : 'arrives'}` + (at === null ? '' : ` and joins core ${at}'s queue`));
        ev(back ? 'io-done' : 'arrive', x, `${x.j.id} ${back ? 'is back from I/O' : 'arrives'}`, at === null ? {} : { core: at });
      }
      // 3. jobs whose quantum ran out go to the back
      for (const [x, c] of expired) { x.state = 'ready'; if (shared) SQ.push(x); else c.q.push(x); said.push(`${x.j.id}'s quantum on core ${c.id} is up`); }
      // 4. push balancing
      if (!shared && P.push && t > 0 && t % P.push === 0) {
        for (let guard = 0; guard < 100; guard++) {
          let hi = cores[0], lo = cores[0];
          for (const c of cores) { if (load(c) > load(hi)) hi = c; if (load(c) < load(lo)) lo = c; }
          if (load(hi) - load(lo) < 2) break;
          const x = [...hi.q].reverse().find((y) => ok(y, lo.id));
          if (!x) break;
          move(x, hi, lo, 'pushed by the balancer');
          said.push(`the balancer pushes ${x.j.id} from core ${hi.id} (load ${load(hi) + 1}) to core ${lo.id} (load ${load(lo) - 1})`);
        }
      }
      // 5. each free core picks
      for (const c of cores) {
        if (c.run) continue;
        let x = null, how = '';
        if (shared) { x = SQ.find((y) => ok(y, c.id)); if (x) { SQ.splice(SQ.indexOf(x), 1); how = `first in the shared queue that may run on core ${c.id}`; } }
        else {
          x = c.q.shift() || null; if (x) how = `head of core ${c.id}'s queue`;
          if (!x && P.pull) {
            let from = null;
            for (const k of cores) if (k !== c && k.q.some((y) => ok(y, c.id)) && (!from || k.q.length > from.q.length)) from = k;
            if (from) { const y = [...from.q].reverse().find((z) => ok(z, c.id)); move(y, from, c, 'pulled by an idle core'); c.q.shift(); x = y; how = `pulled from core ${from.id}, whose queue was longest`; }
          }
        }
        if (!x) continue;
        x.state = 'running'; x.slice = 0; c.run = x; x.home = c.id;
        x.sw = P.cs && c.lastOn && c.lastOn !== x ? P.cs : 0;
        x.warm = P.migrate && x.last !== null && x.last !== c.id ? P.migrate : 0;
        if (x.last !== null && x.last !== c.id) { migrations.push({ t, job: x.j.id, from: x.last, to: c.id }); ev('migrate', x, `${x.j.id} runs on core ${c.id} after last running on core ${x.last}`, { from: x.last, to: c.id }); }
        c.lastOn = x;
        said.push(`core ${c.id} runs ${x.j.id} (${how})` + (x.warm ? `, warming its cache for ${Sch.sv(P.migrate, 'tick')} since it last ran on core ${x.last}` : ''));
        ev('dispatch', x, `core ${c.id} runs ${x.j.id}`, { core: c.id });
      }
      if (!X.some((x) => x.state !== 'done')) { steps.push({ kind: 'end', t, cores: cores.map((c) => ({ id: c.id, run: null, queue: [] })), shared: [], io: [], migrations: migrations.length, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` }); break; }
      const busyCores = cores.filter((c) => c.run).map((c) => `${c.run.j.id} keeps core ${c.id}`);
      const st = { kind: 'tick', t, cores: cores.map((c) => ({ id: c.id, run: c.run ? c.run.j.id : null, queue: c.q.map((x) => x.j.id), warm: c.run ? c.run.warm : 0, cs: !!(c.run && c.run.sw) })), shared: SQ.map((x) => x.j.id), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), migrations: migrations.length };
      st.say = `At t = \`${t}\` ` + (said.length ? said.join('; ') : busyCores.length ? Sch.list(busyCores) : 'every core idles') + '.';
      st.decision = said.length ? 'event' : 'continue';
      steps.push(st);
      // 6. run a tick on each core
      for (const c of cores) {
        const x = c.run;
        if (!x) { c.ticks.push(null); continue; }
        if (x.sw) { c.ticks.push('~' + x.j.id); x.sw--; overhead++; continue; }
        if (x.warm) { c.ticks.push('!' + x.j.id); x.warm--; overhead++; continue; }
        c.ticks.push(x.j.id);
        if (first[x.j.id] === undefined) first[x.j.id] = t;
        x.left--; x.slice++; x.last = c.id;
      }
      t++;
    }
    const segs = [].concat(...cores.map((c) => Sch.segments(c.ticks).map((s) => Object.assign(s, { core: c.id })))).sort((a, b) => a.start - b.start || a.core - b.core);
    const busy = jobs.reduce((a, j) => a + j.cpu, 0);
    const perCore = cores.map((c) => { const b = c.ticks.filter((x) => x && x[0] !== '~' && x[0] !== '!').length; return { id: c.id, busy: b, util: t ? b / t : 0 }; });
    return { policy: 'multi', name: `${N} cores, ${shared ? 'shared queue' : 'per-core queues'}`, params: Object.assign({}, P, { cores: N }), jobs, steps, events, segs, perCore, migrations, moves, metrics: Sch.metrics(jobs, finish, first, { end: t, overhead, busy, cores: N }), end: t };
  };
})(globalThis.Proses = globalThis.Proses || {});
