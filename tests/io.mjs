// I/O systems: polling, interrupt-driven and DMA transfers worked by hand and against closed formulas; blocking,
// non-blocking and asynchronous reads by hand, with timeline invariants and an independent formula on random
// settings; buffering against a separate recurrence; the buffer cache against an independent LRU; spooling and the
// block-layer queue by hand; and the life of a read through the layers.
import { load, harness, rng } from './load.mjs';

const t = harness('io');
const S = load(['core']);
const IO = S.IO;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const lanesOk = (L) => L.every((s, i) => s.to >= s.from && (!i || s.from >= L[i - 1].to - 1e-9));

// ---- polling, interrupts and DMA ----
{
  const p = IO.transfer('polling', { bytes: 8 }), i = IO.transfer('interrupt', { bytes: 8 }), d = IO.transfer('dma', { bytes: 8 });
  // 2 units; polling: 1 cmd + 21 polls of 0.5 (the device takes 10) + 0.5 copy = 12 a unit
  t.eq([p.totals.time, p.totals.cpuBusy, p.totals.polls, p.totals.cpuShare], [24, 24, 42, 1], 'polling 8 bytes: 24 µs, all of it busy');
  // interrupt: 1 + (10 + 4 + 0.5) + 1 + (10 + 4 + 0.5) = 31; busy 11
  t.eq([i.totals.time, i.totals.cpuBusy, i.totals.cpuFree, i.totals.interrupts], [31, 11, 20, 2], 'interrupts: 31 µs, CPU free 20');
  // DMA: 5 setup + 1 cmd + 2 × 10 device + 0.2 bus + 4 irq = 30.2; busy 10
  t.eq([d.totals.time, d.totals.cpuBusy, d.totals.interrupts, d.totals.busBusy], [30.2, 10, 1, 0.4], 'DMA: 30.2 µs, one interrupt');
  t.eq(i.lanes.cpu.map((s) => s.kind), ['cmd', 'free', 'irq', 'copy', 'cmd', 'free', 'irq', 'copy'], 'the interrupt-driven CPU lane');
  const r = rng(7); let ok = 0, inv = 0;
  for (let k = 0; k < 300; k++) {
    const o = { bytes: 1 + Math.floor(r() * 600), unit: [1, 2, 4, 8][k % 4], device: 1 + Math.floor(r() * 20), cmd: 0.5 + Math.floor(r() * 4) / 2, poll: [0.25, 0.5, 1][k % 3], copy: 0.25 + Math.floor(r() * 4) / 4, irq: 1 + Math.floor(r() * 6), dmaSetup: 2 + Math.floor(r() * 6), dmaBlock: [0, 16, 64, 100][k % 4], bus: 0.1 };
    const u = Math.ceil(o.bytes / o.unit), per = Math.max(1, Math.ceil((o.dmaBlock || o.bytes) / o.unit)), nb = Math.ceil(u / per), np = Math.ceil(o.device / o.poll - 1e-9) + 1;
    const want = { polling: u * (o.cmd + np * o.poll + o.copy), interrupt: o.cmd + u * (o.device + o.irq + o.copy) + (u - 1) * o.cmd, dma: nb * (o.dmaSetup + o.cmd + o.irq + o.bus) + u * o.device };
    const busy = { polling: want.polling, interrupt: u * (o.cmd + o.irq + o.copy), dma: nb * (o.dmaSetup + o.cmd + o.irq) };
    for (const m of IO.transferModes) {
      const x = IO.transfer(m, o);
      if (near(x.totals.time, want[m], 1e-3) && near(x.totals.cpuBusy, busy[m], 1e-3) && near(x.totals.cpuBusy + x.totals.cpuFree, x.totals.time, 1e-3)) ok++;
      if (lanesOk(x.lanes.cpu) && lanesOk(x.lanes.device) && x.totals.interrupts === (m === 'polling' ? 0 : m === 'interrupt' ? u : nb)) inv++;
    }
  }
  t.eq([ok, inv], [900, 900], 'transfer times and CPU busy time equal the closed formulas; lanes never overlap');
  const big = IO.transfer('polling', { bytes: 100000, unit: 1 });
  t.ok(big.truncated && big.lanes.cpu.length === 3000 && big.totals.units === 100000, 'long transfers keep exact totals with a capped timeline');
  const cmp = IO.compare({ bytes: 4096, unit: 4, dmaBlock: 4096 });
  t.ok(cmp.polling.cpuShare === 1 && cmp.interrupt.cpuShare > cmp.dma.cpuShare && cmp.dma.interrupts === 1, 'DMA frees the CPU the most');
  // one byte through TX, CMD and STAT: read STAT, load TX, set GO; the controller drops DONE, sends, raises DONE;
  // the CPU polls DONE and clears GO
  const hs = IO.handshake(0x5a);
  t.eq(hs.steps.map((x) => x.who + ' ' + x.reg + ' ' + x.op), ['cpu STAT read', 'cpu TX write', 'cpu CMD write', 'ctl STAT act', 'ctl device act', 'ctl STAT act', 'cpu STAT read', 'cpu CMD write'], 'the handshake steps');
  t.eq(hs.steps.map((x) => x.regs.DONE).join(''), '11100111', 'DONE: 1 while idle, dropped by the controller, raised again');
  t.eq(hs.steps.map((x) => x.regs.GO).join(''), '00111110', 'GO: set by the CPU, cleared by the CPU at the end');
  t.eq([hs.byte, hs.hex, hs.steps[1].regs.TX, hs.cpuReads, hs.cpuWrites, hs.ctlActs, hs.steps.map((x) => x.k).join('')], [0x5a, '0x5a', 0x5a, 2, 3, 3, '01234567'], 'TX holds the byte; 2 reads, 3 writes, 3 controller actions');
  t.eq(IO.handshake(0x41, { TX: 0x5a }).steps[0].regs.TX, 0x5a, 'start: the registers carried over from the last byte');
  t.ok(hs.steps.every((x) => x.say && !/host|busy bit|command-ready|data-out/i.test(x.say)), 'narrated in our own terms');
}

