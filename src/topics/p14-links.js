// Part 14, hard and symbolic links: names added and removed by the file-system engine, drawn as the graph of
// directories and inodes with every name on its edge, and a card for each file's inode with its link count and
// every name that reaches it. A symbolic link is an inode of its own whose text names a path: it is followed when
// looked up, and can dangle or loop.
(function (S) {
  'use strict';
  const T = () => S.T12, U = () => S.T14;
  const R = Math.round;

  /** frames for namespace commands: the graph, the inode cards, the command list */
  function nsFrames(ops, o) {
    const t = T(), u = U(), run = u.nsRun(ops), F = new S.Frames(['names', 'inodes']);
    const depth = (n) => 1 + Math.max(0, ...n.kids.map(depth)), D = Math.max(3, ...run.out.map((c) => depth(c.tree)));
    o = Object.assign({}, o, { cardY: Math.max(8 + (D - 1) * 92 + 44, 24 + ops.length * 21) + 58 });
    const cmdText = (c) => c[0] + ' ' + c.slice(1).join(' ');
    const cards = (tree, act, img) => {
      const files = new Map();
      for (const n of u.flat(tree)) { if (n.type === 'directory') continue; if (!files.has(n.ino)) files.set(n.ino, { n, names: [] }); files.get(n.ino).names.push(n.path); }
      const items = [], CW = 390, y0 = o.cardY;
      items.push(t.panel('ln:pan', -12, y0 - 36, 824, 172), t.title('ln:ct', 0, y0 - 12, 'the inodes of files and links'));
      if (!files.size) items.push(t.text('ln:none', 0, y0 + 20, 'none', 'tick', 13));
      [...files.values()].slice(0, 4).forEach((f, k) => {
        const x = (k % 2) * (CW + 20), y = y0 + Math.floor(k / 2) * 70, n = f.n;
        let body;
        if (n.type === 'symlink') { let txt = ''; try { txt = S.FS.readlink(img, n.path); } catch (e) { txt = '?'; } body = 'text “' + txt + '”'; }
        else { let txt = ''; try { txt = S.FS.text(S.FS.read(img, n.ino)); } catch (e) { txt = ''; } body = '“' + (txt.length > 16 ? txt.slice(0, 15) + '…' : txt) + '” · ' + n.size + ' B'; }
        items.push({ key: 'ln:cd' + n.ino, kind: 'cell', x, y, w: CW, h: 60, rx: 6, lines: [`inode ${n.ino} · ${n.type} · links ${n.nlink}`, (f.names.length > 3 ? f.names.slice(0, 2).join(', ') + ' and ' + (f.names.length - 2) + ' more' : f.names.join(', ')).slice(0, 52), body], size: 13, cls: (n.type === 'symlink' ? 'ft-sym' : 'ft-ino') + (act === n.ino ? ' act' : '') });
      });
      return items;
    };
    // the image changes as the run goes on: re-run up to each command for the cards' contents
    const states = [];
    { const r = u.nsRun([]); states.push(r.img); }
    for (let i = 0; i < ops.length; i++) states.push(u.nsRun(ops.slice(0, i + 1)).img);
    const draw = (i, tree, sym, act, bad, img) => {
      const d = u.drawTree(tree, { prefix: 'ln:t', x: 0, y: 8, w: 540, levelH: 92, boxW: 100, act, bad, sym, img, gapX: 18 });
      const items = [...d.items, ...cards(tree, act, img)];
      const cx = 572;
      items.push(t.title('ln:lt', cx, 14, 'the commands'));
      ops.forEach((c, k) => items.push(t.text('ln:c' + k, cx, 40 + k * 21, cmdText(c), 'calc mono' + (k === i ? ' act' : k > i ? ' muted' : ''), 13)));
      return items;
    };
    F.add({ items: draw(-1, run.before, new Map(), null, null, states[0]), title: 'start', say: o.intro, meta: { phase: 'start' } });
    run.out.forEach((c, i) => {
      const st = u.nsKey(c), names = u.flat(c.tree).length - 1, inos = new Set(u.flat(c.tree).map((n) => n.ino)).size;
      F.set('names', names).set('inodes', inos);
      let act = null, say;
      const target = u.flat(c.tree).find((n) => n.path === c.args[c.args.length - 1]);
      if (c.err) say = `${cmdText([c.op, ...c.args])} fails with ${c.err.code}: ${c.err.message}.`;
      else if (c.op === 'cat') { say = `cat ${c.args[0]} finds inode ${lastIno(c)} and reads “${c.result}”.`; act = lastIno(c); }
      else if (c.op === 'lookup') { say = `${c.args[0]} leads to inode ${c.result}.`; act = c.result; }
      else { say = st.say; act = target ? target.ino : st && st.data ? st.data.ino : null; }
      if ((c.op === 'cat' || c.op === 'lookup') && c.steps.some((s) => s.kind === 'lookup-link')) { const ls = c.steps.filter((s) => s.kind === 'lookup-link'); say += ` On the way it follows ${t.plural(ls.length, 'symbolic link')}: ${t.list(ls.map((s) => s.say.split(' ')[0] + ' → ' + s.target))}.`; }
      if (c.err && c.err.code === 'ENOENT' && c.steps.some((s) => s.kind === 'lookup-link')) say += ' The symbolic link dangles: its text names a path that no longer exists.';
      F.add({ items: draw(i, c.tree, c.sym, act, c.err && target ? new Set([target.ino]) : null, states[i + 1]), title: c.op, say, meta: { phase: c.op, i, err: c.err, step: st, result: typeof c.result === 'number' ? c.result : null, text: typeof c.result === 'string' ? c.result.length : null, names, inos, nlinks: u.flat(c.tree).map((n) => n.nlink), paths: Object.fromEntries(u.flat(c.tree).map((n) => [n.path, [n.ino, n.nlink, n.type]])), last: lastIno(c), links: c.steps.filter((s) => s.kind === 'lookup-link').map((s) => s.ino) } });
    });
    return F.list;
  }
  const lastIno = (c) => { const d = c.steps.filter((s) => s.kind === 'lookup-dir'); return d.length ? d[d.length - 1].found : 0; };
  S.T14.nsFrames = nsFrames;
  const opsCheck = (v) => U().parseOps(v, 12).error;

  const HARD = ['mkdir /docs', 'mkdir /backup', 'create /docs/report', 'write /docs/report draft one', 'link /docs/report /backup/report', 'link /docs/report /docs/final', 'unlink /docs/report', 'cat /backup/report', 'unlink /docs/final', 'unlink /backup/report'].join('\n');
  S.topic({
    id: 'fs-hard-links', family: 'p14-links', order: 10, title: 'Hard links and the link count',
    blurb: 'A directory entry is just a name and an inode number, so nothing stops two entries holding the same number: a hard link. Every name is equal; there is no original. The inode counts its names, and the file is freed only when the last one is unlinked. Names cannot point to a directory, and cannot cross into another file system.',
    inputs: [{ id: 'ops', kind: 'program', label: 'commands (mkdir, create, write, link, unlink, rename, cat)', def: HARD, check: opsCheck }],
    presets: [
      { label: 'Three names, removed one by one', values: { ops: HARD } },
      { label: 'rename is a link and an unlink', values: { ops: ['mkdir /src', 'mkdir /dst', 'create /src/x', 'write /src/x moving', 'rename /src/x /dst/y', 'cat /dst/y', 'link /dst/y /src/x', 'unlink /dst/y'].join('\n') } },
      { label: 'No second name for a directory', values: { ops: ['mkdir /top', 'mkdir /top/sub', 'link /top/sub /up', 'create /top/sub/f', 'link /top/sub/f /f2', 'unlink /top/sub/f'].join('\n') } },
      { label: 'A name that exists already', values: { ops: ['create /x', 'create /y', 'link /x /y', 'unlink /y', 'link /x /y', 'unlink /x'].join('\n') } },
    ],
    counters: [{ id: 'names', label: 'names' }, { id: 'inodes', label: 'inodes' }],
    run(inp) {
      const frames = nsFrames(U().parseOps(inp.ops, 12).ops, { cardY: 300, intro: 'Each command changes a directory entry, and link and unlink change the inode’s link count. Watch the count on each file’s card.' });
      return { frames, def: { sections: [{ id: 'h', kind: 'math', title: 'Links', text: ['a name: a directory entry (name, inode number)', 'link a b: a new entry, links + 1', 'unlink a: the entry goes, links − 1', 'links 0 and not open: the inode and blocks are freed', 'no hard links to directories (no cycles)', 'no hard links across file systems'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'unlink' && !fr[i + 1].meta.err, once: true, pick: 'option', ask: 'After the next unlink, will the file’s data still be there?', options: ['yes: another name keeps it', 'no: it is freed'], answer: (fr, i) => (/is gone, but inode \d+ keeps/.test(fr[i + 1].say) ? 'yes: another name keeps it' : 'no: it is freed'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A file has link count 3. After two unlinks, its data…', options: ['is still there, reachable by the third name', 'is freed', 'is read-only', 'moves to the third directory'], answer: 0, why: 'The blocks are freed only when the count reaches 0 (and nothing has it open).' },
      { q: 'Which name of a hard-linked file is the original?', options: ['none: every name is an equal entry', 'the first one made', 'the shortest path', 'the one in the owner’s directory'], answer: 0, why: 'Each entry holds the same inode number; the inode does not remember which came first.' },
      { q: 'Why is link to a directory refused?', options: ['it could make a cycle in the directory graph', 'directories have no link count', 'it would need root', 'directories are too big'], answer: 0, why: 'Cycles would break path walks, du, find and the freeing of directories.' },
      { q: 'What does rename within one file system change?', options: ['directory entries only; the inode and its blocks stay', 'the file’s inode number', 'every block of the file', 'the file’s owner'], answer: 0, why: 'It adds the new entry and removes the old one.' },
    ],
  });

  const SYM = ['mkdir /docs', 'create /docs/report', 'write /docs/report hello', 'symlink /docs/report /latest', 'link /docs/report /copy', 'cat /latest', 'unlink /docs/report', 'cat /copy', 'cat /latest'].join('\n');
  S.topic({
    id: 'fs-symlinks', family: 'p14-links', order: 20, title: 'Symbolic links against hard links',
    blurb: 'A symbolic link is a small file of its own whose content is a path. Looking it up means reading that text and carrying on from there. So it can name a directory, or a file on another file system, and it can dangle when its target goes, where a hard link would have kept the file alive. Links that lead round in a circle are caught by a limit on how many one lookup may follow.',
    inputs: [{ id: 'ops', kind: 'program', label: 'commands (mkdir, create, write, symlink, link, unlink, cat, lookup)', def: SYM, check: opsCheck }],
    presets: [
      { label: 'Symbolic against hard: the target goes', values: { ops: SYM } },
      { label: 'A link to a directory', values: { ops: ['mkdir /projects', 'mkdir /projects/web', 'create /projects/web/page', 'write /projects/web/page hi', 'symlink /projects/web /w', 'cat /w/page', 'link /projects/web /w2'].join('\n') } },
      { label: 'A loop', values: { ops: ['symlink /pong /ping', 'symlink /ping /pong', 'lookup /ping', 'create /real', 'symlink /real /alias', 'lookup /alias'].join('\n') } },
      { label: 'Dangling, then fixed', values: { ops: ['symlink /data/today /now', 'cat /now', 'mkdir /data', 'create /data/today', 'write /data/today sunny', 'cat /now'].join('\n') } },
      { label: 'A chain of links', values: { ops: ['create /real', 'write /real deep', 'symlink /real /l1', 'symlink /l1 /l2', 'symlink /l2 /l3', 'cat /l3'].join('\n') } },
    ],
    counters: [{ id: 'names', label: 'names' }, { id: 'inodes', label: 'inodes' }],
    run(inp) {
      const frames = nsFrames(U().parseOps(inp.ops, 12).ops, { cardY: 300, intro: 'Symbolic links are drawn dashed, with a dotted arrow to whatever their text names now. Hard links are a second solid name for the same inode.' });
      return { frames, def: { sections: [{ id: 's', kind: 'math', title: 'Symbolic against hard', text: ['hard: an entry naming an inode; links + 1', 'symbolic: an inode holding a path', 'symbolic may name a directory or cross file systems', 'symbolic can dangle; hard cannot', 'a lookup follows at most 8 symbolic links (ELOOP)', 'removing a symbolic link leaves its target alone'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'cat' && fr.slice(0, i + 1).some((x) => x.meta.phase === 'unlink'), once: true, pick: 'option', ask: (fr, i) => 'Next: ' + fr[i + 1].say.split(' ').slice(0, 2).join(' ') + '. Will it find the file?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.err ? 'no' : 'yes'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'The file a symbolic link names is deleted. Reading through the link gives…', options: ['ENOENT: the link dangles', 'the old contents', 'an empty file', 'the link’s own text'], answer: 0, why: 'The link holds a path, not an inode; the path no longer leads anywhere.' },
      { q: 'Which can name a directory?', options: ['a symbolic link', 'a hard link', 'both', 'neither'], answer: 0, why: 'A symbolic link is followed as text, so it cannot make the directory graph cyclic for the kernel’s own walks.' },
      { q: 'A symbolic link’s link count is about…', options: ['the names of the link itself, not of its target', 'the target’s names', 'how many times it was followed', 'nothing: links have no inode'], answer: 0, why: 'The link is an inode of its own; its count says how many entries name it.' },
      { q: 'How does the kernel notice two symbolic links that point at each other?', options: ['it gives up after a fixed number of links in one lookup (ELOOP)', 'it keeps a list of every inode seen', 'it refuses to create the second link', 'it never notices'], answer: 0, why: 'A small limit (8 here) catches loops cheaply.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
