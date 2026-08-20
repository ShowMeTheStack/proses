// The VM lab, part one: what its six workbenches share (S.VmmLab, VX). Drawing helpers (text, cells, panels,
// wrapped lines, bars), small words, and two adapters over the engines:
//   VX.walkAt(g, h, gva, seed) -> the two-dimensional walk of S.Virt.walk2d for an address the student typed
//     (walk2d picks its own address from the seed). It is walk2d's own procedure, step for step, with the same
//     frames for the same seed; each step also carries the table it read ({side, level, base, index, next, leaf}),
//     so the lab can draw that table. tests/lab-vmm.mjs checks it against walk2d on walk2d's own addresses.
//   VX.shadowWalk(W) -> the same translation through a shadow table (guest-virtual straight to host-physical),
//     built with S.Mem.build in frames of its own: g reads, and the same host-physical address.
//   VX.withCosts(costs, fn) runs fn with S.Virt.COST set to the student's cycle costs, then puts them back.
// Every number drawn comes from the engines (S.Virt, S.Mem).
(function (S) {
  'use strict';
  const VX = (S.VmmLab = S.VmmLab || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  VX.r1 = r1;
  VX.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  VX.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  VX.cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  VX.tw = (t, size, o) => S.textWidth(String(t), size || 14, o);
  VX.key = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
  VX.hx = (v) => '0x' + BigInt(v).toString(16);
  VX.fix = (v, d) => { const p = Math.pow(10, d === undefined ? 2 : d); const x = Math.round(v * p) / p; return String(Object.is(x, -0) ? 0 : x); };
  /** text with backticks dropped (the engines' sentences are plain already) */
  VX.plain = (s) => String(s || '').replace(/`/g, '');

  VX.text = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: r1(x), y: r1(y), text: String(text), size: size || 14, cls: cls || '', anchor: anchor || 'start' });
  VX.title = (key, x, y, text, anchor) => ({ key, kind: 'text', x: r1(x), y: r1(y), text, size: 13, cls: 'title', anchor: anchor || 'start' });
  VX.cell = (key, x, y, w, h, text, cls, size, extra) => Object.assign({ key, kind: 'cell', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 5, text: text === undefined || text === null ? '' : String(text), size: size || 14, cls: cls || '' }, extra || {});
  VX.panel = (key, x, y, w, h, cls) => ({ key, kind: 'region', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 8, cls: cls || 'panel', audit: 'group', layer: 'back' });
  /** wrapped lines of text: {items, h} */
  VX.para = function (prefix, x, y, text, maxW, size, cls) {
    const sz = size || 14, words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (cur && VX.tw(t, sz) > maxW) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    const lh = Math.round(sz * 1.45);
    return { items: lines.map((l, i) => VX.text(prefix + ':' + i, x, y + i * lh, l, cls || '', sz)), h: lines.length * lh };
  };
  /** text cut with an ellipsis to fit width w */
  VX.fit = function (text, w, size) {
    let t = String(text);
    if (VX.tw(t, size) <= w) return t;
    while (t.length > 1 && VX.tw(t + '…', size) > w) t = t.slice(0, -1);
    return t + '…';
  };
  /**
   * horizontal bars with a label and a value each: o {prefix, x, y, labelW, w (bar room), rowH, max, size,
   * rows: [{label, v, cls, text, mark (a limit drawn as a tick)}]} -> {items, h}
   */
  VX.bars = function (o) {
    const items = [], lw = o.labelW || 150, rh = o.rowH || 30, size = o.size || 13, bw = o.barH || 18;
    const max = Math.max(1e-9, o.max || Math.max(...o.rows.map((r) => Math.max(r.v, r.mark || 0))));
    o.rows.forEach((r, k) => {
      const y = o.y + k * rh, w = Math.max(r.v > 0 ? 3 : 0, (r.v / max) * o.w);
      items.push(VX.text(o.prefix + ':l' + k, o.x + lw - 10, y + bw / 2 + 5, r.label, 'strong', size, 'end'));
      items.push(VX.cell(o.prefix + ':t' + k, o.x + lw, y, o.w, bw, '', 'vx-track', size, { rx: 3, audit: 'group' }));
      if (w > 0) items.push(VX.cell(o.prefix + ':b' + k, o.x + lw, y, w, bw, '', 'vx-bar ' + (r.cls || ''), size, { rx: 3, audit: 'overlap-ok' }));
      if (r.mark !== undefined && r.mark !== null) {
        const mx = o.x + lw + Math.min(1, r.mark / max) * o.w;
        items.push({ key: o.prefix + ':m' + k, kind: 'line', x1: r1(mx), y1: y - 4, x2: r1(mx), y2: y + bw + 4, cls: 'vx-limit', audit: 'ignore', layer: 'top' });
      }
      const label = r.text === undefined ? String(r.v) : r.text, lx = o.x + lw + Math.max(w, r.mark ? Math.min(1, r.mark / max) * o.w : 0) + 8;
      items.push(VX.text(o.prefix + ':v' + k, lx, y + bw / 2 + 5, label, 'mono', size));
    });
    return { items, h: o.rows.length * rh };
  };
  /** a key of swatches: o {prefix, x, y, entries: [{cls, text}], maxW, size} -> {items, h} */
  VX.legend = function (o) {
    const items = [], size = o.size || 13;
    let x = o.x, y = o.y;
    o.entries.forEach((e, k) => {
      const w = 22 + 8 + VX.tw(e.text, size) + 22;
      if (x > o.x && x + w - 22 > o.x + o.maxW) { x = o.x; y += 26; }
      items.push(VX.cell(o.prefix + ':s' + k, x, y, 22, 16, '', e.cls, size, { rx: 3 }));
      items.push(VX.text(o.prefix + ':t' + k, x + 30, y + 13, e.text, '', size));
      x += w;
    });
    return { items, h: y - o.y + 20 };
  };

  // ---- adapters ---------------------------------------------------------------------------------------------------
  VX.parseHex = function (t) {
    const s = String(t || '').trim().replace(/_/g, '').toLowerCase();
    if (/^0x[0-9a-f]+$/.test(s)) return BigInt(s);
    if (/^\d+$/.test(s)) return BigInt(s);
    return null;
  };
  VX.vaBits = (g) => 12 + 9 * g;

  /** walk2d's procedure for a given guest-virtual address (see the file header) */
  VX.walkAt = function (gIn, hIn, gvaIn, seed) {
    const M = S.Mem, V = S.Virt, B = BigInt;
    const g = Math.max(1, Math.min(5, gIn)), h = Math.max(1, Math.min(5, hIn));
    const rand = S.Os.rng(seed === undefined ? 3 : seed);
    const gcfg = M.config({ vaBits: 12 + 9 * g, pageBytes: 4096, levels: g, pteBytes: 8 });
    const hcfg = M.config({ vaBits: 12 + 9 * h, pageBytes: 4096, levels: h, pteBytes: 8 });
    rand(); // walk2d draws its own page here; the student's address takes its place
    const gva = B(gvaIn), gvpn = gva >> 12n, off = gva & 0xfffn;
    const gdata = B(0x40 + Math.floor(rand() * 0x40));
    const guest = M.build(gcfg, [[gvpn, gdata]], { tableFrame: 0x100 });
    const gframes = guest.tables.map((t) => t.frame).concat([gdata]);
    const used = new Set(), hmap = [];
    for (const f of gframes) { let x; do x = 0x2000 + Math.floor(rand() * 0x2000); while (used.has(x)); used.add(x); hmap.push([f, B(x)]); }
    const host = M.build(hcfg, hmap, { tableFrame: 0x300 });
    rand(); // walk2d's offset; the typed address has its own
    const gw = M.translate(guest, gva);
    const hx = (v) => M.hex(v, 0, false);
    const steps = [], grid = Array.from({ length: g + 1 }, () => Array(h + 1).fill(null));
    let accesses = 0;
    steps.push({ kind: 'start', row: -1, col: -1, say: 'Guest-virtual address ' + hx(gva) + ': the guest has ' + V.plural(g, 'level') + ', the host ' + h + '. The guest\'s root table is at guest-physical ' + hx(M.tableBase(guest, guest.tables[0])) + ', which the hardware must itself translate.' });
    const hostWalk = (gpa, row, what) => {
      const hw = M.translate(host, gpa);
      let col = 0;
      for (const s of hw.steps) {
        if (s.kind !== 'read') continue;
        accesses++; grid[row][col] = 'host';
        steps.push({ kind: 'host-read', row, col, addr: s.entryAddr, accesses, gpa, table: { side: 'host', level: col, base: s.base, index: s.index, next: s.next, leaf: s.leaf }, say: 'Read ' + accesses + ': host level ' + (col + 1) + ' for ' + what + ' (guest-physical ' + hx(gpa) + '), entry at host ' + hx(s.entryAddr) + '.' });
        col++;
      }
      return hw.pa;
    };
    let row = 0;
    const gsteps = gw.steps.filter((s) => s.kind === 'read');
    for (const s of gsteps) {
      const hpa = hostWalk(s.entryAddr, row, 'the guest level-' + (row + 1) + ' entry');
      accesses++; grid[row][h] = 'guest';
      steps.push({ kind: 'guest-read', row, col: h, addr: hpa, accesses, gpa: s.entryAddr, table: { side: 'guest', level: row, base: s.base, index: s.index, next: s.next, leaf: s.leaf, hostBase: hpa - B(s.index * 8) }, say: 'Read ' + accesses + ': the guest level-' + (row + 1) + ' entry itself, at host ' + hx(hpa) + ', gives guest frame ' + hx(s.next) + (s.leaf ? ', the data page.' : ', the next guest table.') });
      row++;
    }
    const hpaData = hostWalk(gw.pa, g, 'the data page');
    const tableReads = accesses;
    grid[g][h] = 'data';
    steps.push({ kind: 'data', row: g, col: h, addr: hpaData, accesses: accesses + 1, gpa: gw.pa, say: 'The data itself is read at host ' + hx(hpaData) + '. ' + V.plural(tableReads, 'table read') + ' in all: ' + V.plural(g, 'guest level') + ' each needing ' + V.plural(h, 'host read') + ' plus the entry, and ' + h + ' more for the data, (' + g + ' + 1)(' + h + ' + 1) − 1 = ' + V.count2d(g, h) + '. Natively it would be ' + g + '.' });
    return { steps, accesses: tableReads, total: tableReads + 1, grid, gva, gpa: gw.pa, hpa: hpaData, guest, host, g, h, off, gvpn, gfields: gw.fields, gcfg, hcfg };
  };

  /** the same translation through a shadow table the VMM keeps (guest-virtual to host-physical) */
  VX.shadowWalk = function (W) {
    const M = S.Mem, B = BigInt;
    const hframe = W.hpa >> 12n;
    const sh = M.build(W.gcfg, [[W.gvpn, hframe]], { tableFrame: 0x500 });
    const tr = M.translate(sh, W.gva);
    const reads = tr.steps.filter((s) => s.kind === 'read');
    const hx = (v) => M.hex(v, 0, false);
    const steps = reads.map((s, i) => ({ kind: 'shadow-read', level: i, base: s.base, index: s.index, next: s.next, leaf: s.leaf, addr: s.entryAddr, accesses: i + 1, say: 'Shadow read ' + (i + 1) + ': level ' + (i + 1) + ' of the shadow table, at host ' + hx(s.base) + ' + ' + s.index + ' × 8 = ' + hx(s.entryAddr) + ', gives host frame ' + hx(s.next) + (s.leaf ? ', the data page itself: no host walk is needed, because the VMM already combined the two mappings.' : ', the next shadow table.') }));
    steps.push({ kind: 'shadow-data', level: W.g, addr: tr.pa, accesses: reads.length + 1, say: 'The shadow walk ends at host ' + hx(tr.pa) + ', the same address as the nested walk, after ' + VX.plural(reads.length, 'table read') + ' instead of ' + W.accesses + '. The price is paid elsewhere: every change the guest makes to its own table must trap so the VMM can copy it here.' });
    return { steps, reads: reads.length, pa: tr.pa, table: sh };
  };

  VX.withCosts = function (costs, fn) {
    const V = S.Virt, keep = Object.assign({}, V.COST);
    Object.assign(V.COST, costs || {});
    try { return fn(); } finally { Object.assign(V.COST, keep); }
  };
})(globalThis.Proses = globalThis.Proses || {});
