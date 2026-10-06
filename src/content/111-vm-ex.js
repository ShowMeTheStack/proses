// Part 11, virtual memory: the exercises of chapter 1 (the fault path, what faults cost, copy-on-write and mapped
// files) and chapter 2 (replacement tables, the clock family, Belady's anomaly, reference strings, FIFO in C). Every
// number in a text, an answer or a hint is worked out here by the engines (S.VM, S.Mem): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, V = S.VM, M = S.Mem;
  if (!C || !V || !M || C.exercises.has('vm-x-fault-order')) return;
  const solve = (x) => S.Check.kinds[x.kind].solve(x);
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const us = (v) => String(+v.toFixed(2));

  // =========================================================================================================
  // Chapter 1: the fault path and its cost
  // =========================================================================================================
  C.exercise({ id: 'vm-x-fault-order', chapter: 'vm-demand', title: 'The steps of a page fault', level: 1, kind: 'choice',
    text: ['A process reads a page that is legal but not in memory. No frame is free, and the victim is dirty. In which order do these happen?'],
    options: ['trap; check the address; choose a victim; write the victim to swap; read the page in; update the entry; restart the instruction',
      'trap; read the page in; choose a victim; write the victim to swap; update the entry; restart the instruction',
      'check the address; trap; choose a victim; read the page in; write the victim to swap; restart the instruction; update the entry',
      'trap; choose a victim; check the address; read the page in; update the entry; write the victim to swap; restart the instruction'],
    answer: 0, whyNot: { 1: 'The page cannot be read in before there is a frame to read it into.', 2: 'The kernel only runs after the trap, and a dirty victim must reach swap before its frame is overwritten.', 3: 'An illegal address must be caught before any frame is taken, and the victim\'s writes would be lost if the new page overwrote its frame first.' },
    hints: ['Nothing happens in the kernel until the MMU traps.', 'The frame must be free (its old contents saved, if dirty) before the new page is read into it.', V.faultPath({ page: 4, legal: true, freeFrame: null, victim: { page: 3, frame: 2, dirty: true }, source: 'swap' }).steps.map((s) => s.say + '.').join(' ')],
    solution: 0, wrong: [1, 3] });

  const FPC = Object.assign({}, V.COSTS, { read: 6000, writeBack: 6000 });
  const fpD = V.faultPath({ page: 7, write: true, legal: true, freeFrame: null, victim: { page: 2, frame: 5, dirty: true }, source: 'swap', costs: FPC });
  const fpC = V.faultPath({ page: 7, write: true, legal: true, freeFrame: null, victim: { page: 2, frame: 5, dirty: false }, source: 'swap', costs: FPC });
  C.exercise({ id: 'vm-x-fault-cost', chapter: 'vm-demand', title: 'What one fault costs', level: 2, kind: 'number',
    text: ['A process writes page 7, which is in swap. No frame is free; the policy picks page 2, which is dirty. The costs: the trap 1 µs, checking the memory map 0.5 µs, choosing the victim 1 µs, writing a page to swap 6 ms, reading a page from swap 6 ms, updating the entry 0.2 µs, restarting 1 µs. How long does the fault take, in µs?'],
    answer: fpD.total, tolerance: 0.01, whyNot: { [us(fpC.total)]: 'That leaves out the write-back: page 2 is dirty, so it must reach swap before its frame is reused.', '12000': 'That is only the two disk transfers; the kernel\'s own steps add a few µs.', '*': 'Add up every step: trap, check, victim, write-back, read, update, restart.' },
    hints: ['A dirty victim adds a write to swap before the read.', 'The disk: 6000 + 6000 µs. The kernel: 1 + 0.5 + 1 + 0.2 + 1 µs.', fpD.steps.map((s) => s.kind + ' ' + s.cost).join(' + ') + ' = ' + us(fpD.total) + ' µs. With a clean victim it would be ' + us(fpC.total) + ' µs.'],
    solution: fpD.total, wrong: [fpC.total, 12000] });

  const E1 = V.eat({ mem: 0.1, fault: 6000, p: 0.00002 }), e1 = +E1.us.toFixed(3);
  C.exercise({ id: 'vm-x-eat', chapter: 'vm-demand', title: 'Memory with faults in it', level: 1, kind: 'number',
    text: ['A memory access takes 0.1 µs and a page fault 6 ms. One access in 50000 faults (p = 0.00002). What is the effective access time, in µs? Give 3 decimals.'],
    answer: e1, tolerance: 0.0006, whyNot: { '0.1': 'That ignores the faults: each one costs 60000 accesses\' worth of time.', '0.12': 'That is only the fault term; add (1 − p) × 0.1 µs.', '*': 'EAT = (1 − p) × 0.1 µs + p × 6000 µs.' },
    hints: ['Write 6 ms as 6000 µs.', 'p × 6000 = 0.00002 × 6000 = 0.12 µs; (1 − p) × 0.1 is a hair under 0.1 µs.', E1.say],
    solution: e1, wrong: [0.1, 0.12] });

  const pMax = V.maxFaultRate({ mem: 0.1, fault: 6000, slowdown: 0.05 }), nMin = Math.ceil(1 / pMax);
  C.exercise({ id: 'vm-x-max-rate', chapter: 'vm-demand', title: 'How rare must faults be?', level: 3, kind: 'number',
    text: ['On the same machine (memory 0.1 µs, a fault 6 ms), the effective access time may be at most 5% above a memory access. If one access in N faults, what is the smallest whole N that keeps within it?'],
    answer: nMin, tolerance: 1, whyNot: { '60000': 'That is the ratio of a fault to an access; with one fault in 60000 accesses the time doubles.', '1200000': 'Close: the fault term is p × (6000 − 0.1) µs, not p × 6000.', '*': 'Solve (1 − p) × 0.1 + p × 6000 ≤ 1.05 × 0.1 for p, then N = 1 / p, rounded up.' },
    hints: ['The extra time over 0.1 µs is p × (6000 − 0.1) µs, and it may be at most 5% of 0.1 µs, 0.005 µs.', 'p ≤ 0.005 / 5999.9 = ' + pMax.toExponential(4) + '.', 'N ≥ 1 / p = ' + (1 / pMax).toFixed(1) + ', so N = ' + nMin + ': at most one fault in about 1.2 million accesses.'],
    solution: nMin, wrong: [60000, 600000] });

  const DREFS = ['1w', '2', '3', '1', '4', '2w', '5', '1', '3', '4w', '2', '5'];
  const dr = DREFS.map((t) => (t.endsWith('w') ? { page: +t.slice(0, -1), write: true } : +t));
  const dm = V.demand({ refs: dr, frames: 3, policy: 'fifo', anon: [4, 5] });
  const wbs = dm.run.steps.filter((s) => s.writeBack).map((s) => 'page ' + s.victim + ' at reference ' + (s.i + 1));
  C.exercise({ id: 'vm-x-demand', chapter: 'vm-demand', title: 'Write-backs under FIFO', level: 2, kind: 'number',
    text: ['A process with 3 frames, all empty at first, makes the references `' + DREFS.join(' ') + '` (w marks a write, which sets the page\'s dirty bit). FIFO picks the victims. How many dirty pages are written back to swap?'],
    answer: dm.writeBacks, whyNot: { [String(DREFS.filter((t) => t.endsWith('w')).length)]: 'That counts the writes; a page is written back only if it is evicted while dirty.', '0': 'A dirty page that FIFO evicts must be written back.', '*': 'Run FIFO; at each eviction, ask whether the victim was written since it was loaded.' },
    hints: ['A page becomes dirty when written; loading it again starts it clean.', 'Run FIFO with 3 frames first: ' + dm.faults + ' faults in all.', 'Dirty victims: ' + list(wbs) + ': ' + dm.writeBacks + ' write-backs.'],
    solution: dm.writeBacks, wrong: [DREFS.filter((t) => t.endsWith('w')).length, 0] });

  // ---- copy-on-write and mapped files ---------------------------------------------------------------------------
  const cw = V.cow(), cst = [];
  const CS = [['spawn', 1, [10, 20, 30, 'zero', 50]], ['fork', 1, 2], ['write', 2, 1, 21], ['write', 1, 1, 22], ['read', 2, 3], ['write', 1, 4, 51], ['fork', 1, 3], ['write', 3, 4, 52], ['write', 2, 3, 7], ['write', 1, 0, 11]];
  for (const [op, ...a] of CS) cst.push(cw[op](...a));
  const copies = cst[cst.length - 1].snapshot.copies;
  const csText = ['P1 has 5 pages: 0 to 2 and 4 hold data, page 3 is demand-zero (never touched). Then, in order: P1 forks P2; P2 writes page 1; P1 writes page 1; P2 reads page 3; P1 writes page 4; P1 forks P3; P3 writes page 4; P2 writes page 3; P1 writes page 0. Fork shares every frame copy-on-write.'];
  C.exercise({ id: 'vm-x-cow-copies', chapter: 'vm-demand', title: 'Count the copies', level: 2, kind: 'number',
    text: csText.concat(['How many times does the kernel copy a page? (Filling a fresh frame with zeros is not a copy.)']),
    answer: copies, whyNot: { '7': 'Not every write copies: a frame used by one process only is just made writable.', '*': 'For each write to a copy-on-write page, count the processes still sharing its frame.' },
    hints: ['A write copies only if the frame is still shared by another process.', 'P1\'s write to page 1 comes after P2 has copied it, so frame of page 1 is P1\'s alone: no copy.', cst.slice(1).map((s) => s.say).filter((s) => /cop|zero|fill/i.test(s)).join(' ') + ' In all ' + copies + ' copies.'],
    solution: copies, wrong: [7, 1] });

  C.exercise({ id: 'vm-x-cow-why', chapter: 'vm-demand', title: 'Why copy-on-write pays', level: 1, kind: 'choice',
    text: ['A shell forks a child that calls exec at once. Why is copy-on-write a large saving here?'],
    options: ['The child\'s exec replaces its whole address space, so pages copied at fork would be thrown away unread', 'Copy-on-write makes exec itself faster', 'The parent\'s pages are moved to the child, not copied', 'The child runs in the parent\'s address space until it exits'],
    answer: 0, whyNot: { 1: 'exec builds a new address space either way; the saving is at fork.', 2: 'Nothing moves: the frames are shared, read-only, until someone writes.', 3: 'The child has its own page table from the start; only the frames are shared.' },
    hints: ['Ask what happens to the child\'s memory at exec.', 'Before exec, the child writes to few pages, perhaps none.', 'With copy-on-write, fork copies only the page tables; exec then discards them, so almost no page is ever copied.'],
    solution: 0, wrong: [1, 2] });

  const F = V.mmap({ file: [5, 6, 7, 8], frames: 8 }), fst = [];
  const FS = [['map', 1, 'shared'], ['map', 2, 'private'], ['write', 2, 1, 60], ['write', 1, 1, 61], ['read', 2, 1], ['write', 1, 3, 81], ['unmap', 2], ['msync', 1], ['write', 1, 0, 51], ['unmap', 1]];
  for (const [op, ...a] of FS) fst.push(F[op](...a));
  const file = fst[fst.length - 1].snapshot.file, frows = file.map((_, i) => 'page ' + i);
  const fcells = (f) => Object.fromEntries(frows.map((r, i) => [r + '|file holds', f(i)]));
  C.exercise({ id: 'vm-x-mmap', chapter: 'vm-demand', title: 'What reaches the file?', level: 2, kind: 'table',
    text: ['A file of 4 pages holds 5, 6, 7 and 8. P1 maps it shared and P2 maps it private. Then: P2 writes 60 to page 1; P1 writes 61 to page 1; P2 reads page 1; P1 writes 81 to page 3; P2 unmaps; P1 calls msync; P1 writes 51 to page 0; P1 unmaps. What does each page of the file hold at the end?'],
    rows: frows, cols: ['file holds'], corner: 'page', cells: fcells((i) => file[i]), cellKind: 'number',
    hints: ['A private write copies the page and never reaches the file. A shared write dirties the cached page; msync and unmap write dirty pages back.', 'P2\'s 60 stays in its own copy and is thrown away at its unmap.', fst.map((s) => s.say).slice(2).join(' ') + ' The file: ' + file.join(', ') + '.'],
    solution: fcells((i) => String(file[i])), wrong: [fcells((i) => String(i === 1 ? 60 : file[i])), fcells((i) => String(i === 0 ? 5 : file[i]))] });

  // =========================================================================================================
  // Chapter 2: replacement tables
  // =========================================================================================================
  /** a replacement-table exercise with its solution, a fault mark flipped, and one frame cell changed */
  const repEx = (x) => {
    x.solution = solve(x);
    const fk = Object.keys(x.solution).filter((k) => k.startsWith('fault|')), last = fk[fk.length - 1];
    const fcell = Object.keys(x.solution).filter((k) => k.startsWith('f0|'))[Math.floor(x.refs.length / 2)];
    x.wrong = [Object.assign({}, x.solution, { [last]: x.solution[last] ? '' : 'F' }), Object.assign({}, x.solution, { [fcell]: String(Number(x.solution[fcell] || 0) + 1) })];
    return C.exercise(x);
  };
  const runOf = (x) => M.replace(x.policy, x.refs, x.frames, x.opts);
  const victims = (r) => r.steps.filter((s) => s.victim !== null && s.victim !== undefined).map((s) => s.victim + ' at ' + (s.i + 1));

  const FIFO = { refs: [3, 1, 4, 1, 5, 2, 6, 5, 3, 5, 8, 2], frames: 3, policy: 'fifo' }, fr = runOf(FIFO);
  repEx(Object.assign({ id: 'vm-x-fifo-table', chapter: 'vm-replace', title: 'FIFO with three frames', level: 1, kind: 'replacement-table',
    text: ['Fill in the frames after each reference under FIFO with 3 frames, all empty at first, and mark each fault with F. Empty frames fill in order, frame 0 first; a page stays in the frame it was loaded into.'],
    hints: ['FIFO evicts the page that was loaded first, however recently it was used.', 'The first three distinct pages fill frames 0, 1 and 2; the next fault replaces the oldest, in frame 0.', 'Victims (page at reference): ' + victims(fr).join(', ') + '. ' + fr.faults + ' faults and ' + fr.hits + ' hits.'] }, FIFO));

  const OPT = { refs: [4, 7, 2, 4, 9, 7, 3, 4, 2, 9, 7, 3], frames: 3, policy: 'opt' }, or = runOf(OPT);
  repEx(Object.assign({ id: 'vm-x-opt-table', chapter: 'vm-replace', title: 'OPT with three frames', level: 2, kind: 'replacement-table',
    text: ['Fill in the frames after each reference under OPT with 3 frames: on a fault with every frame full, evict the page whose next use is farthest ahead (a page never used again is farthest; ties go to the lowest frame). Mark each fault with F.'],
    hints: ['At each fault, look ahead along the string and find when each resident page is next used.', 'At reference 5 (page 9) the frames hold 4, 7 and 2: next used at references 8, 6 and 9.', 'Victims: ' + victims(or).join(', ') + '. ' + or.faults + ' faults, the fewest possible.'] }, OPT));

  const LRU = { refs: [1, 6, 1, 3, 8, 6, 1, 2, 8, 3, 1, 6], frames: 3, policy: 'lru' }, lr = runOf(LRU);
  repEx(Object.assign({ id: 'vm-x-lru-table', chapter: 'vm-replace', title: 'LRU with three frames', level: 2, kind: 'replacement-table',
    text: ['Fill in the frames after each reference under LRU with 3 frames: on a fault with every frame full, evict the page used longest ago. Mark each fault with F.'],
    hints: ['Keep a list of the resident pages from least to most recently used; a hit moves its page to the end.', 'At reference 5 (page 8) the frames hold 1, 6 and 3, last used at references 3, 2 and 4: page 6 goes.', 'Victims: ' + victims(lr).join(', ') + '. ' + lr.faults + ' faults and ' + lr.hits + (lr.hits === 1 ? ' hit.' : ' hits.')] }, LRU));

  const CLK = { refs: [5, 2, 5, 7, 1, 2, 6, 5, 7, 1, 2], frames: 3, policy: 'clock' }, cr = runOf(CLK);
  repEx(Object.assign({ id: 'vm-x-clock-table', chapter: 'vm-replace', title: 'The clock with three frames', level: 2, kind: 'replacement-table',
    text: ['Fill in the frames under the clock algorithm with 3 frames. A page\'s use bit is set when it is loaded and on every hit. On a fault with every frame full, the hand looks at the frame it points to: a set bit is cleared and the hand moves on; a clear bit marks the victim, and the new page goes there with the hand moving one past it. The hand starts at frame 0 and, while frames are filling, moves past each frame filled. Mark each fault with F.'],
    hints: ['After the frames fill, the hand is back at frame 0, and every use bit is set.', 'The first eviction clears all three bits on a full sweep and takes the page in frame 0.', cr.steps.filter((s) => s.victim !== null && s.victim !== undefined).map((s) => s.say).join(' ') + ' ' + cr.faults + ' faults.'] }, CLK));

  const SEC = { refs: [2, 8, 3, 2, 6, 8, 1, 2, 9, 3, 8, 6], frames: 4, policy: 'second' }, sr = runOf(SEC);
  repEx(Object.assign({ id: 'vm-x-second-table', chapter: 'vm-replace', title: 'Second chance with four frames', level: 3, kind: 'replacement-table',
    text: ['Fill in the frames under second chance with 4 frames. Pages wait in a FIFO queue in load order. A page\'s use bit is set when it is loaded and on every hit. On a fault with every frame full, look at the head of the queue: if its use bit is set, clear it and move the page to the back (a second chance); if clear, evict it, and the new page takes its frame and joins the back. Mark each fault with F.'],
    hints: ['A hit sets the bit but does not move the page in the queue.', 'The first eviction finds every bit set: each page gets its second chance in turn, and the head, now clear, goes.', sr.steps.filter((s) => s.victim !== null && s.victim !== undefined).map((s) => s.say).join(' ') + ' ' + sr.faults + ' faults.'] }, SEC));

  const EC = '2w 1 4w 1 2 5w 2w 2 1 4 5 5w'.split(' '), ecr = EC.map((t) => (t.endsWith('w') ? { page: +t.slice(0, -1), write: true } : +t));
  const ecE = M.replace('eclock', ecr, 3), ecC = M.replace('clock', ecr, 3);
  C.exercise({ id: 'vm-x-eclock', chapter: 'vm-replace', title: 'Clean victims first', level: 3, kind: 'number',
    text: ['On the string `' + EC.join(' ') + '` (w a write) with 3 frames, the plain clock writes back ' + ecC.writeBacks + ' dirty pages. The enhanced clock sorts pages into classes (use, dirty): it scans first for (0, 0) without touching any bit, then for (0, 1) clearing use bits as it passes, and repeats. How many dirty pages does the enhanced clock write back?'],
    answer: ecE.writeBacks, whyNot: { [String(ecC.writeBacks)]: 'That is the plain clock, from the question. The enhanced clock skips dirty pages while a clean, unused one exists.', '*': 'Run the enhanced clock step by step; count the victims that were dirty when evicted.' },
    hints: ['A write sets the page\'s dirty bit; evicting a dirty page costs a write-back.', 'The enhanced clock makes ' + ecE.faults + ' faults here (the plain clock ' + ecC.faults + '), but chooses its victims among clean pages when it can.', 'Dirty victims under the enhanced clock: ' + (ecE.steps.filter((s) => s.writeBack).map((s) => 'page ' + s.victim + ' at reference ' + (s.i + 1)).join(', ') || 'none') + ': ' + ecE.writeBacks + (ecE.writeBacks === 1 ? ' write-back' : ' write-backs') + ', against ' + ecC.writeBacks + '.'],
    solution: ecE.writeBacks, wrong: [ecC.writeBacks, 0] });

  // ---- Belady's anomaly --------------------------------------------------------------------------------------------
  const BEL = [2, 6, 4, 5, 2, 6, 1, 2, 5, 6, 3, 5, 1];
  const b3 = M.replace('fifo', BEL, 3).faults, b4 = M.replace('fifo', BEL, 4).faults, l3 = M.replace('lru', BEL, 3).faults, l4 = M.replace('lru', BEL, 4).faults;
  C.exercise({ id: 'vm-x-belady', chapter: 'vm-replace', title: 'One more frame', level: 2, kind: 'number',
    text: ['Under FIFO with 3 frames, the string `' + BEL.join(' ') + '` makes ' + b3 + ' faults. How many does it make with 4 frames?'],
    answer: b4, whyNot: { [String(b3 - 1)]: 'More frames do not always help FIFO: run it.', [String(l4)]: 'That is LRU with 4 frames.', '*': 'Run FIFO with 4 frames from empty, evicting the page loaded first.' },
    hints: ['Fill four frames, then evict the oldest load on every fault.', 'The 4 frames do not always hold the pages the 3 frames hold; at some point a page that 3 frames would keep is gone.', 'FIFO: ' + b3 + ' faults with 3 frames, ' + b4 + ' with 4: Belady\'s anomaly. LRU goes from ' + l3 + ' to ' + l4 + '.'],
    solution: b4, wrong: [b3 - 1, b3] });

  C.exercise({ id: 'vm-x-stack', chapter: 'vm-replace', title: 'Who is safe from the anomaly?', level: 2, kind: 'choice',
    text: ['Which of these policies can never fault more with n + 1 frames than with n, on any reference string? Choose all that apply.'],
    options: ['OPT', 'LRU', 'FIFO', 'Second chance'],
    answer: [0, 1], whyNot: { 2: 'FIFO shows the anomaly: one more frame, ' + b4 + ' faults instead of ' + b3 + ' on the string of the exercise "One more frame".', 3: 'Second chance is FIFO with a use bit; with every bit set it is FIFO, anomaly included.' },
    hints: ['A stack algorithm keeps, with n frames, a subset of what it keeps with n + 1.', 'The n most recently used pages are always among the n + 1 most recently used; likewise for the pages used soonest.', 'OPT and LRU are stack algorithms; FIFO and second chance are not.'],
    solution: [0, 1], wrong: [[0, 1, 2], [1]] });

  // ---- reference strings -------------------------------------------------------------------------------------------
  const ADDR = [0x1004, 0x1008, 0x2010, 0x1010, 0x1014, 0x30f0, 0x30f8, 0x2014, 0x2018, 0x1018];
  const tr = V.refsFromTrace(ADDR, 4096), trRefs = tr.refs.map((r) => (typeof r === 'object' ? r.page : r));
  C.exercise({ id: 'vm-x-trace', chapter: 'vm-replace', title: 'From addresses to a reference string', level: 2, kind: 'number',
    text: ['A program makes these ten memory accesses, in order: ' + ADDR.map((a) => '0x' + a.toString(16)).join(', ') + '. Pages are 4096 bytes, and consecutive accesses to the same page count as one reference. How many references are in the reference string?'],
    answer: trRefs.length, whyNot: { '10': 'Consecutive accesses to the same page collapse into one reference.', [String(tr.pages.length)]: 'That is the number of different pages; a page can come back later as a new reference.', '*': 'Turn each address into its page (address ÷ 4096), then merge runs of the same page.' },
    hints: ['Page = address ÷ 4096, the hex digits above the low three.', 'The pages, access by access: ' + ADDR.map((a) => Math.floor(a / 4096)).join(', ') + '.', 'Merging runs gives ' + trRefs.join(', ') + ': ' + trRefs.length + ' references over ' + tr.pages.length + ' pages.'],
    solution: trRefs.length, wrong: [10, tr.pages.length] });

  C.exercise({ id: 'vm-x-loop-order', chapter: 'vm-replace', title: 'Rows or columns?', level: 1, kind: 'choice',
    text: ['`int a[512][1024];` is stored row by row, and pages are 4 KiB, so each row of 1024 ints fills one page. A process has 8 frames. Which loop makes far fewer page faults when every element is read once?'],
    options: ['`for (i = 0; i < 512; i++) for (j = 0; j < 1024; j++) sum += a[i][j];`', '`for (j = 0; j < 1024; j++) for (i = 0; i < 512; i++) sum += a[i][j];`', 'Both make the same number: they read the same elements'],
    answer: 0, whyNot: { 1: 'Down a column, each read is in a different row, so a different page: 512 pages cycle through 8 frames on every column.', 2: 'The order of the reads decides the reference string, and so the faults.' },
    hints: ['Ask which page each consecutive read touches.', 'Along a row, 1024 reads stay on one page; down a column, every read moves to the next page.', 'By rows: one fault per row, as each row\'s page comes in once. By columns: each column touches all 512 row pages in turn, far more than 8 frames hold, so under LRU every single read faults.'],
    solution: 0, wrong: [1, 2] });

  // ---- FIFO in C -----------------------------------------------------------------------------------------------------
  const CCASES = [[[1, 2, 3, 1, 4, 1, 2, 5], 3], [BEL, 3], [BEL, 4], [[7, 7, 7, 2, 7, 2], 2]];
  const cexp = CCASES.map(([r, n]) => M.replace('fifo', r, n).faults + '\n').join('');
  const arr = (r, k) => '    int r' + k + '[] = {' + r.join(', ') + '};\n';
  const MAIN = 'int main(void) {\n' + CCASES.map(([r], k) => arr(r, k)).join('') + CCASES.map(([r, n], k) => '    printf("%d\\n", fifo_faults(r' + k + ', ' + r.length + ', ' + n + '));\n').join('') + '    return 0;\n}\n';
  const FSTART = '#include <stdio.h>\n\n#define MAXF 8\n\n/* the number of page faults FIFO makes on refs[0..n-1] with nframes frames, all empty at first */\nint fifo_faults(int *refs, int n, int nframes) {\n    int frame[MAXF];\n    int used = 0, next = 0, faults = 0;\n\n    return faults;\n}\n\n' + MAIN;
  const FBODY = '    for (int i = 0; i < n; i++) {\n        int hit = 0;\n        for (int k = 0; k < used; k++)\n            if (frame[k] == refs[i])\n                hit = 1;\n        if (hit)\n            continue;\n        faults++;\n        if (used < nframes) {\n            frame[used] = refs[i];\n            used++;\n        } else {\n            frame[next] = refs[i];\n            next = (next + 1) % nframes;\n        }\n    }\n';
  const FSOL = FSTART.replace('    int used = 0, next = 0, faults = 0;\n\n', '    int used = 0, next = 0, faults = 0;\n' + FBODY);
  C.exercise({ id: 'vm-x-code-fifo', chapter: 'vm-replace', title: 'Count FIFO faults in C', level: 3, kind: 'code',
    text: ['Write `fifo_faults`: it runs FIFO replacement over a reference string and returns the number of faults. Empty frames fill in order; once all are full, each fault replaces the page loaded longest ago (the frames, used as a circular queue, make this easy). The second and third strings are the ones of the exercise "One more frame". The program must print:', { code: cexp, lang: 'text' }],
    starter: FSTART,
    tests: [{ name: 'four strings', stdout: cexp }],
    hints: ['For each reference: if it is in one of the used frames it is a hit; otherwise count a fault and place it.', 'While used < nframes, put the page in frame[used]. After that, frame[next] is always the oldest load: replace it and move next round by one.', FBODY.replace(/\n\s*/g, ' ').trim()],
    solution: FSOL,
    wrong: [FSOL.replace('            continue;\n', '            faults--;\n'), FSOL.replace('            next = (next + 1) % nframes;\n', '')] });
})(globalThis.Proses = globalThis.Proses || {});
