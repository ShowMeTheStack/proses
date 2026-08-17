// The Storage lab, part one: what the four workbenches share (S.StoLab, SL). Drawing helpers (text, cells, wrapped
// paragraphs, legends, lanes on a time axis, a stacked bar), small number words, a seeded generator, and the disk
// arm's chart (cylinders across, time down) used by the disk workbench. Everything drawn is a stage item; every
// number comes from the engines (S.Storage, S.SSD, S.Raid, S.GF, S.IO).
(function (S) {
  'use strict';
  const SL = (S.StoLab = S.StoLab || {});
  const R = Math.round;
  const r1 = (v) => Math.round(v * 10) / 10;
  SL.r1 = r1;
  SL.r2 = (v) => Math.round(v * 100) / 100;
  SL.r3 = (v) => Math.round(v * 1000) / 1000;
  /** a number with at most d decimals (default 2), trailing zeros dropped */
  SL.fix = (v, d) => { const p = Math.pow(10, d === undefined ? 2 : d); const x = Math.round(v * p) / p; return String(Object.is(x, -0) ? 0 : x); };
  SL.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  SL.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  SL.cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  SL.tw = (t, size, o) => S.textWidth(String(t), size || 14, o);
  SL.hex2 = (b) => (b < 16 ? '0' : '') + b.toString(16);
  SL.hexs = (bytes) => [...bytes].map(SL.hex2).join(' ');
  SL.key = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
  /** a small seeded generator: the same seed gives the same numbers */
  SL.rng = function (seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  SL.text = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: r1(x), y: r1(y), text: String(text), size: size || 14, cls: cls || '', anchor: anchor || 'start' });
  SL.cell = (key, x, y, w, h, text, cls, size, extra) => Object.assign({ key, kind: 'cell', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 5, text: text === undefined || text === null ? '' : String(text), size: size || 14, cls: cls || '' }, extra || {});
  SL.panel = (key, x, y, w, h, cls) => ({ key, kind: 'region', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 8, cls: cls || 'panel', audit: 'group' });
  SL.title = (key, x, y, text, anchor) => ({ key, kind: 'text', x: r1(x), y: r1(y), text, size: 13, cls: 'title', anchor: anchor || 'start' });
  /** wrapped lines: {items, h} */
  SL.para = (prefix, x, y, text, maxW, size, cls) => S.Kit.disk.para({ prefix, x, y, text, maxW, size: size || 14, cls: cls || '' });
  SL.legend = (prefix, x, y, entries, maxW, size) => S.Kit.disk.legend({ prefix, x, y, entries, maxW, size: size || 13 });
  /** text cut with an ellipsis to fit width w */
  SL.fit = function (text, w, size, o) {
    let t = String(text);
    if (SL.tw(t, size, o) <= w) return t;
    while (t.length > 1 && SL.tw(t + '…', size, o) > w) t = t.slice(0, -1);
    return t + '…';
  };

  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  SL.niceStep = niceStep;

  /**
   * lanes on a shared time axis: o {prefix, x, y, w, labelW, t1, rows: [{label, segs: [{from, to, cls, text}]}],
   * rowH, gap, upTo, step, unit, size, now} -> {items, X, h, rowY}. Segments are cells ('tl ' + cls) cut at upTo.
   */
  SL.lanes = function (o) {
    const items = [], lw = o.labelW === undefined ? 90 : o.labelW, rowH = o.rowH || 30, gap = o.gap === undefined ? 10 : o.gap, size = o.size || 13;
    const x0 = o.x + lw, x1 = o.x + o.w, t1 = Math.max(1e-9, o.t1), per = (x1 - x0) / t1;
    const X = (t) => r1(x0 + Math.max(0, Math.min(t1, t)) * per);
    const up = o.upTo === undefined ? Infinity : o.upTo;
    const rowY = (i) => o.y + i * (rowH + gap);
    o.rows.forEach((row, i) => {
      const y = rowY(i);
      items.push(SL.text(o.prefix + ':l' + i, o.x + lw - 10, y + rowH / 2 + 5, row.label, 'strong ' + (row.labelCls || ''), size, 'end'));
      items.push({ key: o.prefix + ':tr' + i, kind: 'cell', x: r1(x0), y: r1(y), w: r1(x1 - x0), h: rowH, rx: 3, text: '', cls: 'tl-track', audit: 'group' });
      row.segs.forEach((s, j) => {
        if (s.from >= up) return;
        const a = X(s.from), b = X(Math.min(s.to, up)), w = Math.max(1.5, b - a);
        const fits = s.text && SL.tw(s.text, size - 1) + 8 <= w;
        items.push({ key: o.prefix + ':s' + i + '.' + j, kind: 'cell', x: a, y: r1(y + 2), w: r1(w), h: rowH - 4, rx: 2, text: fits ? s.text : '', size: size - 1, cls: 'tl ' + (s.cls || ''), audit: 'overlap-ok' });
      });
    });
    const yA = rowY(o.rows.length) - gap + 8;
    const step = o.step || niceStep(t1, Math.max(2, Math.floor((x1 - x0) / 80)));
    let d = `M${X(0)},${yA} H${X(t1)}`;
    const ticks = [];
    for (let t = 0; t <= t1 + 1e-9; t += step) ticks.push(SL.r3(t));
    ticks.forEach((t, k) => {
      d += ` M${X(t)},${yA} v6`;
      const last = k === ticks.length - 1;
      items.push(SL.text(o.prefix + ':tk' + k, X(t), yA + 22, SL.fix(t, 2) + (last && o.unit ? ' ' + o.unit : ''), 'tick', 12, last && o.unit ? 'end' : 'middle'));
    });
    items.push({ key: o.prefix + ':ax', kind: 'path', d, cls: 'axis', audit: 'ignore', layer: 'back' });
    if (o.now !== undefined && o.now !== null) {
      const xn = X(o.now);
      items.push({ key: o.prefix + ':now', kind: 'line', x1: xn, y1: R(o.y - 6), x2: xn, y2: R(yA), cls: 'tl-now', audit: 'ignore', layer: 'top' });
    }
    return { items, X, h: yA + 30 - o.y, rowY, x0, x1 };
  };

  /** a bar of parts side by side: o {prefix, x, y, h, scale (px per unit), parts: [{v, cls, text}]} -> {items, w} */
  SL.stack = function (o) {
    const items = [];
    let x = o.x;
    o.parts.forEach((p, i) => {
      const w = Math.max(p.v > 0 ? 1.5 : 0, p.v * o.scale);
      if (!w) return;
      const fits = p.text && SL.tw(p.text, o.size || 12) + 8 <= w;
      items.push({ key: o.prefix + ':p' + i, kind: 'cell', x: r1(x), y: r1(o.y), w: r1(w), h: o.h, rx: 2, text: fits ? p.text : '', size: o.size || 12, cls: 'tl ' + p.cls, audit: 'overlap-ok' });
      x += w;
    });
    return { items, w: x - o.x };
  };

  // ---- the disk arm's chart ------------------------------------------------------------------------------------
  /**
   * cylinders across, time down: o {prefix, C, x, y, w, h, t1, path, upTo, start, served, act, late: Set, reqs:
   * [{id, cyl, at}], names, tickSize, ticks} -> {items, X, Y, pos}. The requests that have arrived sit on the
   * cylinder axis (open while they wait, filled once served); the head is a pointer over its cylinder.
   */
  SL.armChart = function (o) {
    const items = [], P = o.prefix, C = o.C, x0 = o.x, x1 = o.x + o.w, y0 = o.y, H = o.h, t1 = Math.max(1, o.t1);
    const X = (c) => r1(x0 + (c / Math.max(1, C - 1)) * (x1 - x0)), Y = (tm) => r1(y0 + (tm / t1) * H);
    const ts = o.tickSize || 12;
    items.push({ key: P + ':axt', kind: 'path', d: `M${x0},${y0} H${x1}`, cls: 'axis', audit: 'ignore', layer: 'back' });
    const step = niceStep(C, o.ticks || 6), tk = [];
    for (let c = 0; c < C; c += step) tk.push(c);
    if (C - 1 - tk[tk.length - 1] < step * 0.6) tk.pop();
    tk.push(C - 1);
    let gd = '';
    tk.forEach((c, k) => { gd += `M${X(c)},${y0} V${r1(y0 + H)} `; items.push(SL.text(P + ':tx' + k, X(c), y0 + H + 18, String(c), 'tick', ts, 'middle')); });
    items.push({ key: P + ':grid', kind: 'path', d: gd, cls: 'grid', audit: 'ignore', layer: 'back' });
    items.push({ key: P + ':axb', kind: 'path', d: `M${x0},${r1(y0 + H)} H${x1}`, cls: 'axis', audit: 'ignore', layer: 'back' });
    if (o.names !== false) {
      items.push(SL.text(P + ':y0', x0 - 8, y0 + 5, 't = 0', 'tick', ts, 'end'));
      items.push(SL.text(P + ':y1', x0 - 8, r1(y0 + H + 4), 't = ' + SL.fix(t1, 1), 'tick', ts, 'end'));
    }
    const path = o.path, up = o.upTo;
    let d = '', dj = '', last = null;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (p.t > up + 1e-9) {
        if (last) { const f = (up - last.t) / (p.t - last.t), c = last.cyl + (p.cyl - last.cyl) * f, seg = `M${X(last.cyl)},${Y(last.t)} L${X(c)},${Y(up)} `; if (last.kind === 'jump') dj += seg; else d += seg; last = { t: up, cyl: c }; }
        break;
      }
      if (last && (last.t !== p.t || last.cyl !== p.cyl)) { const seg = `M${X(last.cyl)},${Y(last.t)} L${X(p.cyl)},${Y(p.t)} `; if (last.kind === 'jump') dj += seg; else d += seg; }
      last = p;
    }
    items.push({ key: P + ':path', kind: 'path', d: d || `M${X(o.start)},${y0}`, cls: 'arm-path', audit: 'ignore', layer: 'lines' });
    items.push({ key: P + ':jump', kind: 'path', d: dj || `M${X(o.start)},${y0}`, cls: 'arm-path jump', audit: 'ignore', layer: 'lines' });
    const late = o.late || new Set();
    for (const s of o.served) if (s.done <= up + 1e-9) items.push({ key: P + ':sv' + s.id, kind: 'dot', x: X(s.cyl), y: Y(s.done), r: o.r || 4.5, cls: 'req done' + (s.id === o.act ? ' act' : '') + (late.has(s.id) ? ' late' : ''), audit: 'ignore' });
    const doneAt = new Map(o.served.map((s) => [s.id, s.done]));
    for (const q of o.reqs || []) {
      if (q.at > up + 1e-9) continue;
      const done = doneAt.get(q.id) <= up + 1e-9;
      items.push({ key: P + ':q' + q.id, kind: 'dot', x: X(q.cyl), y: y0, r: 5, cls: 'req' + (done ? ' done' : '') + (q.id === o.act ? ' act' : '') + (late.has(q.id) ? ' late' : ''), audit: 'ignore', layer: 'top' });
    }
    const pos = last ? last.cyl : o.start;
    if (last) items.push({ key: P + ':now', kind: 'dot', x: X(pos), y: Y(last.t), r: 5.5, cls: 'pl-headdot', audit: 'ignore', layer: 'top' });
    items.push({ key: P + ':arm', kind: 'head', x: X(pos), y: y0 - 7, text: String(R(pos)), side: 'above', cls: 'act', size: 13 });
    return { items, X, Y, pos };
  };
})(globalThis.Proses = globalThis.Proses || {});
