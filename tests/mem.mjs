// The memory engines: page-table walks worked by hand (a two-level 32-bit table, a four-level 9-9-9-9-12 table,
// Sv39), the automatic bit split, table memory, the inverted table against a plain search, the TLB, and every
// replacement policy against an independent version written here, on hand-worked and random reference strings.
// Belady's anomaly is found for FIFO on a string of our own.
import { load, harness, rng } from './load.mjs';

const t = harness('mem');
const S = load(['core', 'stage', 'demo']);
const M = S.Mem;

// ---- the bit split ----------------------------------------------------------------------------------------------
t.eq(M.config({ vaBits: 32, pageBytes: 4096, levels: 2, pteBytes: 4 }).bits, [10, 10], '32-bit, two levels, 4-byte entries: 10-10');
t.eq(M.config({ vaBits: 48, pageBytes: 4096, levels: 4, pteBytes: 8 }).bits, [9, 9, 9, 9], '48-bit, four levels: 9-9-9-9');
t.eq(M.config({ vaBits: 39, pageBytes: 4096, levels: 3, pteBytes: 8 }).bits, [9, 9, 9], 'Sv39: 9-9-9');
t.eq(M.config({ vaBits: 57, pageBytes: 4096, levels: 5, pteBytes: 8 }).bits, [9, 9, 9, 9, 9], '57-bit, five levels');
t.eq(M.config({ vaBits: 32, pageBytes: 4096, levels: 3, pteBytes: 4 }).bits, [8, 6, 6], 'when full tables do not fit, an even split with the rest at the root');
t.eq(M.config({ vaBits: 36, pageBytes: 4096, levels: 2, pteBytes: 8 }).bits, [15, 9], 'the root takes what is left');
t.eq(M.config({ vaBits: 48, pageBytes: 65536, levels: 3, pteBytes: 8 }).bits, [6, 13, 13], '64 KiB pages: 8192 entries a table');
t.eq(M.config({ bits: [7, 8, 9], pageBytes: 4096 }).vaBits, 36, 'the width follows the fields given');
t.eq(M.config({ bits: [9, 9, 9, 9], pageBytes: 4096 }).lo, [39, 30, 21, 12], 'the lowest bit of each field');
let threw = false;
try { M.config({ vaBits: 40, bits: [9, 9], pageBytes: 4096 }); } catch (e) { threw = true; }
t.ok(threw, 'fields that do not add up are refused');

const reads = (r) => r.steps.filter((s) => s.kind === 'read');

// ---- two-level, 32-bit: 10-10-12 with 4-byte entries ------------------------------------------------------------
{
  const cfg = M.config({ vaBits: 32, pageBytes: 4096, levels: 2, pteBytes: 4, paBits: 32 });
  const pt = M.build(cfg, [[0x0804a, 0x2b7]], { tableFrame: 0x100 });
  const r = M.translate(pt, 0x0804a1c4);
  t.eq(r.fields.map((f) => f.value), [32, 74, 0x1c4], '32-bit: L1 32, L2 74, offset 0x1c4');
  t.eq(reads(r).map((s) => [Number(s.base), Number(s.entryAddr)]), [[0x100000, 0x100080], [0x101000, 0x101128]], '32-bit: table bases and entry addresses');
  t.eq(Number(r.pa), 0x2b71c4, '32-bit: physical address');
  t.eq(r.accesses, 3, '32-bit: two table reads and the data');
  t.eq(M.usage(pt).bytes, 8192, '32-bit: two 4 KiB tables');
  t.eq(M.usage(pt).flatBytes, 4 << 20, '32-bit: a flat table is 4 MiB');
  const miss = M.translate(pt, 0x0804b000);
  t.ok(!miss.ok && miss.fault.level === 1 && miss.accesses === 2, '32-bit: the next page faults at level 2');
  const miss1 = M.translate(pt, 0x40000000);
  t.ok(!miss1.ok && miss1.fault.level === 0 && miss1.accesses === 1, '32-bit: another 4 MiB region faults at the root');
}

// ---- x86-64 style, four levels 9-9-9-9-12 ------------------------------------------------------------------------
{
  const cfg = M.config({ vaBits: 48, pageBytes: 4096, levels: 4, pteBytes: 8, paBits: 40 });
  // the page walked, its neighbour (same last table) and a page under another root entry
  const pt = M.build(cfg, [[0x7f3a8c45dn, 0x5a3c1n], [0x7f3a8c45en, 0x5a3c2n], [0x400n, 0x1234n]], { tableFrame: 0x100 });
  const r = M.translate(pt, 0x7f3a8c45d2e8n);
  t.eq(r.fields.map((f) => f.value), [254, 234, 98, 93, 744], '4-level: indexes 254, 234, 98, 93 and offset 744');
  t.eq(reads(r).map((s) => Number(s.entryAddr)), [0x1007f0, 0x101750, 0x102310, 0x1032e8], '4-level: entry addresses');
  t.eq(reads(r).map((s) => Number(s.next)), [0x101, 0x102, 0x103, 0x5a3c1], '4-level: each entry names the next frame');
  t.eq(r.pa, 0x5a3c12e8n, '4-level: physical address');
  t.eq(r.accesses, 5, '4-level: four reads and the data');
  t.eq(M.usage(pt).perLevel, [1, 2, 2, 2], '4-level: one root, two tables at each level below');
  t.eq(M.usage(pt).bytes, 7 * 4096, '4-level: seven 4 KiB tables');
  t.eq(M.translate(pt, 0x7f3a8c45e010n).pa, 0x5a3c2010n, '4-level: the neighbour shares the walk');
  t.eq(M.hex(r.pa, 40), '0x00_5a3c_12e8', 'hex grouping');
}

// ---- Sv39: 9-9-9-12 -----------------------------------------------------------------------------------------------
{
  const cfg = M.config({ vaBits: 39, pageBytes: 4096, levels: 3, pteBytes: 8, paBits: 56 });
  const pt = M.build(cfg, [[0x1234567n, 0x80123n]], { tableFrame: 0x100 });
  const r = M.translate(pt, 0x1234567abcn);
  t.eq(r.fields.map((f) => f.value), [72, 418, 359, 0xabc], 'Sv39: VPN[2] 72, VPN[1] 418, VPN[0] 359');
  t.eq(reads(r).map((s) => Number(s.entryAddr)), [0x100240, 0x101d10, 0x102b38], 'Sv39: entry addresses');
  t.eq(r.pa, 0x80123abcn, 'Sv39: physical address');
  t.eq(r.accesses, 4, 'Sv39: three reads and the data');
}

