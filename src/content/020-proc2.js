// Part 2, processes: the lessons of the second chapter (fork, exec and wait). Every value quoted was worked out by
// the simulated kernel (S.Kern) running the topics' own programs; the lab cards open the Process lab set up.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('proc-fork')) return;
  const X = (id) => ({ exercise: id });
  const lab = (title, text, src, more) => ({ lab: 'process', title, text, setup: Object.assign({ src, policy: 'hand', show: 'procs', tty: true }, more || {}) });
  const BEANS = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    int beans = 5;\n    pid_t k = fork();\n    if (k == 0) {\n        beans = beans * 2;\n        printf("child %d\\n", beans);\n        return 0;\n    }\n    beans = beans + 1;\n    printf("parent %d\\n", beans);\n    wait(NULL);\n    return 0;\n}\n';
  const ROUNDS = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    for (int i = 0; i < 2; i++)\n        fork();\n    printf("I am %d\\n", getpid());\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  const STATUS = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    pid_t k = fork();\n    if (k == 0)\n        exit(5);\n    int st;\n    waitpid(k, &st, 0);\n    printf("status %d, code %d\\n", st, WEXITSTATUS(st));\n    return 0;\n}\n';

  // =========================================================================================================
  // Chapter 2: fork, exec and wait
  // =========================================================================================================
  C.lesson({
    id: 'proc-fork', chapter: 'proc-api', title: 'fork returns twice', minutes: 8,
    summary: 'fork makes a copy of the calling process: the same program at the same line, with a copy of every variable. Both copies return from the one call: the parent gets the child\'s pid, the child gets 0. From then on each changes only its own copies, and the scheduler decides which runs first.',
    blocks: [
      'There is no system call that says "start a new process running this function". There is one that says "make another one of me". How can one call that makes a copy be enough to start any work at all, and how does each copy know which one it is?',
      { def: 'fork', text: 'a system call that copies the calling process. The new process (the child) has its own pid and a copy of the parent\'s memory, registers and descriptors, and it starts by returning from the same fork call. fork returns the child\'s pid in the parent, 0 in the child, and −1 if no child could be made.' },
      { topic: 'p02-fork', input: { prog: 'twice', pol: 'fifo' }, frame: 0, caption: 'Process 100 starts main with x = 10 and is about to call fork at line 7.' },
      { topic: 'p02-fork', input: { prog: 'twice', pol: 'fifo' }, frame: 1, caption: 'fork has made process 101: a copy of 100, at the same line 7, with its own x = 10. k is not set yet: the call is about to return 101 in the parent and 0 in the child.' },
      { predict: { q: 'The child adds 1 to x and prints; the parent subtracts 1 and prints. What do they print?', options: ['child k=0 x=11 and parent k=101 x=10', 'Both x=10: a write after fork is not seen by anyone', 'child k=0 x=11 and parent k=101 x=9'], answer: 2, explain: 'Each changes its own copy, so the child sees 11 and the parent 9. Neither sees the other\'s change.' } },
      { topic: 'p02-fork', input: { prog: 'twice', pol: 'fifo' }, frame: 4, caption: 'The terminal shows parent k=101 x=9, then child k=0 x=11. Here the parent kept the CPU and printed first.' },
      { topic: 'p02-fork', input: { prog: 'twice', pol: 'child' }, frame: 4, caption: 'The same program with the newest process run first: now child k=0 x=11 comes before parent k=101 x=9. Both orders are correct runs; the program does not fix one.' },
      { topic: 'p02-fork', input: { prog: 'ids', pol: 'fifo' }, frame: 6, caption: 'getpid gives a process its own pid, getppid its parent\'s: the child prints 101 of 100, the parent 100 made 101.' },
      lab('Run fork by hand', 'The Process lab, with you choosing who runs: click the parent or the child at each step and see both orders of the two lines.', BEANS),
      { h: 'Recap' },
      { list: ['fork returns twice: the child\'s pid in the parent, 0 in the child.', 'The child is a copy: same code, same line, its own copies of the variables.', 'Which runs first is the scheduler\'s choice; a program that cares must wait.'] },
      X('proc-x-fork-ret'), X('proc-x-beans'), X('proc-x-fan-orders'),
    ],
  });

  C.lesson({
    id: 'proc-tree', chapter: 'proc-api', title: 'Counting the processes', minutes: 7,
    summary: 'Every process alive at a fork doubles: forks in a row, or in a loop, make 2ᴺ processes. If the child leaves the loop at once, the parent makes a fan of N children; if the parent leaves, each child forks the next, a chain. With && and ||, fork\'s return value decides who forks again.',
    blocks: [
      'Three lines of code: a loop that calls fork three times, then a printf. How many lines appear on the terminal? Counting forks gives 3, and counting the loop gives 3 too, but the answer is neither.',
      { topic: 'p02-forktree', input: { shape: 'loop', n: 3, pol: 'fifo' }, frame: 3, caption: 'Process 100 has forked three times: 101, 102 and 103. But 101 was made with i = 0, so it still has two rounds of the loop to run, and 102 has one.' },
      { topic: 'p02-forktree', input: { shape: 'loop', n: 3, pol: 'fifo' }, frame: 8, caption: '101 forks 104 and 105, 102 forks 106: every copy carries on with its own i. The tree is not a list of three children.' },
      { predict: { q: 'When every process has run the loop to the end, how many processes are there?', options: ['8', '4', '6', '3'], answer: 0, explain: 'Each fork doubles the processes alive at that point: 1, then 2, 4, 8. All 8 print "I am ...": 8 lines.' } },
      { topic: 'p02-forktree', input: { shape: 'loop', n: 3, pol: 'fifo' }, frame: 33, caption: 'In all 8 processes ran the program and each printed one line: 2 × 2 × 2.' },
      { topic: 'p02-forktree', input: { shape: 'fan', n: 4, pol: 'fifo' }, frame: 21, caption: 'If the child breaks out of the loop at once, only the first process ever forks: a fan of 4 children, 5 processes in all.' },
      { topic: 'p02-forktree', input: { shape: 'chain', n: 4, pol: 'fifo' }, frame: 21, caption: 'If the parent breaks out instead, each child forks the next: a chain four deep, again 5 processes.' },
      { topic: 'p02-forktree', input: { shape: 'and', n: 1, pol: 'fifo' }, frame: 13, caption: '`fork() && fork()`: in the first child the left fork returned 0, so && stops there; only the parent calls the second fork. 3 processes.' },
      lab('Two rounds, in the lab', 'Two forks in a loop: click through the four processes one by one, and use Every output to see the orders their lines can come out in.', ROUNDS),
      { tip: 'To count, follow one rule: at every fork, every process running that line becomes two. Draw the tree level by level, one level per fork call executed.' },
      { h: 'Recap' },
      { list: ['N forks in a row or in a loop: 2ᴺ processes.', 'Child breaks out: a fan, N + 1 processes. Parent breaks out: a chain, N + 1.', 'With && and ||, fork\'s value (0 in the child) decides who forks next.'] },
      X('proc-x-loop-lines'), X('proc-x-andand'), X('proc-x-tree-parents'),
    ],
  });

  C.lesson({
    id: 'proc-exec', chapter: 'proc-api', title: 'exec: a new program, the same process', minutes: 7,
    summary: 'exec replaces the program a process is running: new code, new data, a fresh stack and heap. The pid, the parent and the open descriptors stay. exec returns only if it fails. A shell runs a command by forking, then exec in the child, while the parent waits.',
    blocks: [
      'fork can only make copies of a program that is already running. Yet a shell starts `echo`, `wc` and `sort`, none of which is the shell. Something must turn a process into a different program.',
      { def: 'exec', text: 'a family of calls (execl, execlp, execv, execvp) that load a new program into the calling process. The memory image is replaced; the pid, parent, open descriptors, ignored signals and the signal mask are kept. On success it never returns; on failure it returns −1.' },
      { topic: 'p02-exec', input: { prog: 'keeps' }, frame: 5, caption: 'Before exec: process 100 has opened log.txt as descriptor 3, set a handler for SIGINT and ignored SIGQUIT. It prints 100 3, then puts never shown into its stdout buffer, with no newline.' },
      { predict: { q: 'Process 100 now calls execl("./show", "show", "hi", NULL). What happens to "never shown", still in the stdout buffer?', options: ['show prints it first', 'It is lost: the buffer is part of the old program\'s memory, which exec replaces', 'exec flushes it before loading show'], answer: 1, explain: 'The buffer belongs to the C library in the old image. exec throws the whole image away, buffer and all, so those bytes never reach the terminal.' } },
      { topic: 'p02-exec', input: { prog: 'keeps' }, frame: 6, caption: 'execl: process 100 is now running show, with argv show hi. Same pid, same descriptors; the unflushed buffer is gone.' },
      { topic: 'p02-exec', input: { prog: 'keeps' }, frame: 8, caption: 'show prints 100 hi (the pid has not changed) and writes to descriptor 3, which is still open on log.txt.' },
      { topic: 'p02-exec', input: { prog: 'forkexec' }, frame: 3, caption: 'The pattern a shell uses: fork, then execvp in the child. Process 101 becomes echo, while its parent is blocked in waitpid.' },
      { topic: 'p02-exec', input: { prog: 'fails' }, frame: 6, caption: 'A typo, ./shwo: execl fails with ENOENT and returns. The child prints the reason and calls exit(127); the parent\'s waitpid stores status 32512, exit code 127.' },
      { table: [['Kept by exec', 'Replaced by exec'], ['pid and parent pid', 'code, data, heap and stack'], ['open descriptors', 'the stdout buffer (lost if not flushed)'], ['ignored signals, the signal mask', 'handlers: caught signals go back to default'], ['the current directory', 'the arguments, which come from the call']], caption: 'What survives an exec.' },
      { warn: 'Always handle the return of exec: the code after it runs only when exec failed. Exiting with 127 there is the usual way to say "the command could not be run".' },
      { h: 'Recap' },
      { list: ['exec loads a new program into the same process: same pid, same descriptors.', 'Memory is replaced, unflushed stdio buffers included.', 'fork, then exec in the child, then wait in the parent: how commands are run.'] },
      X('proc-x-exec-out'), X('proc-x-exec-keeps'), X('proc-x-code-run'),
    ],
  });

  C.lesson({
    id: 'proc-wait', chapter: 'proc-api', title: 'wait and the exit status', minutes: 8,
    summary: 'wait blocks until some child exits and returns its pid; waitpid waits for a given child, and with WNOHANG returns 0 at once if it has not ended. Both store a status word: exit(c) gives (c & 255) << 8, a killing signal s gives s. WIFEXITED and WEXITSTATUS, WIFSIGNALED and WTERMSIG decode it.',
    blocks: [
      'A shell runs `make`, and then wants to know: did it succeed? The child has ended, and its memory is gone. How does the number it passed to exit get back to its parent?',
      { topic: 'p02-wait', input: { prog: 'codes', pol: 'fifo' }, frame: 7, caption: 'Three children sleep 3, 2 and 1 seconds and then exit with 10, 20 and 30. The parent is blocked in wait: none has ended yet.' },
      { predict: { q: 'Child 103 calls exit(30). wait stores a status word in st. What number is it?', options: ['30', '3', '7680'], answer: 2, explain: 'The exit code goes in bits 15 to 8: 30 × 256 = 7680. WEXITSTATUS(st) shifts it back down to 30.' } },
      { topic: 'p02-wait', input: { prog: 'codes', pol: 'fifo' }, frame: 9, caption: 'wait returns 103 with status 7680: WIFEXITED is true, WEXITSTATUS gives 30. Children are reaped in the order they end, not the order they were made.' },
      { topic: 'p02-wait', input: { prog: 'pick', pol: 'fifo' }, frame: 7, caption: 'waitpid(b, &st, 0) waits for one child. Child 101 ended first, but waitpid takes 102, status 512 (code 2); 101 waits, a zombie, for the next call.' },
      { topic: 'p02-wait', input: { prog: 'nohang', pol: 'fifo' }, frame: 2, caption: 'With WNOHANG, waitpid does not block: it returns 0 at once, since the child has not ended, and the parent can do something else meanwhile.' },
      { topic: 'p02-wait', input: { prog: 'signal', pol: 'fifo' }, frame: 5, caption: 'A child killed by SIGTERM: the status is 15, the signal number in the low 7 bits. WIFSIGNALED is true and WTERMSIG gives 15.' },
      { topic: 'p02-wait', input: { prog: 'signal', pol: 'fifo' }, frame: 7, caption: 'The parent then calls exit(300). Only the low 8 bits of the code are kept: 300 − 256 = 44, so the shell sees 44.' },
      { math: 'exit(c):            st = (c & 255) << 8\nkilled by signal s: st = s\nWIFEXITED(st)       (st & 127) == 0\nWEXITSTATUS(st)     (st >> 8) & 255\nWIFSIGNALED(st)     the low 7 bits are a signal\nWTERMSIG(st)        st & 127' },
      lab('A status word, in the lab', 'A child that calls exit(5), and a parent that prints both the raw status and the code.', STATUS, { policy: 'fifo' }),
      { h: 'Recap' },
      { list: ['wait: any child, blocking. waitpid: one child, or WNOHANG to ask without blocking.', 'The status is a word, not the code: decode it with the W macros.', 'Exit codes are 8 bits: exit(300) is seen as 44.'] },
      X('proc-x-status'), X('proc-x-exit300'), X('proc-x-code-order'), X('proc-x-code-sum'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
