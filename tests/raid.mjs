// RAID 0, 1, 1+0, 4, 5 and 6 over real bytes: the layouts worked by hand, the bit-by-bit XOR, GF(2⁸) checked against
// an independent carry-less multiply, and for every level, layout, disk count and chunk size, random writes read
// back against a plain byte array, parity (P and Q) checked independently, every failed disk and every pair of
// failed disks on RAID 6 read in degraded mode and rebuilt to exactly its old bytes, the small-write counts matched
// by the real reads and writes, and the capacity and throughput formulas worked for given disks.
import { load, harness, rng } from './load.mjs';

const t = harness('raid');
const S = load(['core']);
const R = S.Raid;

// ---- layouts by hand ----
{
  const A = R.create({ level: 5, disks: 4, chunk: 2, stripes: 4 });
  // left-symmetric: D0 D1 D2 P / D4 D5 P D3 / D8 P D6 D7 / P D9 D10 D11
  const want = [['D0', 'D1', 'D2', 'P'], ['D4', 'D5', 'P', 'D3'], ['D8', 'P', 'D6', 'D7'], ['P', 'D9', 'D10', 'D11']];
  const got = [0, 1, 2, 3].map((s) => [0, 1, 2, 3].map((d) => { const r = R.role(A, s, d); return r.role === 'parity' ? 'P' : 'D' + r.chunk; }));
  t.eq(got, want, 'RAID 5 on 4 disks, left-symmetric');
  t.eq(R.capacity(A), 3 * 2 * 4, 'RAID 5 capacity: n − 1 disks of data');
  const B = R.create({ level: 4, disks: 3, chunk: 1, stripes: 2 });
  t.eq([0, 1].map((s) => [0, 1, 2].map((d) => R.role(B, s, d).role)), [['data', 'data', 'parity'], ['data', 'data', 'parity']], 'RAID 4 keeps parity on the last disk');
  const C = R.create({ level: 0, disks: 3, chunk: 4, stripes: 2 });
  t.eq([0, 1, 2, 3, 4].map((c) => [R.map(C, c).disk, R.map(C, c).stripe]), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], 'RAID 0 round robin');
  const M = R.create({ level: 1, disks: 2, chunk: 4, stripes: 3 });
  t.eq(R.capacity(M), 12, 'RAID 1 capacity is one disk');
}
// ---- XOR bit by bit, by hand: 'H' 0x48 = 01001000, 'i' 0x69 = 01101001, '!' 0x21 = 00100001 ----
{
  const x = R.xorBits([0x48, 0x69, 0x21]);
  t.eq(x.bits, [[0, 1, 0, 0, 1, 0, 0, 0], [0, 1, 1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 1]], 'the bits of each byte, high bit first');
  t.eq(x.ones, [0, 2, 2, 0, 2, 0, 0, 2], 'ones in each column');
  t.eq([x.out, x.outBits], [0x00, [0, 0, 0, 0, 0, 0, 0, 0]], 'an even count of ones in every column gives 0');
  const y = R.xorBits([0x52, 0x41, 0x49]);       // 01010010 ^ 01000001 ^ 01001001 = 01011010
  t.eq(y.out, 0x5a, 'R ^ A ^ I = 0x5a');
}
// ---- every level, disk count and chunk size ----
let degradedChecks = 0;
const rand = rng(11);
for (const level of [0, 1, 4, 5]) {
  for (let n = level === 0 || level === 1 ? 2 : 3; n <= 6; n++) {
    for (const chunk of [1, 2, 4, 8]) {
      const A = R.create({ level, disks: n, chunk, stripes: 5 }), cap = R.capacity(A), plain = new Uint8Array(cap);
      for (let w = 0; w < 12; w++) {
        const off = Math.floor(rand() * cap), len = 1 + Math.floor(rand() * Math.min(cap - off, 3 * chunk * n));
        const data = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
        R.write(A, off, data); plain.set(data, off);
      }
      const at = `RAID ${level}, ${n} disks, chunk ${chunk}`;
      t.eq([...R.read(A, 0, cap).bytes], [...plain], at + ': reads back what was written');
      // independent placement and parity: count where each logical byte should be, and XOR whole stripes
      for (let s = 0; s < A.stripes; s++) {
        if (level === 4 || level === 5) {
          let x = new Uint8Array(chunk);
          for (let d = 0; d < n; d++) for (let i = 0; i < chunk; i++) x[i] ^= A.disk[d][s * chunk + i];
          t.ok(x.every((v) => v === 0), at + ': stripe ' + s + ' XORs to zero across all disks');
          const p = level === 4 ? n - 1 : (n - 1 - (s % n) + n) % n;
          t.eq(R.parityDisk(A, s), p, at + ': parity disk of stripe ' + s);
        }
        if (level === 1) for (let d = 1; d < n; d++) t.eq([...A.disk[d]], [...A.disk[0]], at + ': mirror ' + d + ' equals disk 0');
      }
      if (level === 0 || level === 5 || level === 4) {
        const w = level === 0 ? n : n - 1;
        for (let c = 0; c < cap / chunk; c++) {
          const s = Math.floor(c / w), k = c % w;
          const d = level === 0 ? k : level === 4 ? k : (n - 1 - (s % n) + 1 + k) % n;
          t.eq([...A.disk[d].subarray(s * chunk, s * chunk + chunk)], [...plain.subarray(c * chunk, c * chunk + chunk)], at + ': chunk ' + c + ' on disk ' + d);
        }
      }
      if (level === 0) continue;
      // every possible failed disk: degraded reads, a degraded write, and a rebuild to the exact old bytes
      for (let d = 0; d < n; d++) {
        const B = R.clone(A), old = B.disk[d].slice();
        R.fail(B, d);
        t.eq([...R.read(B, 0, cap).bytes], [...plain], at + ': degraded read with disk ' + d + ' failed');
        R.rebuild(B, d);
        t.eq([...B.disk[d]], [...old], at + ': disk ' + d + ' rebuilt exactly');
        const C = R.clone(A), p2 = plain.slice();
        R.fail(C, d);
        const off = Math.floor(rand() * (cap - 1)), data = Uint8Array.from({ length: Math.min(cap - off, chunk * 2) }, () => Math.floor(rand() * 256));
        R.write(C, off, data); p2.set(data, off);
        t.eq([...R.read(C, 0, cap).bytes], [...p2], at + ': a write while disk ' + d + ' is down reads back');
        R.rebuild(C, d);
        const D = R.create({ level, disks: n, chunk, stripes: 5 }); R.write(D, 0, p2);
        t.eq(C.disk.map((u) => [...u]), D.disk.map((u) => [...u]), at + ': after rebuild the array equals one written whole');
        degradedChecks++;
      }
    }
  }
}
t.ok(degradedChecks > 100, 'every failed disk tried (' + degradedChecks + ' cases)');
// RAID 0 cannot rebuild, two failures in RAID 5 lose data
{
  const A = R.create({ level: 0, disks: 2 }); R.write(A, 0, 'abcd'); R.fail(A, 1);
  let threw = false; try { R.rebuild(A, 1); } catch (e) { threw = true; } t.ok(threw, 'RAID 0 cannot rebuild');
  const B = R.create({ level: 5, disks: 4 }); R.write(B, 0, 'two disks lost'); R.fail(B, 0); R.fail(B, 2);
  threw = false; try { R.read(B, 0, 12); } catch (e) { threw = true; } t.ok(threw, 'RAID 5 cannot survive two failures');
}

