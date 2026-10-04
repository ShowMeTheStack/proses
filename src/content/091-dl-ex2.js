// Part 9, deadlocks: the exercises of chapter 3 (detection with many units, recovery by termination and by rollback)
// and chapter 4 (lock order, a lock-order checker, livelock, and two C programs whose locks must be taken in one
// order). Answers come from the engines (S.Banker, S.Rag, S.Lockdep) as this file loads; the C programs are checked
// by tests on S.Kern and by the model checker (S.MC), which searches the schedules for a deadlock.
(function (S) {
  'use strict';
  const C = S.Content, B = S.Banker, RG = S.Rag;
  if (!C || !B || !RG || C.exercises.has('dl-x-detect-set')) return;
  const vec = (v) => '(' + v.join(', ') + ')';
  const strip = (t) => String(t).replace(/`/g, '');
  const P = (i) => 'P' + i;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const setOf = (xs) => '{' + xs.join(', ') + '}';

  // ---- detection with many units ------------------------------------------------------------------------------------
  const D = { avail: [1, 0, 1], alloc: [[0, 0, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]], request: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]] };
  const COST = [4, 7, 3, 6, 5];
  const detText = 'Five processes and the resource types A, B and C. Allocation: ' + D.alloc.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '. Request (what each is blocked waiting for now): ' + D.request.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '. Available: ' + vec(D.avail) + '.';
  const det = B.detect(D), dl = det.deadlocked.map(P);
  const fits = (steps) => steps.filter((s) => s.fits).map((s) => strip(s.say));
  C.exercise({ id: 'dl-x-detect-set', chapter: 'dl-detect', title: 'Who is deadlocked?', level: 2, kind: 'set',
    text: [detText, 'Run the detection algorithm. Which processes are deadlocked? Answer as a set, like {P1, P4}, or {} if nobody is.'],
    answer: setOf(dl), caseless: true,
    hints: ['Detection is the safety check with Request in place of Need: a process that can get what it waits for now is assumed to finish and give back what it holds.', fits(det.steps).join(' '), 'Then the pass stops: every process left waits for B, and no B is free. Deadlocked: ' + setOf(dl) + '.'],
    solution: setOf(dl), wrong: ['{}', setOf(dl.slice(0, 2)), '{P0, P1, P2, P3, P4}'],
    whyNot: 'Start with Work = Available and let every process whose Request fits finish and give back its Allocation.' });

  const T = B.terminate(Object.assign({ cost: COST }, D), { policy: 'cheapest' });
  const costT = T.aborted.reduce((s, i) => s + COST[i], 0), costAll = det.deadlocked.reduce((s, i) => s + COST[i], 0);
  C.exercise({ id: 'dl-x-abort-cost', chapter: 'dl-detect', title: 'Abort the cheapest', level: 2, kind: 'number',
    text: [detText, 'Aborting a process costs ' + COST.map((c, i) => P(i) + ' ' + c).join(', ') + '. Recovery aborts the cheapest deadlocked process, runs detection again, and repeats until nobody is deadlocked. What is the total cost of the processes it aborts?'],
    answer: costT, whyNot: { [String(costAll)]: 'That aborts every deadlocked process at once. One at a time, detection may find the deadlock gone sooner.', [String(COST[T.aborted[0]])]: 'After the first abort, run detection again: is anybody still deadlocked?', '*': 'Abort the cheapest of the deadlocked, give its allocation back, and run detection again.' },
    hints: ['Detection finds ' + list(dl) + ' deadlocked. The cheapest of them goes first.', T.steps.filter((s) => s.kind === 'abort').slice(0, 1).map((s) => strip(s.say)).join(' ') + ' Run detection again.', T.steps.filter((s) => s.kind !== 'detect' || s !== T.steps[0]).map((s) => strip(s.say)).join(' ') + ' Total: ' + T.aborted.map((i) => COST[i]).join(' + ') + ' = ' + costT + '.'],
    solution: costT, wrong: [costAll, COST[T.aborted[0]]] });

  const PEN = 6;
  const R = B.preempt(Object.assign({ cost: COST, penalty: PEN }, D));
  const v0 = R.victims[0];
  C.exercise({ id: 'dl-x-rollback-cost', chapter: 'dl-detect', title: 'Rolled back once', level: 1, kind: 'number',
    text: [detText, 'Instead of aborting, recovery rolls a victim back to a checkpoint where it held nothing. The victim is the deadlocked process of least cost + ' + PEN + ' × (times it has been rolled back before), with costs ' + COST.map((c, i) => P(i) + ' ' + c).join(', ') + '. The first victim is ' + P(v0) + '. If it is caught in a deadlock again later, what will its cost be when the next victim is chosen?'],
    answer: COST[v0] + PEN, whyNot: { [String(COST[v0])]: 'Its rollback count has gone up by one, and each rollback adds the penalty.', [String(PEN)]: 'The penalty is added to its own cost, not instead of it.', '*': 'Cost + penalty × rollbacks so far.' },
    hints: ['The penalty is there so that the same process is not chosen every time: starvation.', P(v0) + ' costs ' + COST[v0] + ' and has now been rolled back once.', COST[v0] + ' + ' + PEN + ' × 1 = ' + (COST[v0] + PEN) + '.'],
    solution: COST[v0] + PEN, wrong: [COST[v0], PEN] });
  C.exercise({ id: 'dl-x-recover-why', chapter: 'dl-detect', title: 'Why a rollback penalty?', level: 1, kind: 'choice',
    text: ['A system breaks deadlocks by rolling back the cheapest deadlocked process. The same two jobs keep deadlocking with each other, and the cheaper one is rolled back every time. What goes wrong, and what fixes it?'],
    options: ['The cheap job starves: it never finishes. Count its rollbacks in its cost, so it stops being the cheapest', 'Nothing: rolling back the cheapest is always best', 'The deadlock comes back because rollback does not free anything', 'The expensive job starves'], answer: 0,
    whyNot: { 1: 'Cheapest each time can mean the same victim each time.', 2: 'A rollback returns everything gained since the checkpoint; the deadlock is broken.', 3: 'The expensive job always wins.' },
    hints: ['Who loses its work every time the two meet?', 'A process that is always the victim never gets to the end: that is starvation.', 'Add a penalty per earlier rollback to its cost: after a few rounds the other job becomes the cheaper victim.'],
    solution: 0, wrong: [1, 3] });

  const G = { procs: ['P0', 'P1', 'P2', 'P3'], res: [{ name: 'Buf', units: 2 }, { name: 'Port', units: 1 }], hold: [[0, 0], [1, 0], [2, 1]], want: [[0, 1], [1, 1], [2, 0], [3, 0]] };
  const gD = RG.deadlock(RG.graph(G));
  C.exercise({ id: 'dl-x-units-set', chapter: 'dl-detect', title: 'Two buffers and a port', level: 3, kind: 'set',
    text: ['There are 2 buffers (Buf) and 1 port. P0 holds a buffer and waits for the port; P1 holds the other buffer and waits for the port; P2 holds the port and waits for a buffer; P3 holds nothing and waits for a buffer. Which processes are deadlocked, by the detection algorithm? Answer as a set.'],
    answer: setOf(gD.deadlocked.map(P)), caseless: true,
    hints: ['Several units of Buf exist, so a cycle alone proves nothing: count. Available is (0, 0): both buffers and the port are held.', 'Can anybody\'s request be met now? P3 holds nothing, so the algorithm sets it aside: it cannot free anything for the others.', strip(gD.say) + ' P3 waits too, for ever, but holding nothing it is not counted as deadlocked.'],
    solution: setOf(gD.deadlocked.map(P)), wrong: ['{P0, P1, P2, P3}', '{P0, P2}', '{}'],
    whyNot: 'Work starts at (0, 0). Only a process whose whole request fits can finish and free what it holds.' });

  // ---- lock order --------------------------------------------------------------------------------------------------
  const ev = (t, ...ops) => ops.map((o) => ({ thread: t, op: o[0] === '+' ? 'acquire' : 'release', lock: o.slice(1) }));
  const RUN = [['T0', '+log', '+cache', '-cache', '-log'], ['T1', '+cache', '+index', '-index', '-cache'], ['T2', '+log', '+index', '-index', '-log'], ['T3', '+index', '+log', '-log', '-index']];
  const LD = S.Lockdep.check(RUN.flatMap((r) => ev(...r)));
  const edges = LD.edges.map((e) => '(' + e.from + ', ' + e.to + ')');
  const runText = 'Four threads ran one after another, so this run never deadlocked: ' + RUN.map((r) => r[0] + ' locked ' + r.slice(1).filter((o) => o[0] === '+').map((o) => o.slice(1)).join(' then ')).join('; ') + ' (each released in reverse order).';
  C.exercise({ id: 'dl-x-lockdep-edges', chapter: 'dl-detect', title: 'Record the lock orders', level: 2, kind: 'set',
    text: [runText, 'A lock-order checker records an edge (held, acquired) whenever a thread takes a lock while holding another. Write the edges it records, as pairs like (log, cache).'],
    answer: edges.join(', '), caseless: true,
    hints: ['Each thread takes its second lock while holding its first: one edge per thread here.', 'T0 holds log when it takes cache: (log, cache).', LD.steps.filter((s) => s.kind === 'edge').map((s) => strip(s.say)).join(' ')],
    solution: edges.join(', '), wrong: [edges.slice(0, 3).join(', '), edges.map((p) => p.replace(/\((\w+), (\w+)\)/, '($2, $1)')).join(', ')],
    whyNot: 'One edge each time a lock is taken while another is held: from the one held to the one taken.' });
  const cyc = LD.cycles[0];
  C.exercise({ id: 'dl-x-lockdep-warn', chapter: 'dl-detect', title: 'A warning after a good run', level: 2, kind: 'choice',
    text: [runText, 'The run finished, but the checker reports a possible deadlock. Which pair of threads could deadlock under some other timing, and over which locks?'],
    options: ['T2 and T3, over ' + cyc.join(' and '), 'T0 and T1, over cache', 'T0 and T2, over log', 'None: the run finished, so the code is fine'], answer: 0,
    whyNot: { 1: 'T0 and T1 take cache in the same direction: log before cache before index.', 2: 'Both take log first; one simply waits for the other.', 3: 'A good run proves only that this timing was fine.' },
    hints: ['Look for two edges in opposite directions, or any cycle among the recorded edges.', 'One thread took index while holding log; another took log while holding index.', strip(LD.steps.find((s) => s.kind === 'cycle').say) + ' If T2 holds log and T3 holds index at the same moment, each waits for the other.'],
    solution: 0, wrong: [3, 1] });
  C.exercise({ id: 'dl-x-livelock', chapter: 'dl-detect', title: 'Busy, but going nowhere', level: 2, kind: 'choice',
    text: ['T0 locks A, then tries B with a try-lock that never waits; T1 locks B, then tries A. A thread whose try fails unlocks what it holds and starts again at once. What can happen?'],
    options: ['Livelock: both keep locking, failing and backing off in step, running all the time but never both getting their locks', 'Deadlock: both block for ever', 'Nothing bad: a try-lock never waits, so both always finish', 'Starvation of one thread only, by priority'], answer: 0,
    whyNot: { 1: 'A try-lock never blocks, so no thread is ever asleep.', 2: 'No thread blocks, but none need make progress either.', 3: 'Both threads are equal here; the trouble is the timing.' },
    hints: ['Can a thread here ever be blocked?', 'If both lock their first lock at once, both tries fail, both back off, and the state is the one they began in.', 'Livelock: in the livelock topic both threads ran 34 steps, backed off 6 times and never entered the critical section. Random back-off delays, or one lock order, break it.'],
    solution: 0, wrong: [1, 2] });

  // ---- C: take two locks in one order --------------------------------------------------------------------------------
  const MC = { deadlock: true, preemptions: 1, maxStates: 20000 };
  const xferBody = (first, second) => `#include <stdio.h>
#include <pthread.h>
#include <assert.h>

int balance[2] = {50, 50};
pthread_mutex_t lock[2];

void transfer(int from, int to, int amount) {
${first}${second}    pthread_mutex_lock(&lock[first]);
    pthread_mutex_lock(&lock[second]);
    balance[from] = balance[from] - amount;
    balance[to] = balance[to] + amount;
    pthread_mutex_unlock(&lock[second]);
    pthread_mutex_unlock(&lock[first]);
}

void *teller(void *arg) {
    int id = (int)(long)arg;
    if (id == 0)
        transfer(0, 1, 10);
    else
        transfer(1, 0, 20);
    return NULL;
}

int main(void) {
    pthread_t t0, t1;
    pthread_mutex_init(&lock[0], NULL);
    pthread_mutex_init(&lock[1], NULL);
    pthread_create(&t0, NULL, teller, (void *)0);
    pthread_create(&t1, NULL, teller, (void *)1);
    pthread_join(t0, NULL);
    pthread_join(t1, NULL);
    assert(balance[0] + balance[1] == 100);
    printf("%d %d\\n", balance[0], balance[1]);
    return 0;
}
`;
  const xferStarter = xferBody('    int first = from;\n', '    int second = to;\n');
  const xferGood = xferBody('    int first = from < to ? from : to;\n', '    int second = from < to ? to : from;\n');
  const xferSwap = xferBody('    int first = to;\n', '    int second = from;\n');
  C.exercise({ id: 'dl-x-code-transfer', chapter: 'dl-detect', title: 'Transfers in both directions', level: 2, kind: 'code', starter: xferStarter,
    text: ['Two tellers move money between accounts 0 and 1 at the same moment, in opposite directions. `transfer` locks the account it takes from, then the one it pays into, so the two tellers can each hold one lock and wait for the other. Change how `first` and `second` are chosen so that every transfer takes the locks in one order, whatever its direction. The program must print `60 40` and no schedule may deadlock.'],
    tests: [{ name: 'both transfers made', stdout: '60 40\n', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC,
    hints: ['A cycle of waits needs one teller to hold 0 and want 1 while the other holds 1 and wants 0.', 'Take the lower-numbered account\'s lock first, whichever way the money moves.', '`int first = from < to ? from : to;` and `int second = from < to ? to : from;`: both tellers now lock 0 before 1, and whoever gets 0 first gets 1 too.'],
    solution: xferGood, wrong: [xferStarter, xferSwap] });

  const ringBody = (pick) => `#include <stdio.h>
#include <pthread.h>

pthread_mutex_t fork_[3] = {PTHREAD_MUTEX_INITIALIZER, PTHREAD_MUTEX_INITIALIZER, PTHREAD_MUTEX_INITIALIZER};
int meals = 0;

void *diner(void *arg) {
    int left = (int)(long)arg;
    int right = (left + 1) % 3;
${pick}    pthread_mutex_lock(&fork_[a]);
    pthread_mutex_lock(&fork_[b]);
    meals++;
    pthread_mutex_unlock(&fork_[b]);
    pthread_mutex_unlock(&fork_[a]);
    return NULL;
}

int main(void) {
    pthread_t t0, t1, t2;
    pthread_create(&t0, NULL, diner, (void *)0);
    pthread_create(&t1, NULL, diner, (void *)1);
    pthread_create(&t2, NULL, diner, (void *)2);
    pthread_join(t0, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("%d meals\\n", meals);
    return 0;
}
`;
  const ringStarter = ringBody('    int a = left;\n    int b = right;\n');
  const ringGood = ringBody('    int a = left < right ? left : right;\n    int b = left < right ? right : left;\n');
  const ringSwapAll = ringBody('    int a = right;\n    int b = left;\n');
  C.exercise({ id: 'dl-x-code-ring', chapter: 'dl-detect', title: 'Three diners, three forks', level: 3, kind: 'code', starter: ringStarter,
    text: ['Three diners sit round a table with a fork between each pair. Diner i (its number comes in `arg`) takes fork i (its left) and then fork (i + 1) % 3 (its right). If all three take their left fork at once, each waits for ever for its right one. Change the choice of `a` and `b` (the forks taken first and second) so that no schedule can deadlock. The program must print `3 meals`. Changing the direction for everyone is not enough.'],
    tests: [{ name: 'everyone eats', stdout: '3 meals\n', seeds: [1, 2, 3, 4, 5, 6] }], mc: MC,
    hints: ['If every diner takes right then left instead, the cycle simply runs the other way.', 'Give the forks a global order by number, and have each diner take the lower-numbered of its two forks first.', 'Diner 2 has forks 2 and 0: it must take 0 first. `int a = left < right ? left : right; int b = left < right ? right : left;` breaks the circle, because nobody can hold fork 2 while waiting for fork 0.'],
    solution: ringGood, wrong: [ringStarter, ringSwapAll] });
})(globalThis.Proses = globalThis.Proses || {});
