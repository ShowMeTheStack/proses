// The challenge kinds (src/app/challenges-kinds-*.js): every kind's sample challenge passes the content check (its
// reference answer reaches the target, every wrong one does not), and each kind's scoring is checked against an
// independent computation: disk movement summed by hand, page-table bytes counted by hand, a schedule's mean
// response worked out from its Gantt chart, the C kinds on programs whose behaviour is known.
import { load, harness } from './load.mjs';
// app files read the browser's storage as they load: give node an in-memory one (its own warns without a file)
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
const S = load(['core', 'stage', 'app']);
const t = harness('app-challenges');
const C = S.Challenges;

// ---- every kind has a sample that lints clean ----------------------------------------------------------------------
const want = ['sched-tune', 'sync-solution', 'pt-design', 'disk-sched', 'shell'];
for (const k of want) t.ok(C.kinds[k] && typeof C.kinds[k].example === 'function', 'kind ' + k + ' with an example');
const ex = C.examples();
t.eq(want.filter((k) => ex.some((x) => x.kind === k)), want, 'examples() lists every kind');
for (const x of ex) {
  const r = C.lint(x);
  t.eq(r.problems, [], 'the ' + x.kind + ' sample lints clean');
  t.ok(x.hints.length === 3 && x.wrong.length >= 2 && x.story && x.task, x.kind + ': story, task, three hints and two wrong answers');
  t.ok(C.limitSentences(x).length > 0, x.kind + ': its limits in words');
  t.ok(C.starter(x) !== null && C.starter(x) !== undefined, x.kind + ': a starting answer');
}

// ---- disk-sched: movement summed by hand -------------------------------------------------------------------------------
{
  const D = C.kinds['disk-sched'];
  const q = { start: 53, cylinders: 200, dir: 'up', requests: [98, 183, 37, 122, 14, 124, 65, 67] };
  const x = { kind: 'disk-sched', queue: q, limits: { order: true, maxPassed: 2 }, target: 300, higher: false };
  const fcfs = [98, 183, 37, 122, 14, 124, 65, 67].reduce((s, c, i, a) => s + Math.abs(c - (i ? a[i - 1] : 53)), 0);
  t.eq(fcfs, 640, 'the FCFS movement by hand');
  t.eq(C.evaluate(x, { policy: 'fcfs' }).score, 640, 'disk: FCFS scores its movement');
  // LOOK upwards from 53: 65 67 98 122 124 183, then down to 37 14: 130 + 169
  t.eq(C.evaluate(x, { policy: 'look', dir: 'up' }).score, (183 - 53) + (183 - 14), 'disk: LOOK up');
  const order = [6, 7, 0, 3, 5, 1, 2, 4];
  t.eq(C.evaluate(x, { order }).score, 12 + 2 + 31 + 24 + 2 + 59 + 146 + 23, 'disk: an explicit order is summed as given');
  t.eq(D.maxPassed(order), 4, 'disk: requests 1 and 2 are each overtaken by four later requests');
  t.ok(C.evaluate(x, { order }).limits.length === 1, 'disk: too many overtakes break the limit');
  t.ok(/exactly once/.test(C.evaluate(x, { order: [0, 1, 2] }).limits[0] || ''), 'disk: an order must be a permutation');
  t.ok(/not an order/.test(C.evaluate(Object.assign({}, x, { limits: {} }), { order }).limits[0] || ''), 'disk: an order only where the challenge allows it');
  const h = D.cases({ hidden: { seed: 3, count: 2, n: 6 } });
  t.eq(h.length, 2, 'disk: hidden queues from a seed');
  t.eq(D.cases({ hidden: { seed: 3, count: 2, n: 6 } }), h, 'disk: the same seed, the same queues');
}

// ---- pt-design: table bytes counted by hand ------------------------------------------------------------------------------
{
  const x = { kind: 'pt-design', higher: false, target: 1e9, space: { vaBits: 32, pteBytes: 4, regions: [{ name: 'a', start: '0x00000000', bytes: 4096 }, { name: 'b', start: '0x80000000', bytes: 5000 }] }, limits: { maxLevels: 3 } };
  // 10-10 with 4 KiB pages: the root (4 KiB) and one second-level table per region (4 KiB each)
  // b needs 2 pages: 8192 − 5000 = 3192 bytes unused
  t.eq(C.evaluate(x, { pageBytes: 4096, bits: [10, 10] }).score, 3 * 4096 + 3192, 'pt: two levels, counted by hand');
  // 8-6-6: root 256 entries (1 KiB), each region one 64-entry table at level 2 and one at level 3 (256 B each)
  t.eq(C.evaluate(x, { pageBytes: 4096, bits: [8, 6, 6] }).score, 1024 + 4 * 256 + 3192, 'pt: three levels, counted by hand');
  t.ok(/bits/.test(C.evaluate(x, { pageBytes: 4096, bits: [10, 9] }).limits[0] || ''), 'pt: bits that do not fill the address break the limits');
  t.ok(C.evaluate(x, { pageBytes: 4096, bits: [5, 5, 5, 5] }).limits.some((l) => /levels/.test(l)), 'pt: too many levels');
  t.ok(C.evaluate(x, { pageBytes: 3000, bits: [10, 10] }).limits.length > 0, 'pt: the page size must be a power of two');
}

