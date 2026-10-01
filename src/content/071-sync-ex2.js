// Part 7, synchronisation tools: the exercises of chapters 3 and 4 (semaphores, condition variables, monitors, lock-
// based data structures and checking). Semaphore traces are worked out by the step machine (S.Sync, through the
// semaphore-trace kind's own solver); a program's outputs by the kernel's enumeration (S.Kern.outcomes); C answers
// by the code kind's tests and model checker.
(function (S) {
  'use strict';
  const C = S.Content, K = S.Check;
  if (!C || !K || !K.kinds['semaphore-trace'] || C.exercises.has('syn-x-sem-lock')) return;
  const R = String.raw;
  const ST = K.kinds['semaphore-trace'];
  const trace = (x) => K.os.semTrace(x);
  const MC1 = { deadlock: true, preemptions: 1, maxStates: 20000 };

  // =========================================================================================================
  // Chapter 3: semaphores, conditions and monitors
  // =========================================================================================================
  // ---- a semaphore as a lock --------------------------------------------------------------------------------------
  const lockX = { sems: [{ id: 'm', init: 1 }], threads: ['T1', 'T2', 'T3'].map((name) => ({ name, prog: ['wait m', 'work', 'post m'] })), schedule: ['T1', 'T2', 'T3', 'T1', 'T1', 'T2', 'T2', 'T3', 'T3'] };
  const lockS = ST.solve(lockX);
  C.exercise(Object.assign({ id: 'syn-x-sem-lock', chapter: 'syn-sleep', title: 'A semaphore as a lock', level: 1, kind: 'semaphore-trace',
    text: ['Semaphore m starts at 1. Three threads each run wait m, work, post m. Follow the schedule: after each step, give the value of m and the threads blocked on it (leave the cell empty for none).'],
    hints: ['T1\'s wait takes m from 1 to 0. T2 and T3 then wait on 0, so each blocks.', 'A post with a thread waiting wakes the first one in the queue and leaves the value at 0.', 'm is 0 after every step until T3\'s post sets it to 1. Blocked: T2 after step 2; T2, T3 after steps 3 and 4; T3 after steps 5 and 6; nobody after that.'],
    solution: lockS, wrong: [Object.assign({}, lockS, { '5|m': '1' }), Object.assign({}, lockS, { '5|blocked': 'T2, T3' })] }, lockX));

  // ---- a pool of two ---------------------------------------------------------------------------------------------
  const poolX = { sems: [{ id: 's', init: 2 }], threads: ['A', 'B', 'C'].map((name) => ({ name, prog: ['wait s', 'work', 'post s'] })), schedule: ['A', 'B', 'C', 'A', 'B', 'A', 'C', 'B', 'C'] };
  const poolS = ST.solve(poolX), poolT = trace(poolX);
  C.exercise(Object.assign({ id: 'syn-x-sem-pool', chapter: 'syn-sleep', title: 'Two printers, three people', level: 2, kind: 'semaphore-trace',
    text: ['Semaphore s counts free printers and starts at 2. Three threads each run wait s, work, post s. Follow the schedule: after each step, give the value of s and the threads blocked on it.'],
    hints: ['A and B each take a printer: s goes 2, 1, 0. C then waits on 0 and blocks.', 'A\'s post finds C waiting: C wakes and passes its wait, and s stays 0.', 's after each step: ' + poolT.map((r) => r.s).join(', ') + '; only C is blocked, after steps 3, 4 and 5.'],
    solution: poolS, wrong: [Object.assign({}, poolS, { '6|s': '1' }), Object.assign({}, poolS, { '3|s': '-1' })] }, poolX));

  // ---- who is blocked ----------------------------------------------------------------------------------------------
  const blkX = { sems: [{ id: 's', init: 2 }], threads: ['A', 'B', 'C', 'D'].map((name) => ({ name, prog: ['wait s', 'work', 'post s'] })), schedule: ['A', 'B', 'C', 'D'] };
  const blk = trace(blkX).slice(-1)[0].blocked;
  C.exercise({ id: 'syn-x-sem-blocked', chapter: 'syn-sleep', title: 'Who is asleep?', level: 2, kind: 'set',
    text: ['Semaphore s starts at 2. Four threads A, B, C and D each run wait s, work, post s. The scheduler lets A, B, C and D each take one step, in that order. Which threads are blocked afterwards?'],
    answer: '{' + blk.join(', ') + '}',
    hints: ['Each wait on a positive s decrements it and goes on.', 'A and B take s from 2 to 0.', 'C and D both wait on 0: {' + blk.join(', ') + '} are blocked.'],
    solution: '{' + blk.join(', ') + '}', wrong: ['{D}', '{C, D, A}'] });

  // ---- the value after a mix of waits and posts --------------------------------------------------------------------
  const valX = { sems: [{ id: 's', init: 3 }], threads: [{ name: 'P', prog: ['post s', 'post s'] }, { name: 'A', prog: ['wait s', 'wait s'] }, { name: 'B', prog: ['wait s', 'wait s', 'wait s'] }], schedule: ['A', 'A', 'B', 'B', 'P', 'P'] };
  const valT = trace(valX), valEnd = valT.slice(-1)[0];
  C.exercise({ id: 'syn-x-sem-value', chapter: 'syn-sleep', title: 'Count what is left', level: 1, kind: 'number',
    text: ['Semaphore s starts at 3. A runs wait s twice, then B runs wait s twice, and then P runs post s twice. (B has a third wait it has not reached.) What is the value of s at the end?'],
    answer: valEnd.s, whyNot: { '-1': 'A semaphore never goes below 0: a wait on 0 blocks instead.', '*': 'Follow the value: each passing wait takes one, each post with nobody waiting adds one.' },
    hints: ['A\'s two waits take s from 3 to 1.', 'B\'s first wait takes it to 0; its second wait finds 0 and blocks.', 'P\'s first post wakes B (s stays 0); its second post finds nobody waiting: s = ' + valEnd.s + '.'],
    solution: valEnd.s, wrong: [-1, 2] });

  // ---- early posts ------------------------------------------------------------------------------------------------------
  const earlyX = { sems: [{ id: 'items', init: 0 }], threads: [{ name: 'P', prog: ['work', 'post items', 'work', 'post items'] }, { name: 'C', prog: ['wait items', 'wait items', 'work'] }], schedule: ['C', 'P', 'P', 'P', 'P', 'C', 'C'] };
  const earlyS = ST.solve(earlyX), earlyT = trace(earlyX);
  C.exercise(Object.assign({ id: 'syn-x-sem-early', chapter: 'syn-sleep', title: 'A post that waits for its wait', level: 2, kind: 'semaphore-trace',
    text: ['items starts at 0. The producer P makes an item and posts items, twice; the consumer C waits on items twice, then works. Follow the schedule.'],
    hints: ['C waits first, on 0, and blocks.', 'P\'s first post wakes C, which passes its first wait; the value stays 0. P\'s second post finds nobody waiting.', 'items after each step: ' + earlyT.map((r) => r.items).join(', ') + '; C is blocked after steps 1 and 2 only.'],
    solution: earlyS, wrong: [Object.assign({}, earlyS, { '3|items': '1' }), Object.assign({}, earlyS, { '3|blocked': 'C' })] }, earlyX));

  // ---- a rendezvous --------------------------------------------------------------------------------------------------
  const meetX = { sems: [{ id: 'a', init: 0 }, { id: 'b', init: 0 }], threads: [{ name: 'T1', prog: ['post a', 'wait b', 'work'] }, { name: 'T2', prog: ['post b', 'wait a', 'work'] }], schedule: ['T1', 'T1', 'T2', 'T2', 'T2', 'T1'] };
  const meetS = ST.solve(meetX), meetT = trace(meetX);
  C.exercise(Object.assign({ id: 'syn-x-sem-meet', chapter: 'syn-sleep', title: 'Meet in the middle', level: 3, kind: 'semaphore-trace',
    text: ['Two semaphores a and b start at 0. T1 posts a, then waits on b; T2 posts b, then waits on a. Neither goes on to its work until both have arrived. Follow the schedule, giving both values and who is blocked after each step.'],
    hints: ['T1\'s post a finds nobody waiting: a becomes 1. Its wait on b (0) blocks.', 'T2\'s post b wakes T1 (b stays 0); T2\'s wait on a takes it from 1 to 0.', 'a, b after each step: ' + meetT.map((r) => r.a + ', ' + r.b).join('; ') + '. Only T1 is blocked, after step 2.'],
    solution: meetS, wrong: [Object.assign({}, meetS, { '3|b': '1' }), Object.assign({}, meetS, { '4|a': '1' })] }, meetX));

  // ---- outputs ordered by a semaphore ---------------------------------------------------------------------------------------
  const orderSrc = '#include <stdio.h>\n#include <pthread.h>\n#include <semaphore.h>\n\n' + R`sem_t go;

void *first(void *arg) {
    printf("A\n");
    sem_post(&go);
    printf("B\n");
    return NULL;
}

void *second(void *arg) {
    sem_wait(&go);
    printf("C\n");
    return NULL;
}

int main(void) {
    pthread_t x, y;
    sem_init(&go, 0, 0);
    pthread_create(&y, NULL, second, NULL);
    pthread_create(&x, NULL, first, NULL);
    pthread_join(x, NULL);
    pthread_join(y, NULL);
    printf("end\n");
    return 0;
}
`;
  C.exercise({ id: 'syn-x-order-outputs', chapter: 'syn-sleep', title: 'What the semaphore orders', level: 2, kind: 'fork-outputs', ask: 'set', src: orderSrc,
    text: ['Write every output this program can produce, one output a line, with the line breaks inside an output written as spaces (so "A B C end").', { warn: C.macSem }],
    hints: ['go starts at 0, so C cannot be printed until first has posted, which it does after printing A.', 'After the post, first prints B and second prints C, in either order.', 'Two outputs: A B C end, and A C B end.'],
    solution: ['A B C end', 'A C B end'], wrong: [['A B C end'], ['A B C end', 'A C B end', 'C A B end']] });

  // ---- condition variables ------------------------------------------------------------------------------------------
  C.exercise({ id: 'syn-x-cv-while', chapter: 'syn-sleep', title: 'Why while?', level: 1, kind: 'choice',
    text: ['With pthreads, why is `pthread_cond_wait` written inside `while (!condition)` and not `if (!condition)`?'],
    options: ['A woken thread must retake the mutex first; by then another thread may have made the condition false again', 'A while loop makes the wait shorter', 'pthread_cond_wait returns at once the first time it is called', 'The mutex is not held after the wait returns'], answer: 0,
    whyNot: { 1: 'It can make the thread wait again, never less.', 2: 'It sleeps until a signal or broadcast (or occasionally wakes spuriously).', 3: 'It is held: the wait takes it back before returning.' },
    hints: ['Signalling only moves a sleeper to the queue for the mutex.', 'Between the signal and the moment the woken thread holds the mutex, other threads can run.', 'One of them can consume what the signal announced, so the woken thread must test the condition again: while, not if.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'syn-x-cv-broadcast', chapter: 'syn-sleep', title: 'Signal or broadcast?', level: 2, kind: 'choice',
    text: ['Five runners sleep on condition variable c, each in `while (!open) pthread_cond_wait(&c, &m);`. The marshal locks m, sets open = 1 and unlocks. Which call must it make, while holding m, so that every runner passes?'],
    options: ['`pthread_cond_broadcast(&c)`', '`pthread_cond_signal(&c)`, once', 'None: each runner tests open again by itself'], answer: 0,
    whyNot: { 1: 'A signal wakes one runner; the other four sleep at an open gate for ever.', 2: 'A sleeping runner tests nothing until something wakes it.' },
    hints: ['How many sleepers does a signal wake?', 'The change (open = 1) lets every waiter go, and nothing will signal again.', 'broadcast: it wakes all five, and each, holding m in turn, finds open = 1 and passes.'],
    solution: 0, wrong: [1, 2] });
  C.exercise({ id: 'syn-x-mesa', chapter: 'syn-sleep', title: 'Mesa or Hoare', level: 3, kind: 'choice', options: ['Only under Mesa semantics', 'Only under Hoare semantics', 'Under both', 'Under neither'], answer: 0,
    text: ['A monitor\'s withdraw waits with `if (balance < amount) wait(funds);` and deposit adds money and signals funds once. Two withdrawers and one depositor run. Under which semantics can the balance go below zero?'],
    whyNot: { 1: 'Under Hoare semantics the signalled thread runs at once, before anyone else can enter: the money is still there.', 2: 'Hoare semantics make if safe.', 3: 'Under Mesa the woken withdrawer only queues for the monitor; the other withdrawer can get in first.' },
    hints: ['Who runs right after the signal, under each semantics?', 'Hoare: the signalled thread. Mesa: the signaller goes on, and the woken one queues for the lock.', 'Under Mesa the other withdrawer can take the deposit first; the woken one, testing only with if, withdraws anyway and balance reaches -1. Only Mesa.'],
    solution: 0, wrong: [1, 2] });

  // ---- code: semaphores and conditions --------------------------------------------------------------------------------
  const cookStarter = '#include <stdio.h>\n#include <pthread.h>\n#include <semaphore.h>\n\n' + R`int table = 0;

void *cook(void *arg) {
    table = 42;
    printf("cook: dish on the table\n");
    return NULL;
}

void *waiter(void *arg) {
    printf("waiter: serving dish %d\n", table);
    return NULL;
}

int main(void) {
    pthread_t c, w;
    pthread_create(&w, NULL, waiter, NULL);
    pthread_create(&c, NULL, cook, NULL);
    pthread_join(c, NULL);
    pthread_join(w, NULL);
    return 0;
}
`;
  const cookGood = cookStarter.replace('int table = 0;\n', 'sem_t ready;\nint table = 0;\n')
    .replace('dish on the table\\n");\n', 'dish on the table\\n");\n    sem_post(&ready);\n')
    .replace('void *waiter(void *arg) {\n', 'void *waiter(void *arg) {\n    sem_wait(&ready);\n')
    .replace('    pthread_t c, w;\n', '    pthread_t c, w;\n    sem_init(&ready, 0, 0);\n');
  C.exercise({ id: 'syn-x-code-order', chapter: 'syn-sleep', title: 'Serve after cooking', level: 1, kind: 'code', starter: cookStarter,
    text: ['The waiter thread may serve before the cook has put the dish down, and then serves dish 0. Use a semaphore so that, whatever the schedule, the program prints exactly:', { code: 'cook: dish on the table\nwaiter: serving dish 42', lang: 'text' }, { warn: C.macSem }],
    tests: [{ name: 'cook, then waiter', stdout: 'cook: dish on the table\nwaiter: serving dish 42\n', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC1,
    hints: ['A semaphore that starts at 0 makes a waiter sleep until somebody posts.', 'The cook posts after printing; the waiter waits before printing.', 'Declare `sem_t ready;`, call `sem_init(&ready, 0, 0)` in main before creating the threads, `sem_post(&ready)` at the end of cook, and `sem_wait(&ready)` at the start of waiter.'],
    solution: cookGood, wrong: [cookStarter, cookGood.replace('sem_init(&ready, 0, 0)', 'sem_init(&ready, 0, 1)')] });

  const meetStarter = '#include <stdio.h>\n#include <pthread.h>\n#include <semaphore.h>\n\n' + R`sem_t a_here, b_here;

void *a(void *arg) {
    printf("A before\n");
    printf("A after\n");
    return NULL;
}

void *b(void *arg) {
    printf("B before\n");
    printf("B after\n");
    return NULL;
}

int main(void) {
    pthread_t x, y;
    sem_init(&a_here, 0, 0);
    sem_init(&b_here, 0, 0);
    pthread_create(&x, NULL, a, NULL);
    pthread_create(&y, NULL, b, NULL);
    pthread_join(x, NULL);
    pthread_join(y, NULL);
    return 0;
}
`;
  const meetGood = meetStarter.replace('    printf("A before\\n");\n', '    printf("A before\\n");\n    sem_post(&a_here);\n    sem_wait(&b_here);\n')
    .replace('    printf("B before\\n");\n', '    printf("B before\\n");\n    sem_post(&b_here);\n    sem_wait(&a_here);\n');
  const meetDead = meetStarter.replace('    printf("A before\\n");\n', '    printf("A before\\n");\n    sem_wait(&b_here);\n    sem_post(&a_here);\n')
    .replace('    printf("B before\\n");\n', '    printf("B before\\n");\n    sem_wait(&a_here);\n    sem_post(&b_here);\n');
  C.exercise({ id: 'syn-x-code-meet', chapter: 'syn-sleep', title: 'Both before, then both after', level: 3, kind: 'code', starter: meetStarter,
    text: ['Make the two threads meet: neither may print its "after" line until both have printed their "before" lines. The two "before" lines may come in either order, and so may the two "after" lines. The semaphores are declared and set to 0 for you.', { warn: C.macSem }],
    tests: [{ name: 'both before, then both after', match: '^(A before\\nB before|B before\\nA before)\\n(A after\\nB after|B after\\nA after)\\n$', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC1,
    hints: ['Each thread announces its arrival on its own semaphore and waits on the other\'s.', 'Announce first, then wait. If both wait first, each waits for an announcement the other never gets to make.', 'In a: `sem_post(&a_here); sem_wait(&b_here);` between the two printfs. In b: `sem_post(&b_here); sem_wait(&a_here);`.'],
    solution: meetGood, wrong: [meetDead, meetStarter] });

  const gateStarter = '#include <stdio.h>\n#include <pthread.h>\n\n' + R`int open = 0;
int passed = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t opened = PTHREAD_COND_INITIALIZER;

void *runner(void *arg) {
    pthread_mutex_lock(&m);
    if (!open)
        pthread_cond_wait(&opened, &m);
    passed = passed + 1;
    pthread_mutex_unlock(&m);
    return NULL;
}

int main(void) {
    pthread_t r1, r2;
    pthread_create(&r1, NULL, runner, NULL);
    pthread_create(&r2, NULL, runner, NULL);
    pthread_mutex_lock(&m);
    open = 1;
    pthread_cond_signal(&opened);
    pthread_mutex_unlock(&m);
    pthread_join(r1, NULL);
    pthread_join(r2, NULL);
    printf("%d runners passed\n", passed);
    return 0;
}
`;
  const gateGood = gateStarter.replace('    if (!open)', '    while (!open)').replace('pthread_cond_signal', 'pthread_cond_broadcast');
  C.exercise({ id: 'syn-x-code-gate', chapter: 'syn-sleep', title: 'Open the gate for everyone', level: 2, kind: 'code', starter: gateStarter,
    text: ['Two runners wait at a gate; main opens it. Sometimes a runner is left asleep at the open gate and the program never ends. Fix it, so that every schedule prints `2 runners passed`.'],
    tests: [{ name: 'both pass', stdout: '2 runners passed\n', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC1,
    hints: ['How many sleepers does `pthread_cond_signal` wake?', 'Opening the gate frees every runner, so wake them all; and test open again after waking, as always.', 'Change `pthread_cond_signal` to `pthread_cond_broadcast`, and `if (!open)` to `while (!open)`.'],
    solution: gateGood, wrong: [gateStarter, gateStarter.replace('    if (!open)', '    while (!open)')] });

  const wakeStarter = '#include <stdio.h>\n#include <pthread.h>\n\n' + R`int ready = 0;
int message = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t c = PTHREAD_COND_INITIALIZER;

void *reader(void *arg) {
    if (!ready) {
        pthread_mutex_lock(&m);
        pthread_cond_wait(&c, &m);
        pthread_mutex_unlock(&m);
    }
    printf("got %d\n", message);
    return NULL;
}

void *writer(void *arg) {
    message = 7;
    ready = 1;
    pthread_mutex_lock(&m);
    pthread_cond_signal(&c);
    pthread_mutex_unlock(&m);
    return NULL;
}

int main(void) {
    pthread_t r, w;
    pthread_create(&r, NULL, reader, NULL);
    pthread_create(&w, NULL, writer, NULL);
    pthread_join(r, NULL);
    pthread_join(w, NULL);
    return 0;
}
`;
  const wakeGood = wakeStarter.replace('    if (!ready) {\n        pthread_mutex_lock(&m);\n        pthread_cond_wait(&c, &m);\n        pthread_mutex_unlock(&m);\n    }\n', '    pthread_mutex_lock(&m);\n    while (!ready)\n        pthread_cond_wait(&c, &m);\n    pthread_mutex_unlock(&m);\n')
    .replace('    ready = 1;\n    pthread_mutex_lock(&m);\n', '    pthread_mutex_lock(&m);\n    ready = 1;\n');
  C.exercise({ id: 'syn-x-code-wake', chapter: 'syn-sleep', title: 'Fix the lost wake-up', level: 3, kind: 'code', starter: wakeStarter,
    text: ['Now and then this program hangs for ever. The reader tests ready without the mutex; the writer can set ready and signal in the gap between that test and the reader\'s wait, and a signal with no sleeper is lost. Fix it so that every schedule prints `got 7`.'],
    tests: [{ name: 'the message arrives', stdout: 'got 7\n', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC1,
    hints: ['Find the gap: the reader sees ready = 0, then the writer sets ready and signals nobody, then the reader waits for ever.', 'The test and the wait must both happen while holding m, and the writer must change ready while holding m too.', 'reader: `pthread_mutex_lock(&m); while (!ready) pthread_cond_wait(&c, &m); pthread_mutex_unlock(&m);` writer: lock m, set ready = 1, signal, unlock.'],
    solution: wakeGood, wrong: [wakeStarter, wakeGood.replace('    while (!ready)\n        pthread_cond_wait(&c, &m);\n', '    pthread_cond_wait(&c, &m);\n')] });

  // =========================================================================================================
  // Chapter 4: locks in practice, and checking them
  // =========================================================================================================
  C.exercise({ id: 'syn-x-sloppy', chapter: 'syn-practice', title: 'How far can it lag?', level: 3, kind: 'number',
    text: ['An approximate counter: each of 4 threads counts in a local part and adds it to the global count (under the global lock) as soon as the local part reaches S = 5, then resets the local part to 0. At most how far can the global count be behind the true number of increments?'],
    answer: 20, whyNot: { '16': 'A local part does reach 5: the thread then has to take the global lock to flush it, and while it waits for that lock it holds all 5.', '4': 'Each thread can hold more than one increment back.', '5': 'That is one thread\'s worth. All 4 threads can be holding back at once.', '*': 'Each thread can hold back up to S increments: the S-th is counted locally before the flush.' },
    hints: ['How many increments can one thread hold back before its flush reaches the global count?', 'S = 5: the fifth increment makes the local part 5, and the flush then has to wait for the global lock, which another thread may hold.', 'Four threads, each up to 5 behind, all waiting for the lock at once: 4 × 5 = 20.'],
    solution: 20, wrong: [16, 4] });
  C.exercise({ id: 'syn-x-hoh', chapter: 'syn-practice', title: 'Hand over hand', level: 2, kind: 'choice',
    text: ['A sorted linked list has a lock in every node. To walk it, a thread holds the lock of the node it is at. Which rule makes concurrent inserts and removals safe, while still letting threads work on different parts of the list at once?'],
    options: ['Take the next node\'s lock before letting go of the current one', 'Let go of the current lock, then take the next one', 'Hold every lock from the head to the end of the list', 'Lock only the node being changed'], answer: 0,
    whyNot: { 1: 'In the gap with no lock held, another thread can unlink the next node; an insert after it is lost.', 2: 'That is safe, but it is one big lock with extra steps: nothing overlaps.', 3: 'An insert changes the previous node\'s next pointer: both nodes must be held.' },
    hints: ['What can happen in a moment when the walking thread holds no lock?', 'Another thread can remove the very node it is about to step to.', 'Never hold no lock: take the next lock first, then release the previous one. At most two locks per thread at a time.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'syn-x-hash-lock', chapter: 'syn-practice', title: 'A lock per bucket', level: 1, kind: 'choice',
    text: ['A hash table changes from one lock for the whole table to one lock per bucket. Which operations can now run at the same time?'],
    options: ['Operations on different buckets', 'Operations on the same bucket', 'Any two operations at all', 'None: the table is still serialised'], answer: 0,
    whyNot: { 1: 'They share that bucket\'s lock.', 2: 'Two inserts into one bucket still take turns.', 3: 'Only operations on one bucket take turns now.' },
    hints: ['Which lock does an operation on key k take?', 'The lock of bucket k mod the number of buckets.', 'Operations on different buckets hold different locks, so they overlap; the same bucket still takes turns.'],
    solution: 0, wrong: [1, 2] });
  C.exercise({ id: 'syn-x-bounds', chapter: 'syn-practice', title: 'What a bounded search promises', level: 2, kind: 'choice',
    text: ['A model checker searches a program with at most 2 preemptions and finds no failure. What does that tell you?'],
    options: ['No schedule with at most 2 preemptions fails; a bug that needs 3 could remain', 'The program is correct under every schedule', 'The program fails only rarely', 'Nothing more than a random test would'], answer: 0,
    whyNot: { 1: 'Schedules with more preemptions were not searched.', 2: 'The search says nothing about schedules outside the bound, and nothing about how often they occur.', 3: 'Unlike random runs, it covered every schedule within the bound.' },
    hints: ['A preemption is a switch away from a thread that could have gone on.', 'Every schedule with 0, 1 or 2 preemptions was searched; none beyond.', 'It is a guarantee within the bound only. Many real bugs need just one or two preemptions, which is why small bounds find so much.'],
    solution: 0, wrong: [1, 3] });
})(globalThis.Proses = globalThis.Proses || {});
