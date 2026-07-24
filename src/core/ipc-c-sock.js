// IPC models, part 3: a client and a server talking through stream sockets, as a concept model (no real network).
//   S.Ipc.sockets({procs: [{name, ops}], policy, seed, order, host: 'srv', synBackoff: 1, synRetries: 3})
//     server ops: {op: 'socket', as}, {op: 'bind', on, port}, {op: 'listen', on, backlog}, {op: 'accept', on, as},
//     client ops: {op: 'socket', as}, {op: 'connect', on, port},
//     both:       {op: 'send', on, data}, {op: 'recv', on}, {op: 'close', on}, {op: 'work', ticks}
//   Rules: connect fails with ECONNREFUSED when no socket listens on the port (the host answers the SYN with a
//   reset). When the listener's backlog of finished handshakes is full, the SYN is dropped without a reply, as
//   Linux (tcp_abort_on_overflow = 0) and the BSDs do: the client retransmits after o.synBackoff seconds (default
//   1), doubling the wait each time, and connects as soon as there is room, or fails with ETIMEDOUT after
//   o.synRetries retransmissions (default 3). One turn of a waiting client stands for one second. Otherwise the
//   kernels finish the three-way handshake (SYN, SYN-ACK, ACK) at once and the connection waits in the backlog
//   until accept takes it. accept blocks while the backlog is empty and returns a
//   new socket for that one client (the listening socket keeps listening). recv blocks while nothing has arrived
//   and the peer is still open; it returns 0 once the peer has closed. send to a closed peer fails with EPIPE.
//   -> {steps (each with socks: [{id, owner, name, state, port, peer, inbox, backlog}], procs), timeline:
//       [{t, from, to, label}] (the packets, for a client-server timeline), got: {name: [..]}, deadlock}
//   S.Ipc.clientServer({clients: 2, requests: ['GET /a'], backlog}) -> the same, for a ready-made script: one
//       server that accepts each client in turn and answers every request, and clients that connect, send, read
//       the reply and close.
(function (S) {
  'use strict';
  const I = (S.Ipc = S.Ipc || {});

  I.sockets = function (o) {
    o = o || {};
    const socks = [], vars = {}, timeline = [], got = {};
    let t = 0;
    for (const p of o.procs || []) { vars[p.name] = {}; got[p.name] = []; }
    const sock = (p, v) => vars[p.name][v];
    const pkt = (from, to, label) => timeline.push({ t: t++, from, to, label });
    const snap = (ps) => ({
      socks: socks.map((s) => ({ id: s.id, owner: s.owner, name: s.name, state: s.state, port: s.port, peer: s.peer ? s.peer.id : null, inbox: s.inbox.slice(), backlog: s.backlog ? s.backlog.map((c) => c.owner) : null })),
      procs: Object.fromEntries(ps.map((p) => [p.name, { state: p.state, pc: p.pc, got: got[p.name].slice() }])),
    });
    const listener = (port) => socks.find((s) => s.state === 'listening' && s.port === port);
    const exec = (p, op, retry) => {
      const s = op.on ? sock(p, op.on) : null;
      if (op.on && !s) return { ok: true, kind: 'error', say: p.name + ': ' + op.op + ' on ' + op.on + ' fails with EBADF: no such socket.' };
      switch (op.op) {
        case 'work': { const n = op.ticks || 1; return { ok: true, say: p.name + ' does other work for ' + I.plural(n, 'tick') + ', touching no socket.' }; }
        case 'socket': {
          const n = { id: socks.length, owner: p.name, name: op.as, state: 'new', port: null, peer: null, inbox: [], backlog: null, closed: false };
          socks.push(n); vars[p.name][op.as] = n;
          return { ok: true, say: p.name + ' calls socket(): a new stream socket, descriptor ' + op.as + ', not yet connected to anything.' };
        }
        case 'bind':
          if (socks.some((x) => x.port === op.port && x !== s && (x.state === 'bound' || x.state === 'listening'))) return { ok: true, kind: 'error', say: p.name + ': bind to port ' + op.port + ' fails with EADDRINUSE.' };
          s.port = op.port; s.state = 'bound';
          return { ok: true, say: p.name + ' binds ' + op.on + ' to port ' + op.port + ', the address clients will name.' };
        case 'listen':
          s.state = 'listening'; s.backlog = []; s.max = op.backlog || 5;
          return { ok: true, say: p.name + ' listens on port ' + s.port + ' with a backlog of ' + s.max + ': the kernel may now finish handshakes for it.' };
        case 'connect': {
          const L = listener(op.port), host = o.host || 'server', syn = s.syn;
          if (retry && syn) {
            // waiting out the retransmission timer: one turn of the client stands for one second
            if (++syn.waited < syn.wait) return { wait: true, busy: true };
            syn.tries++; syn.spent += syn.wait;
            if (!L) { pkt(p.name, host, 'SYN'); pkt(host, p.name, 'RST'); s.syn = null; return { ok: true, kind: 'refused', say: p.name + ' retransmits its SYN, but nothing listens on port ' + op.port + ' any more: the reset makes connect fail with ECONNREFUSED.' }; }
            if (L.backlog.length < L.max) { s.syn = null; return handshake(L, '\'s SYN finds room after ' + I.plural(syn.tries, 'retransmission') + ' (' + syn.spent + ' s of backoff)'); }
            pkt(p.name, host, 'SYN (dropped)');
            if (syn.tries >= syn.max) { s.syn = null; s.state = 'closed'; return { ok: true, kind: 'timeout', say: p.name + '\'s retransmission ' + syn.tries + ' is dropped too: the backlog is still full after ' + syn.spent + ' s, so connect gives up with ETIMEDOUT.' }; }
            syn.wait *= 2; syn.waited = 0;
            return { block: true, kind: 'retry', say: p.name + '\'s retransmission ' + syn.tries + ' after ' + syn.spent + ' s is dropped too: the backlog is still full (' + L.max + '), so the wait doubles to ' + syn.wait + ' s.' };
          }
          pkt(p.name, host, 'SYN');
          if (!L) {
            pkt(host, p.name, 'RST');
            return { ok: true, kind: 'refused', say: p.name + ' connects to port ' + op.port + ': nothing listens there, so the host answers with a reset and connect fails with ECONNREFUSED.' };
          }
          if (L.backlog.length >= L.max) {
            const first = o.synBackoff || 1;
            s.syn = { tries: 0, max: o.synRetries === undefined ? 3 : o.synRetries, wait: first, waited: 0, spent: 0 };
            timeline[timeline.length - 1].label = 'SYN (dropped)';
            if (!s.syn.max) { s.syn = null; s.state = 'closed'; return { ok: true, kind: 'timeout', say: p.name + ' connects to port ' + op.port + ': the backlog is full and no retries are allowed, so connect fails with ETIMEDOUT.' }; }
            return { block: true, kind: 'dropped', say: p.name + ' connects to port ' + op.port + ', but the listener\'s backlog of finished handshakes is full (' + L.max + '): the server drops the SYN without a reply (no reset), so ' + p.name + ' waits ' + first + ' s to retransmit, doubling the wait each time, up to ' + I.plural(s.syn.max, 'retry', 'retries') + '.' };
          }
          return handshake(L, '');
          function handshake(L, how) {
            if (how) pkt(p.name, host, 'SYN');
            pkt(L.owner, p.name, 'SYN-ACK'); pkt(p.name, L.owner, 'ACK');
            const conn = { client: s, owner: p.name };
            L.backlog.push(conn); s.state = 'connected'; s.pending = conn;
            return { ok: true, kind: 'connect', say: p.name + (how ? how + ':' : ' connects to port ' + op.port + ':') + ' SYN, SYN-ACK, ACK; the connection is set up and waits in the backlog (' + L.backlog.length + ' of ' + L.max + ') until the server accepts it.' };
          }
        }
        case 'accept': {
          if (s.state !== 'listening') return { ok: true, kind: 'error', say: p.name + ': accept fails with EINVAL: ' + op.on + ' is not listening.' };
          if (!s.backlog.length) { if (retry) return { wait: true }; return { block: true, say: p.name + ' calls accept, but no finished connection waits in the backlog, so it blocks.' }; }
          const c = s.backlog.shift();
          const n = { id: socks.length, owner: p.name, name: op.as, state: 'connected', port: s.port, peer: c.client, inbox: [], backlog: null, closed: false };
          c.client.peer = n; c.client.pending = null;
          // anything the client sent before the accept was already waiting in the new socket
          if (c.early) { n.inbox.push(...c.early); c.early = null; }
          socks.push(n); vars[p.name][op.as] = n;
          return { ok: true, say: p.name + ' accepts the connection from ' + c.owner + ' as a new socket ' + op.as + ' (descriptor for this client only); ' + op.on + ' keeps listening.' };
        }
        case 'send': {
          if (s.state !== 'connected') return { ok: true, kind: 'error', say: p.name + ': send fails with ENOTCONN.' };
          if (s.peerClosed) return { ok: true, kind: 'epipe', say: p.name + ' sends "' + op.data + '" but the peer has closed: send fails with EPIPE.' };
          pkt(p.name, s.peer ? s.peer.owner : o.host || 'server', '"' + op.data + '"');
          if (s.peer) s.peer.inbox.push(op.data); else { s.pending.early = s.pending.early || []; s.pending.early.push(op.data); }
          return { ok: true, say: p.name + ' sends "' + op.data + '"; the bytes sit in the other side\'s receive buffer' + (s.peer ? '' : ' (the server has not accepted yet)') + '.' };
        }
        case 'recv': {
          if (s.inbox.length) { const x = s.inbox.shift(); got[p.name].push(x); return { ok: true, say: p.name + ' receives "' + x + '" on ' + op.on + '.' }; }
          if (s.peerClosed) { got[p.name].push(null); return { ok: true, kind: 'eof', say: p.name + ' calls recv on ' + op.on + ': nothing left and the peer has closed, so recv returns 0.' }; }
          if (retry) return { wait: true };
          return { block: true, say: p.name + ' calls recv on ' + op.on + ' and blocks until data arrives.' };
        }
        case 'close': {
          const was = s.state;
          s.state = 'closed';
          if (s.peer) { s.peer.peerClosed = true; pkt(p.name, s.peer.owner, 'FIN'); }
          if (s.backlog) for (const c of s.backlog) c.client.peerClosed = true;
          delete vars[p.name][op.on];
          if (s.peer) return { ok: true, say: p.name + ' closes ' + op.on + ': a FIN tells ' + s.peer.owner + ' no more data will come.' };
          if (s.pending) { for (const L of socks) if (L.backlog) L.backlog = L.backlog.filter((c) => c !== s.pending); s.pending = null; return { ok: true, say: p.name + ' closes ' + op.on + ' before the server accepted it; the connection is dropped from the backlog.' }; }
          return { ok: true, say: p.name + ' closes ' + op.on + ', which was ' + (was === 'listening' ? 'listening, not connected to any one peer' : 'never connected') + ', so no packet is sent: there is no one to tell.' };
        }
      }
      return { ok: true, kind: 'error', say: p.name + ' tries ' + op.op + ', which this model does not know, and nothing happens.' };
    };
    const res = I.run(Object.assign({}, o, { procs: o.procs || [] }), exec, snap);
    return { steps: res.steps, timeline, got, deadlock: res.deadlock };
  };

  I.clientServer = function (o) {
    o = o || {};
    const n = Math.max(1, o.clients || 2), reqs = o.requests || ['GET /a'], port = o.port || 8080;
    const srv = [{ op: 'socket', as: 'ls' }, { op: 'bind', on: 'ls', port }, { op: 'listen', on: 'ls', backlog: o.backlog || 4 }];
    for (let i = 0; i < n; i++) {
      srv.push({ op: 'accept', on: 'ls', as: 'c' });
      for (const r of reqs) { srv.push({ op: 'recv', on: 'c' }); srv.push({ op: 'send', on: 'c', data: 'reply to ' + r }); }
      srv.push({ op: 'close', on: 'c' });
    }
    const procs = [{ name: 'server', ops: srv }];
    for (let i = 0; i < n; i++) {
      const ops = [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port }];
      for (const r of reqs) { ops.push({ op: 'send', on: 's', data: r }); ops.push({ op: 'recv', on: 's' }); }
      ops.push({ op: 'close', on: 's' });
      procs.push({ name: 'client' + (i + 1), ops });
    }
    // the server sets up its listening socket first, then everyone takes turns
    return I.sockets({ policy: o.policy || 'order', order: o.policy ? undefined : ['server', 'server', 'server'], seed: o.seed, host: 'server', procs });
  };
})(globalThis.Proses = globalThis.Proses || {});
