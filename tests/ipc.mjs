// IPC models (ipc-*.js): message passing worked by hand for each buffering and blocking rule, then random scripts
// checked for conservation (every message sent is delivered, queued or still held by a blocked sender), queue
// bounds, per-sender order and determinism; the shared-memory ring against an independent replay; FIFOs and
// sockets by hand; RPC marshalling against an independent decoder; at-most-once and at-least-once semantics
// against counts recomputed from the message timeline.
import { load, harness, rng } from './load.mjs';

const t = harness('ipc');
const S = load(['core']);
const I = S.Ipc;
const clean = (steps, what) => { for (const s of steps) if (typeof s.say !== 'string' || !s.say || /undefined|NaN/.test(s.say)) { t.ok(false, what + ': bad say ' + JSON.stringify(s.say)); return; } t.ok(true, what); };
const kinds = (r) => r.steps.map((s) => s.kind + ':' + (s.who || '-'));

// ---- message passing by hand ----
{
  const r = I.messages({ capacity: 0, procs: [{ name: 'P', ops: [{ op: 'send', to: 'Q', msg: 'a' }, { op: 'send', to: 'Q', msg: 'b' }] }, { name: 'Q', ops: [{ op: 'work' }, { op: 'recv' }, { op: 'recv' }] }] });
  t.eq(kinds(r), ['block:P', 'work:Q', 'receive:Q', 'wake:P', 'block:P', 'receive:Q', 'wake:P', 'done:P', 'done:Q'], 'rendezvous: every send waits for its receive');
  t.eq(r.delivered.map((d) => d.body), ['a', 'b'], 'both delivered in order');
  t.ok(r.steps.every((s) => Object.values(s.queues).every((q) => q.length === 0)), 'capacity 0 never queues');
  clean(r.steps, 'rendezvous narration');
}
{
  const r = I.messages({ capacity: 1, send: 'nonblocking', procs: [{ name: 'P', ops: [{ op: 'send', to: 'Q', msg: 'a' }, { op: 'send', to: 'Q', msg: 'b' }] }, { name: 'Q', ops: [{ op: 'work' }, { op: 'work' }, { op: 'recv' }] }] });
  t.eq([r.failed.map((f) => f.body), r.delivered.map((d) => d.body)], [['b'], ['a']], 'a non-blocking send to a full queue fails and the message is lost');
  const b = I.messages({ capacity: 1, procs: [{ name: 'P', ops: [{ op: 'send', to: 'Q', msg: 'a' }, { op: 'send', to: 'Q', msg: 'b' }] }, { name: 'Q', ops: [{ op: 'work' }, { op: 'work' }, { op: 'recv' }, { op: 'recv' }] }] });
  t.eq(kinds(b).slice(0, 5), ['queue:P', 'work:Q', 'block:P', 'work:Q', 'receive:Q'], 'a blocking send to a full queue waits');
  t.eq(b.delivered.map((d) => d.body), ['a', 'b'], 'and the waiting message moves into the queue when a slot frees');
  const u = I.messages({ capacity: Infinity, procs: [{ name: 'P', ops: Array.from({ length: 6 }, (_, i) => ({ op: 'send', to: 'Q', msg: 'm' + i })) }, { name: 'Q', ops: [{ op: 'recv' }] }], policy: 'order', order: ['P', 'P', 'P', 'P', 'P', 'P'] });
  t.ok(!u.steps.some((s) => s.kind === 'block' && s.who === 'P'), 'unbounded: the sender never blocks');
  const nb = I.messages({ recv: 'nonblocking', procs: [{ name: 'Q', ops: [{ op: 'recv' }] }, { name: 'P', ops: [{ op: 'send', to: 'Q', msg: 'late' }] }] });
  t.eq(nb.steps[0].kind, 'empty', 'a non-blocking receive returns at once with nothing');
}
{
  const r = I.messages({ naming: 'indirect', mailboxes: ['M'], capacity: 1, procs: [{ name: 'P', ops: [{ op: 'send', to: 'M', msg: 'a' }, { op: 'send', to: 'M', msg: 'b' }, { op: 'send', to: 'M', msg: 'c' }] }, { name: 'Q', ops: [{ op: 'recv', from: 'M' }] }, { name: 'R', ops: [{ op: 'recv', from: 'M' }] }] });
  t.eq(r.delivered.map((d) => [d.to, d.body, d.via]), [['Q', 'a', 'M'], ['R', 'b', 'M']], 'a mailbox shared by two receivers: each message goes to one');
  t.eq(r.steps[r.steps.length - 1].queues.M.map((m) => m.body), ['c'], 'c is left in the mailbox');
  const sym = I.messages({ capacity: 2, procs: [{ name: 'R', ops: [{ op: 'recv', from: 'X' }, { op: 'recv' }] }, { name: 'Y', ops: [{ op: 'send', to: 'R', msg: 'y' }] }, { name: 'X', ops: [{ op: 'send', to: 'R', msg: 'x' }] }] });
  t.eq(sym.delivered.map((d) => d.body), ['x', 'y'], 'symmetric naming: receive(X) skips Y\'s earlier message');
  const dl = I.messages({ capacity: 0, procs: [{ name: 'P', ops: [{ op: 'recv' }] }, { name: 'Q', ops: [{ op: 'recv' }] }] });
  t.eq(dl.deadlock, ['P', 'Q'], 'two receivers and no sender: deadlock detected');
  const dl2 = I.messages({ capacity: 0, procs: [{ name: 'P', ops: [{ op: 'send', to: 'Q', msg: '1' }, { op: 'recv' }] }, { name: 'Q', ops: [{ op: 'send', to: 'P', msg: '2' }, { op: 'recv' }] }] });
  t.eq(dl2.deadlock, ['P', 'Q'], 'both send first with no buffering: deadlock');
  const ok2 = I.messages({ capacity: 1, procs: [{ name: 'P', ops: [{ op: 'send', to: 'Q', msg: '1' }, { op: 'recv' }] }, { name: 'Q', ops: [{ op: 'send', to: 'P', msg: '2' }, { op: 'recv' }] }] });
  t.eq([ok2.deadlock, ok2.delivered.length], [null, 2], 'a buffer of one removes that deadlock');
}
// ---- random scripts: conservation, bounds, order, determinism ----
{
  const r = rng(21);
  for (let trial = 0; trial < 120; trial++) {
    const names = ['A', 'B', 'C'].slice(0, 2 + Math.floor(r() * 2));
    const indirect = r() < 0.4, caps = [0, 1, 2, Infinity], cap = caps[Math.floor(r() * 4)];
    const sendMode = r() < 0.3 ? 'nonblocking' : 'blocking', recvMode = r() < 0.2 ? 'nonblocking' : 'blocking';
    let seq = 0;
    const procs = names.map((n) => ({ name: n, ops: Array.from({ length: 1 + Math.floor(r() * 5) }, () => {
      const x = r();
      if (x < 0.45) { const to = indirect ? (r() < 0.5 ? 'M1' : 'M2') : names[Math.floor(r() * names.length)]; return { op: 'send', to, msg: n + (seq++) }; }
      if (x < 0.85) return indirect ? { op: 'recv', from: r() < 0.5 ? 'M1' : 'M2' } : { op: 'recv' };
      return { op: 'work' };
    }) }));
    const o = { naming: indirect ? 'indirect' : 'direct', mailboxes: ['M1', 'M2'], capacity: cap, send: sendMode, recv: recvMode, procs, policy: r() < 0.5 ? 'random' : 'rr', seed: trial + 1 };
    const a = I.messages(o), b = I.messages(o);
    t.eq(a.steps.map((s) => s.say), b.steps.map((s) => s.say), 'same seed, same run, trial ' + trial);
    const last = a.steps[a.steps.length - 1];
    const sent = procs.flatMap((p) => p.ops.slice(0, last.procs[p.name].pc + (last.procs[p.name].state === 'blocked' ? 1 : 0)).filter((x) => x.op === 'send').map((x) => x.msg));
    const queued = Object.values(last.queues).flat().map((m) => m.body), held = last.waiting.map((w) => w.body);
    const accounted = a.delivered.map((d) => d.body).concat(a.failed.map((f) => f.body), queued, held).sort();
    t.eq(accounted, sent.slice().sort(), 'every message sent is delivered, failed, queued or held, trial ' + trial);
    t.ok(a.steps.every((s) => Object.values(s.queues).every((q) => q.length <= cap)), 'queues never exceed capacity, trial ' + trial);
    // per sender and receiver, messages arrive in the order sent
    let ordered = true;
    for (const p of names) for (const q of names) {
      const got = a.delivered.filter((d) => d.from === p && d.to === q).map((d) => +d.body.slice(1));
      for (let i = 1; i < got.length; i++) if (got[i] < got[i - 1] && !indirect) ordered = false;
    }
    t.ok(ordered, 'per-pair order kept, trial ' + trial);
    clean(a.steps, 'random narration ' + trial);
  }
}
// ---- shared memory ----
{
  const r = I.shm({ size: 3, items: ['a', 'b', 'c', 'd'], quantum: 2 });
  t.eq(r.consumed, ['a', 'b', 'c', 'd'], 'every item arrives in order');
  t.eq(r.steps.filter((s) => s.kind !== 'setup' && s.kind !== 'end').map((s) => s.kind), ['put', 'put', 'take', 'take', 'put', 'put', 'take', 'take'], 'hand-worked alternation with a quantum of 2');
  const full = I.shm({ size: 2, items: ['a', 'b', 'c'], quantum: 3 });
  t.ok(full.spins.producer > 0, 'a one-slot ring makes the producer spin');
  const R = rng(4);
  for (let trial = 0; trial < 50; trial++) {
    const N = 2 + Math.floor(R() * 5), items = Array.from({ length: 1 + Math.floor(R() * 9) }, (_, i) => 'x' + i);
    const g = I.shm({ size: N, items, policy: 'random', seed: trial + 3 });
    t.eq(g.consumed, items, 'FIFO through the ring, trial ' + trial);
    t.ok(g.steps.every((s) => s.count <= N - 1 && s.count === (s.in - s.out + N) % N), 'never more than N − 1 items, trial ' + trial);
    // independent replay of the ring from the step kinds
    let inn = 0, out = 0, ok = true;
    for (const s of g.steps) { if (s.kind === 'put') inn = (inn + 1) % N; if (s.kind === 'take') out = (out + 1) % N; if (s.kind !== 'setup' && (s.in !== inn || s.out !== out)) ok = false; }
    t.ok(ok, 'indexes match an independent replay, trial ' + trial);
  }
  const c = I.compare({ items: 10, size: 64 });
  t.eq(c.rows.map((x) => [x.syscalls, x.copies, x.bytesCopied]), [[4, 0, 0], [20, 20, 1280]], 'shared memory against message passing for 10 items');
}
// ---- FIFOs ----
{
  const r = I.fifo({ capacity: 4, procs: [{ name: 'W', ops: [{ op: 'mkfifo', path: '/tmp/f' }, { op: 'open', path: '/tmp/f', mode: 'w' }, { op: 'write', data: 'hello' }, { op: 'write', data: 'ab' }, { op: 'close' }] }, { name: 'R', ops: [{ op: 'open', path: '/tmp/f', mode: 'r' }, { op: 'read', n: 3 }, { op: 'read' }, { op: 'read' }, { op: 'read' }] }] });
  t.eq([r.got.R, r.deadlock], ['helloab', null], 'the reader gets every byte, in order');
  t.eq(r.steps.filter((s) => s.who === 'R').map((s) => s.kind).slice(0, 2), ['block', 'wake'], 'open for reading waits for a writer');
  t.ok(r.steps.some((s) => s.kind === 'eof'), 'read returns 0 once the writer has closed');
  t.ok(r.steps.some((s) => s.kind === 'block' && s.who === 'W' && /all that fits/.test(s.say)), 'a write larger than the room blocks part way');
  t.ok(r.steps.every((s) => !s.pipes['/tmp/f'] || s.pipes['/tmp/f'].buffer.length <= 4), 'the pipe never holds more than its capacity');
  clean(r.steps, 'fifo narration');
  const sp = I.fifo({ procs: [{ name: 'W', ops: [{ op: 'mkfifo', path: '/p' }, { op: 'open', path: '/p', mode: 'w' }, { op: 'write', data: 'x' }] }, { name: 'R', ops: [{ op: 'open', path: '/p', mode: 'r' }, { op: 'close' }] }], policy: 'order', order: ['W', 'W', 'R', 'R', 'W'] });
  t.ok(sp.steps.some((s) => s.kind === 'sigpipe'), 'writing with no reader left: EPIPE and SIGPIPE');
  const nx = I.fifo({ procs: [{ name: 'W', ops: [{ op: 'mkfifo', path: '/p' }, { op: 'open', path: '/p', mode: 'w', nonblock: true }] }] });
  t.ok(/ENXIO/.test(nx.steps[1].say), 'a non-blocking open for writing with no reader fails with ENXIO');
  const dl = I.fifo({ procs: [{ name: 'A', ops: [{ op: 'mkfifo', path: '/p' }, { op: 'open', path: '/p', mode: 'r' }] }, { name: 'B', ops: [{ op: 'open', path: '/p', mode: 'r' }] }] });
  t.eq(dl.deadlock, ['A', 'B'], 'two readers and no writer wait for ever');
  t.ok(/ENOENT/.test(I.fifo({ procs: [{ name: 'A', ops: [{ op: 'open', path: '/none', mode: 'r' }] }] }).steps[0].say), 'opening a FIFO that does not exist');
}
// ---- sockets ----
{
  const r = I.clientServer({ clients: 2, requests: ['GET /a', 'GET /b'] });
  t.eq(r.got, { server: ['GET /a', 'GET /b', 'GET /a', 'GET /b'], client1: ['reply to GET /a', 'reply to GET /b'], client2: ['reply to GET /a', 'reply to GET /b'] }, 'every request answered');
  t.eq(r.deadlock, null, 'no deadlock');
  t.eq(r.timeline.filter((x) => ['SYN', 'SYN-ACK', 'ACK'].includes(x.label)).length, 6, 'a three-way handshake per client');
  clean(r.steps, 'socket narration');
  const refused = I.sockets({ procs: [{ name: 'c', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 80 }] }] });
  t.eq(refused.steps[1].kind, 'refused', 'nothing listening: ECONNREFUSED');
  const backlog = I.sockets({ policy: 'order', order: ['srv', 'srv', 'srv', 'a', 'a', 'b', 'b'], procs: [{ name: 'srv', ops: [{ op: 'socket', as: 'l' }, { op: 'bind', on: 'l', port: 9 }, { op: 'listen', on: 'l', backlog: 1 }] }, { name: 'a', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }, { name: 'b', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }] });
  t.eq(backlog.steps.filter((s) => s.kind === 'refused').length, 0, 'a full backlog refuses no one');
  const bs = backlog.steps.filter((s) => s.who === 'b').map((s) => s.kind);
  t.eq(bs.slice(1), ['dropped', 'retry', 'retry', 'timeout', 'done'], 'a full backlog drops the SYN; b retries twice more, then times out');
  t.ok(/ETIMEDOUT/.test(backlog.steps.find((s) => s.kind === 'timeout').say) && /after 7 s/.test(backlog.steps.find((s) => s.kind === 'timeout').say), 'ETIMEDOUT after 1 + 2 + 4 s of backoff');
  t.ok(/drops the SYN without a reply \(no reset\)/.test(backlog.steps.find((s) => s.kind === 'dropped').say), 'the narration says the SYN was dropped, not refused');
  t.eq(backlog.timeline.filter((x) => x.to === 'b' || x.from === 'b').map((x) => x.label), ['SYN (dropped)', 'SYN (dropped)', 'SYN (dropped)', 'SYN (dropped)'], 'four SYNs from b, all dropped, and no reset');
  const late = I.sockets({ policy: 'order', order: ['srv', 'srv', 'srv', 'a', 'a', 'b', 'b', 'b', 'srv'], procs: [{ name: 'srv', ops: [{ op: 'socket', as: 'l' }, { op: 'bind', on: 'l', port: 9 }, { op: 'listen', on: 'l', backlog: 1 }, { op: 'accept', on: 'l', as: 'x' }] }, { name: 'a', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }, { name: 'b', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }] });
  const bc = late.steps.find((s) => s.who === 'b' && s.kind === 'connect');
  t.ok(bc && /^b's SYN finds room after 2 retransmissions \(3 s of backoff\): SYN, SYN-ACK, ACK/.test(bc.say), 'once the server accepts, b\'s retransmitted SYN connects');
  const noone = I.sockets({ procs: [{ name: 'c', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 80 }] }] });
  t.eq([noone.steps[1].kind, noone.timeline.map((x) => x.label)], ['refused', ['SYN', 'RST']], 'no listener: a reset and ECONNREFUSED');
  t.ok(/nothing listens there/.test(noone.steps[1].say), 'the narration names the no-listener case');
  const none = I.sockets({ synRetries: 0, policy: 'order', order: ['srv', 'srv', 'srv', 'a', 'a', 'b', 'b'], procs: [{ name: 'srv', ops: [{ op: 'socket', as: 'l' }, { op: 'bind', on: 'l', port: 9 }, { op: 'listen', on: 'l', backlog: 1 }] }, { name: 'a', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }, { name: 'b', ops: [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 9 }] }] });
  t.ok(none.steps.some((s) => s.who === 'b' && s.kind === 'timeout'), 'with no retries allowed, a dropped SYN times out at once');
  clean(backlog.steps.concat(late.steps), 'backlog narration');
  const eof = I.sockets({ policy: 'order', order: ['s', 's', 's', 'c', 'c', 's', 's', 'c'], procs: [{ name: 's', ops: [{ op: 'socket', as: 'l' }, { op: 'bind', on: 'l', port: 7 }, { op: 'listen', on: 'l' }, { op: 'accept', on: 'l', as: 'x' }, { op: 'close', on: 'x' }] }, { name: 'c', ops: [{ op: 'socket', as: 'k' }, { op: 'connect', on: 'k', port: 7 }, { op: 'recv', on: 'k' }] }] });
  t.eq(eof.got.c, [null], 'recv after the peer closed returns 0');
}
// ---- RPC marshalling ----
{
  const m = I.marshal([{ name: 'shelf', type: 'uint16' }, { name: 'name', type: 'string' }, { name: 'count', type: 'int32' }], { shelf: 12, name: 'lamp', count: 3 });
  t.eq(I.hexBytes(m.bytes), '00 0c 00 00 00 00 00 04 6c 61 6d 70 00 00 00 03', 'hand-worked bytes');
  t.eq(m.fields.map((f) => [f.offset, f.length]), [[0, 4], [4, 8], [12, 4]], 'field offsets');
  t.eq(I.hexBytes(I.marshal([{ name: 'v', type: 'int32' }], { v: -2 }).bytes), 'ff ff ff fe', 'two\'s complement, big-endian');
  t.eq(I.marshal([{ name: 's', type: 'string' }], { s: 'hello' }).bytes.length, 12, 'a 5-character string pads to 8 after its length');
  const types = ['int32', 'uint16', 'uint8', 'bool', 'string', 'int32[]'];
  // an independent decoder
  const dec = (schema, b) => {
    const v = {}; let i = 0;
    const be = (k) => ((b[k] * 16777216) + (b[k + 1] << 16) + (b[k + 2] << 8) + b[k + 3]);
    const s32 = (k) => { const x = be(k); return x >= 2 ** 31 ? x - 2 ** 32 : x; };
    for (const f of schema) {
      if (f.type === 'int32') { v[f.name] = s32(i); i += 4; }
      else if (f.type === 'uint16') { v[f.name] = b[i] * 256 + b[i + 1]; i += 4; }
      else if (f.type === 'uint8') { v[f.name] = b[i]; i += 4; }
      else if (f.type === 'bool') { v[f.name] = be(i) !== 0; i += 4; }
      else if (f.type === 'string') { const n = be(i); v[f.name] = String.fromCharCode(...b.slice(i + 4, i + 4 + n)); i += 4 + Math.ceil(n / 4) * 4; }
      else { const n = be(i); v[f.name] = []; for (let k = 0; k < n; k++) v[f.name].push(s32(i + 4 + 4 * k)); i += 4 + 4 * n; }
    }
    return v;
  };
  const r = rng(8);
  for (let trial = 0; trial < 150; trial++) {
    const schema = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ name: 'f' + i, type: types[Math.floor(r() * types.length)] }));
    const val = {};
    for (const f of schema) {
      val[f.name] = f.type === 'int32' ? Math.floor(r() * 2 ** 32) - 2 ** 31 : f.type === 'uint16' ? Math.floor(r() * 65536) : f.type === 'uint8' ? Math.floor(r() * 256) : f.type === 'bool' ? r() < 0.5
        : f.type === 'string' ? Array.from({ length: Math.floor(r() * 9) }, () => String.fromCharCode(97 + Math.floor(r() * 26))).join('') : Array.from({ length: Math.floor(r() * 4) }, () => Math.floor(r() * 2000) - 1000);
    }
    const mm = I.marshal(schema, val);
    t.ok(mm.bytes.length % 4 === 0, 'every message is a multiple of 4 bytes, trial ' + trial);
    t.eq(dec(schema, mm.bytes), val, 'an independent decoder reads the value back, trial ' + trial);
    t.eq(I.unmarshal(schema, mm.bytes).value, val, 'unmarshal round trip, trial ' + trial);
  }
  const call = I.rpcCall({});
  t.eq(call.result, { total: 13 }, 'the stub path returns the server\'s result');
  t.eq(call.request.length, 24, 'request id, procedure number and 16 bytes of arguments');
  clean(call.steps, 'rpc narration');
}
// ---- RPC semantics under loss and duplication ----
{
  const clean0 = I.semantics({ semantics: 'at-least-once', loss: 0, dup: 0 });
  t.eq([clean0.final, clean0.expected, clean0.calls.map((c) => c.executions)], [55, 55, [1, 1, 1]], 'a perfect network: each call once');
  for (let seed = 1; seed <= 80; seed++) {
    const calls = [{ op: 'deposit', arg: 3 }, { op: 'set', arg: 40 }, { op: 'deposit', arg: 7 }, { op: 'read' }, { op: 'deposit', arg: 1 }];
    const most = I.semantics({ semantics: 'at-most-once', seed, calls, loss: 0.35, dup: 0.3, retries: 4 });
    t.ok(most.calls.every((c) => c.executions <= 1), 'at-most-once never runs a call twice, seed ' + seed);
    if (most.calls.every((c) => c.answered)) t.eq(most.final, most.expected, 'at-most-once is exact when every call is answered, seed ' + seed);
    const least = I.semantics({ semantics: 'at-least-once', seed, calls, loss: 0.35, dup: 0.3, retries: 4 });
    // recompute executions from the timeline: every request that arrived (not lost) ran once
    for (const c of least.calls) {
      const arrived = least.timeline.filter((m) => m.from === 'client' && !m.lost && m.label.endsWith('#' + c.id)).length;
      t.eq(c.executions, arrived, 'at-least-once runs every arriving request, seed ' + seed + ' call ' + c.id);
    }
    // recompute the final value independently from the executions
    let v = 0;
    for (const c of least.calls) for (let k = 0; k < c.executions; k++) v = c.op === 'deposit' ? v + c.arg : c.op === 'set' ? c.arg : v;
    t.eq(least.final, v, 'final value recomputed from executions, seed ' + seed);
    const idem = I.semantics({ semantics: 'at-least-once', seed, calls: [{ op: 'set', arg: 5 }, { op: 'read' }, { op: 'set', arg: 9 }], loss: 0.3, dup: 0.4 });
    if (idem.calls.every((c) => c.answered)) t.eq(idem.final, 9, 'idempotent calls are safe to repeat, seed ' + seed);
    const again = I.semantics({ semantics: 'at-least-once', seed, calls, loss: 0.35, dup: 0.3, retries: 4 });
    t.eq(again.steps.map((s) => s.say), least.steps.map((s) => s.say), 'same seed, same run, seed ' + seed);
  }
  t.eq(I.IDEMPOTENT, { deposit: false, set: true, read: true }, 'which operations are idempotent');
}
// ---- narration slips: every say string from seeded runs of every function ----
const sayLint = (() => {
  const SING = ['item', 'message', 'byte', 'operation', 'slot', 'spin', 'tick', 'call', 'entry', 'request', 'exit', 'copy', 'trap', 'read', 'failure', 'guess', 'instruction', 'register', 'page', 'run', 'notification', 'interrupt', 'domain', 'right', 'finding', 'level', 'miss', 'fault', 'thing', 'unit', 'cycle', 'digit', 'character', 'reply', 'try', 'process', 'switch', 'triple', 'list', 'key', 'lock', 'capability', 'service', 'client', 'second', 'write', 'transition', 'event', 'round', 'attempt'];
  const plural = (w) => (/(ss|sh|ch|x)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  const PL = new Map(SING.map((w) => [plural(w), w]));
  const vowelOk = /^(use|usa|uni|uin|one|once|eu|ur)/i, consOk = /^(hour|honest|honou)/i;
  // words that follow a name such as process A, not the article a
  const FN = new Set(['is', 'as', 'at', 'in', 'on', 'of', 'or', 'and', 'are', 'also', 'again', 'until', 'up', 'if', 'its', 'it', 'opens', 'owns', 'ends', 'exits', 'enters', 'uses', 'accepts', 'asks', 'unlinks', 'ran', 'eats', 'issues', 'even', 'once', 'only']);
  const collect = (x, out, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return out;
    seen.add(x);
    if (typeof x.say === 'string') out.push(x.say);
    else if ('say' in x && x.say !== undefined) out.push('[say is ' + typeof x.say + ']');
    for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, out, seen);
    return out;
  };
  const slips = (s) => {
    const bad = [];
    if (/undefined|NaN|\bnull\b|\[object|Infinity/.test(s)) bad.push('undefined/NaN/null');
    if (!s.trim()) bad.push('empty');
    for (const m of s.matchAll(/(?<![\w.−-])1 ([a-z]+)\b/g)) if (PL.has(m[1])) bad.push('"1 ' + m[1] + '"');
    for (const m of s.matchAll(/(?<![\w.])(\d+|zero|two|three|four) ([a-z]+)(?=[.,;:)]|$| (?:of|and|in|for|so|to|but|with|from|after|before|each|per)\b)/g)) if (m[1] !== '1' && SING.includes(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/(?<![\w/'])(a|A) ([A-Za-z]\w*)/g)) if (!FN.has(m[2]) && /^[aeiou]/i.test(m[2]) && !vowelOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) ([A-Za-z]\w*)/g)) if (!/^[aeiou]/i.test(m[2]) && !consOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2]) && !/^[A-Z]$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(a|A) (8|11|18|80\d*|8\d)\b/g)) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) (\d+)/g)) if (!/^(8|11|18|8\d*)$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b([A-Za-z]+) \1\b/gi)) if (!/^[0-9a-f]{2}$/i.test(m[1])) bad.push('doubled "' + m[0] + '"');
    return bad;
  };
  return (t, results, what) => {
    const says = [];
    for (const r of results) collect(r, says, new Set());
    const found = [];
    for (const s of new Set(says)) for (const b of slips(s)) found.push(b + ' in: ' + s);
    t.ok(says.length > 0, what + ': some narration to scan');
    t.ok(!found.length, what + ': ' + found.length + ' slips, e.g.\n  ' + Array.from(new Set(found.map((f) => f.split(' in: ')[0]))).slice(0, 40).map((k) => found.find((f) => f.startsWith(k))).join('\n  '));
    return found;
  };
})();
{
  const r = rng(202), out = [];
  for (let seed = 1; seed <= 40; seed++) {
    const names = ['A', 'B', 'C'];
    const indirect = r() < 0.4;
    const procs = names.map((n) => ({ name: n, ops: Array.from({ length: 1 + Math.floor(r() * 5) }, (_, k) => { const x = r(); return x < 0.4 ? { op: 'send', to: indirect ? 'M' : names[Math.floor(r() * 3)], msg: n + k } : x < 0.8 ? (indirect ? { op: 'recv', from: 'M' } : { op: 'recv', from: r() < 0.3 ? names[Math.floor(r() * 3)] : undefined }) : { op: 'work', ticks: 1 + Math.floor(r() * 3) }; }) }));
    out.push(I.messages({ naming: indirect ? 'indirect' : 'direct', mailboxes: ['M'], capacity: [0, 1, 3, Infinity][Math.floor(r() * 4)], send: r() < 0.3 ? 'nonblocking' : 'blocking', recv: r() < 0.3 ? 'nonblocking' : 'blocking', procs, policy: 'random', seed }));
    out.push(I.shm({ size: 2 + Math.floor(r() * 4), items: Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => 'i' + i), policy: r() < 0.5 ? 'random' : 'rr', seed }));
    out.push(I.compare({ items: Math.floor(r() * 3), size: 1 + Math.floor(r() * 3) }));
    const fops = [{ op: 'open', path: '/f', mode: 'w', nonblock: r() < 0.3 }, { op: 'write', data: 'abcde'.slice(0, 1 + Math.floor(r() * 5)) }, { op: 'work', ticks: 1 + Math.floor(r() * 3) }, { op: 'close' }, { op: 'write', data: 'z' }, { op: 'unlink', path: '/f' }, { op: 'mkfifo', path: '/f' }, { op: 'bogus' }];
    out.push(I.fifo({ capacity: 1 + Math.floor(r() * 4), procs: [{ name: 'W', ops: [{ op: 'mkfifo', path: '/f' }].concat(fops.filter(() => r() < 0.8)) }, { name: 'R', ops: [{ op: 'open', path: '/f', mode: 'r' }, { op: 'read', n: 1 + Math.floor(r() * 3) }, { op: 'read' }, { op: 'work', ticks: 1 }, { op: 'close' }, { op: 'read' }] }], policy: 'random', seed }));
    out.push(I.clientServer({ clients: 1 + Math.floor(r() * 3), requests: ['q1', 'q2'].slice(0, 1 + Math.floor(r() * 2)), backlog: 1 + Math.floor(r() * 2), policy: r() < 0.5 ? 'random' : undefined, seed }));
    out.push(I.sockets({ policy: 'random', seed, procs: [{ name: 's', ops: [{ op: 'socket', as: 'l' }, { op: 'bind', on: 'l', port: 5 }, { op: 'listen', on: 'l', backlog: 1 }, { op: 'work', ticks: 2 }, { op: 'close', on: 'l' }] }, { name: 'c', ops: [{ op: 'socket', as: 'k' }, { op: 'connect', on: 'k', port: 5 }, { op: 'send', on: 'k', data: 'x' }, { op: 'close', on: 'k' }, { op: 'recv', on: 'zz' }] }, { name: 'd', ops: [{ op: 'socket', as: 'k' }, { op: 'close', on: 'k' }, { op: 'bind', on: 'k', port: 5 }] }] }));
    out.push(I.rpcCall({ id: seed, value: { shelf: seed, name: 'n'.repeat(seed % 5), count: seed - 20 } }));
    out.push(I.semantics({ semantics: r() < 0.5 ? 'at-most-once' : 'at-least-once', seed, loss: r() * 0.6, dup: r() * 0.5, retries: 1 + Math.floor(r() * 4), calls: [{ op: 'deposit', arg: 1 }, { op: 'read' }, { op: 'set', arg: 2 }] }));
  }
  sayLint(t, out, 'ipc narration slips');
}
t.done();
