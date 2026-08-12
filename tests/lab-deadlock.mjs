// The Deadlock lab in node: every preset and many seeded random setups run through the lab's run() in each mode, at
// both widths; the frames are well formed (unique keys, a sentence each, no undefined or NaN on the stage, a place in
// the trace), and their numbers are checked against independent code written here: a safety check and a request test
// of our own for the banker, our own detection scan, our own cycle finder for the graphs and the lock orders, and a
// search of our own over the simulator's states for whether a deadlock can happen at all.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-deadlock-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
const t = harness('lab-deadlock');
const lab = S.Labs.get('deadlock'), LS = S.LabSetup, DL = S.DlLab;
t.ok(!!lab, 'the Deadlock lab registers');
t.ok(LS.check(lab, LS.defaults(lab)) === null, 'the defaults are a valid setup');

// ---- independent references -----------------------------------------------------------------------------------
const le = (a, b) => a.every((x, j) => x <= b[j]);
function safeRef(avail, alloc, need) {
  let work = avail.slice();
  const fin = alloc.map(() => false);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < alloc.length; i++) if (!fin[i] && le(need[i], work)) { work = work.map((x, j) => x + alloc[i][j]); fin[i] = true; changed = true; }
  }
  return fin.every(Boolean);
}
function requestRef(avail, alloc, max, i, req) {
  const need = max.map((r, k) => r.map((x, j) => x - alloc[k][j]));
  if (!le(req, need[i])) return 'over-need';
  if (!le(req, avail)) return 'wait';
  const a2 = alloc.map((r, k) => (k === i ? r.map((x, j) => x + req[j]) : r)), av2 = avail.map((x, j) => x - req[j]);
  return safeRef(av2, a2, max.map((r, k) => r.map((x, j) => x - a2[k][j]))) ? 'granted' : 'unsafe';
}
function detectRef(avail, alloc, request) {
  let work = avail.slice();
  const fin = alloc.map((r) => r.every((x) => !x));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < alloc.length; i++) if (!fin[i] && le(request[i], work)) { work = work.map((x, j) => x + alloc[i][j]); fin[i] = true; changed = true; }
  }
  return fin.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
}
/** does a directed graph (adjacency by node name) have a cycle? colours, iteratively */
function hasCycle(nodes, edges) {
  const adj = new Map(nodes.map((v) => [v, []]));
  for (const [a, b] of edges) adj.get(a).push(b);
  const indeg = new Map(nodes.map((v) => [v, 0]));
  for (const [, b] of edges) indeg.set(b, indeg.get(b) + 1);
  // Kahn: a graph is acyclic iff every node can be peeled off
  const q = nodes.filter((v) => !indeg.get(v)); let seen = 0;
  while (q.length) { const v = q.pop(); seen++; for (const w of adj.get(v)) { indeg.set(w, indeg.get(w) - 1); if (!indeg.get(w)) q.push(w); } }
  return seen < nodes.length;
}
const ragEdges = (g) => { const e = []; for (const [p, r] of g.want) e.push(['p' + p, 'r' + r]); const s = new Set(); for (const [p, r] of g.hold) { const k = r + '>' + p; if (!s.has(k)) { s.add(k); e.push(['r' + r, 'p' + p]); } } return e; };
const ragNodes = (g) => g.procs.map((_, i) => 'p' + i).concat(g.res.map((_, j) => 'r' + j));
/** can any schedule of the simulator deadlock? our own breadth-first search over its states */
function canDeadlock(spec) {
  const start = S.Dl.sim(spec), seen = new Set([start.hash()]), q = [start];
  while (q.length) {
    const s = q.shift();
    if (s.status() === 'deadlock') return true;
    for (const c of s.choices()) { const x = s.clone(); x.step(c); const h = x.hash(); if (!seen.has(h) && seen.size < 200000) { seen.add(h); q.push(x); } }
  }
  return false;
}

