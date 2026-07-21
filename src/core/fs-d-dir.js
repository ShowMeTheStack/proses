// A block-level file system, part 4: permissions, directories and path lookup.
//   F.err(code, message)                   an Error with .code: ENOENT ENOTDIR EEXIST EACCES ELOOP ENOTEMPTY EISDIR
//                                          EINVAL EBUSY EXDEV EFRAG ENOSPC EBADF
//   F.can(n, cred, want)                   want: 4 read, 2 write, 1 execute (search, for a directory); uid 0 may do all
//   F.access(tx, ino, want, what)          the same, as a step; throws EACCES
//   F.dirEntries(tx, dino) -> [{ino, name, block, off, slot}]  (free slots have ino 0)
//   F.dirAdd(tx, dino, name, ino)  F.dirRemove(tx, dino, name)  F.dirFind(tx, dino, name)
//   F.namei(tx, path, {quiet, follow, from}) -> ino (0 when missing); each directory read is a step. Symbolic
//       links are followed in the middle of a path and, with follow (the default), at its end; more than
//       F.MAXLINKS of them in one lookup is a loop (ELOOP). Every directory passed needs search (x) permission.
//   F.splitPath(path) -> {dir, name}       F.readLinkTx(tx, ino) -> the target text
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  F.MAXLINKS = 8;
  F.err = function (code, msg) { const e = new Error(msg); e.code = code; return e; };
  const WANT = { 4: 'read', 2: 'write', 1: 'search', 3: 'write and search', 6: 'read and write' };

  F.can = function (n, cred, want) {
    if (!cred || cred.uid === 0) return true;
    const bits = cred.uid === n.uid ? (n.mode >> 6) & 7 : cred.gid === n.gid || (cred.groups || []).includes(n.gid) ? (n.mode >> 3) & 7 : n.mode & 7;
    return (bits & want) === want;
  };
  F.access = function (tx, ino, want, what) {
    const n = tx.inode(ino), c = tx.cred;
    if (F.can(n, c, want)) return true;
    const cls = c.uid === n.uid ? 'its owner' : c.gid === n.gid ? 'its group' : 'others';
    const m = `Permission denied: uid ${c.uid} (gid ${c.gid}) needs ${WANT[want] || 'access'} on ${what || 'inode ' + ino}, whose mode ${F.modeString(n.mode)} gives ${cls} only ${F.modeString(n.mode).slice(...(cls === 'its owner' ? [0, 3] : cls === 'its group' ? [3, 6] : [6, 9]))}.`;
    tx.step('perm-denied', m, { ino, want });
    throw F.err('EACCES', m);
  };

  // ---- directories ----
  F.direntsPer = (g) => Math.floor(F.payload(g) / F.DIRENT);
  F.dirEntries = function (tx, dino) {
    const g = tx.g, n = tx.inode(dino), out = [], per = F.direntsPer(g), nslots = Math.floor(n.size / F.DIRENT);
    for (let s = 0; s < nslots; s++) {
      const fb = Math.floor(s / per), b = F.bmap(tx, n, fb, null, dino);
      if (!b) continue;
      const off = (s % per) * F.DIRENT, e = F.decodeDirent(tx.get(b), off);
      out.push(Object.assign(e, { block: b, off, slot: s }));
    }
    return out;
  };
  F.dirFind = (tx, dino, name) => F.dirEntries(tx, dino).find((x) => x.ino && x.name === name) || null;
  F.dirAdd = function (tx, dino, name, ino) {
    if (!name || name.length > F.NAME_MAX || name.includes('/') || name === '.' && ino !== dino) throw F.err('EINVAL', 'bad name ' + name);
    const g = tx.g, ents = F.dirEntries(tx, dino), free = ents.find((e) => !e.ino);
    if (free) { F.encodeDirent(tx.get(free.block), free.off, ino, name); tx.dirty(free.block, 'dir'); return free.block; }
    const n = tx.inode(dino), per = F.direntsPer(g), s = n.size / F.DIRENT;
    const b = F.bmap(tx, n, Math.floor(s / per), 'dir', dino);
    F.encodeDirent(tx.get(b), (s % per) * F.DIRENT, ino, name); tx.dirty(b, 'dir');
    n.size += F.DIRENT; tx.putInode(dino, n);
    return b;
  };
  F.dirRemove = function (tx, dino, name) {
    const e = F.dirFind(tx, dino, name);
    if (!e) throw F.err('ENOENT', 'no entry ' + name);
    F.encodeDirent(tx.get(e.block), e.off, 0, ''); tx.dirty(e.block, 'dir');
    return e;
  };
  /** the text of a symbolic link */
  F.readLinkTx = function (tx, ino) {
    const g = tx.g, n = tx.inode(ino), pay = F.payload(g);
    let s = '';
    for (let i = 0; i < n.size; i++) { const b = F.bmap(tx, n, Math.floor(i / pay), null, ino); s += String.fromCharCode(b ? tx.get(b)[i % pay] : 0); }
    return s;
  };

  const parts = (path) => String(path).split('/').filter(Boolean);
  F.splitPath = (path) => { const c = parts(path); return { dir: '/' + c.slice(0, -1).join('/'), name: c[c.length - 1] || '' }; };

  /** path lookup, inode by inode */
  F.namei = function (tx, path, o) {
    o = o || {};
    if (o === true) o = { quiet: true };
    const g = tx.g, say = (k, s, d) => { if (!o.quiet) tx.step(k, s, d); };
    let comps = parts(path), ino = String(path).startsWith('/') || !o.from ? F.ROOT : o.from, links = 0;
    const follow = o.follow !== false;
    say('lookup-root', String(path).startsWith('/') || !o.from ? `Lookup of ${path} starts at the root directory, inode ${F.ROOT}, whose number every file system knows.` : `Lookup of ${path} starts at directory inode ${ino}.`, { ino, block: F.inodeAt(g, ino).block });
    while (comps.length) {
      const c = comps.shift(), n = tx.inode(ino);
      if (n.type !== F.T_DIR) throw F.err('ENOTDIR', path + ': inode ' + ino + ' on the way is not a directory');
      F.access(tx, ino, 1, 'directory inode ' + ino);
      const ents = F.dirEntries(tx, ino), e = ents.find((x) => x.ino && x.name === c);
      const live = ents.filter((x) => x.ino).length, blocks = [...new Set(ents.map((x) => x.block))];
      say('lookup-dir', `Inode ${ino} is a directory of ${live} ${live === 1 ? 'entry' : 'entries'}; ${blocks.length === 1 ? 'its block ' + blocks[0] : 'its blocks ' + blocks.join(', ')} ${e ? (blocks.length === 1 ? 'names ' : 'name ') + c + ' as inode ' + e.ino : (blocks.length === 1 ? 'does' : 'do') + ' not hold ' + c}.`, { ino, name: c, blocks, found: e ? e.ino : 0 });
      if (!e) return 0;
      const t = tx.inode(e.ino);
      if (t.type === F.T_LINK && (comps.length || follow)) {
        if (++links > F.MAXLINKS) { say('lookup-loop', `More than ${F.MAXLINKS} symbolic links in one lookup: ${path} loops.`, { ino: e.ino }); throw F.err('ELOOP', path + ': too many symbolic links (a loop)'); }
        const target = F.readLinkTx(tx, e.ino);
        say('lookup-link', `${c} is a symbolic link (inode ${e.ino}) to ${target}: the lookup continues ${target.startsWith('/') ? 'from the root' : 'in directory inode ' + ino}.`, { ino: e.ino, target });
        comps = parts(target).concat(comps);
        if (target.startsWith('/')) ino = F.ROOT;
        continue;
      }
      ino = e.ino;
    }
    return ino;
  };
})(globalThis.Proses = globalThis.Proses || {});
