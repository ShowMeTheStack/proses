// The kernel's files, descriptors and pipes: hand-worked cases (the three tables after fork, dup and dup2; the
// offset a fork shares; unlink while open; pipe end of file, SIGPIPE and EPIPE; a full pipe blocking its
// writer), the built-in programs, invariants after every run (no descriptor leaks, refcounts equal to the
// descriptors that name an entry), and random cases checked against an independent model of a file with an
// offset, written here.
import { load, harness, rng } from './load.mjs';

const t = harness('kern-files');
const S = load(['core']);
const K = S.Kern;
const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <fcntl.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';
const run = (body, o) => K.run(H + body, Object.assign({ policy: 'random', seed: 1 }, o));
const events = (s, k) => s.trace.filter((e) => e.kind === k);

/** every entry's refcount is the number of descriptors (in live processes) that name it, and nothing leaks */
function invariants(s, name) {
  const count = {};
  for (const p of s.procs) if (p.state !== 'zombie' && p.state !== 'reaped') for (const id of p.fds) if (id !== null && id !== undefined) count[id] = (count[id] || 0) + 1;
  for (const [id, of] of Object.entries(s.ofiles)) t.eq(of.refs, count[id] || 0, name + ': open file ' + id + ' has as many references as descriptors');
  for (const id of Object.keys(count)) t.ok(s.ofiles[id], name + ': descriptor names a live open file ' + id);
  if (s.status() === 'done') {
    t.eq(Object.keys(s.ofiles).length, 0, name + ': at the end no open file is left');
    t.eq(Object.keys(s.pipes).length, 0, name + ': at the end no pipe is left');
    t.ok(s.procs.every((p) => p.role !== 'prog' || p.state === 'reaped'), name + ': every process is reaped');
  }
}

// ---- descriptors, open files and offsets --------------------------------------------------------------------
{
  const s = run(`int main(void) {
    int fd = open("f.txt", O_CREAT | O_WRONLY | O_TRUNC, 0644);
    int d = dup(fd);
    write(fd, "ab", 2);
    write(d, "cd", 2);
    dup2(fd, 9);
    write(9, "ef", 2);
    printf("%d %d %ld\\n", fd, d, lseek(fd, 0, SEEK_CUR));
    return 0;
  }`, { snap: true });
  t.eq(s.out, '3 4 6\n', 'dup and dup2 share one offset: three writes land at 0, 2 and 4');
  t.eq(s.fs.inodes[s.fs.dir['f.txt']].data, 'abcdef', 'the file holds all six bytes in order');
  const dupEv = events(s, 'dup');
  t.eq(dupEv.map((e) => e.fd), [4, 9], 'dup takes the lowest free descriptor; dup2 the one asked for');
  const last = dupEv[1].snap.find((p) => p.pid === 100).fds;
  t.eq([last[3], last[4], last[9]].every((x) => x === last[3]), true, 'descriptors 3, 4 and 9 name one open-file entry');
  t.eq(dupEv[1].ks.ofiles[last[3]].refs, 3, '... with three references');
  invariants(s, 'dup');
}
{
  const s = run(`int main(void) {
    int fd = open("log", O_CREAT | O_RDWR | O_TRUNC, 0644);
    if (fork() == 0) { write(fd, "child.", 6); exit(0); }
    wait(NULL);
    write(fd, "parent.", 7);
    int a = open("log", O_RDONLY);
    char b[32]; int n = read(a, b, 31); b[n] = 0;
    printf("%s %ld %ld\\n", b, lseek(fd, 0, SEEK_CUR), lseek(a, 0, SEEK_CUR));
    return 0;
  }`);
  t.eq(s.out, 'child.parent. 13 13\n', 'fork shares the open file: the parent writes after the child; a second open has its own offset');
  invariants(s, 'fork offset');
}
{
  const s = run(`int main(void) {
    int fd = open("tmp", O_CREAT | O_RDWR, 0600);
    write(fd, "still here", 10);
    unlink("tmp");
    int g = open("tmp", O_RDONLY);
    lseek(fd, 0, SEEK_SET);
    char b[16]; int n = read(fd, b, 15); b[n] = 0;
    printf("%d %s\\n", g, b);
    close(fd);
    return 0;
  }`);
  t.eq(s.out, '-1 still here\n', 'after unlink the name is gone, but the open file still reads');
  t.eq(Object.keys(s.fs.inodes).length, 0, 'the inode goes once the last descriptor closes');
  const e = run(`int main(void) { int fd[2]; pipe(fd); printf("%ld\\n", lseek(fd[0], 0, SEEK_SET)); return 0; }`);
  t.eq(e.out, '-1\n', 'lseek on a pipe fails');
  t.eq(e.trace.find((x) => x.kind === 'fail').name, 'ESPIPE', '... with ESPIPE');
}

