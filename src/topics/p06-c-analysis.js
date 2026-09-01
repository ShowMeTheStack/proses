// Part 6: deciding schedulability before running. The utilisation bound of rate-monotonic scheduling, n(2^(1/n) − 1),
// plotted against the number of tasks with the task set's U added one task at a time; response-time analysis, the
// fixed-point iteration for each task drawn as the window [0, R) filling with higher-priority work; and EDF's
// processor-demand test, the demand step function against the line of available time.
(function (S) {
  'use strict';
  const P = S.P05, Q = S.P06, Sch = () => S.Sched, C = () => S.Kit.curve, G = () => S.Kit.gantt;

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-bound', family: 'p06-analysis', order: 10, title: 'Utilisation bounds',
    blurb: 'A quick test before any schedule is drawn. Rate-monotonic scheduling meets every deadline of n tasks (deadlines equal to periods) if their utilisation is at most n(2^(1/n) − 1): 1 for one task, 0.83 for two, falling towards ln 2 ≈ 0.69. Above the bound RM may still succeed, but only an exact test can tell. EDF\'s bound is simply 1. Each step adds a task and moves the point.',
    inputs: [Q.taskInput('A 1 4\nB 2 6\nC 3 12\nD 1 24')],
    presets: [
      { label: 'Four tasks, under the bound until the last', values: { tasks: 'A 1 4\nB 2 6\nC 3 12\nD 1 24' } },
      { label: 'Two tasks over the bound: RM misses', values: { tasks: Q.TS.tight } },
      { label: 'Over the bound, but harmonic: RM is fine', values: { tasks: Q.TS.harmonic } },
      { label: 'Three tasks under the bound', values: { tasks: 'A 1 5\nB 1 8\nC 2 10' } },
    ],
    run(inp) {
      const ts = Q.tasks(inp.tasks), n = ts.length, steps = ts.map((_, k) => Sch().rtAnalysis(ts.slice(0, k + 1)));
      const maxN = Math.max(6, n + 1), hi = Math.max(1.2, ...steps.map((a) => a.U + 0.1));
      const ax = C().axes({ prefix: 'ax', x: 60, y: 30, w: 460, h: 300, xr: [0.5, maxN + 0.5], yr: [0, hi], xticks: 1, xname: 'number of tasks n', yname: 'utilisation', tickSize: 13 });
      const curve = [];
      for (let k = 1; k <= maxN; k++) curve.push([k, k * (Math.pow(2, 1 / k) - 1)]);
      const base = () => {
        const items = [...ax.items, C().line(ax, 'bound', curve, 'c0'), C().hline(ax, 'one', 1, 'act'), C().hline(ax, 'ln2', Math.LN2, '')];
        curve.forEach(([u, v], i) => items.push(Object.assign(C().dot(ax, 'bd' + i, u, v, 'c0', 3.5), { audit: 'overlap-ok', point: false })));
        items.push(P.text('l1', ax.X(maxN + 0.5) + 8, ax.Y(1) + 5, 'EDF: U ≤ 1', 'glabel', 14));
        items.push(P.text('l2', ax.X(maxN + 0.5) + 8, ax.Y(Math.LN2) + 5, 'ln 2 ≈ 0.69', 'glabel', 14));
        items.push(P.text('l3', ax.X(maxN + 0.5) + 8, ax.Y(curve[maxN - 1][1]) - 14, 'RM bound', 'c0', 14));
        return items;
      };
      const frames = [];
      const verdict = (a) => (a.Uexact > 1 + 1e-9 ? 'over 1: no policy can meet every deadline' : a.rmBound ? 'at or under the RM bound: RM meets every deadline' : 'over the RM bound but at most 1: EDF meets every deadline; RM needs the exact test');
      steps.forEach((a, k) => {
        const items = base();
        steps.slice(0, k + 1).forEach((b, i) => items.push(Object.assign(C().dot(ax, 'u' + i, i + 1, Math.min(hi, b.U), b.Uexact > 1 + 1e-9 ? 'p06bad' : b.rmBound ? 'p06ok' : 'p06mid', i === k ? 7 : 5), { audit: 'overlap-ok', point: false })));
        if (k) items.push(C().line(ax, 'path', steps.slice(0, k + 1).map((b, i) => [i + 1, Math.min(hi, b.U)]), 'faint'));
        items.push(P.text('vU', 60, 410, 'U = ' + a.U, 'p05val', 16));
        items.push(P.text('vB', 200, 410, 'RM bound for ' + (k + 1) + ': ' + a.bound, 'p05val', 15));
        G().wrap(verdict(a), 700, 14).forEach((ln, i) => items.push(P.text('vV' + i, 60, 438 + i * 20, ln, a.Uexact > 1 + 1e-9 ? 'bad' : a.rmBound ? 'good' : 'hot', 14)));
        const tk = ts[k];
        frames.push({ items, say: `Adding ${tk.id} (${tk.C} every ${tk.T}): U = ${a.U}, against the RM bound for ${P.s(k + 1, 'task')} of ${a.bound}: ${verdict(a)}.`, meta: { phase: 'add', k: k + 1, U: a.U, bound: a.bound, rmBound: a.rmBound, over: a.Uexact > 1 + 1e-9 }, title: '+ ' + tk.id });
      });
      const a = steps[n - 1], items = frames[frames.length - 1].items.slice();
      const exact = a.rmExact;
      frames.push({ items, say: `The exact test (response-time analysis) says RM ${exact ? 'does' : 'does not'} meet every deadline of this set` + (a.rmBound ? ', as the bound promised.' : exact ? ': the bound is only sufficient, so a set above it can still be fine.' : '.') + (a.Uexact <= 1 + 1e-9 ? ' EDF meets every deadline, since U ≤ 1.' : ''), meta: { phase: 'exact', rmExact: exact, U: a.U, bound: a.bound }, title: 'exact' });
      return { frames, def: P.def(['The rate-monotonic bound', ['U ≤ n(2^(1/n) − 1) ⇒ RM meets every deadline', 'n = 1: 1;  n = 2: 0.828;  n = 3: 0.780;  n → ∞: ln 2 ≈ 0.693', 'sufficient, not necessary']], ['EDF', ['U ≤ 1 ⇔ EDF meets every deadline (D = T, one CPU)']], ['Above the bound', 'For RM above the bound, use [[rt-rta]]: it is exact.']) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'add' && fr[i + 1] && fr[i + 1].meta.phase === 'add', pick: 'option', ask: (fr, i) => `After adding the next task, will U still be under the RM bound for ${fr[i + 1].meta.k} tasks?`, options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.rmBound ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'The RM bound for two tasks is…', options: ['0.828', '1', '0.693', '0.5'], answer: 0, why: '2(√2 − 1).' },
      { q: 'Three tasks have U = 0.75. Under RM…', options: ['every deadline is met: 0.75 ≤ 0.780', 'some deadline may be missed', 'EDF is needed', 'nothing can be said'], answer: 0, why: 'Under the bound, RM is guaranteed.' },
      { q: 'Two tasks have U = 0.9. Under RM…', options: ['the bound cannot decide; an exact test is needed', 'a deadline is surely missed', 'every deadline is surely met', 'the tasks cannot run'], answer: 0, why: 'The bound is sufficient, not necessary.' },
      { q: 'As n grows, the RM bound approaches…', options: ['ln 2 ≈ 0.69', '0', '1', '0.5'], answer: 0, why: 'n(2^(1/n) − 1) → ln 2.' },
      { q: 'The EDF bound for deadlines equal to periods is…', options: ['1', '0.69', 'n(2^(1/n) − 1)', '0.5'], answer: 0, why: 'EDF can use the whole CPU.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-rta', family: 'p06-analysis', order: 20, title: 'Response-time analysis',
    blurb: 'An exact test for fixed priorities. Release every task at once (the worst case). A task\'s response time R is its own work C plus the work of every higher-priority task released before R: R = C + Σ ⌈R / Tj⌉ Cj. Start from R = C and repeat until R stops changing. If R ≤ D the task always meets its deadline. The picture fills the window [0, R) with the higher-priority jobs that land in it.',
    inputs: [Q.taskInput(Q.TS.easy)],
    presets: [
      { label: 'Three tasks, all in time', values: { tasks: Q.TS.easy } },
      { label: 'Two tasks: B is late', values: { tasks: Q.TS.tight } },
      { label: 'Harmonic, U = 1', values: { tasks: Q.TS.harmonic } },
      { label: 'Four tasks', values: { tasks: 'A 1 5\nB 2 8\nC 2 10\nD 3 20' } },
    ],
    run(inp) {
      const ts = Q.tasks(inp.tasks), A = Sch().rtAnalysis(ts), sim = Sch().rt(ts, { policy: 'rm' }), T = {};
      for (const k of sim.tasks) T[k.id] = k;
      const ids = sim.tasks.map((k) => k.id), frames = [];
      const span = Math.max(...A.rta.map((r) => Math.max(r.R, r.D))) + 1;
      const x0 = 70, x1 = P.W_, X = (u) => Math.round((x0 + (u / span) * (x1 - x0)) * 10) / 10;
      const draw = (r, R, next) => {
        const items = [...G().axis({ prefix: 'ax', X, t1: span, y: 18, step: P.tickStep((x1 - x0) / span, 26), size: 13 })];
        const rows = r.hp.concat([r.id]);
        rows.forEach((id, i) => {
          const y = 40 + i * 44, k = T[id], ci = ids.indexOf(id);
          items.push(P.text('rn' + id, x0 - 12, y + 19, id, 'glname', 15, 'end'));
          items.push(...G().track({ prefix: 'rt' + id, x: x0, y, w: x1 - x0, h: 28 }));
          if (id === r.id) items.push({ key: 'own', kind: 'cell', x: X(0), y, w: X(k.C) - X(0), h: 28, text: X(k.C) - X(0) > 30 ? 'C ' + k.C : '', size: 13, cls: 'gseg p' + (ci % 6) });
          else for (let rel = 0; rel < R; rel += k.T) items.push({ key: 'hp' + id + rel, kind: 'cell', x: X(rel), y, w: X(rel + k.C) - X(rel), h: 28, text: X(rel + k.C) - X(rel) > 22 ? String(k.C) : '', size: 13, cls: 'gseg p' + (ci % 6) });
        });
        const yb = 40 + rows.length * 44;
        items.push({ key: 'win', kind: 'path', d: `M${X(R)},${30} V${yb}`, cls: 'gcursor', audit: 'ignore', layer: 'top' });
        items.push({ key: 'winB', kind: 'bracket', x1: X(0), x2: X(R), y: yb + 4, side: 'below', text: 'window R = ' + R, cls: 'p05br' });
        items.push({ key: 'dl', kind: 'path', d: `M${X(r.D)},${30} V${yb}`, cls: 'p06dline', audit: 'ignore', layer: 'top' });
        items.push(P.text('dlT', X(r.D), yb + 48, 'deadline ' + r.D, 'hot', 13, 'middle'));
        if (next !== undefined) items.push(P.text('eq', 0, yb + 80, next, 'p05val act', 15));
        return items;
      };
      A.rta.forEach((r) => {
        const k = T[r.id];
        r.iterations.forEach((R, i) => {
          const nextR = r.iterations[i + 1];
          let eq, say;
          if (i === 0) { eq = `${r.id}: start with R = C = ${R}`; say = `${r.id} has priority below ${r.hp.length ? P.list(r.hp) : 'no one'}. Start with its own work: R = C = ${R}.` + (r.hp.length ? '' : ' Nothing can interfere, so that is its response time.'); }
          else {
            const prev = r.iterations[i - 1], terms = r.hp.map((j) => `⌈${prev}/${T[j].T}⌉×${T[j].C}`);
            eq = `R = ${k.C} + ${terms.join(' + ')} = ${R}`;
            say = `In a window of ${prev}, the higher-priority tasks release ` + r.hp.map((j) => `${Math.ceil(prev / T[j].T)} of ${j}`).join(' and ') + `: R = ${k.C} + ` + r.hp.map((j) => Math.ceil(prev / T[j].T) * T[j].C).join(' + ') + ` = ${R}.` + (nextR === undefined ? (R > r.D ? ` R has passed the deadline ${r.D}: ${r.id} can miss.` : ' The window is stable.') : '');
          }
          frames.push({ items: draw(r, R, eq), say, meta: { phase: 'iter', id: r.id, R, i, prev: i ? r.iterations[i - 1] : null, C: k.C, D: r.D, terms: r.hp.map((j) => { const nj = i ? Math.ceil(r.iterations[i - 1] / T[j].T) : 0; return { id: j, n: nj, C: T[j].C, T: T[j].T, w: nj * T[j].C }; }) }, title: r.id + ' R' + i });
        });
        const worst = sim.perTask.find((p) => p.id === r.id).worst;
        frames.push({ items: draw(r, r.R, `${r.id}: R = ${r.R} ${r.ok ? '≤' : '>'} D = ${r.D}: ${r.ok ? 'always in time' : 'can miss'}`), say: `${r.id}'s response time is ${r.R}, ${r.ok ? 'within' : 'beyond'} its deadline of ${r.D}` + (r.ok ? `. In the schedule over the hyperperiod its worst response was ${worst}.` : '.'), meta: { phase: 'verdict', id: r.id, R: r.R, D: r.D, ok: r.ok, worst }, title: r.id + (r.ok ? ' ok' : ' late') });
      });
      return { frames, def: P.def(['The iteration', ['R⁰ = Cᵢ', 'Rᵏ⁺¹ = Cᵢ + Σ over higher-priority j of ⌈Rᵏ / Tⱼ⌉ · Cⱼ', 'stop when Rᵏ⁺¹ = Rᵏ (the response time) or when it passes Dᵢ (a miss)']], ['Why it is exact', 'When every task is released at the same instant, the lower-priority task meets the most interference it ever can. Each term counts the jobs of a higher-priority task released inside the window, all of which must run before the window closes.']) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'iter' && fr[i + 1] && fr[i + 1].meta.phase === 'iter' && fr[i + 1].meta.id === f.meta.id, pick: 'option', ask: (fr, i) => `What is the next value of R for ${fr[i + 1].meta.id}?`, options: (fr, i) => { const v = fr[i + 1].meta.R; return [...new Set([v, v + 1, Math.max(1, v - 1), fr[i].meta.R, v + 2])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.R), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A (1, 4) has higher priority than B (2, 6). B\'s iteration starts at R = 2. The next R is…', options: ['3', '2', '4', '5'], answer: 0, why: '2 + ⌈2/4⌉ × 1 = 3.' },
      { q: 'And the one after?', options: ['3: it is stable', '4', '5', '6'], answer: 0, why: '2 + ⌈3/4⌉ × 1 = 3 again.' },
      { q: 'The highest-priority task\'s response time is…', options: ['its own C', 'its period', 'its deadline', 'the hyperperiod'], answer: 0, why: 'Nothing can interfere with it.' },
      { q: 'R grows past D during the iteration. What does that mean?', options: ['The task can miss its deadline', 'The test failed to converge, try again', 'The task is fine', 'The period is wrong'], answer: 0, why: 'Its worst-case response exceeds its deadline.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-demand', family: 'p06-analysis', order: 30, title: 'EDF\'s processor-demand test',
    blurb: 'When deadlines come before the periods, U ≤ 1 is no longer enough for EDF. The exact test counts, for each length of time L from 0, the work that must be done within it: every job released at or after 0 whose deadline falls by L. That demand h(L) is a staircase; the available time is the line h = L. EDF meets every deadline if and only if the staircase never rises above the line, checked at every absolute deadline up to the hyperperiod.',
    inputs: [Q.taskInput(Q.TS.deadlines)],
    presets: [
      { label: 'Deadlines before periods: it fits', values: { tasks: Q.TS.deadlines } },
      { label: 'Tight deadlines: it fails', values: { tasks: 'A 2 4 2\nB 2 6 3\nC 1 8 4' } },
      { label: 'U < 1 is not enough', values: { tasks: 'A 2 5 2\nB 2 5 3\nC 1 10 4' } },
    ],
    run(inp) {
      const ts = Q.tasks(inp.tasks), A = Sch().rtAnalysis(ts), frames = [];
      if (A.implicit || A.Uexact > 1 + 1e-9) {
        frames.push({ items: [P.text('m0', 0, 20, A.implicit ? 'every deadline equals its period' : 'U = ' + A.U + ' > 1', 'gpol', 16)], say: A.implicit ? `Every deadline here equals its period, so EDF meets every deadline exactly when U ≤ 1; here U = ${A.U}. Give a task a deadline below its period to see the demand test.` : `U = ${A.U} is over 1: the tasks need more time than exists, so no test is needed: some deadline will be missed.`, meta: { phase: 'skip', U: A.U }, title: 'no test' });
        frames.push({ items: [P.text('m0', 0, 20, 'U = ' + A.U, 'gpol', 16), P.text('m1', 0, 50, A.Uexact <= 1 ? 'EDF meets every deadline' : 'some deadline will be missed', A.Uexact <= 1 ? 'good' : 'bad', 15)], say: A.Uexact <= 1 + 1e-9 ? `With U = ${A.U} ≤ 1, EDF meets every deadline.` : `With U = ${A.U}, EDF will miss deadlines.`, meta: { phase: 'end', U: A.U }, title: 'verdict' });
        return { frames, def: null };
      }
      const pts = A.demand, Lmax = pts[pts.length - 1].L, hi = Math.max(Lmax, ...pts.map((p) => p.demand)) * 1.08;
      const ax = C().axes({ prefix: 'ax', x: 60, y: 30, w: 480, h: 330, xr: [0, Lmax * 1.05], yr: [0, hi], xname: 'interval length L', yname: 'ticks', tickSize: 13 });
      const draw = (k) => {
        const items = [...ax.items, C().line(ax, 'avail', [[0, 0], [Lmax * 1.05, Math.min(hi, Lmax * 1.05)]], 'act')];
        const sh = pts.slice(0, k + 1), stair = [[0, 0]];
        let last = 0;
        for (const p of sh) { stair.push([p.L, last], [p.L, p.demand]); last = p.demand; }
        stair.push([sh[sh.length - 1].L + (k + 1 < pts.length ? 0 : Lmax * 0.05), last]);
        items.push(C().line(ax, 'stair', stair, 'c0'));
        sh.forEach((p, i) => items.push(Object.assign(C().dot(ax, 'pt' + i, p.L, p.demand, p.ok ? 'p06ok' : 'p06bad', i === k ? 6.5 : 4.5), { audit: 'overlap-ok', point: false })));
        items.push(...C().legend('lg', 70, 420, [{ text: 'demand h(L)', cls: 'c0' }, { text: 'available time L', cls: 'act' }]));
        // the jobs that count at this L
        const p = pts[k], cnt = ts.map((t) => { const n = Math.max(0, Math.floor((p.L - t.D) / t.T) + 1); return { id: t.id, n, C: t.C, w: n * t.C }; });
        items.push(P.text('cT', 580, 50, 'at L = ' + p.L + ':', 'glname', 15));
        cnt.forEach((c, i) => items.push(P.text('c' + c.id, 580, 80 + i * 26, `${c.id}: ${c.n} × ${c.C} = ${c.n * c.C}`, 'p05val', 14)));
        items.push(P.text('cS', 580, 90 + cnt.length * 26, `h = ${p.demand} ${p.ok ? '≤' : '>'} ${p.L}`, p.ok ? 'good' : 'bad', 15));
        return { items, cnt };
      };
      pts.forEach((p, k) => {
        const d = draw(k);
        frames.push({ items: d.items, say: `At L = ${p.L}, the jobs due by then are ` + d.cnt.filter((c) => c.n).map((c) => `${c.n} of ${c.id}`).join(', ') + `: demand ${d.cnt.filter((c) => c.n).map((c) => c.n * c.C).join(' + ')} = ${p.demand}, ` + (p.ok ? `within the ${p.L} ticks available.` : `more than the ${p.L} ticks available: some deadline by ${p.L} must be missed.`), meta: { phase: 'L', L: p.L, demand: p.demand, ok: p.ok, cnt: d.cnt }, title: 'L = ' + p.L });
      });
      const last = frames[frames.length - 1];
      frames.push({ items: last.items, say: A.edfExact ? `The demand never exceeds the time available at any deadline up to ${Lmax}: EDF meets every deadline (U = ${A.U}).` : `The demand passed the line at L = ${Lmax}: EDF cannot meet every deadline, although U = ${A.U}` + (A.Uexact <= 1 ? ' is at most 1.' : '.'), meta: { phase: 'end', ok: A.edfExact, U: A.U, Lmax }, title: A.edfExact ? 'fits' : 'fails' });
      return { frames, def: P.def(['Demand', ['h(L) = Σ max(0, ⌊(L − Dᵢ) / Tᵢ⌋ + 1) · Cᵢ', 'the work of every job released at or after 0 and due by L']], ['The test', ['EDF meets every deadline ⇔ h(L) ≤ L for every L', 'enough to check L at the absolute deadlines up to the hyperperiod (with every phase 0)']]) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'L' && fr[i + 1] && fr[i + 1].meta.phase === 'L', pick: 'option', ask: (fr, i) => `At the next deadline, L = ${fr[i + 1].meta.L}, will the demand still fit?`, options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.ok ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A (C 1, T 4, D 2). How many of its jobs count in h(L) at L = 6?', options: ['2', '1', '3', '0'], answer: 0, why: '⌊(6 − 2) / 4⌋ + 1 = 2: due at 2 and 6.' },
      { q: 'With D = T for every task, what does the demand test reduce to?', options: ['U ≤ 1', 'the RM bound', 'nothing', 'R ≤ D'], answer: 0, why: 'The staircase stays under the line exactly when U ≤ 1.' },
      { q: 'Why can U < 1 still fail when D < T?', options: ['Work must be done before the deadlines, earlier than the periods', 'EDF wastes time', 'U is computed wrongly', 'It cannot'], answer: 0, why: 'Short deadlines crowd the demand into small windows.' },
      { q: 'Where must h(L) ≤ L be checked?', options: ['at each absolute deadline up to the hyperperiod', 'at every tick for ever', 'only at L = 1', 'only at the hyperperiod'], answer: 0, why: 'h only changes at deadlines.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
