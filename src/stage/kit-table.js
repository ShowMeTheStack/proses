// A table for the topic player's definition panel (a section {kind: 'table', id, title, cols, rows, note}): plain
// HTML rather than stage items, since it sits in the side panel and must wrap and scroll like any table there.
//   S.Kit.table.html({cols: [name..], rows: [[cell..]..], hl: [row indexes or row keys, as strings], keys: [row key..],
//     note, caption}) -> a .fit-table element holding the table; a cell is text or {text, cls}, the first cell of a
//     row is its heading; a lit row gets class hl (the player keeps it in view). S.Kit.table.text(cell) -> its text.
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const T = (K.table = {});
  T.text = (c) => (c && typeof c === 'object' ? String(c.text === undefined ? '' : c.text) : String(c === undefined || c === null ? '' : c));
  T.html = function (o) {
    const doc = document, el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const lit = new Set([].concat(o.hl === undefined ? [] : o.hl).map(String));
    const table = el('table', 'def-table');
    if (o.caption) table.appendChild(el('caption', '', o.caption));
    if (o.cols && o.cols.length) { const tr = el('tr'); for (const c of o.cols) tr.appendChild(el('th', '', T.text(c))); const th = el('thead'); th.appendChild(tr); table.appendChild(th); }
    const body = el('tbody');
    (o.rows || []).forEach((r, i) => {
      const key = o.keys && o.keys[i] !== undefined ? String(o.keys[i]) : null;
      const tr = el('tr', lit.has(String(i)) || (key !== null && lit.has(key)) ? 'hl' : '');
      [].concat(r).forEach((c, j) => tr.appendChild(el(j === 0 ? 'th' : 'td', c && typeof c === 'object' && c.cls ? c.cls : '', T.text(c))));
      body.appendChild(tr);
    });
    table.appendChild(body);
    const wrap = el('div', 'fit-table def-table-wrap');
    wrap.appendChild(table);
    if (o.note) wrap.appendChild(el('p', 'def-note', o.note));
    return wrap;
  };
})(globalThis.Proses = globalThis.Proses || {});
