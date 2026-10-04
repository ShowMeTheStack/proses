// Part 9, deadlocks: the challenge, the guided tour, the course, and the pages the diagram checker looks at. The
// challenge is of the sync-solution kind: each hidden test appends a main to the reader's code, the model checker
// explores its schedules up to a preemption bound looking for a deadlock, and seeded random schedules try it again.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('dl-ch-seeds')) return;
  const HDR = '#include <stdio.h>\n#include <pthread.h>\n';
  const TOP = '#include <pthread.h>\n\nint stock[4] = {100, 100, 100, 100};\npthread_mutex_t shed[4] = {\n    PTHREAD_MUTEX_INITIALIZER, PTHREAD_MUTEX_INITIALIZER,\n    PTHREAD_MUTEX_INITIALIZER, PTHREAD_MUTEX_INITIALIZER\n};\n\n';
  const MOVE = (head, a, b) => TOP + 'void move(int from, int to, int crates) {\n' + head + '    pthread_mutex_lock(&shed[' + a + ']);\n    pthread_mutex_lock(&shed[' + b + ']);\n    stock[from] = stock[from] - crates;\n    stock[to] = stock[to] + crates;\n    pthread_mutex_unlock(&shed[' + b + ']);\n    pthread_mutex_unlock(&shed[' + a + ']);\n}\n';
  const GOOD = MOVE('    if (from == to)\n        return;\n    int lo = from < to ? from : to;\n    int hi = from < to ? to : from;\n', 'lo', 'hi');
  const NOSELF = MOVE('    int lo = from < to ? from : to;\n    int hi = from < to ? to : from;\n', 'lo', 'hi');
  const STARTER = MOVE('', 'from', 'to');
  const SHOW = '    printf("%d %d %d %d\\n", stock[0], stock[1], stock[2], stock[3]);\n';
  const threads = (calls) => calls.map((c, i) => 'void *w' + i + '(void *arg) {\n' + c.map((m) => '    move(' + m.join(', ') + ');\n').join('') + '    return NULL;\n}\n').join('') +
    'int main(void) {\n    pthread_t t[' + calls.length + '];\n' + calls.map((_, i) => '    pthread_create(&t[' + i + '], NULL, w' + i + ', NULL);\n').join('') + '    for (int i = 0; i < ' + calls.length + '; i++)\n        pthread_join(t[i], NULL);\n' + SHOW + '    return 0;\n}\n';
  /** the stock after a set of moves: the sums do not depend on the order */
  const after = (calls) => { const s = [100, 100, 100, 100]; for (const c of calls) for (const [f, t, n] of c) { s[f] -= n; s[t] += n; } return s.join(' ') + '\n'; };
  const T1 = [[[0, 1, 10]], [[1, 0, 30]]];
  const T2 = [[[0, 1, 5]], [[1, 2, 7]], [[2, 0, 9]]];
  const T3 = [[[2, 2, 50]], [[2, 3, 1]]];
  const T4 = [[[3, 1, 4], [1, 3, 6]], [[1, 3, 2], [3, 1, 8]]];

  C.challenge({ id: 'dl-ch-seeds', n: 91, title: 'The seed bank that never jams', level: 2, kind: 'sync-solution',
    story: 'A seed bank keeps its stock in four cold sheds, numbered 0 to 3, each with its own door lock. Forklift drivers move crates between sheds all day: a driver locks the shed the crates leave and the shed they go to, moves them, and unlocks both. Last winter two drivers moving crates in opposite directions each locked one shed and waited for the other\'s, and the whole yard stood still until someone noticed.\n\nWrite `move(from, to, crates)` so that no mix of moves can ever jam the yard, and the stock always adds up. Some moves are paperwork corrections from a shed to itself: they must not jam either.',
    task: 'Write `void move(int from, int to, int crates)` over the given `stock[4]` and `shed[4]`, holding both sheds\' locks while the crates move, so that no schedule deadlocks.',
    metricName: 'tests passed', target: 4, marks: { gold: 4 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield', 'pthread_mutex_trylock'], maxLines: 40, noMain: true },
    starter: STARTER,
    tests: [
      { name: 'two drivers, opposite ways', visible: true, expect: after(T1), preemptions: 2, main: HDR + threads(T1) },
      { name: 'a ring of three sheds', expect: after(T2), preemptions: 2, main: HDR + threads(T2) },
      { name: 'a correction to the same shed', expect: after(T3), preemptions: 1, main: HDR + threads(T3) },
      { name: 'back and forth, twice each', expect: after(T4), preemptions: 1, main: HDR + threads(T4) },
    ],
    hints: ['Two drivers jam when one holds shed a and waits for b while the other holds b and waits for a. Make that impossible.', 'Lock the lower-numbered shed first, whichever way the crates go: then nobody can hold a higher shed while waiting for a lower one. And a mutex locked twice by the same driver waits for itself.', 'if (from == to) return; int lo = from < to ? from : to; int hi = from < to ? to : from; lock shed[lo], then shed[hi]; move; unlock in reverse.'],
    solution: { src: GOOD }, wrong: [{ src: STARTER }, { src: NOSELF }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'dl-tour', title: 'Tour: deadlocks', blurb: 'The allocation graph closing a cycle, the four conditions, the banker\'s safety check, detection and recovery, lock order and the Deadlock lab, in nine steps.',
    steps: [
      { route: 'part=deadlock', target: '#main', text: 'Part 9 of the catalogue: processes that wait for each other for ever, and the four ways to deal with it: prevent, avoid, detect, or ignore.' },
      { route: 'topic=dl-rag-live', target: '#stageWrap', text: 'The resource-allocation graph, drawn live: assignment edges from units to holders, request edges to the boxes, and the cycle that closes when two jobs take two resources in opposite orders.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=dl-conditions', target: '#inputs', text: 'Switch off one of the four conditions and the model checker shows that no schedule can deadlock any more.' },
      { route: 'topic=dl-safety', target: '#stageWrap', text: 'The safety check, row by row: Need against Work, and Work growing as each process finishes and gives its allocation back.' },
      { route: 'topic=dl-banker-request', target: '#stageWrap', text: 'The banker pretends to grant a request and checks the state it would leave. Free units can still be refused.' },
      { route: 'topic=dl-recover-abort', target: '#stageWrap', text: 'Detection finds who is deadlocked; recovery aborts the cheapest, one at a time, until the knot comes undone.' },
      { route: 'labs/deadlock', target: '#labView', text: 'The Deadlock lab: scripts or drawn graphs, the banker on your own tables, detection and recovery, and the four conditions switched on and off.' },
      { route: 'learn', target: '[data-chapter="dl-graphs"]', text: 'The lessons and exercises of this part start here: cycles to find, safe sequences, requests to grant or refuse, and C programs whose locks must be put in order.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'dl-course', title: 'Deadlocks', blurb: 'All fourteen topics of part 9, from the allocation graph to livelock, with lessons and exercises on the way.',
    steps: [
      { lesson: 'dl-what', note: 'What a deadlock is.' },
      { topic: 'dl-rag-live', note: 'The graph, live.' },
      { exercise: 'dl-x-cycle-pair', note: 'Find the cycle.' },
      { topic: 'dl-rag-cycle', note: 'Depth-first search for a cycle.' },
      { exercise: 'dl-x-units-deadlock', note: 'A cycle with two units.' },
      { topic: 'dl-wait-for', note: 'Collapse it to processes.' },
      { exercise: 'dl-x-waitfor', note: 'The wait-for edges.' },
      { lesson: 'dl-conditions', note: 'The four conditions.' },
      { topic: 'dl-conditions', note: 'Each switched off in turn.' },
      { exercise: 'dl-x-cond-which', note: 'Which condition a spool breaks.' },
      { topic: 'dl-prevention', note: 'What each rule costs.' },
      { exercise: 'dl-x-pool-min', note: 'Enough drives for anyone.' },
      { lesson: 'dl-safe', note: 'Safe states.' },
      { topic: 'dl-safety', note: 'The check, row by row.' },
      { exercise: 'dl-x-seq-four', note: 'A safe sequence.' },
      { topic: 'dl-banker-request', note: 'Granted or refused.' },
      { exercise: 'dl-x-req-unsafe', note: 'Free, but refused.' },
      { topic: 'dl-claim-graph', note: 'Claim edges.' },
      { lesson: 'dl-detection', note: 'Detecting after the fact.' },
      { topic: 'dl-detect', note: 'Many units.' },
      { exercise: 'dl-x-detect-set', note: 'Who is deadlocked.' },
      { topic: 'dl-recover-abort', note: 'Abort the cheapest.' },
      { exercise: 'dl-x-abort-cost', note: 'What recovery costs.' },
      { topic: 'dl-recover-rollback', note: 'Roll back instead.' },
      { lesson: 'dl-locks', note: 'Locks, order and livelock.' },
      { topic: 'dl-lock-order', note: 'Opposite orders.' },
      { topic: 'dl-lockdep', note: 'A lock-order checker.' },
      { exercise: 'dl-x-lockdep-warn', note: 'A warning after a good run.' },
      { topic: 'dl-livelock', note: 'Busy, going nowhere.' },
      { exercise: 'dl-x-code-transfer', note: 'Put two locks in order.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p09 lesson dl-what')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'deadlock').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p09 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['dl-x-cycle-hidden', 'dl-x-units-deadlock', 'dl-x-waitfor', 'dl-x-need', 'dl-x-seq-five', 'dl-x-req-unsafe', 'dl-x-work', 'dl-x-detect-set', 'dl-x-code-ring'])
      S.Checks.push({ group: 'learn', name: 'p09 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p09 course dl-course', hash: 'course=dl-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p09 challenge dl-ch-seeds', hash: 'challenge/dl-ch-seeds', ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
