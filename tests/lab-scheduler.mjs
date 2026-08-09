// The Scheduler lab in node: every preset and many random setups run through the lab's run(), wide and narrow. The
// frames are well formed (unique keys, a sentence each, no undefined or NaN shown, steps that point into the trace);
// the numbers they show are the engine's (checked by calling S.Sched directly with the same parameters, and by
// working the metrics out again from the Gantt segments); the flags, the lottery winners, the real-time tests
// (U, the RM bound, response-time analysis) and the inversion counts are recomputed here independently; and the
// same seed gives the same run.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-scheduler-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses, Sch = S.Sched, SL = S.SchedLab, LS = S.LabSetup;
const t = harness('lab-scheduler');
const lab = S.Labs.get('scheduler');
t.ok(!!lab, 'the Scheduler lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup (' + LS.check(lab, defs) + ')');
const f2 = (x) => String(Math.round(x * 100) / 100);
const textOf = (it) => (it.text === undefined ? (it.lines || []).join(' ') : String(it.text));

/** frames well formed */
function wellFormed(r, what) {
  t.ok(!r.error, what + ': runs');
  t.ok(r.frames.length >= 2, what + ': has frames (' + r.frames.length + ')');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10 && !/undefined|NaN/.test(f.say), what + ': frame ' + i + ' says something sound');
    t.ok(Number.isInteger(f.at) && f.at >= 0 && f.at <= r.trace.length, what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) { const s = textOf(it); if (/undefined|NaN|\[object|Infinity/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { if (it.size !== undefined && it.size < 11) { t.ok(false, what + ': frame ' + i + ' has text under 11 units: ' + it.key); break; } }
    for (const tb of f.tables || []) for (const row of tb.rows) t.ok(row.length === tb.cols.length, what + ': table "' + tb.title + '" rows match its columns');
  });
}
const run = (v, seed, narrow) => lab.run(LS.merge(lab, Object.assign({}, defs, v)), { seed: seed || 1, narrow: !!narrow });

// ---- an independent reading of a trace: metrics from the segments, starvation from the per-tick states ---------
function metricsFromSegs(tr) {
  const out = {};
  for (const j of tr.jobs) {
    const segs = tr.segs.filter((s) => s.job === j.id && !s.cs && !s.warm);
    const finish = Math.max(...segs.map((s) => s.end)), first = Math.min(...segs.map((s) => s.start));
    const cs = tr.segs.filter((s) => s.job === j.id && (s.cs || s.warm)).map((s) => s.start);
    const firstAny = Math.min(first, ...cs);
    const cpu = segs.reduce((a, s) => a + s.end - s.start, 0), io = j.bursts.filter((_, k) => k % 2).reduce((a, b) => a + b, 0);
    out[j.id] = { finish, turnaround: finish - j.arrive, waiting: finish - j.arrive - cpu - io, cpu, firstAny };
  }
  return out;
}
function checkTrace(tr, what) {
  const mine = metricsFromSegs(tr);
  for (const row of tr.metrics.rows) {
    t.eq([mine[row.id].finish, mine[row.id].turnaround, mine[row.id].waiting, mine[row.id].cpu], [row.finish, row.turnaround, row.waiting, row.cpu], what + ': ' + row.id + '’s metrics from its Gantt segments');
  }
  t.eq(tr.metrics.sumText.waiting, tr.metrics.rows.map((r) => r.waiting).join(' + ') + ' = ' + tr.metrics.rows.reduce((a, r) => a + r.waiting, 0), what + ': the waiting sum worked out');
}

