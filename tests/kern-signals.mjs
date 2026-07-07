// The kernel's signals and job control: hand-worked cases (default actions, handlers on the stack and back,
// SIGCHLD, SIGPIPE, EINTR and SA_RESTART, sleep cut short, pause and alarm, stop and continue with WUNTRACED,
// process groups and the terminal's ^C and ^Z), the wait macros, and random cases checked against an independent
// model of the pending set and the mask, written here: which handlers run, in which order, as a program blocks,
// raises and unblocks signals.
import { load, harness, rng } from './load.mjs';

const t = harness('kern-signals');
const S = load(['core']);
const K = S.Kern;
const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <signal.h>\n#include <errno.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';
const run = (body, o) => K.run(H + body, Object.assign({ policy: 'random', seed: 1 }, o));
const kinds = (s) => s.trace.map((e) => e.kind);

// ---- default actions and handlers ------------------------------------------------------------------------------
{
  const s = run(`int main(void) { raise(SIGTERM); printf("not reached\\n"); return 0; }`);
  t.eq([s.out, s.proc(100).termsig, s.proc(100).status], ['', 15, 15], 'SIGTERM by default ends the process; its status is the signal');
  const s2 = run(`void h(int s) { printf("in h %d\\n", s); }
int main(void) { signal(SIGUSR2, h); printf("a\\n"); raise(SIGUSR2); printf("b\\n"); return 0; }`);
  t.eq(s2.out, 'a\nin h 12\nb\n', 'a handler runs at once for a signal a process sends itself');
  const h = s2.trace.find((e) => e.kind === 'handler'), r = s2.trace.find((e) => e.kind === 'sigreturn');
  t.ok(h && r && s2.trace.indexOf(h) < s2.trace.indexOf(r), 'the trace enters the handler, then returns from it');
  t.eq(h.depth, 1, 'one handler deep');
  const s3 = run(`int main(void) { signal(SIGINT, SIG_IGN); raise(SIGINT); signal(SIGINT, SIG_DFL); printf("alive\\n"); return 0; }`);
  t.eq(s3.out, 'alive\n', 'an ignored signal is thrown away, even after the default comes back');
  const s4 = run(`int main(void) { int r = signal(SIGKILL, SIG_IGN) == SIG_ERR; printf("%d %d\\n", r, errno == EINVAL); raise(SIGKILL); printf("no\\n"); return 0; }`);
  t.eq([s4.out, s4.proc(100).termsig], ['1 1\n', 9], 'SIGKILL cannot be ignored');
  const s5 = run(`int main(void) { raise(SIGCHLD); printf("chld ignored by default\\n"); return 0; }`);
  t.eq(s5.out, 'chld ignored by default\n', 'SIGCHLD is ignored by default');
}
// ---- the wait macros on every kind of status ----------------------------------------------------------------------
{
  const s = run(`int main(void) {
    pid_t a = fork(); if (a == 0) exit(7);
    pid_t b = fork(); if (b == 0) { raise(SIGSEGV); }
    pid_t c = fork(); if (c == 0) { while (1) pause(); }
    int st;
    waitpid(a, &st, 0); printf("%d %d %d\\n", WIFEXITED(st), WEXITSTATUS(st), WIFSIGNALED(st));
    waitpid(b, &st, 0); printf("%d %d %d\\n", WIFEXITED(st), WIFSIGNALED(st), WTERMSIG(st));
    kill(c, SIGSTOP);
    waitpid(c, &st, WUNTRACED); printf("%d %d %d\\n", WIFSTOPPED(st), WSTOPSIG(st), WIFSIGNALED(st));
    kill(c, SIGCONT);
    waitpid(c, &st, WCONTINUED); printf("%d\\n", WIFCONTINUED(st));
    kill(c, SIGKILL);
    waitpid(c, &st, 0); printf("%d %d\\n", WIFSIGNALED(st), WTERMSIG(st));
    return 0;
  }`);
  t.eq(s.out, '1 7 0\n0 1 11\n1 19 0\n1\n1 9\n', 'exit, signal, stop and continue statuses decode right');
}
// ---- SIGCHLD reaping, done right with sigsuspend --------------------------------------------------------------------
{
  const src = `int reaped = 0;
void onchld(int s) { while (waitpid(-1, 0, WNOHANG) > 0) reaped++; }
int main(void) {
    sigset_t blk, old;
    sigemptyset(&blk); sigaddset(&blk, SIGCHLD);
    sigprocmask(SIG_BLOCK, &blk, &old);
    signal(SIGCHLD, onchld);
    int i;
    for (i = 0; i < 3; i++) if (fork() == 0) _exit(0);
    while (reaped < 3) sigsuspend(&old);
    printf("reaped %d\\n", reaped);
    return 0;
}`;
  for (let seed = 1; seed <= 6; seed++) { const s = run(src, { seed }); t.eq(s.out, 'reaped 3\n', 'seed ' + seed + ': a SIGCHLD handler reaps all three'); t.ok(s.procs.every((p) => p.role !== 'prog' || p.state === 'reaped'), 'seed ' + seed + ': no zombie is left'); }
  const all = K.outcomes(H + src);
  t.eq([...all.outputs.keys()], ['reaped 3\n'], 'over every schedule: sigsuspend closes the race');
  t.eq(all.deadlocks.size, 0, '... and never hangs');
  const racy = K.outcomes(H + src.replace('while (reaped < 3) sigsuspend(&old);', 'sigprocmask(SIG_SETMASK, &old, NULL);\n    while (reaped < 3) pause();'));
  t.ok(racy.deadlocks.size > 0, 'with pause instead, some schedule loses the last SIGCHLD and hangs');
}
// ---- interrupted calls ------------------------------------------------------------------------------------------
{
  // sigaction's struct, as the kernel reads it: handler at 0, mask at 8, flags at 12
  const act = (flags) => `long act[2]; act[0] = (long)h; act[1] = (long)${flags} << 32; sigaction(SIGALRM, (void *)act, NULL);`;
  const intr = (flags) => run(`void h(int s) { printf("h\\n"); }
int main(void) { ${act(flags)} alarm(1); char c; int n = read(0, &c, 1); printf("%d %d %c\\n", n, errno == EINTR, n == 1 ? c : '-'); return 0; }`, { eof: false });
  const a = intr(0);
  t.eq(a.out, 'h\n-1 1 -\n', 'a read without SA_RESTART fails with EINTR after the handler');
  const b = intr('SA_RESTART');
  t.eq([b.out, b.status()], ['h\n', 'input'], 'with SA_RESTART the read starts again and waits on');
  b.type('q\n'); b.run();
  t.eq(b.out, 'h\n1 0 q\n', '... and returns the byte once one is typed');
  const sl = run(`void h(int s) { }
int main(void) { signal(SIGALRM, h); alarm(2); int left = sleep(10); printf("left %d\\n", left); return 0; }`);
  t.eq(sl.out, 'left 8\n', 'sleep cut short by a handled alarm returns the seconds left');
  const pa = run(`void h(int s) { printf("ring\\n"); }
int main(void) { signal(SIGALRM, h); alarm(1); int r = pause(); printf("%d %d\\n", r, errno == EINTR); return 0; }`);
  t.eq(pa.out, 'ring\n-1 1\n', 'pause returns -1 with EINTR once a handler has run');
  const w = run(`void h(int s) { printf("h\\n"); }
int main(void) { signal(SIGUSR1, h); pid_t k = fork(); if (k == 0) { kill(getppid(), SIGUSR1); sleep(1); exit(3); }
  int st; int r = waitpid(k, &st, 0); printf("%d %d\\n", r == k, WEXITSTATUS(st)); return 0; }`);
  t.eq(w.out, 'h\n1 3\n', 'a wait interrupted by a handler set with signal() restarts');
}
// ---- masks and pending signals ------------------------------------------------------------------------------------
{
  const s = run(`void h(int s) { printf("h%d\\n", s); }
int main(void) {
    sigset_t m, p;
    signal(SIGUSR1, h); signal(SIGUSR2, h);
    sigemptyset(&m); sigaddset(&m, SIGUSR1); sigaddset(&m, SIGUSR2);
    sigprocmask(SIG_BLOCK, &m, NULL);
    raise(SIGUSR2); raise(SIGUSR1); raise(SIGUSR1);
    sigpending(&p);
    printf("pending %d %d\\n", sigismember(&p, SIGUSR1), sigismember(&p, SIGUSR2));
    sigprocmask(SIG_UNBLOCK, &m, NULL);
    printf("done\\n");
    return 0;
}`);
  t.eq(s.out, 'pending 1 1\nh12\nh10\ndone\n', 'blocked signals wait; one of each is kept; SIGUSR1 is set up first, so SIGUSR2\'s handler, set up on top of it, runs first');
}
// ---- job control: groups, the terminal, stop and continue ----------------------------------------------------------
{
  const src = `int main(void) {
    pid_t k = fork();
    if (k == 0) { setpgid(0, 0); while (1) sleep(1); }
    setpgid(k, k);
    tcsetpgrp(0, k);
    int st;
    waitpid(k, &st, WUNTRACED);
    printf("stopped %d\\n", WIFSTOPPED(st));
    tcsetpgrp(0, getpgrp());
    kill(k, SIGCONT);
    kill(-k, SIGTERM);
    waitpid(k, &st, 0);
    printf("term %d\\n", WTERMSIG(st));
    return 0;
}`;
  const s = new K.System(H + src, { policy: 'fifo' });
  for (let i = 0; i < 60 && s.status() === 'running'; i++) { s.advance(); s.step(s.pick()); if (s.tty.fg === 101) break; }
  t.eq(s.tty.fg, 101, 'the parent gives the terminal to the child\'s group');
  s.press('Z');
  s.run();
  t.eq(s.out, 'stopped 1\nterm 15\n', '^Z stops the foreground job; the parent sees it with WUNTRACED, then ends it');
  t.ok(kinds(s).includes('stop') && kinds(s).includes('cont'), 'the trace shows the stop and the continue');
  const c = new K.System(H + 'int main(void) { while (1) sleep(1); return 0; }', {});
  for (let i = 0; i < 10; i++) { c.advance(); c.step(c.pick()); }
  c.press('C');
  c.run();
  t.eq(c.proc(100).termsig, 2, '^C ends a program that does not catch SIGINT');
}

