// Part 15, copy-on-write with checksums (S.FS.cow on a real image): a change never overwrites a live block. New data
// blocks, a new inode block and a new inode map are written to free space, and then one write, the uberblock, flips
// the root to the new tree. A crash before the flip leaves the old tree whole. Every pointer carries the CRC-32 of
// the block it names, so a bit flipped silently on the disk is caught when read, and a scrub finds it before anyone
// reads it. A snapshot keeps an old root, and so every block it uses.
(function (S) {
  'use strict';
  const H = S.P15, C = () => S.FS.cow;
  const OPS = {
    write: { label: 'overwrite part of chart', args: ['chart', 150, 'STORM WARNING'] },
    append: { label: 'append to notes', args: ['notes', ' and the lamp relit'] },
    create: { label: 'create tide', args: ['tide'] },
    delete: { label: 'delete notes', args: ['notes'] },
    snapwrite: { label: 'snapshot, then overwrite chart', args: ['chart', 150, 'STORM WARNING'] },
  };
  const opName = (op) => (op === 'snapwrite' ? 'write' : op);
  const copy = (img) => ({ g: img.g, bytes: img.bytes.slice(), cow: true });
  function base(snap) {
    const img = C().mkfs({ bs: 128, nblocks: 48 });
    C().apply(img, 'create', ['chart']); C().apply(img, 'write', ['chart', 0, 'Chart of the north shore: rocks at the point, a sandbar off the mouth of the river, the channel marked by two buoys. '.repeat(2).slice(0, 200)]);
    C().apply(img, 'create', ['notes']); C().apply(img, 'write', ['notes', 0, 'buoys repainted']);
    if (snap) C().apply(img, 'snapshot', []);
    return img;
  }
  /** the live tree (or a generation's) as a tidy tree for S.Kit.tree, ids by block so new blocks are new nodes */
  function treeOf(img, gen) {
    const t = C().tree(img, gen ? { gen } : undefined), m = C().mount(img, gen ? { gen } : undefined);
    const hex = (c) => (c >>> 0).toString(16).padStart(8, '0').slice(0, 4);
    const root = { id: 'u' + m.slot, lines: ['uberblock ' + m.slot, 'gen ' + t.gen], kids: [] };
    const imap = { id: 'b' + t.root, lines: ['inode map', 'blk ' + t.root, 'crc ' + hex(m.rootCrc)], kids: [] };
    root.kids.push(imap);
    for (const [ino, n] of [...t.inodes].sort((a, b) => a[0] - b[0])) {
      const inode = { id: 'b' + n.block, lines: [ino === 1 ? 'dir, inode 1' : 'inode ' + ino, 'blk ' + n.block, 'crc ' + hex(n.crc)], kids: [] };
      n.ptrs.forEach((p) => inode.kids.push({ id: 'b' + p.block, lines: ['data', 'blk ' + p.block, 'crc ' + hex(p.crc)], cls: 'leaf', kids: [] }));
      imap.kids.push(inode);
    }
    return { root, t, m };
  }

  S.topic({
    id: 'fsi-cow', family: 'p15-crash', order: 40, title: 'Copy-on-write trees and checksums',
    blurb: 'A copy-on-write file system never writes over a live block. A change writes new data blocks, a new inode block that points to them and a new inode map, all to free space; then a single write to the uberblock moves the root to the new tree. A crash anywhere before that write leaves the old tree whole. Each pointer holds a checksum of the block it names, so silent corruption is caught, and a scrub can look for it ahead of time.',
    inputs: [
      { id: 'op', kind: 'choice', label: 'operation', def: 'write', options: Object.entries(OPS).map(([value, o]) => ({ value, label: o.label })) },
      { id: 'crash', kind: 'number', label: 'power cut after write (0 none)', def: 0, min: 0, max: 8 },
      { id: 'corrupt', kind: 'choice', label: 'then flip one bit', def: 'none', options: [{ value: 'none', label: 'nowhere' }, { value: 'live', label: 'in a live data block' }, { value: 'old', label: 'in a block only the old tree uses' }] },
    ],
    presets: [
      { label: 'Overwrite: new blocks, then the flip', values: { op: 'write', crash: 0, corrupt: 'none' } },
      { label: 'Crash before the flip', values: { op: 'write', crash: 3, corrupt: 'none' } },
      { label: 'A flipped bit caught by its checksum', values: { op: 'append', crash: 0, corrupt: 'live' } },
      { label: 'A snapshot keeps the old tree', values: { op: 'snapwrite', crash: 0, corrupt: 'old' } },
      { label: 'Delete', values: { op: 'delete', crash: 0, corrupt: 'none' } },
    ],
    counters: [{ id: 'gen', label: 'live generation' }, { id: 'used', label: 'blocks in use' }],
    run(inp) {
      const snap = inp.op === 'snapwrite', img = base(snap), Fr = new S.Frames(['gen', 'used']), O = OPS[inp.op];
      const plan = C().prepare(img, opName(inp.op), ...O.args), n = plan.writes.length, k = inp.crash && inp.crash < n ? inp.crash : n;
      const T0 = treeOf(img), used0 = C().inUse(img);
      const draw = (im, tree, lit, note) => {
        const items = [], T = tree;
        S.Kit.tree.layout(T.root, { x: 0, y: 40, levelH: 92, boxW: 92, boxH: 58, gapX: 12 });
        items.push(H.head('cw:tt', 0, 8, `the live tree: generation ${T.t.gen}`));
        const mark = (nd) => { if (lit.has(+String(nd.id).slice(1)) && nd.id[0] === 'b') nd.cls = (nd.cls || '') + ' act'; (nd.kids || []).forEach(mark); };
        mark(T.root);
        items.push(...S.Kit.tree.draw(T.root, { prefix: 'cw:tr', boxW: 92, boxH: 58, size: 13, edgeSize: 13 }));
        const b = S.Kit.tree.bounds(T.root, 92, 58), X = Math.max(b.x + b.w + 40, 560);
        const live = new Set(T.t.blocks.keys()), all = C().inUse(im);
        items.push(H.head('cw:mt', X, 8, `the disk: ${im.g.nblocks} blocks`));
        for (let blk = 0; blk < im.g.nblocks; blk++) {
          const what = blk < 2 ? 'dk-sb' : live.has(blk) ? (T.t.blocks.get(blk) === 'inode map' ? 'dk-ibm' : /^inode/.test(T.t.blocks.get(blk)) ? 'dk-it' : 'dk-data') : all.has(blk) ? 'oldb' : 'dk-free';
          items.push(H.cell('cw:m' + blk, X + (blk % 8) * 36, 22 + Math.floor(blk / 8) * 30, 32, 26, String(blk), 'dk ' + what + (lit.has(blk) ? ' act' : ''), 13, { rx: 3 }));
        }
        const ly = 22 + Math.ceil(im.g.nblocks / 8) * 30 + 10;
        items.push(...S.Kit.disk.legend({ prefix: 'cw:lg', x: X, y: ly, entries: [{ cls: 'dk-sb', text: 'uberblocks' }, { cls: 'dk-ibm', text: 'inode map' }, { cls: 'dk-it', text: 'inodes' }, { cls: 'dk-data', text: 'data' }, { cls: 'dk oldb', text: 'kept by a snapshot' }, { cls: 'dk-free', text: 'free' }], maxW: 290, size: 13 }).items);
        if (note) items.push(...H.para('cw:note', 0, Math.max(b.y + b.h + 24, 330), note.text, Math.max(500, X - 30), 14, note.cls).items);
        return items;
      };
      Fr.set('gen', T0.t.gen).set('used', used0.size);
      Fr.add({ items: draw(img, T0, new Set()), title: 'the tree', say: `Generation ${T0.t.gen}: uberblock ${T0.m.slot} names the inode map at block ${T0.t.root}, which names ${H.plural(T0.t.inodes.size, 'inode block')}, which name the data blocks. Every arrow carries the checksum of the block it points to.${snap ? ' A snapshot of this generation has just been taken: its root is kept in the uberblock.' : ''}`, meta: { phase: 'tree', gen: T0.t.gen, slot: T0.m.slot, root: T0.t.root, ninodes: T0.t.inodes.size, used: used0.size } });
      const full = copy(img); C().commit(full, plan);
      const after = C().tree(full), facts = { planBlocks: plan.writes.map((w) => w.block), sizes: [...after.inodes].map(([i, nd]) => [i, nd.size, nd.ptrs.length]), newRoot: after.root, newGen: after.gen };
      const work = copy(img), lit = new Set();
      for (let i = 0; i < k; i++) {
        const w = plan.writes[i];
        work.bytes.set(w.bytes, w.block * img.g.bs);
        lit.add(w.block);
        const flipped = w.kind === 'uber';
        const T = flipped ? treeOf(work) : T0;
        Fr.set('gen', T.t.gen).set('used', C().inUse(work).size);
        Fr.add({ items: draw(work, T, new Set([w.block])), title: flipped ? 'the flip' : 'write ' + (i + 1), say: `Write ${i + 1} of ${n}: ${w.say[0].toLowerCase() + w.say.slice(1)}${flipped ? ' The old tree\'s blocks that the new one does not share are now free' + (snap ? ', except those the snapshot keeps.' : '.') : ' The live tree is untouched.'}`, meta: Object.assign({ phase: flipped ? 'flip' : 'write', i: i + 1, n, block: w.block, gen: T.t.gen }, facts) });
      }
      if (k < n) {
        const m = C().mount(work), T = treeOf(work);
        Fr.add({ items: draw(work, T, new Set(), { text: `The power fails after write ${k} of ${n}. Mount reads both uberblocks and takes the valid one with the highest generation: ${m.gen}, the old tree, whole. The ${H.plural(k, 'block')} written are not reachable from it, so they are simply free space.`, cls: 'good' }), title: 'crash', say: `The power fails after write ${k}, before the uberblock flip. ${m.steps.map((s) => s.say).join(' ')} Nothing needs repairing: the new blocks were all in free space, and the old tree was never touched.`, meta: { phase: 'crash', k, n, gen: m.gen, steps: m.steps.map((s) => Object.assign({}, s, { say: undefined })), ok: C().check(work).ok } });
      }
      // a flipped bit
      if (inp.corrupt !== 'none') {
        const T = treeOf(work), live = [...T.t.inodes.values()].flatMap((nd) => nd.ptrs.map((p) => p.block)), all = C().inUse(work);
        const victim = inp.corrupt === 'live' ? live[live.length - 1] : [...all].filter((b2) => b2 > 1 && !T.t.blocks.has(b2)).sort((a, b2) => a - b2)[0];
        if (victim !== undefined) {
          C().corrupt(work, victim, 5, 3);
          let readNote = '', bad = null;
          for (const e of C().list(work)) { try { C().read(work, e.name); } catch (err) { bad = { name: e.name, block: err.block }; } }
          const sc = C().scrub(work);
          readNote = bad ? `Reading ${bad.name} fails: block ${bad.block} no longer matches the checksum its parent holds. The error is reported instead of wrong data being returned.` : 'Every live file still reads correctly: the damaged block is not in the live tree.';
          Fr.add({ items: draw(work, T, new Set([victim]), { text: `${readNote} Scrub: ${sc.bad.length ? sc.bad.map((x) => `block ${x.block} (${x.what}, generation ${x.gen})`).join('; ') + (sc.bad.length === 1 ? ' fails its checksum.' : ' fail their checksums.') : 'nothing found.'}`, cls: bad ? 'hot' : 'strong' }), title: 'a flipped bit', say: `One bit of block ${victim} flips on the disk, and the disk reports nothing. ${readNote} A scrub reads every block of every tree and checks it against its checksum, and ${sc.steps.map((s) => s.say.replace(/^Scrub: /, '')).join(' ').replace(/^./, (c) => c.toLowerCase())}${inp.corrupt === 'old' ? ' The snapshot still needs that block, so the scrub is the only way to learn of the damage before the snapshot is used.' : ''}`, meta: { phase: 'corrupt', victim, bad, scrub: sc.bad.map((x) => ({ block: x.block, gen: x.gen })), nbad: sc.bad.length } });
        }
      }
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Copy-on-write', text: ['never overwrite a live block', 'write new data, inode and map to free space', 'then one write: the uberblock (the root)', 'mount: the valid uberblock with the highest generation', 'each pointer holds its child\'s checksum', 'a snapshot keeps an old root alive'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'tree', pick: 'option', ask: 'How many blocks will the change write before the uberblock flip?', options: (fr) => { const n = fr.find((x) => x.meta.n).meta.n; return H.choices(n - 1, [1, 2, 3, 4, 5]); }, answer: (fr) => String(fr.find((x) => x.meta.n).meta.n - 1), explain: 'New data blocks (only those that change), a new inode block for each changed inode, a new inode map: then the flip.' },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'crash', pick: 'option', ask: 'Which generation will mount find after the crash?', options: (fr, i) => [String(fr[0].meta.gen), String(fr[0].meta.gen + 1)], answer: (fr, i) => String(fr[i + 1].meta.gen), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Where does a copy-on-write file system write a changed block?', options: ['to a free block, never over the live one', 'in place', 'to the journal first', 'to the superblock'], answer: 0, why: 'The old version stays intact until the root moves.' },
      { q: 'Why can one write make a whole change take effect?', options: ['the uberblock is the root: flipping it switches to the new tree at once', 'the disk is fast', 'the journal replays it', 'checksums commit it'], answer: 0, why: 'Everything else was written beside the old tree.' },
      { q: 'A block\'s checksum is kept in…', options: ['its parent\'s pointer to it', 'the block itself', 'the superblock only', 'nowhere'], answer: 0, why: 'A block cannot vouch for itself: a stray write would update both.' },
      { q: 'What is a snapshot, here?', options: ['an old root kept, so none of its blocks are freed', 'a full copy of the disk', 'a journal', 'a backup tape'], answer: 0, why: 'Shared blocks make it nearly free to keep.' },
      { q: 'Why scrub if reads already check checksums?', options: ['to find damage in blocks nobody has read lately, while a good copy or the snapshot owner can still act', 'to speed up reads', 'to defragment', 'to free space'], answer: 0, why: 'Silent corruption in cold data would otherwise go unseen.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
