// Part 7, synchronisation tools: the exercises of chapters 1 and 2 (races, the critical section, atomic
// instructions and locks). Every number in a text, an answer or a hint is worked out by the engines: the step
// machine and its interleaving tree (S.Sync), the kernel's enumeration of a C program's outputs (S.Kern.outcomes,
// through the fork-outputs kind) and the C tests and model checker of the code kind. Nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, Y = S.Sync;
  if (!C || !Y || C.exercises.has('syn-x-race-table')) return;
  const R = String.raw;
  const HDR = '#include <stdio.h>\n#include <pthread.h>\n\n';

  // =========================================================================================================
  // Chapter 1: races and the critical section
  // =========================================================================================================
  // ---- a lost update, step by step ---------------------------------------------------------------------------------
  const rspec = Y.counter('race', 2);
  rspec.vars.count = 5;
  const RS = [1, 0, 0, 0, 1, 1], RM = Y.machine(rspec), RT = [];
  for (const c of RS) { const st = RM.step(c); RT.push({ who: st.name, label: st.label, count: RM.vars.count, r: RM.threads[c].reg.r }); }
  const rrows = RT.map((t, i) => 'step ' + (i + 1) + ': ' + t.who + ' ' + t.label.split(':')[0]);
  const rcells = (f) => Object.fromEntries(RT.flatMap((t, i) => [[rrows[i] + '|its r', f(t, 'r', i)], [rrows[i] + '|count', f(t, 'count', i)]]));
  C.exercise({ id: 'syn-x-race-table', chapter: 'syn-races', title: 'Follow a lost update', level: 1, kind: 'table',
    text: ['Two threads each run count++ as three steps: load count into the thread\'s own register r, add 1 to r, store r into count. count starts at 5. Fill in, after each step of this schedule, the register of the thread that took the step and the value of count.'],
    rows: rrows, cols: ['its r', 'count'], corner: 'step', cells: rcells((t, k) => t[k]), cellKind: 'number',
    hints: ['A load copies count into the thread\'s r and leaves count alone; only a store changes count.', 'T1 loads 5, and so does T0, before anyone stores. Both registers hold 5.', 'r and count after each step: ' + RT.map((t) => t.who + ' ' + t.label.split(':')[0] + ' ' + t.r + ', ' + t.count).join('; ') + '. count ends at ' + RT[5].count + ', one update lost.'],
    solution: rcells((t, k) => String(t[k])),
    wrong: [rcells((t, k, i) => String(k === 'count' && i === 5 ? 7 : t[k])), rcells((t, k, i) => String(k === 'r' && i === 4 ? 7 : t[k]))],
    why: 'T1 loaded before T0 stored, so its store wrote over T0\'s update.' });

  // ---- counting interleavings with the tree ------------------------------------------------------------------------
  const T2 = Y.raceTree(Y.counter('race', 2)), T3 = Y.raceTree(Y.counter('race', 3), { maxNodes: 200000 });
  const fin = (t, v) => { const f = t.finals.find((q) => q.value === v); return f ? (Array.isArray(f.leaves) ? f.leaves.length : f.leaves) : 0; };
  const n2 = T2.leaves.length, n3 = T3.leaves.length, ok2 = fin(T2, 2), ok3 = fin(T3, 3);
  C.exercise({ id: 'syn-x-n-schedules', chapter: 'syn-races', title: 'How many schedules?', level: 1, kind: 'number',
    text: ['Two threads each run three steps (load, add, store). Each thread\'s own steps stay in order, but the scheduler may interleave the two threads in any way. How many different schedules are there?'],
    answer: n2, whyNot: { '9': 'That is 3 × 3: the schedule is the order of all six steps, not a pair of choices.', '720': 'That is 6!, every order of six steps; but each thread\'s own three steps must keep their order.', '*': 'Choose which three of the six places in the schedule belong to T0.' },
    hints: ['A schedule is a sequence of six steps, three of them T0\'s and three T1\'s, each thread\'s in its own order.', 'Once you know which three places are T0\'s, the schedule is fixed: the other three are T1\'s, in order.', 'Choose 3 places of 6: 6! / (3! × 3!) = 720 / 36 = ' + n2 + '.'],
    solution: n2, wrong: [720, 9] });
  C.exercise({ id: 'syn-x-n-right', chapter: 'syn-races', title: 'How many are right?', level: 2, kind: 'number',
    text: ['Of the ' + n2 + ' schedules of two threads each running count++ as load, add and store, from count = 0, how many end with count = 2?'],
    answer: ok2, whyNot: { '1': 'More than one: T0 can go first, or T1 can.', '18': 'That many end with count = 1.', '*': 'An update is lost whenever both threads load before either stores.' },
    hints: ['For count to reach 2, the second thread must load after the first has stored.', 'So one thread must run all three of its steps before the other loads.', 'Only T0 T0 T0 T1 T1 T1 and T1 T1 T1 T0 T0 T0: ' + ok2 + ' schedules. The other ' + (n2 - ok2) + ' lose an update.'],
    solution: ok2, wrong: [1, n2 - ok2] });
  C.exercise({ id: 'syn-x-n-three', chapter: 'syn-races', title: 'Three threads', level: 2, kind: 'number',
    text: ['Now three threads each run count++ once as load, add and store. How many different schedules are there?'],
    answer: n3, whyNot: { '60': 'That counts each thread\'s steps as one block; but the steps of different threads can interleave.', '362880': 'That is 9!, every order of nine steps; each thread\'s three steps must keep their order.', '*': 'Choose the places of T0\'s three steps among nine, then T1\'s among the six left.' },
    hints: ['Nine steps, three per thread, each thread\'s in order.', 'Choose T0\'s 3 places among 9, then T1\'s 3 among the remaining 6; T2 takes the rest.', '9! / (3! × 3! × 3!) = 362880 / 216 = ' + n3 + '.'],
    solution: n3, wrong: [362880, 60] });
  C.exercise({ id: 'syn-x-n-three-right', chapter: 'syn-races', title: 'Three threads, all updates kept', level: 3, kind: 'number',
    text: ['Of the ' + n3 + ' schedules of three threads each running count++ once (load, add, store), from count = 0, how many end with count = 3?'],
    answer: ok3, whyNot: { '1': 'More than one order of the threads works.', '3': 'Count the orders in which the three threads can take turns.', '*': 'Each thread must finish its store before the next one loads.' },
    hints: ['For every update to survive, no two threads may have overlapping load-to-store windows.', 'So the threads run one at a time, each from load to store, in some order.', 'Any order of the three threads, run one after another: 3! = ' + ok3 + ' schedules, out of ' + n3 + '.'],
    solution: ok3, wrong: [1, 3] });

  // ---- the race in C: its outputs ----------------------------------------------------------------------------------
  const once = HDR + R`int x = 0;

void *add(void *arg) {
    x++;
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, add, NULL);
    pthread_create(&b, NULL, add, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("%d\n", x);
    return 0;
}
`;
  C.exercise({ id: 'syn-x-race-outputs', chapter: 'syn-races', title: 'What can it print?', level: 1, kind: 'fork-outputs', ask: 'set', granularity: 'machine', src: once,
    text: ['Each thread runs `x++` once. On the machine that is three steps, a load of x into a register, an add, and a store back, so another thread can run between them. Write every output this program can produce, one a line.'],
    hints: ['If one thread finishes its store before the other loads x, nothing is lost.', 'If both load x while it is still 0, both store 1.', 'Two outputs: 2 (one after the other) and 1 (both loaded 0).'],
    solution: ['1', '2'], wrong: [['2'], ['0', '1', '2']] });

  const twice = HDR + R`int count = 0;

void *bump(void *arg) {
    for (int i = 0; i < 2; i++) {
        count++;
    }
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, bump, NULL);
    pthread_create(&b, NULL, bump, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("%d\n", count);
    return 0;
}
`;
  C.exercise({ id: 'syn-x-race-twice', chapter: 'syn-races', title: 'Twice each', level: 2, kind: 'fork-outputs', ask: 'count', granularity: 'machine', src: twice,
    text: ['Each thread now adds one twice. How many different outputs can this program produce?'],
    hints: ['The right answer is 4. Which lower values can a lost update give?', 'One thread can load 0, be switched out while the other does both its increments, then store 1; its second increment then makes 2.', 'It can print 2, 3 or 4: three outputs.'],
    solution: 3, wrong: [2, 4], whyNot: 'Ask whether two updates, not just one, can be lost.' });

  const three = HDR + R`int hits = 0;

void *visit(void *arg) {
    hits++;
    return NULL;
}

int main(void) {
    pthread_t t[3];
    for (int i = 0; i < 3; i++)
        pthread_create(&t[i], NULL, visit, NULL);
    for (int i = 0; i < 3; i++)
        pthread_join(t[i], NULL);
    printf("%d\n", hits);
    return 0;
}
`;
  C.exercise({ id: 'syn-x-race-three', chapter: 'syn-races', title: 'Three visitors', level: 2, kind: 'fork-outputs', ask: 'set', granularity: 'machine', src: three,
    text: ['Three threads each count one visit. Write every output this program can produce, one a line.'],
    hints: ['If the threads run one after another, every visit counts.', 'Two threads can load the same value before either stores; so can all three.', 'It prints 1 (all three loaded 0), 2 (two of them loaded the same value) or 3.'],
    solution: ['1', '2', '3'], wrong: [['2', '3'], ['3']] });

  const early = HDR + R`int score = 0;

void *add(void *arg) {
    score += (int)(long)arg;
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, add, (void *)10);
    pthread_create(&b, NULL, add, (void *)5);
    pthread_join(a, NULL);
    printf("%d\n", score);
    pthread_join(b, NULL);
    return 0;
}
`;
  C.exercise({ id: 'syn-x-join-early', chapter: 'syn-races', title: 'Printed before the second join', level: 3, kind: 'fork-outputs', ask: 'set', granularity: 'machine', src: early,
    text: ['One thread adds 10 to score and the other 5. main prints score after joining only the first. Write every output this program can produce, one a line.'],
    hints: ['When main prints, the thread adding 10 has certainly finished; the one adding 5 may not have started, or may have finished.', 'There is also a race between the two threads: `score += n` loads score, adds, and stores, and the other thread can run in between.', '10 (the second has not written yet, or its update was lost), 15 (both kept), and 5: the thread adding 5 loaded 0 before the other stored and then stored 5 over its 10. 0 is impossible, since the first thread stored before the join returned.'],
    solution: ['5', '10', '15'], wrong: [['10', '15'], ['0', '5', '10', '15']] });

  // ---- code: fix the race with a mutex --------------------------------------------------------------------------------
  const mutexStarter = '#include <stdio.h>\n#include <assert.h>\n#include <pthread.h>\n\n' + R`#define ROUNDS 2

int count = 0;

void *bump(void *arg) {
    for (int i = 0; i < ROUNDS; i++)
        count++;
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, bump, NULL);
    pthread_create(&b, NULL, bump, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    assert(count == 2 * ROUNDS);
    printf("count = %d\n", count);
    return 0;
}
`;
  const mutexGood = mutexStarter.replace('int count = 0;\n', 'int count = 0;\npthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;\n')
    .replace('    for (int i = 0; i < ROUNDS; i++)\n        count++;\n', '    for (int i = 0; i < ROUNDS; i++) {\n        pthread_mutex_lock(&lock);\n        count++;\n        pthread_mutex_unlock(&lock);\n    }\n');
  const MC1 = { deadlock: true, preemptions: 1, maxStates: 20000 };
  C.exercise({ id: 'syn-x-code-mutex', chapter: 'syn-races', title: 'Lock the counter', level: 1, kind: 'code', starter: mutexStarter, granularity: 'machine',
    text: ['This program loses updates: `count++` is a load, an add and a store, and the other thread can run between them. The checker runs it with every load and store as a step of its own. Add a mutex so that it always prints `count = 4`: it runs the program under several random schedules, then tries every schedule for one that prints anything else, fails the assertion or deadlocks.'],
    tests: [{ name: 'count = 4', stdout: 'count = 4\n', seeds: [1, 2, 3, 4, 5, 6] }], outputs: ['count = 4'], mc: MC1,
    hints: ['Declare `pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;` beside count.', 'The whole of `count++`, its load and its store, must be inside the locked region; a lock and unlock just before it leaves the gap open.', 'In the loop: `pthread_mutex_lock(&lock); count++; pthread_mutex_unlock(&lock);`'],
    solution: mutexGood,
    wrong: [mutexStarter, mutexGood.replace('        pthread_mutex_lock(&lock);\n        count++;\n        pthread_mutex_unlock(&lock);\n', '        pthread_mutex_lock(&lock);\n        pthread_mutex_unlock(&lock);\n        count++;\n')] });

  // ---- the critical-section attempts --------------------------------------------------------------------------------
  const REQ = ['Mutual exclusion', 'Progress', 'Bounded waiting', 'None: it is correct'];
  C.exercise({ id: 'syn-x-cs-check', chapter: 'syn-races', title: 'Look, then raise a flag', level: 1, kind: 'choice',
    text: ['Each thread waits while the other\'s flag is up, then raises its own flag and enters:', { code: 'while (flag[other])\n    ;\nflag[me] = 1;\n/* critical section */\nflag[me] = 0;', lang: 'c' }, 'Which requirement can fail?'],
    options: REQ, answer: 0, whyNot: { 1: 'If neither is inside, a thread that wants in finds the other\'s flag down and goes in: progress holds.', 3: 'Try both threads passing the while loop before either raises its flag.' },
    hints: ['Look for a moment where both threads have passed the test.', 'Each tests the other\'s flag before raising its own.', 'Both can read the other\'s flag as 0, then both raise their flags and both enter: mutual exclusion fails.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'syn-x-cs-flags', chapter: 'syn-races', title: 'Raise a flag, then wait', level: 1, kind: 'choice',
    text: ['Now each thread raises its own flag first, then waits while the other\'s flag is up:', { code: 'flag[me] = 1;\nwhile (flag[other])\n    ;\n/* critical section */\nflag[me] = 0;', lang: 'c' }, 'Which requirement can fail?'],
    options: REQ, answer: 1, whyNot: { 0: 'A thread enters only after seeing the other\'s flag down, while its own is up; both cannot be inside.', 3: 'Try both threads raising their flags before either tests.' },
    hints: ['Mutual exclusion holds: a thread enters only with its flag up and the other\'s down.', 'What if both flags go up before either thread tests?', 'Both wait for the other to lower its flag, and neither ever does: nobody gets in although nobody is inside, so progress fails.'],
    solution: 1, wrong: [0, 3] });
  C.exercise({ id: 'syn-x-cs-turns', chapter: 'syn-races', title: 'Strict turns', level: 1, kind: 'choice',
    text: ['A shared turn says whose go it is:', { code: 'while (turn != me)\n    ;\n/* critical section */\nturn = other;', lang: 'c' }, 'T0 wants in three times, T1 only once. Which requirement fails?'],
    options: REQ, answer: 1, whyNot: { 0: 'Only the thread whose turn it is can be inside.', 2: 'Bounded waiting is about being passed over by threads that keep entering; here the other thread does not want in at all.' },
    hints: ['Mutual exclusion holds: turn has one value at a time.', 'After T1\'s single go, turn is 0; after T0\'s next go it is 1, and only T1 can set it back.', 'T0 waits for a turn T1 will never hand back, although nobody is inside: progress fails.'],
    solution: 1, wrong: [0, 2] });
  C.exercise({ id: 'syn-x-peterson-turn', chapter: 'syn-races', title: 'Who writes turn last', level: 2, kind: 'choice',
    text: ['Both threads run Peterson\'s entry protocol at the same time: each sets its flag to 1, then sets `turn = other`, then waits while `flag[other] && turn == other`. T1 writes turn first, then T0 writes turn. Who enters first?'],
    options: ['T0', 'T1', 'Neither: both wait', 'Both'], answer: 1,
    whyNot: { 0: 'T0 wrote turn = 1 last, so turn is 1 and flag[1] is up: T0 waits.', 2: 'turn has one value, so exactly one of the two wait conditions is false.', 3: 'That is what Peterson\'s algorithm prevents.' },
    hints: ['After both writes, turn holds the value written last.', 'T0 wrote last: turn = 1. Test each thread\'s condition: flag[other] is 1 for both.', 'T0 waits (turn == 1 is its other), T1 does not (turn == 0 is false for it): T1 enters. The last to write turn waits.'],
    solution: 1, wrong: [0, 2] });
  C.exercise({ id: 'syn-x-tso', chapter: 'syn-races', title: 'Peterson on store buffers', level: 3, kind: 'choice',
    text: ['On a machine where each core\'s stores wait in a store buffer before reaching memory (later loads may go ahead of them), Peterson\'s algorithm can let both threads into the critical section. Which change makes it correct there?'],
    options: ['A full memory fence after setting flag and turn, before the loads in the wait loop', 'Setting turn before flag', 'Declaring flag and turn volatile', 'Adding a fence after the critical section only'], answer: 0,
    whyNot: { 1: 'Then a thread can set turn, be overtaken, and both enter even on an ordinary machine; and the stores are still buffered.', 2: 'volatile stops the compiler keeping a value in a register; it does not make the processor drain its store buffer.', 3: 'The failure is at entry: each thread reads the other\'s flag while its own store is still buffered.' },
    hints: ['Find the moment both are inside: each thread read the other\'s flag as 0.', 'Its own flag = 1 was still in its store buffer, invisible to the other core.', 'A fence between the stores (flag, turn) and the loads waits until the buffer drains, so each thread\'s flag is visible before it looks at the other\'s: the checker then finds no violation in all 1778 states.'],
    solution: 0, wrong: [2, 1] });

  // ---- code: a check and an act, together ----------------------------------------------------------------------------
  const bankStarter = '#include <stdio.h>\n#include <assert.h>\n#include <pthread.h>\n\n' + R`int balance = 100;
int paid = 0;

void *withdraw(void *arg) {
    int amount = (int)(long)arg;
    if (balance >= amount) {
        balance -= amount;
        paid += amount;
    }
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, withdraw, (void *)70);
    pthread_create(&b, NULL, withdraw, (void *)60);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    assert(balance >= 0 && balance + paid == 100);
    printf("balance %d, paid %d\n", balance, paid);
    return 0;
}
`;
  const bankGood = bankStarter.replace('int paid = 0;\n', 'int paid = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n')
    .replace('    if (balance >= amount) {', '    pthread_mutex_lock(&m);\n    if (balance >= amount) {')
    .replace('        paid += amount;\n    }\n', '        paid += amount;\n    }\n    pthread_mutex_unlock(&m);\n');
  const bankHalf = bankStarter.replace('int paid = 0;\n', 'int paid = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n')
    .replace('        balance -= amount;\n', '        pthread_mutex_lock(&m);\n        balance -= amount;\n        pthread_mutex_unlock(&m);\n');
  C.exercise({ id: 'syn-x-code-bank', chapter: 'syn-locks', title: 'Check and withdraw as one', level: 2, kind: 'code', starter: bankStarter, granularity: 'machine',
    text: ['Two cash machines withdraw 70 and 60 from an account holding 100. Only one of them can be paid. As written, both can pass the balance check before either withdraws. Add a mutex so that the check and the withdrawal happen as one: the program must print `balance 30, paid 70` or `balance 40, paid 60`, and never fail its assertion.'],
    tests: [{ name: 'one withdrawal paid', match: '^balance (30, paid 70|40, paid 60)\\n$', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC1,
    hints: ['A lock round the subtraction alone is not enough: the check can still pass in both threads first.', 'The critical section runs from the test of the balance to the last update.', 'Lock before `if (balance >= amount)` and unlock after the closing brace of the if.'],
    solution: bankGood, wrong: [bankStarter, bankHalf] });

  // =========================================================================================================
  // Chapter 2: atomic instructions and locks
  // =========================================================================================================
  C.exercise({ id: 'syn-x-split-tas', chapter: 'syn-locks', title: 'Test, then set', level: 1, kind: 'choice',
    text: ['A lock is taken by `while (lock == 1) ; lock = 1;` (a load, then a store), instead of an atomic test-and-set. What can happen?'],
    options: ['Two threads can both see 0 and both take the lock', 'A thread can wait for ever with the lock free', 'Nothing: it is the same as test-and-set'], answer: 0,
    whyNot: { 1: 'A free lock reads 0, and the loop ends.', 2: 'Test-and-set reads and writes in one step; here another thread can run between the load and the store.' },
    hints: ['What can another thread do between this thread\'s load of lock and its store?', 'It can load lock too, while it is still 0.', 'Both read 0 and both write 1: both own the lock. The checker finds it in a schedule of 2 steps.'],
    solution: 0, wrong: [1, 2] });
  C.exercise({ id: 'syn-x-cas', chapter: 'syn-locks', title: 'Compare-and-swap', level: 2, kind: 'choice',
    text: ['w holds 7. Three threads each run `compare_and_swap(&w, 7, id)` once, with ids 1, 2 and 3, in some order. Afterwards, which is true?'],
    options: ['Exactly one swap succeeded, and w holds that thread\'s id', 'All three succeeded, and w holds the last id written', 'w still holds 7', 'At least two succeeded'], answer: 0,
    whyNot: { 1: 'After the first swap w no longer holds 7, so the others compare and fail.', 2: 'The first thread finds 7 and writes its id.', 3: 'Each compare and swap is one indivisible step: only one thread finds 7.' },
    hints: ['A compare-and-swap writes only when the word holds the expected value, and it does both in one step.', 'The first to run finds 7 and writes its id; w is no longer 7.', 'The other two compare against 7, fail, and change nothing: exactly one success, and w holds its id.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'syn-x-spin-fair', chapter: 'syn-locks', title: 'Who gets the spinlock?', level: 2, kind: 'choice',
    text: ['T1 holds a test-and-set spinlock. T2 has been spinning on it for a long time; T3 has just started. T1 releases the lock. Which of the three requirements can a test-and-set spinlock fail?'],
    options: ['Bounded waiting: T3 may win, and T2 may lose every race', 'Mutual exclusion', 'Progress'], answer: 0,
    whyNot: { 1: 'Test-and-set gives the lock to exactly one thread.', 2: 'When the lock is free, some spinner\'s next test-and-set wins.' },
    hints: ['The lock remembers nothing about who waited longest.', 'The first test-and-set after the release wins, whoever runs it.', 'An unlucky waiter can lose every time: bounded waiting fails. A ticket lock fixes it by serving tickets in order.'],
    solution: 0, wrong: [1, 2] });
  C.exercise({ id: 'syn-x-ticket', chapter: 'syn-locks', title: 'Wait for your number', level: 2, kind: 'number',
    text: ['A ticket lock has `next = 9` and `serving = 6`: ticket 6 holds the lock and tickets 7 and 8 wait. A new thread takes its ticket with `fetch_and_add(&next, 1)`. How many threads will hold the lock before it, counting the current holder?'],
    answer: 3, whyNot: { '2': 'Count the holder of ticket 6 too.', '9': 'That is the ticket it gets, not how many go before it.', '*': 'Its ticket is the old value of next; the lock serves 6, 7, 8 first.' },
    hints: ['fetch_and_add returns the old value: the new thread\'s ticket is 9, and next becomes 10.', 'The lock is handed out in ticket order, starting from serving = 6.', 'Tickets 6, 7 and 8 go first: 3 threads.'],
    solution: 3, wrong: [2, 9] });
  C.exercise({ id: 'syn-x-mcs', chapter: 'syn-locks', title: 'Why a queue lock scales', level: 2, kind: 'choice',
    text: ['On a machine with many cores, why does a queue lock (each waiter spinning on a flag in its own node) behave better than a ticket lock under heavy contention?'],
    options: ['A release writes one waiter\'s flag, so only that core\'s cached copy is disturbed', 'It uses no atomic instructions at all', 'Waiters sleep instead of spinning', 'It lets two threads hold the lock at once'], answer: 0,
    whyNot: { 1: 'Joining the queue swaps the tail pointer atomically.', 2: 'Waiters still spin, but each on its own flag.', 3: 'It is a lock: one holder at a time.' },
    hints: ['In a ticket lock every waiter reads the same word, serving.', 'Each release writes serving, and every waiting core must fetch the new value.', 'A queue lock\'s release writes only the next waiter\'s own flag: one cache line moves, not one per waiter.'],
    solution: 0, wrong: [2, 1] });
  C.exercise({ id: 'syn-x-spin-onecpu', chapter: 'syn-locks', title: 'Spinning on one CPU', level: 1, kind: 'choice',
    text: ['On a machine with a single CPU, a thread holding a spinlock is preempted in its critical section, and another thread starts spinning on the lock. What does the spinner achieve during its time slice?'],
    options: ['Nothing: the holder cannot run to release the lock until the spinner gives up the CPU', 'It gets the lock as soon as the holder finishes', 'It speeds the holder up'], answer: 0,
    whyNot: { 1: 'The holder cannot finish while the spinner holds the only CPU.', 2: 'It takes CPU time the holder needs.' },
    hints: ['How many threads can run at once on one CPU?', 'While the spinner runs, the holder is not running.', 'Every spin in that slice is wasted: a mutex that puts the waiter to sleep lets the holder run instead.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
