// Part 3, retries in a remote call (S.Ipc.semantics): the network loses and repeats messages, so a client that hears
// nothing sends the same request again. At-least-once servers run every request that arrives, which is harmless
// for an idempotent call (set, read) and wrong for one that is not (deposit). At-most-once servers remember each
// request id with its reply and answer a repeat from that table. The picture: a client-server timeline with the
// lost messages marked, the server's number, and each call's tries and runs.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const CALLS = {
    deposits: { label: 'three deposits', calls: [{ op: 'deposit', arg: 10 }, { op: 'deposit', arg: 25 }, { op: 'deposit', arg: 5 }] },
    sets: { label: 'set, then read', calls: [{ op: 'set', arg: 40 }, { op: 'read', arg: 0 }, { op: 'set', arg: 7 }] },
    mixed: { label: 'a deposit and a set', calls: [{ op: 'deposit', arg: 50 }, { op: 'set', arg: 20 }, { op: 'deposit', arg: 1 }] },
  };
  X.SEM = CALLS;
  S.topic({
    id: 'p03-rpc-retry', family: 'p03-net', order: 30, title: 'Lost messages: at least once, at most once',
    blurb: 'When a reply does not come, the client cannot tell whether its request was lost, or ran and the reply was lost; all it can do is send the same request again. If the server runs every request that arrives (at least once), a retried deposit is paid twice. A server that keeps each request id with its reply runs each request at most once and answers a repeat from its table. Idempotent calls, whose second run changes nothing, are safe either way.',
    inputs: [
      { id: 'calls', kind: 'choice', label: 'Calls', def: 'deposits', options: Object.keys(CALLS).map((k) => ({ value: k, label: CALLS[k].label })) },
      { id: 'sem', kind: 'choice', label: 'Server', def: 'at-least-once', options: [{ value: 'at-least-once', label: 'at least once: runs every request' }, { value: 'at-most-once', label: 'at most once: remembers request ids' }] },
      { id: 'loss', kind: 'slider', label: 'Messages lost', def: 0.3, min: 0, max: 0.6, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { id: 'dup', kind: 'slider', label: 'Requests repeated', def: 0.2, min: 0, max: 0.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { id: 'seed', kind: 'slider', label: 'Seed', def: 3, min: 1, max: 30, step: 1 },
    ],
    presets: [
      { label: 'Deposits, at least once', values: { calls: 'deposits', sem: 'at-least-once', loss: 0.3, dup: 0.2, seed: 3 } },
      { label: 'The same, at most once', values: { calls: 'deposits', sem: 'at-most-once', loss: 0.3, dup: 0.2, seed: 3 } },
      { label: 'Idempotent calls, at least once', values: { calls: 'sets', sem: 'at-least-once', loss: 0.3, dup: 0.2, seed: 3 } },
      { label: 'A perfect network', values: { calls: 'mixed', sem: 'at-least-once', loss: 0, dup: 0, seed: 1 } },
    ],
    counters: [{ id: 'msgs', label: 'messages' }, { id: 'lost', label: 'lost' }, { id: 'runs', label: 'requests run' }],
    run(inp) {
      const sc = CALLS[inp.calls];
      const r = S.Ipc.semantics({ semantics: inp.sem, calls: sc.calls, loss: inp.loss, dup: inp.dup, retries: 3, seed: inp.seed, start: 100 });
      const F = new S.Frames(['msgs', 'lost', 'runs']);
      const rows = Math.max(6, r.timeline.length), rowH = Math.min(32, Math.round(440 / rows));
      let runs = 0;
      r.steps.forEach((s) => {
        if (s.kind === 'execute') runs++;
        const shown = r.timeline.filter((p) => p.t <= s.t);
        const parties = [{ name: 'client', x: 80, cls: s.kind === 'give-up' ? 's-blocked' : 's-ready', sub: 'retries 3 times' }, { name: 'server', x: 420, cls: s.kind === 'execute' ? 's-running act' : 's-ready', sub: inp.sem }];
        const items = X.timeline({ prefix: 'tl', parties, top: 70, rowH, rows, packets: shown.map((p) => ({ from: p.from, to: p.to, label: p.label, lost: p.lost, dup: p.dup, cls: p.from === 'server' ? 'reply' : '' })), act: shown.length - 1 }).items;
        const sx = 580, sw = 240;
        items.push(H.title('vt', sx, 14, 'the server\'s number'));
        items.push(H.cell('val', sx, 26, sw, 40, String(s.value), 'oftext mono' + (s.kind === 'execute' ? ' act' : ''), { size: 18, rx: 8 }));
        items.push(H.title('ct', sx, 96, 'calls'));
        r.calls.forEach((c, k) => {
          const done = r.steps.indexOf(s) >= r.steps.findIndex((x) => x.call === c.id && (x.kind === 'answer' || x.kind === 'give-up'));
          items.push(H.cell('cl' + k, sx, 108 + k * 64, sw, 56, '', 'oftext' + (s.call === c.id ? ' act' : ''), { lines: [c.op + '(' + c.arg + ') #' + c.id, done ? 'ran ' + H.plural(c.executions, 'time') + (c.answered ? ', answered' : ', gave up') : 'in progress'], rx: 6 }));
        });
        F.set('msgs', shown.length).set('lost', shown.filter((p) => p.lost).length).set('runs', runs);
        const j = r.steps.indexOf(s), prev = j ? r.steps[j - 1].value : 100;
        const sentN = shown.filter((p) => p.from === 'client' && p.label.endsWith('#' + s.call)).length, runsN = r.steps.slice(0, j + 1).filter((x) => x.kind === 'execute' && x.call === s.call).length;
        F.add({ items, say: s.say, meta: { phase: s.kind, value: s.value, prev, sent: sentN, runs: runsN, tryNos: Array.from({ length: (r.calls.find((c) => c.id === s.call) || { tries: 0 }).tries }, (_, k) => k + 1), t: s.t, call: s.call, loss: inp.loss, dup: inp.dup, retries: 3, start: 100, calls: r.calls.map((c) => [c.id, c.arg, c.tries, c.executions]), final: r.final, expected: r.expected }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Retries', text: ['no reply: lost request,', '  or lost reply? cannot tell', 'at least once: run every', '  request that arrives', 'at most once: keep id -> reply;', '  a repeat gets the old reply', 'idempotent: running twice', '  = running once (set, read)'].join('\n') }] };
      return { frames: F.list, def, result: { final: r.final, expected: r.expected, correct: r.correct, calls: r.calls } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'end', pick: 'option', ask: 'Will the server\'s number end where running each call exactly once would put it?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.final === fr[i + 1].meta.expected ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A client gets no reply. What does it know?', options: ['nothing certain: the request or the reply may have been lost', 'the request was lost', 'the server crashed', 'the call ran'], answer: 0, why: 'Both look the same from the client.' },
      { q: 'Which call is idempotent?', options: ['set(x) to 5', 'deposit 10', 'append a line', 'increment a counter'], answer: 0, why: 'Setting to 5 twice leaves 5.' },
      { q: 'How does an at-most-once server spot a repeat?', options: ['it keeps each request id with its reply', 'it compares arguments', 'it asks the client', 'it cannot'], answer: 0, why: 'The same id means the same request; it answers from the table.' },
      { q: 'Why can at-most-once not promise exactly once?', options: ['if every try is lost the call may not run at all', 'it runs twice', 'ids repeat', 'it can'], answer: 0, why: 'After its retries the client gives up, and may not know if the call ran.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
