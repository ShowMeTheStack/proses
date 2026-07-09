// The schedulers, part 2 (src/core/sch-d-mlq.js, sch-e-share.js): the multilevel queue, lottery and stride.
// Hand-worked cases, then an independent reimplementation of each (stamped queues; the lottery draws from the
// test harness's own copy of the seeded generator) compared with the engine on seeded random workloads, and the
// shares each policy gives against the tickets.
import { load, harness, rng } from './load.mjs';

const t = harness('sched-b');
const S = load(['core']);
const Sch = S.Sched;
const segs = (tr) => tr.segs.map((s) => (s.cs ? '~' : '') + s.job + s.start + '-' + s.end).join(' ');
const perTick = (tr) => { const a = new Array(tr.end).fill(null); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) a[k] = (s.cs ? '~' : '') + s.job; return a; };

// ---- MLQ by hand --------------------------------------------------------------------------------------------------
{
  const w = [{ id: 'A', arrive: 0, bursts: [4], cls: 1 }, { id: 'B', arrive: 1, bursts: [2], cls: 0 }, { id: 'C', arrive: 0, bursts: [3], cls: 2 }];
  // strict: A (interactive) runs, B (system) preempts at 1, A again, C only when both are done
  t.eq(segs(Sch.mlq(w)), 'A0-1 B1-3 A3-5 A5-6 C6-9'.replace('A3-5 A5-6', 'A3-6'), 'strict MLQ');
  t.eq(Sch.mlqBudgets([5, 3, 2], 10), [5, 3, 2], 'budgets in proportion');
  t.eq(Sch.mlqBudgets([1, 1, 1], 10), [4, 3, 3], 'largest remainder, the first class first');
  // share: the batch job C gets its 2 ticks of each window of 10 even while A has work
  const big = [{ id: 'A', arrive: 0, bursts: [30], cls: 0 }, { id: 'C', arrive: 0, bursts: [30], cls: 2 }];
  const sh = Sch.mlq(big, { mode: 'share', shares: [8, 1, 2], window: 10 });
  const got = Sch.share(sh, 0, 20);
  t.eq(got, { A: 16, C: 4 }, 'shares 8 : 2 between the two busy classes over two windows');
  t.eq(segs(Sch.mlq(big, { mode: 'strict' })).startsWith('A0-30'), true, 'strict starves C until A is done');
  t.ok(sh.steps[3].budget && sh.steps[0].budget[0] === 7, 'budgets in the steps');
}

// ---- lottery and stride by hand -------------------------------------------------------------------------------------
{
  const w = Sch.presets.shares.jobs;
  const s = Sch.stride(w, { quantum: 1 });
  t.eq(s.steps[0].table.map((x) => [x.id, x.stride, x.pass]), [['A', 33, 33], ['B', 50, 50], ['C', 100, 100]], 'strides and first passes');
  t.eq(segs(s).split(' ').slice(0, 6).join(' '), 'A0-1 B1-2 A2-4 C4-5 B5-6 A6-7', 'stride picks the lowest pass, ties to the longest wait');
  t.eq(Sch.share(s, 0, 60), { A: 30, B: 20, C: 10 }, 'stride gives exactly 3 : 2 : 1');
  t.ok(s.fairness.jain > 0.999, 'stride: Jain index ' + s.fairness.jain.toFixed(4));
  t.eq(s.steps[2].gpass, 32, 'the global pass after two busy ticks: 2 × floor(10000 / 600)');
  const l = Sch.lottery(w, { seed: 7 });
  const d = l.draws[0];
  t.eq(d.holders.map((h) => [h.id, h.lo, h.hi]), [['A', 0, 299], ['B', 300, 499], ['C', 500, 599]], 'ticket ranges in name order');
  t.ok(d.number >= 0 && d.number < 600 && d.winner === d.holders.find((h) => d.number >= h.lo && d.number <= h.hi).id, 'the draw picks its owner');
  t.eq(JSON.stringify(Sch.lottery(w, { seed: 7 }).draws), JSON.stringify(l.draws), 'the same seed, the same draws');
  t.ok(JSON.stringify(Sch.lottery(w, { seed: 8 }).draws) !== JSON.stringify(l.draws), 'another seed, other draws');
  // currency: alice's 100 base tickets split 1 : 3 between A and B; bob's 100 all C's; C lends 50 to A until t = 4
  const c = Sch.lottery([{ id: 'A', bursts: [10], tickets: 100, currency: 'alice' }, { id: 'B', bursts: [10], tickets: 300, currency: 'alice' }, { id: 'C', bursts: [10], tickets: 50, currency: 'bob' }], { currencies: { alice: 100, bob: 100 }, transfers: [{ t: 0, from: 'C', to: 'A', tickets: 50, until: 4 }] });
  t.eq(c.steps[0].tickets, { A: 75, B: 75, C: 50 }, 'currencies and a loan at t = 0');
  t.eq(c.steps[4].tickets, { A: 25, B: 75, C: 100 }, 'the loan ends at t = 4');
  // over a long run the lottery share comes near the tickets
  const long = [{ id: 'A', bursts: [3000], tickets: 300 }, { id: 'B', bursts: [3000], tickets: 100 }];
  const lt = Sch.lottery(long, { seed: 3, quantum: 1 });
  const g = Sch.share(lt, 0, 2000);
  t.ok(Math.abs(g.A / 2000 - 0.75) < 0.04, 'lottery: A gets about 3/4 of the CPU (' + g.A + ' of 2000)');
  t.ok(lt.fairness.jain > 0.99, 'lottery: Jain index per ticket ' + lt.fairness.jain.toFixed(4));
  const short = Sch.lottery(long.map((j) => Object.assign({}, j, { bursts: [12] })), { seed: 3, quantum: 1 });
  t.ok(short.fairness.jain <= 1 && short.fairness.jain > 0.5, 'a short lottery is less fair: ' + short.fairness.jain.toFixed(3));
}

