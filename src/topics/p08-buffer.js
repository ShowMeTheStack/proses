// Part 8, the bounded buffer: producers and consumers on a ring of slots. With three semaphores, stepped under a
// seeded random scheduler; the two classic mistakes (no mutex, the waits swapped) found by the model checker and
// replayed; and the version with a mutex and condition variables, where testing with if instead of while, or
// sharing one condition variable, breaks it (S.Sync.buffer, S.Sync.cvBuffer, S.P07.check).
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, KS = () => S.Kit.sync, K7 = () => S.Kit.sync7;

  /** the ring, the synchronisation objects and the threads, from a snapshot */
  function bufferPicture(spec, N, o) {
    o = o || {};
    const R = 64 + 10 * N, cx = R + 64, cy = R + 60, ox = 2 * R + 160;
    const rows = (spec.mutexes || []).length + (spec.sems || []).length + (spec.conds || []).length, objH = rows * 50 + (o.vars ? o.vars.length * 34 + 10 : 0);
    const vY = 10 + objH + 8, cardY = Math.max(2 * R + 150, o.verdict ? vY + 130 : 0);
    const draw = function (st, ctx) {
      ctx = ctx || {};
      const items = [], V = st.vars, s = ctx.step;
      const touched = s && (s.op === 'write' || s.op === 'read') && s.obj === 'buf' ? (s.op === 'write' && s.label === 'buf[in] = item' ? ctx.prev.vars.in : ctx.prev.vars.out) : undefined;
      items.push(...KS().ring({ prefix: 'rg', cx, cy, R, cw: 56, ch: 34, slots: V.buf, inAt: V.in, outAt: V.out, act: touched, tagGap: 30 }).items);
      const full = V.buf.filter((x) => x !== null).length;
      items.push({ key: 'rg:count', kind: 'text', x: cx, y: cy + 6, text: full + ' of ' + N + ' full', anchor: 'middle', size: 15, cls: 'ringnote' });
      const lit = s && (s.op === 'wait' || s.op === 'post' || s.op === 'lock' || s.op === 'unlock' || s.op === 'cwait' || s.op === 'signal') ? s.obj : null;
      const ob = H.objects('ob', ox, 10, spec, st, { lit, perRow: 4 });
      items.push(...ob.items);
      const y = 10 + ob.h;
      if (o.vars) { items.push(...K7().vars({ prefix: 'vr', x: ox, y: y + 2, rows: o.vars.map((n) => ({ name: n, value: V[n], act: s && s.obj === n })), nameW: 82, valW: 56, rowH: 34 }).items); }
      items.push({ key: 'th:t', kind: 'text', x: 0, y: cardY - 14, text: 'the threads, coloured by state, with the step each takes next', size: 13, cls: 'title' });
      items.push(...H.cards('th', 0, cardY, spec, st, ctx.act, {}).items);
      return items;
    };
    draw.place = { strip: { x: 0, y: cardY + H.cardsH(spec) + 20, w: 780, cw: 36 }, verdict: { x: ox, y: vY, w: 320 } };
    return draw;
  }
  const bufVals = (st) => [st.vars.in, st.vars.out, st.vars.buf.filter((x) => x !== null).length];

  // ---- 1. semaphores, stepped ------------------------------------------------------------------------------------
  S.P07.topic({
    id: 'classic-buffer-sem', family: 'p08-buffer', order: 10, title: 'A bounded buffer with semaphores',
    blurb: 'Producers put items into a ring of N slots, consumers take them out in the same order. Three semaphores do all the work: empty counts free slots and stops a producer at a full ring, full counts filled slots and stops a consumer at an empty one, and mutex lets only one thread at a time touch the ring and its two indexes.',
    inputs: [
      { id: 'size', kind: 'number', label: 'Slots N', def: 3, min: 1, max: 6 },
      { id: 'producers', kind: 'number', label: 'Producers', def: 2, min: 1, max: 3 },
      { id: 'consumers', kind: 'number', label: 'Consumers', def: 1, min: 1, max: 3 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 4, min: 1, max: 999 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 36, min: 10, max: 60 },
    ],
    presets: [
      { label: 'Two producers, one consumer', values: { size: 3, producers: 2, consumers: 1, seed: 4, steps: 36 } },
      { label: 'One of each, 1 slot', values: { size: 1, producers: 1, consumers: 1, seed: 2, steps: 24 } },
      { label: 'A full ring stops producers', values: { size: 2, producers: 3, consumers: 1, seed: 9, steps: 40 } },
      { label: 'Six slots, three and three', values: { size: 6, producers: 3, consumers: 3, seed: 17, steps: 60 } },
    ],
    counters: [{ id: 'put', label: 'items put in' }, { id: 'taken', label: 'items taken out' }],
    run(inp) {
      const N = inp.size, spec = Y().buffer(N, inp.producers, inp.consumers), F = new S.Frames(['put', 'taken']);
      const draw = bufferPicture(spec, N);
      const st0 = Y().machine(spec).snap();
      F.add({ items: draw(st0, {}), say: `A ring of \`${N}\` slot${N > 1 ? 's' : ''}, ${P7().plural(inp.producers, 'producer')} and ${P7().plural(inp.consumers, 'consumer')}. empty starts at \`${N}\` (every slot free), full at \`0\`, mutex at \`1\`. Each step the scheduler picks a ready thread at random (seed ${inp.seed}) and lets it run a step or two.`, meta: { vals: [N, inp.producers, inp.consumers, inp.seed, 0, 1], st: st0 } });
      let put = 0, taken = 0;
      const run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 2, max: inp.steps });
      let prev = st0;
      run.steps.forEach((s, k) => {
        if (s.op === 'write' && s.label === 'buf[in] = item') put++;
        if (s.op === 'read' && s.obj === 'buf') taken++;
        F.set('put', put).set('taken', taken);
        const nx = run.steps[k + 1];
        const ask = nx && nx.op === 'wait' && (nx.obj === 'empty' || nx.obj === 'full') ? { who: nx.name, sem: nx.obj, value: s.state.sem[nx.obj].value, blocks: nx.kind === 'block' } : null;
        F.add({ items: draw(s.state, { act: s.tid, step: s, prev }), say: s.say, meta: { vals: [k + 1, put, taken, ...bufVals(s.state), ...bufVals(prev)], st: s.state, prev, ask } });
        prev = s.state;
      });
      const last = run.machine.snap(), e = last.sem.empty.value, f = last.sem.full.value;
      const between = N - e - f;
      F.add({ items: draw(last, {}), say: `After \`${run.steps.length}\` steps: \`${put}\` items put in and \`${taken}\` taken out, in the order they went in. empty + full = \`${e}\` + \`${f}\` = \`${e + f}\`; the other \`${between}\` of the ${P7().plural(N, 'slot')} belong to threads between a wait and its matching post. ${run.end.say}`, meta: { vals: [run.steps.length, put, taken, e, f, e + f, between, N, run.end.t], st: last } });
      return { frames: F.list, def: P7().def('The semaphore solution', ['a producer:', 'wait(empty); wait(mutex)', 'buf[in] = item; in = (in+1) % N', 'post(mutex); post(full)', '', 'a consumer:', 'wait(full); wait(mutex)', 'item = buf[out]; out = (out+1) % N', 'post(mutex); post(empty)', '', 'empty + full + threads in between = N']) };
    },
    predict: [
      { at: (f) => !!(f.meta && f.meta.ask), pick: 'option', once: true, ask: (fr, i) => `${fr[i].meta.ask.who} is about to wait on ${fr[i].meta.ask.sem}, whose value is ${fr[i].meta.ask.value}. What happens?`, options: ['it goes on', 'it blocks'], answer: (fr, i) => (fr[i].meta.ask.blocks ? 'it blocks' : 'it goes on'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'What does the value of empty count?', options: ['free slots not yet claimed by a producer', 'items in the ring', 'waiting consumers', 'the index of the next free slot'], answer: 0, why: 'It starts at N; each producer takes one before writing, each consumer gives one back after taking.' },
      { q: 'A consumer finds full = 0. What does wait(full) do?', options: ['it blocks until a producer posts full', 'it returns an empty slot', 'it spins', 'it posts empty'], answer: 0, why: 'A semaphore at 0 puts the waiter to sleep in its queue.' },
      { q: 'With one producer and one consumer, is mutex still needed?', options: ['not strictly: they touch different indexes, but with more of either it is', 'yes, always, or items are lost', 'no, never', 'only when N = 1'], answer: 0, why: 'A single producer owns in and a single consumer owns out; two producers share in.' },
      { q: 'Why must wait(empty) come before wait(mutex) in the producer?', options: ['otherwise a producer can sleep on a full ring while holding mutex, and no consumer can get in', 'it is faster', 'semaphores must be taken in alphabetical order', 'it does not matter'], answer: 0, why: 'Sleeping while holding the mutex blocks the very thread that would wake you.' },
    ],
  });

  // ---- 2. the broken versions, found by the checker ---------------------------------------------------------------
  const BROKEN = { 'no-mutex': 'no mutex', swapped: 'waits swapped', sem: 'correct' };
  S.P07.topic({
    id: 'classic-buffer-broken', family: 'p08-buffer', order: 20, title: 'Two ways to break the buffer',
    blurb: 'Drop the mutex and two producers can both write the same slot before either moves in: an item is lost. Take the mutex before waiting for a free slot and a producer can fall asleep on a full ring holding the mutex, so no consumer can get in to free one: a deadlock. The model checker tries every schedule and hands back the shortest one that fails.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Version', def: 'no-mutex', options: Object.entries(BROKEN).map(([value, label]) => ({ value, label })) },
      { id: 'size', kind: 'number', label: 'Slots N', def: 2, min: 1, max: 3 },
      { id: 'producers', kind: 'number', label: 'Producers', def: 2, min: 1, max: 2 },
      { id: 'consumers', kind: 'number', label: 'Consumers', def: 2, min: 1, max: 2 },
    ],
    presets: [
      { label: 'No mutex', values: { variant: 'no-mutex', size: 2, producers: 2, consumers: 2 } },
      { label: 'Waits swapped', values: { variant: 'swapped', size: 2, producers: 2, consumers: 2 } },
      { label: 'Swapped, one slot', values: { variant: 'swapped', size: 1, producers: 1, consumers: 1 } },
      { label: 'The correct one', values: { variant: 'sem', size: 1, producers: 2, consumers: 1 } },
    ],
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const N = inp.size, spec = Y().buffer(N, inp.producers, inp.consumers, { check: true, variant: inp.variant }), F = new S.Frames(['step']);
      const draw = bufferPicture(spec, N, { verdict: true });
      const picture = (st, ctx) => draw(st, ctx);
      const { c } = H.checkAndReplay(F, {
        spec, picture, ...draw.place,
        intro: `Version: ${BROKEN[inp.variant]}. ${spec.about} Each producer asserts that the slot it writes is empty, and each consumer that the item it takes is real; a deadlock counts as a failure too.`,
        why: () => (inp.variant === 'no-mutex' ? 'Two producers passed wait(empty) and both reached the slot at in before either moved in: the second would write over the first item.' : inp.variant === 'swapped' ? 'A producer holds mutex while it sleeps on empty; the consumers that would post empty are queued behind it on mutex.' : ''),
      });
      if (c.res.verdict === 'ok') { const n0 = F.length; H.randomRun(F, { spec, seed: 5, steps: 20, picture, lead: 'A random schedule (seed 5) to watch it work: ' }); }
      return { frames: F.list, def: P7().def(inp.variant === 'swapped' ? 'The swapped producer' : inp.variant === 'no-mutex' ? 'The producer without mutex' : 'The correct producer', inp.variant === 'swapped' ? ['wait(mutex)     ← taken first', 'wait(empty)     ← may sleep here,', '                  holding mutex', 'buf[in] = item', 'in = (in+1) % N', 'post(mutex)', 'post(full)'] : inp.variant === 'no-mutex' ? ['wait(empty)', 'buf[in] = item    ← two producers', 'in = (in+1) % N     can both be here', 'post(full)'] : ['wait(empty)', 'wait(mutex)', 'buf[in] = item', 'in = (in+1) % N', 'post(mutex)', 'post(full)']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'What will the checker report?', options: ['a lost item (an assertion)', 'a deadlock', 'nothing wrong'], answer: (fr) => ({ bad: fr[1].meta.verdict === 'bad' ? (fr[1].say.includes('Deadlock') || fr[1].say.includes('deadlock') ? 'a deadlock' : 'a lost item (an assertion)') : 'nothing wrong', ok: 'nothing wrong', warn: 'nothing wrong' })[fr[1].meta.verdict], explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Without mutex, what goes wrong first with two producers?', options: ['both write the slot at in before either moves in', 'empty goes negative', 'a consumer deadlocks', 'full overflows'], answer: 0, why: 'empty only limits how many may enter, not that they enter one at a time.' },
      { q: 'In the swapped version, who would free a slot?', options: ['a consumer, which is stuck waiting for mutex', 'the producer itself', 'the scheduler', 'nobody needs to'], answer: 0, why: 'The sleeping producer holds the mutex every consumer needs.' },
      { q: 'Why does the checker give the shortest failing schedule?', options: ['a short replay is easier to understand and has fewer irrelevant steps', 'longer ones do not exist', 'it is random', 'to save memory'], answer: 0, why: 'A breadth-first search finds a failure at the smallest depth.' },
      { q: 'Could 100 random test runs miss the deadlock?', options: ['yes: it needs the ring full and a particular order', 'no, deadlocks always show at once', 'no, random runs try every order', 'only on one core'], answer: 0, why: 'Testing samples schedules; the checker covers them all.' },
    ],
  });

  // ---- 3. mutex and condition variables ---------------------------------------------------------------------------
  const CV = { 'while-1': 'while, one consumer', while: 'while, two consumers', if: 'if (Mesa)', 'if-hoare': 'if (Hoare)', 'one-cv': 'one condition variable' };
  S.P07.topic({
    id: 'classic-buffer-cv', family: 'p08-buffer', order: 30, title: 'The buffer with a mutex and condition variables',
    blurb: 'A mutex guards the ring and a count; a producer waits on notFull while the ring is full, a consumer on notEmpty while it is empty, and each signals the other after its change. Test the condition with while and it works; with if, a woken consumer can find the item already taken by another; with one condition for both kinds, a signal can wake the wrong kind and everyone ends up asleep.',
    inputs: [{ id: 'variant', kind: 'choice', label: 'Version', def: 'if', options: Object.entries(CV).map(([value, label]) => ({ value, label })) }],
    presets: Object.entries(CV).map(([v, label]) => ({ label: H8label(label), values: { variant: v } })),
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const v = inp.variant, base = v.startsWith('while') ? 'while' : v.startsWith('if') ? 'if' : 'one-cv';
      const spec = Y().cvBuffer(1, v === 'one-cv' ? 2 : 1, v === 'while-1' ? 1 : 2, { variant: base, hoare: v === 'if-hoare' });
      const F = new S.Frames(['step']), draw = bufferPicture(spec, 1, { vars: ['count'], verdict: true });
      const { c } = H.checkAndReplay(F, {
        spec, picture: draw, ...draw.place,
        intro: `A ring of \`1\` slot, ${P7().plural(spec.threads.filter((t) => t.name[0] === 'P').length, 'producer')}, ${P7().plural(spec.threads.filter((t) => t.name[0] === 'C').length, 'consumer')}, one mutex m and ${base === 'one-cv' ? 'one condition variable cv for both' : 'two condition variables, notFull and notEmpty'}; ${spec.hoare ? 'Hoare semantics: a signal hands the mutex straight to the woken thread' : 'Mesa semantics: a woken thread must take the mutex again, and others may get there first'}. ${spec.about}`,
        why: () => (base === 'if' ? 'The consumer was woken when the slot was full, but another consumer took the mutex first and emptied it; testing with if, the woken one never looked again.' : base === 'one-cv' ? 'A consumer\'s signal meant for a producer woke another consumer instead, which went back to sleep: the wake-up was spent and no one is left awake to signal.' : 'Under Mesa the woken consumer queues for the mutex, and the other consumer can take every item ahead of it, again and again.'),
      });
      if (c.res.verdict === 'ok') {
        const n0 = F.length;
        H.randomRun(F, { spec, seed: 3, steps: 24, picture: draw, lead: 'A random schedule (seed 3) to watch it work: ' });
      }
      return { frames: F.list, def: P7().def('A consumer', ['lock(m)', base === 'if' ? 'if (count == 0)' : 'while (count == 0)', base === 'one-cv' ? '    wait(cv, m)' : '    wait(notEmpty, m)', 'item = buf[out]; out = (out+1) % N', 'count--', base === 'one-cv' ? 'signal(cv)' : 'signal(notFull)', 'unlock(m)', '', 'Mesa: after waking, test again']) };
    },
    predict: [H.predictLast, { at: (f, i) => i === 0, pick: 'option', ask: 'What will the checker find?', options: ['an assertion fails', 'a deadlock', 'a thread can starve', 'nothing wrong'], answer: (fr) => { const s = fr[1].say, k = fr[1].meta.verdict; return k === 'ok' ? 'nothing wrong' : k === 'warn' ? 'a thread can starve' : /eadlock/.test(s) ? 'a deadlock' : 'an assertion fails'; }, explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why must a Mesa condition wait sit in a while loop?', options: ['by the time the woken thread holds the mutex again, the condition may be false again', 'a wait can only be called in a loop', 'to spin while waiting', 'signals are counted'], answer: 0, why: 'A signal is a hint that the condition was true at some moment.' },
      { q: 'What does wait(c, m) do with the mutex?', options: ['releases it and sleeps in one step, then takes it back before returning', 'keeps it while sleeping', 'releases it for good', 'nothing'], answer: 0, why: 'Atomic release-and-sleep is what makes the test-then-wait safe.' },
      { q: 'Why is one condition variable for both producers and consumers risky with signal?', options: ['a signal may wake a thread of the same kind, which cannot use it', 'it uses more memory', 'producers cannot wait on it', 'broadcast stops working'], answer: 0, why: 'With one queue, the signal can land on the wrong kind of waiter; broadcast or two conditions fix it.' },
      { q: 'With Hoare semantics, is if enough?', options: ['yes: the signaller hands the monitor over, so the condition is still true when the waiter runs', 'no, never', 'only with one consumer', 'only with broadcast'], answer: 0, why: 'Nothing can run between the signal and the woken thread.' },
    ],
  });
  function H8label(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
})(globalThis.Proses = globalThis.Proses || {});