// ---- walks against a plain map, on random sparse spaces of random shapes ------------------------------------------
{
  const R = rng(11);
  for (let trial = 0; trial < 60; trial++) {
    const levels = 2 + Math.floor(R() * 4), pageBytes = [4096, 16384, 65536][Math.floor(R() * 3)], pteBytes = [4, 8][Math.floor(R() * 2)];
    const bits = Array.from({ length: levels }, () => 3 + Math.floor(R() * 7));
    const cfg = M.config({ bits, pageBytes, pteBytes });
    const map = new Map();
    while (map.size < 12) map.set(BigInt(Math.floor(R() * 2 ** Math.min(40, cfg.vpnBits))), BigInt(map.size + 0x500));
    const pt = M.build(cfg, [...map]);
    let good = true;
    // count the tables a set of pages needs, by their prefixes
    const prefixes = new Set();
    for (const v of map.keys()) { let p = ''; prefixes.add('root'); for (let i = 0; i < levels - 1; i++) { p += ',' + Number((v >> BigInt(cfg.lo[i] - cfg.offBits)) & BigInt(2 ** bits[i] - 1)); prefixes.add(p); } }
    if (M.usage(pt).tables !== prefixes.size) good = false;
    for (const [v, f] of map) {
      const off = BigInt(Math.floor(R() * pageBytes)), r = M.translate(pt, (v << BigInt(cfg.offBits)) | off);
      if (!r.ok || r.pa !== ((f << BigInt(cfg.offBits)) | off) || r.accesses !== levels + 1) good = false;
    }
    for (let k = 0; k < 10; k++) {
      const v = BigInt(Math.floor(R() * 2 ** Math.min(40, cfg.vpnBits)));
      const r = M.translate(pt, v << BigInt(cfg.offBits));
      if (r.ok !== map.has(v)) good = false;
    }
    t.ok(good, 'random walk ' + trial + ' (' + bits.join('-') + '-' + cfg.offBits + ')');
  }
}

// ---- the inverted page table ------------------------------------------------------------------------------------------
{
  const T = M.ipt({ frames: 8, anchors: 4, pageBytes: 4096 });
  // (vpn + 7·pid) mod 4, worked by hand: (5+21)=26→2, (2+35)=37→1, (9+21)=30→2, (4+56)=60→0, (13+35)=48→0, (1+21)=22→2
  t.eq([[0, 3, 5], [1, 5, 2], [2, 3, 9], [3, 8, 4], [4, 5, 13], [5, 3, 1]].map(([f, p, v]) => T.place(f, p, v)), [2, 1, 2, 0, 0, 2], 'inverted: hash slots');
  t.eq(T.chain(2), [5, 2, 0], 'inverted: the chain of slot 2, newest first');
  const a = T.lookup(3, 5, 0x10);
  t.ok(a.ok && a.frame === 0 && a.pa === 0x10 && a.accesses === 5, 'inverted: (3, 5) is in frame 0 after three compares');
  const b = T.lookup(5, 2, 0);
  t.ok(b.ok && b.frame === 1 && b.accesses === 3, 'inverted: (5, 2) at the head of its chain');
  const c = T.lookup(8, 6, 0);
  t.ok(!c.ok && c.slot === 2 && c.chain.length === 3, 'inverted: (8, 6) walks the whole chain and faults');
  t.ok(!T.lookup(3, 4, 0).ok && T.lookup(8, 4, 0).ok, 'inverted: the pid is part of the key');
  t.eq(T.size().total, 8 * 8 + 4 * 4, 'inverted: size of the table and the anchors');
  t.eq(M.forwardBytes({ vaBits: 32, pageBytes: 4096, pteBytes: 4, procs: 3 }), 3 * 4 * 2 ** 20, 'forward: three flat 4 MiB tables');
  // random tables: a hashed lookup finds what a plain search of every entry finds
  const R = rng(5);
  let good = true;
  for (let trial = 0; trial < 40; trial++) {
    const frames = 4 + Math.floor(R() * 28), anchors = 1 + Math.floor(R() * 16), T2 = M.ipt({ frames, anchors });
    const pids = [3, 5, 8, 13];
    for (let f = 0; f < frames; f++) {
      if (R() < 0.15) continue;
      let p, v;
      do { p = pids[Math.floor(R() * 4)]; v = Math.floor(R() * 40); } while (T2.entries.some((e) => e && e.pid === p && e.vpn === v));
      T2.place(f, p, v);
    }
    for (let k = 0; k < 30; k++) {
      const p = pids[Math.floor(R() * 4)], v = Math.floor(R() * 40);
      const plain = T2.entries.findIndex((e) => e && e.pid === p && e.vpn === v), r = T2.lookup(p, v, 0);
      if (r.frame !== plain) good = false;
      if (r.ok && r.accesses !== r.chain.length + 2) good = false;
    }
  }
  t.ok(good, 'inverted: hashed lookups agree with a plain search');
}

// ---- the TLB ------------------------------------------------------------------------------------------------------------
{
  const T = M.tlb({ entries: 4, ways: 2 });
  T.insert(0, 10); T.insert(2, 12);
  t.ok(T.lookup(0).hit && !T.lookup(1).hit, 'tlb: hit and miss');
  const v = T.insert(4, 14);
  t.eq(v.set, 0, 'tlb: page 4 maps to set 0 of 2');
  t.eq(Number(v.victim.vpn), 2, 'tlb: the least recently used way goes (page 0 was just used)');
  t.ok(!T.lookup(2).hit && T.lookup(4).hit && T.lookup(0).hit, 'tlb: after the eviction');
  T.insert(7, 3, 1);
  t.ok(T.lookup(7, 1).hit && !T.lookup(7, 2).hit, 'tlb: an entry belongs to its address space');
  T.flush(1);
  t.ok(!T.lookup(7, 1).hit && T.lookup(0).hit, 'tlb: flushing one address space');
  t.eq(M.eat({ hit: 0.9, tlbNs: 1, memNs: 100, levels: 4 }), 0.9 * 101 + 0.1 * 501, 'effective access time');
  // against a plain list kept in recency order, per set
  const R = rng(9);
  let good = true;
  for (let trial = 0; trial < 20; trial++) {
    const ways = [1, 2, 4][trial % 3], nSets = [1, 2, 4][Math.floor(R() * 3)], T3 = M.tlb({ entries: ways * nSets, ways });
    const sets = Array.from({ length: nSets }, () => []);
    for (let k = 0; k < 200; k++) {
      const vpn = Math.floor(R() * 12), s = sets[vpn % nSets], i = s.indexOf(vpn), r = T3.lookup(vpn);
      if (r.hit !== i >= 0) good = false;
      if (i >= 0) { s.splice(i, 1); s.push(vpn); } else { if (s.length === ways) s.shift(); s.push(vpn); T3.insert(vpn, vpn + 100); }
    }
  }
  t.ok(good, 'tlb: agrees with a recency list per set');
}

// ---- page replacement, worked by hand --------------------------------------------------------------------------------
{
  const refs = [4, 2, 4, 6, 2, 5, 4, 6, 1, 5];
  const want = {
    fifo: { faults: 6, end: [5, 4, 1] },
    lru: { faults: 8, end: [1, 6, 5] },
    opt: { faults: 5, end: [1, 5, 6] },
    clock: { faults: 6, end: [5, 4, 1] },
  };
  for (const p of ['fifo', 'opt', 'lru', 'clock']) {
    const r = M.replace(p, refs, 3);
    t.eq(r.faults, want[p].faults, p + ': faults on the hand-worked string');
    t.eq(r.steps[r.steps.length - 1].frames, want[p].end, p + ': frames at the end');
  }
  const lru = M.replace('lru', refs, 3);
  t.eq(lru.steps.filter((s) => s.victim !== null).map((s) => s.victim), [4, 6, 2, 5, 4], 'lru: the victims in order');
  const clock = M.replace('clock', refs, 3);
  t.eq(clock.steps[5].cleared, [0, 1, 2], 'clock: the hand clears all three bits before taking frame 0');
  t.eq([clock.steps[5].victim, clock.steps[5].use, clock.steps[5].hand], [4, [1, 0, 0], 1], 'clock: page 4 goes, the hand moves on');
  t.eq(clock.steps[8].cleared, [2, 0, 1], 'clock: reference 9 sweeps from frame 2');
  t.eq(M.replace('opt', refs, 3).steps[8].reason, 'never used again', 'opt: the reason names the future');
}

