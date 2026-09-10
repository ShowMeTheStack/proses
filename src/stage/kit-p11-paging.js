// Small tables for part 11's pictures: a page table with its valid and dirty bits, a frame table with a policy's
// bits and counters, a list of fault-path steps with their costs. Plain rows of cells under a header row.
//   S.Kit.p11.table({prefix, x, y, cols: [{name, w, cls}], rows: [{key, cells: [text | {text, cls}], cls}],
//                    rowH, headH, size, title}) -> {items, w, h, row(key) -> {x, y, w, h}, cell(key, j) -> box}
//     a row's cls (act, hot, good, bad, dim) lights every cell of it; a cell's own cls adds to that
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const T = (K.p11 = {});
  const r2 = (v) => Math.round(v * 100) / 100;

  T.table = function (o) {
    const pre = o.prefix || 'tb', items = [], rh = o.rowH || 28, hh = o.headH || 26, fs = o.size || 13;
    const w = o.cols.reduce((a, c) => a + c.w, 0), rows = {}, cells = {};
    if (o.title) items.push({ key: pre + ':title', kind: 'text', x: o.x, y: o.y - 10, text: o.title, size: 13, cls: 'title' });
    let x = o.x;
    o.cols.forEach((c, j) => { items.push({ key: pre + ':h' + j, kind: 'cell', x: r2(x), y: o.y, w: c.w, h: hh, rx: 0, text: c.name, size: 12, cls: 'p11-th' }); x += c.w; });
    let y = o.y + hh;
    for (const r of o.rows) {
      x = o.x;
      r.cells.forEach((c, j) => {
        const cc = typeof c === 'object' && c !== null ? c : { text: c };
        const it = { key: pre + ':' + r.key + ':' + j, kind: 'cell', x: r2(x), y: r2(y), w: o.cols[j].w, h: rh, rx: 0, text: cc.text === undefined || cc.text === null ? '' : String(cc.text), size: fs, cls: 'p11-td ' + (o.cols[j].cls || '') + ' ' + (r.cls || '') + ' ' + (cc.cls || '') };
        if (r.info) it.info = r.info;
        items.push(it);
        cells[r.key + ':' + j] = { x, y, w: o.cols[j].w, h: rh };
        x += o.cols[j].w;
      });
      rows[r.key] = { x: o.x, y, w, h: rh };
      y += rh;
    }
    return { items, w, h: y - o.y, row: (k) => rows[k], cell: (k, j) => cells[k + ':' + j] };
  };
})(globalThis.Proses = globalThis.Proses || {});