// ---- the independent reimplementations ------------------------------------------------------------------------------
function refMlq(work, P) {
  const C = P.classes || Sch.MLQ_CLASSES, n = C.length, share = P.mode === 'share', W = Math.max(n, P.window || 10);
  const full = share ? Sch.mlqBudgets(P.shares, W) : null;
  const J = work.map((w) => ({ id: w.id, at: w.arrive, B: w.bursts.slice(), k: 0, rem: w.bursts[0], where: 'out', c: Math.min(n - 1, w.cls || 0), sw: 0 }));
  let stamp = 0, cpu = null, slice = 0, t = 0, last = null, bud = full ? full.slice() : null;
  const out = [];
  const enq = (j) => { j.where = 'rq'; j.st = stamp++; };
  const has = (k, x) => J.some((j) => j.where === 'rq' && j.c === k) || (x && x.c === k);
  const want = (x) => { if (share) for (let k = 0; k < n; k++) if (bud[k] > 0 && has(k, x)) return k; for (let k = 0; k < n; k++) if (has(k, x)) return k; return -1; };
  for (;;) {
    let back = null;
    if (cpu && !cpu.sw) {
      if (cpu.rem === 0) { cpu.k++; if (cpu.k < cpu.B.length) { cpu.where = 'io'; cpu.until = t + cpu.B[cpu.k]; cpu.k++; cpu.rem = cpu.B[cpu.k]; } else cpu.where = 'gone'; cpu = null; }
      else if (C[cpu.c].policy === 'rr' && slice >= (C[cpu.c].quantum || 2)) { back = cpu; cpu = null; }
    }
    for (const j of J) if ((j.where === 'out' && j.at === t) || (j.where === 'io' && j.until === t)) enq(j);
    if (back) enq(back);
    if (share && t > 0 && t % W === 0) bud = full.slice();
    if (cpu && !cpu.sw && want(cpu) !== cpu.c) { enq(cpu); cpu = null; }
    if (!cpu) { const k = want(null); if (k >= 0) { let b = null; for (const j of J) if (j.where === 'rq' && j.c === k && (!b || j.st < b.st)) b = j; b.where = 'cpu'; cpu = b; slice = 0; b.sw = P.cs && last && last !== b ? P.cs : 0; last = b; } }
    if (J.every((j) => j.where === 'gone')) break;
    if (cpu && cpu.sw) { out.push('~' + cpu.id); cpu.sw--; }
    else { out.push(cpu ? cpu.id : null); if (cpu) { cpu.rem--; slice++; } }
    if (cpu && share) bud[cpu.c] = Math.max(0, bud[cpu.c] - 1);
    t++;
  }
  return out;
}
function refShare(work, kind, P) {
  const q = P.quantum || 2, L = P.L || 10000, r = rng(P.seed || 1);
  const J = work.map((w, i) => ({ id: w.id, i, at: w.arrive, B: w.bursts.slice(), k: 0, rem: w.bursts[0], where: 'out', tk: w.tickets === undefined ? 100 : w.tickets }));
  for (const j of J) { j.stride = Math.floor(L / j.tk); }
  let cpu = null, slice = 0, t = 0, stamp = 0, gp = 0;
  const out = [];
  const enq = (j, fresh) => { j.where = 'rq'; j.st = stamp++; if (kind === 'stride') j.pass = gp + (fresh ? j.stride : j.rem2); };
  for (;;) {
    let back = null;
    if (cpu && cpu.rem === 0) { cpu.k++; if (kind === 'stride') cpu.rem2 = cpu.pass - gp; if (cpu.k < cpu.B.length) { cpu.where = 'io'; cpu.until = t + cpu.B[cpu.k]; cpu.k++; cpu.rem = cpu.B[cpu.k]; } else cpu.where = 'gone'; cpu = null; }
    else if (cpu && slice >= q) { back = cpu; cpu = null; }
    for (const j of J) if (j.where === 'out' && j.at === t) enq(j, true); else if (j.where === 'io' && j.until === t) enq(j, false);
    if (back) { back.where = 'rq'; back.st = stamp++; }
    if (!cpu) {
      const rq = J.filter((j) => j.where === 'rq');
      if (rq.length) {
        let b;
        if (kind === 'stride') { b = rq[0]; for (const j of rq) if (j.pass < b.pass || (j.pass === b.pass && j.st < b.st)) b = j; }
        else { const tot = rq.reduce((a, j) => a + j.tk, 0), num = Math.floor(r() * tot); let acc = 0; for (const j of rq) { acc += j.tk; if (num < acc) { b = j; break; } } }
        b.where = 'cpu'; cpu = b; slice = 0;
      }
    }
    if (J.every((j) => j.where === 'gone')) break;
    out.push(cpu ? cpu.id : null);
    if (cpu) { cpu.rem--; slice++; if (kind === 'stride') cpu.pass += cpu.stride; }
    const act = J.filter((j) => j.where === 'rq' || j.where === 'cpu').reduce((a, j) => a + j.tk, 0);
    if (cpu) gp += act ? Math.floor(L / act) : 0;
    t++;
  }
  return out;
}

