// The classic-problem scenes of part 8 that the sync kit lacks: the reading room with its door, the salon with its
// seats, the smokers' table, a barrier as a gate across lanes, and the event loop with its queue. Each returns
// {items, w, h} in stage units; every key starts with o.prefix. A person is a circle coloured by its thread
// (class p0..p5), outlined in the accent when it just moved; a thread that is blocked is drawn with s-blocked.
//   S.Kit.scenes.room({prefix, x, y, w, h, inside: [{id, name, mode: 'r' | 'w'}], door: [{id, name, mode}],
//     away: [{id, name}], act, doorState: 'open' | 'readers' | 'shut', title})  the room, its door on the left with
//     the line waiting at it, and the threads away from it in a row above
//   S.Kit.scenes.shop({prefix, x, y, seats, seated: [{id, name}], inChair: {id, name} | null, door: [{id, name}],
//     away: [{id, name}], barber: 'asleep' | 'cutting' | 'busy', act, over})  the barber's chair, the waiting seats
//     (a customer beyond them stands, outlined in pink), the door with those coming in
//   S.Kit.scenes.smokers({prefix, cx, cy, R, table: [ingredient..], smokers: [{id, name, has, holds: [..], state}],
//     agent: {name, state}, act})  the agent at the top, three smokers round a table with what lies on it
//   S.Kit.scenes.gate({prefix, x, y, w, lanes: [{id, name, at: 'before' | 'gate' | 'past', round, state}], label,
//     act, laneH})  one lane a thread, a gate across the middle
//   S.Kit.scenes.loop({prefix, cx, cy, R, running: text | null, queue: [text..], pending: [text..], qx, qy})
//     the event loop as a ring with the handler it runs, the event queue beside it, the I/O in flight under it
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const Y = (K.scenes = {});
  const pc = (id) => 'p' + (((id % 6) + 6) % 6);
  const person = (key, x, y, p, act, r, extra) => ({ key, kind: 'state', x: Math.round(x), y: Math.round(y), r: r || 21, text: p.name, size: 14, cls: 'person ' + (p.blocked ? 's-blocked' : pc(p.id)) + (act === p.id ? ' act' : '') + (extra ? ' ' + extra : '') });

  Y.room = function (o) {
    const P = o.prefix || 'rm', items = [], x = o.x, y = o.y, w = o.w, h = o.h;
    items.push({ key: P + ':room', kind: 'region', x, y, w, h, rx: 12, cls: 'room' + (o.writing ? ' writing' : ''), audit: 'group' });
    items.push({ key: P + ':t', kind: 'text', x: x + 14, y: y + 22, text: o.title || 'the room', size: 13, cls: 'title' });
    const ds = o.doorState || 'open';
    items.push({ key: P + ':door', kind: 'cell', x: x - 7, y: y + h / 2 - 34, w: 14, h: 68, rx: 4, text: '', cls: 'door ' + ds, audit: 'overlap-ok' });
    items.push({ key: P + ':dl', kind: 'text', x: x - 16, y: y + h / 2 + 52, text: ds === 'shut' ? 'door shut' : ds === 'readers' ? 'readers only' : 'door open', anchor: 'end', size: 13, cls: 'doorlbl ' + ds });
    // inside: the readers along the room, the writer at the desk
    const ins = o.inside || [], wr = ins.filter((p) => p.mode === 'w'), rd = ins.filter((p) => p.mode !== 'w');
    items.push({ key: P + ':desk', kind: 'cell', x: x + w - 120, y: y + h - 58, w: 100, h: 34, rx: 6, text: 'desk', size: 13, cls: 'desk' + (wr.length ? ' busy' : '') });
    rd.forEach((p, i) => items.push(person(P + ':p' + p.id, x + 50 + i * 54, y + h / 2 + 2, p, o.act)));
    wr.forEach((p, i) => items.push(person(P + ':p' + p.id, x + w - 70 - i * 50, y + h - 86, p, o.act, 21, wr.length > 1 ? 'clash' : '')));
    if (!ins.length) items.push({ key: P + ':empty', kind: 'text', x: x + w / 2 - 40, y: y + h / 2 + 6, text: 'empty', anchor: 'middle', size: 13, cls: 'qnone' });
    // the line at the door, nearest first, going left
    (o.door || []).forEach((p, i) => items.push(person(P + ':p' + p.id, x - 44 - i * 50, y + h / 2, Object.assign({ blocked: true }, p), o.act)));
    if (!(o.door || []).length) items.push({ key: P + ':nodoor', kind: 'text', x: x - 30, y: y + h / 2 + 5, text: 'no one waits', anchor: 'end', size: 13, cls: 'qnone' });
    // away from the room
    (o.away || []).forEach((p, i) => items.push(person(P + ':p' + p.id, x - (o.awayX || 230) + i * 50, y - 40, p, o.act)));
    return { items, w, h };
  };

  Y.shop = function (o) {
    const P = o.prefix || 'sh', items = [], x = o.x, y = o.y, n = o.seats, cw = 54;
    const w = Math.max(360, 150 + Math.max(n, (o.seated || []).length) * (cw + 10) + 30), h = 220;
    items.push({ key: P + ':shop', kind: 'region', x, y, w, h, rx: 12, cls: 'room', audit: 'group' });
    items.push({ key: P + ':t', kind: 'text', x: x + 14, y: y + 22, text: 'the salon', size: 13, cls: 'title' });
    // the barber's chair and the barber
    items.push({ key: P + ':bc', kind: 'cell', x: x + 24, y: y + 104, w: 76, h: 60, rx: 10, text: '', cls: 'bchair', audit: 'overlap-ok' });
    if (o.inChair) items.push(person(P + ':p' + o.inChair.id, x + 62, y + 132, o.inChair, o.act));
    items.push(Object.assign(person(P + ':barber', x + 62, y + 66, { id: 0, name: o.barberName || 'B' }, o.act === 0 ? 0 : -1, 21, 'barber ' + (o.barber || 'asleep'))));
    items.push({ key: P + ':bs', kind: 'text', x: x + 62, y: y + h - 18, text: o.barber === 'cutting' ? 'cutting' : o.barber === 'asleep' ? 'asleep' : 'awake', anchor: 'middle', size: 13, cls: 'bstate ' + (o.barber || 'asleep') });
    // the seats
    const cx = x + 150;
    items.push({ key: P + ':wl', kind: 'text', x: cx, y: y + 70, text: n + ' seat' + (n === 1 ? '' : 's'), size: 13, cls: 'tick' });
    for (let i = 0; i < n; i++) items.push({ key: P + ':c' + i, kind: 'cell', x: cx + i * (cw + 10), y: y + 104, w: cw, h: 60, rx: 8, text: '', cls: 'wchair', audit: 'overlap-ok' });
    (o.seated || []).forEach((p, i) => items.push(person(P + ':p' + p.id, cx + i * (cw + 10) + cw / 2, y + 134, p, o.act, 21, i >= n ? 'over' : '')));
    // the door on the right, and the customers coming in
    items.push({ key: P + ':door', kind: 'cell', x: x + w - 7, y: y + 96, w: 14, h: 76, rx: 4, text: '', cls: 'door open', audit: 'overlap-ok' });
    (o.door || []).forEach((p, i) => items.push(person(P + ':p' + p.id, x + w + 40 + i * 50, y + 134, p, o.act)));
    (o.away || []).forEach((p, i) => items.push(person(P + ':p' + p.id, x + w + 40 + i * 50, y + 40, p, o.act)));
    return { items, w, h };
  };

  Y.smokers = function (o) {
    const P = o.prefix || 'sm', items = [], R = o.R || 130, cx = o.cx, cy = o.cy;
    items.push({ key: P + ':table', kind: 'ellipse', x: cx, y: cy, rx: R * 0.55, ry: R * 0.55, cls: 'sync-table', layer: 'back', audit: 'ignore' });
    (o.table || []).forEach((g, i, a) => items.push({ key: P + ':g' + g, kind: 'cell', x: Math.round(cx - 46), y: Math.round(cy - a.length * 17 + i * 34), w: 92, h: 28, rx: 6, text: g, size: 13, cls: 'ingr ' + g }));
    if (!(o.table || []).length) items.push({ key: P + ':none', kind: 'text', x: cx, y: cy + 5, text: 'table empty', anchor: 'middle', size: 13, cls: 'qnone' });
    const ag = o.agent;
    items.push({ key: P + ':agent', kind: 'state', x: cx, y: cy - R - 10, w: 64, h: 36, rx: 10, text: ag.name, size: 14, cls: 'person agent ' + (ag.state === 'blocked' ? 's-blocked' : 's-ready') + (o.act === ag.id ? ' act' : '') });
    o.smokers.forEach((p, i) => {
      const sx = Math.round(cx + (i - 1) * R * 1.25), sy = Math.round(cy + (i === 1 ? R + 20 : R * 0.45));
      items.push(person(P + ':s' + i, sx, sy, Object.assign({ blocked: p.state === 'blocked' }, p), o.act, 24));
      items.push({ key: P + ':has' + i, kind: 'text', x: sx, y: sy + 44, text: 'has ' + p.has, anchor: 'middle', size: 13, cls: 'tick' });
      (p.holds || []).forEach((g, j) => items.push({ key: P + ':h' + i + g, kind: 'cell', x: sx - 46, y: sy + 54 + j * 32, w: 92, h: 26, rx: 6, text: g, size: 13, cls: 'ingr held ' + g }));
    });
    return { items };
  };

  Y.gate = function (o) {
    const P = o.prefix || 'gt', items = [], lh = o.laneH || 46, w = o.w, gx = o.x + w / 2, n = o.lanes.length;
    items.push({ key: P + ':bar', kind: 'cell', x: gx - 6, y: o.y - 8, w: 12, h: n * lh + 8, rx: 4, text: '', cls: 'gatebar' + (o.open ? ' open' : ''), audit: 'overlap-ok' });
    items.push({ key: P + ':lbl', kind: 'text', x: gx, y: o.y - 18, text: o.label || 'the barrier', anchor: 'middle', size: 13, cls: 'title' });
    o.lanes.forEach((l, i) => {
      const y = o.y + i * lh + lh / 2 - 4;
      items.push({ key: P + ':ln' + i, kind: 'line', x1: o.x + 40, y1: y, x2: o.x + w, y2: y, cls: 'faint', audit: 'ignore', layer: 'back' });
      const x = l.at === 'past' ? gx + 70 + (l.round || 0) * 0 : l.at === 'gate' ? gx - 34 : o.x + 80;
      items.push(person(P + ':p' + l.id, x, y, { id: l.id, name: l.name, blocked: l.state === 'blocked' }, o.act, 18));
      items.push({ key: P + ':r' + i, kind: 'text', x: o.x + w + 10, y: y + 5, text: l.note || '', size: 13, cls: 'tick' });
    });
    return { items, w, h: n * lh };
  };

  Y.loop = function (o) {
    const P = o.prefix || 'lp', items = [], R = o.R || 70, cx = o.cx, cy = o.cy;
    items.push({ key: P + ':ring', kind: 'ellipse', x: cx, y: cy, rx: R, ry: R, cls: 'loopring', layer: 'back', audit: 'ignore' });
    items.push({ key: P + ':run', kind: 'cell', x: cx - 62, y: cy - 20, w: 124, h: 40, rx: 8, text: o.running || 'idle', size: 13, cls: 'handler' + (o.running ? ' busy' : '') });
    items.push({ key: P + ':lt', kind: 'text', x: cx, y: cy - R - 12, text: 'the event loop (one thread)', anchor: 'middle', size: 13, cls: 'title' });
    const qx = o.qx, qy = o.qy;
    items.push({ key: P + ':qt', kind: 'text', x: qx, y: qy - 10, text: 'event queue', size: 13, cls: 'title' });
    (o.queue || []).forEach((e, i) => items.push({ key: P + ':q' + e, kind: 'cell', x: qx, y: qy + i * 34, w: 150, h: 28, rx: 6, text: e, size: 13, cls: 'evcell ' + (/^io/.test(e) ? 'io' : 'req') }));
    if (!(o.queue || []).length) items.push({ key: P + ':qn', kind: 'text', x: qx, y: qy + 18, text: 'empty', size: 13, cls: 'qnone' });
    const px = o.px === undefined ? qx + 180 : o.px;
    items.push({ key: P + ':pt', kind: 'text', x: px, y: qy - 10, text: 'I/O in flight', size: 13, cls: 'title' });
    (o.pending || []).forEach((e, i) => items.push({ key: P + ':i' + e, kind: 'cell', x: px, y: qy + i * 34, w: 90, h: 28, rx: 6, text: e, size: 13, cls: 'evcell pend' }));
    if (!(o.pending || []).length) items.push({ key: P + ':pn', kind: 'text', x: px, y: qy + 18, text: 'none', size: 13, cls: 'qnone' });
    return { items };
  };
})(globalThis.Proses = globalThis.Proses || {});
