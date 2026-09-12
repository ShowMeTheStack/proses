// Parts 12, 13 and 14 (mass storage, I/O systems, the file-system interface): the families of part 12, and the
// drawing helpers the three parts share (S.T12): text and wrapped paragraphs, titled panels, timelines of lanes
// on a shared time axis, numbers in words, and arcs for drawing platters.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'storage', order, title, blurb });
  fam('p12-disk', 10, 'Hard disks', 'Platters, tracks, cylinders and sectors; where a block number lands on the disk; and the seek, the rotational wait and the transfer that make up the time of one request.');
  fam('p12-arm', 20, 'Disk-arm scheduling', 'Which waiting request the arm serves next: first come first served, the nearest one, or a sweep across the disk, and what each choice costs in movement and in waiting.');
  fam('p12-ssd', 30, 'Solid-state drives', 'Flash pages written once and erased a block at a time, the translation layer that hides it, garbage collection, write amplification and wear levelling.');
  fam('p12-raid', 40, 'RAID', 'Several disks as one: striping for speed, mirrors and parity for safety, parity worked bit by bit, the small-write penalty, and a failed disk rebuilt from the others.');
  fam('p12-codes', 50, 'Catching errors', 'Parity bits, checksums and cyclic redundancy checks that notice a damaged block, and a Hamming code that also mends a flipped bit.');

  const T = (S.T12 = S.T12 || {});
  const R = Math.round;
  T.r1 = (v) => Math.round(v * 10) / 10;
  T.r2 = (v) => Math.round(v * 100) / 100;
  T.r3 = (v) => Math.round(v * 1000) / 1000;
  /** a number with at most d decimals, trailing zeros dropped */
  T.fix = (v, d) => { const p = Math.pow(10, d === undefined ? 2 : d); const x = Math.round(v * p) / p; return String(Object.is(x, -0) ? 0 : x); };
  T.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  T.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  T.cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  T.tw = (text, size, o) => S.textWidth(String(text), size, o);

  /** free text */
  T.text = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: R(x), y: R(y), text: String(text), size: size || 14, cls: cls || '', anchor: anchor || 'start' });
  /** a panel title in small capitals */
  T.title = (key, x, y, text) => ({ key, kind: 'text', x: R(x), y: R(y), text, size: 13, cls: 'title' });
  /** wrapped lines of text: {items, h} */
  T.para = (prefix, x, y, text, maxW, size, cls) => S.Kit.disk.para({ prefix, x, y, text, maxW, size: size || 14, cls: cls || '' });
  /** a cell with text */
  T.cell = (key, x, y, w, h, text, cls, size, extra) => Object.assign({ key, kind: 'cell', x: R(x), y: R(y), w: R(w), h: R(h), rx: 5, text: text === undefined ? '' : String(text), size: size || 14, cls: cls || '' }, extra || {});
  /** a shaded panel behind a group */
  T.panel = (key, x, y, w, h, cls) => ({ key, kind: 'region', x: R(x), y: R(y), w: R(w), h: R(h), rx: 8, cls: cls || 'panel', audit: 'group' });

  /**
   * Lanes on a time axis (a CPU, a device, a bus, a process): T.lanes({prefix, x, y, w, labelW, t1, rows: [{id,
   * label, segs: [{from, to, cls, text}]}], rowH, gap, upTo, step, unit, size, now}) -> {items, X(t), h, rowY(i)}.
   * Segments are cells (class 'tl ' + cls) cut at upTo; the text inside shows only when it fits.
   */
  T.lanes = function (o) {
    const items = [], lw = o.labelW === undefined ? 90 : o.labelW, rowH = o.rowH || 30, gap = o.gap === undefined ? 10 : o.gap, size = o.size || 13;
    const x0 = o.x + lw, x1 = o.x + o.w, t1 = Math.max(1e-9, o.t1), per = (x1 - x0) / t1;
    const X = (t) => T.r1(x0 + Math.max(0, Math.min(t1, t)) * per);
    const up = o.upTo === undefined ? Infinity : o.upTo;
    const rowY = (i) => o.y + i * (rowH + gap);
    o.rows.forEach((row, i) => {
      const y = rowY(i);
      items.push(T.text(o.prefix + ':l' + i, o.x + lw - 10, y + rowH / 2 + 5, row.label, 'strong ' + (row.labelCls || ''), size, 'end'));
      items.push({ key: o.prefix + ':tr' + i, kind: 'cell', x: R(x0), y: R(y), w: R(x1 - x0), h: rowH, rx: 3, text: '', cls: 'tl-track', audit: 'group' });
      row.segs.forEach((s, j) => {
        if (s.from >= up) return;
        const a = X(s.from), b = X(Math.min(s.to, up)), w = Math.max(1.5, b - a);
        const fits = s.text && T.tw(s.text, size - 1) + 8 <= w;
        items.push({ key: o.prefix + ':s' + i + '.' + j, kind: 'cell', x: a, y: R(y + 2), w: T.r1(w), h: rowH - 4, rx: 2, text: fits ? s.text : '', size: size - 1, cls: 'tl ' + (s.cls || ''), audit: 'overlap-ok' });
      });
    });
    const yA = rowY(o.rows.length) - gap + 8;
    const step = o.step || niceStep(t1, Math.max(3, Math.floor((x1 - x0) / 70)));
    let d = `M${X(0)},${yA} H${X(t1)}`;
    const ticks = [];
    for (let t = 0; t <= t1 + 1e-9; t += step) ticks.push(T.r3(t));
    ticks.forEach((t, k) => { d += ` M${X(t)},${yA} v6`; items.push(T.text(o.prefix + ':tk' + k, X(t), yA + 22, T.fix(t, 2) + (k === ticks.length - 1 && o.unit ? ' ' + o.unit : ''), 'tick', 12, 'middle')); });
    items.push({ key: o.prefix + ':ax', kind: 'path', d, cls: 'axis', audit: 'ignore', layer: 'back' });
    if (o.now !== undefined && o.now !== null) {
      const xn = X(o.now);
      items.push({ key: o.prefix + ':now', kind: 'line', x1: xn, y1: R(o.y - 6), x2: xn, y2: R(yA), cls: 'tl-now', audit: 'ignore', layer: 'top' });
    }
    return { items, X, h: yA + 26 - o.y, rowY, x0, x1 };
  };
  function niceStep(span, n) {
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  T.niceStep = niceStep;

  /** a legend of swatches (cells with the given classes) in a row that wraps at maxW */
  T.legend = (prefix, x, y, entries, maxW, size) => S.Kit.disk.legend({ prefix, x, y, entries, maxW, size: size || 13 });

  // ---- circles and arcs (platters, rings) ----
  const P = (cx, cy, r, a) => [cx + r * Math.sin(a * 2 * Math.PI), cy - r * Math.cos(a * 2 * Math.PI)];
  T.polar = P;
  /** an annular sector from turn fraction a0 to a1 (0 at the top, clockwise) between radii r0 < r1, as a path d */
  T.wedge = (cx, cy, r0, r1, a0, a1) => {
    const big = a1 - a0 > 0.5 ? 1 : 0, p = (r, a) => P(cx, cy, r, a).map(T.r1).join(',');
    return `M${p(r1, a0)} A${r1},${r1} 0 ${big} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${big} 0 ${p(r0, a0)} Z`;
  };
  /** a circle as a path d */
  T.circle = (cx, cy, r) => `M${T.r1(cx - r)},${T.r1(cy)} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 ${-2 * r},0`;
  /** an arc of radius r from a0 to a1 (turn fractions) as a path d */
  T.arc = (cx, cy, r, a0, a1) => { const big = a1 - a0 > 0.5 ? 1 : 0, p = (a) => P(cx, cy, r, a).map(T.r1).join(','); return `M${p(a0)} A${r},${r} 0 ${big} 1 ${p(a1)}`; };
})(globalThis.Proses = globalThis.Proses || {});
