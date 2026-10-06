// Part 11, virtual memory: the chapters and the lessons. The exercises are in 111-vm-ex.js and 111-vm-ex2.js; the
// challenges, the guided tour, the course and the pages the diagram checker looks at are in 112-vm-ch.js. Each lesson
// opens with a question, runs the topic that shows the idea at a frame chosen for the point being made, asks for a
// prediction, sums up, and leads to its exercises. Every value quoted here is what the topics' own engines (S.VM and
// S.Mem) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'vm-demand')) return;

  C.chapter({ id: 'vm-demand', part: 'vm', n: 1, title: 'Demand paging', blurb: 'Pages brought in only when touched: the valid bit, the page-fault path, what a fault rate costs, copy-on-write, zero-fill and mapped files.' });
  C.chapter({ id: 'vm-replace', part: 'vm', n: 2, title: 'Page replacement', blurb: 'Which page to evict: FIFO, OPT, LRU and the clock family on the same strings, Belady\'s anomaly, and where locality comes from.' });
  C.chapter({ id: 'vm-frames', part: 'vm', n: 3, title: 'Frames and thrashing', blurb: 'Sharing frames among processes, global against local replacement, thrashing, the working set and page-fault frequency.' });
  C.chapter({ id: 'vm-alloc', part: 'vm', n: 4, title: 'Allocators and page size', blurb: 'The buddy system and slab caches in the kernel, malloc\'s free lists in a process, and what the page size trades.' });
  const X = (id) => ({ exercise: id });
  const vmLab = (title, text, setup) => ({ lab: 'vm', title, text, setup });
  const memLab = (title, text, setup) => ({ lab: 'memory', title, text, setup });
  const typed = (refs, frames, p1, p2, p3, more) => Object.assign({ mode: 'one', source: 'typed', refs: refs.split(' '), frames, pol1: p1, pol2: p2 || 'none', pol3: p3 || 'none' }, more || {});

  // =========================================================================================================
  // Chapter 1: demand paging
  // =========================================================================================================
  C.lesson({
    id: 'vm-fault', chapter: 'vm-demand', title: 'The page-fault path', minutes: 8,
    summary: 'With demand paging a page is brought into memory only when it is first touched. Its page-table entry carries a valid bit; touching a page whose bit is clear makes the MMU trap. The kernel checks that the address is legal, finds a frame (evicting a victim, written back first if dirty), reads the page in or fills it with zeros, sets the entry, and restarts the instruction. Almost all of the time goes to the disk.',
    blocks: [
      'A program of 2000 pages starts, and in its first second touches 40 of them. Must all 2000 be read from disk before it runs its first instruction? And if not, what happens on the first touch of a page that is still on disk?',
      { def: 'demand paging', text: 'pages are loaded only when a reference needs them. A page-table entry has a valid bit: set, the page is in a frame; clear, the page is on disk (or was never used, or the address is illegal). A reference to an entry with the bit clear is a page fault.' },
      { topic: 'vmem-fault-path', frame: 0, caption: 'The process reads page 4 of its heap. Its entry\'s valid bit is 0: the MMU cannot translate it.' },
      { topic: 'vmem-fault-path', frame: 2, caption: 'The kernel checks the process\'s memory map: page 4 is legal, just not in memory. An illegal address would end the process here.' },
      { predict: { q: 'No frame is free, and the policy picks page 3, which has been written to since it was loaded. What must happen before page 4 can be read into its frame?', options: ['Nothing: page 3 is simply overwritten', 'Page 3 is written to swap first, because its only up-to-date copy is in memory', 'Page 4 is read into a new frame the kernel creates'], answer: 1, explain: 'A dirty page differs from its copy on disk. Throwing it away would lose the writes, so it goes to swap first: a second disk transfer on this fault.' } },
      { topic: 'vmem-fault-path', frame: 4, caption: 'Page 3 is dirty, so it is written to swap first (8 ms); the process waits, and another runs.' },
      { topic: 'vmem-fault-path', frame: 7, caption: 'In all 16.004 ms: 16 ms on the disk and 3.7 µs in the kernel, 160037 times a memory access. The instruction restarts and finds the page.' },
      { topic: 'vmem-fault-path', input: { frame: 'free' }, frame: 6, caption: 'With a free frame, one disk read: 8.004 ms.' },
      { topic: 'vmem-fault-path', input: { source: 'zero', frame: 'clean' }, frame: 6, caption: 'A new anonymous page (heap or stack never used) is just filled with zeros, and a clean victim needs no write: 5.7 µs, no disk at all.' },
      { steps: ['The MMU finds the valid bit clear and traps.', 'The kernel checks the address against the memory map; illegal ends the process.', 'It finds a frame: a free one, or a victim chosen by the replacement policy.', 'A dirty victim is written to swap; its entry\'s valid bit is cleared.', 'The page is read from swap or its file, or zero-filled.', 'The entry gets the frame and the valid bit.', 'The faulting instruction restarts.'] },
      { h: 'Recap' },
      { list: ['A clear valid bit makes the MMU trap: a page fault.', 'Legal but absent: the kernel brings the page in and restarts the instruction.', 'A dirty victim costs a write before the read.', 'A fault with a disk transfer costs milliseconds; a memory access, a tenth of a microsecond.'] },
      X('vm-x-fault-order'), X('vm-x-fault-cost'),
    ],
  });

  C.lesson({
    id: 'vm-cost', chapter: 'vm-demand', title: 'What a fault rate costs', minutes: 7,
    summary: 'If a fraction p of accesses fault, the effective access time is (1 − p) × memory time + p × fault time. A fault is about 80000 times a memory access, so p has to be tiny: under one in a million or so to keep memory within ten per cent of its speed. Running a whole reference string shows where the time goes: almost all of it to the disk.',
    blocks: [
      'One access in a hundred thousand faults. That is 99.999% of accesses served from memory. How much slower does memory look?',
      { math: 'EAT = (1 − p) × t_mem + p × t_fault' },
      { topic: 'vmem-demand-eat', frame: 0, caption: 'A memory access takes 0.1 µs and a fault 8 ms, 80000 times longer.' },
      { predict: { q: 'With one fault every 100000 accesses (p = 0.00001), what is the effective access time?', options: ['about 0.1 µs: faults are too rare to matter', '0.18 µs, 1.8 times a memory access', '8 ms'], answer: 1, explain: '(1 − p) × 0.1 µs + p × 8000 µs = 0.1 + 0.08 = 0.18 µs. A fault is 80000 accesses\' worth of time, so one in 100000 nearly doubles the cost.' } },
      { topic: 'vmem-demand-eat', frame: 2, caption: 'EAT = (1 − p) × 0.1 µs + p × 8 ms = 0.18 µs, 1.8 times a memory access.' },
      { topic: 'vmem-demand-eat', frame: 3, caption: 'To stay within 10% of a memory access, at most one fault in 799990 accesses: this rate is 8 times too high.' },
      { topic: 'vmem-demand-run', frame: 6, caption: 'A whole string under LRU with 3 frames: page 4 was written, evicted to swap, and now comes back from swap, after dirty page 5 is written out. 16.004 ms for one reference.' },
      { topic: 'vmem-demand-run', frame: 15, caption: '13 faults in 14 references and 4 write-backs: 112.056 ms, an average of 8.004 ms a reference against 0.1 µs with everything resident.' },
      vmLab('Faults and their cost, in the VM lab', 'The Metrics tab prices every fault and write-back of your own string. Add w after a page to make a reference a write, and watch the write-backs.', typed('2 6 2 1 6w 2 3 6 2 1w 7 2 6 1 2 3w 6 2', 3, 'lru', 'fifo', 'opt')),
      { h: 'Recap' },
      { list: ['EAT = (1 − p) × memory time + p × fault time.', 'The fault term dominates as soon as p is more than about one in a million.', 'Dirty victims double the disk work of a fault.'] },
      X('vm-x-eat'), X('vm-x-max-rate'), X('vm-x-demand'),
    ],
  });

  C.lesson({
    id: 'vm-cow', chapter: 'vm-demand', title: 'Copy-on-write, zero-fill and mapped files', minutes: 8,
    summary: 'fork need not copy memory: parent and child share every frame, read-only and marked copy-on-write, and a page is copied only when one of them writes it. A page never used is mapped to a shared frame of zeros and given a fresh zeroed frame on its first write. mmap maps a file\'s pages: shared, a write reaches the page cache and later the file; private, a write copies the page first and never reaches the file.',
    blocks: [
      'A shell forks a child that immediately calls exec. Copying the parent\'s whole memory into the child would be wasted: exec throws it away a moment later. Can fork be cheap, and still give each process its own memory?',
      { def: 'copy-on-write', text: 'after fork, both page tables point at the same frames, every writable page made read-only and marked copy-on-write. A write faults; the kernel copies the page if the frame is still shared, or just makes it writable again if not.' },
      { topic: 'vmem-cow', frame: 1, caption: 'P1 forks P2: nothing is copied. The 3 mapped pages are shared, read-only and copy-on-write in both page tables.' },
      { topic: 'vmem-cow', frame: 3, caption: 'P2 writes page 0: frame 1 is shared by 2, so a fault copies it into frame 4 for P2.' },
      { predict: { q: 'P1 then writes its own page 0, still marked copy-on-write. Frame 1 is now used only by P1. Is it copied?', options: ['Yes: every copy-on-write page is copied on its first write', 'No: nobody else uses frame 1, so the fault just makes it writable', 'No: P1 is the parent, so its pages were never shared'], answer: 1, explain: 'The kernel keeps a count of references per frame. Frame 1 has 1 left, so copying would be wasted: the entry is made writable and the write goes ahead.' } },
      { topic: 'vmem-cow', frame: 4, caption: 'Frame 1 has one reference left: the fault only makes it writable, with no copy.' },
      { topic: 'vmem-cow', frame: 7, caption: 'Page 3 was demand-zero: a read mapped the shared zero frame; the first write gets a fresh frame filled with zeros.' },
      { topic: 'vmem-cow', frame: 9, caption: 'At the end 2 pages were copied, where an eager fork would have copied all 3 at once.' },
      { h: 'Memory-mapped files' },
      { topic: 'vmem-mmap', frame: 4, caption: 'P1 and P2 map the file shared. P1 writes 11 to page 0 in the page cache, and P2 reads 11 at once.' },
      { topic: 'vmem-mmap', frame: 9, caption: 'Dirty pages reach the file on msync or unmap: it ends holding 11, 20, 33 and 40.' },
      { topic: 'vmem-mmap', input: { script: ['m1p', 'm2s', 'r1.0', 'w1.0=11', 'r2.0', 's1', 'u1', 'u2'] }, frame: 3, caption: 'Mapped private, P1\'s write copies the page first: P2 still reads 10, and the file is never changed.' },
      { h: 'Recap' },
      { list: ['fork shares frames copy-on-write; a write copies only if the frame is still shared.', 'Never-used pages map the zero frame until written.', 'mmap shared: writes reach the file through the page cache. Private: writes copy the page.'] },
      X('vm-x-cow-copies'), X('vm-x-cow-why'), X('vm-x-mmap'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: page replacement
  // =========================================================================================================
  C.lesson({
    id: 'vm-basic', chapter: 'vm-replace', title: 'FIFO, OPT and LRU', minutes: 9,
    summary: 'When every frame is full, a fault must evict a page. FIFO evicts the page loaded first; OPT the page used farthest in the future, the best possible but needing to know the future; LRU the page used longest ago, looking back as a stand-in for looking ahead. On real strings LRU comes close to OPT, and FIFO can evict a page in heavy use.',
    blocks: [
      'Three frames are full of pages 2, 5 and 8, and the program now needs page 6. One of the three must go. Which one is the right victim, and what would the hardware have to know to choose it?',
      { topic: 'vmem-replace', input: { policy: 'fifo' }, frame: 6, caption: 'FIFO evicts page 2, loaded first, at reference 1, although page 2 was just used at reference 5 and is wanted again at reference 8.' },
      { topic: 'vmem-replace', input: { policy: 'opt' }, frame: 6, caption: 'OPT looks ahead: page 8 is next used at reference 10, the farthest, so it goes.' },
      { predict: { q: 'LRU looks back instead. At reference 6, pages 2, 5 and 8 were last used at references 5, 2 and 4. Which does LRU evict?', options: ['page 2', 'page 5', 'page 8'], answer: 1, explain: 'Page 5, last used at reference 2, is the least recently used.' } },
      { topic: 'vmem-replace', input: { policy: 'lru' }, frame: 6, caption: 'LRU evicts page 5, last used at reference 2, longest ago.' },
      { topic: 'vmem-replace', input: { policy: 'lru' }, frame: 15, caption: 'On this string of 14: OPT makes 7 faults, LRU 9 and FIFO 10.' },
      { topic: 'vmem-compare', frame: 11, caption: 'Ten policies on one string of 18 references with 3 frames: no policy can beat OPT\'s 9 faults.' },
      vmLab('LRU, FIFO and OPT in the VM lab', 'The three policies stepped side by side on your own string, with the reason for every victim. Change the frames and the string.', typed('7 1 3 7 2 1 7 4 2 3 7 1 4 2', 3, 'lru', 'fifo', 'opt')),
      { table: [['Policy', 'Evicts', 'Needs'], ['FIFO', 'the page loaded first', 'a queue'], ['OPT', 'the page used farthest ahead', 'the future: a yardstick, not a real policy'], ['LRU', 'the page used longest ago', 'the time of every use: costly in hardware']], caption: 'Three policies.' },
      { h: 'Recap' },
      { list: ['Empty frames fill first; after that every fault evicts a victim.', 'OPT is optimal and unrealisable: it measures the others.', 'LRU uses the past to guess the future, and usually guesses well.'] },
      X('vm-x-fifo-table'), X('vm-x-opt-table'), X('vm-x-lru-table'), X('vm-x-code-fifo'),
    ],
  });

  C.lesson({
    id: 'vm-clock', chapter: 'vm-replace', title: 'The clock and its cousins', minutes: 8,
    summary: 'True LRU would need a timestamp on every memory access. The hardware sets a use bit instead, and the clock algorithm sweeps a hand over the frames: a set bit is cleared and the page spared, a clear bit marks the victim. Second chance is the same idea on a FIFO queue. The enhanced clock also looks at the dirty bit, to prefer victims that need no write-back. Aging keeps a few bits of history per page.',
    blocks: [
      'The MMU can afford to set one bit in a page-table entry when a page is used, but not to record the time of every access. Is one bit per page enough to approximate LRU?',
      { def: 'use bit (reference bit)', text: 'a bit in each page-table entry that the hardware sets whenever the page is read or written. Software can read and clear it.' },
      { topic: 'vmem-replace', input: { policy: 'clock' }, frame: 5, caption: 'The clock with 3 frames: page 2 has just been hit, its use bit set; the hand points at frame 0.' },
      { predict: { q: 'Reference 6, page 6, faults. All three use bits are set. What does the hand do?', options: ['Evicts the page under it at once', 'Clears all three bits on a full sweep, then evicts page 2 in frame 0, where it started', 'Evicts the page with the oldest load time'], answer: 1, explain: 'Each set bit buys a page one pass of the hand: cleared, spared. After a full sweep the hand is back at frame 0, whose bit is now clear, and page 2 goes.' } },
      { topic: 'vmem-replace', input: { policy: 'clock' }, frame: 6, caption: 'The hand clears the bits of frames 0, 1 and 2, comes back to frame 0 and evicts page 2.' },
      { topic: 'vmem-replace', input: { policy: 'clock' }, frame: 15, caption: 'Clock: 10 faults on this string, LRU 9. With every bit set, the clock degrades to FIFO.' },
      { topic: 'vmem-replace', input: { policy: 'eclock' }, frame: 8, caption: 'The enhanced clock sorts pages into classes (use, dirty) and takes a (0, 0) page first: no write-back needed.' },
      { topic: 'vmem-replace', input: { policy: 'aging' }, frame: 6, caption: 'Aging shifts each page\'s use bit into a register at every tick; the smallest register, here 0001, marks the least used recently.' },
      vmLab('Clock against enhanced clock, with writes, in the VM lab', 'Writes set dirty bits; the enhanced clock prefers clean victims and saves write-backs. Compare the write-back counts in the Metrics tab.', typed('1w 4 2w 6 1 3 4 5w 2 6 1 4 3 2w', 3, 'clock', 'eclock')),
      { h: 'Recap' },
      { list: ['Clock: a set use bit is cleared and the page spared; a clear one is the victim.', 'With every bit set, the clock is FIFO.', 'Enhanced clock: prefer (not used, clean), then (not used, dirty).', 'Aging: a register of use bits, shifted every tick.'] },
      X('vm-x-clock-table'), X('vm-x-second-table'), X('vm-x-eclock'),
    ],
  });

  C.lesson({
    id: 'vm-belady', chapter: 'vm-replace', title: 'Belady\'s anomaly', minutes: 6,
    summary: 'More frames should never mean more faults, and for LRU and OPT they never do: the pages they keep in n frames are always among those they keep in n + 1 (they are stack algorithms). FIFO has no such property, and on some strings one more frame makes it fault more.',
    blocks: [
      'A machine is given more memory. Can any program fault more often than before?',
      { topic: 'vmem-belady', frame: 3, caption: '13 references. With 3 frames FIFO faults 9 times.' },
      { predict: { q: 'With 4 frames instead of 3, how does FIFO do on the same string?', options: ['Fewer faults: more frames always help', 'The same, 9', 'More: 10 faults'], answer: 2, explain: 'FIFO faults 10 times with 4 frames: one more frame, one more fault. LRU goes from 10 to 7 and OPT from 7 to 6.' } },
      { topic: 'vmem-belady', frame: 4, caption: 'With 4 frames FIFO faults 10 times, more than the 9 with 3: the anomaly.' },
      { topic: 'vmem-belady', frame: 7, caption: 'After reference 7 the 3 frames hold page 2 but the 4 frames do not: the larger memory is not a superset of the smaller one.' },
      { topic: 'vmem-belady', input: { source: 'search' }, frame: 4, caption: 'A seeded search can hunt for such strings. This one, found after 172 tries, also makes FIFO fault 9 times with 3 frames and 10 with 4.' },
      vmLab('Belady\'s anomaly in the VM lab', 'The sweep of faults against frames flags any frame count where FIFO faults more than with one frame fewer.', typed('3 5 2 6 3 5 4 3 5 1 6 1 4', 3, 'fifo', 'lru', null, { sweepMax: 6 })),
      { tip: 'A stack algorithm keeps, with n frames, a set of pages that is always contained in the set it would keep with n + 1. LRU is one (the n most recently used pages are among the n + 1 most recently used), and so is OPT. Such a policy can never show the anomaly.' },
      { h: 'Recap' },
      { list: ['FIFO can fault more with more frames.', 'LRU and OPT cannot: they are stack algorithms.'] },
      X('vm-x-belady'), X('vm-x-stack'),
    ],
  });

  C.lesson({
    id: 'vm-locality', chapter: 'vm-replace', title: 'Where reference strings come from', minutes: 7,
    summary: 'A reference string is the sequence of pages a program touches. Programs show locality: they stay on a small set of pages for a while, then move on. That is why a few frames serve a large program well. The order of loops decides the locality: a two-dimensional array walked along its rows touches each page once; walked down its columns, it can touch a different page on every access.',
    blocks: [
      'Two programs add up the same 16 × 16 array of ints, one row by row and one column by column. They do the same arithmetic. Do they make the same number of page faults?',
      { topic: 'vmem-refs', frame: 1, caption: '60 references with phases of locality: the working set over the last 6 references averages 3.52 pages, against 9 pages used in all.' },
      { topic: 'vmem-refs', input: { kind: 'random' }, frame: 2, caption: 'With no locality, LRU needs 7 frames to cut the misses past the first touches to a quarter; the string with phases needed 3.' },
      { topic: 'vmem-refs-c', input: { prog: 'rows' }, frame: 1, caption: 'A C program traced: 256 reads of the array, 128-byte pages. Row by row, consecutive reads stay on one page and collapse into 8 references.' },
      { predict: { q: 'The same sum column by column, with 4 frames under LRU. How many faults?', options: ['8, as by rows', 'about 32', '128'], answer: 2, explain: 'Each column step jumps to the next row, on another page, and 8 pages cycle through 4 frames: every one of the 128 references faults.' } },
      { topic: 'vmem-refs-c', frame: 3, caption: 'By columns the string faults 128 times with 4 frames; by rows, 8. The loop order alone changes the paging.' },
      vmLab('A C program traced, in the VM lab', 'Type or pick a C program: every load and store is recorded, turned into pages, and run through the policies.', { mode: 'one', source: 'c', pageBytes: 64, maxRefs: 40, frames: 3, pol1: 'lru', pol2: 'fifo', pol3: 'opt' }),
      { h: 'Recap' },
      { list: ['Locality: a program uses a few pages at a time.', 'Without locality no policy helps much.', 'Loop order decides the locality of array code.'] },
      X('vm-x-trace'), X('vm-x-loop-order'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: frames and thrashing
  // =========================================================================================================
  C.lesson({
    id: 'vm-share', chapter: 'vm-frames', title: 'Sharing the frames', minutes: 7,
    summary: 'Frames can be shared out equally, or in proportion to each process\'s size (or size and priority), with the frames left after rounding going to the largest remainders. Replacement can be global, where a fault may take any process\'s frame, or local, where a process replaces only among its own. Global lets a busy process grow at the others\' expense; local keeps each process\'s paging its own business.',
    blocks: [
      'Three processes of 10, 127 and 45 pages share 62 frames. Should each get 20?',
      { topic: 'vmem-frame-alloc', input: { scheme: 'equal' }, frame: 1, caption: 'Equal: 20 each and 2 spare. P1, with 10 pages, gets as many frames as P2 with 127.' },
      { topic: 'vmem-frame-alloc', frame: 2, caption: 'Proportional: each share is size / 182 × 62: P1 3.41, P2 43.26, P3 15.33.' },
      { predict: { q: 'Rounded down the shares are 3, 43 and 15, 61 frames. Who gets the 62nd?', options: ['P2, the largest process', 'P1, whose share had the largest remainder (0.41)', 'Nobody: it stays spare'], answer: 1, explain: 'The frames left go one each to the largest remainders: P1 had 0.41, P3 0.33, P2 0.26.' } },
      { topic: 'vmem-frame-alloc', frame: 4, caption: 'P1 gets the last frame: 4, 43 and 15.' },
      { topic: 'vmem-global-local', frame: 14, caption: 'Global replacement, 6 frames: A faults on page 5 and replaces its own page 3; B\'s two pages are never at risk here, but they could be.' },
      { topic: 'vmem-global-local', frame: 21, caption: 'Globally A faults 7 times and ends with 4 frames; with local quotas it faults 9 times. Global let the busy process grow.' },
      vmLab('Global against local, in the VM lab', 'Three processes share 9 frames. Switch Replacement between global and local and compare each process\'s faults.', { mode: 'multi', mframes: 9, mode2: 'global', scheme: 'proportional', mpolicy: 'lru', quantum: 3 }),
      { h: 'Recap' },
      { list: ['Equal: frames / n each. Proportional: size / total × frames, remainders to the largest fractions.', 'Global: a fault may take any frame; local: only the process\'s own.', 'Global adapts better; local isolates one process\'s paging from another\'s.'] },
      X('vm-x-prop'), X('vm-x-global'),
    ],
  });

  C.lesson({
    id: 'vm-thrash', chapter: 'vm-frames', title: 'Thrashing and the working set', minutes: 9,
    summary: 'Adding processes raises CPU use while each still has the frames its working set needs. Past that point each has too few, faults pile up on the paging disk, and the CPU sits idle: thrashing. The working set, the distinct pages of the last Δ references, says how many frames a process needs now. Page-fault-frequency control adjusts the frames directly: more when a process faults too often, fewer when it rarely does.',
    blocks: [
      'The CPU is 60% busy, so the scheduler admits another process to use the rest. Utilisation falls. It admits another. Utilisation falls further. What is going on?',
      { topic: 'vmem-thrashing', frame: 9, caption: '1000 frames, each process needing 100. Up to 10 processes each has its 100 frames and the CPU climbs to 100%.' },
      { predict: { q: 'With 20 processes, each gets 50 frames of the 100 it needs. Roughly how busy is the CPU?', options: ['still about 100%', 'about 50%', 'about 90%'], answer: 1, explain: 'Each process computes only 5 ms between faults instead of 20, the paging disk is saturated, and the CPU is 50% busy.' } },
      { topic: 'vmem-thrashing', frame: 19, caption: 'n = 20: 50 frames each, 5 ms of work between faults, the paging disk 100% busy and the CPU 50%.' },
      { topic: 'vmem-thrashing', frame: 24, caption: 'Utilisation peaks at 10 processes and collapses past it: thrashing. The cure is fewer processes in memory.' },
      { def: 'working set', text: 'W(t, Δ): the set of distinct pages referenced in the last Δ references up to time t. Its size is the number of frames the process needs right now.' },
      { topic: 'vmem-working-set', frame: 12, caption: 'Δ = 4: at t = 12 the last four references were 9, 8, 9, 8, so the working set is {8, 9}.' },
      { topic: 'vmem-working-set', frame: 21, caption: 'The working set averages 2.90 pages and peaks at 4, at the moves between localities.' },
      { topic: 'vmem-pff', frame: 6, caption: 'Page-fault frequency: over the last 5 references the rate was 0.80, above the upper bound 0.5, so the process gets a third frame.' },
      { topic: 'vmem-pff', frame: 37, caption: '11 faults in all; the allocation ranged from 2 to 4 frames as the locality changed.' },
      vmLab('Thrashing in the VM lab', 'Five processes in ten frames: watch the CPU-utilisation curve fall as processes are added, then change the frames.', { mode: 'multi', procs: [{ name: 'A', kind: 'loop', pages: 4, length: 18, refs: '-' }, { name: 'B', kind: 'loop', pages: 4, length: 18, refs: '-' }, { name: 'C', kind: 'phases', pages: 6, length: 18, refs: '-' }, { name: 'D', kind: 'loop', pages: 3, length: 18, refs: '-' }, { name: 'E', kind: 'walk', pages: 6, length: 18, refs: '-' }], mframes: 10, mode2: 'global', mpolicy: 'lru', quantum: 2, maxN: 12 }),
      { h: 'Recap' },
      { list: ['Thrashing: too few frames each, the disk saturated, the CPU idle.', 'The working set over Δ references measures what a process needs.', 'If the working sets add up to more than memory, suspend a process.', 'PFF: give frames when the fault rate is high, take them when it is low.'] },
      X('vm-x-ws'), X('vm-x-ws-max'), X('vm-x-thrash'), X('vm-x-pff'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: allocators and page size
  // =========================================================================================================
  C.lesson({
    id: 'vm-kalloc', chapter: 'vm-alloc', title: 'The buddy system and slabs', minutes: 8,
    summary: 'The kernel allocates physical memory in blocks. The buddy system keeps blocks of power-of-two sizes: a request takes the smallest size that holds it, splitting larger blocks in halves on the way down, and a freed block merges with its buddy whenever the buddy is free too. Slab caches serve objects of one size (inodes, task structures) from slabs of ready slots, so nothing is lost to rounding and a freed object\'s slot is reused at once.',
    blocks: [
      'The kernel needs 70 KiB for a buffer, then 35 KiB, then 80 KiB, and frees them later in any order. How can it find blocks fast, and get one large block back when everything is freed?',
      { def: 'buddy system', text: 'memory is a power-of-two block split in halves as needed. The two halves of a block are buddies: a block\'s buddy is at its offset with the bit for its size flipped. A free block whose buddy is also free merges with it, and so on upwards.' },
      { topic: 'vmem-buddy', frame: 1, caption: 'P asks for 70 KiB: a block of 128 KiB. 1024 KiB splits 3 times, each upper half going on a free list; 58 KiB of P\'s block is wasted inside.' },
      { topic: 'vmem-buddy', frame: 3, caption: 'R asks for 80 KiB: another block of 128 KiB, at 256.' },
      { predict: { q: 'Everything is freed at the end, in the order P, Q, S, R. Is the arena one block of 1024 KiB again?', options: ['Yes: each free merges with its buddy when the buddy is free, all the way up', 'No: the blocks stay at the sizes they were split to', 'Only after a compaction'], answer: 0, explain: 'When R, the last, is freed, its buddy at 384 is free, then the 256 KiB block at 0, then the 512 KiB block at 512: the joins rebuild one block of 1024 KiB.' } },
      { topic: 'vmem-buddy', frame: 8, caption: 'R frees 128 KiB at 256: it joins its buddy at 384, then at 0, then at 512, into 1024 KiB at 0.' },
      memLab('The buddy system in the Memory lab', 'Allocs and frees of your own in a buddy arena: the tree of splits and the free list of every size, step by step.', { mode: 'alloc', alloc: 'buddy', arena: 1024, minBlock: 32 }),
      { def: 'slab cache', text: 'a cache of objects of one size, made of slabs (a page or a few) cut into slots. A new object goes into a partial slab, else an empty one, else the cache grows by a slab.' },
      { topic: 'vmem-slab', frame: 8, caption: 'b is freed: its slab moves from the full list to the partial list, and its slot waits for the next inode.' },
      { topic: 'vmem-slab', frame: 12, caption: 'Memory is short: the empty slab goes back to the page allocator.' },
      { h: 'Recap' },
      { list: ['Buddy: power-of-two blocks, split on the way down, merged with free buddies on the way up.', 'Its cost is internal fragmentation: 70 KiB in a 128 KiB block.', 'Slabs: slots of exactly one object size, kept ready for reuse.'] },
      X('vm-x-buddy'), X('vm-x-buddy-waste'), X('vm-x-slab'),
    ],
  });

  C.lesson({
    id: 'vm-malloc', chapter: 'vm-alloc', title: 'malloc and free', minutes: 8,
    summary: 'A process\'s heap is a run of blocks, each with a header and a footer holding its size and whether it is free. malloc rounds the request up (with the tags and alignment), searches the free blocks (first, next or best fit, or a segregated list per size class), and splits off what it does not need. free marks a block free and merges it at once with a free neighbour, which the boundary tags make possible in constant time.',
    blocks: [
      'malloc(20) returns a pointer; free(p) gets only that pointer back. How does free know how big the block was, and whether the blocks beside it are free?',
      { def: 'boundary tags', text: 'a header and a footer word in every block, each holding the block\'s size and an allocated bit. The next block\'s header and the previous block\'s footer sit right beside a block, so free can check both neighbours at once.' },
      { topic: 'vmem-malloc', frame: 1, caption: 'malloc(20): 20 + 8 bytes of tags, rounded to 32; the free block at 0 splits into 32 used and 224 free. The pointer returned is 4, past the header.' },
      { predict: { q: 'c (24 bytes at 80) is freed while b\'s block (48 bytes at 32) was freed and then mostly reused by e, leaving a free block of 24 at 56. What happens to c\'s block?', options: ['It stays a free block of 24', 'It merges with the free block just below it, into 48 at 56', 'It merges with every free block in the heap'], answer: 1, explain: 'The footer just below c says that block is free, so the two merge into one block of 48 at 56. Only immediate neighbours merge.' } },
      { topic: 'vmem-malloc', frame: 7, caption: 'free(c) at 80: the previous block\'s footer says it is free, so they merge into 48 at 56.' },
      { topic: 'vmem-malloc', frame: 10, caption: 'At the end 120 bytes are free but the largest piece is 48: 60% of the free space lies outside it.' },
      { topic: 'vmem-malloc-compare', frame: 11, caption: 'Four policies, one script: segregated lists looked at 9 blocks, best fit 13; next fit left its free space in one piece here.' },
      memLab('A malloc heap in the Memory lab', 'Your own mallocs and frees on a heap with boundary tags; switch the search between first, next and best fit and segregated lists.', { mode: 'alloc', alloc: 'malloc', heap: 256, mfit: 'first' }),
      { h: 'Recap' },
      { list: ['A block = header + payload + footer, rounded to the alignment.', 'malloc searches, then splits if the rest is big enough to be a block.', 'free merges with free neighbours at once, thanks to the tags.', 'Segregated lists search less; first fit is simple and often good.'] },
      X('vm-x-malloc'), X('vm-x-malloc-size'),
    ],
  });

  C.lesson({
    id: 'vm-pagesize', chapter: 'vm-alloc', title: 'Choosing a page size', minutes: 7,
    summary: 'Small pages waste little at the end of each allocation and bring in only what is used, but need many table entries and give the TLB a small reach. Large pages need few entries and reach far, but waste more and read more on each fault. Processors offer several sizes at once. Prepaging brings in pages likely to be wanted soon, and pays only when most of them are used.',
    blocks: [
      'A program\'s allocations add up to 3.2 MiB. Pages of 1 KiB or of 2 MiB: what does each choice cost?',
      { topic: 'vmem-page-size', frame: 2, caption: '4 KiB pages: 822 entries, 9.95 KiB wasted, and a 64-entry TLB reaches 256 KiB, 8% of the pages used.' },
      { predict: { q: 'With 2 MiB pages, how much is wasted at the ends of the five allocations?', options: ['less than with 4 KiB pages', 'about the same', 'megabytes'], answer: 2, explain: 'Each allocation is rounded up to whole 2 MiB pages: a 1.17 KiB allocation alone wastes almost 2 MiB. In all 8.8 MiB, more than the 3.2 MiB used.' } },
      { topic: 'vmem-page-size', frame: 4, caption: '2 MiB pages: 6 entries, a reach of 128 MiB, but 8.8 MiB wasted.' },
      { topic: 'vmem-page-size', frame: 6, caption: 'Neither end wins everywhere: small pages waste least, large pages reach furthest. Hence several page sizes at once.' },
      { topic: 'vmem-page-size', frame: 7, caption: 'Prepaging brings in neighbours of a faulting page, or a whole working set; it pays when most of the extra pages are used.' },
      { h: 'Recap' },
      { list: ['Smaller pages: less internal fragmentation, more entries, smaller TLB reach.', 'Larger pages: fewer entries, larger reach, more waste.', 'Prepaging trades disk transfers for faults.'] },
      X('vm-x-pagesize'), X('vm-x-prepage'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
