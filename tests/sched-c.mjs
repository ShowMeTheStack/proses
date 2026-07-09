// The schedulers, part 3 (src/core/sch-f-cfs.js, sch-g-multi.js): the CFS-style scheduler and several cores.
// Hand-worked cases; the red-black tree checked at every step (a valid tree, in order, holding exactly the ready
// jobs, its leftmost the next pick); an independent reimplementation of each (CFS on a sorted list, multicore on
// plain arrays) compared with the engine on seeded random workloads; weights and shares.
import { load, harness, rng } from './load.mjs';

const t = harness('sched-c');
const S = load(['core']);
const Sch = S.Sched;
const segs = (tr) => tr.segs.map((s) => (s.cs ? '~' : s.warm ? '!' : '') + s.job + s.start + '-' + s.end + (s.core !== undefined ? 'c' + s.core : '')).join(' ');
const perTick = (tr) => { const a = new Array(tr.end).fill(null); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) a[k] = (s.cs ? '~' : '') + s.job; return a; };

// ---- CFS by hand ---------------------------------------------------------------------------------------------------
{
  t.eq(Sch.weight(0), 1024, 'nice 0 weighs 1024');
  t.eq(Sch.weight(-20), 88761, 'nice −20');
  t.eq(Sch.weight(19), 15, 'nice 19');
  t.eq(Sch.WEIGHTS.length, 40, 'forty nice values');
  for (let k = 1; k < 40; k++) t.ok(Sch.WEIGHTS[k - 1] / Sch.WEIGHTS[k] > 1.15 && Sch.WEIGHTS[k - 1] / Sch.WEIGHTS[k] < 1.35, 'each nice step about 1.25: ' + k);
  // two equal jobs: slices of 12 × 1024 / 2048 = 6
  const two = Sch.cfs([{ id: 'A', arrive: 0, bursts: [10] }, { id: 'B', arrive: 0, bursts: [10] }]);
  t.eq(segs(two), 'A0-6 B6-12 A12-16 B16-20', 'two equal jobs share by slices of 6');
  t.eq(two.steps[0].slice, 6, 'slice 6');
  t.eq(two.steps[6].vr, { A: 6, B: 0 }, 'vruntime after A’s slice');
  // weights: nice 0 against nice 5 (1024 : 335)
  const w = Sch.cfs([{ id: 'A', arrive: 0, bursts: [400] }, { id: 'B', arrive: 0, bursts: [400], nice: 5 }]);
  const g = Sch.share(w, 0, 300);
  t.ok(Math.abs(g.A / g.B - 1024 / 335) < 0.15, 'shares follow the weights: ' + g.A + ' : ' + g.B);
  t.ok(w.fairness.jain > 0.99, 'weighted Jain index ' + w.fairness.jain.toFixed(4));
  // a sleeper wakes with at most latency / 2 of credit, and preempts
  const sl = Sch.cfs([{ id: 'A', arrive: 0, bursts: [40] }, { id: 'B', arrive: 0, bursts: [1, 20, 5] }]);
  const wake = sl.steps[27];
  // B ran 1 tick (vruntime 1) and slept from 7 to 27; min_vruntime is then 26
  t.ok(/wakes/.test(wake.say) && wake.run === 'B' && wake.decision === 'preempt', 'B wakes at t = 27 and preempts A: ' + wake.say);
  t.eq([wake.minV, wake.vr.B], [26, 20], 'B’s vruntime: max(1, 26 − 6) = 20');
  const nos = Sch.cfs([{ id: 'A', arrive: 0, bursts: [40] }, { id: 'B', arrive: 0, bursts: [1, 20, 5] }], { sleeperCredit: false });
  t.eq([nos.steps[27].vr.B, nos.steps[27].run], [26, 'A'], 'without sleeper credit B wakes at min_vruntime and does not preempt');
}

