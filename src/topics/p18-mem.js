// Part 18, virtualising memory (virt-b-mem.js, built on S.Mem): the two-dimensional walk read by read, a guest
// address split into its fields (S.Mem.translate) and a grid with a cell for every table read; then shadow page
// tables against nested paging over one stream of events, exits and walk reads counted side by side.
(function (S) {
  'use strict';
  const H = S.P09, V = () => S.Virt, KM = () => S.Kit.mem;

  S.topic({
    id: 'virt-walk-2d', family: 'p18-memory', order: 10, title: 'The two-dimensional page walk',
    blurb: 'A guest page table maps guest-virtual addresses to guest-physical ones, and the host\'s maps guest-physical to host-physical. With nested paging the hardware walks both. Every guest table sits at a guest-physical address, so before each guest entry can be read, a whole host walk must find it; and the data\'s own guest-physical address needs one more host walk. With g guest levels and h host levels a TLB miss costs (g + 1)(h + 1) − 1 table reads: 24 for four and four, against 4 natively.',
    inputs: [
      { id: 'g', kind: 'slider', label: 'Guest levels', def: 4, min: 1, max: 5, step: 1 },
      { id: 'h', kind: 'slider', label: 'Host levels', def: 4, min: 1, max: 5, step: 1 },
      { id: 'seed', kind: 'number', label: 'Address seed', def: 3, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Four and four (x86-64 on x86-64)', values: { g: 4, h: 4, seed: 3 } },
      { label: 'Two and two: small enough to follow', values: { g: 2, h: 2, seed: 5 } },
      { label: 'A guest with five levels', values: { g: 5, h: 4, seed: 8 } },
      { label: 'One level each', values: { g: 1, h: 1, seed: 2 } },
    ],
    counters: [{ id: 'reads', label: 'table reads' }],
    run(inp) {
      const g = inp.g, h = inp.h, R = V().walk2d({ guestLevels: g, hostLevels: h, seed: inp.seed }), F = new S.Frames(['reads']);
      const M = S.Mem, tr = M.translate(R.guest, R.gva), cw = 64, ch = 34, gx = 150, gy = 130;
      const total = 600, fs = tr.fields, sum = fs.reduce((a, f) => a + f.bits, 0);
      const fields = fs.map((f) => ({ name: f.name, bits: f.bits, value: f.value, cls: KM().lv(f.level), w: Math.max(56, Math.round((f.bits / sum) * total)), text: f.level < 0 ? M.hex(f.value, 12, false) : String(f.value), label: f.name }));
      const strip = (act) => [H.text('va', 0, 14, 'guest-virtual address ' + M.hex(R.gva, 0, false) + ': ' + g + ' indexes of 9 bits and a 12-bit offset', 'mono', 14), ...KM().strip({ prefix: 'vs', x: 0, y: 30, fields, h: 32, bits: false, act, size: 13 }).items];
      const cells = new Map();
      const grid = (cur) => {
        const items = [];
        for (let c = 0; c <= h; c++) items.push(H.text('ch' + c, gx + c * (cw + 4) + cw / 2, gy - 10, c < h ? 'host L' + (c + 1) : 'entry', 'colname', 13, 'middle'));
        for (let r = 0; r <= g; r++) {
          items.push(H.text('rh' + r, gx - 10, gy + r * (ch + 4) + ch / 2 + 5, r < g ? 'guest L' + (r + 1) : 'the data', 'rowname', 14, 'end'));
          for (let c = 0; c <= h; c++) {
            const k = r + '_' + c, v = cells.get(k), kind = R.grid[r][c];
            items.push({ key: 'gc' + k, kind: 'cell', x: gx + c * (cw + 4), y: gy + r * (ch + 4), w: cw, h: ch, rx: 4, text: v === undefined ? '' : String(v), size: 14, cls: 'wcell ' + (v === undefined ? 'empty' : kind) + (cur === k ? ' act' : '') });
          }
        }
        const lx = gx + (h + 1) * (cw + 4) + 24;
        [['host', 'a host table read'], ['guest', 'a guest entry read'], ['data', 'the data itself']].forEach(([c, t], k) => items.push({ key: 'lb' + k, kind: 'cell', x: lx, y: gy + k * 30, w: 24, h: 20, rx: 4, text: '', cls: 'wcell ' + c }, H.text('lt' + k, lx + 32, gy + k * 30 + 15, t, '', 13)));
        return items;
      };
      F.add({ items: [...strip([]), ...grid(null)], say: H.plain(R.steps[0].say) + ` The grid has a row for each guest level and one for the data, and a column for each host level and one for the entry itself.`, meta: { phase: 'start', g, h, cells: (g + 1) * (h + 1) } });
      R.steps.slice(1).forEach((st) => {
        const k = st.row + '_' + st.col;
        cells.set(k, st.accesses);
        F.set('reads', Math.min(st.accesses, R.accesses));
        const act = st.row < g ? [st.row] : [g];
        F.add({ items: [...strip(act), ...grid(k)], say: H.plain(st.say), meta: { phase: st.kind, row: st.row, col: st.col, n: st.accesses, g, h, total: R.accesses, count: V().count2d(g, h), levels: [1, 2, 3, 4, 5].slice(0, Math.max(g, h)) }, title: st.kind === 'data' ? 'the data' : 'read ' + st.accesses });
      });
      F.last().hold = 3000;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Counting the reads', text: ['each guest level: h host reads + 1 entry read', 'the data address: h more host reads', 'g(h + 1) + h = (g + 1)(h + 1) − 1', 'g = h = 4: 24 reads (native: 4)', 'the TLB caches the whole result'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many table reads will this TLB miss take?', options: (fr) => { const g = fr[0].meta.g, h = fr[0].meta.h, c = (g + 1) * (h + 1) - 1; return [...new Set([String(g), String(g + h), String(g * h), String(c)])]; }, answer: (fr) => String((fr[0].meta.g + 1) * (fr[0].meta.h + 1) - 1), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'With 4 guest levels and 4 host levels, a TLB miss under nested paging reads…', options: ['24 table entries', '8', '16', '4'], answer: 0, why: '(4 + 1)(4 + 1) − 1 = 24.' },
      { q: 'Why does each guest level need a whole host walk?', options: ['the guest table\'s address is guest-physical, and must itself be translated', 'the host is slow', 'the TLB is off', 'the guest asks for it'], answer: 0, why: 'The hardware can only read host-physical memory.' },
      { q: 'What makes the 2-D walk affordable in practice?', options: ['the TLB, and caches of intermediate translations', 'smaller pages', 'more guest levels', 'turning paging off'], answer: 0, why: 'Most accesses hit the TLB and never walk.' },
      { q: 'Larger pages help the 2-D walk because…', options: ['they remove levels from the walk on either side', 'they make tables bigger', 'they disable the TLB', 'they need no host table'], answer: 0, why: 'Fewer levels: fewer reads per miss, and more TLB reach.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const ev = (op, x) => (op === 'switch' ? { op, to: x } : { op, page: x });
  const EVENTS = {
    mixed: { label: 'A mix of accesses, mappings and switches', list: null },
    switchy: { label: 'Many process switches', list: [ev('access', 1), ev('switch', 'Q'), ev('access', 1), ev('switch', 'P'), ev('access', 1), ev('switch', 'Q'), ev('access', 1), ev('switch', 'P'), ev('access', 2)] },
    mapper: { label: 'A guest busy changing its page tables', list: [ev('map', 3), ev('map', 4), ev('map', 5), ev('access', 3), ev('access', 4), ev('access', 5), ev('unmap', 3), ev('map', 6), ev('access', 6)] },
    hot: { label: 'A small working set: mostly TLB hits', list: [ev('access', 1), ev('access', 1), ev('access', 2), ev('access', 1), ev('access', 2), ev('access', 2), ev('access', 1)] },
  };
  const evText = (e) => (!e ? '' : e.op === 'switch' ? 'switch to ' + e.to : e.op + ' page ' + e.page);
  S.topic({
    id: 'virt-shadow-nested', family: 'p18-memory', order: 20, title: 'Shadow page tables against nested paging',
    blurb: 'Before hardware walked two tables, the monitor kept a shadow table for each guest process, mapping guest-virtual pages straight to host frames. A TLB miss then costs only a normal walk, but the guest\'s own tables must be write-protected so that every change traps and the monitor can copy it, and every switch of page table exits too. Nested paging lets the guest edit its tables and switch freely, and pays instead at every TLB miss with the longer two-dimensional walk. Which wins depends on what the guest does.',
    inputs: [
      { id: 'events', kind: 'choice', label: 'What the guest does', def: 'mixed', options: Object.entries(EVENTS).map(([value, e]) => ({ value, label: e.label })) },
      { id: 'g', kind: 'slider', label: 'Guest levels', def: 4, min: 1, max: 5, step: 1 },
      { id: 'h', kind: 'slider', label: 'Host levels', def: 4, min: 1, max: 5, step: 1 },
    ],
    presets: [
      { label: 'A mix', values: { events: 'mixed', g: 4, h: 4 } },
      { label: 'Many switches', values: { events: 'switchy', g: 4, h: 4 } },
      { label: 'Busy page tables', values: { events: 'mapper', g: 4, h: 4 } },
      { label: 'Mostly TLB hits', values: { events: 'hot', g: 4, h: 4 } },
    ],
    counters: [{ id: 'sx', label: 'shadow: exits' }, { id: 'sr', label: 'shadow: reads' }, { id: 'nx', label: 'nested: exits' }, { id: 'nr', label: 'nested: reads' }],
    run(inp) {
      const list = EVENTS[inp.events].list || undefined;
      const A = V().memVirt({ technique: 'shadow', events: list, guestLevels: inp.g, hostLevels: inp.h }), B = V().memVirt({ technique: 'nested', events: list, guestLevels: inp.g, hostLevels: inp.h });
      const F = new S.Frames(['sx', 'sr', 'nx', 'nr']), n = Math.min(A.steps.length, B.steps.length);
      const rowsOf = (upto) => {
        const rows = [];
        for (let k = 1; k <= upto && k < n - 1; k++) {
          const a = A.steps[k], b = B.steps[k], d = (s, p) => (s.exits > p.exits ? 'exit' : '') + (s.walkReads > p.walkReads ? (s.exits > p.exits ? ', ' : '') + (s.walkReads - p.walkReads) + ' reads' : '') || (s.kind === 'hit' ? 'TLB hit' : '—');
          rows.push({ cls: k === upto ? 'act' : '', cells: [a.proc + ': ' + (a.kind === 'fault' ? 'fault on ' + evText(a.ev).replace('access ', '') : a.kind === 'map' && !a.ev.op.startsWith('map') ? 'guest maps page ' + a.ev.page : evText(a.ev)), { text: d(a, A.steps[k - 1]), cls: a.exits > A.steps[k - 1].exits ? 'hot' : '' }, { text: d(b, B.steps[k - 1]), cls: b.exits > B.steps[k - 1].exits ? 'hot' : '' }] });
        }
        return rows;
      };
      const tbl = (upto) => {
        const rows = rowsOf(upto), show = rows.slice(-9);
        return S.Kit.gantt.table({ prefix: 'tb', x: 0, y: 24, rowH: 30, size: 14, cols: [{ w: 270, label: 'event' }, { w: 200, label: 'shadow tables' }, { w: 200, label: 'nested paging' }], rows: show.map((r, j) => Object.assign({}, r, { cells: r.cells })) }).items;
      };
      const totals = (a, b) => {
        const items = [H.title('tt2', 0, 24 + 30 * 10 + 24, 'so far (an exit drawn as long as 10 reads)')], max = Math.max(1, A.walkReads, B.walkReads, A.exits * 10, B.exits * 10);
        [['shadow: exits', a.exits, 'hot'], ['nested: exits', b.exits, 'hot'], ['shadow: walk reads', a.walkReads, ''], ['nested: walk reads', b.walkReads, '']].forEach(([t, v, c], k) => {
          const y = 24 + 30 * 10 + 38 + k * 28;
          items.push(H.text('tn' + k, 0, y + 15, t, 'strong', 14), { key: 'tb' + k, kind: 'cell', x: 170, y, w: Math.max(4, Math.round(((c ? v * 10 : v) / max) * 380)), h: 20, rx: 3, text: '', cls: 'bar ' + (c ? 'neg' : 'soft') }, H.text('tv' + k, 170 + Math.max(4, Math.round(((c ? v * 10 : v) / max) * 380)) + 8, y + 15, String(v), 'mono', 14));
        });
        return items;
      };
      F.add({ items: [H.title('tt', 0, 6, 'the same events under both designs'), ...tbl(0), ...totals(A.steps[0], B.steps[0])], say: (H.plain(A.steps[0].say) + ' ' + H.plain(B.steps[0].say)), meta: { phase: 'start', g: inp.g, h: inp.h, miss: [inp.g, V().count2d(inp.g, inp.h)] } });
      for (let k = 1; k < n - 1; k++) {
        const a = A.steps[k], b = B.steps[k];
        F.set('sx', a.exits).set('sr', a.walkReads).set('nx', b.exits).set('nr', b.walkReads);
        F.add({ items: [H.title('tt', 0, 6, 'the same events under both designs'), ...tbl(k), ...totals(a, b)], say: ('Shadow: ' + H.plain(a.say) + ' Nested: ' + H.plain(b.say)), meta: { phase: 'event', k, ev: a.ev, pages: [a.mapped, a.tlb, b.mapped, b.tlb], a: [a.exits, a.walkReads], b: [b.exits, b.walkReads], miss: [inp.g, V().count2d(inp.g, inp.h)] }, title: evText(a.ev) });
      }
      const ea = A.steps[n - 1], eb = B.steps[n - 1];
      F.add({ items: [H.title('tt', 0, 6, 'the same events under both designs'), ...tbl(n - 2), ...totals(A, B)], say: H.plain(ea.say) + ' ' + H.plain(eb.say) + ` Counting an exit as 10 table reads (an assumption; real ratios vary with the hardware), ${A.exits * 10 + A.walkReads > B.exits * 10 + B.walkReads ? 'nested paging comes out ahead here' : A.exits * 10 + A.walkReads < B.exits * 10 + B.walkReads ? 'shadow tables come out ahead here' : 'the two come out even here'}: ${A.exits * 10 + A.walkReads} against ${B.exits * 10 + B.walkReads}.`, meta: { phase: 'end', a: [A.exits, A.walkReads, A.tlbMisses, A.faults], b: [B.exits, B.walkReads, B.tlbMisses, B.faults], weight: 10, cost: [A.exits * 10 + A.walkReads, B.exits * 10 + B.walkReads] }, title: 'totals', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Where each pays', text: ['shadow: TLB miss = g reads', '  but guest table edits and switches exit', 'nested: TLB miss = (g + 1)(h + 1) − 1 reads', '  guest edits and switches are free', 'a TLB hit costs nothing in either'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which design will have more VM exits here?', options: ['shadow tables', 'nested paging', 'the same'], answer: (fr) => { const e = fr[fr.length - 1].meta; return e.a[0] > e.b[0] ? 'shadow tables' : e.a[0] < e.b[0] ? 'nested paging' : 'the same'; }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'A shadow page table maps…', options: ['guest-virtual straight to host-physical', 'guest-physical to host-physical', 'host-virtual to guest-virtual', 'nothing: it is a copy for backup'], answer: 0, why: 'The monitor combines the two mappings into one table the hardware can walk.' },
      { q: 'Why must the guest\'s own page tables be write-protected under shadow paging?', options: ['so every change traps and the monitor can update the shadow table', 'to stop the guest reading them', 'to save memory', 'they need not be'], answer: 0, why: 'Otherwise the shadow would go stale.' },
      { q: 'Under nested paging, the guest switching processes costs…', options: ['no exit: it loads its own page-table base', 'an exit every time', 'a full shadow rebuild', 'a page fault'], answer: 0, why: 'The hardware walks the guest\'s table directly.' },
      { q: 'A workload with many TLB misses and few table changes favours…', options: ['shadow tables (short walks)', 'nested paging', 'neither', 'turning the TLB off'], answer: 0, why: 'Each miss costs g reads instead of (g + 1)(h + 1) − 1.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
