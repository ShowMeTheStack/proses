// The CPU schedulers (src/core/sch-*.js): hand-worked cases for every policy, then an independent
// reimplementation of each policy, written here in a different style (every ready job carries a stamp, taken when
// it joins the queue; a pick is the least (measure, stamp)), compared with the engine on many seeded workloads.
// Invariants on every run: one job on the CPU at a time, each job gets exactly its CPU time, the metrics agree
// with the per-tick steps, and the same input gives the same trace.
import { load, harness, rng } from './load.mjs';

const t = harness('sched');
const S = load(['core']);
const Sch = S.Sched;
const segs = (tr) => tr.segs.map((s) => s.job + s.start + '-' + s.end + (s.level !== undefined ? '@' + s.level : '')).join(' ');
const col = (tr, k) => tr.metrics.rows.map((r) => r[k]);

// ---- hand-worked cases ----------------------------------------------------------------------------------------
{
  const w = [{ id: 'A', arrive: 0, bursts: [5] }, { id: 'B', arrive: 1, bursts: [3] }, { id: 'C', arrive: 2, bursts: [1] }];
  const f = Sch.run(w, 'fcfs');
  t.eq(segs(f), 'A0-5 B5-8 C8-9', 'FCFS order');
  t.eq(col(f, 'turnaround'), [5, 7, 7], 'FCFS turnaround');
  t.eq(col(f, 'waiting'), [0, 4, 6], 'FCFS waiting');
  t.eq(f.metrics.sum.waiting, 10, 'FCFS waiting sum');
  t.eq(f.metrics.sumText.turnaround, '5 + 7 + 7 = 19', 'FCFS turnaround sum, written out');
  const r = Sch.run(w, 'rr', { quantum: 2 });
  // at t = 2 C arrives and joins before A, whose quantum ran out at the same tick
  t.eq(segs(r), 'A0-2 B2-4 C4-5 A5-7 B7-8 A8-9', 'RR q = 2');
  t.eq(col(r, 'turnaround'), [9, 7, 3], 'RR turnaround');
  t.eq(col(r, 'response'), [0, 1, 2], 'RR response');
  t.ok(r.steps[2].say.includes('C arrives') && r.steps[2].say.includes("A's quantum"), 'RR narrates the arrival and the expiry at t = 2');
  t.eq(r.steps[2].ready, ['C', 'A'], 'RR queue at t = 2 behind B');
  const r9 = Sch.run(w, 'rr', { quantum: 9 });
  t.eq(segs(r9), segs(f), 'RR with a long quantum is FCFS');
}
{
  const w = [{ id: 'A', arrive: 0, bursts: [6] }, { id: 'B', arrive: 1, bursts: [4] }, { id: 'C', arrive: 2, bursts: [2] }, { id: 'D', arrive: 3, bursts: [1] }];
  const j = Sch.run(w, 'sjf');
  t.eq(segs(j), 'A0-6 D6-7 C7-9 B9-13', 'SJF');
  t.eq(col(j, 'turnaround'), [6, 12, 7, 4], 'SJF turnaround');
  t.eq(j.metrics.sum.waiting, 16, 'SJF waiting sum');
  const s = Sch.run(w, 'srtn');
  // at t = 3 D needs 1 and C has 1 left: not strictly less, so C keeps the CPU
  t.eq(segs(s), 'A0-1 B1-2 C2-4 D4-5 B5-8 A8-13', 'SRTN');
  t.eq(col(s, 'turnaround'), [13, 7, 2, 2], 'SRTN turnaround');
  t.eq(col(s, 'waiting'), [7, 3, 0, 1], 'SRTN waiting');
  t.eq(s.metrics.sum.response, 1, 'SRTN response sum');
  t.eq(s.steps[3].decision, 'keep', 'SRTN: an equal newcomer does not preempt');
  t.eq(s.steps[1].decision, 'preempt', 'SRTN: B preempts A at t = 1');
  t.ok(/B preempts A/.test(s.steps[1].say) && s.steps[1].say.includes('`4`') && s.steps[1].say.includes('`5`'), 'the preemption names both remaining times');
}
{
  // a tie on priority: B and C both 1, B queued first (name order at the same tick)
  const w = [{ id: 'A', arrive: 0, bursts: [3], prio: 2 }, { id: 'B', arrive: 1, bursts: [2], prio: 1 }, { id: 'C', arrive: 1, bursts: [2], prio: 1 }, { id: 'D', arrive: 2, bursts: [1], prio: 0 }];
  const p = Sch.run(w, 'prio');
  t.eq(segs(p), 'A0-3 D3-4 B4-6 C6-8', 'priority, not preemptive');
  t.ok(/ties with C/.test(p.steps[4].say), 'the tie is narrated');
  const pp = Sch.run(w, 'prio', { preemptive: true });
  // D preempts B at t = 2 and B rejoins behind C, so at t = 3 C (queued at 1) wins the tie with B (queued at 2)
  t.eq(segs(pp), 'A0-1 B1-2 D2-3 C3-5 B5-6 A6-8', 'priority, preemptive');
  // aging: B (4) waits from t = 0 and reaches 0 at t = 4, tying C (0, queued at 2); B has waited longer
  const a = [{ id: 'A', arrive: 0, bursts: [4], prio: 0 }, { id: 'B', arrive: 0, bursts: [2], prio: 4 }, { id: 'C', arrive: 2, bursts: [3], prio: 0 }];
  t.eq(segs(Sch.run(a, 'prio')), 'A0-4 C4-7 B7-9', 'priority without aging');
  t.eq(segs(Sch.run(a, 'prio', { age: 1 })), 'A0-4 B4-6 C6-9', 'priority with aging 1');
}
{
  // I/O: A computes 2, waits 3, computes 2
  const w = [{ id: 'A', arrive: 0, bursts: [2, 3, 2] }, { id: 'B', arrive: 1, bursts: [4] }];
  const f = Sch.run(w, 'fcfs');
  t.eq(segs(f), 'A0-2 B2-6 A6-8', 'FCFS with I/O');
  t.eq(col(f, 'turnaround'), [8, 5], 'turnaround with I/O');
  t.eq(col(f, 'waiting'), [1, 1], 'waiting excludes I/O');
  t.eq(f.steps[5].io, [], 'A is back from I/O at t = 5');
  t.eq(f.steps[3].io, [{ id: 'A', until: 5 }], 'A is in I/O at t = 3');
  // idle CPU
  const g = Sch.run([{ id: 'A', arrive: 2, bursts: [1] }], 'fcfs');
  t.eq(g.steps[0].decision, 'idle', 'idle before the first arrival');
  t.eq(g.metrics.rows[0].turnaround, 1, 'a lone job');
}
{
  // MLFQ: two levels, quanta 1 and 2, allotment 2 at Q0
  const m = Sch.mlfq([{ id: 'A', arrive: 0, bursts: [4] }, { id: 'B', arrive: 1, bursts: [2] }], { levels: 2, quantum: [1, 2], allot: [2] });
  t.eq(segs(m), 'A0-1@0 B1-2@0 A2-3@0 B3-4@0 A4-6@1', 'MLFQ by hand');
  t.eq(m.events.filter((e) => e.kind === 'demote').map((e) => e.job + e.t), ['A3'], 'A drops at t = 3; B finishes on its allotment and does not drop');
  t.eq(col(m, 'turnaround'), [6, 3], 'MLFQ turnaround');
  // the boost: a lone job drops, runs at Q1, is lifted at t = 3, drops again
  const b = Sch.mlfq([{ id: 'A', arrive: 0, bursts: [5] }], { levels: 2, quantum: [1, 1], allot: [1], boost: 3 });
  t.eq(segs(b), 'A0-1@0 A1-3@1 A3-4@0 A4-5@1', 'MLFQ boost by hand');
  t.eq(b.steps[2].decision, 'renew', 'alone at Q1, A runs on');
  t.ok(b.steps[3].boosted && /boost/.test(b.steps[3].say), 'the boost is narrated');
  // an I/O job that comes back into Q0 preempts a job at Q1
  const p = Sch.mlfq([{ id: 'A', arrive: 0, bursts: [6] }, { id: 'B', arrive: 0, bursts: [1, 2, 1] }], { levels: 2, quantum: [1, 4], allot: [2] });
  t.eq(segs(p), 'A0-1@0 B1-2@0 A2-3@0 A3-4@1 B4-5@0 A5-8@1', 'MLFQ: B, back from I/O into Q0, preempts A at Q1');
  t.eq(p.steps[4].decision, 'preempt', 'the preemption is the decision at t = 4');
  // with an allotment of 1, B's one tick uses it up: B drops as it blocks, and comes back into Q1
  const p1 = Sch.mlfq([{ id: 'A', arrive: 0, bursts: [6] }, { id: 'B', arrive: 0, bursts: [1, 2, 1] }], { levels: 2, quantum: [1, 4], allot: [1] });
  t.eq(segs(p1), 'A0-1@0 B1-2@0 A2-6@1 B6-7@1 A7-8@1', 'MLFQ: blocking does not reset the allotment');
}
{
  // the presets and the default MLFQ scene workload behave as the scenes describe
  const f = Sch.run(Sch.presets.convoy.jobs, 'fcfs');
  t.eq(f.segs[0], { job: 'A', start: 0, end: 11 }, 'the convoy: A first for 11 ticks');
  const m = Sch.mlfq(Sch.presets.mlfq.jobs, { levels: 3, quantum: [2], allot: 4, boost: 24 });
  t.ok(m.segs.filter((s) => s.job === 'C').every((s) => s.level === 0), 'the editor C stays in Q0');
  t.ok(m.segs.some((s) => s.job === 'A' && s.level === 2) && m.segs.some((s) => s.job === 'B' && s.level === 2), 'the hogs reach Q2');
  t.ok(m.events.some((e) => e.kind === 'boost' && e.t === 24), 'a boost at t = 24');
}

