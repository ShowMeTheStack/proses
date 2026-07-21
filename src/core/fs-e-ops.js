// A block-level file system, part 5: mkfs and the operations.
//   F.mkfs(geometry, stale?) -> image      (stale: a text the unused data blocks are filled with, as an old disk)
//   F.prepare(img, op, ...args) -> tx      run one operation on a transaction; nothing is written. tx.result holds
//                                          its answer, tx.trace its steps, tx.writes() the changed blocks
//   F.prepareAs(img, {cred, read}, op, args) -> tx    the same as a user {uid, gid}
//   Operations (F.ops; args after the transaction):
//     mkdir(path, mode)  create(path, mode)  write(path|ino, offset, data)  append(path|ino, data)
//     link(existing, path)  symlink(target, path)  unlink(path)  rmdir(path)  rename(from, to)
//     truncate(path|ino, size)  chmod(path, mode)  chown(path, uid, gid)  release(ino)  compact()
//   unlink of a file that is still open (img.open: Map ino -> count, kept by the open-file layer) leaves the inode
//   with no links on the superblock's orphan list; release(ino) frees it when the last descriptor closes, and
//   recovery frees whatever a crash left on the list.
//   F.read(img, path|ino, offset, len, {cred}) -> Uint8Array   F.text(bytes)   F.lookup(img, path) -> {ino, steps}
//   F.list(img, path) -> live entries   F.stat(img, path) -> {ino, type, mode, uid, gid, nlink, size, blocks}
//   F.readlink(img, path)   F.walk(img, ino, N) -> {fb, off, loc, block, byte, steps}: the way to byte N
//   F.orphans(img) -> [ino]
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const toBytes = (d) => (typeof d === 'string' ? Uint8Array.from(d, (ch) => ch.charCodeAt(0) & 255) : d);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const ORPH = 4 + 4 * 15 + 4;                 // superblock: orphan count, then the orphan inode numbers

  F.orphans = function (img, read) {
    const u = (read || ((b) => F.readBlock(img, b)))(0), n = F.get32(u, ORPH), out = [];
    for (let i = 0; i < n && ORPH + 4 + 4 * i + 4 <= img.g.bs; i++) out.push(F.get32(u, ORPH + 4 + 4 * i));
    return out;
  };
  function setOrphans(tx, list) {
    const u = tx.get(0);
    if (ORPH + 4 + 4 * list.length > tx.g.bs) throw F.err('ENOSPC', 'the orphan list is full');
    u.fill(0, ORPH); F.put32(u, ORPH, list.length); list.forEach((x, i) => F.put32(u, ORPH + 4 + 4 * i, x)); tx.dirty(0, 'super');
  }
  F.setOrphans = setOrphans;

  F.mkfs = function (o, stale) {
    const g = F.geometry(o);
    if (g.groups > 1 && !g.chunk) g.chunk = Math.max(4, Math.floor(g.ndata / g.groups / 3));
    const img = F.image(g);
    if (stale) for (const b of F.dataBlocks(g)) { const u = F.block(img, b); for (let i = 0; i < g.bs; i++) u[i] = stale.charCodeAt((b * 7 + i) % stale.length); }
    F.encodeSuper(g, F.block(img, 0));
    const l0 = F.ibmLoc(g, 0); F.setBit(F.block(img, l0.block), l0.bit, 1);
    const tx = new F.Tx(img), root = F.allocInode(tx, F.T_DIR, { group: 0 });
    if (root !== F.ROOT) throw new Error('the root must be inode ' + F.ROOT);
    const n = tx.inode(root), b = F.bmap(tx, n, 0, 'dir', root), u = tx.get(b);
    u.fill(0); F.encodeDirent(u, 0, root, '.'); F.encodeDirent(u, F.DIRENT, root, '..'); tx.dirty(b, 'dir');
    n.nlink = 2; n.size = 2 * F.DIRENT; tx.putInode(root, n);
    for (const w of tx.writes()) F.block(img, w.block).set(w.bytes);
    return img;
  };

  const lookupParent = (tx, path) => {
    const { dir, name } = F.splitPath(path), p = F.namei(tx, dir);
    if (!p) throw F.err('ENOENT', dir + ': no such directory');
    if (tx.inode(p).type !== F.T_DIR) throw F.err('ENOTDIR', dir + ': not a directory');
    if (!name) throw F.err('EINVAL', path + ': no name');
    return { p, name, dir };
  };
  const mustNotExist = (tx, p, name, path) => { if (F.dirFind(tx, p, name)) throw F.err('EEXIST', path + ' exists'); };
  const fileIno = (tx, path) => { const ino = typeof path === 'number' ? path : F.namei(tx, path); if (!ino) throw F.err('ENOENT', path + ': no such file'); return ino; };
  /** free every block and the inode itself */
  F.releaseInode = function (tx, ino) {
    const n = tx.inode(ino), own = F.ownedBlocks(tx.img, n, (b) => tx.get(b));
    for (const o of own) F.freeBlock(tx, o.block);
    F.freeInode(tx, ino);
    return own.map((o) => o.block);
  };
  /** bytes past the end of a file may hold old contents (a shrink does not clear them): clear them before the
   *  file grows over them, from the old end up to `to` or the end of that block */
  function zeroTail(tx, n, ino, to) {
    const pay = F.payload(tx.g), at = n.size % pay;
    if (!at || to <= n.size) return;
    const b = F.bmap(tx, n, Math.floor(n.size / pay), null, ino);
    if (!b) return;
    tx.get(b).fill(0, at, Math.min(pay, at + (to - n.size))); tx.dirty(b, tx.kind.get(b) || 'data');
  }
  /** write bytes into an inode at an offset (no permission check) */
  function writeIno(tx, ino, offset, d) {
    const g = tx.g, n = tx.inode(ino), pay = F.payload(g), kind = n.type === F.T_LINK ? 'link' : 'data', touched = [];
    if (offset + d.length > F.maxFileSize(g)) throw F.err('EFBIG', 'beyond the largest file');
    zeroTail(tx, n, ino, offset);
    for (let i = 0; i < d.length;) {
      const pos = offset + i, fb = Math.floor(pos / pay), at = pos % pay, take = Math.min(pay - at, d.length - i);
      const b = F.bmap(tx, n, fb, kind, ino);
      tx.get(b).set(d.subarray(i, i + take), at); tx.dirty(b, kind);
      touched.push({ fb, block: b });
      i += take;
    }
    // a contiguous file may have moved while it grew: its blocks are where n says now
    n.size = Math.max(n.size, offset + d.length); tx.putInode(ino, n);
    return { n, touched };
  }

  const OPS = (F.ops = {
    mkdir(tx, path, mode) {
      const { p, name } = lookupParent(tx, path);
      F.access(tx, p, 3, 'its directory'); mustNotExist(tx, p, name, path);
      const ino = F.allocInode(tx, F.T_DIR, { parent: p, mode }), n = tx.inode(ino), b = F.bmap(tx, n, 0, 'dir', ino), u = tx.get(b);
      F.encodeDirent(u, 0, ino, '.'); F.encodeDirent(u, F.DIRENT, p, '..'); tx.dirty(b, 'dir');
      n.nlink = 2; n.size = 2 * F.DIRENT; tx.putInode(ino, n);
      F.dirAdd(tx, p, name, ino);
      const pn = tx.inode(p); pn.nlink++; tx.putInode(p, pn);
      tx.step('mkdir', `Directory ${path} is inode ${ino}, with '.' and '..' in block ${b}; its parent, inode ${p}, gains an entry and a link (its '..').`, { ino, block: b, parent: p });
      return ino;
    },
    create(tx, path, mode) {
      const { p, name } = lookupParent(tx, path);
      F.access(tx, p, 3, 'its directory'); mustNotExist(tx, p, name, path);
      const ino = F.allocInode(tx, F.T_FILE, { parent: p, mode }), n = tx.inode(ino); n.nlink = 1; tx.putInode(ino, n);
      const b = F.dirAdd(tx, p, name, ino);
      tx.step('create', `File ${path} is inode ${ino}, empty, with one link: the entry ${name} in block ${b} of directory inode ${p}.`, { ino, parent: p, block: b });
      return ino;
    },
    write(tx, path, offset, data) {
      const ino = fileIno(tx, path), d = toBytes(data);
      if (tx.inode(ino).type !== F.T_FILE) throw F.err('EISDIR', path + ': not a regular file');
      F.access(tx, ino, 2, 'inode ' + ino);
      const { n, touched } = writeIno(tx, ino, offset, d);
      tx.step('write', `${F.count(d.length, 'byte')} ${d.length === 1 ? 'goes' : 'go'} to inode ${ino} at offset ${offset}: file block${touched.length === 1 ? '' : 's'} ${[...new Set(touched.map((t) => t.fb))].join(', ')} in disk block${touched.length === 1 ? '' : 's'} ${[...new Set(touched.map((t) => t.block))].join(', ')}; the size is now ${n.size}.`, { ino, offset, len: d.length, blocks: touched });
      return touched;
    },
    append(tx, path, data) { const ino = fileIno(tx, path); return OPS.write(tx, ino, tx.inode(ino).size, data); },
    link(tx, existing, path) {
      const ino = fileIno(tx, existing), n = tx.inode(ino);
      if (n.type === F.T_DIR) throw F.err('EPERM', 'a directory may not have a second name (it would make a cycle)');
      const { p, name } = lookupParent(tx, path);
      F.access(tx, p, 3, 'its directory'); mustNotExist(tx, p, name, path);
      F.dirAdd(tx, p, name, ino);
      const m = tx.inode(ino); m.nlink++; tx.putInode(ino, m);
      tx.step('link', `${path} is a second name for inode ${ino}: its link count is now ${m.nlink}.`, { ino, nlink: m.nlink });
      return ino;
    },
    symlink(tx, target, path) {
      const { p, name } = lookupParent(tx, path);
      F.access(tx, p, 3, 'its directory'); mustNotExist(tx, p, name, path);
      const ino = F.allocInode(tx, F.T_LINK, { parent: p }), n = tx.inode(ino); n.nlink = 1; tx.putInode(ino, n);
      writeIno(tx, ino, 0, toBytes(target));
      F.dirAdd(tx, p, name, ino);
      tx.step('symlink', `${path} is a symbolic link, inode ${ino}, holding the text ${target}: it names a path, not an inode, so it can dangle and can cross file systems.`, { ino, target });
      return ino;
    },
    unlink(tx, path) {
      const { p, name } = lookupParent(tx, path), e = F.dirFind(tx, p, name);
      if (!e) throw F.err('ENOENT', path + ': no such file');
      const ino = e.ino, n = tx.inode(ino);
      if (n.type === F.T_DIR) throw F.err('EISDIR', path + ' is a directory: use rmdir');
      F.access(tx, p, 3, 'its directory');
      F.dirRemove(tx, p, name);
      n.nlink--; tx.putInode(ino, n);
      if (n.nlink > 0) { tx.step('unlink', `${path} is gone, but inode ${ino} keeps ${plural(n.nlink, 'link')}, so its blocks stay.`, { ino, nlink: n.nlink }); return ino; }
      const open = tx.img.open && tx.img.open.get(ino);
      if (open) {
        setOrphans(tx, F.orphans(tx.img, (b) => tx.get(b)).concat([ino]));
        tx.step('unlink-open', `${path} had its last link, but inode ${ino} is still open (${plural(open, 'descriptor')}): it goes on the orphan list, and its blocks are freed only at the last close.`, { ino, open });
        return ino;
      }
      const freed = F.releaseInode(tx, ino);
      tx.step('unlink', `${path} had its last link: inode ${ino} and ${freed.length === 1 ? 'its one block is' : freed.length ? 'its ' + freed.length + ' blocks are' : 'nothing else is'} freed.`, { ino, freed });
      return ino;
    },
    rmdir(tx, path) {
      const { p, name } = lookupParent(tx, path), e = F.dirFind(tx, p, name);
      if (!e) throw F.err('ENOENT', path + ': no such directory');
      const ino = e.ino;
      if (tx.inode(ino).type !== F.T_DIR) throw F.err('ENOTDIR', path + ': not a directory');
      const left = F.dirEntries(tx, ino).filter((x) => x.ino && x.name !== '.' && x.name !== '..');
      if (left.length) throw F.err('ENOTEMPTY', `${path} is not empty: it still holds ${left.map((x) => x.name).join(', ')}`);
      F.access(tx, p, 3, 'its directory');
      F.dirRemove(tx, p, name);
      const pn = tx.inode(p); pn.nlink--; tx.putInode(p, pn);
      const freed = F.releaseInode(tx, ino);
      tx.step('rmdir', `Directory ${path} (inode ${ino}) held only '.' and '..': it is removed, its ${plural(freed.length, 'block')} freed, and its parent loses the link from '..'.`, { ino, freed });
      return ino;
    },
    rename(tx, from, to) {
      const a = lookupParent(tx, from), e = F.dirFind(tx, a.p, a.name);
      if (!e) throw F.err('ENOENT', from + ': no such file');
      const b = lookupParent(tx, to), ino = e.ino, isDir = tx.inode(ino).type === F.T_DIR;
      F.access(tx, a.p, 3, 'the source directory'); F.access(tx, b.p, 3, 'the target directory');
      if (isDir) { let d = b.p; for (let k = 0; k < 64 && d !== F.ROOT; k++) { if (d === ino) throw F.err('EINVAL', `cannot move ${from} inside itself`); d = F.dirFind(tx, d, '..').ino; } if (d === ino) throw F.err('EINVAL', `cannot move ${from} inside itself`); }
      const old = F.dirFind(tx, b.p, b.name);
      if (old && old.ino === ino) return ino;
      if (old) {
        const t = tx.inode(old.ino);
        if (t.type === F.T_DIR) {
          if (!isDir) throw F.err('EISDIR', to + ' is a directory');
          if (F.dirEntries(tx, old.ino).some((x) => x.ino && x.name !== '.' && x.name !== '..')) throw F.err('ENOTEMPTY', to + ' is not empty');
          OPS.rmdir(tx, to);
        } else { if (isDir) throw F.err('ENOTDIR', to + ' is not a directory'); OPS.unlink(tx, to); }
      }
      F.dirAdd(tx, b.p, b.name, ino);
      F.dirRemove(tx, a.p, a.name);
      if (isDir && a.p !== b.p) {
        const dd = F.dirFind(tx, ino, '..'); F.encodeDirent(tx.get(dd.block), dd.off, b.p, '..'); tx.dirty(dd.block, 'dir');
        const pa = tx.inode(a.p); pa.nlink--; tx.putInode(a.p, pa);
        const pb = tx.inode(b.p); pb.nlink++; tx.putInode(b.p, pb);
      }
      tx.step('rename', `${from} becomes ${to}: the entry for inode ${ino} is added to directory inode ${b.p} and removed from inode ${a.p}${old ? ', replacing what was there' : ''}; the inode itself is untouched${isDir && a.p !== b.p ? " except its '..'" : ''}.`, { ino, from: a.p, to: b.p, replaced: old ? old.ino : 0 });
      return ino;
    },
    truncate(tx, path, size) {
      const g = tx.g, ino = fileIno(tx, path), n = tx.inode(ino), pay = F.payload(g);
      if (n.type !== F.T_FILE) throw F.err('EISDIR', path + ': not a regular file');
      F.access(tx, ino, 2, 'inode ' + ino);
      const was = n.size;
      if (size < was) {
        const keep = Math.ceil(size / pay);
        F.amap[g.alloc].truncate(tx, n, keep);
        n.size = size; tx.putInode(ino, n);
      } else if (size > was) {
        zeroTail(tx, n, ino, size);
        if (g.alloc !== 'indexed') for (let fb = 0; fb < Math.ceil(size / pay); fb++) F.bmap(tx, n, fb, 'data', ino);
        n.size = size; tx.putInode(ino, n);
      }
      tx.step('truncate', size < was ? `Inode ${ino} shrinks from ${was} to ${F.count(size, 'byte')}: blocks past file block ${Math.ceil(size / pay) - 1} are freed.` : `Inode ${ino} grows from ${was} to ${F.count(size, 'byte')}; the new bytes read as zeros${g.alloc === 'indexed' ? ' (a hole: no blocks yet)' : ''}.`, { ino, from: was, to: size });
      return ino;
    },
    chmod(tx, path, mode) {
      const ino = fileIno(tx, path), n = tx.inode(ino);
      if (tx.cred.uid !== 0 && tx.cred.uid !== n.uid) throw F.err('EPERM', 'only the owner or root may change the mode');
      n.mode = mode & 0o777; tx.putInode(ino, n);
      tx.step('chmod', `Inode ${ino} now has mode ${F.modeString(n.mode)} (${n.mode.toString(8)}).`, { ino, mode: n.mode });
      return ino;
    },
    chown(tx, path, uid, gid) {
      const ino = fileIno(tx, path), n = tx.inode(ino);
      if (tx.cred.uid !== 0) throw F.err('EPERM', 'only root may change the owner');
      n.uid = uid; if (gid !== undefined) n.gid = gid; tx.putInode(ino, n);
      tx.step('chown', `Inode ${ino} now belongs to uid ${n.uid}, gid ${n.gid}.`, { ino, uid: n.uid, gid: n.gid });
      return ino;
    },
    /** the last descriptor of an orphan closed: free it */
    release(tx, ino) {
      const list = F.orphans(tx.img, (b) => tx.get(b));
      if (!list.includes(ino)) return 0;
      setOrphans(tx, list.filter((x) => x !== ino));
      const freed = F.releaseInode(tx, ino);
      tx.step('release', `The last descriptor of inode ${ino} is closed and it has no links: it leaves the orphan list and ${freed.length === 1 ? 'its one block is' : freed.length ? 'its ' + freed.length + ' blocks are' : 'it had no blocks to free'}${freed.length ? ' freed' : ''}.`, { ino, freed });
      return ino;
    },
    /** contiguous allocation: slide every file down so the free space becomes one run */
    compact(tx) {
      const g = tx.g;
      if (g.alloc !== 'contiguous') throw F.err('EINVAL', 'compaction is for contiguous allocation');
      const files = [];
      for (let i = 1; i < g.ninodes; i++) { const n = tx.inode(i); if (n.type && F.slot(g, n, 1)) files.push({ i, n, start: F.slot(g, n, 0), cnt: F.slot(g, n, 1) }); }
      files.sort((a, b) => a.start - b.start);
      let cur = g.dataStart, moved = 0;
      for (const f of files) {
        if (f.start !== cur) {
          for (let k = 0; k < f.cnt; k++) {
            const from = f.start + k, to = cur + k, kind = tx.kind.get(from) || (f.n.type === F.T_DIR ? 'dir' : f.n.type === F.T_LINK ? 'link' : 'data');
            const bytes = tx.get(from).slice();
            F.markBlock(tx, from, false); F.markBlock(tx, to, true);
            tx.fresh(to).set(bytes); tx.dirty(to, kind);
          }
          F.setSlot(g, f.n, 0, cur); tx.putInode(f.i, f.n); moved++;
          tx.step('compact-move', `Inode ${f.i}'s ${plural(f.cnt, 'block')} slide from ${f.start} to ${cur}.`, { ino: f.i, from: f.start, to: cur, count: f.cnt });
        }
        cur += f.cnt;
      }
      // blocks in the tail that were freed must not keep stale kinds
      for (const b of [...tx.kind.keys()]) if (F.isData(g, b) && F.isFreeBlock(tx, b)) tx.kind.delete(b);
      const runs = F.freeRuns(tx);
      tx.step('compact', `Compaction moved ${plural(moved, 'file')}: the free space is now ${runs.length === 1 ? 'one run of ' + runs[0].len + ' blocks' : plural(runs.length, 'run')}.`, { moved, runs });
      return moved;
    },
  });
  F.OPS = Object.keys(OPS);

  F.prepareAs = function (img, o, op, args) {
    if (!OPS[op]) throw new Error('no operation ' + op);
    const tx = new F.Tx(img, o || {});
    tx.op = op; tx.args = args || [];
    tx.result = OPS[op](tx, ...(args || []));
    return tx;
  };
  F.prepare = (img, op, ...args) => F.prepareAs(img, {}, op, args);

  F.read = function (img, path, offset, len, o) {
    const tx = new F.Tx(img, o || {}), g = img.g, ino = typeof path === 'number' ? path : F.namei(tx, path, { quiet: true });
    if (!ino) throw F.err('ENOENT', path + ': no such file');
    if (o && o.cred) F.access(tx, ino, 4, String(path));
    const n = tx.inode(ino), pay = F.payload(g);
    offset = offset || 0;
    if (len === undefined) len = Math.max(0, n.size - offset);
    len = Math.max(0, Math.min(len, n.size - offset));
    const out = new Uint8Array(len);
    for (let i = 0; i < len;) {
      const pos = offset + i, fb = Math.floor(pos / pay), at = pos % pay, take = Math.min(pay - at, len - i), b = F.bmap(tx, n, fb, null, ino);
      if (b) out.set(tx.get(b).subarray(at, at + take), i);
      i += take;
    }
    out.reads = tx.reads;
    return out;
  };
  F.text = (u) => { let s = ''; for (let i = 0; i < u.length; i += 4096) s += String.fromCharCode(...u.subarray(i, i + 4096)); return s; };
  F.lookup = function (img, path, o) { const tx = new F.Tx(img, o || {}), ino = F.namei(tx, path, o); return { ino, steps: tx.trace, reads: tx.reads }; };
  F.list = function (img, path) { const tx = new F.Tx(img), ino = F.namei(tx, path, { quiet: true }); return F.dirEntries(tx, ino).filter((e) => e.ino); };
  F.readlink = function (img, path) { const tx = new F.Tx(img), ino = F.namei(tx, path, { quiet: true, follow: false }); return F.readLinkTx(tx, ino); };
  F.stat = function (img, path, o) {
    const tx = new F.Tx(img), ino = typeof path === 'number' ? path : F.namei(tx, path, { quiet: true, follow: !(o && o.nofollow) });
    if (!ino) throw F.err('ENOENT', path + ': no such file');
    const n = tx.inode(ino), own = F.ownedBlocks(img, n, (b) => tx.get(b));
    return { ino, type: F.TYPE_NAME[n.type], mode: n.mode, perms: F.modeString(n.mode), uid: n.uid, gid: n.gid, nlink: n.nlink, size: n.size, blocks: own.map((x) => x.block), dataBlocks: own.filter((x) => x.kind === 'data').map((x) => x.block) };
  };
})(globalThis.Proses = globalThis.Proses || {});