// ---- page replacement against independent versions ---------------------------------------------------------------------
// Each keeps its own state in its own way; they must agree on hits, faults and the pages resident at every step,
// and on the frame each page sits in.
function fifoRef(refs, n) {
  const slots = Array(n).fill(null), queue = [], out = [];
  for (const p of refs) {
    if (slots.includes(p)) { out.push({ hit: true, frames: slots.slice() }); continue; }
    let s = slots.indexOf(null);
    if (s < 0) { const old = queue.shift(); s = slots.indexOf(old); }
    slots[s] = p; queue.push(p); out.push({ hit: false, frames: slots.slice() });
  }
  return out;
}
function lruRef(refs, n) {
  const slots = Array(n).fill(null), stack = [], out = []; // stack: most recent last
  for (const p of refs) {
    const k = stack.indexOf(p);
    if (k >= 0) { stack.splice(k, 1); stack.push(p); out.push({ hit: true, frames: slots.slice() }); continue; }
    let s = slots.indexOf(null);
    if (s < 0) { const old = stack.shift(); s = slots.indexOf(old); }
    slots[s] = p; stack.push(p); out.push({ hit: false, frames: slots.slice() });
  }
  return out;
}
function optRef(refs, n) {
  const slots = Array(n).fill(null), out = [];
  refs.forEach((p, i) => {
    if (slots.includes(p)) { out.push({ hit: true, frames: slots.slice() }); return; }
    let s = slots.indexOf(null);
    if (s < 0) {
      let best = -1, far = -1;
      slots.forEach((q, k) => { let d = refs.slice(i + 1).indexOf(q); d = d < 0 ? 1e9 : d; if (d > far) { far = d; best = k; } });
      s = best;
    }
    slots[s] = p; out.push({ hit: false, frames: slots.slice() });
  });
  return out;
}
function clockRef(refs, n) {
  const ring = Array.from({ length: n }, () => ({ page: null, ref: false })), out = [];
  let h = 0;
  for (const p of refs) {
    const e = ring.find((x) => x.page === p);
    if (e) { e.ref = true; out.push({ hit: true, frames: ring.map((x) => x.page), hand: h, use: ring.map((x) => +x.ref) }); continue; }
    while (ring[h].page !== null && ring[h].ref) { ring[h].ref = false; h = (h + 1) % n; }
    ring[h] = { page: p, ref: true }; h = (h + 1) % n;
    out.push({ hit: false, frames: ring.map((x) => x.page), hand: h, use: ring.map((x) => +x.ref) });
  }
  return out;
}
{
  const REF = { fifo: fifoRef, lru: lruRef, opt: optRef, clock: clockRef };
  const R = rng(3);
  for (const p of ['fifo', 'opt', 'lru', 'clock']) {
    let good = true;
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(R() * 6), pages = 2 + Math.floor(R() * 8), len = 5 + Math.floor(R() * 40);
      const refs = Array.from({ length: len }, () => Math.floor(R() * pages));
      const a = M.replace(p, refs, n), b = REF[p](refs, n);
      a.steps.forEach((s, i) => {
        if (s.hit !== b[i].hit || JSON.stringify(s.frames) !== JSON.stringify(b[i].frames)) good = false;
        if (p === 'clock' && (s.hand !== b[i].hand || JSON.stringify(s.use) !== JSON.stringify(b[i].use))) good = false;
      });
      if (a.faults !== b.filter((x) => !x.hit).length) good = false;
    }
    t.ok(good, p + ': agrees with an independent version on 300 random strings');
  }
  // OPT is never beaten, and LRU (a stack algorithm) never does worse with more frames
  let optBest = true, lruStack = true;
  for (let trial = 0; trial < 200; trial++) {
    const refs = Array.from({ length: 30 }, () => Math.floor(R() * 7));
    for (let n = 1; n <= 5; n++) {
      const o = M.replace('opt', refs, n).faults;
      for (const q of ['fifo', 'lru', 'clock']) if (M.replace(q, refs, n).faults < o) optBest = false;
      if (n > 1 && M.replace('lru', refs, n).faults > M.replace('lru', refs, n - 1).faults) lruStack = false;
    }
  }
  t.ok(optBest, 'opt: no policy faults less');
  t.ok(lruStack, 'lru: more frames never fault more');
}

// ---- Belady's anomaly, on a string of our own -------------------------------------------------------------------------
{
  const refs = [6, 4, 3, 5, 6, 4, 1, 6, 2, 4, 3, 1, 6];
  const curve = M.faultCurve('fifo', refs, 1, 6).map((c) => c.faults);
  t.eq(curve.slice(2, 4), [10, 11], 'belady: FIFO faults 10 times with 3 frames and 11 with 4');
  t.ok(M.replace('lru', refs, 4).faults <= M.replace('lru', refs, 3).faults, 'belady: LRU does not show it');
  t.eq(JSON.stringify(fifoRef(refs, 4).filter((x) => !x.hit).length), '11', 'belady: the independent FIFO agrees');
}

// ---- large pages and presets ----------------------------------------------------------------------------------------
{
  const cfg = M.preset('x86-64');
  t.eq(cfg.large.map((l) => l.bytes), [2 ** 30, 2 ** 21], 'x86-64: 1 GiB and 2 MiB leaves');
  t.eq([M.preset('x86-64-5').bits.length, M.preset('sv48').vaBits, M.preset('x86-32').bits], [5, 48, [10, 10]], 'presets');
  const pt = M.build(cfg, [{ vpn: 0x200, pfn: 0x400, level: 2 }, { vpn: 0x40000, pfn: 0x80000, level: 1 }, [0x7, 0x99]], { tableFrame: 0x100 });
  const a = M.translate(pt, 0x200000 + 0x12345);
  t.ok(a.ok && a.pa === BigInt(0x400000 + 0x12345) && a.accesses === 4 && a.large && a.pageBytes === 2 ** 21, '2 MiB page: three reads, 21 offset bits');
  const b = M.translate(pt, 0x40000000 + 0x2345678);
  t.ok(b.ok && b.pa === BigInt(0x80000000 + 0x2345678) && b.accesses === 3 && b.pageBytes === 2 ** 30, '1 GiB page: two reads');
  t.eq(M.translate(pt, 0x7123).pa, 0x99123n, 'a 4 KiB page beside them');
  let bad = 0;
  for (const m of [{ vpn: 0x201, pfn: 0x400, level: 2 }, { vpn: 0x200, pfn: 0x401, level: 2 }]) { try { M.build(cfg, [m]); } catch (e) { bad++; } }
  try { M.build(cfg, [{ vpn: 0x200, pfn: 0x400, level: 2 }, [0x201, 5]]); } catch (e) { bad++; }
  t.eq(bad, 3, 'misaligned large pages and pages inside one are refused');
  const sv = M.build(M.preset('sv39'), [{ vpn: 0, pfn: 0x40000, level: 0 }]);
  t.eq([M.translate(sv, 0x1234567).accesses, M.translate(sv, 0x1234567).pa], [2, 0x41234567n], 'Sv39 gigapage: one read');
}