// ---- phase 2 options, by hand ------------------------------------------------------------------------------------
{
  // burst prediction: tau0 = 4, alpha = 0.5; A's bursts 6 and 4, B's 2 and 2
  const w = [{ id: 'A', arrive: 0, bursts: [6, 2, 4, 2, 6] }, { id: 'B', arrive: 0, bursts: [2, 2, 2, 2, 2] }];
  const p = Sch.run(w, 'sjf', { predict: { alpha: 0.5, tau0: 4 } });
  // both predicted 4 at t = 0: A wins the tie (name order); then A's next is 0.5·6 + 0.5·4 = 5, B's 0.5·2 + 0.5·4 = 3
  t.eq(p.predictions.slice(0, 4).map((x) => [x.job, x.predicted, x.actual, x.next]), [['A', 4, 6, 5], ['B', 4, 2, 3], ['A', 5, 4, 4.5], ['B', 3, 2, 2.5]], 'exponential averaging, step by step');
  t.eq(segs(p), 'A0-6 B6-8 A8-12 B12-14 A14-20 B20-22', 'SJF on predictions');
  t.eq(segs(Sch.run(w, 'sjf')), 'B0-2 A2-8 B8-10 A10-14 B14-16 A16-22', 'SJF as an oracle runs B first');
  t.ok(p.steps[6].pred && p.steps[6].pred.A === 5, 'each step carries the predictions');
  // context switches: RR q = 2 with a 1-tick switch on the convoy
  const c = Sch.run(Sch.presets.convoy.jobs, 'rr', { quantum: 2, cs: 1 });
  t.eq(c.segs.map((x) => (x.cs ? '~' : '') + x.job + x.start + '-' + x.end).join(' '), 'A0-2 ~B2-3 B3-5 ~C5-6 C6-8 ~A8-9 A9-11 ~D11-12 D12-13 ~C13-14 C14-15 ~A15-16 A16-23', 'RR with a switch cost');
  t.eq(c.metrics.overhead, 6, 'six switches');
  t.eq(c.metrics.util, 17 / 23, 'utilisation is the useful share');
  t.eq(c.metrics.throughput, 4 / 23, 'throughput is jobs per tick');
  // the smaller the quantum, the more the switches cost
  const long = Sch.random(5, { io: false, n: 5 });
  const thr = [1, 2, 4, 8].map((q) => Sch.run(long, 'rr', { quantum: q, cs: 1 }).metrics.throughput);
  t.ok(thr[0] < thr[1] && thr[1] <= thr[2] && thr[2] <= thr[3], 'throughput grows with the quantum when switches cost: ' + thr.map((x) => x.toFixed(3)).join(' '));
  // aging from arrival: B (prio 3) never resets its count, A and C are urgent
  const a = [{ id: 'A', arrive: 0, bursts: [3, 1, 3], prio: 0 }, { id: 'B', arrive: 0, bursts: [2], prio: 3 }, { id: 'C', arrive: 1, bursts: [4], prio: 0 }];
  t.eq(segs(Sch.run(a, 'prio')), 'A0-3 C3-7 A7-10 B10-12', 'priority alone starves B to the end');
  t.eq(segs(Sch.run(a, 'prio', { age: 1 })), 'A0-3 B3-5 C5-9 A9-12', 'aging lets B in at t = 3');
}
{
  // MLFQ: the gaming job and its fix
  const lvl = Sch.mlfq(Sch.presets.gamer.jobs, { levels: 3, quantum: [2], allot: 4 });
  const io = Sch.mlfq(Sch.presets.gamer.jobs, { levels: 3, quantum: [2], allot: 4, allotMode: 'reset-io' });
  t.ok(io.segs.filter((x) => x.job === 'G').every((x) => x.level === 0), 'with the count reset on I/O, G never leaves Q0');
  t.ok(lvl.segs.some((x) => x.job === 'G' && x.level > 0), 'counted per level, G drops');
  const fin = (tr, id) => tr.metrics.rows.find((r) => r.id === id).finish;
  t.ok(fin(io, 'G') < fin(lvl, 'G') && fin(io, 'A') > fin(lvl, 'A'), 'gaming pays G and costs A');
  t.ok(io.events.some((e) => e.kind === 'reset'), 'the reset is an event');
}

