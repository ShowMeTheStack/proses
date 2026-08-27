// Part 3, message passing (S.Ipc.messages): processes hand messages to the kernel and take them out again. The
// choices: naming (to a process directly, or to a shared mailbox), the queue's capacity (none: a rendezvous; a
// few; unbounded), and whether send and receive wait or return at once. Cards show each process's operations;
// under them every queue with its messages, and any sender holding a message nobody has taken yet.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const q = (s) => '"' + s + '"';
  const snd = (to, msg) => ({ op: 'send', to, msg }), rcv = (from) => (from ? { op: 'recv', from } : { op: 'recv' }), work = { op: 'work' };
  const SCENES = {
    pair: { label: 'one sender, one receiver', naming: 'direct', procs: [{ name: 'P', ops: [snd('C', 'm1'), snd('C', 'm2'), snd('C', 'm3')] }, { name: 'C', ops: [work, rcv(), work, rcv(), rcv()] }] },
    burst: { label: 'a burst of four messages', naming: 'direct', procs: [{ name: 'P', ops: [snd('C', 'a'), snd('C', 'b'), snd('C', 'c'), snd('C', 'd')] }, { name: 'C', ops: [work, work, rcv(), rcv(), rcv(), rcv()] }] },
    poll: { label: 'the receiver polls', naming: 'direct', procs: [{ name: 'P', ops: [work, work, snd('C', 'news')] }, { name: 'C', ops: [rcv(), rcv(), rcv(), rcv()] }] },
    mailbox: { label: 'two receivers share a mailbox', naming: 'indirect', mailboxes: ['jobs'], procs: [{ name: 'P', ops: [snd('jobs', 'j1'), snd('jobs', 'j2'), snd('jobs', 'j3'), snd('jobs', 'j4')] }, { name: 'W1', ops: [rcv('jobs'), rcv('jobs')] }, { name: 'W2', ops: [rcv('jobs'), rcv('jobs')] }] },
    both: { label: 'both receive first: deadlock', naming: 'direct', procs: [{ name: 'A', ops: [rcv('B'), snd('B', 'hi')] }, { name: 'B', ops: [rcv('A'), snd('A', 'hey')] }] },
  };
  X.MSG = SCENES;
  const opText = (o) => (o.op === 'send' ? 'send(' + o.to + ', ' + q(o.msg) + ')' : o.op === 'recv' ? 'receive(' + (o.from || 'any') + ')' : 'compute');
  const CAPS = [{ value: '0', label: '0: no buffer (rendezvous)' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: 'inf', label: 'unbounded' }];

  S.topic({
    id: 'p03-msg', family: 'p03-models', order: 20, title: 'Message passing: naming, blocking, buffering',
    blurb: 'With message passing the kernel carries each message. Naming: send to a process directly, or to a mailbox that several may read. Buffering: with no buffer a send waits for a receiver (a rendezvous); with room for n messages it waits only when the queue is full; unbounded, never. And each call can block or return at once: a non-blocking send to a full queue fails, a non-blocking receive from an empty one returns nothing.',
    inputs: [
      { id: 'scene', kind: 'choice', label: 'Scenario', def: 'pair', options: Object.keys(SCENES).map((k) => ({ value: k, label: SCENES[k].label })) },
      { id: 'cap', kind: 'choice', label: 'Queue capacity', def: '0', options: CAPS },
      { id: 'send', kind: 'choice', label: 'send', def: 'blocking', options: [{ value: 'blocking', label: 'blocking' }, { value: 'nonblocking', label: 'non-blocking' }] },
      { id: 'recv', kind: 'choice', label: 'receive', def: 'blocking', options: [{ value: 'blocking', label: 'blocking' }, { value: 'nonblocking', label: 'non-blocking' }] },
      { id: 'policy', kind: 'choice', label: 'Who moves next', def: 'rr', options: [{ value: 'rr', label: 'take turns' }, { value: 'random', label: 'at random (seeded)' }] },
      { id: 'seed', kind: 'slider', label: 'Seed', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'Rendezvous: no buffer', values: { scene: 'pair', cap: '0', send: 'blocking', recv: 'blocking' } },
      { label: 'A queue of two', values: { scene: 'burst', cap: '2', send: 'blocking', recv: 'blocking' } },
      { label: 'Unbounded: the sender never waits', values: { scene: 'burst', cap: 'inf', send: 'blocking', recv: 'blocking' } },
      { label: 'Non-blocking send to a full queue', values: { scene: 'burst', cap: '1', send: 'nonblocking', recv: 'blocking' } },
      { label: 'Polling with non-blocking receive', values: { scene: 'poll', cap: '1', send: 'blocking', recv: 'nonblocking' } },
      { label: 'A mailbox shared by two', values: { scene: 'mailbox', cap: '2', send: 'blocking', recv: 'blocking', policy: 'random', seed: 4 } },
      { label: 'Both receive first', values: { scene: 'both', cap: '1', send: 'blocking', recv: 'blocking' } },
    ],
    counters: [{ id: 'delivered', label: 'messages delivered' }, { id: 'failed', label: 'sends refused' }, { id: 'waits', label: 'waits' }],
    run(inp) {
      const sc = SCENES[inp.scene], cap = inp.cap === 'inf' ? Infinity : +inp.cap;
      const r = S.Ipc.messages({ naming: sc.naming, mailboxes: sc.mailboxes, capacity: cap, send: inp.send, recv: inp.recv, procs: sc.procs, policy: inp.policy, seed: inp.seed });
      const F = new S.Frames(['delivered', 'failed', 'waits']);
      const n = sc.procs.length, cardW = 200, gapX = n === 2 ? 420 : 310;
      const maxOps = Math.max(...sc.procs.map((p) => p.ops.length)), qy = 46 + maxOps * 31 + 34;
      const qnames = sc.naming === 'indirect' ? sc.mailboxes : sc.procs.filter((p) => sc.procs.some((x) => x.ops.some((o) => o.op === 'send' && o.to === p.name))).map((p) => p.name);
      let delivered = 0, failed = 0, waits = 0;
      r.steps.forEach((s) => {
        if (s.kind === 'receive' || s.kind === 'handoff') delivered++;
        if (s.kind === 'fail') failed++;
        if (s.kind === 'block') waits++;
        const items = [];
        sc.procs.forEach((p, i) => {
          const ps = s.procs[p.name];
          items.push(...X.opCard({ prefix: 'c' + p.name, x: i * gapX, y: 0, w: cardW, name: p.name, state: ps.state, sub: ps.state + (ps.got.length ? ' · got ' + ps.got.map(q).join(' ') : ''), ops: p.ops.map(opText), pc: ps.pc, act: s.who === p.name }).items);
        });
        items.push(H.title('qt', 0, qy - 12, sc.naming === 'indirect' ? 'mailboxes, in the kernel' : 'queues, in the kernel'));
        qnames.forEach((name, k) => {
          const y = qy + k * 44, list = s.queues[name] || [];
          items.push(H.cell('ql' + name, 0, y, 150, 34, sc.naming === 'indirect' ? 'mailbox ' + name : 'to ' + name, 'kern', { rx: 6 }));
          const slots = cap === Infinity ? Math.max(4, list.length) : cap;
          for (let j = 0; j < Math.max(slots, list.length); j++) {
            const m = list[j];
            items.push(H.cell('qm' + name + j, 158 + j * 64, y + 2, 58, 30, m ? m.body : '', m ? 'msg' + (s.who && s.kind === 'queue' && j === list.length - 1 ? ' act' : '') : 'slot', { rx: 5 }));
          }
          const after = 158 + Math.max(slots, list.length, cap === 0 ? 0 : 1) * 64 + 6;
          const info = cap === 0 ? 'no buffer' : cap === Infinity ? list.length + ' queued, no limit' : list.length + ' of ' + cap;
          items.push(H.text('qi' + name, after, y + 22, info, 'muted', 13));
          const held = s.waiting.filter((w) => w.q === name);
          held.forEach((w, j) => items.push(H.cell('qw' + name + j, after + Math.ceil(H.tw(info, 13)) + 18 + j * 150, y + 2, 140, 30, w.from + ' holds ' + q(w.body), 'qbox', { rx: 6 })));
        });
        F.set('delivered', delivered).set('failed', failed).set('waits', waits);
        const ps = Object.fromEntries(sc.procs.map((p) => [p.name, { pc: s.procs[p.name].pc, got: s.procs[p.name].got.length, ops: p.ops.length }]));
        F.add({ items, say: s.say, meta: { phase: s.kind, who: s.who, cap: cap === Infinity ? -1 : cap, queues: Object.fromEntries(Object.entries(s.queues).map(([k, v]) => [k, v.length])), procs: ps, deadlock: r.deadlock }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The choices', text: ['naming: send(P, m) | send(box, m)', 'capacity 0: send waits for', '  a receive (rendezvous)', 'capacity n: send waits when full', 'unbounded: send never waits', 'non-blocking send, full: fails', 'non-blocking receive, empty:', '  returns nothing at once'].join('\n') }] };
      return { frames: F.list, def, result: { delivered: r.delivered, failed: r.failed, deadlock: r.deadlock } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.who && /^(send|queue|block|fail|receive|hand)$/.test(fr[i + 1].meta.phase) && fr[i + 1].meta.who !== f.meta.who && f.meta.phase !== 'done', pick: 'option', ask: 'Which process moves next?', options: (fr, i) => Object.keys(fr[i].meta.procs), answer: (fr, i) => fr[i + 1].meta.who, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'With no buffer (capacity 0), when does a blocking send return?', options: ['when a receiver has taken the message', 'at once', 'when the queue has room', 'never'], answer: 0, why: 'There is nowhere to keep the message, so sender and receiver meet: a rendezvous.' },
      { q: 'With an unbounded queue, can a send ever block?', options: ['no', 'yes, when the receiver is slow', 'only for big messages', 'only with mailboxes'], answer: 0, why: 'There is always room; the cost is memory, and no back-pressure on a fast sender.' },
      { q: 'What does a mailbox (indirect naming) allow that direct naming does not?', options: ['several receivers sharing one queue, each message going to one of them', 'faster sends', 'bigger messages', 'no kernel'], answer: 0, why: 'The sender names the box, not a process; whoever receives first gets the message.' },
      { q: 'A and B each start with a blocking receive from the other. What happens?', options: ['both wait for ever: a deadlock', 'the kernel picks one to go first', 'both get empty messages', 'they swap'], answer: 0, why: 'Neither reaches its send, so no message ever arrives.' },
      { q: 'A non-blocking send to a full queue…', options: ['fails at once and the message is not sent', 'waits', 'drops the oldest message', 'grows the queue'], answer: 0, why: 'The caller must try again later or give up.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