// ---- the hashed page table ---------------------------------------------------------------------------------------------
{
  const T = M.hpt({ buckets: 4, pageBytes: 4096 });
  t.eq([5, 9, 13, 2].map((v, i) => T.insert(v, 10 + i).bucket), [1, 1, 1, 2], 'hashed: buckets by vpn mod 4');
  t.eq(T.chain(1).map((k) => T.nodes[k].vpn), [13, 9, 5], 'hashed: newest first');
  const r = T.lookup(5, 0x10);
  t.ok(r.ok && r.pfn === 10 && r.pa === 10 * 4096 + 0x10 && r.accesses === 5, 'hashed: three compares down the chain');
  const f = T.lookup(6);
  t.ok(!f.ok && f.accesses === 2, 'hashed: a miss after one compare');
  t.ok(T.remove(9) && T.chain(1).length === 2 && !T.lookup(9).ok && T.lookup(5).ok, 'hashed: removing from the middle of a chain');
  t.eq(T.size().total, 3 * 16 + 4 * 8, 'hashed: size');
  const R = rng(21);
  let good = true;
  for (let trial = 0; trial < 30; trial++) {
    const H = M.hpt({ buckets: 1 + Math.floor(R() * 12) }), map = new Map();
    for (let k = 0; k < 40; k++) { const v = Math.floor(R() * 100); if (R() < 0.3 && map.has(v)) { H.remove(v); map.delete(v); } else if (!map.has(v)) { H.insert(v, k); map.set(v, k); } }
    for (let v = 0; v < 100; v++) { const r2 = H.lookup(v); if (r2.ok !== map.has(v) || (r2.ok && r2.pfn !== map.get(v))) good = false; }
    if (H.lengths().reduce((a, b) => a + b, 0) !== map.size) good = false;
  }
  t.ok(good, 'hashed: agrees with a map under inserts and removes');
}

// ---- TLB: walks, reach, measured hit ratios, context switches ------------------------------------------------------------
{
  const e = M.eatWalk({ hit: 0.98, tlbNs: 1, memNs: 100, levels: 4, pwcHit: 0.5 });
  t.ok(e.hitNs === 101 && e.missNs === 351 && Math.abs(e.ns - 106) < 1e-9, 'EAT with a walk cache: 0.98 × 101 + 0.02 × 351 = 106');
  t.eq(M.eatWalk({ hit: 0.9, tlbNs: 1, memNs: 100, levels: 4 }).ns, M.eat({ hit: 0.9, tlbNs: 1, memNs: 100, levels: 4 }), 'no walk cache: the plain formula');
  t.eq(M.tlbReach(64, 4096), 262144, 'reach: 64 entries of 4 KiB = 256 KiB');
  // the walk cache saves (levels − 1) reads on the share p of misses it hits: 0.5 × 3 × 100 = 150 ns a miss
  t.eq(M.eatWalk({ hit: 0.98, tlbNs: 1, memNs: 100, levels: 4 }).missNs - e.missNs, 150, 'walk cache: 501 − 351 = 150 ns saved on an average miss');
  t.ok(/saving 150 ns on an average miss/.test(e.say), 'walk cache: the sentence names p(L − 1)m = 150 ns: ' + e.say);
  const ts = M.tlbRun({ entries: 2, refs: [1, 2, 1, 3], levels: 2, memNs: 100, tlbNs: 0 }).steps;
  t.eq(ts.map((s) => [s.hit, s.filled, s.set, s.way]), [[false, true, 0, 0], [false, true, 0, 1], [true, false, 0, 0], [false, true, 0, 1]], 'tlbRun: the way an entry was found in or put into');
  t.eq(ts[3].tlb, [[{ vpn: 1, asid: 0, pfn: 1, age: 1 }, { vpn: 3, asid: 0, pfn: 3, age: 0 }]], 'tlbRun: contents after page 3 replaces page 2 in way 1');
  t.eq(ts[2].tlb[0].map((x) => x.age), [0, 1], 'tlbRun: page 1 just hit is the most recent');
  const sw = M.switchRun({ entries: 4, ways: 2, procs: [{ asid: 1, refs: [0, 1] }, { asid: 2, refs: [0] }], quantum: 2, mode: 'asid' }).steps;
  t.eq([sw[2].kind, sw[2].tlb.flat().length, sw[3].way, sw[3].set, sw[3].tlb[0].map((x) => x.asid)], ['switch', 2, 1, 0, [1, 2]], 'switchRun: contents at the switch, and process 2’s page 0 beside process 1’s');
  const r = M.tlbRun({ entries: 2, refs: [1, 2, 1, 3, 2], levels: 2, tlbNs: 0, memNs: 100 });
  t.eq(r.steps.map((s) => s.hit), [false, false, true, false, false], 'tlbRun: page 3 evicts 2, the least recently used');
  t.eq([r.hits, r.eat, r.steps[3].victim], [1, 260, 2], 'tlbRun: measured hit ratio and EAT');
  t.ok(Math.abs(r.eatFormula - r.eat) < 1e-9, 'tlbRun: the formula with the measured ratio gives the measured EAT');
  const p = M.tlbRun({ entries: 8, refs: [0, 1, 600], levels: 4, pwc: 4, memNs: 100, tlbNs: 0 });
  t.eq(p.steps.map((s) => s.reads), [4, 1, 4], 'walk cache: page 1 shares page 0’s last table; page 600 does not');
  const procs = [{ asid: 1, refs: [1, 2, 1, 2] }, { asid: 2, refs: [1, 2, 1, 2] }];
  const as = M.switchRun({ entries: 8, procs, quantum: 2, mode: 'asid' }), fl = M.switchRun({ entries: 8, procs, quantum: 2, mode: 'flush' });
  t.eq([as.hits, fl.hits], [4, 0], 'ASIDs keep entries across switches; flushing loses them all');
  t.eq(as.steps.filter((s) => s.kind === 'switch').length, 3, 'three switches');
}

