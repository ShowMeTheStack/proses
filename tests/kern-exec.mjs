// exec and copy-on-write. exec: a registered C program with its argv, the pid and descriptors kept (a redirection
// made before exec holds after it), handlers back to default but ignored signals still ignored, the stdio buffer
// lost, other threads gone, ENOENT for an unknown name. Copy-on-write: fork shares every frame; a write splits
// exactly the page written; frame refcounts always equal the page mappings that use them (an invariant checked
// at every event); exit and exec give frames back; the page size changes the count.
import { load, harness } from './load.mjs';

const t = harness('kern-exec');
const S = load(['core']);
const K = S.Kern;
const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <signal.h>\n#include <fcntl.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';
const run = (body, o) => K.run(H + body, Object.assign({ policy: 'random', seed: 1 }, o));

const show = H + 'int main(int argc, char *argv[]) { int i; for (i = 0; i < argc; i++) printf("[%s]", argv[i]); printf(" pid %d\\n", getpid()); return argc; }';
{
  const s = run(`int main(void) { pid_t k = fork();
  if (k == 0) { printf("child %d ", getpid()); fflush(stdout); execl("/usr/local/bin/show", "show", "a b", "c", NULL); exit(99); }
  int st; waitpid(k, &st, 0); printf("code %d\\n", WEXITSTATUS(st)); return 0; }`, { programs: { show } });
  t.eq(s.out, 'child 101 [show][a b][c] pid 101\ncode 3\n', 'exec runs the program by name with its argv; the pid stays');
  const v = run(`int main(void) { char *args[4]; args[0] = "show"; args[1] = "x"; args[2] = 0; execvp("show", args); return 1; }`, { programs: { show } });
  t.eq(v.out, '[show][x] pid 100\n', 'execvp takes an argv array');
  K.register('shown', show);
  t.eq(run('int main(void) { execlp("shown", "shown", NULL); return 1; }').out, '[shown] pid 100\n', 'a program registered globally is found too');
}
{
  const s = run(`int main(void) {
    int fd = open("out.txt", O_CREAT | O_WRONLY | O_TRUNC, 0644);
    dup2(fd, 1); close(fd);
    execlp("echo", "echo", "into", "the", "file", NULL);
    return 1; }`);
  t.eq(s.fs.inodes[s.fs.dir['out.txt']].data, 'into the file\n', 'a redirection made before exec holds after it');
  t.eq(s.out, '', '... so nothing reaches the terminal');
  const b = run(`int main(void) { printf("gone "); execlp("echo", "echo", "hi", NULL); return 1; }`);
  t.eq(b.out, 'hi\n', 'exec throws away what was in the stdio buffer');
  t.eq(b.trace.find((e) => e.kind === 'exec').lost, 'gone ', '... and the trace says what was lost');
  const sg = run(`void h(int s) { }
int main(void) { signal(SIGUSR1, h); signal(SIGUSR2, SIG_IGN); execl("x", "x", NULL); return 1; }`, { programs: { x: H + 'int main(void) { raise(SIGUSR2); printf("ignored still\\n"); raise(SIGUSR1); printf("no\\n"); return 0; }' } });
  t.eq([sg.out, sg.proc(100).termsig], ['ignored still\n', 10], 'after exec a caught signal is back to its default; an ignored one stays ignored');
  const e = run(`#include <errno.h>
int main(void) { int r = execlp("nothere", "nothere", NULL); printf("%d %d\\n", r, errno == ENOENT); return 0; }`);
  t.eq(e.out, '-1 1\n', 'exec of an unknown program fails with ENOENT');
  const th = run(`#include <pthread.h>
void *f(void *a) { while (1) sched_yield(); return 0; }
int main(void) { pthread_t x; pthread_create(&x, NULL, f, NULL); execlp("echo", "echo", "alone", NULL); return 1; }`);
  t.eq([th.out, th.threads.filter((x) => x.pid === 100 && x.state !== 'done').length], ['alone\n', 0], 'exec ends the other threads');
}

// ---- copy-on-write -------------------------------------------------------------------------------------------------
/** every frame's refcount equals the number of live page mappings that name it */
function cowInvariant(e, name) {
  const count = {};
  for (const p of e.snap) if (p.state !== 'zombie' && p.state !== 'reaped') for (const f of p.pages) count[f] = (count[f] || 0) + 1;
  const ok = Object.entries(e.ks.frames).every(([id, fr]) => fr.refs === (count[id] || 0)) && Object.keys(count).every((id) => e.ks.frames[id]);
  t.ok(ok, name + ': frame refcounts match the mappings at ' + e.kind);
}
{
  const src = `int g[1024];
int main(void) {
    g[0] = 1;
    pid_t k = fork();
    if (k == 0) { g[1000] = 5; exit(0); }
    wait(NULL);
    printf("%d\\n", g[1000]);
    return 0;
}`;
  const s = run(src, { snap: true, pageSize: 1024, policy: 'fifo' });
  t.eq(s.out, '0\n', 'the child\'s write is its own');
  const fork = s.trace.find((e) => e.kind === 'fork');
  const pp = fork.snap.find((p) => p.pid === 100).pages, cp = fork.snap.find((p) => p.pid === 101).pages;
  t.eq(pp, cp, 'after fork parent and child map the same frames');
  t.ok(pp.every((f) => fork.ks.frames[f].refs === 2), '... each with two references');
  const cows = s.trace.filter((e) => e.kind === 'cow');
  const page = Math.floor((s.proc(100).prog.globals.get('g').addr + 4000) / 1024);
  t.ok(cows.some((e) => e.pid === 101 && e.page === page), 'the child\'s write to g[1000] splits exactly page ' + page);
  for (const e of s.trace) if (e.snap) cowInvariant(e, 'cow');
  const sizes = [512, 2048, 4096].map((ps) => run(src, { snap: true, pageSize: ps }).trace.find((e) => e.kind === 'fork').snap.find((p) => p.pid === 101).pages.length);
  t.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], 'smaller pages, more of them: ' + sizes.join(' > '));
  const ex = run(`int main(void) { if (fork() == 0) { execlp("echo", "echo", "x", NULL); } wait(NULL); return 0; }`, { snap: true });
  for (const e of ex.trace) if (e.snap) cowInvariant(e, 'exec');
  const last = ex.trace[ex.trace.length - 1];
  t.eq(Object.keys(last.ks.frames).length, 0, 'at the end every frame is given back');
  const many = run(`int main(void) { fork(); fork(); int x = getpid(); printf("%d\\n", x > 0); wait(NULL); wait(NULL); return 0; }`, { snap: true, pageSize: 2048 });
  for (const e of many.trace) if (e.snap) cowInvariant(e, 'four processes');
}
t.done();
