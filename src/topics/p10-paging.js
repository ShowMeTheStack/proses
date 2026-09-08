// Part 10, paging. A small address space with one linear page table: the address split into a page number and an
// offset, the page number indexing the table, the entry naming a frame, and the frame joined to the offset; and the
// space wasted inside the last page of each allocation. Engines: S.Mem.config / build / translate, S.Mem.internalFrag.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const NFRAMES = 16, TABLE_FRAME = 15, PTE = 4;
  const num = (x) => (/^0x[0-9a-f]+$/i.test(x) ? parseInt(x, 16) : /^\d+$/.test(x) ? +x : NaN);
  const pageOpts = [32, 64, 128, 256, 512, 1024, 2048, 4096].map((v) => ({ value: String(v), label: H.size(v) }));

  function setup(inp) {
    const pageBytes = +inp.page, off = M().log2(pageBytes), vpnBits = inp.va - off;
    const map = inp.map.map((x) => x.split(':').map(Number));
    const cfg = M().config({ vaBits: inp.va, pageBytes, levels: 1, pteBytes: PTE, paBits: off + 4 });
    const pt = M().build(cfg, map.map(([p, f]) => [BigInt(p), BigInt(f)]), { tableFrame: TABLE_FRAME });
    return { pageBytes, off, vpnBits, n: 2 ** vpnBits, map: new Map(map), cfg, pt, paBits: off + 4 };
  }

  S.topic({
    id: 'mem-paging', family: 'p10-paging', order: 10, title: 'Paging: the address split',
    blurb: 'Paging cuts the address space into pages and physical memory into frames of the same size, so any page can go in any free frame and there is no external fragmentation. An address splits into a page number (the high bits) and an offset (the low bits). The page number indexes the page table; the entry, if valid, names a frame; the frame number joined to the unchanged offset is the physical address. The table itself lives in memory, so every access costs a table read first.',
    inputs: [
      { id: 'va', kind: 'number', label: 'Virtual address bits', def: 14, min: 6, max: 16 },
      { id: 'page', kind: 'choice', label: 'Page size', def: '1024', options: pageOpts },
      { id: 'map', kind: 'list', label: 'Mapped pages (page:frame)', def: ['0:5', '1:9', '2:3', '3:14', '6:0', '15:7'], min: 1, max: 15 },
      { id: 'addrs', kind: 'list', label: 'Addresses (hex or decimal)', def: ['0x0a2c', '0x0c10', '0x1404', '0x3ffe'], min: 1, max: 6 },
    ],
    check(inp) {
      const pb = +inp.page, off = Math.log2(pb), pages = 2 ** (inp.va - off);
      if (inp.va - off < 1) return 'Virtual address bits: more than the ' + off + ' offset bits of ' + H.size(pb) + ' pages';
      if (pages > 64) return 'Virtual address bits: at most 64 pages, so at most ' + (off + 6) + ' bits with ' + H.size(pb) + ' pages';
      const fr = new Set(), pg = new Set();
      for (const x of inp.map) {
        const m = /^(\d+):(\d+)$/.exec(x);
        if (!m) return 'Mapped pages: "' + x + '" is not page:frame';
        if (+m[1] >= pages) return 'Mapped pages: page ' + m[1] + ' is outside the ' + pages + ' pages';
        if (+m[2] >= TABLE_FRAME) return 'Mapped pages: frames 0 to ' + (TABLE_FRAME - 1) + ' (frame ' + TABLE_FRAME + ' holds the page table)';
        if (fr.has(m[2])) return 'Mapped pages: frame ' + m[2] + ' is used twice';
        if (pg.has(m[1])) return 'Mapped pages: page ' + m[1] + ' is mapped twice';
        fr.add(m[2]); pg.add(m[1]);
      }
      for (const a of inp.addrs) { const v = num(a); if (!(v >= 0)) return 'Addresses: "' + a + '" is not a number (0x0a2c or 2604)'; if (v >= 2 ** inp.va) return 'Addresses: ' + a + ' does not fit ' + inp.va + ' bits'; }
      return null;
    },
    presets: [
      { label: '14-bit addresses, 1 KiB pages', values: {} },
      { label: 'Tiny: 8-bit addresses, 32-byte pages', values: { va: 8, page: '32', map: ['0:3', '1:7', '4:1', '7:12'], addrs: ['0x05', '0x27', '0x9f', '0x60', '0xff'] } },
      { label: '16-bit addresses, 4 KiB pages', values: { va: 16, page: '4096', map: ['0:2', '1:4', '2:6', '15:9'], addrs: ['0x1234', '0x2fff', '0xf00d', '0x8000'] } },
      { label: 'Many small pages: 64 of 256 bytes', values: { va: 14, page: '256', map: ['0:1', '1:2', '2:3', '40:8', '63:11'], addrs: ['0x2810', '0x3fff', '0x0105', '0x2900'] } },
      { label: 'One page, three offsets', values: { addrs: ['0x0800', '0x0801', '0x0bff'] } },
    ],
    counters: [{ id: 'ok', label: 'translated' }, { id: 'faults', label: 'page faults' }, { id: 'acc', label: 'memory accesses' }],
    run(inp) {
      const m = setup(inp), KM = S.Kit.mem, F = new S.Frames(['ok', 'faults', 'acc']), view = H.box(0, 0, 790, 480);
      const bitW = Math.min(26, Math.floor(400 / inp.va));
      const frameOf = new Map([...m.map].map(([p, f]) => [f, p]));
      const runs = [];
      for (let f = 0; f < NFRAMES; f++) runs.push({ key: 'f' + f, start: f * m.pageBytes, size: m.pageBytes, cls: f === TABLE_FRAME ? 'os' : frameOf.has(f) ? 'p1' : 'free', text: f === TABLE_FRAME ? 'page table' : frameOf.has(f) ? 'page ' + frameOf.get(f) : '' });
      const draw = (a, r, phase) => {
        const items = [];
        const vpn = a === null ? -1 : Number(M().vpnOf(m.cfg, a)), off = a === null ? 0 : a % m.pageBytes;
        items.push(H.text('va', 20, 22, a === null ? m.n + ' pages of ' + H.size(m.pageBytes) + ', ' + NFRAMES + ' frames' : 'virtual address ' + M().hex(a, inp.va) + ' = ' + a, 'strong', 15));
        if (a !== null) {
          const fields = [{ name: 'page', bits: m.vpnBits, hi: inp.va - 1, lo: m.off, cls: KM.lv(0), label: 'page ' + vpn }, { name: 'offset', bits: m.off, hi: m.off - 1, lo: 0, cls: KM.lv(-1), label: 'offset ' + off }];
          items.push(...KM.strip({ prefix: 'vs', x: 20, y: 52, fields, bitW, h: 28, va: BigInt(a), bits: true, act: phase === 'split' ? [0, 1] : [0], size: 13 }).items);
        }
        // the page table: every entry when there are at most 16, else the first, the one used and the last
        const sel = phase === 'lookup' || phase === 'result' || phase === 'fault' ? vpn : -1, bad = phase === 'fault';
        items.push(H.text('ptt', 20, 140, 'page table, in frame ' + TABLE_FRAME, 'title'));
        if (m.n <= 16) {
          for (let i = 0; i < m.n; i++) {
            const y = 150 + i * 20, has = m.map.has(i), on = i === sel;
            items.push(H.cell('pi' + i, 20, y, 36, 20, i, 'mb-idx' + (on ? ' sel lv0' : ''), 12, { rx: 0 }));
            items.push(H.cell('pe' + i, 56, y, 112, 20, has ? 'frame ' + m.map.get(i) : 'not valid', 'mb-entry' + (has ? '' : ' inv') + (on ? (bad ? ' hot' : ' act') : ''), 12, { rx: 0 }));
          }
        } else items.push(...KM.table({ prefix: 'pt', x: 20, y: 150, w: 148, rowH: 26, idxW: 36, title: m.n + ' entries', sub: PTE + ' bytes each', cls: KM.lv(0), n: m.n, sel: sel < 0 ? 0 : sel, entry: (i) => (m.map.has(i) ? { text: 'frame ' + m.map.get(i) } : { text: 'not valid', cls: 'inv' }), act: sel >= 0 && !bad, fault: bad, size: 12 }).items);
        // the working, line by line
        const lines = [];
        if (a !== null) {
          lines.push(['page = ' + a + ' ÷ ' + m.pageBytes + ' = ' + vpn, '']);
          lines.push(['offset = ' + a + ' mod ' + m.pageBytes + ' = ' + off, '']);
          if (phase !== 'split') lines.push([m.map.has(vpn) ? 'entry ' + vpn + ': valid, frame ' + m.map.get(vpn) : 'entry ' + vpn + ': not valid', m.map.has(vpn) ? '' : 'bad']);
          if (phase === 'result') lines.push(['physical = ' + m.map.get(vpn) + ' × ' + m.pageBytes + ' + ' + off + ' = ' + r.pa, 'good']);
          if (phase === 'fault') lines.push(['page fault: the kernel takes over', 'bad']);
        }
        lines.forEach((l, k) => items.push(H.text('wk' + k, 210, 160 + k * 30, l[0], 'p10-sum' + (l[1] ? ' ' + l[1] : ''), 14)));
        if (phase === 'result') {
          const pf = [{ name: 'frame', bits: 4, hi: m.paBits - 1, lo: m.off, cls: KM.lv(1), label: 'frame ' + m.map.get(vpn) }, { name: 'offset', bits: m.off, hi: m.off - 1, lo: 0, cls: KM.lv(-1), label: 'offset ' + off }];
          items.push(H.text('pat', 210, 330, 'physical address ' + M().hex(r.pa, m.paBits) + ' = ' + r.pa, 'strong', 14));
          items.push(...KM.strip({ prefix: 'ps', x: 210, y: 356, fields: pf, bitW: Math.min(24, Math.floor(330 / m.paBits)), h: 28, va: BigInt(r.pa), bits: true, act: [0], size: 13 }).items);
        }
        const act = phase === 'result' ? m.map.get(vpn) : -1;
        const bar = S.Kit.p10.vbar({ prefix: 'pm', x: 640, y: 20, w: 120, h: 440, total: NFRAMES * m.pageBytes, runs: runs.map((q, f) => Object.assign({}, q, { cls: q.cls + (f === act ? ' act' : phase !== 'split' && phase !== 'start' && phase !== 'end' && f === TABLE_FRAME && a !== null ? ' act' : '') })), ticks: Array.from({ length: NFRAMES }, (_, f) => f * m.pageBytes), tickFmt: (v) => 'f' + v / m.pageBytes, tickSide: 'left', minGap: 12 });
        items.push(...bar.items);
        items.push(H.text('pml', 700, 476, 'physical memory', 'tick', 12, 'middle'));
        return items;
      };
      F.add({ items: draw(null, null, 'start'), say: `${inp.va}-bit addresses and ${H.size(m.pageBytes)} pages: the low ${H.plural(m.off, 'bit')} are the offset and the high ${H.plural(m.vpnBits, 'bit')} the page number, so there are ${m.n} pages. Physical memory has ${NFRAMES} frames; the page table, ${m.n} entries of ${PTE} bytes, sits in frame ${TABLE_FRAME}.`, meta: { phase: 'start', va: inp.va, off: m.off, vpnBits: m.vpnBits, n: m.n, frames: NFRAMES, pte: PTE, tf: TABLE_FRAME, page: m.pageBytes }, view, hl: { d: [0] } });
      for (const s of inp.addrs) {
        const a = num(s), r = M().translate(m.pt, BigInt(a)), vpn = Number(M().vpnOf(m.cfg, a)), off = a % m.pageBytes;
        const base = { addr: a, vpn, off, page: m.pageBytes, offBits: m.off, vpnBits: m.vpnBits };
        F.add({ items: draw(a, r, 'split'), say: `Address ${a}: the high ${H.plural(m.vpnBits, 'bit')} ${m.vpnBits === 1 ? 'is' : 'are'} page ${vpn} and the low ${H.plural(m.off, 'bit')} the offset ${off}. In arithmetic, ${a} ÷ ${m.pageBytes} = ${vpn} remainder ${off}.`, meta: Object.assign({ phase: 'split' }, base), view, hl: { d: [0, 1] } });
        F.count('acc');
        F.add({ items: draw(a, r, 'lookup'), say: `The MMU reads entry ${vpn} of the table in frame ${TABLE_FRAME}: one memory access before the data. ` + (r.ok ? `It is valid and names frame ${Number(r.pfn)}.` : 'Its valid bit is clear: this page has no frame.'), meta: Object.assign({ phase: 'lookup', valid: r.ok, tf: TABLE_FRAME, frame: r.ok ? Number(r.pfn) : -1 }, base), view, hl: { d: [2] } });
        if (r.ok) {
          F.count('ok'); F.count('acc');
          F.add({ items: draw(a, r, 'result'), say: `Frame ${Number(r.pfn)} joined to offset ${off}: ${Number(r.pfn)} × ${m.pageBytes} + ${off} = physical address ${Number(r.pa)}. The offset passes through unchanged; only the page number is replaced.`, meta: Object.assign({ phase: 'result', frame: Number(r.pfn), pa: Number(r.pa) }, base), view, hl: { d: [3] } });
        } else {
          F.count('faults');
          F.add({ items: draw(a, r, 'fault'), say: `Page ${vpn} is not mapped, so the MMU raises a page fault and the kernel decides: bring the page in, or end the process for touching memory it does not own.`, meta: Object.assign({ phase: 'fault' }, base), view, hl: { d: [4] } });
        }
      }
      const c = F.counts;
      F.add({ items: draw(null, null, 'end'), say: `${H.plural(c.ok, 'address', 'addresses')} translated and ${H.plural(c.faults, 'fault')} on unmapped pages, with ${H.plural(c.acc, 'memory access', 'memory accesses')} in all: every reference reads the table first, which doubles the cost of memory. That is the problem the TLB solves.`, meta: { phase: 'end', ok: c.ok, faults: c.faults, acc: c.acc }, view });
      return { frames: F.list, def: H.def('Paging', ['page = address ÷ page size (the high bits)', 'offset = address mod page size (the low bits)', 'entry = table[page]: valid bit and frame', 'physical = frame × page size + offset', 'not valid: a page fault']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'split', pick: 'item', ask: 'Click the page-table entry this address will use.', answer: (fr, i) => (fr[i].meta.vpn < 16 && fr[i].meta.page * 16 >= 0 && fr.find((x) => x.meta.phase === 'start').meta.n <= 16 ? 'pe' + fr[i].meta.vpn : null), explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => f.meta.phase === 'lookup' && fr[i + 1].meta.phase === 'result', once: true, pick: 'option', ask: (fr, i) => `Which physical address does ${fr[i].meta.addr} become?`, options: (fr, i) => { const m = fr[i + 1].meta; return [...new Set([m.pa, m.addr, m.frame * m.page, m.frame + m.off])].map(String); }, answer: (fr, i) => String(fr[i + 1].meta.pa), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: '16-bit addresses with 1 KiB pages. How many bits is the page number?', options: ['6', '10', '16', '4'], answer: 0, why: 'The offset takes log2(1024) = 10 bits; 16 − 10 = 6 remain.' },
      { q: 'Address 5000 with 1 KiB (1024-byte) pages lies in which page, at which offset?', options: ['page 4, offset 904', 'page 5, offset 0', 'page 4, offset 1000', 'page 3, offset 904'], answer: 0, why: '5000 = 4 × 1024 + 904.' },
      { q: 'Page 4 is in frame 9. Where does address 5000 land?', options: ['9 × 1024 + 904 = 10120', '5000 + 9', '9 × 5000', '904'], answer: 0, why: 'The frame replaces the page number; the offset stays.' },
      { q: 'Why does paging have no external fragmentation?', options: ['every frame is the same size, so any free frame fits any page', 'pages are always full', 'the TLB removes it', 'it compacts memory'], answer: 0, why: 'A free frame anywhere can take any page.' },
      { q: 'With the table in memory and no TLB, one load costs…', options: ['two memory accesses', 'one', 'none', 'three'], answer: 0, why: 'One to read the entry, one for the data.' },
    ],
  });

  S.topic({
    id: 'mem-internal-frag', family: 'p10-paging', order: 20, title: 'Internal fragmentation',
    blurb: 'Memory is handed out in whole pages, so an allocation that is not a multiple of the page size leaves the rest of its last page unused. That waste is inside an allocated page, out of anyone else\'s reach: internal fragmentation. On average it is about half a page per allocation, so it grows with the page size.',
    inputs: [
      { id: 'page', kind: 'choice', label: 'Page size', def: '4096', options: [512, 1024, 2048, 4096, 8192, 16384].map((v) => ({ value: String(v), label: H.size(v) })) },
      { id: 'sizes', kind: 'list', label: 'Allocations (bytes)', def: ['5000', '12288', '700', '9000', '4097', '30000'], min: 1, max: 7, check: (v) => { for (const x of v) if (!/^\d+$/.test(x) || +x < 1 || +x > 65536) return 'Allocations: whole numbers of bytes from 1 to 65536 ("' + x + '")'; return null; } },
    ],
    presets: [
      { label: 'Six allocations, 4 KiB pages', values: {} },
      { label: 'The same with 16 KiB pages', values: { page: '16384' } },
      { label: 'The same with 512-byte pages', values: { page: '512' } },
      { label: 'Exact multiples waste nothing', values: { sizes: ['4096', '8192', '12288'] } },
      { label: 'One byte over', values: { sizes: ['4097', '8193', '1'] } },
    ],
    counters: [{ id: 'waste', label: 'bytes wasted' }],
    run(inp) {
      const pb = +inp.page, sizes = inp.sizes.map(Number), r = M().internalFrag(sizes, pb), F = new S.Frames(['waste']), view = H.box(0, 0, 790, 480);
      const maxPages = Math.max(...r.rows.map((x) => x.pages));
      const cw = Math.max(4, Math.min(56, Math.floor(460 / maxPages)));
      const others = [512, 1024, 2048, 4096, 8192, 16384].map((p) => ({ p, f: M().internalFrag(sizes, p) }));
      const draw = (upto, phase) => {
        const items = [H.text('t', 20, 22, phase === 'sizes' ? 'the same ' + sizes.length + ' allocations at six page sizes' : sizes.length + ' allocations in ' + H.size(pb) + ' pages', 'strong', 15)];
        if (phase === 'sizes') {
          const maxW = Math.max(...others.map((o) => o.f.waste)) || 1;
          others.forEach((o, k) => {
            const y = 60 + k * 62, w = Math.max(2, Math.round((o.f.waste / maxW) * 470));
            items.push(H.text('cl' + k, 110, y + 26, H.size(o.p) + ' pages', 'strong', 13, 'end'));
            items.push(H.cell('cb' + k, 124, y + 6, w, 32, '', 'p10-run waste' + (o.p === pb ? ' act' : ''), 12, { rx: 3 }));
            items.push(H.text('cv' + k, 124 + w + 10, y + 27, o.f.waste + ' B (' + H.pct(o.f.fraction) + ')', o.p === pb ? 'act' : 'tick', 13));
          });
          return items;
        }
        r.rows.forEach((row, k) => {
          const y = 48 + k * 50, on = k === upto && phase === 'row', shown = k <= upto;
          items.push(H.text('sz' + k, 110, y + 22, row.size + ' B', 'mono', 13, 'end'));
          for (let p = 0; p < row.pages; p++) {
            const last = p === row.pages - 1, full = last ? (row.size - (row.pages - 1) * pb) / pb : 1, x = 124 + p * cw;
            items.push(H.cell('pg' + k + '_' + p, x, y + 6, cw - 2, 26, '', 'p10-run free' + (on ? ' act' : '') + (shown ? '' : ' dimrun'), 12, { rx: 2 }));
            items.push(H.cell('us' + k + '_' + p, x, y + 6, Math.max(1, Math.round((cw - 2) * full)), 26, '', 'p10-run p1' + (shown ? '' : ' dimrun'), 12, { rx: 2, audit: 'overlap-ok' }));
            if (last && row.waste && shown) items.push(H.cell('ws' + k, x + Math.round((cw - 2) * full), y + 6, Math.max(1, cw - 2 - Math.round((cw - 2) * full)), 26, '', 'p10-run waste', 12, { rx: 2, audit: 'overlap-ok' }));
          }
          if (shown) items.push(H.text('rw' + k, 600, y + 24, H.plural(row.pages, 'page') + ', ' + row.waste + ' B wasted', row.waste ? 'bad' : 'good', 13));
        });
        if (phase === 'total') items.push(H.text('tot', 20, 48 + sizes.length * 50 + 26, 'wasted ' + r.waste + ' of ' + r.used + ' bytes allocated = ' + H.pct(r.fraction), 'p10-sum bad', 15));
        return items;
      };
      F.add({ items: draw(-1, 'start'), say: `${sizes.length} allocations, rounded up to whole pages of ${pb} bytes. The red part of each last page is allocated but unused.`, meta: { phase: 'start', n: sizes.length, page: pb }, view, hl: { d: [0] } });
      r.rows.forEach((row, k) => {
        F.count('waste', row.waste);
        F.add({ items: draw(k, 'row'), say: `${H.plural(row.size, 'byte')} need ⌈${row.size} / ${pb}⌉ = ${H.plural(row.pages, 'page')}, ${row.bytes} bytes; ` + (row.waste ? `${row.waste} bytes of the last page are wasted.` : 'it is an exact multiple, so nothing is wasted.'), meta: { phase: 'row', size: row.size, pages: row.pages, bytes: row.bytes, waste: row.waste, page: pb }, view, hl: { d: [1, 2] } });
      });
      const avg = (sizes.length * pb) / 2;
      F.add({ items: draw(sizes.length, 'total'), say: `In all ${r.waste} of ${r.used} allocated bytes are wasted, ${H.pct(r.fraction)}. A rough rule says half a page per allocation, ${sizes.length} × ${pb} / 2 = ${avg} bytes.`, meta: { phase: 'total', two: 2, waste: r.waste, used: r.used, fraction: r.fraction, avg, n: sizes.length, page: pb }, view, hl: { d: [3] } });
      F.add({ items: draw(sizes.length, 'sizes'), say: `The same allocations at every page size: ` + H.list(others.map((o) => o.f.waste + ' bytes with ' + H.size(o.p) + ' pages')) + '. Larger pages waste more inside, but need fewer table entries and let the TLB reach further.', meta: { phase: 'sizes', wastes: others.map((o) => o.f.waste), fr: others.map((o) => o.f.fraction), sz: others.map((o) => H.size(o.p)) }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('Internal fragmentation', ['pages = ⌈size / page⌉', 'allocated = pages × page', 'waste = allocated − size (all in the last page)', 'expected: about page / 2 per allocation', 'bigger pages: more waste, smaller tables']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'row', pick: 'option', ask: (fr, i) => `How many bytes will the allocation of ${fr[i + 1].meta.size} waste?`, options: (fr, i) => { const m = fr[i + 1].meta; return [...new Set([m.waste, m.page - m.waste, 0, m.page])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.waste), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: '4 KiB pages. How much does a 9000-byte allocation waste?', options: ['3288 bytes', '904 bytes', '0', '4096 bytes'], answer: 0, why: '3 pages = 12288 bytes; 12288 − 9000 = 3288.' },
      { q: 'Internal fragmentation is waste…', options: ['inside allocated pages', 'between allocated blocks', 'in the page table', 'on the disk'], answer: 0, why: 'External fragmentation is between blocks; internal is inside them.' },
      { q: 'Doubling the page size roughly doubles…', options: ['the expected internal fragmentation', 'the number of page-table entries', 'the external fragmentation', 'the TLB misses'], answer: 0, why: 'About half a page is wasted per allocation.' },
      { q: 'An allocation of exactly 8192 bytes with 4 KiB pages wastes…', options: ['nothing', '4096 bytes', '2048 bytes', '1 byte'], answer: 0, why: 'It fills two pages exactly.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
