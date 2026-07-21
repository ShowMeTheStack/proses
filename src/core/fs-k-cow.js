// A copy-on-write file system on a real byte image: nothing live is ever overwritten. A change writes new data
// blocks, a new inode block, a new inode map (the root of the tree), and only then flips the root pointer in an
// uberblock. A crash before the flip leaves the old tree whole; after it, the new one. Every pointer carries the
// CRC-32 of the block it names, so silent corruption (a flipped bit the disk never reported) is caught on read.
//   Layout: blocks 0 and 1 are uberblocks (written alternately); the rest hold tree blocks and data.
//     uberblock: magic, generation, root block, root CRC, snapshot count, snapshots (gen, root, CRC) .., own CRC
//     inode map (root): magic, count, entries (ino, inode block, CRC)
//     inode block: magic, type (1 file, 2 directory), size, pointer count, pointers (block, CRC)
//     the directory is inode 1; its contents are 32-byte entries (inode number, name)
//   const C = S.FS.cow
//   C.mkfs({bs, nblocks}) -> img          C.mount(img) -> {gen, slot, root, steps} (the valid uberblock with the
//                                           highest generation)
//   C.prepare(img, op, ...args) -> {writes: [{block, kind, bytes, say}], steps, gen}   ops: create(name),
//       write(name, offset, text), append(name, text), delete(name), rename(from, to), snapshot(), dropSnapshot(gen)
//   C.commit(img, plan, {crashAfter}) -> {applied, crashed}   C.apply(img, op, args, opts) -> {plan, commit}
//   C.read(img, name, {gen}) -> text (throws a checksum error, code 'ECSUM', naming the bad block)
//   C.list(img, {gen}) -> [{name, ino, size}]   C.tree(img, {gen}) -> the live tree: {root, imap, inodes, blocks}
//   C.check(img) -> {ok, problems, live: Set, free}   C.scrub(img) -> {bad: [{block, what}], steps}
//   C.corrupt(img, block, byte, bit) flips one bit (silent corruption)
(function (S) {
  'use strict';
  const F = S.FS = S.FS || {};
  const C = (F.cow = {});
  const UB = 0x55424552, IM = 0x494d4150, IN = 0x494e4f44;
  const g32 = (u, o) => F.get32(u, o), p32 = (u, o, v) => F.put32(u, o, v);
  const blk = (img, b) => img.bytes.subarray(b * img.g.bs, (b + 1) * img.g.bs);
  const csumErr = (b, what) => { const e = new Error(`checksum mismatch in block ${b} (${what}): the data is corrupt`); e.code = 'ECSUM'; e.block = b; return e; };

  C.mkfs = function (o) {
    const g = Object.assign({ bs: 128, nblocks: 48 }, o || {}), img = { g, bytes: new Uint8Array(g.bs * g.nblocks), cow: true };
    // generation 1: an empty directory (inode 1) in block 3, the inode map in block 2
    const plan = C.build(img, { gen: 0, inodes: new Map([[1, { type: 2, size: 0, ptrs: [] }]]), snaps: [] }, new Map(), []);
    C.commit(img, plan);
    return img;
  };

  /** the uberblocks: the valid one with the highest generation */
  C.mount = function (img, o) {
    const steps = [], cands = [];
    for (const slot of [0, 1]) {
      const u = blk(img, slot);
      const ok = g32(u, 0) === UB && F.crc32(u.subarray(0, img.g.bs - 4)) === g32(u, img.g.bs - 4);
      const gen = g32(u, 4), root = g32(u, 8), rc = g32(u, 12), ns = g32(u, 16), snaps = [];
      for (let k = 0; k < ns && ok; k++) snaps.push({ gen: g32(u, 20 + 12 * k), root: g32(u, 24 + 12 * k), crc: g32(u, 28 + 12 * k) });
      steps.push({ kind: 'uberblock', slot, ok, gen, root, say: ok ? `Uberblock ${slot} is valid: generation ${gen}, root (inode map) at block ${root}.` : `Uberblock ${slot} is not valid (never written, or torn).` });
      if (ok) cands.push({ slot, gen, root, rc, snaps });
    }
    if (!cands.length) throw new Error('no valid uberblock');
    cands.sort((a, b) => b.gen - a.gen);
    const best = (o && o.gen) ? cands.concat(cands.flatMap((c) => c.snaps.map((s) => ({ slot: c.slot, gen: s.gen, root: s.root, rc: s.crc, snaps: c.snaps })))).find((c) => c.gen === o.gen) : cands[0];
    if (!best) throw new Error('no generation ' + o.gen);
    steps.push({ kind: 'mount', say: `Mount generation ${best.gen}: the tree hangs from block ${best.root}.` });
    return { gen: best.gen, slot: best.slot, root: best.root, rootCrc: best.rc, snaps: cands[0].snaps, steps };
  };

  /** read the tree of a generation, verifying every checksum on the way */
  C.tree = function (img, o) {
    const m = C.mount(img, o), blocks = new Map();
    const get = (b, crc, what) => { const u = blk(img, b); if (F.crc32(u) !== crc) throw csumErr(b, what); blocks.set(b, what); return u; };
    const r = get(m.root, m.rootCrc, 'inode map');
    if (g32(r, 0) !== IM) throw csumErr(m.root, 'inode map');
    const inodes = new Map(), n = g32(r, 4);
    for (let k = 0; k < n; k++) {
      const ino = g32(r, 8 + 12 * k), ib = g32(r, 12 + 12 * k), ic = g32(r, 16 + 12 * k), u = get(ib, ic, 'inode ' + ino);
      const node = { type: g32(u, 4), size: g32(u, 8), ptrs: [], block: ib, crc: ic };
      for (let j = 0; j < g32(u, 12); j++) node.ptrs.push({ block: g32(u, 16 + 8 * j), crc: g32(u, 20 + 8 * j) });
      for (const p of node.ptrs) blocks.set(p.block, 'data of inode ' + ino);
      inodes.set(ino, node);
    }
    return { gen: m.gen, root: m.root, snaps: m.snaps, inodes, blocks, get };
  };
  const contents = (img, t, ino) => {
    const n = t.inodes.get(ino), out = new Uint8Array(n.size), bs = img.g.bs;
    n.ptrs.forEach((p, j) => { const u = t.get(p.block, p.crc, 'data of inode ' + ino); out.set(u.subarray(0, Math.min(bs, n.size - j * bs)), j * bs); });
    return out;
  };
  const dirOf = (img, t) => { const u = contents(img, t, 1), out = []; for (let o = 0; o + 32 <= u.length; o += 32) { const e = F.decodeDirent(u, o); if (e.ino) out.push(e); } return out; };
  C.list = (img, o) => { const t = C.tree(img, o); return dirOf(img, t).map((e) => ({ name: e.name, ino: e.ino, size: t.inodes.get(e.ino).size })); };
  C.read = (img, name, o) => { const t = C.tree(img, o), e = dirOf(img, t).find((x) => x.name === name); if (!e) throw F.err('ENOENT', name + ': no such file'); return F.text(contents(img, t, e.ino)); };

  /** every block the current tree and its snapshots use */
  function inUse(img) {
    const used = new Set([0, 1]), m = C.mount(img);
    for (const gen of [m.gen].concat(m.snaps.map((s) => s.gen))) { try { const t = C.tree(img, { gen }); for (const b of t.blocks.keys()) used.add(b); } catch (e) { /* a corrupt snapshot keeps nothing */ } }
    return used;
  }
  C.inUse = inUse;

  /** lay out a new tree: changed files get new data and inode blocks, everything else is shared */
  C.build = function (img, state, changed, steps) {
    const g = img.g, bs = g.bs, used = img.bytes.some((x) => x) ? inUse(img) : new Set([0, 1]), writes = [];
    let next = 2;
    const alloc = () => { while (used.has(next)) next++; if (next >= g.nblocks) throw F.err('ENOSPC', 'the disk is full'); used.add(next); return next++; };
    const inoEntries = [];
    for (const [ino, n] of [...state.inodes.entries()].sort((a, b) => a[0] - b[0])) {
      if (changed.has(ino) || !n.block) {
        const data = changed.get(ino) || new Uint8Array(0), ptrs = [];
        for (let j = 0; j * bs < data.length; j++) {
          const old = n.ptrs[j], chunk = new Uint8Array(bs); chunk.set(data.subarray(j * bs, (j + 1) * bs));
          if (old && F.crc32(blk(img, old.block)) === F.crc32(chunk) && blk(img, old.block).every((v, i) => v === chunk[i])) { ptrs.push(old); continue; }
          const b = alloc(); writes.push({ block: b, kind: 'data', bytes: chunk, say: `Write file data for inode ${ino} to the new block ${b} (block ${j} of the file), never over the old one.` });
          ptrs.push({ block: b, crc: F.crc32(chunk) });
        }
        const u = new Uint8Array(bs); p32(u, 0, IN); p32(u, 4, n.type); p32(u, 8, data.length); p32(u, 12, ptrs.length);
        if (16 + 8 * ptrs.length > bs) throw F.err('EFBIG', 'the file is too big for one inode block');
        ptrs.forEach((p, j) => { p32(u, 16 + 8 * j, p.block); p32(u, 20 + 8 * j, p.crc); });
        const b = alloc(); writes.push({ block: b, kind: 'inode', bytes: u, say: `Write a new inode block for inode ${ino} at ${b}: size ${data.length}, ${ptrs.length} pointer${ptrs.length === 1 ? '' : 's'}, each with its child's checksum.` });
        inoEntries.push([ino, b, F.crc32(u)]);
      } else inoEntries.push([ino, n.block, n.crc]);
    }
    const r = new Uint8Array(bs); p32(r, 0, IM); p32(r, 4, inoEntries.length);
    if (8 + 12 * inoEntries.length > bs) throw F.err('ENOSPC', 'the inode map is full');
    inoEntries.forEach(([i, b, c], k) => { p32(r, 8 + 12 * k, i); p32(r, 12 + 12 * k, b); p32(r, 16 + 12 * k, c); });
    const rb = alloc(), rc = F.crc32(r);
    writes.push({ block: rb, kind: 'imap', bytes: r, say: `Write the new inode map (the root of the tree) at ${rb}, pointing at ${inoEntries.length} inode block${inoEntries.length === 1 ? '' : 's'} with their checksums.` });
    const gen = state.gen + 1, slot = gen % 2, ub = new Uint8Array(bs);
    p32(ub, 0, UB); p32(ub, 4, gen); p32(ub, 8, rb); p32(ub, 12, rc); p32(ub, 16, state.snaps.length);
    state.snaps.forEach((s, k) => { p32(ub, 20 + 12 * k, s.gen); p32(ub, 24 + 12 * k, s.root); p32(ub, 28 + 12 * k, s.crc); });
    p32(ub, bs - 4, F.crc32(ub.subarray(0, bs - 4)));
    writes.push({ block: slot, kind: 'uber', bytes: ub, say: `Flip: write uberblock ${slot} with generation ${gen} and the new root ${rb}. This one write makes the whole change live at once.` });
    steps.push({ kind: 'cow-plan', gen, say: `${writes.length - 1} new block${writes.length === 2 ? '' : 's'} are written first, all to free space; then the root pointer flips to generation ${gen}.` });
    return { writes, steps, gen };
  };

  C.prepare = function (img, op, ...args) {
    const t = C.tree(img), steps = [], state = { gen: t.gen, inodes: new Map(), snaps: t.snaps.slice() }, changed = new Map();
    for (const [i, n] of t.inodes) state.inodes.set(i, { type: n.type, size: n.size, ptrs: n.ptrs, block: n.block, crc: n.crc });
    const dir = dirOf(img, t), find = (name) => dir.find((e) => e.name === name);
    const putDir = () => { const u = new Uint8Array(dir.length * 32); dir.forEach((e, k) => F.encodeDirent(u, k * 32, e.ino, e.name)); changed.set(1, u); };
    const file = (name) => { const e = find(name); if (!e) throw F.err('ENOENT', name + ': no such file'); return e; };
    if (op === 'create') {
      if (find(args[0])) throw F.err('EEXIST', args[0] + ' exists');
      let ino = 2; while (state.inodes.has(ino)) ino++;
      state.inodes.set(ino, { type: 1, size: 0, ptrs: [] }); changed.set(ino, new Uint8Array(0));
      dir.push({ ino, name: args[0] }); putDir();
      steps.push({ kind: 'create', ino, say: `Create ${args[0]} as inode ${ino}: a new inode block and a new directory block, the old ones left as they are.` });
    } else if (op === 'write' || op === 'append') {
      const e = file(args[0]), old = contents(img, t, e.ino), off = op === 'append' ? old.length : args[1], text = op === 'append' ? args[1] : args[2];
      const d = new Uint8Array(Math.max(old.length, off + text.length)); d.set(old); for (let i = 0; i < text.length; i++) d[off + i] = text.charCodeAt(i) & 255;
      changed.set(e.ino, d);
      steps.push({ kind: 'write', ino: e.ino, say: `Write ${F.count(text.length, 'byte')} to ${args[0]} at offset ${off}: only the blocks that change get new copies; the rest are shared with the old tree.` });
    } else if (op === 'delete') {
      const e = file(args[0]); state.inodes.delete(e.ino); dir.splice(dir.indexOf(e), 1); putDir();
      steps.push({ kind: 'delete', ino: e.ino, say: `Delete ${args[0]}: the new tree simply leaves inode ${e.ino} out; its blocks become free once no tree or snapshot uses them.` });
    } else if (op === 'rename') {
      const e = file(args[0]); if (find(args[1])) throw F.err('EEXIST', args[1] + ' exists'); e.name = args[1]; putDir();
      steps.push({ kind: 'rename', say: `Rename ${args[0]} to ${args[1]}: a new directory block, and nothing else.` });
    } else if (op === 'snapshot') {
      state.snaps.push({ gen: t.gen, root: t.root, crc: C.mount(img).rootCrc });
      steps.push({ kind: 'snapshot', gen: t.gen, say: `Snapshot generation ${t.gen}: its root is kept in the uberblock, so none of its blocks will be reused.` });
    } else if (op === 'dropSnapshot') {
      state.snaps = state.snaps.filter((s) => s.gen !== args[0]);
      steps.push({ kind: 'drop', gen: args[0], say: `Drop the snapshot of generation ${args[0]}: blocks only it used are free again.` });
    } else throw new Error('no operation ' + op);
    if (changed.has(1)) state.inodes.get(1).size = changed.get(1).length;
    return C.build(img, state, changed, steps);
  };

  C.commit = function (img, plan, o) {
    o = o || {};
    const stop = o.crashAfter === undefined || o.crashAfter === null ? plan.writes.length : Math.max(0, Math.min(plan.writes.length, o.crashAfter));
    for (let i = 0; i < stop; i++) blk(img, plan.writes[i].block).set(plan.writes[i].bytes);
    return { applied: stop, crashed: stop < plan.writes.length };
  };
  C.apply = (img, op, args, o) => { const plan = C.prepare(img, op, ...(args || [])); return { plan, commit: C.commit(img, plan, o) }; };

  C.check = function (img) {
    const problems = [];
    let t;
    try { t = C.tree(img); } catch (e) { return { ok: false, problems: [{ kind: 'tree', say: e.message, block: e.block }], live: new Set(), free: 0 }; }
    const owner = new Map();
    for (const [ino, n] of t.inodes) for (const p of n.ptrs) { if (owner.has(p.block) && owner.get(p.block) !== ino) problems.push({ kind: 'dup', say: `Block ${p.block} is used by inodes ${owner.get(p.block)} and ${ino}.` }); owner.set(p.block, ino); }
    let dir;
    try { dir = dirOf(img, t); } catch (e) { problems.push({ kind: 'dir', say: e.message }); dir = []; }
    for (const e of dir) if (!t.inodes.has(e.ino)) problems.push({ kind: 'dangling', say: `${e.name} names inode ${e.ino}, which the inode map lacks.` });
    for (const ino of t.inodes.keys()) if (ino !== 1 && !dir.some((e) => e.ino === ino)) problems.push({ kind: 'orphan', say: `Inode ${ino} is in the map but in no directory entry.` });
    try { for (const ino of t.inodes.keys()) contents(img, t, ino); } catch (e) { problems.push({ kind: 'checksum', say: e.message, block: e.block }); }
    const live = inUse(img);
    return { ok: !problems.length, problems, live, free: img.g.nblocks - live.size };
  };
  C.scrub = function (img) {
    const bad = [], steps = [], m = C.mount(img);
    for (const gen of [m.gen].concat(m.snaps.map((s) => s.gen))) {
      let t;
      try { t = C.tree(img, { gen }); } catch (e) { bad.push({ block: e.block, what: e.message, gen }); continue; }
      for (const [ino, n] of t.inodes) for (const p of n.ptrs) if (F.crc32(blk(img, p.block)) !== p.crc) bad.push({ block: p.block, what: 'data of inode ' + ino, gen });
    }
    steps.push({ kind: 'scrub', bad: bad.length, say: bad.length ? `Scrub: ${bad.length === 1 ? '1 block fails its checksum (' : bad.length + ' blocks fail their checksums ('}${bad.map((b) => b.block).join(', ')}): corruption the disk never reported.` : 'Scrub: every block of every live tree matches its checksum.' });
    return { bad, steps };
  };
  C.corrupt = (img, block, byte, bit) => { blk(img, block)[byte || 0] ^= 1 << (bit || 0); };
})(globalThis.Proses = globalThis.Proses || {});
