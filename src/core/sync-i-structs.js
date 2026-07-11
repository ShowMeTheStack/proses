// Lock-based data structures on the thread-step machine: counters, a sorted linked list, a hash table and a queue,
// each in a coarse form (one lock) and a finer one, plus broken variants the model checker catches. Memory is plain
// arrays (node keys, next indices, -1 for none); node 0 of the list and of the queue is the dummy head.
//   S.Sync.structs.counter(variant, ops)  variant 'lock' | 'sloppy' (a local count per thread, added to the global
//     one under a lock every S increments: the global lags) | 'faa'; ops: [[n increments]..] one entry a thread
//   S.Sync.structs.list(variant, init, ops)  'coarse' | 'hoh' (hand-over-hand: hold the previous and the current
//     node's locks while moving on) | 'hoh-broken' (one lock at a time: the current node's lock is released before
//     the next one is taken); ops: [[{op: 'insert' | 'delete' | 'lookup', k, must}]..] per thread
//   S.Sync.structs.hash(variant, buckets, init, ops)  'coarse' | 'bucket' (a lock per bucket) | 'no-lock' (broken)
//   S.Sync.structs.queue(variant, ops)  'two-lock' (a head lock and a tail lock, with a dummy node) | 'one-lock';
//     ops: [[{op: 'enq', v} | {op: 'deq'}]..]
//   Each returns a machine spec with check (invariants, including what must hold at the end), expect, about, and
//   final(M) -> the structure's contents at the end. Every operation ends with a step marked 'progress'.
//   S.Sync.structs.workload(kind, variant, n, opsPerThread, seed, o) -> spec   seeded random operations for n threads
//   S.Sync.perf(spec, {seed}) -> {ticks, ops, steps, throughput, stepsPerOp, waitPerOp, blocked}
//     an ideal machine with one core per thread: each tick every ready thread takes one step (in a seeded order),
//     a blocked thread waits; throughput is operations per tick, waitPerOp the thread-ticks spent blocked per op
//   S.Sync.scaling(kind, variant, {threads: [1, 2, 4, 8], ops: 12, seed: 1, ...o}) -> [{n, ...perf}]  for curves
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const X = (Y.structs = {});
  const done = { op: 'local', fn: (r) => { r.ops = (r.ops || 0) + 1; }, label: 'operation done', mark: 'progress' };
  const L = (fn, label) => ({ op: 'local', fn, label: label || 'local work' });
  const J = (to, cond, label) => ({ op: 'jump', to, if: cond, label: label || 'branch' });
  const atEnd = (name, f) => ({ name, holds: (M) => M.status() !== 'done' || f(M) });

  // ---- counters --------------------------------------------------------------------------------------------------
  X.counter = function (variant, ops, o) {
    const v = variant || 'lock', S_ = (o && o.threshold) || 2, threads = [];
    ops.forEach((n, i) => {
      const prog = [];
      for (let j = 0; j < n; j++) {
        const q = 'i' + j + ':';
        if (v === 'faa') prog.push({ op: 'faa', v: 'g', by: 1, into: 'x', label: 'fetch_and_add(count, 1)' });
        else if (v === 'lock') prog.push({ op: 'lock', m: 'C', label: 'lock(c)' }, { op: 'read', v: 'g', into: 'x', label: 'x = count' }, L((r) => { r.x++; }, 'x = x + 1'), { op: 'write', v: 'g', val: (r) => r.x, label: 'count = x' }, { op: 'unlock', m: 'C', label: 'unlock(c)' });
        else prog.push(L((r) => { r.l = (r.l || 0) + 1; r.n = (r.n || 0) + 1; }, 'local++'), J(q + 'skip', (r) => r.l < S_, 'if local < S'), { op: 'lock', m: 'G', label: 'lock(global)' }, { op: 'read', v: 'g', into: 'x', label: 'x = global' }, { op: 'write', v: 'g', val: (r) => r.x + r.l, label: 'global = x + local' }, L((r) => { r.l = 0; }, 'local = 0'), { op: 'unlock', m: 'G', label: 'unlock(global)' }, { label: q + 'skip' });
        if (v !== 'sloppy') prog.push(L((r) => { r.n = (r.n || 0) + 1; }, 'counted'));
        prog.push(done);
      }
      if (v === 'sloppy') prog.push(J('end', (r) => !r.l, 'if nothing is left'), { op: 'lock', m: 'G', label: 'lock(global)' }, { op: 'read', v: 'g', into: 'x', label: 'x = global' }, { op: 'write', v: 'g', val: (r) => r.x + r.l, label: 'global = x + local: the last flush' }, L((r) => { r.l = 0; }, 'local = 0'), { op: 'unlock', m: 'G', label: 'unlock(global)' }, { label: 'end' });
      threads.push({ name: 'T' + i, prog });
    });
    const total = ops.reduce((a, b) => a + b, 0), counted = (M) => M.threads.reduce((s, th) => s + (th.reg.n || 0), 0);
    const spec = { threads, mutexes: v === 'lock' ? ['C'] : v === 'sloppy' ? ['G'] : [], vars: { g: 0 } };
    spec.check = { invariants: [atEnd('at the end the count is ' + total, (M) => M.vars.g === total)].concat(v === 'sloppy' ? [{ name: 'the global count never runs ahead, and lags by at most S per thread (S × threads in all)', holds: (M) => M.vars.g <= counted(M) && counted(M) - M.vars.g <= S_ * ops.length }] : []), liveness: [], deadlock: true };
    spec.expect = 'ok'; spec.expectLive = 'ok';
    spec.final = (M) => M.vars.g;
    spec.about = { lock: 'One lock around the counter: always exact, but every increment queues for the same lock.', sloppy: 'Each thread counts locally and adds to the global count every ' + S_ + ' increments: little contention, and the global value lags behind the true one.', faa: 'One atomic fetch-and-add per increment: exact, no lock, but every core still fights over one memory word.' }[v];
    return spec;
  };

  // ---- a sorted linked list ---------------------------------------------------------------------------------------
  /** the code of one list operation; q prefixes its labels; n is a free node for an insert */
  function listOp(v, q, op, n) {
    const k = op.k, coarse = v === 'coarse', broken = v === 'hoh-broken';
    const lockN = (w) => ({ op: 'lock', m: (r) => 'n' + r[w], label: 'lock(' + w + ')' }), unlockN = (w) => ({ op: 'unlock', m: (r) => 'n' + r[w], label: 'unlock(' + w + ')' });
    const readNext = (from, into) => ({ op: 'read', v: 'next', idx: (r) => r[from], into, label: into + ' = ' + from + '->next' });
    const readKey = { op: 'read', v: 'key', idx: (r) => r.c, into: 'kc', label: 'kc = c->key' };
    const hit = (r) => r.c !== -1 && r.kc === k;
    const act = [];
    if (op.op === 'insert') act.push(J(q + 'rel', hit, 'if ' + k + ' is there already'), { op: 'write', v: 'key', idx: n, val: k, label: 'node->key = ' + k }, { op: 'write', v: 'next', idx: n, val: (r) => r.c, label: 'node->next = c' }, { op: 'write', v: 'next', idx: (r) => r.p, val: n, label: 'p->next = node' });
    else if (op.op === 'delete') act.push(J(q + 'rel', (r) => !hit(r), 'if ' + k + ' is not there'), ...(broken ? [lockN('c')] : []), readNext('c', 'nn'), { op: 'write', v: 'next', idx: (r) => r.p, val: (r) => r.nn, label: 'p->next = c->next' }, ...(broken ? [unlockN('c')] : []));
    else act.push(L((r) => { r.found = hit(r) ? 1 : 0; }, 'found = (c->key == ' + k + ')'), ...(op.must ? [{ op: 'assert', label: 'lookup(' + k + ') finds it', reads: [], fn: (V, th) => th.reg.found === 1 }] : []));
    const reset = L((r) => { r.p = 0; r.kc = null; r.c = -1; r.nn = null; }, 'p = head');
    if (coarse) return [{ op: 'lock', m: 'L', label: 'lock(list)' }, reset, { label: q + 'loop' }, readNext('p', 'c'), J(q + 'act', (r) => r.c === -1, 'if c == NULL'), readKey, J(q + 'act', (r) => r.kc >= k, 'if c->key >= ' + k), L((r) => { r.p = r.c; }, 'p = c'), J(q + 'loop', null, 'next node'), { label: q + 'act' }, ...act, { label: q + 'rel' }, { op: 'unlock', m: 'L', label: 'unlock(list)' }, done];
    if (broken) return [reset, lockN('p'), { label: q + 'loop' }, readNext('p', 'c'), J(q + 'act', (r) => r.c === -1, 'if c == NULL'), readKey, J(q + 'act', (r) => r.kc >= k, 'if c->key >= ' + k), unlockN('p'), lockN('c'), L((r) => { r.p = r.c; }, 'p = c'), J(q + 'loop', null, 'next node'), { label: q + 'act' }, ...act, { label: q + 'rel' }, unlockN('p'), done];
    return [reset, lockN('p'), readNext('p', 'c'), J(q + 'act', (r) => r.c === -1, 'if c == NULL'), lockN('c'),
      { label: q + 'loop' }, readKey, J(q + 'act', (r) => r.kc >= k, 'if c->key >= ' + k),
      readNext('c', 'nx'), J(q + 'nl', (r) => r.nx === -1, 'if c->next == NULL'), lockN('nx'), { label: q + 'nl' }, unlockN('p'), L((r) => { r.p = r.c; r.c = r.nx; r.kc = null; }, 'p = c; c = next'),
      J(q + 'act', (r) => r.c === -1, 'if c == NULL'), J(q + 'loop', null, 'next node'),
      { label: q + 'act' }, ...act, { label: q + 'rel' }, J(q + 'nc', (r) => r.c === -1, 'if c == NULL'), unlockN('c'), { label: q + 'nc' }, unlockN('p'), done];
  }
  X.list = function (variant, init, ops) {
    const v = variant || 'coarse', keys = init.slice().sort((a, b) => a - b);
    const nIns = ops.flat().filter((x) => x.op === 'insert').length, N = 1 + keys.length + nIns;
    const key = Array(N).fill(null), next = Array(N).fill(-1);
    keys.forEach((k, i) => { key[i + 1] = k; next[i] = i + 1; });
    let free = keys.length + 1, b = 0;
    const threads = ops.map((list, i) => ({ name: 'T' + i, prog: list.flatMap((op) => listOp(v, 'o' + b++ + ':', op, op.op === 'insert' ? free++ : null)) }));
    const contents = (M) => { const out = []; let p = M.vars.next[0], g = 0; while (p !== -1 && g++ < N + 1) { out.push(M.vars.key[p]); p = M.vars.next[p]; } return out; };
    // what must be there at the end: the start, plus inserts, minus deletes (the scenarios use distinct keys)
    const want = new Set(keys);
    for (const op of ops.flat()) { if (op.op === 'insert') want.add(op.k); if (op.op === 'delete') want.delete(op.k); }
    const expected = [...want].sort((a, b) => a - b);
    const spec = { threads, mutexes: v === 'coarse' ? ['L'] : Array.from({ length: N }, (_, i) => 'n' + i), vars: { key, next } };
    spec.check = { invariants: [{ name: 'the list stays sorted', holds: (M) => contents(M).every((x, i, a) => i === 0 || a[i - 1] < x) }, atEnd('at the end it holds ' + expected.join(', '), (M) => JSON.stringify(contents(M)) === JSON.stringify(expected))], liveness: [], deadlock: true };
    spec.expect = v === 'hoh-broken' ? 'invariant' : 'ok'; spec.expectLive = 'ok';
    spec.final = contents;
    spec.about = { coarse: 'One lock for the whole list: simple and correct, but only one operation at a time.', hoh: 'Hand-over-hand: a thread holds the locks of the node before and the node it looks at, taking the next lock before letting the previous go, so operations on different parts of the list overlap.', 'hoh-broken': 'The lock of the current node is let go before the next is taken: in that moment another thread can unlink the next node, and an insert after it is lost.' }[v];
    return spec;
  };

  // ---- a hash table of buckets ---------------------------------------------------------------------------------------
  X.hash = function (variant, buckets, init, ops) {
    const v = variant || 'coarse', B = buckets || 2, vars = {};
    for (let b = 0; b < B; b++) vars['b' + b] = init.filter((k) => k % B === b).sort((x, y) => x - y);
    const lk = (k) => (v === 'coarse' ? 'H' : 'B' + (k % B));
    const code = (op) => {
      const bk = 'b' + (op.k % B), k = op.k;
      const body = [{ op: 'read', v: bk, into: 'arr', label: 'arr = bucket ' + (k % B) }];
      if (op.op === 'insert') body.push(L((r) => { if (!r.arr.includes(k)) r.arr = r.arr.concat([k]).sort((x, y) => x - y); }, 'add ' + k), { op: 'write', v: bk, val: (r) => r.arr, label: 'bucket ' + (k % B) + ' = arr' });
      else if (op.op === 'delete') body.push(L((r) => { r.arr = r.arr.filter((x) => x !== k); }, 'remove ' + k), { op: 'write', v: bk, val: (r) => r.arr, label: 'bucket ' + (k % B) + ' = arr' });
      else body.push(L((r) => { r.found = r.arr.includes(k) ? 1 : 0; }, 'look for ' + k), ...(op.must ? [{ op: 'assert', label: 'lookup(' + k + ') finds it', reads: [], fn: (V, th) => th.reg.found === 1 }] : []));
      body.push(L((r) => { r.arr = null; }, 'forget arr'));
      return (v === 'no-lock' ? body : [{ op: 'lock', m: lk(k), label: 'lock(' + lk(k) + ')' }, ...body, { op: 'unlock', m: lk(k), label: 'unlock(' + lk(k) + ')' }]).concat([done]);
    };
    const threads = ops.map((list, i) => ({ name: 'T' + i, prog: list.flatMap(code) }));
    const want = new Set(init);
    for (const op of ops.flat()) { if (op.op === 'insert') want.add(op.k); if (op.op === 'delete') want.delete(op.k); }
    const contents = (M) => Object.keys(M.vars).flatMap((b) => M.vars[b]).sort((x, y) => x - y);
    const expected = [...want].sort((x, y) => x - y);
    const spec = { threads, mutexes: v === 'no-lock' ? [] : v === 'coarse' ? ['H'] : Array.from({ length: B }, (_, b) => 'B' + b), vars };
    spec.check = { invariants: [{ name: 'every key sits in its own bucket', holds: (M) => Object.keys(M.vars).every((b) => M.vars[b].every((k) => 'b' + (k % B) === b)) }, atEnd('at the end it holds ' + expected.join(', '), (M) => JSON.stringify(contents(M)) === JSON.stringify(expected))], liveness: [], deadlock: true };
    spec.expect = v === 'no-lock' ? 'invariant' : 'ok'; spec.expectLive = 'ok';
    spec.final = contents;
    spec.about = { coarse: 'One lock for the table: every operation waits for every other.', bucket: 'A lock per bucket: operations on different buckets run at once.', 'no-lock': 'No lock: two inserts into one bucket both read it, and the second write loses the first key.' }[v];
    return spec;
  };

  // ---- a queue with a dummy node -----------------------------------------------------------------------------------------
  X.queue = function (variant, ops) {
    const v = variant || 'two-lock', H = v === 'two-lock' ? 'H' : 'Q', T = v === 'two-lock' ? 'T' : 'Q';
    const nEnq = ops.flat().filter((x) => x.op === 'enq').length, N = 1 + nEnq, val = Array(N).fill(null), next = Array(N).fill(-1);
    let free = 1;
    const code = (op, q) => {
      if (op.op === 'enq') { const n = free++; return [{ op: 'write', v: 'val', idx: n, val: op.v, label: 'node->value = ' + op.v }, { op: 'write', v: 'next', idx: n, val: -1, label: 'node->next = NULL' }, { op: 'lock', m: T, label: 'lock(' + (T === 'T' ? 'tail' : 'queue') + ')' }, { op: 'read', v: 'tail', into: 't', label: 't = tail' }, { op: 'write', v: 'next', idx: (r) => r.t, val: n, label: 't->next = node' }, { op: 'write', v: 'tail', val: n, label: 'tail = node' }, { op: 'unlock', m: T, label: 'unlock(' + (T === 'T' ? 'tail' : 'queue') + ')' }, done]; }
      return [{ op: 'lock', m: H, label: 'lock(' + (H === 'H' ? 'head' : 'queue') + ')' }, { op: 'read', v: 'head', into: 'h', label: 'h = head (the dummy)' }, { op: 'read', v: 'next', idx: (r) => r.h, into: 'nn', label: 'nn = h->next' }, J(q + 'empty', (r) => r.nn === -1, 'if the queue is empty'), { op: 'read', v: 'val', idx: (r) => r.nn, into: 'got', label: 'value = nn->value' }, { op: 'write', v: 'head', val: (r) => r.nn, label: 'head = nn (the new dummy)' }, { op: 'unlock', m: H, label: 'unlock(' + (H === 'H' ? 'head' : 'queue') + ')' }, { op: 'log', v: 'out', val: (r) => r.got, label: 'dequeues' }, J(q + 'end', null, 'done'), { label: q + 'empty' }, { op: 'unlock', m: H, label: 'unlock(' + (H === 'H' ? 'head' : 'queue') + '): empty' }, { label: q + 'end' }, done];
    };
    let b = 0;
    const threads = ops.map((list, i) => ({ name: 'T' + i, prog: list.flatMap((op) => code(op, 'o' + b++ + ':')) }));
    const left = (M) => { const out = []; let p = M.vars.next[M.vars.head], g = 0; while (p !== -1 && g++ < N) { out.push(M.vars.val[p]); p = M.vars.next[p]; } return out; };
    const enq = ops.map((list) => list.filter((x) => x.op === 'enq').map((x) => x.v));
    const inOrder = (seq) => enq.every((mine) => { const got = seq.filter((x) => mine.includes(x)); return got.every((x, i) => x === mine[i]); });
    const spec = { threads, mutexes: v === 'two-lock' ? ['H', 'T'] : ['Q'], vars: { val, next, head: 0, tail: 0, out: [] } };
    spec.check = { invariants: [{ name: 'no value comes out twice, and each comes out in its producer\'s order', holds: (M) => new Set(M.vars.out).size === M.vars.out.length && inOrder(M.vars.out) }, atEnd('at the end what came out and what is left are exactly what went in', (M) => JSON.stringify(M.vars.out.concat(left(M)).sort()) === JSON.stringify(enq.flat().sort()))], liveness: [], deadlock: true };
    spec.expect = 'ok'; spec.expectLive = 'ok';
    spec.final = left;
    spec.about = { 'two-lock': 'A head lock for dequeuers and a tail lock for enqueuers: thanks to the dummy node they never touch the same node, so one enqueue and one dequeue run at once.', 'one-lock': 'One lock for both ends: enqueues and dequeues wait for each other.' }[v];
    return spec;
  };

  // ---- seeded workloads and the throughput model ----------------------------------------------------------------------------
  X.workload = function (kind, variant, n, per, seed, o) {
    o = o || {};
    const r = Y.rng(seed || 1), K = o.keys || 16, pick = () => 1 + Math.floor(r() * K);
    const mix = () => { const x = r(); return x < 0.4 ? 'lookup' : x < 0.7 ? 'insert' : 'delete'; };
    const ops = Array.from({ length: n }, () => Array.from({ length: per }, () => ({ op: mix(), k: pick() })));
    if (kind === 'counter') return X.counter(variant, Array(n).fill(per), o);
    if (kind === 'queue') return X.queue(variant, Array.from({ length: n }, (_, i) => Array.from({ length: per }, (_, j) => (r() < 0.5 ? { op: 'enq', v: 't' + i + '.' + j } : { op: 'deq' }))));
    // keys from 1 to K, shared by all threads (the end-state check is not the point here: the model checker's
    // scenarios use distinct keys for that)
    const init = Array.from({ length: o.init || 8 }, (_, i) => 2 * i + 1);
    if (kind === 'list') return X.list(variant, init, ops);
    return X.hash(variant, o.buckets || 8, init, ops);
  };

  Y.perf = function (spec, opts) {
    const M = Y.machine(spec, { light: true }), r = Y.rng((opts && opts.seed) || 1), max = (opts && opts.maxTicks) || 200000;
    let ticks = 0, steps = 0, ops = 0, blocked = 0;
    while (M.status() === 'running' && ticks < max) {
      ticks++;
      const ready = M.runnable();
      blocked += M.threads.filter((th) => th.state === 'blocked').length;
      for (let i = ready.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ready[i], ready[j]] = [ready[j], ready[i]]; }
      for (const tid of ready) {
        if (M.T(tid).state !== 'ready') { blocked++; continue; }
        const st = M.step(tid); steps++;
        if (st.mark === 'progress') ops++;
      }
    }
    return { ticks, ops, steps, throughput: ops / Math.max(1, ticks), stepsPerOp: steps / Math.max(1, ops), waitPerOp: blocked / Math.max(1, ops), blocked, end: M.status() };
  };
  Y.scaling = function (kind, variant, o) {
    o = Object.assign({ threads: [1, 2, 4, 8], ops: 12, seed: 1 }, o || {});
    return o.threads.map((n) => Object.assign({ n }, Y.perf(X.workload(kind, variant, n, o.ops, o.seed, o), { seed: o.seed })));
  };

  // ---- into the catalogue, at sizes the model checker covers fully -----------------------------------------------------------
  const C = Y.catalog || (Y.catalog = []);
  const add = (id, title, build) => C.push({ id, part: 7, family: 'structures', title, build, system: false });
  for (const v of ['lock', 'sloppy', 'faa']) add('counter-' + v + '-struct', 'a concurrent counter (' + v + ')', () => X.counter(v, [3, 2], { threshold: 2 }));
  for (const v of ['coarse', 'hoh', 'hoh-broken']) add('list-' + v, 'a linked list (' + v + ')', () => X.list(v, [10, 30], [[{ op: 'insert', k: 20 }], [{ op: 'delete', k: 10 }, { op: 'lookup', k: 30, must: true }]]));
  for (const v of ['coarse', 'bucket', 'no-lock']) add('hash-' + v, 'a hash table (' + v + ')', () => X.hash(v, 2, [1, 3], [[{ op: 'insert', k: 2 }, { op: 'lookup', k: 1, must: true }], [{ op: 'insert', k: 4 }, { op: 'delete', k: 3 }]]));
  for (const v of ['two-lock', 'one-lock']) add('queue-' + v, 'a queue (' + v + ')', () => X.queue(v, [[{ op: 'enq', v: 'a1' }, { op: 'enq', v: 'a2' }], [{ op: 'enq', v: 'b1' }], [{ op: 'deq' }, { op: 'deq' }]]));
})(globalThis.Proses = globalThis.Proses || {});
