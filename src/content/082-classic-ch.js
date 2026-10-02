// Part 8, classic problems and concurrency bugs: the challenges, the guided tour, the course, and the pages the diagram
// checker looks at. Each challenge is scored by hidden tests: every test's main is appended to the reader's code; the
// model checker searches its schedules up to a few preemptions, then seeded random schedules on the simulated kernel
// must all finish with the expected output. The reader-writer lock's fairness tests carry an "eventually" property
// (a spec row): the checker searches every schedule for a cycle in which the surveyor, or the clerk, never gets in.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('cls-ch-rwlock')) return;
  const c = String.raw;

  // ---- 1. a reader-writer lock that starves nobody -----------------------------------------------------------------
  const rwStarter = c`#include <pthread.h>
#include <semaphore.h>

void rw_init(void) {
}

void read_lock(void) {
}

void read_unlock(void) {
}

void write_lock(void) {
}

void write_unlock(void) {
}
`;
  const rwFair = c`#include <pthread.h>
#include <semaphore.h>

sem_t line, room, count_lock;
int readers = 0;

void rw_init(void) {
    sem_init(&line, 0, 1);
    sem_init(&room, 0, 1);
    sem_init(&count_lock, 0, 1);
}

void read_lock(void) {
    sem_wait(&line);
    sem_wait(&count_lock);
    readers = readers + 1;
    if (readers == 1)
        sem_wait(&room);
    sem_post(&count_lock);
    sem_post(&line);
}

void read_unlock(void) {
    sem_wait(&count_lock);
    readers = readers - 1;
    if (readers == 0)
        sem_post(&room);
    sem_post(&count_lock);
}

void write_lock(void) {
    sem_wait(&line);
    sem_wait(&room);
    sem_post(&line);
}

void write_unlock(void) {
    sem_post(&room);
}
`;
  const rwReaders = c`#include <pthread.h>
#include <semaphore.h>

sem_t room, count_lock;
int readers = 0;

void rw_init(void) {
    sem_init(&room, 0, 1);
    sem_init(&count_lock, 0, 1);
}

void read_lock(void) {
    sem_wait(&count_lock);
    readers = readers + 1;
    if (readers == 1)
        sem_wait(&room);
    sem_post(&count_lock);
}

void read_unlock(void) {
    sem_wait(&count_lock);
    readers = readers - 1;
    if (readers == 0)
        sem_post(&room);
    sem_post(&count_lock);
}

void write_lock(void) {
    sem_wait(&room);
}

void write_unlock(void) {
    sem_post(&room);
}
`;
  const rwWriters = c`#include <pthread.h>
#include <semaphore.h>

sem_t door, room, count_lock, wcount_lock;
int readers = 0, writers = 0;

void rw_init(void) {
    sem_init(&door, 0, 1);
    sem_init(&room, 0, 1);
    sem_init(&count_lock, 0, 1);
    sem_init(&wcount_lock, 0, 1);
}

void read_lock(void) {
    sem_wait(&door);
    sem_wait(&count_lock);
    readers = readers + 1;
    if (readers == 1)
        sem_wait(&room);
    sem_post(&count_lock);
    sem_post(&door);
}

void read_unlock(void) {
    sem_wait(&count_lock);
    readers = readers - 1;
    if (readers == 0)
        sem_post(&room);
    sem_post(&count_lock);
}

void write_lock(void) {
    sem_wait(&wcount_lock);
    writers = writers + 1;
    if (writers == 1)
        sem_wait(&door);
    sem_post(&wcount_lock);
    sem_wait(&room);
}

void write_unlock(void) {
    sem_post(&room);
    sem_wait(&wcount_lock);
    writers = writers - 1;
    if (writers == 0)
        sem_post(&door);
    sem_post(&wcount_lock);
}
`;
  const rwMutex = c`#include <pthread.h>

pthread_mutex_t whole = PTHREAD_MUTEX_INITIALIZER;

void rw_init(void) {
}

void read_lock(void) {
    pthread_mutex_lock(&whole);
}

void read_unlock(void) {
    pthread_mutex_unlock(&whole);
}

void write_lock(void) {
    pthread_mutex_lock(&whole);
}

void write_unlock(void) {
    pthread_mutex_unlock(&whole);
}
`;
  C.challenge({ id: 'cls-ch-rwlock', n: 81, title: 'The archive that turns nobody away', level: 3, kind: 'sync-solution',
    story: 'A town archive keeps its land register on one shelf. Clerks come in all day to read entries, and now and then a surveyor arrives to change one. Any number of clerks may read at once, but a surveyor must have the shelf to himself, with no clerk reading over his shoulder.\n\nLast spring the archive used a lock that let clerks in whenever another clerk was reading. On busy days the surveyors stood at the door until closing. This year the archive wants a lock that lets clerks share the shelf, keeps surveyors alone at it, and never lets one side keep the other waiting for ever.\n\nWrite `rw_init`, `read_lock`, `read_unlock`, `write_lock` and `write_unlock` with semaphores or mutexes and condition variables.\n\n' + C.macSem,
    task: 'Write the five functions of a reader–writer lock: readers share, a writer is alone, and neither a stream of readers nor a stream of writers can keep the other side out for ever.',
    metricName: 'tests passed', target: 4, marks: { gold: 4 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield'], maxLines: 70, noMain: true },
    starter: rwStarter,
    tests: [
      { name: 'a writer alone', visible: true, expect: 'safe\n', preemptions: 1, main: c`#include <stdio.h>
#include <assert.h>
int nr = 0, nw = 0;
pthread_mutex_t tm = PTHREAD_MUTEX_INITIALIZER;
void *reader(void *arg) {
    read_lock();
    pthread_mutex_lock(&tm);
    nr = nr + 1;
    assert(nw == 0);
    pthread_mutex_unlock(&tm);
    pthread_mutex_lock(&tm);
    nr = nr - 1;
    pthread_mutex_unlock(&tm);
    read_unlock();
    return NULL;
}
void *writer(void *arg) {
    write_lock();
    pthread_mutex_lock(&tm);
    nw = nw + 1;
    assert(nw == 1 && nr == 0);
    pthread_mutex_unlock(&tm);
    pthread_mutex_lock(&tm);
    nw = nw - 1;
    pthread_mutex_unlock(&tm);
    write_unlock();
    return NULL;
}
int main(void) {
    rw_init();
    pthread_t a, b;
    pthread_create(&a, NULL, reader, NULL);
    pthread_create(&b, NULL, writer, NULL);
    reader(NULL);
    writer(NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("safe\n");
    return 0;
}
` },
      { name: 'clerks share the shelf', expect: 'both read\n', preemptions: 1, main: c`#include <stdio.h>
#include <semaphore.h>
int together = 0;
pthread_mutex_t tm = PTHREAD_MUTEX_INITIALIZER;
sem_t both;
void *reader(void *arg) {
    read_lock();
    pthread_mutex_lock(&tm);
    together = together + 1;
    if (together == 2)
        sem_post(&both);
    pthread_mutex_unlock(&tm);
    sem_wait(&both);
    sem_post(&both);
    read_unlock();
    return NULL;
}
int main(void) {
    rw_init();
    sem_init(&both, 0, 0);
    pthread_t a;
    pthread_create(&a, NULL, reader, NULL);
    reader(NULL);
    pthread_join(a, NULL);
    printf("both read\n");
    return 0;
}
` },
      { name: 'a surveyor on a busy day', expect: 'the writer got in\n', spec: [{ kind: 'live', what: 'survey calls write_shelf' }], main: c`#include <stdio.h>
int wdone = 0;
void read_shelf(void) {
}
void write_shelf(void) {
}
void *clerk(void *arg) {
    while (!wdone) {
        read_lock();
        read_shelf();
        read_unlock();
    }
    return NULL;
}
void *survey(void *arg) {
    write_lock();
    write_shelf();
    wdone = 1;
    write_unlock();
    return NULL;
}
int main(void) {
    rw_init();
    pthread_t a, b, w;
    pthread_create(&a, NULL, clerk, NULL);
    pthread_create(&b, NULL, clerk, NULL);
    pthread_create(&w, NULL, survey, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    pthread_join(w, NULL);
    printf("the writer got in\n");
    return 0;
}
` },
      { name: 'a clerk among surveyors', expect: 'the reader got in\n', spec: [{ kind: 'live', what: 'look calls read_shelf' }], main: c`#include <stdio.h>
int rdone = 0;
void read_shelf(void) {
}
void write_shelf(void) {
}
void *surveyor(void *arg) {
    while (!rdone) {
        write_lock();
        write_shelf();
        write_unlock();
    }
    return NULL;
}
void *look(void *arg) {
    read_lock();
    read_shelf();
    rdone = 1;
    read_unlock();
    return NULL;
}
int main(void) {
    rw_init();
    pthread_t a, b, r;
    pthread_create(&a, NULL, surveyor, NULL);
    pthread_create(&b, NULL, surveyor, NULL);
    pthread_create(&r, NULL, look, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    pthread_join(r, NULL);
    printf("the reader got in\n");
    return 0;
}
` },
    ],
    hints: ['Start from the reader-preferring lock: a reader count under its own mutex, and a `room` semaphore that the first reader in takes and the last one out gives back. That passes the first two tests.', 'Readers first starves surveyors; writers first starves clerks. Put one more semaphore, `line`, in front of everything, so that everyone queues in arrival order.', 'A reader does `sem_wait(&line)` before its usual entry and `sem_post(&line)` after it. A writer does `sem_wait(&line); sem_wait(&room); sem_post(&line);`, keeping its place at the head of the line while it waits, so later readers queue behind it. Unlocking is unchanged.'],
    solution: { src: rwFair }, wrong: [{ src: rwReaders }, { src: rwWriters }, { src: rwMutex }] });

  // ---- 2. a barrier for every round ------------------------------------------------------------------------------
  const barStarter = c`#include <pthread.h>
#include <semaphore.h>

void barrier_init(int n) {
}

void barrier_wait(void) {
}
`;
  const barTwo = c`#include <pthread.h>
#include <semaphore.h>

int size, count = 0, round_no = 0;
sem_t count_lock, gate_even, gate_odd;

void barrier_init(int n) {
    size = n;
    sem_init(&count_lock, 0, 1);
    sem_init(&gate_even, 0, 0);
    sem_init(&gate_odd, 0, 0);
}

void barrier_wait(void) {
    sem_wait(&count_lock);
    int odd = round_no % 2;          /* this round's gate: even rounds use gate_even */
    count = count + 1;
    if (count == size) {
        /* the last to arrive: reset, open this round's gate for the others, go on */
        count = 0;
        round_no = round_no + 1;
        for (int i = 0; i < size - 1; i++)
            sem_post(odd ? &gate_odd : &gate_even);
        sem_post(&count_lock);
        return;
    }
    sem_post(&count_lock);
    sem_wait(odd ? &gate_odd : &gate_even);
}
`;
  const barOnce = c`#include <pthread.h>
#include <semaphore.h>

int size, count = 0;
pthread_mutex_t bm = PTHREAD_MUTEX_INITIALIZER;
sem_t gate;

void barrier_init(int n) {
    size = n;
    sem_init(&gate, 0, 0);
}

void barrier_wait(void) {
    pthread_mutex_lock(&bm);
    count = count + 1;
    if (count == size)
        sem_post(&gate);
    pthread_mutex_unlock(&bm);
    sem_wait(&gate);
    sem_post(&gate);
}
`;
  const barTokens = c`#include <pthread.h>
#include <semaphore.h>

int size, count = 0;
pthread_mutex_t bm = PTHREAD_MUTEX_INITIALIZER;
sem_t gate;

void barrier_init(int n) {
    size = n;
    sem_init(&gate, 0, 0);
}

void barrier_wait(void) {
    pthread_mutex_lock(&bm);
    count = count + 1;
    if (count == size) {
        count = 0;
        for (int i = 0; i < size; i++)
            sem_post(&gate);
    }
    pthread_mutex_unlock(&bm);
    sem_wait(&gate);
}
`;
  const walkers = (t, rounds) => c`#include <stdio.h>
#include <assert.h>
#define T ` + t + c`
#define ROUNDS ` + rounds + c`
int reached[ROUNDS];
pthread_mutex_t tm = PTHREAD_MUTEX_INITIALIZER;
void *walker(void *arg) {
    for (int r = 0; r < ROUNDS; r++) {
        pthread_mutex_lock(&tm);
        reached[r] = reached[r] + 1;
        pthread_mutex_unlock(&tm);
        barrier_wait();
        assert(reached[r] == T);
    }
    return NULL;
}
int main(void) {
    pthread_t w[T];
    barrier_init(T);
    for (int i = 1; i < T; i++)
        pthread_create(&w[i], NULL, walker, NULL);
    walker(NULL);
    for (int i = 1; i < T; i++)
        pthread_join(w[i], NULL);
    printf("done\n");
    return 0;
}
`;
  C.challenge({ id: 'cls-ch-barrier', n: 82, title: 'The rope team', level: 3, kind: 'sync-solution',
    story: 'A team of climbers roped together crosses a glacier in stages. At the end of each stage everyone stops at a marker, and nobody sets off on the next stage until the whole team has reached the marker. Then they all go on together, stage after stage.\n\nThe team\'s planning program runs one thread per climber, and it needs a barrier that works not once but at every marker. A climber who reaches the next marker early must not slip through it while the slower ones are still on the stage before.\n\nWrite `barrier_init(n)` and `barrier_wait()` with a mutex and semaphores (or condition variables).\n\n' + C.macSem,
    task: 'Write a reusable barrier: `barrier_init(int n)` sets it up for n threads, and `barrier_wait()` returns only when all n have called it in this round, round after round.',
    metricName: 'tests passed', target: 3, marks: { gold: 3 },
    limits: { forbid: ['sleep', 'usleep', 'sched_yield', 'pthread_barrier_wait'], maxLines: 60, noMain: true },
    starter: barStarter,
    tests: [
      { name: 'two climbers, two stages', visible: true, expect: 'done\n', preemptions: 2, main: walkers(2, 2) },
      { name: 'three climbers, two stages', expect: 'done\n', preemptions: 1, main: walkers(3, 2) },
      { name: 'two climbers, three stages', expect: 'done\n', preemptions: 1, main: walkers(2, 3) },
    ],
    hints: ['Count the arrivals under a lock; the last one in opens a gate for the others, who wait on it. That works for one stage.', 'At the next marker a fast climber could slip through a gate still open from the last stage. Use two gates and let the stages take turns: even stages wait on one, odd stages on the other, so a fast climber meets the gate that is still shut.', 'Under `count_lock`, note this stage\'s gate (stage number even or odd) and count yourself in. The last one in resets the count, moves the stage number on, posts this stage\'s gate n − 1 times and goes on; everyone else releases the lock and waits on this stage\'s gate.'],
    solution: { src: barTwo }, wrong: [{ src: barOnce }, { src: barTokens }] });

  // ---- the guided tour -----------------------------------------------------------------------------------------
  C.tour({
    id: 'cls-tour', title: 'Tour: classic problems and concurrency bugs', blurb: 'The bounded buffer, readers and writers, the philosophers, barriers, real bugs and an event loop, in eight steps.',
    steps: [
      { route: 'part=classic', target: '#main', text: 'Part 8 of the catalogue: the classic synchronisation problems, the bugs that real concurrent programs have, and a server built without threads.' },
      { route: 'topic=classic-buffer-sem', target: '#stageWrap', text: 'A bounded buffer: empty counts free slots, full counts items, and a mutex guards the indices. Each step says which semaphore changed and who woke.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=classic-buffer-cv', target: '#inputs', text: 'Choose a version here: with if instead of while, the model checker finds a consumer that wakes to an empty slot, and replays the schedule.' },
      { route: 'topic=classic-rw-starve', target: '#stageWrap', text: 'Starvation made visible: the readers go round a cycle of states for ever while the writer never gets in.' },
      { route: 'topic=classic-phil-deadlock', target: '#stageWrap', text: 'Three philosophers, each holding one fork and waiting for the next: the circle of waits that a deadlock needs.' },
      { route: 'topic=classic-bug-deadlock', target: '#inputs', text: 'Two locks in opposite orders, and a wake-up signalled before anyone waits: two bugs, and their fixes beside them.' },
      { route: 'learn', target: '[data-chapter="cls-buffer"]', text: 'The lessons and exercises of this part start here: semaphore traces, wait-for graphs, and C programs to fix, checked over many schedules.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'cls-course', title: 'Classic problems and concurrency bugs', blurb: 'All fifteen topics of part 8, from the bounded buffer to the event loop, with lessons and exercises on the way.',
    steps: [
      { lesson: 'cls-buffer-sem', note: 'Three semaphores round a ring.' },
      { topic: 'classic-buffer-sem', note: 'Watch the slots fill and empty.' },
      { exercise: 'cls-x-sem-buf', note: 'Trace the semaphores by hand.' },
      { topic: 'classic-buffer-broken', note: 'No mutex, or the waits swapped.' },
      { exercise: 'cls-x-buf-code', note: 'Make the buffer correct.' },
      { topic: 'classic-buffer-cv', note: 'Condition variables, and why while.' },
      { exercise: 'cls-x-cv-code', note: 'Fix the clerk who woke too late.' },
      { lesson: 'cls-rw-room', note: 'A room readers share and writers do not.' },
      { topic: 'classic-rw', note: 'Readers first, writers first, fair.' },
      { topic: 'classic-rw-starve', note: 'Starvation as a cycle of states.' },
      { exercise: 'cls-x-rw-starve', note: 'Who can be kept out.' },
      { exercise: 'cls-x-rw-fair', note: 'A fair reader–writer lock.' },
      { lesson: 'cls-phil', note: 'The deadlock and three fixes.' },
      { topic: 'classic-phil-deadlock', note: 'Every philosopher holds one fork.' },
      { topic: 'classic-phil-fixes', note: 'Order, a waiter, or one seat fewer.' },
      { exercise: 'cls-x-phil-code', note: 'Philosophers who cannot deadlock.' },
      { topic: 'classic-chandy', note: 'Clean and dirty forks.' },
      { topic: 'classic-barber', note: 'The sleeping barber.' },
      { topic: 'classic-smokers', note: 'The cigarette smokers.' },
      { topic: 'classic-barrier', note: 'Barriers, and two gates for reuse.' },
      { exercise: 'cls-x-barrier-code', note: 'Write a barrier.' },
      { topic: 'classic-crew', note: 'Crewing the boats.' },
      { lesson: 'cls-violations', note: 'Atomicity and order violations.' },
      { topic: 'classic-bug-violations', note: 'Check, then use; set up, then use.' },
      { exercise: 'cls-x-seat-code', note: 'The last seat, sold once.' },
      { topic: 'classic-bug-deadlock', note: 'Lock order and the lost wake-up.' },
      { exercise: 'cls-x-wakeup-code', note: 'Fix the lost wake-up.' },
      { topic: 'classic-events', note: 'One loop, many requests.' },
      { exercise: 'cls-x-ev-table', note: 'Time an event loop by hand.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((x) => x.name === 'lesson cls-buffer-sem')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((ch) => ch.part === 'classic').flatMap((ch) => ch.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['cls-x-sem-buf', 'cls-x-out-slot', 'cls-x-buf-code', 'cls-x-cv-onecv', 'cls-x-rw-starve', 'cls-x-phil-ordered', 'cls-x-sem-barber', 'cls-x-out-cake', 'cls-x-ev-table', 'cls-x-ev-mean'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course cls-course', hash: 'course=cls-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['cls-ch-rwlock', 'cls-ch-barrier']) S.Checks.push({ group: 'learn', name: 'cls challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
