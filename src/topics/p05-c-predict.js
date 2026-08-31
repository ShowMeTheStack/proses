// Part 5: predicting the next CPU burst by exponential averaging. One job's bursts are measured one after another;
// before each, the scheduler's guess tau is on the plot, then the real burst t appears and the next guess is worked
// out as alpha × t + (1 − alpha) × tau. The weight alpha decides how fast the guess forgets the past.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, C = () => S.Kit.curve, G = () => S.Kit.gantt;

  S.topic({
    id: 'sch-predict', family: 'p05-basic', order: 40, title: 'Predicting the next burst',
    blurb: 'Shortest job first needs the length of the next CPU burst, which nobody knows in advance. A scheduler can guess it from the past: after each burst t, the next guess is τ = α·t + (1 − α)·τ, an exponential average. With α = 1 only the last burst counts; with α = 0 the guess never changes; in between, older bursts count for less and less.',
    inputs: [
      { id: 'bursts', kind: 'list', label: 'Measured CPU bursts, in order', def: ['5', '3', '5', '3', '11', '12', '11', '2', '3'], min: 2, max: 12, check: (v) => (v.every((x) => /^\d+$/.test(x) && +x >= 1 && +x <= 30) ? null : 'Measured CPU bursts: whole numbers from 1 to 30') },
      { id: 'alpha', kind: 'slider', label: 'Weight α of the last burst', def: 0.5, min: 0, max: 1, step: 0.125, fmt: (v) => String(+v) },
      { id: 'tau0', kind: 'number', label: 'First guess τ₀', def: 8, min: 1, max: 30 },
    ],
    presets: [
      { label: 'A job that changes pace, α = 0.5', values: { bursts: ['5', '3', '5', '3', '11', '12', '11', '2', '3'], alpha: 0.5 } },
      { label: 'The same, α = 0.125: slow to learn', values: { bursts: ['5', '3', '5', '3', '11', '12', '11', '2', '3'], alpha: 0.125 } },
      { label: 'The same, α = 1: only the last burst', values: { bursts: ['5', '3', '5', '3', '11', '12', '11', '2', '3'], alpha: 1 } },
      { label: 'A steady job, a bad first guess', values: { bursts: ['3', '3', '3', '3', '3', '3', '3'], alpha: 0.5, tau0: 20 } },
      { label: 'One long burst in a run of short ones', values: { bursts: ['2', '2', '2', '18', '2', '2', '2'], alpha: 0.5, tau0: 2 } },
    ],
    run(inp) {
      const b = inp.bursts.map(Number), a = +inp.alpha, work = [{ id: 'J', arrive: 0, bursts: b.flatMap((x, k) => (k ? [1, x] : [x])) }];
      const tr = Sch().run(work, 'sjf', { predict: { alpha: a, tau0: inp.tau0 } }), pr = tr.predictions;
      const n = pr.length, hi = Math.max(inp.tau0, ...b) * 1.1;
      const ax = C().axes({ prefix: 'ax', x: 50, y: 30, w: 430, h: 300, xr: [0.5, n + 0.5], yr: [0, hi], xticks: n > 8 ? 2 : 1, xname: 'burst number', yname: 'ticks', tickSize: 13 });
      const frames = [];
      const cols = [{ w: 44, label: 'n' }, { w: 92, label: 'guess τ' }, { w: 82, label: 'actual t' }, { w: 92, label: 'error' }];
      const draw = (k, phase) => {
        // k bursts measured; the guess for burst k + 1 is shown
        const items = [...ax.items];
        const act = pr.slice(0, k).map((p, i) => [i + 1, p.actual]);
        const gs = pr.slice(0, Math.min(n, k + 1)).map((p, i) => [i + 1, p.predicted]);
        if (act.length > 1) items.push(C().line(ax, 'la', act, 'c0'));
        if (gs.length > 1) items.push(C().line(ax, 'lg', gs, 'act'));
        act.forEach(([u, v], i) => items.push(Object.assign(C().dot(ax, 'da' + i, u, v, 'c0'), { audit: 'overlap-ok', point: false })));
        gs.forEach(([u, v], i) => items.push(Object.assign(C().dot(ax, 'dg' + i, u, v, ''), { audit: 'overlap-ok', point: false }, i === k ? { r: 6.5, pulse: phase === 'guess' } : {})));
        items.push(...C().legend('lgd', 60, 400, [{ text: 'actual burst t', cls: 'c0' }, { text: 'guess τ', cls: 'act' }]));
        const rows = pr.slice(0, Math.min(n, k + 1)).map((p, i) => ({ key: 'r' + i, cells: [String(i + 1), P.f(p.predicted), i < k ? String(p.actual) : '?', i < k ? P.f(p.actual - p.predicted) : ''], cls: i === k ? 'fresh' : '' }));
        items.push(...G().table({ prefix: 'tb', x: 520, y: 20, cols, rows: rows.slice(-11), rowH: 28, size: 14 }).items);
        return items;
      };
      frames.push({ items: draw(0, 'guess'), say: `Before any burst has been seen, the guess for burst 1 is the starting value τ₀ = ${P.f(pr[0].predicted)}. The weight of the newest burst is α = ${a}.`, meta: { phase: 'start', tau: pr[0].predicted, alpha: a }, title: 'τ₀' });
      pr.forEach((p, k) => {
        const items = draw(k + 1, 'measure');
        items.push(P.text('fm', 50, 440, `τ${k + 2} = ${a} × ${p.actual} + ${P.f(1 - a)} × ${P.f(p.predicted)} = ${P.f(p.next)}`, 'p05val act', 15));
        const dir = p.next > p.predicted ? 'up' : p.next < p.predicted ? 'down' : 'unchanged';
        frames.push({ items, say: `Burst ${k + 1} takes ${p.actual} against a guess of ${P.f(p.predicted)}. The next guess is ${a} × ${p.actual} + ${P.f(1 - a)} × ${P.f(p.predicted)} = ${P.f(p.next)}` + (dir === 'unchanged' ? ', unchanged.' : `, ${dir === 'up' ? 'up' : 'down'} by ${P.f(Math.abs(p.next - p.predicted))}.`), meta: { phase: 'burst', k: k + 1, p, alpha: a, oneMinus: P.r2(1 - a), dir, delta: P.r2(Math.abs(p.next - p.predicted)) }, title: 'burst ' + (k + 1) });
      });
      const err = pr.reduce((s, p) => s + Math.abs(p.actual - p.predicted), 0) / n;
      const items = draw(n, 'end');
      items.push(P.text('fm', 50, 440, `mean absolute error of the guesses: ${P.f(err)} ticks`, 'gwhy', 15));
      frames.push({ items, say: `Over ${P.s(n, 'burst')} the guesses were off by ${P.f(err)} ticks on average. ` + (a === 0 ? 'With α = 0 the guess never moved from τ₀.' : a === 1 ? 'With α = 1 each guess simply repeats the last burst, so it is wrong every time the pace changes.' : `With α = ${a}, a burst k steps back still weighs ${a} × ${P.f(1 - a)}^k in the guess.`), meta: { phase: 'end', err, alpha: a, oneMinus: P.r2(1 - a) }, title: 'error' });
      return { frames, def: P.def(['Exponential averaging', ['τ(n+1) = α·t(n) + (1 − α)·τ(n)', 't(n): the length of burst n, measured', 'τ(n): the guess for burst n', '0 ≤ α ≤ 1']], ['Unrolled', ['τ(n+1) = α·t(n) + (1 − α)·α·t(n−1) + (1 − α)²·α·t(n−2) + … + (1 − α)ⁿ·τ(1)', 'each older burst counts (1 − α) times less']], ['In a scheduler', 'Shortest job first and shortest remaining time next can rank jobs by their guesses instead of their true bursts. A job whose pace changes is misjudged for a few bursts while the average catches up.']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'burst' && fr[i + 1] && fr[i + 1].meta.phase === 'burst' && fr[i + 1].meta.dir !== 'unchanged' && i % 3 === 2, pick: 'option', ask: (fr, i) => `Burst ${fr[i + 1].meta.k} will take ${fr[i + 1].meta.p.actual}. Will the guess after it go up or down?`, options: ['up', 'down'], answer: (fr, i) => fr[i + 1].meta.dir, explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'The first burst will take a different time from τ₀. With α between 0 and 1, where does the next guess land?', options: ['between τ₀ and the burst', 'exactly at the burst', 'exactly at τ₀', 'beyond the burst'], answer: (fr) => (fr[0].meta.alpha === 1 ? 'exactly at the burst' : fr[0].meta.alpha === 0 ? 'exactly at τ₀' : 'between τ₀ and the burst'), explain: (fr) => fr[1].say },
    ],
    quiz: [
      { q: 'α = 0.5, τ = 12 and the burst was 4. The next guess is…', options: ['8', '4', '12', '16'], answer: 0, why: '0.5 × 4 + 0.5 × 12.' },
      { q: 'With α = 1 the next guess is…', options: ['the last burst', 'the first guess', 'the average of all bursts', 'always 0'], answer: 0, why: '1 × t + 0 × τ.' },
      { q: 'With α = 0 the guess…', options: ['never changes', 'equals the last burst', 'doubles each time', 'is the mean of the bursts'], answer: 0, why: '0 × t + 1 × τ = τ.' },
      { q: 'α = 0.5. How much does the burst three steps back count in the guess?', options: ['0.0625', '0.5', '0.25', '0.125'], answer: 0, why: '0.5 × 0.5³.' },
      { q: 'A job usually runs 2 ticks, then once runs 18. With α = 0.5, the guesses after the long burst…', options: ['jump up, then fall back over a few bursts', 'stay at 2', 'stay at 18 for ever', 'become negative'], answer: 0, why: 'Each later short burst halves the extra.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