// ---- frames ------------------------------------------------------------------------------------------------------
function frames(v, seed, narrow, what) {
  let r;
  try { r = lab.run(LS.merge(lab, v), { seed, narrow }); } catch (e) { t.ok(false, what + ': throws ' + e.stack); return null; }
  if (r.error) { t.ok(false, what + ': error ' + (r.error.msg || r.error)); return null; }
  t.ok(r.frames.length >= 2, what + ': has frames');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 15, what + ': frame ' + i + ' says something');
    t.ok(!/undefined|NaN|\[object/.test(f.say), what + ': frame ' + i + ' sentence: ' + f.say.slice(0, 80));
    for (const it of f.items) { const s = it.text === undefined ? (it.lines || []).join(' ') + (it.label || '') : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
    t.ok(f.at >= 0 && f.at < r.trace.length, what + ': frame ' + i + ' points into the trace');
    t.ok(Array.isArray(f.tables) && f.tables.length && Array.isArray(f.metrics) && f.metrics.length, what + ': frame ' + i + ' has tables and metrics');
  });
  return r;
}
function verify(v, r, what) {
  const metric = (label) => { const m = r.metrics.find((x) => x.label === label); return m ? m.value : undefined; };
  if (v.mode === 'bank') {
    const need = v.max.map((row, i) => row.map((x, j) => x - v.alloc[i][j]));
    if (v.bkind === 'safety') t.eq(metric('Verdict'), safeRef(v.avail, v.alloc, need) ? 'safe' : 'unsafe', what + ': the safety verdict');
    else {
      const ref = requestRef(v.avail, v.alloc, v.max, v.who, v.req);
      t.eq(r.bank.verdict, ref, what + ': the request verdict');
      t.eq(metric('Verdict'), { granted: 'granted', unsafe: 'refused: unsafe', wait: 'waits: not enough free', 'over-need': 'refused: over its claim' }[ref], what + ': the verdict shown');
    }
    // every Need cell in the side table is Max − Allocation
    const tb = r.tables[0];
    t.ok(tb.rows.every((row, i) => row.slice(1).every((c, j) => +c === (r.bank.after && v.bkind === 'request' && r.bank.verdict === 'granted' ? r.bank.after.need[i][j] : need[i][j]))), what + ': the Need table');
  } else if (v.mode === 'detect') {
    t.eq(r.det.deadlocked, detectRef(v.dAvail, v.dAlloc, v.dReq), what + ': who is deadlocked');
    if (r.rec) {
      const st = r.rec.state;
      if (r.frames[r.frames.length - 1].title === 'clear') t.eq(detectRef(st.avail, st.alloc, st.request), [], what + ': after recovery nobody is deadlocked');
      // units are conserved: Available + every Allocation is the same before and after
      const tot = (a, al) => a.map((x, j) => x + al.reduce((s, row) => s + row[j], 0));
      if (v.recover === 'rollback') t.eq(tot(st.avail, st.alloc), tot(v.dAvail, v.dAlloc), what + ': no unit made or lost by rollback');
    }
  } else if (v.mode === 'rag') {
    const { V, sG, sW } = r.rag;
    t.eq(!!V.C.cycle, hasCycle(ragNodes(sG), ragEdges(sG)), what + ': the cycle search agrees with ours');
    const al = sG.procs.map((_, i) => sG.res.map((_, j) => sG.hold.filter(([p, q]) => p === i && q === j).length));
    const rq = sG.procs.map((_, i) => sG.res.map((_, j) => (sG.want.some(([p, q]) => p === i && q === j) ? (sW[i + '>' + j] || 1) : 0)));
    const av = sG.res.map((x, j) => x.units - al.reduce((s2, row) => s2 + row[j], 0));
    t.eq(V.det.deadlocked, detectRef(av, al, rq), what + ': who is deadlocked, by our own detection');
    t.ok(/deadlock|cycle|stuck/.test(r.frames[r.frames.length - 1].say), what + ': the verdict says it');
  } else {
    const { mc, L, R } = r.cond, spec = DL.condSpec(LS.merge(lab, v));
    t.eq(!!mc.violation, canDeadlock(spec), what + ': whether a deadlock is possible');
    const locks = spec.res.map((x) => x.name);
    t.eq(L.cycles.length > 0, hasCycle(locks, L.edges.map((e) => [e.from, e.to])), what + ': the lock-order cycle');
    if (R.status === 'deadlock') { const g = R.steps[R.steps.length - 1].rag; t.ok(hasCycle(ragNodes(g), ragEdges(g)) || g.res.some((x) => x.units > 1), what + ': a single-unit deadlock shows a cycle'); }
    // units conserved at every step
    for (const st of R.steps) { const held = spec.res.map((_, j) => st.procs.reduce((s, p) => s + p.held[j], 0)); if (spec.rules.mutex !== false) t.ok(held.every((h, j) => h + st.avail[j] === spec.res[j].units), what + ': units conserved'); }
  }
}

