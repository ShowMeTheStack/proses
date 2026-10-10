// Part 15, file-system implementation: the lessons of chapters 3 (crash consistency) and 4 (log-structured and
// flash). The chapters themselves are registered in 150-fsimpl.js. Every value a caption quotes is what the topic's
// own engines (S.FS, S.FS.cow, S.FS.lfs) say at that frame, on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('fi-fsck')) return;
  const X = (id) => ({ exercise: id });
  const fsLab = (title, text, setup) => ({ lab: 'fs', title, text, setup });

  // =========================================================================================================
  // Chapter 3: crash consistency
  // =========================================================================================================
  C.lesson({
    id: 'fi-fsck', chapter: 'fi-crash', title: 'The order of updates, and fsck', minutes: 8,
    summary: 'One operation changes several blocks, and the disk writes them one at a time. A power cut between two writes leaves part of the change on disk. fsck reads the whole disk and finds where the parts disagree: a block owned but marked free, a block marked used that nobody owns, an inode with no name, a wrong link count. Some damage it cannot see: an inode that points at a block whose new bytes never arrived. The order of the writes decides which damage a crash can cause.',
    blocks: [
      'Appending a block to a file changes three blocks: the inode (new size, new pointer), the data bitmap (the block is now used) and the data block itself. The disk writes them one after another. What if the power fails after the first?',
      { topic: 'fsi-fsck', frame: 0, caption: 'append to /diary changes 3 blocks, written in this order: inode-table block 3, the data bitmap, data block 8.' },
      { topic: 'fsi-fsck', frame: 3, caption: 'Cut after write 1: the inode points at block 8, but the bitmap still says it is free. fsck finds it: block 8 would be handed out twice.' },
      { topic: 'fsi-fsck', frame: 4, caption: 'The repair marks block 8 used. The disk is consistent again, but /diary\'s end is whatever block 8 held before: old bytes.' },
      { predict: { q: 'Write the data block first, then the bitmap, then the inode. The power fails after write 2. What does fsck find?', options: ['Nothing: the append is simply lost', 'A leak: block 8 is marked used, but no inode points to it', 'A block owned but marked free'], answer: 1, explain: 'The data and its bitmap bit reached the disk; the inode, written last, did not. fsck frees the leaked block, and the file is as it was. Data first can leak, but never shows a file old bytes.' } },
      { topic: 'fsi-fsck', input: { op: 'append', order: 'data', crash: 1 }, frame: 4, caption: 'Data first, inode last: of the cut points, only one leaves damage, a leak after write 2, which fsck repairs by freeing the block.' },
      { topic: 'fsi-fsck', input: { op: 'unlink', order: 'engine', crash: 1 }, frame: 3, caption: 'unlink, cut after the inode is freed: 3 problems at once, a bitmap bit for a free inode, a leaked block, and an entry naming a free inode.' },
      { warn: 'fsck reads every inode, bitmap and directory on the disk. On a large disk that takes a long time, every time the power fails, and it still cannot tell that a file\'s bytes are stale.' },
      fsLab('A crash in the File-system lab', 'No journal: the power cut after the first write of an append. The fsck tab shows what is found and repaired; change the write number to see the others.', { mode: 'disk', src: 'create /diary\nwrite /diary 0 fog until noon\nappend /diary [300 bytes]', crash: true, cutAfter: 1, walk: false }),
      { h: 'Recap' },
      { list: ['A multi-block change reaches the disk one block at a time; a crash can stop it anywhere.', 'fsck checks that the bitmaps, inodes and directories agree, and repairs them.', 'Data before the pointers to it: a crash can only leak a block.', 'Pointers before data: a file can show stale bytes, which fsck cannot see.'] },
      X('fi-x-fsck-table'), X('fi-x-order'),
    ],
  });

  C.lesson({
    id: 'fi-journal', chapter: 'fi-crash', title: 'Journaling', minutes: 10,
    summary: 'A journal writes a transaction\'s blocks to a log first: a begin block listing their homes, the blocks themselves, then a commit block. Only then are the blocks written home (the checkpoint). After a crash, replay copies every committed transaction home again and throws away any without its commit block. Writeback mode logs only metadata and can expose stale data; ordered mode writes data home before the commit; data mode logs everything, so even an overwrite is all or nothing.',
    blocks: [
      'fsck reads the whole disk after every crash, and still misses stale data. Could the system instead write down what it is about to do, so that after a crash it only needs to finish, or forget, the last few operations?',
      { def: 'transaction', text: 'the blocks one operation changes, written to the journal as a begin block (which homes follow), the block copies, and a commit block. A transaction whose commit block is on disk is committed: replay will make it happen.' },
      { topic: 'fsi-journal', frame: 1, caption: 'Ordered mode, append: write 1 puts the new data in place first. No metadata points at it yet.' },
      { topic: 'fsi-journal', frame: 4, caption: 'The power fails after write 3: the begin block and one logged block are in the journal, but no commit block.' },
      { topic: 'fsi-journal', frame: 5, caption: 'No commit block, no commit: replay throws transaction 3 away, the old metadata stands, and /log reads its old 512 bytes.' },
      { predict: { q: 'Writeback mode logs the metadata and commits it before the data is written home. The power fails just after the commit block. What does /log read after replay?', options: ['The old version: replay undoes it', 'The new version', 'Stale bytes: the inode now points at a block whose new data never arrived'], answer: 2, explain: 'The committed metadata is replayed: the inode grows and points at the new block. But in writeback mode the data was still to come, so the block holds whatever it held before.' } },
      { topic: 'fsi-journal', input: { mode: 'writeback', op: 'append', crash: 4 }, frame: 6, caption: 'Writeback, cut after the commit: /log is 580 bytes and reads stale bytes. fsck finds nothing wrong.' },
      { topic: 'fsi-journal', input: { mode: 'ordered', op: 'overwrite', crash: 1 }, frame: 3, caption: 'Ordered mode, an overwrite across two blocks, cut after the first data write: half old, half new. Ordered protects the metadata, not an overwrite.' },
      { topic: 'fsi-journal', input: { mode: 'data', op: 'overwrite', crash: 3 }, frame: 5, caption: 'Data journaling logs the data too: cut before the commit, the overwrite is thrown away whole, and /log reads the old version.' },
      { topic: 'fsi-journal', input: { mode: 'ordered', op: 'overwrite', crash: 1 }, frame: 4, caption: 'Every cut point for the overwrite: no journal, writeback and ordered each have one bad cut (torn); data journaling has none in 10.' },
      { h: 'Checkpoint, replay and revoke' },
      'Writing every block twice, once to the log and once home, is the cost of a journal. A system can wait: a committed transaction stays in the log, its blocks in memory, until the log needs the room. Then the oldest are checkpointed, and the journal superblock records them done.',
      { topic: 'fsi-checkpoint', frame: 2, caption: 'The circular log of 8 blocks is full when T2 arrives: T1\'s 5 blocks are checkpointed home first, and marked done.' },
      { topic: 'fsi-checkpoint', frame: 7, caption: 'At the end, a checkpoint writes the 5 blocks still waiting. 60 writes in all for 6 operations.' },
      { topic: 'fsi-checkpoint', input: { work: 'revoke', jblocks: 24, crash: 60, revoke: 'off' }, frame: 5, caption: 'Without revoke: block 30 was logged as a directory block, freed, and reused for /new\'s data. Replay copies the old directory block over the data.' },
      { topic: 'fsi-checkpoint', input: { work: 'revoke', jblocks: 24, crash: 60, revoke: 'on' }, frame: 4, caption: 'With revoke, T4\'s begin block revokes block 30, so replay skips its old copy and /new keeps its 200 bytes.' },
      fsLab('Journaling in the File-system lab', 'Ordered mode, the power cut before the commit. Change the mode and the write number: watch the begin block, the blocks, the commit block, the checkpoint, and the replay.', { mode: 'disk', src: 'create /log\nwrite /log 0 first page\nappend /log [300 bytes]', journal: 'ordered', crash: true, cutAfter: 3, walk: false }),
      { table: [['Mode', 'Logged', 'After any crash'], ['writeback', 'metadata', 'consistent; a file may show stale data'], ['ordered', 'metadata, after the data is home', 'consistent; never stale; an overwrite can be torn'], ['data', 'metadata and data', 'each operation wholly old or wholly new']], caption: 'The three journaling modes.' },
      { h: 'Recap' },
      { list: ['The begin block, the blocks, the commit block: committed once the commit block is on disk; then checkpointed home.', 'Replay copies committed transactions home and drops the rest.', 'Writeback can be stale; ordered cannot; data mode makes even overwrites atomic, at twice the data writes.', 'A revoke record stops replay copying an old block over a reused one.'] },
      X('fi-x-journal-writes'), X('fi-x-journal-append'), X('fi-x-journal-overwrite'), X('fi-x-revoke'),
    ],
  });

  C.lesson({
    id: 'fi-cow', chapter: 'fi-crash', title: 'Copy-on-write trees and checksums', minutes: 7,
    summary: 'A copy-on-write file system never overwrites a live block. A change writes new data blocks, a new inode block, a new root, and then flips one uberblock to the new root: before the flip the old tree is whole, after it the new one. Every pointer carries the checksum of the block it names, so a bit the disk flipped silently is caught on read, and a scrub finds it before anyone reads it. Old trees kept as snapshots cost nothing until their blocks change.',
    blocks: [
      'Journaling writes changes twice. Is there a way to change a file so that a crash at any moment leaves either the whole old version or the whole new one, with no log at all?',
      { topic: 'fsi-cow', frame: 1, caption: 'Write 1: the file\'s new data goes to a new block, 10, never over the old one. The live tree is untouched.' },
      { predict: { q: 'The power fails after write 3 of 4: new data, new inode block and new inode map are written, but not the uberblock. What does the next mount see?', options: ['A torn tree that needs repair', 'The old tree, whole: the uberblock still names the old root', 'The new tree: its root is on disk'], answer: 1, explain: 'Nothing reachable from the old root was touched. The new blocks were in free space, and only the uberblock flip would have made them live.' } },
      { topic: 'fsi-cow', input: { op: 'write', crash: 3, corrupt: 'none' }, frame: 4, caption: 'Cut before the flip: generation 5 is mounted from block 9, and nothing needs repairing.' },
      { topic: 'fsi-cow', frame: 4, caption: 'Write 4, the flip: uberblock 0 with generation 6 and root 12. One write makes the whole change live at once.' },
      { topic: 'fsi-cow', input: { op: 'append', crash: 0, corrupt: 'live' }, frame: 5, caption: 'One bit of block 10 flips and the disk reports nothing. Reading notes fails: block 10 no longer matches the checksum its parent holds.' },
      { topic: 'fsi-cow', input: { op: 'snapwrite', crash: 0, corrupt: 'old' }, frame: 5, caption: 'A snapshot keeps the old tree. A bit flips in block 3, which only the snapshot uses: live files read fine, and only a scrub finds the damage.' },
      fsLab('Copy-on-write in the File-system lab', 'Commands on a tree with checksums: create, write, snapshot, corrupt a block, read and scrub.', { mode: 'cow' }),
      { h: 'Recap' },
      { list: ['New blocks bottom up, then one uberblock write: the commit point.', 'A crash before the flip leaves the old tree whole; no fsck, no replay.', 'Checksums in the parents catch silent corruption; a scrub checks every block.', 'A snapshot is an old root kept alive.'] },
      X('fi-x-cow-crash'), X('fi-x-cow-writes'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: log-structured and flash
  // =========================================================================================================
  C.lesson({
    id: 'fi-lfs', chapter: 'fi-log', title: 'A log-structured file system', minutes: 8,
    summary: 'A log-structured file system buffers changes in memory and writes them all at the end of a log, in one sequential write: new data blocks, new copies of the inodes, and the pieces of the inode map that say where each inode now is. Nothing is updated in place, so the old copies become dead. A checkpoint region records where the inode map is; after a crash, the newest checkpoint is loaded and the partial segments written after it are rolled forward.',
    blocks: [
      'Small writes scattered over a disk are slow: each is a seek. What if every write, whatever file it belongs to, went to the next free place on the disk, one after another?',
      { def: 'inode map', text: 'a table from inode number to the address of that inode\'s newest copy in the log. Because inodes move every time they are written, the map is how they are found; its pieces are written to the log too.' },
      { topic: 'fsi-lfs', frame: 2, caption: 'A write to notes goes to the buffer: the changed blocks will be new copies at the end of the log, and the old copies become dead.' },
      { topic: 'fsi-lfs', frame: 5, caption: 'At the sync, partial segments go out in one sequential write each: data, then the inode and the inode-map piece; then checkpoint region 1 records the map\'s address.' },
      { topic: 'fsi-lfs', frame: 8, caption: 'Delete chart: the inode map forgets inode 3, so every block of it in the log is dead, waiting for the cleaner.' },
      { predict: { q: 'Two partial segments reach the disk after the last checkpoint, then the power fails with more data still in the buffer. What can mounting recover?', options: ['Only what the checkpoint names', 'The checkpoint, plus the whole partial segments after it (rolled forward); the buffer is lost', 'Everything, buffer included'], answer: 1, explain: 'Roll-forward reads the partial segments after the checkpoint, checks each summary\'s checksum, and takes their inodes and map pieces. The buffer was only memory.' } },
      { topic: 'fsi-lfs', input: { script: 'roll' }, frame: 7, caption: 'Roll forward: partial segments 4 and 5 are whole, so tide comes back with 384 bytes; wind\'s newest data was still in the buffer and is lost.' },
      { topic: 'fsi-lfs', input: { script: 'lost' }, frame: 4, caption: 'Nothing written after the checkpoint: draft never reached the disk and is gone.' },
      fsLab('A log in the File-system lab', 'Writes, syncs, a delete and one cleaning pass: watch the segments fill and the dead blocks appear.', { mode: 'lfs' }),
      { h: 'Recap' },
      { list: ['Every change is appended: data, inode copies, inode-map pieces.', 'The inode map finds each inode\'s newest copy; the checkpoint region finds the map.', 'Overwrites and deletes leave dead blocks behind.', 'Recovery: the newest checkpoint, then roll forward through whole partial segments.'] },
      X('fi-x-lfs-crash'),
    ],
  });

  C.lesson({
    id: 'fi-clean', chapter: 'fi-log', title: 'The cleaner, and flash', minutes: 8,
    summary: 'The log needs clean segments to write into. The cleaner reads a few used segments, copies their live blocks to the head of the log, and frees them. Greedy cleaning picks the emptiest segments; cost-benefit weighs the free space gained against the cost, (1 − u)·age / (1 + u), so cold segments get compacted once and stay compact. The write cost counts every block written or read per block of new data. Flash memory, which wears out with each erase, likes the same idea: never rewrite in place.',
    blocks: [
      'Overwrites and deletes leave dead blocks scattered through the segments. The log will soon reach the end of the disk. Which segments should be emptied, and what does that cost?',
      { def: 'utilisation u', text: 'the fraction of a segment\'s blocks still live. Cleaning it reads the whole segment and writes back u of it, to free 1 − u.' },
      { math: 'write cost ≈ 2 ÷ (1 − u)        (cleaning segments at utilisation u)\ncost-benefit score = (1 − u) · age ÷ (1 + u)' },
      { topic: 'fsi-clean', frame: 2, caption: 'Cost-benefit picks segment 8: (1 − u)·age / (1 + u) = 0.83·10 / 1.17 = 7.14, the best score, then segment 3. Their 8 live blocks are copied to the head of the log, and both are free again.' },
      { predict: { q: 'Nine in ten overwrites go to 2 hot files; the rest of the files are cold. Which cleaner pays less here?', options: ['Greedy: the emptiest segments always cost least to clean', 'Cost-benefit: it compacts the cold segments once, and leaves hot ones to empty by themselves', 'They cost the same'], answer: 1, explain: 'Greedy keeps cleaning hot segments that would have emptied soon anyway. Cost-benefit, weighting by age, packs cold data together once.' } },
      { topic: 'fsi-clean', frame: 27, caption: 'After 14 rounds, cost-benefit has a write cost of 12.155; greedy, on the same overwrites, 19.655.' },
      { topic: 'fsi-clean', input: { policy: 'greedy', skew: 'uniform', files: 20, rounds: 10, seed: 7 }, frame: 16, caption: 'With overwrites spread evenly there is no cold data to protect: greedy costs 9.1 and cost-benefit 12.683.' },
      { h: 'Why flash likes a log' },
      'Flash cannot overwrite a page in place: its erase block must be erased first, and each erase block survives only so many erases. A file system that updates one block in place wears that block out; a log moves every write to a fresh place.',
      { topic: 'fsi-flash', frame: 3, caption: 'After 40 updates: in place, block 4 has been written 40 times. The log spread 225 writes over 58 blocks; its hottest are the checkpoint regions, 23 writes.' },
      { topic: 'fsi-flash', frame: 4, caption: 'With 3,000 erases per block, the in-place layout wears out a block after about 3,000 updates and the log after about 5,217.' },
      fsLab('Cleaning in the File-system lab', 'Four files, 40 hot-and-cold overwrites, then two cleaning passes with cost-benefit. Switch the cleaner to greedy and compare the write cost.', { mode: 'lfs', lcmds: S.FsLab.toRows('create a\ncreate b\ncreate c\ncreate d\nwrite a 0 [120 bytes]\nwrite b 0 [120 bytes]\nwrite c 0 [120 bytes]\nwrite d 0 [120 bytes]\nsync\nchurn 40\nclean 2', 'cmd'), lpolicy: 'cost-benefit', lnsegs: 10 }),
      { h: 'Recap' },
      { list: ['The cleaner copies live blocks forward and frees whole segments.', 'Greedy picks the emptiest; cost-benefit weighs free space by age.', 'Write cost grows like 2 ÷ (1 − u): cleaning full segments is expensive.', 'On flash, a log spreads the erases; only the checkpoint regions stay hot.'] },
      X('fi-x-lfs-score'), X('fi-x-lfs-writecost'), X('fi-x-flash'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
