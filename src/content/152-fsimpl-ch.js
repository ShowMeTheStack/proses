// Part 15, file-system implementation: the guided tour, the course, and the pages the diagram checker looks at. No
// challenge kind fits this part yet (the kinds score schedules, C programs, page tables and disk-arm orders), so the
// part has no challenge of its own; its harder exercises (a block size for a terabyte, journaling outcomes of an
// overwrite, a buffer cache in C) stand in for one.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.tours.has('fi-tour')) return;

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'fi-tour', title: 'Tour: file-system implementation', blurb: 'The disk layout, allocation, the walk to byte N, the cache, a crash with and without a journal, copy-on-write, a log, and the File-system lab, in nine steps.',
    steps: [
      { route: 'part=fsimpl', target: '#main', text: 'Part 15 of the catalogue: how a file system lays out a disk, finds a file\'s blocks, caches them, and survives a power cut.' },
      { route: 'topic=fsi-layout', target: '#stageWrap', text: 'mkfs, block by block: the superblock, the two bitmaps, the inode table and the data region, with the sizes worked out from your geometry.' },
      { route: 'topic=fsi-alloc', target: '#inputs', text: 'Choose contiguous, linked, FAT, extents or indexed: the same files laid out five ways, and what each costs to grow.' },
      { route: 'topic=fsi-inode', target: '#stageWrap', text: 'The walk to byte N through direct, single, double and triple indirect pointers, an index at each level.' },
      { route: 'topic=fsi-cache', target: '#stageWrap', text: 'The buffer cache: hits, misses, dirty blocks and the sync. Switch to write-through and count the writes.' },
      { route: 'topic=fsi-journal', target: '#inputs', text: 'Cut the power after any write, in any journaling mode, and see what replay and fsck leave behind.' },
      { route: 'topic=fsi-cow', target: '#stageWrap', text: 'Copy-on-write: new blocks bottom up, then one uberblock write makes the change live. Checksums catch a flipped bit.' },
      { route: 'labs/fs', target: '#labView', text: 'The File-system lab: your own geometry, allocation, journal and cache; type commands, cut the power, walk to byte N, or switch to the copy-on-write and log-structured benches.' },
      { route: 'learn', target: '[data-chapter="fi-layout"]', text: 'The lessons and exercises of this part start here: layouts to work out, inodes to walk, crash outcomes to predict, and a buffer cache to write in C.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'fi-course', title: 'File-system implementation', blurb: 'All seventeen topics of part 15, from the disk layout to the flash-friendly log, with lessons and exercises on the way.',
    steps: [
      { lesson: 'fi-disk', note: 'What every block is for.' },
      { topic: 'fsi-layout', note: 'mkfs, region by region.' },
      { exercise: 'fi-x-layout', note: 'Lay out a disk yourself.' },
      { topic: 'fsi-commands', note: 'The blocks each command changes.' },
      { exercise: 'fi-x-link-writes', note: 'What link writes.' },
      { lesson: 'fi-alloc', note: 'Five allocation methods.' },
      { topic: 'fsi-alloc', note: 'One workload, five layouts.' },
      { exercise: 'fi-x-contig-moved', note: 'Files that must move.' },
      { topic: 'fsi-reach', note: 'Reaching block k.' },
      { exercise: 'fi-x-alloc-table', note: 'The methods side by side.' },
      { lesson: 'fi-inode', note: 'Indirect blocks.' },
      { topic: 'fsi-inode', note: 'The walk to byte N.' },
      { exercise: 'fi-x-walk-double', note: 'Two levels down.' },
      { exercise: 'fi-x-max-1', note: 'The largest file.' },
      { topic: 'fsi-free', note: 'Four records of free space.' },
      { exercise: 'fi-x-free-table', note: 'Compare them.' },
      { lesson: 'fi-lookup', note: 'Lookup and costs.' },
      { topic: 'fsi-lookup', note: 'Inode by inode.' },
      { topic: 'fsi-costs', note: 'The reads and writes of each call.' },
      { exercise: 'fi-x-lookup-reads', note: 'Count a lookup.' },
      { topic: 'fsi-cache', note: 'The buffer cache.' },
      { exercise: 'fi-x-cache-table', note: 'Write-back against write-through.' },
      { topic: 'fsi-ffs', note: 'Cylinder groups.' },
      { exercise: 'fi-x-ffs', note: 'Where a file goes.' },
      { lesson: 'fi-fsck', note: 'The order of updates.' },
      { topic: 'fsi-fsck', note: 'Cut the power, run fsck.' },
      { exercise: 'fi-x-fsck-table', note: 'Three orders, two cuts.' },
      { lesson: 'fi-journal', note: 'Journaling.' },
      { topic: 'fsi-journal', note: 'Three modes.' },
      { exercise: 'fi-x-journal-append', note: 'An append, cut three ways.' },
      { topic: 'fsi-checkpoint', note: 'Checkpoint, replay, revoke.' },
      { exercise: 'fi-x-revoke', note: 'Why revoke.' },
      { topic: 'fsi-cow', note: 'Copy-on-write.' },
      { exercise: 'fi-x-cow-writes', note: 'What an overwrite writes.' },
      { lesson: 'fi-lfs', note: 'A log of segments.' },
      { topic: 'fsi-lfs', note: 'The inode map and roll-forward.' },
      { topic: 'fsi-clean', note: 'The cleaner.' },
      { exercise: 'fi-x-lfs-score', note: 'Score the segments.' },
      { topic: 'fsi-flash', note: 'Why flash likes a log.' },
      { exercise: 'fi-x-flash', note: 'Wear, counted.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p15 lesson fi-disk')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'fsimpl').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p15 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['fi-x-layout', 'fi-x-alloc-table', 'fi-x-walk-double', 'fi-x-max-1', 'fi-x-free-table', 'fi-x-cache-table', 'fi-x-code-lru', 'fi-x-fsck-table', 'fi-x-journal-overwrite', 'fi-x-lfs-score'])
      S.Checks.push({ group: 'learn', name: 'p15 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p15 course fi-course', hash: 'course=fi-course', ready: "document.querySelector('#courseView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
