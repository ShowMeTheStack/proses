// Memory engines, part 8: kernel allocators. The buddy system (blocks of power-of-two sizes, split on the way down
// and coalesced with their buddies on the way up, the whole tree snapshotted at every step) and the slab allocator
// (caches of one object size, each a list of slabs that are full, partial or empty).
//   S.Mem.buddy({size, minBlock}) -> B        size and minBlock powers of two
//     B.alloc(id, bytes) -> step   B.free(id) -> step   B.tree() B.freeLists() B.allocated()
//     step: {kind: 'alloc' | 'free' | 'fail', id, request, blockSize, offset, splits: [{size, offset}],
//            merges: [{size, offset, buddy}], internal, tree, freeLists, say}
//     tree: {offset, size, state: 'free' | 'used' | 'split', id?, request?, children?: [low, high]}
//     freeLists: {size: [offsets]}; a request takes the smallest block size that holds it (lowest address first)
//   S.Mem.slab({caches: [{name, objSize}], slabBytes}) -> A
//     A.alloc(cache, id) -> step   A.free(id) -> step   A.shrink() -> step   A.snapshot()
//     step: {kind: 'alloc' | 'free' | 'grow' | 'shrink', cache, id, slab, slot, moved: 'empty>partial' ..,
//            snapshot, say}
//     snapshot: {caches: [{name, objSize, perSlab, slabs: [{id, objs: [id | null], list}], full, partial, empty}]}
//     An object goes into the first partial slab, else the first empty one, else a new slab (the cache grows).
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.buddy = function (o) {
    const size = o.size, min = o.minBlock || 1;
    if (M.log2(size) < 0 || M.log2(min) < 0 || min > size) throw new Error('sizes must be powers of two, the block no larger than memory');
    const free = new Map(), used = new Map(); // free: size -> Set of offsets; used: id -> {offset, size, request}
    for (let s = min; s <= size; s *= 2) free.set(s, new Set());
    free.get(size).add(0);
    const B = {};
    B.freeLists = () => { const out = {}; for (const [s, set] of free) out[s] = [...set].sort((a, b) => a - b); return out; };
    B.allocated = () => [...used].map(([id, u]) => Object.assign({ id }, u)).sort((a, b) => a.offset - b.offset);
    B.tree = function () {
      const at = new Map([...used].map(([id, u]) => [u.offset + ':' + u.size, Object.assign({ id }, u)]));
      const node = (offset, s) => {
        const u = at.get(offset + ':' + s);
        if (u) return { offset, size: s, state: 'used', id: u.id, request: u.request };
        if (free.get(s).has(offset)) return { offset, size: s, state: 'free' };
        if (s === min) return { offset, size: s, state: 'lost' };
        return { offset, size: s, state: 'split', children: [node(offset, s / 2), node(offset + s / 2, s / 2)] };
      };
      return node(0, size);
    };
    const snap = (st) => Object.assign(st, { tree: B.tree(), freeLists: B.freeLists() });
    B.alloc = function (id, bytes) {
      if (used.has(id)) throw new Error(id + ' is allocated already');
      let need = min;
      while (need < bytes) need *= 2;
      if (need > size) return snap({ kind: 'fail', id, request: bytes, say: id + ' asks for ' + M.count(bytes, 'byte') + ', more than the whole memory.' });
      let s = need;
      while (s <= size && !free.get(s).size) s *= 2;
      if (s > size) return snap({ kind: 'fail', id, request: bytes, blockSize: need, say: id + ' needs a block of ' + need + ' and no free block of that size or larger exists.' });
      let offset = Math.min(...free.get(s));
      free.get(s).delete(offset);
      const splits = [];
      while (s > need) {
        s /= 2;
        free.get(s).add(offset + s);
        splits.push({ size: s * 2, offset, halves: [offset, offset + s] });
      }
      used.set(id, { offset, size: need, request: bytes });
      return snap({ kind: 'alloc', id, request: bytes, blockSize: need, offset, splits, merges: [], internal: need - bytes, say: id + ' asks for ' + M.count(bytes, 'byte') + ', so a block of ' + need + ': ' + (splits.length ? 'the block of ' + splits[0].size + ' at ' + splits[0].offset + ' splits ' + splits.length + ' time' + (splits.length > 1 ? 's' : '') + ', each upper half going on a free list, and ' : '') + 'it takes ' + need + ' at ' + offset + (need > bytes ? ', ' + M.count((need - bytes), 'byte') + ' of it wasted inside.' : '.') });
    };
    B.free = function (id) {
      const u = used.get(id);
      if (!u) throw new Error(id + ' is not allocated');
      used.delete(id);
      let offset = u.offset, s = u.size;
      const merges = [];
      while (s < size) {
        const buddy = offset ^ s;
        if (!free.get(s).has(buddy)) break;
        free.get(s).delete(buddy);
        merges.push({ size: s, offset: Math.min(offset, buddy), buddy });
        offset = Math.min(offset, buddy);
        s *= 2;
      }
      free.get(s).add(offset);
      return snap({ kind: 'free', id, request: u.request, blockSize: u.size, offset: u.offset, splits: [], merges, say: id + ' frees ' + u.size + ' at ' + u.offset + (merges.length ? '; ' + merges.map((m) => 'its buddy at ' + m.buddy + ' is free, so they join into ' + 2 * m.size + ' at ' + m.offset).join('; ') + '.' : '; its buddy at ' + (u.offset ^ u.size) + ' is in use, so it stays a block of ' + u.size + '.') });
    };
    return B;
  };

  M.slab = function (o) {
    const slabBytes = o.slabBytes || 4096, caches = new Map(), where = new Map();
    let nextSlab = 0;
    for (const c of o.caches) caches.set(c.name, { name: c.name, objSize: c.objSize, perSlab: Math.floor(slabBytes / c.objSize), slabs: [] });
    const listOf = (c, sl) => { const n = sl.objs.filter((x) => x !== null).length; return n === 0 ? 'empty' : n === c.perSlab ? 'full' : 'partial'; };
    const A = {};
    A.snapshot = () => ({ caches: [...caches.values()].map((c) => {
      const slabs = c.slabs.map((sl) => ({ id: sl.id, objs: sl.objs.slice(), list: listOf(c, sl) }));
      return { name: c.name, objSize: c.objSize, perSlab: c.perSlab, slabs, full: slabs.filter((s) => s.list === 'full').map((s) => s.id), partial: slabs.filter((s) => s.list === 'partial').map((s) => s.id), empty: slabs.filter((s) => s.list === 'empty').map((s) => s.id) };
    }) });
    const snap = (st) => Object.assign(st, { snapshot: A.snapshot() });
    A.alloc = function (name, id) {
      const c = caches.get(name);
      if (!c) throw new Error('no cache ' + name);
      if (where.has(id)) throw new Error(id + ' is allocated already');
      let sl = c.slabs.find((s) => listOf(c, s) === 'partial'), from = 'partial', grew = false;
      if (!sl) { sl = c.slabs.find((s) => listOf(c, s) === 'empty'); from = 'empty'; }
      if (!sl) { sl = { id: nextSlab++, objs: Array(c.perSlab).fill(null) }; c.slabs.push(sl); grew = true; }
      const slot = sl.objs.indexOf(null);
      sl.objs[slot] = id;
      where.set(id, { c, sl, slot });
      const to = listOf(c, sl);
      return snap({ kind: grew ? 'grow' : 'alloc', cache: name, id, slab: sl.id, slot, moved: from === to ? '' : from + '>' + to, say: (grew ? 'Cache ' + name + ' has no free object, so it grows by a slab of ' + M.count(slabBytes, 'byte') + ' (' + c.perSlab + ' objects of ' + c.objSize + '); ' : 'Cache ' + name + ' takes ' + (from === 'partial' ? 'a partial' : 'an empty') + ' slab, ' + sl.id + '; ') + id + ' gets object ' + slot + (from !== to ? ', and the slab is now ' + to + '.' : '.') });
    };
    A.free = function (id) {
      const w = where.get(id);
      if (!w) throw new Error(id + ' is not allocated');
      const before = listOf(w.c, w.sl);
      w.sl.objs[w.slot] = null;
      where.delete(id);
      const after = listOf(w.c, w.sl);
      return snap({ kind: 'free', cache: w.c.name, id, slab: w.sl.id, slot: w.slot, moved: before === after ? '' : before + '>' + after, say: id + ' goes back to object ' + w.slot + ' of slab ' + w.sl.id + ' in cache ' + w.c.name + (before !== after ? '; the slab moves from the ' + before + ' list to the ' + after + ' list.' : '.') + ' The memory stays with the cache, ready for the next object of its kind.' });
    };
    A.shrink = function () {
      const gone = [];
      for (const c of caches.values()) c.slabs = c.slabs.filter((s) => { if (listOf(c, s) === 'empty') { gone.push(s.id); return false; } return true; });
      return snap({ kind: 'shrink', freed: gone, say: gone.length ? 'Memory is short: the empty slabs ' + gone.join(', ') + ' go back to the page allocator.' : 'No slab is empty, so nothing can go back.' });
    };
    return A;
  };

  (S.engines = S.engines || []).push({ name: 'Kernel allocators' });
})(globalThis.Proses = globalThis.Proses || {});
