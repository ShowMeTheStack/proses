// Part 12, mass storage: the challenges, the guided tour, the course, and the pages the diagram checker looks at. Both
// challenges are of the disk-sched kind, scored by the arm's movement (lower is better). Targets and medals were set
// by scoring every allowed policy and direction through the kind's own evaluate on the same hidden queues, and, for
// the queue given in full, by trying every order that keeps within the overtaking limit.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('ms-ch-tide')) return;

  // ---- 1. the tide-gauge archive: a policy for queues not seen ---------------------------------------------------
  C.challenge({ id: 'ms-ch-tide', n: 121, title: 'The tide-gauge archive', level: 2, kind: 'disk-sched',
    story: 'A harbour authority keeps forty years of tide-gauge readings on an old disk of 500 cylinders. Every night a batch job pulls a dozen scattered years for the flood models, and the arm\'s bearings are wearing out: the engineers count every cylinder it travels.\n\nLast winter someone set the arm to shortest seek first, and one researcher\'s request sat behind the others for a whole night. Shortest seek first is now banned: the arm must sweep.',
    task: 'Choose a disk-arm policy and the direction the arm sets off in. The score is the arm\'s mean movement over six hidden batches of 12 requests, every request waiting from the start; a circular return counts as movement.',
    metricName: 'mean arm movement', unit: 'cylinders', higher: false,
    hidden: { seed: 31, count: 6, n: 12, cylinders: 500 },
    preview: { start: 236, cylinders: 500, dir: 'up', requests: [179, 261, 14, 299, 246, 448, 487, 116, 190, 300, 325, 368] },
    limits: { policies: ['fcfs', 'scan', 'cscan', 'look', 'clook'] },
    target: 600, marks: { silver: 560, gold: 517 },
    hints: ['FCFS crosses the disk again and again: over 2000 cylinders a batch. A sweep crosses it about once.', 'LOOK turns at the last request instead of the edge, and the circular sweeps pay for their return. The direction matters too: in four of the six batches the arm starts below cylinder 130.', 'Setting off downwards, the arm serves the few requests below it and then sweeps up once. LOOK downwards scores 516.83, gold; SCAN downwards 563.83; LOOK upwards 700.17.'],
    solution: { policy: 'look', dir: 'down' },
    wrong: [{ policy: 'fcfs', dir: 'up' }, { policy: 'look', dir: 'up' }, { policy: 'clook', dir: 'down' }, { policy: 'cscan', dir: 'up' }] });

  // ---- 2. one batch by hand, with a fairness bound ----------------------------------------------------------------
  C.challenge({ id: 'ms-ch-ledger', n: 122, title: 'Fair to the early birds', level: 3, kind: 'disk-sched',
    story: 'A seed bank\'s catalogue server answers lookups from a dozen field stations. Its disk has 400 cylinders, and ten lookups are waiting, numbered in the order they came in. The stations have one rule, written into their service agreement: no lookup may be overtaken by more than three lookups that arrived after it.\n\nA sweep would serve them with little movement, but it overtakes some early lookups by seven later ones. First come, first served keeps the rule and sends the arm back and forth across the whole disk.',
    task: 'Give your own order of the ten requests (or a policy, if one keeps the rule). The score is the arm\'s movement from cylinder 120.',
    metricName: 'arm movement', unit: 'cylinders', higher: false,
    queue: { start: 120, cylinders: 400, dir: 'up', requests: [310, 45, 260, 130, 372, 88, 205, 19, 150, 340] },
    limits: { order: true, maxPassed: 3 },
    target: 900, marks: { silver: 800, gold: 755 },
    hints: ['FCFS moves 1950 cylinders. Every sweep policy overtakes some request by 6 or 7 later ones, so it breaks the rule.', 'Think in windows: a request may wait for at most three that came after it, so the arm can only reorder within short stretches of the queue. Within such a stretch, serve the requests in one sweep.', 'An order of 755 cylinders, the least any order allowed reaches: 45, 130, 310, 372, 340, 260, 205, 150, 88, 19 (requests 2, 4, 1, 5, 10, 3, 7, 9, 6, 8).'],
    solution: { order: [1, 3, 0, 4, 9, 2, 6, 8, 5, 7] },
    wrong: [{ policy: 'fcfs', dir: 'up' }, { order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }, { order: [3, 0, 2, 4, 1, 5, 6, 7, 8, 9] }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'ms-tour', title: 'Tour: mass storage', blurb: 'A block\'s place on the platter, the time of a request, the arm\'s policies, flash and its garbage, RAID parity and the Storage lab, in nine steps.',
    steps: [
      { route: 'part=storage', target: '#main', text: 'Part 12 of the catalogue: hard disks, the disk arm, solid-state drives, RAID, and the codes that catch damaged blocks.' },
      { route: 'topic=disk-geometry', target: '#stageWrap', text: 'A block number becomes a cylinder, a head and a sector. Consecutive blocks follow each other round a track.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=disk-access', target: '#stageWrap', text: 'One request at a time: the seek, the wait for the platter, and the transfer, each worked out in milliseconds.' },
      { route: 'topic=disk-arm', target: '#inputs', text: 'Choose the policy and the queue: first come first served, the nearest request, or a sweep. The movement and the waits follow.' },
      { route: 'topic=ssd-gc', target: '#stageWrap', text: 'Flash is erased a block at a time, so garbage collection copies valid pages before it erases: write amplification.' },
      { route: 'topic=raid-write', target: '#stageWrap', text: 'RAID parity worked bit by bit, and the four disk I/Os a small write costs.' },
      { route: 'labs/storage', target: '#labView', text: 'The Storage lab: a disk, an SSD, a RAID array or an I/O path, set up as you like and run step by step.' },
      { route: 'learn', target: '[data-chapter="ms-disk"]', text: 'The lessons and exercises of this part start here: queues to schedule, parity bytes to compute, and two arm-scheduling challenges.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'ms-course', title: 'Mass storage', blurb: 'All fifteen topics of part 12, from a block\'s place on the platter to a Hamming code, with lessons and exercises on the way.',
    steps: [
      { lesson: 'ms-geometry', note: 'Cylinders, heads and sectors.' },
      { topic: 'disk-geometry', note: 'A block number placed.' },
      { exercise: 'ms-x-chs', note: 'Place four blocks.' },
      { lesson: 'ms-time', note: 'Where a request\'s time goes.' },
      { topic: 'disk-seek', note: 'Seek, rotation and transfer.' },
      { topic: 'disk-access', note: 'Request by request.' },
      { exercise: 'ms-x-access', note: 'One random read.' },
      { lesson: 'ms-near', note: 'FCFS and SSTF.' },
      { topic: 'disk-arm', note: 'One policy on a queue.' },
      { exercise: 'ms-x-sstf', note: 'Shortest seek first by hand.' },
      { lesson: 'ms-sweep', note: 'The sweeps.' },
      { topic: 'disk-arm-compare', note: 'Six policies side by side.' },
      { exercise: 'ms-x-cscan', note: 'C-SCAN and its return.' },
      { lesson: 'ms-ftl', note: 'Flash and its mapping table.' },
      { topic: 'ssd-ftl', note: 'Writes, overwrites and TRIM.' },
      { exercise: 'ms-x-ftl', note: 'Follow the table.' },
      { topic: 'ssd-gc', note: 'Garbage collection.' },
      { exercise: 'ms-x-wa', note: 'Write amplification.' },
      { topic: 'ssd-wear', note: 'Wear levelling.' },
      { lesson: 'ms-levels', note: 'RAID levels.' },
      { topic: 'raid-layout', note: 'Where each chunk goes.' },
      { exercise: 'ms-x-chunk', note: 'Find a chunk.' },
      { topic: 'raid-write', note: 'Parity and the small write.' },
      { exercise: 'ms-x-p', note: 'A parity byte.' },
      { topic: 'raid-rebuild', note: 'A disk rebuilt.' },
      { topic: 'raid6-pq', note: 'P and Q.' },
      { exercise: 'ms-x-q', note: 'A Q byte.' },
      { topic: 'codes-checksum', note: 'Checksums.' },
      { topic: 'codes-crc', note: 'A CRC by division.' },
      { topic: 'codes-hamming', note: 'Mending a bit.' },
      { exercise: 'ms-x-hamming', note: 'Find the flipped bit.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p12 lesson ms-geometry')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'storage').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p12 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['ms-x-chs', 'ms-x-req-time', 'ms-x-sstf', 'ms-x-best', 'ms-x-ftl', 'ms-x-victim', 'ms-x-levels', 'ms-x-chunk', 'ms-x-q', 'ms-x-detect'])
      S.Checks.push({ group: 'learn', name: 'p12 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p12 course ms-course', hash: 'course=ms-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['ms-ch-tide', 'ms-ch-ledger']) S.Checks.push({ group: 'learn', name: 'p12 challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
