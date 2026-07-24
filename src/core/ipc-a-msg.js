// IPC models, part 1: message passing (the kernel's pipes live in k-*.js; these are the concept models beside them).
// Naming is direct (send to a process; receive from anyone, or from one named sender) or indirect (send to and
// receive from a mailbox that several processes may share). Each queue holds `capacity` messages: 0 (no
// buffering: a rendezvous), n (bounded) or Infinity (unbounded). Sends and receives are blocking or not.
// Blocking rules:
//   send, a receiver already waiting: the message is handed over at once and both go on.
//   send, room in the queue: the message is queued and the sender goes on (never blocks when unbounded).
//   send, no room (always so at capacity 0): a blocking send waits until a receive takes its message; a
//     non-blocking send fails at once (EAGAIN) and the message is not sent.
//   receive, a message queued (or a sender waiting at capacity 0): take the oldest, which frees a waiting sender.
//   receive, nothing there: a blocking receive waits; a non-blocking one returns "nothing" at once.
// API:
//   S.Ipc.run({procs: [{name, ops}], policy: 'rr' | 'random' | 'order', seed, order: [names], max}, exec, snap)
//       the shared runner every script model here uses: exec(p, op, retry, procs) -> {ok, say, data} | {block, say}
//       | {wait} | {wait, busy} (a timer is running, so this is not a deadlock); a blocked process that retries may
//       return {block, say, kind} to narrate a retry and stay blocked; a process whose blocked operation another one finished is marked p.completed = {say?}.
//       -> {steps, deadlock: [names] | null, turns}
//   S.Ipc.messages({naming: 'direct' | 'indirect', capacity, send: 'blocking' | 'nonblocking',
//                   recv: 'blocking' | 'nonblocking', mailboxes: [names], procs, policy, seed, order})
//       ops: {op: 'send', to, msg} | {op: 'recv', from?} | {op: 'work', ticks}; with indirect naming `to` and `from`
//       name mailboxes.
//       -> {steps (each with queues: {q: [{from, body}]}, procs: {name: {state, pc, got: [..]}}), delivered,
//           failed, deadlock}
(function (S) {
  'use strict';
  const I = (S.Ipc = S.Ipc || {});
  const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  I.plural = plural;

  I.run = function (o, exec, snap) {
    const procs = o.procs.map((p, i) => ({ name: p.name || 'P' + i, ops: p.ops || [], pc: 0, state: 'ready', completed: null, i, blockedSay: '' }));
    const steps = [], max = o.max || 400;
    let rand = null;
    if (o.policy === 'random') { const mk = S.Os && S.Os.rng; rand = mk ? mk(o.seed === undefined ? 1 : o.seed) : Math.random; }
    const order = (o.order || []).slice();
    const live = () => procs.filter((p) => p.state !== 'done');
    const add = (kind, p, say, data) => steps.push(Object.assign({ kind, who: p ? p.name : null, say }, data || {}, snap ? snap(procs) : {}));
    const settle = () => {
      for (const p of procs) {
        if (p.completed) { const c = p.completed; p.completed = null; p.pc++; p.state = 'ready'; if (c.say) add('wake', p, c.say, c.data); }
        if (p.state !== 'done' && p.pc >= p.ops.length) { p.state = 'done'; add('done', p, p.name + ' has finished its ' + plural(p.ops.length, 'operation') + '.'); }
      }
    };
    settle();
    let turns = 0, idle = 0, rr = 0, deadlock = null;
    while (live().length && turns < max) {
      let p;
      if (o.policy === 'order' && order.length) { const n = order.shift(); p = procs.find((x) => x.name === n && x.state !== 'done'); if (!p) continue; }
      else if (rand) { const L = live(); p = L[Math.floor(rand() * L.length)]; }
      else { const L = procs; for (let k = 0; k < L.length; k++) { const c = L[(rr + k) % L.length]; if (c.state !== 'done') { p = c; rr = (c.i + 1) % L.length; break; } } }
      turns++;
      const op = p.ops[p.pc], retry = p.state === 'blocked';
      const r = exec(p, op, retry, procs) || { ok: true };
      if (r.ok) { p.state = 'ready'; p.pc++; idle = 0; add(r.kind || op.op, p, r.say, r.data); }
      else if (r.block) { if (!retry) { p.state = 'blocked'; idle = 0; add(r.kind || 'block', p, r.say, r.data); } else if (r.say) { idle = 0; add(r.kind || 'retry', p, r.say, r.data); } else idle++; }
      else if (r.busy) idle = 0; // waiting out a timer, which will end by itself
      else idle++;
      settle();
      const L = live();
      if (L.length && L.every((x) => x.state === 'blocked') && idle >= L.length * 2) {
        deadlock = L.map((x) => x.name);
        add('deadlock', null, 'Every process left (' + deadlock.join(', ') + ') is blocked and none can wake another: they wait for ever.');
        break;
      }
      if (o.policy === 'order' && !order.length && !rand) o.policy = 'rr';
    }
    if (turns >= max && live().length) add('limit', null, 'Stopped after ' + max + ' turns.');
    return { steps, deadlock, turns, procs };
  };

  I.messages = function (o) {
    o = o || {};
    const naming = o.naming || 'direct', cap = o.capacity === undefined ? Infinity : o.capacity;
    const sendBlocks = (o.send || 'blocking') === 'blocking', recvBlocks = (o.recv || 'blocking') === 'blocking';
    const queues = {}, waitingSend = [], delivered = [], failed = [], got = {};
    let seq = 0;
    const qname = (p, op, dir) => (dir === 'send' ? op.to : naming === 'indirect' ? op.from : p.name);
    for (const p of o.procs || []) { got[p.name] = []; if (naming === 'direct') queues[p.name] = []; }
    for (const m of o.mailboxes || []) queues[m] = [];
    const capText = cap === 0 ? 'no buffer (capacity 0)' : cap === Infinity ? 'an unbounded queue' : 'a queue of ' + cap;
    const matches = (p, op, m) => naming === 'indirect' || !op.from || m.from === op.from;
    const snap = (ps) => ({
      queues: Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, v.map((m) => ({ from: m.from, body: m.body }))])),
      waiting: waitingSend.map((w) => ({ from: w.p.name, q: w.q, body: w.m.body })),
      procs: Object.fromEntries(ps.map((p) => [p.name, { state: p.state, pc: p.pc, got: got[p.name].slice() }])),
    });
    const blockedRecv = new Map(); // process name -> {q, op}
    const exec = (p, op, retry, all) => {
      if (op.op === 'work') { const n = op.ticks || 1; return { ok: true, say: p.name + ' does other work for ' + plural(n, 'tick') + ', touching no queue.' }; }
      if (op.op === 'send') {
        const q = op.to;
        if (!queues[q]) { if (naming === 'direct' && !(o.procs || []).some((x) => x.name === q)) return { ok: true, kind: 'error', say: p.name + ' sends to ' + q + ', which does not exist: the send fails.' }; queues[q] = queues[q] || []; }
        const m = { from: p.name, to: q, body: op.msg, seq: seq++ };
        if (retry) return { wait: true };
        // a receiver already blocked on this queue, with nothing queued ahead of it
        for (const [rn, w] of blockedRecv) {
          if (w.q === q && matches(null, w.op, m) && !queues[q].some((x) => matches(null, w.op, x))) {
            blockedRecv.delete(rn);
            got[rn].push(m.body); delivered.push({ from: m.from, to: rn, via: q, body: m.body });
            const rp = all.find((x) => x.name === rn); if (rp) rp.completed = {};
            return { ok: true, kind: 'handoff', say: p.name + ' sends "' + m.body + '" ' + (naming === 'indirect' ? 'to mailbox ' + q : 'to ' + q) + '; ' + rn + ' was already waiting, so the kernel hands it straight over and wakes ' + rn + '.' };
          }
        }
        if (queues[q].length < cap) {
          queues[q].push(m);
          return { ok: true, kind: 'queue', say: p.name + ' sends "' + m.body + '" ' + (naming === 'indirect' ? 'to mailbox ' + q : 'to ' + q) + '; it waits in the queue (' + queues[q].length + (cap === Infinity ? '' : ' of ' + cap) + ') and ' + p.name + ' goes on.' };
        }
        if (!sendBlocks) { failed.push({ from: p.name, to: q, body: m.body }); return { ok: true, kind: 'fail', say: p.name + '\'s non-blocking send of "' + m.body + '" fails with EAGAIN: ' + (cap === 0 ? 'no receiver is waiting and there is no buffer' : 'the queue is full (' + cap + ')') + '. The message is not sent.' }; }
        waitingSend.push({ p, q, m });
        return { block: true, say: p.name + ' sends "' + m.body + '" and blocks: ' + (cap === 0 ? 'with no buffer it must wait for a receiver to take it' : 'the queue to ' + q + ' is full (' + cap + ')') + '.' };
      }
      if (op.op === 'recv') {
        const q = qname(p, op, 'recv');
        if (!queues[q]) queues[q] = [];
        const i = queues[q].findIndex((m) => matches(p, op, m));
        let m = null, freed = null;
        if (i >= 0) {
          m = queues[q].splice(i, 1)[0];
          const wi = waitingSend.findIndex((w) => w.q === q);
          if (wi >= 0) { const w = waitingSend.splice(wi, 1)[0]; queues[q].push(w.m); w.p.completed = { say: w.p.name + '\'s message "' + w.m.body + '" now fits in the queue, so ' + w.p.name + ' wakes.' }; freed = w.p.name; }
        } else {
          const wi = waitingSend.findIndex((w) => w.q === q && matches(p, op, w.m));
          if (wi >= 0) { const w = waitingSend.splice(wi, 1)[0]; m = w.m; w.p.completed = { say: w.p.name + '\'s send completes: ' + p.name + ' took "' + m.body + '", so ' + w.p.name + ' wakes.' }; freed = w.p.name; }
        }
        if (!m && retry) return { wait: true };
        if (m) {
          blockedRecv.delete(p.name);
          got[p.name].push(m.body); delivered.push({ from: m.from, to: p.name, via: q, body: m.body });
          return { ok: true, kind: 'receive', say: p.name + ' receives "' + m.body + '" from ' + m.from + (naming === 'indirect' ? ' through mailbox ' + q : '') + (freed && cap === 0 ? ' in a rendezvous' : '') + '.' };
        }
        if (!recvBlocks) return { ok: true, kind: 'empty', say: p.name + '\'s non-blocking receive finds nothing' + (op.from && naming === 'direct' ? ' from ' + op.from : '') + ' and returns at once.' };
        blockedRecv.set(p.name, { q, op });
        return { block: true, say: p.name + ' tries to receive' + (naming === 'indirect' ? ' from mailbox ' + q : op.from ? ' from ' + op.from : '') + ', finds nothing, and blocks.' };
      }
      return { ok: true, kind: 'error', say: p.name + ' tries ' + op.op + ', which this model does not know, and nothing happens.' };
    };
    const res = I.run(Object.assign({}, o, { procs: o.procs || [] }), exec, snap);
    return { steps: res.steps, delivered, failed, deadlock: res.deadlock, capText, settings: { naming, capacity: cap, send: sendBlocks ? 'blocking' : 'nonblocking', recv: recvBlocks ? 'blocking' : 'nonblocking' } };
  };
})(globalThis.Proses = globalThis.Proses || {});
