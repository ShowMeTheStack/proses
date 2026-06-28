// Heat maps on the stage: a matrix drawn as cells whose colour carries the value (an access matrix, the Need and
// Allocation tables of the banker's algorithm, a page-fault count per policy and frame count), with the numbers in
// the cells when there is room, row and column names, and a colour bar.
//   S.Kit.heat.colour(v, scheme, max) -> {fill, text} CSS colours for a value:
//     'seq' (0..max, none to the accent), 'div' (−max..max, vermilion through neutral to blue), 'good' (0..max, green)
//   S.Kit.heat.grid({prefix, x, y, cw, ch, vals: [[..]..], scheme, max, fmt(v) | null, rows: [..], cols: [..],
//                   size, cls(i, j), gap, title, colsAt: 'top' | 'bottom'}) -> {items, w, h, cell(i, j) -> {x, y, w, h}}
//   S.Kit.heat.bar({prefix, x, y, w, h, scheme, max, min, ticks, fmt}) -> a colour bar with its ends named
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const HM = (K.heat = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const pct = (t) => Math.round(Math.max(0, Math.min(1, t)) * 100);

  HM.colour = function (v, scheme, max) {
    max = max || 1;
    if (scheme === 'div') {
      const t = Math.max(-1, Math.min(1, v / max)), c = t < 0 ? '--neg' : '--pos';
      return { fill: `color-mix(in srgb, var(${c}) ${pct(Math.abs(t) * 0.92)}%, var(--div-mid))`, text: Math.abs(t) > 0.55 ? 'var(--st-bg)' : 'var(--text)' };
    }
    const t = Math.max(0, Math.min(1, v / max)), c = scheme === 'good' ? '--good' : scheme === 'bad' ? '--bad' : scheme === 'c0' ? '--cls0' : scheme === 'c1' ? '--cls1' : '--heat1';
    return { fill: `color-mix(in srgb, var(${c}) ${pct(t * 0.9)}%, var(--heat0))`, text: t > 0.55 ? 'var(--st-bg)' : 'var(--text)' };
  };

  HM.grid = function (o) {
    const P = o.prefix || 'hm', vals = o.vals, nr = vals.length, nc = nr ? vals[0].length : 0;
    const cw = o.cw || 40, ch = o.ch || cw, gap = o.gap === undefined ? 2 : o.gap, fs = o.size || Math.min(14, Math.max(11, Math.floor(Math.min(cw / 3.6, ch / 1.8))));
    const items = [], cell = (i, j) => ({ x: r2(o.x + j * (cw + gap)), y: r2(o.y + i * (ch + gap)), w: cw, h: ch });
    const fmt = o.fmt === undefined ? (v) => String(+(+v).toFixed(2)).replace(/^-/, '−').replace(/^0\./, '.').replace(/^−0\./, '−.') : o.fmt;
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const v = vals[i][j], c = HM.colour(v, o.scheme || 'seq', o.max), b = cell(i, j);
      const extra = o.cls ? o.cls(i, j) || '' : '';
      items.push({ key: P + ':c' + i + '_' + j, kind: 'cell', x: b.x, y: b.y, w: cw, h: ch, rx: o.rx === undefined ? 3 : o.rx, text: fmt ? fmt(v) : '', size: fs, cls: 'hm ' + extra, paint: { fill: c.fill, text: c.text }, pick: !!o.pick });
    }
    const ls = o.labelSize || 13;
    if (o.rows) o.rows.forEach((t, i) => items.push({ key: P + ':r' + i, kind: 'text', x: r2(o.x - 8), y: r2(o.y + i * (ch + gap) + ch / 2 + ls * 0.35), text: t, anchor: 'end', size: ls, cls: 'hmname ' + (o.rowCls ? o.rowCls(i) || '' : '') }));
    if (o.cols) o.cols.forEach((t, j) => items.push({ key: P + ':k' + j, kind: 'text', x: r2(o.x + j * (cw + gap) + cw / 2), y: o.colsAt === 'bottom' ? r2(o.y + nr * (ch + gap) + ls + 4) : r2(o.y - 8), text: t, anchor: 'middle', size: ls, cls: 'hmname ' + (o.colCls ? o.colCls(j) || '' : '') }));
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x, y: r2(o.y - (o.cols && o.colsAt !== 'bottom' ? ls + 18 : 10)), text: o.title, size: o.titleSize, cls: o.titleCls || 'title' });
    return { items, w: nc * (cw + gap) - gap, h: nr * (ch + gap) - gap, cell };
  };

  /** a colour bar: a strip of cells from min to max with the two ends (and the middle of a diverging bar) named */
  HM.bar = function (o) {
    const P = o.prefix || 'hb', n = o.n || 24, items = [], min = o.min === undefined ? (o.scheme === 'div' ? -(o.max || 1) : 0) : o.min, max = o.max || 1;
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(min + ((max - min) * (i + 0.5)) / n);
    const vert = o.h > o.w;
    items.push({ key: P + ':strip', kind: 'raster', x: o.x, y: o.y, w: o.w, h: o.h, nx: vert ? 1 : n, ny: vert ? n : 1, vals: vert ? vals.slice().reverse() : vals, scheme: o.scheme === 'div' ? 'div' : 'seq', max: o.scheme === 'div' ? max : max, smooth: true });
    const fmt = o.fmt || ((v) => String(+v.toPrecision(2)).replace(/^-/, '−'));
    const fs = o.size || 12;
    if (vert) {
      items.push({ key: P + ':hi', kind: 'text', x: r2(o.x + o.w + 6), y: r2(o.y + fs * 0.8), text: fmt(max), size: fs, cls: 'tick' });
      items.push({ key: P + ':lo', kind: 'text', x: r2(o.x + o.w + 6), y: r2(o.y + o.h), text: fmt(min), size: fs, cls: 'tick' });
    } else {
      items.push({ key: P + ':lo', kind: 'text', x: o.x, y: r2(o.y + o.h + fs + 4), text: fmt(min), size: fs, cls: 'tick' });
      items.push({ key: P + ':hi', kind: 'text', x: r2(o.x + o.w), y: r2(o.y + o.h + fs + 4), text: fmt(max), anchor: 'end', size: fs, cls: 'tick' });
      if (o.label) items.push({ key: P + ':nm', kind: 'text', x: r2(o.x + o.w / 2), y: r2(o.y + o.h + fs + 4), text: o.label, anchor: 'middle', size: fs, cls: 'tick' });
    }
    return items;
  };
})(globalThis.Proses = globalThis.Proses || {});