// ---- the newer replacement policies, worked by hand -----------------------------------------------------------------------
{
  const sc = M.replace('second', [1, 2, 3, 1, 4, 5], 3);
  t.eq([sc.steps[4].cleared, sc.steps[4].victim, sc.steps[5].victim, sc.steps[5].order], [[0, 1, 2], 1, 2, [3, 4, 5]], 'second chance: all three get a second chance, then 1 goes; then 2');
  const ec = M.replace('eclock', [{ page: 1, write: true }, 2, { page: 3, write: true }, 4, 5], 3);
  t.eq([ec.steps[3].victim, ec.steps[3].cleared, ec.steps[4].victim, ec.steps[4].writeBack, ec.writeBacks], [2, [0, 1, 2], 3, true, 1], 'enhanced clock: clean 2 first (scan 3), then dirty 3 with a write-back');
  t.eq(M.replace('lfu', [1, 1, 2, 3, 2, 4], 3).steps[5].victim, 3, 'LFU: page 3, used once');
  t.eq(M.replace('mfu', [1, 1, 2, 3, 2, 4], 3).steps[5].victim, 1, 'MFU: pages 1 and 2 used twice, 1 loaded first');
  const ag = M.replace('aging', [1, 2, 3, 1, 4], 3, { bits: 4 });
  t.eq([ag.steps[3].ages, ag.steps[4].victim], [['1001', '0010', '0100'], 2], 'aging: registers after reference 4, and page 2 goes');
  t.eq(M.replace('nru', [1, { page: 2, write: true }, 3, 4, 5], 3).steps.filter((s) => s.victim !== null).map((s) => s.victim), [1, 4], 'NRU: class 2 (lowest frame) then class 0 after the reset');
  const bf = M.findBelady({ seed: 3 });
  t.ok(bf && M.replace('fifo', bf.refs, 4).faults > M.replace('fifo', bf.refs, 3).faults, 'the anomaly finder finds a real anomaly');
  t.ok(M.findBelady({ policy: 'lru', tries: 2000 }) === null, 'and none for LRU');
  const lru = M.beladySearch({ policy: 'lru', tries: 2000 });
  t.ok(!lru.found && lru.refs === null && /No anomaly for LRU/.test(lru.say), 'the search says when it finds none');
  // the well-known example, checked here on its own terms: some 12 of the references, in order, are a renaming of it
  const shapeOf = (r) => { const m = {}; let k = 0; return r.map((p) => (p in m ? m[p] : (m[p] = k++))).join(' '); };
  const FAMOUS = shapeOf([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]);
  const isFamousOrHolds = (r) => {
    if (r.length < 12) return false;
    // every way to keep 12 positions (the strings here are at most 14 long, so at most 91 ways)
    const keep = (from, left, picked) => (left === 0 ? shapeOf(picked) === FAMOUS : from >= r.length ? false : keep(from + 1, left - 1, picked.concat(r[from])) || keep(from + 1, left, picked));
    return keep(0, 12, []);
  };
  t.ok(isFamousOrHolds([7, 3, 9, 4, 7, 3, 1, 7, 3, 9, 4, 1]) && isFamousOrHolds([5, 2, 4, 3, 5, 2, 1, 5, 2, 2, 4, 3, 1, 3]) && !isFamousOrHolds([2, 6, 5, 4, 2, 6, 3, 2, 1, 6, 5, 3, 5]), 'the test’s own check of the well-known example');
  t.ok(M.holdsFamous([7, 3, 9, 4, 7, 3, 1, 7, 3, 9, 4, 1]) && M.holdsFamous([5, 2, 4, 3, 5, 2, 1, 5, 2, 2, 4, 3, 1, 3]) && !M.holdsFamous([2, 6, 5, 4, 2, 6, 3, 2, 1, 6, 5, 3, 5]), 'the engine’s check agrees');
  let table = true;
  for (const sh of M.BELADY_FIFO3) { const r = [...sh].map(Number); if (!(fifoRef(r, 4).filter((x) => !x.hit).length > fifoRef(r, 3).filter((x) => !x.hit).length) || isFamousOrHolds(r)) table = false; }
  t.ok(table && M.BELADY_FIFO3.length === 172, 'the table: 172 genuine anomalies, none holding the well-known example');
  // fifty seeds: every one gives a genuine FIFO anomaly that is not the well-known example in any renaming
  let all50 = true;
  const seen = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const r = M.beladySearch({ seed });
    const a = fifoRef(r.refs, 3).filter((x) => !x.hit).length, b = fifoRef(r.refs, 4).filter((x) => !x.hit).length;
    if (!r.found || !(b > a) || r.faults[0] !== a || r.faults[1] !== b || isFamousOrHolds(r.refs)) all50 = false;
    if (JSON.stringify(M.beladySearch({ seed }).refs) !== JSON.stringify(r.refs)) all50 = false;
    seen.add(r.refs.join(' '));
  }
  t.ok(all50, 'Belady search: all 50 seeds give a genuine FIFO anomaly, never the well-known one, the same for the same seed');
  t.ok(seen.size > 30, 'Belady search: the seeds give different strings (' + seen.size + ')');
  const topicCall = M.findBelady({ policy: 'fifo', length: 14, pages: 5, frames: 3, seed: 4, tries: 12000 });
  t.ok(topicCall && !isFamousOrHolds(topicCall.refs), 'Belady search: the topic’s call (five pages asked) still gets one of its own');
  let others = true;
  for (const policy of ['clock', 'second', 'fifo']) for (const seed of [1, 2, 3]) { const r = M.beladySearch({ policy, seed, frames: policy === 'fifo' ? 2 : 3, tries: 4000 }); if (r.found && (isFamousOrHolds(r.refs) || !(r.faults[1] > r.faults[0]))) others = false; }
  t.ok(others, 'Belady search: the live searches never return the well-known example either');
  t.ok(M.beladySearch({ policy: 'clock', seed: 5 }).found, 'Belady search: a clock anomaly, from the randomised fallback');
}

