// Part 13, the life of a read: one read() followed through the layers (the program, the C library, the system
// call, VFS, the page cache, the file system, the block layer, the driver, the controller, the interrupt handler
// and the scheduler) and back; and the device driver on its own, split into the part the kernel calls and the
// part the interrupt runs. Every step and time comes from S.IO.lifeOfRead (src/core/io-d-read.js), which takes
// the disk's time from the disk model (S.Storage).
(function (S) {
  'use strict';
  const R = Math.round;
  const LAYOUT = { contiguous: (n) => [...Array(n)].map((_, i) => 812 + i), scattered: (n) => [...Array(n)].map((_, i) => [812, 40377, 9050, 131060, 2203, 77000, 15555, 99001][i % 8] + i) };
  const CACHED = { none: () => false, all: () => true, first: (n) => [...Array(n)].map((_, i) => i < Math.ceil(n / 2)), last: (n) => [...Array(n)].map((_, i) => i >= Math.ceil(n / 2)) };
  const optsOf = (inp0) => {
    const inp = Object.assign({}, inp0, { blockSize: +inp0.blockSize });
    const first = Math.floor(inp.offset / inp.blockSize), last = Math.floor((inp.offset + Math.max(1, inp.bytes) - 1) / inp.blockSize), n = last - first + 1;
    const blocks = {}; LAYOUT[inp.layout](n).forEach((d, i) => { blocks[first + i] = d; });
    return { file: 'notes.txt', fd: 3, bytes: inp.bytes, offset: inp.offset, blockSize: inp.blockSize, blocks, cached: CACHED[inp.cached](n), n };
  };
  const IN = [
    { id: 'bytes', kind: 'number', label: 'bytes to read', def: 4096, min: 1, max: 65536 },
    { id: 'offset', kind: 'number', label: 'from offset', def: 0, min: 0, max: 1e7 },
    { id: 'blockSize', kind: 'choice', label: 'block size', def: '4096', options: [{ value: '1024', label: '1 KiB' }, { value: '4096', label: '4 KiB' }] },
    { id: 'cached', kind: 'choice', label: 'in the page cache', def: 'none', options: [{ value: 'none', label: 'nothing' }, { value: 'all', label: 'every block' }, { value: 'first', label: 'the first half' }, { value: 'last', label: 'the second half' }] },
    { id: 'layout', kind: 'choice', label: 'blocks on disk', def: 'contiguous', options: [{ value: 'contiguous', label: 'one after another' }, { value: 'scattered', label: 'scattered' }] },
  ];
  const check = (inp) => (Math.floor((inp.offset + inp.bytes - 1) / +inp.blockSize) - Math.floor(inp.offset / +inp.blockSize) + 1 > 16 ? 'at most 16 blocks in one read' : null);

  /** the layer stack, the token at the current layer, and the process's state */
  function stack(prefix, x, y, w, cur, seen, proc) {
    const t = S.T12, items = [], L = S.IO.layers, lh = 32, gap = 6;
    const bands = { user: [], kernel: [], device: [] };
    L.forEach((ly, i) => {
      const yy = y + i * (lh + gap);
      bands[ly.mode].push(yy);
      items.push({ key: prefix + ':' + ly.id, kind: 'cell', x: x + 70, y: yy, w: w - 70, h: lh, rx: 5, text: ly.name, size: 14, cls: 'ly ' + ly.mode + (ly.id === cur ? ' act' : seen.has(ly.id) ? ' seen' : '') });
    });
    // the mode of each run of layers, written down the left edge
    const runs = []; L.forEach((ly, i) => { const r = runs[runs.length - 1]; if (r && r.mode === ly.mode) r.to = i; else runs.push({ mode: ly.mode, from: i, to: i }); });
    runs.forEach((r, k) => {
      const y0 = y + r.from * (lh + gap), y1 = y + r.to * (lh + gap) + lh;
      items.push({ key: prefix + ':m' + k, kind: 'line', x1: x + 58, y1: y0 + 2, x2: x + 58, y2: y1 - 2, cls: 'drop13', audit: 'ignore' });
      items.push(t.text(prefix + ':mt' + k, x + 50, (y0 + y1) / 2 + 5, r.mode === 'user' ? 'user' : r.mode === 'kernel' ? 'kernel' : 'device', 'mode13 tick', 12, 'end'));
    });
    return { items, h: L.length * (lh + gap) - gap, rowY: (id) => y + L.findIndex((l) => l.id === id) * (lh + gap) };
  }

  S.topic({
    id: 'io-life-of-read', family: 'p13-read', order: 10, title: 'The life of a read request',
    blurb: 'A program calls read(3, buf, 4096). Follow the request down: the C library traps into the kernel, VFS finds the open file and its inode, the page cache is checked, and on a miss the file system maps the blocks, the block layer queues a request, the driver starts the disk and the process sleeps. Then back up: the interrupt, the wake-up, the copy, the return.',
    inputs: IN, check,
    presets: [
      { label: 'A cold read of one block', values: { bytes: 4096, offset: 0, blockSize: '4096', cached: 'none', layout: 'contiguous' } },
      { label: 'The same block, cached', values: { bytes: 4096, offset: 0, blockSize: '4096', cached: 'all', layout: 'contiguous' } },
      { label: 'Four blocks, together on disk', values: { bytes: 16384, offset: 0, blockSize: '4096', cached: 'none', layout: 'contiguous' } },
      { label: 'Four blocks, scattered', values: { bytes: 16384, offset: 0, blockSize: '4096', cached: 'none', layout: 'scattered' } },
      { label: 'Half of it cached', values: { bytes: 8192, offset: 4096, blockSize: '1024', cached: 'first', layout: 'contiguous' } },
    ],
    counters: [{ id: 'us', label: 'µs so far' }],
    run(inp) {
      const t = S.T12, o = optsOf(inp), bs = o.blockSize, res = S.IO.lifeOfRead(o), F = new S.Frames(['us']);
      const ctl = res.steps.find((s) => s.layer === 'controller'), ctlUs = ctl ? ctl.dt : 0;
      const base = { o, total: res.total, diskMs: res.diskMs, blocks: res.blocks, misses: res.misses, soft: t.r3(res.total - ctlUs), diskUs: ctlUs, end: inp.offset + inp.bytes, sectors: res.misses.length * (bs / 512), bs };
      const seen = new Set();
      const pic = (k) => {
        const s = k >= 0 ? res.steps[k] : null, st = stack('lr', 0, 10, 300, s ? s.layer : 'user', seen, s ? s.proc : 'running');
        const items = [...st.items];
        if (s) items.push({ key: 'lr:tok', kind: 'token', x: 300 + 18, y: st.rowY(s.layer) + 16, r: 11, text: '', cls: 'req13' });
        // the process's state and the clock
        const ps = s ? s.proc : 'running';
        items.push(t.title('lr:pt', 360, 24, 'the reading process'));
        items.push({ key: 'lr:ps', kind: 'cell', x: 360, y: 36, w: 150, h: 36, rx: 6, text: ps, size: 15, cls: 'pstate ' + ps });
        items.push(t.text('lr:clock', 540, 60, 't = ' + (s ? t.fix(s.t + s.dt, 3) : 0) + ' µs', 'mono', 15));
        // the steps so far, newest last
        items.push(t.title('lr:st', 360, 112, 'steps so far, each one’s time'));
        const shown = res.steps.slice(0, k + 1).map((x, i) => ({ x, i })).slice(-9);
        shown.forEach(({ x, i }, j) => {
          const name = S.IO.layers.find((l) => l.id === x.layer).name;
          items.push({ key: 'lr:s' + i, kind: 'cell', x: 360, y: 124 + j * 34, w: 300, h: 28, rx: 4, text: name, size: 13, align: 'left', cls: 'op13' + (i === k ? ' act' : ' done') });
          items.push(t.text('lr:sv' + i, 790, 124 + j * 34 + 19, x.dt >= 1000 ? t.fix(x.dt / 1000, 3) + ' ms' : t.fix(x.dt, 3) + ' µs', 'mono' + (x.mode === 'device' ? ' act-t' : ''), 13, 'end'));
        });
        return items;
      };
      F.add({ items: pic(-1), title: 'the call', say: `The program will read ${inp.bytes} bytes of notes.txt from offset ${inp.offset}: file block${res.blocks.length === 1 ? '' : 's'} ${res.blocks.join(', ')} of ${bs} bytes, ${res.misses.length ? t.plural(res.misses.length, 'block') + ' not yet in memory' : 'all of them already in the page cache'}.`, meta: Object.assign({ phase: 'start' }, base) });
      res.steps.forEach((s, k) => {
        seen.add(s.layer);
        F.set('us', t.r3(s.t + s.dt));
        const ratio = s.layer === 'controller' && s.t > 0 ? R(s.dt / s.t) : null;
        F.add({ items: pic(k), title: S.IO.layers.find((l) => l.id === s.layer).name, say: s.say, meta: Object.assign({ phase: s.layer, k, at: s.t, dt: s.dt, after: t.r3(s.t + s.dt), ratio, step: { hits: s.hits, misses: s.misses, disk: s.disk, diskMs: s.diskMs }, kib: t.r3(inp.bytes / 1024) }, base) });
      });
      F.add({ items: pic(res.steps.length - 1), title: 'totals', say: res.say, meta: Object.assign({ phase: 'done' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Down and back up', text: ['user:    program → C library → trap', 'kernel:  VFS: descriptor → open file → inode', '         page cache: hit? copy and return', '         file system: file block → disk block', '         block layer: queue, merge, schedule', '         driver: program the controller; sleep', 'device:  seek, rotate, transfer (DMA)', 'kernel:  interrupt → complete → wake → run', '         copy to the user buffer; return'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'cache', once: true, pick: 'option', ask: 'Will this read go to the disk?', options: ['yes', 'no: the page cache has it all'], answer: (fr) => (fr[0].meta.misses.length ? 'yes' : 'no: the page cache has it all'), explain: (fr, i) => fr[i].say },
      { at: (f) => f.meta.phase === 'driver', once: true, pick: 'option', ask: 'Where does most of the time of this read go?', options: ['waiting for the disk', 'in the system call and VFS', 'copying to the user buffer'], answer: 'waiting for the disk', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'What does the process do while the disk works?', options: ['it sleeps, blocked; the CPU runs others', 'it polls the controller', 'it copies data', 'it runs in user mode'], answer: 0, why: 'The driver starts the disk and the process blocks until the interrupt wakes it.' },
      { q: 'Which layer finds the open file’s offset and inode from the descriptor?', options: ['VFS', 'the driver', 'the block layer', 'the C library'], answer: 0, why: 'The virtual file system works with descriptors, open files and inodes for every file system.' },
      { q: 'Which layer turns file block numbers into disk block numbers?', options: ['the file system', 'the block layer', 'the controller', 'VFS'], answer: 0, why: 'Only the file system knows its own layout: the inode’s pointers.' },
      { q: 'A read that hits in the page cache costs about…', options: ['microseconds: no disk at all', 'milliseconds', 'a full disk rotation', 'one seek'], answer: 0, why: 'The data is copied from memory; only the software path is paid.' },
    ],
  });

  // =================================================================================================================
  S.topic({
    id: 'io-driver', family: 'p13-read', order: 20, title: 'Device drivers: the top half and the bottom half',
    blurb: 'A driver is the only code that knows the device’s registers. The kernel calls it through a uniform interface (for a disk: take this request); it programs the controller and returns. When the device finishes, an interrupt runs the driver’s handler, which does the minimum at once and leaves the rest of the completion work to run soon after, with interrupts enabled again.',
    inputs: [
      { id: 'bytes', kind: 'number', label: 'bytes to read', def: 4096, min: 512, max: 65536 },
      { id: 'driver', kind: 'number', label: 'driver: start the request µs', def: 1.5, min: 0.1, max: 50, integer: false },
      { id: 'irq', kind: 'number', label: 'interrupt handler µs', def: 1.5, min: 0.1, max: 50, integer: false },
      { id: 'bottom', kind: 'number', label: 'deferred completion µs', def: 2, min: 0.1, max: 100, integer: false },
    ],
    presets: [
      { label: 'One block', values: { bytes: 4096, driver: 1.5, irq: 1.5, bottom: 2 } },
      { label: 'A large read', values: { bytes: 65536, driver: 2, irq: 1.5, bottom: 6 } },
      { label: 'A heavy handler', values: { bytes: 4096, driver: 1.5, irq: 12, bottom: 2 } },
    ],
    counters: [{ id: 'us', label: 'µs in the driver' }],
    run(inp) {
      const t = S.T12, F = new S.Frames(['us']);
      const n = Math.ceil(inp.bytes / 4096), blocks = {}; for (let i = 0; i < n; i++) blocks[i] = 812 + i;
      const res = S.IO.lifeOfRead({ file: 'notes.txt', fd: 3, bytes: inp.bytes, offset: 0, blockSize: 4096, blocks, cached: false, cost: { driver: inp.driver, irq: inp.irq, bottom: inp.bottom } });
      const want = ['block', 'driver', 'controller', 'interrupt', 'scheduler'];
      const steps = res.steps.filter((s) => want.includes(s.layer));
      const H = S.IO.handshake(0x20);
      const base = { total: res.total, diskMs: res.diskMs, n, inp };
      const ENTRY = [['submit', 'take a request from the block layer'], ['program', 'start: write sector, count, DMA address'], ['irq', 'handler: acknowledge, mark the request done'], ['complete', 'deferred: pages ready, wake the waiters']];
      const which = (s, j) => (s.layer === 'block' ? 'submit' : s.layer === 'driver' ? 'program' : s.layer === 'interrupt' && j === 0 ? 'irq' : s.layer === 'interrupt' ? 'complete' : null);
      let inDriver = 0, irqSeen = 0;
      const pic = (s, entry, ctx) => {
        const items = [];
        items.push({ key: 'dv:k', kind: 'cell', x: 0, y: 10, w: 800, h: 44, rx: 6, text: 'the kernel: block layer, file systems, the scheduler', size: 14, cls: 'ly kernel' + (s && (s.layer === 'block' || s.layer === 'scheduler') ? ' act' : '') });
        items.push({ key: 'dv:box', kind: 'region', x: 0, y: 80, w: 800, h: 250, rx: 10, cls: 'band13' });
        items.push(t.text('dv:bt', 16, 104, 'the disk driver', 'strong', 15));
        items.push(t.text('dv:top', 16, 134, 'called by the kernel, in the process’s context', 'tick' + (ctx === 'top' ? ' act-t' : ''), 13));
        ENTRY.slice(0, 2).forEach(([id, txt], j) => items.push({ key: 'dv:e' + id, kind: 'cell', x: 16 + j * 392, y: 146, w: 376, h: 40, rx: 5, text: txt, size: 13, cls: 'ent13' + (entry === id ? ' act' : '') }));
        items.push(t.text('dv:bot', 16, 222, 'run by the interrupt, in no process’s context', 'tick' + (ctx === 'bottom' ? ' act-t' : ''), 13));
        ENTRY.slice(2).forEach(([id, txt], j) => items.push({ key: 'dv:e' + id, kind: 'cell', x: 16 + j * 392, y: 234, w: 376, h: 40, rx: 5, text: txt, size: 13, cls: 'ent13' + (entry === id ? ' act' : '') }));
        items.push(t.text('dv:h', 16, 304, 'top half: as little as possible, interrupts held off · bottom half: the rest, deferred', 'tick', 13));
        // the controller and its registers, and the disk
        const regs = ['status', 'command', 'sector', 'count', 'DMA address'];
        items.push({ key: 'dv:c', kind: 'region', x: 0, y: 356, w: 800, h: 92, rx: 8, cls: 'band13' });
        items.push(t.text('dv:ct', 16, 380, 'the disk controller', 'strong', 14));
        regs.forEach((r, j) => items.push({ key: 'dv:r' + j, kind: 'cell', x: 16 + j * 156, y: 394, w: 146, h: 36, rx: 4, text: r, size: 13, cls: 'reg' + ((entry === 'program' && j > 0) || (entry === 'irq' && j === 0) ? ' lit' : s && s.layer === 'controller' ? ' dev' : '') }));
        items.push({ key: 'dv:w1', kind: 'line', x1: 400, y1: 54, x2: 400, y2: 80, cls: 'drop13' + (entry === 'submit' || entry === 'complete' ? ' lit' : ''), audit: 'ignore' });
        items.push({ key: 'dv:w2', kind: 'line', x1: 400, y1: 330, x2: 400, y2: 356, cls: 'drop13' + (entry === 'program' || entry === 'irq' ? ' lit' : ''), audit: 'ignore' });
        return items;
      };
      F.add({ items: pic(null, null, null), title: 'the driver', say: `A read of ${inp.bytes} bytes that misses the cache reaches the disk driver. It has two halves: the code the kernel calls to start a request, and the code an interrupt runs when the disk is done. Only the driver touches the controller’s registers, as in the ${H.steps.length}-step handshake of [[io-registers]].`, meta: Object.assign({ phase: 'start', hs: H.steps.length }, base) });
      steps.forEach((s, j) => {
        const e = which(s, irqSeen);
        if (s.layer === 'interrupt') irqSeen++;
        if (s.layer === 'driver' || s.layer === 'interrupt') inDriver = t.r3(inDriver + s.dt);
        F.set('us', inDriver);
        const ctx = s.layer === 'driver' ? 'top' : s.layer === 'interrupt' ? 'bottom' : null;
        F.add({ items: pic(s, e, ctx), title: e || s.layer, say: s.say + (s.layer === 'driver' || s.layer === 'interrupt' ? ` (${t.fix(s.dt, 3)} µs.)` : ''), meta: Object.assign({ phase: s.layer, dt: s.dt, at: s.t, inDriver, ratio: s.layer === 'controller' && s.t > 0 ? R(s.dt / s.t) : null, sectors: n * 8, step: { diskMs: s.diskMs } }, base) });
      });
      F.add({ items: pic(null, null, null), title: 'totals', say: `The driver ran ${inDriver} µs of the ${res.total} µs the read took; the disk itself took ${res.diskMs} ms. The same split, a quick part that starts the device and a quick part on the interrupt, is how every driver keeps the CPU free while its device works.`, meta: Object.assign({ phase: 'done', inDriver }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'A driver', text: ['knows: the controller’s registers and quirks', 'offers: the kernel’s interface for its class', '  block: submit a request; complete it', '  character: open, read, write, ioctl', '  network: send a packet; receive on interrupt', 'top half: in the interrupt, minimal', 'bottom half: deferred work, interrupts on'].join('\n') }, { id: 't', kind: 'text', text: 'The whole path of the read: [[io-life-of-read]].' }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'driver', pick: 'option', ask: 'After the driver starts the disk, what does it do until the disk is done?', options: ['nothing: it returns and the process sleeps', 'it polls the status register', 'it copies the data byte by byte'], answer: 'nothing: it returns and the process sleeps', explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'Why is an interrupt handler split into a top and a bottom half?', options: ['to keep the time with interrupts held off short', 'to use two CPUs', 'to save memory', 'because the disk needs two interrupts'], answer: 0, why: 'Long work in the handler would delay every other interrupt; the rest is deferred.' },
      { q: 'What does a uniform driver interface give the kernel?', options: ['one way to use every device of a class, whatever its make', 'faster devices', 'no need for interrupts', 'direct access for programs'], answer: 0, why: 'The block layer submits requests the same way to any disk driver.' },
      { q: 'Which code writes the controller’s registers?', options: ['the driver', 'the file system', 'the program', 'the C library'], answer: 0, why: 'Only the driver knows the device’s registers.' },
      { q: 'In which context does the top half of an interrupt handler run?', options: ['no process’s: it interrupted whatever was running', 'the reading process’s', 'the init process’s', 'user mode'], answer: 0, why: 'An interrupt can arrive at any time, on top of any process.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
