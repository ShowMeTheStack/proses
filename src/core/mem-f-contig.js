// Memory engines, part 6: address binding with base and bounds, and contiguous allocation.
//   S.Mem.baseBounds({base, limit}, addr) -> {ok, pa, steps}   the MMU: the logical address is checked against the
//     limit (bounds) register, then the base (relocation) register is added; past the limit a protection fault
//   S.Mem.contig({memory, osSize, policy: 'first' | 'best' | 'worst' | 'next', compact: 'never' | 'on-fail'}) -> A
//     A.alloc(id, size) -> step   A.free(id) -> step   A.compact() -> step   A.holes() A.blocks() A.frag()
//     step: {kind: 'alloc' | 'free' | 'fail' | 'compact', id, size, start, hole, holes, blocks, frag, moved, say}
//     holes [{start, size}] and blocks [{id, start, size}] by address; frag {free, largest, holes, external}
//     where external = 1 − largest / free (0 with nothing free). An allocation takes the bottom of its hole; next
//     fit searches from where the last allocation ended (the first fitting hole ending above it), wrapping round. Freeing merges with the holes beside it.
//   S.Mem.runContig(opts, ops: [{op: 'alloc', id, size} | {op: 'free', id} | {op: 'compact'}]) -> {steps, ...A}
//   S.Mem.compactBlocks(blocks, base) -> {blocks, moved: [{id, from, to, size}], bytesMoved}   slides every block
//     down in address order, so all the free space becomes one hole at the top
//   S.Mem.fiftyPercent({policy, memory, meanSize, ops, seed, warm}) -> {avgBlocks, avgHoles, ratio, unusable}
//     random allocations (sizes uniform in [1, 2·mean)) until one fails, then a random block is freed; averaged
//     over the steady state, the holes come to about half the blocks
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.baseBounds = function (reg, addr) {
    const steps = [];
    steps.push({ kind: 'compare', addr, limit: reg.limit, say: 'The logical address ' + addr + ' is compared with the limit register, ' + reg.limit + '.' });
    if (addr < 0 || addr >= reg.limit) {
      steps.push({ kind: 'fault', addr, say: addr + ' is not below ' + reg.limit + ': the MMU traps to the kernel with a protection fault, and memory is never touched.' });
      return { ok: false, pa: -1, steps };
    }
    const pa = reg.base + addr;
    steps.push({ kind: 'relocate', addr, base: reg.base, pa, say: addr + ' < ' + reg.limit + ', so the base register is added: ' + reg.base + ' + ' + addr + ' = physical address ' + pa + '.' });
    return { ok: true, pa, steps };
  };

  M.compactBlocks = function (blocks, base) {
    let at = base || 0, bytesMoved = 0;
    const moved = [], out = [];
    for (const b of blocks.slice().sort((x, y) => x.start - y.start)) {
      if (b.start !== at) { moved.push({ id: b.id, from: b.start, to: at, size: b.size }); bytesMoved += b.size; }
      out.push({ id: b.id, start: at, size: b.size });
      at += b.size;
    }
    return { blocks: out, moved, bytesMoved };
  };

  M.contig = function (o) {
    const memory = o.memory, base = o.osSize || 0, policy = o.policy || 'first';
    let blocks = [], rover = base;
    const A = {};
    A.blocks = () => blocks.map((b) => Object.assign({}, b));
    A.holes = function () {
      const hs = [];
      let at = base;
      for (const b of blocks) { if (b.start > at) hs.push({ start: at, size: b.start - at }); at = b.start + b.size; }
      if (memory > at) hs.push({ start: at, size: memory - at });
      return hs;
    };
    A.frag = function () {
      const hs = A.holes(), free = hs.reduce((a, h) => a + h.size, 0), largest = hs.reduce((a, h) => Math.max(a, h.size), 0);
      return { free, largest, holes: hs.length, external: free ? 1 - largest / free : 0 };
    };
    const snap = (st) => Object.assign(st, { holes: A.holes(), blocks: A.blocks(), frag: A.frag() });
    const pick = function (size) {
      const hs = A.holes().filter((h) => h.size >= size);
      if (!hs.length) return null;
      if (policy === 'first') return hs[0];
      if (policy === 'best') return hs.reduce((a, h) => (h.size < a.size ? h : a));
      if (policy === 'worst') return hs.reduce((a, h) => (h.size > a.size ? h : a));
      // next fit: the first hole big enough that ends above the rover (a hole the rover lies in counts), else wrap
      return hs.find((h) => h.start + h.size > rover) || hs[0];
    };
    const why = { first: 'the first hole big enough', best: 'the smallest hole big enough', worst: 'the largest hole', next: 'the first hole big enough after the last allocation' };
    A.compact = function () {
      const r = M.compactBlocks(blocks, base);
      blocks = r.blocks;
      rover = base;
      return snap({ kind: 'compact', moved: r.moved, bytesMoved: r.bytesMoved, say: r.moved.length ? 'Compaction slides ' + r.moved.map((m) => m.id + ' from ' + m.from + ' to ' + m.to).join(', ') + ': ' + M.count(r.bytesMoved, 'byte') + ' copied, and the free space is one hole.' : 'Compaction finds nothing to move.' });
    };
    A.alloc = function (id, size) {
      if (blocks.some((b) => b.id === id)) throw new Error(id + ' is allocated already');
      let h = pick(size), pre = null;
      if (!h && o.compact === 'on-fail' && A.frag().free >= size) { pre = A.compact(); h = pick(size); }
      if (!h) {
        const f = A.frag();
        return snap({ kind: 'fail', id, size, say: id + ' asks for ' + size + ' and no hole is that big' + (f.free >= size ? ', though ' + M.count(f.free, 'byte') + ' are free in ' + M.count(f.holes, 'hole') + ': external fragmentation.' : '; only ' + M.count(f.free, 'byte') + ' are free.') });
      }
      const all = A.holes();
      blocks.push({ id, start: h.start, size });
      blocks.sort((a, b) => a.start - b.start);
      rover = h.start + size;
      return snap({ kind: 'alloc', id, size, start: h.start, hole: Object.assign({}, h), candidates: all.filter((x) => x.size >= size).map((x) => x.start), compacted: pre, say: (pre ? pre.say + ' Then ' : '') + id + ' (' + size + ') goes at ' + h.start + ', the bottom of ' + why[policy] + ' (' + M.count(h.size, 'byte') + ' at ' + h.start + ')' + (h.size > size ? ', leaving a hole of ' + (h.size - size) + '.' : ', which it fills.') });
    };
    A.free = function (id) {
      const k = blocks.findIndex((b) => b.id === id);
      if (k < 0) throw new Error(id + ' is not allocated');
      const b = blocks[k];
      blocks.splice(k, 1);
      const h = A.holes().find((x) => x.start <= b.start && x.start + x.size >= b.start + b.size);
      const merged = h.size > b.size;
      return snap({ kind: 'free', id, size: b.size, start: b.start, hole: h, say: id + ' frees ' + M.count(b.size, 'byte') + ' at ' + b.start + (merged ? '; it merges with the free space beside it into one hole of ' + h.size + ' at ' + h.start + '.' : ', a hole of its own.') });
    };
    return A;
  };

  M.runContig = function (opts, ops) {
    const A = M.contig(opts), steps = [];
    for (const op of ops) steps.push(op.op === 'alloc' ? A.alloc(op.id, op.size) : op.op === 'free' ? A.free(op.id) : A.compact());
    return { steps, blocks: A.blocks(), holes: A.holes(), frag: A.frag(), failed: steps.filter((s) => s.kind === 'fail').length };
  };

  M.fiftyPercent = function (o) {
    const R = M.rng(o.seed === undefined ? 1 : o.seed), A = M.contig({ memory: o.memory || 100000, policy: o.policy || 'first' });
    const mean = o.meanSize || 1000, ops = o.ops || 4000, warm = o.warm === undefined ? Math.floor(ops / 4) : o.warm;
    let id = 0, nB = 0, nH = 0, free = 0, samples = 0;
    for (let k = 0; k < ops; k++) {
      const size = 1 + Math.floor(R() * (2 * mean - 1));
      const st = A.alloc('b' + id++, size);
      if (st.kind === 'fail') {
        const bs = A.blocks();
        if (bs.length) A.free(bs[Math.floor(R() * bs.length)].id);
      }
      if (k >= warm) { const f = A.frag(); nB += A.blocks().length; nH += f.holes; free += f.free; samples++; }
    }
    const avgBlocks = nB / samples, avgHoles = nH / samples;
    return { avgBlocks, avgHoles, ratio: avgHoles / avgBlocks, unusable: free / samples / (o.memory || 100000), say: 'Over ' + samples + ' steady-state steps: ' + avgBlocks.toFixed(1) + ' blocks and ' + avgHoles.toFixed(1) + ' holes on average, a ratio of ' + (avgHoles / avgBlocks).toFixed(2) + '.' };
  };

  (S.engines = S.engines || []).push({ name: 'Contiguous allocation' });
})(globalThis.Proses = globalThis.Proses || {});
