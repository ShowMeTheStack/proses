// Descriptors, open files and pipes, as the kernel keeps them: each process's descriptor table (one row of cells,
// fd 0 first, each naming the open-file entry it points to), the system-wide open-file table (one row an entry:
// what it is, its offset and how many descriptors share it), and each pipe's buffer as a strip of bytes. Entries
// are told apart by kind: the terminal, a pipe's read end, its write end, a file. Every key starts with o.prefix.
//   S.Kit.fd.kindOf(of) -> 'tty' | 'pr' | 'pw' | 'file' | 'sink' | 'null'     the class suffix for an entry
//   S.Kit.fd.procs({prefix, x, y, procs: [{pid, lines, cls, fds: [ofid | null], hl: [fd]}], ofiles, labelW, cellW,
//     rowH, gap, maxFds, size}) -> {items, w, h, cell(pid, fd) -> {x, y, w, h}}
//     a process's label box (coloured by its state) and its descriptors; a closed slot is drawn empty; hl lights fds
//   S.Kit.fd.files({prefix, x, y, w, rows: [{id, kind, text, refs, cls}], rowH, size}) -> {items, h}
//     the open-file table: the entry's number, what it is, and its reference count
//   S.Kit.fd.pipe({prefix, x, y, w, name, buf, cap, info, cls, cellW, size}) -> {items, h}  (info: the words after it)
//     a pipe: its bytes in order (the oldest on the left, the reader's end), then how full it is and who has it open
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const FD = (K.fd = {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const tw = (t, size, o) => S.textWidth(String(t), size || 13, o);

  FD.kindOf = (of) => (!of ? 'none' : of.kind === 'pipe' ? (of.end === 'r' ? 'pr' : 'pw') : of.kind);

  FD.procs = function (o) {
    const P = o.prefix || 'fd', items = [], lw = o.labelW || 112, cw = o.cellW || 56, rh = o.rowH || 44, gap = o.gap === undefined ? 8 : o.gap, size = o.size || 13;
    const max = o.maxFds || 6, pos = {};
    o.procs.forEach((p, i) => {
      const y = o.y + i * (rh + gap);
      items.push({ key: P + ':l' + p.pid, kind: 'cell', x: o.x, y, w: lw, h: rh, rx: 8, lines: p.lines, size, cls: 'fdproc ' + (p.cls || '') });
      const n = Math.min(max, Math.max(3, p.fds.length));
      for (let fd = 0; fd < n; fd++) {
        const id = p.fds[fd], of = id === null || id === undefined ? null : o.ofiles[id];
        const x = o.x + lw + 6 + fd * (cw + 4), lit = (p.hl || []).includes(fd);
        pos[p.pid + ':' + fd] = { x, y, w: cw, h: rh };
        items.push({ key: P + ':c' + p.pid + '_' + fd, kind: 'cell', x: r1(x), y, w: cw, h: rh, rx: 6, lines: of ? [String(fd), '#' + id] : [String(fd), '—'], size, cls: 'fdcell ' + (of ? 'of-' + FD.kindOf(of) : 'closed') + (lit ? ' act' : '') });
      }
      if (p.fds.length > max) items.push({ key: P + ':more' + p.pid, kind: 'text', x: o.x + lw + 6 + max * (cw + 4) + 2, y: y + rh / 2 + 5, text: '+' + (p.fds.length - max), size, cls: 'muted' });
    });
    const w = lw + 6 + max * (cw + 4);
    return { items, w, h: o.procs.length * (rh + gap) - gap, cell: (pid, fd) => pos[pid + ':' + fd] };
  };

  FD.files = function (o) {
    const P = o.prefix || 'of', items = [], rh = o.rowH || 26, size = o.size || 13, idW = 40, refW = 70;
    o.rows.forEach((r, i) => {
      const y = o.y + i * (rh + 4);
      items.push({ key: P + ':i' + r.id, kind: 'cell', x: o.x, y, w: idW, h: rh, rx: 5, text: '#' + r.id, size, cls: 'fdcell of-' + r.kind + (r.cls ? ' ' + r.cls : '') });
      items.push({ key: P + ':t' + r.id, kind: 'cell', x: o.x + idW + 4, y, w: o.w - idW - refW - 8, h: rh, rx: 5, text: r.text, size, cls: 'oftext' + (r.cls ? ' ' + r.cls : ''), align: 'left' });
      items.push({ key: P + ':r' + r.id, kind: 'cell', x: o.x + o.w - refW, y, w: refW, h: rh, rx: 5, text: 'refs ' + r.refs, size, cls: 'oftext mono' + (r.refsCls ? ' ' + r.refsCls : '') });
    });
    return { items, h: o.rows.length ? o.rows.length * (rh + 4) - 4 : 0 };
  };

  FD.pipe = function (o) {
    const P = o.prefix || 'pp', items = [], size = o.size || 13, cw = o.cellW || 20, h = 26, nameW = Math.max(64, Math.ceil(tw(o.name, size, { bold: true })) + 14);
    items.push({ key: P + ':n', kind: 'cell', x: o.x, y: o.y, w: nameW, h, rx: 6, text: o.name, size, cls: 'pipename' + (o.cls ? ' ' + o.cls : '') });
    const info = o.info || o.buf.length + ' of ' + o.cap + ' bytes';
    const infoW = Math.ceil(tw(info, size)) + 8;
    const room = o.w - nameW - 10 - infoW - 10, n = Math.max(4, Math.floor(room / cw));
    const shown = o.buf.length > n ? o.buf.slice(0, n - 1) : o.buf;
    const x0 = o.x + nameW + 8;
    items.push({ key: P + ':trk', kind: 'cell', x: x0, y: o.y, w: n * cw, h, rx: 4, text: '', cls: 'pipetrack', audit: 'group', layer: 'back' });
    [...shown].forEach((ch, i) => items.push({ key: P + ':b' + i, kind: 'cell', x: x0 + i * cw, y: o.y + 2, w: cw - 2, h: h - 4, rx: 3, text: ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch, size, cls: 'pipebyte' }));
    if (o.buf.length > n) items.push({ key: P + ':more', kind: 'cell', x: x0 + (n - 1) * cw, y: o.y + 2, w: cw - 2, h: h - 4, text: '…', size, cls: 'pipebyte more' });
    items.push({ key: P + ':info', kind: 'text', x: x0 + n * cw + 10, y: o.y + h / 2 + 5, text: info, size, cls: 'muted' });
    return { items, h };
  };
})(globalThis.Proses = globalThis.Proses || {});
