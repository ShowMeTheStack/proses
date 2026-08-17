// The Storage lab in node: every preset and a run of random setups go through the lab's run(), wide and narrow; the
// frames are well formed (unique keys, a sentence each, no undefined or NaN shown, steps that point into the trace)
// and the same seed gives the same frames. The numbers are checked by independent means: the arm's movement against
// a reimplementation of FCFS, SSTF and LOOK on a static queue, each access time as the sum of its parts, the SSD's
// write amplification and its own consistency check, RAID parity recomputed by XOR and every single-disk failure of
// every redundant level rebuilt to the bytes that were written, and the I/O timelines summed up again.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-storage-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-storage');
const lab = S.Labs.get('storage'), LS = S.LabSetup, SL = S.StoLab;
t.ok(!!lab, 'the Storage lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');
const setup = (vals) => LS.merge(lab, Object.assign({}, defs, vals));

function frames(v, seed, narrow, what) {
  let r;
  try { r = lab.run(v, { seed, narrow }); } catch (e) { t.ok(false, what + ': runs (' + e.message + ')'); return null; }
  t.ok(r.frames.length >= 2, what + ': has frames (' + r.frames.length + ')');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' has a duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10, what + ': frame ' + i + ' says something');
    t.ok(f.at >= 0 && f.at < Math.max(1, r.trace.length), what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) {
      const s = [it.text, it.sub].concat(it.lines || []).filter((x) => x !== undefined).join(' ');
      if (/undefined|NaN|\[object|Infinity/.test(s) || /NaN/.test(String(it.x) + it.y + it.w + it.h)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '" (' + it.key + ')'); break; }
    }
    if (/undefined|NaN|\[object/.test(f.say)) t.ok(false, what + ': frame ' + i + ' says "' + f.say + '"');
  });
  for (const tb of r.tables || []) for (const row of tb.rows) t.ok(row.length === tb.cols.length, what + ': table "' + tb.title + '" rows match its columns');
  return r;
}

// ---- every preset, wide and narrow, twice -------------------------------------------------------------------------
for (const p of lab.setup.presets) {
  const v = setup(p.values);
  t.ok(LS.check(lab, v) === null, p.label + ': the preset is a valid setup (' + LS.check(lab, v) + ')');
  const r1 = frames(v, 1, false, p.label);
  frames(v, 1, true, p.label + ' (narrow)');
  const r2 = lab.run(v, { seed: 1, narrow: false });
  if (r1) t.eq(r2.frames.map((f) => f.say), r1.frames.map((f) => f.say), p.label + ': the same seed gives the same run');
}

