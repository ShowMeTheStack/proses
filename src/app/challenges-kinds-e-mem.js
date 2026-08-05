// Challenge kind 'pt-design': a page-table design for a given address space under a memory budget.
//   x: {kind: 'pt-design', space: {vaBits, pteBytes, regions: [{name, start: '0x..', bytes}]},
//       limits: {pageSizes: [bytes..], maxLevels, minLevels}}
//   answer: {pageBytes, bits: [index bits of each level, root first]}   (the bits and the offset fill vaBits)
//   score: the memory the design costs, in bytes: the page tables the mapped regions need (S.Mem.build/usage)
//     plus the internal fragmentation (each region rounded up to whole pages). Lower is better.
//   Every first and last byte of each region must translate, and the address just past a region must fault
//   unless another region holds it (checked with S.Mem.translate).
(function (S) {
  'use strict';
  const C = S.Challenges, KIT = () => S.ChallengeKit;
  const B = (v) => BigInt(v);

  /** the pages each region needs under a page size: [{name, first, last (vpns), waste}] */
  function pages(space, pageBytes) {
    const pb = B(pageBytes);
    return space.regions.map((r) => {
      const a = B(r.start), z = a + B(r.bytes) - 1n, first = a / pb, last = z / pb;
      return { name: r.name, a, z, first, last, n: Number(last - first + 1n), waste: Number((last - first + 1n) * pb - B(r.bytes)) };
    });
  }
  /** the design built: {cfg, pt, use, waste, total, problems} */
  function build(x, a) {
    const M = S.Mem, sp = x.space, out = { problems: [] };
    const cfg = M.config({ vaBits: sp.vaBits, pageBytes: a.pageBytes, bits: a.bits, pteBytes: sp.pteBytes || 4 });
    const ps = pages(sp, a.pageBytes), map = [], seen = new Set();
    let pfn = 0x1000n;
    for (const r of ps) for (let v = r.first; v <= r.last; v++) { const k = String(v); if (seen.has(k)) continue; seen.add(k); map.push([v, pfn++]); }
    const pt = M.build(cfg, map, { tableFrame: 0x10 });
    const use = M.usage(pt), waste = ps.reduce((s, r) => s + r.waste, 0);
    for (const r of ps) {
      for (const va of [r.a, r.z]) { const t = M.translate(pt, va); if (!t.ok) out.problems.push('the address ' + M.hex(va, sp.vaBits) + ' in ' + r.name + ' does not translate'); }
    }
    return Object.assign(out, { cfg, pt, use, waste, total: use.bytes + waste, ps });
  }
  function shapeProblems(x, a) {
    const L = x.limits || {}, sp = x.space, out = [], M = S.Mem;
    if (!a || !Array.isArray(a.bits) || !a.bits.length) return ['give the index bits of every level'];
    const off = M.log2(a.pageBytes);
    if (off < 0) return ['the page size must be a power of two'];
    if ((L.pageSizes || []).length && !L.pageSizes.includes(a.pageBytes)) out.push('a page of ' + M.bytes(a.pageBytes) + ' is not one of the sizes allowed (' + L.pageSizes.map(M.bytes).join(', ') + ')');
    if (a.bits.some((b) => !Number.isInteger(b) || b < 1 || b > 24)) out.push('each level takes 1 to 24 index bits');
    const sum = a.bits.reduce((s, b) => s + b, 0);
    if (sum + off !== sp.vaBits) out.push('the index bits (' + a.bits.join(' + ') + ' = ' + sum + ') and the ' + off + '-bit offset make ' + (sum + off) + ' bits, not the ' + sp.vaBits + ' of an address');
    if (L.maxLevels && a.bits.length > L.maxLevels) out.push(a.bits.length + ' levels is more than the ' + L.maxLevels + ' allowed: each level is one more memory access on a TLB miss');
    if (L.minLevels && a.bits.length < L.minLevels) out.push('at least ' + L.minLevels + ' levels are needed');
    return out;
  }

  const kind = (C.kinds['pt-design'] = {
    build, pages,
    start: (x) => { const off = 12; const idx = x.space.vaBits - off; return { pageBytes: 4096, bits: [idx - Math.floor(idx / 2), Math.floor(idx / 2)] }; },
    evaluate(x, a) {
      if (shapeProblems(x, a).length) return { score: null };
      let r;
      try { r = build(x, a); } catch (e) { return { score: null, problems: [String(e.message || e)] }; }
      const M = S.Mem;
      return { score: r.total, n: x.space.regions.length, details: ['Page tables: ' + r.use.tables + ' table' + (r.use.tables === 1 ? '' : 's') + ' (' + r.use.perLevel.join(' + ') + ' by level), ' + M.bytes(r.use.bytes) + '; internal fragmentation ' + M.bytes(r.waste) + '; in all ' + r.total + ' bytes.'], problems: r.problems };
    },
    limitsProblems(x, a) {
      const out = shapeProblems(x, a);
      if (out.length) return out;
      try { return build(x, a).problems; } catch (e) { return [String(e.message || e)]; }
    },
    limitSentences(x) {
      const L = x.limits || {}, M = S.Mem, out = ['Addresses have ' + x.space.vaBits + ' bits; a page-table entry takes ' + (x.space.pteBytes || 4) + ' bytes.'];
      if (L.pageSizes) out.push('Page sizes allowed: ' + L.pageSizes.map(M.bytes).join(', ') + '.');
      if (L.maxLevels) out.push('At most ' + L.maxLevels + ' levels (memory accesses on a TLB miss).');
      out.push('Every byte of every region must translate. The cost is the page tables plus the unused ends of the last pages.');
      return out;
    },
    lint(x) {
      const out = [];
      if (!x.space || !(x.space.regions || []).length) out.push('no regions');
      if (x.higher !== false) out.push('bytes are better when fewer: give the challenge higher: false');
      return out;
    },
    workspace(host, x, draft, onChange) { return S.PtDesignWorkspace(host, x, draft, onChange); },
    example: () => ({
      id: 'sample-pt-budget', n: 903, title: 'Page tables for a pocket device', level: 2, kind: 'pt-design', sample: true,
      story: 'A pocket music player runs one small program in a 32-bit address space: its code near the bottom, a heap that grows to a little over a megabyte, a shared library high up, and a stack just under the top. Its memory is tiny, so every byte the page tables take, and every byte lost at the end of a half-used page, is a byte the music cannot have.\n\nDesign the page size and the levels of the page table.',
      task: 'Choose a page size and how the index bits are split between levels. Cost = page-table bytes + the unused ends of the regions\' last pages.',
      metricName: 'bytes of overhead', unit: 'bytes', higher: false,
      space: { vaBits: 32, pteBytes: 4, regions: [
        { name: 'code', start: '0x00010000', bytes: 41000 }, { name: 'heap', start: '0x00800000', bytes: 1200000 },
        { name: 'library', start: '0x40000000', bytes: 98000 }, { name: 'stack', start: '0xfffe8000', bytes: 90112 }] },
      limits: { pageSizes: [1024, 2048, 4096, 8192, 16384, 65536], maxLevels: 3 },
      target: 9000, marks: { silver: 8600, gold: 8400 },
      hints: ['One flat table for a 32-bit space is huge: with 4 KiB pages it has 2^20 entries. Several levels let the empty parts of the space cost nothing.', 'Each table at a lower level covers one stretch of the space; the four regions are far apart, so each needs its own lower table. Small lower tables waste less, but more levels cost more tables and more accesses.', 'With 4 KiB pages, two levels of 10 and 10 index bits cost about 24 KiB. Three levels of 8, 6 and 6 bits keep the root at 1 KiB and every lower table at 256 bytes: about 8.1 KiB in all.'],
      solution: { pageBytes: 4096, bits: [8, 6, 6] },
      wrong: [{ pageBytes: 4096, bits: [6, 7, 7] }, { pageBytes: 4096, bits: [10, 10] }, { pageBytes: 65536, bits: [8, 8] }, { pageBytes: 1024, bits: [8, 7, 7, 0] }, { pageBytes: 4096, bits: [5, 5, 5, 5] }],
    }),
  });
  void kind;
})(globalThis.Proses = globalThis.Proses || {});
