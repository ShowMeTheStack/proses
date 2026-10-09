// Part 14, the file-system interface: the chapters, and the lessons of chapter 1 (files and open files). The lessons
// of chapters 2 and 3 are in 140-fsapi2.js; the exercises in 141-fsapi-ex.js and 141-fsapi-ex2.js; the challenges,
// the guided tour, the course and the pages the diagram checker looks at in 142-fsapi-ch.js.
// Each lesson opens with a question, runs the topic that shows the idea at a frame chosen for the point being made,
// asks for a prediction, sums up, and leads to its exercises. Every value quoted here is what the topics' own engines
// (S.FS, S.Kern) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'fa-files')) return;

  C.chapter({ id: 'fa-files', part: 'fsapi', n: 1, title: 'Files and open files', blurb: 'A file as a name, an inode and its blocks; sequential and direct access; the descriptor, open-file and inode tables; and why fork shares an offset.' });
  C.chapter({ id: 'fa-names', part: 'fsapi', n: 2, title: 'Directories, paths and links', blurb: 'Directory structures from one flat list to an acyclic graph, path names resolved a name at a time, hard and symbolic links, and a file that lives on with no name.' });
  C.chapter({ id: 'fa-protect', part: 'fsapi', n: 3, title: 'Mounting and protection', blurb: 'Joining a second file system into the tree, what may not cross between them, and the permission bits checked on every open.' });
  const X = (id) => ({ exercise: id });
  const fsLab = (title, text, setup) => ({ lab: 'fs', title, text, setup });
  /** the values of a topic's preset, by its label */
  const pre = (id, label) => { const t = S.byId && S.byId(id); const p = t && (t.presets || []).find((q) => q.label === label); return p ? p.values : {}; };

  // =========================================================================================================
  // Chapter 1: what a file is
  // =========================================================================================================
  C.lesson({
    id: 'fa-file', chapter: 'fa-files', title: 'A file in three places', minutes: 8,
    summary: 'A file is spread over three places on the disk. Its name is an entry in a directory, which pairs the name with an inode number. Its attributes (type, permission bits, owner, link count, size, and where its blocks are) live in the inode. Its bytes live in data blocks. Each operation touches some of the three: stat reads only the inode, rename changes only directories, and write changes the blocks and the size.',
    blocks: [
      'Renaming a large file is instant, but copying it takes a long time. Both seem to "move" the file, so what does rename leave out that copy has to do? To answer that, we need to know where a file actually lives.',
      { def: 'inode', text: 'the record of one file on the disk: its type, permission bits, owner, link count, size and the numbers of the blocks holding its bytes. It is known by its number, not by a name.' },
      { def: 'directory entry', text: 'a pair (name, inode number) inside a directory. A directory is just a file whose contents are such pairs.' },
      { topic: 'fs-file-ops', frame: 1, caption: 'create /notes makes inode 2 and puts the entry notes, naming inode 2, in block 20 of the root directory. The file is empty: it has no data blocks yet.' },
      { topic: 'fs-file-ops', frame: 4, caption: 'After 57 bytes are written, stat reads only the inode: a file, mode rw-r--r--, 1 link, 57 bytes in 1 block. stat never reads a data block.' },
      { predict: { q: 'Blocks are 64 bytes and the file holds 57. Another 14 bytes are appended. How many data blocks does the file own now?', options: ['1: there is still room in the first block', '2: 71 bytes do not fit in one 64-byte block', '3: an append always starts a new block'], answer: 1, explain: 'The first block takes bytes 0 to 63, so the 14 new bytes fill it up to 64 and spill 7 bytes into a second block. The size is now 71.' } },
      { topic: 'fs-file-ops', frame: 5, caption: 'The 14 bytes land at offset 57: file blocks 0 and 1, in disk blocks 21 and 22. The size is now 71.' },
      { topic: 'fs-file-ops', frame: 9, caption: 'rename /notes /diary adds a new entry for inode 2 and removes the old one. The inode and the 1 data block left after the truncate are not touched. That is why a rename is instant.' },
      { table: [['Operation', 'Directory entry', 'Inode', 'Data blocks'], ['create', 'adds one', 'makes it', '—'], ['stat', '(looked up)', 'reads it', '—'], ['write, append', '(looked up)', 'size and pointers', 'writes them'], ['truncate', '(looked up)', 'size and pointers', 'frees the tail'], ['chmod', '(looked up)', 'the mode bits', '—'], ['rename', 'adds one, removes one', '—', '—'], ['unlink (last name)', 'removes it', 'frees it', 'frees them']], caption: 'Which of the three places each operation changes. "Looked up" means the name is read to find the inode.' },
      { h: 'Size is not the same as blocks' },
      'The size in the inode is the offset just past the last byte. It does not have to match the blocks owned. If a file is extended with truncate, or written far past its end, the gap is a hole: it reads as zeros but owns no blocks.',
      { topic: 'fs-file-ops', input: pre('fs-file-ops', 'A hole: truncate up'), frame: 4, caption: 'After truncate to 200, /sparse is 200 bytes in only 1 block. Bytes 5 to 199 are a hole.' },
      fsLab('A file in the File-system lab', 'The Disk workbench with 64-byte blocks: create, write, append, rename and truncate a file, and watch the directory block, the inode and the data blocks light up as each command changes them.', { mode: 'disk', bs: 64, nblocks: 64, ninodes: 16, src: 'create /notes\nwrite /notes 0 Dear diary, today the disk spun up and down all day long.\nappend /notes More tomorrow.\nrename /notes /diary\ntruncate /diary 20', walk: false }),
      { h: 'Recap' },
      { list: ['A name is a directory entry; the attributes are in the inode; the bytes are in data blocks.', 'stat reads only the inode; rename changes only directory entries.', 'The size is the end of the last byte: a hole has a size but no blocks.'] },
      X('fa-x-touch-inode'), X('fa-x-size-table'), X('fa-x-hole'),
    ],
  });

  C.lesson({
    id: 'fa-access', chapter: 'fa-files', title: 'Sequential and direct access', minutes: 6,
    summary: 'A program can read a file in order (sequential access) or jump to any record (direct access, using lseek). With indexed allocation both cost the same number of block reads, and only the head travel differs. With linked allocation, direct access must walk the chain from its start, so reaching record k costs about k reads.',
    blocks: [
      'A phone book can be read from A to Z, or opened at the letter you need. A file of fixed-size records works the same way, and the system call for "open it at record k" is lseek. Does it matter to the disk which way the program reads?',
      { def: 'sequential access', text: 'records are read in order. Each read starts where the last one ended, so the offset just moves forward.' },
      { def: 'direct access', text: 'any record can be read next: the program sets the offset to k times the record size with lseek, then reads.' },
      { topic: 'fs-access-methods', frame: 9, caption: '8 records of 64 bytes, one per block, with indexed allocation. Reading them in order costs 10 block reads and 24 blocks of head travel.' },
      { topic: 'fs-access-methods', frame: 18, caption: 'The same 8 records in a shuffled order: still 10 block reads, because the inode maps any block at once. The head now travels 48 blocks.' },
      { predict: { q: 'The same file is stored with linked allocation: each block ends with the number of the next one. Reading in the shuffled order, how do the reads compare with reading in order?', options: ['About the same, as with indexed allocation', 'Many more: each record out of order means walking the chain from the start', 'Fewer: the chain gives the next block for free'], answer: 1, explain: 'To reach record k, every block before it has to be read to learn where the next one is. In order that walk is the reading itself; out of order it is repeated for every record.' } },
      { topic: 'fs-access-methods', input: pre('fs-access-methods', 'Linked: direct access walks the chain'), frame: 18, caption: 'Linked allocation, shuffled order: 37 block reads and 119 blocks of travel. In order it was 9 reads.' },
      { topic: 'fs-access-methods', input: pre('fs-access-methods', 'FAT'), frame: 23, caption: 'A FAT keeps the same chain in a table that sits in memory. Out of order costs 13 reads against 11, and head travel, but no walk on the disk.' },
      { tip: 'Direct access in C: `lseek(fd, k * RECSIZE, SEEK_SET)` and then `read(fd, buf, RECSIZE)`. With `SEEK_END` the offset is counted from the end of the file, so `lseek(fd, -8, SEEK_END)` gets ready to read the last 8 bytes.' },
      { h: 'Recap' },
      { list: ['Sequential access moves the offset forward; direct access sets it with lseek.', 'With indexed or contiguous allocation every record costs about one read in any order; only the head travel changes.', 'With linked allocation, reaching record k out of order costs about k reads.'] },
      X('fa-x-linked-reads'), X('fa-x-access-which'), X('fa-x-code-tail'),
    ],
  });

  // =========================================================================================================
  // Chapter 1: the open-file tables
  // =========================================================================================================
  C.lesson({
    id: 'fa-tables', chapter: 'fa-files', title: 'Descriptors, open files and inodes', minutes: 8,
    summary: 'An open file is held in three tables. Each process has a descriptor table, whose small integers point into the system-wide open-file table. An open-file entry holds the offset and the access mode, and points to the in-memory inode, which counts how many entries use it. Every open makes a new entry with its own offset. dup (and fork) make a second descriptor for the same entry, so the two share one offset.',
    blocks: [
      'A program opens the same file twice and writes through both descriptors. Does the second write land after the first, or on top of it? It depends on which of three tables the offset lives in.',
      { def: 'file descriptor', text: 'a small integer, an index into the process\'s own descriptor table. open returns the lowest one that is free.' },
      { def: 'open-file entry', text: 'one entry in a table shared by the whole system. It holds the current offset, the access mode (read, write, append) and a count of the descriptors that point to it.' },
      { def: 'in-memory inode', text: 'one per open file, whatever the number of opens. It counts the open-file entries that use it, so the file is not freed while it is open.' },
      { topic: 'fs-open-tables', frame: 1, caption: 'open /notes for reading and writing makes open-file entry 1, at offset 0. Inode 2 now has 1 open reference, and descriptor 0, the lowest free one, points to the entry.' },
      { topic: 'fs-open-tables', frame: 3, caption: 'A second open of the same file makes a second entry, number 2, with its own offset. Inode 2 now has 2 open references; descriptor 1 points to entry 2.' },
      { topic: 'fs-open-tables', frame: 5, caption: 'dup(0) gives descriptor 2, pointing to the same entry 1 as descriptor 0. They now share one offset, which is 4.' },
      { predict: { q: 'Descriptor 2 writes XYZ at offset 4, so "the quick brown fox" becomes "the XYZck brown fox". Then lseek(0, 0, SEEK_SET) and a read of 7 bytes through descriptor 0. What comes back?', options: ['“the qui”: descriptor 0 never saw the write', '“the XYZ”: the write changed the file, and the read starts at 0', '“ck brow”: the read starts where descriptor 2 stopped'], answer: 1, explain: 'There is one copy of the file, and the write changed it. lseek put the shared offset back to 0, so the read gets the first 7 bytes as they are now.' } },
      { topic: 'fs-open-tables', frame: 8, caption: 'The read through descriptor 0 gets “the XYZ”. Offset 7 is now shared by descriptors 0 and 2.' },
      { topic: 'fs-open-tables', input: pre('fs-open-tables', 'Two opens: two offsets'), frame: 6, caption: 'Two separate opens of “abcdefghij”: XX goes to offset 0 through one entry, then YYY to offset 0 through the other, on top of it. Reading back gives “YYYdefghij”.' },
      { topic: 'fs-open-tables', input: pre('fs-open-tables', 'dup: one offset'), frame: 6, caption: 'The same writes through a descriptor and its dup: YYY follows XX, giving “XXYYYfghij”.' },
      { topic: 'fs-open-tables', input: pre('fs-open-tables', 'Append mode'), frame: 4, caption: 'An entry opened for appending moves its offset to the end of the file before every write. Here it writes cd at offset 4, past the ab written through the other entry.' },
      fsLab('The three tables in the File-system lab', 'The Tables workbench: type open, read, write, lseek, dup, fork and close for a few processes, and watch the descriptor tables, the open-file entries with their offsets, and the inode table.', { mode: 'tables', tcalls: S.FsLab.toRows('1 open /notes rw\n1 read 0 4\n1 open /notes r\n1 read 1 9\n1 dup 0\n1 write 2 XYZ\n1 lseek 0 0 set\n1 read 0 7\n1 close 0\n1 close 2', 'calls'), tfiles: [{ path: '/notes', mode: '644', text: 'the quick brown fox' }] }),
      { h: 'Recap' },
      { list: ['A descriptor indexes the process\'s table; it points to an open-file entry; that entry points to the inode.', 'Each open makes a new entry with its own offset. dup and fork share an entry, so they share its offset.', 'An entry is freed when its last descriptor closes; the inode is released when its last entry goes.', 'Append mode moves the offset to the end before each write.'] },
      X('fa-x-offsets-table'), X('fa-x-read-back'), X('fa-x-dup-or-open'),
    ],
  });

  C.lesson({
    id: 'fa-fork', chapter: 'fa-files', title: 'fork and the shared offset', minutes: 7,
    summary: 'fork copies the descriptor table, not the open-file entries. A file opened before fork is shared by parent and child through one entry, so their writes follow one another. A file opened after fork by each process has two entries and two offsets, so their writes land on top of each other, unless both open it for appending.',
    blocks: [
      'A parent and its child both write log lines to the same file. Sometimes every line arrives. Sometimes lines are overwritten. The code is the same in both cases except for one thing: whether open is called before or after fork.',
      { topic: 'fs-fork-offset', frame: 2, caption: 'The parent opened /out, then forked. The child\'s descriptor table is a copy, so its descriptor 0 points to the same open-file entry, with one offset for both.' },
      { topic: 'fs-fork-offset', frame: 5, caption: 'The child writes kid at 0, the parent PARENT at 3, the child kid again at 9: the offset is now 12, and nothing was overwritten.' },
      { predict: { q: 'Now the parent forks first, and each process opens /out for itself. The child writes kid, the parent writes PARENT, and the child writes kid again. What does /out hold?', options: ['kidPARENTkid, as before', 'PARkid: each process has its own offset, starting at 0', 'PARENTkid: the parent\'s write moves the child\'s offset'], answer: 1, explain: 'Two opens make two entries. The child writes kid at 0 (offset 3). The parent writes PARENT at its own offset 0, over kid. The child writes kid at its offset 3, over ENT.' } },
      { topic: 'fs-fork-offset', input: pre('fs-fork-offset', 'Opened after fork: overwritten'), frame: 6, caption: 'Two entries: the parent\'s PARENT went to offset 0, over the child\'s kid. The child\'s second kid goes to its own offset 3, over ENT.' },
      { topic: 'fs-fork-offset', input: pre('fs-fork-offset', 'Opened after fork, appending'), frame: 6, caption: 'Opened with O_APPEND, each entry jumps to the end of the file before each write. Two offsets, but every write lands at the end: 12 bytes, nothing lost.' },
      { h: 'The same in C' },
      { topic: 'fs-fork-c', frame: 8, caption: 'open, then fork: the child writes “child ” and the parent “parent” through one shared entry, so the file holds “child parent”.' },
      { topic: 'fs-fork-c', input: pre('fs-fork-c', 'fork, then each opens'), frame: 9, caption: 'fork, then each opens without O_APPEND: the parent writes “parent” at its own offset 0, over the child\'s “child ”. The file holds “parent”.' },
      { warn: 'O_APPEND makes each write go to the end of the file, but the offset itself is still per entry. If two programs must not lose each other\'s lines, both should open the file with O_APPEND, or share one entry.' },
      fsLab('fork in the File-system lab', 'The Tables workbench with a fork: process 2 starts with a copy of process 1\'s descriptors, sharing their entries, while a later open by process 1 makes an entry of its own.', { mode: 'tables' }),
      { h: 'Recap' },
      { list: ['fork copies descriptors, so open-file entries and their offsets are shared.', 'Opening after fork gives each process its own entry and offset, and writes overwrite.', 'O_APPEND moves each write to the end of the file, whichever entry it uses.'] },
      X('fa-x-fork-overwrite'), X('fa-x-fork-outputs'), X('fa-x-fork-after-outputs'), X('fa-x-code-append'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
