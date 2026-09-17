// Part 15, a log-structured file system (S.FS.lfs on a real image): every change is buffered in memory and written
// at the head of the log as a partial segment, a summary followed by the new data blocks, the new copies of the
// inodes and the inode-map pieces that say where those inodes now are. A checkpoint region records where the
// inode-map pieces are. Nothing is overwritten: an old copy is simply dead. After a crash, mount reads the newest
// checkpoint and rolls forward through any whole partial segments written after it.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS, LL = () => S.P15.lfs;
  const text = (n, w) => (w + ' ').repeat(Math.ceil((n * 128) / (w.length + 1))).slice(0, n * 128);
  const SCRIPTS = {
    basic: { label: 'create, write, overwrite, delete', ops: [['create', 'notes'], ['write', 'notes', 0, 'Tide at six; wind from the west.'], ['create', 'chart'], ['write', 'chart', 0, text(3, 'shoal')], ['sync'], ['write', 'notes', 0, 'Tide at seven; wind dropping.'], ['sync'], ['delete', 'chart'], ['sync']] },
    roll: { label: 'two writes, then a crash', ops: [['create', 'tide'], ['create', 'wind'], ['sync'], ['write', 'tide', 0, text(3, 'high')], ['write', 'wind', 0, text(3, 'gust')], ['crash']] },
    lost: { label: 'a crash before the sync', ops: [['create', 'draft'], ['write', 'draft', 0, 'never synced'], ['crash']] },
  };

  S.topic({
    id: 'fsi-lfs', family: 'p15-lfs', order: 10, title: 'A log-structured file system',
    blurb: 'Instead of updating blocks in place, write everything new at the end of a log, in big sequential pieces. A file\'s new data, a new copy of its inode, and a new piece of the inode map (which says where each inode now lives) go out together as a partial segment; a checkpoint region records where the inode map is. Old copies are not erased, just left dead for a cleaner to reclaim.',
    inputs: [{ id: 'script', kind: 'choice', label: 'operations', def: 'basic', options: Object.entries(SCRIPTS).map(([value, s]) => ({ value, label: s.label })) }],
    presets: [
      { label: 'Create, write, overwrite, delete', values: { script: 'basic' } },
      { label: 'Crash after two writes: roll-forward', values: { script: 'roll' } },
      { label: 'Crash before the sync: buffered data lost', values: { script: 'lost' } },
    ],
    counters: [{ id: 'written', label: 'blocks written' }, { id: 'buffered', label: 'blocks in memory' }],
    run(inp) {
      const L = F().lfs, fs = L.mkfs({ bs: 128, segBlocks: 8, nsegs: 6, ninodes: 16 }), Fr = new S.Frames(['written', 'buffered']);
      const side = (f, X) => {
        const items = [H.head('lf:mt', X, 4, 'in memory')];
        const pend = f.pending.map((p) => `D ${p.ino}.${p.fb}`), inos = [...f.dirtyInodes].map((i) => 'I ' + i);
        items.push(H.cell('lf:buf', X, 16, 220, 30, pend.concat(inos).length ? clip(pend.concat(inos).join('  '), 26) : 'the buffer is empty', 'slot-v mono ' + (pend.length + inos.length ? 'act' : 'none'), 13, { align: 'left' }));
        items.push(H.head('lf:it', X, 68, 'the inode map: inode → block'));
        const live = []; f.imap.forEach((a, i) => { if (a) live.push([i, a]); });
        live.slice(0, 7).forEach(([i, a], j) => items.push(H.cell('lf:im' + i, X, 80 + j * 28, 220, 26, `inode ${i}${i === 1 ? ' (the dir)' : ''} → ${a}`, 'slot-v mono', 13, { align: 'left' })));
        try { const files = L.list(f).map((e) => `${e.name} (${e.size} B)`); items.push(H.text('lf:fl', X, 80 + Math.min(7, live.length) * 28 + 22, 'files: ' + (files.length ? clip(files.join(', '), 28) : 'none'), 'strong', 13)); } catch (e) { /* unreadable */ }
        return items;
      };
      let cur = fs, before = new Set(LL().blocks(fs).filter((x) => x.what !== 'free').map((x) => x.b + ':' + x.seq));
      const frame = (title, say, meta) => {
        const now = LL().blocks(cur), lit = new Set(now.filter((x) => x.what !== 'free' && !before.has(x.b + ':' + x.seq)).map((x) => x.b));
        before = new Set(now.filter((x) => x.what !== 'free').map((x) => x.b + ':' + x.seq));
        const d = LL().draw(cur, { prefix: 'lf:d', x: 0, y: 0, lit, cw: 48, ch: 36 });
        const items = d.items.concat(LL().legend('lf:lg', 0, d.h + 10, d.w), side(cur, d.w + 16));
        const st = L.stats(cur);
        Fr.set('written', st.written).set('buffered', cur.pending.length + cur.dirtyInodes.size);
        Fr.add({ items, title, say, meta: Object.assign({ written: st.written, lit: [...lit], dead: now.filter((x) => (x.what === 'data' || x.what === 'inode' || x.what === 'imap') && !x.live).length, pending: cur.pending.length }, meta || {}) });
      };
      frame('mkfs', `An empty log: ${fs.g.nsegs} segments of ${fs.g.segBlocks} blocks, after two checkpoint regions. mkfs has written one partial segment: the root directory's inode and the first inode-map piece, then checkpoint region ${L.stats(fs).written > 0 ? fs.seq % 2 : 0}.`, { phase: 'mkfs', nsegs: fs.g.nsegs, seg: fs.g.segBlocks, slot: fs.seq % 2 });
      for (const o of SCRIPTS[inp.script].ops) {
        if (o[0] === 'crash') {
          const img = cur.img, bare = L.mount({ g: img.g, bytes: img.bytes.slice() }, { rollForward: false }), rolled = L.mount(img);
          const mem = L.list(cur), lostNames = mem.map((e) => e.name).filter((n) => !L.list(rolled).some((e) => e.name === n)), shrunk = mem.filter((e) => { const x = L.list(rolled).find((y) => y.name === e.name); return x && x.size < e.size; }).map((e) => e.name);
          cur = bare;
          frame('crash', `The power fails. Memory is gone: the buffer, the inode map in memory. Mounting from the newest checkpoint alone gives ${L.list(bare).map((e) => e.name + ' (' + e.size + ' B)').join(', ') || 'no files'}.`, { phase: 'crash', files: L.list(bare).map((e) => e.size) });
          cur = rolled;
          frame('roll forward', `${rolled.mountSteps.map((s) => s.say).join(' ')} ${rolled.mountSteps.some((s) => s.kind === 'roll') ? 'Roll-forward recovers what was written after the checkpoint.' : 'Nothing was written after the checkpoint, so nothing more can be recovered.'} The files are now ${L.list(rolled).map((e) => e.name + ' (' + e.size + ' B)').join(', ') || 'none'}${lostNames.length ? '; ' + H.list(lostNames) + ' never reached the disk and ' + (lostNames.length === 1 ? 'is' : 'are') + ' gone' : ''}${shrunk.length ? '; the newest data of ' + H.list(shrunk) + ' was still in the buffer and is lost' : ''}.`, { phase: 'roll', files: L.list(rolled).map((e) => e.size), rolls: rolled.mountSteps.filter((s) => s.kind === 'roll').map((s) => s.seq), at: LL().blocks(rolled).filter((x) => x.what === 'sum').map((x) => [x.seq, x.b]) });
          continue;
        }
        const w0 = L.stats(cur).written, r = o[0] === 'sync' ? L.sync(cur) : L[o[0]](cur, ...o.slice(1)), w1 = L.stats(cur).written;
        const steps = r.steps.filter((s) => s.kind !== 'buffer'), bufN = r.steps.filter((s) => s.kind === 'buffer').length;
        const segs = steps.filter((s) => s.kind === 'segment');
        let say = steps.filter((s) => s.kind !== 'segment' && s.kind !== 'checkpoint').map((s) => s.say).join(' ');
        const auto = w1 - w0 - segs.reduce((a, x) => a + x.count + 1, 0) - (steps.some((x) => x.kind === 'checkpoint') ? 1 : 0);
        if (auto > 0) say += ` The buffer could not hold it all, so the blocks already waiting went to the log first: ${H.plural(auto, 'block')} written as partial segments, with no checkpoint after them.`;
        const waiting = cur.pending.length;
        if (bufN || waiting) say += ` ${H.plural(waiting, 'block')} of data now wait${waiting === 1 ? 's' : ''} in the buffer.`;
        if (segs.length) say += ' ' + segs.map((s) => s.say).join(' ');
        const cp = steps.find((s) => s.kind === 'checkpoint');
        if (cp) say += ' ' + cp.say;
        if (o[0] === 'sync' && !segs.length) say = 'sync: ' + (cp ? cp.say : 'nothing to write.');
        frame(o[0] + (o[1] ? ' ' + o[1] : ''), say.trim(), { phase: o[0], auto, waiting, len: typeof o[o.length - 1] === 'string' && o[0] === 'write' ? o[o.length - 1].length : 0, segs: segs.map((s) => ({ at: s.at, count: s.count, seq: s.seq })), steps: steps.map((s) => Object.assign({}, s, { say: undefined })), bufN });
      }
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'The log', text: ['a change: buffered in memory', 'a partial segment: summary, data, inodes, map pieces', 'the inode map: where each inode lives now', 'checkpoint: where the map pieces are, and the head', 'an old copy: dead, reclaimed by the cleaner', 'mount: checkpoint, then roll forward'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'write' && fr.slice(0, i + 1).some((x) => x.meta.phase === 'sync'), pick: 'option', once: true, ask: 'This write changes a file already on disk. What happens to its old data block?', options: ['it is left where it is, dead', 'it is overwritten in place', 'it is erased at once', 'it is moved to the head'], answer: 'it is left where it is, dead', explain: 'A log-structured file system never writes in place; the cleaner reclaims dead blocks later.' },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'roll', pick: 'option', ask: 'After roll-forward, will the data written since the last checkpoint be there?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.rolls.length ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why does a log-structured file system write in large segments?', options: ['one long sequential write costs about one seek, however many blocks it carries', 'segments are safer', 'to save inodes', 'the disk requires it'], answer: 0, why: 'Small random writes become one big sequential one.' },
      { q: 'What does the inode map do?', options: ['records where the latest copy of each inode is, since inodes move', 'lists free blocks', 'maps names to inodes', 'holds file data'], answer: 0, why: 'Inodes are written anew each time they change, so a map must find them.' },
      { q: 'After a crash, what does roll-forward do?', options: ['reads partial segments written after the last checkpoint and takes their inodes and map pieces', 'erases the log', 'runs fsck', 'restores the previous checkpoint only'], answer: 0, why: 'Their summaries and checksums say which are whole.' },
      { q: 'What happens to data still in the memory buffer at a crash?', options: ['it is lost: it never reached the log', 'it is recovered by roll-forward', 'it is in the checkpoint', 'the cleaner saves it'], answer: 0, why: 'Only what was written can be rolled forward.' },
    ],
  });
  S.P15.lfsScripts = SCRIPTS;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
})(globalThis.Proses = globalThis.Proses || {});
