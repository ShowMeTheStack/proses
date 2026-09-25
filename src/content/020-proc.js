// Part 2, processes: the chapters, and the lessons of the first chapter (a program, running: its address space, its
// control block, its states and the context switch). The lessons of the other chapters are in 020-proc2.js and
// 020-proc3.js; the exercises in 021-proc-ex.js and 021-proc-ex2.js; the challenge, the tour, the course and the
// pages the diagram checker looks at in 022-proc-ch.js. Every value quoted here was worked out by the engines (S.Kern
// running the topics' C programs, and S.Os.contextSwitch) on the topics' own inputs.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'proc-image')) return;

  C.chapter({ id: 'proc-image', part: 'processes', n: 1, title: 'A program, running', blurb: 'What a process is: an address space that grows as the program runs, a control block the kernel keeps, a state that changes, and a switch that passes the CPU from one process to the next.' });
  C.chapter({ id: 'proc-api', part: 'processes', n: 2, title: 'fork, exec and wait', blurb: 'Making a process, counting the processes a program makes, giving a process a new program, and collecting its exit status.' });
  C.chapter({ id: 'proc-after', part: 'processes', n: 3, title: 'After fork, after exit', blurb: 'Zombies and orphans, copy-on-write, stdio buffers copied by fork, and every order a small program can print in.' });
  const X = (id) => ({ exercise: id });

  // =========================================================================================================
  // Chapter 1: a program, running
  // =========================================================================================================
  C.lesson({
    id: 'proc-space', chapter: 'proc-image', title: 'A program and its address space', minutes: 7,
    summary: 'A process is a program in the middle of running. Its memory is laid out in regions: the code (text), the globals (data), the heap that malloc carves blocks from, and the stack with one frame per call. The heap grows up, the stack grows down, and the gap between them is room for both.',
    blocks: [
      'A file called `grow.c` sits on the disk: a list of instructions, doing nothing. Type its name at a shell and something starts that has a number, memory of its own, open files, and a place in the queue for the CPU. What is that thing, and where in its memory does each of the program\'s variables live?',
      { def: 'process', text: 'a program in execution: the program\'s code plus everything that describes this one run of it: its memory (the address space), the registers and program counter, the open files, and the kernel\'s record of it.' },
      { topic: 'p02-layout', input: { prog: 'both' }, frame: 0, caption: 'main starts at line 13. Its frame is the only one on the stack, at 0x19fb0, near the top of the address space; the heap is still empty.' },
      { topic: 'p02-layout', input: { prog: 'both' }, frame: 2, caption: 'Two calls to malloc carve a 32-byte block at 0x2010 and a 48-byte block at 0x2030 out of the heap: 16 and 32 bytes asked, the rest is each block\'s header and rounding. The heap grows up, towards the stack.' },
      { predict: { q: 'main now calls sum(3), which calls itself until n is 0. main\'s frame is at 0x19fb0. Where does the first frame for sum go?', options: ['Above main\'s, at a higher address', 'Below main\'s, at a lower address: the stack grows down', 'In the heap, next to the blocks malloc gave'], answer: 1, explain: 'Each call pushes a frame below its caller\'s. sum(3)\'s frame is at 0x19f90, 0x20 bytes below main\'s, and each deeper call goes another 0x20 lower.' } },
      { topic: 'p02-layout', input: { prog: 'both' }, frame: 6, caption: 'Four frames for sum, at 0x19f90, 0x19f70, 0x19f50 and 0x19f30, with n = 3, 2, 1 and 0: each call has its own n, in its own frame.' },
      { topic: 'p02-layout', input: { prog: 'both' }, frame: 7, caption: 'The calls return and their 4 frames are popped. The global total became 6: it lives in the data segment, which neither grows nor shrinks.' },
      { topic: 'p02-layout', input: { prog: 'heap' }, frame: 11, caption: 'Another program frees the 64-byte block at 0x2040, then asks for 16 bytes: malloc hands back the hole at 0x2040. A freed block stays in the heap, ready to be reused.' },
      { table: [['Region', 'Holds', 'Size'], ['text', 'the code, read-only', 'fixed when the program is loaded'], ['data', 'globals and static variables', 'fixed'], ['heap', 'blocks from malloc, until free', 'grows up as blocks are asked for'], ['stack', 'a frame per call: locals, arguments, the return address', 'grows down with each call, shrinks at each return']], caption: 'The address space, bottom to top.' },
      { tip: 'Page 0 is left unmapped, so a read or write through a null pointer faults at once instead of quietly using memory.' },
      { h: 'Recap' },
      { list: ['A process is a program running: an address space, registers, open files and the kernel\'s record of them.', 'Globals live in data, malloc\'s blocks in the heap, locals in a frame on the stack.', 'The heap grows up and the stack grows down, into the gap between them.'] },
      X('proc-x-where'), X('proc-x-frames'),
    ],
  });

  C.lesson({
    id: 'proc-pcb', chapter: 'proc-image', title: 'What the kernel keeps: the PCB', minutes: 7,
    summary: 'For every process the kernel keeps a process control block: its pid and its parent, its state, the saved registers and program counter, its page table, its descriptor table, its signal handlers and pending signals, and, after it exits, its exit status. The entry lives until the parent collects that status.',
    blocks: [
      'A process is not always running: most of the time it waits in a queue, or for a disk, or for a child. When it next gets the CPU, it must carry on exactly where it stopped, with the same files open. What must the kernel remember about it, and where does it keep that?',
      { def: 'process control block (PCB)', text: 'the kernel\'s record of one process: who it is, what state it is in, where it was, what memory it owns, which files it has open, how it handles signals, and how it ended. The process table is the set of all of them.' },
      { topic: 'p02-pcb', input: { who: 'child' }, frame: 3, caption: 'Process 100 has opened notes.txt as descriptor 3 and set a handler for SIGUSR1. Now it forks: the kernel makes a PCB for process 101, filled in from its parent\'s.' },
      { topic: 'p02-pcb', input: { who: 'child' }, frame: 9, caption: 'Field by field. The child\'s parent is 100, its state is ready, it will resume at line 13, and its descriptor table is a copy of its parent\'s: 0, 1 and 2 to the terminal, 3 to notes.txt.' },
      { predict: { q: 'The parent sends SIGUSR1 to the child, which is not running at that moment. Where does the signal go?', options: ['Nowhere: a process that is not running cannot receive a signal', 'Into the parent\'s PCB', 'Into the child\'s PCB, as pending, until the child runs'], answer: 2, explain: 'The kernel marks it pending in the child\'s PCB. When the child next runs, the kernel sees the pending bit and starts its handler on_usr.' } },
      { topic: 'p02-pcb', input: { who: 'child' }, frame: 14, caption: 'Pending → SIGUSR1, in 101\'s PCB. Two steps later the child runs its handler, and the pending field is clear again.' },
      { topic: 'p02-pcb', input: { who: 'child' }, frame: 21, caption: 'The child returns 3 from main. Its memory is freed and its files closed, but the PCB stays, with state zombie and exit status 3, until its parent\'s waitpid collects it.' },
      { table: [['Group', 'Fields'], ['identity', 'pid, parent pid'], ['scheduling', 'state, saved registers and program counter'], ['memory', 'the page table'], ['files', 'the descriptor table'], ['signals', 'handlers, pending signals, the mask'], ['the end', 'the exit status, kept until reaped']], caption: 'What a PCB holds, grouped.' },
      { h: 'Recap' },
      { list: ['The kernel keeps a PCB for every process; together they are the process table.', 'fork makes the child\'s PCB from the parent\'s: a copy of its descriptors and its handlers, with a new pid.', 'After exit only the PCB is left, holding the exit status for the parent.'] },
      X('proc-x-pcb-fields'),
    ],
  });

  C.lesson({
    id: 'proc-states', chapter: 'proc-image', title: 'Ready, running, blocked', minutes: 8,
    summary: 'A process moves between a few states. New when made, ready while it waits for a CPU, running while it has one, blocked while it waits for something else (a timer, a child, input), a zombie after it exits, and reaped when its parent collects it. The scheduler moves ready to running; a used-up time slice moves running back to ready.',
    blocks: [
      'On a machine with one CPU, ten processes may be alive, but only one can run at a time. What are the other nine doing? Some could run if they were given the CPU; others could not use it if they had it. The kernel has to tell those apart.',
      { def: 'process states', text: 'new (being made), ready (could run, waiting for a CPU), running (on a CPU now), blocked (waiting for an event: a timer, a child\'s exit, data), zombie (exited, status not yet collected), reaped (gone).' },
      { topic: 'p02-states', input: { prog: 'sleepy', pol: 'fifo', q: 2 }, frame: 2, caption: 'Process 100 forks 101. The child is created and joins the ready queue: it could run, but 100 has the CPU, and with this scheduler a process keeps it until it blocks or ends.' },
      { topic: 'p02-states', input: { prog: 'sleepy', pol: 'fifo', q: 2 }, frame: 3, caption: 'Step 20: process 100 reaches waitpid. Its child has not ended, so it blocks: running → blocked. The CPU is free for 101.' },
      { predict: { q: 'Process 101 now calls sleep(1). Which arrow does it take?', options: ['running → blocked', 'running → ready', 'running → zombie'], answer: 0, explain: 'It cannot use the CPU until the clock has moved on: it is blocked, not ready. Being ready means being able to run at once.' } },
      { topic: 'p02-states', input: { prog: 'sleepy', pol: 'fifo', q: 2 }, frame: 8, caption: 'Step 37: 101 returns from main, running → zombie, and its exit is what 100 was waiting for, so 100 goes blocked → ready. A blocked process never goes straight to running: it is made ready, then dispatched.' },
      { topic: 'p02-states', input: { prog: 'sleepy', pol: 'fifo', q: 2 }, frame: 11, caption: 'Step 43: 100 has exited too, and the shell reaps it: zombie → reaped.' },
      'With a time slice, the scheduler also takes the CPU away from a process that could go on running. The same program under round robin with a slice of 2 steps:',
      { topic: 'p02-states', input: { prog: 'sleepy', pol: 'rr', q: 2 }, frame: 3, caption: 'Step 3: 100 is preempted, its time slice used up (running → ready), and 101 is dispatched (ready → running). The two now take turns, two steps each.' },
      { table: [['Arrow', 'Caused by'], ['new → ready', 'fork has made the process'], ['ready → running', 'the scheduler dispatches it'], ['running → ready', 'its time slice is used up (preempted)'], ['running → blocked', 'sleep, wait, a read with nothing to read'], ['blocked → ready', 'the event it waited for happened'], ['running → zombie', 'exit, or a return from main'], ['zombie → reaped', 'its parent\'s wait collects the status']], caption: 'Every arrow and what causes it.' },
      { h: 'Recap' },
      { list: ['Ready means able to run now; blocked means waiting for an event.', 'Only the scheduler moves a process to running, and only from ready.', 'A woken process goes back to ready, not straight to running.'] },
      X('proc-x-arrow'), X('proc-x-blocked'),
    ],
  });

  C.lesson({
    id: 'proc-switch', chapter: 'proc-image', title: 'The context switch', minutes: 7,
    summary: 'To pass the CPU from process P to process Q, the kernel saves what P needs to carry on and loads what Q saved last time. P\'s user registers are saved as a trap frame on its kernel stack when it enters the kernel; the switch routine saves P\'s kernel registers in its process entry and loads Q\'s, which moves the CPU onto Q\'s kernel stack. A new address space means a new page table, and a TLB flush unless entries are tagged.',
    blocks: [
      'The timer fires while P is in the middle of a loop, with values in its registers. Q is next. Q\'s registers must come back exactly as they were when Q last stopped, and P\'s must be kept safe until P runs again. Where do they go, and what does the swap cost?',
      { topic: 'p02-switch', input: { kind: 'procs' }, frame: 1, caption: 'The timer interrupts P at PC 0x1040. The hardware and the trap entry save its 4 user registers (pc, sp, a0, a1) as a trap frame on P\'s kernel stack.' },
      { topic: 'p02-switch', input: { kind: 'procs' }, frame: 3, caption: 'The scheduler picks Q and calls switch(P, Q). switch saves P\'s kernel context (ra, sp, s0, s1) in P\'s process entry: P is frozen in the middle of that call.' },
      { predict: { q: 'switch now loads Q\'s saved kernel registers, including its stack pointer. From which moment is the CPU running Q?', options: ['Only when Q is back in user mode', 'From the moment SP points at Q\'s kernel stack', 'When the page table changes'], answer: 1, explain: 'Once the stack pointer and return address are Q\'s, every following instruction works on Q\'s kernel stack: the CPU is running Q, still inside the kernel.' } },
      { topic: 'p02-switch', input: { kind: 'procs' }, frame: 4, caption: 'SP jumps to Q\'s kernel stack at 0x9ff0. From here on the CPU is running Q.' },
      { topic: 'p02-switch', input: { kind: 'procs' }, frame: 5, caption: 'Q is another process, so the page-table base register changes, from frame 0x30 to frame 0x58, and the TLB is flushed: its translations belonged to P.' },
      { topic: 'p02-switch', input: { kind: 'procs' }, frame: 7, caption: 'Return-from-trap pops Q\'s trap frame: user mode, PC 0x2210, a0 = 3. Q carries on as if nothing had happened.' },
      { topic: 'p02-switch', input: { kind: 'asid' }, frame: 5, caption: 'With a TLB whose entries are tagged with an address-space id, the page table still changes, but nothing is flushed: P\'s entries stay, and are still there when P comes back.' },
      { topic: 'p02-switch', input: { kind: 'threads', a0: 12, b0: 40 }, frame: 7, caption: 'Between two threads of one process the same 8 registers are saved and restored, but the page table stays, and so does everything in the TLB.' },
      { warn: 'The registers are the cheap part: 8 saved and 8 restored here. The real cost comes afterwards, when Q runs with caches and a TLB still full of P\'s data and misses again and again until they are warm.' },
      { h: 'Recap' },
      { list: ['User registers: saved by the trap, as a trap frame on the kernel stack.', 'Kernel registers: saved and loaded by switch, in each process\'s entry.', 'Another process means another page table, and a TLB flush unless entries are tagged.'] },
      X('proc-x-switch-table'), X('proc-x-switch-where'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