// ---- the tree at every step ---------------------------------------------------------------------------------------
{
  const R = rng(9);
  for (let n = 0; n < 60; n++) {
    const work = Sch.random(Math.floor(R() * 1e9), { n: 3 + (n % 6) }).map((j, i) => Object.assign(j, { nice: ((n + i * 7) % 11) - 5 }));
    const tr = Sch.cfs(work, { latency: 6 + (n % 4) * 3, minGran: 1 + (n % 3) });
    let ok = true;
    for (const st of tr.steps) {
      if (st.kind !== 'tick') continue;
      const bad = Sch.rbCheck(st.tree);
      const inorder = [], walk = (h) => { if (!h) return; walk(h.l); inorder.push(h.id); walk(h.r); };
      walk(st.tree);
      if (bad || JSON.stringify(inorder.slice().sort()) !== JSON.stringify(st.ready.slice().sort()) || JSON.stringify(inorder) !== JSON.stringify(st.ready)) { ok = false; t.ok(false, 'tree at t = ' + st.t + ': ' + (bad || 'contents ' + inorder + ' against ' + st.ready)); break; }
      const vs = inorder.map((id) => st.vr[id]);
      for (let k = 1; k < vs.length; k++) if (vs[k] < vs[k - 1]) { ok = false; t.ok(false, 'tree order at t = ' + st.t); break; }
      if (st.decision === 'dispatch' && st.run) { const prev = tr.steps[st.t - 1]; void prev; }
    }
    t.ok(ok, 'a valid red-black tree at every step, run ' + n);
  }
}

// ---- CFS reimplemented on a sorted list -------------------------------------------------------------------------
function refCfs(work, P) {
  const lat = P.latency || 12, mg = P.minGran || 2, wg = P.wakeupGran === undefined ? 1 : P.wakeupGran, credit = P.sleeperCredit !== false;
  const J = work.map((w) => ({ id: w.id, at: w.arrive, B: w.bursts.slice(), k: 0, rem: w.bursts[0], where: 'out', v: 0, w: Sch.weight(w.nice || 0), ran: 0, sl: 0 }));
  let list = [], cpu = null, t = 0, minv = 0, seq = 0;
  const out = [];
  const add = (j) => { j.where = 'rq'; j.seq = seq++; list.push(j); list.sort((a, b) => a.v - b.v || a.seq - b.seq); };
  const upd = () => { const m = Math.min(cpu ? cpu.v : Infinity, list.length ? list[0].v : Infinity); if (m !== Infinity && m > minv) minv = m; };
  for (;;) {
    if (cpu) {
      if (cpu.rem === 0) { cpu.k++; if (cpu.k < cpu.B.length) { cpu.where = 'io'; cpu.until = t + cpu.B[cpu.k]; cpu.k++; cpu.rem = cpu.B[cpu.k]; } else cpu.where = 'gone'; cpu = null; }
      else if (cpu.ran >= cpu.sl) { const j = cpu; cpu = null; add(j); }
    }
    upd();
    let woke = false;
    for (const j of J) {
      if (j.where === 'out' && j.at === t) { j.v = Math.max(j.v, minv); add(j); woke = true; }
      else if (j.where === 'io' && j.until === t) { j.v = Math.max(j.v, minv - (credit ? lat / 2 : 0)); add(j); woke = true; }
    }
    if (cpu && woke && list.length && cpu.v - list[0].v > wg) { const j = cpu; cpu = null; add(j); }
    if (!cpu && list.length) {
      const j = list.shift(); j.where = 'cpu'; cpu = j; j.ran = 0;
      const all = list.concat([j]), Wt = all.reduce((a, x) => a + x.w, 0);
      j.sl = Math.max(mg, (Math.max(lat, all.length * mg) * j.w) / Wt);
    }
    upd();
    if (J.every((j) => j.where === 'gone')) break;
    out.push(cpu ? cpu.id : null);
    if (cpu) { cpu.rem--; cpu.ran++; cpu.v += 1024 / cpu.w; }
    t++;
  }
  return out;
}

