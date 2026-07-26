// Protection, part 4: memory-safety defences and sandboxes, as models. Why an unchecked copy into a stack buffer
// is dangerous is shown only as a concept (too many bytes run past the buffer into the slots above it); the
// views teach the defences: a bounded copy, the stack canary that catches the damage before the function
// returns, pages that refuse to execute (NX, W^X), base addresses shuffled at every run (ASLR), and a sandbox
// policy that limits what a program may ask the kernel for. Nothing here builds an attack.
//   S.Prot.frame({buffer: 16, canary: true, seed}) -> {slots: [{name, at, size, value}], canary}
//       slots from the buffer (lowest address) up: buffer, canary (when on), saved frame pointer, return address.
//   S.Prot.copyInto(frame, length, {bounded: false})
//       -> {steps: [{kind, say, slots: [{name, at, size, value, damaged}]}], damaged: [slot names], outcome:
//           'ok' | 'truncated' | 'stopped' (the canary caught it) | 'crash' (the return address is damaged)}
//   S.Prot.nx({pages: [{name, perms: 'r-x'}], accesses: [{page, op: 'read' | 'write' | 'exec'}]})
//       -> {steps, results: [{page, op, ok}], wx: [names of pages both writable and executable]}
//   S.Prot.aslr({regions: [{name, base, bits}], page: 4096, seed, runs: 3})
//       -> {runs: [{seed, bases: {name: address}}], steps, odds: {name: 2^-bits}}
//   S.Prot.sandbox({policy: {calls: [..], paths: [prefixes], write: [prefixes], net: false}, requests: [{call,
//       path?, host?}]}) -> {steps, results: [{call, ok, why}]}
//   S.Prot.isolation(a, b) -> {shared: [{kind, what}], steps}: what two processes' views (uid, files, net, pids)
//       have in common.
(function (S) {
  'use strict';
  const P = (S.Prot = S.Prot || {});
  const hex = (n, d) => '0x' + n.toString(16).padStart(d || 8, '0');

  P.frame = function (o) {
    o = o || {};
    const n = Math.max(4, o.buffer || 16), rand = S.Os.rng(o.seed === undefined ? 5 : o.seed);
    // the canary is random at every program start, with a zero low byte so string copies stop at it
    const canary = o.canary === false ? null : ((Math.floor(rand() * 0xffffff) << 8) >>> 0);
    const base = 0x7ffd0100, slots = [];
    let at = base;
    slots.push({ name: 'buffer', at, size: n, value: '(empty)' }); at += n;
    if (canary !== null) { slots.push({ name: 'canary', at, size: 8, value: hex(canary) }); at += 8; }
    slots.push({ name: 'saved frame pointer', at, size: 8, value: hex(0x7ffd0200) }); at += 8;
    slots.push({ name: 'return address', at, size: 8, value: hex(0x00401a3c) });
    return { slots, canary, buffer: n };
  };

  P.copyInto = function (fr, len, o) {
    o = o || {};
    const slots = fr.slots.map((s) => Object.assign({}, s, { damaged: false })), steps = [], damaged = [];
    const snap = () => slots.map((s) => Object.assign({}, s));
    const buf = slots[0];
    steps.push({ kind: 'call', say: 'The function starts: its frame has ' + S.Os.article(buf.size) + ' ' + buf.size + '-byte buffer at ' + hex(buf.at) + (fr.canary !== null ? ', then the canary ' + hex(fr.canary) : '') + ', the saved frame pointer and the return address above it.', slots: snap() });
    let n = len;
    if (o.bounded) {
      n = Math.min(len, buf.size);
      buf.value = P.plural(n, 'byte') + ' of input';
      steps.push({ kind: 'copy', say: 'A bounded copy takes min(' + len + ', ' + buf.size + ') = ' + P.plural(n, 'byte') + (len > buf.size ? ', cutting the input short' : '') + ': nothing past the buffer is touched.', slots: snap() });
      steps.push({ kind: 'return', say: 'The function returns normally to ' + slots[slots.length - 1].value + '.', slots: snap() });
      return { steps, damaged, outcome: len > buf.size ? 'truncated' : 'ok' };
    }
    buf.value = P.plural(Math.min(len, buf.size), 'byte') + ' of input';
    let over = len - buf.size;
    if (over <= 0) {
      steps.push({ kind: 'copy', say: 'An unchecked copy of ' + P.plural(len, 'byte') + ' fits in the ' + buf.size + '-byte buffer: no harm this time, by luck rather than by design.', slots: snap() });
      steps.push({ kind: 'return', say: 'The function returns normally.', slots: snap() });
      return { steps, damaged, outcome: 'ok' };
    }
    for (const s of slots.slice(1)) {
      if (over <= 0) break;
      s.damaged = true; s.value = '(overwritten)'; damaged.push(s.name);
      over -= s.size;
    }
    steps.push({ kind: 'overflow', say: 'An unchecked copy of ' + P.plural(len, 'byte') + ' is ' + (len - buf.size) + ' too many for the buffer: the extra bytes run upward over ' + damaged.join(', then ') + '.', slots: snap() });
    if (fr.canary !== null && damaged.includes('canary')) {
      steps.push({ kind: 'canary', say: 'Before returning, the function compares the canary with the copy kept elsewhere: it changed, so the program reports "stack smashing detected" and stops before the damaged return address is ever used.', slots: snap() });
      return { steps, damaged, outcome: 'stopped' };
    }
    if (damaged.includes('return address')) {
      steps.push({ kind: 'crash', say: 'With no canary, the return goes to a garbage address: the program crashes (or worse). NX and ASLR make it much harder to turn such damage into anything but a crash, and a canary or a bounded copy stops it outright.', slots: snap() });
      return { steps, damaged, outcome: 'crash' };
    }
    steps.push({ kind: 'return', say: 'The return address survived, but ' + damaged.join(' and ') + ' did not: the program may misbehave later.', slots: snap() });
    return { steps, damaged, outcome: 'crash' };
  };

  P.nx = function (o) {
    o = o || {};
    const pages = o.pages || [{ name: 'text', perms: 'r-x' }, { name: 'data', perms: 'rw-' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rw-' }];
    const steps = [], results = [], by = Object.fromEntries(pages.map((p) => [p.name, p]));
    const wx = pages.filter((p) => p.perms[1] === 'w' && p.perms[2] === 'x').map((p) => p.name);
    steps.push({ kind: 'policy', say: wx.length ? 'W^X is broken: ' + wx.join(', ') + ' may be both written and executed.' : 'W^X holds: no page is both writable and executable.' });
    const idx = { read: 0, write: 1, exec: 2 }, word = { read: 'read', write: 'write', exec: 'execute' };
    for (const a of o.accesses || [{ page: 'text', op: 'exec' }, { page: 'stack', op: 'write' }, { page: 'stack', op: 'exec' }, { page: 'text', op: 'write' }]) {
      const p = by[a.page], ok = !!p && p.perms[idx[a.op]] !== '-';
      results.push({ page: a.page, op: a.op, ok });
      steps.push({ kind: ok ? 'allow' : 'fault', page: a.page, op: a.op, say: ok ? 'The CPU may ' + word[a.op] + ' ' + a.page + ' (' + p.perms + ').' : 'The page-table entry for ' + a.page + ' (' + (p ? p.perms : 'unmapped') + ') forbids ' + word[a.op] + (a.op === 'exec' ? ': the NX bit is set, so the CPU raises a fault instead of running bytes from data' : '') + '; the kernel stops the process.' });
    }
    return { steps, results, wx };
  };

  P.aslr = function (o) {
    o = o || {};
    const page = o.page || 4096, runs = Math.max(1, o.runs || 3), seed0 = o.seed === undefined ? 1 : o.seed;
    const regions = o.regions || [{ name: 'text', base: 0x00400000, bits: 8 }, { name: 'heap', base: 0x01000000, bits: 13 }, { name: 'libraries', base: 0x70000000, bits: 12 }, { name: 'stack', base: 0x7f700000, bits: 11 }];
    const out = [], steps = [], odds = {};
    for (const r of regions) odds[r.name] = 2 ** -r.bits;
    for (let k = 0; k < runs; k++) {
      const rand = S.Os.rng(seed0 + k * 7919), bases = {};
      for (const r of regions) bases[r.name] = r.base + Math.floor(rand() * 2 ** r.bits) * page;
      out.push({ seed: seed0 + k * 7919, bases });
      steps.push({ kind: 'run', run: k + 1, bases, say: 'Run ' + (k + 1) + ': ' + regions.map((r) => r.name + ' at ' + hex(bases[r.name])).join(', ') + '.' });
    }
    steps.push({ kind: 'odds', say: 'Each region moves by whole pages within 2^bits slots, so a fixed address is right for one run with odds of ' + regions.map((r) => '1 in ' + 2 ** r.bits + ' for ' + r.name).join(', ') + '; a wrong guess usually crashes the program and is noticed.' });
    return { runs: out, steps, odds };
  };

  P.sandbox = function (o) {
    const pol = Object.assign({ calls: ['read', 'write', 'open', 'close', 'exit'], paths: ['/sandbox/'], write: ['/sandbox/out/'], net: false }, (o && o.policy) || {});
    const steps = [], results = [];
    const under = (path, list) => list.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));
    for (const q of (o && o.requests) || []) {
      let ok = true, why;
      if (!pol.calls.includes(q.call) && !(q.call === 'connect' && pol.net)) { ok = false; why = q.call + ' is not on the list of allowed calls (' + pol.calls.join(', ') + ')'; }
      else if (q.call === 'connect') { ok = !!pol.net; why = ok ? 'the policy allows the network' : 'the policy allows no network'; }
      else if (q.path !== undefined) {
        const norm = normalise(q.path);
        if (!under(norm, pol.paths)) { ok = false; why = q.path + (norm !== q.path ? ' (which is really ' + norm + ')' : '') + ' is outside ' + pol.paths.join(', '); }
        else if (q.write && !under(norm, pol.write)) { ok = false; why = 'writing is allowed only under ' + pol.write.join(', '); }
        else why = norm + ' is inside the allowed tree' + (q.write ? ' and writable' : '');
      } else why = q.call + ' is allowed';
      results.push({ call: q.call, ok, why });
      steps.push({ kind: ok ? 'allow' : 'deny', say: q.call + (q.path ? '("' + q.path + '"' + (q.write ? ', write' : '') + ')' : q.host ? '(' + q.host + ')' : '()') + ': ' + (ok ? 'allowed: ' : 'refused with EPERM: ') + why + '.' });
    }
    steps.push({ kind: 'result', say: results.filter((r) => !r.ok).length + ' of ' + P.plural(results.length, 'request') + ' refused: the program keeps working inside its box, and a mistake in it cannot reach anything outside.' });
    return { steps, results };
  };
  /** resolve . and .. so a path cannot climb out of the box by spelling */
  function normalise(p) {
    const out = [];
    for (const part of p.split('/')) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
    return '/' + out.join('/') + (p.endsWith('/') && out.length ? '/' : '');
  }
  P.normalise = normalise;

  P.isolation = function (a, b) {
    const shared = [], steps = [];
    if (a.uid === b.uid) shared.push({ kind: 'uid', what: 'the same user id ' + a.uid });
    const fa = new Set(a.files || []);
    for (const f of b.files || []) if (fa.has(f)) shared.push({ kind: 'file', what: f });
    if (a.net && b.net && a.net === b.net) shared.push({ kind: 'net', what: 'network ' + a.net });
    if ((a.pidns || 'root') === (b.pidns || 'root')) shared.push({ kind: 'pids', what: 'one process-id space (each can see and signal the other)' });
    for (const s of shared) steps.push({ kind: 'shared', say: 'Both reach ' + s.what + '.' });
    steps.push({ kind: 'result', say: shared.length ? 'Not isolated: they share ' + shared.length + ' thing' + (shared.length > 1 ? 's' : '') + '.' : 'Isolated: they share no user, file, network or process view.' });
    return { shared, steps };
  };

  (S.engines = S.engines || []).push({ name: 'Protection and authentication' });
})(globalThis.Proses = globalThis.Proses || {});
