// Disks and file systems: a block map of a disk image (each block coloured by its region, data blocks by use), a
// legend, titled columns of slots (an inode's pointers, an indirect block's entries), a row of bytes, RAID stripes
// (disks as columns, stripes as rows), an XOR worked bit by bit, a strip of journal blocks and a numbered row of
// writes with the place the power was cut. Every function returns {items, w, h} and keys everything with o.prefix.
//   S.Kit.disk.map({prefix, x, y, g, cols, cw, ch, gap, used(b), look(b), text(b), size}) -> + at(b)
//   S.Kit.disk.legend({prefix, x, y, entries: [{cls, text}], maxW, size})
//   S.Kit.disk.para({prefix, x, y, text, maxW, size, cls, lh})          wrapped lines of text
//   S.Kit.disk.slots({prefix, x, y, w, title, rows: [{id, label, value, cls}], labelW, rh, size}) -> + row(id)
//   S.Kit.disk.bytes({prefix, x, y, cw, ch, cells: [{text, sub, cls}], size})
//   S.Kit.disk.grid({prefix, x, y, n, rows, cw, ch, gap, rowHeadW, head(d), rowHead(s), cell(s, d), size}) -> + at(s, d)
//   S.Kit.disk.bits({prefix, x, y, rows: [{label, hex, bits, cls}], labelW, bw, rh, hot: Set(col), rule: k})
//   S.Kit.disk.writes({prefix, x, y, maxW, list: [{text, cls}], cw, ch, gap, crashAfter})
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const D = (K.disk = {});
  const RCLS = { super: 'dk-sb', ibm: 'dk-ibm', dbm: 'dk-dbm', itable: 'dk-it', journal: 'dk-jn', data: 'dk-data' };
  const R = Math.round;
  D.RCLS = RCLS;
  /** the colour class of block b: its region, and for the data region whether it is in use */
  D.regionCls = (g, b, used) => { const r = S.FS.region(g, b); return r === 'data' ? (used ? 'dk-data' : 'dk-free') : RCLS[r]; };
  /** the standard legend entries for a layout */
  D.layoutLegend = (g) => [{ cls: 'dk-sb', text: 'superblock' }, { cls: 'dk-ibm', text: 'inode bitmap' }, { cls: 'dk-dbm', text: 'data bitmap' }, { cls: 'dk-it', text: 'inode table' }]
    .concat(g.jblocks ? [{ cls: 'dk-jn', text: 'journal' }] : []).concat([{ cls: 'dk-data', text: 'data, in use' }, { cls: 'dk-free', text: 'data, free' }]);

  D.map = function (o) {
    const g = o.g, cols = o.cols, cw = o.cw, ch = o.ch, gap = o.gap === undefined ? 3 : o.gap, items = [], size = o.size || 12;
    const pos = (b) => ({ x: R(o.x + (b % cols) * (cw + gap)), y: R(o.y + Math.floor(b / cols) * (ch + gap)), w: cw, h: ch });
    for (let b = 0; b < g.nblocks; b++) {
      const p = pos(b), used = o.used ? o.used(b) : true, extra = o.look ? o.look(b) || '' : '';
      items.push({ key: o.prefix + ':b' + b, kind: 'cell', x: p.x, y: p.y, w: cw, h: ch, rx: 3, text: o.text ? o.text(b) : String(b), size, cls: ('dk ' + D.regionCls(g, b, used) + ' ' + extra).trim() });
    }
    const rows = Math.ceil(g.nblocks / cols);
    return { items, w: cols * (cw + gap) - gap, h: rows * (ch + gap) - gap, at: (b) => { const p = pos(b); return Object.assign(p, { cx: p.x + cw / 2, cy: p.y + ch / 2 }); } };
  };

  D.legend = function (o) {
    const size = o.size || 13, sw = size + 3, items = [], gapX = 20, rowH = size + 13;
    let x = o.x, y = o.y, w = 0;
    o.entries.forEach((e, i) => {
      const tw = S.geom.textWidth(e.text, size) + 4, need = sw + 7 + tw;
      if (o.maxW && x > o.x && x - o.x + need > o.maxW) { x = o.x; y += rowH; }
      items.push({ key: o.prefix + ':s' + i, kind: 'cell', x: R(x), y: R(y), w: sw, h: sw, rx: 3, text: '', cls: 'dk swatch ' + e.cls, audit: 'ignore' });
      items.push({ key: o.prefix + ':t' + i, kind: 'text', x: R(x + sw + 7), y: R(y + sw / 2 + size * 0.36), text: e.text, size, cls: 'dk-leg' });
      x += need + gapX; w = Math.max(w, x - gapX - o.x);
    });
    return { items, w, h: y - o.y + sw };
  };

  /** text broken into lines no wider than maxW */
  D.wrap = function (text, maxW, size, opts) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (line && S.geom.textWidth(t, size, opts) > maxW) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  D.para = function (o) {
    const size = o.size || 14, lh = o.lh || Math.round(size * 1.45), lines = D.wrap(o.text, o.maxW, size, { bold: /strong|good|bad|hot/.test(o.cls || ''), mono: /mono/.test(o.cls || '') });
    const items = lines.map((l, i) => ({ key: o.prefix + ':l' + i, kind: 'text', x: R(o.x), y: R(o.y + i * lh + size * 0.8), text: l, size, cls: o.cls || '' }));
    return { items, h: lines.length * lh, lines: lines.length };
  };

  D.slots = function (o) {
    const rh = o.rh || 28, size = o.size || 13, lw = o.labelW === undefined ? 64 : o.labelW, items = [], at = {};
    let y = o.y;
    if (o.title) { items.push({ key: o.prefix + ':title', kind: 'text', x: R(o.x), y: R(y + size * 0.8), text: o.title, size: size + 1, cls: 'strong ' + (o.titleCls || '') }); y += size + 12; }
    o.rows.forEach((r) => {
      const k = o.prefix + ':' + r.id;
      if (lw) items.push({ key: k + ':l', kind: 'cell', x: R(o.x), y: R(y), w: lw, h: rh - 2, rx: 0, text: r.label, size: size - 1, cls: 'dk slot-l ' + (r.cls || '') });
      items.push({ key: k + ':v', kind: 'cell', x: R(o.x + lw), y: R(y), w: o.w - lw, h: rh - 2, rx: 0, text: r.value, size, cls: 'dk slot-v mono ' + (r.cls || '') });
      at[r.id] = { x: o.x, y, w: o.w, h: rh - 2, cy: y + (rh - 2) / 2 };
      y += rh;
    });
    return { items, w: o.w, h: y - o.y, row: (id) => at[id], top: o.title ? o.y + size + 12 : o.y };
  };

  D.bytes = function (o) {
    const items = [], size = o.size || 14;
    o.cells.forEach((c, i) => items.push({ key: o.prefix + ':c' + i, kind: 'cell', x: R(o.x + i * o.cw), y: R(o.y), w: o.cw, h: o.ch, rx: 0, text: c.text, sub: c.sub, size, cls: 'dk byte mono ' + (c.cls || '') }));
    return { items, w: o.cells.length * o.cw, h: o.ch + (o.cells.some((c) => c.sub) ? 20 : 0) };
  };

  D.grid = function (o) {
    const items = [], gap = o.gap === undefined ? 6 : o.gap, rhw = o.rowHeadW || 0, size = o.size || 13, top = o.head ? 30 : 0;
    const at = (s, d) => ({ x: R(o.x + rhw + d * (o.cw + gap)), y: R(o.y + top + s * (o.ch + gap)), w: o.cw, h: o.ch });
    for (let d = 0; d < o.n; d++) if (o.head) { const h = o.head(d); items.push({ key: o.prefix + ':h' + d, kind: 'text', x: R(at(0, d).x + o.cw / 2), y: R(o.y + 16), text: h.text, anchor: 'middle', size: size + 1, cls: h.cls || 'strong' }); }
    for (let s = 0; s < o.rows; s++) {
      if (o.rowHead) items.push({ key: o.prefix + ':r' + s, kind: 'text', x: R(o.x + rhw - 12), y: R(at(s, 0).y + o.ch / 2 + 5), text: o.rowHead(s), anchor: 'end', size, cls: 'tick' });
      for (let d = 0; d < o.n; d++) {
        const c = o.cell(s, d), p = at(s, d);
        if (!c) continue;
        items.push(Object.assign({ key: o.prefix + ':' + s + '.' + d, kind: 'cell', x: p.x, y: p.y, w: o.cw, h: o.ch, rx: 4, size }, c, { cls: 'dk ' + (c.cls || '') }));
      }
    }
    return { items, w: rhw + o.n * (o.cw + gap) - gap, h: top + o.rows * (o.ch + gap) - gap, at };
  };

  D.bits = function (o) {
    const items = [], bw = o.bw || 26, rh = o.rh || 30, lw = o.labelW || 120, hot = o.hot || new Set(), size = o.size || 14;
    o.rows.forEach((r, i) => {
      const y = o.y + i * rh + (o.rule !== undefined && i >= o.rule ? 10 : 0), k = o.prefix + ':' + i;
      items.push({ key: k + ':l', kind: 'text', x: R(o.x + lw - 10), y: R(y + rh / 2 + 5), text: r.label, anchor: 'end', size: size - 1, cls: r.cls === 'res' ? 'strong' : 'dk-leg' });
      r.bits.forEach((b, j) => items.push({ key: k + ':b' + j, kind: 'cell', x: R(o.x + lw + j * bw), y: R(y + 2), w: bw - 2, h: rh - 4, rx: 3, text: String(b), size, cls: 'dk bit mono ' + (b ? 'one ' : 'zero ') + (r.cls || '') + (hot.has(j) ? ' col' : '') }));
      if (r.hex !== undefined) items.push({ key: k + ':x', kind: 'text', x: R(o.x + lw + 8 * bw + 12), y: R(y + rh / 2 + 5), text: r.hex, size: size - 1, cls: 'mono' + (r.cls === 'res' ? ' act' : '') });
    });
    if (o.rule !== undefined) {
      const y = o.y + o.rule * rh + 5;
      items.push({ key: o.prefix + ':rule', kind: 'line', x1: R(o.x + lw - 30), y1: R(y), x2: R(o.x + lw + 8 * bw), y2: R(y), cls: 'rule', audit: 'ignore' });
    }
    return { items, w: lw + 8 * bw + 60, h: o.rows.length * rh + (o.rule !== undefined ? 10 : 0) };
  };

  D.writes = function (o) {
    const items = [], gap = o.gap === undefined ? 8 : o.gap, per = Math.max(1, Math.floor((o.maxW + gap) / (o.cw + gap))), size = o.size || 13;
    const pos = (i) => ({ x: R(o.x + (i % per) * (o.cw + gap)), y: R(o.y + Math.floor(i / per) * (o.ch + gap + 14)) });
    o.list.forEach((w, i) => { const p = pos(i); items.push({ key: o.prefix + ':w' + i, kind: 'cell', x: p.x, y: p.y, w: o.cw, h: o.ch, rx: 6, text: w.text, lines: w.lines, size, cls: 'dk wr ' + (w.cls || '') }); });
    const k = o.crashAfter;
    if (k !== undefined && k !== null && k < o.list.length) {
      const p = pos(k), x = k % per === 0 ? p.x - gap / 2 - 1 : p.x - gap / 2;
      items.push({ key: o.prefix + ':cut', kind: 'line', x1: R(x), y1: R(p.y - 8), x2: R(x), y2: R(p.y + o.ch + 8), cls: 'cut', audit: 'ignore' });
    }
    const rows = Math.ceil(o.list.length / per);
    return { items, w: Math.min(o.list.length, per) * (o.cw + gap) - gap, h: rows * (o.ch + gap + 14) - gap - 14, at: pos, per };
  };
})(globalThis.Proses = globalThis.Proses || {});
