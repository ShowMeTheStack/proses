// Part 8, classic problems and concurrency bugs: the lessons of chapters 3 and 4 (philosophers, barbers and barriers;
// concurrency bugs and event loops). The chapters themselves are made in 080-classic.js. Every value quoted comes
// from the topics' own runs, on the inputs named in each block.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || !C.chapters.some((c) => c.id === 'cls-table') || C.lessons.has('cls-phil')) return;
  const X = (id) => ({ exercise: id });
  const lab = (id, title, text) => {
    const p = ((S.SyncLab && S.SyncLab.PROGS) || []).find((q) => q.id === id);
    return { lab: 'sync', title, text, setup: p ? { src: p.src, spec: p.spec, gran: p.gran, mode: p.mode } : {} };
  };
  // what a topic says on an input: its frames, the states the checker explored, the steps of a failing schedule
  const framesOf = (id, input) => { const t = S.byId && S.byId(id); return t ? t.run(S.inputOf(t, input || {})).frames : []; };
  const said = (fs, re, d) => { for (const f of fs) { const m = re.exec(f.say || ''); if (m) return m[1]; } return d; };
  const statesOf = (fs) => said(fs, /(\d+) distinct states/, 'many'), stepsOf = (fs) => said(fs, /has (\d+) steps/, 'a few');
  const lastOf = (fs, d) => (fs.length ? fs.length - 1 : d);

  // =========================================================================================================
  // Chapter 3: philosophers, barbers and barriers
  // =========================================================================================================
  C.lesson({
    id: 'cls-phil', chapter: 'cls-table', title: 'The dining philosophers and three fixes', minutes: 9,
    summary: 'Philosophers round a table share one fork with each neighbour. If each picks up the left fork and then waits for the right, all can end up holding one fork and waiting for ever: a deadlock with all four conditions in place. Taking forks in one global order, a waiter, or one seat fewer than philosophers each break the circular wait.',
    blocks: [
      'Three philosophers think and eat in turn. Between each pair lies one fork, and eating takes two. Each one simply picks up the fork on its left, then the one on its right. What could go wrong?',
      { topic: 'classic-phil-deadlock', frame: 0, caption: '3 philosophers, 3 forks: fork i lies between philosopher i and philosopher i + 1. Each takes fork i, then fork i + 1 (mod 3).' },
      { topic: 'classic-phil-deadlock', frame: 6, caption: 'P0 holds fork 0 and waits for fork 1, which P1 holds.' },
      { predict: { q: 'P1 holds fork 1. P2 now picks up fork 2. What happens next?', options: ['A deadlock: P1 waits for fork 2, P2 for fork 0', 'P2 eats', 'P0 gives up its fork'], answer: 0, explain: 'P2 next reaches for fork 0, which P0 holds. Every philosopher holds one fork and waits for the next: the checker finds this in a 9-step schedule out of 95 states.' } },
      { topic: 'classic-phil-deadlock', frame: 11, caption: 'Deadlock at step 9: P0 waits for fork 1 (P1 has it), P1 for fork 2 (P2), P2 for fork 0 (P0). Mutual exclusion, hold and wait, no preemption and a circular wait, all at once.' },
      { h: 'Three fixes' },
      { topic: 'classic-phil-fixes', frame: 0, caption: 'Lowest fork first: P2\'s forks are 2 and 0, so it reaches for fork 0 first. The waits can no longer close into a circle.' },
      { topic: 'classic-phil-fixes', frame: 1, caption: 'The checker finds no deadlock in 155 states, and no philosopher who can wait for ever.' },
      { topic: 'classic-phil-fixes', input: { variant: 'arbiter', seed: 5 }, frame: 0, caption: 'A waiter lets one philosopher at a time pick up forks: 309 states, all safe.' },
      { topic: 'classic-phil-fixes', input: { variant: 'seats', seed: 7 }, frame: 0, caption: 'n − 1 seats: with at most 2 of the 3 seated, one of them always gets both forks. 374 states, all safe.' },
      { tip: 'All three fixes keep forks exclusive, let a philosopher hold one fork while waiting, and never snatch a fork: each breaks the circular wait instead.' },
      lab('phil', 'The philosophers in the Sync lab', 'The deadlocking table in C; reorder the locks and check again.'),
      { h: 'Recap' },
      { list: ['Left fork, then right: every philosopher can hold one and wait for the next.', 'A deadlock needs mutual exclusion, hold and wait, no preemption and a circular wait.', 'Lowest fork first, a waiter, or n − 1 seats each make the circle impossible.'] },
      X('cls-x-phil-graph'), X('cls-x-phil-ordered'), X('cls-x-phil-rule'), X('cls-x-phil-seats'), X('cls-x-phil-code'),
    ],
  });

  C.lesson({
    id: 'cls-chandy', chapter: 'cls-table', title: 'Clean and dirty forks', minutes: 7,
    summary: 'A scheme without a waiter or a fixed order: each fork is held by one neighbour and is clean or dirty. A hungry philosopher asks for the forks it lacks; a holder hands over a dirty fork (cleaned) unless it is eating, and keeps a clean one. Started with no cycle of precedence, nobody deadlocks and nobody starves.',
    blocks: [
      'The fixes so far either rank the forks or add a referee. Can neighbours settle it between themselves, with only messages between neighbours, and still be fair?',
      { list: ['Each fork is held by one of its two neighbours, and is **clean** or **dirty**.', 'A hungry philosopher sends a request for each fork it lacks.', 'A holder that gets a request for a **dirty** fork cleans it and hands it over, unless it is eating; a **clean** fork it keeps.', 'Eating makes both forks dirty.'] },
      { topic: 'classic-chandy', frame: 0, caption: 'Forks start dirty, each with its lower-numbered neighbour, so the order of who goes first has no cycle.' },
      { topic: 'classic-chandy', frame: 6, caption: 'P1 asked for fork 0. P0 holds it dirty, so it cleans it and hands it over.' },
      { predict: { q: 'A hungry philosopher holds a clean fork and its neighbour asks for it. Does it hand it over?', options: ['No: a clean fork has not been eaten with yet', 'Yes, always', 'Only if the neighbour has waited longer'], answer: 0, explain: 'A clean fork marks a philosopher that got it on request and has not eaten yet; keeping it is what guarantees it eats next. After eating, the fork is dirty and goes to the next asker.' } },
      { topic: 'classic-chandy', frame: 12, caption: 'P2 has both forks and eats; both turn dirty, so the next request takes them away.' },
      { topic: 'classic-chandy', frame: 1, caption: 'The checker explores every order of the philosophers\' moves: 930 states, no deadlock, neighbours never eat at once, and every hungry philosopher eats eventually.' },
      { topic: 'classic-chandy', input: { variant: 'cyclic' }, frame: 8, caption: 'Start each philosopher with one clean fork instead, a cyclic start, and all three are stuck after 6 steps: each holds a clean fork it will not give up.' },
      { h: 'Recap' },
      { list: ['Dirty forks go to whoever asks; clean forks stay until their holder eats.', 'Eating dirties the forks, so a philosopher who just ate yields to its neighbours.', 'The start must have no cycle of precedence; then nobody deadlocks or starves.'] },
      X('cls-x-chandy'),
    ],
  });

  const BAR = framesOf('classic-barber'), BARU = framesOf('classic-barber', { variant: 'no-mutex' });
  const SMG = framesOf('classic-smokers'), SMH = framesOf('classic-smokers', { variant: 'helpers' });
  C.lesson({
    id: 'cls-barber', chapter: 'cls-table', title: 'The sleeping barber and the smokers', minutes: 8,
    summary: 'A barber who naps when nobody waits and customers who leave when every waiting seat is taken: two semaphores signal between them, and seat_lock makes "look for a free seat, then take it" one step. The cigarette smokers show why grabbing two resources one at a time can deadlock, and how helper threads that look at the whole table first fix it.',
    blocks: [
      'A shop has one barber and a few seats to wait in. With nobody waiting, the barber naps. A customer who finds every seat taken leaves. Who wakes whom, and what keeps two customers from taking the last seat?',
      { code: 'barber:    loop { wait(arrivals); wait(seat_lock); free_seats++; post(call_next); post(seat_lock); cut hair }\ncustomer:  wait(seat_lock);\n           if (free_seats > 0) { free_seats--; post(arrivals); post(seat_lock); wait(call_next); get a haircut }\n           else { post(seat_lock); leave }', lang: 'text' },
      { topic: 'classic-barber', frame: 0, caption: 'One barber, 1 waiting seat, 2 customers who keep coming back. free_seats counts the empty seats down; arrivals wakes the barber; call_next calls one seated customer to the chair; seat_lock guards free_seats.' },
      { topic: 'classic-barber', frame: 1, caption: 'With seat_lock: ' + statesOf(BAR) + ' states, no deadlock, free_seats never below 0, and nobody seated waits for ever.' },
      { predict: { q: 'Take seat_lock away. Can more customers sit than there are seats?', options: ['Yes', 'No'], answer: 0, explain: 'Two customers can both read free_seats = 1 before either takes the seat: the checker drives free_seats below 0 in a ' + stepsOf(BARU) + '-step schedule.' } },
      { topic: 'classic-barber', input: { variant: 'no-mutex' }, frame: lastOf(BARU, 8), caption: 'Without seat_lock both customers read free_seats before either took the seat: the look and the take were not one step.' },
      { h: 'The cigarette smokers' },
      'An agent puts two of three ingredients (tobacco, paper, matches) on the table; three smokers each hold one ingredient for ever and need the other two. The agent posts two semaphores; each smoker waits on the two it lacks, one after the other.',
      { topic: 'classic-smokers', frame: 1, caption: 'Grabbing in turn: the checker finds a deadlock in ' + statesOf(SMG) + ' states, ' + stepsOf(SMG) + ' steps in.' },
      { topic: 'classic-smokers', frame: lastOf(SMG, 15), caption: 'Each blocked smoker took one ingredient of the pair: each holds half of what another needs, and the agent waits for a smoke that cannot happen.' },
      { topic: 'classic-smokers', input: { variant: 'helpers' }, frame: 1, caption: 'With helpers, one per ingredient: under table_lock each notes its ingredient in on_table, and the one that finds the pair complete posts go for the only smoker who can use it: ' + statesOf(SMH) + ' states, all safe.' },
      lab('barber-nomutex', 'The barber without seat_lock, in the Sync lab', 'Watch two customers take one seat, then put seat_lock back.'),
      { h: 'Recap' },
      { list: ['The barber naps on arrivals; a seated customer waits on call_next for its turn.', 'Looking for a free seat and taking it must be one step, under seat_lock.', 'Taking two resources one by one can deadlock; helpers that look at the whole table first and wake the right thread avoid it.'] },
      X('cls-x-sem-barber'), X('cls-x-smokers'),
    ],
  });

  const BPR = framesOf('classic-barrier'), BRA = framesOf('classic-barrier', { variant: 'racy' }), BG = { variant: 'two-gates', n: 2, rounds: 2, seed: 5 }, BGA = framesOf('classic-barrier', BG);
  const CRE = framesOf('classic-crew'), CRC = framesOf('classic-crew', { variant: 'correct' });
  C.lesson({
    id: 'cls-barriers', chapter: 'cls-table', title: 'Barriers, and crewing the boats', minutes: 8,
    summary: 'A barrier holds every thread until all n have arrived. A count under a lock finds the last arrival, which opens a gate for the others. Used again in a loop it needs two gates, used in alternate rounds, or a fast thread slips through the gate that is still open. A boat crew of two rowers and a cox needs the dock kept shut until all three are aboard.',
    blocks: [
      'A simulation runs in rounds: every thread computes its part of round r, and none may start round r + 1 until all have finished round r. How do threads wait for each other?',
      { topic: 'classic-barrier', frame: 0, caption: '3 threads, 2 rounds through a barrier primitive. The invariant: nobody passes round r before every thread has arrived at round r.' },
      { topic: 'classic-barrier', frame: 7, caption: 'T1 is the last of 3 to arrive, so everyone passes together. The checker finds the primitive correct over ' + statesOf(BPR) + ' states.' },
      { code: 'wait(count_lock); count++; last = (count == n); post(count_lock)\nif (last) post(gate) n times          /* the last one in opens the gate for all n */\nwait(gate)', lang: 'text' },
      { predict: { q: 'Drop count_lock, so count++ can be interrupted between its load and its store. Will every thread always get through?', options: ['Yes', 'No'], answer: 1, explain: 'Two threads can read the same value of count: it never reaches n, the last arrival does not know it is last, and the gate is never opened. The checker finds the deadlock ' + stepsOf(BRA) + ' steps in.' } },
      { topic: 'classic-barrier', input: { variant: 'racy' }, frame: lastOf(BRA, 20), caption: 'Stuck at step ' + stepsOf(BRA) + ': T0, T1 and T2 all wait on the gate, because one arrival was lost from the count.' },
      'Used again in a loop, one gate is not enough: a fast thread that comes round to the next round could slip through a gate still open from this one. So the rounds take turns between two gates. The last to arrive resets count, opens this round\'s gate for the n − 1 others and goes straight on; a fast thread meets the other gate, still shut.',
      { code: 'wait(count_lock); count++\nif (count == n) { count = 0; post(this round\'s gate) n − 1 times; post(count_lock) }   /* gate_even, then gate_odd, ... */\nelse { post(count_lock); wait(this round\'s gate) }', lang: 'text' },
      { topic: 'classic-barrier', input: BG, frame: 0, caption: 'Two gates in alternate rounds: gate_even for rounds 0, 2, ..., gate_odd for rounds 1, 3, ...' },
      { topic: 'classic-barrier', input: BG, frame: 1, caption: 'Two gates, 2 threads, 2 rounds: ' + statesOf(BGA) + ' states, all safe, and nobody waits for ever.' },
      { h: 'Crewing the boats' },
      { topic: 'classic-crew', frame: 1, caption: 'Rowers and coxes sign in under dock; whoever completes a crew calls two rowers and a cox aboard, but frees dock at once. A second crew is called while the first is still boarding: "each boat takes two rowers and one cox" breaks in a ' + stepsOf(CRE) + '-step schedule.' },
      { topic: 'classic-crew', input: { variant: 'correct' }, frame: 1, caption: 'Dock kept shut until the last of the three is aboard, who frees it: ' + statesOf(CRC) + ' states, all safe.' },
      lab('barrier', 'The reusable barrier in the Sync lab', 'A barrier in C that is used round after round, checked over every schedule.'),
      { h: 'Recap' },
      { list: ['Count arrivals under a lock; the last one in opens the gate for everyone.', 'A barrier used again needs two gates in alternate rounds, so a fast thread cannot slip through the one still open.', 'A group that must stay together needs the door kept shut until all its members are in.'] },
      X('cls-x-sem-meet'), X('cls-x-barrier-code'), X('cls-x-crew'), { challenge: 'cls-ch-barrier' },
    ],
  });

  // =========================================================================================================
  // Chapter 4: concurrency bugs and event loops
  // =========================================================================================================
  C.lesson({
    id: 'cls-violations', chapter: 'cls-bugs', title: 'Atomicity and order violations', minutes: 7,
    summary: 'Most concurrency bugs found in real programs are not deadlocks. In an atomicity violation, two steps meant to be indivisible are interrupted; in an order violation, one step is assumed to come before another and nothing enforces it. A lock fixes the first, a semaphore or condition the second.',
    blocks: [
      'A thread checks that a pointer is set, then uses it. Another thread clears it when it closes the object. Tested a thousand times, the program works. Why does it crash once a month?',
      { def: 'atomicity violation', text: 'a sequence of steps the programmer meant to be indivisible (check, then use) is interleaved with a step of another thread that changes what was checked.' },
      { topic: 'classic-bug-violations', frame: 0, caption: 'T0 checks that p is set, then uses it; T1 clears p.' },
      { predict: { q: 'Can this program fail?', options: ['Yes', 'No'], answer: 0, explain: 'T1 can run between T0\'s check and its use: the checker finds it in 10 states, 5 steps in.' } },
      { topic: 'classic-bug-violations', frame: 4, caption: 'T0 has checked p and found it set; now T1 clears p.' },
      { topic: 'classic-bug-violations', frame: 6, caption: 'T0 reads p again to use it, finds nothing, and its assertion fails. The check and the use were one idea but two steps.' },
      { topic: 'classic-bug-violations', input: { variant: 'atomicity-fixed' }, frame: 1, caption: 'With the check, the use and the clearing under one lock: 23 states, all correct.' },
      { def: 'order violation', text: 'a step of one thread is assumed to happen before a step of another (set up, then use), and nothing makes it so.' },
      { topic: 'classic-bug-violations', input: { variant: 'order' }, frame: 3, caption: 'T1 uses the object before T0 has set it up: the program assumed an order nothing enforced. 2 steps suffice.' },
      { topic: 'classic-bug-violations', input: { variant: 'order-fixed' }, frame: 1, caption: 'T1 waits on a semaphore that T0 posts after the set-up: 8 states, all correct.' },
      lab('bug-atomicity', 'Check, then use, in the Sync lab', 'The atomicity violation in C, at the granularity of single loads and stores.'),
      { h: 'Recap' },
      { list: ['Atomicity violation: steps meant to be one are split; put them under one lock.', 'Order violation: an order is assumed, not enforced; make the later step wait for the earlier one.', 'Both usually pass testing: the bad interleaving is rare, which is why a checker that tries every schedule helps.'] },
      X('cls-x-bug-kind'), X('cls-x-out-volume'), X('cls-x-out-cake'), X('cls-x-seat-code'),
    ],
  });

  C.lesson({
    id: 'cls-deadlock-wakeup', chapter: 'cls-bugs', title: 'Lock order and the lost wake-up', minutes: 7,
    summary: 'Two threads that take the same two locks in opposite orders can each hold one and wait for the other; one global lock order prevents it. A thread that tests a flag before taking the lock can miss the signal that the flag changed and sleep for ever; test it under the lock, in a loop.',
    blocks: [
      'A transfer between two accounts locks both. One thread moves money from A to B, locking A then B; another moves from B to A, locking B then A. Both run at once. What can happen?',
      { topic: 'classic-bug-deadlock', frame: 0, caption: 'T0 takes A then B; T1 takes B then A. On the right, a lock points to its holder and a blocked thread to the lock it wants.' },
      { topic: 'classic-bug-deadlock', frame: 6, caption: 'Deadlock at step 4: T0 → B → T1 → A → T0. Each holds one lock and waits for the other.' },
      { topic: 'classic-bug-deadlock', input: { variant: 'ordered' }, frame: 1, caption: 'Both take A before B: 34 states, no deadlock. A global order (by account number, by address) makes the cycle impossible.' },
      { h: 'The lost wake-up' },
      { topic: 'classic-bug-deadlock', input: { variant: 'lost-wakeup' }, frame: 0, caption: 'W waits until S has set flag. W tests the flag, then takes the lock and waits; S sets the flag and signals.' },
      { predict: { q: 'W has tested the flag (0) but not yet taken the lock. S now sets the flag and signals. Can both threads end up asleep for ever?', options: ['Yes', 'No'], answer: 0, explain: 'Nobody waits on c yet, so the signal is lost (a condition variable keeps no count). W then waits for a signal that has already been sent: stuck after 8 steps.' } },
      { topic: 'classic-bug-deadlock', input: { variant: 'lost-wakeup' }, frame: 7, caption: 'S signals c, but nobody waits: the signal is lost.' },
      { topic: 'classic-bug-deadlock', input: { variant: 'lost-wakeup' }, frame: 10, caption: 'W sleeps on a condition that is already true, and no thread is left to wake it.' },
      { topic: 'classic-bug-deadlock', input: { variant: 'lost-fixed' }, frame: 1, caption: 'Tested under the lock, in a loop: 23 states, all correct. S cannot change the flag between W\'s test and its wait.' },
      lab('bug-wakeup', 'The lost wake-up in the Sync lab', 'Replay the schedule that loses the signal, then move the test under the lock.'),
      { h: 'Recap' },
      { list: ['Opposite lock orders can deadlock; one global order cannot.', 'A signal with nobody waiting is lost.', 'Test the condition while holding the mutex, and wait in a while loop.'] },
      X('cls-x-lock-graph'), X('cls-x-wakeup-code'),
    ],
  });

  C.lesson({
    id: 'cls-events', chapter: 'cls-bugs', title: 'An event loop instead of threads', minutes: 8,
    summary: 'A server can give each request a thread that blocks on its I/O, or run one thread round a loop: take the next event, run its short handler, start any I/O without waiting, and handle the completion later as another event. One stack, no locks, the same overlap of I/O, as long as no handler blocks or runs long.',
    blocks: [
      'A server spends most of each request waiting for a disk or a network. A thread per request keeps the CPU busy while others wait, at the price of a stack each and a switch each time. Is there a way to overlap the waiting with one thread?',
      { topic: 'classic-events', frame: 0, caption: 'Three requests on one core: A arrives at 0 ms, needs 2 ms of CPU, 6 ms of I/O, then 1 ms; B arrives at 1 ms (2, 5, 1); C at 2 ms (1, 8, 2).' },
      { topic: 'classic-events', frame: 1, caption: 'At 0 ms the loop runs A\'s handler for 2 ms: it parses the request and starts the I/O without waiting. The I/O will come back at 8 ms as an event.' },
      { predict: { q: 'By 5 ms the loop has started C\'s I/O, which ends at 13 ms. A\'s I/O ends at 8 ms and B\'s at 9 ms. Which event does the loop take next?', options: ['A\'s I/O completion, at 8 ms', 'B\'s I/O completion', 'C\'s'], answer: 0, explain: 'Events are handled in the order they happen. Nothing is queued until 8 ms, when A\'s I/O completes.' } },
      { topic: 'classic-events', frame: 4, caption: 'At 8 ms the loop takes A\'s completion and answers in 1 ms, at 9 ms, 9 ms after A arrived.' },
      { topic: 'classic-events', frame: 7, caption: 'One thread with blocking I/O finishes at 28 ms (mean response 17 ms). A thread per request finishes at 18 ms (mean 12.33) with up to 3 threads and 192 KB of stacks. The event loop finishes at 15 ms (mean 10.33) with one thread and 64 KB.' },
      { warn: 'A handler that blocks, or computes for long, stops the whole server: every other event waits behind it. Long work goes to a helper thread, and I/O is always started asynchronously.' },
      { topic: 'classic-events', input: { reqs: 'A 0 1 12 1; B 2 1 12 1; C 4 1 12 1', sw: 0, stack: 1024 }, frame: 7, caption: 'A slow disk and free switches: now threads and the loop tie at 18 ms (mean 14), but the threads need 3072 KB of stacks against 1024 KB.' },
      { h: 'Recap' },
      { list: ['An event loop takes one event at a time and runs a short handler for it.', 'I/O is started without waiting; its completion is a later event.', 'One stack and no locks, as long as no handler blocks or runs long.'] },
      X('cls-x-ev-block'), X('cls-x-ev-table'), X('cls-x-ev-mean'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
