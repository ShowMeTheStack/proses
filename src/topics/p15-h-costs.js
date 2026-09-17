// Part 15, the cost of each operation: create, open, write, read, close and delete of one file in /docs, run twice
// through the kernel's open-file layer (S.FS.Sys) on fresh images, once with no buffer cache and once with the cache
// chosen, counting the disk reads, the disk writes and the cache hits of each call and naming the blocks the disk
// served. The rows agree with S.FS.costs, which runs the same sequence.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const OPS = ['create', 'open', 'write', 'read', 'close', 'delete', 'sync'];

  function geo(inp) { return { bs: 128, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, jblocks: inp.mode === 'none' ? 0 : 20 }; }
  /** the sequence on a fresh system: per call {op, reads, writes, hits, blocks} */
  function play(inp, cache) {
    const img = F().mkfs(geo(inp)), sys = new (F().Sys)(img, { mode: inp.mode, cache }), rows = [];
    sys.op(1, 'mkdir', '/docs'); sys.sync();
    const text = 'x'.repeat(F().payload(img.g) * inp.size);
    const row = (op, r, d0) => rows.push({ op, reads: r.io.reads, writes: r.io.writes, hits: r.io.hits, blocks: sys.disk.slice(d0) });
    let d0 = sys.disk.length;
    row('create', sys.op(1, 'create', '/docs/report'), d0);
    d0 = sys.disk.length; const o = sys.open(1, '/docs/report', 'rw'); row('open', o, d0);
    d0 = sys.disk.length; row('write', sys.write(1, o.result, text), d0);
    sys.lseek(1, o.result, 0, 'set');
    d0 = sys.disk.length; row('read', sys.read(1, o.result, text.length), d0);
    d0 = sys.disk.length; row('close', sys.close(1, o.result), d0);
    d0 = sys.disk.length; row('delete', sys.op(1, 'unlink', '/docs/report'), d0);
    d0 = sys.disk.length; row('sync', sys.sync(), d0);
    return { rows, g: img.g };
  }
  S.P15.costPlay = play;
  const WHY = {
    create: 'look up /docs (the root and /docs, inode and entries), then a new inode, its bit in the inode bitmap and a new entry in /docs',
    open: 'look up the path again: the root, /docs and the file\'s inode',
    write: 'the data bitmap, the data blocks, and the inode with its new size and pointers',
    read: 'the inode and the data blocks',
    close: 'nothing on the disk: only the open-file entry goes',
    delete: 'the directory entry, the inode, both bitmaps',
    sync: 'every dirty block still in the cache goes home',
  };

  S.topic({
    id: 'fsi-costs', family: 'p15-lookup', order: 20, title: 'What each operation costs',
    blurb: 'Creating, opening, writing, reading, closing and deleting one file, counted in disk reads and writes. Without a cache every lookup rereads the directories and every change goes straight to the disk. With a buffer cache, blocks read once are found in memory, and with write-back the writes wait to be gathered and done once.',
    inputs: [
      { id: 'capacity', kind: 'number', label: 'cache blocks', def: 16, min: 0, max: 64 },
      { id: 'policy', kind: 'choice', label: 'cache writes', def: 'write-back', options: [{ value: 'write-back', label: 'write-back' }, { value: 'write-through', label: 'write-through' }] },
      { id: 'size', kind: 'number', label: 'file size in blocks', def: 3, min: 1, max: 12 },
      { id: 'mode', kind: 'choice', label: 'journal', def: 'none', options: [{ value: 'none', label: 'none' }, { value: 'ordered', label: 'ordered (metadata)' }, { value: 'data', label: 'full data' }] },
    ],
    check(inp) { return inp.mode !== 'none' && inp.policy === 'write-back' && inp.capacity > 0 ? 'with a journal the cache here writes through: choose write-through' : null; },
    presets: [
      { label: 'No cache against a write-back cache', values: { capacity: 16, policy: 'write-back', size: 3, mode: 'none' } },
      { label: 'Write-through: reads saved, writes not', values: { capacity: 16, policy: 'write-through', size: 3, mode: 'none' } },
      { label: 'A tiny cache of 2 blocks', values: { capacity: 2, policy: 'write-back', size: 3, mode: 'none' } },
      { label: 'A big file', values: { capacity: 16, policy: 'write-back', size: 10, mode: 'none' } },
      { label: 'With an ordered journal', values: { capacity: 16, policy: 'write-through', size: 3, mode: 'ordered' } },
    ],
    counters: [{ id: 'r0', label: 'reads, no cache' }, { id: 'r1', label: 'reads, cached' }, { id: 'w1', label: 'writes, cached' }],
    run(inp) {
      const A = play(inp, { capacity: 0 }), B = play(inp, { capacity: inp.capacity, policy: inp.policy }), Fr = new S.Frames(['r0', 'r1', 'w1']);
      const max = Math.max(1, ...A.rows.concat(B.rows).map((r) => Math.max(r.reads, r.writes, r.hits)));
      const tot = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
      const label = inp.capacity ? `${inp.capacity}-block ${inp.policy} cache` : 'no cache, again', withA = inp.capacity ? 'with ' + H.a(label) : 'again with no cache', withThe = inp.capacity ? 'the ' + label : 'no cache the second time';
      const draw = (k) => {
        const items = [], X0 = 70, bw = 150, unit = Math.min(14, (bw - 48) / max), rh = 44;
        items.push(H.head('co:h0', X0, 14, 'no cache')); items.push(H.head('co:h1', X0 + 2 * bw + 50, 14, label));
        ['reads', 'writes'].forEach((c, j) => items.push(H.text('co:sa' + j, X0 + j * bw, 34, c, 'tick', 13)));
        ['reads', 'writes', 'hits'].forEach((c, j) => items.push(H.text('co:sb' + j, X0 + 2 * bw + 50 + j * bw * 0.8, 34, c, 'tick', 13)));
        OPS.forEach((op, i) => {
          const y = 44 + i * rh, on = i === k, a = A.rows[i], b = B.rows[i];
          items.push(H.text('co:op' + i, 0, y + 22, op, on ? 'act' : 'strong', 14));
          const bar = (key, x, v, cls) => { items.push(H.cell(key, x, y + 8, Math.max(2, v * unit), 22, '', 'bar ' + cls, 12, { audit: 'ignore' })); items.push(H.text(key + 't', x + Math.max(2, v * unit) + 6, y + 24, String(v), 'mono', 13)); };
          if (i <= k) {
            bar('co:a' + i + 'r', X0, a.reads, 'c0'); bar('co:a' + i + 'w', X0 + bw, a.writes, 'c1');
            bar('co:b' + i + 'r', X0 + 2 * bw + 50, b.reads, 'c0'); bar('co:b' + i + 'w', X0 + 2 * bw + 50 + bw * 0.8, b.writes, 'c1'); bar('co:b' + i + 'h', X0 + 2 * bw + 50 + bw * 1.6, b.hits, 'soft');
          }
          if (on) items.push({ key: 'co:band', kind: 'region', x: -8, y: y + 2, w: X0 + 2 * bw + 50 + bw * 2.4 + 16, h: rh - 6, rx: 6, text: '', cls: 'act', layer: 'back' });
        });
        const y2 = 44 + OPS.length * rh + 14;
        if (k >= 0 && k < OPS.length) {
          items.push(H.text('co:bl0', 0, y2 + 6, `blocks the disk served, no cache: ${clip(A.rows[k].blocks.join(' '), 70) || 'none'}`, 'mono', 13));
          items.push(H.text('co:bl1', 0, y2 + 28, `blocks the disk served, with the cache: ${clip(B.rows[k].blocks.join(' '), 62) || 'none'}`, 'mono', 13));
        } else {
          items.push(H.text('co:bl0', 0, y2 + 6, `in all, no cache: ${tot(A.rows, 'reads')} reads, ${tot(A.rows, 'writes')} writes`, 'strong', 14));
          items.push(H.text('co:bl1', 0, y2 + 28, `in all, ${inp.capacity ? label : 'second run'}: ${tot(B.rows, 'reads')} reads, ${tot(B.rows, 'writes')} writes, ${tot(B.rows, 'hits')} hits`, 'strong', 14));
        }
        return items.filter(Boolean);
      };
      Fr.add({ items: draw(-1), title: 'the sequence', say: `One file, /docs/report, of ${H.plural(inp.size, 'block')} of 128 bytes: create it, open it, write it, read it back, close it, delete it, then sync. Each call runs twice on a fresh disk: with no buffer cache, and ${withA}${inp.mode === 'none' ? '' : ', both journaled (' + inp.mode + ')'}. /docs was made just before, so a cache already holds the root and /docs.`, meta: { phase: 'start', size: inp.size, bs: 128 } });
      OPS.forEach((op, i) => {
        const a = A.rows[i], b = B.rows[i];
        Fr.set('r0', tot(A.rows.slice(0, i + 1), 'reads')).set('r1', tot(B.rows.slice(0, i + 1), 'reads')).set('w1', tot(B.rows.slice(0, i + 1), 'writes'));
        let say = `${op}: ${WHY[op]}. No cache: ${H.plural(a.reads, 'read')} and ${H.plural(a.writes, 'write')}. With the cache: ${H.plural(b.reads, 'read')}, ${H.plural(b.writes, 'write')}, ${H.plural(b.hits, 'hit')}.`;
        if (op === 'write' && inp.capacity && inp.policy === 'write-back' && inp.mode === 'none') say += ' The write-back cache holds the changed blocks dirty in memory instead of writing them.';
        if (op === 'sync' && b.writes) say += ` The ${H.plural(b.writes, 'block')} written now were dirty in the cache.`;
        Fr.add({ items: draw(i), title: op, say, meta: { phase: op, a: { reads: a.reads, writes: a.writes, hits: a.hits, blocks: a.blocks }, b: { reads: b.reads, writes: b.writes, hits: b.hits, blocks: b.blocks } } });
      });
      const sa = { reads: tot(A.rows, 'reads'), writes: tot(A.rows, 'writes') }, sb = { reads: tot(B.rows, 'reads'), writes: tot(B.rows, 'writes'), hits: tot(B.rows, 'hits') };
      Fr.add({ items: draw(OPS.length), title: 'in all', say: `In all: ${H.plural(sa.reads, 'read')} and ${H.plural(sa.writes, 'write')} with no cache; ${H.plural(sb.reads, 'read')}, ${H.plural(sb.writes, 'write')} and ${H.plural(sb.hits, 'hit')} with ${withThe}. ${sb.reads < sa.reads ? 'The cache saves ' + H.plural(sa.reads - sb.reads, 'read') + ': directories and inodes read once stay in memory. ' : ''}${sb.writes < sa.writes ? 'Write-back saves ' + H.plural(sa.writes - sb.writes, 'write') + ': a block changed several times, or created and deleted before the sync, is written once or never.' : inp.capacity && inp.policy === 'write-back' && inp.mode === 'none' ? 'Writes are not saved: the cache is so small that dirty blocks are evicted, and written, almost as soon as they are made.' : 'Writes are not saved: each change still goes to the disk.'}`, meta: { phase: 'total', sa, sb, saved: [sa.reads - sb.reads, sa.writes - sb.writes] } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Where the I/O goes', text: ['lookup: per directory, its inode and its blocks', 'create: + inode bitmap, inode, directory block', 'write: + data bitmap, data blocks, inode', 'read: inode, data blocks', 'a cache hit: no disk read', 'write-back: dirty in memory until sync or eviction'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'create', pick: 'option', ask: 'With no cache, how many disk reads will open take (it looks the path up again)?', options: (fr, i) => H.choices(fr[i + 1].meta.a.reads, [0, 1, 2, 3, 4, 5, 6]), answer: (fr, i) => String(fr[i + 1].meta.a.reads), explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'close', pick: 'option', ask: 'With the cache, will delete need any disk reads?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.b.reads ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does open cost reads at all?', options: ['the path must be looked up: each directory\'s inode and blocks', 'it copies the file into memory', 'it writes the inode', 'it checks the bitmaps'], answer: 0, why: 'open resolves the name to an inode; only then is an open-file entry made.' },
      { q: 'A write-back cache makes a write call…', options: ['return after changing blocks in memory; the disk writes come later', 'slower', 'write twice', 'skip the inode'], answer: 0, why: 'The dirty blocks go to disk on sync, on eviction, or after a time.' },
      { q: 'What does a write-back cache risk?', options: ['losing recent writes if the power fails before they reach the disk', 'reading stale data', 'running out of inodes', 'nothing'], answer: 0, why: 'Dirty blocks live only in memory until written.' },
      { q: 'Closing a file normally costs…', options: ['no disk I/O: only the in-memory open-file entry is dropped', 'a full write of the file', 'a lookup', 'a journal commit'], answer: 0, why: 'Unless the file was unlinked while open, close touches only memory.' },
    ],
  });
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
})(globalThis.Proses = globalThis.Proses || {});
