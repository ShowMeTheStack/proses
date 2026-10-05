// Part 10, main memory: the challenges, the guided tour, the course, and the pages the diagram checker looks at. Both
// challenges are of the pt-design kind: the reader chooses a page size and the index bits of each level, and the
// score is what the design costs for the given address space (the page tables S.Mem.build lays out, plus the unused
// ends of each region's last page), every region checked to translate.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('mm-ch-sensor')) return;

  // ---- 1. a 32-bit sensor ----------------------------------------------------------------------------------------
  C.challenge({ id: 'mm-ch-sensor', n: 101, title: 'A page table for a sensor', level: 2, kind: 'pt-design',
    story: 'A weather buoy logs wind and wave readings with a small 32-bit processor and very little memory. Its one program has four regions: the firmware near the bottom, a ring buffer of samples a little above it, a block of settings high up, and a stack just under the top of the address space. Most of the 4 GiB in between is never touched.\n\nEvery byte the page tables take, and every byte lost at the end of a half-used page, is a byte the buffer of samples cannot have. Choose the page size and the shape of the page table.',
    task: 'Choose a page size and how the index bits are split between levels, at most three. Cost = page-table bytes + the unused ends of the regions\' last pages.',
    metricName: 'bytes of overhead', unit: 'bytes', higher: false,
    space: { vaBits: 32, pteBytes: 4, regions: [
      { name: 'firmware', start: '0x00008000', bytes: 45000 }, { name: 'samples', start: '0x00400000', bytes: 720000 },
      { name: 'settings', start: '0x7ff00000', bytes: 6000 }, { name: 'stack', start: '0xffff8000', bytes: 24576 }] },
    limits: { pageSizes: [1024, 2048, 4096, 8192, 16384, 65536], maxLevels: 3 },
    target: 8000, marks: { silver: 6500, gold: 5960 },
    hints: ['One flat table for 32 bits is huge: with 4 KiB pages, 2^20 entries of 4 bytes, 4 MiB. Several levels let the empty gaps cost nothing.', 'The four regions are far apart, so each needs a path of tables of its own. Small tables at the lower levels waste less; but smaller pages need more entries, and larger pages waste more at the end of each region.', 'Two levels of 10 and 10 bits with 4 KiB pages cost 23624 bytes. Three levels do much better: 4 KiB pages split 8-6-6 cost 6472 bytes, and 2 KiB pages split 8-6-7 cost 5960.'],
    solution: { pageBytes: 2048, bits: [8, 6, 7] },
    wrong: [{ pageBytes: 4096, bits: [10, 10] }, { pageBytes: 65536, bits: [8, 8] }, { pageBytes: 4096, bits: [10, 9] }] });

  // ---- 2. a 39-bit board -----------------------------------------------------------------------------------------
  C.challenge({ id: 'mm-ch-board', n: 102, title: 'Four levels or three?', level: 3, kind: 'pt-design',
    story: 'A team is porting a robot controller to a small board with 39-bit virtual addresses and 8-byte page-table entries. The usual layout splits the page number 9-9-9 over three levels, so every table fills a 4 KiB page. But this controller runs dozens of copies of one small program, so the page tables of every copy add up, and the team may choose any page size the board offers and up to four levels.\n\nThe program has its code low down, a heap of about 6 MB above it, a shared library far up, and a 256 KiB stack at the very top of the space.',
    task: 'Choose a page size and the index bits of each level (two to four levels). Cost = page-table bytes + the unused ends of the regions\' last pages, for one copy of the program.',
    metricName: 'bytes of overhead', unit: 'bytes', higher: false,
    space: { vaBits: 39, pteBytes: 8, regions: [
      { name: 'code', start: '0x10000', bytes: 410000 }, { name: 'heap', start: '0x2000000', bytes: 6300000 },
      { name: 'library', start: '0x3f00000000', bytes: 1100000 }, { name: 'stack', start: '0x7ffffc0000', bytes: 262144 }] },
    limits: { pageSizes: [4096, 16384, 65536], maxLevels: 4, minLevels: 2 },
    target: 50000, marks: { silver: 40000, gold: 33328 },
    hints: ['The usual 9-9-9 split with 4 KiB pages costs 54320 bytes: eleven 4 KiB tables. Large pages shrink the tables but waste far more at the end of each region.', 'A fourth level lets the lowest tables be small, so a region that uses part of a table no longer pays for a whole 4 KiB table. Keep the page size at 4 KiB, where the waste at the regions\' ends is about 9 KiB.', 'With 4 KiB pages and four levels: 7-6-7-7, 8-6-6-7 and 8-7-6-6 all cost 33328 bytes, the least any design reaches here; 9-6-6-6 costs 33840.'],
    solution: { pageBytes: 4096, bits: [8, 6, 6, 7] },
    wrong: [{ pageBytes: 4096, bits: [9, 9, 9] }, { pageBytes: 65536, bits: [7, 8, 8] }, { pageBytes: 4096, bits: [13, 14] }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'mm-tour', title: 'Tour: main memory', blurb: 'Base and bounds, the fits, segments, the address split, the TLB, a four-level walk and the Memory lab, in nine steps.',
    steps: [
      { route: 'part=memory', target: '#main', text: 'Part 10 of the catalogue: how a logical address becomes a physical one, and how memory is shared out among processes.' },
      { route: 'topic=mem-base-bounds', target: '#stageWrap', text: 'The simplest MMU: a limit register checks every address and a base register relocates it. Watch logical 6144 trap.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=mem-fits', target: '#inputs', text: 'Choose first, best, worst or next fit and the same requests leave different holes behind.' },
      { route: 'topic=mem-paging', target: '#stageWrap', text: 'Paging: the low bits pass through as the offset, the high bits are replaced by a frame number from the page table.' },
      { route: 'topic=mem-tlb', target: '#stageWrap', text: 'The TLB caches translations: hits skip the walk, misses pay for it. Change the associativity and count the hits.' },
      { route: 'topic=mem-walk', target: '#stageWrap', text: 'A four-level walk on x86-64, entry by entry: four reads of the tables before the data.' },
      { route: 'labs/memory', target: '#labView', text: 'The Memory lab: choose the bits, the page size, the levels, the TLB and the table design, then type addresses and watch each one translated.' },
      { route: 'learn', target: '[data-chapter="mm-binding"]', text: 'The lessons and exercises of this part start here: addresses to split, tables to walk, TLBs to fill, and two page-table designs to fit a budget.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'mm-course', title: 'Main memory', blurb: 'All fifteen topics of part 10, from base and bounds to inverted page tables, with lessons and exercises on the way.',
    steps: [
      { lesson: 'mm-base', note: 'Logical and physical addresses.' },
      { topic: 'mem-base-bounds', note: 'The limit checks, the base relocates.' },
      { exercise: 'mm-x-bb-trap', note: 'Which addresses trap.' },
      { topic: 'mem-swapping', note: 'Whole processes out and back.' },
      { exercise: 'mm-x-bb-binding', note: 'Why a swapped process can move.' },
      { lesson: 'mm-fits', note: 'Holes and placement.' },
      { topic: 'mem-fits', note: 'One fit, step by step.' },
      { topic: 'mem-fits-compare', note: 'Four fits on one script.' },
      { exercise: 'mm-x-fit-table', note: 'First fit against best fit.' },
      { topic: 'mem-compaction', note: 'Sliding blocks together.' },
      { exercise: 'mm-x-compact-moved', note: 'What compaction copies.' },
      { topic: 'mem-segmentation', note: 'A table of segments.' },
      { exercise: 'mm-x-seg-table', note: 'Six accesses through it.' },
      { lesson: 'mm-pages', note: 'Pages and frames.' },
      { topic: 'mem-paging', note: 'The address split.' },
      { exercise: 'mm-x-split-32', note: 'Split a 32-bit address.' },
      { topic: 'mem-internal-frag', note: 'The waste in the last page.' },
      { exercise: 'mm-x-int-frag', note: 'Count the waste.' },
      { topic: 'mem-tlb', note: 'A cache of translations.' },
      { exercise: 'mm-x-tlb-table', note: 'Hits and misses.' },
      { topic: 'mem-tlb-switch', note: 'Flush, or tag with ASIDs.' },
      { topic: 'mem-eat', note: 'The effective access time.' },
      { exercise: 'mm-x-eat', note: 'Work one out.' },
      { lesson: 'mm-walk', note: 'Multilevel tables.' },
      { topic: 'mem-walk', note: 'Four levels on x86-64.' },
      { exercise: 'mm-x-walk-16', note: 'Walk one by hand.' },
      { topic: 'mem-table-size', note: 'What the tables cost.' },
      { exercise: 'mm-x-tables-count', note: 'Count the tables.' },
      { topic: 'mem-hashed', note: 'A hashed table.' },
      { topic: 'mem-inverted', note: 'An inverted table.' },
      { exercise: 'mm-x-inverted', note: 'Find the frame.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p10 lesson mm-base')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'memory').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p10 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['mm-x-bb-trap', 'mm-x-fit-table', 'mm-x-seg-table', 'mm-x-split-32', 'mm-x-tlb-table', 'mm-x-code-split', 'mm-x-walk-16', 'mm-x-walk-fault', 'mm-x-which-design'])
      S.Checks.push({ group: 'learn', name: 'p10 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p10 course mm-course', hash: 'course=mm-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['mm-ch-sensor', 'mm-ch-board']) S.Checks.push({ group: 'learn', name: 'p10 challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
