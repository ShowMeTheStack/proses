// Part 16, stateless servers and idempotent requests (the NFS idea), on S.DFS.run: a request or its reply is lost, or
// the server crashes and restarts, and the client simply sends the same request again (same xid) after its timeout.
// That is safe because the server keeps no state about the client and the requests are idempotent: a READ or a WRITE
// of the same bytes at the same offset done twice leaves things as done once.
(function (S) {
  'use strict';
  const H = S.P16;
  const CASES = {
    readreply: { label: 'a READ reply is lost', kind: 'READ-REPLY', dir: 'reply' },
    writereq: { label: 'a WRITE request is lost', kind: 'WRITE', dir: 'request' },
    writereply: { label: 'a WRITE is done but its reply is lost', kind: 'WRITE-REPLY', dir: 'reply' },
    crash: { label: 'the server crashes in the middle', crash: true },
  };
  /** the scenario: A opens, reads, writes and closes; the fault is placed on the run without it */
  function cfgOf(inp) {
    const base = { protocol: 'nfs', clients: ['A'], dupCache: inp.dup === 'on', files: { tides: 'High water at 06:10.' }, latency: 1, timeout: inp.timeout, attrTimeout: 3, script: [{ t: 0, c: 'A', op: 'open', file: 'tides' }, { t: 0, c: 'A', op: 'read', file: 'tides' }, { t: 0, c: 'A', op: 'write', file: 'tides', data: 'High water at 06:25.' }, { t: 0, c: 'A', op: 'close', file: 'tides' }] };
    const C = CASES[inp.fault], clean = S.DFS.run(base);
    if (C.crash) { const m = clean.messages.find((x) => x.kind === (inp.during === 'write' ? 'WRITE' : 'READ')); return Object.assign({}, base, { crashes: [{ t: m.sent + 1, until: m.sent + 1 + inp.down }] }); }
    const m = clean.messages.find((x) => x.kind === C.kind);
    return Object.assign({}, base, { drops: [{ t: m.sent, dir: C.dir, c: 'A', op: C.kind }] });
  }

  S.topic({
    id: 'dfs-stateless', family: 'p16-stateless', order: 10, title: 'Retry until it works: a stateless server',
    blurb: 'A stateless server remembers nothing about its clients between requests: every request carries all it needs (the file, the offset, the data). If a request or its reply is lost, or the server crashes and comes back, the client cannot tell which, so it sends the same request again after a timeout. This is safe because the requests are idempotent: reading, or writing the same bytes at the same place, twice is the same as once.',
    inputs: [
      { id: 'dup', kind: 'choice', label: 'duplicate-request cache', def: 'off', options: [{ value: 'off', label: 'off (purely stateless)' }, { value: 'on', label: 'on' }] },
      { id: 'fault', kind: 'choice', label: 'what goes wrong', def: 'writereply', options: Object.entries(CASES).map(([value, c]) => ({ value, label: c.label })) },
      { id: 'timeout', kind: 'number', label: 'retry after (ticks)', def: 4, min: 3, max: 8 },
      { id: 'during', kind: 'choice', label: 'crash during', def: 'read', options: [{ value: 'read', label: 'the read' }, { value: 'write', label: 'the write' }] },
      { id: 'down', kind: 'number', label: 'server down for (ticks)', def: 6, min: 2, max: 14 },
    ],
    presets: [
      { label: 'A lost READ reply', values: { dup: 'off', fault: 'readreply', timeout: 4, during: 'read', down: 6 } },
      { label: 'A lost WRITE request', values: { dup: 'off', fault: 'writereq', timeout: 4, during: 'read', down: 6 } },
      { label: 'A WRITE done twice', values: { dup: 'off', fault: 'writereply', timeout: 4, during: 'read', down: 6 } },
      { label: 'A WRITE retried, with a duplicate cache', values: { dup: 'on', fault: 'writereply', timeout: 4, during: 'read', down: 6 } },
      { label: 'The server crashes during the read', values: { dup: 'off', fault: 'crash', timeout: 4, during: 'read', down: 6 } },
      { label: 'A long outage during the write', values: { dup: 'off', fault: 'crash', timeout: 3, during: 'write', down: 12 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'bytes', label: 'bytes sent' }],
    run(inp) {
      const cfg = cfgOf(inp), r = H.run(cfg), sum = H.summary(r), C = CASES[inp.fault];
      const retried = r.outcomes.filter((x) => x.kind === 'retry'), twice = r.messages.filter((m) => m.to === 'S' && !m.lost).reduce((map, m) => map.set(m.xid, (map.get(m.xid) || 0) + 1), new Map());
      const doneTwice = [...twice].filter(([, n]) => n > 1).map(([x]) => r.messages.find((m) => m.xid === x).kind);
      // a repeated WRITE answered with the version it already had: the server recognised the xid and did not redo it
      const redo = r.outcomes.find((x) => x.kind === 're-execute'), dupd = r.outcomes.find((x) => x.kind === 'dup-reply');
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1], final = r.server.files.tides;
      last.say += ` In the end the server holds "${final.data}", version ${final.version}. ${H.plural(retried.length, 'retry', 'retries')}${doneTwice.length ? '; the server received ' + H.list(doneTwice) + ' twice' : ''}${redo ? `, and with no record of xid ${redo.xid} it wrote the same bytes again: the file is exactly as one write left it, only the version number moved on to ${redo.version}` : dupd ? ', and its duplicate-request cache answered the second copy without doing it again' : doneTwice.length ? ', and since ' + (doneTwice.length === 1 ? 'it is' : 'they are') + ' idempotent the result is the same as if once' : ''}. ${C.crash ? 'Nothing had to be rebuilt after the restart: the server had no state about A to lose.' : redo ? 'That is idempotence: doing the request twice equals doing it once.' : dupd ? 'For an idempotent WRITE the cache only saves work; it matters for requests that are not idempotent, such as REMOVE.' : 'The server never needed to know a retry from a first try.'}`;
      Object.assign(last.meta, { sum, retries: retried.length, version: final.version, twice: doneTwice.length, redo: redo ? { xid: redo.xid, version: redo.version } : null });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Stateless and idempotent', text: ['each request names the file, the offset, the bytes', 'the server keeps no table of clients or open files', 'no reply within the timeout: send it again (same xid)', 'idempotent: twice = once (READ, WRITE at an offset)', 'a crash: restart; clients just retry'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => i === 0, pick: 'option', ask: 'How many times will A send a request again?', options: ['0', '1', '2', '3', '4'], answer: (fr) => String(Math.min(4, fr[fr.length - 1].meta.retries)), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A client gets no reply. Which can it tell apart?', options: ['none of: request lost, reply lost, server slow, server crashed', 'a lost request from a lost reply', 'a crash from a slow server', 'all of them'], answer: 0, why: 'Silence looks the same in every case; so the client retries.' },
      { q: 'Which request is idempotent?', options: ['write these 20 bytes at offset 100', 'append 20 bytes', 'remove the file', 'create the file exclusively'], answer: 0, why: 'Doing it twice gives the same file; the others change what a second try does.' },
      { q: 'After a stateless server reboots, what must it rebuild about its clients?', options: ['nothing', 'its open-file table', 'every client\'s cache', 'the locks'], answer: 0, why: 'It never had any such state.' },
      { q: 'Why is a retried request sent with the same xid?', options: ['so a server that keeps a duplicate cache can recognise it', 'to save bytes', 'the network requires it', 'to cancel the first one'], answer: 0, why: 'The xid names the request, not the attempt.' },
    ],
  });
  S.P16.statelessCfg = cfgOf;
})(globalThis.Proses = globalThis.Proses || {});
