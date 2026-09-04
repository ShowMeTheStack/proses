// Part 8, barriers: n threads that must all arrive before any goes on, drawn as lanes with a gate across them
// (S.Sync.barrierProblem: the barrier primitive; a reusable barrier from semaphores, count_lock with gate_even and
// gate_odd used in alternate rounds; and a count kept without a lock, which loses an arrival). Then boat crews
// (S.Sync.crews): two rowers and a cox must board one boat together, which needs the dock kept shut until the last
// of the three is aboard.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, KSc = () => S.Kit.scenes, K7 = () => S.Kit.sync7;
  const BV = { primitive: 'the barrier primitive', 'two-gates': 'two gates in alternate rounds', racy: 'a count without a lock' };

  function gatePicture(spec, n) {
    const lanesY = 40, laneH = 56, cardY = lanesY + n * laneH + 40;
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const V = st.vars, items = [];
      const lanes = st.threads.map((th, i) => {
        const at = th.state === 'done' ? 'past' : V.arrived[i] > V.passed[i] ? 'gate' : V.passed[i] > 0 ? 'past' : 'before';
        return { id: i, name: th.name, at, state: th.state, note: 'arrived ' + V.arrived[i] + ', passed ' + V.passed[i] };
      });
      // the gate is open while some thread is through it and has not yet marked its pass
      const open = st.threads.some((th, i) => { const o = (spec.threads[i]._asm || Y().assemble(spec.threads[i].prog))[th.pc]; return th.state === 'ready' && o && o.label === 'passes'; });
      items.push(...KSc().gate({ prefix: 'gt', x: 0, y: lanesY, w: 330, lanes, act: ctx.act, laneH, label: 'the barrier', open }).items);
      const ob = H.objects('ob', 520, 0, spec, st, { lit: ctx.step ? ctx.step.obj : null, nameW: 110, perRow: 3 });
      items.push(...ob.items);
      if (spec.sems.length) items.push(...K7().vars({ prefix: 'vc', x: 520, y: ob.h + 6, rows: [{ name: 'count', value: V.count, act: ctx.step && ctx.step.obj === 'count' }], nameW: 70, valW: 52 }).items);
      items.push(...H.cards('th', 0, cardY, spec, st, ctx.act, {}).items);
      return items;
    };
    const objH = ((spec.sems || []).length + (spec.barriers || []).length + (spec.mutexes || []).length) * 50 + (spec.sems.length ? 40 : 0);
    draw.place = { strip: { x: 0, y: cardY + H.cardsH(spec) + 20, w: 780, cw: 36 }, verdict: { x: 520, y: objH + 12, w: 290 } };
    return draw;
  }
  function checkThenRun(F, o) {
    const { c } = H.checkAndReplay(F, o);
    if (c.res.verdict === 'ok') { const n0 = F.length; H.randomRun(F, { spec: o.spec, seed: o.seed, steps: o.steps || 30, picture: o.picture, lead: `A random schedule (seed ${o.seed}) to watch it work: ` }); }
    return c;
  }

  S.P07.topic({
    id: 'classic-barrier', family: 'p08-more', order: 30, title: 'Barriers',
    blurb: 'A barrier holds every thread of a phase until the last one arrives, then lets them all through: the step between rounds of a parallel computation. Built by hand from semaphores it takes care. Count the arrivals under count_lock and let the last one open the gate for the others; and use two gates in turn, one for even rounds and one for odd, or a fast thread could slip through the same gate again into the next round.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Barrier', def: 'primitive', options: Object.entries(BV).map(([value, label]) => ({ value, label })) },
      { id: 'n', kind: 'number', label: 'Threads', def: 3, min: 2, max: 3 },
      { id: 'rounds', kind: 'number', label: 'Rounds', def: 2, min: 1, max: 2 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 3, min: 1, max: 999 },
    ],
        presets: [
      { label: 'The primitive, 3 threads', values: { variant: 'primitive', n: 3, rounds: 2, seed: 3 } },
      { label: 'Two gates, 2 threads', values: { variant: 'two-gates', n: 2, rounds: 2, seed: 5 } },
      { label: 'Two gates, 3 threads', values: { variant: 'two-gates', n: 3, rounds: 2, seed: 2 } },
      { label: 'A count without a lock', values: { variant: 'racy', n: 3, rounds: 1, seed: 3 } },
      { label: 'Without a lock, 2 threads', values: { variant: 'racy', n: 2, rounds: 1, seed: 3 } },
    ],
    counters: [{ id: 'passed', label: 'passes' }, { id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const rounds = inp.variant === 'racy' ? 1 : inp.rounds, spec = Y().barrierProblem(inp.n, inp.variant, rounds), F = new S.Frames(['passed', 'step']), draw = gatePicture(spec, inp.n);
      checkThenRun(F, { spec, picture: draw, ...draw.place, seed: inp.seed, steps: 36, intro: `${inp.n} threads, ${P7().plural(rounds, 'round')}: each marks its arrival, goes through ${BV[inp.variant]}, and marks that it passed. The invariant: nobody passes round r before every thread has arrived at round r. ${spec.about}`, why: () => 'Two threads read the same value of count, so it never reaches n: the last one in does not know it is last, and the gate is never opened.' });
      F.list.forEach((f) => { f.counters.passed = f.meta && f.meta.st ? f.meta.st.vars.passed.reduce((a, b) => a + b, 0) : 0; });
      return { frames: F.list, def: P7().def('Two gates in alternate rounds', ['wait(count_lock); count++', 'if count == n:', '  count = 0', '  post this round\'s gate n − 1 times', '  post(count_lock); go through', 'else:', '  post(count_lock)', '  wait(this round\'s gate)', 'even rounds: gate_even; odd: gate_odd']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Will every thread always get through?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'ok' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why alternate between two gates?', options: ['a fast thread could otherwise take a permit of this round\'s gate meant for a slower thread, in the next round', 'to count twice', 'for speed', 'it is not needed'], answer: 0, why: 'A reusable barrier must keep consecutive rounds apart.' },
      { q: 'What goes wrong when count is updated without a lock?', options: ['two arrivals can count as one, so here never reaches n and everyone waits', 'the barrier opens early', 'nothing', 'threads skip rounds'], answer: 0, why: 'It is the lost update of count++ again, now ending in a deadlock.' },
      { q: 'Who opens the gate?', options: ['the last thread to arrive', 'the first', 'the main thread', 'the scheduler'], answer: 0, why: 'Only it knows that count has reached n.' },
      { q: 'Why does the last one post the gate n − 1 times?', options: ['each of the other n − 1 threads takes one permit, and the last one goes straight through', 'semaphores need even numbers', 'to reset the count', 'one would be enough'], answer: 0, why: 'A semaphore permit is used up by each wait that passes.' },
    ],
  });

  // ---- boat crews -------------------------------------------------------------------------------------------------
  function crewPicture(spec) {
    const n = spec.threads.length, prog = (i) => spec.threads[i]._asm || Y().assemble(spec.threads[i].prog);
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const items = [{ key: 'wk:t', kind: 'text', x: 0, y: 14, text: 'rowers and coxes on the dock', size: 13, cls: 'title' }];
      st.threads.forEach((th, i) => {
        const ops = prog(i), li = ops.findIndex((o) => o.op === 'log'), aboard = th.pc > li || th.state === 'done';
        items.push({ key: 'wk:' + i, kind: 'state', x: 30 + i * 64, y: 50, r: 24, text: th.name, size: 14, cls: 'person ' + (aboard ? 's-done' : th.state === 'blocked' ? 's-blocked' : th.name[0] === 'X' ? 'p1' : 'p0') + (ctx.act === i ? ' act' : '') });
        items.push({ key: 'wk:s' + i, kind: 'text', x: 30 + i * 64, y: 92, text: aboard ? 'aboard' : th.state === 'blocked' ? 'waits' : 'dock', anchor: 'middle', size: 13, cls: 'tick' });
      });
      const b = st.vars.aboard;
      items.push({ key: 'cr:t', kind: 'text', x: 0, y: 136, text: 'boarding, in order (each three should be one boat: R, R and a cox C)', size: 13, cls: 'title' });
      for (let g = 0; g * 3 < Math.max(3, b.length); g++) {
        const grp = b.slice(g * 3, g * 3 + 3), bad = grp.length === 3 && grp.filter((x) => x === 'C').length !== 1;
        items.push({ key: 'cr:g' + g, kind: 'region', x: g * 150, y: 150, w: 138, h: 46, rx: 8, cls: bad ? 'hot' : 'frame', audit: 'group' });
        grp.forEach((x, j) => items.push({ key: 'cr:' + (g * 3 + j), kind: 'cell', x: g * 150 + 8 + j * 42, y: 158, w: 36, h: 30, rx: 6, text: x, size: 15, cls: 'gseg ' + (x === 'C' ? 'p1' : 'p0') }));
      }
      items.push(...H.objects('ob', 0, 220, spec, st, { lit: ctx.step ? ctx.step.obj : null, nameW: 100, perRow: 4 }).items);
      items.push(...K7().vars({ prefix: 'cv', x: 420, y: 220, rows: ['rowers', 'coxes', 'boarding'].map((k) => ({ name: k, value: st.vars[k] })), nameW: 90, valW: 50 }).items);
      return items;
    };
    const rows = spec.sems.length * 50;
    draw.place = { strip: { x: 0, y: 230 + rows + 10, w: Math.max(780, n * 64), cw: 36 }, verdict: { x: 570, y: 220, w: 270 } };
    return draw;
  }
  S.P07.topic({
    id: 'classic-crew', family: 'p08-more', order: 40, title: 'Crewing the boats',
    blurb: 'Rowers and coxes turn up at the dock one at a time; each boat leaves with two rowers and one cox. Under the dock semaphore every newcomer signs in, and the one who completes a crew calls two rowers and a cox aboard. If the dock is freed as soon as that call goes out, the next crew can be called while this one is still boarding, and people end up in the wrong boat. Keeping the dock shut until the last of the three is aboard fixes it.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Dock', def: 'early-release', options: [{ value: 'correct', label: 'shut until all three are aboard' }, { value: 'early-release', label: 'freed as soon as the crew is called' }] },
      { id: 'boats', kind: 'number', label: 'Boats', def: 2, min: 1, max: 2 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 4, min: 1, max: 999 },
    ],
    check: (v) => (v.variant === 'early-release' && v.boats < 2 ? 'Boats: the early release needs 2 boats to go wrong' : null),
    presets: [{ label: 'Freed too early', values: { variant: 'early-release', boats: 2, seed: 4 } }, { label: 'Shut until aboard', values: { variant: 'correct', boats: 2, seed: 4 } }, { label: 'One boat', values: { variant: 'correct', boats: 1, seed: 2 } }],
    counters: [{ id: 'aboard', label: 'people aboard' }, { id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const spec = Y().crews(inp.boats, inp.variant), F = new S.Frames(['aboard', 'step']), draw = crewPicture(spec);
      checkThenRun(F, { spec, picture: draw, ...draw.place, seed: inp.seed, steps: 36, opts: inp.variant === 'early-release' ? { minimal: false } : undefined, intro: `${P7().plural(inp.boats, 'boat')}: ${P7().plural(inp.boats, 'cox', 'coxes')} (X) and ${2 * inp.boats} rowers (R). Each takes dock, signs in (rowers and coxes count the people waiting), and the one who completes a crew posts call_rower twice and call_cox once; the others free dock and wait to be called. ${spec.about}`, why: () => 'The dock was freed while the first crew was still boarding, so a second crew was called and its people boarded in among the first.' });
      F.list.forEach((f) => { f.counters.aboard = f.meta && f.meta.st ? f.meta.st.vars.aboard.length : 0; });
      return { frames: F.list, def: P7().def('A rower or a cox', ['wait(dock); sign in', 'if a crew is complete:', '  post(call_rower) twice; post(call_cox)', '  keep dock (the early release frees it here)', 'else: post(dock)', 'wait(call_rower or call_cox); board', 'the last aboard: post(dock)']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Can people board the wrong boat?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'bad' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why keep the dock shut until the last of the three is aboard?', options: ['so no other crew can be called while this one is boarding', 'to count the rowers', 'semaphores need it', 'it does not need to be'], answer: 0, why: 'The dock fences off one crew at a time.' },
      { q: 'Who calls a crew aboard?', options: ['whoever signs in and completes it, rower or cox', 'always the cox', 'the first rower', 'a separate thread'], answer: 0, why: 'The newcomer who makes the count two and one sees the full crew first.' },
      { q: 'With the early release, the checker finds…', options: ['three boardings in a row that are not two rowers and a cox', 'a deadlock', 'nothing', 'starvation'], answer: 0, why: 'Boardings of two crews interleave.' },
      { q: 'With one boat only, does the early release matter?', options: ['no: there is no second crew to mix with', 'yes, always', 'only with two coxes', 'it deadlocks'], answer: 0, why: 'The bug needs a second crew.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