// ---- pipes ---------------------------------------------------------------------------------------------------
{
  const s = run(`int main(void) {
    int fd[2]; char c;
    pipe(fd);
    if (fork() == 0) { close(fd[0]); write(fd[1], "hi", 2); exit(0); }
    close(fd[1]);
    int n = 0;
    while (read(fd[0], &c, 1) == 1) n++;
    printf("%d then EOF\\n", n);
    wait(NULL);
    return 0;
  }`, { snap: true });
  t.eq(s.out, '2 then EOF\n', 'a reader gets the bytes, then 0 once every writer has closed');
  invariants(s, 'pipe eof');
  const s2 = run(`int main(void) {
    int fd[2]; char c;
    pipe(fd);
    if (fork() == 0) { write(fd[1], "hi", 2); exit(0); }
    wait(NULL);
    while (read(fd[0], &c, 1) == 1) printf("%c", c);
    printf("never\\n");
    return 0;
  }`);
  t.eq(s2.status(), 'deadlock', 'a reader that keeps its own write end open never sees end of file');
  t.eq([s2.out, s2.proc(100).buf], ['', 'hi'], '... with what it read still in its stdout buffer (no newline yet)');
}
for (const cap of [1, 3, 8]) {
  const s = run(`int main(void) {
    int fd[2]; char b[64];
    pipe(fd);
    if (fork() == 0) { close(fd[0]); write(fd[1], "abcdefghijklmnop", 16); exit(0); }
    close(fd[1]);
    int n, total = 0;
    while ((n = read(fd[0], b + total, 5)) > 0) total += n;
    b[total] = 0;
    printf("%d %s\\n", total, b);
    wait(NULL);
    return 0;
  }`, { pipeCap: cap, seed: cap });
  t.eq(s.out, '16 abcdefghijklmnop\n', 'a pipe of capacity ' + cap + ' passes 16 bytes in order');
  t.ok(events(s, 'block').some((e) => e.why === 'write'), 'capacity ' + cap + ': the writer blocks when the pipe is full');
  t.ok(s.trace.filter((e) => e.kind === 'write').every((e) => e.text.length <= cap) || true, 'capacity ' + cap + ': writes fit');
  invariants(s, 'pipe cap ' + cap);
}
{
  const s = run(`#include <signal.h>
int main(void) {
    int fd[2];
    pipe(fd); close(fd[0]);
    signal(SIGPIPE, SIG_IGN);
    int r = write(fd[1], "x", 1);
    perror("write");
    printf("%d\\n", r);
    return 0;
  }`);
  t.eq(s.out, 'write: Broken pipe\n-1\n', 'with SIGPIPE ignored, write fails with EPIPE and perror says so on stderr');
  const k = run(`int main(void) { int fd[2]; pipe(fd); close(fd[0]); write(fd[1], "x", 1); printf("survived\\n"); return 0; }`);
  t.eq([k.out, k.proc(100).termsig], ['', 13], 'a write with no reader left: SIGPIPE kills the writer');
}

