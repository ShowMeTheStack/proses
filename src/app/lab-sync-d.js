// The Sync lab, part four: its ready-made C programs, part one (races and locks, the bounded buffer, readers and
// writers, the dining philosophers). Each one is original, correct or broken on purpose, with its specification:
//   {id, fam, label, about, src, spec: [{kind, what}], gran, mode, expect, cat}
//   expect: what Check it finds ('ok', 'deadlock', 'assert', 'invariant' or 'starve'); cat: the ready-made program
//   of the step machine (S.Sync.catalog) that models the same thing
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const P = (SL.PROGS = SL.PROGS || []);
  const add = (x) => { P.push(x); return x; };
  SL.FAMILIES = [
    ['race', 'Races and locks'], ['buffer', 'The bounded buffer'], ['rw', 'Readers and writers'], ['phil', 'Dining philosophers'],
    ['more', 'More classic problems'], ['bugs', 'Concurrency bugs'], ['structs', 'Lock-based data structures'],
  ];
  const DL = { kind: 'deadlock', what: '' };
  const join = (names) => names.map((n) => '    pthread_join(' + n + ', NULL);').join('\n');

  // ---- races and locks ------------------------------------------------------------------------------------------
  const bump = (locked) => String.raw`#include <pthread.h>

#define ROUNDS 2

int count = 0;
${locked ? 'pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;\n' : ''}
void *bump(void *arg) {
    for (int i = 0; i < ROUNDS; i++) {
${locked ? '        pthread_mutex_lock(&lock);\n        count++;\n        pthread_mutex_unlock(&lock);' : '        count++;'}
    }
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, bump, NULL);
    pthread_create(&b, NULL, bump, NULL);
${join(['a', 'b'])}
    return 0;
}
`;
  add({ id: 'race', fam: 'race', label: 'count++ race', gran: 'machine', mode: 'check', expect: 'invariant', cat: 'counter-race',
    about: 'Two threads add 2 each to count with no lock. At machine granularity count++ is a load, an add and a store, so two loads of the same value lose an update.',
    src: bump(false), spec: [DL, { kind: 'end', what: 'count == 2 * ROUNDS' }] });
  add({ id: 'race-mutex', fam: 'race', label: 'count++ with a mutex', gran: 'machine', mode: 'check', expect: 'ok', cat: 'counter-mutex',
    about: 'The same two threads with each count++ inside a mutex: the load, add and store of one thread can no longer interleave with the other\'s.',
    src: bump(true), spec: [DL, { kind: 'end', what: 'count == 2 * ROUNDS' }] });

  const peter = (body, rounds0, rounds1) => String.raw`#include <pthread.h>

int flag[2];
int turn;
int inside = 0;

void critical(void) {
    inside++;
    inside--;
}

void *worker(void *arg) {
    long me = (long) arg, other = 1 - me;
    int rounds = me == 0 ? ${rounds0} : ${rounds1};
    for (int k = 0; k < rounds; k++) {
${body}
    }
    return NULL;
}

int main(void) {
    pthread_t t0, t1;
    pthread_create(&t0, NULL, worker, (void *) 0);
    pthread_create(&t1, NULL, worker, (void *) 1);
${join(['t0', 't1'])}
    return 0;
}
`;
  const MX = { kind: 'never', what: 'in(critical) > 1' }, LV = { kind: 'live', what: 'worker calls critical' };
  add({ id: 'peterson', fam: 'race', label: 'Peterson', gran: 'machine', mode: 'check', expect: 'ok', cat: 'peterson-correct',
    about: 'Peterson\'s algorithm: each raises its flag, then gives the turn away and waits only while the other wants in and has the turn. Mutual exclusion and progress, with plain loads and stores (on a machine that does not reorder them).',
    src: peter('        flag[me] = 1;\n        turn = other;\n        while (flag[other] && turn == other)\n            ;\n        critical();\n        flag[me] = 0;', 2, 2), spec: [DL, MX, LV] });
  add({ id: 'peterson-flags', fam: 'race', label: 'flags only', gran: 'machine', mode: 'check', expect: 'starve', cat: 'peterson-flags-only',
    about: 'Each raises its flag and waits while the other\'s is up. Mutual exclusion holds, but if both raise their flags at once, both wait for ever, spinning.',
    src: peter('        flag[me] = 1;\n        while (flag[other])\n            ;\n        critical();\n        flag[me] = 0;', 2, 2), spec: [DL, MX, LV] });
  add({ id: 'peterson-turn', fam: 'race', label: 'strict turns', gran: 'machine', mode: 'check', expect: 'starve', cat: 'peterson-turn-only',
    about: 'The threads take strict turns. W0 wants in three times but W1 only once, so after W1\'s turn W0 waits for ever for a turn that never comes back: no progress.',
    src: peter('        while (turn != me)\n            ;\n        critical();\n        turn = other;', 3, 1), spec: [DL, MX, LV] });
  add({ id: 'peterson-check', fam: 'race', label: 'check, then set', gran: 'machine', mode: 'check', expect: 'invariant', cat: 'peterson-check-then-set',
    about: 'Each looks at the other\'s flag before raising its own. Both can look, both see the flag down, and both walk in.',
    src: peter('        while (flag[other])\n            ;\n        flag[me] = 1;\n        critical();\n        flag[me] = 0;', 2, 2), spec: [DL, MX, LV] });

  // ---- the bounded buffer ---------------------------------------------------------------------------------------
  const ringFns = String.raw`int buf[N];
int in = 0, out = 0;

void put(int item) {
    assert(buf[in] == 0);
    buf[in] = item;
    in = (in + 1) % N;
}

int take(void) {
    int item = buf[out];
    assert(item != 0);
    buf[out] = 0;
    out = (out + 1) % N;
    return item;
}
`;
  const semBuf = (prod, cons, n, items) => String.raw`#include <pthread.h>
#include <semaphore.h>
#include <assert.h>

#define N ${n || 2}
#define ITEMS ${items || 1}

${ringFns}
sem_t empty, full, mutex;

void *producer(void *arg) {
    long id = (long) arg;
    for (int i = 1; i <= ITEMS; i++) {
${prod}
    }
    return NULL;
}

void *consumer(void *arg) {
    for (int i = 0; i < 2 * ITEMS; i++) {
${cons}
    }
    return NULL;
}

int main(void) {
    pthread_t p1, p2, c;
    sem_init(&empty, 0, N);
    sem_init(&full, 0, 0);
    sem_init(&mutex, 0, 1);
    pthread_create(&p1, NULL, producer, (void *) 1);
    pthread_create(&p2, NULL, producer, (void *) 2);
    pthread_create(&c, NULL, consumer, NULL);
${join(['p1', 'p2', 'c'])}
    return 0;
}
`;
  const PUT = '        sem_wait(&empty);\n        sem_wait(&mutex);\n        put(10 * id + i);\n        sem_post(&mutex);\n        sem_post(&full);';
  const TAKE = '        sem_wait(&full);\n        sem_wait(&mutex);\n        take();\n        sem_post(&mutex);\n        sem_post(&empty);';
  const BUFSPEC = [DL, { kind: 'always', what: 'value(empty) + value(full) <= N' }, { kind: 'end', what: 'count(buf, 0) == N' }];
  add({ id: 'buffer', fam: 'buffer', label: 'bounded buffer', gran: 'statement', mode: 'random', expect: 'ok', cat: 'buffer-sem',
    about: 'Two producers and a consumer share a ring of N = 2 slots; each producer makes one item. empty counts the free slots, full the filled ones, and mutex lets one thread at a time touch the ring and its indexes.',
    src: semBuf(PUT, TAKE, 2, 1), spec: BUFSPEC });
  add({ id: 'buffer-nomutex', fam: 'buffer', label: 'buffer, no mutex', gran: 'statement', mode: 'check', expect: 'assert', cat: 'buffer-no-mutex',
    about: 'Without mutex, both producers can write at the same in before either moves it on: the assert in put catches the overwrite.',
    src: semBuf('        sem_wait(&empty);\n        put(10 * id + i);\n        sem_post(&full);', '        sem_wait(&full);\n        take();\n        sem_post(&empty);', 2, 1), spec: BUFSPEC });
  add({ id: 'buffer-swapped', fam: 'buffer', label: 'waits swapped', gran: 'statement', mode: 'check', expect: 'deadlock', cat: 'buffer-swapped',
    about: 'A producer takes mutex before it waits for a free slot. With one slot, the ring is full after one item, and then it sleeps holding mutex, and the consumer can never get in to free a slot.',
    src: semBuf('        sem_wait(&mutex);\n        sem_wait(&empty);\n        put(10 * id + i);\n        sem_post(&mutex);\n        sem_post(&full);', TAKE, 1, 1), spec: BUFSPEC });

  const cvBuf = (o) => String.raw`#include <pthread.h>
#include <assert.h>

#define N ${o.n}

${ringFns}
int count = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
${o.one ? 'pthread_cond_t changed = PTHREAD_COND_INITIALIZER;' : 'pthread_cond_t notFull = PTHREAD_COND_INITIALIZER;\npthread_cond_t notEmpty = PTHREAD_COND_INITIALIZER;'}

void *producer(void *arg) {
    for (int i = 1; i <= ${o.items}; i++) {
        pthread_mutex_lock(&m);
        ${o.test} (count == N)
            pthread_cond_wait(&${o.one ? 'changed' : 'notFull'}, &m);
        put(i);
        count++;
        pthread_cond_signal(&${o.one ? 'changed' : 'notEmpty'});
        pthread_mutex_unlock(&m);
    }
    return NULL;
}

void *consumer(void *arg) {
    for (int i = 0; i < ${o.each}; i++) {
        pthread_mutex_lock(&m);
        ${o.test} (count == 0)
            pthread_cond_wait(&${o.one ? 'changed' : 'notEmpty'}, &m);
        take();
        count--;
        pthread_cond_signal(&${o.one ? 'changed' : 'notFull'});
        pthread_mutex_unlock(&m);
    }
    return NULL;
}

int main(void) {
    pthread_t ${o.two ? 'p1, p2' : 'p'}, c1, c2;
${o.two ? '    pthread_create(&p1, NULL, producer, NULL);\n    pthread_create(&p2, NULL, producer, NULL);' : '    pthread_create(&p, NULL, producer, NULL);'}
    pthread_create(&c1, NULL, consumer, NULL);
    pthread_create(&c2, NULL, consumer, NULL);
${join(o.two ? ['p1', 'p2', 'c1', 'c2'] : ['p', 'c1', 'c2'])}
    return 0;
}
`;
  const CVSPEC = [DL, { kind: 'always', what: 'count >= 0 && count <= N' }, { kind: 'end', what: 'count == 0' }];
  add({ id: 'cv-buffer', fam: 'buffer', label: 'condition variables', gran: 'statement', mode: 'check', expect: 'ok', cat: 'cvbuffer-while',
    about: 'One producer, two consumers, a mutex and two condition variables. Each waits in a while loop, so a thread woken when the slot has gone again simply waits again.',
    src: cvBuf({ n: 1, items: 2, each: 1, test: 'while' }), spec: CVSPEC });
  add({ id: 'cv-if', fam: 'buffer', label: 'if, not while', gran: 'statement', mode: 'check', expect: 'assert', cat: 'cvbuffer-if',
    about: 'The same with if instead of while. A woken consumer only queues for the mutex (Mesa semantics); the other consumer can get in first and take the item, and then the woken one takes from an empty slot.',
    src: cvBuf({ n: 1, items: 2, each: 1, test: 'if' }), spec: CVSPEC });
  add({ id: 'cv-one', fam: 'buffer', label: 'one condition', gran: 'statement', mode: 'check', expect: 'deadlock', cat: 'cvbuffer-one-cv',
    about: 'Two producers, two consumers, one slot, and one condition variable for both kinds of waiting, with signal rather than broadcast. A consumer\'s signal can wake the other consumer instead of the waiting producer, and then everyone left sleeps.',
    src: cvBuf({ n: 1, items: 1, each: 1, test: 'while', one: true, two: true }), spec: CVSPEC });

  // ---- readers and writers --------------------------------------------------------------------------------------
  const rwMain = (r, w) => String.raw`int main(void) {
    pthread_t t[${r + w}];
${'    sem_init(&count_lock, 0, 1);\n    sem_init(&room, 0, 1);\n'}%%INIT%%    for (long i = 0; i < ${r}; i++)
        pthread_create(&t[i], NULL, reader, (void *) i);
    for (long i = 0; i < ${w}; i++)
        pthread_create(&t[${r} + i], NULL, writer, (void *) i);
    pthread_join(t[0], NULL);
    return 0;
}
`;
  const RWSPEC = [DL, { kind: 'never', what: 'in(write_book) > 0 && in(read_book) > 0' }, { kind: 'never', what: 'in(write_book) > 1' }, { kind: 'live', what: 'writer calls write_book' }, { kind: 'live', what: 'reader calls read_book' }];
  const rwHead = String.raw`#include <pthread.h>
#include <semaphore.h>

int readers = 0;
sem_t count_lock, room;
`;
  const books = 'int book = 0;\n\nvoid read_book(void) {\n    int page = book;\n    (void) page;\n}\n\nvoid write_book(void) {\n    int next = 1 - book;\n    book = next;\n}\n';
  add({ id: 'rw-readers', fam: 'rw', label: 'readers first', gran: 'statement', mode: 'check', expect: 'starve', cat: 'rw-reader',
    about: 'The first reader in locks the room for readers and the last one out unlocks it. Readers never wait for each other, so while two of them keep taking turns inside, the writer waits for ever.',
    src: rwHead + '\n' + books + String.raw`
void *reader(void *arg) {
    while (1) {
        sem_wait(&count_lock);
        readers++;
        if (readers == 1)
            sem_wait(&room);
        sem_post(&count_lock);
        read_book();
        sem_wait(&count_lock);
        readers--;
        if (readers == 0)
            sem_post(&room);
        sem_post(&count_lock);
    }
    return NULL;
}

void *writer(void *arg) {
    while (1) {
        sem_wait(&room);
        write_book();
        sem_post(&room);
    }
    return NULL;
}

` + rwMain(2, 1).replace('%%INIT%%', ''), spec: RWSPEC });
  add({ id: 'rw-fair', fam: 'rw', label: 'fair entry', gran: 'statement', mode: 'check', expect: 'ok', cat: 'rw-fair',
    about: 'Everyone first passes through entry, a semaphore with a queue. A waiting writer keeps entry until the room is its own, so readers who come after it line up behind it: nobody waits for ever.',
    src: rwHead.replace('sem_t count_lock, room;', 'sem_t count_lock, room, entry;') + '\n' + books + String.raw`
void *reader(void *arg) {
    while (1) {
        sem_wait(&entry);
        sem_wait(&count_lock);
        readers++;
        if (readers == 1)
            sem_wait(&room);
        sem_post(&count_lock);
        sem_post(&entry);
        read_book();
        sem_wait(&count_lock);
        readers--;
        if (readers == 0)
            sem_post(&room);
        sem_post(&count_lock);
    }
    return NULL;
}

void *writer(void *arg) {
    while (1) {
        sem_wait(&entry);
        sem_wait(&room);
        sem_post(&entry);
        write_book();
        sem_post(&room);
    }
    return NULL;
}

` + rwMain(2, 1).replace('%%INIT%%', '    sem_init(&entry, 0, 1);\n'), spec: RWSPEC });
  add({ id: 'rw-writers', fam: 'rw', label: 'writers first', gran: 'statement', mode: 'check', expect: 'starve', cat: 'rw-writer',
    about: 'A monitor where a waiting writer keeps new readers out. Two writers can keep handing the room to each other, and the reader waits for ever.',
    src: String.raw`#include <pthread.h>

int readers = 0, writing = 0, writersWaiting = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t ok = PTHREAD_COND_INITIALIZER;

` + books + String.raw`
void *reader(void *arg) {
    while (1) {
        pthread_mutex_lock(&m);
        while (writing || writersWaiting > 0)
            pthread_cond_wait(&ok, &m);
        readers++;
        pthread_mutex_unlock(&m);
        read_book();
        pthread_mutex_lock(&m);
        readers--;
        if (readers == 0)
            pthread_cond_broadcast(&ok);
        pthread_mutex_unlock(&m);
    }
    return NULL;
}

void *writer(void *arg) {
    while (1) {
        pthread_mutex_lock(&m);
        writersWaiting++;
        while (writing || readers > 0)
            pthread_cond_wait(&ok, &m);
        writersWaiting--;
        writing = 1;
        pthread_mutex_unlock(&m);
        write_book();
        pthread_mutex_lock(&m);
        writing = 0;
        pthread_cond_broadcast(&ok);
        pthread_mutex_unlock(&m);
    }
    return NULL;
}

int main(void) {
    pthread_t t[3];
    pthread_create(&t[0], NULL, reader, (void *) 0);
    for (long i = 0; i < 2; i++)
        pthread_create(&t[1 + i], NULL, writer, (void *) i);
    pthread_join(t[0], NULL);
    return 0;
}
`, spec: RWSPEC });

  // ---- the dining philosophers ----------------------------------------------------------------------------------
  const phil = (o) => String.raw`#include <pthread.h>
${o.sem ? '#include <semaphore.h>\n' : ''}
#define N 3

pthread_mutex_t forks[N];
${o.extra || ''}int eating[N];

void eat(int i) {
    eating[i] = 1;
    eating[i] = 0;
}

void *philosopher(void *arg) {
    long i = (long) arg;
${o.pick || '    int first = i, second = (i + 1) % N;'}
    while (1) {
${o.before || ''}        pthread_mutex_lock(&forks[first]);
        pthread_mutex_lock(&forks[second]);
${o.mid || ''}        eat(i);
        pthread_mutex_unlock(&forks[second]);
        pthread_mutex_unlock(&forks[first]);
${o.after || ''}    }
    return NULL;
}

int main(void) {
    pthread_t t[N];
${o.init || ''}    for (long i = 0; i < N; i++)
        pthread_mutex_init(&forks[i], NULL);
    for (long i = 0; i < N; i++)
        pthread_create(&t[i], NULL, philosopher, (void *) i);
    pthread_join(t[0], NULL);
    return 0;
}
`;
  const PHSPEC = [DL, { kind: 'always', what: 'sum(eating) <= N / 2' }, { kind: 'live', what: 'philosopher calls eat' }];
  add({ id: 'phil', fam: 'phil', label: 'philosophers', gran: 'statement', mode: 'check', expect: 'deadlock', cat: 'phil-naive',
    about: 'Three philosophers, three forks. Each picks up the left fork, then the right one. If all three pick up their left forks at once, each waits for a fork its neighbour holds: a circle of waits.',
    src: phil({}), spec: PHSPEC });
  add({ id: 'phil-ordered', fam: 'phil', label: 'forks in order', gran: 'statement', mode: 'check', expect: 'ok', cat: 'phil-ordered',
    about: 'Every philosopher picks up the lower-numbered fork first, so the last one reaches right before left. A circle of waits would need someone to hold a higher fork while waiting for a lower one: it cannot close.',
    src: phil({ pick: '    int first = i, second = (i + 1) % N;\n    if (first > second) {\n        first = second;\n        second = i;\n    }' }), spec: PHSPEC });
  add({ id: 'phil-seats', fam: 'phil', label: 'N − 1 seats', gran: 'statement', mode: 'check', expect: 'ok', cat: 'phil-seats',
    about: 'A semaphore lets at most N − 1 philosophers sit at once. With one seat empty, at least one of those sitting can always get both forks.',
    src: phil({ sem: true, extra: 'sem_t seats;\n', before: '        sem_wait(&seats);\n', after: '        sem_post(&seats);\n', init: '    sem_init(&seats, 0, N - 1);\n' }), spec: PHSPEC });
  add({ id: 'phil-waiter', fam: 'phil', label: 'a waiter', gran: 'statement', mode: 'check', expect: 'ok', cat: 'phil-arbiter',
    about: 'A waiter (one mutex) lets one philosopher at a time pick up forks. Nobody holds one fork while someone else is half way through picking up theirs.',
    src: phil({ extra: 'pthread_mutex_t waiter = PTHREAD_MUTEX_INITIALIZER;\n', before: '        pthread_mutex_lock(&waiter);\n', mid: '        pthread_mutex_unlock(&waiter);\n' }), spec: PHSPEC });
})(globalThis.Proses = globalThis.Proses || {});
