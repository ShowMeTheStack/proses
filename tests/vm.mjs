// The virtual-memory engines: the page-fault path and its costs worked by hand, EAT with a fault rate, demand
// paging over a string, frame allocation, global against local replacement (against an independent version),
// thrashing, the working set (against brute force), page-fault frequency, copy-on-write and zero-fill (reference
// counts checked against the page tables), mmap, and the reference-string generators and the C trace adapter.
import { load, harness, rng } from './load.mjs';

const t = harness('vm');
const S = load(['core']);
const V = S.VM, M = S.Mem;
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- the fault path ---------------------------------------------------------------------------------------------------
{
  const dirty = V.faultPath({ page: 5, write: true, victim: { page: 2, frame: 1, dirty: true } });
  t.eq(dirty.steps.map((s) => s.kind), ['trap', 'check', 'frame', 'writeBack', 'read', 'update', 'restart'], 'fault path with a dirty victim');
  t.ok(near(dirty.total, 1 + 0.5 + 1 + 8000 + 8000 + 0.2 + 1) && dirty.frame === 1, 'its cost: two disk transfers, 16003.7 µs');
  t.ok(near(dirty.steps[4].t, 16002.5), 'cumulative time at the read');
  for (const none of [false, null, undefined, -1]) {
    const p = V.faultPath({ page: 5, freeFrame: none, victim: { page: 2, frame: 4, dirty: false } });
    t.ok(p.frame === 4 && p.steps[2].victim === 2 && /No frame is free/.test(p.steps[2].say), 'freeFrame ' + none + ': no free frame, so a victim is evicted');
  }
  const zeroth = V.faultPath({ page: 5, freeFrame: 0 });
  t.ok(zeroth.frame === 0 && /free frame is on the free list: frame 0/.test(zeroth.steps[2].say), 'freeFrame 0 is a free frame, frame 0');
  const free = V.faultPath({ page: 5, freeFrame: 9 });
  t.ok(near(free.total, 8003.7) && free.frame === 9 && !free.steps.some((s) => s.kind === 'writeBack'), 'a free frame: one disk transfer');
  t.ok(near(V.faultPath({ page: 5, freeFrame: 0, source: 'zero' }).total, 5.7), 'zero-fill: no disk at all');
  const bad = V.faultPath({ page: 99, legal: false });
  t.eq([bad.steps.map((s) => s.kind), bad.killed], [['trap', 'check', 'kill'], true], 'an illegal address is killed');
  t.ok(near(V.faultPath({ page: 1, freeFrame: 0, costs: { read: 100 } }).total, 103.7), 'costs can be changed');
  t.ok(near(V.eat({ mem: 0.1, fault: 8000, p: 0.001 }).us, 0.999 * 0.1 + 8), 'EAT with one fault in a thousand');
  t.ok(near(V.maxFaultRate({ mem: 0.1, fault: 8000, slowdown: 0.1 }), 0.01 / 7999.9), 'the fault rate for a 10% slowdown');
  const d = V.demand({ refs: [{ page: 3, write: true }, 1, 2, 4, 3], frames: 3, policy: 'fifo', anon: [3, 4] });
  t.eq(d.faults, M.replace('fifo', [{ page: 3, write: true }, 1, 2, 4, 3], 3).faults, 'demand: the faults the policy gives');
  t.ok(near(d.total, d.steps.reduce((a, s) => a + s.us, 0)), 'demand: the total is the sum of the steps');
  const kinds = d.steps.filter((s) => s.kind === 'fault').map((s) => s.path.find((x) => x.kind === 'read' || x.kind === 'zero'));
  t.eq(kinds.map((k) => k.kind), ['zero', 'read', 'read', 'zero', 'read'], 'demand: anonymous pages zero-fill the first time');
  t.ok(/from swap/.test(kinds[4].say) && /from its file/.test(kinds[1].say), 'demand: page 3, written out, comes back from swap; others from their file');
  t.eq(d.writeBacks, 1, 'demand: dirty page 3 is written back when evicted');
}

