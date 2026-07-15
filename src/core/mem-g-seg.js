// Memory engines, part 7: segmentation. A segment table holds each segment's base, limit, growth direction and
// protection bits; a logical address (segment, offset) is checked against the limit and the protection, then
// relocated. With paging, each segment has its own page table and the offset is split into a page and an offset.
//   S.Mem.segSplit(addr, segBits, offBits) -> {seg, offset}       the top segBits name the segment
//   S.Mem.segTranslate(t, {seg, offset, access: 'r' | 'w' | 'x'}) -> {ok, pa, fault, steps}
//     t: {segs: [{name, base, limit, grow: 'up' | 'down', prot: 'rw' | 'rx' | 'r' ..}], offBits,
//         paging?: {pageBytes, tables: [[frame | null, ..] per segment]}}
//     A segment that grows up holds offsets [0, limit); one that grows down (a stack) holds the top of its range,
//     [2^offBits − limit, 2^offBits), and its byte at offset o is at base + o − (2^offBits − limit).
//     fault: 'segment' (no such segment), 'limit', 'protection' or 'page' (with paging, no frame for the page)
//     steps: {kind: 'lookup' | 'limit' | 'prot' | 'page' | 'relocate' | 'fault', say, ...}
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});
  const ACC = { r: 'read', w: 'write', x: 'execute' };

  M.segSplit = (addr, segBits, offBits) => ({ seg: Math.floor(addr / 2 ** offBits) % 2 ** segBits, offset: addr % 2 ** offBits });

  M.segTranslate = function (t, a) {
    const steps = [], segs = t.segs, max = 2 ** (t.offBits || 16), acc = a.access || 'r';
    const fail = (fault, say) => { steps.push({ kind: 'fault', fault, say }); return { ok: false, pa: -1, fault, steps }; };
    const s = segs[a.seg];
    if (!s) return fail('segment', 'Segment ' + a.seg + ' is not in the table (it has ' + M.count(segs.length, 'entry', 'entries') + '): a segmentation fault.');
    const down = s.grow === 'down';
    steps.push({ kind: 'lookup', seg: a.seg, entry: Object.assign({}, s), say: 'Segment ' + a.seg + ' (' + s.name + '): base ' + s.base + ', limit ' + s.limit + ', grows ' + (down ? 'down' : 'up') + ', protection ' + s.prot + '.' });
    const lo = down ? max - s.limit : 0, hi = down ? max : s.limit;
    if (a.offset < lo || a.offset >= hi) return fail('limit', 'Offset ' + a.offset + ' is outside [' + lo + ', ' + hi + '), the part of the segment that exists: a segmentation fault.');
    steps.push({ kind: 'limit', lo, hi, say: 'Offset ' + a.offset + ' lies in [' + lo + ', ' + hi + '): within the limit.' });
    if (!s.prot.includes(acc)) return fail('protection', M.an(ACC[acc]).replace(/^a/, 'A') + ' is not allowed: the segment is ' + s.prot + '. A protection fault.');
    steps.push({ kind: 'prot', access: acc, say: M.an(ACC[acc]).replace(/^a/, 'A') + ' is allowed by ' + s.prot + '.' });
    const rel = a.offset - lo;
    if (t.paging) {
      const pb = t.paging.pageBytes, page = Math.floor(rel / pb), off = rel % pb, table = t.paging.tables[a.seg] || [];
      const f = table[page];
      if (f === null || f === undefined) return fail('page', 'Byte ' + rel + ' of the segment is in its page ' + page + ', which has no frame: a page fault.');
      const pa = f * pb + off;
      steps.push({ kind: 'page', page, offset: off, frame: f, say: 'Byte ' + rel + ' of the segment is page ' + page + ', offset ' + off + '; the segment’s page table maps page ' + page + ' to frame ' + f + '.' });
      steps.push({ kind: 'relocate', pa, say: 'Frame ' + f + ' × ' + pb + ' + ' + off + ' = physical address ' + pa + '.' });
      return { ok: true, pa, fault: null, steps, page, frame: f };
    }
    const pa = s.base + rel;
    steps.push({ kind: 'relocate', pa, say: down ? 'It grows down, so the byte is ' + rel + ' above the segment’s base: ' + s.base + ' + ' + rel + ' = ' + pa + '.' : 'Base ' + s.base + ' + offset ' + a.offset + ' = physical address ' + pa + '.' });
    return { ok: true, pa, fault: null, steps };
  };

  (S.engines = S.engines || []).push({ name: 'Segmentation' });
})(globalThis.Proses = globalThis.Proses || {});