// the graph mode: every snapshot's cycle against our own finder
function verifyRagSnapshots(v, what) {
  const R = DL.scriptRun(LS.merge(lab, v));
  for (const e of R.evs) {
    const g = S.Rag.graph(e.rag), c = S.Rag.cycle(g).cycle;
    t.eq(!!c, hasCycle(ragNodes(e.rag), ragEdges(e.rag)), what + ': a cycle after line ' + (e.k + 1));
    if (c) { const E = new Set(ragEdges(e.rag).map(([a, b]) => a + '>' + b)); t.ok(c.every((x, k) => E.has(x + '>' + c[(k + 1) % c.length])), what + ': the cycle follows real edges'); }
    const held = e.rag.res.map((_, j) => e.rag.hold.filter(([, r]) => r === j).length);
    t.ok(held.every((h, j) => h <= e.rag.res[j].units), what + ': never more held than there are units');
  }
}

for (const p of lab.setup.presets) for (const narrow of [false, true]) {
  const v = LS.merge(lab, p.values);
  t.ok(LS.check(lab, v) === null, p.label + ': a valid preset');
  const r = frames(v, 3, narrow, p.label + (narrow ? ' (narrow)' : ''));
  if (r) verify(v, r, p.label);
  if (v.mode === 'rag' && v.ragFrom === 'script' && !narrow) verifyRagSnapshots(v, p.label);
}

// ---- random setups -----------------------------------------------------------------------------------------------
const R = rng(20261019), int = (a, b) => a + Math.floor(R() * (b - a + 1));
for (let k = 0; k < 40; k++) {
  const n = int(1, 6), m = int(1, 4);
  const max = Array.from({ length: n }, () => Array.from({ length: m }, () => int(0, 6)));
  const alloc = max.map((row) => row.map((x) => int(0, x)));
  const avail = Array.from({ length: m }, () => int(0, 4));
  let req = Array.from({ length: m }, () => int(0, 2)); if (req.every((x) => !x)) req[0] = 1;
  const v = LS.merge(lab, { mode: 'bank', alloc, max, avail, bkind: k % 4 ? 'request' : 'safety', who: int(0, n - 1), req });
  if (LS.check(lab, v)) { t.ok(false, 'random banker ' + k + ' invalid: ' + LS.check(lab, v)); continue; }
  const r = frames(v, 1, k % 2 === 1, 'random banker ' + k);
  if (r) verify(v, r, 'random banker ' + k);
}
for (let k = 0; k < 30; k++) {
  const n = int(1, 6), m = int(1, 4);
  const dAlloc = Array.from({ length: n }, () => Array.from({ length: m }, () => int(0, 2)));
  const dReq = Array.from({ length: n }, () => Array.from({ length: m }, () => int(0, 2)));
  const ckpt = dAlloc.map((row) => row.map((x) => int(0, x)));
  const v = LS.merge(lab, { mode: 'detect', dAlloc, dReq, dAvail: Array.from({ length: m }, () => int(0, 1)), cost: Array.from({ length: n }, () => int(1, 9)), ckpt, recover: ['none', 'cheapest', 'all', 'rollback'][k % 4], penalty: int(0, 12) });
  if (LS.check(lab, v)) { t.ok(false, 'random detect ' + k + ' invalid: ' + LS.check(lab, v)); continue; }
  const r = frames(v, 1, k % 2 === 1, 'random detect ' + k);
  if (r) verify(v, r, 'random detect ' + k);
}
function randomScript(np, res) {
  const rows = [];
  for (let i = 0; i < np; i++) {
    const held = res.map(() => 0);
    for (let s = 0; s < int(1, 4); s++) {
      const j = int(0, res.length - 1);
      if (held[j] && R() < 0.4) { rows.push({ who: 'P' + i, op: 'rel', res: res[j].name, n: held[j] }); held[j] = 0; }
      else if (held[j] < res[j].units) { const nn = int(1, res[j].units - held[j]); rows.push({ who: 'P' + i, op: 'req', res: res[j].name, n: nn }); held[j] += nn; }
      else rows.push({ who: 'P' + i, op: 'work', res: res[j].name, n: 1 });
    }
    res.forEach((r, j) => { if (held[j]) rows.push({ who: 'P' + i, op: 'rel', res: r.name, n: held[j] }); });
  }
  // shuffle the lines, keeping each process's own order
  const per = Array.from({ length: np }, (_, i) => rows.filter((x) => x.who === 'P' + i)), out = [];
  while (per.some((q) => q.length)) { const live = per.filter((q) => q.length); out.push(live[int(0, live.length - 1)].shift()); }
  return out.slice(0, 20);
}
for (let k = 0; k < 30; k++) {
  const np = int(2, 4), nr = int(1, 3), res = Array.from({ length: nr }, (_, j) => ({ name: 'R' + j, units: k % 3 ? 1 : int(1, 3) }));
  const script = randomScript(np, res);
  const mode = k % 2 ? 'cond' : 'rag';
  const v = LS.merge(lab, { mode, ragFrom: 'script', nproc: np, res, script, cMutex: R() < 0.8, cHold: R() < 0.7, cPreempt: R() < 0.7, cCirc: R() < 0.7, cSched: R() < 0.5 ? 'worst' : 'seed' });
  if (LS.check(lab, v)) { t.ok(false, 'random ' + mode + ' ' + k + ' invalid: ' + LS.check(lab, v)); continue; }
  const r = frames(v, k + 1, k % 4 === 1, 'random ' + mode + ' ' + k);
  if (r) verify(v, r, 'random ' + mode + ' ' + k);
  if (mode === 'rag') verifyRagSnapshots(v, 'random rag ' + k);
}