// ---- frame allocation ---------------------------------------------------------------------------------------------------
{
  const eq = V.allocFrames({ frames: 10, procs: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], scheme: 'equal' });
  t.eq([eq.alloc.map((a) => a.frames), eq.spare], [[3, 3, 3], 1], 'equal: three each, one spare');
  t.eq(V.allocFrames({ frames: 62, procs: [{ name: 'A', size: 10 }, { name: 'B', size: 127 }], scheme: 'proportional' }).alloc.map((a) => a.frames), [5, 57], 'proportional: 4.53 and 57.47 round to 5 and 57');
  t.eq(V.allocFrames({ frames: 8, procs: [{ name: 'A', size: 10, priority: 1 }, { name: 'B', size: 10, priority: 3 }], scheme: 'priority' }).alloc.map((a) => a.frames), [2, 6], 'priority: weights 10 and 30');
  t.eq(V.allocFrames({ frames: 10, procs: [{ name: 'A', size: 1 }, { name: 'B', size: 100 }, { name: 'C', size: 100 }], scheme: 'proportional' }).alloc.map((a) => a.frames), [1, 5, 4], 'proportional: the minimum of one');
  const R = rng(3);
  let sums = true;
  for (let k = 0; k < 200; k++) {
    const n = 1 + Math.floor(R() * 5), F = n + Math.floor(R() * 50), procs = Array.from({ length: n }, (_, j) => ({ name: 'P' + j, size: 1 + Math.floor(R() * 100), priority: 1 + Math.floor(R() * 4) }));
    for (const scheme of ['proportional', 'priority']) {
      const a = V.allocFrames({ frames: F, procs, scheme }).alloc, b = V.allocFrames({ frames: F, procs, scheme, min: 0 }).alloc;
      if (a.reduce((s, x) => s + x.frames, 0) !== F || a.some((x) => x.frames < 1)) sums = false;
      if (b.reduce((s, x) => s + x.frames, 0) !== F || b.some((x) => Math.abs(x.frames - x.exact) >= 1)) sums = false;
    }
  }
  t.ok(sums, 'allocations always add up to the frames; with no minimum each is within one of its exact share');
}

// ---- global against local replacement ---------------------------------------------------------------------------------
function globalLRU(procs, F, q) {
  // an independent global LRU: one list of (proc, page), most recent last
  const list = [], faults = procs.map(() => 0), pos = procs.map(() => 0);
  while (pos.some((x, k) => x < procs[k].refs.length)) for (let k = 0; k < procs.length; k++) for (let j = 0; j < q && pos[k] < procs[k].refs.length; j++, pos[k]++) {
    const key = k + ':' + procs[k].refs[pos[k]], i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1); else { faults[k]++; if (list.length === F) list.shift(); }
    list.push(key);
  }
  return faults;
}
{
  const procs = [{ name: 'P', refs: [1, 2, 3, 1, 2, 3, 4, 1] }, { name: 'Q', refs: [7, 7, 7, 8, 7, 8, 7, 8] }];
  const g = V.globalLocal({ procs, frames: 4, mode: 'global' }), l = V.globalLocal({ procs, frames: 4, mode: 'local' });
  t.eq([g.faults, l.faults], [[7, 2], [8, 2]], 'global lets P borrow Q’s idle frames');
  t.ok(l.steps.every((s) => s.held[0] <= 2 && s.held[1] <= 2), 'local: nobody passes the quota');
  t.ok(g.steps.some((s) => s.victim && s.victim.proc !== s.proc), 'global: a fault takes another process’s frame');
  const R = rng(8);
  let good = true;
  for (let k = 0; k < 100; k++) {
    const ps = [0, 1, 2].map((j) => ({ name: 'P' + j, refs: Array.from({ length: 20 }, () => Math.floor(R() * 6)) })), F = 2 + Math.floor(R() * 8), q = 1 + Math.floor(R() * 3);
    if (JSON.stringify(V.globalLocal({ procs: ps, frames: F, mode: 'global', quantum: q }).faults) !== JSON.stringify(globalLRU(ps, F, q))) good = false;
    const lo = V.globalLocal({ procs: ps, frames: 9, mode: 'local', quota: [3, 3, 3], quantum: q });
    // local with a quota is three separate LRUs
    const sep = ps.map((p) => M.replace('lru', p.refs, 3).faults);
    if (JSON.stringify(lo.faults) !== JSON.stringify(sep)) good = false;
  }
  t.ok(good, 'global LRU agrees with one shared list; local with quotas is separate LRUs');
}

