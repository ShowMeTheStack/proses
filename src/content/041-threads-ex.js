// Part 4, threads: the exercises of the first two chapters (threads and the address space; the thread API). Every
// output a program can print is enumerated by the simulated kernel (S.Kern.outcomes) when the answer is checked, and
// the threading-model times come from the model the topics draw (S.P04.mapSim), so nothing is typed from memory. The
// programs were also compiled with the system compiler and run many times: every real output is one listed here.
(function (S) {
  'use strict';
  const C = S.Content, H = S.P04;
  if (!C || !H || C.exercises.has('thr-x-shared')) return;
  const L = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };

  // =========================================================================================================
  // Chapter 1: threads and the address space
  // =========================================================================================================
  C.exercise({ id: 'thr-x-shared', chapter: 'thr-basics', title: 'What two threads share', level: 1, kind: 'choice',
    text: ['A process runs two threads, both started on the same function. Which of these do the two threads share? Pick every one that is shared.'],
    options: ['the global variables', 'the program counter', 'a block returned by malloc', 'the stack, with its local variables', 'the open file descriptors', 'the machine registers'],
    answer: [0, 2, 4],
    whyNot: { 1: 'Each thread is at its own place in the code, so each has its own program counter.', 3: 'Each thread has a stack of its own: that is where its calls and locals live.', 5: 'The registers are saved and restored per thread at every switch.' },
    hints: ['A thread is "the running part" of a process: whatever describes where it is and what it is computing right now is its own.', 'The program counter, the registers and the stack describe one thread\'s progress; the memory image and the kernel resources belong to the process.', 'Shared: the globals, the heap block and the open descriptors. Each thread keeps its own program counter, registers and stack.'],
    solution: [0, 2, 4], wrong: [[0, 2, 3, 4], [0, 2]] });

  C.exercise({ id: 'thr-x-locals', chapter: 'thr-basics', title: 'One local, two addresses', level: 1, kind: 'choice',
    text: ['Two threads run `void *work(void *arg) { int mine = 0; printf("%p\\n", (void *)&mine); ... }`. What do they print?', { code: 'void *work(void *arg) {\n    int mine = 0;\n    printf("%p\\n", (void *)&mine);\n    return NULL;\n}', lang: 'c' }],
    options: ['Two different addresses: each call of work has its own mine on its own thread\'s stack', 'The same address twice: both threads run the same function', 'The same address twice, as two forked children would'],
    answer: 0,
    whyNot: { 1: 'The code is shared, but each call\'s locals go in the frame on the calling thread\'s stack, and the two stacks are different blocks of memory.', 2: 'That is the case for forked children (the same virtual address in two address spaces), but threads share one address space, so two locals there must be at different addresses.' },
    hints: ['Where does a local variable live?', 'In the frame of the call, on the stack of the thread that made the call. Each thread has its own stack inside the one address space.', 'Two different addresses. In the topic the two workers\' locals were at 0x4024 and 0x6034, one on each thread\'s stack.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'thr-x-first', chapter: 'thr-basics', title: 'Who prints first?', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['Write every output this program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
    src: '#include <stdio.h>\n#include <pthread.h>\n\nvoid *hello(void *arg) {\n    printf("worker\\n");\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t;\n    pthread_create(&t, NULL, hello, NULL);\n    printf("main\\n");\n    pthread_join(t, NULL);\n    printf("joined\\n");\n    return 0;\n}\n',
    hints: ['After pthread_create both threads are ready: either may print first.', 'pthread_join returns only once the worker has ended, so "joined" comes after "worker" in every run.', 'Two outputs: worker main joined, and main worker joined.'],
    solution: ['worker main joined', 'main worker joined'], wrong: [['main worker joined'], ['worker main joined', 'main worker joined', 'main joined worker']] });

  C.exercise({ id: 'thr-x-fork-global', chapter: 'thr-basics', title: 'A child, then a thread', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['The child and the thread both change `x`. Write every output the program can produce, one a line.'],
    src: '#include <stdio.h>\n#include <pthread.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint x = 1;\n\nvoid *bump(void *arg) {\n    x = x + 10;\n    return NULL;\n}\n\nint main(void) {\n    if (fork() == 0) {\n        x = 5;\n        return 0;\n    }\n    wait(NULL);\n    pthread_t t;\n    pthread_create(&t, NULL, bump, NULL);\n    pthread_join(t, NULL);\n    printf("x = %d\\n", x);\n    return 0;\n}\n',
    hints: ['The child writes 5 into its own copy of x; the parent\'s copy is untouched.', 'The thread runs in the parent\'s address space, so its x is the parent\'s x, still 1.', 'One output: x = 11. The child\'s 5 vanished with the child; the thread\'s + 10 landed in the parent.'],
    solution: ['x = 11'], wrong: [['x = 15'], ['x = 11', 'x = 15']] });

  C.exercise({ id: 'thr-x-model-block', chapter: 'thr-basics', title: 'One blocking call', level: 1, kind: 'choice',
    text: ['A program has four user threads, all managed by a thread library on a single kernel thread (many-to-one). One of them calls `read` on a slow disk and the call blocks. What happens to the other three?'],
    options: ['They wait too: the one kernel thread is blocked in the kernel, so the library cannot switch to them', 'The library switches to another of them at once', 'The kernel runs them on other cores'],
    answer: 0,
    whyNot: { 1: 'The library can only switch while it is running, and it runs on the kernel thread that is now blocked inside read.', 2: 'The kernel sees one thread only, and that one is blocked; it knows nothing of the other three.' },
    hints: ['How many threads does the kernel know about in this program?', 'One. When it blocks, the kernel has nothing else of this process to run.', 'All four wait: the kernel thread is blocked in read, and the library, which would switch user threads, is not running.'],
    solution: 0, wrong: [1, 2] });

  // the same work under two models
  const MW = [[1, 3, 2], [2], [3]], MN = ['U0', 'U1', 'U2'], MC = ['many-to-one', 'one-to-one'];
  const MR = Object.fromEntries(MC.map((m) => [m, H.mapSim({ model: m, kernel: 2, cores: 2, work: MW }).finish]));
  const mcells = (f) => Object.fromEntries(MN.flatMap((u, i) => MC.map((m) => [u + '|' + m, f(i, m)])));
  C.exercise({ id: 'thr-x-model-finish', chapter: 'thr-basics', title: 'The same work, two models', level: 2, kind: 'table',
    text: ['Three user threads start at time 0 on a machine with 2 cores. U0 computes for 1 tick, waits 3 ticks in a blocking call, then computes 2 more; U1 computes for 2 ticks; U2 for 3. Free threads are taken first come, first served (U0, U1, U2), and in the many-to-one model a thread runs until it finishes or blocks. Give the tick at which each thread finishes under each model.'],
    rows: MN, cols: MC, corner: 'thread', cells: mcells((i, m) => MR[m][i]),
    hints: ['One-to-one: each user thread is a kernel thread, so two of them run at once and a blocking call holds up only its caller.', 'Many-to-one: one thread at a time, and while U0 waits in its call, nothing of the process runs at all: ticks 1 to 3 are lost.', 'Many-to-one: U0 ' + MR['many-to-one'][0] + ', U1 ' + MR['many-to-one'][1] + ', U2 ' + MR['many-to-one'][2] + '. One-to-one: U0 ' + MR['one-to-one'][0] + ', U1 ' + MR['one-to-one'][1] + ', U2 ' + MR['one-to-one'][2] + '.'],
    solution: mcells((i, m) => String(MR[m][i])), wrong: [mcells((i, m) => String(MR['one-to-one'][i])), mcells((i, m) => String(m === 'many-to-one' ? [3, 5, 8][i] : MR[m][i]))] });

  const W2 = [[2, 2, 1], [1, 3, 1], [3], [2]], M2 = H.mapSim({ model: 'many-to-many', kernel: 2, cores: 1, work: W2 }), M2b = H.mapSim({ model: 'many-to-many', kernel: 2, cores: 2, work: W2 });
  C.exercise({ id: 'thr-x-m2m-end', chapter: 'thr-basics', title: 'Two kernel threads, one core', level: 3, kind: 'number',
    text: ['A library maps four user threads onto a pool of 2 kernel threads (many-to-many), on a machine with a single core. The work, in ticks (computing, waiting in a blocking call, computing):', { table: [['Thread', 'Work'], ['U0', '2 compute, 2 wait, 1 compute'], ['U1', '1 compute, 3 wait, 1 compute'], ['U2', '3 compute'], ['U3', '2 compute']] }, 'The library gives a free kernel thread to the waiting user threads first come, first served (U0, U1, U2, U3); a user thread keeps its kernel thread, even while blocked, until it finishes. The core runs whichever ready kernel thread ran least recently (the lower number on a tie). At which tick has all the work finished?'],
    answer: M2.end, higherLower: true,
    whyNot: { [M2b.end]: 'That is the time with two cores. Here the two kernel threads share one core, so they take turns.', '*': 'Draw it tick by tick: which kernel thread holds which user thread, and which one the core runs.' },
    hints: ['At tick 0, U0 and U1 get the two kernel threads; U2 and U3 wait for one to come free.', 'While U0 or U1 waits in its blocking call, it still holds its kernel thread: only the other kernel thread can use the core.', 'Tick by tick the finishes are U0 ' + M2.finish[0] + ', U1 ' + M2.finish[1] + ', U2 ' + M2.finish[2] + ', U3 ' + M2.finish[3] + ': everything is done at tick ' + M2.end + '.'],
    solution: M2.end, wrong: [M2b.end, 10] });

  C.exercise({ id: 'thr-x-model-which', chapter: 'thr-basics', title: 'Choosing a model', level: 2, kind: 'choice',
    text: ['A server keeps 10,000 mostly idle connections, each handled by a thread that spends nearly all its time blocked waiting for its client. The machine has 8 cores. Which mapping of user threads to kernel threads lets every connection block on its own without holding up the others, while the kernel schedules far fewer than 10,000 threads?'],
    options: ['many-to-many: the library multiplexes the user threads over a pool of kernel threads and can hand a blocked one\'s work to another', 'many-to-one: one kernel thread for all of them', 'one-to-one: a kernel thread for each connection', 'none: threads cannot block'],
    answer: 0,
    whyNot: { 1: 'One blocking call would stop all 10,000 connections.', 2: 'It works and is what most systems do today, but the kernel then schedules all 10,000 threads, which the question rules out.', 3: 'Threads block all the time; the question is what else can run meanwhile.' },
    hints: ['Many-to-one is cheap but one block stops everyone; one-to-one gives the kernel every thread.', 'The middle way keeps a pool of kernel threads, a handful per core, and puts user threads on them.', 'Many-to-many: the library maps the 10,000 user threads onto a pool of kernel threads.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 2: the thread API
  // =========================================================================================================
  C.exercise({ id: 'thr-x-three-count', chapter: 'thr-api', title: 'Three colours, how many orders?', level: 2, kind: 'fork-outputs', ask: 'count',
    text: ['How many different outputs can this program produce?'],
    src: '#include <stdio.h>\n#include <pthread.h>\n\nvoid *say(void *arg) {\n    char *word = arg;\n    printf("%s\\n", word);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b, c;\n    pthread_create(&a, NULL, say, "red");\n    pthread_create(&b, NULL, say, "green");\n    pthread_create(&c, NULL, say, "blue");\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    pthread_join(c, NULL);\n    printf("done\\n");\n    return 0;\n}\n',
    whyNot: 'The joins fix only where "done" goes; the three threads print in any order.',
    hints: ['Creating the threads in an order does not make them print in that order.', 'Each output is an order of red, green and blue, followed by done.', 'Three words can be ordered in 3 × 2 × 1 = 6 ways, and done is always last: 6 outputs.'],
    solution: '6', wrong: ['1', '24'] });

  C.exercise({ id: 'thr-x-arg', chapter: 'thr-api', title: 'Passing &i to a thread', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['Each thread is handed the address of the loop variable `i`, not its value. Write every output this program can produce, one a line.'],
    src: '#include <stdio.h>\n#include <pthread.h>\n\nvoid *show(void *arg) {\n    int *p = arg;\n    int v = *p;\n    printf("got %d\\n", v);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t[2];\n    int i;\n    for (i = 0; i < 2; i++)\n        pthread_create(&t[i], NULL, show, &i);\n    for (int k = 0; k < 2; k++)\n        pthread_join(t[k], NULL);\n    return 0;\n}\n',
    hints: ['Both threads read the one variable i of main, whenever they get round to it: i is 0, then 1, then 2 when the loop ends.', 'The first thread can read 0, 1 or 2; the second is created when i is 1, so it reads 1 or 2. Either may print first.', 'Eight outputs: got 0 got 1, got 1 got 0, got 0 got 2, got 2 got 0, got 1 got 1, got 1 got 2, got 2 got 1, got 2 got 2. The fix is to pass each thread its own value, (void *)(long)i, or the address of its own slot.'],
    solution: ['got 0 got 1', 'got 1 got 0', 'got 0 got 2', 'got 2 got 0', 'got 1 got 1', 'got 1 got 2', 'got 2 got 1', 'got 2 got 2'],
    wrong: [['got 0 got 1', 'got 1 got 0'], ['got 0 got 1', 'got 1 got 0', 'got 0 got 2', 'got 2 got 0', 'got 1 got 1', 'got 1 got 2', 'got 2 got 1', 'got 2 got 2', 'got 0 got 0']] });

  const SQ_START = '#include <stdio.h>\n#include <pthread.h>\n\nint result[4];\n\nvoid *square(void *arg) {\n    int i = (int)(long)arg;\n    result[i] = (i + 1) * (i + 1);\n    return NULL;\n}\n\nint main(void) {\n    /* start four threads running square(0) .. square(3), and wait for all of them */\n\n    printf("%d %d %d %d\\n", result[0], result[1], result[2], result[3]);\n    return 0;\n}\n';
  const SQ = SQ_START.replace('    /* start four threads running square(0) .. square(3), and wait for all of them */\n', '    pthread_t t[4];\n    for (long i = 0; i < 4; i++)\n        pthread_create(&t[i], NULL, square, (void *)i);\n    for (int i = 0; i < 4; i++)\n        pthread_join(t[i], NULL);\n');
  C.exercise({ id: 'thr-x-code-squares', chapter: 'thr-api', title: 'Four threads, four squares', level: 1, kind: 'code',
    text: ['Finish main: start four threads, the k-th running `square((void *)k)` for k = 0 to 3, and wait for every one of them before the printf. The program must print `1 4 9 16` whatever the schedule.'],
    starter: SQ_START,
    tests: [{ name: 'four squares', stdout: '1 4 9 16\n', seeds: [1, 2, 3, 4, 5, 6] }],
    hints: ['pthread_create(&t[k], NULL, square, (void *)k) starts one; keep the four pthread_t values in an array.', 'Create all four first, then join all four: joining each right after creating it would run them one at a time.', 'pthread_t t[4]; for (long i = 0; i < 4; i++) pthread_create(&t[i], NULL, square, (void *)i); for (int i = 0; i < 4; i++) pthread_join(t[i], NULL);'],
    solution: SQ,
    wrong: [SQ.replace('    for (int i = 0; i < 4; i++)\n        pthread_join(t[i], NULL);\n', ''), SQ.replace('(void *)i);', '(void *)i)')] });

  const PR_START = '#include <stdio.h>\n#include <pthread.h>\n\nint is_prime(int n) {\n    if (n < 2)\n        return 0;\n    for (int d = 2; d * d <= n; d++)\n        if (n % d == 0)\n            return 0;\n    return 1;\n}\n\n/* part p counts the primes from p * 20 up to p * 20 + 19 */\nvoid *count(void *arg) {\n    int part = (int)(long)arg;\n    long found = 0;\n    for (int n = part * 20; n < part * 20 + 20; n++)\n        found += is_prime(n);\n    return (void *)found;\n}\n\nint main(void) {\n    long total = 0;\n    /* run count(0), count(1) and count(2) in three threads and add up what they return */\n\n    printf("%ld primes below 60\\n", total);\n    return 0;\n}\n';
  const PR = PR_START.replace('    /* run count(0), count(1) and count(2) in three threads and add up what they return */\n', '    pthread_t t[3];\n    for (long p = 0; p < 3; p++)\n        pthread_create(&t[p], NULL, count, (void *)p);\n    for (int p = 0; p < 3; p++) {\n        void *r;\n        pthread_join(t[p], &r);\n        total += (long)r;\n    }\n');
  C.exercise({ id: 'thr-x-code-primes', chapter: 'thr-api', title: 'Values back through join', level: 2, kind: 'code',
    text: ['`count` returns how many primes its part holds, as its thread\'s return value. Run the three parts in three threads and collect each count with the second argument of pthread_join, so the program prints `17 primes below 60`.'],
    starter: PR_START,
    tests: [{ name: 'three parts', stdout: '17 primes below 60\n', seeds: [1, 2, 3, 4] }],
    hints: ['pthread_join(t, &r) stores the thread\'s return value, a void *, into r.', 'Cast it back to the number it was: total += (long)r. Join all three, not just the first.', 'pthread_t t[3]; create count with (void *)p for p = 0, 1, 2; then for each p: void *r; pthread_join(t[p], &r); total += (long)r;'],
    solution: PR,
    wrong: [PR.replace('for (int p = 0; p < 3; p++) {\n        void *r;', 'for (int p = 0; p < 1; p++) {\n        void *r;'), PR.replace('        pthread_join(t[p], &r);\n', '        r = 0;\n')] });

  const ST = '#include <stdio.h>\n#include <pthread.h>\n\nint status = 0;\n\nvoid *job(void *arg) {\n    int id = (int)(long)arg;\n    status = id + 1;\n    int seen = status;\n    printf("job %d sees %d\\n", id, seen);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t[2];\n    for (long i = 0; i < 2; i++)\n        pthread_create(&t[i], NULL, job, (void *)i);\n    for (int i = 0; i < 2; i++)\n        pthread_join(t[i], NULL);\n    return 0;\n}\n';
  C.exercise({ id: 'thr-x-status-count', chapter: 'thr-api', title: 'One status for two jobs', level: 2, kind: 'fork-outputs', ask: 'count',
    text: ['Each job writes its status into one global, then reads it back. How many different outputs can the program produce?'],
    src: ST,
    whyNot: 'Count the two orders of the lines, and for each, what each job can read back when the other writes between its two statements.',
    hints: ['If the jobs never interleave, each sees its own status: two outputs, one per order of the lines.', 'A job can be overtaken between `status = id + 1` and `int seen = status`: then it sees the other job\'s status. At most one of the two can be overtaken that way.', 'Six outputs: in each of the 2 print orders, both see their own, job 0 sees 2, or job 1 sees 1.'],
    solution: '6', wrong: ['2', '4'] });

  const STF = ST.replace('int status = 0;', 'int status[2];').replace('    status = id + 1;\n    int seen = status;', '    status[id] = id + 1;\n    int seen = status[id];');
  C.exercise({ id: 'thr-x-code-status', chapter: 'thr-api', title: 'A status of each thread\'s own', level: 2, kind: 'code',
    text: ['Change the program above so that each job always reads back the status it wrote: `job 0 sees 1` and `job 1 sees 2`, in either order. Give each thread its own copy of status (the C subset here has no `__thread`, so use one slot per thread).'],
    starter: ST,
    tests: [{ name: 'each sees its own', match: '^(job 0 sees 1\\njob 1 sees 2\\n|job 1 sees 2\\njob 0 sees 1\\n)$', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    hints: ['A per-thread variable is a variable with one copy per thread. An array indexed by the thread\'s own id gives exactly that.', 'Make status an array of 2, and let job id write and read status[id] only.', 'int status[2]; then in job: status[id] = id + 1; int seen = status[id];'],
    solution: STF, wrong: [ST, ST.replace('int status = 0;', 'int status[2];').replace('    status = id + 1;\n    int seen = status;', '    status[0] = id + 1;\n    int seen = status[0];')] });

  C.exercise({ id: 'thr-x-cancel-async', chapter: 'thr-api', title: 'Cancelled inside the lock', level: 1, kind: 'choice',
    text: ['Thread W locks m, updates an account in two steps, and unlocks m. Another thread cancels W with asynchronous cancellation, which may stop W between any two instructions. What is the worst that can happen?'],
    options: ['W stops while holding m: the account is half updated and every later lock(m) waits for ever', 'Nothing: the kernel unlocks m when W dies', 'W finishes its update first, then stops'],
    answer: 0,
    whyNot: { 1: 'A mutex is just memory in the process; nobody unlocks it for a thread that has gone.', 2: 'That is what deferred cancellation gives, by stopping only at cancellation points. Asynchronous cancellation may strike anywhere.' },
    hints: ['Asynchronous: the cancel can land between any two steps of W.', 'Pick the worst place: just after lock(m), before the update is finished.', 'W then never unlocks m, and the account stays half written: the next thread to lock m blocks for good.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'thr-x-cancel-point', chapter: 'thr-api', title: 'Where deferred cancellation stops', level: 2, kind: 'choice',
    text: ['W runs this loop with deferred cancellation, and its only cancellation point is the `pthread_testcancel()` call:', { code: 'while (1) {\n    pthread_testcancel();\n    pthread_mutex_lock(&m);\n    balance = balance - 1;\n    log_count = log_count + 1;\n    pthread_mutex_unlock(&m);\n}', lang: 'c' }, 'Another thread cancels W at an unknown moment. When W stops, what is true?'],
    options: ['m is free and balance and log_count changed together, the same number of times', 'W may stop holding m', 'W never stops, because the loop never ends', 'W stops at once, wherever it is'],
    answer: 0,
    whyNot: { 1: 'It only acts on a cancel at pthread_testcancel, where it holds nothing.', 2: 'The loop never ends by itself, but a pending cancel is acted on at the next pthread_testcancel.', 3: 'That is asynchronous cancellation; deferred cancellation waits for a cancellation point.' },
    hints: ['Deferred: the request is recorded and acted on only at a cancellation point.', 'Where in the loop is W when it reaches pthread_testcancel? Has it got m?', 'At pthread_testcancel W holds no lock and has finished a whole update: m is free and both counters moved the same number of times.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'thr-x-fork-threads', chapter: 'thr-api', title: 'How many threads after fork?', level: 1, kind: 'number',
    text: ['A process has 4 threads. One of them calls fork. How many threads does the child process start with?'],
    answer: 1, higherLower: true,
    whyNot: { 4: 'fork copies the whole memory, but only the thread that called it.', 0: 'The child must run something: fork returns 0 in it.', '*': 'Think about which thread returns from fork in the child.' },
    hints: ['The child gets a copy of the address space: every stack is in it.', 'But only one thread is made to run in the child: a copy of the caller, returning 0 from fork.', '1: the copy of the calling thread. The other stacks are copied as memory, with nobody running on them.'],
    solution: 1, wrong: [4, 0] });

  C.exercise({ id: 'thr-x-fork-lock', chapter: 'thr-api', title: 'A lock copied held', level: 2, kind: 'choice',
    text: ['Thread A holds mutex m when thread B calls fork. In the child, the code then calls `pthread_mutex_lock(&m)`. What happens, and what is the safe pattern?'],
    options: ['The child\'s copy of m is still held, by an A that does not exist in the child, so the lock blocks for ever; a child should call only simple, safe calls before exec', 'The child gets m at once, since A is not in the child', 'The parent\'s A unlocks the child\'s m when it unlocks its own'],
    answer: 0,
    whyNot: { 1: 'The copy says "held", and only its owner could unlock it, which is not there.', 2: 'After fork the two copies of m are separate memory: A unlocks only the parent\'s.' },
    hints: ['fork copied m exactly as it was: marked held.', 'Only the thread that holds a mutex unlocks it. Is A running in the child?', 'The child blocks for ever. The safe pattern: in a threaded program, a child does only simple, safe calls and then exec, which throws the copied state away.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'thr-x-exec-out', chapter: 'thr-api', title: 'exec with a thread running', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['main starts a worker, then replaces the program with echo. Write every output this program can produce, one a line.'],
    src: '#include <stdio.h>\n#include <pthread.h>\n#include <unistd.h>\n\nvoid *chatter(void *arg) {\n    printf("worker runs\\n");\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t;\n    pthread_create(&t, NULL, chatter, NULL);\n    printf("about to exec\\n");\n    execl("/bin/echo", "echo", "new program", NULL);\n    printf("exec failed\\n");\n    return 1;\n}\n',
    hints: ['exec replaces the whole process image: every thread of the old program ends there, finished or not.', 'The worker prints before main\'s line, after it, or not at all if exec comes first. echo always prints last.', 'Three outputs: worker runs / about to exec / new program; about to exec / worker runs / new program; about to exec / new program.'],
    solution: ['worker runs about to exec new program', 'about to exec worker runs new program', 'about to exec new program'],
    wrong: [['worker runs about to exec new program', 'about to exec worker runs new program'], ['about to exec new program', 'about to exec new program worker runs']] });
})(globalThis.Proses = globalThis.Proses || {});