// ---- compare: the lab's runs are the engine's, called directly ------------------------------------------------
function direct(slot, v, seed) {
  const w = SL.jobs(v.work), cs = v.cs || 0, pred = { alpha: v.alpha, tau0: v.tau0 };
  switch (slot.pol) {
    case 'fcfs': case 'sjf': case 'srtn': return Sch.run(w, slot.pol, { cs });
    case 'sjfp': return Sch.run(w, 'sjf', { cs, predict: pred });
    case 'srtnp': return Sch.run(w, 'srtn', { cs, predict: pred });
    case 'prio': return Sch.run(w, 'prio', { cs, age: slot.age, ageFrom: v.ageFrom });
    case 'priop': return Sch.run(w, 'prio', { cs, preemptive: true, age: slot.age, ageFrom: v.ageFrom });
    case 'rr': return Sch.run(w, 'rr', { cs, quantum: slot.q });
    case 'mlq': return Sch.mlq(w, { classes: v.classes.map((c) => ({ name: c.name, policy: c.policy, quantum: c.quantum })), mode: v.mlqMode, shares: v.classes.map((c) => c.share), window: v.window, cs });
    case 'mlfq': case 'mlfqr': return Sch.mlfq(w, { levels: v.levels, quantum: v.mq.slice(0, v.levels), allot: v.ma.slice(0, v.levels - 1), boost: v.boost, allotMode: slot.pol === 'mlfqr' ? 'reset-io' : 'level', preempt: v.mpre, cs });
    case 'lottery': return Sch.lottery(w, { quantum: slot.q, seed, cs });
    case 'stride': return Sch.stride(w, { quantum: slot.q, L: v.strideL, cs });
    case 'cfs': return Sch.cfs(w, { latency: v.lat, minGran: v.gran, wakeupGran: v.wake, sleeperCredit: v.credit, cs });
    case 'multi': case 'multip': return Sch.multi(w, { cores: v.cores, queue: slot.pol === 'multi' ? 'shared' : 'per-core', quantum: slot.q, push: v.push, pull: v.pull, migrate: v.migrate, cs });
  }
}
/** an independent starvation reading: the longest stretch a job is arrived, unfinished, not on a CPU and not in I/O */
function starveOf(tr, lim) {
  const out = {};
  for (const j of tr.jobs) {
    const fin = tr.metrics.rows.find((r) => r.id === j.id).finish;
    let run = 0, best = 0;
    for (let u = 0; u < tr.end; u++) {
      const st = tr.steps[u];
      const on = st.cores ? st.cores.some((c) => c.run === j.id) : st.run === j.id;
      const io = (st.io || []).some((e) => e.id === j.id);
      run = u >= j.arrive && u < fin && !on && !io ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best >= lim) out[j.id] = best;
  }
  return out;
}
function checkCompare(v, seed, what) {
  const r = run(v, seed, false), rn = run(v, seed, true);
  wellFormed(r, what); wellFormed(rn, what + ' (narrow)');
  const full = LS.merge(lab, Object.assign({}, defs, v));
  const slots = SL.slots(full);
  t.eq(r.runs.length, slots.length, what + ': one chart per policy chosen');
  const last = r.frames[r.frames.length - 1];
  slots.forEach((s, k) => {
    const tr = direct(s, full, seed);
    t.eq(r.runs[k].tr.segs, tr.segs, what + ', ' + r.runs[k].name + ': the chart is the engine’s schedule');
    checkTrace(tr, what + ', ' + r.runs[k].name);
    // the comparison table on the stage shows the engine's means
    const cells = ['turnaround', 'waiting', 'response'].map((key, i) => textOf(last.items.find((it) => it.key === 'cmp:rp' + k + ':' + (i + 1))));
    t.eq(cells, ['turnaround', 'waiting', 'response'].map((key) => f2(tr.metrics.avg[key])), what + ', ' + r.runs[k].name + ': the means on the stage');
    // the side table's sums
    const tb = last.tables[k], sum = tb.rows.find((row) => row[0].text === 'sum');
    t.eq(sum.slice(5), [tr.metrics.sumText.turnaround, tr.metrics.sumText.waiting, tr.metrics.sumText.response], what + ', ' + r.runs[k].name + ': the sums worked out');
    // starvation flags, recomputed
    const mine = starveOf(tr, full.starve), theirs = Object.fromEntries(r.runs[k].flags.starve.map((x) => [x.job, x.ticks]));
    t.eq(theirs, mine, what + ', ' + r.runs[k].name + ': the starvation flags');
    // every Gantt box drawn at the end is one of the engine's segments
    const bars = last.items.filter((it) => it.key.startsWith('r' + k + 'g:s'));
    t.eq(bars.length, tr.segs.filter((sg) => !sg.cs && !sg.warm).length, what + ', ' + r.runs[k].name + ': every segment drawn');
  });
  const r2 = run(v, seed, false);
  t.eq(r2.frames.map((f) => f.say), r.frames.map((f) => f.say), what + ': the same seed, the same run');
  return r;
}

