// Part 8, classic problems: the exercises of chapters 3 and 4 (philosophers, barbers and barriers; concurrency bugs and
// event loops). Semaphore traces are worked out by the step machine (S.Sync) when this file loads, and the event-loop
// timings by the model the topic uses (S.P08.events); the outputs of the thread programs were listed by the kernel's
// enumerator, and every C program was run on the simulated kernel and compiled with the system compiler.
(function (S) {
  'use strict';
  const C = S.Content, K = S.Check;
  if (!C || !K || !K.kinds || !S.P08 || C.exercises.has('cls-x-phil-graph')) return;
  const c = String.raw;
  const swap = (src, from, to) => { if (!src.includes(from)) throw new Error('081-classic-ex2: no "' + from.slice(0, 40) + '" to replace'); return src.replace(from, to); };
  const trace = (x) => { x.solution = K.kinds['semaphore-trace'].solve(x); x.rows = K.os.semTrace(x); return x; };
  const vals = (rows, s) => rows.map((r) => r[s]).join(', ');
  const D2 = (v) => String(Math.round(v * 100) / 100);

  // =========================================================================================================
  // Chapter 3: philosophers, barbers and barriers
  // =========================================================================================================
  // the philosophers are listed in the order that draws the fewest crossing arrows (the view puts processes in one row,
  // forks in another, each fork under the philosophers that touch it); hold and want index into that list
  const four = (procs, hold, want) => ({ procs, res: [0, 1, 2, 3].map((i) => ({ name: 'F' + i, units: 1 })), hold, want });
  C.exercise({ id: 'cls-x-phil-graph', chapter: 'cls-table', title: 'Four at the table', level: 1, kind: 'graph-cycle',
    text: ['Four philosophers sit round a table with four forks; fork Fi lies between philosopher Pi and P(i + 1). Each has picked up its left fork Fi and now waits for its right fork. The graph shows who holds what and who waits for what. Click the nodes on a cycle, or answer none.'],
    graph: four(['P0', 'P1', 'P3', 'P2'], [[0, 0], [1, 1], [3, 2], [2, 3]], [[0, 1], [1, 2], [3, 3], [2, 0]]),
    hints: ['An arrow from a fork to a philosopher means it holds the fork; from a philosopher to a fork, it waits for it.', 'Start at P0: it waits for F1, which P1 holds; P1 waits for F2…', 'P0 → F1 → P1 → F2 → P2 → F3 → P3 → F0 → P0: every philosopher is on the cycle, and none can eat.'],
    solution: 'P0, F1, P1, F2, P2, F3, P3, F0', wrong: ['none', 'P0, F1, P1'] });

  C.exercise({ id: 'cls-x-phil-ordered', chapter: 'cls-table', title: 'Lowest fork first', level: 2, kind: 'graph-cycle',
    text: ['The same four philosophers now follow the rule "pick up the lower-numbered fork first". P3\'s forks are F3 and F0, so it reaches for F0 first. At this moment P0 holds F0 and waits for F1, P1 holds F1 and waits for F2, P2 holds F2 and waits for F3, and P3 holds nothing and waits for F0. Is there a cycle? Click its nodes, or answer none.'],
    graph: four(['P2', 'P1', 'P0', 'P3'], [[2, 0], [1, 1], [0, 2]], [[2, 1], [1, 2], [0, 3], [3, 0]]),
    hints: ['Follow the waits from P2: what does it wait for, and who holds that?', 'F3 is free: nobody holds it, so P2 can take it at once.', 'There is no cycle: P2 takes F3 and eats, then P1, then P0; P3 gets F0 last. The rule makes everyone reach for forks in one global order, so the chain of waits always ends at a free fork.'],
    solution: 'none', wrong: ['P0, F1, P1, F2, P2, F3, P3, F0', 'P3, F0, P0, F1'] });

  C.exercise({ id: 'cls-x-phil-rule', chapter: 'cls-table', title: 'What each fix breaks', level: 3, kind: 'choice',
    text: ['A deadlock needs four conditions at once: mutual exclusion, hold and wait, no preemption, and a circular wait. The fixes for the philosophers each break one of them. Which pairing is right?', { list: ['A: lowest-numbered fork first', 'B: a waiter who lets one philosopher at a time pick up forks', 'C: only n − 1 philosophers may sit down'] }],
    options: ['A breaks the circular wait; B and C break it too, by keeping a full circle of waiters from forming', 'A breaks mutual exclusion; B breaks hold and wait; C breaks no preemption', 'All three break hold and wait', 'A breaks no preemption; B and C break mutual exclusion'],
    answer: 0, whyNot: { 1: 'A fork is still held by one philosopher at a time in every fix: mutual exclusion stays.', 2: 'With the ordering rule a philosopher still holds one fork while it waits for the other.', 3: 'No fix ever takes a fork away from a philosopher.' },
    hints: ['In every fix a philosopher may still hold one fork while it waits for the next, and no fork is ever taken away.', 'So which condition is left to break?', 'All three break the circular wait. Ordering forbids the waiting chain from coming back to its start; the waiter and the n − 1 seats keep all n philosophers from each holding one fork and waiting at once.'],
    solution: 0, wrong: [1, 2] });

  {
    const n = 5, seated = n - 1, free = n - seated;
    C.exercise({ id: 'cls-x-phil-seats', chapter: 'cls-table', title: 'One seat short', level: 2, kind: 'number',
      text: ['Five philosophers, five forks, but only ' + seated + ' chairs. All ' + seated + ' seated philosophers have each picked up exactly one fork. How many forks lie on the table now?'],
      answer: free, whyNot: { 0: 'Count again: 5 forks and only 4 hands on them.', '*': 'Each seated philosopher holds one fork.' },
      hints: ['There are 5 forks in all.', 'Each of the 4 seated philosophers holds one.', '5 − 4 = 1 fork is free, and one of the seated philosophers has it as its second fork, so at least one of them can eat: the waits cannot all close into a circle.'],
      solution: free, wrong: [0, 2] });
  }

  const philStart = c`#include <stdio.h>
#include <pthread.h>

#define N 3

pthread_mutex_t chopstick[N];
int meals[N];

void *diner(void *arg) {
    int i = (int)(long)arg;
    int left = i;
    int right = (i + 1) % N;
    for (int k = 0; k < 2; k++) {
        pthread_mutex_lock(&chopstick[left]);
        pthread_mutex_lock(&chopstick[right]);
        meals[i] = meals[i] + 1;
        pthread_mutex_unlock(&chopstick[right]);
        pthread_mutex_unlock(&chopstick[left]);
    }
    return NULL;
}

int main(void) {
    pthread_t t[N];
    for (int i = 0; i < N; i++)
        pthread_mutex_init(&chopstick[i], NULL);
    for (int i = 0; i < N; i++)
        pthread_create(&t[i], NULL, diner, (void *)(long)i);
    for (int i = 0; i < N; i++)
        pthread_join(t[i], NULL);
    printf("meals %d %d %d\n", meals[0], meals[1], meals[2]);
    return 0;
}
`;
  const philSol = swap(philStart, '    int right = (i + 1) % N;\n', '    int right = (i + 1) % N;\n    if (left > right) {\n        int t = left;\n        left = right;\n        right = t;\n    }\n');
  const philRight = swap(philStart, '    int left = i;\n    int right = (i + 1) % N;\n', '    int left = (i + 1) % N;\n    int right = i;\n');
  C.exercise({ id: 'cls-x-phil-code', chapter: 'cls-table', title: 'Philosophers who cannot deadlock', level: 2, kind: 'code',
    text: ['Three diners share three chopsticks, one between each pair, and each eats twice. Every diner picks up its left chopstick, then its right. On some schedules all three hold their left chopstick and wait for ever.', 'Change `diner` so that no schedule can deadlock, and every diner still holds both of its own chopsticks while it eats. The tests run ten random schedules, including ones that deadlock the program as written.'],
    starter: philStart,
    tests: [{ name: 'two meals each', stdout: 'meals 2 2 2\n', seeds: [1, 2, 3, 4, 26, 30, 33, 44, 48, 54] }],
    mc: { deadlock: true, preemptions: 0 },
    hints: ['The deadlock is a circle: each diner holds one chopstick and waits for the next one round the table.', 'Give the chopsticks a global order and make every diner pick up the lower-numbered one first. One diner then reaches the other way, and the circle cannot close.', 'After computing `left` and `right`, swap them when `left > right`: `if (left > right) { int t = left; left = right; right = t; }`. Diner 2 then takes chopstick 0 before chopstick 2.'],
    solution: philSol, wrong: [philStart, philRight],
    why: 'One global order for the locks rules out a circular wait: whoever holds the highest chopstick it needs can always finish.' });

  C.exercise({ id: 'cls-x-chandy', chapter: 'cls-table', title: 'Clean or dirty', level: 2, kind: 'choice',
    text: ['In the clean-and-dirty-fork scheme, each fork is held by one of its two neighbours and is either clean or dirty. A hungry philosopher asks its neighbour for a fork it lacks. The neighbour holds that fork. When must it hand the fork over?'],
    options: ['When the fork is dirty: it cleans it and passes it on, unless it is eating', 'Only when the fork is clean', 'Always, at once', 'Never while it is hungry'],
    answer: 0, whyNot: { 1: 'A clean fork has not been used since it was handed over: its holder keeps it to eat.', 2: 'Then two hungry neighbours could pass a fork back and forth for ever.', 3: 'A hungry philosopher still gives up a dirty fork: that is what lets a neighbour who waited longer eat first.' },
    hints: ['Eating makes both forks dirty.', 'A clean fork means "I received this and have not eaten with it yet".', 'A dirty fork is handed over (cleaned) when asked, unless its holder is eating right now; a clean fork is kept. Starting with every fork dirty and held by the lower-numbered neighbour, the precedence order has no cycle, so nobody deadlocks or starves.'],
    solution: 0, wrong: [2, 1] });

  {
    const x = trace({ id: 'cls-x-sem-barber', chapter: 'cls-table', title: 'Trace the barber', level: 2, kind: 'semaphore-trace',
      sems: [{ id: 'arrivals', init: 0 }, { id: 'call_next', init: 0 }],
      threads: [{ name: 'B', prog: ['wait arrivals', 'post call_next', 'work', 'wait arrivals', 'post call_next', 'work'] }, { name: 'C1', prog: ['post arrivals', 'wait call_next', 'work'] }, { name: 'C2', prog: ['post arrivals', 'wait call_next', 'work'] }],
      schedule: ['B', 'C1', 'C1', 'B', 'B', 'C2', 'C1', 'B', 'C2', 'B', 'C2', 'B'] });
    const R = x.rows;
    Object.assign(x, {
      text: ['A barber shop with two semaphores, both starting at 0: `arrivals` counts seated customers the barber has not yet seen, and `call_next` calls one of them to the chair. (The seats, free_seats and seat_lock are left out here.)', { code: 'B:   wait arrivals; post call_next; cut hair      (twice)\nC1:  post arrivals; wait call_next; get a haircut\nC2:  post arrivals; wait call_next; get a haircut', lang: 'text' }, 'Follow the schedule below (cut hair and get a haircut are *work* steps). After each step write both values and who is blocked.'],
      hints: ['The barber naps first: `arrivals` is 0 at step 1.', 'C1\'s post at step 2 wakes the barber, so `arrivals` stays 0; C2\'s post at step 6 finds the barber busy, so `arrivals` becomes 1.', 'arrivals: ' + vals(R, 'arrivals') + '; call_next: ' + vals(R, 'call_next') + '. Blocked: B after step 1, C1 after step 3, C2 after step 9.'],
      wrong: [Object.assign({}, x.solution, { '2|arrivals': '1' }), Object.assign({}, x.solution, { '6|arrivals': '0' })],
    });
    delete x.rows;
    C.exercise(x);
  }

  C.exercise({ id: 'cls-x-smokers', chapter: 'cls-table', title: 'Why the smokers get stuck', level: 2, kind: 'choice',
    text: ['An agent puts two of three ingredients on the table by posting two semaphores, say `paper` and `matches`. Each smoker already has one ingredient and grabs the other two with two `sem_wait`s, in a fixed order. Why can the smokers get stuck?'],
    options: ['Two smokers can each grab one of the two ingredients, and then neither can get its second', 'The agent posts too many ingredients', 'The smokers do not use a mutex for the table', 'Only one smoker exists for each pair'],
    answer: 0, whyNot: { 1: 'The agent posts exactly two, then waits for a smoke.', 2: 'A mutex round the grabbing would not help: a smoker would sleep holding it.', 3: 'There is exactly one right smoker for each pair; the trouble is that the wrong ones grab first.' },
    hints: ['With paper and matches on the table, the smoker who needs exactly those should get both.', 'But the smoker with tobacco is not the only one waiting on `paper` or on `matches`.', 'One smoker takes the paper, another the matches, and each waits for an ingredient that will never come; the agent waits for a smoke. The fix adds a helper thread per ingredient: the helpers note what has landed on the table and wake only the smoker who can use the pair.'],
    solution: 0, wrong: [2, 1] });

  {
    const x = trace({ id: 'cls-x-sem-meet', chapter: 'cls-table', title: 'Meet at the gate', level: 1, kind: 'semaphore-trace',
      sems: [{ id: 'aHere', init: 0 }, { id: 'bHere', init: 0 }],
      threads: [{ name: 'A', prog: ['post aHere', 'wait bHere', 'work'] }, { name: 'B', prog: ['post bHere', 'wait aHere', 'work'] }],
      schedule: ['A', 'A', 'B', 'B', 'A', 'B'] });
    const R = x.rows;
    Object.assign(x, {
      text: ['Two hikers must both reach the gate before either goes through: a barrier for two. Each announces its arrival, then waits for the other\'s announcement. Both semaphores start at 0.', { code: 'A:  post aHere; wait bHere; go through\nB:  post bHere; wait aHere; go through', lang: 'text' }, 'Follow the schedule below. After each step write both values and who is blocked.'],
      hints: ['A posts first: nobody waits on `aHere`, so it becomes 1.', 'A\'s wait on `bHere` at step 2 finds 0 and blocks; B\'s post at step 3 wakes A.', 'aHere: ' + vals(R, 'aHere') + '; bHere: ' + vals(R, 'bHere') + '. Only A is blocked, after step 2.'],
      wrong: [Object.assign({}, x.solution, { '3|bHere': '1' }), Object.assign({}, x.solution, { '4|aHere': '1' })],
    });
    delete x.rows;
    C.exercise(x);
  }

  const barStart = c`#include <stdio.h>
#include <assert.h>
#include <pthread.h>
#include <semaphore.h>

#define N 3

int arrived = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
sem_t gate;

int checked_in[N];

void barrier_init(void) {
    sem_init(&gate, 0, 0);
}

void barrier_wait(void) {
    /* every thread waits here until all N have arrived */
}

void *hiker(void *arg) {
    int i = (int)(long)arg;
    checked_in[i] = 1;
    barrier_wait();
    for (int j = 0; j < N; j++)
        assert(checked_in[j] == 1);
    return NULL;
}

int main(void) {
    pthread_t t[N];
    barrier_init();
    for (int i = 0; i < N; i++)
        pthread_create(&t[i], NULL, hiker, (void *)(long)i);
    for (int i = 0; i < N; i++)
        pthread_join(t[i], NULL);
    printf("all %d set off together\n", N);
    return 0;
}
`;
  const barBody = '    /* every thread waits here until all N have arrived */\n';
  const barSol = swap(barStart, barBody, '    pthread_mutex_lock(&m);\n    arrived++;\n    int last = (arrived == N);\n    pthread_mutex_unlock(&m);\n    if (last)\n        for (int k = 0; k < N; k++)\n            sem_post(&gate);\n    sem_wait(&gate);\n');
  const barRacy = swap(barStart, barBody, '    arrived++;\n    if (arrived == N)\n        for (int k = 0; k < N; k++)\n            sem_post(&gate);\n    sem_wait(&gate);\n');
  const barShut = swap(barStart, barBody, '    pthread_mutex_lock(&m);\n    arrived++;\n    int last = (arrived == N);\n    pthread_mutex_unlock(&m);\n    if (last)\n        sem_post(&gate);\n    sem_wait(&gate);\n');
  C.exercise({ id: 'cls-x-barrier-code', chapter: 'cls-table', title: 'Write a barrier', level: 3, kind: 'code', granularity: 'machine',
    text: ['Three hikers check in, then must wait until all three have checked in before anyone sets off. Each one asserts, after the barrier, that every hiker has checked in.', 'Write `barrier_wait` with the mutex `m`, the counter `arrived` and the semaphore `gate` (it starts at 0). The barrier is used once. Random schedules test it, and the model checker searches the schedules with one preemption for a deadlock or a failed assertion, taking `arrived++` as the separate load, add and store it is.', { warn: C.macSem }],
    starter: barStart,
    tests: [{ name: 'three hikers', stdout: 'all 3 set off together\n', seeds: [1, 2, 3, 4, 5, 6] }],
    mc: { deadlock: true, preemptions: 1, maxStates: 3000 },
    hints: ['Count the arrivals under the mutex, so no arrival is lost. The thread that makes the count reach N is the last.', 'The last one opens the gate for everyone. Everyone, the last one included, waits on the gate once, so the gate needs one post per hiker.', 'Lock, `arrived++; int last = (arrived == N);`, unlock; then `if (last) for (int k = 0; k < N; k++) sem_post(&gate);` and `sem_wait(&gate);`.'],
    solution: barSol, wrong: [barStart, barRacy, barShut],
    why: 'The count is protected by the mutex, and the last arrival posts the gate once for each of the N waits, so all N go through.' });

  // the length of the failing schedule, as the classic-crew topic finds it
  const crewSteps = (() => { const t = S.byId && S.byId('classic-crew'); const f = t ? t.run(S.inputOf(t, { variant: 'early-release' })).frames : []; for (const x of f) { const m = /has (\d+) steps/.exec(x.say || ''); if (m) return m[1]; } return 'a long'; })();
  C.exercise({ id: 'cls-x-crew', chapter: 'cls-table', title: 'Crews in threes', level: 3, kind: 'choice',
    text: ['Rowers and coxes reach the dock one at a time. Each takes the `dock` semaphore and signs in; the one who completes a crew (two rowers and one cox) posts `call_rower` twice and `call_cox` once, and the others post `dock` and wait to be called. In the hurried version the one who completes a crew also posts `dock` at once, before the three have boarded. What can go wrong?'],
    options: ['The next crew is called while this one is still boarding, so people of two crews board the same boat', 'Someone boards twice', 'Three rowers form a crew', 'The program deadlocks'],
    answer: 0, whyNot: { 1: 'Each person is called once and boards once.', 2: 'Each crew still gets exactly two rower calls and one cox call.', 3: 'Every wait has a matching post; the trouble is the order of the boardings.' },
    hints: ['A called person boards after it passes its wait, which takes time.', 'With `dock` free, the next arrivals can sign in, complete a second crew and post the calls too.', 'A person of the second crew can board among the first: the checker breaks "each boat takes two rowers and one cox" in a ' + crewSteps + '-step schedule. The fix: keep `dock` until the last of the three is aboard, and let that last one post it.'],
    solution: 0, wrong: [3, 2] });

  // =========================================================================================================
  // Chapter 4: concurrency bugs and event loops
  // =========================================================================================================
  C.exercise({ id: 'cls-x-bug-kind', chapter: 'cls-bugs', title: 'Name the bug', level: 1, kind: 'choice',
    text: ['A logging thread does `if (logfile != NULL) fputs(line, logfile);` while another thread may set `logfile = NULL` when it closes the log. The programmer meant the test and the write to happen together. What kind of bug is this?'],
    options: ['An atomicity violation', 'An order violation', 'A deadlock', 'A lost wake-up'],
    answer: 0, whyNot: { 1: 'An order violation assumes one action happens before another; here two steps were meant to be indivisible.', 2: 'Nothing here waits for a lock.', 3: 'Nobody sleeps on a condition here.' },
    hints: ['Two steps, a check and a use, were meant to be one.', 'Another thread can run between them.', 'An atomicity violation: the closer can set `logfile` to NULL after the check and before the write. Hold one lock across the check and the use, and take it in the closer too.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'cls-x-out-volume', chapter: 'cls-bugs', title: 'Set up too late', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['main starts a player thread and only then sets the volume. Write every output this program can produce, one a line.'],
    src: c`#include <stdio.h>
#include <pthread.h>

int volume = 0;

void *player(void *arg) {
    printf("volume %d\n", volume);
    return NULL;
}

int main(void) {
    pthread_t t;
    pthread_create(&t, NULL, player, NULL);
    volume = 7;
    pthread_join(t, NULL);
    return 0;
}`,
    hints: ['After `pthread_create`, either thread may run first.', 'If the player prints before main\'s assignment, it sees the old value.', 'Two outputs: "volume 0" and "volume 7". The program assumes main sets the volume first, and nothing enforces it: an order violation.'],
    solution: ['volume 0', 'volume 7'], wrong: [['volume 7'], ['volume 0', 'volume 7', 'volume 70']],
    why: 'Run on a real machine, "volume 7" comes up most of the time; that is what makes order violations hard to catch by testing.' });

  C.exercise({ id: 'cls-x-out-cake', chapter: 'cls-bugs', title: 'Bake, then ice', level: 2, kind: 'fork-outputs', ask: 'count',
    text: ['Three threads: the oven prints `bake` and posts `baked`; the icer waits on `baked` and prints `ice`; the kettle prints `tea`. How many different outputs can this program produce?', { warn: C.macSem }],
    src: c`#include <stdio.h>
#include <pthread.h>
#include <semaphore.h>

sem_t baked;

void *oven(void *arg) {
    printf("bake\n");
    sem_post(&baked);
    return NULL;
}

void *icer(void *arg) {
    sem_wait(&baked);
    printf("ice\n");
    return NULL;
}

void *kettle(void *arg) {
    printf("tea\n");
    return NULL;
}

int main(void) {
    pthread_t a, b, c;
    sem_init(&baked, 0, 0);
    pthread_create(&b, NULL, icer, NULL);
    pthread_create(&a, NULL, oven, NULL);
    pthread_create(&c, NULL, kettle, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    pthread_join(c, NULL);
    return 0;
}`,
    hints: ['Three lines can come in 3! = 6 orders.', 'The semaphore forces `bake` before `ice`; `tea` can go anywhere.', '3 outputs: bake ice tea, bake tea ice, tea bake ice. The semaphore enforces exactly the one order the program needs.'],
    solution: '3', wrong: ['6', '2'] });

  C.exercise({ id: 'cls-x-lock-graph', chapter: 'cls-bugs', title: 'Three locks in a ring', level: 1, kind: 'graph-cycle',
    text: ['Four threads and three mutexes. T0 holds A and waits for B; T1 holds B and waits for C; T2 holds C and waits for A; T3 holds nothing and waits for B. Click the nodes on a cycle, or answer none.'],
    graph: { procs: ['T2', 'T0', 'T1', 'T3'], res: [{ name: 'A', units: 1 }, { name: 'B', units: 1 }, { name: 'C', units: 1 }], hold: [[1, 0], [2, 1], [0, 2]], want: [[1, 1], [2, 2], [0, 0], [3, 1]] },
    hints: ['Follow the waits: T0 waits for B, held by T1…', 'T3 waits on the cycle, but nothing it holds is part of it.', 'T0 → B → T1 → C → T2 → A → T0. T3 is stuck behind the deadlock without being in it. Taking the locks in one order (A, then B, then C) would make this cycle impossible.'],
    solution: 'T0, B, T1, C, T2, A', wrong: ['T3, B, T1', 'none'] });

  const seatStart = c`#include <stdio.h>
#include <assert.h>
#include <pthread.h>

int seats_left = 1;
int sold = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;

void *agent(void *arg) {
    if (seats_left > 0) {
        seats_left--;
        sold++;
    }
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, agent, NULL);
    pthread_create(&b, NULL, agent, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    assert(sold <= 1);
    printf("sold %d, left %d\n", sold, seats_left);
    return 0;
}
`;
  const seatBody = '    if (seats_left > 0) {\n        seats_left--;\n        sold++;\n    }\n';
  const seatSol = swap(seatStart, seatBody, '    pthread_mutex_lock(&m);\n' + seatBody + '    pthread_mutex_unlock(&m);\n');
  const seatInner = swap(seatStart, seatBody, '    if (seats_left > 0) {\n        pthread_mutex_lock(&m);\n        seats_left--;\n        sold++;\n        pthread_mutex_unlock(&m);\n    }\n');
  C.exercise({ id: 'cls-x-seat-code', chapter: 'cls-bugs', title: 'The last seat, sold twice', level: 2, kind: 'code', granularity: 'machine',
    text: ['Two booking agents run at once, and one seat is left. Each checks that a seat is free, then takes it. Sometimes both sell it, and the `assert` in main fails.', 'Fix the atomicity violation with the mutex `m`, so that exactly one agent sells the seat under every schedule.'],
    starter: seatStart,
    tests: [{ name: 'two agents, one seat', stdout: 'sold 1, left 0\n', seeds: [1, 2, 3, 4] }],
    mc: { deadlock: true, preemptions: 2, maxStates: 3000 },
    hints: ['Both agents can pass the test `seats_left > 0` before either takes the seat.', 'The lock must cover the test as well as the update, or the test can be stale by the time the update runs.', 'Lock `m` before the `if` and unlock after its closing brace, so the check and the sale are one step.'],
    solution: seatSol, wrong: [seatStart, seatInner],
    why: 'A check and the action that relies on it must sit under one lock.' });

  const wakeStart = c`#include <stdio.h>
#include <pthread.h>

int ready = 0;
int answer = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t done = PTHREAD_COND_INITIALIZER;

void *solver(void *arg) {
    answer = 42;
    pthread_mutex_lock(&m);
    ready = 1;
    pthread_cond_signal(&done);
    pthread_mutex_unlock(&m);
    return NULL;
}

int main(void) {
    pthread_t s;
    pthread_create(&s, NULL, solver, NULL);
    if (!ready) {
        pthread_mutex_lock(&m);
        pthread_cond_wait(&done, &m);
        pthread_mutex_unlock(&m);
    }
    printf("answer %d\n", answer);
    pthread_join(s, NULL);
    return 0;
}
`;
  const wakeBody = '    if (!ready) {\n        pthread_mutex_lock(&m);\n        pthread_cond_wait(&done, &m);\n        pthread_mutex_unlock(&m);\n    }\n';
  const wakeSol = swap(wakeStart, wakeBody, '    pthread_mutex_lock(&m);\n    while (!ready)\n        pthread_cond_wait(&done, &m);\n    pthread_mutex_unlock(&m);\n');
  const wakeAlways = swap(wakeStart, wakeBody, '    pthread_mutex_lock(&m);\n    pthread_cond_wait(&done, &m);\n    pthread_mutex_unlock(&m);\n');
  C.exercise({ id: 'cls-x-wakeup-code', chapter: 'cls-bugs', title: 'Fix the lost wake-up', level: 2, kind: 'code',
    text: ['main waits for a solver thread to post its answer. It tests `ready` before it takes the lock, so the solver can set `ready` and signal in between, while nobody is waiting yet. The signal is lost and main sleeps for ever.', 'Fix main so that it never misses the signal and never waits when the answer is already there.'],
    starter: wakeStart,
    tests: [{ name: 'the answer arrives', stdout: 'answer 42\n', seeds: [1, 2, 3, 4, 5, 6] }],
    mc: { deadlock: true, preemptions: 2, maxStates: 3000 },
    hints: ['A condition variable keeps no memory of a signal sent while nobody waits.', 'The test of `ready` and the wait must both happen while main holds the mutex the solver needs to change `ready`.', 'Take the lock first, then `while (!ready) pthread_cond_wait(&done, &m);`, then unlock.'],
    solution: wakeSol, wrong: [wakeStart, wakeAlways],
    why: 'Under the lock, the solver cannot change `ready` between main\'s test and its wait; the loop covers spurious and stolen wake-ups.' });

  // ---- the event loop -------------------------------------------------------------------------------------------
  {
    const R = [{ name: 'P', at: 0, cpu: 1, io: 4, cpu2: 1 }, { name: 'Q', at: 1, cpu: 2, io: 3, cpu2: 1 }, { name: 'R', at: 2, cpu: 1, io: 5, cpu2: 1 }];
    const L = S.P08.events(R, 'loop', { sw: 1, stack: 64 }), T = S.P08.events(R, 'threads', { sw: 1, stack: 64 });
    const reqTable = { table: [['Request', 'Arrives (ms)', 'CPU (ms)', 'I/O (ms)', 'CPU again (ms)'], ...R.map((r) => [r.name, String(r.at), String(r.cpu), String(r.io), String(r.cpu2)])] };
    const cells = Object.fromEntries(R.map((r) => [r.name + '|answered at', L.done[r.name]]));
    const sol = Object.fromEntries(R.map((r) => [r.name + '|answered at', String(L.done[r.name])]));
    const order = L.trace.map((t) => (t.ev === 'request' ? 'request ' : 'I/O done ') + t.job + ' at ' + t.t).join(', ');
    C.exercise({ id: 'cls-x-ev-table', chapter: 'cls-bugs', title: 'One loop, three requests', level: 3, kind: 'table',
      text: ['A server runs one thread round an event loop on one core. Each request arrives, needs some CPU to parse it and start its I/O (without waiting), then, when its I/O completes, a little more CPU to answer. Events are queued in the order they happen; ties go to arrivals first.', reqTable, 'At what time is each request answered?'],
      rows: R.map((r) => r.name), cols: ['answered at'], corner: 'request', cells, cellKind: 'number',
      hints: ['The loop runs one handler at a time and never waits for I/O: P\'s parse runs from 0 to 1, Q\'s from 1 to 3.', 'An I/O completion is an event like an arrival: it waits in the queue until the loop is free.', 'The loop takes ' + order + '; the answers end at P ' + L.done.P + ', Q ' + L.done.Q + ', R ' + L.done.R + ' ms.'],
      solution: sol, wrong: [Object.assign({}, sol, { 'R|answered at': String(L.done.R + 1) }), Object.fromEntries(R.map((r) => [r.name + '|answered at', String(r.at + r.cpu + r.io + r.cpu2)]))] });

    const mean = Math.round(T.mean * 100) / 100;
    C.exercise({ id: 'cls-x-ev-mean', chapter: 'cls-bugs', title: 'A thread per request', level: 3, kind: 'number',
      text: ['The same three requests are served instead by a thread per request, on one core: a thread runs its CPU burst to the end, then blocks on its I/O; ready threads run first come, first served, and switching between threads costs 1 ms.', reqTable, 'What is the mean response time, from arrival to answer, in ms? Give two decimals.'],
      answer: mean, tolerance: 0.006,
      whyNot: { [D2(L.mean)]: 'That is the event loop\'s mean, with no switches to pay for.', '*': 'Lay the work out on one time line: a 1 ms switch each time the core moves to another thread.' },
      hints: ['P parses from 0 to 1 and starts its I/O; a switch to Q costs 1 ms, so Q parses from 2 to 4.', 'Then a switch and R parses; each answer also costs a switch when another thread ran last.', 'The answers come at P ' + T.done.P + ', Q ' + T.done.Q + ', R ' + T.done.R + ' ms, so the responses are ' + R.map((r) => T.done[r.name] - r.at).join(', ') + ' and the mean is ' + D2(T.mean) + ' ms, against ' + D2(L.mean) + ' for the event loop.'],
      solution: mean, wrong: [Math.round(L.mean * 100) / 100, 9] });
  }

  C.exercise({ id: 'cls-x-ev-block', chapter: 'cls-bugs', title: 'One handler too many', level: 1, kind: 'choice',
    text: ['In an event-loop server, one handler calls a blocking `read` on a slow disk file instead of starting the read asynchronously. What happens to the other requests?'],
    options: ['They all wait: the loop\'s only thread is stuck in that handler', 'They go on: the kernel runs the other handlers meanwhile', 'Only requests for the same file wait', 'Nothing changes: reads are quick'],
    answer: 0, whyNot: { 1: 'There is no other thread to run them: the loop is the server.', 2: 'The loop cannot take any event while one handler is blocked.', 3: 'A slow disk read can take milliseconds, thousands of times longer than a handler should.' },
    hints: ['How many threads does the server have?', 'The next event is taken only when the current handler returns.', 'The whole server stalls until the read returns. Every handler must be short and must start its I/O without waiting for it; the completion comes back as an event.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
