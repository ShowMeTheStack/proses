// Part 2, processes: the exercises of the third chapter (after fork, after exit). Zombies and orphans are read from a
// run on the simulated kernel (S.Check.os.procFacts), outputs are enumerated by S.Kern.outcomes, and the copy-on-write
// and buffering counts are worked out here by S.Kern.run. The programs were also compiled with the system compiler and
// run: every real output is one the kernel lists.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || !S.Kern || C.exercises.has('proc-x-zombie-one')) return;
  const INC = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const INC3 = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const forkedBy = (sys, pid) => sys.trace.filter((e) => e.kind === 'fork' && e.pid === pid).map((e) => e.child);
  const reaper = (sys, pid) => { const e = sys.trace.find((x) => x.kind === 'reap' && x.pid === pid); return e ? e.by : null; };

  // =========================================================================================================
  // Chapter 3: after fork, after exit
  // =========================================================================================================
  const ZOMBIE = INC + 'int main(void) {\n    if (fork() == 0) {\n        printf("C: done already\\n");\n        exit(0);\n    }\n    sleep(1);\n    printf("P: awake\\n");\n    wait(NULL);\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-zombie-one', chapter: 'proc-after', title: 'Spot the zombie', level: 1, kind: 'process-tree', ask: ['zombie'],
    text: ['The program starts as P (pid 100) and forks C (pid 101); the kernel runs the first ready process each time. Mark every process that is a zombie at some point while the program runs, and leave the others unmarked.'],
    src: ZOMBIE, names: { 100: 'P', 101: 'C' }, policy: 'fifo', seed: 1,
    hints: ['A zombie has exited, and its parent has not yet waited for it.', 'C exits at once; P is asleep for a second and only then calls wait.', 'C is a zombie from its exit until P\'s wait reaps it. P is reaped by the shell, which is already waiting, so it is never left as one.'],
    solution: { zombie: ['C'] }, wrong: [{ zombie: [] }, { zombie: ['P'] }] });

  const ORPHAN = INC + 'int main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        if (fork() == 0) {\n            sleep(2);\n            printf("B: adopted by %d\\n", getppid());\n            exit(0);\n        }\n        printf("A: leaving\\n");\n        exit(0);\n    }\n    waitpid(a, NULL, 0);\n    printf("P: A is reaped\\n");\n    sleep(3);\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-orphan-tree', chapter: 'proc-after', title: 'A grandchild left behind', level: 2, kind: 'process-tree', ask: ['parents', 'orphan'],
    text: ['P (pid 100) forks A (101), and A forks B (102); the kernel runs the first ready process each time. Give each process\'s parent (the one that forked it), and mark every process that becomes an orphan.'],
    src: ORPHAN, names: { 100: 'P', 101: 'A', 102: 'B' }, policy: 'fifo', seed: 1,
    hints: ['An orphan is a process whose parent exits while it is still alive.', 'A exits right after forking B, while B is asleep. P outlives A, but P is not B\'s parent.', 'Parents: A was made by P, B by A. B is the orphan: init adopts it, and it prints B: adopted by 1.'],
    solution: { parents: { A: 'P', B: 'A' }, orphan: ['B'] }, wrong: [{ parents: { A: 'P', B: 'P' }, orphan: ['B'] }, { parents: { A: 'P', B: 'A' }, orphan: ['A'] }] });

  const FAMILY = INC + 'int main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        if (fork() == 0) {\n            printf("C: quick\\n");\n            exit(0);\n        }\n        sleep(3);\n        printf("A: done\\n");\n        exit(0);\n    }\n    pid_t b = fork();\n    if (b == 0) {\n        sleep(1);\n        printf("B: done\\n");\n        exit(0);\n    }\n    sleep(2);\n    waitpid(b, NULL, 0);\n    printf("P: B reaped\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-family', chapter: 'proc-after', title: 'Zombies and orphans in one family', level: 3, kind: 'process-tree',
    text: ['P (pid 100) forks A (101) and then B (102); A forks C (103). The kernel runs the first ready process each time. Give each process\'s parent, mark every process that is a zombie at some point (exited, with others still running, before anyone has waited for it), and mark every process that is re-parented to init.'],
    src: FAMILY, names: { 100: 'P', 101: 'A', 102: 'B', 103: 'C' }, policy: 'fifo', seed: 1,
    hints: ['Follow the clock: C exits at once, B at 1 s, P waits for B at 2 s and then returns, A wakes at 3 s.', 'A never waits for C, and P is asleep when B exits. When P returns, A is still asleep: A is re-parented. When A exits, C, still a zombie, is re-parented too, and init reaps it at once.', 'Parents: A and B by P, C by A. Zombies: C and B. Re-parented to init: A, and C.'],
    solution: { parents: { A: 'P', B: 'P', C: 'A' }, zombie: ['C', 'B'], orphan: ['A', 'C'] },
    wrong: [{ parents: { A: 'P', B: 'P', C: 'A' }, zombie: ['C'], orphan: ['A'] }, { parents: { A: 'P', B: 'P', C: 'A' }, zombie: ['C', 'B'], orphan: ['A'] }] });

  const REAP = INC + 'int main(void) {\n    for (int i = 0; i < 3; i++) {\n        if (fork() == 0) {\n            printf("worker %d\\n", i);\n            exit(0);\n        }\n    }\n    printf("parent leaves\\n");\n    return 0;\n}\n';
  const allMine = (sys) => { const kids = forkedBy(sys, 100); if (kids.length !== 3) return 'the parent made ' + kids.length + ' children, not 3'; const left = kids.filter((k) => reaper(sys, k) !== 100); return left.length ? 'process ' + left[0] + ' was ' + (reaper(sys, left[0]) === 1 ? 'left to init to reap' : 'never reaped') + ': the parent must wait for every child' : true; };
  C.exercise({ id: 'proc-x-code-reap', chapter: 'proc-after', title: 'Make the parent reap every child', level: 2, kind: 'code',
    text: ['This parent starts three workers and leaves at once, so whichever workers are still running are adopted by init. Change it so that the parent itself reaps all three workers, and prints `parent leaves` only after every worker has finished.'],
    starter: REAP,
    tests: [{ name: 'every worker reaped by the parent', match: 'parent leaves\\n$', expect: allMine, seeds: [1, 2, 3, 4, 5] }],
    hints: ['wait reaps one child at a time and returns −1 when there is none left.', 'Put the waiting between the loop that forks and the final printf.', 'Before printf("parent leaves\\n"), add: while (wait(NULL) > 0) ;'],
    solution: REAP.replace('    printf("parent leaves\\n");', '    while (wait(NULL) > 0)\n        ;\n    printf("parent leaves\\n");'),
    wrong: [REAP, REAP.replace('    printf("parent leaves\\n");', '    wait(NULL);\n    printf("parent leaves\\n");')] });

  const DETACH = INC + 'int main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        sleep(1);\n        printf("job done\\n");\n        exit(0);\n    }\n    printf("parent free\\n");\n    return 0;\n}\n';
  const DETACHED = INC + 'int main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        if (fork() == 0) {\n            sleep(1);\n            printf("job done\\n");\n            exit(0);\n        }\n        exit(0);\n    }\n    waitpid(k, NULL, 0);\n    printf("parent free\\n");\n    return 0;\n}\n';
  const detached = (sys) => {
    const kids = forkedBy(sys, 100);
    const stray = kids.filter((k) => reaper(sys, k) !== 100);
    if (stray.length) return 'process ' + stray[0] + ', a child of the parent, was ' + (reaper(sys, stray[0]) === 1 ? 'left to init' : 'never reaped') + ': the parent must reap each child it forks';
    const job = sys.trace.find((e) => e.kind === 'print' && /job done/.test(e.text || ''));
    if (!job) return 'the job never printed job done';
    if (kids.includes(job.pid)) return 'the job ran in a child the parent waited for: the parent must not wait for the job itself';
    return reaper(sys, job.pid) === 1 ? true : 'the job (process ' + job.pid + ') was not adopted and reaped by init';
  };
  C.exercise({ id: 'proc-x-code-detach', chapter: 'proc-after', title: 'A job that outlives its parent, cleanly', level: 3, kind: 'code',
    text: ['A parent must start a slow job and go on at once, without waiting for the job. As written, the job is a child of the parent, so if the parent were to stay alive and never wait, the job would end as a zombie; and the parent cannot wait without being held up.', 'Change it so that the job runs in a grandchild: the parent forks a child, the child forks the job and exits at once, and the parent reaps that child straight away. The job is then an orphan, adopted and reaped by init. Print `parent free` in the parent, and keep `job done` in the job.'],
    starter: DETACH,
    tests: [{ name: 'the job is init\'s, the child is the parent\'s', stdout: 'parent free\njob done\n', expect: detached, seeds: [1, 2, 3, 4] }],
    hints: ['Two forks: the parent\'s child forks again, and the job runs in that second child.', 'The middle child exits at once, so the parent\'s waitpid on it returns almost at once, and the job, still sleeping, is re-parented to init.', 'if (k == 0) { if (fork() == 0) { sleep(1); printf("job done\\n"); exit(0); } exit(0); } waitpid(k, NULL, 0); printf("parent free\\n");'],
    solution: DETACHED,
    wrong: [DETACH, DETACH.replace('    printf("parent free\\n");\n', '    printf("parent free\\n");\n    waitpid(k, NULL, 0);\n')] });

  // copy-on-write: the copies the kernel makes for this program
  const MARKS = INC3 + 'int marks[6000];\n\nint main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        marks[0] = 1;\n        marks[100] = 2;\n        marks[5000] = 3;\n        return 0;\n    }\n    wait(NULL);\n    printf("parent sees %d\\n", marks[0]);\n    return 0;\n}\n';
  const COPIES = S.Kern.run(MARKS, { policy: 'fifo', cow: true }).trace.filter((e) => e.kind === 'cow').length;
  C.exercise({ id: 'proc-x-cow-count', chapter: 'proc-after', title: 'How many pages are copied', level: 2, kind: 'number',
    text: ['Pages are 4096 bytes and an int is 4 bytes; marks starts at the beginning of a data page. Fork shares every page copy-on-write. Besides the writes to marks, the parent writes once to its stack page (calling wait), before the child runs; the stack is a single page. How many page copies does the kernel make in all?', { code: MARKS, lang: 'c' }],
    answer: COPIES, higherLower: true,
    whyNot: { 4: 'The stack page is copied once, for the parent. After that copy the child is the only user of the old frame, so its own writes there need no copy.', 2: 'marks[0] and marks[100] share a page, but marks[5000] (byte 20000) is on another one; and do not forget the parent\'s stack page.', '*': 'Find the page of each write (byte offset / 4096), count each shared page once, and add the stack page.' },
    hints: ['Work out the byte offset of each element: index × 4. Which page does each fall in?', 'marks[0] (byte 0) and marks[100] (byte 400) are on the same page; marks[5000] (byte 20000) is 4 pages further on. A page is copied at the first write to it while it is shared.', 'One copy for the parent\'s stack page, one for the page holding marks[0] and marks[100], one for the page holding marks[5000]: ' + COPIES + '.'],
    solution: COPIES, wrong: [4, 2] });

  C.exercise({ id: 'proc-x-cow-why', chapter: 'proc-after', title: 'Why fork then exec is cheap', level: 1, kind: 'choice',
    text: ['A shell using 50 MB forks a child, which calls exec at once to run `ls`. With copy-on-write, roughly how much of the shell\'s memory is copied?'],
    options: ['All 50 MB, once', 'All 50 MB, twice: once for fork, once for exec', 'Almost none: exec replaces the child\'s pages before it writes to them', 'Half of it, on average'],
    answer: 2,
    whyNot: { 0: 'That is what fork did before copy-on-write. Now it copies only the page table and shares the pages.', 1: 'exec copies nothing from the old image: it loads the new program and drops the old pages.', 3: 'A page is copied only when someone writes to it; the child writes almost nothing before exec.' },
    hints: ['After fork, parent and child share every page read-only.', 'A page is copied only on the first write to it. What does the child write before exec?', 'Almost none: at most a stack page or two. exec then gives the shared pages back.'],
    solution: 2, wrong: [0, 1] });

  const PIPE2 = INC3 + 'int main(void) {\n    printf("go\\n");\n    if (fork() == 0) {\n        printf("kid\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf("mum\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-pipe-twice', chapter: 'proc-after', title: 'Into a pipe', level: 3, kind: 'fork-outputs', ask: 'set', tty: false,
    text: ['This program is run as `./a.out | cat`, so its stdout is a pipe and fully buffered. Write every output it can produce, one a line (write each output\'s line breaks as spaces).'],
    src: PIPE2,
    hints: ['Into a pipe, a newline does not send the buffer: "go\\n" is still in it at fork.', 'Both processes now hold "go\\n" and each adds its own line; each buffer is written when its process exits. The parent exits only after the child.', 'One output: go kid go mum.'],
    solution: ['go kid go mum'], wrong: [['go kid mum'], ['go kid go mum', 'go go kid mum']] });

  const XS = INC3 + 'int main(void) {\n    for (int i = 0; i < 2; i++) {\n        fork();\n        printf("x");\n    }\n    printf("\\n");\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  const NX = S.Kern.run(XS, { policy: 'fifo', cow: false }).out.split('').filter((c) => c === 'x').length;
  C.exercise({ id: 'proc-x-xs', chapter: 'proc-after', title: 'Counting the x\'s', level: 3, kind: 'number',
    text: ['How many `x` characters does this program print on a terminal in all?', { code: XS, lang: 'c' }],
    answer: NX, higherLower: true,
    whyNot: { 6: 'That counts one printf("x") per process per round it ran. But the x\'s printed before a fork are still in the buffer, and fork copies them.', 4: 'Each of the 4 processes prints a line, but each line has more than one x.', '*': 'No newline is printed until the end, so every x sits in a buffer that fork copies.' },
    hints: ['There is no newline until after the loop, so nothing is written before then: every x waits in the buffer.', 'After round 1 there are 2 processes, each with "x" in its buffer. Round 2 forks each of them, copying that "x", and then all 4 add one more.', '4 processes, each ending with "xx" in its buffer before the newline: ' + NX + ' x\'s.'],
    solution: NX, wrong: [6, 4] });

  const FLUSH = INC3 + 'int main(void) {\n    printf("log: starting ");\n    if (fork() == 0) {\n        printf("child\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf("parent\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-code-flush', chapter: 'proc-after', title: 'Print the log line once', level: 2, kind: 'code',
    text: ['This program prints `log: starting ` twice, once in front of each later line. Make it print `log: starting child` and then `parent`, on a terminal and into a pipe alike. Keep the text of every printf as it is.'],
    starter: FLUSH,
    tests: [{ name: 'on a terminal', stdout: 'log: starting child\nparent\n', seeds: [1, 2, 3] }, { name: 'into a pipe', tty: false, stdout: 'log: starting child\nparent\n', seeds: [1, 2, 3] }],
    hints: ['"log: starting " has no newline, so it is still in the stdout buffer when fork copies the process.', 'Empty the buffer before fork, so the copy is empty.', 'Add fflush(stdout); between the first printf and the fork.'],
    solution: FLUSH.replace('    printf("log: starting ");\n', '    printf("log: starting ");\n    fflush(stdout);\n'),
    wrong: [FLUSH, FLUSH.replace('        printf("child\\n");\n', '        fflush(stdout);\n        printf("child\\n");\n')] });

  const ORD3 = INC3 + 'int main(void) {\n    if (fork() == 0) {\n        printf("kid\\n");\n        return 0;\n    }\n    printf("one\\n");\n    printf("two\\n");\n    wait(NULL);\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-ord-three', chapter: 'proc-after', title: 'One line against two', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['Write every output this program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
    src: ORD3,
    hints: ['The parent\'s two lines always come in the order one, two; the wait is after both.', 'The child\'s line can come before one, between one and two, or after two.', 'Three outputs: kid one two, one kid two, one two kid.'],
    solution: ['kid one two', 'one kid two', 'one two kid'], wrong: [['kid one two', 'one two kid'], ['kid one two', 'one kid two', 'one two kid', 'two one kid']] });

  const ORDW = INC3 + 'int main(void) {\n    if (fork() == 0) {\n        printf("pack\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf("ship\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-ord-wait', chapter: 'proc-after', title: 'wait fixes the order', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['Write every output this program can produce, one a line (write each output\'s line breaks as spaces).'],
    src: ORDW,
    hints: ['The parent prints nothing before its wait.', 'wait returns only after the child has exited, and so after it has printed.', 'One output: pack ship.'],
    solution: ['pack ship'], wrong: [['pack ship', 'ship pack'], ['ship pack']] });

  // ---- orders set by sleep: S.Kern.outcomes with sleep: 'timed', so a longer sleeper wakes later ----------------------
  const RACE = INC + 'int main(void) {\n    for (int i = 0; i < 3; i++) {\n        if (fork() == 0) {\n            sleep(3 - i);\n            printf("runner %d home\\n", i);\n            exit(0);\n        }\n    }\n    while (wait(NULL) > 0)\n        ;\n    printf("all home\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-sleep-race', chapter: 'proc-after', title: 'Sleeping runners', level: 1, kind: 'fork-outputs', ask: 'set', sleep: 'timed',
    text: ['The parent forks three runners; runner i sleeps 3 − i seconds, then prints. Assume real timing: a second is far longer than any of the work, so a process asleep for longer wakes later. Write every output the program can produce on a terminal, one a line (each output\'s line breaks as spaces).'],
    src: RACE,
    hints: ['Runner 0 sleeps 3 seconds, runner 1 sleeps 2, runner 2 sleeps 1.', 'Each runner wakes at a different second, so their lines come in waking order, not in fork order. The parent prints only after its last wait.', 'One output: runner 2 home runner 1 home runner 0 home all home.'],
    solution: ['runner 2 home runner 1 home runner 0 home all home'],
    wrong: [['runner 0 home runner 1 home runner 2 home all home'], ['runner 2 home runner 1 home runner 0 home all home', 'runner 0 home runner 1 home runner 2 home all home']],
    whyNot: 'Sort the runners by when they wake, not by when they were forked.' });

  const BREAKFAST = INC + 'int main(void) {\n    if (fork() == 0) {\n        sleep(1);\n        printf("kettle\\n");\n        sleep(2);\n        printf("toast\\n");\n        exit(0);\n    }\n    if (fork() == 0) {\n        sleep(3);\n        printf("eggs\\n");\n        exit(0);\n    }\n    sleep(2);\n    printf("coffee\\n");\n    while (wait(NULL) > 0)\n        ;\n    printf("breakfast\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-sleep-tie', chapter: 'proc-after', title: 'Breakfast by the clock', level: 2, kind: 'fork-outputs', ask: 'set', sleep: 'timed',
    text: ['Three cooks share a kitchen and keep time only with sleep. Assume real timing: a process asleep for longer wakes later, and the work between sleeps takes no time worth counting. Write every output the program can produce on a terminal, one a line (each output\'s line breaks as spaces).'],
    src: BREAKFAST,
    hints: ['Work out the second at which each line is printed: kettle at 1, coffee at 2, then the parent waits.', 'toast comes at 1 + 2 = 3 seconds, and eggs at 3 seconds too. Two sleepers due at the same moment can run in either order.', 'Two outputs: kettle coffee toast eggs breakfast, and kettle coffee eggs toast breakfast.'],
    solution: ['kettle coffee toast eggs breakfast', 'kettle coffee eggs toast breakfast'],
    wrong: [['kettle coffee toast eggs breakfast'], ['kettle toast coffee eggs breakfast', 'kettle coffee eggs toast breakfast']] });
})(globalThis.Proses = globalThis.Proses || {});
