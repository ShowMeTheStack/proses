// Part 6, multicore and real-time scheduling: the chapters, and the lessons of the first (several cores) and of the
// start of the second (periodic tasks, RM and EDF). The other lessons are in 060-multi2.js, the exercises in
// 061-multi-ex.js and 061-multi-ex2.js, and the challenge, tour, course and the pages the diagram checker looks at in
// 062-multi-ch.js. Every value quoted was read from the topics' own runs (S.Sched.multi, rt, rtAnalysis and
// inversion) on the inputs named in each block.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'mrt-cores')) return;

  C.chapter({ id: 'mrt-cores', part: 'multicore', n: 1, title: 'Several cores', blurb: 'One shared ready queue or one per core, moving work between cores by push and pull, and why a job should stay where its cache is warm.' });
  C.chapter({ id: 'mrt-rt', part: 'multicore', n: 2, title: 'Deadlines', blurb: 'Periodic tasks with deadlines, rate-monotonic and earliest-deadline-first scheduling, and the tests that tell in advance whether every deadline will be met.' });
  C.chapter({ id: 'mrt-inv', part: 'multicore', n: 3, title: 'Priority inversion', blurb: 'An urgent task stuck behind a mutex held by an unimportant one, the middle task that makes it worse, and the inheritance and ceiling protocols that bound the wait.' });

  const X = (id) => ({ exercise: id });
  const R = (id, arrive, bursts, more) => Object.assign({ id, arrive, bursts, prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' }, more || {});
  const lab = (title, text, setup) => ({ lab: 'scheduler', title, text, setup });

  // =========================================================================================================
  // Chapter 1: several cores
  // =========================================================================================================
  C.lesson({
    id: 'mrt-queues', chapter: 'mrt-cores', title: 'One queue, or one per core?', minutes: 7,
    summary: 'With several cores, the scheduler can keep one shared ready queue that every core takes from, or a queue per core. A shared queue balances itself but every core must lock it, and jobs wander from core to core. Per-core queues need no shared lock and keep jobs on one core, but can fall out of balance.',
    blocks: [
      'A bakery with two counters can keep one queue that feeds both, or a queue in front of each counter. One queue is fair and nobody waits while a counter is free; two queues are quicker to manage, until one counter has a crowd and the other nobody. Cores face the same choice.',
      { def: 'shared queue, per-core queues', text: 'shared: one ready queue; a core that is free takes the first job in it. Per-core: each core has a queue of its own; a new job is placed on the least loaded core, and a job back from I/O returns to the core it last ran on.' },
      { topic: 'mc-queues', input: { mode: 'per-core' }, frame: 0, caption: 'Two cores, a queue each, round robin with quantum 2. A joins core 0\'s queue and B core 1\'s; each core runs the head of its own queue.' },
      { predict: { q: 'At t = 5, B leaves core 1 for I/O, and core 1\'s queue is empty, while core 0\'s has jobs waiting. What should core 1 do?', options: ['Idle until B is back: its queue is empty', 'Take a job from core 0\'s queue', 'Run B anyway'], answer: 1, explain: 'An idle core pulls work from the busiest queue. Here core 1 pulls C from core 0.' } },
      { topic: 'mc-queues', input: { mode: 'per-core' }, frame: 5, caption: 't = 5: core 1\'s queue is empty, so it pulls C from core 0, whose queue was longest.' },
      { topic: 'mc-queues', input: { mode: 'per-core' }, frame: 15, caption: 'Per-core queues: all done at t = 15, with jobs moving between cores only once. Average turnaround 12.2.' },
      { topic: 'mc-queues', input: { mode: 'shared' }, frame: 15, caption: 'One shared queue: the same finish and the same average turnaround, but jobs moved between cores 6 times. Each move leaves a warm cache behind.' },
      { table: [['', 'Shared queue', 'Per-core queues'], ['Balance', 'automatic: a free core takes the next job', 'needs push or pull'], ['Locking', 'every core locks the one queue', 'each core locks its own'], ['Cache', 'jobs wander between cores', 'jobs stay on one core'], ['Scales to many cores', 'poorly', 'well']], caption: 'The trade-off.' },
      { h: 'Recap' },
      { list: ['A shared queue is balanced by construction, but contended and cache-unfriendly.', 'Per-core queues scale and keep caches warm, but must be balanced.', 'A job back from I/O returns to the core it last ran on.'] },
      X('mrt-x-shared'), X('mrt-x-place'), X('mrt-x-shared-chart'), X('mrt-x-percore-chart'),
    ],
  });

  C.lesson({
    id: 'mrt-balance', chapter: 'mrt-cores', title: 'Load balancing: push and pull', minutes: 7,
    summary: 'Per-core queues fall out of balance when short jobs finish on one core and long ones remain on another. A pull (work stealing) lets an idle core take a job from the busiest queue; a push lets a periodic balancer move jobs from the most loaded core to the least. Without either, a core can idle while work waits elsewhere.',
    blocks: [
      'Six jobs are dealt out in turn to two cores: three short ones end up on core 0, three long ones on core 1. Core 0 is soon done. What happens to the long jobs still queued on core 1?',
      { topic: 'mc-balance', input: { pull: 'no', push: 0 }, frame: 3, caption: 'No balancing. By t = 6, core 0 has run A, C and E, 2 ticks each, and has nothing left; core 1 still has B, D and F queued.' },
      { topic: 'mc-balance', input: { pull: 'no', push: 0 }, frame: 15, caption: 'All done at t = 30. A core sat idle while a job waited in the other core\'s queue for 22 core-ticks: core 0 was busy 20% of the time.' },
      { predict: { q: 'Now an idle core may pull the job at the back of the busiest queue. When are all six jobs done?', options: ['Still at t = 30', 'At t = 18', 'At t = 12'], answer: 1, explain: 'Core 0 starts pulling at t = 6 and both cores stay busy to the end: the 36 ticks of work are done at t = 18.' } },
      { topic: 'mc-balance', input: { pull: 'yes', push: 0 }, frame: 3, caption: 'Pull. At t = 6, core 0 has nothing of its own, so it takes F from the back of core 1\'s queue.' },
      { topic: 'mc-balance', input: { pull: 'yes', push: 0 }, frame: 9, caption: 'All done at t = 18 after 2 moves; no core idled while work waited.' },
      { topic: 'mc-balance', input: { pull: 'no', push: 4 }, frame: 10, caption: 'Push instead, every 4 ticks: a balancer moves jobs while the loads differ by 2 or more. All done at t = 20; between checks, core 0 still idled for 2 core-ticks.' },
      lab('Two cores, shared against per-core', 'The same five jobs on a shared queue and on per-core queues with pull, a warm-up of 1 tick for a job that changes core, and one job pinned to core 1.', { mode: 'compare', pol1: 'multi', pol2: 'multip', pol3: 'none', pol4: 'none', q1: 2, q2: 2, cores: 2, push: 0, pull: true, migrate: 1, work: [R('A', 0, [6, 2, 4]), R('B', 0, [9]), R('C', 1, [3, 3, 3], { cores: '1' }), R('D', 2, [8]), R('E', 4, [2, 2, 2])] }),
      { h: 'Recap' },
      { list: ['Per-core queues drift out of balance as jobs finish.', 'Pull: an idle core steals from the busiest queue, the moment it is idle.', 'Push: a periodic balancer evens out the loads, with a delay.'] },
      X('mrt-x-idle'), X('mrt-x-pull'), X('mrt-x-push'),
    ],
  });

  C.lesson({
    id: 'mrt-affinity', chapter: 'mrt-cores', title: 'Affinity and warm caches', minutes: 6,
    summary: 'A job that has run on a core leaves its data in that core\'s caches. If it next runs on another core, it must fetch that data again: a cost of migration. Schedulers therefore prefer to keep a job on the same core (soft affinity), and a program can pin itself to certain cores (hard affinity).',
    blocks: [
      'Moving a job to an idle core sounds free. It is not: its working data is in the old core\'s cache, and the new core starts cold. How much does wandering cost?',
      { def: 'affinity', text: 'a job\'s tie to a core. Soft affinity: the scheduler tries to keep a job where it last ran. Hard affinity: the job may run only on the cores it names.' },
      { topic: 'mc-affinity', input: { mode: 'per-core', migrate: 2 }, frame: 10, caption: 'Per-core queues, a migration costing 2 ticks of cache warming: jobs never change core, so nothing is lost. All done at t = 12, average turnaround 10.5.' },
      { predict: { q: 'The same jobs with one shared queue, the same warming cost. Will they finish sooner or later than t = 12?', options: ['Sooner: a shared queue keeps both cores busy', 'Later: jobs start on other cores and pay to warm the caches', 'The same'], answer: 1, explain: 'With a shared queue jobs keep switching cores: they start on a new core 4 times and spend 8 ticks warming caches, ending at t = 17.' } },
      { topic: 'mc-affinity', input: { mode: 'shared', migrate: 2 }, frame: 5, caption: 'Shared queue. At t = 7, core 1 takes A, which last ran on core 0, so A first spends 2 ticks warming core 1\'s cache.' },
      { topic: 'mc-affinity', input: { mode: 'shared', migrate: 2 }, frame: 12, caption: 'All done at t = 17: 4 migrations, 8 ticks spent warming caches, average turnaround 13.5 against 10.5.' },
      { topic: 'mc-affinity', input: { mode: 'shared', migrate: 2, work: 'A 0 6 aff=0\nB 0 6 aff=0\nC 0 6\nD 1 3 (2) 3' }, frame: 10, caption: 'Hard affinity: A and B pinned to core 0. Now no job ever starts on a new core: done at t = 12 again.' },
      { tip: 'With free migration (no warming cost) the shared queue would finish at t = 13. Cache warmth, not the queue itself, made the difference here.' },
      { h: 'Recap' },
      { list: ['A job that moves to another core finds that core\'s cache cold.', 'Soft affinity: keep jobs where they ran. Hard affinity: pin them.', 'Per-core queues give affinity for free; balancing must trade it against idle cores.'] },
      X('mrt-x-affinity'), X('mrt-x-warm'), { challenge: 'mrt-ch-core' }, { challenge: 'mrt-ch-cores' },
    ],
  });

  // =========================================================================================================
  // Chapter 2: deadlines
  // =========================================================================================================
  C.lesson({
    id: 'mrt-periodic', chapter: 'mrt-rt', title: 'Periodic tasks and deadlines', minutes: 6,
    summary: 'A real-time task releases a job every period T; each job needs up to C ticks of CPU (its worst-case execution time) and must finish by its deadline, D ticks after its release (often D = T). The task\'s utilisation is C / T; the whole set needs U = Σ C / T of the CPU, and its schedule repeats every hyperperiod, the least common multiple of the periods.',
    blocks: [
      'A drone reads its gyroscope every 4 ms, adjusts its motors every 6 ms and sends telemetry every 12 ms. Being fast on average is no use: a motor update that comes late is a fault, however quick the others were. Real-time scheduling is about deadlines, not averages.',
      { def: 'periodic task', text: 'a task (C, T, D) releases a job at 0, T, 2T, ...; each job needs C ticks of CPU and must be done within D ticks of its release. Its utilisation is C / T.' },
      { topic: 'rt-model', frame: 0, caption: 'Task A releases a job every 4 ticks (the arrows), each needing 1 tick within 4 (the marks under the row): utilisation 1/4 = 0.25.' },
      { predict: { q: 'Tasks (1, 4), (2, 6) and (3, 12). What share of the CPU do they need together?', options: ['0.5', 'about 0.833', '1.5'], answer: 1, explain: '1/4 + 2/6 + 3/12 = 0.25 + 0.333 + 0.25 ≈ 0.833.' } },
      { topic: 'rt-model', frame: 3, caption: 'U = 1/4 + 2/6 + 3/12 = 0.833. The pattern of releases repeats every 12 ticks, the least common multiple of 4, 6 and 12: the hyperperiod.' },
      { topic: 'rt-model', frame: 4, caption: 'One schedule over the hyperperiod: every deadline is met, and the CPU is busy 83.33% of the time.' },
      { warn: 'U > 1 means more work than time: some deadline must be missed under any policy. U ≤ 1 is necessary but, as the next lessons show, not always enough.' },
      { h: 'Recap' },
      { list: ['A task (C, T, D): C ticks of work every T, each due D after its release.', 'U = Σ C / T; above 1, misses are certain.', 'The schedule repeats every hyperperiod, the lcm of the periods: check that much and you have checked it all.'] },
      X('mrt-x-util'), X('mrt-x-hyper'),
    ],
  });

  C.lesson({
    id: 'mrt-rm', chapter: 'mrt-rt', title: 'Rate-monotonic scheduling', minutes: 7,
    summary: 'Rate-monotonic (RM) scheduling gives each task a fixed priority by its period: the shorter the period, the higher the priority, and a released job of a higher-priority task preempts at once. It is the best fixed-priority policy when deadlines equal periods, yet some sets with U below 1 still miss under it.',
    blocks: [
      'With fixed priorities, which task should be most urgent: the one that does the most work, the most important one, or the one that comes round most often?',
      { def: 'rate monotonic', text: 'each task\'s priority is fixed by its period: shorter period, higher priority. Preemptive: a released job of a higher-priority task takes the CPU at once.' },
      { topic: 'rt-rm', frame: 3, caption: 'Tasks (1, 4), (2, 6), (3, 12). At t = 4, A2 is released and preempts C1: A\'s period 4 is shorter than C\'s 12.' },
      { topic: 'rt-rm', frame: 10, caption: 'Every deadline met over the hyperperiod of 12, with U = 0.833.' },
      { predict: { q: 'Two tasks: A (2, 5) and B (4, 7), U = 0.971. Does RM meet every deadline?', options: ['Yes: U is below 1', 'No: B1 misses', 'No: A1 misses'], answer: 1, explain: 'A runs 0–2 and preempts B again at t = 5; B1 has had only 3 of its 4 ticks when its deadline passes at t = 7.' } },
      { topic: 'rt-rm', input: { tasks: 'A 2 5\nB 4 7' }, frame: 3, caption: 't = 7: B1 misses its deadline with 1 tick left; A2 took the CPU at t = 5 because its period is shorter.' },
      { topic: 'rt-rm', input: { tasks: 'A 2 5\nB 4 7' }, frame: 19, caption: 'Over the hyperperiod of 35: 1 deadline missed (B1), although U = 0.971 is below 1.' },
      { topic: 'rt-rm', input: { tasks: 'A 2 4\nB 2 8\nC 4 16' }, frame: 8, caption: 'Periods that divide one another (harmonic): even at U = 1, RM meets every deadline.' },
      lab('RM against EDF', 'The two-task set side by side under RM and EDF, with the schedulability tests worked out under the charts.', { mode: 'rt', rtRM: true, rtEDF: true, horizon: 0, onMiss: 'continue', tasks: [{ id: 'A', C: 2, T: 5, D: 5, phase: 0 }, { id: 'B', C: 4, T: 7, D: 7, phase: 0 }] }),
      { h: 'Recap' },
      { list: ['RM: fixed priorities by period, shortest first, preemptive.', 'Simple and predictable; optimal among fixed-priority policies when D = T.', 'A set with U < 1 can still miss under RM.'] },
      X('mrt-x-rm-gantt'), X('mrt-x-rm-miss'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
