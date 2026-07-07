// The kernel's step API, as a model checker uses it: choices, step, clone, hash, footprint and status; the same
// seed giving the same trace; and random programs (forks, pipes, waits, signals) where every seeded run's output
// must be one the enumerator lists, and the invariants hold at the end (every process reaped, no open file or
// pipe left).
import { load, harness, rng } from './load.mjs';

const t = harness('kern-step');
const S = load(['core']);
const K = S.Kern;
const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <signal.h>\n#include <pthread.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';

{
  const sys = new K.System(H + `int g = 0; pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *f(void *a) { int local = 1; local = local + 1; pthread_mutex_lock(&m); g = g + local; pthread_mutex_unlock(&m); return 0; }
int main(void) { pthread_t x; pthread_create(&x, NULL, f, NULL); printf("hi\\n"); pthread_join(x, NULL); if (fork() == 0) exit(0); wait(NULL); return 0; }`, { sleep: 'free', policy: 'hand', cow: false });
  t.eq(sys.choices(), [100], 'at first only the main thread can run');
  t.eq(sys.status(), 'running', 'status: running');
  const prints = [];
  let footFork = null, footPrint = null, footLock = null, footGlobal = null, footLocal = null;
  for (let i = 0; i < 400 && sys.choices().length; i++) {
    const cs = sys.choices(), c = cs[cs.length - 1];
    const fp = sys.footprint(c), before = sys.hash();
    const copy = sys.clone();
    const evs = sys.step(c);
    t.eq(copy.hash(), before, 'step ' + i + ': stepping the original leaves a clone as it was');
    const thr = sys.thread(c);
    if (evs.some((e) => e.kind === 'fork')) footFork = fp;
    if (evs.some((e) => e.kind === 'print')) footPrint = fp;
    if (evs.some((e) => e.kind === 'lock')) footLock = fp;
    if (thr && thr.tid !== 100 && !footGlobal && fp.w.some((x) => x.startsWith('mem:100:'))) footGlobal = fp;
    if (thr && thr.tid !== 100 && evs.length === 1 && evs[0].kind === 'step' && !footLocal) footLocal = fp;
    prints.push(...evs.filter((e) => e.kind === 'print').map((e) => e.text));
  }
  t.eq(sys.status(), 'done', 'status: done at the end');
  t.ok(footFork && footFork.w.includes('pid'), 'a fork writes the pid counter');
  t.ok(footPrint && footPrint.w.includes('out'), 'a write to the terminal writes the output');
  t.ok(footLock && footLock.w.some((x) => x.startsWith('mutex:')), 'a lock touches its mutex');
  t.ok(footGlobal, 'a thread\'s statement on a global touches that word of memory');
  t.ok(footLocal && !footLocal.w.length && !footLocal.r.length, 'a statement on a thread\'s own locals touches nothing shared');
  const a = new K.System(H + 'int main(void) { if (fork() == 0) { printf("c\\n"); exit(0); } printf("p\\n"); wait(NULL); return 0; }', { sleep: 'free', policy: 'hand', cow: false });
  a.step(100); a.step(100);
  const b1 = a.clone(), b2 = a.clone();
  b1.step(101); b2.step(101);
  t.eq(b1.hash(), b2.hash(), 'the same choice from the same state gives the same hash');
  const b3 = a.clone(); b3.step(100);
  t.ok(b3.hash() !== b1.hash(), 'a different choice gives a different state');
  const g = new K.System(H + 'int main(void) { printf("x\\n"); return 0; }', { granularity: 'machine' }).run();
  t.eq(g.out, 'x\n', 'the machine granularity option is accepted (statements until the machine supports it)');
}

