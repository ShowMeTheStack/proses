// Tables to fill in: a schedule's finish and waiting times, the frames after each reference, a banker's Need table,
// or any table an exercise spells out.
// S.Check.tableSpec(x) gives the layout and the expected value of every cell, and the checker compares cell by cell. More kinds of table register in S.Check.tables:
//   S.Check.tables.mykind = (x) => ({ rows, cols, corner, cell(r, c) -> key | null, expected: {key: text}, kind })
// kind 'text' compares text (case and spaces ignored), 'number' a number (to within the exercise's tolerance),
// 'bit' a single 0 or 1, 'set' a list like a, b.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  K.kinds = K.kinds || {};
  K.tables = K.tables || {};

  /** a custom table: rows, cols and cells {"row|col": expected} given by the exercise */
  K.tables.custom = (x) => {
    const cells = x.cells || {};
    return { rows: x.rows, cols: x.cols, corner: x.corner || '', cell: (r, c) => { const k = x.rows[r] + '|' + x.cols[c]; return k in cells ? k : null; }, expected: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])), kind: x.cellKind || (Object.values(cells).every((v) => typeof v === 'number') ? 'number' : 'text'), tolerance: x.tolerance || 0 };
  };
  K.tableSpec = function (x) {
    const make = K.tables[x.table || 'custom'];
    if (!make) throw new Error('unknown table ' + x.table);
    return make(x);
  };

  // a minus sign typed as U+2212 (or a dash) reads the same as a hyphen-minus
  K.unminus = (t) => String(t === undefined || t === null ? '' : t).replace(/[\u2212\u2012\u2013\uFE63\uFF0D]/g, '-');
  const sameSet = (a, b) => { const A = K.asSet(a), B = K.asSet(b); return A.length === B.length && A.every((v, i) => v === B[i]); };
  // x (the exercise) brings synonyms and caseless: a text cell (always caseless) or a set cell's element that is any
  // word of a synonym group reads as the group's first
  K.cellRight = function (kind, want, got, tol, x) {
    want = K.unminus(want); got = K.unminus(got);
    if (x && x.synonyms && K.synonym && (kind === 'text' || kind === 'set')) {
      const y = Object.assign({}, x, { caseless: kind === 'text' ? true : x.caseless });
      const map = (v) => (kind === 'set' ? K.asSet(v).map((e) => K.synonym(y, e)).join(', ') : K.synonym(y, v));
      want = map(want); got = map(got === undefined ? '' : got);
    }
    if (kind === 'set' && x && x.caseless) { want = String(want).toLowerCase(); got = String(got === undefined ? '' : got).toLowerCase(); }
    if (kind === 'set') return sameSet(want, got);
    if (kind === 'number') { const g = String(got === undefined ? '' : got).trim().replace(/,/g, ''); if (!g || !isFinite(+g)) return false; return Math.abs(+g - +want) <= (tol || 0) + 1e-9 * Math.max(1, Math.abs(+want)); }
    if (kind === 'bit') return String(want).trim().toUpperCase() === String(got === undefined ? '' : got).trim().toUpperCase();
    return String(want).trim().replace(/\s+/g, ' ').toLowerCase() === String(got === undefined ? '' : got).trim().replace(/\s+/g, ' ').toLowerCase();
  };

  K.kinds.table = {
    check(x, a) {
      a = a || {};
      const SP = K.tableSpec(x);
      const keys = Object.keys(SP.expected);
      const cells = {};
      let wrong = 0, empty = 0;
      for (const k of keys) {
        const got = a[k] === undefined ? '' : String(a[k]);
        if (!got.trim() && SP.expected[k] !== '') empty++;
        cells[k] = K.cellRight(SP.kind, SP.expected[k], got, SP.tolerance, x);
        if (!cells[k]) wrong++;
      }
      if (!wrong) return { ok: true, cells, message: 'Every one of the ' + keys.length + ' cells is right.' };
      const details = [];
      if (empty) details.push(K.plural(empty, 'cell is', 'cells are') + ' still empty.');
      if (SP.kind === 'set') details.push('A set is written like a, b; leave a cell empty for the empty set.');
      if (SP.kind === 'bit') details.push('Each cell holds 0 or 1.');
      if (SP.kind === 'number') details.push('Each cell holds a number' + (SP.tolerance ? ', right to within ' + SP.tolerance : '') + '.');
      return { ok: false, cells, message: K.plural(wrong, 'cell is', 'cells are') + ' not right yet (marked in red).', details };
    },
  };
})(globalThis.Proses = globalThis.Proses || {});
