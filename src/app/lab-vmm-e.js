// The VM lab, part five: virtualising I/O. The same batch of requests through an emulated device, a paravirtual
// ring and a device passed straight through (S.Virt.ioPath): each path drawn as its hops from the guest program to
// the device and back, lit step by step, with the exits, injected interrupts and copies counted for the student's
// requests, register accesses, batch size and interrupt delivery. Then one call from a native process, a container
// and a virtual machine counted in crossings (S.Virt.crossings).
//   VX.IO_MODES [{id, label}]   VX.ioRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const box = (x, y, w, h) => ({ x, y, w, h });
  VX.IO_MODES = [{ id: 'emulated', label: 'Emulated device' }, { id: 'paravirtual', label: 'Paravirtual ring' }, { id: 'passthrough', label: 'Passthrough' }];
  // which hops each step of a path uses
  const LIT = {
    emulated: { driver: [0, 1], exit: [2], host: [3, 4], inject: [5] },
    paravirtual: { ring: [0, 1, 2], notify: [3], host: [4], inject: [5] },
    passthrough: { assign: [0, 1, 2], dma: [3], irq: [4], cost: [] },
  };
  const GUEST = /^(guest|paravirtual driver|real driver|shared ring)/, HW = /^real device$/;
  const layer = (name) => (HW.test(name) ? 'hw' : GUEST.test(name) ? 'guest' : 'host');

  VX.ioRun = function (v, ctx) {
    const V = S.Virt, narrow = ctx.narrow;
    const o = { requests: v.ioReq, regs: v.ioRegs, batch: v.ioBatch, posted: v.ioPosted };
    const paths = VX.IO_MODES.map((m) => ({ m, R: V.ioPath(m.id, o) }));
    const cmp = V.compareIO(o);
    const cr = v.ioCross ? V.crossings({ op: v.ioOp, io: v.ioXMode, requests: 1, batch: v.ioBatch, regs: v.ioRegs }) : null;
    const colW = narrow ? 370 : 316, gapX = 18, hopH = 46, hopGap = 8, y0 = 34;
    const maxHops = Math.max(...paths.map((p) => p.R.hops.length));
    const colH = maxHops * (hopH + hopGap);
    const sumY = y0 + colH + 8;
    const barY = sumY + (narrow ? 44 : 54);
    const column = (k, x, state) => {
      const p = paths[k], items = [VX.text('ct' + k, x, 22, p.m.label, 'strong vx-modetitle', 15)];
      p.R.hops.forEach((hp, i) => {
        const st = state.lit && state.lit.includes(i) ? ' act' : state.done && state.done.includes(i) ? ' done' : state.future ? ' dim' : '';
        items.push(VX.cell('hp' + k + '_' + i, x, y0 + i * (hopH + hopGap), colW, hopH, '', 'vx-hop ' + layer(hp.to) + st, 13, { rx: 6, lines: [hp.from + ' → ' + hp.to, hp.how] }));
      });
      const r = p.R;
      if (state.counts) items.push(VX.text('cs' + k, x, sumY + 18, VX.plural(r.exits, 'exit') + ' · ' + VX.plural(r.injections, 'injection') + ' · ' + VX.plural(r.copies, 'copy', 'copies'), 'mono', 13));
      return items;
    };
    const bars = (upto) => {
      const shown = cmp.map((c, k) => (k <= upto ? c : null));
      const rows = (f, cls) => shown.map((c, k) => ({ label: VX.IO_MODES[k].label.split(' ')[0].toLowerCase(), v: c ? c[f] : 0, text: c ? String(c[f]) : '…', cls }));
      const bw = narrow ? 56 : 200, lw = narrow ? 84 : 110, bx2 = narrow ? 188 : lw + bw + 120;
      const items = [VX.title('b1', 0, barY, 'VM exits')];
      items.push(...VX.bars({ prefix: 'bx', x: 0, y: barY + 14, labelW: lw, w: bw, rowH: 28, rows: rows('exits', 'vx-exitbar'), max: Math.max(1, ...cmp.map((c) => c.exits)) }).items);
      const y2 = barY;
      items.push(VX.title('b2', bx2, y2, 'data copies'));
      items.push(...VX.bars({ prefix: 'bc', x: bx2, y: y2 + 14, labelW: lw, w: bw, rowH: 28, rows: rows('copies', 'vx-copybar'), max: Math.max(1, ...cmp.map((c) => c.copies)) }).items);
      if (!narrow) items.push(...VX.legend({ prefix: 'lg', x: 3 * colW + 2 * gapX - 170, y: barY + 16, maxW: 170, entries: [{ cls: 'vx-hop guest', text: 'in the guest' }, { cls: 'vx-hop host', text: 'VMM or host' }, { cls: 'vx-hop hw', text: 'the device' }] }).items);
      else items.push(...VX.legend({ prefix: 'lg', x: 0, y: y2 + 14 + 3 * 28 + 6, maxW: 370, entries: [{ cls: 'vx-hop guest', text: 'in the guest' }, { cls: 'vx-hop host', text: 'VMM or host' }, { cls: 'vx-hop hw', text: 'the device' }] }).items);
      return items;
    };
    const barsH = narrow ? 14 + 3 * 28 + 34 : 14 + 3 * 28;
    const view = narrow ? box(-6, -4, 384, barY + barsH + 14) : box(-10, -4, 3 * colW + 2 * gapX + 20, barY + barsH + 14);

    const frames = [], trace = [];
    const tableOf = (upto) => [{ title: 'The three paths, ' + VX.plural(v.ioReq, 'request'), cols: ['path', 'VM exits', 'per request', 'injected interrupts', 'copies'], rows: cmp.filter((c, k) => k <= upto).map((c) => [c.mode, String(c.exits), String(c.perRequest), String(c.injections), String(c.copies)]), hl: upto }];
    const metricsOf = (upto) => cmp.filter((c, k) => k <= upto).map((c) => ({ label: VX.cap(c.mode) + ': exits', value: c.exits, note: c.perRequest + ' a request' }));
    const add = (kind, say, items, upto, title) => { trace.push({ kind, say }); frames.push({ items, say, at: trace.length - 1, view, title, tables: tableOf(upto), metrics: metricsOf(upto), hold: kind === 'total' ? 1800 : 1300 }); };

    paths.forEach((p, k) => {
      const done = [];
      p.R.steps.forEach((st) => {
        const lit = st.kind === 'total' ? [] : (LIT[p.m.id][st.kind] || []);
        const items = [];
        if (narrow) items.push(...column(k, 0, { lit, done: done.slice(), counts: st.kind === 'total' }));
        else paths.forEach((q, j) => items.push(...column(j, j * (colW + gapX), j < k ? { done: q.R.hops.map((_, i) => i), counts: true } : j === k ? { lit, done: st.kind === 'total' ? p.R.hops.map((_, i) => i) : done.slice(), counts: st.kind === 'total' } : { future: true })));
        items.push(...bars(st.kind === 'total' ? k : k - 1));
        add(st.kind, VX.plain(st.say), items, st.kind === 'total' ? k : k - 1, p.m.label + ': ' + st.kind);
        done.push(...lit);
      });
    });
    const best = cmp.slice().sort((a, b) => a.exits - b.exits)[0], worst = cmp.slice().sort((a, b) => b.exits - a.exits)[0];
    const cmpSay = 'For ' + VX.plural(v.ioReq, 'request') + ' of ' + VX.plural(v.ioRegs, 'register access', 'register accesses') + ': ' + cmp.map((c) => c.mode + ' ' + VX.plural(c.exits, 'exit')).join(', ') + '. ' + VX.cap(worst.mode) + ' costs the most because ' + (worst.mode === 'emulated' ? 'every register access traps into the device model' : 'its notifications and interrupts go through the VMM') + '; ' + best.mode + ' the least' + (best.mode === 'passthrough' ? ', but the device then belongs to one guest.' : '.');
    const allCols = [];
    if (narrow) allCols.push(...column(2, 0, { done: paths[2].R.hops.map((_, i) => i), counts: true }));
    else paths.forEach((q, j) => allCols.push(...column(j, j * (colW + gapX), { done: q.R.hops.map((_, i) => i), counts: true })));
    add('compare', cmpSay, [...allCols, ...bars(2)], 2, 'compared');
    if (cr) {
      const cols = narrow ? [{ w: 150, label: 'setup' }, { w: 76, label: 'switches' }, { w: 62, label: 'exits' }, { w: 76, label: 'kernels' }] : [{ w: 320, label: 'one ' + v.ioOp + '() from…' }, { w: 160, label: 'mode switches' }, { w: 140, label: 'VM exits' }, { w: 140, label: 'kernels on the path' }];
      cr.steps.forEach((st, k) => {
        const rows = cr.rows.slice(0, Math.min(k + 1, cr.rows.length)).map((r, i) => ({ key: i, cls: i === k ? 'act' : '', cells: [narrow ? r.setup.replace('virtual machine', 'VM').replace(' I/O', '') : r.setup, String(r.modeSwitches), String(r.exits), String(r.kernels)] }));
        const items = [VX.title('crt', 0, 8, narrow ? 'process, container, VM' : 'a native process, a container and a virtual machine'), ...S.Kit.gantt.table({ prefix: 'cr', x: 0, y: 24, rowH: 34, size: narrow ? 12 : 14, cols, rows }).items];
        const para = VX.para('crp', 0, 24 + 34 * 4 + 30, VX.plain(st.say), narrow ? 360 : 760, 14);
        items.push(...para.items);
        trace.push({ kind: 'crossing', say: VX.plain(st.say) });
        frames.push({ items, say: VX.plain(st.say), at: trace.length - 1, view, title: st.kind === 'result' ? 'containers against VMs' : st.row.setup, tables: [{ title: 'One ' + v.ioOp + '()', cols: ['setup', 'mode switches', 'VM exits', 'kernels'], rows: cr.rows.map((r) => [r.setup, String(r.modeSwitches), String(r.exits), String(r.kernels)]), hl: Math.min(k, 2) }], metrics: metricsOf(2), hold: 1800 });
      });
    }
    return { frames, trace, tables: tableOf(2), metrics: metricsOf(2), plan: { paths, cmp, cr } };
  };
})(globalThis.Proses = globalThis.Proses || {});
