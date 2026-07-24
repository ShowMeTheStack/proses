// IPC models, part 4: remote procedure calls. Stubs make a remote call look like a local one: the client stub
// marshals the arguments into bytes, a message carries them, the server stub unmarshals them, calls the real
// procedure, and sends the marshalled result back. Messages can be lost or duplicated, so the client retries,
// and the server's semantics decide what a retry means.
//   S.Ipc.marshal(schema, value) -> {bytes: [..], fields: [{name, type, offset, length, value, bytes}], steps}
//   S.Ipc.unmarshal(schema, bytes) -> {value, fields, steps, used}
//       schema: [{name, type}] with type 'int32' | 'uint16' | 'uint8' | 'bool' | 'string' | 'int32[]'.
//       The encoding is big-endian (network byte order), every field padded to a multiple of 4 bytes; a string
//       or an array is its length as a 4-byte count, then its bytes (or items). Strings are ASCII.
//   S.Ipc.rpcCall({proc, args: schema, value, result: schema, impl: (value) => resultValue, id})
//       -> {steps: [{kind, side, say, bytes?}], request, reply, result}: the whole stub path.
//   S.Ipc.semantics({semantics: 'at-least-once' | 'at-most-once', calls: [{op, arg}], loss, dup, retries, seed,
//                    start})
//       ops on a server-side number: 'deposit' (adds arg, not idempotent), 'set' (sets it to arg, idempotent),
//       'read' (idempotent). The network loses each message with probability `loss` and delivers a request
//       twice with probability `dup` (seeded). At-least-once runs every request that arrives; at-most-once keeps
//       each request id with its reply and answers a repeat from that table without running it again.
//       -> {steps, timeline: [{t, from, to, label, lost, dup}], calls: [{op, arg, tries, executions, answered,
//           result}], final, expected, correct}
//   S.Ipc.IDEMPOTENT: {deposit: false, set: true, read: true}
(function (S) {
  'use strict';
  const I = (S.Ipc = S.Ipc || {});
  const hx = (b) => b.toString(16).padStart(2, '0');
  I.hexBytes = (bs) => bs.map(hx).join(' ');
  const pad4 = (n) => (4 - (n % 4)) % 4;
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

  const enc = {
    int32: (v) => u32(v | 0),
    uint16: (v) => [(v >>> 8) & 255, v & 255, 0, 0],
    uint8: (v) => [v & 255, 0, 0, 0],
    bool: (v) => u32(v ? 1 : 0),
    string: (v) => { const cs = Array.from(String(v), (c) => c.charCodeAt(0) & 127); return u32(cs.length).concat(cs, Array(pad4(cs.length)).fill(0)); },
    'int32[]': (v) => u32(v.length).concat(...v.map((x) => u32(x | 0))),
  };
  const rd32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  const dec = {
    int32: (b, i) => [rd32(b, i), 4],
    uint16: (b, i) => [(b[i] << 8) | b[i + 1], 4],
    uint8: (b, i) => [b[i], 4],
    bool: (b, i) => [rd32(b, i) !== 0, 4],
    string: (b, i) => { const n = rd32(b, i) >>> 0; return [String.fromCharCode(...b.slice(i + 4, i + 4 + n)), 4 + n + pad4(n)]; },
    'int32[]': (b, i) => { const n = rd32(b, i) >>> 0, out = []; for (let k = 0; k < n; k++) out.push(rd32(b, i + 4 + 4 * k)); return [out, 4 + 4 * n]; },
  };
  const how = {
    int32: 'a 4-byte two\'s-complement integer, most significant byte first',
    uint16: '2 bytes, most significant first, then 2 bytes of padding',
    uint8: '1 byte and 3 bytes of padding',
    bool: '4 bytes holding 0 or 1',
    string: 'a 4-byte length, then the characters, padded to a multiple of 4',
    'int32[]': 'a 4-byte count, then 4 bytes per item',
  };

  I.marshal = function (schema, value) {
    const bytes = [], fields = [], steps = [];
    for (const f of schema) {
      if (!enc[f.type]) throw new Error('unknown type ' + f.type);
      const v = value[f.name], b = enc[f.type](v);
      fields.push({ name: f.name, type: f.type, offset: bytes.length, length: b.length, value: v, bytes: b });
      steps.push({ kind: 'field', say: f.name + ' = ' + JSON.stringify(v) + ' (' + f.type + '): ' + how[f.type] + ', bytes ' + bytes.length + '–' + (bytes.length + b.length - 1) + ': ' + I.hexBytes(b) + '.', field: f.name, offset: bytes.length, bytes: b });
      bytes.push(...b);
    }
    steps.push({ kind: 'done', say: 'The message body is ' + I.plural(bytes.length, 'byte') + ', the same on every machine whatever its own byte order.', bytes: bytes.slice() });
    return { bytes, fields, steps };
  };
  I.unmarshal = function (schema, bytes) {
    const value = {}, fields = [], steps = [];
    let i = 0;
    for (const f of schema) {
      const [v, n] = dec[f.type](bytes, i);
      value[f.name] = v;
      fields.push({ name: f.name, type: f.type, offset: i, length: n, value: v });
      steps.push({ kind: 'field', say: 'Bytes ' + i + '–' + (i + n - 1) + ' (' + I.hexBytes(bytes.slice(i, i + n)) + ') read as ' + f.type + ' give ' + f.name + ' = ' + JSON.stringify(v) + '.', field: f.name, offset: i });
      i += n;
    }
    return { value, fields, steps, used: i };
  };

  I.rpcCall = function (o) {
    o = o || {};
    const proc = o.proc || 'add_item', id = o.id || 1;
    const args = o.args || [{ name: 'shelf', type: 'uint16' }, { name: 'name', type: 'string' }, { name: 'count', type: 'int32' }];
    const value = o.value || { shelf: 12, name: 'lamp', count: 3 };
    const result = o.result || [{ name: 'total', type: 'int32' }];
    const impl = o.impl || ((v) => ({ total: v.count + 10 }));
    const steps = [], add = (kind, side, say, data) => steps.push(Object.assign({ kind, side, say }, data || {}));
    add('call', 'client', 'The program calls ' + proc + '(' + args.map((a) => JSON.stringify(value[a.name])).join(', ') + ') as if it were local; the call goes to the client stub.');
    const m = I.marshal(args, value);
    const header = u32(id).concat(u32(o.procNumber || 7));
    for (const s of m.steps.slice(0, -1)) add('marshal', 'client', 'Client stub: ' + s.say, { bytes: s.bytes });
    const request = header.concat(m.bytes);
    add('send', 'client', 'The stub puts request id ' + id + ' and procedure number ' + (o.procNumber || 7) + ' in front, ' + request.length + ' bytes in all, and sends the message; the caller waits.', { bytes: request.slice() });
    add('receive', 'server', 'The server stub receives ' + request.length + ' bytes and reads procedure ' + rd32(request, 4) + ' for request ' + rd32(request, 0) + '.', { bytes: request.slice() });
    const u = I.unmarshal(args, request.slice(8));
    for (const s of u.steps) add('unmarshal', 'server', 'Server stub: ' + s.say[0].toLowerCase() + s.say.slice(1));
    const out = impl(u.value);
    add('execute', 'server', 'The server stub calls the real ' + proc + ' with ' + JSON.stringify(u.value) + ', which returns ' + JSON.stringify(out) + '.');
    const r = I.marshal(result, out), reply = u32(id).concat(r.bytes);
    add('reply', 'server', 'The result is marshalled into ' + r.bytes.length + ' bytes (' + I.hexBytes(r.bytes) + ') behind the request id and sent back.', { bytes: reply.slice() });
    const back = I.unmarshal(result, reply.slice(4));
    add('return', 'client', 'The client stub matches id ' + rd32(reply, 0) + ' to its waiting call, unmarshals ' + JSON.stringify(back.value) + ' and returns it to the program, which never saw a byte.', { value: back.value });
    return { steps, request, reply, result: back.value };
  };

  I.IDEMPOTENT = { deposit: false, set: true, read: true };

  I.semantics = function (o) {
    o = o || {};
    const sem = o.semantics || 'at-least-once', loss = o.loss === undefined ? 0.3 : o.loss, dup = o.dup === undefined ? 0.2 : o.dup, retries = Math.max(1, o.retries || 4);
    const calls = (o.calls || [{ op: 'deposit', arg: 10 }, { op: 'set', arg: 50 }, { op: 'deposit', arg: 5 }]).map((c) => ({ op: c.op, arg: c.arg || 0 }));
    const rand = S.Os.rng(o.seed === undefined ? 1 : o.seed);
    let value = o.start || 0, expected = value, t = 0, idSeq = 100;
    const done = new Map(), steps = [], timeline = [], out = [];
    const apply = (c) => { if (c.op === 'deposit') value += c.arg; else if (c.op === 'set') value = c.arg; return value; };
    const add = (kind, say, data) => steps.push(Object.assign({ kind, say, t, value }, data || {}));
    const msg = (from, to, label, lost, d) => timeline.push({ t: t++, from, to, label, lost: !!lost, dup: !!d });
    add('start', 'The server\'s number starts at ' + value + '; the server runs ' + sem + ', the network loses ' + Math.round(loss * 100) + '% of messages and repeats ' + Math.round(dup * 100) + '% of requests.');
    for (const c of calls) {
      const id = idSeq++, rec = { op: c.op, arg: c.arg, id, tries: 0, executions: 0, answered: false, result: null };
      expected = c.op === 'deposit' ? expected + c.arg : c.op === 'set' ? c.arg : expected;
      for (let k = 0; k < retries && !rec.answered; k++) {
        rec.tries++;
        const label = c.op + '(' + (c.op === 'read' ? '' : c.arg) + ') #' + id;
        const lostReq = rand() < loss, twice = !lostReq && rand() < dup;
        msg('client', 'server', label, lostReq);
        if (lostReq) { add('lost', 'Try ' + rec.tries + ' of request ' + id + ' (' + label + ') is lost on the way; the client times out.', { call: id }); continue; }
        const arrivals = twice ? 2 : 1;
        if (twice) msg('client', 'server', label, false, true);
        let reply = null;
        for (let a = 0; a < arrivals; a++) {
          if (sem === 'at-most-once' && done.has(id)) {
            reply = done.get(id);
            add('cached', 'Request ' + id + ' arrives again' + (a ? ' (a duplicate)' : '') + ': at-most-once finds it in the table and resends the saved reply ' + reply + ' without running ' + c.op + ' again.', { call: id });
          } else {
            const before = value;
            reply = apply(c); rec.executions++;
            if (sem === 'at-most-once') done.set(id, reply);
            add('execute', 'The server runs ' + label + (a ? ' again for the duplicate' : '') + ': the number goes from ' + before + ' to ' + value + ' (run ' + rec.executions + ' time' + (rec.executions > 1 ? 's' : '') + ' so far).', { call: id });
          }
        }
        const lostRep = rand() < loss;
        msg('server', 'client', 'reply ' + reply + ' #' + id, lostRep);
        if (lostRep) { add('lost', 'The reply to request ' + id + ' is lost; the client cannot tell whether the call ran, times out and retries with the same id.', { call: id }); continue; }
        rec.answered = true; rec.result = reply;
        add('answer', 'The client gets reply ' + reply + ' for request ' + id + ' after ' + rec.tries + ' tr' + (rec.tries > 1 ? 'ies' : 'y') + '.', { call: id });
      }
      if (!rec.answered) add('give-up', 'The client gives up on request ' + id + ' after ' + I.plural(retries, 'try', 'tries') + '; it ran ' + rec.executions + ' time' + (rec.executions === 1 ? '' : 's') + ', which the client cannot know.', { call: id });
      out.push(rec);
    }
    const correct = value === expected;
    const repeats = out.filter((r) => r.executions > 1);
    add('end', 'The number ends at ' + value + '; running each call exactly once gives ' + expected + '. ' + (correct ? 'They agree' + (repeats.length ? ', though ' + repeats.map((r) => r.op + ' #' + r.id).join(', ') + ' ran more than once: harmless only because it is idempotent or did not change the end result' : '') + '.' : 'They differ: ' + (repeats.length ? repeats.map((r) => r.op + ' #' + r.id + ' ran ' + r.executions + ' times').join(', ') : 'a call never ran') + '.'));
    return { steps, timeline, calls: out, final: value, expected, correct, semantics: sem };
  };

  (S.engines = S.engines || []).push({ name: 'Message passing, sockets and RPC' });
})(globalThis.Proses = globalThis.Proses || {});