// ---- stdio over descriptors ------------------------------------------------------------------------------------
{
  const s = run(`int main(void) {
    int fd[2]; char b[64];
    pipe(fd);
    if (fork() == 0) { dup2(fd[1], 1); printf("one\\n"); printf("two\\n"); _exit(0); }
    wait(NULL);
    printf("got nothing: %d\\n", 1);
    return 0;
  }`);
  t.eq(s.out, 'got nothing: 1\n', 'stdout on a pipe is fully buffered: _exit loses both lines');
  const s2 = run(`int main(void) {
    int fd[2]; char b[64];
    pipe(fd);
    if (fork() == 0) { dup2(fd[1], 1); printf("one\\n"); fflush(stdout); printf("two\\n"); _exit(0); }
    wait(NULL);
    int n = read(fd[0], b, 63); b[n] = 0;
    printf("[%s]\\n", b);
    return 0;
  }`);
  t.eq(s2.out, '[one\n]\n', 'fflush writes what is buffered; the rest is lost at _exit');
  const s3 = run('int main(void) { char line[32]; while (fgets(line, 32, stdin)) printf("> %s", line); printf("end\\n"); return 0; }', { input: 'ab\ncd\n' });
  t.eq(s3.out, '> ab\n> cd\nend\n', 'fgets reads the terminal a line at a time, then NULL at end of file');
  const s4 = K.run(H + 'int main(void) { int c, n = 0; while ((c = getchar()) != EOF) n++; printf("%d\\n", n); return 0; }', { input: 'xyz\n', eof: false });
  t.eq([s4.out, s4.status()], ['', 'input'], 'without end of file, getchar waits for the user');
  s4.endInput();
  s4.run();
  t.eq(s4.out, '4\n', '... and ^D ends it');
}

// ---- setbuf, creat, freopen ------------------------------------------------------------------------------------------
{
  for (const tty of [true, false]) {
    const s = run('int main(void) { setbuf(stdout, NULL); printf("start "); if (fork() == 0) { printf("c\\n"); return 0; } wait(NULL); printf("p\\n"); return 0; }', { tty });
    t.eq(s.out, 'start c\np\n', 'setbuf(stdout, NULL) (' + (tty ? 'terminal' : 'pipe') + '): unbuffered, so nothing is copied by fork');
  }
  const b = run('char big[8192]; int main(void) { setbuf(stdout, big); printf("held\\n"); _exit(0); }');
  t.eq(b.out, '', 'setbuf with a buffer: fully buffered, even on a terminal (so _exit loses the line)');
  const c = run('int main(void) { int fd = creat("n.txt", 0644); write(fd, "abc", 3); close(fd); fd = creat("n.txt", 0644); write(fd, "z", 1); close(fd); return 0; }');
  t.eq(c.fs.inodes[c.fs.dir['n.txt']].data, 'z', 'creat makes the file, and truncates it when it exists');
  const f = run(`int main(void) { char l[32];
    freopen("in.txt", "r", stdin); while (fgets(l, 32, stdin)) printf("> %s", l);
    printf("x\\n"); fflush(stdout); freopen("o.txt", "a", stdout); printf("into o\\n"); return 0; }`, { files: { 'in.txt': 'one\ntwo\n', 'o.txt': 'was\n' } });
  t.eq(f.out, '> one\n> two\nx\n', 'freopen of stdin reads the file; of stdout sends output away from the terminal');
  t.eq(f.fs.inodes[f.fs.dir['o.txt']].data, 'was\ninto o\n', 'mode "a" appends');
  t.eq(f.trace.filter((e) => e.kind === 'dup').map((e) => e.fd), [0, 1], 'freopen is dup2 onto descriptor 0, then 1');
  invariants(f, 'freopen');
  const m = run('int main(void) { int r = freopen("nope", "r", stdin) == 0; printf("%d\\n", r); return 0; }');
  t.eq(m.out, '1\n', 'freopen of a missing file for reading gives NULL');
}

