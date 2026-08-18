// The File-system lab, part three: the disk workbench's picture. The block map of the device a step touched, its
// legend and the namespace under it on the left; on the right whatever the step is about: the layout after mkfs, the
// blocks a command changed (one row each, the block's own colour on its badge), the writes of the last command in
// the order they reach the disk with the place the power failed, the journal, recovery and fsck, or the walk to
// byte N. Wide: about 1000 units across. Narrow: one column, about 380 across.
//   FL.diskPaint(o) -> items     o {sn, devs, names, lit, jlit, rd, seen, title, right(X, Y, RW) -> {items, h}, narrow}
//   FL.rows(prefix, X, Y, RW, rows) -> {items, h}       rows: [{badge, cls, text, tcls}]
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;
  const R = Math.round;
  FL.W = { map: 420, X: 456, RW: 548, nmap: 376, nRW: 376 };

  /** rows of a badge and a sentence: {items, h} */
  FL.rows = function (prefix, X, Y, RW, rows, o) {
    o = o || {};
    const items = [], rh = o.rh || 30, bw = o.bw || 64, size = o.size || 13;
    rows.forEach((r, i) => {
      const y = Y + i * rh;
      if (r.badge !== undefined && r.badge !== null) items.push(FL.cell(prefix + ':b' + i, X, y, bw, rh - 4, r.badge, (r.cls || 'dk') + (r.act ? ' act' : ''), 12));
      const tx = r.badge !== undefined && r.badge !== null ? X + bw + 10 : X;
      items.push(FL.text(prefix + ':t' + i, tx, y + rh / 2 + 1, FL.fit(r.text, RW - (tx - X), size, { bold: /strong|act|bad|good/.test(r.tcls || '') }), r.tcls || '', size));
    });
    return { items, h: rows.length * rh };
  };
  /** the badge of a block: its number, or a run */
  FL.badge = (blocks) => (blocks.length === 1 ? 'blk ' + blocks[0] : blocks.length ? FL.runs(blocks) : '—');

  /** the namespace as indented rows under the map */
  FL.nsRows = function (prefix, X, Y, W, devs, max, act) {
    const items = [], list = FL.tree(devs), shown = list.slice(0, max);
    items.push(FL.head(prefix + ':h', X, Y + 4, 'the namespace'));
    if (!list.length) items.push(FL.text(prefix + ':e', X, Y + 32, '/ is empty: only the root directory, inode ' + F().ROOT, 'tick', 13));
    shown.forEach((e, i) => {
      const x = X + 16 * e.depth, y = Y + 18 + i * 24, cls = e.type === 'directory' ? 'dk dk-data fl-dir' : e.type === 'symlink' ? 'dk dk-data fl-link' : 'dk dk-data';
      items.push(FL.cell(prefix + ':s' + i, x, y + 4, 14, 14, '', cls + (act && act.has(e.dev + ':' + e.ino) ? ' act' : ''), 12, { audit: 'ignore' }));
      const what = e.mount !== undefined ? `/  (device ${e.mount} mounted here)` : e.type === 'directory' ? '/' : e.type === 'symlink' ? ' → ' + e.target : '';
      const meta = e.type === 'file' ? `inode ${e.ino}${e.dev ? ' on ' + e.dev : ''} · ${FL.grp(e.size)} B · ${FL.plural(e.nlink, 'link')}` : `inode ${e.ino}${e.dev ? ' on ' + e.dev : ''}`;
      items.push(FL.text(prefix + ':n' + i, x + 22, y + 16, FL.fit(e.name + what + '   ' + meta, W - (x - X) - 22, 13, { mono: true }), 'mono', 13));
    });
    if (list.length > max) items.push(FL.text(prefix + ':more', X, Y + 18 + max * 24 + 16, `… and ${list.length - max} more names`, 'tick', 13));
    return { items, h: 18 + Math.min(list.length || 1, max) * 24 + (list.length > max ? 24 : 4) };
  };

  /**
   * one frame of the disk workbench: the map of a device, its legend and the namespace on the left, a panel on the
   * right. o: {sn (the snapshot drawn), devs (every device, for the namespace), lit, jlit, rd, seen, bad (Sets of
   * blocks), mapTitle, right(X, Y, RW) -> {items, h}, narrow, nsMax}
   */
  FL.diskPaint = function (o) {
    const items = [], g = o.sn.g, lk = FL.look(o.sn), narrow = o.narrow, W = narrow ? FL.W.nmap : FL.W.map;
    const lit = o.lit || new Set(), jlit = o.jlit || new Set(), rd = o.rd || new Set(), seen = o.seen || new Set(), bad = o.bad || new Set();
    items.push(FL.head('dm:t', 0, 14, FL.fit(o.mapTitle || `device ${o.sn.dev || 0}: ${g.nblocks} blocks of ${g.bs} bytes`, W, 14, { bold: true })));
    const m = FL.map({ prefix: 'dm:m', x: 0, y: 28, W, sn: o.sn, lk, pick: true, narrow, cls: (b) => (bad.has(b) ? 'hot' : lit.has(b) || jlit.has(b) ? 'act' : rd.has(b) ? 'fl-rd' : seen.has(b) ? 'seen' : '') });
    items.push(...m.items);
    const extra = [];
    if (lit.size || jlit.size) extra.push({ cls: 'dk act', text: o.litText || 'written by this step' });
    if (rd.size) extra.push({ cls: 'dk fl-rd', text: 'read' });
    if (o.sn.mem.size) extra.push({ cls: 'dk dk-free fl-mem', text: 'newer copy in memory' });
    if (bad.size) extra.push({ cls: 'dk hot', text: 'fsck: a problem here' });
    // the legend names only what the map shows
    const shown = new Set();
    for (let b = 0; b < g.nblocks; b++) shown.add(FL.blockCls(g, lk, b).replace(/^dk /, ''));
    const lg = FL.legend('dm:lg', 0, 28 + m.h + 14, FL.mapLegend(g).filter((e) => shown.has(e.cls)).concat(extra), W);
    items.push(...lg.items);
    let leftH = 28 + m.h + 14 + lg.h;
    const nsY = leftH + 22;
    if (!narrow && o.devs) { const ns = FL.nsRows('dm:ns', 0, nsY, W, o.devs, o.nsMax || 8, o.nsAct); items.push(...ns.items); leftH = nsY + ns.h; }
    if (o.right) {
      const X = narrow ? 0 : FL.W.X, Y = narrow ? leftH + 26 : 0, RW = narrow ? FL.W.nRW : FL.W.RW;
      const r = o.right(X, Y, RW);
      items.push(...r.items);
      if (narrow && o.devs && o.nsNarrow) { const ns = FL.nsRows('dm:ns', 0, Y + r.h + 22, RW, o.devs, Math.min(6, o.nsMax || 6), o.nsAct); items.push(...ns.items); }
    }
    return { items, map: m };
  };

  // ---- right-hand panels --------------------------------------------------------------------------------------
  /** the layout after mkfs: one row per region, and the largest file */
  FL.layoutPanel = function (g) {
    return (X, Y, RW) => {
      const items = [FL.head('lp:h', X, Y + 14, 'the layout mkfs wrote')], rows = [];
      const runOf = (r) => (r.count === 1 ? String(r.start) : r.start + '–' + (r.start + r.count - 1));
      for (const r of F().layout(g)) {
        const cls = 'dk ' + (r.region === 'data' ? 'dk-free' : FL.REG[r.region]), grp = r.group !== undefined && g.groups > 1 ? ` (group ${r.group})` : '';
        const what = {
          super: `superblock: the geometry, ${g.bs}-byte blocks, ${g.ninodes} inodes of ${g.isz} bytes, ${g.alloc} allocation`,
          ibm: `inode bitmap${grp}: one bit per inode; inode 0 reserved, ${F().ROOT} the root`,
          dbm: `data bitmap${grp}: one bit per data block, ${r.group !== undefined ? g.grp[r.group].ndata : g.ndata} of them`,
          fat: `FAT: one ${g.ps}-byte entry per data block, the next block of each chain`,
          itable: `inode table${grp}: ${g.bs / g.isz} inodes a block`,
          journal: `journal: a journal superblock and a log of ${g.jblocks - 1} blocks`,
          data: `data blocks${grp}: ${r.count} for files, directories${g.alloc === 'indexed' ? ' and indirect blocks' : ''}`,
        }[r.region];
        rows.push({ badge: runOf(r), cls, text: what });
      }
      const rr = FL.rows('lp:r', X, Y + 28, RW, rows.slice(0, 12), { bw: 70 });
      items.push(...rr.items);
      let y = Y + 28 + rr.h + 14;
      const max = F().maxFileSize(g);
      items.push(FL.head('lp:mh', X, y + 4, 'the largest file'));
      const formula = g.alloc === 'indexed' ? `${g.bs} × (${g.ndirect}${g.levels >= 1 ? ' + ' + g.P : ''}${g.levels >= 2 ? ' + ' + g.P + '²' : ''}${g.levels >= 3 ? ' + ' + g.P + '³' : ''}) = ${FL.bytes(max)}`
        : g.alloc === 'linked' ? `(2^${8 * g.ps} − 1) blocks × ${g.bs - g.ps} bytes = ${FL.bytes(max)}`
          : g.alloc === 'extent' ? `${F().nExtents(g)} extents × (2^${8 * g.ps} − 1) blocks × ${g.bs} = ${FL.bytes(max)}`
            : `(2^${8 * g.ps} − 1) blocks × ${g.bs} = ${FL.bytes(max)}`;
      items.push(FL.text('lp:mf', X, y + 30, FL.fit(formula, RW, 14, { mono: true }), 'mono', 14));
      const p2 = g.alloc === 'indexed' ? `P = ${g.bs} ÷ ${g.ps} = ${g.P} pointers in a block; ${g.ndirect} direct, ${g.levels} level${g.levels === 1 ? '' : 's'} of indirection` : `the disk itself is far smaller: ${FL.grp(g.ndata * F().payload(g))} bytes of data blocks`;
      items.push(FL.text('lp:mp', X, y + 54, FL.fit(p2, RW, 13), 'tick', 13));
      return { items, h: y + 64 - Y };
    };
  };

  /** the blocks one command changed, and what the journal did */
  FL.changePanel = function (rec, names, o) {
    o = o || {};
    return (X, Y, RW) => {
      const items = [];
      const head = (rec.i + 1) + '. ' + rec.cmd.text + (rec.uid ? '   (as uid ' + rec.uid + ')' : '');
      items.push(FL.text('cp:h', X, Y + 14, FL.fit(head, RW, 14, { mono: true, bold: true }), 'mono strong', 14));
      const io = rec.io, ioLine = `${FL.plural(io.reads, 'disk read')}, ${FL.plural(io.writes, 'disk write')}${rec.hits !== false ? ', ' + FL.plural(io.hits, 'cache hit') : ''}`;
      items.push(FL.text('cp:io', X, Y + 36, ioLine, 'tick', 13));
      let y = Y + 50;
      if (!rec.ok) {
        items.push(FL.cell('cp:err', X, y + 4, RW, 32, FL.fit(`${rec.err.code}: ${rec.err.message}`, RW - 20, 13), 'card stale', 13, { align: 'left' }));
        items.push(FL.text('cp:err2', X, y + 58, 'nothing on the disk changes', 'tick', 13));
        return { items, h: y + 64 - Y };
      }
      const rows = [];
      for (const cap of rec.caps) {
        const ex = FL.fold(FL.explain(cap, names), o.max || 9);
        for (const r of ex) rows.push({ badge: FL.badge(r.blocks || [r.block]), cls: blockBadgeCls(cap, r) + ' seen fl-badge', text: `${r.title}: ${r.detail}` });
        if (cap.deferred) rows.push({ badge: 'cache', cls: 'dk dk-free fl-mem', text: `write-back: ${FL.plural(cap.writes.length, 'block')} dirty in memory, not yet on the disk` });
        for (const j of FL.journalRows(cap)) rows.push({ badge: j.blocks.length ? FL.badge(j.blocks) : '—', cls: (j.kind === 'data' || j.kind === 'checkpoint' ? 'dk dk-data' : 'dk dk-jn') + (j.blocks.length ? ' seen fl-badge' : ''), text: `${j.title}: ${j.detail}` });
      }
      if (rec.got !== undefined) rows.push({ badge: rec.readBlocks && rec.readBlocks.length ? FL.badge(rec.readBlocks) : '—', cls: 'dk fl-rd', text: `read ${rec.got.length} bytes: "${FL.clip(rec.got.replace(/\n/g, ' '), 60)}"` });
      if (!rows.length) rows.push({ badge: null, text: rec.cmd.op === 'sync' ? 'nothing was dirty: no block to write' : 'no block of the disk changes', tcls: 'tick' });
      items.push(FL.head('cp:wh', X, y + 16, rec.caps.length ? 'what each changed block now holds' : 'what happened'));
      const maxR = RW < 400 ? 4 : o.maxRows || 14;
      const rr = FL.rows('cp:r', X, y + 28, RW, rows.slice(0, maxR));
      items.push(...rr.items);
      if (rows.length > maxR) items.push(FL.text('cp:more', X, y + 28 + rr.h + 14, `… ${rows.length - maxR} more in the Tables tab`, 'tick', 13));
      return { items, h: y + 28 + rr.h + 20 - Y };
    };
  };
  function blockBadgeCls(cap, r) {
    const g = cap.before.g;
    if (r.kind === 'data') return 'dk dk-data';
    if (r.kind === 'dir') return 'dk dk-data fl-dir';
    if (r.kind === 'indirect') return 'dk dk-data fl-ind';
    if (r.kind === 'link') return 'dk dk-data fl-link';
    return 'dk ' + FL.REG[F().region(g, r.block)];
  }
  FL.blockBadgeCls = blockBadgeCls;

  /** the writes of one commit, in order, with the cut; and a panel under it (o.below) */
  FL.writesPanel = function (cap, done, cut, cur, below) {
    return (X, Y, RW) => {
      const items = [], ws = cap.commit.writes, n = ws.length;
      items.push(FL.head('wp:h', X, Y + 14, n ? `its ${FL.plural(n, 'write')}, in the order they reach the disk` : 'its writes'));
      const short = (w) => (w.kind === 'TxB' ? 'begin ' + w.seq : w.kind === 'TxE' ? 'commit ' + w.seq : w.kind === 'log' ? 'log' : w.kind === 'jsb' ? 'j-super' : w.phase === 'checkpoint' ? 'ckpt' : (FL.KNAME[w.kind] || w.kind).replace('inode table', 'inode').replace('data bitmap', 'd-bitmap').replace('inode bitmap', 'i-bitmap').replace('superblock', 'super').replace('indirect block', 'indirect').replace('directory', 'dir'));
      const cw = Math.max(80, Math.min(100, Math.floor((RW + 8) / Math.max(1, Math.min(n, 6))) - 8));
      const wr = S.Kit.disk.writes({ prefix: 'wp:w', x: X, y: Y + 28, maxW: RW, list: ws.map((w, i) => ({ lines: [(i + 1) + '. ' + short(w), (w.phase === 'checkpoint' ? '→ ' : 'blk ') + w.block], cls: (i < done ? (i === cur ? 'act' : 'done') : cut !== null && cut !== undefined ? 'lost' : '') + ' ph-' + (w.phase || 'home') })), cw, ch: 44, gap: 8, crashAfter: cut === null || cut === undefined || cut >= n ? null : cut, size: 12 });
      items.push(...wr.items);
      let h = 28 + (n ? wr.h : 0) + 18;
      if (!n) items.push(FL.text('wp:none', X, Y + 50, cap.deferred ? 'none yet: with a write-back cache the blocks wait in memory' : 'none', 'tick', 13));
      if (below) { const b = below(X, Y + h + 8, RW); items.push(...b.items); h += 8 + b.h; }
      return { items, h };
    };
  };
  /** rows of sentences (recovery, fsck, repairs): {title, rows: [{text, cls}]} list */
  FL.sayPanel = function (sections) {
    return (X, Y, RW) => {
      const items = [];
      let y = Y;
      sections.forEach((s, k) => {
        items.push(FL.head('sp:h' + k, X, y + 14, s.title));
        y += 26;
        const max = RW < 400 ? Math.min(2, s.max || 8) : s.max || 8;
        s.rows.slice(0, max).forEach((r, i) => {
          const lines = S.Kit.disk.wrap(r.text, RW - 20, 13).slice(0, 2);
          const h = lines.length * 18 + 12;
          items.push(FL.cell('sp:c' + k + '.' + i, X, y, RW, h, lines.length > 1 ? lines : lines[0], 'card oc ' + (r.cls || ''), 13, { align: 'left' }));
          y += h + 6;
        });
        if (s.rows.length > max) { items.push(FL.text('sp:m' + k, X, y + 12, `… ${s.rows.length - max} more`, 'tick', 13)); y += 22; }
        y += 10;
      });
      return { items, h: y - Y };
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