// ---- thrashing, the working set, PFF ------------------------------------------------------------------------------------
{
  const th = V.thrashing({ frames: 1000, wss: 100, lifetime: 20, disk: 10, maxN: 25 });
  const cpu = th.points.map((p) => p.cpu);
  t.ok(cpu[1] > cpu[0] && cpu[24] < cpu[th.best - 1] / 2, 'thrashing: utilisation rises, then collapses');
  t.ok(th.best <= 10, 'thrashing: the peak comes no later than frames / wss processes');
  t.ok(near(th.points[0].cpu, 20 / 30), 'one process: computes 20 ms, waits 10');
  const ws = V.workingSet([1, 2, 1, 3, 4, 1, 2, 5, 5, 5], 3);
  t.eq(ws.steps.map((s) => s.wss), [1, 2, 2, 3, 3, 3, 3, 3, 2, 1], 'working set sizes, Δ = 3');
  t.eq([ws.steps[4].ws, ws.steps[4].left, ws.steps[4].entered], [[1, 3, 4], [2], [4]], 'working set at t = 5');
  const R = rng(13);
  let good = true;
  for (let k = 0; k < 50; k++) {
    const refs = V.refgen({ kind: 'phases', length: 60, pages: 10, seed: k }), delta = 1 + Math.floor(R() * 10), w = V.workingSet(refs, delta);
    w.steps.forEach((s, i) => { const set = new Set(); for (let j = i; j >= 0 && j > i - delta; j--) set.add(refs[j]); if (set.size !== s.wss) good = false; });
  }
  t.ok(good, 'working sets agree with brute force');
  const pf = V.pff({ refs: V.refgen({ kind: 'phases', length: 200, pages: 16, seed: 5, setSize: 5 }), frames: 1, lower: 0.05, upper: 0.2, interval: 10, max: 8 });
  t.ok(pf.steps.filter((s) => s.kind === 'ref').every((s) => s.resident.length <= s.frames), 'pff: never more pages than frames');
  t.ok(pf.framesOver.every((f) => f >= 1 && f <= 8) && Math.max(...pf.framesOver) > 1, 'pff: frames grow within the bounds');
  const calm = V.pff({ refs: Array(60).fill(3), frames: 5, lower: 0.05, upper: 0.5, interval: 10 });
  t.eq(calm.framesOver[calm.framesOver.length - 1], 1, 'pff: a process that stops faulting gives frames back');
}

