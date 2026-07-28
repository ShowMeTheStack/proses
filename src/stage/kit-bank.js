// Tables of the banker's algorithm: a matrix with its title and column names (Allocation, Max, Need), a vector
// (Available, Work, a request), the Finish column, and a sequence of process tags. Cells take meaning classes:
// 'act' (the row being checked), 'good' (fits, finished), 'hot' (the value that does not fit), 'changed'.
//   S.Kit.bank.matrix({prefix, x, y, cw, ch, gap, title, cols: [name..], rows: [name..] | null, vals: [[..]..],
//     cls(i, j) -> class, rowCls(i) -> class, size}) -> {items, w, h, cell(i, j)}   the title sits above the column
//     names; row names, when given, sit to the left
//   S.Kit.bank.vector({prefix, x, y, cw, ch, gap, title, vals, cls(j), titleW, cols}) -> {items, w, h}  a row of cells
//     with the title on its left (titleW wide), column names above when cols is given
//   S.Kit.bank.finish({prefix, x, y, cw, ch, gap, vals: [bool..], cls(i), title}) -> {items, w, h}
//   S.Kit.bank.seq({prefix, x, y, names: [..], cls(k), w, h, gap, title, titleW}) -> {items, w, h}
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const Bk = (K.bank = {});

  Bk.matrix = function (o) {
    const P = o.prefix || 'mx', cw = o.cw || 40, ch = o.ch || 32, gap = o.gap === undefined ? 3 : o.gap, size = o.size || 15, items = [];
    const nr = o.vals.length, nc = o.cols.length;
    const cell = (i, j) => ({ x: o.x + j * (cw + gap), y: o.y + i * (ch + gap), w: cw, h: ch });
    const W = nc * (cw + gap) - gap;
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x + W / 2, y: o.y - 34, text: o.title, anchor: 'middle', size: 14, cls: 'tbltitle ' + (o.titleCls || '') });
    o.cols.forEach((c, j) => items.push({ key: P + ':c' + j, kind: 'text', x: o.x + j * (cw + gap) + cw / 2, y: o.y - 10, text: c, anchor: 'middle', size: 13, cls: 'colname' }));
    if (o.rows) o.rows.forEach((r, i) => items.push({ key: P + ':r' + i, kind: 'text', x: o.x - 10, y: o.y + i * (ch + gap) + ch / 2 + 5, text: r, anchor: 'end', size: 14, cls: 'rowname ' + (o.rowCls ? o.rowCls(i) || '' : '') }));
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const b = cell(i, j);
      items.push({ key: P + ':v' + i + '_' + j, kind: 'cell', x: b.x, y: b.y, w: cw, h: ch, rx: 4, text: String(o.vals[i][j]), size, cls: 'num ' + (o.cls ? o.cls(i, j) || '' : '') });
    }
    return { items, w: W, h: nr * (ch + gap) - gap, cell };
  };

  Bk.vector = function (o) {
    const P = o.prefix || 'vc', cw = o.cw || 40, ch = o.ch || 32, gap = o.gap === undefined ? 3 : o.gap, tW = o.titleW || 0, items = [];
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x, y: o.y + ch / 2 + 5, text: o.title, size: 14, cls: 'vecname ' + (o.titleCls || '') });
    const x0 = o.x + tW;
    if (o.cols) o.cols.forEach((c, j) => items.push({ key: P + ':c' + j, kind: 'text', x: x0 + j * (cw + gap) + cw / 2, y: o.y - 10, text: c, anchor: 'middle', size: 13, cls: 'colname' }));
    o.vals.forEach((v, j) => items.push({ key: P + ':v' + j, kind: 'cell', x: x0 + j * (cw + gap), y: o.y, w: cw, h: ch, rx: 4, text: String(v), size: o.size || 15, cls: 'num ' + (o.cls ? o.cls(j) || '' : ''), pulse: !!o.pulse }));
    return { items, w: tW + o.vals.length * (cw + gap) - gap, h: ch };
  };

  Bk.finish = function (o) {
    const P = o.prefix || 'fn', cw = o.cw || 54, ch = o.ch || 32, gap = o.gap === undefined ? 3 : o.gap, items = [];
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x + cw / 2, y: o.y - 34, text: o.title, anchor: 'middle', size: 14, cls: 'tbltitle' });
    o.vals.forEach((f, i) => items.push({ key: P + ':v' + i, kind: 'cell', x: o.x, y: o.y + i * (ch + gap), w: cw, h: ch, rx: 4, text: f ? 'true' : 'false', size: 13, cls: 'fin ' + (f ? 'yes ' : 'no ') + (o.cls ? o.cls(i) || '' : '') }));
    return { items, w: cw, h: o.vals.length * (ch + gap) - gap };
  };

  Bk.seq = function (o) {
    const P = o.prefix || 'sq', w = o.w || 42, h = o.h || 30, gap = o.gap || 22, tW = o.titleW || 0, items = [];
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x, y: o.y + h / 2 + 5, text: o.title, size: 14, cls: 'vecname' });
    o.names.forEach((nm, k) => {
      const x = o.x + tW + k * (w + gap);
      items.push({ key: P + ':s' + k, kind: 'cell', x, y: o.y, w, h, rx: 6, text: nm, size: 14, cls: 'seqcell ' + (o.cls ? o.cls(k) || '' : '') });
      if (k) items.push({ key: P + ':a' + k, kind: 'text', x: x - gap / 2, y: o.y + h / 2 + 5, text: '→', anchor: 'middle', size: 15, cls: 'seqarrow' });
    });
    return { items, w: tW + o.names.length * (w + gap) - gap, h };
  };
})(globalThis.Proses = globalThis.Proses || {});
