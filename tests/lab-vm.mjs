// The Virtual memory lab in node: every preset and random setups run through the lab's run(); the frames are well
// formed, and the numbers agree with independent reimplementations here: FIFO, LRU and OPT fault by fault, the faults
// against frames sweep with Belady's anomaly flagged where one more frame faults more, the working set, the cost of
// the faults, and global LRU replacement among several processes. The same seed gives the same run.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-vm-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
const t = harness('lab-vm');
const lab = S.Labs.get('vm'), LS = S.LabSetup, VL = S.VMLab;
t.ok(!!lab, 'the Virtual memory lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');

function wellFormed(r, what) {
  t.ok(!r.error, what + ': runs');
  if (r.error) return;
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10 && !/undefined|NaN/.test(f.say), what + ': frame ' + i + ' says something');
    t.ok(f.at >= 0 && f.at < r.trace.length, what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { const s = it.text === undefined ? (it.lines || []).join(' ') : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
  });
}

/** independent page replacement: faults for FIFO, LRU and OPT */
function faults(policy, refs, n) {
  const fr = [], last = new Map(), loaded = [];
  let f = 0;
  refs.forEach((p, i) => {
    last.set(p, i);
    if (fr.includes(p)) return;
    f++;
    if (fr.length < n) { fr.push(p); loaded.push(p); return; }
    let v;
    if (policy === 'fifo') v = loaded.shift();
    else if (policy === 'lru') { v = fr.reduce((a, b) => (last.get(a) <= last.get(b) ? a : b)); }
    else { const next = (q) => { for (let j = i + 1; j < refs.length; j++) if (refs[j] === q) return j; return Infinity; }; v = fr.reduce((a, b) => (next(b) > next(a) || (next(b) === next(a) && fr.indexOf(b) < fr.indexOf(a)) ? b : a)); }
    fr[fr.indexOf(v)] = p;
    if (policy === 'fifo') loaded.push(p);
  });
  return f;
}

function checkOne(v, seed, what) {
  const r = lab.run(v, { seed, narrow: false });
  wellFormed(r, what);
  if (r.error) return r;
  wellFormed(lab.run(v, { seed, narrow: true }), what + ' (narrow)');
  const pages = r.refs.map((x) => x.page);
  t.eq(r.frames.length, pages.length + 3, what + ': a frame a reference, then three more');
  for (const run of r.runs) {
    if (['fifo', 'lru', 'opt'].includes(run.policy)) t.eq(run.faults, faults(run.policy, pages, v.frames), what + ': ' + run.name + ' faults');
    // the F and ✓ marks of the last reference frame agree with the engine
    const marks = r.frames[pages.length - 1].items.filter((it) => it.key.startsWith('p' + r.runs.indexOf(run) + ':m'));
    t.ok(marks.every((it) => (it.text === 'F') === !run.steps[+it.key.split(':m')[1]].hit), what + ': ' + run.name + ' marks');
  }
  // the sweep, with Belady flagged exactly where one more frame faults more
  const sw = VL.sweep(v, r.refs);
  for (const s of sw) {
    if (['fifo', 'lru', 'opt'].includes(s.policy)) for (const c of s.curve) t.eq(c.faults, faults(s.policy, pages, c.n), what + ': ' + s.name + ' with ' + c.n + ' frames');
    const want = s.curve.slice(1).filter((c, k) => c.faults > s.curve[k].faults).map((c) => c.n);
    t.eq(s.belady.map((b) => b.to), want, what + ': ' + s.name + ' Belady points');
    if (s.policy === 'lru' || s.policy === 'opt') t.eq(s.belady.length, 0, what + ': ' + s.name + ' never shows Belady');
  }
  // the working set: the distinct pages in the last Δ
  const ws = S.VM.workingSet(pages, v.delta);
  ws.steps.forEach((st, i) => t.eq(st.wss, new Set(pages.slice(Math.max(0, i - v.delta + 1), i + 1)).size, what + ': working set at ' + (i + 1)));
  // the cost: hits at memory speed, each fault its own path
  const dm = r.frames[r.frames.length - 1].demand || null;
  const c = VL.costs(v), pol = VL.policies(v)[0], rep = S.Mem.replace(pol, r.refs, v.frames, VL.opts(v));
  let total = 0;
  for (const st of rep.steps) total += st.hit ? c.mem : c.trap + c.check + c.find + (st.writeBack ? c.writeBack : 0) + c.read + c.update + c.restart + c.mem;
  t.ok(Math.abs(VL.eatFrame(v, r.refs, false).demand.eat - total / pages.length) < 1e-6, what + ': the access time from the faults');
  return r;
}

