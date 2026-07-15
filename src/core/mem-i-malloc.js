// Memory engines, part 9: a malloc heap. Blocks carry boundary tags, a header and a footer word each holding the
// block's size and whether it is allocated; a free block can be split, and a freed block coalesces at once with a
// free neighbour on either side (the next block's header and the previous block's footer say whether they are free).
//   S.Mem.malloc({heap, policy: 'first' | 'next' | 'best' | 'segregated', align, tag, minBlock, classes}) -> H
//     H.malloc(id, bytes) -> step   H.free(id) -> step   H.blocks() H.freeLists() H.stats()
//     step: {kind: 'malloc' | 'free' | 'fail', id, request, size, start, searched: [starts], split, merges,
//            blocks, freeLists, say}
//     blocks [{start, size, free, id, request}] tile the heap in address order; a block's size includes its two
//     tags (tag bytes each, 4 by default) and is a multiple of align (8); the smallest block is minBlock (16).
//     A request needs align-up(bytes + 2·tag); a block left over by a split must be at least minBlock, else the
//     whole block is given (the slack is internal fragmentation).
//     first: the lowest-address free block that fits; next: the same, starting where the last search stopped and
//     wrapping; best: the smallest that fits (ties the lowest address); segregated: one free list a size class
//     (classes, default [16, 32, 64, 128, 256], each holding sizes up to the next), searched from the request's
//     class upwards, first fit within a class.
//     stats: {used, free, largest, payload, internal, external}
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.malloc = function (o) {
    const heap = o.heap || 256, align = o.align || 8, tag = o.tag === undefined ? 4 : o.tag, minB = o.minBlock || 16, policy = o.policy || 'first';
    const classes = o.classes || [16, 32, 64, 128, 256];
    if (heap % align) throw new Error('the heap must be a multiple of the alignment');
    let blocks = [{ start: 0, size: heap, free: true, id: null, request: 0 }], rover = 0;
    const H = {};
    const up = (n) => Math.ceil(n / align) * align;
    const classOf = (size) => { let k = 0; while (k + 1 < classes.length && size >= classes[k + 1]) k++; return k; };
    H.blocks = () => blocks.map((b) => Object.assign({}, b));
    H.freeLists = function () {
      const fr = blocks.filter((b) => b.free).map((b) => b.start);
      if (policy !== 'segregated') return { all: fr };
      const out = {};
      classes.forEach((c, k) => { out[c] = blocks.filter((b) => b.free && classOf(b.size) === k).map((b) => b.start); });
      return out;
    };
    H.stats = function () {
      const fr = blocks.filter((b) => b.free), us = blocks.filter((b) => !b.free);
      const free = fr.reduce((a, b) => a + b.size, 0), largest = fr.reduce((a, b) => Math.max(a, b.size), 0), payload = us.reduce((a, b) => a + b.request, 0), used = heap - free;
      return { used, free, largest, payload, internal: used - payload, external: free ? 1 - largest / free : 0 };
    };
    const snap = (st) => Object.assign(st, { blocks: H.blocks(), freeLists: H.freeLists() });
    const find = function (need) {
      const fr = blocks.filter((b) => b.free);
      const searched = [];
      const scan = (list) => { for (const b of list) { searched.push(b.start); if (b.size >= need) return b; } return null; };
      let b = null;
      if (policy === 'first') b = scan(fr);
      else if (policy === 'next') { const k = fr.findIndex((x) => x.start + x.size > rover); b = scan(k < 0 ? fr : fr.slice(k).concat(fr.slice(0, k))); }
      else if (policy === 'best') { for (const x of fr) { searched.push(x.start); if (x.size >= need && (!b || x.size < b.size)) b = x; } }
      else { for (let k = classOf(need); k < classes.length && !b; k++) b = scan(fr.filter((x) => classOf(x.size) === k)); }
      return { b, searched };
    };
    const why = { first: 'the first free block that fits', next: 'the next free block that fits after the last search', best: 'the smallest free block that fits', segregated: 'the first fit in the lowest size class with room' };
    H.malloc = function (id, bytes) {
      if (blocks.some((b) => b.id === id)) throw new Error(id + ' is allocated already');
      const need = Math.max(minB, up(bytes + 2 * tag));
      const { b, searched } = find(need);
      if (!b) { const s = H.stats(); return snap({ kind: 'fail', id, request: bytes, size: need, searched, say: 'malloc(' + bytes + ') for ' + id + ' needs a block of ' + need + ' and none is free' + (s.free >= need ? ', though ' + M.count(s.free, 'byte') + ' are free in pieces: external fragmentation.' : '.') }); }
      const k = blocks.indexOf(b), rest = b.size - need, split = rest >= minB;
      if (split) blocks.splice(k + 1, 0, { start: b.start + need, size: rest, free: true, id: null, request: 0 });
      Object.assign(b, { size: split ? need : b.size, free: false, id, request: bytes });
      rover = b.start + b.size;
      return snap({ kind: 'malloc', id, request: bytes, size: b.size, start: b.start, searched, split, say: 'malloc(' + bytes + ') for ' + id + ': ' + bytes + ' + ' + M.count(2 * tag, 'byte') + ' of tags, rounded to ' + need + '; ' + why[policy] + ' is at ' + b.start + (split ? ', split into ' + need + ' used and ' + rest + ' free.' : rest ? ', and the ' + rest + ' left over is too small to split, so it goes too.' : ', an exact fit.') + ' The payload starts at ' + (b.start + tag) + '.' });
    };
    H.free = function (id) {
      let k = blocks.findIndex((b) => b.id === id);
      if (k < 0) throw new Error(id + ' is not allocated');
      const b = blocks[k], merges = [];
      b.free = true; b.id = null; const req = b.request; b.request = 0;
      const next = blocks[k + 1], prev = blocks[k - 1];
      if (next && next.free) { b.size += next.size; blocks.splice(k + 1, 1); merges.push({ side: 'next', start: next.start }); }
      if (prev && prev.free) { prev.size += b.size; blocks.splice(k, 1); merges.push({ side: 'prev', start: prev.start }); k--; }
      const m = blocks[k];
      if (rover > m.start && rover < m.start + m.size) rover = m.start;
      const said = merges.map((x) => (x.side === 'next' ? 'the next block’s header says it is free, so they merge' : 'the previous block’s footer, just below, says it is free, so they merge'));
      return snap({ kind: 'free', id, request: req, start: m.start, size: m.size, merges, say: 'free(' + id + ') at ' + (merges.some((x) => x.side === 'prev') ? b.start : m.start) + ': ' + (said.length ? said.join('; and ') + ', giving one free block of ' + m.size + ' at ' + m.start + '.' : 'both neighbours are in use, so it stays a free block of ' + m.size + '.') });
    };
    return H;
  };

  (S.engines = S.engines || []).push({ name: 'malloc' });
})(globalThis.Proses = globalThis.Proses || {});