// ---- the newer policies against independent versions ---------------------------------------------------------------------
function genericRef(choose, opts) {
  // frames as objects in an array; choose(frames, i, refs, state) picks a victim index; empty frames fill in order
  return (refs, n) => {
    const fr = [], out = [], st = { hand: 0, seq: 0 };
    refs.forEach((r, i) => {
      const page = typeof r === 'object' ? r.page : r, w = typeof r === 'object' && r.write;
      const f = fr.find((x) => x && x.page === page);
      if (f) { f.ref = 1; f.n++; if (w) f.d = 1; }
      else {
        let k = opts.sweeps ? -1 : fr.length < n ? fr.length : -1;
        if (k < 0) k = choose(fr, n, st, i);
        fr[k] = { page, ref: 1, d: w ? 1 : 0, n: 1, age: 0, seq: st.seq++ };
        if (opts.sweeps) st.hand = (k + 1) % n;
      }
      if (opts.after) opts.after(fr, i);
      out.push({ hit: !!f, frames: Array.from({ length: n }, (_, k) => (fr[k] ? fr[k].page : null)) });
    });
    return out;
  };
}
{
  const REF = {
    second: genericRef((fr, n, st) => { for (;;) { const q = fr.slice().sort((a, b) => a.seq - b.seq)[0]; if (!q.ref) return fr.indexOf(q); q.ref = 0; q.seq = st.seq++; } }, {}),
    eclock: genericRef((fr, n, st) => {
      const at = (k) => fr[(st.hand + k) % n];
      for (;;) {
        for (let k = 0; k < n; k++) if (!at(k) || (!at(k).ref && !at(k).d)) return (st.hand + k) % n;
        for (let k = 0; k < n; k++) { if (!at(k).ref && at(k).d) return (st.hand + k) % n; at(k).ref = 0; }
      }
    }, { sweeps: true }),
    lfu: genericRef((fr) => fr.indexOf(fr.slice().sort((a, b) => a.n - b.n || a.seq - b.seq)[0]), {}),
    mfu: genericRef((fr) => fr.indexOf(fr.slice().sort((a, b) => b.n - a.n || a.seq - b.seq)[0]), {}),
    aging: genericRef((fr) => fr.indexOf(fr.slice().sort((a, b) => a.age - b.age || a.seq - b.seq)[0]), { after: (fr) => fr.forEach((f) => { if (f) { f.age = f.age / 2 + f.ref * 128; f.age = Math.floor(f.age); f.ref = 0; } }) }),
    nru: genericRef((fr) => { let best = 0; fr.forEach((f, k) => { if (2 * f.ref + f.d < 2 * fr[best].ref + fr[best].d) best = k; }); return best; }, { after: (fr, i) => { if ((i + 1) % 4 === 0) fr.forEach((f) => f && (f.ref = 0)); } }),
  };
  const R = rng(17);
  for (const p of Object.keys(REF)) {
    let good = true;
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(R() * 5), pages = 2 + Math.floor(R() * 7);
      const refs = Array.from({ length: 5 + Math.floor(R() * 35) }, () => (R() < 0.3 ? { page: Math.floor(R() * pages), write: true } : Math.floor(R() * pages)));
      const a = M.replace(p, refs, n), b = REF[p](refs, n);
      a.steps.forEach((s, i) => { if (s.hit !== b[i].hit || JSON.stringify(s.frames) !== JSON.stringify(b[i].frames)) good = false; });
    }
    t.ok(good, p + ': agrees with an independent version on 200 random strings with writes');
  }
  // second chance chooses exactly as the clock does
  let same = true;
  for (let trial = 0; trial < 100; trial++) {
    const refs = Array.from({ length: 30 }, () => Math.floor(R() * 6)), n = 1 + Math.floor(R() * 4);
    if (JSON.stringify(M.replace('second', refs, n).steps.map((s) => s.frames)) !== JSON.stringify(M.replace('clock', refs, n).steps.map((s) => s.frames))) same = false;
  }
  t.ok(same, 'second chance and the clock evict the same pages');
}

// ---- base and bounds -------------------------------------------------------------------------------------------------
{
  const reg = { base: 14000, limit: 3000 };
  t.eq([M.baseBounds(reg, 2999).pa, M.baseBounds(reg, 0).pa], [16999, 14000], 'base and bounds: relocation');
  t.ok(!M.baseBounds(reg, 3000).ok && M.baseBounds(reg, 3000).steps.pop().kind === 'fault', 'base and bounds: the limit itself faults');
}

// ---- contiguous allocation ------------------------------------------------------------------------------------------
{
  const ops = [{ op: 'alloc', id: 'A', size: 300 }, { op: 'alloc', id: 'B', size: 200 }, { op: 'alloc', id: 'C', size: 250 }, { op: 'free', id: 'B' }, { op: 'alloc', id: 'D', size: 150 }];
  const at = {};
  for (const p of ['first', 'best', 'worst', 'next']) at[p] = M.runContig({ memory: 1000, policy: p }, ops).steps[4].start;
  t.eq(at, { first: 300, best: 300, worst: 750, next: 750 }, 'contiguous: where D (150) goes, holes 200 at 300 and 250 at 750');
  const r = M.runContig({ memory: 1000, policy: 'first' }, ops.concat([{ op: 'alloc', id: 'E', size: 300 }]));
  const f = r.steps[5];
  t.ok(f.kind === 'fail' && f.frag.free === 300 && f.frag.largest === 250 && Math.abs(f.frag.external - (1 - 250 / 300)) < 1e-12, 'contiguous: 300 free but no hole of 300');
  const c = M.runContig({ memory: 1000, policy: 'first', compact: 'on-fail' }, ops.concat([{ op: 'alloc', id: 'E', size: 300 }]));
  const e = c.steps[5];
  t.ok(e.kind === 'alloc' && e.compacted && e.start === 700, 'contiguous: compaction, then E fits at 700');
  t.eq(e.compacted.moved.map((m) => [m.id, m.from, m.to]), [['C', 500, 450]], 'compaction moves only C (D already sits on A)');
  t.eq(M.compactBlocks([{ id: 'x', start: 100, size: 50 }, { id: 'y', start: 400, size: 10 }], 0).moved, [{ id: 'x', from: 100, to: 0, size: 50 }, { id: 'y', from: 400, to: 50, size: 10 }], 'compactBlocks');
  // an independent version on a byte map: free runs, and each policy's choice among them
  const R = rng(31);
  let good = true;
  for (const p of ['first', 'best', 'worst', 'next']) for (let trial = 0; trial < 25; trial++) {
    const mem = 400, A = M.contig({ memory: mem, policy: p }), map = Array(mem).fill(null), live = [];
    let rover = 0;
    for (let k = 0; k < 60; k++) {
      if (live.length && R() < 0.4) { const id = live.splice(Math.floor(R() * live.length), 1)[0]; A.free(id); for (let i = 0; i < mem; i++) if (map[i] === id) map[i] = null; continue; }
      const id = 'b' + k, size = 1 + Math.floor(R() * 80);
      const runs = [];
      for (let i = 0; i < mem;) { if (map[i] !== null) { i++; continue; } let j = i; while (j < mem && map[j] === null) j++; runs.push([i, j - i]); i = j; }
      const fit = runs.filter((x) => x[1] >= size);
      let want = null;
      if (fit.length) want = p === 'first' ? fit[0] : p === 'best' ? fit.reduce((a, x) => (x[1] < a[1] ? x : a)) : p === 'worst' ? fit.reduce((a, x) => (x[1] > a[1] ? x : a)) : fit.find((x) => x[0] + x[1] > rover) || fit[0];
      const st = A.alloc(id, size);
      if ((st.kind === 'fail') !== !want || (want && st.start !== want[0])) good = false;
      if (want) { for (let i = want[0]; i < want[0] + size; i++) map[i] = id; live.push(id); rover = want[0] + size; }
      // invariants: blocks and holes tile memory, no two holes touch
      const tiles = A.blocks().map((b) => [b.start, b.size]).concat(A.holes().map((h) => [h.start, h.size])).sort((x, y) => x[0] - y[0]);
      let pos = 0;
      for (const [s, z] of tiles) { if (s !== pos) good = false; pos = s + z; }
      if (pos !== mem) good = false;
      const hs = A.holes();
      for (let i = 1; i < hs.length; i++) if (hs[i - 1].start + hs[i - 1].size === hs[i].start) good = false;
    }
  }
  t.ok(good, 'contiguous: all four policies agree with a byte map, and memory always tiles');
  const fp = M.fiftyPercent({ policy: 'first', seed: 4 });
  t.ok(fp.ratio > 0.4 && fp.ratio < 0.6, 'the fifty-percent rule: holes ≈ half the blocks (' + fp.ratio.toFixed(2) + ')');
}

