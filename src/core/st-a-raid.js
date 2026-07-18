// RAID 0, 1, 1+0, 4, 5 and 6 over real bytes. An array is n disks, each a byte array of `stripes` chunks of `chunk`
// bytes. The array's logical bytes are cut into chunks and laid out stripe by stripe:
//   RAID 0   chunk c on disk c mod n, stripe ⌊c / n⌋; no redundancy
//   RAID 1   every disk holds the same chunks (mirrors); chunk c is stripe c
//   RAID 10  (1+0) the disks form n / m mirror groups of m (copies, default 2); chunks stripe across the groups
//            and every disk of a group holds the same chunk
//   RAID 4   n − 1 data disks; the last disk holds each stripe's parity
//   RAID 5   the parity P rotates round the disks
//   RAID 6   P and a second parity Q, Q = ⊕ g^k · D_k in GF(2⁸) (src/core/st-b-gf.js), on the disk after P
// Layouts for RAID 5 and 6 (layout option):
//   left-symmetric (default)  P on disk n − 1 − (s mod n); the data starts just after the parity and wraps round
//   left-asymmetric           P as left; the data fills the other disks in disk order
//   right-symmetric           P on disk s mod n; the data starts just after the parity and wraps round
//   right-asymmetric          P as right; the data fills the other disks in disk order
// P is the XOR of the stripe's data chunks, byte by byte; any one lost chunk is the XOR of all the others.
// API (A is the array; every step is {kind, say, ...}):
//   R.create({level, disks, chunk, stripes, layout, copies}) -> A
//   R.width(A) data chunks per stripe; R.capacity(A) bytes; R.tolerance(A) disks that may fail, guaranteed
//   R.parityDisk(A, s), R.qDisk(A, s) -> disk or −1; R.dataDisks(A, s) -> disks of the data chunks in order
//   R.copies(A, s, k) -> every disk holding data chunk k of stripe s
//   R.map(A, c) -> {stripe, k, disk, parity, q, copies}; R.role(A, s, d) -> {role: data|mirror|parity|q, chunk}
//   R.layoutTable(A) -> [[{disk, role, chunk}] per stripe]  (for drawing a stripe grid)
//   R.write(A, offset, bytes|string, {method: 'auto'|'rmw'|'rcw'}) -> {steps, reads, writes, stripes: [{stripe,
//       method: 'full'|'rmw'|'rcw'|'degraded'|'mirror'|'plain', reads, writes, rmwReads, rcwReads}]}
//       steps: method, read-old, data, parity, q, skip. A full stripe needs no reads; a partial one reads either the
//       old data and parity (read-modify-write) or the rest of the stripe (reconstruct-write), whichever is fewer.
//   R.read(A, offset, len) -> {bytes, steps: read | rebuild-read}
//   R.fail(A, d) -> step; R.rebuild(A, d | [d1, d2]) -> {steps: [{kind: 'rebuild', stripe, disk, disks, role,
//       bytes, chunks: [{disk, role, chunk, bytes}], from, how, say}]}
//   R.stripe(A, s, lost?) -> the stripe's logical data, P and Q, recovered if disks are lost: {data, p, q, how, from}
//   R.xor(list, len), R.xorBits(bytes) (one byte's XOR worked bit by bit), R.clone(A), R.hex(v)
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const R = (S.Raid = S.Raid || {});
  const hex = (v) => v.toString(16).padStart(2, '0');
  R.hex = hex;
  R.levels = [0, 1, 10, 4, 5, 6];
  R.layouts = ['left-symmetric', 'left-asymmetric', 'right-symmetric', 'right-asymmetric'];
  const MIN = { 0: 2, 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 };
  const range = (n) => Array.from({ length: n }, (_, k) => k);
  const hexes = (u) => [...u].map(hex).join(' ');

  R.create = function (o) {
    const a = Object.assign({ level: 5, disks: 4, chunk: 4, stripes: 4, layout: 'left-symmetric', copies: 2 }, o || {});
    if (!R.levels.includes(a.level)) throw new Error('RAID level must be 0, 1, 10, 4, 5 or 6');
    if (a.disks < MIN[a.level]) throw new Error('RAID ' + a.level + ' needs at least ' + MIN[a.level] + ' disks');
    if (!R.layouts.includes(a.layout)) throw new Error('unknown layout ' + a.layout);
    let m = a.level === 1 ? a.disks : a.level === 10 ? a.copies : 1;
    if (a.level === 10 && (m < 2 || a.disks % m || a.disks / m < 2)) throw new Error('RAID 10 needs at least two mirror groups of ' + m + ' disks');
    return { level: a.level, n: a.disks, chunk: a.chunk, stripes: a.stripes, layout: a.layout, m, disk: range(a.disks).map(() => new Uint8Array(a.chunk * a.stripes)), failed: new Set() };
  };
  /** data chunks per stripe */
  R.width = (A) => ({ 0: A.n, 1: 1, 10: A.n / A.m, 4: A.n - 1, 5: A.n - 1, 6: A.n - 2 })[A.level];
  R.capacity = (A) => R.width(A) * A.chunk * A.stripes;
  R.tolerance = (A) => ({ 0: 0, 1: A.n - 1, 10: A.m - 1, 4: 1, 5: 1, 6: 2 })[A.level];
  const nPar = (A) => (A.level === 6 ? 2 : A.level === 4 || A.level === 5 ? 1 : 0);
  /** the disk holding stripe s's parity P, or -1 */
  R.parityDisk = function (A, s) {
    if (A.level === 4) return A.n - 1;
    if (A.level !== 5 && A.level !== 6) return -1;
    return A.layout.startsWith('left') ? A.n - 1 - (s % A.n) : s % A.n;
  };
  /** the disk holding stripe s's Q parity (RAID 6), or -1 */
  R.qDisk = (A, s) => (A.level === 6 ? (R.parityDisk(A, s) + 1) % A.n : -1);
  /** the disks holding stripe s's data chunks, in logical order */
  R.dataDisks = function (A, s) {
    if (A.level === 0) return range(A.n);
    if (A.level === 1) return [0];
    if (A.level === 10) return range(A.n / A.m).map((g) => g * A.m);
    if (A.level === 4) return range(A.n - 1);
    const p = R.parityDisk(A, s), q = R.qDisk(A, s), w = R.width(A);
    if (A.layout.endsWith('asymmetric')) return range(A.n).filter((d) => d !== p && d !== q);
    const start = (A.level === 6 ? q : p) + 1;
    return range(w).map((k) => (start + k) % A.n);
  };
  R.copies = function (A, s, k) {
    if (A.level === 1) return range(A.n);
    if (A.level === 10) return range(A.m).map((j) => k * A.m + j);
    return [R.dataDisks(A, s)[k]];
  };
  /** where logical chunk c lives */
  R.map = function (A, c) { const w = R.width(A), s = Math.floor(c / w), k = c % w; return { stripe: s, k, disk: R.dataDisks(A, s)[k], parity: R.parityDisk(A, s), q: R.qDisk(A, s), copies: R.copies(A, s, k) }; };
  /** the role of disk d in stripe s: 'data' (with its logical chunk), 'parity', 'q' or 'mirror' */
  R.role = function (A, s, d) {
    if (A.level === 1) return { role: d === 0 ? 'data' : 'mirror', chunk: s };
    if (A.level === 10) return { role: d % A.m ? 'mirror' : 'data', chunk: s * R.width(A) + Math.floor(d / A.m) };
    if (d === R.parityDisk(A, s)) return { role: 'parity' };
    if (d === R.qDisk(A, s)) return { role: 'q' };
    return { role: 'data', chunk: s * R.width(A) + R.dataDisks(A, s).indexOf(d) };
  };
  R.layoutTable = (A) => range(A.stripes).map((s) => range(A.n).map((d) => Object.assign({ disk: d }, R.role(A, s, d))));

  const at = (A, d, s) => A.disk[d].subarray(s * A.chunk, (s + 1) * A.chunk);
  R.chunkAt = (A, d, s) => (A.failed.has(d) ? null : at(A, d, s).slice());
  R.xor = function (list, len) { const out = new Uint8Array(len); for (const u of list) for (let i = 0; i < len; i++) out[i] ^= u[i]; return out; };
  /** one byte's XOR worked bit by bit: {bytes, bits: [[b7..b0]..], out, outBits, ones: [count per column]} */
  R.xorBits = function (bytes) {
    const bits = bytes.map((v) => Array.from({ length: 8 }, (_, i) => (v >> (7 - i)) & 1));
    const out = bytes.reduce((a, b) => a ^ b, 0), outBits = Array.from({ length: 8 }, (_, i) => (out >> (7 - i)) & 1);
    const ones = outBits.map((_, i) => bits.reduce((n, r) => n + r[i], 0));
    return { bytes, bits, out, outBits, ones };
  };

  /** stripe s's logical data and parity, recovered around the lost disks: {data, p, q, how, from} */
  R.stripe = function (A, s, lost) {
    lost = lost || A.failed;
    const w = R.width(A), C = A.chunk;
    if (A.level === 0) {
      const d = R.dataDisks(A, s).find((x) => lost.has(x));
      if (d !== undefined) throw new Error('RAID 0 cannot recover disk ' + d);
      return { data: range(w).map((k) => at(A, k, s).slice()), p: null, q: null, how: 'direct', from: range(A.n) };
    }
    if (A.level === 1 || A.level === 10) {
      const from = [], data = range(w).map((k) => {
        const d = R.copies(A, s, k).find((x) => !lost.has(x));
        if (d === undefined) throw new Error(A.level === 1 ? 'every mirror has failed' : 'every copy of chunk ' + (s * w + k) + ' is lost');
        from.push(d); return at(A, d, s).slice();
      });
      return { data, p: null, q: null, how: from.some((d, k) => d !== R.copies(A, s, k)[0]) ? 'mirror' : 'direct', from };
    }
    const dd = R.dataDisks(A, s), p = R.parityDisk(A, s), q = R.qDisk(A, s);
    const gone = range(A.n).filter((d) => lost.has(d));
    if (A.level !== 6) {
      if (gone.length > 1) throw new Error('two disks have failed: stripe ' + s + ' is lost');
      const data = dd.map((d) => (lost.has(d) ? null : at(A, d, s).slice()));
      const k = data.indexOf(null), from = range(A.n).filter((d) => !lost.has(d));
      if (k >= 0) data[k] = R.xor(from.map((d) => at(A, d, s)), C);
      return { data, p: lost.has(p) ? R.xor(data, C) : at(A, p, s).slice(), q: null, how: gone.length ? 'xor' : 'direct', from };
    }
    if (gone.length > 2) throw new Error('three disks have failed: stripe ' + s + ' is lost');
    const r = S.GF.recover({ data: dd.map((d) => (lost.has(d) ? null : at(A, d, s))), p: lost.has(p) ? null : at(A, p, s), q: lost.has(q) ? null : at(A, q, s), len: C });
    const used = r.how === 'p' ? [p] : r.how === 'q' ? [q] : r.how === 'pq' ? [p, q] : [];
    const from = gone.length ? dd.filter((d) => !lost.has(d)).concat(used) : dd.concat([p, q]);
    return { data: r.data, p: r.p, q: r.q, how: gone.length ? r.how : 'direct', from, gf: r };
  };

  /** the logical contents of chunk k of stripe s, reconstructed if its disk has failed: {bytes, from, how} */
  function readChunk(A, s, k) {
    const cp = R.copies(A, s, k), d = cp[0];
    if (!A.failed.has(d)) return { bytes: at(A, d, s).slice(), from: [d], how: 'direct' };
    if (A.level === 1 || A.level === 10) {
      const m = cp.find((x) => !A.failed.has(x));
      if (m === undefined) throw new Error(A.level === 1 ? 'every mirror has failed' : 'every copy of chunk ' + (s * R.width(A) + k) + ' is lost');
      return { bytes: at(A, m, s).slice(), from: [m], how: 'mirror' };
    }
    if (A.level === 0) throw new Error('RAID 0 cannot recover disk ' + d);
    const X = R.stripe(A, s);
    return { bytes: X.data[k], from: X.from, how: 'xor', gf: X.how };
  }

  const toBytes = (data) => (typeof data === 'string' ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 255) : data);

  /** write bytes at a logical offset (see the header for the methods). Returns {steps, reads, writes, stripes} */
  R.write = function (A, offset, data, opt) {
    const bytes = toBytes(data), want = (opt && opt.method) || 'auto';
    if (offset + bytes.length > R.capacity(A)) throw new Error('beyond the array');
    const steps = [], stripes = [], w = R.width(A), C = A.chunk, per = w * C, end = offset + bytes.length, np = nPar(A);
    let reads = 0, writes = 0;
    const s0 = Math.floor(offset / per), s1 = Math.floor((end - 1) / per);
    for (let s = s0; s <= s1 && bytes.length; s++) {
      const r0 = reads, w0 = writes;
      const ks = range(w).map((k) => { const lo = s * per + k * C, hi = lo + C; return { k, lo, touched: lo < end && hi > offset, whole: lo >= offset && hi <= end }; });
      const T = ks.filter((x) => x.touched), partial = T.filter((x) => !x.whole).length;
      const patch = (x, c) => { for (let i = Math.max(x.lo, offset); i < Math.min(x.lo + C, end); i++) c[i - x.lo] = bytes[i - offset]; return c; };
      const readOld = (d, role, k) => { reads++; const b = at(A, d, s).slice(); steps.push({ kind: 'read-old', stripe: s, disk: d, role, k, chunk: role === 'data' ? s * w + k : undefined, bytes: [...b], say: `Read the old ${role === 'data' ? 'chunk ' + (s * w + k) : role === 'q' ? 'Q' : 'parity'} of stripe ${s} from disk ${d}: ${hexes(b)}.` }); return b; };
      const put = (d, role, c, k) => {
        if (A.failed.has(d)) { steps.push({ kind: 'skip', stripe: s, disk: d, k, say: role === 'data' ? `Disk ${d} has failed: chunk ${s * w + k} cannot be written there${np ? ', but the parity will still cover it' : ''}.` : `The ${role === 'q' ? 'Q' : 'parity'} disk of stripe ${s}, disk ${d}, has failed: no ${role === 'q' ? 'Q' : 'parity'} is written.` }); return; }
        at(A, d, s).set(c); writes++;
        if (role === 'data') steps.push({ kind: 'data', stripe: s, disk: d, k, chunk: s * w + k, bytes: [...c], say: `Chunk ${s * w + k} (${hexes(c)}) goes to disk ${d}, stripe ${s}${(A.level === 1 || A.level === 10) && d !== R.copies(A, s, k)[0] ? ', a mirror copy' : ''}.` });
        else if (role === 'parity') steps.push({ kind: 'parity', stripe: s, disk: d, from: R.dataDisks(A, s), bytes: [...c], say: `Parity of stripe ${s} on disk ${d}: the XOR of its ${w} data chunks, ${hexes(c)}.` });
        else steps.push({ kind: 'q', stripe: s, disk: d, from: R.dataDisks(A, s), bytes: [...c], say: `Q of stripe ${s} on disk ${d}: ⊕ g^k · D_k over its ${w} data chunks in GF(2⁸), ${hexes(c)}.` });
      };
      const rmwReads = np ? T.length + np : 0, rcwReads = np ? w - T.length + partial : 0;
      let method;
      if (!np) {
        method = A.level === 0 ? 'plain' : 'mirror';
        for (const x of T) {
          let c = new Uint8Array(C);
          if (!x.whole) { const r = readChunk(A, s, x.k); reads++; c = r.bytes; steps.push({ kind: 'read-old', stripe: s, disk: r.from[0], role: 'data', k: x.k, chunk: s * w + x.k, bytes: [...c], say: `Read chunk ${s * w + x.k} from disk ${r.from[0]} to patch part of it.` }); }
          patch(x, c);
          for (const d of R.copies(A, s, x.k)) put(d, 'data', c, x.k);
        }
      } else {
        const dd = R.dataDisks(A, s), pd = R.parityDisk(A, s), qd = R.qDisk(A, s);
        const degraded = [...dd, pd, qd].some((d) => d >= 0 && A.failed.has(d));
        method = T.length === w && !partial ? 'full' : degraded ? 'degraded' : want === 'rmw' || want === 'rcw' ? want : rmwReads < rcwReads ? 'rmw' : 'rcw';
        steps.push({ kind: 'method', stripe: s, method, rmwReads, rcwReads, say: method === 'full' ? `Stripe ${s} is written whole: its parity comes from the new data alone, with no reads.` : method === 'degraded' ? `Stripe ${s} has a failed disk: its data is rebuilt from the survivors, patched, and its parity computed again.` : method === 'rmw' ? `Stripe ${s}, read-modify-write: read the ${T.length} old chunk${T.length === 1 ? '' : 's'} and the old parity (${pl(rmwReads, 'read')}) rather than the ${rcwReads} the reconstruct-write needs.` : `Stripe ${s}, reconstruct-write: read the ${rcwReads} chunk${rcwReads === 1 ? '' : 's'} of the stripe not wholly overwritten (${pl(rcwReads, 'read')}, against ${rmwReads} for read-modify-write).` });
        let cur, P, Q;
        if (method === 'full') cur = T.map((x) => patch(x, new Uint8Array(C)));
        else if (method === 'degraded') {
          const X = R.stripe(A, s); reads += X.from.length;
          steps.push({ kind: 'read-old', stripe: s, disks: X.from, say: `Read disks ${X.from.join(', ')} of stripe ${s} to rebuild what the failed disk held.` });
          cur = X.data; for (const x of T) patch(x, cur[x.k]);
        } else if (method === 'rcw') {
          cur = ks.map((x) => (x.touched && x.whole ? new Uint8Array(C) : readOld(dd[x.k], 'data', x.k)));
          for (const x of T) patch(x, cur[x.k]);
        } else {
          const olds = T.map((x) => readOld(dd[x.k], 'data', x.k));
          P = readOld(pd, 'parity'); if (np === 2) Q = readOld(qd, 'q');
          cur = [];
          T.forEach((x, j) => {
            const nw = patch(x, olds[j].slice()), gk = np === 2 ? S.GF.gpow(x.k) : 0;
            for (let i = 0; i < C; i++) { const dlt = olds[j][i] ^ nw[i]; P[i] ^= dlt; if (np === 2) Q[i] ^= S.GF.mul(gk, dlt); }
            cur[x.k] = nw;
          });
        }
        for (const x of T) put(dd[x.k], 'data', cur[x.k], x.k);
        if (method !== 'rmw') { const pq = np === 2 ? S.GF.pq(cur, C) : { p: R.xor(cur, C) }; P = pq.p; Q = pq.q; }
        put(pd, 'parity', P);
        if (np === 2) put(qd, 'q', Q);
      }
      stripes.push({ stripe: s, method, reads: reads - r0, writes: writes - w0, rmwReads, rcwReads });
    }
    return { steps, reads, writes, stripes };
  };

  /** read len bytes from a logical offset, reconstructing chunks of a failed disk: {bytes, steps} */
  R.read = function (A, offset, len) {
    const out = new Uint8Array(len), steps = [];
    for (let i = 0; i < len;) {
      const pos = offset + i, c = Math.floor(pos / A.chunk), m = R.map(A, c), r = readChunk(A, m.stripe, m.k), lo = pos % A.chunk, take = Math.min(A.chunk - lo, len - i);
      out.set(r.bytes.subarray(lo, lo + take), i);
      steps.push({ kind: r.how === 'direct' ? 'read' : 'rebuild-read', chunk: c, stripe: m.stripe, disk: m.disk, from: r.from, bytes: [...r.bytes], say: r.how === 'direct' ? `Chunk ${c} is read from disk ${m.disk}.` : r.how === 'mirror' ? `Disk ${m.disk} has failed: chunk ${c} is read from its mirror, disk ${r.from[0]}.` : `Disk ${m.disk} has failed: chunk ${c} is ${r.gf === 'q' || r.gf === 'pq' ? 'solved in GF(2⁸) from' : 'the XOR of'} disks ${r.from.join(', ')} in stripe ${m.stripe}.` });
      i += take;
    }
    return { bytes: out, steps };
  };

  /** a disk fails: its contents are gone */
  R.fail = function (A, d) { A.failed.add(d); A.disk[d] = new Uint8Array(A.chunk * A.stripes); return { kind: 'fail', disk: d, say: `Disk ${d} fails: everything on it is lost.` }; };

  /** rebuild one disk, or two at once on RAID 6, onto fresh disks, stripe by stripe: {steps} */
  R.rebuild = function (A, which) {
    const list = Array.isArray(which) ? [...new Set(which)] : [which];
    if (A.level === 0) throw new Error('RAID 0 has no redundancy to rebuild from');
    const lost = new Set([...A.failed, ...list]);
    if (A.level !== 6 && A.level !== 1 && A.level !== 10 && lost.size > 1) throw new Error('another disk has failed too');
    if (A.level === 1 && lost.size >= A.n) throw new Error('another disk has failed too');
    if (A.level === 6 && lost.size > 2) throw new Error('more than two disks have failed');
    const steps = [], fresh = list.map(() => new Uint8Array(A.chunk * A.stripes));
    for (let s = 0; s < A.stripes; s++) {
      const X = R.stripe(A, s, lost);
      const chunks = list.map((d, j) => {
        const r = R.role(A, s, d), c = r.role === 'parity' ? X.p : r.role === 'q' ? X.q : X.data[A.level === 10 ? Math.floor(d / A.m) : A.level === 1 ? 0 : R.dataDisks(A, s).indexOf(d)];
        fresh[j].set(c, s * A.chunk);
        return { disk: d, role: r.role, chunk: r.chunk, bytes: [...c] };
      });
      const c0 = chunks[0], from = X.from.filter((d) => !list.includes(d));
      const name = (c) => (c.role === 'parity' ? 'parity' : c.role === 'q' ? 'Q' : 'chunk ' + c.chunk);
      let say;
      if (A.level === 1 || A.level === 10) say = `Stripe ${s}: copy ${list.length > 1 ? 'the chunks' : 'the chunk'} from disk ${from.join(', ')}.`;
      else if (A.level !== 6) say = `Stripe ${s}: the lost ${name(c0)} is the XOR of disks ${from.join(', ')}: ${hexes(c0.bytes)}.`;
      else say = `Stripe ${s}: ${chunks.map((c) => 'disk ' + c.disk + ' held ' + name(c)).join(', ')}. ` + (X.gf ? X.gf.say : '');
      steps.push({ kind: 'rebuild', stripe: s, disk: c0.disk, disks: list, role: c0.role, bytes: c0.bytes, chunks, from, how: X.how, say });
    }
    list.forEach((d, j) => { A.disk[d] = fresh[j]; A.failed.delete(d); });
    return { steps };
  };
  R.clone = (A) => Object.assign({}, A, { disk: A.disk.map((u) => u.slice()), failed: new Set(A.failed) });
  (S.engines = S.engines || []).push({ name: 'RAID 0, 1, 1+0, 4, 5 and 6' });
})(globalThis.Proses = globalThis.Proses || {});