// ---- sched-tune: the mean response from the trace's own Gantt chart ------------------------------------------------------
{
  const K = C.kinds['sched-tune'];
  const w = [{ id: 'A', arrive: 0, bursts: [5] }, { id: 'B', arrive: 1, bursts: [3] }, { id: 'C', arrive: 2, bursts: [1] }];
  const x = { kind: 'sched-tune', metric: 'response', workloads: [w], higher: false, target: 100 };
  // FCFS: A runs 0–5 (response 0), B 5–8 (4), C 8–9 (6): mean 10/3
  t.eq(C.evaluate(x, { policy: 'fcfs' }).score, Math.round(10 / 3 * 1000) / 1000, 'sched: FCFS mean response by hand');
  // RR q = 1: A 0–1, B 1–2, then A (back of the queue behind C? C arrives at 2) ... response C = 2 − 2 = 0 if C runs at 2
  const tr = K.simulate(w, { policy: 'rr', quantum: 1 }, 0);
  const first = {};
  for (const s of tr.segs) if (first[s.job] === undefined) first[s.job] = s.start;
  const mean = w.reduce((s, j) => s + first[j.id] - j.arrive, 0) / 3;
  t.eq(C.evaluate(x, { policy: 'rr', quantum: 1 }).score, Math.round(mean * 1000) / 1000, 'sched: RR mean response from its Gantt chart');
  t.ok(C.evaluate(Object.assign({}, x, { limits: { policies: ['rr'] } }), { policy: 'fcfs' }).limits.length === 1, 'sched: a policy not allowed');
  t.ok(C.evaluate(Object.assign({}, x, { limits: { quantum: [2, 4] } }), { policy: 'rr', quantum: 1 }).limits.length === 1, 'sched: a quantum out of range');
  const mix = Object.assign({}, x, { metric: 'mix', weights: { response: 1, turnaround: 0.5 } });
  const m = K.simulate(w, { policy: 'fcfs' }, 0).metrics.avg;
  t.eq(C.evaluate(mix, { policy: 'fcfs' }).score, Math.round((m.response + 0.5 * m.turnaround) * 1000) / 1000, 'sched: the weighted mix');
  // fairness: Jain's index of the slowdowns, by hand for FCFS: turnarounds 5, 7, 7 over work 5, 3, 1
  const sl = [5 / 5, 7 / 3, 7 / 1], jain = sl.reduce((a, b) => a + b) ** 2 / (3 * sl.reduce((a, b) => a + b * b, 0));
  t.ok(Math.abs(K.fairness(K.simulate(w, { policy: 'fcfs' }, 0)) - jain) < 1e-12, 'sched: fairness index by hand');
  t.eq(K.workloads({ hidden: { seed: 9, count: 3 } }), K.workloads({ hidden: { seed: 9, count: 3 } }), 'sched: the same seed, the same hidden workloads');
}

