// Part 15, flash-aware file systems: flash cannot overwrite a page in place, erases only whole erase blocks, and wears
// out after a few thousand erases. The same small file is rewritten many times on two real images: an update-in-place
// file system with a journal (S.FS) and a log-structured one (S.FS.lfs). Every block write is counted per address
// and drawn as a heat map: in place, the file's inode, its data block and the journal take every write; the log
// spreads them over the whole device, which is what flash wants.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const COLS = 16;

  /** the in-place run: writes per block, from the commit plans actually applied */
  function inPlace(n, mode, files) {
    const img = F().mkfs({ bs: 128, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, jblocks: mode === 'none' ? 0 : 8 }), count = new Array(64).fill(0);
    const opts = { mode, checkpoint: 'eager' };
    for (let f = 0; f < files; f++) { F().apply(img, 'create', ['/c' + f], opts); F().apply(img, 'write', ['/c' + f, 0, 'count 0'], opts); }
    for (let i = 0; i < n; i++) { const r = F().apply(img, 'write', ['/c' + (i % files), 0, 'count ' + (i + 1)], opts); r.commit.writes.slice(0, r.commit.applied).forEach((w) => { count[w.block]++; }); }
    return count;
  }
  /** the log-structured run: writes per block, from the bytes that changed at each sync */
  function logged(n, files) {
    const L = F().lfs, fs = L.mkfs({ bs: 128, segBlocks: 8, nsegs: 7, ninodes: 16 }), g = fs.g, count = new Array(g.nblocks).fill(0);
    for (let f = 0; f < files; f++) { L.create(fs, 'c' + f); L.write(fs, 'c' + f, 0, 'count 0'); }
    L.sync(fs);
    for (let i = 0; i < n; i++) {
      const before = fs.img.bytes.slice();
      L.write(fs, 'c' + (i % files), 0, 'count ' + (i + 1)); L.sync(fs);
      // a block counts when it is programmed with new contents; a segment zeroed by the cleaner is an erase, not a write
      for (let b = 0; b < g.nblocks; b++) { const a = b * g.bs, u = fs.img.bytes.subarray(a, a + g.bs); if (!u.some((x) => x)) continue; for (let k = 0; k < g.bs; k++) if (before[a + k] !== u[k]) { count[b]++; break; } }
    }
    return count;
  }
  const rows = (c) => { const out = []; for (let i = 0; i < 64; i += COLS) out.push(Array.from({ length: COLS }, (_, j) => (i + j < c.length ? c[i + j] : 0))); return out; };
  const summary = (c) => { const used = c.filter((x) => x > 0), max = Math.max(0, ...c), total = c.reduce((a, b) => a + b, 0); return { max, total, touched: used.length, mean: used.length ? total / used.length : 0, hot: c.indexOf(max), rest: Math.max(0, ...c.slice(2)) }; };

  S.topic({
    id: 'fsi-flash', family: 'p15-lfs', order: 30, title: 'Flash: why the log fits',
    blurb: 'Flash memory cannot overwrite a page in place: a page is written once, and must be erased with its whole erase block (dozens of pages) before it is written again, and each block survives only a few thousand erases. A file system that updates in place hammers the same few blocks: the inode, the bitmap, the journal. A log-structured layout writes every update somewhere new and spreads the wear; flash devices and flash file systems are built that way.',
    inputs: [
      { id: 'n', kind: 'number', label: 'small updates', def: 40, min: 8, max: 80 },
      { id: 'files', kind: 'number', label: 'files updated in turn', def: 1, min: 1, max: 4 },
      { id: 'mode', kind: 'choice', label: 'in-place journal', def: 'ordered', options: [{ value: 'none', label: 'none' }, { value: 'ordered', label: 'ordered' }, { value: 'data', label: 'data' }] },
      { id: 'life', kind: 'number', label: 'erases a block survives', def: 3000, min: 100, max: 100000 },
    ],
    presets: [
      { label: 'One counter file, ordered journal', values: { n: 40, files: 1, mode: 'ordered', life: 3000 } },
      { label: 'No journal: fewer writes, same hot spots', values: { n: 40, files: 1, mode: 'none', life: 3000 } },
      { label: 'Data journaling doubles them', values: { n: 40, files: 1, mode: 'data', life: 3000 } },
      { label: 'Four files in turn', values: { n: 60, files: 4, mode: 'ordered', life: 3000 } },
    ],
    counters: [{ id: 'a', label: 'hottest block, in place' }, { id: 'b', label: 'hottest block, log' }],
    run(inp) {
      const Fr = new S.Frames(['a', 'b']), steps = [0, Math.round(inp.n / 3), Math.round((2 * inp.n) / 3), inp.n];
      const runs = steps.map((k) => ({ k, a: inPlace(k, inp.mode, inp.files), b: logged(k, inp.files) }));
      const max = Math.max(1, ...runs.flatMap((r) => r.a.concat(r.b)));
      const draw = (r, note) => {
        const items = [];
        const zero = (v) => (i, j) => (v[i][j] ? '' : 'zero'), ra = rows(r.a), rb = rows(r.b), lab = ['0', '16', '32', '48'];
        const ga = S.Kit.heat.grid({ prefix: 'fl:a', x: 30, y: 34, cw: 40, ch: 32, gap: 3, vals: ra, scheme: 'bad', max, fmt: (v) => (v ? String(v) : ''), size: 13, cls: zero(ra), rows: lab });
        items.push(H.head('fl:at', 0, 18, `update in place (${inp.mode === 'none' ? 'no journal' : inp.mode + ' journal'}): writes per block`), ...ga.items);
        const y2 = 34 + ga.h + 44;
        const gb = S.Kit.heat.grid({ prefix: 'fl:b', x: 30, y: y2, cw: 40, ch: 32, gap: 3, vals: rb, scheme: 'bad', max, fmt: (v) => (v ? String(v) : ''), size: 13, cls: zero(rb), rows: lab });
        items.push(H.head('fl:bt', 0, y2 - 16, 'log-structured: writes per block'), ...gb.items);
        items.push(...S.Kit.heat.bar({ prefix: 'fl:bar', x: 0, y: y2 + gb.h + 16, w: 300, h: 12, scheme: 'bad', max, min: 0, label: 'writes', fmt: (v) => String(Math.round(v)) }));
        if (note) items.push(...H.para('fl:n', 360, y2 + gb.h + 14, note, 320, 13, 'strong').items);
        return items;
      };
      runs.forEach((r, i) => {
        const A = summary(r.a), B = summary(r.b);
        Fr.set('a', A.max).set('b', B.max);
        const say = i === 0
          ? `Two small file systems, one updating in place with ${inp.mode === 'none' ? 'no journal' : H.a(inp.mode + ' journal')}, one log-structured, each with ${H.plural(inp.files, 'small file')}. Each update rewrites a few bytes of a file. Every block write is counted at its address; on flash, every rewrite of an address means an erase of its erase block.`
          : `After ${H.plural(r.k, 'update')}: in place, ${A.total} writes fall on ${H.plural(A.touched, 'block')}, the hottest (block ${A.hot}) written ${A.max} times. The log spreads ${B.total} writes over ${H.plural(B.touched, 'block')}${B.hot <= 1 ? `; its hottest are the two checkpoint regions (${B.max} writes), and no other block took more than ${B.rest}` : `, none more than ${B.max} times`}.`;
        Fr.add({ items: draw(r, i === runs.length - 1 ? null : null), title: i ? `${r.k} updates` : 'two disks', say, meta: { phase: i ? 'run' : 'start', k: r.k, A, B } });
      });
      const A = summary(runs[3].a), B = summary(runs[3].b), la = Math.floor((inp.life * inp.n) / Math.max(1, A.max)), lb = Math.floor((inp.life * inp.n) / Math.max(1, B.max));
      Fr.add({ items: draw(runs[3], `If a block survives ${H.grp(inp.life)} erases, the in-place layout wears out its hottest block after about ${H.grp(la)} updates, the log after about ${H.grp(lb)}.`), title: 'wear', say: `The hottest in-place block took ${A.max} of the ${inp.n} updates' writes; the log's hottest${B.hot <= 1 ? `, a checkpoint region, took ${B.max}, and its log blocks at most ${B.rest}` : ` took ${B.max}`}. With ${H.grp(inp.life)} erases per block, the in-place layout wears out a block after about ${H.grp(la)} updates and the log after about ${H.grp(lb)}, ${(lb / Math.max(1, la)).toFixed(1)} times as many. A flash translation layer does the same trick inside an SSD, remapping each write to a fresh page; a flash file system does it in the open, and can tell the device which pages hold dead data. Real ones also rotate their checkpoints over many places.`, meta: { phase: 'wear', A, B, la, lb, ratio: lb / Math.max(1, la), life: inp.life, n: inp.n } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Flash', text: ['a page is written once, then erased', 'erase works on a whole erase block', 'each block survives a limited number of erases', 'in place: the same addresses again and again', 'a log: every write to a new place (wear spread)', 'wear life ≈ erases × updates ÷ hottest count'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which layout will put the most writes on a single block?', options: ['update in place', 'log-structured', 'the same'], answer: (fr) => { const m = fr[fr.length - 1].meta; return m.A.max > m.B.max ? 'update in place' : m.A.max < m.B.max ? 'log-structured' : 'the same'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why can flash not simply overwrite a block in place?', options: ['a written page must be erased first, and erasing works on a whole erase block', 'it is read-only', 'its blocks are too small', 'it has no addresses'], answer: 0, why: 'Rewriting one page in place would mean erasing and rewriting all its neighbours.' },
      { q: 'What does wear leveling do?', options: ['spreads writes so no block reaches its erase limit far ahead of the rest', 'makes reads faster', 'compresses data', 'encrypts blocks'], answer: 0, why: 'The device lives as long as its most-worn block.' },
      { q: 'Why does a log-structured layout suit flash?', options: ['every update goes to a new place, so writes are sequential and spread out, and old copies are erased later in bulk', 'it never writes', 'it uses smaller blocks', 'it avoids checksums'], answer: 0, why: 'The cleaner\'s job and the erase-block\'s rules line up.' },
      { q: 'In an update-in-place file system, which blocks take the most writes?', options: ['metadata such as the inode, bitmaps and the journal', 'free blocks', 'the superblock never', 'data never'], answer: 0, why: 'Every change touches them.' },
    ],
  });
  S.P15.flashRuns = { inPlace, logged };
})(globalThis.Proses = globalThis.Proses || {});
