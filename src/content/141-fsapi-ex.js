// Part 14, the file-system interface: the exercises of chapter 1 (files, access methods, the open-file tables and
// fork). Every number in a text, an answer or a hint is worked out here by the engines (S.FS for the disk and the
// open-file layer, S.Kern for the C programs), never typed in. The C programs were also compiled with the system
// compiler and run: every real output is one the interpreter lists.
(function (S) {
  'use strict';
  const C = S.Content, F = S.FS;
  if (!C || !F || C.exercises.has('fa-x-touch-inode')) return;
  const solve = (x) => S.Check.kinds[x.kind].solve(x);
  const mk = (o) => F.mkfs(Object.assign({ bs: 64, nblocks: 64, ninodes: 16 }, o || {}));
  const HDR = '#include <stdio.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n\n';

  // =========================================================================================================
  // A file in three places
  // =========================================================================================================
  // which operations write the file's own inode (inode 2): from the blocks each one's transaction writes
  const T0 = mk(); F.apply(T0, 'create', ['/f']); F.apply(T0, 'write', ['/f', 0, 'hello there']);
  const fileBlock = F.inodeAt(T0.g, F.lookup(T0, '/f').ino).block;
  const TOUCH = [['stat', null], ['read', null], ['write', ['write', ['/f', 10, 'XY']]], ['chmod', ['chmod', ['/f', 0o600]]], ['rename', ['rename', ['/f', '/g']]], ['truncate', ['truncate', ['/f', 2]]]];
  const W = F.clone(T0); F.apply(W, 'write', ['/f', 10, 'XY']); const grown = F.stat(W, '/f').size, size0 = F.stat(T0, '/f').size;
  const touches = TOUCH.filter(([, op]) => op && F.prepare(F.clone(T0), op[0], ...op[1]).writes().some((w) => w.kind === 'inode' && w.block === fileBlock)).map(([n]) => n);
  C.exercise({ id: 'fa-x-touch-inode', chapter: 'fa-files', title: 'Which calls change the inode?', level: 1, kind: 'set',
    text: ['The file /f holds ' + size0 + ' bytes. Six operations could be applied to it: `stat`, `read`, `write` (two bytes at offset 10), `chmod` (to 600), `rename` (to /g) and `truncate` (to 2 bytes). Which of them change the file\'s own inode on the disk? Answer as a set of names, like {stat, read}.'],
    answer: '{' + touches.join(', ') + '}',
    hints: ['The inode holds the type, the mode, the owner, the link count, the size and the block pointers. Which operations change one of those?', 'stat and read only look at the inode. rename changes directory entries: the inode is named by its number, and the number does not change.', 'write puts its 2 bytes at offsets 10 and 11; the second lies past the end, so the file grows from ' + size0 + ' to ' + grown + ' bytes and the inode\'s size changes; chmod changes the mode bits, truncate the size and pointers: {' + touches.join(', ') + '}.'],
    solution: '{' + touches.join(', ') + '}', wrong: ['{write, chmod, rename, truncate}', '{chmod}'], whyNot: 'An operation changes the inode when it changes the size, the mode, the owner, the link count or a block pointer.' });

  // the size and the block count after each command (64-byte blocks)
  const SZ = mk(), SZOPS = [['write', ['/log', 0, 'x'.repeat(40)], 'write 40 bytes at offset 0'], ['append', ['/log', 'y'.repeat(40)], 'append 40 bytes'], ['append', ['/log', 'z'.repeat(40)], 'append 40 bytes'], ['append', ['/log', 'w'.repeat(40)], 'append 40 bytes'], ['truncate', ['/log', 70], 'truncate to 70 bytes'], ['append', ['/log', 'v'.repeat(100)], 'append 100 bytes']];
  F.apply(SZ, 'create', ['/log']);
  const szRows = SZOPS.map(([op, a, label], i) => { F.apply(SZ, op, a); const st = F.stat(SZ, '/log'); return { label: (i + 1) + '. ' + label, size: st.size, blocks: st.dataBlocks.length }; });
  const szCells = Object.fromEntries(szRows.flatMap((r) => [[r.label + '|size', r.size], [r.label + '|blocks', r.blocks]]));
  C.exercise({ id: 'fa-x-size-table', chapter: 'fa-files', title: 'Size against blocks', level: 2, kind: 'table',
    text: ['Blocks are 64 bytes. An empty file /log is changed by the six commands below, in order. After each one, what are the size in the inode and the number of data blocks the file owns?'],
    rows: szRows.map((r) => r.label), cols: ['size', 'blocks'], corner: 'after', cells: szCells,
    hints: ['The size is the offset just past the last byte. The number of blocks is the size divided by 64, rounded up, as long as there is no hole.', 'After 160 bytes the file needs ⌈160 ÷ 64⌉ = 3 blocks. Truncating to 70 frees every block past the one holding byte 69.', szRows.map((r) => r.label.replace(/^\d+\. /, '') + ': ' + r.size + ' bytes, ' + r.blocks + (r.blocks === 1 ? ' block' : ' blocks')).join('; ') + '.'],
    solution: szCells, wrong: [Object.assign({}, szCells, { [szRows[4].label + '|blocks']: szRows[3].blocks }), Object.assign({}, szCells, { [szRows[5].label + '|size']: 260 })] });

  // a hole: bytes written at 0 and at 200
  const HO = mk(); F.apply(HO, 'create', ['/s']); F.apply(HO, 'write', ['/s', 0, 'start']); F.apply(HO, 'write', ['/s', 200, 'end']);
  const hoSt = F.stat(HO, '/s'), hoN = hoSt.dataBlocks.length;
  C.exercise({ id: 'fa-x-hole', chapter: 'fa-files', title: 'A file with a hole', level: 2, kind: 'number',
    text: ['Blocks are 64 bytes. A new file gets 5 bytes written at offset 0, then 3 bytes written at offset 200, and nothing else. Its size is ' + hoSt.size + ' bytes. How many data blocks does it own?'],
    answer: hoN, whyNot: { [String(Math.ceil(hoSt.size / 64))]: 'That is ⌈' + hoSt.size + ' ÷ 64⌉, the blocks a file of that size would need with no hole. Bytes that were never written own no block.', '*': 'Count only the file blocks that hold a byte that was written.' },
    hints: ['Find the file block of each write: offset ÷ 64.', 'The first write is in file block 0, the second in file block ⌊200 ÷ 64⌋ = 3. Blocks 1 and 2 were never written: they are a hole and read as zeros.', 'Two data blocks, file blocks 0 and 3, although the size is ' + hoSt.size + '.'],
    solution: hoN, wrong: [Math.ceil(hoSt.size / 64), 1] });

  // =========================================================================================================
  // Sequential and direct access
  // =========================================================================================================
  // linked allocation, 60-byte records (a 64-byte block less its 4-byte next pointer), interleaved with another file
  const LK = mk({ alloc: 'linked' }); F.apply(LK, 'create', ['/d']); F.apply(LK, 'create', ['/o']);
  for (let k = 0; k < 8; k++) { F.apply(LK, 'append', ['/d', ('r' + k).padEnd(60, '.')]); F.apply(LK, 'append', ['/o', 'o'.repeat(60)]); }
  const lkIno = F.lookup(LK, '/d').ino, ORDER = [5, 1, 6, 2, 7, 0, 3, 4];
  const lkWalk = (k) => F.walk(LK, lkIno, k * 60).reads.length - 1; // the chain's blocks read to reach record k (the inode once, apart)
  const lkTotal = 1 + ORDER.reduce((s, k) => s + lkWalk(k), 0), lkSeq = 1 + 8;
  C.exercise({ id: 'fa-x-linked-reads', chapter: 'fa-files', title: 'Out of order on a chain', level: 3, kind: 'number',
    text: ['A file of 8 records is stored with linked allocation, one record a block: each block ends with the number of the next, so the inode knows only the first. A program reads every record once, in the order ' + ORDER.join(', ') + ', using lseek before each read. The inode is read once and then kept in memory; no data block is kept. How many disk reads does it take in all?', 'Reading the records in order would take ' + lkSeq + ': the inode and each block once.'],
    answer: lkTotal, whyNot: { [String(lkSeq)]: 'That is the cost in order. Out of order, each record means walking the chain again from its first block.', '*': 'Reaching record k means reading blocks 0 to k of the chain.' },
    hints: ['The only way to find block k of a chain is to read blocks 0, 1, …, k − 1 first, to learn each next pointer. So record k costs k + 1 reads.', 'Record 5 costs 6 reads, record 1 costs 2, record 6 costs 7, and so on; add 1 for the inode.', '1 + ' + ORDER.map((k) => lkWalk(k)).join(' + ') + ' = ' + lkTotal + ' reads.'],
    solution: lkTotal, wrong: [lkSeq, lkTotal - 1] });

  C.exercise({ id: 'fa-x-access-which', chapter: 'fa-files', title: 'Where direct access hurts', level: 1, kind: 'choice',
    text: ['A database reads records of a big file in a random order, using lseek before each read. Under which allocation method does each read cost the most disk reads?'],
    options: ['Contiguous: the blocks are in one run', 'Linked: each block names the next one', 'Indexed: the inode and its indirect blocks hold the block numbers', 'FAT: the chain is kept in a table in memory'],
    answer: 1, whyNot: { 0: 'With contiguous allocation block k is at start + k: one read, found by an addition.', 2: 'An indexed inode maps any block through at most a few pointer blocks, which a cache keeps.', 3: 'A FAT holds the same chain as linked allocation, but in memory: following it costs no disk reads.' },
    hints: ['Ask how the system finds block k of the file under each method.', 'Under one method the only record of block k\'s number is inside block k − 1.', 'Linked allocation: reaching block k reads the k blocks before it.'],
    solution: 1, wrong: [0, 2] });

  const TAIL = HDR + 'int main(void) {\n    char buf[9];\n    int fd = open("data.txt", O_RDONLY);\n    lseek(fd, -8, SEEK_END);\n    int n = read(fd, buf, 8);\n    buf[n] = 0;\n    printf("%s\\n", buf);\n    close(fd);\n    return 0;\n}\n';
  C.exercise({ id: 'fa-x-code-tail', chapter: 'fa-files', title: 'The last eight bytes', level: 2, kind: 'code',
    text: ['Finish the program so it prints the last 8 bytes of `data.txt`, then a newline, without reading the rest of the file. Use `lseek` with `SEEK_END` to place the offset 8 bytes before the end. The tests run it on two different files.'],
    starter: HDR + 'int main(void) {\n    char buf[9];\n    int fd = open("data.txt", O_RDONLY);\n    /* move the offset, then read 8 bytes into buf */\n\n    printf("%s\\n", buf);\n    close(fd);\n    return 0;\n}\n',
    tests: [{ name: 'tide tables', files: { 'data.txt': 'tide tables for march' }, stdout: 'or march\n' }, { name: 'harbour log', files: { 'data.txt': 'harbour log: fog at six' }, stdout: 'g at six\n' }],
    hints: ['`lseek(fd, off, SEEK_END)` sets the offset to the file\'s size plus off; off may be negative.', 'Seek to −8 from the end, then `read(fd, buf, 8)` and end the string with `buf[n] = 0`.', '`lseek(fd, -8, SEEK_END); int n = read(fd, buf, 8); buf[n] = 0;`'],
    solution: TAIL,
    wrong: [TAIL.replace('lseek(fd, -8, SEEK_END);', 'lseek(fd, 8, SEEK_SET);'), TAIL.replace('lseek(fd, -8, SEEK_END);', 'lseek(fd, -8, SEEK_CUR);')] });

  // =========================================================================================================
  // The three tables
  // =========================================================================================================
  /** run a script of [pid, call, ...args] on a fresh system with /notes; the result of each call and the offsets */
  function tables(text, script) {
    const img = mk(); F.apply(img, 'create', ['/notes']); F.apply(img, 'write', ['/notes', 0, text]);
    const sys = new F.Sys(img), out = [];
    for (const [pid, call, ...a] of script) {
      let r; try { r = sys[call](pid, ...a).result; } catch (e) { r = e.code; }
      const snap = sys.snapshot(), p = snap.procs.find((q) => q.pid === 1);
      const off = {}; for (const d of p.fds) { const f = snap.files.find((x) => x.id === d.file); if (f) off[d.fd] = f.offset; }
      out.push({ r, off, files: snap.files.length });
    }
    return { out, text: F.text(F.read(img, '/notes')) };
  }
  const OT = 'tea at four, then the ferry';
  const OS = [[1, 'open', '/notes', 'rw'], [1, 'read', 0, 4], [1, 'dup', 0], [1, 'open', '/notes', 'r'], [1, 'read', 2, 6], [1, 'write', 1, 'NOON'], [1, 'read', 0, 3], [1, 'lseek', 2, 0, 'set']];
  const OL = ['open("/notes", O_RDWR)', 'read(0, buf, 4)', 'dup(0)', 'open("/notes", O_RDONLY)', 'read(2, buf, 6)', 'write(1, "NOON", 4)', 'read(0, buf, 3)', 'lseek(2, 0, SEEK_SET)'];
  const OR = tables(OT, OS).out, ocols = ['fd 0', 'fd 1', 'fd 2'];
  const oCells = {}; OR.forEach((r, i) => { for (const fd of [0, 1, 2]) if (r.off[fd] !== undefined) oCells[(i + 1) + '. ' + OL[i] + '|fd ' + fd] = r.off[fd]; });
  C.exercise({ id: 'fa-x-offsets-table', chapter: 'fa-files', title: 'Follow the offsets', level: 2, kind: 'table',
    text: ['/notes holds the ' + OT.length + ' bytes “' + OT + '”, and process 1 has no descriptors open. It makes the calls below, in order. After each call, what offset does each open descriptor see (the offset of the open-file entry it points to)? Only the descriptors open at that moment have a cell.'],
    rows: OL.map((l, i) => (i + 1) + '. ' + l), cols: ocols, corner: 'after', cells: oCells,
    hints: ['open returns the lowest free descriptor and makes a new open-file entry at offset 0. dup returns a new descriptor for the same entry.', 'Descriptors 0 and 1 share one entry (dup); descriptor 2 has its own (the second open). Each read or write moves its entry\'s offset by the bytes it moves.', OR.map((r, i) => (i + 1) + ': ' + Object.entries(r.off).map(([fd, v]) => 'fd ' + fd + ' at ' + v).join(', ')).join('; ') + '.'],
    solution: oCells, wrong: [Object.assign({}, oCells, { [6 + '. ' + OL[5] + '|fd 0']: 4 }), Object.assign({}, oCells, { [3 + '. ' + OL[2] + '|fd 1']: 0 })] });

  const RB = tables(OT, OS.concat([[1, 'read', 2, 10]])), rbGot = RB.out[RB.out.length - 1].r;
  C.exercise({ id: 'fa-x-read-back', chapter: 'fa-files', title: 'What does the last read get?', level: 2, kind: 'string',
    text: ['The same eight calls as in the table before: on “' + OT + '”, ' + OL.join('; ') + '. Then a ninth call, `read(2, buf, 10)`. Which 10 bytes does it return? Type them exactly, spaces included.'],
    answer: rbGot, spaces: true,
    hints: ['Descriptor 2 is the second open, at offset 0 again after the lseek.', 'The file changed on the way: the write of NOON went through descriptor 1, whose shared entry was at offset ' + OR[4].off[1] + ' then.', 'The file now starts “' + RB.text.slice(0, 14) + '…”, so the read gets “' + rbGot + '”.'],
    solution: rbGot, wrong: [OT.slice(0, 10), RB.text.slice(6, 16)], whyNot: 'There is one copy of the file, and every write changes it for every descriptor.' });

  C.exercise({ id: 'fa-x-dup-or-open', chapter: 'fa-files', title: 'dup or a second open?', level: 1, kind: 'choice',
    text: ['A program has a file open on descriptor 3. It wants a second descriptor whose writes always go just after whatever the first one wrote. Which call gives it that descriptor?'],
    options: ['`dup(3)`', '`open` of the same path again', 'Either: both share the offset', 'Neither: offsets are per descriptor'],
    answer: 0, whyNot: { 1: 'A second open makes a second open-file entry with its own offset, starting at 0: its writes land on top of the first\'s.', 2: 'Only dup shares the entry; a new open never does.', 3: 'The offset belongs to the open-file entry, not to the descriptor: descriptors that share an entry share it.' },
    hints: ['Where is the offset kept: in the descriptor, in the open-file entry, or in the inode?', 'It is in the open-file entry. dup makes a descriptor for the same entry; open makes a new entry.', '`dup(3)`: both descriptors point to one entry, so one offset.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // fork and the shared offset
  // =========================================================================================================
  const FW = (() => {
    const img = mk(); F.apply(img, 'create', ['/out']);
    const sys = new F.Sys(img); sys.fork(1, 2);
    sys.open(1, '/out', 'w'); sys.open(2, '/out', 'w');
    sys.write(2, 0, 'tide'); sys.write(1, 0, 'HARBOUR'); sys.write(2, 0, 'map');
    return F.text(F.read(img, '/out'));
  })();
  C.exercise({ id: 'fa-x-fork-overwrite', chapter: 'fa-files', title: 'Opened after fork', level: 2, kind: 'string',
    text: ['An empty file /out. Process 1 forks process 2. Then each opens /out for writing (no O_APPEND, no O_TRUNC) on its own. They write in this order: process 2 writes `tide`, process 1 writes `HARBOUR`, process 2 writes `map`. What does /out hold at the end?'],
    answer: FW,
    hints: ['Each open made its own open-file entry, so each process has its own offset, starting at 0.', 'Process 2 writes tide at 0 (its offset is now 4). Process 1 writes HARBOUR at its own offset 0, over tide.', 'Process 2 writes map at its offset 4, over OUR: /out holds ' + FW + '.'],
    solution: FW, wrong: ['tideHARBOURmap', 'HARBOURmap'], whyNot: 'Two opens make two entries: follow each process\'s own offset.' });

  const SRC_A = HDR + 'int main(void) {\n    char buf[8];\n    int fd = open("log", O_RDWR | O_CREAT | O_TRUNC, 0644);\n    if (fork() == 0) {\n        write(fd, "ab", 2);\n        return 0;\n    }\n    write(fd, "cd", 2);\n    wait(NULL);\n    lseek(fd, 0, SEEK_SET);\n    int n = read(fd, buf, 4);\n    buf[n] = 0;\n    printf("%s\\n", buf);\n    return 0;\n}';
  const xa = { id: 'fa-x-fork-outputs', chapter: 'fa-files', title: 'Two writers, one entry', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['Write every output this program can produce, one a line.', { code: SRC_A, lang: 'c' }],
    src: SRC_A,
    hints: ['open is called before fork, so parent and child share one open-file entry, and one offset.', 'Each write starts where the other one ended, whichever runs first: nothing is overwritten, but the order can change.', 'The parent reads back after wait, from offset 0: abcd or cdab.'] };
  xa.solution = S.Check.kinds['fork-outputs'].outputs(xa);
  xa.wrong = [['abcd'], ['abcd', 'cdab', 'cd']];
  C.exercise(xa);

  const SRC_B = HDR + 'int main(void) {\n    char buf[8];\n    if (fork() == 0) {\n        int fd = open("log", O_WRONLY | O_CREAT, 0644);\n        write(fd, "ab", 2);\n        return 0;\n    }\n    int fd = open("log", O_RDWR | O_CREAT, 0644);\n    write(fd, "xyz", 3);\n    wait(NULL);\n    lseek(fd, 0, SEEK_SET);\n    int n = read(fd, buf, 7);\n    buf[n] = 0;\n    printf("%s\\n", buf);\n    return 0;\n}';
  const xb = { id: 'fa-x-fork-after-outputs', chapter: 'fa-files', title: 'Two writers, two entries', level: 3, kind: 'fork-outputs', ask: 'set',
    text: ['Now each process opens the file itself, after the fork. Write every output this program can produce, one a line.', { code: SRC_B, lang: 'c' }],
    src: SRC_B,
    hints: ['Two opens make two open-file entries: both writes start at offset 0.', 'Whichever write comes second lands on top of the first. If the child writes last, its ab covers the first two bytes of xyz.', 'xyz (the child wrote first) or abz (the parent wrote first).'] };
  xb.solution = S.Check.kinds['fork-outputs'].outputs(xb);
  xb.wrong = [['abxyz', 'xyzab'], ['xyz']];
  C.exercise(xb);

  const APP0 = HDR + 'void note(char *line, int len) {\n    int fd = open("log", O_WRONLY | O_CREAT, 0644);\n    write(fd, line, len);\n    close(fd);\n}\n\nint main(void) {\n    if (fork() == 0) {\n        note("net mended\\n", 11);\n        return 0;\n    }\n    if (fork() == 0) {\n        note("lamp lit\\n", 9);\n        return 0;\n    }\n    note("boats in\\n", 9);\n    wait(NULL);\n    wait(NULL);\n    char buf[64];\n    int fd = open("log", O_RDONLY);\n    int n = read(fd, buf, 63);\n    printf("%d bytes\\n", n);\n    return 0;\n}\n';
  const APP1 = APP0.replace('O_WRONLY | O_CREAT, 0644', 'O_WRONLY | O_CREAT | O_APPEND, 0644');
  C.exercise({ id: 'fa-x-code-append', chapter: 'fa-files', title: 'A log nobody overwrites', level: 3, kind: 'code',
    text: ['Three processes each add one line to `log` through `note`, in whatever order the scheduler picks. Then the parent counts the bytes in the file. The lines are 11, 9 and 9 bytes long, so all three should make 29 bytes, but the program as given loses lines. Fix `note` so that no line is ever lost, under any schedule. Keep each process opening the file itself.'],
    starter: APP0,
    tests: [{ name: 'every line kept', stdout: '29 bytes\n', seeds: [1, 2, 3, 4, 5] }],
    hints: ['Each call to note opens the file anew, so each write goes through its own open-file entry, at offset 0.', 'A flag to open makes every write go to the current end of the file, whatever the entry\'s offset was.', 'Open with `O_WRONLY | O_CREAT | O_APPEND`: each write moves to the end first, so the three lines follow one another.'],
    solution: APP1, wrong: [APP0, APP0.replace('O_WRONLY | O_CREAT, 0644', 'O_WRONLY | O_CREAT | O_TRUNC, 0644')] });
})(globalThis.Proses = globalThis.Proses || {});
