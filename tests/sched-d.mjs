// The schedulers, part 4 (src/core/sch-h-rt.js, sch-i-pi.js): real-time scheduling and priority inversion.
// Hand-worked task sets; the analysis against the simulation (RM misses a deadline exactly when response-time
// analysis says so, EDF exactly when the demand test fails, and never under the Liu–Layland bound or U ≤ 1);
// an independent reimplementation of RM and EDF compared on seeded random task sets; the inversion scenario with
// each protocol, inheritance shortening the urgent task's blocking, and an independent reimplementation of the
// mutex model compared on seeded random scenarios.
import { load, harness, rng } from './load.mjs';

const t = harness('sched-d');
const S = load(['core']);
const Sch = S.Sched;

// ---- real time by hand --------------------------------------------------------------------------------------------
{
  const ts = [{ id: 'A', C: 2, T: 5 }, { id: 'B', C: 4, T: 7 }];
  const a = Sch.rtAnalysis(ts);
  t.eq([a.U, a.bound, a.rmBound], [0.971, 0.828, false], 'U = 2/5 + 4/7, over the bound for two tasks');
  t.eq(a.rta[1].iterations, [4, 6, 8], 'RTA for B: 4, then 4 + ⌈4/5⌉·2 = 6, then 4 + ⌈6/5⌉·2 = 8 > 7');
  t.eq([a.rmExact, a.edfExact, a.hyper], [false, true, 35], 'RM fails, EDF passes; hyperperiod 35');
  const rm = Sch.rt(ts, { policy: 'rm' }), edf = Sch.rt(ts, { policy: 'edf' });
  t.eq(rm.misses.map((m) => [m.job, m.t, m.left]), [['B1', 7, 1]], 'RM: B1 misses at t = 7 with 1 tick left');
  t.eq(edf.misses, [], 'EDF meets every deadline');
  t.eq(rm.segs.slice(0, 4).map((s) => s.inst + ':' + s.start + '-' + s.end), ['A1:0-2', 'B1:2-5', 'A2:5-7', 'B1:7-8'], 'RM: A2 preempts B1 at 5');
  t.eq(edf.segs.slice(0, 3).map((s) => s.inst + ':' + s.start + '-' + s.end), ['A1:0-2', 'B1:2-6', 'A2:6-8'], 'EDF: B1 (due 7) keeps the CPU over A2 (due 10)');
  t.ok(rm.steps[7].missed.includes('B1') && /misses/.test(rm.steps[7].say), 'the miss is in the step');
  // harmonic periods: RM reaches U = 1
  const h = Sch.rtAnalysis([{ id: 'A', C: 1, T: 2 }, { id: 'B', C: 2, T: 4 }]);
  t.eq([h.U, h.rmExact, h.rta[1].iterations], [1, true, [2, 3, 4]], 'harmonic, U = 1: RM schedulable, R_B = 4');
  t.eq(Sch.rt([{ id: 'A', C: 1, T: 2 }, { id: 'B', C: 2, T: 4 }]).misses, [], 'and the simulation agrees');
  // the bound for n tasks falls toward ln 2
  t.eq([1, 2, 3, 10].map((n) => Sch.rtAnalysis(Array.from({ length: n }, (_, i) => ({ C: 1, T: 100 + i }))).bound), [1, 0.828, 0.78, 0.718], 'Liu–Layland bounds');
  // constrained deadlines: the demand test
  const d = Sch.rtAnalysis([{ id: 'A', C: 2, T: 6, D: 3 }, { id: 'B', C: 2, T: 8, D: 3 }]);
  t.eq([d.edfU, d.edfExact], [true, false], 'U under 1 but D < T: the demand at L = 3 is 4 > 3');
  t.eq(d.demand[0], { L: 3, demand: 4, ok: false }, 'the first failing point');
  // abort on a miss drops the job
  t.ok(Sch.rt(ts, { policy: 'rm', onMiss: 'abort' }).jobs.find((j) => j.job === 'B1').finish === null, 'abort drops the late job');
}

