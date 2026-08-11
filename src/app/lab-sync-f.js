// The Sync lab, part six: its ready-made C programs, part three: lock-based data structures. Memory is plain
// arrays (a node's key and the index of the next node, -1 for none), so every state stays small enough to search.
// Each names its kind and variant in the step machine's performance model (S.Sync.scaling) for the Scaling view.
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const P = (SL.PROGS = SL.PROGS || []);
  const add = (x) => { P.push(x); return x; };
  const DL = { kind: 'deadlock', what: '' };

  add({ id: 'counter-sloppy', fam: 'structs', label: 'approximate counter', gran: 'statement', mode: 'random', expect: 'ok', cat: 'counter-sloppy-struct', perf: { kind: 'counter', variant: 'sloppy' },
    about: 'Each thread counts in its own slot and adds that to the global count only every S increments, so the global lock is taken a third as often. The global count lags behind; main adds what is left at the end.',
    src: String.raw`#include <pthread.h>

#define THREADS 2
#define PER 3
#define S 2

int global = 0;
int local[THREADS];
pthread_mutex_t glock = PTHREAD_MUTEX_INITIALIZER;

void update(int t) {
    local[t]++;
    if (local[t] >= S) {
        pthread_mutex_lock(&glock);
        global += local[t];
        pthread_mutex_unlock(&glock);
        local[t] = 0;
    }
}

void *worker(void *arg) {
    long t = (long) arg;
    for (int i = 0; i < PER; i++)
        update(t);
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, worker, (void *) 0);
    pthread_create(&b, NULL, worker, (void *) 1);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    for (int t = 0; t < THREADS; t++)
        global += local[t];
    return 0;
}
`, spec: [DL, { kind: 'always', what: 'global <= THREADS * PER' }, { kind: 'end', what: 'global == THREADS * PER' }] });

  const listMain = String.raw`void *worker(void *arg) {
    long t = (long) arg;
    insert(10 * t + 10);
    return NULL;
}

int main(void) {
    pthread_t a, b;
    next[0] = -1;
%%INIT%%    insert(25);
    pthread_create(&a, NULL, worker, (void *) 0);
    pthread_create(&b, NULL, worker, (void *) 1);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    int n = 0, last = 0;
    for (int p = next[0]; p != -1; p = next[p]) {
        assert(key[p] > last);
        last = key[p];
        n++;
    }
    assert(n == 3);
    return 0;
}
`;
  const listHead = (locks) => String.raw`#include <pthread.h>
#include <assert.h>

#define MAX 4

int key[MAX], next[MAX];
int used = 1;
${locks}
`;
  const LISTSPEC = [DL, { kind: 'end', what: 'used == MAX' }];
  add({ id: 'list-coarse', fam: 'structs', label: 'list, one lock', gran: 'statement', mode: 'check', expect: 'ok', cat: 'list-coarse', perf: { kind: 'list', variant: 'coarse' },
    about: 'A sorted linked list (node 0 is a dummy head) with one lock round every insert: simple and correct, but only one thread is ever inside the list.',
    src: listHead('pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;') + String.raw`
void insert(int k) {
    pthread_mutex_lock(&lock);
    int n = used++;
    key[n] = k;
    int prev = 0;
    while (next[prev] != -1 && key[next[prev]] < k)
        prev = next[prev];
    next[n] = next[prev];
    next[prev] = n;
    pthread_mutex_unlock(&lock);
}

` + listMain.replace('%%INIT%%', ''), spec: LISTSPEC });
  const hohInit = '    for (int i = 0; i < MAX; i++)\n        pthread_mutex_init(&node[i], NULL);\n';
  const newNode = String.raw`int new_node(int k) {
    pthread_mutex_lock(&alloc);
    int n = used++;
    pthread_mutex_unlock(&alloc);
    key[n] = k;
    return n;
}
`;
  add({ id: 'list-hoh', fam: 'structs', label: 'list, hand over hand', gran: 'statement', mode: 'check', expect: 'ok', cat: 'list-hoh', perf: { kind: 'list', variant: 'hoh' },
    about: 'A lock in every node. A thread walks the list hand over hand: it takes the next node\'s lock before it lets go of the one it holds, so the two nodes it links between cannot change under it.',
    src: listHead('pthread_mutex_t alloc = PTHREAD_MUTEX_INITIALIZER;\npthread_mutex_t node[MAX];') + '\n' + newNode + String.raw`
void insert(int k) {
    int n = new_node(k);
    int prev = 0;
    pthread_mutex_lock(&node[prev]);
    int cur = next[prev];
    while (cur != -1) {
        pthread_mutex_lock(&node[cur]);
        if (key[cur] >= k)
            break;
        pthread_mutex_unlock(&node[prev]);
        prev = cur;
        cur = next[cur];
    }
    next[n] = cur;
    next[prev] = n;
    if (cur != -1)
        pthread_mutex_unlock(&node[cur]);
    pthread_mutex_unlock(&node[prev]);
}

` + listMain.replace('%%INIT%%', hohInit), spec: LISTSPEC });
  add({ id: 'list-broken', fam: 'structs', label: 'list, one lock at a time', gran: 'statement', mode: 'check', expect: 'assert', cat: 'list-hoh-broken', perf: { kind: 'list', variant: 'hoh-broken' },
    about: 'The walk holds one lock at a time and lets go before taking the next, then links the new node using what it saw. Another insert at the same place in between is lost.',
    src: listHead('pthread_mutex_t alloc = PTHREAD_MUTEX_INITIALIZER;\npthread_mutex_t node[MAX];') + '\n' + newNode + String.raw`
void insert(int k) {
    int n = new_node(k);
    int prev = 0;
    pthread_mutex_lock(&node[prev]);
    int cur = next[prev];
    pthread_mutex_unlock(&node[prev]);
    while (cur != -1 && key[cur] < k) {
        pthread_mutex_lock(&node[cur]);
        prev = cur;
        cur = next[cur];
        pthread_mutex_unlock(&node[prev]);
    }
    pthread_mutex_lock(&node[prev]);
    next[n] = cur;
    next[prev] = n;
    pthread_mutex_unlock(&node[prev]);
}

` + listMain.replace('%%INIT%%', hohInit), spec: LISTSPEC });

  const hash = (locked) => String.raw`#include <pthread.h>
#include <assert.h>

#define B 2
#define CAP 3

int items[B * CAP];
int size[B];
${locked ? 'pthread_mutex_t bucket[B];\n' : ''}
void insert(int k) {
    int b = k % B;
${locked ? '    pthread_mutex_lock(&bucket[b]);\n' : ''}    items[b * CAP + size[b]] = k;
    size[b]++;
${locked ? '    pthread_mutex_unlock(&bucket[b]);\n' : ''}}

int contains(int k) {
    int b = k % B;
    for (int i = 0; i < size[b]; i++)
        if (items[b * CAP + i] == k)
            return 1;
    return 0;
}

void *worker(void *arg) {
    long t = (long) arg;
    insert(2 * t + 1);
    insert(2 * t + 2);
    return NULL;
}

int main(void) {
    pthread_t a, b;
${locked ? '    for (int i = 0; i < B; i++)\n        pthread_mutex_init(&bucket[i], NULL);\n' : ''}    pthread_create(&a, NULL, worker, (void *) 0);
    pthread_create(&b, NULL, worker, (void *) 1);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    for (int k = 1; k <= 4; k++)
        assert(contains(k));
    return 0;
}
`;
  add({ id: 'hash-bucket', fam: 'structs', label: 'hash, a lock a bucket', gran: 'statement', mode: 'check', expect: 'ok', cat: 'hash-bucket', perf: { kind: 'hash', variant: 'bucket' },
    about: 'A hash table of two buckets with a lock each: inserts into different buckets go on at once, and two into the same bucket take turns.',
    src: hash(true), spec: [DL, { kind: 'end', what: 'sum(size) == 4' }] });
  add({ id: 'hash-nolock', fam: 'structs', label: 'hash, no locks', gran: 'statement', mode: 'check', expect: 'assert', cat: 'hash-no-lock', perf: { kind: 'hash', variant: 'no-lock' },
    about: 'The same table with no locks. Two inserts into one bucket can both write at the same free place before either counts it: one key is overwritten.',
    src: hash(false), spec: [DL, { kind: 'end', what: 'sum(size) == 4' }] });

  add({ id: 'queue', fam: 'structs', label: 'two-lock queue', gran: 'statement', mode: 'check', expect: 'ok', cat: 'queue-two-lock', perf: { kind: 'queue', variant: 'two-lock' },
    about: 'A queue with a dummy node and two locks: enqueue takes only the tail lock and dequeue only the head lock, so one producer and one consumer never wait for each other.',
    src: String.raw`#include <pthread.h>
#include <assert.h>

#define MAX 3

int value[MAX], next[MAX];
int head = 0, tail = 0, used = 1;
pthread_mutex_t headLock = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t tailLock = PTHREAD_MUTEX_INITIALIZER;
int got[2];

void enqueue(int v) {
    pthread_mutex_lock(&tailLock);
    int n = used++;
    value[n] = v;
    next[n] = -1;
    next[tail] = n;
    tail = n;
    pthread_mutex_unlock(&tailLock);
}

int dequeue(void) {
    pthread_mutex_lock(&headLock);
    int first = next[head];
    if (first == -1) {
        pthread_mutex_unlock(&headLock);
        return 0;
    }
    int v = value[first];
    head = first;
    pthread_mutex_unlock(&headLock);
    return v;
}

void *producer(void *arg) {
    for (int v = 1; v <= 2; v++)
        enqueue(v);
    return NULL;
}

void *consumer(void *arg) {
    for (int i = 0; i < 2; i++) {
        int v = dequeue();
        while (v == 0)
            v = dequeue();
        got[i] = v;
    }
    return NULL;
}

int main(void) {
    pthread_t p, c;
    next[0] = -1;
    pthread_create(&p, NULL, producer, NULL);
    pthread_create(&c, NULL, consumer, NULL);
    pthread_join(p, NULL);
    pthread_join(c, NULL);
    assert(got[0] == 1 && got[1] == 2);
    return 0;
}
`, spec: [DL, { kind: 'end', what: 'head == tail' }] });

  /** a program by id */
  SL.prog = (id) => P.find((x) => x.id === id) || null;
})(globalThis.Proses = globalThis.Proses || {});
