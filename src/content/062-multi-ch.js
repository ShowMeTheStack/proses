// Part 6, multicore and real-time scheduling: the challenge, the guided tour, the course, and the pages the diagram
// checker looks at. Two sched-tune challenges: one tunes the local policy of a single pinned core, the other how three
// cores share their work (mode multi). Each target and its medals were set by scoring every policy and a grid of
// parameters through the kind's own evaluate on the same hidden workloads.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('mrt-ch-core')) return;

  C.challenge({ id: 'mrt-ch-core', n: 61, title: 'The pinned core', level: 2, kind: 'sched-tune',
    story: 'A warehouse robot\'s computer has four cores. Three of them share the heavy work, route planning and image processing, through per-core queues with pull balancing. The fourth is set apart: by hard affinity, only the jobs that talk to the motors and sensors may run there. They read a sensor, think briefly, send a command and wait for the hardware again, and now and then one of them writes a long log entry.\n\nThat core has a run queue of its own, and you choose its local policy. The engineers score it by mean response time plus a quarter of the mean turnaround, and a context switch on this small core costs a tick. They also refuse any policy that lets one job crawl while the others fly: on every hidden workload, Jain\'s fairness index of the slowdowns must be at least 0.6.',
    task: 'Choose the policy of the pinned core\'s run queue and its parameters. Quanta, and an MLFQ\'s top allotment, must be at least 2 ticks (the core\'s timer cannot fire faster).',
    metric: 'mix', weights: { response: 1, turnaround: 0.25 }, metricName: 'response + turnaround/4', unit: 'ticks', higher: false,
    cs: 1, hidden: { seed: 640, count: 6, n: 5, spread: 12, maxCpu: 7, maxIo: 6 },
    preview: [{ id: 'A', arrive: 0, bursts: [2, 4, 2, 4, 1] }, { id: 'B', arrive: 1, bursts: [7] }, { id: 'C', arrive: 2, bursts: [1, 5, 2] }, { id: 'D', arrive: 5, bursts: [3, 2, 3] }, { id: 'E', arrive: 8, bursts: [2] }],
    limits: { policies: ['fcfs', 'rr', 'prio', 'mlfq'], quantum: [2, 12], allot: [2, 24], levels: [2, 4], boost: [0, 60], minFair: 0.6 },
    target: 8.6, marks: { silver: 8.1, gold: 7.95 },
    hints: ['FCFS and priority scheduling let a long log write hold the core while short sensor jobs queue behind it: some job is slowed far more than the others, and the fairness limit rejects them.', 'Round robin is fair, but with every switch costing a tick even its best quantum, 2, only reaches about 9.86. A feedback queue keeps short bursts quick at the top and moves the long log writes down.', 'An MLFQ with 2 levels, a top quantum of 2, a top allotment of 2 and no boost scores about 7.9, gold. A top allotment of 4 lets the log writes linger at the top and scores about 9.04.'],
    solution: { policy: 'mlfq', levels: 2, q0: 2, allot: 2, boost: 0 },
    wrong: [{ policy: 'fcfs' }, { policy: 'rr', quantum: 2 }, { policy: 'prio', preemptive: false, age: 3 }, { policy: 'mlfq', levels: 3, q0: 2, allot: 4, boost: 0 }] });

  C.challenge({ id: 'mrt-ch-cores', n: 62, title: 'Three cores, cold caches', level: 2, kind: 'sched-tune', mode: 'multi', cores: 3, migrate: 2,
    story: 'A small media server has three cores. Jobs arrive in waves: thumbnails to cut, clips to transcode, a few uploads that read the disk between bursts of work. Each job builds up a working set in its core\'s cache, and a job that starts on a core other than the one it last ran on spends 2 ticks warming that core\'s cache before it gets on with its work.\n\nYou choose how the three cores share the work: one ready queue that every core takes from, or a queue per core with a balancer, and the quantum of each core\'s round robin. The operators score it by mean response time plus a quarter of the mean turnaround.',
    task: 'Choose the queue (one shared, or one per core), the quantum (1 to 10 ticks), how often a balancer pushes work between the per-core queues (0 for never, up to 20 ticks) and whether an idle core pulls work from a busy one.',
    metric: 'mix', weights: { response: 1, turnaround: 0.25 }, metricName: 'response + turnaround/4', unit: 'ticks', higher: false,
    cs: 0, hidden: { seed: 660, count: 6, n: 8, spread: 10, maxCpu: 8, maxIo: 4 },
    preview: [{ id: 'A', arrive: 0, bursts: [5] }, { id: 'B', arrive: 0, bursts: [2, 3, 2] }, { id: 'C', arrive: 1, bursts: [7] }, { id: 'D', arrive: 2, bursts: [1] }, { id: 'E', arrive: 3, bursts: [4] }, { id: 'F', arrive: 4, bursts: [3, 2, 3] }],
    limits: { quantum: [1, 10], push: [0, 20] },
    target: 2.85, marks: { silver: 2.7, gold: 2.665 },
    hints: ['One shared queue never leaves a core idle while work waits, but the next free core is rarely a job\'s last one: with 2 ticks lost at every move, its best quantum, 8, only scores about 3.25.', 'Per-core queues keep jobs on warm caches; the question is what happens when one core runs dry. Without pull or push, a quantum of 2 scores about 2.9: close, but not there. An idle core that pulls gets to about 2.68, silver, but every job it pulls arrives at a cold cache.', 'The best in the whole space: a queue per core, a quantum of 2, a balancer that pushes every tick, and no pull: about 2.66, gold. Pushing early keeps the queues even before a core runs dry; adding pull on top drops it to about 2.71. A quantum of 8 lets long transcodes hold a core and scores about 3.34.'],
    // the best of all 430 settings, found by trying every one: 2.656; the next is push 3 (2.661), then pull with no push (2.682)
    solution: { policy: 'multi', queue: 'per-core', quantum: 2, push: 1, pull: false },
    wrong: [{ policy: 'multi', queue: 'shared', quantum: 8, push: 0, pull: true }, { policy: 'multi', queue: 'per-core', quantum: 2, push: 0, pull: false }, { policy: 'multi', queue: 'per-core', quantum: 8, push: 0, pull: true }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'mrt-tour', title: 'Tour: multicore and real time', blurb: 'Queues per core, balancing and affinity, RM and EDF with their tests, and priority inversion with the protocols that bound it, in eight steps.',
    steps: [
      { route: 'part=multicore', target: '#main', text: 'Part 6 of the catalogue: scheduling several cores, scheduling to deadlines, and what a mutex does to priorities.' },
      { route: 'topic=mc-queues', target: '#stageWrap', text: 'One ready queue shared by every core, or one per core: the same jobs, with a lock to share or a balance to keep.' },
      { route: 'topic=mc-balance', target: '#inputs', text: 'Turn pull and push on and off here, and watch an idle core take work from a busy one, or not.' },
      { route: 'topic=rt-model', target: '#stageWrap', text: 'Periodic tasks: each releases a job every period, and each job is due by a deadline. Their utilisation and hyperperiod come first.' },
      { route: 'topic=rt-edf', target: '#stageWrap', text: 'Earliest deadline first meets a set that rate monotonic cannot: it ranks jobs by their deadlines, not tasks by their periods.' },
      { route: 'topic=rt-rta', target: '#stageWrap', text: 'Response-time analysis: the worst response of each task, iterated to a fixed point and compared with its deadline.' },
      { route: 'topic=pi-protocols', target: '#inputs', text: 'Priority inversion, then inheritance and the ceiling: choose the protocol here and compare how long the urgent task waits.' },
      { route: 'learn', target: '[data-chapter="mrt-cores"]', text: 'The lessons and exercises of this part start here: core charts to fill in, RM and EDF by hand, schedulability tests, and inversion step by step.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'mrt-course', title: 'Multicore and real-time scheduling', blurb: 'All eleven topics of part 6, from per-core queues to the priority ceiling, with lessons and exercises on the way.',
    steps: [
      { lesson: 'mrt-queues', note: 'One queue or one per core.' },
      { topic: 'mc-queues', note: 'Shared and per-core queues.' },
      { exercise: 'mrt-x-percore-chart', note: 'Two cores, a queue each.' },
      { topic: 'mc-balance', note: 'Push and pull.' },
      { exercise: 'mrt-x-idle', note: 'Idle while work waits.' },
      { topic: 'mc-affinity', note: 'Affinity and warm caches.' },
      { exercise: 'mrt-x-warm', note: 'Counting cold caches.' },
      { lesson: 'mrt-periodic', note: 'Periodic tasks and deadlines.' },
      { topic: 'rt-model', note: 'Utilisation and the hyperperiod.' },
      { topic: 'rt-rm', note: 'Rate monotonic.' },
      { exercise: 'mrt-x-rm-gantt', note: 'RM by hand.' },
      { topic: 'rt-edf', note: 'Earliest deadline first.' },
      { exercise: 'mrt-x-edf-gantt', note: 'EDF by hand.' },
      { topic: 'rt-bound', note: 'The utilisation bounds.' },
      { topic: 'rt-rta', note: 'Response-time analysis.' },
      { exercise: 'mrt-x-rta-late', note: 'A task that can be late.' },
      { topic: 'rt-demand', note: 'Deadlines before periods.' },
      { exercise: 'mrt-x-demand', note: 'Demand at each deadline.' },
      { lesson: 'mrt-inversion', note: 'An urgent task behind a mutex.' },
      { topic: 'pi-inversion', note: 'Unbounded inversion.' },
      { topic: 'pi-protocols', note: 'Inheritance and the ceiling.' },
      { exercise: 'mrt-x-chain', note: 'Inheritance through a chain.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson mrt-queues')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'multicore').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['mrt-x-place', 'mrt-x-shared-chart', 'mrt-x-percore-chart', 'mrt-x-idle', 'mrt-x-warm', 'mrt-x-util', 'mrt-x-rm-gantt', 'mrt-x-edf-gantt', 'mrt-x-rm-miss', 'mrt-x-rta', 'mrt-x-demand', 'mrt-x-pi-chart', 'mrt-x-pi-table', 'mrt-x-chain'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course mrt-course', hash: 'course=mrt-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['mrt-ch-core', 'mrt-ch-cores']) S.Checks.push({ group: 'learn', name: 'mrt challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