for (const p of lab.setup.presets) {
  const full = LS.merge(lab, Object.assign({}, defs, p.values));
  t.ok(LS.check(lab, full) === null, p.label + ': the preset is valid (' + LS.check(lab, full) + ')');
  if (p.values.mode === 'compare') checkCompare(p.values, 1, p.label);
  else { wellFormed(run(p.values, 1, false), p.label); wellFormed(run(p.values, 1, true), p.label + ' (narrow)'); }
}

// the convoy preset: FCFS shows a convoy behind A; RR does not
{
  const r = run(lab.setup.presets[0].values, 1);
  t.ok(r.runs[0].flags.convoy.some((c) => c.job === 'A'), 'FCFS: a convoy behind A is flagged');
  t.ok(!r.runs[2].flags.convoy.length, 'RR q = 2: no convoy');
}
// aging ends the starvation of Lo
{
  const r = run(lab.setup.presets[2].values, 1);
  t.ok(r.runs[0].flags.starve.some((s) => s.job === 'Lo'), 'no aging: Lo starves');
  t.ok(!r.runs[1].flags.starve.some((s) => s.job === 'Lo'), 'aging: Lo does not');
}

// ---- random setups --------------------------------------------------------------------------------------------
const POLS = SL.POLICIES.map((p) => p.value);
const R = rng(77);
for (let n = 0; n < 40; n++) {
  const work = Sch.random(1000 + n, { n: 2 + Math.floor(R() * 4), maxCpu: 6, spread: 8 }).map((j) => SL.row(j.id, j.arrive, j.bursts, { prio: j.prio, tickets: 50 + Math.floor(R() * 300), nice: Math.floor(R() * 11) - 5, cls: Math.floor(R() * 3), cores: R() < 0.2 ? '0' : 'all' }));
  const pick = () => POLS[Math.floor(R() * POLS.length)];
  const v = { mode: 'compare', work, pol1: pick(), pol2: pick(), pol3: R() < 0.5 ? pick() : 'none', pol4: 'none', q1: 1 + Math.floor(R() * 4), q2: 1 + Math.floor(R() * 4), q3: 2, a1: Math.floor(R() * 3), a2: 0, cs: Math.floor(R() * 2), cores: 2, starve: 6 + Math.floor(R() * 6), push: R() < 0.5 ? 0 : 3, migrate: Math.floor(R() * 2) };
  const why = LS.check(lab, LS.merge(lab, Object.assign({}, defs, v)));
  if (why) { t.ok(/80 ticks/.test(why), 'random setup ' + n + ' is valid or too long (' + why + ')'); continue; }
  checkCompare(v, n + 1, 'random setup ' + n + ' (' + [v.pol1, v.pol2, v.pol3].join(', ') + ')');
}