// ---- blocking, non-blocking, asynchronous ----
const checkModes = (m, o, at) => {
  const a = Object.assign({}, IO.modeDefaults, o);
  const cpu = m.lanes.cpu;
  const covers = cpu.every((s, i) => !i || near(s.from, cpu[i - 1].to)) && near(cpu[0].from, 0) && near(cpu[cpu.length - 1].to, m.end);
  const busyA = m.lanes.A.filter((s) => s.state === 'user').reduce((n, s) => n + s.to - s.from, 0);
  const userWant = a.work + a.use + (m.kind === 'async' ? a.notify : 0);
  const okB = near(m.cpu.B, a.other) && near(m.lanes.device.reduce((n, s) => n + s.to - s.from, 0), a.device);
  t.ok(covers && near(busyA, userWant) && okB && lanesOk(m.lanes.A) && lanesOk(m.lanes.B), `${at} ${m.kind}: the CPU lane is continuous, A's user time is work + use, B gets its time`);
  t.ok(m.steps.every((s) => s.say && !/undefined|NaN/.test(s.say)), `${at} ${m.kind}: narrated`);
};
{
  const M = IO.modes();
  t.eq([M.blocking.finishA, M.blocking.finishB, M.blocking.cpu.idle], [66, 76, 0], 'blocking: A at 2 + 30 + 1 + 3 + 20 + 10 = 66; B runs while A sleeps');
  t.eq([M.nonblocking.finishA, M.nonblocking.finishB, M.nonblocking.retries, M.nonblocking.syscalls], [48, 88, 5, 7], 'non-blocking: A at 48 after 5 fruitless retries; B waits for A');
  t.eq([M.async.finishA, M.async.finishB, M.async.syscalls], [48, 80, 2], 'asynchronous: A at 48, B at 80');
  t.eq(M.blocking.lanes.A.map((s) => s.state), ['kernel', 'blocked', 'kernel', 'user', 'user'], 'blocking: A\'s states');
  for (const k in M) checkModes(M[k], {}, 'defaults');
  const r = rng(31);
  for (let k = 0; k < 200; k++) {
    const o = { syscall: 1 + Math.floor(r() * 3), device: 5 + Math.floor(r() * 60), copy: 1 + Math.floor(r() * 4), work: Math.floor(r() * 50), use: 1 + Math.floor(r() * 15), slice: 1 + Math.floor(r() * 8), notify: 1 + Math.floor(r() * 3), other: Math.floor(r() * 80), irq: 1 + Math.floor(r() * 2) };
    const X = IO.modes(o);
    for (const m in X) checkModes(X[m], o, '#' + k);
    const s = o.syscall;
    t.ok(near(X.blocking.finishA, s + o.device + o.irq + o.copy + o.work + o.use), `#${k} blocking: A finishes at syscall + device + irq + copy + work + use`);
    const asyncWant = s + o.work + (o.device >= o.work ? s : 0) + Math.max(0, o.device - o.work - s) + o.irq + o.copy + o.notify + o.use;
    t.ok(near(X.async.finishA, asyncWant), `#${k} async: A finishes at ${asyncWant} (got ${X.async.finishA})`);
    t.ok(X.async.finishA <= X.blocking.finishA + s + o.notify + 1e-9 && (o.work < o.device || X.async.finishA < X.blocking.finishA), `#${k}: asynchronous I/O overlaps the work with the device`);
    const nb = X.nonblocking;
    t.ok(nb.syscalls === nb.retries + 2 && nb.finishA >= s + o.device + o.irq, `#${k} non-blocking: every call but the first and the last is a fruitless retry`);
  }
}

