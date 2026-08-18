// The File-system lab, registered: five workbenches behind one Mode select.
//   Disk: a block file system of the student's geometry (block size, inodes, direct pointers, levels of indirection,
//     pointer size, the allocation method, cylinder groups), a journaling mode and a cache, and commands typed or
//     clicked; the blocks each command changes, the power cut after any write of the last one with fsck and replay,
//     and the walk to byte N.
//   Tables: system calls from several processes, with the descriptor, open-file and inode tables (S.FS.Sys).
//   Copy-on-write: a tree of blocks with checksums, the uberblock flip, a crash, a flipped bit and a scrub.
//   Log-structured: segments, the inode map, the checkpoint, and cleaning with its write cost.
//   Distributed: two clients and a server on a timeline, NFS-style or AFS-style, with crashes and lost messages.
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;
  const on = (m) => (v) => v.mode === m;
  const disk = on('disk');
  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));

  const NOTES = '# one command a line; [300 bytes] stands for that much text\nmkdir /notes\ncreate /notes/todo\nwrite /notes/todo 0 mend the nets; buy lamp oil\nappend /notes/todo [300 bytes]\nlink /notes/todo /urgent\nsymlink /notes/todo /short\nread /short 0 14\nunlink /notes/todo';
  const EX = [
    { name: 'notes.fs', src: NOTES },
    { name: 'grow.fs', src: 'create /log\nwrite /log 0 tide at six\nappend /log [700 bytes]\nappend /log [900 bytes]\ntruncate /log 100' },
    { name: 'tree.fs', src: 'mkdir /a\nmkdir /a/b\ncreate /a/b/c\nsymlink /a/b/c /short\nrename /a/b/c /a/c\nrmdir /a/b\nrmdir /a' },
    { name: 'errors.fs', src: 'create /x\ncreate /x\nmkdir /x/y\nunlink /nothere\nrmdir /\nmkdir /d\ncreate /d/f\nrmdir /d' },
    { name: 'users.fs', src: 'create /diary\nwrite /diary 0 private thoughts\nchmod /diary 600\nuser 7\nread /diary\ncreate /mine\nwrite /mine 0 hello\nuser 0\nread /diary' },
    { name: 'mount.fs', src: 'mkdir /mnt\ncreate /mnt/hidden\nmount /mnt\ncreate /mnt/new\nwrite /mnt/new 0 on the second disk\nlink /mnt/new /back\numount /mnt' },
  ];
  const TCALLS = '# the process, the call, its arguments; descriptors count from 0\n1 open /notes r\n1 read 0 7\n1 fork 2\n2 read 0 4\n1 open /notes rw\n1 write 1 TIDE\n2 close 0\n1 lseek 0 0 set\n1 read 0 11\n1 unlink /notes\n1 close 0\n1 close 1';
  const TEX = [
    { name: 'fork.calls', src: TCALLS },
    { name: 'dup.calls', src: '1 open /notes r\n1 dup 0\n1 read 0 8\n1 read 1 5\n1 open /notes r\n1 read 2 8\n1 close 0\n1 close 1\n1 close 2' },
    { name: 'orphan.calls', src: '1 open /notes rw\n1 unlink /notes\n1 write 0  and a line nobody can name\n1 lseek 0 0 set\n1 read 0 20\n1 close 0' },
    { name: 'perm.calls', src: '2 user 7\n2 open /notes r\n2 open /notes w\n1 open /notes w\n1 write 0 root may\n2 open /mine rwc\n2 write 0 mine' },
  ];
  const CSRC = 'create chart\nwrite chart 0 rocks at the point; a sandbar off the river mouth\ncreate notes\nappend notes buoys repainted\nsnapshot\nwrite chart 9 STORM WARNING\nread chart';
  const LSRC = 'create a\ncreate b\nwrite a 0 [300 bytes]\nwrite b 0 [200 bytes]\nsync\nwrite a 0 the first block, rewritten\nsync\ndelete b\nsync\nclean 1';
  const DSCRIPT = [{ t: 0, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 0, c: 'A', op: 'read', file: 'tides', data: '' }, { t: 1, c: 'B', op: 'open', file: 'tides', data: '' }, { t: 1, c: 'B', op: 'write', file: 'tides', data: 'high water 06:40' }, { t: 1, c: 'B', op: 'close', file: 'tides', data: '' }, { t: 6, c: 'A', op: 'read', file: 'tides', data: '' }, { t: 12, c: 'A', op: 'read', file: 'tides', data: '' }, { t: 12, c: 'A', op: 'close', file: 'tides', data: '' }];
  const fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'disk', options: opt([['disk', 'Disk: blocks, commands, crashes'], ['tables', 'Tables: descriptors and open files'], ['cow', 'Copy-on-write: a tree with checksums'], ['lfs', 'Log-structured: segments and cleaning'], ['dfs', 'Distributed: clients and a server']]) },
    { id: 'src', label: 'Commands', type: 'code', def: NOTES, examples: EX, files: 'fs-lab', minLines: 9, maxHeight: 320, show: disk },
    { id: 'bs', label: 'Block size', type: 'select', group: 'The disk', def: 256, options: [64, 128, 256, 512, 1024, 2048, 4096].map((b) => ({ value: b, label: b + ' bytes' })), show: disk },
    { id: 'nblocks', label: 'Blocks on the disk', type: 'number', def: 64, min: 16, max: 128, show: disk },
    { id: 'ninodes', label: 'Inodes', type: 'number', def: 16, min: 4, max: 64, show: disk },
    { id: 'isz', label: 'Inode size', type: 'select', def: 0, options: [{ value: 0, label: 'the smallest that fits' }].concat([32, 64, 128, 256].map((b) => ({ value: b, label: b + ' bytes' }))), show: disk },
    { id: 'alloc', label: 'Allocation', type: 'select', def: 'indexed', options: opt([['indexed', 'indexed: direct and indirect pointers'], ['contiguous', 'contiguous: one run'], ['linked', 'linked: a chain through the blocks'], ['fat', 'FAT: a chain in a table'], ['extent', 'extents: (start, length) pairs']]), show: disk },
    { id: 'ndirect', label: 'Direct pointers', type: 'number', def: 4, min: 1, max: 12, show: disk, help: 'the inode holds this many pointer slots and three more; the other methods use the same slots their own way' },
    { id: 'levels', label: 'Levels of indirection', type: 'number', def: 3, min: 0, max: 3, show: (v) => disk(v) && v.alloc === 'indexed' },
    { id: 'ps', label: 'Pointer size', type: 'select', def: 4, options: [2, 4, 8].map((b) => ({ value: b, label: b + ' bytes' })), show: disk },
    { id: 'groups', label: 'Cylinder groups', type: 'number', def: 1, min: 1, max: 4, show: (v) => disk(v) && v.alloc !== 'fat', help: 'more than one: each group has its own bitmaps, inodes and data, as in the fast file system' },
    { id: 'journal', label: 'Journaling', type: 'select', group: 'Journal and cache', def: 'none', options: opt([['none', 'none: blocks written in place'], ['writeback', 'writeback: metadata logged'], ['ordered', 'ordered: data home, then metadata logged'], ['data', 'data: everything logged']]), show: disk },
    { id: 'jblocks', label: 'Journal size', type: 'number', def: 10, min: 4, max: 32, unit: 'blocks', show: (v) => disk(v) && v.journal !== 'none' },
    { id: 'cache', label: 'Buffer cache', type: 'select', def: 'none', options: opt([['none', 'none: every block from the disk'], ['write-through', 'write-through'], ['write-back', 'write-back: dirty until sync']]), show: disk, help: 'write-back with a journal: the commit is written at once, the home copies wait for a checkpoint' },
    { id: 'cacheBlocks', label: 'Cache size', type: 'number', def: 8, min: 1, max: 64, unit: 'blocks', show: (v) => disk(v) && v.cache !== 'none' },
    { id: 'crash', label: 'Cut the power during the last command that writes', type: 'toggle', group: 'Crash', def: false, show: disk },
    { id: 'cutAfter', label: 'after its write number', type: 'number', def: 1, min: 0, max: 64, show: (v) => disk(v) && v.crash, help: '0: before any write; past the last: after all of them (memory is still lost)' },
    { id: 'walk', label: 'Walk to byte N of a file, at the end', type: 'toggle', group: 'Byte N', def: true, show: disk },
    { id: 'walkPath', label: 'File', type: 'text', def: '/urgent', pattern: '^/\\S*$', patternWhy: 'an absolute path', maxLen: 120, show: (v) => disk(v) && v.walk },
    { id: 'walkN', label: 'Byte N', type: 'number', def: 300, min: 0, max: 1e15, show: (v) => disk(v) && v.walk },
    // ---- tables
    { id: 'tcalls', label: 'System calls, in order', type: 'table', def: FL.toRows(TCALLS, 'calls'), minRows: 1, maxRows: 16, show: on('tables'), help: 'P: the process. Descriptors count from 0. open: a path, then flags r, w, rw or a with c (create) and t (truncate); read: fd, then a count; write: fd, then text; lseek: fd, then an offset and set, cur or end; fork: the child; user: a uid',
      columns: [{ id: 'p', label: 'P', type: 'int', min: 1, max: 9, width: '40px' }, { id: 'call', label: 'Call', type: 'select', options: ['open', 'read', 'write', 'lseek', 'dup', 'fork', 'close', 'unlink', 'user'].map((c) => ({ value: c, label: c })), width: '80px' }, { id: 'a', label: 'Path, fd', type: 'text', required: false, maxLen: 30, width: '76px' }, { id: 'b', label: 'Then', type: 'text', required: false, maxLen: 40 }],
      newRow: (i, rows) => ({ p: rows.length ? rows[rows.length - 1].p : 1, call: 'read', a: '0', b: '4' }) },
    { id: 'tfiles', label: 'Files at the start', type: 'table', group: 'Files', def: [{ path: '/notes', mode: '644', text: 'harbour log: fog at six' }], minRows: 0, maxRows: 3, show: on('tables'),
      columns: [{ id: 'path', label: 'Path', type: 'text', pattern: '^/[A-Za-z0-9._-]{1,27}$', patternWhy: 'a name in /, like /notes', width: '90px' }, { id: 'mode', label: 'Mode', type: 'text', pattern: '^[0-7]{3}$', patternWhy: 'three octal digits, like 644', width: '52px' }, { id: 'text', label: 'Contents', type: 'text', maxLen: 40, required: false }],
      newRow: (i) => ({ path: '/file' + (i + 1), mode: '644', text: 'some text' }), check: (r, i, rows) => (rows.findIndex((x) => x.path === r.path) !== i ? { path: 'two files are called ' + r.path } : null) },
    // ---- copy-on-write
    { id: 'ccmds', label: 'Commands, in order', type: 'table', def: FL.toRows(CSRC, 'cmd'), minRows: 1, maxRows: 16, show: on('cow'), help: 'Name: the file, or a number (drop takes a generation, corrupt a block). Then: write takes an offset and the text, append the text, rename the new name; text may be a size like [150 bytes]',
      columns: [{ id: 'op', label: 'Command', type: 'select', options: ['create', 'write', 'append', 'delete', 'rename', 'snapshot', 'drop', 'read', 'corrupt', 'scrub'].map((c) => ({ value: c, label: c })), width: '80px' }, { id: 'name', label: 'Name', type: 'text', required: false, maxLen: 27, width: '68px' }, { id: 'arg', label: 'Then', type: 'text', required: false, maxLen: 60 }],
      newRow: () => ({ op: 'read', name: 'chart', arg: '' }) },
    { id: 'cbs', label: 'Block size', type: 'select', group: 'The disk', def: 128, options: [64, 128, 256].map((b) => ({ value: b, label: b + ' bytes' })), show: on('cow') },
    { id: 'cblocks', label: 'Blocks', type: 'number', def: 40, min: 16, max: 96, show: on('cow') },
    { id: 'ccrash', label: 'Cut the power during the last command that writes', type: 'toggle', group: 'Crash', def: false, show: on('cow') },
    { id: 'ccut', label: 'after its write number', type: 'number', def: 2, min: 0, max: 40, show: (v) => v.mode === 'cow' && v.ccrash },
    // ---- log-structured
    { id: 'lcmds', label: 'Commands, in order', type: 'table', def: FL.toRows(LSRC, 'cmd'), minRows: 1, maxRows: 20, show: on('lfs'), help: 'Name: the file, or a number (clean takes how many segments, churn how many seeded overwrites). Then: write takes an offset and the text, append the text; text may be a size like [300 bytes]',
      columns: [{ id: 'op', label: 'Command', type: 'select', options: ['create', 'write', 'append', 'delete', 'read', 'sync', 'clean', 'churn', 'crash', 'mount'].map((c) => ({ value: c, label: c })), width: '80px' }, { id: 'name', label: 'Name', type: 'text', required: false, maxLen: 27, width: '68px' }, { id: 'arg', label: 'Then', type: 'text', required: false, maxLen: 60 }],
      newRow: () => ({ op: 'sync', name: '', arg: '' }) },
    { id: 'lbs', label: 'Block size', type: 'select', group: 'The log', def: 128, options: [64, 128, 256].map((b) => ({ value: b, label: b + ' bytes' })), show: on('lfs') },
    { id: 'lseg', label: 'Blocks a segment', type: 'number', def: 8, min: 4, max: 16, show: on('lfs') },
    { id: 'lnsegs', label: 'Segments', type: 'number', def: 8, min: 4, max: 16, show: on('lfs') },
    { id: 'lninodes', label: 'Inodes', type: 'number', def: 32, min: 8, max: 64, show: on('lfs') },
    { id: 'lpolicy', label: 'Cleaner picks', type: 'select', group: 'The cleaner', def: 'cost-benefit', options: opt([['greedy', 'greedy: the emptiest segment'], ['cost-benefit', 'cost-benefit: (1 − u)·age / (1 + u)']]), show: on('lfs') },
    { id: 'lauto', label: 'Clean by itself when fewer than 3 segments are clean', type: 'toggle', def: true, show: on('lfs') },
    { id: 'lskew', label: 'churn overwrites', type: 'select', def: 'hot', options: opt([['hot', 'mostly a hot fifth of the files'], ['uniform', 'any file alike']]), show: on('lfs') },
    // ---- distributed
    { id: 'dproto', label: 'Protocol', type: 'select', group: 'The protocol', def: 'nfs', options: opt([['nfs', 'NFS-style: stateless, attribute cache'], ['afs', 'AFS-style: whole files, callbacks']]), show: on('dfs') },
    { id: 'dlat', label: 'One-way latency', type: 'number', def: 1, min: 1, max: 5, unit: 'ticks', show: on('dfs') },
    { id: 'dtimeout', label: 'Retry after', type: 'number', def: 4, min: 2, max: 20, unit: 'ticks', show: on('dfs') },
    { id: 'dattr', label: 'Attribute cache timeout', type: 'number', def: 3, min: 0, max: 20, unit: 'ticks', show: (v) => v.mode === 'dfs' && v.dproto === 'nfs' },
    { id: 'ddup', label: 'Duplicate-request cache', type: 'toggle', def: true, show: (v) => v.mode === 'dfs' && v.dproto === 'nfs' },
    { id: 'dprobe', label: 'Probe the server every (0: never)', type: 'number', def: 0, min: 0, max: 20, unit: 'ticks', show: (v) => v.mode === 'dfs' && v.dproto === 'afs' },
    { id: 'dfiles', label: 'Files on the server', type: 'table', group: 'Files and script', def: [{ name: 'tides', text: 'high water 06:10' }], minRows: 1, maxRows: 3, show: on('dfs'),
      columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[a-z][a-z0-9]{0,9}$', patternWhy: 'a short lowercase name', width: '80px' }, { id: 'text', label: 'Contents', type: 'text', maxLen: 30 }],
      newRow: (i) => ({ name: 'file' + (i + 1), text: 'version one' }) },
    { id: 'dscript', label: 'What each client does (from its time, in order)', type: 'table', def: DSCRIPT, minRows: 1, maxRows: 14, show: on('dfs'),
      columns: [{ id: 't', label: 'At', type: 'int', min: 0, max: 200, width: '48px' }, { id: 'c', label: 'Client', type: 'select', options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }], width: '56px' }, { id: 'op', label: 'Does', type: 'select', options: FL.DFS_OPS.map((o) => ({ value: o, label: o })), width: '80px' }, { id: 'file', label: 'File', type: 'text', pattern: '^[a-z][a-z0-9]{0,9}$', patternWhy: 'a file name', width: '70px' }, { id: 'data', label: 'Writes', type: 'text', maxLen: 24, required: false }],
      newRow: (i, rows) => ({ t: rows.length ? rows[rows.length - 1].t + 2 : 0, c: 'A', op: 'read', file: 'tides', data: '' }) },
    { id: 'dcrash', label: 'Server crashes', type: 'table', def: [], minRows: 0, maxRows: 3, show: on('dfs'),
      columns: [{ id: 't', label: 'Down at', type: 'int', min: 0, max: 200, width: '64px' }, { id: 'until', label: 'Back at', type: 'int', min: 1, max: 300, width: '64px' }],
      newRow: () => ({ t: 3, until: 8 }) },
    { id: 'ddrops', label: 'Messages lost', type: 'table', def: [], minRows: 0, maxRows: 4, show: on('dfs'),
      columns: [{ id: 't', label: 'Sent at', type: 'int', min: 0, max: 200, width: '56px' }, { id: 'dir', label: 'Which', type: 'select', options: [{ value: 'request', label: 'request' }, { value: 'reply', label: 'reply' }], width: '80px' }, { id: 'c', label: 'Client', type: 'select', options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }], width: '56px' }, { id: 'op', label: 'Kind', type: 'select', options: ['GETATTR', 'READ', 'WRITE', 'CREATE', 'REMOVE', 'FETCH', 'STORE'].map((k) => ({ value: k, label: k })) }],
      newRow: () => ({ t: 1, dir: 'reply', c: 'A', op: 'READ' }) },
  ];

  const P = (label, values) => ({ label, values });
  const presets = [
    P('Disk: create, write, link, unlink', { mode: 'disk' }),
    P('Disk: a file grows into its indirect block', { mode: 'disk', src: 'create /log\nwrite /log 0 tide at six\nappend /log [700 bytes]\nappend /log [900 bytes]', bs: 64, ndirect: 4, walkPath: '/log', walkN: 1200 }),
    P('Disk: byte N through double indirect', { mode: 'disk', src: 'create /atlas\nwrite /atlas 0 charts of the coast\nwrite /atlas 9000 harbour', bs: 128, ndirect: 4, ps: 4, nblocks: 64, walkPath: '/atlas', walkN: 9003 }),
    P('Disk: linked allocation, the walk hops', { mode: 'disk', src: 'create /chain\nappend /chain [900 bytes]\ncreate /other\nappend /other [200 bytes]\nappend /chain [300 bytes]', alloc: 'linked', bs: 128, walkPath: '/chain', walkN: 1000 }),
    P('Disk: FAT, the chain in a table', { mode: 'disk', src: 'create /a\nappend /a [300 bytes]\ncreate /b\nappend /b [300 bytes]\nappend /a [300 bytes]', alloc: 'fat', bs: 128, walkPath: '/a', walkN: 700 }),
    P('Disk: contiguous runs, fragmentation, compact', { mode: 'disk', src: 'create /a\nappend /a [512 bytes]\ncreate /b\nappend /b [256 bytes]\ncreate /c\nappend /c [512 bytes]\nunlink /b\nappend /a [2400 bytes]\ncompact\nappend /a [2400 bytes]', alloc: 'contiguous', bs: 256, nblocks: 32, ninodes: 8, walk: false }),
    P('Disk: extents', { mode: 'disk', src: 'create /a\nappend /a [600 bytes]\ncreate /b\nappend /b [200 bytes]\nappend /a [600 bytes]', alloc: 'extent', bs: 128, walkPath: '/a', walkN: 1000 }),
    P('Crash: no journal, fsck finds a block marked free', { mode: 'disk', src: 'create /diary\nwrite /diary 0 fog until noon\nappend /diary [300 bytes]', crash: true, cutAfter: 1, walk: false }),
    P('Crash: no journal, stale data fsck cannot see', { mode: 'disk', src: 'create /diary\nwrite /diary 0 fog until noon\nappend /diary [300 bytes]', crash: true, cutAfter: 2, walk: false }),
    P('Journal: ordered, cut before the commit', { mode: 'disk', src: 'create /log\nwrite /log 0 first page\nappend /log [300 bytes]', journal: 'ordered', crash: true, cutAfter: 3, walk: false }),
    P('Journal: writeback, stale data after replay', { mode: 'disk', src: 'create /log\nwrite /log 0 first page\nappend /log [300 bytes]', journal: 'writeback', crash: true, cutAfter: 4, walk: false }),
    P('Journal: data journaling, replayed whole', { mode: 'disk', src: 'create /log\nwrite /log 0 first page\nwrite /log 200 [120 bytes]', journal: 'data', crash: true, cutAfter: 5, walk: false }),
    P('Cache: write-back, a crash loses dirty blocks', { mode: 'disk', src: 'create /a\nwrite /a 0 saved by sync\nsync\ncreate /b\nwrite /b 0 never synced', cache: 'write-back', cacheBlocks: 16, crash: true, cutAfter: 0, walk: false }),
    P('Permissions: another user is refused', { mode: 'disk', src: EX[4].src, walk: false }),
    P('Mount: a second file system', { mode: 'disk', src: EX[5].src, walkPath: '/back', walkN: 3 }),
    P('Cylinder groups: files near their inodes', { mode: 'disk', src: 'mkdir /a\nmkdir /b\ncreate /a/x\nappend /a/x [600 bytes]\ncreate /b/y\nappend /b/y [600 bytes]', groups: 3, nblocks: 96, ninodes: 24, walkPath: '/b/y', walkN: 500 }),
    P('Tables: fork shares an offset', { mode: 'tables' }),
    P('Tables: dup against a second open', { mode: 'tables', tcalls: FL.toRows(TEX[1].src, 'calls') }),
    P('Tables: unlink while open, an orphan', { mode: 'tables', tcalls: FL.toRows(TEX[2].src, 'calls') }),
    P('Tables: permissions checked at open', { mode: 'tables', tcalls: FL.toRows(TEX[3].src, 'calls'), tfiles: [{ path: '/notes', mode: '640', text: 'harbour log: fog at six' }] }),
    P('COW: overwrite, then the flip', { mode: 'cow' }),
    P('COW: crash before the flip', { mode: 'cow', ccmds: FL.toRows('create chart\nwrite chart 0 rocks at the point\nwrite chart 3 [150 bytes]', 'cmd'), ccrash: true, ccut: 3 }),
    P('COW: a flipped bit, caught', { mode: 'cow', ccmds: FL.toRows('create chart\nwrite chart 0 rocks at the point; a sandbar off the river mouth\ncreate notes\nappend notes buoys repainted\ncorrupt 4\nread chart\nread notes\nscrub', 'cmd') }),
    P('COW: a snapshot keeps the old tree', { mode: 'cow', ccmds: FL.toRows('create chart\nwrite chart 0 [200 bytes]\nsnapshot\nwrite chart 0 STORM WARNING\ndelete chart\nscrub\ndrop 3', 'cmd') }),
    P('LFS: writes, sync, the inode map', { mode: 'lfs' }),
    P('LFS: cleaning, greedy', { mode: 'lfs', lcmds: FL.toRows('create a\ncreate b\ncreate c\ncreate d\nwrite a 0 [120 bytes]\nwrite b 0 [120 bytes]\nwrite c 0 [120 bytes]\nwrite d 0 [120 bytes]\nsync\nchurn 40\nclean 2', 'cmd'), lpolicy: 'greedy', lnsegs: 10 }),
    P('LFS: cleaning, cost-benefit', { mode: 'lfs', lcmds: FL.toRows('create a\ncreate b\ncreate c\ncreate d\nwrite a 0 [120 bytes]\nwrite b 0 [120 bytes]\nwrite c 0 [120 bytes]\nwrite d 0 [120 bytes]\nsync\nchurn 40\nclean 2', 'cmd'), lpolicy: 'cost-benefit', lnsegs: 10 }),
    P('LFS: crash, then roll forward', { mode: 'lfs', lcmds: FL.toRows('create a\ncreate b\nsync\nwrite a 0 [384 bytes]\nwrite b 0 [384 bytes]\nwrite a 0 NEVER SYNCED\ncrash\nread a\nread b', 'cmd') }),
    P('NFS: a stale read inside the attribute timeout', { mode: 'dfs' }),
    P('NFS: a lost reply, retried', { mode: 'dfs', dscript: [{ t: 0, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 0, c: 'A', op: 'write', file: 'tides', data: 'high water 07:00' }, { t: 0, c: 'A', op: 'close', file: 'tides', data: '' }, { t: 0, c: 'A', op: 'remove', file: 'tides', data: '' }], ddrops: [{ t: 5, dir: 'reply', c: 'A', op: 'REMOVE' }] }),
    P('NFS: the last close wins', { mode: 'dfs', dscript: [{ t: 0, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 0, c: 'B', op: 'open', file: 'tides', data: '' }, { t: 2, c: 'A', op: 'write', file: 'tides', data: 'A was here' }, { t: 2, c: 'B', op: 'write', file: 'tides', data: 'B was here' }, { t: 3, c: 'A', op: 'close', file: 'tides', data: '' }, { t: 5, c: 'B', op: 'close', file: 'tides', data: '' }, { t: 9, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 9, c: 'A', op: 'read', file: 'tides', data: '' }] }),
    P('AFS: a callback broken on close', { mode: 'dfs', dproto: 'afs' }),
    P('AFS: the server crashes, promises forgotten', { mode: 'dfs', dproto: 'afs', dprobe: 3, dscript: [{ t: 0, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 0, c: 'A', op: 'read', file: 'tides', data: '' }, { t: 0, c: 'A', op: 'close', file: 'tides', data: '' }, { t: 1, c: 'B', op: 'open', file: 'tides', data: '' }, { t: 1, c: 'B', op: 'write', file: 'tides', data: 'high water 06:40' }, { t: 9, c: 'B', op: 'close', file: 'tides', data: '' }, { t: 14, c: 'A', op: 'open', file: 'tides', data: '' }, { t: 14, c: 'A', op: 'read', file: 'tides', data: '' }], dcrash: [{ t: 4, until: 8 }] }),
  ];

  function check(v) {
    if (v.mode === 'disk') {
      if (v.bs * v.nblocks > 262144) return 'The disk: at most 256 KiB in all (' + v.nblocks + ' blocks of ' + v.bs + ' bytes is ' + FL.bytes(v.bs * v.nblocks) + '), so every block can be drawn';
      try { F().geometry(FL.geo(v)); } catch (e) { return 'The disk: ' + e.message; }
      const p = FL.parse(v.src);
      if (p.error) return 'Commands, line ' + p.error.line + ': ' + p.error.msg;
      return null;
    }
    if (v.mode === 'tables') { const p = FL.parseCalls(FL.fromRows(v.tcalls, 'calls')); return p.error ? 'System calls, row ' + p.error.line + ': ' + p.error.msg : null; }
    if (v.mode === 'cow') { const p = FL.parseCow(FL.fromRows(v.ccmds, 'cmd')); return p.error ? 'Commands, row ' + p.error.line + ': ' + p.error.msg : null; }
    if (v.mode === 'lfs') { const p = FL.parseLfs(FL.fromRows(v.lcmds, 'cmd')); return p.error ? 'Commands, row ' + p.error.line + ': ' + p.error.msg : null; }
    if (v.mode === 'dfs') return FL.dfsCheck(v);
    return null;
  }

  S.Labs.add({
    id: 'fs', part: 'fsimpl', title: 'File-system lab',
    blurb: 'A disk image block by block. Choose the geometry, the allocation method, the journal and the cache; type commands and watch exactly which blocks each one changes; cut the power between two writes and see fsck and the journal at work; walk to byte N. Then the open-file tables, a copy-on-write tree, a log-structured disk, and a distributed file system on a timeline.',
    setup: { fields, presets, check },
    views: [FL.inspectView],
    run(v, ctx) {
      FL.hookPick();
      if (v.mode === 'disk') return FL.diskRun(v, ctx);
      const r = v.mode === 'tables' ? FL.tablesRun(v, ctx) : v.mode === 'cow' ? FL.cowRun(v, ctx) : v.mode === 'lfs' ? FL.lfsRun(v, ctx) : FL.dfsRun(v, ctx);
      // the code editor belongs to the disk's commands: the other workbenches' steps tag no line of it
      for (const f of r.frames || []) f.marks = [];
      if (r.error) r.error = { msg: r.error.msg || String(r.error) };
      return r;
    },
  });
  FL.presets = presets;

  if (S.Checks) {
    const pick = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); for (let i = 0; i < 40 && !(P.res && P.frames.length); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 500)); P.go(" + at + ', true); P.stage.finish(); try { localStorage.removeItem(\'proses.lab:fs\'); } catch (e) {}';
    S.Checks.push({ group: 'labs', name: 'fs lab', hash: 'labs/fs', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:fs'); } catch (e) {} const P = Proses.app.page.lab; P.go(4, true); P.stage.finish();", sel: '#main' });
    presets.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'fs lab: ' + p.label, hash: 'labs/fs', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, 'Math.max(0, P.frames.length - 2)'), sel: '#main' }));
    S.Checks.push({ group: 'labs', name: 'fs lab: mkfs, the layout', hash: 'labs/fs', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:fs'); } catch (e) {} const P = Proses.app.page.lab; P.go(0, true); P.stage.finish(); P.showTab('tables');", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'fs lab: inspect a block', hash: 'labs/fs', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:fs'); } catch (e) {} const P = Proses.app.page.lab; P.go(4, true); P.stage.finish(); Proses.FsLab.sel = { block: 3, ino: null, dev: 0 }; P.showTab('inspect');", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
