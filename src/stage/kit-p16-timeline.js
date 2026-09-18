// A client–server timeline (part 16, distributed file systems): one lane per machine, the server in the middle, time
// running down the page in rows (one row for each moment something happens, so idle stretches take no room). A message
// is an arrow from its sender's lane at the row it was sent to the receiver's lane at the row it arrived; a lost one
// stops with a cross, short of its target. Marks sit on a lane at a row (an operation starting, a read from the cache,
// a stale read); a band on the server's lane shows it down. Under each lane's head, a few lines of its state.
//   S.Kit.ladder.draw({prefix, x, y, lanes: [{id, name, lines: [..], cls}], times: [t..], laneW, rowH, headH, now,
//     messages: [{key, from, to, t0, t1, text, cls, lost: 'dropped'|'server down'|false}],
//     marks: [{key, lane, t, text, cls}], bands: [{key, lane, t0, t1, text}]}) -> {items, w, h, rowY(t), laneX(id)}
//   rows are placed at the times given (sorted, unique); t past the last row is drawn at the last row. With o.window
//   (a number of rows), only that many rows are drawn, ending a little after `now`, and arrows are cut at the edges.
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const L = (K.ladder = {});
  const R = Math.round;

  L.draw = function (o) {
    const P = o.prefix, items = [], laneW = o.laneW || 240, rowH = o.rowH || 30, headH = o.headH || 70, x0 = o.x + (o.marginL === undefined ? 200 : o.marginL), y0 = o.y;
    const all = [...new Set(o.times)].sort((a, b) => a - b), W = o.window && all.length > o.window ? o.window : all.length;
    const idxOf = (t) => { let k = all.findIndex((x) => x >= t); if (k < 0) k = all.length - 1; return k; };
    const kNow = o.now === undefined ? all.length - 1 : idxOf(o.now), k0 = Math.max(0, Math.min(all.length - W, kNow - W + 3));
    const times = all.slice(k0, k0 + W), base = y0 + headH + 22;
    const laneX = (id) => x0 + o.lanes.findIndex((l) => l.id === id) * laneW;
    const mid = (o.lanes.length - 1) / 2;
    const vY = (t) => base + (idxOf(t) - k0) * rowH + (t - all[idxOf(t)] < 0 && idxOf(t) > 0 ? 0 : 0);
    const yMin = base - rowH * 0.6, yMax = base + (W - 1) * rowH + rowH * 0.6;
    const inWin = (t) => idxOf(t) >= k0 && idxOf(t) < k0 + W;
    const rowY = (t) => Math.max(base, Math.min(base + (W - 1) * rowH, vY(t)));
    const yEnd = base + Math.max(0, W - 1) * rowH + 18;
    if (k0 > 0) items.push({ key: P + ':earlier', kind: 'text', x: R(o.x), y: R(base - rowH * 0.7), text: '⋮ earlier', size: 13, cls: 'tick' });
    if (k0 + W < all.length) items.push({ key: P + ':later', kind: 'text', x: R(o.x), y: R(yEnd + 14), text: '⋮ later', size: 13, cls: 'tick' });
    // lane heads and lines
    o.lanes.forEach((l) => {
      const cx = laneX(l.id);
      items.push({ key: P + ':h' + l.id, kind: 'cell', x: R(cx - 80), y: R(y0), w: 160, h: 26, rx: 6, text: l.name, size: 14, cls: 'lane-head ' + (l.cls || '') });
      (l.lines || []).forEach((t, i) => items.push({ key: P + ':hl' + l.id + i, kind: 'text', x: R(cx), y: R(y0 + 44 + i * 18), text: t, anchor: 'middle', size: 13, cls: 'lane-state' }));
      items.push({ key: P + ':ln' + l.id, kind: 'line', x1: R(cx), y1: R(y0 + headH + 6), x2: R(cx), y2: R(yEnd), cls: 'lane', layer: 'back', audit: 'ignore' });
    });
    // the time of each row, at the left
    times.forEach((t, k) => items.push({ key: P + ':t' + k, kind: 'text', x: R(o.x), y: R(rowY(t) + 5), text: 't = ' + t, size: 13, cls: 'tick' + (o.now !== undefined && t === o.now ? ' act' : '') }));
    if (o.now !== undefined) items.push({ key: P + ':now', kind: 'region', x: R(o.x - 6), y: R(rowY(o.now) - rowH / 2 + 2), w: R(x0 + (o.lanes.length - 1) * laneW + 170 - o.x), h: rowH - 4, rx: 5, text: '', cls: 'nowband', layer: 'back', audit: 'ignore' });
    // bands: a lane out of service
    (o.bands || []).forEach((b) => {
      const cx = laneX(b.lane), ya = Math.max(yMin + 8, vY(b.t0)), yb = Math.min(yMax - 8, vY(b.t1));
      if (yb < ya) return;
      items.push({ key: b.key, kind: 'region', x: R(cx - 10), y: R(ya - 8), w: 20, h: R(Math.max(16, yb - ya + 16)), rx: 4, text: '', cls: 'downband', layer: 'back', audit: 'ignore' });
    });
    // messages
    (o.messages || []).forEach((m) => {
      const dir = Math.sign(laneX(m.to) - laneX(m.from));
      let xa = laneX(m.from) + dir * 4, ya = vY(m.t0), ex = laneX(m.to) - dir * 4, ey = vY(m.t1);
      if (m.lost === 'dropped') { ex = (xa + ex) / 2; ey = (ya + ey) / 2; }
      // cut the arrow to the window
      if ((ya < yMin && ey < yMin) || (ya > yMax && ey > yMax)) return;
      const cut = (yy) => { const f = (yy - ya) / ((ey - ya) || 1); return [xa + (ex - xa) * f, yy]; };
      let head = !m.lost, startCut = false;
      if (ya < yMin) { [xa, ya] = cut(yMin); startCut = true; }
      if (ey > yMax) { [ex, ey] = cut(yMax); head = false; }
      if (m.lost) { const len = Math.hypot(ex - xa, ey - ya) || 1; ex -= ((ex - xa) / len) * 15; ey -= ((ey - ya) / len) * 15; }
      // messages may cross one another (they are in flight at once), but not shapes or labels
      items.push({ key: m.key, kind: 'edge', from: { x: R(xa), y: R(ya) }, to: { x: R(ex), y: R(ey) }, cls: 'msg ' + (m.cls || '') + (m.lost ? ' lostmsg' : ''), head, size: 13, audit: 'edge-x' });
      // the label: just above the middle of the arrow
      // the label: just above the middle of the arrow, clear of its slope (below it for a message lost on the way, whose
      // short arrow ends where the arrow before it runs)
      const slope = Math.abs((ey - ya) / ((ex - xa) || 1)), tw = S.geom.textWidth(m.text || '', 13, { mono: true, bold: true }), below = m.lost === 'dropped';
      const lx = R(xa + (ex - xa) * 0.5), ly = R(ya + (ey - ya) * 0.5 + (below ? 15 + slope * (tw / 2 + 2) : -5 - slope * (tw / 2 + 2)));
      if (m.text && (!startCut || Math.abs(ey - ya) > rowH)) items.push({ key: m.key + ':l', kind: 'text', x: lx, y: ly, text: m.text, anchor: 'middle', size: 13, cls: 'msg-label ' + (m.cls || '') });
      if (m.lost && ey <= yMax) { const len = Math.hypot(ex - xa, ey - ya) || 1; items.push({ key: m.key + ':x', kind: 'text', x: R(ex + ((ex - xa) / len) * 8), y: R(ey + ((ey - ya) / len) * 8 + 5), text: '✕', anchor: 'middle', size: 15, cls: 'hot' }); }
    });
    // marks on lanes
    (o.marks || []).forEach((m) => {
      if (!inWin(m.t)) return;
      // a mark's words go on the outer side of its lane, away from the server and the arrows
      const cx = laneX(m.lane), y = rowY(m.t), left = o.lanes.findIndex((l) => l.id === m.lane) < mid;
      items.push({ key: m.key + ':d', kind: 'dot', x: R(cx), y: R(y), r: 5, cls: 'mark ' + (m.cls || '') });
      if (m.text) items.push({ key: m.key, kind: 'text', x: R(left ? cx - 12 : cx + 12), y: R(y + 5), text: m.text, anchor: left ? 'end' : 'start', size: 13, cls: 'mark-label ' + (m.cls || '') });
    });
    return { items, w: x0 - o.x + (o.lanes.length - 1) * laneW + 170, h: yEnd - y0 + (k0 + W < all.length ? 20 : 0), rowY, laneX, times };
  };
})(globalThis.Proses = globalThis.Proses || {});
