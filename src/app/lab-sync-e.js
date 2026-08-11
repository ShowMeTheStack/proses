// The Sync lab, part five: its ready-made C programs, part two (more classic problems, concurrency bugs, and
// lock-based data structures). The same shape as part four (lab-sync-d.js); a data structure also names its
// kind and variant in the step machine's performance model (S.Sync.scaling), for the Scaling view.
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const P = (SL.PROGS = SL.PROGS || []);
  const add = (x) => { P.push(x); return x; };
  const DL = { kind: 'deadlock', what: '' };
  const join = (names) => names.map((n) => '    pthread_join(' + n + ', NULL);').join('\n');

  // ---- the sleeping barber --------------------------------------------------------------------------------------
  const barber = (locked) => String.raw`#include <pthread.h>
#include <semaphore.h>

#define SEATS 1
#define CUSTOMERS 2

int free_seats = SEATS, served = 0, left_unserved = 0;
sem_t arrivals, call_next;
${locked ? 'pthread_mutex_t seat_lock = PTHREAD_MUTEX_INITIALIZER;\n' : ''}
void trim(void) {
}

void *barber(void *arg) {
    while (1) {
        sem_wait(&arrivals);
${locked ? '        pthread_mutex_lock(&seat_lock);\n        free_seats++;\n        pthread_mutex_unlock(&seat_lock);' : '        free_seats++;'}
        sem_post(&call_next);
        trim();
    }
    return NULL;
}

void *customer(void *arg) {
${locked ? '    pthread_mutex_lock(&seat_lock);\n' : ''}    if (free_seats > 0) {
        free_seats--;
${locked ? '        pthread_mutex_unlock(&seat_lock);\n' : ''}        sem_post(&arrivals);
        sem_wait(&call_next);
${locked ? '        pthread_mutex_lock(&seat_lock);\n        served++;\n        pthread_mutex_unlock(&seat_lock);' : '        served++;'}
    } else {
        left_unserved++;
${locked ? '        pthread_mutex_unlock(&seat_lock);\n' : ''}    }
    return NULL;
}

int main(void) {
    pthread_t b, c[CUSTOMERS];
    sem_init(&arrivals, 0, 0);
    sem_init(&call_next, 0, 0);
    pthread_create(&b, NULL, barber, NULL);
    for (long i = 0; i < CUSTOMERS; i++)
        pthread_create(&c[i], NULL, customer, (void *) i);
    for (int i = 0; i < CUSTOMERS; i++)
        pthread_join(c[i], NULL);
    return 0;
}
`;
  const BSPEC = [DL, { kind: 'always', what: 'free_seats >= 0 && free_seats <= SEATS' }, { kind: 'end', what: 'served + left_unserved == CUSTOMERS' }];
  add({ id: 'barber', fam: 'more', label: 'sleeping barber', gran: 'statement', mode: 'random', expect: 'ok', cat: 'barber-correct',
    about: 'A barber, one free seat and two customers. A customer takes a seat if one is free (free_seats counts down), posts arrivals to wake the barber, and waits for call_next; with no free seat it leaves. seat_lock guards the count.',
    src: barber(true), spec: BSPEC });
  add({ id: 'barber-nomutex', fam: 'more', label: 'barber, no mutex', gran: 'statement', mode: 'check', expect: 'invariant', cat: 'barber-no-mutex',
    about: 'Without seat_lock two customers can both see a free seat before either takes it: free_seats drops below zero.',
    src: barber(false), spec: BSPEC });

  // ---- a reusable barrier ---------------------------------------------------------------------------------------
  add({ id: 'barrier', fam: 'more', label: 'reusable barrier', gran: 'statement', mode: 'check', expect: 'ok', cat: 'barrier-two-phase',
    about: 'Two workers do two rounds of work; nobody starts a round before everyone has finished the last one. Two gates make it reusable: gate_in opens when the last worker arrives, gate_out when the last one has left, so a fast worker cannot lap the others.',
    src: String.raw`#include <pthread.h>
#include <semaphore.h>

#define N 2
#define ROUNDS 2

int arrived = 0;
int round_of[N];
sem_t lock, gate_in, gate_out;

void *worker(void *arg) {
    long i = (long) arg;
    for (int r = 0; r < ROUNDS; r++) {
        round_of[i]++;
        sem_wait(&lock);
        arrived++;
        if (arrived == N)
            for (int k = 0; k < N; k++)
                sem_post(&gate_in);
        sem_post(&lock);
        sem_wait(&gate_in);
        sem_wait(&lock);
        arrived--;
        if (arrived == 0)
            for (int k = 0; k < N; k++)
                sem_post(&gate_out);
        sem_post(&lock);
        sem_wait(&gate_out);
    }
    return NULL;
}

int main(void) {
    pthread_t t[N];
    sem_init(&lock, 0, 1);
    sem_init(&gate_in, 0, 0);
    sem_init(&gate_out, 0, 0);
    for (long i = 0; i < N; i++)
        pthread_create(&t[i], NULL, worker, (void *) i);
    for (int i = 0; i < N; i++)
        pthread_join(t[i], NULL);
    return 0;
}
`, spec: [DL, { kind: 'always', what: 'max(round_of) - min(round_of) <= 1' }, { kind: 'end', what: 'min(round_of) == ROUNDS' }] });
  add({ id: 'barrier-racy', fam: 'more', label: 'barrier, racy count', gran: 'machine', mode: 'check', expect: 'deadlock', cat: 'barrier-racy',
    about: 'A one-shot barrier whose arrival count is not locked. Two arrivals can load the same count, one increment is lost, the count never reaches N, and everyone waits.',
    src: String.raw`#include <pthread.h>
#include <semaphore.h>

#define N 3

int arrived = 0;
sem_t gate_open;

void *worker(void *arg) {
    arrived++;
    if (arrived == N)
        sem_post(&gate_open);
    sem_wait(&gate_open);
    sem_post(&gate_open);
    return NULL;
}

int main(void) {
    pthread_t t[N];
    sem_init(&gate_open, 0, 0);
    for (long i = 0; i < N; i++)
        pthread_create(&t[i], NULL, worker, (void *) i);
    for (int i = 0; i < N; i++)
        pthread_join(t[i], NULL);
    return 0;
}
`, spec: [DL, { kind: 'end', what: 'arrived == N' }] });

  // ---- concurrency bugs -----------------------------------------------------------------------------------------
  const acct = (fixed) => String.raw`#include <stdio.h>
#include <pthread.h>

struct account {
    int balance;
};

struct account savings = { 50 };
struct account *acct = &savings;
${fixed ? 'pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;\n' : ''}
void *auditor(void *arg) {
${fixed ? '    pthread_mutex_lock(&lock);\n' : ''}    if (acct != NULL)
        printf("balance %d\n", acct->balance);
${fixed ? '    pthread_mutex_unlock(&lock);\n' : ''}    return NULL;
}

void *closer(void *arg) {
${fixed ? '    pthread_mutex_lock(&lock);\n    acct = NULL;\n    pthread_mutex_unlock(&lock);' : '    acct = NULL;'}
    return NULL;
}

int main(void) {
    pthread_t a, c;
    pthread_create(&a, NULL, auditor, NULL);
    pthread_create(&c, NULL, closer, NULL);
${join(['a', 'c'])}
    return 0;
}
`;
  add({ id: 'bug-atomicity', fam: 'bugs', label: 'check, then use', gran: 'machine', mode: 'check', expect: 'assert', cat: 'bug-atomicity',
    about: 'An atomicity violation: the auditor checks that acct is not NULL, then uses it. The closer can set it to NULL in between, and the auditor reads through a NULL pointer.',
    src: acct(false), spec: [DL] });
  add({ id: 'fix-atomicity', fam: 'bugs', label: 'check and use, locked', gran: 'machine', mode: 'check', expect: 'ok', cat: 'fix-atomicity',
    about: 'The check and the use are one critical section, and so is the closing: the closer cannot get in between.',
    src: acct(true), spec: [DL] });

  const order = (fixed) => String.raw`#include <pthread.h>
${fixed ? '#include <semaphore.h>\n' : ''}
int settings[2] = { 4, 7 };
int *config = NULL;
int total = 0;
${fixed ? 'sem_t ready;\n' : ''}
void *worker(void *arg) {
${fixed ? '    sem_wait(&ready);\n' : ''}    total = config[0] + config[1];
    return NULL;
}

int main(void) {
    pthread_t w;
${fixed ? '    sem_init(&ready, 0, 0);\n' : ''}    pthread_create(&w, NULL, worker, NULL);
    config = settings;
${fixed ? '    sem_post(&ready);\n' : ''}    pthread_join(w, NULL);
    return 0;
}
`;
  add({ id: 'bug-order', fam: 'bugs', label: 'used too early', gran: 'statement', mode: 'check', expect: 'assert', cat: 'bug-order',
    about: 'An order violation: main starts the worker, then sets config. Nothing makes the worker wait, so it can read config while it is still NULL.',
    src: order(false), spec: [DL, { kind: 'end', what: 'total == 11' }] });
  add({ id: 'fix-order', fam: 'bugs', label: 'wait until ready', gran: 'statement', mode: 'check', expect: 'ok', cat: 'fix-order',
    about: 'A semaphore that starts at 0 makes the worker wait until main has set config and posted.',
    src: order(true), spec: [DL, { kind: 'end', what: 'total == 11' }] });

  const wake = (fixed) => String.raw`#include <pthread.h>

int ready = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t c = PTHREAD_COND_INITIALIZER;

void *waiter(void *arg) {
${fixed ? '    pthread_mutex_lock(&m);\n    while (!ready)\n        pthread_cond_wait(&c, &m);\n    pthread_mutex_unlock(&m);' : '    if (!ready) {\n        pthread_mutex_lock(&m);\n        pthread_cond_wait(&c, &m);\n        pthread_mutex_unlock(&m);\n    }'}
    return NULL;
}

void *notifier(void *arg) {
    pthread_mutex_lock(&m);
    ready = 1;
    pthread_cond_signal(&c);
    pthread_mutex_unlock(&m);
    return NULL;
}

int main(void) {
    pthread_t w, n;
    pthread_create(&w, NULL, waiter, NULL);
    pthread_create(&n, NULL, notifier, NULL);
${join(['w', 'n'])}
    return 0;
}
`;
  add({ id: 'bug-wakeup', fam: 'bugs', label: 'lost wake-up', gran: 'statement', mode: 'check', expect: 'deadlock', cat: 'bug-lost-wakeup',
    about: 'The waiter tests ready outside the lock. The notifier can set it and signal after the test but before the wait, and the signal wakes nobody: the waiter sleeps for ever.',
    src: wake(false), spec: [DL] });
  add({ id: 'fix-wakeup', fam: 'bugs', label: 'test under the lock', gran: 'statement', mode: 'check', expect: 'ok', cat: 'fix-lost-wakeup',
    about: 'The test and the wait happen under the mutex, in a while loop: the notifier cannot slip in between them.',
    src: wake(true), spec: [DL] });

  const twoLocks = (ordered) => String.raw`#include <pthread.h>

int a = 100, b = 100;
pthread_mutex_t lockA = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t lockB = PTHREAD_MUTEX_INITIALIZER;

void *pay(void *arg) {
    pthread_mutex_lock(&lockA);
    pthread_mutex_lock(&lockB);
    a -= 10;
    b += 10;
    pthread_mutex_unlock(&lockB);
    pthread_mutex_unlock(&lockA);
    return NULL;
}

void *refund(void *arg) {
${ordered ? '    pthread_mutex_lock(&lockA);\n    pthread_mutex_lock(&lockB);' : '    pthread_mutex_lock(&lockB);\n    pthread_mutex_lock(&lockA);'}
    b -= 5;
    a += 5;
${ordered ? '    pthread_mutex_unlock(&lockB);\n    pthread_mutex_unlock(&lockA);' : '    pthread_mutex_unlock(&lockA);\n    pthread_mutex_unlock(&lockB);'}
    return NULL;
}

int main(void) {
    pthread_t p, r;
    pthread_create(&p, NULL, pay, NULL);
    pthread_create(&r, NULL, refund, NULL);
${join(['p', 'r'])}
    return 0;
}
`;
  const LSPEC = [DL, { kind: 'always', what: 'a + b == 200 || in(pay) + in(refund) > 0' }, { kind: 'end', what: 'a == 95 && b == 105' }];
  add({ id: 'lock-order', fam: 'bugs', label: 'locks in opposite orders', gran: 'statement', mode: 'check', expect: 'deadlock', cat: 'lock-order-ab-ba',
    about: 'pay takes lockA then lockB; refund takes lockB then lockA. Each can get its first lock and wait for ever for the other\'s.',
    src: twoLocks(false), spec: LSPEC });
  add({ id: 'lock-ordered', fam: 'bugs', label: 'one lock order', gran: 'statement', mode: 'check', expect: 'ok', cat: 'lock-order-ordered',
    about: 'Both take lockA before lockB. Whoever gets lockA gets lockB too, so no circle of waits can form.',
    src: twoLocks(true), spec: LSPEC });
  add({ id: 'livelock', fam: 'bugs', label: 'polite livelock', gran: 'statement', mode: 'check', expect: 'starve', cat: 'livelock',
    about: 'Two polite threads each take one lock, try the other, and back off if it is taken. Nobody is ever blocked, yet both can go round taking and giving back for ever.',
    src: String.raw`#include <pthread.h>

pthread_mutex_t lockA = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t lockB = PTHREAD_MUTEX_INITIALIZER;

void work(void) {
}

void *polite(void *arg) {
    long me = (long) arg;
    pthread_mutex_t *first = me ? &lockB : &lockA;
    pthread_mutex_t *second = me ? &lockA : &lockB;
    int done = 0;
    while (!done) {
        pthread_mutex_lock(first);
        if (pthread_mutex_trylock(second) == 0) {
            work();
            done = 1;
            pthread_mutex_unlock(second);
        }
        pthread_mutex_unlock(first);
    }
    return NULL;
}

int main(void) {
    pthread_t t0, t1;
    pthread_create(&t0, NULL, polite, (void *) 0);
    pthread_create(&t1, NULL, polite, (void *) 1);
${join(['t0', 't1'])}
    return 0;
}
`, spec: [DL, { kind: 'live', what: 'polite calls work' }] });
})(globalThis.Proses = globalThis.Proses || {});
