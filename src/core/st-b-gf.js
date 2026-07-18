// Arithmetic in GF(2⁸), the field RAID 6 computes its Q parity in, and the P + Q recovery of up to two lost chunks.
// The field's 256 elements are bytes. Addition is XOR. Multiplication is polynomial multiplication of the bits
// reduced modulo x⁸ + x⁴ + x³ + x² + 1 (0x11d); the generator g = 2 (the polynomial x) has order 255, so every
// nonzero byte is g^k for exactly one k in 0..254, and the log and exp tables turn a product into a sum of logs.
//   S.GF.poly                            0x11d
//   S.GF.exp[k] = g^k (k = 0..509), S.GF.log[a] (a = 1..255)
//   S.GF.add(a, b), mul(a, b), div(a, b), inv(a), pow(a, k), gpow(k) = g^k (k may be negative)
//   S.GF.xtime(a)                        a · g: shift left, and XOR 0x1d when a bit falls off the top
//   S.GF.mulBits(a, b) -> {a, b, rows: [{i, bit, term, acc, carry}], out}   shift-and-add worked bit by bit:
//       row i doubles the term (a · g^i, reduced when it carries) and adds it into acc when bit i of b is 1
//   S.GF.pq(chunks, len) -> {p, q}       P = ⊕ D_k and Q = ⊕ g^k · D_k over the data chunks D_0 .. D_{w−1}
//   S.GF.recover({data: [Uint8Array | null], p, q, len}) -> {data, p, q, how, lost, work, say}
//       null marks a lost chunk (at most two in all). how: 'none' (nothing lost), 'recompute' (only parity lost),
//       'p' (one data chunk, from P), 'q' (one data chunk and P lost, from Q), 'pq' (two data chunks from P and Q).
//       work: the arithmetic for byte 0 with the names used in the say.
// Two lost data chunks x < y: with Pxy = P ⊕ (the other data) and Qxy = Q ⊕ (⊕ g^k D_k over the other data),
//   D_x ⊕ D_y = Pxy and g^x D_x ⊕ g^y D_y = Qxy, so D_x = (Qxy ⊕ g^y · Pxy) / (g^x ⊕ g^y) and D_y = Pxy ⊕ D_x.
(function (S) {
  'use strict';
  const G = (S.GF = S.GF || {});
  G.poly = 0x11d;
  const exp = new Uint8Array(510), log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= G.poly; }
  for (let i = 255; i < 510; i++) exp[i] = exp[i - 255];
  G.exp = exp; G.log = log;
  const hex = (v) => v.toString(16).padStart(2, '0');

  G.add = (a, b) => a ^ b;
  G.mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
  G.inv = function (a) { if (!a) throw new Error('0 has no inverse in GF(2⁸)'); return exp[(255 - log[a]) % 255]; };
  G.div = function (a, b) { if (!b) throw new Error('division by 0 in GF(2⁸)'); return a ? exp[(log[a] + 255 - log[b]) % 255] : 0; };
  G.gpow = (k) => exp[((k % 255) + 255) % 255];
  G.pow = (a, k) => (a === 0 ? (k === 0 ? 1 : 0) : exp[(((log[a] * k) % 255) + 255) % 255]);
  G.xtime = (a) => ((a << 1) ^ (a & 0x80 ? G.poly : 0)) & 0xff;

  G.mulBits = function (a, b) {
    const rows = [];
    let term = a, acc = 0;
    for (let i = 0; i < 8; i++) {
      const bit = (b >> i) & 1;
      if (bit) acc ^= term;
      const next = G.xtime(term);
      rows.push({ i, bit, term, acc, carry: !!(term & 0x80) });
      term = next;
    }
    return { a, b, rows, out: acc, say: `${hex(a)} · ${hex(b)} = ${hex(acc)}: add a · gⁱ for each 1 bit i of ${hex(b)}, doubling a each row and folding 0x1d back in when a bit carries out of the top.` };
  };

  G.pq = function (chunks, len) {
    const p = new Uint8Array(len), q = new Uint8Array(len);
    chunks.forEach((c, k) => { const gk = G.gpow(k); for (let i = 0; i < len; i++) { p[i] ^= c[i]; q[i] ^= G.mul(gk, c[i]); } });
    return { p, q };
  };

  G.recover = function (o) {
    const len = o.len, w = o.data.length, data = o.data.map((c) => (c ? Uint8Array.from(c) : null));
    const lostData = data.map((c, k) => (c ? -1 : k)).filter((k) => k >= 0);
    let p = o.p ? Uint8Array.from(o.p) : null, q = o.q ? Uint8Array.from(o.q) : null;
    const lost = lostData.map((k) => 'D' + k).concat(p ? [] : ['P'], q ? [] : ['Q']);
    if (lost.length > 2) throw new Error('three chunks of one stripe are lost (' + lost.join(', ') + '): RAID 6 cannot recover them');
    let how = 'none', work = null, say;
    // the sums over the data chunks we still have
    const sums = () => {
      const px = new Uint8Array(len), qx = new Uint8Array(len);
      data.forEach((c, k) => { if (!c) return; const gk = G.gpow(k); for (let i = 0; i < len; i++) { px[i] ^= c[i]; qx[i] ^= G.mul(gk, c[i]); } });
      return { px, qx };
    };
    if (lostData.length === 1 && p) {
      const x = lostData[0], { px } = sums(), d = new Uint8Array(len);
      for (let i = 0; i < len; i++) d[i] = p[i] ^ px[i];
      data[x] = d; how = 'p';
      work = { x, P: p[0], sum: px[0], out: d[0] };
      say = `D${x} = P ⊕ the other data chunks: byte 0 is ${hex(p[0])} ⊕ ${hex(px[0])} = ${hex(d[0])}.`;
    } else if (lostData.length === 1) {
      const x = lostData[0], { qx } = sums(), d = new Uint8Array(len), gix = G.gpow(-x);
      for (let i = 0; i < len; i++) d[i] = G.mul(q[i] ^ qx[i], gix);
      data[x] = d; how = 'q';
      work = { x, Q: q[0], sum: qx[0], ginv: gix, out: d[0] };
      say = `P is lost too, so D${x} comes from Q: D${x} = (Q ⊕ ⊕ g^k D_k over the rest) · g^−${x}; byte 0 is (${hex(q[0])} ⊕ ${hex(qx[0])}) · ${hex(gix)} = ${hex(d[0])}.`;
    } else if (lostData.length === 2) {
      const [x, y] = lostData, { px, qx } = sums(), dx = new Uint8Array(len), dy = new Uint8Array(len);
      const gx = G.gpow(x), gy = G.gpow(y), den = gx ^ gy;
      for (let i = 0; i < len; i++) {
        const pxy = p[i] ^ px[i], qxy = q[i] ^ qx[i];
        dx[i] = G.div(qxy ^ G.mul(gy, pxy), den); dy[i] = pxy ^ dx[i];
      }
      data[x] = dx; data[y] = dy; how = 'pq';
      const pxy = p[0] ^ px[0], qxy = q[0] ^ qx[0];
      work = { x, y, Pxy: pxy, Qxy: qxy, gx, gy, den, outX: dx[0], outY: dy[0] };
      say = `Two data chunks, D${x} and D${y}, are lost: with Pxy = ${hex(pxy)} and Qxy = ${hex(qxy)} in byte 0, D${x} = (Qxy ⊕ g^${y}·Pxy) / (g^${x} ⊕ g^${y}) = ${hex(dx[0])} and D${y} = Pxy ⊕ D${x} = ${hex(dy[0])}.`;
    }
    const fresh = G.pq(data, len);
    if (!p || !q) {
      if (how === 'none') how = 'recompute';
      const re = [!p ? 'P' : '', !q ? 'Q' : ''].filter(Boolean).join(' and ');
      say = (say ? say + ' ' : '') + `${re} ${re.length > 1 ? 'are' : 'is'} computed again from the data.`;
      p = p || fresh.p; q = q || fresh.q;
    }
    if (!say) say = 'Nothing in the stripe is lost.';
    return { data, p, q, how, lost, work, say };
  };
})(globalThis.Proses = globalThis.Proses || {});
