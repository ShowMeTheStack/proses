// The two protocols of the distributed-file-system timeline (dfs-a-sim.js).
// NFS-style: a stateless server (it remembers nothing about clients but its duplicate-request cache) and
//   idempotent requests named by file and offset, so a client simply retries until it hears back.
//   open    GETATTR (close-to-open: a client checks the file's version whenever it opens it)
//   read    from the client's cache while its cached attributes are younger than attrTimeout and its cached data
//           matches them; otherwise GETATTR and, if the version moved, READ. Inside the timeout a read can be stale.
//   write   buffered at the client; close flushes it (WRITE) - flush on close
//   create, remove   not idempotent: a retried REMOVE whose first copy was done but whose reply was lost fails
//           with ENOENT unless the server's duplicate-request cache remembers it (lost in a server crash)
// AFS-style: whole-file caching with callbacks. open FETCHes the whole file unless the client holds a callback
//   promise for it, in which case nothing is sent; reads and writes are local; close STOREs a changed file, and
//   the server breaks the callbacks of every other client caching it (BREAK messages). A server crash forgets the
//   promises: clients learn of the new epoch from any reply or from a PROBE every `probe` ticks, and then drop
//   every promise they hold.
// Both report a lost update when a write replaces another client's version its writer never saw (last close wins);
// a request seen again with the same xid is answered from the duplicate-request cache when there is one; without
// it the server does it again (a 're-execute' outcome: the version moves on).
(function (S) {
  'use strict';
  const D = (S.DFS = S.DFS || {});
  D.protocols = D.protocols || {};
  const q = (x) => JSON.stringify(x);
  const F1 = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function serveCommon(sim, m) {
    const fs = sim.server.files, f = fs.get(m.file);
    if (m.kind === 'CREATE') { if (f) return { ok: false, err: 'EEXIST' }; fs.set(m.file, { data: '', version: 1 }); return { ok: true, version: 1 }; }
    if (m.kind === 'REMOVE') { if (!f) return { ok: false, err: 'ENOENT' }; fs.delete(m.file); return { ok: true, broke: breakAll(sim, m.file, m.from) }; }
    if (m.kind === 'PROBE') return { ok: true };
    if (!f) return { ok: false, err: 'ENOENT' };
    if (m.kind === 'GETATTR') return { ok: true, version: f.version, size: f.data.length };
    if (m.kind === 'READ' || m.kind === 'FETCH') {
      if (m.kind === 'FETCH') { const s = sim.server.callbacks.get(m.file) || new Set(); s.add(m.from); sim.server.callbacks.set(m.file, s); }
      return { ok: true, data: f.data, version: f.version };
    }
    if (m.kind === 'WRITE' || m.kind === 'STORE') {
      // the same request again with no duplicate-request cache to catch it: a stateless server simply does it again
      const again = f.xid === m.xid && f.writer === m.from;
      // a lost update: the version being replaced was written by another client, and this writer never saw it
      if (m.base !== undefined && m.base !== f.version && f.writer && f.writer !== m.from) sim.outcome(m.from, 'lost-update', `${m.from}'s ${m.kind} of ${m.file} replaces version ${f.version} (${q(f.data)}), written by ${f.writer}, which ${m.from} never saw: ${f.writer}'s update is lost.`, { file: m.file, lost: f.data, by: f.writer });
      f.data = m.data; f.version++; f.writer = m.from; f.xid = m.xid;
      if (again) sim.outcome('S', 're-execute', `The server has no record of xid ${m.xid}, so it performs the ${m.kind} again: version ${f.version}.`, { file: m.file, xid: m.xid, version: f.version, from: m.from });
      const broke = m.kind === 'STORE' ? breakAll(sim, m.file, m.from) : [];
      return { ok: true, version: f.version, broke };
    }
    return { ok: false, err: 'EINVAL' };
  }
  /** break every other client's callback on the file; returns the clients told */
  function breakAll(sim, file, except) {
    const s = sim.server.callbacks.get(file), told = [];
    if (!s) return told;
    for (const c of s) if (c !== except) { sim.send('S', c, 'BREAK', { file, xid: 0 }); told.push(c); }
    sim.server.callbacks.set(file, new Set(except && s.has(except) ? [except] : []));
    return told;
  }
  const fail = (sim, c, r, what) => { sim.outcome(c.name, 'error', `${c.name}: ${what} fails with ${r.err}.`, { err: r.err }); return null; };
  const buffered = (c) => [...c.cache].filter(([, e]) => e.dirty).map(([f]) => f).sort();
  const ownRead = (sim, c, file, e) => { sim.reads.push({ t: sim.t, c: c.name, file, got: e.data, latest: e.data, stale: false, how: 'own' }); sim.outcome(c.name, 'own-read', `${c.name} reads its own unflushed write to ${file}: ${q(e.data)}.`, { file, got: e.data, buffered: buffered(c) }); return e.data; };

  D.protocols.nfs = {
    cacheable: (k) => k === 'CREATE' || k === 'REMOVE' || k === 'WRITE',
    serve: serveCommon,
    notify() {},
    newEpoch(sim, c, epoch) { c.epoch = epoch; },
    ops: {
      *open(sim, c, s) {
        const r = yield { kind: 'GETATTR', file: s.file };
        if (!r.ok) return fail(sim, c, r, 'open ' + s.file);
        const e = c.cache.get(s.file) || { data: null, dataVersion: 0 }, had = e.data !== null;
        if (e.dataVersion !== r.version && !e.dirty) e.data = null;
        e.attrVersion = r.version; e.attrT = sim.t; c.cache.set(s.file, e);
        sim.ev(c.name, 'open', `${c.name} opens ${s.file}: the server says version ${r.version}${e.data === null ? (had ? ', newer than its cached copy, which it drops' : '') : ', the same as its cached copy'}.`, { file: s.file, version: r.version, cached: e.data !== null, invalidated: had && e.data === null });
        return true;
      },
      *read(sim, c, s) {
        let e = c.cache.get(s.file);
        if (e && e.dirty) return ownRead(sim, c, s.file, e);
        if (!e || sim.t - e.attrT >= sim.o.attrTimeout) {
          const age = e ? sim.t - e.attrT : null;
          const r = yield { kind: 'GETATTR', file: s.file };
          if (!r.ok) return fail(sim, c, r, 'read ' + s.file);
          e = e || { data: null, dataVersion: 0 };
          const changed = e.attrVersion !== undefined && e.attrVersion !== r.version;
          if (e.dataVersion !== r.version) e.data = null;
          e.attrVersion = r.version; e.attrT = sim.t; c.cache.set(s.file, e);
          sim.ev(c.name, 'attr-check', age === null ? `${c.name} has no cached attributes for ${s.file}: it asks the server, which says version ${r.version}.` : `${c.name}'s cached attributes for ${s.file} were ${F1(age, 'tick')} old, at or past the timeout of ${sim.o.attrTimeout}: it asks the server, which says version ${r.version}${changed ? ', a change' : ', unchanged'}.`, { file: s.file, cached: false, age, expires: sim.t + sim.o.attrTimeout, version: r.version, changed });
        } else sim.ev(c.name, 'attr-hit', `${c.name}'s cached attributes for ${s.file} are ${F1(sim.t - e.attrT, 'tick')} old, under the timeout of ${sim.o.attrTimeout}: it does not ask the server.`, { file: s.file, cached: true, age: sim.t - e.attrT, expires: e.attrT + sim.o.attrTimeout, version: e.attrVersion });
        if (e.data !== null && e.dataVersion === e.attrVersion) return D.recordRead(sim, c, s.file, e.data, 'from its cache');
        const r = yield { kind: 'READ', file: s.file };
        if (!r.ok) return fail(sim, c, r, 'read ' + s.file);
        e.data = r.data; e.dataVersion = e.attrVersion = r.version; e.attrT = sim.t;
        return D.recordRead(sim, c, s.file, e.data, 'from the server', true);
      },
      *write(sim, c, s) {
        const e = c.cache.get(s.file) || { data: null, dataVersion: 0, attrVersion: 0, attrT: -99 };
        if (!e.dirty) e.base = e.attrVersion || e.dataVersion || undefined;
        e.data = s.data; e.dirty = true; c.cache.set(s.file, e);
        sim.ev(c.name, 'write', `${c.name} writes ${q(s.data)} to ${s.file} in its own memory; the server will see it at close.`, { file: s.file, buffered: buffered(c) });
        return true;
      },
      *close(sim, c, s) {
        const e = c.cache.get(s.file);
        if (!e || !e.dirty) { sim.ev(c.name, 'close', `${c.name} closes ${s.file}: nothing to flush.`, { file: s.file, flushed: false, buffered: buffered(c) }); return true; }
        const r = yield { kind: 'WRITE', file: s.file, data: e.data, base: e.base };
        if (!r.ok) return fail(sim, c, r, 'close ' + s.file);
        e.dirty = false; e.dataVersion = e.attrVersion = r.version; e.attrT = sim.t;
        sim.ev(c.name, 'close', `${c.name} closes ${s.file}: the flush made it version ${r.version} at the server.`, { file: s.file, flushed: true, version: r.version, buffered: buffered(c) });
        return true;
      },
      *create(sim, c, s) { const r = yield { kind: 'CREATE', file: s.file }; if (!r.ok) return fail(sim, c, r, 'create ' + s.file); sim.ev(c.name, 'create', `${c.name} creates ${s.file}.`); return true; },
      *remove(sim, c, s) { const r = yield { kind: 'REMOVE', file: s.file }; c.cache.delete(s.file); if (!r.ok) return fail(sim, c, r, 'remove ' + s.file); sim.ev(c.name, 'remove', `${c.name} removes ${s.file}.`, { file: s.file, broke: [] }); return true; },
    },
  };

  D.protocols.afs = {
    cacheable: (k) => k === 'CREATE' || k === 'REMOVE' || k === 'STORE',
    serve: serveCommon,
    notify(sim, c, m) {
      if (m.kind === 'BREAK') { const e = c.cache.get(m.file); if (e) e.cb = false; sim.ev(c.name, 'break', `${c.name} hears its callback on ${m.file} is broken: its cached copy will not be trusted at the next open.`, { file: m.file }); }
      if (m.kind === 'PROBE-REPLY' && m.epoch !== c.epoch) D.protocols.afs.newEpoch(sim, c, m.epoch);
    },
    newEpoch(sim, c, epoch) {
      c.epoch = epoch;
      const dropped = [];
      for (const [f, e] of c.cache) if (e.cb) { e.cb = false; dropped.push(f); }
      const n = dropped.length;
      sim.ev(c.name, 'epoch', `${c.name} learns the server restarted (epoch ${epoch}): it drops ${n} callback promise${n === 1 ? '' : 's'}.`, { epoch, dropped: dropped.sort() });
    },
    ops: {
      *open(sim, c, s) {
        const e = c.cache.get(s.file);
        if (e && e.cb) { sim.ev(c.name, 'cb-hit', `${c.name} opens ${s.file}: it holds a callback promise, so it uses its cached copy with no message at all.`, { file: s.file, version: e.version }); return true; }
        const r = yield { kind: 'FETCH', file: s.file };
        if (!r.ok) return fail(sim, c, r, 'open ' + s.file);
        c.cache.set(s.file, { data: r.data, version: r.version, cb: true, dirty: false });
        sim.ev(c.name, 'fetch', `${c.name} fetches the whole of ${s.file} (version ${r.version}); the server promises to call back if it changes.`, { file: s.file, version: r.version, promise: true });
        return true;
      },
      *read(sim, c, s) {
        const e = c.cache.get(s.file);
        if (!e) return fail(sim, c, { err: 'EBADF' }, 'read ' + s.file + ' (not open)');
        if (e.dirty) return ownRead(sim, c, s.file, e);
        return D.recordRead(sim, c, s.file, e.data, 'from its whole-file cache');
      },
      *write(sim, c, s) {
        const e = c.cache.get(s.file);
        if (!e) return fail(sim, c, { err: 'EBADF' }, 'write ' + s.file + ' (not open)');
        e.data = s.data; e.dirty = true;
        sim.ev(c.name, 'write', `${c.name} writes ${q(s.data)} to its local copy of ${s.file}.`, { file: s.file, buffered: buffered(c) });
        return true;
      },
      *close(sim, c, s) {
        const e = c.cache.get(s.file);
        if (!e || !e.dirty) { sim.ev(c.name, 'close', `${c.name} closes ${s.file}: unchanged, nothing sent.`, { file: s.file, flushed: false, buffered: buffered(c) }); return true; }
        const r = yield { kind: 'STORE', file: s.file, data: e.data, base: e.version };
        if (!r.ok) return fail(sim, c, r, 'close ' + s.file);
        e.dirty = false; e.version = r.version;
        const told = r.broke || [];
        sim.ev(c.name, 'store', `${c.name} closes ${s.file}: the whole file goes back to the server as version ${r.version}` + (told.length ? `, and the server breaks the callback${told.length === 1 ? '' : 's'} of ${told.join(' and ')}.` : '; the server holds no other callback promise on it, so it tells no one.'), { file: s.file, version: r.version, broke: told, buffered: buffered(c) });
        return true;
      },
      *create(sim, c, s) { const r = yield { kind: 'CREATE', file: s.file }; if (!r.ok) return fail(sim, c, r, 'create ' + s.file); sim.ev(c.name, 'create', `${c.name} creates ${s.file}.`); return true; },
      *remove(sim, c, s) { const r = yield { kind: 'REMOVE', file: s.file }; c.cache.delete(s.file); if (!r.ok) return fail(sim, c, r, 'remove ' + s.file); const told = r.broke || []; sim.ev(c.name, 'remove', `${c.name} removes ${s.file}` + (told.length ? `, and the server breaks the callback${told.length === 1 ? '' : 's'} of ${told.join(' and ')}.` : '.'), { file: s.file, broke: told }); return true; },
    },
  };
})(globalThis.Proses = globalThis.Proses || {});
