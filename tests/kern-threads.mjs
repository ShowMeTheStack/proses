// The kernel's threads and synchronisation objects: hand-worked cases (create and join with values, a thread's
// own stack, pthread_exit, exit from a thread ending the process, mutex hand-off in FIFO order, Mesa condition
// variables, semaphores and sem_trywait), every schedule of small programs (a mutex keeps a counter right; a
// lock-order inversion can deadlock and the enumerator finds it), and random cases checked against an
// independent model of a semaphore's value and queue, written here.
import { load, harness, rng } from './load.mjs';

const t = harness('kern-threads');
const S = load(['core']);
const K = S.Kern;
const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <pthread.h>\n#include <semaphore.h>\n#include <unistd.h>\n';
const run = (body, o) => K.run(H + body, Object.assign({ policy: 'random', seed: 1 }, o));

// ---- create, join, exit -----------------------------------------------------------------------------------------
{
  const s = run(`int shared = 5;
void *f(void *arg) { long k = (long)arg; int mine = 100; shared += k; return (void *)(k * 2 + mine); }
int main(void) {
    pthread_t a, b; void *ra, *rb;
    pthread_create(&a, NULL, f, (void *)1);
    pthread_create(&b, NULL, f, (void *)2);
    pthread_join(a, &ra); pthread_join(b, &rb);
    printf("%ld %ld %d\\n", (long)ra, (long)rb, shared);
    return 0;
}`, { snap: true });
  t.eq(s.out, '102 104 8\n', 'threads share globals, keep their own locals, and join returns their values');
  const ts = s.threads.filter((x) => x.pid === 100);
  t.eq(ts.map((x) => x.tid), [100, 101, 102], 'the main thread has the pid as its id; the others take new numbers');
  const prog = s.proc(100).prog;
  t.ok(ts[1].vm.stackLo >= prog.heapBase && ts[1].vm.stackHi <= prog.heapEnd && ts[2].vm.stackLo >= ts[1].vm.stackHi, 'each thread has a stack of its own, a block of the heap');
  t.ok(s.trace.filter((e) => e.kind === 'thread').length === 2 && s.trace.filter((e) => e.kind === 'join').length === 2, 'the trace shows two creates and two joins');
  const e = run(`void *f(void *a) { pthread_exit((void *)7); return 0; }
int main(void) { pthread_t x; void *r; pthread_create(&x, NULL, f, NULL); pthread_join(x, &r); printf("%ld\\n", (long)r); return 0; }`);
  t.eq(e.out, '7\n', 'pthread_exit gives the joiner its value');
  const x = run(`void *f(void *a) { exit(3); return 0; }
int main(void) { pthread_t x; pthread_create(&x, NULL, f, NULL); while (1) sched_yield(); return 0; }`);
  t.eq([x.proc(100).exitCode, x.status()], [3, 'done'], 'exit in any thread ends the whole process');
  const m = run(`void *f(void *a) { sleep(1); printf("thread done\\n"); return 0; }
int main(void) { pthread_t x; pthread_create(&x, NULL, f, NULL); pthread_exit(0); }`);
  t.eq([m.out, m.proc(100).exitCode], ['thread done\n', 0], 'when main calls pthread_exit, the process lives until its last thread ends');
}
// ---- mutexes and condition variables --------------------------------------------------------------------------------
{
  const counter = `int n = 0; pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *f(void *a) { int i; for (i = 0; i < 2; i++) { pthread_mutex_lock(&m); int v = n; v = v + 1; n = v; pthread_mutex_unlock(&m); } return 0; }
int main(void) { pthread_t a, b; pthread_create(&a, NULL, f, NULL); pthread_create(&b, NULL, f, NULL); pthread_join(a, NULL); pthread_join(b, NULL); printf("%d\\n", n); return 0; }`;
  const all = K.outcomes(H + counter);
  t.ok(all.complete, 'the locked counter: the enumeration completes (' + all.states + ' states)');
  t.eq([...all.outputs.keys()], ['4\n'], 'with the mutex, every schedule counts to 4');
  const racy = K.outcomes(H + counter.replace(/pthread_mutex_(un)?lock\(&m\);/g, ''));
  t.eq([...racy.outputs.keys()].sort(), ['2\n', '3\n', '4\n'], 'without it, a read-modify-write split over statements loses updates');
  const s = run(`pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *f(void *a) { pthread_mutex_lock(&m); printf("%ld\\n", (long)a); pthread_mutex_unlock(&m); return 0; }
int main(void) { pthread_t t[3]; long i; pthread_mutex_lock(&m);
  for (i = 0; i < 3; i++) pthread_create(&t[i], NULL, f, (void *)i);
  sleep(1); pthread_mutex_unlock(&m);
  for (i = 0; i < 3; i++) pthread_join(t[i], NULL); return 0; }`, { policy: 'fifo' });
  t.eq(s.out, '0\n1\n2\n', 'unlock hands the mutex to the first in its queue: FIFO order');
  t.ok(s.trace.some((e) => e.kind === 'unlock' && e.to), 'the trace shows the hand-off');
  const dl = K.outcomes(H + `pthread_mutex_t a = PTHREAD_MUTEX_INITIALIZER, b = PTHREAD_MUTEX_INITIALIZER;
void *one(void *x) { pthread_mutex_lock(&a); pthread_mutex_lock(&b); pthread_mutex_unlock(&b); pthread_mutex_unlock(&a); return 0; }
void *two(void *x) { pthread_mutex_lock(&b); pthread_mutex_lock(&a); pthread_mutex_unlock(&a); pthread_mutex_unlock(&b); return 0; }
int main(void) { pthread_t p, q; pthread_create(&p, NULL, one, NULL); pthread_create(&q, NULL, two, NULL); pthread_join(p, NULL); pthread_join(q, NULL); printf("ok\\n"); return 0; }`);
  t.ok(dl.deadlocks.size > 0 && dl.outputs.has('ok\n'), 'locks taken in opposite orders: some schedules finish, some deadlock');
  const cv = `int ready = 0, got = 0; pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER; pthread_cond_t c = PTHREAD_COND_INITIALIZER;
void *waiter(void *a) { pthread_mutex_lock(&m); while (!ready) pthread_cond_wait(&c, &m); got = 1; pthread_mutex_unlock(&m); return 0; }
int main(void) { pthread_t w; pthread_create(&w, NULL, waiter, NULL);
  pthread_mutex_lock(&m); ready = 1; pthread_cond_signal(&c); pthread_mutex_unlock(&m);
  pthread_join(w, NULL); printf("got %d\\n", got); return 0; }`;
  const cr = K.outcomes(H + cv);
  t.eq([[...cr.outputs.keys()], cr.deadlocks.size], [['got 1\n'], 0], 'a condition wait in a while loop never misses the signal');
  const lost = K.outcomes(H + cv.replace('while (!ready) pthread_cond_wait(&c, &m);', 'pthread_cond_wait(&c, &m);'));
  t.ok(lost.deadlocks.size > 0, 'waiting without checking the condition first can miss a signal sent before it waits');
}
// ---- machine granularity: count++ is a load, an add and a store ------------------------------------------------
{
  const src = H + 'int count = 0;\nvoid *bump(void *a) { count++; return 0; }\nint main(void) { pthread_t a, b; pthread_create(&a, NULL, bump, NULL); pthread_create(&b, NULL, bump, NULL); pthread_join(a, NULL); pthread_join(b, NULL); printf("%d\\n", count); return 0; }';
  t.eq([...K.outcomes(src).outputs.keys()], ['2\n'], 'a whole statement at a time, count++ never loses an update');
  const m = K.outcomes(src, { granularity: 'machine' });
  t.eq([...m.outputs.keys()].sort(), ['1\n', '2\n'], 'at machine granularity two threads doing count++ can print 1');
  const run1 = new K.System(src, { granularity: 'machine', policy: 'hand', choose: (cs) => cs[cs.length - 1] }).run();
  const steps = run1.trace.filter((e) => e.kind === 'step' && e.mstep).map((e) => e.mstep.what);
  t.ok(steps.includes('load') && steps.includes('store'), 'the steps of count++ show its load and its store');
}
// ---- semaphores ----------------------------------------------------------------------------------------------------
{
  const s = run(`sem_t s;
int main(void) { int v; sem_init(&s, 0, 2); sem_wait(&s); sem_getvalue(&s, &v); printf("%d", v);
  sem_wait(&s); printf(" %d", sem_trywait(&s)); sem_post(&s); sem_getvalue(&s, &v); printf(" %d\\n", v); return 0; }`);
  t.eq(s.out, '1 -1 1\n', 'sem_wait takes, sem_trywait fails at 0, sem_post gives back');
  const pc = `int buf[2], in = 0, out = 0; sem_t empty, full; pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *prod(void *a) { int i; for (i = 1; i <= 4; i++) { sem_wait(&empty); pthread_mutex_lock(&m); buf[in] = i; in = (in + 1) % 2; pthread_mutex_unlock(&m); sem_post(&full); } return 0; }
void *cons(void *a) { int i; for (i = 0; i < 4; i++) { sem_wait(&full); pthread_mutex_lock(&m); printf("%d", buf[out]); out = (out + 1) % 2; pthread_mutex_unlock(&m); sem_post(&empty); } printf("\\n"); return 0; }
int main(void) { pthread_t p, c; sem_init(&empty, 0, 2); sem_init(&full, 0, 0);
  pthread_create(&p, NULL, prod, NULL); pthread_create(&c, NULL, cons, NULL); pthread_join(p, NULL); pthread_join(c, NULL); return 0; }`;
  for (let seed = 1; seed <= 8; seed++) t.eq(run(pc, { seed }).out, '1234\n', 'seed ' + seed + ': the bounded buffer passes 1 2 3 4 in order');
}

