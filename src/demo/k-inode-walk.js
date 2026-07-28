// The walk from an inode to byte N of a file: which file block N is in, which part of the inode maps it (direct,
// single, double or triple indirect), the index computed at each level of indirect blocks, and the data block at
// the end. The disk is a real image made by the file-system engine (src/core/fs-*.js): a small directory tree and
// a sparse file /maps/atlas with a word written at byte N, so the blocks the walk reads exist and light up on the
// block map. The geometry (block size, pointer size, direct pointers) is the student's, and so is N.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const WORD = 'lighthouse';
  const PARTS = ['direct', 'single', 'double', 'triple'];
  const TARGET = ['direct', 'single', 'double', 'triple', 'byte N'];
  const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  /** a byte count in binary units, three significant digits */
  const size = (n) => { const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? +n.toPrecision(3) : n) + ' ' + u[i]; };
  const KNOBS = { target: 4, bs: 8, ps: 2, nd: 4, N: 20000123 };

  /** the byte the walk goes to: a fixed spot inside the chosen part, or the student's N, kept inside the largest file */
  function pickN(g, k) {
    const reach = S.FS.reach(g), max = S.FS.maxFileSize(g) - WORD.length;
    if (k.target <= 3) { const r = reach[k.target]; return { N: Math.min(max, (r.from + Math.floor(r.blocks * 0.37)) * g.bs + Math.floor(g.bs * 0.48)), clamped: false }; }
    const N = Math.round(k.N);
    return N > max ? { N: max, clamped: true } : { N, clamped: false };
  }
  function run(k) {
    const F = S.FS, geo = { bs: Math.pow(2, k.bs), ps: [2, 4, 8][k.ps - 1], ndirect: k.nd, nblocks: 64, ninodes: 16 };
    const img = F.mkfs(geo), g = img.g, pick = pickN(g, k);
    F.apply(img, 'mkdir', ['/maps']);
    F.apply(img, 'create', ['/maps/atlas']);
    F.apply(img, 'write', ['/maps/atlas', 0, 'Charts of the northern coast, first edition.']);
    F.apply(img, 'create', ['/todo']);
    F.apply(img, 'write', ['/todo', 0, 'oil the hinges; send the tide tables']);
    F.apply(img, 'write', ['/maps/atlas', pick.N, WORD]);
    const ino = F.lookup(img, '/maps/atlas').ino, w = F.walk(img, ino, pick.N), fsck = F.fsck(img);
    const used = new Set(); for (const b of fsck.owners.keys()) used.add(b);
    return { img, g, ino, w, N: pick.N, clamped: pick.clamped, used, inode: F.readInode(img, ino), reach: F.reach(g), max: F.maxFileSize(g), target: k.target, ok: fsck.ok };
  }

  /** the rows of an indirect block worth showing: the first, the chosen one, the last, with gaps between */
  function entryRows(img, b, idx, P, ps, cls) {
    const F = S.FS, u = F.block(img, b), want = [...new Set([0, idx, P - 1])].sort((a, c) => a - c), rows = [];
    want.forEach((i, j) => {
      if (j && i - want[j - 1] > 1) rows.push({ id: 'g' + j, label: '⋮', value: (i - want[j - 1] - 1) + ' more', cls: 'gapdots none' });
      const p = F.getPtr(u, i * ps, ps);
      rows.push({ id: 'e' + i, label: '[' + i + ']', value: p ? String(p) : '—', cls: (i === idx ? cls : '') + (p ? '' : ' none') });
    });
    return rows;
  }

  function frames(narrow, knobs) {
    const k = Object.assign({}, KNOBS, knobs || {});
    const R = D.once('inode-walk:' + [k.target, k.bs, k.ps, k.nd, Math.round(k.N)].join('/'), () => run(k));
    const { g, w, N, img } = R, KD = S.Kit.disk, P = g.P;
    const steps = w.steps, levels = w.loc.level;
    // what the walk has read by step i: the blocks, in order
    const path = [];
    steps.forEach((st, i) => { if (st.kind === 'inode' || st.kind === 'index' || st.kind === 'data') path.push({ i, block: st.kind === 'index' ? st.block : st.kind === 'data' ? st.block : st.block }); });
    const L = narrow
      ? { view: box(-6, -6, 404, 870), map: { x: 0, y: 26, cols: 8, cw: 44, ch: 25 }, legend: { x: 0, y: 0, maxW: 396 }, math: { x: 0, y: 0 }, table: { x: 0, y: 0, w: 396 } }
      : { view: box(-10, -8, 1220, 590), map: { x: 0, y: 26, cols: 16, cw: 40, ch: 30 }, legend: { x: 0, y: 0, maxW: 690 }, math: { x: 760, y: 0 }, table: { x: 760, y: 104, w: 440 } };
    const out = [];
    const total = steps.length + 1;
    for (let f = 0; f < total; f++) {
      const st = f ? steps[f - 1] : null, items = [];
      const lit = path.filter((p) => p.i < f);
      const cur = lit.length && lit[lit.length - 1].i === f - 1 ? lit[lit.length - 1].block : -1;
      const seen = new Set(lit.map((p) => p.block));
      // the disk
      items.push({ key: 'iw:maptitle', kind: 'text', x: L.map.x, y: 14, text: `the disk: ${g.nblocks} blocks of ${g.bs} bytes`, size: 14, cls: 'strong' });
      const map = KD.map({ prefix: 'iw:m', x: L.map.x, y: L.map.y, g, cols: L.map.cols, cw: L.map.cw, ch: L.map.ch, used: (b) => R.used.has(b) || b < g.dataStart, look: (b) => (b === cur ? 'act' : seen.has(b) ? 'seen' : ''), size: 12 });
      items.push(...map.items);
      const lg = KD.legend({ prefix: 'iw:lg', x: L.map.x, y: L.map.y + map.h + 14, entries: KD.layoutLegend(g), maxW: L.legend.maxW, size: 13 });
      items.push(...lg.items);
      let y = L.map.y + map.h + 14 + lg.h + 22;
      // the arithmetic: N, its file block and offset
      const mx = narrow ? 0 : L.math.x, my = narrow ? y : L.math.y;
      const showSplit = f >= 2;
      items.push({ key: 'iw:n', kind: 'text', x: mx, y: my + 16, text: `N = ${grp(N)}` + (R.clamped ? ' (max)' : ''), size: 17, cls: 'mono' });
      items.push({ key: 'iw:fb', kind: 'text', x: mx, y: my + 44, text: showSplit ? `file block = N ÷ ${g.bs} = ${grp(w.fb)}` : `file block = N ÷ ${g.bs} = ?`, size: 14, cls: 'calc' + (f === 2 ? ' act' : '') });
      items.push({ key: 'iw:off', kind: 'text', x: mx, y: my + 68, text: showSplit ? `offset = N mod ${g.bs} = ${w.off}` : `offset = N mod ${g.bs} = ?`, size: 14, cls: 'calc' + (f === 2 ? ' act' : '') });
      // the reach of each part of the inode, and the largest file
      const tx = narrow ? 0 : L.table.x, ty = narrow ? my + 88 : L.table.y, tw = L.table.w, c1 = narrow ? 72 : 96, c2 = narrow ? 214 : 230, ts = narrow ? 12 : 13;
      const head = [['part', c1], ['file blocks', c2], ['bytes', tw - c1 - c2]];
      let cx = tx;
      head.forEach(([h, cw], j) => { items.push({ key: 'iw:th' + j, kind: 'cell', x: cx, y: ty, w: cw, h: 26, rx: 0, text: h, size: ts, cls: 'head' }); cx += cw; });
      const rowsT = R.reach.map((r) => [r.part, r.blocks === 1 ? grp(r.from) : grp(r.from) + ' – ' + grp(r.from + r.blocks - 1), size(r.bytes)]);
      rowsT.push(['largest', g.bs + '·(' + g.ndirect + '+' + P + '+' + P + '²+' + P + '³)', size(R.max)]);
      rowsT.forEach((row, i) => {
        let x = tx;
        const on = f >= 3 && i === levels;
        row.forEach((v, j) => { const cw = head[j][1]; items.push({ key: 'iw:t' + i + '.' + j, kind: 'cell', x, y: ty + 26 + i * 26, w: cw, h: 26, rx: 0, text: v, size: ts, cls: 'dk slot-v ' + (j ? 'mono ' : '') + (on ? 'act' : i === 4 ? 'none' : '') }); x += cw; });
      });
      y = narrow ? ty + 26 * 6 + 22 : 300;
      // the chain: inode, indirect blocks, data block
      const ino = R.inode, inoStep = steps.findIndex((s) => s.kind === 'inode') + 1;
      if (!narrow) {
        const slotOf = w.loc.level === 0 ? 'd' + Math.floor(w.loc.slot / 4) : PARTS[levels];
        const rows = [{ id: 'type', label: 'type', value: 'file' }, { id: 'size', label: 'size', value: grp(ino.size) }];
        for (let a = 0; a < g.ndirect; a += 4) { const b2 = Math.min(g.ndirect, a + 4) - 1; rows.push({ id: 'd' + a / 4, label: a === b2 ? 'd' + a : 'd' + a + '–' + b2, value: ino.direct.slice(a, b2 + 1).map((p) => (p ? p : '—')).join('  '), cls: '' }); }
        rows.push({ id: 'single', label: 'single', value: ino.single || '—' }, { id: 'double', label: 'double', value: ino.double || '—' }, { id: 'triple', label: 'triple', value: ino.triple || '—' });
        rows.forEach((r) => { if (r.id === slotOf && f >= inoStep) r.cls = f === inoStep ? 'act' : 'seen'; });
        const ix = 0, iy = y + 34;
        items.push({ key: 'iw:ireg', kind: 'region', x: ix - 8, y: y, w: 236, h: 30 + rows.length * 28 + 12, rx: 8, text: '' });
        items.push({ key: 'iw:ititle', kind: 'text', x: ix + 2, y: y + 20, text: `inode ${R.ino}  (/maps/atlas)`, size: 14, cls: 'strong' });
        const slots = KD.slots({ prefix: 'iw:i', x: ix, y: iy, w: 220, rows, labelW: 64, rh: 28, size: 13 });
        items.push(...slots.items);
        // the indirect blocks and the data block, left to right
        let from = { x: ix + 220, y: slots.row(slotOf).cy }, bx = 268;
        const colW = 170, gapX = 62;
        steps.forEach((s, i) => {
          if (s.kind !== 'index' || f < i + 1) return;
          const ent = entryRows(img, s.block, s.idx, P, g.ps, f === i + 1 ? 'act' : 'seen');
          const top = y, regH = 34 + ent.length * 28 + 8;
          items.push({ key: 'iw:sreg' + s.depth, kind: 'region', x: bx, y: top, w: colW, h: regH, rx: 8, text: '', cls: f === i + 1 ? 'act' : '' });
          items.push({ key: 'iw:stitle' + s.depth, kind: 'text', x: bx + 10, y: top + 20, text: `block ${s.block}`, size: 14, cls: 'strong' });
          const sl = KD.slots({ prefix: 'iw:s' + s.depth, x: bx + 8, y: top + 34, w: colW - 16, rows: ent, labelW: 58, rh: 28, size: 13 });
          items.push(...sl.items);
          items.push({ key: 'iw:w' + s.depth, kind: 'wire', pts: wirePts(from, { x: bx, y: top + 15 }), head: true, cls: f === i + 1 ? 'act' : '' });
          const cy = top + regH + 22;
          items.push({ key: 'iw:calc' + s.depth, kind: 'text', x: bx + colW / 2, y: cy, text: s.span > 1 ? `${grp(s.rem)} ÷ ${grp(s.span)}` : s.depth === 0 ? `${grp(w.fb)} − ${grp(w.fb - s.rem)}` : `${grp(s.rem)} left`, anchor: 'middle', size: 14, cls: 'calc' + (f === i + 1 ? ' act' : '') });
          items.push({ key: 'iw:calc2' + s.depth, kind: 'text', x: bx + colW / 2, y: cy + 22, text: `entry ${s.idx}`, anchor: 'middle', size: 14, cls: 'calc' + (f === i + 1 ? ' act' : '') });
          from = { x: bx + colW - 8, y: sl.row('e' + s.idx).cy };
          bx += colW + gapX;
        });
        const ds = steps.length;
        if (f >= ds) {
          const dx = 268 + levels * (colW + gapX), dW = 236;
          items.push({ key: 'iw:dreg', kind: 'region', x: dx, y, w: dW, h: 128, rx: 8, text: '', cls: 'act' });
          items.push({ key: 'iw:dtitle', kind: 'text', x: dx + 10, y: y + 20, text: w.block ? `data block ${w.block}` : 'a hole', size: 14, cls: 'strong' });
          items.push(...byteRow('iw:by', img, w, dx + 12, y + 40, Math.floor((dW - 24) / 7), 7));
          items.push({ key: 'iw:wd', kind: 'wire', pts: wirePts(from, { x: dx, y: y + 15 }), head: true, cls: 'act' });
        }
      } else {
        // on a phone the chain is a list of hops
        const hops = [];
        const inS = steps.find((s) => s.kind === 'inode');
        if (f >= inoStep) hops.push({ id: 'h0', label: `inode ${R.ino}: ${w.loc.level ? PARTS[levels] : 'direct ' + w.loc.slot}`, value: '→ ' + (inS.ptr || '—'), cls: f === inoStep ? 'act' : 'seen' });
        steps.forEach((s, i) => { if (s.kind === 'index' && f >= i + 1) hops.push({ id: 'h' + (s.depth + 1), label: `block ${s.block} [${s.idx}]`, value: '→ ' + (s.ptr || '—'), cls: f === i + 1 ? 'act' : 'seen' }); });
        items.push({ key: 'iw:htitle', kind: 'text', x: 0, y: y + 14, text: `the walk from inode ${R.ino} (/maps/atlas)`, size: 14, cls: 'strong' });
        const sl = KD.slots({ prefix: 'iw:h', x: 0, y: y + 26, w: 396, rows: hops, labelW: 250, rh: 32, size: 14 });
        items.push(...sl.items);
        if (f >= steps.length) {
          const by = y + 26 + 4 * 32 + 14;
          items.push({ key: 'iw:dtitle', kind: 'text', x: 0, y: by + 14, text: w.block ? `data block ${w.block}` : 'a hole', size: 14, cls: 'strong' });
          items.push(...byteRow('iw:by', img, w, 0, by + 26, 56, 7));
        }
      }
      const say = f === 0
        ? `A ${g.nblocks}-block disk of ${g.bs}-byte blocks: superblock 0, bitmaps ${g.ibmStart} and ${g.dbmStart}, inodes in ${g.itStart}–${g.itStart + g.itBlocks - 1}, data from ${g.dataStart}. Inode ${R.ino} has ${g.ndirect} direct pointers and pointers of ${g.ps} bytes, so the largest file is \`${size(R.max)}\`. We look for byte \`${grp(N)}\`${k.target <= 3 ? ', in the ' + TARGET[k.target] + ' part' : ''}${R.clamped ? ' (the N asked for is past the largest file, so the walk goes to the last bytes that fit)' : ''}.`
        : st.say.replace(/\b\d{5,}\b/g, (m) => grp(+m));
      out.push({ items, say, view: L.view, title: f === 0 ? 'the layout' : st.kind === 'index' ? `level ${st.depth + 1} of ${levels}` : st.kind });
    }
    return out;
  }
  /** a drafted wire from a pointer's slot to the block it names */
  function wirePts(a, b) {
    if (Math.abs(a.y - b.y) < 2) return [[a.x, b.y], [b.x, b.y]];
    const mx = Math.round(b.x - 26);
    return [[a.x, a.y], [mx, a.y], [mx, b.y], [b.x, b.y]];
  }
  /** the bytes around the offset, the one found lit */
  function byteRow(prefix, img, w, x, y, cw, n) {
    const F = S.FS, u = w.block ? F.block(img, w.block) : new Uint8Array(img.g.bs), lo = Math.max(0, Math.min(img.g.bs - n, w.off - 2)), cells = [], items = [];
    for (let i = lo; i < lo + n; i++) { const v = u[i]; cells.push({ text: v >= 32 && v < 127 ? String.fromCharCode(v) : v ? v.toString(16) : '0', cls: (i === w.off ? 'act' : '') + (v ? '' : ' zero') }); }
    items.push(...S.Kit.disk.bytes({ prefix, x, y, cw, ch: 34, cells, size: 16 }).items);
    for (let i = 0; i < n; i++) items.push({ key: prefix + ':o' + i, kind: 'text', x: Math.round(x + i * cw + cw / 2), y: y + 54, text: String(lo + i), anchor: 'middle', size: 12, cls: 'tick' + (lo + i === w.off ? ' act' : '') });
    return items;
  }

  D.add({
    id: 'inode-walk', order: 110, tag: 'File systems · inodes', short: 'Inode walk', title: 'Walking an inode to byte N',
    blurb: 'Which block holds byte N of a file? Divide by the block size, see which part of the inode maps that block, and follow the pointers: an index is worked out at every level of indirect blocks. Each block read lights up on the disk.',
    knobs: [
      { id: 'target', label: 'walk to', type: 'select', value: KNOBS.target, options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: v < 4 ? 'a byte in the ' + TARGET[v] + ' part' : 'byte N below' })) },
      { id: 'bs', label: 'block size', min: 8, max: 12, step: 1, value: KNOBS.bs, fmt: (v) => Math.pow(2, v) + ' B' },
      { id: 'ps', label: 'pointer size', type: 'select', value: KNOBS.ps, options: [1, 2, 3].map((v) => ({ value: v, label: [2, 4, 8][v - 1] + ' B' })) },
      { id: 'nd', label: 'direct pointers', min: 1, max: 12, step: 1, value: KNOBS.nd, fmt: (v) => String(v) },
      { id: 'N', label: 'byte N', min: 100, max: 1e13, value: KNOBS.N, log: true, fmt: (v) => grp(v) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs); },
    trace(knobs) { return run(Object.assign({}, KNOBS, knobs || {})).w.steps; },
    run(knobs) { return run(Object.assign({}, KNOBS, knobs || {})); },
  });
})(globalThis.Proses = globalThis.Proses || {});