// ---- buffering ----
{
  const b = (kind, o) => IO.buffering(kind, Object.assign({ blocks: 6, fill: 10, move: 2, compute: 6 }, o || {}));
  t.eq([b('none').total, b('single').total, b('double').total, b('circular').total], [96, 78, 68, 68], 'T = 10, M = 2, C = 6: 96, 78 (12 a block), 68 (10 a block)');
  t.eq([b('none').perBlock, b('single').perBlock, b('double').perBlock], [16, 12, 10], 'steady-state cost per block');
  t.eq(b('double', { fill: 4 }).total, 52, 'process-bound double buffering: 4 + 6 × 8');
  const burst = { blocks: 16, fill: [2, 2, 2, 20, 2, 2, 2, 20], move: 1, compute: 5 };
  t.ok(IO.buffering('circular', Object.assign({ slots: 4 }, burst)).total < IO.buffering('double', burst).total, 'a circular buffer absorbs bursts better than two buffers');
  // an independent max-plus recurrence
  const rec = (k, n, T, M, C) => {
    const fe = [], me = []; let dev = 0, proc = 0;
    for (let i = 0; i < n; i++) {
      const Ti = T[i % T.length], Mi = M[i % M.length], Ci = C[i % C.length];
      if (!k) { proc = proc + Ti + Ci; continue; }
      fe[i] = Math.max(dev, i >= k ? me[i - k] : 0) + Ti; dev = fe[i];
      me[i] = Math.max(fe[i], proc) + Mi; proc = me[i] + Ci;
    }
    return proc;
  };
  const r = rng(13); let ok = 0;
  for (let k = 0; k < 200; k++) {
    const T = Array.from({ length: 1 + Math.floor(r() * 5) }, () => 1 + Math.floor(r() * 20)), M = [Math.floor(r() * 4)], C = Array.from({ length: 1 + Math.floor(r() * 3) }, () => 1 + Math.floor(r() * 15));
    const n = 1 + Math.floor(r() * 20), slots = 2 + Math.floor(r() * 5);
    const kinds = { none: 0, single: 1, double: 2, circular: slots };
    for (const kind in kinds) { const x = IO.buffering(kind, { blocks: n, fill: T, move: M, compute: C, slots }); if (near(x.total, rec(kinds[kind], n, T, M, C)) && lanesOk(x.lanes.device) && lanesOk(x.lanes.process)) ok++; }
  }
  t.eq(ok, 800, 'buffering totals equal an independent recurrence');
}

