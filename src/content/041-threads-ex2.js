// Part 4, threads: the exercises of chapter 3 (pools, fork-join, parallel loops, implicit threading and Amdahl's
// law). Who runs which iteration or task, and when, comes from S.P04.parfor, the model the parallel-loop topic draws
// (static blocks, cyclic, and dynamic chunks handed to the first idle worker); the C programs run on S.Kern.
(function (S) {
  'use strict';
  const C = S.Content, H = S.P04;
  if (!C || !H || C.exercises.has('thr-x-pool-why')) return;
  const amdahl = (s, n) => 1 / (s + (1 - s) / n);
  const r2 = (v) => Math.round(v * 100) / 100;

  C.exercise({ id: 'thr-x-pool-why', chapter: 'thr-patterns', title: 'Why keep a pool?', level: 1, kind: 'choice',
    text: ['A web server could start a new thread for every request, or keep a pool of 16 threads that take requests from a queue. Which is the strongest reason for the pool?'],
    options: ['It bounds the number of threads, so a flood of requests queues up instead of creating thousands of threads, and it saves a create and an exit per request', 'Threads in a pool run faster than new threads', 'A pool needs no locking around its queue'],
    answer: 0,
    whyNot: { 1: 'A pool thread runs the same code at the same speed; what the pool saves is the cost of creating and ending threads, and their number.', 2: 'The queue is shared by every worker: it needs a mutex and a condition variable like any shared structure.' },
    hints: ['What does a thread cost to create, and what happens to memory with ten thousand stacks?', 'A pool makes its threads once and keeps their number fixed; extra work waits in the queue.', 'The bound on the number of threads, plus no create and exit per request.'],
    solution: 0, wrong: [1, 2] });

  const PT = [3, 5, 2, 2, 4, 1], PP = H.parfor({ costs: PT, workers: 2, policy: 'dynamic', chunk: 1 });
  C.exercise({ id: 'thr-x-pool-finish', chapter: 'thr-patterns', title: 'Two workers, six tasks', level: 2, kind: 'number',
    text: ['A pool of 2 workers, W0 and W1, takes tasks from a queue in order. A worker that becomes idle takes the next task at once; when both are idle at the same moment, W0 takes first. The tasks cost ' + PT.join(', ') + ' time units. At what time is the last task finished?'],
    answer: PP.end, higherLower: true,
    whyNot: { [PT.reduce((a, b) => a + b, 0)]: 'That is the time with one worker; two work side by side.', [PT.reduce((a, b) => a + b, 0) / 2]: 'That would be a perfect split, but tasks cannot be cut in half: follow who takes what.', '*': 'Follow the two workers task by task: each idle worker takes the next task in the queue.' },
    hints: ['At time 0, W0 takes task 0 (cost 3) and W1 task 1 (cost 5).', 'W0 is free at 3 and takes task 2, then task 3 at 5. At 5 both are free: W0 takes task 3, W1 task 4.', 'W0 runs tasks 0, 2, 3 and 5 and is done at ' + PP.busy[0] + '; W1 runs tasks 1 and 4 and is done at ' + PP.busy[1] + '. The last task ends at ' + PP.end + '.'],
    solution: PP.end, wrong: [PT.reduce((a, b) => a + b, 0), PT.reduce((a, b) => a + b, 0) / 2] });

  const PR = PT.map((_, i) => 'task ' + i), PC = ['worker', 'starts', 'ends'];
  const seg = (i) => PP.segs.find((s) => s.it === i);
  const pcells = (f) => Object.fromEntries(PR.flatMap((r, i) => PC.map((c) => [r + '|' + c, f(i, c)])));
  const pval = (i, c) => (c === 'worker' ? 'W' + seg(i).w : String(c === 'starts' ? seg(i).start : seg(i).end));
  C.exercise({ id: 'thr-x-pool-table', chapter: 'thr-patterns', title: 'Who runs which task', level: 3, kind: 'table',
    text: ['The same pool and tasks as before: 2 workers, tasks costing ' + PT.join(', ') + ', the next task to the first idle worker, W0 first on a tie. For each task give the worker that runs it (W0 or W1), and when it starts and ends.'],
    rows: PR, cols: PC, corner: 'task', cells: pcells(pval),
    hints: ['Keep a clock for each worker: the time it next becomes idle.', 'Tasks 0 and 1 start at 0. Then the worker with the smaller clock takes the next task.', PR.map((r, i) => r + ': ' + pval(i, 'worker') + ', ' + pval(i, 'starts') + ' to ' + pval(i, 'ends')).join('; ') + '.'],
    solution: pcells(pval), wrong: [pcells((i, c) => (c === 'worker' ? 'W' + (i % 2) : pval(i, c))), pcells((i, c) => (i === 3 && c === 'worker' ? 'W1' : pval(i, c)))] });

  // ---- parallel loops -------------------------------------------------------------------------------------------
  const LC = [4, 1, 1, 3, 2, 2, 5, 1, 1, 2], LW = ['W0', 'W1', 'W2'];
  const run = (policy, chunk) => H.parfor({ costs: LC, workers: 3, policy, chunk: chunk || 1 });
  const costTable = { table: [['Iteration', ...LC.map((_, i) => String(i))], ['Cost', ...LC.map(String)]] };
  const ST = run('static'), stIts = LW.map((_, w) => ST.segs.filter((s) => s.w === w).map((s) => s.it));
  const SC = ['first', 'last', 'busy until'];
  const scells = (f) => Object.fromEntries(LW.flatMap((r, w) => SC.map((c) => [r + '|' + c, f(w, c)])));
  const sval = (w, c) => String(c === 'first' ? stIts[w][0] : c === 'last' ? stIts[w][stIts[w].length - 1] : ST.busy[w]);
  C.exercise({ id: 'thr-x-parfor-static', chapter: 'thr-patterns', title: 'Static blocks', level: 1, kind: 'table',
    text: ['A loop of 10 iterations is split into static blocks over 3 workers: each worker gets one run of consecutive iterations, and since 10 does not divide by 3, the first block is one longer. The iterations cost:', costTable, 'For each worker, give its first and last iteration and the time it finishes (it runs its iterations one after another from time 0).'],
    rows: LW, cols: SC, corner: 'worker', cells: scells(sval),
    hints: ['10 iterations over 3 workers: blocks of 4, 3 and 3.', 'W0 gets iterations 0 to 3, W1 4 to 6, W2 7 to 9. Add up each block\'s costs.', LW.map((r, w) => r + ': ' + sval(w, 'first') + ' to ' + sval(w, 'last') + ', busy until ' + sval(w, 'busy until')).join('; ') + '.'],
    solution: scells(sval), wrong: [scells((w, c) => String(c === 'first' ? [0, 3, 6][w] : c === 'last' ? [2, 5, 9][w] : sval(w, c))), scells((w, c) => (c === 'busy until' ? String([10, 7, 5][w]) : sval(w, c)))] });

  const POL = [['static blocks', 'static'], ['cyclic', 'cyclic'], ['dynamic, one at a time', 'dynamic']], ENDS = Object.fromEntries(POL.map(([n, p]) => [n, run(p).end]));
  const ecells = (f) => Object.fromEntries(POL.map(([n]) => [n + '|loop ends', f(n)]));
  C.exercise({ id: 'thr-x-parfor-three', chapter: 'thr-patterns', title: 'Three ways to share a loop', level: 2, kind: 'table',
    text: ['The same 10 iterations and 3 workers:', costTable, 'Static blocks: 0–3, 4–6, 7–9. Cyclic: iteration i goes to worker i mod 3. Dynamic: an idle worker takes the next single iteration (the lowest-numbered idle worker first on a tie). When does the loop end under each?'],
    rows: POL.map(([n]) => n), cols: ['loop ends'], corner: 'split', cells: ecells((n) => ENDS[n]),
    hints: ['The loop ends when its busiest worker finishes: add up each worker\'s costs.', 'Cyclic gives W0 iterations 0, 3, 6 and 9, which happen to hold most of the cost.', 'Static ' + ENDS['static blocks'] + ', cyclic ' + ENDS.cyclic + ', dynamic ' + ENDS['dynamic, one at a time'] + '. The total is ' + ST.total + ', so no split can end before ' + Math.ceil(ST.total / 3) + '.'],
    solution: ecells((n) => String(ENDS[n])), wrong: [ecells((n) => String(n === 'cyclic' ? 8 : ENDS[n])), ecells(() => String(Math.ceil(ST.total / 3)))] });

  const D2 = run('dynamic', 2), D1 = run('dynamic', 1), D3 = run('dynamic', 3);
  C.exercise({ id: 'thr-x-parfor-chunk', chapter: 'thr-patterns', title: 'Dynamic, two at a time', level: 3, kind: 'number',
    text: ['The same loop, now shared dynamically in chunks of 2: an idle worker takes the next 2 iterations (0–1, then 2–3, and so on), the lowest-numbered idle worker first on a tie.', costTable, 'When does the loop end?'],
    answer: D2.end, higherLower: true,
    whyNot: { [D1.end]: 'That is the end with chunks of 1. With chunks of 2, a worker commits to two iterations at a time.', '*': 'Keep a clock per worker; at each step the worker with the smallest clock takes the next pair.' },
    hints: ['The chunks cost: 0–1: 5, 2–3: 4, 4–5: 4, 6–7: 6, 8–9: 3.', 'At 0: W0 takes 0–1 (to 5), W1 2–3 (to 4), W2 4–5 (to 4). At 4, W1 takes 6–7 and W2 8–9.', 'W0 is busy until ' + D2.busy[0] + ', W1 until ' + D2.busy[1] + ', W2 until ' + D2.busy[2] + ': the loop ends at ' + D2.end + '. (Chunks of 3 would end at ' + D3.end + ': the best chunk depends on the costs.)'],
    solution: D2.end, wrong: [D1.end, D3.end] });

  const CY = run('cyclic').segs.filter((s) => s.w === 1).map((s) => s.it);
  C.exercise({ id: 'thr-x-cyclic-set', chapter: 'thr-patterns', title: 'Cyclic: whose iterations?', level: 2, kind: 'set',
    text: ['A loop of 10 iterations, numbered 0 to 9, is split cyclically over 3 workers W0, W1 and W2: iteration i goes to worker i mod 3. Which iterations does W1 run? Answer as a set, like {0, 5}.'],
    answer: '{' + CY.join(', ') + '}',
    hints: ['i mod 3 = 1 for W1.', 'Start at 1 and add 3 until you pass 9.', '{' + CY.join(', ') + '}.'],
    solution: '{' + CY.join(', ') + '}', wrong: ['{4, 5, 6}', '{1, 4, 7, 10}'] });

  const FN = 10, FK = 3, FR = [0, 1, 2].map((i) => 'thread ' + i), FC = ['lo', 'hi'];
  const fcells = (f) => Object.fromEntries(FR.flatMap((r, i) => FC.map((c) => [r + '|' + c, f(i, c)])));
  const fval = (i, c) => String(Math.floor(((c === 'lo' ? i : i + 1) * FN) / FK));
  C.exercise({ id: 'thr-x-slices', chapter: 'thr-patterns', title: 'Slices for fork-join', level: 1, kind: 'table',
    text: ['Fork-join sums an array of N = 10 numbers with K = 3 threads. Thread id sums from `lo = id * N / K` up to but not including `hi = (id + 1) * N / K`, in C\'s integer division. Give each thread\'s lo and hi.'],
    rows: FR, cols: FC, corner: 'thread', cells: fcells(fval),
    hints: ['Integer division drops the fraction: 10 / 3 is 3.', 'Thread 1: lo = 1 × 10 / 3 = 3, hi = 2 × 10 / 3 = 6.', FR.map((r, i) => r + ': ' + fval(i, 'lo') + ' to ' + fval(i, 'hi')).join('; ') + '. The last slice has 4 numbers, and together they cover 0 to 9 once each.'],
    solution: fcells(fval), wrong: [fcells((i, c) => String(c === 'lo' ? 3 * i : 3 * i + 3)), fcells((i, c) => (c === 'hi' ? String(+fval(i, c) - 1) : fval(i, c)))] });

  // ---- Amdahl's law ---------------------------------------------------------------------------------------------
  const A1 = r2(amdahl(0.1, 8));
  C.exercise({ id: 'thr-x-amdahl', chapter: 'thr-patterns', title: 'Eight cores, 10% serial', level: 1, kind: 'number',
    text: ['10% of a program must run on one core; the rest splits perfectly over any number of cores. What speed-up does it get on 8 cores? Give two decimals.'],
    answer: A1, tolerance: 0.006,
    whyNot: { 8: 'That would need the whole program to split. The serial 10% takes as long as ever.', 7.2: 'That is 8 × 0.9: Amdahl\'s law divides time, it does not multiply speed.', '*': 'Use speed-up(n) = 1 / (s + (1 − s) / n) with s = 0.1 and n = 8.' },
    hints: ['Amdahl\'s law: speed-up(n) = 1 / (s + (1 − s) / n), where s is the serial fraction.', 'The time on 8 cores is 0.1 + 0.9 / 8 = ' + String(+(0.1 + 0.9 / 8).toFixed(4)) + ' of the time on one.', '1 / (0.1 + 0.1125) = 1 / 0.2125 = ' + A1 + '.'],
    solution: A1, wrong: [8, 7.2] });

  let need = 1; while (amdahl(0.1, need) < 4 - 1e-9) need++;
  C.exercise({ id: 'thr-x-amdahl-cores', chapter: 'thr-patterns', title: 'How many cores for 4 times faster?', level: 2, kind: 'number',
    text: ['The same program, 10% serial. What is the smallest number of cores that gives a speed-up of at least 4?'],
    answer: need, higherLower: true,
    whyNot: { 4: 'With 4 cores the serial 10% keeps the speed-up down to ' + r2(amdahl(0.1, 4)) + '.', '*': 'Solve 1 / (0.1 + 0.9 / n) ≥ 4, then take the smallest whole n.' },
    hints: ['A speed-up of 4 means the time is a quarter: 0.1 + 0.9 / n ≤ 0.25.', '0.9 / n ≤ 0.15, so n ≥ 0.9 / 0.15.', 'n ≥ 6: six cores give exactly 1 / (0.1 + 0.15) = 4; five give ' + r2(amdahl(0.1, 5)) + '.'],
    solution: need, wrong: [4, 9] });

  // a measured speed-up of 2.5 on 4 cores: s + (1 - s)/4 = 0.4, so s = 0.2
  const SF = 0.2;
  C.exercise({ id: 'thr-x-amdahl-limit', chapter: 'thr-patterns', title: 'Reading s off a measurement', level: 2, kind: 'number',
    text: ['On 4 cores a program runs ' + r2(amdahl(SF, 4)) + ' times faster than on one. Assuming the parallel part splits perfectly, what fraction s of the program is serial? Give a decimal.'],
    answer: SF, tolerance: 0.005,
    whyNot: { 0.4: 'That is the time on 4 cores as a fraction of the time on one, s + (1 − s)/4. Solve it for s.', 0.6: 'That is the parallel share of the time on 4 cores, not the serial fraction.', '*': 'Write 1 / (s + (1 − s)/4) = 2.5 and solve for s.' },
    hints: ['A speed-up of 2.5 means the time is 1 / 2.5 = 0.4 of the time on one core.', 's + (1 − s)/4 = 0.4; multiply by 4: 4s + 1 − s = 1.6.', '3s = 0.6, so s = 0.2. No number of cores can then beat 1 / s = 5.'],
    solution: SF, wrong: [0.4, 0.6] });

  C.exercise({ id: 'thr-x-concurrent', chapter: 'thr-patterns', title: 'Concurrent, but not parallel', level: 1, kind: 'choice',
    text: ['A program with 4 threads runs on a machine with one core. Which is true?'],
    options: ['The threads run concurrently, taking turns, but not in parallel: the program is not faster, though it can stay responsive while one thread waits', 'The threads run in parallel, four at once', 'The program is four times faster than with one thread'],
    answer: 0,
    whyNot: { 1: 'Parallel means at the same instant, which needs as many cores.', 2: 'On one core the computing still takes the same total time, plus the switches.' },
    hints: ['Concurrency is about structure: several things in progress. Parallelism is about doing several things at the same instant.', 'How many instructions can one core run at once?', 'Concurrent but not parallel. Threads still help there: while one waits for I/O, another runs.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'thr-x-implicit', chapter: 'thr-patterns', title: 'Who makes the threads?', level: 1, kind: 'choice',
    text: ['In implicit threading, a programmer marks a loop as parallel, or hands small tasks to a runtime. Who then decides how many threads to make and which thread runs which piece?'],
    options: ['The runtime library or compiler, usually with a pool of about one thread per core', 'The programmer, with a pthread_create per piece', 'The kernel, one thread per loop iteration'],
    answer: 0,
    whyNot: { 1: 'That is explicit threading, the opposite.', 2: 'One thread per iteration would cost far more than most iterations are worth; the runtime batches them onto a few threads.' },
    hints: ['"Implicit": the threads are not written in the program.', 'The programmer says what may run in parallel, not how.', 'The runtime (or the compiler\'s support library) picks the threads, typically a pool sized to the cores, and shares the pieces out, as in the parallel loops of this chapter.'],
    solution: 0, wrong: [1, 2] });

  // ---- code ---------------------------------------------------------------------------------------------------
  const SUM_START = '#include <stdio.h>\n#include <pthread.h>\n\n#define N 10\n#define K 3\n\nint data[N] = {5, 3, 8, 1, 9, 2, 7, 4, 6, 10};\nint part[K];\n\n/* thread id adds up data[id * N / K] .. data[(id + 1) * N / K - 1] into part[id] */\nvoid *sum(void *arg) {\n    int id = (int)(long)arg;\n\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t[K];\n    for (long id = 0; id < K; id++)\n        pthread_create(&t[id], NULL, sum, (void *)id);\n    int total = 0;\n    /* join every thread, then add up the parts */\n\n    printf("total = %d\\n", total);\n    return 0;\n}\n';
  const SUM = SUM_START.replace('    int id = (int)(long)arg;\n\n', '    int id = (int)(long)arg;\n    int lo = id * N / K, hi = (id + 1) * N / K;\n    int s = 0;\n    for (int i = lo; i < hi; i++)\n        s += data[i];\n    part[id] = s;\n').replace('    /* join every thread, then add up the parts */\n\n', '    for (int id = 0; id < K; id++) {\n        pthread_join(t[id], NULL);\n        total += part[id];\n    }\n');
  C.exercise({ id: 'thr-x-code-sum', chapter: 'thr-patterns', title: 'Fork-join a sum', level: 2, kind: 'code',
    text: ['Finish the fork-join sum. Each thread adds up its own slice into its own slot of `part`, so no two threads write the same variable; main joins each thread before it reads that thread\'s part. The program must print `total = 55` under every schedule.'],
    starter: SUM_START,
    tests: [{ name: 'sum of ten', stdout: 'total = 55\n', seeds: [1, 2, 3, 4, 5, 6] }],
    hints: ['Work out lo and hi from id, sum data[lo] to data[hi − 1] in a local, then store it in part[id].', 'In main, part[id] is ready only after pthread_join(t[id], NULL) returns.', 'In sum: int lo = id * N / K, hi = (id + 1) * N / K; int s = 0; for (int i = lo; i < hi; i++) s += data[i]; part[id] = s;  In main: for each id, pthread_join(t[id], NULL); total += part[id];'],
    solution: SUM,
    wrong: [SUM.replace('    for (int id = 0; id < K; id++) {\n        pthread_join(t[id], NULL);\n        total += part[id];\n    }\n', '    for (int id = 0; id < K; id++)\n        total += part[id];\n    for (int id = 0; id < K; id++)\n        pthread_join(t[id], NULL);\n'), SUM.replace('int lo = id * N / K, hi = (id + 1) * N / K;', 'int lo = id * (N / K), hi = (id + 1) * (N / K);')] });

  const DYN_START = '#include <stdio.h>\n#include <pthread.h>\n\n#define N 6\n\nint next = 0;\nint done[N];\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n\n/* take iterations one at a time: i = next++ (under m), stop when i >= N,\n   else add (i + 1) * (i + 1) to done[i] */\nvoid *worker(void *arg) {\n\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, worker, NULL);\n    pthread_create(&b, NULL, worker, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    int total = 0;\n    for (int i = 0; i < N; i++)\n        total += done[i];\n    printf("total = %d\\n", total);\n    return 0;\n}\n';
  const DYN_BODY = '    while (1) {\n        pthread_mutex_lock(&m);\n        int i = next++;\n        pthread_mutex_unlock(&m);\n        if (i >= N)\n            break;\n        done[i] = done[i] + (i + 1) * (i + 1);\n    }\n';
  const DYN = DYN_START.replace('void *worker(void *arg) {\n\n', 'void *worker(void *arg) {\n' + DYN_BODY);
  C.exercise({ id: 'thr-x-code-dynamic', chapter: 'thr-patterns', title: 'A loop shared dynamically', level: 3, kind: 'code', granularity: 'machine',
    text: ['Two workers share a loop of N = 6 iterations dynamically: each repeatedly claims the next unclaimed iteration from the shared counter `next`, and stops when none is left. Every iteration must run exactly once, so the program prints `total = 91` (1 + 4 + 9 + 16 + 25 + 36). Claim an iteration under the mutex, and do the work outside it. The checker treats `next++` as the load, add and store it is, so an unguarded claim can race.'],
    starter: DYN_START,
    tests: [{ name: 'every iteration once', stdout: 'total = 91\n', seeds: [1, 2, 3, 4, 5, 6, 7, 8] }],
    mc: { deadlock: true, preemptions: 1, maxStates: 20000 },
    hints: ['Reading next and moving it on must happen together, or two workers can claim the same iteration: hold m for both.', 'Release m on every path, also the one that stops: unlock before testing i >= N.', DYN_BODY.replace(/\n\s*/g, ' ').trim()],
    solution: DYN,
    wrong: [DYN_START.replace('void *worker(void *arg) {\n\n', 'void *worker(void *arg) {\n' + DYN_BODY.replace('        pthread_mutex_lock(&m);\n', '').replace('        pthread_mutex_unlock(&m);\n', '')),
      DYN_START.replace('void *worker(void *arg) {\n\n', 'void *worker(void *arg) {\n' + '    while (1) {\n        pthread_mutex_lock(&m);\n        int i = next++;\n        if (i >= N)\n            break;\n        pthread_mutex_unlock(&m);\n        done[i] = done[i] + (i + 1) * (i + 1);\n    }\n')] });
})(globalThis.Proses = globalThis.Proses || {});
