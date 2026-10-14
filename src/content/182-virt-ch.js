// Part 18, virtual machines and containers: the guided tour, the course, and the pages the diagram checker looks at.
// No challenge here: none of the challenge kinds (scheduler tuning, a synchronisation solution, a page-table design,
// a disk schedule, a shell) measures a virtualisation design, so this part is practised through its exercises and
// the VM lab.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.tours.has('vrt-tour')) return;

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'vrt-tour', title: 'Tour: virtual machines and containers', blurb: 'Trap-and-emulate and the instructions that break it, translation and hardware support, the two-dimensional walk, I/O paths, namespaces and control groups, in ten steps.',
    steps: [
      { route: 'part=virtualisation', target: '#main', text: 'Part 18 of the catalogue: one machine shared by whole operating systems, and by containers on one kernel.' },
      { route: 'topic=virt-popek-goldberg', target: '#stageWrap', text: 'Which instructions touch privileged state, and which of them trap in user mode. On old x86, four of the ones shown, among some seventeen on the real chip, do not: trap-and-emulate alone fails.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=virt-bt-hw', target: '#inputs', text: 'Choose binary translation or hardware support, and the guest code: watch each sensitive instruction rewritten into a call, or kept in guest mode.' },
      { route: 'topic=virt-walk-2d', target: '#stageWrap', text: 'The two-dimensional walk: each guest level needs a whole host walk first. Four levels on four make 24 reads for one TLB miss.' },
      { route: 'topic=virt-shadow-nested', target: '#stageWrap', text: 'Shadow page tables against nested paging, event by event: exits for every table edit and switch, against longer walks.' },
      { route: 'topic=virt-io-compare', target: '#stageWrap', text: 'Emulated, paravirtual and passed-through devices, counted in exits, interrupts and copies.' },
      { route: 'topic=virt-namespaces', target: '#inputs', text: 'Look at one kernel\'s processes from inside a container and from the host: the same processes, different numbers.' },
      { route: 'labs/vmm', target: '#labView', text: 'The VM lab: six workbenches, from the 2-D walk to control groups, each with your own setup.' },
      { route: 'learn', target: '[data-chapter="vrt-cpu"]', text: 'The lessons and exercises of this part start here.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'vrt-course', title: 'Virtual machines and containers', blurb: 'All eleven topics of part 18, from trap-and-emulate to control groups, with lessons and exercises on the way.',
    steps: [
      { lesson: 'vrt-vmm', note: 'The monitor and its virtual CPU.' },
      { topic: 'virt-trap-emulate', note: 'Trap-and-emulate, instruction by instruction.' },
      { exercise: 'vrt-x-te-cycles', note: 'What the traps cost.' },
      { topic: 'virt-popek-goldberg', note: 'Sensitive against privileged.' },
      { exercise: 'vrt-x-sensitive', note: 'The four that escape.' },
      { lesson: 'vrt-bt', note: 'Rewrite before running.' },
      { topic: 'virt-bt-hw', note: 'Translation and hardware support.' },
      { exercise: 'vrt-x-fate-table', note: 'Each instruction\'s fate.' },
      { topic: 'virt-cpu-cost', note: 'Cost lines over many runs.' },
      { exercise: 'vrt-x-break-even', note: 'When translation pays.' },
      { lesson: 'vrt-2d', note: 'Two page tables at once.' },
      { topic: 'virt-walk-2d', note: 'The grid of reads.' },
      { exercise: 'vrt-x-2d-table', note: 'Reads per TLB miss.' },
      { topic: 'virt-shadow-nested', note: 'Shadow against nested.' },
      { exercise: 'vrt-x-sync-table', note: 'One stream of events, two designs.' },
      { lesson: 'vrt-io-paths', note: 'Three ways to a device.' },
      { topic: 'virt-io-paths', note: 'One path, hop by hop.' },
      { exercise: 'vrt-x-io-emulated', note: 'Exits of an emulated disk.' },
      { topic: 'virt-io-compare', note: 'The three paths counted.' },
      { exercise: 'vrt-x-io-table', note: 'Fill in the counts.' },
      { topic: 'virt-vm-container', note: 'One read, three settings.' },
      { exercise: 'vrt-x-vm-or-cont', note: 'Which wall for whom.' },
      { lesson: 'vrt-ns', note: 'One kernel, many views.' },
      { topic: 'virt-namespaces', note: 'Processes seen from inside and out.' },
      { exercise: 'vrt-x-ns-kill', note: 'kill() in a namespace.' },
      { topic: 'virt-cgroups', note: 'Weights, quotas, memory limits.' },
      { exercise: 'vrt-x-cg-weights', note: 'Share the CPU by weight.' },
      { exercise: 'vrt-x-cg-oom', note: 'Who the limit stops.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p18 lesson vrt-vmm')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'virtualisation').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p18 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['vrt-x-sensitive', 'vrt-x-fate-table', 'vrt-x-break-even', 'vrt-x-2d-table', 'vrt-x-sync-table', 'vrt-x-io-table', 'vrt-x-crossings', 'vrt-x-ns-see', 'vrt-x-ns-kinds', 'vrt-x-cg-weights', 'vrt-x-cg-oom'])
      S.Checks.push({ group: 'learn', name: 'p18 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p18 course vrt-course', hash: 'course=vrt-course', ready: "document.querySelector('#courseView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
