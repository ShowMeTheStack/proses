// The File-system lab, part two: reading a disk image back for the picture. Which block is what (the region, and in
// the data region whose block it is and as what: data, directory, indirect, symlink), the block map drawn from that,
// and one sentence for each block a command changed, worked out by decoding the block before and after with the
// engine's own decoders: bitmap bits, inode fields, directory entries, pointer entries, FAT entries, the bytes.
//   FL.look(sn) -> {owner: Map(b -> ino), kind: Map(b -> 'data'|'dir'|'indirect'|'link'), live, inodes: Map(ino -> n)}
//   FL.map(o) -> {items, w, h, at(b)}          FL.explain(cap, names) -> [{block, kind, title, detail}]
//   FL.journalRows(cap) -> [{block(s), title, detail}]     FL.names(devs) -> Map('dev:ino' -> path)
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;
  const R = Math.round;
  const REG = { super: 'dk-sb', ibm: 'dk-ibm', dbm: 'dk-dbm', fat: 'dk-dbm', itable: 'dk-it', journal: 'dk-jn' };
  const KCLS = { data: 'dk-data', dir: 'dk-data fl-dir', indirect: 'dk-data fl-ind', link: 'dk-data fl-link' };
  FL.REG = REG;
  FL.KCLS = KCLS;
  const NAME = { super: 'superblock', ibm: 'inode bitmap', dbm: 'data bitmap', fat: 'FAT', itable: 'inode table', journal: 'journal', inode: 'inode table', dir: 'directory', indirect: 'indirect block', link: 'symlink', data: 'data', log: 'journal', TxB: 'journal', TxE: 'journal', jsb: 'journal super' };
  FL.KNAME = NAME;

  /** who owns each block, and as what, on the file system as mounted from a snapshot */
  FL.look = function (sn) {
    const img = FL.live(sn), g = img.g, owner = new Map(), kind = new Map(), inodes = new Map();
    for (let i = 1; i < g.ninodes; i++) {
      let n;
      try { n = F().readInode(img, i); } catch (e) { continue; }
      if (!n.type || n.type > F().T_LINK) continue;
      inodes.set(i, n);
      let list = [];
      try { list = F().ownedBlocks(img, n); } catch (e) { list = []; }
      for (const x of list) {
        if (!(x.block > 0 && x.block < g.nblocks) || !F().isData(g, x.block) || owner.has(x.block)) continue;
        owner.set(x.block, i);
        kind.set(x.block, x.kind === 'indirect' ? 'indirect' : n.type === F().T_DIR ? 'dir' : n.type === F().T_LINK ? 'link' : 'data');
      }
    }
    return { img, owner, kind, inodes };
  };
  /** the colour class of block b */
  FL.blockCls = function (g, lk, b) {
    const r = F().region(g, b);
    if (r !== 'data') return 'dk ' + REG[r];
    return 'dk ' + (lk.kind.has(b) ? KCLS[lk.kind.get(b)] : 'dk-free');
  };
  FL.mapLegend = (g, extra) => [{ cls: 'dk-sb', text: 'superblock' }, { cls: 'dk-ibm', text: 'inode bitmap' }, { cls: 'dk-dbm', text: g.fat ? 'FAT' : 'data bitmap' }, { cls: 'dk-it', text: 'inode table' }]
    .concat(g.jblocks ? [{ cls: 'dk-jn', text: 'journal' }] : [])
    .concat([{ cls: 'dk-data', text: 'file data' }, { cls: 'dk-data fl-dir', text: 'directory' }, { cls: 'dk-data fl-ind', text: g.alloc === 'indexed' ? 'indirect' : 'pointers' }, { cls: 'dk-data fl-link', text: 'symlink' }, { cls: 'dk-free', text: 'free' }])
    .concat(extra || []);

  /** the cell size for a disk of n blocks in a width */
  FL.grid = function (n, W, narrow) {
    const cols = n <= 64 ? 8 : n <= 96 ? 12 : 16, gap = 3, cw = Math.min(50, Math.floor((W - gap * (cols - 1)) / cols));
    const ch = narrow ? (n <= 32 ? 28 : n <= 64 ? 24 : 22) : n <= 32 ? 34 : n <= 64 ? 30 : n <= 96 ? 28 : 26;
    return { cols, gap, cw, ch, size: cw >= 40 ? 13 : cw >= 30 ? 12 : 11 };
  };
  /**
   * the block map of a snapshot: o {prefix, x, y, W, sn, lk, cls(b) -> extra classes, text(b), pick: bool}
   * -> {items, w, h, at(b)}. Blocks dirty in memory (not yet home) are dashed.
   */
  FL.map = function (o) {
    const g = o.sn.g, q = FL.grid(g.nblocks, o.W, o.narrow), items = [];
    const pos = (b) => ({ x: R(o.x + (b % q.cols) * (q.cw + q.gap)), y: R(o.y + Math.floor(b / q.cols) * (q.ch + q.gap)) });
    for (let b = 0; b < g.nblocks; b++) {
      const p = pos(b), mem = o.sn.mem.has(b) ? ' fl-mem' : '', extra = o.cls ? o.cls(b) || '' : '';
      items.push(Object.assign({ key: o.prefix + ':b' + b, kind: 'cell', x: p.x, y: p.y, w: q.cw, h: q.ch, rx: 3, text: o.text ? o.text(b) : String(b), size: q.size, cls: (FL.blockCls(g, o.lk, b) + mem + ' ' + extra).trim() }, o.pick ? { pick: true, title: 'block ' + b } : {}));
    }
    const rows = Math.ceil(g.nblocks / q.cols);
    return { items, w: q.cols * (q.cw + q.gap) - q.gap, h: rows * (q.ch + q.gap) - q.gap, at: (b) => { const p = pos(b); return { x: p.x, y: p.y, w: q.cw, h: q.ch, cx: p.x + q.cw / 2, cy: p.y + q.ch / 2 }; }, q };
  };

  /** the first path naming each inode: Map('dev:ino' -> path) */
  FL.names = function (devs) {
    const m = new Map();
    for (const e of FL.tree(devs)) { const k = e.dev + ':' + e.ino; if (!m.has(k)) m.set(k, e.path); }
    for (const d of devs) if (d.dev && d.at) m.set(d.dev + ':' + F().ROOT, d.at);
    m.set('0:' + F().ROOT, '/');
    return m;
  };

  // ---- one sentence per changed block ----------------------------------------------------------------------------
  const TYPE = ['free', 'file', 'directory', 'symlink'];
  function slotNames(g) {
    const n = g.ndirect + 3;
    if (g.alloc === 'indexed') return Array.from({ length: n }, (_, i) => (i < g.ndirect ? 'd' + i : ['single', 'double', 'triple'][i - g.ndirect]));
    if (g.alloc === 'contiguous') return ['start', 'count'];
    if (g.alloc === 'extent') return Array.from({ length: F().nExtents(g) * 2 }, (_, i) => 'e' + (i >> 1) + (i % 2 ? ' len' : ' start'));
    return ['first', 'last', 'count'];
  }
  FL.slotNames = slotNames;
  const slots = (g, n) => Array.from({ length: g.ndirect + 3 }, (_, i) => F().slot(g, n, i));
  function inodeChange(g, a, b, ino, name) {
    const who = 'inode ' + ino + (name ? ' (' + name + ')' : '');
    if (!a.type && b.type) {
      const sl = slots(g, b), nm = slotNames(g), set = nm.map((x, i) => (sl[i] ? x + ' ' + sl[i] : '')).filter(Boolean);
      return `${who}: a new ${TYPE[b.type]}, mode ${F().modeString(b.mode)}, ${FL.plural(b.nlink, 'link')}, size ${b.size}${set.length ? ', ' + set.slice(0, 4).join(', ') : ''}`;
    }
    if (a.type && !b.type) return `${who}: freed (it was a ${TYPE[a.type]})`;
    const ch = [];
    if (a.nlink !== b.nlink) ch.push(`links ${a.nlink} → ${b.nlink}`);
    if (a.size !== b.size) ch.push(`size ${a.size} → ${b.size}`);
    if (a.mode !== b.mode) ch.push(`mode ${F().modeString(a.mode)} → ${F().modeString(b.mode)}`);
    if (a.uid !== b.uid || a.gid !== b.gid) ch.push(`owner ${a.uid}:${a.gid} → ${b.uid}:${b.gid}`);
    const sa = slots(g, a), sb = slots(g, b), nm = slotNames(g);
    nm.forEach((x, i) => { if (sa[i] !== sb[i]) ch.push(!sa[i] ? `${x} = ${sb[i]}` : !sb[i] ? `${x} ${sa[i]} cleared` : `${x} ${sa[i]} → ${sb[i]}`); });
    return `${who}: ${ch.length ? ch.join(', ') : 'rewritten unchanged'}`;
  }
  /** the bits that differ between two bitmap blocks: [{bit, on}] */
  function bitDiff(a, b, limit) {
    const out = [];
    for (let i = 0; i < Math.min(a.length, b.length) * 8 && i < limit; i++) { const x = F().getBit(a, i), y = F().getBit(b, i); if (x !== y) out.push({ bit: i, on: !!y }); }
    return out;
  }
  const bitsSay = (list, what) => {
    const on = list.filter((x) => x.on), off = list.filter((x) => !x.on), part = [];
    if (on.length) part.push(`${on.length === 1 ? 'bit ' + on[0].bit + ' set' : 'bits ' + FL.runs(on.map((x) => x.bit)) + ' set'}: ${what(on, true)}`);
    if (off.length) part.push(`${off.length === 1 ? 'bit ' + off[0].bit + ' cleared' : 'bits ' + FL.runs(off.map((x) => x.bit)) + ' cleared'}: ${what(off, false)}`);
    return part.join('; ') || 'no bit changed';
  };
  /**
   * every block an operation changed, with what changed in it: [{block, kind, title, detail, blocks}]
   * cap: {before (image), writes: [{block, kind, bytes}], dev}; names: Map('dev:ino' -> path)
   */
  FL.explain = function (cap, names) {
    const before = cap.before, g = before.g, out = [], nm = (ino) => names && names.get(cap.dev + ':' + ino);
    const old = (b) => F().readBlock(before, b);
    for (const w of cap.writes) {
      const a = old(w.block), b = w.bytes, row = { block: w.block, kind: w.kind, title: NAME[w.kind] || w.kind };
      if (w.kind === 'ibm') {
        const G = g.grp.find((x) => x.ibm === w.block) || g.grp[0];
        row.detail = bitsSay(bitDiff(a, b, G.nino), (l, on) => (l.length === 1 ? 'inode ' + (G.ino0 + l[0].bit) : 'inodes ' + FL.runs(l.map((x) => G.ino0 + x.bit))) + (on ? ' in use' : ' free'));
      } else if (w.kind === 'dbm') {
        const G = g.grp.find((x) => x.dbm === w.block) || g.grp[0];
        row.detail = bitsSay(bitDiff(a, b, G.ndata), (l, on) => (l.length === 1 ? 'block ' + (G.data + l[0].bit) : 'blocks ' + FL.runs(l.map((x) => G.data + x.bit))) + (on ? ' in use' : ' free'));
      } else if (w.kind === 'fat') {
        const per = g.bs / g.ps, j0 = (w.block - g.dbmStart) * per, parts = [];
        for (let k = 0; k < per; k++) {
          const x = F().getPtr(a, k * g.ps, g.ps), y = F().getPtr(b, k * g.ps, g.ps), blk = g.dataStart + j0 + k;
          if (x !== y && blk < g.nblocks) parts.push(`FAT[${blk}] = ${y === g.EOC ? 'end' : y === 0 ? 'free' : y}`);
        }
        row.detail = parts.length ? parts.slice(0, 5).join(', ') + (parts.length > 5 ? ` and ${parts.length - 5} more` : '') : 'no entry changed';
      } else if (w.kind === 'inode') {
        const per = g.bs / g.isz, parts = [];
        for (let k = 0; k < per; k++) {
          const off = k * g.isz, G = g.grp.find((x) => w.block >= x.it && w.block < x.it + x.itBlocks) || g.grp[0], ino = G.ino0 + (w.block - G.it) * per + k;
          if (ino >= g.ninodes) continue;
          let same = true;
          for (let i = off; i < off + g.isz; i++) if (a[i] !== b[i]) { same = false; break; }
          if (same) continue;
          parts.push(inodeChange(g, F().decodeInode(g, a, off), F().decodeInode(g, b, off), ino, nm(ino)));
        }
        row.detail = parts.join('; ') || 'no inode changed';
      } else if (w.kind === 'dir') {
        const parts = [];
        for (let off = 0; off + F().DIRENT <= g.bs; off += F().DIRENT) {
          const x = F().decodeDirent(a, off), y = F().decodeDirent(b, off);
          if (x.ino === y.ino && x.name === y.name) continue;
          if (y.ino && (!x.ino || x.name !== y.name)) parts.push(`+ ${y.name} → inode ${y.ino}`);
          else if (!y.ino && x.ino) parts.push(`− ${x.name}`);
          else parts.push(`${y.name} → inode ${y.ino}`);
        }
        row.detail = (parts.length ? parts.join(', ') : 'entries unchanged');
      } else if (w.kind === 'indirect') {
        const parts = [];
        for (let k = 0; k < g.bs / g.ps; k++) { const x = F().getPtr(a, k * g.ps, g.ps), y = F().getPtr(b, k * g.ps, g.ps); if (x !== y) parts.push({ k, y }); }
        row.detail = (parts.length ? parts.slice(0, 4).map((p) => `[${p.k}] = ${p.y || '—'}`).join(', ') + (parts.length > 4 ? ` and ${parts.length - 4} more` : '') : 'no entry changed');
      } else if (w.kind === 'link') {
        row.detail = `holds the target "${FL.clip(FL.show(b).replace(/·+$/, ''), 40)}"`;
      } else if (w.kind === 'super') {
        const oa = orphansOf(a), ob = orphansOf(b);
        row.detail = `orphan list [${oa.join(', ')}] → [${ob.join(', ')}]` + (ob.length > oa.length ? ': an open file lost its last name' : '');
      } else {
        // data: the bytes that differ
        let lo = -1, hi = -1;
        const lim = g.alloc === 'linked' ? g.bs - g.ps : g.bs;
        for (let i = 0; i < lim; i++) if (a[i] !== b[i]) { if (lo < 0) lo = i; hi = i; }
        const nx = g.alloc === 'linked' ? F().getPtr(b, g.bs - g.ps, g.ps) : null;
        row.detail = (lo < 0 ? 'bytes unchanged' : `bytes ${FL.range(lo, hi)}: "${FL.clip(FL.show(b.subarray(lo, hi + 1)), 28)}"`) + (nx !== null && nx !== F().getPtr(a, g.bs - g.ps, g.ps) ? `, next block ${nx || 'none'}` : '');
      }
      out.push(row);
    }
    return out;
  };
  function orphansOf(u) {
    const ORPH = 4 + 4 * 15 + 4, n = F().get32(u, ORPH), out = [];
    for (let i = 0; i < n && ORPH + 8 + 4 * i <= u.length; i++) out.push(F().get32(u, ORPH + 4 + 4 * i));
    return out;
  }
  /** many data rows of one operation folded into one, so the list stays short */
  FL.fold = function (rows, max) {
    const data = rows.filter((r) => r.kind === 'data');
    if (rows.length <= (max || 9) || data.length < 3) return rows;
    const keep = rows.filter((r) => r.kind !== 'data');
    keep.push({ block: data[0].block, blocks: data.map((r) => r.block), kind: 'data', title: 'data', detail: `${data.length} data blocks (${FL.runs(data.map((r) => r.block))}) filled` });
    return keep;
  };

  /** the journal's part of a commit, in a few rows: [{blocks, kind, title, detail}] */
  FL.journalRows = function (cap) {
    const c = cap.commit, ws = c.writes.slice(0, c.applied), out = [];
    if (cap.mode === 'none' || !ws.length) return out;
    const txb = ws.find((w) => w.kind === 'TxB'), logs = ws.filter((w) => w.kind === 'log'), txe = ws.find((w) => w.kind === 'TxE'), ck = ws.filter((w) => w.phase === 'checkpoint'), jsb = ws.find((w) => w.kind === 'jsb'), pre = ws.filter((w) => w.phase === 'data');
    if (pre.length && cap.mode === 'ordered') out.push({ blocks: pre.map((w) => w.block), kind: 'data', title: 'ordered', detail: `data written home first: ${FL.plural(pre.length, 'block')} (${FL.runs(pre.map((w) => w.block))})` });
    if (txb) out.push({ blocks: [txb.block], kind: 'TxB', title: 'begin ' + txb.seq, detail: `transaction ${txb.seq} begins; it lists the homes ${logs.map((w) => w.home).join(', ')}` });
    if (logs.length) out.push({ blocks: logs.map((w) => w.block), kind: 'log', title: 'logged', detail: `${FL.plural(logs.length, 'copy', 'copies')} of the new blocks, in journal block${logs.length === 1 ? '' : 's'} ${FL.runs(logs.map((w) => w.block))}` });
    if (txe) out.push({ blocks: [txe.block], kind: 'TxE', title: 'commit ' + txe.seq, detail: `committed: from here a crash replays transaction ${txe.seq}` });
    if (pre.length && cap.mode === 'writeback') out.push({ blocks: pre.map((w) => w.block), kind: 'data', title: 'writeback', detail: `data written home after the commit: ${FL.runs(pre.map((w) => w.block))}` });
    if (ck.length) out.push({ blocks: ck.map((w) => w.block), kind: 'checkpoint', title: 'checkpoint', detail: `the logged blocks written home: ${FL.runs(ck.map((w) => w.block))}` });
    else if (txe && cap.checkpoint === 'lazy') out.push({ blocks: [], kind: 'checkpoint', title: 'no checkpoint yet', detail: 'the home blocks wait in memory (dashed) until the log fills or sync' });
    if (jsb) out.push({ blocks: [jsb.block], kind: 'jsb', title: 'journal super', detail: `transaction ${jsb.seq} marked done: its log space is free` });
    return out;
  };
})(globalThis.Proses = globalThis.Proses || {});
