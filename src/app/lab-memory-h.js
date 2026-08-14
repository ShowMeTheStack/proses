// The Memory lab, registered: two workbenches. Paging: the student's own address layout, entries, TLB and table
// design, a space of mapped regions (typed, or a sparse or dense one laid out), and addresses typed in hex, each
// translated through the TLB and the table. Allocation: a sequence of allocs and frees under contiguous allocation,
// segmentation, the buddy system, slab caches or a malloc heap. The diagram checks cover every preset.
(function (S) {
  'use strict';
  const ML = S.MemLab;
  const M = () => S.Mem;
  const paging = (v) => v.mode !== 'alloc';
  const allocOn = (v) => v.mode === 'alloc';
  const size = (b) => (b >= 1024 ? b / 1024 >= 1024 ? b / 1048576 + ' MiB' : b / 1024 + ' KiB' : b + ' B');

  /** the addresses that show hits, misses, an eviction, a protection fault and a page fault on the sparse space */
  ML.addrsFor = function (vaBits) {
    const top = 1n << BigInt(vaBits), lib = top / 4n, hx = (x) => S.Mem.hex(x, 0);
    return [hx(0x400a10) + ':x', hx(0x600008) + ':w', hx(0x400a40) + ':x', hx(0x601f00), hx(lib + 0x123n), hx(0x600100), hx(top - 0x1ff0n) + ':w', hx(0x400b00) + ':w', hx(0x50000000n % (top / 2n)), hx(0x601f08)];
  };
  const arch = (id, more) => { const a = ML.ARCH[id]; return Object.assign({ mode: 'paging', va: a.va, pa: a.pa, page: a.page, levels: a.levels, bits: 'auto', pte: a.pte, flags: a.flags.slice(), addrs: ML.addrsFor(a.va) }, more || {}); };
  const REGIONS = [
    { name: 'code', start: '0x40_0000', pages: 4, perm: 'rx' }, { name: 'data', start: '0x60_0000', pages: 6, perm: 'rw' },
    { name: 'mmap', start: '0x2000_0000', pages: 2, perm: 'r' }, { name: 'stack', start: '0x7fff_ffff_c000', pages: 4, perm: 'rw' },
  ];

  const fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'paging', options: [{ value: 'paging', label: 'Paging: translate addresses' }, { value: 'alloc', label: 'Allocation: allocs and frees' }] },
    // ---- paging
    { id: 'va', label: 'Virtual address bits', type: 'number', group: 'Addresses and pages', def: 48, min: 12, max: 64, show: paging },
    { id: 'pa', label: 'Physical address bits', type: 'number', def: 52, min: 12, max: 64, show: paging },
    { id: 'page', label: 'Page size', type: 'select', def: 4096, options: ML.PAGES.map((b) => ({ value: b, label: size(b) })), show: paging },
    { id: 'levels', label: 'Levels', type: 'number', def: 4, min: 1, max: 6, show: paging },
    { id: 'bits', label: 'Bits per level, top first', type: 'text', def: 'auto', placeholder: 'auto, or 9 9 9 9', pattern: '^\\s*(auto|\\d+([\\s,+-]+\\d+)*)\\s*$', patternWhy: 'auto, or whole numbers like 9 9 9 9', help: 'auto: every table but the root fills one page', show: paging },
    { id: 'pte', label: 'Entry size', type: 'select', group: 'Page-table entries', def: 8, options: [4, 8, 16].map((b) => ({ value: b, label: b + ' bytes' })), show: paging },
    { id: 'flags', label: 'Flag bits', type: 'list', kind: 'text', def: ML.ARCH['x86-64'].flags, minLen: 1, maxLen: 10, help: 'names: P or V valid, R, W or RW, X or NX, U or US, A accessed, D dirty, G global', show: paging,
      check: (x) => { for (const f of x) if (!/^[A-Za-z]{1,3}$/.test(f)) return 'Flag bits: "' + f + '" should be a short name of letters, like RW'; return new Set(x.map((f) => f.toUpperCase())).size === x.length ? null : 'Flag bits: each name once'; } },
    { id: 'tlb', label: 'TLB entries', type: 'select', group: 'TLB and timing', def: 8, options: [0, 2, 4, 8, 16, 32, 64].map((n) => ({ value: n, label: n ? String(n) : 'none' })), show: paging },
    { id: 'ways', label: 'Associativity', type: 'select', def: 2, options: [{ value: 1, label: 'direct-mapped' }, { value: 2, label: '2-way' }, { value: 4, label: '4-way' }, { value: 8, label: '8-way' }, { value: 0, label: 'fully associative' }], show: (v) => paging(v) && v.tlb > 0 },
    { id: 'tlbNs', label: 'TLB lookup', type: 'number', def: 1, min: 0, max: 20, integer: false, unit: 'ns', show: (v) => paging(v) && v.tlb > 0 },
    { id: 'memNs', label: 'Memory access', type: 'number', def: 100, min: 1, max: 1000, unit: 'ns', show: paging },
    { id: 'table', label: 'Table design', type: 'select', group: 'Page table', def: 'hier', options: [{ value: 'hier', label: 'hierarchical' }, { value: 'hashed', label: 'hashed' }, { value: 'inverted', label: 'inverted' }], show: paging },
    { id: 'buckets', label: 'Hash buckets (anchors)', type: 'number', def: 16, min: 1, max: 4096, show: paging, help: 'the hashed table’s buckets; the inverted table’s anchors' },
    { id: 'frames', label: 'Frames (inverted)', type: 'number', def: 64, min: 2, max: 4096, show: paging, help: 'one inverted-table entry a physical frame; pages beyond them are not resident' },
    { id: 'procs', label: 'Processes like this one', type: 'number', def: 1, min: 1, max: 1000, show: paging, help: 'every process has its own forward tables; the inverted table is shared' },
    { id: 'space', label: 'Address space', type: 'select', group: 'Address space', def: 'sparse', options: [{ value: 'sparse', label: 'sparse: code, heap, library, stack' }, { value: 'dense', label: 'dense: pages from 0 up' }, { value: 'typed', label: 'my own regions' }], show: paging },
    { id: 'n', label: 'Heap pages', type: 'number', def: 6, min: 1, max: ML.MAX_PAGES, show: (v) => paging(v) && v.space === 'sparse' },
    { id: 'nd', label: 'Pages', type: 'number', def: 300, min: 1, max: ML.MAX_PAGES, show: (v) => paging(v) && v.space === 'dense' },
    { id: 'regions', label: 'Regions', type: 'table', def: REGIONS, minRows: 1, maxRows: 8, show: (v) => paging(v) && v.space === 'typed',
      columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9_]{0,7}$', patternWhy: 'a short name', width: '74px' }, { id: 'start', label: 'Starts at (hex)', type: 'text', pattern: '^(0[xX][0-9a-fA-F_]+|\\d+)$', patternWhy: 'hex like 0x40_0000' }, { id: 'pages', label: 'Pages', type: 'int', min: 1, max: ML.MAX_PAGES, width: '64px' }, { id: 'perm', label: 'May', type: 'select', options: ['r', 'rw', 'rx', 'rwx'].map((p) => ({ value: p, label: p })), width: '66px' }],
      newRow: (i) => ({ name: 'r' + (i + 1), start: '0x' + (0x1000000 * (i + 1)).toString(16), pages: 2, perm: 'rw' }),
      check: (row, i, rows) => (rows.findIndex((x) => x.name === row.name) !== i ? { name: 'two regions are called ' + row.name } : null) },
    { id: 'addrs', label: 'Addresses (hex; :w a write, :x a fetch)', type: 'list', kind: 'text', group: 'Translate', def: ML.addrsFor(48), minLen: 1, maxLen: 14, show: paging,
      check: (x) => { for (const t of x) { const a = ML.parseAddr(t); if (a.error) return 'Addresses: ' + a.error; } return null; } },
  ].concat(ML.allocFields ? ML.allocFields(allocOn) : []);

  const presets = [
    { label: 'x86-64, a sparse process', values: arch('x86-64', { table: 'hier', space: 'sparse', tlb: 8, ways: 2 }) },
    { label: 'x86-64, five levels', values: arch('x86-64-5', { table: 'hier', space: 'sparse', tlb: 8, ways: 2 }) },
    { label: 'RISC-V Sv39, dense', values: arch('sv39', { table: 'hier', space: 'dense', nd: 1500, tlb: 16, ways: 4, addrs: ['0x0', '0x1000', '0x2a3f', '0x1000:w', '0x5d_c000', '0x5d_cfff:w', '0x40', '0x5d_d000', '0x2a00'] }) },
    { label: '32-bit, two levels (10-10-12)', values: arch('x86-32', { table: 'hier', space: 'sparse', tlb: 4, ways: 0 }) },
    { label: 'Your own: 6-6-6, 4 KiB', values: arch('x86-64', { va: 30, pa: 32, levels: 3, bits: '6 6 6', pte: 8, table: 'hier', space: 'typed', tlb: 4, ways: 1, regions: [{ name: 'code', start: '0x40_0000', pages: 3, perm: 'rx' }, { name: 'heap', start: '0x60_0000', pages: 4, perm: 'rw' }, { name: 'stack', start: '0x3fff_c000', pages: 4, perm: 'rw' }], addrs: ['0x40_0010:x', '0x60_0020:w', '0x60_1020', '0x3fff_f008:w', '0x40_1004:x', '0x3fff_c100', '0x60_0028', '0x2000_0000'] }) },
    { label: 'Hashed table, 8 buckets', values: arch('x86-64', { table: 'hashed', buckets: 8, space: 'sparse', n: 12, tlb: 4, ways: 0 }) },
    { label: 'Inverted table, 16 frames', values: arch('x86-64', { table: 'inverted', buckets: 8, frames: 16, space: 'sparse', n: 12, tlb: 4, ways: 0, procs: 50 }) },
    { label: 'A direct-mapped TLB thrashing', values: arch('x86-64', { table: 'hier', space: 'sparse', tlb: 4, ways: 1, addrs: ['0x40_0010:x', '0x60_4000', '0x40_0020:x', '0x60_4010', '0x40_0030:x', '0x60_4020', '0x40_0040:x', '0x60_4030'] }) },
  ].concat(ML.allocPresets || []);

  S.Labs.add({
    id: 'memory', part: 'memory', title: 'Memory lab', seed: false,
    blurb: 'Choose the address bits, page size, levels, entries, TLB and table design, map a space, and type addresses: each one split, looked up in the TLB, walked table by table and counted; then the tables’ memory compared across designs and the access time worked out. Or switch to allocation and watch allocs and frees carve memory up.',
    setup: { fields, presets, check: (v) => ML.check(Object.assign({}, v, { n: v.space === 'dense' ? v.nd : v.n })) },
    run(v, ctx) {
      if (v.mode === 'alloc') return ML.allocRun(v, ctx);
      return ML.paging(Object.assign({}, v, { n: v.space === 'dense' ? v.nd : v.n }), ctx);
    },
  });

  if (S.Checks) {
    const pick = (k) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); await new Promise((r) => setTimeout(r, 700)); P.go(Math.max(0, P.frames.length - 3), true); P.stage.finish(); try { localStorage.removeItem('proses.lab:memory'); } catch (e) {}";
    S.Checks.push({ group: 'labs', name: 'memory lab', hash: 'labs/memory', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:memory'); } catch (e) {} const P = Proses.app.page.lab; P.go(6, true); P.stage.finish();", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'memory lab: designs compared', hash: 'labs/memory', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.go(P.frames.length - 2, true); P.showTab('tables'); P.stage.finish();", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'memory lab: access time', hash: 'labs/memory', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.go(P.frames.length - 1, true); P.showTab('metrics'); P.stage.finish();", sel: '#main' });
    presets.forEach((p, k) => { if (k > 0) S.Checks.push({ group: 'labs', name: 'memory lab: ' + p.label, hash: 'labs/memory', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k), sel: '#main' }); });
  }
})(globalThis.Proses = globalThis.Proses || {});
