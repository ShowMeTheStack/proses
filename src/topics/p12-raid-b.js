// Part 12, RAID (2): parity computed bit by bit, and a small write on RAID 4 or 5 with its extra reads
// (read-modify-write against reconstruct-write), and the cost of a write by how much of a stripe it covers.
// The array, its bytes and every step come from the RAID engine (src/core/st-a-raid.js, st-c-raidcalc.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const hex = (v) => v.toString(16).padStart(2, '0');
  const ch = (v) => (v === 32 ? '␣' : v >= 33 && v < 127 ? String.fromCharCode(v) : '·');
  const hexes = (u) => [...u].map(hex).join(' ');
  const chars = (u) => [...u].map(ch).join('');
  S.T12.hex = hex; S.T12.hexes = hexes; S.T12.chars = chars; S.T12.ch = ch;

  /** a stripe grid of real bytes: cell(s, d) -> {bytes, role}; o.cls(s, d) extra classes */
  function byteGrid(o) {
    const n = o.n;
    return S.Kit.disk.grid({
      prefix: o.prefix, x: o.x, y: o.y, n, rows: o.rows, cw: o.cw, ch: 46, gap: 6, rowHeadW: 74, size: 13,
      head: (d) => ({ text: 'disk ' + d + (o.failed && o.failed.includes(d) ? ' ✕' : ''), cls: o.failed && o.failed.includes(d) ? 'dead' : 'strong' }),
      rowHead: (s) => 'stripe ' + s,
      cell: (s, d) => {
        const c = o.cell(s, d), extra = o.cls ? o.cls(s, d) || '' : '';
        if (c.lost) return { lines: ['lost'], cls: 'rd-lost ' + extra };
        const par = c.role === 'parity' || c.role === 'q';
        return { lines: [par ? (c.role === 'q' ? 'Q' : 'P') : chars(c.bytes), hexes(c.bytes)], cls: (par ? 'rd-par' + (c.role === 'q' ? ' q' : '') : c.role === 'mirror' ? 'rd-data mirror' : 'rd-data') + ' ' + extra };
      },
    });
  }
  S.T12.byteGrid = byteGrid;
  /** a bit table XORing bytes, with a result row */
  function bitTable(prefix, x, y, rows, res, resLabel) {
    const Rd = S.Raid, xb = Rd.xorBits(rows.map((r) => r.v));
    const list = rows.map((r, i) => ({ label: (i ? '⊕ ' : '') + r.label, bits: Rd.xorBits([r.v]).bits[0], hex: hex(r.v), cls: r.cls || '' }));
    list.push({ label: '= ' + resLabel, bits: xb.outBits, hex: hex(xb.out), cls: 'res' });
    const hot = new Set(xb.outBits.map((b, i) => (b ? i : -1)).filter((i) => i >= 0));
    return Object.assign(S.Kit.disk.bits({ prefix, x, y, rows: list, rule: list.length - 1, labelW: 150, bw: 30, rh: 30, size: 14, hot }), { xb });
  }
  S.T12.bitTable = bitTable;

  // =================================================================================================================
  S.topic({
    id: 'raid-write', family: 'p12-raid', order: 20, title: 'Parity bit by bit, and the small write',
    blurb: 'Parity is the XOR of a stripe’s data chunks: each bit is 1 when the column holds an odd number of 1s. Writing a whole stripe needs no reads. Writing one chunk does: either read the old chunk and the old parity (P_new = P_old ⊕ D_old ⊕ D_new), or read every other chunk of the stripe and XOR again. That is the small-write penalty.',
    inputs: [
      { id: 'level', kind: 'choice', label: 'level', def: '5', options: [{ value: '4', label: 'RAID 4' }, { value: '5', label: 'RAID 5' }] },
      { id: 'disks', kind: 'number', label: 'disks', def: 5, min: 3, max: 6 },
      { id: 'chunk', kind: 'number', label: 'chunk (bytes)', def: 2, min: 1, max: 4 },
      { id: 'data', kind: 'string', spaces: true, label: 'the data already there', def: 'SEND MORE COAL TO THE MILL', min: 1, max: 40 },
      { id: 'offset', kind: 'number', label: 'then write at byte', def: 4, min: 0, max: 200 },
      { id: 'text', kind: 'string', spaces: true, label: 'these bytes', def: 'MI', min: 1, max: 24 },
      { id: 'method', kind: 'choice', label: 'parity update', def: 'auto', options: [{ value: 'auto', label: 'whichever reads less' }, { value: 'rmw', label: 'read-modify-write' }, { value: 'rcw', label: 'reconstruct-write' }] },
    ],
    check(inp) { const per = (inp.disks - 1) * inp.chunk, len = Math.max(inp.data.length, inp.offset + inp.text.length); if (Math.ceil(len / per) > 5) return 'the data and the write must fit in 5 stripes of ' + per + ' bytes'; return null; },
    presets: [
      { label: 'One chunk: read-modify-write', values: { level: '5', disks: 5, chunk: 2, data: 'SEND MORE COAL TO THE MILL', offset: 4, text: 'MI', method: 'auto' } },
      { label: 'The same, reconstruct-write', values: { level: '5', disks: 5, chunk: 2, data: 'SEND MORE COAL TO THE MILL', offset: 4, text: 'MI', method: 'rcw' } },
      { label: 'Most of a wide stripe', values: { level: '5', disks: 6, chunk: 1, data: 'LAMP OIL, ROPE', offset: 0, text: 'BOMB', method: 'auto' } },
      { label: 'A whole stripe: no reads', values: { level: '5', disks: 4, chunk: 2, data: 'SEND MORE COAL!!', offset: 6, text: 'TO THE', method: 'auto' } },
      { label: 'RAID 4: every write hits disk 3', values: { level: '4', disks: 4, chunk: 2, data: 'ABCDEFGHIJKLMNOPQR', offset: 8, text: 'zz', method: 'auto' } },
      { label: 'One byte, chunks of 4', values: { level: '5', disks: 5, chunk: 4, data: 'PACK THE TRUNK BY NOON', offset: 9, text: 'r', method: 'auto' } },
    ],
    counters: [{ id: 'reads', label: 'disk reads' }, { id: 'writes', label: 'disk writes' }],
    run(inp) {
      const t = T(), Rd = S.Raid, L = +inp.level, n = inp.disks, C = inp.chunk, w = n - 1, per = w * C;
      const len = Math.max(inp.data.length, inp.offset + inp.text.length), stripes = Math.ceil(len / per);
      const A = Rd.create({ level: L, disks: n, chunk: C, stripes });
      const init = new Uint8Array(stripes * per).fill(32);
      for (let i = 0; i < inp.data.length; i++) init[i] = inp.data.charCodeAt(i) & 255;
      Rd.write(A, 0, init);
      const before = Rd.clone(A);
      const wr = Rd.write(A, inp.offset, inp.text, { method: inp.method });
      const after = A;
      const F = new S.Frames(['reads', 'writes']);
      const cw = Math.min(118, Math.floor((700 - 74) / n) - 6), GX = 10, gh = 30 + stripes * 52, BY = gh + 30;
      const roleOf = (s, d) => Rd.role(before, s, d);
      const bytesOf = (Aa, s, d) => Aa.disk[d].subarray(s * C, (s + 1) * C);
      const written = new Set();
      const g = (cls) => byteGrid({ prefix: 'rw:g', x: GX, y: 0, n, rows: stripes, cw, cell: (s, d) => ({ bytes: written.has(s + ':' + d) ? bytesOf(after, s, d) : bytesOf(before, s, d), role: roleOf(s, d).role }), cls }).items;
      const sw = Rd.smallWrite({ level: L, disks: n, chunks: 1 });
      // 0: the array as it stands, 1: stripe 0's parity byte 0 bit by bit
      const p0 = Rd.parityDisk(before, 0), d0 = Rd.dataDisks(before, 0);
      F.add({ items: g(), say: `RAID ${L} on ${n} disks with ${C}-byte chunks holds “${inp.data}”: each stripe has ${w} data chunks and a parity chunk${L === 4 ? ', always on disk ' + (n - 1) : ' that moves one disk left each stripe'}.`, meta: { phase: 'start', n, w, C, L, last: n - 1 } });
      {
        const rows = d0.map((d) => ({ label: 'disk ' + d + ' ‘' + ch(bytesOf(before, 0, d)[0]) + '’', v: bytesOf(before, 0, d)[0] }));
        const bt = bitTable('rw:bt', GX, BY, rows, null, 'P on disk ' + p0);
        F.add({ items: [...g((s, d) => (s === 0 ? (d === p0 ? 'act' : 'src') : '')), t.title('rw:btt', GX, BY - 10, 'stripe 0, byte 0 of the parity'), ...bt.items], title: 'parity bit by bit', say: `Byte 0 of stripe 0’s parity: ${rows.map((r) => hex(r.v)).join(' ⊕ ')} = ${hex(bt.xb.out)}. A column gives 1 when it holds an odd number of 1s (counts ${bt.xb.ones.join(', ')}), so any one lost byte is the XOR of the rest.`, meta: { phase: 'bits', vals: rows.map((r) => r.v), out: bt.xb.out, ones: bt.xb.ones, hexs: rows.map((r) => hex(r.v)).concat([hex(bt.xb.out)]) } });
      }
      // the write, step by step
      let reads = 0, writes = 0, oldP = null, oldD = {}, stripeNow = null;
      const firstS = Math.floor(inp.offset / per), lastS = Math.floor((inp.offset + inp.text.length - 1) / per);
      F.add({ items: g((s) => (s >= firstS && s <= lastS ? 'src' : '')), title: 'the write', say: `Now write “${inp.text}” at byte ${inp.offset}: ${t.plural(inp.text.length, 'byte')}, touching stripe${firstS === lastS ? ' ' + firstS : 's ' + firstS + ' to ' + lastS}. On this array one chunk alone costs ${sw.rmw.ios} I/Os by read-modify-write or ${sw.rcw.ios} by reconstruct-write.`, meta: { phase: 'write', firstS, lastS, sw, len: inp.text.length } });
      wr.steps.forEach((st) => {
        let say = st.say, cls = () => '', extra = [], meta = { phase: st.kind, step: st };
        if (st.kind === 'method') { stripeNow = st.stripe; oldP = null; oldD = {}; const sm = wr.stripes.find((x) => x.stripe === st.stripe); meta.sm = sm; meta.nOld = st.rmwReads - 1; cls = (s) => (s === st.stripe ? 'src' : ''); }
        if (st.kind === 'read-old') { reads++; if (st.role === 'parity') oldP = st.bytes; else oldD[st.k] = st.bytes; cls = (s, d) => (s === st.stripe && d === st.disk ? 'act' : ''); }
        if (st.kind === 'data') { writes++; written.add(st.stripe + ':' + st.disk); cls = (s, d) => (s === st.stripe && d === st.disk ? 'act' : ''); }
        if (st.bytes) meta.hx = [...st.bytes].map(hex);
        if (st.kind === 'parity') {
          writes++; written.add(st.stripe + ':' + st.disk);
          cls = (s, d) => (s === st.stripe && d === st.disk ? 'act' : s === st.stripe ? 'src' : '');
          const sm = wr.stripes.find((x) => x.stripe === st.stripe);
          let rows;
          if (sm.method === 'rmw' && oldP) {
            const ks = Object.keys(oldD).map(Number);
            rows = [{ label: 'old parity', v: oldP[0], cls: 'par' }];
            for (const k of ks) { const dd = Rd.dataDisks(before, st.stripe)[k]; rows.push({ label: 'old disk ' + dd + ' ‘' + ch(oldD[k][0]) + '’', v: oldD[k][0] }, { label: 'new disk ' + dd + ' ‘' + ch(bytesOf(after, st.stripe, dd)[0]) + '’', v: bytesOf(after, st.stripe, dd)[0] }); }
            say = `New parity by read-modify-write: P_new = P_old ⊕ D_old ⊕ D_new for every chunk changed. Byte 0: ${rows.map((r) => hex(r.v)).join(' ⊕ ')} = ${hex(st.bytes[0])}; the whole chunk is ${hexes(st.bytes)}, on disk ${st.disk}.`;
          } else {
            rows = Rd.dataDisks(before, st.stripe).map((dd) => ({ label: 'disk ' + dd + ' ‘' + ch(bytesOf(after, st.stripe, dd)[0]) + '’', v: bytesOf(after, st.stripe, dd)[0] }));
            say = `New parity as the XOR of the stripe’s data as it now stands. Byte 0: ${rows.map((r) => hex(r.v)).join(' ⊕ ')} = ${hex(st.bytes[0])}; the whole chunk is ${hexes(st.bytes)}, on disk ${st.disk}.`;
          }
          const bt = bitTable('rw:bt', GX, BY, rows, null, 'new P');
          extra = [t.title('rw:btt', GX, BY - 10, 'stripe ' + st.stripe + ', byte 0 of the new parity'), ...bt.items];
          meta.vals = rows.map((r) => r.v); meta.out = bt.xb.out; meta.hexs = rows.map((r) => hex(r.v)).concat([hex(bt.xb.out)]);
        }
        F.set('reads', reads).set('writes', writes);
        meta.reads = reads; meta.writes = writes;
        F.add({ items: g(cls).concat(extra), title: st.kind, say, meta });
      });
      // the cost by chunks written
      const rowsC = [...Array(w).keys()].map((k) => Rd.smallWrite({ level: L, disks: n, chunks: k + 1 }));
      const TY = BY, its = [t.title('rw:ct', GX, TY - 10, 'one stripe, by chunks written: disk I/Os')];
      its.push(t.text('rw:h0', GX + 120, TY + 14, 'chunks', 'tick', 13, 'end'), t.text('rw:h1', GX + 260, TY + 14, 'read-modify-write', 'tick', 13, 'end'), t.text('rw:h2', GX + 420, TY + 14, 'reconstruct-write', 'tick', 13, 'end'), t.text('rw:h3', GX + 520, TY + 14, 'best', 'tick', 13, 'end'));
      rowsC.forEach((x, k) => {
        const y = TY + 40 + k * 24;
        its.push(t.text('rw:c0' + k, GX + 120, y, String(k + 1), 'calc', 13, 'end'), t.text('rw:c1' + k, GX + 260, y, String(x.rmw.ios), 'calc' + (x.best === 'rmw' ? ' good' : ''), 13, 'end'), t.text('rw:c2' + k, GX + 420, y, String(x.rcw.ios), 'calc' + (x.best === 'rcw' || x.best === 'full' ? ' good' : ''), 13, 'end'), t.text('rw:c3' + k, GX + 520, y, x.best === 'full' ? 'full' : x.best, 'calc', 13, 'end'));
      });
      F.add({ items: g().concat(its), title: 'the cost', say: `This write took ${t.plural(reads, 'read')} and ${t.plural(writes, 'write')}. A full stripe would need ${rowsC[w - 1].full.writes} writes and no reads; a single chunk costs ${sw.rmw.ios} I/Os by read-modify-write, against 1 for a plain disk. Writing in whole stripes is how parity RAID stays fast.`, meta: { phase: 'cost', reads, writes, rowsC, sw } });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Parity', text: ['P = D₀ ⊕ D₁ ⊕ … ⊕ D_w−1   (bit by bit)', 'full stripe: P from the new data, no reads', 'read-modify-write: P_new = P_old ⊕ D_old ⊕ D_new', 'reconstruct-write: read the untouched chunks, XOR all', 'small write on RAID 5: 2 reads + 2 writes'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'write', pick: 'option', ask: 'How many disk reads will this write need?', options: (fr) => { const r = fr[fr.length - 1].meta.reads; return [...new Set([0, 1, 2, 3, r])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.reads), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Data bytes 0x5a, 0x0f and 0x33. What is their parity?', options: ['0x66', '0x9c', '0x00', '0xff'], answer: 0, why: '0x5a ⊕ 0x0f = 0x55, and 0x55 ⊕ 0x33 = 0x66.' },
      { q: 'With read-modify-write, the new parity is…', options: ['P_old ⊕ D_old ⊕ D_new', 'D_old ⊕ D_new', 'P_old ⊕ D_new', 'the XOR of all disks'], answer: 0, why: 'XORing D_old out and D_new in leaves every other chunk’s contribution in place.' },
      { q: 'Why does writing a whole stripe at once avoid the small-write penalty?', options: ['the new parity is computed from the new data alone', 'parity is not needed for full stripes', 'the disks are faster for big writes', 'it skips the parity disk'], answer: 0, why: 'All the data of the stripe is in hand, so nothing must be read.' },
      { q: 'On RAID 4 every small write queues on one disk. Which?', options: ['the parity disk', 'disk 0', 'the disk with the data', 'none'], answer: 0, why: 'Each small write also updates the parity, and RAID 4 keeps all parity on one disk.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
