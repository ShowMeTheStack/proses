// Dining philosophers on the thread-step machine (src/core/sync-*.js). The naive table, where everyone picks up the
// left fork first, runs into a deadlock and the wait cycle is drawn round the table; the two fixes (the last
// philosopher takes the right fork first, or at most n − 1 may sit) run the same opening and keep eating.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box, Y = () => S.Sync, KS = () => S.Kit.sync;
  const VARIANTS = ['naive', 'ordered', 'seats'];
  const VNAME = { naive: 'everyone left first', ordered: 'last one right first', seats: 'at most n − 1 seated' };
  const CODE = {
    naive: ['think()', 'lock(fork[i])', 'lock(fork[i+1])', 'eat()', 'unlock(fork[i+1])', 'unlock(fork[i])'],
    ordered: ['think()', 'lock(fork[lo])', 'lock(fork[hi])', 'eat()', 'unlock(fork[hi])', 'unlock(fork[lo])'],
    seats: ['think()', 'wait(seats)', 'lock(fork[i])', 'lock(fork[i+1])', 'eat()', 'unlock(fork[i+1])', 'unlock(fork[i])', 'post(seats)'],
  };
  const NOTE = {
    naive: 'fork[i] is the left fork, fork[i+1] (mod n) the right',
    ordered: 'lo, hi: the lower and higher of i and i+1 (mod n)',
    seats: 'seats starts at n − 1',
  };
  const LONG = 600;
  const STATE = { thinking: 's-new', hungry: 's-ready', eating: 's-running', waiting: 's-blocked' };

  /** a seeded shuffle of 0..n-1: the order the scheduler gives out turns in */
  function turns(n, seed) {
    const r = Y().rng(seed * 7919 + n), a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function setup(knobs) {
    const n = knobs.n || 5, variant = VARIANTS[knobs.variant || 0], seed = knobs.seed || 1;
    return { n, variant, seed, order: turns(n, seed) };
  }
  /** the run the frames show: round robin in the shuffled order; the fixes stop once a meal is over */
  function trace(knobs) {
    const k = setup(knobs || {}), spec = Y().philosophers(k.n, k.variant);
    const stop = (M) => M.t >= 3 * k.n && M.threads.some((th) => th.rounds > 0) || M.t >= 5 * k.n + 8;
    const run = Y().run(spec, { policy: 'rr', turns: k.order, max: 6 * k.n + 10, stop: k.variant === 'naive' ? null : stop });
    const long = k.variant === 'naive' ? null : Y().run(spec, { policy: 'random', seed: k.seed, max: LONG });
    return Object.assign(k, { spec, run, long });
  }

  /** what a philosopher is doing, from its place in the program and whether it is blocked */
  function doing(th, prog) {
    if (th.state === 'blocked') return 'waiting';
    const op = prog[th.pc].op;
    if (op === 'think') return 'thinking';
    if (op === 'eat' || op === 'unlock' || (op === 'post' && th.pc > 0)) return 'eating';
    return 'hungry';
  }

  function layout(narrow) {
    if (narrow) return { view: box(0, 0, 400, 960), cx: 200, cy: 196, R: 148, r: 27, tR: 94, fw: 34, fh: 22, size: 14, code: { x: 8, y: 420, lh: 30, size: 13, markW: 29 }, sem: [12, 0] };
    return { view: box(0, 0, 1180, 610), cx: 320, cy: 305, R: 205, r: 34, tR: 122, fw: 42, fh: 26, size: 16, code: { x: 640, y: 36, lh: 36, size: 15, markW: 36 }, sem: [644, 0], legend: [640, 576] };
  }

  function frames(narrow, knobs) {
    const L = layout(narrow), T = D.once('phil:' + JSON.stringify(knobs), () => trace(knobs));
    const { n, variant, spec, run } = T, prog = spec.threads[0].prog, code = CODE[variant];
    const names = T.order.map((i) => 'P' + i).join(', ');
    const out = [];

    function picture(st, o) {
      o = o || {};
      const items = [], ths = st.threads;
      const forks = Array.from({ length: n }, (_, j) => st.mutex['f' + j].owner);
      const cyc = o.cycle ? new Set(o.cycle.map((c) => c.tid)) : null;
      const waits = [];
      for (const th of ths) if (th.state === 'blocked' && th.on.kind === 'mutex') { const h = st.mutex[th.on.id].owner; if (h !== null) waits.push({ from: th.id, to: h, cls: cyc && cyc.has(th.id) ? 'hot' : '' }); }
      const seats = ths.map((th) => ({ name: th.name, cls: STATE[doing(th, spec.threads[th.id].prog)] + (o.act === th.id ? ' act' : '')}));
      items.push(...KS().table({ prefix: 'ph', cx: L.cx, cy: L.cy, R: L.R, r: L.r, n, seats, forks, waits, tableR: L.tR, forkW: L.fw, forkH: L.fh, size: L.size, forkIn: 0.75 }).items);
      // the table's centre: the step count, or the verdict
      const ctr = o.centre || ['step ' + st.t, ''];
      items.push({ key: 'ph:c1', kind: 'text', x: L.cx, y: L.cy - (narrow ? 2 : 4), text: ctr[0], anchor: 'middle', size: narrow ? 15 : 17, cls: o.centreCls || 'verdict' });
      if (ctr[1]) items.push({ key: 'ph:c2', kind: 'text', x: L.cx, y: L.cy + (narrow ? 18 : 22), text: ctr[1], anchor: 'middle', size: 13, cls: 'meals' });
      // the program, with each philosopher's next step
      const marks = code.map(() => []);
      for (const th of ths) if (th.state !== 'done') marks[th.pc].push({ name: th.name, cls: STATE[doing(th, spec.threads[th.id].prog)] + (o.act === th.id ? ' act' : '') });
      const actLine = o.line === undefined ? -1 : o.line;
      const C = KS().code({ prefix: 'pc', x: L.code.x, y: L.code.y, lines: code, marks, act: actLine, hot: o.hotLine, lh: L.code.lh, size: L.code.size, markW: L.code.markW, title: 'Philosopher i runs, forever:' });
      items.push(...C.items);
      let y = L.code.y + C.h + 6;
      items.push({ key: 'pc:note', kind: 'text', x: L.code.x, y: y + 12, text: NOTE[variant], size: 13, cls: 'meals' });
      items.push({ key: 'pc:turns', kind: 'text', x: L.code.x, y: y + 36, text: (o.random ? 'turns: picked at random, seed ' + T.seed : 'turns: ' + T.order.map((i) => 'P' + i).join(' → ') + ' → …'), size: 13, cls: 'meals' });
      y += 58;
      // the meal counts, one cell a philosopher
      const mw = narrow ? 40 : 50;
      items.push({ key: 'ml:t', kind: 'text', x: L.code.x, y: y + 34, text: 'meals', size: 15, cls: 'strong' });
      ths.forEach((th, i) => {
        const x = L.code.x + (narrow ? 60 : 64) + i * (mw + 3);
        items.push({ key: 'ml:n' + i, kind: 'text', x: x + mw / 2, y: y + 12, text: th.name, anchor: 'middle', size: 13, cls: 'colname' });
        items.push({ key: 'ml:v' + i, kind: 'cell', x, y: y + 18, w: mw, h: 30, rx: 4, text: String(th.meals), size: 15, cls: 'num ' + (th.meals ? 'good' : '') + (o.ate === i ? ' act' : '') });
      });
      y += 66;
      if (variant === 'seats') {
        const q = st.sem.seats.queue.map((i) => 'P' + i);
        items.push(...KS().sem({ prefix: 'se', x: narrow ? L.code.x + 4 : L.sem[0], y, name: 'seats', value: st.sem.seats.value, queue: q, act: o.semAct, perRow: narrow ? 5 : 7, nameW: 74 }).items);
        y += 54;
      }
      const ent = [{ cls: 's-new', text: 'thinking', round: true }, { cls: 's-ready', text: 'hungry', round: true }, { cls: 's-running', text: 'eating', round: true }, { cls: 's-blocked', text: 'waiting', round: true }];
      const arrows = [{ cls: '', line: true, text: 'waits for its neighbour’s fork' }, { cls: 'hot', line: true, text: 'a cycle of waits' }];
      if (narrow) {
        const ly = y + 4;
        items.push(...KS().legend({ prefix: 'lg', x: 12, y: ly, entries: ent, gap: 14 }).items);
        items.push(...KS().legend({ prefix: 'li', x: 12, y: ly + 28, entries: arrows.slice(0, 1) }).items);
        items.push(...KS().legend({ prefix: 'lj', x: 12, y: ly + 56, entries: arrows.slice(1).concat([{ cls: 'fork', text: 'a fork in a hand' }]), gap: 24 }).items);
      } else {
        items.push(...KS().legend({ prefix: 'lg', x: L.legend[0], y: L.legend[1], entries: ent.concat([{ cls: 'fork', text: 'a fork in a hand' }]), gap: 24 }).items);
        items.push(...KS().legend({ prefix: 'li', x: L.legend[0], y: L.legend[1] - 30, entries: arrows, gap: 28 }).items);
      }
      return items;
    }

    const st0 = Y().machine(spec).snap();
    const intro = variant === 'naive'
      ? `${n} philosophers sit round the table with ${n} forks, one between each pair. Each thinks, picks up the left fork, then the right, eats, and puts both down. The scheduler gives one step at a time, in turn: ${names} (the order seed ${T.seed} gives).`
      : variant === 'ordered'
        ? `${n} philosophers and ${n} forks again, but now P${n - 1} picks up its right fork (fork 0) before its left: every philosopher takes the lower-numbered fork first. Same scheduler, one step at a time in turn: ${names}.`
        : `${n} philosophers and ${n} forks again, but a semaphore seats starting at \`${n - 1}\` lets at most ${n - 1} sit at once; the rest wait to sit. Same scheduler, one step at a time in turn: ${names}.`;
    out.push({ items: picture(st0), say: intro, title: VNAME[variant], view: L.view });
    run.steps.forEach((s) => {
      const line = s.pc;
      out.push({ items: picture(s.state, { act: s.tid, line, semAct: s.op === 'wait' || s.op === 'post', ate: s.op === 'eat' ? s.tid : -1 }), say: s.say, title: s.op + ' · ' + s.name, view: L.view });
    });
    const end = run.end;
    if (variant === 'naive') {
      const last = run.steps[run.steps.length - 1].state;
      const cyc = end.cycle || [];
      out.push({ items: picture(last, { cycle: cyc, centre: ['deadlock', 'after ' + end.t + ' steps'], centreCls: 'verdict hot', hotLine: code.indexOf('lock(fork[i+1])') }), say: end.say + ` The pink arrows close the circle: ${cyc.map((c) => 'P' + c.tid).concat(['P' + (cyc[0] ? cyc[0].tid : 0)]).join(' → ')}.`, title: 'deadlock', view: L.view, hold: 4000 });
    } else {
      const lg = T.long, meals = lg.machine.threads.map((th) => th.meals), total = meals.reduce((a, b) => a + b, 0);
      const why = variant === 'ordered'
        ? 'forks are always taken lowest number first, so a circle of waits cannot close: whoever holds the highest fork it needs can always finish'
        : `with at most ${n - 1} seated, ${n} forks are shared among ${n - 1}, so one of them always gets both`;
      out.push({ items: picture(lg.machine.snap(), { up: true, random: true, centre: ['no deadlock', LONG + ' random steps'], centreCls: 'verdict good' }), say: `Run on for \`${LONG}\` steps with the scheduler now picking at random (seed ${T.seed}): no deadlock, ${lg.end.kind === 'limit' ? 'every philosopher still going' : lg.end.say}. Meals: ${meals.map((m, i) => 'P' + i + ' ' + m).join(', ')}, \`${total}\` in all. It works because ${why}.`, title: 'progress', view: L.view, hold: 4000 });
    }
    return out;
  }

  D.add({
    id: 'philosophers', order: 80, tag: 'Synchronisation · classic problems', short: 'Dining philosophers', title: 'Dining philosophers: the deadlock, and two ways out',
    blurb: 'Philosophers round a table share one fork with each neighbour and need both to eat. If all pick up the left fork first, a circle of waits can close; ordering the forks, or seating at most n − 1, breaks it.',
    knobs: [
      { id: 'n', label: 'philosophers', min: 3, max: 7, step: 1, value: 5, fmt: (v) => String(v) },
      { id: 'variant', label: 'rule', type: 'select', value: 0, options: VARIANTS.map((x, i) => ({ value: i, label: VNAME[x] })) },
      { id: 'seed', label: 'seed', min: 1, max: 20, step: 1, value: 1, fmt: (v) => String(v) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({ n: 5, variant: 0, seed: 1 }, knobs)); },
    trace,
  });
})(globalThis.Proses = globalThis.Proses || {});
