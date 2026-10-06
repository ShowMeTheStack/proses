// Part 11, virtual memory: the exercises of chapter 3 (sharing frames, global and local replacement, the working set,
// thrashing, page-fault frequency) and chapter 4 (the buddy system, slabs, malloc, the page size). Every number in a
// text, an answer or a hint is worked out here by the engines (S.VM, S.Mem): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, V = S.VM, M = S.Mem;
  if (!C || !V || !M || C.exercises.has('vm-x-prop')) return;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const f2 = (v) => String(+v.toFixed(2));

  // =========================================================================================================
  // Chapter 3: sharing frames
  // =========================================================================================================
  const PP = [{ name: 'A', size: 12 }, { name: 'B', size: 40 }, { name: 'C', size: 90 }, { name: 'D', size: 25 }];
  const pa = V.allocFrames({ frames: 50, procs: PP, scheme: 'proportional', min: 2 });
  const total = PP.reduce((s, p) => s + p.size, 0);
  const pcells = (f) => Object.fromEntries(pa.alloc.map((a, i) => [a.name + '|frames', f(a, i)]));
  C.exercise({ id: 'vm-x-prop', chapter: 'vm-frames', title: 'Frames in proportion', level: 2, kind: 'table',
    text: ['50 frames are shared among four processes in proportion to their sizes: A has ' + PP[0].size + ' pages, B ' + PP[1].size + ', C ' + PP[2].size + ' and D ' + PP[3].size + '. Each share is rounded down, then the frames left over go one each to the processes with the largest remainders. How many frames does each get?'],
    rows: pa.alloc.map((a) => a.name), cols: ['frames'], corner: 'process', cells: pcells((a) => a.frames), cellKind: 'number',
    hints: ['Each exact share is size / ' + total + ' × 50.', 'Exact shares: ' + pa.alloc.map((a) => a.name + ' ' + f2(a.exact)).join(', ') + '. Rounded down they add up to ' + pa.alloc.reduce((s, a) => s + Math.floor(a.exact), 0) + '.', pa.say + ' The leftover frames went to the largest remainders.'],
    solution: pcells((a) => String(a.frames)),
    wrong: [pcells((a, i) => String(Math.floor(a.exact) + (a.name === 'C' ? 50 - pa.alloc.reduce((t, b) => t + Math.floor(b.exact), 0) : 0))), pcells((a) => String(Math.floor(a.exact)))] });

  const GA = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4], GB = [7, 8, 7, 8, 7, 8, 7, 8, 7, 8];
  const gl = (mode) => V.globalLocal({ procs: [{ name: 'A', refs: GA }, { name: 'B', refs: GB }], frames: 6, mode, quota: [3, 3], policy: 'lru', quantum: 2 });
  const gG = gl('global'), gL = gl('local');
  C.exercise({ id: 'vm-x-global', chapter: 'vm-frames', title: 'A loop one page too big', level: 2, kind: 'number',
    text: ['Process A loops over pages `' + GA.join(' ') + '`; process B alternates `' + GB.join(' ') + '`. They take turns of 2 references, A first, on 6 frames, with LRU. Under local replacement each may hold at most 3 frames. How many faults does A make under local replacement?'],
    answer: gL.faults[0], whyNot: { [String(gG.faults[0])]: 'That is global replacement, where A can take the frames B does not need.', '4': 'Only the first touches? A loops over 4 pages with 3 frames: LRU evicts exactly the page it needs next.', '*': 'With 3 frames and a loop of 4 pages under LRU, think about which page is evicted each time.' },
    hints: ['B needs only 2 frames. Under local replacement A may hold 3, however many are free.', 'A loop of 4 pages in 3 frames under LRU: every reference evicts the page that the loop needs next.', 'Local: A faults ' + gL.faults[0] + ' times (every reference), B ' + gL.faults[1] + '. Global: A takes a fourth frame and faults only ' + gG.faults[0] + ' times.'],
    solution: gL.faults[0], wrong: [gG.faults[0], 9] });

  // ---- the working set ---------------------------------------------------------------------------------------------
  const WR = [3, 7, 3, 1, 7, 3, 8, 8, 2, 8, 2, 5, 2, 5, 3, 7];
  const ws4 = V.workingSet(WR, 4), at = 10, wsAt = ws4.steps[at - 1].ws;
  C.exercise({ id: 'vm-x-ws', chapter: 'vm-frames', title: 'The working set at one moment', level: 1, kind: 'set',
    text: ['A process makes the references `' + WR.join(' ') + '`. With a window of Δ = 4, what is its working set just after reference ' + at + '? Answer as a set, like {1, 2}.'],
    answer: '{' + wsAt.join(', ') + '}',
    hints: ['The working set is the set of distinct pages among the last Δ references, the current one included.', 'References ' + (at - 3) + ' to ' + at + ' are ' + WR.slice(at - 4, at).join(', ') + '.', 'Distinct pages among them: {' + wsAt.join(', ') + '}, a working-set size of ' + wsAt.length + '.'],
    solution: '{' + wsAt.join(', ') + '}', wrong: ['{' + WR.slice(at - 5, at).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).join(', ') + '}', '{8}'], whyNot: 'Take exactly the last 4 references, up to and including reference ' + at + '.' });

  const ws5 = V.workingSet(WR, 5), peakAt = ws5.steps.findIndex((s) => s.wss === ws5.max);
  C.exercise({ id: 'vm-x-ws-max', chapter: 'vm-frames', title: 'The largest working set', level: 2, kind: 'number',
    text: ['The same references, `' + WR.join(' ') + '`, now with a window of Δ = 5. What is the largest working-set size over the run?'],
    answer: ws5.max, whyNot: { [String(new Set(WR).size)]: 'That is every page the process uses; the window holds only the last 5 references.', '5': 'Five references need not be five different pages.', '*': 'Slide a window of 5 references along the string and count the distinct pages in each.' },
    hints: ['At each reference, look back over the last 5 (fewer at the start).', 'The size grows when the process moves to new pages while old ones are still in the window.', 'Sizes along the run: ' + ws5.steps.map((s) => s.wss).join(' ') + '. The largest is ' + ws5.max + ', first reached at reference ' + (peakAt + 1) + ' ({' + ws5.steps[peakAt].ws.join(', ') + '}).'],
    solution: ws5.max, wrong: [new Set(WR).size, 5] });

  const TH = { frames: 600, wss: 50, lifetime: 30, k: 2, disk: 12, maxN: 20 }, th = V.thrashing(TH);
  const pt = (n) => th.points.find((p) => p.n === n);
  C.exercise({ id: 'vm-x-thrash', chapter: 'vm-frames', title: 'Where the curve peaks', level: 2, kind: 'number',
    text: ['600 frames; each process needs 50 to hold its working set, and with them it computes 30 ms between faults; each fault takes 12 ms on one paging disk. With fewer frames, the time between faults shrinks with the square of the shortfall. At how many processes is CPU utilisation highest?'],
    answer: th.best, whyNot: { '20': 'More processes help only while each still has its 50 frames.', '1': 'One process leaves the CPU idle during every fault.', '*': 'Find the largest n for which 600 / n is still at least 50.' },
    hints: ['Up to the point where every process has its working set, adding one overlaps more computing with the disk waits.', 'Past it, every process faults more often, and the paging disk saturates.', '600 / 50 = ' + th.best + ' processes each hold exactly 50 frames: the CPU is ' + Math.round(pt(th.best).cpu * 100) + '% busy. With 20, each has 30 frames and the CPU falls to ' + Math.round(pt(20).cpu * 100) + '%.'],
    solution: th.best, wrong: [20, 1] });

  const PF = { refs: [1, 2, 3, 1, 2, 4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 1, 1, 1, 1, 1], frames: 2, lower: 0.2, upper: 0.6, interval: 4, min: 1, max: 6 };
  const pf = V.pff(PF), adj = pf.steps.filter((s) => s.kind === 'adjust'), endF = pf.framesOver[pf.framesOver.length - 1];
  C.exercise({ id: 'vm-x-pff', chapter: 'vm-frames', title: 'Page-fault frequency', level: 3, kind: 'number',
    text: ['A process starts with 2 frames and makes the references `' + PF.refs.join(' ') + '`, with LRU among its own frames. After every 4 references its fault rate over those 4 is checked: above 0.6 it gains a frame; below 0.2 it gives one up (its least recently used page goes if all are full). How many frames does it hold at the end?'],
    answer: endF, whyNot: { [String(Math.max(...pf.framesOver))]: 'That is the most it ever held; low fault rates later take frames back.', '*': 'After each group of 4 references, count the faults in the group and adjust.' },
    hints: ['Groups of 4: references 1–4, 5–8, 9–12, 13–16 and 17–20. A rate of 3 faults in 4 is 0.75.', 'The first two groups fault on almost everything, so the process grows; the loop over 4, 5 and 6 then fits.', adj.map((s, i) => 'after reference ' + 4 * (i + 1) + ': ' + s.say.replace(/^Over the last 4 references /, '')).join(' ') + ' In all ' + pf.faults + ' faults.'],
    solution: endF, wrong: [Math.max(...pf.framesOver), 6] });

  // =========================================================================================================
  // Chapter 4: the buddy system and slabs
  // =========================================================================================================
  const BOPS = [['A', 50], ['B', 100], ['C', 20], ['D', 60], ['-A'], ['E', 30]];
  const B = M.buddy({ size: 512, minBlock: 16 }), bst = BOPS.map((o) => (o.length === 1 ? B.free(o[0].slice(1)) : B.alloc(o[0], o[1])));
  const ballocs = bst.filter((s) => s.kind === 'alloc');
  const bcells = (f) => Object.fromEntries(ballocs.flatMap((s) => [[s.id + '|block', f(s, 'blockSize')], [s.id + '|at', f(s, 'offset')]]));
  const bText = 'A buddy allocator manages 512 KiB, with blocks from 512 KiB down to 16 KiB. A request takes the smallest block size that holds it, the free block of that size at the lowest address, splitting a larger block when none is free. The requests, in KiB: A 50, B 100, C 20, D 60, then A is freed, then E 30.';
  C.exercise({ id: 'vm-x-buddy', chapter: 'vm-alloc', title: 'Blocks and buddies', level: 3, kind: 'table',
    text: [bText, 'For each request, give the block size it gets and the offset (in KiB) where its block starts.'],
    rows: ballocs.map((s) => s.id), cols: ['block', 'at'], corner: 'request', cells: bcells((s, k) => s[k]), cellKind: 'number',
    hints: ['Round each request up to a power of two: 50 → 64, 100 → 128, 20 → 32, 60 → 64, 30 → 32.', 'A splits 512 into 256 + 256, then 128 + 128, then 64 + 64, and takes 64 at 0; the upper halves go on the free lists.', ballocs.map((s) => s.say.replace(/ bytes/g, ' KiB')).join(' ')],
    solution: bcells((s, k) => String(s[k])),
    wrong: [bcells((s, k) => String(s.id === 'E' && k === 'offset' ? 0 : s[k])), bcells((s, k) => String(s.id === 'A' && k === 'blockSize' ? 50 : s[k]))] });

  const live = ['B', 'C', 'D', 'E'].map((id) => ballocs.find((s) => s.id === id)), waste = live.reduce((s, b) => s + b.internal, 0);
  C.exercise({ id: 'vm-x-buddy-waste', chapter: 'vm-alloc', title: 'Waste inside the blocks', level: 2, kind: 'number',
    text: [bText, 'After E is placed, B, C, D and E are allocated. How many KiB of their blocks are unused (internal fragmentation)?'],
    answer: waste, whyNot: { [String(waste + ballocs[0].internal)]: 'A was freed: its block no longer counts.', '*': 'For each live block, waste = block size − request.' },
    hints: ['Each request is rounded up to a power of two; the difference is wasted inside the block.', 'B: 128 − 100; C: 32 − 20; D: 64 − 60; E: 32 − 30.', live.map((b) => b.id + ' ' + b.internal).join(' + ') + ' = ' + waste + ' KiB.'],
    solution: waste, wrong: [waste + ballocs[0].internal, 0] });

  const SL = M.slab({ caches: [{ name: 'inode', objSize: 192 }, { name: 'file', objSize: 384 }], slabBytes: 1024 });
  const SOPS = [['inode', 'a'], ['inode', 'b'], ['file', 'f'], ['inode', 'c'], ['inode', 'd'], ['inode', 'e'], ['inode', 'g'], ['file', 'h'], ['file', 'i'], ['-f'], ['-h']];
  const sst = SOPS.map((o) => (o.length === 1 ? SL.free(o[0].slice(1)) : SL.alloc(o[0], o[1])));
  const snap = sst[sst.length - 1].snapshot, nslabs = snap.caches.reduce((s, c) => s + c.slabs.length, 0);
  C.exercise({ id: 'vm-x-slab', chapter: 'vm-alloc', title: 'How many slabs?', level: 2, kind: 'number',
    text: ['Two slab caches use slabs of 1024 bytes: inode objects of 192 bytes and file objects of 384. A new object goes in a partial slab, else an empty one, else the cache grows by a new slab. In order: inodes a and b, file f, inodes c, d, e and g, files h and i; then f and h are freed. How many slabs do the two caches hold at the end?'],
    answer: nslabs, whyNot: { '3': 'Freeing objects does not give slabs back: an empty slab stays with its cache until memory is short.', '*': 'Work out how many objects fit in a slab of each cache first.' },
    hints: ['A 1024-byte slab holds ⌊1024 / 192⌋ = ' + snap.caches[0].perSlab + ' inodes, or ⌊1024 / 384⌋ = ' + snap.caches[1].perSlab + ' files.', 'Six inodes need 2 slabs; three files need 2 slabs.', 'inode: ' + snap.caches[0].slabs.length + ' slabs, file: ' + snap.caches[1].slabs.length + ' slabs (one of them now empty, kept by the cache): ' + nslabs + ' in all.'],
    solution: nslabs, wrong: [3, 5] });

  // ---- malloc --------------------------------------------------------------------------------------------------------
  const MOPS = [['a', 30], ['b', 12], ['c', 50], ['d', 24], ['e', 40], ['-a'], ['-d'], ['f', 14], ['g', 20], ['h', 36]];
  const mrun = (p) => { const H = M.malloc({ heap: 256, policy: p }); return MOPS.map((o) => (o.length === 1 ? H.free(o[0].slice(1)) : H.malloc(o[0], o[1]))); };
  const MP = ['first', 'next', 'best'], MR = Object.fromEntries(MP.map((p) => [p, mrun(p)]));
  const late = ['f', 'g', 'h'], where = (p, id) => { const s = MR[p].find((q) => q.id === id && q.kind !== 'free'); return s.kind === 'fail' ? 'refused' : String(s.start); };
  const mcells = (f) => Object.fromEntries(late.flatMap((id) => MP.map((p) => [id + '|' + p + ' fit', f(p, id)])));
  const firstBlocks = MR.first.filter((s) => s.kind === 'malloc').slice(0, 5).map((s) => s.id + ' ' + s.size + ' at ' + s.start);
  C.exercise({ id: 'vm-x-malloc', chapter: 'vm-alloc', title: 'Three searches, one heap', level: 2, kind: 'table',
    text: ['A heap of 256 bytes. Every block has a 4-byte header and a 4-byte footer and is a multiple of 8 bytes; a split that would leave less than 16 bytes gives the whole block instead. The requests: malloc a 30, b 12, c 50, d 24, e 40; free a and d; then malloc f 14, g 20, h 36. The first five blocks are the same under every policy: ' + list(firstBlocks) + '. Next fit starts each search where the last one stopped. Where does each of f, g and h start, or is it refused?'],
    rows: late, cols: MP.map((p) => p + ' fit'), corner: 'request', cells: mcells(where), cellKind: 'text',
    hints: ['Block sizes: f needs 14 + 8 → 24, g 20 + 8 → 32, h 36 + 8 → 48 (rounded to 8). After the frees the free blocks are 40 at 0, 32 at 128 and 48 at 208.', 'First fit takes the lowest that fits, best fit the smallest that fits; next fit goes on from e, near the top of the heap.', late.map((id) => id + ': ' + MP.map((p) => p + ' ' + where(p, id)).join(', ')).join('; ') + '.'],
    solution: mcells(where),
    wrong: [mcells((p, id) => (p === 'best' && id === 'f' ? '0' : where(p, id))), mcells((p, id) => (p === 'next' && id === 'h' ? '208' : where(p, id)))] });

  const H1 = M.malloc({ heap: 256, policy: 'first' }), ms = H1.malloc('x', 30);
  C.exercise({ id: 'vm-x-malloc-size', chapter: 'vm-alloc', title: 'How big is the block?', level: 1, kind: 'number',
    text: ['On the same heap (a 4-byte header and a 4-byte footer per block, sizes a multiple of 8), how many bytes does the block for malloc(30) take?'],
    answer: ms.size, whyNot: { '30': 'The block also holds its two tags, and is rounded up to a multiple of 8.', '38': 'That is 30 plus the tags; round it up to a multiple of 8.', '32': 'That rounds 30 up but leaves out the 8 bytes of tags.', '*': '30 + 4 + 4, rounded up to a multiple of 8.' },
    hints: ['A block = header + payload + footer.', '30 + 8 = 38 bytes.', ms.say],
    solution: ms.size, wrong: [38, 32] });

  // ---- the page size -------------------------------------------------------------------------------------------------
  const PS = [9000, 200000, 1500, 70000], pst = M.pageSizeTradeoff({ vaBits: 48, pteBytes: 8, tlbEntries: 64, sizes: PS, pageSizes: [4096, 16384, 65536] });
  const r16 = pst.rows.find((r) => r.pageBytes === 16384), r4 = pst.rows.find((r) => r.pageBytes === 4096);
  C.exercise({ id: 'vm-x-pagesize', chapter: 'vm-alloc', title: 'Entries for a page size', level: 1, kind: 'number',
    text: ['A process makes four allocations of ' + list(PS.map((s) => s + ' bytes')) + ', each rounded up to whole pages of 16 KiB (16384 bytes). How many page-table entries do they need in all, one per page?'],
    answer: r16.leafEntries, whyNot: { [String(r4.leafEntries)]: 'That is with 4 KiB pages.', [String(Math.ceil(PS.reduce((s, x) => s + x, 0) / 16384))]: 'Each allocation is rounded up on its own, not their total.', '*': 'For each allocation, ⌈size / 16384⌉ pages.' },
    hints: ['Each allocation needs ⌈size / 16384⌉ pages of its own.', PS.map((s) => s + ' → ' + Math.ceil(s / 16384)).join(', ') + '.', 'In all ' + r16.leafEntries + ' entries, against ' + r4.leafEntries + ' with 4 KiB pages; the waste grows from ' + r4.waste + ' to ' + r16.waste + ' bytes.'],
    solution: r16.leafEntries, wrong: [r4.leafEntries, Math.ceil(PS.reduce((s, x) => s + x, 0) / 16384)] });

  C.exercise({ id: 'vm-x-prepage', chapter: 'vm-alloc', title: 'When prepaging pays', level: 1, kind: 'choice',
    text: ['A process is swapped back in, and the kernel brings in its whole working set at once instead of waiting for each page to fault. When does this prepaging pay?'],
    options: ['When most of the pages brought in are used before they are evicted', 'Always: a fault is always dearer than a transfer', 'Only when the pages are dirty', 'Only with large pages'],
    answer: 0, whyNot: { 1: 'A page brought in and never used costs a transfer and a frame for nothing.', 2: 'Dirty or clean only matters when a page leaves memory.', 3: 'Prepaging works at any page size.' },
    hints: ['Compare the cost of the pages brought in with the faults they save.', 'Each prepaged page that is used saves a fault; each one that is not wastes a transfer and a frame.', 'It pays when the fraction of prepaged pages used is high enough that the saved faults outweigh the wasted transfers.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
