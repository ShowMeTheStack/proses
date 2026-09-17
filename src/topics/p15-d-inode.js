// Part 15, the inode walk: which block holds byte N of a file. N ÷ the block size gives the file block; the inode's
// direct pointers cover the first few, then each level of indirection covers P, P², P³ more (P pointers fit in a
// block). The walk reads the inode, then one indirect block per level, computing an index at each, then the data
// block. Every number comes from S.FS.walk on a real image with a word written at byte N.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const PARTS = ['direct', 'single', 'double', 'triple'];
  const WORD = 'harbour';
  const BS = [64, 128, 256, 512, 1024, 4096].map((v) => ({ value: String(v), label: v + ' bytes' }));

  function setup(inp) {
    const geo = { bs: +inp.bs, ps: +inp.ps, ndirect: inp.ndirect, levels: inp.levels, nblocks: 64, ninodes: 16 };
    const img = F().mkfs(geo), g = img.g, reach = F().reach(g), max = F().maxFileSize(g) - WORD.length;
    let N, clamped = false;
    if (inp.target === 'N') { N = Math.round(inp.N); if (N > max) { N = max; clamped = true; } }
    else { const r = reach[Math.min(PARTS.indexOf(inp.target), reach.length - 1)]; N = Math.min(max, (r.from + Math.floor(r.blocks * 0.4)) * g.bs + Math.floor(g.bs / 3)); }
    F().apply(img, 'create', ['/atlas']);
    F().apply(img, 'write', ['/atlas', 0, 'Charts of the coast.']);
    F().apply(img, 'write', ['/atlas', N, WORD]);
    const ino = F().lookup(img, '/atlas').ino;
    return { img, g, reach, max: F().maxFileSize(g), N, clamped, ino, w: F().walk(img, ino, N), inode: F().readInode(img, ino) };
  }

  S.topic({
    id: 'fsi-inode', family: 'p15-inode', order: 10, title: 'Walking an inode to byte N',
    blurb: 'Which disk block holds byte N of a file? Divide N by the block size to get the file block. The inode\'s direct pointers map the first few file blocks; past them a single-indirect block holds P more pointers, a double-indirect block P blocks of P, a triple-indirect block P³. The walk computes one index per level and reads one block per level.',
    inputs: [
      { id: 'bs', kind: 'choice', label: 'block size', def: '256', options: BS },
      { id: 'ps', kind: 'choice', label: 'pointer size', def: '4', options: [{ value: '2', label: '2 bytes' }, { value: '4', label: '4 bytes' }, { value: '8', label: '8 bytes' }] },
      { id: 'ndirect', kind: 'number', label: 'direct pointers', def: 6, min: 1, max: 12 },
      { id: 'levels', kind: 'number', label: 'levels of indirection', def: 3, min: 1, max: 3 },
      { id: 'target', kind: 'choice', label: 'walk to', def: 'double', options: [{ value: 'direct', label: 'a byte in the direct part' }, { value: 'single', label: 'a byte in the single part' }, { value: 'double', label: 'a byte in the double part' }, { value: 'triple', label: 'a byte in the triple part' }, { value: 'N', label: 'byte N below' }] },
      { id: 'N', kind: 'number', label: 'byte N', def: 1000000, min: 0, max: 1e15 },
    ],
    check(inp) { if (inp.target === 'triple' && inp.levels < 3) return 'the triple part needs 3 levels of indirection'; if (inp.target === 'double' && inp.levels < 2) return 'the double part needs at least 2 levels'; if (+inp.ps === 2 && +inp.bs > 1024) return 'pointers of 2 bytes cannot name blocks of a disk this size with blocks this big; choose 4 or 8 bytes'; return null; },
    presets: [
      { label: 'A byte in the direct part', values: { bs: '256', ps: '4', ndirect: 6, levels: 3, target: 'direct' } },
      { label: 'Single indirect', values: { bs: '256', ps: '4', ndirect: 6, levels: 3, target: 'single' } },
      { label: 'Double indirect', values: { bs: '256', ps: '4', ndirect: 6, levels: 3, target: 'double' } },
      { label: 'Triple indirect, 4 KiB blocks', values: { bs: '4096', ps: '4', ndirect: 12, levels: 3, target: 'triple' } },
      { label: 'Byte 20,000,123 with tiny blocks', values: { bs: '64', ps: '2', ndirect: 4, levels: 3, target: 'N', N: 20000123 } },
      { label: 'Only one level: a small largest file', values: { bs: '128', ps: '8', ndirect: 4, levels: 1, target: 'N', N: 5000 } },
    ],
    counters: [{ id: 'reads', label: 'blocks read' }],
    run(inp) {
      const R = setup(inp), { g, w, N, reach } = R, Fr = new S.Frames(['reads']), P = g.P;
      const steps = w.steps, lvl = w.loc.level;
      const idxSteps = steps.filter((s) => s.kind === 'index');
      let reads = 0;
      const total = steps.length + 1;
      for (let f = 0; f < total; f++) {
        const st = f ? steps[f - 1] : null;
        if (st && (st.kind === 'inode' || st.kind === 'index' || st.kind === 'data')) reads++;
        Fr.set('reads', reads);
        const items = [];
        // the arithmetic
        items.push(H.text('iw:n', 0, 16, `N = ${H.grp(N)}${R.clamped ? '  (the largest that fits)' : ''}`, 'mono', 17));
        const split = f >= 1;
        items.push(H.text('iw:fb', 0, 46, `file block = ⌊N ÷ ${g.bs}⌋ = ${split ? H.grp(w.fb) : '?'}`, 'calc' + (f === 1 ? ' act' : ''), 14));
        items.push(H.text('iw:off', 0, 70, `offset = N mod ${g.bs} = ${split ? w.off : '?'}`, 'calc' + (f === 1 ? ' act' : ''), 14));
        items.push(H.text('iw:p', 0, 94, `P = ${g.bs} ÷ ${g.ps} = ${P} pointers per block`, 'calc', 14));
        // the reach table
        const tx = 380, cws = [80, 230, 110], heads = ['part', 'file blocks', 'bytes'];
        let cx = tx;
        heads.forEach((h, j) => { items.push(H.cell('iw:th' + j, cx, 0, cws[j], 24, h, 'head', 13)); cx += cws[j]; });
        const rows = reach.map((r) => [r.part, r.blocks === 1 ? H.grp(r.from) : H.grp(r.from) + ' – ' + H.grp(r.from + r.blocks - 1), H.bytes(r.bytes)]).concat([['largest', '', H.bytes(R.max)]]);
        rows.forEach((row, i) => { let x = tx; const on = f >= 2 && i === lvl; row.forEach((v, j) => { items.push(H.cell('iw:t' + i + '.' + j, x, 24 + i * 24, cws[j], 24, v, 'slot-v ' + (j ? 'mono ' : '') + (on ? 'act' : i === rows.length - 1 ? 'none' : ''), 13)); x += cws[j]; }); });
        // the chain: inode, indirect blocks, data block
        const y0 = 24 + rows.length * 24 + 34, ino = R.inode, inoAt = steps.findIndex((s) => s.kind === 'inode') + 1;
        const slotOf = lvl === 0 ? 'd' + Math.floor(w.loc.slot / 3) : PARTS[lvl];
        const irows = [{ id: 'size', label: 'size', value: ino.size >= 1e7 ? H.bytes(ino.size) : H.grp(ino.size) }];
        for (let a = 0; a < g.ndirect; a += 3) { const b2 = Math.min(g.ndirect, a + 3) - 1; irows.push({ id: 'd' + a / 3, label: a === b2 ? 'd' + a : 'd' + a + '–' + b2, value: ino.direct.slice(a, b2 + 1).map((p) => p || '—').join(' ') }); }
        for (let l = 1; l <= g.levels; l++) irows.push({ id: PARTS[l], label: PARTS[l], value: String(ino[PARTS[l]] || '—') });
        irows.forEach((r) => { if (r.id === slotOf && f >= inoAt) r.cls = f === inoAt ? 'act' : 'seen'; });
        items.push(H.head('iw:it', 0, y0 + 4, `inode ${R.ino}`));
        const sl = S.Kit.disk.slots({ prefix: 'iw:i', x: 0, y: y0 + 14, w: 180, rows: irows, labelW: 62, rh: 26, size: 13 });
        items.push(...sl.items);
        let from = { x: 180, y: sl.row(slotOf).cy }, bx = 212;
        const colW = 130, gapX = 30;
        steps.forEach((s, i) => {
          if (s.kind !== 'index' || f < i + 1) return;
          const now = f === i + 1, ent = entries(R.img, s.block, s.idx, P, g.ps, now ? 'act' : 'seen');
          items.push(H.head('iw:st' + s.depth, bx, y0 + 4, `block ${s.block}`));
          const es = S.Kit.disk.slots({ prefix: 'iw:s' + s.depth, x: bx, y: y0 + 14, w: colW, rows: ent, labelW: 54, rh: 26, size: 13 });
          items.push(...es.items);
          items.push({ key: 'iw:w' + s.depth, kind: 'wire', pts: wire(from, { x: bx, y: es.row(ent.find((e) => e.id === 'e' + s.idx) ? 'e' + s.idx : ent[0].id).cy }), head: true, cls: now ? 'act' : '' });
          const cy = y0 + 14 + ent.length * 26 + 18;
          if (s.span > 1) { items.push(H.text('iw:c' + s.depth, bx + colW / 2, cy, H.grp(s.rem), 'calc' + (now ? ' act' : ''), 13, 'middle')); items.push(H.text('iw:k' + s.depth, bx + colW / 2, cy + 18, `÷ ${H.grp(s.span)} → ${s.idx}`, 'calc' + (now ? ' act' : ''), 13, 'middle')); }
          else items.push(H.text('iw:c' + s.depth, bx + colW / 2, cy, `entry ${s.idx}`, 'calc' + (now ? ' act' : ''), 13, 'middle'));
          from = { x: bx + colW, y: es.row('e' + s.idx).cy };
          bx += colW + gapX;
        });
        if (f >= steps.length) {
          const dx = 212 + idxSteps.length * (colW + gapX), u = w.block ? F().block(R.img, w.block) : new Uint8Array(g.bs), lo = Math.max(0, Math.min(g.bs - 4, w.off - 1));
          items.push(H.head('iw:dt', dx, y0 + 4, w.block ? `data block ${w.block}` : 'a hole'));
          for (let k = 0; k < 4; k++) { const v = u[lo + k]; items.push(H.cell('iw:by' + k, dx + k * 40, y0 + 16, 40, 32, v >= 32 && v < 127 ? String.fromCharCode(v) : '0', 'byte mono ' + (lo + k === w.off ? 'act' : v ? '' : 'zero'), 15, { sub: String(lo + k) })); }
          items.push({ key: 'iw:wd', kind: 'wire', pts: wire(from, { x: dx, y: y0 + 32 }), head: true, cls: 'act' });
        }
        let say;
        if (!st) say = `Inode ${R.ino} has ${g.ndirect} direct pointers and ${g.levels} level${g.levels === 1 ? '' : 's'} of indirection; a ${g.bs}-byte block holds ${P} pointers of ${g.ps} bytes, so the largest file is ${H.bytes(R.max)}. We look for byte ${H.grp(N)}${R.clamped ? ' (the N asked for is past the largest file, so the walk goes to the last bytes that fit)' : ''}.`;
        else say = st.say.replace(/\b\d{5,}\b/g, (m) => H.grp(+m));
        Fr.add({ items, say, title: !st ? 'the inode' : st.kind === 'index' ? `level ${st.depth + 1} of ${idxSteps.length}` : st.kind, meta: { phase: st ? st.kind : 'start', N, fb: w.fb, off: w.off, P, step: st ? Object.assign({}, st, { say: undefined }) : null, ndirect: g.ndirect, levels: g.levels, bs: g.bs, ps: g.ps, max: R.max, maxShown: H.bytesNum(R.max), ino: R.ino, block: w.block, reads, level: lvl, starts: reach.map((r) => r.from).concat([reach[reach.length - 1].from + reach[reach.length - 1].blocks]) } });
      }
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'The walk', text: ['file block = ⌊N ÷ bs⌋, offset = N mod bs', 'P = bs ÷ pointer size', 'direct: blocks 0 … d − 1', 'single: the next P, double: P², triple: P³', 'at each level: index = rest ÷ span, rest = rest mod span', 'largest file = bs · (d + P + P² + P³)'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'split', pick: 'option', ask: 'Which part of the inode maps this file block?', options: (fr) => PARTS.slice(0, fr[0].meta.levels + 1), answer: (fr) => PARTS[fr[0].meta.level], explain: (fr) => fr.find((x) => x.meta.phase === 'level').say },
      { at: (f) => f.meta.phase === 'level', pick: 'option', ask: 'How many blocks will the walk read in all, the inode and the data block included?', options: (fr) => H.choices(fr[fr.length - 1].meta.reads, [1, 2, 3, 4, 5]), answer: (fr) => String(fr[fr.length - 1].meta.reads), explain: (fr) => `The inode, one indirect block per level (${fr[0].meta.level}), and the data block: ${fr[fr.length - 1].meta.reads}.` },
    ],
    quiz: [
      { q: '4 KiB blocks, 4-byte pointers, 12 direct pointers: how many file blocks does the single-indirect block add?', options: ['1024', '12', '4096', '256'], answer: 0, why: '4096 ÷ 4 = 1024 pointers fit in one block.' },
      { q: 'With those numbers, file block 1500 is mapped by…', options: ['the double-indirect pointer', 'a direct pointer', 'the single-indirect pointer', 'the triple-indirect pointer'], answer: 0, why: 'Direct covers 0–11, single 12–1035; 1500 is past both.' },
      { q: 'Reading one byte through the triple-indirect pointer reads, besides the inode,…', options: ['three indirect blocks and the data block', 'one block', 'every block before it', 'the whole file'], answer: 0, why: 'One block per level, then the data.' },
      { q: 'Why give the inode direct pointers at all?', options: ['most files are small, and their blocks are found with no extra reads', 'indirect blocks are slower to write', 'they make files larger', 'the superblock needs them'], answer: 0, why: 'Small files never pay for indirection.' },
      { q: 'Doubling the block size (pointers unchanged) makes the largest file about…', options: ['16 times larger (the triple part grows as bs·P³)', 'twice as large', 'the same', '4 times smaller'], answer: 0, why: 'bs doubles and P doubles: 2 × 2³ = 16.' },
    ],
  });

  /** the rows of an indirect block worth showing: the first, the chosen one, the last, with gaps */
  function entries(img, b, idx, P, ps, cls) {
    const u = F().block(img, b), want = [...new Set([0, idx, P - 1])].sort((a, c) => a - c), rows = [];
    want.forEach((i, j) => {
      if (j && i - want[j - 1] > 1) rows.push({ id: 'g' + j, label: '⋮', value: H.grp(i - want[j - 1] - 1) + ' more', cls: 'gapdots none' });
      const p = F().getPtr(u, i * ps, ps);
      rows.push({ id: 'e' + i, label: '[' + H.grp(i) + ']', value: p ? String(p) : '—', cls: (i === idx ? cls : '') + (p ? '' : ' none') });
    });
    return rows;
  }
  function wire(a, b) {
    if (Math.abs(a.y - b.y) < 2) return [[a.x, b.y], [b.x, b.y]];
    const mx = Math.round(b.x - 16);
    return [[a.x, a.y], [mx, a.y], [mx, b.y], [b.x, b.y]];
  }
})(globalThis.Proses = globalThis.Proses || {});
