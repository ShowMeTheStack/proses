// Distributed file systems on a timeline: two or more clients and one server exchanging messages, with crashes
// and lost messages, under an NFS-style or an AFS-style protocol (dfs-b-proto.js). Time moves in whole ticks; a
// message takes `latency` ticks each way.
//   S.DFS.run({protocol: 'nfs'|'afs', clients: ['A', 'B'], files: {name: text}, script: [{t, c, op, file, data}],
//              latency: 1, timeout: 4, attrTimeout: 3, probe: 0, dupCache: true,
//              crashes: [{t, until}], drops: [{t, dir: 'request'|'reply', c, op}]}) -> result
//     ops: open, read, write (the whole contents, buffered at the client), close, create, remove. A client works
//     through its own ops in order; each starts at its time or when the one before it ends, whichever is later.
//   result: {events: [{t, c, kind, say}], messages: [{id, xid, from, to, kind, file, sent, recv, lost, retry, bytes}],
//            reads: [{t, c, file, got, latest, stale}], outcomes: [{t, c, kind, say}], costs: {messages, bytes,
//            byKind, serverOps, perClient}, server: {files}, clients}
//   outcome kinds: 'stale-read' (a read returned something other than the server's latest committed contents),
//   'fresh-read' (a read answered by the server counts as fresh: it was the latest when served), 'lost-update' (a write replaced another client's version that its writer never saw; a retry of the same request is not one), 'retry', 'dup-reply' (the
//   server's duplicate-request cache answered a retried request), 'error'.
// Structured fields (so a view never has to parse a sentence). Every event and outcome has t, c, kind, say, and
// client (the client's name) or server: true. Besides those:
//   NFS open {file, version, cached: whether cached data is kept, invalidated}
//   NFS attr-hit {file, cached: true, age, expires (the tick the cached attributes expire), version}
//   NFS attr-check {file, cached: false, age (null if none were cached), expires, version, changed}
//   write {file, buffered: [files this client holds unflushed]}   own-read {file, got, buffered}
//   NFS close {file, flushed, version, buffered}   AFS store {file, version, broke: [clients told], buffered}
//   AFS close (unchanged) {file, flushed: false, buffered}   AFS fetch {file, version, promise: true}
//   AFS cb-hit {file, version}   break {file}   epoch {epoch, dropped: [files whose promises were dropped]}
//   remove {file, broke}   lost-update {file, lost, by}   re-execute {file, xid, version, from} (server)   stale-read / fresh-read {file, got, latest}
// The server: files with a version each, a duplicate-request cache and callback promises, both in memory, so a
// crash loses them (the files themselves are on its disk and survive). Each crash bumps its epoch.
(function (S) {
  'use strict';
  const D = (S.DFS = S.DFS || {});
  D.protocols = D.protocols || {};
  const len = (x) => (x === undefined || x === null ? 0 : String(x).length);

  D.run = function (cfg) {
    const P = D.protocols[cfg.protocol || 'nfs'];
    if (!P) throw new Error('no protocol ' + cfg.protocol);
    const o = Object.assign({ latency: 1, timeout: 4, attrTimeout: 3, probe: 0, dupCache: true, crashes: [], drops: [], clients: ['A', 'B'], files: {} }, cfg);
    const sim = {
      o, t: 0, events: [], messages: [], reads: [], outcomes: [], queue: [], seq: 0, xid: 0, serverOps: 0,
      server: { files: new Map(Object.entries(o.files).map(([k, v]) => [k, { data: v, version: 1 }])), up: true, epoch: 1, dup: new Map(), callbacks: new Map() },
      clients: new Map(o.clients.map((c) => [c, { name: c, cache: new Map(), ops: o.script.filter((s) => s.c === c).map((s) => Object.assign({}, s)).sort((a, b) => a.t - b.t), busy: null, freeAt: 0, epoch: 1, pending: null }])),
    };
    const at = (t, fn, pri) => { sim.queue.push({ t, fn, n: sim.seq++, pri: pri || 0 }); };
    const who = (c) => (c === 'S' ? { server: true } : { client: c });
    const ev = (c, kind, say, d) => sim.events.push(Object.assign({ t: sim.t, c, kind, say }, who(c), d || {}));
    const outcome = (c, kind, say, d) => sim.outcomes.push(Object.assign({ t: sim.t, c, kind, say }, who(c), d || {}));
    sim.ev = ev; sim.outcome = outcome;
    const dropped = (m) => o.drops.some((d) => d.t === m.sent && (!d.dir || d.dir === (m.from === 'S' ? 'reply' : 'request')) && (!d.c || d.c === (m.from === 'S' ? m.to : m.from)) && (!d.op || d.op === m.kind));

    /** send a message; it arrives latency ticks later unless dropped or the receiver is a server that is down */
    sim.send = function (from, to, kind, body) {
      const m = Object.assign({ id: sim.messages.length + 1, from, to, kind, sent: sim.t, recv: sim.t + o.latency, lost: false, bytes: len(body.data) + 16 }, body);
      if (dropped(m)) { m.lost = 'dropped'; ev(from, 'drop', `The network loses ${kind} from ${from} to ${to === 'S' ? 'the server' : to}${body.xid ? ' (xid ' + body.xid + ')' : ''}.`, { msg: m.id }); }
      sim.messages.push(m);
      if (!m.lost) at(m.recv, () => deliver(m), 0);
      return m;
    };
    function deliver(m) {
      if (m.to === 'S') {
        if (!sim.server.up) { m.lost = 'server down'; ev('S', 'lost', `${m.kind} from ${m.from} (xid ${m.xid}) arrives while the server is down: it is lost.`, { msg: m.id }); return; }
        serve(m);
      } else {
        const c = sim.clients.get(m.to);
        if (m.kind === 'BREAK' || m.kind === 'PROBE-REPLY') { P.notify(sim, c, m); return; }
        if (!c.pending || c.pending.xid !== m.xid) { ev(m.to, 'late', `${m.to} receives a reply for xid ${m.xid} it no longer waits for: ignored.`); return; }
        const p = c.pending; c.pending = null;
        if (m.epoch && m.epoch !== c.epoch) P.newEpoch(sim, c, m.epoch);
        resume(c, p.gen, m);
      }
    }
    function serve(m) {
      const S0 = sim.server;
      if (o.dupCache && S0.dup.has(m.xid)) {
        const r = S0.dup.get(m.xid);
        outcome('S', 'dup-reply', `The server has already done ${m.kind} xid ${m.xid}: its duplicate-request cache sends the same answer again instead of doing it twice.`);
        sim.send('S', m.from, m.kind + '-REPLY', Object.assign({}, r, { xid: m.xid }));
        return;
      }
      sim.serverOps++;
      const r = P.serve(sim, m);
      if (o.dupCache && P.cacheable(m.kind)) S0.dup.set(m.xid, r);
      sim.send('S', m.from, m.kind + '-REPLY', Object.assign({ epoch: S0.epoch }, r, { xid: m.xid, file: m.file }));
    }
    /** a client's operation is a generator; each yield is an RPC whose reply resumes it */
    function resume(c, gen, reply) {
      let r;
      try { r = gen.next(reply); } catch (e) { outcome(c.name, 'error', `${c.name}: ${e.message}`); finish(c); return; }
      if (r.done) { finish(c, r.value); return; }
      call(c, gen, r.value);
    }
    function call(c, gen, rpc) {
      const xid = ++sim.xid, m = sim.send(c.name, 'S', rpc.kind, Object.assign({ xid }, rpc));
      c.pending = { xid, gen, rpc, tries: 1, msg: m };
      armTimeout(c, xid);
    }
    function armTimeout(c, xid) {
      at(sim.t + o.timeout, () => {
        const p = c.pending;
        if (!p || p.xid !== xid || p.done) return;
        p.tries++;
        outcome(c.name, 'retry', `${c.name} has had no reply to ${p.rpc.kind} (xid ${xid}) for ${o.timeout} tick${o.timeout === 1 ? '' : 's'}: it sends it again, same xid (try ${p.tries}).`, { xid });
        const m = sim.send(c.name, 'S', p.rpc.kind, Object.assign({ xid, retry: p.tries }, p.rpc));
        void m; armTimeout(c, xid);
      }, 1);
    }
    function finish(c) { c.busy = null; c.freeAt = sim.t; startNext(c); }
    function startNext(c) {
      if (c.busy || !c.ops.length) return;
      const s = c.ops[0];
      if (s.t > sim.t) { if (!s.armed) { s.armed = true; at(s.t, () => startNext(c), 2); } return; }
      c.ops.shift();
      const fn = P.ops[s.op];
      if (!fn) throw new Error('no operation ' + s.op + ' in ' + o.protocol);
      c.busy = s;
      ev(c.name, 'op', `${c.name} starts ${s.op}(${s.file}${s.data !== undefined ? ', ' + JSON.stringify(s.data) : ''}).`, { op: s.op, file: s.file });
      resume(c, fn(sim, c, s), undefined);
    }
    for (const cr of o.crashes) {
      at(cr.t, () => { const S0 = sim.server; S0.up = false; S0.dup.clear(); S0.callbacks.clear(); ev('S', 'crash', `The server crashes: its duplicate-request cache and its callback promises are lost; the files on its disk survive.`); }, -1);
      at(cr.until, () => { const S0 = sim.server; S0.up = true; S0.epoch++; ev('S', 'reboot', `The server is back (epoch ${S0.epoch}).`); }, -1);
    }
    if (o.probe) for (let t = o.probe; t < 200; t += o.probe) at(t, () => { for (const c of sim.clients.values()) sim.send(c.name, 'S', 'PROBE', { xid: 0 }); }, 3);
    for (const c of sim.clients.values()) startNext(c);
    let guard = 0;
    while (sim.queue.length && guard++ < 20000) {
      sim.queue.sort((a, b) => a.t - b.t || a.pri - b.pri || a.n - b.n);
      const e = sim.queue.shift();
      if (e.t > 400) break;
      sim.t = e.t; e.fn();
      if (o.probe && [...sim.clients.values()].every((c) => !c.busy && !c.ops.length && !c.pending) && !sim.queue.some((q) => q.pri !== 3)) break;
    }
    const byKind = {};
    for (const m of sim.messages) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
    const perClient = {};
    for (const c of o.clients) perClient[c] = sim.messages.filter((m) => m.from === c || m.to === c).length;
    return {
      events: sim.events, messages: sim.messages, reads: sim.reads, outcomes: sim.outcomes, clients: sim.clients,
      server: { files: Object.fromEntries([...sim.server.files].map(([k, v]) => [k, Object.assign({}, v)])) },
      costs: { messages: sim.messages.length, bytes: sim.messages.reduce((a, m) => a + m.bytes, 0), byKind, serverOps: sim.serverOps, perClient },
    };
  };
  /** record a read's result against the server's latest committed contents */
  D.recordRead = function (sim, c, file, got, how, served) {
    const f = sim.server.files.get(file), latest = served ? got : f ? f.data : null, stale = got !== latest;
    sim.reads.push({ t: sim.t, c: c.name, file, got, latest, stale, how });
    sim.outcome(c.name, stale ? 'stale-read' : 'fresh-read', stale ? `${c.name} reads ${file} as ${JSON.stringify(got)} ${how}, but the server already holds ${JSON.stringify(latest)}: a stale read.` : `${c.name} reads ${file} as ${JSON.stringify(got)} ${how}: the latest contents.`, { file, got, latest });
    return got;
  };
  (S.engines = S.engines || []).push({ name: 'Distributed file systems' });
})(globalThis.Proses = globalThis.Proses || {});
