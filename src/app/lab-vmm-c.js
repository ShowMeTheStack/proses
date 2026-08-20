// The VM lab, part three: keeping a shadow table in sync. One stream of guest events the student types (touch a page,
// map one, unmap one, switch process) runs under shadow paging and under nested paging (S.Virt.memVirt), step for
// step: what each design pays at each event (a VM exit, a walk of g or (g + 1)(h + 1) − 1 reads, or nothing), the
// guest's mappings, the TLB, the shadow tables the VMM keeps, and the running cost with an exit weighed as the
// student says. The guest starts with P mapping pages 1 and 2 and Q mapping page 1 (the engine's starting state).
//   VX.syncEvents(rows) -> engine events     VX.syncRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const box = (x, y, w, h) => ({ x, y, w, h });
  VX.syncEvents = (rows) => rows.map((r) => (r.op === 'switch' ? { op: 'switch', to: String(r.arg).trim() } : { op: r.op, page: +r.arg }));
  const evText = (e) => (!e ? '' : e.op === 'switch' ? 'switch to ' + e.to : e.op === 'access' ? 'touch page ' + e.page : e.op + ' page ' + e.page);

  VX.syncRun = function (v, ctx) {
    const V = S.Virt, narrow = ctx.narrow, g = v.sG, h = v.sH, E = v.sExit;
    const events = VX.syncEvents(v.sEvents);
    const A = V.memVirt({ technique: 'shadow', events, guestLevels: g, hostLevels: h, tlb: v.sTlb });
    const B = V.memVirt({ technique: 'nested', events, guestLevels: g, hostLevels: h, tlb: v.sTlb });
    const n = Math.min(A.steps.length, B.steps.length), N = V.count2d(g, h);
    const cost = (s) => s.walkReads + s.exits * E;
    // the processes' mappings and the shadow tables kept, step by step (the engine's own snapshots)
    const procs = ['P', 'Q'];
    for (const e of events) if (e.op === 'switch' && !procs.includes(e.to)) procs.push(e.to);
    const mapsAt = [], keptAt = [];
    const maps = { P: [1, 2], Q: [1] }, kept = new Set(['P']);
    for (let k = 0; k < n; k++) {
      const s = A.steps[k];
      if (s.proc) maps[s.proc] = s.mapped;
      if (s.kind === 'switch') kept.add(s.proc);
      mapsAt.push(Object.assign({}, maps)); keptAt.push([...kept]);
    }
    const delta = (s, p) => {
      const parts = [];
      if (s.exits > p.exits) parts.push(s.exits - p.exits === 1 ? 'VM exit' : (s.exits - p.exits) + ' exits');
      if (s.walkReads > p.walkReads) parts.push((s.walkReads - p.walkReads) + ' reads');
      return parts.length ? parts.join(', ') : s.kind === 'hit' ? 'TLB hit' : '—';
    };
    const rowFor = (k) => {
      const a = A.steps[k], b = B.steps[k];
      const what = a.kind === 'fault' ? a.proc + ': fault on page ' + a.ev.page : a.kind === 'map' && a.ev.op !== 'map' ? a.proc + ': kernel maps page ' + a.ev.page : a.proc + ': ' + evText(a.ev);
      return [what, { text: delta(a, A.steps[k - 1]), cls: a.exits > A.steps[k - 1].exits ? 'bad' : '' }, { text: delta(b, B.steps[k - 1]), cls: b.exits > B.steps[k - 1].exits ? 'bad' : '' }];
    };
    const allRows = [];
    for (let k = 1; k < n - 1; k++) allRows.push(rowFor(k));
    const cols = narrow ? [{ w: 146, label: 'event' }, { w: 112, label: 'shadow' }, { w: 112, label: 'nested' }] : [{ w: 250, label: 'event' }, { w: 170, label: 'shadow tables' }, { w: 170, label: 'nested paging' }];
    const SHOW = narrow ? 6 : 10, rowH = 30;
    const tbl = (k) => {
      const upto = Math.min(k, allRows.length), from = Math.max(0, upto - SHOW);
      const rows = allRows.slice(from, upto).map((r, j) => ({ key: from + j, cls: from + j === upto - 1 && k < n - 1 ? 'act' : '', cells: r.map((c, i) => (i === 0 && narrow ? VX.fit(c, 140, 13) : c)) }));
      const items = [VX.title('tt', 0, 8, narrow ? 'the same events, both designs' : 'the same events under both designs' + (from ? ' (the last ' + SHOW + ')' : ''))];
      items.push(...S.Kit.gantt.table({ prefix: 'tb', x: 0, y: 24, rowH, size: narrow ? 13 : 14, cols, rows }).items);
      return items;
    };
    const tblH = 24 + rowH * (SHOW + 1);
    const px = narrow ? 0 : 640, py = narrow ? tblH + 24 : 0, pw = narrow ? 370 : 360;
    const state = (k) => {
      const a = A.steps[k], items = [VX.title('gt', px, py + 8, 'the guest’s page tables')];
      let y = py + 22;
      procs.forEach((p, j) => {
        const pages = mapsAt[k][p] || [];
        items.push(VX.cell('pn' + j, px, y, 40, 28, p, 'vx-proc' + (a.proc === p ? ' act' : ''), 14, { rx: 4 }));
        pages.slice(0, 9).forEach((pg, i) => items.push(VX.cell('pg' + j + '_' + i, px + 50 + i * 34, y, 30, 28, pg, 'vx-page', 13, { rx: 4 })));
        if (!pages.length) items.push(VX.text('pe' + j, px + 50, y + 19, 'no pages', 'tick', 13));
        y += 34;
      });
      y += 22;
      items.push(VX.title('tl', px, y, 'TLB (' + a.proc + ')' + (v.sTlb ? '' : ': off')));
      y += 12;
      const tlb = v.sTlb ? a.tlb || [] : [];
      tlb.slice(0, 9).forEach((pg, i) => items.push(VX.cell('tlb' + i, px + i * 34, y, 30, 28, pg, 'vx-tlb', 13, { rx: 4 })));
      if (!tlb.length) items.push(VX.text('tle', px, y + 19, v.sTlb ? 'empty' : 'every touch walks', 'tick', 13));
      y += 54;
      items.push(VX.title('kt', px, y, 'shadow tables the VMM keeps'));
      y += 12;
      keptAt[k].forEach((p, i) => items.push(VX.cell('kp' + i, px + i * 48, y, 42, 28, p, 'vx-shadowtab', 14, { rx: 4 })));
      return { items, h: y + 28 - py };
    };
    const stH = 22 + procs.length * 34 + 22 + 12 + 54 + 12 + 28 + 12;
    const bx = 0, by = narrow ? py + stH + 26 : tblH + 30;
    const bars = (a, b) => {
      const items = [VX.title('bt', bx, by, narrow ? 'cost so far (exit = ' + E + ' reads)' : 'so far, with an exit weighed as ' + VX.plural(E, 'table read'))];
      const max = Math.max(1, cost(A), cost(B));
      const rows = [
        { label: 'shadow: exits', v: a.exits * E, text: String(a.exits), cls: 'vx-exitbar' },
        { label: 'nested: exits', v: b.exits * E, text: String(b.exits), cls: 'vx-exitbar' },
        { label: 'shadow: reads', v: a.walkReads, text: String(a.walkReads), cls: 'vx-shbar' },
        { label: 'nested: reads', v: b.walkReads, text: String(b.walkReads), cls: 'vx-nbar' },
        { label: 'shadow: cost', v: cost(a), text: String(cost(a)), cls: 'vx-costbar' },
        { label: 'nested: cost', v: cost(b), text: String(cost(b)), cls: 'vx-costbar' },
      ];
      const nrows = [
        { label: 'shadow', v: cost(a), text: cost(a) + ' (' + a.exits + ' exits)', cls: 'vx-shbar' },
        { label: 'nested', v: cost(b), text: cost(b) + ' (' + b.exits + ' exits)', cls: 'vx-nbar' },
      ];
      items.push(...VX.bars({ prefix: 'br', x: bx, y: by + 16, labelW: narrow ? 70 : 120, w: narrow ? 170 : 470, rowH: 28, rows: narrow ? nrows : rows, max }).items);
      return items;
    };
    const view = narrow ? box(-6, -4, 384, by + 16 + 2 * 28 + 10) : box(-10, -4, 1020, Math.max(by + 16 + 6 * 28 + 12, stH + 10));
    const metrics = (a, b) => [
      { label: 'Shadow: VM exits', value: a.exits, cls: a.exits > b.exits ? 'bad' : '' }, { label: 'Nested: VM exits', value: b.exits, cls: b.exits > a.exits ? 'bad' : '' },
      { label: 'Shadow: walk reads', value: a.walkReads, note: g + ' a TLB miss' }, { label: 'Nested: walk reads', value: b.walkReads, note: N + ' a TLB miss' },
      { label: 'Shadow: cost', value: cost(a), unit: 'reads', note: 'reads + ' + E + ' × exits' }, { label: 'Nested: cost', value: cost(b), unit: 'reads', note: 'reads + ' + E + ' × exits' },
    ];
    const tableOf = (k) => [{ title: 'Each event under both designs', cols: ['event', 'shadow', 'nested'], rows: allRows.slice(0, Math.min(k, allRows.length)).map((r) => r.map((c) => (typeof c === 'object' ? c : String(c)))), hl: Math.min(k, allRows.length) - 1 }];

    const frames = [], trace = [];
    for (let k = 0; k < n; k++) {
      const a = A.steps[k], b = B.steps[k];
      trace.push({ kind: a.kind, say: 'Shadow: ' + VX.plain(a.say) + ' Nested: ' + VX.plain(b.say), exits: [a.exits, b.exits], reads: [a.walkReads, b.walkReads] });
      let say;
      if (k === 0) say = VX.plain(a.say) + ' ' + VX.plain(b.say) + ' P maps pages 1 and 2, Q maps page 1.';
      else if (k === n - 1) {
        const ca = cost(A), cb = cost(B);
        say = VX.plain(a.say) + ' ' + VX.plain(b.say) + ' Weighing an exit as ' + VX.plural(E, 'table read') + ': shadow ' + ca + ', nested ' + cb + (ca > cb ? ', so nested paging wins here.' : ca < cb ? ', so shadow tables win here.' : ', even.');
      } else say = 'Shadow: ' + VX.plain(a.say) + ' Nested: ' + VX.plain(b.say);
      const items = [...tbl(k), ...state(k).items, ...bars(k === n - 1 ? A : a, k === n - 1 ? B : b)];
      frames.push({ items, say, at: k, view, title: k === 0 ? 'start' : k === n - 1 ? 'totals' : evText(a.ev), tables: tableOf(k), metrics: metrics(k === n - 1 ? A : a, k === n - 1 ? B : b), hold: k === n - 1 ? 2600 : 1300 });
    }
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, plan: { A, B, N } };
  };
})(globalThis.Proses = globalThis.Proses || {});
