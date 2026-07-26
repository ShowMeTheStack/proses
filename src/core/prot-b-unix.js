// Protection, part 2: UNIX users, groups and permission bits; setuid as a domain switch; least privilege as a
// checker.
//   S.Prot.unix(o?) -> sys: {users: {name: {uid, gid, groups: [gid]}}, groups: {name: gid}, files: {path: {type:
//       'file' | 'dir', uid, gid, mode}}} (a preset, or o's own; mode is a number such as 0o4755)
//   S.Prot.modeString(mode, type) -> 'drwxrwxrwt', 'rwsr-xr-x'          S.Prot.parseMode('rw-r-----' | '640') -> 0o640
//   S.Prot.access(sys, user, path, op, {euid, egid}) -> {ok, steps, cls, denied: path | null}
//       op: 'read' | 'write' | 'execute' (a file), 'list' (a directory's names), 'enter' (cd into it),
//       'create' (a new name in path's parent), 'delete' (remove path from its parent).
//       Every directory on the way needs x (search) for the process's class; the class is owner when the
//       effective uid owns the file, else group when the file's group is one of the user's, else other, and only
//       that class's bits count. root (uid 0) passes every read and write check, and execute when any x bit is
//       set. Deleting in a sticky directory (t) also needs the process to own the file or the directory.
//   S.Prot.execAs(sys, user, path) -> {ok, ruid, euid, egid, steps}: running a setuid (setgid) file switches the
//       effective uid (gid) to the file's owner (group): a switch of protection domain.
//   S.Prot.leastPrivilege({grants: [{subject, object, rights}], needs: [{subject, object, rights}]})
//       -> {ok, excess: [{subject, object, right}], missing: [..], steps, score} (score: the share of granted
//       rights that are needed)
//   S.Prot.audit(sys) -> {findings: [{path, kind, say}], steps}: world-writable files, world-writable directories
//       without the sticky bit, setuid programs owned by root, files any user can change in a directory they can
//       all write.
(function (S) {
  'use strict';
  const P = (S.Prot = S.Prot || {});
  const oct = (m) => '0' + (m & 0o7777).toString(8).padStart(3, '0');
  P.oct = oct;

  P.unix = (o) => o || {
    users: { root: { uid: 0, gid: 0, groups: [0] }, ana: { uid: 1001, gid: 100, groups: [100, 300] }, ben: { uid: 1002, gid: 100, groups: [100] }, eve: { uid: 1003, gid: 200, groups: [200] } },
    groups: { root: 0, users: 100, guests: 200, lab: 300 },
    files: {
      '/': { type: 'dir', uid: 0, gid: 0, mode: 0o755 },
      '/home': { type: 'dir', uid: 0, gid: 0, mode: 0o755 },
      '/home/ana': { type: 'dir', uid: 1001, gid: 100, mode: 0o750 },
      '/home/ana/notes.txt': { type: 'file', uid: 1001, gid: 100, mode: 0o640 },
      '/home/ana/run.sh': { type: 'file', uid: 1001, gid: 100, mode: 0o700 },
      '/home/ben': { type: 'dir', uid: 1002, gid: 100, mode: 0o711 },
      '/home/ben/public.txt': { type: 'file', uid: 1002, gid: 100, mode: 0o644 },
      '/tmp': { type: 'dir', uid: 0, gid: 0, mode: 0o1777 },
      '/tmp/ana.log': { type: 'file', uid: 1001, gid: 100, mode: 0o666 },
      '/lab': { type: 'dir', uid: 0, gid: 300, mode: 0o2770 },
      '/lab/data.csv': { type: 'file', uid: 1001, gid: 300, mode: 0o460 },
      '/usr': { type: 'dir', uid: 0, gid: 0, mode: 0o755 },
      '/usr/bin': { type: 'dir', uid: 0, gid: 0, mode: 0o755 },
      '/usr/bin/passwd': { type: 'file', uid: 0, gid: 0, mode: 0o4755 },
      '/usr/bin/ls': { type: 'file', uid: 0, gid: 0, mode: 0o755 },
      '/etc': { type: 'dir', uid: 0, gid: 0, mode: 0o755 },
      '/etc/shadow': { type: 'file', uid: 0, gid: 0, mode: 0o600 },
    },
  };

  P.modeString = function (mode, type) {
    const r = (b, ch) => (mode & b ? ch : '-');
    const x = (b, special, on, off) => (mode & special ? (mode & b ? on : off) : mode & b ? 'x' : '-');
    return (type === 'dir' ? 'd' : type === 'file' ? '-' : '') +
      r(0o400, 'r') + r(0o200, 'w') + x(0o100, 0o4000, 's', 'S') +
      r(0o40, 'r') + r(0o20, 'w') + x(0o10, 0o2000, 's', 'S') +
      r(0o4, 'r') + r(0o2, 'w') + x(0o1, 0o1000, 't', 'T');
  };
  P.parseMode = function (s) {
    s = String(s).trim();
    if (/^[0-7]{3,4}$/.test(s)) return parseInt(s, 8);
    if (s.length === 10) s = s.slice(1);
    if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(s)) throw new Error('not a mode: ' + s);
    let m = 0;
    const bits = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1];
    for (let i = 0; i < 9; i++) { const c = s[i]; if (c !== '-' && c !== 'S' && c !== 'T') m |= bits[i]; }
    if (/[sS]/.test(s[2])) m |= 0o4000;
    if (/[sS]/.test(s[5])) m |= 0o2000;
    if (/[tT]/.test(s[8])) m |= 0o1000;
    return m;
  };

  const parent = (p) => (p === '/' ? null : p.slice(0, p.lastIndexOf('/')) || '/');
  const chain = (p) => { const out = []; for (let q = parent(p); q; q = parent(q)) out.unshift(q); return out; };
  const who = (sys, u, o) => {
    const U = sys.users[u];
    if (!U) throw new Error('no user ' + u);
    const euid = o && o.euid !== undefined ? o.euid : U.uid, egid = o && o.egid !== undefined ? o.egid : U.gid;
    return { name: u, uid: U.uid, euid, egid, groups: Array.from(new Set([egid].concat(U.groups || []))) };
  };
  const classOf = (W, f) => (W.euid === f.uid ? 'owner' : W.groups.includes(f.gid) ? 'group' : 'other');
  const SHIFT = { owner: 6, group: 3, other: 0 };
  const BIT = { read: 4, write: 2, execute: 1 };
  const NAME = { read: 'r', write: 'w', execute: 'x' };

  /** one permission check on one file: {ok, cls, say} */
  P.permit = function (sys, W, path, want) {
    const f = sys.files[path];
    const cls = classOf(W, f), bits = (f.mode >> SHIFT[cls]) & 7, m = P.modeString(f.mode, f.type);
    if (W.euid === 0) {
      const ok = want !== 'execute' || f.type === 'dir' || (f.mode & 0o111) !== 0;
      return { ok, cls: 'root', say: path + ' (' + m + '): the process runs as root, which ' + (ok ? 'passes the ' + want + ' check whatever the bits say' : 'still needs some x bit to execute a file, and there is none') + '.' };
    }
    const ok = (bits & BIT[want]) !== 0;
    const owner = Object.keys(sys.users).find((n) => sys.users[n].uid === f.uid) || 'uid ' + f.uid;
    const why = cls === 'owner' ? W.name + ' owns it' : cls === 'group' ? W.name + ' is in its group ' + (Object.keys(sys.groups).find((g) => sys.groups[g] === f.gid) || f.gid) : W.name + ' is neither the owner (' + owner + ') nor in its group';
    const trio = m.slice(f.type ? 1 : 0).slice(6 - SHIFT[cls], 9 - SHIFT[cls]);
    return { ok, cls, say: path + ' (' + m + '): ' + why + ', so only the ' + cls + ' bits ' + trio + ' count, and they ' + (ok ? 'include' : 'lack') + ' ' + NAME[want] + (want === 'execute' && f.type === 'dir' ? ' (search)' : '') + '.' };
  };

  P.access = function (sys, user, path, op, o) {
    const W = who(sys, user, o), steps = [];
    const fail = (at, say) => { steps.push({ kind: 'deny', path: at, say }); return { ok: false, steps, cls: null, denied: at }; };
    const target = op === 'create' ? parent(path) : path;
    if ((op === 'create' || op === 'delete') && path === '/') return fail('/', 'The root directory has no parent to ' + op + ' it in.');
    const dirs = chain(path);
    if (op !== 'create' && !sys.files[path]) return fail(path, path + ' does not exist.');
    if (op === 'create' && sys.files[path]) return fail(path, path + ' already exists.');
    if (op === 'create' && !sys.files[target]) return fail(target, target + ' does not exist.');
    // search permission on every directory on the way
    for (const d of dirs) {
      const r = P.permit(sys, W, d, 'execute');
      steps.push({ kind: r.ok ? 'search' : 'deny', path: d, say: 'Search ' + r.say });
      if (!r.ok) return { ok: false, steps, cls: r.cls, denied: d };
    }
    if (op === 'create' || op === 'delete') {
      const dir = parent(path), D = sys.files[dir], r = P.permit(sys, W, dir, 'write');
      steps.push({ kind: r.ok ? 'allow' : 'deny', path: dir, say: (op === 'create' ? 'Creating' : 'Deleting') + ' a name changes the directory, so it needs w: ' + r.say });
      if (!r.ok) return { ok: false, steps, cls: r.cls, denied: dir };
      if (op === 'delete' && D.mode & 0o1000 && W.euid !== 0) {
        const f = sys.files[path], ok = W.euid === f.uid || W.euid === D.uid;
        steps.push({ kind: ok ? 'allow' : 'deny', path, say: dir + ' has the sticky bit, so only the file\'s owner, the directory\'s owner or root may delete in it: ' + W.name + (ok ? (W.euid === f.uid ? ' owns the file' : ' owns the directory') + ', allowed.' : ' is neither, denied.') });
        if (!ok) return { ok: false, steps, cls: r.cls, denied: path };
      }
      steps.push({ kind: 'result', say: W.name + ' may ' + op + ' ' + path + '.' });
      return { ok: true, steps, cls: r.cls, denied: null };
    }
    const f = sys.files[path];
    let want = op;
    if (op === 'list') { if (f.type !== 'dir') return fail(path, path + ' is not a directory.'); want = 'read'; }
    if (op === 'enter') { if (f.type !== 'dir') return fail(path, path + ' is not a directory.'); want = 'execute'; }
    const r = P.permit(sys, W, path, want);
    const lead = op === 'list' ? 'Listing a directory reads its names, so it needs r: ' : op === 'enter' ? 'Entering a directory needs x: ' : '';
    steps.push({ kind: r.ok ? 'allow' : 'deny', path, say: lead + r.say });
    steps.push({ kind: 'result', say: W.name + (r.ok ? ' may ' : ' may not ') + op + ' ' + path + '.' });
    return { ok: r.ok, steps, cls: r.cls, denied: r.ok ? null : path };
  };

  P.execAs = function (sys, user, path) {
    const W = who(sys, user), steps = [];
    const a = P.access(sys, user, path, 'execute');
    steps.push(...a.steps);
    if (!a.ok) return { ok: false, ruid: W.uid, euid: W.euid, egid: W.egid, steps };
    const f = sys.files[path];
    let euid = W.euid, egid = W.egid;
    if (f.mode & 0o4000) { euid = f.uid; steps.push({ kind: 'setuid', say: path + ' has the setuid bit, so the new program runs with effective uid ' + f.uid + ' (its owner' + (f.uid === 0 ? ', root' : '') + ') while the real uid stays ' + W.uid + ': a switch into the owner\'s protection domain, which is why such programs must check everything they are given.' }); }
    if (f.mode & 0o2000) { egid = f.gid; steps.push({ kind: 'setgid', say: path + ' has the setgid bit, so the effective gid becomes ' + f.gid + '.' }); }
    if (!(f.mode & 0o6000)) steps.push({ kind: 'plain', say: path + ' has no setuid or setgid bit, so it runs with ' + W.name + '\'s own rights (uid ' + W.uid + ').' });
    return { ok: true, ruid: W.uid, euid, egid, steps };
  };

  P.leastPrivilege = function (o) {
    const grants = o.grants || [], needs = o.needs || [], steps = [], excess = [], missing = [];
    const has = (L, s, ob, r) => L.some((g) => g.subject === s && g.object === ob && g.rights.includes(r));
    let granted = 0, used = 0;
    for (const g of grants) for (const r of g.rights) {
      granted++;
      if (has(needs, g.subject, g.object, r)) { used++; continue; }
      excess.push({ subject: g.subject, object: g.object, right: r });
      steps.push({ kind: 'excess', say: g.subject + ' holds ' + r + ' on ' + g.object + ' but no task of its needs it: remove it.' });
    }
    for (const n of needs) for (const r of n.rights) if (!has(grants, n.subject, n.object, r)) {
      missing.push({ subject: n.subject, object: n.object, right: r });
      steps.push({ kind: 'missing', say: n.subject + ' needs ' + r + ' on ' + n.object + ' for its work but does not hold it: it will fail.' });
    }
    const score = granted ? used / granted : 1, ok = !excess.length && !missing.length;
    steps.push({ kind: 'result', say: ok ? 'Every right granted is needed and every need is granted: least privilege holds.' : used + ' of ' + granted + ' granted rights are needed; ' + excess.length + ' excess and ' + missing.length + ' missing.' });
    return { ok, excess, missing, steps, score };
  };

  P.audit = function (sys) {
    const findings = [];
    for (const [path, f] of Object.entries(sys.files)) {
      const m = P.modeString(f.mode, f.type);
      if (f.type === 'dir' && f.mode & 0o2 && !(f.mode & 0o1000)) findings.push({ path, kind: 'dir-world-writable', say: path + ' (' + m + ') lets anyone write and has no sticky bit, so anyone may delete or rename anyone\'s files in it.' });
      if (f.type === 'file' && f.mode & 0o2) findings.push({ path, kind: 'file-world-writable', say: path + ' (' + m + ') may be changed by every user.' });
      if (f.type === 'file' && f.mode & 0o4000 && f.uid === 0) findings.push({ path, kind: 'setuid-root', say: path + ' (' + m + ') runs as root for whoever starts it: keep such programs few, small and careful.' });
      if (f.type === 'file' && /shadow|secret|key/.test(path) && f.mode & 0o44) findings.push({ path, kind: 'secret-readable', say: path + ' (' + m + ') holds secrets but others may read it.' });
    }
    return { findings, steps: findings.map((x) => ({ kind: x.kind, say: x.say, path: x.path })).concat([{ kind: 'result', say: findings.length ? findings.length + ' finding' + (findings.length > 1 ? 's' : '') + ' to review.' : 'Nothing to report.' }]) };
  };
})(globalThis.Proses = globalThis.Proses || {});
