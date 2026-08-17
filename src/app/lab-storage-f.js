// The Storage lab, registered: four workbenches behind one Mode select. Disk: the geometry, RPM and seek curve, a
// request queue (typed, typed arrivals, or a seeded stream), the head's start and direction, and one or more arm
// policies. SSD: blocks and pages, over-provisioning, the garbage-collection policy, wear levelling, a workload and
// TRIM. RAID: the level, layout, disks and chunk size, a message written across them, one or two disks failed and
// rebuilt, and a small write counted. I/O: polling against interrupts against DMA, blocking against non-blocking
// against asynchronous reads, and the life of one read through the layers. The diagram checks cover every preset.
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const on = (m) => (v) => v.mode === m;
  const io = (k) => (v) => v.mode === 'io' && v.ioView === k;
  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const QUEUE = [130, 41, 188, 12, 97, 155, 63, 77];
  const ARR = [
    { cyl: 20, at: 0, head: 0, sector: 12, count: 8 }, { cyl: 178, at: 0, head: 1, sector: 40, count: 8 }, { cyl: 172, at: 0, head: 2, sector: 75, count: 8 },
    { cyl: 181, at: 4, head: 0, sector: 3, count: 8 }, { cyl: 174, at: 8, head: 3, sector: 90, count: 8 }, { cyl: 179, at: 12, head: 1, sector: 51, count: 8 },
    { cyl: 176, at: 16, head: 2, sector: 22, count: 8 }, { cyl: 183, at: 20, head: 0, sector: 66, count: 8 }, { cyl: 171, at: 24, head: 3, sector: 8, count: 8 },
  ];
  const polDefaults = (ids) => Object.fromEntries(SL.DISK_POLS.map((p) => ['p_' + p.id, ids.includes(p.id)]));
  const disks = (n) => Array.from({ length: n }, (_, d) => ({ value: d, label: 'disk ' + d }));

  const fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'disk', options: opt([['disk', 'Disk: the arm and its queue'], ['ssd', 'SSD: pages, blocks and garbage'], ['raid', 'RAID: stripes, parity, a rebuild'], ['io', 'I/O: how data reaches a program']]) },
    // ---- disk
    { id: 'dCyl', label: 'Cylinders', type: 'number', group: 'The disk', def: 200, min: 20, max: 100000, show: on('disk') },
    { id: 'dHeads', label: 'Heads (surfaces)', type: 'number', def: 4, min: 1, max: 16, show: on('disk') },
    { id: 'dSpt', label: 'Sectors a track', type: 'number', def: 100, min: 8, max: 2000, show: on('disk') },
    { id: 'dRpm', label: 'Spindle speed', type: 'select', def: 7200, options: [4200, 5400, 7200, 10000, 15000].map((r) => ({ value: r, label: r + ' RPM' })), show: on('disk') },
    { id: 'dSettle', label: 'Seek: settle time', type: 'number', def: 1, min: 0, max: 20, integer: false, unit: 'ms', show: on('disk'), help: 'a seek of d cylinders takes settle + a·√d up to the knee, then grows in a straight line to the full stroke' },
    { id: 'dKnee', label: 'Seek: knee', type: 'number', def: 50, min: 1, max: 100000, unit: 'cylinders', show: on('disk') },
    { id: 'dKneeT', label: 'Seek: time at the knee', type: 'number', def: 6.4, min: 0.1, max: 50, integer: false, unit: 'ms', show: on('disk') },
    { id: 'dFull', label: 'Seek: full stroke', type: 'number', def: 10, min: 0.2, max: 60, integer: false, unit: 'ms', show: on('disk') },
    { id: 'dSrc', label: 'Requests', type: 'select', group: 'The request queue', def: 'list', options: opt([['list', 'a queue of cylinders'], ['table', 'arrivals over time, with sectors'], ['random', 'a stream from the seed']]), show: on('disk') },
    { id: 'dQueue', label: 'Cylinders, in arrival order', type: 'list', kind: 'int', def: QUEUE, min: 0, max: 99999, minLen: 1, maxLen: 20, show: (v) => v.mode === 'disk' && v.dSrc === 'list', help: 'every request waits from the start; its head and sector come from the seed' },
    { id: 'dArr', label: 'Requests', type: 'table', def: ARR, minRows: 1, maxRows: 20, show: (v) => v.mode === 'disk' && v.dSrc === 'table',
      columns: [{ id: 'cyl', label: 'Cylinder', type: 'int', min: 0, max: 99999, width: '70px' }, { id: 'at', label: 'Arrives', type: 'int', min: 0, max: 100000, width: '64px' }, { id: 'head', label: 'Head', type: 'int', min: 0, max: 15, width: '48px' }, { id: 'sector', label: 'Sector', type: 'int', min: 0, max: 1999, width: '58px' }, { id: 'count', label: 'Sectors', type: 'int', min: 1, max: 256, width: '58px' }],
      newRow: (i, rows) => ({ cyl: (37 * (i + 3)) % 200, at: rows.length ? rows[rows.length - 1].at + 4 : 0, head: 0, sector: (13 * i) % 100, count: 8 }) },
    { id: 'dRandN', label: 'How many requests', type: 'number', def: 12, min: 2, max: 20, show: (v) => v.mode === 'disk' && v.dSrc === 'random' },
    { id: 'dSpread', label: 'Arrivals spread over', type: 'number', def: 300, min: 0, max: 100000, unit: 'arm steps', show: (v) => v.mode === 'disk' && v.dSrc === 'random', help: 'one arm step moves the arm one cylinder; the first three requests wait from the start' },
    { id: 'dCount', label: 'Sectors a request', type: 'number', def: 8, min: 1, max: 256, show: (v) => v.mode === 'disk' && v.dSrc !== 'table' },
    { id: 'dStart', label: 'The head starts at cylinder', type: 'number', def: 104, min: 0, max: 99999, show: on('disk') },
    { id: 'dDir', label: 'Moving', type: 'select', def: 'up', options: opt([['up', 'up, to higher cylinders'], ['down', 'down, to lower cylinders']]), show: on('disk') },
  ].concat(SL.DISK_POLS.map((p, i) => ({ id: 'p_' + p.id, label: p.label, type: 'toggle', def: p.id === 'sstf', group: i === 0 ? 'Policies (one or more, side by side)' : undefined, show: on('disk') })), [
    { id: 'dBatch', label: 'N-step SCAN: batch size N', type: 'number', def: 3, min: 1, max: 20, show: (v) => v.mode === 'disk' && v.p_nscan },
    // ---- SSD
    { id: 'sBlocks', label: 'Erase blocks', type: 'number', group: 'The flash', def: 16, min: 6, max: 48, show: on('ssd') },
    { id: 'sPages', label: 'Pages a block', type: 'number', def: 8, min: 2, max: 32, show: on('ssd') },
    { id: 'sOp', label: 'Over-provisioning', type: 'select', def: 0.25, options: [0.07, 0.15, 0.25, 0.5, 1].map((x) => ({ value: x, label: Math.round(x * 100) + '% spare' })), show: on('ssd'), help: 'the flash beyond what the drive shows, as a share of the logical size' },
    { id: 'sGc', label: 'Garbage-collection victim', type: 'select', group: 'The translation layer', def: 'greedy', options: opt([['greedy', 'greedy: fewest valid pages'], ['cost-benefit', 'cost-benefit: (1 − u)·age / (1 + u)']]), show: on('ssd') },
    { id: 'sWear', label: 'Wear levelling', type: 'select', def: 'none', options: opt([['none', 'none: free blocks in turn'], ['dynamic', 'dynamic: the least-worn free block'], ['static', 'static: also move cold data']]), show: on('ssd') },
    { id: 'sDelta', label: 'Static levelling: largest spread', type: 'number', def: 4, min: 1, max: 50, unit: 'erases', show: (v) => v.mode === 'ssd' && v.sWear === 'static' },
    { id: 'sWork', label: 'Writes', type: 'select', group: 'The workload', def: 'uniform', options: opt([['sequential', 'sequential: page after page'], ['uniform', 'uniform: any page alike'], ['hotcold', 'hot and cold: a few pages often']]), show: on('ssd') },
    { id: 'sCount', label: 'Host writes', type: 'number', def: 600, min: 10, max: 4000, show: on('ssd') },
    { id: 'sFill', label: 'Fill the drive first', type: 'toggle', def: true, show: on('ssd') },
    { id: 'sHot', label: 'Hot pages, share of the drive', type: 'select', def: 0.2, options: [0.05, 0.1, 0.2, 0.3, 0.5].map((x) => ({ value: x, label: Math.round(x * 100) + '%' })), show: (v) => v.mode === 'ssd' && v.sWork === 'hotcold' },
    { id: 'sHotShare', label: 'Writes that go to them', type: 'select', def: 0.8, options: [0.6, 0.7, 0.8, 0.9, 0.95].map((x) => ({ value: x, label: Math.round(x * 100) + '%' })), show: (v) => v.mode === 'ssd' && v.sWork === 'hotcold' },
    { id: 'sTrim', label: 'TRIM', type: 'select', def: 0, options: [0, 0.05, 0.1, 0.2, 0.3].map((x) => ({ value: x, label: x ? Math.round(x * 100) + '% of operations trim a page' : 'off' })), show: on('ssd'), help: 'a trimmed page is invalid at once, so the collector need not copy it' },
    // ---- RAID
    { id: 'rLevel', label: 'Level', type: 'select', group: 'The array', def: 5, options: opt([[0, 'RAID 0: striping'], [1, 'RAID 1: mirroring'], [10, 'RAID 10: striped mirrors'], [4, 'RAID 4: a parity disk'], [5, 'RAID 5: rotating parity'], [6, 'RAID 6: P and Q']]), show: on('raid') },
    { id: 'rLayout', label: 'Parity layout', type: 'select', def: 'left-symmetric', options: opt([['left-symmetric', 'left-symmetric'], ['left-asymmetric', 'left-asymmetric'], ['right-symmetric', 'right-symmetric'], ['right-asymmetric', 'right-asymmetric']]), show: (v) => v.mode === 'raid' && (v.rLevel === 5 || v.rLevel === 6) },
    { id: 'rDisks', label: 'Disks', type: 'number', def: 5, min: 2, max: 8, show: on('raid') },
    { id: 'rChunk', label: 'Chunk size', type: 'number', def: 4, min: 1, max: 8, unit: 'bytes', show: on('raid'), help: 'tiny chunks, so every byte can be shown' },
    { id: 'rMsg', label: 'Message to write', type: 'text', group: 'Data and failures', def: 'DISKS FAIL, BUT PARITY BRINGS THE DATA BACK.', maxLen: 64, show: on('raid') },
    { id: 'rFail1', label: 'Fail', type: 'select', def: 2, options: [{ value: -1, label: 'no disk' }].concat(disks(8)), show: on('raid') },
    { id: 'rFail2', label: 'And fail', type: 'select', def: -1, options: [{ value: -1, label: 'no second disk' }].concat(disks(8)), show: on('raid') },
    { id: 'rSwOff', label: 'Small write at byte', type: 'number', def: 5, min: 0, max: 255, show: on('raid'), help: 'after the rebuild, overwrite a few bytes and count the reads and writes it costs' },
    { id: 'rSwText', label: 'Small write: new bytes', type: 'text', def: 'X', maxLen: 16, show: on('raid') },
    // ---- I/O
    { id: 'ioView', label: 'Show', type: 'select', group: 'What to compare', def: 'xfer', options: opt([['xfer', 'polling, interrupts and DMA'], ['modes', 'blocking, non-blocking, asynchronous'], ['read', 'the life of a read()'], ['buffer', 'buffering: none, single, double, circular'], ['cache', 'the buffer cache'], ['spool', 'spooling to a printer'], ['queue', 'the block queue and its scheduler']]), show: on('io') },
    { id: 'xBytes', label: 'Bytes to move', type: 'number', group: 'The transfer (µs)', def: 16, min: 1, max: 4096, show: io('xfer') },
    { id: 'xUnit', label: 'Bytes a unit (data register)', type: 'number', def: 4, min: 1, max: 512, show: io('xfer') },
    { id: 'xDevice', label: 'Device time a unit', type: 'number', def: 10, min: 0.1, max: 5000, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xCmd', label: 'Write a command', type: 'number', def: 1, min: 0.1, max: 100, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xPoll', label: 'One status poll', type: 'number', def: 0.5, min: 0.05, max: 100, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xCopy', label: 'Copy a unit', type: 'number', def: 0.5, min: 0.05, max: 100, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xIrq', label: 'Interrupt entry and exit', type: 'number', def: 4, min: 0.1, max: 200, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xDmaSetup', label: 'Program the DMA controller', type: 'number', def: 5, min: 0.1, max: 200, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'xDmaBlock', label: 'DMA block (0: all at once)', type: 'number', def: 0, min: 0, max: 4096, unit: 'bytes', show: io('xfer') },
    { id: 'xBus', label: 'Bus time a unit', type: 'number', def: 0.2, min: 0.01, max: 50, integer: false, unit: 'µs', show: io('xfer') },
    { id: 'mDevice', label: 'Device time', type: 'number', group: 'The read (µs)', def: 30, min: 1, max: 1000, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mWork', label: 'A’s work without the data', type: 'number', def: 20, min: 0, max: 1000, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mUse', label: 'A’s work on the data', type: 'number', def: 10, min: 0, max: 1000, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mOther', label: 'B’s work (CPU-bound)', type: 'number', def: 40, min: 0, max: 2000, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mSyscall', label: 'A system call', type: 'number', def: 2, min: 0.1, max: 100, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mCopy', label: 'Kernel copies the data', type: 'number', def: 3, min: 0, max: 100, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mSlice', label: 'Non-blocking: work between retries', type: 'number', def: 5, min: 0.5, max: 500, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mNotify', label: 'Asynchronous: the notification', type: 'number', def: 2, min: 0, max: 100, integer: false, unit: 'µs', show: io('modes') },
    { id: 'mIrq', label: 'Completion interrupt', type: 'number', def: 1, min: 0, max: 100, integer: false, unit: 'µs', show: io('modes') },
    { id: 'rdBytes', label: 'Bytes to read', type: 'number', group: 'The read', def: 8192, min: 1, max: 65536, show: io('read') },
    { id: 'rdOffset', label: 'From offset', type: 'number', def: 0, min: 0, max: 1048576, show: io('read') },
    { id: 'rdBlock', label: 'Block size', type: 'select', def: 4096, options: [512, 1024, 2048, 4096, 8192].map((b) => ({ value: b, label: b + ' bytes' })), show: io('read') },
    { id: 'rdCached', label: 'In the page cache? (hit or miss, one a block)', type: 'list', kind: 'text', def: ['hit', 'miss'], minLen: 1, maxLen: 16, show: io('read'),
      check: (x) => (x.every((w) => /^(hit|miss)$/i.test(w)) ? null : 'In the page cache: write hit or miss for each block') },
    { id: 'rdDisk', label: 'Disk block of each file block', type: 'list', kind: 'int', def: [9120, 9121, 9122, 9123], min: 0, max: 99999, minLen: 1, maxLen: 16, show: io('read') },
    // ---- the kernel I/O subsystem (lab-storage-g.js, lab-storage-h.js)
    { id: 'bNone', label: 'No buffer', type: 'toggle', group: 'Buffering (side by side)', def: true, show: io('buffer') },
    { id: 'bSingle', label: 'Single buffer', type: 'toggle', def: true, show: io('buffer') },
    { id: 'bDouble', label: 'Double buffer', type: 'toggle', def: true, show: io('buffer') },
    { id: 'bCirc', label: 'Circular buffer', type: 'toggle', def: true, show: io('buffer') },
    { id: 'bSlots', label: 'Circular buffer slots', type: 'number', def: 4, min: 2, max: 8, show: (v) => v.mode === 'io' && v.ioView === 'buffer' && v.bCirc },
    { id: 'bBlocks', label: 'Blocks to read', type: 'number', group: 'The blocks (µs)', def: 6, min: 1, max: 12, show: io('buffer') },
    { id: 'bFill', label: 'Device time to fill a block (T), one a block or one for all', type: 'list', kind: 'int', def: [10], min: 1, max: 99, minLen: 1, maxLen: 12, show: io('buffer'), help: 'a list shorter than the blocks repeats' },
    { id: 'bMove', label: 'Moving a block out of a buffer (M)', type: 'number', def: 2, min: 0, max: 50, integer: false, unit: 'µs', show: io('buffer') },
    { id: 'bCompute', label: 'Computing on a block (C), one a block or one for all', type: 'list', kind: 'int', def: [6], min: 0, max: 99, minLen: 1, maxLen: 12, show: io('buffer') },
    { id: 'cSize', label: 'Cache blocks', type: 'number', group: 'The buffer cache (LRU)', def: 4, min: 1, max: 8, show: io('cache') },
    { id: 'cWrite', label: 'Writes', type: 'select', def: 'both', options: opt([['both', 'write-back and write-through, side by side'], ['back', 'write-back: dirty until evicted or synced'], ['through', 'write-through: to disk at once']]), show: io('cache') },
    { id: 'cRa', label: 'Read-ahead on a miss', type: 'number', def: 0, min: 0, max: 4, unit: 'blocks', show: io('cache') },
    { id: 'cOps', label: 'Operations: r12 reads block 12, w12 writes it, sync', type: 'list', kind: 'text', def: ['r1', 'r2', 'w1', 'r3', 'w2', 'r4', 'r5', 'r1', 'w6', 'sync', 'r2'], minLen: 1, maxLen: 24, show: io('cache') },
    { id: 'spJobs', label: 'Print jobs', type: 'table', group: 'Spooling', def: [{ proc: 'A', at: 0, pages: 4 }, { proc: 'B', at: 1, pages: 2 }, { proc: 'C', at: 2, pages: 5 }, { proc: 'D', at: 6, pages: 1 }], minRows: 1, maxRows: 5, show: io('spool'),
      columns: [{ id: 'proc', label: 'Process', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,3}$', patternWhy: 'a short name', width: '70px' }, { id: 'at', label: 'Asks at', type: 'number', min: 0, max: 100, width: '64px' }, { id: 'pages', label: 'Pages', type: 'int', min: 1, max: 20, width: '58px' }],
      newRow: (i) => ({ proc: String.fromCharCode(65 + i), at: 2 * i, pages: 2 }) },
    { id: 'spPage', label: 'Printing a page', type: 'number', def: 2, min: 0.1, max: 20, integer: false, unit: 's', show: io('spool') },
    { id: 'spSpool', label: 'Writing a page to the spool', type: 'number', def: 0.2, min: 0.01, max: 5, integer: false, unit: 's', show: io('spool') },
    { id: 'qReqs', label: 'Requests', type: 'table', group: 'The block queue', def: [
      { at: 0, sector: 500, count: 8, op: 'r', proc: 'A' }, { at: 0, sector: 120, count: 8, op: 'w', proc: 'B' }, { at: 1, sector: 508, count: 8, op: 'r', proc: 'A' }, { at: 2, sector: 900, count: 8, op: 'r', proc: 'C' },
      { at: 3, sector: 112, count: 8, op: 'w', proc: 'B' }, { at: 4, sector: 300, count: 8, op: 'r', proc: 'D' }, { at: 5, sector: 516, count: 8, op: 'r', proc: 'A' }, { at: 6, sector: 60, count: 8, op: 'w', proc: 'B' }], minRows: 1, maxRows: 14, show: io('queue'),
      columns: [{ id: 'at', label: 'Arrives', type: 'number', min: 0, max: 1000, width: '60px' }, { id: 'sector', label: 'Sector', type: 'int', min: 0, max: 9999, width: '60px' }, { id: 'count', label: 'Sectors', type: 'int', min: 1, max: 64, width: '56px' }, { id: 'op', label: 'Op', type: 'select', options: opt([['r', 'read'], ['w', 'write']]), width: '66px' }, { id: 'proc', label: 'By', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,3}$', patternWhy: 'a short name', width: '44px' }],
      newRow: (i, rows) => ({ at: rows.length ? rows[rows.length - 1].at + 1 : 0, sector: (211 * (i + 2)) % 1000, count: 8, op: 'r', proc: 'A' }) },
    { id: 'qNoop', label: 'noop: arrival order', type: 'toggle', group: 'Schedulers (side by side)', def: true, show: io('queue') },
    { id: 'qLook', label: 'look: an elevator sweep', type: 'toggle', def: true, show: io('queue') },
    { id: 'qDeadline', label: 'deadline: a sweep, late requests first', type: 'toggle', def: true, show: io('queue') },
    { id: 'qMerge', label: 'Merge contiguous requests', type: 'toggle', def: true, show: io('queue') },
    { id: 'qStart', label: 'The head starts at sector', type: 'number', group: 'Timing (ms)', def: 400, min: 0, max: 9999, show: io('queue') },
    { id: 'qBase', label: 'A dispatch costs', type: 'number', def: 2, min: 0, max: 50, integer: false, unit: 'ms', show: io('queue') },
    { id: 'qPer', label: 'Each sector adds', type: 'number', def: 0.1, min: 0, max: 5, integer: false, unit: 'ms', show: io('queue') },
    { id: 'qSeek', label: 'Each sector of seek adds', type: 'number', def: 0.01, min: 0, max: 1, integer: false, unit: 'ms', show: io('queue') },
    { id: 'qRexp', label: 'deadline: a read expires after', type: 'number', def: 10, min: 0, max: 1000, integer: false, unit: 'ms', show: (v) => v.mode === 'io' && v.ioView === 'queue' && v.qDeadline },
    { id: 'qWexp', label: 'deadline: a write expires after', type: 'number', def: 50, min: 0, max: 5000, integer: false, unit: 'ms', show: (v) => v.mode === 'io' && v.ioView === 'queue' && v.qDeadline },
  ]);

  const P = (label, values) => ({ label, values });
  const presets = [
    P('Disk: SSTF on a queue', Object.assign({ mode: 'disk' }, polDefaults(['sstf']))),
    P('Disk: all six policies', Object.assign({ mode: 'disk' }, polDefaults(['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook']))),
    P('Disk: SSTF starves a far request', Object.assign({ mode: 'disk', dSrc: 'table', dStart: 175 }, polDefaults(['sstf', 'look', 'cscan']))),
    P('Disk: a seeded stream, FCFS against C-LOOK', Object.assign({ mode: 'disk', dSrc: 'random', dRandN: 14, dSpread: 400, dCyl: 1000, dStart: 500, dKnee: 200, dKneeT: 5, dFull: 12, dRpm: 10000 }, polDefaults(['fcfs', 'clook']))),
    P('SSD: uniform writes, greedy', { mode: 'ssd' }),
    P('SSD: hot and cold, cost-benefit', { mode: 'ssd', sWork: 'hotcold', sGc: 'cost-benefit', sCount: 900 }),
    P('SSD: little spare room', { mode: 'ssd', sOp: 0.07, sCount: 500 }),
    P('SSD: static wear levelling and TRIM', { mode: 'ssd', sWork: 'hotcold', sWear: 'static', sDelta: 3, sTrim: 0.1, sCount: 1200 }),
    P('RAID 5: lose a disk, rebuild by XOR', { mode: 'raid' }),
    P('RAID 6: two disks lost, P and Q', { mode: 'raid', rLevel: 6, rDisks: 6, rFail1: 1, rFail2: 4 }),
    P('RAID 4: the parity disk', { mode: 'raid', rLevel: 4, rDisks: 4, rFail1: 3, rMsg: 'ONE PARITY DISK FOR ALL' }),
    P('RAID 10: mirrors striped', { mode: 'raid', rLevel: 10, rDisks: 4, rFail1: 0, rFail2: 3, rMsg: 'MIRRORS, STRIPED' }),
    P('RAID 0: one disk lost, data lost', { mode: 'raid', rLevel: 0, rDisks: 3, rFail1: 1, rMsg: 'FAST BUT FRAGILE' }),
    P('I/O: polling, interrupts, DMA', { mode: 'io', ioView: 'xfer' }),
    P('I/O: a slow device', { mode: 'io', ioView: 'xfer', xBytes: 64, xUnit: 8, xDevice: 40, xDmaBlock: 32 }),
    P('I/O: blocking against asynchronous', { mode: 'io', ioView: 'modes' }),
    P('I/O: the life of a read', { mode: 'io', ioView: 'read' }),
    P('Buffering: none, single, double, circular', { mode: 'io', ioView: 'buffer' }),
    P('Buffering: a bursty device, a ring absorbs it', { mode: 'io', ioView: 'buffer', bNone: false, bSingle: true, bDouble: true, bCirc: true, bSlots: 4, bBlocks: 10, bFill: [3, 3, 3, 3, 14, 14, 3, 3, 3, 3], bMove: 1, bCompute: [7] }),
    P('Cache: write-back against write-through', { mode: 'io', ioView: 'cache' }),
    P('Cache: read-ahead on a scan', { mode: 'io', ioView: 'cache', cWrite: 'back', cSize: 4, cRa: 2, cOps: ['r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28'] }),
    P('Cache: a loop one block too big for LRU', { mode: 'io', ioView: 'cache', cWrite: 'back', cSize: 3, cRa: 0, cOps: ['r1', 'r2', 'r3', 'r4', 'r1', 'r2', 'r3', 'r4', 'r1', 'r2', 'r3', 'r4'] }),
    P('Spooling: four jobs, one printer', { mode: 'io', ioView: 'spool' }),
    P('Block queue: noop, look and deadline', { mode: 'io', ioView: 'queue' }),
    P('Block queue: merging off', { mode: 'io', ioView: 'queue', qMerge: false, qNoop: true, qLook: true, qDeadline: false }),
  ];

  function check(v) {
    if (v.mode === 'disk') {
      if (!SL.diskPolsOn(v).length) return 'Policies: turn on at least one';
      if (v.dStart >= v.dCyl) return 'The head starts at cylinder: below ' + v.dCyl;
      if (v.dKnee >= v.dCyl - 1) return 'Seek: the knee must be below the full stroke of ' + (v.dCyl - 1) + ' cylinders';
      if (!(v.dKneeT > v.dSettle)) return 'Seek: the time at the knee must exceed the settle time';
      if (!(v.dFull > v.dKneeT)) return 'Seek: the full stroke must take longer than the knee';
      if (v.dSrc === 'list') { const bad = v.dQueue.find((c) => c >= v.dCyl); if (bad !== undefined) return 'Cylinders: ' + bad + ' is off a disk of ' + v.dCyl; }
      if (v.dSrc === 'table') for (const [i, q] of v.dArr.entries()) {
        if (q.cyl >= v.dCyl) return 'Requests, row ' + (i + 1) + ': cylinder ' + q.cyl + ' is off a disk of ' + v.dCyl;
        if (q.head >= v.dHeads) return 'Requests, row ' + (i + 1) + ': head ' + q.head + ', but the disk has ' + v.dHeads;
        if (q.sector >= v.dSpt) return 'Requests, row ' + (i + 1) + ': sector ' + q.sector + ', but a track has ' + v.dSpt;
      }
      return null;
    }
    if (v.mode === 'ssd') return SL.ssdCheck ? SL.ssdCheck(v) : null;
    if (v.mode === 'raid') return SL.raidCheck ? SL.raidCheck(v) : null;
    if (v.mode === 'io') return SL.ioCheck ? SL.ioCheck(v) : null;
    return null;
  }

  S.Labs.add({
    id: 'storage', part: 'storage', title: 'Storage lab',
    blurb: 'Four workbenches. A disk of your geometry and seek curve serving your queue under one or more arm policies; an SSD whose pages go valid, stale and free as garbage collection runs; a RAID array that loses one or two disks and rebuilds them byte by byte; and the ways data reaches a program, from polling to DMA and from a blocking read to an asynchronous one.',
    setup: { fields, presets, check },
    run(v, ctx) {
      if (v.mode === 'ssd') return SL.ssdRun(v, ctx);
      if (v.mode === 'raid') return SL.raidRun(v, ctx);
      if (v.mode === 'io') return SL.ioRun(v, ctx);
      return SL.diskRun(v, ctx);
    },
  });
  SL.presets = presets;

  if (S.Checks) {
    const pick = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); for (let i = 0; i < 40 && !(P.res && P.frames.length); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 500)); P.go(" + at + ', true); P.stage.finish(); try { localStorage.removeItem(\'proses.lab:storage\'); } catch (e) {}';
    S.Checks.push({ group: 'labs', name: 'storage lab', hash: 'labs/storage', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:storage'); } catch (e) {} const P = Proses.app.page.lab; P.go(4, true); P.stage.finish();", sel: '#main' });
    presets.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'storage lab: ' + p.label, hash: 'labs/storage', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, 'Math.max(0, P.frames.length - 2)'), sel: '#main' }));
    S.Checks.push({ group: 'labs', name: 'storage lab: disk totals, metrics', hash: 'labs/storage', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(1, 'P.frames.length - 1') + " P.showTab('metrics');", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'storage lab: cache tables', hash: 'labs/storage', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(presets.findIndex((p) => p.label === 'Cache: write-back against write-through'), 'P.frames.length - 1') + " P.showTab('tables');", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'storage lab: RAID tables', hash: 'labs/storage', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(9, 'P.frames.length - 1') + " P.showTab('tables');", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