// ---- disk: movement by an independent reimplementation, access times as sums -----------------------------------------
function moveRef(pol, q, start, dir, C) {
  let pos = start, left = q.slice(), mv = 0, up = dir === 'up';
  if (pol === 'fcfs') { for (const c of q) { mv += Math.abs(c - pos); pos = c; } return mv; }
  if (pol === 'sstf') {
    while (left.length) {
      let best = 0;
      for (let i = 1; i < left.length; i++) { const d = Math.abs(left[i] - pos), b = Math.abs(left[best] - pos); if (d < b || (d === b && (up ? left[i] > pos : left[i] < pos) && !(up ? left[best] > pos : left[best] < pos))) best = i; }
      mv += Math.abs(left[best] - pos); if (left[best] !== pos) up = left[best] > pos; pos = left[best]; left.splice(best, 1);
    }
    return mv;
  }
  if (pol === 'look') {
    const a = left.filter((c) => (up ? c >= pos : c <= pos)), b = left.filter((c) => (up ? c < pos : c > pos));
    if (!b.length) return a.length ? Math.abs((up ? Math.max(...a) : Math.min(...a)) - pos) : 0;
    const far = a.length ? (up ? Math.max(...a) : Math.min(...a)) : pos, end = up ? Math.min(...b) : Math.max(...b);
    return Math.abs(far - pos) + Math.abs(far - end);
  }
  return null;
}
const R = rng(42);
for (let k = 0; k < 24; k++) {
  const C = 50 + Math.floor(R() * 400), n = 3 + Math.floor(R() * 12);
  const q = Array.from({ length: n }, () => Math.floor(R() * C)), start = Math.floor(R() * C), dir = R() < 0.5 ? 'up' : 'down';
  const v = setup({ mode: 'disk', dSrc: 'list', dQueue: q, dCyl: C, dStart: start, dDir: dir, dKnee: Math.min(40, C - 3), p_fcfs: true, p_sstf: true, p_look: true, p_scan: k % 3 === 0, p_cscan: k % 4 === 0, p_clook: k % 5 === 0 });
  const why = LS.check(lab, v);
  t.ok(why === null, 'random disk ' + k + ': valid (' + why + ')');
  if (why) continue;
  const pl = SL.diskPlan(v, 3);
  for (const run of pl.runs) {
    const ref = moveRef(run.pol.id, q, start, dir, C);
    if (ref !== null) t.eq(run.r.totals.movement, ref, 'random disk ' + k + ', ' + run.pol.id + ': the arm moves as an independent count says');
    for (const x of run.rows) t.ok(Math.abs(x.seek + x.rot + x.xfer - x.total) < 1e-6 || Math.abs(x.seek + x.rot + x.xfer + (x.access.overhead || 0) - x.total) < 1e-6, 'random disk ' + k + ': an access is seek + rotation + transfer');
    t.eq(run.rows.map((x) => x.cyl).sort((a, b) => a - b), q.slice().sort((a, b) => a - b), 'random disk ' + k + ', ' + run.pol.id + ': every request is served once');
  }
  if (k % 6 === 0) frames(v, 3, k % 12 === 0, 'random disk ' + k);
}

// ---- SSD: write amplification and the FTL’s own check ---------------------------------------------------------------
for (const p of lab.setup.presets.filter((p) => p.values.mode === 'ssd')) {
  const pl = SL.ssdPlan(setup(p.values), 1);
  t.eq(S.SSD.check(pl.F), [], p.label + ': the translation layer is consistent at the end');
  const st = pl.stats;
  t.ok(Math.abs(st.wa - st.flash / st.host) < 0.01, p.label + ': write amplification is flash ÷ host writes');
  t.ok(st.flash === st.host + st.gcCopies + st.wlCopies, p.label + ': every flash write is a host write or a copy');
  const last = pl.cuts[pl.cuts.length - 1].snap;
  t.eq(last.blocks.reduce((a, b) => a + b.valid, 0), [...last.l2p].filter((x) => x >= 0).length, p.label + ': one valid page for every mapped logical page');
}

