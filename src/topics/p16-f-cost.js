// Part 16, the cost of each design: the same workload run under the NFS-style and the AFS-style protocol (S.DFS.run),
// each drawn on its timeline, then compared: messages, bytes, operations at the server, and stale reads.
(function (S) {
  'use strict';
  const H = S.P16;
  const mk = (c, list) => list.map(([t, op, data]) => Object.assign({ t, c, op, file: 'chart' }, data ? { data } : {}));
  const WORK = {
    readmostly: { label: 'read often, change rarely', a: [[0, 'open'], [0, 'read'], [0, 'close'], [6, 'open'], [6, 'read'], [6, 'close'], [12, 'open'], [12, 'read'], [12, 'close'], [18, 'open'], [18, 'read'], [18, 'close']], b: [[8, 'open'], [8, 'write', 'chart v2'], [8, 'close']] },
    shared: { label: 'both read and write in turns', a: [[0, 'open'], [0, 'read'], [0, 'write', 'A1'], [0, 'close'], [10, 'open'], [10, 'read'], [10, 'write', 'A2'], [10, 'close']], b: [[5, 'open'], [5, 'read'], [5, 'write', 'B1'], [5, 'close'], [15, 'open'], [15, 'read'], [15, 'write', 'B2'], [15, 'close']] },
    session: { label: 'one long read session', a: [[0, 'open'], [0, 'read'], [3, 'read'], [6, 'read'], [9, 'read'], [12, 'read'], [12, 'close']], b: [[4, 'open'], [4, 'write', 'chart v2'], [4, 'close']] },
  };
  function cfgOf(inp, protocol) { const W = WORK[inp.work]; return { protocol, clients: ['A', 'B'], files: { chart: 'chart v1: '.padEnd(inp.size, '.') }, latency: 1, timeout: 6, attrTimeout: inp.attr, script: mk('A', W.a).concat(mk('B', W.b)) }; }

  S.topic({
    id: 'dfs-cost', family: 'p16-cost', order: 10, title: 'Two designs, one workload', camera: 'follow',
    blurb: 'Which design costs less depends on the work. Whole-file caching with callbacks makes repeated opens of an unchanged file free, but moves the whole file at every open after a change and at every close that changed it. Block requests with attribute caching move less at a time but keep asking whether a copy is still good. Run one workload both ways and count.',
    inputs: [
      { id: 'work', kind: 'choice', label: 'workload', def: 'readmostly', options: Object.entries(WORK).map(([value, w]) => ({ value, label: w.label })) },
      { id: 'size', kind: 'number', label: 'file size in bytes', def: 200, min: 10, max: 2000 },
      { id: 'attr', kind: 'number', label: 'NFS attribute timeout', def: 3, min: 0, max: 10 },
    ],
    presets: [
      { label: 'Read often, change rarely', values: { work: 'readmostly', size: 200, attr: 3 } },
      { label: 'Writing in turns', values: { work: 'shared', size: 200, attr: 3 } },
      { label: 'A long read session', values: { work: 'session', size: 200, attr: 3 } },
      { label: 'A big file, read often', values: { work: 'readmostly', size: 2000, attr: 3 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'bytes', label: 'bytes sent' }],
    run(inp) {
      const runs = ['nfs', 'afs'].map((p) => { const cfg = cfgOf(inp, p), r = H.run(cfg); return { p, cfg, r, sum: H.summary(r), Fr: H.frames({ r, cfg }) }; });
      const out = new S.Frames(['msgs', 'bytes']);
      runs.forEach((x) => {
        const f = x.Fr.list[x.Fr.list.length - 1];
        out.set('msgs', x.sum.messages).set('bytes', x.sum.bytes);
        out.add({ items: f.items, title: x.p === 'nfs' ? 'NFS-style' : 'AFS-style', say: `${x.p === 'nfs' ? 'NFS-style' : 'AFS-style'}: ${H.plural(x.sum.messages, 'message')}, ${x.sum.bytes} bytes, ${H.plural(x.sum.serverOps, 'operation')} at the server, ${H.plural(x.sum.stale, 'stale read')}. ${x.p === 'nfs' ? 'Every open asks for the attributes; reads go to the server when the attributes are old or the version moved.' : 'Opens with a promise cost nothing; an open after a change fetches the whole file; a changed file is stored whole at close.'}`, meta: { phase: x.p, sum: x.sum, size: inp.size } });
      });
      const [N, A] = runs.map((x) => x.sum), rows = [['messages', N.messages, A.messages], ['bytes', N.bytes, A.bytes], ['server operations', N.serverOps, A.serverOps], ['stale reads', N.stale, A.stale]];
      const items = [H.text('dc:t', 0, 14, `the same workload, two designs (a file of ${inp.size} bytes)`, 'strong', 14)];
      rows.forEach(([name, n, a], i) => {
        const y = 44 + i * 64, max = Math.max(1, n, a), w = 380;
        items.push(H.text('dc:n' + i, 0, y + 14, name, 'strong', 14));
        [['NFS', n, 'c0'], ['AFS', a, 'c1']].forEach(([lab, v, c], j) => {
          items.push(H.text('dc:l' + i + j, 140, y + 14 + j * 24, lab, 'tick', 13));
          items.push({ key: 'dc:b' + i + j, kind: 'cell', x: 180, y: y + 2 + j * 24, w: Math.max(2, Math.round((w * v) / max)), h: 18, rx: 2, text: '', cls: 'bar ' + c, audit: 'ignore' });
          items.push(H.text('dc:v' + i + j, 186 + Math.max(2, Math.round((w * v) / max)), y + 16 + j * 24, String(v), 'mono', 13));
        });
      });
      const fewer = N.messages < A.messages ? 'NFS-style' : N.messages > A.messages ? 'AFS-style' : 'neither';
      out.add({ items, title: 'compared', say: `Side by side: ${N.messages} against ${A.messages} messages, ${N.bytes} against ${A.bytes} bytes, ${N.serverOps} against ${A.serverOps} server operations, ${N.stale} against ${A.stale} stale reads. ${fewer === 'neither' ? 'Both send as many messages here.' : fewer + ' sends fewer messages here.'} The NFS style sent ${kinds(runs[0].r, ['GETATTR', 'READ', 'WRITE'])}; the AFS style sent ${kinds(runs[1].r, ['FETCH', 'STORE', 'BREAK'])}.`, meta: { phase: 'compare', N, A, kinds: runs.map((x) => x.r.costs.byKind) } });
      return { frames: out.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Where the costs are', text: ['NFS: GETATTR at open and when attributes age', 'NFS: READ when the version moved; WRITE at close', 'AFS: FETCH at open without a promise', 'AFS: STORE at close if changed; BREAKs to others', 'bytes: the data moved, plus headers'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Which design will send fewer messages on this workload?', options: ['NFS-style', 'AFS-style', 'neither'], answer: (fr) => { const m = fr[fr.length - 1].meta; return m.N.messages < m.A.messages ? 'NFS-style' : m.N.messages > m.A.messages ? 'AFS-style' : 'neither'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A file is opened 100 times and changed once. Which design sends fewer messages?', options: ['whole-file caching with callbacks', 'block requests with attribute caching', 'the same', 'it depends only on the file size'], answer: 0, why: 'Opens with a promise cost nothing; NFS checks the attributes at every open.' },
      { q: 'A huge file is opened to read one byte. Which design moves more data?', options: ['whole-file caching: it fetches all of it', 'block requests', 'neither', 'both the same'], answer: 0, why: 'AFS fetches the whole file at open.' },
      { q: 'What costs the AFS-style server memory that the NFS-style one does not spend?', options: ['the callback promises', 'the files', 'the duplicate cache', 'the attribute cache'], answer: 0, why: 'One record per client per cached file.' },
      { q: 'Which design shows another client\'s change sooner during an open session?', options: ['NFS-style, once the attributes time out', 'AFS-style', 'neither ever does', 'both at once'], answer: 0, why: 'AFS shows changes only at the next open.' },
    ],
  });
  /** how many of each kind of request a run sent: '4 GETATTR, 2 READ and 1 WRITE' */
  function kinds(r, list) { return H.list(list.map((k) => (r.costs.byKind[k] || 0) + ' ' + k)); }
  S.P16.costCfg = cfgOf;
})(globalThis.Proses = globalThis.Proses || {});
