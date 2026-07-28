// A hierarchical page-table walk: the virtual address split into coloured fields, each level's index picking an
// entry in a page of the table, the arrow to the next table, and the frame plus the offset giving the physical
// address, with the memory accesses counted and the TLB missing first and hitting on a repeat. The levels, page
// size, bits per level and the address are the student's; the tables are built for a small sparse process (code,
// heap and stack pages) by the page-table engine (src/core/mem-a-paging.js).
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const PAGES = [4096, 16384, 65536], PAGE_NAMES = ['4 KiB', '16 KiB', '64 KiB'];
  const ADDRS = ['code', 'heap', 'stack', 'unmapped'];
  const PTE = 8, PA_BITS = 40;
  const DEF = { levels: 4, page: 0, bits: 9, addr: 1 };

  /** the machine for the knobs: its configuration, the mapped pages, the tables and the address walked */
  function setup(knobs) {
    const M = S.Mem;
    const levels = Math.round(knobs.levels || 4), pageBytes = PAGES[Math.round(knobs.page || 0)], off = M.log2(pageBytes);
    const b = Math.round(knobs.bits || 9);
    // every level takes b bits, and the root gives some back if the address would pass 64 bits
    const bits = Array(levels).fill(b);
    bits[0] = Math.max(1, Math.min(b, 64 - off - b * (levels - 1)));
    const cfg = M.config({ bits, pageBytes, pteBytes: PTE, paBits: PA_BITS });
    const W = cfg.vaBits, vp = BigInt(cfg.vpnBits);
    // a small process: three code pages at 4 MiB, four heap pages about a fifth of the way up (entry 29 of their
    // last table), two stack pages at the top
    const code = BigInt(0x400000 >> off), heap = ((((1n << vp) * 0x36a5n) >> 16n) >> BigInt(b) << BigInt(b)) + 29n, stack = (1n << vp) - 2n;
    const pages = [code, code + 1n, code + 2n, heap, heap + 1n, heap + 2n, heap + 3n, stack, stack + 1n];
    const map = pages.map((v, i) => [v, BigInt(0x3a00 + ((i * 0x2f1) % 0x400))]);
    const pt = M.build(cfg, map, { tableFrame: 0x100 });
    const which = ADDRS[Math.round(knobs.addr || 0)];
    const mask = BigInt(pageBytes - 1);
    const va = which === 'code' ? M.addr(cfg, code + 1n, 0x1a4n & mask)
      : which === 'heap' ? M.addr(cfg, heap + 2n, 0x2e8n & mask)
      : which === 'stack' ? M.addr(cfg, stack + 1n, 0xf40n & mask)
      : M.addr(cfg, heap + 9n, 0x10cn & mask);
    return { cfg, pt, va, W, which, walk: M.translate(pt, va), usage: M.usage(pt) };
  }

  /** the trace: the engine's walk, with the TLB missing before it and hitting on a repeat after it */
  function trace(knobs) {
    const M = S.Mem, m = setup(knobs || {}), cfg = m.cfg, walk = m.walk;
    const tlb = M.tlb({ entries: 16, ways: 4 }), vpn = M.vpnOf(cfg, m.va);
    const steps = [];
    const first = walk.steps[0];
    steps.push(Object.assign({}, first, { say: first.say + ' Each table entry is ' + PTE + ' bytes.' }));
    tlb.lookup(vpn);
    steps.push({ kind: 'tlb-miss', say: 'The TLB is asked first: it holds no translation for page ' + M.hex(vpn, cfg.vpnBits) + ', a miss, so the hardware walks the tables from the root register.' });
    for (const s of walk.steps.slice(1)) steps.push(s);
    if (walk.ok) {
      tlb.insert(vpn, walk.pfn);
      const hit = tlb.lookup(vpn);
      steps.push({ kind: 'tlb-hit', pfn: hit.pfn, accesses: 1, say: 'The translation is now in the TLB. The next access to this page hits there: frame ' + '0x' + hit.pfn.toString(16) + ' at once, 1 memory access instead of ' + walk.accesses + '. The tables for this process take ' + M.bytes(m.usage.bytes) + '; one flat table would take ' + M.bytes(m.usage.flatBytes) + '.' });
    }
    return steps;
  }

  const fr = (v) => '0x' + BigInt(v).toString(16);

  function frames(narrow, knobs) {
    const M = S.Mem, KM = S.Kit.mem, m = setup(knobs), cfg = m.cfg, L = cfg.levels, walk = m.walk, steps = trace(knobs);
    const reads = walk.steps.filter((s) => s.kind === 'read');
    const tables = reads.map((r) => m.pt.tables[r.table]);
    const view = narrow ? box(0, -6, 420, 194 + L * 92 + 276) : box(0, -4, 1180, 586);
    return steps.map((st, si) => {
      // how far the walk has gone at this step: the level being read (−1 before), and whether the data is reached
      const lvl = st.kind === 'read' ? st.level : st.kind === 'fault' ? reads.length - 1 : st.kind === 'frame' || st.kind === 'tlb-hit' ? L : -1;
      const repeat = st.kind === 'tlb-hit', faulted = st.kind === 'fault';
      const items = [];
      // ---- the address
      const fields = walk.fields.map((f, k) => ({ name: f.name, bits: f.bits, hi: f.hi, lo: f.lo, value: f.value, cls: KM.lv(f.level), label: f.name + ' = ' + (f.level < 0 ? M.hex(f.value, cfg.offBits, false) : f.value), dim: false }));
      const act = st.kind === 'split' ? fields.map((f, k) => k) : st.kind === 'read' ? [st.level] : st.kind === 'frame' ? [L] : [];
      items.push({ key: 'va', kind: 'text', x: narrow ? 10 : 20, y: 14, text: 'virtual address ' + M.hex(m.va, m.W), size: narrow ? 14 : 15, cls: 'mono' });
      items.push({ key: 'vaw', kind: 'text', x: narrow ? 10 : 1160, y: narrow ? 36 : 14, text: m.W + ' bits = ' + cfg.bits.join(' + ') + ' + ' + cfg.offBits + ' offset', anchor: narrow ? 'start' : 'end', size: 13, cls: 'tick' });
      if (narrow) {
        // one cell a field, as wide as its share of the bits allows
        const minW = 50, total = 400, sum = m.W, ws = fields.map((f) => Math.max(minW, (f.bits / sum) * total));
        const k = (total - minW * 0) / ws.reduce((a, c) => a + c, 0);
        fields.forEach((f, i) => { f.w = Math.round(ws[i] * k); f.text = String(f.value); f.label = f.name; });
        fields[L].text = M.hex(fields[L].value, cfg.offBits, false);
        items.push(...KM.strip({ prefix: 'bs', x: 10, y: 50, fields, h: 34, bits: false, act, size: 14 }).items);
      } else {
        const bitW = Math.min(26, Math.floor(1140 / m.W));
        items.push(...KM.strip({ prefix: 'bs', x: Math.round((1180 - bitW * m.W) / 2), y: 44, fields, bitW, h: 30, va: m.va, total: m.W, bits: true, act, size: 13 }).items);
      }
      // ---- the tables, and the page
      const entryOf = (t) => (idx) => {
        const e = t.entries.get(idx);
        if (!e) return { text: '—', cls: 'inv' };
        return { text: e.leaf ? 'pfn ' + fr(e.pfn) : '→ ' + fr(e.pfn) };
      };
      const colW = narrow ? 0 : Math.min(176, Math.floor((1140 - L * 44) / (L + 1)));
      const gap = narrow ? 0 : Math.round((1140 - (L + 1) * colW) / L);
      const colX = (i) => 20 + i * (colW + gap);
      const tableTop = narrow ? 194 : 214;
      const rowStep = narrow ? 92 : 0;
      const tKeys = [];
      for (let i = 0; i < L; i++) {
        const P = 't' + i, t = tables[i], cls = KM.lv(i);
        const state = { act: lvl === i && !repeat && !(faulted && false), fault: (faulted || (st.kind === 'read' && !st.valid)) && i === reads.length - 1 && !walk.ok, done: lvl > i, dim: repeat || lvl < i };
        if (!t) {
          // the walk stopped above: this table does not exist
          const x = narrow ? 10 : colX(i), y = narrow ? tableTop + i * rowStep : tableTop;
          items.push({ key: P + ':head', kind: 'cell', x, y, w: narrow ? 120 : colW, h: 44, rx: 5, lines: ['L' + (i + 1) + ' table', 'none'], size: 13, cls: 'mb-thead ghost' });
          tKeys.push({ head: P + ':head', entry: null, hx: x, hy: y, hw: narrow ? 120 : colW, hh: 44 });
          continue;
        }
        const n = 2 ** cfg.bits[i], sel = walk.fields[i].value;
        if (narrow) {
          const y = tableTop + i * rowStep, e = entryOf(t)(sel);
          const stCls = state.fault ? ' hot' : state.act ? ' act' : state.done ? ' done' : '';
          items.push({ key: P + ':head', kind: 'cell', x: 10, y, w: 120, h: 50, rx: 5, lines: ['L' + (i + 1) + ' table', 'frame ' + fr(t.frame)], size: 13, cls: 'mb-thead ' + cls + (state.fault ? ' fault' : state.act ? ' act' : '') + (state.dim ? ' dim' : '') });
          items.push({ key: P + ':is', kind: 'cell', x: 146, y: y + 10, w: 56, h: 30, rx: 0, text: String(sel), size: 13, cls: 'mb-idx sel ' + cls + (state.dim ? ' dim' : '') });
          items.push({ key: P + ':es', kind: 'cell', x: 202, y: y + 10, w: 150, h: 30, rx: 0, text: e.text, size: 13, cls: 'mb-entry ' + (e.cls || '') + stCls + (state.dim ? ' dim' : '') });
          items.push({ key: P + ':of', kind: 'text', x: 360, y: y + 30, text: 'of ' + n, size: 12, cls: 'tick' + (state.dim ? ' dim' : '') });
          tKeys.push({ head: P + ':head', entry: P + ':es', hx: 10, hy: y, hw: 120, hh: 50, ex: 202, ey: y + 10, ew: 150, eh: 30 });
        } else {
          const tb = KM.table({ prefix: P, x: colX(i), y: tableTop, w: colW, rowH: 30, idxW: 50, title: 'L' + (i + 1) + ' table', sub: 'frame ' + fr(t.frame), cls, n, sel, entry: entryOf(t), act: state.act, fault: state.fault, done: state.done, dim: state.dim, size: 13 });
          items.push(...tb.items);
          items.push({ key: P + ':n', kind: 'text', x: colX(i) + colW / 2, y: tableTop + tb.h + 20, text: n + ' entries × ' + PTE + ' B', anchor: 'middle', size: 12, cls: 'tick' + (state.dim ? ' dim' : '') });
          const rw = tb.row(sel);
          tKeys.push({ head: P + ':head', entry: P + ':es', hx: colX(i), hy: tableTop, hw: colW, hh: 44, ex: rw.x, ey: rw.y, ew: rw.w, eh: rw.h });
        }
      }
      // the page of data
      const pageX = narrow ? 10 : colX(L), pageY = narrow ? tableTop + L * rowStep : tableTop;
      const pageOn = walk.ok && lvl >= L;
      const pageH = narrow ? 50 : 168;
      if (walk.ok) {
        items.push({ key: 'pg:head', kind: 'cell', x: pageX, y: pageY, w: narrow ? 120 : colW, h: narrow ? 50 : 44, rx: 5, lines: ['data page', 'frame ' + fr(walk.pfn)], size: 13, cls: 'mb-thead' + (pageOn && !repeat ? ' act' : '') + (lvl < L ? ' dim' : '') });
        const bx = narrow ? 146 : pageX, by = narrow ? pageY + 4 : pageY + 52, bw = narrow ? 176 : colW, bh = narrow ? 42 : pageH - 52;
        items.push({ key: 'pg:box', kind: 'cell', x: bx, y: by, w: bw, h: bh, rx: 3, text: '', cls: 'mb-page' + (pageOn ? ' act' : ' dim') });
        const frac = walk.offset / cfg.pageBytes;
        if (narrow) items.push({ key: 'pg:byte', kind: 'cell', x: Math.round(bx + 2 + frac * (bw - 8)), y: by + 3, w: 4, h: bh - 6, rx: 1, text: '', cls: 'mb-byte' + (pageOn ? '' : ' dim'), audit: 'overlap-ok' });
        else items.push({ key: 'pg:byte', kind: 'cell', x: bx + 3, y: Math.round(by + 3 + frac * (bh - 10)), w: bw - 6, h: 4, rx: 1, text: '', cls: 'mb-byte' + (pageOn ? '' : ' dim'), audit: 'overlap-ok' });
        items.push({ key: 'pg:off', kind: 'text', x: narrow ? 330 : pageX + colW / 2, y: narrow ? pageY + 30 : by + bh + 20, text: '+ ' + M.hex(walk.offset, cfg.offBits, false), anchor: narrow ? 'start' : 'middle', size: 13, cls: 'mono' + (pageOn ? '' : ' dim') });
      } else {
        items.push({ key: 'pg:head', kind: 'cell', x: pageX, y: pageY, w: narrow ? 120 : colW, h: 44, rx: 5, lines: ['data page', 'not mapped'], size: 13, cls: 'mb-thead ghost' });
      }
      // ---- the arrows of the walk: root to L1, each entry to the next table, the leaf to the page
      const regX = narrow ? 10 : colX(0), regY = narrow ? 124 : 128;
      items.push({ key: 'root', kind: 'cell', x: regX, y: regY, w: narrow ? 186 : Math.max(colW, 170), h: 44, rx: 5, lines: ['root register', 'frame ' + fr(tables[0].frame)], size: 13, cls: 'mb-reg' + (lvl === 0 && !repeat ? ' act' : '') + (repeat ? ' dim' : '') });
      // arrows run between the columns (wide) or from an entry down to the next table (narrow), clear of the cells
      tKeys.push({ hx: pageX, hy: pageY, hw: narrow ? 120 : colW, hh: narrow ? 50 : 44 });
      const rx = narrow ? 10 + 60 : colX(0) + colW / 2;
      if (lvl >= 0 && !repeat) items.push({ key: 'ar:root', kind: 'edge', from: { x: rx, y: regY + 44 }, to: { x: rx, y: tKeys[0].hy }, cls: lvl === 0 ? 'act' : '' });
      for (let i = 0; i < L; i++) {
        const a = tKeys[i], b = tKeys[i + 1];
        if (repeat || lvl <= i || !a.entry || !tables[i + 1] && i + 1 < L) continue;
        const from = narrow ? { x: a.ex + 40, y: a.ey + a.eh } : { x: a.ex + a.ew, y: a.ey + a.eh / 2 };
        const to = narrow ? { x: b.hx + b.hw / 2, y: b.hy } : { x: b.hx, y: b.hy + b.hh / 2 };
        items.push({ key: 'ar:' + i, kind: 'edge', from, to, cls: lvl === i + 1 ? 'act' : '' });
      }
      // ---- the count of memory accesses, and the TLB
      const accY = narrow ? pageY + 84 : 476;
      const names = cfg.bits.map((_, i) => 'L' + (i + 1)).concat('data');
      const done = repeat ? 1 : st.kind === 'read' ? st.access : faulted ? walk.accesses : lvl >= L ? walk.accesses : 0;
      const accW = narrow ? Math.min(62, Math.floor(400 / names.length) - 6) : 70;
      items.push({ key: 'acc:t', kind: 'text', x: narrow ? 10 : 20, y: accY - 10, text: 'memory accesses', size: 13, cls: 'strong' });
      names.forEach((nm, k) => {
        const on = repeat ? k === L : k < done, cls = 'mb-acc ' + (k < L ? KM.lv(k) : 'data') + (on ? ' on' : '') + (on && (repeat || k === done - 1) ? ' act' : '');
        items.push({ key: 'acc:' + k, kind: 'cell', x: (narrow ? 10 : 20) + k * (accW + 6), y: accY, w: accW, h: 32, rx: 4, text: nm, size: 12, cls: cls + (k === L ? ' data' : '') });
      });
      const accEnd = (narrow ? 10 : 20) + names.length * (accW + 6);
      items.push({ key: 'acc:n', kind: 'text', x: narrow ? accEnd - 6 : accEnd + 8, y: narrow ? accY + 56 : accY + 22, text: '= ' + done, anchor: narrow ? 'end' : 'start', size: 17, cls: 'mb-big' + (repeat ? ' good' : faulted ? ' bad' : '') });
      const tlbX = narrow ? 10 : 640, tlbY = narrow ? accY + 74 : accY - 18, tlbW = narrow ? 400 : 520;
      const tl = st.kind === 'split' ? ['TLB', 'not yet asked'] : repeat ? ['TLB hit', 'page ' + M.hex(M.vpnOf(cfg, m.va), cfg.vpnBits, false) + ' → frame ' + fr(walk.pfn)] : ['TLB miss', 'no entry for page ' + M.hex(M.vpnOf(cfg, m.va), cfg.vpnBits, false)];
      items.push({ key: 'tlb', kind: 'cell', x: tlbX, y: tlbY, w: tlbW, h: 52, rx: 6, lines: tl, size: 13, cls: 'mb-reg' + (st.kind === 'split' ? '' : repeat ? ' good' : st.kind === 'tlb-miss' ? ' bad' : '') });
      // ---- the result
      const resY = narrow ? tlbY + 88 : 556;
      const res = faulted ? 'page fault: L' + (reads.length) + ' entry ' + reads[reads.length - 1].index + ' is not valid' : lvl >= L ? 'physical address ' + M.hex(walk.pa, PA_BITS) : st.kind === 'read' ? 'reading L' + (st.level + 1) + ' entry ' + st.index + ' at ' + M.hex(st.entryAddr, PA_BITS) : '';
      items.push({ key: 'res', kind: 'text', x: narrow ? 10 : 20, y: resY, text: res || ' ', size: narrow ? 14 : 17, cls: 'mb-big' + (faulted ? ' bad' : lvl >= L ? ' good' : '') });
      const title = { split: 'split', 'tlb-miss': 'TLB miss', read: st.level !== undefined ? 'L' + (st.level + 1) : '', frame: 'frame + offset', fault: 'page fault', 'tlb-hit': 'TLB hit' }[st.kind];
      return { items, say: st.say, view, title, i: si };
    });
  }

  D.add({
    id: 'page-walk', order: 50, tag: 'Memory · page tables', short: 'A page walk', title: 'Walking a four-level page table',
    blurb: 'The address splits into one index a level and an offset; each index picks an entry that names the next table, until the last names the frame. Change the levels, the page size, the bits a level takes and the address.',
    knobs: [
      { id: 'levels', label: 'Levels', min: 2, max: 5, step: 1, value: DEF.levels },
      { id: 'page', label: 'Page size', type: 'select', value: DEF.page, options: PAGE_NAMES.map((n, i) => ({ value: i, label: n })) },
      { id: 'bits', label: 'Bits a level', min: 6, max: 10, step: 1, value: DEF.bits },
      { id: 'addr', label: 'Address', type: 'select', value: DEF.addr, options: ADDRS.map((n, i) => ({ value: i, label: n })) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({}, DEF, knobs || {})); },
    trace: (knobs) => trace(Object.assign({}, DEF, knobs || {})),
  });
})(globalThis.Proses = globalThis.Proses || {});
