// Part 8, more classic problems: the sleeping barber (S.Sync.barber: free_seats, arrivals, call_next and seat_lock),
// drawn as a salon with its seats, and the cigarette smokers (S.Sync.smokers), drawn as a table the agent puts
// ingredients on, with helper threads that note what has landed and wake the one smoker who can use it. The broken versions are found
// by the model checker and replayed; the correct ones are proved and then run under a seeded random scheduler.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, KSc = () => S.Kit.scenes;
  const ING = ['tobacco', 'paper', 'matches'];

  /** checked, then replayed when broken or run at random when correct */
  function checkThenRun(F, o) {
    const { c } = H.checkAndReplay(F, o);
    if (c.res.verdict === 'ok') {
      const n0 = F.length;
      H.randomRun(F, { spec: o.spec, seed: o.seed, steps: o.steps || 30, picture: o.picture, lead: `A random schedule (seed ${o.seed}) to watch it work: ` });
    }
    return c;
  }

  // ---- the salon ----------------------------------------------------------------------------------------------------
  function salonPicture(spec, seats) {
    const C = spec.threads[1]._asm || Y().assemble(spec.threads[1].prog), Hp = spec.threads[0]._asm || Y().assemble(spec.threads[0].prog);
    const iT = C.findIndex((o) => o.label === 'free_seats--'), iH = C.findIndex((o) => o.label === 'gets a haircut');
    const shopW = Math.max(360, 150 + seats * 64 + 30), ox = shopW + 40 + (spec.threads.length - 1) * 50 + 20;
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const seated = [], door = [], away = [];
      let inChair = null;
      st.threads.slice(1).forEach((th) => {
        const p = { id: th.id, name: th.name };
        if (th.pc === iH) inChair = p;
        else if (th.pc > iT && th.pc < iH) seated.push(p);
        else if (th.pc > iH) away.push(p);
        else door.push(Object.assign(p, { blocked: th.state === 'blocked' }));
      });
      const T = st.threads[0], mode = T.state === 'blocked' && T.on.id === 'arrivals' ? 'asleep' : Hp[T.pc] && Hp[T.pc].label === 'cuts hair' ? 'cutting' : 'busy';
      const items = KSc().shop({ prefix: 'sh', x: 0, y: 60, seats, seated, inChair, door, away, barber: mode, barberName: 'B', act: ctx.act }).items;
      items.push({ key: 'sh:aw', kind: 'text', x: shopW + 20, y: 72, text: 'outside', size: 13, cls: 'title' });
      items.push(...S.Kit.sync7.vars({ prefix: 'vw', x: 0, y: 300, rows: [{ name: 'free_seats', value: st.vars.free_seats, act: ctx.step && ctx.step.obj === 'free_seats', hot: st.vars.free_seats < 0 }], nameW: 96, valW: 52 }).items);
      items.push(...H.objects('ob', ox, 4, spec, st, { lit: ctx.step ? ctx.step.obj : null, nameW: 104, perRow: 3 }).items);
      items.push(...H.cards('th', 0, 360, spec, st, ctx.act, {}).items);
      return items;
    };
    draw.place = { strip: { x: 0, y: 360 + H.cardsH(spec) + 20, w: 780, cw: 36 }, verdict: { x: ox, y: 170, w: 300 } };
    return draw;
  }
  S.P07.topic({
    id: 'classic-barber', family: 'p08-more', order: 10, title: 'The sleeping barber',
    blurb: 'A barber naps until someone arrives. A customer who finds a free waiting seat takes it, posts arrivals and waits for call_next; one who finds no free seat leaves. Looking at free_seats and taking a seat must be one step, under seat_lock: without it two customers can both see the last seat and both take it.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Version', def: 'correct', options: [{ value: 'correct', label: 'seats taken under seat_lock' }, { value: 'no-mutex', label: 'without seat_lock' }] },
      { id: 'customers', kind: 'number', label: 'Customers', def: 2, min: 1, max: 3 },
      { id: 'seats', kind: 'number', label: 'Seats', def: 1, min: 1, max: 2 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 4, min: 1, max: 999 },
    ],
    check: (v) => (v.variant === 'correct' && v.customers === 3 && v.seats === 2 ? 'Three customers and two seats: too many states for a quick proof; try one seat' : null),
    presets: [
      { label: 'Two customers, one seat', values: { variant: 'correct', customers: 2, seats: 1, seed: 4 } },
      { label: 'Two customers, two seats', values: { variant: 'correct', customers: 2, seats: 2, seed: 9 } },
      { label: 'Without seat_lock', values: { variant: 'no-mutex', customers: 2, seats: 1, seed: 4 } },
      { label: 'Without seat_lock, three customers', values: { variant: 'no-mutex', customers: 3, seats: 1, seed: 4 } },
    ],
    counters: [{ id: 'cuts', label: 'haircuts' }, { id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const spec = Y().barber(inp.customers, inp.seats, { variant: inp.variant }), F = new S.Frames(['cuts', 'step']), draw = salonPicture(spec, inp.seats);
      checkThenRun(F, { spec, picture: draw, ...draw.place, seed: inp.seed, intro: `One barber, \`${inp.seats}\` waiting seat${inp.seats > 1 ? 's' : ''} and ${P7().plural(inp.customers, 'customer')} who keep coming back. free_seats counts the empty seats; arrivals tells the barber someone is seated; call_next calls one seated customer to the chair; seat_lock guards free_seats. ${spec.about}`, why: () => 'Both customers read free_seats before either took a seat: the look and the take were two steps.' });
      let cuts = 0;
      F.list.forEach((f) => { if (f.meta && f.meta.step && f.meta.step.label === 'cuts hair') cuts++; f.counters.cuts = cuts; });
      return { frames: F.list, def: P7().def('Barber and customer', ['barber, for ever:', '  wait(arrivals); wait(seat_lock)', '  free_seats++; post(call_next)', '  post(seat_lock); cut', '', 'customer:', '  wait(seat_lock)', '  if no seat is free: post(seat_lock); leave', '  free_seats--; post(arrivals)', '  post(seat_lock)', '  wait(call_next); haircut']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Can free_seats go below 0?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'bad' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why does the barber wait on arrivals rather than watch free_seats in a loop?', options: ['so it sleeps instead of spinning when nobody is there', 'free_seats is private', 'it cannot read variables', 'for fairness'], answer: 0, why: 'A semaphore wait blocks; a loop would burn the CPU.' },
      { q: 'What does wait(call_next) do for a customer?', options: ['it waits until the barber calls someone to the chair', 'it wakes the barber', 'it takes a seat', 'it releases seat_lock'], answer: 0, why: 'The barber posts call_next once per haircut.' },
      { q: 'Without seat_lock, what is the race?', options: ['two customers both read free_seats as 1, then both take a seat', 'two haircuts at once', 'customers leave too early', 'none'], answer: 0, why: 'A check-then-act on shared state needs to be atomic.' },
      { q: 'A customer who finds no free seat…', options: ['posts seat_lock and leaves, never blocking', 'waits at the door', 'wakes the barber', 'takes the chair'], answer: 0, why: 'Turning away keeps the queue no longer than the seats.' },
    ],
  });

  // ---- the cigarette smokers ---------------------------------------------------------------------------------------
  function smokePicture(spec) {
    const naive = spec.threads.filter((t) => t.role === 'helper').length === 0, sm = spec.threads.filter((t) => t.role === 'smoker');
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const table = ING.filter((g) => st.sem[g].value > 0);
      const smokers = sm.map((t, k) => {
        const id = spec.threads.indexOf(t), th = st.threads[id], first = ING[(k + 1) % 3], second = ING[(k + 2) % 3];
        let holds = [];
        if (naive) holds = th.pc === 1 ? [first] : th.pc === 2 || th.pc === 3 ? [first, second] : [];
        return { id, name: th.name, has: ING[k], holds, state: th.state };
      });
      const A = st.threads[0];
      const items = KSc().smokers({ prefix: 'sm', cx: 200, cy: 150, R: 112, table, smokers, agent: { id: 0, name: 'agent', state: A.state }, act: ctx.act }).items;
      // the agent's and the table's semaphores; with helpers, table_lock and the smokers' go semaphores in a second column
      const pick = (ids) => ({ threads: st.threads, mutex: {}, sem: Object.fromEntries(ids.map((k) => [k, st.sem[k]])), cond: {}, barrier: {} });
      const first = ['agent', ...ING], second = Object.keys(st.sem).filter((k) => !first.includes(k));
      items.push(...H.objects('ob', 386, 0, spec, pick(first), { lit: ctx.step ? ctx.step.obj : null, nameW: 86, perRow: 2, none: 'no queue' }).items);
      if (second.length) items.push(...H.objects('oc', 632, 0, spec, pick(second), { lit: ctx.step ? ctx.step.obj : null, nameW: 86, perRow: 1, none: 'no queue' }).items);
      items.push(...H.cards('th', 0, 370, spec, st, ctx.act, { maxW: 800 }).items);
      return items;
    };
    draw.place = { strip: { x: 0, y: 370 + H.cardsH(spec, 800) + 16, w: 800, cw: 36 }, verdict: { x: 386, y: 216, w: 300 } };
    return draw;
  }
  S.P07.topic({
    id: 'classic-smokers', family: 'p08-more', order: 20, title: 'The cigarette smokers',
    blurb: 'Three smokers each hold one ingredient for ever (tobacco, paper or matches) and need the other two. An agent puts two ingredients on the table and waits until someone has smoked. If each smoker simply takes its two missing ingredients one at a time, two smokers can each take one of the pair, and nobody can smoke. The fix: a helper thread per ingredient notes, under table_lock, what has landed; the helper who sees the second ingredient of a pair wakes the one smoker who holds the third.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Version', def: 'naive', options: [{ value: 'naive', label: 'each smoker takes one at a time' }, { value: 'helpers', label: 'helper threads decide' }] },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 2, min: 1, max: 999 },
    ],
    presets: [{ label: 'One at a time', values: { variant: 'naive', seed: 2 } }, { label: 'With helpers', values: { variant: 'helpers', seed: 2 } }],
    counters: [{ id: 'smoked', label: 'cigarettes smoked' }, { id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const spec = Y().smokers(inp.variant), F = new S.Frames(['smoked', 'step']), draw = smokePicture(spec);
      checkThenRun(F, { spec, picture: draw, ...draw.place, seed: inp.seed, steps: 22, intro: `The agent picks a pair (the checker tries all three), posts the two ingredient semaphores, and waits on agent until the smoker it served posts it back. ${spec.about}`, why: () => 'Each blocked smoker holds one ingredient another smoker needs, and the agent waits for a smoke that cannot happen.' });
      let n = 0;
      F.list.forEach((f) => { if (f.meta && f.meta.step && f.meta.step.label === 'takes them') n++; f.counters.smoked = n; });
      return { frames: F.list, def: P7().def('Two versions', ['agent: wait(agent); put a pair:', '  post its two ingredients', '', 'smoker k, one at a time:', '  wait(first missing); wait(second)', '  smoke; post(agent)', '', 'helper for ingredient j:', '  wait(j); wait(table_lock)', '  if one of the other two is noted:', '    clear it; post(go k) for the smoker', '    who holds the third', '  else note j in on_table', '  post(table_lock)']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'Can these smokers get stuck?', options: ['yes', 'no'], answer: (fr) => (fr[1].meta.verdict === 'bad' ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why does the naive version deadlock?', options: ['two smokers each take one ingredient of the pair and wait for one that never comes', 'the agent never posts', 'three ingredients is too many', 'semaphores lose posts'], answer: 0, why: 'Partial acquisition of a set, again: hold and wait.' },
      { q: 'What do the helpers add?', options: ['they wait until both ingredients are out before calling anyone, so only a smoker who can finish is called', 'more ingredients', 'a second agent', 'nothing'], answer: 0, why: 'The decision is made with the whole pair known, under one lock.' },
      { q: 'Paper lands first, then matches. Which smoker does the helper for matches wake?', options: ['the one who holds tobacco', 'the one who holds paper', 'the one who holds matches', 'nobody yet'], answer: 0, why: 'It finds paper noted on the table, clears it, and posts go for the smoker with the third ingredient.' },
      { q: 'Why can the agent not simply be changed?', options: ['the problem fixes the agent: the smokers must cope with whatever it puts out', 'it is a library', 'it has no code', 'it would deadlock'], answer: 0, why: 'That is what makes it a test of synchronisation, not of the agent.' },
      { q: 'How many choices of pair does the checker try?', options: ['all three, at every round', 'one', 'six', 'none'], answer: 0, why: 'The agent\'s choose step is part of the schedule.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
