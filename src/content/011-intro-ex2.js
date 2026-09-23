// Part 1, what an operating system does: the exercises of chapters 2 (modes, traps and system calls) and 3 (keeping
// control). The toy CPU, the trap path, the system-call path, limited direct execution, booting and the kernel
// designs are all run here through S.Os, so every number in an answer or a hint is the engine's. The write counts of
// the C programs come from the simulated kernel (S.Kern), whose buffering follows the C library's rules.
(function (S) {
  'use strict';
  const C = S.Content, O = S.Os;
  if (!C || !O || C.exercises.has('os-x-privileged')) return;
  const hex = (n) => O.hex(n);
  const prog = (text) => text.split(';').map((l) => { const w = l.trim().split(/\s+/); return { op: w[0], args: w.slice(1).map((a) => (/^-?\d+$/.test(a) ? Number(a) : a)) }; });

  // =========================================================================================================
  // Modes
  // =========================================================================================================
  C.exercise({ id: 'os-x-privileged', chapter: 'os-trap', title: 'Which instructions are privileged?', level: 1, kind: 'set',
    text: ['Of these instructions of the toy CPU, which does the CPU refuse in user mode? Write them as a set, like {a, b}.', { code: 'load   store   add   div   syscall   cli   hlt   out   lcr3', lang: 'text' }],
    answer: '{' + ['load', 'store', 'add', 'div', 'syscall', 'cli', 'hlt', 'out', 'lcr3'].filter((n) => O.INSTR[n].priv).join(', ') + '}',
    hints: ['An instruction is privileged if a program could use it to take over the machine or another program\'s memory.', 'Turning interrupts off, halting, talking to a device and loading a page table all qualify. Asking the kernel for help does not: syscall is the one way in.', '{cli, hlt, out, lcr3}. syscall is allowed in user mode; it traps on purpose.'],
    caseless: true,
    solution: '{cli, hlt, out, lcr3}', wrong: ['{cli, hlt, out, lcr3, syscall}', '{cli, hlt}'] });

  const P1 = 'load r0 2; add r0 r0; store r0; out r0; load r1 1', R1 = O.run(prog(P1), { mode: 'user' });
  C.exercise({ id: 'os-x-started', chapter: 'os-trap', title: 'How far does it get?', level: 2, kind: 'number',
    text: ['This program runs in user mode. How many of its instructions does the CPU start before the process is ended? (Count the one that traps.)', { code: P1.split('; ').join('\n'), lang: 'text' }],
    answer: R1.executed,
    whyNot: { 5: 'The last load never runs: the process is ended at the out.', 3: 'The out is started too: the CPU fetches it, sees it is privileged, and traps.' },
    hints: ['Which of these instructions is privileged?', 'out writes a device register: refused in user mode. The CPU raises a general-protection exception at it, and the kernel ends the process.', 'load, add, store, then out traps: ' + R1.executed + ' instructions started, and the process is killed at PC ' + hex(R1.killed.pc) + '.'],
    solution: R1.executed, wrong: [5, 3] });

  C.exercise({ id: 'os-x-kernel-mode', chapter: 'os-trap', title: 'The same code in kernel mode', level: 1, kind: 'choice',
    text: ['The kernel itself runs `load r0 7; load r1 5; add r0 r1; cli; store r0` in kernel mode. What happens at cli?'],
    options: ['Interrupts go off and the code carries on: in kernel mode cli is allowed', 'A general-protection exception, as in user mode', 'The CPU switches to user mode first'],
    answer: 0,
    whyNot: { 1: 'The exception is raised only when the mode bit says user. Here it says kernel.', 2: 'Nothing switches the mode except a trap (into the kernel) and return-from-trap (out of it).' },
    hints: ['What does the CPU check before running a privileged instruction?', 'Only the mode bit. In kernel mode every instruction is allowed.', 'cli runs and interrupts go off; the program runs to its end, 5 instructions and 0 traps.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // The trap path
  // =========================================================================================================
  const T0 = O.trap({ cause: 'syscall', vector: 128, cpu: { pc: 0x2040, sp: 0x6ff8 }, kstack: 0xa000, result: 7 });
  const spAt = (kind, k) => T0.steps.filter((s) => s.kind === kind)[k || 0].sp;
  const TR = ['after the switch to the kernel stack', 'after the hardware pushes SP, flags and PC', 'after the entry code pushes r0 to r3', 'after return-from-trap'];
  const tv = [spAt('stack'), spAt('save', 0), spAt('save', 1), spAt('return')];
  const tcells = Object.fromEntries(TR.map((r, i) => [r + '|SP', tv[i]]));
  C.exercise({ id: 'os-x-trap-frame', chapter: 'os-trap', title: 'The stack pointer through a trap', level: 2, kind: 'table',
    text: ['A program at PC 0x2040 with its stack pointer at 0x6ff8 runs syscall. Its kernel stack starts at 0xa000 and grows down. The hardware pushes 3 words of 4 bytes (the user SP, the flags, the PC); the kernel\'s entry code then pushes the 4 general registers, 4 bytes each. Give SP after each stage (hex like 0x9ff0 is fine).'],
    rows: TR, cols: ['SP'], corner: 'stage', cellKind: 'number', cells: tcells,
    hints: ['The trap does not use the user stack at all: SP is first set to the top of the kernel stack.', 'Three pushes of 4 bytes take 12 (0xc) off SP; four more take 16 (0x10).', TR.map((r, i) => r + ': ' + hex(tv[i])).join('; ') + '.'],
    solution: Object.fromEntries(TR.map((r, i) => [r + '|SP', hex(tv[i])])),
    wrong: [Object.fromEntries(TR.map((r, i) => [r + '|SP', hex(i === 0 ? 0x6ff8 : i === 1 ? 0x6fec : i === 2 ? 0x6fdc : tv[i])])), Object.fromEntries(TR.map((r, i) => [r + '|SP', hex(i === 3 ? 0xa000 : tv[i])]))] });

  const RS = [['a system call (syscall at 0x2040)', 'syscall', 128, false], ['a timer interrupt, as the instruction at 0x2040 completes', 'interrupt', 32, false], ['a page fault at 0x2040, the page brought in', 'exception', 14, false], ['a divide error at 0x2040', 'exception', 0, false]];
  const rv = RS.map(([, cause, vector]) => { const t = O.trap({ cause, vector, cpu: { pc: 0x2040 } }); return t.resumePc === null ? 'none' : hex(t.resumePc); });
  const rcells = Object.fromEntries(RS.map((r, i) => [r[0] + '|resumes at', rv[i]]));
  C.exercise({ id: 'os-x-resume', chapter: 'os-trap', title: 'Where does it resume?', level: 2, kind: 'table',
    text: ['Four traps, each with the program\'s PC at 0x2040. After the handler, at which PC does the program carry on? Write the address (like 0x2040), or none if the program does not carry on.'],
    rows: RS.map((r) => r[0]), cols: ['resumes at'], corner: 'the trap', cellKind: 'text', cells: rcells,
    hints: ['The saved PC decides it: the next instruction when the one at 0x2040 completed, the same one when it did not.', 'A system call and an interrupt resume after a completed instruction; a page fault re-runs the faulting instruction; a divide error is fatal by default.', RS.map((r, i) => r[0] + ': ' + rv[i]).join('; ') + '.'],
    solution: rcells,
    wrong: [Object.assign({}, rcells, { [RS[2][0] + '|resumes at']: '0x2041' }), Object.assign({}, rcells, { [RS[3][0] + '|resumes at']: '0x2041' })] });

  const EV = [['the disk finishes a transfer', 'interrupt'], ['a program divides by zero', 'exception'], ['a program calls read', 'system call'], ['a key is pressed', 'interrupt'], ['an instruction touches a page that is on disk', 'exception'], ['a program asks for its pid', 'system call'], ['the timer fires', 'interrupt']];
  C.exercise({ id: 'os-x-classify', chapter: 'os-trap', title: 'Name the trap', level: 1, kind: 'table',
    text: ['For each event, write which kind of trap it is: interrupt, exception or system call.'],
    rows: EV.map((e) => e[0]), cols: ['kind'], corner: 'event', cellKind: 'text', cells: Object.fromEntries(EV.map((e) => [e[0] + '|kind', e[1]])),
    synonyms: [['system call', 'syscall', 'sys call', 'system-call']],
    hints: ['Who causes it: a device, the instruction failing, or the program asking?', 'Devices raise interrupts (disk, keyboard, timer). A failing instruction raises an exception (divide error, page fault). A request on purpose is a system call.', EV.map((e) => e[0] + ': ' + e[1]).join('; ') + '.'],
    solution: Object.fromEntries(EV.map((e) => [e[0] + '|kind', e[1]])),
    wrong: [Object.fromEntries(EV.map((e, i) => [e[0] + '|kind', i === 4 ? 'interrupt' : e[1]])), Object.fromEntries(EV.map((e, i) => [e[0] + '|kind', i === 2 ? 'exception' : e[1]]))] });

  const P2 = 'load r0 1; syscall; load r1 3; syscall; add r0 r1; load r1 0; div r0 r1; store r0', IRQ = [2, 3, 6];
  const R2 = O.run(prog(P2), { mode: 'user', interrupts: IRQ.map((at) => ({ at, vector: 32 })) });
  const cnt = (c) => R2.traps.filter((t) => t.cause === c).length;
  const KR = ['interrupts', 'system calls', 'exceptions', 'instructions started'];
  const kv = [cnt('interrupt'), cnt('syscall'), cnt('exception'), R2.executed];
  const kcells = Object.fromEntries(KR.map((r, i) => [r + '|count', kv[i]]));
  C.exercise({ id: 'os-x-trap-count', chapter: 'os-trap', title: 'Count the ways in', level: 3, kind: 'table',
    text: ['This program runs in user mode, and the timer interrupts after the 2nd, the 3rd and the 6th instruction (an interrupt after instruction k comes once k instructions have been started, before the next one). The program ends at the first fatal trap. Count each kind of trap it takes, and the instructions it starts.', { code: P2.split('; ').join('\n'), lang: 'text' }],
    rows: KR, cols: ['count'], corner: 'what', cells: kcells,
    hints: ['Walk the program instruction by instruction, keeping count of how many have been started; check for an interrupt before each one.', 'Instruction 7 is div r0 r1 with r1 = 0: a divide error, fatal. The interrupt after the 6th still comes before it.', 'Interrupts ' + kv[0] + ', system calls ' + kv[1] + ', exceptions ' + kv[2] + ', instructions started ' + kv[3] + ': the final store never runs.'],
    solution: Object.fromEntries(KR.map((r, i) => [r + '|count', String(kv[i])])),
    wrong: [Object.fromEntries(KR.map((r, i) => [r + '|count', String(i === 3 ? 8 : kv[i])])), Object.fromEntries(KR.map((r, i) => [r + '|count', String(i === 0 ? 2 : kv[i])]))] });

  // =========================================================================================================
  // System calls
  // =========================================================================================================
  const K0 = () => O.kernelState({ fds: { 0: { path: '/dev/tty', offset: 0, flags: 0 }, 1: { path: '/dev/tty', offset: 0, flags: 1 }, 2: { path: '/dev/tty', offset: 0, flags: 1 }, 3: { path: '/home/ana/notes.txt', offset: 0, flags: 0 } } });
  const CALLS = [['read(3, buf, 20)', 'read', [3, 'buf', 20]], ['open("/etc/motd", O_RDONLY)', 'open', ['/etc/motd', 0]], ['open("/etc/motd", O_WRONLY)', 'open', ['/etc/motd', 1]], ['read(5, buf, 4)', 'read', [5, 'buf', 4]], ['open("/home/ana/plans.txt", O_RDONLY)', 'open', ['/home/ana/plans.txt', 0]]];
  const cr = CALLS.map(([, n, a]) => O.syscall(n, a, { kernel: K0() }));
  const ecells = {};
  CALLS.forEach((c, i) => { ecells[c[0] + '|returns'] = cr[i].ret; ecells[c[0] + '|errno'] = cr[i].errno; });
  const eAns = Object.fromEntries(Object.entries(ecells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'os-x-errno', chapter: 'os-trap', title: 'Return values and errno', level: 2, kind: 'table',
    text: ['A process has descriptors 0, 1 and 2 on the terminal and 3 open for reading on /home/ana/notes.txt, which holds "buy milk\\n" (9 bytes). /etc/motd exists and may only be read; /home/ana/plans.txt does not exist. Each call below is made on its own, from this state. Give what the C call returns, and errno afterwards (0 if the call worked; ENOENT is 2, EBADF 9, EACCES 13). open returns the lowest free descriptor.'],
    rows: CALLS.map((c) => c[0]), cols: ['returns', 'errno'], corner: 'call', cells: ecells,
    hints: ['A failed call returns −1 in C; the reason goes in errno. A read returns how many bytes it copied, at most what is left in the file.', 'read(3, buf, 20) gets the whole 9-byte file. open takes the lowest free descriptor, 4. Writing to a read-only file is EACCES; descriptor 5 is not open, EBADF; a missing file is ENOENT.', CALLS.map((c, i) => c[0] + ' returns ' + cr[i].ret + ', errno ' + cr[i].errno).join('; ') + '.'],
    solution: eAns,
    wrong: [Object.assign({}, eAns, { 'read(3, buf, 20)|returns': '20' }), Object.assign({}, eAns, { 'read(5, buf, 4)|returns': '-9' })] });

  C.exercise({ id: 'os-x-wrapper', chapter: 'os-trap', title: 'Who sets errno?', level: 1, kind: 'choice',
    text: ['open fails because the file does not exist. The kernel puts −2 in rax. Which code turns that into `open` returning −1 with `errno` equal to 2?'],
    options: ['The C library\'s wrapper for open, back in user mode', 'The kernel\'s sys_open, before it returns', 'The CPU\'s return-from-trap instruction', 'The program\'s own code, after open returns'],
    answer: 0,
    whyNot: { 1: 'The kernel only leaves −2 in rax; errno is a variable in the program\'s memory, set by library code.', 2: 'Return-from-trap restores registers and the mode; it knows nothing about errors.', 3: 'The program only reads errno; by then it is already set.' },
    hints: ['Where does errno live: in the kernel, or in the program?', 'errno is a variable of the program, in user memory. The kernel\'s convention is a negative number in rax.', 'The wrapper: it sees rax between −4095 and −1, stores 2 in errno and returns −1.'],
    solution: 0, wrong: [1, 2] });

  const ABC = '#include <stdio.h>\n\nint main(void) {\n    printf("a");\n    printf("b\\n");\n    printf("c\\nd");\n    printf("e\\n");\n    printf("bye");\n    return 0;\n}\n';
  C.exercise({ id: 'os-x-count-writes', chapter: 'os-trap', title: 'Count the writes on a terminal', level: 2, kind: 'number',
    text: ['stdout is a terminal, so it is line-buffered: when a printf puts a newline in the buffer, everything up to that newline is written with one write system call, and what follows waits. At exit whatever is left is written. How many write system calls does this program make?', { code: ABC, lang: 'c' }],
    answer: 4,
    whyNot: { 5: 'printf("a") makes no write: it has no newline, so "a" waits and goes out with "b\\n".', 3: 'Count the exit too: "bye" has no newline, so it is written when the program exits.', 1: 'That is what happens into a pipe. On a terminal each newline sends what is ready.' },
    hints: ['Go call by call and keep track of what is in the buffer.', '"a" waits; "b\\n" sends "ab\\n"; "c\\nd" sends "c\\n" and leaves "d"; "e\\n" sends "de\\n"; "bye" waits for the exit.', '4 writes: "ab\\n", "c\\n", "de\\n", and "bye" at exit.'],
    solution: 4, wrong: [5, 3, 1] });

  C.exercise({ id: 'os-x-pipe-writes', chapter: 'os-trap', title: 'The same program into a pipe', level: 3, kind: 'number',
    text: ['The same program, run as `./abc | wc -c`, so stdout is a pipe and fully buffered (the buffer holds 4096 bytes). How many write system calls does it make now?', { code: ABC, lang: 'c' }],
    answer: 1,
    whyNot: { 4: 'That is the count on a terminal. Into a pipe, newlines do not flush.', 0: 'The text does come out: exit flushes the buffer, and that flush is a write.' },
    hints: ['When does a fully buffered stream write?', 'Only when the buffer fills, on fflush, or at exit. 11 bytes never fill a 4096-byte buffer.', 'One write, at exit, with all 11 bytes: "ab\\nc\\nde\\nbye".'],
    solution: 1, wrong: [4, 0] });

  const SAVE0 = '#include <stdio.h>\n#include <unistd.h>\n\nint main(void) {\n    printf("saving...");\n    sleep(1);\n    printf(" done\\n");\n    return 0;\n}\n';
  const SAVE1 = SAVE0.replace('    sleep(1);\n', '    fflush(stdout);\n    sleep(1);\n');
  const beforeSleep = (sys) => {
    const ev = sys.trace.filter((e) => e.pid === 100);
    const w = ev.findIndex((e) => e.kind === 'print' && /saving/.test(e.text || '')), b = ev.findIndex((e) => e.kind === 'block' && /sleep/.test(e.say || ''));
    if (b < 0) return 'the program never sleeps: keep the sleep(1)';
    return w >= 0 && w < b ? true : '"saving..." reached the terminal only after the sleep';
  };
  C.exercise({ id: 'os-x-code-flush', chapter: 'os-trap', title: 'Show it before the wait', level: 2, kind: 'code',
    text: ['This program prints "saving..." and then works for a second (the sleep). On a terminal, the user sees nothing during that second, then the whole line at once. Change it so that "saving..." reaches the terminal before the sleep starts, while the output stays exactly `saving... done` and a newline.'],
    starter: SAVE0,
    tests: [{ name: 'shown before the sleep', stdout: 'saving... done\n', expect: beforeSleep }],
    hints: ['Why does "saving..." not appear at once? Look for a newline.', 'There is none, so the text waits in the stdout buffer. Something must flush the buffer without adding a newline.', 'Add fflush(stdout); between the first printf and sleep(1).'],
    solution: SAVE1,
    wrong: [SAVE0, SAVE0.replace('"saving..."', '"saving...\\n"')] });

  const SQ0 = '#include <stdio.h>\n#include <unistd.h>\n\nint main(void) {\n    for (int i = 1; i <= 5; i++)\n        printf("%d\\n", i * i);\n    return 0;\n}\n';
  const SQ1 = '#include <stdio.h>\n#include <unistd.h>\n\nint main(void) {\n    char buf[64];\n    int len = 0;\n    for (int i = 1; i <= 5; i++)\n        len += snprintf(buf + len, sizeof buf - len, "%d\\n", i * i);\n    write(1, buf, len);\n    return 0;\n}\n';
  const oneWrite = (sys) => { const n = sys.trace.filter((e) => e.pid === 100 && e.kind === 'print').length; return n === 1 ? true : 'it made ' + n + ' write system calls, not 1'; };
  C.exercise({ id: 'os-x-code-one-write', chapter: 'os-trap', title: 'Five lines, one system call', level: 3, kind: 'code',
    text: ['The program below prints the squares 1, 4, 9, 16 and 25, one a line. On a terminal it makes 5 write system calls, one per newline. Make it print exactly the same text with a single write system call, still on a terminal.'],
    starter: SQ0,
    tests: [{ name: 'one write', stdout: '1\n4\n9\n16\n25\n', tty: true, expect: oneWrite }],
    hints: ['On a terminal every newline that printf puts in the buffer causes a write. So the text must reach the kernel in another way.', 'Build the whole text in a char array first: snprintf formats into memory without any system call. Then hand it to the kernel yourself.', 'char buf[64]; int len = 0; for (...) len += snprintf(buf + len, sizeof buf - len, "%d\\n", i * i); write(1, buf, len);'],
    solution: SQ1,
    wrong: [SQ0, SQ0.replace('"%d\\n"', '"%d "')] });

  // =========================================================================================================
  // Keeping control
  // =========================================================================================================
  const L1 = O.lde({ procs: [{ name: 'A', work: 4 }, { name: 'B', work: 3, syscalls: [1] }, { name: 'C', work: 2 }], quantum: 2, timer: true, switchCost: 0 });
  const segs1 = L1.segs.filter((s) => s.mode !== 'kernel').map((s) => s.who + ' ' + s.start + ' to ' + s.end).join(', ');
  C.exercise({ id: 'os-x-switches', chapter: 'os-control', title: 'Count the context switches', level: 2, kind: 'number',
    text: ['A needs 4 ticks, B 3 and C 2, in that order. The timer interrupts every 2 ticks, and switches take no time. B makes a system call after its first tick; with the timer on, the kernel returns to B after a system call. A context switch is any time the kernel moves the CPU from one process to another, including after an exit. How many context switches happen before all three are done?'],
    answer: L1.switches,
    whyNot: { [L1.switches + 2]: 'B\'s system call is not a switch: the kernel returns straight to B.', [L1.switches + 1]: 'The timer due at t = 6 is not carried over: A runs 6 to 8.' },
    hints: ['Draw the timeline first: who runs when, with the timer every 2 ticks.', segs1 + '.', 'Each change of process on that line is a switch: ' + L1.switches + '. The system call at B\'s first tick changes nothing.'],
    solution: L1.switches, wrong: [L1.switches + 2, L1.switches + 1] });

  C.exercise({ id: 'os-x-no-timer', chapter: 'os-control', title: 'No timer', level: 1, kind: 'choice',
    text: ['A kernel forgot to program the timer. One program enters `for (;;) ;`, an empty loop with no system call. What happens to the other programs?'],
    options: ['They never run again: the kernel gets no chance to take the CPU back', 'They run when the loop\'s slice is over', 'The CPU detects the loop and traps'],
    answer: 0,
    whyNot: { 1: 'Slices are enforced by the timer. With no timer, nothing ends the slice.', 2: 'An empty loop is a perfectly legal program; no instruction in it faults or traps.' },
    hints: ['How does the kernel get the CPU back from a running program?', 'Only through a trap: a system call, an exit, a fault, or an interrupt. The loop makes none of the first three, and with no timer there is no interrupt.', 'The loop keeps the CPU for ever; the others never run until the machine is rebooted.'],
    solution: 0, wrong: [1, 2] });

  const L2 = O.lde({ procs: [{ name: 'A', work: 3 }, { name: 'B', work: 2 }, { name: 'C', work: 3 }], quantum: 1, timer: true, switchCost: 1 });
  C.exercise({ id: 'os-x-overhead', chapter: 'os-control', title: 'Switching is not free', level: 3, kind: 'number',
    text: ['A needs 3 ticks, B 2 and C 3. The timer fires every tick, and every context switch costs 1 tick of kernel time. Programs take turns A, B, C, A, ...; a finished program drops out, and nothing needs switching after the last one ends. At what time is everything done?'],
    answer: L2.end,
    whyNot: { 8: 'That is the work alone. Every switch between slices adds a tick.', 16: 'The last program ends with an exit: no switch is needed after it.' },
    hints: ['Here every slice is 1 tick of work, and between two slices there is always one tick of switching.', 'There are 3 + 2 + 3 = 8 ticks of work, so 8 slices, and a switch between each two of them.', '8 ticks of work and ' + L2.switches + ' switches of 1 tick: everything is done at t = ' + L2.end + '.'],
    solution: L2.end, wrong: [8, 16] });

  const BS = ['logd', 'netd', 'dbd', 'webd', 'getty'], B1 = O.boot({ firmware: 'uefi', bootOrder: ['disk'], devices: ['disk'], services: BS, ramdisk: false });
  const done = B1.steps[B1.steps.length - 1].pids, web = done.find((p) => p.name === 'webd').pid;
  C.exercise({ id: 'os-x-boot-pid', chapter: 'os-control', title: 'Which pid?', level: 1, kind: 'number',
    text: ['A small server boots. The idle task is pid 0 and the kernel creates init as pid 1. init then forks and execs its services in this order: ' + BS.join(', ') + ', each getting the next free pid. What is webd\'s pid?'],
    answer: web,
    whyNot: { 4: 'The first service gets pid 2: pids 0 and 1 are the idle task and init.', 3: 'Count from 2: logd 2, netd 3, dbd 4, ...' },
    hints: ['Which pids are already taken when init starts forking?', 'Pid 0 is idle, pid 1 is init, so the services get 2, 3, 4, ... in order.', 'logd 2, netd 3, dbd 4, webd ' + web + ', getty ' + done.find((p) => p.name === 'getty').pid + '.'],
    solution: web, wrong: [4, 3] });

  const B2 = O.boot({ firmware: 'uefi', bootOrder: ['cd', 'usb', 'disk'], devices: ['usb', 'disk'], services: ['getty'], ramdisk: true });
  const from = /of the (\w+)/.exec(B2.steps.find((s) => /EFI system partition/.test(s.say)).say)[1];
  C.exercise({ id: 'os-x-boot-order', chapter: 'os-control', title: 'Which device boots?', level: 2, kind: 'choice',
    text: ['A UEFI machine has the boot order cd, usb, disk. There is no disc in the drive; a USB stick holds a boot loader with an older kernel, and the disk holds one with the newest kernel. Which kernel runs?'],
    options: ['The older one, from the USB stick', 'The newest one, from the disk', 'Neither: the cd drive is empty, so the firmware stops'],
    answer: from === 'usb' ? 0 : 1,
    whyNot: { 1: 'The firmware does not compare kernels: it boots from the first device in the order that holds a boot loader.', 2: 'An empty device is skipped; the firmware tries the next one in the order.' },
    hints: ['The firmware tries the devices in the boot order and stops at the first that works.', 'The cd has nothing, so it moves on to usb, which has a loader.', 'The USB stick\'s loader runs, so the older kernel boots; the disk is never tried.'],
    solution: from === 'usb' ? 0 : 1, wrong: [1, 2] });

  const ST = O.compareStructures({ op: 'read' }), SN = ['monolithic', 'microkernel', 'hybrid'];
  const stc = {};
  for (const id of SN) { const r = ST.find((x) => x.id === id); stc[id + '|mode switches'] = r.modeSwitches; stc[id + '|messages'] = r.messages; }
  const parts = (id) => O.STRUCTURES[id].parts.map((p) => p.name + ' (' + p.space + ')').join(', ');
  C.exercise({ id: 'os-x-structure-cost', chapter: 'os-control', title: 'The price of one read', level: 2, kind: 'table',
    text: ['One read() goes from the app down to the disk driver and the reply comes back up. A call inside the kernel crosses nothing; a system call is 1 mode switch each way; a message between two user processes goes through the kernel, 2 mode switches and 1 message. The parts, in order:', { list: SN.map((id) => id + ': ' + parts(id)) }, 'Give the mode switches and messages for one read, request and reply together.'],
    rows: SN, cols: ['mode switches', 'messages'], corner: 'design', cells: stc,
    hints: ['Count the hops down, then double them for the reply.', 'Monolithic: one system call in and one return out, everything else plain calls. Microkernel: app to file server and file server to driver are both messages.', SN.map((id) => id + ' ' + stc[id + '|mode switches'] + ' mode switches and ' + stc[id + '|messages'] + ' messages').join('; ') + '.'],
    solution: Object.fromEntries(Object.entries(stc).map(([k, v]) => [k, String(v)])),
    wrong: [Object.assign(Object.fromEntries(Object.entries(stc).map(([k, v]) => [k, String(v)])), { 'microkernel|mode switches': '4' }), Object.assign(Object.fromEntries(Object.entries(stc).map(([k, v]) => [k, String(v)])), { 'monolithic|mode switches': '1' })] });

  C.exercise({ id: 'os-x-driver-crash', chapter: 'os-control', title: 'A bug in the driver', level: 2, kind: 'choice',
    text: ['A disk driver writes through a stale pointer. Which statement is right?'],
    options: ['In a microkernel the driver is a user process: the fault ends that process, which can be restarted, and the kernel survives', 'In a monolithic kernel the fault is contained the same way, because the driver is a separate module', 'Neither design can survive it: a driver bug always crashes the machine'],
    answer: 0,
    whyNot: { 1: 'A module is loaded into the kernel\'s own address space and runs in kernel mode: a stray write can damage any kernel data.', 2: 'A user-mode driver has its own address space: its stray write traps, and only it is ended.' },
    hints: ['Where does the driver\'s code run, and what memory can it reach?', 'In kernel mode, in the kernel\'s address space, a bad write can land anywhere in the kernel. In user mode, it can only fault.', 'The microkernel contains it: the driver process is ended and restarted. That isolation is what its extra messages and mode switches pay for.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
