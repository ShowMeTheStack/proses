// Part 10, the memory page tables take. One process's mapped pages (sparse regions, one dense run, or pages
// scattered far apart) under four designs: one flat table, a multilevel table, a hashed table and the machine's
// single inverted table; then the totals for many processes. Engines: S.Mem.build / usage, S.Mem.hpt, S.Mem.ipt,
// S.Mem.forwardBytes.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const LAYOUTS = [['x86-32', '32-bit, two levels'], ['x86-64', 'x86-64, four levels'], ['sv39', 'RISC-V Sv39'], ['x86-64-5', 'x86-64, five levels']];

  /** the page numbers of a pattern, inside the layout's space */
  function pagesOf(cfg, pattern, n) {
    const top = 2 ** cfg.vpnBits, out = [];
    if (pattern === 'dense') for (let i = 0; i < n; i++) out.push(i);
    else if (pattern === 'scattered') { const step = Math.max(1, Math.floor(top / n / 512) * 512); for (let i = 0; i < n; i++) out.push(i * step); }
    else {
      const code = 0x400000 / cfg.pageBytes;
      for (let i = 0; i < 16; i++) out.push(code + i);
      const heap = Math.floor(top * 0.21 / 512) * 512;
      for (let i = 0; i < n; i++) out.push(heap + i);
      for (let i = 0; i < 8; i++) out.push(top - 8 + i);
    }
    return out;
  }

  S.topic({
    id: 'mem-table-size', family: 'p10-tables', order: 20, title: 'How much memory the tables take',
    blurb: 'A flat table has an entry for every page of the address space, mapped or not: 4 MiB per process for 32 bits, and impossibly much for 48 or 64. A multilevel table only builds the tables under mapped regions, so its size follows how scattered the mapped pages are. A hashed table holds one node per mapped page plus its buckets. An inverted table has one entry per physical frame, shared by every process, so its size follows the machine, not the programs.',
    inputs: [
      { id: 'layout', kind: 'choice', label: 'Layout', def: 'x86-64', options: LAYOUTS.map(([value, label]) => ({ value, label })) },
      { id: 'pattern', kind: 'choice', label: 'Mapped pages', def: 'sparse', options: [{ value: 'sparse', label: 'code, a heap of n pages, a stack' }, { value: 'dense', label: 'one run of n pages' }, { value: 'scattered', label: 'n pages far apart' }] },
      { id: 'n', kind: 'number', label: 'n', def: 64, min: 1, max: 4096 },
      { id: 'procs', kind: 'number', label: 'Processes', def: 50, min: 1, max: 1000 },
      { id: 'phys', kind: 'choice', label: 'Physical memory', def: '4', options: ['1', '4', '16'].map((v) => ({ value: v, label: v + ' GiB' })) },
    ],
    check: (inp) => (inp.layout === 'x86-32' && inp.pattern === 'scattered' && inp.n > 1024 ? 'n: at most 1024 scattered pages in a 32-bit space' : null),
    presets: [
      { label: 'x86-64: a small sparse process', values: {} },
      { label: 'x86-64: 4096 pages in one run', values: { pattern: 'dense', n: 4096 } },
      { label: 'x86-64: 512 pages far apart', values: { pattern: 'scattered', n: 512 } },
      { label: '32-bit, two levels', values: { layout: 'x86-32', n: 256, procs: 20, phys: '1' } },
      { label: 'Five levels, 1000 processes, 16 GiB', values: { layout: 'x86-64-5', procs: 1000, phys: '16' } },
    ],
    counters: [{ id: 'pages', label: 'pages mapped' }],
    run(inp) {
      const cfg = M().preset(inp.layout), vpns = pagesOf(cfg, inp.pattern, inp.n);
      const pt = H.once('ts:' + inp.layout + inp.pattern + inp.n, () => M().build(cfg, vpns.map((v, i) => [BigInt(v), BigInt(i)])));
      const u = M().usage(pt);
      const buckets = 2 ** Math.ceil(Math.log2(vpns.length));
      const hp = M().hpt({ buckets, pageBytes: cfg.pageBytes });
      vpns.forEach((v, i) => hp.insert(v, i));
      const hs = hp.size();
      const frames = (+inp.phys * 2 ** 30) / cfg.pageBytes;
      const ip = H.once('ipt:' + frames, () => M().ipt({ frames, anchors: frames, pageBytes: cfg.pageBytes, vaBits: cfg.vaBits }).size());
      const flat = M().forwardBytes({ vaBits: cfg.vaBits, pageBytes: cfg.pageBytes, pteBytes: cfg.pteBytes, procs: 1 });
      const rows = [
        { k: 'flat', name: 'flat table', one: flat, all: flat * inp.procs, note: '2^' + cfg.vpnBits + ' entries × ' + cfg.pteBytes + ' B, mapped or not' },
        { k: 'multi', name: L(cfg) + '-level table', one: u.bytes, all: u.bytes * inp.procs, note: H.plural(u.tables, 'table') + ' (' + u.perLevel.join(' + ') + ' per level) of ' + M().bytes(cfg.tableBytes[cfg.levels - 1]) },
        { k: 'hash', name: 'hashed table', one: hs.total, all: hs.total * inp.procs, note: vpns.length + ' nodes × 16 B + ' + buckets + ' buckets × 8 B' },
        { k: 'inv', name: 'inverted table', one: ip.total, all: ip.total, note: frames + ' frames × 8 B + anchors, one for the machine' },
      ];
      function L(c) { return c.levels; }
      const F = new S.Frames(['pages']), view = H.box(0, 0, 790, 480);
      const maxLog = Math.log2(Math.max(...rows.map((r) => Math.max(r.one, r.all)))), minLog = 10;
      const wOf = (b) => Math.max(6, Math.round(((Math.log2(Math.max(b, 1024)) - minLog) / (maxLog - minLog)) * 420));
      const draw = (upto, all) => {
        const items = [H.text('hd', 10, 22, M().PRESETS[inp.layout].name + ': ' + vpns.length + ' mapped pages (' + M().bytes(vpns.length * cfg.pageBytes) + ')' + (all ? ', ' + inp.procs + ' processes' : ''), 'strong', 15)];
        items.push(H.text('sc', 780, 22, 'bar length: log scale', 'tick', 12, 'end'));
        rows.forEach((r, k) => {
          const y = 60 + k * 100, on = k === upto, v = all ? r.all : r.one, shown = k <= upto || all;
          items.push(H.text('n' + k, 10, y + 22, r.name, on ? 'act' : 'strong', 15));
          if (shown) {
            items.push(H.cell('b' + k, 170, y + 4, wOf(v), 28, '', 'p10-run ' + ['p3', 'p1', 'p2', 'p0'][k] + (on ? ' act' : ''), 12, { rx: 3 }));
            items.push(H.text('v' + k, 180 + wOf(v), y + 24, M().bytes(v), on ? 'act' : 'strong', 14));
            items.push(H.text('nt' + k, 170, y + 56, r.note + (all && k < 3 ? ' · × ' + inp.procs : ''), 'tick', 12));
          } else {
            // a design not reached yet: a dashed placeholder that says what its size will follow
            const why = { multi: 'next: sized by how scattered the mapped pages are', hash: 'next: sized by the number of mapped pages', inv: 'next: sized by physical memory, one for the machine' }[r.k];
            items.push(H.cell('b' + k, 170, y + 4, 420, 28, why, 'p10-box ghost', 13, { rx: 3 }));
          }
        });
        return items;
      };
      const sz = rows.map((r) => M().bytes(r.one)).concat(rows.map((r) => M().bytes(r.all)), [M().bytes(vpns.length * cfg.pageBytes), M().bytes(cfg.tableBytes[cfg.levels - 1])]);
      const base = { sz, node: 16, bucketB: 8, lv: cfg.bits.map((_, i) => i + 1), vb: cfg.vpnBits, two: 2, vaBits: cfg.vaBits, entries: 2 ** cfg.vpnBits, pte: cfg.pteBytes, n: vpns.length, tables: u.tables, perLevel: u.perLevel, levels: cfg.levels, buckets, frames, procs: inp.procs, phys: +inp.phys };
      F.set('pages', vpns.length);
      F.add({ items: draw(0, false), say: `One flat table covers the whole ${cfg.vaBits}-bit space: 2^${cfg.vpnBits} entries of ${cfg.pteBytes} bytes, ${M().bytes(flat)}, whether ${vpns.length} pages are mapped or all of them.`, meta: Object.assign({ phase: 'flat' }, base), view, hl: { d: [0] } });
      F.add({ items: draw(1, false), say: `The ${cfg.levels}-level table builds only the tables some mapped page needs: ${H.plural(u.tables, 'table')} (${H.list(u.perLevel.map((c, i) => c + ' at level ' + (i + 1)))}), ${M().bytes(u.bytes)}.` + (inp.pattern === 'scattered' ? ' Scattered pages each need tables of their own, which is the worst case.' : inp.pattern === 'dense' ? ' A dense run fills whole tables, the best case.' : ''), meta: Object.assign({ phase: 'multi' }, base), view, hl: { d: [1] } });
      F.add({ items: draw(2, false), say: `A hashed table needs one node per mapped page (${vpns.length} × 16 bytes) and ${buckets} buckets of 8 bytes: ${M().bytes(hs.total)}, however the pages are spread.`, meta: Object.assign({ phase: 'hash' }, base), view, hl: { d: [2] } });
      F.add({ items: draw(3, false), say: `An inverted table has one entry per physical frame: ${inp.phys} GiB in ${H.size(cfg.pageBytes)} frames is ${frames} entries, plus a hash anchor for each, ${M().bytes(ip.total)}. It serves every process at once.`, meta: Object.assign({ phase: 'inv' }, base), view, hl: { d: [3] } });
      const order = rows.slice().sort((a, b) => a.all - b.all);
      F.add({ items: draw(3, true), say: `For ${inp.procs} such processes: ` + H.list(rows.map((r) => r.name + ' ' + M().bytes(r.all))) + `. The smallest here is the ${order[0].name}; flat tables only work for small address spaces.`, meta: Object.assign({ phase: 'all', best: order[0].k }, base), view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('Table sizes', ['flat: 2^(VA bits − offset bits) × entry size', 'multilevel: (tables built) × table size', 'hashed: pages × node + buckets × pointer', 'inverted: frames × entry + anchors (one per machine)', 'per process: flat, multilevel, hashed']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'hash', pick: 'option', ask: 'For all the processes together, which design will need the least memory?', options: ['flat table', 'multilevel table', 'hashed table', 'inverted table'], answer: (fr) => ({ flat: 'flat table', multi: 'multilevel table', hash: 'hashed table', inv: 'inverted table' }[fr.find((f) => f.meta.phase === 'all').meta.best]), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A flat table for a 32-bit space, 4 KiB pages, 4-byte entries takes…', options: ['4 MiB', '4 KiB', '1 MiB', '16 MiB'], answer: 0, why: '2^20 entries × 4 bytes.' },
      { q: 'A process whose pages are scattered across the space makes a multilevel table…', options: ['large: each page needs its own lower tables', 'small', 'flat', 'inverted'], answer: 0, why: 'Tables are shared only by neighbouring pages.' },
      { q: 'The size of an inverted table depends on…', options: ['the physical memory', 'the number of processes', 'the virtual address bits', 'the TLB size'], answer: 0, why: 'One entry per frame, for the whole machine.' },
      { q: 'The cost of an inverted table is…', options: ['a search (by hash) on every TLB miss, and harder sharing', 'more memory', 'no protection', 'larger pages'], answer: 0, why: 'You cannot index it by page number; you must find the (pid, page) pair.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
