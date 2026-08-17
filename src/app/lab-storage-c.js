// The Storage lab, part three: the SSD workbench. A drive of the student's blocks and pages behind a page-mapping
// translation layer (S.SSD), with its over-provisioning, garbage-collection policy, wear levelling and TRIM, fed a
// sequential, uniform or hot-and-cold stream of writes (S.SSD.workload). The picture: every block as a column of
// pages coloured free, valid or invalid, its erase count under it; write amplification against host writes; and a
// histogram of erase counts. The run is cut into stretches; each frame is the drive after one stretch.
//   SL.ssdPlan(v, seed) -> {F, ops, cuts: [{from, to, snap, steps, series}], series, stats}   SL.ssdRun(v, ctx)
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const SSD = () => S.SSD;

  SL.ssdCheck = function (v) {
    if (v.sBlocks * v.sPages > 1024) return 'The flash: at most 1024 pages in all (' + v.sBlocks + ' × ' + v.sPages + ' = ' + v.sBlocks * v.sPages + '), so every page can be drawn';
    return null;
  };

  SL.ssdPlan = function (v, seed) {
    const F = SSD().create({ blocks: v.sBlocks, pages: v.sPages, op: v.sOp, gc: v.sGc, wear: v.sWear, wearDelta: v.sDelta });
    const ops = SSD().workload(v.sWork, v.sCount, { logical: F.logical, seed: seed || 1, hot: v.sHot, hotShare: v.sHotShare, fill: v.sFill, trim: v.sTrim });
    const fillN = v.sFill ? F.logical : 0, N = ops.length;
    // the cut points: the start, the end of the fill, the op that first collects garbage, and even stretches between
    const marks = new Set([0, N]);
    if (fillN && fillN < N) marks.add(fillN);
    const per = Math.max(1, Math.ceil((N - fillN) / 12));
    for (let i = fillN + per; i < N; i += per) marks.add(i);
    const cuts = [], series = [], allSteps = [];
    const snap0 = SSD().snapshot(F);
    cuts.push({ from: 0, to: 0, snap: snap0, steps: [], series: [] });
    const sorted = [...marks].sort((a, b) => a - b);
    let firstGc = null;
    for (let k = 1; k < sorted.length; k++) {
      let a = sorted[k - 1];
      const b = sorted[k];
      while (a < b) {
        // stop a stretch at the first op that collects garbage, so that moment gets a frame of its own
        let end = b;
        if (firstGc === null) {
          const probe = SSD().run(cloneF(F), ops.slice(a, b), {});
          const at = probe.steps.find((s) => s.kind === 'gc-victim');
          if (at) { let i = 0; for (const s of probe.steps) { if (s === at) break; if (s.kind === 'op') i++; } end = a + i + 1; firstGc = end; if (end - 1 > a) end = end - 1; }
        }
        const r = SSD().run(F, ops.slice(a, end), {});
        r.series.forEach((x) => series.push(Object.assign({}, x, { i: x.i + a })));
        const steps = r.steps.map((s) => (s.kind === 'op' ? Object.assign({}, s, { i: s.i + a }) : s));
        allSteps.push(...steps);
        cuts.push({ from: a, to: end, snap: SSD().snapshot(F), steps, series: r.series });
        a = end;
      }
    }
    return { F, ops, fillN, cuts, series, steps: allSteps, stats: SSD().stats(F), firstGc };
  };
  /** an independent copy of a drive, so a stretch can be looked at before it is run */
  function cloneF(F) {
    return Object.assign({}, F, { page: F.page.slice(), data: F.data.slice(), p2l: F.p2l.slice(), l2p: F.l2p.slice(), blocks: F.blocks.map((b) => Object.assign({}, b)), free: F.free.slice(), stats: Object.assign({}, F.stats) });
  }

  SL.ssdRun = function (v, ctx) {
    const plan = SL.ssdPlan(v, ctx.seed), { F, cuts, series, fillN } = plan, narrow = ctx.narrow, fix = SL.fix;
    const W = narrow ? 370 : 960, B = F.B, P = F.P;
    const colW = Math.min(64, (W - 30) / B), gap = colW >= 20 ? 3 : 2, cw = colW - gap - 4;
    const ch = Math.max(8, Math.min(22, Math.floor((narrow ? 190 : 230) / P) - 2)), rowH = ch + 2;
    const gx = 30, gy = 30, gridH = P * rowH + 6;
    const showLpn = cw >= 24 && ch >= 15;
    const nmEvery = colW >= 26 ? 1 : colW >= 14 ? 2 : 4;
    const maxWA = Math.max(1.5, ...series.map((s) => s.wa));
    const total = plan.ops.length;
    const frames = [], trace = [];
    const maxE = Math.max(1, ...cuts[cuts.length - 1].snap.blocks.map((b) => b.erases));
    cuts.forEach((c, k) => {
      const items = [], snap = c.snap, st = snap.stats, fin = k === cuts.length - 1;
      const victims = new Set(c.steps.filter((s) => s.kind === 'gc-victim').map((s) => s.block));
      const erased = new Set(c.steps.filter((s) => s.kind === 'erase').map((s) => s.block));
      const lastVictim = [...c.steps].reverse().find((s) => s.kind === 'gc-victim');
      items.push(SL.title('g:t', 0, 12, 'the flash: ' + B + ' blocks of ' + P + ' pages · the drive shows ' + F.logical + ' logical pages'));
      snap.blocks.forEach((b) => {
        const x = gx + b.id * colW, P_ = 'b' + b.id;
        const cls = 'blk' + (b.active ? ' active' : '') + (lastVictim && lastVictim.block === b.id && !b.active ? ' victim' : '');
        items.push({ key: P_ + ':r', kind: 'region', x: SL.r1(x), y: gy, w: SL.r1(colW - gap), h: gridH, rx: 4, cls, audit: 'group' });
        b.pages.forEach((pg, j) => items.push({ key: P_ + ':p' + j, kind: 'cell', x: SL.r1(x + 2), y: gy + 3 + j * rowH, w: SL.r1(cw), h: ch, rx: 2, text: showLpn && pg !== 'free' ? String(b.lpns[j] >= 0 ? b.lpns[j] : '×') : '', size: 11, cls: 'pg ' + pg }));
        if (b.id % nmEvery === 0) items.push(SL.text(P_ + ':n', x + (colW - gap) / 2, gy - 6, b.id, 'tick', 11, 'middle'));
        if (colW >= 18 || b.id % 2 === 0) items.push(SL.text(P_ + ':e', x + (colW - gap) / 2, gy + gridH + 16, b.erases, b.erases === maxE && maxE > 0 ? 'act-t' : 'tick', 11, 'middle'));
      });
      items.push(SL.text('g:bl', gx - 6, gy - 6, 'block', 'tick', 11, 'end'));
      items.push(SL.text('g:el', gx - 6, gy + gridH + 16, 'erases', 'tick', 11, 'end'));
      const ly = gy + gridH + 30;
      const lg = SL.legend('g:lg', gx, ly, [{ cls: 'pg valid', text: 'valid' }, { cls: 'pg invalid', text: 'invalid (stale)' }, { cls: 'pg free', text: 'free (erased)' }, { cls: 'blk-sw active', text: 'active block' }, { cls: 'blk-sw victim', text: 'last victim' }], W - gx, 12);
      items.push(...lg.items);
      // write amplification against host writes
      const py = ly + lg.h + 40, pw = narrow ? 300 : 520, ph = narrow ? 130 : 160;
      const ax = S.Kit.curve.axes({ prefix: 'wa', x: 44, y: py, w: pw, h: ph, xr: [0, Math.max(1, total)], yr: [1, Math.ceil(maxWA * 2) / 2], xticks: undefined, yticks: undefined, xname: 'operations', yname: 'write amplification (flash ÷ host writes)', tickSize: 12 });
      items.push(...ax.items);
      const upto = series.filter((s) => s.i < c.to);
      const step = Math.max(1, Math.floor(upto.length / 160));
      const pts = upto.filter((s, i) => i % step === 0 || i === upto.length - 1).filter((s) => s.host > 0).map((s) => [s.i + 1, s.wa]);
      items.push(S.Kit.curve.line(ax, 'wa:line', pts.length ? pts : [[0, 1]], 'act'));
      if (fillN && fillN < total) items.push(S.Kit.curve.vline(ax, 'wa:fill', fillN, 'faint'));
      if (pts.length) items.push(S.Kit.curve.dot(ax, 'wa:now', pts[pts.length - 1][0], pts[pts.length - 1][1], 'act', 4.5));
      // the erase-count histogram
      const hx = narrow ? 44 : 640, hy = narrow ? py + ph + 76 : py, hw = narrow ? 300 : 300, hh = ph;
      const bins = Math.min(12, maxE + 1), bw = Math.ceil((maxE + 1) / bins);
      const counts = Array.from({ length: bins }, () => 0);
      snap.blocks.forEach((b) => { counts[Math.min(bins - 1, Math.floor(b.erases / bw))]++; });
      const hmax = Math.max(1, ...counts);
      const hax = S.Kit.curve.axes({ prefix: 'eh', x: hx, y: hy, w: hw, h: hh, xr: [0, bins], yr: [0, hmax], xticks: 0, yticks: S.Kit.curve.ticks(0, hmax, Math.min(4, hmax)).filter((t) => Number.isInteger(t)), yname: 'blocks with this many erases', grid: false, tickSize: 12 });
      items.push(...hax.items);
      counts.forEach((n, i) => {
        const x0 = hax.X(i) + 2, x1 = hax.X(i + 1) - 2;
        if (n) items.push({ key: 'eh:b' + i, kind: 'cell', x: SL.r1(x0), y: SL.r1(hax.Y(n)), w: SL.r1(x1 - x0), h: SL.r1(hax.Y(0) - hax.Y(n)), rx: 2, text: '', cls: 'bar12' });
        const lab = bw === 1 ? String(i) : i * bw + '–' + (i * bw + bw - 1);
        if (bins <= 8 || i % 2 === 0) items.push(SL.text('eh:x' + i, (x0 + x1) / 2, hy + hh + 17, lab, 'tick', 11, 'middle'));
      });
      items.push(SL.text('eh:xn', hx + hw, hy + hh + 36, 'erase count', 'axname', 12, 'end'));
      // the sentence
      let say;
      const gcs = c.steps.filter((s) => s.kind === 'gc-victim').length, copies = c.steps.filter((s) => s.kind === 'gc-copy').length;
      const wl = c.steps.filter((s) => s.kind === 'wear-level').length, trims = c.steps.filter((s) => s.kind === 'invalidate' && /^TRIM/.test(s.say)).length;
      if (k === 0) say = 'A fresh drive: ' + B + ' erased blocks of ' + P + ' pages (' + B * P + ' pages), of which it shows ' + F.logical + ' as logical pages: ' + Math.round(F.opReal * 100) + '% spare. ' + SL.cap(v.sWork === 'hotcold' ? 'hot and cold' : v.sWork) + ' writes come next' + (v.sFill ? ', after one write to every page.' : '.');
      else if (c.from === 0 && fillN && c.to === fillN) say = 'Every logical page has been written once: ' + st.host + ' host writes, ' + st.flash + ' flash writes, no garbage yet. ' + snap.blocks.filter((b) => b.free).length + ' blocks are still free.';
      else if (c.to === plan.firstGc && lastVictim) say = 'Operation ' + c.to + ' finds too few free blocks. ' + lastVictim.say + ' Its valid pages are copied out and it is erased: write amplification is now ' + st.wa + '.';
      else say = 'Operations ' + (c.from + 1) + '–' + c.to + ': ' + SL.plural(gcs, 'garbage collection') + ' copied ' + SL.plural(copies, 'valid page') + (wl ? ', ' + SL.plural(wl, 'wear-levelling move') : '') + (trims ? ', ' + SL.plural(trims, 'page') + ' trimmed' : '') + '. So far ' + st.host + ' host writes became ' + st.flash + ' flash writes: write amplification ' + st.wa + '; erases per block from ' + st.minErase + ' to ' + st.maxErase + '.';
      trace.push({ kind: k === 0 ? 'start' : 'stretch', say });
      for (const s of c.steps) if (s.kind === 'gc-victim' || s.kind === 'wear-level') trace.push({ kind: s.kind, say: s.say });
      const tables = [{ title: 'Each block', cols: ['block', 'valid', 'invalid', 'free', 'erases'], rows: snap.blocks.map((b) => [String(b.id) + (b.active ? ' (active)' : ''), String(b.valid), String(b.invalid), String(P - b.valid - b.invalid), String(b.erases)]), hl: lastVictim ? lastVictim.block : undefined }];
      const metrics = [
        { label: 'Host writes', value: st.host }, { label: 'Flash writes', value: st.flash, note: st.gcCopies + ' garbage-collection copies' + (st.wlCopies ? ', ' + st.wlCopies + ' wear-levelling moves' : '') },
        { label: 'Write amplification', value: st.wa, cls: st.wa > 2 ? 'bad' : st.wa > 1 ? 'act' : 'good', note: st.flash + ' ÷ ' + st.host },
        { label: 'Garbage collections', value: st.gcRuns }, { label: 'Erases', value: st.erases, note: 'per block ' + st.minErase + ' to ' + st.maxErase },
        { label: 'Pages trimmed', value: st.trims }, { label: 'Spare flash', value: Math.round(F.opReal * 100) + '%', note: F.logical + ' logical pages on ' + B * P },
      ];
      frames.push({ items, say, at: trace.length - 1, title: k === 0 ? 'start' : 'ops ' + c.to, tables, metrics, hold: 1300 });
      if (fin) frames[frames.length - 1].say += ' ' + (st.maxErase - st.minErase > 2 ? 'The most worn block has had ' + (st.maxErase - st.minErase) + ' more erases than the least.' : 'Wear is even: the erase counts differ by at most ' + (st.maxErase - st.minErase) + '.');
    });
    return { frames, trace, plan, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics };
  };
})(globalThis.Proses = globalThis.Proses || {});
