// Part 16, whole-file caching with callbacks (the AFS idea, S.DFS.run with protocol 'afs'): open fetches the whole file
// and the server promises to call back if it changes; while the promise holds, opens cost no message at all; reads and
// writes are local; close stores a changed file, and the server breaks the other clients' promises. A server crash
// forgets every promise, so clients must learn of the restart (from any reply, or by probing) and stop trusting them.
(function (S) {
  'use strict';
  const H = S.P16;
  const mk = (c, list) => list.map(([t, op, data]) => Object.assign({ t, c, op, file: 'chart' }, data ? { data } : {}));

  const SCEN = {
    promise: { label: 'opens with a promise, then a change', a: [[0, 'open'], [0, 'read'], [0, 'close'], [4, 'open'], [4, 'read'], [4, 'close'], [14, 'open'], [14, 'read'], [14, 'close']], b: [[6, 'open'], [6, 'write', 'chart v2: new buoy at the point'], [6, 'close']] },
    session: { label: 'B changes it while A has it open', a: [[0, 'open'], [0, 'read'], [8, 'read'], [8, 'close'], [10, 'open'], [10, 'read']], b: [[2, 'open'], [2, 'write', 'chart v2: new buoy at the point'], [2, 'close']] },
    both: { label: 'both edit at once', a: [[0, 'open'], [0, 'write', 'A: sandbar moved'], [6, 'close']], b: [[1, 'open'], [1, 'write', 'B: buoy repainted'], [3, 'close']] },
  };
  function afsCfg(inp) { const S0 = SCEN[inp.scen]; return { protocol: 'afs', clients: ['A', 'B'], files: { chart: 'chart v1' }, latency: 1, timeout: 6, script: mk('A', S0.a).concat(mk('B', S0.b)) }; }

  S.topic({
    id: 'dfs-afs', family: 'p16-afs', order: 10, title: 'Whole files and callback promises',
    blurb: 'An AFS-style client fetches the whole file when it opens it, and the server promises to tell it if the file changes: a callback. While the promise holds, opening the file again costs nothing. Reads and writes touch only the local copy; close sends the whole file back if it changed, and the server breaks every other client\'s promise. A client sees others\' changes when it next opens the file.',
    inputs: [{ id: 'scen', kind: 'choice', label: 'scenario', def: 'promise', options: Object.entries(SCEN).map(([value, s]) => ({ value, label: s.label })) }],
    presets: [
      { label: 'Opens with a promise, then a change', values: { scen: 'promise' } },
      { label: 'A change during an open session', values: { scen: 'session' } },
      { label: 'Both edit at once', values: { scen: 'both' } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'stale', label: 'stale reads' }],
    run(inp) {
      const cfg = afsCfg(inp), r = H.run(cfg), sum = H.summary(r), final = r.server.files.chart;
      const hits = r.events.filter((e) => e.kind === 'cb-hit').length, breaks = r.messages.filter((m) => m.kind === 'BREAK').length;
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1];
      last.say += ` In all: ${H.plural(sum.messages, 'message')}, ${H.plural(hits, 'open')} answered by a promise with no message, ${H.plural(breaks, 'promise')} broken by the server. The server ends with ${H.q(final.data)} (version ${final.version}).${sum.stale ? ' A read during an open session saw the old copy: the change is seen at the next open.' : ''}${sum.lost ? ' One update was lost: the last close replaced the other, as with NFS.' : ''}`;
      Object.assign(last.meta, { sum, hits, breaks, version: final.version });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Callbacks', text: ['open: a promise held? use the copy, no message', 'no promise: FETCH the whole file, get a promise', 'read, write: the local copy', 'close: STORE if changed; the server BREAKs others', 'changes are seen at the next open'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many opens will cost no message at all?', options: ['0', '1', '2', '3'], answer: (fr) => String(Math.min(3, fr[fr.length - 1].meta.hits)), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'What does a callback promise let a client do?', options: ['open the file again with no message while the promise holds', 'write without storing', 'lock the file', 'skip the close'], answer: 0, why: 'The server will tell it if the file changes.' },
      { q: 'When does a client with the file open see another client\'s stored change?', options: ['at its next open', 'at once, in the middle of a read', 'never', 'at its close'], answer: 0, why: 'AFS gives open-to-close sessions on a local copy.' },
      { q: 'What does the server keep that an NFS-style server does not?', options: ['a list of which clients hold promises on which files', 'file data', 'the duplicate cache', 'nothing'], answer: 0, why: 'Callbacks are server state, and must be rebuilt after a crash.' },
      { q: 'Why does whole-file caching suit files that are read often and changed rarely?', options: ['most opens cost no message, and a change costs one store plus a few breaks', 'it saves disk space', 'it avoids stale reads entirely', 'it works without a server'], answer: 0, why: 'Promises turn repeated validation into silence.' },
    ],
  });

  // ---- a server crash forgets the promises ----
  function crashCfg(inp) {
    return { protocol: 'afs', clients: ['A', 'B'], files: { chart: 'chart v1' }, latency: 1, timeout: 4, probe: inp.probe, crashes: [{ t: 4, until: 4 + inp.down }], script: mk('A', [[0, 'open'], [0, 'read'], [0, 'close'], [inp.reopen, 'open'], [inp.reopen, 'read'], [inp.reopen, 'close']]).concat(mk('B', [[5 + inp.down, 'open'], [5 + inp.down, 'write', 'chart v2: new buoy at the point'], [5 + inp.down, 'close']])) };
  }
  S.topic({
    id: 'dfs-afs-crash', family: 'p16-afs', order: 20, title: 'A server crash forgets the promises',
    blurb: 'Callback promises are state the server keeps in memory. When it crashes and restarts it has forgotten who holds which promise, so it cannot break them when a file changes. A client still trusting its promise would use a stale copy. So a client must learn that the server restarted, from the new epoch number in any reply or from a periodic probe, and then drop every promise it holds.',
    inputs: [
      { id: 'probe', kind: 'number', label: 'probe every (ticks, 0 never)', def: 0, min: 0, max: 20 },
      { id: 'down', kind: 'number', label: 'server down for (ticks)', def: 3, min: 1, max: 8 },
      { id: 'reopen', kind: 'number', label: 'A opens again at', def: 14, min: 10, max: 30 },
    ],
    check(inp) { return inp.reopen <= 9 + inp.down ? 'A should open again after B has stored its change (after tick ' + (9 + inp.down) + ')' : null; },
    presets: [
      { label: 'No probing: a stale read', values: { probe: 0, down: 3, reopen: 14 } },
      { label: 'Probing every 3 ticks', values: { probe: 3, down: 3, reopen: 14 } },
      { label: 'Probing every 12 ticks: just in time', values: { probe: 12, down: 3, reopen: 14 } },
      { label: 'Probing every 15 ticks: too late', values: { probe: 15, down: 3, reopen: 14 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'stale', label: 'stale reads' }],
    run(inp) {
      const cfg = crashCfg(inp), r = H.run(cfg), sum = H.summary(r), learned = r.events.filter((e) => e.kind === 'epoch' && e.c === 'A');
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1];
      last.say += sum.stale ? ` A read a stale copy: after the restart the server did not know A held a promise, so B's store broke nothing, and A ${learned.length ? 'learned of the restart too late' : 'never learned of the restart'}. Probing ${inp.probe ? 'more often' : 'now and then'} closes the gap.` : ` A read the new version: it had learned of the restart (${learned.length ? 't = ' + learned[0].t : 'from a reply'}) and dropped its promise, so its next open fetched the file again. Each probe costs messages: ${H.plural(r.messages.filter((m) => /PROBE/.test(m.kind)).length, 'probe message')} here.`;
      Object.assign(last.meta, { sum, learnedAt: learned.length ? learned[0].t : -1, probes: r.messages.filter((m) => /PROBE/.test(m.kind)).length });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Promises and crashes', text: ['promises live in the server\'s memory', 'a crash: all promises forgotten; epoch + 1', 'a client learns the epoch from a reply or a probe', 'then drops every promise it holds', 'until then it may trust a stale copy'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'When A opens the file again, will it read B\'s new version?', options: ['yes', 'no, a stale copy'], answer: (fr) => (fr[fr.length - 1].meta.sum.stale ? 'no, a stale copy' : 'yes'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why is a crash harder for an AFS-style server than for an NFS-style one?', options: ['it held state (the promises) that is now gone and must be accounted for', 'it has more files', 'its disk fails', 'it is not harder'], answer: 0, why: 'A stateless server has nothing to lose; a stateful one must recover its state or make clients drop theirs.' },
      { q: 'How does a client learn that the server restarted?', options: ['the epoch number in any reply, or a probe', 'the server calls every client', 'it cannot', 'from the file\'s size'], answer: 0, why: 'A changed epoch means every promise from before is void.' },
      { q: 'What must a client do on seeing a new epoch?', options: ['drop all its callback promises and revalidate at the next open', 'delete its cache', 'resend its writes', 'nothing'], answer: 0, why: 'Its promises may be broken without its knowing.' },
      { q: 'Probing every few seconds costs…', options: ['messages even when nothing changes, in return for a shorter window of trusting stale promises', 'nothing', 'disk writes', 'a full refetch each time'], answer: 0, why: 'A trade between messages and freshness.' },
    ],
  });
  S.P16.afsCfg = afsCfg;
  S.P16.afsCrashCfg = crashCfg;
})(globalThis.Proses = globalThis.Proses || {});
