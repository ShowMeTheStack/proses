// Part 15, free-space management: the same free blocks (left by creating files and deleting some, on a real image)
// remembered four ways by S.FS.freeSpace: a bitmap with a bit per data block, a free list threaded through the free
// blocks, grouping (a free block holding the numbers of many others), and counting ((start, count) pairs, one per run).
// Each is drawn on the map with what it costs in space and in reads to find k free blocks.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const GEO = { bs: 128, ps: 4, nblocks: 64, ninodes: 24, ndirect: 4 };
  const PATTERNS = {
    holes: { label: 'holes of three', make: (img) => { for (let i = 0; i < 8; i++) grow(img, 'f' + i, 3); for (let i = 1; i < 8; i += 2) F().apply(img, 'unlink', ['/f' + i]); } },
    runs: { label: 'two long runs', make: (img) => { grow(img, 'a', 12); grow(img, 'b', 12); grow(img, 'c', 6); F().apply(img, 'unlink', ['/b']); } },
    scattered: { label: 'scattered single blocks', make: (img) => { for (let i = 0; i < 20; i++) grow(img, 's' + i, 1); grow(img, 'tail', 14); for (let i = 0; i < 20; i += 2) F().apply(img, 'unlink', ['/s' + i]); } },
    full: { label: 'nearly full', make: (img) => { for (let i = 0; i < 6; i++) grow(img, 'n' + i, 6); F().apply(img, 'unlink', ['/n2']); } },
  };
  function grow(img, name, n) { F().apply(img, 'create', ['/' + name]); F().apply(img, 'write', ['/' + name, 0, (name + ' ').repeat(Math.ceil((n * img.g.bs) / (name.length + 1))).slice(0, n * img.g.bs)]); }
  const NAMES = { bitmap: 'bitmap', list: 'free list', grouping: 'grouping', counting: 'counting' };

  S.topic({
    id: 'fsi-free', family: 'p15-free', order: 10, title: 'Remembering the free blocks',
    blurb: 'A file system must find free blocks quickly and must not lose any. A bitmap spends a bit on every data block. A free list threads a chain through the free blocks themselves and costs almost no space, but each block taken is a read. Grouping puts the numbers of many free blocks into one of them; counting records each run of free blocks as a (start, count) pair.',
    inputs: [
      { id: 'pattern', kind: 'choice', label: 'free space', def: 'holes', options: Object.entries(PATTERNS).map(([value, p]) => ({ value, label: p.label })) },
      { id: 'k', kind: 'number', label: 'blocks to find', def: 6, min: 1, max: 30 },
    ],
    presets: [
      { label: 'Holes of three, find 6', values: { pattern: 'holes', k: 6 } },
      { label: 'Two long runs: counting shines', values: { pattern: 'runs', k: 10 } },
      { label: 'Scattered single blocks', values: { pattern: 'scattered', k: 8 } },
      { label: 'Nearly full', values: { pattern: 'full', k: 3 } },
    ],
    counters: [{ id: 'free', label: 'free blocks' }, { id: 'bytes', label: 'bytes of structure' }],
    run(inp) {
      const img = F().mkfs(GEO), g = img.g;
      PATTERNS[inp.pattern].make(img);
      const own = H.owners(img), Fr = new S.Frames(['free', 'bytes']), k = inp.k;
      const methods = ['bitmap', 'list', 'grouping', 'counting'].map((m) => F().freeSpace(img, m));
      const free = methods[1].structure, nfree = free.length, kk = Math.min(k, nfree);
      Fr.set('free', nfree);
      const draw = (method, lit, text, panel) => {
        const items = [];
        items.push(H.head('fr:t', 0, 14, `${g.ndata} data blocks (from ${g.dataStart}), ${nfree} free`));
        const m = S.Kit.disk.map({ prefix: 'fr:m', x: 0, y: 26, g, cols: 8, cw: 50, ch: 30, gap: 3, size: 13, used: (b) => own.has(b) || !F().isData(g, b), look: (b) => [!F().isData(g, b) ? 'meta' : '', lit.has(b) ? lit.get(b) : ''].join(' ').trim(), text: text || ((b) => String(b)) });
        items.push(...m.items);
        const LEG = { start: [], bitmap: [['act', 'the bitmap block']], list: [['act', `the ${kk} taken`], ['seen', 'on the list']], grouping: [['act', 'group blocks'], ['seen', 'named by a group']], counting: [['act', 'first of a run'], ['seen', 'in a run']], sum: [] }[method];
        items.push(...S.Kit.disk.legend({ prefix: 'fr:lg', x: 0, y: 26 + m.h + 10, entries: [{ cls: 'dk meta', text: 'metadata' }, { cls: 'dk-data', text: 'in use' }, { cls: 'dk-free', text: 'free' }].concat(LEG.map(([c, t]) => ({ cls: 'dk-free ' + c, text: t }))), maxW: m.w, size: 13 }).items);
        items.push(...panel(m.w + 30));
        return items;
      };
      const stat = (x) => ({ method: x.method, overhead: x.overhead, reads: x.readsFor(kk), free: x.free });
      // 0: the free blocks
      Fr.add({ items: draw('start', new Map(free.map((b) => [b, 'freeb'])), null, (X) => H.para('fr:p', X, 26, `${nfree} of the ${g.ndata} data blocks are free, in ${H.plural(methods[3].structure.length, 'run')}. Next, ${H.plural(kk, 'free block')} must be found for a new file. Four ways to remember which blocks are free:`, 380, 14, 'strong').items.concat(['bitmap: a bit per block', 'free list: a chain through the free blocks', 'grouping: free blocks listing free blocks', 'counting: a (start, count) pair per run'].map((t, i) => H.text('fr:l' + i, X + 8, 26 + 96 + i * 24, '· ' + t, 'strong', 14)))), title: 'free space', say: `${nfree} of ${g.ndata} data blocks are free, in ${H.plural(methods[3].structure.length, 'run')}. We will need ${H.plural(kk, 'block')}; each method below remembers the same free blocks in its own way.`, meta: { phase: 'start', nfree, ndata: g.ndata, runs: methods[3].structure.length, kk } });
      methods.forEach((x) => {
        const st = stat(x);
        Fr.set('bytes', x.overhead);
        let lit = new Map(), text = null, panel, say;
        if (x.method === 'bitmap') {
          const bits = x.structure, row = bits.slice(0, 48);
          panel = (X) => {
            const out = [H.head('fr:bt', X, 14, `the data bitmap (block ${g.dbmStart}): bit j for block ${g.dataStart} + j`)];
            row.forEach((v, j) => out.push(H.cell('fr:b' + j, X + (j % 12) * 30, 26 + Math.floor(j / 12) * 30, 28, 26, String(v), 'byte mono ' + (v ? 'one' : ''), 14)));
            const y = 26 + Math.ceil(row.length / 12) * 30 + 12;
            out.push(H.text('fr:bs', X, y + 14, `${g.ndata} bits = ${x.overhead} bytes; find ${kk}: ${H.plural(st.reads, 'read')} of the bitmap`, 'calc', 14));
            return out;
          };
          lit = new Map([[g.dbmStart, 'act']]);
          say = `The bitmap spends one bit on each of the ${g.ndata} data blocks, ${x.overhead} bytes in all, whether a block is free or not. Finding ${kk} free blocks means scanning for 0 bits: ${H.plural(st.reads, 'read')} of the bitmap block, which is usually kept in memory. It also finds runs of free blocks easily.`;
        } else if (x.method === 'list') {
          free.forEach((b, i) => lit.set(b, i < kk ? 'act' : 'seen'));
          const next = new Map(free.map((b, i) => [b, free[i + 1] || 0]));
          text = (b) => (next.has(b) ? b + '→' + (next.get(b) || '■') : String(b));
          panel = (X) => [H.head('fr:lt', X, 14, 'a free list: each free block names the next'), ...H.para('fr:lp', X, 26, `The superblock holds the head, block ${free[0]} (${g.ps} bytes). Taking ${kk} blocks means reading ${kk} blocks in turn to learn each next one: ${free.slice(0, kk).join(' → ')}${kk < nfree ? ' → …' : ''}.`, 380, 14, 'strong').items];
          say = `A free list threads a chain through the ${nfree} free blocks themselves: the only extra space is the head pointer, ${x.overhead} bytes. But finding ${kk} blocks reads each of them in turn (${H.plural(st.reads, 'read')}), and the blocks come in whatever order the list holds, so runs are hard to find.`;
        } else if (x.method === 'grouping') {
          const groups = x.structure;
          groups.forEach((gr) => { lit.set(gr[0], 'act'); gr.slice(1).forEach((b) => lit.set(b, 'seen')); });
          panel = (X) => {
            const out = [H.head('fr:gt', X, 14, `grouping: ${H.plural(groups.length, 'group block')}, each naming up to ${g.P - 1} free blocks`)];
            groups.slice(0, 4).forEach((gr, i) => out.push(H.cell('fr:g' + i, X, 26 + i * 34, 380, 30, fit(`block ${gr[0]}: ${gr.slice(1).join(' ')}`, 380 - 20, 13), 'slot-v mono', 13, { align: 'left' })));
            return out;
          };
          say = `Grouping stores the numbers of up to ${g.P - 1} free blocks inside one free block, and the last number names the next such block: ${H.plural(groups.length, 'group block')} (${groups.map((gr) => gr[0]).join(', ')}) ${groups.length === 1 ? 'holds' : 'hold'} all ${nfree}. One read yields up to ${g.P - 1} free blocks, so ${kk} take ${H.plural(st.reads, 'read')}.`;
        } else {
          const runs = x.structure;
          runs.forEach((r) => { for (let j = 0; j < r.len; j++) lit.set(r.start + j, j ? 'seen' : 'act'); });
          panel = (X) => {
            const out = [H.head('fr:ct', X, 14, `counting: ${H.plural(runs.length, 'pair')} of (start, count)`)];
            runs.slice(0, 12).forEach((r, i) => out.push(H.cell('fr:c' + i, X + (i % 4) * 96, 26 + Math.floor(i / 4) * 34, 90, 30, `(${r.start}, ${r.len})`, 'slot-v mono', 14)));
            if (runs.length > 12) out.push(H.text('fr:cm', X, 26 + 3 * 34 + 18, `… and ${runs.length - 12} more`, 'tick', 13));
            return out;
          };
          say = `Counting keeps one (start, count) pair per run of free blocks: ${H.plural(runs.length, 'pair')}, ${x.overhead} bytes. Its size depends on how broken up the free space is, not on how much there is; with long runs it is tiny, and ${kk} contiguous blocks come from a single pair if one run is long enough.`;
        }
        Fr.add({ items: draw(x.method, lit, text, panel), title: NAMES[x.method], say, meta: { phase: x.method, overhead: x.overhead, reads: st.reads, kk, nfree, ndata: g.ndata, ps: g.ps, P1: g.P - 1, groups: x.method === 'grouping' ? x.structure.map((gr) => gr[0]) : [], runs: x.method === 'counting' ? x.structure.length : 0, head: free[0], dbm: g.dbmStart, dataStart: g.dataStart, chain: free.slice(0, kk) } });
      });
      const rows = methods.map(stat);
      Fr.add({ items: draw('sum', new Map(), null, (X) => {
        const cols = [['method', 110], ['bytes', 80], [`reads for ${kk}`, 110]], out = [H.head('fr:st', X, 14, 'the four side by side')];
        let cx = X; cols.forEach(([h, w], j) => { out.push(H.cell('fr:sh' + j, cx, 26, w, 26, h, 'head', 13)); cx += w; });
        rows.forEach((r, i) => { let x2 = X; [NAMES[r.method], r.overhead, r.reads].forEach((v, j) => { out.push(H.cell('fr:s' + i + '.' + j, x2, 52 + i * 28, cols[j][1], 28, String(v), 'slot-v', 13)); x2 += cols[j][1]; }); });
        return out;
      }), title: 'compared', say: `Side by side: the bitmap costs ${rows[0].overhead} bytes always; the free list ${rows[1].overhead} bytes but ${H.plural(rows[1].reads, 'read')} for ${kk} blocks; grouping ${H.plural(rows[2].reads, 'read')}; counting ${rows[3].overhead} bytes here, which grows with the number of runs, not of free blocks.`, meta: { phase: 'sum', rows, kk } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Space and reads', text: ['bitmap: data blocks ÷ 8 bytes; reads: the bitmap', 'free list: one pointer; reads: one per block taken', 'grouping: one pointer; reads: ⌈k ÷ (P − 1)⌉', 'counting: 2 numbers per run; reads: 1'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which representation takes the fewest bytes beyond the free blocks themselves?', options: ['bitmap', 'free list', 'counting'], answer: (fr) => { const r = fr[fr.length - 1].meta.rows, a = [['bitmap', r[0].overhead], ['free list', r[1].overhead], ['counting', r[3].overhead]], mn = Math.min(...a.map((x) => x[1])); return a.filter((x) => x[1] === mn).map((x) => x[0]); }, explain: (fr) => fr[fr.length - 1].say },
      { at: (f) => f.meta.phase === 'bitmap', pick: 'option', ask: 'How many disk reads will the free list need to hand out the blocks?', options: (fr, i) => H.choices(fr[i + 1].meta.reads, [1, 2, Math.ceil(fr[i + 1].meta.kk / 2), fr[i + 1].meta.kk + 1]), answer: (fr, i) => String(fr[i + 1].meta.reads), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A 1 TB disk of 4 KiB blocks: how big is its block bitmap?', options: ['about 32 MiB', 'about 4 KiB', 'about 1 GiB', 'about 256 bytes'], answer: 0, why: '2⁴⁰ ÷ 2¹² = 2²⁸ blocks; 2²⁸ bits = 2²⁵ bytes = 32 MiB.' },
      { q: 'Why is a free list poor at allocating a contiguous run?', options: ['it gives blocks in list order, with no view of which are neighbours', 'it is too big', 'it cannot be stored on disk', 'it loses blocks'], answer: 0, why: 'Nothing in the list says which free blocks sit side by side.' },
      { q: 'Counting is compact when…', options: ['free space comes in a few long runs', 'free space is scattered in single blocks', 'the disk is empty or full', 'blocks are small'], answer: 0, why: 'One pair per run: few runs, few pairs.' },
      { q: 'With 512-byte blocks and 4-byte numbers, one grouping block names how many free blocks besides the next group block?', options: ['127', '128', '512', '64'], answer: 0, why: '512 ÷ 4 = 128 numbers; one is kept for the next group block.' },
    ],
  });
  S.P15.freeImage = (pattern) => { const img = F().mkfs(GEO); PATTERNS[pattern].make(img); return img; };
  /** text cut to fit a width (the cell's mono, bold face), with an ellipsis */
  const fit = (s, w, size) => { const W = (x) => S.geom.textWidth(x, size, { mono: true, bold: true }); if (W(s) <= w) return s; while (s.length > 1 && W(s + ' …') > w) s = s.slice(0, -1); return s.replace(/\s+$/, '') + ' …'; };
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
})(globalThis.Proses = globalThis.Proses || {});
