// Part 14, the file-system interface: the exercises of chapter 2 (directories, paths, hard and symbolic links, a
// file with no name) and chapter 3 (mounting and permission bits). Every number and verdict in a text, an answer or
// a hint is worked out here by the engines (S.FS, S.Kern), never typed in.
(function (S) {
  'use strict';
  const C = S.Content, F = S.FS;
  if (!C || !F || C.exercises.has('fa-x-dir-kind')) return;
  const mk = (o) => F.mkfs(Object.assign({ bs: 128, nblocks: 64, ninodes: 24 }, o || {}));
  const tryOp = (img, op, args) => { try { F.apply(img, op, args); return null; } catch (e) { return e.code || 'error'; } };

  // =========================================================================================================
  // Directory structures
  // =========================================================================================================
  C.exercise({ id: 'fa-x-dir-kind', chapter: 'fa-names', title: 'Which structure?', level: 1, kind: 'choice',
    text: ['Ann and Bob each want a file called notes, Ann wants to group her files into projects, and both want one shared file plan to appear in their own directories. What is the simplest directory structure that allows all of this?'],
    options: ['Single-level', 'Two-level', 'Tree', 'Acyclic graph'],
    answer: 3, whyNot: { 0: 'One directory for everyone: the second notes would be refused with EEXIST.', 1: 'Two-level allows two files called notes, but no groups inside a user\'s directory, and no shared file.', 2: 'A tree allows groups, but every file has exactly one path: plan cannot sit in both directories.' },
    hints: ['Take the wishes one at a time: same name for two users, groups, one file in two places.', 'Two-level gives the same names; a tree gives groups; only one structure lets a file have two names.', 'An acyclic graph: a tree plus extra names (hard links) for files.'],
    solution: 3, wrong: [2, 1] });

  // single-level: four users each create the same three names
  const USERS = ['ann', 'bob', 'cy', 'dee'], FILES = ['plan', 'data', 'log'];
  const DR = mk(); let refused = 0;
  for (const u of USERS) for (const f of FILES) if (tryOp(DR, 'create', ['/' + f]) === 'EEXIST') refused++;
  C.exercise({ id: 'fa-x-dir-refused', chapter: 'fa-names', title: 'Names that clash', level: 2, kind: 'number',
    text: ['A single-level directory starts empty. ' + USERS.length + ' users, one after another, each try to create files called ' + FILES.join(', ') + '. How many of the ' + USERS.length * FILES.length + ' creates are refused?'],
    answer: refused, whyNot: { [String(FILES.length)]: 'That is one user\'s worth. Every user after the first finds all the names taken.', '*': 'The first user takes every name; count the refusals of the others.' },
    hints: ['In a single directory a name can exist only once, for everyone.', 'The first user creates all ' + FILES.length + ' names. Each later user is refused every one.', '(' + USERS.length + ' − 1) × ' + FILES.length + ' = ' + refused + ' refusals.'],
    solution: refused, wrong: [FILES.length, USERS.length * FILES.length] });

  // =========================================================================================================
  // Paths
  // =========================================================================================================
  const RES = { cwd: '/home/ann', path: '../../srv/./index' }, resW = F.normPath(RES.cwd + '/' + RES.path);
  C.exercise({ id: 'fa-x-resolve', chapter: 'fa-names', title: 'Where does the path lead?', level: 1, kind: 'string',
    text: ['The current directory is `' + RES.cwd + '`. Which absolute path does the relative path `' + RES.path + '` name? Write it with no . or .. in it.'],
    answer: resW,
    hints: ['A relative path starts at the current directory. Take its names one at a time.', '.. goes up one level each time: /home/ann, then /home, then /. A single . stays where it is.', RES.cwd + ' → /home → / → /srv → /srv → ' + resW + '.'],
    solution: resW, wrong: ['/home/srv/index', '/home/ann/srv/index'], whyNot: 'Each .. is one level up; . is the same directory.' });

  const PR = mk(); for (const d of ['/home', '/home/ann', '/home/bob', '/srv']) F.apply(PR, 'mkdir', [d]); F.apply(PR, 'create', ['/home/bob/game']);
  const PRP = '/home/bob/../ann/../bob/./game', prL = F.lookup(PR, PRP), prN = prL.steps.filter((s) => s.kind === 'lookup-dir').length;
  C.exercise({ id: 'fa-x-path-reads', chapter: 'fa-names', title: 'Counting directory reads', level: 3, kind: 'number',
    text: ['Nothing is cached. To look up `' + PRP + '`, how many directory reads does the kernel make? Count one for each directory searched for a name (reading a directory\'s inode and its entries counts as one).'],
    answer: prN, whyNot: { '3': 'That is the cost of the short path /home/bob/game. The lookup does not tidy the path first: every . and .. is a real entry, looked up in turn.', '*': 'Count the names in the path: each one is looked up in the directory before it.' },
    hints: ['A lookup takes the path one name at a time; each name costs one read of the directory it is looked up in.', 'The names are home, bob, .., ann, .., bob, . and game. . and .. are real directory entries, so they cost a read each.', prN + ' names, so ' + prN + ' directory reads, to find the same file as /home/bob/game.'],
    solution: prN, wrong: [3, prN - 2] });

  // =========================================================================================================
  // Hard links
  // =========================================================================================================
  const NL = mk(), NLOPS = [['create', ['/f']], ['link', ['/f', '/g']], ['mkdir', ['/d']], ['link', ['/g', '/d/h']], ['unlink', ['/f']], ['rename', ['/g', '/d/k']], ['unlink', ['/d/h']]];
  F.apply(NL, 'create', ['/f']); const nlIno = F.lookup(NL, '/f').ino;
  const nlCount = (img, ino) => F.readInode(img, ino).nlink;
  const nlRows = [], nlCells = {};
  NLOPS.forEach(([op, a], i) => {
    if (i) F.apply(NL, op, a);
    const label = (i + 1) + '. ' + op + ' ' + a.join(' ');
    nlRows.push(label); nlCells[label + '|the file'] = nlCount(NL, nlIno); nlCells[label + '|/'] = nlCount(NL, 1);
  });
  C.exercise({ id: 'fa-x-nlink-table', chapter: 'fa-names', title: 'Count the names', level: 2, kind: 'table',
    text: ['A fresh file system holds only the root directory, whose link count is 2 (its entry . and its own ..). The commands below run in order; the first creates a file. After each command, what is the link count of that file\'s inode, and of the root directory?'],
    rows: nlRows, cols: ['the file', '/'], corner: 'after', cells: nlCells,
    hints: ['link adds a name and unlink removes one; rename adds the new name and removes the old, so the count stays.', 'mkdir /d adds 1 to the root\'s count, because the new directory\'s .. names the root.', nlRows.map((r) => r.replace(/^\d+\. /, '') + ': ' + nlCells[r + '|the file'] + ' and ' + nlCells[r + '|/']).join('; ') + '.'],
    solution: nlCells, wrong: [Object.assign({}, nlCells, { [nlRows[5] + '|the file']: nlCells[nlRows[5] + '|the file'] + 1 }), Object.assign({}, nlCells, { [nlRows[2] + '|/']: 2, [nlRows[3] + '|/']: 2, [nlRows[4] + '|/']: 2, [nlRows[5] + '|/']: 2, [nlRows[6] + '|/']: 2 })] });

  const DN = mk(); for (const d of ['/p', '/p/a', '/p/b', '/p/c', '/p/a/x']) F.apply(DN, 'mkdir', [d]); F.apply(DN, 'create', ['/p/f']); F.apply(DN, 'create', ['/p/g']);
  const dnN = F.stat(DN, '/p').nlink;
  C.exercise({ id: 'fa-x-dir-nlink', chapter: 'fa-names', title: 'A directory\'s link count', level: 2, kind: 'number',
    text: ['These are made in a fresh file system: the directories /p, /p/a, /p/b, /p/c and /p/a/x, and the files /p/f and /p/g. What is the link count of /p?'],
    answer: dnN, whyNot: { [String(dnN + 1)]: '/p/a/x is not a child of /p: its .. names /p/a.', [String(dnN + 2)]: 'Files do not name their directory: only a subdirectory\'s .. does.', '*': 'Count the entries anywhere that name /p\'s inode.' },
    hints: ['Which directory entries name /p\'s inode? Its entry in /, its own ., and the .. of each directory directly inside it.', '/p has 3 subdirectories: a, b and c. /p/a/x\'s .. names /p/a, and the files have no .. at all.', '1 (in /) + 1 (.) + 3 (the .. of a, b and c) = ' + dnN + '.'],
    solution: dnN, wrong: [dnN + 1, 2] });

  C.exercise({ id: 'fa-x-rename-what', chapter: 'fa-names', title: 'What rename changes', level: 2, kind: 'choice',
    text: ['A 2 GB file is renamed from /data/big to /archive/big, on the same file system. What does the rename write on the disk?'],
    options: ['A new entry in /archive and the removal of the old one in /data: the inode and the data are untouched', 'A copy of every data block into blocks under /archive', 'A new inode for the file, pointing to the same blocks', 'Only the inode, whose path field changes'],
    answer: 0, whyNot: { 1: 'That is a copy, as across file systems. On one file system the blocks never move.', 2: 'The inode number stays the same: rename only moves the name.', 3: 'An inode has no path field; the name lives only in directory entries.' },
    hints: ['Where is a file\'s name kept?', 'In a directory entry, which pairs the name with an inode number. The inode knows nothing of its names.', 'An entry is added to /archive and removed from /data; the inode keeps its number and its link count.'],
    solution: 0, wrong: [1, 3] });

  // =========================================================================================================
  // Symbolic links
  // =========================================================================================================
  const SY = mk(), SYOPS = [['mkdir', ['/docs']], ['create', ['/docs/plan']], ['write', ['/docs/plan', 0, 'sail at dawn']], ['symlink', ['/docs/plan', '/today']], ['link', ['/docs/plan', '/keep']], ['symlink', ['/docs', '/d']], ['unlink', ['/docs/plan']], ['create', ['/docs/plan']]];
  for (const [op, a] of SYOPS) F.apply(SY, op, a);
  const SYREAD = ['/today', '/keep', '/d/plan', '/docs/plan'];
  const sySize = (p) => { try { return F.text(F.read(SY, p)).length; } catch (e) { return -1; } };
  const syOld = SYREAD.filter((p) => { try { return F.text(F.read(SY, p)) === 'sail at dawn'; } catch (e) { return false; } });
  const syCmd = SYOPS.map(([op, a]) => op === 'write' ? 'write ' + a[0] + ' “' + a[2] + '”' : op + ' ' + a.join(' '));
  C.exercise({ id: 'fa-x-sym-which', chapter: 'fa-names', title: 'Which names still reach it?', level: 2, kind: 'set',
    text: ['These commands run in order: ' + syCmd.map((c) => '`' + c + '`').join(', ') + '. (`symlink T L` makes the link L, holding the text T.) The last create makes a new, empty /docs/plan. Which of ' + SYREAD.join(', ') + ' now read “sail at dawn”? Answer as a set of paths.'],
    answer: '{' + syOld.join(', ') + '}',
    hints: ['A hard link names the inode; a symbolic link names a path, looked up again each time it is used.', '/keep still names the old inode. /today and /d/plan both lead to whatever /docs/plan names now, and that is the new empty file (size ' + sySize('/docs/plan') + ').', 'Only {' + syOld.join(', ') + '}.'],
    solution: '{' + syOld.join(', ') + '}', wrong: ['{/today, /keep}', '{/keep, /docs/plan}'], whyNot: 'Follow each symbolic link\'s text to the name it reaches now.' });

  C.exercise({ id: 'fa-x-sym-true', chapter: 'fa-names', title: 'True of symbolic links', level: 1, kind: 'choice',
    text: ['Which of these are true of a symbolic link, and not of a hard link? Choose all that apply.'],
    options: ['It can name a directory', 'It can name a file on another file system', 'It keeps its target from being freed', 'It can dangle, naming nothing', 'It adds 1 to its target\'s link count'],
    answer: [0, 1, 3],
    hints: ['A symbolic link holds a path as text; a hard link is a directory entry holding an inode number.', 'Text can name anything, anywhere, including something that does not exist. It is never counted by its target.', 'True: it can name a directory, it can cross file systems, and it can dangle. It neither keeps its target alive nor changes its link count.'],
    solution: [0, 1, 3], wrong: [[0, 1, 2, 3], [0, 1, 3, 4]] });

  const LP = mk(); F.apply(LP, 'symlink', ['/b', '/a']); F.apply(LP, 'symlink', ['/a', '/b']);
  const lpErr = (() => { try { F.read(LP, '/a'); return 'none'; } catch (e) { return e.code; } })();
  C.exercise({ id: 'fa-x-loop', chapter: 'fa-names', title: 'Two links in a ring', level: 2, kind: 'choice',
    text: ['`symlink /b /a` makes /a hold the text /b, then `symlink /a /b` makes /b hold the text /a. What happens when a program opens /a for reading?'],
    options: ['The lookup follows the links a limited number of times, then fails with ' + lpErr, 'The lookup goes round for ever, and the program hangs', 'The second symlink was refused, because it would make a cycle', 'It opens /a itself, the link file'],
    answer: 0, whyNot: { 1: 'The kernel counts the links followed in one lookup and gives up past a small limit.', 2: 'A symbolic link is just text: the kernel cannot know where it leads, so it never refuses one for making a cycle. Only hard links to directories are refused.', 3: 'Opening a path follows a symbolic link at its end; reading the link\'s own text needs readlink.' },
    hints: ['Can the kernel check, when a symbolic link is made, where its text leads?', 'It cannot: the target may not even exist yet. So cycles are found at lookup time.', 'Each lookup counts the symbolic links it follows; past the limit it fails with ' + lpErr + '.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // A file with no name
  // =========================================================================================================
  const SRC_U = '#include <stdio.h>\n#include <unistd.h>\n#include <fcntl.h>\n\nint main(void) {\n    char buf[8];\n    int fd = open("draft", O_RDWR | O_CREAT, 0600);\n    write(fd, "first copy", 10);\n    unlink("draft");\n    int again = open("draft", O_RDONLY);\n    printf("%d\\n", again);\n    lseek(fd, 6, SEEK_SET);\n    int n = read(fd, buf, 4);\n    buf[n] = 0;\n    printf("%s\\n", buf);\n    close(fd);\n    return 0;\n}';
  const xu = { id: 'fa-x-unlink-outputs', chapter: 'fa-names', title: 'Read after unlink', level: 2, kind: 'fork-outputs', ask: 'set',
    text: ['What does this program print? Write its output on one line, with its line breaks as spaces.', { code: SRC_U, lang: 'c' }],
    src: SRC_U,
    hints: ['After unlink, no name leads to the file, so a new open of "draft" fails.', 'The old descriptor still points to the open-file entry, which points to the inode: the bytes are still there.', 'open fails and returns -1; the read from offset 6 gets copy: "-1 copy".'] };
  xu.solution = S.Check.kinds['fork-outputs'].outputs(xu);
  xu.wrong = [['3 copy'], ['-1 first']];
  C.exercise(xu);

  C.exercise({ id: 'fa-x-freed-when', chapter: 'fa-names', title: 'When is the inode freed?', level: 1, kind: 'choice',
    text: ['A file has 2 names and is open in one process. Both names are unlinked. When are its inode and blocks freed?'],
    options: ['At the second unlink', 'When the process closes its last descriptor for it (or exits)', 'Never: fsck must find it', 'At the first unlink'],
    answer: 1, whyNot: { 0: 'The link count is 0 then, but the file is still open: the inode stays while a descriptor uses it.', 2: 'The kernel frees it itself at the last close. fsck is needed only if the system crashes first.', 3: 'After the first unlink the link count is still 1.' },
    hints: ['Two counts keep an inode alive: its names (the link count) and its open references.', 'The unlinks bring the link count to 0, but one open reference is left.', 'At the last close, when both counts are 0.'],
    solution: 1, wrong: [0, 3] });

  // =========================================================================================================
  // Mounting
  // =========================================================================================================
  C.exercise({ id: 'fa-x-mount-hidden', chapter: 'fa-protect', title: 'What the mount hides', level: 1, kind: 'choice',
    text: ['The directory /mnt holds a file old. A second file system, whose root holds readme, is mounted on /mnt. What do `ls /mnt` and `cat /mnt/old` show now?'],
    options: ['readme; cat fails with ENOENT', 'old and readme; cat prints old\'s contents', 'old; cat prints old\'s contents', 'Nothing; the mount fails because /mnt is not empty'],
    answer: 0, whyNot: { 1: 'A mount does not merge the two directories: the lookup that reaches /mnt moves to the other root.', 2: 'old is still on the disk, but no path reaches it while the mount is there.', 3: 'Mounting on a directory that is not empty is allowed; its contents are just hidden.' },
    hints: ['A lookup that reaches the mount point continues at the mounted file system\'s root.', 'So /mnt now means the second root, which holds only readme.', 'ls shows readme, and /mnt/old is not found until the unmount.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'fa-x-exdev', chapter: 'fa-protect', title: 'Across the mount', level: 2, kind: 'set',
    text: ['/mnt is the mount point of a second file system. Which of these fail with EXDEV? `link /mnt/a /b`, `rename /mnt/a /b`, `symlink /mnt/a /b` (making /b hold the text /mnt/a), `cp /mnt/a /b`. Answer as a set of command names, like {link}.'],
    answer: '{link, rename}',
    hints: ['A directory entry holds an inode number, and an inode number means something only on its own device.', 'link and rename both put an entry for the same inode in another directory. A symbolic link holds text; cp makes a new file.', '{link, rename}: a move between file systems has to copy the data and then remove the original.'],
    solution: '{link, rename}', wrong: ['{link, rename, symlink}', '{link}'], whyNot: 'Only the commands that put an existing inode\'s number into a directory on the other device fail.' });

  // =========================================================================================================
  // Permission bits
  // =========================================================================================================
  const MODE = 0o754, modeW = F.modeString ? F.modeString(MODE) : null;
  C.exercise({ id: 'fa-x-mode-string', chapter: 'fa-protect', title: 'Octal to rwx', level: 1, kind: 'string',
    text: ['Write the mode 754 (octal) as nine characters rwx, with - for a missing bit.'],
    answer: modeW,
    hints: ['Each octal digit is three bits: 4 for r, 2 for w, 1 for x. The digits are for the owner, the group and the others.', '7 = 4 + 2 + 1 is rwx; 5 = 4 + 1 is r-x; 4 is r--.', modeW + '.'],
    solution: modeW, wrong: ['rwxr-xr-x', 'r--r-xrwx'], whyNot: 'Read the digits from the left: owner, group, others.' });

  // who may do what: /proj has mode 750 owned by uid 10 group 20; /proj/plan has mode 640, same owner and group
  const DIRN = { mode: 0o750, uid: 10, gid: 20 }, FILEN = { mode: 0o640, uid: 10, gid: 20 };
  const WHO = [['ann (uid 10, gid 20)', { uid: 10, gid: 20 }], ['bob (uid 11, gid 20)', { uid: 11, gid: 20 }], ['cy (uid 12, gid 30)', { uid: 12, gid: 30 }], ['root (uid 0)', { uid: 0, gid: 0 }]];
  const ok = (cred, want) => (F.can(DIRN, cred, 1) && F.can(FILEN, cred, want) ? 'yes' : 'no');
  const pCells = Object.fromEntries(WHO.flatMap(([n, c]) => [[n + '|read', ok(c, 4)], [n + '|write', ok(c, 2)]]));
  C.exercise({ id: 'fa-x-perm-table', chapter: 'fa-protect', title: 'Who may open it?', level: 3, kind: 'table',
    text: ['The directory /proj has mode 750 and the file /proj/plan has mode 640. Both belong to uid 10 and group 20. For each process, may it open /proj/plan for reading, and for writing? Write yes or no.'],
    rows: WHO.map((w) => w[0]), cols: ['read', 'write'], corner: 'process', cells: pCells, cellKind: 'text',
    hints: ['Two checks: search (x) on /proj, then r or w on the file. For each, use exactly one set of bits: the owner\'s, else the group\'s, else the others\'.', '/proj is rwxr-x---: cy, in neither the owner nor the group, gets --- and cannot even reach the file. On the file, rw-r----- gives the group r only.', WHO.map(([n]) => n.split(' ')[0] + ': read ' + pCells[n + '|read'] + ', write ' + pCells[n + '|write']).join('; ') + '.'],
    solution: pCells, wrong: [Object.assign({}, pCells, { [WHO[1][0] + '|write']: 'yes' }), Object.assign({}, pCells, { [WHO[2][0] + '|read']: 'yes' })] });

  const own = F.can({ mode: 0o044, uid: 10, gid: 20 }, { uid: 10, gid: 20 }, 4);
  C.exercise({ id: 'fa-x-owner-bits', chapter: 'fa-protect', title: 'Shut out by its own bits', level: 2, kind: 'choice',
    text: ['A file has mode 044 (---r--r--) and belongs to uid 10, group 20. A process running as uid 10 opens it for reading. What happens?'],
    options: ['It is granted: the owner may always read', 'It is granted: the group and others may read, so anyone may', 'It is refused with EACCES: the owner\'s bits are ---'],
    answer: own ? 0 : 2, whyNot: { 0: 'The owner gets no special pass: only root does. The owner\'s own bits decide.', 1: 'Exactly one set of bits is used, and for the owner it is the owner\'s set.' },
    hints: ['Which one of the three sets applies to this process?', 'uid 10 owns the file, so only the owner\'s bits count, and the others are never looked at.', 'The owner\'s bits are ---, so read is refused (the owner may still chmod the file, since it owns it).'],
    solution: own ? 0 : 2, wrong: [0, 1] });

  C.exercise({ id: 'fa-x-dir-bits', chapter: 'fa-protect', title: 'Read but not search', level: 3, kind: 'set',
    text: ['The directory /shared has mode rwxr--r--, and the file /shared/notes inside it has mode rw-rw-rw-. Bob is neither the owner nor in the group. Which of these can he do: **list** the names in /shared, **read** /shared/notes, **create** a new file in /shared, **write** /shared/notes? Answer as a set of the words in bold, like {read, write}.'],
    answer: '{list}',
    hints: ['On a directory, r lets you read its names; x lets you use it in a path; w lets you change its entries, and also needs x.', 'Bob gets the others\' bits on /shared: r--. He has no x, so no path through /shared works for him, whatever the file\'s own bits say.', 'Only {list}. Reading or writing notes needs x on /shared; creating needs w and x.'],
    solution: '{list}', wrong: ['{list, read}', '{list, read, write}'], whyNot: 'Without x on a directory, no path through it can be used, so the file\'s own bits never come into play.' });
})(globalThis.Proses = globalThis.Proses || {});
