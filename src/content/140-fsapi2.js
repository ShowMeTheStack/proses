// Part 14, the file-system interface: the lessons of chapter 2 (directories, paths and links) and chapter 3
// (mounting and protection). The chapters are declared in 140-fsapi.js. Every value quoted here is what the topics'
// own engines (S.FS, S.Kern) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('fa-dirs')) return;
  const X = (id) => ({ exercise: id });
  const fsLab = (title, text, setup) => ({ lab: 'fs', title, text, setup });
  const pre = (id, label) => { const t = S.byId && S.byId(id); const p = t && (t.presets || []).find((q) => q.label === label); return p ? p.values : {}; };

  // =========================================================================================================
  // Chapter 2: directories and paths
  // =========================================================================================================
  C.lesson({
    id: 'fa-dirs', chapter: 'fa-names', title: 'From one directory to a graph', minutes: 7,
    summary: 'A single-level directory holds every name in one list, so two users cannot both have a file called notes. A two-level design gives each user a directory of their own. A tree lets directories hold directories to any depth, so files can be grouped. An acyclic graph adds second names (hard links) for files, so one file can sit in two directories; directories may not get a second name, so no cycle can form.',
    blocks: [
      'Ann and Bob share a machine, and both want a file called notes. Later they want to work on one shared file plan. What must the directory structure allow for each wish?',
      { topic: 'fs-dir-structures', frame: 3, caption: 'Single-level: Ann made /notes and /todo, so Bob\'s create /notes is refused with EEXIST. A name used once is used for everyone.' },
      { predict: { q: 'Three users each try to create plan, data and log in one single-level directory. How many of the nine creates are refused?', options: ['0', '3', '6', '8'], answer: 2, explain: 'The first user gets all three names. Each of the other two users then finds all three taken: 2 × 3 = 6 refusals.' } },
      { topic: 'fs-dir-structures', input: pre('fs-dir-structures', 'Three users, single-level'), frame: 10, caption: '3 names below the root and 6 commands refused.' },
      { topic: 'fs-dir-structures', input: pre('fs-dir-structures', 'Two-level: one directory a user'), frame: 7, caption: 'Two-level: /ann and /bob each hold their own notes and todo. 6 names below the root and nothing refused, but a user cannot make directories inside their own.' },
      { topic: 'fs-dir-structures', input: pre('fs-dir-structures', 'Tree: grouped by subject'), frame: 9, caption: 'A tree: /ann/work and /bob/work group files by subject. Every file has exactly one path from the root.' },
      { topic: 'fs-dir-structures', input: pre('fs-dir-structures', 'Acyclic graph: a shared file'), frame: 10, caption: 'An acyclic graph: /bob/work/shared is a second name for Ann\'s notes, inode 4. A second name for the directory /ann/work is refused with EPERM: it could make a cycle.' },
      { table: [['Structure', 'Same name for two users', 'Groups of files', 'One file in two places'], ['single-level', 'no', 'no', 'no'], ['two-level', 'yes', 'no', 'no'], ['tree', 'yes', 'yes', 'no'], ['acyclic graph', 'yes', 'yes', 'yes (hard links)']], caption: 'What each structure allows.' },
      { h: 'Recap' },
      { list: ['Single-level: one list of names for everyone.', 'Two-level: one directory for each user.', 'Tree: directories inside directories, one path to each file.', 'Acyclic graph: files may have several names; directories may not, so there is no cycle.'] },
      X('fa-x-dir-kind'), X('fa-x-dir-refused'),
    ],
  });

  C.lesson({
    id: 'fa-paths', chapter: 'fa-names', title: 'Path names, one name at a time', minutes: 7,
    summary: 'A path is looked up one name at a time. An absolute path starts at the root, inode 1, and a relative path starts at the current directory. Each name costs a read of the directory it is in, to find the next inode. . and .. are real entries: . names the directory itself and .. its parent, and at the root .. is the root again.',
    blocks: [
      'The kernel is asked to open /home/ann/notes. It knows only one inode by heart, the root\'s. How does it find inode 6?',
      { topic: 'fs-path-lookup', frame: 0, caption: 'An absolute path: the lookup starts at the root, inode 1, with 3 names to find.' },
      { topic: 'fs-path-lookup', frame: 2, caption: 'The root\'s block 11 named home as inode 2. Now inode 2\'s block 12 names ann as inode 3.' },
      { topic: 'fs-path-lookup', frame: 4, caption: '/home/ann/notes is inode 6, found with 3 directory reads: one for each name.' },
      { predict: { q: 'The current directory is /home/bob. How many directory reads does the relative path ../ann/notes need?', options: ['1', '2', '3', '4'], answer: 2, explain: 'Each name is one read of the directory it is looked up in. .. is read from /home/bob, ann from /home, and notes from /home/ann: 3 reads.' } },
      { topic: 'fs-path-lookup', input: pre('fs-path-lookup', 'Up with ..'), frame: 1, caption: 'In /home/bob, the entry .. is a real one: it names the parent, inode 2.' },
      { topic: 'fs-path-lookup', input: pre('fs-path-lookup', 'Dots everywhere'), frame: 7, caption: './../../srv/./index from /home/ann: 6 names, so 6 directory reads, to reach the file /srv/index.' },
      { topic: 'fs-path-lookup', input: pre('fs-path-lookup', '.. at the root stays put'), frame: 4, caption: 'At the root, .. names the root itself: /../../srv is just /srv.' },
      { topic: 'fs-path-lookup', input: pre('fs-path-lookup', 'A name that is not there'), frame: 4, caption: 'A missing name fails with ENOENT, but only after the directories before it have been read: 3 reads here.' },
      { tip: 'Real kernels keep a cache of recent lookups (the dentry cache), so a path used again costs no directory reads at all. The rule above is the cost of a cold lookup.' },
      { h: 'Recap' },
      { list: ['An absolute path starts at the root; a relative path at the current directory.', 'Each name costs one read of the directory it is looked up in.', '. and .. are real entries; at the root, .. leads back to the root.'] },
      X('fa-x-resolve'), X('fa-x-path-reads'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: links
  // =========================================================================================================
  C.lesson({
    id: 'fa-hard', chapter: 'fa-names', title: 'Hard links and the link count', minutes: 7,
    summary: 'A hard link is a second directory entry naming the same inode. The inode counts its names (the link count). unlink removes one name and lowers the count, and the inode and its blocks are freed only when the count reaches 0. A directory\'s count is 2 plus its number of subdirectories, because of its own . and each child\'s ... Directories may not be hard-linked.',
    blocks: [
      'You delete a report, and yet a colleague can still read it under another name. Was it ever deleted? In UNIX, deleting is really removing a name.',
      { def: 'link count', text: 'the number of directory entries that name an inode. It is kept in the inode itself.' },
      { topic: 'fs-hard-links', frame: 5, caption: 'link /docs/report /backup/report adds a second entry for inode 4. Its link count is now 2.' },
      { topic: 'fs-hard-links', frame: 6, caption: 'A third name, /docs/final: the count is 3. All three names are equal; none of them is the "real" one.' },
      { predict: { q: 'Now /docs/report and /docs/final are unlinked. Is inode 4 freed?', options: ['Yes: the original name is gone', 'No: /backup/report still names it, so the count is 1', 'Only when every name in /docs is gone'], answer: 1, explain: 'unlink lowers the count by one each time: 3, then 2, then 1. The inode and its block stay until the count reaches 0.' } },
      { topic: 'fs-hard-links', frame: 9, caption: 'After two unlinks inode 4 keeps 1 link, so its blocks stay. cat /backup/report still reads “draft one”.' },
      { topic: 'fs-hard-links', frame: 10, caption: 'Unlinking the last name brings the count to 0: inode 4 and its one block are freed.' },
      { topic: 'fs-hard-links', input: pre('fs-hard-links', 'rename is a link and an unlink'), frame: 5, caption: 'rename across directories is a link plus an unlink of the old name. The inode is untouched, so the link count stays 1.' },
      { topic: 'fs-hard-links', input: pre('fs-hard-links', 'No second name for a directory'), frame: 3, caption: 'link on a directory is refused with EPERM: a second name for a directory could make a loop in the tree.' },
      { h: 'Why a directory has 2 + k links' },
      'A new directory is named twice: by its entry in the parent, and by its own . entry. Each subdirectory adds one more name, its .. entry. So a directory with k subdirectories has a link count of 2 + k, and making a directory also adds 1 to its parent\'s count.',
      { topic: 'fs-hard-links', frame: 1, caption: 'mkdir /docs: inode 2 with . and .. in block 12, and the root gains an entry and a link, through the .. of /docs.' },
      fsLab('Links in the File-system lab', 'The Disk workbench: make a file, give it a second name, and unlink the names one by one. The link count is on the inode in the Inspect tab.', { mode: 'disk', bs: 128, src: 'mkdir /docs\nmkdir /backup\ncreate /docs/report\nwrite /docs/report 0 draft one\nlink /docs/report /backup/report\nunlink /docs/report\nread /backup/report', walk: false }),
      { h: 'Recap' },
      { list: ['A hard link is another entry naming the same inode; all names are equal.', 'The inode is freed only when its link count reaches 0.', 'A directory has 2 + k links; directories cannot be hard-linked.', 'rename moves a name: link the new one, unlink the old.'] },
      X('fa-x-nlink-table'), X('fa-x-dir-nlink'), X('fa-x-rename-what'),
    ],
  });

  C.lesson({
    id: 'fa-sym', chapter: 'fa-names', title: 'Symbolic links', minutes: 6,
    summary: 'A symbolic link is a small file of its own whose contents are a path. A lookup that meets one carries on along that path. Because it names a path and not an inode, it can point to a directory or to another file system, and it can dangle when its target is removed. A lookup that follows too many links in a row fails with ELOOP.',
    blocks: [
      'A program always reads /latest, and you want /latest to mean whichever report is newest. A hard link would point to one inode for good. What you need is a name that stores a path.',
      { topic: 'fs-symlinks', frame: 4, caption: 'symlink /docs/report /latest makes inode 4, a symbolic link whose contents are the text /docs/report.' },
      { topic: 'fs-symlinks', frame: 6, caption: 'cat /latest follows 1 symbolic link and reads “hello” from inode 3.' },
      { predict: { q: '/docs/report is now unlinked. /copy is a hard link to the same inode; /latest is the symbolic link. Which cat still works?', options: ['Both', 'Only cat /copy', 'Only cat /latest', 'Neither'], answer: 1, explain: '/copy names inode 3 directly, and inode 3 still has 1 link. /latest stores the text /docs/report, and that name no longer exists.' } },
      { topic: 'fs-symlinks', frame: 9, caption: 'cat /latest fails with ENOENT: the link dangles. cat /copy, a step before, still read “hello”.' },
      { topic: 'fs-symlinks', input: pre('fs-symlinks', 'A chain of links'), frame: 6, caption: 'Links can point to links: cat /l3 follows 3 of them to reach inode 2.' },
      { topic: 'fs-symlinks', input: pre('fs-symlinks', 'A loop'), frame: 3, caption: '/ping names /pong and /pong names /ping. The lookup gives up with ELOOP after too many links in a row.' },
      { topic: 'fs-path-lookup', input: pre('fs-path-lookup', 'Through a symbolic link'), frame: 4, caption: 'In the middle of a lookup, a symbolic link restarts the walk at its own text: here from the root again.' },
      { table: [['', 'Hard link', 'Symbolic link'], ['names', 'an inode', 'a path (text)'], ['changes the link count', 'yes', 'no'], ['can point to a directory', 'no', 'yes'], ['can cross file systems', 'no', 'yes'], ['target removed', 'the data stays', 'the link dangles']], caption: 'Hard and symbolic links side by side.' },
      { h: 'Recap' },
      { list: ['A symbolic link stores a path; the lookup follows it.', 'It does not keep its target alive and can dangle.', 'It can point to directories and across file systems.', 'Too many links in one lookup fail with ELOOP.'] },
      X('fa-x-sym-which'), X('fa-x-sym-true'), X('fa-x-loop'),
    ],
  });

  C.lesson({
    id: 'fa-noname', chapter: 'fa-names', title: 'A file with no name', minutes: 6,
    summary: 'An inode is freed only when it has no names and no open references. A program can open a file and unlink it at once: the name is gone, but the file lives on through the descriptor and is freed at the last close. This is how temporary files are made, and why deleting a large file that a process still has open does not free any space.',
    blocks: [
      'A disk is full. You delete a large log file, but the free space does not change. Why not?',
      { topic: 'fs-unlink-open', frame: 3, caption: 'The program unlinks scratch while it still has it open on descriptor 3. The name is gone, but the inode stays: it is still open.' },
      { predict: { q: 'After the unlink the program seeks back to 0 and reads 9 bytes through the same descriptor. What does read return?', options: ['-1: the file was deleted', '0: the file is empty now', '9, and the bytes temporary'], answer: 2, explain: 'The descriptor points to an open-file entry, and that entry points to the inode, not to the name. The inode and its blocks are still there.' } },
      { topic: 'fs-unlink-open', frame: 5, caption: 'read returns 9: “temporary”. No name leads to the file, but the descriptor does.' },
      { topic: 'fs-unlink-open', frame: 8, caption: 'At the close the last reference goes, so the inode and its block are freed: no file is left.' },
      { topic: 'fs-unlink-open', input: pre('fs-unlink-open', 'the child unlinks, the parent still reads'), frame: 8, caption: 'The child unlinks the file and closes its descriptor, but the parent still holds one: it reads “kept”.' },
      { tip: 'The full disk above: the space returns when the process holding the log open closes it, or exits.' },
      { h: 'Recap' },
      { list: ['An inode is freed when its link count and its open count are both 0.', 'unlink while open: no name, but the data stays until the last close.', 'This makes temporary files that vanish by themselves, even if the program crashes.'] },
      X('fa-x-unlink-outputs'), X('fa-x-freed-when'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: mounting and protection
  // =========================================================================================================
  C.lesson({
    id: 'fa-mount', chapter: 'fa-protect', title: 'Mounting a file system', minutes: 6,
    summary: 'Mounting joins the root of a second file system to a directory of the first, the mount point. A lookup that reaches the mount point carries on at the second file system\'s root, and whatever the directory held is hidden until it is unmounted. A file system with open files cannot be unmounted (EBUSY). Inode numbers mean something only inside their own device, so hard links and renames cannot cross a mount (EXDEV), while symbolic links can.',
    blocks: [
      'You plug in a USB stick. Its files appear under /mnt, but the stick has its own root directory and its own inode 1. How does /mnt/readme reach a file on another device?',
      { def: 'mount point', text: 'a directory of the mounted-on file system where another file system\'s root is attached.' },
      { topic: 'fs-mount', frame: 1, caption: 'Device 1 is mounted on /mnt. Lookups that reach /mnt continue at its root, and the old contents of /mnt are hidden.' },
      { topic: 'fs-mount', frame: 2, caption: 'stat /mnt/readme: device 1, inode 2, 14 bytes. The lookup crossed into device 1 at /mnt.' },
      { predict: { q: 'A process has /mnt/photos/beach open. What happens when /mnt is unmounted?', options: ['It is unmounted, and the open file is closed', 'The unmount fails with EBUSY', 'It is unmounted, and the descriptor keeps reading'], answer: 1, explain: 'An open file holds a reference to an inode of device 1. The kernel refuses to detach a file system that is in use.' } },
      { topic: 'fs-mount', input: pre('fs-mount', 'Busy: a file is open'), frame: 3, caption: 'umount fails with EBUSY while a file is open. After the close, the unmount goes through.' },
      { topic: 'fs-mount', input: pre('fs-mount', 'Crossing: EXDEV'), frame: 2, caption: 'A hard link from device 1 to device 0 fails with EXDEV: an inode number names a file only within its own device.' },
      { topic: 'fs-mount', input: pre('fs-mount', 'Crossing: EXDEV'), frame: 4, caption: 'rename across the mount fails with EXDEV too, so a move between file systems must copy and then delete. A symbolic link, a path, crosses with no trouble.' },
      { topic: 'fs-mount', frame: 5, caption: 'After the unmount, /mnt shows its own contents again and /mnt/readme is gone (ENOENT).' },
      fsLab('Mounting in the File-system lab', 'The Disk workbench mounts a second disk on /mnt: write a file there, try to link it across, and unmount.', { mode: 'disk', src: 'mkdir /mnt\ncreate /mnt/hidden\nmount /mnt\ncreate /mnt/new\nwrite /mnt/new 0 on the second disk\nlink /mnt/new /back\numount /mnt', walk: false }),
      { h: 'Recap' },
      { list: ['A mount attaches a file system\'s root at a directory, hiding what the directory held.', 'A busy file system cannot be unmounted (EBUSY).', 'Hard links and rename cannot cross file systems (EXDEV); symbolic links can.'] },
      X('fa-x-mount-hidden'), X('fa-x-exdev'),
    ],
  });

  C.lesson({
    id: 'fa-perm', chapter: 'fa-protect', title: 'Permission bits', minutes: 8,
    summary: 'Each inode holds nine permission bits: read, write and execute for its owner, its group and everyone else. A process uses exactly one of the three sets: the owner\'s if its uid owns the file, else the group\'s if its gid is the file\'s group, else the others\'. The check is made at open. To reach a file, every directory on its path needs the execute (search) bit. Root (uid 0) passes every check.',
    blocks: [
      'A file has mode rw-r----- and belongs to Ann and the group staff. Bob is in staff; Cy is not. Who may read it, and who may write it? And could the bits ever stop Ann herself?',
      { def: 'mode', text: 'nine bits written rwxrwxrwx, for the owner, the group and the others, often as three octal digits: rw-r----- is 640.' },
      { topic: 'fs-permissions', frame: 1, caption: 'First the directory: to look up plan, uid 11 needs search (x) on /proj. As a group member it gets r-x, which includes x.' },
      { topic: 'fs-permissions', frame: 2, caption: 'Then the file: uid 11 is not the owner but is in group 20, so only the group\'s bits r-- count. Read is granted.' },
      { topic: 'fs-permissions', input: pre('fs-permissions', 'A group member writes'), frame: 3, caption: 'The same user asking to write: the group\'s bits have no w, so open fails with EACCES.' },
      { predict: { q: 'A file has mode ---r--r-- (044). Its owner asks to read it. Granted?', options: ['Yes: the owner always may', 'Yes: everyone else may read it, so the owner may too', 'No: the owner\'s bits are used, and they are ---'], answer: 2, explain: 'Exactly one set of bits is used. The owner\'s set is chosen first, and it has no r. The group\'s and others\' bits are never looked at.' } },
      { topic: 'fs-permissions', input: pre('fs-permissions', 'The owner shut out by its own bits'), frame: 3, caption: 'The owner is refused by its own bits, although anyone else may read the file.' },
      { topic: 'fs-permissions', input: pre('fs-permissions', 'No search on the directory'), frame: 2, caption: 'A stranger with no x on /proj (mode rwxr-x---) cannot even reach plan, though the file itself is rw-r--r--.' },
      { topic: 'fs-permissions', input: pre('fs-permissions', 'Root passes'), frame: 2, caption: 'Root, uid 0, is not checked: it opens a file of mode 000 for reading and writing.' },
      { table: [['Bit', 'On a file', 'On a directory'], ['r', 'read its bytes', 'list its names'], ['w', 'change its bytes', 'add, remove or rename entries'], ['x', 'run it as a program', 'search it: use it in a path']], caption: 'What each bit allows.' },
      { tip: 'The rule of least privilege: give the owner what the owner needs, and the group and others less. Private files are often 600; a shared project directory might be 750.' },
      fsLab('Permissions in the File-system lab', 'The Disk workbench: root makes a private diary (600), then user 7 tries to read it and is refused.', { mode: 'disk', src: 'create /diary\nwrite /diary 0 private thoughts\nchmod /diary 600\nuser 7\nread /diary\ncreate /mine\nwrite /mine 0 hello\nuser 0\nread /diary', walk: false }),
      { h: 'Recap' },
      { list: ['Exactly one set of three bits applies: the owner\'s, else the group\'s, else the others\'.', 'The check is made at open; every directory on the path needs x.', 'Root bypasses the bits, so it should be used as little as possible.'] },
      X('fa-x-mode-string'), X('fa-x-perm-table'), X('fa-x-owner-bits'), X('fa-x-dir-bits'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
