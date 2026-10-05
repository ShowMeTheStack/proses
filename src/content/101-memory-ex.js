// Part 10, main memory: the exercises of chapter 1 (base and bounds, the fits, compaction, segmentation) and the
// first of chapter 2 (the address split, the flat table, internal fragmentation). Every number in a text, an answer
// or a hint is worked out here by the engines (S.Mem): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, M = S.Mem;
  if (!C || !M || C.exercises.has('mm-x-bb-pa')) return;
  const solve = (x) => S.Check.kinds[x.kind].solve(x);
  /** an address-split exercise with its solution, and wrong answers: one field off, and the split of a wrong layout */
  const splitEx = (x, alt, whyNot) => {
    x.solution = solve(x);
    const keys = Object.keys(x.solution), w1 = Object.assign({}, x.solution, { [keys[0]]: String(BigInt(x.solution[keys[0]]) + 1n) });
    const w2 = {}; const fs = M.split(M.config(Object.assign({}, x, alt)), BigInt(x.va));
    keys.forEach((k, i) => { const f = k === 'offset' ? fs[fs.length - 1] : fs[i]; w2[k] = String(f ? f.value : 0); });
    x.wrong = [w1, w2];
    x.whyNot = whyNot;
    return C.exercise(x);
  };
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // =========================================================================================================
  // Chapter 1: base and bounds
  // =========================================================================================================
  const BB = { base: 36864, limit: 8192 }, bbA = 5000, bbR = M.baseBounds(BB, bbA);
  C.exercise({ id: 'mm-x-bb-pa', chapter: 'mm-binding', title: 'Relocate an address', level: 1, kind: 'number',
    text: ['A process runs with base register ' + BB.base + ' and limit register ' + BB.limit + '. It reads logical address ' + bbA + '. Which physical address does the MMU send to memory?'],
    answer: bbR.pa, whyNot: { [String(bbA)]: 'That is the logical address itself: the MMU adds the base before the address leaves the CPU.', [String(BB.base + BB.limit)]: 'That is base + limit, the first byte past the process. Add the address, not the limit.', '*': 'Check the address against the limit, then add the base.' },
    hints: ['First the check: is ' + bbA + ' below the limit, ' + BB.limit + '?', 'It is, so the address is relocated: the base register is added to it.', bbR.steps.map((s) => s.say).join(' ')],
    solution: bbR.pa, wrong: [bbA, BB.base + BB.limit] });

  const trapAddrs = [0, 4095, 8191, 8192, 9000, 40000];
  const traps = trapAddrs.filter((a) => !M.baseBounds(BB, a).ok);
  C.exercise({ id: 'mm-x-bb-trap', chapter: 'mm-binding', title: 'Which addresses trap?', level: 1, kind: 'set',
    text: ['The same process (base ' + BB.base + ', limit ' + BB.limit + ') issues the logical addresses ' + list(trapAddrs.map(String)) + '. Which of them make the MMU trap with a protection fault? Answer as a set, like {1, 2}.'],
    answer: '{' + traps.join(', ') + '}',
    hints: ['The MMU compares the logical address with the limit, not the physical address with anything.', 'An address passes only if it is strictly below the limit: the last legal address is ' + (BB.limit - 1) + '.', 'Trap: {' + traps.join(', ') + '}. ' + M.baseBounds(BB, 8192).steps.map((s) => s.say).join(' ')],
    solution: '{' + traps.join(', ') + '}', wrong: ['{9000, 40000}', '{40000}'], whyNot: 'An address traps when it is at or past the limit, ' + BB.limit + ', whatever the base is.' });

  C.exercise({ id: 'mm-x-bb-binding', chapter: 'mm-binding', title: 'Coming back somewhere else', level: 1, kind: 'choice',
    text: ['A process is swapped out from physical 428 K and swapped back in at 128 K. Which kind of address binding lets it run at the new place without any change to its code?'],
    options: ['Compile-time binding: the addresses were fixed when it was compiled', 'Load-time binding: the addresses were fixed when it was loaded', 'Run-time binding: the MMU adds a base register on every access'],
    answer: 2, whyNot: { 0: 'Compile-time addresses are physical addresses written into the code: the program could only run at the place it was compiled for.', 1: 'Load-time binding rewrote the addresses for 428 K when the process was loaded; to move, it would have to be loaded again.' },
    hints: ['Ask when the logical address becomes a physical one.', 'Only if that happens on every access can the kernel move the process by changing one register.', 'Run-time binding: the kernel sets the base register to 128 K, and logical address 100 K now means physical 228 K.'],
    solution: 2, wrong: [0, 1] });

  // =========================================================================================================
  // Chapter 1: the four fits
  // =========================================================================================================
  const FIT_OPS = ['A=150', 'B=150', 'C=100', 'D=70', 'E=80', 'F=200', 'G=50', '-B', '-D', '-F', 'P=60', 'Q=90', 'R=150', 'S=120'];
  const FIT_MEM = { memory: 1000, osSize: 100 };
  const parse = (xs) => xs.map((t) => (t[0] === '-' ? { op: 'free', id: t.slice(1) } : { op: 'alloc', id: t.split('=')[0], size: +t.split('=')[1] }));
  const POLS = ['first', 'next', 'best', 'worst'];
  const fitRun = (p) => M.runContig(Object.assign({ policy: p, compact: 'never' }, FIT_MEM), parse(FIT_OPS));
  const FR = Object.fromEntries(POLS.map((p) => [p, fitRun(p)]));
  const late = ['P', 'Q', 'R', 'S'];
  const placed = (p, id) => { const s = FR[p].steps.find((q) => q.id === id && (q.kind === 'alloc' || q.kind === 'fail')); return s.kind === 'fail' ? 'refused' : String(s.start); };
  const fitText = 'Memory has ' + FIT_MEM.memory + ' K and the kernel holds the first ' + FIT_MEM.osSize + ' K. The requests, in K, are `' + FIT_OPS.join(' ') + '` (-B frees B). After the three frees the holes are 150 K at 250, 70 K at 500, 200 K at 650 and 100 K at 900, and the last allocation, G, ended at 900. A block always takes the bottom of the hole it is put in.';
  const fcols = ['first', 'best'], fcells = (f) => Object.fromEntries(late.flatMap((id) => fcols.map((p) => [id + '|' + p + ' fit', f(p, id)])));
  C.exercise({ id: 'mm-x-fit-table', chapter: 'mm-binding', title: 'First fit against best fit', level: 2, kind: 'table',
    text: [fitText, 'Fill in where P, Q, R and S start under first fit and under best fit, or write refused.'],
    rows: late, cols: fcols.map((p) => p + ' fit'), corner: 'request', cells: fcells(placed), cellKind: 'text',
    hints: ['First fit takes the lowest hole that is big enough; best fit the smallest that is big enough. Each request changes the holes for the next.', 'P (60 K): first fit uses the 150 K hole at 250; best fit the 70 K hole at 500, the tightest.', late.map((id) => id + ': first fit ' + placed('first', id) + ', best fit ' + placed('best', id)).join('; ') + '.'],
    solution: fcells(placed),
    wrong: [fcells((p, id) => (p === 'best' && id === 'P' ? '250' : placed(p, id))), fcells((p, id) => (p === 'first' && id === 'S' ? '650' : placed(p, id)))],
    why: 'Best fit kept the 200 K hole whole for R, so it is the only one of the two that places S.' });

  const allIn = POLS.filter((p) => late.every((id) => placed(p, id) !== 'refused'));
  C.exercise({ id: 'mm-x-fit-refuse', chapter: 'mm-binding', title: 'Which fits place them all?', level: 3, kind: 'set',
    text: [fitText, 'Run all four fits: first, next (search from where the last allocation ended, wrapping round), best and worst. Which of them place all four of P, Q, R and S? Answer as a set of names, like {first, worst}.'],
    answer: '{' + allIn.join(', ') + '}',
    hints: ['Write out the holes after each request for each fit; the policies part ways at P already.', 'P goes to 250 under first fit, 900 under next fit (the hole where G ended), 500 under best fit and 650 under worst fit.', POLS.map((p) => p + ' fit: ' + late.map((id) => id + ' ' + placed(p, id)).join(', ')).join('; ') + '. Only {' + allIn.join(', ') + '} places all four.'],
    solution: '{' + allIn.join(', ') + '}', wrong: ['{first, best}', '{best, worst}'], whyNot: 'Follow each fit request by request: a refusal is a request with no hole as large as it.' });

  const ff = FR.first.steps[FR.first.steps.length - 1].frag, extPct = +((ff.external * 100).toFixed(1));
  C.exercise({ id: 'mm-x-ext-frag', chapter: 'mm-binding', title: 'How fragmented?', level: 2, kind: 'number',
    text: [fitText, 'Under first fit, after all the requests (S is refused), what is the external fragmentation, 1 − largest hole / free memory? Give a percentage to one decimal.'],
    answer: extPct, tolerance: 0.11,
    whyNot: { [String(+((ff.largest / ff.free) * 100).toFixed(1))]: 'That is largest / free, the share that is usable as one piece; the fragmentation is the rest.', '*': 'Find the total free memory and the largest hole after S is refused.' },
    hints: ['After P, Q and R, list every hole that is left and add them up.', 'Under first fit ' + ff.free + ' K are free in ' + ff.holes + ' holes, the largest ' + ff.largest + ' K.', '1 − ' + ff.largest + ' / ' + ff.free + ' = ' + extPct + '%. S needs 120 K, which is less than the ' + ff.free + ' K free, yet it is refused.'],
    solution: extPct, wrong: [+((ff.largest / ff.free) * 100).toFixed(1), 0] });

  const cmp = M.compactBlocks(FR.first.blocks, FIT_MEM.osSize);
  const movedIds = cmp.moved.map((m) => m.id);
  C.exercise({ id: 'mm-x-compact-moved', chapter: 'mm-binding', title: 'The price of compaction', level: 2, kind: 'number',
    text: [fitText, 'Under first fit, S is refused. The kernel now compacts: it slides every block down in address order, against the kernel at ' + FIT_MEM.osSize + ' K, so that the free memory becomes one hole. How many K does it copy?'],
    answer: cmp.bytesMoved, whyNot: { [String(FR.first.blocks.reduce((s, b) => s + b.size, 0))]: 'That is every allocated block; a block that already sits against the one below it does not move.', '*': 'Add up the sizes of only the blocks that move.' },
    hints: ['Write the blocks in address order with their starts; a block moves if there is a hole below it.', 'Under first fit the blocks are ' + FR.first.blocks.map((b) => b.id + ' ' + b.size + ' K at ' + b.start).join(', ') + '.', 'The blocks that move are ' + list(cmp.moved.map((m) => m.id + ' (' + m.size + ' K, ' + m.from + ' to ' + m.to + ')')) + ': ' + cmp.bytesMoved + ' K copied. ' + (movedIds.length < FR.first.blocks.length ? 'The others are already packed.' : '')],
    solution: cmp.bytesMoved, wrong: [FR.first.blocks.reduce((s, b) => s + b.size, 0), cmp.moved.length] });

  // =========================================================================================================
  // Chapter 1: segmentation
  // =========================================================================================================
  const SEG = { offBits: 14, segs: [{ name: 'code', base: 8192, limit: 2400, grow: 'up', prot: 'rx' }, { name: 'data', base: 16384, limit: 3000, grow: 'up', prot: 'rw' }, { name: 'heap', base: 24576, limit: 6000, grow: 'up', prot: 'rw' }, { name: 'stack', base: 40960, limit: 3000, grow: 'down', prot: 'rw' }] };
  const segTable = { table: [['Segment', 'Base', 'Limit', 'Grows', 'May']].concat(SEG.segs.map((s, i) => [i + ' ' + s.name, String(s.base), String(s.limit), s.grow, s.prot])), caption: 'The segment table. Offsets have 14 bits, so they run from 0 to 16383.' };
  const sg = M.segTranslate(SEG, { seg: 3, offset: 15000, access: 'w' }), sgLo = (1 << SEG.offBits) - SEG.segs[3].limit;
  C.exercise({ id: 'mm-x-seg-pa', chapter: 'mm-binding', title: 'A byte on the stack', level: 2, kind: 'number',
    text: ['A process has these four segments. The stack grows down, so it holds the top ' + SEG.segs[3].limit + ' offsets of its range.', segTable, 'The process writes to segment 3 (stack), offset 15000. Which physical address does the MMU produce?'],
    answer: sg.pa, whyNot: { [String(40960 + 15000)]: 'That adds the whole offset to the base, as for a segment that grows up. The stack holds only the top of its range.', '*': 'Find where the stack\'s range starts: 16384 − limit.' },
    hints: ['A segment that grows down holds offsets from 2^14 − limit to 2^14 − 1.', 'Here that is ' + sgLo + ' to 16383, so offset 15000 is ' + (15000 - sgLo) + ' bytes above the bottom of the segment.', sg.steps.map((s) => s.say).join(' ')],
    solution: sg.pa, wrong: [40960 + 15000, 40960 + 16384 - 15000] });

  const SA = [[0, 2000, 'x'], [0, 100, 'w'], [1, 3100, 'r'], [2, 5999, 'w'], [3, 14000, 'r'], [3, 13000, 'w']];
  const accName = { r: 'read', w: 'write', x: 'execute' };
  const srows = SA.map(([s, o, a]) => accName[a] + ' ' + s + '.' + o);
  const sres = SA.map(([s, o, a]) => { const t = M.segTranslate(SEG, { seg: s, offset: o, access: a }); return t.ok ? String(t.pa) : t.fault; });
  const scells = (f) => Object.fromEntries(srows.map((r, i) => [r + '|result', f(i)]));
  C.exercise({ id: 'mm-x-seg-table', chapter: 'mm-binding', title: 'Six accesses through the segment table', level: 3, kind: 'table',
    text: ['The same segment table:', segTable, 'For each access (segment.offset), write the physical address, or the fault: `limit` if the offset is outside the segment, `protection` if the access is not allowed.'],
    rows: srows, cols: ['result'], corner: 'access', cells: scells((i) => sres[i]), cellKind: 'text',
    hints: ['Check the limit first (for the stack, the top ' + SEG.segs[3].limit + ' offsets, from ' + sgLo + '), then the protection, then add the base.', 'Writing to code (rx) is a protection fault even inside the limit; offset 3100 of data is past its limit of 3000.', srows.map((r, i) => r + ': ' + sres[i]).join('; ') + '.'],
    solution: scells((i) => sres[i]),
    wrong: [scells((i) => (i === 4 ? String(40960 + 14000) : sres[i])), scells((i) => (i === 1 ? '8292' : sres[i]))] });

  C.exercise({ id: 'mm-x-seg-why', chapter: 'mm-binding', title: 'What segments do not fix', level: 1, kind: 'choice',
    text: ['Segmentation gives each part of a program its own base, limit and protection. Which problem of contiguous allocation does it still have?'],
    options: ['Code can be written to by mistake', 'Two processes cannot share their code', 'External fragmentation: each segment needs one free hole as large as itself', 'The stack cannot grow without moving the code'],
    answer: 2, whyNot: { 0: 'A code segment can be marked rx: a write to it is a protection fault.', 1: 'Two segment tables can point at the same base, so code can be shared.', 3: 'The stack is a segment of its own and can grow (down) without the code moving.' },
    hints: ['Think about what each segment is in physical memory.', 'Each segment is still one contiguous run, placed by first, best, worst or next fit.', 'External fragmentation: holes between segments can add up to enough memory while no single hole fits a new segment. Paging removes it.'],
    solution: 2, wrong: [0, 3] });

  // =========================================================================================================
  // Chapter 2: the address split and the flat table
  // =========================================================================================================
  const sp14 = { vaBits: 14, pageBytes: 1024, levels: 1, pteBytes: 4, va: '0x2b7e' };
  const f14 = M.split(M.config(sp14), BigInt(sp14.va));
  splitEx(Object.assign({ id: 'mm-x-split-14', chapter: 'mm-paging', title: 'Page and offset', level: 1, kind: 'address-split',
    text: ['A machine has 14-bit virtual addresses and pages of 1024 bytes, with one flat page table. Split the address `' + sp14.va + '` into its page number (the field L1, the only level) and its offset.'],
    hints: ['1024 bytes = 2^10, so the low 10 bits are the offset and the remaining 4 bits the page number.', 'In arithmetic: page = address ÷ 1024, offset = address mod 1024. ' + sp14.va + ' = ' + Number(sp14.va) + '.', f14.map((f) => (f.level < 0 ? 'offset' : f.name) + ' = ' + f.value).join(', ') + ': ' + Number(sp14.va) + ' = ' + f14[0].value + ' × 1024 + ' + f14[1].value + '.'] }, sp14), { pageBytes: 256 }, 'The offset is the low 10 bits (1024 = 2^10); the page number is everything above it.');

  const sp32 = { vaBits: 32, pageBytes: 4096, levels: 2, bits: [10, 10], pteBytes: 4, va: '0x0804_a9c4' };
  const f32 = M.split(M.config(sp32), BigInt(sp32.va.replace(/_/g, '')));
  sp32.va = sp32.va.replace(/_/g, '');
  splitEx(Object.assign({ id: 'mm-x-split-32', chapter: 'mm-paging', title: 'A 32-bit address, two levels', level: 1, kind: 'address-split',
    text: ['A 32-bit machine with 4 KiB pages uses a two-level table: 10 bits index the top table, 10 bits the second, and 12 bits are the offset. Split `0x0804_a9c4` into its fields (in decimal or hex).'],
    hints: ['Write the address in binary and cut it 10 | 10 | 12 from the top.', 'The offset is the last three hex digits, 0x9c4. The page number is 0x0804a; its top 10 bits are L1 and its low 10 bits L2.', f32.map((f) => (f.level < 0 ? 'offset' : f.name) + ' = ' + f.value + ' (0x' + f.value.toString(16) + ')').join(', ') + '.'] }, sp32), { pageBytes: 1024, bits: [11, 11] }, 'Cut the 32 bits 10 | 10 | 12 from the top: the offset is the low 12 bits, the last three hex digits.');

  const cfgFlat = M.config({ vaBits: 32, pageBytes: 4096, levels: 1, pteBytes: 4 });
  const flatEntries = 2 ** cfgFlat.vpnBits, flatBytes = flatEntries * 4;
  C.exercise({ id: 'mm-x-flat-entries', chapter: 'mm-paging', title: 'One flat table', level: 1, kind: 'number',
    text: ['A process on a 32-bit machine with 4 KiB pages has one flat page table with an entry for every page, 4 bytes each. How many bytes does the table take?'],
    answer: flatBytes, whyNot: { [String(flatEntries)]: 'That is the number of entries; each takes 4 bytes.', '4096': 'That is one page; the table needs an entry for each of the pages.', '*': 'Count the pages first: 2^(32 − 12).' },
    hints: ['4 KiB pages leave ' + cfgFlat.offBits + ' bits of offset, so the page number has ' + cfgFlat.vpnBits + ' bits.', 'That is 2^' + cfgFlat.vpnBits + ' = ' + flatEntries + ' entries.', flatEntries + ' × 4 = ' + flatBytes + ' bytes, ' + M.bytes(flatBytes) + ', for every process, however little of it is used.'],
    solution: flatBytes, wrong: [flatEntries, 4096] });

  const IFS = [3000, 8192, 9500, 100, 20000], ifr = M.internalFrag(IFS, 2048);
  C.exercise({ id: 'mm-x-int-frag', chapter: 'mm-paging', title: 'The waste in the last pages', level: 2, kind: 'number',
    text: ['A process makes five allocations of ' + list(IFS.map((s) => s + ' bytes')) + ', each rounded up to whole pages of 2048 bytes. How many bytes are allocated but unused, in all?'],
    answer: ifr.waste, whyNot: { [String(IFS.length * 1024)]: 'That is the rule of half a page per allocation, an average; work out the real waste of each.', '*': 'For each size: pages = ⌈size / 2048⌉, waste = pages × 2048 − size.' },
    hints: ['Each allocation takes ⌈size / 2048⌉ pages, and the waste is in its last page only.', '8192 is an exact multiple of 2048, so it wastes nothing.', ifr.rows.map((r) => r.size + ': ' + r.pages + ' page' + (r.pages === 1 ? '' : 's') + ', ' + r.waste + ' wasted').join('; ') + '. In all ' + ifr.waste + ' bytes.'],
    solution: ifr.waste, wrong: [IFS.length * 1024, ifr.used] });
})(globalThis.Proses = globalThis.Proses || {});
