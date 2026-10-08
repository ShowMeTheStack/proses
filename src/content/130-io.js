// Part 13, I/O systems: the chapters and the lessons. The exercises are in 131-io-ex.js and 131-io-ex2.js; the
// challenge, the guided tour, the course and the pages the diagram checker looks at are in 132-io-ch.js. Each lesson
// opens with a question, runs the topic that shows the idea at a frame chosen for the point being made, asks for a
// prediction, sums up, and leads to its exercises. Every value quoted here is what the topics' own engine (S.IO) says
// on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'ios-hw')) return;

  C.chapter({ id: 'ios-hw', part: 'io', n: 1, title: 'Devices and moving data', blurb: 'The bus and the controllers, device registers and the handshake, and three ways to move data: polling, interrupts and DMA, each timed on the CPU.' });
  C.chapter({ id: 'ios-kernel', part: 'io', n: 2, title: 'The kernel I/O subsystem', blurb: 'Buffering so the device and the program overlap, a buffer cache with dirty blocks, spooling, and the block layer\'s queue with its merges and elevator.' });
  C.chapter({ id: 'ios-path', part: 'io', n: 3, title: 'From a call to the device and back', blurb: 'Blocking, non-blocking and asynchronous reads, and the life of one read() through the layers to the driver and the disk.' });
  const X = (id) => ({ exercise: id });
  const POLS = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook', 'nscan', 'fscan'];
  const pols = (on) => Object.fromEntries(POLS.map((p) => ['p_' + p, on.includes(p)]));
  const lab = (title, text, setup) => ({ lab: 'storage', title, text, setup });
  // the handshake figures are found by what their frames show (the register in a frame's title), so the captions
  // follow the topic whatever its registers are called
  const frameOf = (id, test, fallback) => { const t = S.byId && S.byId(id); if (!t) return { at: fallback, title: '' }; const fs = t.run(S.inputOf(t)).frames; const i = fs.findIndex((f) => test(f.title || '')); return i < 0 ? { at: Math.min(fallback, fs.length - 1), title: '' } : { at: i, title: fs[i].title, last: fs.length - 1 }; };
  // where interrupts start to beat polling in io-xfer-compare's sweep (its last frame)
  const xcross = (() => { const t = S.byId && S.byId('io-xfer-compare'); if (!t) return 3.5; const fs = t.run(S.inputOf(t)).frames, m = fs[fs.length - 1].meta || {}; return m.cross === undefined ? 3.5 : m.cross; })();
  const busLast = frameOf('io-bus', () => false, 99).at;
  const busData = frameOf('io-bus', (t) => /^CPU/i.test(t) && !/stat/i.test(t), 2);
  const busCtl = frameOf('io-bus', (t) => /^controller/i.test(t), 4);
  const dataReg = (busData.title.split(':')[1] || 'the data register').trim();
  const HS = S.IO && S.IO.handshake ? S.IO.handshake(0x41) : { cpuReads: 2, cpuWrites: 3, ctlActs: 3 };
  const regTopic = S.byId && S.byId('io-registers'), regMsg = regTopic ? String(S.inputOf(regTopic).msg) : 'Hi!';
  const regLast = frameOf('io-registers', () => false, 99).at;

  // =========================================================================================================
  // Chapter 1: devices and moving data
  // =========================================================================================================
  C.lesson({
    id: 'ios-bus', chapter: 'ios-hw', title: 'The bus, controllers and device registers', minutes: 7,
    summary: 'The CPU never drives a device directly. Each device has a controller on the bus with a few registers. In this course\'s printer controller they are STAT (a DONE bit that says the controller is idle and the last byte has gone, and a FAULT bit), CMD (a GO bit the CPU sets to start a send) and TX (the byte to send). Sending a byte is a handshake through them: the CPU reads STAT until DONE is 1, loads TX, sets GO; the controller drops DONE, sends the byte and raises DONE; the CPU polls STAT, finds DONE, and clears GO.',
    blocks: [
      'A program prints the letter A. Somewhere a printer must receive the byte 0x41. The CPU is wired to memory and to a bus; the printer\'s motors are not. What exactly does the CPU write, and where?',
      { def: 'controller and device registers', text: 'a controller is the electronics that runs a device. The CPU sees it as a handful of registers, reached by special I/O instructions or by ordinary loads and stores to addresses set aside for them (memory-mapped I/O).' },
      { topic: 'io-bus', frame: 0, caption: 'The CPU, memory and three controllers share one bus. To print 0x41 the CPU talks only to the printer controller\'s registers.' },
      { topic: 'io-bus', frame: busData.at, caption: 'STAT showed DONE = 1, so the controller was free; now the CPU puts 0x41 into ' + dataReg + ', the register that carries the byte towards the device.' },
      { predict: { q: 'The byte is in TX. How does the controller know it is there and should be sent?', options: ['It checks TX every microsecond', 'The CPU sets the GO bit in CMD', 'The bus carries an interrupt to it'], answer: 1, explain: 'CMD carries what the CPU wants done: setting GO says "send what is in TX". The controller sees GO, drops DONE in STAT to show a send is under way, and sends the byte.' } },
      { topic: 'io-bus', frame: busCtl.at, caption: 'The controller sees GO and drops DONE to 0 in STAT: a send is under way.' },
      { topic: 'io-bus', frame: busLast, caption: 'One byte is ' + HS.cpuReads + ' reads of STAT and ' + HS.cpuWrites + ' writes by the CPU (TX, GO set, GO cleared), and ' + HS.ctlActs + ' actions by the controller. Every byte repeats it.' },
      { topic: 'io-registers', frame: regLast, caption: '"' + regMsg + '", ' + regMsg.length + ' bytes: the same exchange once for each byte, with the CPU\'s reads and writes added up.' },
      { table: [['Register', 'Written by', 'Holds'], ['STAT', 'the controller', 'DONE: idle, the last byte has gone; FAULT: the device failed'], ['CMD', 'the CPU', 'GO: send what is in TX'], ['TX', 'the CPU', 'the byte to send']], caption: 'The registers of the printer controller.' },
      { h: 'Recap' },
      { list: ['The CPU drives a device through its controller\'s registers.', 'The handshake: read STAT until DONE is 1, load TX, set GO in CMD; the controller drops DONE, sends, raises DONE; the CPU polls STAT and clears GO.', 'Every byte repeats it, and a slow device makes the CPU poll STAT many times.'] },
      X('ios-x-handshake'), X('ios-x-regs'),
    ],
  });

  C.lesson({
    id: 'ios-poll', chapter: 'ios-hw', title: 'Polling', minutes: 6,
    summary: 'With polling the CPU itself reads the status register again and again until the device is ready, then moves the data. It is simple and, for a very fast device, quick. But every microsecond the device works is a microsecond the CPU spends asking, so for a slow device the CPU does nothing else at all.',
    blocks: [
      'A device takes 10 µs to produce each 4-byte unit. The CPU could run thousands of instructions in that time. With nothing but the status register to go on, what does it do while it waits?',
      { def: 'polling (busy waiting)', text: 'repeatedly reading a device\'s status register (STAT) until its DONE bit shows the device is ready. The CPU stays busy for the whole wait.' },
      { topic: 'io-polling', frame: 1, caption: 'The CPU writes unit 0\'s command (1 µs); the device will be busy 10 µs.' },
      { predict: { q: 'A status read takes 0.5 µs, and the device needs 10 µs. How many times does the CPU read the status register for one unit?', options: ['1', 'about 10', '21'], answer: 2, explain: 'It reads from t = 1 until it sees ready at 11.5: 21 reads of 0.5 µs. The last one, beginning after the device finished at 11, sees ready.' } },
      { topic: 'io-polling', frame: 2, caption: '21 status reads, 10.5 µs of busy waiting, and only at t = 11.5 does it see ready.' },
      { topic: 'io-polling', frame: 9, caption: '16 bytes in 48 µs, the CPU busy all 48 of them: 84 status reads spent waiting.' },
      lab('Polling against the others, in the Storage lab', 'The I/O workbench: the same transfer by polling, by interrupts and by DMA, with the CPU\'s time drawn for each. Change the device\'s speed.', { mode: 'io', ioView: 'xfer', xBytes: 16, xUnit: 4, xDevice: 10, xCmd: 1, xPoll: 0.5, xCopy: 0.5, xIrq: 4, xDmaSetup: 5, xDmaBlock: 0, xBus: 0.2 }),
      { h: 'Recap' },
      { list: ['Polling keeps the CPU reading the status register.', 'The CPU is busy for the whole transfer, device time included.', 'Fine for a device that is ready almost at once; wasteful for a slow one.'] },
      X('ios-x-poll-reads'),
    ],
  });

  C.lesson({
    id: 'ios-irq', chapter: 'ios-hw', title: 'Interrupts', minutes: 7,
    summary: 'With interrupts the CPU starts the device and goes off to other work; when the unit is ready the controller raises an interrupt, the CPU saves what it was doing, runs the handler (which moves the data and starts the next unit) and returns. The waiting is free, but every interrupt costs its entry and exit, so a device that interrupts very often can cost more than polling.',
    blocks: [
      'Instead of the CPU asking "are you ready yet?" twenty times, could the device say "I am ready" once?',
      { def: 'interrupt', text: 'a signal from a device that makes the CPU stop what it is doing, save its state, run the device\'s handler from the interrupt vector, and return.' },
      { topic: 'io-interrupt', frame: 2, caption: 'From 1 to 11 the device works on unit 0 and the CPU is free: 10 µs for other processes.' },
      { topic: 'io-interrupt', frame: 3, caption: 'At t = 11 the device interrupts. Entering, dispatching and returning cost 4 µs.' },
      { topic: 'io-interrupt', frame: 4, caption: 'The handler copies the unit (0.5 µs) and starts the next one (1 µs).' },
      { predict: { q: 'Polling kept the CPU busy 48 µs for these 16 bytes. With interrupts at 4 µs each, how busy is it?', options: ['48 µs: the same', '22 µs', '4 µs: one interrupt'], answer: 1, explain: 'Each of the 4 units costs a command (1 µs), an interrupt (4 µs) and a copy (0.5 µs): 22 µs in all, and the rest is free.' } },
      { topic: 'io-interrupt', frame: 10, caption: 'Busy 22 µs (36%), free 40 µs. But the transfer takes 62 µs, longer than polling\'s 48: the interrupt overhead sits on the path.' },
      { topic: 'io-xfer-compare', input: { device: 2 }, frame: 2, caption: 'A fast device (2 µs a unit): 8 interrupts cost the CPU 44 µs, more than polling\'s 32.' },
      { topic: 'io-xfer-compare', frame: 5, caption: 'Swept over device speeds: interrupts cost the CPU less than polling once the device takes more than ' + xcross + ' µs a unit.' },
      { h: 'Recap' },
      { list: ['An interrupt lets the CPU work while the device does.', 'Each interrupt costs its entry, dispatch and return.', 'For a very fast device, polling can cost the CPU less.'] },
      X('ios-x-irq-busy'), X('ios-x-crossover'), X('ios-x-which'),
    ],
  });

  C.lesson({
    id: 'ios-dma', chapter: 'ios-hw', title: 'DMA', minutes: 7,
    summary: 'With direct memory access the CPU programs a DMA controller once with the address, the count and the direction, and the controller moves every unit between the device and memory itself, borrowing the bus for a cycle at a time. The CPU hears from it once, by one interrupt at the end of the block.',
    blocks: [
      'With interrupts the CPU still copies every unit out of the data register, and takes an interrupt for each. For a disk delivering thousands of units a second, that is thousands of interrupts. Could something else do the copying?',
      { def: 'DMA', text: 'direct memory access: a controller that moves data between a device and memory without the CPU, taking the bus for a cycle when it needs it (cycle stealing), and interrupting once when the whole block is done.' },
      { topic: 'io-dma', frame: 1, caption: 'The CPU programs the DMA controller: address, count of 16 bytes, direction. 5 µs.' },
      { topic: 'io-dma', frame: 3, caption: 'At 16 the DMA controller takes the bus for 0.2 µs and writes unit 0 to memory. The CPU carries on.' },
      { predict: { q: 'How many interrupts does the CPU take for the whole 16-byte transfer?', options: ['4, one a unit', '1, at the end of the block', 'none'], answer: 1, explain: 'The DMA controller was programmed for the whole block; it interrupts once when the count reaches zero.' } },
      { topic: 'io-dma', frame: 7, caption: '50.2 µs, the CPU busy only 10 µs (20%), with 1 interrupt.' },
      { topic: 'io-xfer-compare', frame: 4, caption: '32 bytes: DMA uses the least CPU, 10 µs, and is done soonest; polling uses the most, 96 µs.' },
      lab('A slow device in the Storage lab', 'A slower device and DMA blocks of 32 bytes: count the interrupts and the CPU\'s free time under each method.', { mode: 'io', ioView: 'xfer', xBytes: 64, xUnit: 8, xDevice: 40, xDmaBlock: 32 }),
      { table: [['Method', 'The CPU', 'Best for'], ['polling', 'asks until ready, then copies', 'very fast devices, tiny transfers'], ['interrupts', 'starts each unit and copies it in the handler', 'slow devices, few bytes: keyboards, serial lines'], ['DMA', 'programs the block, takes one interrupt', 'block devices: disks, networks']], caption: 'Three ways to move data.' },
      { h: 'Recap' },
      { list: ['DMA moves the data; the CPU only sets it up.', 'One interrupt per DMA block, not per unit.', 'Cycle stealing slows the CPU only slightly.'] },
      X('ios-x-dma-busy'), X('ios-x-dma-blocks'), X('ios-x-xfer-table'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: the kernel I/O subsystem
  // =========================================================================================================
  C.lesson({
    id: 'ios-buffer', chapter: 'ios-kernel', title: 'Buffering', minutes: 8,
    summary: 'Without a buffer the device reads straight into the program, and each waits for the other. With one kernel buffer the device can fill the next block while the program computes on the last, though the program must first move each block out. With two buffers (or a circular ring) the device fills one while the program empties the other, and a block costs only the slower of the two sides.',
    blocks: [
      'A program reads six blocks and computes on each. The device takes 10 per block; the program takes 6 to compute and 2 to move a block out of a buffer. If they could overlap perfectly, how long would six blocks take?',
      { topic: 'io-buffering', input: { kind: 'none' }, frame: 7, caption: 'No buffer: device and program take turns, each idle while the other works. A block costs T + C = 16; six take 96.' },
      { topic: 'io-buffering', input: { kind: 'single' }, frame: 7, caption: 'One buffer: the device fills it while the program computes, but must wait for it to be emptied. max(T, C) + M = 12 a block; 78 in all.' },
      { predict: { q: 'With two buffers, what does a block cost in the steady state?', options: ['T + C + M = 18', 'max(T, C) + M = 12', 'max(T, C + M) = 10'], answer: 2, explain: 'The device fills one buffer while the program moves and computes on the other, so the slower side sets the pace: max(10, 6 + 2) = 10.' } },
      { topic: 'io-buffering', frame: 2, caption: 'Double buffering: block 1 goes into slot 1 while the program works on block 0; it waits only 2.' },
      { topic: 'io-buffering', frame: 7, caption: '68 for six blocks, 28 saved over no buffer: in the steady state a block costs max(T, C + M) = 10.' },
      { topic: 'io-buffering', input: { kind: 'circular', fill: ['4', '16', '4', '16', '4', '16'] }, frame: 7, caption: 'A circular buffer of 4 slots, with a device that alternates fast (4) and slow (16) blocks: the slots absorb the slow ones, and six blocks still take 68.' },
      { math: 'no buffer:      T + C\nsingle buffer:  max(T, C) + M\ndouble buffer:  max(T, C + M)' },
      { tip: 'Buffers do more than overlap: they adapt a device that delivers bytes one at a time to a program that wants a line, and they keep a copy so that a write() can return before the device is done (copy semantics).' },
      lab('The four buffers side by side, in the Storage lab', 'The six blocks of this lesson, T = 10, C = 6 and M = 2, read with no buffer, one, two and a ring of 4 on one time axis. Make the device slower than the program, or give it bursts, and see which formula sets the pace.', { mode: 'io', ioView: 'buffer', bNone: true, bSingle: true, bDouble: true, bCirc: true, bSlots: 4, bBlocks: 6, bFill: [10], bMove: 2, bCompute: [6] }),
      { h: 'Recap' },
      { list: ['A buffer lets the device and the program work at once.', 'Single: max(T, C) + M a block. Double: max(T, C + M).', 'A circular buffer smooths out bursts.'] },
      X('ios-x-buf-none'), X('ios-x-buf-single'), X('ios-x-buf-double'), X('ios-x-buf-formula'),
    ],
  });

  C.lesson({
    id: 'ios-cache', chapter: 'ios-kernel', title: 'The buffer cache', minutes: 8,
    summary: 'The kernel keeps recently used disk blocks in memory. A read that finds its block there is a hit and costs no disk access; a miss reads the block in, evicting the least recently used one. Writes either go to the disk at once (write-through) or mark the block dirty and are written when it is evicted or synced (write-back), so repeated writes to one block cost one disk write.',
    blocks: [
      'A program reads a configuration block, then reads it again a moment later, then a third time. Must the disk turn three times for the same bytes?',
      { def: 'buffer cache (page cache)', text: 'disk blocks kept in memory, looked up by block number. Least recently used blocks make way for new ones.' },
      { topic: 'io-cache', frame: 4, caption: 'r1 again: a hit, and the disk is not touched.' },
      { topic: 'io-cache', frame: 13, caption: '3 slots, 8 reads cycling over 5 blocks: 1 hit and 7 misses. The working set does not fit.' },
      { predict: { q: 'Block 1 is written four times while it stays in a 3-slot cache. With write-back, how many disk writes does that cost before it is evicted?', options: ['4', '1, when it is evicted', '0: it is never written'], answer: 1, explain: 'Write-back only marks the cached block dirty. It goes to the disk once, when it is evicted (or synced).' } },
      { topic: 'io-cache', input: { ops: ['w1', 'r2', 'w1', 'w1', 'r3', 'w1', 'r4', 'r5', 'r6'] }, frame: 13, caption: 'Write-back: the four writes to block 1 cost 1 disk write.' },
      { topic: 'io-cache', input: { write: 'through', ops: ['w1', 'r2', 'w1', 'w1', 'r3', 'w1', 'r4', 'r5', 'r6'] }, frame: 13, caption: 'Write-through: 4 disk writes. Safer if the power fails, slower.' },
      { topic: 'io-cache', input: { readAhead: 1 }, frame: 27, caption: 'Read-ahead of one block on this non-sequential stream: 14 disk reads, 7 of them read-ahead, and still only 1 hit. Prefetching pays only for a sequential reader.' },
      { warn: 'A write-back cache holds data the disk does not yet have. If the power fails, those writes are lost: this is why programs call fsync, and why file systems keep journals (part 15).' },
      lab('Write-back against write-through, in the Storage lab', 'The four writes to block 1 from this lesson, through a cache of 3 blocks under both policies side by side: dirty blocks are marked, and each policy\'s disk writes are counted. Add a sync, or turn on read-ahead.', { mode: 'io', ioView: 'cache', cSize: 3, cWrite: 'both', cRa: 0, cOps: ['w1', 'r2', 'w1', 'w1', 'r3', 'w1', 'r4', 'r5', 'r6'] }),
      { h: 'Recap' },
      { list: ['A hit costs no disk access; a miss reads the block and may evict one.', 'Write-through writes at once; write-back writes a dirty block once, later.', 'Read-ahead helps sequential readers only.'] },
      X('ios-x-cache-hits'), X('ios-x-cache-writes'), X('ios-x-readahead'),
    ],
  });

  C.lesson({
    id: 'ios-spool', chapter: 'ios-kernel', title: 'Spooling', minutes: 5,
    summary: 'A printer can print only one job at a time, and printing is slow. With spooling, a program writes its job to a spool file on disk at disk speed and goes on; a daemon prints the spooled jobs one by one. The printer finishes at about the same time, but the programs are freed almost at once, and jobs never interleave on the page.',
    blocks: [
      'Three programs want to print at about the same time. If each held the printer while its pages came out, the third would wait for every page of the first two before it could even continue. Is there a better way to share a device that cannot be shared?',
      { topic: 'io-spool', frame: 3, caption: 'Holding the printer: P3 arrives at 2, waits until 10, prints until 18, held up 16.' },
      { predict: { q: 'With a spool, writing a page to disk takes 0.2. How long is P3 held up?', options: ['16, as before', '0.8: its 4 pages written to the spool', '8: its own printing'], answer: 1, explain: 'P3 only writes its 4 pages to the spool directory, 4 × 0.2 = 0.8, and goes on; the daemon prints them later.' } },
      { topic: 'io-spool', frame: 7, caption: 'Spooled: P3 is held up only 0.8; the daemon prints its job from 10.6 to 18.6.' },
      { topic: 'io-spool', frame: 8, caption: 'A mean wait of 10.333 holding the printer, 0.6 with the spool. The printer finishes at about the same time.' },
      lab('Your own print jobs, in the Storage lab', 'Four jobs and one printer, held directly and through a spool, on one time axis. Change when each job asks and how many pages it has, and compare the two mean delays.', { mode: 'io', ioView: 'spool' }),
      { h: 'Recap' },
      { list: ['A spool turns a device that cannot be shared into a queue of jobs.', 'Programs wait only for the write to disk.', 'One daemon owns the printer, so jobs never mix.'] },
      X('ios-x-spool'), X('ios-x-spool-why'),
    ],
  });

  C.lesson({
    id: 'ios-queue', chapter: 'ios-kernel', title: 'The request queue: merging and the elevator', minutes: 8,
    summary: 'The block layer collects requests before the driver sends them to the device. Requests for neighbouring sectors of the same kind merge into one (a back merge appends, a front merge prepends), so the device does one larger transfer. An I/O scheduler then picks the order: arrival order, a LOOK-style sweep, or a sweep with deadlines so no read waits too long.',
    blocks: [
      'Two processes read neighbouring sectors, 100 to 107 and 108 to 115, a moment apart. Should the disk do two transfers, with a rotation lost between them, or one?',
      { def: 'merging', text: 'a request contiguous with one already queued, and of the same kind (read or write), joins it: a back merge if it follows it, a front merge if it comes just before it.' },
      { topic: 'io-block-queue', frame: 2, caption: 'Request 1 (108–115) is appended to request 0 (100–107): a back merge, one request for 100–115.' },
      { topic: 'io-block-queue', frame: 12, caption: 'LOOK with merging: 6 requests become 5 dispatches; the head travels 572 sectors, the mean wait is 6.784.' },
      { predict: { q: 'The same requests with no elevator: dispatched in arrival order (noop). Will the head travel more or less?', options: ['Less: no sweeping back', 'More: it goes wherever the next request is', 'The same: there are only 6 requests'], answer: 1, explain: 'In arrival order the head goes from 115 down to 20, up to 300, down to 92 and up again to 116: 700 sectors, against 572 for LOOK.' } },
      { topic: 'io-block-queue', input: { elevator: 'noop' }, frame: 12, caption: 'noop: 700 sectors travelled, mean wait 7.732.' },
      { topic: 'io-block-queue', input: { elevator: 'deadline' }, frame: 12, caption: 'deadline: an upward sweep that first serves any read older than its expiry. 630 sectors, mean wait 6.928.' },
      { tip: 'The elevator here is the disk arm\'s sweep from part 12, applied to sector numbers. On a solid-state drive, where there is no arm, kernels often use noop and keep only the merging.' },
      lab('The block queue, in the Storage lab', 'Eight requests from four processes through noop, look and deadline side by side, with merging: each dispatch is drawn on the disk\'s time line. Turn merging off, or shorten a read\'s expiry, and watch the waits change.', { mode: 'io', ioView: 'queue', qNoop: true, qLook: true, qDeadline: true, qMerge: true }),
      lab('Requests arriving over time, in the Storage lab', 'A table of requests with arrival times, served by SSTF, LOOK and C-SCAN side by side: watch how arrivals near the head keep a far request waiting.', Object.assign({ mode: 'disk', dSrc: 'table', dStart: 175 }, pols(['sstf', 'look', 'cscan']))),
      { h: 'Recap' },
      { list: ['Contiguous requests of the same kind merge.', 'The elevator orders the dispatches; a deadline bounds the wait.', 'On flash, merging still pays; sweeping does not.'] },
      X('ios-x-merge'), X('ios-x-elevator'), X('ios-x-queue-table'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: from a call to the device and back
  // =========================================================================================================
  C.lesson({
    id: 'ios-modes', chapter: 'ios-path', title: 'Blocking, non-blocking and asynchronous', minutes: 8,
    summary: 'A blocking read puts the process to sleep until the data is in. A non-blocking read returns at once, with the data or with "not yet", and the process must try again. An asynchronous read starts the transfer and returns; the process works on and is told when the data has arrived. They differ in when the caller can work and how many system calls it makes.',
    blocks: [
      'Process A needs data from a device that takes 30 µs, but it also has 20 µs of work that does not need the data. Process B just computes. Must A sit idle while the device works?',
      { topic: 'io-modes', frame: 5, caption: 'Blocking: A sleeps through the device\'s 30 µs and finishes at 66; B, which ran meanwhile, at 76. One system call.' },
      { topic: 'io-modes', input: { mode: 'nonblocking' }, frame: 9, caption: 'Non-blocking: A finishes at 48, but makes 7 system calls, 5 of them retries that found nothing.' },
      { predict: { q: 'Asynchronous: A starts the read, does its 20 µs of work, and is notified when the data is in. When does A finish?', options: ['66, as blocking', '48, like non-blocking but with fewer calls', '30'], answer: 1, explain: 'A works while the device does, as with non-blocking, but needs only 2 system calls: aio_read to start the read, and aio_suspend to wait for the data once its own work runs out.' } },
      { topic: 'io-modes', input: { mode: 'async' }, frame: 6, caption: 'Asynchronous: A finishes at 48 with 2 system calls; B at 80.' },
      { topic: 'io-modes-compare', frame: 4, caption: 'A is done soonest with the non-blocking and asynchronous reads (48); the pair is done soonest with blocking (76), since A\'s retries take CPU from B.' },
      lab('Blocking against asynchronous in the Storage lab', 'The I/O workbench: the three reads side by side on one CPU. Make the device slower, or A\'s own work longer, and watch who wins.', { mode: 'io', ioView: 'modes' }),
      { table: [['Read', 'Returns', 'The caller'], ['blocking', 'when the data is in', 'sleeps meanwhile'], ['non-blocking', 'at once: data, or EAGAIN', 'must try again'], ['asynchronous', 'at once; notified later', 'works meanwhile']], caption: 'Three ways to ask for data.' },
      { h: 'Recap' },
      { list: ['Blocking: simplest, the caller sleeps.', 'Non-blocking: no sleep, but retries cost system calls and CPU.', 'Asynchronous: overlap without retries.'] },
      X('ios-x-modes-table'), X('ios-x-nonblock'), X('ios-x-mode-pick'),
    ],
  });

  C.lesson({
    id: 'ios-read', chapter: 'ios-path', title: 'The life of a read', minutes: 9,
    summary: 'A read() goes from the C library through a trap into the kernel; the VFS finds the open file and its offset; the page cache is asked for each block; misses are mapped by the file system to disk blocks and handed to the block layer as requests; the driver programs the controller and the process sleeps. When the disk is done, the interrupt handler completes the request and wakes the process, which copies the data out and returns. Almost all the time is the disk.',
    blocks: [
      'A program calls read(fd, buf, 4096). About four milliseconds later it has its data. What happened in between, and in which part of the system?',
      { topic: 'io-life-of-read', frame: 4, caption: 'The VFS finds descriptor 3, its open-file entry with offset 0, and the inode of notes.txt.' },
      { topic: 'io-life-of-read', frame: 5, caption: 'The page cache does not hold block 0: a disk read is needed.' },
      { topic: 'io-life-of-read', frame: 8, caption: 'The driver sets up DMA, writes the sector and count into the controller\'s registers, and starts it. The process sleeps.' },
      { predict: { q: 'The disk took 4.333 ms. How long did the software of every layer take, together?', options: ['about as long', 'about a tenth of it', 'a few microseconds: about 11 µs'], answer: 2, explain: 'The software took 11.3 µs of the 4344.633 µs: the disk is about four hundred times slower than all the layers together.' } },
      { topic: 'io-life-of-read', frame: 17, caption: '4344.633 µs in all: 4333.333 µs on the disk and 11.3 µs in software.' },
      { topic: 'io-life-of-read', input: { cached: 'all' }, frame: 9, caption: 'The same read with the block in the page cache: 2 µs, all in software.' },
      { topic: 'io-life-of-read', input: { bytes: 12288, layout: 'scattered' }, frame: 7, caption: 'Three blocks scattered on the disk: 3 requests, where contiguous blocks would merge into one.' },
      { h: 'Device drivers' },
      { def: 'device driver', text: 'the kernel code that knows one kind of controller. Its top half starts a request when the kernel asks; its bottom half runs on the interrupt when the device is done. The rest of the kernel sees only a uniform interface.' },
      { topic: 'io-driver', frame: 8, caption: 'The driver ran 5 µs of the 4344.633: a quick part to start the device and a quick part on its interrupt.' },
      lab('A read of your own in the Storage lab', 'Choose the bytes, the offset, the block size, which blocks are cached and where each lives on disk, and follow the read layer by layer.', { mode: 'io', ioView: 'read', rdBytes: 8192, rdOffset: 0, rdBlock: 4096, rdCached: ['hit', 'miss'], rdDisk: [9120, 9121, 9122, 9123] }),
      { h: 'Recap' },
      { list: ['user → C library → trap → VFS → page cache → file system → block layer → driver → controller.', 'The process sleeps while the device works, and the interrupt wakes it.', 'A cached read never reaches the disk.', 'The driver hides the controller behind a uniform interface.'] },
      X('ios-x-layer'), X('ios-x-read-blocks'), X('ios-x-driver'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
