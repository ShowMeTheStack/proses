// Part 7, atomic instructions and spinlocks. Test-and-set, compare-and-swap and fetch-and-add each read and write
// a word in one indivisible step: n threads race on one word, and the model checker confirms in every schedule
// that exactly one wins (or every ticket is different); the same work split into a load and a store fails, and the
// checker shows how. Then spinlocks built from them (S.Sync.spinlock): run under a seeded scheduler, with every
// spin counted, and checked for starvation: test-and-set and compare-and-swap let a waiter lose for ever, the
// ticket lock serves in order.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;
  const OPS = { tas: 'test-and-set', cas: 'compare-and-swap', faa: 'fetch-and-add' };

  /** n threads each try the instruction once on the word w, done as one step or split into a load and a store */
  function raceSpec(kind, n, split) {
    let prog, inv;
    if (kind === 'tas') {
      prog = split ? [{ op: 'read', v: 'w', into: 'o', label: 'o = w' }, { op: 'write', v: 'w', val: 1, label: 'w = 1' }] : [{ op: 'tas', v: 'w', into: 'o', label: 'o = test_and_set(&w)' }];
      inv = { name: 'at most one thread sees 0 (wins the lock)', holds: (M) => M.threads.filter((t) => t.reg.o === 0).length <= 1 };
    } else if (kind === 'cas') {
      prog = split ? [{ op: 'read', v: 'w', into: 'o', label: 'o = w' }, { op: 'jump', to: 'no', if: (r) => r.o !== 0, label: 'if (o != 0) fail' }, { op: 'write', v: 'w', val: (r, th) => th.id + 1, label: 'w = me' }, { op: 'local', fn: (r) => { r.ok = 1; }, label: 'ok = 1' }, { label: 'no' }]
        : [{ op: 'cas', v: 'w', expect: 0, val: (r, th) => th.id + 1, into: 'ok', label: 'ok = cas(&w, 0, me)' }];
      inv = { name: 'at most one swap succeeds', holds: (M) => M.threads.filter((t) => t.reg.ok === 1).length <= 1 };
    } else {
      prog = split ? [{ op: 'read', v: 'w', into: 'o', label: 'o = w' }, { op: 'write', v: 'w', val: (r) => r.o + 1, label: 'w = o + 1' }] : [{ op: 'faa', v: 'w', by: 1, into: 'o', label: 'o = fetch_and_add(&w, 1)' }];
      inv = { name: 'every thread gets a different number', holds: (M) => { const got = M.threads.filter((t) => t.state === 'done').map((t) => t.reg.o); return new Set(got).size === got.length; } };
    }
    const spec = { threads: Array.from({ length: n }, (_, i) => ({ name: 'T' + i, prog })), vars: { w: 0 } };
    spec.check = { invariants: [inv], liveness: [], deadlock: true };
    return spec;
  }
  const result = (kind, th) => (th.state !== 'done' ? '…' : kind === 'tas' ? (th.reg.o === 0 ? 'got 0: wins' : 'got 1: loses') : kind === 'cas' ? (th.reg.ok === 1 ? 'swapped: wins' : 'failed') : 'got ' + th.reg.o);

  H.topic({
    id: 'sync-atomic-ops', family: 'p07-atomic', order: 10, title: 'Test-and-set, compare-and-swap, fetch-and-add',
    blurb: 'Hardware gives a few instructions that read a memory word and write it in one indivisible step: test-and-set returns the old value and leaves 1, compare-and-swap writes only if the word still holds what you expect, fetch-and-add returns the old value and adds. Several threads race on one word; check every schedule, then split the instruction in two and watch it break.',
    inputs: [
      { id: 'op', kind: 'choice', label: 'Instruction', def: 'tas', options: Object.entries(OPS).map(([value, label]) => ({ value, label })) },
      { id: 'threads', kind: 'number', label: 'Threads', def: 3, min: 2, max: 4 },
      { id: 'how', kind: 'choice', label: 'Done as', def: 'atomic', options: [{ value: 'atomic', label: 'one atomic step' }, { value: 'split', label: 'a load, then a store' }] },
    ],
    presets: [
      { label: 'Test-and-set', values: { op: 'tas', threads: 3, how: 'atomic' } },
      { label: 'Test, then set', values: { op: 'tas', threads: 2, how: 'split' } },
      { label: 'Compare-and-swap', values: { op: 'cas', threads: 3, how: 'atomic' } },
      { label: 'CAS split in two', values: { op: 'cas', threads: 2, how: 'split' } },
      { label: 'Tickets by fetch-and-add', values: { op: 'faa', threads: 4, how: 'atomic' } },
      { label: 'Tickets by load and store', values: { op: 'faa', threads: 3, how: 'split' } },
    ],
    counters: [{ id: 'states', label: 'states searched' }, { id: 'step', label: 'step' }],
    run(inp) {
      const n = inp.threads, split = inp.how === 'split', spec = raceSpec(inp.op, n, split), F = new S.Frames(['states', 'step']);
      const lines = H.lines(spec.threads[0]);
      function draw(st, o) {
        o = o || {};
        const items = [];
        items.push(...H.code('cd', 0, 0, spec, st, st.threads.map((t) => t.id), { lines, act: o.act, line: o.line, textW: 250, size: 14, lh: 32, markW: 34, title: 'every thread runs:' }).items);
        items.push(H.title('wt', 520, 14, 'the shared word'));
        items.push(...K7().vars({ prefix: 'w', x: 520, y: 26, rows: [{ name: 'w', value: st.vars.w, act: o.op && o.op !== 'jump' && o.op !== 'local' && o.op !== 'read' }], nameW: 40, valW: 60 }).items);
        const ty = 40 + Math.max(lines.length, 2) * 32 + 30;
        items.push(H.title('tt', 0, ty, 'threads'));
        st.threads.forEach((th, i) => {
          items.push(...K7().threads({ prefix: 'th' + i, x: i * 150, y: ty + 12, threads: [{ id: i, name: th.name, state: th.state === 'ready' && o.act === i ? 'running' : th.state, act: o.act === i, sub: result(inp.op, th), subCls: /wins|swapped/.test(result(inp.op, th)) ? 'good' : /loses|failed/.test(result(inp.op, th)) ? 'hot' : '' }], w: 70, h: 34 }).items);
        });
        if (o.strip) items.push(...K7().strip({ prefix: 'sc', x: 0, y: ty + 96, w: 480, steps: o.strip, upto: o.upto, cw: 34, ch: 28, title: 'the schedule' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: 520, y: 110, w: 330 }, o.verdict)).items);
        return items;
      }
      const st0 = Y().machine(spec).snap();
      F.add({ items: draw(st0), say: `${H.plural(n, 'thread')} share one word w = \`0\`. Each ${split ? 'does the work of ' + OPS[inp.op] + ' as separate steps, so another thread can run between them' : 'runs ' + OPS[inp.op] + ' once: the hardware reads and writes w in one step, and no other thread can come between'}.`, meta: { vals: [n, 0] } });
      // one schedule first: round robin, one step each
      const run = Y().run(spec, { policy: 'rr', quantum: 1 }), strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      run.steps.forEach((s, k) => { F.set('step', k + 1); F.add({ items: draw(s.state, { act: s.tid, line: s.pc, op: s.op, strip, upto: k + 1 }), say: s.say, meta: { vals: H.nums(s.say).concat([k + 1]), next: run.steps[k + 1] ? run.steps[k + 1].name : null, options: spec.threads.map((t) => t.name) } }); });
      const chk = H.check(spec), v = H.verdictText(chk), inv = spec.check.invariants[0].name;
      F.set('states', chk.stats.states);
      F.add({ items: draw(run.machine.snap(), { strip, upto: strip.length, verdict: { kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched', '"' + inv + '"'] } }), say: chk.res.safety.violation ? `That schedule happened to work. The model checker tries them all: in ${chk.stats.states} states it finds a schedule of ${H.plural(chk.sched.length, 'step')} that breaks "${inv}".` : `Over all ${chk.stats.states} reachable states, every schedule of these ${H.plural(n, 'thread')}, "${inv}" holds: the instruction is indivisible, so the threads are served one at a time.`, meta: { vals: [chk.stats.states, n].concat(chk.sched ? [chk.sched.length] : []), violated: !!chk.res.safety.violation } });
      if (chk.steps) {
        const s2 = H.stripSteps(spec, chk.sched);
        H.replay(F, spec, chk, (st, o) => { F.set('step', o.k + 1); return draw(st, Object.assign({}, o, { strip: s2 })); });
        const last = chk.steps[chk.steps.length - 1].state;
        F.add({ items: draw(last, { strip: s2, upto: s2.length, verdict: { kind: 'bad', head: 'Broken', lines: ['"' + inv + '"', 'fails after ' + chk.sched.length + ' steps'] } }), say: `Between one thread's load and its store, another loaded the same old value: ${inp.op === 'faa' ? 'two threads hold the same number' : 'both think they won'}. That gap is exactly what the atomic instruction closes.`, meta: { vals: [chk.sched.length] } });
      }
      return { frames: F.list, def: H.def('Atomic read-modify-write', ['test_and_set(&w): old = w; w = 1;', '  return old', 'cas(&w, e, v): if (w == e)', '  { w = v; return 1 } return 0', 'fetch_and_add(&w, k): old = w;', '  w = old + k; return old', 'each: one step, nothing between']) };
    },
    predict: [H.predictNext('Which thread takes the next step?')],
    quiz: [
      { q: 'Two threads run test_and_set(&w) on w = 0. What do they get back?', options: ['one gets 0, the other 1', 'both 0', 'both 1', 'it depends on the values they store'], answer: 0, why: 'The first sets w to 1 and returns 0; the second sees 1.' },
      { q: 'compare-and-swap(&w, 0, 5) fails when…', options: ['w no longer holds 0', 'w holds 0', 'another thread is spinning', 'never'], answer: 0, why: 'It writes only if the word still holds the expected value.' },
      { q: 'Four threads each do fetch_and_add(&w, 1) on w = 0. What do they get?', options: ['0, 1, 2 and 3 in some order', 'all 0', 'all 4', 'any values'], answer: 0, why: 'Each add is indivisible, so the old values are all different.' },
      { q: 'Why does "o = w; w = 1;" not work as test-and-set?', options: ['two threads can both load 0 before either stores 1', 'it is too slow', 'stores are not allowed', 'it does work'], answer: 0, why: 'The gap between the load and the store is the whole problem.' },
    ],
  });

  const LOCKS = { tas: 'test-and-set spinlock', cas: 'compare-and-swap spinlock', ticket: 'ticket lock' };
  H.topic({
    id: 'sync-spinlock', family: 'p07-atomic', order: 20, title: 'Spinlocks and ticket locks',
    blurb: 'A spinlock is an atomic instruction in a loop: keep trying until you get the lock. It is correct, but nothing decides who gets it next, so one unlucky thread can lose every race. A ticket lock hands out numbers with fetch-and-add and serves them in order: first come, first served. Run them, count the spins, and let the checker look for a waiter who never gets in.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'Lock', def: 'tas', options: Object.entries(LOCKS).map(([value, label]) => ({ value, label })) },
      { id: 'threads', kind: 'number', label: 'Threads', def: 2, min: 2, max: 3 },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 4, min: 1, max: 999 },
      { id: 'steps', kind: 'number', label: 'Steps to show', def: 28, min: 10, max: 60 },
    ],
    presets: [
      { label: 'Test-and-set', values: { kind: 'tas', threads: 2, seed: 4, steps: 28 } },
      { label: 'Compare-and-swap, 3 threads', values: { kind: 'cas', threads: 3, seed: 2, steps: 40 } },
      { label: 'Ticket lock', values: { kind: 'ticket', threads: 2, seed: 4, steps: 28 } },
      { label: 'Ticket lock, 3 threads', values: { kind: 'ticket', threads: 3, seed: 9, steps: 48 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'spins', label: 'spins' }],
    run(inp) {
      const spec = Y().spinlock(inp.kind, inp.threads), n = inp.threads, F = new S.Frames(['step', 'spins']);
      const run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 3, max: inp.steps });
      const spins = Array(n).fill(0), entries = Array(n).fill(0);
      const lines = H.lines(spec.threads[0]), vars = H.usedVars(spec);
      function draw(st, o) {
        o = o || {};
        const items = [];
        items.push(...H.code('cd', 0, 0, spec, st, st.threads.map((t) => t.id), { lines, act: o.act, line: o.line, textW: 290, size: 13, lh: 28, markW: 32, title: 'every thread, for ever:' }).items);
        items.push(...K7().vars({ prefix: 'vr', x: 450, y: 0, title: 'shared memory', rows: vars.map((v) => ({ name: v, value: H.show(st.vars[v]), act: o.obj === v && o.op !== 'read' })), nameW: 76, valW: 56 }).items);
        const inside = st.threads.filter((t) => t.cs > 0).map((t) => t.name);
        const ry = 24 + vars.length * 34 + 14;
        items.push({ key: 'room', kind: 'region', x: 450, y: ry, w: 220, h: 64, rx: 10, cls: inside.length ? 'act' : 'frame' });
        items.push(H.text('roomt', 462, ry + 20, 'critical section', 'roomlabel', 13));
        items.push(H.text('roomin', 560, ry + 46, inside.length ? inside.join(', ') + ' inside' : 'empty', inside.length ? 'strong' : 'p7note', 15, 'middle'));
        const ty = ry + 90;
        items.push(H.title('tt', 450, ty, 'spins · entries'));
        st.threads.forEach((th, i) => items.push(...K7().regs({ prefix: 'sp' + i, x: 450, y: ty + 12 + i * 38, name: th.name, cls: S.Kit.sync7.stateCls(th.state === 'ready' && o.act === i ? 'running' : th.state), act: o.act === i, regs: [['spins', o.spins[i]], ['in', o.entries[i]]], cw: 80 }).items));
        if (o.strip) items.push(...K7().strip({ prefix: 'sc', x: 0, y: Math.max(lines.length * 28 + 50, ty + 12 + n * 38 + 10), w: 680, steps: o.strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 21, lit: H.cycleLit(o.cycle), title: o.cycle ? 'the schedule (pink outline: the cycle)' : 'the schedule' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: 680, y: 0, w: 200 }, o.verdict)).items);
        return items;
      }
      const st0 = Y().machine(spec).snap(), strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      F.add({ items: draw(st0, { spins, entries, strip, upto: 0 }), say: `${H.plural(n, 'thread')} loop for ever: take the ${LOCKS[inp.kind]}, run the critical section, release it. ${spec.about} The scheduler picks a random thread for a burst of 1 to 3 steps (seed ${inp.seed}).`, meta: { vals: [n, 1, 3, inp.seed] } });
      run.steps.forEach((s, k) => {
        if (s.op === 'jump' && s.taken && /while/.test(s.label || '')) spins[s.tid]++;
        if (s.op === 'enter') entries[s.tid]++;
        const total = spins.reduce((a, b) => a + b, 0);
        F.set('step', k + 1).set('spins', total);
        F.add({ items: draw(s.state, { act: s.tid, line: s.pc, op: s.op, obj: s.obj, spins: spins.slice(), entries: entries.slice(), strip, upto: k + 1 }), say: s.say + (s.op === 'jump' && s.taken && /while/.test(s.label || '') ? ` That is spin ${spins[s.tid]} for ${s.name}: the CPU is busy doing nothing useful.` : ''), meta: { vals: H.nums(s.say).concat([k + 1, spins[s.tid], total]) } });
      });
      const chk = H.check(spec), v = H.verdictText(chk);
      F.set('spins', spins.reduce((a, b) => a + b, 0));
      const head = chk.lasso ? 'A waiter can starve' : 'Nobody starves';
      F.add({ items: draw(run.machine.snap(), { spins, entries, strip, upto: strip.length, verdict: { kind: chk.lasso ? 'warn' : 'ok', head, lines: [chk.stats.states + ' states searched', 'mutual exclusion holds'] } }), say: `In this run: ${spins.map((x, i) => 'T' + i + ' spun ' + x + ' times and entered ' + entries[i]).join('; ')}. The model checker searched ${chk.stats.states} states: mutual exclusion always holds${chk.lasso ? `, but ${chk.lasso.name.replace(/ eventually.*/, '')} can be overtaken for ever, even under a fair scheduler. Here is that schedule.` : ', and every waiter gets in: the tickets fix the order.'}`, meta: { vals: [chk.stats.states, ...spins, ...entries] } });
      if (chk.lasso) {
        const sp2 = Array(n).fill(0), en2 = Array(n).fill(0);
        H.replay(F, spec, chk, (st, o) => { const s = o.step; if (s.op === 'jump' && s.taken && /while/.test(s.label || '')) sp2[s.tid]++; if (s.op === 'enter') en2[s.tid]++; F.set('step', o.k + 1); return draw(st, Object.assign({}, o, { spins: sp2.slice(), entries: en2.slice() })); });
      }
      return { frames: F.list, def: H.def(LOCKS[inp.kind], { tas: ['while (test_and_set(&lock) == 1)', '    ;   spin', '... critical section ...', 'lock = 0', 'no order among waiters'], cas: ['while (!cas(&lock, 0, 1))', '    ;   spin', '... critical section ...', 'lock = 0', 'no order among waiters'], ticket: ['my = fetch_and_add(&next, 1)', 'while (serving != my)', '    ;   spin', '... critical section ...', 'serving = serving + 1', 'served in ticket order'] }[inp.kind]) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Can a waiting thread be passed over for ever with this lock, under a fair scheduler?', options: ['yes', 'no'], answer: (fr) => (fr.some((f) => /can be overtaken for ever/.test(f.say)) ? 'yes' : 'no'), explain: (fr) => fr.find((f) => /states: mutual exclusion/.test(f.say)).say }],
    quiz: [
      { q: 'A test-and-set spinlock guarantees…', options: ['mutual exclusion, but not that every waiter gets in', 'first come, first served', 'no spinning', 'nothing'], answer: 0, why: 'Whoever happens to run test-and-set right after the release wins.' },
      { q: 'How does a ticket lock make waiting fair?', options: ['fetch-and-add gives each arrival a number, served in order', 'it sleeps', 'it uses two locks', 'it randomises'], answer: 0, why: 'serving only increases, so tickets are served in the order taken.' },
      { q: 'When is spinning a good idea?', options: ['on several cores, when the lock is held only briefly', 'on one core with long critical sections', 'always', 'never'], answer: 0, why: 'On one core, the spinner wastes the time slice the holder needs.' },
      { q: 'Every waiter of a ticket lock spins on serving. What does that cost on a multicore?', options: ['each release invalidates the line in every waiter\'s cache', 'nothing', 'a system call each spin', 'deadlock'], answer: 0, why: 'All spin on one shared word; queue locks give each waiter its own word.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
