// Part 15, log-structured file systems: what the topics of the family share. The disk of an S.FS.lfs file system read
// back block by block: the two checkpoint regions, then each segment's partial segments, every block named by its
// summary (data of inode i, block f; a copy of inode i; an inode-map piece) and marked live or dead by asking the
// file system where each thing lives now. Drawn as one row per segment.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const SUM = 0x4c465353, INM = 0x4c46494e, CRM = 0x4c464343;
  const L = (H.lfs = {});
  /** where inode ino lives now, and its block pointers */
  L.inodeNow = function (fs, ino) {
    const n = fs.inodes.get(ino);
    if (n) return { ptrs: n.ptrs.map((p) => (typeof p === 'object' ? p.addr || 0 : p)), type: n.type };
    const a = fs.imap[ino];
    if (!a) return null;
    const u = fs.img.bytes.subarray(a * fs.g.bs, (a + 1) * fs.g.bs), ptrs = [];
    if (F().get32(u, 0) !== INM) return null;
    for (let k = 0; k < F().get32(u, 16); k++) ptrs.push(F().get32(u, 20 + 4 * k));
    return { ptrs, type: F().get32(u, 8) };
  };
  /** every block of the disk: {b, seg, what: 'cp'|'sum'|'data'|'inode'|'imap'|'free', id, fb, live, seq} */
  L.blocks = function (fs) {
    const g = fs.g, out = [];
    for (const slot of [0, 1]) { const u = fs.img.bytes.subarray(slot * g.bs, (slot + 1) * g.bs); out.push({ b: slot, seg: -1, what: 'cp', live: F().get32(u, 0) === CRM, seq: F().get32(u, 4) }); }
    for (let s = 0; s < g.nsegs; s++) {
      const start = 2 + s * g.segBlocks, seen = new Set();
      let off = 0;
      while (off < g.segBlocks) {
        const b = start + off, u = fs.img.bytes.subarray(b * g.bs, (b + 1) * g.bs);
        if (F().get32(u, 0) !== SUM) break;
        const n = F().get32(u, 8), seq = F().get32(u, 4);
        out.push({ b, seg: s, what: 'sum', live: true, seq }); seen.add(b);
        for (let k = 0; k < n; k++) {
          const t = u[16 + 4 * k], id = F().get16(u, 17 + 4 * k), fb = u[19 + 4 * k], addr = b + 1 + k;
          let live = false;
          if (t === 1) { const nd = L.inodeNow(fs, id); live = !!nd && nd.type > 0 && nd.ptrs[fb] === addr; }
          else if (t === 2) live = fs.imap[id] === addr;
          else live = fs.pieces[id] === addr;
          out.push({ b: addr, seg: s, what: t === 1 ? 'data' : t === 2 ? 'inode' : 'imap', id, fb, live, seq }); seen.add(addr);
        }
        off += n + 1;
      }
      for (let k = 0; k < g.segBlocks; k++) if (!seen.has(start + k)) out.push({ b: start + k, seg: s, what: 'free', live: false });
    }
    return out.sort((a, c) => a.b - c.b);
  };
  const SHORT = { cp: 'CP', sum: 'sum', data: 'D', inode: 'I', imap: 'M', free: '' };
  /** the disk as rows of segments; the head segment marked; lit blocks in the accent */
  L.draw = function (fs, o) {
    const g = fs.g, items = [], cw = o.cw || 52, ch = o.ch || 34, list = L.blocks(fs), use = S.FS.lfs.usage(fs), x0 = o.x || 0, y0 = o.y || 0, lit = o.lit || new Set();
    items.push(H.head(o.prefix + ':t', x0, y0 + 4, o.title || `the log: ${g.nsegs} segments of ${g.segBlocks} blocks`));
    const cps = list.filter((x) => x.what === 'cp');
    cps.forEach((c, i) => items.push(o.compact ? H.cell(o.prefix + ':cp' + i, x0 + 80 + i * 2 * (cw + 4), y0 + 16, 2 * cw + 4, ch, `CP ${i}: ${c.live ? '#' + c.seq : '—'}`, 'dk lfs-cp' + (lit.has(c.b) ? ' act' : ''), 13) : H.cell(o.prefix + ':cp' + i, x0 + 80 + i * (cw + 4), y0 + 16, cw, ch, ['CP ' + i, c.live ? '#' + c.seq : '—'], 'dk lfs-cp' + (lit.has(c.b) ? ' act' : ''), 13)));
    items.push(H.text(o.prefix + ':cpl', x0, y0 + 16 + ch / 2 + 5, 'checkpoints', 'tick', 13));
    for (let s = 0; s < g.nsegs; s++) {
      const y = y0 + 16 + (s + 1) * (ch + 6), u = use[s];
      items.push(H.text(o.prefix + ':sl' + s, x0, y + ch / 2 + 5, `seg ${s}${u.state === 'head' ? ' ◀' : ''}`, u.state === 'head' ? 'act' : (o.picked && o.picked.has(s) ? 'hot' : 'tick'), 13));
      for (let k = 0; k < g.segBlocks; k++) {
        const b = 2 + s * g.segBlocks + k, e = list.find((x) => x.b === b);
        const text = o.compact ? (e.what === 'data' ? [String(e.id)] : e.what === 'inode' ? ['I' + e.id] : e.what === 'imap' ? ['M'] : e.what === 'sum' ? ['S'] : ['']) : e.what === 'data' ? ['D ' + e.id + '.' + e.fb] : e.what === 'inode' ? ['I ' + e.id] : e.what === 'imap' ? ['M ' + e.id] : e.what === 'sum' ? ['sum'] : [String(b)];
        items.push(H.cell(o.prefix + ':b' + b, x0 + 80 + k * (cw + 4), y, cw, ch, text, 'dk lfs-' + e.what + (e.what !== 'free' && e.what !== 'sum' && !e.live ? ' dead' : '') + (lit.has(b) ? ' act' : ''), 13));
      }
      if (o.usage !== false) items.push(H.text(o.prefix + ':su' + s, x0 + 80 + g.segBlocks * (cw + 4) + 8, y + ch / 2 + 5, u.state === 'free' ? 'clean' : `${u.live}/${g.segBlocks} live`, 'tick', 13));
    }
    return { items, h: 16 + (g.nsegs + 1) * (ch + 6), w: 80 + g.segBlocks * (cw + 4) + 90, list };
  };
  L.legend = (prefix, x, y, maxW, compact) => S.Kit.disk.legend({ prefix, x, y, maxW, size: 13, entries: [{ cls: 'dk lfs-data', text: compact ? 'data (its inode)' : 'D ino.block: data' }, { cls: 'dk lfs-inode', text: 'I: an inode' }, { cls: 'dk lfs-imap', text: 'M: inode-map piece' }, { cls: 'dk lfs-sum', text: 'segment summary' }, { cls: 'dk lfs-data dead', text: 'dead (a newer copy exists)' }, { cls: 'dk lfs-free', text: 'clean' }] }).items;
})(globalThis.Proses = globalThis.Proses || {});