// ---- copy-on-write and zero-fill ---------------------------------------------------------------------------------------------
function refsOk(snap) {
  const count = new Map();
  for (const pages of Object.values(snap.procs)) for (const e of pages) if (e.frame !== null) count.set(e.frame, (count.get(e.frame) || 0) + 1);
  return snap.frames.every((f) => (count.get(f.id) || 0) === f.refs) && [...count.keys()].every((id) => snap.frames.some((f) => f.id === id));
}
{
  const C = V.cow();
  C.spawn(1, ['a', 'b', 'zero']);
  const f = C.fork(1, 2);
  t.ok(f.snapshot.procs[1].every((e) => e.state !== 'rw') && f.snapshot.frames.filter((x) => x.refs === 2).length === 2, 'fork: both mapped pages shared, copy-on-write');
  const w = C.write(2, 0, 'x');
  t.ok(w.kind === 'cow-copy' && w.snapshot.copies === 1, 'the child’s write copies the page');
  t.eq(C.write(1, 0, 'y').kind, 'cow-reuse', 'the parent is now the only user: no copy');
  t.eq(C.read(1, 2).kind, 'zero-map', 'a read of a demand-zero page maps the zero frame');
  t.eq(C.write(1, 2, 'z').kind, 'zero-fill', 'a write gets a fresh zeroed frame');
  t.eq([C.read(2, 0).value, C.read(1, 0).value, C.read(2, 1).value], ['x', 'y', 'b'], 'each sees its own data');
  const ex = C.exit(2);
  t.ok(refsOk(ex.snapshot) && ex.snapshot.frames.find((x) => x.id === 0).refs === 0, 'after exit, counts match the page tables');
  const R = rng(19);
  let good = true;
  for (let k = 0; k < 40; k++) {
    const C2 = V.cow(), alive = [1];
    C2.spawn(1, ['a', 'zero', 'b', 'zero']);
    let next = 2;
    for (let j = 0; j < 30; j++) {
      const pid = alive[Math.floor(R() * alive.length)], r = R();
      let st;
      if (r < 0.15 && alive.length < 5) { st = C2.fork(pid, next); alive.push(next++); }
      else if (r < 0.25 && alive.length > 1) { st = C2.exit(pid); alive.splice(alive.indexOf(pid), 1); }
      else if (r < 0.6) st = C2.read(pid, Math.floor(R() * 4));
      else st = C2.write(pid, Math.floor(R() * 4), 'v' + j);
      if (!refsOk(st.snapshot)) good = false;
    }
  }
  t.ok(good, 'copy-on-write: reference counts always equal the mappings');
}

// ---- mmap ------------------------------------------------------------------------------------------------------------
{
  const F = V.mmap({ file: ['A', 'B', 'C'] });
  F.map(1, 'shared'); F.map(2, 'shared'); F.map(3, 'private');
  t.eq(F.read(1, 0).value, 'A', 'mmap: a read brings the page in from the file');
  F.write(1, 1, 'b1');
  t.eq([F.read(2, 1).value, F.snapshot().file[1]], ['b1', 'B'], 'mmap: a shared write is seen by the other shared mapping, the file not yet updated');
  F.write(3, 2, 'c3');
  t.eq([F.read(3, 2).value, F.read(1, 2).value], ['c3', 'C'], 'mmap: a private write stays private');
  const ms = F.msync(1);
  t.eq([ms.pages, ms.snapshot.file, ms.snapshot.fileWrites], [[1], ['A', 'b1', 'C'], 1], 'mmap: msync writes the dirty page back');
  t.eq(F.unmap(3).snapshot.file, ['A', 'b1', 'C'], 'mmap: the private copy never reaches the file');
  F.write(2, 0, 'a2');
  t.eq(F.unmap(2).pages, [0], 'mmap: unmapping a shared mapping writes back its dirty page');
}

