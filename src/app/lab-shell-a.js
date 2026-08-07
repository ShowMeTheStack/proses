// The Shell lab, part one: the skeleton shell, the reference shell (hidden until the student asks), the job-control
// tests, and how the lab drives a shell on the simulated kernel with what the student types. Through S.ShellLab:
//   SL.SKELETON, SL.REFERENCE      C sources: the starting point (main loop, fgets and strtok given) and a full shell
//   SL.TESTS [{name, why, lines: [{type, key}], files, expect | expectEnd | has, checks: [..]}]
//     checks: 'foreground' (a foreground line is waited for before the next is read), 'reaped' (the shell reaps every
//     child itself), 'background' (a line ending in & is not waited for), 'sigchld' (a finished background job is
//     reaped while the shell still waits for the foreground one), 'fgonly' (^C or ^Z reaches the foreground job only:
//     not the shell, not a background job), 'stopped' (^Z stops the foreground job and the shell reads on)
//   SL.drive(src, lines, o) -> {sys, beats, typed, status}   lines [{type, key: '' | 'C' | 'Z'}]: each line is typed
//     when a process reads the terminal (the shell, or a program in the foreground); its key is pressed once nothing
//     can run without waiting (or after 400 steps); after the last line, end of file (^D)
//   SL.judge(test, run) -> null | {why, at}     SL.runTest(src, test) -> {pass, why, seed, run}
(function (S) {
  'use strict';
  const SL = (S.ShellLab = S.ShellLab || {});
  const SH = 100;
  const INC = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <signal.h>\n#include <sys/wait.h>\n';

  SL.SKELETON = INC + `
#define MAXARGS 16

/* Run one command line, already split into words: argv[0] .. argv[argc - 1], then NULL.
   What a shell does here, a step at a time:
     1. fork a child; in it, execvp(argv[0], argv); if that fails, print an error and exit(127);
     2. in the shell, wait for that child, unless the line ends with "&";
     3. split the words at "|" into commands joined by pipes: pipe, dup2, and close every end not used;
     4. in the child, "< file" and "> file": open the file and dup2 it onto 0 or 1;
     5. put each job in a process group of its own (setpgid) and give the terminal to the foreground
        job (tcsetpgrp), so that ^C and ^Z reach that job only;
     6. reap background jobs in a SIGCHLD handler, so that no zombie is left behind. */
void run_line(char **argv, int argc) {
    printf("todo: run %s\\n", argv[0]);
}

int main(void) {
    char line[128];
    while (fgets(line, sizeof line, stdin)) {
        char *argv[MAXARGS];
        int argc = 0;
        char *w = strtok(line, " \\t\\n");
        while (w && argc < MAXARGS - 1) {
            argv[argc] = w;
            argc++;
            w = strtok(NULL, " \\t\\n");
        }
        argv[argc] = NULL;
        if (argc > 0)
            run_line(argv, argc);
    }
    return 0;
}
`;

  SL.REFERENCE = INC + `
#define MAXARGS 16
#define MAXCMDS 4
#define MAXJOBS 8

struct job {
    pid_t pgid;
    pid_t pids[MAXCMDS];
    int n;
    int stopped;
};
struct job jobs[MAXJOBS];

/* how many of a job's processes have not been reaped */
int alive(struct job *j) {
    int c = 0;
    for (int i = 0; i < j->n; i++)
        if (j->pids[i])
            c++;
    return c;
}

/* SIGCHLD: reap every child that has finished, note any that stopped */
void on_child(int sig) {
    int st;
    pid_t k;
    while ((k = waitpid(-1, &st, WNOHANG | WUNTRACED)) > 0) {
        for (int j = 0; j < MAXJOBS; j++)
            for (int i = 0; i < jobs[j].n; i++)
                if (jobs[j].pids[i] == k) {
                    if (WIFSTOPPED(st))
                        jobs[j].stopped = 1;
                    else
                        jobs[j].pids[i] = 0;
                }
    }
}

/* the terminal belongs to job j until it ends or stops; SIGCHLD is blocked on entry */
void foreground(struct job *j, sigset_t *old) {
    tcsetpgrp(0, j->pgid);
    while (alive(j) > 0 && !j->stopped)
        sigsuspend(old);
    tcsetpgrp(0, getpgrp());
    if (j->stopped)
        printf("[%d] stopped\\n", j->pgid);
}

/* one command of a pipeline, in the child: its group, its pipes, its files, then exec */
void child(char **argv, pid_t pgid, int in, int out, sigset_t *old) {
    setpgid(0, pgid);
    signal(SIGINT, SIG_DFL);
    signal(SIGTSTP, SIG_DFL);
    sigprocmask(SIG_SETMASK, old, NULL);
    for (int i = 0; argv[i]; i++) {
        if (strcmp(argv[i], "<") == 0 && argv[i + 1]) {
            in = open(argv[i + 1], O_RDONLY);
            argv[i] = NULL;
        } else if (strcmp(argv[i], ">") == 0 && argv[i + 1]) {
            out = open(argv[i + 1], O_WRONLY | O_CREAT | O_TRUNC, 0644);
            argv[i] = NULL;
        }
    }
    if (in < 0 || out < 0) {
        perror("open");
        exit(1);
    }
    if (in != 0) {
        dup2(in, 0);
        close(in);
    }
    if (out != 1) {
        dup2(out, 1);
        close(out);
    }
    execvp(argv[0], argv);
    perror(argv[0]);
    exit(127);
}

void run_line(char **argv, int argc, sigset_t *old) {
    int bg = 0;
    if (strcmp(argv[argc - 1], "&") == 0) {
        bg = 1;
        argv[--argc] = NULL;
        if (argc == 0)
            return;
    }
    if (strcmp(argv[0], "fg") == 0) {
        for (int j = MAXJOBS - 1; j >= 0; j--)
            if (jobs[j].stopped && alive(&jobs[j])) {
                jobs[j].stopped = 0;
                kill(-jobs[j].pgid, SIGCONT);
                foreground(&jobs[j], old);
                return;
            }
        printf("fg: no stopped job\\n");
        return;
    }
    int slot = 0;
    while (slot < MAXJOBS && alive(&jobs[slot]))
        slot++;
    if (slot == MAXJOBS) {
        printf("too many jobs\\n");
        return;
    }
    struct job *j = &jobs[slot];
    j->n = 0;
    j->pgid = 0;
    j->stopped = 0;
    char **cmd = argv;
    int in = 0;
    for (int i = 0; i <= argc; i++) {
        if (i < argc && strcmp(argv[i], "|") != 0)
            continue;
        argv[i] = NULL;
        int fd[2] = {0, 1};
        if (i < argc)
            pipe(fd);
        pid_t k = fork();
        if (k == 0) {
            if (i < argc)
                close(fd[0]);
            child(cmd, j->pgid, in, i < argc ? fd[1] : 1, old);
        }
        if (j->pgid == 0)
            j->pgid = k;
        setpgid(k, j->pgid);
        j->pids[j->n] = k;
        j->n++;
        if (in != 0)
            close(in);
        if (i < argc) {
            close(fd[1]);
            in = fd[0];
        }
        cmd = argv + i + 1;
        if (j->n == MAXCMDS)
            break;
    }
    if (!bg)
        foreground(j, old);
}

int main(void) {
    char line[128];
    sigset_t chld, old;
    signal(SIGINT, SIG_IGN);
    signal(SIGTSTP, SIG_IGN);
    signal(SIGCHLD, on_child);
    sigemptyset(&chld);
    sigaddset(&chld, SIGCHLD);
    sigprocmask(SIG_BLOCK, &chld, &old);
    while (fgets(line, sizeof line, stdin)) {
        char *argv[MAXARGS];
        int argc = 0;
        char *w = strtok(line, " \\t\\n");
        while (w && argc < MAXARGS - 1) {
            argv[argc] = w;
            argc++;
            w = strtok(NULL, " \\t\\n");
        }
        argv[argc] = NULL;
        if (argc > 0)
            run_line(argv, argc, &old);
    }
    /* end of input: end the stopped jobs, then wait for every job left */
    for (int j = 0; j < MAXJOBS; j++)
        if (jobs[j].stopped && alive(&jobs[j])) {
            kill(-jobs[j].pgid, SIGTERM);
            kill(-jobs[j].pgid, SIGCONT);
        }
    for (int j = 0; j < MAXJOBS; j++)
        while (alive(&jobs[j]))
            sigsuspend(&old);
    return 0;
}
`;

  const L = (type, key) => ({ type, key: key || '' });
  const FRUIT = { 'fruit.txt': 'pear\napple\nfig\nbanana\n' };
  SL.FRUIT = FRUIT;
  SL.TESTS = [
    { name: 'one command', why: 'fork, execvp and wait: the program runs, and the shell waits for it', lines: [L('echo hello there')], expect: 'hello there\n', checks: ['foreground', 'reaped'] },
    { name: 'lines in order', why: 'each line finishes before the next one is read', lines: [L('cat fruit.txt'), L('echo end')], files: FRUIT, expect: 'pear\napple\nfig\nbanana\nend\n', checks: ['foreground', 'reaped'] },
    { name: 'a pipe', why: 'echo writes into a pipe, wc reads it; every unused end is closed, so wc sees end of file', lines: [L('echo a b c | wc')], expect: '       1       3       6\n', checks: ['foreground', 'reaped'] },
    { name: 'three in a pipeline', why: 'two pipes, three processes in one job', lines: [L('cat fruit.txt | sort | head -n 2')], files: FRUIT, expect: 'apple\nbanana\n', checks: ['foreground', 'reaped'] },
    { name: 'redirection', why: '< and > open a file and dup2 it onto 0 or 1 in the child', lines: [L('sort < fruit.txt > sorted.txt'), L('cat sorted.txt')], files: FRUIT, expect: 'apple\nbanana\nfig\npear\n', checks: ['foreground', 'reaped'] },
    { name: 'a background job', why: 'a line ending in & is not waited for: the next line runs at once', lines: [L('sleep 2 &'), L('echo now')], expect: 'now\n', checks: ['background', 'reaped'] },
    { name: 'SIGCHLD reaps at once', why: 'a background job that ends is reaped by a SIGCHLD handler, even while a foreground job runs', lines: [L('sleep 1 &'), L('sleep 3')], expect: '', checks: ['sigchld', 'foreground', 'reaped'] },
    { name: '^C reaches the foreground only', why: 'jobs in their own process groups, the terminal given to the foreground one: ^C stops sleep 5, not sleep 4 & nor the shell', lines: [L('sleep 4 &'), L('sleep 5', 'C'), L('echo alive')], expect: 'alive\n', checks: ['fgonly', 'reaped'] },
    { name: '^Z stops the foreground job', why: 'the stopped job is noticed (WUNTRACED) and the shell reads on', lines: [L('sleep 5', 'Z'), L('echo back')], has: 'back\n', checks: ['stopped', 'fgonly', 'reaped'] },
    { name: 'no zombies left', why: 'at end of input the shell waits for its jobs, so init never has to reap one', lines: [L('sleep 1 &'), L('sleep 2 &'), L('echo done')], expect: 'done\n', checks: ['reaped'] },
  ];

  SL.system = (src, o) => S.ProcLab.system(src, Object.assign({}, o, { tty: true, eof: false, input: '', shell: false, cow: false, hand: false }));
  /** is any thread blocked reading the terminal? -> its process */
  const reader = (sys) => { for (const t of sys.threads) if (t.state === 'blocked' && t.wait && t.wait.kind === 'read') { const p = sys.proc(t.pid), of = sys.ofOf(p, t.wait.fd); if (of && of.kind === 'tty') return p; } return null; };
  SL.drive = function (src, lines, o) {
    o = o || {};
    const sys = SL.system(src, o), beats = [], typed = [], quiet = S.ProcLab.QUIET, maxBeats = o.maxBeats || 700;
    let li = 0, key = '', since = 0, eof = false;
    const beat = (evs) => {
      if (!o.beats) return;
      const kept = evs.filter((e) => e.kind !== 'step' && e.kind !== 'sleep');
      if (!kept.length) return;
      const main = kept.find((e) => !quiet.has(e.kind)) || kept[0];
      const prev = beats[beats.length - 1];
      const b = { evs: kept, main, snap: sys.snapshot(), ks: sys.ksnap(), nterm: sys.term.length, at: sys.trace.length - evs.length, typed: typed.length, clock: sys.ms / 1000 };
      // a run of writes or reads by one process is one picture
      if (prev && prev.main.pid === main.pid && /^(write|read|print)$/.test(main.kind) && prev.main.kind === main.kind && prev.evs.length === 1 && kept.length === 1) { b.at = prev.at; b.runs = (prev.runs || 1) + 1; beats[beats.length - 1] = b; return; }
      if (beats.length < maxBeats) beats.push(b);
    };
    const act = (f) => { const from = sys.trace.length; f(); beat(sys.trace.slice(from)); };
    beat(sys.trace.slice());
    for (let n = 0; n < (o.maxSteps || 60000); n++) {
      const idle = !sys.choices().length, rd = reader(sys);
      if (key && (idle || rd || since > 400)) { const k = key; key = ''; act(() => { sys.press(k); typed.push({ text: '^' + k, n: sys.term.length, key: k }); }); continue; }
      if (!key && li < lines.length && rd && (rd.pid === SH || idle)) {
        const l = lines[li++];
        act(() => { typed.push({ text: l.type, n: sys.term.length }); sys.type(l.type + '\n'); });
        key = l.key || ''; since = 0;
        continue;
      }
      if (!key && li >= lines.length && !eof && rd && idle) { eof = true; act(() => { typed.push({ text: '^D', n: sys.term.length, eof: true }); sys.endInput(); }); continue; }
      if (!sys.advance()) {
        if (key) continue;
        if (li < lines.length && rd) { const l = lines[li++]; act(() => { typed.push({ text: l.type, n: sys.term.length }); sys.type(l.type + '\n'); }); key = l.key || ''; since = 0; continue; }
        if (!eof && rd) { eof = true; act(() => { typed.push({ text: '^D', n: sys.term.length, eof: true }); sys.endInput(); }); continue; }
        act(() => sys.done());
        break;
      }
      const from = sys.trace.length;
      sys.step(sys.pick());
      since++;
      beat(sys.trace.slice(from));
    }
    if (!sys.finished) act(() => sys.event('limit', null, {}, 'The run stops here: something may be waiting forever, or looping.'));
    return { sys, beats, typed, status: sys.status(), linesTyped: li };
  };

  /** what went wrong in one run of a test, or null */
  SL.judge = function (t, r) {
    const sys = r.sys, tr = sys.trace, show = (s) => JSON.stringify(String(s));
    const st = sys.status();
    if (!sys.finished || st === 'deadlock' || st === 'input') return { why: 'the run did not end: ' + (st === 'deadlock' ? 'every process left waits for good (is a pipe end still open, or a child never waited for?)' : 'the shell never finished') };
    const sh = sys.proc(SH);
    if (sh.termsig) return { why: 'the shell itself was killed by ' + (S.Kern.SIGNAME[sh.termsig] || 'a signal') + ': it must not be in the foreground group when the key is pressed' };
    if (r.linesTyped < t.lines.length) return { why: 'the shell stopped reading after ' + r.linesTyped + ' of ' + t.lines.length + ' lines' };
    if (t.expect !== undefined && sys.out !== t.expect) return { why: 'the output is ' + show(sys.out) + ', not ' + show(t.expect) };
    if (t.expectEnd !== undefined && !sys.out.endsWith(t.expectEnd)) return { why: 'the output ' + show(sys.out) + ' does not end with ' + show(t.expectEnd) };
    if (t.has !== undefined && !sys.out.includes(t.has)) return { why: 'the output ' + show(sys.out) + ' does not contain ' + show(t.has) };
    // the line each child of the shell was forked for, and when things happened
    const typedAt = [], kids = [], lineOf = {}, exitAt = {}, reapBy = {}, reapAt = {}, killed = {}, stopAt = {};
    tr.forEach((e, i) => {
      if (e.kind === 'typed') typedAt.push(i);
      if (e.kind === 'fork' && e.pid === SH) { kids.push(e.child); lineOf[e.child] = typedAt.length - 1; }
      if (e.kind === 'fork' && kids.includes(e.pid) && !kids.includes(e.child)) { kids.push(e.child); lineOf[e.child] = lineOf[e.pid]; }
      if (e.kind === 'exit' && exitAt[e.pid] === undefined) exitAt[e.pid] = i;
      if (e.kind === 'reap') { reapBy[e.pid] = e.by; reapAt[e.pid] = i; }
      if (e.kind === 'stop' && stopAt[e.pid] === undefined) stopAt[e.pid] = i;
    });
    for (const p of sys.procs) if (p.termsig) killed[p.pid] = p.termsig;
    const isBg = (k) => /&\s*$/.test((t.lines[lineOf[k]] || {}).type || '');
    const lineText = (k) => show((t.lines[lineOf[k]] || {}).type || '');
    const ch = new Set(t.checks || []);
    if (ch.has('foreground')) for (const k of kids) {
      const l = lineOf[k];
      if (isBg(k) || l + 1 >= typedAt.length) continue;
      const end = Math.min(exitAt[k] === undefined ? Infinity : exitAt[k], stopAt[k] === undefined ? Infinity : stopAt[k]);
      if (!(end < typedAt[l + 1])) return { why: (t.lines[l + 1] ? 'the line ' + show(t.lines[l + 1].type) : 'the end of input (^D)') + ' was read before process ' + k + ' (for ' + lineText(k) + ') had finished: a foreground line must be waited for', at: typedAt[l + 1] };
    }
    if (ch.has('background')) for (const k of kids) {
      const l = lineOf[k];
      if (!isBg(k) || l + 1 >= typedAt.length) continue;
      if (exitAt[k] !== undefined && exitAt[k] < typedAt[l + 1]) return { why: 'the shell waited for ' + lineText(k) + ' before reading the next line: a line ending in & runs in the background', at: typedAt[l + 1] };
    }
    if (ch.has('sigchld')) {
      const bg = kids.filter(isBg), fg = kids.filter((k) => !isBg(k));
      for (const k of bg) for (const f of fg) if (lineOf[f] > lineOf[k] && exitAt[k] < exitAt[f] && !(reapAt[k] < exitAt[f])) return { why: 'background process ' + k + ' finished while ' + lineText(f) + ' ran, but was not reaped until later: a SIGCHLD handler reaps it at once', at: exitAt[f] };
    }
    if (ch.has('fgonly')) {
      const keyAt = tr.map((e, i) => (e.kind === 'key' ? i : -1)).filter((i) => i >= 0);
      if (!keyAt.length) return { why: 'the key was never pressed (the shell did not get that far)' };
      for (const ki of keyAt) {
        const e = tr[ki];
        const hit = [];
        for (let i = ki + 1; i < tr.length && tr[i].kind === 'signal'; i++) hit.push(tr[i].pid);
        const keyLine = typedAt.filter((x) => x < ki).length - 1;
        const fgKids = kids.filter((k) => lineOf[k] === keyLine && !isBg(k));
        if (hit.includes(SH)) return { why: 'the ^' + e.ch + ' went to the shell too: the shell is in the foreground group (give each job its own group with setpgid, and the terminal with tcsetpgrp)', at: ki };
        const wrong = hit.filter((p) => !fgKids.includes(p));
        if (wrong.length) return { why: 'the ^' + e.ch + ' also reached process ' + wrong.join(', ') + ', which is not in the foreground job', at: ki };
        if (fgKids.length && !fgKids.some((k) => hit.includes(k))) return { why: 'the ^' + e.ch + ' did not reach the foreground job (' + lineText(fgKids[0]) + '): the terminal’s foreground group is ' + e.pgid, at: ki };
      }
      for (const k of kids) if (isBg(k) && killed[k]) return { why: 'background process ' + k + ' (' + lineText(k) + ') was killed by ' + S.Kern.SIGNAME[killed[k]] + ': only the foreground job should get the key', at: exitAt[k] };
    }
    if (ch.has('stopped')) {
      if (!kids.some((k) => stopAt[k] !== undefined)) return { why: 'no process was stopped by ^Z' };
    }
    if (ch.has('reaped')) for (const k of kids) {
      if (reapBy[k] !== SH) return { why: 'process ' + k + ' (for ' + lineText(k) + ') was ' + (reapBy[k] ? 'left to init to reap' : 'never reaped') + ': the shell must reap every child itself', at: reapAt[k] };
    }
    return null;
  };
  SL.runTest = function (src, t, o) {
    o = o || {};
    for (const seed of t.seeds || o.seeds || [1, 2, 3]) {
      let r;
      try { r = SL.drive(src, t.lines, { files: Object.assign({}, t.files || {}), policy: 'random', seed, beats: false, maxSteps: 60000 }); }
      catch (e) { return { pass: false, why: 'it stopped with an error: ' + (e.msg || e.message), seed }; }
      const bad = SL.judge(t, r);
      if (bad) return { pass: false, why: bad.why, at: bad.at, seed, run: r };
    }
    return { pass: true };
  };
})(globalThis.Proses = globalThis.Proses || {});
