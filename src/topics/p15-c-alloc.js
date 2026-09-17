// Part 15, allocation methods: one workload of file creations, growths and deletions run under the method chosen
// (contiguous, linked, FAT, extents or indexed), on a real image (S.FS.amap does the allocating). The map colours
// every block by the file that owns it; beside it each file's inode says how it finds its blocks: a run, a chain
// through the blocks, a chain through the table, extents, or pointers. The last frame runs the same workload under
// all five and compares them.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const METHODS = [{ value: 'contiguous', label: 'contiguous' }, { value: 'linked', label: 'linked' }, { value: 'fat', label: 'FAT' }, { value: 'extent', label: 'extents' }, { value: 'indexed', label: 'indexed' }];
  const MNAME = { contiguous: 'contiguous', linked: 'linked', fat: 'FAT', extent: 'extents', indexed: 'indexed' };
  const WORK = {
    interleave: { label: 'two files growing in turns', ops: [['create', 'a'], ['create', 'b'], ['grow', 'a', 2], ['grow', 'b', 2], ['grow', 'a', 2], ['grow', 'b', 1], ['grow', 'a', 2]] },
    holes: { label: 'fill, delete, refill', ops: [['create', 'a'], ['grow', 'a', 5], ['create', 'b'], ['grow', 'b', 5], ['create', 'c'], ['grow', 'c', 5], ['create', 'd'], ['grow', 'd', 5], ['create', 'e'], ['grow', 'e', 9], ['delete', 'b'], ['delete', 'd'], ['create', 'f'], ['grow', 'f', 8], ['compact'], ['grow', 'f', 5]] },
    big: { label: 'one file grows large', ops: [['create', 'log'], ['grow', 'log', 3], ['create', 'tmp'], ['grow', 'tmp', 1], ['grow', 'log', 3], ['grow', 'log', 4]] },
  };
  const GEO = { bs: 256, nblocks: 40, ninodes: 8, ndirect: 6, ps: 2 };
  const textFor = (name, n, pay) => { let s = ''; while (s.length < n * pay) s += name + ' line ' + (s.length / pay | 0) + '. '; return s.slice(0, n * pay); };

  /** run a workload under one method: every step's result, with the image after it */
  function play(method, work) {
    const img = F().mkfs(Object.assign({ alloc: method }, GEO)), g = img.g, pay = F().payload(g), out = [];
    for (const [op, name, k] of WORK[work].ops) {
      const r = { op, name, k, ok: true, alloc: [], moves: [] };
      if (op === 'compact' && method !== 'contiguous') continue;
      r.runsBefore = F().freeRuns(new (F().Tx)(img)).map((x) => [x.start, x.len]);
      const was = out.length ? out[out.length - 1].files.find((f) => f.name === name) : null;
      r.had = was ? was.data.length : 0;
      try {
        let res;
        if (op === 'create') res = F().apply(img, 'create', ['/' + name]);
        else if (op === 'grow') res = F().apply(img, 'append', ['/' + name, textFor(name, k, pay)]);
        else if (op === 'delete') res = F().apply(img, 'unlink', ['/' + name]);
        else res = F().apply(img, 'compact', []);
        r.alloc = res.trace.filter((s) => s.kind === 'alloc-block').map((s) => ({ block: s.block, use: s.use }));
        r.moves = res.trace.filter((s) => s.kind === 'move' || s.kind === 'compact-move').map((s) => ({ from: s.from, to: s.to, count: s.count, ino: s.ino }));
        r.trace = res.trace.map((s) => Object.assign({}, s, { say: undefined }));
        r.compact = res.trace.filter((s) => s.kind === 'compact').map((s) => ({ moved: s.moved, runs: s.runs.length }))[0] || null;
        if (op === 'delete') r.freed = (res.trace.find((s) => s.kind === 'unlink') || {}).freed || [];
      } catch (e) { r.ok = false; r.code = e.code || ''; r.err = e.message; r.free = e.free; r.need = e.need; }
      r.files = files(img);
      r.freeRuns = F().freeRuns(new (F().Tx)(img)).map((x) => [x.start, x.len]);
      out.push(r);
    }
    return { img, g, steps: out };
  }
  /** every file now: its inode, its data blocks in file order, the extra blocks, and how its inode records them */
  function files(img) {
    const g = img.g, out = [];
    for (const e of F().list(img, '/')) {
      if (e.name === '..') continue;
      const n = F().readInode(img, e.ino), own = F().ownedBlocks(img, n), data = own.filter((x) => x.kind === 'data').sort((a, b) => a.fb - b.fb).map((x) => x.block);
      const f = { name: e.name === '.' ? '/' : e.name, ino: e.ino, size: n.size, data, extra: own.filter((x) => x.kind !== 'data').map((x) => x.block), slots: [] };
      for (let i = 0; i < g.ndirect + 3; i++) f.slots.push(F().slot(g, n, i));
      if (g.alloc === 'extent') f.extents = F().extents(g, n).map((x) => [x.start, x.len]);
      f.runs = runsOf(data);
      out.push(f);
    }
    return out;
  }
  const runsOf = (list) => { let n = 0; list.forEach((b, i) => { if (!i || b !== list[i - 1] + 1) n++; }); return n; };
  /** how a file's inode finds its blocks, in a line */
  function how(g, f) {
    if (!f.data.length) return 'no blocks yet';
    if (g.alloc === 'contiguous') return `start ${f.slots[0]}, count ${f.slots[1]}`;
    if (g.alloc === 'linked' || g.alloc === 'fat') return `first ${f.slots[0]}, last ${f.slots[1]}: ` + f.data.join(' → ');
    if (g.alloc === 'extent') return f.extents.map((x) => `(${x[0]}, ${x[1]})`).join(' ');
    const d = f.slots.slice(0, g.ndirect).map((p) => p || '—').join(' ');
    return `direct ${d}` + (f.slots[g.ndirect] ? `; single ${f.slots[g.ndirect]}` : '');
  }

  S.topic({
    id: 'fsi-alloc', family: 'p15-alloc', order: 10, title: 'Five ways to allocate blocks',
    blurb: 'A file\'s blocks can sit in one contiguous run, form a chain with each block naming the next, form a chain kept in a separate table (FAT), be a few runs called extents, or be listed one by one in an index (the inode\'s pointers). Run the same files under each and see the fragmentation, the moves, the extra blocks and the failures.',
    inputs: [
      { id: 'method', kind: 'choice', label: 'allocation method', def: 'contiguous', options: METHODS },
      { id: 'work', kind: 'choice', label: 'workload', def: 'interleave', options: Object.entries(WORK).map(([value, w]) => ({ value, label: w.label })) },
    ],
    presets: [
      { label: 'Contiguous: files in turns must move', values: { method: 'contiguous', work: 'interleave' } },
      { label: 'Contiguous: free space in holes', values: { method: 'contiguous', work: 'holes' } },
      { label: 'Linked: chains through the blocks', values: { method: 'linked', work: 'interleave' } },
      { label: 'FAT: the chain in a table', values: { method: 'fat', work: 'holes' } },
      { label: 'Extents', values: { method: 'extent', work: 'holes' } },
      { label: 'Indexed: a big file needs an indirect block', values: { method: 'indexed', work: 'big' } },
    ],
    counters: [{ id: 'free', label: 'free blocks' }, { id: 'runs', label: 'free runs' }, { id: 'moved', label: 'blocks moved' }],
    run(inp) {
      const P = play(inp.method, inp.work), g = P.g, Fr = new S.Frames(['free', 'runs', 'moved']);
      let moved = 0;
      const steps = [{ op: 'start', ok: true, files: [], alloc: [], moves: [], freeRuns: [[g.dataStart, g.ndata]] }].concat(P.steps);
      steps.forEach((st, k) => {
        moved += st.moves.reduce((a, m) => a + (m.count || 0), 0);
        const owner = new Map(); for (const f of st.files) { for (const b of f.data) owner.set(b, f.ino); for (const b of f.extra) owner.set(b, f.ino); }
        const nfree = st.freeRuns.reduce((a, r) => a + r[1], 0);
        Fr.set('free', nfree).set('runs', st.freeRuns.length).set('moved', moved);
        const items = draw(g, st, owner, k === steps.length - 1 ? null : null);
        let say;
        if (st.op === 'start') say = `${MNAME[g.alloc]} allocation on ${g.nblocks} blocks of ${g.bs} bytes: the data region is block ${g.dataStart} to ${g.nblocks - 1}, ${g.ndata} blocks, all free in one run.`;
        else say = narrate(g, st, moved);
        Fr.add({ items, title: st.op === 'start' ? 'empty' : st.op + (st.name ? ' ' + st.name : ''), say, meta: { phase: st.op, ok: st.ok, files: st.files.map((f) => ({ name: f.name, ino: f.ino, data: f.data, extra: f.extra, slots: f.slots, size: f.size, runs: f.runs, extents: f.extents })), alloc: st.alloc.map((a) => a.block), moves: st.moves, freeRuns: st.freeRuns, nfree, moved, err: st.ok ? null : { free: st.free, need: st.need }, compact: st.compact, freed: st.freed || [], k: st.k, now: (st.files.find((f) => f.name === st.name) || { data: [] }).data.length, had: st.had, pay: F().payload(g), ends: st.moves.flatMap((m) => [m.from + m.count - 1, m.to + m.count - 1, m.from + m.count]), runsBefore: st.runsBefore, longest: Math.max(0, ...(st.runsBefore || []).map((r) => r[1])), freeBefore: (st.runsBefore || []).reduce((a, r) => a + r[1], 0), nblocks: g.nblocks, bs: g.bs, dataStart: g.dataStart, ndata: g.ndata, last: g.nblocks - 1 } });
      });
      // all five, side by side
      const cmp = METHODS.map((m) => { const R = m.value === inp.method ? P : play(m.value, inp.work), last = R.steps[R.steps.length - 1]; return { method: m.value, fails: R.steps.filter((s) => !s.ok).length, moved: R.steps.reduce((a, s) => a + s.moves.reduce((b, x) => b + (x.count || 0), 0), 0), extra: last.files.reduce((a, f) => a + f.extra.length, 0), runs: last.files.reduce((a, f) => a + f.runs, 0), freeRuns: last.freeRuns.length, nfiles: last.files.length }; });
      const items = draw(g, steps[steps.length - 1], null, cmp);
      const me = cmp.find((c) => c.method === inp.method), worst = cmp.reduce((a, b) => (b.runs > a.runs ? b : a));
      Fr.add({ items, title: 'all five', say: `The same workload under all five methods. ${MNAME[inp.method]}: ${H.plural(me.fails, 'failure')}, ${H.plural(me.moved, 'block')} moved, ${H.plural(me.extra, 'extra block')} for metadata, and the ${H.plural(me.nfiles, 'file')} lie in ${H.plural(me.runs, 'run')}. The most scattered layout is ${MNAME[worst.method]}'s, ${H.plural(worst.runs, 'run')}; only contiguous allocation ever has to move data or refuse a file for want of a long enough run.`, meta: { phase: 'compare', cmp, nmethods: METHODS.length } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'How each finds file block k', text: ['contiguous: start + k', 'linked: k hops through the blocks', 'FAT: k hops through the table', 'extents: skip whole runs, then start + rest', 'indexed: pointer k, or through indirect blocks'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'grow' && fr[i + 1].meta.alloc.length > 0 && fr[i + 1].meta.ok, pick: 'item', once: true, ask: 'Which block will the next growth take first? Click it.', answer: (fr, i) => 'ac:m:b' + fr[i + 1].meta.alloc[0], explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'compare', pick: 'option', ask: 'Under which method will the files end up in the fewest separate runs?', options: METHODS.map((m) => MNAME[m.value]), answer: (fr) => { const c = fr[fr.length - 1].meta.cmp, best = Math.min(...c.map((x) => x.runs)); return c.filter((x) => x.runs === best).map((x) => MNAME[x.method]); }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Contiguous allocation fails although enough blocks are free. Why?', options: ['no single run of free blocks is long enough (external fragmentation)', 'the inode is full', 'the bitmap is corrupt', 'files cannot grow'], answer: 0, why: 'The free blocks are scattered in holes; compaction can slide files together to make one run.' },
      { q: 'Reaching block 500 of a linked file takes…', options: ['about 500 disk reads, one per block on the chain', 'one read', 'two reads', 'a FAT lookup in memory'], answer: 0, why: 'Each block names the next, so the chain must be followed from the start.' },
      { q: 'Why is FAT faster than linked allocation for random access?', options: ['the chain is in a table that can be cached in memory', 'its blocks are bigger', 'it stores files contiguously', 'it has no chain'], answer: 0, why: 'Following the chain needs no data-block reads once the table is in memory.' },
      { q: 'An extent is…', options: ['a run of blocks recorded as (start, length)', 'one block pointer', 'an indirect block', 'a free list'], answer: 0, why: 'A few extents describe a large, mostly contiguous file in very little space.' },
      { q: 'Indexed allocation pays for random access with…', options: ['pointer space: indirect blocks for large files', 'moving files', 'reading every block before the one wanted', 'a single run'], answer: 0, why: 'Any block is found from the pointers; big files need extra blocks of pointers.' },
    ],
  });

  /** the picture: the map coloured by owner, each file's inode in a line, and (cmp) the comparison table */
  function draw(g, st, owner, cmp) {
    const items = [], img = { g };
    items.push(H.head('ac:t', 0, 14, `${MNAME[g.alloc]}: ${g.nblocks} blocks of ${g.bs} bytes`));
    const own = owner || new Map(st.files.flatMap((f) => f.data.concat(f.extra).map((b) => [b, f.ino])));
    const lit = new Set(st.alloc.map((a) => a.block).concat(st.moves.flatMap((m) => Array.from({ length: m.count || 0 }, (_, j) => m.to + j))));
    const next = new Map();
    if (g.alloc === 'linked' || g.alloc === 'fat') for (const f of st.files) f.data.forEach((b, j) => next.set(b, f.data[j + 1] || 0));
    const extra = new Set(st.files.flatMap((f) => f.extra));
    const m = S.Kit.disk.map({ prefix: 'ac:m', x: 0, y: 26, g, cols: 8, cw: 48, ch: 34, gap: 3, size: 13, used: (b) => own.has(b) || !F().isData(g, b), look: (b) => [!F().isData(g, b) ? 'meta' : '', own.has(b) ? H.fileCls(own.get(b)) : '', extra.has(b) ? 'ind' : '', lit.has(b) ? 'act' : ''].join(' ').trim(), text: (b) => (next.has(b) ? b + (next.get(b) ? '→' + next.get(b) : '■') : String(b)) });
    items.push(...m.items);
    const lg = S.Kit.disk.legend({ prefix: 'ac:lg', x: 0, y: 26 + m.h + 12, entries: [{ cls: 'dk meta', text: g.fat ? 'superblock, bitmap, FAT, inodes' : 'superblock, bitmaps, inodes' }, { cls: 'dk-free', text: 'free' }].concat(g.alloc === 'indexed' ? [{ cls: 'dk ind', text: 'indirect block' }] : []).concat(g.alloc === 'linked' || g.alloc === 'fat' ? [{ cls: 'dk-free', text: '■ ends a chain' }] : []), maxW: m.w, size: 13 });
    items.push(...lg.items);
    const X = m.w + 30;
    if (cmp) {
      const cols = [['method', 96], ['fails', 52], ['moved', 64], ['extra', 56], ['file runs', 76], ['free runs', 78]];
      let cx = X;
      items.push(H.head('ac:ct', X, 14, 'the same workload, five ways'));
      cols.forEach(([h, w], j) => { items.push(H.cell('ac:h' + j, cx, 26, w, 26, h, 'head', 13)); cx += w; });
      cmp.forEach((c, i) => {
        let x = X;
        const vals = [MNAME[c.method], c.fails, c.moved, c.extra, c.runs, c.freeRuns];
        vals.forEach((v, j) => { items.push(H.cell('ac:c' + i + '.' + j, x, 52 + i * 28, cols[j][1], 28, String(v), 'slot-v ' + (c.method === g.alloc ? 'act ' : '') + (j === 1 && c.fails ? 'bad' : ''), 13)); x += cols[j][1]; });
      });
      items.push(...H.para('ac:cp', X, 52 + cmp.length * 28 + 14, 'fails: steps refused; moved: blocks copied to make room; extra: blocks of pointers; file runs: separate stretches the files lie in; free runs: holes left.', 420, 13).items);
      return items;
    }
    items.push(H.head('ac:ft', X, 14, 'the files and their inodes'));
    st.files.forEach((f, i) => {
      const y = 28 + i * 48;
      items.push(H.cell('ac:fs' + f.name, X, y + 2, 14, 14, '', 'swatch ' + H.fileCls(f.ino), 12, { audit: 'ignore' }));
      items.push(H.text('ac:fn' + f.name, X + 22, y + 14, `${f.name}: inode ${f.ino}, ${f.size} bytes, ${H.plural(f.data.length, 'block')}${f.data.length ? ' in ' + H.plural(f.runs, 'run') : ''}`, 'strong', 13));
      items.push(H.cell('ac:fh' + f.name, X + 22, y + 20, 400, 24, clip(how(g, f), 48), 'slot-v mono', 13, { align: 'left' }));
    });
    if (!st.files.length) items.push(H.text('ac:none', X, 40, 'no files yet', 'tick', 13));
    return items;
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function narrate(g, st, moved) {
    const f = st.files.find((x) => x.name === st.name);
    if (!st.ok && st.code !== 'EFRAG' && /no free/.test(st.err)) return `${st.name} cannot grow by ${H.plural(st.k, 'block')}: no free data blocks are left. The file is left as it was.`;
    if (!st.ok && st.code === 'EFRAG') { const free = st.runsBefore.reduce((a, r) => a + r[1], 0), longest = Math.max(0, ...st.runsBefore.map((r) => r[1])); return `${st.name} needs ${st.had + st.k} blocks in one run: ${free} blocks are free, but the longest free run is ${longest}. This is external fragmentation: the step is refused and ${st.name} stays at ${H.plural(st.had, 'block')}.`; }
    if (!st.ok) return `${st.op} ${st.name}: ${st.err}.`;
    if (st.op === 'create') return `create ${st.name}: inode ${f.ino}, size 0, no blocks yet.`;
    if (st.op === 'delete') return `delete ${st.name}: its ${H.plural(st.freed.length, 'block')} (${H.runs(st.freed)}) are free again. Free space is now ${H.plural(st.freeRuns.length, 'run')}: ${st.freeRuns.map((r) => r[1]).join(', ')} blocks long.`;
    if (st.op === 'compact') return `Compaction slides every file down to the start of the data region (${H.plural(st.moves.length, 'file')} moved, ${H.plural(st.moves.reduce((a, m) => a + m.count, 0), 'block')} copied): the free space is now ${H.plural(st.freeRuns.length, 'run')} of ${st.freeRuns.map((r) => r[1]).join(', ')} blocks.`;
    const got = st.alloc.map((a) => a.block), mv = st.moves[0];
    let s = `${st.name} grows by ${H.plural(st.k, 'block')} to ${f.data.length}: `;
    if (g.alloc === 'contiguous') s += mv ? `block ${mv.from + mv.count} is taken, so its ${H.plural(mv.count, 'block')} move from ${H.range(mv.from, mv.from + mv.count - 1)} to ${H.range(mv.to, mv.to + mv.count - 1)}, the first run long enough. Its run is now start ${f.slots[0]}, count ${f.slots[1]}.` : st.had ? `the blocks after its run are free, so it extends in place: start ${f.slots[0]}, count ${f.slots[1]}.` : `it starts at the first free block, ${f.slots[0]}, and the blocks after it are free: start ${f.slots[0]}, count ${f.slots[1]}.`;
    else if (g.alloc === 'linked') s += `block${got.length === 1 ? ' ' + got[0] + ' joins' : 's ' + got.join(', ') + ' join'} the chain; each block's last ${g.ps} bytes name the next, so a block carries ${g.bs - g.ps} bytes of data. The chain is ${f.data.join(' → ')}.`;
    else if (g.alloc === 'fat') s += `block${got.length === 1 ? ' ' + got[0] + ' joins' : 's ' + got.join(', ') + ' join'} the chain, which lives in the FAT: FAT[b] names the block after b. The chain is ${f.data.join(' → ')}.`;
    else if (g.alloc === 'extent') s += `block${got.length === 1 ? '' : 's'} ${got.join(', ')}; the inode's extents are now ${f.extents.map((x) => '(' + x[0] + ', ' + x[1] + ')').join(', ')}.`;
    else {
      const ind = st.alloc.filter((a) => a.use === 'indirect').map((a) => a.block), newData = st.alloc.filter((a) => a.use !== 'indirect').map((a) => a.block);
      const viaInd = newData.filter((b) => f.data.indexOf(b) >= g.ndirect).length, direct = newData.length - viaInd;
      s += `block${got.length === 1 ? '' : 's'} ${got.join(', ')}` + (ind.length ? `, of which ${ind.join(', ')} ${ind.length === 1 ? 'is a single-indirect block' : 'are indirect blocks'}` : '') + '. ';
      s += viaInd ? `${direct ? H.plural(direct, 'block') + ' fill direct pointers and ' : ''}${viaInd} ${viaInd === 1 ? 'is' : 'are'} named from single-indirect block ${f.slots[g.ndirect]}, because the ${g.ndirect} direct pointers are used up.` : newData.length === 1 ? 'It is named by a direct pointer.' : 'All are named by direct pointers.';
    }
    return s;
  }
  S.P15.allocPlay = play;
})(globalThis.Proses = globalThis.Proses || {});