// ---- C kinds -----------------------------------------------------------------------------------------------------------------
{
  const x = C.kinds['sync-solution'].example();
  const r = C.evaluate(x, { src: 'int slot;\nvoid box_init(void) { }\nvoid post(int v) { slot = v; }\nint take(void) { return slot }\n' });
  t.ok(r.score === 0 && /compile/.test(r.problems.join(' ')), 'sync: code that does not compile scores nothing and says why');
  t.ok(C.evaluate(x, { src: x.solution.src + '\nint main(void) { return 0; }\n' }).limits.some((l) => /main/.test(l)), 'sync: a main of your own breaks the limits');
  t.ok(C.evaluate(x, { src: x.solution.src.replace('slot = v;', 'slot = v; sleep(1);') }).limits.some((l) => /sleep/.test(l)), 'sync: a forbidden call');
  t.ok(!C.evaluate(x, { src: x.solution.src.replace('slot = v;', 'slot = v; /* sleep(1); */') }).limits.length, 'sync: a forbidden name inside a comment does not count');
  // a mutex with a condition variable is another right answer
  const cv = '#include <pthread.h>\nint slot; int full = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\npthread_cond_t c = PTHREAD_COND_INITIALIZER;\nvoid box_init(void) { }\nvoid post(int v) { pthread_mutex_lock(&m); while (full) pthread_cond_wait(&c, &m); slot = v; full = 1; pthread_cond_broadcast(&c); pthread_mutex_unlock(&m); }\nint take(void) { pthread_mutex_lock(&m); while (!full) pthread_cond_wait(&c, &m); int v = slot; full = 0; pthread_cond_broadcast(&c); pthread_mutex_unlock(&m); return v; }\n';
  t.eq(C.evaluate(x, { src: cv }).score, 3, 'sync: a monitor with broadcast passes every test');
}
{
  const x = C.kinds.shell.example(), K = C.kinds.shell;
  t.eq(C.evaluate(x, { src: x.starter }).score, 5, 'shell: the starting shell passes only the five simple tests (it runs & as an argument, in the foreground)');
  const one = (input, extra) => K.runTest(x.solution.src, Object.assign({ input, seeds: [1, 2] }, extra));
  t.ok(one('echo hi | cat | cat\n', { expect: 'hi\n', foreground: true, reaped: true }).pass, 'shell: a longer pipeline');
  t.ok(!one('echo hi\n', { expect: 'ho\n' }).pass, 'shell: a wrong output fails');
}
// the diagram checker opens each kind's workspace on its sample: the ids must match
for (const c of (S.Checks || []).filter((c) => c.group === 'challenge-workspaces')) t.ok(ex.some((x) => 'challenge/' + x.id === c.hash), 'a checker scene for ' + c.hash + ' names a sample');
// ---- shell: zombies left at a prompt or at exit, and a SIGCHLD handler that blocks ----
{
  const k = C.kinds.shell, x = k.example(), sol = x.solution.src;
  const quick = { name: 'quick', input: 'true &\n\n\necho a\n', expect: 'a\n', noZombies: true, seeds: [1, 2] };
  t.ok(k.runTest(sol, quick).pass, 'the reference reaps a quick & job before the next line');
  const lazy = sol.replace('        while (waitpid(-1, NULL, WNOHANG) > 0)\n            ;\n', '');
  const r1 = k.runTest(lazy, quick);
  t.ok(!r1.pass && /still a zombie when it read/.test(r1.why), 'a shell that reaps & jobs only at the end leaves a zombie at a prompt: ' + r1.why);
  const never = lazy.replace('    while (wait(NULL) > 0)\n        ;\n', '');
  const r2 = k.runTest(never, Object.assign({}, quick, { input: 'echo a\ntrue &\n', expect: 'a\n' }));
  t.ok(!r2.pass && /zombie when the shell exits/.test(r2.why), 'one that never waits leaves a zombie at exit: ' + r2.why);
  const withHandler = (body) => '#include <signal.h>\n' + lazy.replace('void run_line', 'void onchld(int sig) {\n' + body + '\n}\n\nvoid run_line').replace('    char line[128];\n', '    char line[128];\n    signal(SIGCHLD, onchld);\n');
  const busy = { name: 'two jobs', input: 'sleep 3 &\ntrue &\necho a\necho b\n', expect: 'a\nb\n', seeds: [1, 2, 3] };
  const r3 = k.runTest(withHandler('    while (waitpid(-1, NULL, 0) > 0)\n        ;'), busy);
  t.ok(!r3.pass && /handler blocks in waitpid while process \d+ is still running/.test(r3.why), 'a handler that waits without WNOHANG is caught: ' + r3.why);
  const r4 = k.runTest(withHandler('    while (waitpid(-1, NULL, WNOHANG) > 0)\n        ;'), busy);
  t.ok(r4.pass, 'a handler with WNOHANG passes: ' + (r4.why || ''));
}