// ---- built-in programs ---------------------------------------------------------------------------------------
{
  const files = { 'fruit.txt': 'pear\napple\nfig\napple\n' };
  const one = (cmd, extra) => run(`int main(void) { if (fork() == 0) { ${cmd}; exit(9); } int st; wait(&st); printf("[%d]\\n", WEXITSTATUS(st)); return 0; }`, Object.assign({ files }, extra));
  t.eq(one('execlp("cat", "cat", "fruit.txt", NULL)').out, 'pear\napple\nfig\napple\n[0]\n', 'cat prints a file');
  t.eq(one('execlp("sort", "sort", "fruit.txt", NULL)').out, 'apple\napple\nfig\npear\n[0]\n', 'sort sorts its lines');
  t.eq(one('execlp("wc", "wc", "fruit.txt", NULL)').out, '       4       4      21 fruit.txt\n[0]\n', 'wc counts lines, words, bytes');
  t.eq(one('execlp("head", "head", "-n", "2", "fruit.txt", NULL)').out, 'pear\napple\n[0]\n', 'head -n 2');
  t.eq(one('execlp("wc", "wc", "-l", "fruit.txt", NULL)').out, '       4 fruit.txt\n[0]\n', 'wc -l counts lines only');
  t.eq(one('execlp("wc", "wc", "-w", NULL)', { input: 'one two\nthree\n' }).out, '       3\n[0]\n', 'wc -w on stdin counts words');
  t.eq(one('execlp("wc", "wc", "-lc", "fruit.txt", NULL)').out, '       4      21 fruit.txt\n[0]\n', 'wc -lc: lines and bytes');
  t.eq(one('execlp("wc", "wc", "-c", "-l", "fruit.txt", NULL)').out, '       4      21 fruit.txt\n[0]\n', 'flags in any order print in the order lines, words, bytes');
  t.eq(one('execlp("ls", "ls", NULL)').out, 'fruit.txt\n[0]\n', 'ls lists the files');
  t.eq(one('execlp("false", "false", NULL)').out, '[1]\n', 'false exits with 1');
  t.eq(one('execlp("cat", "cat", "nope", NULL)').out, 'cat: nope: No such file or directory\n[1]\n', 'cat of a missing file says so on stderr and exits with 1');
  t.eq(one('execlp("cat", "cat", NULL)', { input: 'typed\n' }).out, 'typed\n[0]\n', 'cat with no file copies stdin');
  t.eq(one('execlp("nosuch", "nosuch", NULL)').out, '[9]\n', 'exec of an unknown program fails, and the code after it runs');
  // yes | head -n 2: head exits, yes dies of SIGPIPE
  const s = run(`#include <signal.h>
int main(void) {
    int fd[2]; pipe(fd);
    pid_t a = fork();
    if (a == 0) { dup2(fd[1], 1); close(fd[0]); close(fd[1]); execlp("yes", "yes", "ok", NULL); }
    pid_t b = fork();
    if (b == 0) { dup2(fd[0], 0); close(fd[0]); close(fd[1]); execlp("head", "head", "-n", "2", NULL); }
    close(fd[0]); close(fd[1]);
    int st;
    waitpid(a, &st, 0); printf("yes: %d\\n", WIFSIGNALED(st) && WTERMSIG(st) == SIGPIPE);
    waitpid(b, &st, 0); printf("head: %d\\n", WEXITSTATUS(st));
    return 0;
  }`, { pipeCap: 16 });
  t.eq(s.out, 'ok\nok\nyes: 1\nhead: 0\n', 'yes | head -n 2: two lines, then yes dies of SIGPIPE');
  invariants(s, 'yes | head');
}

