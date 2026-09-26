// Part 3, the exercises of the first two chapters (pipes and descriptors; shared memory, messages and remote calls).
// Every output a program can print is enumerated by the simulated kernel (S.Kern.outcomes) when an answer is
// checked; the programs were also compiled with the system compiler and run many times on a terminal, and every
// real output is one listed here. The message, ring and remote-call values come from the models in S.Ipc.
(function (S) {
  'use strict';
  const C = S.Content, I = S.Ipc;
  if (!C || !I || C.exercises.has('ipc-x-pipe-orders')) return;
  const INC = (...h) => h.map((x) => '#include <' + x + '>\n').join('') + '\n';

  // =========================================================================================================
  // Chapter 1: pipes and descriptors
  // =========================================================================================================
  C.exercise({ id: 'ipc-x-pipe-orders', chapter: 'ipc-pipes', title: 'Write, then print', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['The child writes two bytes into the pipe, then prints a line; the parent reads the pipe, then prints. Write every output this program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
    src: INC('stdio.h', 'unistd.h', 'sys/wait.h') + 'int main(void) {\n    int p[2];\n    char b[8];\n    pipe(p);\n    if (fork() == 0) {\n        close(p[0]);\n        write(p[1], "hi", 2);\n        printf("child wrote\\n");\n        return 0;\n    }\n    close(p[1]);\n    int n = read(p[0], b, 8);\n    printf("parent got %d\\n", n);\n    wait(NULL);\n    return 0;\n}\n',
    hints: ['The parent\'s read cannot return before the child\'s write: until then the pipe is empty and the child still holds the write end.', 'Once the write is done, both processes are free: the child to print, the parent to finish its read and print.', 'Two outputs: child wrote, then parent got 2; or parent got 2, then child wrote. read returns 2, the bytes that were there.'],
    solution: ['child wrote parent got 2', 'parent got 2 child wrote'],
    wrong: [['child wrote parent got 2'], ['child wrote parent got 2', 'parent got 2 child wrote', 'parent got 0 child wrote'], ['child wrote parent got 8', 'parent got 8 child wrote']] });

  C.exercise({ id: 'ipc-x-hang', chapter: 'ipc-pipes', title: 'The reader that never finishes', level: 2, kind: 'choice',
    text: ['The parent reads the pipe until end of file, then prints a total. It prints nothing and never ends. Which line, missing from the parent, is to blame?', { code: 'pipe(p);\nif (fork() == 0) {\n    close(p[0]);\n    write(p[1], "ping pong", 9);\n    close(p[1]);\n    return 0;\n}\n/* (a line is missing here) */\nwhile ((n = read(p[0], b, 6)) > 0)\n    total += n;\nprintf("%d bytes\\n", total);\nwait(NULL);', lang: 'c' }],
    options: ['`close(p[1]);` before the loop', '`close(p[0]);` before the loop', '`wait(NULL);` before the loop', '`fflush(stdout);` after the printf'],
    answer: 0,
    whyNot: { 1: 'p[0] is the end the parent reads from: closing it would make every read fail.', 2: 'Waiting first does not help: the child exits, but the parent\'s own copy of p[1] is still open, so after the 9 bytes the read still never sees end of file.', 3: 'The newline already flushes a terminal\'s line; the program never even reaches the printf.' },
    hints: ['When does read on a pipe return 0?', 'Only when the pipe is empty and no write end is open in any process, the reader included.', 'The parent still holds its own copy of the write end, p[1], so the kernel cannot report end of file. Add close(p[1]) before the loop.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'ipc-x-small-reads', chapter: 'ipc-pipes', title: 'A pipe of four bytes', level: 2, kind: 'number',
    text: ['The child writes "ping pong" (9 bytes) into a pipe with one call; the parent reads with `read(p[0], b, 6)` in a loop and prints `[...]` around whatever each read returns, until end of file. The running process keeps the CPU until it blocks, and the parent reaches its first read before the child writes.', 'The pipe holds only 4 bytes. How many bracketed lines does the parent print?'],
    answer: 3, higherLower: true,
    whyNot: { 2: 'That is the count with a roomy pipe: 6 bytes, then 3. Here no read can get more than 4 bytes, because the pipe never holds more.', '*': 'Follow the bytes: the child can put at most 4 into the pipe before it must wait, and each read takes what is there.' },
    hints: ['The child\'s write of 9 bytes puts in 4 and waits; then the parent reads what is there.', 'Each read gets at most what is in the pipe at that moment, even when it asked for 6. The child refills it 4 bytes at a time.', 'Three lines: [ping], [ pon], [g]; then a fourth read returns 0, end of file.'],
    solution: 3, wrong: [2, 4] });

  const PIPE_START = INC('stdio.h', 'string.h', 'unistd.h', 'sys/wait.h') + '/* what the child works out */\nchar *answer(void) {\n    return "6 x 7 = 42";\n}\n\nint main(void) {\n    char b[32];\n    int got = 0;\n    /* make a pipe and fork; the child writes answer() into the pipe and exits;\n       the parent reads until end of file, keeping the bytes in b, then waits for the child */\n\n    b[got] = 0;\n    printf("parent read: %s\\n", b);\n    return 0;\n}\n';
  const PIPE_BODY = '    int p[2];\n    pipe(p);\n    if (fork() == 0) {\n        close(p[0]);\n        char *msg = answer();\n        write(p[1], msg, strlen(msg));\n        close(p[1]);\n        return 0;\n    }\n    close(p[1]);\n    int n;\n    while ((n = read(p[0], b + got, 31 - got)) > 0)\n        got += n;\n    close(p[0]);\n    wait(NULL);\n';
  const PIPE_SOL = PIPE_START.replace('    /* make a pipe and fork; the child writes answer() into the pipe and exits;\n       the parent reads until end of file, keeping the bytes in b, then waits for the child */\n', PIPE_BODY);
  C.exercise({ id: 'ipc-x-code-pipe', chapter: 'ipc-pipes', title: 'Send the answer home', level: 2, kind: 'code',
    text: ['Finish main. Make a pipe and fork. The child writes the text of `answer()` into the pipe and exits. The parent reads from the pipe until end of file, keeping the bytes in `b` and their count in `got`, then waits for the child. Whatever the schedule, the program must print `parent read: 6 x 7 = 42` and end.'],
    starter: PIPE_START,
    tests: [{ name: 'the answer arrives', stdout: 'parent read: 6 x 7 = 42\n', seeds: [1, 2, 3, 4, 5, 6] }],
    maxSteps: 40000,
    hints: ['pipe(p) before fork, so both processes hold both ends. The child writes strlen(answer()) bytes into p[1].', 'The parent must close its own p[1] before reading, or the last read never sees end of file. Read into b + got, adding what each read returns.', 'int p[2]; pipe(p); if (fork() == 0) { close(p[0]); write(p[1], answer(), strlen(answer())); close(p[1]); return 0; } close(p[1]); while ((n = read(p[0], b + got, 31 - got)) > 0) got += n; wait(NULL);'],
    solution: PIPE_SOL,
    wrong: [PIPE_SOL.replace('    close(p[1]);\n    int n;', '    int n;'), PIPE_SOL.replace('    while ((n = read(p[0], b + got, 31 - got)) > 0)\n        got += n;\n', '    n = read(p[0], b, 31);\n'), PIPE_SOL.replace('        write(p[1], msg, strlen(msg));\n', '')] });

  const LOG_SHARED = INC('stdio.h', 'fcntl.h', 'unistd.h', 'sys/wait.h') + 'int main(void) {\n    int fd = open("log", O_WRONLY | O_CREAT | O_TRUNC, 0644);\n    if (fork() == 0) {\n        write(fd, "kid\\n", 4);\n        return 0;\n    }\n    write(fd, "mum\\n", 4);\n    wait(NULL);\n    close(fd);\n    execlp("cat", "cat", "log", NULL);\n    return 1;\n}\n';
  C.exercise({ id: 'ipc-x-shared-offset', chapter: 'ipc-pipes', title: 'One open, two writers', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['The parent opens "log", then forks; both processes write a line to it, and at the end the parent runs `cat log`. Write every output this program can produce, one a line.'],
    src: LOG_SHARED,
    hints: ['The file was opened before fork. How many open-file entries, and how many offsets, are there?', 'One entry, shared: each write goes where the other left the offset, so neither line can land on top of the other. Only their order depends on the schedule.', 'Two outputs: kid mum, and mum kid.'],
    solution: ['kid mum', 'mum kid'], wrong: [['kid', 'mum'], ['kid mum']] });

  const LOG_SEPARATE = LOG_SHARED.replace('    int fd = open("log", O_WRONLY | O_CREAT | O_TRUNC, 0644);\n    if (fork() == 0) {', '    pid_t k = fork();\n    int fd = open("log", O_WRONLY | O_CREAT, 0644);\n    if (k == 0) {');
  C.exercise({ id: 'ipc-x-separate-open', chapter: 'ipc-pipes', title: 'Two opens, two writers', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['Now the program forks first, and each process opens "log" itself (the file does not exist beforehand). Write every output it can produce, one a line.'],
    src: LOG_SEPARATE,
    hints: ['Each open makes an entry of its own in the open-file table, with its own offset, starting at 0.', 'Both lines are written at offset 0, and both are 4 bytes long: the later write covers the earlier one completely.', 'Two outputs: kid, and mum. Whichever process writes last wins the file.'],
    solution: ['kid', 'mum'], wrong: [['kid mum', 'mum kid'], ['kid', 'mum', 'kid mum']] });

  C.exercise({ id: 'ipc-x-dup-numbers', chapter: 'ipc-pipes', title: 'Which number does dup pick?', level: 1, kind: 'fork-outputs', ask: 'set',
    text: ['The program starts with descriptors 0, 1 and 2 open on the terminal. What does it print? (Write the one output.)'],
    src: INC('stdio.h', 'fcntl.h', 'unistd.h') + 'int main(void) {\n    int fd = open("log", O_WRONLY | O_CREAT, 0644);\n    int a = dup(fd);\n    close(0);\n    int b = dup(fd);\n    int c = dup2(fd, 7);\n    printf("%d %d %d %d\\n", fd, a, b, c);\n    return 0;\n}\n',
    hints: ['open and dup both take the lowest descriptor number that is free.', 'With 0, 1 and 2 taken, open gets 3 and the first dup 4. Then descriptor 0 is closed, so it is the lowest free one. dup2 does not choose: it uses the number it is given.', '3 4 0 7.'],
    solution: ['3 4 0 7'], wrong: [['3 4 5 7'], ['3 4 0 5']] });

  const D2_START = INC('stdio.h', 'fcntl.h', 'unistd.h') + 'int main(void) {\n    /* send everything printf writes from here on into the file "report" */\n\n    printf("north 17\\n");\n    printf("south 25\\n");\n    return 0;\n}\n';
  const D2 = D2_START.replace('    /* send everything printf writes from here on into the file "report" */\n', '    int fd = open("report", O_WRONLY | O_CREAT | O_TRUNC, 0644);\n    dup2(fd, 1);\n    close(fd);\n');
  const report = (sys) => { const ino = sys.fs.dir.report; const d = ino === undefined ? null : sys.fs.inodes[ino].data; return d === 'north 17\nsouth 25\n' ? true : d === null ? 'there is no file called report' : 'report holds ' + JSON.stringify(d) + ', not the two lines'; };
  C.exercise({ id: 'ipc-x-code-dup2', chapter: 'ipc-pipes', title: 'Redirect stdout with dup2', level: 2, kind: 'code',
    text: ['Make both lines go into a file called `report` (create it, or empty it if it exists) instead of to the terminal, without touching the two printf calls. Nothing should appear on the terminal.'],
    starter: D2_START,
    tests: [{ name: 'into the file', stdout: '', expect: report }, { name: 'an old report is replaced', files: { report: 'an old and much longer report\n' }, stdout: '', expect: report }],
    hints: ['printf writes to descriptor 1. Make descriptor 1 name the file.', 'open the file with O_WRONLY | O_CREAT | O_TRUNC, then dup2(fd, 1): the first argument is the descriptor to copy, the second the number to make it under.', 'int fd = open("report", O_WRONLY | O_CREAT | O_TRUNC, 0644); dup2(fd, 1); close(fd);'],
    solution: D2,
    wrong: [D2.replace('dup2(fd, 1);', 'dup2(1, fd);'), D2.replace(' | O_TRUNC', ''), D2_START] });

  C.exercise({ id: 'ipc-x-fifo-open', chapter: 'ipc-pipes', title: 'Opening a named pipe', level: 1, kind: 'choice',
    text: ['A process runs `mkfifo("/tmp/orders", 0600)` and then `open("/tmp/orders", O_WRONLY)`, an ordinary blocking open. No other process has the FIFO open yet. What happens?'],
    options: ['open waits until some process opens /tmp/orders for reading', 'open returns at once, and writes are stored on disk until a reader comes', 'open fails with ENXIO', 'open succeeds, and the first write gets SIGPIPE'],
    answer: 0,
    whyNot: { 1: 'A FIFO has no data blocks: its bytes only ever pass through a buffer in the kernel.', 2: 'That is what a non-blocking open for writing does when no reader is there.', 3: 'A blocking open does not return until there is a reader, so this case never arises at open.' },
    hints: ['A named pipe is a pipe that can be found by its name. What would writing to it be good for with no reader?', 'Opening one end of a FIFO waits for the other end to be opened, unless the open is non-blocking.', 'open waits until a reader opens the FIFO.'],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'ipc-x-fifo-epipe', chapter: 'ipc-pipes', title: 'The reader has gone', level: 2, kind: 'choice',
    text: ['A writer and a reader share a FIFO. The reader takes one message and exits. The writer, which has not changed what SIGPIPE does, then writes another message. What happens to the writer?'],
    options: ['It is killed by SIGPIPE', 'Its write waits until a new reader opens the FIFO', 'Its write succeeds, and the bytes stay in the FIFO for the next reader', 'Its write returns 0'],
    answer: 0,
    whyNot: { 1: 'Only open waits for the other side; a write with no reader left fails at once.', 2: 'Once no process has the read end open, nobody can read those bytes: the kernel refuses them.', 3: 'Returning 0 from read is end of file; a write with no reader is an error.' },
    hints: ['With no read end open anywhere, can those bytes ever be read?', 'The kernel sends the writer SIGPIPE. What does that signal do by default?', 'Its default action ends the process. Had it caught or ignored SIGPIPE, write would fail with EPIPE instead.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 2: shared memory, messages and remote calls
  // =========================================================================================================
  const RING = I.shm({ size: 6, items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], consume: 0, policy: 'rr', quantum: 8, seed: 1 });
  const RING_MAX = Math.max(...RING.steps.map((s) => s.count || 0));
  C.exercise({ id: 'ipc-x-ring-slots', chapter: 'ipc-talk', title: 'How full can the ring get?', level: 1, kind: 'number',
    text: ['A producer and a consumer share a ring of 6 slots with two indexes: the producer stores into slot `in` and moves it on, the consumer takes from slot `out` and moves it on, both modulo 6. The ring is empty when `in == out` and full when `(in + 1) % 6 == out`. At most how many items can be waiting in it at once?'],
    answer: RING_MAX, higherLower: true,
    whyNot: { 6: 'With all 6 slots full, in would have come round to out: the same test as empty. One slot always stays free.', '*': 'Start from in = out = 0 and add items until (in + 1) % 6 == out.' },
    hints: ['Start from in = out = 0 and store items one by one.', 'After k items in = k. The ring is full once (k + 1) % 6 equals out, which is 0.', RING_MAX + ': at k = 5, (5 + 1) % 6 = 0 = out. A ring of n slots holds n − 1 items.'],
    solution: RING_MAX, wrong: [6, 4] });

  const COST = I.compare({ items: 7, size: 64 }).rows;
  const SHM_CALLS = COST[0].syscalls, MSG_CALLS = COST[1].syscalls;
  C.exercise({ id: 'ipc-x-msg-cost', chapter: 'ipc-talk', title: 'Counting system calls', level: 1, kind: 'number',
    text: ['A producer hands 7 items of 64 bytes each to a consumer as messages: one send for each item, one receive for each item. How many system calls is that in all? (Shared memory, for comparison, needs ' + SHM_CALLS + ' to set up, create and map on each side, and none per item.)'],
    answer: MSG_CALLS, higherLower: true,
    whyNot: { 7: 'That counts only one side: every item is both sent and received.', '*': 'Count the calls per item, then multiply.' },
    hints: ['Each item crosses the kernel twice: the sender hands it in, the receiver takes it out.', 'That is two system calls per item, and each copies 64 bytes.', MSG_CALLS + ' system calls (7 sends and 7 receives), copying ' + COST[1].bytesCopied + ' bytes through the kernel.'],
    solution: MSG_CALLS, wrong: [7, SHM_CALLS] });

  const snd = (to, msg) => ({ op: 'send', to, msg }), rcv = () => ({ op: 'recv' }), work = { op: 'work' };
  const MW = I.messages({ naming: 'direct', capacity: 1, send: 'blocking', recv: 'blocking', policy: 'rr', procs: [{ name: 'P', ops: [snd('C', 'a'), snd('C', 'b'), snd('C', 'c')] }, { name: 'C', ops: [work, work, rcv(), rcv(), rcv()] }] });
  const blocked = (m) => MW.steps.some((s) => s.kind === 'block' && s.who === 'P' && s.say.indexOf('"' + m + '"') >= 0) ? 'waits' : 'goes on';
  const MCELLS = Object.fromEntries(['a', 'b', 'c'].map((m) => ['send ' + m + '|what P does', blocked(m)]));
  C.exercise({ id: 'ipc-x-msg-waits', chapter: 'ipc-talk', title: 'A queue of one', level: 2, kind: 'table',
    text: ['P sends three messages to C: "a", then "b", then "c". The queue to C holds 1 message, and sends and receives block. C first computes for two turns, then receives three times. They take turns, one operation each, P first. For each send, does P go on at once, or wait? Answer **waits** or **goes on**.'],
    rows: ['send a', 'send b', 'send c'], cols: ['what P does'], corner: 'operation', cellKind: 'text', cells: MCELLS,
    hints: ['A send to a queue with room puts the message in it and goes on; to a full queue, a blocking send waits until a receive makes room.', '"a" fills the queue. When P sends "b", C is still computing, so the queue is still full.', 'send a: ' + MCELLS['send a|what P does'] + '; send b: ' + MCELLS['send b|what P does'] + '; send c: ' + MCELLS['send c|what P does'] + '. C\'s first receive frees room for "b", but then "b" fills the queue again before "c".'],
    solution: MCELLS,
    wrong: [Object.assign({}, MCELLS, { 'send c|what P does': 'goes on' }), Object.assign({}, MCELLS, { 'send a|what P does': 'waits' })] });

  const NB = I.messages({ naming: 'direct', capacity: 2, send: 'nonblocking', recv: 'blocking', policy: 'rr', procs: [{ name: 'P', ops: ['a', 'b', 'c', 'd', 'e'].map((m) => snd('C', m)) }, { name: 'C', ops: [work, rcv(), work, rcv(), rcv()] }] });
  C.exercise({ id: 'ipc-x-msg-nb', chapter: 'ipc-talk', title: 'Sends that do not wait', level: 2, kind: 'number',
    text: ['P sends five messages to C, "a" to "e", with **non-blocking** sends; the queue to C holds 2. C computes for a turn, receives, computes for a turn, then receives twice. They take turns, one operation each, P first. A send to a full queue fails and that message is dropped. How many of the five messages does C receive?'],
    answer: NB.delivered.length, higherLower: true,
    whyNot: { 2: 'That is all the queue holds at once, but C takes messages out between P\'s sends.', 5: 'A non-blocking send to a full queue does not wait: it fails, and that message is gone.', '*': 'Take the turns one by one: P\'s send, C\'s operation, P\'s next send, and so on, keeping count of the queue.' },
    hints: ['Write the turns out: P sends a, C computes, P sends b, C receives, P sends c, C computes, P sends d...', 'Keep the queue\'s count: a (1), b (2), C takes a (1), c (2); when d comes the queue is full.', NB.delivered.length + ': C receives ' + NB.delivered.map((d) => d.body).join(', ') + '. The send of ' + NB.failed.map((d) => d.body).join(', ') + ' failed with EAGAIN. "e" was sent, but C had no receive left for it.'],
    solution: NB.delivered.length, wrong: [2, 5] });

  C.exercise({ id: 'ipc-x-msg-deadlock', chapter: 'ipc-talk', title: 'Both wait to hear first', level: 1, kind: 'choice',
    text: ['Two processes talk with blocking message passing. Each one\'s code is `receive(other); send(other, greeting);`. What happens, and what is the fix?'],
    options: ['Both block in receive for ever; one of them must send first', 'It works once the queue holds at least one message', 'It works with non-blocking sends', 'The kernel notices and delivers an empty message'],
    answer: 0,
    whyNot: { 1: 'Nothing is ever sent, so the size of the queue does not matter.', 2: 'The sends are never reached: both processes are stuck in receive.', 3: 'The kernel does not invent messages; a blocking receive waits until one is sent.' },
    hints: ['What is each process doing when it first runs?', 'Each waits to receive, and the only operation that could wake it is the other\'s send, which comes after the other\'s receive.', 'A deadlock: both wait in receive. Swap the order in one of them: send first, then receive.'],
    solution: 0, wrong: [1, 2] });

  // a backlog of 1 that stays full: the engine says how client2's connect ends (the SYN is dropped and retried)
  const BL = I.sockets({ procs: [
    { name: 'server', ops: [{ op: 'socket', as: 'ls' }, { op: 'bind', on: 'ls', port: 8080 }, { op: 'listen', on: 'ls', backlog: 1 }].concat(Array(12).fill({ op: 'work', ticks: 1 }), [{ op: 'accept', on: 'ls', as: 'c' }]) },
    { name: 'client1', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 8080 }] },
    { name: 'client2', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 8080 }] }],
  policy: 'order', host: 'server', order: ['server', 'server', 'server', 'client1', 'client1', 'client2', 'client2'] });
  const blEnd = BL.steps.find((st) => st.who === 'client2' && (st.kind === 'timeout' || st.kind === 'refused' || st.kind === 'connect'));
  const blErr = (/(E[A-Z]+)\.?$/.exec(blEnd.say) || [, 'ETIMEDOUT'])[1], blRetries = BL.steps.filter((st) => st.who === 'client2' && (st.kind === 'retry' || st.kind === 'timeout')).length;
  const blSpent = (/after (\d+) s/.exec(blEnd.say) || [, '7'])[1];
  C.exercise({ id: 'ipc-x-backlog', chapter: 'ipc-talk', title: 'A full backlog', level: 1, kind: 'choice',
    text: ['A server calls `listen(ls, 1)`, then is busy for a long time, far longer than a client keeps retrying, before it calls accept. One client has already connected and is waiting in the backlog. A second client calls connect. What happens to it?'],
    options: ['its SYN is dropped and retransmitted, and in the end connect fails with ' + blErr, 'connect fails at once with ECONNREFUSED', 'connect succeeds, and its requests go to the first client\'s socket', 'the first client is dropped to make room'],
    answer: 0,
    whyNot: { 1: 'A reset (ECONNREFUSED) comes only when nothing listens on the port. Here something does; there is just no room, so the server stays silent.', 2: 'Every connection gets its own socket at accept; connections are never merged.', 3: 'Connections already in the backlog keep their place.' },
    hints: ['The backlog holds connections the kernel has set up but the server has not yet accepted. Its size was given to listen: 1, and it is taken.', 'With no room, the server\'s kernel drops the SYN without answering. The client cannot tell a dropped SYN from a lost one, so it sends it again, waiting twice as long each time.', 'After ' + blRetries + ' retransmissions and ' + blSpent + ' s the backlog is still full, so connect gives up with ' + blErr + '.'],
    solution: 0, wrong: [1, 2] });

  const GREET = I.rpcCall({ proc: 'greet', args: [{ name: 'name', type: 'string' }, { name: 'times', type: 'uint8' }], value: { name: 'Bartholomew', times: 5 }, result: [{ name: 'text', type: 'string' }], impl: () => ({ text: '' }), id: 9 });
  C.exercise({ id: 'ipc-x-rpc-bytes', chapter: 'ipc-talk', title: 'How long is the request?', level: 2, kind: 'number',
    text: ['A remote call `greet("Bartholomew", 5)` is marshalled as in the topic: a 4-byte request id, a 4-byte procedure number, then the arguments in order. A string is a 4-byte length followed by its characters, padded with zero bytes to a multiple of 4; a uint8 takes 1 byte plus 3 bytes of padding. Everything is big-endian. How many bytes is the request message?'],
    answer: GREET.request.length, higherLower: true,
    whyNot: { 27: 'Every field is padded to a multiple of 4 bytes: the 11 characters take 12.', 24: 'Did you count the string\'s 4-byte length in front of its characters?', '*': 'Add the fields one by one: id, procedure, the string\'s length, its characters with padding, the uint8 with padding.' },
    hints: ['"Bartholomew" has 11 characters.', 'Padded to a multiple of 4, the characters take 12 bytes, and the length in front of them 4 more.', '4 (id) + 4 (procedure) + 4 (length) + 12 (characters) + 4 (the uint8 and its padding) = ' + GREET.request.length + ' bytes.'],
    solution: GREET.request.length, wrong: [27, 24] });

  C.exercise({ id: 'ipc-x-idempotent', chapter: 'ipc-talk', title: 'Safe to send twice', level: 2, kind: 'choice',
    text: ['A client retries any call whose reply does not come, and the server runs every request that arrives (at least once). Which of these calls give the same end state whether they run once or twice? Pick every one.'],
    options: ['`set_balance(50)`', '`get_balance()`', '`deposit(10)`', '`append_line("paid")` to a log file', '`rename("draft", "final")`, when run twice in a row'],
    answer: [0, 1],
    whyNot: { 2: 'A second run adds another 10.', 3: 'A second run adds a second line.', 4: 'The second run fails, as "draft" no longer exists; the files end the same, but the caller sees an error it did not cause. Not safe to retry blindly.' },
    hints: ['A call is idempotent when running it again changes nothing more.', 'Setting a value to 50 twice leaves 50; reading changes nothing at all.', 'set_balance(50) and get_balance(). The others either change the state again or report a failure the second time.'],
    solution: [0, 1], wrong: [[0, 1, 2], [1]] });

  const RCALLS = [{ op: 'deposit', arg: 30 }, { op: 'set', arg: 80 }, { op: 'deposit', arg: 12 }];
  const RSEM = (sem) => I.semantics({ semantics: sem, calls: RCALLS, loss: 0.3, dup: 0.2, retries: 3, seed: 8, start: 100 });
  const RLO = RSEM('at-least-once'), RMO = RSEM('at-most-once');
  const RTL = RLO.timeline.map((t) => (t.from === 'client' ? 'Request ' + t.label.replace(/ #/, ', id ') + (t.dup ? ' is delivered again (the network repeats it)' : t.lost ? ' is lost' : ' arrives') : 'The reply to id ' + t.label.replace(/.*#/, '') + (t.lost ? ' is lost' : ' arrives')) + '.');
  const RCELLS = { 'at-least-once|final number': RLO.final, 'at-most-once|final number': RMO.final };
  C.exercise({ id: 'ipc-x-retry-table', chapter: 'ipc-talk', title: 'Retries under two rules', level: 3, kind: 'table',
    text: ['A server keeps one number, starting at 100. A client makes three calls in turn: deposit(30) (adds 30), set(80) (sets the number to 80), deposit(12). Each try of a call carries the call\'s id. The network does this, message by message:', { steps: RTL }, 'Give the server\'s final number when it runs every request that arrives (at least once), and when it keeps each id with its reply and answers a repeat from that table (at most once).'],
    rows: ['at-least-once', 'at-most-once'], cols: ['final number'], corner: 'server', cells: RCELLS,
    hints: ['A lost request never reaches the server; only the requests that arrive (or arrive again) can run.', 'Follow the number: deposit(30) runs once, set(80) wipes whatever came before, and then deposit(12) arrives twice.', 'At least once: 100 + 30 = 130, set to 80, then 12 twice: ' + RLO.final + '. At most once: the repeat of id 102 gets the saved reply: ' + RMO.final + '.'],
    solution: { 'at-least-once|final number': String(RLO.final), 'at-most-once|final number': String(RMO.final) },
    wrong: [{ 'at-least-once|final number': String(RMO.final), 'at-most-once|final number': String(RMO.final) }, { 'at-least-once|final number': String(RLO.final + 30), 'at-most-once|final number': String(RMO.final) }] });
})(globalThis.Proses = globalThis.Proses || {});