// ---- random cases against an independent model of a semaphore -------------------------------------------------------
// Threads 1..3 each do a sem_wait or a sem_post in turn, under the fifo policy with sleeps to order them. The
// model: post with waiters wakes the first (FIFO) and the value stays; else the value rises; wait takes one if
// the value is positive, else queues.
for (let seed = 1; seed <= 20; seed++) {
  const r = rng(seed), init = Math.floor(r() * 2), plan = [];
  for (let i = 0; i < 4; i++) plan.push(r() < 0.5 ? 'wait' : 'post');
  // every thread k sleeps k seconds, then does its operation and prints its id
  let value = init; const queue = [], order = [];
  plan.forEach((op, k) => {
    if (op === 'post') { order.push(k); if (queue.length) order.push(queue.shift()); else value++; }
    else if (value > 0) { value--; order.push(k); } else queue.push(k);
  });
  const body = `sem_t s;
void *f(void *a) { long k = (long)a; sleep(k + 1); if (k == ${plan.indexOf('post') < 0 ? -1 : 99}) {} ${plan.map((op, k) => `if (k == ${k}) { ${op === 'wait' ? 'sem_wait(&s); printf("%ld\\n", k);' : 'printf("%ld\\n", k); sem_post(&s);'} }`).join(' ')} return 0; }
int main(void) { pthread_t t[4]; long i; sem_init(&s, 0, ${init});
  for (i = 0; i < 4; i++) pthread_create(&t[i], NULL, f, (void *)i);
  sleep(10); int v; sem_getvalue(&s, &v); printf("value %d\\n", v); return 0; }`;
  const s = run(body, { policy: 'fifo' });
  t.eq(s.out, order.map((k) => k + '\n').join('') + 'value ' + value + '\n', 'seed ' + seed + ': ' + plan.join(' ') + ' from ' + init + ' runs as the model says');
}
t.done();
