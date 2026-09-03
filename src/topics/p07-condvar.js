// Part 7, condition variables and monitors. A condition variable is a queue of sleepers, always used with a mutex
// and a test of shared state: wait releases the mutex and sleeps in one step; signal moves one sleeper back to the
// mutex, broadcast moves them all. Two rules come out of the model checker's counterexamples: wake everyone a change
// may concern (a signal can leave the others asleep for ever), and test again in a while loop after waking (with
// Mesa semantics someone may get there first). A monitor packages the mutex, the conditions and the procedures; with
// Hoare semantics the signaller hands the monitor straight to the woken thread, and one test is enough.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;

  /** gate: n waiters wait for open; tickets: n consumers take a ticket each from a producer's two */
  function cvSpec(scn, wake, test, n) {
    const back = test === 'while' ? 'chk' : 'go', threads = [];
    const waitLoop = (v, ok, what) => [{ op: 'lock', m: 'm', label: 'lock(m)' }, { label: 'chk' }, { op: 'read', v, into: 'x', label: 'x = ' + v }, { op: 'jump', to: 'go', if: ok, label: test + ' (' + what + ')' }, { op: 'cwait', c: 'c', m: 'm', label: 'wait(c, m)' }, { op: 'jump', to: back, label: test === 'while' ? 'test again' : 'go on' }, { label: 'go' }];
    const wakeOp = { op: wake, c: 'c', label: wake + '(c)' };
    if (scn === 'gate') {
      for (let i = 0; i < n; i++) threads.push({ name: 'W' + (i + 1), prog: [...waitLoop('open', (r) => r.x === 1, '!open'), { op: 'work', label: 'passes the gate', mark: 'progress' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }] });
      threads.push({ name: 'O', prog: [{ op: 'work', label: 'gets ready' }, { op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'write', v: 'open', val: 1, label: 'open = 1' }, wakeOp, { op: 'unlock', m: 'm', label: 'unlock(m)' }] });
    } else {
      for (let i = 0; i < n; i++) threads.push({ name: 'C' + (i + 1), prog: [...waitLoop('tickets', (r) => r.x > 0, 'tickets == 0'), { op: 'update', v: 'tickets', by: -1, label: 'tickets--', mark: 'progress' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }] });
      const one = [{ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'update', v: 'tickets', by: 1, label: 'tickets++' }, wakeOp, { op: 'unlock', m: 'm', label: 'unlock(m)' }];
      threads.push({ name: 'P', prog: Array.from({ length: n }, () => one).flat() });
    }
    const spec = { threads, mutexes: [{ id: 'm', name: 'm' }], conds: [{ id: 'c', name: 'c' }], vars: scn === 'gate' ? { open: 0 } : { tickets: 0 }, symmetry: [Array.from({ length: n }, (_, i) => i)] };
    spec.check = { invariants: scn === 'gate' ? [] : [{ name: 'tickets never below 0', holds: (M) => M.vars.tickets >= 0 }], liveness: [], deadlock: true };
    return spec;
  }

  /** the picture of a program with a mutex and conditions: listings, objects, variables, threads, schedule */
  function scene(spec, st, o, kinds) {
    const items = [];
    let x = 0;
    kinds.forEach((tids, k) => {
      items.push(...H.code('cd' + k, x, 0, spec, st, tids, { act: o.act, line: o.line, textW: k ? 160 : 210, size: 13, lh: 26, markW: 30, title: tids.map((i) => st.threads[i].name).join(', ') + (tids.length > 1 ? ' each run:' : ' runs:') }).items);
      x += (k ? 160 : 210) + 8 + Math.max(1, tids.length) * 33 + 18;
    });
    const rx = Math.max(x, 470);
    items.push(...H.objects('ob', rx, 10, spec, st, { lit: o.obj }).items);
    const vars = Object.keys(st.vars);
    const oy = 10 + 50 * (Object.keys(st.mutex).length + Object.keys(st.cond).length);
    items.push(...K7().vars({ prefix: 'vr', x: rx, y: oy, rows: vars.map((v) => ({ name: v, value: H.show(st.vars[v]), act: o.obj === v && o.op !== 'read', hot: o.hotVar === v })), nameW: 76, valW: 50 }).items);
    items.push(...K7().threads({ prefix: 'th', x: rx, y: oy + vars.length * 34 + 22, threads: H.cards(spec, st, o.act, { sub: (th) => (th.state === 'done' ? 'done' : th.state === 'blocked' ? (th.on.kind === 'cond' ? 'on ' + th.on.id : 'wants ' + th.on.id) : 'ready') }), w: 64, h: 30, gap: 18 }).items);
    if (o.strip) items.push(...K7().strip({ prefix: 'sc', x: 0, y: o.stripY, w: 560, steps: o.strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 14, title: 'the schedule' }).items);
    if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: rx, y: oy + vars.length * 34 + 96, w: 270 }, o.verdict)).items);
    return items;
  }
  H.cvScene = scene;
  H.cvSpec = cvSpec;

  /** frames: the setup, the checker's verdict, then its counterexample replayed (or, when correct, a random run) */
  function checkedFrames(F, spec, kinds, intro, o) {
    const chk = H.check(spec), v = H.verdictText(chk), st0 = Y().machine(spec).snap();
    const progLen = Math.max(...kinds.map((t) => H.lines(spec.threads[t[0]]).length));
    const stripY = progLen * 26 + 50;
    F.add({ items: scene(spec, st0, { stripY }, kinds), say: intro, meta: { vals: o.vals || [] } });
    F.set('states', chk.stats.states);
    let run = null;
    if (!chk.steps) run = Y().run(spec, { policy: 'random', seed: o.seed || 1, quantum: 2, max: 80 });
    const sched = chk.sched || run.steps.map((s) => s.tid), strip = H.stripSteps(spec, sched);
    const vd = { kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] };
    F.add({ items: scene(spec, st0, { stripY, strip, upto: 0, verdict: vd }, kinds), say: chk.steps ? `The model checker searched ${chk.stats.states} states and found a schedule of ${H.plural(chk.sched.length, 'step')} that ${chk.res.safety.violation.kind === 'deadlock' ? 'leaves threads asleep with nobody left to wake them' : 'breaks "' + chk.res.safety.violation.name + '"'}. Watch it.` : `The model checker searched all ${chk.stats.states} states: no stuck thread${spec.check.invariants.length ? ' and "' + spec.check.invariants[0].name + '" always holds' : ''}. Here is one run, picked at random (seed ${o.seed || 1}).`, meta: { vals: [chk.stats.states, o.seed || 1].concat(chk.sched ? [chk.sched.length] : []) } });
    if (chk.steps) H.replay(F, spec, chk, (st, q) => { F.set('step', q.k + 1); return scene(spec, st, Object.assign({}, q, { stripY, hotVar: q.k === chk.steps.length - 1 && chk.res.safety.violation.kind === 'invariant' ? Object.keys(st.vars)[0] : null }), kinds); });
    else run.steps.forEach((s, k) => { F.set('step', k + 1); F.add({ items: scene(spec, s.state, { act: s.tid, line: s.pc, op: s.op, obj: s.obj, strip, upto: k + 1, stripY }, kinds), say: s.say, meta: { vals: H.nums(s.say).concat([k + 1]), next: run.steps[k + 1] ? run.steps[k + 1].name : null, options: spec.threads.map((t) => t.name) } }); });
    const last = chk.steps ? chk.steps[chk.steps.length - 1].state : run.machine.snap();
    F.add({ items: scene(spec, last, { stripY, strip, upto: strip.length, verdict: vd }, kinds), say: o.end(chk, last), meta: { vals: [chk.stats.states].concat(H.nums(o.end(chk, last))) } });
    return chk;
  }
  H.cvChecked = checkedFrames;

  H.topic({
    id: 'sync-condvar', family: 'p07-sleep', order: 30, title: 'Condition variables: signal, broadcast and the while loop',
    blurb: 'A thread that must wait for some state (a gate to open, a ticket to appear) locks the mutex, tests the state, and if it is not right waits on a condition variable, which releases the mutex and sleeps in one step. Whoever changes the state signals one sleeper or broadcasts to all. Two classic mistakes: signalling when several may need to go, and testing with if instead of while.',
    inputs: [
      { id: 'scene', kind: 'choice', label: 'Waiting for', def: 'gate', options: [{ value: 'gate', label: 'a gate to open (all may pass)' }, { value: 'tickets', label: 'a ticket (one each)' }] },
      { id: 'wake', kind: 'choice', label: 'The changer calls', def: 'signal', options: [{ value: 'signal', label: 'signal (one)' }, { value: 'broadcast', label: 'broadcast (all)' }] },
      { id: 'test', kind: 'choice', label: 'Waiters test with', def: 'while', options: [{ value: 'while', label: 'while' }, { value: 'if', label: 'if' }] },
      { id: 'n', kind: 'number', label: 'Waiters', def: 2, min: 2, max: 3 },
    ],
    presets: [
      { label: 'Gate opened with signal', values: { scene: 'gate', wake: 'signal', test: 'while', n: 2 } },
      { label: 'Gate opened with broadcast', values: { scene: 'gate', wake: 'broadcast', test: 'while', n: 3 } },
      { label: 'Tickets, broadcast, if', values: { scene: 'tickets', wake: 'broadcast', test: 'if', n: 2 } },
      { label: 'Tickets, broadcast, while', values: { scene: 'tickets', wake: 'broadcast', test: 'while', n: 2 } },
      { label: 'Tickets, signal, while', values: { scene: 'tickets', wake: 'signal', test: 'while', n: 2 } },
    ],
    counters: [{ id: 'states', label: 'states searched' }, { id: 'step', label: 'step' }],
    run(inp) {
      const n = inp.n, spec = cvSpec(inp.scene, inp.wake, inp.test, n), F = new S.Frames(['states', 'step']);
      const kinds = [Array.from({ length: n }, (_, i) => i), [n]];
      const intro = inp.scene === 'gate' ? `${H.plural(n, 'waiter')} lock m and wait on c ${inp.test === 'while' ? 'while' : 'if'} the gate is shut; O opens it (open = 1) and calls ${inp.wake}(c). Once open, everyone should pass.` : `${H.plural(n, 'consumer')} each need one ticket: lock m, wait on c ${inp.test === 'while' ? 'while' : 'if'} there are none, take one. P adds ${n} tickets, one at a time, calling ${inp.wake}(c) after each.`;
      checkedFrames(F, spec, kinds, intro, {
        vals: [n], seed: 3,
        end: (chk, st) => {
          const viol = chk.res.safety.violation;
          if (!viol) return inp.scene === 'gate' ? `Broadcast moved every sleeper back to the mutex; each, holding it in turn, tests open again and passes. Correct in all ${chk.stats.states} states.` : `${inp.test === 'while' ? 'Every waiter tests tickets again after waking, so nobody takes a ticket that is not there' : 'Testing once happened to work'}, and ${inp.wake === 'signal' ? 'each ticket wakes one consumer, which is all one ticket can serve' : 'the extra wake-ups only cost a test each'}. Correct in all ${chk.stats.states} states.`;
          if (viol.kind === 'deadlock') { const asleep = st.threads.filter((t) => t.state === 'blocked').map((t) => t.name); return `The gate is open, yet ${H.list(asleep)} ${asleep.length > 1 ? 'sleep' : 'sleeps'} on c for ever: the single signal woke one waiter, and nothing will ever signal again. A change that may let several go needs broadcast.`; }
          return `tickets is \`${st.vars.tickets}\`. Broadcast woke both consumers for one ticket; the first took it, and the second, testing only with if, took one that was not there. After a wake-up the state must be tested again: while, not if.`;
        },
      });
      return { frames: F.list, def: H.def('Waiting on a condition', ['lock(m)', 'while (!condition)', '    wait(c, m)  release m, sleep;', '                retake m on wake', '... use the state ...', 'unlock(m)', 'changer: lock; change; signal or', '  broadcast; unlock']) };
    },
    predict: [H.predictNext('Which thread takes the next step?')],
    quiz: [
      { q: 'Why must wait(c, m) release the mutex?', options: ['so that the thread that changes the state can get in', 'to save memory', 'so the waiter can spin', 'it does not'], answer: 0, why: 'The changer needs m to change the state the waiter tests.' },
      { q: 'A gate opens and several threads should pass. The opener calls…', options: ['broadcast', 'signal', 'neither', 'unlock twice'], answer: 0, why: 'A signal wakes one; the others sleep on with nobody left to wake them.' },
      { q: 'Why test the condition in a while loop?', options: ['by the time a woken thread holds the mutex, another may have changed the state again', 'it is faster', 'the compiler requires it', 'signals repeat'], answer: 0, why: 'With Mesa semantics a wake-up is only a hint.' },
      { q: 'A signal with nobody waiting…', options: ['is lost', 'is remembered for the next waiter', 'blocks the signaller', 'wakes everyone later'], answer: 0, why: 'A condition variable keeps no count, unlike a semaphore.' },
    ],
  });

  function bankSpec(test, hoare) {
    const back = test === 'while' ? 'chk' : 'go';
    const withdraw = Y().monitor('m', [{ label: 'chk' }, { op: 'read', v: 'balance', into: 'b', label: 'b = balance' }, { op: 'jump', to: 'go', if: (r) => r.b >= 1, label: test + ' (balance < 1)' }, { op: 'cwait', c: 'funds', label: 'wait(funds)' }, { op: 'jump', to: back, label: test === 'while' ? 'test again' : 'go on' }, { label: 'go' }, { op: 'update', v: 'balance', by: -1, label: 'balance -= 1', mark: 'progress' }]);
    const deposit = Y().monitor('m', [{ op: 'update', v: 'balance', by: 1, label: 'balance += 1' }, { op: 'signal', c: 'funds', label: 'signal(funds)' }]);
    const spec = { threads: [{ name: 'W1', prog: withdraw }, { name: 'W2', prog: withdraw }, { name: 'D', prog: deposit.concat(deposit) }], mutexes: [{ id: 'm', name: 'monitor' }], conds: [{ id: 'funds', name: 'funds' }], vars: { balance: 0 }, hoare, symmetry: [[0, 1]] };
    spec.check = { invariants: [{ name: 'balance never below 0', holds: (M) => M.vars.balance >= 0 }], liveness: [], deadlock: true };
    return spec;
  }
  H.bankSpec = bankSpec;
  H.topic({
    id: 'sync-monitor', family: 'p07-sleep', order: 40, title: 'Monitors: Mesa and Hoare',
    blurb: 'A monitor is a module whose procedures run one at a time: the lock is taken on entry and released on exit, and inside, condition variables let a procedure wait. What happens on a signal is a design choice. Hoare: the woken thread runs at once, still holding the monitor, and the signaller waits. Mesa: the woken thread only queues to come back in, so the state may change first. An account with two withdrawals and two deposits shows the difference.',
    inputs: [
      { id: 'sem', kind: 'choice', label: 'Signal semantics', def: 'mesa', options: [{ value: 'mesa', label: 'Mesa (woken thread queues)' }, { value: 'hoare', label: 'Hoare (woken thread runs now)' }] },
      { id: 'test', kind: 'choice', label: 'withdraw tests with', def: 'if', options: [{ value: 'if', label: 'if' }, { value: 'while', label: 'while' }] },
    ],
    presets: [
      { label: 'Mesa with if', values: { sem: 'mesa', test: 'if' } },
      { label: 'Hoare with if', values: { sem: 'hoare', test: 'if' } },
      { label: 'Mesa with while', values: { sem: 'mesa', test: 'while' } },
    ],
    counters: [{ id: 'states', label: 'states searched' }, { id: 'step', label: 'step' }],
    run(inp) {
      const spec = bankSpec(inp.test, inp.sem === 'hoare'), F = new S.Frames(['states', 'step']);
      checkedFrames(F, spec, [[0, 1], [2]], `The account monitor starts with balance \`0\`. W1 and W2 each call withdraw(1), which waits on funds ${inp.test} the balance is below 1; D calls deposit(1) twice, each signalling funds. Semantics: ${inp.sem === 'hoare' ? 'Hoare' : 'Mesa'}.`, {
        vals: [0, 1, 2], seed: 2,
        end: (chk, st) => chk.res.safety.violation ? `balance is \`${st.vars.balance}\`. With Mesa semantics the signalled withdrawer only rejoined the queue for the monitor; another withdrawer got in first and took the money, and the woken one, testing with if, withdrew anyway.` : inp.sem === 'hoare' ? `With Hoare semantics the signal hands the monitor straight to the woken withdrawer, so the balance it was promised is still there: if is enough. The checker agrees over all ${chk.stats.states} states. The price: a signaller must wait, and every signal is two switches.` : `With while, a woken withdrawer tests the balance again before taking money, so Mesa's queueing does no harm. Correct over all ${chk.stats.states} states.`,
      });
      return { frames: F.list, def: H.def('A monitor', ['one thread inside at a time', 'entry queue: waiting to get in', 'condition queues: waiting inside', 'Hoare signal: woken runs now,', '  signaller waits (urgent queue)', 'Mesa signal: woken queues to', '  re-enter; test again (while)']) };
    },
    predict: [H.predictNext('Which thread takes the next step?')],
    quiz: [
      { q: 'With Hoare semantics, what does signal do to the signaller?', options: ['it waits, and gets the monitor back after the woken thread leaves or waits', 'nothing', 'it leaves the monitor', 'it is killed'], answer: 0, why: 'Only one thread may be inside, and the woken one runs at once.' },
      { q: 'Why does Mesa need a while loop?', options: ['a woken thread re-enters later, after others may have changed the state', 'Mesa loses signals', 'Mesa has no mutex', 'it does not'], answer: 0, why: 'Signal is a hint that the state may now be right.' },
      { q: 'Which semantics do pthread condition variables have?', options: ['Mesa', 'Hoare', 'neither', 'both, by a flag'], answer: 0, why: 'pthread_cond_signal only makes a waiter runnable; it must retake the mutex.' },
      { q: 'In a monitor, who holds the lock while a procedure waits on a condition?', options: ['nobody, unless another thread has entered', 'the waiting procedure', 'the signaller', 'the kernel'], answer: 0, why: 'Waiting releases the monitor so others can enter.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
