// The scheduling kit: Gantt charts on a shared time axis, ready queues as rows of job boxes or as lanes, and the
// metrics table. Pure functions returning stage items; every key starts with o.prefix (or the key given).
//   G.time({x0, x1, t1})                         -> {X(t), per}: the time scale, t = 0 at x0 and t1 at x1
//   G.axis({prefix, X, t1, y, step, size})        -> items: tick marks and numbers over [0, t1], every step ticks
//   G.bar({prefix, X, segs, y, h, upTo, jobs, row(seg) -> y, now, size})
//                                                 -> items: one box per segment {job, start, end}, cut at upTo; jobs
//                                                    lists the ids in colour order (p0, p1, ..); now marks the segment
//                                                    running at upTo; row places a segment on its own line (MLFQ)
//   G.track({prefix, x, y, w, h})                 -> items: the empty track a bar runs along
//   G.cursor({prefix, X, t, y1, y2, label})       -> items: the dashed line at time t and its label above
//   G.job(key, x, y, id, jobs, o)                 -> a job box (top-left x, y; o: {w, h, sub, cls, size})
//   G.queue({prefix, x, y, ids, jobs, w, h, gap, label, keyOf}) -> {items, x}: a labelled row of job boxes, and
//                                                    where it ends; keyOf(id) keeps a job's box gliding between rows
//   G.lane({prefix, x, y, w, h, name, sub})       -> items: one lane of a multi-level queue (a band with its name)
//   G.table({prefix, x, y, cols: [{w, label}], groups: [{label, from, to}], rows: [{cells: [..], cls}], rowH,
//            size})                               -> {items, w, h}: a table; a cell is a string or {text, cls}
//   G.wrap(text, width, size)                     -> lines: text broken into lines no wider than width
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const G = (K.gantt = {});
  const r = (v) => Math.round(v * 10) / 10;
  const pcls = (jobs, id) => 'p' + (Math.max(0, jobs.indexOf(id)) % 6);

  G.time = function (o) {
    const per = (o.x1 - o.x0) / Math.max(1, o.t1);
    return { X: (t) => r(o.x0 + t * per), per };
  };

  G.axis = function (o) {
    const items = [], step = o.step || 1, size = o.size || 13;
    let d = '';
    for (let t = 0; t <= o.t1; t += step) {
      const x = o.X(t);
      d += `M${x},${o.y + 6} v6 `;
      items.push({ key: o.prefix + ':n' + t, kind: 'text', x, y: o.y, text: String(t), anchor: 'middle', size, cls: 'tick gtick' });
    }
    items.push({ key: o.prefix + ':ax', kind: 'path', d: `M${o.X(0)},${o.y + 12} H${o.X(o.t1)} ` + d, cls: 'axis', audit: 'ignore', layer: 'back' });
    return items;
  };

  G.track = (o) => [{ key: o.prefix + ':trk', kind: 'cell', x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h), text: '', cls: 'gtrack', audit: 'group', layer: 'back' }];

  G.bar = function (o) {
    const items = [], upTo = o.upTo === undefined ? Infinity : o.upTo, size = o.size || 15;
    o.segs.forEach((s, i) => {
      if (s.start >= upTo) return;
      const end = Math.min(s.end, upTo), x = o.X(s.start), w = r(o.X(end) - x);
      const y = o.row ? o.row(s) : o.y;
      const live = o.now !== undefined && s.start < o.now && s.end >= o.now && end === o.now && s.end > o.now;
      items.push({ key: o.prefix + ':s' + i, kind: 'cell', x, y: r(y), w, h: o.h, text: w >= size + 2 ? s.job : '', size, cls: 'gseg ' + pcls(o.jobs, s.job) + (live ? ' now' : '') });
    });
    return items;
  };

  G.cursor = function (o) {
    const x = o.X(o.t), items = [{ key: o.prefix + ':cur', kind: 'path', d: `M${x},${o.y1} V${o.y2}`, cls: 'gcursor', audit: 'ignore', layer: 'top' }];
    if (o.label) items.push({ key: o.prefix + ':curl', kind: 'text', x, y: o.y1 - 8, text: o.label, anchor: 'middle', size: o.size || 14, cls: 'gnow' });
    return items;
  };

  G.job = function (key, x, y, id, jobs, o) {
    o = o || {};
    return { key, kind: 'cell', x: r(x), y: r(y), w: o.w || 30, h: o.h || 28, rx: 5, text: id, sub: o.sub, size: o.size || 15, cls: 'gjob ' + pcls(jobs, id) + (o.cls ? ' ' + o.cls : '') };
  };

  G.queue = function (o) {
    const items = [], w = o.w || 30, h = o.h || 28, gap = o.gap || 4;
    let x = o.x;
    if (o.label) {
      items.push({ key: o.prefix + ':ql', kind: 'text', x, y: o.y + h / 2 + 5, text: o.label, size: o.size || 13, cls: 'glabel' });
      x += o.labelW || 56;
    }
    for (const id of o.ids) {
      items.push(G.job(o.keyOf ? o.keyOf(id) : o.prefix + ':q' + id, x, o.y, id, o.jobs, { w, h, sub: o.subs ? o.subs[id] : undefined, cls: o.cls }));
      x += w + gap;
    }
    return { items, x };
  };

  G.lane = function (o) {
    const items = [{ key: o.prefix + ':band', kind: 'cell', x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h), text: '', cls: 'glane' + (o.cls ? ' ' + o.cls : ''), audit: 'group', layer: 'back' }];
    items.push({ key: o.prefix + ':name', kind: 'text', x: r(o.x + 12), y: r(o.y + (o.sub ? o.h / 2 - 3 : o.h / 2 + 6)), text: o.name, size: o.size || 16, cls: 'glname' });
    if (o.sub) items.push({ key: o.prefix + ':sub', kind: 'text', x: r(o.x + 12), y: r(o.y + o.h / 2 + 15), text: o.sub, size: 12, cls: 'glsub' });
    return items;
  };

  G.table = function (o) {
    const items = [], rowH = o.rowH || 28, size = o.size || 14;
    const xs = [o.x];
    for (const c of o.cols) xs.push(xs[xs.length - 1] + c.w);
    let y = o.y;
    if (o.groups) {
      for (const g of o.groups) items.push({ key: o.prefix + ':g' + g.from, kind: 'cell', x: r(xs[g.from]), y: r(y), w: r(xs[g.to + 1] - xs[g.from]), h: rowH, text: g.label, size, cls: 'gth ggroup' + (g.cls ? ' ' + g.cls : '') });
      y += rowH;
    }
    o.cols.forEach((c, i) => items.push({ key: o.prefix + ':h' + i, kind: 'cell', x: r(xs[i]), y: r(y), w: c.w, h: rowH, text: c.label, size: c.size || size, cls: 'gth' }));
    y += rowH;
    o.rows.forEach((row, k) => {
      row.cells.forEach((c, i) => {
        const cell = typeof c === 'object' && c !== null ? c : { text: c };
        items.push({ key: o.prefix + ':r' + (row.key || k) + ':' + i, kind: 'cell', x: r(xs[i]), y: r(y), w: o.cols[i].w, h: rowH, text: cell.text === undefined || cell.text === null ? '' : String(cell.text), size, cls: 'gtd' + (row.cls ? ' ' + row.cls : '') + (cell.cls ? ' ' + cell.cls : '') + (i === 0 ? ' gfirst' : '') });
      });
      y += rowH;
    });
    return { items, w: xs[xs.length - 1] - o.x, h: y - o.y };
  };

  G.wrap = function (text, width, size) {
    const tw = (s) => S.geom.textWidth(s, size || 13);
    const out = [];
    let line = '';
    for (const word of String(text).split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && tw(next) > width) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
})(globalThis.Proses = globalThis.Proses || {});
