// Pictures of processes: a C program in an editor-like panel with each process's place in it, the fork tree, a
// timeline of every process's states, and the terminal with the process that wrote each line. Every function
// returns {items, w, h} in stage units; every key starts with o.prefix.
//   S.Kit.proc.code({prefix, x, y, w, src: [line..], lineH, size, title, act: line, marks: {line: [{pid, cls, act}]}})
//     the listing with line numbers; marks are pid tags after a line's text (more than fit: the rest as "+n");
//     act is the line the process that moves in this step is running (a soft band); indent scales the leading
//     spaces (0.5 on a phone). -> also rowY(line)
//   S.Kit.proc.tree({prefix, x, y, w, nodes: [{id, parent, lines, cls, dim, edgeCls}], levelH, boxW, boxH, gap, size})
//     a tidy tree, children in the order given, centred in w; edges are plain lines from a parent's foot to a
//     child's head (lines, so an edge whose parent changes glides to its new parent). -> also pos: {id: {x, y}}
//   S.Kit.proc.timeline({prefix, x, y, w, rows: [{id, label, cls, cells: [state | null..]}], n, now, rowH, labelW, size})
//     one lane per process, one cell per step coloured by its state (s-ready, s-running, ...), a mark at now
//   S.Kit.proc.term({prefix, x, y, w, rows: [{tags: [{pid, cls}], text}], rowsShown, title, buffers: [{pid, cls, text}],
//     lineH, size})  the terminal's last rows, each with its writers' pid tags, and under it the stdout buffers
//     that hold text not yet written
//   S.Kit.proc.wrap(text, width, size) -> lines no wider than width
//   S.Kit.proc.legend({prefix, x, y, w, entries: [{cls, text}], size, gap}) -> state swatches in a row (wrapping)
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const P = (K.proc = {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const tw = (t, size, o) => S.textWidth(String(t), size, o);
  const tagW = (pid, size) => Math.round(tw(pid, size, { bold: true }) + 12);

  P.code = function (o) {
    const K0 = o.prefix || 'code', items = [], size = o.size || 13, lh = o.lineH || 22, cw = size * 0.61;
    const src = o.src, numW = Math.round(tw(String(src.length), size, { mono: true }) + 14);
    const top = o.title ? 34 : 12, h = top + src.length * lh + 10, x0 = o.x + numW + 10;
    const tsize = o.tagSize || 12, th = lh - 5;
    items.push({ key: K0 + ':panel', kind: 'region', x: o.x, y: o.y, w: o.w, h, rx: 8, cls: 'codepanel', audit: 'group', layer: 'back' });
    if (o.title) items.push({ key: K0 + ':title', kind: 'text', x: o.x + 12, y: o.y + 22, text: o.title, size: 13, cls: 'codetitle mono' });
    const rowY = (ln) => o.y + top + (ln - 1) * lh;
    if (o.act) items.push({ key: K0 + ':band', kind: 'cell', x: o.x + 4, y: rowY(o.act), w: o.w - 8, h: lh, rx: 4, text: '', cls: 'codeband', layer: 'back', audit: 'ignore' });
    src.forEach((line, k) => {
      const ln = k + 1, y = rowY(ln) + lh / 2 + size * 0.36;
      items.push({ key: K0 + ':n' + ln, kind: 'text', x: o.x + numW, y, text: String(ln), anchor: 'end', size, cls: 'codenum mono' + (o.act === ln ? ' act' : '') });
      const body = line.replace(/\s+$/, ''), lead = body.length - body.replace(/^\s+/, '').length;
      const ind = lead * (o.indent || 1);
      if (body.trim()) items.push({ key: K0 + ':c' + ln, kind: 'text', x: r1(x0 + ind * cw), y, text: body.trim(), size, cls: 'code mono' + (o.act === ln ? ' act' : '') });
      const marks = (o.marks && o.marks[ln]) || [];
      if (!marks.length) return;
      // the tags follow the line's text; when they do not all fit, the last place says how many more
      let x = Math.max(r1(x0 + (ind + body.trim().length) * cw + 12), o.markX || 0);
      const right = o.x + o.w - 8, ty = rowY(ln) + 2.5;
      const fit = [];
      for (let i = 0; i < marks.length; i++) {
        const w = tagW(marks[i].pid, tsize), restW = tagW('+' + (marks.length - i), tsize);
        const room = right - x - (i < marks.length - 1 ? restW + 4 : 0);
        if (w > room) { fit.push({ more: marks.length - i, x, w: restW }); break; }
        fit.push({ m: marks[i], x, w }); x += w + 4;
      }
      for (const f of fit) {
        if (f.more) items.push({ key: K0 + ':more' + ln, kind: 'cell', x: r1(f.x), y: ty, w: f.w, h: th, rx: th / 2, text: '+' + f.more, size: tsize, cls: 'ptag more' });
        else items.push({ key: K0 + ':t' + f.m.pid, kind: 'cell', x: r1(f.x), y: ty, w: f.w, h: th, rx: th / 2, text: String(f.m.pid), size: tsize, cls: 'ptag ' + (f.m.cls || '') + (f.m.act ? ' act' : '') });
      }
    });
    return { items, w: o.w, h, rowY };
  };

  P.tree = function (o) {
    const K0 = o.prefix || 'pt', items = [], bw = o.boxW || 100, bh = o.boxH || 46, gap = o.gap === undefined ? 14 : o.gap, lv = o.levelH || 72;
    const byId = new Map(o.nodes.map((n) => [n.id, Object.assign({ kids: [] }, n)]));
    const roots = [];
    for (const n of byId.values()) { const p = byId.get(n.parent); if (p) p.kids.push(n); else roots.push(n); }
    let next = 0, depth = 0;
    const place = (n, d) => {
      n.d = d; depth = Math.max(depth, d);
      if (!n.kids.length) { n.cx = next * (bw + gap) + bw / 2; next++; return; }
      n.kids.forEach((k) => place(k, d + 1));
      n.cx = (n.kids[0].cx + n.kids[n.kids.length - 1].cx) / 2;
    };
    roots.forEach((r) => place(r, 0));
    const width = next * (bw + gap) - gap, dx = o.x + Math.max(0, (o.w - width) / 2);
    const pos = {};
    for (const n of byId.values()) pos[n.id] = { x: r1(dx + n.cx), y: r1(o.y + bh / 2 + n.d * lv) };
    for (const n of byId.values()) {
      const p = pos[n.id];
      items.push({ key: K0 + ':n' + n.id, kind: 'state', x: p.x, y: p.y, w: bw, h: bh, rx: 9, lines: n.lines, size: o.size || 13, cls: 'pnode ' + (n.cls || ''), dim: !!n.dim });
      const q = pos[n.parent];
      if (q) items.push({ key: K0 + ':e' + n.id, kind: 'line', x1: q.x, y1: r1(q.y + bh / 2), x2: p.x, y2: r1(p.y - bh / 2), cls: 'pedge ' + (n.edgeCls || ''), dim: !!n.dim && !n.edgeCls });
    }
    return { items, w: Math.max(o.w || 0, width), h: depth * lv + bh, pos };
  };

  P.timeline = function (o) {
    const K0 = o.prefix || 'tl', items = [], rh = o.rowH || 20, lw = o.labelW || 46, size = o.size || 12, n = Math.max(1, o.n);
    const cw = (o.w - lw) / n, x0 = o.x + lw;
    if (o.title) items.push({ key: K0 + ':title', kind: 'text', x: o.x, y: o.y - 10, text: o.title, size: 13, cls: 'title' });
    o.rows.forEach((r, i) => {
      const y = o.y + i * rh;
      items.push({ key: K0 + ':l' + r.id, kind: 'text', x: o.x + lw - 8, y: y + rh / 2 + size * 0.36, text: r.label, anchor: 'end', size, cls: 'tllabel' });
      // runs of the same state become one cell
      let a = 0;
      for (let k = 1; k <= r.cells.length; k++) {
        if (k < r.cells.length && r.cells[k] === r.cells[a]) continue;
        if (r.cells[a]) items.push({ key: K0 + ':c' + r.id + '_' + a, kind: 'cell', x: r1(x0 + a * cw), y: y + 2, w: r1((k - a) * cw), h: rh - 4, rx: 2, text: '', cls: 'tlcell s-' + r.cells[a], audit: 'ignore' });
        a = k;
      }
    });
    if (o.now !== undefined) {
      const x = r1(x0 + (o.now + 0.5) * cw);
      items.push({ key: K0 + ':now', kind: 'line', x1: x, y1: o.y - 4, x2: x, y2: o.y + o.rows.length * rh + 4, cls: 'tlnow', audit: 'ignore', layer: 'top' });
    }
    return { items, w: o.w, h: o.rows.length * rh };
  };

  P.term = function (o) {
    const K0 = o.prefix || 'tm', items = [], size = o.size || 13, lh = o.lineH || 24, tsize = o.tagSize || 12;
    const shown = o.rows.slice(Math.max(0, o.rows.length - (o.rowsShown || 6)));
    const head = o.title ? 32 : 10, bodyH = (o.rowsShown || 6) * lh + 8;
    items.push({ key: K0 + ':panel', kind: 'region', x: o.x, y: o.y, w: o.w, h: head + bodyH, rx: 8, cls: 'termpanel', audit: 'group', layer: 'back' });
    if (o.title) items.push({ key: K0 + ':title', kind: 'text', x: o.x + 12, y: o.y + 21, text: o.title, size: 13, cls: 'termtitle mono' });
    const off = o.rows.length - shown.length;
    shown.forEach((r, i) => {
      const id = off + i, y = o.y + head + i * lh;
      let x = o.x + 10;
      r.tags.forEach((t, j) => {
        const w = tagW(t.pid, tsize);
        items.push({ key: K0 + ':g' + id + '_' + j, kind: 'cell', x, y: y + 3, w, h: lh - 6, rx: (lh - 6) / 2, text: String(t.pid), size: tsize, cls: 'ptag ' + (t.cls || '') });
        x += w + 4;
      });
      items.push({ key: K0 + ':r' + id, kind: 'text', x: x + 4, y: y + lh / 2 + size * 0.36, text: r.text, size, cls: 'termtext mono' + (r.cls ? ' ' + r.cls : '') });
    });
    let h = head + bodyH;
    if (o.buffers) {
      const by = o.y + h + 10;
      const bt = o.bufTitle || 'stdout buffers, not yet written';
      items.push({ key: K0 + ':btitle', kind: 'text', x: o.x, y: by + 13, text: bt, size: 12, cls: 'title' });
      if (!o.buffers.length) items.push({ key: K0 + ':bnone', kind: 'text', x: o.x + Math.ceil(tw(bt, 12, { caps: true, spacing: 0.07, bold: true })) + 12, y: by + 13, text: 'all empty', size: 13, cls: 'legtext muted' });
      let x = o.x, y = by + 24;
      for (const b of o.buffers) {
        const w = tagW(b.pid, tsize), txt = '"' + b.text.replace(/\n/g, '\\n') + '"', ww = w + tw(txt, size, { mono: true }) + 22;
        if (x > o.x && x + ww > o.x + o.w) { x = o.x; y += lh + 4; }
        items.push({ key: K0 + ':bb' + b.pid, kind: 'cell', x, y, w: r1(ww), h: lh, rx: 6, text: '', cls: 'bufbox', audit: 'group' });
        items.push({ key: K0 + ':bt' + b.pid, kind: 'cell', x: x + 4, y: y + 3, w, h: lh - 6, rx: (lh - 6) / 2, text: String(b.pid), size: tsize, cls: 'ptag ' + (b.cls || '') });
        items.push({ key: K0 + ':bx' + b.pid, kind: 'text', x: x + w + 12, y: y + lh / 2 + size * 0.36, text: txt, size, cls: 'termtext mono buf' });
        x += ww + 8;
      }
      h = y + lh - o.y;
    }
    return { items, w: o.w, h };
  };

  /** text broken into lines no wider than width at a size */
  P.wrap = function (text, width, size) {
    const out = [];
    let cur = '';
    for (const w of String(text).split(/\s+/)) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && tw(t, size) > width) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };

  P.legend = function (o) {
    const K0 = o.prefix || 'lg', items = [], size = o.size || 13, gap = o.gap || 18, sw = 16;
    let x = o.x, y = o.y;
    for (const e of o.entries) {
      const w = sw + 6 + tw(e.text, size);
      if (o.w && x > o.x && x + w > o.x + o.w) { x = o.x; y += size + 12; }
      items.push({ key: K0 + ':s' + e.text, kind: 'cell', x, y: y - sw / 2, w: sw, h: sw, rx: 4, text: '', cls: 'swatch ' + e.cls, audit: 'ignore' });
      items.push({ key: K0 + ':t' + e.text, kind: 'text', x: x + sw + 6, y: y + size * 0.36, text: e.text, size, cls: 'legtext' });
      x += w + gap;
    }
    return { items, w: o.w || x - o.x, h: y - o.y + sw };
  };
})(globalThis.Proses = globalThis.Proses || {});
