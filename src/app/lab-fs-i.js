// The File-system lab, part nine: the distributed workbench. Two clients and a server exchange messages on a
// timeline (S.DFS.run) under an NFS-style protocol (a stateless server, attribute caching, flush on close, retries
// with a duplicate-request cache) or an AFS-style one (whole files fetched at open, callbacks broken on store). The
// student scripts each client's opens, reads, writes and closes, crashes the server and drops messages; every moment
// is a frame (S.P16.frames over S.Kit.ladder), with the stale reads, lost updates and costs counted.
//   FL.dfsCfg(v) -> the S.DFS.run configuration       FL.dfsRun(v, ctx)
(function (S) {
  'use strict';
  const FL = S.FsLab;
  FL.DFS_OPS = ['open', 'read', 'write', 'close', 'create', 'remove'];
  FL.dfsCfg = function (v) {
    const files = {};
    for (const f of v.dfiles) files[f.name] = f.text;
    return {
      protocol: v.dproto, clients: ['A', 'B'], files,
      script: v.dscript.map((s) => Object.assign({ t: s.t, c: s.c, op: s.op, file: s.file }, s.op === 'write' ? { data: s.data || '' } : {})),
      latency: v.dlat, timeout: v.dtimeout, attrTimeout: v.dattr, probe: v.dproto === 'afs' ? v.dprobe : 0, dupCache: v.ddup,
      crashes: v.dcrash.map((c) => ({ t: c.t, until: c.until })),
      drops: v.ddrops.map((d) => ({ t: d.t, dir: d.dir, c: d.c, op: d.dir === 'reply' ? d.op + '-REPLY' : d.op })),
    };
  };
  FL.dfsCheck = function (v) {
    const names = new Set(v.dfiles.map((f) => f.name));
    for (const [i, s] of v.dscript.entries()) if (s.op !== 'create' && !names.has(s.file) && !v.dscript.slice(0, i).some((x) => x.op === 'create' && x.file === s.file)) return `Script, row ${i + 1}: there is no file ${s.file} (add it under Files, or create it first)`;
    for (const [i, c] of v.dcrash.entries()) if (c.until <= c.t) return `Server crashes, row ${i + 1}: it must come back after it goes down`;
    return null;
  };

  FL.dfsRun = function (v, ctx) {
    const H = S.P16;
    if (!H || !H.frames) return { frames: [], error: { msg: 'the timeline drawing is not loaded' } };
    const cfg = FL.dfsCfg(v);
    let r;
    try { r = S.DFS.run(cfg); } catch (e) { return { frames: [], error: { msg: e.message } }; }
    const Fr = H.frames({ cfg, r, window: ctx.narrow ? 8 : 11 });
    const stale = r.outcomes.filter((x) => x.kind === 'stale-read'), lost = r.outcomes.filter((x) => x.kind === 'lost-update');
    const trace = [], frames = [];
    const rowsUpTo = (t) => ({
      msgs: r.messages.filter((m) => m.sent <= t),
      reads: r.reads.filter((x) => x.t <= t),
    });
    // a phone gets its own, narrower timeline: short lanes, the times in a slim column, only the outcomes marked
    const times = [...new Set([0].concat(r.events.map((e) => e.t), r.outcomes.map((x) => x.t), r.messages.flatMap((m) => [m.sent].concat(!m.lost || m.lost === 'server down' ? [m.recv] : [])), cfg.crashes.flatMap((c) => [c.t, c.until])))].sort((a, b) => a - b);
    const MARK = { 'stale-read': ['stale', 'stale'], 'fresh-read': ['fresh', 'fresh'], 'own-read': ['fresh', 'own'], 'lost-update': ['lostupd', 'lost'], error: ['err', 'error'] };
    const narrowItems = (t) => {
      const st = H.stateAt(r, cfg, t);
      const marks = r.outcomes.filter((x) => x.t <= t && MARK[x.kind] && x.c !== 'S').map((x, k) => ({ key: 'dn:k' + x.c + x.t + x.kind, lane: x.c, t: x.t, text: MARK[x.kind][1], cls: MARK[x.kind][0] + (x.t === t ? ' act' : '') }));
      const seen = new Set(), uniq = marks.filter((m) => { const k = m.lane + m.t; if (seen.has(k)) return false; seen.add(k); return true; });
      return S.Kit.ladder.draw({
        prefix: 'dn', x: 0, y: 0, now: t, times, window: 9, laneW: 172, rowH: 34, headH: 26 + 18 * 2 + 6, marginL: 104,
        lanes: ['A', 'S', 'B'].map((id) => ({ id, name: id === 'S' ? 'server' : 'client ' + id, cls: id === 'S' ? 'server' : '', lines: H.lines(st, id, cfg).slice(0, 2).map((l) => FL.fit(l, 150, 13)) })),
        messages: r.messages.filter((m) => m.sent <= t && !/PROBE/.test(m.kind)).map((m) => ({ key: 'dn:m' + m.id, from: m.from, to: m.to, t0: m.sent, t1: m.lost === 'dropped' ? m.sent + 0.5 : m.recv, text: m.kind.replace('-REPLY', '·R').replace('GETATTR', 'ATTR'), cls: (m.kind === 'BREAK' ? 'cb' : /-REPLY$/.test(m.kind) ? 'reply' : 'req'), lost: m.lost || false })),
        marks: uniq,
        bands: cfg.crashes.filter((c) => c.t <= t).map((c, i) => ({ key: 'dn:down' + i, lane: 'S', t0: c.t, t1: Math.min(c.until, t) })),
      }).items;
    };
    Fr.list.forEach((f) => {
      const t = f.meta.t, u = rowsUpTo(t), nStale = stale.filter((x) => x.t <= t).length;
      if (ctx.narrow) f.items = narrowItems(t);
      trace.push({ kind: 't', t, say: f.say });
      frames.push({
        items: f.items, say: f.say, title: f.title, at: trace.length - 1, hold: 1300,
        tables: [
          { title: 'Messages so far', cols: ['#', 'from', 'to', 'kind', 'file', 'sent', 'arrived', 'bytes'], rows: u.msgs.map((m) => [String(m.id), m.from, m.to, m.kind + (m.retry ? ' ×' + m.retry : ''), m.file || '', String(m.sent), m.lost ? { text: m.lost === 'dropped' ? 'lost' : 'server down', cls: 'bad' } : String(m.recv), String(m.bytes)]) },
          { title: 'Reads', cols: ['t', 'client', 'file', 'got', 'latest', ''], rows: u.reads.map((x) => [String(x.t), x.c, x.file, FL.clip(String(x.got), 18), FL.clip(String(x.latest), 18), x.stale ? { text: 'stale', cls: 'bad' } : { text: 'fresh', cls: 'good' }]) },
        ],
        metrics: [
          { label: 'Messages', value: u.msgs.length }, { label: 'Bytes on the wire', value: u.msgs.reduce((a, m) => a + m.bytes, 0) },
          { label: 'Stale reads', value: nStale, cls: nStale ? 'bad' : 'good' }, { label: 'Lost updates', value: lost.filter((x) => x.t <= t).length, cls: lost.some((x) => x.t <= t) ? 'bad' : '' },
          { label: 'Server operations (whole run)', value: r.costs.serverOps },
        ],
      });
    });
    if (frames.length) {
      const last = frames[frames.length - 1];
      last.say += ` In all: ${FL.plural(r.costs.messages, 'message')}, ${r.costs.bytes} bytes, ${FL.plural(r.costs.serverOps, 'server operation')}, ${FL.plural(stale.length, 'stale read')} and ${FL.plural(lost.length, 'lost update')}.`;
      last.tables = last.tables.concat([{ title: 'Cost by client', cols: ['client', 'messages', 'bytes'], rows: Object.entries(r.costs.perClient || {}).map(([c, x]) => [c, String(x), String(r.messages.filter((m) => m.from === c || m.to === c).reduce((a, m) => a + m.bytes, 0))]) }]);
    }
    return { frames, trace, tables: frames.length ? frames[frames.length - 1].tables : [], metrics: frames.length ? frames[frames.length - 1].metrics : [] };
  };
})(globalThis.Proses = globalThis.Proses || {});
