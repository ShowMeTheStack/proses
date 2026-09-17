// Part 15, the disk image: the layout mkfs lays down, region by region, with every size worked out from the
// student's geometry by the engine (S.FS.geometry and S.FS.mkfs): the superblock's fields, the inode bitmap, the data
// bitmap that must cover the data region (whose size depends on it), the inode table, the journal and the data
// blocks, where the root directory's first block already holds '.' and '..'.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const BS = [64, 128, 256, 512, 1024].map((v) => ({ value: String(v), label: v + ' bytes' }));

  function geo(inp) { return { bs: +inp.bs, nblocks: inp.nblocks, ninodes: inp.ninodes, ndirect: inp.ndirect, ps: +inp.ps, jblocks: inp.jblocks }; }

  S.topic({
    id: 'fsi-layout', family: 'p15-layout', order: 10, title: 'The on-disk layout',
    blurb: 'mkfs turns a row of empty blocks into a file system. Block 0 is the superblock, which records the geometry; then an inode bitmap, a data bitmap, the inode table, perhaps a journal, and the data blocks. Every size follows from a few numbers you choose: the block size, the number of blocks and inodes, the pointers in an inode.',
    inputs: [
      { id: 'bs', kind: 'choice', label: 'block size', def: '128', options: BS },
      { id: 'nblocks', kind: 'number', label: 'blocks on the disk', def: 64, min: 24, max: 256 },
      { id: 'ninodes', kind: 'number', label: 'inodes', def: 32, min: 4, max: 512 },
      { id: 'ndirect', kind: 'number', label: 'direct pointers', def: 6, min: 1, max: 12 },
      { id: 'ps', kind: 'choice', label: 'pointer size', def: '4', options: [{ value: '2', label: '2 bytes' }, { value: '4', label: '4 bytes' }, { value: '8', label: '8 bytes' }] },
      { id: 'jblocks', kind: 'number', label: 'journal blocks', def: 0, min: 0, max: 16, check: (v) => (v && v < 4 ? 'a journal needs at least 4 blocks (or 0 for none)' : null) },
    ],
    check(inp) { try { S.FS.geometry(geo(inp)); return null; } catch (e) { return e.message; } },
    presets: [
      { label: 'A small disk', values: { bs: '128', nblocks: 64, ninodes: 32, ndirect: 6, ps: '4', jblocks: 0 } },
      { label: 'Tiny blocks: the bitmap grows', values: { bs: '64', nblocks: 256, ninodes: 64, ndirect: 4, ps: '2', jblocks: 0 } },
      { label: 'Many inodes: a big inode table', values: { bs: '512', nblocks: 128, ninodes: 256, ndirect: 12, ps: '4', jblocks: 0 } },
      { label: 'With a journal', values: { bs: '128', nblocks: 96, ninodes: 32, ndirect: 6, ps: '4', jblocks: 8 } },
      { label: 'Big blocks, few of them', values: { bs: '1024', nblocks: 32, ninodes: 64, ndirect: 12, ps: '8', jblocks: 4 } },
    ],
    counters: [{ id: 'meta', label: 'metadata blocks' }, { id: 'data', label: 'data blocks' }],
    run(inp) {
      const img = F().mkfs(geo(inp)), g = img.g, Fr = new S.Frames(['meta', 'data']);
      const sb = F().decodeSuper(F().block(img, 0)), root = F().readInode(img, F().ROOT), rootBlock = root.direct[0] || F().slot(g, root, 0);
      const cols = g.nblocks <= 64 ? 8 : 16, cw = cols === 8 ? 48 : 25, ch = cols === 8 ? 30 : g.nblocks > 128 ? 19 : 24, gap = cols === 8 ? 3 : 2;
      const perBlk = g.bs / g.isz, bits = g.bs * 8, inodeBytes = 16 + (g.ndirect + 3) * g.ps;
      const lay = F().layout(g), reg = (r) => lay.find((x) => x.region === r) || null;
      const meta = g.dataStart, maxSize = F().maxFileSize(g);
      const phases = ['disk', 'super', 'ibm', 'dbm', 'itable'].concat(g.jblocks ? ['journal'] : []).concat(['data', 'sum']);
      const REG = { super: ['super'], ibm: ['ibm'], dbm: ['dbm', 'fat'], itable: ['itable'], journal: ['journal'], data: ['data'] };
      const NAMES = { super: 'superblock', ibm: 'inode bitmap', dbm: 'data bitmap', fat: 'FAT', itable: 'inode table', journal: 'journal', data: 'data' };
      const shown = new Set();
      phases.forEach((ph, k) => {
        (REG[ph] || []).forEach((r) => shown.add(r));
        if (ph === 'sum') lay.forEach((x) => shown.add(x.region));
        const items = [];
        items.push(H.head('ly:t', 0, 14, `the disk: ${g.nblocks} blocks of ${g.bs} bytes`));
        const m = H.map({
          prefix: 'ly:m', x: 0, y: 26, cols, cw, ch, gap, img, legend: k > 0, legendW: cols * (cw + gap),
          look: (b) => { const r = F().region(g, b); if (ph === 'disk' || !shown.has(r)) return 'blank'; return REG[ph] && REG[ph].includes(r) ? 'act' : ''; },
          text: (b) => String(b), size: cols === 8 ? 13 : 12,
        });
        items.push(...m.items);
        const X = m.w + 30, W = cols === 16 ? 340 : 380, py = 26;
        let say = '', title = ph;
        const sub = [];
        const bitGrid = (prefix, y, list) => {
          const per = 8, bw = cols === 16 ? 40 : 44, bh = 30;
          list.forEach((c, i) => sub.push(H.cell(prefix + i, X + (i % per) * (bw + 2), y + Math.floor(i / per) * (bh + 18), bw, bh, c.text, 'byte mono ' + (c.cls || ''), 14, { sub: c.sub })));
          return y + Math.ceil(list.length / per) * (bh + 18);
        };
        if (ph === 'disk') {
          sub.push(H.head('ly:pt', X, py + 4, 'before mkfs'));
          sub.push(...H.para('ly:p', X, py + 18, `${g.nblocks} blocks of ${g.bs} bytes, ${H.grp(g.nblocks * g.bs)} bytes in all, and nothing on them: no names, no files, not even a record of where things go. mkfs fixes what every block is for, once, from the geometry.`, W, 14).items);
          say = `A new disk of ${g.nblocks} blocks, ${g.bs} bytes each, ${H.grp(g.nblocks * g.bs)} bytes in all. mkfs decides what every block is for, starting with block 0.`;
        } else if (ph === 'super') {
          const rows = [['magic', '0x' + sb.magic.toString(16)], ['block size', sb.bs], ['blocks', sb.nblocks], ['inodes', sb.ninodes], ['inode size', sb.isz], ['inode table at', sb.itStart], ['data from', sb.dataStart]];
          sub.push(...S.Kit.disk.slots({ prefix: 'ly:sb', x: X, y: py, w: 300, title: 'block 0: the superblock', rows: rows.map(([l, v], i) => ({ id: 'r' + i, label: l, value: String(v) })), labelW: 130, rh: 30, size: 14 }).items);
          say = `Block 0 is the superblock. It records the geometry so the system can find everything else: blocks of ${sb.bs} bytes, ${sb.nblocks} blocks, ${sb.ninodes} inodes of ${sb.isz} bytes, the inode table at block ${sb.itStart}, data from block ${sb.dataStart}, and a magic number (0x${sb.magic.toString(16)}) to show it is ours.`;
        } else if (ph === 'ibm') {
          const r = reg('ibm'), row = [], n = Math.min(g.ninodes, 32);
          for (let i = 0; i < n; i++) { const l = F().ibmLoc(g, i); row.push({ text: String(F().getBit(F().block(img, l.block), l.bit)), sub: String(i), cls: i === 0 ? 'res' : i === 1 ? 'one' : '' }); }
          sub.push(H.head('ly:bt', X, py + 4, `the inode bitmap, ${n < g.ninodes ? 'its first ' + n + ' bits' : 'all ' + n + ' bits'}`));
          bitGrid('ly:bb', py + 20, row);
          say = `The inode bitmap has one bit per inode: ${g.ninodes} bits, and a block holds ${H.grp(bits)}, so it takes ${H.plural(r.count, 'block')} (block ${H.range(r.start, r.start + r.count - 1)}). Bit 0 is reserved and bit 1 is the root directory; every other inode is free.`;
        } else if (ph === 'dbm') {
          const r = reg(g.fat ? 'fat' : 'dbm'), row = [], n = Math.min(g.ndata, 24);
          for (let j = 0; j < n; j++) { const b = g.dataStart + j, l = F().dbmLoc(g, b); const v = F().getBit(F().block(img, l.block), l.bit); row.push({ text: String(v), sub: String(b), cls: v ? 'one' : '' }); }
          sub.push(H.head('ly:dt', X, py + 4, `the data bitmap: one bit per data block`));
          const y2 = bitGrid('ly:db', py + 20, row);
          sub.push(H.text('ly:dc', X, y2 + 18, `⌈${g.ndata} ÷ ${H.grp(bits)}⌉ = ${r.count} block${r.count === 1 ? '' : 's'}`, 'calc', 14));
          say = `The data bitmap has one bit per data block. It must cover the data region, whose size depends on how much room the bitmap takes, so mkfs settles it: ${H.plural(r.count, 'block')} of ${H.grp(bits)} bits cover the ${g.ndata} data blocks (block ${H.range(r.start, r.start + r.count - 1)}). Only block ${rootBlock}, the root directory's, is marked used.`;
        } else if (ph === 'itable') {
          const r = reg('itable'), n = Math.min(perBlk, 8);
          sub.push(H.head('ly:it', X, py + 4, `block ${r.start}: the first ${n === perBlk ? '' : n + ' of '}${perBlk} inodes it holds`));
          for (let i = 0; i < n; i++) sub.push(H.cell('ly:ic' + i, X, py + 20 + i * 34, 260, 30, `inode ${i}: ${i === 0 ? 'reserved' : i === 1 ? 'the root, a directory' : 'free'}`, 'byte ' + (i === 0 ? 'res' : i === 1 ? 'one' : ''), 13));
          const y2 = py + 20 + n * 34;
          sub.push(H.text('ly:ia', X, y2 + 20, `16 + (${g.ndirect} + 3) × ${g.ps} = ${inodeBytes} → ${g.isz} bytes`, 'calc', 14));
          sub.push(H.text('ly:ib', X, y2 + 44, `⌈${g.ninodes} × ${g.isz} ÷ ${g.bs}⌉ = ${r.count} block${r.count === 1 ? '' : 's'}`, 'calc', 14));
          say = `An inode needs ${inodeBytes} bytes (16 for type, links, mode, owner and size, then ${g.ndirect} direct and 3 indirect pointers of ${g.ps} bytes), rounded up to ${g.isz}. ${perBlk} fit in a block, so ${g.ninodes} inodes fill ${H.plural(r.count, 'block')}: block ${H.range(r.start, r.start + r.count - 1)}.`;
        } else if (ph === 'journal') {
          const r = reg('journal');
          sub.push(H.head('ly:jt', X, py + 4, `blocks ${H.range(r.start, r.start + r.count - 1)}: the journal`));
          sub.push(...H.para('ly:p', X, py + 18, `A journal superblock, then a log of ${r.count - 1} blocks. Changes are written here first; after a crash, replaying the log finishes or drops an update instead of searching the whole disk.`, W, 14).items);
          say = `The journal takes ${r.count} blocks (block ${H.range(r.start, r.start + r.count - 1)}): a journal superblock and a log of ${r.count - 1} blocks, where changes are written before they go home.`;
        } else if (ph === 'data') {
          const u = F().block(img, rootBlock), ents = [F().decodeDirent(u, 0), F().decodeDirent(u, F().DIRENT)];
          sub.push(...S.Kit.disk.slots({ prefix: 'ly:de', x: X, y: py, w: 260, title: `block ${rootBlock}: the root directory`, rows: ents.map((e, i) => ({ id: 'e' + i, label: e.name, value: 'inode ' + e.ino })), labelW: 80, rh: 32, size: 14 }).items);
          sub.push(...H.para('ly:dp', X, py + 120, `The data region runs from block ${g.dataStart} to ${g.nblocks - 1}: ${g.ndata} blocks for file contents, directories and indirect blocks.`, W, 14).items);
          say = `The rest, block ${g.dataStart} to ${g.nblocks - 1}, is the data region: ${g.ndata} blocks for file contents, directories and indirect blocks. mkfs has used one, block ${rootBlock}, for the root directory: its entries '.' and '..' both name inode ${F().ROOT}.`;
        } else {
          const pct = (100 * meta) / g.nblocks;
          const rows = lay.map((x, i) => ({ id: 'r' + i, label: NAMES[x.region], value: `${H.plural(x.count, 'block')}  (${H.range(x.start, x.start + x.count - 1)})` }));
          sub.push(...S.Kit.disk.slots({ prefix: 'ly:su', x: X, y: py, w: W, title: 'the layout', rows, labelW: 130, rh: 30, size: 14 }).items);
          const y2 = py + 26 + rows.length * 30;
          sub.push(H.text('ly:s1', X, y2 + 22, `metadata: ${meta} of ${g.nblocks} blocks (${pct.toFixed(1)}%)`, 'strong', 14));
          sub.push(H.text('ly:s2', X, y2 + 46, `largest file: ${H.bytes(maxSize)}`, 'strong', 14));
          say = `Of ${g.nblocks} blocks, ${meta} hold metadata (${pct.toFixed(1)}%) and ${g.ndata} hold data. With ${g.ndirect} direct pointers, ${g.levels} levels of indirection and ${g.P} pointers per block, the largest file is ${H.bytes(maxSize)}.`;
          title = 'summary';
        }
        items.push(...sub);
        Fr.set('meta', ph === 'disk' ? 0 : lay.filter((x) => x.region !== 'data' && shown.has(x.region) || (x.region === 'fat' && shown.has('dbm'))).reduce((a, x) => a + x.count, 0)).set('data', shown.has('data') ? g.ndata : 0);
        Fr.add({ items, say, title, meta: Object.assign({ phase: ph, g: pick(g), regions: lay.map((x) => [x.start, x.count, x.start + x.count - 1]), bits, perBlk, inodeBytes, rootBlock, nbytes: g.nblocks * g.bs, maxSize, maxShown: H.bytesNum(maxSize), metaBlocks: meta, hdr: 16, jlog: g.jblocks - 1 }, ph === 'sum' ? { pct: (100 * meta) / g.nblocks } : {}) });
      });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Sizes', text: [`inode bitmap = ⌈inodes ÷ (8·bs)⌉ blocks`, `data bitmap = ⌈data blocks ÷ (8·bs)⌉`, `inode size = 16 + (direct + 3)·ps, to a power of 2`, `inode table = ⌈inodes · inode size ÷ bs⌉`, `data = the rest`].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'super', pick: 'option', ask: 'How many blocks will the inode table take?', options: (fr) => { const m = fr[0].meta, it = m.regions[3][1]; return H.choices(it, [it + 1, Math.max(1, it - 1), it * 2, Math.ceil(it / 2)]); }, answer: (fr) => String(fr[0].meta.regions[3][1]), explain: (fr) => fr.find((f) => f.meta.phase === 'itable').say },
      { at: (f) => f.meta.phase === 'data', pick: 'option', ask: 'What share of the disk is metadata (everything before the data region)?', options: (fr) => { const p = fr[fr.length - 1].meta.pct; return H.choices(p.toFixed(1) + '%', [(p / 2).toFixed(1) + '%', (p * 2).toFixed(1) + '%', (p + 10).toFixed(1) + '%']); }, answer: (fr) => fr[fr.length - 1].meta.pct.toFixed(1) + '%', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why does the superblock come first, at a fixed place?', options: ['the system must find it without knowing the geometry', 'it is the largest block', 'it holds the root directory', 'it is written most often'], answer: 0, why: 'Everything else is located from the numbers it holds.' },
      { q: 'A disk has 4096-byte blocks. How many inodes can one inode-bitmap block track?', options: ['32,768', '4,096', '512', '128'], answer: 0, why: '4096 bytes × 8 bits = 32,768 bits, one per inode.' },
      { q: 'Inodes of 128 bytes in 4096-byte blocks: 1000 inodes need…', options: ['32 blocks', '8 blocks', '125 blocks', '1000 blocks'], answer: 0, why: '4096 ÷ 128 = 32 inodes per block; ⌈1000 ÷ 32⌉ = 32 blocks.' },
      { q: 'Why is the size of the data bitmap settled by trying?', options: ['the data region is what is left after the bitmap, so each depends on the other', 'bitmaps are compressed', 'mkfs is random', 'the journal moves it'], answer: 0, why: 'A bigger bitmap leaves fewer data blocks to cover; mkfs grows it until it covers what is left.' },
      { q: 'Choosing more inodes at mkfs time…', options: ['takes data blocks away for a bigger inode table', 'makes files larger', 'costs nothing', 'speeds up every read'], answer: 0, why: 'The inode table is fixed in size: more inodes, fewer data blocks.' },
    ],
  });
  function pick(g) { return { bs: g.bs, nblocks: g.nblocks, ninodes: g.ninodes, isz: g.isz, ndirect: g.ndirect, ps: g.ps, ndata: g.ndata, dataStart: g.dataStart, P: g.P, levels: g.levels, jblocks: g.jblocks }; }
})(globalThis.Proses = globalThis.Proses || {});
