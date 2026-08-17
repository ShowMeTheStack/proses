// The Storage lab, part seven: the kernel I/O subsystem, first half (S.IO.buffering and S.IO.cache).
//   buffer  the same blocks read with no buffer, one, two or a ring of k, side by side: the device and the process on
//           one time axis each, a frame at every moment something starts or ends, and the steady-state formula
//   cache   a list of reads, writes and syncs through an LRU buffer cache, write-back and write-through side by side
//           (or one of them), read-ahead on a miss: the cache from least to most recently used, dirty blocks marked,
//           each operation a hit or a miss, and the disk reads and writes counted. Each frame is the cache after one
//           more operation: the engine is run on the operations so far, so every number is the engine's own
//   SL.ksCheck(v) -> 'why not' | null for the four subsystem views     SL.ksRun(v, ctx) -> the lab's result
// The spool and the block queue are in lab-storage-h.js.
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const IO = () => S.IO;
  const fix = (x, d) => SL.fix(x, d === undefined ? 2 : d);

  // ---- buffering -----------------------------------------------------------------------------------------------
  const BUF = [['none', 'bNone', 'No buffer'], ['single', 'bSingle', 'Single buffer'], ['double', 'bDouble', 'Double buffer'], ['circular', 'bCirc', 'Circular buffer']];
  SL.bufKinds = (v) => BUF.filter((b) => v[b[1]]).map((b) => b[0]);
  SL.bufOpts = (v) => ({ blocks: v.bBlocks, fill: v.bFill.length === 1 ? v.bFill[0] : v.bFill.slice(), move: v.bMove, compute: v.bCompute.length === 1 ? v.bCompute[0] : v.bCompute.slice(), slots: v.bSlots });
  const bufName = (kind, k) => (kind === 'circular' ? 'Circular buffer, ' + k + ' slots' : BUF.find((b) => b[0] === kind)[2]);
  /** what a lane is doing at time t, from the engine's segments */
  const at = (segs, t) => segs.find((s) => s.from <= t + 1e-9 && t < s.to - 1e-9);

  function bufferRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 380 : 980, o = SL.bufOpts(v);
    const runs = SL.bufKinds(v).map((kind) => ({ kind, r: IO().buffering(kind, o) }));
    const T = Math.max(...runs.map((x) => x.r.total));
    const times = [...new Set(runs.flatMap((x) => x.r.lanes.device.concat(x.r.lanes.process).flatMap((s) => [s.from, s.to])))].sort((a, b) => a - b);
    let ts = times.filter((t) => t < T);
    if (ts.length > 36) ts = ts.filter((_, i) => i % Math.ceil(ts.length / 36) === 0);
    ts.push(T);
    const blockH = 114, legY = runs.length * blockH + 6;
    const segsDev = (r) => r.lanes.device.map((s) => ({ from: s.from, to: s.to, cls: 'io-busy', text: r.slots ? 'b' + s.block + '→s' + s.slot : 'b' + s.block }));
    const segsProc = (r) => r.lanes.process.map((s) => ({ from: s.from, to: s.to, cls: s.kind === 'wait' ? 'ps-wait' : s.kind === 'move' ? 'ps-move' : 'ps-compute', text: s.kind === 'wait' ? 'wait' : s.kind === 'move' ? 'M' + s.block : 'C' + s.block }));
    const doing = (x, t) => {
      const d = at(x.r.lanes.device, t), p = at(x.r.lanes.process, t);
      const dev = d ? 'the device fills block ' + d.block + (x.r.slots ? ' into slot ' + d.slot : ' straight into the process') : 'the device is idle';
      const pr = !p ? (t >= x.r.total - 1e-9 ? 'the process is done' : 'the process waits') : p.kind === 'wait' ? 'the process waits for block ' + p.block : p.kind === 'move' ? 'the process moves block ' + p.block + ' out of slot ' + p.slot : 'the process computes on block ' + p.block;
      return dev + ' and ' + pr;
    };
    const frames = ts.map((t, fi) => {
      const fin = fi === ts.length - 1, items = [];
      runs.forEach((x, i) => {
        const y = i * blockH, name = bufName(x.kind, x.r.slots);
        items.push(SL.text('bn' + i, 0, y + 14, name, 'strong', 14));
        const f = x.r.formula + ' = ' + fix(x.r.perBlock) + ' a block';
        if (!narrow) items.push(SL.text('bf' + i, W, y + 14, (fin || t >= x.r.total ? 'all ' + o.blocks + ' blocks by ' + fix(x.r.total) + ' · ' : '') + f, 'tick', 13, 'end'));
        else items.push(SL.text('bf' + i, W, y + 14, f, 'tick', 12, 'end'));
        const L = SL.lanes({ prefix: 'b' + i, x: 0, y: y + 22, w: W, labelW: narrow ? 62 : 80, t1: T, rows: [{ label: 'device', segs: segsDev(x.r) }, { label: 'process', segs: segsProc(x.r) }], rowH: 22, gap: 4, upTo: fin ? Infinity : t, now: fin ? null : t, unit: 'µs', size: 13 });
        items.push(...L.items);
      });
      items.push(...SL.legend('bl', 0, legY, [['tl io-busy', 'device filling a block'], ['tl ps-wait', 'process waiting'], ['tl ps-move', 'moving a block out (M)'], ['tl ps-compute', 'computing (C)']].map(([cls, text]) => ({ cls, text })), W, 12).items);
      const say = fin ? runs.map((x) => x.r.steps[x.r.steps.length - 1].say).join(' ')
        : 'At t = `' + fix(t) + '`: ' + runs.map((x) => (runs.length > 1 ? bufName(x.kind, x.r.slots).toLowerCase() + ', ' : '') + doing(x, t)).join('; ') + '.';
      return { items, say, title: fin ? 'end' : 't = ' + fix(t), at: fi, hold: 1100 };
    });
    const tables = runs.map((x) => ({ title: bufName(x.kind, x.r.slots) + ': ' + x.r.formula + ' = ' + fix(x.r.perBlock) + ' a block', cols: ['block', 'slot', 'device fills', 'process moves', 'process computes'],
      rows: x.r.lanes.device.map((d) => { const m = x.r.lanes.process.find((p) => p.block === d.block && p.kind === 'move'), c = x.r.lanes.process.find((p) => p.block === d.block && p.kind === 'compute'); return [String(d.block), x.r.slots ? String(d.slot) : '–', fix(d.from) + '–' + fix(d.to), m ? fix(m.from) + '–' + fix(m.to) : '–', fix(c.from) + '–' + fix(c.to)]; }) }));
    const best = Math.min(...runs.map((x) => x.r.total));
    const metrics = runs.map((x) => ({ label: bufName(x.kind, x.r.slots), value: fix(x.r.total), unit: 'µs in all', note: x.r.formula + ' = ' + fix(x.r.perBlock) + ' a block', cls: runs.length > 1 && x.r.total === best ? 'good' : '' }));
    const trace = runs.flatMap((x) => x.r.steps.map((s) => ({ kind: s.kind, t: s.t, say: (runs.length > 1 ? bufName(x.kind, x.r.slots) + ': ' : '') + s.say })));
    frames.forEach((f, i) => { f.at = Math.min(trace.length - 1, Math.round((i * (trace.length - 1)) / Math.max(1, frames.length - 1))); });
    return { frames, trace, tables, metrics, buf: runs };
  }

  // ---- the buffer cache ----------------------------------------------------------------------------------------
  /** 'r12' -> {op: 'r', block: 12}; 'sync' -> {op: 'sync'} */
  SL.cacheOps = (list) => list.map((w) => { const m = /^([rw])(\d+)$/i.exec(String(w).trim()); return m ? { op: m[1].toLowerCase(), block: +m[2] } : { op: 'sync' }; });
  SL.cacheModes = (v) => (v.cWrite === 'both' ? ['back', 'through'] : [v.cWrite]);
  const MODE = { back: 'Write-back', through: 'Write-through' };

  function cacheRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 380 : 980, ops = SL.cacheOps(v.cOps), modes = SL.cacheModes(v);
    // the engine on every prefix of the operations: the cache after each one, and the steps it took
    const runs = modes.map((write) => ({ write, pre: ops.map((_, k) => IO().cache({ size: v.cSize, write, readAhead: v.cRa }, ops.slice(0, k + 1))) }));
    const full = runs.map((x) => x.pre[x.pre.length - 1]);
    const outcome = ops.map((op, k) => { const s = runs[0].pre[k].steps.slice(k ? runs[0].pre[k - 1].steps.length : 0); return (s.find((x) => x.kind === 'hit' || x.kind === 'miss' || x.kind === 'sync') || {}).kind; });
    const cw = narrow ? 42 : 52, perRow = Math.floor((W - (narrow ? 0 : 60)) / (cw + 4)), opRows = Math.ceil(ops.length / perRow);
    const opsY = 22, blkY = opsY + opRows * 34 + 26, blockH = narrow ? 166 : 150;
    const frames = ops.map((op, k) => {
      const items = [];
      items.push(SL.text('oT', 0, 12, 'operations, in order (' + v.cSize + ' cache blocks, LRU' + (v.cRa ? ', read-ahead ' + v.cRa : '') + ')', 'title', 13));
      ops.forEach((o, j) => {
        const x = (narrow ? 0 : 60) + (j % perRow) * (cw + 4), y = opsY + Math.floor(j / perRow) * 34;
        const oc = j < k ? outcome[j] : null, cls = j === k ? 'tl act' : oc === 'hit' ? 'tl free' : oc === 'miss' ? 'tl wait' : oc === 'sync' ? 'tl ps-move' : 'tl-track';
        items.push(SL.cell('op' + j, x, y, cw, 28, o.op === 'sync' ? 'sync' : o.op + o.block, cls, 13));
      });
      if (!narrow) items.push(SL.text('oL', 0, opsY + 19, 'ops', 'strong', 13));
      runs.forEach((x, i) => {
        const r = x.pre[k], prev = k ? x.pre[k - 1].steps.length : 0, now = r.steps.slice(prev), y = blkY + i * blockH;
        items.push(SL.text('cn' + i, 0, y + 12, MODE[x.write], 'strong', 14));
        const st = r.stats;
        items.push(SL.text('cs' + i, W, y + 12, (narrow ? '' : 'hits ' + st.hits + ' · misses ' + st.misses + ' · ') + 'disk reads ' + st.diskReads + ' · disk writes ' + st.diskWrites, 'tick', 13, 'end'));
        const bw = narrow ? 64 : 92, cx0 = narrow ? 0 : 140;
        if (!narrow) items.push(SL.text('cl' + i, cx0 - 12, y + 46, 'LRU first', 'tick', 12, 'end'));
        for (let s = 0; s < v.cSize; s++) {
          const c = r.contents[s], hit = c && now.some((e) => e.block === c.block && (e.kind === 'hit' || e.kind === 'miss' || e.kind === 'prefetch'));
          items.push(SL.cell('cb' + i + '_' + s, cx0 + s * (bw + 8), y + 24, bw, 42, c ? '' : 'empty', c ? (c.dirty ? 'tl wait' : 'tl free') + (hit ? ' act' : '') : 'tl-track', 13, c ? { lines: ['block ' + c.block, c.dirty ? 'dirty' : 'clean'] } : {}));
        }
        const lines = now.map((e) => e.say);
        const txt = SL.para('cp' + i, 0, y + 88, lines.join(' '), W, 13, '');
        items.push(...txt.items.slice(0, narrow ? 4 : 3 * 1));
      });
      items.push(...SL.legend('cg', 0, blkY + runs.length * blockH - 8, [['tl free', 'a hit · a clean block'], ['tl wait', 'a miss · a dirty block'], ['tl ps-move', 'sync'], ['tl act', 'this operation, the blocks it touched']].map(([cls, text]) => ({ cls, text })), W, 12).items);
      const say = runs.map((x) => { const r = x.pre[k], now = r.steps.slice(k ? x.pre[k - 1].steps.length : 0); return (runs.length > 1 ? MODE[x.write] + ': ' : '') + now.map((e) => e.say).join(' '); }).join(' ');
      return { items, say, title: (op.op === 'sync' ? 'sync' : op.op + op.block) + ' · ' + (outcome[k] || ''), at: k, hold: 1300,
        tables: runs.map((x) => ({ title: MODE[x.write] + ': the cache after ' + (op.op === 'sync' ? 'sync' : op.op + op.block) + ', least recently used first', cols: ['position', 'block', 'state'], rows: x.pre[k].contents.map((c, s) => [String(s + 1), String(c.block), c.dirty ? { text: 'dirty', cls: 'bad' } : 'clean']) })),
        metrics: runs.flatMap((x) => { const st = x.pre[k].stats; return [{ label: MODE[x.write] + ': hits and misses', value: st.hits + ' / ' + st.misses, note: 'hit ratio ' + st.hitRatio }, { label: MODE[x.write] + ': disk reads', value: st.diskReads, note: st.prefetches ? st.prefetches + ' of them read ahead' : '' }, { label: MODE[x.write] + ': disk writes', value: st.diskWrites, cls: modes.length > 1 && st.diskWrites === Math.max(...runs.map((y) => y.pre[k].stats.diskWrites)) && runs.some((y) => y.pre[k].stats.diskWrites !== st.diskWrites) ? 'bad' : '' }]; }) };
    });
    const trace = [];
    runs.forEach((x) => full[runs.indexOf(x)].steps.forEach((s) => trace.push({ kind: s.kind, block: s.block, say: (runs.length > 1 ? MODE[x.write] + ': ' : '') + s.say })));
    const last = frames[frames.length - 1];
    frames.forEach((f, k) => { const n = runs[0].pre[k].steps.length; f.at = Math.max(0, n - 1); });
    return { frames, trace, tables: last.tables, metrics: last.metrics, cache: runs.map((x, i) => ({ write: x.write, r: full[i], pre: x.pre })), outcome };
  }

  // ---- the limits and the dispatch -------------------------------------------------------------------------------
  SL.ksCheck = function (v) {
    if (v.ioView === 'buffer') {
      if (!SL.bufKinds(v).length) return 'Buffering: turn on at least one kind';
      return null;
    }
    if (v.ioView === 'cache') {
      for (const w of v.cOps) if (!/^([rw]\d{1,4}|sync)$/i.test(w)) return 'Operations: "' + w + '" should be r12 (read block 12), w12 (write it) or sync';
      return null;
    }
    if (v.ioView === 'spool') return SL.spoolCheck ? SL.spoolCheck(v) : null;
    if (v.ioView === 'queue') return SL.queueCheck ? SL.queueCheck(v) : null;
    return null;
  };
  SL.ksRun = function (v, ctx) {
    if (v.ioView === 'buffer') return bufferRun(v, ctx);
    if (v.ioView === 'cache') return cacheRun(v, ctx);
    if (v.ioView === 'spool') return SL.spoolRun(v, ctx);
    return SL.queueRun(v, ctx);
  };
  SL.KS_VIEWS = ['buffer', 'cache', 'spool', 'queue'];
})(globalThis.Proses = globalThis.Proses || {});
