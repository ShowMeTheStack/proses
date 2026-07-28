// Memory on the stage: an address as a strip of coloured bit fields, a page-table page with the entry an index
// picks, the frames of a reference string step by step, and the clock's ring of frames with its hand and use bits.
// Levels are told apart by colour (lv0..lv4, the offset lvoff), the same on the strip and on the tables.
//   S.Kit.mem.lv(i)  the class of level i (−1: the offset)
//   S.Kit.mem.strip({prefix, x, y, fields: [{name, bits, value, cls, label}], bitW, h, va, total, bits: bool,
//                    act: [field indexes], size}) -> {items, w, h, field(i) -> {x, w}}
//     bits: one cell a bit with its digit and the bit numbers at the ends of each field; else one cell a field
//     holding its value
//   S.Kit.mem.table({prefix, x, y, w, rowH, idxW, title, sub, cls, n, sel, entry(i) -> {text, cls}, act, fault,
//                    dim, size}) -> {items, w, h, row(i) -> {x, y, w, h}}
//     rows 0, the selected index and n − 1, with ⋮ between rows that are not neighbours
//   S.Kit.mem.grid({prefix, x, y, cw, ch, labelW, refs, nFrames, steps, upto, cur, size}) -> {items, w, h}
//     the reference string across the top, a row a frame, one column a reference up to step upto, then F or ✓;
//     the column cur (default upto, −1 none) is lit
//   S.Kit.mem.ring({prefix, cx, cy, R, frames, use, hand, act, victim, cleared, boxW, boxH, size}) -> {items}
//     the frames round a circle (frame 0 at the top, clockwise), each with its page and use bit, and the hand
//   S.Kit.mem.row({prefix, x, y, cw, ch, title, cells: [{text, cls, sub}], size}) -> {items, w, h}
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const KM = (K.mem = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  KM.lv = (i) => (i < 0 ? 'lvoff' : 'lv' + (i % 5));

  KM.strip = function (o) {
    const P = o.prefix || 'bs', items = [], bw = o.bitW, h = o.h || 30, total = o.total, fs = o.size || 13;
    const act = new Set(o.act || []);
    const pos = [];
    let at = o.x;
    o.fields.forEach((f, k) => {
      const w = o.bits ? f.bits * bw : f.w, x = at;
      pos.push({ x, w });
      at += w;
      const cls = 'mb-field ' + f.cls + (act.has(k) ? ' act' : '') + (f.dim ? ' dim' : '');
      if (o.bits) {
        items.push({ key: P + ':f' + k, kind: 'region', x: r2(x), y: o.y, w: r2(w), h, rx: 3, text: '', cls, audit: 'group', layer: 'back' });
        for (let b = f.hi; b >= f.lo; b--) {
          const bx = x + (f.hi - b) * bw;
          items.push({ key: P + ':b' + b, kind: 'cell', x: r2(bx), y: o.y, w: r2(bw), h, rx: 0, text: o.va === undefined ? '' : String((o.va >> BigInt(b)) & 1n), size: fs, cls: 'mb-bit ' + f.cls });
        }
        // the bit numbers at the field's two ends
        items.push({ key: P + ':hi' + k, kind: 'text', x: r2(x + bw / 2), y: o.y - 8, text: String(f.hi), anchor: 'middle', size: 12, cls: 'tick' });
        if (f.bits > 2) items.push({ key: P + ':lo' + k, kind: 'text', x: r2(x + w - bw / 2), y: o.y - 8, text: String(f.lo), anchor: 'middle', size: 12, cls: 'tick' });
      } else {
        items.push({ key: P + ':f' + k, kind: 'cell', x: r2(x), y: o.y, w: r2(w), h, rx: 4, text: f.text === undefined ? String(f.value) : f.text, size: fs, cls: cls + ' mb-fcell' });
      }
      if (f.label) items.push({ key: P + ':n' + k, kind: 'text', x: r2(x + w / 2), y: o.y + h + 19, text: f.label, anchor: 'middle', size: o.labelSize || 13, cls: 'mb-flabel ' + f.cls });
    });
    return { items, w: at - o.x, h: h + 26, field: (i) => pos[i] };
  };

  KM.table = function (o) {
    const P = o.prefix || 'pt', items = [], w = o.w, rh = o.rowH || 28, iw = o.idxW || 46, fs = o.size || 13, n = o.n;
    const hh = o.headH || 44;
    const state = o.fault ? ' fault' : o.act ? ' act' : '';
    items.push({ key: P + ':head', kind: 'cell', x: o.x, y: o.y, w, h: hh, rx: 5, lines: o.sub ? [o.title, o.sub] : [o.title], size: fs, cls: 'mb-thead ' + (o.cls || '') + state + (o.dim ? ' dim' : '') });
    const show = [...new Set([0, o.sel, n - 1].filter((v) => v >= 0 && v < n))].sort((a, b) => a - b);
    const rows = {};
    let y = o.y + hh + 4, g = 0;
    show.forEach((idx, j) => {
      if (j > 0 && idx > show[j - 1] + 1) {
        items.push({ key: P + ':gap' + g++, kind: 'cell', x: o.x, y, w, h: rh * 0.72, rx: 0, text: '⋮', size: fs, cls: 'mb-gap' + (o.dim ? ' dim' : '') });
        y += rh * 0.72;
      }
      const e = o.entry(idx) || { text: '' }, sel = idx === o.sel;
      const cls = sel ? (o.fault ? ' hot' : o.act ? ' act' : o.done ? ' done' : '') : '';
      items.push({ key: P + ':i' + (sel ? 's' : idx), kind: 'cell', x: o.x, y: r2(y), w: iw, h: rh, rx: 0, text: String(idx), size: 12, cls: 'mb-idx ' + (sel ? (o.cls || '') + ' sel' : '') + (o.dim ? ' dim' : '') });
      items.push({ key: P + ':e' + (sel ? 's' : idx), kind: 'cell', x: o.x + iw, y: r2(y), w: w - iw, h: rh, rx: 0, text: e.text, size: fs, cls: 'mb-entry ' + (e.cls || '') + cls + (o.dim ? ' dim' : '') });
      rows[idx] = { x: o.x, y: r2(y), w, h: rh };
      y += rh;
    });
    return { items, w, h: y - o.y, row: (i) => rows[i] };
  };

  KM.grid = function (o) {
    const P = o.prefix || 'rg', items = [], cw = o.cw, ch = o.ch, lw = o.labelW || 40, fs = o.size || 14, n = o.nFrames, refs = o.refs;
    const x0 = o.x + lw, upto = o.upto, cur = o.cur === undefined ? upto : o.cur;
    // the current column, lit behind its cells
    if (cur >= 0 && cur < refs.length) items.push({ key: P + ':col', kind: 'region', x: r2(x0 + cur * cw - 2), y: o.y - 3, w: cw + 4, h: (n + 1) * ch + 10, rx: 5, text: '', cls: 'mb-col', audit: 'overlap-ok', layer: 'back' });
    items.push({ key: P + ':reflab', kind: 'text', x: o.x + lw - 8, y: r2(o.y + ch / 2 + 4.5), text: 'ref', anchor: 'end', size: 12, cls: 'tick' });
    refs.forEach((p, j) => items.push({ key: P + ':r' + j, kind: 'cell', x: r2(x0 + j * cw), y: o.y, w: cw, h: ch, rx: 0, text: String(p), size: fs, cls: 'mb-ref' + (j === cur ? ' act' : j > upto ? ' dim' : '') }));
    for (let r = 0; r < n; r++) {
      const y = o.y + (r + 1) * ch + 4;
      items.push({ key: P + ':fl' + r, kind: 'text', x: o.x + lw - 8, y: r2(y + ch / 2 + 4.5), text: 'f' + r, anchor: 'end', size: 12, cls: 'tick' });
      for (let j = 0; j <= upto && j < refs.length; j++) {
        const st = o.steps[j], page = st.frames[r];
        let cls = 'mb-slot';
        if (st.slot === r) cls += st.hit ? ' hit' : ' in';
        if (page === null) cls += ' empty';
        items.push({ key: P + ':c' + j + '_' + r, kind: 'cell', x: r2(x0 + j * cw), y: r2(y), w: cw, h: ch, rx: 0, text: page === null ? '' : String(page), size: fs, cls });
      }
    }
    const yr = o.y + (n + 1) * ch + 4 + ch / 2 + 6;
    for (let j = 0; j <= upto && j < refs.length; j++) items.push({ key: P + ':m' + j, kind: 'text', x: r2(x0 + j * cw + cw / 2), y: r2(yr + 5), text: o.steps[j].hit ? '✓' : 'F', anchor: 'middle', size: 14, cls: o.steps[j].hit ? 'good' : 'bad' });
    return { items, w: lw + refs.length * cw, h: (n + 2) * ch + 14 };
  };

  KM.ring = function (o) {
    const P = o.prefix || 'ck', items = [], n = o.frames.length, R = o.R, bw = o.boxW || 58, bh = o.boxH || 46, fs = o.size || 14;
    const cleared = new Set(o.cleared || []);
    items.push({ key: P + ':ring', kind: 'path', d: `M${r2(o.cx - R)},${o.cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0`, cls: 'mb-ring', audit: 'ignore', layer: 'back' });
    const lab = o.labR || R + Math.max(bw, bh) / 2 + 20;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n, x = o.cx + R * Math.cos(a), y = o.cy + R * Math.sin(a);
      const page = o.frames[k], u = o.use[k];
      let cls = 'mb-cframe ' + (page === null ? 'empty' : u ? 'u1' : 'u0');
      if (k === o.victim) cls += ' hot'; else if (k === o.act) cls += ' act';
      if (cleared.has(k)) cls += ' cleared';
      items.push({ key: P + ':s' + k, kind: 'cell', x: r2(x - bw / 2), y: r2(y - bh / 2), w: bw, h: bh, rx: 6, lines: page === null ? ['free', ''] : [String(page), 'use ' + u], size: fs, cls });
      const lx = o.cx + lab * Math.cos(a), ly = o.cy + lab * Math.sin(a), c = Math.cos(a);
      items.push({ key: P + ':l' + k, kind: 'text', x: r2(lx), y: r2(ly + 4.5), text: 'f' + k, anchor: Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end', size: 12, cls: 'tick' });
    }
    items.push({ key: P + ':hub', kind: 'dot', x: o.cx, y: o.cy, r: 5, cls: 'mb-hub' });
    items.push({ key: P + ':hand', kind: 'edge', from: { x: o.cx, y: o.cy }, to: P + ':s' + o.hand, cls: 'act mb-hand', head: true });
    return { items };
  };

  KM.row = function (o) {
    const P = o.prefix || 'ro', items = [], cw = o.cw, ch = o.ch, fs = o.size || 14;
    if (o.title) items.push({ key: P + ':t', kind: 'text', x: o.x, y: o.y - 9, text: o.title, size: 12, cls: 'tick' });
    o.cells.forEach((c, i) => items.push({ key: P + ':' + (c.key === undefined ? i : c.key), kind: 'cell', x: r2(o.x + i * (cw + 4)), y: o.y, w: cw, h: ch, rx: 4, text: c.text, size: fs, cls: 'mb-ord ' + (c.cls || '') }));
    return { items, w: o.cells.length * (cw + 4) - 4, h: ch };
  };
})(globalThis.Proses = globalThis.Proses || {});
