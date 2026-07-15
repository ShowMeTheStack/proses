// Memory engines, part 10: what the page size costs. Internal fragmentation per allocation (each allocation rounded
// up to whole pages), and the trade-off across page sizes: the page table, the waste inside the last pages, and
// the memory the TLB reaches.
//   S.Mem.internalFrag(sizes, pageBytes) -> {rows: [{size, pages, bytes, waste}], used, waste, fraction, say}
//   S.Mem.pageSizeTradeoff({vaBits, pteBytes, tlbEntries, sizes, pageSizes}) ->
//     {rows: [{pageBytes, offBits, flatTable, leafEntries, leafBytes, waste, reach, reachCovers, say}], say}
//     flatTable: one flat table for the whole space; leafEntries/leafBytes: the entries the allocations need
//     (one a page); waste: the internal fragmentation of the allocations; reach: tlbEntries × page size, and
//     reachCovers: the share of the allocations' pages the TLB holds at once (at most 1)
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.internalFrag = function (sizes, pageBytes) {
    const rows = sizes.map((size) => { const pages = Math.max(1, Math.ceil(size / pageBytes)); return { size, pages, bytes: pages * pageBytes, waste: pages * pageBytes - size }; });
    const used = rows.reduce((a, r) => a + r.bytes, 0), waste = rows.reduce((a, r) => a + r.waste, 0);
    return { rows, used, waste, fraction: used ? waste / used : 0, say: sizes.length + ' allocations in ' + M.bytes(pageBytes) + ' pages take ' + M.bytes(used) + ', of which ' + M.bytes(waste) + ' (' + Math.round((100 * waste) / Math.max(1, used)) + '%) is unused space at the ends of last pages.' };
  };

  M.pageSizeTradeoff = function (o) {
    const pte = o.pteBytes || 8, tlb = o.tlbEntries || 64;
    const rows = o.pageSizes.map((pb) => {
      const offBits = M.log2(pb), f = M.internalFrag(o.sizes, pb);
      const leafEntries = f.rows.reduce((a, r) => a + r.pages, 0), reach = M.tlbReach(tlb, pb);
      return { pageBytes: pb, offBits, flatTable: 2 ** (o.vaBits - offBits) * pte, leafEntries, leafBytes: leafEntries * pte, waste: f.waste, reach, reachCovers: Math.min(1, tlb / leafEntries), say: M.bytes(pb) + ' pages: a flat table of ' + M.bytes(2 ** (o.vaBits - offBits) * pte) + ', ' + M.count(leafEntries, 'entry', 'entries') + ' for the allocations, ' + M.bytes(f.waste) + ' wasted inside pages, and a TLB reach of ' + M.bytes(reach) + '.' };
    });
    const minWaste = rows.reduce((a, r) => (r.waste < a.waste ? r : a)), maxReach = rows.reduce((a, r) => (r.reach > a.reach ? r : a));
    return { rows, say: 'Small pages waste least (' + M.bytes(minWaste.pageBytes) + ': ' + M.bytes(minWaste.waste) + '); large pages need the fewest entries and reach furthest (' + M.bytes(maxReach.pageBytes) + ': ' + M.bytes(maxReach.reach) + ').' };
  };

  (S.engines = S.engines || []).push({ name: 'Page size' });
})(globalThis.Proses = globalThis.Proses || {});
