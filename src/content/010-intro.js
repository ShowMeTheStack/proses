// Part 1, what an operating system does: the chapters, and the lessons of the first chapter (what the OS gives a
// program). The lessons of chapters 2 and 3 are in 010-intro2.js; the exercises in 011-intro-ex.js and
// 011-intro-ex2.js; the challenge, the guided tour, the course and the pages the diagram checker looks at in
// 012-intro-ch.js. Every value quoted here was worked out by the engines (S.Os, S.Sched, and S.Kern running the
// topics' C programs) on the topics' own inputs.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'os-what')) return;

  C.chapter({ id: 'os-what', part: 'intro', n: 1, title: 'What the OS gives a program', blurb: 'One CPU shared so that each program seems to have its own, a memory no other program can touch, files that outlast the programs that wrote them, and a referee that keeps one program\'s mistakes its own.' });
  C.chapter({ id: 'os-trap', part: 'intro', n: 2, title: 'Modes, traps and system calls', blurb: 'The mode bit and the instructions only the kernel may run, the one path every interrupt, exception and system call takes into the kernel, and which lines of a C program actually cross it.' });
  C.chapter({ id: 'os-control', part: 'intro', n: 3, title: 'Keeping control', blurb: 'Programs run straight on the CPU and the timer takes it back; how a machine gets from power-on to its first process; and the shapes a kernel can take.' });
  const X = (id) => ({ exercise: id });
  const R = (id, arrive, bursts) => ({ id, arrive, bursts, prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' });
  const plab = (title, text, src, more) => ({ lab: 'process', title, text, setup: Object.assign({ src, policy: 'random' }, more || {}) });
  const SEATS = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint seats = 40;\n\nint main(void) {\n    if (fork() == 0) {\n        seats = seats - 3;\n        printf("child sees %d\\n", seats);\n        return 0;\n    }\n    seats = seats + 5;\n    printf("parent sees %d\\n", seats);\n    wait(NULL);\n    printf("parent ends with %d\\n", seats);\n    return 0;\n}\n';
  const RACE = '#include <stdio.h>\n#include <fcntl.h>\n#include <unistd.h>\n\nint main(void) {\n    if (fork() == 0) {\n        int fd = open("note.txt", O_WRONLY | O_CREAT, 0644);\n        write(fd, "plums", 5);\n        close(fd);\n        return 0;\n    }\n    char buf[16];\n    int n = -1;\n    int fd = open("note.txt", O_RDONLY);\n    if (fd >= 0)\n        n = read(fd, buf, 15);\n    printf("read %d\\n", n);\n    return 0;\n}\n';
  const TWO = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        int *p = NULL;\n        *p = 1;\n        printf("A: done\\n");\n        return 0;\n    }\n    pid_t b = fork();\n    if (b == 0) {\n        printf("B: fine\\n");\n        return 3;\n    }\n    int st;\n    waitpid(a, &st, 0);\n    printf("A: %s\\n", WIFSIGNALED(st) ? "killed" : "exited");\n    waitpid(b, &st, 0);\n    printf("B: %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n';

  // =========================================================================================================
  // Chapter 1: what the OS gives a program
  // =========================================================================================================
  C.lesson({
    id: 'os-share', chapter: 'os-what', title: 'One CPU, and every program thinks it has its own', minutes: 7,
    summary: 'A machine with one CPU can still run a music player, a compiler and a browser at once. The kernel gives each a short slice of the CPU in turn, and the timer takes the CPU back at the end of each slice. Each program sees its own work run without a gap; only the wall clock shows the time it spent waiting.',
    blocks: [
      'Your laptop has a handful of cores and, at any moment, a few hundred programs that would like to run. None of them was written to share: each one is a loop of instructions that assumes the processor is its own. How can they all make progress, and why does none of them notice the others?',
      { def: 'virtualisation', text: 'turning one physical thing (a CPU, a memory, a disk) into many private-looking ones. The operating system shares the real thing out and keeps up the illusion that every program has its own.' },
      { topic: 'p01-cpu-share', input: { procs: 'A 4, B 3, C 5', quantum: 2 }, frame: 0, caption: 'Three programs need 4, 3 and 5 ticks of CPU. The kernel hands out slices of 2 ticks, and the timer takes the CPU back at the end of each slice.' },
      { topic: 'p01-cpu-share', input: { procs: 'A 4, B 3, C 5', quantum: 2 }, frame: 3, caption: 'By t = 6 each program has had one slice. In the lower rows, each program\'s own view: 2 ticks of its work, with no gap, though A has been waiting since t = 2.' },
      { predict: { q: 'The slices go on in turn: A, B, C, A, B, C... B needs 3 ticks in all. At what time on the wall clock does B finish?', options: ['t = 3: its 3 ticks of work', 't = 9', 't = 12, with the last program'], answer: 1, explain: 'B runs from 2 to 4, waits while C and A have their slices, and runs its last tick from 8 to 9. Its work took 3 ticks; the wall clock says 9.' } },
      { topic: 'p01-cpu-share', input: { procs: 'A 4, B 3, C 5', quantum: 2 }, frame: 8, caption: 'Everything is done by t = 12. Each program did exactly its own work (A 4, B 3, C 5 ticks), but on the wall clock A took 8, B 9 and C 12: the cost of sharing, invisible from inside.' },
      { topic: 'p01-cpu-share', input: { procs: 'A 4, B 3, C 5', quantum: 1 }, frame: 13, caption: 'Slices of 1 tick: the last program still ends at t = 12, but now A takes 10 and B only 8. Shorter slices make every program start sooner; with free switches, the total stays the same.' },
      'Switches are not really free: each one runs kernel code that saves one program\'s registers and loads another\'s. Chapter 3 puts a price on that. For now the point is the illusion: every program behaves as if it ran alone on a slower CPU.',
      { lab: 'scheduler', title: 'Three slice lengths side by side', text: 'The same three programs with slices of 1, 2 and 4 ticks: compare when each one first runs and when each finishes.', setup: { mode: 'compare', pol1: 'rr', q1: 1, pol2: 'rr', q2: 2, pol3: 'rr', q3: 4, pol4: 'none', work: [R('A', 0, [4]), R('B', 0, [3]), R('C', 0, [5])] } },
      { h: 'Recap' },
      { list: ['The kernel shares one CPU by giving each program a slice in turn.', 'The timer takes the CPU back at the end of each slice; no program has to give it up willingly.', 'A program sees only its own ticks, one after another; the wall clock shows how long it waited.'] },
      X('os-x-wall-clock'), X('os-x-share-chart'), X('os-x-slices'),
    ],
  });

  C.lesson({
    id: 'os-memory', chapter: 'os-what', title: 'A memory of one\'s own', minutes: 7,
    summary: 'After fork, parent and child run the same code with the same addresses, yet a write by one is never seen by the other. An address in a program names a place in that process\'s own address space; the kernel and the hardware map it to a frame of physical memory, a different frame for each process once either writes.',
    blocks: [
      'Two processes print the address of the same global variable and get the same number, 0x1000. Then one of them changes the variable. Does the other see the change? If not, what does "the same address" mean?',
      { def: 'address space', text: 'the range of addresses a process can use, laid out as if it had the whole memory to itself. The kernel maps each page of it to a frame of physical memory; two processes can use the same address for different frames.' },
      { topic: 'p01-memory-private', input: { prog: '0' }, frame: 2, caption: 'Process 100 forks process 101. fork returns 101 to the parent and 0 to the child; both go on from the same line, with the same variable balance, holding 100.' },
      { topic: 'p01-memory-private', input: { prog: '0' }, frame: 3, caption: 'The first write to a shared page makes the kernel copy that page into a new frame (copy-on-write): page 9 gets frame 11 for one process, and frame 10 stays with the other.' },
      { topic: 'p01-memory-private', input: { prog: '0' }, frame: 6, caption: 'The child sets balance to 250 and prints C: 0x1000 250.' },
      { predict: { q: 'The parent waits for the child, then prints the address and the value of its balance. What does it print?', options: ['P: 0x1000 250: same address, same variable', 'P: 0x1000 100', 'P: and a different address, with 100'], answer: 1, explain: 'The address is the same, 0x1000, because both processes run the same program. But the child wrote to its own copy of the page; the parent\'s frame still holds 100.' } },
      { topic: 'p01-memory-private', input: { prog: '0' }, frame: 9, caption: 'P: 0x1000 100. One address, two values: each process\'s page table sends 0x1000 to a different frame.' },
      { tip: 'Copy-on-write is why fork is cheap: right after the fork the child shares all of its parent\'s pages, read-only, and a page is copied only when one of them writes to it. Part 2 looks at it closely.' },
      plab('Two processes, one variable', 'The seats program: the child takes 3 seats, the parent adds 5. List every output and check that neither ever sees the other\'s change.', SEATS),
      { h: 'Recap' },
      { list: ['Every process has its own address space; an address means something only inside one process.', 'The kernel maps pages to frames, so the same address in two processes can be two different places.', 'After fork, a write by either process lands in its own copy.'] },
      X('os-x-seats'), X('os-x-same-address'),
    ],
  });

  C.lesson({
    id: 'os-persist', chapter: 'os-what', title: 'What outlives a process', minutes: 6,
    summary: 'When a process exits, its memory goes: variables, heap and stack. What it wrote to a file stays, because the file belongs to the file system, not to the process. Persistence is the third thing the OS provides, beside a CPU and a memory of one\'s own; and the kernel also decides who sees a file\'s data, and when.',
    blocks: [
      'A program builds a shopping list in an array, then exits. The list is gone. Another program writes the same list to a file, then exits, and next morning the list is still there. What does the operating system do differently with the two?',
      { def: 'persistence', text: 'keeping data after the process that made it has ended, and after the power goes off. The file system, part of the operating system, stores files on a device and gives every process the same view of them by name.' },
      { topic: 'p01-persist', input: { prog: '0' }, frame: 4, caption: 'The child W writes "milk, eggs\\n" to f.txt: 11 bytes, which go into the file store, not into W\'s memory.' },
      { topic: 'p01-persist', input: { prog: '0' }, frame: 7, caption: 'W has exited and its parent has reaped it: its memory and its process-table entry are gone. The file is still on the disk.' },
      { topic: 'p01-persist', input: { prog: '0' }, frame: 9, caption: 'The parent opens the same name and reads the 11 bytes back. Two processes that never shared memory have passed data through a file.' },
      { predict: { q: 'Suppose the parent did not wait, and opened note.txt as soon as fork returned. The child creates note.txt and writes 5 bytes into it. What can the parent\'s read return?', options: ['Always 5', 'Always nothing: the file is not there yet', 'Any of three things: no file yet, an empty file, or all 5 bytes'], answer: 2, explain: 'Without the wait, the parent may open before the child creates the file (open fails), between the create and the write (0 bytes), or after the write (5 bytes). The kernel promises what a file holds, not who gets there first.' } },
      plab('No wait: who gets there first?', 'The parent reads note.txt without waiting for the child. Choose "Every output" to see all three outcomes, with the schedule behind each.', RACE),
      { h: 'Recap' },
      { list: ['A process\'s memory ends with the process; a file does not.', 'Files are named in one file system that every process sees.', 'Sharing data through a file still needs an order: here, the wait.'] },
      X('os-x-persist-why'), X('os-x-no-wait'),
    ],
  });

  C.lesson({
    id: 'os-referee', chapter: 'os-what', title: 'The referee: one program\'s fault stays its own', minutes: 7,
    summary: 'Programs make mistakes. A write through a NULL pointer traps to the kernel, which ends the process that made it with a signal, frees what it held and tells its parent; every other process carries on. A program that loops for ever commits no fault at all, but the timer still takes the CPU back, so the others keep their turns and one of them can end it.',
    blocks: [
      'A program you depend on, the shell, starts a program you wrote, and your program dereferences a NULL pointer. Your program dies. Why does the shell not die with it, and how does the shell find out what happened?',
      { def: 'referee', text: 'the operating system\'s role of enforcing the rules: each process may touch only its own memory, may not take over the machine, and gets its share of the CPU. A process that breaks a rule is stopped; the others are not touched.' },
      { topic: 'p01-referee', input: { prog: '0' }, frame: 3, caption: 'The child C writes 4 bytes at address 0x0. No page is mapped there, so the CPU traps to the kernel in the middle of the instruction.' },
      { topic: 'p01-referee', input: { prog: '0' }, frame: 5, caption: 'The kernel ends C with SIGSEGV. Its parent, waiting already, gets the status: killed by signal 11.' },
      { topic: 'p01-referee', input: { prog: '0' }, frame: 7, caption: 'The parent prints "C died of 11", then "P carries on". One process\'s fault cost no one else anything.' },
      { predict: { q: 'Now the child does no wrong at all: it loops for ever with no system call. The parent sleeps for 1 second and then sends it SIGKILL. Does the parent ever get to send it?', options: ['No: the child never gives the CPU back', 'Yes: the timer interrupt takes the CPU back from the child', 'Only on a machine with two cores'], answer: 1, explain: 'The child never traps on purpose, but the timer interrupt fires anyway. When the parent\'s sleep is over the kernel runs it, and its kill ends the child: status 9, SIGKILL.' } },
      { topic: 'p01-referee', input: { prog: '2' }, frame: 6, caption: 'The parent prints "G died of 9". A loop is not a fault, so no trap ends it; the timer kept the CPU shared until the parent could.' },
      plab('Two children, two endings', 'One child writes through NULL and is killed; its sister exits with 3. The parent asks how each one ended, with WIFSIGNALED and WEXITSTATUS.', TWO),
      { h: 'Recap' },
      { list: ['A fault traps to the kernel, which ends only the process that made it.', 'The parent learns how a child ended through wait: an exit code, or the signal that killed it.', 'The timer makes even a loop share the CPU, so a runaway program can always be stopped.'] },
      X('os-x-who-dies'), X('os-x-two-endings'), X('os-x-code-report'), X('os-x-roles'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
