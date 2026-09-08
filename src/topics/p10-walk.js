// Part 10, the hierarchical page walk: the Memory lab's view. A real layout (32-bit with two levels, x86-64 with four
// or five, RISC-V Sv39 and Sv48) or the student's own bits per level; a small sparse process (code, heap, stack and one
// large page) mapped by the page-table engine; one address walked table by table with the memory accesses counted.
// Engines: S.Mem.preset / config / build / translate / usage (src/core/mem-a-paging.js).
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const LAYOUTS = [['x86-32', '32-bit, two levels'], ['x86-64', 'x86-64, four levels'], ['x86-64-5', 'x86-64, five levels'], ['sv39', 'RISC-V Sv39'], ['sv48', 'RISC-V Sv48'], ['custom', 'your own bits per level']];
  const WHICH = [['code', 'a code page'], ['heap', 'a heap page'], ['stack', 'a stack page'], ['large', 'inside a large page'], ['unmapped', 'an unmapped page']];

  function machine(inp) {
    let cfg;
    if (inp.layout === 'custom') { cfg = M().config({ bits: inp.bits.map(Number), pageBytes: +inp.page, pteBytes: 8, paBits: 40 }); cfg.large = cfg.levels > 1 ? [{ level: cfg.levels - 2, bytes: M().pageAt(cfg, cfg.levels - 2) }] : []; }
    else cfg = M().preset(inp.layout);
    const vp = BigInt(cfg.vpnBits), lastB = BigInt(cfg.bits[cfg.levels - 1]), one = 1n;
    const code = BigInt(0x400000 >> cfg.offBits) < (one << vp) / 8n ? BigInt(0x400000 >> cfg.offBits) : 1n;
    const heap = ((((one << vp) * 0x36a5n) >> 16n) >> lastB << lastB) + 29n % (one << lastB);
    const stack = (one << vp) - 2n;
    const pages = [code, code + 1n, code + 2n, heap, heap + 1n, heap + 2n, stack, stack + 1n];
    const map = pages.map((v, i) => ({ vpn: v, pfn: BigInt(0x3a00 + ((i * 0x2f1) % 0x400)) }));
    let big = null;
    if (cfg.large && cfg.large.length) {
      const lv = cfg.large[cfg.large.length - 1].level, span = one << BigInt(cfg.lo[lv] - cfg.offBits);
      const vpn = ((one << vp) / 2n / span) * span;
      if (vpn > heap + 4n && vpn + span < stack) { big = { vpn, pfn: span * 7n, level: lv, span }; map.push(big); }
    }
    const pt = M().build(cfg, map, { tableFrame: 0x100 });
    const mask = (v) => v & BigInt(cfg.pageBytes - 1);
    const which = inp.which === 'large' && !big ? 'heap' : inp.which;
    const va = which === 'code' ? M().addr(cfg, code + 1n, mask(0x1a4n)) : which === 'heap' ? M().addr(cfg, heap + 2n, mask(0x2e8n)) : which === 'stack' ? M().addr(cfg, stack + 1n, mask(0xf40n))
      : which === 'large' ? M().addr(cfg, big.vpn + 37n, mask(0x5c8n)) : M().addr(cfg, heap + 9n, mask(0x10cn));
    return { cfg, pt, va, which, big, walk: M().translate(pt, va), usage: M().usage(pt) };
  }
  const hx = (v) => '0x' + BigInt(v).toString(16);

  S.topic({
    id: 'mem-walk', family: 'p10-tables', order: 10, title: 'Walking a multilevel page table',
    blurb: 'One flat table for a 48-bit space would need 2^36 entries. A multilevel table splits the page number into one index per level: the first indexes the root table, whose entry names the frame of the next table, and so on; the last entry names the data frame. Only the tables some mapped page needs exist, so a sparse process needs a few pages of tables. The price is one memory access per level on every TLB miss. A leaf higher up maps a large page, and the walk stops early.',
    inputs: [
      { id: 'layout', kind: 'choice', label: 'Layout', def: 'x86-64', options: LAYOUTS.map(([value, label]) => ({ value, label })) },
      { id: 'which', kind: 'choice', label: 'Address', def: 'heap', options: WHICH.map(([value, label]) => ({ value, label })) },
      { id: 'bits', kind: 'list', label: 'Your bits per level (top first)', def: ['6', '6', '6'], min: 1, max: 5, check: (v) => { for (const x of v) if (!/^\d+$/.test(x) || +x < 1 || +x > 12) return 'Bits per level: 1 to 12 each ("' + x + '")'; return null; } },
      { id: 'page', kind: 'choice', label: 'Your page size', def: '4096', options: [1024, 4096, 16384, 65536].map((v) => ({ value: String(v), label: H.size(v) })) },
    ],
    check: (inp) => (inp.layout === 'custom' && inp.bits.reduce((a, b) => a + +b, 0) + Math.log2(+inp.page) > 64 ? 'Bits per level: with the offset, at most 64 bits' : null),
    presets: [
      { label: 'x86-64, four levels: a heap page', values: {} },
      { label: '32-bit, two levels (10-10-12)', values: { layout: 'x86-32', which: 'code' } },
      { label: 'x86-64: a 2 MiB large page', values: { layout: 'x86-64', which: 'large' } },
      { label: 'x86-64, five levels: the stack', values: { layout: 'x86-64-5', which: 'stack' } },
      { label: 'RISC-V Sv39: an unmapped page', values: { layout: 'sv39', which: 'unmapped' } },
      { label: 'RISC-V Sv48: a code page', values: { layout: 'sv48', which: 'code' } },
      { label: 'Your own: 6-6-6 with 4 KiB pages', values: { layout: 'custom', which: 'heap', bits: ['6', '6', '6'], page: '4096' } },
    ],
    counters: [{ id: 'acc', label: 'memory accesses' }],
    run(inp) {
      const m = machine(inp), cfg = m.cfg, L = cfg.levels, walk = m.walk, KM = S.Kit.mem, W = cfg.vaBits;
      const F = new S.Frames(['acc']), view = H.box(0, 0, 790, 480);
      const reads = walk.steps.filter((s) => s.kind === 'read'), tables = reads.map((r) => m.pt.tables[r.table]);
      const leafLevel = walk.ok ? reads.length - 1 : -1;
      const colW = Math.min(150, Math.floor((770 - L * 26) / (L + 1))), gap = Math.round((770 - (L + 1) * colW) / L), colX = (i) => 10 + i * (colW + gap);
      const draw = (st) => {
        const lvl = st.kind === 'read' ? st.level : st.kind === 'fault' ? reads.length - 1 : st.kind === 'frame' || st.kind === 'end' ? L : -1;
        const items = [H.text('va', 10, 18, 'virtual address ' + M().hex(m.va, W), 'mono', 15), H.text('vaw', 780, 18, W + ' bits = ' + cfg.bits.join(' + ') + ' + ' + cfg.offBits, 'tick', 13, 'end')];
        const bitW = Math.min(26, Math.floor(760 / W));
        const fields = walk.fields.map((f) => ({ name: f.name, bits: f.bits, hi: f.hi, lo: f.lo, value: f.value, cls: KM.lv(f.level), label: f.bits * bitW >= 50 ? (f.level < 0 ? 'offset' : f.name + ' ' + f.value) : '', dim: walk.ok && walk.large && f.level > leafLevel }));
        const act = st.kind === 'split' ? fields.map((f, k) => k) : st.kind === 'read' ? [st.level] : st.kind === 'frame' ? [L] : [];
        // one bit number per field (its top bit), and 0 at the end, so the numbers never crowd
        const nf = fields.length;
        items.push(...KM.strip({ prefix: 'bs', x: Math.round((790 - bitW * W) / 2), y: 48, fields, bitW, h: 28, va: m.va, total: W, bits: true, act, size: 12 }).items.filter((it) => !/^bs:lo\d+$/.test(it.key) || it.key === 'bs:lo' + (nf - 1)));
        const top = 130;
        items.push(H.cellL('root', colX(0), top - 2, colW, 40, ['root register', hx(tables[0].frame)], 'mb-reg' + (lvl === 0 ? ' act' : ''), 12));
        for (let i = 0; i < L; i++) {
          const P = 't' + i, t = tables[i], ty = top + 62;
          if (!t) { items.push(H.cellL(P + ':head', colX(i), ty + (walk.ok ? 110 : 0), colW, 44, ['L' + (i + 1), i > leafLevel && walk.ok ? 'not used' : 'none'], 'mb-thead ghost', 12)); continue; }
          const sel = walk.fields[i].value, n = 2 ** cfg.bits[i];
          const fault = !walk.ok && st.kind !== 'split' && i === reads.length - 1 && lvl >= i;
          const tb = KM.table({ prefix: P, x: colX(i), y: ty, w: colW, rowH: 28, idxW: 40, title: 'L' + (i + 1) + ' table', sub: 'frame ' + hx(t.frame), cls: KM.lv(i), n, sel, entry: (idx) => { const e = t.entries.get(idx); return !e ? { text: '—', cls: 'inv' } : { text: e.leaf ? 'f ' + hx(e.pfn) : '→ ' + hx(e.pfn) }; }, act: lvl === i && !fault, fault, done: lvl > i, dim: lvl < i, size: 12 });
          items.push(...tb.items);
          items.push(H.text(P + ':n', colX(i) + colW / 2, ty + tb.h + 18, n + ' × 8 B', 'tick' + (lvl < i ? ' dim' : ''), 12, 'middle'));
          const r = tb.row(sel);
          if (lvl > i && (tables[i + 1] || i === leafLevel)) {
            const nx = i === leafLevel ? colX(L) : colX(i + 1);
            items.push({ key: 'ar' + i, kind: 'edge', from: { x: r.x + r.w, y: r.y + r.h / 2 }, to: { x: nx, y: ty + 22 }, cls: lvl === i + 1 || (i === leafLevel && lvl === L) ? 'act' : '' });
          }
        }
        if (lvl >= 0) items.push({ key: 'ar:root', kind: 'edge', from: { x: colX(0) + colW / 2, y: top + 38 }, to: { x: colX(0) + colW / 2, y: top + 62 }, cls: lvl === 0 ? 'act' : '' });
        const ty = top + 62;
        if (walk.ok) {
          items.push(H.cellL('pg', colX(L), ty, colW, 44, [walk.large ? M().bytes(walk.pageBytes) + ' page' : 'data page', 'frame ' + hx(walk.pfn)], 'mb-thead' + (lvl >= L ? ' act' : ' dim'), 12));
          items.push(H.cell('pgb', colX(L), ty + 52, colW, 70, '+ ' + hx(walk.offset), 'mb-page mono' + (lvl >= L ? ' act' : ' dim'), 12));
        } else items.push(H.cellL('pg', colX(L), ty, colW, 44, ['data page', 'not mapped'], 'mb-thead ghost', 12));
        const done = st.kind === 'read' ? st.access : st.kind === 'fault' || st.kind === 'frame' || st.kind === 'end' ? walk.accesses : 0;
        const names = cfg.bits.map((_, i) => 'L' + (i + 1)).concat('data');
        items.push(H.text('acct', 10, 410, 'memory accesses', 'title'));
        names.forEach((nm, k) => {
          const used = walk.ok ? (k <= leafLevel || k === L) : k < walk.accesses;
          const on = used && (k === L ? done === walk.accesses && walk.ok : k < done);
          items.push(H.cell('acc' + k, 10 + k * 64, 420, 58, 30, nm, 'mb-acc ' + (k < L ? KM.lv(k) : 'data') + (on ? ' on' : '') + (k === L ? ' data' : '') + (!used ? ' dim' : ''), 12));
        });
        items.push(H.text('accn', 10 + names.length * 64 + 6, 442, '= ' + done, 'mb-big' + (st.kind === 'fault' ? ' bad' : walk.ok && lvl >= L ? ' good' : ''), 17));
        if (st.kind === 'end') items.push(H.text('use', 780, 442, 'tables: ' + M().bytes(m.usage.bytes) + ' · one flat table: ' + M().bytes(m.usage.flatBytes), 'tick', 13, 'end'));
        return items;
      };
      const meta = (st, extra) => Object.assign({ phase: st.kind, levels: L, bits: cfg.bits, off: cfg.offBits, va: W, pte: cfg.pteBytes, fields: walk.fields.map((f) => f.value), index: st.index === undefined ? -1 : st.index, access: st.access || 0, accesses: walk.accesses, sz: [M().bytes(walk.pageBytes || cfg.pageBytes)] }, extra || {});
      walk.steps.forEach((st) => {
        if (st.kind === 'read') F.set('acc', st.access);
        if (st.kind === 'frame' || st.kind === 'fault') F.set('acc', walk.accesses);
        const say = (st.kind === 'split' ? st.say + (m.which === 'large' ? ' The page it falls in is part of a large page, so the walk will stop early.' : '') : st.say).replace(/(\d+) table reads? and/, (x, n) => (n === '1' ? '1 read of a table' : n + ' reads of the tables') + ' and');
        F.add({ items: draw(st), say, meta: meta(st, { lowBits: st.kind === 'frame' ? Math.log2(st.pageBytes) : 0, reads: walk.steps.filter((q) => q.kind === 'read').length }), view, hl: { d: st.kind === 'split' ? [0] : st.kind === 'read' ? [1, 2] : st.kind === 'frame' ? (st.large ? [4] : [3]) : [5] } });
      });
      const u = m.usage;
      F.add({ items: draw({ kind: 'end' }), say: `The walk took ${H.plural(walk.accesses, 'memory access', 'memory accesses')}; with the translation in the TLB the next access to this page takes 1. This process maps ${H.plural(m.pt.map.size, 'page')}` + (m.big ? ' and one large page' : '') + ` using ${H.plural(u.tables, 'table')} (${H.list(u.perLevel.map((n, i) => n + ' at L' + (i + 1)))}), ${M().bytes(u.bytes)} in all; one flat table for the same space would take ${M().bytes(u.flatBytes)}.`, meta: { phase: 'end', accesses: walk.accesses, pages: m.pt.map.size, tables: u.tables, perLevel: u.perLevel, sz: [M().bytes(u.bytes), M().bytes(u.flatBytes)] }, view, hl: { d: [6] } });
      return { frames: F.list, def: H.def('Multilevel walk', ['VA = L1 | L2 | … | Ln | offset', 'entry = table[index]: frame of the next table', 'address of entry = table base + index × entry size', 'last entry: the data frame; PA = frame | offset', 'a leaf above the last level: a large page', 'an entry not valid: a page fault', 'only the tables mapped pages need exist']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'split', pick: 'option', ask: 'How many memory accesses will this load make, counting the data, if the TLB misses?', options: (fr, i) => { const L = fr[i].meta.levels; return [...new Set([1, 2, L, L + 1, L + 2])].map(String); }, answer: (fr, i) => String(fr[i].meta.accesses), explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => f.meta.phase === 'read' && fr[i + 1].meta.phase === 'read', once: true, pick: 'option', ask: (fr, i) => `Which entry of the next table will be read?`, options: (fr, i) => { const v = fr[i + 1].meta.index; return [...new Set([v, fr[i].meta.index, 0, v + 1])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.index), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'x86-64 with 4 KiB pages and 8-byte entries: why 9 bits per level?', options: ['a 4 KiB table holds 512 entries of 8 bytes', 'it is the size of the TLB', '48 / 5 ≈ 9', 'chosen at random'], answer: 0, why: '4096 / 8 = 512 = 2^9, so each table fills one page.' },
      { q: 'A four-level walk and the data: how many memory accesses on a TLB miss?', options: ['5', '4', '1', '2'], answer: 0, why: 'One per level, then the data.' },
      { q: 'A leaf entry at level 3 of 4 (x86-64) maps…', options: ['a 2 MiB page', 'a 4 KiB page', 'a 1 GiB page', 'nothing'], answer: 0, why: 'The last 9 + 12 = 21 bits become offset: 2 MiB.' },
      { q: 'Why does a sparse process need little table memory with many levels?', options: ['tables exist only under mapped regions', 'entries are compressed', 'the TLB stores them', 'the kernel shares them'], answer: 0, why: 'An invalid upper entry stands for a whole unmapped region.' },
      { q: '32-bit with 4 KiB pages and 4-byte entries splits as…', options: ['10 + 10 + 12', '9 + 9 + 14', '16 + 16', '8 + 12 + 12'], answer: 0, why: 'A 4 KiB table holds 1024 = 2^10 entries.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
