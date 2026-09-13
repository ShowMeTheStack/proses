// Part 13, the kernel I/O subsystem (2): the buffer cache. A few slots kept in least-recently-used order, reads
// and writes that hit or miss, dirty blocks under write-back, write-through, read-ahead for a sequential reader,
// and sync. Every step and count comes from S.IO.cache (src/core/io-c-kernel.js), run on the operations so far.
(function (S) {
  'use strict';
  const R = Math.round;
  /** "r1 w5 sync" -> [{op, block}] */
  const parseOps = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).filter(Boolean).map((x) => {
    if (/^sync$/i.test(x)) return { op: 'sync' };
    const m = String(x).match(/^([rw])(\d+)$/i);
    return m ? { op: m[1].toLowerCase(), block: +m[2] } : null;
  });

  S.topic({
    id: 'io-cache', family: 'p13-kernel', order: 20, title: 'The buffer cache: hits, misses and dirty blocks',
    blurb: 'The kernel keeps recently used disk blocks in memory. A read that finds its block there is a hit and costs no disk I/O; a miss reads the disk and may push out the least recently used block. Writes either go to the disk at once (write-through) or only mark the cached block dirty, to be written when it is evicted or synced (write-back).',
    inputs: [
      { id: 'ops', kind: 'list', label: 'operations (r7 reads block 7, w3 writes block 3, sync)', def: ['r1', 'r2', 'r3', 'r1', 'r4', 'r2', 'r5', 'r1'] },
      { id: 'size', kind: 'number', label: 'cache slots', def: 3, min: 1, max: 8 },
      { id: 'write', kind: 'choice', label: 'writes', def: 'back', options: [{ value: 'back', label: 'write-back' }, { value: 'through', label: 'write-through' }] },
      { id: 'readAhead', kind: 'number', label: 'read-ahead blocks', def: 0, min: 0, max: 3 },
    ],
    check(inp) { const o = parseOps(inp.ops); if (!o.length) return 'operations: at least one'; if (o.some((x) => !x)) return 'operations: r or w and a block number (r12, w3), or sync'; if (o.length > 16) return 'operations: at most 16'; if (o.some((x) => x.block > 99)) return 'blocks 0 to 99'; return null; },
    presets: [
      { label: 'LRU at work', values: { ops: ['r1', 'r2', 'r3', 'r1', 'r4', 'r2', 'r5', 'r1'], size: 3, write: 'back', readAhead: 0 } },
      { label: 'Write-back absorbs repeated writes', values: { ops: ['w1', 'w1', 'w2', 'w1', 'r3', 'w2', 'r4', 'sync'], size: 3, write: 'back', readAhead: 0 } },
      { label: 'The same writes, write-through', values: { ops: ['w1', 'w1', 'w2', 'w1', 'r3', 'w2', 'r4', 'sync'], size: 3, write: 'through', readAhead: 0 } },
      { label: 'A sequential reader with read-ahead', values: { ops: ['r10', 'r11', 'r12', 'r13', 'r14', 'r15'], size: 4, write: 'back', readAhead: 1 } },
      { label: 'A long scan floods the cache', values: { ops: ['r1', 'r2', 'r1', 'r2', 'r7', 'r8', 'r9', 'r10', 'r1', 'r2'], size: 4, write: 'back', readAhead: 0 } },
    ],
    counters: [{ id: 'hits', label: 'hits' }, { id: 'misses', label: 'misses' }, { id: 'reads', label: 'disk reads' }, { id: 'writes', label: 'disk writes' }],
    run(inp) {
      const t = S.T12, ops = parseOps(inp.ops), o = { size: inp.size, write: inp.write, readAhead: inp.readAhead }, F = new S.Frames(['hits', 'misses', 'reads', 'writes']);
      const full = S.IO.cache(o, ops), base = { o, final: full.stats, n: ops.length };
      const opTxt = (x) => (x.op === 'sync' ? 'sync' : x.op + x.block);
      const cw = Math.min(170, R((800 - (inp.size - 1) * 10) / inp.size));
      const blocks = [...new Set(ops.filter((x) => x.op !== 'sync').map((x) => x.block).concat(inp.readAhead ? ops.filter((x) => x.op === 'r').flatMap((x) => [...Array(inp.readAhead)].map((_, k) => x.block + k + 1)) : []))].sort((a, b) => a - b);
      const pic = (j, st, view, gone, disk) => {
        const items = [t.title('ca:ot', 0, 16, 'the program’s operations')];
        const ow = Math.min(64, R((800 - 6 * (ops.length - 1)) / ops.length));
        ops.forEach((x, i) => items.push(t.cell('ca:o' + i, i * (ow + 6), 28, ow, 34, opTxt(x), 'op13' + (i === j ? ' act' : i < j ? ' done' : ''), 14)));
        items.push(t.title('ca:ct', 0, 110, `the cache, ${inp.size} slot${inp.size === 1 ? '' : 's'}`));
        items.push(t.text('ca:lru', 0, 226, '← least recently used', 'tick', 13));
        items.push(t.text('ca:mru', Math.max(300, inp.size * (cw + 10) - 10), 226, 'most recently used →', 'tick', 13, 'end'));
        for (let k = 0; k < inp.size; k++) {
          const e = view[k], x = k * (cw + 10);
          if (!e) { items.push(t.cell('ca:e' + k, x, 124, cw, 70, 'empty', 'cl empty', 13)); continue; }
          const lit = st && e.block === st.block ? (st.kind === 'hit' ? ' hit' : st.kind === 'miss' ? ' miss' : st.kind === 'prefetch' ? ' pre' : '') : '';
          items.push({ key: 'ca:b' + e.block, kind: 'cell', x, y: 124, w: cw, h: 70, rx: 6, lines: ['block ' + e.block, e.dirty ? 'dirty' : 'clean'], size: 14, cls: 'cl' + (e.dirty ? ' dirty' : '') + lit });
        }
        // the disk: the blocks this run touches, with the ones read or written in this step lit
        items.push(t.title('ca:dt', 0, 330, 'the disk'));
        const dw = Math.min(64, R((800 - 6 * (blocks.length - 1)) / blocks.length));
        blocks.forEach((b, i) => { const d = disk && disk[b]; items.push({ key: 'ca:d' + b, kind: 'cell', x: i * (dw + 6), y: 342, w: dw, h: 44, rx: 4, lines: [String(b), d || ' '], size: 13, cls: 'cl' + (d === 'read' ? ' pre' : d === 'write' ? ' dirty' : '') }); });
        if (gone !== null && gone !== undefined) items.push({ key: 'ca:b' + gone.block, kind: 'cell', x: R(800 / 2 - 75), y: 244, w: 150, h: 44, rx: 6, lines: ['block ' + gone.block, gone.flushed ? 'written, dropped' : 'dropped'], size: 13, cls: 'cl gone', exit: 'fade' });
        return items;
      };
      F.add({ items: pic(-1, null, [], null), title: 'empty', say: `An empty cache of ${t.plural(inp.size, 'slot')}, ${inp.write === 'back' ? 'write-back' : 'write-through'}${inp.readAhead ? ', reading ahead ' + t.plural(inp.readAhead, 'block') : ''}. ${t.cap(t.plural(ops.length, 'operation'))} to run: ${ops.map(opTxt).join(' ')}.`, meta: Object.assign({ phase: 'start' }, base) });
      let prevSteps = 0, prevView = [];
      ops.forEach((x, j) => {
        const r = S.IO.cache(o, ops.slice(0, j + 1)), mine = r.steps.slice(prevSteps);
        prevSteps = r.steps.length;
        mine.forEach((st, q) => {
          const last = q === mine.length - 1;
          if (last) F.set('hits', r.stats.hits).set('misses', r.stats.misses).set('reads', r.stats.diskReads).set('writes', r.stats.diskWrites);
          const gone = st.kind === 'evict' || st.kind === 'flush' ? { block: st.block, flushed: st.kind === 'flush' } : null;
          const tail = last && x.op !== 'sync' ? ` Disk so far: ${t.plural(r.stats.diskReads, 'read')}, ${t.plural(r.stats.diskWrites, 'write')}.` : '';
          const disk = {};
          if ((st.kind === 'miss' && x.op === 'r') || st.kind === 'prefetch') disk[st.block] = 'read';
          if (st.kind === 'flush' || (x.op === 'w' && inp.write === 'through' && (st.kind === 'hit' || st.kind === 'miss'))) disk[st.block] = 'write';
          if (st.kind === 'sync') for (const e of prevView) if (e.dirty) disk[e.block] = 'write';
          prevView = st.cache;
          F.add({ items: pic(j, st, st.cache, gone, disk), title: opTxt(x) + ': ' + st.kind, say: st.say + tail, meta: Object.assign({ phase: st.kind, j, step: { kind: st.kind, block: st.block }, stats: last ? r.stats : null, cache: st.cache }, base) });
        });
      });
      const s = full.stats;
      F.add({ items: pic(ops.length, null, full.contents, null), title: 'totals', say: `${t.cap(t.plural(s.hits, 'hit'))} and ${t.plural(s.misses, 'miss', 'misses')} in ${t.plural(ops.length, 'operation')}${ops.some((y) => y.op === 'sync') ? ' (sync counted apart)' : ''}: a hit ratio of ${R(s.hitRatio * 100)}%. The disk saw ${t.plural(s.diskReads, 'read')}${s.prefetches ? ` (${s.prefetches} of them read-ahead)` : ''} and ${t.plural(s.diskWrites, 'write')}.`, meta: Object.assign({ phase: 'done', stats: s, pct: R(s.hitRatio * 100) }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'The buffer cache', text: ['hit:   the block is in memory: no disk I/O', 'miss:  read the block from disk into a slot', '       full? evict the least recently used', 'write-through: every write goes to disk now', 'write-back:    mark dirty; write on evict or sync', 'read-ahead:    on a miss, also load the next blocks'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase !== 'start' && i + 1 < fr.length && fr[i + 1].meta.j === f.meta.j + 1 && (fr[i + 1].meta.phase === 'hit' || fr[i + 1].meta.phase === 'miss') && f.meta.j >= 2, once: true, pick: 'option', ask: (fr, i) => 'Next the program ' + (fr[i + 1].say.startsWith('Write') ? 'writes' : 'reads') + ' block ' + fr[i + 1].meta.step.block + '. Hit or miss?', options: ['hit', 'miss'], answer: (fr, i) => fr[i + 1].meta.phase, explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many of these operations will hit in the cache?', options: (fr) => { const h = fr[0].meta.final.hits; return [...new Set([0, h, h + 1, Math.max(0, h - 1), h + 2])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[0].meta.final.hits), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A cache of 3 slots holds blocks 1, 2, 3 (1 least recently used). The program reads 4. What leaves?', options: ['block 1', 'block 3', 'block 4', 'nothing'], answer: 0, why: 'The least recently used block makes room.' },
      { q: 'Why can write-back lose data in a crash?', options: ['dirty blocks live only in memory until written', 'it writes twice', 'it skips the cache', 'it never writes'], answer: 0, why: 'Until the flush or the eviction, the disk holds the old contents.' },
      { q: 'A block written five times before a sync, under write-back, costs how many disk writes?', options: ['one, at the sync', 'five', 'none', 'ten'], answer: 0, why: 'Each write only re-marks the cached block dirty.' },
      { q: 'Read-ahead pays off for…', options: ['a sequential reader', 'random reads', 'writes', 'a full disk'], answer: 0, why: 'The next block is the one about to be asked for, so loading it early hides the disk time.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