// ---- the buffer cache ----
{
  const ops = 'r1 r2 r3 r1 r4 w1 r5 r6 r2'.split(' ').map((s) => ({ op: s[0], block: +s.slice(1) }));
  const c = IO.cache({ size: 3, write: 'back' }, ops);
  t.eq([c.stats.hits, c.stats.misses, c.stats.diskReads, c.stats.diskWrites], [2, 7, 7, 1], 'write-back: the dirty block 1 is written when evicted');
  t.eq(c.steps.map((s) => s.kind).join(' '), 'miss miss miss hit evict miss hit evict miss evict miss flush miss', 'the cache steps');
  t.eq(c.contents.map((x) => x.block), [5, 6, 2], 'LRU order at the end');
  const wt = IO.cache({ size: 3, write: 'through' }, ops);
  t.eq([wt.stats.diskWrites, wt.steps.filter((s) => s.kind === 'flush').length], [1, 0], 'write-through writes at once and never flushes');
  const ra = IO.cache({ size: 4, readAhead: 1 }, 'r10 r11 r12 r13'.split(' ').map((s) => ({ op: 'r', block: +s.slice(1) })));
  t.eq([ra.stats.hits, ra.stats.misses, ra.stats.diskReads, ra.stats.prefetches], [2, 2, 4, 2], 'read-ahead turns a sequential reader\'s every other read into a hit');
  const sy = IO.cache({ size: 4 }, [{ op: 'w', block: 1 }, { op: 'w', block: 2 }, { op: 'sync' }, { op: 'sync' }]);
  t.eq([sy.stats.diskWrites, sy.steps[2].say.includes('2 dirty'), sy.steps[3].say], [2, true, 'sync: nothing is dirty.'], 'sync');
  const r = rng(3); let ok = 0;
  for (let k = 0; k < 200; k++) {
    const size = 1 + Math.floor(r() * 6), o = Array.from({ length: 60 }, () => (r() < 0.05 ? { op: 'sync' } : { op: r() < 0.3 ? 'w' : 'r', block: Math.floor(r() * 10) }));
    const lru = new Map(); let hits = 0, writes = 0, reads = 0;
    for (const x of o) {
      if (x.op === 'sync') { for (const [b, d] of lru) if (d) { writes++; lru.set(b, false); } continue; }
      if (lru.has(x.block)) { hits++; const d = lru.get(x.block); lru.delete(x.block); lru.set(x.block, d || x.op === 'w'); continue; }
      if (x.op === 'r') reads++;
      if (lru.size >= size) { const [b, d] = lru.entries().next().value; if (d) writes++; lru.delete(b); }
      lru.set(x.block, x.op === 'w');
    }
    const g = IO.cache({ size, write: 'back' }, o);
    if (g.stats.hits === hits && g.stats.diskWrites === writes && g.stats.diskReads === reads && g.contents.map((x) => x.block).join() === [...lru.keys()].join()) ok++;
  }
  t.eq(ok, 200, 'the cache equals an independent LRU on random workloads');
}

