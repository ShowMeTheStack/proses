// Part 4, implicit threading: a parallel loop whose iterations a runtime hands to a pool of workers, statically in
// blocks, cyclically, or dynamically in chunks (S.P04.parfor), drawn as a Gantt chart per worker; and concurrency
// against parallelism with Amdahl's law: the serial part of a program bounds the speed-up any number of cores gives.
(function (S) {
  'use strict';
  const H = S.P04, G = () => S.Kit.gantt, CV = () => S.Kit.curve;
  const POL = { static: 'static blocks', cyclic: 'cyclic (round robin)', dynamic: 'dynamic chunks' };
  function checkCosts(v) {
    if (v.length < 4 || v.length > 16) return 'Iteration costs: 4 to 16 iterations';
    if (v.some((x) => !/^\d+$/.test(x) || +x < 1 || +x > 9)) return 'Iteration costs: whole numbers from 1 to 9';
    return null;
  }
  H.topic({
    id: 'thr-parfor', family: 'p04-patterns', order: 30, title: 'A parallel loop: who gets which iterations',
    blurb: 'With implicit threading the programmer marks a loop as parallel and a runtime spreads its iterations over a pool of worker threads. How it splits them matters when iterations cost different amounts: fixed blocks are cheapest to hand out but can leave one worker with all the slow ones; handing out small chunks as workers fall idle balances the load.',
    inputs: [
      { id: 'policy', kind: 'choice', label: 'Split', def: 'static', options: Object.entries(POL).map(([value, label]) => ({ value, label })) },
      { id: 'workers', kind: 'choice', label: 'Workers', def: '3', options: ['2', '3', '4'].map((v) => ({ value: v, label: v })) },
      { id: 'chunk', kind: 'choice', label: 'Chunk (dynamic)', def: '1', options: ['1', '2', '3'].map((v) => ({ value: v, label: v })) },
      { id: 'costs', kind: 'list', label: 'Iteration costs', def: ['1', '1', '2', '2', '3', '3', '4', '5', '6'], check: checkCosts },
    ],
    presets: [
      { label: 'Growing costs, static', values: { policy: 'static', workers: '3', costs: ['1', '1', '2', '2', '3', '3', '4', '5', '6'] } },
      { label: 'Same, cyclic', values: { policy: 'cyclic', workers: '3', costs: ['1', '1', '2', '2', '3', '3', '4', '5', '6'] } },
      { label: 'Same, dynamic', values: { policy: 'dynamic', workers: '3', chunk: '1', costs: ['1', '1', '2', '2', '3', '3', '4', '5', '6'] } },
      { label: 'Equal costs, static', values: { policy: 'static', workers: '4', costs: ['2', '2', '2', '2', '2', '2', '2', '2'] } },
      { label: 'One slow iteration, dynamic by 2', values: { policy: 'dynamic', workers: '2', chunk: '2', costs: ['9', '1', '1', '1', '1', '1', '1', '1'] } },
    ],
    counters: [{ id: 't', label: 'time' }, { id: 'left', label: 'iterations left' }],
    run(inp) {
      const costs = inp.costs.map(Number), W = +inp.workers, n = costs.length;
      const R = H.parfor({ costs, workers: W, policy: inp.policy, chunk: +inp.chunk });
      const all = Object.keys(POL).map((p) => [p, H.parfor({ costs, workers: W, policy: p, chunk: +inp.chunk })]);
      const ideal = Math.max(Math.ceil(R.total / W), Math.max(...costs));
      const F = new S.Frames(['t', 'left']);
      const T = G().time({ x0: 100, x1: 790, t1: Math.max(...all.map(([, r]) => r.end)) });
      function picture(k, final) {
        const items = [], given = new Set(order.slice(0, k).map((x) => x.it)), now = k ? order[k - 1].start : 0;
        items.push(H.title('it', 0, 14, 'iterations and their costs'));
        const cw = Math.min(48, Math.floor(790 / n));
        costs.forEach((c, i) => {
          const seg = R.segs.find((s) => s.it === i);
          items.push({ key: 'i' + i, kind: 'cell', x: i * cw, y: 26, w: cw - 4, h: 36, rx: 5, text: String(c), size: 14, cls: given.has(i) ? 'thstk ' + H.pcls(seg.w) + (order[k - 1] && order[k - 1].it === i ? ' act' : '') : 'varval empty' });
          items.push(H.text('ix' + i, i * cw + (cw - 4) / 2, 78, String(i), 'tick', 12, 'middle'));
        });
        items.push(...G().axis({ prefix: 'ax', X: T.X, t1: T.t1 === undefined ? R.end : Math.max(...all.map(([, r]) => r.end)), y: 110, step: 2, size: 12 }));
        for (let w = 0; w < W; w++) {
          const y = 126 + w * 42;
          items.push(H.text('wl' + w, 0, y + 22, 'worker W' + w, 'strong', 14));
          for (const s of R.segs.filter((x) => x.w === w && given.has(x.it))) {
            const x = T.X(s.start), ww = T.X(s.end) - x;
            items.push({ key: 'g' + s.it, kind: 'cell', x, y, w: ww, h: 32, rx: 3, text: ww >= 20 ? String(s.it) : '', size: 13, cls: 'gseg ' + H.pcls(w) });
          }
          if (final) items.push(H.text('wb' + w, T.X(R.busy[w]) + 6, y + 21, String(R.busy[w]), R.busy[w] === R.end ? 'hot' : 'tick', 13));
        }
        const by = 126 + W * 42 + 10;
        if (k && !final) items.push(...G().cursor({ prefix: 'cu', X: T.X, t: now, y1: 118, y2: by - 6 }));
        if (final) {
          all.forEach(([p, r], j) => items.push({ key: 'cmp' + j, kind: 'cell', x: j * 266, y: by + 10, w: 258, h: 34, rx: 6, text: POL[p] + ': ' + r.end, size: 14, cls: 'varval' + (p === inp.policy ? ' act' : '') }));
          items.push(H.text('id', 0, by + 72, 'no split can beat ' + ideal + ': the work over the workers, or the slowest single iteration', 'tick', 13));
        }
        return items;
      }
      const order = R.segs.slice().sort((a, b) => a.start - b.start || a.w - b.w);
      const owner = {}; for (const e of R.events) for (const i of e.its) owner[i] = e;
      F.set('left', n);
      F.add({ items: picture(0), say: `${H.plural(n, 'iteration')} costing ${R.total} in all, for ${H.plural(W, 'worker')}: a perfect split would end at ${ideal}. The split is ${POL[inp.policy]}${inp.policy === 'dynamic' ? ', ' + H.plural(+inp.chunk, 'iteration') + ' at a time' : ''}.`, meta: { vals: [n, R.total, W, ideal, +inp.chunk] } });
      order.forEach((g, k) => {
        const e = owner[g.it], first = e.its[0] === g.it, left = n - (k + 1);
        const how = inp.policy === 'dynamic' ? (first ? `W${g.w} is idle and takes ${e.its.length > 1 ? 'iterations ' + H.list(e.its) : 'the next iteration'}; ` : '') : first ? `W${g.w} was given iteration${e.its.length > 1 ? 's' : ''} ${H.list(e.its)}; ` : '';
        F.set('t', g.start).set('left', left);
        F.add({ items: picture(k + 1), say: `Time ${g.start}: ${how}W${g.w} starts iteration ${g.it}, costing ${costs[g.it]}, done at ${g.end}.${left ? '' : ' Every iteration has started.'}`, meta: { vals: [g.start, g.w, g.it, costs[g.it], g.end, left, ...e.its] } });
      });
      F.add({ items: picture(order.length, true), say: `The loop ends at ${R.end}, when the busiest worker finishes (the workers were busy for ${H.list(R.busy)}). On the same costs: ${all.map(([p, r]) => POL[p] + ' ends at ' + r.end).join(', ')}; the best possible is ${ideal}.`, meta: { vals: [R.end, ideal, ...R.busy, ...all.map(([, r]) => r.end)], ends: Object.fromEntries(all.map(([p, r]) => [p, r.end])) } });
      return { frames: F.list, def: H.def('Parallel loops', ['#pragma omp parallel for (OpenMP)', '  schedule(static)      blocks', '  schedule(static, 1)   cyclic', '  schedule(dynamic, c)  c at a time', '    to whichever worker is idle', 'also: task queues, fork-join pools,', '  dispatch queues of closures', 'time ≥ work / workers', 'time ≥ the longest iteration']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'When will the loop end with this split?', options: (fr) => [...new Set(Object.values(fr[fr.length - 1].meta.ends).concat([fr[0].meta.vals[3]]))].sort((a, b) => a - b).map(String), answer: (fr) => String(fr[fr.length - 1].meta.vals[0]), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Iteration costs grow along the loop. Static blocks give the last worker…', options: ['the most expensive iterations, so everyone waits for it', 'the cheapest ones', 'nothing', 'a fair share'], answer: 0, why: 'Blocks are equal in count, not in cost.' },
      { q: 'What does dynamic scheduling cost?', options: ['a shared counter or queue that every worker must update for each chunk', 'nothing', 'more threads', 'a slower compiler'], answer: 0, why: 'Handing out work is synchronisation; bigger chunks mean less of it.' },
      { q: 'No split can finish before…', options: ['the total work divided by the workers, and the slowest single iteration', 'the cheapest iteration', 'the number of iterations', 'one time unit'], answer: 0, why: 'Both are hard lower bounds.' },
      { q: 'In implicit threading, who creates and manages the threads?', options: ['the runtime or compiler, not the programmer', 'the programmer, by hand', 'the kernel only', 'nobody: it is sequential'], answer: 0, why: 'The programmer says what can run in parallel; the runtime decides how.' },
    ],
  });

  // ---- concurrency, parallelism and Amdahl's law ----------------------------------------------------------------------
  const amdahl = (s, n) => 1 / (s + (1 - s) / n);
  H.topic({
    id: 'thr-amdahl', family: 'p04-patterns', order: 40, title: 'Concurrency, parallelism and Amdahl\'s law',
    blurb: 'Several threads on one core run concurrently: they take turns, and the work takes as long as before. On several cores they run in parallel and the parallel part shrinks. The serial part does not, so it sets a ceiling: with a fraction s that must run alone, no number of cores gives a speed-up above 1/s.',
    inputs: [
      { id: 'serial', kind: 'number', label: 'Serial part (%)', def: 20, min: 1, max: 90 },
      { id: 'max', kind: 'choice', label: 'Up to cores', def: '16', options: ['8', '16', '64'].map((v) => ({ value: v, label: v })) },
      { id: 'work', kind: 'number', label: 'Time on one core', def: 100, min: 10, max: 1000 },
    ],
    presets: [
      { label: '20% serial', values: { serial: 20, max: '16', work: 100 } },
      { label: '5% serial, 64 cores', values: { serial: 5, max: '64', work: 100 } },
      { label: 'Half serial', values: { serial: 50, max: '16', work: 100 } },
      { label: '10% serial, 8 cores', values: { serial: 10, max: '8', work: 200 } },
    ],
    counters: [{ id: 'n', label: 'cores' }],
    run(inp) {
      const s = inp.serial / 100, max = +inp.max, T1 = inp.work;
      const ns = [1, 2, 4, 8, 16, 32, 64].filter((n) => n <= max), F = new S.Frames(['n']);
      const fx = (v) => +(+v).toFixed(2);
      const ax = CV().axes({ prefix: 'cv', x: 470, y: 30, w: 320, h: 250, xr: [0, max], yr: [0, Math.ceil(1 / s) + 1], xticks: max / 4, yticks: Math.max(1, Math.ceil((1 / s + 1) / 5)), xname: 'cores', yname: 'speed-up' });
      function picture(k, mode) {
        const items = [];
        const bar = (key, y, n, label) => {
          const ser = T1 * s, par = (T1 * (1 - s)) / n, X = (t) => 10 + (t / T1) * 420;
          items.push(H.text(key + 'l', 10, y - 8, label, 'strong', 14));
          items.push({ key: key + 's', kind: 'cell', x: X(0), y, w: X(ser) - X(0), h: 30, rx: 3, text: ser >= T1 * 0.08 ? 'serial' : '', size: 13, cls: 'gseg io' });
          if (mode === 'concurrent' && n > 1) {
            // one core: the parallel part's threads take turns
            const slots = 8, sw = (X(T1) - X(ser)) / slots;
            for (let j = 0; j < slots; j++) items.push({ key: key + 'c' + j, kind: 'cell', x: Math.round(X(ser) + j * sw), y, w: Math.round(sw), h: 30, rx: 2, text: '', cls: 'gseg ' + H.pcls(j % n) });
          } else for (let c = 0; c < n && c < 4; c++) items.push({ key: key + 'p' + c, kind: 'cell', x: X(ser), y: y + c * (n > 1 ? 34 : 0), w: Math.max(2, X(ser + par) - X(ser)), h: 30, rx: 3, text: X(ser + par) - X(ser) > 44 ? (n > 4 && c === 3 ? '…' + n : 'core ' + c) : '', size: 12, cls: 'gseg ' + H.pcls(c) });
          return ser + (mode === 'concurrent' ? T1 * (1 - s) : par);
        };
        const n = ns[Math.min(k, ns.length - 1)];
        let t;
        if (mode === 'concurrent') t = bar('b', 50, 4, '4 threads on 1 core: concurrent');
        else t = bar('b', 50, n, H.plural(n, 'core'));
        items.push(H.text('bt', 10, 210, 'time: ' + fx(t) + ' of ' + T1 + ', speed-up ' + fx(T1 / t), 'mono', 14));
        items.push(...ax.items);
        const ym = Math.ceil(1 / s) + 1;
        items.push(CV().line(ax, 'ideal', [[1, 1], [Math.min(max, ym), Math.min(max, ym)]], 'series faint'));
        items.push(...CV().legend('lgc', 470, 330, [{ text: 'Amdahl\'s law', cls: 'act' }, { text: 'perfect scaling', cls: 'faint' }], { dir: 'row', size: 13 }));
        const pts = ns.slice(0, mode === 'concurrent' ? 0 : k + 1).map((m) => [m, amdahl(s, m)]);
        if (pts.length > 1) items.push(CV().line(ax, 'am', pts, 'series act'));
        pts.forEach(([m, v]) => items.push(CV().dot(ax, 'd' + m, m, v, 'mark')));
        items.push(CV().line(ax, 'lim', [[0, 1 / s], [max, 1 / s]], 'series muted'));
        items.push(H.text('limt', 690, ax.Y(1 / s) - 8, 'limit 1/s = ' + fx(1 / s), 'tick', 13));
        return items;
      }
      F.add({ items: picture(0, 'concurrent'), say: `On one core, ${inp.serial}% of the ${T1} units must run alone and the rest is split among 4 threads that take turns: they run concurrently, not in parallel, and the whole still takes ${T1}. Concurrency is about structure; it only speeds things up when there are cores to run on.`, meta: { vals: [inp.serial, T1, 4, 1] } });
      ns.forEach((n, k) => {
        const t = T1 * s + (T1 * (1 - s)) / n, sp = amdahl(s, n);
        F.set('n', n);
        F.add({ items: picture(k, 'parallel'), say: `${H.plural(n, 'core')}: the serial ${fx(T1 * s)} stays, the parallel ${fx(T1 * (1 - s))} becomes ${fx((T1 * (1 - s)) / n)}, so the time is ${fx(t)} and the speed-up is ${T1} / ${fx(t)} = ${fx(sp)}${n > 1 ? ', ' + Math.round((100 * sp) / n) + '% of the ' + n + ' that perfect scaling would give' : ''}.`, meta: { vals: [n, T1, T1 * s, T1 * (1 - s), (T1 * (1 - s)) / n, t, sp, (100 * sp) / n].map(fx).concat([Math.round((100 * sp) / n)]), sp: fx(sp) } });
      });
      F.add({ items: picture(ns.length - 1, 'parallel'), say: `Amdahl's law: speed-up(n) = 1 / (s + (1 − s)/n) with s = ${fx(s)}. As n grows the parallel part shrinks to nothing and the speed-up creeps up to 1/s = ${fx(1 / s)}; with ${max} cores it is ${fx(amdahl(s, max))}. To go faster, shrink the serial part.`, meta: { vals: [s, 1 / s, max, amdahl(s, max)].map(fx), limit: fx(1 / s) } });
      return { frames: F.list, def: H.def('Amdahl\'s law', ['s: the fraction that must run alone', 'speed-up(n) = 1 / (s + (1 − s) / n)', 'limit as n grows: 1 / s', '', 'concurrent: tasks in progress at once', '  (one core can take turns)', 'parallel: tasks running at once', '  (needs several cores)']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'With unlimited cores, what is the largest possible speed-up?', options: (fr, i, inp) => { const l = +(100 / inp.serial).toFixed(2); return [...new Set([l, +inp.max, +(l / 2).toFixed(2), 100 - inp.serial])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.limit), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: '10% of a program is serial. The best speed-up on any number of cores is…', options: ['10', '90', '100', 'unlimited'], answer: 0, why: '1 / 0.1 = 10.' },
      { q: 'Four threads on one core finish their work…', options: ['no sooner than one thread doing it all', 'four times faster', 'never', 'twice as fast'], answer: 0, why: 'They take turns on the one core: concurrency without parallelism.' },
      { q: 'With s = 0.2 and 4 cores, the speed-up is…', options: ['2.5', '4', '5', '3.2'], answer: 0, why: '1 / (0.2 + 0.8/4) = 1 / 0.4 = 2.5.' },
      { q: 'Why do real programs often scale worse than Amdahl\'s law says?', options: ['threads also pay for creation, locks, and shared caches and memory', 'the law overestimates the serial part', 'cores slow down', 'the law is for one core only'], answer: 0, why: 'The law counts only the serial fraction; overheads grow with the number of threads.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
