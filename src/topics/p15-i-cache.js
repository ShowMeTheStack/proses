// Part 15, the buffer cache: a stream of block reads and writes through S.FS.Cache, one tick each. The cache holds
// its blocks in least-recently-used order; a miss reads the disk and may evict the oldest block, writing it first if
// it is dirty. Write-through writes every change at once; write-back keeps it dirty until eviction or the periodic
// sync. A split cache (a page cache for file data and a buffer cache for metadata) holds a data block twice. A crash
// loses whatever was dirty.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const META = 16; // blocks below this are metadata (inodes, bitmaps, directories); the rest file data
  const STREAMS = {
    hot: 'r3 r4 r20 r3 r21 r4 r22 r3 r23 r4 r20 r3',
    scan: 'r3 r4 r3 r4 r20 r21 r22 r23 r24 r25 r26 r3 r4',
    writes: 'w20 w20 r3 w20 w21 r4 w21 w20 r3 w22 w20 r4',
    crash: 'w20 r3 w21 w3 r4 w22 w20 r5',
    split: 'r20 r21 r3 r20 r22 r4 r21 r3',
  };
  const parse = (txt) => String(txt).trim().split(/[\s,]+/).filter(Boolean).map((t) => ({ op: t[0].toLowerCase(), block: +t.slice(1), tok: t.toLowerCase() }));

  S.topic({
    id: 'fsi-cache', family: 'p15-cache', order: 10, title: 'The buffer cache: hits, write-back and sync',
    blurb: 'Memory in front of the disk. A block read twice is read from the disk once; the least recently used block makes room for a new one. Write-through sends every change to the disk at once; write-back keeps changed blocks dirty and writes them on eviction or at the next sync, absorbing repeated writes but risking them in a crash. Two separate caches for file data and metadata can hold the same block twice.',
    inputs: [
      { id: 'stream', kind: 'string', label: 'accesses (r = read, w = write)', def: STREAMS.writes, spaces: true, max: 120, check: (v) => { const t = parse(v); if (!t.length) return 'type some accesses, like r3 w20'; if (t.length > 20) return 'at most 20 accesses'; const bad = t.find((x) => !/^[rw]$/.test(x.op) || !Number.isInteger(x.block) || x.block < 1 || x.block > 63); return bad ? `"${bad.tok}" is not an access: r or w, then a block from 1 to 63` : null; } },
      { id: 'capacity', kind: 'number', label: 'cache blocks', def: 4, min: 1, max: 10 },
      { id: 'policy', kind: 'choice', label: 'writes', def: 'write-back', options: [{ value: 'write-back', label: 'write-back' }, { value: 'write-through', label: 'write-through' }] },
      { id: 'sync', kind: 'number', label: 'sync every (ticks, 0 never)', def: 5, min: 0, max: 20 },
      { id: 'unified', kind: 'choice', label: 'cache', def: 'unified', options: [{ value: 'unified', label: 'one unified cache' }, { value: 'split', label: 'page cache + buffer cache' }] },
      { id: 'crash', kind: 'number', label: 'power cut after access (0 none)', def: 0, min: 0, max: 20 },
    ],
    presets: [
      { label: 'Write-back absorbs repeated writes', values: { stream: STREAMS.writes, capacity: 4, policy: 'write-back', sync: 5, unified: 'unified', crash: 0 } },
      { label: 'Write-through: every write goes out', values: { stream: STREAMS.writes, capacity: 4, policy: 'write-through', sync: 0, unified: 'unified', crash: 0 } },
      { label: 'Hot metadata stays', values: { stream: STREAMS.hot, capacity: 4, policy: 'write-back', sync: 0, unified: 'unified', crash: 0 } },
      { label: 'A big scan pushes it out', values: { stream: STREAMS.scan, capacity: 4, policy: 'write-back', sync: 0, unified: 'unified', crash: 0 } },
      { label: 'A crash loses dirty blocks', values: { stream: STREAMS.crash, capacity: 5, policy: 'write-back', sync: 0, unified: 'unified', crash: 7 } },
      { label: 'Two caches hold data twice', values: { stream: STREAMS.split, capacity: 4, policy: 'write-back', sync: 0, unified: 'split', crash: 0 } },
    ],
    counters: [{ id: 'hits', label: 'hits' }, { id: 'reads', label: 'disk reads' }, { id: 'writes', label: 'disk writes' }],
    run(inp) {
      const acc = parse(inp.stream), unified = inp.unified === 'unified', written = [];
      const C = new (F().Cache)({ capacity: inp.capacity, policy: inp.policy, sync: inp.sync, unified, onWrite: (k) => written.push(+k) });
      const Fr = new S.Frames(['hits', 'reads', 'writes']), cut = inp.crash && inp.crash <= acc.length ? inp.crash : 0;
      const marks = [];
      const draw = (cur, note) => {
        const items = [], n = acc.length, cw = Math.min(42, Math.floor(860 / n));
        items.push(H.head('ca:st', 0, 14, 'the accesses, one a tick'));
        acc.forEach((a, i) => {
          const m = marks[i];
          items.push(H.cell('ca:a' + i, i * cw, 24, cw - 4, 30, a.tok, 'cmd mono ' + (i === cur ? 'act' : i < cur || (cur < 0 && m) ? 'done' : 'todo') + (cut && i >= cut ? ' gone' : ''), 13, m ? { sub: m } : {}));
        });
        if (cut) { const x = cut * cw - 2; items.push({ key: 'ca:cut', kind: 'line', x1: x, y1: 16, x2: x, y2: 62, cls: 'cut', audit: 'ignore' }); }
        const snap = C.snapshot(), y0 = 100;
        const pools = unified ? [['u', 'the cache (least recently used on the left)', inp.capacity]] : [['meta', 'buffer cache (metadata, and data copies)', inp.capacity - Math.floor(inp.capacity / 2)], ['data', 'page cache (file data)', Math.floor(inp.capacity / 2)]];
        let y = y0;
        pools.forEach(([pool, title, slots], p) => {
          items.push(H.head('ca:pt' + p, 0, y, title));
          const held = snap.filter((v) => unified || v.pool === pool);
          for (let k = 0; k < slots; k++) {
            const v = held[k];
            items.push(H.cell('ca:s' + p + '.' + k, k * 84, y + 12, 78, 40, v ? (v.dirty ? ['block ' + v.key, 'dirty'] : ['block ' + v.key]) : '—', 'slot-v ' + (v ? (v.dirty ? 'bad' : v.key >= META ? 'datab' : 'metab') : 'none') + (v && cur >= 0 && acc[cur] && +v.key === acc[cur].block ? ' act' : ''), 13));
          }
          y += 70;
        });
        items.push(H.head('ca:dt', 0, y + 4, 'the disk'));
        items.push(H.text('ca:dr', 0, y + 28, `reads: ${C.stats.reads}   writes: ${C.stats.writes}${written.length ? '  (' + clip(written.join(' '), 46) + ')' : ''}`, 'mono', 14));
        if (note) items.push(...H.para('ca:note', 0, y + 44, note, 760, 14, 'hot').items);
        return items;
      };
      Fr.add({ items: draw(-1), title: 'empty', say: `An empty cache of ${H.plural(inp.capacity, 'block')}${unified ? '' : ', split into a buffer cache of ' + (inp.capacity - Math.floor(inp.capacity / 2)) + ' and a page cache of ' + Math.floor(inp.capacity / 2)}, ${inp.policy}${inp.policy === 'write-back' ? (inp.sync ? ', with a sync every ' + H.plural(inp.sync, 'tick') : ', with no periodic sync') : ''}. ${H.plural(acc.length, 'access', 'accesses')} follow, one a tick; blocks below ${META} are metadata, the rest file data.`, meta: { phase: 'start', capacity: inp.capacity, sync: inp.sync, n: acc.length, meta: META, b: inp.capacity - Math.floor(inp.capacity / 2), p: Math.floor(inp.capacity / 2) } });
      for (let i = 0; i < acc.length; i++) {
        const a = acc[i], kind = a.block >= META ? 'data' : 'meta', w0 = written.length, s0 = Object.assign({}, C.stats), wasDirty = C.dirty.has(a.block);
        const r = a.op === 'r' ? C.read(a.block, kind) : C.write(a.block, kind);
        const flushed = C.tick(1).map(Number);
        const evW = written.slice(w0).filter((b) => !flushed.includes(b) || r.evicted && r.evicted.written && b === +r.evicted.key);
        marks[i] = r.hit ? 'hit' : a.op === 'r' ? 'miss' : 'new';
        Fr.set('hits', C.stats.hits).set('reads', C.stats.reads).set('writes', C.stats.writes);
        let say = `Tick ${i + 1}: ${a.op === 'r' ? 'read' : 'write'} block ${a.block}${kind === 'data' ? ' (file data)' : ' (metadata)'}: `;
        if (a.op === 'r') say += r.hit ? 'it is in the cache, a hit; no disk read.' : 'not in the cache, a miss: one disk read.';
        else say += inp.policy === 'write-through' ? `the cache copy is updated and the block is written to the disk at once.` : `the cache copy is changed and marked dirty; nothing goes to the disk yet${wasDirty ? ', and an earlier unwritten change to it is simply overwritten' : ''}.`;
        if (r.evicted) say += ` To make room, block ${r.evicted.key}, the least recently used, is evicted${r.evicted.written ? ', and since it is dirty it is written to the disk first' : ''}.`;
        if (!unified && kind === 'data' && a.op === 'r' && !r.hit) say += ' With two caches the block is held twice: in the page cache and again in the buffer cache.';
        if (flushed.length) say += ` The sync interval has passed: ${H.plural(flushed.length, 'dirty block')} (${flushed.join(', ')}) ${flushed.length === 1 ? 'is' : 'are'} written home.`;
        Fr.add({ items: draw(i), title: `tick ${i + 1}`, say, meta: { phase: 'access', i, tick: i + 1, block: a.block, op: a.op, hit: r.hit, evicted: r.evicted ? +r.evicted.key : null, evictedWritten: !!(r.evicted && r.evicted.written), flushed, stats: Object.assign({}, C.stats), before: s0, meta: META, evW } });
        if (cut && i + 1 === cut) {
          const lost = C.drop().map(Number);
          Fr.add({ items: draw(i, lost.length ? `power cut: dirty block${lost.length === 1 ? '' : 's'} ${lost.join(', ')} lost` : 'power cut: nothing dirty, nothing lost'), title: 'power cut', say: `The power fails after tick ${cut}. The cache is memory, so it is gone: ${lost.length ? H.plural(lost.length, 'dirty block') + ' (' + lost.join(', ') + ') never reached the disk, and those changes are lost.' : 'but nothing in it was dirty, so the disk has every change.'} ${acc.length - cut === 1 ? 'The access after the cut never happens.' : 'The ' + (acc.length - cut) + ' accesses after the cut never happen.'}`, meta: { phase: 'crash', cut, lost, nlost: lost.length, left: acc.length - cut } });
          break;
        }
      }
      if (!cut) {
        const dirty = C.flush().map(Number);
        Fr.set('writes', C.stats.writes);
        Fr.add({ items: draw(-1), title: 'sync', say: `Finally a sync writes ${dirty.length ? H.plural(dirty.length, 'dirty block') + ' (' + dirty.join(', ') + ')' : 'nothing: no block is dirty'}. In all: ${H.plural(C.stats.hits, 'hit')}, ${H.plural(C.stats.misses, 'miss', 'misses')}, ${H.plural(C.stats.reads, 'disk read')} and ${H.plural(C.stats.writes, 'disk write')} for ${acc.filter((x) => x.op === 'w').length} write calls${C.stats.copies ? '; ' + H.plural(C.stats.copies, 'data block') + ' were cached twice' : ''}.`, meta: { phase: 'end', dirty, stats: Object.assign({}, C.stats), writes: acc.filter((x) => x.op === 'w').length } });
      }
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'The rules', text: ['read: hit, or miss + disk read', 'full: evict the least recently used;', '  a dirty victim is written first', 'write-through: write the disk now', 'write-back: mark dirty; write on evict or sync', 'crash: dirty blocks are lost'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'access' && fr[i + 1].meta.op === 'r', pick: 'option', ask: 'Will the next read be a hit?', options: ['hit', 'miss'], answer: (fr, i) => (fr[i + 1].meta.hit ? 'hit' : 'miss'), explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && (fr[i + 1].meta.phase === 'end' || fr[i + 1].meta.phase === 'crash'), pick: 'option', ask: 'How many disk writes in all, by the end?', options: (fr) => H.choices(fr[fr.length - 1].meta.stats ? fr[fr.length - 1].meta.stats.writes : fr[fr.length - 2].meta.stats.writes, [0, 1, 2, 3, 4, 5, 6, 8, 10]), answer: (fr) => String(fr[fr.length - 1].meta.stats ? fr[fr.length - 1].meta.stats.writes : fr[fr.length - 2].meta.stats.writes), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A block is written 5 times between two syncs. A write-back cache sends it to the disk…', options: ['once, at the sync (or on eviction)', '5 times', 'never', 'twice'], answer: 0, why: 'The dirty copy in memory absorbs every change; only the last version is written.' },
      { q: 'Why do many systems sync every few seconds?', options: ['to bound how much a crash can lose', 'to free memory', 'to speed up reads', 'to defragment'], answer: 0, why: 'Dirty data is at risk until it is written; a periodic sync caps the risk.' },
      { q: 'A one-time read of a huge file pushes the hot directory blocks out of an LRU cache. This is…', options: ['cache pollution by a scan', 'thrashing of the disk arm', 'write amplification', 'a crash'], answer: 0, why: 'LRU keeps the most recent, not the most useful; scans defeat it.' },
      { q: 'What does a unified buffer cache avoid?', options: ['holding the same file data twice, in a page cache and a buffer cache', 'dirty blocks', 'disk reads', 'syncs'], answer: 0, why: 'One cache, one copy: the same memory caches more distinct blocks.' },
    ],
  });
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
})(globalThis.Proses = globalThis.Proses || {});