// ---- sync-solution: machine granularity and spec rows in the hidden tests ----
{
  const k = C.kinds['sync-solution'];
  const tally = { name: 'two tallies', expect: 'hits = 4\n', preemptions: 3, main: '#include <stdio.h>\nvoid *tally(void *arg) { for (int k = 0; k < 2; k++) add_hit(); return NULL; }\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, tally, NULL);\n    pthread_create(&b, NULL, tally, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    printf("hits = %d\\n", hits);\n    return 0;\n}\n' };
  const locked = '#include <pthread.h>\nint hits = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\nvoid add_hit(void) {\n    pthread_mutex_lock(&m);\n    hits++;\n    pthread_mutex_unlock(&m);\n}\n';
  const bare = '#include <pthread.h>\nint hits = 0;\nvoid add_hit(void) {\n    hits++;\n}\n';
  t.ok(k.runTest(bare, tally, false, {}).pass, 'at statement granularity an unlocked count++ cannot race');
  const r = k.runTest(bare, tally, false, { granularity: 'machine' });
  t.ok(!r.pass && /prints "hits = [23]/.test(r.why), 'at machine granularity it does: ' + r.why);
  t.ok(k.runTest(locked, tally, false, { granularity: 'machine' }).pass, 'and a lock fixes it');
  const visit = { name: 'two visitors', expect: 'done\n', preemptions: 4, maxStates: 6000, main: '#include <stdio.h>\nvoid enter_room(void) { inside++; inside--; }\nvoid *visitor(void *arg) {\n    int me = (int) arg;\n    for (int k = 0; k < 2; k++) { lock_room(me); enter_room(); unlock_room(me); }\n    return NULL;\n}\nint main(void) {\n    pthread_t v0, v1;\n    pthread_create(&v0, NULL, visitor, (void *) 0);\n    pthread_create(&v1, NULL, visitor, (void *) 1);\n    pthread_join(v0, NULL);\n    pthread_join(v1, NULL);\n    printf("done\\n");\n    return 0;\n}\n' };
  const x = { granularity: 'machine', spec: [{ kind: 'never', what: 'in(enter_room) > 1' }, { kind: 'live', what: 'visitor calls enter_room' }] };
  const fair = '#include <pthread.h>\nint want[2];\nint favoured = 0;\nint inside = 0;\nvoid lock_room(int me) {\n    int other = 1 - me;\n    want[me] = 1;\n    favoured = other;\n    while (want[other] && favoured == other)\n        ;\n}\nvoid unlock_room(int me) {\n    want[me] = 0;\n}\n';
  const flags = '#include <pthread.h>\nint want[2];\nint inside = 0;\nvoid lock_room(int me) {\n    want[me] = 1;\n    while (want[1 - me])\n        ;\n}\nvoid unlock_room(int me) {\n    want[me] = 0;\n}\n';
  const rf = k.runTest(fair, Object.assign({ seeds: [1, 2] }, visit), false, x);
  t.ok(rf.pass, 'a fair gate passes its properties: ' + (rf.why || ''));
  const rs = k.runTest(flags, Object.assign({ seeds: [] }, visit), false, x);
  t.ok(!rs.pass && /can starve|stuck/.test(rs.why), 'flags alone can starve, and the test says who: ' + rs.why);
}

// ---- sched-tune on several cores and on real-time task sets; plain C with hidden tests ----
{
  const k = C.kinds['sched-tune'], xs = k.examples();
  t.eq(xs.map((x) => k.modeOf(x)), ['single', 'multi', 'rt'], 'a sample of each mode');
  for (const x of xs) { const r = C.lint(x); t.eq(r.problems, [], x.id + ' lints clean'); }
  const rt = xs[2];
  // independently: EDF meets every deadline when the utilisation is at most 1 (all D = T); every set here is
  t.ok(rt.taskSets.every((ts) => ts.reduce((a, q) => a + q.C / q.T, 0) <= 1), 'every hidden task set fits one CPU');
  t.eq(k.evaluate(rt, { policy: 'edf' }).score, 0, 'EDF misses nothing');
  t.ok(k.evaluate(rt, { policy: 'rm' }).score > 0, 'RM misses some deadlines on these sets');
  t.ok(/periodic/.test(C.evaluate(rt, { policy: 'rr', quantum: 2 }).problems[0]), 'a one-CPU policy is refused for a real-time challenge');
  const gen = k.rtSet(5, 3, 0.9);
  t.ok(gen.reduce((a, q) => a + q.C / q.T, 0) <= 0.9 + 1e-9, 'a generated task set keeps under its utilisation');
  const multi = xs[1];
  t.ok(/2 cores/.test(C.limitSentences(multi).join(' ')), 'the cores are named in the limits');
  t.ok(C.evaluate(multi, { policy: 'multi', queue: 'per-core', quantum: 1, push: 4, pull: true }).score !== null, 'a queue per core scores');
  const sync = C.kinds['sync-solution'].example();
  t.ok(/schedules/.test(C.limitSentences(sync).join(' ')), 'a threaded challenge talks of schedules');
  const ct = C.kinds['c-tests'].example();
  t.ok(!/schedule|preemption/.test(C.limitSentences(ct).join(' ')), 'a single-threaded challenge does not');
  const r = C.evaluate(ct, ct.wrong[1]);
  t.ok(r.details.some((d) => /prints "7\\n"|prints "7/.test(d)) && !r.details.some((d) => /schedule/.test(d)), 'its failures say what it printed: ' + r.details.join(' | '));
  t.eq(C.lint(ct).problems, [], 'c-tests sample lints clean');
}
t.done();
