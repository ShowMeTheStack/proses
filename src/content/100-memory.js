// Part 10, main memory: the chapters and the lessons. The exercises are in 101-memory-ex.js and 101-memory-ex2.js;
// the challenges, the guided tour, the course and the pages the diagram checker looks at are in 102-memory-ch.js.
// Each lesson opens with a question, runs the topic that shows the idea at a frame chosen for the point being made,
// asks for a prediction, sums up, and leads to its exercises. Every value quoted here is what the topics' own
// engines (S.Mem) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'mm-binding')) return;

  C.chapter({ id: 'mm-binding', part: 'memory', n: 1, title: 'Addresses and contiguous memory', blurb: 'Logical against physical addresses, base and bounds, whole processes swapped, holes and the four fits, compaction, and segments.' });
  C.chapter({ id: 'mm-paging', part: 'memory', n: 2, title: 'Paging and the TLB', blurb: 'Pages and frames, the address split, the waste in the last page, and the cache of translations that makes paging fast.' });
  C.chapter({ id: 'mm-tables', part: 'memory', n: 3, title: 'Page-table structures', blurb: 'Multilevel tables walked level by level, what each design costs in memory, and hashed and inverted tables.' });
  const X = (id) => ({ exercise: id });
  const memLab = (title, text, setup) => ({ lab: 'memory', title, text, setup });
  const PAGING = { mode: 'paging', bits: 'auto', flags: ['P', 'RW', 'US', 'A', 'D', 'G', 'NX'] };
  const paging = (more) => Object.assign({}, PAGING, more);

  // =========================================================================================================
  // Chapter 1: addresses and contiguous memory
  // =========================================================================================================
  C.lesson({
    id: 'mm-base', chapter: 'mm-binding', title: 'Base and bounds', minutes: 8,
    summary: 'A program is compiled as if it owned memory from address 0. The MMU binds each logical address to a physical one at run time: the limit register rejects any address at or past the size of the process, and the base register is added to every address that passes. A context switch loads the next process\'s pair. Whole processes can be swapped out and brought back somewhere else, because only the base register has to change.',
    blocks: [
      'Two programs were both compiled to start at address 0, and both are in memory at once. When the first one reads its address 1200 and the second one reads its own address 1200, they must reach different bytes. And neither may reach the other\'s memory, even by mistake. What does the hardware do on every single access to make that true?',
      { def: 'logical and physical address', text: 'a logical (virtual) address is the one the program uses; a physical address is the one that goes out to the memory chips. The memory-management unit (MMU) turns the first into the second on every access.' },
      { def: 'base and limit registers', text: 'the limit (bounds) register holds the size of the running process: a logical address at or past it traps. The base (relocation) register holds where the process starts in physical memory, and is added to every address that passes.' },
      { topic: 'mem-base-bounds', frame: 0, caption: 'P1 sits at physical 20480 and is 6144 bytes long; P2 sits at 40960 and is 12288 bytes long. While P1 runs, the MMU holds base 20480 and limit 6144.' },
      { topic: 'mem-base-bounds', frame: 4, caption: 'Logical 1200 passes the check (1200 < 6144), and the base is added: 20480 + 1200 = physical 21680.' },
      { predict: { q: 'P1 now issues logical address 6144, its size exactly. What happens?', options: ['It reaches physical 26624, the byte just after P1', 'The MMU traps: a protection fault', 'It wraps round to physical 20480'], answer: 1, explain: 'The check is logical address < limit, and 6144 is not below 6144. The MMU traps before memory is touched; without the check the access would have reached 26624, which is not P1\'s.' } },
      { topic: 'mem-base-bounds', frame: 8, caption: '6144 is not below 6144: a protection fault, and memory is never touched.' },
      { topic: 'mem-base-bounds', frame: 11, caption: 'After a switch to P2, the same logical address 1200 lands at 40960 + 1200 = 42160. Loading base and limit is privileged, so no program can widen its own window.' },
      { h: 'Swapping whole processes' },
      'When memory is full, a kernel with only base and bounds can copy a whole process out to the backing store and bring it back later. Because every address the process makes goes through the base register, it does not have to come back to the same place.',
      { topic: 'mem-swapping', frame: 8, caption: 'B was swapped out from 428 and comes back at 128. Only its base register changes: its logical address 100 now means physical 228.' },
      { topic: 'mem-swapping', frame: 12, caption: '5 transfers took 53.5 ms in all, each 8 ms of latency plus the size over 100 MiB/s. A context switch takes microseconds; a swap takes milliseconds.' },
      { table: [['Binding at', 'The physical address is fixed', 'The process can move'], ['compile time', 'when the program is compiled', 'never'], ['load time', 'when it is loaded', 'only by loading it again'], ['run time (an MMU)', 'on every access', 'at any time: change the base']], caption: 'When logical addresses are bound to physical ones.' },
      { h: 'Recap' },
      { list: ['The MMU checks every logical address against the limit, then adds the base.', 'An address at or past the limit traps before memory is touched.', 'A context switch loads the next process\'s base and limit, in kernel mode.', 'Run-time binding lets a swapped process come back anywhere.'] },
      X('mm-x-bb-pa'), X('mm-x-bb-trap'), X('mm-x-bb-binding'),
    ],
  });

  C.lesson({
    id: 'mm-fits', chapter: 'mm-binding', title: 'Holes and the four fits', minutes: 8,
    summary: 'With each process in one run of memory, free memory becomes a list of holes. A request is placed in a hole by first fit (the lowest that is big enough), next fit (the next one from where the last search ended), best fit (the smallest that is big enough) or worst fit (the largest). Each leaves different holes behind, and none wins on every sequence of requests.',
    blocks: [
      'A process asks for 90 K. Memory has two holes, one of 150 K low down and one of 286 K higher up. Which should it get? The choice does not matter now, but it shapes the holes that later requests will find.',
      { def: 'hole', text: 'a run of free memory between allocated blocks. Freeing a block next to a hole merges the two into one larger hole.' },
      { topic: 'mem-fits', input: { policy: 'first' }, frame: 10, caption: 'After B and D are freed, two holes: 150 K at 328 and 286 K at 738. E asks for 90 K next.' },
      { topic: 'mem-fits', input: { policy: 'first' }, frame: 12, caption: 'First fit puts E at 328, in the lowest hole big enough, leaving 60 K there.' },
      { predict: { q: 'Under worst fit, E goes into the largest hole, 286 K at 738. Then F asks for 120 K and G for 180 K. Does worst fit place G?', options: ['Yes: worst fit keeps large holes for later', 'No: G is refused, as under first fit', 'Only after compaction'], answer: 1, explain: 'After E and F, worst fit has 150 K at 328 and 76 K at 948: the largest is 150 K, too small for G\'s 180 K. Spreading every request over the big hole left no hole big enough either.' } },
      { topic: 'mem-fits', input: { policy: 'worst' }, frame: 15, caption: 'Worst fit refuses G too: 226 K are free, but the largest hole is 150 K. The memory is there, in pieces: external fragmentation.' },
      { topic: 'mem-fits', input: { policy: 'worst' }, frame: 18, caption: 'At the end worst fit leaves 166 K free in 2 holes, the largest 90 K: external fragmentation 1 − 90 / 166 = 45.8%. First fit and best fit end with one hole of 166 K, 0%.' },
      { topic: 'mem-fits-compare', frame: 11, caption: 'Four memories, the same 10 requests. Next fit and worst fit refuse H\'s 210 K; first fit and best fit place it. A different script can change the order.' },
      { topic: 'mem-fits-compare', frame: 12, caption: 'A long random run: first fit keeps about one hole for every two blocks (36 holes for 72.7 blocks), the fifty-percent rule.' },
      memLab('The four fits in the Memory lab', 'Contiguous allocation with your own allocs and frees: switch the placement between first, best, worst and next fit and watch the holes change.', { mode: 'alloc', alloc: 'contig', fit: 'best', compact: 'never', memK: 1024, osK: 128, ops_contig: ['A=200', 'B=150', 'C=260', 'D=100', '-B', '-D', 'E=90', 'F=120', 'G=180', 'H=60'] }),
      { table: [['Fit', 'Takes', 'Tends to leave'], ['first', 'the lowest hole big enough', 'small holes near the bottom; searches are short'], ['next', 'the next hole big enough from the last allocation', 'free space spread over all of memory'], ['best', 'the smallest hole big enough', 'tiny slivers too small to use'], ['worst', 'the largest hole', 'no large hole for a large request']], caption: 'The four placement policies.' },
      { h: 'Recap' },
      { list: ['Free memory is a list of holes; a free next to a hole merges with it.', 'First, next, best and worst fit choose a hole in four ways.', 'External fragmentation: enough memory is free in all, but no one hole is big enough.', 'Measured as 1 − largest hole / free memory.'] },
      X('mm-x-fit-table'), X('mm-x-fit-refuse'), X('mm-x-ext-frag'),
    ],
  });

  C.lesson({
    id: 'mm-compact', chapter: 'mm-binding', title: 'Compaction', minutes: 6,
    summary: 'Compaction slides the allocated blocks together so the free memory becomes one hole. It needs run-time binding (each moved process gets a new base) and it costs a copy of every byte moved, so a kernel compacts only when a request cannot be met otherwise.',
    blocks: [
      'Three holes of 186 K, 160 K and 180 K are free, 526 K in all, and a process asks for 300 K. No hole holds it. Could the kernel make one?',
      { topic: 'mem-compaction', frame: 7, caption: 'After B and D are freed: 526 K free in 3 holes, the largest 186 K.' },
      { predict: { q: 'F asks for 300 K. Compaction slides every block down in address order. Which blocks move?', options: ['All of them: A, C and E', 'C and E, the blocks above the first hole', 'Only E, the highest block'], answer: 1, explain: 'A already sits at the bottom, against the kernel. C moves from 408 down to 248 and E from 728 to 388: 250 K copied.' } },
      { topic: 'mem-compaction', frame: 8, caption: 'Compaction moves C from 408 to 248 and E from 728 to 388: 250 K copied, and each moved process gets a new base register. One hole of 526 K is left.' },
      { topic: 'mem-compaction', frame: 9, caption: 'F (300 K) now goes at 498.' },
      { warn: 'Compaction copies memory while the moved processes cannot run, and it only works with run-time binding: an address fixed at load time would point at the old place.' },
      memLab('Compaction in the Memory lab', 'A free that leaves holes, a request too big for any of them, then # to compact by hand. Switch Compact to "when a request fails" to let the kernel do it.', { mode: 'alloc', alloc: 'contig', fit: 'first', compact: 'never', memK: 1024, osK: 128, ops_contig: ['A=120', 'B=160', 'C=140', 'D=180', 'E=110', '-B', '-D', 'F=300', '#', 'F=300'] }),
      'Paging, the subject of the next chapter, removes the need: a process\'s pages can go in any free frames, wherever they are, so no contiguous hole is ever needed.',
      { h: 'Recap' },
      { list: ['Compaction slides blocks together so all the free memory is one hole.', 'Its price is a copy of every byte it moves.', 'Each moved process needs a new base: run-time binding.'] },
      X('mm-x-compact-moved'), X('mm-x-ext-frag'),
    ],
  });

  C.lesson({
    id: 'mm-seg', chapter: 'mm-binding', title: 'Segmentation', minutes: 8,
    summary: 'Segmentation gives a process several runs of memory instead of one: code, data, heap and stack, each with its own base, limit, growth direction and protection. A logical address names a segment and an offset; the offset is checked against the segment\'s limit and its protection, then relocated by the segment\'s base. A stack grows down, so its valid offsets are at the top of its range.',
    blocks: [
      'With one base and limit, the whole process is one block: its code can be written to, its stack cannot grow without moving everything, and two processes cannot share their code. What if each part of a program had a base and a limit of its own?',
      { def: 'segment table', text: 'one entry per segment: its base, its limit, the direction it grows and the accesses it allows (read, write, execute). The top bits of a logical address pick the entry; the rest are the offset within the segment.' },
      { topic: 'mem-segmentation', frame: 0, caption: 'Four segments; an address is 2 bits of segment and 14 of offset. Code at 4096 is 3000 bytes, read and execute only.' },
      { topic: 'mem-segmentation', frame: 4, caption: 'A write to the code segment: the offset is within the limit, but the segment is rx. A protection fault.' },
      { topic: 'mem-segmentation', frame: 8, caption: 'Address 18284 is segment 1, offset 1900, past the data segment\'s limit of 1800: a segmentation fault.' },
      { predict: { q: 'The stack (segment 3) is 2500 bytes at base 30000 and grows down; offsets run to 16384. A write to offset 16000: which physical address?', options: ['30000 + 16000 = 46000', '30000 + (16000 − 13884) = 32116', 'a fault: 16000 is past the limit of 2500'], answer: 1, explain: 'A segment that grows down holds the top 2500 offsets, from 16384 − 2500 = 13884 to 16383. Offset 16000 is 2116 above the bottom of that range, so it is at 30000 + 2116 = 32116.' } },
      { topic: 'mem-segmentation', frame: 12, caption: 'The stack grows down: offset 16000 is 2116 above the segment\'s base, at 32116.' },
      { topic: 'mem-segmentation', input: { paging: 'on' }, frame: 12, caption: 'With paging inside each segment, the same byte of the stack is page 2, offset 68, and the segment\'s own page table maps it to frame 34: physical 34884.' },
      memLab('Segments in the Memory lab', 'Each segment placed on its own by the same fits: free one process\'s heap and watch the holes it leaves between other processes\' segments.', { mode: 'alloc', alloc: 'seg', fit: 'first', compact: 'never', memK: 1024, osK: 128 }),
      { tip: 'Segments match how a program is built, so protection and sharing are natural: two processes can share code by pointing a segment entry at the same base. But each segment is still one contiguous run, so segments bring back the holes and external fragmentation of the last two lessons.' },
      { h: 'Recap' },
      { list: ['An address is a segment number and an offset.', 'The offset is checked against the segment\'s limit, the access against its protection, then the base is added.', 'A segment that grows down holds the top of its offset range.', 'Segments still need contiguous holes.'] },
      X('mm-x-seg-pa'), X('mm-x-seg-table'), X('mm-x-seg-why'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: paging and the TLB
  // =========================================================================================================
  C.lesson({
    id: 'mm-pages', chapter: 'mm-paging', title: 'Pages, frames and the address split', minutes: 8,
    summary: 'Paging cuts the logical address space into pages and physical memory into frames of the same size. The low bits of an address are the offset within the page and pass through unchanged; the high bits are the page number, which the page table replaces with a frame number. Any page can go in any frame, so there is no external fragmentation; the waste is inside the last page of each allocation.',
    blocks: [
      'Holes, fits and compaction all come from one demand: that each process, or each segment, be one contiguous run. What if memory were cut into small pieces of one size, and a process could use any of them, in any order?',
      { def: 'page and frame', text: 'a page is a fixed-size block of the logical address space; a frame is a block of physical memory of the same size. The page table, one per process, says which frame holds each page.' },
      { topic: 'mem-paging', frame: 1, caption: '14-bit addresses and 1 KiB pages: the low 10 bits are the offset, the high 4 bits the page. Address 2604 is page 2, offset 556 (2604 ÷ 1024 = 2 remainder 556).' },
      { topic: 'mem-paging', frame: 3, caption: 'The table maps page 2 to frame 3, so the physical address is 3 × 1024 + 556 = 3628. Only the page number is replaced.' },
      { predict: { q: 'Address 16382 (0x3ffe) under the same table, where page 15 is in frame 7. Which physical address?', options: ['8190', '16382', '7 × 1024 = 7168'], answer: 0, explain: '16382 = 15 × 1024 + 1022: page 15, offset 1022. Frame 7 joined to offset 1022: 7 × 1024 + 1022 = 8190.' } },
      { topic: 'mem-paging', frame: 12, caption: 'Frame 7 joined to offset 1022: physical 8190.' },
      { topic: 'mem-paging', frame: 13, caption: 'Every reference read the table first: 7 memory accesses for 3 translated addresses and 1 fault. Paging doubles the cost of memory, until the TLB of the next lesson.' },
      { h: 'The waste inside the last page' },
      { topic: 'mem-internal-frag', frame: 7, caption: '6 allocations rounded up to 4096-byte pages: 16739 of 77824 bytes wasted, 21.5%. The rough rule of half a page each gives 12288.' },
      { topic: 'mem-internal-frag', frame: 8, caption: 'The same allocations at six page sizes: 1379 bytes wasted with 512 B pages, 53603 bytes with 16 KiB pages. Smaller pages waste less, but need more entries.' },
      memLab('Your own split in the Memory lab', 'A 30-bit space of 4 KiB pages split 6-6-6-12, with code, heap and stack: type any address and watch it split into coloured fields.', paging({ va: 30, pa: 32, page: 4096, levels: 3, bits: '6 6 6', pte: 8, table: 'hier', space: 'typed', tlb: 4, ways: 1, regions: [{ name: 'code', start: '0x40_0000', pages: 3, perm: 'rx' }, { name: 'heap', start: '0x60_0000', pages: 4, perm: 'rw' }, { name: 'stack', start: '0x3fff_c000', pages: 4, perm: 'rw' }], addrs: ['0x40_0010:x', '0x60_0020:w', '0x60_1020', '0x3fff_f008:w', '0x40_1004:x', '0x3fff_c100', '0x60_0028', '0x2000_0000'] })),
      { table: [['', 'Contiguous', 'Paging'], ['A process needs', 'one run of memory', 'any free frames'], ['External fragmentation', 'yes: holes between blocks', 'none'], ['Internal fragmentation', 'none', 'the unused end of each last page'], ['Translation', 'compare and add', 'a table lookup per access']], caption: 'Contiguous allocation against paging.' },
      { h: 'Recap' },
      { list: ['Offset = the low log2(page size) bits; page number = the bits above.', 'Physical address = frame × page size + offset.', 'No external fragmentation; internal fragmentation is about half a page per allocation.', 'Every access now reads the table first.'] },
      X('mm-x-split-14'), X('mm-x-split-32'), X('mm-x-flat-entries'), X('mm-x-int-frag'), X('mm-x-code-split'),
    ],
  });

  C.lesson({
    id: 'mm-tlb', chapter: 'mm-paging', title: 'The TLB', minutes: 8,
    summary: 'A translation lookaside buffer caches recent translations, page number to frame. A hit costs the TLB lookup and the data access; a miss costs a page-table walk as well. A TLB is organised in sets like any cache, and its entries can be tagged with an address-space id so a context switch need not flush it.',
    blocks: [
      'With a four-level page table, every memory access becomes five: four table reads and the data. Programs tend to touch the same few pages over and over. How can the hardware avoid walking the tables again for a page it translated a moment ago?',
      { def: 'TLB', text: 'translation lookaside buffer: a small, fast cache of page-number-to-frame translations inside the MMU, checked before the page table on every access.' },
      { topic: 'mem-tlb', frame: 0, caption: 'A TLB of 4 entries, fully associative, and a 4-level table. A hit costs 1 + 100 = 101 ns; a miss reads 4 tables as well, 501 ns.' },
      { topic: 'mem-tlb', frame: 8, caption: 'Page 20 misses with all 4 entries full: page 5, least recently used, makes way.' },
      { predict: { q: 'The 14 references run on this 4-entry TLB. Would a direct-mapped TLB of the same 4 entries (page mod 4 picks the one entry it may use) do better or worse?', options: ['Better: no search is needed', 'Worse: pages that share a set push each other out', 'The same: 4 entries are 4 entries'], answer: 1, explain: 'Pages 4, 12, 20 and 28 all map to set 0 (page mod 4) and keep pushing each other out. Direct-mapped gets 5 hits against 6 for the fully associative TLB.' } },
      { topic: 'mem-tlb', input: { ways: '1' }, frame: 15, caption: 'Direct-mapped: 5 hits and 9 misses, 358.14 ns on average. Fully associative had 6 hits, 329.57 ns; with 8 entries it gets 8 hits.' },
      { h: 'Context switches: flush, or tag' },
      { topic: 'mem-tlb-switch', frame: 9, caption: 'A and B take turns of 3 references. Back on A: a miss in the TLB that was flushed at the switch, a hit in the one whose entries carry an address-space id (ASID).' },
      { topic: 'mem-tlb-switch', frame: 27, caption: 'Flushed: 2 hits and 18 misses. With ASIDs: 15 hits and 5 misses. Tags let a process come back to a warm TLB.' },
      memLab('A direct-mapped TLB thrashing, in the Memory lab', 'Code and data pages that map to the same set push each other out on every access. Change the associativity to 2-way and run it again.', paging({ va: 48, pa: 52, page: 4096, levels: 4, pte: 8, table: 'hier', space: 'sparse', n: 6, tlb: 4, ways: 1, addrs: ['0x40_0010:x', '0x60_4000', '0x40_0020:x', '0x60_4010', '0x40_0030:x', '0x60_4020', '0x40_0040:x', '0x60_4030'] })),
      { h: 'Recap' },
      { list: ['A TLB hit skips the walk; a miss walks and fills an entry.', 'Sets and ways: a page may only go in its own set; LRU picks the victim within it.', 'Without ASIDs every switch flushes the TLB; with them, entries survive.'] },
      X('mm-x-tlb-table'), X('mm-x-tlb-direct'), X('mm-x-asid'),
    ],
  });

  C.lesson({
    id: 'mm-eat', chapter: 'mm-paging', title: 'Effective access time and TLB reach', minutes: 7,
    summary: 'The effective access time weighs a hit and a miss by the hit ratio: EAT = h × (TLB + memory) + (1 − h) × (TLB + levels × memory + memory). A page-walk cache shortens misses. TLB reach, entries × page size, is the memory a TLB maps at once; large pages raise it without a larger TLB.',
    blocks: [
      'A TLB hits 98% of the time. That sounds nearly perfect. With a four-level table, how much slower is memory than it would be with no translation at all?',
      { math: 'EAT = h × (t_TLB + t_mem) + (1 − h) × (t_TLB + L × t_mem + t_mem)' },
      { topic: 'mem-eat', frame: 1, caption: 'A hit: 1 + 100 = 101 ns. A miss: 1 + 4 × 100 + 100 = 501 ns, 4.96 times a hit.' },
      { predict: { q: 'With a hit ratio of 0.98, what is the effective access time?', options: ['about 101 ns', '109 ns', '501 ns'], answer: 1, explain: '0.98 × 101 + 0.02 × 501 = 98.98 + 10.02 = 109 ns: 9% slower than memory alone.' } },
      { topic: 'mem-eat', frame: 2, caption: 'EAT = 0.98 × 101 + 0.02 × 501 = 109 ns, 9% slower than memory alone.' },
      { topic: 'mem-eat', frame: 3, caption: 'To stay within 10% of a bare access (110 ns), the hit ratio must be at least 0.9775.' },
      { topic: 'mem-eat', frame: 4, caption: 'A page-walk cache that hits 80% of the time leaves only the last level to read: a miss averages 261 ns, and EAT drops to 104.2 ns.' },
      { def: 'TLB reach', text: 'entries × page size: how much memory the TLB can map at once. A working set larger than the reach misses steadily, however good the replacement.' },
      { topic: 'mem-eat', frame: 5, caption: '64 entries reach 256 KiB with 4 KiB pages, 128 MiB with 2 MiB pages. Against a 64 MiB working set, only the large pages cover it.' },
      memLab('Access time in the Memory lab', 'The metrics tab works out the effective access time for your own TLB, levels and addresses. Try 2 levels against 4, and a TLB of 16 against 4.', paging({ va: 48, pa: 52, page: 4096, levels: 4, pte: 8, table: 'hier', space: 'sparse', n: 6, tlb: 8, ways: 2, tlbNs: 1, memNs: 100 })),
      { h: 'Recap' },
      { list: ['EAT = h × hit time + (1 − h) × miss time; a miss pays one read per level.', 'A small miss rate costs a lot when the walk is long.', 'Reach = entries × page size; large pages multiply it.'] },
      X('mm-x-eat'), X('mm-x-eat-ratio'), X('mm-x-reach'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: page-table structures
  // =========================================================================================================
  C.lesson({
    id: 'mm-walk', chapter: 'mm-tables', title: 'Walking a multilevel table', minutes: 9,
    summary: 'A multilevel table splits the page number into several indexes. The root table\'s entry, picked by the first index, names the frame of the next table; the last level\'s entry names the page\'s frame. Each level is one memory read. A part of the address space that is never used needs no table below the root at all.',
    blocks: [
      'One flat table for a 48-bit space with 4 KiB pages has 2^36 entries: 512 GiB, per process. Yet a process uses a few scattered regions: code, heap, libraries, stack. How can the table be built only where pages are mapped?',
      { def: 'multilevel page table', text: 'a tree of tables. The page number is cut into indexes, one per level; each entry of an upper level names the frame of a table one level down, and the last level names the frame of the page. A missing subtree means a whole range of unmapped pages.' },
      { topic: 'mem-walk', frame: 0, caption: 'x86-64 with four levels: the address 0x36a5_0001_f2e8 splits 9-9-9-9-12 into indexes 109, 148, 0, 31 and offset 0x2e8.' },
      { topic: 'mem-walk', frame: 1, caption: 'Level 1: the root table at 0x10_0000; entry 109 is at 0x10_0000 + 109 × 8 = 0x10_0368 and holds frame 0x104, the next table.' },
      { predict: { q: 'How many memory accesses does this translation take, with nothing in the TLB?', options: ['1', '4', '5'], answer: 2, explain: 'One read per level, 4, and then the data itself: 5 accesses.' } },
      { topic: 'mem-walk', frame: 5, caption: 'Frame 0x3cb5 joined to offset 0x2e8: physical 0x3cb_52e8, after 4 table reads and the data, 5 accesses.' },
      { topic: 'mem-walk', frame: 6, caption: '12 tables, 48 KiB, for 9 pages and a large page; one flat table for the same space would take 512 GiB.' },
      { topic: 'mem-walk', input: { which: 'unmapped' }, frame: 4, caption: 'An unmapped page: the level 4 entry 38 is not valid, so the walk stops with a page fault after 4 accesses.' },
      { topic: 'mem-walk', input: { which: 'large' }, frame: 4, caption: 'A large page: the level 3 entry is a leaf, so the low 21 bits are all offset (2 MiB) and the walk is one read shorter.' },
      { topic: 'mem-walk', input: { layout: 'x86-32' }, frame: 3, caption: 'The classic 32-bit layout splits 10-10-12: 2 table reads and the data, 3 accesses.' },
      memLab('Walk your own layout in the Memory lab', 'RISC-V Sv39, three levels of 9 bits, a dense space of 1500 pages: each address walked table by table, with the accesses counted.', paging({ va: 39, pa: 56, page: 4096, levels: 3, pte: 8, flags: ['V', 'R', 'W', 'X', 'U', 'G', 'A', 'D'], table: 'hier', space: 'dense', nd: 1500, tlb: 16, ways: 4, addrs: ['0x0', '0x1000', '0x2a3f', '0x1000:w', '0x5d_c000', '0x5d_cfff:w', '0x40', '0x5d_d000', '0x2a00'] })),
      { h: 'Recap' },
      { list: ['Each level\'s index picks an entry; the entry names the next table\'s frame.', 'An entry\'s address = table base + index × entry size.', 'A walk costs one read per level, then the data.', 'Unused ranges need no tables; a leaf higher up maps a large page.'] },
      X('mm-x-walk-16'), X('mm-x-split-sv39'), X('mm-x-walk-32'), X('mm-x-walk-fault'),
    ],
  });

  C.lesson({
    id: 'mm-tablesize', chapter: 'mm-tables', title: 'What the tables cost', minutes: 7,
    summary: 'A multilevel table takes one table per level for each stretch of the address space that has a mapped page: a dense run fills a few tables, scattered pages each need a path of their own. A flat table costs the same whatever is mapped. The number of levels and the bits each level takes decide how fine the stretches are.',
    blocks: [
      'Two processes each map 64 pages. One maps them in a single run; the other scatters them across its address space. Do their page tables cost the same?',
      { topic: 'mem-table-size', input: { pattern: 'dense', n: 64 }, frame: 1, caption: '64 pages in one run: 4 tables, one per level, 16 KiB.' },
      { predict: { q: 'The same 64 pages scattered so that no two share a table at levels 2 to 4. How many tables?', options: ['4, as before', '64', '193'], answer: 2, explain: 'One root, then a table at each of levels 2, 3 and 4 for every page: 1 + 3 × 64 = 193 tables, 772 KiB.' } },
      { topic: 'mem-table-size', input: { pattern: 'scattered', n: 64 }, frame: 1, caption: 'Scattered: 193 tables (1 + 64 + 64 + 64), 772 KiB, the worst case for the same number of pages.' },
      { topic: 'mem-table-size', frame: 4, caption: 'For 50 sparse processes: flat tables 25 TiB, 4-level tables 1.95 MiB, hashed tables 118.8 KiB, and one inverted table of 12 MiB for the whole machine.' },
      memLab('Designs compared in the Memory lab', 'The Tables tab compares one flat table, your hierarchical layout, a hashed and an inverted table for the space you map. Change the levels and the bits per level.', paging({ va: 32, pa: 32, page: 4096, levels: 2, pte: 4, flags: ['P', 'RW', 'US', 'A', 'D', 'G'], table: 'hier', space: 'sparse', n: 6, tlb: 4, ways: 0, procs: 10, addrs: ['0x40_0a10:x', '0x60_0008:w', '0x40_0a40:x', '0x60_1f00', '0x4000_0123', '0x60_0100', '0xffff_e010:w', '0x40_0b00:w', '0x5000_0000', '0x60_1f08'] })),
      { tip: 'The challenge "A page table for a sensor" asks for the cheapest layout of a given space within a budget: page size and bits per level are yours to choose.' },
      { challenge: 'mm-ch-sensor' },
      { h: 'Recap' },
      { list: ['A multilevel table pays per stretch of the space in use, not per page.', 'Dense runs share tables; scattered pages each need a path.', 'A flat table pays for the whole space, mapped or not.'] },
      X('mm-x-tables-count'), X('mm-x-table-bytes'),
    ],
  });

  C.lesson({
    id: 'mm-hashinv', chapter: 'mm-tables', title: 'Hashed and inverted tables', minutes: 8,
    summary: 'A hashed page table keeps one node per mapped page in buckets chosen by a hash of the page number, so its size follows the pages mapped, not the address space. An inverted table keeps one entry per physical frame, naming the (process, page) in it; a hash anchor table finds the chain to search, and the frame number is the matching entry\'s position. Both trade a short search for far less memory.',
    blocks: [
      'With 64-bit addresses even a multilevel table can need five or six levels: five or six reads on every TLB miss. Is there a table whose size depends on how much is mapped, or on how much memory the machine has, rather than on the address space?',
      { def: 'hashed page table', text: 'buckets of chained entries (page, frame, next). A lookup hashes the page number to a bucket and follows its chain until the page matches, or the chain ends in a fault.' },
      { topic: 'mem-hashed', frame: 0, caption: '7 pages hashed into 8 buckets by page mod 8: two chains of 3, one of 1, the rest empty.' },
      { predict: { q: 'Page 8 hashes to bucket 0, whose chain holds 16, then 24, then 8. How many memory accesses does the lookup take, with the data itself?', options: ['2', '3', '5'], answer: 2, explain: 'The bucket, then three nodes (16, 24, then 8), then the data: 5 accesses.' } },
      { topic: 'mem-hashed', frame: 8, caption: 'Page 8: the bucket and 3 nodes on its chain, then the data, 5 accesses. Page 19, first in its chain, took 3.' },
      { topic: 'mem-hashed', frame: 13, caption: 'Page 27 is not in bucket 3\'s chain: a page fault after 4 accesses.' },
      { def: 'inverted page table', text: 'one entry per physical frame, holding the (pid, page) that lives there, one table for the whole system. A hash anchor table points at the first entry of each chain.' },
      { topic: 'mem-inverted', frame: 6, caption: '(pid 1, page 4) hashes to anchor 3; entry 4 holds another page, its link leads to entry 6, a match. The page is in frame 6, the entry\'s own position.' },
      { topic: 'mem-inverted', frame: 16, caption: '80 bytes for every process together, where flat tables for the same 3 processes would take 1.5 TiB.' },
      memLab('An inverted table in the Memory lab', 'An inverted table of 16 frames shared by 50 processes: addresses looked up by hashing (pid, page), and the designs compared in the Tables tab.', paging({ va: 48, pa: 52, page: 4096, levels: 4, pte: 8, table: 'inverted', buckets: 8, frames: 16, space: 'sparse', n: 12, tlb: 4, ways: 0, procs: 50 })),
      { table: [['Design', 'Grows with', 'A lookup costs', 'Sharing a page'], ['multilevel', 'stretches of the space in use', 'one read per level', 'easy: two entries name one frame'], ['hashed', 'pages mapped', 'the bucket and the chain', 'easy'], ['inverted', 'physical frames', 'the anchor and the chain', 'hard: one entry per frame']], caption: 'Three ways to keep translations.' },
      { h: 'Recap' },
      { list: ['Hashed: one node per mapped page; the chain length is the cost.', 'Inverted: one entry per frame; the frame is the entry\'s index.', 'A long chain costs one access per node passed.'] },
      X('mm-x-hashed'), X('mm-x-inverted'), X('mm-x-which-design'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
