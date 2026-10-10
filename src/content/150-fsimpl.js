// Part 15, file-system implementation: the chapters and the lessons of the first two chapters (the disk image and
// allocation; lookup, caching and locality). The lessons of the last two chapters (crash consistency; log-structured
// and flash) are in 150-fsimpl2.js, the exercises in 151-fsimpl-ex.js and 151-fsimpl-ex2.js, and the tour, the
// course and the pages the diagram checker looks at in 152-fsimpl-ch.js. Every value a caption quotes is what the
// topic's own engines (S.FS) say at that frame, on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'fi-layout')) return;

  C.chapter({ id: 'fi-layout', part: 'fsimpl', n: 1, title: 'The disk image and allocation', blurb: 'What every block of a disk is for, five ways to give blocks to a file, inodes with indirect pointers, and how free blocks are remembered.' });
  C.chapter({ id: 'fi-perf', part: 'fsimpl', n: 2, title: 'Lookup, caching and locality', blurb: 'The reads and writes behind each call, the buffer cache in front of the disk, and cylinder groups that keep related blocks close.' });
  C.chapter({ id: 'fi-crash', part: 'fsimpl', n: 3, title: 'Crash consistency', blurb: 'The power fails between two writes: the order of updates and fsck, journaling in three modes with checkpoint and replay, and copy-on-write trees with checksums.' });
  C.chapter({ id: 'fi-log', part: 'fsimpl', n: 4, title: 'Log-structured and flash', blurb: 'Every write appended to a log: segments, the inode map, roll-forward, the cleaner and its write cost, and why flash likes it.' });
  const X = (id) => ({ exercise: id });
  const fsLab = (title, text, setup) => ({ lab: 'fs', title, text, setup });

  // =========================================================================================================
  // Chapter 1: the disk image and allocation
  // =========================================================================================================
  C.lesson({
    id: 'fi-disk', chapter: 'fi-layout', title: 'The disk, block by block', minutes: 8,
    summary: 'mkfs turns a row of blank blocks into a file system: block 0 the superblock with the geometry, an inode bitmap, a data bitmap, the inode table, and the data region. Every command then changes a few of these blocks: an inode, a bitmap bit, a directory block, a data block.',
    blocks: [
      'A new disk is just a row of numbered blocks, all alike. After mkfs, the system can find any file by name. Where does it keep the names, the sizes, the list of blocks each file owns, and the record of which blocks are free?',
      { def: 'superblock', text: 'block 0: the geometry of the file system (block size, how many blocks and inodes, where each region starts) and a magic number that says the disk holds this kind of file system.' },
      { def: 'inode', text: 'a fixed-size record for one file or directory: its type, permission bits, owner, link count, size, and the pointers to its blocks. Files are known inside the system by inode number.' },
      { topic: 'fsi-layout', frame: 1, caption: 'A disk of 64 blocks of 128 bytes. Block 0, the superblock, says where everything else is: the inode table at block 3, data from block 19.' },
      { topic: 'fsi-layout', frame: 4, caption: 'An inode needs 52 bytes (16 for the fixed fields, 9 pointers of 4 bytes), rounded up to 64: 2 fit in a block, so 32 inodes take 16 blocks, 3 to 18.' },
      { predict: { q: 'The same disk is made with 256 inodes instead of 32. What happens to the data region?', options: ['It stays the same size: inodes live elsewhere', 'There is none: the inode table alone would need 128 blocks, more than the disk has', 'It grows, because each inode gets smaller'], answer: 1, explain: 'The inode table is carved out of the same 64 blocks. At 2 inodes a block, 256 inodes would need 128 blocks: mkfs refuses the geometry. Inodes are fixed at mkfs time, and every one of them costs disk space whether it is used or not.' } },
      { topic: 'fsi-layout', input: { bs: '512', nblocks: 128, ninodes: 256, ndirect: 12, ps: '4', jblocks: 0 }, frame: 6, caption: 'With 256 inodes of 128 bytes on 128 blocks of 512 bytes, 67 blocks hold metadata (52.3%) and only 61 hold data.' },
      { h: 'Each command touches a few blocks' },
      'Nothing in a file system changes in one place. Making a directory needs a new inode, its bit in the inode bitmap, a data block for its entries and that block\'s bit, plus an entry and a link in the parent.',
      { topic: 'fsi-commands', frame: 1, caption: 'mkdir /notes writes 6 blocks: two inode-table blocks (the new inode and the parent\'s link count), both bitmaps, and two directory blocks.' },
      { topic: 'fsi-commands', frame: 5, caption: 'link /notes/todo /urgent writes 3 blocks: the inode\'s link count goes to 2, and the root directory gains the entry urgent. No bitmap changes: nothing is allocated.' },
      { topic: 'fsi-commands', frame: 7, caption: 'unlink /urgent removes the last name: 4 blocks, the inode freed, its bit cleared, its one data block\'s bit cleared, and the entry gone.' },
      fsLab('The disk in the File-system lab', 'Your own geometry and commands: after each one the blocks it changed light up, and the Tables tab lists the regions of the disk.', { mode: 'disk' }),
      { h: 'Recap' },
      { list: ['mkfs lays out the superblock, the inode bitmap, the data bitmap, the inode table and the data region.', 'The inode table is fixed at mkfs: inodes per block is the block size over the inode size.', 'A command changes several blocks: inodes, bitmaps, directory blocks, data blocks, each for its own reason.'] },
      X('fi-x-ipb'), X('fi-x-layout'), X('fi-x-link-writes'),
    ],
  });

  C.lesson({
    id: 'fi-alloc', chapter: 'fi-layout', title: 'Five ways to allocate blocks', minutes: 9,
    summary: 'Contiguous allocation gives each file one run of blocks: finding block k is an addition, but a growing file may have to move, and free space breaks into holes too short to use. Linked allocation chains the blocks, so any free block will do, at the price of walking the chain. FAT moves the chain into a table; extents record runs; indexed allocation keeps pointers in the inode and in indirect blocks.',
    blocks: [
      'Two files grow in turns, a block or two at a time. Where should the system put each new block so that the file is quick to read later, and so that the next file still finds room?',
      { topic: 'fsi-alloc', frame: 4, caption: 'Contiguous: a has blocks 6–7 and b has 8–9. Now a wants two more, but block 8 is taken.' },
      { predict: { q: 'Under contiguous allocation, a (blocks 6–7) must grow to 4 blocks, and 8–9 belong to b. What does the system do?', options: ['It adds blocks 10–11 to a and remembers the gap', 'It copies a\'s 2 blocks to the first free run long enough for all 4, and frees 6–7', 'It refuses: a file cannot grow past its neighbour'], answer: 1, explain: 'A contiguous file is one run, recorded as (start, count). With b in the way, a moves whole to 10–13: 2 blocks copied, and a hole of 2 left behind.' } },
      { topic: 'fsi-alloc', frame: 5, caption: 'a moves from 6–7 to 10–11, the first run long enough, and its run is now start 10, count 4. Each later growth moves a file again: 8 blocks moved in all.' },
      { topic: 'fsi-alloc', input: { method: 'contiguous', work: 'holes' }, frame: 14, caption: 'Fill, delete, refill: f needs 8 blocks in one run, 15 blocks are free, but the longest run is 5. Refused: external fragmentation.' },
      { topic: 'fsi-alloc', input: { method: 'contiguous', work: 'holes' }, frame: 15, caption: 'Compaction slides every file down (14 blocks copied), and the 15 free blocks become one run.' },
      { h: 'Chains, tables, runs and pointers' },
      { topic: 'fsi-alloc', input: { method: 'linked', work: 'interleave' }, frame: 7, caption: 'Linked: any free block joins the chain, so nothing moves. Each block\'s last 2 bytes name the next, so a 256-byte block carries 254 bytes of data. a is 6 → 7 → 10 → 11 → 13 → 14.' },
      { topic: 'fsi-alloc', input: { method: 'fat', work: 'holes' }, frame: 14, caption: 'FAT: the same chain, but in a table, FAT[b] naming the block after b. f takes the two holes, 11–15 and 21–23, with no failure.' },
      { topic: 'fsi-alloc', input: { method: 'extent', work: 'holes' }, frame: 15, caption: 'Extents: f\'s 13 blocks are recorded as three runs, (11, 5), (21, 5), (35, 3): a few pairs instead of a pointer per block.' },
      { topic: 'fsi-alloc', input: { method: 'indexed', work: 'big' }, frame: 6, caption: 'Indexed: the 6 direct pointers are used up, so log\'s 7th block onwards is named from a single-indirect block, 13: one extra block of metadata.' },
      { table: [['Method', 'The inode records', 'Grows by', 'Weak spot'], ['contiguous', 'start, count', 'moving the file if the next block is taken', 'external fragmentation'], ['linked', 'first and last block', 'any free block', 'reaching block k walks the chain'], ['FAT', 'first block; the chain is in the table', 'any free block', 'the table must be in memory'], ['extents', '(start, length) pairs', 'a new run when it must', 'a badly scattered file needs many extents'], ['indexed', 'direct and indirect pointers', 'any free block', 'indirect blocks to read for large files']], caption: 'Five allocation methods on one workload.' },
      fsLab('Allocation in the File-system lab', 'Contiguous runs: a file that must move, a request refused for want of a run, then compact. Switch Allocation to compare.', { mode: 'disk', src: 'create /a\nappend /a [512 bytes]\ncreate /b\nappend /b [256 bytes]\ncreate /c\nappend /c [512 bytes]\nunlink /b\nappend /a [2400 bytes]\ncompact\nappend /a [2400 bytes]', alloc: 'contiguous', bs: 256, nblocks: 32, ninodes: 8, walk: false }),
      { h: 'Recap' },
      { list: ['Contiguous: one run per file; growth may move it, and holes can refuse a file though blocks are free.', 'Linked and FAT: a chain, so any block fits; FAT keeps the chain in a table.', 'Extents: runs as (start, length) pairs.', 'Indexed: pointers, direct then indirect.'] },
      X('fi-x-contig-moved'), X('fi-x-alloc-table'),
    ],
  });

  C.lesson({
    id: 'fi-reach', chapter: 'fi-layout', title: 'Finding block k', minutes: 7,
    summary: 'To read byte N a system finds file block N ÷ (bytes a block carries), then the disk block that holds it. Contiguous allocation adds it to the start; extents skip whole runs; indexed allocation reads an indirect block or two; FAT hops through a table kept in memory; linked allocation must read every block before it.',
    blocks: [
      'A program seeks to the middle of a 10-block file and reads one byte. How many disk reads does that one byte cost? It depends entirely on how the file\'s blocks were recorded.',
      { topic: 'fsi-reach', frame: 1, caption: 'Linked: each 128-byte block carries 126 bytes of data, so byte 885 is in file block 885 ÷ 126 = 7, at offset 3.' },
      { topic: 'fsi-reach', frame: 9, caption: 'The chain must be followed from its start: 7 hops, each one a disk read.' },
      { predict: { q: 'The same file with FAT allocation: the chain lives in the table. How many disk reads to reach file block 7?', options: ['9, as for linked', '3: the inode, the FAT block once, then the data block', '1: only the data block'], answer: 1, explain: 'The FAT is one block here, read once and kept in memory; the 7 hops are done in memory. Then the data block: 3 reads in all, counting the inode\'s block.' } },
      { topic: 'fsi-reach', input: { method: 'fat', size: 10, k: 7, scatter: 'scattered' }, frame: 9, caption: '7 hops through the FAT, in memory: no data block is read on the way. 3 disk reads in all.' },
      { topic: 'fsi-reach', input: { method: 'contiguous', size: 10, k: 7, scatter: 'scattered' }, frame: 3, caption: 'Contiguous: block = start + file block = 21 + 7 = 28, with no other read.' },
      { topic: 'fsi-reach', input: { method: 'extent', size: 12, k: 9, scatter: 'scattered' }, frame: 5, caption: 'Extents: skip (8, 4) and (13, 4), and (18, 4) covers file block 9: block 18 + 1 = 19.' },
      { topic: 'fsi-reach', input: { method: 'indexed', size: 12, k: 9, scatter: 'scattered' }, frame: 4, caption: 'Indexed, 4 direct pointers: file block 9 is entry 5 of the single-indirect block 12, which holds block 20.' },
      { topic: 'fsi-reach', frame: 11, caption: 'Read in order, the linked file costs 11 reads; in a shuffled order, 56, because every jump starts the chain again.' },
      { h: 'Recap' },
      { list: ['File block = ⌊N ÷ payload⌋; a linked block loses its pointer bytes from the payload.', 'Contiguous and extents: arithmetic on the inode\'s runs.', 'Indexed: one read per level of indirect block.', 'Linked: one read per block before it; FAT: the same hops, in memory.'] },
      X('fi-x-alloc-table'), X('fi-x-linked-block'), X('fi-x-extent-block'),
    ],
  });

  C.lesson({
    id: 'fi-inode', chapter: 'fi-layout', title: 'Inodes and indirect blocks', minutes: 9,
    summary: 'An inode holds a few direct pointers, then a single, a double and a triple indirect pointer. With P pointers a block (the block size over the pointer size), the direct part maps the first blocks, the single indirect block the next P, the double the next P², the triple the next P³. The largest file is that many blocks times the block size; the walk to byte N picks the part, then an index at each level.',
    blocks: [
      'A small file should cost one inode and its data, nothing more. A huge file must still be reachable from the same fixed-size inode. How can one record of a few dozen bytes do both?',
      { def: 'indirect block', text: 'a data block filled with block pointers. The single-indirect pointer names one such block; the double-indirect pointer names a block of pointers to such blocks; the triple adds one more level.' },
      { topic: 'fsi-inode', input: { bs: '256', ps: '4', ndirect: 6, levels: 3, target: 'direct' }, frame: 2, caption: 'Byte 597 is in file block 2, below the 6 direct pointers: direct pointer 2 maps it.' },
      { topic: 'fsi-inode', input: { bs: '256', ps: '4', ndirect: 6, levels: 3, target: 'single' }, frame: 2, caption: 'A 256-byte block holds 64 pointers of 4 bytes. File block 31 is at least 6 and below 70: entry 25 of the single-indirect block.' },
      { predict: { q: 'Byte 437,333 is in file block 1708. The direct pointers and the single indirect block cover file blocks 0 to 69. Which part maps file block 1708?', options: ['The single-indirect block', 'The double-indirect block: it covers 64 × 64 more, up to 4165', 'The triple-indirect block'], answer: 1, explain: 'The double-indirect pointer covers the next 64² = 4096 file blocks, 70 to 4165. 1708 − 70 = 1638 is the entry within that part: index 1638 ÷ 64 = 25 in the first level, 1638 mod 64 = 38 in the second.' } },
      { topic: 'fsi-inode', frame: 2, caption: 'File block 1708 is at least 70 and below 4166: the double-indirect part, entry 1638 of what it reaches.' },
      { topic: 'fsi-inode', frame: 4, caption: 'Level one: index 1638 ÷ 64 = 25, at byte 100 of indirect block 9, holds block 10.' },
      { topic: 'fsi-inode', frame: 5, caption: 'Level two: index 38, at byte 152 of indirect block 10, holds data block 11. The byte is at offset 85.' },
      { h: 'The largest file' },
      { math: 'P = block size ÷ pointer size\nlargest file = (direct + P + P² + P³) × block size' },
      { topic: 'fsi-inode', input: { bs: '4096', ps: '4', ndirect: 11, levels: 3, target: 'triple' }, frame: 0, caption: 'With 4096-byte blocks and 4-byte pointers, P = 1024 and the largest file is 4 TiB: almost all of it in the triple-indirect part.' },
      { topic: 'fsi-inode', input: { bs: '128', ps: '8', ndirect: 4, levels: 1, target: 'N', N: 5000 }, frame: 0, caption: 'One level only, 128-byte blocks and 8-byte pointers: P = 16, and the largest file is (4 + 16) × 128 bytes, 2.5 KiB.' },
      fsLab('Byte N in the File-system lab', 'A file with a hole in it, and the walk to byte 9003 through the double-indirect pointer. Change the block size, the pointers and N.', { mode: 'disk', src: 'create /atlas\nwrite /atlas 0 charts of the coast\nwrite /atlas 9000 harbour', bs: 128, ndirect: 4, ps: 4, nblocks: 64, walkPath: '/atlas', walkN: 9003 }),
      { h: 'Recap' },
      { list: ['P = block size ÷ pointer size.', 'The parts cover direct, then P, P², P³ file blocks, in that order.', 'Subtract the blocks of the earlier parts, then divide by P at each level for the indices.', 'Largest file = (direct + P + P² + P³) × block size.'] },
      X('fi-x-walk-direct'), X('fi-x-walk-single'), X('fi-x-walk-double'), X('fi-x-walk-triple'), X('fi-x-max-1'), X('fi-x-max-2'), X('fi-x-max-design'),
    ],
  });

  C.lesson({
    id: 'fi-free', chapter: 'fi-layout', title: 'Remembering the free blocks', minutes: 6,
    summary: 'A bitmap spends one bit per block, always, and finds runs easily. A free list threads a chain through the free blocks themselves: almost no space, but one read per block taken. Grouping packs many free block numbers into one free block. Counting keeps (start, count) pairs, whose number grows with how broken up the free space is.',
    blocks: [
      'When a file grows, the system needs a free block, fast, and preferably one next to the file\'s last block. What record of the free blocks makes that quick, and how much space does the record itself cost?',
      { topic: 'fsi-free', frame: 1, caption: 'The bitmap: one bit for each of the 49 data blocks, 7 bytes, however many are free. One read finds 6 free blocks, and runs of them.' },
      { topic: 'fsi-free', frame: 2, caption: 'A free list: only a 4-byte head pointer, but taking 6 blocks reads 6 blocks, one after another, in whatever order the list holds.' },
      'Grouping improves on the list: one free block holds the numbers of up to 31 others, and its last number names the next such block. Here 2 group blocks hold all 34 free block numbers, and one read yields the 6 needed.',
      { predict: { q: 'Counting keeps one (start, count) pair per run of free blocks. Which free space makes its record largest?', options: ['A nearly empty disk', 'Many single free blocks scattered about', 'A nearly full disk with one long run free'], answer: 1, explain: 'Each separate run is a pair, whatever its length. Scattered single blocks are each a run of one.' } },
      { topic: 'fsi-free', input: { pattern: 'scattered', k: 8 }, frame: 4, caption: '17 free blocks in 11 runs: counting needs 11 pairs, 88 bytes, while the bitmap stays at 7.' },
      { topic: 'fsi-free', input: { pattern: 'runs', k: 10 }, frame: 4, caption: '27 free blocks in 2 long runs: 2 pairs, 16 bytes, and 10 contiguous blocks come from one pair.' },
      { h: 'Recap' },
      { list: ['Bitmap: one bit per block, fixed size, finds runs.', 'Free list: tiny, but one read per block taken.', 'Grouping: many numbers per read.', 'Counting: one pair per run; small when free space is in long runs.'] },
      X('fi-x-free-table'), X('fi-x-bitmap-size'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: lookup, caching and locality
  // =========================================================================================================
  C.lesson({
    id: 'fi-lookup', chapter: 'fi-perf', title: 'Lookup and the cost of each call', minutes: 8,
    summary: 'A path is looked up one name at a time from the root, inode 1: for each directory its inode, then its entry blocks, until the last name gives the file\'s inode. Each call then costs its own reads and writes: create reads the path and writes an inode, a bitmap and an entry; write touches the data bitmap, the data blocks and the inode; close touches nothing on disk.',
    blocks: [
      'open("/home/ana/notes/todo") gives back a descriptor in a moment. Behind it, how many blocks did the system read before it even knew which inode the file was?',
      { topic: 'fsi-lookup', frame: 1, caption: 'The root, inode 1: its inode-table block 3, then its entry blocks 15 and 22, which name home as inode 5. 3 reads.' },
      { predict: { q: 'Each of the next directories, /home, /home/ana and /home/ana/notes, needs its inode and one block of entries (todo\'s directory inode shares a block already read). How many reads in all?', options: ['4: one per name', '8', '12'], answer: 1, explain: '3 for the root, 2 for /home, 2 for ana, and 1 for notes, whose inode shares a block already read: 8 blocks for 4 names.' } },
      { topic: 'fsi-lookup', frame: 5, caption: '4 directories searched, 8 blocks read. A cache of recent names would answer the same lookup again with no reads at all.' },
      { topic: 'fsi-lookup', input: { path: '/links/docs/plan', user: 'ana' }, frame: 3, caption: 'docs is a symbolic link to /home/ana/notes: the lookup reads its target and starts again from the root.' },
      { topic: 'fsi-lookup', input: { path: '/home/ben/secret', user: 'ana' }, frame: 3, caption: 'Every directory passed needs search (x) permission: ana may not search ben\'s directory, mode rwx------, so the lookup stops there.' },
      { h: 'The cost of each call' },
      { topic: 'fsi-costs', frame: 1, caption: 'create /docs/report with no cache: 5 reads (the path) and 3 writes (the inode, its bitmap bit, the entry in /docs).' },
      { topic: 'fsi-costs', frame: 3, caption: 'write 3 blocks: 2 reads and 5 writes, the data bitmap, the 3 data blocks and the inode with its new size and pointers.' },
      { topic: 'fsi-costs', frame: 8, caption: 'In all, 21 reads and 12 writes with no cache. A 16-block write-back cache needs 0 reads and 7 writes for the same calls.' },
      { h: 'Recap' },
      { list: ['Lookup reads each directory\'s inode and entries, name by name, from inode 1.', 'A symbolic link restarts the lookup at its target; search permission is checked on every directory.', 'create, write and delete each write several blocks; open and read only read; close does nothing on disk.'] },
      X('fi-x-lookup-reads'), X('fi-x-costs-table'),
    ],
  });

  C.lesson({
    id: 'fi-cache', chapter: 'fi-perf', title: 'The buffer cache', minutes: 8,
    summary: 'A buffer cache keeps recently used blocks in memory: a hit costs no disk read. Write-through sends every write to the disk at once; write-back marks the block dirty and writes it later, at eviction or at a sync, so repeated writes to one block cost one disk write, but a crash loses every dirty block. One unified cache holds a file\'s data once; two separate caches hold it twice.',
    blocks: [
      'A program updates the same block of a log file every second. Must the disk be written every second too?',
      { topic: 'fsi-cache', frame: 2, caption: 'Write-back: the second write to block 20 just changes the cached copy again; the earlier unwritten change is simply overwritten.' },
      { topic: 'fsi-cache', frame: 5, caption: 'The sync interval passes at tick 5: the 2 dirty blocks, 20 and 21, are written home.' },
      { topic: 'fsi-cache', frame: 13, caption: 'In all, 6 disk writes for 8 write calls, with a sync every 5 ticks.' },
      { predict: { q: 'The same 12 accesses with a write-through cache. How many disk writes?', options: ['6, as for write-back', '8: one for every write call', '3: only the distinct blocks written'], answer: 1, explain: 'Write-through writes each change to the disk at once. Reads still hit the cache, but no write is saved.' } },
      { topic: 'fsi-cache', input: { stream: 'w20 w20 r3 w20 w21 r4 w21 w20 r3 w22 w20 r4', capacity: 4, policy: 'write-through', sync: 0, unified: 'unified', crash: 0 }, frame: 13, caption: 'Write-through: 8 disk writes for 8 write calls.' },
      { topic: 'fsi-cache', input: { stream: 'w20 r3 w21 w3 r4 w22 w20 r5', capacity: 5, policy: 'write-back', sync: 0, unified: 'unified', crash: 7 }, frame: 8, caption: 'The price of write-back: the power fails after tick 7, and 4 dirty blocks (20, 21, 3, 22) never reach the disk.' },
      { topic: 'fsi-cache', input: { stream: 'r3 r4 r3 r4 r20 r21 r22 r23 r24 r25 r26 r3 r4', capacity: 4, policy: 'write-back', sync: 0, unified: 'unified', crash: 0 }, frame: 14, caption: 'A big scan pushes the hot metadata blocks 3 and 4 out of a least-recently-used cache: 2 hits in 13 accesses.' },
      { topic: 'fsi-cache', input: { stream: 'r20 r21 r3 r20 r22 r4 r21 r3', capacity: 4, policy: 'write-back', sync: 0, unified: 'split', crash: 0 }, frame: 9, caption: 'A page cache and a buffer cache side by side hold data blocks twice: 5 cached twice, and only 1 hit. One unified cache avoids the waste.' },
      fsLab('A cache in the File-system lab', 'A write-back cache of 16 blocks: one file synced, one not, then the power cut. See which survives.', { mode: 'disk', src: 'create /a\nwrite /a 0 saved by sync\nsync\ncreate /b\nwrite /b 0 never synced', cache: 'write-back', cacheBlocks: 16, crash: true, cutAfter: 0, walk: false }),
      { h: 'Recap' },
      { list: ['A hit costs no disk read; least recently used blocks are evicted first.', 'Write-back absorbs repeated writes, but a crash loses dirty blocks; a periodic sync bounds the loss.', 'Write-through saves reads, never writes.', 'One unified cache holds each block once.'] },
      X('fi-x-cache-table'), X('fi-x-cache-crash'), X('fi-x-code-lru'),
    ],
  });

  C.lesson({
    id: 'fi-ffs', chapter: 'fi-perf', title: 'Cylinder groups', minutes: 6,
    summary: 'A disk head that jumps between an inode at the start of the disk and its data at the end wastes time on every file. The fast file system splits the disk into cylinder groups, each with its own bitmaps, inodes and data: a new directory goes to a group with many free inodes, a file\'s inode to its directory\'s group, and its blocks near its inode. A large file moves to another group every few blocks, so it does not fill one group alone.',
    blocks: [
      'Reading every file of one directory means reading each inode, then its data. If all inodes sit together at one end of the disk and data blocks anywhere, how far does the head travel?',
      { topic: 'fsi-ffs', frame: 0, caption: '96 blocks in 4 cylinder groups, each with its own inode bitmap, data bitmap, 4 blocks of inode table and 17 data blocks.' },
      { topic: 'fsi-ffs', frame: 1, caption: 'mkdir /a: inode 8 in group 1, the group with the most free inodes. New directories are spread over the groups.' },
      { predict: { q: 'Now /a/f0 is created. Where do its inode and data go?', options: ['The lowest free inode on the disk, data anywhere', 'Group 1, its directory\'s group: inode and data close together', 'The emptiest group'], answer: 1, explain: 'A file\'s inode goes to its directory\'s group and its data next to its inode, so files used together sit together.' } },
      { topic: 'fsi-ffs', frame: 4, caption: '/a/f0: inode 9 in group 1, its data blocks 31 and 32 right by it.' },
      { topic: 'fsi-ffs', frame: 13, caption: 'Reading every file of /b, the head travels 35 blocks with 4 groups and 125 with one, 3.6 times as far.' },
      { topic: 'fsi-ffs', input: { groups: 4, files: 1, big: 12 }, frame: 7, caption: 'A 12-block file spreads its data a chunk of 5 blocks at a time over groups 1, 2 and 3, so it does not fill its directory\'s group.' },
      fsLab('Cylinder groups in the File-system lab', 'Three groups: two directories and a file in each. Watch where the inodes and blocks land.', { mode: 'disk', src: 'mkdir /a\nmkdir /b\ncreate /a/x\nappend /a/x [600 bytes]\ncreate /b/y\nappend /b/y [600 bytes]', groups: 3, nblocks: 96, ninodes: 24, walkPath: '/b/y', walkN: 500 }),
      { h: 'Recap' },
      { list: ['Each cylinder group has its own bitmaps, inodes and data blocks.', 'New directory: a group with many free inodes; a file: its directory\'s group; its blocks: near its inode.', 'A large file moves on to other groups chunk by chunk.'] },
      X('fi-x-ffs'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
