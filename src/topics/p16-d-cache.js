// Part 16, client caching and its consistency (NFS-style, S.DFS.run): two topics. Attribute caching: a client trusts
// its cached copy for a few ticks without asking the server, so another client's change can go unseen for that long.
// Flush on close and close-to-open: a client's writes reach the server when it closes the file, a client that opens
// afterwards sees them, and two clients editing at once lose one update: the last to close wins.
(function (S) {
  'use strict';
  const H = S.P16;
  const parseTimes = (v) => String(v).split(/[\s,]+/).filter(Boolean).map(Number);

  // ---- attribute caching ----
  function attrCfg(inp) {
    const times = parseTimes(inp.reads), a = [{ t: 0, c: 'A', op: 'open', file: 'tides' }, { t: 0, c: 'A', op: 'read', file: 'tides' }];
    for (const t of times) { if (inp.reopen === 'yes') a.push({ t, c: 'A', op: 'open', file: 'tides' }); a.push({ t, c: 'A', op: 'read', file: 'tides' }); }
    const b = [{ t: inp.bAt, c: 'B', op: 'open', file: 'tides' }, { t: inp.bAt, c: 'B', op: 'write', file: 'tides', data: 'High water 06:40 (revised)' }, { t: inp.bAt, c: 'B', op: 'close', file: 'tides' }];
    return { protocol: 'nfs', clients: ['A', 'B'], files: { tides: 'High water 06:10' }, latency: 1, timeout: 4, attrTimeout: inp.attr, script: a.concat(b) };
  }
  S.topic({
    id: 'dfs-attr', family: 'p16-cache', order: 10, title: 'Cached attributes and stale reads',
    blurb: 'To avoid asking the server before every read, an NFS-style client caches a file\'s attributes and trusts them, and its cached data, for a few seconds. Inside that window a change made by another client cannot be seen: the read is answered from the cache, stale. A shorter timeout means fresher reads and more messages; reopening the file checks at once.',
    inputs: [
      { id: 'attr', kind: 'number', label: 'attribute timeout (ticks)', def: 6, min: 0, max: 12 },
      { id: 'bAt', kind: 'number', label: 'B changes the file at', def: 2, min: 1, max: 10 },
      { id: 'reads', kind: 'string', label: 'A reads again at', def: '8 10 13', spaces: true, max: 30, check: (v) => { const t = parseTimes(v); if (!t.length) return 'give some times, like 8 10 13'; if (t.some((x) => !Number.isInteger(x) || x < 1 || x > 40)) return 'times are whole ticks from 1 to 40'; if (t.length > 6) return 'at most 6 reads'; return null; } },
      { id: 'reopen', kind: 'choice', label: 'A reopens before each read', def: 'no', options: [{ value: 'no', label: 'no' }, { value: 'yes', label: 'yes (close-to-open)' }] },
    ],
    presets: [
      { label: 'A long timeout: a stale read', values: { attr: 6, bAt: 2, reads: '8 10 13', reopen: 'no' } },
      { label: 'A short timeout', values: { attr: 2, bAt: 2, reads: '8 10 13', reopen: 'no' } },
      { label: 'No attribute cache', values: { attr: 0, bAt: 2, reads: '8 10 13', reopen: 'no' } },
      { label: 'Reopen before reading', values: { attr: 6, bAt: 2, reads: '8 10 13', reopen: 'yes' } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'stale', label: 'stale reads' }],
    run(inp) {
      const cfg = attrCfg(inp), r = H.run(cfg), sum = H.summary(r), reads = r.reads.filter((x) => x.c === 'A');
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1];
      last.say += ` A read ${H.plural(reads.length, 'time')}: ${reads.filter((x) => !x.stale).length} fresh and ${sum.stale} stale, with ${H.plural(sum.messages, 'message')} in all. ${inp.attr ? `With a timeout of ${inp.attr}, a change can go unseen for up to ${H.plural(inp.attr, 'tick')} after A last asked${inp.reopen === 'yes' ? ', but reopening asks the server every time' : ''}.` : 'With no attribute cache, every read asks the server first: a read can be stale only by what changes while its answer is on the way, at the cost of the most messages.'}`;
      Object.assign(last.meta, { sum, nreads: reads.length, fresh: reads.filter((x) => !x.stale).length });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Attribute caching', text: ['attributes younger than the timeout: trust the cache', 'older: GETATTR; a new version: READ again', 'open: always GETATTR (close-to-open)', 'stale window ≤ the timeout', 'shorter timeout: fresher, more messages'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many of A\'s reads will be stale?', options: ['0', '1', '2', '3 or more'], answer: (fr) => { const n = fr[fr.length - 1].meta.sum.stale; return n >= 3 ? '3 or more' : String(n); }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why cache attributes at all?', options: ['to answer most reads without a round trip to the server', 'to save disk space', 'to lock the file', 'to make writes safe'], answer: 0, why: 'A GETATTR before every read would double the messages.' },
      { q: 'Another client changes the file. How long can this client keep reading the old data?', options: ['up to the attribute timeout after it last checked', 'forever', 'not at all', 'until the server crashes'], answer: 0, why: 'Once the attributes are older than the timeout, it asks again.' },
      { q: 'What does close-to-open consistency promise?', options: ['a client that opens a file after another closed it sees that client\'s writes', 'every read is fresh', 'writes are seen at once', 'no two clients may open a file'], answer: 0, why: 'open checks with the server; close flushes to it.' },
      { q: 'Setting the timeout to 0 gives…', options: ['a check before every read: fresh but chatty', 'no caching of data at all', 'stale reads', 'no messages'], answer: 0, why: 'The data is still cached; it is just revalidated every time.' },
    ],
  });

  // ---- flush on close, close-to-open, the last writer winning ----
  const SCEN = {
    together: { label: 'both edit at once', a: [[0, 'open'], [0, 'read'], [0, 'write', 'A: moorings checked'], [6, 'close']], b: [[1, 'open'], [1, 'read'], [1, 'write', 'B: lamp relit'], [3, 'close']] },
    turns: { label: 'B closes, then A opens', a: [[8, 'open'], [8, 'read'], [8, 'write', 'A: moorings checked'], [8, 'close']], b: [[0, 'open'], [0, 'read'], [0, 'write', 'B: lamp relit'], [0, 'close']] },
    unflushed: { label: 'A reads while B has not closed', a: [[4, 'open'], [4, 'read'], [12, 'open'], [12, 'read']], b: [[0, 'open'], [0, 'write', 'B: lamp relit'], [10, 'close']] },
  };
  function closeCfg(inp) {
    const S0 = SCEN[inp.scen], mk = (c, list) => list.map(([t, op, data]) => Object.assign({ t, c, op, file: 'log' }, data ? { data } : {}));
    return { protocol: 'nfs', clients: ['A', 'B'], files: { log: 'harbour log, empty' }, latency: 1, timeout: 4, attrTimeout: inp.attr, script: mk('A', S0.a).concat(mk('B', S0.b)) };
  }
  S.topic({
    id: 'dfs-close', family: 'p16-cache', order: 20, title: 'Flush on close, and the last writer wins',
    blurb: 'An NFS-style client keeps its writes in its own memory and sends them to the server when the file is closed. Open asks the server for the file\'s version, so a client that opens a file after another has closed it sees the changes: close-to-open consistency. But two clients editing the same file at once each send their whole change at close, and the later close silently replaces the earlier one.',
    inputs: [
      { id: 'scen', kind: 'choice', label: 'scenario', def: 'together', options: Object.entries(SCEN).map(([value, s]) => ({ value, label: s.label })) },
      { id: 'attr', kind: 'number', label: 'attribute timeout (ticks)', def: 3, min: 0, max: 8 },
    ],
    presets: [
      { label: 'Both edit at once: an update lost', values: { scen: 'together', attr: 3 } },
      { label: 'In turns: close, then open', values: { scen: 'turns', attr: 3 } },
      { label: 'Writes not yet flushed', values: { scen: 'unflushed', attr: 3 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'stale', label: 'stale reads' }],
    run(inp) {
      const cfg = closeCfg(inp), r = H.run(cfg), sum = H.summary(r), final = r.server.files.log;
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1];
      last.say += ` The server ends with ${H.q(final.data)} (version ${final.version}). ${sum.lost ? 'One update was lost: both clients started from the same version and the later close replaced the earlier. Nothing in the protocol stopped it; a lock, or a check of the version at write time, would.' : inp.scen === 'turns' ? 'Nothing was lost: A opened after B closed, so its open fetched B\'s version and A wrote on top of it.' : 'Until B closed, its write lived only in B\'s memory, so A could not see it; after the close, A\'s next open did.'}`;
      Object.assign(last.meta, { sum, version: final.version });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Flush on close', text: ['write: kept at the client', 'close: WRITE the whole change to the server', 'open: GETATTR, and refetch if the version moved', 'two writers at once: the last close wins', 'others see a write only after the writer closes'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Will one of the updates be lost?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.sum.lost ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'When does the server see a client\'s writes, NFS-style?', options: ['at close (or when the client flushes earlier)', 'at every write call', 'at the next open', 'never'], answer: 0, why: 'Flush on close.' },
      { q: 'Two clients edit the same file at once and both close. The file ends with…', options: ['the change of whichever closed last', 'both changes merged', 'the first change', 'an error'], answer: 0, why: 'Each close sends a whole new version; the server keeps the last.' },
      { q: 'How can a program avoid lost updates on a shared file?', options: ['lock the file, or check the version before writing', 'reopen it often', 'shorten the attribute timeout', 'write smaller blocks'], answer: 0, why: 'Caching rules alone do not serialise writers.' },
      { q: 'Client B writes but has not closed. Client A opens the file. A sees…', options: ['the old contents', 'B\'s new contents', 'an error', 'half of each'], answer: 0, why: 'B\'s write is still only in B\'s memory.' },
    ],
  });
  S.P16.attrCfg = attrCfg;
  S.P16.closeCfg = closeCfg;
})(globalThis.Proses = globalThis.Proses || {});
