// Part 16, requests that are not idempotent: REMOVE and CREATE change what a second try finds. Their reply is lost,
// the client retries with the same xid, and the second try fails (ENOENT, EEXIST) though the first one worked, unless
// the server keeps a duplicate-request cache that answers a repeated xid with the reply it already gave. A server crash
// empties that cache (S.DFS.run, NFS-style).
(function (S) {
  'use strict';
  const H = S.P16;
  function cfgOf(inp) {
    const file = inp.op === 'remove' ? 'old-chart' : 'new-chart', kind = inp.op.toUpperCase();
    const base = { protocol: 'nfs', clients: ['A'], files: inp.op === 'remove' ? { 'old-chart': 'superseded' } : {}, latency: 1, timeout: 4, attrTimeout: 3, dupCache: inp.dup === 'on', script: [{ t: 0, c: 'A', op: inp.op, file }] };
    const clean = S.DFS.run(base), rep = clean.messages.find((m) => m.kind === kind + '-REPLY');
    const cfg = Object.assign({}, base, { drops: [{ t: rep.sent, dir: 'reply', c: 'A', op: kind + '-REPLY' }] });
    if (inp.crash === 'yes') cfg.crashes = [{ t: rep.sent + 1, until: rep.sent + 3 }];
    return cfg;
  }

  S.topic({
    id: 'dfs-dupcache', family: 'p16-stateless', order: 20, title: 'Requests that are not idempotent',
    blurb: 'Removing a file, or creating one, cannot safely be done twice: the second try finds the first one\'s result and fails. If the reply to a REMOVE is lost, the client retries, and the server, which already removed the file, answers "no such file". A duplicate-request cache remembers recent requests by xid and sends the same reply again. It lives in memory, so a server crash forgets it.',
    inputs: [
      { id: 'op', kind: 'choice', label: 'request', def: 'remove', options: [{ value: 'remove', label: 'REMOVE a file' }, { value: 'create', label: 'CREATE a file' }] },
      { id: 'dup', kind: 'choice', label: 'duplicate-request cache', def: 'on', options: [{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }] },
      { id: 'crash', kind: 'choice', label: 'server crash before the retry', def: 'no', options: [{ value: 'no', label: 'no' }, { value: 'yes', label: 'yes' }] },
    ],
    presets: [
      { label: 'Lost reply, no cache: a false error', values: { op: 'remove', dup: 'off', crash: 'no' } },
      { label: 'The cache answers the retry', values: { op: 'remove', dup: 'on', crash: 'no' } },
      { label: 'A crash empties the cache', values: { op: 'remove', dup: 'on', crash: 'yes' } },
      { label: 'CREATE retried, no cache', values: { op: 'create', dup: 'off', crash: 'no' } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'bytes', label: 'bytes sent' }],
    run(inp) {
      const cfg = cfgOf(inp), r = H.run(cfg), sum = H.summary(r), err = r.outcomes.find((x) => x.kind === 'error'), dup = r.outcomes.find((x) => x.kind === 'dup-reply');
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1], kind = inp.op.toUpperCase();
      last.say += err ? ` So A is told ${err.err}, though its ${kind} worked the first time: a ${kind} is not idempotent, and ${inp.dup === 'on' ? 'the crash wiped the cache that would have caught the repeat' : 'nothing at the server recognised the repeat'}.` : dup ? ` A sees success, as it should: the duplicate-request cache recognised xid ${r.messages.find((m) => m.to === 'S' && m.retry).xid} and replayed the answer without doing the ${kind} twice.` : '';
      Object.assign(last.meta, { sum, error: !!err, dup: !!dup });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Not idempotent', text: ['REMOVE twice: the second finds no file (ENOENT)', 'CREATE twice: the second finds it there (EEXIST)', 'duplicate-request cache: xid → the reply given', 'a repeated xid: the same reply, no second try', 'the cache is in memory: a crash loses it'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'What will A be told in the end?', options: ['success', 'an error'], answer: (fr) => (fr[fr.length - 1].meta.error ? 'an error' : 'success'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why can a retried REMOVE fail although the file was removed?', options: ['the first try removed it, so the second finds nothing', 'the network corrupted it', 'the server is down', 'the xid changed'], answer: 0, why: 'REMOVE is not idempotent.' },
      { q: 'What does a duplicate-request cache store?', options: ['recent requests by xid, with the reply each got', 'file data', 'client caches', 'open files'], answer: 0, why: 'A repeat of a recent xid is answered from it.' },
      { q: 'Why is that cache only a partial fix?', options: ['it is in memory and forgotten in a crash, and it holds only recent requests', 'it is too slow', 'it breaks idempotent requests', 'clients ignore it'], answer: 0, why: 'A crash between the first try and the retry leaves the retry unrecognised.' },
      { q: 'Which pair of requests is idempotent?', options: ['READ and WRITE at an offset', 'CREATE and REMOVE', 'RENAME and LINK', 'MKDIR and RMDIR'], answer: 0, why: 'The others change the namespace in a way a second try notices.' },
    ],
  });
  S.P16.dupCfg = cfgOf;
})(globalThis.Proses = globalThis.Proses || {});
