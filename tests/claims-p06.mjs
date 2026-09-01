// Part 6 (multicore and real-time scheduling): the same wording and quoted-number checks as part 5
// (tests/claims-p05.mjs), then each topic's values against independent computations here: per-core work from the
// segments, rate-monotonic and EDF schedules simulated again from their rules, the utilisation bound, response-time
// analysis and processor demand worked out, and the inversion counted tick by tick.
// Prints "claims-p06 N passed, M failed".
import { pathToFileURL } from 'node:url';
import { runClaims } from './claims-p05.mjs';

const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** a random workload for several cores */
function randomWork(rnd, aff) {
  const n = int(rnd, 3, 6), out = [];
  for (let i = 0; i < n; i++) {
    const io = rnd() < 0.3;
    let line = String.fromCharCode(65 + i) + ' ' + int(rnd, 0, 5) + ' ' + int(rnd, 1, 8) + (io ? ' (' + int(rnd, 1, 4) + ') ' + int(rnd, 1, 5) : '');
    if (aff && rnd() < 0.3) line += ' aff=' + int(rnd, 0, 1);
    out.push(line);
  }
  return out.join('\n');
}
/** a random task set with a small hyperperiod */
function randomTasks(rnd, constrained) {
  const periods = pick(rnd, [[4, 6, 12], [4, 8, 16], [5, 10, 20], [3, 6, 9], [6, 8, 12], [4, 5, 10]]);
  const n = int(rnd, 2, 3), out = [];
  for (let i = 0; i < n; i++) { const T = periods[i], C = int(rnd, 1, Math.max(1, Math.floor(T / 2))), D = constrained ? int(rnd, C, T) : T; out.push(String.fromCharCode(65 + i) + ' ' + C + ' ' + T + (constrained ? ' ' + D : '')); }
  return out.join('\n');
}

/** checks every multicore trace shares: each job runs its CPU exactly, never on two cores at once, only where allowed */
function multiChecks(ctx, tr) {
  for (const j of tr.jobs) {
    const ss = tr.segs.filter((s) => s.job === j.id && !s.cs && !s.warm);
    ctx.near(ss.reduce((a, s) => a + s.end - s.start, 0), j.cpu, j.id + ' runs its CPU exactly');
    if (j.affinity) ctx.ok(ss.every((s) => j.affinity.includes(s.core) || j.affinity.every((c) => c >= tr.params.cores)), j.id + ' runs only on its cores');
    for (let t = 0; t < tr.end; t++) ctx.ok(tr.segs.filter((s) => s.job === j.id && s.start <= t && t < s.end).length <= 1, `${j.id} is on one core at most at t = ${t}`);
  }
  for (const c of tr.perCore) ctx.near(c.busy, tr.segs.filter((s) => s.core === c.id && !s.cs && !s.warm).reduce((a, s) => a + s.end - s.start, 0), 'core ' + c.id + ' busy ticks');
}
/** the task set of a topic */
const tasksOf = (S, text) => S.P06.parseTasks(text).tasks;
/** RM or EDF simulated again from the rules (phase 0 or given; misses carry on) */
function simRT(tasks, policy, H) {
  const live = [], perTick = [], misses = [];
  const rank = tasks.slice().sort((a, b) => a.T - b.T || tasks.indexOf(a) - tasks.indexOf(b));
  const better = (a, b) => (policy === 'edf' ? a.deadline - b.deadline || a.release - b.release || a.k - b.k : rank.indexOf(tasks[a.k]) - rank.indexOf(tasks[b.k]) || a.release - b.release) < 0;
  let run = null;
  for (let t = 0; t <= H; t++) {
    if (run && run.left === 0) { live.splice(live.indexOf(run), 1); run = null; }
    for (const j of live) if (j.deadline === t && j.left > 0) misses.push(j.name);
    if (t === H) break;
    tasks.forEach((k, i) => { if (t >= k.phase && (t - k.phase) % k.T === 0) live.push({ name: k.id + ((t - k.phase) / k.T + 1), k: i, release: t, deadline: t + k.D, left: k.C }); });
    let best = null;
    for (const j of live) if (!best || better(j, best)) best = j;
    if (best && (!run || (best !== run && better(best, run)))) run = best;
    perTick.push(run ? run.name : null);
    if (run) run.left--;
  }
  return { perTick, misses };
}

