// Part 12, mass storage: the exercises of chapters 3 and 4 (the flash translation layer, garbage collection and wear;
// RAID layouts, parity and rebuilds; checksums, CRCs and Hamming codes). Every number in a text, an answer or a hint
// is worked out here by the engines (S.SSD, S.Raid, S.GF, S.Codes): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || !S.SSD || !S.Raid || C.exercises.has('ms-x-ftl')) return;
  const fx = (v, d) => { const p = Math.pow(10, d === undefined ? 3 : d); return String(Math.round(v * p) / p); };
  const hx = (v) => '0x' + (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
  const bits = (v) => v.toString(2).padStart(8, '0');

  // =========================================================================================================
  // Chapter 3: flash
  // =========================================================================================================
  const FO = ['w0', 'w1', 'w2', 'w1', 'w3', 'w0', 'w4', 'w1', 't2', 'w5'];
  const F1 = S.SSD.create({ blocks: 4, pages: 4, op: 1 });
  const r1 = S.SSD.run(F1, FO.map((t) => ({ op: t[0], lpn: +t.slice(1) })));
  const l2p = S.SSD.snapshot(F1).l2p;
  const frows = [0, 1, 2, 3, 4, 5].map((l) => 'logical ' + l);
  const fval = (l) => (l2p[l] < 0 ? 'none' : String(l2p[l]));
  const fcells = (f) => Object.fromEntries(frows.map((r, l) => [r + '|physical page', f(l)]));
  const lastWrite = (l) => r1.steps.filter((s) => s.kind === 'write' && s.say.includes('Logical page ' + l + ' ')).pop();
  C.exercise({ id: 'ms-x-ftl', chapter: 'ms-flash', title: 'Follow the mapping table', level: 2, kind: 'table',
    text: ['A tiny SSD has 4 erase blocks of 4 pages; physical page p of block b is numbered 4b + p. Writes go to the next free page of the active block, starting with block 0, then block 1, and so on; an overwrite leaves the old copy invalid. No garbage collection happens in this short run.',
      'The computer does `' + FO.join(' ') + '` (w3 writes logical page 3, t2 trims logical page 2). Where does each logical page live at the end? Write the physical page number, or none.'],
    rows: frows, cols: ['physical page'], corner: 'page', cells: fcells(fval), cellKind: 'text',
    hints: ['Write each operation down in turn: block 0 takes the first four writes, w0 w1 w2 w1.', 'The second w1 lands on physical page 3, and block 1 starts with w3 at page 4. A trim makes the page\'s copy invalid and leaves it unmapped.', [0, 1, 3, 4, 5].map((l) => lastWrite(l).say.replace(/^Logical page \d+ is programmed into /, l + ': ').replace(/; the mapping table now points .*/, ' (' + l2p[l] + ')')).join('; ') + '; 2: none (trimmed).'],
    solution: fcells(fval),
    wrong: [fcells((l) => (l === 1 ? '3' : fval(l))), fcells((l) => (l === 2 ? '2' : fval(l)))],
    why: 'Block 0 now holds only invalid pages: garbage collection could erase it without copying anything.' });

  const LF = { blocks: 64, pages: 128, op: 0.25 }, F64 = S.SSD.create(LF);
  C.exercise({ id: 'ms-x-logical', chapter: 'ms-flash', title: 'How much does the drive show?', level: 2, kind: 'number',
    text: ['An SSD has ' + LF.blocks + ' erase blocks of ' + LF.pages + ' pages. It keeps 25% over-provisioning: the physical pages are 1.25 times the logical pages it offers the computer (rounded down). How many logical pages does it show?'],
    answer: F64.logical,
    whyNot: { [String(LF.blocks * LF.pages * 0.75)]: 'That keeps back 25% of the physical pages; over-provisioning is 25% of the logical size, so physical = 1.25 × logical.', [String(LF.blocks * LF.pages)]: 'That is every physical page; some are kept back as spare.', '*': 'Solve physical = 1.25 × logical for the logical pages.' },
    hints: ['The physical pages are ' + LF.blocks + ' × ' + LF.pages + ' = ' + LF.blocks * LF.pages + '.', 'Over-provisioning is (physical − logical) / logical = 0.25, so logical = physical / 1.25.', LF.blocks * LF.pages + ' / 1.25 = ' + LF.blocks * LF.pages / 1.25 + ', rounded down ' + F64.logical + '.'],
    solution: F64.logical, wrong: [LF.blocks * LF.pages * 0.75, LF.blocks * LF.pages] });

  const F2 = S.SSD.create({ blocks: 16, pages: 8, op: 0.15 });
  S.SSD.run(F2, S.SSD.workload('uniform', 600, { logical: F2.logical, seed: 3, fill: true }));
  const st2 = S.SSD.stats(F2), wa = +fx(st2.flash / st2.host, 2);
  C.exercise({ id: 'ms-x-wa', chapter: 'ms-flash', title: 'Write amplification', level: 1, kind: 'number',
    text: ['An SSD runs a workload of random writes. The computer asked for ' + st2.host + ' page writes, and garbage collection copied ' + st2.gcCopies + ' valid pages along the way (there is no wear levelling). What is the write amplification? Give two decimals.'],
    answer: wa, tolerance: 0.006,
    whyNot: { [fx(st2.gcCopies / st2.host, 2)]: 'That counts only the copies; the writes asked for are flash writes too.', '*': 'Write amplification = (logical writes + copies) / logical writes.' },
    hints: ['Every write the computer asks for is one flash write, and so is every page garbage collection copies.', 'Flash writes = ' + st2.host + ' + ' + st2.gcCopies + ' = ' + st2.flash + '.', st2.flash + ' / ' + st2.host + ' = ' + fx(st2.flash / st2.host, 4) + ', about ' + wa + '.'],
    solution: wa, wrong: [+fx(st2.gcCopies / st2.host, 2), +fx(st2.host / st2.flash, 2)] });

  // a garbage collection where the cost-benefit victim is not the greedy one
  const F3 = S.SSD.create({ blocks: 8, pages: 8, op: 0.3, gc: 'cost-benefit' });
  const r3 = S.SSD.run(F3, S.SSD.workload('hotcold', 80, { logical: F3.logical, seed: 1, hot: 0.2, hotShare: 0.8, fill: true }));
  const v3 = r3.steps.filter((s) => s.kind === 'gc-victim')[1];
  const greedy = v3.scores.slice().sort((a, b) => a.valid - b.valid || a.block - b.block)[0].block;
  const best = v3.scores.slice().sort((a, b) => b.score - a.score || a.block - b.block);
  C.exercise({ id: 'ms-x-victim', chapter: 'ms-flash', title: 'Choose the victim', level: 2, kind: 'number',
    text: ['Garbage collection must pick a victim among these blocks of 8 pages. The age is the time since the block was last written.',
      { table: [['Block', 'Valid pages', 'Age']].concat(v3.scores.map((x) => [String(x.block), x.valid + ' of 8', String(x.age)])), caption: 'The candidate blocks.' },
      'The cost-benefit policy picks the largest (1 − u) · age / (1 + u), where u is the share of the block\'s pages that are valid. Which block does it pick?'],
    answer: v3.block,
    whyNot: { [String(greedy)]: 'That is the greedy choice, the fewest valid pages. Cost-benefit also weighs age: an old block is likely to stay as it is.', '*': 'Work out (1 − u) · age / (1 + u) for each block.' },
    hints: ['A block with every page valid scores 0: nothing would be gained by collecting it.', 'Block ' + greedy + ' has the fewest valid pages but was written very recently; its hot data may soon be invalid anyway.', best.slice(0, 3).map((x) => 'block ' + x.block + ': (1 − ' + x.u + ') · ' + x.age + ' / (1 + ' + x.u + ') = ' + fx(x.score)).join('; ') + '. The largest is block ' + v3.block + '.'],
    solution: v3.block, wrong: [greedy, best[1].block] });

  C.exercise({ id: 'ms-x-spare', chapter: 'ms-flash', title: 'Lowering write amplification', level: 1, kind: 'choice',
    text: ['A drive under steady random writes has a write amplification near 10. Which change lowers it the most?'],
    options: ['More over-provisioning: keep more of the flash as spare room', 'A larger mapping table in the controller\'s memory', 'Reading pages more often', 'Fewer, larger logical pages offered to the computer'],
    answer: 0, whyNot: { 1: 'The table only records where pages are; it does not change how full the victims are.', 2: 'Reads do not invalidate anything and cost no flash writes.', 3: 'The computer still rewrites the same amount of data; the victims are still nearly full.' },
    hints: ['Write amplification comes from the valid pages garbage collection must copy.', 'The emptier a victim block is, the fewer pages are copied to free it.', 'More spare room: with 7% spare the topic\'s drive reaches 9.613, with 50% only 1.592.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'ms-x-wear', chapter: 'ms-flash', title: 'Cold data and wear', level: 1, kind: 'choice',
    text: ['Half of an SSD holds photos that are never rewritten; the other half holds a database rewritten all day. With only dynamic wear levelling (writes go to the least-worn free block), what happens to the blocks that hold the photos?'],
    options: ['They are hardly ever erased, so the database blocks take all the wear', 'They wear out first, since they are the oldest', 'They are erased as often as the others'],
    answer: 0, whyNot: { 1: 'A block wears out by being erased, and blocks full of valid photos are never chosen for erasing.', 2: 'Dynamic levelling only chooses among free blocks; these never become free.' },
    hints: ['Which blocks does dynamic levelling choose among?', 'A block full of valid, cold data is never a good garbage-collection victim, so it is never freed.', 'The photo blocks stay at a low erase count while the others take every erase. Static levelling fixes this by moving the cold data.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 4: RAID
  // =========================================================================================================
  const R = S.Raid, LV = [0, 1, 5, 6, 10], lvName = { 0: 'RAID 0', 1: 'RAID 1', 5: 'RAID 5', 6: 'RAID 6', 10: 'RAID 10' };
  const fm = Object.fromEntries(LV.map((l) => [l, R.formulas({ level: l, disks: l === 1 ? 2 : 6, size: 2000, seq: 200, iops: 150 })]));
  const rrows = LV.map((l) => lvName[l]), rcols = ['capacity (GB)', 'disks that may fail'];
  const rcells = (f) => Object.fromEntries(LV.flatMap((l) => [[lvName[l] + '|capacity (GB)', f(l, 'cap')], [lvName[l] + '|disks that may fail', f(l, 'tol')]]));
  const rval = (l, k) => (k === 'cap' ? fm[l].capacity : fm[l].tolerance.least);
  C.exercise({ id: 'ms-x-levels', chapter: 'ms-raid', title: 'Capacity and safety', level: 2, kind: 'table',
    text: ['Disks of 2000 GB are combined. RAID 1 uses 2 of them as a mirrored pair; every other level uses 6 (RAID 10: three mirrored pairs, striped). For each, how much data can the array hold, and how many disks may fail with no data lost, whichever they are?'],
    rows: rrows, cols: rcols, corner: 'level', cells: rcells(rval), cellKind: 'number',
    hints: ['Count the disks\' worth of data in a stripe: parity and copies hold none.', 'RAID 10 survives one failure in each pair, but two failures in the same pair lose data: count the worst case.', LV.map((l) => lvName[l] + ': ' + fm[l].capacity + ' GB, ' + fm[l].tolerance.least).join('; ') + '.'],
    solution: rcells(rval),
    wrong: [rcells((l, k) => (l === 10 && k === 'tol' ? 3 : rval(l, k))), rcells((l, k) => (l === 6 && k === 'cap' ? 10000 : rval(l, k)))] });

  const A4 = R.create({ level: 5, disks: 4, chunk: 1, stripes: 8 }), CH = [13, 22], m = CH.map((c) => R.map(A4, c));
  const crows = CH.map((c) => 'chunk ' + c), ccols = ['stripe', 'data disk', 'parity disk'];
  const cval = (i, k) => (k === 'stripe' ? m[i].stripe : k === 'data disk' ? m[i].disk : m[i].parity);
  const ccells = (f) => Object.fromEntries(crows.flatMap((r, i) => ccols.map((k) => [r + '|' + k, f(i, k)])));
  C.exercise({ id: 'ms-x-chunk', chapter: 'ms-raid', title: 'Find the chunk', level: 2, kind: 'table',
    text: ['RAID 5 on 4 disks (0 to 3) with the left-symmetric layout: each stripe holds 3 data chunks; the parity of stripe s is on disk 3 − (s mod 4); the data starts on the disk just after the parity and wraps round. Logical chunks 0, 1, 2 … fill the stripes in order.', 'For chunks ' + CH.join(' and ') + ', give the stripe, the disk that holds the chunk, and the disk that holds that stripe\'s parity.'],
    rows: crows, cols: ccols, corner: 'chunk', cells: ccells(cval), cellKind: 'number',
    hints: ['Chunk c is in stripe ⌊c / 3⌋, at position c mod 3 among its data chunks.', 'Chunk 13: stripe 4, position 1. Stripe 4\'s parity is on disk 3 − (4 mod 4) = 3, so its data starts on disk 0.', CH.map((c, i) => 'chunk ' + c + ': stripe ' + m[i].stripe + ', disk ' + m[i].disk + ', parity on disk ' + m[i].parity).join('; ') + '.'],
    solution: ccells(cval),
    wrong: [ccells((i, k) => (k === 'stripe' ? Math.floor(CH[i] / 4) : cval(i, k))), ccells((i, k) => (k === 'parity disk' ? 3 : cval(i, k)))] });

  const sw = R.smallWrite({ level: 5, disks: 6, chunks: 3 });
  C.exercise({ id: 'ms-x-small', chapter: 'ms-raid', title: 'Three chunks of a stripe', level: 3, kind: 'number',
    text: ['A RAID 5 array of 6 disks has 5 data chunks and a parity chunk in each stripe. A write replaces 3 of the 5 data chunks of one stripe. The array can update the parity by read-modify-write (read the old chunks and the old parity) or by reconstruct-write (read the chunks not being written and compute the parity afresh), and it uses whichever needs fewer reads. How many disk I/Os, reads and writes together, does the write take?'],
    answer: sw[sw.best].ios,
    whyNot: { [String(sw.rmw.ios)]: 'That is read-modify-write. Reconstruct-write reads only the 2 chunks not being written.', [String(sw.rcw.writes)]: 'That counts only the writes; the parity cannot be computed without reading something first.', '*': 'Count the reads of each method, then add the writes: the new chunks and the new parity.' },
    hints: ['Either way the array writes the 3 new chunks and the new parity: 4 writes.', 'Read-modify-write reads the 3 old chunks and the old parity (4 reads); reconstruct-write reads the 2 untouched chunks.', 'Reconstruct-write: ' + sw.rcw.reads + ' reads + ' + sw.rcw.writes + ' writes = ' + sw.rcw.ios + ' I/Os, against ' + sw.rmw.ios + ' for read-modify-write.'],
    solution: sw[sw.best].ios, wrong: [sw.rmw.ios, sw.rcw.writes] });

  // ---- parity bytes ------------------------------------------------------------------------------------------------
  const xor = (bs) => bs.reduce((a, b) => a ^ b, 0);
  const pEx = (x, hints) => C.exercise(Object.assign({ kind: 'raid-parity', ask: 'p', hints, solution: hx(xor(x.chunks.map(Number))) }, x, { wrong: x.wrong }));
  const PA = [0x5C, 0xA3, 0x37];
  pEx({ id: 'ms-x-p', chapter: 'ms-raid', title: 'One parity byte', level: 1, chunks: PA.map(hx),
    text: ['A RAID 5 stripe has three data disks. At one byte position they hold `' + PA.map(hx).join('`, `') + '`. What byte does the parity chunk hold there?'],
    wrong: [hx(PA[0] ^ PA[1]), hx((PA[0] + PA[1] + PA[2]) & 255)] },
  ['Parity is the XOR of the data, bit by bit: a 1 where an odd number of the bytes have a 1.', bits(PA[0]) + ' ⊕ ' + bits(PA[1]) + ' = ' + bits(PA[0] ^ PA[1]) + ' (' + hx(PA[0] ^ PA[1]) + ').', hx(PA[0] ^ PA[1]) + ' ⊕ ' + hx(PA[2]) + ' = ' + bits(xor(PA)) + ' = ' + hx(xor(PA)) + '.']);

  const P5 = [0x91, 0x4E, 0xD2, 0x0F, 0x68];
  pEx({ id: 'ms-x-p5', chapter: 'ms-raid', title: 'Parity over five disks', level: 2, chunks: P5.map(hx),
    text: ['A RAID 5 array of 6 disks: at one byte position the five data chunks of a stripe hold `' + P5.map(hx).join('`, `') + '`. What is the parity byte?'],
    wrong: [hx(xor(P5.slice(0, 4))), hx(xor(P5) ^ 0x10)] },
  ['XOR is associative: combine the bytes two at a time in any order.', hx(P5[0]) + ' ⊕ ' + hx(P5[1]) + ' = ' + hx(P5[0] ^ P5[1]) + '; ⊕ ' + hx(P5[2]) + ' = ' + hx(xor(P5.slice(0, 3))) + '; ⊕ ' + hx(P5[3]) + ' = ' + hx(xor(P5.slice(0, 4))) + '.', hx(xor(P5.slice(0, 4))) + ' ⊕ ' + hx(P5[4]) + ' = ' + hx(xor(P5)) + ' (' + bits(xor(P5)) + ').']);

  // the lost byte is the XOR of the survivors and the parity: a parity exercise over those bytes
  const LD = [0x3B, 0x96, 0xE4, 0x2D], LP = xor(LD), lostAt = 2, surv = LD.filter((_, i) => i !== lostAt).concat([LP]);
  pEx({ id: 'ms-x-lost', chapter: 'ms-raid', title: 'Rebuild a lost byte', level: 2, chunks: surv.map(hx),
    text: ['A RAID 5 stripe has four data disks and a parity disk. Data disk 2 has failed. At one byte position the others hold: data disk 0 `' + hx(LD[0]) + '`, data disk 1 `' + hx(LD[1]) + '`, data disk 3 `' + hx(LD[3]) + '`, and the parity disk `' + hx(LP) + '`. What byte did disk 2 hold? (Below, the four surviving bytes are listed as the inputs.)'],
    wrong: [hx(LP), hx(LD[0] ^ LD[1] ^ LD[3])] },
  ['P = D0 ⊕ D1 ⊕ D2 ⊕ D3, and x ⊕ x = 0.', 'So D2 = D0 ⊕ D1 ⊕ D3 ⊕ P: the XOR of every surviving chunk, parity included.', hx(LD[0]) + ' ⊕ ' + hx(LD[1]) + ' ⊕ ' + hx(LD[3]) + ' ⊕ ' + hx(LP) + ' = ' + hx(LD[lostAt]) + '.']);

  const OP = 0x6A, OD = 0xC1, ND = 0x1F;
  pEx({ id: 'ms-x-rmw', chapter: 'ms-raid', title: 'The new parity, by read-modify-write', level: 2, chunks: [OP, OD, ND].map(hx),
    text: ['One data chunk of a RAID 5 stripe is overwritten. At one byte position the old parity is `' + hx(OP) + '`, the old data is `' + hx(OD) + '` and the new data is `' + hx(ND) + '`. Without reading the other data chunks, what is the new parity byte? (The three known bytes are listed below as the inputs.)'],
    wrong: [hx(OD ^ ND), hx(OP ^ ND)] },
  ['XOR the old data out of the parity, and the new data in.', 'P_new = P_old ⊕ D_old ⊕ D_new.', hx(OP) + ' ⊕ ' + hx(OD) + ' = ' + hx(OP ^ OD) + '; ⊕ ' + hx(ND) + ' = ' + hx(OP ^ OD ^ ND) + '.']);

  const QD = [0x53, 0x4F, 0xA0], q = S.GF.pq(QD.map((v) => Uint8Array.of(v)), 1).q[0];
  const terms = QD.map((d, k) => S.GF.mul(S.GF.gpow(k), d));
  C.exercise({ id: 'ms-x-q', chapter: 'ms-raid', kind: 'raid-parity', ask: 'q', title: 'The Q byte of RAID 6', level: 3, chunks: QD.map(hx),
    text: ['A RAID 6 stripe has three data disks D0, D1 and D2, holding `' + QD.map(hx).join('`, `') + '` at one byte position. Q = g⁰·D0 ⊕ g¹·D1 ⊕ g²·D2 in GF(2⁸), with g = 2 and products reduced modulo x⁸ + x⁴ + x³ + x² + 1 (multiplying by 2 shifts left, and XORs 0x1D when a 1 falls off the top). What is Q?'],
    hints: ['g⁰ = 1, g¹ = 2, g² = 4: D0 counts as it is, D1 is doubled once, D2 twice.', 'Doubling ' + hx(QD[1]) + ': ' + hx(terms[1]) + '. Doubling ' + hx(QD[2]) + ' twice: ' + hx(S.GF.xtime(QD[2])) + ', then ' + hx(terms[2]) + '.', hx(terms[0]) + ' ⊕ ' + hx(terms[1]) + ' ⊕ ' + hx(terms[2]) + ' = ' + hx(q) + '.'],
    solution: hx(q), wrong: [hx(xor(QD)), hx(QD[0] ^ ((QD[1] << 1) & 255) ^ ((QD[2] << 2) & 255))],
    whyNot: 'Q weighs each byte by its own power of 2 in GF(2⁸); a plain shift must fold in 0x1D whenever a 1 falls off the top.' });

  const AR = R.create({ level: 5, disks: 5, chunk: 2, stripes: 6 });
  R.write(AR, 0, 'REBUILD ME FROM PARITY AND DATA!!!!!!!!!!!!!!!!!!'.slice(0, R.capacity(AR)));
  R.fail(AR, 3);
  const rb = R.rebuild(AR, 3), reads = rb.steps.filter((s) => s.kind === 'rebuild').reduce((n, s) => n + s.from.length, 0);
  C.exercise({ id: 'ms-x-rebuild-reads', chapter: 'ms-raid', title: 'What a rebuild reads', level: 1, kind: 'number',
    text: ['A RAID 5 array of 5 disks holds 6 stripes. Disk 3 fails and is replaced by a blank disk, which is rebuilt stripe by stripe. How many chunks are read from the surviving disks in all?'],
    answer: reads,
    whyNot: { [String(6)]: 'That is one chunk a stripe; each lost chunk is the XOR of all the others in its stripe.', [String(6 * 5)]: 'The failed disk cannot be read: only the 4 survivors are.', '*': 'For each stripe, count the chunks on the surviving disks.' },
    hints: ['Each stripe has one chunk on every disk.', 'The lost chunk of a stripe, data or parity, is the XOR of the 4 chunks on the other disks.', '6 stripes × 4 surviving chunks = ' + reads + ' chunk reads: a rebuild reads every surviving disk from end to end.'],
    solution: reads, wrong: [6, 30] });

  // =========================================================================================================
  // Chapter 4: error codes
  // =========================================================================================================
  const HD = [1, 0, 0, 1], hc = S.Codes.hamming74(HD).code, HF = 6, recv = S.Codes.flip(hc, HF - 1), dec = S.Codes.hamming74decode(recv);
  C.exercise({ id: 'ms-x-hamming', chapter: 'ms-raid', title: 'Which bit flipped?', level: 2, kind: 'number',
    text: ['A Hamming(7,4) codeword is read back as `' + recv.join('') + '` (positions 1 to 7, left to right). p1 at position 1 covers positions 1, 3, 5, 7; p2 at 2 covers 2, 3, 6, 7; p3 at 4 covers 4, 5, 6, 7, and each check makes its group hold an even number of ones. Assuming at most one bit flipped, which position is wrong? (0 if none.)'],
    answer: dec.position,
    whyNot: { '0': 'At least one group holds an odd number of ones, so a bit has flipped.', '*': 'Recount each group: the failing groups, as the bits p3 p2 p1, name the position.' },
    hints: ['Count the ones in each group of four positions.', 'p1\'s group has ' + [1, 3, 5, 7].reduce((n, i) => n + recv[i - 1], 0) + ' ones, p2\'s ' + [2, 3, 6, 7].reduce((n, i) => n + recv[i - 1], 0) + ', p3\'s ' + [4, 5, 6, 7].reduce((n, i) => n + recv[i - 1], 0) + '.', dec.say],
    solution: dec.position, wrong: [0, dec.position === 3 ? 5 : 3] });

  const CM = '110100111', CG = '1011', cd = S.Codes.crcDivide(CM, CG);
  C.exercise({ id: 'ms-x-crc', chapter: 'ms-raid', title: 'A CRC by long division', level: 3, kind: 'string',
    text: ['The message `' + CM + '` is protected by a CRC with generator `' + CG + '` (degree 3). Append three zeros, divide by the generator in binary with XOR in place of subtraction, and give the 3-bit remainder that is sent as the check.'],
    answer: cd.remainder,
    hints: ['The dividend is ' + CM + '000. Wherever the leading bit is 1, XOR 1011 in under it.', 'The first steps: ' + cd.rows.slice(0, 2).map((r) => r.before + ' → ' + r.after).join(', ') + '.', 'After ' + cd.rows.length + ' XORs the remainder is ' + cd.remainder + ', and ' + cd.codeword + ' is sent.'],
    solution: cd.remainder, wrong: ['000', S.Codes.crcDivide(CM, '1101').remainder === cd.remainder ? '111' : S.Codes.crcDivide(CM, '1101').remainder],
    whyNot: 'Divide ' + CM + '000 by ' + CG + ' step by step: XOR the generator under each leading 1.' });

  // a swap of two bytes that are both high bytes of 16-bit words: sums miss it
  const DT = 'LOAD 7 CRATES', di = 2, dj = 4, bytes = S.Codes.bytes(DT), sw2 = Uint8Array.from(bytes);
  sw2[di] = bytes[dj]; sw2[dj] = bytes[di];
  const checks = {
    parity: (b) => [...b].map((x) => S.Codes.parity(Uint8Array.of(x)).bit).join(''),
    sum: (b) => S.Codes.sum8(b).value, internet: (b) => S.Codes.internet(b).value,
    fletcher: (b) => S.Codes.fletcher16(b).value, adler: (b) => S.Codes.adler32(b).value, crc: (b) => S.Codes.crc32(b),
  };
  const miss = Object.keys(checks).filter((k) => checks[k](bytes) === checks[k](sw2));
  const after = String.fromCharCode(...sw2);
  C.exercise({ id: 'ms-x-detect', chapter: 'ms-raid', title: 'Which checks miss a swap?', level: 3, kind: 'set', caseless: true,
    text: ['A block holds the 13 bytes `' + DT + '`. It reads back as `' + after + '`: bytes ' + di + ' and ' + dj + ' (counting from 0) have changed places. Six check values were stored with the block: a parity bit for each byte (parity), the 8-bit sum (sum), the Internet checksum over 16-bit words (internet), Fletcher-16 (fletcher), Adler-32 (adler) and CRC-32 (crc). Which of them give the same value as before, and so miss the damage? Answer as a set, like {sum, crc}.'],
    answer: '{' + miss.join(', ') + '}',
    hints: ['A plain sum of the same bytes in any order is the same.', 'The Internet checksum adds 16-bit words: bytes ' + di + ' and ' + dj + ' are both the high byte of a word, so the swap moves the same values between words of the same weight. Parity bits are per position: do the two bytes have the same parity?', 'Missed by {' + miss.join(', ') + '}; Fletcher, Adler and CRC weigh each byte by its position, and notice.'],
    solution: '{' + miss.join(', ') + '}', wrong: ['{sum}', '{sum, internet, fletcher}'],
    whyNot: 'Ask of each check whether it depends on where a byte is, not only on what it is.' });
})(globalThis.Proses = globalThis.Proses || {});