// ---- reference strings ------------------------------------------------------------------------------------------------
{
  for (const kind of ['random', 'loop', 'phases', 'walk']) {
    const a = V.refgen({ kind, length: 50, pages: 9, seed: 4, base: 1 });
    t.ok(a.length === 50 && a.every((p) => p >= 1 && p <= 9 && Number.isInteger(p)), kind + ': fifty pages in range');
    t.eq(V.refgen({ kind, length: 50, pages: 9, seed: 4, base: 1 }), a, kind + ': the same seed, the same string');
  }
  const lp = V.refgen({ kind: 'loop', length: 40, pages: 20, loop: 5, noise: 0, seed: 2 });
  t.ok(lp.every((p, i) => i < 5 || p === lp[i - 5]), 'loop: period five without noise');
  const ph = V.refgen({ kind: 'phases', length: 40, pages: 30, setSize: 3, stay: 1, phaseLen: 20, seed: 9 });
  t.ok(new Set(ph.slice(0, 20)).size <= 3 && new Set(ph.slice(20)).size <= 3, 'phases: each phase stays in three pages');
  const wr = V.refgen({ kind: 'random', length: 400, pages: 5, seed: 1, writeRatio: 0.25 }), share = wr.filter((r) => r.write).length / 400;
  t.ok(share > 0.18 && share < 0.32, 'writes at about the ratio asked');
  const tr = V.refsFromTrace([100, 200, { addr: 300, write: true }, 1100, 1200, 5], 1024);
  t.eq(tr.refs, [{ page: 0, write: true }, { page: 1, write: false }, { page: 0, write: false }], 'a trace to pages, runs merged');
  t.eq(V.refsFromTrace([1, 2], 1024, { collapse: false }).refs.length, 2, 'without merging');
  const c = V.traceC('int a[100];\nint main(void) {\n  int i;\n  for (i = 0; i < 100; i++) a[i] = i;\n  return 0;\n}\n', { pageBytes: 64 });
  t.ok(c.halted && !c.error && c.status === 0, 'the C adapter runs the program to the end');
  const stores = c.accesses.filter((x) => x.write && x.n === 4 && x.line === 4);
  const iAt = stores[0].addr, base = Math.min(...stores.filter((x) => x.addr !== iAt).map((x) => x.addr));
  const arr = stores.filter((x) => x.addr >= base && x.addr < base + 400);
  t.eq(arr.map((x) => x.addr - base), Array.from({ length: 100 }, (_, k) => 4 * k), 'the C adapter records the hundred stores into the array, in order');
  t.ok(c.accesses.every((x) => x.line > 0) && V.traceC('int main(void) { return 0; }', { runtime: true }).accesses.some((x) => !x.line), 'the C library’s start-up is left out unless asked for');
  // an array walk, eight ints over 16-byte pages: i's page and the array's two pages take turns
  const w = V.traceC('int a[8];\nint main(void) {\n  int i;\n  for (i = 0; i < 8; i++) a[i] = i;\n  return 0;\n}\n', { pageBytes: 16 });
  const sp = w.refs[0].page, ap = w.refs[1].page, want = [sp];
  for (let k = 0; k < 8; k++) want.push(ap + (k >> 2), sp);
  t.eq(w.refs.map((r) => r.page), want, 'array walk: the expected reference string (i, a[0..3]’s page, i, …, a[4..7]’s page, i)');
  t.ok(w.refs.every((r) => r.write) && ap * 16 === Math.min(...w.accesses.filter((x) => x.addr !== w.accesses[0].addr).map((x) => x.addr)), 'every run writes, and the array starts its page');
}