// ---- segmentation ---------------------------------------------------------------------------------------------------
{
  const tb = { offBits: 12, segs: [{ name: 'code', base: 20000, limit: 1500, grow: 'up', prot: 'rx' }, { name: 'data', base: 30000, limit: 1000, grow: 'up', prot: 'rw' }, { name: 'stack', base: 50000, limit: 800, grow: 'down', prot: 'rw' }] };
  const tr = (seg, offset, access) => M.segTranslate(tb, { seg, offset, access });
  t.eq(tr(0, 1000, 'x').pa, 21000, 'segment: code base + offset');
  t.eq([tr(0, 100, 'w').fault, tr(1, 1000, 'r').fault, tr(3, 0, 'r').fault, tr(2, 3000, 'w').fault], ['protection', 'limit', 'segment', 'limit'], 'segment faults');
  t.eq(tr(2, 4000, 'w').pa, 50704, 'grow-down stack: 4000 − (4096 − 800) = 704 above the base');
  t.eq(tr(2, 3296, 'r').pa, 50000, 'grow-down: the lowest valid offset is the base');
  const pg = Object.assign({}, tb, { paging: { pageBytes: 256, tables: [[], [7, null, 3, 9], []] } });
  const a = M.segTranslate(pg, { seg: 1, offset: 600, access: 'r' });
  t.ok(a.ok && a.pa === 3 * 256 + 88 && a.page === 2, 'segmentation with paging: page 2, offset 88, frame 3');
  t.eq(M.segTranslate(pg, { seg: 1, offset: 300, access: 'r' }).fault, 'page', 'segmentation with paging: an unmapped page');
  t.eq(M.segSplit(0x2abc, 2, 12), { seg: 2, offset: 0xabc }, 'the address split');
}

// ---- the buddy system -------------------------------------------------------------------------------------------------
function treeOk(node, out) {
  if (node.state === 'split') { if (node.children[0].size !== node.size / 2 || node.children[1].offset !== node.offset + node.size / 2) return false; return treeOk(node.children[0], out) && treeOk(node.children[1], out); }
  out.push(node);
  return node.state !== 'lost';
}
{
  const B = M.buddy({ size: 1024, minBlock: 64 });
  const a = B.alloc('A', 100);
  t.ok(a.offset === 0 && a.blockSize === 128 && a.splits.length === 3 && a.internal === 28, 'buddy: 100 bytes take 128 at 0 after three splits');
  t.eq([B.alloc('B', 240).offset, B.alloc('C', 60).offset], [256, 128], 'buddy: 256 at 256, 64 at 128');
  t.eq(B.freeLists(), { 64: [192], 128: [], 256: [], 512: [512], 1024: [] }, 'buddy: free lists');
  t.eq(B.free('A').merges.length, 0, 'buddy: A’s buddy (128) is split, so no merge');
  t.eq(B.free('C').merges.map((m) => [m.size, m.offset]), [[64, 128], [128, 0]], 'buddy: C merges twice, up to 256 at 0');
  const last = B.free('B');
  t.ok(last.merges.length === 2 && last.tree.state === 'free' && last.tree.size === 1024, 'buddy: everything coalesces into one block');
  // an independent version on an explicit tree: the smallest free node that fits, lowest address first
  const R = rng(41);
  let good = true;
  for (let trial = 0; trial < 40; trial++) {
    const B2 = M.buddy({ size: 2048, minBlock: 32 });
    const root = { off: 0, size: 2048, st: 'free' };
    const nodes = (n, acc) => { acc.push(n); if (n.kids) n.kids.forEach((k) => nodes(k, acc)); return acc; };
    const ids = new Map();
    for (let k = 0; k < 50; k++) {
      if (ids.size && R() < 0.45) {
        const id = [...ids.keys()][Math.floor(R() * ids.size)], n = ids.get(id);
        ids.delete(id); B2.free(id); n.st = 'free';
        // coalesce: any split node with two free leaf children becomes free, repeatedly
        for (let ch = true; ch;) { ch = false; for (const x of nodes(root, [])) if (x.kids && x.kids.every((c) => c.st === 'free' && !c.kids)) { delete x.kids; x.st = 'free'; ch = true; } }
        continue;
      }
      const id = 'x' + k, bytes = 1 + Math.floor(R() * 400);
      let need = 32; while (need < bytes) need *= 2;
      const free = nodes(root, []).filter((x) => !x.kids && x.st === 'free' && x.size >= need).sort((p, q) => p.size - q.size || p.off - q.off);
      const st = B2.alloc(id, bytes);
      if (!free.length) { if (st.kind !== 'fail') good = false; continue; }
      let n = free[0];
      while (n.size > need) { n.kids = [{ off: n.off, size: n.size / 2, st: 'free' }, { off: n.off + n.size / 2, size: n.size / 2, st: 'free' }]; n.st = 'split'; n = n.kids[0]; }
      n.st = 'used'; ids.set(id, n);
      if (st.offset !== n.off || st.blockSize !== n.size) good = false;
      const leaves = [];
      if (!treeOk(st.tree, leaves)) good = false;
      // leaves tile memory; used blocks never overlap; no two free buddies remain apart
      let pos = 0;
      for (const l of leaves) { if (l.offset !== pos) good = false; pos += l.size; }
      if (pos !== 2048) good = false;
      for (const [s, offs] of Object.entries(st.freeLists)) for (const o of offs) if (offs.includes(o ^ +s)) good = false;
    }
    for (const id of [...ids.keys()]) B2.free(id);
    if (B2.tree().state !== 'free') good = false;
  }
  t.ok(good, 'buddy: agrees with a tree version; the tree stays consistent and coalesces fully');
}

// ---- slabs ------------------------------------------------------------------------------------------------------------
{
  const A = M.slab({ caches: [{ name: 'inode', objSize: 1000 }, { name: 'task', objSize: 2048 }], slabBytes: 4096 });
  const st = ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => A.alloc('inode', id));
  t.eq(st.map((s) => s.kind), ['grow', 'alloc', 'alloc', 'alloc', 'grow'], 'slab: four objects a slab, then the cache grows');
  t.eq([st[3].moved, st[4].snapshot.caches[0].full, st[4].snapshot.caches[0].partial], ['partial>full', [0], [1]], 'slab: slab 0 full, slab 1 partial');
  t.eq(A.free('i2').moved, 'full>partial', 'slab: a free moves a full slab to partial');
  const re = A.alloc('inode', 'i6');
  t.ok(re.slab === 0 && re.slot === 1, 'slab: the next object takes the freed slot in the first partial slab');
  A.free('i5');
  const sh = A.shrink();
  t.eq([sh.freed, sh.snapshot.caches[0].slabs.length], [[1], 1], 'slab: shrinking frees the empty slab');
  t.eq(A.alloc('task', 't1').snapshot.caches[1].perSlab, 2, 'slab: a cache of 2 KiB objects holds two a slab');
  const R = rng(51);
  let good = true;
  const S2 = M.slab({ caches: [{ name: 'a', objSize: 600 }, { name: 'b', objSize: 1300 }] }), live = new Set();
  for (let k = 0; k < 300; k++) {
    if (live.size && R() < 0.45) { const id = [...live][Math.floor(R() * live.size)]; live.delete(id); S2.free(id); } else { const id = 'o' + k; live.add(id); S2.alloc(R() < 0.5 ? 'a' : 'b', id); }
    if (R() < 0.05) S2.shrink();
    const snap = S2.snapshot(), seen = [];
    for (const c of snap.caches) for (const s of c.slabs) { const n = s.objs.filter((x) => x !== null).length; if (s.list !== (n === 0 ? 'empty' : n === c.perSlab ? 'full' : 'partial')) good = false; seen.push(...s.objs.filter((x) => x !== null)); }
    if (seen.length !== live.size || seen.some((x) => !live.has(x)) || new Set(seen).size !== seen.length) good = false;
  }
  t.ok(good, 'slab: every live object in exactly one slot, and each slab on the right list');
}

