// Part 14, the file-system interface: the families, and the helpers its topics share (S.T14): a small script of
// system calls run on the file-system engine (S.FS.Sys) step by step with the tables after each call, the
// namespace of an image as a tree of names and inodes, and the parsing of the scripts students type.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'fsapi', order, title, blurb });
  fam('p14-files', 10, 'Files and their operations', 'A file is an inode with attributes and data, reached through a name; the operations create, write, read, rename and truncate it, sequentially or at any offset.');
  fam('p14-open', 20, 'Open files', 'The per-process descriptor table, the system-wide open-file table with its offsets, and the inode table: what open, read, lseek, dup, fork and close do to each.');
  fam('p14-dirs', 30, 'Directories and path names', 'Single-level, two-level, tree and acyclic-graph directories, and a path name looked up inode by inode, with "." and "..", absolute and relative.');
  fam('p14-links', 40, 'Hard and symbolic links', 'Several names for one inode and the link count that keeps it alive; a symbolic link that names a path instead, and can dangle or loop; a file unlinked while it is still open.');
  fam('p14-mount', 50, 'Mounting and protection', 'One namespace built from several file systems, and the permission bits that say who may read, write and search.');

  const T = (S.T14 = S.T14 || {});
  const F = () => S.FS;

  /** a fresh image of the given size (small by default) */
  T.image = (o) => F().mkfs(Object.assign({ bs: 256, nblocks: 64, ninodes: 16 }, o || {}));

  /**
   * Run calls on a fresh FS.Sys: setup(sys, img) first, then each call; every call gives {call, args, result, err,
   * steps, io, snap}. A call that fails is recorded with its error code and message, and the run goes on.
   * calls: [[name, ...args]]: open pid path flags | read pid fd n | write pid fd text | lseek pid fd off whence |
   *   dup pid fd | fork pid child | close pid fd | op pid name ...args | proc pid uid gid | stat pid path |
   *   mount path dev | umount path
   */
  T.runCalls = function (calls, o) {
    o = o || {};
    const img = o.img || T.image(o.geometry), sys = new (F().Sys)(img, o.sys || {}), out = [], imgs = [img].concat(o.mounts || []);
    if (o.setup) o.setup(sys, img);
    const before = o.capture ? o.capture(sys, img) : null;
    for (const c of calls) {
      const [name, ...args] = c;
      let r = null, err = null;
      try {
        if (name === 'proc') { sys.proc(args[0], { uid: args[1], gid: args[2] }); r = { result: args[0], steps: [{ kind: 'proc', say: `Process ${args[0]} runs as uid ${args[1]}, gid ${args[2]}, with no open files.` }], io: { reads: 0, writes: 0, hits: 0 } }; }
        else if (name === 'mount') r = sys.mount(args[0], imgs[args[1]]);
        else r = sys[name](...args);
      } catch (e) { err = { code: e.code || 'ERROR', message: e.message }; }
      out.push({ call: name, args, result: r ? r.result : null, err, steps: r ? r.steps : [], io: r ? r.io : null, snap: sys.snapshot(), extra: o.capture ? o.capture(sys, img) : null });
    }
    return { sys, img, out, before };
  };

  /** every name in an image's namespace: {ino, type, name, path, kids} (the same inode may appear twice) */
  T.tree = function (img, path, name, depth) {
    const st = F().stat(img, path, { nofollow: true });
    const node = { ino: st.ino, type: st.type, name: name || '/', path, nlink: st.nlink, size: st.size, kids: [] };
    if (st.type === 'directory' && (depth || 0) < 8) {
      for (const e of F().list(img, path)) {
        if (e.name === '.' || e.name === '..') continue;
        node.kids.push(T.tree(img, (path === '/' ? '' : path) + '/' + e.name, e.name, (depth || 0) + 1));
      }
    }
    return node;
  };
  /** the first path that names each inode, from a tree */
  T.names = function (tree) {
    const m = new Map();
    const go = (n) => { if (!m.has(n.ino)) m.set(n.ino, n.path); n.kids.forEach(go); };
    go(tree);
    return m;
  };

  /** parse a call script: one call a line, "pid call args"; {calls, error} */
  T.parseScript = function (text) {
    const calls = [];
    const lines = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const [i, l] of lines.entries()) {
      const w = l.split(/\s+/), pid = +w[0], name = w[1], bad = (m) => ({ calls, error: 'line ' + (i + 1) + ' (' + l + '): ' + m });
      if (!Number.isInteger(pid) || pid < 1 || pid > 99) return bad('it starts with the process number, 1 to 99');
      const n = (k) => { const v = +w[k]; return Number.isInteger(v) && v >= 0 ? v : NaN; };
      switch (name) {
        case 'open': if (!w[2] || !w[2].startsWith('/')) return bad('open needs an absolute path'); if (!/^(r|w|rw|a)c?t?$/.test(w[3] || 'r')) return bad('flags are r, w, rw or a, then c (create) and t (truncate)'); calls.push(['open', pid, w[2], w[3] || 'r']); break;
        case 'read': if (isNaN(n(2)) || isNaN(n(3))) return bad('read fd n'); calls.push(['read', pid, n(2), n(3)]); break;
        case 'write': if (isNaN(n(2)) || w.length < 4) return bad('write fd text'); calls.push(['write', pid, n(2), w.slice(3).join(' ')]); break;
        case 'lseek': if (isNaN(n(2)) || !Number.isInteger(+w[3])) return bad('lseek fd offset [set|cur|end]'); calls.push(['lseek', pid, n(2), +w[3], w[4] || 'set']); break;
        case 'dup': if (isNaN(n(2))) return bad('dup fd'); calls.push(['dup', pid, n(2)]); break;
        case 'fork': if (isNaN(n(2)) || n(2) < 1 || n(2) > 99) return bad('fork child-pid'); calls.push(['fork', pid, n(2)]); break;
        case 'close': if (isNaN(n(2))) return bad('close fd'); calls.push(['close', pid, n(2)]); break;
        case 'unlink': if (!w[2] || !w[2].startsWith('/')) return bad('unlink path'); calls.push(['op', pid, 'unlink', w[2]]); break;
        default: return bad('the calls are open, read, write, lseek, dup, fork, close and unlink');
      }
    }
    if (!calls.length) return { calls, error: 'at least one call' };
    if (calls.length > 16) return { calls, error: 'at most 16 calls, so every step can be drawn' };
    return { calls, error: null };
  };
  /** a call as it would be written in C */
  T.callText = function (c) {
    const [name, ...a] = c;
    const FL = { r: 'O_RDONLY', w: 'O_WRONLY', rw: 'O_RDWR', a: 'O_WRONLY|O_APPEND' };
    switch (name) {
      case 'open': { const f = a[2].replace(/[ct]/g, ''); return `open("${a[1]}", ${FL[f] || f}${/c/.test(a[2]) ? '|O_CREAT' : ''}${/t/.test(a[2]) ? '|O_TRUNC' : ''})`; }
      case 'read': return `read(${a[1]}, buf, ${a[2]})`;
      case 'write': return `write(${a[1]}, "${a[2]}", ${a[2].length})`;
      case 'lseek': return `lseek(${a[1]}, ${a[2]}, SEEK_${String(a[3]).toUpperCase()})`;
      case 'dup': return `dup(${a[1]})`;
      case 'fork': return 'fork()';
      case 'close': return `close(${a[1]})`;
      case 'op': return `${a[1]}(${a.slice(2).map((x) => (typeof x === 'string' ? '"' + x + '"' : x)).join(', ')})`;
      default: return name;
    }
  };
})(globalThis.Proses = globalThis.Proses || {});
(function (S) {
  'use strict';
  const T = S.T14;
  /**
   * A namespace drawn as a tree of inodes: every inode a box (its number and type), every directory entry an edge
   * from the directory to the inode it names, the name on the edge. A second name for an inode already drawn (a hard
   * link) is a dashed box saying so, so the picture stays a tree with no crossing lines; a symbolic link's box shows
   * the path it holds, and is marked when that path leads nowhere. o: {prefix, x, y, w, levelH, boxW, boxH,
   * act: Set|ino, seen: Set, bad: Set, sym: Map(ino -> target ino), cls(node)} -> {items, h, pos: Map(ino -> {x, y}), bw}
   */
  T.drawTree = function (tree, o) {
    const items = [], P = o.prefix, bh = o.boxH || 44, levelH = o.levelH || 84;
    const firstAt = new Set([tree.ino]);
    let dups = 0;
    const strip = (n) => {
      const kids = [];
      for (const k of n.kids) {
        if (firstAt.has(k.ino)) { kids.push({ id: k.ino + 'd' + dups++, n: k, dup: true, kids: [], edge: k.name }); continue; }
        firstAt.add(k.ino);
        kids.push(strip(k));
      }
      return { id: String(n.ino), n, kids, edge: n.name === '/' ? '' : n.name };
    };
    const root = strip(tree);
    let leaves = 0; const cnt = (x) => { if (!x.kids.length) leaves++; x.kids.forEach(cnt); }; cnt(root);
    const g0 = o.gapX === undefined ? 30 : o.gapX;
    const bw = Math.min(o.boxW || 104, Math.max(70, Math.floor((o.w - g0 * (leaves - 1)) / Math.max(1, leaves))));
    const gapX = leaves > 1 ? Math.max(g0, Math.min(44, Math.floor((o.w - leaves * bw) / (leaves - 1)))) : g0;
    S.Kit.tree.layout(root, { x: 0, y: o.y + bh / 2, levelH, boxW: bw, gapX });
    const b = S.Kit.tree.bounds(root, bw, bh), dx = o.x + (o.w - b.w) / 2 - b.x;
    const pos = new Map();
    const has = (s, v) => (s instanceof Set ? s.has(v) : s === v);
    const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const prep = (x) => {
      x.x = Math.round((x.x + dx) * 10) / 10;
      const n = x.n, ty = n.type === 'directory' ? 'dir' : n.type === 'symlink' ? 'link' : 'file';
      if (!x.dup) pos.set(n.ino, { x: x.x, y: x.y });
      if (x.dup) x.lines = ['inode ' + n.ino, 'a second name'];
      else if (ty === 'link') { let txt = ''; try { txt = S.FS.readlink(o.img, n.path); } catch (e) { txt = '?'; } x.lines = ['inode ' + n.ino + ' · link', '→ ' + short(txt, Math.max(6, Math.floor((bw - 26) / 7.4)))]; }
      else x.lines = [(n.path === '/' ? '/ · ' : '') + 'inode ' + n.ino, ty === 'dir' ? 'directory' : 'file · ' + n.size + ' B'];
      const dangling = ty === 'link' && o.sym && o.sym.has(n.ino) && !o.sym.get(n.ino);
      x.cls = (x.dup ? 'dup14' : ty + '14') + (o.cls ? ' ' + (o.cls(n) || '') : '') + (has(o.act, n.ino) ? ' act' : '') + (o.seen && o.seen.has(n.ino) ? ' seen' : '') + ((o.bad && o.bad.has(n.ino)) || dangling ? ' bad' : '');
      x.edgeCls = x.dup ? 'extra' : '';
      x.kids.forEach(prep);
    };
    prep(root);
    const drawn = S.Kit.tree.draw(root, { prefix: P, boxW: bw, boxH: bh, size: 13, edgeSize: 13 });
    // each name placed beside its edge, on the outer side, clear of the line however flat the edge runs
    const at = new Map(); const walk = (x) => { at.set(P + ':n' + x.id, x); x.kids.forEach(walk); }; walk(root);
    for (const it of drawn) {
      if (it.kind !== 'edge' || !it.label) continue;
      const A = at.get(it.from), B = at.get(it.to), ax = A.x, ay = A.y + bh / 2, bx = B.x, by = B.y - bh / 2;
      const dx = bx - ax, dy = Math.max(1, by - ay), sg = dx < 0 ? -1 : 1;
      const tw = S.textWidth(it.label, 13, { bold: true });
      // beside the middle of the edge, on its outer side, far enough out that the sloping line clears the text
      it.lx = Math.round(ax + dx / 2 + sg * (tw / 2 + 7 + 10 * Math.abs(dx) / dy)); it.ly = Math.round(ay + dy / 2 + 4);
    }
    items.push(...drawn);
    let maxY = 0; const my = (x) => { maxY = Math.max(maxY, x.y); x.kids.forEach(my); }; my(root);
    return { items, h: maxY + bh / 2 - o.y, pos, bw };
  };
})(globalThis.Proses = globalThis.Proses || {});
(function (S) {
  'use strict';
  const T = S.T14;
  const ARGS = { mkdir: 1, create: 1, write: -2, link: 2, symlink: 2, unlink: 1, rmdir: 1, rename: 2, lookup: 1, cat: 1, chmod: 2, truncate: 2, stat: 1 };
  /** parse namespace commands, one a line ("mkdir /home", "link /a /b", "write /a some text"): {ops, error} */
  T.parseOps = function (text, max) {
    const ops = [];
    const lines = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const [i, l] of lines.entries()) {
      const w = l.split(/\s+/), name = w[0], n = ARGS[name], bad = (m) => ({ ops, error: 'line ' + (i + 1) + ' (' + l + '): ' + m });
      if (n === undefined) return bad('the commands are ' + Object.keys(ARGS).join(', '));
      if (n === -2) { if (w.length < 3 || !w[1].startsWith('/')) return bad('write /path text'); ops.push([name, w[1], w.slice(2).join(' ')]); continue; }
      if (w.length !== n + 1) return bad(name + ' takes ' + n + (n === 1 ? ' path' : ' arguments'));
      if (name === 'chmod') { if (!/^[0-7]{3}$/.test(w[1]) || !w[2].startsWith('/')) return bad('chmod 644 /path'); ops.push([name, w[1], w[2]]); continue; }
      if (name === 'truncate') { if (!w[1].startsWith('/') || !/^\d{1,4}$/.test(w[2])) return bad('truncate /path size'); ops.push([name, w[1], +w[2]]); continue; }
      const paths = name === 'symlink' ? [w[2]] : w.slice(1);
      if (paths.some((p) => !p.startsWith('/'))) return bad('paths start at the root, /');
      if (w.slice(1).some((p) => p.split('/').some((c) => c.length > 27))) return bad('a name is at most 27 characters');
      ops.push([name, ...w.slice(1)]);
    }
    if (!ops.length) return { ops, error: 'at least one command' };
    if (ops.length > (max || 16)) return { ops, error: 'at most ' + (max || 16) + ' commands, so every step can be drawn' };
    return { ops, error: null };
  };
  /** run namespace commands on a fresh image as root: [{op, args, err, steps, tree, result}] */
  T.nsRun = function (ops, o) {
    o = o || {};
    const F = S.FS, img = T.image(Object.assign({ nblocks: 128, ninodes: 32 }, o.geometry || {})), sys = new F.Sys(img), out = [];
    for (const c of o.setup || []) sys.op(1, c[0], ...c.slice(1));
    const before = T.tree(img, '/');
    for (const c of ops) {
      const [name, ...a] = c;
      let r = null, err = null, result = null;
      try {
        if (name === 'lookup') { const lk = F.lookup(img, a[0]); r = { steps: lk.steps }; result = lk.ino; if (!lk.ino) err = { code: 'ENOENT', message: a[0] + ': no such file or directory' }; }
        else if (name === 'cat') { const lk = F.lookup(img, a[0]); r = { steps: lk.steps }; if (!lk.ino) err = { code: 'ENOENT', message: a[0] + ': no such file or directory' }; else result = F.text(F.read(img, lk.ino)); }
        else if (name === 'write') { r = sys.op(1, 'write', a[0], F.stat(img, a[0]).size, a[1]); }
        else if (name === 'chmod') { r = sys.op(1, 'chmod', a[1], parseInt(a[0], 8)); }
        else if (name === 'stat') { const st = F.stat(img, a[0]); r = { steps: [] }; result = st; }
        else r = sys.op(1, name, ...a);
        if (r && r.result !== undefined && result === null) result = r.result;
      } catch (e) { err = { code: e.code || 'ERROR', message: e.message }; }
      const tree = T.tree(img, '/');
      out.push({ op: name, args: a, err, steps: r ? r.steps : [], result, tree, sym: T.symTargets(img, tree) });
    }
    return { img, sys, out, before };
  };
  /** the symbolic links of a tree and the inode each one's text names now (0: dangling or a loop) */
  T.symTargets = function (img, tree) {
    const m = new Map(), F = S.FS;
    const go = (n) => { if (n.type === 'symlink') { let to = 0; try { to = F.lookup(img, F.readlink(img, n.path)).ino; } catch (e) { to = 0; } m.set(n.ino, to); } n.kids.forEach(go); };
    go(tree);
    return m;
  };
  /** the key step of a namespace command: the one that says what it did */
  T.nsKey = (c) => (c.steps.length ? c.steps.find((s) => s.kind === c.op) || c.steps[c.steps.length - 1] : null);
  T.flat = (tree) => { const out = []; const go = (n) => { out.push(n); n.kids.forEach(go); }; go(tree); return out; };
})(globalThis.Proses = globalThis.Proses || {});
