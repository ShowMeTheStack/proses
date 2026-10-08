// Part 13, I/O systems: the challenge, the guided tour, the course, and the pages the diagram checker looks at. The
// challenge is of the disk-sched kind: the reader orders one visible queue of block requests by hand, as an I/O
// scheduler with a bound on overtaking would, and the score is the head's travel. The target and medals were set by
// trying every order that keeps within the bound.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('ios-ch-mail')) return;

  // ---- the mail spool's scheduler ------------------------------------------------------------------------------------
  C.challenge({ id: 'ios-ch-mail', n: 131, title: 'The mail spool\'s scheduler', level: 3, kind: 'disk-sched',
    story: 'A small company\'s mail server keeps every mailbox on one disk. In the morning rush eleven reads are queued at once, numbered in the order they arrived; the positions are given in units of a thousandth of the disk. The kernel\'s elevator would sweep through them with little travel, but a user whose mailbox read was queued early would watch newer reads overtake it again and again.\n\nThe administrator sets a deadline-like rule for the block layer: no read may be overtaken by more than two reads that were queued after it.',
    task: 'Give the order in which the eleven reads are dispatched (or a policy, if one keeps the rule). The score is how far the head travels from position 500.',
    metricName: 'head travel', unit: 'positions', higher: false,
    queue: { start: 500, cylinders: 1000, dir: 'up', requests: [880, 140, 610, 930, 220, 70, 760, 450, 990, 300, 520] },
    limits: { order: true, maxPassed: 2 },
    target: 3200, marks: { silver: 2800, gold: 2580 },
    hints: ['In arrival order the head travels 5220. Every sweep policy overtakes some read by 6 to 8 later ones: LOOK would travel only 1350 downwards, but it breaks the rule.', 'With at most two overtakers, the head can only reorder a few neighbours at a time. Group the far-apart reads so that each trip across the disk serves several of them; allowing only one overtaker, the best order travels 3620.', 'An order of 2580, the least the rule allows: 140, 610, 880, 930, 990, 760, 220, 70, 300, 450, 520 (requests 2, 3, 1, 4, 9, 7, 5, 6, 10, 8, 11).'],
    solution: { order: [1, 2, 0, 3, 8, 6, 4, 5, 9, 7, 10] },
    wrong: [{ policy: 'fcfs', dir: 'up' }, { policy: 'look', dir: 'down' }, { order: [1, 0, 3, 2, 4, 5, 7, 6, 8, 10, 9] }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'ios-tour', title: 'Tour: I/O systems', blurb: 'Device registers, polling, interrupts and DMA, buffering and the cache, the request queue, three kinds of read, and one read() through every layer, in nine steps.',
    steps: [
      { route: 'part=io', target: '#main', text: 'Part 13 of the catalogue: how data gets between a device and a program, and what the kernel does on the way.' },
      { route: 'topic=io-bus', target: '#stageWrap', text: 'The CPU talks to a device only through its controller\'s registers: STAT, CMD and TX. One byte is a whole handshake.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=io-xfer-compare', target: '#inputs', text: 'Polling, interrupts and DMA on one transfer. Change the device\'s speed and watch which method costs the CPU least.' },
      { route: 'topic=io-buffering', target: '#stageWrap', text: 'Buffers let the device read ahead while the program computes. Two buffers, and the slower side sets the pace.' },
      { route: 'topic=io-block-queue', target: '#stageWrap', text: 'The block layer merges neighbouring requests and an elevator orders them, with deadlines so no read waits too long.' },
      { route: 'topic=io-life-of-read', target: '#stageWrap', text: 'One read() from the program down to the disk and back: almost all of its time is the disk.' },
      { route: 'labs/storage', target: '#labView', text: 'The Storage lab\'s I/O workbench: transfers, the three kinds of read, and a read through the layers, all with your own numbers.' },
      { route: 'learn', target: '[data-chapter="ios-hw"]', text: 'The lessons and exercises of this part start here: register accesses, CPU time, buffers and caches to work out, and one scheduling challenge.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'ios-course', title: 'I/O systems', blurb: 'All fourteen topics of part 13, from a byte through the device registers to the life of a read, with lessons and exercises on the way.',
    steps: [
      { lesson: 'ios-bus', note: 'Controllers and their registers.' },
      { topic: 'io-bus', note: 'One byte to the printer.' },
      { topic: 'io-registers', note: 'The handshake, bit by bit.' },
      { exercise: 'ios-x-handshake', note: 'Count the register accesses.' },
      { lesson: 'ios-poll', note: 'The CPU waits.' },
      { topic: 'io-polling', note: 'Polling timed.' },
      { exercise: 'ios-x-poll-reads', note: 'Count the status reads.' },
      { lesson: 'ios-irq', note: 'The device calls.' },
      { topic: 'io-interrupt', note: 'Interrupts timed.' },
      { exercise: 'ios-x-irq-busy', note: 'The CPU\'s share.' },
      { lesson: 'ios-dma', note: 'The data goes by itself.' },
      { topic: 'io-dma', note: 'DMA timed.' },
      { topic: 'io-xfer-compare', note: 'The three compared.' },
      { exercise: 'ios-x-xfer-table', note: 'Three transfers side by side.' },
      { lesson: 'ios-buffer', note: 'Overlapping device and program.' },
      { topic: 'io-buffering', note: 'No, one, two buffers.' },
      { exercise: 'ios-x-buf-double', note: 'Two buffers timed.' },
      { topic: 'io-cache', note: 'The buffer cache.' },
      { exercise: 'ios-x-cache-writes', note: 'Write-back against write-through.' },
      { topic: 'io-spool', note: 'Spooling.' },
      { exercise: 'ios-x-spool', note: 'Held up by the printer.' },
      { topic: 'io-block-queue', note: 'Merging and the elevator.' },
      { exercise: 'ios-x-queue-table', note: 'Merge, then sweep.' },
      { lesson: 'ios-modes', note: 'Three kinds of read.' },
      { topic: 'io-modes', note: 'One kind at a time.' },
      { topic: 'io-modes-compare', note: 'Side by side.' },
      { exercise: 'ios-x-modes-table', note: 'Time them.' },
      { lesson: 'ios-read', note: 'The life of a read.' },
      { topic: 'io-life-of-read', note: 'Through the layers.' },
      { topic: 'io-driver', note: 'The driver\'s two halves.' },
      { exercise: 'ios-x-read-blocks', note: 'Which blocks reach the disk.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p13 lesson ios-bus')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'io').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p13 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['ios-x-handshake', 'ios-x-xfer-table', 'ios-x-crossover', 'ios-x-cache-writes', 'ios-x-elevator', 'ios-x-queue-table', 'ios-x-modes-table', 'ios-x-read-blocks'])
      S.Checks.push({ group: 'learn', name: 'p13 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p13 course ios-course', hash: 'course=ios-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p13 challenge ios-ch-mail', hash: 'challenge/ios-ch-mail', ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
