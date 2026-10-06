// Part 11, virtual memory: the challenges, the guided tour, the course, and the pages the diagram checker looks at.
// Both challenges are c-tests challenges, plain single-threaded C run once a test: each hidden test appends a main that
// calls the reader's function on a reference string, and the output it must print is worked out here by the engines
// (S.Mem.replace for the clock, S.VM.workingSet for the working set).
(function (S) {
  'use strict';
  const C = S.Content, M = S.Mem, V = S.VM;
  if (!C || !M || !V || C.challenges.has('vm-ch-clock')) return;
  const HDR = '#include <stdio.h>\n';
  const mainOf = (fn, cases) => HDR + 'int main(void) {\n' + cases.map(([r], k) => '    int r' + k + '[] = {' + r.join(', ') + '};\n').join('') + cases.map(([r, a], k) => '    printf("%d\\n", ' + fn + '(r' + k + ', ' + r.length + ', ' + a + '));\n').join('') + '    return 0;\n}\n';

  // ---- 1. the clock, exactly ------------------------------------------------------------------------------------
  const CLOCK = '#define MAXF 8\n\n/* the faults the clock algorithm makes on refs[0..n-1] with nframes frames, all empty at first */\nint clock_faults(int *refs, int n, int nframes) {\n    int page[MAXF], use[MAXF];\n    int used = 0, hand = 0, faults = 0;\n    for (int i = 0; i < n; i++) {\n        int hit = -1;\n        for (int k = 0; k < used; k++)\n            if (page[k] == refs[i])\n                hit = k;\n        if (hit >= 0) {\n            use[hit] = 1;\n            continue;\n        }\n        faults++;\n        if (used < nframes) {\n            page[used] = refs[i];\n            use[used] = 1;\n            used++;\n            hand = used % nframes;\n            continue;\n        }\n        while (use[hand]) {\n            use[hand] = 0;\n            hand = (hand + 1) % nframes;\n        }\n        page[hand] = refs[i];\n        use[hand] = 1;\n        hand = (hand + 1) % nframes;\n    }\n    return faults;\n}\n';
  const CK = [
    [[[2, 5, 2, 8, 2, 6, 5, 2, 9, 8, 2, 5, 6, 2], 3], [[5, 2, 5, 7, 1, 2, 6, 5, 7, 1, 2], 3], [[5, 1, 2, 5, 5, 2, 4, 1, 3, 1, 4, 2, 4, 3, 3], 3]],
    [[[6, 1, 3, 1, 4, 2, 1, 5, 7, 7, 4, 3, 3], 4], [[3, 3, 4, 6, 3, 3, 1, 6, 2, 4, 3, 2, 6, 1], 4], [[1, 6, 3, 6, 6, 4, 2, 6, 2, 5, 3, 3, 1, 4], 4]],
    [[[6, 6, 1, 6, 1, 6], 1], [[4, 4, 4, 4], 2], [[5, 2, 3, 3, 1, 2, 4, 1, 2, 3, 5, 4, 4, 4, 2, 5], 3]],
    [[[9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9, 1], 3], [[4, 4, 3, 2, 4, 5, 4, 5, 2, 2, 1, 5, 2, 4, 5, 1], 3]],
  ];
  const ckOut = (cases) => cases.map(([r, n]) => M.replace('clock', r, n).faults + '\n').join('');
  C.challenge({ id: 'vm-ch-clock', n: 111, title: 'The clock, exactly', level: 2, kind: 'c-tests',
    story: 'A firm that sells storage appliances wants to predict, before shipping, how many page faults a customer\'s workload will make on its kernel, which replaces pages with the clock algorithm. Its engineers record reference strings in the field and want a small C function that replays them and counts the faults, exactly as the kernel would.\n\nThe kernel\'s clock: each frame has a use bit, set when a page is loaded and on every hit. Empty frames fill in order, frame 0 first, and the hand moves past each frame filled (so after the frames fill it is back at frame 0). On a fault with every frame full, the hand looks at its frame: a set bit is cleared and the hand moves on; a clear bit marks the victim. The new page goes in the victim\'s frame with its bit set, and the hand moves one past it.',
    task: 'Write `int clock_faults(int *refs, int n, int nframes)`, at most 8 frames, returning the number of faults.',
    metricName: 'tests passed', target: 4, marks: { gold: 4 },
    limits: { forbid: ['malloc'], maxLines: 50, noMain: true },
    starter: '#define MAXF 8\n\n/* the faults the clock algorithm makes on refs[0..n-1] with nframes frames, all empty at first */\nint clock_faults(int *refs, int n, int nframes) {\n    int faults = 0;\n\n    return faults;\n}\n',
    tests: CK.map((cases, k) => ({ name: ['strings from the course', 'four frames', 'small and odd cases', 'a hot page'][k], visible: k === 0, expect: ckOut(cases), maxSteps: 60000, main: mainOf('clock_faults', cases) })),
    hints: ['Keep, for each frame, its page and its use bit; keep the hand and how many frames are in use.', 'A hit only sets the bit. A fault with a free frame fills it and moves the hand past it. A fault with all full: while the bit under the hand is set, clear it and advance; then replace there and advance once more.', 'Clock: ' + CK[0].map(([r, n]) => M.replace('clock', r, n).faults).join(' and ') + ' faults on the three strings of the first test. The heart of it: while (use[hand]) { use[hand] = 0; hand = (hand + 1) % nframes; } page[hand] = refs[i]; use[hand] = 1; hand = (hand + 1) % nframes;'],
    solution: { src: CLOCK },
    wrong: [{ src: CLOCK.replace('            use[hit] = 1;\n', '') }, { src: CLOCK.replace('        while (use[hand]) {\n            use[hand] = 0;\n            hand = (hand + 1) % nframes;\n        }\n', '') }] });

  // ---- 2. the peak of the working set ----------------------------------------------------------------------------
  const WSP = '/* the largest number of distinct pages among the last delta references, over every point of refs[0..n-1] */\nint ws_peak(int *refs, int n, int delta) {\n    int peak = 0;\n    for (int t = 0; t < n; t++) {\n        int from = t - delta + 1;\n        if (from < 0)\n            from = 0;\n        int distinct = 0;\n        for (int i = from; i <= t; i++) {\n            int seen = 0;\n            for (int j = from; j < i; j++)\n                if (refs[j] == refs[i])\n                    seen = 1;\n            if (!seen)\n                distinct++;\n        }\n        if (distinct > peak)\n            peak = distinct;\n    }\n    return peak;\n}\n';
  const WK = [
    [[[2, 6, 2, 4, 6, 2, 4, 6, 9, 8, 9, 8, 7, 9, 8, 7, 2, 6, 2, 6], 4], [[3, 7, 3, 1, 7, 3, 8, 8, 2, 8, 2, 5, 2, 5, 3, 7], 5]],
    [[[1, 2, 3, 4, 5, 6], 3], [[5, 5, 5, 5], 3]],
    [[[1, 2, 1, 2, 3, 4, 3, 4, 1, 5, 6, 1], 1], [[1, 2, 1, 3, 2, 1, 3, 2, 1, 3, 5, 6, 7, 5, 6, 7], 6]],
  ];
  const wsOut = (cases) => cases.map(([r, d]) => V.workingSet(r, d).max + '\n').join('');
  C.challenge({ id: 'vm-ch-ws', n: 112, title: 'How many frames at the peak?', level: 2, kind: 'c-tests',
    story: 'A hosting company packs many small services onto each machine. To decide how many fit, it records each service\'s page references and asks how many frames the service needs at its busiest moment: the largest working set over the run, for a window of Δ references.\n\nThe working set at reference t is the set of distinct pages among the last Δ references up to and including t; at the start, when fewer than Δ references have been made, it is the distinct pages made so far.',
    task: 'Write `int ws_peak(int *refs, int n, int delta)`, returning the largest working-set size over the run.',
    metricName: 'tests passed', target: 3, marks: { gold: 3 },
    limits: { forbid: ['malloc'], maxLines: 40, noMain: true },
    starter: '/* the largest number of distinct pages among the last delta references, over every point of refs[0..n-1] */\nint ws_peak(int *refs, int n, int delta) {\n    int peak = 0;\n\n    return peak;\n}\n',
    tests: WK.map((cases, k) => ({ name: ['strings from the course', 'short windows', 'windows of 1 and 6'][k], visible: k === 0, expect: wsOut(cases), maxSteps: 60000, main: mainOf('ws_peak', cases) })),
    hints: ['For each t, look at the window from max(0, t − Δ + 1) to t.', 'Count a page in the window only the first time it appears in it: compare it with the earlier entries of the same window.', 'The first test\'s strings peak at ' + WK[0].map(([r, d]) => V.workingSet(r, d).max).join(' and ') + '. Loop t over the string; for each, count distinct pages in refs[from..t] with a nested loop, and keep the largest count.'],
    solution: { src: WSP },
    wrong: [{ src: WSP.replace('int from = t - delta + 1;', 'int from = t - delta;') }, { src: WSP.replace('            if (!seen)\n                distinct++;\n', '            distinct++;\n') }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'vm-tour', title: 'Tour: virtual memory', blurb: 'The page-fault path, copy-on-write, replacement policies side by side, Belady\'s anomaly, thrashing, the working set and the VM lab, in nine steps.',
    steps: [
      { route: 'part=vm', target: '#main', text: 'Part 11 of the catalogue: pages brought in on demand, which page to evict, and how many frames each process needs.' },
      { route: 'topic=vmem-fault-path', target: '#stageWrap', text: 'One page fault, step by step, each with its cost: nearly all of it is the disk.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=vmem-cow', target: '#stageWrap', text: 'fork with copy-on-write: frames are shared until a write, and copied only if still shared.' },
      { route: 'topic=vmem-replace', target: '#inputs', text: 'Choose a policy, from FIFO and OPT to the clock family, and type your own reference string.' },
      { route: 'topic=vmem-belady', target: '#stageWrap', text: 'Belady\'s anomaly: one more frame, one more fault, under FIFO.' },
      { route: 'topic=vmem-thrashing', target: '#stageWrap', text: 'Thrashing: CPU utilisation climbs, peaks, and collapses as processes are added.' },
      { route: 'labs/vm', target: '#labView', text: 'The VM lab: a reference string typed, generated or traced from C, up to three policies side by side, and a sweep of faults against frames.' },
      { route: 'learn', target: '[data-chapter="vm-demand"]', text: 'The lessons and exercises of this part start here: replacement tables to fill, fault costs to work out, and two replay functions to write in C.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'vm-course', title: 'Virtual memory', blurb: 'All twenty topics of part 11, from the page-fault path to choosing a page size, with lessons and exercises on the way.',
    steps: [
      { lesson: 'vm-fault', note: 'Demand paging and the valid bit.' },
      { topic: 'vmem-fault-path', note: 'One fault, step by step.' },
      { exercise: 'vm-x-fault-cost', note: 'What one fault costs.' },
      { topic: 'vmem-demand-eat', note: 'The fault rate and the access time.' },
      { exercise: 'vm-x-eat', note: 'Work one out.' },
      { topic: 'vmem-demand-run', note: 'A whole string under demand paging.' },
      { topic: 'vmem-cow', note: 'Copy-on-write and zero-fill.' },
      { exercise: 'vm-x-cow-copies', note: 'Count the copies.' },
      { topic: 'vmem-mmap', note: 'Mapped files, shared and private.' },
      { lesson: 'vm-basic', note: 'FIFO, OPT and LRU.' },
      { topic: 'vmem-replace', note: 'One policy, step by step.' },
      { exercise: 'vm-x-lru-table', note: 'Fill in an LRU table.' },
      { topic: 'vmem-compare', note: 'Ten policies on one string.' },
      { exercise: 'vm-x-clock-table', note: 'The clock by hand.' },
      { topic: 'vmem-belady', note: 'Belady\'s anomaly.' },
      { exercise: 'vm-x-belady', note: 'One more frame.' },
      { topic: 'vmem-refs', note: 'Reference strings with locality.' },
      { topic: 'vmem-refs-c', note: 'A string traced from C.' },
      { exercise: 'vm-x-loop-order', note: 'Rows or columns.' },
      { topic: 'vmem-frame-alloc', note: 'Sharing out the frames.' },
      { exercise: 'vm-x-prop', note: 'Frames in proportion.' },
      { topic: 'vmem-global-local', note: 'Global against local.' },
      { topic: 'vmem-thrashing', note: 'Thrashing.' },
      { topic: 'vmem-working-set', note: 'The working set.' },
      { exercise: 'vm-x-ws', note: 'One moment\'s working set.' },
      { topic: 'vmem-pff', note: 'Page-fault frequency.' },
      { topic: 'vmem-buddy', note: 'The buddy system.' },
      { exercise: 'vm-x-buddy', note: 'Blocks and buddies.' },
      { topic: 'vmem-slab', note: 'Slab caches.' },
      { topic: 'vmem-malloc', note: 'malloc and free.' },
      { topic: 'vmem-malloc-compare', note: 'Four searches compared.' },
      { exercise: 'vm-x-malloc', note: 'Three searches, one heap.' },
      { topic: 'vmem-page-size', note: 'Choosing a page size.' },
      { exercise: 'vm-x-pagesize', note: 'Entries for a page size.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p11 lesson vm-fault')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'vm').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p11 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['vm-x-fault-order', 'vm-x-mmap', 'vm-x-lru-table', 'vm-x-second-table', 'vm-x-stack', 'vm-x-code-fifo', 'vm-x-prop', 'vm-x-ws', 'vm-x-buddy', 'vm-x-malloc'])
      S.Checks.push({ group: 'learn', name: 'p11 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p11 course vm-course', hash: 'course=vm-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['vm-ch-clock', 'vm-ch-ws']) S.Checks.push({ group: 'learn', name: 'p11 challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
