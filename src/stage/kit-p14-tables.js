// The three tables of open files, as the kernel keeps them: each process's descriptor table, the system-wide
// open-file table (offset, access mode, reference count) and the in-memory inode table (open count, links, size),
// with an arrow from every descriptor to its open-file entry and from every entry to its inode. The input is the
// snapshot shape both S.FS.Sys and the simulated kernel give (sys.snapshot() / sys.fsSnapshot()).
//   S.Kit.fsTables.draw({prefix, x, y, snap, procs: [pid..] (order; default all), label(pid), name(dev, ino), group,
//       act: {pid, fd, file, ino}, hot: {file, ino}, widths: [fdW, fileW, inoW], gap, rowH, size, others: bool})
//     -> {items, w, h, fdAt(pid, fd), fileAt(id), inoAt(dev, ino)}
//   group: consecutive descriptors on one terminal or pipe entry share a row (fd 0–2).
//   S.Kit.fsTables.code({prefix, x, y, w, src: [line..], lineH, size, title, act: line, tag: text}) -> {items, w, h}
//     a C listing whose leading #include lines fold into one row (their numbers kept), the current line banded and
//     tagged with the process on it (a variant of S.Kit.proc.code, shorter for these pictures)
//   Rows are ordered so arrows cross as little as they can: open-file entries by their first descriptor, inodes by
//   their first entry. An arrow that still has to cross another is marked as one that may (edge-x).
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const FT = (K.fsTables = {});
  const R = Math.round;

  FT.draw = function (o) {
    const P = o.prefix, snap = o.snap, items = [], size = o.size || 13, rowH = o.rowH || 32, gap = o.gap === undefined ? 86 : o.gap;
    const [fw, ow, iw] = o.widths || [150, 214, 214];
    const x0 = o.x, x1 = x0 + fw + gap, x2 = x1 + ow + gap, top = o.y + 26;
    const act = o.act || {}, hot = o.hot || {};
    const pids = o.procs || snap.procs.map((p) => p.pid);
    const procs = pids.map((pid) => snap.procs.find((p) => p.pid === pid)).filter(Boolean);
    // open-file entries: the files, plus (from the kernel) terminals and pipes when asked
    const files = snap.files.map((f) => Object.assign({ kind: 'file' }, f));
    if (o.others && snap.others) for (const x of snap.others) files.push(Object.assign({}, x, { dev: -1, ino: null }));
    const fileById = new Map(files.map((f) => [f.id, f]));
    items.push(S.T12.title(P + ':h0', x0, o.y + 13, 'descriptors'), S.T12.title(P + ':h1', x1, o.y + 13, 'open-file table'), S.T12.title(P + ':h2', x2, o.y + 13, 'inode table'));
    // descriptor tables, one panel a process
    const fdPos = new Map(), order = [];
    let y = top;
    procs.forEach((p, i) => {
      let fds = p.fds.slice().sort((a, b) => a.fd - b.fd).filter((d) => fileById.has(d.file)).map((d) => Object.assign({ to: d.fd }, d));
      // consecutive descriptors on the same terminal or pipe entry share one row (fd 0–2), to save room
      if (o.group) fds = fds.reduce((acc, d) => { const l = acc[acc.length - 1]; if (l && l.file === d.file && l.to === d.fd - 1 && fileById.get(d.file).kind !== 'file') l.to = d.fd; else acc.push(d); return acc; }, []);
      const h = 28 + Math.max(1, fds.length) * rowH + 6;
      items.push({ key: P + ':pp' + p.pid, kind: 'region', x: R(x0), y: R(y), w: fw, h: R(h), rx: 8, cls: 'ft-proc' + (act.pid === p.pid ? ' act' : ''), audit: 'group' });
      items.push(S.T12.text(P + ':pt' + p.pid, x0 + 10, y + 19, o.label ? o.label(p.pid) : 'process ' + p.pid, 'strong', size));
      if (!fds.length) items.push(S.T12.text(P + ':pe' + p.pid, x0 + 10, y + 28 + rowH / 2 + 5, 'no descriptors', 'tick', size));
      fds.forEach((d, k) => {
        const ry = y + 28 + k * rowH, lit = act.pid === p.pid && act.fd === d.fd;
        items.push({ key: P + ':fd' + p.pid + '.' + d.fd, kind: 'cell', x: R(x0 + 8), y: R(ry), w: fw - 16, h: rowH - 4, rx: 4, text: 'fd ' + d.fd + (d.to > d.fd ? '–' + d.to : ''), size, cls: 'ft-fd' + (lit ? ' act' : '') });
        fdPos.set(p.pid + '.' + d.fd, { x: x0 + fw - 8, y: ry + (rowH - 4) / 2 });
        order.push({ pid: p.pid, fd: d.fd, file: d.file });
      });
      y += h + 12;
    });
    const hL = y - top;
    // open-file entries, in the order their first descriptor appears
    const fOrder = [];
    for (const r of order) if (!fOrder.includes(r.file)) fOrder.push(r.file);
    for (const f of files) if (!fOrder.includes(f.id)) fOrder.push(f.id);
    const fh = o.cellH || 50, filePos = new Map();
    fOrder.forEach((id, k) => {
      const f = fileById.get(id), fy = top + k * (fh + 10), lit = act.file === id, isHot = hot.file === id;
      const lines = f.kind === 'file' ? ['entry ' + id + ' · ' + modeWord(f.flags), 'offset ' + f.offset + ' · refs ' + f.refs] : ['entry ' + id + ' · ' + f.kind, 'refs ' + f.refs];
      items.push({ key: P + ':of' + id, kind: 'cell', x: R(x1), y: R(fy), w: ow, h: fh, rx: 6, lines, size, cls: 'ft-file' + (f.kind !== 'file' ? ' other' : '') + (lit ? ' act' : '') + (isHot ? ' hot' : '') });
      filePos.set(id, { l: { x: x1, y: fy + fh / 2 }, r: { x: x1 + ow, y: fy + fh / 2 } });
    });
    if (!fOrder.length) items.push(S.T12.text(P + ':e1', x1 + 10, top + 22, 'no open files', 'tick', size));
    const hM = fOrder.length * (fh + 10);
    // inodes, in the order of their first entry
    const iKey = (dev, ino) => dev + ':' + ino, iOrder = [];
    for (const id of fOrder) { const f = fileById.get(id); if (f.kind === 'file' && !iOrder.includes(iKey(f.dev, f.ino))) iOrder.push(iKey(f.dev, f.ino)); }
    for (const n of snap.inodes) if (!iOrder.includes(iKey(n.dev, n.ino))) iOrder.push(iKey(n.dev, n.ino));
    const ih = o.cellH || 50, inoPos = new Map();
    iOrder.forEach((key, k) => {
      const n = snap.inodes.find((m) => iKey(m.dev, m.ino) === key);
      if (!n) return;
      const iy = top + k * (ih + 10), lit = act.ino === n.ino && (act.dev === undefined || act.dev === n.dev), isHot = hot.ino === n.ino;
      const nm = o.name ? o.name(n.dev, n.ino) : '';
      const l1 = 'inode ' + n.ino + (n.dev ? ' (dev ' + n.dev + ')' : '') + (nm ? ' · ' + nm : ''), l2 = 'open ' + n.refs + ' · links ' + n.nlink + ' · ' + n.size + ' B';
      items.push({ key: P + ':in' + key, kind: 'cell', x: R(x2), y: R(iy), w: iw, h: ih, rx: 6, lines: [l1, l2], size, cls: 'ft-ino' + (n.orphan ? ' orphan' : '') + (lit ? ' act' : '') + (isHot ? ' hot' : '') });
      inoPos.set(key, { x: x2, y: iy + ih / 2 });
    });
    if (!iOrder.length) items.push(S.T12.text(P + ':e2', x2 + 10, top + 22, 'no inodes in use', 'tick', size));
    const hR = iOrder.length * (ih + 10);
    // arrows: descriptor -> entry, entry -> inode; those that cannot help crossing may
    const e1 = order.map((r) => ({ key: P + ':a' + r.pid + '.' + r.fd, a: fdPos.get(r.pid + '.' + r.fd), b: filePos.get(r.file).l, lit: act.pid === r.pid && act.fd === r.fd }));
    const e2 = fOrder.map((id) => { const f = fileById.get(id); return f.kind === 'file' && inoPos.has(iKey(f.dev, f.ino)) ? { key: P + ':b' + id, a: filePos.get(id).r, b: inoPos.get(iKey(f.dev, f.ino)), lit: act.file === id } : null; }).filter(Boolean);
    for (const set of [e1, e2]) {
      set.forEach((e, i) => {
        const crosses = set.some((f, j) => j !== i && (e.a.y - f.a.y) * (e.b.y - f.b.y) < 0);
        items.push({ key: e.key, kind: 'edge', from: { x: R(e.a.x), y: R(e.a.y) }, to: { x: R(e.b.x), y: R(e.b.y) }, cls: 'ft-arrow' + (e.lit ? ' act' : ''), audit: crosses ? 'edge-x' : undefined });
      });
    }
    return {
      items, w: x2 + iw - x0, h: 26 + Math.max(hL, hM, hR),
      fdAt: (pid, fd) => fdPos.get(pid + '.' + fd), fileAt: (id) => filePos.get(id), inoAt: (dev, ino) => inoPos.get(iKey(dev, ino)),
    };
  };
  FT.code = function (o) {
    const P = o.prefix, items = [], size = o.size || 13, lh = o.lineH || 20, cw = size * 0.61, src = o.src;
    let inc = 0; while (inc < src.length && /^#include/.test(src[inc])) inc++;
    const rows = [];
    if (inc > 1) rows.push({ ln: 1, to: inc, text: '#include ' + src.slice(0, inc).map((l) => l.replace(/^#include\s*/, '')).join(' ') });
    else if (inc === 1) rows.push({ ln: 1, to: 1, text: src[0] });
    for (let k = inc; k < src.length; k++) rows.push({ ln: k + 1, to: k + 1, text: src[k] });
    const numW = Math.round(S.textWidth((inc > 1 ? '1–' + inc : String(src.length)), size, { mono: true }) + 12), top = o.title ? 32 : 10;
    const h = top + rows.length * lh + 8, x0 = o.x + numW + 10;
    items.push({ key: P + ':panel', kind: 'region', x: o.x, y: o.y, w: o.w, h, rx: 8, cls: 'codepanel', audit: 'group', layer: 'back' });
    if (o.title) items.push({ key: P + ':title', kind: 'text', x: o.x + 12, y: o.y + 21, text: o.title, size: 13, cls: 'codetitle mono' });
    rows.forEach((r, k) => {
      const ry = o.y + top + k * lh, ty = ry + lh / 2 + size * 0.36, on = o.act >= r.ln && o.act <= r.to;
      if (on) items.push({ key: P + ':band', kind: 'cell', x: o.x + 4, y: ry, w: o.w - 8, h: lh, rx: 4, text: '', cls: 'codeband', layer: 'back', audit: 'ignore' });
      items.push({ key: P + ':n' + r.ln, kind: 'text', x: o.x + numW, y: R(ty), text: r.to > r.ln ? r.ln + '–' + r.to : String(r.ln), anchor: 'end', size, cls: 'codenum mono' + (on ? ' act' : '') });
      const body = r.text.replace(/\s+$/, ''), lead = body.length - body.replace(/^\s+/, '').length;
      if (body.trim()) items.push({ key: P + ':c' + r.ln, kind: 'text', x: R(x0 + lead * cw), y: R(ty), text: body.trim(), size, cls: 'code mono' + (on ? ' act' : '') + (r.to > r.ln ? ' fold' : '') });
      if (on && o.tag) {
        const tx = Math.round(x0 + (lead + body.trim().length) * cw + 12), tw = Math.round(S.textWidth(o.tag, 13, { bold: true }) + 14);
        items.push({ key: P + ':tag', kind: 'cell', x: tx, y: ry + 2, w: tw, h: lh - 4, rx: (lh - 4) / 2, text: o.tag, size: 13, cls: 'ft-tag' });
      }
    });
    return { items, w: o.w, h };
  };
  const modeWord = (fl) => (fl.includes('r') && fl.includes('w') ? 'read-write' : fl.includes('w') ? 'write' : 'read') + (fl.includes('a') ? ', append' : '');
  FT.modeWord = modeWord;
})(globalThis.Proses = globalThis.Proses || {});
