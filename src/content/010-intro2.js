// Part 1, what an operating system does: the lessons of chapters 2 (modes, traps and system calls) and 3 (keeping
// control). Every value quoted here comes from the engines (S.Os for the toy CPU, the trap path, the system-call
// path, limited direct execution, booting and the kernel designs; S.Kern for the C programs) on the topics' inputs.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('os-modes')) return;
  const X = (id) => ({ exercise: id });
  // the last frame of a p01-lde input, and the engine's counts for the same run
  const ldeLast = (input, fallback) => { const t = S.byId && S.byId('p01-lde'); if (!t) return fallback; const r = t.run(S.inputOf(t, input)); return (Array.isArray(r) ? r : r.frames).length - 1; };
  const LDE1 = S.Os ? S.Os.lde({ procs: [{ name: 'A', work: 5 }, { name: 'B', work: 4, syscalls: [2] }, { name: 'C', work: 3 }], quantum: 3, timer: true, switchCost: 0 }) : { end: 12, switches: 4, timerInterrupts: 2 };
  const ABC = '#include <stdio.h>\n\nint main(void) {\n    printf("a");\n    printf("b\\n");\n    printf("c\\nd");\n    printf("e\\n");\n    printf("bye");\n    return 0;\n}\n';

  // =========================================================================================================
  // Chapter 2: modes, traps and system calls
  // =========================================================================================================
  C.lesson({
    id: 'os-modes', chapter: 'os-trap', title: 'User mode, kernel mode', minutes: 7,
    summary: 'The CPU carries a mode bit. In kernel mode every instruction is allowed; in user mode a few are refused: turning interrupts off, halting, talking to a device, loading the page-table base or the timer. A program that tries one traps to the kernel, which ends it. That one bit is what lets the kernel stay in charge of a machine it shares with programs it does not trust.',
    blocks: [
      'If every program could switch interrupts off, a single program could keep the CPU for ever: the timer would never take it back. If every program could load a new page table, it could map any other program\'s memory. Yet the kernel itself needs exactly these instructions. How can the same CPU allow them to one piece of code and refuse them to another?',
      { def: 'mode bit, privileged instruction', text: 'the mode bit records whether the CPU is running the kernel (kernel mode) or a program (user mode). A privileged instruction is one the CPU runs only in kernel mode; in user mode it raises an exception instead.' },
      { topic: 'p01-modes', input: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'user', irq: 0 }, frame: 2, caption: 'A program in user mode: two loads and an add, all ordinary instructions, run straight on the CPU.' },
      { predict: { q: 'The next instruction is cli, which turns interrupts off. The mode bit says user. What happens?', options: ['Interrupts go off, as asked', 'The CPU ignores it and moves on', 'The CPU refuses it and traps to the kernel'], answer: 2, explain: 'cli is privileged. In user mode the CPU does not run it: it raises a general-protection exception, and the kernel decides what to do with the program.' } },
      { topic: 'p01-modes', input: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'user', irq: 0 }, frame: 3, caption: 'PC 0x0003: cli in user mode. The CPU raises a general-protection exception instead of running it.' },
      { topic: 'p01-modes', input: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'user', irq: 0 }, frame: 11, caption: 'The handler sends SIGSEGV and the process ends at PC 0x0003, after 4 instructions were started. The store at 0x0004 never runs.' },
      { topic: 'p01-modes', input: { prog: 'load r0 7; load r1 5; add r0 r1; cli; store r0', mode: 'kernel', irq: 0 }, frame: 4, caption: 'The same five instructions in kernel mode run to the end: 5 instructions, 0 traps. The instruction is not wrong; the mode is.' },
      { table: [['Instruction', 'What it does', 'User mode'], ['load, store, add, div', 'compute on registers and memory', 'allowed'], ['syscall', 'asks the kernel for a service', 'allowed: it is the way in'], ['cli, sti', 'turn interrupts off, on', 'refused'], ['hlt', 'stops the CPU until an interrupt', 'refused'], ['in, out', 'read or write a device register', 'refused'], ['lcr3, lidt, settimer', 'load the page table, the trap table, program the timer', 'refused']], caption: 'The toy CPU\'s instructions and the mode each needs.' },
      { warn: 'The mode bit cannot be set from user mode either: the only way into kernel mode is a trap, which jumps to code the kernel chose at boot. A program can ask for kernel work, but cannot choose which kernel code runs.' },
      { h: 'Recap' },
      { list: ['The mode bit says kernel or user; the hardware checks it on every privileged instruction.', 'In user mode a privileged instruction traps; the kernel usually ends the program.', 'syscall is not privileged: it is how a program asks, by trapping on purpose.'] },
      X('os-x-privileged'), X('os-x-started'), X('os-x-kernel-mode'),
    ],
  });

  C.lesson({
    id: 'os-trap-path', chapter: 'os-trap', title: 'One path into the kernel and back', minutes: 8,
    summary: 'Whatever the cause, the CPU enters the kernel the same way: it sets the mode bit to kernel, switches to the process\'s kernel stack, pushes the user stack pointer, the flags and a program counter, and jumps through the trap table to the handler for that vector. Return-from-trap pops them again. Which PC was saved decides where the program resumes: the next instruction after a system call, the same one after a page fault.',
    blocks: [
      'A program runs `syscall`. A microsecond later it is running again, one instruction further on, with an answer in r0. In between, kernel code ran on the same CPU with the same registers. How did the CPU know where to go, and how did it find its way back?',
      { def: 'trap table', text: 'a table, filled in by the kernel at boot, with the address of a handler for each vector: one per exception, one per device interrupt, one for system calls. The hardware jumps only to addresses in it.' },
      { topic: 'p01-trap', input: { cause: 'syscall', vector: '128', pc: 4100, r0: 39, result: 100, mode: 'user' }, frame: 2, caption: 'A system call at PC 0x1004. The mode bit is now kernel, and the stack pointer jumps from the user stack at 0x7ff0 to the process\'s kernel stack at 0x9000.' },
      { topic: 'p01-trap', input: { cause: 'syscall', vector: '128', pc: 4100, r0: 39, result: 100, mode: 'user' }, frame: 4, caption: 'The trap frame: the hardware pushed the user SP, the flags and the PC 0x1005 (SP 0x8ff4), and the entry code pushed r0 to r3 (SP 0x8fe4).' },
      { topic: 'p01-trap', input: { cause: 'syscall', vector: '128', pc: 4100, r0: 39, result: 100, mode: 'user' }, frame: 5, caption: 'Entry 128 of the trap table: the hardware jumps to syscall_entry at 0xc800. The program could trigger the trap, but not choose this address.' },
      { topic: 'p01-trap', input: { cause: 'syscall', vector: '128', pc: 4100, r0: 39, result: 100, mode: 'user' }, frame: 8, caption: 'The handler wrote 100 into the saved r0; return-from-trap pops the frame and the CPU is back in user mode at 0x1005, the instruction after the syscall.' },
      { predict: { q: 'Now a page fault: an instruction at PC 0x1134 touched a page that is on disk. The handler brings the page in. Where does the program resume?', options: ['At 0x1135, the next instruction, like a system call', 'At 0x1134: the same instruction runs again', 'Nowhere: a fault ends the program'], answer: 1, explain: 'The faulting instruction never completed, so the CPU saved its own PC, 0x1134. Once the page is there, return-from-trap runs it again, and this time it succeeds.' } },
      { topic: 'p01-trap', input: { cause: 'exception', vector: '14', pc: 4404, r0: 12, result: 0, mode: 'user' }, frame: 8, caption: 'Back in user mode at PC 0x1134, the same instruction, which now runs again. The program never learns that a page fault happened.' },
      { table: [['Cause', 'Example', 'PC saved', 'After the handler'], ['system call', 'syscall', 'the next instruction', 'resume, with the result in r0'], ['interrupt', 'timer, keyboard, disk', 'the next instruction not yet run', 'resume (perhaps after another process has run)'], ['fault, fixable', 'page fault', 'the faulting instruction', 'run it again'], ['fault, fatal', 'divide error, forbidden instruction', 'the faulting instruction', 'the process is ended by a signal']], caption: 'One path in, three ways out.' },
      { h: 'Recap' },
      { list: ['Every trap: mode bit to kernel, switch to the kernel stack, save SP, flags and PC, jump through the trap table.', 'The kernel saves the general registers too, making a trap frame; return-from-trap undoes it all.', 'The saved PC decides where the program resumes.'] },
      X('os-x-trap-frame'), X('os-x-resume'),
    ],
  });

  C.lesson({
    id: 'os-trapkinds', chapter: 'os-trap', title: 'Interrupts, exceptions and system calls', minutes: 6,
    summary: 'Three things send the CPU into the kernel. An interrupt comes from a device, at any moment, for reasons unrelated to the instruction running: it is asynchronous. An exception is the instruction itself failing. A system call is the program asking on purpose. Exceptions and system calls are synchronous: run the program again and they happen at the same instruction.',
    blocks: [
      'You run the same program twice with the same input. The first time, the timer interrupts it after its second instruction; the second time, after its fifth. But its division by zero happens at the same instruction both times. Why can the one move and the other not?',
      { def: 'asynchronous, synchronous', text: 'an asynchronous event is unrelated to the instruction running, so its moment changes from run to run (a device\'s interrupt). A synchronous one is caused by the instruction itself, so it happens at the same place every run (a fault, a system call).' },
      { topic: 'p01-trapkinds', input: { prog: 'load r0 7; load r1 2; syscall; add r0 r1; load r1 0; div r0 r1; store r0', irqs: '1, 4', dev: '32' }, frame: 1, caption: 'A timer interrupt after the first instruction: the device raised its line, unrelated to what the program was doing.' },
      { topic: 'p01-trapkinds', input: { prog: 'load r0 7; load r1 2; syscall; add r0 r1; load r1 0; div r0 r1; store r0', irqs: '1, 4', dev: '32' }, frame: 5, caption: 'At PC 0x0002 the program runs syscall: a trap it asked for, at a place fixed by its own code.' },
      { predict: { q: 'At PC 0x0005 the program divides r0 by r1, which holds 0. Which kind of trap is that, and what happens next?', options: ['An interrupt: the program carries on', 'An exception: the program is ended with SIGFPE', 'A system call: the kernel returns an error code'], answer: 1, explain: 'The instruction itself cannot complete, so it is an exception, synchronous but not on purpose. The divide-error handler sends SIGFPE, which by default ends the process.' } },
      { topic: 'p01-trapkinds', input: { prog: 'load r0 7; load r1 2; syscall; add r0 r1; load r1 0; div r0 r1; store r0', irqs: '1, 4', dev: '32' }, frame: 15, caption: 'The divide error at PC 0x0005 ends the process with SIGFPE. In this run the kernel was entered 4 times: 2 interrupts, 1 system call, 1 exception.' },
      { topic: 'p01-trapkinds', input: { prog: 'load r0 1; load r1 2; add r0 r1; add r0 r1; store r0', irqs: '1, 2, 4', dev: '33' }, frame: 0, inputs: true, caption: 'Three keyboard interrupts and no fault: step through and watch the program carry on as if nothing happened. Change the interrupt list: the program\'s result never changes.' },
      { h: 'Recap' },
      { list: ['Interrupt: from a device, asynchronous, the program resumes.', 'Exception: the instruction failed, synchronous; fixed and retried, or fatal.', 'System call: on purpose, synchronous, the program resumes with a result.'] },
      X('os-x-classify'), X('os-x-trap-count'),
    ],
  });

  C.lesson({
    id: 'os-syscall', chapter: 'os-trap', title: 'The system-call path', minutes: 8,
    summary: 'read and open look like ordinary C functions, and the part in the C library is one. The wrapper puts the call\'s number in rax and the arguments in rdi, rsi, rdx and on, then runs the syscall instruction. The kernel checks the number against its dispatch table, checks every argument, does the work, and leaves the result in rax. Back in user mode the wrapper turns a negative result into −1 and puts the error\'s number in errno.',
    blocks: [
      'A program calls `read(7, buf, 4)`, but descriptor 7 was never opened. The call returns −1 and `errno` is 9. Who decided it was an error, who chose the number 9, and how did it get into a variable of the program?',
      { def: 'system call', text: 'a request from a program to the kernel, made by a trap. Each call has a number; the kernel\'s system-call table maps the number to the handler that does the work.' },
      { topic: 'p01-syscall', input: { call: 'read(3, buf, 4)' }, frame: 1, caption: 'The C library\'s read wrapper: the call number 0 in rax, then the arguments in order, rdi = 3, rsi = the buffer\'s address, rdx = 4.' },
      { topic: 'p01-syscall', input: { call: 'read(3, buf, 4)' }, frame: 3, caption: 'In the kernel: rax = 0 is below 64, the size of the table, so the kernel calls sys_call_table[0], which is sys_read.' },
      { topic: 'p01-syscall', input: { call: 'read(3, buf, 4)' }, frame: 8, caption: 'sys_read copied 4 bytes and left 4 in rax. 4 is not an error, so the wrapper returns it as it is.' },
      { predict: { q: 'Now read(7, buf, 4), with descriptor 7 not open. sys_read returns −9, the negative of EBADF. What does the program\'s read call return?', options: ['−9', '−1, with errno set to 9', '0, with errno set to 9'], answer: 1, explain: 'The kernel\'s convention is a negative error number in rax. The wrapper sees a value between −4095 and −1, stores 9 in errno, and returns −1, the C convention.' } },
      { topic: 'p01-syscall', input: { call: 'read(7, buf, 4)' }, frame: 8, caption: 'rax = −9 is in the error range, so the wrapper sets errno = 9 (EBADF, "bad file descriptor") and returns −1.' },
      { tip: 'The kernel checks every argument because it cannot trust the program: a descriptor that is not open, a buffer address outside the program\'s memory, a count larger than the buffer. A check missed here is a hole through which a program could read or damage memory that is not its own.' },
      { h: 'Recap' },
      { list: ['A system call is a library wrapper plus a trap: the number in rax, the arguments in registers.', 'The kernel looks the number up in its table, checks every argument, and returns a result or a negative error.', 'The wrapper turns a negative result into −1 and errno.'] },
      X('os-x-errno'), X('os-x-wrapper'),
    ],
  });

  C.lesson({
    id: 'os-sysc', chapter: 'os-trap', title: 'Which lines call the kernel?', minutes: 7,
    summary: 'Not every library function is a system call. printf formats text into a buffer in the program\'s own memory; nothing reaches the kernel until the buffer is flushed with one write. When stdout is a terminal, each newline flushes; when it is a pipe or a file, the buffer waits until it is full, fflush is called or the program exits. write itself is always a system call.',
    blocks: [
      'A program prints three lines with printf and the system-call counter goes up by three. The same program with its output sent into a pipe makes no write at all until it exits. Same code, same printf calls: where did the text wait?',
      { topic: 'p01-sysc', input: { prog: '0', tty: 'tty' }, frame: 1, caption: 'On a terminal: printf("line 1\\n") ends with a newline, so the stdout buffer is flushed at once with one write. System call number 1.' },
      { topic: 'p01-sysc', input: { prog: '0', tty: 'tty' }, frame: 4, caption: 'printf("no newline"): the text goes into the buffer, in the program\'s own memory. No system call.' },
      { topic: 'p01-sysc', input: { prog: '0', tty: 'tty' }, frame: 6, caption: 'At exit the buffer is flushed: "no newline" goes out after the "!\\n" that write sent straight away. On a terminal this run made 5 writes, and the exit itself is a sixth system call.' },
      { predict: { q: 'The same program, with stdout a pipe (fully buffered). The program prints line 1, line 2, line 3 and "no newline" with printf, then calls write(1, "!\\n", 2). What comes out of the pipe first?', options: ['line 1', '!', 'no newline'], answer: 1, explain: 'All four printf calls only fill the buffer. write is a system call, so "!" goes out at once; the buffer follows at exit, in one write.' } },
      { topic: 'p01-sysc', input: { prog: '0', tty: 'pipe' }, frame: 6, caption: 'Into a pipe: 2 writes in all. "!\\n" went first; the four printf calls left in one write at exit.' },
      { table: [['Function', 'System call?'], ['printf, puts, putchar', 'no: into the stdout buffer'], ['fflush, exit, a newline on a terminal', 'one write, if the buffer holds anything'], ['write, read, open, close', 'yes, each time'], ['strlen, memcpy, snprintf', 'never: pure computation']], caption: 'Library code against kernel work.' },
      { lab: 'process', title: 'Count the writes', text: 'Five printf calls, some with newlines. Run it on a terminal, then switch stdout to a pipe and count the writes in the trace.', setup: { src: ABC, policy: 'fifo', tty: true } },
      { h: 'Recap' },
      { list: ['printf is a library function; the system call is the write that flushes its buffer.', 'A terminal is line-buffered, a pipe or a file fully buffered.', 'fflush and exit flush; text printed by a process that crashes may never come out.'] },
      X('os-x-count-writes'), X('os-x-pipe-writes'), X('os-x-code-flush'), X('os-x-code-one-write'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: keeping control
  // =========================================================================================================
  C.lesson({
    id: 'os-lde', chapter: 'os-control', title: 'Limited direct execution', minutes: 8,
    summary: 'For speed, a program runs straight on the CPU, with no kernel code between its instructions. For control, it runs in user mode, and the kernel arranges at boot for the timer to interrupt every so often. The kernel gets the CPU back only through traps: a system call, an exit, or the timer. A context switch saves one process\'s registers and loads another\'s; every switch costs kernel time.',
    blocks: [
      'If the kernel had to inspect every instruction a program runs, programs would crawl. If it inspects none, how does it ever get the CPU back from a program that has it?',
      { def: 'limited direct execution', text: 'running a program directly on the CPU, at full speed, but limited: in user mode, so it cannot run privileged instructions, and with the timer armed, so it cannot keep the CPU for ever.' },
      { topic: 'p01-lde', input: { procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 }, frame: 2, caption: 'A runs straight on the CPU from t = 0 to t = 3. The kernel is not running at all during this time.' },
      { topic: 'p01-lde', input: { procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 }, frame: 4, caption: 'The timer fires at t = 3. The kernel saves A\'s registers in its process entry, loads B\'s, and return-from-trap resumes B in user mode: a context switch.' },
      { topic: 'p01-lde', input: { procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 }, frame: 6, caption: 'B makes a system call at t = 5. The kernel does the work and returns to B: a system call is a way in, but with the timer on it does not decide when B stops.' },
      { topic: 'p01-lde', input: { procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 }, frame: ldeLast({ procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 }, 18), caption: 'All done by t = ' + LDE1.end + ', after ' + LDE1.switches + ' context switches and ' + LDE1.timerInterrupts + ' timer interrupts.' },
      { predict: { q: 'Turn the timer off. A needs 3 ticks, then L loops for ever without a system call, then B needs 2 ticks. What happens to B?', options: ['It runs after L\'s next slice', 'It never runs: nothing takes the CPU back from L', 'The kernel notices the loop and ends L'], answer: 1, explain: 'With no timer, the kernel runs only when a program traps. L never does, so the kernel never runs again, and B waits for ever. Only a reboot ends it.' } },
      { topic: 'p01-lde', input: { procs: 'A 3, L loop, B 2', quantum: 3, timer: 'off', cost: 0 }, frame: 5, caption: 'L has run from t = 3 to t = 18 and will never trap. With no timer the kernel never runs again.' },
      'Now switches cost something. Each one runs kernel code (save, choose, load), here one tick of it. With three programs of 4 ticks each, a timer every tick ends at t = 23 after 11 context switches; a timer every 6 ticks ends at t = 15 after 3. A short period answers quickly but wastes time switching; a long one wastes little but makes everyone wait.',
      { topic: 'p01-lde', input: { procs: 'A 4, B 4, C 4', quantum: 1, timer: 'on', cost: 1 }, frame: 37, caption: 'A timer every tick, a switch costing 1 tick: 12 ticks of work take until t = 23, with 11 context switches.' },
      { h: 'Recap' },
      { list: ['Programs run directly on the CPU in user mode; the kernel is not running meanwhile.', 'The kernel gets the CPU back only through a trap: a system call, an exit, or the timer.', 'The timer is what makes sharing compulsory; its period trades response against switching cost.'] },
      X('os-x-switches'), X('os-x-no-timer'), X('os-x-overhead'),
    ],
  });

  C.lesson({
    id: 'os-boot', chapter: 'os-control', title: 'From power-on to the first process', minutes: 6,
    summary: 'At power-on there is no operating system, only firmware. It tests the machine and tries the devices in its boot order until one holds a boot loader. The loader brings the kernel into memory and jumps to it. The kernel, in kernel mode from the start, sets up its page tables, its trap table, its drivers and the timer, mounts the root file system, and creates the first process, init. Everything after that is a fork and an exec.',
    blocks: [
      'Every process is made by another process calling fork. Then who made the first one? And before any kernel was in memory, what code put it there?',
      { topic: 'p01-boot', input: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' }, frame: 0, caption: 'Power on: the CPU starts in its most privileged mode at the reset vector 0xFFFFFFF0, in read-only firmware. No OS yet.' },
      { topic: 'p01-boot', input: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' }, frame: 3, caption: 'The usb stick held nothing bootable, so the BIOS reads the disk\'s first 512-byte sector, checks its 0x55AA signature and jumps to it at 0x7C00.' },
      { topic: 'p01-boot', input: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' }, frame: 8, caption: 'The kernel fills its trap table and loads its base with a privileged instruction. Until this point no trap could have been handled.' },
      { predict: { q: 'The kernel creates pid 1 and loads /sbin/init into it. In which mode does init run?', options: ['Kernel mode: the kernel started it', 'User mode, like every other program', 'A third mode reserved for init'], answer: 1, explain: 'init is an ordinary program. The kernel starts it with return-from-trap, the first switch to user mode on this machine, and from then on the kernel runs only on traps.' } },
      { topic: 'p01-boot', input: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' }, frame: 14, caption: 'pid 1 runs /sbin/init in user mode: the ancestor of every other process.' },
      { topic: 'p01-boot', input: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' }, frame: 20, caption: 'init has forked and exec\'d syslogd, cron, sshd and getty as pids 2 to 5: 5 processes in user mode. init stays, to reap orphans.' },
      { topic: 'p01-boot', input: { fw: 'bios', order: 'cd, usb', devs: 'disk', services: 'getty', ramdisk: 'yes' }, frame: 4, caption: 'Boot order cd, usb, but only the disk holds a boot loader: the firmware stops with "no bootable device". The disk was never tried.' },
      { h: 'Recap' },
      { list: ['Firmware, then a boot loader from the first device in the boot order that has one, then the kernel.', 'The kernel sets up page tables, the trap table, drivers and the timer while still in kernel mode.', 'init, pid 1, is the first user process; every other process descends from it.'] },
      X('os-x-boot-pid'), X('os-x-boot-order'),
    ],
  });

  C.lesson({
    id: 'os-structure', chapter: 'os-control', title: 'How a kernel is built', minutes: 7,
    summary: 'The services a kernel offers (files, drivers, memory) can all live in one kernel address space, calling each other directly: a monolithic kernel, cheap per request but where any bug can bring down everything. A microkernel keeps only message passing, scheduling and memory in the kernel and runs the services as user processes, safer but paying two mode switches for every message. Layered, modular and hybrid designs sit between.',
    blocks: [
      'A disk driver has a bug: it writes through a stale pointer. On one system the whole machine crashes; on another, the driver process restarts and the user sees a short pause. Both run the same driver code. What is different?',
      { def: 'monolithic kernel, microkernel', text: 'a monolithic kernel runs every service in kernel mode in one address space, as functions that call each other. A microkernel runs only the minimum in kernel mode; file systems and drivers are user processes that talk by messages through it.' },
      { topic: 'p01-structure', input: { st: 'monolithic' }, frame: 12, caption: 'Monolithic: one read goes down five layers and back, all as plain calls inside the kernel. 2 mode switches, 8 in-kernel calls, 0 messages.' },
      { predict: { q: 'In the microkernel, the app, the file server and the disk driver are three user processes. Each step between them is a message through the kernel, costing 2 mode switches. How many mode switches does one read take, request and reply?', options: ['2', '4', '8'], answer: 2, explain: 'Request: app to file server, file server to driver; reply: driver to file server, file server to app. 4 messages of 2 mode switches each: 8.' } },
      { topic: 'p01-structure', input: { st: 'microkernel' }, frame: 6, caption: 'Microkernel: 8 mode switches, 4 messages and 4 address-space switches for the same read.' },
      { topic: 'p01-structures', input: { op: 'read' }, frame: 4, caption: 'Five designs side by side. Monolithic, layered and modular kernels pay 2 mode switches; the hybrid, with one service in user space, 4; the microkernel 8.' },
      { table: [['Design', 'Where services run', 'A crash in a driver', 'Cost of a request'], ['monolithic', 'all in the kernel', 'can take down the kernel', 'lowest'], ['layered', 'kernel, each layer calling only the one below', 'can take down the kernel', 'more calls, no extra switches'], ['modules', 'kernel, some loaded at run time', 'can take down the kernel', 'like monolithic'], ['microkernel', 'user processes', 'that process restarts', 'messages and mode switches'], ['hybrid', 'mostly kernel, some in user space', 'depends on where it ran', 'in between']], caption: 'The price of isolation.' },
      { h: 'Recap' },
      { list: ['Monolithic: services call each other directly in one kernel; fast, but one bug can bring everything down.', 'Microkernel: services are user processes; a fault is contained, at the cost of messages and mode switches.', 'Modules and hybrids are the compromises most systems actually ship.'] },
      X('os-x-structure-cost'), X('os-x-driver-crash'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
