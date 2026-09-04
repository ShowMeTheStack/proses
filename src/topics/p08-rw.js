// Part 8, readers and writers: any number may read at once, a writer needs the room alone. The three classic
// semaphore solutions (reader-preferring, writer-preferring, fair) and the reader–writer lock in each policy
// (S.Sync.readersWriters), drawn as a reading room with its door; then the starvation the first two allow, found by
// the liveness check (S.MC.live through S.P07.check) and replayed as a lasso: the way in, then the cycle for ever.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, Y = () => S.Sync, KSc = () => S.Kit.scenes, K7 = () => S.Kit.sync7;
  const VAR = { reader: 'reader-preferring', writer: 'writer-preferring', fair: 'fair (one line, in arrival order)', 'lock-reader': 'rwlock, readers first', 'lock-writer': 'rwlock, writers first', 'lock-fair': 'rwlock, in arrival order' };
  const opts = Object.entries(VAR).map(([value, label]) => ({ value, label }));

  /** where every thread is: in the room (and how), at the door (blocked), or away */
  function places(spec, st) {
    const inside = [], door = [], away = [];
    st.threads.forEach((th) => {
      const prog = spec.threads[th.id]._asm || Y().assemble(spec.threads[th.id].prog), w = spec.threads[th.id].role === 'writer';
      const a = prog.findIndex((o) => o.label === (w ? 'starts writing' : 'starts reading')), b = prog.findIndex((o) => o.label === (w ? 'stops writing' : 'stops reading'));
      const p = { id: th.id, name: th.name, mode: w ? 'w' : 'r' };
      if (th.pc > a && th.pc <= b) inside.push(p); else if (th.state === 'blocked') door.push(p); else away.push(p);
    });
    return { inside, door, away };
  }
  function picture(spec) {
    const vr = ['R', 'W', 'rc', 'wc'];
    return function (st, ctx) {
      ctx = ctx || {};
      const items = [], pl = places(spec, st), V = st.vars;
      // the door: shut while a writer holds the room or writers wait their turn; open to readers while readers hold it
      const L = st.rw.L, writerIn = V.W > 0 || (L && L.writer !== null), readersIn = V.R > 0 || V.rc > 0 || (L && L.readers.length > 0);
      const doorState = writerIn || V.wc > 0 ? 'shut' : readersIn ? 'readers' : 'open';
      items.push(...KSc().room({ prefix: 'rm', x: 230, y: 90, w: 244, h: 160, inside: pl.inside, door: pl.door, away: pl.away, act: ctx.act, doorState, title: 'the room', writing: V.W > 0, awayX: 220 }).items);
      items.push({ key: 'aw:t', kind: 'text', x: 0, y: 12, text: 'away from the room', size: 13, cls: 'title' });
      const s = ctx.step, lit = s ? s.obj : null;
      items.push(...H.objects('ob', 506, 4, spec, st, { lit, nameW: 96, perRow: 3 }).items);
      vr.forEach((n, i) => items.push(...K7().vars({ prefix: 'v' + n, x: i * 120, y: 278, rows: [{ name: n, value: V[n], act: lit === n, hot: n === 'W' && V.W > 0 && V.R > 0 }], nameW: 34, valW: 52, rowH: 34 }).items));
      items.push(...H.cards('th', 0, 342, spec, st, ctx.act, {}).items);
      return items;
    };
  }
  const vline = 'R, W: readers and writers in the room; rc, wc: their counts kept by the protocol';

  // ---- 1. the three policies, stepped ----------------------------------------------------------------------------
  S.P07.topic({
    id: 'classic-rw', family: 'p08-rw', order: 10, title: 'Readers and writers',
    blurb: 'Any number of readers may share the room, but a writer needs it alone. The first reader in locks writers out and the last one out lets them in. Who goes next when both wait is the policy: readers first, writers first, or plain arrival order. Watch the door: open, open to readers only, or shut.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Solution', def: 'reader', options: opts },
      { id: 'readers', kind: 'number', label: 'Readers', def: 2, min: 1, max: 3 },
      { id: 'writers', kind: 'number', label: 'Writers', def: 1, min: 1, max: 2 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 3, min: 1, max: 999 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 40, min: 10, max: 60 },
    ],
    presets: [
      { label: 'Readers first', values: { variant: 'reader', readers: 2, writers: 1, seed: 3, steps: 40 } },
      { label: 'Writers first', values: { variant: 'writer', readers: 2, writers: 1, seed: 6, steps: 40 } },
      { label: 'Fair: one line', values: { variant: 'fair', readers: 2, writers: 1, seed: 3, steps: 40 } },
      { label: 'An rwlock, three readers', values: { variant: 'lock-reader', readers: 3, writers: 1, seed: 8, steps: 40 } },
      { label: 'An rwlock in arrival order', values: { variant: 'lock-fair', readers: 2, writers: 2, seed: 4, steps: 36 } },
    ],
    counters: [{ id: 'reads', label: 'reads begun' }, { id: 'writes', label: 'writes begun' }],
    run(inp) {
      const spec = Y().readersWriters(inp.variant, inp.readers, inp.writers), F = new S.Frames(['reads', 'writes']), draw = picture(spec);
      const st0 = Y().machine(spec).snap();
      F.add({ items: draw(st0, {}), say: `${P7().plural(inp.readers, 'reader')} and ${P7().plural(inp.writers, 'writer')} loop for ever, ${VAR[inp.variant]}. ${spec.about} The scheduler picks a ready thread at random (seed ${inp.seed}).`, meta: { vals: [inp.readers, inp.writers, inp.seed], st: st0 } });
      let reads = 0, writes = 0;
      const run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 2, max: inp.steps });
      let prev = st0, clash = false;
      run.steps.forEach((s, k) => {
        if (s.label === 'starts reading') reads++;
        if (s.label === 'starts writing') writes++;
        if (s.state.vars.W > 0 && s.state.vars.R > 0) clash = true;
        F.set('reads', reads).set('writes', writes);
        const nx = run.steps[k + 1];
        F.add({ items: draw(s.state, { act: s.tid, step: s }), say: s.say, meta: { vals: [k + 1, reads, writes], st: s.state, prev, ask: nx && /^(wait|rlock|wlock)$/.test(nx.op) ? { who: nx.name, blocks: nx.kind === 'block' } : null } });
        prev = s.state;
      });
      const c = P7().check(spec), lv = c.res.liveness, bad = lv ? lv.results.filter((r) => !r.holds) : [];
      const last = run.machine.snap();
      const items = draw(last, {}).concat(K7().verdict({ prefix: 'vd', x: 506, y: 224, w: 290, kind: bad.length ? 'warn' : 'ok', head: bad.length ? 'Safe, but can starve' : 'Safe, and no one starves', lines: ['searched ' + c.stats.states + ' states', bad.length ? 'can wait for ever: ' + bad.map((r) => r.name.split(' ')[0]).join(', ') : 'everyone gets in eventually'] }).items);
      F.add({ items, say: `${P7().plural(reads, 'read')} and ${P7().plural(writes, 'write')} began in these \`${run.steps.length}\` steps, and ${clash ? 'a writer shared the room with a reader' : 'never did a writer share the room with anyone'}. The model checker confirms it for every schedule (\`${c.stats.states}\` states): no reader ever overlaps a writer. ${bad.length ? 'But the liveness check finds that ' + P7().list(bad.map((r) => r.name.split(' ')[0])) + ' can be kept out for ever: see [[classic-rw-starve]].' : 'And no thread can be kept out for ever.'}`, meta: { vals: [reads, writes, run.steps.length, c.stats.states], st: last } });
      return { frames: F.list, def: P7().def('Readers first (semaphores)', ['a reader:', 'wait(count_lock); rc++', 'if rc == 1: wait(room)', 'post(count_lock)', 'read', 'wait(count_lock); rc--', 'if rc == 0: post(room)', 'post(count_lock)', '', 'a writer:', 'wait(room); write; post(room)', '', vline]) };
    },
    predict: [
      { at: (f) => !!(f.meta && f.meta.ask), pick: 'option', once: true, ask: (fr, i) => `${fr[i].meta.ask.who} is about to ask to come in. Will it get in at once?`, options: ['yes, it goes on', 'no, it blocks'], answer: (fr, i) => (fr[i].meta.ask.blocks ? 'no, it blocks' : 'yes, it goes on'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does only the first reader wait on the semaphore room?', options: ['once one reader holds the room for all readers, the others may just come in', 'readers never need the room semaphore', 'to save a post', 'it is a bug'], answer: 0, why: 'rc counts the readers inside; the first locks writers out, the last lets them in.' },
      { q: 'In the reader-preferring solution, who can starve?', options: ['a writer, while readers keep overlapping', 'a reader', 'nobody', 'both'], answer: 0, why: 'As long as some reader is inside, new readers enter and rc never reaches 0.' },
      { q: 'What does the writer-preferring solution change?', options: ['a waiting writer shuts the door to new readers', 'writers may share the room', 'readers wait on room each time', 'there is no mutex'], answer: 0, why: 'door, held while writers wait, stops readers at the door.' },
      { q: 'How does the fair version avoid starvation?', options: ['everyone joins one line at the door, in arrival order', 'it lets writers in twice', 'readers sleep longer', 'it uses a spinlock'], answer: 0, why: 'A writer at the front of the line holds back the readers who came after it.' },
    ],
  });

  // ---- 2. starvation, as a lasso -------------------------------------------------------------------------------------
  S.P07.topic({
    id: 'classic-rw-starve', family: 'p08-rw', order: 20, title: 'Starvation made visible',
    blurb: 'Nothing deadlocks and every invariant holds, yet a thread may wait for ever: readers who keep overlapping never leave the room empty for a writer. A liveness check over every reachable state finds a lasso, a way in and then a cycle the others can repeat for ever while the starved thread never gets its turn, even under a fair scheduler.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Solution', def: 'reader', options: opts },
      { id: 'readers', kind: 'number', label: 'Readers', def: 2, min: 1, max: 2 },
      { id: 'writers', kind: 'number', label: 'Writers', def: 1, min: 1, max: 2 },
    ],
    presets: [
      { label: 'Readers starve a writer', values: { variant: 'reader', readers: 2, writers: 1 } },
      { label: 'Writers starve a reader', values: { variant: 'writer', readers: 1, writers: 2 } },
      { label: 'The rwlock, readers first', values: { variant: 'lock-reader', readers: 2, writers: 1 } },
      { label: 'Fair: nobody starves', values: { variant: 'fair', readers: 2, writers: 1 } },
    ],
    counters: [{ id: 'step', label: 'step of the schedule' }],
    run(inp) {
      const spec = Y().readersWriters(inp.variant, inp.readers, inp.writers), F = new S.Frames(['step']), draw = picture(spec);
      H.checkAndReplay(F, {
        spec, picture: draw, strip: { x: 0, y: 342 + H.cardsH(spec) + 20, w: 780, cw: 36 }, verdict: { x: 506, y: 224, w: 300 },
        intro: `${P7().plural(inp.readers, 'reader')} and ${P7().plural(inp.writers, 'writer')}, ${VAR[inp.variant]}. The property to check: every thread eventually gets into the room. ${spec.about}`,
        why: () => (spec.starves === 'writer' ? 'Each reader comes back in before the other leaves, so the room never empties and the semaphore room is never posted.' : spec.starves === 'reader' ? 'Writers keep the door shut by taking turns, so door is never free for the reader.' : ''),
      });
      return { frames: F.list, def: P7().def('A lasso', ['prefix: a finite way in', 'cycle: a loop that can repeat for ever', '  in which the starved thread never', '  takes its progress step', 'weak fairness: a thread that can run', '  all along the cycle must run in it,', '  so the lasso is no scheduler trick']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Can some thread be kept out of the room for ever?', options: ['yes, a writer', 'yes, a reader', 'no'], answer: (fr) => { const s = fr[1].say; return fr[1].meta.verdict !== 'warn' ? 'no' : /: fails/.test(s) && /\bW\d eventually/.test(s) ? 'yes, a writer' : 'yes, a reader'; }, explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'What makes starvation different from deadlock?', options: ['the system keeps making progress, just never for the starved thread', 'nothing moves', 'it only happens with spinlocks', 'an invariant breaks'], answer: 0, why: 'In a deadlock nobody moves; here others move for ever.' },
      { q: 'Why does a liveness counterexample need a cycle?', options: ['"for ever" is an infinite run, which a finite state space can only show as a loop', 'cycles are shorter', 'the checker cannot find paths', 'to save memory'], answer: 0, why: 'A finite-state program runs for ever only by repeating states.' },
      { q: 'Why assume weak fairness?', options: ['otherwise any thread could starve just by never being scheduled', 'it makes the search faster', 'real schedulers are unfair', 'it removes deadlocks'], answer: 0, why: 'A lasso must be possible under a scheduler that does not ignore a ready thread for ever.' },
      { q: 'Which fix stops readers from starving a writer?', options: ['a door that new readers must pass, held shut by a waiting writer', 'more readers', 'a longer read', 'a spinlock around reading'], answer: 0, why: 'The writer-preferring and fair versions both close the door to newcomers.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
