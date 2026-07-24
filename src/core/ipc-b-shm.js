// IPC models, part 2: shared memory as the contrast to message passing, and named pipes (FIFOs) as a concept.
//   S.Ipc.shm({size: 4, items: ['a', 'b', ...], consume: n, policy: 'rr' | 'random', quantum: 2, seed})
//       A producer and a consumer share a circular buffer of `size` slots with indexes in and out, set up once
//       by the kernel and then used with no system calls. Full when (in + 1) % size == out (so it holds size − 1
//       items), empty when in == out; each side busy-waits (spins) while it cannot go on.
//       -> {steps: [{kind, who, say, buffer, in, out, count}], consumed: [..], spins: {producer, consumer}}
//   S.Ipc.compare({items: n, size: bytes per item})
//       -> {rows: [{model, syscalls, copies, bytesCopied, sync}], say}: what n items cost each way.
//   S.Ipc.fifo({capacity: 8, procs: [{name, ops}], policy, seed, order})
//       ops: {op: 'work', ticks} | {op: 'mkfifo', path} | {op: 'open', path, mode: 'r' | 'w', nonblock?} | {op: 'write', data} |
//            {op: 'read', n} | {op: 'close'} | {op: 'unlink', path}
//       Opening for reading blocks until some process opens for writing, and the other way round; read blocks
//       while the pipe is empty and a writer still has it open, and returns 0 (end of file) once every writer
//       has closed; write blocks while the pipe is full and fails with EPIPE (the writer gets SIGPIPE) when no
//       reader has it open. The name stays in the directory until unlink; the data never touches the disk.
//       -> {steps (each with pipe: {path, exists, buffer, readers, writers}, procs), got: {name: text}, deadlock}
(function (S) {
  'use strict';
  const I = (S.Ipc = S.Ipc || {});

  I.shm = function (o) {
    o = o || {};
    const N = Math.max(2, o.size || 4), items = o.items || ['a', 'b', 'c', 'd', 'e', 'f'], want = o.consume === undefined ? items.length : o.consume;
    const buffer = Array(N).fill(null), steps = [], consumed = [], spins = { producer: 0, consumer: 0 };
    let inn = 0, out = 0, produced = 0, t = 0;
    const q = Math.max(1, o.quantum || 2), max = o.max || 400;
    const rand = o.policy === 'random' ? S.Os.rng(o.seed === undefined ? 1 : o.seed) : null;
    const add = (kind, who, say) => steps.push({ kind, who, say, buffer: buffer.slice(), in: inn, out, count: (inn - out + N) % N, t });
    add('setup', null, 'The kernel maps one region of ' + I.plural(N, 'slot') + ' into both processes (two system calls, once); in = out = 0. From now on neither side needs the kernel.');
    let who = 'producer', left = q;
    while ((produced < items.length || consumed.length < want) && t < max) {
      t++;
      if (who === 'producer' && produced < items.length) {
        if ((inn + 1) % N === out) { spins.producer++; add('spin', 'producer', 'Producer: (in + 1) % ' + N + ' = ' + ((inn + 1) % N) + ' equals out = ' + out + ', so the buffer is full; it spins, wasting its turn.'); }
        else { buffer[inn] = items[produced]; const say = 'Producer writes "' + items[produced] + '" straight into slot ' + inn + ' and sets in = ' + ((inn + 1) % N) + '. No system call, no copy through the kernel.'; inn = (inn + 1) % N; produced++; add('put', 'producer', say); }
      } else if (who === 'consumer' && consumed.length < want) {
        if (inn === out) { spins.consumer++; add('spin', 'consumer', 'Consumer: in = out = ' + out + ', so the buffer is empty; it spins.'); }
        else { const x = buffer[out]; buffer[out] = null; consumed.push(x); const say = 'Consumer reads "' + x + '" from slot ' + out + ' and sets out = ' + ((out + 1) % N) + '.'; out = (out + 1) % N; add('take', 'consumer', say); }
      } else left = 1;
      left--;
      const other = who === 'producer' ? 'consumer' : 'producer';
      if (rand) who = rand() < 0.5 ? 'producer' : 'consumer';
      else if (left <= 0) { who = other; left = q; }
      if (produced >= items.length && who === 'producer') who = 'consumer';
      if (consumed.length >= want && who === 'consumer') who = 'producer';
    }
    add('end', null, 'Done: ' + I.plural(consumed.length, 'item') + ' passed through ' + I.plural(N - 1, 'usable slot') + ', with ' + I.plural(spins.producer, 'producer spin') + ' and ' + I.plural(spins.consumer, 'consumer spin') + '; the processes did all the synchronisation themselves.');
    return { steps, consumed, spins };
  };

  I.compare = function (o) {
    o = o || {};
    const n = Math.max(0, o.items === undefined ? 100 : o.items), b = Math.max(1, o.size || 64);
    const rows = [
      { model: 'shared memory', syscalls: 4, copies: 0, bytesCopied: 0, sync: 'the processes themselves (locks, semaphores or spinning)' },
      { model: 'message passing', syscalls: 2 * n, copies: 2 * n, bytesCopied: 2 * n * b, sync: 'the kernel (send and receive block)' },
    ];
    const say = I.plural(n, 'item') + ' of ' + I.plural(b, 'byte') + ': shared memory needs 4 system calls to set up (create and map, on each side) and copies nothing through the kernel; message passing needs ' + I.plural(2 * n, 'system call') + ' and copies ' + I.plural(2 * n * b, 'byte') + ' (into the kernel and out again), but the kernel does the synchronising.';
    return { rows, say };
  };

  I.fifo = function (o) {
    o = o || {};
    const cap = Math.max(1, o.capacity || 8), fifos = {}, got = {}, opened = {};
    const fd = (p) => opened[p.name];
    for (const p of o.procs || []) got[p.name] = '';
    const snap = (ps) => ({
      pipes: Object.fromEntries(Object.entries(fifos).map(([k, f]) => [k, { exists: f.exists, buffer: f.buf, readers: f.r, writers: f.w }])),
      procs: Object.fromEntries(ps.map((p) => [p.name, { state: p.state, pc: p.pc, open: opened[p.name] ? opened[p.name].path + ' (' + opened[p.name].mode + ')' : null, got: got[p.name] }])),
    });
    const exec = (p, op, retry, all) => {
      const f = op.path ? fifos[op.path] : fd(p) && fifos[fd(p).path];
      switch (op.op) {
        case 'work': { const n = op.ticks || 1; return { ok: true, say: p.name + ' does other work for ' + I.plural(n, 'tick') + ', touching no pipe.' }; }
        case 'mkfifo':
          if (fifos[op.path] && fifos[op.path].exists) return { ok: true, kind: 'error', say: p.name + ': mkfifo ' + op.path + ' fails with EEXIST: the name is taken.' };
          fifos[op.path] = { exists: true, buf: '', r: 0, w: 0, path: op.path };
          return { ok: true, say: p.name + ' runs mkfifo ' + op.path + ': a new name in the directory, of type FIFO, with no data blocks.' };
        case 'unlink':
          if (!f || !f.exists) return { ok: true, kind: 'error', say: p.name + ': unlink ' + op.path + ' fails with ENOENT.' };
          f.exists = false;
          return { ok: true, say: p.name + ' unlinks ' + op.path + ': the name goes, but processes that have it open keep using it.' };
        case 'open': {
          if (!f || !f.exists) return { ok: true, kind: 'error', say: p.name + ': open ' + op.path + ' fails with ENOENT: run mkfifo first.' };
          const other = op.mode === 'r' ? f.w : f.r;
          if (!retry) { opened[p.name] = { path: op.path, mode: op.mode, pending: true }; if (op.mode === 'r') f.r++; else f.w++; }
          if (other > 0) {
            opened[p.name].pending = false;
            // wake a partner that was waiting in open
            for (const q of all) { const d = opened[q.name]; if (q !== p && q.state === 'blocked' && d && d.pending && d.path === op.path && d.mode !== op.mode) { d.pending = false; q.completed = { say: q.name + '\'s open of ' + op.path + ' for ' + (d.mode === 'r' ? 'reading' : 'writing') + ' completes now that ' + p.name + ' opened the other end.' }; } }
            return { ok: true, say: p.name + ' opens ' + op.path + ' for ' + (op.mode === 'r' ? 'reading' : 'writing') + '; the other end is open, so it goes on. Readers ' + f.r + ', writers ' + f.w + '.' };
          }
          if (op.nonblock) {
            if (op.mode === 'r') { opened[p.name].pending = false; return { ok: true, say: p.name + ' opens ' + op.path + ' for reading with O_NONBLOCK: it returns at once even with no writer.' }; }
            f.w--; delete opened[p.name];
            return { ok: true, kind: 'error', say: p.name + '\'s non-blocking open of ' + op.path + ' for writing fails with ENXIO: no reader has it open.' };
          }
          if (retry) return { wait: true };
          return { block: true, say: p.name + ' opens ' + op.path + ' for ' + (op.mode === 'r' ? 'reading' : 'writing') + ' and blocks until some process opens it for ' + (op.mode === 'r' ? 'writing' : 'reading') + '.' };
        }
        case 'write': {
          const d = fd(p);
          if (!d || d.mode !== 'w') return { ok: true, kind: 'error', say: p.name + ': write fails with EBADF: it has no FIFO open for writing.' };
          if (f.r === 0) return { ok: true, kind: 'sigpipe', say: p.name + ' writes "' + op.data + '" but no process has ' + d.path + ' open for reading: write fails with EPIPE and ' + p.name + ' gets SIGPIPE.' };
          // a write larger than the free room puts in what fits and blocks for the rest
          const rest = p.rest === undefined ? op.data : p.rest, room = cap - f.buf.length, n = Math.min(room, rest.length);
          if (n === 0) { if (retry) return { wait: true }; return { block: true, say: p.name + ' wants to write ' + I.plural(rest.length, 'byte') + ' but the pipe is full (' + I.plural(cap, 'byte') + '), so it blocks.' }; }
          f.buf += rest.slice(0, n);
          if (n < rest.length) { p.rest = rest.slice(n); return { block: true, say: p.name + ' writes "' + rest.slice(0, n) + '", all that fits (' + f.buf.length + ' of ' + I.plural(cap, 'byte') + '), and blocks with "' + p.rest + '" still to write.' }; }
          p.rest = undefined;
          return { ok: true, say: p.name + ' writes "' + rest + '" into the pipe\'s kernel buffer, now ' + f.buf.length + ' of ' + I.plural(cap, 'byte') + (rest !== op.data ? ', finishing its write of "' + op.data + '"' : '') + '.' };
        }
        case 'read': {
          const d = fd(p);
          if (!d || d.mode !== 'r') return { ok: true, kind: 'error', say: p.name + ': read fails with EBADF: it has no FIFO open for reading.' };
          if (!f.buf.length) {
            if (f.w === 0) return { ok: true, kind: 'eof', say: p.name + ' reads: the pipe is empty and no writer has it open, so read returns 0, end of file.' };
            if (retry) return { wait: true };
            return { block: true, say: p.name + ' reads, but the pipe is empty and a writer still has it open, so it blocks.' };
          }
          const n = Math.min(op.n || cap, f.buf.length), x = f.buf.slice(0, n);
          f.buf = f.buf.slice(n); got[p.name] += x;
          return { ok: true, say: p.name + ' reads ' + n + ' byte' + (n > 1 ? 's' : '') + ', "' + x + '"; ' + f.buf.length + ' left in the pipe.' };
        }
        case 'close': {
          const d = fd(p);
          if (!d) return { ok: true, kind: 'error', say: p.name + ': close fails with EBADF.' };
          const g = fifos[d.path];
          if (d.mode === 'r') g.r--; else g.w--;
          delete opened[p.name];
          return { ok: true, say: p.name + ' closes its ' + (d.mode === 'r' ? 'read' : 'write') + ' end of ' + d.path + '. Readers ' + g.r + ', writers ' + g.w + '.' };
        }
      }
      return { ok: true, kind: 'error', say: p.name + ' tries ' + op.op + ', which this model does not know, and nothing happens.' };
    };
    const res = I.run(Object.assign({}, o, { procs: o.procs || [] }), exec, snap);
    return { steps: res.steps, got, deadlock: res.deadlock };
  };
})(globalThis.Proses = globalThis.Proses || {});
