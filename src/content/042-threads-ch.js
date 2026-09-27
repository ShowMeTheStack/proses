// Part 4, threads: the challenges (a parallel loop runner, and initialisation done exactly once), the guided tour, the course, and the pages the diagram checker looks at. Both
// challenges are scored by the sync-solution kind: each hidden test appends a main to the reader's code, the model
// checker explores its schedules up to a preemption bound, and seeded random schedules try it again.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('thr-ch-loop')) return;
  const HDR = '#include <stdio.h>\n#include <pthread.h>\n';

  // ---- 1. a parallel loop runner: every index once, really concurrently ---------------------------------------------
  const LOOP = '#include <pthread.h>\n\nint next_i, last_n;\nvoid (*job)(int);\npthread_mutex_t lm = PTHREAD_MUTEX_INITIALIZER;\n\nvoid *runner(void *arg) {\n    while (1) {\n        pthread_mutex_lock(&lm);\n        int i = next_i;\n        next_i = i + 1;\n        pthread_mutex_unlock(&lm);\n        if (i >= last_n)\n            break;\n        job(i);\n    }\n    return NULL;\n}\n\nvoid run_loop(int n, int workers, void (*fn)(int)) {\n    pthread_t t[8];\n    next_i = 0;\n    last_n = n;\n    job = fn;\n    for (int w = 0; w < workers; w++)\n        pthread_create(&t[w], NULL, runner, NULL);\n    for (int w = 0; w < workers; w++)\n        pthread_join(t[w], NULL);\n}\n';
  const ADD = 'pthread_mutex_t am = PTHREAD_MUTEX_INITIALIZER;\nint total = 0;\nint hits[8];\nvoid add(int i) {\n    pthread_mutex_lock(&am);\n    total = total + (i + 1) * (i + 1);\n    hits[i] = hits[i] + 1;\n    pthread_mutex_unlock(&am);\n}\n';
  C.challenge({ id: 'thr-ch-loop', n: 41, title: 'Every crate, once', level: 2, kind: 'sync-solution',
    story: 'An orchard co-op scans its crates with a few scanner threads. Crate i must be scanned exactly once: scanned twice, it is billed twice; missed, it is lost. Some scans cannot finish alone: a scanner may have to wait for the scanner of a neighbouring crate to start before it can weigh a shared pallet, so the crates must really be in progress at the same time, not one after another.\n\nWrite `run_loop(n, workers, fn)`. It calls `fn(i)` exactly once for every i from 0 to n − 1, using `workers` threads (at most 8) that each take the next unclaimed index, and returns only when every call has finished.',
    task: 'Write `void run_loop(int n, int workers, void (*fn)(int))`: fn(0) .. fn(n − 1), each exactly once, run by `workers` threads at once, all finished before it returns.',
    metricName: 'tests passed', target: 4, marks: { gold: 4 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield'], maxLines: 45, noMain: true },
    starter: '#include <pthread.h>\n\nvoid run_loop(int n, int workers, void (*fn)(int)) {\n    for (int i = 0; i < n; i++)\n        fn(i);\n}\n',
    tests: [
      { name: 'six crates, two scanners', visible: true, preemptions: 1, expect: '91 1 1 1 1 1 1\n', main: HDR + ADD + 'int main(void) {\n    run_loop(6, 2, add);\n    printf("%d %d %d %d %d %d %d\\n", total, hits[0], hits[1], hits[2], hits[3], hits[4], hits[5]);\n    return 0;\n}\n' },
      { name: 'two scans that meet', expect: 'met\n', main: HDR + 'pthread_mutex_t mm = PTHREAD_MUTEX_INITIALIZER;\npthread_cond_t mc = PTHREAD_COND_INITIALIZER;\nint started = 0;\nvoid meet(int i) {\n    pthread_mutex_lock(&mm);\n    if (i == 1) {\n        started = 1;\n        pthread_cond_signal(&mc);\n    } else {\n        while (!started)\n            pthread_cond_wait(&mc, &mm);\n    }\n    pthread_mutex_unlock(&mm);\n}\nint main(void) {\n    run_loop(2, 2, meet);\n    printf("met\\n");\n    return 0;\n}\n' },
      { name: 'five crates, three scanners', expect: '55 1 1 1 1 1\n', preemptions: 1, main: HDR + ADD + 'int main(void) {\n    run_loop(5, 3, add);\n    printf("%d %d %d %d %d %d\\n", total, hits[0], hits[1], hits[2], hits[3], hits[4]);\n    return 0;\n}\n' },
      { name: 'no crates', preemptions: 1, expect: '0\n', main: HDR + ADD + 'int main(void) {\n    run_loop(0, 2, add);\n    printf("%d\\n", total);\n    return 0;\n}\n' },
    ],
    hints: ['One loop in one thread cannot pass "two scans that meet": scan 0 waits for scan 1 to start. The calls must run in several threads at once.', 'Keep the next unclaimed index in a shared variable. A worker claims an index by reading it and moving it on under one mutex, then calls fn with the mutex released (fn may block). run_loop joins every worker before it returns.', 'Globals next_i, last_n, the function pointer and a mutex. runner: loop { lock; i = next_i; next_i = i + 1; unlock; if (i >= last_n) break; job(i); }. run_loop: set them, create `workers` runners, join them all.'],
    solution: { src: LOOP },
    wrong: [{ src: '#include <pthread.h>\n\nvoid run_loop(int n, int workers, void (*fn)(int)) {\n    for (int i = 0; i < n; i++)\n        fn(i);\n}\n' }, { src: LOOP.replace('        pthread_mutex_lock(&lm);\n', '').replace('        pthread_mutex_unlock(&lm);\n', '') }] });

  // ---- 2. load the configuration exactly once ----------------------------------------------------------------------
  const LOADER = '/* given: do not change load_config */\nint loads = 0;\nint load_config(void) {\n    int n = loads;\n    loads = n + 1;\n    return 42;\n}\n\n';
  const ONCE = '#include <pthread.h>\n\n' + LOADER + 'pthread_mutex_t om = PTHREAD_MUTEX_INITIALIZER;\nint ready = 0;\nint value;\n\nint get_config(void) {\n    pthread_mutex_lock(&om);\n    if (!ready) {\n        value = load_config();\n        ready = 1;\n    }\n    int v = value;\n    pthread_mutex_unlock(&om);\n    return v;\n}\n';
  C.challenge({ id: 'thr-ch-once', n: 42, title: 'Read the settings once', level: 2, kind: 'sync-solution',
    story: 'A tram timetable server reads its settings file the first time any thread needs a setting. Reading it twice is not just slow: the file is rotated on every read, so a second read gets the wrong settings. The server starts many threads at once, and any of them may be first to ask.\n\nWrite `get_config()`. It must call `load_config()` exactly once (it is given at the top of the file and counts its calls in `loads`, which the hidden tests print), however the threads interleave, and every caller, first or not, must get the value it returned.',
    task: 'Write `int get_config(void)`, which calls the given `int load_config(void)` exactly once and returns its value to every caller.',
    metricName: 'tests passed', target: 3, marks: { gold: 3 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield'], maxLines: 35, noMain: true },
    starter: '#include <pthread.h>\n\n' + LOADER + 'int ready = 0;\nint value;\n\nint get_config(void) {\n    if (!ready) {\n        value = load_config();\n        ready = 1;\n    }\n    return value;\n}\n',
    tests: [
      { name: 'two threads ask at once', visible: true, expect: '84 1\n', main: HDR + 'int got[2];\nvoid *ask(void *arg) {\n    int id = (int)(long)arg;\n    got[id] = get_config();\n    return NULL;\n}\nint main(void) {\n    pthread_t t[2];\n    for (long i = 0; i < 2; i++)\n        pthread_create(&t[i], NULL, ask, (void *)i);\n    for (int i = 0; i < 2; i++)\n        pthread_join(t[i], NULL);\n    printf("%d %d\\n", got[0] + got[1], loads);\n    return 0;\n}\n' },
      { name: 'main asks too', expect: '126 1\n', preemptions: 1, main: HDR + 'int got[2];\nvoid *ask(void *arg) {\n    int id = (int)(long)arg;\n    got[id] = get_config();\n    return NULL;\n}\nint main(void) {\n    pthread_t t[2];\n    for (long i = 0; i < 2; i++)\n        pthread_create(&t[i], NULL, ask, (void *)i);\n    int mine = get_config();\n    for (int i = 0; i < 2; i++)\n        pthread_join(t[i], NULL);\n    printf("%d %d\\n", mine + got[0] + got[1], loads);\n    return 0;\n}\n' },
      { name: 'asked again later', expect: '42 42 1\n', main: HDR + 'int main(void) {\n    int a = get_config();\n    int b = get_config();\n    printf("%d %d %d\\n", a, b, loads);\n    return 0;\n}\n' },
    ],
    hints: ['The test "is it loaded yet?" and the load itself must happen as one step, or two threads can both see "not yet" and both load.', 'Hold a mutex from the test of ready to the point where ready is set, and read value under it too.', 'pthread_mutex_lock(&om); if (!ready) { value = load_config(); ready = 1; } int v = value; pthread_mutex_unlock(&om); return v;'],
    solution: { src: ONCE },
    wrong: [{ src: ONCE.replace('    pthread_mutex_lock(&om);\n', '').replace('    pthread_mutex_unlock(&om);\n', '') }, { src: ONCE.replace('        ready = 1;\n', '') }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'thr-tour', title: 'Tour: threads', blurb: 'One address space with several stacks, the threading models, create and join, fork in a threaded program, pools and Amdahl\'s law, in eight steps.',
    steps: [
      { route: 'part=threads', target: '#main', text: 'Part 4 of the catalogue: several flows of control inside one process, what they share, and ways to put them to work.' },
      { route: 'topic=thr-space', target: '#stageWrap', text: 'Two threads in one address space: one copy of the code, globals and heap, and a stack for each thread. Switch the input to fork to see two children that share nothing writable.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=thr-models', target: '#inputs', text: 'Choose a model: many-to-one stops every thread when one blocks; one-to-one lets each block alone.' },
      { route: 'topic=thr-join', target: '#stageWrap', text: 'pthread_create and pthread_join on real C: a thread that ends early keeps its value until main joins it.' },
      { route: 'topic=thr-fork', target: '#stageWrap', text: 'fork in a threaded program copies only the calling thread, and a lock held by another thread is copied held, for ever.' },
      { route: 'topic=thr-amdahl', target: '#stageWrap', text: 'Amdahl\'s law: with a fifth of the work serial, sixteen cores give a speed-up of 4, and no number of cores can pass 5.' },
      { route: 'learn', target: '[data-chapter="thr-basics"]', text: 'The lessons and exercises of this part start here: outputs of thread programs, the threading models by hand, and C to write and check.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'thr-course', title: 'Threads', blurb: 'All twelve topics of part 4, from one address space with several stacks to Amdahl\'s law, with lessons and exercises on the way.',
    steps: [
      { lesson: 'thr-why', note: 'What a thread is, against a forked child.' },
      { topic: 'thr-space', note: 'One address space, several stacks.' },
      { exercise: 'thr-x-fork-global', note: 'A child, then a thread.' },
      { topic: 'thr-share', note: 'Who sees what, address by address.' },
      { exercise: 'thr-x-shared', note: 'What two threads share.' },
      { lesson: 'thr-models', note: 'Who schedules a thread.' },
      { topic: 'thr-models', note: 'Many-to-one, one-to-one, many-to-many.' },
      { exercise: 'thr-x-model-finish', note: 'The same work under two models.' },
      { topic: 'thr-join', note: 'Create and join.' },
      { exercise: 'thr-x-arg', note: 'Passing &i to a thread.' },
      { exercise: 'thr-x-code-primes', note: 'Values back through join.' },
      { topic: 'thr-tls', note: 'A variable of each thread\'s own.' },
      { exercise: 'thr-x-code-status', note: 'One slot per thread.' },
      { topic: 'thr-cancel', note: 'Asynchronous against deferred.' },
      { exercise: 'thr-x-cancel-point', note: 'Where deferred cancellation stops.' },
      { lesson: 'thr-forkexec', note: 'fork copies one thread; exec ends them all.' },
      { topic: 'thr-fork', note: 'A lock copied held.' },
      { topic: 'thr-exec', note: 'exec with workers running.' },
      { exercise: 'thr-x-exec-out', note: 'Every output, exec included.' },
      { topic: 'thr-pool', note: 'A pool fed from a queue.' },
      { exercise: 'thr-x-pool-table', note: 'Who runs which task.' },
      { topic: 'thr-forkjoin', note: 'Split, work, join, combine.' },
      { exercise: 'thr-x-code-sum', note: 'Write a fork-join sum.' },
      { topic: 'thr-parfor', note: 'Static, cyclic, dynamic.' },
      { exercise: 'thr-x-parfor-three', note: 'Three splits of one loop.' },
      { topic: 'thr-amdahl', note: 'The serial part sets the ceiling.' },
      { exercise: 'thr-x-amdahl-cores', note: 'How many cores for 4 times faster.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson thr-why')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'threads').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['thr-x-shared', 'thr-x-first', 'thr-x-model-finish', 'thr-x-m2m-end', 'thr-x-arg', 'thr-x-code-primes', 'thr-x-cancel-point', 'thr-x-pool-table', 'thr-x-parfor-three', 'thr-x-cyclic-set', 'thr-x-amdahl'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course thr-course', hash: 'course=thr-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['thr-ch-loop', 'thr-ch-once']) S.Checks.push({ group: 'learn', name: 'thr challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
