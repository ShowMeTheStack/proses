// Part 15, file-system implementation: the exercises of chapter 3 (the order of updates and fsck, journaling, copy-on
// -write) and chapter 4 (log-structured file systems, the cleaner, flash). The crash outcomes are those the topics
// fsi-fsck and fsi-journal find on a real image (S.FS.commit, replay and fsck at every cut point); the copy-on-write
// write count comes from S.FS.cow here; the cleaner's score is the formula S.FS.lfs.clean uses.
(function (S) {
  'use strict';
  const C = S.Content, F = S.FS;
  if (!C || !F || C.exercises.has('fi-x-fsck-table')) return;

  // =========================================================================================================
  // Chapter 3: the order of updates
  // =========================================================================================================
  const OCOLS = ['inode, bitmap, data', 'data, bitmap, inode', 'bitmap, data, inode'], OROWS = ['cut after write 1', 'cut after write 2'];
  const OV = { 'inode, bitmap, data': ['used-but-free', 'stale'], 'data, bitmap, inode': ['ok', 'leak'], 'bitmap, data, inode': ['leak', 'leak'] };
  const ocells = (f) => Object.fromEntries(OROWS.flatMap((r, i) => OCOLS.map((c) => [r + '|' + c, f(c, i)])));
  const osol = ocells((c, i) => OV[c][i]);
  C.exercise({ id: 'fi-x-fsck-table', chapter: 'fi-crash', title: 'Three orders, two cut points', level: 2, kind: 'table',
    text: ['Appending a new block to a file changes three blocks: the inode (new size, new pointer), the data bitmap (the block\'s bit) and the data block (the new bytes). With no journal they are written one at a time, in one of three orders. The power fails after write 1 or after write 2. For each case write what is wrong with the disk: **ok** (consistent, the append simply lost), **leak** (a block marked used that no inode owns), **used-but-free** (a block an inode owns that the bitmap calls free), or **stale** (consistent, but the file ends in old bytes the new data never replaced).'],
    rows: OROWS, cols: OCOLS, corner: 'the power fails', cells: osol, cellKind: 'text',
    hints: ['Ask, for each case, which of the three blocks reached the disk, and whether they agree.', 'Inode first: after write 1 the inode points at a block the bitmap calls free; after write 2 both agree, but the block never got its bytes. Data first, cut after 1: only the new bytes, in a block nothing points to and nothing marks: no harm.', 'Inode first: used-but-free, then stale. Data first: ok, then leak. Bitmap first: leak, then leak. Writing the inode last means the worst a crash can do is leak a block.'],
    solution: osol, wrong: [ocells((c, i) => (c === OCOLS[0] && i === 1 ? 'ok' : OV[c][i])), ocells((c, i) => (c === OCOLS[1] && i === 0 ? 'leak' : OV[c][i]))] });

  C.exercise({ id: 'fi-x-order', chapter: 'fi-crash', title: 'Never stale', level: 1, kind: 'choice',
    text: ['With no journal, the three blocks of an append (inode, data bitmap, data block) are written one at a time. In which orders can a crash never leave the file pointing at a block whose new bytes did not arrive? Choose every one.'],
    options: ['inode, bitmap, data', 'data, bitmap, inode', 'bitmap, data, inode', 'inode, data, bitmap'],
    answer: [1, 2], whyNot: { 0: 'The inode goes first: a cut after it leaves the file pointing at a block that holds old bytes.', 3: 'The inode goes first here too.' },
    hints: ['The danger is the pointer to the block, which lives in the inode.', 'If the inode is written last, it only reaches the disk once the data is there.', 'data, bitmap, inode and bitmap, data, inode: both write the inode last. A cut can then leak a block at worst, which fsck frees.'],
    solution: [1, 2], wrong: [[1], [0, 1]] });

  // =========================================================================================================
  // Chapter 3: journaling
  // =========================================================================================================
  C.exercise({ id: 'fi-x-journal-writes', chapter: 'fi-crash', title: 'Counting a transaction\'s writes', level: 1, kind: 'number',
    text: ['An append changes three blocks: an inode-table block, the data bitmap and a data block. With data journaling, all three are logged: the journal gets a begin block, a copy of each block and a commit block; then each block is written home (the checkpoint); then one more write to the journal superblock marks the transaction done. How many block writes in all?'],
    answer: 9,
    whyNot: { '8': 'That is ordered mode: the data block is written home once, first, and is not logged. Data journaling logs it too.', '6': 'Count the checkpoint: every logged block is written a second time, at home.', '*': 'Add the log writes (the begin block, the blocks, the commit block), the checkpoint writes and the final one.' },
    hints: ['The log: the begin block, 3 block copies, the commit block.', 'The checkpoint: the same 3 blocks, home.', '5 + 3 + 1 = 9 writes, as the topic [[fsi-journal]] lists them. Ordered mode needs 8: the data once, then the begin block, 2 copies, the commit block, 2 checkpoints and the last.'],
    solution: 9, wrong: [8, 6] });

  const JCOLS = ['writeback', 'ordered', 'data'];
  const jtable = (rows, V) => (f) => Object.fromEntries(rows.flatMap((r, i) => JCOLS.map((c) => [r + '|' + c, f(c, i, V)])));
  const JA_ROWS = ['cut after write 3', 'cut after write 4', 'cut after write 5'];
  const JA = { writeback: ['old', 'stale', 'new'], ordered: ['old', 'old', 'new'], data: ['old', 'old', 'new'] };
  const jaCells = jtable(JA_ROWS, JA), jaSol = jaCells((c, i, V) => V[c][i]);
  C.exercise({ id: 'fi-x-journal-append', chapter: 'fi-crash', title: 'An append, cut three ways', level: 2, kind: 'table',
    text: ['A block is appended to /log in each journaling mode. The writes go in this order.', { list: ['writeback: 1 the begin block, 2 the inode logged, 3 the bitmap logged, 4 the commit block, 5 the data home, 6–7 checkpoint, 8 done', 'ordered: 1 the data home, 2 the begin block, 3 the inode logged, 4 the bitmap logged, 5 the commit block, 6–7 checkpoint, 8 done', 'data: 1 the begin block, 2–4 the inode, bitmap and data logged, 5 the commit block, 6–8 checkpoint, 9 done'] }, 'The power fails after the write given, and the journal is replayed. What does /log read: **old** (the version before), **new** (with the appended block), or **stale** (the new size, but old bytes in the new block)?'],
    rows: JA_ROWS, cols: JCOLS, corner: 'the power fails', cells: jaSol, cellKind: 'text',
    hints: ['Replay makes a transaction happen only if its commit block is on disk; without it, the old metadata stands.', 'The commit block is write 4 in writeback mode but write 5 in the others. In writeback mode the data goes home only after the commit block.', 'writeback: old, stale, new. ordered: old, old, new. data: old, old, new. Only writeback can commit metadata that points at data still to come.'],
    solution: jaSol, wrong: [jaCells((c, i, V) => (c === 'writeback' && i === 1 ? 'new' : V[c][i])), jaCells((c, i, V) => (c === 'ordered' && i === 1 ? 'new' : V[c][i]))] });

  const JO_ROWS = ['cut after write 1', 'cut after write 2', 'cut after write 4', 'cut after write 5'];
  const JO = { writeback: ['old', 'old', 'torn', 'new'], ordered: ['torn', 'new', 'new', 'new'], data: ['old', 'old', 'old', 'new'] };
  const joCells = jtable(JO_ROWS, JO), joSol = joCells((c, i, V) => V[c][i]);
  C.exercise({ id: 'fi-x-journal-overwrite', chapter: 'fi-crash', title: 'An overwrite across two blocks', level: 3, kind: 'table',
    text: ['A program overwrites bytes that span two existing data blocks, A and B, of /log. The size does not change, but the inode is updated (its modification time), so one metadata block is logged. The writes go in this order.', { list: ['writeback: 1 the begin block, 2 the inode logged, 3 the commit block, 4 A home, 5 B home, 6 checkpoint, 7 done', 'ordered: 1 A home, 2 B home, 3 the begin block, 4 the inode logged, 5 the commit block, 6 checkpoint, 7 done', 'data: 1 the begin block, 2 the inode logged, 3 A logged, 4 B logged, 5 the commit block, 6–8 checkpoint, 9 done'] }, 'The power fails after the write given, and the journal is replayed. What does the overwritten range read: **old**, **new**, or **torn** (one block new, the other old)?'],
    rows: JO_ROWS, cols: JCOLS, corner: 'the power fails', cells: joSol, cellKind: 'text',
    hints: ['In writeback and ordered mode A and B are written in place, outside any transaction: replay cannot undo or redo them.', 'So in those modes the range is new once both are home, torn when only one is, whatever happened to the inode. In data mode A and B go home only through replay of a committed transaction.', 'writeback: old, old, torn, new. ordered: torn, new, new, new. data: old, old, old, new. Only data journaling makes the overwrite all or nothing.'],
    solution: joSol, wrong: [joCells((c, i, V) => (c === 'ordered' && i === 0 ? 'old' : V[c][i])), joCells((c, i, V) => (c === 'data' && i === 2 ? 'new' : V[c][i])), joCells((c, i, V) => (c === 'writeback' && i === 2 ? 'old' : V[c][i]))] });

  C.exercise({ id: 'fi-x-revoke', chapter: 'fi-crash', title: 'Why revoke?', level: 3, kind: 'choice',
    text: ['An ordered journal checkpoints lazily. Transaction 1 logs directory block 30 (a new directory). Transaction 2 removes that directory and frees block 30. Transaction 3 creates a file, and its data is written in place to block 30, the free block it was given. All three commit, nothing has been checkpointed, and the power fails. Replay runs every committed transaction in order. What goes wrong without a revoke record, and what does the record do?'],
    options: ['Nothing goes wrong: replay runs in order, so the newest version wins', 'Replay copies transaction 1\'s old directory block over block 30, destroying the file\'s data; a revoke record in transaction 3 tells replay to skip earlier logged copies of block 30', 'Replay finds the directory still in use and refuses to mount', 'The file\'s data is replayed twice; the revoke record removes one copy'],
    answer: 1, whyNot: { 0: 'The newest version of block 30 is the file\'s data, written in place, not logged. Replay never sees it; it only copies logged blocks.', 2: 'Replay does not check what a block is used for: it copies logged blocks home.', 3: 'In ordered mode the data is never logged, so it is not replayed at all.' },
    hints: ['Ordered mode logs metadata only. Which copies of block 30 are in the log?', 'Only the old directory block from transaction 1. The data that now lives in block 30 was written in place.', 'Replay would copy the old directory block home over the file\'s data. A revoke record for block 30, written with transaction 3, tells replay to skip any earlier logged copy of it, as [[fsi-checkpoint]] shows both ways.'],
    solution: 1, wrong: [0, 3] });

  // =========================================================================================================
  // Chapter 3: copy-on-write
  // =========================================================================================================
  C.exercise({ id: 'fi-x-cow-crash', chapter: 'fi-crash', title: 'Before the flip', level: 1, kind: 'choice',
    text: ['A copy-on-write file system changes a file: it writes the new data block, a new inode block, a new inode map, and last a new uberblock. The power fails after the new inode map is written, before the uberblock. What happens at the next mount?'],
    options: ['fsck must repair the half-written tree', 'The journal is replayed', 'The old tree is mounted, whole; the change is simply lost', 'The new tree is mounted, since its root is on disk'],
    answer: 2, whyNot: { 0: 'Nothing reachable from the old root was overwritten: there is nothing to repair.', 1: 'A copy-on-write file system needs no journal.', 3: 'The new root is on disk, but only an uberblock can make it the root, and that write never happened.' },
    hints: ['Which block decides which tree is live?', 'The uberblock names the root. Every new block went to free space.', 'The old uberblock still names the old root, and nothing in that tree was touched: the old tree mounts whole, and the change is lost.'],
    solution: 2, wrong: [0, 3] });

  const cow = F.cow.mkfs({ bs: 128, nblocks: 40 });
  F.cow.apply(cow, 'create', ['chart']); F.cow.apply(cow, 'write', ['chart', 0, 'rocks at the point; '.repeat(15)]);
  const plan = F.cow.prepare(cow, 'write', 'chart', 120, 'SANDBAR MOVED'), nW = plan.writes.length, nData = plan.writes.filter((w) => w.kind === 'data').length;
  C.exercise({ id: 'fi-x-cow-writes', chapter: 'fi-crash', title: 'What one overwrite writes', level: 2, kind: 'number',
    text: ['A copy-on-write tree: an uberblock names an inode map (the root), which names the inode blocks, which name the data blocks; here every inode has a block of its own. A program overwrites 13 bytes of a file at offset 120, with blocks of 128 bytes, so the bytes span two data blocks. How many blocks are written, the uberblock included?'],
    answer: nW,
    whyNot: { [String(nW - 1)]: 'Count both data blocks: the overwrite spans two, and each gets a new copy.', [String(nW + 1)]: 'One inode block, one inode map and one uberblock: the path above the data is copied once, however many data blocks change.', '*': 'Every changed block gets a new copy, and so does every block on the path up to the uberblock.' },
    hints: ['Bytes 120 to 132 lie in file blocks 0 and 1.', 'Each of the ' + nData + ' data blocks is copied; then the inode block (its pointers change), the inode map, and the uberblock.', nData + ' data + 1 inode block + 1 inode map + 1 uberblock = ' + nW + ' writes, the uberblock last.'],
    solution: nW, wrong: [nW - 1, nW + 1] });

  // =========================================================================================================
  // Chapter 4: log-structured file systems
  // =========================================================================================================
  C.exercise({ id: 'fi-x-lfs-crash', chapter: 'fi-log', title: 'What roll-forward recovers', level: 1, kind: 'choice',
    text: ['A log-structured file system wrote a checkpoint, then two more partial segments (each with its summary and checksum), and was halfway through filling its write buffer when the power failed. What does the mount recover?'],
    options: ['Only what the checkpoint names', 'The checkpoint, plus the two partial segments after it; the buffered changes are lost', 'Everything, buffer included', 'Nothing: the log must be scanned from its start'],
    answer: 1, whyNot: { 0: 'Roll-forward reads past the checkpoint: partial segments with a good checksum are taken.', 2: 'The buffer was memory; it never reached the disk.', 3: 'The checkpoint region says where the inode map and the head of the log were.' },
    hints: ['The newest valid checkpoint region is loaded first.', 'Then roll-forward reads each partial segment written after it, in sequence, and keeps those whose summary checksum holds.', 'The two whole partial segments are recovered; the buffer is lost, as in the "roll-forward" example of [[fsi-lfs]].'],
    solution: 1, wrong: [0, 2] });

  const SEG = 8, SEGS = [['A', 2, 4], ['B', 4, 30], ['C', 6, 60], ['D', 1, 2]];
  const score = (live, age) => { const u = live / SEG; return Math.round(((1 - u) * age) / (1 + u) * 100) / 100; };
  const scells = Object.fromEntries(SEGS.map(([n, l, a]) => [n + '|score', score(l, a)]));
  const bestSeg = SEGS.slice().sort((x, y) => score(y[1], y[2]) - score(x[1], x[2]))[0][0];
  C.exercise({ id: 'fi-x-lfs-score', chapter: 'fi-log', title: 'Score the segments', level: 2, kind: 'table',
    text: ['Segments hold 8 blocks. The cost-benefit cleaner scores each used segment (1 − u)·age / (1 + u), where u is the fraction of its blocks still live and age the time since it was last written, and cleans the highest. Score each segment to two decimals.', { table: [['segment', 'live blocks', 'age'], ...SEGS.map(([n, l, a]) => [n, String(l), String(a)])] }],
    rows: SEGS.map((s) => s[0]), cols: ['score'], corner: 'segment', cells: scells, cellKind: 'number', tolerance: 0.01,
    why: 'Cost-benefit cleans ' + bestSeg + ' first; greedy, which only looks at u, would take D, the emptiest, though it was written moments ago and will likely empty further by itself.',
    hints: ['u = live ÷ 8: A 0.25, B 0.5, C 0.75, D 0.125.', 'B: (1 − 0.5) × 30 ÷ 1.5 = ' + score(4, 30) + '.', SEGS.map(([n, l, a]) => n + ' ' + score(l, a)).join(', ') + ': cost-benefit cleans ' + bestSeg + '.'],
    solution: scells, wrong: [Object.assign({}, scells, { 'D|score': 1.75 }), Object.assign({}, scells, { 'C|score': 15 })] });

  const UW = 0.8, WC = Math.round(2 / (1 - UW) * 100) / 100;
  C.exercise({ id: 'fi-x-lfs-writecost', chapter: 'fi-log', title: 'The price of cleaning full segments', level: 2, kind: 'number',
    text: ['To free space, a cleaner reads whole segments whose blocks are 80% live (u = 0.8), writes the live blocks back to the log, and the freed space is filled with new data. Counting every block read or written per block of new data, the write cost is 2 ÷ (1 − u). What is it here?'],
    answer: WC, tolerance: 0.01,
    whyNot: { '5': 'That is 1 ÷ (1 − u). Count both the cleaner\'s reads of whole segments and its writes of the live blocks.', '2.5': 'That is 2 ÷ u: the formula divides by the free fraction, 1 − u.', '*': 'Free fraction 1 − u = 0.2; the cost is 2 divided by it.' },
    hints: ['To clean one segment the cleaner reads it whole (1) and writes back u of it.', 'That frees 1 − u of a segment for new data, which is then written (1 − u). In all 1 + u + (1 − u) = 2 per (1 − u) of new data.', '2 ÷ (1 − 0.8) = ' + WC + ': ten blocks moved for every block of new data.'],
    solution: WC, wrong: [5, 2.5] });

  // the in-place layout's hottest block takes one write per update; the log's hottest takes 23 per 40 updates
  const LIFE = 10000, PER = 23, OVER = 40, WEAR = Math.floor((LIFE * OVER) / PER);
  C.exercise({ id: 'fi-x-flash', chapter: 'fi-log', title: 'How long until it wears out?', level: 2, kind: 'number',
    text: ['On flash each block survives ' + LIFE.toLocaleString('en') + ' erases. A file system that updates in place writes its hottest block once on every update. A log-structured one spreads its writes: in the topic [[fsi-flash]], its hottest blocks, the checkpoint regions, took ' + PER + ' writes in ' + OVER + ' updates. At that rate, after how many updates (a whole number, rounded down) does the log\'s hottest block reach ' + LIFE.toLocaleString('en') + ' erases?'],
    answer: WEAR, tolerance: 1,
    whyNot: { [String(LIFE)]: 'That is the in-place file system, one erase per update.', [String(Math.floor(LIFE * PER / OVER))]: 'The ratio is upside down: the block takes ' + PER + ' writes per ' + OVER + ' updates.', '*': 'Updates = erases allowed × updates per write.' },
    hints: ['The in-place file system lasts ' + LIFE.toLocaleString('en') + ' updates.', 'The log\'s hottest block takes ' + PER + '/' + OVER + ' of a write per update.', LIFE + ' × ' + OVER + ' ÷ ' + PER + ' ≈ ' + WEAR + ' updates, ' + (WEAR / LIFE).toFixed(1) + ' times as many. Rotating the checkpoint over more places would stretch it further.'],
    solution: WEAR, wrong: [LIFE, Math.floor(LIFE * PER / OVER)] });
})(globalThis.Proses = globalThis.Proses || {});
