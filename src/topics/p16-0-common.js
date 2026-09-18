// Part 16, distributed file systems: the families, and the machinery every topic shares. A scenario (a script of
// client operations, with lost messages and server crashes) is run by S.DFS.run under the NFS-style or the AFS-style
// protocol; its events, outcomes and messages are laid out on the client–server timeline (S.Kit.ladder), one frame for
// each moment something happens, with each machine's state worked out from the messages so far.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'dfs', order, title, blurb });
  fam('p16-model', 10, 'Clients and servers', 'A file system reached over the network: every open, read and write becomes messages to a server, and every message takes time.');
  fam('p16-stateless', 20, 'Stateless servers and idempotent requests', 'A server that remembers nothing about its clients recovers from a crash by simply restarting; clients retry, which is safe when doing a request twice equals doing it once.');
  fam('p16-cache', 30, 'Client caching and consistency', 'Caching files at the client saves messages but lets copies disagree: attribute timeouts, flush on close and close-to-open consistency, and the last writer winning.');
  fam('p16-afs', 40, 'Whole-file caching with callbacks', 'Fetch the whole file at open, work on it locally, store it at close, and let the server promise to call back when it changes.');
  fam('p16-cost', 50, 'The cost of each design', 'The same work under both designs, measured on the timeline: messages, bytes, server operations, and how stale a read can be.');

  const H = (S.P16 = {});
  const R = Math.round;
  H.plural = (n, w, pl) => n + ' ' + (n === 1 ? w : pl || w + 's');
  H.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: R(x), y: R(y), text: String(text), cls: cls || '' }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  H.q = (s) => '"' + s + '"';
  const REPLY = /-REPLY$/;

  /**
   * run a scenario (cfg as S.DFS.run takes it), dropping any lost update whose overwritten version was its own first
   * copy (the same xid): a retry, not a lost update
   */
  H.run = function (cfg) {
    const r = S.DFS.run(cfg);
    H.selfOverwrite(r);
    // a retry's try number: the copy of its request sent at that moment
    for (const x of r.outcomes) if (x.kind === 'retry') { const m = r.messages.find((y) => y.xid === x.xid && y.from === x.c && y.sent === x.t && y.retry); x.tries = m ? m.retry : 0; }
    r.outcomes = r.outcomes.filter((x) => !x.self);
    return r;
  };
  /** mark the lost-update outcomes whose overwritten version came from the same request (a retry) */
  H.selfOverwrite = function (r) {
    for (const x of r.outcomes) {
      if (x.kind !== 'lost-update') continue;
      const w = r.messages.filter((m) => (m.kind === 'WRITE' || m.kind === 'STORE') && m.to === 'S' && !m.lost && m.file === x.file && m.recv <= x.t).sort((a, b) => a.recv - b.recv || a.id - b.id);
      const cur = w[w.length - 1], prev = w[w.length - 2];
      if (cur && prev && cur.xid === prev.xid && cur.from === prev.from) x.self = true;
    }
    return r;
  };

  /** each machine's state at time t, worked out from the messages delivered and the events so far */
  H.stateAt = function (r, cfg, t) {
    const clients = cfg.clients || ['A', 'B'], files = Object.keys(cfg.files || {});
    const srv = { files: new Map(files.map((f) => [f, { version: 1, exists: true }])), up: true, dup: 0, cb: new Map(), epoch: 1 };
    const cl = new Map(clients.map((c) => [c, new Map()]));
    const ent = (c, f) => { const m = cl.get(c); if (!m.has(f)) m.set(f, {}); return m.get(f); };
    // what happened up to t, in time order: replies leaving the server (its decisions), messages arriving at clients
    const evs = [];
    for (const m of r.messages) {
      if (m.from === 'S' && m.sent <= t) evs.push({ t: m.sent, k: 0, m, at: 'server' });
      if (m.to !== 'S' && !m.lost && m.recv <= t) evs.push({ t: m.recv, k: 1, m, at: 'client' });
    }
    for (const e of r.events) if (e.t <= t) evs.push({ t: e.t, k: e.kind === 'epoch' ? 0.5 : 2, e });
    // a reply from the duplicate-request cache does not name its file: the request with the same xid does
    const fileOf = new Map(r.messages.filter((m) => m.to === 'S' && m.file).map((m) => [m.xid, m.file]));
    for (const cr of cfg.crashes || []) { if (cr.t <= t) evs.push({ t: cr.t, k: -2, crash: true }); if (cr.until <= t) evs.push({ t: cr.until, k: -1, reboot: true }); }
    evs.sort((a, b) => a.t - b.t || a.k - b.k);
    for (const x of evs) {
      if (x.crash) { srv.up = false; srv.dup = 0; srv.cb.clear(); continue; }
      if (x.reboot) { srv.up = true; srv.epoch++; continue; }
      if (x.e) {
        const e = x.e, c = e.c;
        if (c === 'S') continue;
        if (e.kind === 'write' && e.file) ent(c, e.file).dirty = true;
        if (e.kind === 'break' && e.file) ent(c, e.file).cb = false;
        if (e.kind === 'epoch') for (const v of cl.get(c).values()) v.cb = false;
        continue;
      }
      const m = x.m;
      if (x.at === 'server') {
        const f = m.file || fileOf.get(m.xid), kind = m.kind.replace(REPLY, '');
        if ((kind === 'WRITE' || kind === 'STORE') && m.ok && m.version) srv.files.set(f, { version: m.version, exists: true });
        if (kind === 'CREATE' && m.ok) srv.files.set(f, { version: 1, exists: true });
        if (kind === 'REMOVE' && m.ok) srv.files.delete(f);
        if ((kind === 'CREATE' || kind === 'REMOVE') && !m.retry) srv.dup++;
        if (kind === 'FETCH' && m.ok) { const s = srv.cb.get(f) || new Set(); s.add(m.to); srv.cb.set(f, s); }
        if (kind === 'STORE' && m.ok) { const s = srv.cb.get(f); if (s) for (const c of [...s]) if (c !== m.to) s.delete(c); }
        continue;
      }
      // a message arriving at a client
      const c = m.to, f = m.file || fileOf.get(m.xid), kind = m.kind.replace(REPLY, '');
      if (kind === 'GETATTR' && m.ok) Object.assign(ent(c, f), { attrV: m.version, attrT: m.recv });
      if (kind === 'READ' && m.ok) Object.assign(ent(c, f), { dataV: m.version, attrV: m.version, attrT: m.recv });
      if (kind === 'FETCH' && m.ok) Object.assign(ent(c, f), { dataV: m.version, cb: true });
      if ((kind === 'WRITE' || kind === 'STORE') && m.ok) Object.assign(ent(c, f), { dirty: false, dataV: m.version, attrV: m.version, attrT: m.recv });
      if (m.kind === 'BREAK') ent(c, f).cb = false;
    }
    return { srv, cl, t };
  };
  /** a lane's state as a few short lines */
  H.lines = function (st, id, cfg) {
    if (id === 'S') {
      const out = [];
      if (!st.srv.up) out.push('down');
      for (const [f, v] of st.srv.files) out.push(`${f} v${v.version}`);
      if (cfg.protocol === 'afs') { const cbs = [...st.srv.cb].filter(([, s]) => s.size).map(([f, s]) => `${f}→${[...s].join(',')}`); out.push(cbs.length ? 'promises ' + cbs.join(' ') : 'no promises'); }
      else out.push('dup cache: ' + st.srv.dup);
      return out.slice(0, 3);
    }
    const out = [];
    for (const [f, v] of st.cl.get(id)) {
      const parts = [];
      if (v.dataV) parts.push('v' + v.dataV);
      if (cfg.protocol === 'afs') { if (v.cb) parts.push('promise'); }
      else if (v.attrT !== undefined) parts.push('attrs ' + H.plural(st.t - v.attrT, 'tick') + ' old');
      if (v.dirty) parts.push('dirty');
      out.push(`${f}: ${parts.join(', ') || 'nothing'}`);
    }
    return out.length ? out.slice(0, 3) : ['nothing cached'];
  };

  const MARKS = {
    'stale-read': ['stale', (o) => 'stale read'], 'fresh-read': ['fresh', () => 'fresh read'], 'own-read': ['fresh', () => 'reads its own write'],
    'lost-update': ['lostupd', () => 'update lost'], error: ['err', (o) => (o.err ? o.err : 'error')], retry: ['', (o) => 'retry (try ' + (o.tries || '') + ')'],
    'attr-hit': ['', () => 'cached attrs'], 'cb-hit': ['fresh', () => 'promise: no message'], break: ['', () => 'promise broken'], epoch: ['', () => 'drops promises'],
    op: ['', (o) => o.op + ' ' + (o.file || '')],
    open: ['', () => 'opened'], close: ['', () => 'closed'], fetch: ['', () => 'fetched, promise'], store: ['', () => 'stored'], create: ['', () => 'created'], remove: ['', () => 'removed'], write: ['', () => 'write kept locally'],
  };
  const PRI = ['stale-read', 'lost-update', 'error', 'fresh-read', 'own-read', 'retry', 'cb-hit', 'attr-hit', 'break', 'epoch', 'close', 'store', 'open', 'fetch', 'create', 'remove', 'write', 'op'];

  /**
   * the frames of a run: one per moment with something happening. o: {cfg, r, title(t), extra(t, st) -> items,
   * note(t) -> sentence added to the narration, meta(t) -> more meta}
   */
  H.frames = function (o) {
    const r = o.r, cfg = o.cfg, Fr = new S.Frames(['msgs', 'bytes', 'stale']);
    const clients = cfg.clients || ['A', 'B'];
    const lanes = clients.length === 1 ? [clients[0], 'S'] : [clients[0], 'S'].concat(clients.slice(1));
    const msgs = r.messages, times = new Set([0]);
    for (const e of r.events) times.add(e.t);
    for (const x of r.outcomes) times.add(x.t);
    for (const m of msgs) { times.add(m.sent); if (!m.lost || m.lost === 'server down') times.add(m.recv); }
    for (const cr of cfg.crashes || []) { times.add(cr.t); times.add(cr.until); }
    const T = [...times].sort((a, b) => a - b);
    const marksOf = (t) => {
      const by = new Map();
      for (const x of r.outcomes.filter((x) => x.t <= t && x.c !== 'S')) { const k = x.c + ':' + x.t; (by.get(k) || by.set(k, []).get(k)).push(Object.assign({ kind: x.kind }, x)); }
      for (const x of r.events.filter((x) => x.t <= t && x.c !== 'S' && MARKS[x.kind])) { const k = x.c + ':' + x.t; (by.get(k) || by.set(k, []).get(k)).push(Object.assign({ kind: x.kind }, x)); }
      const out = [];
      for (const [k, list] of by) {
        list.sort((a, b) => PRI.indexOf(a.kind) - PRI.indexOf(b.kind));
        const top = list[0], [cls, txt] = MARKS[top.kind] || ['', () => top.kind], [c, tt] = k.split(':');
        out.push({ key: 'dl:k' + c + tt, lane: c, t: +tt, text: txt(top), cls: cls + (+tt === t ? ' act' : '') });
      }
      return out;
    };
    let stale = 0;
    T.forEach((t) => {
      const st = H.stateAt(r, cfg, t), sent = msgs.filter((m) => m.sent <= t);
      stale = r.outcomes.filter((x) => x.t <= t && x.kind === 'stale-read').length;
      Fr.set('msgs', sent.length).set('bytes', sent.reduce((a, m) => a + m.bytes, 0)).set('stale', stale);
      const lad = S.Kit.ladder.draw({
        prefix: 'dl', x: 0, y: 0, now: t, times: T, window: o.window || 11, laneW: 250, rowH: 38, headH: 26 + 18 * 3 + 6,
        lanes: lanes.map((id) => ({ id, name: id === 'S' ? 'server' : 'client ' + id, cls: id === 'S' ? 'server' : '', lines: H.lines(st, id, cfg) })),
        messages: sent.map((m) => ({ key: 'dl:m' + m.id, from: m.from, to: m.to, t0: m.sent, t1: m.lost === 'dropped' ? m.sent + 0.5 : m.recv, text: /PROBE/.test(m.kind) ? '' : m.kind + (m.retry ? ' ×' + m.retry : ''), cls: (/PROBE/.test(m.kind) ? 'probe ' : '') + (m.kind === 'BREAK' ? 'cb' : REPLY.test(m.kind) ? 'reply' : '') + (m.sent === t ? ' act' : ''), lost: m.lost })),
        marks: marksOf(t),
        bands: (cfg.crashes || []).filter((cr) => cr.t <= t).map((cr, i) => ({ key: 'dl:down' + i, lane: 'S', t0: cr.t, t1: Math.min(cr.until, t) })),
      });
      const items = lad.items.concat(o.extra ? o.extra(t, st, lad) : []);
      if (msgs.some((m) => /PROBE/.test(m.kind))) items.push(H.text('dl:probes', 0, -14, '· · · dotted: a probe and its reply', 'tick', 13));
      // at one moment, put each outcome where it happened: a read answered at once (from the cache) right after its own
      // start; a read whose reply came in now, before the client's next operation starts
      const now = r.events.filter((e) => e.t === t).map((e) => ({ c: e.c, kind: e.kind, say: e.say, op: e.op }));
      for (const c of new Set(r.outcomes.filter((y) => y.t === t).map((y) => y.c))) {
        const outs = r.outcomes.filter((y) => y.t === t && y.c === c).map((y) => ({ c, kind: y.kind, say: y.say }));
        const sync = [];
        now.forEach((e, k) => { if (e.c === c && e.kind === 'op' && e.op === 'read') { const nx = now.slice(k + 1).findIndex((x) => x.c === c && x.kind === 'op'); const span = nx < 0 ? now.slice(k + 1) : now.slice(k + 1, k + 1 + nx); if (cfg.protocol === 'afs' || span.some((x) => x.c === c && x.kind === 'attr-hit')) sync.push(k); } });
        const reads = outs.filter((y) => /read/.test(y.kind)), early = outs.filter((y) => !/read/.test(y.kind) || reads.indexOf(y) < reads.length - sync.length), late = reads.slice(reads.length - sync.length);
        // the synchronous ones, after their starts (and the events that follow each start), from the last backwards
        for (let j = sync.length - 1; j >= 0; j--) { const k = sync[j]; let at = k + 1; while (at < now.length && !(now[at].c === c && now[at].kind === 'op')) at++; if (late[j]) now.splice(at, 0, late[j]); }
        const first = now.findIndex((e) => e.c === c && e.kind === 'op');
        now.splice(first < 0 ? now.length : first, 0, ...early);
      }
      const told = new Set(r.events.filter((e) => e.kind === 'drop').map((e) => e.msg)), sends = msgs.filter((m) => m.sent === t && !told.has(m.id));
      const sendSay = sends.length ? sends.map((m) => `${m.from === 'S' ? 'The server' : m.from} sends ${m.kind}${m.file ? ' (' + m.file + ')' : ''}${m.to === 'S' ? '' : ' to ' + m.to}${m.lost === 'dropped' ? ', which the network loses' : m.lost === 'server down' ? ', which will arrive while the server is down' : ''}.`).join(' ') : '';
      let say = [now.map((e) => e.say).join(' '), sendSay].filter(Boolean).join(' ');
      if (!say) say = 'Nothing new; messages are on their way.';
      if (o.note) { const n = o.note(t, st); if (n) say += ' ' + n; }
      Fr.add({ items, say: `t = ${t}: ${say}`, title: 't = ' + t, meta: Object.assign({ phase: 't', t, sent: sent.length, bytes: sent.reduce((a, m) => a + m.bytes, 0), xids: sends.map((m) => m.xid), retries: sends.map((m) => m.retry || 0), versions: [...st.srv.files.values()].map((v) => v.version), stale, facts: factsAt(r, cfg, st, t) }, o.meta ? o.meta(t, st) : {}) });
    });
    if (Fr.list.length) Fr.list[0].scenario = cfg;
    return Fr;
  };
  /** the values the sentences at time t may quote, from the configuration, the messages and the worked-out state */
  function factsAt(r, cfg, st, t) {
    const f = { latency: cfg.latency || 1, timeout: cfg.timeout || 4, attrTimeout: cfg.attrTimeout === undefined ? 3 : cfg.attrTimeout, epoch: st.srv.epoch };
    f.xids = r.messages.filter((m) => m.sent <= t).map((m) => m.xid);
    f.tries = r.messages.filter((m) => m.sent <= t).map((m) => m.retry || 1);
    f.versions = r.messages.filter((m) => m.sent <= t && m.version).map((m) => m.version);
    f.ages = []; f.cached = 0;
    for (const m of st.cl.values()) for (const v of m.values()) { if (v.attrT !== undefined) f.ages.push(t - v.attrT); if (v.cb) f.cached++; }
    for (const e of r.events) if (e.t === t && typeof e.age === 'number') f.ages.push(e.age);
    // promises held just before this moment (what a client drops when it learns of a restart)
    const before = H.stateAt(r, cfg, t - 1); f.held = [...before.cl.values()].map((m) => [...m.values()].filter((v) => v.cb).length);
    f.crashes = (cfg.crashes || []).flatMap((c) => [c.t, c.until]);
    return f;
  }
  H.factsAt = factsAt;
  /** the engine's sentences quote numbers of their own; the claims check reads them from the run, so keep the run */
  H.summary = (r) => ({ messages: r.costs.messages, bytes: r.costs.bytes, serverOps: r.costs.serverOps, stale: r.outcomes.filter((x) => x.kind === 'stale-read').length, lost: r.outcomes.filter((x) => x.kind === 'lost-update').length, retries: r.outcomes.filter((x) => x.kind === 'retry').length, errors: r.outcomes.filter((x) => x.kind === 'error').length });
})(globalThis.Proses = globalThis.Proses || {});
