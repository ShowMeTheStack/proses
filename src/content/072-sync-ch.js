// Part 7, synchronisation tools: the challenges, the guided tour, the course, and the pages the diagram checker
// looks at. Each challenge is C for the simulated kernel (S.Kern), scored by hidden tests: every test is a main of its
// own appended to the reader's code, explored by the model checker (S.MC) up to a preemption bound and then run
// under seeded random schedules. A test with granularity: 'machine' makes loads and stores steps, so a plain count++
// can race; spec rows (the Sync lab's properties) are checked over every reachable state of a test's program. The
// reference answers and the wrong ones were scored by S.Challenges.lint.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('syn-ch-lanes')) return;
  const R = String.raw;

  // ---- 1. a counting semaphore of your own ------------------------------------------------------------------------
  const lanesStarter = R`#include <pthread.h>

/* free lanes; add whatever else you need */
int free_lanes;

void lanes_init(int n) {
    free_lanes = n;
}

void lane_take(void) {
    free_lanes = free_lanes - 1;
}

void lane_give(void) {
    free_lanes = free_lanes + 1;
}
`;
  const lanesGood = R`#include <pthread.h>

int free_lanes;
pthread_mutex_t lm = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t lane_free = PTHREAD_COND_INITIALIZER;

void lanes_init(int n) {
    free_lanes = n;
}

void lane_take(void) {
    pthread_mutex_lock(&lm);
    while (free_lanes == 0)
        pthread_cond_wait(&lane_free, &lm);
    free_lanes = free_lanes - 1;
    pthread_mutex_unlock(&lm);
}

void lane_give(void) {
    pthread_mutex_lock(&lm);
    free_lanes = free_lanes + 1;
    pthread_cond_signal(&lane_free);
    pthread_mutex_unlock(&lm);
}
`;
  const lanesTests = [
    { name: 'three swimmers, two lanes', visible: true, expect: 'done\n', preemptions: 1, spec: [{ kind: 'always', what: 'free_lanes >= 0' }], main: R`#include <stdio.h>
void swim(void) {
}
void *swimmer(void *arg) {
    lane_take();
    swim();
    lane_give();
    return NULL;
}
int main(void) {
    pthread_t t[3];
    lanes_init(2);
    for (int i = 0; i < 3; i++) pthread_create(&t[i], NULL, swimmer, NULL);
    for (int i = 0; i < 3; i++) pthread_join(t[i], NULL);
    printf("done\n");
    return 0;
}
` },
    { name: 'one lane is a lock', expect: '2\n', preemptions: 1, granularity: 'machine', main: R`#include <stdio.h>
int laps = 0;
void *swimmer(void *arg) {
    lane_take();
    laps++;
    lane_give();
    return NULL;
}
int main(void) {
    pthread_t a, b;
    lanes_init(1);
    pthread_create(&a, NULL, swimmer, NULL);
    pthread_create(&b, NULL, swimmer, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("%d\n", laps);
    return 0;
}
` },
    { name: 'the pool opens late', expect: 'in\n', main: R`#include <stdio.h>
void *swimmer(void *arg) {
    lane_take();
    printf("in\n");
    return NULL;
}
int main(void) {
    pthread_t a;
    lanes_init(0);
    pthread_create(&a, NULL, swimmer, NULL);
    lane_give();
    pthread_join(a, NULL);
    return 0;
}
` },
    { name: 'one lane frees, two wait', expect: 'ok\n', preemptions: 2, spec: [{ kind: 'always', what: 'free_lanes >= 0' }], main: R`#include <stdio.h>
void swim(void) {
}
void *swimmer(void *arg) {
    lane_take();
    swim();
    lane_give();
    return NULL;
}
int main(void) {
    pthread_t a, b;
    lanes_init(0);
    pthread_create(&a, NULL, swimmer, NULL);
    pthread_create(&b, NULL, swimmer, NULL);
    lane_give();
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("ok\n");
    return 0;
}
` },
  ];
  C.challenge({
    id: 'syn-ch-lanes', n: 71, title: 'Lanes at the pool', level: 2, kind: 'sync-solution',
    story: 'A small swimming club books a pool with a few lanes for its evening session. Swimmers arrive whenever they like; each needs a lane to itself, and when every lane is taken a swimmer waits at the edge until one comes free. The club\'s booking program already uses POSIX threads, but the build it runs on has no semaphores at all.\n\nWrite the lane counter with a mutex and a condition variable: a counting semaphore of your own.',
    task: 'Write `void lanes_init(int n)` (n free lanes), `void lane_take(void)` (waits while no lane is free, then takes one) and `void lane_give(void)` (gives one back and lets a waiting swimmer in). Keep the count of free lanes in `free_lanes`: the tests check, in every schedule they search, that it never goes below zero. No semaphores, no sleeping, no spinning.',
    metricName: 'tests passed', target: 4, marks: { gold: 4 },
    limits: { forbid: ['sem_init', 'sem_wait', 'sem_post', 'sem_trywait', 'sleep', 'usleep', 'sched_yield'], maxLines: 45, noMain: true },
    starter: lanesStarter, tests: lanesTests,
    hints: [
      'Keep the count of free lanes, and guard every read and write of it with one mutex.',
      'A swimmer who finds no free lane waits on a condition variable; waking up proves nothing, because another swimmer may have taken the lane first, so test the count again in a while loop. Each give frees one lane, so one signal is enough.',
      '`lane_take`: lock; `while (free_lanes == 0) pthread_cond_wait(&lane_free, &lm);` then `free_lanes--` and unlock. `lane_give`: lock; `free_lanes++`; `pthread_cond_signal(&lane_free)`; unlock.',
    ],
    solution: { src: lanesGood },
    wrong: [
      { src: lanesGood.replace('    while (free_lanes == 0)', '    if (free_lanes == 0)').replace('pthread_cond_signal', 'pthread_cond_broadcast') },
      { src: lanesGood.replace('    pthread_cond_signal(&lane_free);\n', '') },
      { src: lanesStarter },
    ],
  });

  // ---- 2. a countdown latch -------------------------------------------------------------------------------------------
  const latchStarter = R`#include <pthread.h>

int left;

void latch_init(int n) {
    left = n;
}

void latch_arrive(void) {
    left = left - 1;
}

void latch_wait(void) {
}
`;
  const latchGood = R`#include <pthread.h>

int left;
pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t all_in = PTHREAD_COND_INITIALIZER;

void latch_init(int n) {
    left = n;
}

void latch_arrive(void) {
    pthread_mutex_lock(&lk);
    left--;
    if (left == 0)
        pthread_cond_broadcast(&all_in);
    pthread_mutex_unlock(&lk);
}

void latch_wait(void) {
    pthread_mutex_lock(&lk);
    while (left > 0)
        pthread_cond_wait(&all_in, &lk);
    pthread_mutex_unlock(&lk);
}
`;
  const latchTests = [
    { name: 'two surveyors report', visible: true, expect: 'total 30\n', main: R`#include <stdio.h>
int part[2];
void *surveyor(void *arg) {
    int k = (int)(long)arg;
    part[k] = 10 * (k + 1);
    latch_arrive();
    return NULL;
}
int main(void) {
    pthread_t a, b;
    latch_init(2);
    pthread_create(&a, NULL, surveyor, (void *)0);
    pthread_create(&b, NULL, surveyor, (void *)1);
    latch_wait();
    printf("total %d\n", part[0] + part[1]);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    return 0;
}
` },
    { name: 'two who wait', expect: ['map read\nmap read\n'], preemptions: 1, main: R`#include <stdio.h>
int ready = 0;
void *reader(void *arg) {
    latch_wait();
    if (ready) printf("map read\n");
    return NULL;
}
int main(void) {
    pthread_t a, b;
    latch_init(1);
    pthread_create(&a, NULL, reader, NULL);
    pthread_create(&b, NULL, reader, NULL);
    ready = 1;
    latch_arrive();
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    return 0;
}
` },
    { name: 'three arrive at once', expect: 'sum 6\n', preemptions: 1, granularity: 'machine', main: R`#include <stdio.h>
int part[3];
void *surveyor(void *arg) {
    int k = (int)(long)arg;
    part[k] = k + 1;
    latch_arrive();
    return NULL;
}
int main(void) {
    pthread_t t[3];
    latch_init(3);
    for (int i = 0; i < 3; i++) pthread_create(&t[i], NULL, surveyor, (void *)(long)i);
    latch_wait();
    printf("sum %d\n", part[0] + part[1] + part[2]);
    for (int i = 0; i < 3; i++) pthread_join(t[i], NULL);
    return 0;
}
` },
  ];
  C.challenge({
    id: 'syn-ch-latch', n: 72, title: 'Wait for every surveyor', level: 2, kind: 'sync-solution',
    story: 'A team of surveyors maps a field in strips, one thread per strip. The map can be drawn only when every strip is in, and several parts of the program want to draw it. Each surveyor reports once and goes home; nobody must draw a half-finished map, and nobody must wait after the last strip arrives.\n\nBuild a countdown latch: it starts at n, every arrival counts it down, and waiting returns once it reaches zero.',
    task: 'Write `void latch_init(int n)`, `void latch_arrive(void)` (counts down by one and never blocks) and `void latch_wait(void)` (returns once n arrivals have happened, at once if they already have). Any number of threads may wait.',
    metricName: 'tests passed', target: 3, marks: { gold: 3 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield'], maxLines: 45, noMain: true },
    starter: latchStarter, tests: latchTests,
    hints: [
      'The count is shared by every surveyor: guard it with a mutex, or two arrivals can count down as one.',
      'Waiters sleep on a condition variable while the count is above zero. The last arrival must wake every waiter, not just one.',
      '`latch_arrive`: lock; `left--`; `if (left == 0) pthread_cond_broadcast(&all_in);` unlock. `latch_wait`: lock; `while (left > 0) pthread_cond_wait(&all_in, &lk);` unlock.',
    ],
    solution: { src: latchGood },
    wrong: [
      { src: latchGood.replace('pthread_cond_broadcast', 'pthread_cond_signal') },
      { src: latchGood.replace('    pthread_mutex_lock(&lk);\n    left--;', '    left--;\n    pthread_mutex_lock(&lk);') },
    ],
  });

  // ---- 3. taking turns ------------------------------------------------------------------------------------------------
  const turnsStarter = R`#include <pthread.h>

int parties;
int whose = 0;

void turns_init(int n) {
    parties = n;
}

void turn_begin(int me) {
}

void turn_end(int me) {
}
`;
  const turnsGood = R`#include <pthread.h>

int parties;
int whose = 0;
pthread_mutex_t tm = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t changed = PTHREAD_COND_INITIALIZER;

void turns_init(int n) {
    parties = n;
}

void turn_begin(int me) {
    pthread_mutex_lock(&tm);
    while (whose != me)
        pthread_cond_wait(&changed, &tm);
    pthread_mutex_unlock(&tm);
}

void turn_end(int me) {
    pthread_mutex_lock(&tm);
    whose = (me + 1) % parties;
    pthread_cond_broadcast(&changed);
    pthread_mutex_unlock(&tm);
}
`;
  const turnsMain = (n, rounds, words, rev) => R`#include <stdio.h>
char *word[] = {` + words.map((w) => '"' + w + '"').join(', ') + R`};
void *player(void *arg) {
    int me = (int)(long)arg;
    for (int r = 0; r < ` + rounds + R`; r++) {
        turn_begin(me);
        printf("%s\n", word[me]);
        turn_end(me);
    }
    return NULL;
}
int main(void) {
    pthread_t t[` + n + R`];
    turns_init(` + n + R`);
    for (int i = 0; i < ` + n + R`; i++) pthread_create(&t[i], NULL, player, (void *)(long)` + (rev ? '(' + (n - 1) + ' - i)' : 'i') + R`);
    for (int i = 0; i < ` + n + R`; i++) pthread_join(t[i], NULL);
    return 0;
}
`;
  const seq = (words, rounds) => Array.from({ length: rounds }, () => words.join('\n') + '\n').join('');
  const turnsTests = [
    { name: 'ping and pong', visible: true, preemptions: 1, expect: seq(['ping', 'pong'], 2), main: turnsMain(2, 2, ['ping', 'pong'], false) },
    { name: 'pong starts first', preemptions: 1, expect: seq(['ping', 'pong'], 2), main: turnsMain(2, 2, ['ping', 'pong'], true) },
    { name: 'three in a ring', expect: seq(['tic', 'tac', 'toe'], 1), preemptions: 1, main: turnsMain(3, 1, ['tic', 'tac', 'toe'], true) },
  ];
  C.challenge({
    id: 'syn-ch-turns', n: 73, title: 'Tic, tac, toe in turn', level: 3, kind: 'sync-solution',
    story: 'A bell-ringing practice program gives each ringer a thread. The ringers must sound strictly in order, 0, 1, 2, then 0 again, however the scheduler happens to run them, and a ringer whose turn it is not must sleep rather than burn the CPU waiting.\n\nWrite the turn-taking: each ringer asks for its turn, rings, and passes the turn on to the next.',
    task: 'Write `void turns_init(int n)` for n ringers numbered 0 to n − 1, `void turn_begin(int me)` (waits until it is ringer me\'s turn; ringer 0 goes first) and `void turn_end(int me)` (passes the turn to ringer (me + 1) mod n).',
    metricName: 'tests passed', target: 3, marks: { gold: 3 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield', 'sem_init'], maxLines: 45, noMain: true },
    starter: turnsStarter, tests: turnsTests,
    hints: [
      'One shared variable says whose turn it is. Guard it with a mutex, and let a ringer sleep on a condition variable while the turn is someone else\'s.',
      'With three ringers asleep on one condition variable, a single signal may wake the wrong one: it tests the turn, finds it is not its own and sleeps again, and the right ringer never wakes. Wake them all and let each test again.',
      '`turn_begin`: lock; `while (whose != me) pthread_cond_wait(&changed, &tm);` unlock. `turn_end`: lock; `whose = (me + 1) % parties;` `pthread_cond_broadcast(&changed);` unlock.',
    ],
    solution: { src: turnsGood },
    wrong: [
      { src: turnsGood.replace('pthread_cond_broadcast', 'pthread_cond_signal') },
      { src: turnsGood.replace('    while (whose != me)', '    if (whose != me)') },
    ],
  });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'syn-tour', title: 'Tour: synchronisation tools', blurb: 'A lost update, Peterson on a reordering machine, spinlocks against a sleeping mutex, semaphores, and the while-loop rule, in eight steps.',
    steps: [
      { route: 'part=sync', target: '#main', text: 'Part 7 of the catalogue: what goes wrong when threads share memory, and the tools that keep them in order.' },
      { route: 'topic=sync-race-steps', target: '#stageWrap', text: 'count++ is a load, an add and a store. Two threads that load before either stores lose an update, silently.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=sync-race-tree', target: '#stageWrap', text: 'Every interleaving of two such threads as a tree: 20 schedules, and only 2 end with the right count.' },
      { route: 'topic=sync-peterson-tso', target: '#inputs', text: 'Peterson\'s algorithm on a machine with store buffers: both threads get in. Switch to the fenced variant here and the checker finds no violation.' },
      { route: 'topic=sync-mutex', target: '#inputs', text: 'A spinlock and a mutex on one CPU, same work: choose the kind here and compare the wasted steps.' },
      { route: 'topic=sync-condvar', target: '#inputs', text: 'Condition variables: signal or broadcast, if or while. Each wrong choice comes with the schedule that breaks it.' },
      { route: 'learn', target: '[data-chapter="syn-races"]', text: 'The lessons and exercises of this part start here: interleavings counted, semaphores traced by hand, and C programs to fix, checked over every schedule.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'syn-course', title: 'Synchronisation tools', blurb: 'All eighteen topics of part 7, from the lost update to the model checker, with lessons and exercises on the way.',
    steps: [
      { lesson: 'syn-count', note: 'A load, an add and a store.' },
      { topic: 'sync-race-steps', note: 'One lost update, step by step.' },
      { topic: 'sync-race-tree', note: 'All 20 schedules.' },
      { exercise: 'syn-x-race-table', note: 'Follow the registers by hand.' },
      { topic: 'sync-race-c', note: 'The race in real C.' },
      { exercise: 'syn-x-race-twice', note: 'Count the outputs.' },
      { exercise: 'syn-x-code-mutex', note: 'Lock the counter.' },
      { lesson: 'syn-cs', note: 'Three requirements, three failed attempts.' },
      { topic: 'sync-cs-attempts', note: 'Which requirement breaks.' },
      { topic: 'sync-peterson', note: 'Flags and a turn.' },
      { exercise: 'syn-x-peterson-turn', note: 'The last to write turn waits.' },
      { topic: 'sync-peterson-tso', note: 'When stores wait in a buffer.' },
      { topic: 'sync-atomic-ops', note: 'One indivisible step.' },
      { exercise: 'syn-x-split-tas', note: 'Test, then set.' },
      { topic: 'sync-spinlock', note: 'Spinning and tickets.' },
      { topic: 'sync-mcs', note: 'Each waiter on its own flag.' },
      { exercise: 'syn-x-ticket', note: 'Wait for your number.' },
      { topic: 'sync-mutex', note: 'Sleep instead of spinning.' },
      { lesson: 'syn-sem', note: 'A counter with a queue.' },
      { topic: 'sync-semaphore', note: 'A pool, a lock, a signal.' },
      { exercise: 'syn-x-sem-pool', note: 'Trace a semaphore.' },
      { exercise: 'syn-x-code-order', note: 'Serve after cooking.' },
      { topic: 'sync-condvar', note: 'Signal, broadcast, and while.' },
      { exercise: 'syn-x-code-wake', note: 'Fix the lost wake-up.' },
      { topic: 'sync-monitor', note: 'Mesa and Hoare.' },
      { topic: 'sync-struct-counter', note: 'One lock, or parts of your own.' },
      { topic: 'sync-struct-list', note: 'Hand over hand.' },
      { topic: 'sync-struct-hash', note: 'A lock per bucket.' },
      { exercise: 'syn-x-hoh', note: 'The rule that keeps the list whole.' },
      { topic: 'sync-checker-search', note: 'Every reachable state.' },
      { topic: 'sync-checker-bounds', note: 'Bounds and random schedules.' },
      { exercise: 'syn-x-bounds', note: 'What a bound promises.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson syn-count')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'sync').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['syn-x-race-table', 'syn-x-race-outputs', 'syn-x-cs-check', 'syn-x-n-schedules', 'syn-x-sem-lock', 'syn-x-sem-meet', 'syn-x-sem-blocked', 'syn-x-code-gate', 'syn-x-code-wake'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course syn-course', hash: 'course=syn-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['syn-ch-lanes', 'syn-ch-latch', 'syn-ch-turns']) S.Checks.push({ group: 'learn', name: 'syn challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
