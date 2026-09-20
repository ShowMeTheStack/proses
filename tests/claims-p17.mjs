// Part 17 (protection and security): every topic with its default, every preset and random valid inputs; the same
// wording and quoted-number checks as part 9 (tests/claims-p09.mjs), then each topic's answers against a second
// computation written here: the access rules, the UNIX permission rule, the toy hash, the rate limit, the frame
// layout, page permissions, path resolution and the shared resources, each worked out again independently.
// Prints "claims-p17 N passed, M failed".
import { pathToFileURL } from 'node:url';
import { runClaims, pick, int } from './claims-p09.mjs';

const base = (r) => r.replace(/\*$/, '');
const holds = (cells, d, o, r) => (cells[d + '|' + o] || []).some((x) => base(x) === base(r) && (!r.endsWith('*') || x.endsWith('*')));
/** the matrix rules, written again */
function applyInd(cells, a) {
  const c = JSON.parse(JSON.stringify(cells)), r = a.right ? base(a.right) : null;
  const set = (d, o, rs) => { if (rs.length) c[d + '|' + o] = rs; else delete c[d + '|' + o]; };
  const get = (d, o) => (c[d + '|' + o] || []).slice();
  if (['copy', 'limited-copy', 'transfer'].includes(a.op)) {
    if (!holds(c, a.by, a.obj, r + '*')) return null;
    const keepStar = a.op === 'limited-copy' && holds(c, a.to, a.obj, r + '*');
    set(a.to, a.obj, get(a.to, a.obj).filter((x) => base(x) !== r).concat([a.op === 'limited-copy' && !keepStar ? r : r + '*']));
    if (a.op === 'transfer') set(a.by, a.obj, get(a.by, a.obj).filter((x) => base(x) !== r));
    return c;
  }
  if (a.op === 'add' || a.op === 'remove') { if (!holds(c, a.by, a.obj, 'owner')) return null; set(a.to, a.obj, a.op === 'add' ? get(a.to, a.obj).concat([a.right]) : get(a.to, a.obj).filter((x) => base(x) !== r)); return c; }
  if (a.op === 'control-remove') { if (!holds(c, a.by, a.to, 'control')) return null; set(a.to, a.obj, get(a.to, a.obj).filter((x) => base(x) !== r)); return c; }
  if (a.op === 'switch') return holds(c, a.by, a.to, 'switch') ? c : null;
  return null;
}
/** the UNIX rule, written again */
function unixInd(sys, user, path, op) {
  const U = sys.users[user], euid = U.uid, groups = new Set([U.gid].concat(U.groups));
  const par = (p) => (p === '/' ? null : p.slice(0, p.lastIndexOf('/')) || '/');
  const bitsFor = (f) => (euid === f.uid ? (f.mode >> 6) & 7 : groups.has(f.gid) ? (f.mode >> 3) & 7 : f.mode & 7);
  const can = (p, want) => { const f = sys.files[p]; if (euid === 0) return want !== 1 || f.type === 'dir' || (f.mode & 0o111) !== 0; return (bitsFor(f) & want) !== 0; };
  if (!sys.files[path]) return false;
  for (let q = par(path); q; q = par(q)) if (!can(q, 1)) return false;
  if (op === 'delete') { const d = par(path); if (!can(d, 2)) return false; const D = sys.files[d]; if (D.mode & 0o1000 && euid !== 0 && euid !== sys.files[path].uid && euid !== D.uid) return false; return true; }
  const f = sys.files[path];
  if ((op === 'list' || op === 'enter') && f.type !== 'dir') return false;
  return can(path, { read: 4, write: 2, execute: 1, list: 4, enter: 1 }[op]);
}
/** FNV-1a, 32 bits, written again */
const fnv = (t) => { let h = 0x811c9dc5; for (const ch of String(t)) { h ^= ch.charCodeAt(0) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const norm = (p) => { const out = []; for (const x of p.split('/')) { if (!x || x === '.') continue; if (x === '..') out.pop(); else out.push(x); } return '/' + out.join('/') + (p.endsWith('/') && out.length ? '/' : ''); };

export const P17 = {
  'prot-domains': {
    random: (rnd) => ({ story: pick(rnd, ['syscall', 'service', 'deny']) }),
    check({ r, ok }) {
      // a check is allowed exactly when the narration's entry lists the right
      for (const f of r.frames.filter((x) => x.meta.phase === 'check')) ok(/ may (?!not)[a-z]/.test(f.say) === f.meta.ok, 'the verdict matches the entry it quotes');
      ok(r.frames.filter((x) => x.meta.phase === 'switch').every((f) => f.meta.ok === /holds switch/.test(f.say)), 'a switch happens exactly when the entry holds switch');
    },
  },
  'prot-matrix-ops': {
    random: (rnd) => ({ seq: pick(rnd, ['copy', 'owner', 'control']) }),
    check({ S, input, frames, ok }) {
      const OPS = { copy: [{ op: 'copy', by: 'D1', to: 'D2', obj: 'F1', right: 'write' }, { op: 'copy', by: 'D2', to: 'D3', obj: 'F1', right: 'write' }, { op: 'limited-copy', by: 'D2', to: 'D3', obj: 'F2', right: 'read' }, { op: 'copy', by: 'D3', to: 'D1', obj: 'F2', right: 'read' }, { op: 'transfer', by: 'D2', to: 'D1', obj: 'F2', right: 'read' }], owner: [{ op: 'add', by: 'D1', to: 'D3', obj: 'F1', right: 'write' }, { op: 'remove', by: 'D1', to: 'D3', obj: 'F1', right: 'read' }, { op: 'add', by: 'D2', to: 'D2', obj: 'F1', right: 'read' }, { op: 'add', by: 'D1', to: 'D2', obj: 'F1', right: 'owner' }, { op: 'add', by: 'D2', to: 'D2', obj: 'F1', right: 'read' }], control: [{ op: 'control-remove', by: 'D2', to: 'D3', obj: 'printer', right: 'print' }, { op: 'control-remove', by: 'D1', to: 'D3', obj: 'F1', right: 'read' }, { op: 'switch', by: 'D1', to: 'D2' }, { op: 'switch', by: 'D3', to: 'D1' }] }[input.seq];
      let cells = S.Prot.preset().cells;
      frames('op').forEach((f, k) => { const c2 = applyInd(cells, OPS[k]); ok(f.meta.ok === !!c2, 'operation ' + (k + 1) + ' allowed exactly when the rules allow it'); if (c2) cells = c2; });
    },
  },
  'prot-matrix-impl': {
    random: (rnd) => ({ d: pick(rnd, ['D1', 'D2', 'D3']), o: pick(rnd, ['F1', 'F2', 'printer']), r: pick(rnd, ['read', 'write', 'execute', 'print']) }),
    nRandom: 12,
    check({ S, input, frames, ok, near }) {
      const cells = S.Prot.preset().cells, want = holds(cells, input.d, input.o, input.r);
      ok(frames('impl').every((f) => f.meta.ok === want), 'all four implementations give the matrix\'s own answer');
      const acl = Object.keys(cells).filter((k) => k.endsWith('|' + input.o)).map((k) => k.split('|')[0]), at = acl.indexOf(input.d);
      near(frames('impl').find((f) => f.meta.impl === 'acl').meta.scanned, at >= 0 ? at + 1 : acl.length, 'the access list is read up to the domain');
    },
  },
  'prot-revocation': {
    random: (rnd) => ({ o: pick(rnd, ['F1', 'F2', 'printer']), r: pick(rnd, ['read', 'write', 'print', 'execute']), from: pick(rnd, ['all', 'D1', 'D2', 'D3']) }),
    check({ S, input, frames, near }) {
      const cells = S.Prot.preset().cells, keys = Object.keys(cells);
      const cost = Object.fromEntries(frames('form').map((f) => [f.meta.form, f.meta.cost]));
      near(cost.acl, keys.filter((k) => k.endsWith('|' + input.o)).length, 'access list: its length');
      near(cost.global, keys.length, 'global table: every triple');
      near(cost.caps, keys.length, 'capabilities: every capability of every domain');
      near(cost.lockkey, keys.filter((k) => k.endsWith('|' + input.o) && cells[k].some((x) => base(x) === input.r)).length, 'lock and key: the locks for that right');
    },
  },
  'prot-least-privilege': {
    random: (rnd) => ({ sc: pick(rnd, ['shop', 'backup', 'tight']) }),
    check({ S, input, last, near }) {
      const sc = S.P09.LP[input.sc], has = (L, s, o, r) => L.some((x) => x.subject === s && x.object === o && x.rights.includes(r));
      let ex = 0, mi = 0;
      for (const g of sc.grants) for (const r of g.rights) if (!has(sc.needs, g.subject, g.object, r)) ex++;
      for (const n of sc.needs) for (const r of n.rights) if (!has(sc.grants, n.subject, n.object, r)) mi++;
      near([last().meta.excess, last().meta.missing], [ex, mi], 'excess and missing rights, counted again');
    },
  },
  'prot-mechanism-policy': {
    random: (rnd) => ({ a: pick(rnd, ['open', 'exam', 'closed']), b: pick(rnd, ['open', 'exam', 'closed']) }),
    check({ frames, ok }) {
      ok(frames('req').every((f) => f.meta.diff === (f.meta.a !== f.meta.b)), 'a request differs exactly when the two answers do');
      if (frames('req').length) ok(true, 'requests checked');
    },
  },
  'prot-unix-perms': {
    random: (rnd) => ({ user: pick(rnd, ['ana', 'ben', 'eve', 'root']), path: pick(rnd, ['/home/ana/notes.txt', '/home/ana/run.sh', '/home/ben/public.txt', '/tmp/ana.log', '/lab/data.csv', '/etc/shadow', '/usr/bin/passwd', '/home/ben']), op: pick(rnd, ['read', 'write', 'execute', 'list', 'enter', 'delete']) }),
    nRandom: 30,
    check({ S, input, last, ok }) {
      ok(last().meta.ok === unixInd(S.Prot.unix(), input.user, input.path, input.op), 'the verdict agrees with the rule written again');
    },
  },
  'prot-setuid': {
    random: (rnd) => ({ user: pick(rnd, ['ana', 'ben', 'eve']), prog: pick(rnd, ['/usr/bin/passwd', '/usr/bin/ls', '/home/ana/run.sh']) }),
    check({ S, input, frames, ok }) {
      const sys = S.Prot.unix(), f = sys.files[input.prog], ins = frames('inside')[0];
      const canRun = unixInd(sys, input.user, input.prog, 'execute');
      ok(!!ins === canRun, 'the program runs exactly when execute is allowed');
      if (ins) ok(ins.meta.euid === (f.mode & 0o4000 ? f.uid : sys.users[input.user].uid), 'the effective uid is the owner\'s exactly when setuid is set');
    },
  },
  'prot-passwords': {
    random: (rnd) => ({ salted: pick(rnd, ['yes', 'no']), rounds: int(rnd, 1, 5), who: pick(rnd, ['ana', 'ben', 'eve', 'raj']), attempt: pick(rnd, ['tulip42', 'harbour', 'Gr8-hill', 'tulip24', 'x']), seed: int(rnd, 1, 999) }),
    nRandom: 10,
    check({ S, input, frame, frames, ok }) {
      const PW = { ana: 'tulip42', ben: 'harbour', eve: 'tulip42', raj: 'Gr8-hill' };
      for (const f of frames('store')) {
        const user = ['ana', 'ben', 'eve', 'raj'][f.meta.k], salt = f.say.match(/salt ([0-9a-f]{8})/);
        let h = ''; for (let i = 0; i < input.rounds; i++) h = fnv(h + (salt ? salt[1] : '') + PW[user]);
        ok(f.meta.hash === h, user + ': the stored hash is the toy hash worked again');
      }
      ok(frame('compare').meta.ok === (input.attempt === PW[input.who]), 'a login succeeds exactly when the password typed is the account\'s');
      if (input.salted === 'no') ok(frame('file').meta.shared === 1, 'without salt, ana and eve show the same hash');
      else ok(frame('file').meta.shared === 0, 'with salt, no two hashes match');
    },
  },
  'prot-login': {
    random: (rnd) => { const free = int(rnd, 0, 5); return { pattern: pick(rnd, ['forgetful', 'fast', 'patient']), free, lock: int(rnd, free + 1, 12), mfa: pick(rnd, ['right', 'drift', 'wrongcode', 'replay', 'wrongpw']) }; },
    nRandom: 10,
    check({ input, frames, frame, r, ok, near }) {
      const PAT = { forgetful: [[0, false], [5, false], [9, false], [14, true]], fast: [[0, false], [1, false], [2, false], [3, false], [4, false], [6, false], [9, false], [15, false], [25, false], [40, false]], patient: [[0, false], [2, false], [4, false], [6, false], [10, false], [20, false], [40, false], [80, false], [200, false]] }[input.pattern];
      let fails = 0, last = -Infinity, locked = false; const want = [];
      for (const [t, good] of PAT) {
        const wait = fails >= input.free ? 2 ** (fails - input.free) : 0;
        if (locked) want.push('locked'); else if (t - last < wait) want.push('too-soon'); else if (good) { want.push('ok'); fails = 0; last = t; } else { want.push('fail'); fails++; last = t; if (fails >= input.lock) locked = true; }
      }
      near(frames('attempt').map((f) => f.meta.outcome), want, 'each attempt\'s outcome, worked again');
      let t = 0, n = 0; while (n < input.lock) { const w = n >= input.free ? 2 ** (n - input.free) : 0; if (t + w > 86400) break; t += w; n++; }
      near(frame('budget').meta.guesses, n, 'the guesses that fit in a day');
      const inOk = r.frames[r.frames.length - 1].say.includes('the user is in');
      ok(inOk === (input.mfa === 'right' || input.mfa === 'drift'), 'the login succeeds exactly with the right password and a fresh, valid code');
    },
  },
  'prot-canary': {
    random: (rnd) => ({ buffer: int(rnd, 8, 32), len: int(rnd, 0, 48), canary: pick(rnd, ['yes', 'no']), copy: pick(rnd, ['unchecked', 'bounded']), seed: int(rnd, 1, 999) }),
    nRandom: 20,
    check({ input, r, last, ok }) {
      const want = input.copy === 'bounded' ? (input.len > input.buffer ? 'truncated' : 'ok') : input.len <= input.buffer ? 'ok' : input.canary === 'yes' ? 'stopped' : 'crash';
      ok(last().meta.outcome === want, 'the outcome ' + last().meta.outcome + ' is the one the layout gives (' + want + ')');
      ok(last().meta.canary === null || (last().meta.canary & 0xff) === 0, 'the canary has a zero low byte');
      // what the narration says was overwritten must be exactly the overwritten slots
      const SLOTS = ['canary', 'saved frame pointer', 'return address'], dmg = last().meta.damaged;
      for (const f of r.frames) {
        const said = f.say.match(/(?:overwritten|damaged|over) ([a-z ,]+?)(?: (?:is|are) never|\.|:|$)/);
        for (const sl of SLOTS) {
          const named = new RegExp('(overwritten|damaged|over|run upward over)[^.]*' + sl).test(f.say) && !new RegExp(sl + ' (survived|was never touched)').test(f.say);
          if (named) ok(dmg.includes(sl), 'frame ' + f.meta.phase + ': it says the ' + sl + ' was overwritten, and it was');
        }
        if (f.meta.phase === 'overflow') for (const sl of dmg) ok(f.say.includes(sl), 'the overflow names every overwritten slot (' + sl + ')');
        void said;
      }
    },
  },
  'prot-nx-aslr': {
    random: (rnd) => ({ layout: pick(rnd, ['wx', 'rwx', 'jit']), runs: int(rnd, 1, 5), seed: int(rnd, 1, 999) }),
    check({ input, frames, ok }) {
      const L = { wx: { text: 'r-x', data: 'rw-', heap: 'rw-', stack: 'rw-' }, rwx: { text: 'r-x', data: 'rw-', heap: 'rw-', stack: 'rwx' }, jit: { text: 'r-x', buffer: 'rw-', generated: 'r-x', stack: 'rw-' } }[input.layout];
      const ACC = { wx: [['text', 'exec'], ['stack', 'write'], ['stack', 'exec'], ['text', 'write'], ['heap', 'exec']], rwx: [['text', 'exec'], ['stack', 'write'], ['stack', 'exec'], ['text', 'write']], jit: [['buffer', 'write'], ['buffer', 'exec'], ['generated', 'exec'], ['generated', 'write']] }[input.layout];
      frames('nx').forEach((f, k) => { const [p, op] = ACC[k]; ok(f.meta.ok === (L[p][{ read: 0, write: 1, exec: 2 }[op]] !== '-'), op + ' ' + p + ': the page bits decide'); });
      const REG = { text: [0x00400000, 8], heap: [0x01000000, 13], libraries: [0x70000000, 12], stack: [0x7f700000, 11] };
      for (const f of frames('aslr')) for (const [nm, a] of Object.entries(f.meta.bases)) { const d = (a - REG[nm][0]) / 4096; ok(Number.isInteger(d) && d >= 0 && d < 2 ** REG[nm][1], nm + ' lands on a page inside its range'); }
      ok(frames('aslr').length === input.runs, 'one frame per run');
    },
  },
  'prot-sandbox': {
    random: (rnd) => ({ pol: pick(rnd, ['viewer', 'fetcher', 'strict']) }),
    check({ input, frames, ok }) {
      const P = { viewer: { calls: ['read', 'write', 'open', 'close', 'exit'], paths: ['/sandbox/'], write: ['/sandbox/out/'], net: false, req: [['open', '/sandbox/in/photo.png'], ['open', '/sandbox/out/thumb.png', 1], ['open', '/etc/passwd'], ['open', '/sandbox/in/../../etc/passwd'], ['open', '/sandbox/in/photo.png', 1], ['connect'], ['fork'], ['exit']] }, fetcher: { calls: ['read', 'write', 'open', 'close', 'exit', 'connect'], paths: ['/sandbox/'], write: ['/sandbox/'], net: true, req: [['connect'], ['open', '/sandbox/data.bin', 1], ['open', '/home/ana/notes.txt'], ['open', '/sandbox/./data.bin'], ['exec'], ['exit']] }, strict: { calls: ['read', 'write', 'exit'], paths: [], write: [], net: false, req: [['read'], ['write'], ['open', '/sandbox/in/x'], ['connect'], ['exit']] } }[input.pol];
      const under = (p, L) => L.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : x + '/'));
      frames('req').forEach((f, k) => {
        const [call, path, w] = P.req[k];
        const want = call === 'connect' ? P.net : !P.calls.includes(call) ? false : path === undefined ? true : under(norm(path), P.paths) && (!w || under(norm(path), P.write));
        ok(f.meta.ok === want, call + (path ? ' ' + path : '') + ': the policy decides');
      });
    },
  },
  'prot-isolation': {
    random: (rnd) => ({ pair: pick(rnd, ['users', 'same', 'boxed']) }),
    check({ input, last, near }) {
      const want = { users: 3, same: 4, boxed: 0 }[input.pair];
      near(last().meta.n, want, 'the shared things, counted by hand');
    },
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p17', /^p17-/, P17);