// ---- narration: every sentence the engines say, over seeded inputs, checked for slips ----------------------------------
{
  const says = [];
  const grab = (x, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (typeof x.say === 'string') says.push(x.say);
    for (const k of Object.keys(x)) if (typeof x[k] === 'object') grab(x[k], seen);
  };
  const keep = (x) => { grab(x, new Set()); return x; };
  const R = rng(77);
  for (let seed = 1; seed <= 6; seed++) {
    const refs = V.refgen({ kind: ['random', 'loop', 'phases', 'walk'][seed % 4], length: 30, pages: 7, seed, writeRatio: 0.3 });
    for (const p of M.policies) for (const n of [1, 2, 3, 4]) keep(M.replace(p, refs, n, { bits: 4 }));
    keep(V.demand({ refs, frames: 3, policy: 'eclock', anon: [0, 2, 4] }));
    keep(V.workingSet(refs.map((r) => r.page), 1 + seed));
    keep(V.pff({ refs: refs.map((r) => r.page), frames: 2, lower: 0.1, upper: 0.4, interval: 5 }));
    keep(M.tlbRun({ entries: 4, ways: [1, 2, 4][seed % 3], refs: refs.map((r) => r.page), pwc: 2 }));
    keep(M.switchRun({ entries: 4, procs: [{ asid: 1, refs: [1, 2, 3] }, { asid: 2, refs: [1, 4] }], quantum: 1 + (seed % 2), mode: seed % 2 ? 'flush' : 'asid' }));
    keep(V.globalLocal({ procs: [{ name: 'P', refs: refs.map((r) => r.page) }, { name: 'Q', refs: [1, 1, 2] }], frames: 3, mode: seed % 2 ? 'global' : 'local' }));
    for (const pol of ['first', 'best', 'worst', 'next']) {
      const A = M.contig({ memory: 500, policy: pol, compact: seed % 2 ? 'on-fail' : 'never' }), live = [];
      for (let k = 0; k < 30; k++) { if (live.length && R() < 0.4) keep(A.free(live.splice(Math.floor(R() * live.length), 1)[0])); else { const id = 'p' + k, st = keep(A.alloc(id, 1 + Math.floor(R() * 120))); if (st.kind === 'alloc') live.push(id); } }
      keep(A.compact());
    }
    for (const pol of ['first', 'next', 'best', 'segregated']) {
      const H = M.malloc({ heap: 256, policy: pol }), live = [];
      for (let k = 0; k < 30; k++) { if (live.length && R() < 0.4) keep(H.free(live.splice(Math.floor(R() * live.length), 1)[0])); else { const st = keep(H.malloc('m' + k, 1 + Math.floor(R() * 60))); if (st.kind === 'malloc') live.push('m' + k); } }
    }
    const B = M.buddy({ size: 1024, minBlock: 32 }), bl = [];
    for (let k = 0; k < 20; k++) { if (bl.length && R() < 0.4) keep(B.free(bl.splice(Math.floor(R() * bl.length), 1)[0])); else { const st = keep(B.alloc('b' + k, 1 + Math.floor(R() * 300))); if (st.kind === 'alloc') bl.push('b' + k); } }
    const SL = M.slab({ caches: [{ name: 'x', objSize: 1500 }] }), sl = [];
    for (let k = 0; k < 12; k++) { if (sl.length && R() < 0.4) keep(SL.free(sl.splice(0, 1)[0])); else { keep(SL.alloc('x', 's' + k)); sl.push('s' + k); } }
    keep(SL.shrink());
    const C = V.cow();
    keep(C.spawn(1, seed % 2 ? ['a'] : ['a', 'zero', 'b']));
    keep(C.fork(1, 2)); keep(C.read(2, 0)); keep(C.write(2, 0, 'q')); keep(C.write(1, 0, 'r')); keep(C.exit(2));
    const F = V.mmap({ file: ['A', 'B', 'C'] });
    keep(F.map(1, 'shared')); keep(F.map(2, 'private')); keep(F.write(1, 0, 'x'));
    if (seed % 2) keep(F.write(1, 2, 'z'));
    keep(F.write(2, 1, 'y')); keep(F.msync(1)); keep(F.unmap(2)); keep(F.unmap(1));
    keep(M.findBelady({ seed, tries: 3000 }));
  }
  const tb = { offBits: 12, segs: [{ name: 'code', base: 0, limit: 100, grow: 'up', prot: 'rx' }, { name: 'stack', base: 900, limit: 50, grow: 'down', prot: 'rw' }], paging: null };
  for (const acc of ['r', 'w', 'x']) for (const [seg, off] of [[0, 5], [0, 200], [1, 4090], [1, 10], [5, 0]]) keep(M.segTranslate(tb, { seg, offset: off, access: acc }));
  keep(M.segTranslate(Object.assign({}, tb, { paging: { pageBytes: 64, tables: [[1, null], [2]] } }), { seg: 0, offset: 70, access: 'r' }));
  for (const v of [true, false]) keep(V.faultPath({ page: 2, write: v, legal: v, victim: { page: 1, frame: 0, dirty: v } }));
  keep(V.faultPath({ page: 2, freeFrame: 1, source: 'zero' }));
  keep(V.eat({ mem: 0.1, fault: 8000, p: 0.001 }));
  for (const levels of [2, 3, 4]) keep(M.eatWalk({ hit: 0.9, tlbNs: 1, memNs: 200, levels, pwcHit: 0.8 }));
  keep(V.thrashing({})); keep(M.internalFrag([1, 5000], 4096)); keep(M.pageSizeTradeoff({ vaBits: 32, sizes: [100, 9000], pageSizes: [4096, 65536] }));
  for (const sch of ['equal', 'proportional', 'priority']) keep(V.allocFrames({ frames: 9, procs: [{ name: 'A', size: 1, priority: 2 }, { name: 'B', size: 5 }], scheme: sch }));
  for (const [v, l] of [[5, 10], [12, 10]]) keep(M.baseBounds({ base: 100, limit: l }, v));
  const T = M.ipt({ frames: 4, anchors: 2 }); [[1, 1], [2, 1], [1, 3]].forEach(([p, v], f) => keep({ say: '', x: T.place(f, p, v) })); for (const q of [[1, 1], [2, 2], [1, 3]]) keep(T.lookup(q[0], q[1], 4));
  const Hh = M.hpt({ buckets: 2 }); for (const v of [1, 3, 4]) keep(Hh.insert(v, v)); for (const v of [1, 3, 5]) keep(Hh.lookup(v, 2));
  for (const id of ['x86-64', 'sv39', 'x86-32']) { const cfg = M.preset(id), pt = M.build(cfg, [[3, 7], { vpn: cfg.large[cfg.large.length - 1].bytes / cfg.pageBytes, pfn: cfg.large[cfg.large.length - 1].bytes / cfg.pageBytes, level: cfg.large[cfg.large.length - 1].level }]); for (const va of [0x3010, cfg.large[cfg.large.length - 1].bytes + 5, 0x9000]) keep(M.translate(pt, va)); }

  const bad = [];
  const rules = [
    [/\b[Aa] (?:[aeioAEIO]|8\b|11\b|18\b)/, 'a before a vowel sound'],
    [/\b[Aa]n (?![aeiouAEIOU8]|11\b|18\b)[^\s]/, 'an before a consonant'],
    [/\b([A-Za-z]+) \1\b/, 'a doubled word'],
    // a number that names something (page 1, frame 3) is not a count: skip those
    [/(?<!(?:[Pp]age|[Ff]rame|[Rr]eference|[Pp]rocess|[Ee]ntry|set|way|[Bb]ucket|[Aa]nchor|[Ll]evel|pid|class|scan|[Ss]lab|object|[Ss]egment|space|[Rr]egion) )(?:^|(?<=[^\d.,]))1 (?:pages|frames|bytes|entries|times|faults|references|processes|accesses|blocks|slabs|holes|objects|reads|copies|tries|ticks|write-backs|tables|ways|sets|bits|levels)\b/, 'one with a plural'],
    [/(?<!(?:[Pp]age|[Ff]rame|[Rr]eference|[Pp]rocess|[Ee]ntry|set|way|[Bb]ucket|[Aa]nchor|[Ll]evel|pid|class|scan|[Ss]lab|object|[Ss]egment|space|[Rr]egion) )(?:^|(?<=[^\d.,]))(?:0|[2-9]|\d{2,}) (?:page|frame|byte|entry|time|fault|reference|access|block|slab|hole|object|read|copy|try|write-back)(?![\w-])/, 'many with a singular'],
    [/\bpage [\w]+ are\b|\bpages [\d, and]+ is\b/, 'is and are'],
    [/undefined|NaN|\[object|null\b/, 'a value missing'],
  ];
  for (const sy of new Set(says)) for (const [re, what] of rules) if (re.test(sy)) bad.push(what + ': ' + sy);
  t.ok(says.length > 2000, 'the narration scan saw ' + says.length + ' sentences');
  t.eq(bad.slice(0, 8), [], 'no slips in the narration');
}
t.done();
