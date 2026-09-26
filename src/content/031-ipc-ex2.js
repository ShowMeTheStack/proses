// Part 3, the exercises of the last two chapters (signals; building a shell). Outputs are enumerated over every
// schedule by the simulated kernel when an answer is checked, process trees come from one run of it, and the code
// exercises are run under several seeded random schedules. Every program was also compiled with the system compiler
// and run many times; every real output is one the kernel lists.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.exercises.has('ipc-x-sig-default')) return;
  const INC = (...h) => h.map((x) => '#include <' + x + '>\n').join('') + '\n';
  const SIGH = INC('stdio.h', 'signal.h', 'unistd.h', 'sys/wait.h');

  // =========================================================================================================
  // Chapter 3: signals
  // =========================================================================================================
  C.exercise({ id: 'ipc-x-sig-default', chapter: 'ipc-signals', title: 'SIGTERM with no handler', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['The child waits in pause for ever; the parent sends it SIGTERM and looks at the status. What does the program print? (Write the one output.)'],
    src: SIGH + 'int main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        while (1)\n            pause();\n    }\n    kill(k, SIGTERM);\n    int st;\n    waitpid(k, &st, 0);\n    if (WIFSIGNALED(st))\n        printf("killed by %d\\n", WTERMSIG(st));\n    else\n        printf("exit %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n',
    hints: ['The child never sets a handler. What is the default action of SIGTERM?', 'It ends the process, so the status says "killed by a signal", and WTERMSIG says which one.', 'killed by 15. Even if the kill comes before the child reaches pause, the default action ends it all the same.'],
    solution: ['killed by 15'], wrong: [['exit 0'], ['killed by 9']] });

  C.exercise({ id: 'ipc-x-uncatchable', chapter: 'ipc-signals', title: 'Signals no handler can catch', level: 1, kind: 'choice',
    text: ['Which of these signals can a process neither catch with a handler, nor ignore, nor block? Pick every one.'],
    options: ['SIGKILL', 'SIGSTOP', 'SIGTERM', 'SIGINT', 'SIGCHLD'],
    answer: [0, 1],
    whyNot: { 2: 'SIGTERM is the polite request to end: a process may catch it to clean up first.', 3: 'Shells and editors catch SIGINT all the time, so ^C does not end them.', 4: 'SIGCHLD is caught by any parent that reaps in a handler; by default it is ignored.' },
    hints: ['The system must always be able to end or stop a process, whatever the process has set up.', 'One signal ends a process, the other stops it.', 'SIGKILL (9) and SIGSTOP. signal and sigaction refuse them with EINVAL.'],
    solution: [0, 1], wrong: [[0], [0, 1, 2]] });

  C.exercise({ id: 'ipc-x-mask-count', chapter: 'ipc-signals', title: 'Raised while blocked', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['SIGUSR1 is blocked; SIGUSR2 is not. The program raises SIGUSR1, then SIGUSR2, then SIGUSR1 again, prints the counts, unblocks SIGUSR1, and prints them again. What does it print? (Write the one output, its line breaks as spaces.)'],
    src: INC('stdio.h', 'signal.h', 'unistd.h') + 'int one = 0, two = 0;\n\nvoid on_one(int s) { one++; }\nvoid on_two(int s) { two++; }\n\nint main(void) {\n    sigset_t m, old;\n    signal(SIGUSR1, on_one);\n    signal(SIGUSR2, on_two);\n    sigemptyset(&m);\n    sigaddset(&m, SIGUSR1);\n    sigprocmask(SIG_BLOCK, &m, &old);\n    raise(SIGUSR1);\n    raise(SIGUSR2);\n    raise(SIGUSR1);\n    printf("blocked: %d %d\\n", one, two);\n    sigprocmask(SIG_SETMASK, &old, NULL);\n    printf("after: %d %d\\n", one, two);\n    return 0;\n}\n',
    hints: ['SIGUSR2 is not blocked: its handler runs as soon as it is raised. SIGUSR1 only becomes pending.', 'Pending is one bit per signal, so the second raise of SIGUSR1 changes nothing. When the mask is lifted, the pending SIGUSR1 is delivered once.', 'blocked: 0 1, then after: 1 1.'],
    solution: ['blocked: 0 1 after: 1 1'], wrong: [['blocked: 0 1 after: 2 1'], ['blocked: 0 0 after: 2 1']] });

  C.exercise({ id: 'ipc-x-alarm-race', chapter: 'ipc-signals', title: 'An alarm and a pause', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['The program sets an alarm for 1 second, prints, and pauses until the alarm wakes it. On a busy machine anything can happen within that second. Write every output the program can produce, including what it prints before any hang, one a line.'],
    src: INC('stdio.h', 'signal.h', 'unistd.h') + 'void ring(int s) {\n    printf("ring\\n");\n}\n\nint main(void) {\n    signal(SIGALRM, ring);\n    alarm(1);\n    printf("set\\n");\n    pause();\n    printf("woke\\n");\n    return 0;\n}\n',
    hints: ['pause waits for a signal that arrives while it waits. What if the alarm goes off before the program reaches pause?', 'The alarm can fire before the printf, between the printf and pause, or during pause. Only in the last case does pause return.', 'Three outputs: set ring woke; set ring (the alarm came just before pause, which then waits for ever); and ring set (it came before the printf, with the same hang). The cure is to block SIGALRM and wait for it with sigsuspend, which unblocks and waits in one step.'],
    solution: ['set ring woke', 'set ring', 'ring set'], wrong: [['set ring woke'], ['set ring woke', 'ring set woke']] });

  const RP_START = SIGH + 'int left = 3;\n\n/* reap every child that has exited, without ever waiting for one that has not;\n   count each reaped child off in left */\nvoid reap(int s) {\n}\n\nint main(void) {\n    sigset_t m, old;\n    signal(SIGCHLD, reap);\n    sigemptyset(&m);\n    sigaddset(&m, SIGCHLD);\n    /* hold SIGCHLD back while the children start */\n    sigprocmask(SIG_BLOCK, &m, &old);\n    for (int i = 0; i < 3; i++)\n        if (fork() == 0) {\n            if (i == 2)\n                sleep(2);\n            _exit(i);\n        }\n    sleep(1);\n    sigprocmask(SIG_SETMASK, &old, NULL);\n    while (left > 0)\n        sleep(1);\n    printf("all reaped\\n");\n    return 0;\n}\n';
  const RP = RP_START.replace('void reap(int s) {\n}', 'void reap(int s) {\n    while (waitpid(-1, NULL, WNOHANG) > 0)\n        left--;\n}');
  const reapedBy100 = (sys) => {
    const kids = sys.trace.filter((e) => e.kind === 'fork' && e.pid === 100).map((e) => e.child);
    const by = {};
    for (const e of sys.trace) if (e.kind === 'reap') by[e.pid] = e.by;
    const lost = kids.filter((k) => by[k] !== 100);
    if (lost.length) return 'child ' + lost[0] + ' was ' + (by[lost[0]] ? 'reaped by init, not by its parent' : 'never reaped');
    const stuck = sys.trace.find((e) => e.kind === 'block' && e.pid === 100 && (e.why === 'waitpid' || e.why === 'wait'));
    return stuck ? 'the parent blocked in ' + stuck.why + ' (' + stuck.say.replace(/`/g, '') + '): a handler must not wait for a child that has not exited' : true;
  };
  C.exercise({ id: 'ipc-x-code-sigchld', chapter: 'ipc-signals', title: 'A SIGCHLD handler that never waits', level: 3, kind: 'code',
    text: ['The parent holds SIGCHLD blocked while its children start: two of them end at once, so their exits reach it as one signal when it unblocks, and the third ends a second later. Write the handler `reap` so that the parent reaps every child itself, counting each one off in `left`, and never blocks waiting for a child that has not exited. The program must print `all reaped` under every schedule tried.'],
    starter: RP_START,
    tests: [{ name: 'every child reaped by its parent', stdout: 'all reaped\n', expect: reapedBy100, seeds: [1, 2, 3, 4, 5] }],
    maxSteps: 30000,
    hints: ['waitpid(-1, NULL, WNOHANG) reaps one exited child if there is one, and returns 0 at once if none has exited.', 'Several children can exit before the handler runs, and their SIGCHLDs merge into one: one call per signal is not enough.', 'while (waitpid(-1, NULL, WNOHANG) > 0) left--;'],
    solution: RP,
    wrong: [RP.replace('    while (waitpid(-1, NULL, WNOHANG) > 0)', '    if (waitpid(-1, NULL, WNOHANG) > 0)'), RP.replace('waitpid(-1, NULL, WNOHANG)', 'waitpid(-1, NULL, 0)'), RP_START] });

  C.exercise({ id: 'ipc-x-once-tree', chapter: 'ipc-signals', title: 'A handler that reaps one', level: 2, kind: 'process-tree', ask: ['parents', 'zombie', 'orphan'],
    text: ['Run this program with the kernel letting the running process keep the CPU until it blocks. Its SIGCHLD handler reaps at most one child per call. Give each process\'s parent, and mark every process that is a zombie at some point while other processes go on running, and every process re-parented to init.'],
    names: { 100: 'P', 101: 'A', 102: 'B' }, policy: 'fifo', seed: 1,
    src: SIGH + 'void reap(int s) {\n    if (waitpid(-1, NULL, WNOHANG) > 0)\n        printf("reaped one\\n");\n}\n\nint main(void) {\n    signal(SIGCHLD, reap);\n    if (fork() == 0) {\n        printf("A done\\n");\n        return 0;\n    }\n    if (fork() == 0) {\n        printf("B done\\n");\n        return 0;\n    }\n    sleep(2);\n    printf("P done\\n");\n    return 0;\n}\n',
    hints: ['P forks both children, then sleeps. A and B each print and exit before P runs again.', 'Both exits send SIGCHLD while P sleeps: the two signals merge, the handler runs once and reaps A only. A was a zombie while B ran.', 'Parents: A and B are both P\'s. Zombies: A (until the handler) and B (for good). Orphan: B, re-parented to init as a zombie when P exits, and reaped by init at once.'],
    solution: { parents: { A: 'P', B: 'P' }, zombie: ['A', 'B'], orphan: ['B'] },
    wrong: [{ parents: { A: 'P', B: 'P' }, zombie: ['B'], orphan: [] }, { parents: { A: 'P', B: 'A' }, zombie: ['A', 'B'], orphan: ['B'] }] });

  C.exercise({ id: 'ipc-x-term-race', chapter: 'ipc-signals', title: 'Is one second enough?', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['The child installs a SIGTERM handler that exits with code 7. The parent sleeps one second, so that the child is ready, then sends SIGTERM. On a heavily loaded machine a second guarantees nothing. Write every output the program can produce, one a line.'],
    src: SIGH + 'void bye(int s) { _exit(7); }\n\nint main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        signal(SIGTERM, bye);\n        while (1)\n            pause();\n    }\n    sleep(1);\n    kill(k, SIGTERM);\n    int st;\n    waitpid(k, &st, 0);\n    if (WIFSIGNALED(st))\n        printf("killed by %d\\n", WTERMSIG(st));\n    else\n        printf("exit %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n',
    hints: ['Usually the child has set its handler long before the second is up. What if it has not been scheduled at all yet?', 'A SIGTERM that arrives before signal(SIGTERM, bye) meets the default action, which ends the child.', 'Two outputs: exit 7 (the handler caught it) and killed by 15 (it came first). sleep orders nothing; to be sure, the child must tell the parent it is ready, through a pipe for example.'],
    solution: ['exit 7', 'killed by 15'], wrong: [['exit 7'], ['exit 7', 'killed by 15', 'exit 22']] });

  // =========================================================================================================
  // Chapter 4: building a shell
  // =========================================================================================================
  C.exercise({ id: 'ipc-x-exec-fail', chapter: 'ipc-shell', title: 'When exec comes back', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['A shell-like program runs two commands: one that does not exist, then echo. What does it print? (Write the one output, its line breaks as spaces.)'],
    src: INC('stdio.h', 'unistd.h', 'sys/wait.h') + 'int main(void) {\n    int st;\n    pid_t k = fork();\n    if (k == 0) {\n        execlp("nosuch", "nosuch", NULL);\n        printf("exec failed\\n");\n        _exit(127);\n    }\n    waitpid(k, &st, 0);\n    printf("status %d\\n", WEXITSTATUS(st));\n    k = fork();\n    if (k == 0) {\n        execlp("echo", "echo", "hi", NULL);\n        printf("exec failed\\n");\n        _exit(127);\n    }\n    waitpid(k, &st, 0);\n    printf("status %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n',
    hints: ['exec returns only when it fails. When it works, the code after it is gone with the old image.', 'The first child\'s exec fails, so it prints and exits with 127; the second becomes echo, which prints hi and exits with 0.', 'exec failed, status 127, hi, status 0.'],
    solution: ['exec failed status 127 hi status 0'], wrong: [['exec failed status 127 hi exec failed status 0'], ['status 127 hi status 0']] });

  C.exercise({ id: 'ipc-x-left-open', chapter: 'ipc-shell', title: 'A pipeline that never ends', level: 2, kind: 'choice',
    text: ['A shell runs `ls | wc`. Both children do their dup2 and close both pipe descriptors before exec, but the shell itself never closes its own copies of p[0] and p[1]. ls prints its names and exits. What happens next?'],
    options: ['wc waits for ever in read, and the shell waits for ever for wc', 'wc prints its counts and the shell goes on', 'ls gets SIGPIPE', 'wc reads the shell\'s own input'],
    answer: 0,
    whyNot: { 1: 'wc only prints once read returns 0, end of file, and that needs every write end closed.', 2: 'ls has written everything and exited; a reader still exists (wc), so no SIGPIPE.', 3: 'wc\'s descriptor 0 names the pipe\'s read end, not the terminal.' },
    hints: ['When does wc stop reading?', 'At end of file: the pipe empty and no write end open in any process. Who still holds one?', 'The shell holds p[1], so wc never sees end of file; the shell waits for wc, and neither moves again.'],
    solution: 0, wrong: [1, 2] });

  const RI_START = INC('stdio.h', 'fcntl.h', 'unistd.h', 'sys/wait.h') + 'int main(void) {\n    char *a[] = {"wc", NULL};\n    pid_t k = fork();\n    if (k == 0) {\n        /* run wc < todo: make the file todo this child\'s standard input, then exec */\n        execvp(a[0], a);\n        _exit(127);\n    }\n    waitpid(k, NULL, 0);\n    printf("[done]\\n");\n    return 0;\n}\n';
  const RI = RI_START.replace('        /* run wc < todo: make the file todo this child\'s standard input, then exec */\n', '        int in = open("todo", O_RDONLY);\n        dup2(in, 0);\n        close(in);\n');
  const TODO = { todo: 'call home\nfix bike\n' };
  C.exercise({ id: 'ipc-x-code-redir-in', chapter: 'ipc-shell', title: 'wc < todo', level: 2, kind: 'code',
    text: ['This program runs `wc` in a child. Make it run `wc < todo`: in the child, before exec, make the file `todo` its standard input. The shell part, the parent, must keep its own descriptors as they are. With todo holding two lines, the program prints wc\'s counts and then `[done]`.'],
    starter: RI_START,
    tests: [{ name: 'wc reads todo', files: TODO, stdout: '       2       4      19\n[done]\n', seeds: [1, 2, 3] }, { name: 'another file', files: { todo: 'water the ferns\n' }, stdout: '       1       3      16\n[done]\n' }],
    hints: ['open the file for reading in the child; it gets descriptor 3.', 'wc reads descriptor 0, so move the file onto 0 with dup2, then close the spare descriptor.', 'int in = open("todo", O_RDONLY); dup2(in, 0); close(in); then execvp as before.'],
    solution: RI,
    wrong: [RI.replace('dup2(in, 0);', 'dup2(0, in);'), RI_START, RI.replace('dup2(in, 0);', 'dup2(in, 1);')] });

  const PL_START = INC('stdio.h', 'unistd.h', 'sys/wait.h') + 'int main(void) {\n    char *a[] = {"cat", "notes", NULL};\n    char *b[] = {"sort", NULL};\n    /* run cat notes | sort: a pipe, one child for each command,\n       and wait for both before printing [done] */\n\n    printf("[done]\\n");\n    return 0;\n}\n';
  const PL = PL_START.replace('    /* run cat notes | sort: a pipe, one child for each command,\n       and wait for both before printing [done] */\n', '    int p[2];\n    pipe(p);\n    if (fork() == 0) {\n        dup2(p[1], 1);\n        close(p[0]);\n        close(p[1]);\n        execvp(a[0], a);\n        _exit(127);\n    }\n    if (fork() == 0) {\n        dup2(p[0], 0);\n        close(p[0]);\n        close(p[1]);\n        execvp(b[0], b);\n        _exit(127);\n    }\n    close(p[0]);\n    close(p[1]);\n    wait(NULL);\n    wait(NULL);\n');
  const NOTES = { notes: 'pear\napple\nfig\n' };
  C.exercise({ id: 'ipc-x-code-pipeline', chapter: 'ipc-shell', title: 'cat notes | sort', level: 3, kind: 'code',
    text: ['Write the pipeline `cat notes | sort` the way a shell does: a pipe, a child for cat with its standard output on the pipe, a child for sort with its standard input on the pipe, every unused end closed, and both children waited for before `[done]` is printed. Under every schedule tried, the output must be the sorted lines, then `[done]`.'],
    starter: PL_START,
    tests: [{ name: 'sorted, then done', files: NOTES, stdout: 'apple\nfig\npear\n[done]\n', seeds: [1, 2, 3, 4, 5, 6] }, { name: 'a longer list', files: { notes: 'yam\nkale\nbeet\nleek\n' }, stdout: 'beet\nkale\nleek\nyam\n[done]\n', seeds: [1, 2] }],
    maxSteps: 40000,
    hints: ['pipe(p) before either fork, so both children inherit both ends.', 'In each child: dup2 the end it uses onto 1 (cat) or 0 (sort), close both p[0] and p[1], then execvp. In the shell, close both ends too, then wait twice.', 'pipe(p); child 1: dup2(p[1], 1); close(p[0]); close(p[1]); execvp(a[0], a); child 2: dup2(p[0], 0); close(p[0]); close(p[1]); execvp(b[0], b); then close(p[0]); close(p[1]); wait(NULL); wait(NULL);'],
    solution: PL,
    wrong: [PL.replace('    close(p[0]);\n    close(p[1]);\n    wait(NULL);', '    wait(NULL);'), PL.replace('    wait(NULL);\n    wait(NULL);\n', ''), PL.replace('        dup2(p[0], 0);\n        close(p[0]);\n        close(p[1]);', '        dup2(p[0], 0);\n        close(p[0]);')] });

  C.exercise({ id: 'ipc-x-bg-tree', chapter: 'ipc-shell', title: 'Two jobs, never waited for', level: 2, kind: 'process-tree', ask: ['parents', 'zombie', 'orphan'],
    text: ['A shell starts two background jobs, `sleep 1` and `sleep 5`, has no SIGCHLD handler and never calls wait. It works for 3 seconds and exits. Give each process\'s parent, and mark every process that is a zombie while others go on running, and every process re-parented to init.'],
    names: { 100: 'S', 101: 'J1', 102: 'J2' }, policy: 'fifo', seed: 1,
    src: INC('stdio.h', 'unistd.h') + 'int main(void) {\n    char *a[] = {"sleep", "1", NULL};\n    char *b[] = {"sleep", "5", NULL};\n    if (fork() == 0) {\n        execvp(a[0], a);\n        _exit(127);\n    }\n    if (fork() == 0) {\n        execvp(b[0], b);\n        _exit(127);\n    }\n    sleep(3);\n    printf("shell leaves\\n");\n    return 0;\n}\n',
    hints: ['Both jobs are the shell\'s children. Which of them ends while the shell is still running?', 'J1 ends after 1 second and nobody waits for it: a zombie until the shell exits at 3 seconds. J2 is still asleep then.', 'Parents: S for both. Zombie: J1. Orphans: J1 and J2, both re-parented to init when S exits; init reaps J1 at once and J2 when it ends.'],
    solution: { parents: { J1: 'S', J2: 'S' }, zombie: ['J1'], orphan: ['J1', 'J2'] },
    wrong: [{ parents: { J1: 'S', J2: 'S' }, zombie: ['J1', 'J2'], orphan: ['J1', 'J2'] }, { parents: { J1: 'S', J2: 'S' }, zombie: ['J1'], orphan: ['J2'] }] });

  C.exercise({ id: 'ipc-x-ctrlc-group', chapter: 'ipc-shell', title: '^C takes the shell too', level: 2, kind: 'choice',
    text: ['A home-made shell runs `sleep 30` in the foreground. It never calls setpgid, so the child stays in the shell\'s process group, which owns the terminal; the shell keeps the default action for SIGINT. The user presses ^C. What happens?'],
    options: ['Both sleep and the shell are killed: the terminal sends SIGINT to every process in the foreground group', 'Only sleep is killed: the terminal knows which program is running', 'Only the shell is killed: the terminal signals the group\'s leader', 'Nothing: ^C is only a character on the input'],
    answer: 0,
    whyNot: { 1: 'The terminal knows process groups, not programs. That is exactly why a shell gives each job a group of its own.', 2: 'The signal goes to every member of the foreground group, not just the leader.', 3: 'With the usual terminal settings, ^C is turned into SIGINT for the foreground group.' },
    hints: ['To whom does the terminal send SIGINT when ^C is typed?', 'To every process in its foreground process group. Which processes are in it here?', 'Both the shell and sleep: both are killed. The cure: setpgid to put the job in its own group, tcsetpgrp to give it the terminal, and the shell ignores SIGINT itself.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
