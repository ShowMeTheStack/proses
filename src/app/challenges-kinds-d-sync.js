// Challenge kind 'sync-solution': synchronisation code in the C subset, checked by hidden tests. Each test is a
// main of its own appended to the reader's code; it passes when
//   - the model checker (S.MC.kernel + S.MC.check) explores its schedules, up to a preemption bound, and finds no
//     deadlock, no failed assertion and no crash, at least one run that finishes, and only expected outputs; and
//   - adversarial seeded random schedules (S.Kern.System, policy 'random') all finish with an expected output.
//   x: {kind: 'sync-solution', starter: 'C source', tests: [{name, main: 'C source with main', expect: 'output' |
//       [outputs], preemptions (2), maxStates (30000), seeds: [..] (1..4), maxSteps (20000), visible: true (the
//       workspace's Try it runs it)}], limits: {forbid: [names], maxLines, noMain}}
//   answer: {src}            score: the number of hidden tests passed (target: all of them)
// granularity: 'machine' (on the challenge, or a test) makes loads and stores steps, so count++ can race; spec rows
// (the Sync lab's: {kind: always | never | end | live | deadlock, what}; on the challenge or a test) are checked over
// every reachable state of each test's program, by the same checker as the code exercise kind (S.Check.os.specCheck):
// a broken invariant, a deadlock or a starving thread (no 'eventually', under weak fairness) fails the test.
// A program with no threads (no pthread_create or fork in the starter, the answer or any test) has one schedule:
// each test simply runs once, and the wording says so. The kind 'c-tests' is the same for plain single-threaded C
// (the page-replacement and working-set exercises of part 11): {kind: 'c-tests', starter, tests, limits}.
(function (S) {
  'use strict';
  const C = S.Challenges, KIT = () => S.ChallengeKit;
  const join = (src, t) => String(src || '') + '\n/* ---- the test ---- */\n' + t.main;
  const ok = (t, out) => [].concat(t.expect).includes(out);
  const stub = (x, src) => (x.limits && x.limits.noMain && !/\bint\s+main\s*\(/.test(S.ChallengeKit.bareCode(src)) ? src + '\nint main(void) { return 0; }\n' : src);
  const show = (s) => JSON.stringify(String(s)).slice(1, -1);

  const THREADS = /\b(pthread_create|fork)\s*\(/;
  /** does the challenge have threads at all (so schedules to search)? */
  const threaded = (x, src) => THREADS.test(String(src || '')) || THREADS.test(x.starter || '') || (x.tests || []).some((t) => THREADS.test(t.main || '')) || (x.solution && THREADS.test(x.solution.src || ''));
  /** a single-threaded test: one run */
  function runOnce(compiled, t) {
    const max = t.maxSteps || 200000;
    const sys = new S.Kern.System(compiled, { policy: 'fifo', snap: false, cow: false, input: t.input || '' });
    sys.run(max);
    const err = sys.trace.find((e) => e.kind === 'error');
    if (err) return { pass: false, why: 'the program crashes: ' + String(err.say).replace(/`/g, '') };
    if (sys.status() !== 'done') return { pass: false, why: 'it does not finish in ' + max + ' steps: it may loop for ever' };
    if (!ok(t, sys.out)) return { pass: false, why: 'it prints "' + show(sys.out) + '"' };
    return { pass: true, why: 'it prints the expected output' };
  }
  /** one hidden test: {pass, why} */
  function runTest(src, t, single, x) {
    x = x || {};
    const gran = t.granularity || x.granularity;
    const prog = join(src, t);
    let compiled;
    try { compiled = S.Kern.compile ? S.Kern.compile(prog) : S.CLang.compile(prog); } catch (e) { return { pass: false, why: 'it does not compile with this test: ' + (e.msg || e.message) }; }
    if (single || !THREADS.test(prog)) return runOnce(compiled, t);
    const spec = t.spec || x.spec;
    if (spec && spec.length && S.SyncLab && S.SyncLab.prepare) return runWithSpec(prog, compiled, t, spec, gran);
    const outs = new Set();
    let r;
    try { r = S.MC.check(S.MC.kernel(compiled, { failOnError: true, granularity: gran }), { terminal: (s) => outs.add(s.out) }, { preemptions: t.preemptions === undefined ? 2 : t.preemptions, maxStates: t.maxStates || 30000, minimal: false }); } catch (e) { return { pass: false, why: 'the checker stopped: ' + (e.message || e) }; }
    if (r.violation) return { pass: false, why: r.violation.kind === 'deadlock' ? 'some schedule deadlocks: every thread left is blocked' : 'some schedule ' + (r.violation.kind === 'assert' ? 'fails: ' : 'goes wrong: ') + (r.violation.say || r.violation.name || '') };
    if (!outs.size) return { pass: false, why: 'no schedule within the bound ever finishes: a thread spins or waits for good' };
    const bad = [...outs].find((o) => !ok(t, o));
    if (bad !== undefined) return { pass: false, why: 'some schedule prints "' + show(bad) + '"' };
    for (const seed of t.seeds || [1, 2, 3, 4]) {
      const sys = new S.Kern.System(compiled, { policy: 'random', seed, snap: false, cow: false, granularity: gran });
      sys.run(t.maxSteps || 20000);
      const st = sys.status();
      if (st !== 'done') return { pass: false, why: 'a random schedule (seed ' + seed + ') ' + (st === 'deadlock' ? 'deadlocks' : 'does not finish in ' + (t.maxSteps || 20000) + ' steps') };
      if (!ok(t, sys.out)) return { pass: false, why: 'a random schedule (seed ' + seed + ') prints "' + show(sys.out) + '"' };
    }
    return { pass: true, why: 'every schedule checked prints the expected output' };
  }
  /** seeded random schedules: null when all finish with an expected output, else the reason */
  function randomRuns(compiled, t, gran) {
    for (const seed of t.seeds || [1, 2, 3, 4]) {
      const sys = new S.Kern.System(compiled, { policy: 'random', seed, snap: false, cow: false, granularity: gran });
      sys.run(t.maxSteps || 20000);
      const st = sys.status();
      if (st !== 'done') return 'a random schedule (seed ' + seed + ') ' + (st === 'deadlock' ? 'deadlocks' : 'does not finish in ' + (t.maxSteps || 20000) + ' steps');
      if (!ok(t, sys.out)) return 'a random schedule (seed ' + seed + ') prints "' + show(sys.out) + '"';
    }
    return null;
  }
  /**
   * A test with properties: one graph of the reachable states serves everything. The Sync lab's checker (SL.check)
   * builds it, judges every state (the properties, a deadlock, a failed assert) and runs the liveness pass on the same
   * graph; the outputs are read off its finished states. Only when the graph is cut short by its bound does the
   * bounded search over schedules run as well, so a complete graph is searched once, not twice.
   */
  function runWithSpec(prog, compiled, t, spec, gran) {
    const SL = S.SyncLab;
    const rows = spec.some((r) => r.kind === 'deadlock') ? spec : spec.concat([{ kind: 'deadlock', what: '' }]);
    const P = SL.prepare({ src: prog, spec: rows, gran: gran === 'machine' ? 'machine' : 'statement' });
    if (P.error) return { pass: false, why: 'it does not compile with this test: ' + (P.error.msg || P.error.message) };
    if (P.spec.errors.length) return { pass: false, why: 'the test\'s properties cannot be read: ' + P.spec.errors[0] };
    let G = null, R;
    const g0 = S.MC.graph;
    S.MC.graph = function () { return (G = g0.apply(this, arguments)); };
    try { R = SL.check(P, { search: 'full', maxStates: t.maxStates || 6000, preempt: t.preemptions === undefined ? Infinity : t.preemptions }); }
    catch (e) { return { pass: false, why: 'the checker stopped: ' + (e.message || e) }; }
    finally { S.MC.graph = g0; }
    const replay = R.schedule ? { src: prog, spec: rows, gran: P.gran, schedule: R.schedule.slice(), cycleFrom: R.cycleFrom, cycleLen: R.cycleLen } : null;
    if (R.verdict === 'violation') {
      const why = R.kind === 'deadlock' ? 'some schedule deadlocks: every thread left is blocked' : R.kind === 'assert' ? 'some schedule fails: ' + String(R.violationSay || '').replace(/`/g, '') : 'the property "' + R.name + '" breaks in some schedule';
      return { pass: false, why, replay };
    }
    if (R.verdict === 'starve') {
      const who = String(R.name || '').replace(/ eventually calls .*$/, ''), what = (/ eventually calls (\w+)/.exec(R.name || '') || [])[1];
      return { pass: false, why: R.kind === 'stuck' ? who + ' can be stuck for ever' : who + ' can starve: the others go round a cycle of ' + R.cycleLen + ' steps and ' + who + ' never ' + (what ? 'calls ' + what : 'gets in'), replay };
    }
    const outs = new Set((G ? G.nodes : []).filter((nd) => nd.sys.status() === 'done').map((nd) => (nd.sys.sys ? nd.sys.sys.out : '')));
    if (!G || !G.complete) {
      // the graph was cut short: the bounded search over schedules adds what it reaches
      let r;
      try { r = S.MC.check(S.MC.kernel(compiled, { failOnError: true, granularity: gran }), { terminal: (q) => outs.add(q.out) }, { preemptions: t.preemptions === undefined ? 2 : t.preemptions, maxStates: t.maxStates || 30000, minimal: false }); } catch (e) { return { pass: false, why: 'the checker stopped: ' + (e.message || e) }; }
      if (r.violation) return { pass: false, why: r.violation.kind === 'deadlock' ? 'some schedule deadlocks: every thread left is blocked' : 'some schedule fails: ' + (r.violation.say || r.violation.name || '') };
    }
    if (!outs.size) return { pass: false, why: 'no schedule within the bound ever finishes: a thread spins or waits for good' };
    const bad = [...outs].find((o) => !ok(t, o));
    if (bad !== undefined) return { pass: false, why: 'some schedule prints "' + show(bad) + '"' };
    const rr = randomRuns(compiled, t, gran);
    if (rr) return { pass: false, why: rr };
    return { pass: true, why: 'every schedule prints the expected output, and every property holds' };
  }

  const kind = (C.kinds['sync-solution'] = {
    runTest, remote: true,
    start: (x) => ({ src: x.starter || '' }),
    evaluate(x, a) {
      const src = a && typeof a === 'object' ? a.src : String(a || '');
      const c = KIT().compiles(stub(x, src));
      if (c.err) return { score: 0, n: x.tests.length, problems: ['your code does not compile: ' + (c.err.msg || c.err.message)] };
      let pass = 0;
      const single = x.kind === 'c-tests' || !threaded(x, src);
      const details = x.tests.map((t, i) => { const r = runTest(src, t, single, x); if (r.pass) pass++; return 'Test ' + (i + 1) + (t.name ? ' (' + t.name + ')' : '') + ': ' + (r.pass ? 'passed.' : 'failed: ' + r.why + '.'); });
      return { score: pass, n: x.tests.length, details };
    },
    async evaluateAsync(x, a) { await new Promise((r) => setTimeout(r, 30)); return kind.evaluate(x, a); },
    limitsProblems: (x, a) => KIT().cLimits(x, a && typeof a === 'object' ? a.src : String(a || '')),
    limitSentences: (x) => KIT().cLimitSentences(x).concat([x.kind !== 'c-tests' && threaded(x) ? 'Every hidden test explores the schedules up to a few preemptions, then tries random schedules.' : 'Every hidden test runs your code once and compares what it prints.']),
    lint(x) {
      const out = [];
      if (!(x.tests || []).length) out.push('no tests');
      (x.tests || []).forEach((t, i) => { if (!/\bmain\s*\(/.test(t.main || '')) out.push('test ' + (i + 1) + ' has no main'); if (t.expect === undefined) out.push('test ' + (i + 1) + ' expects nothing'); });
      if (x.target !== (x.tests || []).length) out.push('the target should be every test (' + (x.tests || []).length + ')');
      return out;
    },
    workspace(host, x, draft, onChange) {
      const vis = (x.tests || []).find((t) => t.visible) || null, many = x.kind !== 'c-tests' && threaded(x);
      return KIT().codeWorkspace(host, x, draft, onChange, {
        prefix: (src) => stub(x, src),
        sideTitle: vis ? 'Try the sample test' : 'Check it compiles', tryLabel: vis ? 'Run the sample' : 'Compile',
        note: many ? (vis ? 'The sample test runs once here, with the schedule chosen by seed 1. Submitting runs it and the hidden tests over many schedules.' : 'Submitting runs the hidden tests over many schedules.') : (vis ? 'The sample test runs here as it will when you submit; the hidden tests are more of the same kind.' : 'Submitting runs the hidden tests.'),
        show: vis ? { title: 'The sample test: ' + (vis.name || ''), src: vis.main } : null,
        tryIt(src) {
          if (!vis) return { ok: true, say: 'It compiles.', out: '' };
          let sys;
          try { sys = new S.Kern.System(join(src, vis), { policy: many ? 'random' : 'fifo', seed: 1, snap: false, cow: false }); sys.run(vis.maxSteps || (many ? 20000 : 200000)); } catch (e) { return { ok: false, say: 'With the sample test it does not compile: ' + (e.msg || e.message), out: '' }; }
          const st = sys.status(), good = st === 'done' && ok(vis, sys.out);
          return { ok: good, say: st === 'deadlock' ? (many ? 'Deadlock: every thread left is blocked.' : 'It is stuck waiting for something that never comes.') : st !== 'done' ? 'It has not finished after ' + (vis.maxSteps || (many ? 20000 : 200000)) + ' steps.' : good ? 'It printed what the test expects.' : 'It printed something the test does not expect: ' + [].concat(vis.expect).map((e) => '"' + show(e) + '"').join(' or ') + ' is expected.', out: sys.out };
        },
      });
    },
    example: () => ({
      id: 'sample-sync-mailbox', n: 902, title: 'A one-slot mailbox', level: 2, kind: 'sync-solution', sample: true,
      story: 'Two parts of a weather station share a single mailbox: the sensor threads drop readings into it, and the logger takes them out. The mailbox holds one reading at a time. A reading must never be lost or read twice, and nobody may spin while they wait.\n\nWrite `box_init`, `post` and `take` with semaphores or a mutex and condition variables.',
      task: 'Write `void box_init(void)`, `void post(int v)` (waits while the box is full) and `int take(void)` (waits while it is empty).',
      metricName: 'tests passed', target: 3, marks: { gold: 3 },
      limits: { forbid: ['sleep', 'usleep'], maxLines: 40, noMain: true },
      starter: '#include <pthread.h>\n#include <semaphore.h>\n\nint slot;\n\nvoid box_init(void) {\n}\n\nvoid post(int v) {\n    slot = v;\n}\n\nint take(void) {\n    return slot;\n}\n',
      tests: [
        { name: 'one sensor, three readings', visible: true, expect: '1 2 3\n', main: '#include <stdio.h>\nvoid *sensor(void *arg) { post(1); post(2); post(3); return 0; }\nint main(void) {\n    box_init();\n    pthread_t s;\n    pthread_create(&s, NULL, sensor, NULL);\n    int a = take(); int b = take(); int c = take();\n    pthread_join(s, NULL);\n    printf("%d %d %d\\n", a, b, c);\n    return 0;\n}\n' },
        { name: 'two sensors', expect: '33\n', preemptions: 1, main: '#include <stdio.h>\nvoid *s1(void *arg) { post(1); post(2); return 0; }\nvoid *s2(void *arg) { post(10); post(20); return 0; }\nint main(void) {\n    box_init();\n    pthread_t a, b;\n    pthread_create(&a, NULL, s1, NULL); pthread_create(&b, NULL, s2, NULL);\n    int sum = 0;\n    for (int i = 0; i < 4; i++) sum += take();\n    pthread_join(a, NULL); pthread_join(b, NULL);\n    printf("%d\\n", sum);\n    return 0;\n}\n' },
        { name: 'the logger first', expect: '7\n', main: '#include <stdio.h>\nint got;\nvoid *logger(void *arg) { got = take(); return 0; }\nint main(void) {\n    box_init();\n    pthread_t l;\n    pthread_create(&l, NULL, logger, NULL);\n    post(7);\n    pthread_join(l, NULL);\n    printf("%d\\n", got);\n    return 0;\n}\n' },
      ],
      hints: ['Count two things: the free places in the box (one at the start) and the readings in it (none at the start). A semaphore is a counter that makes a thread wait at zero.', 'post waits for a free place, puts the reading in, then announces a reading; take waits for a reading, takes it out, then announces a free place.', 'With `sem_t empty, full;`: box_init does `sem_init(&empty, 0, 1); sem_init(&full, 0, 0);`, post does `sem_wait(&empty); slot = v; sem_post(&full);`, and take does `sem_wait(&full); int v = slot; sem_post(&empty); return v;`.'],
      solution: { src: '#include <pthread.h>\n#include <semaphore.h>\n\nint slot;\nsem_t empty, full;\n\nvoid box_init(void) {\n    sem_init(&empty, 0, 1);\n    sem_init(&full, 0, 0);\n}\n\nvoid post(int v) {\n    sem_wait(&empty);\n    slot = v;\n    sem_post(&full);\n}\n\nint take(void) {\n    sem_wait(&full);\n    int v = slot;\n    sem_post(&empty);\n    return v;\n}\n' },
      wrong: [
        { src: '#include <pthread.h>\n\nint slot;\nint has = 0;\n\nvoid box_init(void) {\n}\n\nvoid post(int v) {\n    while (has)\n        ;\n    slot = v;\n    has = 1;\n}\n\nint take(void) {\n    while (!has)\n        ;\n    int v = slot;\n    has = 0;\n    return v;\n}\n' },
        { src: '#include <pthread.h>\n#include <semaphore.h>\n\nint slot;\nsem_t empty, full;\n\nvoid box_init(void) {\n    sem_init(&empty, 0, 1);\n    sem_init(&full, 0, 1);\n}\n\nvoid post(int v) {\n    sem_wait(&empty);\n    slot = v;\n    sem_post(&full);\n}\n\nint take(void) {\n    sem_wait(&full);\n    int v = slot;\n    sem_post(&empty);\n    return v;\n}\n' },
      ],
    }),
  });

  // ---- plain single-threaded C with hidden tests ----------------------------------------------------------------------
  C.kinds['c-tests'] = Object.assign({}, kind, {
    lint(x) { const out = kind.lint(x); if (threaded(x)) out.push('a c-tests challenge has no threads: use sync-solution for threaded code'); return out; },
    example: () => {
      const tests = [
        { name: 'a short string', visible: true, expect: '6\n', main: '#include <stdio.h>\nint main(void) {\n    int r[] = {4, 1, 4, 2, 5, 1, 4, 3};\n    printf("%d\\n", fifo_faults(r, 8, 3));\n    return 0;\n}\n' },
        { name: 'one frame', expect: '5\n', main: '#include <stdio.h>\nint main(void) {\n    int r[] = {2, 2, 3, 3, 2, 7, 7, 1};\n    printf("%d\\n", fifo_faults(r, 8, 1));\n    return 0;\n}\n' },
        { name: 'the oldest goes first', expect: '8\n', main: '#include <stdio.h>\nint main(void) {\n    int r[] = {3, 6, 8, 1, 6, 3, 2, 8, 1};\n    printf("%d\\n", fifo_faults(r, 9, 3));\n    return 0;\n}\n' },
        { name: 'more frames than pages', expect: '3\n', main: '#include <stdio.h>\nint main(void) {\n    int r[] = {9, 8, 9, 7, 8, 9};\n    printf("%d\\n", fifo_faults(r, 6, 5));\n    return 0;\n}\n' },
      ];
      const fifo = '#include <stdio.h>\n\nint fifo_faults(int *refs, int n, int frames) {\n    int mem[16];\n    int used = 0, next = 0, faults = 0;\n    for (int i = 0; i < n; i++) {\n        int hit = 0;\n        for (int k = 0; k < used; k++)\n            if (mem[k] == refs[i]) hit = 1;\n        if (hit) continue;\n        faults++;\n        if (used < frames) mem[used++] = refs[i];\n        else { mem[next] = refs[i]; next = (next + 1) % frames; }\n    }\n    return faults;\n}\n';
      return {
        id: 'sample-c-fifo', n: 904, title: 'Count the faults', level: 1, kind: 'c-tests', sample: true,
        story: 'A small tool replays the page references a program made and reports how often FIFO replacement would have faulted. Its core is one function.',
        task: 'Write `int fifo_faults(int *refs, int n, int frames)`: the faults FIFO makes on the n references with that many frames, all empty at the start (at most 16 frames).',
        metricName: 'tests passed', target: 4, marks: { gold: 4 },
        limits: { maxLines: 40, noMain: true },
        starter: '#include <stdio.h>\n\nint fifo_faults(int *refs, int n, int frames) {\n    return 0;\n}\n',
        tests,
        hints: ['Keep the pages in memory in an array, and the slot the next victim is in.', 'A hit leaves everything as it is; a fault fills a free frame, or replaces the oldest page and moves the victim slot on by one.', 'Loop over the references; on a fault, if used < frames put the page in mem[used++], else in mem[next] with next = (next + 1) % frames.'],
        solution: { src: fifo },
        wrong: [{ src: fifo.replace('if (hit) continue;', '') }, { src: fifo.replace('next = (next + 1) % frames;', '') }],
      };
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
