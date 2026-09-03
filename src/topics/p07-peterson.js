// Part 7, Peterson's algorithm: stepped under a seeded random scheduler (who goes in, who waits and why) and then
// proved by the model checker over every reachable state; and the same code on a machine that reorders memory
// operations: each thread's stores wait in a store buffer while its later loads go straight to memory, so both
// threads can read the other's flag as 0 and walk in together. The checker finds that schedule (with the flushes
// as steps of their own); a fence after the stores restores the algorithm.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;
  const REQ = (chk) => { const r = chk.res, me = !(r.safety.violation && r.safety.violation.kind === 'invariant'); return [{ name: 'mutual exclusion', ok: me }, { name: 'progress, no starvation', ok: r.safety.violation ? null : (r.liveness ? r.liveness.results.every((x) => x.holds) : null) }]; };

  H.topic({
    id: 'sync-peterson', family: 'p07-cs', order: 20, title: 'Peterson\'s algorithm',
    blurb: 'Each thread raises its flag to say it wants in, then gives the turn to the other, and waits only while the other wants in and has the turn. Whoever wrote turn last waits; if only one wants in, it walks straight in. Step it under a random scheduler, then let the model checker confirm it in every reachable state.',
    inputs: [
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 3, min: 1, max: 999 },
      { id: 'quantum', kind: 'number', label: 'Longest burst (steps)', def: 3, min: 1, max: 6 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 30, min: 10, max: 60 },
    ],
    presets: [
      { label: 'Seed 3', values: { seed: 3, quantum: 3, steps: 30 } },
      { label: 'Fine interleaving', values: { seed: 7, quantum: 1, steps: 30 } },
      { label: 'Long bursts', values: { seed: 11, quantum: 6, steps: 44 } },
      { label: 'A long run', values: { seed: 21, quantum: 2, steps: 60 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'entries', label: 'entries' }],
    run(inp) {
      const spec = Y().peterson('correct'), run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: inp.quantum, max: inp.steps });
      const F = new S.Frames(['step', 'entries']), st0 = Y().machine(spec).snap();
      const strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      const draw = (st, o) => H.duo(spec, st, Object.assign({ strip, upto: o.upto || 0, stripY: 300, req: o.req }, o));
      F.add({ items: draw(st0, {}), say: `Both threads loop for ever. Entry: raise my flag, set turn to the other, then wait while the other's flag is up and the turn is the other's. Exit: lower my flag. The scheduler picks a thread at random (seed ${inp.seed}) and lets it run a burst of 1 to ${inp.quantum} steps.`, meta: { vals: [inp.seed, inp.quantum] } });
      let entries = 0;
      run.steps.forEach((s, k) => {
        if (s.op === 'enter') entries++;
        F.set('step', k + 1).set('entries', entries);
        const nx = run.steps[k + 1], jt = nx && nx.op === 'jump' ? nx : null;
        let say = s.say;
        if (s.op === 'jump') {
          const r = s.state.threads[s.tid].reg, other = 1 - s.tid;
          say = s.taken ? `${s.name} sees flag[${other}] = \`${r.f}\` and turn = \`${r.t}\`: the other wants in and has the turn, so ${s.name} waits and tests again.` : `${s.name} sees flag[${other}] = \`${r.f}\` and turn = \`${r.t}\`: ${r.f ? 'the turn is ' + s.name + '\'s' : 'the other does not want in'}, so ${s.name} goes in.`;
        }
        F.add({ items: draw(s.state, { act: s.tid, line: s.pc, op: s.op, obj: s.obj, upto: k + 1 }), say, meta: { vals: H.nums(s.say).concat([k + 1, entries]), waitAsk: jt ? { name: jt.name, waits: !!jt.taken } : null } });
      });
      const chk = H.check(spec), req = REQ(chk);
      F.set('entries', entries);
      F.add({ items: draw(run.machine.snap(), { upto: run.steps.length, req }).concat(K7().verdict({ prefix: 'vd', x: 620, y: 300, w: 250, kind: 'ok', head: 'Correct in every schedule', lines: [chk.stats.states + ' states searched'] }).items), say: `This run made ${H.plural(entries, 'entry', 'entries')} without trouble, but one run proves nothing. The model checker visits all ${chk.stats.states} reachable states: never both inside, and in every fair schedule each thread enters again and again.`, meta: { vals: [entries, chk.stats.states] } });
      return { frames: F.list, def: H.def('Peterson\'s algorithm (thread i, other j)', ['flag[i] = 1        I want in', 'turn = j           you go first', 'while (flag[j] && turn == j)', '    ;              wait', '... critical section ...', 'flag[i] = 0        I am out', '', 'both want in: the last to write turn waits']) };
    },
    predict: [
      { at: (f) => !!(f.meta && f.meta.waitAsk), once: true, pick: 'option', ask: (fr, i) => fr[i].meta.waitAsk.name + ' is about to test its while condition. Will it wait or go in?', options: ['it waits', 'it goes in'], answer: (fr, i) => (fr[i].meta.waitAsk.waits ? 'it waits' : 'it goes in'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Both threads raise their flags; T0 writes turn = 1, then T1 writes turn = 0. Who enters?', options: ['T0', 'T1', 'neither', 'both'], answer: 0, why: 'turn ends at 0, given away last by T1, so T1 waits and T0 goes in.' },
      { q: 'Why is the flag not enough on its own?', options: ['both can raise their flags and wait for each other for ever', 'flags are slow', 'a flag cannot be 0', 'it is enough'], answer: 0, why: 'The turn breaks the tie when both want in.' },
      { q: 'How many times can T1 enter while T0 is waiting at its while loop?', options: ['at most once', 'never', 'any number', 'twice'], answer: 0, why: 'When T1 comes back it sets turn = 0 and then must wait for T0: bounded waiting.' },
      { q: 'Peterson\'s algorithm needs which hardware help?', options: ['none beyond loads and stores reaching memory in program order', 'test-and-set', 'compare-and-swap', 'interrupts disabled'], answer: 0, why: 'That ordering is the catch: many real machines do not give it without a fence.' },
    ],
  });

  H.topic({
    id: 'sync-peterson-tso', family: 'p07-cs', order: 30, title: 'When the machine reorders memory',
    blurb: 'Many processors let a store wait in a per-core store buffer while later loads go straight to memory. Then a thread can raise its flag, read the other\'s flag from memory before its own store has left the buffer, see 0 and walk in, while the other does exactly the same. Peterson\'s algorithm, correct on paper, fails. A fence drains the buffer first.',
    inputs: [{ id: 'variant', kind: 'choice', label: 'Machine', def: 'tso', options: [{ value: 'tso', label: 'store buffers, no fence' }, { value: 'tso-fence', label: 'store buffers, fence after the stores' }, { value: 'correct', label: 'stores reach memory at once' }] }],
    presets: [{ label: 'Store buffers', values: { variant: 'tso' } }, { label: 'With a fence', values: { variant: 'tso-fence' } }, { label: 'Sequentially consistent', values: { variant: 'correct' } }],
    counters: [{ id: 'states', label: 'states searched' }, { id: 'step', label: 'replay step' }],
    run(inp) {
      const spec = Y().peterson(inp.variant), sb = inp.variant !== 'correct', chk = H.check(spec, { maxStates: 400000 }), F = new S.Frames(['states', 'step']);
      const req = REQ(chk), v = H.verdictText(chk), M0 = Y().machine(spec), st0 = M0.snap(), cap = M0.sbCap;
      const vd = () => K7().verdict({ prefix: 'vd', x: 620, y: sb ? 386 : 300, w: 250, kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] }).items;
      const draw = (st, o) => H.duo(spec, st, Object.assign({ sb, stripY: 330, req, flushed: o.step && o.step.kind === 'flush' ? (o.step.say.match(/to (\w+(\[\d\])?)/) || [])[1] : null }, o));
      const about = { tso: `Each thread's stores go into its own store buffer (up to ${cap} entries) and reach memory only when a flush step of their own moves them; a thread reads its own buffered value, but the other thread still sees memory.`, 'tso-fence': 'Store buffers again, but a fence after the two stores waits until the buffer is empty before the loads.', correct: 'Here every store goes straight to memory, as the usual proof assumes: every write is seen by the other thread at once.' }[inp.variant];
      F.add({ items: draw(st0, {}), say: about, meta: { vals: [cap] } });
      F.set('states', chk.stats.states);
      F.add({ items: draw(st0, { strip: chk.sched ? H.stripSteps(spec, chk.sched) : null, upto: 0 }).concat(vd()), say: chk.res.safety.violation ? `The model checker searched ${chk.stats.states} states, flushes included as steps any time they may happen, and found a schedule of ${H.plural(chk.sched.length, 'step')} with both threads in the critical section.` : `The model checker searched all ${chk.stats.states} states, every flush at every moment it could happen: mutual exclusion holds, and both keep getting in.`, meta: { vals: [chk.stats.states].concat(chk.sched ? [chk.sched.length] : []) } });
      if (chk.steps) H.replay(F, spec, chk, (st, o) => { F.set('step', o.k + 1); return draw(st, o); });
      if (chk.res.safety.violation) {
        const last = chk.steps[chk.steps.length - 1].state, buffered = last.threads.map((t) => t.sb.length);
        F.add({ items: draw(last, { strip: H.stripSteps(spec, chk.sched), upto: chk.sched.length }).concat(vd()), say: `Both are inside. Each read the other's flag from memory while its own flag = 1 still sat in its store buffer (${buffered.map((b, i) => 'T' + i + ' holds ' + H.plural(b, 'buffered store')).join(', ')}). The fix is a fence (a full memory barrier) between the stores and the loads.`, meta: { vals: buffered } });
      }
      return { frames: F.list, def: H.def('A store buffer (per core)', ['store: into the buffer', 'load: own buffer first,', '  then memory', 'flush: the oldest buffered store', '  reaches memory, at any time', 'fence: wait until the buffer', '  is empty', 'TAS and CAS drain it too']) };
    },
    predict: [H.predictNext('Which thread acts next in the failing schedule (a flush counts as its own)?')],
    quiz: [
      { q: 'Why does a store buffer break Peterson\'s algorithm?', options: ['a later load can overtake an earlier store, so each sees the other\'s flag still 0', 'the buffer loses stores', 'turn is never written', 'it makes loads slower'], answer: 0, why: 'The algorithm needs "my flag is up" to be visible before "I read your flag".' },
      { q: 'What does a fence do here?', options: ['makes the thread\'s buffered stores reach memory before it goes on', 'stops the other thread', 'locks the bus for ever', 'clears the cache'], answer: 0, why: 'After the fence, the other thread can see the flag before this thread reads anything.' },
      { q: 'Can a thread read its own buffered store?', options: ['yes: it looks in its own buffer first', 'no: it always reads memory', 'only after a fence', 'only for turn'], answer: 0, why: 'Store-to-load forwarding: a single thread still sees its program order.' },
      { q: 'Why do real locks use atomic instructions rather than Peterson\'s algorithm?', options: ['they work for any number of threads and order memory without extra reasoning', 'Peterson is patented', 'loads are forbidden', 'they need no memory'], answer: 0, why: 'Atomic read-modify-write instructions also act as barriers on common machines.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
