// Memory maps for parts 10 and 11: physical memory (or a heap, or a buddy arena) as one bar cut into runs, each run
// a block that belongs to someone or a hole, drawn to scale, with the addresses where runs meet.
//   S.Kit.p10.vbar({prefix, x, y, w, h, total, base, runs: [{key, start, size, cls, text, sub}], ticks: [addr],
//                   tickSide: 'left' | 'right', tickFmt, size, minGap}) -> {items, w, h, Y(addr), run(key) -> box}
//     address base (default 0) at the top, base + total at the bottom
//   S.Kit.p10.hbar({prefix, x, y, w, h, total, base, runs, ticks, tickSide: 'below' | 'above', tickFmt, size,
//                   minGap}) -> {items, w, h, X(addr), run(key) -> box}
//     a run's text shows only where it fits; ticks closer than minGap to the last kept tick are dropped
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const P = (K.p10 = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const fits = (text, size, room, bold) => !text || S.geom.textWidth(text, size, { bold }) + 8 <= room;

  P.vbar = function (o) {
    const pre = o.prefix || 'vb', items = [], fs = o.size || 13, base = o.base || 0, total = o.total;
    const Y = (a) => r2(o.y + ((a - base) / total) * o.h);
    const boxes = {};
    items.push({ key: pre + ':frame', kind: 'region', x: o.x - 2, y: o.y - 2, w: o.w + 4, h: o.h + 4, rx: 3, text: '', cls: 'p10-frame', audit: 'group', layer: 'back' });
    for (const r of o.runs) {
      const y0 = Y(r.start), y1 = Y(r.start + r.size), h = Math.max(1, y1 - y0);
      const lines = [];
      if (r.text && h >= fs + 6 && fits(r.text, fs, o.w, true)) lines.push(r.text);
      if (lines.length && r.sub && h >= 2 * fs + 20 && fits(r.sub, 12, o.w)) lines.push(r.sub);
      const it = { key: pre + ':' + r.key, kind: 'cell', x: o.x, y: y0, w: o.w, h: r2(h), rx: 0, lines: lines.length ? lines : [''], size: fs, cls: 'p10-run ' + (r.cls || '') };
      if (r.info) it.info = r.info;
      items.push(it);
      boxes[r.key] = { x: o.x, y: y0, w: o.w, h };
    }
    tickItems(o, items, (a) => Y(a), true);
    return { items, w: o.w, h: o.h, Y, run: (k) => boxes[k] };
  };

  P.hbar = function (o) {
    const pre = o.prefix || 'hb', items = [], fs = o.size || 13, base = o.base || 0, total = o.total;
    const X = (a) => r2(o.x + ((a - base) / total) * o.w);
    const boxes = {};
    items.push({ key: pre + ':frame', kind: 'region', x: o.x - 2, y: o.y - 2, w: o.w + 4, h: o.h + 4, rx: 3, text: '', cls: 'p10-frame', audit: 'group', layer: 'back' });
    for (const r of o.runs) {
      const x0 = X(r.start), x1 = X(r.start + r.size), w = Math.max(1, x1 - x0);
      const lines = [];
      if (r.text && fits(r.text, fs, w, true) && o.h >= fs + 6) lines.push(r.text);
      if (lines.length && r.sub && fits(r.sub, 12, w) && o.h >= 2 * fs + 14) lines.push(r.sub);
      const it = { key: pre + ':' + r.key, kind: 'cell', x: x0, y: o.y, w: r2(w), h: o.h, rx: 0, lines: lines.length ? lines : [''], size: fs, cls: 'p10-run ' + (r.cls || '') };
      if (r.info) it.info = r.info;
      items.push(it);
      boxes[r.key] = { x: x0, y: o.y, w, h: o.h };
    }
    tickItems(o, items, (a) => X(a), false);
    return { items, w: o.w, h: o.h, X, run: (k) => boxes[k] };
  };

  function tickItems(o, items, at, vertical) {
    const pre = (o.prefix || (vertical ? 'vb' : 'hb')) + ':t', fmt = o.tickFmt || String, side = o.tickSide || (vertical ? 'left' : 'below');
    const ticks = [...new Set(o.ticks || [])].sort((a, b) => a - b);
    let last = -Infinity, lastW = 0;
    for (const a of ticks) {
      const p = at(a), text = fmt(a);
      if (vertical) {
        if (p - last < (o.minGap || 16)) continue;
        last = p;
        const tx = side === 'left' ? o.x - 10 : o.x + o.w + 10;
        items.push({ key: pre + a, kind: 'text', x: tx, y: r2(p + 4.5), text, anchor: side === 'left' ? 'end' : 'start', size: 12, cls: 'tick mono' });
        items.push({ key: pre + 'm' + a, kind: 'line', x1: side === 'left' ? o.x - 7 : o.x + o.w + 2, y1: p, x2: side === 'left' ? o.x - 2 : o.x + o.w + 7, y2: p, cls: 'p10-tick', audit: 'ignore' });
      } else {
        const w = S.geom.textWidth(text, 12, { mono: true });
        if (p - w / 2 < last + lastW / 2 + (o.minGap || 8)) continue;
        last = p; lastW = w;
        const ty = side === 'below' ? o.y + o.h + 18 : o.y - 10;
        items.push({ key: pre + a, kind: 'text', x: p, y: ty, text, anchor: 'middle', size: 12, cls: 'tick mono' });
        items.push({ key: pre + 'm' + a, kind: 'line', x1: p, y1: side === 'below' ? o.y + o.h + 2 : o.y - 7, x2: p, y2: side === 'below' ? o.y + o.h + 7 : o.y - 2, cls: 'p10-tick', audit: 'ignore' });
      }
    }
  }
})(globalThis.Proses = globalThis.Proses || {});
