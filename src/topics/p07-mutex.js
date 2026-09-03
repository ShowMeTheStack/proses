// Part 7, sleeping locks and semaphores. A mutex keeps an owner and a queue of sleepers: a thread that finds it
// taken blocks (it is not runnable, so it costs no CPU), and unlock hands the mutex straight to the first in line.
// The same threads with a spinlock burn their time slices testing a word. A semaphore is a counter with a queue:
// wait takes one or sleeps, post gives one back or wakes a sleeper; with k units it lets k threads in at once, and
// unlike a condition variable it remembers a post that came before the wait. Programs here are our own machine
// specs; every step is the machine's, every verdict the model checker's.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7, KP = () => S.Kit.proc;

  function lockSpec(kind, n, inside, rounds) {
    const work = Array.from({ length: inside }, (_, i) => ({ op: 'work', label: 'works inside (' + (i + 1) + ')' }));
    const cs = [{ op: 'enter', label: 'enters the critical section', mark: 'progress' }, ...work, { op: 'leave', label: 'leaves it' }];
    const prog = kind === 'mutex'
      ? [{ op: 'lock', m: 'm', label: 'lock(m)' }, ...cs, { op: 'unlock', m: 'm', label: 'unlock(m)' }, { op: 'think', label: 'works outside' }]
      : [{ label: 'top' }, { op: 'tas', v: 'lock', into: 'o', label: 'o = test_and_set(lock)' }, { op: 'jump', to: 'top', if: (r) => r.o === 1, label: 'while (o == 1)' }, ...cs, { op: 'write', v: 'lock', val: 0, label: 'lock = 0' }, { op: 'think', label: 'works outside' }];
    const spec = { threads: Array.from({ length: n }, (_, i) => ({ name: 'T' + i, loop: true, iters: rounds, prog })), mutexes: kind === 'mutex' ? [{ id: 'm', name: 'm' }] : [], vars: kind === 'mutex' ? {} : { lock: 0 } };
    spec.check = { invariants: [Y().helpers.mutex()], liveness: [], deadlock: true };
    return spec;
  }

  H.lockSpec = lockSpec;
  H.topic({
    id: 'sync-mutex', family: 'p07-sleep', order: 10, title: 'A mutex and its sleep queue',
    blurb: 'A thread that finds a mutex taken goes to sleep in the mutex\'s queue and leaves the CPU to others; unlock hands the mutex to the first sleeper, which wakes owning it. Compare a spinlock on one CPU: a waiter keeps the CPU testing a word that cannot change until the holder runs again. The timeline shows who runs, who waits ready and who sleeps.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'Lock', def: 'mutex', options: [{ value: 'mutex', label: 'mutex (sleep)' }, { value: 'spin', label: 'spinlock (spin)' }] },
      { id: 'threads', kind: 'number', label: 'Threads', def: 3, min: 2, max: 5 },
      { id: 'inside', kind: 'number', label: 'Steps inside', def: 3, min: 1, max: 5 },
      { id: 'quantum', kind: 'number', label: 'Time slice (steps)', def: 4, min: 1, max: 8 },
    ],
    presets: [
      { label: 'Mutex, 3 threads', values: { kind: 'mutex', threads: 3, inside: 3, quantum: 4 } },
      { label: 'Spinlock, 3 threads', values: { kind: 'spin', threads: 3, inside: 3, quantum: 4 } },
      { label: 'Mutex, 5 threads', values: { kind: 'mutex', threads: 5, inside: 2, quantum: 3 } },
      { label: 'Spinlock, long slices', values: { kind: 'spin', threads: 2, inside: 4, quantum: 8 } },
    ],
    counters: [{ id: 'step', label: 'CPU steps' }, { id: 'wasted', label: 'spent spinning' }, { id: 'asleep', label: 'thread-steps asleep' }],
    run(inp) {
      const n = inp.threads, rounds = 2, spec = lockSpec(inp.kind, n, inp.inside, rounds), lines = H.lines(spec.threads[0]);
      const run = Y().run(spec, { policy: 'rr', quantum: inp.quantum, max: 400 }), steps = run.steps, T = steps.length;
      const F = new S.Frames(['step', 'wasted', 'asleep']);
      const lanes = Array.from({ length: n }, () => []);
      let wasted = 0, asleep = 0;
      const spinStep = (s) => s.op === 'tas' && s.state.threads[s.tid].reg.o === 1 || (s.op === 'jump' && s.taken);
      function draw(st, o) {
        o = o || {};
        const items = [];
        items.push(...H.code('cd', 0, 0, spec, st, st.threads.map((t) => t.id), { lines, act: o.act, line: o.line, textW: 240, size: 13, lh: 26, markW: 30, title: 'every thread, ' + rounds + ' rounds:' }).items);
        const rx = 430;
        if (inp.kind === 'mutex') items.push(...H.objects('ob', rx, 10, spec, st, { lit: o.op === 'lock' || o.op === 'unlock' ? 'm' : null }).items);
        else items.push(...K7().vars({ prefix: 'vr', x: rx, y: 0, rows: [{ name: 'lock', value: st.vars.lock, act: o.op === 'tas' || o.op === 'write' }], nameW: 56, valW: 52 }).items);
        items.push(...K7().threads({ prefix: 'th', x: rx, y: 70, threads: H.cards(spec, st, o.act, { sub: (th) => th.state === 'blocked' ? 'asleep' : th.state === 'done' ? 'done' : th.cs ? 'inside' : o.act === th.id && o.spin ? 'spinning' : 'ready' }), w: 62, h: 32, gap: 10 }).items);
        const ty = Math.max(lines.length * 26 + 60, 190);
        items.push(...KP().timeline({ prefix: 'tl', x: 0, y: ty, w: 860, rows: lanes.map((c, i) => ({ id: i, label: 'T' + i, cells: c.slice(0, o.upto) })), n: T, now: o.upto ? o.upto - 1 : undefined, rowH: 24, labelW: 40, size: 13, title: 'timeline, one column a CPU step' }).items);
        items.push(...H.KS().legend({ prefix: 'lgd', x: 0, y: ty + n * 24 + 14, entries: [{ cls: 's-running', text: 'runs' }, { cls: 's-ready', text: 'ready, waiting for the CPU' }, { cls: 's-blocked', text: 'asleep on the mutex' }, { cls: 's-done', text: 'done' }], gap: 22 }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: rx, y: 140, w: 300 }, o.verdict)).items);
        return items;
      }
      steps.forEach((s, k) => s.state.threads.forEach((th, i) => lanes[i].push(i === s.tid ? 'running' : th.state)));
      F.add({ items: draw(Y().machine(spec).snap(), { upto: 0 }), say: `${H.plural(n, 'thread')} share one CPU, taking turns of ${H.plural(inp.quantum, 'step')}. Each does ${rounds} rounds of: take the ${inp.kind === 'mutex' ? 'mutex' : 'spinlock'}, ${H.plural(inp.inside, 'step')} inside, release, a step outside.`, meta: { vals: [n, inp.quantum, rounds, inp.inside] } });
      steps.forEach((s, k) => {
        const spin = inp.kind === 'spin' && spinStep(s);
        if (spin) wasted++;
        asleep += s.state.threads.filter((th) => th.state === 'blocked').length;
        F.set('step', k + 1).set('wasted', wasted).set('asleep', asleep);
        let say = s.say;
        if (s.op === 'unlock' && s.woke !== undefined && s.woke !== null) say += ' It does not just free the mutex: the sleeper becomes the owner, so nobody can sneak in first.';
        if (spin && s.op === 'jump') say += ` A wasted step: the holder cannot release the lock while ${s.name} has the CPU (${wasted} wasted so far).`;
        F.add({ items: draw(s.state, { act: s.tid, line: s.pc, op: s.op, spin, upto: k + 1 }), say, meta: { vals: H.nums(s.say).concat([k + 1, wasted, asleep]) } });
      });
      const chk = H.check(lockSpec(inp.kind, Math.min(n, 3), Math.min(inp.inside, 2), 1));
      F.add({ items: draw(run.machine.snap(), { upto: T, verdict: { kind: 'ok', head: wasted ? wasted + ' of ' + T + ' steps spinning' : 'No step spent spinning', lines: [inp.kind === 'mutex' ? asleep + ' thread-steps asleep' : 'mutual exclusion: ' + chk.stats.states + ' states'] } }), say: inp.kind === 'mutex' ? `All rounds done in ${T} CPU steps, none of them wasted: waiting threads slept (${asleep} thread-steps in all) and every unlock handed the mutex to the first sleeper in line. The model checker confirms mutual exclusion (${chk.stats.states} states for a smaller copy).` : `All rounds done in ${T} CPU steps, ${wasted} of them (${Math.round((100 * wasted) / T)}%) spent testing a lock that could not be free: on one CPU a spinner only delays the holder. The model checker confirms mutual exclusion (${chk.stats.states} states for a smaller copy) — correct, just wasteful.`, meta: { vals: [T, wasted, asleep, chk.stats.states, Math.round((100 * wasted) / T)], T, wasted, progLen: lines.length, rounds, n } });
      return { frames: F.list, def: H.def('Mutex (sleeping lock)', ['lock(m): if free, own it;', '  else sleep in m\'s queue', 'unlock(m): if someone sleeps,', '  hand m to the first, wake it;', '  else m is free', 'a sleeper costs no CPU;', '  a spinner costs its whole slice']) };
    },
    predict: [{ at: (f) => /tries to lock m/.test(f.say || ''), once: true, pick: 'option', ask: 'This thread just blocked. When the owner unlocks, what happens?', options: ['the first sleeper in the queue becomes the owner', 'every sleeper wakes and races', 'the mutex becomes free', 'the newest arrival gets it'], answer: 'the first sleeper in the queue becomes the owner', explain: () => 'Unlock hands the mutex over: the woken thread owns it at once, in FIFO order.' },
      { at: (f) => /A wasted step/.test(f.say || ''), once: true, pick: 'option', ask: 'The waiter keeps the only CPU and tests the lock again. Can the lock become free before its slice ends?', options: ['no: the holder is not running', 'yes, any moment'], answer: 'no: the holder is not running', explain: () => 'Only the holder can release it, and the holder needs the CPU.' }],
    quiz: [
      { q: 'Why does a blocked thread cost no CPU time?', options: ['it is not runnable: the scheduler skips it until a wake-up', 'it runs a cheap loop', 'the kernel pauses the clock', 'it does cost CPU'], answer: 0, why: 'Sleeping takes the thread off the ready queue.' },
      { q: 'With one CPU, what can a spinning waiter achieve during its time slice?', options: ['nothing: the holder cannot run to release the lock', 'it speeds up the holder', 'it gets the lock sooner', 'it helps fairness'], answer: 0, why: 'Only the holder can release, and it needs the CPU the spinner is using.' },
      { q: 'Unlock hands the mutex straight to the first sleeper. What does that prevent?', options: ['a newcomer barging in ahead of a thread that waited', 'deadlock', 'all spinning', 'the use of the queue'], answer: 0, why: 'Handing over keeps the queue order; freeing would let any thread grab it.' },
      { q: 'When can spinning beat sleeping?', options: ['on several cores, when the holder will release within the cost of a sleep and wake-up', 'on one core', 'with long critical sections', 'never'], answer: 0, why: 'Sleeping and waking cost two context switches.' },
    ],
  });

  // ---- semaphores ----
  function poolSpec(n, k) {
    const prog = [{ op: 'wait', s: 's', label: 'wait(s)' }, { op: 'update', v: 'inside', by: 1, label: 'takes a unit', mark: 'progress' }, { op: 'work', label: 'uses it' }, { op: 'update', v: 'inside', by: -1, label: 'gives it back' }, { op: 'post', s: 's', label: 'post(s)' }, { op: 'think', label: 'works outside' }];
    const spec = { threads: Array.from({ length: n }, (_, i) => ({ name: 'T' + i, loop: true, iters: 2, prog })), sems: [{ id: 's', name: 's', init: k }], vars: { inside: 0 } };
    spec.check = { invariants: [{ name: 'at most ' + k + ' inside at once', holds: (M) => M.vars.inside <= k }], liveness: [], deadlock: true };
    return spec;
  }
  function signalSpec(binary, posts) {
    const spec = {
      threads: [
        { name: 'P', prog: Array.from({ length: posts }, (_, i) => [{ op: 'work', label: 'makes item ' + (i + 1) }, { op: 'post', s: 'ready', label: 'post(ready)' }]).flat() },
        { name: 'C', prog: Array.from({ length: posts }, (_, i) => [{ op: 'wait', s: 'ready', label: 'wait(ready)' }, { op: 'work', label: 'uses item ' + (i + 1) }]).flat() },
      ],
      sems: [{ id: 'ready', name: 'ready', init: 0, binary }], vars: {},
    };
    spec.check = { invariants: [], liveness: [], deadlock: true };
    return spec;
  }
  H.topic({
    id: 'sync-semaphore', family: 'p07-sleep', order: 20, title: 'Semaphores, counting and binary',
    blurb: 'A semaphore holds a count and a queue. wait takes one unit, or sleeps if there is none; post gives one back, or hands it to the first sleeper. Start it at k and it lets k threads into a pool at once. Start it at 0 and it carries signals from one thread to another, remembering posts that came early. A binary semaphore stops at 1, so two early posts count as one.',
    inputs: [
      { id: 'use', kind: 'choice', label: 'Used as', def: 'pool', options: [{ value: 'pool', label: 'a pool of k units' }, { value: 'signal', label: 'signals from P to C' }] },
      { id: 'k', kind: 'number', label: 'Units k (pool)', def: 2, min: 1, max: 3 },
      { id: 'threads', kind: 'number', label: 'Threads (pool)', def: 4, min: 2, max: 5 },
      { id: 'binary', kind: 'choice', label: 'Kind (signals)', def: 'counting', options: [{ value: 'counting', label: 'counting' }, { value: 'binary', label: 'binary (stops at 1)' }] },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 2, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Two printers, four threads', values: { use: 'pool', k: 2, threads: 4, seed: 2 } },
      { label: 'One unit: a lock', values: { use: 'pool', k: 1, threads: 3, seed: 5 } },
      { label: 'Early posts, counting', values: { use: 'signal', binary: 'counting', seed: 1 } },
      { label: 'Early posts, binary', values: { use: 'signal', binary: 'binary', seed: 1 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'value', label: 'value' }],
    run(inp) {
      const pool = inp.use === 'pool', spec = pool ? poolSpec(inp.threads, inp.k) : signalSpec(inp.binary === 'binary', 2);
      const sid = pool ? 's' : 'ready', F = new S.Frames(['step', 'value']);
      // signals: P runs first (both posts early), then C; the pool: a seeded random scheduler
      const run = pool ? Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 2, max: 60 }) : Y().run(spec, { policy: 'fifo', max: 60 });
      const strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      const holders = [];
      function draw(st, o) {
        o = o || {};
        const items = [];
        spec.threads.forEach((t, i) => {
          if (!pool || i === 0) items.push(...H.code('cd' + i, pool ? 0 : i * 280, 0, spec, st, pool ? st.threads.map((x) => x.id) : [i], { lines: H.lines(t), act: o.act, line: o.line, textW: 200, size: 13, lh: 26, markW: 30, title: pool ? 'every thread, twice:' : t.name + ' runs:' }).items);
        });
        const rx = pool ? 372 : 580;
        items.push(...H.objects('ob', rx, 10, spec, st, { lit: o.op === 'wait' || o.op === 'post' ? sid : null, perRow: 4 }).items);
        if (pool) {
          items.push(H.title('pt', rx, 92, 'the pool: ' + H.plural(inp.k, 'unit')));
          for (let u = 0; u < inp.k; u++) items.push({ key: 'u' + u, kind: 'cell', x: rx + u * 96, y: 104, w: 86, h: 40, rx: 8, text: o.holders[u] || 'free', size: 15, cls: o.holders[u] ? 'mxown held ' + K7().pcls(+o.holders[u].slice(1)) : 'mxown free' });
          items.push(...K7().threads({ prefix: 'th', x: rx, y: 172, threads: H.cards(spec, st, o.act, { sub: (th) => (th.state === 'blocked' ? 'asleep' : th.state === 'done' ? 'done' : o.holders.includes(th.name) ? 'has a unit' : 'ready') }), w: 78, h: 32, gap: 12 }).items);
        } else items.push(...K7().threads({ prefix: 'th', x: rx, y: 80, threads: H.cards(spec, st, o.act, { sub: (th) => (th.state === 'blocked' ? 'asleep' : th.state === 'done' ? 'done' : 'ready') }), w: 60, h: 32, gap: 14 }).items);
        items.push(...K7().strip({ prefix: 'sc', x: 0, y: pool ? 330 : 200, w: 600, steps: strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 17, title: 'the schedule' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: pool ? 372 : 580, y: pool ? 236 : 170, w: 300 }, o.verdict)).items);
        return items;
      }
      const st0 = Y().machine(spec).snap(), v0 = st0.sem[sid].value;
      F.set('value', v0);
      F.add({ items: draw(st0, { holders: [], upto: 0 }), say: pool ? `${H.plural(inp.threads, 'thread')} want units from a pool of ${inp.k}. The semaphore s starts at \`${v0}\`: wait(s) before using a unit, post(s) after. A random scheduler (seed ${inp.seed}) picks who runs.` : `P makes two items and posts ready after each; C waits on ready before using each. ready is ${inp.binary === 'binary' ? 'binary' : 'counting'} and starts at \`${v0}\`. Here P runs first and posts twice before C waits at all.`, meta: { vals: [inp.threads, inp.k, v0, inp.seed] } });
      run.steps.forEach((s, k) => {
        // a thread holds a unit from the wait that lets it through until its post
        const take = (nm) => { const u = holders.findIndex((x) => !x); if (u >= 0) holders[u] = nm; else holders.push(nm); };
        if (pool && s.op === 'wait' && s.kind === 'pass') take(s.name);
        if (pool && s.op === 'post') { holders[holders.indexOf(s.name)] = null; if (s.woke !== undefined && s.woke !== null) take(s.state.threads[s.woke].name); }
        const val = s.state.sem[sid].value;
        F.set('step', k + 1).set('value', val);
        F.add({ items: draw(s.state, { act: s.tid, line: s.pc, op: s.op, holders: holders.slice(), upto: k + 1 }), say: s.say, meta: { vals: H.nums(s.say).concat([k + 1, val]), waitAsk: s.state.threads.some((t) => t.state !== 'done') && run.steps[k + 1] && run.steps[k + 1].op === 'wait' ? { name: run.steps[k + 1].name, blocks: run.steps[k + 1].kind === 'block' } : null } });
      });
      const chk = H.check(pool ? poolSpec(Math.min(inp.threads, 3), inp.k) : spec), v = H.verdictText(chk);
      const end = run.end, last = run.machine.snap();
      F.add({ items: draw(last, { holders: holders.slice(), upto: strip.length, verdict: { kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] } }), say: pool ? `Never more than ${inp.k} inside: the model checker confirms "${spec.check.invariants[0].name}" over all ${chk.stats.states} states (for up to 3 threads). The count is the number of free units; the queue holds those waiting for one.` : inp.binary === 'binary' ? `${end.say} The binary semaphore was already \`1\` at P's second post, so that post was lost: C's second wait sleeps for ever. The model checker finds this in ${chk.stats.states} states. A counting semaphore remembers both.` : `Both items arrived although C was not waiting yet: the counting semaphore stored the two early posts (it reached \`2\`) and handed them out to C's waits. The model checker finds no stuck state in ${chk.stats.states} states.`, meta: { vals: [inp.k, chk.stats.states, 3, 2, 1].concat(H.nums(end.say)) } });
      return { frames: F.list, def: H.def('Semaphore (count and queue)', ['wait(s): if s > 0, s = s - 1;', '  else sleep in s\'s queue', 'post(s): if someone sleeps, wake', '  the first (s stays);', '  else s = s + 1 (binary: at most 1)', 'start at k: a pool of k', 'start at 0: a signal']) };
    },
    predict: [{ at: (f) => !!(f.meta && f.meta.waitAsk), once: true, pick: 'option', ask: (fr, i) => fr[i].meta.waitAsk.name + ' is about to wait on the semaphore. Will it go on or sleep?', options: ['it goes on', 'it sleeps'], answer: (fr, i) => (fr[i].meta.waitAsk.blocks ? 'it sleeps' : 'it goes on'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A semaphore starts at 3. Five threads call wait at once. How many go on?', options: ['3', '5', '1', '0'], answer: 0, why: 'Each successful wait takes one unit; the other two sleep.' },
      { q: 'post(s) when two threads sleep on s: what happens to the value?', options: ['it stays the same: the unit goes straight to the first sleeper', 'it rises by 1', 'it falls', 'both sleepers wake'], answer: 0, why: 'The posted unit is handed over, not stored.' },
      { q: 'What can a counting semaphore do that a condition variable cannot?', options: ['remember a post made before anyone waits', 'wake all waiters', 'be used with a mutex', 'nothing'], answer: 0, why: 'A signal on a condition variable with no waiter is lost; a post is counted.' },
      { q: 'A binary semaphore at 1 is posted again. Then?', options: ['it stays 1: the second post is lost', 'it becomes 2', 'it becomes 0', 'the poster blocks'], answer: 0, why: 'Binary means the value is capped at 1.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
