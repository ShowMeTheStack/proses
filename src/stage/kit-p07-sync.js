// Pictures for the synchronisation parts (7 and 8): threads as cards with their state, a mutex with its owner and
// sleep queue, a condition variable's queue, shared variables as a table, a schedule as a strip of coloured steps,
// a model checker's verdict, and a thread's registers. Every function returns {items, w, h} in stage units and
// every key starts with o.prefix. Threads are told apart by colour: thread i has the class 'p' + (i mod 6).
//   S.Kit.sync7.threads({prefix, x, y, threads: [{id, name, state, sub, act, cs}], w, h, gap, size, perRow})
//     one card a thread: its name, coloured by its state (s-ready, s-running, s-blocked, s-done), a line under it
//   S.Kit.sync7.mutex({prefix, x, y, name, owner, queue: [name..], act, kind, qw, nameW, ownerW, label})
//     a lock: its name, the owner's tag (or "free") and the queue of sleepers in order
//   S.Kit.sync7.vars({prefix, x, y, rows: [{name, value, act, hot, sub}], nameW, valW, rowH, title, size})
//     shared variables, one row each
//   S.Kit.sync7.strip({prefix, x, y, w, steps: [{tid, text}], upto, cw, ch, title, size, lit: [k..], maxCols})
//     a schedule: one cell a step, coloured by the thread that took it; the steps up to upto are full, the rest dim,
//     step upto − 1 is lit (the one just taken); longer schedules wrap into rows
//   S.Kit.sync7.verdict({prefix, x, y, w, kind: 'ok' | 'bad' | 'warn', head, lines: [..], size})  a result box
//   S.Kit.sync7.regs({prefix, x, y, name, regs: [[name, value]..], cls, act, cw})  a thread's registers in a row
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const Y = (K.sync7 = {});
  const tw = (t, size, o) => S.textWidth(String(t), size, o);
  Y.pcls = (tid) => 'p' + (((tid % 6) + 6) % 6);
  const STATE = { ready: 's-ready', running: 's-running', blocked: 's-blocked', done: 's-done', error: 's-zombie' };
  Y.stateCls = (st) => STATE[st] || 's-ready';

  Y.threads = function (o) {
    const P = o.prefix || 'th', items = [], w = o.w || 92, h = o.h || 40, gap = o.gap || 12, per = o.perRow || 99;
    const size = o.size || 15;
    let maxRow = 0;
    o.threads.forEach((t, i) => {
      const row = Math.floor(i / per), col = i % per, x = o.x + col * (w + gap), y = o.y + row * (h + (o.subH || 22) + 14);
      maxRow = Math.max(maxRow, row);
      items.push({ key: P + ':c' + t.id, kind: 'cell', x, y, w, h, rx: 8, text: t.name, size, cls: 'thcard ' + Y.stateCls(t.state) + (t.act ? ' act' : '') + (t.cs ? ' incs' : '') });
      if (t.sub) items.push({ key: P + ':s' + t.id, kind: 'text', x: x + w / 2, y: y + h + 17, text: t.sub, anchor: 'middle', size: o.subSize || 13, cls: 'thsub ' + (t.subCls || '') });
    });
    const n = Math.min(per, o.threads.length);
    return { items, w: n * w + (n - 1) * gap, h: (maxRow + 1) * (h + (o.subH || 22) + 14) - 14 };
  };

  Y.mutex = function (o) {
    const P = o.prefix || 'mx', items = [], nameW = o.nameW || 64, ow = o.ownerW || (o.kind === 'cond' ? 72 : 58), qw = o.qw || 46, h = 34;
    const kind = o.kind || 'lock';
    items.push({ key: P + ':name', kind: 'text', x: o.x, y: o.y + 22, text: o.name, size: 16, cls: 'semname' + (o.act ? ' act' : '') });
    const ox = o.x + nameW;
    const free = o.owner === null || o.owner === undefined;
    items.push({ key: P + ':own', kind: 'cell', x: ox, y: o.y, w: ow, h, rx: 7, text: free ? 'free' : o.owner, size: free ? 13 : 15, cls: 'mxown ' + (free ? 'free' : 'held ' + (o.ownerCls || '')) + (o.act ? ' act' : '') });
    items.push({ key: P + ':lab', kind: 'text', x: ox + ow / 2, y: o.y - 7, text: o.label || (kind === 'cond' ? 'waiting' : 'owner'), anchor: 'middle', size: 13, cls: 'p7note' });
    const qx = ox + ow + 14, q = o.queue || [];
    if (!q.length) items.push({ key: P + ':none', kind: 'text', x: qx, y: o.y + 22, text: o.none || 'no one waits', size: 13, cls: 'qnone' });
    q.forEach((nm, i) => items.push({ key: P + ':q' + nm, kind: 'cell', x: qx + i * qw, y: o.y + 3, w: qw - 6, h: h - 6, rx: 5, text: nm, size: 13, cls: 'qcell s-blocked' }));
    return { items, w: nameW + ow + 14 + Math.max(1, q.length) * qw, h };
  };

  Y.vars = function (o) {
    const P = o.prefix || 'vr', items = [], nameW = o.nameW || 90, valW = o.valW || 76, rh = o.rowH || 34, size = o.size || 15;
    let y = o.y;
    if (o.title) { items.push({ key: P + ':title', kind: 'text', x: o.x, y: y + 13, text: o.title, cls: 'title' }); y += 24; }
    o.rows.forEach((r, i) => {
      items.push({ key: P + ':n' + i, kind: 'cell', x: o.x, y, w: nameW, h: rh - 4, rx: 4, text: r.name, size: 14, align: 'left', cls: 'varname' });
      items.push({ key: P + ':v' + i, kind: 'cell', x: o.x + nameW + 4, y, w: valW, h: rh - 4, rx: 5, text: String(r.value), size, cls: 'varval' + (r.act ? ' act' : '') + (r.hot ? ' hot' : '') });
      if (r.sub) items.push({ key: P + ':s' + i, kind: 'text', x: o.x + nameW + valW + 14, y: y + rh / 2 + 3, text: r.sub, size: 13, cls: 'p7note' });
      y += rh;
    });
    return { items, w: nameW + 4 + valW, h: y - o.y };
  };

  Y.strip = function (o) {
    const P = o.prefix || 'sc', items = [], cw = o.cw || 30, ch = o.ch || 28, n = o.steps.length;
    const cols = Math.max(1, Math.min(n, o.maxCols || Math.floor((o.w || 600) / cw)));
    let y = o.y;
    if (o.title) { items.push({ key: P + ':title', kind: 'text', x: o.x, y: y + 13, text: o.title, cls: 'title' }); y += 22; }
    const lit = new Set(o.lit || []);
    o.steps.forEach((s, k) => {
      const row = Math.floor(k / cols), col = k % cols;
      const past = o.upto === undefined || k < o.upto;
      items.push({ key: P + ':k' + k, kind: 'cell', x: o.x + col * cw, y: y + row * (ch + 6), w: cw - 3, h: ch, rx: 4, text: s.text, size: o.size || 13, cls: 'stepcell ' + (s.cls || Y.pcls(s.tid)) + (past ? '' : ' future') + (o.upto === k + 1 ? ' act' : '') + (lit.has(k) ? ' hot' : '') });
    });
    const rows = Math.max(1, Math.ceil(n / cols));
    return { items, w: cols * cw, h: y - o.y + rows * (ch + 6) - 6 };
  };

  Y.verdict = function (o) {
    const P = o.prefix || 'vd', items = [], size = o.size || 14, lh = size + 8, w = o.w || 360;
    const lines = o.lines || [], h = 38 + lines.length * lh + 6;
    items.push({ key: P + ':box', kind: 'region', x: o.x, y: o.y, w, h, rx: 10, cls: 'verdictbox ' + (o.kind || 'ok'), audit: 'group' });
    items.push({ key: P + ':head', kind: 'text', x: o.x + 14, y: o.y + 25, text: o.head, size: 16, cls: 'vhead ' + (o.kind || 'ok') });
    lines.forEach((l, i) => items.push({ key: P + ':l' + i, kind: 'text', x: o.x + 14, y: o.y + 30 + (i + 1) * lh, text: l, size, cls: 'vline' }));
    return { items, w, h };
  };

  Y.regs = function (o) {
    const P = o.prefix || 'rg', items = [], cw = o.cw || 58, nameW = o.nameW || 40;
    items.push({ key: P + ':name', kind: 'cell', x: o.x, y: o.y, w: nameW, h: 30, rx: 6, text: o.name, size: 14, cls: 'thcard ' + (o.cls || '') + (o.act ? ' act' : '') });
    o.regs.forEach(([nm, v], i) => {
      items.push({ key: P + ':r' + i, kind: 'cell', x: o.x + nameW + 8 + i * (cw + 4), y: o.y, w: cw, h: 30, rx: 5, text: nm + ' ' + v, size: 13, cls: 'regcell' + (o.hot === i ? ' hot' : '') });
    });
    return { items, w: nameW + 8 + o.regs.length * (cw + 4), h: 30 };
  };
  Y.textW = tw;
})(globalThis.Proses = globalThis.Proses || {});
