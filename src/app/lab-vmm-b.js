// The VM lab, part two: the two-dimensional walk. A guest-virtual address the student types, g guest levels and
// h host levels: the address split into the guest's indexes, a grid with a row for each guest level (and one for the
// data) and a column for each host level (and one for the guest entry itself), filled read by read in the order the
// hardware reads, the table page each read lands in, and the reads counted against (g + 1)(h + 1) − 1. Then the same
// address through the VMM's shadow table, g reads, to the same host-physical address.
//   VX.walkRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const KM = () => S.Kit.mem;
  const box = (x, y, w, h) => ({ x, y, w, h });

  /** the table page a step read, drawn with its selected entry */
  function tablePic(W, st, x, y, w, narrow) {
    const M = S.Mem, t = st.table || null;
    if (!t) return { items: [], h: 0 };
    const pt = t.side === 'host' ? W.host : t.side === 'shadow' ? st.pt : W.guest;
    const frame = t.base >> 12n, tab = pt.tables.find((q) => q.frame === frame);
    const hx = (v) => M.hex(v, 0, false);
    const entry = (i) => {
      const e = tab && tab.entries.get(i);
      if (!e || !e.valid) return { text: 'not valid', cls: 'inv' };
      const what = t.side === 'guest' ? 'guest frame ' : 'host frame ';
      return { text: (narrow ? '→ ' : '→ ' + what) + hx(e.pfn) + (e.leaf ? (narrow ? '' : ' (page)') : '') };
    };
    const title = t.side === 'host' ? 'host L' + (t.level + 1) + ' table' : t.side === 'shadow' ? 'shadow L' + (t.level + 1) + ' table' : 'guest L' + (t.level + 1) + ' table';
    const sub = t.side === 'guest' ? 'gpa ' + hx(t.base) + ' = host ' + hx(t.hostBase) : 'at host ' + hx(t.base);
    const cls = t.side === 'host' ? 'vx-host' : t.side === 'shadow' ? 'vx-shadow' : KM().lv(t.level);
    const r = KM().table({ prefix: 'tp', x, y, w, rowH: 28, idxW: 46, title, sub, cls, n: 512, sel: t.index, entry, act: true, size: 13 });
    return { items: r.items, h: r.h };
  }

  VX.walkRun = function (v, ctx) {
    const V = S.Virt, M = S.Mem, narrow = ctx.narrow, g = v.wG, h = v.wH;
    const gva = VX.parseHex(v.wAddr);
    const W = VX.walkAt(g, h, gva, ctx.seed);
    const SH = v.wShadow ? VX.shadowWalk(W) : null;
    const N = V.count2d(g, h), hx = (x) => M.hex(x, 0, false);
    // ---- geometry
    const cw = narrow ? 46 : 62, ch = narrow ? 28 : 32, gap = 4;
    const gx = narrow ? 52 : 110, gy = narrow ? 134 : 150;
    const gridW = (h + 1) * (cw + gap) - gap, gridH = (g + 1) * (ch + gap) - gap;
    const legY = gy + gridH + (narrow ? 14 : 18), shY = legY + (narrow ? 32 : 44), barsY = shY + (v.wShadow ? 70 : 0) + 20;
    const tx = narrow ? 0 : Math.max(gx + gridW + 60, 580), ty = narrow ? shY + (v.wShadow ? ch + 22 : 0) : gy - 30, tw = narrow ? 360 : 320;
    const stripW = narrow ? 364 : 600;
    const fs = W.gfields, bitsAll = fs.reduce((a, f) => a + f.bits, 0);
    const fields = fs.map((f) => ({ name: f.name, bits: f.bits, value: f.value, cls: KM().lv(f.level), w: Math.round((f.bits / bitsAll) * stripW), text: f.level < 0 ? hx(f.value) : String(f.value), label: f.level < 0 ? 'offset' : (narrow ? 'L' : 'guest L') + (f.level + 1) }));
    const cells = new Map();
    let shadowCells = [];

    const strip = (act) => [
      VX.text('va', 0, 14, (narrow ? 'gVA ' : 'guest-virtual address ') + hx(W.gva) + (narrow ? '' : ': ' + g + ' indexes of 9 bits and a 12-bit offset'), 'mono strong', 14),
      ...KM().strip({ prefix: 'vs', x: 0, y: 30, fields, h: 32, bits: false, act, size: 13 }).items,
    ];
    const counter = (n, shadowN) => {
      const x = narrow ? 0 : stripW + 40, y = narrow ? 92 : 30;
      if (narrow) return [VX.text('ct0', x, y + 14, 'reads ' + n + ' of ' + N + (v.wShadow ? ' · shadow ' + (shadowN || 0) + ' of ' + g : ''), 'strong', 14)];
      const items = [VX.text('ct0', x, y + 14, 'table reads: ' + n + ' of ' + N, 'strong', 15)];
      items.push(VX.text('ct1', x, y + 38, '(' + g + ' + 1)(' + h + ' + 1) − 1 = ' + N, 'mono', 13));
      if (v.wShadow && !narrow) items.push(VX.text('ct2', x, y + 60, 'shadow: ' + (shadowN || 0) + ' of ' + g, 'mono', 13));
      return items;
    };
    const grid = (cur) => {
      const items = [];
      for (let c = 0; c <= h; c++) items.push(VX.text('ch' + c, gx + c * (cw + gap) + cw / 2, gy - 10, c < h ? (narrow ? 'h' : 'host L') + (c + 1) : 'entry', 'tick', 13, 'middle'));
      for (let r = 0; r <= g; r++) {
        items.push(VX.text('rh' + r, gx - 10, gy + r * (ch + gap) + ch / 2 + 5, r < g ? (narrow ? 'g' : 'guest L') + (r + 1) : 'data', 'strong ' + (r < g ? 'vx-lvtext ' + KM().lv(r) : ''), 13, 'end'));
        for (let c = 0; c <= h; c++) {
          const k = r + '_' + c, val = cells.get(k), kind = W.grid[r][c];
          items.push(VX.cell('gc' + k, gx + c * (cw + gap), gy + r * (ch + gap), cw, ch, val === undefined ? '' : val, 'vx-w ' + (val === undefined ? 'empty' : kind) + (kind === 'guest' ? ' ' + KM().lv(r) : '') + (cur === k ? ' act' : ''), 14, { rx: 4 }));
        }
      }
      const lg = VX.legend({ prefix: 'lg', x: narrow ? 0 : gx - 60, y: legY, maxW: narrow ? 370 : 470, entries: narrow ? [{ cls: 'vx-w host', text: 'host read' }, { cls: 'vx-w guest lv0', text: 'guest entry' }, { cls: 'vx-w data', text: 'data' }] : [{ cls: 'vx-w host', text: 'a host table read' }, { cls: 'vx-w guest lv0', text: 'a guest entry' }, { cls: 'vx-w data', text: 'the data' }] });
      items.push(...lg.items);
      return items;
    };
    const shadowRow = (cur) => {
      if (!v.wShadow) return [];
      const items = [VX.text('shl', gx - 10, shY + ch / 2 + 5, 'shadow', 'strong vx-shtext', 13, 'end')];
      for (let l = 0; l < g; l++) items.push(VX.cell('sc' + l, gx + l * (cw + gap), shY, cw, ch, shadowCells[l] || '', 'vx-w ' + (shadowCells[l] ? 'shadow' : 'empty') + (cur === l ? ' act' : ''), 14, { rx: 4 }));
      items.push(VX.text('shn', gx + g * (cw + gap) + 6, shY + ch / 2 + 5, narrow ? '' : 'the VMM\'s combined table: gVA → host', 'tick', 13));
      return items;
    };
    const bars = (nested, shadow) => {
      if (narrow) return [];
      const rows = [{ label: 'native', v: g, text: g + ' reads', cls: 'soft' }];
      if (v.wShadow) rows.push({ label: 'shadow', v: shadow === undefined ? g : shadow, text: (shadow === undefined ? g : shadow + ' of ' + g) + ' reads', cls: 'vx-shbar' });
      rows.push({ label: 'nested', v: nested, text: nested + ' of ' + N + ' reads', cls: 'vx-nbar' });
      const x = narrow ? 0 : gx - 110;
      return [VX.title('bt', x, barsY, narrow ? 'a TLB miss costs' : 'what one TLB miss costs, in table reads'), ...VX.bars({ prefix: 'br', x, y: barsY + 16, labelW: 80, w: narrow ? 190 : 330, rowH: 28, rows, max: N }).items];
    };
    const viewW = narrow ? box(-6, -4, 384, ty + 186) : box(-12, -4, Math.max(tx + tw, stripW + 300) + 24, Math.max(barsY + 16 + 3 * 28 + 10, ty + 200));

    const frames = [], trace = [];
    const readRows = [];
    const guestRows = () => W.steps.filter((s) => s.kind === 'guest-read').map((s) => [String(s.row + 1), String(s.table.index), hx(s.table.base), hx(s.table.hostBase), hx(s.table.next)]);
    const tables = (upto) => [
      { title: 'Every table read, in order', cols: ['#', 'read', 'table', 'index', 'entry at (host)'], rows: readRows.slice(0, upto), hl: upto - 1 },
      { title: 'The guest’s own walk', cols: ['level', 'index', 'table (gpa)', 'table (host)', 'gives guest frame'], rows: guestRows() },
    ];
    const metrics = (n, sh) => [
      { label: 'Nested walk, table reads', value: n + ' of ' + N, cls: n === N ? 'act' : '' },
      { label: '(g + 1)(h + 1) − 1', value: N, note: '(' + g + ' + 1)(' + h + ' + 1) − 1' },
      { label: 'Shadow walk, table reads', value: v.wShadow ? (sh || 0) + ' of ' + g : g, note: 'g: the VMM combined the tables' },
      { label: 'Native walk, table reads', value: g },
      { label: 'Nested against native', value: VX.fix(N / g, 2) + '×' },
      { label: 'guest-virtual', value: hx(W.gva) }, { label: 'guest-physical', value: hx(W.gpa) }, { label: 'host-physical', value: hx(W.hpa) },
    ];
    const push = (f) => frames.push(Object.assign({ view: viewW }, f));

    // the nested walk
    let n = 0;
    W.steps.forEach((st) => {
      const at = trace.length;
      trace.push({ kind: st.kind, say: st.say, row: st.row, col: st.col, accesses: st.accesses });
      let cur = null;
      if (st.kind !== 'start') { const k = st.row + '_' + st.col; cur = k; cells.set(k, st.kind === 'data' ? 'D' : st.accesses); }
      if (st.kind === 'host-read' || st.kind === 'guest-read') { n = st.accesses; readRows.push([String(st.accesses), st.kind === 'host-read' ? 'host L' + (st.col + 1) : 'guest L' + (st.row + 1) + ' entry', st.kind === 'host-read' ? 'host L' + (st.col + 1) : 'guest L' + (st.row + 1), String(st.table.index), hx(st.addr)]); }
      const act = st.row < 0 ? [] : st.row < g ? [st.row] : [g];
      const items = [...strip(act), ...counter(n, 0), ...grid(cur), ...shadowRow(null), ...bars(n, undefined), ...tablePic(W, st, tx, ty, tw, narrow).items];
      if (st.kind === 'data') items.push(...dataPic(tx, ty, tw, W, narrow));
      push({ items, say: VX.plain(st.say), at, title: st.kind === 'start' ? 'start' : st.kind === 'data' ? 'the data' : 'read ' + st.accesses, tables: tables(readRows.length), metrics: metrics(n, 0), hold: st.kind === 'data' ? 2200 : 1100 });
    });
    // the shadow walk
    if (SH) {
      SH.steps.forEach((st) => {
        const at = trace.length;
        trace.push({ kind: st.kind, say: st.say, level: st.level, accesses: st.accesses });
        if (st.kind === 'shadow-read') shadowCells[st.level] = st.accesses;
        const fake = st.kind === 'shadow-read' ? { table: { side: 'shadow', level: st.level, base: st.base, index: st.index }, pt: SH.table } : {};
        const items = [...strip(st.kind === 'shadow-read' ? [st.level] : [g]), ...counter(n, Math.min(g, st.accesses)), ...grid(null), ...shadowRow(st.kind === 'shadow-read' ? st.level : null), ...bars(n, Math.min(g, st.accesses)), ...tablePic(W, fake, tx, ty, tw, narrow).items];
        if (st.kind === 'shadow-data') items.push(...dataPic(tx, ty, tw, W, narrow));
        push({ items, say: VX.plain(st.say), at, title: st.kind === 'shadow-read' ? 'shadow ' + st.accesses : 'shadow: the data', tables: tables(readRows.length), metrics: metrics(n, Math.min(g, st.accesses)), hold: 1300 });
      });
    }
    // the sums
    const endSay = 'One TLB miss for ' + hx(W.gva) + ': natively ' + VX.plural(g, 'table read') + '; nested paging ' + N + ', (' + g + ' + 1)(' + h + ' + 1) − 1, which is ' + VX.fix(N / g, 2) + ' times as many' + (v.wShadow ? '; a shadow table ' + g + ', the same as native, as long as the VMM keeps it in sync with the guest\'s.' : '.');
    trace.push({ kind: 'end', say: endSay });
    push({ items: [...strip([]), ...counter(n, SH ? g : 0), ...grid(null), ...shadowRow(null), ...bars(n, SH ? g : undefined), ...dataPic(tx, ty, tw, W, narrow)], say: endSay, at: trace.length - 1, title: 'the sums', tables: tables(readRows.length), metrics: metrics(n, SH ? g : 0), hold: 2600 });
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, plan: { W, SH, N } };
  };

  /** the three addresses of the data, once the walk has found it */
  function dataPic(x, y, w, W, narrow) {
    const M = S.Mem, hx = (v) => M.hex(v, 0, false), items = [];
    const rows = [['guest-virtual', W.gva], ['guest-physical', W.gpa], ['host-physical', W.hpa]];
    items.push(VX.title('dpt', x, y + 10, 'the data'));
    rows.forEach(([a, b], k) => items.push(VX.cell('dp' + k, x, y + 24 + k * 34, w, 28, (narrow ? a.replace('guest-', 'g-').replace('host-', 'h-') : a) + '  ' + hx(b), 'vx-addr' + (k === 2 ? ' good' : ''), 13, { rx: 4, align: 'left' })));
    return items;
  }
})(globalThis.Proses = globalThis.Proses || {});
