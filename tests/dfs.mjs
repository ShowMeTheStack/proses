// Distributed file systems on the timeline engine: every scenario below was worked out by hand, tick by tick, with
// a latency of 1 (a request sent at t arrives at t + 1, its reply at t + 2) and a retry timeout of 4.
import { load, harness } from './load.mjs';

const t = harness('dfs');
const S = load(['core']);
const D = S.DFS;
const reads = (r) => r.reads.map((x) => [x.t, x.c, x.got, x.stale]);
const kinds = (r, k) => r.outcomes.filter((o) => o.kind === k);

// 1. NFS attribute caching. A opens f (GETATTR 0→2) and reads it: its attributes are fresh but it has no data, so
//    READ 2→4, which also refreshes the attributes at 4. B opens, writes "new" locally and closes: WRITE 2→4, so the
//    server holds "new" from t = 3. A reads at 5: its attributes are 1 tick old, under the timeout of 3, so the
//    cached "old" is returned: stale. At 9 they are 5 ticks old: GETATTR 9→11 sees version 2, then READ 11→13.
const nfs1 = { protocol: 'nfs', files: { f: 'old' }, script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'read', file: 'f' }, { t: 0, c: 'B', op: 'open', file: 'f' }, { t: 0, c: 'B', op: 'write', file: 'f', data: 'new' }, { t: 0, c: 'B', op: 'close', file: 'f' }, { t: 5, c: 'A', op: 'read', file: 'f' }, { t: 9, c: 'A', op: 'read', file: 'f' }] };
{
  const r = D.run(nfs1);
  t.eq(reads(r), [[4, 'A', 'old', false], [5, 'A', 'old', true], [13, 'A', 'new', false]], 'NFS: the read inside the attribute timeout is stale; the later one is fresh');
  t.eq([r.costs.messages, r.costs.perClient.A, r.costs.perClient.B], [12, 8, 4], 'NFS: 12 messages, 8 of them A\'s');
  t.eq([r.server.files.f.data, r.server.files.f.version, r.server.files.f.writer], ['new', 2, 'B'], 'NFS: the server holds version 2, written by B');
  const r0 = D.run(Object.assign({}, nfs1, { attrTimeout: 0 }));
  t.eq(kinds(r0, 'stale-read').length, 0, 'NFS with no attribute caching: no stale read');
  t.ok(r0.costs.messages > r.costs.messages, `but more messages (${r0.costs.messages} against ${r.costs.messages})`);
}
// 2. AFS callbacks. A fetches f (0→2) and reads it locally. B fetches at 1 (1→3), writes, closes: STORE 3→5; the
//    server breaks A's callback (BREAK sent at 4, heard at 5). A opens again at 8: no promise, so FETCH 8→10, "new".
const afs1 = { protocol: 'afs', files: { f: 'old' }, script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'read', file: 'f' }, { t: 1, c: 'B', op: 'open', file: 'f' }, { t: 1, c: 'B', op: 'write', file: 'f', data: 'new' }, { t: 1, c: 'B', op: 'close', file: 'f' }, { t: 8, c: 'A', op: 'open', file: 'f' }, { t: 8, c: 'A', op: 'read', file: 'f' }] };
{
  const r = D.run(afs1);
  t.eq(reads(r), [[2, 'A', 'old', false], [10, 'A', 'new', false]], 'AFS: both reads fresh');
  t.eq(r.costs.byKind, { FETCH: 3, 'FETCH-REPLY': 3, STORE: 1, BREAK: 1, 'STORE-REPLY': 1 }, 'AFS: three fetches, one store, one callback break');
  t.eq(r.events.filter((e) => e.kind === 'break').map((e) => [e.t, e.c]), [[5, 'A']], 'AFS: A hears the break at t = 5');
  // re-opening an unchanged file costs nothing under AFS, a GETATTR under NFS
  const again = (protocol) => D.run({ protocol, files: { g: 'same' }, attrTimeout: 0, script: [0, 3, 6, 9].flatMap((tt) => [{ t: tt, c: 'A', op: 'open', file: 'g' }, { t: tt, c: 'A', op: 'read', file: 'g' }, { t: tt, c: 'A', op: 'close', file: 'g' }]) }).costs.messages;
  t.eq([again('afs'), again('nfs')], [2, 18], 'four open-read-close of an unchanged file: AFS 2 messages (one fetch), NFS 18 (a GETATTR at each open and each read, 16 messages, and one READ)');
}
// 3. AFS and a server crash. A fetches f (0→2). The server is down from 3 to 5 and forgets every callback. B
//    fetches at 6 (6→8), writes and closes: STORE 8→10; the server breaks no one, since it no longer knows A caches f.
//    A opens at 12 trusting its old promise: a stale read. With a probe every 4 ticks: the probe sent at 4 arrives at
//    5, just as the server is back, so A hears epoch 2 at t = 6.
const afs2 = { protocol: 'afs', files: { f: 'old' }, crashes: [{ t: 3, until: 5 }], script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'read', file: 'f' }, { t: 6, c: 'B', op: 'open', file: 'f' }, { t: 6, c: 'B', op: 'write', file: 'f', data: 'new' }, { t: 6, c: 'B', op: 'close', file: 'f' }, { t: 12, c: 'A', op: 'open', file: 'f' }, { t: 12, c: 'A', op: 'read', file: 'f' }] };
{
  const r = D.run(afs2);
  t.eq(reads(r), [[2, 'A', 'old', false], [12, 'A', 'old', true]], 'AFS after a server crash, no probe: A reads stale data');
  t.eq(r.costs.byKind.BREAK, undefined, 'no callback break was sent');
  const p = D.run(Object.assign({}, afs2, { probe: 4 }));
  t.eq(reads(p), [[2, 'A', 'old', false], [14, 'A', 'new', false]], 'with probes A learns of the restart (t = 6), drops its promise and fetches again');
  t.eq(p.events.filter((e) => e.kind === 'epoch' && e.c === 'A').map((e) => e.t), [6], 'A hears epoch 2 at t = 6');
}
// 4. Lost updates: both fetch, both change their copy, A closes first, B second. Last close wins.
for (const protocol of ['afs', 'nfs']) {
  const r = D.run({ protocol, files: { f: 'v1' }, script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'B', op: 'open', file: 'f' }, { t: 2, c: 'A', op: 'write', file: 'f', data: 'from A' }, { t: 2, c: 'B', op: 'write', file: 'f', data: 'from B' }, { t: 3, c: 'A', op: 'close', file: 'f' }, { t: 6, c: 'B', op: 'close', file: 'f' }] });
  t.eq(r.server.files.f.data, 'from B', `${protocol}: the last close wins`);
  t.eq(kinds(r, 'lost-update').map((o) => [o.c, o.lost]), [['B', 'from A']], `${protocol}: B's close loses A's update`);
}
// 5. NFS retries. The reply to A's REMOVE (sent at 1, done at 2, reply sent at 2) is lost. A retries at 5, same xid:
//    the duplicate-request cache answers (6→7) and the remove succeeds once. If the server crashed in between (3 to 4),
//    the cache is gone: the retried REMOVE is done again and fails with ENOENT, though the file was removed.
const rm = { protocol: 'nfs', files: { f: 'x' }, drops: [{ t: 2, dir: 'reply' }], script: [{ t: 1, c: 'A', op: 'remove', file: 'f' }] };
{
  const a = D.run(rm);
  t.eq([kinds(a, 'retry').map((o) => o.t), kinds(a, 'dup-reply').map((o) => o.t), kinds(a, 'error').length], [[5], [6], 0], 'NFS: lost reply, retry at 5, answered from the duplicate-request cache at 6');
  const b = D.run(Object.assign({}, rm, { crashes: [{ t: 3, until: 4 }] }));
  t.eq(kinds(b, 'error').map((o) => [o.t, o.err]), [[7, 'ENOENT']], 'NFS: after a server crash the retried remove fails with ENOENT');
  const c = D.run(Object.assign({}, rm, { dupCache: false }));
  t.eq(kinds(c, 'error').map((o) => o.err), ['ENOENT'], 'NFS without a duplicate-request cache: the same failure');
  t.eq(b.server.files, {}, 'either way the file is gone');
}
// 6. Requests to a server that is down are lost and retried until it is back: GETATTR at 0 (lost at 1), retry at 4
//    (lost at 5), retry at 8 (answered 9→10).
{
  const r = D.run({ protocol: 'nfs', files: { f: 'data' }, crashes: [{ t: 0, until: 6 }], script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'read', file: 'f' }] });
  t.eq(kinds(r, 'retry').map((o) => o.t), [4, 8], 'two retries while the server is down');
  t.eq(reads(r), [[12, 'A', 'data', false]], 'the read completes once the server is back');
  t.eq(r.messages.filter((m) => m.lost === 'server down').length, 2, 'two requests were lost to the crash');
}
// 7. A retried write. A opens f (0→2), writes locally, closes: WRITE sent at 2, done at 3 (version 2), its reply lost.
//    A retries at 6; the retry reaches the server at 7. With the duplicate-request cache, the server finds the request
//    there (xid 2: the GETATTR at open was xid 1) and sends the same answer again: still version 2. Without it, a stateless server has no record of the
//    xid and performs the WRITE again: version 3. Either way it is A's own write, so no lost update.
{
  const base = { protocol: 'nfs', files: { f: 'v1' }, drops: [{ t: 3, dir: 'reply' }], script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'write', file: 'f', data: 'mine' }, { t: 0, c: 'A', op: 'close', file: 'f' }] };
  const r = D.run(Object.assign({ dupCache: false }, base));
  t.eq(kinds(r, 'retry').map((o) => o.t), [6], 'the lost reply makes A retry at 6');
  t.eq(kinds(r, 're-execute').map((o) => [o.t, o.xid, o.version, o.say]), [[7, 2, 3, 'The server has no record of xid 2, so it performs the WRITE again: version 3.']], 'without the cache the server performs the WRITE again at 7: version 3');
  t.eq([kinds(r, 'lost-update').length, r.server.files.f.version, r.server.files.f.data], [0, 3, 'mine'], 'its own write twice: no lost update, version 3');
  const c = D.run(Object.assign({ dupCache: true }, base));
  t.eq([kinds(c, 'dup-reply').map((o) => o.t), kinds(c, 're-execute').length, c.server.files.f.version], [[7], 0, 2], 'with the cache the retry is answered from it at 7: still version 2');
  // a client overwriting its own earlier version is no lost update either
  const own = D.run({ protocol: 'afs', files: { f: 'v1' }, script: [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'write', file: 'f', data: 'one' }, { t: 0, c: 'A', op: 'close', file: 'f' }, { t: 6, c: 'A', op: 'write', file: 'f', data: 'two' }, { t: 6, c: 'A', op: 'close', file: 'f' }] });
  t.eq([kinds(own, 'lost-update').length, own.server.files.f.data], [0, 'two'], 'one client writing twice: no lost update');
  // breaking callbacks is mentioned only when the server holds promises to break
  const alone = own.events.filter((e) => e.kind === 'store');
  t.ok(alone.length === 2 && alone.every((e) => /tells no one/.test(e.say) && !e.broke.length), 'a store with no other callback holder tells no one');
  const two = D.run(afs1).events.find((e) => e.kind === 'store');
  t.ok(/breaks the callback of A\./.test(two.say) && two.broke.join() === 'A', 'a store with A holding a callback names A');
}
// 8. structured fields, checked against the hand-worked timeline of scenario 1 and 2
{
  const r = D.run(nfs1), ev = (k, c) => r.events.filter((e) => e.kind === k && (!c || e.client === c));
  t.eq(ev('attr-hit', 'A').map((e) => [e.t, e.file, e.cached, e.age, e.expires, e.version]), [[2, 'f', true, 0, 5, 1], [5, 'f', true, 1, 7, 1]], 'attr-hit: at 2 (cached at 2, expires 5) and at 5 (refreshed at 4, expires 7)');
  t.eq(ev('attr-check', 'A').map((e) => [e.t, e.cached, e.age, e.expires, e.version, e.changed]), [[11, false, 5, 14, 2, true]], 'attr-check at 11: the attributes were 5 ticks old; version 2, a change; they now expire at 14');
  t.eq(ev('write', 'B').map((e) => e.buffered), [['f']], 'B holds f unflushed after its write');
  t.eq(ev('close', 'B').map((e) => [e.flushed, e.version, e.buffered]), [[true, 2, []]], 'B flushes at close: version 2, nothing left buffered');
  t.eq(ev('open', 'A').map((e) => [e.version, e.cached, e.invalidated]), [[1, false, false]], 'A opens at version 1 with nothing cached');
  t.ok(r.events.every((e) => e.client === e.c || e.server), 'every event names its client (or the server)');
  const a = D.run(afs1), aev = (k) => a.events.filter((e) => e.kind === k);
  t.eq(aev('break').map((e) => [e.t, e.client, e.file]), [[5, 'A', 'f']], 'break: A, file f, at 5');
  t.eq(aev('store').map((e) => [e.client, e.version, e.broke, e.buffered]), [['B', 2, ['A'], []]], 'store: B makes version 2, breaking A');
  t.eq(aev('fetch').map((e) => [e.t, e.client, e.version, e.promise]), [[2, 'A', 1, true], [3, 'B', 1, true], [10, 'A', 2, true]], 'fetches with their versions');
  const p = D.run(Object.assign({}, afs2, { probe: 4 }));
  t.eq(p.events.filter((e) => e.kind === 'epoch').map((e) => [e.client, e.epoch, e.dropped]), [['A', 2, ['f']], ['B', 2, []]], 'epoch: A drops its promise on f, B had none');
}
// determinism, and three clients
{
  const three = { protocol: 'afs', clients: ['A', 'B', 'C'], files: { f: '0' }, script: ['A', 'B', 'C'].flatMap((c, i) => [{ t: i, c, op: 'open', file: 'f' }, { t: i, c, op: 'read', file: 'f' }]).concat([{ t: 6, c: 'C', op: 'write', file: 'f', data: '1' }, { t: 6, c: 'C', op: 'close', file: 'f' }]) };
  const r = D.run(three);
  t.eq(r.costs.byKind.BREAK, 2, 'three clients: C\'s store breaks the callbacks of A and B');
  t.eq(JSON.stringify(D.run(three).events), JSON.stringify(r.events), 'the same scenario gives the same timeline');
}
t.done();
