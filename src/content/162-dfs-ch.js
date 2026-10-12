// Part 16, distributed file systems: the guided tour, the course, and the pages the diagram checker looks at. No
// challenge here: none of the challenge kinds (scheduling, synchronisation, page tables, disk scheduling, the shell)
// measures a distributed file system, so this part's harder work is in its level-3 exercises.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.tours.has('dfs-tour')) return;

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'dfs-tour', title: 'Tour: distributed file systems', blurb: 'Messages, retries, stale reads, callback promises and the distributed workbench of the File-system lab, in eight steps.',
    steps: [
      { route: 'part=dfs', target: '#main', text: 'Part 16 of the catalogue: a file system reached over the network, where every call can become messages, and messages can be lost.' },
      { route: 'topic=dfs-model', target: '#stageWrap', text: 'One client and a server on a timeline. Each request crosses to the server and its reply comes back; the counters add up the messages and bytes.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=dfs-stateless', target: '#inputs', text: 'Lose a reply, lose a request, or crash the server: the client cannot tell which, so it sends the same request again. Safe, because the requests are idempotent.' },
      { route: 'topic=dfs-attr', target: '#stageWrap', text: 'Cached attributes save a question per read, and let another client\'s change go unseen for up to the timeout: watch the stale read at t = 8.' },
      { route: 'topic=dfs-afs', target: '#stageWrap', text: 'Whole files with callback promises: an open with a promise costs no message, and a store breaks the other clients\' promises.' },
      { lab: 'fs', setup: { mode: 'dfs' }, target: '#labView', text: 'The File-system lab\'s distributed workbench: script two clients, lose messages, crash the server, switch the protocol, and count what each design costs.' },
      { route: 'learn', target: '[data-chapter="dfs-wire"]', text: 'The lessons and exercises of this part start here: retries to trace, stale reads to find, promises to count, and the two designs to cost out.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'dfs-course', title: 'Distributed file systems', blurb: 'All eight topics of part 16, from one client and a server to the cost of each design, with lessons and exercises on the way.',
    steps: [
      { lesson: 'dfs-remote', note: 'Calls become messages.' },
      { topic: 'dfs-model', note: 'One client, one server.' },
      { exercise: 'dfs-x-requests', note: 'Which call sends what.' },
      { lesson: 'dfs-retry', note: 'Stateless and idempotent.' },
      { topic: 'dfs-stateless', note: 'Lost messages and a crash.' },
      { exercise: 'dfs-x-twice', note: 'A WRITE done twice.' },
      { exercise: 'dfs-x-retry-table', note: 'Every try of one request.' },
      { lesson: 'dfs-notidem', note: 'When a retry is not safe.' },
      { topic: 'dfs-dupcache', note: 'The duplicate-request cache.' },
      { exercise: 'dfs-x-dup-table', note: 'What the client is told.' },
      { lesson: 'dfs-attrs', note: 'Trusting the cache for a while.' },
      { topic: 'dfs-attr', note: 'Stale reads.' },
      { exercise: 'dfs-x-stale-set', note: 'Find them.' },
      { lesson: 'dfs-c2o', note: 'Flush on close, check on open.' },
      { topic: 'dfs-close', note: 'Close-to-open, and the last writer.' },
      { exercise: 'dfs-x-c2o-table', note: 'Close, then open.' },
      { exercise: 'dfs-x-lost-count', note: 'Count the lost updates.' },
      { lesson: 'dfs-callbacks', note: 'Whole files and promises.' },
      { topic: 'dfs-afs', note: 'Callbacks on the timeline.' },
      { exercise: 'dfs-x-afs-table', note: 'Open by open.' },
      { topic: 'dfs-afs-crash', note: 'A crash forgets the promises.' },
      { exercise: 'dfs-x-probe-set', note: 'Probing often enough.' },
      { lesson: 'dfs-tradeoff', note: 'Measure both.' },
      { topic: 'dfs-cost', note: 'Two designs, one workload.' },
      { exercise: 'dfs-x-cost-size', note: 'When whole files cost more.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p16 lesson dfs-remote')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'dfs').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p16 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['dfs-x-requests', 'dfs-x-idem', 'dfs-x-retry-table', 'dfs-x-dup-table', 'dfs-x-stale-set', 'dfs-x-c2o-table', 'dfs-x-lost-count', 'dfs-x-afs-table', 'dfs-x-probe-set', 'dfs-x-cost-table'])
      S.Checks.push({ group: 'learn', name: 'p16 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p16 course dfs-course', hash: 'course=dfs-course', ready: "document.querySelector('#courseView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
