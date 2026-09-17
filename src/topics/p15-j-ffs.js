// Part 15, locality with cylinder groups, as the fast file system does it: the same files created on a disk laid out
// as one group and as four (S.FS.mkfs with groups). With groups, a new directory goes to the group with the most free
// inodes, a file's inode joins its directory's group, its blocks go near its inode, and a large file moves on to
// another group every few blocks. Reading every file of one directory afterwards is measured on both layouts: the
// blocks read, and the head's travel (S.FS.seekDistance).
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const GEO = { bs: 128, nblocks: 96, ninodes: 32, ndirect: 4, ps: 4 };
  const DIRS = ['/a', '/b', '/c'];

  /** the workload on one layout: per step {op, path, trace}; then the read of every file of /b */
  function play(groups, nfiles, big) {
    const img = F().mkfs(Object.assign({ groups }, GEO)), g = img.g, steps = [];
    for (const d of DIRS) { const r = F().apply(img, 'mkdir', [d]); steps.push({ op: 'mkdir', path: d, trace: r.trace }); }
    const text = (n) => 'x'.repeat(n * g.bs);
    for (let i = 0; i < nfiles; i++) for (const d of DIRS) {
      const p = d + '/f' + i, r1 = F().apply(img, 'create', [p]), r2 = F().apply(img, 'write', [p, 0, text(2)]);
      steps.push({ op: 'file', path: p, trace: r1.trace.concat(r2.trace) });
    }
    if (big) { const r1 = F().apply(img, 'create', ['/a/big']), r2 = F().apply(img, 'write', ['/a/big', 0, text(big)]); steps.push({ op: 'big', path: '/a/big', trace: r1.trace.concat(r2.trace) }); }
    return { img, g, steps, scan: scan(img, '/b') };
  }
  /** read every file of a directory in order: its inode block, then its data blocks */
  function scan(img, dir) {
    const g = img.g, seq = [];
    const dino = F().lookup(img, dir).ino;
    seq.push(F().inodeAt(g, dino).block);
    for (const e of F().list(img, dir)) {
      if (e.name === '.' || e.name === '..') continue;
      const st = F().stat(img, dir + '/' + e.name);
      seq.push(F().inodeAt(g, st.ino).block, ...st.dataBlocks);
    }
    const d = F().seekDistance(seq);
    return { seq, distance: d.total };
  }
  /** a map of the disk as rows, one per cylinder group (or rows of 24 blocks for one group) */
  function rows(g, prefix, x, y, cls, act, label) {
    const items = [], cw = 31, ch = 26, per = 24;
    const lines = [];
    const push = (name, from, to) => { for (let b = from; b <= to; b += per) lines.push({ name: b === from ? name : '', from: b, to: Math.min(to, b + per - 1) }); };
    if (g.groups > 1) { push('sb', 0, g.grp[0].ibm - 1); g.grp.forEach((G) => push('group ' + G.i, G.ibm, G.data + G.ndata - 1)); }
    else push('', 0, g.nblocks - 1);
    if (label) items.push(H.head(prefix + ':t', x, y - 8, label));
    lines.forEach((L, i) => {
      const yy = y + i * (ch + 4);
      if (L.name) items.push(H.text(prefix + ':l' + i, x, yy + 18, L.name, 'tick', 13));
      for (let b = L.from; b <= L.to; b++) {
        const k = b - L.from, xx = x + 64 + k * cw;
        const r = F().region(g, b), own = cls(b), look = r === 'data' ? (own || 'dk-free') : r === 'itable' ? 'meta itab' : 'meta';
        items.push(H.cell(prefix + ':b' + b, xx, yy, cw - 3, ch, String(b), 'dk ' + look + (act.has(b) ? ' act' : ''), 13, { rx: 3 }));
      }
    });
    return { items, h: lines.length * (ch + 4) };
  }

  S.topic({
    id: 'fsi-ffs', family: 'p15-ffs', order: 10, title: 'Cylinder groups: keeping related blocks close',
    blurb: 'A disk is fastest when the head moves little. The fast file system splits the disk into cylinder groups, each with its own bitmaps, inodes and data blocks, and places things with intent: a new directory in the group with the most free inodes, a file\'s inode in its directory\'s group, its blocks near its inode, and a large file spread over groups a chunk at a time so no group fills up.',
    inputs: [
      { id: 'groups', kind: 'number', label: 'cylinder groups', def: 4, min: 2, max: 4 },
      { id: 'files', kind: 'number', label: 'files per directory', def: 3, min: 1, max: 4 },
      { id: 'big', kind: 'number', label: 'blocks of a large file in /a (0 none)', def: 0, min: 0, max: 14 },
    ],
    presets: [
      { label: 'Three directories, files made in turns', values: { groups: 4, files: 3, big: 0 } },
      { label: 'A large file spread over groups', values: { groups: 4, files: 1, big: 12 } },
      { label: 'Two groups', values: { groups: 2, files: 3, big: 0 } },
    ],
    counters: [{ id: 'dist', label: 'head travel (blocks)' }],
    run(inp) {
      const A = play(inp.groups, inp.files, inp.big), B = play(1, inp.files, inp.big), g = A.g, Fr = new S.Frames(['dist']);
      const owner = (img) => { const own = H.owners(img), dirOf = new Map(); for (const d of DIRS) { const di = F().lookup(img, d).ino; dirOf.set(di, d); for (const e of F().list(img, d)) if (e.name !== '.' && e.name !== '..') dirOf.set(e.ino, d); } return (b) => (own.has(b) && dirOf.has(own.get(b)) ? ['p0', 'p4', 'p5'][DIRS.indexOf(dirOf.get(own.get(b)))] : own.has(b) ? 'dk-data' : ''); };
      const legend = (y) => S.Kit.disk.legend({ prefix: 'ff:lg', x: 0, y, entries: [{ cls: 'dk p0', text: '/a' }, { cls: 'dk p4', text: '/b' }, { cls: 'dk p5', text: '/c' }, { cls: 'dk-data', text: 'the root' }, { cls: 'dk meta itab', text: 'inode table' }, { cls: 'dk meta', text: 'superblock, bitmaps' }, { cls: 'dk-free', text: 'free' }, { cls: 'dk-free act', text: 'read or written' }], size: 13 }).items;
      // the placement, step by step, on the grouped disk (rebuilt as it goes)
      const img = F().mkfs(Object.assign({ groups: inp.groups }, GEO));
      const shown = (act) => { const m = rows(g, 'ff:m', 0, 30, owner(img), act, `the disk in ${g.groups} cylinder groups of about ${g.grp[0].ndata + 2 + g.grp[0].itBlocks} blocks`); return m.items.concat(legend(30 + m.h + 12)); };
      Fr.add({ items: shown(new Set()), title: 'groups', say: `${g.nblocks} blocks in ${g.groups} cylinder groups. Each group has its own inode bitmap, data bitmap, ${g.grp[0].itBlocks} blocks of inode table (inodes ${g.grp[0].ino0}–${g.grp[0].ino0 + g.grp[0].nino - 1} in group 0, and so on) and ${g.grp[0].ndata} data blocks, so an inode and its file's data can sit close together.`, meta: { phase: 'start', groups: g.groups, nblocks: g.nblocks, it: g.grp[0].itBlocks, ipg: g.ipg, nd: g.grp[0].ndata, last: g.grp[0].nino - 1, size: g.grp[0].ndata + 2 + g.grp[0].itBlocks } });
      A.steps.forEach((st) => {
        const r = st.op === 'mkdir' ? F().apply(img, 'mkdir', [st.path]) : (F().apply(img, 'create', [st.path]), F().apply(img, 'write', [st.path, 0, 'x'.repeat((st.op === 'big' ? inp.big : 2) * g.bs)]));
        void r;
        const ai = st.trace.find((s) => s.kind === 'alloc-inode'), bl = st.trace.filter((s) => s.kind === 'alloc-block' && s.use === 'data').map((s) => s.block);
        const act = new Set(st.trace.filter((s) => s.kind === 'alloc-block').map((s) => s.block).concat(ai ? [F().inodeAt(g, ai.ino).block] : []));
        const grpOf = (b) => F().groupOfBlock(g, b);
        let say;
        if (st.op === 'mkdir') say = `mkdir ${st.path}: ${ai.say} Its directory block is ${st.trace.find((s) => s.kind === 'alloc-block').block}, in the same group.`;
        else if (st.op === 'file') say = `${st.path}: inode ${ai.ino} goes to group ${ai.group}, its directory's group, and its 2 data blocks (${bl.join(', ')}) to group ${grpOf(bl[0])}, right by it.`;
        else { const gs = [...new Set(bl.map(grpOf))]; say = `${st.path}, ${H.plural(inp.big, 'block')}: inode ${ai.ino} in group ${ai.group}, and the data a chunk of ${g.chunk} blocks at a time, moving on: group${gs.length === 1 ? '' : 's'} ${H.list(gs.map(String))}. One big file does not fill its directory's group.`; }
        Fr.add({ items: shown(act), title: st.path, say, meta: { phase: st.op, ino: ai ? ai.ino : 0, group: ai ? ai.group : 0, blocks: bl, groupsOf: bl.map(grpOf), chunk: g.chunk, big: inp.big, dirBlock: (st.trace.find((s) => s.kind === 'alloc-block') || {}).block } });
      });
      // reading every file of /b on both layouts
      const both = [];
      const ma = rows(A.g, 'ff:A', 0, 30, owner(A.img), new Set(A.scan.seq), `${A.g.groups} groups: reading /b travels ${A.scan.distance} blocks`);
      const mb = rows(B.g, 'ff:B', 0, 30 + ma.h + 40, owner(B.img), new Set(B.scan.seq), `one group: reading /b travels ${B.scan.distance} blocks`);
      both.push(...ma.items, ...mb.items, ...legend(30 + ma.h + 40 + mb.h + 12));
      Fr.set('dist', A.scan.distance);
      Fr.add({ items: both, title: 'reading /b', say: `Now read every file of /b: its inode, then its data, file by file. With ${A.g.groups} groups the ${A.scan.seq.length} blocks read lie together, and the head travels ${A.scan.distance} blocks. With one group the same files are interleaved with /a's and /c's, and the head travels ${B.scan.distance} blocks${B.scan.distance > A.scan.distance ? ', ' + (B.scan.distance / Math.max(1, A.scan.distance)).toFixed(1) + ' times as far' : ''}.`, meta: { phase: 'scan', a: A.scan, b: B.scan, n: A.scan.seq.length, groups: A.g.groups, ratio: B.scan.distance / Math.max(1, A.scan.distance) } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Placement rules', text: ['a new directory: the group with the most free inodes', 'a file\'s inode: its directory\'s group', 'a file\'s blocks: near its inode, then the next', 'a large file: a new group every chunk', 'goal: what is used together sits together'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'file' && f.meta.phase === 'mkdir', pick: 'option', ask: 'Which group will the next file\'s inode go to?', options: (fr) => Array.from({ length: fr[0].meta.groups }, (_, k) => 'group ' + k), answer: (fr, i) => 'group ' + fr[i + 1].meta.group, explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'scan', pick: 'option', ask: 'Reading every file of /b: which layout moves the head less?', options: ['cylinder groups', 'one group', 'the same'], answer: (fr) => { const m = fr[fr.length - 1].meta; return m.a.distance < m.b.distance ? 'cylinder groups' : m.a.distance > m.b.distance ? 'one group' : 'the same'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why put a file\'s inode in the same cylinder group as its directory?', options: ['ls and lookups read the directory and then its inodes: close together means short seeks', 'to save inodes', 'to balance the groups', 'it is required by the superblock'], answer: 0, why: 'Things used together are placed together.' },
      { q: 'Why does a new directory go to a group with many free inodes?', options: ['to spread directories out so each has room for its files nearby', 'to keep them all in group 0', 'to make lookups longer', 'by chance'], answer: 0, why: 'A directory will gather files; it needs a group with room.' },
      { q: 'Why does a large file switch groups every chunk?', options: ['so one big file does not fill a group and push the next files far from their directory', 'to make it faster to read', 'to save bitmap space', 'it cannot fit in one'], answer: 0, why: 'The cost is a seek every chunk, small next to the transfer of a whole chunk.' },
      { q: 'Each cylinder group keeps its own…', options: ['bitmaps and part of the inode table', 'superblock only', 'journal', 'root directory'], answer: 0, why: 'Allocation within a group needs only that group\'s maps.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
