// Part 11, the page size. The same allocations under several page sizes: each rounded up to whole pages (the waste
// in its last page drawn red), and a table that fills in row by row: a flat table for the whole space, the entries
// the allocations need, the waste, and the TLB reach and how much of the allocations it covers. Then the reach
// worked out, and prepaging as the other way to cut faults.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const UNITS = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
  /** "4K" -> 4096, "300" -> 300 */
  const parseSize = (x) => { const m = /^(\d+)([KMG])?$/i.exec(String(x)); return m ? +m[1] * (m[2] ? UNITS[m[2].toUpperCase()] : 1) : NaN; };
  const sizeList = (label, pow2, max) => ({ kind: 'list', label, min: 1, max, check: (v) => {
    for (const x of v) {
      const n = parseSize(x);
      if (!Number.isFinite(n) || n < 1) return label + ': sizes like 300, 12K or 2M ("' + x + '")';
      if (pow2 && (M().log2(n) < 9 || M().log2(n) > 30)) return label + ': powers of two from 512 to 1G ("' + x + '")';
    }
    return null;
  } });

  S.topic({
    id: 'vmem-page-size', family: 'p11-pagesize', order: 10, title: 'Choosing a page size',
    blurb: 'The page size is a trade-off with no right answer. Small pages waste little in the last page of each region and match what a program really uses, but need more page-table entries and more faults, and a TLB of fixed size then covers little memory. Large pages shrink the tables and stretch the TLB reach, the memory the TLB maps at once (entries × page size), but waste more and move more on every fault. Hardware now offers several sizes at once for just this reason.',
    inputs: [
      Object.assign({ id: 'sizes', def: ['5000', '130K', '70K', '1200', '3M'] }, sizeList('Allocations (bytes)', false, 6)),
      Object.assign({ id: 'pages', def: ['1K', '4K', '64K', '2M'] }, sizeList('Page sizes', true, 5)),
      { id: 'vaBits', kind: 'choice', label: 'Virtual address', def: '48', options: ['32', '39', '48'].map((v) => ({ value: v, label: v + ' bits' })) },
      { id: 'pte', kind: 'choice', label: 'Entry size', def: '8', options: ['4', '8'].map((v) => ({ value: v, label: v + ' bytes' })) },
      { id: 'tlb', kind: 'number', label: 'TLB entries', def: 64, min: 4, max: 4096 },
    ],
    check(inp) { const ps = inp.pages.map(parseSize); if (new Set(ps).size !== ps.length) return 'Page sizes: each only once'; if (ps.some((p) => M().log2(p) >= +inp.vaBits)) return 'Page sizes: smaller than the address space'; return null; },
    presets: [
      { label: 'A mixed program: 1 KiB to 2 MiB pages', values: {} },
      { label: 'Many small objects', values: { sizes: ['300', '700', '1500', '2100', '400', '900'], pages: ['512', '4K', '16K', '64K'] } },
      { label: 'A large array: huge pages win', values: { sizes: ['1G', '6000'], pages: ['4K', '2M', '1G'], tlb: 1536 } },
      { label: 'A 32-bit machine, 4-byte entries', values: { vaBits: '32', pte: '4', pages: ['1K', '4K', '16K', '4M'] } },
    ],
    counters: [{ id: 'rows', label: 'page sizes compared' }],
    run(inp) {
      const sizes = inp.sizes.map(parseSize), pages = inp.pages.map(parseSize).sort((a, b) => a - b), B = (n) => M().bytes(n);
      const r = M().pageSizeTradeoff({ vaBits: +inp.vaBits, pteBytes: +inp.pte, tlbEntries: inp.tlb, sizes, pageSizes: pages });
      const total = sizes.reduce((a, b) => a + b, 0), FR = new S.Frames(['rows']), view = H.box(0, 0, 790, 476);
      const COLS = [['page', 76], ['flat table', 102], ['entries', 76], ['wasted', 106], ['TLB reach', 104], ['reach covers', 106], ['waste share', 100]];
      const rowVals = (row) => [B(row.pageBytes), B(row.flatTable), String(row.leafEntries), B(row.waste), B(row.reach), H.pct(row.reachCovers, 0), H.pct(row.waste / (total + row.waste), row.waste / (total + row.waste) < 0.01 ? 2 : 1)];
      const draw = (upto, cur, focus) => {
        const items = [H.text('hdr', 4, 20, sizes.length + ' allocations, ' + B(total) + ' in all; ' + inp.vaBits + '-bit addresses, ' + inp.pte + '-byte entries, ' + inp.tlb + ' TLB entries', 'p10-sum', 14)];
        // the allocations rounded up to pages of the focus size
        const fr = focus ? M().internalFrag(sizes, focus) : null, maxB = Math.max(...sizes);
        items.push(H.text('at', 4, 48, focus ? 'each allocation as its ' + B(focus) + ' pages, drawn full width: red is the unused end of its last page' : 'the allocations, to scale', 'tick', 12));
        sizes.forEach((sz, j) => {
          const y = 60 + j * 30, X0 = 96, W = 520, row = fr ? fr.rows[j] : null;
          items.push(H.text('al' + j, X0 - 8, y + 16, B(sz), 'mono', 12, 'end'));
          const span = row ? row.bytes : maxB, wu = Math.max(2, (sz / span) * W);
          items.push(H.cell('au' + j, X0, y, wu, 22, '', 'p10-run p1', 12, { rx: 0 }));
          items.push(H.cell('aw' + j, X0 + wu, y, row && row.waste ? Math.max(2, (row.waste / span) * W) : 0.5, 22, '', 'p10-run waste', 12, { rx: 0 }));
          if (row && row.pages > 1 && row.pages <= 48) for (let k = 1; k < row.pages; k++) items.push({ key: 'pg' + j + '_' + k, kind: 'line', x1: Math.round(X0 + (k / row.pages) * W), y1: y + 2, x2: Math.round(X0 + (k / row.pages) * W), y2: y + 20, cls: 'faint', audit: 'ignore' });
          if (row) items.push(H.text('ap' + j, 786, y + 16, H.plural(row.pages, 'page') + ', ' + B(row.waste) + ' lost', 'tick', 12, 'end'));
        });
        // the table
        const ty = 60 + sizes.length * 30 + 26;
        let x = 4;
        COLS.forEach(([c, w], k) => { items.push(H.cell('th' + k, x, ty, w - 2, 26, c, 'head', 12, { rx: 0 })); x += w; });
        r.rows.forEach((row, i) => {
          if (i > upto) return;
          const vals = rowVals(row);
          let xx = 4;
          vals.forEach((v, k) => { items.push(H.cell('td' + i + '_' + k, xx, ty + 30 + i * 30, COLS[k][1] - 2, 28, v, 'mono' + (i === cur ? ' act' : ''), 12, { rx: 0 })); xx += COLS[k][1]; });
        });
        return items;
      };
      FR.add({ items: draw(-1, -1, null), say: `${H.plural(sizes.length, 'allocation')} of ${H.list(sizes.map(B))}, ${B(total)} in all, under ${pages.length === 1 ? 'one page size' : pages.length + ' sizes of page'}: ${H.list(pages.map(B))}.`, meta: { phase: 'start', n: sizes.length, sizes, pages, total, shown: sizes.map(B).concat(pages.map(B), [B(total)]) }, view, hl: { d: [] } });
      r.rows.forEach((row, i) => {
        FR.set('rows', i + 1);
        const v = rowVals(row);
        FR.add({ items: draw(i, i, row.pageBytes), say: `${v[0]} pages: the offset takes ${row.offBits} bits, so one flat table for the whole space would take ${v[1]}. The allocations need ${row.leafEntries} entries and waste ${v[3]} at the ends of their last pages; the TLB reaches ${v[4]}, ${v[5]} of the pages they use.`, meta: { phase: 'row', page: row.pageBytes, offBits: row.offBits, flat: row.flatTable, entries: row.leafEntries, waste: row.waste, reach: row.reach, covers: row.reachCovers, shown: v }, view, hl: { d: [0, 1, 2] } });
      });
      const last = r.rows.length - 1, mid = r.rows[Math.min(1, last)];
      FR.add({ items: draw(last, Math.min(1, last), mid.pageBytes), say: `TLB reach = entries × page size: ${inp.tlb} × ${B(mid.pageBytes)} = ${B(mid.reach)}. The allocations span ${B(total)} in ${mid.leafEntries} pages, so a TLB of ${inp.tlb} entries holds ${mid.reachCovers >= 1 ? 'all of them' : H.pct(mid.reachCovers, 0) + ' of them'} at once` + (mid.reachCovers < 1 ? '; larger pages raise the reach without a larger TLB.' : '.'), meta: { phase: 'reach', tlb: inp.tlb, page: mid.pageBytes, reach: mid.reach, entries: mid.leafEntries, covers: mid.reachCovers, total, shown: [B(mid.pageBytes), B(mid.reach), B(total), H.pct(mid.reachCovers, 0)] }, view, hl: { d: [3] } });
      const shown = r.rows.flatMap((x) => [B(x.pageBytes), B(x.waste), B(x.reach)]);
      FR.add({ items: draw(last, -1, null), say: r.say + ' Neither end wins everywhere: that is why processors offer several page sizes at once.', meta: { phase: 'end', shown }, view, hl: { d: [0, 1, 2, 3] } });
      FR.add({ items: draw(last, -1, null), say: 'Prepaging attacks the faults from the other side: on a fault, the kernel also brings in pages likely to be wanted soon, such as the neighbours of the faulting page or the whole working set of a process being swapped back in. It pays when most of the extra pages are used before they are evicted, and wastes disk transfers and frames when they are not.', meta: { phase: 'prepage' }, view, hl: { d: [4] } });
      return { frames: FR.list, def: H.def('Page size', ['flat table = 2^(va − offset bits) × entry size', 'waste ≈ half a page per region', 'TLB reach = entries × page size', 'small pages: less waste; large: smaller tables, more reach', 'prepaging: load likely pages with the faulting one']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'start' && fr.filter((x) => x.meta.phase === 'row').length > 1, pick: 'option', ask: 'Which page size will waste the most at the ends of the last pages?', options: (fr) => fr.filter((x) => x.meta.phase === 'row').map((x) => x.meta.shown[0]), answer: (fr) => { const rs = fr.filter((x) => x.meta.phase === 'row'), m = Math.max(...rs.map((x) => x.meta.waste)); return rs.filter((x) => x.meta.waste === m).length > 1 ? null : rs.find((x) => x.meta.waste === m).meta.shown[0]; }, explain: (fr) => fr.find((x) => x.meta.phase === 'end').say },
    ],
    quiz: [
      { q: 'A TLB has 64 entries and pages are 4 KiB. Its reach is…', options: ['256 KiB', '64 KiB', '4 KiB', '4 MiB'], answer: 0, why: '64 × 4 KiB = 256 KiB.' },
      { q: 'Same TLB with 2 MiB pages?', options: ['128 MiB', '2 MiB', '64 MiB', '256 KiB'], answer: 0, why: '64 × 2 MiB.' },
      { q: 'On average, how much of the last page of a region is wasted?', options: ['about half a page', 'nothing', 'a whole page', 'one byte'], answer: 0, why: 'The end of a region falls anywhere in its last page.' },
      { q: 'Doubling the page size of a 48-bit space with 8-byte entries makes a flat table…', options: ['half as large', 'twice as large', 'the same', 'four times as large'], answer: 0, why: 'One more offset bit halves the number of pages.' },
      { q: 'Prepaging helps when…', options: ['most of the pages brought in early are used before eviction', 'pages are never reused', 'the disk is idle anyway and nothing else matters', 'the TLB is large'], answer: 0, why: 'Otherwise it spends transfers and frames on pages nobody touches.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
