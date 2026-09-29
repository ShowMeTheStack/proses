// Part 6, multicore and real-time scheduling: the rest of chapter 2 (EDF and the schedulability tests) and chapter 3
// (priority inversion). The chapters are declared in 060-multi.js. Every value quoted was read from the topics' own
// runs (S.Sched.rt, rtAnalysis and inversion) on the inputs named in each block.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('mrt-edf')) return;
  const X = (id) => ({ exercise: id });
  const lab = (title, text, setup) => ({ lab: 'scheduler', title, text, setup });
  const PI3 = 'L 3 0: run 1, lock mtx, run 4, unlock mtx, run 1\nH 1 3: run 1, lock mtx, run 2, unlock mtx, run 1\nM 2 4: run 6';
  const CHAIN = 'L 3 0: run 1, lock a, run 4, unlock a, run 1\nM 2 1: run 1, lock b, run 4, unlock b\nH 1 3: run 1, lock b, run 1, unlock b, lock a, run 1, unlock a';

  C.lesson({
    id: 'mrt-edf', chapter: 'mrt-rt', title: 'Earliest deadline first', minutes: 7,
    summary: 'EDF runs the job whose absolute deadline is soonest, so priorities belong to jobs, not tasks, and change as jobs are released. On one CPU with deadlines equal to periods, EDF meets every deadline whenever U ≤ 1: it can use the whole processor. Overloaded, it misses too, but differently from RM.',
    blocks: [
      'RM missed B1 in the set (2, 5), (4, 7), even though the CPU was idle for part of the hyperperiod. At t = 5, A2 (due at 10) took the CPU from B1 (due at 7). Was that a sensible choice?',
      { def: 'earliest deadline first (EDF)', text: 'the ready job with the earliest absolute deadline runs; a newly released job preempts only if its deadline is strictly earlier. Each job\'s priority is fixed, but jobs of one task get different priorities over time.' },
      { topic: 'rt-edf', frame: 2, caption: 't = 5: A2 is released, due at 10, but B1 is due at 7, so B1 runs on. Under RM, A2 would have preempted it.' },
      { topic: 'rt-edf', frame: 20, caption: 'Every deadline met over the hyperperiod of 35, with U = 0.971.' },
      { topic: 'rt-edf', frame: 21, caption: 'The same tasks under RM: 1 deadline missed (B1), against 0 under EDF. A long-period job close to its deadline can go ahead of a short-period one.' },
      { predict: { q: 'Tasks (2, 4) and (3, 5): U = 1.1. What happens under EDF?', options: ['Every deadline is met: EDF is optimal', 'Some deadlines are missed: there is more work than time', 'Only B\'s jobs are missed'], answer: 1, explain: 'U > 1: no policy can fit the work. Over the hyperperiod of 20, EDF misses 2 deadlines (A4 and A5); RM misses 4, all of B\'s.' } },
      { topic: 'rt-edf', input: { tasks: 'A 2 4\nB 3 5' }, frame: 11, caption: 'Overloaded, U = 1.1: EDF misses A4 and A5. Overload under EDF can hit any task, even the most frequent one.' },
      { table: [['', 'RM', 'EDF'], ['Priority', 'fixed per task (by period)', 'per job (by deadline)'], ['Schedulable when D = T', 'sure if U ≤ n(2^(1/n) − 1); exactly by response-time analysis', 'exactly when U ≤ 1'], ['Under overload', 'the long-period tasks miss', 'misses can fall on any task'], ['Cost', 'a fixed priority queue', 'a queue ordered by deadline, updated per job']], caption: 'RM against EDF on one CPU.' },
      { h: 'Recap' },
      { list: ['EDF: the earliest absolute deadline runs.', 'With D = T, every set with U ≤ 1 is schedulable by EDF.', 'Overload makes misses certain, and EDF gives no say over which.'] },
      X('mrt-x-edf-gantt'), X('mrt-x-edf-why'), X('mrt-x-overload'),
    ],
  });

  C.lesson({
    id: 'mrt-bound', chapter: 'mrt-rt', title: 'Will it meet its deadlines? Bounds and response times', minutes: 9,
    summary: 'For RM with deadlines equal to periods, a set of n tasks is sure to be schedulable if U ≤ n(2^(1/n) − 1), about 0.78 for three tasks. The bound is sufficient, not necessary: above it, response-time analysis decides exactly, iterating R = C + Σ ⌈R / T_j⌉ C_j over the higher-priority tasks until R settles, and comparing R with the deadline.',
    blocks: [
      'Running a schedule over the hyperperiod tells you whether a set works, but the hyperperiod can be enormous. Is there a test that works from C and T alone?',
      { math: 'RM bound:   U = Σ C_i / T_i ≤ n · (2^(1/n) − 1)\n  n = 1: 1     n = 2: 0.828     n = 3: 0.78     n = 4: 0.757     large n: about 0.693' },
      { topic: 'rt-bound', frame: 2, caption: 'Adding tasks one at a time: with A, B and C, U = 0.833 is over the bound for 3 tasks, 0.78, so the bound cannot promise anything for RM.' },
      { topic: 'rt-bound', frame: 4, caption: 'Yet the exact test says RM does meet every deadline of this set: the bound is only sufficient.' },
      { topic: 'rt-bound', input: { tasks: 'A 2 5\nB 4 7' }, frame: 2, caption: 'The two-task set (2, 5), (4, 7): U = 0.971 is over the bound of 0.828, and this time the exact test says RM fails, as the schedule showed.' },
      { def: 'response-time analysis', text: 'for each task under RM, start with R = C and repeatedly set R = C + Σ over higher-priority tasks j of ⌈R / T_j⌉ · C_j, the work they release in a window of length R. When R stops changing, it is the task\'s worst response time; the task is safe if R ≤ D.' },
      { topic: 'rt-rta', frame: 6, caption: 'Task C (3, 12), under A and B. In a window of 3, A and B release one job each: R = 3 + 1 + 2 = 6.' },
      { predict: { q: 'Next, in a window of 6, A (period 4) releases 2 jobs and B (period 6) releases 1. What is the new R?', options: ['6', '7', '9'], answer: 1, explain: 'R = 3 + 2 × 1 + 1 × 2 = 7. The window grew, so it is checked again.' } },
      { topic: 'rt-rta', frame: 9, caption: 'R goes 3 → 6 → 7 → 9 → 10 and settles at 10, within C\'s deadline of 12: C is safe, and its worst response in the schedule was indeed 10.' },
      { topic: 'rt-rta', input: { tasks: 'A 2 5\nB 4 7' }, frame: 5, caption: 'For B in the two-task set: R goes 4 → 6 → 8, past the deadline of 7. B can miss, which is what the schedule showed at t = 7.' },
      lab('Four tasks, tested', 'Tasks (1, 4), (2, 6), (3, 12) and (1, 24) under RM and EDF, with U, the RM bound and the response-time analysis worked out.', { mode: 'rt', rtRM: true, rtEDF: true, horizon: 0, onMiss: 'continue', tasks: [{ id: 'A', C: 1, T: 4, D: 4, phase: 0 }, { id: 'B', C: 2, T: 6, D: 6, phase: 0 }, { id: 'C', C: 3, T: 12, D: 12, phase: 0 }, { id: 'D', C: 1, T: 24, D: 24, phase: 0 }] }),
      { h: 'Recap' },
      { list: ['Under the RM bound: safe for RM, no further test needed.', 'Over the bound: undecided; run response-time analysis.', 'R = C + Σ ⌈R / T_j⌉ C_j, iterated to a fixed point; safe if R ≤ D.'] },
      X('mrt-x-bound'), X('mrt-x-bound-verdict'), X('mrt-x-rta'), X('mrt-x-rta-late'),
    ],
  });

  C.lesson({
    id: 'mrt-demand', chapter: 'mrt-rt', title: 'Deadlines before periods: processor demand', minutes: 6,
    summary: 'When a task\'s deadline is shorter than its period, U ≤ 1 no longer guarantees EDF success. The processor-demand test checks every absolute deadline L up to the hyperperiod: the work of all jobs both released and due within [0, L] must fit in L ticks.',
    blocks: [
      'A sensor reading is needed every 8 ticks, but its result is useful only if ready within 4. With deadlines tighter than periods, is U ≤ 1 still enough for EDF?',
      { math: 'demand(L) = Σ_i max(0, ⌊(L − D_i) / T_i⌋ + 1) · C_i     must be ≤ L at every deadline L' },
      { topic: 'rt-demand', frame: 1, caption: 'Tasks (1, 4, 2), (2, 6, 5), (2, 8, 8). At L = 5, one job of A and one of B are due: demand 1 + 2 = 3, within the 5 ticks available.' },
      { topic: 'rt-demand', frame: 17, caption: 'The demand stays within the time available at every deadline up to 32: EDF meets every deadline.' },
      { predict: { q: 'Tasks (2, 4, 2), (2, 6, 3), (1, 8, 4), with U = 0.958. At L = 3, the first job of A (due at 2) and of B (due at 3) are both due. Can EDF meet them?', options: ['Yes: U is below 1', 'No: they need 4 ticks by t = 3', 'Only if B is released first'], answer: 1, explain: 'Demand at L = 3 is 2 + 2 = 4 ticks of work, but only 3 ticks have passed. Some deadline by t = 3 must be missed.' } },
      { topic: 'rt-demand', input: { tasks: 'A 2 4 2\nB 2 6 3\nC 1 8 4' }, frame: 2, caption: 'The demand passes the line at L = 3: EDF cannot meet every deadline, although U = 0.958 is at most 1.' },
      { topic: 'rt-demand', input: { tasks: 'A 2 5 2\nB 2 5 3\nC 1 10 4' }, frame: 2, caption: 'Even U = 0.9 can fail: what matters is how much work falls due early, not the average.' },
      { h: 'Recap' },
      { list: ['With D < T, U ≤ 1 is not enough.', 'Check the demand at every absolute deadline up to the hyperperiod.', 'If the demand never exceeds the time available, EDF meets every deadline.'] },
      X('mrt-x-demand'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: priority inversion
  // =========================================================================================================
  C.lesson({
    id: 'mrt-inversion', chapter: 'mrt-inv', title: 'Priority inversion', minutes: 7,
    summary: 'When an urgent task needs a mutex held by an unimportant one, it must wait: that much is bounded by the critical section. But a middle-priority task that needs no mutex can preempt the holder, and then the urgent task waits for the middle task too, for as long as it runs: unbounded priority inversion.',
    blocks: [
      'Priorities promise that urgent work goes first. A mutex promises that only one task is inside. What happens when the two promises meet?',
      { def: 'priority inversion', text: 'a task waits while a task of lower priority runs. Waiting for the holder of a mutex to finish its critical section is unavoidable; waiting for unrelated middle-priority work is not.' },
      { topic: 'pi-inversion', frame: 1, caption: 'L (priority 3, the least urgent) arrives first and locks mtx at t = 1.' },
      { predict: { q: 'At t = 4, H (priority 1) needs mtx, which L holds, and M (priority 2, no mutex) arrives needing 6 ticks. Who runs?', options: ['L, to release mtx quickly', 'M: it is the most urgent task that is ready', 'H, by force'], answer: 1, explain: 'H is blocked on the mutex, so the most urgent ready task is M, at priority 2. L, holding the mutex H needs, does not run until M is done.' } },
      { topic: 'pi-inversion', frame: 3, caption: 't = 4: H tries to lock mtx, held by L, and blocks. M arrives and runs: it outranks L. H is now waiting for M as well.' },
      { topic: 'pi-inversion', frame: 8, caption: 'All done at t = 16. H spent 8 ticks blocked on the mutex, all of them while a less urgent task ran, and finished 12 ticks after it arrived.' },
      { topic: 'pi-inversion', input: { tasks: 'L 4 0: run 1, lock mtx, run 3, unlock mtx, run 1\nH 1 2: run 1, lock mtx, run 1, unlock mtx, run 1\nM1 2 3: run 4\nM2 3 4: run 4' }, frame: 9, caption: 'Two middle tasks: H waits 10 ticks. Every extra middle task adds its whole run to H\'s wait: the inversion has no bound.' },
      { topic: 'pi-inversion', input: { tasks: 'L 3 0: run 1, lock mtx, run 4, unlock mtx, run 1\nH 1 3: run 1, lock mtx, run 2, unlock mtx, run 1' }, frame: 7, caption: 'Without a middle task, H waits only 2 ticks, the rest of L\'s critical section: bounded, and unavoidable.' },
      { h: 'Recap' },
      { list: ['An urgent task blocked on a mutex waits for its holder: bounded by the critical section.', 'A middle task that preempts the holder makes the wait unbounded.', 'The fix must make the holder run before the middle tasks.'] },
      X('mrt-x-inversion'), X('mrt-x-pi-none'),
    ],
  });

  C.lesson({
    id: 'mrt-protocols', chapter: 'mrt-inv', title: 'Inheritance and the priority ceiling', minutes: 8,
    summary: 'Priority inheritance raises a mutex holder to the priority of the most urgent task blocked on it, so middle tasks cannot preempt it; it works through chains of mutexes. The priority ceiling protocol raises a task to the mutex\'s ceiling (the most urgent priority of any task that uses it) the moment it locks, which also bounds chains of blocking.',
    blocks: [
      'The holder of the mutex should finish its critical section before any middle task runs. Two ways to get there: lift the holder when an urgent task starts waiting, or lift it as soon as it takes the lock.',
      { def: 'priority inheritance', text: 'while tasks are blocked on a mutex, its holder runs at the most urgent of their priorities (and passes that on along a chain of mutexes); it drops back when it unlocks.' },
      { topic: 'pi-protocols', input: { proto: 'inherit', tasks: PI3 }, frame: 3, caption: 'Inheritance. At t = 4, H blocks on mtx, held by L, so L runs at priority 1. M, at priority 2, cannot preempt it.' },
      { predict: { q: 'Under inheritance, how long is H kept waiting while a less urgent task runs?', options: ['8 ticks, as before', '2 ticks: the rest of L\'s critical section', '0 ticks'], answer: 1, explain: 'L finishes its critical section at once, at H\'s priority, and hands over the mutex at t = 6: H waits 2 ticks.' } },
      { topic: 'pi-protocols', input: { proto: 'inherit', tasks: PI3 }, frame: 9, caption: 'H waited while a less urgent task ran for 8 ticks with no protocol, 2 with inheritance and 2 with the ceiling.' },
      { def: 'priority ceiling (immediate)', text: 'each mutex has a ceiling, the most urgent base priority of any task that ever locks it; a task that locks it runs at the ceiling at once, until it unlocks.' },
      { topic: 'pi-protocols', input: { proto: 'ceiling', tasks: PI3 }, frame: 1, caption: 'Ceiling. At t = 1, L locks mtx and rises at once to its ceiling, priority 1: when H arrives at t = 3, it cannot even preempt L.' },
      { topic: 'pi-protocols', input: { proto: 'ceiling', tasks: PI3 }, frame: 7, caption: 'H never blocks on the mutex at all (0 ticks); it waited 2 ticks for L, which ran at the ceiling.' },
      { topic: 'pi-protocols', input: { proto: 'inherit', tasks: CHAIN }, frame: 6, caption: 'A chain: H needs b (held by M), then a (held by L). Under inheritance H is blocked twice, first behind M, then behind L, which runs at priority 1 from t = 8.' },
      { topic: 'pi-protocols', input: { proto: 'inherit', tasks: CHAIN }, frame: 10, caption: 'With the chain, H waited 7 ticks with no protocol, 7 with inheritance and 2 with the ceiling: the ceiling stops a task from being blocked more than once.' },
      lab('Three protocols side by side', 'L, M and H with one mutex under no protocol, inheritance and the ceiling at once, with who holds the mutex and who waits at every tick.', { mode: 'pi', piNone: true, piInherit: true, piCeiling: true, pitasks: [{ id: 'L', prio: 3, arrive: 0, script: '1 +m 4 -m 1' }, { id: 'H', prio: 1, arrive: 3, script: '1 +m 2 -m 1' }, { id: 'M', prio: 2, arrive: 4, script: '6' }] }),
      { h: 'Recap' },
      { list: ['Inheritance: the holder borrows the priority of whoever waits for it.', 'Ceiling: the holder runs at the mutex\'s ceiling from the moment it locks.', 'Both bound the inversion; the ceiling also stops chains of blocking.'] },
      X('mrt-x-pi-table'), X('mrt-x-ceiling'), X('mrt-x-chain'), X('mrt-x-pi-chart'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