export const P06 = {
  'mc-queues': {
    random: (rnd) => ({ work: randomWork(rnd), mode: pick(rnd, ['shared', 'per-core']), cores: int(rnd, 2, 4), q: int(rnd, 1, 4) }),
    check(ctx) {
      const { S, input, frame, frames } = ctx, tr = S.Sched.multi(S.P05.work(input.work), { cores: input.cores, queue: input.mode, quantum: input.q });
      multiChecks(ctx, tr);
      const e = frame('end').meta;
      ctx.near(e.mig, tr.migrations.length, 'migrations');
      for (const f of frames('tick')) ctx.near(f.meta.cores.length, input.cores, 'a lane per core');
      // a shared queue never leaves a core idle while a job it may run waits
      if (input.mode === 'shared') for (const st of tr.steps) if (st.kind === 'tick') ctx.ok(!(st.cores.some((c) => !c.run) && st.shared.length), `no idle core beside a waiting job at t = ${st.t}`);
    },
  },
  'mc-balance': {
    random: (rnd) => ({ work: randomWork(rnd), cores: int(rnd, 2, 3), q: int(rnd, 1, 4), pull: pick(rnd, ['yes', 'no']), push: pick(rnd, [0, 0, 3, 5]) }),
    check(ctx) {
      const { S, input, frame } = ctx, tr = S.Sched.multi(S.P05.work(input.work), { cores: input.cores, queue: 'per-core', quantum: input.q, pull: input.pull === 'yes', push: input.push });
      multiChecks(ctx, tr);
      let iw = 0;
      for (let t = 0; t < tr.end; t++) { const st = tr.steps[t], idle = st.cores.filter((c) => !c.run).length, waiting = st.cores.reduce((a, c) => a + c.queue.length, 0); if (idle && waiting) iw += idle; }
      ctx.near(frame('end').meta.idleWait, iw, 'core-ticks idle beside a waiting job');
      if (input.pull === 'yes') ctx.ok(tr.steps.every((st) => st.kind !== 'tick' || !(st.cores.some((c) => !c.run && !c.queue.length) && st.cores.some((c) => c.queue.length))), 'with pulling, an idle core never sits beside a queue');
      if (input.pull === 'no' && !input.push) ctx.near(tr.moves.length, 0, 'no moves without balancing');
    },
  },
  'mc-affinity': {
    random: (rnd) => ({ work: randomWork(rnd, true), mode: pick(rnd, ['shared', 'per-core']), cores: 2, q: int(rnd, 1, 3), migrate: int(rnd, 0, 3) }),
    check(ctx) {
      const { S, input, frame } = ctx, tr = S.Sched.multi(S.P05.work(input.work), { cores: input.cores, queue: input.mode, quantum: input.q, migrate: input.migrate });
      multiChecks(ctx, tr);
      const warm = tr.segs.filter((s) => s.warm).reduce((a, s) => a + s.end - s.start, 0);
      ctx.near(frame('end').meta.warm, warm, 'warming ticks');
      ctx.near(warm, tr.migrations.length * input.migrate, 'each migration warms for the cost', 0);
    },
  },
  'rt-model': {
    random: (rnd) => ({ tasks: randomTasks(rnd, rnd() < 0.3) }),
    check(ctx) {
      const { S, input, frame, frames } = ctx, ts = tasksOf(S, input.tasks);
      const U = ts.reduce((a, k) => a + k.C / k.T, 0), H = ts.reduce((a, k) => (a / gcd(a, k.T)) * k.T, 1);
      ctx.near(frame('sum').meta.U, Math.round(U * 1000) / 1000, 'U by hand');
      ctx.near(frame('sum').meta.hyper, H, 'the hyperperiod by hand');
      frames('task').forEach((f, i) => ctx.near(f.meta.u, Math.round((ts[i].C / ts[i].T) * 100) / 100, 'each task\'s share'));
    },
  },
  'rt-rm': {
    random: (rnd) => ({ tasks: randomTasks(rnd, false) }),
    check(ctx) {
      const { S, input, frames } = ctx, ts = tasksOf(S, input.tasks), tr = S.Sched.rt(ts, { policy: 'rm', onMiss: input.miss });
      if (input.miss === 'continue') {
        const sim = simRT(tr.tasks, 'rm', tr.end);
        ctx.near(tr.steps.filter((s) => s.kind === 'tick').map((s) => s.run), sim.perTick, 'the schedule against an independent RM');
        ctx.near(tr.misses.map((m) => m.job), sim.misses, 'the misses against an independent RM');
      }
      for (const f of frames('tick')) if (f.meta.run) ctx.ok(f.meta.step.ready.every((r) => tr.tasks.find((k) => k.id === r.task).T >= tr.tasks.find((k) => k.id === f.meta.step.task).T), `the shortest period runs at t = ${f.meta.t}`);
    },
  },
  'rt-edf': {
    random: (rnd) => ({ tasks: randomTasks(rnd, rnd() < 0.4) }),
    check(ctx) {
      const { S, input, frame, frames } = ctx, ts = tasksOf(S, input.tasks), tr = S.Sched.rt(ts, { policy: 'edf' }), rm = S.Sched.rt(ts, { policy: 'rm' });
      const sim = simRT(tr.tasks, 'edf', tr.end);
      ctx.near(tr.steps.filter((s) => s.kind === 'tick').map((s) => s.run), sim.perTick, 'the schedule against an independent EDF');
      ctx.near(frame('compare').meta.rm, simRT(rm.tasks, 'rm', rm.end).misses.length, 'RM misses against an independent RM');
      for (const f of frames('tick')) if (f.meta.run) ctx.ok(f.meta.step.ready.every((r) => r.deadline >= f.meta.step.deadline), `the earliest deadline runs at t = ${f.meta.t}`);
      const U = tr.tasks.reduce((a, k) => a + k.C / k.T, 0);
      if (tr.tasks.every((k) => k.D === k.T) && U <= 1 + 1e-9) ctx.near(tr.misses.length, 0, 'U ≤ 1 with D = T: EDF misses nothing');
    },
  },
  'rt-bound': {
    random: (rnd) => ({ tasks: randomTasks(rnd, false) }),
    check(ctx) {
      const { S, input, frames, frame } = ctx, ts = tasksOf(S, input.tasks);
      frames('add').forEach((f, i) => {
        const n = i + 1, U = ts.slice(0, n).reduce((a, k) => a + k.C / k.T, 0), b = n * (Math.pow(2, 1 / n) - 1);
        ctx.near([f.meta.U, f.meta.bound], [Math.round(U * 1000) / 1000, Math.round(b * 1000) / 1000], 'U and the bound for ' + n);
        ctx.ok(f.meta.rmBound === (U <= b + 1e-12), 'the verdict for ' + n);
      });
      // the exact verdict against a simulation over the hyperperiod (phases 0, D = T)
      const tr = S.Sched.rt(ts, { policy: 'rm' });
      ctx.ok(frame('exact').meta.rmExact === (simRT(tr.tasks, 'rm', tr.end).misses.length === 0), 'the exact test agrees with a simulation');
    },
  },
  'rt-rta': {
    random: (rnd) => ({ tasks: randomTasks(rnd, rnd() < 0.3) }),
    check(ctx) {
      const { S, input, frames } = ctx, ts = tasksOf(S, input.tasks);
      const ord = ts.slice().sort((a, b) => a.T - b.T || ts.indexOf(a) - ts.indexOf(b));
      ord.forEach((k, i) => {
        const hp = ord.slice(0, i);
        let R = k.C;
        const its = [R];
        for (let g = 0; g < 100; g++) { const nx = k.C + hp.reduce((a, j) => a + Math.ceil(R / j.T) * j.C, 0); if (nx === R) break; R = nx; its.push(R); if (R > k.D) break; }
        ctx.near(frames('iter').filter((f) => f.meta.id === k.id).map((f) => f.meta.R), its, k.id + "'s iterations by hand");
        const v = frames('verdict').find((f) => f.meta.id === k.id).meta;
        ctx.ok(v.ok === (R <= k.D), k.id + "'s verdict");
        if (v.ok && ts.every((x) => !x.phase)) ctx.ok(v.worst <= v.R, k.id + ': the simulated worst response is within the bound');
      });
    },
  },
  'rt-demand': {
    random: (rnd) => ({ tasks: randomTasks(rnd, true) }),
    check(ctx) {
      const { S, input, frames, frame } = ctx, ts = tasksOf(S, input.tasks);
      for (const f of frames('L')) {
        const h = ts.reduce((a, k) => a + Math.max(0, Math.floor((f.meta.L - k.D) / k.T) + 1) * k.C, 0);
        ctx.near(f.meta.demand, h, 'h(' + f.meta.L + ') by hand');
        ctx.ok(f.meta.ok === (h <= f.meta.L), 'the verdict at ' + f.meta.L);
      }
      const end = frame('end').meta;
      if (end.ok !== undefined && frames('L').length) {
        const tr = S.Sched.rt(ts, { policy: 'edf' });
        ctx.ok(end.ok === (simRT(tr.tasks, 'edf', tr.end).misses.length === 0), 'the demand test agrees with an EDF simulation');
      }
    },
  },
  'pi-inversion': {
    check(ctx) { piChecks(ctx, 'none'); },
  },
  'pi-protocols': {
    random: (rnd) => ({ proto: pick(rnd, ['none', 'inherit', 'ceiling']) }),
    check(ctx) {
      piChecks(ctx, ctx.input.proto);
      const c = ctx.frame('compare').meta;
      ctx.ok(c.inv[1] <= c.inv[0] && c.inv[2] <= c.inv[0], 'the protocols never lengthen the inversion here');
    },
  },
};

