// Part 15, finding file block k under each allocation method: S.FS.walk on a real image, step by step, with every
// block it reads lit on the map in order. Contiguous allocation adds; a linked file is followed hop by hop, each hop a
// disk read; FAT hops through a table that sits in a block or two; extents are skipped run by run; an indexed inode
// names the block outright. The last frame compares all five, and sequential against direct access to the whole
// file (S.FS.accessCost: the blocks read and the head's travel).
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const METHODS = [{ value: 'contiguous', label: 'contiguous' }, { value: 'linked', label: 'linked' }, { value: 'fat', label: 'FAT' }, { value: 'extent', label: 'extents' }, { value: 'indexed', label: 'indexed' }];
  const MNAME = { contiguous: 'contiguous', linked: 'linked', fat: 'FAT', extent: 'extents', indexed: 'indexed' };
  const GEO = { bs: 128, nblocks: 40, ninodes: 8, ndirect: 4, ps: 2 };

  /** a file of `size` blocks, grown in turns with another file when scattered, under one method */
  function build(method, size, scatter) {
    const img = F().mkfs(Object.assign({}, GEO, { alloc: method, ndirect: method === 'extent' ? 8 : GEO.ndirect })), g = img.g, pay = F().payload(g), chunk = method === 'extent' ? 4 : 2;
    F().apply(img, 'create', ['/chart']); F().apply(img, 'create', ['/notes']);
    const fill = (name, n) => { let s = ''; while (s.length < n * pay) s += name + ' ' + s.length + '. '; return s.slice(0, n * pay); };
    let left = size;
    while (left > 0) { const k = scatter ? Math.min(left, chunk) : left; F().apply(img, 'append', ['/chart', fill('chart', k)]); left -= k; if (scatter && left > 0) F().apply(img, 'append', ['/notes', fill('notes', 1)]); }
    const ino = F().lookup(img, '/chart').ino, n = F().readInode(img, ino);
    const data = F().ownedBlocks(img, n).filter((x) => x.kind === 'data').sort((a, b) => a.fb - b.fb).map((x) => x.block);
    return { img, g, ino, pay, data, other: F().lookup(img, '/notes').ino };
  }
  const cost = (method, size, scatter, k) => {
    const B = build(method, size, scatter), w = F().walk(B.img, B.ino, k * B.pay + 3);
    const seq = F().accessCost(B.img, '/chart', 'sequential', { recsize: B.pay }), dir = F().accessCost(B.img, '/chart', 'direct', { recsize: B.pay, seed: 7 });
    return { method, reads: w.reads.length, seqReads: seq.reads, seqDist: seq.distance, dirReads: dir.reads, dirDist: dir.distance };
  };

  S.topic({
    id: 'fsi-reach', family: 'p15-alloc', order: 20, title: 'Finding block k: the cost of each method',
    blurb: 'To read file block k the system must find its disk block. Contiguous allocation adds k to the start. A linked file must be followed from its first block, one disk read per hop; FAT follows the same chain in a table instead. Extents are skipped run by run; an indexed inode names the block directly. Step through the walk, then compare sequential and direct access to the whole file.',
    inputs: [
      { id: 'method', kind: 'choice', label: 'allocation method', def: 'linked', options: METHODS },
      { id: 'size', kind: 'number', label: 'file size in blocks', def: 10, min: 2, max: 20 },
      { id: 'k', kind: 'number', label: 'find file block k', def: 7, min: 0, max: 19 },
      { id: 'scatter', kind: 'choice', label: 'layout', def: 'scattered', options: [{ value: 'scattered', label: 'scattered (grown in turns with another file)' }, { value: 'together', label: 'written in one go' }] },
    ],
    check(inp) { return inp.k >= inp.size ? 'k must be a block of the file: below ' + inp.size : null; },
    presets: [
      { label: 'Linked: hop by hop', values: { method: 'linked', size: 10, k: 7, scatter: 'scattered' } },
      { label: 'FAT: the same chain, in a table', values: { method: 'fat', size: 10, k: 7, scatter: 'scattered' } },
      { label: 'Contiguous: one addition', values: { method: 'contiguous', size: 10, k: 7, scatter: 'scattered' } },
      { label: 'Extents: skip whole runs', values: { method: 'extent', size: 12, k: 9, scatter: 'scattered' } },
      { label: 'Indexed: through the single-indirect block', values: { method: 'indexed', size: 12, k: 9, scatter: 'scattered' } },
    ],
    counters: [{ id: 'reads', label: 'blocks read' }],
    run(inp) {
      const B = build(inp.method, inp.size, inp.scatter === 'scattered'), g = B.g, Fr = new S.Frames(['reads']);
      const N = inp.k * B.pay + 3, w = F().walk(B.img, B.ino, N), it = F().inodeAt(g, B.ino).block;
      const owner = new Map(); B.data.forEach((b) => owner.set(b, B.ino));
      const own2 = F().ownedBlocks(B.img, F().readInode(B.img, B.other)); own2.forEach((x) => owner.set(x.block, B.other));
      F().ownedBlocks(B.img, F().readInode(B.img, B.ino)).filter((x) => x.kind !== 'data').forEach((x) => owner.set(x.block, B.ino));
      // the blocks each step reads, in order (the walk's own read list, spread over its steps)
      const order = w.reads.slice(), readAt = [];
      let ri = 0;
      const take = (n) => { const out = order.slice(ri, ri + n); ri += out.length; return out; };
      w.steps.forEach((s) => {
        if (s.kind === 'inode' || s.kind === 'index') readAt.push(take(1));
        else if (s.kind === 'hop') readAt.push(g.fat ? (ri < order.length && F().region(g, order[ri]) === 'fat' ? take(1) : []) : take(1));
        else if (s.kind === 'hops') readAt.push(g.fat ? [] : take(s.count));
        else if (s.kind === 'data') readAt.push(s.block && order[ri] === s.block ? take(1) : []);
        else readAt.push([]);
      });
      const seen = [];
      const frame = (k, s, items, say, meta) => Fr.add({ items, say, title: s ? s.kind : 'the file', meta });
      const draw = (cur, done, table) => {
        const items = [];
        items.push(H.head('rc:t', 0, 14, `${MNAME[g.alloc]}: /chart is inode ${B.ino}, ${H.plural(B.data.length, 'block')}`));
        const m = S.Kit.disk.map({ prefix: 'rc:m', x: 0, y: 26, g, cols: 8, cw: 48, ch: 28, gap: 3, size: 12, used: (b) => owner.has(b) || !F().isData(g, b), look: (b) => [!F().isData(g, b) && b !== it ? 'meta' : '', owner.has(b) ? H.fileCls(owner.get(b)) : '', done.has(b) ? 'seen' : '', cur.includes(b) ? 'act' : ''].join(' ').trim(), text: (b) => (B.data.indexOf(b) >= 0 ? b + ':' + B.data.indexOf(b) : String(b)) });
        items.push(...m.items);
        const lg = S.Kit.disk.legend({ prefix: 'rc:lg', x: 0, y: 26 + m.h + 10, entries: [{ cls: 'dk ' + H.fileCls(B.ino), text: '/chart (block:file block)' }, { cls: 'dk ' + H.fileCls(B.other), text: '/notes' }, { cls: 'dk meta', text: 'metadata' }, { cls: 'dk act', text: 'read now' }], maxW: m.w, size: 13 });
        items.push(...lg.items);
        const X = m.w + 30;
        if (table) {
          const cols = [['method', 90], ['find k', 60], ['seq. reads', 80], ['travel', 60], ['direct reads', 92], ['travel', 60]];
          let cx = X;
          items.push(H.head('rc:ct', X, 14, `all five: block ${inp.k} of a ${inp.size}-block file`));
          cols.forEach(([h, cw], j) => { items.push(H.cell('rc:h' + j, cx, 26, cw, 26, h, 'head', 12)); cx += cw; });
          table.forEach((c, i) => { let x = X; [MNAME[c.method], c.reads, c.seqReads, c.seqDist, c.dirReads, c.dirDist].forEach((v, j) => { items.push(H.cell('rc:c' + i + '.' + j, x, 52 + i * 27, cols[j][1], 27, String(v), 'slot-v ' + (c.method === g.alloc ? 'act' : ''), 13)); x += cols[j][1]; }); });
          items.push(...H.para('rc:cp', X, 52 + table.length * 27 + 12, 'find k: blocks read to reach file block k. seq.: reading the whole file in order; direct: reading every block once in a shuffled order. travel: total distance the head moves, in blocks.', 440, 13).items);
          return items;
        }
        items.push(H.head('rc:wt', X, 14, `the walk to file block ${inp.k}`));
        seen.forEach((t, i) => items.push(H.cell('rc:s' + i, X, 26 + i * 28, 340, 25, t.text, 'cmd ' + (t.now ? 'act' : 'done'), 13, { align: 'left' })));
        return items;
      };
      const done = new Set();
      let reads = 0;
      frame(0, null, draw([], done, null), `/chart has ${H.plural(B.data.length, 'block')}: ${B.data.join(', ')}. Its inode is in inode-table block ${it}. We want file block ${inp.k} (byte ${N}), which is disk block ${B.data[inp.k]}. Each disk block read is lit in turn.`, { phase: 'start', data: B.data, it, k: inp.k, N, target: B.data[inp.k], ino: B.ino });
      w.steps.forEach((s, i) => {
        const cur = readAt[i] || [];
        reads += cur.length;
        Fr.set('reads', reads);
        seen.forEach((t) => { t.now = false; });
        seen.push({ text: brief(s, B, N), now: true });
        if (seen.length > 9) seen.shift();
        const items = draw(cur, done, null);
        cur.forEach((b) => done.add(b));
        frame(i + 1, s, items, s.say + (cur.length ? ` (${cur.length === 1 ? 'one disk read: block ' + cur[0] : cur.length + ' disk reads'}; ${reads} so far)` : ''), { phase: s.kind, step: Object.assign({}, s, { say: undefined }), cur, reads, data: B.data, k: inp.k, N, pay: B.pay, ps: g.ps, len: cur.length, ndirect: g.ndirect, P: g.P, ends: [g.ndirect, g.ndirect + g.P], ranges: extRanges(B, inp.k) });
      });
      const table = METHODS.map((m) => cost(m.value, inp.size, inp.scatter === 'scattered', inp.k));
      const me = table.find((c) => c.method === inp.method), most = table.reduce((a, b) => (b.reads > a.reads ? b : a));
      Fr.add({ items: draw([], done, table), title: 'all five', say: `Reaching block ${inp.k} took ${H.plural(me.reads, 'disk read')} with ${MNAME[inp.method]}; the most is ${MNAME[most.method]}'s ${most.reads}. Reading the whole file in order costs ${H.plural(me.seqReads, 'read')} and ${me.seqDist} blocks of head travel here; in a shuffled order, ${H.plural(me.dirReads, 'read')} and ${me.dirDist} blocks of travel.`, meta: { phase: 'compare', table } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Reads to reach file block k', text: ['contiguous: the inode, then the block', 'linked: the inode, then k + 1 blocks', 'FAT: the inode, the FAT (once), the block', 'extents: the inode, then the block', 'indexed: the inode, an indirect block per level, the block'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many disk blocks will the walk read, the inode included?', options: (fr) => H.choices(fr[fr.length - 2].meta.reads, [2, 3, 4, fr[0].meta.k + 2, fr[0].meta.k + 3]), answer: (fr) => String(fr[fr.length - 2].meta.reads), explain: (fr) => fr[fr.length - 2].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'compare', pick: 'option', ask: 'Which method needs the most reads to reach block k?', options: METHODS.map((m) => MNAME[m.value]), answer: (fr) => { const t = fr[fr.length - 1].meta.table, mx = Math.max(...t.map((c) => c.reads)); return t.filter((c) => c.reads === mx).map((c) => MNAME[c.method]); }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A linked file of 1000 blocks; how many reads to reach its last block?', options: ['about 1001 (the inode, then every block on the chain)', '2', '3', '11'], answer: 0, why: 'Each block holds the address of the next one, so all must be read in turn.' },
      { q: 'FAT keeps the same chain as linked allocation. What makes it cheaper?', options: ['the table is small enough to read once and keep in memory', 'its blocks are contiguous', 'it has no chain', 'it uses indirect blocks'], answer: 0, why: 'Hops through a cached table cost no disk reads.' },
      { q: 'Which access pattern suits contiguous allocation best?', options: ['both: sequential with no seeks, direct with one addition', 'only sequential', 'only direct', 'neither'], answer: 0, why: 'The block address is start + k, and the blocks are in order on disk.' },
      { q: 'Why does a scattered file cost more head travel even when the number of reads is the same?', options: ['its blocks are far apart, so the head moves between them', 'it has more blocks', 'the inode is bigger', 'the cache is off'], answer: 0, why: 'Reads count operations; travel counts distance, which is what seek time grows with.' },
    ],
  });
  /** for the extent walk: each extent's first and last file block, and how many file blocks remain after it */
  function extRanges(B, k) {
    if (B.g.alloc !== 'extent') return [];
    const out = []; let fb = 0;
    for (const e of F().extents(B.g, F().readInode(B.img, B.ino))) { out.push([fb, fb + e.len - 1, k - fb - e.len]); fb += e.len; }
    return out;
  }
  /** a step of the walk in a few words */
  function brief(s, B, N) {
    const g = B.g;
    switch (s.kind) {
      case 'split': return `byte ${N} → file block ${s.fb}, offset ${s.off}`;
      case 'level': return s.level ? `${s.part}-indirect pointer, entry ${s.rel}` : 'a direct pointer';
      case 'inode': return s.ptr !== undefined ? `inode ${s.ino} (block ${s.block}) → ${s.ptr || 'none'}` : `inode ${s.ino} (block ${s.block}): its extents`;
      case 'add': return s.block ? `start + k = block ${s.block}` : 'past the run';
      case 'hop': return g.fat ? `FAT[${s.from}] → ${s.to}` : `block ${s.from} → next ${s.to}`;
      case 'hops': return `… ${s.count} more hops …`;
      case 'chain': return `${s.hops} hops in all`;
      case 'extent': return s.block ? `extent (${s.start}, ${s.len}) → block ${s.block}` : `extent (${s.start}, ${s.len}): skip`;
      case 'index': return `block ${s.block}, entry ${s.idx} → ${s.ptr || 'none'}`;
      case 'data': return s.block ? `data block ${s.block}, offset ${s.off}` : 'a hole: zeros';
      default: return s.kind;
    }
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
})(globalThis.Proses = globalThis.Proses || {});