// ---- the analysis against the simulation, and an independent simulator ---------------------------------------
function refRt(tasks, policy, H) {
  const ts = tasks.map((k, i) => ({ id: k.id, i, C: k.C, T: k.T, D: k.D === undefined ? k.T : k.D, ph: k.phase || 0 }));
  const prio = ts.slice().sort((a, b) => a.T - b.T || a.i - b.i).map((k) => k.id);
  const jobs = [], out = [], miss = [];
  let cur = null;
  const key = (j) => (policy === 'edf' ? [j.dl, j.rel, j.k.i] : [prio.indexOf(j.k.id), j.rel]);
  const less = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  for (let t = 0; t <= H; t++) {
    if (cur && cur.left === 0) { jobs.splice(jobs.indexOf(cur), 1); cur = null; }
    for (const j of jobs) if (j.dl === t && j.left > 0) miss.push(j.name);
    if (t === H) break;
    for (const k of ts) if (t >= k.ph && (t - k.ph) % k.T === 0) jobs.push({ name: k.id + ((t - k.ph) / k.T + 1), k, rel: t, dl: t + k.D, left: k.C });
    let b = cur;
    for (const j of jobs) if (!b || less(j, b)) b = j;
    cur = b;
    out.push(cur ? cur.name : null);
    if (cur) cur.left--;
  }
  return { out, miss };
}
const R = rng(31);
let rtSets = 0, rmAgree = 0, edfAgree = 0;
for (let n = 0; n < 400; n++) {
  const k = 2 + (n % 3), ts = [];
  for (let i = 0; i < k; i++) {
    const T = 3 + Math.floor(R() * 10), C = 1 + Math.floor(R() * Math.max(1, Math.floor(T / 2))), D = n % 4 === 3 ? Math.max(C, T - Math.floor(R() * 3)) : T;
    ts.push({ id: String.fromCharCode(65 + i), C, T, D, phase: n % 5 === 4 ? Math.floor(R() * 3) : 0 });
  }
  const A = Sch.rtAnalysis(ts);
  if (A.hyper > 2000) continue;
  rtSets++;
  for (const pol of ['rm', 'edf']) {
    const tr = Sch.rt(ts, { policy: pol });
    const r = refRt(ts, pol, tr.end);
    const inst = new Array(tr.end).fill(null);
    for (const s of tr.segs) for (let x = s.start; x < s.end; x++) inst[x] = s.inst;
    t.eq(inst, r.out, `set ${n} ${pol}: the same schedule`);
    t.eq(tr.misses.map((m) => m.job), r.miss.filter((x, i, a) => a.indexOf(x) === i), `set ${n} ${pol}: the same misses`);
    const sync = ts.every((x) => !x.phase);
    if (sync && pol === 'rm') { t.eq(tr.misses.length === 0, A.rmExact, `set ${n}: RM simulation and response-time analysis agree (U ${A.U})`); rmAgree++; }
    if (sync && pol === 'edf') { t.eq(tr.misses.length === 0, A.edfExact, `set ${n}: EDF simulation and the demand test agree (U ${A.U})`); edfAgree++; }
    if (pol === 'rm' && A.rmBound) t.eq(tr.misses.length, 0, `set ${n}: under the Liu–Layland bound RM meets every deadline`);
    if (pol === 'edf' && A.implicit && A.edfU) t.eq(tr.misses.length, 0, `set ${n}: U ≤ 1 with D = T, EDF meets every deadline`);
    if (A.rmExact && pol === 'rm' && sync) for (const rt of A.rta) t.ok(tr.perTask.find((p) => p.id === rt.id).worst <= rt.R, `set ${n}: ${rt.id}'s worst response is within R = ${rt.R}`);
  }
}
t.ok(rtSets >= 300 && rmAgree >= 200 && edfAgree >= 200, `checked ${rtSets} task sets (${rmAgree} RM and ${edfAgree} EDF against the analysis)`);

