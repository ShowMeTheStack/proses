// Part 14, files and their operations: a file as the directory entry that names it, the inode that holds its
// attributes and the data blocks it owns, changed by create, write, truncate, rename, chmod and unlink on the
// file-system engine; and the two access methods, sequential and direct, counted block by block (F.accessCost).
(function (S) {
  'use strict';
  const T = () => S.T12, U = () => S.T14;
  const R = Math.round;
  const GEO = { bs: 64, nblocks: 64, ninodes: 16 };

  const OPS = ['create /notes', 'stat /notes', 'write /notes Dear diary, today the disk spun up and down all day long.', 'stat /notes', 'write /notes More tomorrow.', 'cat /notes', 'truncate /notes 20', 'chmod 600 /notes', 'rename /notes /diary', 'stat /diary', 'unlink /diary'].join('\n');
  S.topic({
    id: 'fs-file-ops', family: 'p14-files', order: 10, title: 'A file: its name, its inode and its blocks',
    blurb: 'A file is three things in three places. Its name is an entry in a directory, pairing the name with an inode number. Its attributes (type, permission bits, owner, link count, size, where its blocks are) are in the inode. Its bytes are in data blocks. Each operation touches some of the three: stat reads only the inode, rename only directories, write the blocks and the size.',
    inputs: [{ id: 'ops', kind: 'program', label: 'commands (create, write, cat, stat, truncate, chmod, rename, link, unlink)', def: OPS, check: (v) => U().parseOps(v, 12).error }],
    presets: [
      { label: 'A diary’s life', values: { ops: OPS } },
      { label: 'Growing across blocks', values: { ops: ['create /log', 'write /log 0123456789012345678901234567890123456789', 'stat /log', 'write /log 0123456789012345678901234567890123456789', 'stat /log', 'write /log 0123456789012345678901234567890123456789', 'stat /log', 'truncate /log 10', 'stat /log'].join('\n') } },
      { label: 'A hole: truncate up', values: { ops: ['create /sparse', 'write /sparse start', 'truncate /sparse 200', 'stat /sparse', 'cat /sparse'].join('\n') } },
      { label: 'Operations that fail', values: { ops: ['create /x', 'create /x', 'cat /y', 'rename /y /z', 'unlink /x', 'stat /x'].join('\n') } },
    ],
    counters: [{ id: 'size', label: 'bytes' }, { id: 'blocks', label: 'data blocks' }],
    run(inp) {
      const t = T(), u = U(), F2 = S.FS, ops = u.parseOps(inp.ops, 12).ops;
      const F = new S.Frames(['size', 'blocks']);
      // run up to each command, keeping the image for drawing that moment
      const states = [u.nsRun([], { geometry: GEO })].concat(ops.map((c, i) => u.nsRun(ops.slice(0, i + 1), { geometry: GEO })));
      const full = states[states.length - 1];
      let focus = null;
      const cmdText = (c) => (c[0] === 'write' ? `write ${c[1]} “${c[2].length > 18 ? c[2].slice(0, 17) + '…' : c[2]}”` : c.join(' '));
      const draw = (i, img, act) => {
        const items = [];
        // the commands
        items.push(t.title('fo:ct', 0, 14, 'the commands'));
        ops.forEach((c, k) => items.push(t.text('fo:c' + k, 0, 40 + k * 21, cmdText(c), 'calc mono' + (k === i ? ' act' : k > i ? ' muted' : ''), 13)));
        // the root directory's entries
        const ents = F2.list(img, '/').filter((e) => e.name !== '.' && e.name !== '..');
        const DX = 330;
        items.push(t.title('fo:dt', DX, 14, 'directory / (inode 1)'));
        if (!ents.length) items.push(t.text('fo:de', DX, 42, 'no names yet', 'tick', 13));
        ents.slice(0, 5).forEach((e, k) => {
          const on = focus && e.ino === focus;
          items.push({ key: 'fo:en' + e.name, kind: 'cell', x: DX, y: 26 + k * 28, w: 120, h: 26, rx: 0, text: e.name, size: 13, cls: 'dk slot-l' + (on && act.dir ? ' act' : '') });
          items.push({ key: 'fo:ei' + e.name, kind: 'cell', x: DX + 120, y: 26 + k * 28, w: 96, h: 26, rx: 0, text: 'inode ' + e.ino, size: 13, cls: 'dk slot-v mono' + (on && act.dir ? ' act' : '') });
        });
        // the inode of the file in focus
        const IX = 580;
        let st = null;
        try { st = focus ? F2.stat(img, focus) : null; } catch (e) { st = null; }
        if (st && st.type === 'free') st = null;
        items.push(t.title('fo:it', IX, 14, st ? 'inode ' + st.ino : 'the inode'));
        const rows = st ? [['type', st.type], ['mode', st.perms], ['owner', 'uid ' + st.uid + ', gid ' + st.gid], ['links', String(st.nlink)], ['size', st.size + ' B'], ['blocks', st.dataBlocks.length ? st.dataBlocks.join(', ') : 'none']] : [['state', 'freed or not made']];
        const sl = S.Kit.disk.slots({ prefix: 'fo:in', x: IX, y: 26, w: 210, labelW: 64, rh: 28, size: 13, rows: rows.map((r, k) => ({ id: 'r' + k, label: r[0], value: r[1], cls: act.ino && act.ino.includes(r[0]) ? 'act' : '' })) });
        items.push(...sl.items);
        // the data blocks, each with the bytes it holds
        const BY = Math.max(40 + ops.length * 21, 26 + 6 * 28) + 30;
        items.push(t.title('fo:bt', 0, BY, st ? `data blocks of inode ${st.ino} (${GEO.bs} bytes each)` : 'data blocks'));
        if (st) {
          const txt = F2.text(F2.read(img, st.ino));
          const per = F2.payload(img.g), nb = Math.ceil(st.size / per);
          if (!nb) items.push(t.text('fo:bn', 0, BY + 28, 'none: the file is empty', 'tick', 13));
          for (let k = 0; k < Math.min(nb, 6); k++) {
            const piece = txt.slice(k * per, (k + 1) * per), blk = F2.walk(img, st.ino, k * per).block;
            const shown = piece.replace(/\0/g, '·'), x = (k % 3) * 268, y = BY + 14 + Math.floor(k / 3) * 62;
            items.push({ key: 'fo:b' + k, kind: 'cell', x, y, w: 256, h: 54, rx: 5, lines: [blk ? `file block ${k} → disk block ${blk}` : `file block ${k}: a hole, no block`, '“' + (shown.length > 26 ? shown.slice(0, 25) + '…' : shown) + '”'], size: 13, cls: 'dk ' + (blk ? 'dk-data' : 'dk-free') + (act.data && act.data.includes(blk) ? ' act' : '') });
          }
        }
        return items;
      };
      F.add({ items: draw(-1, states[0].img, {}), title: 'start', say: 'An empty file system with blocks of ' + GEO.bs + ' bytes. Each command below changes the directory, the inode or the data blocks; the parts it touches light up.', meta: { phase: 'start', bs: GEO.bs } });
      full.out.forEach((c, i) => {
        const img = states[i + 1].img, st = u.nsKey(c);
        const tgt = c.args.length ? c.args[c.op === 'rename' || c.op === 'link' ? 1 : c.op === 'chmod' ? 1 : 0] : null;
        try { const ino = F2.lookup(img, tgt).ino; if (ino) focus = ino; } catch (e) { /* the name is gone */ }
        if (c.op === 'unlink' && st && st.data) focus = st.data.ino;
        let stt = null; try { stt = focus ? F2.stat(img, focus) : null; } catch (e) { stt = null; }
        const act = {};
        let say;
        if (c.err) say = `${c.op} ${c.args.join(' ')} fails with ${c.err.code}: ${c.err.message}.`;
        else if (c.op === 'stat') { const r = c.result; say = `stat ${c.args[0]} reads only the inode: ${r.type}, mode ${r.perms}, owner uid ${r.uid}, ${t.plural(r.nlink, 'link')}, ${r.size} bytes in ${t.plural(r.dataBlocks.length, 'block')}. No data block is read.`; act.ino = ['type', 'mode', 'owner', 'links', 'size', 'blocks']; }
        else if (c.op === 'cat') { const zs = (c.result.match(/\0/g) || []).length, txt = c.result.replace(/\0+/g, '').slice(0, 40);
          say = `cat ${c.args[0]} looks the name up, reads the inode for the block list, then reads the blocks: ${c.result.length} bytes, “${txt}${c.result.replace(/\0+/g, '').length > 40 ? '…' : ''}”${zs ? ` and ${zs} zero bytes from the hole` : ''}.`; act.data = stt ? stt.dataBlocks : []; }
        else {
          say = st ? st.say : c.op + ' is done.';
          if (c.op === 'create' || c.op === 'rename' || c.op === 'link' || c.op === 'unlink') { act.dir = true; act.ino = ['links']; }
          if (c.op === 'write') { act.ino = ['size', 'blocks']; act.data = st && st.data ? st.data.blocks.map((b) => b.block) : []; }
          if (c.op === 'truncate') act.ino = ['size', 'blocks'];
          if (c.op === 'chmod') act.ino = ['mode'];
        }
        F.set('size', stt && stt.type !== 'free' ? stt.size : 0).set('blocks', stt && stt.type !== 'free' ? stt.dataBlocks.length : 0);
        F.add({ items: draw(i, img, act), title: c.op, say, meta: { phase: c.op, i, err: c.err, step: st, octal: c.op === 'chmod' ? c.args[0] : null, stat: c.op === 'stat' ? c.result : null, text: typeof c.result === 'string' ? c.result.length : null, zeros: typeof c.result === 'string' ? (c.result.match(/\0/g) || []).length : null, now: stt } });
      });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Where each part lives', text: ['name: an entry in a directory → inode number', 'attributes: in the inode (type, mode, owner, links, size, block pointers)', 'data: in the blocks the inode points to', 'stat: inode only; rename: directories only', 'write: blocks, size, maybe new pointers', 'unlink: the entry; at links 0 the inode and blocks'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'rename' && !fr[i + 1].meta.err, once: true, pick: 'option', ask: 'rename is next. Which part of the file changes?', options: ['only the directory entries', 'the inode number', 'the data blocks', 'all three'], answer: 'only the directory entries', explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'write' && !fr[i + 1].meta.err, once: true, pick: 'option', ask: 'write is next. Which parts of the inode change?', options: ['the size, and the block pointers if a new block is needed', 'the link count', 'the owner', 'nothing: only the blocks'], answer: 'the size, and the block pointers if a new block is needed', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Where is a file’s name kept?', options: ['in a directory entry', 'in the inode', 'in the first data block', 'in the superblock'], answer: 0, why: 'The inode has no name: that is why one inode can have several names.' },
      { q: 'Which operation reads no data block of the file?', options: ['stat', 'cat', 'write in the middle of a block', 'truncate to a larger size and read'], answer: 0, why: 'stat returns the inode’s attributes.' },
      { q: 'A file of 130 bytes on 64-byte blocks uses how many data blocks?', options: ['3', '2', '130', '1'], answer: 0, why: '⌈130 / 64⌉ = 3.' },
      { q: 'truncate to a larger size on this file system…', options: ['makes a hole: the new bytes read as zeros and need no block yet', 'copies the file', 'fails', 'fills new blocks with spaces'], answer: 0, why: 'Indexed allocation can leave pointers empty until a byte is written there.' },
    ],
  });

  // =================================================================================================================
  const ALLOCS = [{ value: 'indexed', label: 'indexed (an inode with pointers)' }, { value: 'contiguous', label: 'contiguous (one run)' }, { value: 'linked', label: 'linked (a chain through the blocks)' }, { value: 'fat', label: 'FAT (a chain in a table)' }];
  S.topic({
    id: 'fs-access-methods', family: 'p14-files', order: 20, title: 'Sequential and direct access',
    blurb: 'A program can read a file’s records in order (sequential access: read, then read the next) or jump to any record by its number (direct access: seek, then read). What each costs depends on how the blocks are found: an inode’s pointers or one contiguous run reach any block at once, while a chain must be walked from the start.',
    inputs: [
      { id: 'alloc', kind: 'choice', label: 'allocation', def: 'indexed', options: ALLOCS },
      { id: 'layout', kind: 'choice', label: 'how the file was written', def: 'interleaved', options: [{ value: 'interleaved', label: 'interleaved with another file' }, { value: 'alone', label: 'alone' }] },
      { id: 'records', kind: 'number', label: 'records', def: 8, min: 2, max: 12 },
      { id: 'seed', kind: 'number', label: 'seed (direct order)', def: 3, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Indexed, interleaved', values: { alloc: 'indexed', layout: 'interleaved', records: 8, seed: 3 } },
      { label: 'Linked: direct access walks the chain', values: { alloc: 'linked', layout: 'interleaved', records: 8, seed: 3 } },
      { label: 'Contiguous', values: { alloc: 'contiguous', layout: 'alone', records: 8, seed: 5 } },
      { label: 'FAT', values: { alloc: 'fat', layout: 'interleaved', records: 10, seed: 7 } },
      { label: 'A small file', values: { alloc: 'indexed', layout: 'alone', records: 3, seed: 2 } },
    ],
    counters: [{ id: 'reads', label: 'block reads' }, { id: 'travel', label: 'head travel' }],
    run(inp) {
      const t = T(), F2 = S.FS, g0 = { bs: 64, nblocks: 80, ninodes: 8, alloc: inp.alloc };
      const img = F2.mkfs(g0), g = img.g, pay = F2.payload(g);
      const put = (path, text) => { const tx = F2.prepare(img, 'append', path, text); F2.commit(img, tx, {}); };
      F2.commit(img, F2.prepare(img, 'create', '/data'), {});
      F2.commit(img, F2.prepare(img, 'create', '/other'), {});
      for (let r = 0; r < inp.records; r++) {
        put('/data', String.fromCharCode(65 + r).repeat(pay));
        if (inp.layout === 'interleaved') put('/other', 'x'.repeat(pay));
      }
      const own = new Set(F2.stat(img, '/data').dataBlocks), other = new Set(F2.stat(img, '/other').dataBlocks);
      const seq = F2.accessCost(img, '/data', 'sequential', { records: inp.records, recsize: pay });
      const dir = F2.accessCost(img, '/data', 'direct', { records: inp.records, recsize: pay, seed: inp.seed });
      const F = new S.Frames(['reads', 'travel']);
      const fbOf = new Map(); for (let r = 0; r < inp.records; r++) fbOf.set(F2.walk(img, F2.lookup(img, '/data').ino, r * pay).block, r);
      const cols = 16, first = g.dataStart, last = Math.max(...own, ...other, first), n = Math.min(g.nblocks - first, Math.max(2, Math.ceil((last - first + 1) / cols) + 1) * cols);
      const draw = (pat, k, rec, seen) => {
        const items = [];
        items.push(t.title('am:mt', 0, 14, 'the data region: /data’s blocks lettered by record'));
        for (let j = 0; j < n; j++) {
          const b = first + j, x = (j % cols) * 49, y = 26 + Math.floor(j / cols) * 40;
          const mine = own.has(b), r = fbOf.get(b);
          const cls = 'dk ' + (mine ? 'dk-data' : other.has(b) ? 'dk-jn' : 'dk-free') + (rec && rec.block === b ? ' act' : seen.has(b) ? ' seen' : '');
          items.push({ key: 'am:b' + b, kind: 'cell', x, y, w: 45, h: 34, rx: 4, lines: mine && r !== undefined ? [String.fromCharCode(65 + r), String(b)] : [String(b)], size: 12, cls });
        }
        const ly = 26 + Math.ceil(n / cols) * 40 + 8;
        items.push(...t.legend('am:lg', 0, ly, [{ cls: 'dk-data', text: '/data' }, { cls: 'dk-jn', text: 'another file' }, { cls: 'dk-free', text: 'free' }], 780, 13).items);
        // the two orders
        const rows = [['sequential', seq], ['direct', dir]];
        rows.forEach(([name, res], ri) => {
          const y = ly + 44 + ri * 64, recs = res.steps.filter((s) => s.kind === 'record');
          items.push(t.text('am:rn' + ri, 0, y + 22, name, 'strong' + (pat === name ? ' act-t' : ''), 14));
          recs.forEach((s, j) => {
            const on = pat === name && j === k, done = pat === name ? j < k : (name === 'sequential' && pat === 'direct') || pat === 'end';
            items.push({ key: 'am:r' + ri + '.' + j, kind: 'cell', x: 100 + j * 56, y, w: 50, h: 40, rx: 5, lines: ['rec ' + s.record, s.reads + (s.reads === 1 ? ' read' : ' reads')], size: 12, cls: 'pl-comp' + (on ? ' act' : done ? ' done' : '') });
          });
        });
        return items;
      };
      F.add({ items: draw(null, -1, null, new Set()), title: 'the file', say: `/data holds ${inp.records} records of ${pay} bytes, one a block, stored with ${inp.alloc} allocation${inp.layout === 'interleaved' ? ', written in turn with another file so their blocks alternate' : ''}. First read it in order, then in a shuffled order.`, meta: { phase: 'start', pay } });
      for (const [name, res] of [['sequential', seq], ['direct', dir]]) {
        const seen = new Set(), recs = res.steps.filter((s) => s.kind === 'record');
        let reads = 0;
        const blocks = [];
        recs.forEach((s, j) => {
          reads += s.reads; blocks.push(s.block);
          const travel = F2.seekDistance(blocks).total;
          F.set('reads', reads).set('travel', travel);
          F.add({ items: draw(name, j, s, seen), title: name + ' ' + s.record, say: `${t.cap(name)}: ${s.say.charAt(0).toLowerCase() + s.say.slice(1)}`, meta: { phase: name, j, step: s, reads, travel } });
          seen.add(s.block);
        });
        const tot = res.steps[res.steps.length - 1];
        F.set('reads', res.reads).set('travel', res.distance);
        F.add({ items: draw(name, recs.length, null, seen), title: name + ' total', say: tot.say, meta: { phase: name + '-total', step: tot, reads: res.reads, travel: res.distance, pay } });
      }
      const fewer = seq.reads < dir.reads ? 'sequential' : dir.reads < seq.reads ? 'direct' : null;
      F.add({ items: draw('end', -1, null, new Set()), title: 'compared', say: `Sequential: ${seq.reads} reads and ${seq.distance} blocks of travel; direct: ${dir.reads} reads and ${dir.distance}. ${fewer ? t.cap(fewer) + ' access needs fewer reads here' : 'Both need the same reads'}${inp.alloc === 'linked' ? ': a chain has to be walked from its start to reach a record out of order' : inp.alloc === 'fat' ? ': the table is in memory, so out of order costs travel, not reads' : ', and out of order costs head travel'}.`, meta: { phase: 'end', seq: [seq.reads, seq.distance], dir: [dir.reads, dir.distance] } });
      return { frames: F.list, def: { sections: [{ id: 'a', kind: 'math', title: 'Access methods', text: ['sequential: read next; the system keeps the place', 'direct: read record n (seek, then read)', 'indexed, contiguous: any block found at once', 'linked: record n needs n hops, each a read', 'FAT: hops in a table kept in memory'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'sequential-total', pick: 'option', ask: 'Now the same records in a shuffled order. Will it need more block reads than reading in order?', options: ['more', 'the same', 'fewer'], answer: (fr) => { const m = fr[fr.length - 1].meta; return m.dir[0] > m.seq[0] ? 'more' : m.dir[0] < m.seq[0] ? 'fewer' : 'the same'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'With linked allocation, reading record 50 directly needs about…', options: ['50 block reads to walk the chain, then the record', 'one read', 'two reads', 'a read of the FAT'], answer: 0, why: 'Each block holds the pointer to the next; there is no way to skip ahead.' },
      { q: 'Which allocation makes direct access cheapest?', options: ['contiguous: block = start + n', 'linked', 'a chain in each block', 'none'], answer: 0, why: 'One addition finds any block.' },
      { q: 'Why does a FAT make direct access affordable?', options: ['the chain is walked in a table kept in memory, not on disk', 'the FAT stores the data', 'files are contiguous', 'it caches every block'], answer: 0, why: 'The hops cost memory reads, not disk reads.' },
      { q: 'Reading a file in order on a disk is fast mainly because…', options: ['its blocks are often close together, so the head travels little', 'the inode is skipped', 'records are smaller', 'no permission check is made'], answer: 0, why: 'Little travel between neighbouring blocks; direct access in random order jumps about.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
