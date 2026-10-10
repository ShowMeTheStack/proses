// Part 15, file-system implementation: the exercises of chapter 1 (the layout, allocation, inodes, free space) and
// chapter 2 (lookup, the cost of calls, the buffer cache, cylinder groups). Layouts, inode sizes, largest files,
// the walks to byte N, payloads and the cache's counts are worked out here by the engines (S.FS); the counts quoted
// from the topics (reads to reach a block, blocks moved) were checked against the topics' own frames.
(function (S) {
  'use strict';
  const C = S.Content, F = S.FS;
  if (!C || !F || C.exercises.has('fi-x-ipb')) return;
  const solve = (x) => S.Check.kinds[x.kind].solve(x);
  const grp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // =========================================================================================================
  // Chapter 1: the layout
  // =========================================================================================================
  const G1 = F.geometry({ bs: 512, nblocks: 128, ninodes: 64, ndirect: 12, ps: 8 });
  const need1 = 16 + (G1.ndirect + 3) * G1.ps, ipb1 = G1.bs / G1.isz;
  C.exercise({ id: 'fi-x-ipb', chapter: 'fi-layout', title: 'Inodes in a block', level: 1, kind: 'number',
    text: ['An inode holds 16 bytes of fixed fields (type, link count, mode, owner, size), then 12 direct pointers and 3 indirect pointers of 8 bytes each. Its size is rounded up to a power of two so that inodes never straddle a block. Blocks are 512 bytes. How many inodes fit in one block?'],
    answer: ipb1,
    whyNot: { [String(Math.floor(G1.bs / need1))]: 'That packs inodes of ' + need1 + ' bytes; the inode is first rounded up to a power of two.', '*': 'Work out the inode\'s bytes, round up to a power of two, then divide the block size by it.' },
    hints: ['The pointers take (12 + 3) × 8 = 120 bytes.', 'With the 16 fixed bytes that is ' + need1 + ', which rounds up to ' + G1.isz + '.', G1.bs + ' ÷ ' + G1.isz + ' = ' + ipb1 + ' inodes a block.'],
    solution: ipb1, wrong: [Math.floor(G1.bs / need1), 4] });

  const G2 = F.geometry({ bs: 256, nblocks: 128, ninodes: 48, ndirect: 10, ps: 4 }), L2 = F.layout(G2);
  const reg = (r) => L2.find((x) => x.region === r), UNR = Math.ceil(G2.ninodes / Math.floor(G2.bs / (16 + (G2.ndirect + 3) * G2.ps)));
  const LROWS = [['inode bitmap', 'ibm'], ['data bitmap', 'dbm'], ['inode table', 'itable'], ['data region', 'data']];
  const lcells = (f) => Object.fromEntries(LROWS.flatMap(([name, r]) => [[name + '|first block', f(r, 'start')], [name + '|blocks', f(r, 'count')]]));
  const lsol = lcells((r, k) => reg(r)[k]);
  C.exercise({ id: 'fi-x-layout', chapter: 'fi-layout', title: 'Lay out a disk', level: 2, kind: 'table',
    text: ['mkfs makes a file system on a disk of ' + G2.nblocks + ' blocks of ' + G2.bs + ' bytes, with ' + G2.ninodes + ' inodes. Each inode has 16 bytes of fixed fields and ' + G2.ndirect + ' direct plus 3 indirect pointers of ' + G2.ps + ' bytes, rounded up to a power of two. Block 0 is the superblock; then come the inode bitmap, the data bitmap and the inode table, each taking whole blocks, and every block after them is the data region. Fill in where each region starts and how many blocks it takes.'],
    rows: LROWS.map((r) => r[0]), cols: ['first block', 'blocks'], corner: 'region', cells: lsol,
    hints: ['A bitmap of ' + G2.ninodes + ' bits, or of about ' + G2.nblocks + ', fits easily in one block of ' + G2.bs * 8 + ' bits.', 'An inode needs 16 + ' + (G2.ndirect + 3) + ' × ' + G2.ps + ' = ' + (16 + (G2.ndirect + 3) * G2.ps) + ' bytes, rounded to ' + G2.isz + ': ' + G2.bs / G2.isz + ' in a block, so ' + G2.ninodes + ' inodes take ' + reg('itable').count + ' blocks.', LROWS.map(([name, r]) => name + ': from block ' + reg(r).start + ', ' + reg(r).count + ' blocks').join('; ') + '.'],
    solution: lsol,
    wrong: [lcells((r, k) => (r === 'itable' && k === 'count' ? UNR : r === 'data' && k === 'start' ? 3 + UNR : r === 'data' && k === 'count' ? G2.nblocks - 3 - UNR : reg(r)[k])), lcells((r, k) => (r === 'data' && k === 'count' ? G2.nblocks : reg(r)[k]))],
    whyNot: 'Round the inode up to a power of two first; the data region is every block after the inode table.' });

  // which blocks does link write? (checked with F.prepare: two inode-table blocks and one directory block)
  C.exercise({ id: 'fi-x-link-writes', chapter: 'fi-layout', title: 'What link writes', level: 1, kind: 'choice',
    text: ['`link /docs/plan /p` gives an existing file a second name. Which of these blocks does it change? Choose every one.'],
    options: ['the inode bitmap', 'the data bitmap', 'the inode-table block holding the file\'s inode', 'a block of the directory that gets the new name', 'a data block of the file'],
    answer: [2, 3], whyNot: { 0: 'No inode is allocated: the name points to the inode that already exists.', 1: 'No data block is allocated or freed.', 4: 'The file\'s contents do not change.' },
    hints: ['Ask what is new: a name, and one more link to the same inode.', 'The name goes in a directory block; the link count lives in the inode.', 'The inode-table block (the link count goes up by one) and a directory block (the new entry). Nothing is allocated, so neither bitmap changes.'],
    solution: [2, 3], wrong: [[0, 2, 3], [3]] });

  // =========================================================================================================
  // Chapter 1: allocation and reaching a block
  // =========================================================================================================
  C.exercise({ id: 'fi-x-contig-moved', chapter: 'fi-layout', title: 'Files that must move', level: 2, kind: 'number',
    text: ['Contiguous allocation, first fit, on an empty data region. Two files, a and b, grow in turns: a by 2 blocks, b by 2, a by 2, b by 1, a by 2. A file is always one run: when the block after its run is taken, the whole file is copied to the first free run long enough for its new size, and its old blocks are freed. How many blocks are copied in all?'],
    answer: 8,
    whyNot: { '0': 'b sits right after a, so a cannot grow in place.', '6': 'Count b\'s move too: when b grows to 3, the block after it is taken by a.', '*': 'Follow the runs: each growth either fits in place or moves the whole file.' },
    hints: ['a takes 2 blocks, then b the next 2. a must grow to 4, but b is in the way.', 'a moves its 2 blocks past b; then b must grow to 3 and a is right after it, so b moves its 2; then a must grow to 6 with b after it again.', 'a moves 2, b moves 2, a moves 4: 8 blocks copied, as the topic [[fsi-alloc]] shows.'],
    solution: 8, wrong: [0, 6, 4] });

  const AROWS = ['contiguous', 'linked', 'FAT', 'extents', 'indexed'];
  const AREADS = { contiguous: '2', linked: '9', FAT: '3', extents: '2', indexed: '3' }, AREF = { contiguous: 'yes', linked: 'no', FAT: 'no', extents: 'no', indexed: 'no' };
  const acells = (rd, rf) => Object.fromEntries(AROWS.flatMap((m) => [[m + '|disk reads to reach file block 7', rd(m)], [m + '|can refuse a file though enough blocks are free', rf(m)]]));
  const asol = acells((m) => AREADS[m], (m) => AREF[m]);
  C.exercise({ id: 'fi-x-alloc-table', chapter: 'fi-layout', title: 'Five methods side by side', level: 2, kind: 'table',
    text: ['A 10-block file is stored under each of five allocation methods. A program reads one byte of file block 7, with nothing in memory. Count every disk read, the block holding the file\'s inode included. The FAT fits in one block, read once and then kept in memory. Under indexed allocation the inode has 4 direct pointers and a single-indirect pointer; under extents the file has 3 extents, all in the inode. Then say whether each method can refuse to grow a file even though enough blocks are free in all (yes or no).'],
    rows: AROWS, cols: ['disk reads to reach file block 7', 'can refuse a file though enough blocks are free'], corner: 'method', cells: asol, cellKind: 'text',
    hints: ['Every method reads the inode\'s block first and the data block last; the question is what lies between.', 'Linked reads blocks 0 to 6 to follow the chain; FAT follows the same chain in the table; indexed reads the single-indirect block; contiguous and extents compute the block from the inode alone.', 'Reads: contiguous 2, linked 9, FAT 3, extents 2, indexed 3. Only contiguous allocation needs one long enough run, so only it can refuse: yes, no, no, no, no.'],
    solution: asol,
    wrong: [acells((m) => (m === 'linked' ? '8' : AREADS[m]), (m) => AREF[m]), acells((m) => (m === 'FAT' ? '9' : AREADS[m]), (m) => AREF[m]), acells((m) => AREADS[m], (m) => (m === 'extents' ? 'yes' : AREF[m]))] });

  const LG = F.geometry({ bs: 512, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, alloc: 'linked' }), LPAY = F.payload(LG), LB = 1530;
  C.exercise({ id: 'fi-x-linked-block', chapter: 'fi-layout', title: 'A byte in a chain', level: 1, kind: 'number',
    text: ['Linked allocation with blocks of 512 bytes: the last 4 bytes of every block name the next block of the file. Which file block (counting from 0) holds byte ' + LB + ' of the file?'],
    answer: Math.floor(LB / LPAY),
    whyNot: { [String(Math.floor(LB / LG.bs))]: 'That divides by 512, but each block carries only ' + LPAY + ' bytes of data: the pointer takes the rest.', '*': 'Divide the byte number by the bytes of data each block carries.' },
    hints: ['A block carries 512 − 4 bytes of data.', 'That is ' + LPAY + ' bytes, so file block k holds bytes ' + LPAY + '·k to ' + LPAY + '·k + ' + (LPAY - 1) + '.', '⌊' + LB + ' ÷ ' + LPAY + '⌋ = ' + Math.floor(LB / LPAY) + ', at offset ' + (LB % LPAY) + '. Dividing by 512 would give ' + Math.floor(LB / LG.bs) + ', the wrong block.'],
    solution: Math.floor(LB / LPAY), wrong: [Math.floor(LB / LG.bs), 4] });

  const EXT = [[40, 3], [12, 6], [90, 5]], EK = 10;
  const extBlock = (k) => { for (const [s, n] of EXT) { if (k < n) return s + k; k -= n; } return -1; };
  C.exercise({ id: 'fi-x-extent-block', chapter: 'fi-layout', title: 'Through the extents', level: 2, kind: 'number',
    text: ['A file\'s inode records three extents, in file order: ' + EXT.map(([s, n]) => '(' + s + ', ' + n + ')').join(', ') + ', each a (first block, length) pair. Which disk block holds file block ' + EK + '?'],
    answer: extBlock(EK),
    whyNot: { [String(EXT[0][0] + EK)]: 'That treats the file as one run from block ' + EXT[0][0] + '. Skip whole extents first.', [String(extBlock(EK) + 1)]: 'Counting slips by one: file block ' + EK + ' is the ' + (EK - 9 + 1) + 'nd block of the third extent, at index ' + (EK - 9) + '.', '*': 'Subtract each extent\'s length until the rest falls inside one.' },
    hints: ['The first extent holds file blocks 0–2, the second 3–8.', 'File block 10 is past both: 10 − 3 − 6 = 1 into the third extent.', 'The third extent starts at block 90, so file block 10 is block 90 + 1 = ' + extBlock(EK) + '.'],
    solution: extBlock(EK), wrong: [EXT[0][0] + EK, extBlock(EK) + 1] });

  // =========================================================================================================
  // Chapter 1: inodes, the walk to byte N, the largest file
  // =========================================================================================================
  const span = (x) => { const P = x.bs / x.ps; return { P, d: x.ndirect, s: x.ndirect + P, dd: x.ndirect + P + P * P }; };
  const walkHints = (x, first, second) => { const s = solve(x), fb = Math.floor(x.N / x.bs); return [first, second, 'Byte ' + grp(x.N) + ' is in file block ' + grp(fb) + ' at offset ' + s.offset + ': part ' + s.part + ', ' + (s.part === 'direct' ? 'slot ' : 'indices ') + s.indices + '.']; };
  const walkEx = (x, wrongs) => { x.solution = solve(x); x.wrong = wrongs(x.solution); x.hints = walkHints(x, x.hints[0], x.hints[1]); return C.exercise(x); };

  const W1 = { bs: 512, ps: 4, ndirect: 7, levels: 3, N: 3000 }, fb1 = Math.floor(W1.N / W1.bs);
  walkEx(Object.assign({ id: 'fi-x-walk-direct', chapter: 'fi-layout', title: 'A byte near the start', level: 1, kind: 'inode-walk', ask: 'walk',
    text: ['An inode has ' + W1.ndirect + ' direct pointers, then a single, a double and a triple indirect pointer. Blocks are ' + W1.bs + ' bytes and pointers ' + W1.ps + ' bytes. Which part of the inode maps byte ' + W1.N + ' of the file, which slot or indices lead to it, and at what offset in its block is the byte?'],
    hints: ['Byte ' + W1.N + ' is in file block ⌊' + W1.N + ' ÷ ' + W1.bs + '⌋.', 'File block ' + fb1 + ' is below ' + W1.ndirect + ', so a direct pointer maps it: slot ' + fb1 + '.'] }, W1),
  (s) => [Object.assign({}, s, { offset: '0' }), Object.assign({}, s, { part: 'single', indices: s.indices })]);

  const W2 = { bs: 2048, ps: 4, ndirect: 9, levels: 3, N: 200000 }, sp2 = span(W2), fb2 = Math.floor(W2.N / W2.bs);
  walkEx(Object.assign({ id: 'fi-x-walk-single', chapter: 'fi-layout', title: 'Through the single-indirect block', level: 2, kind: 'inode-walk', ask: 'walk',
    text: ['An inode has ' + W2.ndirect + ' direct pointers and one single, double and triple indirect pointer each. Blocks are ' + W2.bs + ' bytes and pointers ' + W2.ps + ' bytes. Find byte ' + grp(W2.N) + ': the part, the index in each indirect block on the way, and the offset in the data block.'],
    hints: ['A block holds ' + W2.bs + ' ÷ ' + W2.ps + ' = ' + sp2.P + ' pointers. The direct part maps file blocks 0–' + (W2.ndirect - 1) + '; the single-indirect part the next ' + sp2.P + ', ' + W2.ndirect + '–' + (sp2.s - 1) + '.', 'Byte ' + grp(W2.N) + ' is in file block ⌊' + W2.N + ' ÷ ' + W2.bs + '⌋ = ' + fb2 + '; subtract the ' + W2.ndirect + ' direct blocks for the index.'] }, W2),
  (s) => [Object.assign({}, s, { indices: String(fb2) }), Object.assign({}, s, { part: 'double', indices: '0, ' + s.indices })]);

  const W3 = { bs: 512, ps: 4, ndirect: 7, levels: 3, N: 5000000 }, sp3 = span(W3), fb3 = Math.floor(W3.N / W3.bs);
  walkEx(Object.assign({ id: 'fi-x-walk-double', chapter: 'fi-layout', title: 'Two levels down', level: 2, kind: 'inode-walk', ask: 'walk',
    text: [W3.ndirect + ' direct pointers, then single, double and triple indirect; blocks of ' + W3.bs + ' bytes, pointers of ' + W3.ps + ' bytes. Find byte ' + grp(W3.N) + ': the part, the index at each level of indirect block (top first), and the offset.'],
    hints: ['P = ' + W3.bs + ' ÷ ' + W3.ps + ' = ' + sp3.P + '. Direct: file blocks 0–' + (W3.ndirect - 1) + '; single: ' + W3.ndirect + '–' + (sp3.s - 1) + '; double: ' + sp3.s + '–' + (sp3.dd - 1) + '.', 'Byte ' + grp(W3.N) + ' is in file block ' + fb3 + ', entry ' + (fb3 - sp3.s) + ' of the double-indirect part: the top index is ' + (fb3 - sp3.s) + ' ÷ ' + sp3.P + ', the next the remainder.'] }, W3),
  (s) => [Object.assign({}, s, { indices: s.indices.split(', ').reverse().join(', ') }), Object.assign({}, s, { indices: Math.floor((fb3 - sp3.d) / sp3.P) + ', ' + ((fb3 - sp3.d) % sp3.P) })]);

  const W4 = { bs: 2048, ps: 4, ndirect: 9, levels: 3, N: 9000000000 }, sp4 = span(W4), fb4 = Math.floor(W4.N / W4.bs), e4 = fb4 - sp4.dd;
  walkEx(Object.assign({ id: 'fi-x-walk-triple', chapter: 'fi-layout', title: 'Three levels down', level: 3, kind: 'inode-walk', ask: 'walk',
    text: [W4.ndirect + ' direct pointers, then single, double and triple indirect; blocks of ' + W4.bs + ' bytes, pointers of ' + W4.ps + ' bytes. A sparse file has data at byte ' + grp(W4.N) + '. Which part maps it, what are the three indices (top first), and what is the offset?'],
    hints: ['P = ' + sp4.P + '. The direct, single and double parts together cover file blocks 0–' + grp(sp4.dd - 1) + '.', 'Byte ' + grp(W4.N) + ' is in file block ' + grp(fb4) + ', entry ' + grp(e4) + ' of the triple part: divide by ' + sp4.P + '² = ' + grp(sp4.P * sp4.P) + ' for the top index, then by ' + sp4.P + ' for the next.'] }, W4),
  (s) => [Object.assign({}, s, { indices: [Math.floor(fb4 / sp4.P / sp4.P), Math.floor(fb4 / sp4.P) % sp4.P, fb4 % sp4.P].join(', ') }), Object.assign({}, s, { offset: String(W4.N % 1000) })]);

  const maxEx = (x, h1, h2) => { x.solution = solve(x); const v = +x.solution; x.answer = v; x.wrong = [String(v + x.bs), String(v - x.ndirect * x.bs)]; x.hints = [h1, h2, 'The largest file is ' + grp(v) + ' bytes.']; return C.exercise(x); };
  const M1 = { bs: 2048, ps: 4, ndirect: 9, levels: 2 }, P1 = M1.bs / M1.ps;
  maxEx(Object.assign({ id: 'fi-x-max-1', chapter: 'fi-layout', title: 'The largest file, two levels', level: 1, kind: 'inode-walk', ask: 'max',
    text: ['An inode has ' + M1.ndirect + ' direct pointers, one single-indirect and one double-indirect pointer, and no triple. Blocks are ' + M1.bs + ' bytes and pointers ' + M1.ps + ' bytes. What is the largest file, in bytes?'] }, M1),
  'Each indirect block holds ' + M1.bs + ' ÷ ' + M1.ps + ' = ' + P1 + ' pointers.', 'The file can have ' + M1.ndirect + ' + ' + P1 + ' + ' + P1 + '² = ' + grp(M1.ndirect + P1 + P1 * P1) + ' blocks of ' + M1.bs + ' bytes.');

  const M2 = { bs: 512, ps: 8, ndirect: 11, levels: 3 }, P2 = M2.bs / M2.ps;
  maxEx(Object.assign({ id: 'fi-x-max-2', chapter: 'fi-layout', title: 'The largest file, wide pointers', level: 2, kind: 'inode-walk', ask: 'max',
    text: ['An inode has ' + M2.ndirect + ' direct pointers and a single, double and triple indirect pointer. Blocks are ' + M2.bs + ' bytes, and pointers are ' + M2.ps + ' bytes wide. What is the largest file, in bytes?'] }, M2),
  'With ' + M2.ps + '-byte pointers a ' + M2.bs + '-byte block holds only ' + P2 + ' of them.', 'Blocks: ' + M2.ndirect + ' + ' + P2 + ' + ' + P2 + '² + ' + P2 + '³ = ' + grp(M2.ndirect + P2 + P2 ** 2 + P2 ** 3) + ', each of ' + M2.bs + ' bytes.');

  // the smallest block size whose largest file reaches 1 TiB (9 direct, three levels, 4-byte pointers)
  const TIB = 2 ** 40, sizes = [512, 1024, 2048, 4096, 8192], ND = 9;
  const fits = sizes.map((bs) => [bs, F.maxFileSize({ bs, ps: 4, ndirect: ND, levels: 3, alloc: 'indexed' })]), best = fits.find(([, m]) => m >= TIB);
  const prev = fits[fits.indexOf(best) - 1];
  C.exercise({ id: 'fi-x-max-design', chapter: 'fi-layout', title: 'A block size for a terabyte', level: 3, kind: 'number',
    text: ['A file system must hold single files of 1 TiB (2⁴⁰ bytes). Its inodes have ' + ND + ' direct pointers and single, double and triple indirect pointers, all 4 bytes. Block sizes may be ' + sizes.join(', ') + ' bytes. What is the smallest block size whose largest file is at least 1 TiB?'],
    answer: best[0],
    whyNot: { [String(prev[0])]: 'With ' + prev[0] + '-byte blocks the largest file is ' + grp(prev[1]) + ' bytes, short of 2⁴⁰ = ' + grp(TIB) + '.', '*': 'For each block size, the triple-indirect part dominates: about (bs ÷ 4)³ × bs bytes.' },
    hints: ['The triple-indirect part maps P³ blocks with P = bs ÷ 4, so the largest file grows like bs⁴ ÷ 64.', 'With ' + prev[0] + '-byte blocks, P = ' + prev[0] / 4 + ' and the largest file is ' + grp(prev[1]) + ' bytes, under 1 TiB.', 'With ' + best[0] + '-byte blocks, P = ' + best[0] / 4 + ' and the largest file is ' + grp(best[1]) + ' bytes, over 2⁴⁰ = ' + grp(TIB) + ': ' + best[0] + ' bytes.'],
    solution: best[0], wrong: [prev[0], 8192] });

  // =========================================================================================================
  // Chapter 1: free space
  // =========================================================================================================
  const FROWS = ['bitmap', 'free list', 'grouping', 'counting'];
  const FC = { 'bitmap|bytes it takes': 7, 'bitmap|disk reads to take 8 blocks': 1, 'free list|bytes it takes': 4, 'free list|disk reads to take 8 blocks': 8, 'grouping|disk reads to take 8 blocks': 1, 'counting|bytes it takes': 88 };
  C.exercise({ id: 'fi-x-free-table', chapter: 'fi-layout', title: 'Four records of the same free blocks', level: 2, kind: 'table',
    text: ['A data region of 49 blocks has 17 free blocks, scattered in 11 separate runs. The system needs 8 free blocks. Fill in the space each record takes and the disk reads to take 8 blocks: the bitmap has one bit per data block (in whole bytes) in a block of its own; the free list keeps only a 4-byte head pointer, and each free block names the next; grouping stores up to 31 free block numbers in one free block; counting keeps a (start, count) pair of two 4-byte numbers for every run.'],
    rows: FROWS, cols: ['bytes it takes', 'disk reads to take 8 blocks'], corner: 'record', cells: FC, cellKind: 'number',
    hints: ['The bitmap: 49 bits round up to 7 bytes, one read. The free list: one read for each block taken, to learn the next.', 'Grouping: all 17 numbers fit in one group block. Counting: one 8-byte pair per run.', 'Bitmap 7 bytes and 1 read; free list 4 bytes and 8 reads; grouping 1 read; counting 11 × 8 = 88 bytes. The topic [[fsi-free]] shows the same free space.'],
    solution: FC, wrong: [Object.assign({}, FC, { 'counting|bytes it takes': 136 }), Object.assign({}, FC, { 'free list|disk reads to take 8 blocks': 1 })] });

  const NB = 100000, BSZ = 1024, bmBlocks = Math.ceil(NB / (BSZ * 8));
  C.exercise({ id: 'fi-x-bitmap-size', chapter: 'fi-layout', title: 'How big is the bitmap?', level: 1, kind: 'number',
    text: ['A data region has ' + grp(NB) + ' blocks of ' + BSZ + ' bytes, and the data bitmap has one bit per data block. How many blocks does the bitmap take?'],
    answer: bmBlocks,
    whyNot: { [String(Math.ceil(NB / BSZ))]: 'That is one byte per block. A bitmap uses one bit, and a block holds ' + BSZ * 8 + ' bits.', [String(bmBlocks - 1)]: 'Round up: the last few bits still need a whole block.', '*': 'A block of ' + BSZ + ' bytes holds ' + BSZ * 8 + ' bits.' },
    hints: ['One bit per block: ' + grp(NB) + ' bits.', 'A block holds ' + BSZ + ' × 8 = ' + BSZ * 8 + ' bits.', '⌈' + grp(NB) + ' ÷ ' + BSZ * 8 + '⌉ = ' + bmBlocks + ' blocks.'],
    solution: bmBlocks, wrong: [Math.ceil(NB / BSZ), bmBlocks - 1] });

  // =========================================================================================================
  // Chapter 2: lookup and the cost of calls
  // =========================================================================================================
  C.exercise({ id: 'fi-x-lookup-reads', chapter: 'fi-perf', title: 'Reads to find a file', level: 2, kind: 'number',
    text: ['Nothing is in memory. Every directory\'s inode is in an inode-table block of its own, and every directory has one block of entries. Looking up a name in a directory reads its inode\'s block, then its entry block; a block already read in this lookup stays in memory. How many blocks does looking up `/srv/www/../logs/today` read? (The file\'s own inode is not read.)'],
    answer: 8,
    whyNot: { '10': 'The second visit to /srv finds its blocks still in memory: no new reads.', '6': '.. is an entry like any other: it is looked up in /srv/www, whose blocks must be read.', '*': 'List the directories searched in order, and count 2 for each one not seen before.' },
    hints: ['The directories searched, in order: /, srv, www (to find ..), srv again (to find logs), logs (to find today).', 'Each new one costs 2 reads; the second visit to srv costs none.', '/ 2 + srv 2 + www 2 + srv 0 + logs 2 = 8 blocks, as in the "Up with .." example of [[fsi-lookup]].'],
    solution: 8, wrong: [10, 6] });

  const CROWS = ['create', 'write', 'read', 'close', 'delete'], CCOLS = ['reads a directory block', 'writes a bitmap', 'writes a directory block'];
  const CV = { create: ['yes', 'yes', 'yes'], write: ['no', 'yes', 'no'], read: ['no', 'no', 'no'], close: ['no', 'no', 'no'], delete: ['yes', 'yes', 'yes'] };
  const ccells = (f) => Object.fromEntries(CROWS.flatMap((r) => CCOLS.map((c, i) => [r + '|' + c, f(r, i)])));
  const csol = ccells((r, i) => CV[r][i]);
  C.exercise({ id: 'fi-x-costs-table', chapter: 'fi-perf', title: 'What each call touches', level: 2, kind: 'table',
    text: ['A program creates `/docs/report`, writes 3 blocks to it through its descriptor (the file is new, so every block is allocated), reads it back, closes it and deletes it. There is no cache. For each call, does it read a directory block, write a bitmap, write a directory block? Answer yes or no.'],
    rows: CROWS, cols: CCOLS, corner: 'call', cells: csol, cellKind: 'text',
    hints: ['create and delete work on a path; write and read work through an open descriptor, which already names the inode.', 'create allocates an inode (its bitmap) and adds an entry; write allocates data blocks (their bitmap); delete frees both and removes the entry.', 'create: yes, yes, yes. write: no, yes, no. read: no, no, no. close: no, no, no (only the open-file entry goes). delete: yes, yes, yes.'],
    solution: csol, wrong: [ccells((r, i) => (r === 'write' && i === 0 ? 'yes' : CV[r][i])), ccells((r, i) => (r === 'close' && i === 2 ? 'yes' : CV[r][i]))] });

  // =========================================================================================================
  // Chapter 2: the buffer cache
  // =========================================================================================================
  const STREAM = 'r3 w20 r3 w20 r4 w21 r3 w20 r4 w21 r5 w20 r3'.split(' ');
  const cacheRun = (policy, stream, cap) => {
    const c = new F.Cache({ capacity: cap, policy, sync: 0, unified: true });
    for (const s of stream) { const k = +s.slice(1); if (s[0] === 'r') c.read(k, k < 16 ? 'meta' : 'data'); else c.write(k, k < 16 ? 'meta' : 'data'); }
    c.flush();
    return c.stats;
  };
  const WB = cacheRun('write-back', STREAM, 4), WT = cacheRun('write-through', STREAM, 4);
  const KROWS = [['read hits', 'hits'], ['disk reads', 'reads'], ['disk writes', 'writes']];
  const kcells = (f) => Object.fromEntries(KROWS.flatMap(([name, k]) => [[name + '|write-back', f('wb', k)], [name + '|write-through', f('wt', k)]]));
  const ksol = kcells((p, k) => (p === 'wb' ? WB : WT)[k]);
  C.exercise({ id: 'fi-x-cache-table', chapter: 'fi-perf', title: 'Write-back against write-through', level: 2, kind: 'table',
    text: ['A buffer cache of 4 blocks starts empty and evicts the least recently used block. The accesses are `' + STREAM.join(' ') + '` (r reads a block, w writes a whole block, so a write miss reads nothing). At the end a sync writes every dirty block. Fill in the read hits, disk reads and disk writes, for a write-back cache and for a write-through one.'],
    rows: KROWS.map((r) => r[0]), cols: ['write-back', 'write-through'], corner: 'count', cells: ksol, cellKind: 'number',
    hints: ['Reads behave the same under both policies; only when the disk is written differs.', 'Blocks 3, 20, 4 and 21 fill the cache; r5 evicts the least recently used, block 3, which is then read again at the end.', 'Both: ' + WB.hits + ' read hits and ' + WB.reads + ' disk reads. Write-back writes ' + WB.writes + ' blocks (20 and 21, once each, at the sync); write-through writes ' + WT.writes + ', one per write call.'],
    solution: ksol, wrong: [kcells((p, k) => (p === 'wb' && k === 'writes' ? WT.writes : (p === 'wb' ? WB : WT)[k])), kcells((p, k) => (k === 'hits' ? (p === 'wb' ? WB : WT)[k] + 3 : (p === 'wb' ? WB : WT)[k]))] });

  const CR = 'w20 r3 w21 w20 r4 w22 w3 r5'.split(' '), CUT = 6;
  const crashCache = new F.Cache({ capacity: 4, policy: 'write-back', sync: 0, unified: true });
  CR.slice(0, CUT).forEach((s) => { const k = +s.slice(1); if (s[0] === 'r') crashCache.read(k); else crashCache.write(k); });
  const lost = crashCache.snapshot().filter((b) => b.dirty).map((b) => +b.key).sort((a, b) => a - b), lostSet = '{' + lost.join(', ') + '}';
  C.exercise({ id: 'fi-x-cache-crash', chapter: 'fi-perf', title: 'What a crash loses', level: 2, kind: 'set',
    text: ['A write-back cache of 4 blocks, least recently used evicted first, with no periodic sync. The accesses are `' + CR.join(' ') + '`, and the power fails after the ' + CUT + 'th one. A dirty block that was evicted was written to the disk then. Which blocks\' changes are lost? Answer as a set, like {7, 9}.'],
    answer: lostSet,
    hints: ['A write marks the cached copy dirty; it reaches the disk only when evicted (or synced, which never happens here).', 'After 6 accesses the cache has held 20, 3, 21, 4 and 22: the 5th distinct block evicts the least recently used one, block 3, which is clean.', 'Still dirty in the cache when the power fails: ' + lostSet + '. Block 20 was written twice, but only its last version mattered, and it never reached the disk.'],
    solution: lostSet, wrong: ['{20, 21}', '{20, 21, 22, 3}'], whyNot: 'Only blocks written and still dirty in the cache at the cut are lost; w3 and r5 come after the cut and never happen.' });

  // a small LRU write-back cache written in C; the expected counts come from S.FS.Cache
  const LRU_HEAD = '#include <stdio.h>\n#include <stdlib.h>\n\n#define CAP 4\n\nint key[CAP];      /* the block in each slot */\nint dirty[CAP];    /* 1 if changed since it was read or written home */\nint last[CAP];     /* the time it was last used; 0: an empty slot */\nint now = 0;\nint hits = 0;\nint reads = 0;\nint writes = 0;\n\n';
  const LRU_MAIN = '\nint main(void) {\n    char line[32];\n    while (fgets(line, sizeof line, stdin))\n        if (line[0] == \'r\' || line[0] == \'w\')\n            access_block(line[0], atoi(line + 1));\n    /* the final sync */\n    for (int i = 0; i < CAP; i++)\n        if (last[i] && dirty[i])\n            writes++;\n    printf("hits %d, disk reads %d, disk writes %d\\n", hits, reads, writes);\n    return 0;\n}\n';
  const LRU_BODY = 'void access_block(char op, int b) {\n    now++;\n    int s = -1;\n    for (int i = 0; i < CAP; i++)\n        if (last[i] && key[i] == b)\n            s = i;\n    if (s < 0) {\n        s = 0;\n        for (int i = 1; i < CAP; i++)\n            if (last[i] < last[s])\n                s = i;\n        if (last[s] && dirty[s])\n            writes++;\n        key[s] = b;\n        dirty[s] = 0;\n        if (op == \'r\')\n            reads++;\n    } else if (op == \'r\') {\n        hits++;\n    }\n    last[s] = now;\n    if (op == \'w\')\n        dirty[s] = 1;\n}\n';
  const LRU_START = LRU_HEAD + '/* one access: op is \'r\' or \'w\', b the block number */\nvoid access_block(char op, int b) {\n    now++;\n    /* find b in the cache; on a miss take an empty slot or the least recently used one */\n}\n' + LRU_MAIN;
  const LRU_SOL = LRU_HEAD + LRU_BODY + LRU_MAIN;
  const S2 = 'w7 w8 r1 w7 r2 r1 w9 r3 w8 r1 r2 w7 r4 r1'.split(' ');
  const out = (st) => 'hits ' + st.hits + ', disk reads ' + st.reads + ', disk writes ' + st.writes + '\n';
  const T1 = cacheRun('write-back', STREAM, 4), T2 = cacheRun('write-back', S2, 4);
  C.exercise({ id: 'fi-x-code-lru', chapter: 'fi-perf', title: 'A buffer cache in C', level: 3, kind: 'code',
    text: ['Finish `access_block` so that the program counts what a write-back buffer cache of 4 blocks does. It reads one access a line, like `r3` or `w20`. A read hit costs nothing; a read miss is one disk read. A write marks the cached block dirty and never reads the disk, since the whole block is written. A miss takes an empty slot if there is one, else evicts the least recently used block, writing it first if it is dirty. `main` already counts the final sync. For the input `' + STREAM.join(' ') + '`, one access a line, it must print the line below; a second test feeds it another stream:', { code: out(T1), lang: 'text' }],
    starter: LRU_START,
    tests: [{ name: 'the lesson\'s stream', input: STREAM.join('\n') + '\n', stdout: out(T1) }, { name: 'another stream', input: S2.join('\n') + '\n', stdout: out(T2) }],
    hints: ['Search the slots for b (a used slot is one with last[i] != 0). Found: a hit if it is a read.', 'On a miss, choose the slot with the smallest last[] (an empty slot has 0, so it is taken first); if that slot is used and dirty, count a write. A read miss counts a disk read; a write miss does not.', LRU_BODY.replace(/\n\s*/g, ' ').trim()],
    solution: LRU_SOL,
    wrong: [LRU_SOL.replace("        if (op == 'r')\n            reads++;\n", '        reads++;\n'), LRU_SOL.replace('        if (last[s] && dirty[s])\n            writes++;\n', '')] });

  // =========================================================================================================
  // Chapter 2: cylinder groups
  // =========================================================================================================
  C.exercise({ id: 'fi-x-ffs', chapter: 'fi-perf', title: 'Where does it go?', level: 1, kind: 'choice',
    text: ['A disk is split into cylinder groups, as in the fast file system. Directory /b lives in group 2. A program creates `/b/notes` and writes two blocks to it. Where are the new inode and its blocks put, if there is room?'],
    options: ['The inode in the group with the most free inodes, the blocks anywhere', 'The inode in group 2, the blocks in group 2 near it', 'The inode in group 0, where the root is, the blocks in group 2', 'The inode and blocks in the first group with room'],
    answer: 1, whyNot: { 0: 'That is the rule for a new directory, which spreads directories over the groups. A file stays with its directory.', 2: 'Nothing ties a file to the root\'s group: it goes with its own directory.', 3: 'Filling the first group would put unrelated files together and related ones apart.' },
    hints: ['Files of one directory are often used together.', 'The goal is that a directory, its files\' inodes and their data are a short seek apart.', 'Group 2: the file\'s inode in its directory\'s group, and its data blocks near the inode. Only a new directory goes to a group with many free inodes.'],
    solution: 1, wrong: [0, 3] });
})(globalThis.Proses = globalThis.Proses || {});
