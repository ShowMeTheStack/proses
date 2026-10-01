// Part 7, synchronisation tools: the chapters and the lessons. The exercises are in 071-sync-ex.js and
// 071-sync-ex2.js; the challenges, the tour, the course and the pages the diagram checker looks at are in
// 072-sync-ch.js. Each lesson opens with a question, runs the topic that shows the idea at a frame chosen for the point
// being made, asks for a prediction, sums up, and leads to its exercises. Every value quoted here was read from the
// topics' own narration on the inputs given (the engines in src/core: S.Sync, S.Kern, S.MC).
(function (S) {
  'use strict';
  const C = S.Content;
  // unnamed semaphores on a Mac: shown wherever a program uses sem_init (the later parts' files read it from here)
  if (C) C.macSem = C.macSem || 'On macOS, unnamed semaphores are not implemented: `sem_init` fails with −1 and `sem_wait` returns at once, so a real run there can print outputs these pages call impossible. Run such programs on Linux, or use a named semaphore (`sem_open`), or a mutex with a condition variable.';
  if (!C || C.lessons.has('syn-count')) return;
  const X = (id) => ({ exercise: id });
  // a card that opens the Sync lab with one of its ready-made programs loaded
  const lab = (id, title, text) => {
    const p = ((S.SyncLab && S.SyncLab.PROGS) || []).find((q) => q.id === id);
    return { lab: 'sync', setup: p ? { src: p.src, spec: p.spec, gran: p.gran, mode: p.mode } : {}, title, text };
  };

  C.chapter({ id: 'syn-races', part: 'sync', n: 1, title: 'Races and the critical section', blurb: 'Why count++ goes wrong, every interleaving of two threads, the three requirements of a critical section, and Peterson\'s algorithm, on a machine that keeps its stores in order and on one that does not.' });
  C.chapter({ id: 'syn-locks', part: 'sync', n: 2, title: 'Atomic instructions and locks', blurb: 'Test-and-set, compare-and-swap and fetch-and-add; spinlocks, ticket locks and queue locks; and the mutex that puts its waiters to sleep.' });
  C.chapter({ id: 'syn-sleep', part: 'sync', n: 3, title: 'Semaphores, conditions and monitors', blurb: 'Counting and binary semaphores, condition variables with signal and broadcast and the while-loop rule, and monitors in the Mesa and Hoare styles.' });
  C.chapter({ id: 'syn-practice', part: 'sync', n: 4, title: 'Locks in practice, and checking them', blurb: 'A counter, a list and a hash table with coarse and fine locking, and how a model checker hunts through schedules for the one that breaks.' });

  // =========================================================================================================
  // Chapter 1: races and the critical section
  // =========================================================================================================
  C.lesson({
    id: 'syn-count', chapter: 'syn-races', title: 'count++ is three steps', minutes: 7,
    summary: 'A single line of C, count++, is a load, an add and a store. Two threads that interleave those steps can both load the same old value, and one update vanishes without any error. Of the 20 ways two threads can interleave three steps each, only 2 give the right answer.',
    blocks: [
      'Two threads share a counter, and each adds one to it. The counter starts at 0. Surely it ends at 2?',
      { def: 'race condition', text: 'a bug in which the result depends on the order in which threads happen to run. The order is the scheduler\'s choice, so the bug comes and goes.' },
      { topic: 'sync-race-steps', frame: 0, caption: 'Each thread runs count++ as three steps: load count into its own register r, add 1 to r, store r back. The registers are private; count is shared.' },
      { predict: { q: 'The schedule is T0 load, T1 load, T0 add, T1 add, T0 store, T1 store. What is count at the end?', options: ['2', '1', '0'], answer: 1, explain: 'Both threads load 0 before either stores, so both compute 1 and both store 1. The second store writes over the first.' } },
      { topic: 'sync-race-steps', frame: 6, caption: 'T1 stores 1, but count was already 1: T1 loaded 0 before T0 stored, so T0\'s update is written over.' },
      { topic: 'sync-race-steps', frame: 7, caption: 'count ends at 1, not 2: one update lost, and nothing failed or reported an error.' },
      { h: 'Every interleaving at once' },
      'One schedule shows that the bug can happen. To know how often, list every schedule: at each step, either thread that has steps left may go next.',
      { topic: 'sync-race-tree', frame: 7, caption: '20 schedules in all. 18 end with count = 1, and only 2 end with the right answer, 2.' },
      { topic: 'sync-race-tree', frame: 9, caption: 'A winning path: one thread finishes all three steps before the other loads. Any overlap of the two load–store windows loses an update.' },
      { tip: 'Two threads with three steps each have (3 + 3)! / (3! × 3!) = 20 interleavings: choose which 3 of the 6 places belong to T0. The count grows fast: three threads with three steps each have 1680.' },
      { h: 'Recap' },
      { list: ['count++ is a load, an add and a store; another thread can run between any two of them.', 'A lost update happens when both threads load before either stores.', 'Of the 20 interleavings of two such threads, only the 2 that do not overlap are right.'] },
      X('syn-x-race-table'), X('syn-x-n-schedules'), X('syn-x-n-right'), X('syn-x-n-three'), X('syn-x-n-three-right'),
    ],
  });

  C.lesson({
    id: 'syn-race-c', chapter: 'syn-races', title: 'The race in real C', minutes: 6,
    summary: 'The same race in a real C program with pthreads: two threads each run count++ twice, and the program can print 2, 3 or 4. Testing seldom finds the wrong answers; a model checker, which tries every schedule, finds one in a few hundred states and replays it.',
    blocks: [
      'A program creates two threads; each adds one to a global counter twice, and main prints the counter after joining both. Run it a thousand times on a real machine and it may print 4 every time. Is it correct?',
      { topic: 'sync-race-c', frame: 1, caption: 'Over every schedule (488 states), the program can print 2, 3 or 4. Two of the three answers are wrong.' },
      { predict: { q: 'Can this program print 2, although each thread adds one twice?', options: ['No: the lowest it can lose is one update', 'Yes: two updates can be lost', 'Only with three threads'], answer: 1, explain: 'Thread 101 loads 1 and is switched out before storing; thread 102 then does both its increments, from 1 to 3; thread 101 finally stores its stale 2. Two updates are gone.' } },
      { topic: 'sync-race-c', frame: 17, caption: 'Thread 101 stores 2 over 102\'s 3: its load happened before 102\'s two increments. Two updates are lost by now.' },
      { topic: 'sync-race-c', frame: 24, caption: 'The program prints 2 where 4 was due. A test would catch this only if a run happened to take this schedule.' },
      { warn: 'In the simulated kernel a C statement normally runs in one step. To show the race, the lab and these pictures stop a thread after every load and store of shared memory too. The code exercises about races do the same: there a plain `count++` is a load, an add and a store, and the checker tries every way the other thread can run between them.' },
      'The fix is to make the three steps one indivisible unit for every other thread that touches count: a critical section, guarded by a lock.',
      { topic: 'sync-race-c', input: { lock: 'mutex' }, frame: 1, caption: 'With a mutex round count++, all 404 states agree: every schedule prints 4.' },
      lab('race', 'The count++ race in the Sync lab', 'The racy counter as C: the model checker finds the shortest losing schedule and replays it step by step.'),
      { h: 'Recap' },
      { list: ['Real threads race exactly like the three-step model.', 'A racy program can print right answers for a long time; testing proves little.', 'A model checker explores every schedule and hands back one that fails.'] },
      X('syn-x-race-outputs'), X('syn-x-race-twice'), X('syn-x-race-three'), X('syn-x-join-early'), X('syn-x-code-mutex'),
    ],
  });

  C.lesson({
    id: 'syn-cs', chapter: 'syn-races', title: 'The critical-section problem', minutes: 8,
    summary: 'A solution to the critical-section problem needs three things: mutual exclusion (never two inside), progress (if nobody is inside and someone wants in, someone gets in) and bounded waiting (nobody is passed over for ever). Three natural attempts each break one of them.',
    blocks: [
      'Without any special instruction, only plain loads and stores of shared variables, can two threads take turns at a critical section safely?',
      { def: 'critical section', text: 'the part of a thread\'s code that touches shared data and must not overlap with another thread\'s critical section on the same data. Before it comes an entry protocol, after it an exit protocol.' },
      { list: ['**Mutual exclusion**: at most one thread is in its critical section at any time.', '**Progress**: if no thread is inside and some want in, one of them gets in; a thread that does not want in cannot block the others.', '**Bounded waiting**: once a thread asks to enter, the others can enter only a bounded number of times before it does.'] },
      { h: 'Attempt 1: look, then raise a flag' },
      { topic: 'sync-cs-attempts', input: { variant: 'check-then-set' }, frame: 10, caption: 'Each thread looked at the other\'s flag before raising its own, so each saw it down and both went in. The checker found it in 44 states, after 8 steps.' },
      { h: 'Attempt 2: raise a flag, then wait' },
      { predict: { q: 'Swap the order: each thread raises its own flag first, then waits while the other\'s flag is up. Which requirement fails now?', options: ['Mutual exclusion', 'Progress: both can wait for ever', 'None'], answer: 1, explain: 'If both raise their flags before either looks, each waits for the other to lower its flag, and neither ever does. Mutual exclusion holds in all 67 states; progress does not.' } },
      { topic: 'sync-cs-attempts', input: { variant: 'flags-only' }, frame: 1, caption: 'Mutual exclusion holds in all 67 reachable states, but there is a fair schedule in which T0 never gets in.' },
      { h: 'Attempt 3: strict turns' },
      { topic: 'sync-cs-attempts', input: { variant: 'turn-only' }, frame: 1, caption: 'A shared turn variable keeps them apart (36 states), but once T1 stops wanting in, T0 waits for a turn that never comes back: no progress.' },
      { h: 'Flags and a turn together' },
      { topic: 'sync-cs-attempts', input: { variant: 'correct' }, frame: 1, caption: 'Peterson\'s algorithm combines the two: mutual exclusion holds in all 626 states, and in every fair schedule each thread gets in again and again.' },
      lab('peterson-check', 'Look, then raise a flag, in the Sync lab', 'The first attempt as a C program: the checker finds the schedule that lets both threads in.'),
      { h: 'Recap' },
      { list: ['Mutual exclusion, progress and bounded waiting are the three requirements.', 'Look-then-set breaks mutual exclusion; set-then-wait and strict turns break progress.', 'A flag for "I want in" plus a turn to break ties satisfies all three.'] },
      X('syn-x-cs-check'), X('syn-x-cs-flags'), X('syn-x-cs-turns'),
    ],
  });

  C.lesson({
    id: 'syn-peterson', chapter: 'syn-races', title: 'Peterson\'s algorithm and reordered memory', minutes: 8,
    summary: 'Peterson\'s algorithm: raise your flag, give the turn to the other, and wait only while the other wants in and has the turn. It is correct when every store reaches memory in program order. On a machine with store buffers a thread can read the other\'s flag before its own store is visible, and both get in; a fence between the stores and the loads repairs it.',
    blocks: [
      'A thread that wants in says so, then politely offers the turn to the other. Why does that work, and does it still work on a modern processor?',
      { code: 'flag[me] = 1;            /* I want in          */\nturn = other;            /* but you go first   */\nwhile (flag[other] && turn == other)\n    ;                    /* wait               */\n/* critical section */\nflag[me] = 0;', lang: 'c' },
      { topic: 'sync-peterson', frame: 8, caption: 'Both flags are up and turn is 1: T0 wrote turn last, so T0 waits. Whoever writes turn last is the one who waits.' },
      { predict: { q: 'T0 sees flag[1] = 0 while turn = 1. Does T0 go in?', options: ['Yes: the other does not want in', 'No: the turn is the other\'s', 'Only after T1 writes turn'], answer: 0, explain: 'T0 waits only while both hold: the other wants in and has the turn. A lowered flag lets it straight in.' } },
      { topic: 'sync-peterson', frame: 16, caption: 'T1 has lowered its flag, so T0 goes in although turn is still 1.' },
      { topic: 'sync-peterson', frame: 31, caption: 'One run of 3 entries proves nothing by itself; the model checker visits all 626 reachable states and confirms both safety and that each thread keeps getting in.' },
      { h: 'When the machine reorders' },
      'Real processors put each store into a store buffer and let later loads go ahead. The thread itself sees its buffered value, but other cores do not, yet. In effect a store can be reordered after a later load.',
      { topic: 'sync-peterson-tso', frame: 14, caption: 'Both are inside: each read the other\'s flag from memory while its own flag = 1 still sat in its store buffer. The checker found this in 40 states, 12 steps.' },
      { topic: 'sync-peterson-tso', input: { variant: 'tso-fence' }, frame: 1, caption: 'A fence after the two stores waits until the buffer has drained before the loads: mutual exclusion holds over all 1778 states.' },
      { warn: 'Hand-made locks out of plain loads and stores are a lesson, not a tool. Real code uses the atomic instructions of the next chapter, or a library mutex, which include the fences the hardware needs.' },
      { h: 'Recap' },
      { list: ['Peterson: flag up, give away the turn, wait while the other wants in and has the turn.', 'The thread that writes turn last waits; that breaks every tie.', 'With store buffers both threads can enter; a fence between the stores and the loads restores the order.'] },
      X('syn-x-peterson-turn'), X('syn-x-tso'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: atomic instructions and locks
  // =========================================================================================================
  C.lesson({
    id: 'syn-atomic', chapter: 'syn-locks', title: 'Test-and-set, compare-and-swap, fetch-and-add', minutes: 6,
    summary: 'Hardware closes the gap between a load and a store with instructions that read and write a word in one indivisible step. Test-and-set returns the old value and writes 1; compare-and-swap writes only if the word holds the expected value; fetch-and-add returns the old value and adds. Split into separate loads and stores, each loses its guarantee.',
    blocks: [
      'Every broken attempt so far failed in the gap between reading a shared word and writing it. What if the hardware made reading and writing one step?',
      { math: 'test_and_set(w):      old = *w; *w = 1;          return old\ncompare_and_swap(w,e,n): old = *w; if (old == e) *w = n; return old\nfetch_and_add(w, k):   old = *w; *w = old + k;    return old\n                       (each runs as one indivisible step)' },
      { topic: 'sync-atomic-ops', frame: 2, caption: 'T0 test-and-set w from 0 to 1 and won the lock. T1 gets back 1: the lock was taken already.' },
      { predict: { q: 'Do test-and-set by hand instead: read w, then write 1, as two steps. Three threads start with w = 0. How many can see 0?', options: ['Only one', 'More than one', 'None'], answer: 1, explain: 'All three can read 0 before any of them writes 1, and each thinks it won.' } },
      { topic: 'sync-atomic-ops', input: { how: 'split' }, frame: 10, caption: 'Split into a load and a store, two threads loaded the same old 0: both think they won. That gap is what the atomic instruction closes.' },
      { topic: 'sync-atomic-ops', input: { op: 'cas' }, frame: 4, caption: 'Compare-and-swap: over all 13 states, at most one swap from 0 succeeds.' },
      { topic: 'sync-atomic-ops', input: { op: 'faa' }, frame: 4, caption: 'Fetch-and-add: the three threads get 0, 1 and 2, all different, in every one of the 16 states. That is a ticket dispenser.' },
      { h: 'Recap' },
      { list: ['An atomic read-modify-write leaves no gap for another thread.', 'Test-and-set makes a lock; compare-and-swap updates a word only if nobody changed it; fetch-and-add hands out distinct numbers.', 'The same steps done as a separate load and store lose the guarantee.'] },
      X('syn-x-split-tas'), X('syn-x-cas'),
    ],
  });

  C.lesson({
    id: 'syn-spin', chapter: 'syn-locks', title: 'Spinlocks, ticket locks and queue locks', minutes: 8,
    summary: 'A spinlock loops on test-and-set until it wins. It is correct but not fair: a waiter can lose every race. A ticket lock hands out numbers with fetch-and-add and serves them in order. A queue lock gives each waiter its own flag to spin on, so a release disturbs one waiter instead of all of them.',
    blocks: [
      'A lock built on test-and-set keeps threads apart. But who gets the lock next when several wait, and what does the waiting cost?',
      { code: 'while (test_and_set(&lock) == 1)\n    ;            /* spin */\n/* critical section */\nlock = 0;', lang: 'c' },
      { topic: 'sync-spinlock', frame: 7, caption: 'T0 spins: test-and-set, find 1, try again. Three spins already, and the CPU does nothing useful meanwhile.' },
      { predict: { q: 'Three threads wait on a test-and-set spinlock. When the holder releases it, who gets it?', options: ['The one that waited longest', 'Whichever happens to test-and-set first', 'The one with the lowest number'], answer: 1, explain: 'The lock remembers nobody: the first test-and-set after the release wins. A slow or unlucky waiter can lose every time, so bounded waiting fails.' } },
      { h: 'Tickets: first come, first served' },
      { code: 'int my = fetch_and_add(&next, 1);   /* take a ticket */\nwhile (serving != my)\n    ;                                /* wait to be called */\n/* critical section */\nserving = serving + 1;               /* call the next */', lang: 'c' },
      { topic: 'sync-spinlock', input: { kind: 'ticket' }, frame: 2, caption: 'T1 took ticket 0 and T0 ticket 1. T0 waits until serving reaches 1, whatever the scheduler does.' },
      { topic: 'sync-spinlock', input: { kind: 'ticket' }, frame: 29, caption: 'Over 299 states the ticket lock keeps mutual exclusion, and every waiter gets in: the tickets fix the order.' },
      { h: 'Queue locks' },
      'On a multiprocessor every waiter of a ticket lock reads the one word serving; each release changes it, and every waiting core\'s cached copy must be refreshed. A queue lock links the waiters in a list, and each spins on a flag in its own node.',
      { topic: 'sync-mcs', frame: 41, caption: 'Each waiter spun only on its own node\'s flag, so a release touches one waiter\'s cache line. The checker confirms it over all 1048 states.' },
      { h: 'Recap' },
      { list: ['A test-and-set spinlock is correct but unfair.', 'A ticket lock serves waiters in the order they arrived.', 'A queue lock keeps each waiter spinning on its own flag, which scales on many cores.'] },
      X('syn-x-spin-fair'), X('syn-x-ticket'), X('syn-x-mcs'),
    ],
  });

  C.lesson({
    id: 'syn-mutex', chapter: 'syn-locks', title: 'A mutex and its sleep queue', minutes: 6,
    summary: 'On one CPU a spinning waiter only delays the holder, who cannot release the lock while the spinner has the CPU. A mutex puts each waiter to sleep on a queue, and unlock hands the mutex straight to the first sleeper. The same work finishes in fewer CPU steps, with none wasted.',
    blocks: [
      'Three threads share one CPU and one lock. The holder is switched out in the middle of its critical section. What should the others do with their time slices?',
      { topic: 'sync-mutex', input: { kind: 'spin' }, frame: 103, caption: 'With a spinlock: all rounds done in 102 CPU steps, 48 of them (47%) spent testing a lock that could not be free.' },
      { predict: { q: 'Replace the spinlock with a mutex that sleeps its waiters. Same threads, same rounds. How many CPU steps are wasted?', options: ['About the same', 'About half as many', 'None'], answer: 2, explain: 'A blocked thread is off the CPU, so every CPU step goes to a thread that can do work.' } },
      { topic: 'sync-mutex', frame: 9, caption: 'T0 unlocks m and hands it to T1, first in line, which wakes owning it. Nobody can sneak in between the unlock and the wake-up.' },
      { topic: 'sync-mutex', frame: 49, caption: 'The same rounds in 48 CPU steps, none wasted: waiting threads slept, and every unlock handed the mutex to the first sleeper.' },
      { tip: 'Spinning still has its place: on a multiprocessor, when the critical section is a few instructions long, spinning briefly is cheaper than two trips through the scheduler. Many real mutexes spin a little, then sleep.' },
      { code: 'pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n\npthread_mutex_lock(&m);\n/* critical section */\npthread_mutex_unlock(&m);', lang: 'c' },
      { h: 'Recap' },
      { list: ['On one CPU a spinner wastes its slices and delays the holder.', 'A mutex sleeps its waiters on a queue.', 'Unlock hands the mutex to the first sleeper, which keeps the order fair.'] },
      X('syn-x-spin-onecpu'), X('syn-x-code-bank'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: semaphores, conditions and monitors
  // =========================================================================================================
  C.lesson({
    id: 'syn-sem', chapter: 'syn-sleep', title: 'Semaphores, counting and binary', minutes: 8,
    summary: 'A semaphore is a counter with a queue. wait (P) takes one unit, sleeping while there are none; post (V) gives one back, or hands it straight to a sleeper. Started at k it guards a pool of k things; started at 1 it is a lock; started at 0 it makes one thread wait for another. A counting semaphore remembers early posts; a binary one keeps at most one.',
    blocks: [
      'An office has two printers and four people who want to print. How do you let at most two print at once, and make the others wait without spinning?',
      { def: 'semaphore', text: 'an integer s with two atomic operations. wait(s): if s > 0, decrease it and go on; otherwise sleep on s\'s queue. post(s): if someone sleeps on s, wake the first and let it pass; otherwise increase s.' },
      { topic: 'sync-semaphore', frame: 4, caption: 's started at 2. T2 and T1 each took one; T3 finds 0 and sleeps on s\'s queue.' },
      { predict: { q: 'T1 now posts s while T3 sleeps on it. What is s afterwards?', options: ['1', '0', '2'], answer: 1, explain: 'The post hands its unit straight to T3, which passes its wait. The value stays 0 and the queue empties.' } },
      { topic: 'sync-semaphore', frame: 9, caption: 'T1 posts: T3 wakes and passes its wait; the value stays 0.' },
      { topic: 'sync-semaphore', frame: 49, caption: 'Never more than 2 inside: the checker confirms it over all 1771 states. The value is the number of free units, the queue the threads waiting for one.' },
      { h: 'Waiting for an event' },
      'Start a semaphore at 0 and it records events: a producer posts each time something is ready, a consumer waits for each. Posts that come early are kept for later waits.',
      { topic: 'sync-semaphore', input: { use: 'signal' }, frame: 9, caption: 'The counting semaphore reached 2: it stored both early posts and handed them to C\'s two waits.' },
      { topic: 'sync-semaphore', input: { use: 'signal', binary: 'binary' }, frame: 8, caption: 'A binary semaphore was already 1 at the second post, so that post was lost, and C\'s second wait sleeps for ever.' },
      { code: 'sem_t s;\nsem_init(&s, 0, 2);   /* 0: shared by this process\'s threads; 2 units */\nsem_wait(&s);\n/* use one unit */\nsem_post(&s);', lang: 'c' },
      { warn: C.macSem },
      { h: 'Recap' },
      { list: ['A semaphore is a count of free units and a queue of waiters.', 'At k: a pool of k; at 1: a lock; at 0: one thread waits for another\'s post.', 'A counting semaphore keeps every early post; a binary one keeps one.'] },
      X('syn-x-sem-lock'), X('syn-x-sem-pool'), X('syn-x-sem-blocked'), X('syn-x-sem-value'), X('syn-x-sem-early'), X('syn-x-sem-meet'), X('syn-x-order-outputs'), X('syn-x-code-order'), X('syn-x-code-meet'),
    ],
  });

  C.lesson({
    id: 'syn-cv', chapter: 'syn-sleep', title: 'Condition variables and the while loop', minutes: 9,
    summary: 'A condition variable lets a thread sleep, inside a mutex, until some state changes. Wait releases the mutex and sleeps; signal wakes one sleeper, broadcast wakes them all; a woken thread must take the mutex back before it returns. By then the state may have changed again, so the wait sits in a while loop that tests the condition afresh.',
    blocks: [
      'A gate is shut. Runners wait at it; a marshal opens it. A semaphore counts, but the gate is a state, open or shut. How does a runner sleep until the state is right?',
      { code: 'pthread_mutex_lock(&m);\nwhile (!open)\n    pthread_cond_wait(&c, &m);   /* release m, sleep, take m back */\n/* the gate is open, and we hold m */\npthread_mutex_unlock(&m);', lang: 'c' },
      { h: 'signal or broadcast' },
      { topic: 'sync-condvar', frame: 9, caption: 'W1 and W2 both wait on c; each wait released m, so the other could get in and wait too.' },
      { predict: { q: 'The marshal sets open = 1 and calls signal(c) once. What happens to the two runners?', options: ['Both pass', 'One passes; the other sleeps for ever', 'Neither passes'], answer: 1, explain: 'signal wakes one sleeper. Nothing will ever signal again, so the other runner sleeps at an open gate.' } },
      { topic: 'sync-condvar', frame: 20, caption: 'The gate is open, yet W2 sleeps on c for ever. A change that may let several threads go needs broadcast.' },
      { topic: 'sync-condvar', input: { wake: 'broadcast' }, frame: 21, caption: 'With broadcast every sleeper moves to the mutex; each, holding it in turn, tests open and passes. Correct in all 71 states.' },
      { h: 'while, not if' },
      'A woken thread does not run at once: it queues for the mutex, and another thread may get there first and change the state back. This is called Mesa semantics, and it is what pthreads give.',
      { topic: 'sync-condvar', input: { scene: 'tickets', wake: 'broadcast', test: 'if' }, frame: 17, caption: 'Broadcast woke both consumers for one ticket. C2 took it; C1, testing only with if, took one that was not there: tickets is -1.' },
      { topic: 'sync-condvar', input: { scene: 'tickets', wake: 'broadcast', test: 'while' }, frame: 24, caption: 'With while, every waiter tests again after waking. Correct in all 135 states; an extra wake-up costs only a test.' },
      { warn: 'A signal with no sleeper is lost: a condition variable keeps no count. Always change the state under the mutex, and always test it under the mutex before waiting, or a wake-up can slip between the test and the wait.' },
      lab('cv-if', 'If instead of while, in the Sync lab', 'A bounded buffer whose consumers test with if: the checker finds the schedule in which one takes an item that is not there.'),
      { h: 'Recap' },
      { list: ['wait releases the mutex and sleeps; it takes the mutex back before returning.', 'signal wakes one sleeper, broadcast all; a change that can free several needs broadcast.', 'Always wait in a while loop that tests the condition again.'] },
      X('syn-x-cv-while'), X('syn-x-cv-broadcast'), X('syn-x-code-gate'), X('syn-x-code-wake'),
    ],
  });

  C.lesson({
    id: 'syn-monitor', chapter: 'syn-sleep', title: 'Monitors: Mesa and Hoare', minutes: 6,
    summary: 'A monitor packages shared data with the procedures that use it and one lock that every procedure holds, plus condition variables. Under Hoare semantics a signal hands the monitor straight to the woken thread, so the condition it waited for still holds; under Mesa semantics the woken thread queues for the lock, so it must test again.',
    blocks: [
      'A bank account is a monitor: withdraw and deposit run one at a time, and withdraw waits while the balance is too low. When deposit signals, who runs next?',
      { def: 'monitor', text: 'a module whose data can be reached only through its procedures, with at most one thread active inside it at a time, and condition variables for waiting inside.' },
      { topic: 'sync-monitor', frame: 1, caption: 'Mesa semantics with if: the checker found a schedule of 15 steps, in 39 states, that breaks "balance never below 0".' },
      { topic: 'sync-monitor', frame: 17, caption: 'balance is -1: the signalled withdrawer only rejoined the queue for the monitor; another withdrawer got in first and took the money.' },
      { predict: { q: 'Keep the if, but switch to Hoare semantics, where signal hands the monitor straight to the woken thread. Is the balance safe?', options: ['Yes', 'No'], answer: 0, explain: 'The woken withdrawer runs at once, before anyone else can enter, so the deposit it was promised is still there.' } },
      { topic: 'sync-monitor', input: { sem: 'hoare' }, frame: 17, caption: 'Hoare: D signals funds, and W2 takes the monitor at once while D waits to get it back.' },
      { topic: 'sync-monitor', input: { sem: 'hoare' }, frame: 22, caption: 'Correct over all 149 states with if. The price: every signal costs two switches, and the signaller waits.' },
      { topic: 'sync-monitor', input: { test: 'while' }, frame: 24, caption: 'Mesa with while: the woken withdrawer tests the balance again, and the checker agrees over all 141 states. This is how pthreads code is written.' },
      { h: 'Recap' },
      { list: ['A monitor is data, its procedures, one lock and condition variables.', 'Hoare: the signalled thread runs at once, so if suffices.', 'Mesa (pthreads): the signalled thread queues, so test with while.'] },
      X('syn-x-mesa'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: locks in practice, and checking them
  // =========================================================================================================
  C.lesson({
    id: 'syn-structs', chapter: 'syn-practice', title: 'Lock-based data structures', minutes: 8,
    summary: 'One lock round a whole structure is simple and correct, but every operation waits for every other. Finer locking lets independent operations overlap: a counter with per-thread parts flushed every S steps, a list locked hand over hand, a hash table with a lock per bucket. Each finer scheme has a rule that must be kept exactly.',
    blocks: [
      'A shared counter, a list and a hash table are each protected by one lock. Eight cores share them. Why does the program not run any faster on eight cores than on one?',
      { topic: 'sync-struct-counter', input: { variant: 'lock' }, frame: 1, caption: 'One lock: 0.14 increments per tick with 1 thread and only 0.25 with 8. The lock makes the increments take turns.' },
      { h: 'An approximate counter' },
      'Each thread counts in a local part of its own and adds it to the global count only when the local part reaches a threshold S. The global count lags, by at most S per thread, but threads rarely meet at the lock.',
      { topic: 'sync-struct-counter', frame: 45, caption: 'At the end the global count is exact; on the way it lagged behind the true count, and the checker confirms the final count over 90 states.' },
      { h: 'A list, hand over hand' },
      { topic: 'sync-struct-list', frame: 0, caption: 'Hand over hand: hold the lock of the node before and of the node you look at; take the next lock before letting the previous go. The checker covers all 209 states.' },
      { predict: { q: 'A thread lets go of one node\'s lock before taking the next. What can go wrong?', options: ['Nothing: it holds a lock at almost every moment', 'Another thread can unlink the next node in that gap, and an insert after it is lost', 'The list deadlocks'], answer: 1, explain: 'In the moment with no lock held, the other thread unlinks the node; the insert then links its new node after a node that is no longer in the list.' } },
      { topic: 'sync-struct-list', input: { variant: 'hoh-broken' }, frame: 44, caption: 'The list is 30 where it should hold 20, 30: the insert was linked after a node already unlinked.' },
      { h: 'A hash table, a lock per bucket' },
      { topic: 'sync-struct-hash', frame: 0, caption: 'On an ideal machine with 8 buckets and 8 threads: one lock gives 0.22 operations per tick, a lock per bucket 0.81.' },
      { topic: 'sync-struct-hash', input: { variant: 'no-lock' }, frame: 21, caption: 'No lock at all: both threads copied the same bucket and wrote their copy back, and key 2 vanished.' },
      lab('list-broken', 'One lock at a time, in the Sync lab', 'The broken list as C: the checker finds the lost insert and replays it.'),
      { h: 'Recap' },
      { list: ['One big lock is correct and simple, and serialises everything.', 'Finer locks (per-thread parts, hand over hand, per bucket) let independent work overlap.', 'Each fine scheme has an exact rule; break it and updates are lost.'] },
      X('syn-x-sloppy'), X('syn-x-hoh'), X('syn-x-hash-lock'),
    ],
  });

  C.lesson({
    id: 'syn-check', chapter: 'syn-practice', title: 'Checking concurrent programs', minutes: 8,
    summary: 'A model checker explores the states a program can reach, step by step, merging states reached by different orders, and checks each against the specification: assertions, invariants, and no deadlock. Partial-order reduction skips orders that cannot matter. When the space is too big, a bound on preemptions or random schedules search part of it, and only the bounded search says exactly what it covered.',
    blocks: [
      'Testing runs a program a few times, on whatever schedules the machine picks. How can we look at all of them?',
      { topic: 'sync-checker-search', frame: 2, caption: 'The checker grows the state graph a step at a time. States reached by different orders are merged: the graph is not a tree.' },
      { topic: 'sync-checker-search', frame: 9, caption: 'The count++ race breaks "at the end count = 2"; a breadth-first search then trims the failing schedule to a shortest one, 6 steps.' },
      { h: 'Skipping orders that do not matter' },
      { topic: 'sync-checker-search', input: { prog: 'peterson-correct' }, frame: 2, caption: 'Partial-order reduction on Peterson: 626 states and 992 steps instead of 684 and 1368, the same answer for 27% less work.' },
      { h: 'Bounds and random schedules' },
      { predict: { q: 'Peterson on store buffers fails. Allowing no preemptions at all, will a search find the failure?', options: ['Yes', 'No: the bug needs a thread to be switched out at the wrong moment'], answer: 1, explain: 'With 0 preemptions threads switch only when they block or finish; the 74 states reached hold no failure. One preemption is enough to find it.' } },
      { topic: 'sync-checker-bounds', frame: 2, caption: 'With 1 preemption allowed, the bounded search finds the failure after 373 states.' },
      { topic: 'sync-checker-bounds', frame: 3, caption: 'Random schedules hit it too, at run 77 of 300, after 38248 steps: luck, not a guarantee.' },
      { topic: 'sync-checker-bounds', input: { prog: 'lock-order-ab-ba' }, frame: 4, caption: 'For two locks taken in opposite orders, PCT ran 300 schedules and found nothing. Random testing can miss a bug for a long time.' },
      lab('lock-order', 'Two locks in opposite orders, in the Sync lab', 'The checker finds the deadlock in a handful of states and replays the schedule.'),
      { h: 'Recap' },
      { list: ['A model checker visits every reachable state and checks assertions, invariants and deadlock.', 'Partial-order reduction prunes orders of independent steps.', 'A preemption bound covers every schedule within it; random runs cover only what they hit.'] },
      X('syn-x-bounds'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
