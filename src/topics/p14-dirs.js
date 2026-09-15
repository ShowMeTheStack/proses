// Part 14, directories and path names: the four ways to organise names (one directory for everyone, one a user,
// a tree, an acyclic graph with shared names) built on the file-system engine with the clashes and refusals it
// reports, and a path name looked up inode by inode, absolute or relative, through "." and "..".
(function (S) {
  'use strict';
  const T = () => S.T12, U = () => S.T14;
  const R = Math.round;

  const KINDS = [{ value: 'single', label: 'single-level' }, { value: 'two', label: 'two-level' }, { value: 'tree', label: 'tree' }, { value: 'acyclic', label: 'acyclic graph' }];
  const ABOUT = {
    single: 'One directory holds every name: simple, but two users cannot both have a file called the same thing, and nothing can be grouped.',
    two: 'Each user has a directory under the root: the same name can be used by both, but a user cannot group files further, and sharing means naming another user’s directory.',
    tree: 'Directories inside directories, to any depth: files are grouped by subject, and every file has exactly one path from the root.',
    acyclic: 'A tree plus extra names: one file can sit in two directories at once (a hard link). Directories may not get a second name, so no cycle can form.',
  };
  /** the commands that build each structure for these users and file names */
  function build(kind, users, files) {
    const ops = [];
    if (kind === 'single') { for (const u of users) for (const f of files) ops.push(['create', '/' + f]); return ops; }
    for (const u of users) {
      ops.push(['mkdir', '/' + u]);
      if (kind !== 'two') ops.push(['mkdir', '/' + u + '/work']);
      files.forEach((f, i) => ops.push(['create', '/' + u + (kind !== 'two' && i > 0 ? '/work/' : '/') + f]));
    }
    if (kind === 'acyclic' && users.length > 1) {
      ops.push(['link', '/' + users[0] + '/' + files[0], '/' + users[1] + '/work/shared']);
      ops.push(['link', '/' + users[0] + '/work', '/' + users[1] + '/team']);
    }
    return ops;
  }
  const nameOk = (v) => (v.some((x) => !/^[a-z][a-z0-9]{0,9}$/.test(x)) ? 'short lower-case names, a letter first, at most 10 characters' : new Set(v).size !== v.length ? 'no name twice in the list' : null);

  S.topic({
    id: 'fs-dir-structures', family: 'p14-dirs', order: 10, title: 'Single-level, two-level, tree and acyclic graph',
    blurb: 'A directory maps names to files. How the directories themselves are arranged decides what names can clash, how files are grouped and whether one file can be shared. The same users make the same files four times over; the file system itself refuses what each structure cannot hold.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'structure', def: 'single', options: KINDS },
      { id: 'users', kind: 'list', label: 'users', def: ['ann', 'bob'], min: 1, max: 3, check: nameOk },
      { id: 'files', kind: 'list', label: 'each user makes', def: ['notes', 'todo'], min: 1, max: 3, check: nameOk },
    ],
    presets: [
      { label: 'Single-level: names clash', values: { kind: 'single', users: ['ann', 'bob'], files: ['notes', 'todo'] } },
      { label: 'Two-level: one directory a user', values: { kind: 'two', users: ['ann', 'bob'], files: ['notes', 'todo'] } },
      { label: 'Tree: grouped by subject', values: { kind: 'tree', users: ['ann', 'bob'], files: ['notes', 'todo'] } },
      { label: 'Acyclic graph: a shared file', values: { kind: 'acyclic', users: ['ann', 'bob'], files: ['notes', 'todo'] } },
      { label: 'Three users, single-level', values: { kind: 'single', users: ['ann', 'bob', 'cy'], files: ['plan', 'data', 'log'] } },
    ],
    counters: [{ id: 'names', label: 'names' }, { id: 'refused', label: 'refused' }],
    run(inp) {
      const t = T(), u = U(), ops = build(inp.kind, inp.users, inp.files), run = u.nsRun(ops), F = new S.Frames(['names', 'refused']);
      let refused = 0;
      const count = (tree) => u.flat(tree).length - 1 + 0;
      const draw = (tree, act, bad, cap) => {
        const d = u.drawTree(tree, { prefix: 'ds:t', x: 0, y: 10, w: 800, levelH: 92, boxW: 100, act, bad, gapX: 26 });
        const y = 10 + Math.max(d.h, 3 * 92 + 44) + 30;
        return [...d.items, t.title('ds:kt', 0, y, KINDS.find((k) => k.value === inp.kind).label), ...t.para('ds:ab', 0, y + 14, ABOUT[inp.kind], 800, 14).items, t.text('ds:cap', 0, y + 82, cap, 'calc mono', 14)];
      };
      F.add({ items: draw(run.before, null, null, 'the root directory, inode 1, holds only . and ..'), title: 'empty', say: `An empty file system: only the root directory, inode 1. ${inp.users.length === 1 ? 'One user' : inp.users.length + ' users'} will ${inp.users.length === 1 ? '' : 'each '}make ${t.list(inp.files)}.`, meta: { phase: 'start', nUsers: inp.users.length } });
      run.out.forEach((c, i) => {
        const st = u.nsKey(c), names = u.flat(c.tree).length - 1;
        if (c.err) refused++;
        F.set('names', names).set('refused', refused);
        const ino = st && st.data ? st.data.ino : st ? st.ino : null;
        const cmd = c.op + ' ' + c.args.join(' ');
        let say;
        if (c.err) say = `${cmd} is refused with ${c.err.code}: ${c.err.message}${c.err.code === 'EEXIST' ? '. In a single directory, a name used once is used for everyone.' : c.err.code === 'EISDIR' ? '.' : '.'}`;
        else say = st.say;
        const badSet = c.err && c.err.code === 'EEXIST' ? new Set([u.flat(c.tree).find((n) => n.path === c.args[c.args.length - 1]).ino]) : null;
        F.add({ items: draw(c.tree, c.err ? null : findIno(c.tree, c.args[c.args.length - 1]), badSet, (c.err ? '✗ ' : '✓ ') + cmd), title: c.op, say, meta: { phase: c.op, i, err: c.err, step: st, ino, names, refused, cmd } });
      });
      const L = run.out[run.out.length - 1].tree, names = u.flat(L).length - 1;
      F.add({ items: draw(L, null, null, `${names} names, ${refused} refused`), title: 'the result', say: `The result: ${t.plural(names, 'name')} below the root, ${refused ? t.plural(refused, 'command') + ' refused' : 'nothing refused'}. ${ABOUT[inp.kind]}`, meta: { phase: 'end', names, refused } });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Directory structures', text: ['single-level: one directory, names unique overall', 'two-level: a directory a user, unique per user', 'tree: any depth, one path a file', 'acyclic graph: a file may have several names', 'no second name for a directory: no cycles'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'create' && fr.slice(i + 1).some((x) => x.meta.err && x.meta.err.code === 'EEXIST') && f.meta.phase === 'start', once: true, pick: 'option', ask: 'Will every user be able to make every file?', options: ['no: a name clashes', 'yes'], answer: (fr) => (fr.some((x) => x.meta.err && x.meta.err.code === 'EEXIST') ? 'no: a name clashes' : 'yes'), explain: 'With one directory for everyone, the second user’s file of the same name is refused: EEXIST.' },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'link', pick: 'option', ask: (fr, i) => 'Next: ' + fr[i + 1].meta.cmd + '. Will the file system accept this second name?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.err ? 'no' : 'yes'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'In a single-level directory, two users both want a file called notes. What happens?', options: ['the second create fails: the name exists', 'both get one', 'the second replaces the first silently', 'the system adds a number'], answer: 0, why: 'All names share one directory, so each must be unique across every user.' },
      { q: 'What does a two-level directory fix?', options: ['name clashes between users', 'grouping inside a user’s files', 'sharing a file under two names', 'cycles'], answer: 0, why: 'Each user has a directory of their own, so names only need be unique within it.' },
      { q: 'Why may a directory not have a second (hard) name?', options: ['it could make a cycle, and lookups and clean-up would never end', 'directories have no inode', 'it would use too much space', 'only root may name directories'], answer: 0, why: 'With files only, the graph of names stays acyclic.' },
      { q: 'In a tree-structured system, how many paths from the root lead to a file with no extra links?', options: ['exactly one', 'one a user', 'as many as its link count plus one', 'none'], answer: 0, why: 'A tree has one path to every node.' },
    ],
  });
  function findIno(tree, path) { const n = S.T14.flat(tree).find((x) => x.path === path); return n ? n.ino : null; }

  // =================================================================================================================
  const SETUP = [['mkdir', '/home'], ['mkdir', '/home/ann'], ['mkdir', '/home/bob'], ['mkdir', '/srv'], ['create', '/home/ann/notes'], ['write', '/home/ann/notes', 0, 'buy milk'], ['create', '/home/bob/game'], ['create', '/srv/index'], ['symlink', '/home/ann/notes', '/home/bob/ann']];
  const CWDS = ['/', '/home', '/home/ann', '/home/bob', '/srv'];
  S.topic({
    id: 'fs-path-lookup', family: 'p14-dirs', order: 20, title: 'Looking up a path, inode by inode',
    blurb: 'To open /home/ann/notes the kernel starts at the root directory’s inode, reads its entries to find home and its inode number, reads that directory to find ann, and so on: one directory read for every name. A relative path starts at the current directory instead; “.” names the directory itself and “..” its parent, both real entries.',
    inputs: [
      { id: 'path', kind: 'string', label: 'path', def: '/home/ann/notes', min: 1, max: 40, check: (v) => (/^[a-z0-9./]+$/.test(v) ? null : 'path: lower-case names, dots and slashes') },
      { id: 'cwd', kind: 'choice', label: 'current directory', def: '/home/bob', options: CWDS.map((c) => ({ value: c, label: c })) },
    ],
    presets: [
      { label: 'An absolute path', values: { path: '/home/ann/notes', cwd: '/' } },
      { label: 'A relative path', values: { path: 'game', cwd: '/home/bob' } },
      { label: 'Up with ..', values: { path: '../ann/notes', cwd: '/home/bob' } },
      { label: 'Dots everywhere', values: { path: './../../srv/./index', cwd: '/home/ann' } },
      { label: 'Through a symbolic link', values: { path: '/home/bob/ann', cwd: '/' } },
      { label: 'A name that is not there', values: { path: '/home/ann/diary', cwd: '/' } },
      { label: '.. at the root stays put', values: { path: '/../../srv', cwd: '/' } },
    ],
    counters: [{ id: 'dirs', label: 'directories read' }],
    run(inp) {
      const t = T(), u = U(), F2 = S.FS, run = u.nsRun([], { setup: SETUP }), img = run.img, tree = run.before;
      const cwd = F2.lookup(img, inp.cwd).ino, abs = inp.path.startsWith('/');
      let lk, err = null;
      try { lk = F2.lookup(img, inp.path, { from: cwd }); } catch (e) { err = { code: e.code, message: e.message }; lk = { ino: 0, steps: [] }; }
      const sym = u.symTargets(img, tree), byIno = new Map(u.flat(tree).map((n) => [n.ino, n]));
      const comps = inp.path.split('/').filter(Boolean);
      const F = new S.Frames(['dirs']);
      const seen = new Set();
      const tx = new F2.Tx(img);
      const draw = (act, k, entries, found) => {
        const d = u.drawTree(tree, { prefix: 'pl:t', x: 0, y: 8, w: 800, levelH: 84, boxW: 104, act, seen, sym, img, gapX: 24 });
        const items = [...d.items];
        const y0 = 8 + d.h + 34;
        items.push(t.title('pl:pt', 0, y0, 'the path'));
        let x = 0;
        const parts = (abs ? ['/'] : []).concat(comps);
        parts.forEach((c, j) => {
          const w = Math.max(34, R(t.tw(c, 14, { mono: true, bold: true }) + 18)), on = j === k + (abs ? 1 : 0) || (k < 0 && j === 0 && abs);
          items.push({ key: 'pl:c' + j, kind: 'cell', x, y: y0 + 12, w, h: 32, rx: 5, text: c, size: 14, cls: 'pl-comp mono' + (on ? ' act' : j < k + (abs ? 1 : 0) ? ' done' : '') });
          x += w + 6;
        });
        if (entries) {
          const ex = 470;
          items.push(t.title('pl:et', ex, y0, `directory inode ${entries.ino}: its entries`));
          entries.list.slice(0, 6).forEach((e, j) => {
            const on = e.name === found;
            items.push({ key: 'pl:en' + j, kind: 'cell', x: ex, y: y0 + 12 + j * 28, w: 170, h: 26, rx: 0, text: e.name, size: 13, cls: 'dk slot-l' + (on ? ' act' : '') });
            items.push({ key: 'pl:ei' + j, kind: 'cell', x: ex + 170, y: y0 + 12 + j * 28, w: 120, h: 26, rx: 0, text: 'inode ' + e.ino, size: 13, cls: 'dk slot-v mono' + (on ? ' act' : '') });
          });
        }
        return items;
      };
      F.add({ items: draw(null, -1, null, null), title: 'the path', say: `Look up “${inp.path}” ${abs ? 'from the root, inode 1, since it starts with /' : `from the current directory ${inp.cwd}, inode ${cwd}, since it does not start with /`}. It has ${t.plural(comps.length, 'name')} to find.`, meta: { phase: 'start', cwd, n: comps.length } });
      let k = -1, dirs = 0;
      for (const st of lk.steps) {
        if (st.kind === 'lookup-root') { seen.add(st.ino); continue; }
        if (st.kind === 'lookup-dir') {
          k++; dirs++;
          seen.add(st.ino);
          const list = F2.dirEntries(tx, st.ino).filter((e) => e.ino).map((e) => ({ name: e.name, ino: e.ino }));
          F.set('dirs', dirs);
          const bl = st.blocks.length === 1 ? 'its block ' + st.blocks[0] : 'its blocks ' + t.list(st.blocks.map(String));
          const said = `Inode ${st.ino} is a directory of ${t.plural(list.length, 'entry', 'entries')}; ${bl} ${st.found ? `name${st.blocks.length === 1 ? 's' : ''} “${st.name}” as inode ${st.found}` : `${st.blocks.length === 1 ? 'does' : 'do'} not hold “${st.name}”`}.`;
          F.add({ items: draw(st.found || st.ino, k, { ino: st.ino, list }, st.name), title: st.name, say: said + (st.name === '..' ? ` “..” is a real entry: it leads to the parent${st.found === st.ino ? ', and at the root to the root itself' : ''}.` : st.name === '.' ? ' “.” is a real entry naming the directory itself.' : ''), meta: { phase: 'dir', step: st, k, dirs, live: list.length } });
          if (st.found) seen.add(st.found);
        } else if (st.kind === 'lookup-link') {
          F.add({ items: draw(st.ino, k, null, null), title: 'symbolic link', say: st.say + ' The rest of the lookup follows the text, not an inode.', meta: { phase: 'link', step: st, k, dirs } });
        }
      }
      const fin = lk.ino ? byIno.get(lk.ino) : null;
      const end = lk.ino ? `“${inp.path}” is inode ${lk.ino}${fin ? `, the ${fin.type} ${fin.path}` : ''}, found with ${t.plural(dirs, 'directory read', 'directory reads')}.` : err ? `The lookup fails: ${err.code}, ${err.message}.` : `The lookup fails with ENOENT: there is no such name, found out after ${t.plural(dirs, 'directory read', 'directory reads')}.`;
      F.add({ items: draw(lk.ino || null, comps.length - 1, null, null), title: lk.ino ? 'found' : 'not found', say: end, meta: { phase: 'end', ino: lk.ino, dirs } });
      return { frames: F.list, def: { sections: [{ id: 'p', kind: 'math', title: 'Lookup', text: ['start: / → inode 1; else the current directory', 'each name: read the directory, find the entry', 'the entry gives the next inode number', '. → this directory, .. → its parent', 'a symbolic link: continue with its text', 'search (x) permission needed on each directory'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many directories will the kernel read to find it?', options: (fr) => { const a = fr[fr.length - 1].meta.dirs; return [...new Set([Math.max(1, a - 1), a, a + 1, a + 2])].sort((x, y) => x - y).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.dirs), explain: 'One directory read for every name in the path, counting . and .. and the names a symbolic link adds.' },
    ],
    quiz: [
      { q: 'How many directory reads does /a/b/c need (no caching)?', options: ['3: the root, a and b', '1', '2', '4'], answer: 0, why: 'Each directory on the way is read to find the next name; c itself is the result, not read as a directory.' },
      { q: 'Where does the lookup of notes/today start?', options: ['at the current directory', 'at the root', 'at the home directory', 'at notes'], answer: 0, why: 'A path without a leading / is relative to the current directory.' },
      { q: 'What is ..?', options: ['an entry in every directory naming its parent', 'a special case in the kernel only', 'the root', 'the previous path typed'], answer: 0, why: 'mkdir writes both . and .. into a new directory, so a lookup just reads them like other names.' },
      { q: 'Where does /.. lead?', options: ['to the root itself', 'to an error', 'to the parent of the file system', 'to the current directory'], answer: 0, why: 'The root’s .. names the root, inode 1.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
