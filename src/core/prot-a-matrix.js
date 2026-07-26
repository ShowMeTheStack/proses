// Protection, part 1: protection domains and the access matrix, with its operations and its four implementations.
// A matrix has rows for domains and columns for objects; domains are objects too, so a row can hold 'switch'
// (may enter that domain) or 'control' (may remove rights from that domain's row). A right ending in '*' carries
// the copy flag: the holder may copy it into another domain's entry in the same column. 'owner' on an object
// lets the holder add and remove any right in that object's column.
//   S.Prot.matrix({domains, objects, cells: {'D1|F1': ['read', 'write*', 'owner'], ...}}) -> M (a copy)
//   S.Prot.rights(M, d, o) -> [rights]          S.Prot.has(M, d, o, right) -> bool ('write' matches 'write*')
//   S.Prot.check(M, d, o, right) -> {ok, say}
//   S.Prot.apply(M, {op, by, to, obj, right})   -> {ok, M (new), say, changed: ['D|O']} (M itself is unchanged)
//       op 'copy' (to gets right*), 'limited-copy' (to gets right without '*'), 'transfer' (to gets right*, by
//       loses it): need right* in (by, obj). 'add' / 'remove' (right for domain `to` in column obj): need owner
//       in (by, obj). 'control-remove' (remove right from row `to`, any column obj): need control in (by, to).
//       'switch' (by enters domain to): needs switch in (by, to).
//   Implementations and their lookups, each returning {ok, scanned, say}:
//       S.Prot.toGlobal(M) -> [{domain, object, rights}]       S.Prot.checkGlobal(T, d, o, r)
//       S.Prot.toACL(M) -> {object: [{domain, rights}]}         S.Prot.checkACL(A, d, o, r)
//       S.Prot.toCaps(M) -> {domain: [{object, rights}]}        S.Prot.checkCaps(C, d, o, r)
//       S.Prot.toLockKey(M) -> {locks: {object: {right: [lock]}}, keys: {domain: [key]}} (a right* is also
//                                  guarded under 'right*', so copy flags check the same way)
//                                                               S.Prot.checkLockKey(L, d, o, r)
//   S.Prot.revoke(M, form, {obj, right, from}) -> {cost, steps, M}: how much each form must touch to take a right
//       away (from: one domain, or 'all'); S.Prot.REVOCATION: the forms compared (immediate, selective, partial,
//       temporary, and how), for a table.
(function (S) {
  'use strict';
  const P = (S.Prot = S.Prot || {});
  const key = (d, o) => d + '|' + o;
  const base = (r) => r.replace(/\*$/, '');
  P.list = (xs) => (S.Os ? S.Os.list(xs) : xs.join(', '));
  P.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');

  P.matrix = function (o) {
    const cells = {};
    for (const [k, v] of Object.entries(o.cells || {})) if (v && v.length) cells[k] = Array.from(new Set(v)).sort();
    return { domains: (o.domains || []).slice(), objects: (o.objects || []).slice(), cells };
  };
  const copyM = (M) => P.matrix(M);
  P.rights = (M, d, o) => (M.cells[key(d, o)] || []).slice();
  P.has = (M, d, o, r) => P.rights(M, d, o).some((x) => base(x) === base(r) && (!r.endsWith('*') || x.endsWith('*')));
  P.columns = (M) => M.objects.concat(M.domains);

  P.check = function (M, d, o, r) {
    const ok = P.has(M, d, o, r), rs = P.rights(M, d, o);
    return { ok, say: 'Entry (' + d + ', ' + o + ') holds ' + (rs.length ? '{' + rs.join(', ') + '}' : 'nothing') + ', so ' + d + ' ' + (ok ? 'may ' : 'may not ') + base(r) + ' ' + o + (r.endsWith('*') ? ' and copy that right on' : '') + '.' };
  };

  const set = (M, d, o, rs) => { const k = key(d, o); if (rs.length) M.cells[k] = Array.from(new Set(rs)).sort(); else delete M.cells[k]; };

  P.apply = function (M0, a) {
    const M = copyM(M0), r = a.right ? base(a.right) : null, no = (say) => ({ ok: false, M: M0, say, changed: [] });
    switch (a.op) {
      case 'copy': case 'limited-copy': case 'transfer': {
        if (!P.has(M, a.by, a.obj, r + '*')) return no(a.by + ' holds no ' + r + '* on ' + a.obj + ', so it may not ' + a.op.replace('-', ' ') + ' ' + r + ': the copy flag is missing.');
        const give = a.op === 'limited-copy' ? r : r + '*';
        set(M, a.to, a.obj, P.rights(M, a.to, a.obj).filter((x) => base(x) !== r).concat(P.has(M, a.to, a.obj, r + '*') && a.op === 'limited-copy' ? [r + '*'] : [give]));
        const changed = [key(a.to, a.obj)];
        if (a.op === 'transfer') { set(M, a.by, a.obj, P.rights(M, a.by, a.obj).filter((x) => base(x) !== r)); changed.push(key(a.by, a.obj)); }
        const what = { copy: 'copies ' + r + '* (copy flag kept, so ' + a.to + ' may copy it on)', 'limited-copy': 'copies ' + r + ' without the copy flag (' + a.to + ' may use it but not pass it on)', transfer: 'transfers ' + r + '* (and loses it itself)' }[a.op];
        return { ok: true, M, changed, say: a.by + ' holds ' + r + '* on ' + a.obj + ', so it ' + what + ' to ' + a.to + '.' };
      }
      case 'add': case 'remove': {
        if (!P.has(M, a.by, a.obj, 'owner')) return no(a.by + ' does not own ' + a.obj + ', so it may not ' + a.op + ' rights in that column.');
        const cur = P.rights(M, a.to, a.obj);
        set(M, a.to, a.obj, a.op === 'add' ? cur.concat([a.right]) : cur.filter((x) => base(x) !== r));
        return { ok: true, M, changed: [key(a.to, a.obj)], say: a.by + ' owns ' + a.obj + ', so it may ' + (a.op === 'add' ? 'give ' + a.right + ' to ' : 'take ' + r + ' away from ') + a.to + ' in that column.' };
      }
      case 'control-remove': {
        if (!P.has(M, a.by, a.to, 'control')) return no(a.by + ' holds no control right over ' + a.to + ', so it may not change ' + a.to + '\'s row.');
        set(M, a.to, a.obj, P.rights(M, a.to, a.obj).filter((x) => base(x) !== r));
        return { ok: true, M, changed: [key(a.to, a.obj)], say: a.by + ' controls domain ' + a.to + ', so it removes ' + r + ' on ' + a.obj + ' from ' + a.to + '\'s row.' };
      }
      case 'switch': {
        if (!P.has(M, a.by, a.to, 'switch')) return no('Entry (' + a.by + ', ' + a.to + ') holds no switch right, so a process in ' + a.by + ' may not enter ' + a.to + '.');
        return { ok: true, M, changed: [], domain: a.to, say: 'Entry (' + a.by + ', ' + a.to + ') holds switch, so the process moves from ' + a.by + ' to ' + a.to + ' and from now on has ' + a.to + '\'s rights instead.' };
      }
    }
    return no('Unknown operation ' + a.op + '.');
  };

  // ---- implementations ----
  P.toGlobal = (M) => Object.entries(M.cells).map(([k, rights]) => { const [domain, object] = k.split('|'); return { domain, object, rights: rights.slice() }; });
  P.toACL = function (M) {
    const A = {};
    for (const o of P.columns(M)) A[o] = [];
    for (const t of P.toGlobal(M)) (A[t.object] = A[t.object] || []).push({ domain: t.domain, rights: t.rights });
    return A;
  };
  P.toCaps = function (M) {
    const C = {};
    for (const d of M.domains) C[d] = [];
    for (const t of P.toGlobal(M)) (C[t.domain] = C[t.domain] || []).push({ object: t.object, rights: t.rights });
    return C;
  };
  P.toLockKey = function (M) {
    // one key per domain; each right on an object is guarded by the locks matching the domains that hold it
    const keys = {}, locks = {};
    M.domains.forEach((d, i) => { keys[d] = ['k' + (i + 1)]; });
    for (const t of P.toGlobal(M)) {
      locks[t.object] = locks[t.object] || {};
      for (const r of t.rights) for (const b of r.endsWith('*') ? [base(r), r] : [r]) (locks[t.object][b] = locks[t.object][b] || []).push(keys[t.domain][0]);
    }
    return { keys, locks };
  };
  const holds = (rights, r) => rights.some((x) => base(x) === base(r) && (!r.endsWith('*') || x.endsWith('*')));
  P.checkGlobal = function (T, d, o, r) {
    let scanned = 0;
    for (const t of T) { scanned++; if (t.domain === d && t.object === o) { const ok = holds(t.rights, r); return { ok, scanned, say: 'The global table is searched for (' + d + ', ' + o + ', …): found after ' + scanned + ' of ' + P.plural(T.length, 'triple') + ', with {' + t.rights.join(', ') + '}: ' + (ok ? 'allowed' : 'denied') + '.' }; } }
    return { ok: false, scanned, say: 'No triple (' + d + ', ' + o + ', …) among all ' + T.length + ' in the table: denied.' };
  };
  P.checkACL = function (A, d, o, r) {
    const L = A[o] || [];
    let scanned = 0;
    for (const e of L) { scanned++; if (e.domain === d) { const ok = holds(e.rights, r); return { ok, scanned, say: o + '\'s access list names ' + d + ' with {' + e.rights.join(', ') + '} (entry ' + scanned + ' of ' + L.length + '): ' + (ok ? 'allowed' : 'denied') + '.' }; } }
    return { ok: false, scanned, say: o + '\'s access list (' + L.length + ' entr' + (L.length === 1 ? 'y' : 'ies') + ') does not name ' + d + ': denied.' };
  };
  P.checkCaps = function (C, d, o, r) {
    const L = C[d] || [];
    let scanned = 0;
    for (const c of L) { scanned++; if (c.object === o) { const ok = holds(c.rights, r); return { ok, scanned, say: d + ' presents its capability for ' + o + ' with {' + c.rights.join(', ') + '}: ' + (ok ? 'allowed' : 'denied') + '.' }; } }
    return { ok: false, scanned, say: d + ' holds no capability for ' + o + ' (' + P.plural(L.length, 'capability', 'capabilities') + ' in its list): denied.' };
  };
  P.checkLockKey = function (L, d, o, r) {
    const ks = L.keys[d] || [], ls = ((L.locks[o] || {})[r] || []);
    const ok = ks.some((k) => ls.includes(k));
    return { ok, scanned: ls.length, say: d + ' tries its key' + (ks.length > 1 ? 's' : '') + ' ' + ks.join(', ') + ' against the ' + r + ' lock' + (ls.length === 1 ? '' : 's') + ' of ' + o + ' {' + ls.join(', ') + '}: ' + (ok ? 'a key fits, allowed' : 'none fits, denied') + '.' };
  };

  P.revoke = function (M0, form, a) {
    const r = base(a.right), M = copyM(M0), targets = a.from === 'all' ? M.domains.filter((d) => P.has(M0, d, a.obj, r)) : [a.from];
    for (const d of targets) set(M, d, a.obj, P.rights(M, d, a.obj).filter((x) => base(x) !== r));
    const steps = [], who = targets.length ? P.list(targets) : 'no domain (none holds it)';
    let cost = 0;
    const total = P.toGlobal(M0).length;
    if (form === 'acl') {
      cost = (P.toACL(M0)[a.obj] || []).length;
      steps.push({ kind: 'revoke', say: 'ACL: walk ' + a.obj + '\'s list (' + P.plural(cost, 'entry', 'entries') + ') and strike ' + r + ' from ' + who + '. It is immediate and can pick any one domain.' });
    } else if (form === 'caps') {
      const C = P.toCaps(M0);
      cost = M0.domains.reduce((n, d) => n + C[d].length, 0);
      steps.push({ kind: 'revoke', say: 'Capabilities: they are spread over every domain\'s list, so finding each one for ' + a.obj + ' means searching all ' + P.plural(cost, 'capability', 'capabilities') + '; real systems use back-pointers, indirection or keys to avoid that search.' });
    } else if (form === 'global') {
      cost = total;
      steps.push({ kind: 'revoke', say: 'Global table: search all ' + P.plural(total, 'triple') + ' for (' + (a.from === 'all' ? 'any' : a.from) + ', ' + a.obj + ') and edit them.' });
    } else if (form === 'lockkey') {
      const L = P.toLockKey(M0);
      cost = ((L.locks[a.obj] || {})[r] || []).length;
      steps.push({ kind: 'revoke', say: 'Lock and key: change ' + a.obj + '\'s ' + r + ' locks (' + P.plural(cost, 'lock') + ') so ' + (targets.length ? who + '\'s key no longer fits' : 'no key fits') + '; no domain is touched.' });
    }
    return { cost, steps, M, targets };
  };
  P.REVOCATION = [
    { form: 'Access-control list', immediate: true, selective: true, partial: true, temporary: true, how: 'edit the object\'s list' },
    { form: 'Global table', immediate: true, selective: true, partial: true, temporary: true, how: 'search the whole table' },
    { form: 'Capabilities, re-acquisition', immediate: false, selective: false, partial: true, temporary: true, how: 'delete capabilities now and then; a domain must ask again' },
    { form: 'Capabilities, back-pointers', immediate: true, selective: true, partial: true, temporary: true, how: 'the object points to every copy, at a cost' },
    { form: 'Capabilities, indirection', immediate: true, selective: false, partial: false, temporary: true, how: 'capabilities point into a table; delete the table entry' },
    { form: 'Capabilities, keys', immediate: true, selective: false, partial: false, temporary: true, how: 'change the master key; every old capability stops matching' },
    { form: 'Lock and key', immediate: true, selective: true, partial: true, temporary: true, how: 'change the object\'s locks' },
  ];

  /** a small preset to start from */
  P.preset = () => P.matrix({
    domains: ['D1', 'D2', 'D3'], objects: ['F1', 'F2', 'printer'],
    cells: { 'D1|F1': ['owner', 'read', 'write*'], 'D1|F2': ['read'], 'D1|D2': ['switch'], 'D2|F2': ['read*', 'execute'], 'D2|printer': ['print'], 'D2|D3': ['control', 'switch'], 'D3|F1': ['read'], 'D3|printer': ['print'] },
  });
})(globalThis.Proses = globalThis.Proses || {});
