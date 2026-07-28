// RAID 5 at work on real bytes: a short message is written stripe by stripe across 4 or 5 disks, each stripe's
// parity the XOR of its data chunks (worked bit by bit for the first stripe), the parity moving one disk to the
// left at every stripe. Then a disk fails and every chunk it held is rebuilt as the XOR of the chunks the other
// disks hold in the same stripe. Everything comes from the RAID engine (src/core/st-a-raid.js).
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const MSGS = ['MEET AT THE OLD MILL AT NINE', 'Parity saves the day', 'disks fail, data stays', 'SEND 40 SACKS OF GRAIN'];
  const KNOBS = { msg: 0, disks: 4, chunk: 2, fail: 2 };
  const hex = (v) => v.toString(16).padStart(2, '0');
  const ch = (v) => (v === 32 ? '␣' : v >= 33 && v < 127 ? String.fromCharCode(v) : '·');
  const chars = (u) => [...u].map(ch).join('');
  const hexes = (u, sep) => [...u].map(hex).join(sep === undefined ? ' ' : sep);

  function run(k) {
    const R = S.Raid, msg = MSGS[k.msg], n = k.disks, chunk = k.chunk, w = n - 1, per = w * chunk;
    const stripes = Math.ceil(msg.length / per), bytes = new Uint8Array(stripes * per);
    for (let i = 0; i < msg.length; i++) bytes[i] = msg.charCodeAt(i);
    const A = R.create({ level: 5, disks: n, chunk, stripes });
    const writes = [];
    for (let s = 0; s < stripes; s++) { const tr = R.write(A, s * per, bytes.subarray(s * per, (s + 1) * per)); writes.push({ s, steps: tr.steps, snap: A.disk.map((u) => u.slice()) }); }
    const full = A.disk.map((u) => u.slice()), fd = Math.min(k.fail, n - 1);
    const fail = R.fail(A, fd), degraded = R.read(A, 0, msg.length);
    const rb = R.rebuild(A, fd), back = R.read(A, 0, msg.length);
    const exact = full[fd].every((v, i) => v === A.disk[fd][i]);
    return { msg, n, chunk, w, per, stripes, A, writes, full, fd, fail, degraded, rb, back, exact };
  }

  function frames(narrow, knobs) {
    const k = Object.assign({}, KNOBS, knobs || {});
    k.fail = Math.min(k.fail, k.disks - 1);
    const X = D.once('raid5:' + [k.msg, k.disks, k.chunk, k.fail].join('/'), () => run(k));
    const R = S.Raid, KD = S.Kit.disk, A = X.A, n = X.n, C = X.chunk;
    const cell = (d, s) => X.full[d].subarray(s * C, (s + 1) * C);
    const rowH = 46, gap = narrow ? 5 : 8;
    const G = narrow
      ? { x: 0, y: 0, rhw: 34, cw: Math.floor((396 - 34 - (n - 1) * gap) / n), size: C > 2 ? 12 : 13 }
      : { x: 0, y: 0, rhw: 86, cw: 118, size: 14 };
    const gridH = 30 + X.stripes * (rowH + gap) - gap;
    const P = narrow ? { x: 0, y: gridH + 34, w: 396 } : { x: 770, y: 0, w: 430 };
    const panelH = 34 + (n + 1) * 30 + 10 + (C > 1 ? 24 + n * 22 + 14 : 30);
    const viewH = narrow ? gridH + 34 + panelH + 10 : Math.max(gridH, panelH) + 16;
    const view = narrow ? box(-4, -6, 404, viewH) : box(-10, -8, 1220, viewH);
    const out = [];
    /** the grid as it stands: written stripes (up to `upTo`), the failed disk, rebuilt stripes */
    const grid = (o) => KD.grid({
      prefix: 'rd:g', x: G.x, y: G.y, n, rows: X.stripes, cw: G.cw, ch: rowH, gap, rowHeadW: G.rhw, size: G.size,
      head: (d) => ({ text: (narrow ? 'd' : 'disk ') + d + (o.failed && d === X.fd && !o.done ? (narrow ? ' ✕' : ' failed') : ''), cls: o.failed && d === X.fd && !o.done ? 'dead' : 'strong' }),
      rowHead: (s) => (narrow ? 's' + s : 'stripe ' + s),
      cell: (s, d) => {
        const par = R.parityDisk(A, s) === d, written = s <= o.upTo, u = cell(d, s);
        const hx = narrow && C > 2 ? hexes(u, '') : hexes(u);
        let cls, lines;
        if (!written) { cls = 'rd-empty'; lines = [par ? (narrow ? 'P' : 'parity') : ' ']; }
        else if (par) { cls = 'rd-par'; lines = ['P', hx]; }
        else { cls = 'rd-data'; lines = [chars(u), hx]; }
        if (o.failed && d === X.fd) {
          if (o.rebuilt !== undefined && s <= o.rebuilt) { cls = 'rd-new'; }
          else { cls = 'rd-lost'; lines = ['lost']; }
        }
        if (o.act && o.act(s, d)) cls += ' act';
        if (o.src && o.src(s, d)) cls += ' src';
        return { lines, cls };
      },
    });
    const panelTitle = (t, y) => ({ key: 'rd:pt', kind: 'text', x: P.x, y: (y || P.y) + 16, text: t, size: 15, cls: 'strong' });
    const msgLine = { key: 'rd:msg', kind: 'text', x: P.x, y: P.y + (narrow ? 0 : 0) + 46, text: '“' + X.msg + '”', size: narrow ? 14 : 15, cls: 'mono' };
    /** a bit table for byte j of the chunks of stripe s from the given disks, with its result row */
    const bitTable = (s, j, from, resLabel, resCls, y) => {
      const rows = from.map((d, i) => { const v = cell(d, s)[j], par = R.parityDisk(A, s) === d; return { label: (i ? '⊕ ' : '') + (narrow ? 'd' : 'disk ') + d + ' ' + (par ? 'P' : '‘' + ch(v) + '’'), bits: R.xorBits([v]).bits[0], hex: hex(v), cls: par ? 'par' : '' }; });
      const x = R.xorBits(from.map((d) => cell(d, s)[j]));
      rows.push({ label: '= ' + resLabel, bits: x.outBits, hex: hex(x.out), cls: 'res' });
      const hot = new Set(x.outBits.map((b, i) => (b ? i : -1)).filter((i) => i >= 0));
      return KD.bits({ prefix: 'rd:bt', x: P.x, y, rows, rule: rows.length - 1, labelW: narrow ? 96 : 130, bw: narrow ? 29 : 30, rh: 30, size: 14, hot });
    };
    const eqLines = (s, from, y, target) => {
      const items = [];
      from.forEach((d, i) => items.push({ key: 'rd:eq' + i, kind: 'text', x: P.x, y: y + i * 22, text: (i ? '⊕ ' : '\u00a0\u00a0') + (narrow ? 'd' : 'disk ') + d + ':\u00a0' + hexes(cell(d, s)), size: 14, cls: 'calc' }));
      items.push({ key: 'rd:eqr', kind: 'text', x: P.x, y: y + from.length * 22 + 4, text: '=\u00a0' + target + ':\u00a0' + hexes(cell(target === 'parity' ? R.parityDisk(A, s) : X.fd, s)), size: 14, cls: 'calc act' });
      return items;
    };

    // 0: the empty array and where parity goes
    {
      const items = grid({ upTo: -1 }).items;
      items.push(panelTitle('the message'), msgLine);
      items.push(...KD.para({ prefix: 'rd:pp', x: P.x, y: P.y + 70, maxW: P.w, size: 14, text: `${X.msg.length} bytes, cut into chunks of ${C} byte${C === 1 ? '' : 's'}: each stripe takes ${X.w} data chunks and one parity chunk, ${X.per} bytes in all, so ${X.stripes} stripes.` }).items);
      out.push({ items, view, title: 'the layout', say: `RAID 5 on \`${n}\` disks: in stripe s the parity sits on disk ${n - 1} − (s mod ${n}), one disk further left each stripe, so no single disk takes every parity write. The data chunks follow the parity round the disks.` });
    }
    // the stripes, written one at a time
    X.writes.forEach((wr, s) => {
      const p = R.parityDisk(A, s), dd = R.dataDisks(A, s);
      const items = grid({ upTo: s, act: (s2, d) => s2 === s && d === p, src: (s2, d) => s2 === s && d !== p }).items;
      items.push(panelTitle(`stripe ${s}: parity on disk ${p}`), msgLine);
      items.push(...eqLines(s, dd, P.y + 82, 'parity'));
      const pv = cell(p, s);
      out.push({ items, view, title: 'write stripe ' + s, say: `Stripe ${s} takes \`${dd.map((d) => chars(cell(d, s))).join('')}\` on disks ${dd.join(', ')}; its parity, on disk ${p}, is their XOR byte by byte: \`${hexes(pv)}\`.` });
    });
    // the first stripe's parity, bit by bit
    const p0 = R.parityDisk(A, 0), d0 = R.dataDisks(A, 0);
    for (let j = 0; j < C; j++) {
      const items = grid({ upTo: X.stripes - 1, act: (s2, d) => s2 === 0 && d === p0, src: (s2, d) => s2 === 0 && d !== p0 }).items;
      items.push(panelTitle(`stripe 0, byte ${j} of the parity`));
      const bt = bitTable(0, j, d0, 'parity', 'res', P.y + 34);
      items.push(...bt.items);
      const vals = d0.map((d) => cell(d, 0)[j]), x = R.xorBits(vals);
      items.push(...KD.para({ prefix: 'rd:pp', x: P.x, y: P.y + 34 + bt.h + 14, maxW: P.w, size: 14, text: 'Each column XORs to 1 when it holds an odd number of 1s.' }).items);
      out.push({ items, view, title: 'parity bit by bit', say: `Byte ${j} of stripe 0’s parity, bit by bit: ${vals.map((v) => '`' + hex(v) + '`').join(' ⊕ ')} = \`${hex(x.out)}\`. Columns with an odd count of 1s (${x.ones.map((c) => c).join(', ')}) give 1.` });
    }
    // a disk fails
    {
      const lost = [...Array(X.stripes).keys()].map((s) => (R.parityDisk(A, s) === X.fd ? 'parity ' + s : 'chunk ' + R.role(A, s, X.fd).chunk));
      const items = grid({ upTo: X.stripes - 1, failed: true }).items;
      items.push(panelTitle(`disk ${X.fd} fails`), msgLine);
      items.push(...KD.para({ prefix: 'rd:pp', x: P.x, y: P.y + 70, maxW: P.w, size: 14, text: `Lost: ${lost.join(', ')}. The array still answers reads: a missing chunk is the XOR of the rest of its stripe.` }).items);
      out.push({ items, view, title: 'a disk fails', say: `Disk \`${X.fd}\` fails and its ${X.stripes} chunks are gone. A read of the message still works in degraded mode, ${X.degraded.steps.filter((s) => s.kind === 'rebuild-read').length} chunk${X.degraded.steps.filter((s) => s.kind === 'rebuild-read').length === 1 ? '' : 's'} computed on the fly.` });
    }
    // the rebuild, stripe by stripe
    X.rb.steps.forEach((st, s) => {
      const items = grid({ upTo: X.stripes - 1, failed: true, rebuilt: s, act: (s2, d) => s2 === s && d === X.fd, src: (s2, d) => s2 === s && d !== X.fd }).items;
      const what = st.role === 'parity' ? 'parity' : 'chunk ' + R.role(A, s, X.fd).chunk;
      items.push(panelTitle(`stripe ${s}: rebuild ${what}`));
      const bt = bitTable(s, 0, st.from, (narrow ? 'd' : 'disk ') + X.fd + (st.role === 'parity' ? ' P' : ' ‘' + ch(cell(X.fd, s)[0]) + '’'), 'res', P.y + 34);
      items.push(...bt.items);
      if (C > 1) items.push(...eqLines(s, st.from, P.y + 34 + bt.h + 24, (narrow ? 'd' : 'disk ') + X.fd).map((it) => Object.assign(it, { key: it.key + 'b' })));
      out.push({ items, view, title: 'rebuild stripe ' + s, say: `Stripe ${s}: the lost ${what} is the XOR of disks ${st.from.join(', ')}: \`${hexes(st.bytes)}\`${st.role === 'parity' ? '' : ', which reads ‘' + chars(st.bytes) + '’'}. Byte 0 is worked bit by bit.` });
    });
    {
      const items = grid({ upTo: X.stripes - 1, failed: true, done: true, rebuilt: X.stripes - 1 }).items;
      items.push(panelTitle('read back'), msgLine);
      items.push({ key: 'rd:ok', kind: 'text', x: P.x, y: P.y + 84, text: X.exact ? 'the new disk equals the lost one, byte for byte' : 'the rebuilt disk differs', size: 14, cls: X.exact ? 'good' : 'bad' });
      out.push({ items, view, title: 'rebuilt', say: `Disk ${X.fd} is whole again, equal byte for byte to the one that failed, and the array reads back \`${String.fromCharCode(...X.back.bytes)}\`.` });
    }
    return out;
  }

  D.add({
    id: 'raid5', order: 120, tag: 'Storage · RAID 5', short: 'RAID 5 rebuild', title: 'RAID 5: parity, a failed disk and a rebuild',
    blurb: 'A message written across the disks in stripes, each with a parity chunk that is the XOR of its data. When one disk dies, every chunk it held is the XOR of what the other disks hold in the same stripe.',
    knobs: [
      { id: 'msg', label: 'message', type: 'select', value: KNOBS.msg, options: MSGS.map((m, i) => ({ value: i, label: '“' + m + '”' })) },
      { id: 'disks', label: 'disks', min: 4, max: 5, step: 1, value: KNOBS.disks, fmt: (v) => String(v) },
      { id: 'chunk', label: 'chunk size', min: 1, max: 4, step: 1, value: KNOBS.chunk, fmt: (v) => v + ' B' },
      { id: 'fail', label: 'disk that fails', type: 'select', value: KNOBS.fail, options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: 'disk ' + v })) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs); },
    run(knobs) { return run(Object.assign({}, KNOBS, knobs || {})); },
  });
})(globalThis.Proses = globalThis.Proses || {});