// ---- malloc with boundary tags -----------------------------------------------------------------------------------------
{
  const H = M.malloc({ heap: 128, policy: 'first' });
  const a = H.malloc('A', 10), b = H.malloc('B', 20), c = H.malloc('C', 30);
  t.eq([[a.start, a.size], [b.start, b.size], [c.start, c.size]], [[0, 24], [24, 32], [56, 40]], 'malloc: sizes with 8 bytes of tags, rounded to 8');
  t.eq(M.malloc({ heap: 256 }).malloc('m0', 35).say, 'malloc(35) for m0: 35 + 8 bytes of tags, rounded to 48; the first free block that fits is at 0, split into 48 used and 208 free. The payload starts at 4.', 'malloc: the narration names the tag bytes');
  t.eq(H.free('B').merges.length, 0, 'malloc: B between two used blocks stays alone');
  const fc = H.free('C');
  t.ok(fc.merges.length === 2 && fc.start === 24 && fc.size === 104, 'malloc: C merges with the free space after it and with B before it');
  t.eq(H.stats().external, 0, 'malloc: one free block, no external fragmentation');
  const B2 = M.malloc({ heap: 200, policy: 'best' });
  ['p', 'q', 'r', 's', 'u'].forEach((id, k) => B2.malloc(id, [40, 8, 16, 8, 30][k]));
  B2.free('p'); B2.free('r');
  t.eq(B2.malloc('v', 12).start, 64, 'best fit: the 24-byte hole at 64, not the 48 at 0');
  t.eq(M.malloc({ heap: 64 }).malloc('w', 60).kind, 'fail', 'malloc: too big fails');
  // an independent version on a byte map, for every policy; coalescing makes free blocks the maximal free runs
  const R = rng(61);
  let good = true;
  const classes = [16, 32, 64, 128, 256], cls = (s) => { let k = 0; while (k + 1 < classes.length && s >= classes[k + 1]) k++; return k; };
  for (const p of ['first', 'next', 'best', 'segregated']) for (let trial = 0; trial < 20; trial++) {
    const heap = 512, Hp = M.malloc({ heap, policy: p }), own = Array(heap).fill(null), live = [];
    let rover = 0;
    for (let k = 0; k < 80; k++) {
      if (live.length && R() < 0.45) {
        const id = live.splice(Math.floor(R() * live.length), 1)[0]; Hp.free(id);
        for (let i = 0; i < heap; i++) if (own[i] === id) own[i] = null;
        const run = Hp.blocks().find((x) => x.free && x.start <= rover && rover < x.start + x.size); if (run && run.start < rover) rover = run.start;
        continue;
      }
      const id = 'm' + k, bytes = 1 + Math.floor(R() * 90), need = Math.max(16, Math.ceil((bytes + 8) / 8) * 8);
      const runs = [];
      for (let i = 0; i < heap;) { if (own[i] !== null) { i++; continue; } let j = i; while (j < heap && own[j] === null) j++; runs.push([i, j - i]); i = j; }
      const fit = runs.filter((x) => x[1] >= need);
      let want = null;
      if (fit.length) {
        if (p === 'first') want = fit[0];
        else if (p === 'best') want = fit.reduce((a2, x) => (x[1] < a2[1] ? x : a2));
        else if (p === 'next') { const k2 = runs.findIndex((x) => x[0] + x[1] > rover); const order = k2 < 0 ? runs : runs.slice(k2).concat(runs.slice(0, k2)); want = order.find((x) => x[1] >= need); }
        else { for (let c2 = cls(need); c2 < classes.length && !want; c2++) want = runs.find((x) => cls(x[1]) === c2 && x[1] >= need) || null; }
      }
      const st = Hp.malloc(id, bytes);
      if ((st.kind === 'fail') !== !want || (want && st.start !== want[0])) { good = false; continue; }
      if (!want) continue;
      const size = want[1] - need >= 16 ? need : want[1];
      if (st.size !== size) good = false;
      for (let i = want[0]; i < want[0] + size; i++) own[i] = id;
      live.push(id); rover = want[0] + size;
      const bl = Hp.blocks();
      let pos = 0;
      for (let i = 0; i < bl.length; i++) { if (bl[i].start !== pos) good = false; pos += bl[i].size; if (i && bl[i].free && bl[i - 1].free) good = false; }
      if (pos !== heap) good = false;
    }
    for (const id of live) Hp.free(id);
    if (Hp.blocks().length !== 1 || !Hp.blocks()[0].free) good = false;
  }
  t.ok(good, 'malloc: first, next, best and segregated fit agree with a byte map; blocks tile, free ones never touch, and all coalesce at the end');
}

// ---- page size ----------------------------------------------------------------------------------------------------------
{
  const f = M.internalFrag([5000, 100], 4096);
  t.eq([f.rows.map((r) => r.pages), f.rows.map((r) => r.waste), f.waste], [[2, 1], [3192, 3996], 7188], 'internal fragmentation per allocation');
  const tr = M.pageSizeTradeoff({ vaBits: 32, pteBytes: 4, tlbEntries: 64, sizes: [5000, 100, 70000], pageSizes: [1024, 4096, 65536] });
  t.eq(tr.rows.map((r) => r.flatTable), [16 << 20, 4 << 20, 256 << 10], 'page size: flat tables shrink');
  t.eq(tr.rows.map((r) => r.reach), [65536, 262144, 4 << 20], 'page size: TLB reach grows');
  t.ok(tr.rows[0].waste < tr.rows[1].waste && tr.rows[1].waste < tr.rows[2].waste, 'page size: waste grows');
}

// ---- the scenes' traces --------------------------------------------------------------------------------------------------
for (const id of ['page-walk', 'inverted-table', 'replace-pair']) {
  const sc = S.Demo.byId(id);
  t.ok(!!sc, 'scene ' + id + ' is registered');
  if (!sc) continue;
  const tr = sc.trace();
  t.ok(Array.isArray(tr) && tr.length >= 2 && tr.every((s) => s.kind && s.say && !/undefined|NaN/.test(s.say)), id + ': a narrated trace');
  t.eq(JSON.stringify(sc.trace(), (k, v) => (typeof v === 'bigint' ? String(v) : v)), JSON.stringify(tr, (k, v) => (typeof v === 'bigint' ? String(v) : v)), id + ': the same trace twice');
}
t.done();
