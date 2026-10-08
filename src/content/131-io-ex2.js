// Part 13, I/O systems: the exercises of chapter 2 (the buffer cache, spooling, the request queue) and chapter 3
// (blocking, non-blocking and asynchronous reads; the life of a read and the driver). Every number in a text, an
// answer or a hint is worked out here by the engines (S.IO, S.Storage): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, IO = S.IO;
  if (!C || !IO || C.exercises.has('ios-x-cache-hits')) return;
  const fx = (v, d) => { const p = Math.pow(10, d === undefined ? 3 : d); return String(Math.round(v * p) / p); };
  const ops = (s) => s.split(' ').map((t) => ({ op: t[0], block: +t.slice(1) }));

  // =========================================================================================================
  // Chapter 2: the buffer cache
  // =========================================================================================================
  const HS = 'r8 r3 r8 r5 r2 r3 r8 r5 r9 r8', hc = IO.cache({ size: 3, write: 'back', readAhead: 0 }, ops(HS));
  const hitAt = hc.steps.filter((s) => s.kind === 'hit').map((s) => s.block);
  C.exercise({ id: 'ios-x-cache-hits', chapter: 'ios-kernel', title: 'Hits in a small cache', level: 2, kind: 'number',
    text: ['A buffer cache holds 3 blocks and evicts the least recently used. It starts empty, and these reads arrive: `' + HS + '` (r8 reads block 8). How many of the ' + hc.steps.filter((s) => s.kind === 'hit' || s.kind === 'miss').length + ' reads are hits?'],
    answer: hc.stats.hits,
    whyNot: { '4': 'Block 8 and block 5 are not both still cached each time they come back: track the three most recently used blocks after every read.', [String(hc.stats.misses)]: 'That is the number of misses.', '*': 'Write the cache\'s contents after each read, most recent last.' },
    hints: ['After r8 r3 r8 the cache holds 3 and 8 (8 most recent); r5 fills the third slot.', 'r2 evicts 3, the least recently used; then r3 evicts 8, and r8 evicts 5. A short loop over four blocks keeps pushing out the one about to be needed.', 'Hits: ' + hitAt.map((b) => 'r' + b).join(' and ') + ', so ' + hc.stats.hits + ' hits and ' + hc.stats.misses + ' misses.'],
    solution: hc.stats.hits, wrong: [4, hc.stats.misses] });

  const WS = 'w6 r2 w6 r4 w6 w2 r7 r9 w6';
  const WB = IO.cache({ size: 3, write: 'back' }, ops(WS)), WT = IO.cache({ size: 3, write: 'through' }, ops(WS));
  const wrows = ['write-back', 'write-through'], wcols = ['disk reads', 'disk writes'];
  const wv = { 'write-back': WB.stats, 'write-through': WT.stats };
  const wval = (r, c) => (c === 'disk reads' ? wv[r].diskReads : wv[r].diskWrites);
  const wcells = (f) => Object.fromEntries(wrows.flatMap((r) => wcols.map((c) => [r + '|' + c, f(r, c)])));
  const dirtyOut = WB.steps.filter((s) => s.kind === 'flush').map((s) => s.block);
  C.exercise({ id: 'ios-x-cache-writes', chapter: 'ios-kernel', title: 'Write-back against write-through', level: 3, kind: 'table',
    text: ['A buffer cache of 3 blocks, least recently used out, starts empty. The operations are `' + WS + '` (w6 writes the whole of block 6, r2 reads block 2). A read miss reads the block from disk; a write miss puts the block in the cache without reading it, since the whole block is overwritten.',
      'Write-through sends every write to the disk at once. Write-back marks the block dirty and writes it to disk only when it is evicted. Count the disk reads and writes each causes during these operations (blocks still dirty in the cache at the end are not counted).'],
    rows: wrows, cols: wcols, corner: 'policy', cells: wcells(wval), cellKind: 'number',
    hints: ['Reads are the same either way: every read miss. Writes differ.', 'Write-through: one disk write for each w. Write-back: one for each dirty block evicted.', 'Write-back writes blocks ' + dirtyOut.join(' and ') + ' when they are evicted: ' + WB.stats.diskWrites + ' writes; write-through ' + WT.stats.diskWrites + '. Both read ' + WB.stats.diskReads + ' blocks.'],
    solution: wcells(wval),
    wrong: [wcells((r, c) => (r === 'write-back' && c === 'disk writes' ? WB.stats.diskWrites + 1 : wval(r, c))), wcells((r, c) => (c === 'disk reads' ? WB.stats.misses : wval(r, c)))] });

  const RS = 'r10 r11 r12 r13 r40 r41 r42', RA = IO.cache({ size: 4, write: 'back', readAhead: 1 }, ops(RS)), R0 = IO.cache({ size: 4, write: 'back', readAhead: 0 }, ops(RS));
  C.exercise({ id: 'ios-x-readahead', chapter: 'ios-kernel', title: 'Reading ahead', level: 2, kind: 'number',
    text: ['A cache of 4 blocks starts empty and serves the reads `' + RS + '`. On every read miss it also loads the next block (read-ahead of one), unless that block is already cached. How many of the 7 reads are hits?'],
    answer: RA.stats.hits,
    whyNot: { [String(R0.stats.hits)]: 'That is without read-ahead: here each miss also brings in the next block.', '7': 'Read-ahead brings in one block on a miss, so the block after it misses again.', '*': 'Follow the cache: a miss on block b loads b and b + 1.' },
    hints: ['r10 misses and loads 10 and 11; r11 then hits.', 'A hit does not read ahead, so r12 misses and loads 12 and 13.', 'Hits on r11, r13 and r41: ' + RA.stats.hits + ' of 7, with ' + RA.stats.diskReads + ' blocks read from disk (' + RA.stats.prefetches + ' of them ahead). Without read-ahead, ' + R0.stats.hits + ' hits.'],
    solution: RA.stats.hits, wrong: [R0.stats.hits, 7] });

  // =========================================================================================================
  // Chapter 2: spooling
  // =========================================================================================================
  const JOBS = [{ proc: 'A', at: 0, pages: 4 }, { proc: 'B', at: 1, pages: 2 }, { proc: 'C', at: 3, pages: 3 }];
  const SP = IO.spool(JOBS, { pageTime: 3, spoolTime: 0.25 }), md = +fx(SP.direct.meanDelay, 2);
  C.exercise({ id: 'ios-x-spool', chapter: 'ios-kernel', title: 'Held up by the printer', level: 2, kind: 'number',
    text: ['Three processes print with no spool: each holds the printer while its own pages print (3 time units a page), waiting first if the printer is busy, and only then goes on. A asks at time 0 with 4 pages, B at 1 with 2 pages, C at 3 with 3 pages. On average, how long is a process held up from asking to going on? Two decimals.'],
    answer: md, tolerance: 0.006,
    whyNot: { [fx(SP.spooled.meanDelay, 2)]: 'That is with a spool, where a process only writes its pages to disk.', '9': 'That is the mean printing time alone; B and C also wait for the printer.', '*': 'For each process: when its printing ends, minus when it asked.' },
    hints: ['A prints from 0 to 12. B, waiting since 1, prints from 12 to 18.', 'C, waiting since 3, prints from 18 to 27.', 'Held up ' + SP.direct.jobs.map((j) => j.proc + ' ' + j.delay).join(', ') + ': mean ' + fx(SP.direct.meanDelay) + '. With a spool (0.25 a page to disk) the mean is ' + fx(SP.spooled.meanDelay, 2) + '.'],
    solution: md, wrong: [+fx(SP.spooled.meanDelay, 2), 9] });

  C.exercise({ id: 'ios-x-spool-why', chapter: 'ios-kernel', title: 'What a spool buys', level: 1, kind: 'choice',
    text: ['With a spool, a print daemon prints the jobs one at a time from files on disk. Compared with each process holding the printer, what changes?'],
    options: ['The printer finishes much sooner', 'The processes go on almost at once, and jobs never interleave on paper', 'The jobs print in a better order', 'The printer can print two jobs at once'],
    answer: 1, whyNot: { 0: 'The printer prints the same pages at the same speed; it finishes at about the same time.', 2: 'The daemon prints them in the order they were spooled.', 3: 'A printer still prints one page at a time.' },
    hints: ['Whose waiting does the spool remove: the printer\'s or the processes\'?', 'A process now only writes its job to a file, at disk speed.', 'The processes are freed almost at once, and only the daemon touches the printer, so pages of different jobs never mix.'],
    solution: 1, wrong: [0, 2] });

  // =========================================================================================================
  // Chapter 2: the request queue
  // =========================================================================================================
  const RQ = [[400, 'r'], [80, 'r'], [408, 'r'], [250, 'w'], [72, 'r'], [600, 'r'], [258, 'w']].map(([sector, op]) => ({ at: 0, sector, count: 8, op }));
  const BQ = IO.blockQueue(RQ, { elevator: 'look', merge: true, start: 300 });
  const rqText = 'Seven requests of 8 sectors each reach the block layer at once, in this order: ' + RQ.map((r, i) => i + ': ' + (r.op === 'r' ? 'read' : 'write') + ' ' + r.sector + '–' + (r.sector + 7)).join('; ') + '. Requests merge when they are of the same kind and their sectors run on from one another.';
  C.exercise({ id: 'ios-x-merge', chapter: 'ios-kernel', title: 'How many go to the disk?', level: 1, kind: 'number',
    text: [rqText, 'After merging, how many requests are dispatched to the disk?'],
    answer: BQ.totals.dispatches,
    whyNot: { [String(RQ.length)]: 'Some of them merge: look for sectors that run on from another request of the same kind.', [String(BQ.totals.merges)]: 'That is the number of merges; count the requests left after them.', '*': 'Pair up requests whose sectors are next to each other and whose kind matches.' },
    hints: ['400–407 and 408–415 are both reads, and touch: a back merge.', '72–79 runs into 80–87 (a front merge), and the writes 250–257 and 258–265 touch too.', BQ.totals.merges + ' merges: ' + RQ.length + ' requests go out as ' + BQ.totals.dispatches + '.'],
    solution: BQ.totals.dispatches, wrong: [RQ.length, BQ.totals.merges] });

  const EQ = [400, 80, 250, 600, 72, 330], ex = { kind: 'disk-order', policy: 'look', dir: 'up', requests: EQ, start: 300, cylinders: 1000, ask: 'both' };
  const er = S.Storage.schedule('look', { requests: EQ, start: 300, cylinders: 1000, dir: 'up' });
  ex.solution = S.Check.kinds['disk-order'].solve(ex);
  C.exercise(Object.assign(ex, { id: 'ios-x-elevator', chapter: 'ios-kernel', title: 'The elevator on sector numbers', level: 2,
    text: ['An I/O scheduler sorts requests by their first sector, like a disk arm sweeping across cylinders. The last request ended at sector 300 and the sweep was moving up. Six requests wait, starting at sectors ' + EQ.join(', ') + ' (the form below calls the sector numbers cylinders). With a LOOK elevator, in what order are they dispatched, and how far does the head travel in sectors, counting each move from one request\'s first sector to the next?'],
    hints: ['Sweep up from 300 first: 330, 400, 600.', 'Nothing waits above 600, so the sweep turns and serves 250, 80, 72 on the way down.', er.served.map((s) => s.cyl).join(', ') + ': (600 − 300) + (600 − 72) = ' + er.totals.movement + ' sectors.'],
    wrong: [{ order: EQ.join(', '), movement: String(er.totals.movement) }, { order: er.served.map((s) => s.cyl).join(', '), movement: String(er.totals.movement + 2 * (999 - 600)) }] }));

  const drows = BQ.dispatched.map((_, i) => 'dispatch ' + (i + 1)), dcols = ['first sector', 'sectors'];
  const dval = (i, c) => (c === 'first sector' ? BQ.dispatched[i].sector : BQ.dispatched[i].count);
  const dcells = (f) => Object.fromEntries(drows.flatMap((r, i) => dcols.map((c) => [r + '|' + c, f(i, c)])));
  C.exercise({ id: 'ios-x-queue-table', chapter: 'ios-kernel', title: 'Merge, then sweep', level: 3, kind: 'table',
    text: [rqText, 'The head was last at sector 300, moving up, and the elevator is LOOK: it sweeps up serving the nearest request ahead, and turns when nothing waits ahead. All the merging happens before the first dispatch. Give each dispatch\'s first sector and its length in sectors.'],
    rows: drows, cols: dcols, corner: 'dispatch', cells: dcells(dval), cellKind: 'number',
    hints: ['First merge: the reads 400–415, the reads 72–87, the writes 250–265; the read at 600 stays alone.', 'From 300 upwards: 400, then 600. Then the sweep turns.', BQ.dispatched.map((d, i) => (i + 1) + ': ' + d.sector + ' (' + d.count + ' sectors)').join('; ') + '.'],
    solution: dcells(dval),
    wrong: [dcells((i, c) => (c === 'sectors' ? 8 : dval(i, c))), dcells((i, c) => (c === 'first sector' && i === 3 ? 80 : dval(i, c)))] });

  // =========================================================================================================
  // Chapter 3: blocking, non-blocking and asynchronous
  // =========================================================================================================
  const MO = { device: 40, work: 25, use: 10, other: 50, syscall: 2, copy: 3, slice: 6, notify: 2, irq: 1 }, MM = IO.modes(MO);
  const moText = 'Process A reads from a device that takes ' + MO.device + ' µs. A also has ' + MO.work + ' µs of work that does not need the data and ' + MO.use + ' µs that does. Process B computes for ' + MO.other + ' µs and runs whenever A cannot; A has the higher priority. A system call costs ' + MO.syscall + ' µs, the kernel copies the data in ' + MO.copy + ' µs, the device\'s completion interrupt costs ' + MO.irq + ' µs.';
  const mrows = [['blocking', 'blocking'], ['non-blocking', 'nonblocking'], ['asynchronous', 'async']], mcols = ['A finishes at', 'system calls by A'];
  const mval = (k, c) => (c === mcols[0] ? MM[k].finishA : MM[k].syscalls);
  const mcells = (f) => Object.fromEntries(mrows.flatMap(([r, k]) => mcols.map((c) => [r + '|' + c, f(k, c)])));
  C.exercise({ id: 'ios-x-modes-table', chapter: 'ios-path', title: 'Three reads, timed', level: 3, kind: 'table',
    text: [moText, 'Blocking: read() starts the device and A sleeps until the data is copied in, then does all its work. Non-blocking: each read() starts or checks the device and returns at once; A does ' + MO.slice + ' µs of its work between tries, and once its own work is done it retries back to back. Asynchronous: aio_read starts the device and returns, and A works; if A\'s own work runs out before the data has arrived, it waits for it in aio_suspend(), a second system call. At completion the kernel copies the data and A\'s notification runs (' + MO.notify + ' µs). For each, when does A finish, and how many system calls does it make?'],
    rows: mrows.map((m) => m[0]), cols: mcols, corner: 'read', cells: mcells(mval), cellKind: 'number',
    hints: ['Blocking: 2 µs call, ' + MO.device + ' µs asleep, the interrupt and the copy, then ' + (MO.work + MO.use) + ' µs of work.', 'Non-blocking: count the tries. The data arrives at ' + (MO.syscall + MO.device) + ' µs; the try after that gets it.', mrows.map(([r, k]) => r + ': A at ' + MM[k].finishA + ' with ' + MM[k].syscalls + ' calls').join('; ') + '. B finishes at ' + mrows.map(([, k]) => MM[k].finishB).join(', ') + '.'],
    solution: mcells(mval),
    wrong: [mcells((k, c) => (k === 'async' && c === mcols[1] ? 1 : mval(k, c))), mcells((k, c) => (k === 'blocking' && c === mcols[0] ? MO.syscall + MO.device + MO.work + MO.use : mval(k, c)))] });

  const NO = Object.assign({}, MO, { device: 30, work: 12, slice: 4 }), NB = IO.mode('nonblocking', NO);
  C.exercise({ id: 'ios-x-nonblock', chapter: 'ios-path', title: 'Counting the retries', level: 2, kind: 'number',
    text: ['Process A reads with O_NONBLOCK from a device that takes ' + NO.device + ' µs. Each read() costs ' + NO.syscall + ' µs; the first starts the device, and each that finds no data returns EAGAIN. Between tries A does ' + NO.slice + ' µs of its own work, of which it has ' + NO.work + ' µs; once that is done it retries back to back. Process B runs only when A cannot. How many read() calls does A make in all, the successful one included?'],
    answer: NB.syscalls,
    whyNot: { [String(NB.retries)]: 'That counts only the fruitless retries; add the first call and the one that gets the data.', '1': 'That is a blocking read; a non-blocking one returns at once and must be repeated.', '*': 'Track the time: each try is ' + NO.syscall + ' µs, then work or another try.' },
    hints: ['The device is done ' + NO.device + ' µs after the first call ends, at ' + (NO.syscall + NO.device) + ' µs.', 'A alternates a ' + NO.syscall + ' µs try with ' + NO.slice + ' µs of work until its ' + NO.work + ' µs are used, then tries back to back.', NB.syscalls + ' calls: the first, ' + NB.retries + ' retries that found nothing, and the one that gets the data.'],
    solution: NB.syscalls, wrong: [NB.retries, 1] });

  C.exercise({ id: 'ios-x-mode-pick', chapter: 'ios-path', title: 'An editor that must not freeze', level: 1, kind: 'choice',
    text: ['A text editor saves a large file over a slow network while the user keeps typing. The typing must never stall. Which kind of write suits it best?'],
    options: ['A blocking write in the editor\'s only thread', 'An asynchronous write, with a notification when it is done', 'A non-blocking write retried in a tight loop'],
    answer: 1, whyNot: { 0: 'The only thread would sleep until the network finished: the typing stalls.', 2: 'A tight loop of retries keeps the CPU busy and the thread from handling keys.' },
    hints: ['The editor\'s thread must stay free to handle keys.', 'It wants to start the write, carry on, and be told later.', 'Asynchronous I/O: aio_write returns at once and the completion is signalled. (A second thread doing a blocking write is the other common answer.)'],
    solution: 1, wrong: [0, 2] });

  // =========================================================================================================
  // Chapter 3: the life of a read
  // =========================================================================================================
  C.exercise({ id: 'ios-x-layer', chapter: 'ios-path', title: 'Who knows it is in memory?', level: 1, kind: 'choice',
    text: ['On the way down from read(), which layer finds that a file block is already in memory, so no disk request is needed?'],
    options: ['the C library', 'the VFS', 'the page cache', 'the device driver'],
    answer: 2, whyNot: { 0: 'The C library only makes the system call.', 1: 'The VFS finds the open file, its offset and its inode; it asks the page cache for the blocks.', 3: 'The driver is only reached when there is a request for the device.' },
    hints: ['Which layer holds file blocks in memory?', 'The VFS asks it for each block the read covers.', 'The page cache: a hit is copied straight to the user buffer, and the layers below are never visited.'],
    solution: 2, wrong: [1, 3] });

  const RO = { bytes: 10000, offset: 3000, blockSize: 4096, cached: [true, false, false, true], blocks: [700, 701, 702, 900] };
  const LR = IO.lifeOfRead(RO), blk = LR.steps.find((s) => s.layer === 'block');
  const nreq = blk ? (/one request/.test(blk.say) ? 1 : +(/(\d+) requests/.exec(blk.say) || [0, 0])[1]) : 0;
  const lrows = ['file blocks the read covers', 'blocks found in the page cache', 'blocks read from disk', 'requests sent to the disk'];
  const lv = [LR.blocks.length, LR.blocks.length - LR.misses.length, LR.misses.length, nreq];
  const lcells = (f) => Object.fromEntries(lrows.map((r, i) => [r + '|count', f(i)]));
  C.exercise({ id: 'ios-x-read-blocks', chapter: 'ios-path', title: 'Which blocks reach the disk?', level: 2, kind: 'table',
    text: ['A program reads ' + RO.bytes + ' bytes from offset ' + RO.offset + ' of a file whose blocks are ' + RO.blockSize + ' bytes. File blocks 0 and 3 are in the page cache; blocks 1 and 2 are not. The file\'s blocks 0 to 3 live on disk blocks ' + RO.blocks.join(', ') + '. Misses on disk blocks that follow each other go to the disk as one request.'],
    rows: lrows, cols: ['count'], corner: '', cells: lcells((i) => lv[i]), cellKind: 'number',
    hints: ['The read covers bytes ' + RO.offset + ' to ' + (RO.offset + RO.bytes - 1) + ': divide both ends by ' + RO.blockSize + '.', 'That is file blocks ' + LR.blocks[0] + ' to ' + LR.blocks[LR.blocks.length - 1] + '; blocks 1 and 2 miss, on disk blocks 701 and 702.', lrows.map((r, i) => r + ': ' + lv[i]).join('; ') + '. ' + blk.say],
    solution: lcells((i) => lv[i]),
    wrong: [lcells((i) => (i === 0 ? 3 : lv[i])), lcells((i) => (i === 3 ? 2 : lv[i]))] });

  C.exercise({ id: 'ios-x-driver', chapter: 'ios-path', title: 'The two halves of a driver', level: 1, kind: 'choice',
    text: ['A disk driver has a part the kernel calls to start a request and a part that runs when the disk interrupts. Which of these belongs in the interrupt part?'],
    options: ['Choosing which file block to read', 'Acknowledging the controller and marking the request done, then waking the sleeping process', 'Copying the data into the user\'s buffer', 'Looking up the file\'s inode'],
    answer: 1, whyNot: { 0: 'That is the file system\'s job, long before the driver is called.', 2: 'The process does that itself in the kernel once it runs again, back in read().', 3: 'That is the VFS and the file system, on the way down.' },
    hints: ['The interrupt part runs when the device has finished, in no process\'s context.', 'It must be quick: it settles the device and hands the result on.', 'Acknowledge the interrupt, complete the request, and wake whoever sleeps on it; the woken process copies the data out itself.'],
    solution: 1, wrong: [0, 2] });
})(globalThis.Proses = globalThis.Proses || {});
