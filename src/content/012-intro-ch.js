// Part 1, what an operating system does: the challenge, the guided tour, the course, and the pages the diagram
// checker looks at. The challenge is of the sched-tune kind, limited to running without a timer (FCFS: a program
// keeps the CPU until it blocks or ends) or with one (round robin, the slice being the timer period). Its target and
// medals were set by scoring FCFS and every period from 1 to 12 through the kind's own evaluate on the same hidden
// workloads: FCFS 26.66, periods 1 to 5: 24.46, 21.53, 21.28, 21.94, 22.92, and 25.41 for a period of 8.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('os-ch-timer')) return;

  C.challenge({ id: 'os-ch-timer', n: 11, title: 'Set the timer', level: 2, kind: 'sched-tune',
    story: 'A school keeps one old server for its programming class. Students type into editors that need the CPU for a moment after each key and then wait; others run compile jobs and test suites that compute for a long stretch. The kernel is new and you are writing its boot code: you decide whether to program the timer at all, and if so, how often it interrupts.\n\nWithout a timer, a program keeps the CPU until it blocks or ends, so a key press can sit behind a long compile. With a timer, the kernel takes the CPU back at the end of every period, but each context switch costs a tick of kernel time. The class scores a setting by the mean response time plus a quarter of the mean turnaround time.',
    task: 'Choose no timer (FCFS) or a timer (round robin) and its period in ticks. The score is mean response + mean turnaround / 4 over six hidden workloads of six jobs each, with I/O, every context switch costing 1 tick.',
    metric: 'mix', weights: { response: 1, turnaround: 0.25 }, metricName: 'response + turnaround/4', unit: 'ticks', higher: false,
    cs: 1, hidden: { seed: 11, count: 6, n: 6, spread: 10, maxCpu: 16, maxIo: 4 },
    preview: [{ id: 'A', arrive: 0, bursts: [12] }, { id: 'B', arrive: 1, bursts: [2, 3, 2] }, { id: 'C', arrive: 3, bursts: [1, 4, 1] }, { id: 'D', arrive: 4, bursts: [9] }, { id: 'E', arrive: 6, bursts: [2, 2, 2] }],
    limits: { policies: ['fcfs', 'rr'], quantum: [1, 12] },
    target: 22, marks: { silver: 21.6, gold: 21.35 },
    hints: ['With no timer a short job that arrives behind a long burst waits for all of it, so the response time suffers. A timer fixes that, but a period of 1 tick spends half the machine switching.', 'Try a few periods between 2 and 5 and watch the score: too short and the switching costs pile up, too long and the long jobs hold the CPU as if there were no timer.', 'A timer every 3 ticks scores about 21.28, gold; every 2 ticks about 21.53 and every 4 about 21.94. No timer scores about 26.66, a period of 1 about 24.46 and a period of 8 about 25.41.'],
    solution: { policy: 'rr', quantum: 3 },
    wrong: [{ policy: 'fcfs' }, { policy: 'rr', quantum: 1 }, { policy: 'rr', quantum: 8 }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'os-tour', title: 'Tour: what an operating system does', blurb: 'One CPU shared out, the mode bit, the trap path, a system call, the timer and the boot, in eight steps.',
    steps: [
      { route: 'part=intro', target: '#main', text: 'Part 1 of the catalogue: what the operating system gives every program, and the hardware that lets it stay in charge.' },
      { route: 'topic=p01-cpu-share', target: '#stageWrap', text: 'Three programs share one CPU in slices. Below the real timeline, each program\'s own view: its work without a gap, though the wall clock says otherwise.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=p01-modes', target: '#inputs', text: 'Type a program for the toy CPU and choose the mode it starts in: a privileged instruction in user mode traps, the same one in kernel mode runs.' },
      { route: 'topic=p01-trap', target: '#stageWrap', text: 'The one path every interrupt, exception and system call takes: the mode bit, the kernel stack, the trap frame, the trap table, and return-from-trap.' },
      { route: 'topic=p01-syscall', target: '#stageWrap', text: 'A system call from the C library\'s wrapper to the kernel\'s table and back, with the result in rax, or −1 and errno.' },
      { route: 'topic=p01-lde', target: '#stageWrap', text: 'Programs run straight on the CPU; the timer is how the kernel takes it back. Turn the timer off and watch a loop keep the CPU for ever.' },
      { route: 'learn', target: '[data-chapter="os-what"]', text: 'The lessons and exercises of this part start here: schedules by hand, traps to classify, write calls to count, and C to write and check.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'os-course', title: 'What an operating system does', blurb: 'All thirteen topics of part 1, from one CPU shared out to the shapes a kernel can take, with lessons and exercises on the way.',
    steps: [
      { lesson: 'os-share', note: 'The illusion of a CPU of one\'s own.' },
      { topic: 'p01-cpu-share', note: 'Slices in turn, and each program\'s own view.' },
      { exercise: 'os-x-share-chart', note: 'Draw the time-sharing.' },
      { topic: 'p01-memory-private', note: 'One address, two values.' },
      { exercise: 'os-x-seats', note: 'Two processes, one variable name.' },
      { topic: 'p01-persist', note: 'Files outlive their writers.' },
      { exercise: 'os-x-no-wait', note: 'Reading before the writer is done.' },
      { topic: 'p01-referee', note: 'A fault stays with its owner.' },
      { exercise: 'os-x-code-report', note: 'Report how the child ended.' },
      { lesson: 'os-modes', note: 'The mode bit.' },
      { topic: 'p01-modes', note: 'Privileged instructions in both modes.' },
      { exercise: 'os-x-started', note: 'How far does it get?' },
      { topic: 'p01-trap', note: 'One path in and back.' },
      { exercise: 'os-x-trap-frame', note: 'The stack pointer through a trap.' },
      { topic: 'p01-trapkinds', note: 'Interrupts, exceptions, system calls.' },
      { exercise: 'os-x-classify', note: 'Name the trap.' },
      { topic: 'p01-syscall', note: 'From the wrapper to the table and back.' },
      { exercise: 'os-x-errno', note: 'Return values and errno.' },
      { topic: 'p01-sysc', note: 'Which lines call the kernel.' },
      { exercise: 'os-x-code-one-write', note: 'Five lines, one system call.' },
      { lesson: 'os-lde', note: 'Direct execution, limited.' },
      { topic: 'p01-lde', note: 'The timer takes the CPU back.' },
      { exercise: 'os-x-switches', note: 'Count the context switches.' },
      { topic: 'p01-boot', note: 'From firmware to init.' },
      { exercise: 'os-x-boot-pid', note: 'Which pid?' },
      { topic: 'p01-structure', note: 'One request through a kernel design.' },
      { topic: 'p01-structures', note: 'Five designs side by side.' },
      { exercise: 'os-x-structure-cost', note: 'The price of one read.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson os-share')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'intro').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['os-x-share-chart', 'os-x-slices', 'os-x-seats', 'os-x-code-report', 'os-x-roles', 'os-x-privileged', 'os-x-trap-frame', 'os-x-trap-count', 'os-x-errno', 'os-x-count-writes', 'os-x-code-one-write', 'os-x-structure-cost'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course os-course', hash: 'course=os-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'os challenge os-ch-timer', hash: 'challenge/os-ch-timer', ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
