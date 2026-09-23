// Part 1, what an operating system does: the exercises of chapter 1 (what the OS gives a program). Schedules come
// from S.Sched (the same round robin the time-sharing topic draws), and every output a C program can print is
// enumerated by the simulated kernel (S.Kern.outcomes) when the answer is checked. The C programs were also compiled
// with the system compiler and run many times: every real output is one listed here.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || !S.Sched || C.exercises.has('os-x-wall-clock')) return;
  const W = (spec) => spec.map(([id, n]) => ({ id, arrive: 0, bursts: [n] }));
  const rr = (work, q) => S.Sched.run(work, 'rr', { quantum: q });
  const row = (tr, id) => tr.metrics.rows.find((r) => String(r.id) === id);

  // =========================================================================================================
  // Sharing the CPU
  // =========================================================================================================
  const W1 = W([['A', 3], ['B', 5], ['C', 2]]), T1 = rr(W1, 2), B1 = row(T1, 'B').finish;
  C.exercise({ id: 'os-x-wall-clock', chapter: 'os-what', title: 'Work against the wall clock', level: 1, kind: 'number',
    text: ['Three programs start together on one CPU: A needs 3 ticks of work, B 5 and C 2. The kernel gives slices of 2 ticks in turn, A, B, C, A, B, ..., skipping a program once it has finished; switches take no time. At what time on the wall clock does B finish?'],
    answer: B1,
    whyNot: { 5: 'That is B\'s own work, the time it would take alone. It also waits while A and C have their slices.', 7: 'B still has ticks left at t = 7: after A\'s last tick, B runs 3 more.', 9: 'Count B\'s ticks: 2 in its first slice, then 3 more from t = 7, the last of them ending one tick after 9.' },
    hints: ['Write the slices out in order: who runs from 0 to 2, from 2 to 4, and so on.', 'A 0 to 2, B 2 to 4, C 4 to 6 (C is done), A 6 to 7 (A is done), then B alone.', 'B runs 2 to 4, then from 7 to ' + B1 + ': it finishes at t = ' + B1 + ', though its own work is only 5 ticks.'],
    solution: B1, wrong: [5, 7, 9] });

  const W2 = W([['A', 5], ['B', 2], ['C', 4]]), T2 = rr(W2, 2);
  const tickStr = (tr) => { const t = Array.from({ length: tr.end }, () => '-'); for (const s of tr.segs) for (let k = s.start; k < s.end; k++) t[k] = String(s.job); return t.join(''); };
  const fin2 = Object.fromEntries(['A', 'B', 'C'].map((j) => [j + '|finish', String(row(T2, j).finish)]));
  C.exercise({ id: 'os-x-share-chart', chapter: 'os-what', title: 'Draw the time-sharing', level: 2, kind: 'gantt',
    text: ['A needs 5 ticks, B 2 and C 4, all ready at t = 0, in that order. The timer gives slices of 2 ticks (round robin, switches free). Paint the chart tick by tick and give each program\'s finishing time.'],
    workload: W2, policy: 'rr', params: { quantum: 2 }, ask: 'both', metrics: ['finish'],
    hints: ['Each program runs 2 ticks, then goes to the back of the line; one that finishes leaves the line.', 'A 0 to 2, B 2 to 4 (B is done), C 4 to 6, A 6 to 8, C 8 to 10 (C is done), then A.', 'Chart ' + tickStr(T2) + '. A finishes at ' + fin2['A|finish'] + ', B at ' + fin2['B|finish'] + ', C at ' + fin2['C|finish'] + '.'],
    solution: { ticks: tickStr(T2), metrics: fin2 },
    wrong: [{ ticks: 'AABBCCAACCA', metrics: Object.assign({}, fin2, { 'A|finish': '5' }) }, { ticks: 'AAAAABBCCCC', metrics: { 'A|finish': '5', 'B|finish': '7', 'C|finish': '11' } }] });

  const S1 = rr(W2, 1), S4 = rr(W2, 4);
  const SC = ['finish, slices of 1', 'first runs, slices of 1', 'finish, slices of 4', 'first runs, slices of 4'];
  const scells = {};
  for (const j of ['A', 'B', 'C']) { scells[j + '|' + SC[0]] = row(S1, j).finish; scells[j + '|' + SC[1]] = row(S1, j).response; scells[j + '|' + SC[2]] = row(S4, j).finish; scells[j + '|' + SC[3]] = row(S4, j).response; }
  const sAns = Object.fromEntries(Object.entries(scells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'os-x-slices', chapter: 'os-what', title: 'Short slices, long slices', level: 2, kind: 'table',
    text: ['The same three programs (A 5 ticks, B 2, C 4, all ready at t = 0, in that order) with slices of 1 tick, then with slices of 4. For each, give the time it finishes and the time it first gets the CPU.'],
    rows: ['A', 'B', 'C'], cols: SC, corner: 'program', cells: scells,
    hints: ['Write each schedule out: with slices of 1, A B C A B C A C A C A.', 'With slices of 4: A runs 0 to 4, B 4 to 6, C 6 to 10, A 10 to 11.', 'Slices of 1: A ' + scells['A|' + SC[0]] + ', B ' + scells['B|' + SC[0]] + ', C ' + scells['C|' + SC[0]] + ', first runs at 0, 1, 2. Slices of 4: A ' + scells['A|' + SC[2]] + ', B ' + scells['B|' + SC[2]] + ', C ' + scells['C|' + SC[2]] + ', first runs at 0, 4, 6. Short slices start everyone sooner; the last finish is the same.'],
    solution: sAns,
    wrong: [Object.assign({}, sAns, { ['B|' + SC[2]]: '2', ['B|' + SC[3]]: '0' }), Object.assign({}, sAns, { ['C|' + SC[1]]: '7' })] });

  // =========================================================================================================
  // A memory of one's own; persistence
  // =========================================================================================================
  const SEATS = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint seats = 40;\n\nint main(void) {\n    if (fork() == 0) {\n        seats = seats - 3;\n        printf("child sees %d\\n", seats);\n        return 0;\n    }\n    seats = seats + 5;\n    printf("parent sees %d\\n", seats);\n    wait(NULL);\n    printf("parent ends with %d\\n", seats);\n    return 0;\n}\n';
  C.exercise({ id: 'os-x-seats', chapter: 'os-what', title: 'Two processes, one variable name', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['A booking program forks. The child takes 3 seats, the parent adds 5. Write every output the program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
    src: SEATS,
    hints: ['After fork each process has its own copy of seats, starting at 40.', 'The child prints 40 − 3 and the parent 40 + 5; neither sees the other\'s change. Only the order of the first two lines can vary.', 'Two outputs: child sees 37 parent sees 45 parent ends with 45, and parent sees 45 child sees 37 parent ends with 45.'],
    solution: ['child sees 37 parent sees 45 parent ends with 45', 'parent sees 45 child sees 37 parent ends with 45'],
    wrong: [['child sees 37 parent sees 42 parent ends with 42', 'parent sees 45 child sees 42 parent ends with 42'], ['child sees 37 parent sees 45 parent ends with 45']] });

  C.exercise({ id: 'os-x-same-address', chapter: 'os-what', title: 'Same address, two values', level: 1, kind: 'choice',
    text: ['After a fork, the child sets the global `balance` to 250 and prints `&balance`: 0x1000. The parent, which never changed `balance`, prints its address too: also 0x1000, but with the value 100. How can one address hold two values?'],
    options: ['Each process has its own address space: the kernel maps 0x1000 to a different physical frame in each, once one of them writes', 'The child\'s write has not reached memory yet; given time, the parent will see 250', 'The parent printed before the child wrote', 'Addresses printed with %p are not real addresses'],
    answer: 0,
    whyNot: { 1: 'The write is complete in the child\'s memory; the parent will never see it, however long it waits.', 2: 'The parent waits for the child before it prints, so the child\'s write came first.', 3: 'They are real virtual addresses. The point is that a virtual address means something only inside one process.' },
    hints: ['Is 0x1000 a place in the memory chips, or a name inside one process?', 'Each process has a page table mapping its pages to frames. After fork both map the page to one frame, read-only; the first write gets a private copy.', 'Separate address spaces: the same virtual address 0x1000, two different frames, two values.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'os-x-persist-why', chapter: 'os-what', title: 'What survives', level: 1, kind: 'choice',
    text: ['A child process stores the line "milk, eggs" in three places: a global array, a block from malloc, and the file f.txt (written and closed). Then it exits. Which of the three can its parent still read? Pick every one.'],
    options: ['the global array', 'the malloc block', 'the file f.txt'],
    answer: [2],
    whyNot: { 0: 'The array was in the child\'s own address space, which is freed when the child exits; the parent always had its own copy anyway.', 1: 'The heap is part of the child\'s address space too: gone with the child.' },
    hints: ['What belongs to a process, and what belongs to the operating system?', 'Memory, heap included, belongs to the process and is freed at exit. A file belongs to the file system.', 'Only the file: the parent can open f.txt by name and read "milk, eggs" back.'],
    solution: [2], wrong: [[0, 1, 2], [1, 2]] });

  const RACE = '#include <stdio.h>\n#include <fcntl.h>\n#include <unistd.h>\n\nint main(void) {\n    if (fork() == 0) {\n        int fd = open("note.txt", O_WRONLY | O_CREAT, 0644);\n        write(fd, "plums", 5);\n        close(fd);\n        return 0;\n    }\n    char buf[16];\n    int n = -1;\n    int fd = open("note.txt", O_RDONLY);\n    if (fd >= 0)\n        n = read(fd, buf, 15);\n    printf("read %d\\n", n);\n    return 0;\n}\n';
  C.exercise({ id: 'os-x-no-wait', chapter: 'os-what', title: 'Reading before the writer is done', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['The disk starts empty. The child creates note.txt and writes 5 bytes; the parent reads it, but forgot to wait for the child. Write every output the program can produce, one a line.'],
    src: RACE,
    hints: ['The parent\'s open and read can happen at any point of the child\'s three steps: before the open, between the open and the write, or after the write.', 'Before the file exists, open fails and n stays −1. Once it exists but is still empty, read returns 0.', 'Three outputs: read -1, read 0 and read 5.'],
    solution: ['read -1', 'read 0', 'read 5'], wrong: [['read 5'], ['read -1', 'read 5']] });

  // =========================================================================================================
  // The referee
  // =========================================================================================================
  C.exercise({ id: 'os-x-who-dies', chapter: 'os-what', title: 'Who pays for a bad pointer', level: 1, kind: 'choice',
    text: ['The shell runs your program, which forks a child. The child writes through a NULL pointer. Which processes does the kernel end?'],
    options: ['Only the child', 'The child and your program, its parent', 'The child, your program and the shell', 'None: the write is simply ignored'],
    answer: 0,
    whyNot: { 1: 'The parent did nothing wrong: it learns through wait that the child was killed by SIGSEGV, and carries on.', 2: 'The shell is two generations away and did nothing wrong at all.', 3: 'The write cannot be ignored: there is no page at address 0, so the CPU traps and the kernel must decide. It ends the child.' },
    hints: ['A fault is caused by one instruction of one process.', 'The trap tells the kernel exactly which process made the bad access, and the kernel sends the signal to that process only.', 'Only the child is ended (SIGSEGV, signal 11); its parent can read that from the status wait gives it.'],
    solution: 0, wrong: [1, 2] });

  const TWO = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        int *p = NULL;\n        *p = 1;\n        printf("A: done\\n");\n        return 0;\n    }\n    pid_t b = fork();\n    if (b == 0) {\n        printf("B: fine\\n");\n        return 3;\n    }\n    int st;\n    waitpid(a, &st, 0);\n    printf("A: %s\\n", WIFSIGNALED(st) ? "killed" : "exited");\n    waitpid(b, &st, 0);\n    printf("B: %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n';
  C.exercise({ id: 'os-x-two-endings', chapter: 'os-what', title: 'Two children, two endings', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['Child A writes through NULL; child B prints a line and exits with 3. The parent waits for A, then for B, and reports how each ended. Write every output the program can produce on a terminal, one a line.'],
    src: TWO,
    hints: ['A never reaches its printf: the write through NULL ends it with SIGSEGV first.', 'The parent prints about A only after waitpid(a) returns, and about B after waitpid(b). But B\'s own line can come before or after the parent\'s line about A.', 'Two outputs: B: fine A: killed B: 3, and A: killed B: fine B: 3.'],
    solution: ['B: fine A: killed B: 3', 'A: killed B: fine B: 3'],
    wrong: [['A: done B: fine A: exited B: 3'], ['B: fine A: killed B: 3']] });

  const KID = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        /* the child: given, do not change */\n        char buf[8];\n        int n = read(0, buf, 7);\n        buf[n > 0 ? n : 0] = 0;\n        if (buf[0] == \'s\') {\n            int *p = NULL;\n            *p = 1;\n        }\n        return atoi(buf);\n    }\n';
  const REPORT = KID + '    int st;\n    waitpid(k, &st, 0);\n    if (WIFSIGNALED(st))\n        printf("child killed by signal %d\\n", WTERMSIG(st));\n    else\n        printf("child exited with %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n';
  C.exercise({ id: 'os-x-code-report', chapter: 'os-what', title: 'Report how the child ended', level: 2, kind: 'code',
    text: ['The child reads a word from its input: `stop` makes it write through a NULL pointer, so the kernel kills it with SIGSEGV; a number becomes its exit code. Write the parent\'s part: wait for this child, then print `child killed by signal N` if a signal ended it, or `child exited with N` if it returned, and nothing else.', 'The macros WIFSIGNALED, WTERMSIG and WEXITSTATUS read the status that waitpid fills in.'],
    starter: KID + '    /* the parent: wait for k, then report */\n    return 0;\n}\n',
    tests: [{ name: 'crashed', input: 'stop', signal: 'SIGSEGV', stdout: 'child killed by signal 11\n', seeds: [1, 2, 3] }, { name: 'exit code 4', input: '4', stdout: 'child exited with 4\n', seeds: [1, 2] }, { name: 'exit code 0', input: '0', stdout: 'child exited with 0\n', seeds: [1, 2] }],
    hints: ['Declare `int st;` and call `waitpid(k, &st, 0)`: it returns once the child has ended and stores how.', 'WIFSIGNALED(st) is true when a signal ended the child; then WTERMSIG(st) is the signal\'s number. Otherwise WEXITSTATUS(st) is the value it returned.', 'int st; waitpid(k, &st, 0); if (WIFSIGNALED(st)) printf("child killed by signal %d\\n", WTERMSIG(st)); else printf("child exited with %d\\n", WEXITSTATUS(st));'],
    solution: REPORT,
    wrong: [KID + '    int st;\n    waitpid(k, &st, 0);\n    printf("child exited with %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n', KID + '    printf("child exited with 0\\n");\n    return 0;\n}\n'] });

  const ROLES = ['A program loops for ever, yet the others still get their turns', 'Two processes use address 0x1000 for different data', 'A text written by one program is read by another a day later', 'A program that runs cli in user mode is ended', 'A program runs as if it had the CPU to itself'];
  const RW = ['referee', 'illusionist', 'glue', 'referee', 'illusionist'];
  C.exercise({ id: 'os-x-roles', chapter: 'os-what', title: 'Referee, illusionist or glue?', level: 2, kind: 'table',
    text: ['Three ways to see an operating system: a **referee** that enforces the rules between programs, an **illusionist** that makes one CPU and one memory look like many private ones, and **glue** that gives programs shared services such as files that outlive them. For each situation, write the role it shows best: referee, illusionist or glue.'],
    rows: ROLES, cols: ['role'], corner: 'situation', cellKind: 'text',
    cells: Object.fromEntries(ROLES.map((r, i) => [r + '|role', RW[i]])),
    hints: ['Ask what the OS is doing: stopping something, hiding something, or providing something.', 'Taking the CPU back from a loop and ending a program for a forbidden instruction are enforcement. Private address spaces and private-looking CPUs are illusions.', 'Referee: the loop and the cli. Illusionist: the two 0x1000s and the CPU of one\'s own. Glue: the file read a day later.'],
    solution: Object.fromEntries(ROLES.map((r, i) => [r + '|role', RW[i]])),
    wrong: [Object.fromEntries(ROLES.map((r, i) => [r + '|role', i === 0 ? 'illusionist' : RW[i]])), Object.fromEntries(ROLES.map((r, i) => [r + '|role', i === 2 ? 'illusionist' : RW[i]]))] });
})(globalThis.Proses = globalThis.Proses || {});
