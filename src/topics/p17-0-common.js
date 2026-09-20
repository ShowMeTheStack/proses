// Part 17, protection and security (defensive concepts only): the families, and the access-matrix drawing the
// protection topics share. Weaknesses are shown as concepts beside their defences; nothing here is a recipe.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'protection', order, title, blurb });
  fam('p17-principles', 10, 'Goals and principles', 'Least privilege, separation, and one mechanism serving many policies.');
  fam('p17-matrix', 20, 'Domains and the access matrix', 'Protection domains and rings, the access matrix and its operations, and four ways to store it: a global table, access lists, capabilities, locks and keys.');
  fam('p17-unix', 30, 'UNIX users and permissions', 'Owner, group and other bits checked path by path, the sticky bit, and setuid as a switch of domain that must be handled with care.');
  fam('p17-auth', 40, 'Authentication', 'Passwords stored salted and hashed, limits on guessing, and a second factor, as concepts.');
  fam('p17-memsafe', 50, 'Memory-safety defences', 'Why an unchecked copy is dangerous, and the defences: bounded copies, stack canaries, non-executable pages and randomised layouts.');
  fam('p17-sandbox', 60, 'Sandboxing and isolation', 'A policy of allowed calls and paths, and what two processes share or do not.');

  const H = S.P09, P17 = (S.P17 = S.P17 || {});
  /** the access matrix as a grid: rows are domains, columns objects then domains; cls(d, o) gives a cell its look */
  P17.matrix = function (M, o) {
    o = o || {};
    const P = o.prefix || 'am', x = o.x || 0, y = o.y || 0, size = 13, rh = o.rh || 34, items = [];
    const cols = (o.cols || S.Prot.columns(M));
    const txt = (d, ob) => S.Prot.rights(M, d, ob).join(', ');
    const cw = cols.map((ob) => Math.max(o.minW || 62, S.geom.textWidth(ob, 13, { bold: true }) + 18, ...M.domains.map((d) => S.geom.textWidth(txt(d, ob), size, { mono: true }) + 16)));
    const rw = o.rowW || 48;
    let cx = x + rw;
    const xs = cols.map((_, k) => { const v = cx; cx += cw[k] + 3; return v; });
    if (o.title) items.push(H.title(P + ':t', x, y - 40, o.title));
    cols.forEach((ob, k) => items.push({ key: P + ':c' + ob, kind: 'text', x: Math.round(xs[k] + cw[k] / 2), y: y - 10, text: ob, anchor: 'middle', size: 13, cls: 'colname' + (o.colCls ? ' ' + (o.colCls(ob) || '') : '') }));
    M.domains.forEach((d, i) => {
      const yy = y + i * (rh + 3);
      items.push({ key: P + ':r' + d, kind: 'text', x: x + rw - 10, y: yy + rh / 2 + 5, text: d, anchor: 'end', size: 14, cls: 'rowname' + (o.rowCls ? ' ' + (o.rowCls(d) || '') : '') });
      cols.forEach((ob, k) => items.push({ key: P + ':v' + d + '|' + ob, kind: 'cell', x: Math.round(xs[k]), y: yy, w: Math.round(cw[k]), h: rh, rx: 4, text: txt(d, ob), size, cls: 'amcell mono ' + (o.cls ? o.cls(d, ob) || '' : '') + (S.Prot.columns(M).indexOf(ob) >= M.objects.length ? ' dom' : '') }));
    });
    return { items, w: cx - x, h: M.domains.length * (rh + 3), cell: (d, ob) => { const k = cols.indexOf(ob), i = M.domains.indexOf(d); return { x: xs[k], y: y + i * (rh + 3), w: cw[k], h: rh }; } };
  };
  /** the matrix of a preset, as cells text "D|O: r, r; ..." for an input */
  P17.cellsText = (M) => Object.entries(M.cells).map(([k, v]) => k + ': ' + v.join(' ')).join('; ');
  P17.parseCells = (t) => {
    const cells = {};
    for (const part of String(t).split(';').map((x) => x.trim()).filter(Boolean)) {
      const m = part.match(/^([^|:]+)\|([^:]+):\s*(.*)$/);
      if (!m) throw new Error('"' + part + '" is not "Domain|Object: rights"');
      cells[m[1].trim() + '|' + m[2].trim()] = m[3].split(/[\s,]+/).filter(Boolean);
    }
    return cells;
  };
})(globalThis.Proses = globalThis.Proses || {});