// ---- GF(2⁸) against an independent carry-less multiply reduced by 0x11d ----
const G = S.GF;
const clmul = (a, b) => { let r = 0; for (let i = 0; i < 8; i++) if ((b >> i) & 1) r ^= a << i; for (let i = 15; i >= 8; i--) if ((r >> i) & 1) r ^= 0x11d << (i - 8); return r; };
{
  let bad = 0, badBits = 0;
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) { const c = clmul(a, b); if (G.mul(a, b) !== c) bad++; if ((a * 7 + b) % 61 === 0 && G.mulBits(a, b).out !== c) badBits++; }
  t.eq(bad, 0, 'GF mul equals the carry-less product mod 0x11d for all 65536 pairs');
  t.eq(badBits, 0, 'GF mulBits (shift and add) agrees');
  t.eq(G.mul(2, 0x80), 0x1d, '2 · 0x80 = 0x1d: the top bit carries out and 0x1d folds back in');
  t.eq(G.gpow(8), 0x1d, 'g⁸ = 0x1d');
  t.eq(G.mul(0x57, 0x13), clmul(0x57, 0x13), '0x57 · 0x13');
  const seen = new Set(); for (let k = 0; k < 255; k++) seen.add(G.gpow(k));
  t.ok(seen.size === 255 && !seen.has(0), 'g = 2 generates all 255 nonzero bytes');
  let inv = 0; for (let a = 1; a < 256; a++) if (G.mul(a, G.inv(a)) !== 1 || G.div(G.mul(a, 0x9e), a) !== 0x9e) inv++;
  t.eq(inv, 0, 'a · a⁻¹ = 1 and (a·b)/a = b for every nonzero a');
  t.eq(G.gpow(-1), G.inv(2), 'g⁻¹ is the inverse of 2');
  const rr = rng(5); let dist = 0;
  for (let i = 0; i < 2000; i++) { const a = Math.floor(rr() * 256), b = Math.floor(rr() * 256), c = Math.floor(rr() * 256); if (G.mul(a, b ^ c) !== (G.mul(a, b) ^ G.mul(a, c)) || G.mul(G.mul(a, b), c) !== G.mul(a, G.mul(b, c))) dist++; if (G.pow(a, 3) !== G.mul(a, G.mul(a, a))) dist++; }
  t.eq(dist, 0, 'distributive, associative, and pow agrees with repeated mul');
  const mb = G.mulBits(0x53, 0x05);           // 0x53 · (1 + 4) = 0x53 ⊕ 0x53·4; 0x53·2 = 0xa6, ·4 = 0x4c ⊕ 0x1d = 0x51
  t.eq([mb.rows[0].term, mb.rows[1].term, mb.rows[2].term, mb.out], [0x53, 0xa6, 0x51, 0x53 ^ 0x51], 'shift-and-add worked by hand for 0x53 · 0x05');
}
// ---- layouts by hand: RAID 6, right and asymmetric RAID 5, RAID 10 ----
{
  const name = (A, s, d) => { const r = R.role(A, s, d); return r.role === 'parity' ? 'P' : r.role === 'q' ? 'Q' : r.role === 'mirror' ? 'M' + r.chunk : 'D' + r.chunk; };
  const grid = (A) => [...Array(A.stripes).keys()].map((s) => [...Array(A.n).keys()].map((d) => name(A, s, d)));
  t.eq(grid(R.create({ level: 6, disks: 5, chunk: 1, stripes: 3 })), [['Q', 'D0', 'D1', 'D2', 'P'], ['D3', 'D4', 'D5', 'P', 'Q'], ['D7', 'D8', 'P', 'Q', 'D6']], 'RAID 6 on 5 disks, left-symmetric');
  t.eq(grid(R.create({ level: 5, disks: 4, chunk: 1, stripes: 2, layout: 'right-symmetric' })), [['P', 'D0', 'D1', 'D2'], ['D5', 'P', 'D3', 'D4']], 'RAID 5 right-symmetric');
  t.eq(grid(R.create({ level: 5, disks: 4, chunk: 1, stripes: 2, layout: 'left-asymmetric' })), [['D0', 'D1', 'D2', 'P'], ['D3', 'D4', 'P', 'D5']], 'RAID 5 left-asymmetric');
  t.eq(grid(R.create({ level: 5, disks: 4, chunk: 1, stripes: 2, layout: 'right-asymmetric' })), [['P', 'D0', 'D1', 'D2'], ['D3', 'P', 'D4', 'D5']], 'RAID 5 right-asymmetric');
  t.eq(grid(R.create({ level: 10, disks: 4, chunk: 1, stripes: 2 })), [['D0', 'M0', 'D1', 'M1'], ['D2', 'M2', 'D3', 'M3']], 'RAID 10 on 4 disks: two mirrored pairs');
  t.eq(grid(R.create({ level: 10, disks: 6, copies: 3, chunk: 1, stripes: 1 })), [['D0', 'M0', 'M0', 'D1', 'M1', 'M1']], 'RAID 10 with three-way mirrors');
  t.eq([R.capacity(R.create({ level: 6, disks: 6, chunk: 2, stripes: 3 })), R.tolerance(R.create({ level: 6, disks: 6 })), R.tolerance(R.create({ level: 10, disks: 6, copies: 3 }))], [4 * 2 * 3, 2, 2], 'RAID 6 capacity n − 2, tolerances');
}
// ---- every RAID 6 and RAID 10 array: writes by every method, parity checked independently, every pair failed ----
let pairChecks = 0;
const rand6 = rng(29);
const indepPQ = (A, s) => {        // P and Q of stripe s from the layout drawn by hand above (left- or right-symmetric)
  const n = A.n, C = A.chunk, left = A.layout.startsWith('left'), p = left ? n - 1 - (s % n) : s % n, q = (p + 1) % n;
  const sym = A.layout.endsWith('-symmetric'), dd = sym ? [...Array(n - 2).keys()].map((k) => (q + 1 + k) % n) : [...Array(n).keys()].filter((d) => d !== p && d !== q);
  const P = new Uint8Array(C), Q = new Uint8Array(C);
  dd.forEach((d, k) => { let gk = 1; for (let j = 0; j < k; j++) gk = clmul(gk, 2); for (let i = 0; i < C; i++) { const v = A.disk[d][s * C + i]; P[i] ^= v; Q[i] ^= clmul(gk, v); } });
  return { p, q, dd, P, Q };
};
for (const layout of R.layouts) for (let n = 4; n <= 7; n++) for (const chunk of [1, 3, 4]) {
  const A = R.create({ level: 6, disks: n, chunk, stripes: 4, layout }), cap = R.capacity(A), plain = new Uint8Array(cap);
  for (let w = 0; w < 14; w++) {
    const off = Math.floor(rand6() * cap), len = 1 + Math.floor(rand6() * Math.min(cap - off, 2 * chunk * n));
    const data = Uint8Array.from({ length: len }, () => Math.floor(rand6() * 256));
    R.write(A, off, data, { method: ['auto', 'rmw', 'rcw'][w % 3] }); plain.set(data, off);
  }
  const at = `RAID 6 ${layout}, ${n} disks, chunk ${chunk}`;
  t.eq([...R.read(A, 0, cap).bytes], [...plain], at + ': reads back');
  for (let s = 0; s < A.stripes; s++) {
    const X = indepPQ(A, s);
    t.eq([R.parityDisk(A, s), R.qDisk(A, s), R.dataDisks(A, s)], [X.p, X.q, X.dd], at + ': stripe ' + s + ' layout');
    t.eq([[...A.disk[X.p].subarray(s * chunk, s * chunk + chunk)], [...A.disk[X.q].subarray(s * chunk, s * chunk + chunk)]], [[...X.P], [...X.Q]], at + ': stripe ' + s + ' P and Q');
  }
  const W = R.create({ level: 6, disks: n, chunk, stripes: 4, layout }); R.write(W, 0, plain);
  t.eq(A.disk.map((u) => [...u]), W.disk.map((u) => [...u]), at + ': mixed rmw / rcw writes equal one whole write');
  for (let x = 0; x < n; x++) for (let y = x; y < n; y++) {
    const B = R.clone(A), old = [B.disk[x].slice(), B.disk[y].slice()];
    R.fail(B, x); if (y !== x) R.fail(B, y);
    t.eq([...R.read(B, 0, cap).bytes], [...plain], at + `: degraded read with disks ${x}, ${y} failed`);
    const rb = R.rebuild(B, x === y ? x : [x, y]);
    t.ok([...B.disk[x]].every((v, i) => v === old[0][i]) && [...B.disk[y]].every((v, i) => v === old[1][i]) && B.failed.size === 0 && rb.steps.length === A.stripes, at + `: disks ${x} and ${y} rebuilt exactly`);
    if (x !== y && (x * 3 + y) % 4 === 0) {        // a write while two disks are down, then the rebuild agrees with a clean array
      const C2 = R.clone(A), p2 = plain.slice(); R.fail(C2, x); R.fail(C2, y);
      const off = Math.floor(rand6() * (cap - 1)), data = Uint8Array.from({ length: Math.min(cap - off, chunk * 3) }, () => Math.floor(rand6() * 256));
      R.write(C2, off, data); p2.set(data, off);
      t.eq([...R.read(C2, 0, cap).bytes], [...p2], at + `: write with ${x}, ${y} down reads back`);
      R.rebuild(C2, [x, y]); const D2 = R.create({ level: 6, disks: n, chunk, stripes: 4, layout }); R.write(D2, 0, p2);
      t.eq(C2.disk.map((u) => [...u]), D2.disk.map((u) => [...u]), at + `: after a double rebuild the array equals one written whole`);
    }
    pairChecks++;
  }
  let threw = false; const T3 = R.clone(A); R.fail(T3, 0); R.fail(T3, 1); R.fail(T3, 2);
  try { R.read(T3, 0, cap); } catch (e) { threw = true; } t.ok(threw, at + ': three failures lose data');
}
t.ok(pairChecks > 500, 'every pair of failed disks tried on RAID 6 (' + pairChecks + ' cases)');
for (const [n, m] of [[4, 2], [6, 2], [6, 3], [8, 4]]) for (const chunk of [1, 4]) {
  const A = R.create({ level: 10, disks: n, copies: m, chunk, stripes: 3 }), cap = R.capacity(A), plain = new Uint8Array(cap);
  for (let w = 0; w < 10; w++) { const off = Math.floor(rand6() * cap), len = 1 + Math.floor(rand6() * (cap - off)); const d = Uint8Array.from({ length: len }, () => Math.floor(rand6() * 256)); R.write(A, off, d); plain.set(d, off); }
  const at = `RAID 10, ${n} disks in groups of ${m}, chunk ${chunk}`;
  t.eq([...R.read(A, 0, cap).bytes], [...plain], at + ': reads back');
  for (let d = 0; d < n; d++) t.eq([...A.disk[d]], [...A.disk[d - (d % m)]], at + ': disk ' + d + ' mirrors its group');
  for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) {
    const B = R.clone(A), old = B.disk.map((u) => [...u]); R.fail(B, x); R.fail(B, y);
    const same = Math.floor(x / m) === Math.floor(y / m);
    if (same && m === 2) { let threw = false; try { R.read(B, 0, cap); } catch (e) { threw = true; } t.ok(threw, at + `: losing both copies (${x}, ${y}) loses data`); continue; }
    t.eq([...R.read(B, 0, cap).bytes], [...plain], at + `: degraded read with ${x}, ${y} down`);
    R.rebuild(B, [x, y]); t.eq(B.disk.map((u) => [...u]), old, at + `: ${x}, ${y} rebuilt`);
  }
}
// ---- the small-write problem: the engine's real reads and writes match the counts, by hand and on every stripe ----
{
  const sw = (level, disks, chunks) => { const r = R.smallWrite({ level, disks, chunks }); return [r.rmw.reads, r.rmw.writes, r.rcw.reads, r.rcw.writes, r.best]; };
  t.eq(sw(5, 5, 1), [2, 2, 3, 2, 'rmw'], 'RAID 5, 5 disks, one chunk: rmw 2 reads, rcw 3');
  t.eq(sw(5, 5, 3), [4, 4, 1, 4, 'rcw'], 'RAID 5, 5 disks, three chunks: rcw reads just the fourth');
  t.eq(sw(6, 6, 1), [3, 3, 3, 3, 'rcw'], 'RAID 6, 6 disks, one chunk: a tie, 3 reads either way');
  t.eq(R.smallWrite({ level: 5, disks: 5, chunks: 4 }).best, 'full', 'a whole stripe is a full-stripe write');
  t.eq([R.smallWrite({ level: 5, disks: 5, chunks: 4 }).full.reads, R.smallWrite({ level: 5, disks: 5, chunks: 4 }).full.writes], [0, 5], 'full stripe: 0 reads, 5 writes');
  t.eq(R.smallWrite({ level: 10, disks: 4, chunks: 1 }).rmw, { reads: 0, writes: 2, ios: 2 }, 'RAID 10: a chunk costs two writes');
  for (const level of [4, 5, 6]) for (let n = level === 6 ? 4 : 3; n <= 7; n++) {
    const w = level === 6 ? n - 2 : n - 1;
    for (let k = 1; k <= w; k++) for (const method of ['rmw', 'rcw', 'auto']) for (let first = 0; first + k <= w; first++) {
      const A = R.create({ level, disks: n, chunk: 2, stripes: 2 }); R.write(A, 0, Uint8Array.from({ length: R.capacity(A) }, (_, i) => (i * 37 + 11) & 255));
      const tr = R.write(A, (w + first) * 2, Uint8Array.from({ length: k * 2 }, (_, i) => (i * 91 + n) & 255), { method });
      const c = R.smallWrite({ level, disks: n, chunks: k }), want = k === w ? 'full' : method === 'auto' ? c.best : method;
      const exp = want === 'full' ? c.full : want === 'rmw' ? c.rmw : c.rcw;
      t.eq([tr.stripes[0].method, tr.reads, tr.writes], [want, exp.reads, exp.writes], `RAID ${level}, ${n} disks, ${k} chunk${k > 1 ? 's' : ''} from ${first} by ${method}`);
    }
  }
}
// ---- capacity, tolerance and throughput worked for given disks ----
{
  const f5 = R.formulas({ level: 5, disks: 4, size: 1000, seq: 200, iops: 150, latency: 8 });
  t.eq([f5.capacity, f5.efficiency, f5.tolerance, f5.seqRead, f5.seqWrite, f5.randRead, f5.randWrite, f5.writeLatency], [3000, 0.75, { least: 1, most: 1 }, 600, 600, 600, 150, 16], 'RAID 5 on four 1 TB disks');
  const f6 = R.formulas({ level: 6, disks: 6, size: 2000, seq: 100, iops: 120 });
  t.eq([f6.capacity, f6.tolerance.least, f6.seqRead, f6.randRead, f6.randWrite], [8000, 2, 400, 720, 120], 'RAID 6 on six 2 TB disks');
  const f10 = R.formulas({ level: 10, disks: 4, size: 500, seq: 150, iops: 100 });
  t.eq([f10.capacity, f10.tolerance, f10.seqRead, f10.randRead, f10.randWrite], [1000, { least: 1, most: 2 }, 300, 400, 200], 'RAID 10 on four disks');
  const f0 = R.formulas({ level: 0, disks: 3, size: 100, seq: 50, iops: 80 }), f1 = R.formulas({ level: 1, disks: 2, size: 100, seq: 50, iops: 80 }), f4 = R.formulas({ level: 4, disks: 5, size: 100, seq: 50, iops: 80 });
  t.eq([f0.capacity, f0.tolerance.least, f0.randWrite, f1.capacity, f1.tolerance.least, f1.randRead, f1.randWrite, f4.randRead, f4.randWrite], [300, 0, 240, 100, 1, 160, 80, 320, 40], 'RAID 0, 1 and 4');
  t.ok(f5.lines.every((l) => l.say && !/undefined|NaN/.test(l.say)), 'every formula line is narrated');
}
// ---- every read-old message names the chunk the stripe layout puts on that disk (a layout written separately) ----
{
  const r = rng(4); let n = 0, bad = 0;
  function lay(level, n, m, layout, s, d) {
    if (level === 0) return s * n + d;
    if (level === 1) return s;
    if (level === 10) return s * (n / m) + Math.floor(d / m);
    if (level === 4) return d === n - 1 ? 'P' : s * (n - 1) + d;
    const left = layout.startsWith('left'), p = left ? n - 1 - (s % n) : s % n, q = level === 6 ? (p + 1) % n : -1, w = level === 6 ? n - 2 : n - 1;
    if (d === p) return 'P'; if (d === q) return 'Q';
    let k;
    if (layout.endsWith('asymmetric')) k = [...Array(n).keys()].filter((x) => x !== p && x !== q).indexOf(d);
    else k = (d - ((level === 6 ? q : p) + 1) + 2 * n) % n;
    return s * w + k;
  }
  for (const level of [0,1,10,4,5,6]) for (const layout of R.layouts) for (let disks = 4; disks <= 6; disks++) for (const chunk of [1,3]) for (const fail of [false, true]) {
    if (level === 10 && disks === 5) continue;
    const m = level === 10 ? (disks === 6 ? 3 : 2) : 1;
    const A = R.create({ level, disks, chunk, stripes: 4, layout, copies: m }), cap = R.capacity(A);
    if (fail && level) R.fail(A, Math.floor(r() * disks));
    for (let i = 0; i < 30; i++) {
      const off = Math.floor(r()*cap), len = 1 + Math.floor(r()*Math.min(cap-off, 2*chunk*disks));
      const tr = R.write(A, off, Uint8Array.from({length: len}, () => Math.floor(r()*256)), { method: ['auto','rmw','rcw'][i%3] });
      for (const st of tr.steps.filter(x => x.kind === 'read-old' && x.disk !== undefined)) {
        n++;
        const want = lay(level, disks, m, layout, st.stripe, st.disk), mm = st.say.match(/chunk (\d+)/), got = mm ? +mm[1] : /Q of/.test(st.say) ? 'Q' : 'P';
        if (want !== got || (st.role === 'data' && st.chunk !== want)) { bad++; if (bad <= 3) t.ok(false, `RAID ${level} ${layout}, ${disks} disks: “${st.say}” should name ${want}`); }
      }
    }
  }
  t.ok(n > 5000 && bad === 0, `read-old messages checked against the layout: ${n}, wrong ${bad}`);
}
// the RAID 5 scene: every message, disk count, chunk and failed disk rebuilds exactly and reads back the message
{
  const V = load(['core', 'stage', 'demo'], { vm: true }), sc = V.Demo.byId('raid5');
  for (let msg = 0; msg < 4; msg++) for (const disks of [4, 5]) for (let chunk = 1; chunk <= 4; chunk++) for (let fail = 0; fail < disks; fail++) {
    const r = sc.run({ msg, disks, chunk, fail });
    t.ok(r.exact && String.fromCharCode(...r.back.bytes) === r.msg && String.fromCharCode(...r.degraded.bytes) === r.msg, `raid5 scene ${msg}/${disks}/${chunk}/${fail}`);
  }
}
t.done();