// ---- spooling and the block-layer queue ----
{
  const sp = IO.spool([{ proc: 'A', at: 0, pages: 5 }, { proc: 'B', at: 1, pages: 2 }, { proc: 'C', at: 2, pages: 3 }], { pageTime: 2, spoolTime: 0.2 });
  t.eq(sp.direct.jobs.map((j) => [j.start, j.end, j.delay]), [[0, 10, 10], [10, 14, 13], [14, 20, 18]], 'holding the printer: B and C wait for it');
  t.eq(sp.spooled.jobs.map((j) => [j.proc, j.spooled, j.start, j.end, j.delay]), [['A', 1, 1, 11, 1], ['B', 1.4, 11, 15, 0.4], ['C', 2.6, 15, 21, 0.6]], 'spooled: each process is free once its job is on disk');
  t.eq([sp.direct.meanDelay, sp.spooled.meanDelay], [13.667, 0.667], 'mean delay with and without a spool');
  const q = [{ sector: 100, count: 8 }, { sector: 108, count: 8 }, { sector: 20 }, { sector: 92, count: 8 }];
  const nq = IO.blockQueue(q, { start: 50 });
  t.eq([nq.dispatched.map((d) => [d.ids, d.sector, d.count]), nq.totals.merges], [[[[0, 1, 3], 92, 24], [[2], 20, 1]], 2], 'a back merge and a front merge make one request of 24 sectors');
  t.ok(nq.steps.some((s) => /back merge/.test(s.say)) && nq.steps.some((s) => /front merge/.test(s.say)), 'merges narrated');
  const rq = [{ sector: 10 }, { sector: 60 }, { sector: 70 }, { sector: 80 }, { sector: 90 }];
  const lk = IO.blockQueue(rq, { elevator: 'look', start: 50 }), dl = IO.blockQueue(rq, { elevator: 'deadline', start: 50, readExpire: 5 }), np = IO.blockQueue(rq, { elevator: 'noop', start: 50 });
  t.eq(lk.dispatched.map((d) => d.sector), [60, 70, 80, 90, 10], 'LOOK sweeps up, then down to 10');
  t.eq(dl.dispatched.map((d) => d.sector), [60, 70, 80, 10, 90], 'deadline: the read at 10 expires after 6.6 and jumps the queue');
  t.eq(np.dispatched.map((d) => d.sector), [10, 60, 70, 80, 90], 'noop: arrival order');
  const zz = [90, 10, 80, 20, 70].map((x) => ({ sector: x }));
  t.eq([IO.blockQueue(zz, { start: 50 }).totals.movement, IO.blockQueue(zz, { elevator: 'look', start: 50 }).totals.movement], [300, 120], 'on a zigzag queue the elevator moves the head 120 sectors against 300 for FIFO');
  t.ok(near(dl.dispatched[3].start, 3 * (2 + 0.1) + (10 + 10 + 10) * 0.01), 'dispatch time: base + sectors + seek');
}

// ---- the life of a read ----
{
  const ids = new Set(IO.layers.map((l) => l.id));
  const hit = IO.lifeOfRead({ cached: true, bytes: 4096 });
  t.ok(hit.misses.length === 0 && !hit.steps.some((s) => s.layer === 'controller') && hit.steps.every((s) => s.proc === 'running'), 'a cached read never sleeps');
  const c = IO.readCosts;
  t.ok(near(hit.total, c.libc + c.trap + c.vfs + c.lookup + 4 * c.copyKiB + c.ret), 'a cached read costs only software');
  const miss = IO.lifeOfRead({ bytes: 8192, offset: 4096, blocks: [700, 701, 702], disk: { rpm: 7200 } });
  t.eq(miss.blocks, [1, 2], 'the read covers file blocks 1 and 2');
  t.eq(miss.steps.map((s) => s.layer).join(' '), 'user libc syscall vfs cache fs block driver controller interrupt interrupt scheduler scheduler cache syscall user', 'a miss goes all the way down and back');
  t.eq(miss.steps.map((s) => s.proc).filter((p, i, a) => !i || p !== a[i - 1]), ['running', 'blocked', 'ready', 'running'], 'running, blocked, ready, running');
  const D = S.Storage.disk({ cylinders: 2000, heads: 4, spt: 200, rpm: 7200, settle: 1, knee: 200, kneeTime: 4, full: 12 });
  const x1 = S.Storage.access(D, { cyl: 0, t: 0 }, { lba: 701 * 8, count: 8 }), x2 = S.Storage.access(D, x1.state, { lba: 702 * 8, count: 8 });
  t.ok(near(miss.diskMs, Math.round((x1.total + x2.total) * 1000) / 1000), 'the disk time comes from the disk model');
  t.ok(miss.steps.every((s, i) => ids.has(s.layer) && (!i || near(s.t, miss.steps[i - 1].t + miss.steps[i - 1].dt, 1e-3))) && near(miss.total, miss.steps.reduce((n, s) => n + s.dt, 0), 1e-2), 'steps chain in time through known layers');
  t.ok(miss.steps.find((s) => s.layer === 'block').say.includes('contiguous'), 'contiguous blocks merge into one request');
  const part = IO.lifeOfRead({ bytes: 8192, cached: [true, false] });
  t.eq([part.misses, part.steps.find((s) => s.layer === 'cache').hits], [[1], [0]], 'a partly cached read fetches only the missing block');
  t.ok([hit, miss, part].every((r) => r.steps.every((s) => s.say && !/undefined|NaN/.test(s.say)) && r.say), 'every step narrated');
}
t.done();
