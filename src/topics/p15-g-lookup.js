// Part 15, path lookup inode by inode (S.FS.namei on a real image): from the root's inode, read each directory's
// inode and blocks, find the next name, and go on; a symbolic link restarts the walk at its target; a directory
// without search permission, a missing name or a loop of links stops it. The tree is drawn with the inodes visited
// lit, the directory being searched is shown with its entries, and every block read is counted.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const USERS = { root: { uid: 0, gid: 0 }, ana: { uid: 1, gid: 1 }, ben: { uid: 2, gid: 2 } };

  /** the tree every lookup runs on */
  function build() {
    const img = F().mkfs({ bs: 128, nblocks: 64, ninodes: 24, ndirect: 4, ps: 4 });
    const run = (op, ...a) => F().apply(img, op, a);
    run('mkdir', '/etc'); run('create', '/etc/hosts'); run('create', '/etc/passwd');
    run('mkdir', '/home'); run('mkdir', '/home/ana'); run('mkdir', '/home/ana/notes'); run('create', '/home/ana/notes/todo'); run('create', '/home/ana/notes/plan');
    run('mkdir', '/home/ben'); run('create', '/home/ben/secret');
    run('chown', '/home/ana', 1, 1); run('chown', '/home/ben', 2, 2); run('chmod', '/home/ben', 0o700);
    run('mkdir', '/links'); run('symlink', '/home/ana/notes', '/links/docs'); run('symlink', '/links/loop', '/links/loop');
    return img;
  }
  /** the namespace as a tree for S.Kit.tree, every node keyed by its inode */
  function treeOf(img) {
    const node = (path, name, ino) => {
      const st = F().stat(img, ino, { nofollow: true }), n = { id: ino, name, path, type: st.type, edge: name, lines: [path === '/' ? '/' : 'inode ' + ino, st.type === 'directory' ? 'dir ' + st.mode.toString(8) : st.type === 'symlink' ? 'symlink' : 'file'], kids: [] };
      if (st.type === 'directory') for (const e of F().list(img, path)) if (e.name !== '.' && e.name !== '..') n.kids.push(node((path === '/' ? '' : path) + '/' + e.name, e.name, e.ino));
      return n;
    };
    const root = node('/', '', F().ROOT);
    root.edge = undefined;
    return root;
  }

  S.topic({
    id: 'fsi-lookup', family: 'p15-lookup', order: 10, title: 'Path lookup, inode by inode',
    blurb: 'A path is resolved one name at a time. The walk starts at the root directory\'s inode, whose number every file system knows; it reads that inode and its directory blocks, finds the first name, takes the inode number beside it, and repeats. A symbolic link restarts the walk at its target; every directory passed needs search permission; too many links in one lookup means a loop.',
    inputs: [
      { id: 'path', kind: 'string', label: 'path', def: '/home/ana/notes/todo', spaces: false, max: 40, check: (v) => (!v.startsWith('/') ? 'an absolute path, starting with /' : null) },
      { id: 'user', kind: 'choice', label: 'as user', def: 'root', options: [{ value: 'root', label: 'root (uid 0)' }, { value: 'ana', label: 'ana (uid 1)' }, { value: 'ben', label: 'ben (uid 2)' }] },
    ],
    presets: [
      { label: 'Four names deep', values: { path: '/home/ana/notes/todo', user: 'root' } },
      { label: 'Through a symbolic link', values: { path: '/links/docs/plan', user: 'ana' } },
      { label: 'No search permission', values: { path: '/home/ben/secret', user: 'ana' } },
      { label: 'A loop of links', values: { path: '/links/loop', user: 'root' } },
      { label: 'A name that is not there', values: { path: '/etc/shadow', user: 'root' } },
      { label: 'Up with ..', values: { path: '/home/ana/../ben/secret', user: 'ben' } },
    ],
    counters: [{ id: 'dirs', label: 'directories searched' }, { id: 'reads', label: 'blocks read' }],
    run(inp) {
      const img = build(), g = img.g, cred = USERS[inp.user], log = [];
      let tx;
      tx = new (F().Tx)(img, { cred, read: (b) => { log.push({ b, at: tx.trace.length }); return F().readBlock(img, b); } });
      let ino = 0, err = null;
      try { ino = F().namei(tx, inp.path); } catch (e) { err = e; }
      const steps = tx.trace, Fr = new S.Frames(['dirs', 'reads']), root = treeOf(img);
      S.Kit.tree.layout(root, { x: 0, y: 30, levelH: 92, boxW: 80, boxH: 44, gapX: 12 });
      const byIno = new Map(); (function walk(n) { byIno.set(n.id, n); n.kids.forEach(walk); })(root);
      const visited = new Set();
      let dirs = 0, reads = 0;
      const total = steps.length + 1;
      for (let i = 0; i <= steps.length; i++) {
        const st = steps[i] || null, last = i === steps.length;
        const here = log.filter((r) => r.at === i).map((r) => r.b);
        if (!last) { reads += here.length; if (st.kind === 'lookup-dir') dirs++; }
        Fr.set('dirs', dirs).set('reads', reads);
        const cur = st ? st.ino : ino;
        if (st && st.ino) visited.add(st.ino);
        if (last && ino) visited.add(ino);
        // the tree, visited inodes ringed, the current one lit
        const marks = (n) => { n.cls = (n.id === cur ? 'act' : visited.has(n.id) ? 'seen' : '') + (n.type === 'symlink' ? ' link' : ''); n.edgeCls = visited.has(n.id) ? 'act' : ''; n.kids.forEach(marks); };
        marks(root);
        const items = [H.head('lk:t', 0, 6, `lookup of ${inp.path} as ${inp.user} (uid ${cred.uid})`)].concat(H.treeLabels(S.Kit.tree.draw(root, { prefix: 'lk:tr', boxW: 80, boxH: 44, size: 13, edgeSize: 13 }), root, { prefix: 'lk:tr', boxH: 44 }));
        const b = S.Kit.tree.bounds(root, 80, 44), py = b.y + b.h + 30;
        // the directory being searched, with its entries
        if (st && st.kind === 'lookup-dir') {
          const t2 = new (F().Tx)(img), ents = F().dirEntries(t2, st.ino).filter((e) => e.ino);
          items.push(H.head('lk:dt', 0, py, `directory inode ${st.ino}: its entries (block${st.blocks.length === 1 ? '' : 's'} ${st.blocks.join(', ')})`));
          ents.slice(0, 7).forEach((e, k) => items.push(H.cell('lk:e' + k, k * 104, py + 12, 98, 28, `${e.name} → ${e.ino}`, 'slot-v mono ' + (e.name === st.name ? 'act' : ''), 13)));
        } else if (st) {
          items.push(...H.para('lk:p', 0, py - 10, st.say, Math.max(500, b.w), 14, st.kind === 'perm-denied' || st.kind === 'lookup-loop' ? 'hot' : 'strong').items);
        } else {
          items.push(...H.para('lk:p', 0, py - 10, err ? `${err.code}: ${err.message}` : ino ? `${inp.path} is inode ${ino}: ${H.plural(dirs, 'directory', 'directories')} searched, ${H.plural(reads, 'block')} read.` : `${inp.path} does not exist.`, Math.max(500, b.w), 14, err || !ino ? 'hot' : 'good').items);
        }
        items.push(H.text('lk:rd', 0, py + 66, `blocks read this step: ${here.length ? here.join(', ') : 'none'}`, 'tick', 13));
        let say;
        if (st) say = st.say + (here.length ? ` (${here.length === 1 ? 'block ' + here[0] + ' read' : 'blocks ' + here.join(', ') + ' read'}; ${reads} so far.)` : st.kind === 'lookup-dir' ? ' (Its blocks were read before and are still in memory: no new read.)' : '');
        else if (err) say = `The lookup stops: ${err.message.replace(/\.$/, '')}. ${H.plural(dirs, 'directory', 'directories')} were searched and ${H.plural(reads, 'block')} read on the way.`;
        else if (!ino) say = `${inp.path} does not exist: the last directory searched has no such name. Nothing is opened; ${H.plural(reads, 'block')} were read to find that out.`;
        else say = `${inp.path} is inode ${ino}. The lookup searched ${H.plural(dirs, 'directory', 'directories')} and read ${H.plural(reads, 'block')}: for each directory its inode and its entries. A cache of recent names (the dentry cache) would answer the same lookup again with no reads at all.`;
        const ents = st && st.kind === 'lookup-dir' ? F().dirEntries(new (F().Tx)(img), st.ino).filter((e) => e.ino).length : 0;
        Fr.add({ items, say, title: st ? st.kind.replace('lookup-', '') : err ? err.code : 'found', meta: { phase: st ? st.kind : 'end', step: st ? Object.assign({}, st, { say: undefined }) : null, here, reads, dirs, ino, ents, uid: cred.uid, gid: cred.gid, err: err ? err.code : null, max: F().MAXLINKS, prev: steps.length ? Object.assign({}, steps[steps.length - 1], { say: undefined }) : null } });
      }
      void total; void g;
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'namei', text: ['start: the root, inode 1 (or the current directory)', 'for each name: check search (x) permission,', '  read the directory, find the name → inode', 'a symbolic link: splice its target into the path', `more than ${F().MAXLINKS} links: ELOOP (a loop)`, 'a missing name: ENOENT'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many directories will the lookup search?', options: (fr) => H.choices(fr[fr.length - 1].meta.dirs, [1, 2, 3, 4, 5, 6]), answer: (fr) => String(fr[fr.length - 1].meta.dirs), explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => f.meta.phase === 'lookup-dir' && fr[i + 1] && fr[i + 1].meta.phase === 'lookup-dir', pick: 'item', once: true, ask: 'Which inode does the lookup go to next? Click it in the tree.', answer: (fr, i) => 'lk:tr:n' + fr[i + 1].meta.step.ino, explain: (fr, i) => fr[i].say },
    ],
    quiz: [
      { q: 'Why does every lookup of an absolute path start at a known inode number?', options: ['the root directory has no name of its own to look up', 'it is faster', 'the superblock forbids others', 'inodes are numbered by depth'], answer: 0, why: 'Some starting point must be known without a lookup: the root\'s inode number.' },
      { q: 'Looking up /a/b/c with nothing cached reads at least…', options: ['the inode and a block of each of /, /a and /a/b, then the inode of c', 'only c\'s inode', 'one block', 'the whole disk'], answer: 0, why: 'Each directory on the way is read to find the next name.' },
      { q: 'To pass through a directory during lookup a user needs…', options: ['execute (search) permission on it', 'read permission', 'write permission', 'to own it'], answer: 0, why: 'x on a directory means "may look names up in it"; r means "may list it".' },
      { q: 'A symbolic link in the middle of a path makes the lookup…', options: ['continue from the link\'s target text', 'fail', 'skip a level', 'follow the inode number stored in it'], answer: 0, why: 'A symlink holds a path, which is resolved in its place.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