// ---- RAID: parity recomputed, every single failure rebuilt ----------------------------------------------------------
const xorRef = (arrs) => arrs.reduce((a, b) => a ^ b, 0);
for (const [level, disks] of [[1, 3], [10, 4], [4, 4], [5, 3], [5, 5], [6, 4], [6, 6]]) {
  for (let d = 0; d < disks; d++) {
    const v = setup({ mode: 'raid', rLevel: level, rDisks: disks, rChunk: 3, rMsg: 'ARRAYS KEEP THEIR DATA', rFail1: d, rFail2: -1, rSwOff: 4, rSwText: 'q' });
    const why = LS.check(lab, v);
    t.ok(why === null, 'RAID ' + level + ' × ' + disks + ': valid (' + why + ')');
    if (why) continue;
    const pl = SL.raidPlan(v);
    t.ok(!pl.rbErr, 'RAID ' + level + ' × ' + disks + ', disk ' + d + ' lost: it rebuilds');
    t.eq([...pl.afterRebuild[d]], [...pl.afterWrite[d]], 'RAID ' + level + ' × ' + disks + ', disk ' + d + ' lost: rebuilt to the bytes written');
    t.eq(pl.back && String.fromCharCode(...pl.back.bytes), 'ARRAYS KEEP THEIR DATA', 'RAID ' + level + ' × ' + disks + ': the message reads back');
    if (level === 4 || level === 5) for (let s = 0; s < pl.stripes; s++) for (let b = 0; b < pl.A.chunk; b++) t.ok(xorRef(pl.afterWrite.map((u) => u[s * pl.A.chunk + b])) === 0, 'RAID ' + level + ': every stripe XORs to zero (stripe ' + s + ')');
    if (d === 0) frames(v, 1, false, 'RAID ' + level + ' × ' + disks);
  }
}
{
  const v = setup({ mode: 'raid', rLevel: 6, rDisks: 5, rChunk: 2, rMsg: 'TWO MAY FAIL', rFail1: 0, rFail2: 3 });
  const pl = SL.raidPlan(v);
  t.eq([...pl.afterRebuild[0]], [...pl.afterWrite[0]], 'RAID 6: two lost disks rebuilt (disk 0)');
  t.eq([...pl.afterRebuild[3]], [...pl.afterWrite[3]], 'RAID 6: two lost disks rebuilt (disk 3)');
  // Q recomputed independently in GF(2^8)
  const lay = pl.lay;
  for (let s = 0; s < pl.stripes; s++) {
    const q = lay[s].find((r) => r.role === 'q').disk;
    const want = lay[s].filter((r) => r.role === 'data').reduce((a, r) => a ^ S.GF.mul(S.GF.gpow(r.chunk - s * pl.w), pl.afterWrite[r.disk][s * 2]), 0);
    t.eq(pl.afterWrite[q][s * 2], want, 'RAID 6: Q of stripe ' + s + ' is the GF sum of g^k · D_k');
  }
}
{
  const pl = SL.raidPlan(setup({ mode: 'raid', rLevel: 5, rDisks: 4, rFail1: 0, rFail2: 2 }));
  t.ok(!!pl.rbErr && !pl.back, 'RAID 5 with two disks lost: no rebuild and no read');
  const pl0 = SL.raidPlan(setup({ mode: 'raid', rLevel: 0, rDisks: 3, rFail1: 1, rFail2: -1 }));
  t.ok(!!pl0.rbErr, 'RAID 0 with a disk lost: no rebuild');
  t.ok(LS.check(lab, setup({ mode: 'raid', rLevel: 10, rDisks: 5 })) !== null, 'RAID 10 needs an even number of disks');
}

// ---- I/O: the timelines summed up again -----------------------------------------------------------------------------
for (const p of lab.setup.presets.filter((p) => p.values.mode === 'io')) {
  const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false });
  if (v.ioView === 'xfer') {
    for (const m of ['polling', 'interrupt', 'dma']) {
      const x = S.IO.transfer(m, SL.ioXferOpts(v));
      const busy = x.lanes.cpu.filter((s) => s.kind !== 'free').reduce((a, s) => a + s.to - s.from, 0);
      t.ok(Math.abs(busy - x.totals.cpuBusy) < 1e-6, p.label + ', ' + m + ': the CPU’s busy time is its segments summed');
      t.ok(r.tables[0].rows.some((row) => row[0] === x.name && row[2] === SL.fix(x.totals.cpuBusy)), p.label + ', ' + m + ': the table shows the engine’s number');
    }
  }
  if (v.ioView === 'read') {
    const x = r.result;
    t.ok(Math.abs(x.steps.reduce((a, s) => a + s.dt, 0) - x.total) < 1e-6, p.label + ': the read’s time is its layers summed');
    t.eq(r.frames.length, x.steps.length, p.label + ': a frame for every layer the read passes');
  }
  if (v.ioView === 'modes') {
    const md = S.IO.modes(SL.ioModeOpts(v));
    for (const k of ['blocking', 'nonblocking', 'async']) t.ok(r.tables[0].rows.some((row) => row[0] === md[k].name && row[1] === SL.fix(md[k].finishA)), p.label + ', ' + k + ': the table shows when A finishes');
  }
}