// ---- the same seed, the same frames; a drawn graph round trip -----------------------------------------------------
const c9 = LS.merge(lab, lab.setup.presets.find((p) => /circular wait off/.test(p.label)).values);
const say = (r) => JSON.stringify(r.frames.map((f) => f.say));
t.eq(say(lab.run(c9, { seed: 7 })), say(lab.run(c9, { seed: 7 })), 'the same seed gives the same run');
const res3 = [{ name: 'R0', units: 2 }, { name: 'R1', units: 1 }];
const e = DL.parseEdges('R0>P0 R0>P1 P0>R1 R1>P2 P2>R0', 3, res3);
t.ok(!e.error, 'a typed graph parses');
t.eq(DL.parseEdges(DL.edgesText({ hold: e.hold, want: e.want }, res3), 3, res3), e, 'a graph survives its text');
t.ok(!!DL.parseEdges('R1>P0 R1>P2', 3, res3).error, 'more units held than there are is refused');
t.ok(!!DL.parseEdges('P0>P1', 3, res3).error, 'an edge between two processes is refused');
const drawn = frames(LS.merge(lab, { mode: 'rag', ragFrom: 'graph', nproc: 3, res: res3, edges: 'R0>P0 R0>P1 P0>R1 R1>P2 P2>R0' }), 1, false, 'a drawn graph');
if (drawn) {
  t.ok(drawn.frames[0].items.some((it) => it.key === 'g:p0' && it.pick), 'the drawn graph can be clicked');
  t.eq(drawn.rag.V.det.deadlocked, detectRef([0, 0], [[1, 0], [1, 0], [0, 1]], [[0, 1], [0, 0], [1, 0]]), 'the drawn graph: detection on its counts');
}
// a drawn graph: its nodes stay put while edges are added and removed
const posOf = (r) => JSON.stringify(r.frames[0].items.filter((it) => /^g:[pr]\d+$/.test(it.key)).map((it) => [it.key, it.x, it.y]));
const base = { mode: 'rag', ragFrom: 'graph', nproc: 4, res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }, { name: 'R2', units: 2 }] };
const p0 = posOf(lab.run(LS.merge(lab, Object.assign({}, base, { edges: 'R0>P0 P0>R1' })), { seed: 1 }));
for (const ed of ['R0>P0 P0>R1 R1>P2', 'R0>P0 P0>R1 R1>P2 P2>R0', 'P0>R1 R1>P2 R2>P3 P3>R0', '']) t.eq(posOf(lab.run(LS.merge(lab, Object.assign({}, base, { edges: ed })), { seed: 1 })), p0, 'drawn nodes stay put with edges ' + (ed || 'none'));
t.done();
