// Part 15, file-system implementation: the families, and the helpers its topics share. Every topic draws a real
// disk image made by the file-system engines (src/core/fs-*.js): the block map with its regions, an inode's slots,
// panels of text, and the small sentences the narration is built from. Each frame carries `meta`, the values its
// narration quotes, so tests/claims-p15.mjs can check them against a second computation.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'fsimpl', order, title, blurb });
  fam('p15-layout', 10, 'The disk image', 'Where everything lives on the disk: the superblock, the two bitmaps, the inode table and the data blocks, and which of them each command changes.');
  fam('p15-alloc', 20, 'Allocating blocks to files', 'Contiguous runs, linked chains, the file allocation table, extents and indexed inodes: the same files laid out five ways, and what each costs to grow and to search.');
  fam('p15-inode', 30, 'Inodes and their pointers', 'Direct pointers, then single, double and triple indirect blocks: the walk to byte N and the largest file the numbers allow.');
  fam('p15-free', 40, 'Free-space management', 'A bitmap, a free list, grouping and counting: four ways to remember the free blocks.');
  fam('p15-lookup', 50, 'Lookup and the cost of operations', 'A path resolved inode by inode, and the disk reads and writes behind create, open, write, read, close and delete.');
  fam('p15-cache', 60, 'Caching and buffering', 'The buffer cache in front of the disk: hits and misses, write-back against write-through, the sync interval, and one unified cache against two.');
  fam('p15-ffs', 70, 'Locality: cylinder groups', 'Keeping a file\'s inode and blocks close together, as the fast file system does, and measuring the head travel saved.');
  fam('p15-crash', 80, 'Crash consistency', 'A power cut between two writes: the order of updates, fsck, journaling in three modes with checkpoint and replay, and copy-on-write trees with checksums.');
  fam('p15-lfs', 90, 'Log-structured and flash-aware file systems', 'Every write appended to a log of segments: the inode map, the checkpoint, roll-forward, the cleaner, and why flash likes it.');

  const H = (S.P15 = {});
  const R = Math.round;
  H.R = R;
  H.plural = (n, w, pl) => n + ' ' + (n === 1 ? w : pl || w + 's');
  H.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  H.range = (a, b) => (a === b ? String(a) : a + '–' + b);
  /** a run of numbers written as ranges: 3–5, 9, 12–13 */
  H.runs = function (list) {
    const s = [...new Set(list)].sort((a, b) => a - b), out = [];
    for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(H.range(s[i], s[j])); i = j + 1; }
    return out.join(', ');
  };
  /** free text */
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: R(x), y: R(y), text: String(text), cls: cls || '' }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  /** a small heading */
  H.head = (key, x, y, text) => H.text(key, x, y, text, 'strong', 14);
  /** a panel behind a group of items */
  H.panel = (key, x, y, w, h, cls) => ({ key, kind: 'region', x: R(x), y: R(y), w: R(w), h: R(h), rx: 8, text: '', cls: 'panel ' + (cls || '') });
  /** wrapped lines of text */
  H.para = (prefix, x, y, text, maxW, size, cls) => S.Kit.disk.para({ prefix, x, y, text, maxW, size: size || 13, cls });
  /** a box with lines in it */
  H.cell = (key, x, y, w, h, lines, cls, size, more) => Object.assign({ key, kind: 'cell', x: R(x), y: R(y), w: R(w), h: R(h), rx: 5, size: size || 13, cls: 'dk ' + (cls || '') }, Array.isArray(lines) ? { lines } : { text: String(lines) }, more || {});
  /** a word with its article: 'an 8-block', 'a 16-block', 'an inode' */
  H.a = (w) => ((/^(8|11|18)(\D|$)/.test(String(w)) || /^8/.test(String(w)) || /^[aeiou]/i.test(String(w))) ? 'an ' : 'a ') + w;
  /** a size in bytes, in binary units with three significant digits */
  H.bytes = (n) => { const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? +n.toPrecision(3) : n) + ' ' + u[i]; };
  /** the number H.bytes writes, for a frame's meta */
  H.bytesNum = (n) => +H.bytes(n).split(' ')[0];
  /** digits in groups of three */
  H.grp = (n) => String(R(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /** the inode that owns every block, from fsck's walk of the image (as mounted) */
  H.owners = (img) => S.FS.fsck(img).owners;
  /** the colour class of a file, by its inode number (p0..p5 cycle) */
  H.fileCls = (ino) => 'p' + ((ino - 1) % 6);

  /**
   * the block map and its legend: {items, w, h, at(b)}; o: {prefix, x, y, cols, cw, ch, img, owners, look(b),
   * text(b), byFile (colour data blocks by owner), legend: false, legendW, extra legend entries}
   */
  H.map = function (o) {
    const g = o.img.g, KD = S.Kit.disk, own = o.owners || H.owners(o.img), items = [];
    const m = KD.map({ prefix: o.prefix, x: o.x, y: o.y, g, cols: o.cols, cw: o.cw, ch: o.ch, gap: o.gap, size: o.size || 12, used: (b) => own.has(b) || !S.FS.isData(g, b) || (o.used && o.used(b)), look: (b) => [o.byFile && own.has(b) ? H.fileCls(own.get(b)) : '', o.look ? o.look(b) || '' : ''].join(' ').trim(), text: o.text });
    items.push(...m.items);
    let h = m.h;
    if (o.legend !== false) {
      const entries = (o.entries || KD.layoutLegend(g)).concat(o.extra || []);
      const lg = KD.legend({ prefix: o.prefix + 'L', x: o.x, y: o.y + m.h + 12, entries, maxW: o.legendW || m.w, size: 13 });
      items.push(...lg.items);
      h += 12 + lg.h;
    }
    return { items, w: m.w, h, at: m.at };
  };

  /** a numbered strip of writes (the order blocks reach the disk), with a cut where the power failed */
  H.writes = (o) => S.Kit.disk.writes(o);

  /**
   * place the edge labels of a tree (S.Kit.tree.draw) clear of their own edge: at the middle of the edge, pushed out
   * along its normal (upwards, or outwards for steep edges) just far enough that the label's box does not touch it
   */
  H.treeLabels = function (items, root, o) {
    const pos = new Map(), bh = (o.boxH || 44) / 2, P = o.prefix;
    (function walk(n) { pos.set(P + ':n' + n.id, n); (n.kids || []).forEach(walk); })(root);
    for (const it of items) {
      if (it.kind !== 'edge' || !it.label) continue;
      const a = pos.get(it.from), b = pos.get(it.to);
      if (!a || !b) continue;
      const x1 = a.x, y1 = a.y + bh, x2 = b.x, y2 = b.y - bh, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      // a steep edge: the label goes beside it, on its outer side; a shallow one, above it
      if (Math.abs(dx) < 1.6 * Math.abs(dy)) { nx = dx < -1e-6 ? -1 : 1; ny = 0; }
      const hw = S.geom.textWidth(it.label, it.size || 13, { mono: true, bold: true }) / 2 + 3, hh = 9, d = hw * Math.abs(nx) + hh * Math.abs(ny) + 3;
      it.lx = Math.round((x1 + x2) / 2 + nx * d); it.ly = Math.round((y1 + y2) / 2 + ny * d);
    }
    return items;
  };
  /** the answer options of a prediction: the right one and some others, sorted, as strings */
  H.choices = function (answer, others, n) {
    const set = new Set([String(answer)]);
    for (const x of others) { if (set.size >= (n || 4)) break; if (x !== null && x !== undefined && x !== '' && !(typeof x === 'number' && (!Number.isFinite(x) || x < 0))) set.add(String(x)); }
    const arr = [...set];
    return arr.every((x) => /^-?\d+$/.test(x)) ? arr.sort((a, b) => a - b) : arr;
  };
})(globalThis.Proses = globalThis.Proses || {});
