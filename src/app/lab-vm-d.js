// The Virtual memory lab, part four: several processes sharing the frames. Each process's references (generated with
// the seed, or typed), taken in turns; replacement global (a fault may take any process's frame) or local (each
// process within its own quota, equal or in proportion to its pages). Then the fault totals both ways, and the CPU
// utilisation against the number of processes for this many frames and working sets this size: it climbs, peaks,
// and collapses into thrashing.
//   VL.procRefs(v, seed) -> [{name, refs: [page..], pages}]   VL.multi(v, ctx) -> {frames, trace, tables, metrics}
(function (S) {
  'use strict';
  const VL = S.VMLab, D = VL.D;
  const V = () => S.VM, C = () => S.Kit.curve;
  const pc = (k) => 'p' + (k % 6);

  VL.procRefs = function (v, seed) {
    return v.procs.map((p, k) => {
      const refs = p.kind === 'typed' ? String(p.refs).trim().split(/[\s,]+/).filter(Boolean).map(Number) : V().refgen({ kind: p.kind, length: p.length, pages: p.pages, seed: seed * 7919 + k * 101, loop: p.pages, setSize: Math.max(2, Math.ceil(p.pages / 2)) });
      return { name: p.name, refs, pages: [...new Set(refs)].length };
    });
  };
  VL.quota = (v, P) => V().allocFrames({ frames: v.mframes, procs: P.map((p) => ({ name: p.name, size: p.pages })), scheme: v.scheme, min: 1 }).alloc.map((a) => a.frames);
  const run = (v, P, mode, quota) => V().globalLocal({ procs: P.map((p) => ({ name: p.name, refs: p.refs })), frames: v.mframes, mode, quota, policy: v.mpolicy, quantum: v.quantum });

  VL.multi = function (v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 380 : 1000, P = VL.procRefs(v, ctx.seed), F = v.mframes;
    const quota = VL.quota(v, P), G = run(v, P, 'global', quota), L = run(v, P, 'local', quota), R = v.mode2 === 'local' ? L : G;
    const pos = P.map(() => 0), faults = P.map(() => 0), marks = P.map(() => []), frames = [];
    const cw = narrow ? 20 : 24, maxCols = Math.floor((W - (narrow ? 70 : 230)) / cw);
    R.steps.forEach((st, s) => {
      const k = st.proc, j = pos[k]++;
      if (!st.hit) faults[k]++;
      marks[k][j] = st.hit ? 'hit' : 'in';
      const items = [];
      items.push(D.text('hd', 0, 14, 'step ' + (s + 1) + ' of ' + R.steps.length + ': ' + P[k].name + ' references page ' + st.page, 'strong', narrow ? 13 : 14));
      if (!narrow) items.push(D.text('md', W, 14, R.mode + ' replacement, ' + (v.mpolicy === 'lru' ? 'LRU' : 'FIFO') + ', ' + v.quantum + ' reference' + (v.quantum === 1 ? '' : 's') + ' a turn', 'tick', 13, 'end'));
      // each process: its references, done ones marked hit or fault, the current one lit
      let y = 40;
      P.forEach((p, q) => {
        const done = pos[q], w0 = Math.max(0, Math.min(p.refs.length - maxCols, done - maxCols + 3)), w1 = Math.min(p.refs.length, w0 + maxCols);
        const lx = narrow ? 0 : 0, rx = narrow ? 64 : 220;
        items.push(D.cell('pn' + q, lx, y, narrow ? 56 : 60, 26, p.name, 'p10-run ' + pc(q) + (q === k ? ' act' : ''), 13));
        if (!narrow) items.push(D.text('pf' + q, 72, y + 18, faults[q] + ' faults · ' + st.held[q] + (R.mode === 'local' ? ' / ' + quota[q] : '') + ' frames', 'tick', 12));
        for (let x = w0; x < w1; x++) {
          const m = x < done ? marks[q][x] : null;
          items.push(D.cell('pr' + q + '_' + x, rx + (x - w0) * cw, y, cw, 26, p.refs[x], 'mb-slot' + (m ? ' ' + m : ' empty') + (q === k && x === done - 1 ? ' act' : ''), 12, { rx: 0 }));
        }
        y += 34;
      });
      // the frames, coloured by owner
      y += 14;
      items.push(D.text('ft', 0, y, 'physical frames: ' + F, 'title'));
      const fw = narrow ? 44 : 56, per = Math.max(1, Math.floor((W + 6) / (fw + 6)));
      st.frames.forEach((f, i) => {
        const x = (i % per) * (fw + 6), yy = y + 12 + Math.floor(i / per) * 50;
        const cls = f.proc < 0 ? 'p10-run free' : 'p10-run ' + pc(f.proc) + (i === st.frame && !st.hit ? (st.victim && st.victim.proc !== k ? ' hot' : ' act') : i === st.frame ? ' act' : '');
        items.push(D.cell('fr' + i, x, yy, fw, 42, '', cls, 12, { lines: f.proc < 0 ? ['free', 'f' + i] : [P[f.proc].name + ' ' + f.page, 'f' + i] }));
      });
      y += 12 + Math.ceil(F / per) * 50 + 16;
      // frames held by each process
      items.push(D.text('ht', 0, y, 'frames held' + (R.mode === 'local' ? ' (quota marked)' : ''), 'title'));
      const bw = narrow ? W - 90 : 520, k1 = bw / F;
      P.forEach((p, q) => {
        const yy = y + 12 + q * 26;
        items.push(D.text('hn' + q, 0, yy + 15, p.name, pc(q), 12));
        items.push(D.cell('hb' + q, 70, yy, Math.max(2, st.held[q] * k1), 18, '', 'p10-run ' + pc(q), 12, { rx: 2 }));
        items.push(D.text('hv' + q, 70 + Math.max(2, st.held[q] * k1) + 6, yy + 14, String(st.held[q]), 'mono', 12));
        if (R.mode === 'local') items.push({ key: 'hq' + q, kind: 'line', x1: Math.round(70 + quota[q] * k1), y1: yy - 3, x2: Math.round(70 + quota[q] * k1), y2: yy + 21, cls: 'p10-mark' });
      });
      frames.push({ items, say: 'Step ' + (s + 1) + ': ' + st.say, title: P[k].name + ' ' + st.page, at: s, hold: 700,
        tables: [{ title: 'Each process', cols: ['Process', 'Pages', 'Faults', 'Frames held'].concat(R.mode === 'local' ? ['Quota'] : []), rows: P.map((p, q) => [p.name, String(p.pages), String(faults[q]), String(st.held[q])].concat(R.mode === 'local' ? [String(quota[q])] : [])), hl: k }] });
    });
    const fv = VL.fit(frames, 10);
    frames.forEach((f) => { f.view = fv; });
    const cmp = compareFrame(v, P, G, L, quota, narrow), cpu = cpuFrame(v, P, narrow);
    frames.push(cmp, cpu.frame);
    const trace = R.steps.map((s) => ({ kind: 'ref', say: s.say, proc: P[s.proc].name, page: s.page, hit: s.hit })).concat([{ kind: 'compare', say: cmp.say }, { kind: 'cpu', say: cpu.frame.say }]);
    cmp.at = trace.length - 2; cpu.frame.at = trace.length - 1;
    const metrics = [{ label: 'Faults, global', value: G.faults.reduce((a, b) => a + b, 0), cls: v.mode2 === 'global' ? 'act' : '' }, { label: 'Faults, local', value: L.faults.reduce((a, b) => a + b, 0), cls: v.mode2 === 'local' ? 'act' : '' }, { label: 'Working set (mean)', value: cpu.wss, unit: 'pages' }, { label: 'Best number of processes', value: cpu.th.best, note: cpu.th.say }];
    const tables = [{ title: 'Faults, global against local', cols: ['Process', 'Pages', 'Global', 'Local', 'Quota'], rows: P.map((p, q) => [p.name, String(p.pages), String(G.faults[q]), String(L.faults[q]), String(quota[q])]) }, { title: 'CPU utilisation', cols: ['Processes', 'Frames each', 'CPU', 'Disk'], rows: cpu.th.points.map((pt) => [String(pt.n), String(Math.floor(pt.framesEach)), Math.round(pt.cpu * 100) + '%', Math.round(pt.disk * 100) + '%']), hl: cpu.th.best - 1 }];
    cmp.tables = tables; cpu.frame.tables = tables;
    return { frames, trace, tables, metrics, G, L, P, quota, th: cpu.th };
  };

  VL.fit = function (frames, pad) {
    let box = null;
    for (const f of frames) { const b = S.stageBounds(f.items, { margin: 0, minW: 1, minH: 1 }); if (b) box = box ? S.geom.union([box, b]) : b; }
    return box ? { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), w: Math.ceil(box.w + 2 * pad), h: Math.ceil(box.h + 2 * pad) } : { x: 0, y: 0, w: 380, h: 300 };
  };

  function compareFrame(v, P, G, L, quota, narrow) {
    const W = narrow ? 380 : 1000, items = [], mx = Math.max(1, ...G.faults, ...L.faults), bx = narrow ? 130 : 170, bw = (narrow ? W - bx - 60 : 560) / mx;
    items.push(D.text('cg:t', 0, 14, 'faults, global against local replacement (' + v.mframes + ' frames)', 'title'));
    P.forEach((p, q) => {
      const y = 40 + q * 70;
      items.push(D.text('cg:n' + q, 0, y + 24, p.name, pc(q), 14));
      items.push(D.text('cg:pg' + q, 0, y + 42, p.pages + ' pages', 'tick', 12));
      [['global', G.faults[q], 'soft'], ['local', L.faults[q], 'act']].forEach(([nm, val, cls], j) => {
        const yy = y + j * 28;
        items.push(D.text('cg:m' + q + nm, bx - 8, yy + 17, nm, 'tick', 12, 'end'));
        items.push(D.cell('cg:b' + q + nm, bx, yy + 2, Math.max(2, val * bw), 20, '', 'p11-bar ' + cls, 12, { rx: 2 }));
        items.push(D.text('cg:v' + q + nm, bx + Math.max(2, val * bw) + 6, yy + 17, val + (nm === 'local' ? ' (quota ' + quota[q] + ')' : ''), 'mono', 12));
      });
    });
    const tg = G.faults.reduce((a, b) => a + b, 0), tl = L.faults.reduce((a, b) => a + b, 0);
    const worst = P.map((p, q) => L.faults[q] - G.faults[q]);
    const say = 'In all, global replacement faults ' + tg + ' times and local ' + tl + '. ' + (tg < tl ? 'Global lets a process with a larger working set take frames from the others, ' : tg > tl ? 'Local keeps each process inside its quota, so one process cannot take the others’ frames, ' : 'The two come out even here, ') + 'and per process: ' + P.map((p, q) => p.name + ' ' + G.faults[q] + ' against ' + L.faults[q]).join(', ') + '.' + (worst.some((d) => d < 0) && worst.some((d) => d > 0) ? ' Some processes do better each way: under global replacement a process’s faults depend on its neighbours too.' : '');
    const f = { items, say, title: 'global against local', hold: 2200 };
    f.view = VL.fit([f], 10);
    return f;
  }

  function cpuFrame(v, P, narrow) {
    const W = narrow ? 380 : 1000, items = [];
    const wsAvg = P.map((p) => V().workingSet(p.refs, v.delta).avg), wss = +(wsAvg.reduce((a, b) => a + b, 0) / P.length).toFixed(2);
    const th = V().thrashing({ frames: v.mframes, wss: Math.max(1, wss), lifetime: v.lifetime, k: 2, disk: v.diskMs2, maxN: v.maxN });
    items.push(D.text('cu:t', 0, 14, 'CPU utilisation against the number of processes', 'title'));
    items.push(D.text('cu:s', 0, 36, v.mframes + ' frames; each process needs about ' + wss + ' (its mean working set, Δ = ' + v.delta + '); ' + v.lifetime + ' ms of work between faults, ' + v.diskMs2 + ' ms a fault', 'tick', narrow ? 12 : 13));
    const px = narrow ? 36 : 60, pw = narrow ? W - 50 : W - 90;
    const ax = C().axes({ prefix: 'cu', x: px, y: 70, w: pw, h: narrow ? 200 : 300, xr: [1, v.maxN], yr: [0, 1.05], xticks: C().ticks(1, v.maxN, narrow ? 5 : 10).filter((x) => Number.isInteger(x) && x >= 1), yticks: [0, 0.25, 0.5, 0.75, 1], fmtY: (u) => Math.round(u * 100) + '%', xname: 'processes', yname: 'utilisation', tickSize: 12 });
    items.push(...ax.items);
    items.push(C().line(ax, 'cu:disk', th.points.map((p) => [p.n, p.disk]), 'p11-disk'));
    items.push(C().line(ax, 'cu:cpu', th.points.map((p) => [p.n, p.cpu]), 'p11-cpu'));
    const best = th.points[th.best - 1];
    items.push(Object.assign(C().dot(ax, 'cu:best', best.n, best.cpu, 'good', 6), { layer: 'top' }));
    items.push(C().vline(ax, 'cu:you', Math.min(v.maxN, P.length), ''));
    items.push(D.text('cu:bl', ax.X(best.n), ax.Y(best.cpu) - 12, 'peak ' + Math.round(best.cpu * 100) + '% at ' + best.n, 'strong good', 13, best.n > v.maxN * 0.7 ? 'end' : 'middle'));
    const ly = 70 + (narrow ? 200 : 300) + 50;
    items.push(...C().legend('cu:lg', px, ly, [{ text: 'CPU', cls: 'p11-cpu' }, { text: 'paging disk', cls: 'p11-disk' }, { text: 'your ' + P.length + ' processes', cls: 'faint' }], { dir: narrow ? 'col' : 'row', size: 13 }));
    const mine = th.points[Math.min(v.maxN, P.length) - 1];
    const say = th.say + ' Your ' + P.length + ' processes' + (mine ? ' sit at ' + Math.round(mine.cpu * 100) + '% CPU, ' + Math.floor(mine.framesEach) + ' frames each' : '') + '.';
    const f = { items, say, title: 'CPU utilisation', hold: 2200 };
    f.view = VL.fit([f], 10);
    return { frame: f, th, wss };
  }
})(globalThis.Proses = globalThis.Proses || {});
