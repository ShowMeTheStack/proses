// Part 3, clients and servers, as concept models: stream sockets (S.Ipc.sockets) drawn as a client-server
// timeline, one lifeline a party and one arrow a packet, beside the table of sockets; a remote procedure call
// (S.Ipc.rpcCall) through its stubs with the message's bytes; and what retries do to a call when messages are
// lost or repeated (S.Ipc.semantics), at least once against at most once.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const q = (s) => '"' + s + '"';
  /** lifelines and packets: o {prefix, parties: [{name, x, cls, sub}], top, rowH, rows, packets: [{from, to, label, cls, lost}], act} */
  X.timeline = function (o) {
    const P = o.prefix || 'tl', items = [], X0 = Object.fromEntries(o.parties.map((p) => [p.name, p.x]));
    const bottom = o.top + o.rows * o.rowH + 10;
    o.parties.forEach((p) => {
      items.push(H.cell(P + ':h' + p.name, p.x - 70, 0, 140, 40, '', 'fdproc ' + (p.cls || 's-ready'), { lines: [p.name, p.sub || ''], rx: 8 }));
      items.push({ key: P + ':l' + p.name, kind: 'line', x1: p.x, y1: 40, x2: p.x, y2: bottom, cls: 'lifeline', layer: 'back', audit: 'ignore' });
    });
    o.packets.forEach((k, i) => {
      const y = o.top + i * o.rowH, x1 = X0[k.from], x2 = X0[k.to], dir = x2 > x1 ? 1 : -1;
      const end = k.lost ? x1 + (x2 - x1) * 0.55 : x2 - dir * 2;
      items.push({ key: P + ':p' + i, kind: 'edge', from: { x: x1 + dir * 2, y }, to: { x: end, y: y + o.rowH * 0.25 }, label: k.label + (k.lost && !k.dropped ? '  ✕ lost' : k.dup ? '  (again)' : ''), lx: (x1 + x2) / 2, ly: y - 10, size: 13, cls: 'pkt ' + (k.cls || '') + (k.lost ? ' lost' : '') + (k.dup ? ' dup' : '') + (i === o.act ? ' act' : '') });
    });
    return { items, h: bottom };
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Sockets
  // ---------------------------------------------------------------------------------------------------------------
  /** the scripts: a server that answers each request, and clients that connect, ask and close */
  function script(clients, reqs, backlog, retry, served, busy) {
    const srv = [{ op: 'socket', as: 'ls' }, { op: 'bind', on: 'ls', port: 8080 }, { op: 'listen', on: 'ls', backlog }].concat(Array.from({ length: busy || 0 }, () => ({ op: 'work', ticks: 1 })));
    for (let i = 0; i < (served || clients); i++) {
      srv.push({ op: 'accept', on: 'ls', as: 'c' });
      for (const r of reqs) { srv.push({ op: 'recv', on: 'c' }); srv.push({ op: 'send', on: 'c', data: r.replace('GET', 'OK') }); }
      srv.push({ op: 'close', on: 'c' });
    }
    const procs = [];
    for (let i = 0; i < clients; i++) {
      const ops = [{ op: 'socket', as: 's' }, { op: 'connect', on: 's', port: 8080 }].concat(retry ? [{ op: 'connect', on: 's', port: 8080 }] : []);
      // a client the server will not serve only connects (and waits, retries or times out) and closes
      if (!served || i < served) for (const r of reqs) { ops.push({ op: 'send', on: 's', data: r }); ops.push({ op: 'recv', on: 's' }); }
      ops.push({ op: 'close', on: 's' });
      procs.push({ name: 'client' + (i + 1), ops });
    }
    procs.splice(Math.min(1, procs.length), 0, { name: 'server', ops: srv });
    return procs;
  }
  const SOCK = {
    one: { label: 'one client, two requests', clients: 1, reqs: ['GET /a', 'GET /b'], backlog: 4, order: ['server', 'server', 'server'] },
    two: { label: 'two clients, served in turn', clients: 2, reqs: ['GET /a'], backlog: 4, order: ['server', 'server', 'server'] },
    retry: { label: 'a full backlog: the SYN is dropped, the retry gets in', clients: 2, reqs: ['GET /a'], backlog: 1, busy: 2, order: ['server', 'server', 'server', 'client1', 'client1', 'client2', 'client2'] },
    full: { label: 'a backlog that stays full: the client times out', clients: 2, served: 1, reqs: ['GET /a'], backlog: 1, busy: 9, order: ['server', 'server', 'server', 'client1', 'client1', 'client2', 'client2'] },
    early: { label: 'the client connects too early, then tries again', retry: true, clients: 1, reqs: ['GET /a'], backlog: 4, order: ['client1', 'client1', 'server', 'server', 'server'] },
  };
  X.SOCK = SOCK;
  X.sockRun = function (k, max) {
    const sc = SOCK[k];
    return S.Ipc.sockets({ procs: script(sc.clients, sc.reqs, sc.backlog, sc.retry, sc.served, sc.busy), policy: 'order', order: sc.order.slice(), host: 'server', max });
  };
  const sockText = (s) => s.owner + ' ' + s.name + ': ' + s.state + (s.port ? ' :' + s.port : '') + (s.backlog && s.backlog.length ? ' (' + s.backlog.length + ' waiting)' : '') + (s.inbox && s.inbox.length ? ', ' + s.inbox.length + ' unread' : '');

  S.topic({
    id: 'p03-sockets', family: 'p03-net', order: 10, title: 'Clients and servers over sockets',
    blurb: 'A server makes a socket, binds it to a port that clients will name, and listens. A client connects: the two kernels finish a three-way handshake and the new connection waits in the listening socket\'s backlog until the server accepts it, which gives the server a second socket for that one client. Then bytes flow both ways, and each side closes. No listener refuses the connection; a full backlog makes the client\'s kernel retry until there is room (or time out).',
    inputs: [{ id: 'scene', kind: 'choice', label: 'Scenario', def: 'one', options: Object.keys(SOCK).map((k) => ({ value: k, label: SOCK[k].label })) }],
    presets: Object.keys(SOCK).map((k) => ({ label: H.cap(SOCK[k].label), values: { scene: k } })),
    counters: [{ id: 'packets', label: 'packets' }, { id: 'socks', label: 'sockets' }],
    run(inp) {
      const sc = SOCK[inp.scene], full = X.sockRun(inp.scene);
      // how many packets had been sent by each step: the same run cut short after 1, 2, ... turns
      const sent = [];
      for (let m = 1; m <= full.turns + 1; m++) { const r = X.sockRun(inp.scene, m); for (let j = sent.length; j < r.steps.length; j++) sent[j] = r.timeline.length; }
      const names = sc.clients === 1 ? ['client1', 'server'] : ['client1', 'server', 'client2'];
      const xs = sc.clients === 1 ? [80, 400] : [70, 260, 450];
      const rows = Math.max(6, full.timeline.length), rowH = Math.min(34, Math.round(420 / rows));
      const F = new S.Frames(['packets', 'socks']);
      full.steps.forEach((s, j) => {
        const n = sent[j] === undefined ? full.timeline.length : sent[j];
        const parties = names.map((nm, i) => { const ps = s.procs[nm]; const st = ps.state === 'done' ? 's-done' : ps.state === 'blocked' ? 's-blocked' : s.who === nm ? 's-running act' : 's-ready'; return { name: nm, x: xs[i], cls: st, sub: ps.state }; });
        const items = X.timeline({ prefix: 'tl', parties, top: 70, rowH, rows, packets: full.timeline.slice(0, n).map((p, k, a) => { const drop = /dropped/.test(p.label), before = a.slice(0, k).filter((q) => q.from === p.from && /^SYN/.test(q.label) && /dropped/.test(q.label)).length; const again = /^SYN/.test(p.label) && before > 0; return { from: p.from, to: p.to, label: drop ? 'SYN ' + (again ? '+' + (1 << (before - 1)) + ' s, ' : '') + 'dropped' : again ? 'SYN +' + (1 << (before - 1)) + ' s' : p.label, lost: drop, dropped: drop, cls: p.from === 'server' ? 'reply' : '' }; }), act: n - 1 }).items;
        const sx = 540, sw = 280;
        items.push(H.title('st', sx, 14, 'sockets'));
        s.socks.forEach((k, i) => items.push(H.cell('sk' + k.id, sx, 26 + i * 34, sw, 30, sockText(k), 'oftext' + (k.state === 'listening' ? ' act' : ''), { rx: 6, align: 'left' })));
        F.set('packets', n).set('socks', s.socks.length);
        F.add({ items, say: s.say.replace('a FIN tells', 'the FIN packet tells'), meta: { phase: s.kind, who: s.who, packets: n, backoff: { waits: [1, 2, 4], total: [1, 3, 7], tries: [1, 2, 3] }, port: 8080, backlog: sc.backlog, socks: s.socks.map((k) => [k.id, k.port, k.inbox.length, k.backlog ? k.backlog.length : 0]), ops: Object.values(s.procs).map((p) => p.pc), nops: script(sc.clients, sc.reqs, sc.backlog, sc.retry, sc.served, sc.busy).map((p) => p.ops.length) }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The calls', text: ['server: socket, bind(port),', '  listen(backlog), accept', 'client: socket, connect(port)', 'connect: SYN, SYN-ACK, ACK;', '  then waits in the backlog', 'accept: a new socket per client', 'send / recv: bytes both ways', 'close: FIN, the peer reads 0'].join('\n') }] };
      return { frames: F.list, def, result: { got: full.got, timeline: full.timeline, deadlock: full.deadlock } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && /^(connect|refused)$/.test(fr[i + 1].meta.phase), pick: 'option', ask: 'A client connects next. Will the connection be set up now?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.phase === 'connect' ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'What does accept return?', options: ['a new socket for one client; the listening socket keeps listening', 'the listening socket itself', 'the client\'s pid', 'a port number'], answer: 0, why: 'One listening socket, one connected socket per client.' },
      { q: 'When is a connection set up: at connect or at accept?', options: ['at connect: the kernels finish the handshake; accept only collects it', 'at accept', 'at the first send', 'at listen'], answer: 0, why: 'Finished connections wait in the backlog for accept.' },
      { q: 'A client connects before any socket listens on the port. What happens?', options: ['connect fails: connection refused', 'it waits for the server', 'it connects to the kernel', 'the data is queued'], answer: 0, why: 'No listener, so the server\'s kernel answers with a reset.' },
      { q: 'What does recv return after the peer has closed and every byte has been read?', options: ['0, like end of file on a pipe', '-1', 'it waits for ever', 'the last message again'], answer: 0, why: 'A stream socket ends like a pipe.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Remote procedure calls: the stubs and the bytes
  // ---------------------------------------------------------------------------------------------------------------
  const CALLS = {
    add: { label: 'add(7, −2)', proc: 'add', args: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], value: { a: 7, b: -2 }, result: [{ name: 'sum', type: 'int32' }], impl: (v) => ({ sum: v.a + v.b }) },
    big: { label: 'add(300, 70000)', proc: 'add', args: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], value: { a: 300, b: 70000 }, result: [{ name: 'sum', type: 'int32' }], impl: (v) => ({ sum: v.a + v.b }) },
    greet: { label: 'greet("Ola", 2)', proc: 'greet', args: [{ name: 'name', type: 'string' }, { name: 'times', type: 'uint8' }], value: { name: 'Ola', times: 2 }, result: [{ name: 'text', type: 'string' }], impl: (v) => ({ text: Array.from({ length: v.times }, () => 'hi ' + v.name).join(' ') }) },
    total: { label: 'total([3, 4, 5])', proc: 'total', args: [{ name: 'xs', type: 'int32[]' }], value: { xs: [3, 4, 5] }, result: [{ name: 't', type: 'int32' }], impl: (v) => ({ t: v.xs.reduce((a, b) => a + b, 0) }) },
  };
  X.CALLS = CALLS;
  const hex2 = (b) => b.toString(16).padStart(2, '0');
  const LAYERS = [['client', 'program', 'the caller'], ['client', 'stub', 'client stub'], ['server', 'stub', 'server stub'], ['server', 'program', 'the procedure']];
  const lit = { call: [0], marshal: [1], send: [1], receive: [2], unmarshal: [2], execute: [3], reply: [2], return: [1, 0] };
  S.topic({
    id: 'p03-rpc', family: 'p03-net', order: 20, title: 'A remote procedure call, byte by byte',
    blurb: 'A remote procedure call looks like an ordinary call. Underneath, a client stub marshals the arguments into bytes in an agreed order (here big-endian, each field padded to 4 bytes, a string or array led by its length), puts a request id and the procedure\'s number in front and sends the message. The server stub unmarshals the bytes, calls the real procedure and marshals the result back. The two machines need not agree on byte order or word size, only on the encoding.',
    inputs: [{ id: 'call', kind: 'choice', label: 'Call', def: 'add', options: Object.keys(CALLS).map((k) => ({ value: k, label: CALLS[k].label })) }, { id: 'id', kind: 'number', label: 'Request id', def: 5, min: 1, max: 9999 }],
    presets: Object.keys(CALLS).map((k, i) => ({ label: CALLS[k].label, values: { call: k, id: 5 + i } })),
    counters: [{ id: 'bytes', label: 'bytes on the wire' }],
    run(inp) {
      const c = CALLS[inp.call];
      const r = S.Ipc.rpcCall({ proc: c.proc, args: c.args, value: c.value, result: c.result, impl: c.impl, id: inp.id });
      const F = new S.Frames(['bytes']);
      const reqF = S.Ipc.marshal(c.args, c.value).fields, repF = S.Ipc.marshal(c.result, r.result).fields;
      let wire = 0, msg = [], hdr = 0;
      r.steps.forEach((s) => {
        if (s.kind === 'marshal') { msg = msg.concat(s.bytes); }
        if (s.kind === 'send') { msg = s.bytes.slice(); hdr = 8; wire += s.bytes.length; }
        if (s.kind === 'reply') { msg = s.bytes.slice(); hdr = 4; wire += s.bytes.length; }
        const items = [];
        LAYERS.forEach((L, k) => {
          const x = k < 2 ? 0 : 560, y = (k % 2 === 0 ? 30 : 100) + (k >= 2 ? 0 : 0);
          const yy = k === 0 || k === 3 ? 30 : 100;
          items.push({ key: 'ly' + k, kind: 'state', x: x + 130, y: yy, w: 260, h: 44, rx: 8, text: L[2], size: 14, cls: 'layer ' + (L[0] === 'client' ? 'user' : 'kern') + ((lit[s.kind] || []).includes(k) ? ' act' : '') });
        });
        items.push(H.title('cl', 0, 0, 'client machine'), H.title('sv', 560, 0, 'server machine'));
        const back = s.kind === 'reply' || s.kind === 'return';
        items.push({ key: 'net', kind: 'edge', from: back ? 'ly2' : 'ly1', to: back ? 'ly1' : 'ly2', label: s.kind === 'reply' || s.kind === 'return' ? 'reply' : 'request', lx: 410, ly: 86, size: 13, cls: 'pkt' + (s.kind === 'send' || s.kind === 'receive' || s.kind === 'reply' ? ' act' : '') });
        // the message's bytes, coloured by field
        const cw = 30, per = 26;
        items.push(H.title('bt', 0, 168, s.kind === 'reply' || s.kind === 'return' ? 'the reply' : 'the request'));
        const fields = (s.kind === 'reply' || s.kind === 'return' ? repF : reqF).map((f) => ({ name: f.name, from: f.offset + hdr, to: f.offset + hdr + f.length }));
        if (hdr) fields.unshift({ name: hdr === 8 ? 'id, procedure' : 'id', from: 0, to: hdr });
        const fieldOf = (i) => fields.findIndex((f) => i >= f.from && i < f.to);
        msg.forEach((b, i) => {
          const k = fieldOf(i), field = hdr && k === 0 ? 'hdr' : 'f' + ((k - (hdr ? 1 : 0)) % 4);
          items.push(H.cell('b' + i, (i % per) * cw, 180 + Math.floor(i / per) * 58, cw - 3, 28, hex2(b), 'byte ' + field, { rx: 4 }));
        });
        // a brace under each field with its name (within one row of bytes)
        fields.forEach((f, k) => {
          if (f.from >= msg.length) return;
          const a = f.from, z = Math.min(f.to, msg.length) - 1, row = Math.floor(a / per), zr = Math.floor(z / per);
          const x2 = (zr === row ? z % per : per - 1) * cw + cw - 3;
          items.push({ key: 'fb' + k, kind: 'bracket', x1: (a % per) * cw, x2, y: 180 + row * 58 + 31, side: 'below', text: f.name, cls: k === 0 && hdr ? '' : 'act' });
        });
        const rowsUsed = Math.max(1, Math.ceil(msg.length / per));
        items.push(H.text('bl', 0, 180 + rowsUsed * 58 + 22, msg.length ? msg.length + ' bytes' + (hdr ? ': grey, the header (' + (hdr === 8 ? 'request id, procedure' : 'request id') + ')' : '') : 'no bytes yet', 'muted', 13));
        F.set('bytes', wire);
        F.add({ items, say: s.say.replace(/(\d)–(\d)/g, '$1 to $2').replace(/\b[0-9a-f]{2}(?: [0-9a-f]{2})+\b/g, (m) => m.replace(/ /g, '\u2002')), meta: { phase: s.kind, id: inp.id, len: msg.length, fields: reqF.concat(repF).map((f) => [f.offset, f.offset + f.length - 1, f.length]), word: 4, bytes: msg, hex: msg.map(hex2).concat((s.bytes || []).map(hex2)), value: c.value, result: r.result, wire, args: c.args.length }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The encoding', text: ['int32: 4 bytes, most significant', '  first (big-endian)', 'uint8, bool: 1 byte + 3 padding', 'string: 4-byte length, the', '  characters, padded to 4', 'int32[]: 4-byte count, items', 'request: id, procedure, args', 'reply: id, result'].join('\n') }] };
      return { frames: F.list, def, result: { request: r.request, reply: r.reply, result: r.result } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'send', once: true, pick: 'option', ask: 'How many bytes will the request be in all?', options: (fr, i) => { const n = fr[i + 1].meta.len; return [...new Set([n - 8, n - 4, n, n + 4])].filter((x) => x > 0).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.len), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does RPC fix one byte order on the wire?', options: ['the two machines may store integers differently; both convert to the agreed order', 'it is faster', 'networks need it', 'to pad strings'], answer: 0, why: 'A little-endian client and a big-endian server still read the same number.' },
      { q: 'What does the client stub do?', options: ['marshals the arguments, sends the request, waits, and unmarshals the reply', 'runs the procedure', 'routes packets', 'picks the server'], answer: 0, why: 'It makes the remote call look local to the program.' },
      { q: 'How is the string "Ola" encoded here?', options: ['00 00 00 03, then 4f 6c 61, then one byte of padding', '4f 6c 61 00', '03 4f 6c 61', 'as 3 int32s'], answer: 0, why: 'A 4-byte length, the characters, padded to a multiple of 4.' },
      { q: 'Why can a pointer not be passed as it is?', options: ['an address means nothing in the server\'s memory; the data it points to must be sent', 'pointers are too long', 'the kernel forbids it', 'it can'], answer: 0, why: 'The two processes do not share an address space.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