// ---- the sweep: each quantum's point is the engine's ----------------------------------------------------------
{
  const v = lab.setup.presets.find((p) => p.values.mode === 'sweep').values, full = LS.merge(lab, Object.assign({}, defs, v));
  const r = run(v, 1);
  t.eq(r.frames.length, full.qmax, 'sweep: a frame per quantum');
  const tb = r.frames[r.frames.length - 1].tables[0];
  for (let q = 1; q <= full.qmax; q++) {
    const tr = Sch.run(SL.jobs(full.work), 'rr', { quantum: q, cs: full.cs });
    t.eq(tb.rows[q - 1].slice(0, 4), [String(q), f2(tr.metrics.avg.turnaround), f2(tr.metrics.avg.waiting), f2(tr.metrics.avg.response)], 'sweep: q = ' + q + ' is the engine’s');
  }
}
// ---- CFS: the tree drawn is the engine's, a valid red-black tree ------------------------------------------------
{
  const v = lab.setup.presets.find((p) => p.values.mode === 'cfs').values;
  const r = run(v, 1);
  r.tr.steps.forEach((st, i) => { if (st.tree) t.ok(Sch.rbCheck(st.tree) === null, 'CFS: the tree at t = ' + i + ' is a red-black tree'); });
  const f = r.frames[5], st = r.tr.steps[5], count = (n) => (n ? 1 + count(n.l) + count(n.r) : 0);
  t.eq(f.items.filter((it) => /^rb:n[A-Za-z0-9]+$/.test(it.key) && !/_n[lr]$/.test(it.key)).length, count(st.tree), 'CFS: the tree drawn has the engine’s nodes');
}
// ---- the lottery: each winner owns the number drawn ------------------------------------------------------------
{
  const v = lab.setup.presets.find((p) => p.values.mode === 'lottery').values;
  for (const seed of [1, 2, 3]) {
    const r = run(v, seed);
    for (const d of r.tr.draws) {
      if (d.skipped) continue;
      const owner = d.holders.find((h) => d.number >= h.lo && d.number <= h.hi);
      t.ok(owner && owner.id === d.winner, 'lottery seed ' + seed + ': the draw at t = ' + d.t + ' goes to the owner of ' + d.number);
      t.eq(d.holders.reduce((a, h) => a + h.tickets, 0), d.total, 'lottery: the ranges cover the total');
    }
  }
  const a = run(v, 1).frames.map((f) => f.say).join(), b = run(v, 2).frames.map((f) => f.say).join();
  t.ok(a !== b, 'lottery: another seed, other draws');
}
// ---- real time: U, the RM bound and response-time analysis, recomputed ------------------------------------------
for (const p of lab.setup.presets.filter((x) => x.values.mode === 'rt')) {
  const full = LS.merge(lab, Object.assign({}, defs, p.values)), tasks = SL.tasks(full.tasks), r = run(p.values, 1), A = r.analysis;
  const U = tasks.reduce((a, k) => a + k.C / k.T, 0), n = tasks.length;
  t.ok(Math.abs(A.Uexact - U) < 1e-9, p.label + ': U = Σ C/T');
  t.ok(Math.abs(A.bound - n * (Math.pow(2, 1 / n) - 1)) < 0.006, p.label + ': the RM bound');
  const ord = tasks.slice().sort((a, b) => a.T - b.T);
  ord.forEach((k, i) => {
    let R = k.C;
    for (let g = 0; g < 100; g++) { const nx = k.C + ord.slice(0, i).reduce((a, j) => a + Math.ceil(R / j.T) * j.C, 0); if (nx === R || nx > k.D) { R = nx; break; } R = nx; }
    const rta = A.rta.find((x) => x.id === k.id);
    t.eq(rta.ok, R <= k.D, p.label + ': RTA verdict for ' + k.id);
  });
  for (const run2 of r.runs) {
    // an independent check of the misses: replay the engine's schedule and find the jobs unfinished at their deadline
    const done = {};
    for (const s of run2.tr.segs) done[s.inst] = (done[s.inst] || 0) + (s.end - s.start);
    for (const j of run2.tr.jobs) if (j.deadline <= run2.tr.end) {
      const ran = run2.tr.segs.filter((s) => s.inst === j.job && s.end <= j.deadline).reduce((a, s) => a + s.end - s.start, 0) + run2.tr.segs.filter((s) => s.inst === j.job && s.start < j.deadline && s.end > j.deadline).reduce((a, s) => a + j.deadline - s.start, 0);
      t.eq(!!j.missed, ran < tasks.find((k) => k.id === j.task).C, p.label + ', ' + run2.p + ': ' + j.job + ' missed or met as its schedule says');
    }
    const last = r.frames[r.frames.length - 1];
    t.ok(last.items.filter((it) => it.cls === 'slmiss').length === new Set(run2.tr.misses.map((m) => m.task)).size || run2 !== r.runs[0], p.label + ': misses drawn');
  }
  t.ok(p.label.includes('RM misses') ? r.runs[0].tr.misses.length > 0 && r.runs[1].tr.misses.length === 0 : r.runs.every((x) => !x.tr.misses.length), p.label + ': the misses the preset promises');
}
// ---- inversion: the counts shown are recomputed from the engine's steps -------------------------------------------
for (const p of lab.setup.presets.filter((x) => x.values.mode === 'pi')) {
  const r = run(p.values, 1);
  for (const x of r.runs) {
    const tasks = x.tr.metrics.rows;
    for (const m of tasks) {
      let inv = 0;
      x.tr.steps.forEach((st, u) => {
        if (st.kind === 'end' || u < m.arrive || u >= m.finish || st.run === m.id || !st.run) return;
        const other = tasks.find((o) => o.id === st.run);
        if (other.prio > m.prio) inv++;
      });
      t.eq(m.inversion, inv, p.label + ', ' + x.p + ': ' + m.id + '’s inversion ticks');
    }
  }
  const H = (pp) => r.runs.find((x) => x.p === pp).tr.metrics.rows.slice().sort((a, b) => a.prio - b.prio)[0];
  t.ok(H('inherit').finish <= H('none').finish && H('ceiling').finish <= H('none').finish, p.label + ': inheritance and the ceiling finish the urgent task no later');
}