// ---- the independent reimplementation ---------------------------------------------------------------------------
function ref(work, policy, P) {
  P = P || {};
  const cs = P.cs || 0, pr = P.predict ? { a: P.predict.alpha === undefined ? 0.5 : P.predict.alpha, tau: P.predict.tau0 === undefined ? 5 : P.predict.tau0 } : null;
  const J = work.map((w, i) => ({ id: w.id, i, at: w.arrive, B: w.bursts.slice(), prio: w.prio || 0 }));
  for (const j of J) { j.k = 0; j.rem = j.B[0]; j.where = 'out'; j.tau = pr ? pr.tau : 0; j.done = 0; j.tw = 0; j.sw = 0; }
  let stamp = 0, cpu = null, slice = 0, t = 0, curv = null, lastOn = null;
  const out = [], fin = {}, firstAt = {};
  const by = P.ageBy === undefined ? 1 : P.ageBy, fl = P.ageFloor === undefined ? 0 : P.ageFloor;
  const val = (j, now) => {
    if (policy === 'sjf') return pr ? j.tau : j.rem;
    if (policy === 'srtn') return pr ? Math.max(0, j.tau - j.done) : j.rem;
    if (policy === 'prio') {
      if (!P.age) return j.prio;
      const w = P.ageFrom === 'arrival' ? j.tw + (j.where === 'rq' ? now - j.joined : 0) : now - j.joined;
      return Math.max(Math.min(fl, j.prio), j.prio - by * Math.floor(w / P.age));
    }
    return 0;
  };
  const enq = (j, now) => { j.where = 'rq'; j.st = stamp++; j.joined = now; };
  const pick = (now) => { let b = null; for (const j of J) if (j.where === 'rq' && (!b || val(j, now) < val(b, now) || (val(j, now) === val(b, now) && j.st < b.st))) b = j; return b; };
  const take = (b, now) => { curv = val(b, now); b.tw += now - b.joined; b.where = 'cpu'; cpu = b; slice = 0; b.sw = cs && lastOn && lastOn !== b ? cs : 0; lastOn = b; };
  for (;;) {
    let back = null;
    const busy = cpu && cpu.sw > 0;
    if (!busy && cpu && cpu.rem === 0) {
      if (pr) { cpu.tau = pr.a * cpu.B[cpu.k] + (1 - pr.a) * cpu.tau; cpu.done = 0; }
      cpu.k++;
      if (cpu.k < cpu.B.length) { cpu.where = 'io'; cpu.until = t + cpu.B[cpu.k]; cpu.k++; cpu.rem = cpu.B[cpu.k]; } else { cpu.where = 'gone'; fin[cpu.id] = t; }
      cpu = null;
    } else if (!busy && cpu && policy === 'rr' && slice === P.quantum) { back = cpu; cpu = null; }
    for (const j of J) if ((j.where === 'out' && j.at === t) || (j.where === 'io' && j.until === t)) enq(j, t);
    if (back) { if (J.some((j) => j.where === 'rq')) enq(back, t); else { cpu = back; slice = 0; } }
    const pre = policy === 'srtn' || (policy === 'prio' && P.preemptive);
    if (cpu && !busy && pre && back === null) { const b = pick(t); const mine = policy === 'srtn' ? val(cpu, t) : curv; if (b && val(b, t) < mine) { enq(cpu, t); cpu = null; take(b, t); } }
    if (!cpu) { const b = pick(t); if (b) take(b, t); }
    if (J.every((j) => j.where === 'gone')) break;
    if (cpu && cpu.sw > 0) { out.push('~' + cpu.id); cpu.sw--; }
    else {
      out.push(cpu ? cpu.id : null);
      if (cpu) { if (!(cpu.id in firstAt)) firstAt[cpu.id] = t; cpu.rem--; slice++; cpu.done++; }
    }
    t++;
  }
  return { ticks: out, fin, firstAt };
}
function refMlfq(work, P) {
  const n = P.levels, q = P.quantum, al = P.allot, bo = P.boost;
  const J = work.map((w) => ({ id: w.id, at: w.arrive, B: w.bursts.slice(), k: 0, rem: w.bursts[0], where: 'out', lv: 0, use: 0, sw: 0 }));
  let stamp = 0, cpu = null, slice = 0, t = 0, lastOn = null;
  const out = [], lvs = [], fin = {}, firstAt = {};
  const enq = (j) => { j.where = 'rq'; j.st = stamp++; };
  const best = () => { let b = null; for (const j of J) if (j.where === 'rq' && (!b || j.lv < b.lv || (j.lv === b.lv && j.st < b.st))) b = j; return b; };
  for (;;) {
    let back = null;
    if (cpu && !cpu.sw) {
      const last = cpu.rem === 0 && cpu.k + 1 >= cpu.B.length;
      if (cpu.use >= al[cpu.lv] && cpu.lv < n - 1 && !last) { cpu.lv++; cpu.use = 0; if (cpu.rem > 0) back = cpu; }
      else if (cpu.rem > 0 && slice >= q[cpu.lv]) back = cpu;
      if (cpu.rem === 0) {
        cpu.k++;
        if (cpu.k < cpu.B.length) { cpu.where = 'io'; cpu.until = t + cpu.B[cpu.k]; cpu.k++; cpu.rem = cpu.B[cpu.k]; if (P.allotMode === 'reset-io') cpu.use = 0; } else { cpu.where = 'gone'; fin[cpu.id] = t; }
      }
      if (cpu.where !== 'cpu' || back) cpu = null;
    }
    for (const j of J) if ((j.where === 'out' && j.at === t) || (j.where === 'io' && j.until === t)) enq(j);
    if (back) enq(back);
    if (bo > 0 && t > 0 && t % bo === 0) {
      const order = J.filter((j) => j.where === 'rq').sort((a, b) => a.lv - b.lv || a.st - b.st);
      if (cpu) { order.push(cpu); cpu = null; }
      for (const j of order) { j.lv = 0; j.use = 0; enq(j); }
      for (const j of J) if (j.where === 'io') { j.lv = 0; j.use = 0; }
    }
    if (cpu && !cpu.sw && P.preempt !== false) { const b = best(); if (b && b.lv < cpu.lv) { enq(cpu); cpu = null; } }
    if (!cpu) { const b = best(); if (b) { b.where = 'cpu'; cpu = b; slice = 0; b.sw = P.cs && lastOn && lastOn !== b ? P.cs : 0; lastOn = b; } }
    if (J.every((j) => j.where === 'gone')) break;
    if (cpu && cpu.sw) { out.push('~' + cpu.id); lvs.push(cpu.lv); cpu.sw--; }
    else { out.push(cpu ? cpu.id : null); lvs.push(cpu ? cpu.lv : null); if (cpu) { if (!(cpu.id in firstAt)) firstAt[cpu.id] = t; cpu.rem--; cpu.use++; slice++; } }
    t++;
  }
  return { ticks: out, lvs, fin, firstAt };
}
const perTick = (tr) => { const a = new Array(tr.end).fill(null); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) a[k] = (s.cs ? '~' : '') + s.job; return a; };
function invariants(tr, work, at) {
  const jobs = Sch.norm(work);
  const ticks = perTick(tr);
  for (const j of jobs) t.eq(ticks.filter((x) => x === j.id).length, j.cpu, at + ': ' + j.id + ' gets its CPU time');
  const ticksSteps = tr.steps.filter((s) => s.kind === 'tick');
  t.eq(ticksSteps.map((s) => s.run), ticks, at + ': steps agree with the Gantt chart');
  for (const r of tr.metrics.rows) {
    const qd = ticksSteps.filter((s) => (s.queues ? [].concat(...s.queues) : s.ready).includes(r.id)).length;
    t.eq(qd, r.waiting, at + ': ' + r.id + ' waited as long as it sat in a ready queue');
    t.ok(r.waiting >= 0 && r.response >= 0 && r.response <= r.waiting, at + ': ' + r.id + ' response within waiting');
  }
  t.ok(tr.steps.every((s) => s.say && !/undefined|NaN/.test(s.say)), at + ': every step narrated');
}

