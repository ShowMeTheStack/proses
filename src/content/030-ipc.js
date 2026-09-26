// Part 3, inter-process communication and signals: the chapters, and the lessons of the first two (pipes and
// descriptors; shared memory, messages and remote calls). The lessons of the last two chapters are in 030-ipc2.js,
// the exercises in 031-ipc-ex.js and 031-ipc-ex2.js, and the challenges, the tour and the course in 032-ipc-ch.js.
// Every value quoted here was worked out by the engines on the topics' own inputs: S.Kern running the topics' C
// programs, and the models in S.Ipc.
(function (S) {
  'use strict';
  const C = S.Content, P3 = S.P03;
  // the system calls that set up p03-shm's region, as its first frame counts them
  const shmCalls = (() => { const t = S.byId && S.byId('p03-shm'); if (!t) return 4; const f = t.run(S.inputOf(t, { size: 4, n: 5, quantum: 2, policy: 'rr', seed: 3 })).frames[0]; const m = /\((\d+) system calls/.exec(f.say); return m ? Number(m[1]) : 4; })();
  if (!C || !P3 || C.chapters.some((c) => c.id === 'ipc-pipes')) return;

  C.chapter({ id: 'ipc-pipes', part: 'ipc', n: 1, title: 'Pipes and descriptors', blurb: 'A pipe between parent and child, end of file and the close that must not be forgotten, the descriptor tables fork copies, dup2 and redirection, and pipes with a name.' });
  C.chapter({ id: 'ipc-talk', part: 'ipc', n: 2, title: 'Shared memory, messages and remote calls', blurb: 'A ring in memory both processes can see, messages carried by the kernel with their naming, blocking and buffering, and clients, servers and remote calls when messages get lost.' });
  C.chapter({ id: 'ipc-signals', part: 'ipc', n: 3, title: 'Signals', blurb: 'Asynchronous notices: handlers, the default action and SIG_IGN, the mask and the pending set, SIGCHLD and reaping in a handler, kill, SIGKILL and alarm.' });
  C.chapter({ id: 'ipc-shell', part: 'ipc', n: 4, title: 'Building a shell', blurb: 'Read, fork, exec and wait; pipelines with dup2; redirection; background jobs reaped by SIGCHLD; process groups and the terminal.' });

  const X = (id) => ({ exercise: id });
  const procLab = (title, text, src, show) => ({ lab: 'process', title, text, setup: { src, show: show || 'fds', policy: 'fifo', tty: true } });
  const PIPE = P3.PIPE_PROGS;

  // =========================================================================================================
  // Chapter 1: pipes and descriptors
  // =========================================================================================================
  C.lesson({
    id: 'ipc-pipe', chapter: 'ipc-pipes', title: 'A pipe between parent and child', minutes: 7,
    summary: 'pipe() gives a process two descriptors for one buffer in the kernel: bytes written to the second come out of the first, in order. fork copies the descriptor table, so parent and child both hold both ends; each closes the end it does not use. A read waits while the pipe is empty and some process could still write, and returns 0, end of file, once no write end is open anywhere.',
    blocks: [
      'A parent forks a child to do some work and wants the answer back. After fork their memories are separate: whatever the child writes into a variable, the parent never sees. Is there something both can hold, through which the kernel carries bytes from one to the other?',
      { def: 'pipe', text: 'a one-way channel kept by the kernel: a buffer with a read end and a write end, each named by a descriptor. Bytes come out of the read end in the order they went into the write end.' },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4096', sched: 'fifo' }, frame: 1, caption: 'Line 7: pipe(p) creates pipe 1. Descriptor 3 (p[0]) reads it, descriptor 4 (p[1]) writes it, and the kernel buffer holds up to 4096 bytes.' },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4096', sched: 'fifo' }, frame: 2, caption: 'fork copies the descriptor table: process 101 holds 3 and 4 too, naming the same two open-file entries, so each end now has 2 references.' },
      { predict: { q: 'The parent closes descriptor 4 and calls read on the pipe before the child has written anything. What does read do?', options: ['It returns 0: the pipe is empty', 'It waits until there is something to read', 'It fails with an error'], answer: 1, explain: 'The pipe is empty but a write end is still open (the child\'s), so more bytes may come: the read blocks.' } },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4096', sched: 'fifo' }, frame: 4, caption: 'Process 100 reads at line 15: there is nothing to read yet, so it blocks. The child still has the write end open.' },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4096', sched: 'fifo' }, frame: 9, caption: 'The child wrote "ping pong" and closed its end. The parent asks for 6 bytes and gets "ping p": read returns 6.' },
      { predict: { q: 'The parent has read "ping p" and then "ong". It calls read once more. What happens?', options: ['It blocks, waiting for more', 'It returns 0, end of file', 'It returns "ping pong" again'], answer: 1, explain: 'The pipe is empty and no write end is open anywhere: the child closed its own, the parent closed its own at line 14. Nothing more can ever come, so read returns 0.' } },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4096', sched: 'fifo' }, frame: 13, caption: 'End of file: the pipe is empty and the write end has 0 references, so read returns 0 and the loop ends. The terminal shows [ping p], [ong] and read gave 0.' },
      { table: [['The call', 'What happens'], ['read, pipe empty, a write end open', 'waits'], ['read, pipe empty, no write end open', 'returns 0: end of file'], ['write, pipe full', 'waits for the reader to make room'], ['write, no read end open', 'SIGPIPE, and write fails with EPIPE']], caption: 'The rules of a pipe.' },
      procLab('Run the pipe in the Process lab', 'The same program, with the descriptor tables and the pipe drawn beside the fork tree. Step through it, or choose who runs next by hand.', PIPE.basic.src, 'fds'),
      { h: 'Recap' },
      { list: ['pipe(p): p[0] reads, p[1] writes, through a buffer in the kernel.', 'fork copies the descriptors, so both processes hold both ends; each closes the end it does not use.', 'read waits while the pipe is empty and a writer could still write; with no writer left, it returns 0.'] },
      X('ipc-x-pipe-orders'), X('ipc-x-code-pipe'),
    ],
  });

  C.lesson({
    id: 'ipc-eof', chapter: 'ipc-pipes', title: 'End of file, a full pipe, and the missing close', minutes: 7,
    summary: 'End of file on a pipe needs every write end closed, including the reader\'s own copy: forget one close and the reader waits for ever. A pipe is a bounded buffer, so a writer that fills it waits until the reader makes room. Small writes go in whole, so two writers\' lines do not interleave mid-line.',
    blocks: [
      'The program works. Then someone deletes one line, `close(p[1])` in the parent, because "the parent never writes anyway". The parent still reads the whole message. Why does it then never finish?',
      { topic: 'p03-pipe', input: { prog: 'hang', cap: '4096', sched: 'fifo' }, frame: 6, caption: 'The child closes its write end at line 11, but the write end still has 1 reference: the parent\'s own copy of descriptor 4, never closed.' },
      { predict: { q: 'The parent has read all 9 bytes. Its loop calls read again. What happens?', options: ['read returns 0 and the loop ends', 'read waits for ever', 'the kernel closes the parent\'s write end for it'], answer: 1, explain: 'The pipe is empty, but a write end is open: the parent\'s own. As far as the kernel knows, the parent might still write, so read waits, and nobody will ever wake it.' } },
      { topic: 'p03-pipe', input: { prog: 'hang', cap: '4096', sched: 'fifo' }, frame: 13, caption: 'No process can run again: process 100 is blocked in read, and process 101 is a zombie its parent will never reap.' },
      { warn: 'Close every end you do not use, in every process, right after fork. One stray write end anywhere, even in the reader itself, means no end of file.' },
      'A pipe also has a size. Here it holds only 4 bytes, and the child writes 9 at once.',
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4', sched: 'fifo' }, frame: 6, caption: 'The pipe is full after 4 of the 9 bytes, so the child blocks inside write until the reader makes room.' },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4', sched: 'fifo' }, frame: 7, caption: 'The parent reads "ping": 4 bytes, all there were, though it asked for 6. read returns what is there, never waiting to fill the buffer it was given.' },
      { topic: 'p03-pipe', input: { prog: 'basic', cap: '4', sched: 'fifo' }, frame: 20, caption: 'With the small pipe the parent prints [ping], [ pon] and [g]: three reads instead of two. The bytes and their order are the same; only how they are cut up has changed.' },
      { topic: 'p03-pipe', input: { prog: 'two', cap: '4096', sched: 'fifo' }, frame: 10, caption: 'Two children write "ant\\n" and "bee\\n" into one pipe. Each write of 4 bytes goes in whole, so the reader gets "ant\\nbee\\n", 8 bytes, never "anbet...". Which line comes first depends on the schedule.' },
      { tip: 'A write no larger than the pipe\'s atomic size (at least 512 bytes, 4096 on most systems) goes into the pipe in one piece. Longer writes may be split and interleaved with another writer\'s.' },
      { h: 'Recap' },
      { list: ['End of file needs every write end closed, in every process.', 'A full pipe makes the writer wait; read returns what is there, up to what was asked.', 'Small writes are atomic: lines from several writers do not mix.'] },
      X('ipc-x-hang'), X('ipc-x-small-reads'),
    ],
  });

  C.lesson({
    id: 'ipc-fds', chapter: 'ipc-pipes', title: 'Descriptor tables, dup and dup2', minutes: 9,
    summary: 'Three tables: each process\'s descriptors point into a system-wide table of open files, and each open file holds an offset and points to the file itself. fork copies the descriptors, so parent and child share one open file and its offset; two opens make two entries, two offsets. dup and dup2 make a second descriptor for the same open file, which is how a shell sends a program\'s output into a file.',
    blocks: [
      'A parent opens a log file and forks. Both processes write a line to it. Does the second line land after the first, or on top of it? And would it make a difference if each process opened the file itself, after the fork?',
      { def: 'open-file table', text: 'the kernel\'s system-wide table of open files. Each entry holds an offset, the open flags and a count of descriptors that refer to it. A process\'s descriptor is only a small number naming one of these entries.' },
      { topic: 'p03-fdtables', input: { prog: 'shared' }, frame: 2, caption: 'open, then fork: descriptor 3 in both processes names the same open-file entry 2. There is one offset, and both processes move it.' },
      { topic: 'p03-fdtables', input: { prog: 'shared' }, frame: 7, caption: 'The child wrote "child\\n" and moved the shared offset to 6; the parent\'s "parent\\n" goes on from there, to 13. cat prints both lines.' },
      { predict: { q: 'Now the other order: fork first, then each process opens "log" itself. The child writes "child\\n", then the parent writes "parent\\n". What does cat print at the end?', options: ['child, then parent', 'parent only', 'child only'], answer: 1, explain: 'Two opens make two entries, each with its own offset starting at 0. The parent\'s 7 bytes go at offset 0, on top of the child\'s 6: the file holds "parent\\n".' } },
      { topic: 'p03-fdtables', input: { prog: 'separate' }, frame: 4, caption: 'fork, then open: the child gets entry 3 with its own offset 0, while the parent has entry 2.' },
      { topic: 'p03-fdtables', input: { prog: 'separate' }, frame: 8, caption: 'The parent writes "parent\\n" at its own offset 0, over the child\'s line. cat prints only parent.' },
      { h: 'Moving a descriptor' },
      { math: 'dup(fd)        a new descriptor, the lowest free number, for the same entry\ndup2(fd, n)    close n if it is open, then make n name fd\'s entry\n\ncmd > out, in the child before exec:\n    fd = open("out", O_WRONLY | O_CREAT | O_TRUNC, 0644);\n    dup2(fd, 1);\n    close(fd);' },
      { topic: 'p03-dup', input: { prog: 'redirect' }, frame: 4, caption: 'The child opens "out" as descriptor 3, then dup2(3, 1): descriptor 1, its standard output, now names the file.' },
      { topic: 'p03-dup', input: { prog: 'redirect' }, frame: 7, caption: 'After exec, ls writes to descriptor 1 as always, and the bytes go into "out". ls never learns that its output was moved.' },
      { predict: { q: 'A program points descriptor 1 at a file, prints "back on screen\\n" (with stdout no longer a terminal), and then calls exec without fflush. Where does the line go?', options: ['to the terminal', 'into the file', 'nowhere: it is lost'], answer: 2, explain: 'With stdout not a terminal, printf keeps the text in the process\'s own buffer. exec replaces the whole image, buffer and all, so the text is never written.' } },
      { topic: 'p03-dup', input: { prog: 'lost' }, frame: 9, caption: 'exec keeps the pid and the descriptors, but the unflushed buffer "back on screen\\n" is lost with the old image. Call fflush before exec.' },
      procLab('Try dup2 in the Process lab', 'A program that moves descriptor 1 onto a file and back. Watch the descriptor table, the open-file entries and their reference counts.', P3.DUP_PROGS.fixed.src, 'fds'),
      { h: 'Recap' },
      { list: ['A descriptor names an entry in the open-file table; the entry holds the offset.', 'fork shares entries (one offset); two opens make two entries (two offsets).', 'dup takes the lowest free number; dup2(fd, n) makes n name fd\'s entry.', 'A shell redirects in the child, between fork and exec.'] },
      X('ipc-x-shared-offset'), X('ipc-x-separate-open'), X('ipc-x-dup-numbers'), X('ipc-x-code-dup2'),
    ],
  });

  C.lesson({
    id: 'ipc-fifo', chapter: 'ipc-pipes', title: 'Pipes with a name', minutes: 6,
    summary: 'A pipe made by pipe() can only be shared through fork. A named pipe (FIFO) has a name in the file system, so any two processes can open it. Opening for reading waits for a writer and opening for writing waits for a reader; after that it behaves like a pipe, and its bytes never touch the disk.',
    blocks: [
      'A logging daemon runs all the time; programs started later, by anyone, want to send it lines. They are not its children, so they cannot inherit a pipe from it. How can they find the daemon\'s pipe?',
      { def: 'named pipe (FIFO)', text: 'a pipe with a name in a directory, made by mkfifo. Any process allowed to open the name gets an end of the same pipe. The name has no data blocks: the bytes pass through a buffer in the kernel as with any pipe.' },
      { topic: 'p03-fifo', input: { scene: 'basic', cap: 8, policy: 'rr', seed: 1 }, frame: 1, caption: 'R opens /tmp/q for reading before anyone has it open for writing, so its open blocks.' },
      { topic: 'p03-fifo', input: { scene: 'basic', cap: 8, policy: 'rr', seed: 1 }, frame: 3, caption: 'W opens the other end: readers 1, writers 1, and R\'s open completes. The two ends found each other by name.' },
      { topic: 'p03-fifo', input: { scene: 'basic', cap: 8, policy: 'rr', seed: 1 }, frame: 5, caption: 'An 8-byte buffer: W writes "ten appl", all that fits, and blocks with "es" still to write, exactly as with an unnamed pipe.' },
      { topic: 'p03-fifo', input: { scene: 'basic', cap: 8, policy: 'rr', seed: 1 }, frame: 11, caption: 'W has closed its end, so R\'s next read on the empty pipe returns 0: end of file.' },
      { predict: { q: 'The reader reads one message and closes its end early. The writer then writes once more. What happens to the writer?', options: ['Its write waits for a new reader', 'It gets SIGPIPE, and write fails with EPIPE', 'Its bytes are stored on disk until someone reads them'], answer: 1, explain: 'With no read end open anywhere, nobody can ever read those bytes. The kernel sends the writer SIGPIPE, whose default action ends it; if it is caught or ignored, write fails with EPIPE.' } },
      { topic: 'p03-fifo', input: { scene: 'epipe', cap: 8, policy: 'rr', seed: 1 }, frame: 10, caption: 'R has closed its end. W writes "six": no process has /tmp/q open for reading, so write fails with EPIPE and W gets SIGPIPE.' },
      { topic: 'p03-fifo', input: { scene: 'nonblock', cap: 8, policy: 'rr', seed: 1 }, frame: 2, caption: 'A non-blocking open for writing does not wait for a reader: with none there, it fails at once with ENXIO.' },
      { h: 'Recap' },
      { list: ['mkfifo gives a pipe a name, so unrelated processes can share it.', 'open for reading waits for a writer, and the other way round.', 'Then it is a pipe: reads wait or see end of file, writes wait when full or raise SIGPIPE with no reader.'] },
      X('ipc-x-fifo-open'), X('ipc-x-fifo-epipe'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: shared memory, messages and remote calls
  // =========================================================================================================
  C.lesson({
    id: 'ipc-shm', chapter: 'ipc-talk', title: 'Shared memory: a ring both can see', minutes: 7,
    summary: 'With shared memory the kernel maps one region into both processes once; after that they read and write it with ordinary loads and stores, no system call and no copy. The price: the processes must synchronise themselves. A ring buffer with indexes in and out is the classic layout; it is full when (in + 1) % size == out, so a ring of n slots holds n − 1 items.',
    blocks: [
      'A pipe costs a system call for every write and every read, and every byte is copied twice: into the kernel and out again. For a video encoder handing frames of several megabytes to a muxer, that is a lot of copying. Could the two processes simply look at the same memory?',
      { def: 'shared memory', text: 'a region of physical memory mapped into the address spaces of several processes. Once it is set up, a store by one is seen by a load in the other, with no system call in between.' },
      { topic: 'p03-shm', input: { size: 4, n: 5, quantum: 2, policy: 'rr', seed: 3 }, frame: 0, caption: 'The kernel maps one region of 4 slots into both processes, with ' + shmCalls + ' system calls, once: creating and mapping it, on each side. From then on in = out = 0, and neither side needs the kernel.' },
      { topic: 'p03-shm', input: { size: 4, n: 5, quantum: 2, policy: 'rr', seed: 3 }, frame: 2, caption: 'The producer writes "apple" into slot 0 and "fig" into slot 1, moving in to 2: plain stores, no system call.' },
      { predict: { q: 'The ring has 4 slots, and full means (in + 1) % 4 == out. How many items can it hold at once?', options: ['4', '3', '2'], answer: 1, explain: 'If all 4 slots were filled, in would come round to equal out, which is also what empty looks like. Leaving one slot free keeps full and empty apart: 3 items at most.' } },
      { topic: 'p03-shm', input: { size: 3, n: 6, quantum: 4, policy: 'rr', seed: 3 }, frame: 3, caption: 'A ring of 3 slots and a fast producer: after 2 items (in + 1) % 3 = 0 equals out = 0, so the ring is full and the producer spins, wasting its turn.' },
      { topic: 'p03-shm', input: { size: 4, n: 5, quantum: 2, policy: 'rr', seed: 3 }, frame: 11, caption: 'Done: 5 items through 3 usable slots with no copies through the kernel. The same 5 items as messages would take 10 system calls and copy 640 bytes through the kernel.' },
      { warn: 'Here each side spins while it cannot go on, burning its turns. Real programs put a semaphore or a lock and condition variable in the shared region; parts 7 and 8 show how.' },
      { h: 'Recap' },
      { list: ['Shared memory: set up once by the kernel, then plain loads and stores.', 'No copies and no system calls per item, but the processes synchronise themselves.', 'A ring of n slots with in and out holds n − 1 items.'] },
      X('ipc-x-ring-slots'), X('ipc-x-msg-cost'),
    ],
  });

  C.lesson({
    id: 'ipc-msg', chapter: 'ipc-talk', title: 'Message passing: naming, blocking, buffering', minutes: 8,
    summary: 'With message passing the kernel carries each message, and synchronises too. Three choices shape it: naming (send to a process, or to a mailbox several may read), buffering (no buffer: a rendezvous; n slots; unbounded) and blocking (a blocking send waits for room, a non-blocking one fails at once; the same for receive).',
    blocks: [
      'A producer sends messages faster than the consumer takes them. Where do the extra messages wait, and what happens to the producer when there is no room left?',
      { def: 'rendezvous', text: 'message passing with no buffer: a send waits until a receive takes the message, so sender and receiver meet. Each message is a synchronisation point as well as a transfer.' },
      { topic: 'p03-msg', input: { scene: 'pair', cap: '0', send: 'blocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 0, caption: 'No buffer: P sends "m1" and blocks, because no receiver is waiting yet.' },
      { topic: 'p03-msg', input: { scene: 'pair', cap: '0', send: 'blocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 3, caption: 'C receives "m1" in a rendezvous, and only then does P\'s send complete and P wake.' },
      { predict: { q: 'Now the queue holds 2 messages. P sends a, b, c, d in a row, while C computes for a while before receiving. Which send is the first to block?', options: ['a', 'b', 'c', 'none: the queue absorbs them all'], answer: 2, explain: 'a and b fill the queue (2 of 2). The send of c finds it full and blocks until C takes a.' } },
      { topic: 'p03-msg', input: { scene: 'burst', cap: '2', send: 'blocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 4, caption: 'Queue of 2: "a" and "b" wait in the queue, and P sends "c" and blocks: the queue to C is full.' },
      { topic: 'p03-msg', input: { scene: 'burst', cap: 'inf', send: 'blocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 4, caption: 'Unbounded: the sender never waits. Three messages already sit in the queue, and the queue grows as far as memory allows.' },
      { topic: 'p03-msg', input: { scene: 'burst', cap: '1', send: 'nonblocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 2, caption: 'A non-blocking send to a full queue (1 of 1) fails at once with EAGAIN: "b" is not sent. The sender must try again later, or drop it.' },
      { topic: 'p03-msg', input: { scene: 'mailbox', cap: '2', send: 'blocking', recv: 'blocking', policy: 'random', seed: 4 }, frame: 11, caption: 'Indirect naming: P sends four jobs to the mailbox "jobs", and two workers take them as they come free. The sender does not name, or even know, who will do each job.' },
      { topic: 'p03-msg', input: { scene: 'both', cap: '1', send: 'blocking', recv: 'blocking', policy: 'rr', seed: 1 }, frame: 2, caption: 'A and B each receive from the other first, and both block: a deadlock no buffer size can cure. One of them must send first.' },
      { table: [['', 'Shared memory', 'Message passing'], ['System calls per item', 'none (after setup)', 'a send and a receive'], ['Copies through the kernel', 'none', 'two: in and out'], ['Who synchronises', 'the processes', 'the kernel'], ['Across machines', 'no', 'yes']], caption: 'Two ways to talk.' },
      { h: 'Recap' },
      { list: ['Naming: direct (a process) or indirect (a mailbox).', 'Capacity 0 is a rendezvous; n makes a full queue block or fail; unbounded never blocks a sender.', 'Non-blocking calls return at once: a send to a full queue fails (EAGAIN), a receive from an empty one returns nothing.'] },
      X('ipc-x-msg-waits'), X('ipc-x-msg-nb'), X('ipc-x-msg-deadlock'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