// ---- the script parser and the limits ---------------------------------------------------------------------------
t.eq(SL.parseScript('1 +m 4 -m 1').value, [['run', 1], ['lock', 'm'], ['run', 4], ['unlock', 'm'], ['run', 1]], 'a script parses');
t.ok(/holding/.test(SL.parseScript('1 +m 2').error), 'a script that ends holding a mutex is refused');
t.ok(/without holding/.test(SL.parseScript('1 -m 2').error), 'an unlock of a free mutex is refused');
t.ok(/never finish/.test(LS.check(lab, LS.merge(lab, Object.assign({}, defs, { mode: 'pi', pitasks: [{ id: 'B', prio: 2, arrive: 0, script: '1 +b 3 +a 1 -a -b 1' }, { id: 'A', prio: 1, arrive: 2, script: '1 +a 2 +b 1 -b -a 1' }] }))) || ''), 'a deadlocking pair of scripts is refused');
t.ok(/at most 80/.test(LS.check(lab, LS.merge(lab, Object.assign({}, defs, { work: [SL.row('A', 0, [30]), SL.row('B', 0, [30]), SL.row('C', 0, [30])] }))) || ''), 'too much CPU is refused');
t.ok(/core 3/.test(LS.check(lab, LS.merge(lab, Object.assign({}, defs, { pol1: 'multi', cores: 2, work: [SL.row('A', 0, [3], { cores: '3' })] }))) || ''), 'an affinity past the cores is refused');
t.ok(/allotment at Q0/.test(LS.check(lab, LS.merge(lab, Object.assign({}, defs, { pol1: 'mlfq', mq: [4, 4, 8], ma: [2, 8] }))) || ''), 'an MLFQ allotment under its quantum is refused');
t.ok(/RM, EDF or both/.test(LS.check(lab, LS.merge(lab, Object.assign({}, defs, { mode: 'rt', rtRM: false, rtEDF: false }))) || ''), 'real time needs a policy');
t.done();
