// Protection (prot-*.js): access-matrix operations by hand; on random matrices, the global table, the ACLs, the
// capability lists and the lock-key form all give the same answer as the matrix and an independent check; UNIX
// permission checks against an independent implementation over every user, file and operation, on the preset
// and on random modes; every mode string round trip; setuid; least privilege; the toy hash against known FNV-1a
// values; salting, rate limiting and the second factor; the memory-safety and sandbox models.
import { load, harness, rng } from './load.mjs';

const t = harness('prot');
const S = load(['core']);
const P = S.Prot;
const clean = (steps, what) => { for (const s of steps) if (typeof s.say !== 'string' || !s.say || /undefined|NaN/.test(s.say)) { t.ok(false, what + ': bad say ' + JSON.stringify(s.say)); return; } t.ok(true, what); };

// ---- the access matrix by hand ----
{
  const M = P.preset();
  t.ok(P.check(M, 'D1', 'F1', 'write').ok && P.check(M, 'D1', 'F1', 'write*').ok, 'D1 may write F1 and copy that right');
  t.ok(!P.check(M, 'D3', 'F1', 'write').ok, 'D3 may not write F1');
  const c = P.apply(M, { op: 'copy', by: 'D1', to: 'D3', obj: 'F1', right: 'write' });
  t.eq([c.ok, P.rights(c.M, 'D3', 'F1')], [true, ['read', 'write*']], 'copy gives write* to D3');
  t.eq(P.rights(M, 'D3', 'F1'), ['read'], 'the original matrix is unchanged');
  const lc = P.apply(M, { op: 'limited-copy', by: 'D1', to: 'D3', obj: 'F1', right: 'write' });
  t.eq(P.rights(lc.M, 'D3', 'F1'), ['read', 'write'], 'limited copy gives write without the copy flag');
  t.ok(!P.apply(lc.M, { op: 'copy', by: 'D3', to: 'D2', obj: 'F1', right: 'write' }).ok, 'so D3 cannot pass it on');
  const tr = P.apply(M, { op: 'transfer', by: 'D1', to: 'D2', obj: 'F1', right: 'write' });
  t.eq([P.rights(tr.M, 'D1', 'F1'), P.rights(tr.M, 'D2', 'F1')], [['owner', 'read'], ['write*']], 'transfer moves the right');
  t.ok(!P.apply(M, { op: 'copy', by: 'D1', to: 'D2', obj: 'F2', right: 'read' }).ok, 'no copy without the copy flag');
  const add = P.apply(M, { op: 'add', by: 'D1', to: 'D2', obj: 'F1', right: 'read' });
  t.eq([add.ok, P.rights(add.M, 'D2', 'F1')], [true, ['read']], 'the owner adds a right in its column');
  t.ok(!P.apply(M, { op: 'add', by: 'D2', to: 'D3', obj: 'F1', right: 'read' }).ok, 'a non-owner may not');
  const rm = P.apply(M, { op: 'remove', by: 'D1', to: 'D3', obj: 'F1', right: 'read' });
  t.eq(P.rights(rm.M, 'D3', 'F1'), [], 'the owner removes a right');
  const ctl = P.apply(M, { op: 'control-remove', by: 'D2', to: 'D3', obj: 'printer', right: 'print' });
  t.eq([ctl.ok, P.rights(ctl.M, 'D3', 'printer')], [true, []], 'control over D3 removes from D3\'s row');
  t.ok(!P.apply(M, { op: 'control-remove', by: 'D1', to: 'D3', obj: 'printer', right: 'print' }).ok, 'without control it is refused');
  t.eq([P.apply(M, { op: 'switch', by: 'D1', to: 'D2' }).domain, P.apply(M, { op: 'switch', by: 'D1', to: 'D3' }).ok], ['D2', false], 'domain switching follows the switch entries');
  clean([c, lc, tr, add, rm, ctl].map((x) => ({ say: x.say })), 'matrix narration');
}
// ---- the four implementations agree on random matrices ----
{
  const r = rng(31), RIGHTS = ['read', 'write', 'execute', 'append'];
  for (let trial = 0; trial < 60; trial++) {
    const domains = Array.from({ length: 2 + Math.floor(r() * 3) }, (_, i) => 'D' + i), objects = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => 'O' + i);
    const cells = {};
    for (const d of domains) for (const o of objects.concat(domains)) if (r() < 0.5) {
      const rs = (domains.includes(o) ? ['switch', 'control'] : RIGHTS.concat(['owner'])).filter(() => r() < 0.4).map((x) => (x !== 'owner' && x !== 'switch' && x !== 'control' && r() < 0.3 ? x + '*' : x));
      if (rs.length) cells[d + '|' + o] = rs;
    }
    const M = P.matrix({ domains, objects, cells });
    const T = P.toGlobal(M), A = P.toACL(M), C = P.toCaps(M), L = P.toLockKey(M);
    let agree = true, indep = true;
    for (const d of domains) for (const o of objects.concat(domains)) for (const q of RIGHTS.concat(RIGHTS.map((x) => x + '*'), ['owner', 'switch', 'control'])) {
      const m = P.has(M, d, o, q);
      const own = (cells[d + '|' + o] || []).some((x) => x === q || (!q.endsWith('*') && x === q + '*'));
      if (own !== m) indep = false;
      if (P.check(M, d, o, q).ok !== m || P.checkGlobal(T, d, o, q).ok !== m || P.checkACL(A, d, o, q).ok !== m || P.checkCaps(C, d, o, q).ok !== m || P.checkLockKey(L, d, o, q).ok !== m) agree = false;
    }
    t.ok(indep, 'the matrix matches an independent lookup, trial ' + trial);
    t.ok(agree, 'matrix, global table, ACLs, capabilities and lock-key agree, trial ' + trial);
    const entries = T.length;
    t.eq(Object.values(A).reduce((a, l) => a + l.length, 0), entries, 'ACL entries = matrix cells, trial ' + trial);
    t.eq(Object.values(C).reduce((a, l) => a + l.length, 0), entries, 'capabilities = matrix cells, trial ' + trial);
    // revoking: every form leaves the same matrix, and the ACL touches only one column
    const o = objects[0], d = domains[0];
    const forms = ['acl', 'caps', 'global', 'lockkey'].map((f) => P.revoke(M, f, { obj: o, right: 'read', from: 'all' }));
    t.ok(forms.every((f) => JSON.stringify(f.M) === JSON.stringify(forms[0].M)) && domains.every((x) => !P.has(forms[0].M, x, o, 'read')), 'revocation from all, trial ' + trial);
    t.eq(forms[0].cost, A[o].length, 'an ACL revocation scans one list, trial ' + trial);
    t.eq(forms[1].cost, entries, 'a capability revocation searches every list, trial ' + trial);
    t.ok(!P.has(P.revoke(M, 'acl', { obj: o, right: 'write', from: d }).M, d, o, 'write'), 'selective revocation, trial ' + trial);
  }
  t.eq(P.REVOCATION.length, 7, 'the revocation comparison table');
}
// ---- UNIX permissions ----
const indepAccess = (sys, user, path, op, euid) => {
  const U = sys.users[user], uid = euid === undefined ? U.uid : euid, groups = new Set([U.gid].concat(U.groups));
  const bits = (f) => { if (uid === f.uid) return (f.mode >> 6) & 7; if (groups.has(f.gid)) return (f.mode >> 3) & 7; return f.mode & 7; };
  const can = (f, b) => (uid === 0 ? (b !== 1 || f.type === 'dir' || (f.mode & 0o111) !== 0) : (bits(f) & b) !== 0);
  if (path === '/' && (op === 'create' || op === 'delete')) return false;
  const parts = path.split('/').filter(Boolean);
  const dirs = parts.length ? ['/'] : []; // reaching / itself searches nothing
  for (let i = 1; i < parts.length; i++) dirs.push('/' + parts.slice(0, i).join('/'));
  const parent = dirs[dirs.length - 1];
  if (op === 'create') { if (sys.files[path] || !sys.files[parent]) return false; }
  else if (!sys.files[path]) return false;
  for (const d of dirs) if (!can(sys.files[d], 1)) return false;
  if (op === 'create' || op === 'delete') {
    if (!can(sys.files[parent], 2)) return false;
    if (op === 'delete' && sys.files[parent].mode & 0o1000 && uid !== 0 && uid !== sys.files[path].uid && uid !== sys.files[parent].uid) return false;
    return true;
  }
  const f = sys.files[path];
  if (op === 'list') return f.type === 'dir' && can(f, 4);
  if (op === 'enter') return f.type === 'dir' && can(f, 1);
  return can(f, { read: 4, write: 2, execute: 1 }[op]);
};
{
  const sys = P.unix();
  const T = (u, p, op) => P.access(sys, u, p, op).ok;
  t.eq([T('ben', '/home/ana/notes.txt', 'read'), T('eve', '/home/ana/notes.txt', 'read'), T('ben', '/home/ana/notes.txt', 'write')], [true, false, false], 'group read only');
  t.eq([T('eve', '/home/ben/public.txt', 'read'), T('eve', '/home/ben', 'list')], [true, false], 'x without r: reach a known name, but no listing');
  t.eq([T('ana', '/lab/data.csv', 'read'), T('ana', '/lab/data.csv', 'write')], [true, false], 'the owner class applies even when the group bits give more');
  t.eq([T('ben', '/tmp/ana.log', 'delete'), T('ana', '/tmp/ana.log', 'delete'), T('ben', '/tmp/ana.log', 'write')], [false, true, true], 'sticky /tmp: others may write the file but not delete it');
  t.eq([T('eve', '/lab/new', 'create'), T('ana', '/lab/new', 'create')], [false, true], 'creating needs w and x on the directory');
  t.eq([T('root', '/etc/shadow', 'read'), T('root', '/home/ana/notes.txt', 'execute')], [true, false], 'root reads anything but executes only with some x bit');
  const deny = P.access(sys, 'eve', '/home/ana/notes.txt', 'read');
  t.eq(deny.denied, '/home/ana', 'the search stops at the directory without x');
  clean(deny.steps, 'access narration');
  const e = P.execAs(sys, 'ben', '/usr/bin/passwd');
  t.eq([e.ruid, e.euid], [1002, 0], 'setuid: real uid ben, effective uid root');
  t.ok(P.access(sys, 'ben', '/etc/shadow', 'write', { euid: e.euid }).ok && !P.access(sys, 'ben', '/etc/shadow', 'write').ok, 'the setuid program may do what ben may not');
  t.eq(P.execAs(sys, 'ana', '/usr/bin/ls').euid, 1001, 'a plain program keeps the caller\'s uid');
  const ops = ['read', 'write', 'execute', 'list', 'enter', 'delete', 'create'];
  let all = true, n = 0;
  for (const u of Object.keys(sys.users)) for (const p of Object.keys(sys.files).concat(['/tmp/x', '/home/ana/y', '/lab/z'])) for (const op of ops) {
    n++;
    if (P.access(sys, u, p, op).ok !== indepAccess(sys, u, p, op)) { all = false; t.ok(false, 'access ' + u + ' ' + op + ' ' + p); }
  }
  t.ok(all, 'all ' + n + ' preset checks match an independent implementation');
  const r = rng(17);
  for (let trial = 0; trial < 40; trial++) {
    const s2 = JSON.parse(JSON.stringify(sys));
    for (const f of Object.values(s2.files)) { f.mode = Math.floor(r() * 0o10000); if (r() < 0.3) f.uid = [0, 1001, 1002, 1003][Math.floor(r() * 4)]; if (r() < 0.3) f.gid = [0, 100, 200, 300][Math.floor(r() * 4)]; }
    let ok = true;
    for (const u of Object.keys(s2.users)) for (const p of Object.keys(s2.files)) for (const op of ops) if (P.access(s2, u, p, op).ok !== indepAccess(s2, u, p, op)) ok = false;
    t.ok(ok, 'random modes match the independent check, trial ' + trial);
  }
  let rt = true;
  for (let m = 0; m < 0o10000; m++) { const s = P.modeString(m, 'file'); if (P.parseMode(s) !== m || P.parseMode(P.oct(m).slice(1)) !== m) rt = false; }
  t.ok(rt, 'every one of the 4096 modes survives a round trip through its string');
  t.eq([P.modeString(0o1777, 'dir'), P.modeString(0o4755, 'file'), P.modeString(0o2640, 'file'), P.modeString(0o1754, 'dir')], ['drwxrwxrwt', '-rwsr-xr-x', '-rw-r-S---', 'drwxr-xr-T'], 'special bits in mode strings');
  const a = P.audit(sys);
  t.eq(a.findings.map((f) => f.kind).sort(), ['file-world-writable', 'setuid-root'], 'the audit flags the world-writable log and the setuid program');
  const lp = P.leastPrivilege({ grants: [{ subject: 'backup', object: '/home', rights: ['read', 'write'] }, { subject: 'web', object: '/srv', rights: ['read'] }], needs: [{ subject: 'backup', object: '/home', rights: ['read'] }, { subject: 'web', object: '/srv', rights: ['read'] }, { subject: 'web', object: '/log', rights: ['append'] }] });
  t.eq([lp.ok, lp.excess, lp.missing, lp.score], [false, [{ subject: 'backup', object: '/home', right: 'write' }], [{ subject: 'web', object: '/log', right: 'append' }], 2 / 3], 'least privilege: one excess, one missing');
  t.ok(P.leastPrivilege({ grants: [{ subject: 'a', object: 'x', rights: ['r'] }], needs: [{ subject: 'a', object: 'x', rights: ['r'] }] }).ok, 'an exact policy passes');
}
// ---- authentication ----
{
  t.eq([P.toyHash(''), P.toyHash('a'), P.toyHash('foobar')], ['811c9dc5', 'e40c292c', 'bf9cf968'], 'the toy hash is 32-bit FNV-1a');
  t.ok(/toy/i.test(P.TOY_NOTE), 'the toy hash is labelled as one');
  const users = [{ name: 'ana', password: 'tulip7' }, { name: 'ben', password: 'tulip7' }, { name: 'eve', password: 'river' }];
  const un = P.store(users, { salted: false });
  t.eq(un.shared, [['ana', 'ben']], 'without salt, equal passwords show as equal hashes');
  const sa = P.store(users, { seed: 3 });
  t.eq(sa.shared, [], 'with salts they do not');
  t.eq(P.store(users, { seed: 3 }).records, sa.records, 'same seed, same salts');
  t.ok(P.verify(sa.records[0], 'tulip7').ok && !P.verify(sa.records[0], 'tulip8').ok, 'verify recomputes with the stored salt');
  const h = P.hashPassword('pw', 'ab', 2);
  t.eq(h.hash, P.toyHash(P.toyHash('abpw') + 'abpw'), 'rounds chain the previous value, the salt and the password');
  clean(sa.steps.concat(P.verify(sa.records[1], 'x').steps), 'auth narration');
  const rl = P.rateLimit({ attempts: [0, 1, 2, 3, 4, 6, 10, 20, 40, 41].map((x, i) => ({ t: x, ok: i === 9 })), free: 3, delay: 1, lockAfter: 8 });
  t.eq(rl.results.map((x) => x.outcome), ['fail', 'fail', 'fail', 'fail', 'too-soon', 'fail', 'fail', 'fail', 'fail', 'locked'], 'hand-worked rate limiting');
  const ok = P.rateLimit({ attempts: [{ t: 0, ok: false }, { t: 1, ok: true }, { t: 2, ok: false }] });
  t.eq(ok.steps[2].fails, 1, 'a success resets the failure count');
  t.eq(P.guessBudget({ free: 3, delay: 1, lockAfter: 8, seconds: 86400 }).guesses, 8, 'the lock caps guesses at 8');
  t.eq(P.guessBudget({ free: 3, delay: 1, lockAfter: 100, seconds: 60 }).guesses, 8, 'doubling waits: 3 free, then 1+2+4+8+16 = 31 s for 5 more, 32 more would pass 60 s');
  const code = P.totp('K', 1000);
  t.ok(/^\d{6}$/.test(code) && code === P.totp('K', 1019) && code !== P.totp('K', 1020), 'a code lasts one 30-second step');
  const rec = sa.records[0];
  const m1 = P.mfa({ record: rec, password: 'tulip7', code, t: 1000, secret: 'K' });
  t.eq([m1.ok, m1.state, m1.usedStep], [true, 'in', 33], 'both factors pass');
  t.eq(P.mfa({ record: rec, password: 'tulip7', code: P.totp('K', 975), t: 1000, secret: 'K' }).ok, true, 'one step of clock drift is allowed');
  t.eq(P.mfa({ record: rec, password: 'tulip7', code: P.totp('K', 900), t: 1000, secret: 'K' }).ok, false, 'an old code is refused');
  t.eq(P.mfa({ record: rec, password: 'tulip7', code, t: 1000, secret: 'K', lastStep: 33 }).ok, false, 'a used code cannot be replayed');
  t.eq(P.mfa({ record: rec, password: 'nope', code, t: 1000, secret: 'K' }).state, 'denied', 'a wrong password stops before the code');
}
// ---- memory-safety defences and sandboxes ----
{
  const f = P.frame({ buffer: 16, seed: 2 });
  t.eq(f.slots.map((s) => [s.name, s.at - f.slots[0].at, s.size]), [['buffer', 0, 16], ['canary', 16, 8], ['saved frame pointer', 24, 8], ['return address', 32, 8]], 'frame layout, buffer lowest');
  t.eq(f.canary & 0xff, 0, 'the canary\'s low byte is zero');
  t.eq(P.frame({ seed: 2 }).canary, f.canary, 'same seed, same canary');
  const out = (len, o, canary) => P.copyInto(P.frame({ buffer: 16, canary }), len, o).outcome;
  t.eq([out(10), out(16), out(17), out(40), out(17, {}, false), out(40, {}, false), out(40, { bounded: true }), out(8, { bounded: true })], ['ok', 'ok', 'stopped', 'stopped', 'crash', 'crash', 'truncated', 'ok'], 'outcomes by input length');
  for (let len = 0; len <= 60; len++) {
    const g = P.copyInto(P.frame({ buffer: 16 }), len), want = [];
    if (len > 16) want.push('canary'); if (len > 24) want.push('saved frame pointer'); if (len > 32) want.push('return address');
    t.eq(g.damaged, want, 'slots damaged by ' + len + ' bytes');
    t.eq(P.copyInto(P.frame({ buffer: 16 }), len, { bounded: true }).damaged, [], 'a bounded copy of ' + len + ' damages nothing');
  }
  clean(P.copyInto(P.frame({ canary: false }), 40).steps, 'overflow narration');
  const nx = P.nx({});
  t.eq(nx.results.map((x) => x.ok), [true, true, false, false], 'NX: execute text, write stack, no execute on the stack, no write to text');
  t.eq(P.nx({ pages: [{ name: 'jit', perms: 'rwx' }] }).wx, ['jit'], 'W^X flags a writable, executable page');
  const as = P.aslr({ seed: 4, runs: 5 });
  t.eq(P.aslr({ seed: 4, runs: 5 }).runs, as.runs, 'same seed, same layouts');
  t.ok(as.runs.every((r) => Object.values(r.bases).every((b) => b % 4096 === 0)), 'bases are page-aligned');
  t.ok(new Set(as.runs.map((r) => r.bases.stack)).size > 1, 'the stack moves between runs');
  t.ok(as.runs.every((r) => r.bases.text >= 0x00400000 && r.bases.text < 0x00400000 + 256 * 4096), 'text stays within its 8-bit range');
  t.eq(as.odds.text, 1 / 256, 'odds of a fixed guess');
  const sb = P.sandbox({ requests: [{ call: 'open', path: '/sandbox/in.txt' }, { call: 'open', path: '/sandbox/../etc/passwd' }, { call: 'open', path: '/sandboxed/x' }, { call: 'open', path: '/sandbox/out/r.txt', write: true }, { call: 'open', path: '/sandbox/x', write: true }, { call: 'connect', host: 'h' }, { call: 'fork' }] });
  t.eq(sb.results.map((x) => x.ok), [true, false, false, true, false, false, false], 'sandbox decisions, including a path that climbs out with ..');
  t.eq(P.sandbox({ policy: { net: true }, requests: [{ call: 'connect', host: 'h' }] }).results[0].ok, true, 'a policy that allows the network');
  t.eq(P.normalise('/a/./b/../../c/'), '/c/', 'path normalising');
  t.eq(P.isolation({ uid: 1, files: ['/x'], net: 'n', pidns: 'p1' }, { uid: 2, files: ['/y'], net: 'm', pidns: 'p2' }).shared, [], 'isolated processes share nothing');
  t.eq(P.isolation({ uid: 1, files: ['/x'] }, { uid: 1, files: ['/x'] }).shared.map((s) => s.kind), ['uid', 'file', 'pids'], 'what two plain processes share');
}
// ---- narration slips: every say string from seeded runs of every function ----
const sayLint = (() => {
  const SING = ['item', 'message', 'byte', 'operation', 'slot', 'spin', 'tick', 'call', 'entry', 'request', 'exit', 'copy', 'trap', 'read', 'failure', 'guess', 'instruction', 'register', 'page', 'run', 'notification', 'interrupt', 'domain', 'right', 'finding', 'level', 'miss', 'fault', 'thing', 'unit', 'cycle', 'digit', 'character', 'reply', 'try', 'process', 'switch', 'triple', 'list', 'key', 'lock', 'capability', 'service', 'client', 'second', 'write', 'transition', 'event', 'round', 'attempt'];
  const plural = (w) => (/(ss|sh|ch|x)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  const PL = new Map(SING.map((w) => [plural(w), w]));
  const vowelOk = /^(use|usa|uni|uin|one|once|eu|ur)/i, consOk = /^(hour|honest|honou)/i;
  // words that follow a name such as process A, not the article a
  const FN = new Set(['is', 'as', 'at', 'in', 'on', 'of', 'or', 'and', 'are', 'also', 'again', 'until', 'up', 'if', 'its', 'it', 'opens', 'owns', 'ends', 'exits', 'enters', 'uses', 'accepts', 'asks', 'unlinks', 'ran', 'eats', 'issues', 'even', 'once', 'only']);
  const collect = (x, out, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return out;
    seen.add(x);
    if (typeof x.say === 'string') out.push(x.say);
    else if ('say' in x && x.say !== undefined) out.push('[say is ' + typeof x.say + ']');
    for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, out, seen);
    return out;
  };
  const slips = (s) => {
    const bad = [];
    if (/undefined|NaN|\bnull\b|\[object|Infinity/.test(s)) bad.push('undefined/NaN/null');
    if (!s.trim()) bad.push('empty');
    for (const m of s.matchAll(/(?<![\w.−-])1 ([a-z]+)\b/g)) if (PL.has(m[1])) bad.push('"1 ' + m[1] + '"');
    for (const m of s.matchAll(/(?<![\w.])(\d+|zero|two|three|four) ([a-z]+)(?=[.,;:)]|$| (?:of|and|in|for|so|to|but|with|from|after|before|each|per)\b)/g)) if (m[1] !== '1' && SING.includes(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/(?<![\w/'])(a|A) ([A-Za-z]\w*)/g)) if (!FN.has(m[2]) && /^[aeiou]/i.test(m[2]) && !vowelOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) ([A-Za-z]\w*)/g)) if (!/^[aeiou]/i.test(m[2]) && !consOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2]) && !/^[A-Z]$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(a|A) (8|11|18|80\d*|8\d)\b/g)) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) (\d+)/g)) if (!/^(8|11|18|8\d*)$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b([A-Za-z]+) \1\b/gi)) if (!/^[0-9a-f]{2}$/i.test(m[1])) bad.push('doubled "' + m[0] + '"');
    return bad;
  };
  return (t, results, what) => {
    const says = [];
    for (const r of results) collect(r, says, new Set());
    const found = [];
    for (const s of new Set(says)) for (const b of slips(s)) found.push(b + ' in: ' + s);
    t.ok(says.length > 0, what + ': some narration to scan');
    t.ok(!found.length, what + ': ' + found.length + ' slips, e.g.\n  ' + Array.from(new Set(found.map((f) => f.split(' in: ')[0]))).slice(0, 40).map((k) => found.find((f) => f.startsWith(k))).join('\n  '));
    return found;
  };
})();
{
  const r = rng(303), out = [], M = P.preset(), sys = P.unix();
  const RS = ['read', 'write', 'write*', 'read*', 'print', 'execute', 'owner', 'switch', 'control'];
  for (let seed = 1; seed <= 30; seed++) {
    const d = M.domains[Math.floor(r() * 3)], d2 = M.domains[Math.floor(r() * 3)], o = P.columns(M)[Math.floor(r() * 6)], q = RS[Math.floor(r() * RS.length)];
    out.push(P.check(M, d, o, q), P.checkGlobal(P.toGlobal(M), d, o, q), P.checkACL(P.toACL(M), d, o, q), P.checkCaps(P.toCaps(M), d, o, q), P.checkLockKey(P.toLockKey(M), d, o, q));
    for (const op of ['copy', 'limited-copy', 'transfer', 'add', 'remove', 'control-remove', 'switch', 'bogus']) out.push(P.apply(M, { op, by: d, to: d2, obj: o, right: q }));
    for (const f of ['acl', 'caps', 'global', 'lockkey']) out.push(P.revoke(M, f, { obj: o, right: 'read', from: r() < 0.5 ? 'all' : d }));
    const users = Object.keys(sys.users), files = Object.keys(sys.files).concat(['/tmp/new', '/']);
    for (const op of ['read', 'write', 'execute', 'list', 'enter', 'create', 'delete']) out.push(P.access(sys, users[Math.floor(r() * 4)], files[Math.floor(r() * files.length)], op));
    out.push(P.execAs(sys, users[Math.floor(r() * 4)], ['/usr/bin/passwd', '/usr/bin/ls', '/home/ana/run.sh'][Math.floor(r() * 3)]));
    out.push(P.leastPrivilege({ grants: [{ subject: 'a', object: 'x', rights: ['r', 'w'].slice(0, 1 + Math.floor(r() * 2)) }], needs: [{ subject: 'a', object: 'x', rights: ['r'] }, { subject: 'b', object: 'y', rights: ['w'] }].slice(0, 1 + Math.floor(r() * 2)) }));
    out.push(P.audit(sys), P.audit({ users: {}, groups: {}, files: { '/': { type: 'dir', uid: 0, gid: 0, mode: 0o755 } } }));
    const st = P.store([{ name: 'a', password: 'p' + seed }, { name: 'b', password: r() < 0.5 ? 'p' + seed : 'q' }], { salted: r() < 0.5, rounds: 1 + Math.floor(r() * 3), seed });
    out.push(st, P.verify(st.records[0], r() < 0.5 ? 'p' + seed : 'no'));
    out.push(P.rateLimit({ attempts: Array.from({ length: 12 }, (_, i) => ({ t: i * Math.floor(1 + r() * 4), ok: r() < 0.15 })), free: Math.floor(r() * 4), delay: 1 + Math.floor(r() * 2), lockAfter: 3 + Math.floor(r() * 6) }), P.guessBudget({ free: Math.floor(r() * 4), seconds: 1 + Math.floor(r() * 100) }));
    const tt = Math.floor(r() * 10000);
    out.push(P.mfa({ record: st.records[0], password: r() < 0.8 ? 'p' + seed : 'x', code: r() < 0.7 ? P.totp('K', tt + (r() < 0.3 ? 30 : 0)) : '000000', t: tt, secret: 'K', lastStep: r() < 0.2 ? Math.floor(tt / 30) : undefined }));
    out.push(P.copyInto(P.frame({ buffer: 4 + Math.floor(r() * 20), canary: r() < 0.6, seed }), Math.floor(r() * 50), { bounded: r() < 0.3 }));
    out.push(P.nx({ pages: [{ name: 'a', perms: ['r-x', 'rw-', 'rwx', '---'][Math.floor(r() * 4)] }], accesses: [{ page: 'a', op: ['read', 'write', 'exec'][Math.floor(r() * 3)] }, { page: 'zz', op: 'read' }] }), P.nx({}));
    out.push(P.aslr({ seed, runs: 1 + Math.floor(r() * 3) }));
    out.push(P.sandbox({ policy: { net: r() < 0.5 }, requests: [{ call: 'open', path: '/sandbox/a' }, { call: 'open', path: '/sandbox/../x', write: true }, { call: 'connect', host: 'h' }, { call: 'read' }, { call: 'fork' }].filter(() => r() < 0.7) }));
    out.push(P.isolation({ uid: seed % 2, files: ['/x'], net: 'n', pidns: 'p' }, { uid: 1, files: r() < 0.5 ? ['/x'] : [], net: r() < 0.5 ? 'n' : 'm', pidns: r() < 0.5 ? 'p' : 'q' }));
  }
  sayLint(t, out, 'prot narration slips');
}
t.done();
