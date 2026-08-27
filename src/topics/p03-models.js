// Part 3, ways for processes to talk, as concept models (S.Ipc): a named pipe (FIFO) with its open and read rules,
// shared memory as a ring buffer both sides use without the kernel, and message passing with its naming, blocking
// and buffering choices. Each process is a card with its list of operations and its place in it; between them,
// what they share: the FIFO's kernel buffer, the ring, or the message queues and mailboxes.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  /** a process as a card: its name and state, then its operations, the current one lit -> {items, h} */
  X.opCard = function (o) {
    const P = o.prefix, items = [], rh = 28, st = o.state === 'done' ? 'done' : o.state === 'blocked' ? 'blocked' : o.state === 'running' ? 'running' : 'ready';
    items.push(H.cell(P + ':h', o.x, o.y, o.w, 40, '', 'fdproc s-' + st + (o.act ? ' act' : ''), { lines: [o.name, o.sub || st], rx: 8 }));
    o.ops.forEach((t, k) => {
      const cls = k < o.pc ? 'opdone' : k === o.pc && st !== 'done' ? (st === 'blocked' ? 'opblk' : o.act ? 'opnow' : 'opnext') : 'op';
      items.push(H.cell(P + ':o' + k, o.x, o.y + 46 + k * (rh + 3), o.w, rh, t, 'opcell ' + cls, { rx: 5, size: 13, align: 'left' }));
    });
    return { items, h: 46 + o.ops.length * (rh + 3) };
  };
  const q = (s) => '"' + s + '"';

  // ---------------------------------------------------------------------------------------------------------------
  // Named pipes
  // ---------------------------------------------------------------------------------------------------------------
  const FIFO = {
    basic: { label: 'the writer opens first and waits for a reader', procs: [
      { name: 'W', ops: [{ op: 'mkfifo', path: '/tmp/q' }, { op: 'open', path: '/tmp/q', mode: 'w' }, { op: 'write', data: 'ten apples' }, { op: 'close' }] },
      { name: 'R', ops: [{ op: 'open', path: '/tmp/q', mode: 'r' }, { op: 'read', n: 4 }, { op: 'read', n: 8 }, { op: 'read', n: 8 }, { op: 'close' }] }] },
    small: { label: 'a small buffer: the writer waits for room', cap: 4, procs: [
      { name: 'W', ops: [{ op: 'mkfifo', path: '/tmp/q' }, { op: 'open', path: '/tmp/q', mode: 'w' }, { op: 'write', data: 'abcd' }, { op: 'write', data: 'efgh' }, { op: 'close' }] },
      { name: 'R', ops: [{ op: 'open', path: '/tmp/q', mode: 'r' }, { op: 'read', n: 3 }, { op: 'read', n: 3 }, { op: 'read', n: 3 }, { op: 'read', n: 3 }, { op: 'close' }] }] },
    epipe: { label: 'the reader leaves early: SIGPIPE', procs: [
      { name: 'W', ops: [{ op: 'mkfifo', path: '/tmp/q' }, { op: 'open', path: '/tmp/q', mode: 'w' }, { op: 'write', data: 'one' }, { op: 'write', data: 'two' }, { op: 'write', data: 'six' }, { op: 'close' }] },
      { name: 'R', ops: [{ op: 'open', path: '/tmp/q', mode: 'r' }, { op: 'read', n: 3 }, { op: 'close' }] }] },
    nonblock: { label: 'a non-blocking open with no reader', procs: [
      { name: 'W', ops: [{ op: 'mkfifo', path: '/tmp/q' }, { op: 'open', path: '/tmp/q', mode: 'w', nonblock: true }, { op: 'open', path: '/tmp/q', mode: 'w' }, { op: 'write', data: 'late' }, { op: 'close' }, { op: 'unlink', path: '/tmp/q' }] },
      { name: 'R', ops: [{ op: 'work' }, { op: 'work' }, { op: 'open', path: '/tmp/q', mode: 'r' }, { op: 'read', n: 8 }, { op: 'read', n: 8 }, { op: 'close' }] }] },
  };
  X.FIFO = FIFO;
  const fifoOp = (o) => (o.op === 'mkfifo' ? 'mkfifo ' + o.path : o.op === 'open' ? 'open ' + o.path + ' ' + (o.mode === 'w' ? 'w' : 'r') + (o.nonblock ? ' (no wait)' : '') : o.op === 'write' ? 'write ' + q(o.data) : o.op === 'read' ? 'read ' + o.n : o.op === 'unlink' ? 'unlink ' + o.path : o.op === 'work' ? 'compute' : o.op);

  S.topic({
    id: 'p03-fifo', family: 'p03-pipes', order: 40, title: 'Named pipes',
    blurb: 'A pipe made by pipe() has no name, so only a process and its children can share it. mkfifo gives a pipe a name in the file system, so any two processes can open it. Opening it for reading waits for a writer, and opening it for writing waits for a reader; after that it behaves like any pipe, its bytes held in a kernel buffer, never on the disk.',
    inputs: [
      { id: 'scene', kind: 'choice', label: 'Scenario', def: 'basic', options: Object.keys(FIFO).map((k) => ({ value: k, label: FIFO[k].label })) },
      { id: 'cap', kind: 'slider', label: 'Buffer (bytes)', def: 8, min: 2, max: 16, step: 1 },
      { id: 'policy', kind: 'choice', label: 'Who moves next', def: 'rr', options: [{ value: 'rr', label: 'take turns' }, { value: 'random', label: 'at random (seeded)' }] },
      { id: 'seed', kind: 'slider', label: 'Seed', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'Writer first, reader later', values: { scene: 'basic', cap: 8, policy: 'rr' } },
      { label: 'A 4-byte buffer', values: { scene: 'small', cap: 4, policy: 'rr' } },
      { label: 'The reader leaves early', values: { scene: 'epipe', cap: 8, policy: 'rr' } },
      { label: 'Do not wait for a reader', values: { scene: 'nonblock', cap: 8, policy: 'rr' } },
      { label: 'A random order', values: { scene: 'basic', cap: 8, policy: 'random', seed: 7 } },
    ],
    counters: [{ id: 'bytes', label: 'bytes read' }, { id: 'waits', label: 'waits' }],
    run(inp) {
      const sc = FIFO[inp.scene];
      const r = S.Ipc.fifo({ capacity: inp.cap, procs: sc.procs, policy: inp.policy, seed: inp.seed });
      const F = new S.Frames(['bytes', 'waits']);
      const names = sc.procs.map((p) => p.name);
      let waits = 0, prevGot = 0;
      const W = 820, cardW = 200, mx = 240, mw = 340;
      r.steps.forEach((s) => {
        if (s.kind === 'block') waits++;
        const items = [];
        sc.procs.forEach((p, i) => {
          const ps = s.procs[p.name];
          items.push(...X.opCard({ prefix: 'c' + p.name, x: i ? W - cardW : 0, y: 0, w: cardW, name: p.name + (i ? ' · reader' : ' · writer'), state: ps.state, sub: ps.state + (ps.open ? ' · ' + ps.open : ''), ops: p.ops.map(fifoOp), pc: ps.pc, act: s.who === p.name }).items);
        });
        const pp = s.pipes['/tmp/q'] || { exists: false, buffer: '', readers: 0, writers: 0 };
        items.push(H.title('dt', mx, 14, 'the directory'));
        items.push(H.cell('dir', mx, 26, mw, 34, pp.exists ? '/tmp/q · FIFO, no data blocks' : '/tmp/q · not there', pp.exists ? 'oftext' : 'oftext muted', { rx: 6 }));
        items.push(H.title('kt', mx, 94, 'in the kernel'));
        items.push(H.cell('rd', mx, 106, mw / 2 - 4, 30, 'readers ' + pp.readers, 'fdcell of-pr', { rx: 6 }), H.cell('wr', mx + mw / 2 + 4, 106, mw / 2 - 4, 30, 'writers ' + pp.writers, 'fdcell of-pw', { rx: 6 }));
        items.push(...S.Kit.fd.pipe({ prefix: 'bf', x: mx, y: 148, w: mw, name: 'buffer', buf: pp.buffer, cap: inp.cap, cls: /write|read|eof/.test(s.kind) ? 'act' : '' }).items);
        const got = s.procs[names[1]].got, delta = got.length - prevGot;
        prevGot = got.length;
        items.push(H.text('got', mx, 206, names[1] + ' has read ' + (got ? q(got) : 'nothing yet'), 'strong', 14));
        F.set('bytes', got.length).set('waits', waits);
        const ps = Object.fromEntries(names.map((n) => [n, { pc: s.procs[n].pc, state: s.procs[n].state, got: s.procs[n].got.length, ops: sc.procs[names.indexOf(n)].ops.length }]));
        F.add({ items, say: s.kind === 'work' ? s.who + ' computes for a while, not touching the pipe.' : s.say, meta: { phase: s.kind, who: s.who, delta, n: pp.buffer.length, cap: inp.cap, readers: pp.readers, writers: pp.writers, procs: ps, ops: sc.procs.map((p) => p.ops.map((o) => o.n || (o.data || '').length)) }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'A named pipe', text: ['mkfifo: a name, no data blocks', 'open r: wait for a writer', 'open w: wait for a reader', '  (no wait: fails, ENXIO)', 'read empty: wait, or 0 at EOF', 'write, no reader: SIGPIPE', 'unlink: removes the name'].join('\n') }] };
      return { frames: F.list, def, result: { got: r.got, deadlock: r.deadlock } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.who === 'R' && /^(read|eof|block)$/.test(fr[i + 1].meta.phase) && f.meta.procs.R && f.meta.procs.R.pc >= 1 && f.meta.procs.R.state !== 'blocked', pick: 'option', ask: 'R reads next. What happens?', options: ['it gets bytes', 'it waits: empty, a writer still open', 'end of file: empty, no writer'], answer: (fr, i) => ({ read: 'it gets bytes', block: 'it waits: empty, a writer still open', eof: 'end of file: empty, no writer' })[fr[i + 1].meta.phase], explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'What does a FIFO have that a pipe from pipe() does not?', options: ['a name in the file system, so unrelated processes can open it', 'a bigger buffer', 'its data on disk', 'two directions'], answer: 0, why: 'Otherwise the two are the same kind of kernel buffer.' },
      { q: 'A process opens a FIFO for reading and no one has it open for writing. What happens?', options: ['the open waits until a writer opens it', 'it fails', 'it reads end of file at once', 'it creates a writer'], answer: 0, why: 'Each side\'s open waits for the other.' },
      { q: 'Where are a FIFO\'s bytes kept?', options: ['in a kernel buffer; the file system holds only the name', 'in the file\'s data blocks', 'in the writer\'s memory', 'in swap'], answer: 0, why: 'The name is an inode of type FIFO with no data blocks.' },
      { q: 'The reader closes its end and the writer writes again. What does the writer get?', options: ['SIGPIPE, or the error EPIPE if it ignores that signal', 'end of file', 'the write waits', 'nothing happens'], answer: 0, why: 'No one can ever read those bytes.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Shared memory
  // ---------------------------------------------------------------------------------------------------------------
  const ITEMS = 'apple fig kiwi lime pear plum date'.split(' ');
  S.topic({
    id: 'p03-shm', family: 'p03-models', order: 10, title: 'Shared memory: a ring both can see',
    blurb: 'With shared memory the kernel is needed only once, to map one region into both processes. After that the producer writes items straight into slots and the consumer reads them out, with no system call and no copy. The price: the processes must coordinate themselves. Here they share a ring with two indexes, in and out; one slot is always left empty so that full and empty look different, and a side that cannot go on spins.',
    inputs: [
      { id: 'size', kind: 'slider', label: 'Slots', def: 4, min: 2, max: 8, step: 1 },
      { id: 'n', kind: 'slider', label: 'Items', def: 5, min: 1, max: 7, step: 1 },
      { id: 'quantum', kind: 'slider', label: 'Steps a turn', def: 2, min: 1, max: 5, step: 1 },
      { id: 'policy', kind: 'choice', label: 'Who moves next', def: 'rr', options: [{ value: 'rr', label: 'take turns' }, { value: 'random', label: 'at random (seeded)' }] },
      { id: 'seed', kind: 'slider', label: 'Seed', def: 3, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'Four slots, five items', values: { size: 4, n: 5, quantum: 2, policy: 'rr' } },
      { label: 'A fast producer fills the ring', values: { size: 3, n: 6, quantum: 4, policy: 'rr' } },
      { label: 'Two slots: one usable', values: { size: 2, n: 4, quantum: 2, policy: 'rr' } },
      { label: 'A random order', values: { size: 4, n: 7, quantum: 1, policy: 'random', seed: 11 } },
    ],
    counters: [{ id: 'spins', label: 'turns wasted spinning' }, { id: 'sys', label: 'system calls' }],
    run(inp) {
      const items = ITEMS.slice(0, inp.n);
      const r = S.Ipc.shm({ size: inp.size, items, policy: inp.policy, quantum: inp.quantum, seed: inp.seed });
      const cost = S.Ipc.compare({ items: inp.n, size: 64 });
      const F = new S.Frames(['spins', 'sys']);
      const cx = 410, cy = 170, R = 96;
      let spins = 0, made = 0, used = 0;
      r.steps.forEach((s, i) => {
        if (s.kind === 'spin') spins++;
        if (s.kind === 'put') made++;
        if (s.kind === 'take') used++;
        const its = [];
        its.push(...S.Kit.sync.ring({ prefix: 'rg', cx, cy, R, slots: s.buffer, inAt: s.in, outAt: s.out, cw: 58, ch: 34, act: s.kind === 'put' ? (s.in + inp.size - 1) % inp.size : s.kind === 'take' ? (s.out + inp.size - 1) % inp.size : undefined }).items);
        const card = (key, x, name, list, k, who) => {
          its.push(H.cell(key + 'h', x, 20, 190, 40, '', 'fdproc ' + (s.who === who ? (s.kind === 'spin' ? 's-blocked act' : 's-running act') : 's-ready'), { lines: [name, s.who === who && s.kind === 'spin' ? 'spinning' : who === 'producer' ? made + ' of ' + items.length + ' written' : used + ' of ' + items.length + ' read'], rx: 8 }));
          list.forEach((t, j) => its.push(H.cell(key + j, x, 68 + j * 30, 190, 26, t, 'opcell ' + (j < k ? 'opdone' : j === k ? 'opnext' : 'op'), { rx: 5, align: 'left' })));
        };
        card('pr', 0, 'producer', items.map((t) => 'put ' + q(t)), made, 'producer');
        card('co', 630, 'consumer', items.map((t, j) => 'take' + (j < used ? ' → ' + q(r.consumed[j]) : '')), used, 'consumer');
        its.push(H.text('io', cx, cy + R + 100, 'in = ' + s.in + '  ·  out = ' + s.out + '  ·  items in the ring: ' + s.count, 'strong', 14, 'middle'));
        F.set('spins', spins).set('sys', cost.rows[0].syscalls);
        if (i === r.steps.length - 1) {
          const t = H.table({ prefix: 'ct', x: 40, y: cy + R + 136, cols: [{ w: 170, label: 'for ' + inp.n + ' items of 64 bytes' }, { w: 130, label: 'system calls' }, { w: 150, label: 'bytes copied' }, { w: 290, label: 'who synchronises' }], rows: cost.rows.map((c) => [c.model, String(c.syscalls), String(c.bytesCopied), c.sync.replace(/ \(.*\)/, '')]), size: 13 });
          its.push(...t.items);
        }
        F.add({ items: its, say: s.say.replace('(two system calls, once)', '(' + cost.rows[0].syscalls + ' system calls, once: creating and mapping it, on each side)').replace(/(\d) equals /, '$1, which equals ').replace(/\b1 items\b/, '1 item') + (i === r.steps.length - 1 ? ' The same ' + H.plural(inp.n, 'item') + ' as messages would take ' + cost.rows[1].syscalls + ' system calls and copy ' + cost.rows[1].bytesCopied + ' bytes through the kernel.' : ''), meta: { phase: s.kind, sys: cost.rows[0].syscalls, slot: s.kind === 'put' ? (s.in + inp.size - 1) % inp.size : s.kind === 'take' ? (s.out + inp.size - 1) % inp.size : -1, in: s.in, out: s.out, count: s.count, size: inp.size, usable: inp.size - 1, n: inp.n, spins: r.spins, made, used, cost: cost.rows.map((c) => [c.syscalls, c.copies, c.bytesCopied]) }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The ring', text: ['put: slot[in] = item;', '  in = (in + 1) % size', 'take: item = slot[out];', '  out = (out + 1) % size', 'empty: in == out', 'full: (in + 1) % size == out', '  so size − 1 slots are usable'].join('\n') }] };
      return { frames: F.list, def, result: { consumed: r.consumed, spins: r.spins, cost } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase !== 'end' && f.meta.phase !== 'setup' && fr[i + 1].meta.phase === 'spin', pick: 'option', ask: 'The next turn spins. Which side, and why?', options: ['the producer: the ring is full', 'the consumer: the ring is empty'], answer: (fr, i) => (fr[i + 1].meta.count === fr[i + 1].meta.usable ? 'the producer: the ring is full' : 'the consumer: the ring is empty'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'After the region is mapped, how many system calls does passing one item through shared memory take?', options: ['none', 'one write and one read', 'two', 'it depends on the size'], answer: 0, why: 'Both processes read and write the memory directly.' },
      { q: 'A ring of 5 slots with in and out indexes holds at most how many items?', options: ['4', '5', '6', '2'], answer: 0, why: 'One slot stays empty, or full and empty would both look like in == out.' },
      { q: 'What does message passing give that raw shared memory does not?', options: ['the kernel does the waiting and the copying for you', 'speed', 'no system calls', 'a bigger buffer'], answer: 0, why: 'A receive blocks until a message arrives; with shared memory the program must arrange that itself.' },
      { q: 'Why is spinning wasteful?', options: ['the spinning side uses CPU turns that do no work', 'it loses items', 'it corrupts the ring', 'it needs a system call'], answer: 0, why: 'A blocking wait (a semaphore, a futex) would let the other side run instead.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
