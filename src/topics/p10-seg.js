// Part 10, segmentation. A 16-bit address is a 2-bit segment number and a 14-bit offset; the segment table gives
// each segment's base, limit, growth direction and protection bits. Each access is split, looked up, checked against
// the limit (a stack segment grows down, so its legal offsets are the top of the range) and the protection, then
// relocated; with paging on, the offset is split again into a page and an offset in the segment's own page table.
// The engine is S.Mem.segSplit / segTranslate.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const SEG_BITS = 2, OFF_BITS = 14, MAXOFF = 2 ** OFF_BITS, PAGE = 1024, PHYS = 40960;
  const BASEF = [4, 12, 20, 32];
  const ACC = { r: 'read', w: 'write', x: 'execute' };

  function table(inp) {
    const segs = [
      { name: 'code', base: 4096, limit: 3000, grow: 'up', prot: 'rx' },
      { name: 'data', base: 12000, limit: 1800, grow: 'up', prot: 'rw' },
      { name: 'heap', base: 20000, limit: inp.heap, grow: 'up', prot: 'rw' },
      { name: 'stack', base: 30000, limit: inp.stack, grow: 'down', prot: 'rw' },
    ];
    const t = { segs, offBits: OFF_BITS };
    if (inp.paging === 'on') {
      // each segment's pages in frames of their own; heap page 2 and stack page 1 are not in memory
      t.paging = { pageBytes: PAGE, tables: segs.map((s, i) => Array.from({ length: Math.ceil(s.limit / PAGE) }, (_, p) => ((i === 2 && p === 2) || (i === 3 && p === 1) ? null : BASEF[i] + p))) };
    }
    return t;
  }
  /** "2.120:w" (segment.offset) or "16675:r" / "0x4123:r" (a whole address) */
  function parseRef(x) {
    let m;
    if ((m = /^(\d)\.(\d+):([rwx])$/.exec(x))) return { seg: +m[1], offset: +m[2], access: m[3], addr: +m[1] * MAXOFF + +m[2] };
    if ((m = /^(0x[0-9a-fA-F]+|\d+):([rwx])$/.exec(x))) { const a = Number(m[1]), s = M().segSplit(a, SEG_BITS, OFF_BITS); return { seg: s.seg, offset: s.offset, access: m[2], addr: a }; }
    return null;
  }
  const checkRefs = (v) => {
    for (const x of v) {
      const r = parseRef(x);
      if (!r) return 'Accesses: "' + x + '" is not segment.offset:access (2.120:w) or address:access (0x4123:r)';
      if (r.offset >= MAXOFF || r.seg > 3 || r.addr >= 2 ** 16) return 'Accesses: "' + x + '" does not fit a 16-bit address (offsets below ' + MAXOFF + ')';
    }
    return null;
  };

  S.topic({
    id: 'mem-segmentation', family: 'p10-seg', order: 10, title: 'Segmentation',
    blurb: 'Segmentation gives each part of a program its own base and limit: code, data, heap and stack become segments that can sit anywhere in memory and grow apart. The top bits of an address name the segment and the rest are the offset. The segment table holds each segment\'s base, limit, growth direction and protection bits, so the hardware can stop a write to code or a read past the heap. A stack grows down, so its legal offsets are the top of the range. With paging underneath, each segment has its own page table and needs no contiguous memory.',
    inputs: [
      { id: 'heap', kind: 'number', label: 'Heap limit (bytes)', def: 5000, min: 256, max: 8192 },
      { id: 'stack', kind: 'number', label: 'Stack limit (bytes)', def: 2500, min: 256, max: 6000 },
      { id: 'paging', kind: 'choice', label: 'Paging', def: 'off', options: [{ value: 'off', label: 'off: base + offset' }, { value: 'on', label: 'on: 1 KiB pages per segment' }] },
      { id: 'refs', kind: 'list', label: 'Accesses (seg.offset:rwx or address:rwx)', def: ['0.300:x', '0.300:w', '0x4123:r', '1.1900:r', '2.4999:w', '3.16000:w', '3.13000:r'], min: 1, max: 9, check: checkRefs },
    ],
    presets: [
      { label: 'Code, data, heap and stack', values: {} },
      { label: 'The stack grows down', values: { refs: ['3.16383:w', '3.13884:w', '3.13883:w'], stack: 2500 } },
      { label: 'The stack grows: a bigger limit', values: { refs: ['3.16383:w', '3.13884:w', '3.13883:w'], stack: 4000 } },
      { label: 'Protection bits', values: { refs: ['0.10:r', '0.10:x', '0.10:w', '1.10:x', '1.10:w'] } },
      { label: 'Segmentation with paging', values: { paging: 'on', refs: ['0.2100:x', '2.1500:r', '2.2100:w', '3.15000:w', '3.14500:r', '2.4999:w'] } },
      { label: 'Whole addresses split', values: { refs: ['0x0200:x', '0x4100:r', '0x8a00:w', '0xc000:w', '0xfff0:w'] } },
    ],
    counters: [{ id: 'ok', label: 'translated' }, { id: 'faults', label: 'faults' }],
    run(inp) {
      const T = table(inp), refs = inp.refs.map(parseRef), F = new S.Frames(['ok', 'faults']), view = H.box(0, 0, 790, 480);
      const KM = S.Kit.mem, paged = !!T.paging;
      // physical memory: the segments where they sit, or each segment's pages in their frames
      const runs = [];
      if (!paged) T.segs.forEach((s, i) => runs.push({ key: 's' + i, start: s.base, size: s.limit, cls: H.pc(i), text: s.name }));
      else T.paging.tables.forEach((tb, i) => tb.forEach((f, p) => { if (f !== null) runs.push({ key: 'f' + f, start: f * PAGE, size: PAGE, cls: H.pc(i) }); }));
      runs.sort((a, b) => a.start - b.start);
      const full = [];
      let at = 0;
      for (const r of runs) { if (r.start > at) full.push({ key: 'g' + at, start: at, size: r.start - at, cls: 'free' }); full.push(r); at = r.start + r.size; }
      if (at < PHYS) full.push({ key: 'g' + at, start: at, size: PHYS - at, cls: 'free' });
      const draw = (ref, res, phase) => {
        const items = [];
        const sel = ref ? ref.seg : -1;
        const fault = res && !res.ok ? res.fault : null;
        // the address
        if (ref) {
          items.push(H.text('va', 20, 22, 'address ' + ref.addr + ' = segment ' + ref.seg + ', offset ' + ref.offset + ', ' + ACC[ref.access], 'strong', 15));
          const fields = [{ name: 'seg', bits: SEG_BITS, hi: 15, lo: OFF_BITS, cls: KM.lv(0), label: 'segment ' + ref.seg }, { name: 'offset', bits: OFF_BITS, hi: OFF_BITS - 1, lo: 0, cls: KM.lv(-1), label: 'offset ' + ref.offset }];
          items.push(...KM.strip({ prefix: 'bs', x: 20, y: 52, fields, bitW: 25, h: 28, va: BigInt(ref.addr), bits: true, act: phase === 'split' ? [0, 1] : [0], size: 13 }).items);
        } else items.push(H.text('va', 20, 22, 'segment table and physical memory', 'strong', 15));
        // the segment table
        const cols = [['seg', 40], ['name', 64], ['base', 64], ['limit', 64], ['grows', 62], ['prot', 52]];
        let x = 20;
        const ty = 132;
        cols.forEach(([n, w]) => { items.push(H.cell('th' + n, x, ty, w, 28, n, 'head', 13)); x += w; });
        T.segs.forEach((s, i) => {
          let cx = 20;
          const y = ty + 30 + i * 30, on = i === sel;
          const cls = on ? (fault === 'limit' || fault === 'protection' ? ' hot' : ' act') : '';
          [String(i), s.name, String(s.base), String(s.limit), s.grow, s.prot].forEach((v, c) => {
            const hotCell = on && ((fault === 'limit' && c === 3) || (fault === 'protection' && c === 5));
            items.push(H.cell('tr' + i + '_' + c, cx, y, cols[c][1], 28, v, 'mono' + (hotCell ? ' hot' : cls || (c === 1 ? ' ' + H.pc(i) : '')), 13));
            cx += cols[c][1];
          });
        });
        // the checks
        if (res && phase === 'result') {
          const lines = [];
          for (const st of res.steps) {
            if (st.kind === 'limit') lines.push(['offset ' + ref.offset + ' in [' + st.lo + ', ' + st.hi + ')', 'good']);
            if (st.kind === 'prot') lines.push([ACC[st.access] + ' allowed by ' + T.segs[ref.seg].prot, 'good']);
            if (st.kind === 'page') lines.push(['page ' + st.page + ', offset ' + st.offset + ' → frame ' + st.frame, 'good']);
            if (st.kind === 'relocate') lines.push(['physical address ' + st.pa, 'p10-sum good']);
            if (st.kind === 'fault') lines.push([{ limit: 'segmentation fault: outside the limit', protection: 'protection fault: ' + ACC[ref.access] + ' not in ' + T.segs[ref.seg].prot, page: 'page fault: the page is not in memory', segment: 'no such segment' }[st.fault], 'p10-sum bad']);
          }
          lines.forEach((l, k) => items.push(H.text('ck' + k, 20, 316 + k * 28, l[0], l[1], 14)));
        }
        // the segment's page table, with paging
        let rowY = 302;
        if (paged && sel >= 0) {
          const tb = T.paging.tables[sel], st = res && res.steps.find((q) => q.kind === 'page'), fp = res && !res.ok && res.fault === 'page';
          const pg = st ? st.page : fp ? Math.floor((ref.offset - (T.segs[sel].grow === 'down' ? MAXOFF - T.segs[sel].limit : 0)) / PAGE) : -1;
          const t = KM.table({ prefix: 'spt', x: 418, y: 132, w: 112, rowH: 26, idxW: 34, title: T.segs[sel].name + ' pages', cls: KM.lv(0), n: tb.length, sel: phase === 'result' ? pg : -1, entry: (i) => (tb[i] === null ? { text: '—', cls: 'inv' } : { text: 'f ' + tb[i] }), act: phase === 'result' && !fp, fault: phase === 'result' && fp, size: 13 });
          items.push(...t.items);
          if (pg >= 0 && t.row(pg)) rowY = t.row(pg).y + 13;
        }
        const bar = S.Kit.p10.vbar({ prefix: 'pm', x: 580, y: 20, w: 110, h: 440, total: PHYS, runs: full.map((r) => Object.assign({}, r, { cls: r.cls + (res && res.ok && phase === 'result' && res.pa >= r.start && res.pa < r.start + r.size ? ' act' : '') })), ticks: [0, PHYS].concat(runs.map((r) => r.start)), tickSide: 'right', minGap: 15 });
        items.push(...bar.items);
        items.push(H.text('pml', 635, 476, paged ? 'frames of ' + PAGE + ' B' : 'physical memory', 'tick', 12, 'middle'));
        if (res && res.ok && phase === 'result') {
          const y = Math.round(bar.Y(res.pa));
          items.push(H.wire('w:pa', paged ? [[530, rowY], [555, rowY], [555, y], [576, y]] : [[366, ty + 44 + sel * 30], [500, ty + 44 + sel * 30], [500, y], [576, y]], 'act'));
        }
        return items;
      };
      F.add({ items: draw(null, null, 'start'), say: `Four segments, each with its own base and limit: code at ${T.segs[0].base} (${T.segs[0].limit} bytes, read and execute), data at ${T.segs[1].base}, the heap at ${T.segs[2].base} (${T.segs[2].limit} bytes) and the stack at ${T.segs[3].base} (${T.segs[3].limit} bytes, growing down). An address is ${SEG_BITS} bits of segment and ${OFF_BITS} of offset.` + (paged ? ` Under each segment is a page table of ${PAGE}-byte pages.` : ''), meta: { phase: 'start', bases: T.segs.map((s) => s.base), limits: T.segs.map((s) => s.limit), bits: [SEG_BITS, OFF_BITS], page: PAGE }, view, hl: { d: [0] } });
      refs.forEach((ref) => {
        const res = M().segTranslate(T, ref), s = T.segs[ref.seg];
        F.add({ items: draw(ref, res, 'split'), say: `${H.an(ACC[ref.access]).replace(/^a/, 'A')} of address ${ref.addr}: the top ${SEG_BITS} bits give segment ${ref.seg} (${s.name}), the low ${OFF_BITS} bits offset ${ref.offset}. ` + res.steps[0].say, meta: { phase: 'split', addr: ref.addr, seg: ref.seg, offset: ref.offset, access: ref.access, base: s.base, limit: s.limit, bits: [SEG_BITS, OFF_BITS], ok: res.ok, fault: res.fault || 'none' }, view, hl: { d: [0] } });
        const st = res.steps, pageStep = st.find((q) => q.kind === 'page'), limitStep = st.find((q) => q.kind === 'limit');
        if (res.ok) F.count('ok'); else F.count('faults');
        F.add({ items: draw(ref, res, 'result'), say: st.slice(1).map((q) => q.say).join(' ').replace(/\bA execute\b/g, 'An execute'), meta: { phase: 'result', addr: ref.addr, seg: ref.seg, offset: ref.offset, base: s.base, limit: s.limit, ok: res.ok, fault: res.fault || 'none', pa: res.pa, lo: limitStep ? limitStep.lo : s.grow === 'down' ? MAXOFF - s.limit : 0, hi: limitStep ? limitStep.hi : s.grow === 'down' ? MAXOFF : s.limit, page: pageStep ? [pageStep.page, pageStep.offset, pageStep.frame] : [], rel: ref.offset - (s.grow === 'down' ? MAXOFF - s.limit : 0), pageBytes: PAGE, pages: paged ? T.paging.tables[ref.seg].length : 0 }, view, hl: { d: res.fault === 'protection' ? [3] : res.fault === 'limit' ? [1, 2] : paged ? [5] : [4] } });
      });
      const c = F.counts;
      F.add({ items: draw(null, null, 'end'), say: `${H.plural(c.ok, 'access', 'accesses')} translated and ${H.plural(c.faults, 'fault')}. Each segment is protected on its own, and code could be shared by giving two processes the same code entry.`, meta: { phase: 'end', ok: c.ok, faults: c.faults }, view });
      return { frames: F.list, def: H.def('Segment table', ['address = segment (top bits) | offset', 'grows up: legal offsets [0, limit)', 'grows down: legal [2^14 − limit, 2^14)', 'access must be in the protection bits (r w x)', 'physical = base + offset (down: base + offset − (2^14 − limit))', 'with paging: offset → page + offset in its page table']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'split', pick: 'option', ask: (fr, i) => `Will this ${ACC[fr[i].meta.access]} of segment ${fr[i].meta.seg}, offset ${fr[i].meta.offset}, succeed?`, options: ['yes', 'no: outside the limit', 'no: a protection fault', 'no: a page fault'], answer: (fr, i) => ({ none: 'yes', limit: 'no: outside the limit', protection: 'no: a protection fault', page: 'no: a page fault' }[fr[i].meta.fault]), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A 16-bit address with a 2-bit segment number: how large can a segment be?', options: ['16 KiB', '64 KiB', '4 KiB', '2 bytes'], answer: 0, why: '14 offset bits address 2^14 = 16384 bytes.' },
      { q: 'A stack segment of limit 1000 grows down in a 14-bit offset space. Which offsets are legal?', options: ['15384 to 16383', '0 to 999', '1000 to 16383', 'any'], answer: 0, why: 'It holds the top of the range: 16384 − 1000 = 15384 up to 16383.' },
      { q: 'A write to the code segment, marked r-x, causes…', options: ['a protection fault', 'a page fault', 'a limit fault', 'nothing'], answer: 0, why: 'The protection bits allow reading and executing only.' },
      { q: 'What does segmentation alone still suffer from?', options: ['external fragmentation: each segment needs a contiguous run', 'internal fragmentation inside pages', 'no protection', 'a single address space'], answer: 0, why: 'Variable-sized segments leave holes, as contiguous allocation does; paging under the segments removes that.' },
      { q: 'How can two processes share their code under segmentation?', options: ['both code entries hold the same base and limit', 'copy the code twice', 'use one page table', 'they cannot'], answer: 0, why: 'Sharing is one segment-table entry pointing at the same memory, read-only.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