// ---- random setups of every workbench ---------------------------------------------------------------------------------
for (let k = 0; k < 18; k++) {
  const m = ['disk', 'ssd', 'raid', 'io'][k % 4], r = rng(100 + k), int = (a, b) => a + Math.floor(r() * (b - a + 1));
  let v;
  if (m === 'disk') v = setup({ mode: 'disk', dSrc: 'random', dRandN: int(2, 20), dSpread: int(0, 800), p_sstf: true, p_cscan: true, p_nscan: k % 2 === 0, p_fscan: k % 3 === 0, dBatch: int(1, 5) });
  if (m === 'ssd') v = setup({ mode: 'ssd', sBlocks: int(6, 24), sPages: int(2, 16), sCount: int(10, 800), sWork: ['sequential', 'uniform', 'hotcold'][k % 3], sGc: k % 2 ? 'greedy' : 'cost-benefit', sWear: ['none', 'dynamic', 'static'][k % 3], sTrim: [0, 0.1][k % 2], sFill: k % 2 === 0 });
  if (m === 'raid') { const lv = [0, 1, 4, 5, 6, 10][int(0, 5)], n = lv === 10 ? 2 * int(2, 4) : int(Math.max(4, 2), 8); v = setup({ mode: 'raid', rLevel: lv, rDisks: n, rChunk: int(2, 8), rMsg: 'RANDOM ' + k + ' BYTES', rFail1: int(-1, n - 1), rFail2: int(-1, n - 1), rSwOff: int(0, 10), rSwText: 'ab' }); }
  if (m === 'io') v = setup({ mode: 'io', ioView: ['xfer', 'modes', 'read'][k % 3], xBytes: int(1, 200), xUnit: int(4, 16), xDmaBlock: [0, 16, 32][k % 3], rdBytes: int(1, 30000), rdOffset: int(0, 9000), rdCached: ['hit', 'miss', 'miss'], rdDisk: [300, 301, 900] });
  const why = LS.check(lab, v);
  if (why) { t.ok(typeof why === 'string', 'random ' + m + ' ' + k + ': refused with a reason'); continue; }
  frames(v, 1 + k, k % 2 === 1, 'random ' + m + ' ' + k);
}
// ---- the kernel I/O subsystem: buffering, the cache, the spool and the block queue, recomputed independently -----------
{
  // buffering: an independent schedule of the device, the slots and the process
  const ref = (kind, o) => {
    const k = { none: 0, single: 1, double: 2, circular: o.slots }[kind], val = (x, i) => (Array.isArray(x) ? x[i % x.length] : x);
    let pf = 0, df = 0; const moveEnd = [];
    for (let i = 0; i < o.blocks; i++) {
      const T = val(o.fill, i), C = val(o.compute, i);
      if (!k) { pf += T + C; continue; }
      const fs = Math.max(df, i >= k ? moveEnd[i - k] : 0), fe = fs + T; df = fe;
      const ms = Math.max(fe, pf), me = ms + o.move; moveEnd[i] = me; pf = me + C;
    }
    return pf;
  };
  for (const p of lab.setup.presets.filter((x) => x.values.ioView === 'buffer')) {
    const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), o = SL.bufOpts(v);
    for (const x of r.buf) t.ok(Math.abs(x.r.total - ref(x.kind, o)) < 1e-6, p.label + ', ' + x.kind + ': the total time, worked out again (' + x.r.total + ')');
    t.eq(r.metrics.map((m) => m.value), r.buf.map((x) => SL.fix(x.r.total)), p.label + ': the metrics are the engine’s totals');
  }
  // the cache: an independent LRU with write-back and write-through
  const lru = (size, write, ra, ops) => {
    const c = []; const st = { hits: 0, misses: 0, diskReads: 0, diskWrites: 0 };
    const ins = (b, d) => { if (c.length >= size) { const e = c.shift(); if (e.d) st.diskWrites++; } c.push({ b, d }); };
    for (const o of ops) {
      if (o.op === 'sync') { for (const e of c) if (e.d) { e.d = false; st.diskWrites++; } continue; }
      const i = c.findIndex((e) => e.b === o.block), w = o.op === 'w';
      if (i >= 0) { st.hits++; const e = c.splice(i, 1)[0]; c.push(e); if (w) { if (write === 'through') st.diskWrites++; else e.d = true; } continue; }
      st.misses++; if (!w) st.diskReads++;
      ins(o.block, w && write === 'back'); if (w && write === 'through') st.diskWrites++;
      if (!w) for (let j = 1; j <= ra && j < size; j++) { if (c.some((e) => e.b === o.block + j)) continue; ins(o.block + j, false); st.diskReads++; const e = c.pop(); c.splice(Math.max(0, c.length - j), 0, e); }
    }
    return { st, contents: c.map((e) => e.b) };
  };
  for (const p of lab.setup.presets.filter((x) => x.values.ioView === 'cache')) {
    const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), ops = SL.cacheOps(v.cOps);
    t.eq(r.frames.length, ops.length, p.label + ': a frame for every operation');
    for (const x of r.cache) {
      const me = lru(v.cSize, x.write, v.cRa, ops);
      t.eq([x.r.stats.hits, x.r.stats.misses, x.r.stats.diskReads, x.r.stats.diskWrites], [me.st.hits, me.st.misses, me.st.diskReads, me.st.diskWrites], p.label + ', write-' + x.write + ': hits, misses, disk reads and writes');
      t.eq(x.r.contents.map((c) => c.block), me.contents, p.label + ', write-' + x.write + ': the cache at the end, LRU first');
      ops.forEach((_, k) => { const m = lru(v.cSize, x.write, v.cRa, ops.slice(0, k + 1)); t.eq(x.pre[k].stats.diskWrites, m.st.diskWrites, p.label + ', write-' + x.write + ': disk writes after op ' + k); });
    }
  }
  t.ok(lab.run(setup(lab.setup.presets.find((x) => /too big/.test(x.label)).values), { seed: 1, narrow: false }).cache[0].r.stats.hits === 0, 'a loop one block larger than the cache never hits under LRU');
  // the spool: when each process can go on, both ways
  for (const p of lab.setup.presets.filter((x) => x.values.ioView === 'spool')) {
    const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), jobs = v.spJobs.slice().sort((a, b) => a.at - b.at);
    let free = 0; const direct = {};
    for (const j of jobs) { const st = Math.max(free, j.at); free = st + j.pages * v.spPage; direct[j.proc] = free - j.at; }
    for (const j of r.spool.direct.jobs) t.ok(Math.abs(j.delay - direct[j.proc]) < 1e-6, p.label + ': ' + j.proc + ' waits ' + direct[j.proc] + ' holding the printer');
    for (const j of r.spool.spooled.jobs) t.ok(Math.abs(j.delay - v.spJobs.find((x) => x.proc === j.proc).pages * v.spSpool) < 1e-3, p.label + ': ' + j.proc + ' waits only to spool its pages');
    t.ok(r.spool.spooled.meanDelay < r.spool.direct.meanDelay, p.label + ': spooling shortens the mean delay');
  }
  // the block queue: merges, and every request served once, in each scheduler's order
  for (const p of lab.setup.presets.filter((x) => x.values.ioView === 'queue')) {
    const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), reqs = SL.queueReqs(v);
    for (const x of r.queue) {
      const ids = x.r.dispatched.flatMap((d) => d.ids).sort((a, b) => a - b);
      t.eq(ids, reqs.map((_, i) => i), p.label + ', ' + x.el + ': every request is served once');
      t.eq(x.r.totals.merges, reqs.length - x.r.dispatched.length, p.label + ', ' + x.el + ': merges = requests − dispatches');
      if (!v.qMerge) t.eq(x.r.totals.merges, 0, p.label + ', ' + x.el + ': nothing merges with merging off');
      for (const d of x.r.dispatched) {
        const parts = d.ids.map((i) => reqs[i]).sort((a, b) => a.sector - b.sector);
        t.ok(parts.every((q, i) => q.op === d.op && (i === 0 || parts[i - 1].sector + parts[i - 1].count === q.sector)) && parts[0].sector === d.sector, p.label + ', ' + x.el + ': a merged dispatch is contiguous and of one kind');
      }
      if (x.el === 'noop') {
        const firsts = x.r.dispatched.map((d) => Math.min(...d.ids.map((i) => reqs[i].at)));
        t.ok(firsts.every((a, i) => i === 0 || a >= firsts[i - 1]), p.label + ', noop: dispatched in arrival order');
      }
      let h = v.qStart, mv = 0;
      for (const d of x.r.dispatched) { mv += Math.abs(d.sector - h); h = d.sector + d.count - 1; }
      t.eq(x.r.totals.movement, mv, p.label + ', ' + x.el + ': the head movement summed again');
    }
  }
}

t.done();
