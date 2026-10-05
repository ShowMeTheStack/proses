// Part 10, main memory: the exercises of chapter 2 (the TLB, the access time, the reach, an address split in C) and
// chapter 3 (page-table walks, what the tables cost, hashed and inverted tables). Every number in a text, an answer
// or a hint is worked out here by the engines (S.Mem); the C program's expected output comes from S.Mem.split.
(function (S) {
  'use strict';
  const C = S.Content, M = S.Mem;
  if (!C || !M || C.exercises.has('mm-x-tlb-table')) return;
  const solve = (x) => S.Check.kinds[x.kind].solve(x);
  const hx = (v) => '0x' + BigInt(v).toString(16);

  // =========================================================================================================
  // Chapter 2: the TLB
  // =========================================================================================================
  const TR = [2, 9, 2, 5, 13, 9, 2, 17, 5, 9, 2, 13];
  const tfull = M.tlbRun({ entries: 4, ways: 0, refs: TR, levels: 3, tlbNs: 1, memNs: 100 });
  const trows = TR.map((p, i) => (i + 1) + ': page ' + p);
  const tcells = (f) => Object.fromEntries(trows.map((r, i) => [r + '|hit or miss', f(i)]));
  const hm = (i) => (tfull.steps[i].hit ? 'hit' : 'miss');
  C.exercise({ id: 'mm-x-tlb-table', chapter: 'mm-paging', title: 'Hits and misses in a small TLB', level: 2, kind: 'table',
    text: ['A TLB holds 4 translations, fully associative (any page in any entry), and replaces the least recently used entry when it is full. It starts empty. For each page referenced, write hit or miss.'],
    rows: trows, cols: ['hit or miss'], corner: 'reference', cells: tcells(hm), cellKind: 'text',
    hints: ['The first touch of every page is a miss. A hit makes that entry the most recently used.', 'After reference 5 the TLB holds 9, 2, 5 and 13; page 17 then evicts the least recently used of them.', 'In order: ' + TR.map((p, i) => p + ' ' + hm(i)).join(', ') + '. ' + tfull.hits + ' hits and ' + tfull.misses + ' misses.'],
    solution: tcells(hm), wrong: [tcells((i) => (i === 8 ? 'hit' : hm(i))), tcells((i) => (i === 10 ? 'miss' : hm(i)))] });

  const tdir = M.tlbRun({ entries: 4, ways: 1, refs: TR, levels: 3, tlbNs: 1, memNs: 100 });
  C.exercise({ id: 'mm-x-tlb-direct', chapter: 'mm-paging', title: 'The same TLB, direct-mapped', level: 3, kind: 'number',
    text: ['The same 12 references, ' + TR.join(', ') + ', now go to a direct-mapped TLB of 4 entries: page p may only use entry p mod 4. It starts empty. How many hits?'],
    answer: tdir.hits, whyNot: { [String(tfull.hits)]: 'That is the fully associative TLB, where any page can use any entry. Here pages with the same p mod 4 fight over one entry.', '*': 'Work out p mod 4 for every page; a page evicts whatever is in its one entry.' },
    hints: ['p mod 4: 2 → 2, 9 → 1, 5 → 1, 13 → 1, 17 → 1. Four of the five pages share entry 1.', 'Page 2 has entry 2 to itself, so only its first touch misses. Pages 9, 5, 13 and 17 keep evicting each other.', 'Hits: ' + TR.map((p, i) => (tdir.steps[i].hit ? 'reference ' + (i + 1) + ' (page ' + p + ')' : null)).filter(Boolean).join(', ') + ': ' + tdir.hits + ' hits, against ' + tfull.hits + ' when fully associative.'],
    solution: tdir.hits, wrong: [tfull.hits, 0] });

  const SWP = [{ asid: 1, refs: [3, 4, 3, 4, 3, 4, 3, 4] }, { asid: 2, refs: [3, 8, 9, 3, 8, 9] }];
  const swRun = (mode) => M.switchRun({ entries: 8, ways: 0, procs: SWP, quantum: 2, mode, levels: 4, tlbNs: 1, memNs: 100 });
  const sA = swRun('asid'), sF = swRun('flush');
  C.exercise({ id: 'mm-x-asid', chapter: 'mm-paging', title: 'Tagged entries', level: 2, kind: 'number',
    text: ['Process A (ASID 1) references pages ' + SWP[0].refs.join(', ') + '; process B (ASID 2) references pages ' + SWP[1].refs.join(', ') + '. They take turns of 2 references, A first, on an 8-entry TLB that never fills up. Each entry is tagged with its ASID, so nothing is flushed at a switch, and A\'s page 3 is not B\'s page 3. How many hits in all?'],
    answer: sA.hits, whyNot: { [String(sF.hits)]: 'That is the TLB flushed at every switch. With tags, entries survive the switch.', '*': 'A hit needs the same page and the same ASID; the first touch of each (ASID, page) misses.' },
    hints: ['Every reference that is not the first touch of its (ASID, page) pair hits, because 8 entries never fill.', 'A touches 2 distinct pages, B touches 3; page 3 is touched by both, but those are different pairs.', 'Misses: 2 for A and 3 for B, 5 in all, so ' + sA.hits + ' of 14 hit (A ' + sA.perProc[0].hits + ', B ' + sA.perProc[1].hits + '). Flushing at every switch would give ' + sF.hits + ' hits.'],
    solution: sA.hits, wrong: [sF.hits, 14] });

  // =========================================================================================================
  // Chapter 2: the access time and the reach
  // =========================================================================================================
  const E = { hit: 0.95, tlbNs: 2, memNs: 80, levels: 3 };
  const eat = M.eat(E), eHit = M.eat(Object.assign({}, E, { hit: 1 })), eMiss = M.eat(Object.assign({}, E, { hit: 0 }));
  C.exercise({ id: 'mm-x-eat', chapter: 'mm-paging', title: 'The effective access time', level: 2, kind: 'number',
    text: ['A TLB lookup takes 2 ns and a memory access 80 ns. The page table has 3 levels. The TLB hits 95% of the time. What is the effective access time, in ns?'],
    answer: eat, tolerance: 0.01, whyNot: { [String(+(0.95 * 82 + 0.05 * 162).toFixed(2))]: 'That counts one table read on a miss; a 3-level table needs 3 reads before the data.', '82': 'That is a hit; misses must be weighed in.', '*': 'A hit costs 2 + 80; a miss 2 + 3 × 80 + 80.' },
    hints: ['A hit: the TLB, then the data: ' + eHit + ' ns.', 'A miss: the TLB, 3 table reads, then the data: ' + eMiss + ' ns.', 'EAT = 0.95 × ' + eHit + ' + 0.05 × ' + eMiss + ' = ' + eat + ' ns.'],
    solution: eat, wrong: [82, +(0.95 * 82 + 0.05 * 162).toFixed(2)] });

  const target = 1.2 * E.memNs, need = (eMiss - target) / (eMiss - eHit), need3 = +need.toFixed(3);
  C.exercise({ id: 'mm-x-eat-ratio', chapter: 'mm-paging', title: 'How good must the TLB be?', level: 3, kind: 'number',
    text: ['On the same machine (TLB 2 ns, memory 80 ns, 3 levels), the designers want memory to be at most 20% slower than with no translation: an effective access time of at most ' + target + ' ns. What is the smallest hit ratio that achieves it? Give it to 3 decimals.'],
    answer: need3, tolerance: 0.0006, whyNot: { '0.8': 'That is 1 − 20%; the hit ratio needed depends on how much a miss costs.', '*': 'Solve h × ' + eHit + ' + (1 − h) × ' + eMiss + ' = ' + target + ' for h.' },
    hints: ['Write EAT as a function of h: h × hit time + (1 − h) × miss time, with hit ' + eHit + ' ns and miss ' + eMiss + ' ns.', 'EAT = ' + eMiss + ' − h × (' + eMiss + ' − ' + eHit + ') = ' + eMiss + ' − ' + (eMiss - eHit) + 'h.', eMiss + ' − ' + (eMiss - eHit) + 'h ≤ ' + target + ' gives h ≥ ' + (eMiss - target) + ' / ' + (eMiss - eHit) + ' = ' + need.toFixed(4) + ': about ' + need3 + '. Fewer than ' + ((1 - need) * 100).toFixed(1) + ' misses in 100.'],
    solution: need3, wrong: [0.8, 0.95] });

  const reach = M.tlbReach(128, 2 * 1048576), reachSmall = M.tlbReach(128, 4096);
  C.exercise({ id: 'mm-x-reach', chapter: 'mm-paging', title: 'TLB reach', level: 1, kind: 'number',
    text: ['A TLB has 128 entries and every page is a 2 MiB large page. How many MiB can it map at once?'],
    answer: reach / 1048576, whyNot: { [String(reachSmall / 1024)]: 'That is the reach in KiB with 4 KiB pages.', '128': 'That is the number of entries; each maps a whole page.', '*': 'Reach = entries × page size.' },
    hints: ['Each entry maps one page.', 'Reach = 128 × 2 MiB.', '128 × 2 MiB = ' + M.bytes(reach) + ', against ' + M.bytes(reachSmall) + ' with 4 KiB pages.'],
    solution: reach / 1048576, wrong: [128, reachSmall / 1024] });

  // ---- the split in C ------------------------------------------------------------------------------------------------
  const CADDR = [0x0804a9c4, 0xbfffeffc, 0x00401000];
  const cfg32 = M.config({ vaBits: 32, pageBytes: 4096, bits: [10, 10], pteBytes: 4 });
  const cout = CADDR.map((a) => M.split(cfg32, BigInt(a)).map((f) => String(f.value)).join(' ') + '\n').join('');
  const CSTART = '#include <stdio.h>\n\n/* 32-bit addresses, 4 KiB pages, a two-level table: 10 | 10 | 12 bits */\nvoid split(unsigned va) {\n    unsigned l1 = 0, l2 = 0, off = 0;\n    /* fill in l1, l2 and off with shifts and masks */\n\n    printf("%u %u %u\\n", l1, l2, off);\n}\n\nint main(void) {\n    split(0x0804a9c4);\n    split(0xbfffeffc);\n    split(0x00401000);\n    return 0;\n}\n';
  const CBODY = '    l1 = va >> 22;\n    l2 = (va >> 12) & 0x3ff;\n    off = va & 0xfff;\n';
  const CSOL = CSTART.replace('    /* fill in l1, l2 and off with shifts and masks */\n\n', '    /* fill in l1, l2 and off with shifts and masks */\n' + CBODY);
  C.exercise({ id: 'mm-x-code-split', chapter: 'mm-paging', title: 'Split an address in C', level: 2, kind: 'code',
    text: ['The MMU splits an address with wires; software that walks page tables (a kernel, a debugger) does it with shifts and masks. Finish `split` so it prints the top-level index, the second-level index and the offset of a 32-bit address under a 10 | 10 | 12 layout. The program must print:', { code: cout, lang: 'text' }],
    starter: CSTART,
    tests: [{ name: 'three addresses', stdout: cout }],
    hints: ['The offset is the low 12 bits: mask with 0xfff. The top index is what is left after shifting the low 22 bits away.', 'The middle index sits in bits 12 to 21: shift right by 12, then keep 10 bits with & 0x3ff.', CBODY.replace(/\n\s*/g, ' ').trim()],
    solution: CSOL,
    wrong: [CSOL.replace('l2 = (va >> 12) & 0x3ff;', 'l2 = va >> 12;'), CSOL.replace('off = va & 0xfff;', 'off = va & 0x3ff;')] });

  // =========================================================================================================
  // Chapter 3: walks
  // =========================================================================================================
  /** a page-walk exercise with its solution and wrong answers (the physical address forgotten, an index off) */
  const walkEx = (x, wrongs) => {
    x.solution = solve(x);
    x.wrong = wrongs(x.solution);
    return C.exercise(x);
  };
  const tablesNote = (x) => {
    const cfg = M.config(x), pt = M.build(cfg, x.map.map(([v, p]) => [BigInt(v), BigInt(p)]));
    const seen = new Map();
    for (const [v] of x.map) {
      const t = M.translate(pt, BigInt(v) << BigInt(cfg.offBits));
      t.steps.filter((s) => s.kind === 'read' && s.level < cfg.levels - 1).forEach((s) => { const key = 'L' + (s.level + 2) + ' table for ' + t.fields.slice(0, s.level + 1).map((f) => f.name + ' = ' + f.value).join(', '); if (!seen.has(key)) seen.set(key, hx(s.next)); });
    }
    return 'The root table is in frame 0x100; ' + [...seen.entries()].map(([k, f]) => 'the ' + k + ' is in frame ' + f).join('; ') + '.';
  };
  const W16 = { vaBits: 16, pageBytes: 256, levels: 2, bits: [2, 6], pteBytes: 2, map: [[0x5a, 0x13], [0x5b, 0x2c], [0x9e, 0x07]], va: '0x5b3c' };
  walkEx(Object.assign({ id: 'mm-x-walk-16', chapter: 'mm-tables', title: 'Walk a two-level table', level: 2, kind: 'page-walk',
    text: ['16-bit virtual addresses, 256-byte pages, a two-level table: 2 bits index the root, 6 bits the second level. Entries are 2 bytes. Page 0x5a is in frame 0x13, page 0x5b in frame 0x2c and page 0x9e in frame 0x07. ' + tablesNote(W16), 'Walk the address `0x5b3c`: at each level the index, the physical address of the entry read, and the frame it holds; then the physical address.'],
    hints: ['Split first: 0x5b3c is page 0x5b and offset 0x3c; page 0x5b = 01 011011 in binary, so L1 = 1 and L2 = 27 (0x1b).', 'An entry\'s address is the table\'s frame × 256 + index × 2. The root is in frame 0x100, at 0x10000.', 'L1: entry at 0x10002 holds 0x101; L2: entry at 0x10136 (0x10100 + 27 × 2) holds 0x2c; the physical address is 0x2c3c.'] }, W16),
  (s) => [Object.assign({}, s, { pa: '0x5b3c' }), Object.assign({}, s, { 'L2|entry': '0x1011b' })]);

  const SV = { vaBits: 39, pageBytes: 4096, levels: 3, bits: [9, 9, 9], pteBytes: 8, va: '0x3f_c0a1_7e58' };
  const fsv = M.split(M.config(SV), BigInt(SV.va.replace(/_/g, '')));
  SV.va = SV.va.replace(/_/g, '');
  const svSol = solve(Object.assign({ kind: 'address-split' }, SV));
  C.exercise(Object.assign({ id: 'mm-x-split-sv39', chapter: 'mm-tables', title: 'An Sv39 address', level: 2, kind: 'address-split',
    text: ['RISC-V Sv39 uses 39-bit virtual addresses, 4 KiB pages and three levels of 9 index bits each (512 entries of 8 bytes fill one 4 KiB table). Split `0x3f_c0a1_7e58` into its fields.'],
    hints: ['The low 12 bits are the offset: the last three hex digits, 0xe58.', 'The page number is 0x3f_c0a1_7, 27 bits: cut it 9 | 9 | 9 from the top.', fsv.map((f) => (f.level < 0 ? 'offset' : f.name) + ' = ' + f.value + ' (0x' + f.value.toString(16) + ')').join(', ') + '.'],
    solution: svSol, wrong: [Object.assign({}, svSol, { L3: String(Number(svSol.L3) + 1) }), Object.assign({}, svSol, { L1: '0x3f', L2: '0xc0' })],
    whyNot: 'Cut the 39 bits 9 | 9 | 9 | 12 from the top; 512 entries need 9 bits of index.' }, SV));

  const W32 = { vaBits: 32, pageBytes: 4096, levels: 2, bits: [10, 10], pteBytes: 4, map: [[0x0804a, 0x1f3], [0x0804b, 0x1f4], [0xbfffe, 0x3a0]], va: '0xbfffeffc', ask: ['index', 'next'] };
  walkEx(Object.assign({ id: 'mm-x-walk-32', chapter: 'mm-tables', title: 'A walk near the top of the stack', level: 2, kind: 'page-walk',
    text: ['A 32-bit process (4 KiB pages, 10 | 10 | 12) has three pages mapped: 0x0804a in frame 0x1f3, 0x0804b in frame 0x1f4 and 0xbfffe, near the top of its stack, in frame 0x3a0. ' + tablesNote(W32), 'The stack pointer is `0xbfffeffc`. Give each level\'s index and the frame its entry holds, then the physical address.'],
    hints: ['Split: the offset is 0xffc; the page 0xbfffe splits into its top 10 bits and its low 10 bits.', '0xbfffe = 1011111111 1111111110 in binary: L1 = 767 (0x2ff), L2 = 1022 (0x3fe).', 'L1 entry 767 holds 0x102 (the stack\'s second-level table); L2 entry 1022 holds 0x3a0; the physical address is 0x3a0ffc.'] }, W32),
  (s) => [Object.assign({}, s, { 'L1|next': '0x101' }), Object.assign({}, s, { pa: '0xbfffeffc' })]);

  const W24 = { vaBits: 24, pageBytes: 512, levels: 3, bits: [5, 5, 5], pteBytes: 4, map: [[0x1234, 0x40], [0x1240, 0x41], [0x7c01, 0x42]], va: '0x24e9a0' };
  walkEx(Object.assign({ id: 'mm-x-walk-fault', chapter: 'mm-tables', title: 'Where does the walk stop?', level: 3, kind: 'page-walk',
    text: ['24-bit addresses, 512-byte pages and three levels of 5 index bits each; entries are 4 bytes. Pages 0x1234, 0x1240 and 0x7c01 are mapped (to frames 0x40, 0x41 and 0x42); nothing else is. ' + tablesNote(W24), 'Walk `0x24e9a0`. At the level whose entry is not valid, write fault for the frame it holds, and fault for the physical address; leave out the levels the walk never reaches.'],
    hints: ['512-byte pages: 9 bits of offset. 0x24e9a0 >> 9 = page 0x1274, which splits 5 | 5 | 5 into 4, 19, 20.', 'Page 0x1274 shares its L1 index (4) with 0x1234 and 0x1240, so the root entry is valid. But its L2 index 19 (0x13) belongs to no mapped page.', 'L1: index 4, entry 0x20010, holds 0x101. L2: index 0x13, entry 0x2024c (0x20200 + 19 × 4), not valid: fault. The walk stops after 2 reads.'] }, W24),
  (s) => [Object.assign({}, s, { 'L2|next': '0x102', pa: '0x40' + '1a0' }), Object.assign({}, s, { 'L1|index': '0x24' })]);

  // =========================================================================================================
  // Chapter 3: what the tables cost
  // =========================================================================================================
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  const SPACE = [['code', 0x00400, 24], ['heap', 0x00b80, 300], ['library', 0x40000, 40], ['stack', 0xbffe0, 32]];
  const spaceText = SPACE.map(([n, a, k]) => n + ': ' + k + ' pages from page 0x' + a.toString(16)).join('; ');
  const ptOf = (cfg) => { let f = 0x1000n; const map = SPACE.flatMap(([, a, k]) => range(a, k)).map((v) => [BigInt(v), f++]); return M.build(cfg, map); };
  const u2 = M.usage(ptOf(M.config({ vaBits: 32, pageBytes: 4096, bits: [10, 10], pteBytes: 4 })));
  const tops = new Set(SPACE.flatMap(([, a, k]) => range(a, k)).map((v) => v >> 10));
  C.exercise({ id: 'mm-x-tables-count', chapter: 'mm-tables', title: 'How many tables?', level: 2, kind: 'number',
    text: ['A 32-bit process with 4 KiB pages and a 10 | 10 | 12 two-level table maps four regions, given in page numbers: ' + spaceText + '. Each table has 1024 entries of 4 bytes. How many tables does it need, the root included?'],
    answer: u2.tables, whyNot: { [String(SPACE.length + 1)]: 'One table per region is not enough: the heap\'s pages run past the end of one second-level table.', '*': 'A second-level table covers 1024 consecutive pages: count the different top-10-bit values the mapped pages have.' },
    hints: ['A second-level table covers the 1024 pages that share the same top 10 bits.', 'The top 10 bits of a page number are the page number ÷ 1024. The heap runs from page 0xb80 to 0x' + (0xb80 + 299).toString(16) + '.', 'Top indexes used: ' + [...tops].map((t) => '0x' + t.toString(16)).join(', ') + ', so ' + tops.size + ' second-level tables and the root: ' + u2.tables + ' tables, ' + M.bytes(u2.bytes) + '.'],
    solution: u2.tables, wrong: [SPACE.length + 1, SPACE.length] });

  const cfg3 = M.config({ vaBits: 32, pageBytes: 4096, bits: [4, 8, 8], pteBytes: 4 }), u3 = M.usage(ptOf(cfg3));
  C.exercise({ id: 'mm-x-table-bytes', chapter: 'mm-tables', title: 'Three levels instead of two', level: 3, kind: 'number',
    text: ['The same four regions (' + spaceText + '), 4-byte entries, 4 KiB pages, but now three levels of 4 | 8 | 8 index bits: a root of 16 entries, then tables of 256 entries. How many bytes do the page tables take in all? (With two levels of 10 | 10 they take ' + u2.bytes + '.)'],
    answer: u3.bytes, whyNot: { [String(u2.bytes)]: 'That is the two-level layout from the question.', '*': 'Count the tables at each level: a level-3 table covers 256 pages, a level-2 table 65536.' },
    hints: ['Level 3: one table for each run of 256 pages that holds a mapped page. Level 2: one table for each run of 65536 pages.', 'Tables by level: ' + u3.perLevel.join(', ') + ' (root first).', 'Root ' + 16 * 4 + ' bytes; level 2 and level 3 tables 256 × 4 = 1024 bytes each: ' + u3.perLevel[0] + ' × 64 + ' + u3.perLevel[1] + ' × 1024 + ' + u3.perLevel[2] + ' × 1024 = ' + u3.bytes + ' bytes, against ' + u2.bytes + ' with two levels.'],
    solution: u3.bytes, wrong: [u2.bytes, u3.tables * 4096] });

  // =========================================================================================================
  // Chapter 3: hashed and inverted tables
  // =========================================================================================================
  const HMAP = [[5, 3], [13, 8], [21, 11], [6, 2], [29, 14], [14, 7]];
  const H = M.hpt({ buckets: 8, pageBytes: 4096, vaBits: 32 });
  for (const [v, p] of HMAP) H.insert(v, p);
  const hl = H.lookup(13, 0), hlMiss = H.lookup(37, 0);
  C.exercise({ id: 'mm-x-hashed', chapter: 'mm-tables', title: 'A lookup in a hashed table', level: 2, kind: 'number',
    text: ['A hashed page table has 8 buckets; page p goes to bucket p mod 8, and each new entry goes at the head of its bucket\'s chain. Pages were inserted in this order (page → frame): ' + HMAP.map(([v, p]) => v + ' → ' + p).join(', ') + '. How many memory accesses does a reference to page 13 take: the bucket, every node read on the chain, and the data itself?'],
    answer: hl.accesses, whyNot: { '3': 'That would be the case if 13 were first in its chain; later inserts went in front of it.', '*': 'Find the order of the chain in bucket 13 mod 8, newest first.' },
    hints: ['13 mod 8 = 5. Pages 5, 13, 21 and 29 all hash to bucket 5.', 'New entries go at the head, so the chain reads 29, 21, 13, 5.', 'The bucket (1), nodes 29, 21 and 13 (3), then the data (1): ' + hl.accesses + ' accesses. A missing page such as 37 would cost ' + hlMiss.accesses + ', reading the whole chain to find it is not there.'],
    solution: hl.accesses, wrong: [3, 6] });

  const IPL = [[0, 2, 5], [1, 1, 9], [2, 3, 1], [3, 1, 5], [4, 2, 1], [5, 1, 13], [6, 3, 6], [7, 2, 8]];
  const IP = M.ipt({ frames: 8, anchors: 4, pageBytes: 4096, vaBits: 32 });
  for (const [f, pid, v] of IPL) IP.place(f, pid, v);
  const il = IP.lookup(1, 5, 0);
  C.exercise({ id: 'mm-x-inverted', chapter: 'mm-tables', title: 'Find the frame', level: 2, kind: 'number',
    text: ['An inverted page table has 8 entries, one per frame, and 4 hash anchors. (pid, page) hashes to anchor (page + 7 × pid) mod 4, and a page placed in a frame goes at the head of its anchor\'s chain. Frames were filled in this order (frame: pid, page): ' + IPL.map(([f, pid, v]) => f + ': (' + pid + ', ' + v + ')').join(', ') + '. Process 1 references its page 5. Which frame is it in?'],
    answer: il.frame, whyNot: { '5': 'That is the page number. In an inverted table the frame is the position of the matching entry.', '*': 'Hash (1, 5), then follow that anchor\'s chain until the entry holds (1, 5).' },
    hints: ['(1, 5) hashes to (5 + 7) mod 4 = ' + IP.hash(1, 5) + '.', 'The chain of anchor ' + IP.hash(1, 5) + ' holds, newest first, every placed page that hashes there.', 'The lookup visits entries ' + il.chain.join(', ') + ' and finds (1, 5) in entry ' + il.frame + ': frame ' + il.frame + ', after ' + il.accesses + ' memory accesses with the data.'],
    solution: il.frame, wrong: [5, 0] });

  C.exercise({ id: 'mm-x-which-design', chapter: 'mm-tables', title: 'Which table grows with what?', level: 1, kind: 'choice',
    text: ['A machine has 4 GiB of memory and runs hundreds of processes, each with a 64-bit address space it barely uses. Which page-table design takes memory in proportion to the physical memory, whatever the processes do?'],
    options: ['One flat table per process', 'A multilevel table per process', 'A hashed table per process', 'One inverted table for the whole machine'],
    answer: 3, whyNot: { 0: 'A flat table has an entry for every page of the address space: for 64 bits, far more than any memory.', 1: 'A multilevel table grows with the stretches of each address space in use, per process.', 2: 'A hashed table grows with the pages each process maps.' },
    hints: ['Ask what each design has one entry for.', 'Flat: every virtual page. Multilevel: the stretches in use. Hashed: every mapped page. Inverted: ...', 'The inverted table has one entry per physical frame, so its size is fixed by the memory, and one table serves every process.'],
    solution: 3, wrong: [0, 2] });
})(globalThis.Proses = globalThis.Proses || {});
