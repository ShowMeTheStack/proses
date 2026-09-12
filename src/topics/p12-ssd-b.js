// Part 12, solid-state drives (2): garbage collection at scale (the blocks as a map of pages, the victim chosen,
// write amplification over time) and wear levelling (the erase counts of every block under three policies).
// Everything is the SSD model's own state (src/core/st-f-ssd.js), sampled as the workload runs.
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const WL = [{ value: 'uniform', label: 'random writes, all pages alike' }, { value: 'hotcold', label: 'hot and cold: 80% of writes to 20% of pages' }, { value: 'sequential', label: 'sequential rewrites' }];
  const OPS = [{ value: '0.07', label: '7% spare' }, { value: '0.15', label: '15% spare' }, { value: '0.28', label: '28% spare' }, { value: '0.5', label: '50% spare' }];

  /** the blocks as a bitmap: one column a block, one row a page: free 0, valid 1, invalid 2, valid in the active block 3, victim 4 */
  function pageMap(prefix, x, y, sn, cw, ch, victim) {
    const rows = [];
    for (let k = 0; k < sn.P; k++) rows.push(sn.blocks.map((b) => (b.id === victim && b.pages[k] !== 'free' ? '4' : b.pages[k] === 'free' ? '0' : b.pages[k] === 'invalid' ? '2' : b.active ? '3' : '1')).join(''));
    return { key: prefix, kind: 'bitmap', x, y, cw, ch, gap: Math.min(2, cw / 5), rows, cls: 'ssdmap', audit: 'ignore' };
  }
  S.T12.ssdPageMap = pageMap;

  // =================================================================================================================
  S.topic({
    id: 'ssd-gc', family: 'p12-ssd', order: 20, title: 'Garbage collection and write amplification',
    blurb: 'Once every block has been written, each new write needs a block erased first, and erasing a block means copying out whatever is still valid in it. Those copies are writes the host never asked for: write amplification. Spare capacity and a good choice of victim keep it low; data that is rewritten in a hot spot helps if the collector waits for its blocks to empty.',
    inputs: [
      { id: 'workload', kind: 'choice', label: 'workload', def: 'uniform', options: WL },
      { id: 'op', kind: 'choice', label: 'over-provisioning', def: '0.15', options: OPS },
      { id: 'gc', kind: 'choice', label: 'victim', def: 'greedy', options: [{ value: 'greedy', label: 'greedy: fewest valid pages' }, { value: 'cost-benefit', label: 'cost-benefit: empty and old' }] },
      { id: 'writes', kind: 'number', label: 'writes after filling', def: 2000, min: 100, max: 20000 },
      { id: 'blocks', kind: 'number', label: 'erase blocks', def: 32, min: 8, max: 64 },
      { id: 'pages', kind: 'number', label: 'pages a block', def: 16, min: 4, max: 64 },
      { id: 'seed', kind: 'number', label: 'seed', def: 7, min: 1, max: 99999 },
    ],
    presets: [
      { label: 'Random writes, 15% spare', values: { workload: 'uniform', op: '0.15', gc: 'greedy', writes: 2000, blocks: 32, pages: 16, seed: 7 } },
      { label: 'The same with 7% spare', values: { workload: 'uniform', op: '0.07', gc: 'greedy', writes: 2000, blocks: 32, pages: 16, seed: 7 } },
      { label: 'The same with 50% spare', values: { workload: 'uniform', op: '0.5', gc: 'greedy', writes: 2000, blocks: 32, pages: 16, seed: 7 } },
      { label: 'Sequential rewrites: no copies', values: { workload: 'sequential', op: '0.15', gc: 'greedy', writes: 2000, blocks: 32, pages: 16, seed: 7 } },
      { label: 'Hot and cold, greedy', values: { workload: 'hotcold', op: '0.15', gc: 'greedy', writes: 4000, blocks: 32, pages: 16, seed: 3 } },
      { label: 'Hot and cold, cost-benefit', values: { workload: 'hotcold', op: '0.15', gc: 'cost-benefit', writes: 4000, blocks: 32, pages: 16, seed: 3 } },
      { label: 'A tiny drive to watch closely', values: { workload: 'uniform', op: '0.28', gc: 'greedy', writes: 120, blocks: 8, pages: 4, seed: 2 } },
    ],
    counters: [{ id: 'host', label: 'host writes' }, { id: 'copies', label: 'GC copies' }, { id: 'erases', label: 'erases' }],
    run(inp) {
      const t = T(), F0 = S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: +inp.op, gc: inp.gc });
      const L = F0.logical, ops = S.SSD.workload(inp.workload, inp.writes, { logical: L, seed: inp.seed, fill: true });
      const F = new S.Frames(['host', 'copies', 'erases']);
      const nCk = 8, fillEnd = L, cks = new Set([fillEnd]);
      for (let k = 1; k <= nCk; k++) cks.add(fillEnd + R((k * inp.writes) / nCk));
      const series = [], frames = [];
      let firstGc = null;
      const cw = Math.max(5, Math.min(14, Math.floor(400 / inp.blocks))), ch = Math.max(3, Math.min(14, Math.floor(220 / inp.pages)));
      const MX = 20, MY = 54, mw = cw * inp.blocks, mh = ch * inp.pages, PX = Math.max(MX + mw + 50, 470);
      const ax = S.Kit.curve.axes({ prefix: 'sg:ax', x: PX, y: 54, w: 790 - PX, h: 150, xr: [0, ops.length], yr: [1, 1], xticks: 0, yticks: 0, xname: 'writes', yname: 'write amplification', grid: false });
      ops.forEach((o, i) => {
        const steps = S.SSD.write(F0, o.lpn).steps;
        const st = S.SSD.stats(F0);
        series.push([i + 1, st.wa]);
        if (!firstGc && i >= fillEnd) { const v = steps.find((x) => x.kind === 'gc-victim'); if (v) firstGc = { i, step: v, before: null }; }
        if (cks.has(i + 1)) frames.push({ i: i + 1, snap: S.SSD.snapshot(F0), stats: st });
      });
      // a second pass up to the first collection after the fill, for its picture (the state just before it)
      let gcFrame = null;
      if (firstGc) {
        const G = S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: +inp.op, gc: inp.gc });
        for (let i = 0; i < firstGc.i; i++) S.SSD.write(G, ops[i].lpn);
        gcFrame = { i: firstGc.i, snap: S.SSD.snapshot(G), stats: S.SSD.stats(G), step: firstGc.step };
      }
      const ymax = Math.max(1.5, Math.ceil(Math.max(...series.map((p) => p[1])) * 2) / 2);
      const ax2 = S.Kit.curve.axes(Object.assign({}, ax.o, { prefix: 'sg:ax', yr: [1, ymax], yticks: S.Kit.curve.ticks(1, ymax, 4), xticks: S.Kit.curve.ticks(0, ops.length, 4) }));
      const legend = T().legend('sg:lg', MX, MY + mh + 16, [{ cls: 'pg free', text: 'free' }, { cls: 'pg valid', text: 'valid' }, { cls: 'pg invalid', text: 'invalid' }, { cls: 'pg act', text: 'victim' }], 420, 13).items;
      const panel = (st, snap, extra) => {
        const free = snap.blocks.filter((b) => b.free).length, y = MY + mh + 60;
        return [t.title('sg:pt', MX, y, 'so far'),
          t.text('sg:p1', MX, y + 28, `host writes ${st.host}  ·  flash writes ${st.flash}`, 'calc', 14),
          t.text('sg:p2', MX, y + 54, `GC copies ${st.gcCopies}  ·  erases ${st.erases}  ·  free blocks ${free}`, 'calc', 14),
          t.text('sg:p3', MX, y + 80, `write amplification ${st.wa}`, 'calc act', 14), ...(extra || [])];
      };
      const curve = (upTo) => [...ax2.items, S.Kit.curve.line(ax2, 'sg:wa', series.filter((p) => p[0] <= upTo).filter((p, k, a) => k % Math.max(1, Math.floor(a.length / 300)) === 0 || k === a.length - 1), 'c0')];
      const base = { B: F0.B, P: F0.P, L, phys: F0.B * F0.P, opPct: t.r1(100 * F0.opReal), writes: inp.writes, total: ops.length, hotPct: [20, 80] };
      F.add({ items: [pageMap('sg:map', MX, MY, S.SSD.snapshot(S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: +inp.op, gc: inp.gc })), cw, ch), t.title('sg:mt', MX, MY - 14, inp.blocks + ' blocks of ' + inp.pages + ' pages'), ...legend, ...curve(0)], say: `${F0.B} blocks of ${F0.P} pages hold ${F0.B * F0.P} pages; the drive shows ${L} of them (${t.fix(100 * F0.opReal, 1)}% spare). First every logical page is written once, then ${inp.writes} more writes follow (${WL.find((w) => w.value === inp.workload).label}).`, meta: Object.assign({ phase: 'start' }, base) });
      const add = (fr, phase, say, extra, victim) => {
        F.set('host', fr.stats.host).set('copies', fr.stats.gcCopies).set('erases', fr.stats.erases);
        F.add({ items: [pageMap('sg:map', MX, MY, fr.snap, cw, ch, victim), t.title('sg:mt', MX, MY - 14, inp.blocks + ' blocks of ' + inp.pages + ' pages'), ...legend, ...curve(fr.i), ...panel(fr.stats, fr.snap, extra)], title: phase, say, meta: Object.assign({ phase, at: fr.i, stats: fr.stats, free: fr.snap.blocks.filter((b) => b.free).length, after: fr.i - fillEnd }, base, extra && extra.meta ? extra.meta : {}) });
      };
      frames.forEach((fr, k) => {
        if (gcFrame && fr.i > gcFrame.i && (k === 0 || frames[k - 1].i <= gcFrame.i)) {
          const v = gcFrame.step, sc = v.scores.slice().sort((a, b) => b.score - a.score || a.block - b.block).slice(0, 4);
          const y = MY + mh + 60 + 110;
          const its = [t.title('sg:vt', MX, y, 'candidates'), ...sc.map((c, j) => t.text('sg:v' + j, MX, y + 26 + j * 22, `block ${c.block}: ${c.valid} valid of ${inp.pages}` + (inp.gc === 'greedy' ? '' : `, age ${c.age}, score ${c.score}`), 'calc' + (c.block === v.block ? ' act' : ''), 13))];
          add(gcFrame, 'gc', v.say + ` Copying them costs ${t.plural(v.valid, 'flash write')} the host never asked for.`, Object.assign(its, { meta: { victim: v.block, valid: v.valid, cands: sc } }), v.block);
        }
        const st = fr.stats, free = fr.snap.blocks.filter((b) => b.free).length;
        if (fr.i === fillEnd) add(fr, 'filled', `All ${L} logical pages are written: ${st.flash} flash writes for ${st.host} host writes, write amplification ${st.wa}. ${t.cap(t.plural(free, 'free block'))} left; from now on space must be reclaimed.`);
        else add(fr, 'progress', `After ${fr.i - fillEnd} more writes: ${st.flash} flash writes for ${st.host} host writes (${st.gcCopies} garbage-collection copies, ${st.erases} erases), write amplification ${st.wa}.`);
      });
      const L1 = frames[frames.length - 1], st = L1.stats;
      F.list[F.list.length - 1].say += ` In the steady state each host write costs about ${st.wa} flash writes.`;
      F.list[F.list.length - 1].meta.wa = st.wa;
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Write amplification', text: ['WA = flash writes / host writes', 'copies = valid pages left in the victims', 'more spare space → emptier victims → fewer copies', 'greedy: the victim with the fewest valid pages', 'cost-benefit: (1 − u) · age / (1 + u), u = valid share'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'filled', pick: 'option', ask: 'From here on, will write amplification stay at 1?', options: ['no: it climbs as garbage collection copies valid pages', 'yes: every write is still one flash write', 'it falls below 1'], answer: (fr) => (fr[fr.length - 1].meta.wa > fr.find((f) => f.meta.phase === 'filled').meta.stats.wa + 1e-9 ? 'no: it climbs as garbage collection copies valid pages' : 'yes: every write is still one flash write'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'More over-provisioning lowers write amplification because…', options: ['victim blocks have had longer to empty, so fewer valid pages must be copied', 'the drive writes faster', 'pages get bigger', 'reads become free'], answer: 0, why: 'With more spare pages the collector can wait, and the blocks it picks hold less live data.' },
      { q: 'Why do sequential rewrites cause almost no copying?', options: ['a block’s pages are all overwritten together, so whole blocks turn invalid', 'they are not stored', 'the FTL compresses them', 'they bypass the FTL'], answer: 0, why: 'A victim with no valid pages is erased without a single copy.' },
      { q: 'The greedy collector picks the block with…', options: ['the fewest valid pages', 'the most erases', 'the oldest data', 'the lowest number'], answer: 0, why: 'Fewest valid pages means fewest copies right now.' },
      { q: 'A drive rated for a number of erases per block wears out sooner when write amplification is high because…', options: ['each host write causes several flash writes and so more erases', 'reads wear it out', 'the mapping table fills', 'it gets hotter'], answer: 0, why: 'Erases come from flash writes, and WA multiplies them.' },
    ],
  });

  // =================================================================================================================
  const POLS = ['none', 'dynamic', 'static'], PNAME = { none: 'no levelling', dynamic: 'dynamic levelling', static: 'static levelling' };
  S.topic({
    id: 'ssd-wear', family: 'p12-ssd', order: 30, title: 'Wear levelling',
    blurb: 'Each flash block survives only so many erases. Hot data rewritten again and again wears out the blocks it lands in while blocks holding cold data are never erased. Dynamic levelling hands out the least-worn free block; static levelling also moves cold data off its block from time to time so that block can share the wear.',
    inputs: [
      { id: 'writes', kind: 'number', label: 'writes after filling', def: 6000, min: 500, max: 30000 },
      { id: 'hot', kind: 'choice', label: 'hot data', def: '0.2', options: [{ value: '0.1', label: '10% of pages get 90% of writes' }, { value: '0.2', label: '20% of pages get 80% of writes' }, { value: '0.5', label: 'no hot spot (50/50)' }] },
      { id: 'delta', kind: 'number', label: 'static: allowed spread of erases', def: 4, min: 1, max: 50 },
      { id: 'blocks', kind: 'number', label: 'erase blocks', def: 24, min: 8, max: 48 },
      { id: 'pages', kind: 'number', label: 'pages a block', def: 16, min: 4, max: 32 },
      { id: 'seed', kind: 'number', label: 'seed', def: 5, min: 1, max: 99999 },
    ],
    presets: [
      { label: 'A hot spot of 20%', values: { writes: 6000, hot: '0.2', delta: 4, blocks: 24, pages: 16, seed: 5 } },
      { label: 'A sharper hot spot', values: { writes: 6000, hot: '0.1', delta: 4, blocks: 24, pages: 16, seed: 5 } },
      { label: 'No hot spot', values: { writes: 6000, hot: '0.5', delta: 4, blocks: 24, pages: 16, seed: 5 } },
      { label: 'Static with a loose limit', values: { writes: 6000, hot: '0.2', delta: 15, blocks: 24, pages: 16, seed: 5 } },
      { label: 'A long run', values: { writes: 25000, hot: '0.2', delta: 4, blocks: 32, pages: 16, seed: 9 } },
    ],
    counters: [{ id: 'writes', label: 'writes' }],
    run(inp) {
      const t = T(), F = new S.Frames(['writes']), hot = +inp.hot, hotShare = hot === 0.5 ? 0.5 : 1 - hot;
      const drives = POLS.map((w) => S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: 0.15, wear: w, wearDelta: inp.delta }));
      const L = drives[0].logical, ops = S.SSD.workload('hotcold', inp.writes, { logical: L, seed: inp.seed, fill: true, hot, hotShare });
      const nCk = 6, cks = []; for (let k = 1; k <= nCk; k++) cks.push(L + R((k * inp.writes) / nCk));
      const snaps = POLS.map(() => []);
      drives.forEach((D, j) => { let c = 0; ops.forEach((o, i) => { S.SSD.write(D, o.lpn); if (i + 1 === cks[c]) { snaps[j].push({ i: i + 1, erases: D.blocks.map((b) => b.erases), stats: S.SSD.stats(D) }); c++; } }); });
      const maxE = Math.max(1, ...snaps.flat().map((s) => Math.max(...s.erases)));
      const W = 560, X0 = 150, bw = Math.max(4, Math.floor(W / inp.blocks) - 3), ph = 110, gapY = 44;
      const chartOf = (j, s, act) => {
        const y0 = 30 + j * (ph + gapY), its = [t.text('sw:n' + j, X0 - 14, y0 + 16, PNAME[POLS[j]], 'strong' + (act ? ' act-t' : ''), 14, 'end')];
        its.push({ key: 'sw:base' + j, kind: 'line', x1: X0, y1: y0 + ph, x2: X0 + inp.blocks * (bw + 3), y2: y0 + ph, cls: 'faint', audit: 'ignore' });
        s.erases.forEach((e, b) => { const h = Math.max(1, (e / maxE) * ph); its.push({ key: 'sw:b' + j + '.' + b, kind: 'cell', x: X0 + b * (bw + 3), y: t.r1(y0 + ph - h), w: bw, h: t.r1(h), rx: 1, text: '', cls: 'bar12' + (e === s.stats.maxErase ? ' worst' : e === s.stats.minErase ? ' best' : ''), audit: 'overlap-ok' }); });
        its.push(t.text('sw:mx' + j, X0 - 14, y0 + 40, `erases ${s.stats.minErase} to ${s.stats.maxErase}`, 'calc', 13, 'end'));
        its.push(t.text('sw:wa' + j, X0 - 14, y0 + 62, `WA ${s.stats.wa}`, 'calc', 13, 'end'));
        if (s.stats.wlCopies) its.push(t.text('sw:wl' + j, X0 - 14, y0 + 84, `${s.stats.wlCopies} moves`, 'calc', 13, 'end'));
        return its;
      };
      const axisNote = [t.text('sw:ax', X0, 30 + 3 * (ph + gapY) - 16, 'one bar a block, its height its erase count (tallest ' + maxE + ')', 'tick', 13)];
      for (let c = 0; c < cks.length; c++) {
        const items = [...axisNote];
        POLS.forEach((p, j) => items.push(...chartOf(j, snaps[j][c], false)));
        const st = snaps.map((s) => s[c].stats);
        F.set('writes', cks[c]);
        const say = c === cks.length - 1
          ? `After ${cks[c] - L} writes the spread of erase counts is ${st[0].maxErase - st[0].minErase} with no levelling, ${st[1].maxErase - st[1].minErase} with dynamic and ${st[2].maxErase - st[2].minErase} with static levelling. The worst block has been erased ${st[0].maxErase}, ${st[1].maxErase} and ${st[2].maxErase} times; static levelling paid ${t.plural(st[2].wlCopies, 'extra page move')} for it (write amplification ${st[2].wa} against ${st[1].wa}).`
          : `After ${cks[c] - L} writes: erase counts from ${st[0].minErase} to ${st[0].maxErase} with no levelling, ${st[1].minErase} to ${st[1].maxErase} dynamic, ${st[2].minErase} to ${st[2].maxErase} static.`;
        F.add({ items, say, meta: { phase: c === cks.length - 1 ? 'end' : 'progress', at: cks[c], after: cks[c] - L, st, spread: st.map((x) => x.maxErase - x.minErase), maxE, L } });
      }
      F.list.unshift({ items: [...axisNote, ...POLS.flatMap((p, j) => chartOf(j, { erases: drives[0].blocks.map(() => 0), stats: { minErase: 0, maxErase: 0, wa: 0, wlCopies: 0 } }, false))], say: `Three identical drives of ${inp.blocks} blocks get the same writes: first all ${L} logical pages, then ${inp.writes} more, ${hot === 0.5 ? 'spread evenly' : `${R(hotShare * 100)}% of them to the hottest ${R(hot * 100)}% of the pages`}. Only the choice of where to write differs.`, meta: { phase: 'start', L, hotPct: R(hot * 100), sharePct: R(hotShare * 100) }, counters: { writes: 0 } });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Wear levelling', text: ['none: free blocks reused in the order they were erased', 'dynamic: take the free block erased the fewest times', 'static: also move cold data off a block whose erases', '  lag the most worn by more than the allowed spread', 'lifetime ends when the most worn block wears out'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which drive will end with the smallest spread of erase counts?', options: ['no levelling', 'dynamic levelling', 'static levelling'], answer: (fr) => { const sp = fr[fr.length - 1].meta.spread, m = Math.min(...sp); return ['no levelling', 'dynamic levelling', 'static levelling'][sp.lastIndexOf(m)]; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why can dynamic levelling alone leave some blocks barely worn?', options: ['blocks holding cold data are never freed, so they never get a turn', 'it ignores erase counts', 'it only works for reads', 'it erases blocks too often'], answer: 0, why: 'Dynamic levelling only chooses among free blocks; cold blocks never become free.' },
      { q: 'Static levelling costs…', options: ['extra writes to move cold data', 'nothing at all', 'slower reads', 'a larger mapping table only'], answer: 0, why: 'Moving cold pages is extra flash writing, so write amplification rises a little.' },
      { q: 'A drive’s life is limited by…', options: ['its most worn block', 'its least worn block', 'the average read count', 'the size of the mapping table'], answer: 0, why: 'Once blocks start failing the spare pool shrinks; levelling delays the first failure.' },
      { q: 'With writes spread evenly over all pages, levelling matters…', options: ['less: every block is worn at about the same rate anyway', 'more', 'only for reads', 'not at all for SSDs'], answer: 0, why: 'Without a hot spot, wear is already roughly even.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
