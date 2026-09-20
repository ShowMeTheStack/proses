// Part 17, UNIX users, groups and permission bits (prot-b-unix.js): a request checked directory by directory with only
// the bits of the process's class counting, the sticky bit, and setuid as a switch of protection domain, with an
// audit of the risky modes.
(function (S) {
  'use strict';
  const H = S.P09, Pr = () => S.Prot;
  const SYS = () => Pr().unix();
  const FILES = Object.keys(SYS().files).filter((p) => p !== '/');
  const nameOf = (sys, uid) => Object.keys(sys.users).find((n) => sys.users[n].uid === uid) || 'uid ' + uid;
  const groupOf = (sys, gid) => Object.keys(sys.groups).find((n) => sys.groups[n] === gid) || 'gid ' + gid;
  const parent = (p) => (p === '/' ? null : p.slice(0, p.lastIndexOf('/')) || '/');
  const chain = (p) => { const out = [p]; for (let q = parent(p); q; q = parent(q)) out.unshift(q); return out; };
  const SHIFT = { owner: 0, group: 3, other: 6 };

  /** one row of the chain: path, mode as ten cells (the class's three lit), owner and group, and a verdict */
  const row = (sys, path, y, o) => {
    const f = sys.files[path], m = Pr().modeString(f.mode, f.type), items = [];
    items.push({ key: 'pa:' + path, kind: 'cell', x: 0, y, w: 200, h: 30, rx: 4, text: path, size: 14, align: 'left', cls: 'implrow mono' + (o.cur ? ' act' : '') });
    [...m].forEach((ch, k) => {
      const cls = o.cls && k >= 1 + SHIFT[o.cls] && k < 4 + SHIFT[o.cls] ? ' cls' + (o.ok === true ? ' good' : o.ok === false ? ' hot' : '') : '';
      items.push({ key: 'mb:' + path + k, kind: 'cell', x: 214 + k * 22, y, w: 20, h: 30, rx: 3, text: ch, size: 14, cls: 'mbit' + cls + (/[sStT]/.test(ch) ? ' special' : '') });
    });
    items.push(H.text('og:' + path, 448, y + 20, nameOf(sys, f.uid) + ' : ' + groupOf(sys, f.gid), 'mono', 14));
    if (o.verdict) items.push({ key: 'vd:' + path, kind: 'cell', x: 640, y: y + 2, w: 130, h: 26, rx: 10, text: o.verdict, size: 13, cls: 'tag ' + (o.ok ? 'good' : 'hot') });
    return items;
  };
  const whoLine = (sys, user, euid) => {
    const U = sys.users[user];
    return 'process: ' + user + ' (uid ' + U.uid + (euid !== undefined && euid !== U.uid ? ', effective ' + euid : '') + '), groups ' + U.groups.map((g) => groupOf(sys, g)).join(', ');
  };

  S.topic({
    id: 'prot-unix-perms', family: 'p17-unix', order: 10, title: 'Permission bits, directory by directory',
    blurb: 'Every file has an owner, a group and nine bits: read, write and execute for the owner, the group, and everyone else. Exactly one trio counts: the owner\'s if the process\'s user owns the file, else the group\'s if the user is in its group, else the others\'. Reaching a file needs x (search) on every directory on the way. Creating or deleting a name changes the directory, so it needs w on the directory, not on the file; in a sticky directory (t) only a file\'s owner may delete it.',
    inputs: [
      { id: 'user', kind: 'choice', label: 'User', def: 'ben', options: ['ana', 'ben', 'eve', 'root'].map((v) => ({ value: v, label: v })) },
      { id: 'path', kind: 'choice', label: 'File', def: '/home/ana/notes.txt', options: FILES.map((v) => ({ value: v, label: v })) },
      { id: 'op', kind: 'choice', label: 'Operation', def: 'read', options: ['read', 'write', 'execute', 'list', 'enter', 'delete'].map((v) => ({ value: v, label: v })) },
    ],
    presets: [
      { label: 'ana reads her notes (owner)', values: { user: 'ana', path: '/home/ana/notes.txt', op: 'read' } },
      { label: 'ben reads them (group)', values: { user: 'ben', path: '/home/ana/notes.txt', op: 'read' } },
      { label: 'ben may not write them', values: { user: 'ben', path: '/home/ana/notes.txt', op: 'write' } },
      { label: 'eve is stopped at the directory', values: { user: 'eve', path: '/home/ana/notes.txt', op: 'read' } },
      { label: 'ben deletes ana\'s log in /tmp (sticky)', values: { user: 'ben', path: '/tmp/ana.log', op: 'delete' } },
      { label: 'ana, the owner, reads a 460 file', values: { user: 'ana', path: '/lab/data.csv', op: 'read' } },
      { label: 'root reads the shadow file', values: { user: 'root', path: '/etc/shadow', op: 'read' } },
    ],
    counters: [{ id: 'checked', label: 'checks' }],
    run(inp) {
      const sys = SYS(), R = Pr().access(sys, inp.user, inp.path, inp.op), F = new S.Frames(['checked']);
      const ch = chain(inp.path), done = {};
      const pic = (cur, lit) => {
        const items = [H.text('who', 0, 10, whoLine(sys, inp.user), 'strong', 15), H.text('ask', 0, 38, 'asks to ' + inp.op + ' ' + inp.path, 'act', 15)];
        items.push(H.title('hp', 0, 78, 'path'), H.title('hm', 214, 78, 'type and mode'), H.title('ho', 448, 78, 'owner : group'));
        ch.forEach((p, k) => items.push(...row(sys, p, 92 + k * 40, Object.assign({ cur: p === cur }, done[p] || {}))));
        if (lit) items.push(H.text('vd', 0, 92 + ch.length * 40 + 30, lit, 'verdict2 ' + (R.ok ? 'good' : 'hot'), 16));
        return items;
      };
      F.add({ items: pic(null), say: `${whoLine(sys, inp.user)}, asks to ${inp.op} ${inp.path}. ${ch.length > 1 ? 'First every directory on the way must allow search (x).' : ''}`, meta: { phase: 'start', uid: sys.users[inp.user].uid, groups: sys.users[inp.user].groups } });
      R.steps.forEach((st, k) => {
        if (st.kind === 'result') return;
        const p = st.path, cls = st.say.includes('only the owner bits') ? 'owner' : st.say.includes('only the group bits') ? 'group' : st.say.includes('only the other bits') ? 'other' : null;
        const ok = st.kind !== 'deny';
        if (p && sys.files[p]) done[p] = { cls, ok, verdict: st.kind === 'search' ? 'x: search ok' : ok ? 'allowed' : 'denied' };
        F.count('checked');
        F.add({ items: pic(p), say: st.say, meta: { phase: st.kind, k, mode: p && sys.files[p] ? sys.files[p].mode : 0, modeOct: p && sys.files[p] ? Pr().oct(sys.files[p].mode) : '' }, title: (p || '') + ' · ' + st.kind });
      });
      const last = R.steps[R.steps.length - 1];
      F.add({ items: pic(null, last.kind === 'result' ? last.say : (R.ok ? 'allowed' : 'denied at ' + R.denied)), say: last.kind === 'result' ? last.say : `${inp.user} may not ${inp.op} ${inp.path}: the check stopped at ${R.denied}.`, meta: { phase: 'end', ok: R.ok }, title: R.ok ? 'allowed' : 'denied', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The rule', text: ['owner if the effective uid owns the file,', 'else group if the file\'s group is one of the user\'s,', 'else other; only that trio counts', 'every directory on the way needs x', 'create or delete: w (and x) on the directory', 'sticky t: delete only your own files', 'root passes read and write checks'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Before the check: will the request be allowed?', options: ['allowed', 'denied'], answer: (fr) => (fr[fr.length - 1].meta.ok ? 'allowed' : 'denied'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'A file is rw-r----- owned by ana, group users. ben is in users. ben may…', options: ['read it, not write it', 'read and write it', 'do nothing with it', 'only execute it'], answer: 0, why: 'ben is not the owner but is in the group, so the group trio r-- counts.' },
      { q: 'A file is ---rw-rw- and you own it. You may…', options: ['nothing: the owner trio counts, even if others have more', 'read and write it', 'read only', 'write only'], answer: 0, why: 'Exactly one class applies; the owner class does not fall through to the others.' },
      { q: 'To delete a file you need…', options: ['write and search permission on its directory', 'write permission on the file', 'execute permission on the file', 'to be root'], answer: 0, why: 'Deleting removes a name from the directory.' },
      { q: 'What does the sticky bit on /tmp prevent?', options: ['users deleting or renaming each other\'s files', 'users creating files', 'reading any file', 'executing programs'], answer: 0, why: 'Anyone may write in /tmp, but only a file\'s owner may remove it.' },
      { q: 'A directory has r but not x for you. You can…', options: ['list its names but not reach the files', 'reach the files but not list them', 'do both', 'do neither'], answer: 0, why: 'r reads the names; x lets the path go through.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'prot-setuid', family: 'p17-unix', order: 20, title: 'setuid: running with the owner\'s rights',
    blurb: 'Some tasks need more rights than the user has: changing your own password means writing a file only root may write. A setuid program solves this: when it runs, its effective user id becomes the file\'s owner, so it switches into the owner\'s protection domain for the length of the run. That is exactly why it must be careful. It runs with power its caller lacks, on input its caller chooses, so it must check every request, do only its one job, and give up the extra rights as soon as it can. An audit lists such programs so they stay few.',
    inputs: [
      { id: 'user', kind: 'choice', label: 'User', def: 'ana', options: ['ana', 'ben', 'eve'].map((v) => ({ value: v, label: v })) },
      { id: 'prog', kind: 'choice', label: 'Program', def: '/usr/bin/passwd', options: ['/usr/bin/passwd', '/usr/bin/ls', '/home/ana/run.sh'].map((v) => ({ value: v, label: v })) },
    ],
    presets: [
      { label: 'ana runs passwd (setuid root)', values: { user: 'ana', prog: '/usr/bin/passwd' } },
      { label: 'ana runs ls (no setuid)', values: { user: 'ana', prog: '/usr/bin/ls' } },
      { label: 'eve tries ana\'s script', values: { user: 'eve', prog: '/home/ana/run.sh' } },
    ],
    counters: [{ id: 'findings', label: 'audit findings' }],
    run(inp) {
      const sys = SYS(), U = sys.users[inp.user], F = new S.Frames(['findings']);
      const before = Pr().access(sys, inp.user, '/etc/shadow', 'write'), ex = Pr().execAs(sys, inp.user, inp.prog);
      const after = ex.ok ? Pr().access(sys, inp.user, '/etc/shadow', 'write', { euid: ex.euid, egid: ex.egid }) : null;
      const audit = Pr().audit(sys);
      const f = sys.files[inp.prog], owner = nameOf(sys, f.uid);
      // two domains side by side: the user's and the program owner's (root's), the process in one of them
      const DW = 360, DH = 200, ux = 0, rx = 420, dy = 40;
      const dom = (euid, o) => {
        o = o || {};
        const inRoot = euid === 0, items = [];
        items.push({ key: 'du', kind: 'region', x: ux, y: dy, w: DW, h: DH, rx: 10, cls: inRoot ? 'panel' : 'act' }, H.title('dut', ux + 14, dy + 24, inp.user + '\'s domain (uid ' + U.uid + ')'));
        items.push({ key: 'dr', kind: 'region', x: rx, y: dy, w: DW, h: DH, rx: 10, cls: inRoot ? 'act' : 'panel' }, H.title('drt', rx + 14, dy + 24, 'root\'s domain (uid 0)'));
        items.push({ key: 'fs', kind: 'cell', x: rx + 190, y: dy + 44, w: 150, h: 54, rx: 6, lines: ['/etc/shadow', 'rw------- root'], size: 13, cls: 'idbox' + (o.shadow ? ' ' + o.shadow : '') });
        items.push({ key: 'fp', kind: 'cell', x: (f.uid === 0 ? rx : ux) + 20, y: dy + 134, w: 160, h: 54, rx: 6, lines: [inp.prog.split('/').pop(), Pr().modeString(f.mode, f.type).slice(1) + ' ' + owner], size: 13, cls: 'idbox' + (f.mode & 0o4000 ? ' changed' : '') });
        items.push({ key: 'tok', kind: 'state', x: (inRoot ? rx : ux) + 90, y: dy + 84, r: 24, text: 'P', cls: 's-running' + (o.moved ? ' act' : '') });
        if (o.edge) items.push({ key: 'ea', kind: 'edge', from: 'tok', to: 'fs', cls: o.edge, label: o.edge === 'hot' ? 'refused' : 'allowed', lx: Math.round(((inRoot ? rx : ux) + 90 + rx + 190) / 2), ly: dy + 58 });
        items.push({ key: 'id:r', kind: 'cell', x: 0, y: dy + DH + 24, w: 170, h: 32, rx: 5, text: 'real uid ' + U.uid, size: 14, cls: 'idbox' });
        items.push({ key: 'id:e', kind: 'cell', x: 180, y: dy + DH + 24, w: 200, h: 32, rx: 5, text: 'effective uid ' + euid, size: 14, cls: 'idbox' + (euid !== U.uid ? ' changed' : '') });
        if (o.note) items.push(...H.para('nt', 0, dy + DH + 88, o.note, 780, o.noteCls || 'strong', 14));
        return [H.title('pt', 0, 10, inp.user + ' runs ' + inp.prog)].concat(items);
      };
      F.add({ items: dom(U.uid, { edge: before.ok ? 'good' : 'hot', note: H.plain(before.steps[before.steps.length - 1].say) + ' The password hashes are root\'s alone.' }), say: `${inp.user} runs as uid ${U.uid}. Writing /etc/shadow directly is refused: ${H.plain(before.steps[before.steps.length - 1].say)}`, meta: { phase: 'start', uid: U.uid } });
      const srch = ex.steps.filter((st) => st.kind === 'search');
      if (srch.length) F.add({ items: dom(U.uid, { note: 'To run the program, the kernel first checks search (x) on ' + H.list(srch.map((st) => st.path)) + ', then execute (x) on the file itself.' }), say: `To run ${inp.prog} the kernel checks search permission on ${H.list(srch.map((st) => st.path))}: each allows x to ${inp.user}.`, meta: { phase: 'exec', kind: 'search', euid: ex.euid, uid: U.uid }, title: 'search the path' });
      ex.steps.filter((st) => st.kind !== 'search').forEach((st, k) => {
        const sw = st.kind === 'setuid' || st.kind === 'setgid';
        F.add({ items: dom(sw ? ex.euid : U.uid, { moved: sw, note: st.say, noteCls: st.kind === 'deny' ? 'hot' : sw ? 'act' : 'strong' }), say: st.say, meta: { phase: 'exec', kind: st.kind, k, euid: ex.euid, uid: U.uid, mode: Pr().oct(f.mode) }, title: 'run ' + inp.prog.split('/').pop() + ' · ' + st.kind });
      });
      if (after) {
        const sw = ex.euid !== U.uid;
        F.add({ items: dom(ex.euid, { edge: after.ok ? 'good' : 'hot', note: sw ? 'The kernel now lets this process write /etc/shadow. Only the program\'s own checks stand between the caller and every password: change the caller\'s own entry, after asking for the old password, and nothing else.' : 'No setuid bit: the program runs with the user\'s own rights, and the write is still refused.', noteCls: sw ? 'act' : '' }), say: sw ? `Running as uid ${ex.euid}, the program could now write /etc/shadow, which ${inp.user} alone could not. The kernel no longer protects the file from this process; the program\'s own checks must: change only the caller\'s own entry, after asking for the old password.` : `With no setuid bit the program runs with ${inp.user}'s own rights (uid ${U.uid}), so writing /etc/shadow is still refused.`, meta: { phase: 'inside', euid: ex.euid, ok: after.ok, uid: U.uid }, title: 'inside the program' });
      }
      const fl = audit.findings;
      F.set('findings', fl.length);
      F.add({ items: dom(U.uid, { note: 'An audit of the whole file system: ' + fl.map((x) => x.say).join(' ') }), say: `An audit looks for risky modes: ${H.plural(fl.length, 'finding')}. Setuid-root programs belong on the list on purpose: each one is a door into root's domain, so keep them few, small and careful, and look for any that should not be there.`, meta: { phase: 'audit', n: fl.length }, title: 'audit', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Real and effective ids', text: ['real uid: who started the process', 'effective uid: whose rights it uses now', 'setuid bit: effective uid := file owner on exec', 'a switch into the owner\'s domain', 'care: check all input, do one job,', '  drop the extra rights as soon as possible'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'While this program runs, what will its effective uid be?', options: ['0 (root)', 'the user\'s own uid', 'the program refuses to run'], answer: (fr) => { const e = fr.find((f) => f.meta.phase === 'exec' && f.meta.kind === 'deny'); if (e) return 'the program refuses to run'; const x = fr.find((f) => f.meta.phase === 'inside'); return x && x.meta.euid === 0 ? '0 (root)' : 'the user\'s own uid'; }, explain: (fr) => (fr.find((f) => f.meta.phase === 'inside') || fr[1]).say }],
    quiz: [
      { q: 'The setuid bit makes a program run with…', options: ['the effective user id of the file\'s owner', 'the caller\'s rights only', 'no rights', 'the group of the caller'], answer: 0, why: 'Its effective uid becomes the owner\'s while the real uid stays the caller\'s.' },
      { q: 'Why must a setuid-root program check its input with special care?', options: ['it acts with root\'s rights on input an ordinary user chooses', 'it runs faster', 'it cannot read files', 'it has no real uid'], answer: 0, why: 'Any mistake in it lets an unprivileged user act as root.' },
      { q: 'A good setuid program, once it has done its privileged step…', options: ['gives up the extra rights', 'keeps them in case', 'runs as root for ever', 'removes its own setuid bit'], answer: 0, why: 'Least privilege, in time as well as in scope.' },
      { q: 'Why does an audit list setuid-root programs?', options: ['each one widens what an ordinary user can reach, so they must stay few and known', 'they are always wrong', 'they waste disk', 'to delete them all'], answer: 0, why: 'A setuid program that should not be there is a warning sign.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