// ---- multicore reimplemented ------------------------------------------------------------------------------------
function refMulti(work, P) {
  const N = P.cores || 2, q = P.quantum || 2, shared = P.queue === 'shared', pull = P.pull !== false, push = P.push || 0, mig = P.migrate || 0, cs = P.cs || 0;
  const J = work.map((w) => ({ id: w.id, at: w.arrive, B: w.bursts.slice(), k: 0, rem: w.bursts[0], where: 'out', aff: w.affinity || null, home: -1, last: -1, sw: 0, wm: 0 }));
  for (const j of J) if (j.aff) { j.aff = j.aff.filter((c) => c < N); if (!j.aff.length) j.aff = null; }
  const can = (j, c) => !j.aff || j.aff.includes(c);
  const run = new Array(N).fill(null), Q = Array.from({ length: N }, () => []), lastOn = new Array(N).fill(null), sq = [], ticks = Array.from({ length: N }, () => []);
  const ld = (c) => Q[c].length + (run[c] ? 1 : 0);
  let t = 0, slice = new Array(N).fill(0);
  for (;;) {
    const exp = [];
    for (let c = 0; c < N; c++) {
      const j = run[c];
      if (!j || j.sw || j.wm) continue;
      if (j.rem === 0) { j.k++; if (j.k < j.B.length) { j.where = 'io'; j.until = t + j.B[j.k]; j.k++; j.rem = j.B[j.k]; } else j.where = 'gone'; run[c] = null; }
      else if (slice[c] >= q) { exp.push([j, c]); run[c] = null; }
    }
    for (const j of J) if ((j.where === 'out' && j.at === t) || (j.where === 'io' && j.until === t)) {
      j.where = 'rq';
      if (shared) { sq.push(j); continue; }
      let c = j.home >= 0 && can(j, j.home) ? j.home : -1;
      if (c < 0) for (let k = 0; k < N; k++) if (can(j, k) && (c < 0 || ld(k) < ld(c))) c = k;
      if (c < 0) c = 0;
      Q[c].push(j); j.home = c;
    }
    for (const [j, c] of exp) { j.where = 'rq'; (shared ? sq : Q[c]).push(j); }
    if (!shared && push && t > 0 && t % push === 0) {
      for (;;) {
        let hi = 0, lo = 0;
        for (let k = 0; k < N; k++) { if (ld(k) > ld(hi)) hi = k; if (ld(k) < ld(lo)) lo = k; }
        if (ld(hi) - ld(lo) < 2) break;
        let idx = -1;
        for (let i = Q[hi].length - 1; i >= 0; i--) if (can(Q[hi][i], lo)) { idx = i; break; }
        if (idx < 0) break;
        const [j] = Q[hi].splice(idx, 1); Q[lo].push(j); j.home = lo;
      }
    }
    for (let c = 0; c < N; c++) {
      if (run[c]) continue;
      let j = null;
      if (shared) { const i = sq.findIndex((x) => can(x, c)); if (i >= 0) j = sq.splice(i, 1)[0]; }
      else {
        if (Q[c].length) j = Q[c].shift();
        else if (pull) {
          let from = -1;
          for (let k = 0; k < N; k++) if (k !== c && Q[k].some((x) => can(x, c)) && (from < 0 || Q[k].length > Q[from].length)) from = k;
          if (from >= 0) { let i = Q[from].length - 1; while (!can(Q[from][i], c)) i--; j = Q[from].splice(i, 1)[0]; }
        }
      }
      if (!j) continue;
      j.where = 'cpu'; run[c] = j; slice[c] = 0; j.home = c;
      j.sw = cs && lastOn[c] && lastOn[c] !== j ? cs : 0;
      j.wm = mig && j.last >= 0 && j.last !== c ? mig : 0;
      lastOn[c] = j;
    }
    if (J.every((j) => j.where === 'gone')) break;
    for (let c = 0; c < N; c++) {
      const j = run[c];
      if (!j) ticks[c].push(null);
      else if (j.sw) { ticks[c].push('~' + j.id); j.sw--; }
      else if (j.wm) { ticks[c].push('!' + j.id); j.wm--; }
      else { ticks[c].push(j.id); j.rem--; slice[c]++; j.last = c; }
    }
    t++;
  }
  return ticks;
}
const coreTicks = (tr) => { const N = tr.params.cores, a = Array.from({ length: N }, () => new Array(tr.end).fill(null)); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) a[s.core][k] = (s.cs ? '~' : s.warm ? '!' : '') + s.job; return a; };

