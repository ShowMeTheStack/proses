// Plots on the stage: a plot frame with ticks and axis names, and line series (CPU utilisation against the degree
// of multiprogramming, page faults against frames, a response time against the quantum). Every plot shares the
// same frame, so every picture of numbers has the same axes.
//   const ax = S.Kit.curve.axes({prefix, x, y, w, h, xr: [a, b], yr: [a, b], xticks, yticks, xname, yname,
//                                grid, fmtX, fmtY, tickSize, frame})
//     -> {items, X(u), Y(v), U(x), V(y), box, o}; xticks / yticks: a step, a list of values, or 0 for none
//   S.Kit.curve.line(ax, key, pts [[u, v]..], cls, opts {upto}) -> a path item (edge-x: series may cross)
//   S.Kit.curve.dot(ax, key, u, v, cls, r) -> a marked point;  S.Kit.curve.vline(ax, key, u, cls) -> a guide
//   S.Kit.curve.legend(key, x, y, entries [{text, cls}], opts {dir: 'row' | 'col', size}) -> swatches and names
//   S.Kit.curve.ticks(a, b, n) -> about n round tick values between a and b
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const C = (K.curve = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const minus = (s) => String(s).replace(/^-/, '−');

  /** round tick values: 1, 2 or 5 times a power of ten, about n of them */
  C.ticks = function (a, b, n) {
    const span = Math.abs(b - a) || 1, raw = span / Math.max(1, n || 5), p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.999) || 10 * p;
    const out = [];
    for (let v = Math.ceil(Math.min(a, b) / step - 1e-9) * step; v <= Math.max(a, b) + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  };
  C.fmt = (v) => { const a = Math.abs(v); return minus(a >= 1e4 ? v.toExponential(0) : a >= 100 ? String(Math.round(v)) : String(+v.toPrecision(3))); };

  C.axes = function (o) {
    const P = o.prefix || 'ax', [x0, x1] = o.xr, [y0, y1] = o.yr;
    const X = (u) => r2(o.x + ((u - x0) / (x1 - x0)) * o.w), Y = (v) => r2(o.y + o.h - ((v - y0) / (y1 - y0)) * o.h);
    const U = (px) => x0 + ((px - o.x) / o.w) * (x1 - x0), V = (py) => y0 + ((o.y + o.h - py) / o.h) * (y1 - y0);
    const list = (t, a, b) => (t === 0 ? [] : Array.isArray(t) ? t : typeof t === 'number' ? C.ticks(a, b, Math.round(Math.abs(b - a) / t)) : C.ticks(a, b, 5));
    const xt = list(o.xticks, x0, x1).filter((u) => u >= Math.min(x0, x1) - 1e-9 && u <= Math.max(x0, x1) + 1e-9);
    const yt = list(o.yticks, y0, y1).filter((v) => v >= Math.min(y0, y1) - 1e-9 && v <= Math.max(y0, y1) + 1e-9);
    const items = [], ts = o.tickSize || 12, fx = o.fmtX || C.fmt, fy = o.fmtY || C.fmt;
    if (o.grid !== false) {
      let g = '';
      for (const u of xt) g += `M${X(u)},${r2(o.y)} V${r2(o.y + o.h)} `;
      for (const v of yt) g += `M${r2(o.x)},${Y(v)} H${r2(o.x + o.w)} `;
      if (g) items.push({ key: P + ':grid', kind: 'path', d: g, cls: 'grid', audit: 'ignore', layer: 'back', z: 1 });
    }
    if (o.frame !== false) items.push({ key: P + ':frame', kind: 'path', d: `M${r2(o.x)},${r2(o.y)} V${r2(o.y + o.h)} H${r2(o.x + o.w)}` + (o.frame === 'box' ? ` V${r2(o.y)} Z` : ''), cls: 'axis', audit: 'ignore', layer: 'back', z: 2 });
    for (const u of xt) items.push({ key: P + ':t:x' + u, kind: 'text', x: X(u), y: r2(o.y + o.h + ts + 5), text: fx(u), anchor: 'middle', size: ts, cls: 'tick' });
    for (const v of yt) items.push({ key: P + ':t:y' + v, kind: 'text', x: r2(o.x - 7), y: r2(Y(v) + ts * 0.35), text: fy(v), anchor: 'end', size: ts, cls: 'tick' });
    if (o.xname) items.push({ key: P + ':xn', kind: 'text', x: r2(o.x + o.w), y: r2(o.y + o.h + ts * 2 + 12), text: o.xname, anchor: 'end', size: o.nameSize || 13, cls: 'axname' });
    if (o.yname) items.push({ key: P + ':yn', kind: 'text', x: r2(o.yAt === 'left' ? o.x - 7 : o.x), y: r2(o.y - 10), text: o.yname, anchor: o.yAt === 'left' ? 'end' : 'start', size: o.nameSize || 13, cls: 'axname' });
    return { items, X, Y, U, V, o, box: { x: o.x, y: o.y, w: o.w, h: o.h }, inside: (u, v) => u >= Math.min(x0, x1) && u <= Math.max(x0, x1) && v >= Math.min(y0, y1) && v <= Math.max(y0, y1) };
  };

  /** a series through points [[u, v]..]: clipped to the plot's y range, drawn as one path */
  C.line = function (ax, key, pts, cls, opts) {
    opts = opts || {};
    const [y0, y1] = ax.o.yr, lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    let d = '', pen = false;
    const samples = [];
    for (const p of pts) {
      if (!p || !isFinite(p[1])) { pen = false; continue; }
      const v = Math.max(lo, Math.min(hi, p[1])), x = ax.X(p[0]), y = ax.Y(v);
      d += (pen ? 'L' : 'M') + x + ',' + y + ' ';
      pen = true;
      samples.push([x, y]);
    }
    return { key, kind: 'path', d: d.trim() || 'M0,0', cls: 'series ' + (cls || ''), pathAudit: opts.audit || 'edge-x', samples, layer: opts.layer || 'lines' };
  };
  C.dot = (ax, key, u, v, cls, r) => ({ key, kind: 'dot', x: ax.X(u), y: ax.Y(v), r: r || 4.5, cls: 'mark ' + (cls || ''), point: true });
  C.vline = (ax, key, u, cls) => ({ key, kind: 'path', d: `M${ax.X(u)},${r2(ax.o.y)} V${r2(ax.o.y + ax.o.h)}`, cls: 'guide ' + (cls || ''), audit: 'ignore', layer: 'back', z: 3 });
  C.hline = (ax, key, v, cls) => ({ key, kind: 'path', d: `M${r2(ax.o.x)},${ax.Y(v)} H${r2(ax.o.x + ax.o.w)}`, cls: 'guide ' + (cls || ''), audit: 'ignore', layer: 'back', z: 3 });

  /** a legend: a short stroke (or a dot) and a name for each entry, in a row or a column */
  C.legend = function (key, x, y, entries, opts) {
    opts = opts || {};
    const fs = opts.size || 13, items = [];
    let cx = x, cy = y;
    entries.forEach((e, i) => {
      if (e.dot) items.push({ key: key + ':s' + i, kind: 'dot', x: r2(cx + 7), y: r2(cy - fs * 0.35), r: 5, cls: 'swatch ' + (e.cls || '') });
      else items.push({ key: key + ':s' + i, kind: 'path', d: `M${r2(cx)},${r2(cy - fs * 0.35)} h18`, cls: 'series swatch ' + (e.cls || ''), audit: 'ignore' });
      items.push({ key: key + ':n' + i, kind: 'text', x: r2(cx + 24), y: r2(cy), text: e.text, size: fs, cls: 'legend ' + (e.tcls || '') });
      if (opts.dir === 'col') cy += fs + 9; else cx += 24 + S.geom.textWidth(e.text, fs) + 18;
    });
    return items;
  };
})(globalThis.Proses = globalThis.Proses || {});
