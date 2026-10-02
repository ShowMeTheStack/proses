// Part 8, classic problems: the exercises of chapters 1 and 2 (producers and consumers; readers and writers). The
// semaphore traces are worked out by the step machine (S.Sync, through the semaphore-trace kind) when this file loads;
// the outputs of the thread programs were listed by the kernel's enumerator (S.Kern.outcomes) and every C program was
// run on the simulated kernel and compiled with the system compiler. tools/check-content.mjs checks every answer.
(function (S) {
  'use strict';
  const C = S.Content, K = S.Check;
  if (!C || !K || !K.kinds || C.exercises.has('cls-x-sem-slot')) return;
  const c = String.raw;
  /** the source with one passage replaced; it must be there */
  const swap = (src, from, to) => { if (!src.includes(from)) throw new Error('081-classic-ex: no "' + from.slice(0, 40) + '" to replace'); return src.replace(from, to); };
  /** a semaphore-trace exercise with its solution worked out by the step machine */
  const trace = (x) => { const T = K.kinds['semaphore-trace']; x.solution = T.solve(x); x.rows = K.os.semTrace(x); return x; };
  const vals = (rows, s, upto) => rows.slice(0, upto).map((r) => r[s]).join(', ');
  const blockedAt = (rows) => rows.filter((r) => r.blocked.length).map((r) => r.step + ' (' + r.blocked.join(', ') + ')').join(', ');

  // =========================================================================================================
  // Chapter 1: producers and consumers
  // =========================================================================================================
  // ---- a one-slot buffer: two semaphores, no mutex ------------------------------------------------------------
  {
    const x = trace({ id: 'cls-x-sem-slot', chapter: 'cls-buffer', title: 'A shelf with room for one', level: 1, kind: 'semaphore-trace',
      sems: [{ id: 'empty', init: 1 }, { id: 'full', init: 0 }],
      threads: [{ name: 'P', prog: ['wait empty', 'work', 'post full', 'wait empty', 'work', 'post full'] }, { name: 'C', prog: ['wait full', 'work', 'post empty', 'wait full', 'work', 'post empty'] }],
      schedule: ['C', 'P', 'P', 'P', 'P', 'C', 'C', 'P', 'P'] });
    const R = x.rows;
    Object.assign(x, {
      text: ['A baker P puts loaves on a shelf that holds one; a customer C takes them. `empty` counts the free places (it starts at 1) and `full` the loaves (it starts at 0). P runs `wait empty; work; post full` twice, C runs `wait full; work; post empty` twice, where *work* puts down or picks up a loaf.', 'Follow the schedule below, one operation per step. After each step write the value of each semaphore and who is blocked (leave it empty when nobody is).'],
      hints: ['Step 1: C waits on `full`, which is 0, so C blocks and `full` stays 0.', 'A post with a thread waiting wakes that thread and leaves the value as it is: P\'s `post full` at step 4 hands the loaf to C directly.', 'empty: ' + vals(R, 'empty') + '; full: ' + vals(R, 'full') + '. Blocked after steps ' + blockedAt(R) + '.'],
      wrong: [Object.assign({}, x.solution, { '4|full': '1' }), Object.assign({}, x.solution, { '5|blocked': '' })],
      why: 'Every post either wakes a sleeper or raises the count, never both.',
    });
    delete x.rows;
    C.exercise(x);
  }

  // ---- the full buffer: empty, full and a mutex, two producers ---------------------------------------------------
  {
    const P = ['wait empty', 'wait mutex', 'work', 'post mutex', 'post full'], Q = ['wait full', 'wait mutex', 'work', 'post mutex', 'post empty'];
    const x = trace({ id: 'cls-x-sem-buf', chapter: 'cls-buffer', title: 'Two producers at a one-slot ring', level: 2, kind: 'semaphore-trace',
      sems: [{ id: 'empty', init: 1 }, { id: 'full', init: 0 }, { id: 'mutex', init: 1 }],
      threads: [{ name: 'P1', prog: P }, { name: 'P2', prog: P }, { name: 'C', prog: Q }],
      schedule: ['P1', 'P1', 'P2', 'P1', 'P1', 'P1', 'C', 'C', 'C', 'C', 'C'] });
    const R = x.rows;
    Object.assign(x, {
      text: ['A ring buffer of one slot, two producers and one consumer, with the usual three semaphores: `empty` starts at 1, `full` at 0 and `mutex` at 1.', { code: 'producer:  wait empty; wait mutex; put; post mutex; post full\nconsumer:  wait full;  wait mutex; take; post mutex; post empty', lang: 'text' }, 'Follow the schedule below (put and take are the *work* steps). After each step write each semaphore\'s value and who is blocked.'],
      hints: ['P1 takes the only free slot at step 1, so P2\'s `wait empty` at step 3 finds 0 and blocks.', 'P1\'s `post full` at step 6 finds nobody waiting, so `full` becomes 1; the consumer\'s `post empty` at step 11 finds P2 waiting and wakes it instead of raising `empty`.', 'empty: ' + vals(R, 'empty') + '; full: ' + vals(R, 'full') + '; mutex: ' + vals(R, 'mutex') + '. P2 is blocked after steps 3 to 10.'],
      wrong: [Object.assign({}, x.solution, { '11|empty': '1' }), Object.assign({}, x.solution, { '3|empty': '-1' })],
      why: 'At step 11 the slot P2 waited for passes straight to it: `empty` stays 0 because the free place is already spoken for.',
    });
    delete x.rows;
    C.exercise(x);
  }

  // ---- counting the slots ------------------------------------------------------------------------------------
  {
    const N = 5, puts = 9, takes = 6, empty = N - (puts - takes);
    C.exercise({ id: 'cls-x-buf-count', chapter: 'cls-buffer', title: 'What empty says', level: 1, kind: 'number',
      text: ['A bounded buffer of ' + N + ' slots uses the semaphores `empty` (it starts at ' + N + ') and `full` (at 0). So far producers have finished ' + puts + ' puts and consumers ' + takes + ' takes, and no thread is between a wait and its post. What is the value of `empty` now?'],
      answer: empty,
      whyNot: { [String(N - puts + takes + 1)]: 'Close: count the items in the ring first, puts minus takes.', [String(puts - takes)]: 'That is `full`, the items in the ring; `empty` counts the free slots.', '*': 'Each finished put lowered empty by one and each finished take raised it by one.' },
      hints: ['Each finished put did one `wait empty`; each finished take did one `post empty`.', 'The ring holds ' + puts + ' − ' + takes + ' = ' + (puts - takes) + ' items.', '`empty` = ' + N + ' − ' + (puts - takes) + ' = ' + empty + '; `full` = ' + (puts - takes) + ', and the two add up to ' + N + '.'],
      solution: empty, wrong: [puts - takes, N - puts + takes + 1] });
  }

  // ---- the waits swapped --------------------------------------------------------------------------------------
  C.exercise({ id: 'cls-x-buf-swap', chapter: 'cls-buffer', title: 'Lock first, then wait for a slot', level: 1, kind: 'choice',
    text: ['A producer is changed to take the mutex *before* it waits for a free slot:', { code: 'sem_wait(&mutex);\nsem_wait(&empty);   /* was the first line */\nput(item);\nsem_post(&mutex);\nsem_post(&full);', lang: 'c' }, 'The consumer is unchanged (`wait full; wait mutex; take; post mutex; post empty`). What can happen when the ring is full?'],
    options: ['A producer sleeps on `empty` holding the mutex; the consumer that would free a slot waits for the mutex: a deadlock', 'Two producers write the same slot', 'Nothing: the order of two waits never matters', 'The consumer takes an item that is not there'],
    answer: 0, whyNot: { 1: 'The mutex still keeps producers apart: only one is ever past it.', 2: 'The order matters as soon as one of the waits can block while the other is held.', 3: 'The consumer waits on `full` before it touches the ring, as before.' },
    hints: ['On a full ring, `empty` is 0: the producer\'s second wait blocks.', 'What does it hold while it sleeps there, and who needs that to free a slot?', 'It holds the mutex while it sleeps on `empty`; the consumer needs the mutex before it can post `empty`. Each waits for the other: a deadlock. Wait for the slot first, then lock.'],
    solution: 0, wrong: [2, 1] });

  // ---- no mutex ------------------------------------------------------------------------------------------------
  C.exercise({ id: 'cls-x-buf-nomutex', chapter: 'cls-buffer', title: 'Two producers and no mutex', level: 2, kind: 'choice',
    text: ['A ring of 2 slots, two producers and one consumer. The semaphores `empty` and `full` are kept, but the mutex is dropped, so a put is just these two statements:', { code: 'buf[in] = item;\nin = (in + 1) % N;', lang: 'c' }, 'Which failure becomes possible?'],
    options: ['Both producers write `buf[in]` before either moves `in`: one item is overwritten and lost', 'A deadlock, with every thread asleep', 'A producer writes into a full ring', 'The consumer takes from an empty ring'],
    answer: 0, whyNot: { 1: 'Without the mutex there is one lock fewer to wait for; the semaphores alone cannot close a cycle here.', 2: '`empty` still stops a producer when every slot is taken.', 3: '`full` still stops the consumer when nothing is there.' },
    hints: ['With 2 free slots, `empty` lets both producers through at once.', 'The semaphores count slots; they do not stop two threads touching the same `in`.', 'Both pass `wait empty`, both read the same `in`, the second write lands on the first: the topic\'s checker finds this in a 5-step schedule. The mutex makes the write and the move one step.'],
    solution: 0, wrong: [1, 2] });

  // ---- two makers, one slot: the outputs ---------------------------------------------------------------------------
  C.exercise({ id: 'cls-x-out-slot', chapter: 'cls-buffer', title: 'Who fills the slot first?', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['Two makers each drop one letter into a one-slot box guarded by two semaphores; main takes the two letters out and prints them. Write every output this program can produce, one a line.', { warn: C.macSem }],
    src: c`#include <stdio.h>
#include <pthread.h>
#include <semaphore.h>

char slot;
sem_t vacant, filled;

void *maker(void *arg) {
    char c = (char)(long)arg;
    sem_wait(&vacant);
    slot = c;
    sem_post(&filled);
    return NULL;
}

int main(void) {
    pthread_t a, b;
    sem_init(&vacant, 0, 1);
    sem_init(&filled, 0, 0);
    pthread_create(&a, NULL, maker, (void *)'x');
    pthread_create(&b, NULL, maker, (void *)'y');
    for (int i = 0; i < 2; i++) {
        sem_wait(&filled);
        putchar(slot);
        sem_post(&vacant);
    }
    putchar('\n');
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    return 0;
}`,
    hints: ['Either maker can pass `wait vacant` first.', 'Can the second letter overwrite the first before main prints it? Only after main posts `vacant`.', 'Exactly two outputs: xy and yx. No letter is lost and none printed twice.'],
    solution: ['xy', 'yx'], wrong: [['xy'], ['xy', 'yx', 'yy']],
    why: 'The semaphores fix how many letters are in the box, not which maker gets there first.' });

  // ---- make the buffer correct ---------------------------------------------------------------------------------
  const bufStart = c`#include <stdio.h>
#include <assert.h>
#include <pthread.h>
#include <semaphore.h>

#define SLOTS 2

int ring[SLOTS];
int in = 0, out = 0;

void ring_init(void) {
}

void put(int v) {
    ring[in] = v;
    in = (in + 1) % SLOTS;
}

int take(void) {
    int v = ring[out];
    out = (out + 1) % SLOTS;
    return v;
}

void *baker(void *arg) {
    int first = (int)(long)arg;
    put(first);
    put(first + 1);
    return NULL;
}

int main(void) {
    ring_init();
    pthread_t a, b;
    pthread_create(&a, NULL, baker, (void *)10);
    pthread_create(&b, NULL, baker, (void *)20);
    int total = 0;
    for (int i = 0; i < 4; i++)
        total = total + take();
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    assert(total == 62);
    printf("total %d\n", total);
    return 0;
}
`;
  let bufSol = swap(bufStart, 'int in = 0, out = 0;\n', 'int in = 0, out = 0;\nsem_t freeslots, loaves;\npthread_mutex_t guard = PTHREAD_MUTEX_INITIALIZER;\n');
  bufSol = swap(bufSol, 'void ring_init(void) {\n}', 'void ring_init(void) {\n    sem_init(&freeslots, 0, SLOTS);\n    sem_init(&loaves, 0, 0);\n}');
  bufSol = swap(bufSol, 'void put(int v) {\n    ring[in] = v;\n    in = (in + 1) % SLOTS;\n}', 'void put(int v) {\n    sem_wait(&freeslots);\n    pthread_mutex_lock(&guard);\n    ring[in] = v;\n    in = (in + 1) % SLOTS;\n    pthread_mutex_unlock(&guard);\n    sem_post(&loaves);\n}');
  bufSol = swap(bufSol, 'int take(void) {\n    int v = ring[out];\n    out = (out + 1) % SLOTS;\n    return v;\n}', 'int take(void) {\n    sem_wait(&loaves);\n    pthread_mutex_lock(&guard);\n    int v = ring[out];\n    out = (out + 1) % SLOTS;\n    pthread_mutex_unlock(&guard);\n    sem_post(&freeslots);\n    return v;\n}');
  const bufNoMutex = swap(swap(bufSol, '    pthread_mutex_lock(&guard);\n    ring[in] = v;', '    ring[in] = v;'), '    in = (in + 1) % SLOTS;\n    pthread_mutex_unlock(&guard);', '    in = (in + 1) % SLOTS;');
  const bufSwapped = swap(bufSol, '    sem_wait(&freeslots);\n    pthread_mutex_lock(&guard);', '    pthread_mutex_lock(&guard);\n    sem_wait(&freeslots);');
  C.exercise({ id: 'cls-x-buf-code', chapter: 'cls-buffer', title: 'Make this bounded buffer correct', level: 2, kind: 'code',
    text: ['Two bakers each put two loaves (10 and 11, 20 and 21) into a ring of 2 slots; main takes four loaves out and checks that they add up to 62. As written, `put` and `take` do not synchronise at all: `take` can read a slot nobody has filled, and two bakers can write the same slot.', 'Add semaphores and a mutex so that `put` waits for a free slot, `take` waits for a loaf, and the ring\'s indices are changed by one thread at a time. Keep `main` and the bakers as they are. The tests run several random schedules, and the model checker searches the schedules with one preemption for a deadlock or a failed assertion.', { warn: C.macSem }],
    starter: bufStart,
    tests: [{ name: 'four loaves', stdout: 'total 62\n', seeds: [1, 2, 3, 4, 5, 6] }],
    mc: { deadlock: true, preemptions: 1, maxStates: 3000 },
    hints: ['Count two things with semaphores: free slots (starting at SLOTS) and loaves (starting at 0).', 'put: wait for a free slot, then lock, write and move `in`, unlock, then post a loaf. take mirrors it. Wait on the semaphore *before* taking the mutex.', '`sem_t freeslots, loaves;` with `sem_init(&freeslots, 0, SLOTS); sem_init(&loaves, 0, 0);`; put is `sem_wait(&freeslots); pthread_mutex_lock(&guard); ring[in] = v; in = (in + 1) % SLOTS; pthread_mutex_unlock(&guard); sem_post(&loaves);` and take is the same with the two semaphores swapped.'],
    solution: bufSol, wrong: [bufStart, bufNoMutex, bufSwapped],
    why: 'The semaphores count, the mutex protects the indices, and nobody sleeps while holding the mutex.' });

  // ---- condition variables: if or while ----------------------------------------------------------------------------
  const cvStart = c`#include <stdio.h>
#include <assert.h>
#include <pthread.h>

int parcel = 0;
int full = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t arrived = PTHREAD_COND_INITIALIZER;
pthread_cond_t space = PTHREAD_COND_INITIALIZER;

void drop(int v) {
    pthread_mutex_lock(&m);
    if (full)
        pthread_cond_wait(&space, &m);
    parcel = v;
    full = 1;
    pthread_cond_signal(&arrived);
    pthread_mutex_unlock(&m);
}

int collect(void) {
    pthread_mutex_lock(&m);
    if (!full)
        pthread_cond_wait(&arrived, &m);
    int v = parcel;
    assert(full == 1);
    full = 0;
    pthread_cond_signal(&space);
    pthread_mutex_unlock(&m);
    return v;
}

int got[2];

void *courier(void *arg) {
    drop(5);
    drop(7);
    return NULL;
}

void *clerk(void *arg) {
    int k = (int)(long)arg;
    got[k] = collect();
    return NULL;
}

int main(void) {
    pthread_t c, k0, k1;
    pthread_create(&k0, NULL, clerk, (void *)0);
    pthread_create(&k1, NULL, clerk, (void *)1);
    pthread_create(&c, NULL, courier, NULL);
    pthread_join(c, NULL);
    pthread_join(k0, NULL);
    pthread_join(k1, NULL);
    printf("%d\n", got[0] + got[1]);
    return 0;
}
`;
  const cvSol = swap(swap(cvStart, '    if (full)', '    while (full)'), '    if (!full)', '    while (!full)');
  const cvHalf = swap(cvStart, '    if (full)', '    while (full)');
  C.exercise({ id: 'cls-x-cv-code', chapter: 'cls-buffer', title: 'The clerk who woke too late', level: 2, kind: 'code',
    text: ['A courier drops two parcels (5 and 7) into a pigeonhole that holds one; two clerks each collect one. The pigeonhole is guarded by a mutex and two condition variables, with Mesa semantics: a woken thread queues for the mutex again, and another thread may get there first.', 'Sometimes a clerk finds the pigeonhole empty after it wakes, and the `assert` stops the program. Fix it so that the program prints 12 under every schedule.'],
    starter: cvStart,
    tests: [{ name: 'one courier, two clerks', stdout: '12\n', seeds: [1, 2, 3, 4, 5, 6] }],
    mc: { deadlock: true, preemptions: 1, maxStates: 3000 },
    hints: ['A clerk is signalled when a parcel arrives, but the other clerk can take the mutex first and empty the pigeonhole.', 'After `pthread_cond_wait` returns, the condition must be tested again.', 'Replace both `if` tests with `while`: `while (!full) pthread_cond_wait(&arrived, &m);` in collect and `while (full) pthread_cond_wait(&space, &m);` in drop.'],
    solution: cvSol, wrong: [cvStart, cvHalf],
    why: 'With Mesa semantics a wake-up is a hint, not a promise: the while loop turns it back into a test.' });

  C.exercise({ id: 'cls-x-cv-if', chapter: 'cls-buffer', title: 'Why the loop', level: 2, kind: 'choice',
    text: ['A consumer waits with `if (count == 0) pthread_cond_wait(&notEmpty, &m);` and then takes an item. With one producer and two consumers on a one-slot ring, the checker finds an assertion that fails: a consumer takes an item that is not there. What happened?'],
    options: ['The consumer was signalled, but the other consumer took the mutex first and emptied the slot; testing with if, it never looked again', 'The signal was lost because nobody was waiting', 'The producer wrote into a full slot', 'Two consumers were inside the mutex at once'],
    answer: 0, whyNot: { 1: 'A lost signal leaves a thread asleep for ever: that is a deadlock, not a wrong item.', 2: 'The producer\'s test of the full ring is not what fails here.', 3: 'The mutex still lets one thread in at a time; the trouble is what happened between the signal and the wake-up.' },
    hints: ['Under Mesa semantics the signalled thread does not run at once: it must take the mutex back.', 'Who can take the mutex between the signal and the moment the woken consumer returns from its wait?', 'The other consumer got the mutex first and took the item; the woken one returned from `pthread_cond_wait` and, testing with `if`, took from an empty slot. A `while` loop tests again.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'cls-x-cv-onecv', chapter: 'cls-buffer', title: 'One condition for everyone', level: 3, kind: 'choice',
    text: ['A one-slot buffer with two producers and two consumers uses one mutex and a single condition variable `cv` for both kinds of waiting, with `while` loops and `pthread_cond_signal`. The checker finds a deadlock in which everyone ends up asleep on `cv`. Which changes remove it? Pick every one that does.'],
    options: ['Use `pthread_cond_broadcast` instead of `pthread_cond_signal`', 'Use two condition variables, one for "not full" and one for "not empty"', 'Change the `while` loops to `if`', 'Add a second mutex for the consumers'],
    answer: [0, 1], whyNot: { 2: 'Then a woken thread may act on a condition that is false again: the earlier bug comes back.', 3: 'The trouble is who gets woken, not how many locks there are.' },
    hints: ['A signal wakes one sleeper, and with one condition it may be a thread of the wrong kind.', 'A consumer that wakes another consumer when it should have woken a producer leaves the producers asleep.', 'Both fixes ensure a thread that can make progress is woken: broadcast wakes everyone and each re-tests; two conditions let a consumer signal only producers and a producer only consumers.'],
    solution: [0, 1], wrong: [[0], [2]] });

  // =========================================================================================================
  // Chapter 2: readers and writers
  // =========================================================================================================
  C.exercise({ id: 'cls-x-rw-in', chapter: 'cls-rw', title: 'A reader arrives', level: 1, kind: 'choice',
    text: ['A reader-preferring lock: one reader is in the room and a writer is waiting at the door. Now a second reader arrives. What happens?'],
    options: ['It goes straight in: the room is already open to readers', 'It waits behind the writer', 'It waits until the first reader leaves', 'The writer is let in first, then the reader'],
    answer: 0, whyNot: { 1: 'That is what a fair lock, with one line for everyone, does; a reader-preferring lock lets readers in while any reader is inside.', 2: 'Readers never exclude each other.', 3: 'Only the last reader out lets a writer in.' },
    hints: ['In a reader-preferring lock, only the first reader in waits for the room.', 'The second reader finds the reader count already above zero.', 'It increments the count and goes in without touching the room semaphore, so the writer keeps waiting. Repeat that forever and the writer starves.'],
    solution: 0, wrong: [1, 2] });

  {
    const x = trace({ id: 'cls-x-sem-rw', chapter: 'cls-rw', title: 'Trace a reader and a writer', level: 2, kind: 'semaphore-trace',
      sems: [{ id: 'room', init: 1 }, { id: 'count_lock', init: 1 }],
      threads: [{ name: 'R', prog: ['wait count_lock', 'wait room', 'post count_lock', 'work', 'wait count_lock', 'post room', 'post count_lock'] }, { name: 'W', prog: ['wait room', 'work', 'post room'] }],
      schedule: ['R', 'R', 'R', 'W', 'R', 'R', 'R', 'R', 'W', 'W'] });
    const R = x.rows;
    Object.assign(x, {
      text: ['A reader-preferring lock with `room` (1) and `count_lock` (1). Reader R is alone, so it is both the first reader in and the last out; its branches are written out:', { code: 'R:  wait count_lock; wait room; post count_lock; read; wait count_lock; post room; post count_lock\nW:  wait room; write; post room', lang: 'text' }, 'Follow the schedule below (read and write are the *work* steps). After each step write each semaphore\'s value and who is blocked.'],
      hints: ['The first reader takes `room` for all readers: after step 2 it is 0.', 'W\'s `wait room` at step 4 blocks; R\'s `post room` at step 7 wakes W, so `room` stays 0.', 'room: ' + vals(R, 'room') + '; count_lock: ' + vals(R, 'count_lock') + '. W is blocked after steps 4 to 6.'],
      wrong: [Object.assign({}, x.solution, { '7|room': '1' }), Object.assign({}, x.solution, { '4|blocked': '' })],
    });
    delete x.rows;
    C.exercise(x);
  }

  C.exercise({ id: 'cls-x-rw-starve', chapter: 'cls-rw', title: 'Who can be kept out', level: 2, kind: 'table',
    text: ['The topic [Starvation made visible](#topic=classic-rw-starve) runs a liveness check over every reachable state of each lock. For each lock and thread mix below, who can be kept out of the room for ever? Write `writer`, `reader` or `none`.'],
    rows: ['readers first, 2 readers and 1 writer', 'writers first, 1 reader and 2 writers', 'one line, 2 readers and 1 writer', 'rwlock readers first, 2 readers and 1 writer'], cols: ['kept out'], corner: 'lock', cellKind: 'text',
    cells: { 'readers first, 2 readers and 1 writer|kept out': 'writer', 'writers first, 1 reader and 2 writers|kept out': 'reader', 'one line, 2 readers and 1 writer|kept out': 'none', 'rwlock readers first, 2 readers and 1 writer|kept out': 'writer' },
    hints: ['Readers first: while any reader is inside, new readers walk in.', 'Writers first: while any writer waits, the readers\' door stays shut; two writers can take turns for ever.', 'writer, reader, none, writer: the two "first" locks each starve the other side, one line serves everyone in arrival order.'],
    solution: { 'readers first, 2 readers and 1 writer|kept out': 'writer', 'writers first, 1 reader and 2 writers|kept out': 'reader', 'one line, 2 readers and 1 writer|kept out': 'none', 'rwlock readers first, 2 readers and 1 writer|kept out': 'writer' },
    wrong: [{ 'readers first, 2 readers and 1 writer|kept out': 'writer', 'writers first, 1 reader and 2 writers|kept out': 'none', 'one line, 2 readers and 1 writer|kept out': 'none', 'rwlock readers first, 2 readers and 1 writer|kept out': 'writer' }, { 'readers first, 2 readers and 1 writer|kept out': 'reader', 'writers first, 1 reader and 2 writers|kept out': 'writer', 'one line, 2 readers and 1 writer|kept out': 'none', 'rwlock readers first, 2 readers and 1 writer|kept out': 'writer' }] });

  C.exercise({ id: 'cls-x-rw-door', chapter: 'cls-rw', title: 'Why the writer keeps its place in line', level: 2, kind: 'choice',
    text: ['In the fair lock every thread first passes a `line` semaphore, one line for everyone in arrival order. A writer does `wait line; wait room; post line`, so it may sleep on `room` while holding `line`. A reader does `wait line; post line` before its usual entry. Why must the writer hold on to the line while it waits for the room?'],
    options: ['So that readers arriving after it queue in the line and the room can empty, letting it in next', 'To keep other writers out of the room', 'To stop readers already inside from leaving', 'It need not: posting the line first would be just as fair'],
    answer: 0, whyNot: { 1: '`room` already keeps writers apart.', 2: 'Leaving does not pass the line: readers inside leave freely, which is exactly what lets the room empty.', 3: 'Then new readers could keep walking in past it, and it could starve as with readers first.' },
    hints: ['What do readers who arrive while the writer waits run into?', 'The readers inside still leave; nobody new joins them.', 'Keeping the line blocks every later arrival, so the readers inside drain out, the last posts `room`, and the writer goes in. Then it posts the line and it moves on in arrival order.'],
    solution: 0, wrong: [3, 1] });

  // ---- a fair reader-writer lock in C --------------------------------------------------------------------------------
  const rwRoom = c`
/* ---- the reading room: keep everything below as it is ---- */
int together = 0, wdone = 0, rdone = 0;
pthread_mutex_t count_m = PTHREAD_MUTEX_INITIALIZER;
sem_t both;

void read_room(void) {
}

void write_room(void) {
}

void meet_up(void) {
    read_lock();
    pthread_mutex_lock(&count_m);
    together = together + 1;
    if (together == 2)
        sem_post(&both);
    pthread_mutex_unlock(&count_m);
    sem_wait(&both);
    sem_post(&both);
    read_room();
    read_unlock();
}

void browse_loop(void) {
    while (!wdone) {
        read_lock();
        read_room();
        read_unlock();
    }
}

void redraft_loop(void) {
    while (!rdone) {
        write_lock();
        write_room();
        write_unlock();
    }
}

void *meet(void *arg) {
    meet_up();
    return NULL;
}

void *browse(void *arg) {
    browse_loop();
    return NULL;
}

void *edit(void *arg) {
    write_lock();
    write_room();
    wdone = 1;
    write_unlock();
    return NULL;
}

void *redraft(void *arg) {
    redraft_loop();
    return NULL;
}

void *glance(void *arg) {
    read_lock();
    read_room();
    rdone = 1;
    read_unlock();
    return NULL;
}

int main(void) {
    pthread_t a, b, c;
    sem_init(&both, 0, 0);
    rw_init();
    pthread_create(&a, NULL, meet, NULL);
    meet_up();
    pthread_join(a, NULL);
    printf("two readers shared the room\n");
    pthread_create(&a, NULL, edit, NULL);
    pthread_create(&b, NULL, browse, NULL);
    pthread_create(&c, NULL, browse, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    pthread_join(c, NULL);
    printf("the writer got in\n");
    pthread_create(&a, NULL, glance, NULL);
    pthread_create(&b, NULL, redraft, NULL);
    redraft_loop();
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("the reader got in\n");
    return 0;
}
`;
  const rwHead = '#include <stdio.h>\n#include <pthread.h>\n#include <semaphore.h>\n\n';
  const rwReaders = rwHead + c`sem_t room, count_lock;
int readers = 0;

void rw_init(void) {
    sem_init(&room, 0, 1);
    sem_init(&count_lock, 0, 1);
}

void read_lock(void) {
    sem_wait(&count_lock);
    readers = readers + 1;
    if (readers == 1)
        sem_wait(&room);
    sem_post(&count_lock);
}

void read_unlock(void) {
    sem_wait(&count_lock);
    readers = readers - 1;
    if (readers == 0)
        sem_post(&room);
    sem_post(&count_lock);
}

void write_lock(void) {
    sem_wait(&room);
}

void write_unlock(void) {
    sem_post(&room);
}
` + rwRoom;
  const rwFair = rwHead + c`sem_t line, room, count_lock;
int readers = 0;

void rw_init(void) {
    sem_init(&line, 0, 1);
    sem_init(&room, 0, 1);
    sem_init(&count_lock, 0, 1);
}

void read_lock(void) {
    sem_wait(&line);
    sem_wait(&count_lock);
    readers = readers + 1;
    if (readers == 1)
        sem_wait(&room);
    sem_post(&count_lock);
    sem_post(&line);
}

void read_unlock(void) {
    sem_wait(&count_lock);
    readers = readers - 1;
    if (readers == 0)
        sem_post(&room);
    sem_post(&count_lock);
}

void write_lock(void) {
    sem_wait(&line);
    sem_wait(&room);
    sem_post(&line);
}

void write_unlock(void) {
    sem_post(&room);
}
` + rwRoom;
  const rwOne = rwHead + c`sem_t room;

void rw_init(void) {
    sem_init(&room, 0, 1);
}

void read_lock(void) {
    sem_wait(&room);
}

void read_unlock(void) {
    sem_post(&room);
}

void write_lock(void) {
    sem_wait(&room);
}

void write_unlock(void) {
    sem_post(&room);
}
` + rwRoom;
  const RWSPEC = [{ kind: 'deadlock' }, { kind: 'never', what: 'in(write_room) > 0 && in(read_room) > 0' }, { kind: 'never', what: 'in(write_room) > 1' },
    { kind: 'live', what: 'meet calls read_room' }, { kind: 'live', what: 'edit calls write_room' }, { kind: 'live', what: 'glance calls read_room' }];
  C.exercise({ id: 'cls-x-rw-fair', chapter: 'cls-rw', title: 'Write a fair reader–writer lock', level: 3, kind: 'code',
    text: ['The lock at the top lets readers in first, so a writer can wait for ever while readers overlap. Rewrite `rw_init`, `read_lock`, `read_unlock`, `write_lock` and `write_unlock` so that the lock is fair, and keep the reading room below them as it is.', 'The room runs three scenes: two readers who must be inside together (each waits for the other before it reads); two readers who keep coming back until a writer has been in; two writers who keep coming back until a reader has been in. `main` plays the second reader of the first scene and the second writer of the last. Besides running it, the checker searches every schedule for these properties: no deadlock, never a writer with a reader or with another writer, and eventually `meet`, `edit` and `glance` each get into the room, in every schedule that keeps giving each runnable thread a turn. If a thread can starve, it is named, and you can replay the cycle that shuts it out in the Sync lab.', { warn: C.macSem }],
    starter: rwReaders,
    tests: [{ name: 'share, then let each side in', stdout: 'two readers shared the room\nthe writer got in\nthe reader got in\n', seeds: [1, 2, 3] }],
    maxSteps: 20000, spec: RWSPEC,
    hints: ['Put one more semaphore, `line`, in front of everything: every reader and writer passes it in arrival order.', 'A reader waits in the line, and posts it once it has its place, before its usual entry. A writer waits on the line, then on the room, and only then posts the line, so later readers queue behind it.', 'Add `sem_t line;` with `sem_init(&line, 0, 1);`. read_lock starts with `sem_wait(&line);` and ends with `sem_post(&line);`; write_lock is `sem_wait(&line); sem_wait(&room); sem_post(&line);`. read_unlock and write_unlock stay as they are.'],
    solution: rwFair, wrong: [rwReaders, rwOne],
    why: 'The line gives every thread a place in one queue: readers still share the room, but nobody can overtake a writer that is waiting.' });
})(globalThis.Proses = globalThis.Proses || {});