// ---- how a run ended is part of the state ----------------------------------------------------------------------------
// A thread races main to set g before main forks; the child exits with g (or crashes when g is set), and the
// parent prints nothing: the runs differ only in how the child ended, after it has been reaped.
{
  const end = (body) => {
    const src = H + 'int g = 0;\nvoid *f(void *a) { g = 1; return 0; }\nint main(void) { pthread_t x; pthread_create(&x, NULL, f, NULL);\n  pid_t k = fork();\n  if (k == 0) { ' + body + ' }\n  wait(NULL); pthread_join(x, NULL); return 0; }';
    const first = K.run(src, { sleep: 'free', policy: 'hand', choose: (cs) => cs[0] });
    const last = K.run(src, { sleep: 'free', policy: 'hand', choose: (cs) => cs[cs.length - 1] });
    return [first, last];
  };
  const [a, b] = end('exit(g);');
  const kid = (s) => s.procs.find((p) => p.role === 'prog' && p.pid !== 100), ca = kid(a), cb = kid(b);
  t.ok(ca.state === 'reaped' && cb.state === 'reaped' && ca.exitCode !== cb.exitCode && a.out === b.out, 'two runs differ only in the reaped child\'s exit code (' + ca.exitCode + ', ' + cb.exitCode + ')');
  t.ok(a.hash() !== b.hash(), '... and their states hash differently');
  const [c, d] = end('if (g) { int *p = 0; *p = 1; } exit(0);');
  t.ok((!!c.failure) !== (!!d.failure), 'one run crashes and the other does not');
  t.ok(c.hash() !== d.hash(), '... and their states hash differently, after the reap too');
  const f = c.failure || d.failure;
  t.eq([f.pid, f.signal], [kid(c.failure ? c : d).pid, 11], 'sys.failure names the process and its signal');
}

// ---- same seed, same trace --------------------------------------------------------------------------------------
{
  const src = H + `void h(int s) { printf("sig\\n"); }
int main(void) { int fd[2]; char b[8]; signal(SIGUSR1, h); pipe(fd);
  pid_t k = fork(); if (k == 0) { kill(getppid(), SIGUSR1); write(fd[1], "abc", 3); exit(0); }
  close(fd[1]); int n = read(fd[0], b, 8); printf("%d\\n", n); wait(NULL); return 0; }`;
  for (const seed of [1, 7, 21]) t.eq(JSON.stringify(K.run(src, { policy: 'random', seed }).trace), JSON.stringify(K.run(src, { policy: 'random', seed }).trace), 'seed ' + seed + ': same seed, same trace');
}

// ---- random programs ------------------------------------------------------------------------------------------------
// Each is a few forks, each child writing a letter into a shared pipe or printing it, the parent reading the pipe
// to its end and waiting; sometimes a child is killed. Checks: a seeded run's output is one the enumerator lists;
// everything is reaped and closed at the end.
for (let seed = 1; seed <= 15; seed++) {
  const r = rng(seed), n = 1 + Math.floor(r() * 3), parts = [];
  for (let i = 0; i < n; i++) {
    const via = r() < 0.5 ? `write(fd[1], "${'abc'[i]}", 1);` : `printf("${'xyz'[i]}\\n");`;
    const killed = r() < 0.25;
    parts.push(`k[${i}] = fork(); if (k[${i}] == 0) { close(fd[0]); ${via} ${killed ? 'raise(SIGTERM);' : ''} exit(${i}); }`);
  }
  const src = H + `int main(void) { int fd[2], k[3], n, st, i; char b[8]; pipe(fd);
  ${parts.join('\n  ')}
  close(fd[1]);
  while ((n = read(fd[0], b, 8)) > 0) { b[n] = 0; printf("[%s]\\n", b); }
  close(fd[0]);
  for (i = 0; i < ${n}; i++) { waitpid(k[i], &st, 0); printf("%d:%d\\n", i, WIFSIGNALED(st) ? -WTERMSIG(st) : WEXITSTATUS(st)); }
  return 0; }`;
  const all = K.outcomes(src);
  t.ok(all.complete, 'random ' + seed + ': the enumeration completes (' + all.states + ' states)');
  for (const s2 of [1, 2, 3, 4]) {
    const sys = K.run(src, { policy: 'random', seed: s2 * 31 + seed });
    t.ok(all.outputs.has(sys.out), 'random ' + seed + ' run ' + s2 + ': its output is enumerated');
    t.ok(sys.procs.every((p) => p.role !== 'prog' || p.state === 'reaped'), 'random ' + seed + ' run ' + s2 + ': all reaped');
    t.eq([Object.keys(sys.ofiles).length, Object.keys(sys.pipes).length], [0, 0], 'random ' + seed + ' run ' + s2 + ': no open file or pipe left');
  }
}
t.done();