const R = rng(42);
let compared = 0;
for (let n = 0; n < 250; n++) {
  const seed = Math.floor(R() * 1e9);
  const work = Sch.random(seed, { io: n % 3 !== 0 }).map((j, i) => Object.assign(j, { cls: (seed >> i) % 3, tickets: 50 + ((seed >> (2 * i)) % 7) * 50 }));
  for (const P of [{}, { mode: 'share', shares: [5, 3, 2], window: 10 }, { mode: 'share', shares: [1, 1, 1], window: 6, cs: 1 }, { cs: 2 }, { classes: [{ name: 'hi', policy: 'rr', quantum: 3 }, { name: 'lo', policy: 'rr', quantum: 1 }], mode: 'share', shares: [3, 1], window: 8 }]) {
    const full = Object.assign({ shares: [3, 2, 1].slice(0, (P.classes || Sch.MLQ_CLASSES).length) }, P);
    if (!P.shares) full.shares = (P.classes || Sch.MLQ_CLASSES).map((_, k, a) => a.length - k);
    t.eq(perTick(Sch.mlq(work, P)), refMlq(work, full), `seed ${seed} mlq ${JSON.stringify(P)}`);
    compared++;
  }
  for (const P of [{ quantum: 1 }, { quantum: 2 }, { quantum: 3, L: 1000 }]) {
    t.eq(perTick(Sch.stride(work, P)), refShare(work, 'stride', P), `seed ${seed} stride ${JSON.stringify(P)}`);
    compared++;
  }
  for (const P of [{ quantum: 1, seed: seed % 1000 }, { quantum: 2, seed: 5 }]) {
    t.eq(perTick(Sch.lottery(work, P)), refShare(work, 'lottery', P), `seed ${seed} lottery ${JSON.stringify(P)}`);
    compared++;
  }
  // invariants: every job gets its CPU time
  for (const tr of [Sch.mlq(work, { mode: 'share', shares: [2, 1, 1] }), Sch.stride(work), Sch.lottery(work, { seed })]) {
    for (const j of Sch.norm(work)) t.eq(perTick(tr).filter((x) => x === j.id).length, j.cpu, `seed ${seed} ${tr.policy}: ${j.id} gets its CPU time`);
  }
}
t.ok(compared >= 2500, 'compared ' + compared + ' runs');
t.done();