// ---- timed enumeration: sleep orders processes ----------------------------------------------------------------------
{
  const src = H + `int main(void) { int i, naps[3] = {3, 1, 2};
  for (i = 0; i < 3; i++) if (fork() == 0) { sleep(naps[i]); printf("%d\\n", i); exit(0); }
  while (wait(NULL) > 0); printf("done\\n"); return 0; }`;
  const free = K.outcomes(src), timed = K.outcomes(src, { sleep: 'timed' });
  t.eq(free.outputs.size, 6, 'with sleep as a mere yield, the three children print in any of 6 orders');
  t.eq([...timed.outputs.keys()], ['1\n2\n0\ndone\n'], 'with timed sleep, only the order of their deadlines');
  const tie = K.outcomes(H + 'int main(void) { if (fork() == 0) { sleep(1); printf("a\\n"); exit(0); } sleep(1); printf("b\\n"); wait(NULL); return 0; }', { sleep: 'timed' });
  t.eq([...tie.outputs.keys()].sort(), ['a\nb\n', 'b\na\n'], 'equal deadlines: both orders');
  const al = K.outcomes(H + 'void h(int s) { printf("ring\\n"); }\nint main(void) { signal(SIGALRM, h); alarm(2); sleep(1); printf("one\\n"); pause(); printf("end\\n"); return 0; }', { sleep: 'timed' });
  t.eq([...al.outputs.keys()], ['one\nring\nend\n'], 'alarms keep their deadlines too');
}