/** the inversion counted again tick by tick, and inheritance checked: a holder runs at least as urgently as its waiters */
function piChecks(ctx, proto) {
  const { S, input } = ctx, tasks = S.P06.parseScript(input.tasks).tasks, tr = S.Sched.inversion(tasks, { protocol: proto });
  const prio = {};
  for (const k of tasks) prio[k.id] = k.prio;
  for (const row of tr.metrics.rows) {
    let inv = 0;
    for (const st of tr.steps) if (st.kind === 'tick' && st.run && st.run !== row.id && prio[st.run] > row.prio && (st.ready.includes(row.id) || st.blocked.some((b) => b.id === row.id))) inv++;
    ctx.near(row.inversion, inv, row.id + "'s inversion ticks");
  }
  for (const st of tr.steps) {
    if (st.kind !== 'tick') continue;
    if (st.run) ctx.ok([...st.ready].every((id) => st.eff[id] >= st.eff[st.run]), `the most urgent ready task runs at t = ${st.t}`);
    if (proto === 'inherit') for (const [m, h] of Object.entries(st.holders)) if (h) for (const w of st.waiters[m] || []) ctx.ok(st.eff[h] <= st.eff[w], `${h} holds ${m} at least as urgently as ${w}`);
    if (proto === 'none') for (const id of Object.keys(st.eff)) ctx.near(st.eff[id], prio[id], 'no protocol: priorities never change');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p06', /^p06-/, P06);
