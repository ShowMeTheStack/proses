// Part 2, processes: the exercises of the first two chapters (a program, running; fork, exec and wait). Every output
// a program can print is enumerated by the simulated kernel (S.Kern.outcomes) when the answer is checked; status
// words and the context switch's costs are worked out here by S.Kern and S.Os.contextSwitch, so nothing is typed from
// memory. The programs were also compiled with the system compiler and run many times: every real output is one the
// kernel lists.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || !S.Kern || !S.Os || C.exercises.has('proc-x-where')) return;
  const INC = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';

  // =========================================================================================================
  // Chapter 1: a program, running
  // =========================================================================================================
  const WHERE = INC + 'int hits = 5;\n\nint main(void) {\n    int count = 3;\n    char *name = malloc(16);\n    hits = hits + count;\n    free(name);\n    return 0;\n}\n';
  const WROWS = ['the global `hits`', 'the local `count`', 'the 16 bytes `name` points to', 'the code of `main`'];
  const WANT = ['data', 'stack', 'heap', 'text'];
  const wcells = (f) => Object.fromEntries(WROWS.map((r, i) => [r + '|region', f(i)]));
  C.exercise({ id: 'proc-x-where', chapter: 'proc-image', title: 'Where each thing lives', level: 1, kind: 'table',
    text: ['For each thing in this program, name the region of the address space that holds it: `text`, `data`, `heap` or `stack`.', { code: WHERE, lang: 'c' }],
    rows: WROWS, cols: ['region'], corner: 'thing', cellKind: 'text', cells: wcells((i) => WANT[i]),
    hints: ['Globals are laid out when the program is loaded; locals are made at each call; malloc\'s blocks come and go as the program asks.', 'A local lives in the frame of its call, on the stack. The pointer `name` is a local too, but the block it points to came from malloc.', 'hits: data. count: stack. The 16 bytes from malloc: heap. The code of main: text.'],
    solution: wcells((i) => WANT[i]), wrong: [wcells((i) => ['data', 'stack', 'stack', 'text'][i]), wcells((i) => ['heap', 'stack', 'heap', 'text'][i])] });

  // the deepest point of sum(3): main plus sum(3), sum(2), sum(1), sum(0)
  const SUMSRC = '#include <stdio.h>\n\nint sum(int n) {\n    if (n == 0)\n        return 0;\n    return n + sum(n - 1);\n}\n\nint main(void) {\n    printf("%d\\n", sum(3));\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-frames', chapter: 'proc-image', title: 'How deep the stack goes', level: 1, kind: 'number',
    text: ['How many frames are on the stack at the deepest point of this program, main\'s frame included?', { code: SUMSRC, lang: 'c' }],
    answer: 5, higherLower: true,
    whyNot: { 4: 'That counts the calls to sum (n = 3, 2, 1, 0) but not main, whose frame is still there below them.', 3: 'sum(0) is a call too: it has a frame of its own, even though it returns at once.', '*': 'List the calls that are active at once when sum(0) runs.' },
    hints: ['Each call that has not yet returned has a frame on the stack.', 'When sum(0) is running, sum(1), sum(2) and sum(3) are all waiting for it to return, and main is waiting for sum(3).', '5: main, sum(3), sum(2), sum(1) and sum(0). The topic draws them at 0x19fb0, 0x19f90, 0x19f70, 0x19f50 and 0x19f30.'],
    solution: 5, wrong: [4, 3] });

  C.exercise({ id: 'proc-x-pcb-fields', chapter: 'proc-image', title: 'What the PCB holds', level: 1, kind: 'choice',
    text: ['Which of these does the kernel keep in a process\'s control block? Pick every one.'],
    options: ['the pid of its parent', 'its saved registers and program counter', 'the text of its stdout buffer', 'its descriptor table', 'its signals pending', 'its exit status, after it exits'],
    answer: [0, 1, 3, 4, 5],
    whyNot: { 2: 'The stdout buffer belongs to the C library, in the process\'s own memory: the kernel never sees it until a write. That is why fork copies it and _exit loses it.' },
    hints: ['The PCB holds what the kernel needs to stop and restart the process, and to manage what it owns.', 'printf\'s buffer is not the kernel\'s: it is an array in the process\'s data, like any other variable.', 'All but the stdout buffer: the parent pid, the saved registers, the descriptor table, the pending signals and the exit status.'],
    solution: [0, 1, 3, 4, 5], wrong: [[0, 1, 2, 3, 4, 5], [0, 1, 3]] });

  C.exercise({ id: 'proc-x-arrow', chapter: 'proc-image', title: 'The arrow that is missing', level: 1, kind: 'choice',
    text: ['One of these state changes never happens in a single step. Which one?'],
    options: ['ready → running', 'running → blocked', 'blocked → running', 'running → ready', 'blocked → ready'],
    answer: 2,
    whyNot: { 0: 'That is a dispatch: the scheduler gives a ready process the CPU.', 1: 'A process blocks when it sleeps, waits for a child or reads with nothing to read.', 3: 'A process is preempted when its time slice is used up.', 4: 'That is a wake-up: the event it waited for has happened.' },
    hints: ['Which state is the only one the scheduler picks from?', 'When an event wakes a process, the CPU may well be busy with another process.', 'blocked → running: a woken process goes to ready first, and only the scheduler moves it on to running.'],
    solution: 2, wrong: [0, 3] });

  C.exercise({ id: 'proc-x-blocked', chapter: 'proc-image', title: 'Which calls block', level: 2, kind: 'choice',
    text: ['A process makes each of these calls. Which can move it from running to blocked? Pick every one.'],
    options: ['`wait(NULL)` while its only child is still running', '`sleep(1)`', '`getpid()`', '`read` on a pipe that is empty but still has a writer', '`waitpid(k, &st, WNOHANG)` while child k is still running', '`printf("hi\\n")` to a terminal'],
    answer: [0, 1, 3],
    whyNot: { 2: 'getpid answers at once from the PCB: nothing to wait for.', 4: 'WNOHANG means "do not hang": waitpid returns 0 at once if the child has not ended.', 5: 'A short write to a terminal is normally accepted at once: the line fits in the terminal\'s buffer, so nothing here makes the process wait.' },
    hints: ['A process blocks when it cannot go on until something else happens: time passing, a child ending, data arriving.', 'Look for the calls that wait for an event, and the one that is told explicitly not to.', 'wait with a running child, sleep and read on an empty pipe block. getpid, waitpid with WNOHANG and a printf to a terminal return at once.'],
    solution: [0, 1, 3], wrong: [[0, 1, 3, 4], [1]] });

  // the cost of a switch, from the engine
  const KINDS = [['two processes', {}], ['two processes, a tagged TLB', { asid: true }], ['two threads of one process', { sameSpace: true }]];
  const SW = KINDS.map(([n, o]) => S.Os.contextSwitch(o).cost);
  const yn = (b) => (b ? 'yes' : 'no');
  const SROWS = KINDS.map((k) => k[0]), SCOLS = ['page table changes', 'TLB flushed'];
  const scells = (f) => Object.fromEntries(SROWS.flatMap((r, i) => SCOLS.map((c, j) => [r + '|' + c, f(i, j)])));
  const sval = (i, j) => yn(j === 0 ? SW[i].pageTable : SW[i].tlbFlush);
  C.exercise({ id: 'proc-x-switch-table', chapter: 'proc-image', title: 'What a switch changes', level: 2, kind: 'table',
    text: ['The CPU switches from P to Q. For each case, does the page table change, and is the TLB flushed? Answer yes or no.'],
    rows: SROWS, cols: SCOLS, corner: 'P and Q are', cellKind: 'text', cells: scells(sval),
    hints: ['The page table belongs to an address space: does Q have a different one from P?', 'A TLB entry is a translation of one address space. Unless each entry says whose it is, entries of P would be wrong for Q.', 'Two processes: the page table changes and the TLB is flushed. With tagged entries the page table changes but nothing is flushed. Two threads of one process: neither.'],
    solution: scells(sval), wrong: [scells((i, j) => (i === 2 ? 'yes' : sval(i, j))), scells((i, j) => (i === 1 && j === 1 ? 'yes' : sval(i, j)))] });

  C.exercise({ id: 'proc-x-switch-where', chapter: 'proc-image', title: 'Where P\'s registers wait', level: 2, kind: 'choice',
    text: ['The timer interrupted P, and Q is now running. Where are the values P had in its user registers (its program counter, stack pointer, a0 and a1)?'],
    options: ['On P\'s user stack', 'In a trap frame on P\'s kernel stack', 'In Q\'s registers, until Q is done', 'Nowhere: P starts again from the top of its time slice'],
    answer: 1,
    whyNot: { 0: 'The user stack belongs to P\'s program, which could overwrite it; the kernel saves registers in memory only it controls.', 2: 'Q has its own values in the registers now: that is the point of the switch.', 3: 'P carries on exactly where it stopped, so its registers must be kept.' },
    hints: ['Saving starts at the moment P enters the kernel, before any decision to switch.', 'The trap entry pushes the user registers onto the kernel stack of the process that trapped.', 'In the trap frame on P\'s kernel stack; switch saves P\'s kernel registers (ra, sp, s0, s1) in P\'s process entry, and return-from-trap will pop the trap frame when P runs again.'],
    solution: 1, wrong: [0, 3] });

  // =========================================================================================================
  // Chapter 2: fork, exec and wait
  // =========================================================================================================
  C.exercise({ id: 'proc-x-fork-ret', chapter: 'proc-api', title: 'What fork returns', level: 1, kind: 'choice',
    text: ['Process 300 calls `pid_t k = fork();` and the call succeeds, making process 301. What is k in each process?'],
    options: ['0 in the parent, 301 in the child', '301 in both', '300 in the child, 301 in the parent', '301 in the parent, 0 in the child'],
    answer: 3,
    whyNot: { 0: 'It is the other way round: the parent needs the child\'s pid, and the child can always find its own with getpid.', 1: 'If both got the same value, nothing would tell them apart after the call.', 2: 'The child finds its parent\'s pid with getppid; fork gives it 0.' },
    hints: ['fork returns twice, with a different value in each process.', 'The parent may have many children and needs a way to name this one.', 'k = 301 (the child\'s pid) in the parent, k = 0 in the child.'],
    solution: 3, wrong: [0, 1] });

  C.exercise({ id: 'proc-x-beans', chapter: 'proc-api', title: 'Two copies of beans', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['Write every output this program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
    src: INC.replace('#include <stdlib.h>\n', '') + 'int main(void) {\n    int beans = 5;\n    if (fork() == 0) {\n        beans = beans * 2;\n        printf("child %d\\n", beans);\n        return 0;\n    }\n    beans = beans + 1;\n    printf("parent %d\\n", beans);\n    wait(NULL);\n    return 0;\n}\n',
    hints: ['Each process changes its own copy of beans, starting from 5.', 'The parent waits only after it prints, so either line may come first.', 'Two outputs: child 10 parent 6, and parent 6 child 10.'],
    solution: ['child 10 parent 6', 'parent 6 child 10'], wrong: [['child 10 parent 6'], ['child 10 parent 6', 'parent 6 child 10', 'child 10 parent 11']] });

  const FAN = INC.replace('#include <stdlib.h>\n', '') + 'int main(void) {\n    if (fork() == 0) {\n        printf("A\\n");\n        return 0;\n    }\n    if (fork() == 0) {\n        printf("B\\n");\n        return 0;\n    }\n    printf("P\\n");\n    while (wait(NULL) > 0)\n        ;\n    printf("end\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-fan-orders', chapter: 'proc-api', title: 'Two children and a parent', level: 2, kind: 'fork-outputs', ask: 'count',
    text: ['How many different outputs can this program produce?'],
    src: FAN,
    hints: ['A, B and P each print one line, and nothing orders them against each other: the parent prints P before it waits.', 'end comes last in every run, after the loop has reaped both children.', 'A, B and P in any order, then end: 3! = 6 outputs.'],
    solution: 6, wrong: [2, 24] });

  const ROUNDS = INC.replace('#include <stdlib.h>\n', '') + 'int main(void) {\n    for (int i = 0; i < 2; i++)\n        fork();\n    printf("hi\\n");\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-loop-lines', chapter: 'proc-api', title: 'Forks in a loop', level: 1, kind: 'fork-outputs', ask: 'lines',
    text: ['How many lines does this program print?'],
    src: ROUNDS,
    hints: ['Every process that is running the loop when fork is called becomes two.', 'Before the loop: 1 process. After the first fork: 2. After the second: each of those 2 forks again.', '4 processes, each printing hi once: 4 lines.'],
    solution: 4, wrong: [2, 3] });

  const ANDAND = INC.replace('#include <stdlib.h>\n', '') + 'int main(void) {\n    if (fork() && fork())\n        fork();\n    printf("tick\\n");\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-andand', chapter: 'proc-api', title: 'fork() && fork()', level: 3, kind: 'fork-outputs', ask: 'lines',
    text: ['How many times does this program print `tick`?'],
    src: ANDAND,
    hints: ['&& evaluates its right side only if the left side is not 0, and fork returns 0 in the child.', 'The first child sees 0 from the first fork: it skips the second fork and the if body. The second child sees 0 from the second fork: it skips the body too. Only the original process gets two non-zero values.', 'The original makes three children (one per fork it calls) and no child forks: 4 processes, 4 ticks.'],
    solution: 4, wrong: [8, 3] });

  const TREE = INC + 'int main(void) {\n    if (fork() == 0) {\n        if (fork() == 0) {\n            printf("C\\n");\n            return 0;\n        }\n    } else if (fork() == 0) {\n        printf("B\\n");\n        return 0;\n    }\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-tree-parents', chapter: 'proc-api', title: 'Who made whom', level: 2, kind: 'process-tree', ask: ['parents'],
    text: ['The program starts as process P (pid 100), and the kernel runs the first ready process each time, so the pids are handed out as A (101), B (102) and C (103). Give each process\'s parent.'],
    src: TREE, names: { 100: 'P', 101: 'A', 102: 'B', 103: 'C' }, policy: 'fifo', seed: 1,
    hints: ['The parent of a process is the one that called the fork that made it.', 'P\'s first fork makes A. In P the first fork returned A\'s pid, so P takes the else branch and forks again: B. A takes the first branch and forks: C.', 'A: P. B: P. C: A.'],
    solution: { parents: { A: 'P', B: 'P', C: 'A' } }, wrong: [{ parents: { A: 'P', B: 'A', C: 'P' } }, { parents: { A: 'P', B: 'A', C: 'B' } }] });

  const EXECOUT = INC + 'int main(void) {\n    printf("start\\n");\n    pid_t k = fork();\n    if (k == 0) {\n        execlp("echo", "echo", "from", "echo", NULL);\n        printf("after exec\\n");\n        exit(1);\n    }\n    waitpid(k, NULL, 0);\n    printf("parent done\\n");\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-exec-out', chapter: 'proc-api', title: 'What runs after exec', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['stdout is a terminal. Write every output this program can produce, one a line (write each output\'s line breaks as spaces).'],
    src: EXECOUT,
    hints: ['On a terminal "start\\n" is written at once, before fork.', 'If execlp succeeds it never returns, so the printf after it runs only when exec fails. echo exists here.', 'One output: start from echo parent done. The parent waits for the child before it prints.'],
    solution: ['start from echo parent done'], wrong: [['start from echo after exec parent done'], ['start from echo parent done', 'start parent done from echo']] });

  C.exercise({ id: 'proc-x-exec-keeps', chapter: 'proc-api', title: 'What survives exec', level: 1, kind: 'choice',
    text: ['A process opens a file as descriptor 3, sets a handler for SIGINT, ignores SIGQUIT, and calls `printf("ok")` with no newline. Then it calls execl and the call succeeds. Which of these does the new program still have? Pick every one.'],
    options: ['the same pid', 'descriptor 3, open on the same file', 'the handler for SIGINT', 'SIGQUIT ignored', '"ok" in its stdout buffer', 'the same parent'],
    answer: [0, 1, 3, 5],
    whyNot: { 2: 'The handler was a function in the old program, and that code is gone: a caught signal goes back to its default action.', 4: 'The buffer was in the old program\'s memory, which exec replaced: "ok" is lost.' },
    hints: ['exec keeps the process and replaces the program: ask of each item whether it belongs to the process (the kernel\'s PCB) or to the program\'s memory.', 'A handler is an address in the old code; "ignore" needs no code at all.', 'Kept: the pid, descriptor 3, SIGQUIT ignored and the parent. Gone: the SIGINT handler (back to default) and the unflushed "ok".'],
    solution: [0, 1, 3, 5], wrong: [[0, 1, 2, 3, 5], [0, 1, 3, 4, 5]] });

  const RUNCAT = INC + 'int main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        char *av[] = {"cat", "notes.txt", NULL};\n        execvp("cat", av);\n        exit(127);\n    }\n    int st;\n    waitpid(k, &st, 0);\n    printf("cat gave %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-code-run', chapter: 'proc-api', title: 'Run a command, report its code', level: 2, kind: 'code',
    text: ['Write a program that runs `cat notes.txt` in a child process (fork, then `execvp`), waits for it, and then prints `cat gave N`, where N is the exit code cat returned. If exec fails, the child should exit with 127.', 'The tests run it with a notes.txt on the disk (cat gives 0) and without one (cat prints a complaint and gives 1), under several schedules.'],
    starter: INC + 'int main(void) {\n    /* fork; in the child, run cat notes.txt with execvp */\n    /* in the parent, wait for the child, then print its exit code */\n    return 0;\n}\n',
    tests: [
      { name: 'notes.txt is there', files: { 'notes.txt': 'pear\napple\n' }, stdout: 'pear\napple\ncat gave 0\n', seeds: [1, 2, 3] },
      { name: 'another notes.txt', files: { 'notes.txt': 'fig\n' }, stdout: 'fig\ncat gave 0\n', seeds: [4, 5] },
      { name: 'no notes.txt', files: {}, match: 'cat gave 1\\n$', seeds: [1, 2] },
    ],
    hints: ['In the child: build `char *av[] = {"cat", "notes.txt", NULL};` and call `execvp("cat", av)`; the line after it runs only if exec failed.', 'In the parent: `waitpid(k, &st, 0)` waits for that child and fills st. The status word is not the code: decode it.', 'pid_t k = fork(); if (k == 0) { char *av[] = {"cat", "notes.txt", NULL}; execvp("cat", av); exit(127); } int st; waitpid(k, &st, 0); printf("cat gave %d\\n", WEXITSTATUS(st));'],
    solution: RUNCAT,
    wrong: [RUNCAT.replace('    waitpid(k, &st, 0);\n', '    st = 0;\n'), RUNCAT.replace('WEXITSTATUS(st)', 'st')] });

  // status words, from the kernel
  const statusOf = (code) => { const sys = S.Kern.run(INC + 'int main(void) {\n    pid_t k = fork();\n    if (k == 0)\n        exit(' + code + ');\n    int st;\n    waitpid(k, &st, 0);\n    printf("%d %d\\n", st, WEXITSTATUS(st));\n    return 0;\n}\n', { policy: 'fifo', cow: false }); const [st, c] = sys.out.trim().split(' ').map(Number); return { st, c }; };
  const S6 = statusOf(6), S260 = statusOf(260);
  C.exercise({ id: 'proc-x-status', chapter: 'proc-api', title: 'The status word', level: 2, kind: 'number',
    text: ['A child calls `exit(6)`. Its parent calls `waitpid(k, &st, 0)`. What number is in st? (WEXITSTATUS(st) would give 6.)'],
    answer: S6.st, higherLower: true,
    whyNot: { 6: 'That is what WEXITSTATUS(st) gives. The status word keeps the code in bits 15 to 8, so it is shifted.', '*': 'The exit code goes in bits 15 to 8 of the status word, and the low bits are 0 for a normal exit.' },
    hints: ['The status word packs two things: the exit code, or the signal that killed the process.', 'For a normal exit the code is shifted left by 8: st = (code & 255) << 8.', '6 × 256 = ' + S6.st + '.'],
    solution: S6.st, wrong: [6, 60] });

  C.exercise({ id: 'proc-x-exit300', chapter: 'proc-api', title: 'An exit code too big', level: 2, kind: 'number',
    text: ['A child calls `exit(260)`. Its parent waits for it and prints `WEXITSTATUS(st)`. What does it print?'],
    answer: S260.c, higherLower: true,
    whyNot: { 260: 'An exit code is only 8 bits: the kernel keeps 260 & 255.', 1024: 'That is the whole status word; WEXITSTATUS shifts it back down by 8.', '*': 'Keep only the low 8 bits of 260.' },
    hints: ['The status word has room for 8 bits of exit code.', 'The kernel keeps code & 255: whatever is left after taking away multiples of 256.', '260 − 256 = ' + S260.c + ': the parent prints ' + S260.c + ' (the status word itself is ' + S260.st + ').'],
    solution: S260.c, wrong: [260, 1024] });

  const ORDER = INC + 'int main(void) {\n    pid_t kids[3];\n    for (int i = 0; i < 3; i++) {\n        kids[i] = fork();\n        if (kids[i] == 0) {\n            sleep(3 - i);\n            exit(10 + i);\n        }\n    }\n    int st;\n    for (int i = 0; i < 3; i++) {\n        wait(&st);\n        printf("%d: %d\\n", i, WEXITSTATUS(st));\n    }\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-code-order', chapter: 'proc-api', title: 'Results in the order started', level: 2, kind: 'code',
    text: ['Child i sleeps 3 − i seconds and exits with 10 + i, so child 2 finishes first. The parent should print the children\'s codes in the order they were started: `0: 10`, then `1: 11`, then `2: 12`. As written it prints them in the order they finish. Fix the parent.'],
    starter: ORDER,
    tests: [{ name: 'in the order started', stdout: '0: 10\n1: 11\n2: 12\n', seeds: [1, 2, 3, 4] }],
    hints: ['wait takes whichever child ends next: here, child 2 first.', 'waitpid names the child to wait for, and the pids are already saved in kids.', 'Replace `wait(&st);` with `waitpid(kids[i], &st, 0);`.'],
    solution: ORDER.replace('        wait(&st);\n', '        waitpid(kids[i], &st, 0);\n'),
    wrong: [ORDER, ORDER.replace('        wait(&st);\n', '        waitpid(kids[2 - i], &st, 0);\n')] });

  const SUMSTART = '#include <stdio.h>\n#include <stdlib.h>\n#include <signal.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    for (int i = 0; i < 4; i++) {\n        if (fork() == 0) {\n            if (i == 2)\n                raise(SIGKILL);\n            exit((i + 1) * 3);\n        }\n    }\n';
  const SUMDONE = SUMSTART + '    int sum = 0;\n    int killed = 0;\n    int st;\n    while (wait(&st) > 0) {\n        if (WIFEXITED(st))\n            sum = sum + WEXITSTATUS(st);\n        else if (WIFSIGNALED(st))\n            killed = killed + 1;\n    }\n    printf("sum = %d, killed = %d\\n", sum, killed);\n    return 0;\n}\n';
  C.exercise({ id: 'proc-x-code-sum', chapter: 'proc-api', title: 'Add up what the workers report', level: 3, kind: 'code',
    text: ['Four workers report a count each through their exit code: worker i exits with (i + 1) × 3. But worker 2 is killed by a signal before it can report. Finish the parent: reap every worker, add up the codes of the workers that exited normally, count the ones killed by a signal, and print `sum = S, killed = K`.'],
    starter: SUMSTART + '    /* reap every worker; add up the exit codes; count the killed ones */\n    return 0;\n}\n',
    tests: [{ name: 'four workers', stdout: 'sum = 21, killed = 1\n', seeds: [1, 2, 3, 4, 5] }],
    hints: ['Loop with `while (wait(&st) > 0)`: wait returns −1 once there is no child left.', 'A status is either a normal exit (WIFEXITED, then WEXITSTATUS gives the code) or a death by signal (WIFSIGNALED, then WTERMSIG gives the signal).', 'In the loop: if (WIFEXITED(st)) sum += WEXITSTATUS(st); else if (WIFSIGNALED(st)) killed++; then print. 3 + 6 + 12 = 21, and 1 killed.'],
    solution: SUMDONE,
    wrong: [SUMDONE.replace('        if (WIFEXITED(st))\n            sum = sum + WEXITSTATUS(st);\n        else if (WIFSIGNALED(st))\n            killed = killed + 1;\n', '        sum = sum + WEXITSTATUS(st);\n'), SUMDONE.replace('sum = sum + WEXITSTATUS(st)', 'sum = sum + st')] });
})(globalThis.Proses = globalThis.Proses || {});
