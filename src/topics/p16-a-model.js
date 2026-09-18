// Part 16, the client–server model: one client using a file kept on a server. Every operation the program makes
// (open, read, write, close) becomes requests and replies over the network, each taking `latency` ticks each way
// (S.DFS.run). The timeline shows each message as it travels, and the counters the messages and bytes it costs.
(function (S) {
  'use strict';
  const H = S.P16;
  const WORK = {
    read: { label: 'open, read twice, close', script: [['open'], ['read'], ['read'], ['close']] },
    edit: { label: 'open, read, write, close', script: [['open'], ['read'], ['write', 'Moorings checked; all boats in.'], ['close']] },
    create: { label: 'create, write, close, read', script: [['create', null, 'log'], ['open', null, 'log'], ['write', 'first entry', 'log'], ['close', null, 'log'], ['read', null, 'log']] },
  };
  function cfgOf(inp) {
    const script = WORK[inp.work].script.map(([op, data, file], i) => Object.assign({ t: i ? 0 : 0, c: 'A', op, file: file || 'notes' }, data !== undefined && data !== null ? { data } : {}));
    return { protocol: inp.protocol, clients: ['A'], files: { notes: 'Tide tables for the week.' }, script, latency: inp.latency, timeout: 4 * inp.latency + 2, attrTimeout: 3 };
  }

  S.topic({
    id: 'dfs-model', family: 'p16-model', order: 10, title: 'A file on another machine',
    blurb: 'With a distributed file system a program opens and reads a file as usual, but the file lives on a server. The client\'s file system turns each call into requests sent over the network, and waits for the replies. Each message takes time, so how many there are, and how often a client can answer from its own cache, decides how fast it feels.',
    inputs: [
      { id: 'work', kind: 'choice', label: 'the program', def: 'edit', options: Object.entries(WORK).map(([value, w]) => ({ value, label: w.label })) },
      { id: 'protocol', kind: 'choice', label: 'design', def: 'nfs', options: [{ value: 'nfs', label: 'NFS-style (block requests)' }, { value: 'afs', label: 'AFS-style (whole files)' }] },
      { id: 'latency', kind: 'number', label: 'ticks each way', def: 1, min: 1, max: 3 },
    ],
    presets: [
      { label: 'Edit a file, NFS-style', values: { work: 'edit', protocol: 'nfs', latency: 1 } },
      { label: 'Edit a file, AFS-style', values: { work: 'edit', protocol: 'afs', latency: 1 } },
      { label: 'Read twice, NFS-style', values: { work: 'read', protocol: 'nfs', latency: 1 } },
      { label: 'A slow network', values: { work: 'edit', protocol: 'nfs', latency: 3 } },
      { label: 'Create a new file', values: { work: 'create', protocol: 'nfs', latency: 1 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'bytes', label: 'bytes sent' }],
    run(inp) {
      const cfg = cfgOf(inp), r = H.run(cfg), sum = H.summary(r);
      const end = Math.max(0, ...r.messages.map((m) => m.recv), ...r.events.map((e) => e.t));
      const Fr = H.frames({ r, cfg });
      const last = Fr.list[Fr.list.length - 1];
      last.say += ` In all: ${H.plural(sum.messages, 'message')} (${H.plural(r.messages.filter((m) => m.from === 'A').length, 'request')} and their replies), ${sum.bytes} bytes, ${H.plural(sum.serverOps, 'operation')} at the server, and ${end} ticks from the first call to the last reply.`;
      Object.assign(last.meta, { sum, end, requests: r.messages.filter((m) => m.from === 'A').length });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Each call', text: cfg.protocol === 'nfs' ? ['open: GETATTR (is my copy current?)', 'read: from the cache, or GETATTR then READ', 'write: kept at the client', 'close: WRITE the changes back', 'a round trip = 2 × latency ticks'].join('\n') : ['open: FETCH the whole file (unless a promise holds)', 'read and write: local, no messages', 'close: STORE the whole file if changed', 'a round trip = 2 × latency ticks'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many messages will the whole program cost, requests and replies?', options: (fr) => { const n = fr[fr.length - 1].meta.sum.messages; return [...new Set([n, n + 2, Math.max(2, n - 2), n * 2])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.sum.messages), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why does a network file system keep data at the client at all?', options: ['each message costs a round trip; answering from memory costs nothing', 'the server forgets data', 'to save disk space', 'it is required by the protocol'], answer: 0, why: 'Latency, not bandwidth, usually dominates small file operations.' },
      { q: 'With 2 ticks each way, a request and its reply take…', options: ['4 ticks', '2 ticks', '1 tick', '8 ticks'], answer: 0, why: 'There and back.' },
      { q: 'In the NFS style, when does the server see a client\'s writes?', options: ['when the client flushes them, at close at the latest', 'at once, byte by byte', 'never', 'at the next mount'], answer: 0, why: 'Writes are buffered at the client and sent on close (or sooner if memory is short).' },
      { q: 'In the AFS style, a read after open costs…', options: ['no messages: the whole file is at the client', 'one READ', 'a GETATTR', 'a FETCH each time'], answer: 0, why: 'The file was fetched whole at open.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