for (const p of lab.setup.presets) {
  const v = LS.merge(lab, Object.assign({}, defs, p.values));
  t.ok(LS.check(lab, v) === null, p.label + ': a valid setup (' + LS.check(lab, v) + ')');
  if (v.mode === 'multi') continue;
  const r1 = checkOne(v, 3, p.label), r2 = lab.run(v, { seed: 3, narrow: false });
  t.eq(r2.frames.map((f) => f.say), r1.frames.map((f) => f.say), p.label + ': the same seed gives the same run');
}
// Belady's preset: FIFO faults more with 4 frames than with 3
{
  const p = lab.setup.presets.find((x) => /Belady/.test(x.label)), v = LS.merge(lab, Object.assign({}, defs, p.values));
  const sw = VL.sweep(v, VL.parseRefs(v.refs)), fifo = sw.find((s) => s.policy === 'fifo');
  t.ok(fifo.belady.some((b) => b.from === 3 && b.to === 4), 'the Belady preset shows 3 → 4 frames');
  t.ok(/Belady/.test(lab.run(v, { seed: 1, narrow: false }).frames.find((f) => f.title === 'faults against frames').say), 'the sweep says so');
}
// generated strings follow the seed; a C program gives references with the lines they came from
{
  const v = Object.assign({}, defs, { source: 'gen', gen: 'phases', length: 30, pages: 8 });
  const a = lab.run(v, { seed: 4, narrow: false }), b = lab.run(v, { seed: 4, narrow: false }), c = lab.run(v, { seed: 5, narrow: false });
  t.eq(a.refs, b.refs, 'the same seed, the same string');
  t.ok(JSON.stringify(a.refs) !== JSON.stringify(c.refs), 'another seed, another string');
  const vc = Object.assign({}, defs, { source: 'c', src: VL.PROGS[2].src, pageBytes: 64, maxRefs: 30 });
  const rc = lab.run(vc, { seed: 1, narrow: false });
  wellFormed(rc, 'three-streams.c');
  t.ok(rc.refs.length === 30 && rc.frames.slice(0, 30).every((f) => f.marks && f.marks.length === 1 && f.marks[0].line >= 1), 'each traced reference is tagged with its line');
  const bad = lab.run(Object.assign({}, vc, { src: 'int main(void) { return 0 }' }), { seed: 1, narrow: false });
  t.ok(bad.error && bad.error.line, 'a program that does not compile reports its line');
}
// random typed strings and policies
const R = rng(9);
const POLS = ['opt', 'lru', 'fifo', 'clock', 'second', 'eclock', 'lfu', 'mfu', 'aging', 'nru'];
for (let k = 0; k < 20; k++) {
  const n = 6 + Math.floor(R() * 24), pages = 2 + Math.floor(R() * 7);
  const refs = Array.from({ length: n }, () => String(Math.floor(R() * pages)) + (R() < 0.2 ? 'w' : ''));
  const pols = [...new Set([0, 1, 2].map(() => POLS[Math.floor(R() * POLS.length)]))];
  const v = Object.assign({}, defs, { source: 'typed', refs, frames: 1 + Math.floor(R() * 5), pol1: pols[0], pol2: pols[1] || 'none', pol3: pols[2] || 'none', delta: 1 + Math.floor(R() * 6) });
  if (LS.check(lab, v)) continue;
  checkOne(v, 1, 'random ' + k);
}

// ---- several processes: global LRU checked by a simulation of its own
function globalLRU(P, F, q) {
  const fr = [], pos = P.map(() => 0), fl = P.map(() => 0);
  let clock = 0;
  while (pos.some((x, k) => x < P[k].refs.length)) for (let k = 0; k < P.length; k++) for (let j = 0; j < q && pos[k] < P[k].refs.length; j++, pos[k]++) {
    const page = P[k].refs[pos[k]], tt = clock++, at = fr.findIndex((f) => f.k === k && f.page === page);
    if (at >= 0) { fr[at].last = tt; continue; }
    fl[k]++;
    if (fr.length < F) fr.push({ k, page, last: tt });
    else { const v = fr.reduce((a, b) => (b.last < a.last ? b : a)); Object.assign(v, { k, page, last: tt }); }
  }
  return fl;
}
for (const p of lab.setup.presets.filter((x) => x.values.mode === 'multi')) {
  const v = LS.merge(lab, Object.assign({}, defs, p.values));
  const r = lab.run(v, { seed: 2, narrow: false });
  wellFormed(r, p.label);
  wellFormed(lab.run(v, { seed: 2, narrow: true }), p.label + ' (narrow)');
  if (v.mpolicy === 'lru') t.eq(r.G.faults, globalLRU(r.P, v.mframes, v.quantum), p.label + ': global LRU faults per process');
  t.eq(r.L.held.every((h, k) => h <= r.quota[k]), true, p.label + ': local replacement stays within the quotas');
  t.eq(r.quota.reduce((a, b) => a + b, 0) <= v.mframes, true, p.label + ': the quotas fit the frames');
  const best = r.th.points.reduce((a, b) => (b.cpu > a.cpu ? b : a));
  t.eq(r.th.best, best.n, p.label + ': the CPU curve peaks where it says');
  t.ok(r.th.points[r.th.points.length - 1].cpu < best.cpu, p.label + ': past the peak the CPU falls (thrashing)');
  t.eq(r.frames.length, r.P.reduce((a, x) => a + x.refs.length, 0) + 2, p.label + ': a frame a reference, then two');
}
// no reference string the lab ships holds the well-known textbook example, renamed or spread out
{
  const shipped = [['defaults', defs]].concat(lab.setup.presets.map((p) => [p.label, LS.merge(lab, Object.assign({}, defs, p.values))]));
  for (const [label, v] of shipped) {
    const strings = [];
    if (v.mode === 'multi') { for (const p of VL.procRefs(v, 1)) strings.push(p.refs); for (const row of v.procs) if (row.kind === 'typed') strings.push(String(row.refs).split(/[\s,]+/).map(Number)); }
    else { strings.push(VL.parseRefs(v.refs).map((r) => r.page)); const r = VL.refs(v, 1); if (!r.error) strings.push(r.refs.map((x) => x.page)); }
    strings.forEach((refs, k) => t.ok(!S.Mem.holdsFamous(refs), label + ': string ' + (k + 1) + ' is not the textbook example'));
  }
}
t.done();