// ---- priority inversion -------------------------------------------------------------------------------------------
{
  const segs = (tr) => tr.segs.map((s) => s.job + s.start + '-' + s.end + (s.boosted ? '*' : '')).join(' ');
  const none = Sch.inversion(null, { protocol: 'none' }), inh = Sch.inversion(null, { protocol: 'inherit' }), ceil = Sch.inversion(null, { protocol: 'ceiling' });
  t.eq(segs(none), 'L0-3 H3-4 M4-10 L10-12 H12-15 L15-16', 'no protocol: M runs while H waits on L');
  t.eq(segs(inh), 'L0-3 H3-4 L4-6* H6-9 M9-15 L15-16', 'inheritance: L runs at H’s priority until it unlocks');
  t.eq(segs(ceil), 'L0-1 L1-5* H5-9 M9-15 L15-16', 'ceiling: L runs at the ceiling from its lock');
  const H = (tr) => tr.metrics.rows.find((r) => r.id === 'H');
  t.eq([H(none).blockedOnMutex, H(inh).blockedOnMutex, H(ceil).blockedOnMutex], [8, 2, 0], 'H blocked on the mutex: 8, 2, 0 ticks');
  t.eq([H(none).finish, H(inh).finish, H(ceil).finish], [15, 9, 9], 'H finishes at 15, 9, 9');
  t.ok(H(inh).inversion < H(none).inversion, 'inheritance shortens the inversion');
  t.eq(none.steps[5].blocked, [{ id: 'H', on: 'mtx' }], 'H blocked on mtx in the step');
  t.eq(inh.steps[5].eff.L, 1, 'L inherits priority 1');
  t.eq(ceil.ceilings, { mtx: 1 }, 'the ceiling of mtx is 1');
}
function refPi(tasks, proto) {
  const T = tasks.map((k, i) => ({ id: k.id, i, p: k.prio, at: k.arrive || 0, ops: k.script, pc: 0, rem: k.script[0][0] === 'run' ? k.script[0][1] : 0, st: 'out', since: 0, held: new Set(), on: null }));
  const own = {}, wait = {}, ceil = {}, out = [];
  for (const x of T) for (const o of x.ops) if (o[0] === 'lock') ceil[o[1]] = Math.min(ceil[o[1]] ?? 99, x.p);
  const eff = () => {
    const e = new Map(T.map((x) => [x, x.p]));
    if (proto === 'ceiling') for (const x of T) for (const m of x.held) e.set(x, Math.min(e.get(x), ceil[m]));
    if (proto === 'inherit') for (let k = 0; k < T.length; k++) for (const m in own) if (own[m]) for (const w of wait[m] || []) if (e.get(w) < e.get(own[m])) e.set(own[m], e.get(w));
    return e;
  };
  const nextRun = (x) => { x.pc++; x.rem = x.ops[x.pc] && x.ops[x.pc][0] === 'run' ? x.ops[x.pc][1] : 0; };
  const step = (x, t) => {
    while (x.st === 'cpu') {
      const o = x.ops[x.pc];
      if (!o) { x.st = 'gone'; return; }
      if (o[0] === 'run') { if (x.rem > 0) return; nextRun(x); continue; }
      const m = o[1];
      if (o[0] === 'lock') { if (own[m]) { x.st = 'blk'; x.on = m; (wait[m] = wait[m] || []).push(x); return; } own[m] = x; x.held.add(m); nextRun(x); continue; }
      own[m] = null; x.held.delete(m); nextRun(x);
      const ws = wait[m] || [];
      if (ws.length) { const w = ws.reduce((a, b) => (b.p < a.p ? b : a)); ws.splice(ws.indexOf(w), 1); own[m] = w; w.held.add(m); w.st = 'rdy'; w.since = t; w.on = null; nextRun(w); }
    }
  };
  let cur = null;
  for (let t = 0; t < 5000; t++) {
    if (cur && cur.rem === 0) { step(cur, t); if (cur.st !== 'cpu') cur = null; }
    for (const x of T) if (x.st === 'out' && x.at === t) { x.st = 'rdy'; x.since = t; }
    for (let g = 0; g < 100; g++) {
      const e = eff();
      const cand = T.filter((x) => x.st === 'rdy' || x.st === 'cpu').sort((a, b) => e.get(a) - e.get(b) || (a === cur ? -1 : b === cur ? 1 : a.since - b.since || a.i - b.i));
      const b = cand[0] || null;
      if (b && b !== cur) { if (cur) { cur.st = 'rdy'; cur.since = t; } b.st = 'cpu'; cur = b; }
      if (cur && cur.rem === 0) { step(cur, t); if (cur.st !== 'cpu') { cur = null; continue; } }
      break;
    }
    if (T.every((x) => x.st === 'gone')) break;
    out.push(cur ? cur.id : null);
    if (cur) cur.rem--;
  }
  return out;
}
{
  const R2 = rng(5);
  let ran = 0;
  for (let n = 0; n < 300; n++) {
    const k = 2 + (n % 3), tasks = [];
    for (let i = 0; i < k; i++) {
      const script = [['run', 1 + Math.floor(R2() * 3)]];
      const locks = ['m1', 'm2'].filter(() => R2() < 0.6);
      for (const m of locks) script.push(['lock', m], ['run', 1 + Math.floor(R2() * 3)]);
      for (const m of locks.slice().reverse()) script.push(['unlock', m]);
      script.push(['run', 1 + Math.floor(R2() * 2)]);
      tasks.push({ id: 'T' + i, prio: 1 + Math.floor(R2() * 4), arrive: Math.floor(R2() * 6), script });
    }
    for (const proto of ['none', 'inherit', 'ceiling']) {
      const tr = Sch.inversion(tasks, { protocol: proto });
      const ticks = new Array(tr.end).fill(null);
      for (const s of tr.segs) for (let x = s.start; x < s.end; x++) ticks[x] = s.job;
      t.eq(ticks, refPi(tasks, proto), `scenario ${n} ${proto}: the same schedule`);
      const work = tasks.map((x) => x.script.filter((o) => o[0] === 'run').reduce((a, o) => a + o[1], 0));
      tasks.forEach((x, i) => t.eq(ticks.filter((y) => y === x.id).length, work[i], `scenario ${n} ${proto}: ${x.id} gets its run time`));
      ran++;
    }
    // with one lock order (m1 before m2 everywhere) there is no deadlock: everyone finishes
    const ci = Sch.inversion(tasks, { protocol: 'inherit' });
    t.ok(ci.metrics.rows.every((r) => r.finish !== null), `scenario ${n}: all finish`);
  }
  t.ok(ran === 900, 'compared ' + ran + ' runs');
}
t.done();
