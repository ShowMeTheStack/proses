// I/O systems, part 3: the kernel I/O subsystem. Buffering, a buffer cache, spooling, and the block layer's request
// queue with merging and a scheduling hook (the elevator).
//   S.IO.buffering(kind: 'none'|'single'|'double'|'circular', {blocks, fill, move, compute, slots}) ->
//       {kind, lanes: {device, process, slots}, perBlock, formula, total, steps}
//     fill (T), move (M) and compute (C) are numbers or per-block arrays. With no buffer the device reads straight
//     into the process, which waits, so a block costs T + C. With buffers the device fills a free slot while the
//     process works; the process moves a full slot into its own space (M), freeing the slot, then computes (C).
//     Steady state: single max(T, C) + M; double (and circular) max(T, C + M). A circular buffer of k slots absorbs
//     bursts when T or C vary.
//   S.IO.cache({size, write: 'back'|'through', readAhead}, ops: [{op: 'r'|'w'|'sync', block}]) -> {steps, stats,
//       contents}   LRU replacement; write-back marks blocks dirty and writes them when evicted or synced;
//     write-through writes the disk at once; readAhead n also loads the next n blocks on a read miss.
//     steps: [{kind: hit|miss|evict|flush|prefetch|sync, block, say, cache: [{block, dirty}] (LRU first)}]
//     stats: {hits, misses, diskReads, diskWrites, prefetches, hitRatio}
//   S.IO.spool(jobs: [{proc, at, pages}], {pageTime, spoolTime}) -> {direct, spooled, steps}
//     direct: each process holds the printer while its job prints, waiting for it if busy; spooled: the process
//     writes its job to the spool directory (pages · spoolTime) and carries on, and the daemon prints the spooled
//     jobs one at a time in the order they were spooled. Each: {jobs: [{proc, at, start, end, free, delay}],
//     printer: [{from, to, proc}], meanDelay}  (free: when the process can go on; delay = free − at)
//   S.IO.blockQueue(reqs: [{at, sector, count, op: 'r'|'w', proc}], {elevator: 'noop'|'look'|'deadline', merge,
//       base, perSector, seek, readExpire, writeExpire, start}) -> {dispatched: [{ids, sector, count, op, start,
//       end, wait}], steps, totals: {merges, requests, dispatches, meanWait, maxWait, movement, time}}
//     Requests merge when they are contiguous and of the same kind (a back merge appends, a front merge prepends).
//     noop dispatches in arrival order; look sweeps up and down by sector; deadline sweeps upward (C-LOOK) but
//     first serves any request older than its expiry (reads expire sooner than writes).
//     A dispatch takes base + count · perSector + |sector − head| · seek.
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const IO = (S.IO = S.IO || {});
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const span = (s, n) => (n === 1 ? 'sector ' + s : 'sectors ' + s + '–' + (s + n - 1));
  const val = (x, i) => (Array.isArray(x) ? x[i % x.length] : x);

  IO.buffering = function (kind, o) {
    const a = Object.assign({ blocks: 6, fill: 10, move: 2, compute: 6, slots: 4 }, o || {});
    const n = a.blocks, steps = [], lanes = { device: [], process: [], slots: [] };
    const k = { none: 0, single: 1, double: 2, circular: a.slots }[kind];
    if (k === undefined) throw new Error('unknown buffering ' + kind);
    let procFree = 0, devFree = 0;
    const moveEnd = [];
    for (let i = 0; i < n; i++) {
      const T = val(a.fill, i), M = k ? val(a.move, i) : 0, C = val(a.compute, i);
      if (!k) {
        const s = procFree;
        lanes.device.push({ from: r3(s), to: r3(s + T), block: i });
        lanes.process.push({ from: r3(s), to: r3(s + T), kind: 'wait', block: i });
        lanes.process.push({ from: r3(s + T), to: r3(s + T + C), kind: 'compute', block: i });
        procFree = s + T + C;
        if (i < 2) steps.push({ kind: 'block', block: i, t: r3(s), say: `Block ${i}: with no buffer the process asks, waits ${T} while the device reads straight into it, then computes for ${C}.` });
        continue;
      }
      const slot = i % k, slotFree = i >= k ? moveEnd[i - k] : 0;
      const fs = Math.max(devFree, slotFree), fe = fs + T, slotWait = slotFree > devFree + 1e-9;
      lanes.device.push({ from: r3(fs), to: r3(fe), block: i, slot });
      devFree = fe;
      const ms = Math.max(fe, procFree), me = ms + M;
      if (ms > procFree) lanes.process.push({ from: r3(procFree), to: r3(ms), kind: 'wait', block: i });
      lanes.process.push({ from: r3(ms), to: r3(me), kind: 'move', block: i, slot });
      lanes.process.push({ from: r3(me), to: r3(me + C), kind: 'compute', block: i });
      lanes.slots.push({ slot, from: r3(fs), to: r3(me), block: i, full: r3(fe) });
      moveEnd[i] = me; procFree = me + C;
      if (i < k + 1) steps.push({ kind: 'block', block: i, slot, t: r3(fs), say: `Block ${i} goes into slot ${slot}: the device fills it from ${r3(fs)} to ${r3(fe)}${slotWait ? ', once the process has emptied that slot' : ''}; the process moves it out from ${r3(ms)} and computes until ${r3(me + C)}.` });
    }
    const T0 = val(a.fill, 0), M0 = val(a.move, 0), C0 = val(a.compute, 0);
    const perBlock = !k ? T0 + C0 : k === 1 ? Math.max(T0, C0) + M0 : Math.max(T0, C0 + M0);
    const formula = !k ? 'T + C' : k === 1 ? 'max(T, C) + M' : 'max(T, C + M)';
    const total = procFree;
    steps.push({ kind: 'done', t: r3(total), say: `${kind === 'none' ? 'Unbuffered' : kind === 'circular' ? 'A circular buffer of ' + pl(k, 'slot') : kind === 'single' ? 'Single buffering' : 'Double buffering'}: ${pl(n, 'block')} take${n === 1 ? 's' : ''} ${r3(total)}; in the steady state a block costs ${formula} = ${r3(perBlock)}.` });
    return { kind, slots: k, lanes, perBlock: r3(perBlock), formula, total: r3(total), steps };
  };

  IO.cache = function (o, ops) {
    const a = Object.assign({ size: 4, write: 'back', readAhead: 0 }, o || {});
    const lru = [], steps = [], st = { hits: 0, misses: 0, diskReads: 0, diskWrites: 0, prefetches: 0 };
    const view = () => lru.map((x) => ({ block: x.block, dirty: x.dirty }));
    const find = (b) => lru.findIndex((x) => x.block === b);
    const push = (kind, block, say, extra) => steps.push(Object.assign({ kind, block, say, cache: view() }, extra || {}));
    const insert = (b, dirty) => {
      if (lru.length >= a.size) {
        const v = lru.shift();
        if (v.dirty) { st.diskWrites++; push('flush', v.block, `Block ${v.block} is evicted as the least recently used; it is dirty, so it is written to disk first.`); }
        else push('evict', v.block, `Block ${v.block} is evicted as the least recently used; it is clean, so it is simply dropped.`);
      }
      lru.push({ block: b, dirty });
    };
    for (const op of ops) {
      if (op.op === 'sync') {
        const d = lru.filter((x) => x.dirty);
        d.forEach((x) => { x.dirty = false; st.diskWrites++; });
        push('sync', null, d.length ? `sync writes the ${d.length} dirty block${d.length === 1 ? '' : 's'} (${d.map((x) => x.block).join(', ')}) to disk.` : 'sync: nothing is dirty.');
        continue;
      }
      const b = op.block, i = find(b), w = op.op === 'w';
      if (i >= 0) {
        st.hits++;
        const x = lru.splice(i, 1)[0]; lru.push(x);
        if (w) { if (a.write === 'through') st.diskWrites++; else x.dirty = true; }
        push('hit', b, `${w ? 'Write' : 'Read'} block ${b}: a hit in the cache${w ? (a.write === 'through' ? '; write-through also writes the disk' : '; write-back just marks it dirty') : ''}.`, { op: op.op });
        continue;
      }
      st.misses++;
      if (!w) st.diskReads++;
      insert(b, w && a.write === 'back');
      if (w && a.write === 'through') st.diskWrites++;
      push('miss', b, w ? `Write block ${b}: not cached; it is placed in the cache${a.write === 'through' ? ' and written through to disk' : ' as dirty, to be written later'}.` : `Read block ${b}: a miss, so it is read from disk into the cache.`, { op: op.op });
      if (!w) for (let j = 1; j <= a.readAhead && j < a.size; j++) {
        if (find(b + j) >= 0) continue;
        insert(b + j, false); st.diskReads++; st.prefetches++;
        const x = lru.pop(); lru.splice(Math.max(0, lru.length - j), 0, x);
        push('prefetch', b + j, `Read-ahead loads block ${b + j} as well, expecting a sequential reader.`);
      }
    }
    const n = st.hits + st.misses;
    return { steps, stats: Object.assign(st, { hitRatio: n ? r3(st.hits / n) : 0 }), contents: view() };
  };

  IO.spool = function (jobs, o) {
    const a = Object.assign({ pageTime: 2, spoolTime: 0.2 }, o || {});
    const order = jobs.map((j, i) => Object.assign({ i }, j)).sort((x, y) => x.at - y.at || x.i - y.i), steps = [];
    let free = 0;
    const direct = { jobs: [], printer: [] };
    for (const j of order) {
      const start = Math.max(free, j.at), end = start + j.pages * a.pageTime;
      direct.jobs.push({ proc: j.proc, at: j.at, start: r3(start), end: r3(end), free: r3(end), delay: r3(end - j.at) });
      direct.printer.push({ from: r3(start), to: r3(end), proc: j.proc });
      free = end;
    }
    const sp = order.map((j) => ({ j, spooled: j.at + j.pages * a.spoolTime })).sort((x, y) => x.spooled - y.spooled || x.j.i - y.j.i);
    const spooled = { jobs: [], printer: [] };
    free = 0;
    for (const { j, spooled: s } of sp) {
      const start = Math.max(free, s), end = start + j.pages * a.pageTime;
      spooled.jobs.push({ proc: j.proc, at: j.at, spooled: r3(s), start: r3(start), end: r3(end), free: r3(s), delay: r3(s - j.at) });
      spooled.printer.push({ from: r3(start), to: r3(end), proc: j.proc });
      steps.push({ kind: 'spool', proc: j.proc, t: r3(s), say: `${j.proc} writes its ${j.pages}-page job to the spool directory by t = ${r3(s)} and carries on; the daemon prints it from ${r3(start)} to ${r3(end)}.` });
      free = end;
    }
    const mean = (xs) => r3(xs.reduce((n, x) => n + x.delay, 0) / (xs.length || 1));
    direct.meanDelay = mean(direct.jobs); spooled.meanDelay = mean(spooled.jobs);
    steps.push({ kind: 'compare', say: `Holding the printer, a process waits ${direct.meanDelay} on average before it can go on; with a spool it waits only ${spooled.meanDelay}, the time to write its job to disk.` });
    return { direct, spooled, steps };
  };

  IO.blockQueue = function (reqs, o) {
    const a = Object.assign({ elevator: 'noop', merge: true, base: 2, perSector: 0.1, seek: 0.01, readExpire: 50, writeExpire: 500, start: 0 }, o || {});
    const all = reqs.map((r, i) => ({ id: i, at: r.at || 0, sector: r.sector, count: r.count || 1, op: r.op || 'r', proc: r.proc })).sort((x, y) => x.at - y.at || x.id - y.id);
    let t = 0, head = a.start, dir = 1, fi = 0, merges = 0, movement = 0;
    const q = [], dispatched = [], steps = [];
    const admit = () => {
      while (fi < all.length && all[fi].at <= t) {
        const r = all[fi++];
        const m = a.merge && q.find((x) => x.op === r.op && (x.sector + x.count === r.sector || r.sector + r.count === x.sector));
        if (m) {
          const back = m.sector + m.count === r.sector;
          if (!back) m.sector = r.sector;
          m.count += r.count; m.ids.push(r.id); merges++;
          steps.push({ kind: 'merge', id: r.id, into: m.ids[0], t: r3(t), say: `Request ${r.id} (${span(r.sector, r.count)}) is ${back ? 'appended to' : 'put in front of'} queued request ${m.ids[0]}: a ${back ? 'back' : 'front'} merge, now ${span(m.sector, m.count)}.` });
        } else { q.push({ ids: [r.id], at: r.at, sector: r.sector, count: r.count, op: r.op }); steps.push({ kind: 'queue', id: r.id, t: r3(t), say: `Request ${r.id}, a ${r.op === 'r' ? 'read' : 'write'} of ${r.count} sector${r.count === 1 ? '' : 's'} at ${r.sector}, joins the queue.` }); }
      }
    };
    while (dispatched.length < all.length && (q.length || fi < all.length)) {
      admit();
      if (!q.length) { t = all[fi].at; continue; }
      let pick, why;
      if (a.elevator === 'deadline') {
        const late = q.filter((x) => t - x.at > (x.op === 'r' ? a.readExpire : a.writeExpire)).sort((x, y) => x.at - y.at)[0];
        if (late) { pick = late; why = `it has waited ${r3(t - late.at)}, past its ${late.op === 'r' ? 'read' : 'write'} deadline`; }
        else { const up = q.filter((x) => x.sector >= head).sort((x, y) => x.sector - y.sector); pick = up[0] || q.slice().sort((x, y) => x.sector - y.sector)[0]; why = up[0] ? 'it is the next sector upward' : 'nothing is left above the head, so the sweep wraps to the lowest sector'; }
      } else if (a.elevator === 'look') {
        const ahead = (d) => q.filter((x) => (x.sector - head) * d >= 0).sort((x, y) => (x.sector - y.sector) * d);
        if (!ahead(dir).length) dir = -dir;
        pick = ahead(dir)[0]; why = `it is the nearest sector ${dir > 0 ? 'upward' : 'downward'} on the sweep`;
      } else { pick = q[0]; why = 'it is the oldest'; }
      q.splice(q.indexOf(pick), 1);
      const d = Math.abs(pick.sector - head), dur = a.base + pick.count * a.perSector + d * a.seek;
      dispatched.push({ ids: pick.ids, sector: pick.sector, count: pick.count, op: pick.op, start: r3(t), end: r3(t + dur), wait: r3(t - pick.at) });
      steps.push({ kind: 'dispatch', ids: pick.ids, t: r3(t), say: `t = ${r3(t)}: dispatch request${pick.ids.length > 1 ? 's' : ''} ${pick.ids.join(' + ')} (${span(pick.sector, pick.count)}) because ${why}; it takes ${r3(dur)}.` });
      movement += d; head = pick.sector + pick.count - 1; t += dur;
      if (dispatched.reduce((n, x) => n + x.ids.length, 0) === all.length) break;
    }
    const waits = dispatched.map((x) => x.wait);
    return { dispatched, steps, totals: { merges, requests: all.length, dispatches: dispatched.length, meanWait: r3(waits.reduce((n, x) => n + x, 0) / (waits.length || 1)), maxWait: Math.max(0, ...waits), movement, time: r3(t) } };
  };
})(globalThis.Proses = globalThis.Proses || {});
