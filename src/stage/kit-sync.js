// Pictures of synchronisation: a round table with seats and forks, a ring buffer with its in and out pointers, a
// semaphore as a counter with its wait queue, a program listing with each thread's place in it, and a legend.
// Every function returns {items, w, h} (or items) in stage units; prefix every key so two copies can share a frame.
//   S.Kit.sync.table({prefix, cx, cy, R, r, n, seats: [{name, cls, sub}], forks: [holder | null],
//     waits: [{from, to, cls}], tableR, forkW, forkH, size}) -> {items, seat(i) -> {x, y}}
//     seat i sits at angle −90° − 360°·i/n (anticlockwise from the top, so that seat i's left hand, as it faces the
//     table, is on the clockwise side); fork j lies between seat j and seat j − 1, on seat j's left, when free, and
//     beside its holder, on that side, when held. A wait is an arrow from seat to seat bent out of the table.
//   S.Kit.sync.ring({prefix, cx, cy, R, slots: [text | null], inAt, outAt, cw, ch, act}) -> {items}
//     slot k sits at angle −90° + 360°·k/N on a faint track, its number inside; the tags 'in' and 'out' sit outside
//     the ring, in a little before its slot and out a little after, each with an arrow (tagGap, tagSpread).
//   S.Kit.sync.sem({prefix, x, y, name, value, queue: [name..], cls, act, nameW, perRow, size}) -> {items, w, h}
//   S.Kit.sync.code({prefix, x, y, w, lines: [text..], marks: [[{name, cls}]..], act, lh, markW, size, title})
//     -> {items, w, h}   marks[k]: the threads whose next step is line k, drawn as small coloured tags on its right
//   S.Kit.sync.legend({prefix, x, y, entries: [{cls, text, round, line}], gap, vertical, size}) -> {items, w, h}
//     an entry is a swatch (round: a disc) or, with line: true, a short stroke drawn with the class legline
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const Y = (K.sync = {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const tw = (t, size, o) => S.textWidth(String(t), size, o);
  const ang = (i, n) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const seatAng = (i, n) => -Math.PI / 2 - (2 * Math.PI * i) / n;

  Y.table = function (o) {
    const P = o.prefix || 'tb', n = o.n, R = o.R, r = o.r || 30, items = [];
    const fw = o.forkW || 40, fh = o.forkH || 24, tR = o.tableR || R * 0.62;
    const seat = (i) => ({ x: r1(o.cx + R * Math.cos(seatAng(i, n))), y: r1(o.cy + R * Math.sin(seatAng(i, n))) });
    items.push({ key: P + ':table', kind: 'ellipse', x: o.cx, y: o.cy, rx: tR, ry: tR, cls: 'sync-table', layer: 'back', audit: 'ignore' });
    for (let i = 0; i < n; i++) {
      const s = o.seats[i], p = seat(i);
      items.push({ key: P + ':s' + i, kind: 'state', x: p.x, y: p.y, r, text: s.name, size: o.size || 15, cls: 'phil ' + (s.cls || '') });
      if (s.sub) {
        // the meal count sits above a seat in the top half and below one in the bottom half, away from the table
        const up = Math.sin(seatAng(i, n)) < -0.3;
        items.push({ key: P + ':m' + i, kind: 'text', x: p.x, y: r1(up ? p.y - r - 9 : p.y + r + 19), text: s.sub, anchor: 'middle', size: 13, cls: 'meals ' + (s.subCls || '') });
      }
    }
    // forks: free ones on the table between their two seats, held ones beside the holder
    const half = Math.PI / n;
    (o.forks || []).forEach((h, j) => {
      let x, y;
      if (h === null || h === undefined) {
        const a = seatAng(j, n) + half, d = tR * (o.forkIn || 0.7);
        x = o.cx + d * Math.cos(a); y = o.cy + d * Math.sin(a);
      } else {
        // fork j is the holder's left fork when j === holder, else its right one; it sits on that side
        const side = j === h ? 1 : -1, d = R - r - fh * 0.5 - (o.forkGap || 14), a0 = seatAng(h, n);
        const off = (fw * 0.62) / d;
        x = o.cx + d * Math.cos(a0 + side * off); y = o.cy + d * Math.sin(a0 + side * off);
      }
      items.push({ key: P + ':f' + j, kind: 'cell', x: r1(x - fw / 2), y: r1(y - fh / 2), w: fw, h: fh, rx: 6, text: 'F' + j, size: 13, cls: 'fork ' + (h === null || h === undefined ? 'free' : 'held') });
    });
    for (const w of o.waits || []) {
      // bend away from the table: + is left of from→to, which is outward when to is the next seat clockwise, and
      // seat i + 1 is the next one anticlockwise
      const acw = (w.to - w.from + n) % n === 1;
      items.push({ key: P + ':w' + w.from + '>' + w.to, kind: 'edge', from: P + ':s' + w.from, to: P + ':s' + w.to, bend: (acw ? -1 : 1) * (o.bend || Math.max(18, R * Math.sin(half) * 0.32)), cls: 'wait ' + (w.cls || ''), layer: 'edges' });
    }
    return { items, seat };
  };

  Y.ring = function (o) {
    const P = o.prefix || 'rg', N = o.slots.length, R = o.R, cw = o.cw || 58, ch = o.ch || 36, items = [];
    const at = (a, d) => ({ x: r1(o.cx + d * Math.cos(a)), y: r1(o.cy + d * Math.sin(a)) });
    items.push({ key: P + ':track', kind: 'ellipse', x: o.cx, y: o.cy, rx: R, ry: R, cls: 'ring-track', layer: 'back', audit: 'ignore' });
    o.slots.forEach((v, k) => {
      const p = at(ang(k, N), R), full = v !== null && v !== undefined;
      items.push({ key: P + ':k' + k, kind: 'cell', x: r1(p.x - cw / 2), y: r1(p.y - ch / 2), w: cw, h: ch, rx: 6, text: full ? v : '', size: 15, cls: 'slot ' + (full ? 'full' : 'empty') + (o.act === k ? ' act' : '') });
      const a = ang(k, N), q = at(a, R - Math.abs(Math.cos(a)) * cw * 0.5 - Math.abs(Math.sin(a)) * ch * 0.5 - (o.idxGap || 12));
      items.push({ key: P + ':n' + k, kind: 'text', x: q.x, y: r1(q.y + 4.5), text: String(k), anchor: 'middle', size: 13, cls: 'tick' });
    });
    // in and out both point from outside the ring, in from just before the slot and out from just after it
    const d = R + ch * 0.5 + (o.tagGap || 44), da = (o.tagSpread || 34) / d;
    const tag = (name, k, side, cls) => {
      const p = at(ang(k, N) + side * da, d);
      items.push({ key: P + ':' + name, kind: 'state', x: p.x, y: p.y, w: 46, h: 26, rx: 13, text: name, size: 13, cls: 'ptr ' + cls });
      items.push({ key: P + ':' + name + 'a', kind: 'edge', from: P + ':' + name, to: P + ':k' + k, cls: 'ptr ' + cls, gapB: 2 });
    };
    if (o.inAt !== undefined) tag('in', o.inAt, -1, 'pin');
    if (o.outAt !== undefined) tag('out', o.outAt, 1, 'pout');
    return { items };
  };

  Y.sem = function (o) {
    const P = o.prefix || 'sm', items = [], nameW = o.nameW || 76, bw = o.boxW || 46, bh = o.boxH || 40, qw = o.qw || 38, per = o.perRow || 6;
    items.push({ key: P + ':name', kind: 'text', x: o.x, y: r1(o.y + bh / 2 + 5.5), text: o.name, size: o.size || 16, cls: 'semname' + (o.act ? ' act' : '') });
    items.push({ key: P + ':val', kind: 'cell', x: o.x + nameW, y: o.y, w: bw, h: bh, rx: 7, text: String(o.value), size: 20, cls: 'semval ' + (o.value > 0 ? 'pos' : 'zero') + (o.act ? ' act' : ''), pulse: !!o.pulse });
    const qx = o.x + nameW + bw + 14, q = o.queue || [];
    if (!q.length) items.push({ key: P + ':none', kind: 'text', x: qx, y: r1(o.y + bh / 2 + 5), text: o.none || 'nobody waits', size: 13, cls: 'qnone' });
    q.forEach((nm, i) => {
      const row = Math.floor(i / per), col = i % per;
      items.push({ key: P + ':q' + nm, kind: 'cell', x: qx + col * qw, y: r1(o.y + 6 + row * 32), w: qw - 5, h: 28, rx: 5, text: nm, size: 13, cls: 'qcell s-blocked' });
    });
    const rows = Math.max(1, Math.ceil(q.length / per));
    return { items, w: nameW + bw + 14 + Math.min(per, Math.max(1, q.length)) * qw, h: Math.max(bh, 6 + rows * 32) };
  };

  Y.code = function (o) {
    const P = o.prefix || 'cd', items = [], lh = o.lh || 30, size = o.size || 14, mw = o.markW || 34, w = o.w;
    let y = o.y;
    if (o.title) { items.push({ key: P + ':title', kind: 'text', x: o.x, y: y + 14, text: o.title, size: 15, cls: o.titleCls || 'strong' }); y += 28; }
    const textW = o.textW || Math.max(...o.lines.map((t) => tw(t, size, { mono: true }))) + 24;
    o.lines.forEach((t, k) => {
      const yy = y + k * lh;
      items.push({ key: P + ':l' + k, kind: 'cell', x: o.x, y: yy, w: textW, h: lh - 4, rx: 4, text: t, size, align: 'left', cls: 'codeline' + (o.act === k ? ' act' : '') + (o.hot === k ? ' hot' : '') });
      (o.marks && o.marks[k] || []).forEach((m, j) => {
        items.push({ key: P + ':t' + m.name, kind: 'cell', x: o.x + textW + 8 + j * (mw + 3), y: yy + 1, w: mw, h: lh - 6, rx: 5, text: m.name, size: Math.min(13, size), cls: 'mark ' + (m.cls || '') });
      });
    });
    return { items, w: w || textW, h: y - o.y + o.lines.length * lh };
  };

  Y.legend = function (o) {
    const P = o.prefix || 'lg', items = [], size = o.size || 13, gap = o.gap || 18;
    let x = o.x, y = o.y, maxW = 0;
    o.entries.forEach((e, i) => {
      const sw = e.line ? 30 : 18;
      if (e.line) items.push({ key: P + ':b' + i, kind: 'line', x1: x, y1: y + 9, x2: x + sw, y2: y + 9, cls: 'legline ' + e.cls, audit: 'ignore' });
      else items.push({ key: P + ':b' + i, kind: 'cell', x, y, w: 18, h: 18, rx: e.round ? 9 : 4, text: '', cls: 'swatch ' + e.cls, audit: 'ignore' });
      items.push({ key: P + ':t' + i, kind: 'text', x: x + sw + 7, y: y + 13.5, text: e.text, size, cls: 'legend' });
      const w = sw + 7 + tw(e.text, size, { bold: true });
      maxW = Math.max(maxW, w);
      if (o.vertical) y += 26; else x += w + gap;
    });
    return { items, w: o.vertical ? maxW : x - o.x - gap, h: o.vertical ? y - o.y : 18 };
  };
})(globalThis.Proses = globalThis.Proses || {});
