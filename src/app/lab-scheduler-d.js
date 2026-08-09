// The Scheduler lab, part four: three closer looks. The quantum sweep (one quantum policy at q = 1, 2, .., the means
// plotted against q, a frame per quantum with its own Gantt chart); the CFS-style scheduler tick by tick with its
// red-black tree of vruntimes; and the lottery, draw by draw: the ticket ranges, the number drawn and its owner, and
// the CPU each job has had against its share of the tickets (stride beside it, for the same tickets).
//   SL.gantt(o) -> items     SL.sweep(v, ctx)     SL.cfsRun(v, ctx)     SL.lotteryRun(v, ctx)
(function (S) {
  'use strict';
  const SL = S.SchedLab;
  const G = () => S.Kit.gantt, C = () => S.Kit.curve, TK = () => S.Kit.tree;
  const T = (...a) => SL.T(...a), f2 = (x) => SL.f2(x), tw = (...a) => SL.tw(...a);

  /** a Gantt chart cut at t: o {pre, tr, jobs, X, t, y, h, gap, names: [row labels], of(seg), x0, x1, final, cursor} */
  SL.gantt = function (o) {
    const items = [], h = o.h || 30, gap = o.gap || 4, names = o.names || ['CPU'], of = o.of || (() => 0), ry = (k) => o.y + k * (h + gap);
    names.forEach((nm, k) => {
      items.push(T(o.pre + 'rl' + k, o.x0 - 8, ry(k) + h / 2 + 5, nm, 'glname slrow', 13, 'end'));
      items.push(...G().track({ prefix: o.pre + 't' + k, x: o.x0, y: ry(k), w: o.x1 - o.x0, h }));
    });
    const upTo = o.final ? Infinity : o.t;
    for (const it of G().bar({ prefix: o.pre + 'g', X: o.X, segs: o.tr.segs.filter((s) => !s.cs && !s.warm), y: o.y, h, upTo, jobs: o.jobs, now: o.final ? undefined : o.t, size: 14, row: (s) => ry(of(s)) })) {
      if (it.text && tw(it.text, 14, true) + 6 > it.w) it.text = '';
      items.push(it);
    }
    o.tr.segs.forEach((s, i) => {
      if (!(s.cs || s.warm) || s.start >= upTo) return;
      const x = o.X(s.start);
      items.push({ key: o.pre + 'cs' + i, kind: 'cell', x, y: ry(of(s)), w: Math.max(1, o.X(Math.min(s.end, upTo)) - x), h, text: '', cls: s.cs ? 'p05cs' : 'p05warm', audit: 'overlap-ok' });
    });
    if (!o.final && o.cursor !== false) items.push(...G().cursor({ prefix: o.pre + 'c', X: o.X, t: o.t, y1: o.y - 4, y2: ry(names.length - 1) + h + 4 }));
    return items;
  };

  // ---- the quantum sweep ------------------------------------------------------------------------------------------
  SL.sweep = function (v, ctx) {
    const narrow = ctx.narrow, pol = v.sweepPol, qs = [];
    for (let q = 1; q <= v.qmax; q++) qs.push(q);
    const runs = qs.map((q) => {
      const tr = pol === 'mlfq' ? S.Sched.mlfq(SL.jobs(v.work), Object.assign(SL.mlfqParams(v, false), { quantum: [q] })) : SL.runOne({ pol, q }, v, ctx.seed, { q });
      const switches = tr.segs.filter((s, i) => i > 0 && !s.cs && !s.warm).length;
      return { q, tr, m: tr.metrics, switches };
    });
    const KEYS = [['turnaround', 'c0'], ['waiting', 'c1'], ['response', 'c2']];
    const ymax = Math.max(1, ...runs.flatMap((r) => KEYS.map(([k]) => r.m.avg[k])));
    const best = Object.fromEntries(KEYS.map(([k]) => [k, runs.reduce((b, r) => (r.m.avg[k] < b.m.avg[k] - 1e-9 ? r : b), runs[0])]));
    const W = narrow ? 380 : 980, End = Math.max(...runs.map((r) => r.tr.end));
    const plot = narrow ? { x: 44, y: 40, w: 320, h: 200 } : { x: 50, y: 44, w: 470, h: 250 };
    const tx = narrow ? 0 : 570, ty = narrow ? plot.y + plot.h + 134 : 30;
    const cols = narrow ? [{ w: 50, label: 'q' }, { w: 80, label: 'turn.' }, { w: 76, label: 'wait' }, { w: 76, label: 'resp.' }, { w: 92, label: 'switches' }] : [{ w: 50, label: 'q' }, { w: 92, label: 'turnaround' }, { w: 80, label: 'waiting' }, { w: 84, label: 'response' }, { w: 94, label: 'switches' }];
    const rowH = v.qmax > 10 ? 22 : 26;
    const gy = Math.max(ty + (v.qmax + 1) * rowH + 54, narrow ? 0 : plot.y + plot.h + 104);
    const pname = { rr: 'Round robin', lottery: 'Lottery', stride: 'Stride', multi: v.cores + ' cores, shared queue', multip: v.cores + ' cores, per-core queues', mlfq: 'MLFQ, Q0 quantum q' }[pol];
    const frames = [];
    runs.forEach((r, i) => {
      const items = [], final = i === runs.length - 1;
      const ax = C().axes({ prefix: 'pl', x: plot.x, y: plot.y, w: plot.w, h: plot.h, xr: [1, v.qmax], yr: [0, Math.ceil(ymax * 1.1)], xticks: v.qmax > 10 ? 2 : 1, yticks: Math.max(1, Math.ceil(ymax / 5)), xname: 'quantum q (ticks)', yname: 'mean, in ticks', tickSize: 12 });
      items.push(...ax.items);
      for (const [k, cls] of KEYS) {
        const pts = runs.slice(0, i + 1).map((x) => [x.q, x.m.avg[k]]);
        if (pts.length > 1) items.push(C().line(ax, 'ln' + k, pts, cls));
        pts.forEach(([q, y]) => items.push(C().dot(ax, 'd' + k + q, q, y, cls + (q === r.q ? ' act' : ''), q === r.q ? 5.5 : 4)));
      }
      items.push(C().vline(ax, 'vq', r.q, 'act'));
      items.push(...C().legend('lg', narrow ? 0 : plot.x, plot.y + plot.h + 50, KEYS.map(([k, cls]) => ({ text: 'mean ' + k, cls })), { size: 13, dir: narrow ? 'col' : 'row' }));
      // the table of every quantum so far
      const rows = runs.map((x, j) => ({ key: 'q' + x.q, cells: j > i ? [String(x.q), '', '', '', ''] : [String(x.q)].concat(KEYS.map(([k]) => ({ text: f2(x.m.avg[k]), cls: final && best[k].q === x.q ? 'best' : '' })), [String(x.switches)]), cls: x.q === r.q ? 'fresh' : '' }));
      items.push(T('tbT', tx, ty - 8, pname + (v.cs ? ', a switch costs ' + v.cs : ''), 'glabel', 13));
      items.push(...G().table({ prefix: 'tb', x: tx, y: ty, cols, rows, rowH, size: 13 }).items);
      // this quantum's own chart
      const x0 = narrow ? 58 : 110, x1 = W - 8, tm = G().time({ x0, x1, t1: End }), rowsOf = SL.rowsOf(r.tr, v);
      items.push(T('gT', 0, gy - 26, 'q = ' + r.q + ': every job done at t = ' + r.tr.end, 'gpol slpol', 15));
      items.push(...G().axis({ prefix: 'gax', X: tm.X, t1: End, y: gy - 8, step: SL.tickStep(tm.per, 26), size: 12 }));
      items.push(...SL.gantt({ pre: 'gc', tr: r.tr, jobs: r.tr.jobs.map((j) => j.id), X: tm.X, t: r.tr.end, y: gy + 14, names: rowsOf.names, of: rowsOf.of, x0, x1, final: true, h: 28 }));
      const say = final
        ? 'Every quantum from `1` to `' + v.qmax + '` is done. The lowest mean turnaround, `' + f2(best.turnaround.m.avg.turnaround) + '`, comes at q = `' + best.turnaround.q + '`; the lowest mean response, `' + f2(best.response.m.avg.response) + '`, at q = `' + best.response.q + '`' + (v.cs ? '; small quanta pay for many switches at `' + v.cs + '` ' + (v.cs === 1 ? 'tick' : 'ticks') + ' each' : '') + '.'
        : 'With a quantum of `' + r.q + '`, the means are turnaround `' + f2(r.m.avg.turnaround) + '`, waiting `' + f2(r.m.avg.waiting) + '` and response `' + f2(r.m.avg.response) + '`, with `' + r.switches + '` switches' + (r.m.overhead ? ' costing `' + r.m.overhead + '` ticks' : '') + '.';
      frames.push({ items, say, at: i, title: 'q = ' + r.q, hold: 1300,
        tables: [{ title: pname + ': means against the quantum', cols: ['q', 'Turnaround', 'Waiting', 'Response', 'Switches', 'Switch ticks', 'Ends at'], rows: runs.slice(0, i + 1).map((x) => [String(x.q), f2(x.m.avg.turnaround), f2(x.m.avg.waiting), f2(x.m.avg.response), String(x.switches), String(x.m.overhead), String(x.tr.end)]), hl: i }].concat(SL.jobTables([{ tr: r.tr, name: 'q = ' + r.q + ': each job' }], r.tr.end, true)),
        metrics: KEYS.map(([k]) => ({ label: 'Best mean ' + k, value: final ? f2(best[k].m.avg[k]) : '–', note: final ? 'at q = ' + best[k].q : '', unit: 'ticks', cls: final ? 'good' : '' })).concat([{ label: 'This quantum', value: String(r.q), cls: 'act' }, { label: 'Switches at q = ' + r.q, value: String(r.switches) }]) });
    });
    const trace = runs.map((r) => ({ kind: 'quantum', q: r.q, say: 'q = ' + r.q + ': turnaround ' + r.m.sumText.turnaround + ', mean ' + f2(r.m.avg.turnaround) + '; waiting mean ' + f2(r.m.avg.waiting) + '; response mean ' + f2(r.m.avg.response) }));
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics };
  };

  // ---- CFS and its tree -------------------------------------------------------------------------------------------
  function kitTree(n, lm, jobs) {
    if (!n) return null;
    const node = { id: n.id, lines: [n.id, 'vr ' + n.v], cls: 'p05rb' + (Math.max(0, jobs.indexOf(n.id)) % 6) + ' ' + (n.red ? 'p05red' : 'p05black') + (n.id === lm ? ' act' : ''), kids: [] };
    const l = kitTree(n.l, lm, jobs), r = kitTree(n.r, lm, jobs);
    if (l || r) node.kids = [l || { id: n.id + '_nl', lines: ['nil'], cls: 'p05nil', kids: [] }, r || { id: n.id + '_nr', lines: ['nil'], cls: 'p05nil', kids: [] }];
    return node;
  }
  const depth = (n) => (n ? 1 + Math.max(depth(n.l), depth(n.r)) : 0);
  const leftmost = (n) => { while (n && n.l) n = n.l; return n ? n.id : null; };

  SL.cfsRun = function (v, ctx) {
    const narrow = ctx.narrow, tr = SL.runOne({ pol: 'cfs' }, v, ctx.seed), jobs = tr.jobs.map((j) => j.id), End = tr.end;
    const W = narrow ? 380 : 980, x0 = narrow ? 70 : 110, x1 = W - 8, tm = G().time({ x0, x1, t1: End });
    const maxD = Math.max(1, ...tr.steps.map((s) => depth(s.tree)));
    const levelH = 70, bw = narrow ? 62 : 80, bh = 42;
    const panelY = 110, treeX = narrow ? 0 : 400, treeY = narrow ? panelY + 140 + (jobs.length + 1) * 28 + 60 : panelY + 30, treeW = W - treeX;
    const frames = [];
    for (let t = 0; t <= End; t++) {
      const st = tr.steps[t], end = st.kind === 'end', items = [T('now', 0, 4, end ? 'end, t = ' + t : 't = ' + t, 'gnow', 15)];
      items.push(...G().axis({ prefix: 'ax', X: tm.X, t1: End, y: 24, step: SL.tickStep(tm.per, 26), size: 13 }));
      items.push(...SL.gantt({ pre: 'g', tr, jobs, X: tm.X, t, y: 52, x0, x1, final: end }));
      // the CPU and its slice
      items.push({ key: 'cpu', kind: 'cell', x: 0, y: panelY, w: 360, h: 96, text: '', cls: 'gcpu', audit: 'group', layer: 'back' });
      items.push(T('cpuL', 12, panelY + 22, 'CPU', 'glname', 15));
      if (st.run) {
        const b = G().job('j:' + st.run, 14, panelY + 34, st.run, jobs, { w: 92, h: 46, cls: 'run' + (st.cs ? ' p05sw' : '') });
        b.lines = [st.run, 'vr ' + st.vr[st.run]]; b.size = 14;
        items.push(b);
        const sw = 200, frac = Math.min(1, st.ran / Math.max(1e-9, st.slice));
        items.push(T('slL', 126, panelY + 44, 'slice ' + st.slice + ', ' + st.ran + ' used', 'glabel', 13));
        items.push({ key: 'slT', kind: 'cell', x: 126, y: panelY + 54, w: sw, h: 16, text: '', cls: 'p05qoff' });
        if (frac > 0) items.push({ key: 'slF', kind: 'cell', x: 126, y: panelY + 54, w: Math.max(2, Math.round(sw * frac)), h: 16, text: '', cls: 'p05qon' });
      } else items.push(T('cpuI', 180, panelY + 58, end ? 'every job is done' : 'idle', 'glabel', 14, 'middle'));
      // each job's weight and vruntime
      const io = new Set((st.io || []).map((e) => e.id));
      const rows = tr.jobs.map((j) => ({ key: j.id, cells: [{ text: j.id, cls: SL.pcls(jobs, j.id) }, String(j.nice), String(S.Sched.weight(j.nice)), st.vr && st.vr[j.id] !== undefined ? String(st.vr[j.id]) : '—', t < j.arrive ? 'not yet' : st.run === j.id ? 'running' : io.has(j.id) ? 'I/O' : st.vr && st.vr[j.id] !== undefined ? 'in tree' : 'done'], cls: j.id === st.run ? 'fresh' : '' }));
      items.push(...G().table({ prefix: 'vt', x: 0, y: panelY + 116, cols: [{ w: 54, label: 'job' }, { w: 54, label: 'nice' }, { w: 76, label: 'weight' }, { w: 92, label: 'vruntime' }, { w: 84, label: 'now' }], rows, rowH: 28, size: 13 }).items);
      items.push(T('minv', 0, panelY + 116 + 28 * (jobs.length + 1) + 24, 'min_vruntime ' + (st.minV === undefined ? '—' : st.minV) + (narrow ? '' : ' · a tick adds 1024 / weight'), 'p05val', 13));
      // the tree
      items.push(T('trT', treeX, treeY - 8, end ? 'the tree is empty' : narrow ? 'ready jobs by vruntime' : 'the ready jobs, a red-black tree by vruntime: the leftmost runs next', 'glabel', 13));
      const root = kitTree(st.tree, leftmost(st.tree), jobs);
      if (root) {
        TK().layout(root, { x: 0, y: 0, levelH: Math.min(levelH, 260 / maxD), boxW: bw, boxH: bh, gapX: narrow ? 10 : 30 });
        const bd = TK().bounds(root, bw, bh), dx = treeX + (treeW - bd.w) / 2 - bd.x, dy = treeY + 16 + bh / 2;
        const shift = (n) => { n.x = Math.round(n.x + dx); n.y = Math.round(n.y + dy); for (const k of n.kids || []) shift(k); };
        shift(root);
        items.push(...TK().draw(root, { prefix: 'rb', boxW: bw, boxH: bh, size: 13 }).map((it) => (it.kind === 'state' && /p05nil/.test(it.cls) ? Object.assign(it, { w: 36, h: 22 }) : it)));
      }
      frames.push({ items, say: end ? 'Every job has finished at t = `' + End + '`. While all competed, the CPU per unit of weight had a fairness index of `' + f2(tr.fairness.jain) + '` (1 is perfectly fair).' : st.say, at: t, title: end ? 'end' : 't = ' + t, hold: 1000,
        tables: SL.jobTables([{ tr, name: 'CFS: each job' }], t, end).concat([{ title: 'Weights and vruntimes', cols: ['Job', 'Nice', 'Weight', 'Per tick', 'vruntime'], rows: tr.jobs.map((j) => [j.id, String(j.nice), String(S.Sched.weight(j.nice)), f2(1024 / S.Sched.weight(j.nice)), st.vr && st.vr[j.id] !== undefined ? String(st.vr[j.id]) : '—']), hl: tr.jobs.findIndex((j) => j.id === st.run) }]),
        metrics: [{ label: 'min_vruntime', value: String(st.minV === undefined ? '—' : st.minV) }, { label: 'Slice of the running job', value: st.run ? String(st.slice) : '–', unit: 'ticks' }, { label: 'Mean turnaround', value: end ? f2(tr.metrics.avg.turnaround) : '–', unit: 'ticks' }, { label: 'Mean response', value: end ? f2(tr.metrics.avg.response) : '–', unit: 'ticks' }, { label: 'Fairness (Jain)', value: end ? f2(tr.fairness.jain) : '–', cls: end ? 'good' : '' }] });
    }
    const trace = tr.events.map((e) => ({ kind: e.kind, t: e.t, job: e.job, say: 'at t = ' + e.t + ', ' + SL.clean(e.say) }));
    frames.forEach((f) => { const k = trace.findIndex((e) => e.t >= f.at); f.at = k < 0 ? trace.length - 1 : k; });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics, tr };
  };

  // ---- the lottery, draw by draw ---------------------------------------------------------------------------------
  SL.lotteryRun = function (v, ctx) {
    const narrow = ctx.narrow, tr = SL.runOne({ pol: 'lottery', q: v.lq }, v, ctx.seed), jobs = tr.jobs.map((j) => j.id);
    const st2 = v.withStride ? SL.runOne({ pol: 'stride', q: v.lq }, v, ctx.seed) : null;
    const End = Math.max(tr.end, st2 ? st2.end : 0), W = narrow ? 380 : 980, x0 = narrow ? 70 : 110, x1 = W - 8, tm = G().time({ x0, x1, t1: End });
    const names = st2 ? ['lottery', 'stride'] : ['lottery'];
    const tickets = Object.fromEntries(tr.jobs.map((j) => [j.id, j.tickets])), totalT = tr.jobs.reduce((a, j) => a + j.tickets, 0);
    const draws = tr.draws, lineY = 52 + names.length * 34 + 70, barY = lineY + 120;
    const frames = [];
    const moments = draws.map((d) => d.t).concat([End]);
    moments.forEach((t, i) => {
      const d = draws[i], end = !d, items = [T('now', 0, 4, end ? 'end, t = ' + t : 't = ' + t, 'gnow', 15)];
      items.push(...G().axis({ prefix: 'ax', X: tm.X, t1: End, y: 24, step: SL.tickStep(tm.per, 26), size: 13 }));
      const sTr = { segs: tr.segs.map((s) => Object.assign({}, s, { r: 0 })).concat(st2 ? st2.segs.map((s) => Object.assign({}, s, { r: 1 })) : []) };
      items.push(...SL.gantt({ pre: 'g', tr: sTr, jobs, X: tm.X, t, y: 52, x0, x1, final: end, names, of: (s) => s.r }));
      // the ticket line
      if (d && !d.skipped) {
        const lx0 = narrow ? 8 : 90, lx1 = W - 30, per = (lx1 - lx0) / d.total;
        items.push(T('tlT', lx0, lineY - 34, narrow ? 'tickets of the ready jobs' : 'draw ' + (i + 1) + ' of ' + draws.length + ': the ready jobs hold ' + d.total + ' tickets, and number ' + d.number + ' is drawn', 'glabel', 13));
        d.holders.forEach((h) => {
          const x = lx0 + h.lo * per, w = (h.hi - h.lo + 1) * per;
          items.push({ key: 'tk' + h.id, kind: 'cell', x: Math.round(x * 10) / 10, y: lineY, w: Math.round(w * 10) / 10, h: 34, text: w > tw(h.id + ' ' + h.lo + '–' + h.hi, 13, true) + 10 ? h.id + ' ' + h.lo + '–' + h.hi : w > 20 ? h.id : '', size: 13, cls: 'gseg ' + SL.pcls(jobs, h.id) + (h.id === d.winner ? ' now' : '') });
        });
        items.push({ key: 'pick', kind: 'head', x: Math.round((lx0 + (d.number + 0.5) * per) * 10) / 10, y: lineY + 34, text: String(d.number), side: 'below', cls: 'act' });
      } else items.push(T('tlT', narrow ? 8 : 90, lineY - 34, end ? 'every job has finished; ' + draws.length + ' draws were made' : 'no tickets among the ready jobs: the first in name order runs', 'glabel', 13));
      // the CPU each job has had, against its share of the tickets
      const got = S.Sched.share(tr, 0, t), got2 = st2 ? S.Sched.share(st2, 0, t) : null, sum = Object.values(got).reduce((a, b) => a + b, 0) || 1, sum2 = got2 ? Object.values(got2).reduce((a, b) => a + b, 0) || 1 : 1;
      const bx = narrow ? 30 : 90, bwid = narrow ? 160 : 520, bh = 18;
      items.push(T('shT', 0, barY - 12, narrow ? 'CPU so far against tickets' : 'the CPU each job has had so far, against its share of the tickets (the outline)', 'glabel', 13));
      tr.jobs.forEach((j, k) => {
        const y = barY + k * (st2 ? 50 : 30), share = j.tickets / totalT;
        items.push(T('shN' + j.id, bx - 10, y + bh / 2 + 5, j.id, 'glname', 14, 'end'));
        items.push({ key: 'shE' + j.id, kind: 'cell', x: bx, y, w: Math.round(bwid * share), h: bh, text: '', cls: 'gslot' });
        const g = got[j.id] / sum;
        if (g > 0) items.push({ key: 'shG' + j.id, kind: 'cell', x: bx, y: y + 3, w: Math.max(2, Math.round(bwid * g)), h: bh - 6, text: '', cls: 'gseg ' + SL.pcls(jobs, j.id), audit: 'overlap-ok' });
        items.push(T('shV' + j.id, bx + bwid + 12, y + bh / 2 + 5, narrow ? got[j.id] + ' ticks, ' + Math.round(g * 100) + '% (' + Math.round(share * 100) + '%)' : 'lottery ' + got[j.id] + ' ticks = ' + Math.round(g * 100) + '%, tickets ' + Math.round(share * 100) + '%', 'p05val', 13));
        if (st2) {
          const g2 = got2[j.id] / sum2;
          if (g2 > 0) items.push({ key: 'shS' + j.id, kind: 'cell', x: bx, y: y + 24, w: Math.max(2, Math.round(bwid * g2)), h: 12, text: '', cls: 'gseg slstride ' + SL.pcls(jobs, j.id), audit: 'overlap-ok' });
          items.push(T('shW' + j.id, bx + bwid + 12, y + 35, (narrow ? 'stride ' : 'stride ') + got2[j.id] + (narrow ? ', ' : ' ticks = ') + Math.round(g2 * 100) + '%', 'glabel', 13));
        }
      });
      const say = end ? 'All done at t = `' + End + '` after `' + draws.length + '` draws. While all three competed, lottery’s fairness index was `' + f2(tr.fairness.jain) + '`' + (st2 ? ' and stride’s `' + f2(st2.fairness.jain) + '`: stride gives the same shares without the luck' : '') + '.'
        : d.skipped ? 'At t = `' + t + '` no ready job holds tickets, so `' + d.winner + '` runs without a draw.'
          : 'At t = `' + t + '` the ready jobs hold `' + d.total + '` tickets: ' + d.holders.map((h) => h.id + ' ' + h.lo + '–' + h.hi).join(', ') + '. The draw is `' + d.number + '`, so `' + d.winner + '` runs for up to `' + v.lq + '` ' + (v.lq === 1 ? 'tick' : 'ticks') + '.';
      const shareRows = tr.jobs.map((j) => [j.id, String(j.tickets), f2((j.tickets / totalT) * 100) + '%', String(got[j.id]), f2((got[j.id] / sum) * 100) + '%'].concat(st2 ? [String(got2[j.id]), f2((got2[j.id] / sum2) * 100) + '%'] : []));
      frames.push({ items, say, at: i, title: end ? 'end' : 'draw ' + (i + 1), hold: 1100,
        tables: [{ title: 'Shares so far, at t = ' + t, cols: ['Job', 'Tickets', 'Ticket share', 'Lottery CPU', 'Lottery share'].concat(st2 ? ['Stride CPU', 'Stride share'] : []), rows: shareRows }, { title: 'The draws so far', cols: ['t', 'Total', 'Number', 'Winner'], rows: draws.slice(0, i + 1).map((x) => [String(x.t), String(x.total), x.skipped ? '–' : String(x.number), x.winner]), hl: i }].concat(SL.jobTables([{ tr, name: 'Lottery: each job' }], t, end)),
        metrics: [{ label: 'Draws so far', value: String(Math.min(i + 1, draws.length)) }, { label: 'Lottery fairness (Jain)', value: end ? f2(tr.fairness.jain) : '–' }].concat(st2 ? [{ label: 'Stride fairness (Jain)', value: end ? f2(st2.fairness.jain) : '–' }] : []).concat([{ label: 'Seed', value: String(ctx.seed), note: 'another seed, other draws' }]) });
    });
    const last = frames[frames.length - 1];
    return { frames, trace: draws.map((d) => ({ kind: 'draw', t: d.t, say: 'at t = ' + d.t + (d.skipped ? ', no draw: ' + d.winner + ' runs' : ', drew ' + d.number + ' of ' + d.total + ': ' + d.winner + ' wins') })), tables: last.tables, metrics: last.metrics, tr };
  };
})(globalThis.Proses = globalThis.Proses || {});