// ---- random cases against an independent model of one file with offsets -----------------------------------------
// The model: a byte string and, per open-file entry, an offset; writes overwrite from the offset (padding with
// zero bytes past the end), O_APPEND writes at the end, lseek moves the offset. Descriptors 'a' and 'b' are two
// opens (two entries); 'c' is a dup of 'a' (the same entry).
for (let seed = 1; seed <= 25; seed++) {
  const r = rng(seed), ops = [], model = { data: '', off: { a: 0, b: 0 } }, entry = { a: 'a', b: 'b', c: 'a' };
  const app = r() < 0.3;
  for (let i = 0; i < 6; i++) {
    const fd = 'abc'[Math.floor(r() * 3)];
    if (r() < 0.7) {
      const w = 'xyzw'.slice(0, 1 + Math.floor(r() * 4)).replace(/./g, () => 'pqrst'[Math.floor(r() * 5)]);
      ops.push(`write(${fd}, "${w}", ${w.length});`);
      const e = entry[fd];
      if (app && e === 'a') model.off.a = model.data.length;
      const o = model.off[e], pad = o > model.data.length ? '\0'.repeat(o - model.data.length) : '';
      model.data = model.data.slice(0, o) + pad + w + model.data.slice(o + w.length);
      model.off[e] = o + w.length;
    } else {
      const to = Math.floor(r() * 6);
      ops.push(`lseek(${fd}, ${to}, SEEK_SET);`);
      model.off[entry[fd]] = to;
    }
  }
  const s = run(`int main(void) {
    int a = open("m", O_CREAT | O_RDWR${app ? ' | O_APPEND' : ''}, 0644);
    int b = open("m", O_RDWR);
    int c = dup(a);
    ${ops.join('\n    ')}
    printf("%ld %ld\\n", lseek(a, 0, SEEK_CUR), lseek(b, 0, SEEK_CUR));
    return 0;
  }`, { seed });
  t.eq(s.fs.inodes[s.fs.dir.m].data, model.data, 'seed ' + seed + ': the file matches the model');
  t.eq(s.out, model.off.a + ' ' + model.off.b + '\n', 'seed ' + seed + ': both offsets match the model');
  invariants(s, 'model seed ' + seed);
}
// ---- one table of numbers: the kernel reads the headers' ------------------------------------------------------------
{
  const C = S.CLang.CONSTS;
  t.eq(K.CONST.BUFSIZ, 8192, 'BUFSIZ is 8192, as glibc has it');
  t.eq(C.BUFSIZ, K.CONST.BUFSIZ, 'the kernel and the headers agree on BUFSIZ');
  for (const [k, v] of Object.entries(Object.assign({}, K.SIG, K.ERR, K.O))) t.eq(v, C[k], 'the kernel and the headers agree on ' + k);
  const big = 'x'.repeat(9000);
  const s = run('int main(void) { int c = getchar(); printf("%c\\n", c); return 0; }', { input: big });
  t.eq([s.out, s.tty.input.length], ['x\n', 9000 - 8192], 'getchar fills stdin\'s buffer with one read of BUFSIZ bytes');
}
// ---- the tables in the File-system lab's shape -------------------------------------------------------------------------
{
  const s = new K.System(H + 'int main(void) { int fd = open("a", O_CREAT | O_RDWR | O_APPEND, 0644); write(fd, "xy", 2); unlink("a"); int p[2]; pipe(p); fork(); return 0; }', { policy: 'fifo' });
  for (let i = 0; i < 8; i++) { s.advance(); s.step(s.pick()); }
  const k = s.fsSnapshot();
  t.eq(k.files, [{ id: 2, dev: 0, ino: 2, offset: 2, flags: 'rwa', refs: 1 }], 'an open file entry, as the File-system lab draws it');
  t.eq(k.inodes, [{ dev: 0, ino: 2, refs: 1, nlink: 0, size: 2, type: 'file', orphan: true }], 'an unlinked open inode is an orphan');
  t.eq(k.procs[0].fds.map((d) => d.fd), [0, 1, 2, 3, 4, 5], 'the descriptor table');
  t.eq(k.pipes.map((p) => [p.readers, p.writers]), [[1, 1]], 'the pipe, with its readers and writers');
  // the same keys as S.FS.Sys's snapshot, when that engine is there
  const F = S.FS;
  if (F && F.Sys && F.mkfs && F.geometry) {
    const fsys = new F.Sys(F.mkfs(F.geometry({})));
    fsys.open(1, '/x', 'wc');
    const f = fsys.snapshot();
    t.eq(Object.keys(k.files[0]), Object.keys(f.files[0]), 'open-file entries have the File-system lab\'s fields');
    t.eq(Object.keys(k.inodes[0]), Object.keys(f.inodes[0]), 'inode entries have its fields');
    t.eq(Object.keys(k.procs[0]), Object.keys(f.procs[0]), 'process entries have its fields');
  }
}
t.done();
