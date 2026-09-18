// Part 16 claims: the checks every timeline gets, and each topic's own (imported by tests/claims-p16.mjs).
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

export function mods(S) {
  /** the protocol's invariants on one run, and the worked-out state against the engine's final state */
  function common(cfg, fail, pass) {
    const r = S.DFS.run(cfg), lat = cfg.latency || 1, down = (t) => (cfg.crashes || []).some((c) => t >= c.t && t < c.until);
    for (const m of r.messages) {
      (m.recv === m.sent + lat ? pass : fail)('message ' + m.id + ' takes the latency');
      if (m.to === 'S' && !m.lost && m.kind !== 'PROBE') {
        const reply = r.messages.find((x) => x.from === 'S' && x.to === m.from && x.xid === m.xid && x.sent === m.recv);
        (reply ? pass : fail)('request ' + m.kind + ' xid ' + m.xid + ' at ' + m.recv + ' is answered at once');
      }
      if (m.to === 'S' && m.lost === 'server down') (down(m.recv) ? pass : fail)('a request lost to a down server arrives while it is down');
    }
    // the state worked out from the messages, at the end, against the engine
    const end = Math.max(0, ...r.messages.map((m) => m.recv), ...r.events.map((e) => e.t)) + 1, st = S.P16.stateAt(r, cfg, end);
    for (const [f, v] of Object.entries(r.server.files)) (st.srv.files.has(f) && st.srv.files.get(f).version === v.version ? pass : fail)('server version of ' + f + ': ' + v.version + ', worked out ' + (st.srv.files.get(f) || {}).version);
    (st.srv.files.size === Object.keys(r.server.files).length ? pass : fail)('the server holds the same files');
    for (const [c, cl] of r.clients) for (const [f, e] of cl.cache) {
      const mine = st.cl.get(c).get(f) || {};
      if (cfg.protocol === 'afs') { (!!mine.cb === !!e.cb ? pass : fail)(c + ' promise on ' + f); if (e.version) (mine.dataV === e.version ? pass : fail)(c + ' cached version of ' + f + ' ' + e.version + ', worked out ' + mine.dataV); }
      else if (e.dataVersion) (mine.dataV === e.dataVersion ? pass : fail)(c + ' cached data version of ' + f);
    }
    return r;
  }
  const scen = (r) => r.frames[0].scenario;
  /** the data the server held at time t: the last WRITE or STORE it carried out by then (requests delivered to it) */
  const serverData = (r, cfg, file, t) => { let d = cfg.files[file]; for (const m of r.messages) if ((m.kind === 'WRITE' || m.kind === 'STORE') && m.to === 'S' && !m.lost && m.file === file && m.recv <= t) d = m.data; return d; };
  return {
    'dfs-stateless': {
      random: (r) => ({ dup: pick(r, ['on', 'off']), fault: pick(r, ['readreply', 'writereq', 'writereply', 'crash']), timeout: int(r, 3, 8), during: pick(r, ['read', 'write']), down: int(r, 2, 14) }),
      check({ input, r, fail, pass }) {
        const cfg = scen(r); common(cfg, fail, pass);
        const m = r.frames[r.frames.length - 1].meta;
        // retries reasoned from the fault: one lost message, one retry; a crash, one retry per timeout until it is back
        const want = input.fault === 'crash' ? Math.ceil(input.down / input.timeout) : 1;
        (m.retries === want ? pass : fail)(`${input.fault}: ${m.retries} retries, reasoned ${want}`);
        (m.twice === (input.fault === 'writereply' || input.fault === 'readreply' ? 1 : 0) ? pass : fail)('requests carried out twice');
        const wantV = input.fault === 'writereply' && input.dup === 'off' ? 3 : 2;
        (m.version === wantV ? pass : fail)(`final version ${m.version}, reasoned ${wantV}: a retried WRITE is done again only with no duplicate cache`);
      },
    },
    'dfs-dupcache': {
      random: (r) => ({ op: pick(r, ['remove', 'create']), dup: pick(r, ['on', 'off']), crash: pick(r, ['no', 'yes']) }),
      check({ input, r, fail, pass }) {
        const cfg = scen(r); common(cfg, fail, pass);
        const m = r.frames[r.frames.length - 1].meta, want = input.dup === 'off' || input.crash === 'yes';
        (m.error === want ? pass : fail)(`${input.op} dup ${input.dup} crash ${input.crash}: error ${m.error}, reasoned ${want}`);
        (m.dup === !want ? pass : fail)('the cache answers exactly when it survived');
      },
    },
    'dfs-attr': {
      random: (r) => { const n = int(r, 1, 5), t = []; for (let k = 0; k < n; k++) t.push(int(r, 3, 30)); return { attr: int(r, 0, 12), bAt: int(r, 1, 10), reads: t.join(' '), reopen: pick(r, ['no', 'yes']) }; },
      check({ input, r, fail, pass }) {
        const cfg = scen(r), R = common(cfg, fail, pass);
        // a read is stale exactly when the data A got differs from what the server held at that moment
        // (a read answered by the server was served one latency before its answer came, and a write landing in the same
        // tick may come before or after it: either is allowed)
        for (const x of R.reads) {
          const at = x.how === 'from the server' ? x.t - 1 : x.t, a = serverData(R, cfg, 'tides', at), b = serverData(R, cfg, 'tides', at - 1);
          ((x.how === 'from the server' ? !x.stale && (x.got === a || x.got === b) : x.stale === (x.got !== a) || x.stale === (x.got !== serverData(R, cfg, 'tides', at - 0.5))) ? pass : fail)('read at ' + x.t + ' (' + x.how + ') stale ' + x.stale);
        }
        // reads answered from the cache only while the attributes are younger than the timeout
        for (const e of R.events.filter((y) => y.kind === 'attr-hit')) { const age = e.age; (age < input.attr ? pass : fail)('a cache hit at age ' + age); }
      },
    },
    'dfs-close': {
      random: (r) => ({ scen: pick(r, ['together', 'turns', 'unflushed']), attr: int(r, 0, 8) }),
      check({ input, r, fail, pass }) {
        const cfg = scen(r), R = common(cfg, fail, pass), m = r.frames[r.frames.length - 1].meta;
        ((m.sum.lost > 0) === (input.scen === 'together') ? pass : fail)('an update is lost only when both edit at once');
        const writes = R.messages.filter((x) => x.kind === 'WRITE' && !x.lost).sort((a, b) => a.recv - b.recv);
        (R.server.files.log.data === writes[writes.length - 1].data ? pass : fail)('the last close wins');
      },
    },
    'dfs-afs': {
      random: (r) => ({ scen: pick(r, ['promise', 'session', 'both']) }),
      check({ input, r, fail, pass }) {
        const cfg = scen(r), R = common(cfg, fail, pass), m = r.frames[r.frames.length - 1].meta;
        // breaks reasoned from the messages: each STORE breaks every other client that fetched since its last break
        const holds = new Map(); let breaks = 0;
        for (const x of R.messages.slice().sort((a, b) => a.recv - b.recv || a.id - b.id)) {
          if (x.kind === 'FETCH' && !x.lost) holds.set(x.from, true);
          if (x.kind === 'STORE' && !x.lost) for (const [c, h] of holds) if (h && c !== x.from) { breaks++; holds.set(c, false); }
        }
        (m.breaks === breaks ? pass : fail)(`${m.breaks} promises broken, reasoned ${breaks}`);
        (m.hits === { promise: 1, session: 0, both: 0 }[input.scen] ? pass : fail)('opens answered by a promise');
      },
    },
    'dfs-afs-crash': {
      random: (r) => { const down = int(r, 1, 8); return { probe: pick(r, [0, 2, 3, 5, 8, 12, 15, 20]), down, reopen: int(r, 10 + down, 30) }; },
      check({ input, r, fail, pass }) {
        const cfg = scen(r); common(cfg, fail, pass);
        const m = r.frames[r.frames.length - 1].meta, up = 4 + input.down;
        // A learns of the restart from the reply to the first probe that reaches the running server
        let learn = Infinity;
        if (input.probe) for (let p = input.probe; p < 200; p += input.probe) if (p + 1 >= up) { learn = p + 2; break; }
        const stale = input.reopen < learn;
        ((m.sum.stale > 0) === stale ? pass : fail)(`probe ${input.probe}: stale ${m.sum.stale}, reasoned ${stale} (learns at ${learn})`);
      },
    },
    'dfs-cost': {
      random: (r) => ({ work: pick(r, ['readmostly', 'shared', 'session']), size: int(r, 10, 2000), attr: int(r, 0, 10) }),
      check({ input, r, fail, pass }) {
        const m = r.frames[r.frames.length - 1].meta;
        for (const [p, sum] of [['nfs', m.N], ['afs', m.A]]) {
          const cfg = S.P16.costCfg(input, p), R = common(cfg, fail, pass);
          (R.costs.messages === sum.messages && R.costs.bytes === sum.bytes ? pass : fail)(p + ' totals');
          const k = R.costs.byKind;
          ((p === 'nfs' ? !k.FETCH && !k.STORE : !k.GETATTR && !k.READ && !k.WRITE) ? pass : fail)(p + ' sends only its own kinds');
          (R.messages.reduce((a, x) => a + x.bytes, 0) === sum.bytes ? pass : fail)(p + ' bytes add up');
        }
      },
    },
    'dfs-model': {
      random: (r) => ({ work: pick(r, ['read', 'edit', 'create']), protocol: pick(r, ['nfs', 'afs']), latency: int(r, 1, 3) }),
      check({ input, r, fail, pass }) {
        const cfg = scen(r), R = common(cfg, fail, pass), last = r.frames[r.frames.length - 1].meta;
        // the requests, reasoned from the program: NFS asks at open (GETATTR), at the first read (READ: the attributes are
        // fresh but no data is cached), at close with changes (WRITE), and to create; AFS fetches at open and stores at close
        const want = { nfs: { read: 2, edit: 3, create: 3 }, afs: { read: 1, edit: 2, create: 3 } }[input.protocol][input.work];
        (last.requests === want ? pass : fail)(`${input.protocol} ${input.work}: ${last.requests} requests, reasoned ${want}`);
        (last.sum.messages === 2 * want && R.costs.messages === 2 * want ? pass : fail)('every request has its reply');
      },
    },
  };
}