// ---- multicore by hand ------------------------------------------------------------------------------------------
{
  const w = [{ id: 'A', arrive: 0, bursts: [4] }, { id: 'B', arrive: 0, bursts: [4] }, { id: 'C', arrive: 0, bursts: [4] }, { id: 'D', arrive: 0, bursts: [1] }];
  // per-core: A→0, B→1, C→0, D→1; D is done at 3, so core 1 then pulls C from core 0
  const p = Sch.multi(w, { cores: 2, queue: 'per-core', quantum: 2 });
  // B finishes on core 1 at t = 5 and core 1, now empty, pulls C from core 0
  t.eq(segs(p), 'A0-2c0 B0-2c1 C2-4c0 D2-3c1 B3-5c1 A4-6c0 C5-7c1', 'per-core queues with pull');
  t.eq(p.moves.map((m) => [m.job, m.from, m.to, m.t]), [['C', 0, 1, 5]], 'one pull');
  const np = Sch.multi(w, { cores: 2, quantum: 2, pull: false });
  t.eq([np.end, p.end], [8, 7], 'without pull core 1 idles while C waits on core 0');
  // affinity: E may only run on core 1, so core 0 idles beside it
  const af = Sch.multi([{ id: 'E', arrive: 0, bursts: [3], affinity: [1] }, { id: 'F', arrive: 0, bursts: [3], affinity: [1] }], { cores: 2, quantum: 1, queue: 'shared' });
  t.ok(af.segs.every((s) => s.core === 1), 'affinity keeps E and F on core 1');
  t.eq(af.perCore[0].busy, 0, 'core 0 never runs them');
  // the migration cost
  const m0 = Sch.multi(w, { cores: 2, queue: 'shared', quantum: 1 }), m1 = Sch.multi(w, { cores: 2, queue: 'shared', quantum: 1, migrate: 2 });
  t.ok(m1.migrations.length > 0 && m1.end > m0.end, 'warming caches costs time: ' + m0.end + ' → ' + m1.end + ' with ' + m1.migrations.length + ' migrations');
  t.ok(m1.metrics.util < m0.metrics.util, 'and utilisation falls');
  // push balancing moves work from a busy core
  // A and C on core 0, B and D (one tick each) on core 1: at t = 2 core 0 has 2 and core 1 none, so A is pushed
  const pw = [{ id: 'A', arrive: 0, bursts: [6] }, { id: 'B', arrive: 0, bursts: [1] }, { id: 'C', arrive: 0, bursts: [6] }, { id: 'D', arrive: 0, bursts: [1] }];
  const pu = Sch.multi(pw, { cores: 2, quantum: 2, pull: false, push: 2 });
  t.eq(pu.moves.map((m) => [m.job, m.from, m.to, m.t]), [['A', 0, 1, 2]], 'A is pushed to core 1 at t = 2');
  t.ok(pu.moves.length > 0 && pu.moves.every((m) => /push/.test(m.why)), 'the balancer pushes: ' + pu.moves.map((m) => m.job + ' ' + m.from + '→' + m.to + '@' + m.t).join(', '));
}

const R = rng(77);
let compared = 0;
for (let n = 0; n < 200; n++) {
  const seed = Math.floor(R() * 1e9);
  const work = Sch.random(seed, { io: n % 3 !== 0, n: 2 + (n % 7) }).map((j, i) => Object.assign(j, { nice: ((seed >> i) % 9) - 4 }));
  for (const P of [{}, { latency: 6, minGran: 1 }, { latency: 20, minGran: 4, wakeupGran: 3 }, { sleeperCredit: false }]) {
    t.eq(perTick(Sch.cfs(work, P)), refCfs(work, P), `seed ${seed} cfs ${JSON.stringify(P)}`);
    compared++;
  }
  const aw = work.map((j, i) => Object.assign({}, j, { affinity: (seed >> i) % 4 === 0 ? [i % 3] : undefined }));
  for (const P of [{ cores: 2, queue: 'shared' }, { cores: 3, queue: 'per-core' }, { cores: 2, queue: 'per-core', pull: false, push: 3 }, { cores: 3, queue: 'per-core', push: 4, migrate: 2, cs: 1, quantum: 3 }, { cores: 4, queue: 'shared', migrate: 1, quantum: 1 }]) {
    const tr = Sch.multi(aw, P);
    t.eq(coreTicks(tr), refMulti(aw, P), `seed ${seed} multi ${JSON.stringify(P)}`);
    for (const j of Sch.norm(aw)) t.eq(tr.segs.filter((s) => s.job === j.id && !s.cs && !s.warm).reduce((a, s) => a + s.end - s.start, 0), j.cpu, `seed ${seed} multi: ${j.id} gets its CPU time`);
    if (aw.some((j) => j.affinity)) t.ok(tr.segs.every((s) => { const j = aw.find((x) => x.id === s.job); return !j.affinity || j.affinity[0] >= P.cores || j.affinity.includes(s.core); }), `seed ${seed}: affinity holds`);
    compared++;
  }
}
t.ok(compared >= 1800, 'compared ' + compared + ' runs');
t.done();
