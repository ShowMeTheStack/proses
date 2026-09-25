// Part 2, processes: the lessons of the third chapter (after fork, after exit: zombies and orphans, copy-on-write,
// stdio buffers across fork, and every order a program can print in). Every value quoted was worked out by the
// simulated kernel (S.Kern) running the topics' own programs.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('proc-zombie')) return;
  const X = (id) => ({ exercise: id });
  const lab = (title, text, src, more) => ({ lab: 'process', title, text, setup: Object.assign({ src, policy: 'fifo', show: 'procs', tty: true }, more || {}) });
  const FAMILY = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    if (fork() == 0) {\n        printf("quick: done\\n");\n        exit(2);\n    }\n    if (fork() == 0) {\n        sleep(2);\n        printf("slow: my parent is %d\\n", getppid());\n        exit(0);\n    }\n    sleep(1);\n    printf("parent: leaving without a wait\\n");\n    return 0;\n}\n';
  const START = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    printf("start\\n");\n    if (fork() == 0) {\n        printf("child\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf("parent\\n");\n    return 0;\n}\n';
  const FREE = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    if (fork() == 0) {\n        printf("child 1\\n");\n        printf("child 2\\n");\n        return 0;\n    }\n    printf("parent 1\\n");\n    printf("parent 2\\n");\n    wait(NULL);\n    return 0;\n}\n';

  // =========================================================================================================
  // Chapter 3: after fork, after exit
  // =========================================================================================================
  C.lesson({
    id: 'proc-zombie', chapter: 'proc-after', title: 'Zombies, orphans and init', minutes: 8,
    summary: 'A process that exits keeps its process-table entry, holding its exit status, until its parent waits for it: until then it is a zombie. A process whose parent exits first is an orphan: the kernel re-parents it to init (pid 1), which waits in a loop and so reaps every orphan when it ends.',
    blocks: [
      'A child exits while its parent is busy elsewhere. Its memory can be freed at once, but its exit code cannot be thrown away: the parent may still ask for it. And if the parent itself exits first, who is left to ask?',
      { def: 'zombie', text: 'a process that has exited but whose parent has not yet collected its status with wait. Only its process-table entry is left.' },
      { def: 'orphan', text: 'a process whose parent has exited before it. The kernel makes init (pid 1) its parent; init calls wait in a loop, so every orphan is reaped in the end.' },
      { topic: 'p02-zombie', input: { prog: 'zombie', pol: 'fifo' }, frame: 4, caption: 'The child exits with 7 while its parent sleeps for 2 seconds. Its memory is freed, but its entry stays, holding the code 7: a zombie.' },
      { topic: 'p02-zombie', input: { prog: 'zombie', pol: 'fifo' }, frame: 5, caption: 'The parent wakes and calls waitpid, which returns 101 with status 1792 (code 7). The entry leaves the table: the zombie is reaped.' },
      { predict: { q: 'Another program: the parent prints and returns at once, while its child sleeps for 2 seconds and then prints getppid(). What does the child print?', options: ['parent: 1', 'parent: 100', 'Nothing: a child dies with its parent'], answer: 0, explain: 'When 100 exits, its child is re-parented to init, so getppid() returns 1. A child does not die with its parent.' } },
      { topic: 'p02-zombie', input: { prog: 'orphan', pol: 'fifo' }, frame: 4, caption: 'Process 100 has returned: process 101 has lost its parent and is re-parented to init (pid 1).' },
      { topic: 'p02-zombie', input: { prog: 'orphan', pol: 'fifo' }, frame: 9, caption: 'The orphan prints parent: 1 and exits, and init reaps it at once: no zombie is left behind.' },
      { topic: 'p02-zombie', input: { prog: 'never', pol: 'fifo' }, frame: 8, caption: 'A parent that never waits: its two children are zombies for as long as it sleeps. Only when it exits are they re-parented to init, which reaps both.' },
      { warn: 'A long-running server that forks a child per request and never waits fills the process table with zombies, one per request, until fork fails. Reap every child: with wait, with waitpid and WNOHANG in a loop, or from a SIGCHLD handler.' },
      lab('A zombie and an orphan, in the lab', 'quick exits at once and is a zombie while its parent sleeps; slow outlives its parent and is adopted by init. Step through and watch the process table.', FAMILY),
      { h: 'Recap' },
      { list: ['A zombie: exited, status not yet collected. It holds an entry, not memory.', 'An orphan: its parent exited first; init adopts it and will reap it.', 'A parent that forks should wait for every child it makes.'] },
      X('proc-x-zombie-one'), X('proc-x-orphan-tree'), X('proc-x-family'), X('proc-x-code-reap'), X('proc-x-code-detach'),
    ],
  });

  C.lesson({
    id: 'proc-cow', chapter: 'proc-after', title: 'Copy-on-write', minutes: 7,
    summary: 'fork does not copy memory. Parent and child share every page, both mapped read-only, and a write to a shared page faults: only then does the kernel copy that one page for the writer. A child that execs at once copies almost nothing; a page that is only read is never copied.',
    blocks: [
      'A shell with 50 MB of memory forks to run `ls`. If fork copied all 50 MB, then exec threw it away a moment later, almost all of that work would be wasted. Yet the child must look like a full copy of the parent. How can both be true?',
      { def: 'copy-on-write', text: 'after fork, parent and child share their pages, each marked read-only. The first write to a shared page faults; the kernel copies that page to a fresh frame for the writer and makes both mappings writable again. A page is copied only if, and when, someone writes to it.' },
      { topic: 'p02-cow', input: { prog: 'global' }, frame: 1, caption: 'Process 100 forks 101: the child shares all 10 of its parent\'s pages, read-only. No memory is copied; every frame now has two users.' },
      { topic: 'p02-cow', input: { prog: 'global' }, frame: 2, caption: 'The parent writes to its stack (page 9). The write faults, and the kernel copies that page into frame 11 for it. Frame 10 now has one user, the child, so it needs no copy.' },
      { topic: 'p02-cow', input: { prog: 'global' }, frame: 3, caption: 'The child sets count = 42, in page 1 (data): another fault, another copy, into frame 12. 2 pages copied out of 10.' },
      { predict: { q: 'In another program the child only reads a big global array, then prints the sum into a local variable. How many pages are copied?', options: ['None: nothing in the array is written', '1: the stack page where the child writes its local', 'Every page of the array'], answer: 1, explain: 'Reading never copies. But the local s is written on the child\'s stack, and the stack page is shared: that one write costs one copy.' } },
      { topic: 'p02-cow', input: { prog: 'reads' }, frame: 2, caption: 'One copy only: the child writes its local s to page 10, its stack. The array\'s pages are read and stay shared.' },
      { topic: 'p02-cow', input: { prog: 'array' }, frame: 5, caption: 'Writes 1100 ints apart land on three different pages: each is copied, 3 data pages plus the parent\'s stack page, 4 in all.' },
      { topic: 'p02-cow', input: { prog: 'exec' }, frame: 3, caption: 'A child that execs at once: the only copy is the parent\'s stack page. The child writes nothing before exec, which replaces its pages and gives the shared frames back.' },
      { h: 'Recap' },
      { list: ['fork shares pages read-only; nothing is copied yet.', 'The first write to a shared page copies that page, for the writer only.', 'fork then exec is cheap: almost nothing is ever copied.'] },
      X('proc-x-cow-count'), X('proc-x-cow-why'),
    ],
  });

  C.lesson({
    id: 'proc-stdio', chapter: 'proc-after', title: 'Why a printf can print twice', minutes: 7,
    summary: 'printf writes into a buffer in the process\'s own memory. To a terminal the buffer is sent at each newline; to a pipe or a file only when it fills, on fflush, or at exit. fork copies the buffer with the rest of memory, so text still in it comes out once per process. _exit and exec throw an unflushed buffer away.',
    blocks: [
      'A program prints `start` and then forks. On the terminal, `start` appears once. Run the same program as `./a.out | cat` and `start` appears twice. The program did not change. What did?',
      { topic: 'p02-stdio', input: { prog: 'twice', out: 'tty' }, frame: 1, caption: 'printf("hello ") with no newline: the text waits in process 100\'s stdout buffer. Nothing has reached the terminal.' },
      { topic: 'p02-stdio', input: { prog: 'twice', out: 'tty' }, frame: 2, caption: 'fork copies the whole process, and the buffer with it: now both processes hold "hello ".' },
      { topic: 'p02-stdio', input: { prog: 'twice', out: 'tty' }, frame: 11, caption: 'Each copy flushes its buffer at its next newline: hello from the child, then hello from the parent. "hello" appears twice.' },
      { topic: 'p02-stdio', input: { prog: 'line', out: 'tty' }, frame: 11, caption: 'With a whole line, "start\\n", on a terminal the newline sends it at once, before fork: it appears once.' },
      { predict: { q: 'The same program, with stdout a pipe (fully buffered). How many times does "start" appear?', options: ['Once', 'Not at all', 'Twice'], answer: 2, explain: 'Into a pipe a newline does not flush. "start\\n" is still in the buffer at fork, so both processes write it when they exit.' } },
      { topic: 'p02-stdio', input: { prog: 'line', out: 'pipe' }, frame: 13, caption: 'Into a pipe: start, child, start, parent. Each process flushed its own copy of "start\\n" at exit.' },
      { topic: 'p02-stdio', input: { prog: 'flush', out: 'pipe' }, frame: 14, caption: 'The fix: fflush(stdout) before fork. The buffer is empty when it is copied, and "ready" appears once.' },
      { topic: 'p02-stdio', input: { prog: 'quick', out: 'pipe' }, frame: 4, caption: '_exit skips the C library: into a pipe, the child\'s "child says hi\\n" is still in its buffer and is thrown away.' },
      lab('Terminal or pipe, in the lab', 'Switch "stdout is a terminal" off to make stdout a pipe, and watch start come out twice.', START, { show: 'buffers', tty: false }),
      { table: [['stdout is', 'Buffer sent', 'Before fork, a line ends up'], ['a terminal', 'at each newline', 'printed once'], ['a pipe or a file', 'when full, on fflush, at exit', 'in both buffers: printed twice'], ['stderr', 'at once (unbuffered)', 'printed once']], caption: 'Buffering rules, and what fork makes of them.' },
      { h: 'Recap' },
      { list: ['printf fills a buffer in the process\'s memory; the write comes later.', 'fork copies an unflushed buffer: its text comes out once per process.', 'Call fflush(stdout) before fork; know that _exit and exec drop the buffer.'] },
      X('proc-x-pipe-twice'), X('proc-x-xs'), X('proc-x-code-flush'),
    ],
  });

  C.lesson({
    id: 'proc-orders', chapter: 'proc-after', title: 'Every order a program can print in', minutes: 6,
    summary: 'After fork the scheduler may switch between the processes at any point, so lines from different processes can interleave in many orders. With a lines in one and b in the other and no waiting, there are (a + b)! / (a! b!) orders. wait cuts them down: what the child prints comes before what the parent prints after the wait.',
    blocks: [
      'You run a program ten times and it prints the same thing every time. Is that the only thing it can print? With processes, ten runs prove little: a different machine, or a busier one, may choose another order.',
      { topic: 'p02-orders', input: { prog: 'nowait' }, frame: 0, caption: 'Child and parent print two lines each, with no wait before printing. The kernel explored 81 states, every way to schedule the two, and found 6 different outputs.' },
      { predict: { q: 'Each process prints 2 lines and the order within each process is fixed. Why 6 outputs?', options: ['Choose which 2 of the 4 positions are the child\'s: 4! / (2! 2!) = 6', '2 × 2 = 4 plus 2 more', '4! = 24, but some are invalid'], answer: 0, explain: 'An output is fixed once you know which positions hold the child\'s lines: 4 choose 2, which is 6.' } },
      { topic: 'p02-orders', input: { prog: 'nowait' }, frame: 3, caption: 'One of the 6: child 1, parent 1, parent 2, child 2. All are correct runs; none is a fault of the machine.' },
      { topic: 'p02-orders', input: { prog: 'mixed' }, frame: 0, caption: 'The child prints a and b; the parent prints c, then waits, then prints d. Only 3 outputs: d must come after both of the child\'s lines.' },
      { topic: 'p02-orders', input: { prog: 'waits' }, frame: 2, caption: 'If the parent waits before it prints anything, only one output is possible: the program forces its order.' },
      lab('Every output, in the lab', 'Open the Every output tab: the lab lists all 6 outputs of this program, with a schedule behind each one that you can replay.', FREE, { policy: 'hand' }),
      { tip: 'If an order matters, enforce it: wait for the child, or use a pipe or a signal (part 3). Never count on the scheduler. A sleep only makes an order likely: it orders processes by the clock, and two sleepers due at the same moment can still go either way.' },
      { h: 'Recap' },
      { list: ['Lines from different processes can interleave in any order the scheduler allows.', 'a lines and b lines with no waiting: (a + b)! / (a! b!) orders.', 'wait removes the orders in which the parent\'s later lines come first.'] },
      X('proc-x-ord-three'), X('proc-x-ord-wait'), X('proc-x-sleep-race'), X('proc-x-sleep-tie'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
