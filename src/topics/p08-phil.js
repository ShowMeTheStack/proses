// Part 8, dining philosophers: the deadlock the model checker finds when everyone picks up the left fork first,
// replayed round the table with its circle of waits; the three fixes (an order on the forks, an arbiter, n − 1
// seats) proved by the checker and then run; and the Chandy–Misra idea at a small scale (S.Sync.chandy): clean
// and dirty forks passed on request, which no circle of waits can block.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, KS = () => S.Kit.sync, K7 = () => S.Kit.sync7;
  const STATE = { thinking: 's-new', hungry: 's-ready', eating: 's-running', waiting: 's-blocked' };
  const VNAME = { naive: 'everyone left first', ordered: 'lowest fork first', arbiter: 'a waiter', seats: 'n − 1 seats' };

  function doing(spec, th) {
    if (th.state === 'blocked') return 'waiting';
    const prog = spec.threads[th.id]._asm || Y().assemble(spec.threads[th.id].prog), op = prog[th.pc] && prog[th.pc].op;
    if (op === 'think') return 'thinking';
    if (op === 'eat' || (op === 'unlock' && /down/.test(prog[th.pc].label)) || (op === 'post' && prog[th.pc].s === 'seats')) return 'eating';
    return 'hungry';
  }
  /** the table, the program with each philosopher's place, and the waiter or the seats */
  function picture(spec, n) {
    const R = n > 4 ? 150 : 130, cx = R + 50, cy = R + 40, codeX = 2 * R + 130;
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const items = [], forks = Array.from({ length: n }, (_, j) => st.mutex['f' + j].owner);
      const cyc = ctx.end && st.threads.every((t) => t.state === 'blocked') ? new Set(st.threads.map((t) => t.id)) : null, waits = [];
      for (const th of st.threads) if (th.state === 'blocked' && th.on.kind === 'mutex' && th.on.id[0] === 'f') { const h = st.mutex[th.on.id].owner; if (h !== null) waits.push({ from: th.id, to: h, cls: cyc && cyc.has(th.id) ? 'hot' : '' }); }
      const seats = st.threads.map((th) => ({ name: th.name, cls: STATE[doing(spec, th)] + (ctx.act === th.id ? ' act' : ''), }));
      items.push(...KS().table({ prefix: 'ph', cx, cy, R, r: 30, n, seats, forks, waits, tableR: R * 0.6, forkW: 40, forkH: 24, size: 15, forkIn: 0.75, bend: n === 2 ? 150 : undefined }).items);
      items.push({ key: 'ph:c', kind: 'text', x: cx, y: cy + 5, text: ctx.end && cyc ? 'deadlock' : 'step ' + st.t, anchor: 'middle', size: 15, cls: ctx.end && cyc ? 'verdict hot' : 'verdict' });
      const C = P7().code('pc', codeX, 4, spec, st, st.threads.map((t) => t.id), { act: ctx.act, line: ctx.step ? ctx.step.pc : undefined, lh: 28, size: 13, markW: 30, title: 'Philosopher i, for ever:', textW: 216 });
      items.push(...C.items);
      let y = 4 + C.h + 10;
      items.push({ key: 'ml:t', kind: 'text', x: codeX, y: y + 22, text: 'meals', size: 14, cls: 'strong' });
      st.threads.forEach((th, i) => items.push({ key: 'ml:v' + i, kind: 'cell', x: codeX + 56 + i * 54, y: y + 4, w: 50, h: 28, rx: 5, text: th.name + ' ' + th.meals, size: 13, cls: 'num' + (th.meals ? ' good' : '') }));
      y += 44;
      const extra = Object.keys(st.mutex).filter((k) => k === 'waiter').length + Object.keys(st.sem).length;
      if (extra) {
        const sub = { threads: spec.threads, mutexes: (spec.mutexes || []).filter((m) => m.id === 'waiter'), sems: spec.sems };
        const ob = H.objects('ob', codeX, y, sub, { threads: st.threads, mutex: st.mutex.waiter ? { waiter: st.mutex.waiter } : {}, sem: st.sem, cond: {}, barrier: {} }, { lit: ctx.step ? ctx.step.obj : null, nameW: 118 });
        items.push(...ob.items); y += ob.h;
      }
      return items;
    };
    draw.place = (rows) => ({ strip: { x: 0, y: 2 * R + 110, w: 780, cw: 36 }, verdict: { x: codeX, y: 4 + 28 + rows * 28 + 14 + 44 + (spec.sems.length + (spec.mutexes.some((m) => m.id === 'waiter') ? 1 : 0)) * 50, w: 300 } });
    return draw;
  }

  // ---- 1. the deadlock --------------------------------------------------------------------------------------------
  S.P07.topic({
    id: 'classic-phil-deadlock', family: 'p08-phil', order: 10, title: 'Dining philosophers: the deadlock',
    blurb: 'Philosophers round a table share one fork with each neighbour and need both to eat. Each picks up the left fork, then the right. Most of the time they eat in turn; but if all pick up their left forks before anyone takes a right one, each waits for a fork its neighbour will never put down. The model checker finds that schedule.',
    inputs: [{ id: 'n', kind: 'number', label: 'Philosophers', def: 3, min: 2, max: 5 }],
    presets: [{ label: 'Three at the table', values: { n: 3 } }, { label: 'Two', values: { n: 2 } }, { label: 'Four', values: { n: 4 } }, { label: 'Five', values: { n: 5 } }],
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const n = inp.n, spec = Y().philosophers(n, 'naive'), F = new S.Frames(['step']), draw = picture(spec, n);
      const lines = P7().lines(spec.threads[0]).length;
      H.checkAndReplay(F, {
        spec, ...draw.place(lines),
        picture: draw,
        intro: `${n} philosophers, ${n} forks: fork i lies between philosopher i and philosopher i + 1. Each thinks, picks up its left fork (fork i), then its right (fork i + 1, mod ${n}), eats, and puts both down, for ever.`,
        why: () => `Every philosopher holds one fork and waits for the next: hold and wait, no preemption, mutual exclusion and a circular wait, all four conditions at once.`,
      });
      return { frames: F.list, def: P7().def('Philosopher i', ['think()', 'lock(fork[i])        left', 'lock(fork[i+1 mod n]) right', 'eat()', 'unlock both', '', 'deadlock: all hold their left fork']) };
    },
    predict: [H.predictLast],
    quiz: [
      { q: 'How many steps does the shortest deadlocking schedule need with n philosophers?', options: ['one think and one left-fork pick-up each, then the right-fork tries: about 3n', 'n', '1', 'it depends on the seed only'], answer: 0, why: 'Each must think, take its left fork and try the right one.' },
      { q: 'Which of the four deadlock conditions is easiest to break here?', options: ['circular wait: order the forks', 'mutual exclusion: share forks', 'no preemption: snatch forks', 'hold and wait: never hold one fork'], answer: 0, why: 'Taking the lower-numbered fork first makes a circle impossible.' },
      { q: 'Why do most random runs not deadlock?', options: ['the deadlock needs every philosopher to grab the left fork before anyone gets a right one', 'philosophers are smart', 'the scheduler avoids it', 'forks are free'], answer: 0, why: 'It is one narrow family of schedules among many.' },
      { q: 'With two philosophers sharing two forks, can it deadlock?', options: ['yes: each holds one fork and wants the other', 'no, two is too few', 'only with three forks', 'only if one is slow'], answer: 0, why: 'The circle is just two long.' },
    ],
  });

  // ---- 2. the fixes ------------------------------------------------------------------------------------------------
  S.P07.topic({
    id: 'classic-phil-fixes', family: 'p08-phil', order: 20, title: 'Dining philosophers: three fixes',
    blurb: 'Break the circle of waits and the deadlock is gone. Take the lower-numbered fork first, so the last philosopher reaches across for fork 0 before fork n − 1. Or let a waiter allow one philosopher at a time to pick up forks. Or seat at most n − 1, so someone always gets two forks. The checker proves each one for every schedule, and checks that everyone eats eventually.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Fix', def: 'ordered', options: Object.entries(VNAME).map(([value, label]) => ({ value, label })) },
      { id: 'n', kind: 'number', label: 'Philosophers', def: 3, min: 2, max: 4 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 2, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Lowest fork first', values: { variant: 'ordered', n: 3, seed: 2 } },
      { label: 'A waiter', values: { variant: 'arbiter', n: 3, seed: 5 } },
      { label: 'n − 1 seats', values: { variant: 'seats', n: 3, seed: 7 } },
      { label: 'Four, lowest first', values: { variant: 'ordered', n: 4, seed: 3 } },
      { label: 'No fix', values: { variant: 'naive', n: 3, seed: 2 } },
    ],
    counters: [{ id: 'meals', label: 'meals eaten' }],
    run(inp) {
      const n = inp.n, spec = Y().philosophers(n, inp.variant), F = new S.Frames(['meals']), draw = picture(spec, n);
      const lines = P7().lines(spec.threads[0]).length, pl = draw.place(lines);
      const { c } = H.checkAndReplay(F, { spec, ...pl, picture: draw, intro: `${n} philosophers with the rule “${VNAME[inp.variant]}”. ${spec.about}` });
      if (c.res.verdict === 'ok') {
        const n0 = F.length;
        const run = H.randomRun(F, { spec, seed: inp.seed, steps: 30, picture: draw, lead: `Now a random schedule (seed ${inp.seed}): ` });
        const meals = run.machine.threads.map((t) => t.meals), tot = meals.reduce((a, b) => a + b, 0);
        F.list.forEach((f) => { const m = f.meta && f.meta.st ? f.meta.st.threads.reduce((a, t) => a + t.meals, 0) : 0; f.counters = { meals: m }; });
        F.add({ items: draw(run.machine.snap(), {}).concat(K7().verdict({ prefix: 'vd', ...pl.verdict, kind: 'ok', head: 'Correct in every schedule', lines: ['searched ' + c.stats.states + ' states', 'meals so far: ' + tot] }).items), say: `After \`${run.steps.length}\` random steps the philosophers have eaten \`${tot}\` meal${tot === 1 ? '' : 's'} (${meals.map((m, i) => 'P' + i + ' ' + m).join(', ')}). The checker's answer covers every schedule, not just this one: in all \`${c.stats.states}\` states nobody is stuck, and each philosopher eats again and again.`, meta: { vals: [run.steps.length, tot, ...meals, c.stats.states], st: run.machine.snap() }, counters: { meals: tot } });
      } else F.list.forEach((f, i) => { f.counters = { meals: f.meta.st.threads.reduce((a, t) => a + t.meals, 0) }; });
      return { frames: F.list, def: P7().def('The fixes', ['ordered: lock(min fork), then lock(max fork)', 'arbiter: lock(waiter) around both pick-ups', 'seats: wait(seats) first; seats starts at n − 1', 'each breaks the circular wait']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Will the checker find a deadlock?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'ok' ? 'no' : 'yes'), explain: (fr) => fr[1].say }, H.predictLast],
    quiz: [
      { q: 'Why does taking the lower-numbered fork first prevent deadlock?', options: ['a circle of waits would need someone to hold a higher fork while waiting for a lower one', 'it makes philosophers faster', 'it gives one philosopher two forks', 'it removes a fork'], answer: 0, why: 'With one global order every wait points up the order, so it cannot close a circle.' },
      { q: 'What does the waiter cost?', options: ['only one philosopher at a time may pick up forks, even far-apart ones', 'nothing', 'a deadlock', 'more forks'], answer: 0, why: 'A global lock serialises the pick-ups.' },
      { q: 'With n − 1 seats and n forks…', options: ['some seated philosopher can always get both forks', 'two can always eat', 'nobody can starve under any scheduler', 'the seats semaphore can deadlock'], answer: 0, why: 'By pigeonhole, n − 1 people with n forks: one has two.' },
      { q: 'No deadlock means no starvation?', options: ['no: a philosopher can still lose every race for a fork unless the locks are fair', 'yes, always', 'yes, with three or more', 'only with a waiter'], answer: 0, why: 'The checker checks both, under weak fairness.' },
    ],
  });

  // ---- 3. Chandy–Misra ------------------------------------------------------------------------------------------
  function chandyPicture(n) {
    const R = 140, cx = R + 150, cy = R + 60, sa = (i) => -Math.PI / 2 - (2 * Math.PI * i) / n;
    const seat = (i) => ({ x: Math.round(cx + R * Math.cos(sa(i))), y: Math.round(cy + R * Math.sin(sa(i))) });
    const mid = (f) => { let a = sa(f), b = sa((f + 1) % n); if (b > a) b -= 2 * Math.PI; return (a + b) / 2; };
    const SC = { thinking: 's-new', hungry: 's-ready', eating: 's-running' };
    return function (snap, ctx) {
      ctx = ctx || {};
      const items = [{ key: 'ch:table', kind: 'ellipse', x: cx, y: cy, rx: R * 0.55, ry: R * 0.55, cls: 'sync-table', layer: 'back', audit: 'ignore' }];
      snap.phil.forEach((p, i) => {
        const s = seat(i), lx = Math.round(cx + (R + 54) * Math.cos(sa(i))), ly = Math.round(cy + (R + 54) * Math.sin(sa(i)) + 5);
        items.push({ key: 'ch:s' + i, kind: 'state', x: s.x, y: s.y, r: 30, text: 'P' + i, size: 15, cls: 'phil ' + SC[p.state] + (ctx.act === i ? ' act' : '') });
        items.push({ key: 'ch:m' + i, kind: 'text', x: lx, y: ly, text: p.state + ', ' + p.meals + (p.meals === 1 ? ' meal' : ' meals'), anchor: Math.abs(Math.cos(sa(i))) < 0.3 ? 'middle' : Math.cos(sa(i)) > 0 ? 'start' : 'end', size: 13, cls: 'meals' });
      });
      snap.forks.forEach((f, j) => {
        // a fork lies by its holder, on the side of the neighbour it shares the fork with
        const other = f.holder === f.a ? f.b : f.a, step = ((other - f.holder + n) % n === 1) ? -1 : 1, d = R - 50, an = sa(f.holder) + step * 0.38;
        const fx = Math.round(cx + d * Math.cos(an)), fy = Math.round(cy + d * Math.sin(an)), asked = f.token === f.holder;
        items.push({ key: 'ch:f' + j, kind: 'cell', x: fx - 26, y: fy - 13, w: 52, h: 26, rx: 6, text: 'F' + j + (asked ? ' ?' : ''), size: 13, cls: 'fork fork8 ' + (f.dirty ? 'dirty' : 'clean') + (asked ? ' asked' : '') });
      });
      items.push(...KS().legend({ prefix: 'lg', x: 0, y: cy + R + 80, entries: [{ cls: 'fork8 clean', text: 'clean fork' }, { cls: 'fork8 dirty', text: 'dirty fork' }, { cls: 'fork8 asked', text: 'F ?: its token came, it is asked for' }], gap: 22 }).items);
      return items;
    };
  }
  S.P07.topic({
    id: 'classic-chandy', family: 'p08-phil', order: 30, title: 'Clean and dirty forks',
    blurb: 'Forks travel on request. Each fork is clean or dirty, and its request token sits with the neighbour who does not hold it. A hungry philosopher sends tokens for the forks it lacks; a holder gives up a dirty fork when asked, cleaning it on the way, but keeps a clean one while hungry. Eating dirties both forks, so a fork always goes to whoever waited longer. Started without a cycle of precedence, nobody deadlocks or starves.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Start', def: 'correct', options: [{ value: 'correct', label: 'dirty forks with the lower neighbour' }, { value: 'cyclic', label: 'everyone a clean left fork' }] },
      { id: 'n', kind: 'number', label: 'Philosophers', def: 3, min: 3, max: 4 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 1, min: 1, max: 999 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 24, min: 8, max: 40 },
    ],
    presets: [{ label: 'A proper start', values: { variant: 'correct', n: 3, seed: 1, steps: 24 } }, { label: 'Four, another seed', values: { variant: 'correct', n: 4, seed: 6, steps: 30 } }, { label: 'A cyclic start', values: { variant: 'cyclic', n: 3, seed: 1, steps: 24 } }],
    counters: [{ id: 'meals', label: 'meals eaten' }],
    run(inp) {
      const n = inp.n, sys0 = Y().chandy(n, inp.variant), draw = chandyPicture(n), F = new S.Frames(['meals']);
      const r = S.MC.verify(sys0), st = r.safety.stats.states;
      const sx = 2 * 140 + 266, verdict = (k, head, lines) => K7().verdict({ prefix: 'vd', x: sx, y: 30, w: 260, kind: k, head, lines }).items;
      const meals = (s) => s.phil.reduce((a, p) => a + p.meals, 0);
      const s0 = sys0.snap();
      F.add({ items: draw(s0, {}), say: `${n} philosophers; fork i lies between philosopher i and philosopher i + 1. ${sys0.spec.about} A fork is drawn by its holder, green when clean and dashed when dirty; a question mark on a fork means its request token has reached the holder: the neighbour is asking for it.`, meta: { vals: [n, meals(s0)], st: s0 } });
            F.add({ items: draw(s0, {}).concat(verdict(r.verdict === 'ok' ? 'ok' : 'bad', r.verdict === 'ok' ? 'Correct in every schedule' : 'Deadlock found', ['searched ' + st + ' states'].concat(r.safety.violation ? ['failing schedule: ' + r.safety.violation.schedule.length + ' steps'] : ['everyone hungry eats eventually']))), say: r.verdict === 'ok' ? `The model checker explores every order of every philosopher's moves: \`${st}\` states, no deadlock, neighbours never eat at once, and the liveness check finds that every hungry philosopher eats eventually.` : `The model checker finds a deadlock after searching \`${st}\` states: ${r.safety.violation.say} The shortest schedule has \`${r.safety.violation.schedule.length}\` steps; here it is.`, meta: { vals: [st].concat(r.safety.violation ? [r.safety.violation.schedule.length] : []), st: s0 } });
      let sched;
      if (r.safety.violation) sched = r.safety.violation.schedule;
      else { const rnd = Y().rng(inp.seed * 31 + n), s = sys0.clone(); sched = []; for (let k = 0; k < inp.steps && s.status() === 'running'; k++) { const cs = s.choices(), c = cs[Math.floor(rnd() * cs.length)]; s.step(c); sched.push(c); } }
      const sys = sys0.clone();
      sched.forEach((c, k) => {
        const step = sys.step(c), snap = sys.snap();
        F.add({ items: draw(snap, { act: step.tid }), say: step.say, meta: { vals: [k + 1, meals(snap), ...snap.phil.map((p) => p.meals)], st: snap, next: null }, counters: { meals: meals(snap) } });
      });
      const end = sys.snap();
      F.add({ items: draw(end, {}).concat(verdict(r.verdict === 'ok' ? 'ok' : 'bad', r.verdict === 'ok' ? meals(end) + ' meals in ' + sched.length + ' steps' : 'Deadlock', r.verdict === 'ok' ? ['no deadlock in ' + st + ' states'] : ['every philosopher hungry', 'each holding a clean fork'])), say: r.verdict === 'ok' ? `After \`${sched.length}\` steps (seed ${inp.seed}): ${P7().plural(meals(end), 'meal')} (${end.phil.map((p, i) => 'P' + i + ' ' + p.meals).join(', ')}). Dirty forks flow to whoever asks; the eater's forks turn dirty, so the next request takes them away.` : `Stuck after \`${sched.length}\` steps: everyone is hungry and holds a clean fork, which a hungry philosopher never gives up, and each one's request waits on the next. A cyclic start is exactly what the dirty-fork rule must avoid.`, meta: { vals: [sched.length, meals(end), st, ...end.phil.map((p) => p.meals)], st: end }, counters: { meals: meals(end) } });
      return { frames: F.list, def: P7().def('The rules', ['hungry: send the token for each missing fork', 'asked for a dirty fork: clean it, hand it over', 'asked for a clean fork: keep it (and the token)', 'eat with both forks; they become dirty', 'start: every fork dirty, with the', '  lower-numbered neighbour (no cycle)']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Will these philosophers ever deadlock?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.vals.length > 1 ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why give up a dirty fork but keep a clean one?', options: ['a clean fork was just handed over and its holder has not eaten yet: it has priority', 'clean forks are heavier', 'dirty forks are useless', 'to avoid messages'], answer: 0, why: 'Clean and dirty encode who waited longer for the fork.' },
      { q: 'What does the initial placement have to avoid?', options: ['a cycle in who has priority over whom', 'two forks with one philosopher', 'any dirty fork', 'tokens with holders'], answer: 0, why: 'All dirty with the lower-numbered neighbour gives an acyclic order.' },
      { q: 'What travels between neighbours?', options: ['forks and request tokens only', 'a global lock', 'every philosopher\'s state', 'a waiter'], answer: 0, why: 'It is fully local: suited to a distributed setting.' },
      { q: 'After eating, a philosopher\'s forks are…', options: ['dirty, so any neighbour who asks gets them', 'clean', 'returned to the centre', 'kept for the next meal'], answer: 0, why: 'Eating gives up priority.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