// ---- random cases against an independent model of pending sets and masks -------------------------------------------
// The model: pending is a set; raise(s) adds s (an unblocked one is delivered at once); unblocking delivers the
// pending ones that are now unblocked: the kernel sets up a handler frame for each, lowest number first, before
// any of them runs, so the last set up runs first (as Linux does). Each handler prints its number.
for (let seed = 1; seed <= 30; seed++) {
  const r = rng(seed), sigs = [10, 12, 14], lines = [], expect = [];
  let mask = new Set(), pending = new Set();
  const deliver = () => { const now = [...pending].sort((a, b) => a - b).filter((s) => !mask.has(s)); for (const s of now) pending.delete(s); expect.push(...now.reverse()); };
  for (let i = 0; i < 8; i++) {
    const s = sigs[Math.floor(r() * 3)], op = r();
    if (op < 0.45) { lines.push(`raise(${s});`); pending.add(s); deliver(); }
    else if (op < 0.75) { lines.push(`sigemptyset(&m); sigaddset(&m, ${s}); sigprocmask(SIG_BLOCK, &m, NULL);`); mask.add(s); }
    else { lines.push(`sigemptyset(&m); sigaddset(&m, ${s}); sigprocmask(SIG_UNBLOCK, &m, NULL);`); mask.delete(s); deliver(); }
  }
  const s = run(`void h(int s) { printf("%d\\n", s); }
int main(void) {
    sigset_t m;
    signal(10, h); signal(12, h); signal(14, h);
    ${lines.join('\n    ')}
    printf("end\\n");
    return 0;
}`, { seed });
  t.eq(s.out, expect.map((x) => x + '\n').join('') + 'end\n', 'seed ' + seed + ': handlers run as the model says');
}
t.done();