const R = rng(20261019);
const pols = [['fcfs'], ['sjf'], ['srtn'], ['prio'], ['prio', { preemptive: true }], ['prio', { age: 2 }], ['prio', { preemptive: true, age: 3 }], ['rr', { quantum: 1 }], ['rr', { quantum: 2 }], ['rr', { quantum: 3 }], ['rr', { quantum: 5 }],
  ['sjf', { predict: { alpha: 0.5, tau0: 4 } }], ['srtn', { predict: { alpha: 0.25, tau0: 6 } }], ['sjf', { predict: { alpha: 1, tau0: 1 } }],
  ['prio', { age: 2, ageFrom: 'arrival' }], ['prio', { preemptive: true, age: 1, ageBy: 2, ageFloor: 1 }], ['prio', { preemptive: true, age: 4, ageFrom: 'arrival' }],
  ['rr', { quantum: 2, cs: 1 }], ['rr', { quantum: 1, cs: 2 }], ['fcfs', { cs: 1 }], ['srtn', { cs: 1 }], ['prio', { preemptive: true, cs: 2 }]];
let compared = 0;
for (let n = 0; n < 300; n++) {
  const seed = Math.floor(R() * 1e9);
  const work = Sch.random(seed, { io: n % 3 !== 0 });
  for (const [p, P] of pols) {
    const tr = Sch.run(work, p, P), r = ref(work, p, P);
    const at = `seed ${seed} ${p} ${JSON.stringify(P || {})}`;
    t.eq(perTick(tr), r.ticks, at + ': the same schedule');
    t.eq(tr.metrics.rows.map((x) => [x.finish, x.response + x.arrive]), Sch.norm(work).map((j) => [r.fin[j.id], r.firstAt[j.id]]), at + ': the same finish and first-run times');
    if (n % 10 === 0 && !(P && P.cs)) invariants(tr, work, at);
    compared++;
  }
  for (const MP of [{ levels: 3, quantum: [2], allot: 4, boost: 0 }, { levels: 3, quantum: [1], allot: 3, boost: 12 }, { levels: 2, quantum: [2, 3], allot: [2], boost: 7 }, { levels: 4, quantum: [1], boost: 20 }, { levels: 3, quantum: [2], allot: 4, allotMode: 'reset-io' }, { levels: 3, quantum: [1], allot: 2, boost: 9, preempt: false }, { levels: 2, quantum: [2], allot: 3, allotMode: 'reset-io', preempt: false, boost: 11 }, { levels: 3, quantum: [1], allot: 3, boost: 10, cs: 1 }]) {
    const tr = Sch.mlfq(work, MP), P = tr.params, r = refMlfq(work, P);
    const at = `seed ${seed} mlfq ${JSON.stringify(MP)}`;
    t.eq(perTick(tr), r.ticks, at + ': the same schedule');
    const lv = new Array(tr.end).fill(null); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) lv[k] = s.level;
    t.eq(lv, r.lvs, at + ': the same levels');
    t.eq(tr.metrics.rows.map((x) => x.finish), Sch.norm(work).map((j) => r.fin[j.id]), at + ': the same finish times');
    if (n % 10 === 0 && !MP.cs) invariants(tr, work, at);
    compared++;
  }
}
t.ok(compared >= 4000, 'compared ' + compared + ' runs');
// same input, same trace
const w0 = Sch.random(7);
t.eq(JSON.stringify(Sch.run(w0, 'rr', { quantum: 2 })), JSON.stringify(Sch.run(w0, 'rr', { quantum: 2 })), 'deterministic');
t.eq(JSON.stringify(Sch.random(7)), JSON.stringify(w0), 'the same seed, the same workload');
t.done();
