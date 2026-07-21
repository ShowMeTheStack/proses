// A block-level file system, part 3: the allocation methods, all behind one interface so every operation works
// on each of them. F.amap[g.alloc] = {
//   bmap(tx, n, fb, ino, kind)   the block holding file block fb, allocating it (and, for the sequential methods,
//                                every block before it) when kind is given; 0 for none. Changes n in place.
//   blocks(g, n, read)           every block the inode owns: [{block, kind: 'data'|'indirect', fb, depth}]
//   truncate(tx, n, keep)        free every block from file block keep on
//   count(g, n)                  how many data blocks are mapped (the sequential methods)
// }
// indexed: direct and indirect pointers. contiguous: one run that moves (copied whole) when it cannot grow in place,
// and fails with EFRAG when no run is long enough though enough blocks are free (external fragmentation; F.ops
// .compact slides every file down). linked: a chain through the blocks themselves. fat: a chain through the file
// allocation table. extent: up to F.nExtents(g) runs of (start, length).
// Also F.fatTable(img) (every FAT entry, to draw), F.locate(g, fb) for the indexed walk, F.freeRuns(tx) and F.freeSpace(img, method) comparing free-space
// representations (bitmap, free list, grouping, counting).
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const LEVEL = ['direct', 'single', 'double', 'triple'];
  F.LEVEL = LEVEL;
  const A = (F.amap = {});

  /** where file block fb is mapped in an indexed inode: {level, slot} or {level, rel, idx: [..]}; null beyond */
  F.locate = function (g, fb) {
    const P = g.P || g.bs / g.ps, L = g.levels === undefined ? 3 : g.levels;
    if (fb < g.ndirect) return { level: 0, slot: fb, idx: [] };
    let r = fb - g.ndirect, span = 1;
    for (let lv = 1; lv <= L; lv++) {
      span *= P;
      if (r < span) { const idx = []; let x = r; for (let d = 0; d < lv; d++) { idx.unshift(x % P); x = Math.floor(x / P); } return { level: lv, rel: r, idx }; }
      r -= span;
    }
    return null;
  };

  // ---- indexed ----
  A.indexed = {
    bmap(tx, n, fb, ino, kind) {
      const g = tx.g, loc = F.locate(g, fb);
      if (!loc) throw new Error('file block ' + fb + ' is beyond the largest file');
      const goal = () => F.goal(tx, ino, fb, fb > 0 && fb <= g.ndirect ? n.direct[fb - 1] : 0);
      if (loc.level === 0) {
        if (!n.direct[loc.slot] && kind) n.direct[loc.slot] = F.allocBlock(tx, kind, goal());
        return n.direct[loc.slot];
      }
      const top = LEVEL[loc.level];
      if (!n[top]) { if (!kind) return 0; n[top] = F.allocBlock(tx, 'indirect', goal()); }
      let b = n[top];
      for (let d = 0; d < loc.idx.length; d++) {
        const off = loc.idx[d] * g.ps, last = d === loc.idx.length - 1;
        let p = F.getPtr(tx.get(b), off, g.ps);
        if (!p) {
          if (!kind) return 0;
          p = F.allocBlock(tx, last ? kind : 'indirect', last ? F.goal(tx, ino, fb, b) : b + 1);
          F.putPtr(tx.get(b), off, g.ps, p); tx.dirty(b, 'indirect');
        }
        b = p;
      }
      return b;
    },
    blocks(g, n, read) {
      const out = [], P = g.bs / g.ps, L = g.levels === undefined ? 3 : g.levels;
      n.direct.forEach((b, i) => { if (b) out.push({ block: b, kind: 'data', fb: i }); });
      const walk = (b, depth, base) => {
        out.push({ block: b, kind: 'indirect', depth });
        const u = read(b), span = Math.pow(P, depth - 1);
        for (let i = 0; i < P; i++) {
          const p = F.getPtr(u, i * g.ps, g.ps);
          if (!p) continue;
          if (depth === 1) out.push({ block: p, kind: 'data', fb: base + i });
          else walk(p, depth - 1, base + i * span);
        }
      };
      let base = g.ndirect;
      for (let d = 1; d <= L; d++) { const k = LEVEL[d]; if (n[k]) walk(n[k], d, base); base += Math.pow(P, d); }
      return out;
    },
    truncate(tx, n, keep) {
      const g = tx.g, P = g.bs / g.ps, L = g.levels === undefined ? 3 : g.levels;
      n.direct.forEach((b, i) => { if (b && i >= keep) { F.freeBlock(tx, b); n.direct[i] = 0; } });
      // returns true when the indirect block b ends up empty (and is freed)
      const cut = (b, depth, base) => {
        const span = Math.pow(P, depth - 1);
        let any = false, changed = false;
        for (let i = 0; i < P; i++) {
          const u = tx.get(b), p = F.getPtr(u, i * g.ps, g.ps);
          if (!p) continue;
          const lo = base + i * span;
          if (depth === 1 ? lo >= keep : lo + span <= keep ? false : cut(p, depth - 1, lo)) {
            if (depth === 1) F.freeBlock(tx, p);
            F.putPtr(tx.get(b), i * g.ps, g.ps, 0); changed = true;
          } else any = true;
        }
        if (!any) { F.freeBlock(tx, b); return true; }
        if (changed) tx.dirty(b, 'indirect');
        return false;
      };
      let base = g.ndirect;
      for (let d = 1; d <= L; d++) { const k = LEVEL[d]; if (n[k] && base + Math.pow(P, d) > keep && cut(n[k], d, base)) n[k] = 0; base += Math.pow(P, d); }
    },
  };

  // ---- the sequential methods share an append loop: blocks are mapped in order, holes filled with zeros ----
  function seq(M) {
    return Object.assign({
      bmap(tx, n, fb, ino, kind) {
        if (fb >= M.count(tx.g, n)) { if (!kind) return 0; while (M.count(tx.g, n) <= fb) M.append(tx, n, ino, kind); }
        return M.at(tx, n, fb);
      },
    }, M);
  }
  // contiguous: slot 0 start, slot 1 count
  A.contiguous = seq({
    count: (g, n) => F.slot(g, n, 1),
    at: (tx, n, fb) => F.slot(tx.g, n, 0) + fb,
    append(tx, n, ino, kind) {
      const g = tx.g, start = F.slot(g, n, 0), cnt = F.slot(g, n, 1), next = start + cnt;
      if (cnt && F.isData(g, next) && F.groupOfBlock(g, next) === F.groupOfBlock(g, start) && F.isFreeBlock(tx, next)) {
        F.allocBlock(tx, kind, next); F.setSlot(g, n, 1, cnt + 1); return;
      }
      const run = F.freeRuns(tx).find((r) => r.len >= cnt + 1);
      if (!run) {
        const free = F.countFree(tx);
        const e = new Error(`external fragmentation: ${F.count(free, 'block')} ${free === 1 ? 'is' : 'are'} free, but no run of ${cnt + 1} is`); e.code = 'EFRAG'; e.free = free; e.need = cnt + 1; throw e;
      }
      for (let k = 0; k <= cnt; k++) {
        const b = F.allocBlock(tx, kind, run.start + k);
        if (k < cnt) { tx.get(b).set(tx.get(start + k)); F.freeBlock(tx, start + k); tx.dirty(b, kind); }
      }
      if (cnt) tx.step('move', `The file cannot grow in place (block ${next} is taken): ${cnt === 1 ? 'its one block is copied from ' + start + ' to ' + run.start : 'its ' + cnt + ' blocks are copied from ' + start + '–' + (start + cnt - 1) + ' to ' + run.start + '–' + (run.start + cnt - 1)}, the first run of ${cnt + 1} free blocks.`, { from: start, to: run.start, count: cnt });
      F.setSlot(g, n, 0, run.start); F.setSlot(g, n, 1, cnt + 1);
    },
    blocks(g, n) { const out = [], s = F.slot(g, n, 0); for (let i = 0; i < F.slot(g, n, 1); i++) out.push({ block: s + i, kind: 'data', fb: i }); return out; },
    truncate(tx, n, keep) { const g = tx.g, s = F.slot(g, n, 0), c = F.slot(g, n, 1); for (let i = keep; i < c; i++) F.freeBlock(tx, s + i); if (keep < c) { F.setSlot(g, n, 1, keep); if (!keep) F.setSlot(g, n, 0, 0); } },
  });
  // linked: slot 0 first, 1 last, 2 count; the next pointer sits in the last ps bytes of each block
  const nextOf = (g, u) => F.getPtr(u, g.bs - g.ps, g.ps);
  A.linked = seq({
    count: (g, n) => F.slot(g, n, 2),
    at(tx, n, fb) { let b = F.slot(tx.g, n, 0); for (let i = 0; i < fb; i++) b = nextOf(tx.g, tx.get(b)); return b; },
    append(tx, n, ino, kind) {
      const g = tx.g, last = F.slot(g, n, 1), cnt = F.slot(g, n, 2), b = F.allocBlock(tx, kind, F.goal(tx, ino, cnt, last));
      if (cnt) { F.putPtr(tx.get(last), g.bs - g.ps, g.ps, b); if (!tx.kind.has(last)) tx.dirty(last, kind); } else F.setSlot(g, n, 0, b);
      F.setSlot(g, n, 1, b); F.setSlot(g, n, 2, cnt + 1);
    },
    blocks(g, n, read) { const out = []; let b = F.slot(g, n, 0); for (let i = 0; i < F.slot(g, n, 2) && b; i++) { out.push({ block: b, kind: 'data', fb: i }); b = nextOf(g, read(b)); } return out; },
    truncate(tx, n, keep) {
      const g = tx.g, own = A.linked.blocks(g, n, (b) => tx.get(b));
      if (keep >= own.length) return;
      own.slice(keep).forEach((o) => F.freeBlock(tx, o.block));
      if (keep) { const lb = own[keep - 1].block; F.putPtr(tx.get(lb), g.bs - g.ps, g.ps, 0); tx.dirty(lb, tx.kind.get(lb) || 'data'); F.setSlot(g, n, 1, lb); } else { F.setSlot(g, n, 0, 0); F.setSlot(g, n, 1, 0); }
      F.setSlot(g, n, 2, keep);
    },
  });
  // fat: slot 0 first, 1 last, 2 count; FAT[b] is the next block, EOC at the end
  const fatGet = (g, read, b) => { const l = F.fatLoc(g, b); return F.getPtr(read(l.block), l.off, g.ps); };
  const fatPut = (tx, b, v) => { const g = tx.g, l = F.fatLoc(g, b); F.putPtr(tx.get(l.block), l.off, g.ps, v); tx.dirty(l.block, 'fat'); };
  F.fatGet = fatGet;
  A.fat = seq({
    count: (g, n) => F.slot(g, n, 2),
    at(tx, n, fb) { let b = F.slot(tx.g, n, 0); for (let i = 0; i < fb; i++) b = fatGet(tx.g, (x) => tx.get(x), b); return b; },
    append(tx, n, ino, kind) {
      const g = tx.g, last = F.slot(g, n, 1), cnt = F.slot(g, n, 2), b = F.allocBlock(tx, kind, F.goal(tx, ino, cnt, last));
      if (cnt) fatPut(tx, last, b); else F.setSlot(g, n, 0, b);
      F.setSlot(g, n, 1, b); F.setSlot(g, n, 2, cnt + 1);
    },
    blocks(g, n, read) { const out = []; let b = F.slot(g, n, 0); for (let i = 0; i < F.slot(g, n, 2) && b && b !== g.EOC; i++) { out.push({ block: b, kind: 'data', fb: i }); b = fatGet(g, read, b); } return out; },
    truncate(tx, n, keep) {
      const g = tx.g, own = A.fat.blocks(g, n, (b) => tx.get(b));
      if (keep >= own.length) return;
      own.slice(keep).forEach((o) => F.freeBlock(tx, o.block));
      if (keep) { fatPut(tx, own[keep - 1].block, g.EOC); F.setSlot(g, n, 1, own[keep - 1].block); } else { F.setSlot(g, n, 0, 0); F.setSlot(g, n, 1, 0); }
      F.setSlot(g, n, 2, keep);
    },
  });
  // extent: pairs (start, length)
  const exts = (g, n) => { const out = []; for (let i = 0; i < F.nExtents(g); i++) { const s = F.slot(g, n, 2 * i), l = F.slot(g, n, 2 * i + 1); if (l) out.push({ start: s, len: l, i }); } return out; };
  F.extents = exts;
  A.extent = seq({
    count: (g, n) => exts(g, n).reduce((a, e) => a + e.len, 0),
    at(tx, n, fb) { for (const e of exts(tx.g, n)) { if (fb < e.len) return e.start + fb; fb -= e.len; } return 0; },
    append(tx, n, ino, kind) {
      const g = tx.g, list = exts(g, n), last = list[list.length - 1];
      if (last) {
        const next = last.start + last.len;
        if (F.isData(g, next) && F.groupOfBlock(g, next) === F.groupOfBlock(g, last.start) && F.isFreeBlock(tx, next)) { F.allocBlock(tx, kind, next); F.setSlot(g, n, 2 * last.i + 1, last.len + 1); return; }
      }
      const i = list.length;
      if (i >= F.nExtents(g)) { const e = new Error(`the inode has room for ${F.count(F.nExtents(g), 'extent')} and ${F.nExtents(g) === 1 ? 'it is' : 'all are'} used`); e.code = 'EXTENTS'; throw e; }
      const b = F.allocBlock(tx, kind, last ? last.start + last.len : F.goal(tx, ino, 0, 0));
      F.setSlot(g, n, 2 * i, b); F.setSlot(g, n, 2 * i + 1, 1);
    },
    blocks(g, n) { const out = []; let fb = 0; for (const e of exts(g, n)) for (let k = 0; k < e.len; k++) out.push({ block: e.start + k, kind: 'data', fb: fb++ }); return out; },
    truncate(tx, n, keep) {
      const g = tx.g;
      let fb = 0;
      for (const e of exts(g, n)) {
        const lo = fb; fb += e.len;
        if (fb <= keep) continue;
        const k0 = Math.max(0, keep - lo);
        for (let k = k0; k < e.len; k++) F.freeBlock(tx, e.start + k);
        F.setSlot(g, n, 2 * e.i + 1, k0); if (!k0) F.setSlot(g, n, 2 * e.i, 0);
      }
    },
  });
  A.indexed.count = (g, n) => A.indexed.blocks(g, n, () => new Uint8Array(g.bs)).filter((o) => o.kind === 'data').length;

  /** the FAT as a table to draw: [{block, next, state: 'free'|'end'|'next', owner}] for every data block */
  F.fatTable = function (img) {
    const g = img.g, read = (b) => F.readBlock(img, b), owner = new Map();
    for (let i = 1; i < g.ninodes; i++) { const n = F.readInode(img, i); if (n.type) for (const o of F.ownedBlocks(img, n)) owner.set(o.block, i); }
    return F.dataBlocks(g).map((b) => { const v = fatGet(g, read, b); return { block: b, next: v === g.EOC ? -1 : v, state: v === 0 ? 'free' : v === g.EOC ? 'end' : 'next', owner: owner.get(b) || 0 }; });
  };
  /** the file block's disk block, allocating with kind when given (the method of the image's geometry) */
  F.bmap = (tx, n, fb, kind, ino) => A[tx.g.alloc].bmap(tx, n, fb, ino || 0, kind);
  /** every block an inode owns */
  F.ownedBlocks = (img, n, read) => (n.type === F.T_FREE ? [] : A[img.g.alloc].blocks(img.g, n, read || ((b) => F.readBlock(img, b))));

  /** the runs of free data blocks, in disk order: [{start, len}] */
  F.freeRuns = function (tx) {
    const g = tx.g, runs = [];
    let cur = null;
    for (const b of F.dataBlocks(g)) {
      if (F.isFreeBlock(tx, b) && (!cur || (cur.start + cur.len === b && F.groupOfBlock(g, b) === F.groupOfBlock(g, cur.start)))) { if (cur) cur.len++; else runs.push((cur = { start: b, len: 1 })); }
      else if (F.isFreeBlock(tx, b)) runs.push((cur = { start: b, len: 1 }));
      else cur = null;
    }
    return runs;
  };

  /**
   * Free-space management compared, built from the image's free blocks:
   *   bitmap    one bit per data block; finding k free blocks reads the bitmap blocks
   *   list      each free block holds the number of the next; the head is in the superblock
   *   grouping  the first free block holds the numbers of up to P − 1 free blocks and of the next group block
   *   counting  (start, count) pairs, one per run of free blocks
   * {method, free, overhead: bytes of the structure (beyond the free blocks themselves for list/grouping),
   *  structure: what to draw, readsFor(k): disk reads to find k free blocks, say}
   */
  F.freeSpace = function (img, method) {
    const g = img.g, tx = new F.Tx(img), free = F.dataBlocks(g).filter((b) => F.isFreeBlock(tx, b)), P = g.bs / g.ps;
    const ceil = Math.ceil;
    if (method === 'bitmap') return { method, free: free.length, overhead: ceil(g.ndata / 8), structure: F.dataBlocks(g).map((b) => (free.includes(b) ? 0 : 1)), readsFor: (k) => Math.max(1, Math.min(g.dbmBlocks, ceil(k / (g.bs * 8)))), say: `A bitmap of ${g.ndata} bits (${F.count(ceil(g.ndata / 8), 'byte')}) marks the ${free.length === 1 ? 'one free block' : free.length + ' free blocks'}; finding free blocks reads the bitmap, which usually sits in memory.` };
    if (method === 'list') return { method, free: free.length, overhead: g.ps, structure: free, readsFor: (k) => Math.min(k, free.length), say: `A free list threads through the ${free.length === 1 ? 'one free block itself' : free.length + ' free blocks themselves'}: only the head pointer (${g.ps} bytes) is extra, but taking k blocks reads k blocks to follow the chain.` };
    if (method === 'grouping') { const groups = []; for (let i = 0; i < free.length; i += P) groups.push(free.slice(i, i + P)); return { method, free: free.length, overhead: g.ps, structure: groups, readsFor: (k) => ceil(Math.min(k, free.length) / (P - 1)), say: `Grouping stores up to ${P - 1} free block numbers in one free block, then the next group: ${groups.length} group block${groups.length === 1 ? '' : 's'} hold all ${free.length} free blocks, so one read yields ${P - 1} blocks.` }; }
    if (method === 'counting') { const runs = F.freeRuns(tx); return { method, free: free.length, overhead: runs.length * 2 * g.ps, structure: runs, readsFor: () => 1, say: `Counting keeps one (start, count) pair per run: ${runs.length} run${runs.length === 1 ? '' : 's'} describe the ${free.length} free blocks in ${runs.length * 2 * g.ps} bytes, best when free space comes in long runs.` }; }
    throw new Error('free-space method must be bitmap, list, grouping or counting');
  };
})(globalThis.Proses = globalThis.Proses || {});
