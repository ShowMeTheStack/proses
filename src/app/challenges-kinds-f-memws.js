// The workspace of a 'pt-design' challenge: the page size and the index bits of each level on the left, with the
// address drawn as a strip of coloured fields; on the right what the design costs for the address space, worked
// out as it changes: the tables at each level and the waste at the end of each region.
(function (S) {
  'use strict';
  const KIND = () => S.Challenges.kinds['pt-design'];

  S.PtDesignWorkspace = function (host, x, draft, onChange) {
    const { h, icon } = S.UI, KIT = S.ChallengeKit, M = S.Mem, k = KIND();
    const L = x.limits || {}, sp = x.space;
    let a = JSON.parse(JSON.stringify(draft && draft.bits ? draft : k.start(x)));
    const sizes = L.pageSizes || [1024, 2048, 4096, 8192, 16384, 65536];
    const page = KIT.select({ id: 'chPage', label: 'Page size', value: a.pageBytes, options: sizes.map((b) => ({ value: b, label: M.bytes(b) })), onChange: (v) => { a.pageBytes = +v; fit(); changed(true); } });
    const levels = KIT.num({ id: 'chLevels', label: 'Levels', value: a.bits.length, min: 1, max: L.maxLevels || 4, onChange: (v) => { if (v >= 1 && v <= (L.maxLevels || 4)) { a.bits = M.autoSplit(sp.vaBits - M.log2(a.pageBytes), v, M.log2(a.pageBytes / (sp.pteBytes || 4))); changed(true); } } });
    const auto = h('button.btn.small', { type: 'button', id: 'chAuto', title: 'Every table below the root fills one page' }, icon('fit'), 'Split as usual');
    auto.addEventListener('click', () => { fit(true); changed(true); });
    const bitsBox = h('div.chk-bits', { id: 'chBits' });
    const strip = h('div.chk-strip', { id: 'chStrip', 'aria-label': 'The address split into fields' });
    const cost = h('div.chk-cost', { id: 'chCost' });
    const err = h('div.chk-status.bad');
    host.appendChild(h('div.chk-grid',
      KIT.panel('Your design', h('div.chk-form', page.el, levels.el, h('div.chk-field', h('span.chk-lab', ' '), auto)), h('p.chk-sub', 'Index bits of each level, the root first:'), bitsBox, strip),
      KIT.panel('What it costs', cost, err)));
    /** keep the bits adding up when the page size changes: the root takes up the difference */
    function fit(fresh) {
      const idx = sp.vaBits - M.log2(a.pageBytes);
      if (fresh) { a.bits = M.autoSplit(idx, a.bits.length, M.log2(a.pageBytes / (sp.pteBytes || 4))); return; }
      const rest = a.bits.slice(1).reduce((s, b) => s + b, 0);
      if (idx - rest >= 1) a.bits[0] = idx - rest; else a.bits = M.autoSplit(idx, a.bits.length, M.log2(a.pageBytes / (sp.pteBytes || 4)));
    }
    function fields() {
      bitsBox.innerHTML = '';
      a.bits.forEach((b, i) => {
        const f = KIT.num({ label: 'L' + (i + 1), value: b, min: 1, max: 24, onChange: (v) => { a.bits[i] = v; changed(false); } });
        f.el.classList.add('lv' + i);
        bitsBox.appendChild(f.el);
      });
      levels.set(a.bits.length);
      page.set(a.pageBytes);
    }
    function draw() {
      strip.innerHTML = ''; cost.innerHTML = ''; err.textContent = '';
      const off = M.log2(a.pageBytes), parts = a.bits.map((b, i) => ({ name: 'L' + (i + 1), bits: b, cls: 'lv' + i })).concat([{ name: 'offset', bits: off, cls: 'lvoff' }]);
      const total = parts.reduce((s, p) => s + (p.bits > 0 ? p.bits : 0), 0) || 1;
      for (const p of parts) strip.appendChild(h('span.chk-fld.' + p.cls, { style: { flexGrow: String(Math.max(1, p.bits)) }, title: p.name + ': ' + p.bits + ' bits' }, h('b', p.name), h('i.mono', p.bits + ' bits')));
      strip.dataset.total = String(total);
      const probs = k.limitsProblems(x, a);
      if (probs.length) { err.textContent = probs[0].replace(/^./, (c) => c.toUpperCase()) + '.'; return; }
      const r = k.build(x, a), use = r.use, row = (cells, cls) => h('tr' + (cls ? '.' + cls : ''), ...cells.map((c, i) => h(i ? 'td.mono' : 'td', c)));
      const lvRows = r.cfg.bits.map((b, i) => row(['Level ' + (i + 1) + (i ? '' : ' (root)'), use.perLevel[i] + ' × ' + M.bytes(r.cfg.tableBytes[i]), String(use.perLevel[i] * r.cfg.tableBytes[i])]));
      const regRows = r.ps.map((p) => row([p.name, p.n + ' page' + (p.n === 1 ? '' : 's'), String(p.waste)]));
      cost.append(
        h('div.fit-table', h('table.chk-table', h('thead', h('tr', h('th', 'Page tables'), h('th', 'tables'), h('th', 'bytes'))), h('tbody', ...lvRows))),
        h('div.fit-table', h('table.chk-table', h('thead', h('tr', h('th', 'Region'), h('th', 'pages'), h('th', 'unused bytes'))), h('tbody', ...regRows))),
        h('div.chk-nums', h('div.chk-num', h('span', 'page tables'), h('b.mono', String(use.bytes))), h('div.chk-num', h('span', 'fragmentation'), h('b.mono', String(r.waste))), h('div.chk-num' + (C().reaches(x, r.total) ? '.good' : ''), h('span', 'in all (target ' + x.target + ')'), h('b.mono', String(r.total)))));
      S.UI.fitTables(cost);
    }
    const C = () => S.Challenges;
    const later = S.UI.debounce(draw, 60);
    function changed(rebuild) { if (rebuild) fields(); later(); if (onChange) onChange(); }
    fields(); draw();
    return {
      get: () => ({ pageBytes: a.pageBytes, bits: a.bits.slice() }),
      load(v) { a = JSON.parse(JSON.stringify(v && v.bits ? v : k.start(x))); fields(); draw(); },
      redraw: draw,
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
