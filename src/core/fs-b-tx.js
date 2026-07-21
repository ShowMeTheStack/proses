// A block-level file system, part 2: transactions and allocation.
//
// An operation never writes the image itself: it works on a transaction (copies of the blocks it reads), and
// part 7 writes the dirty blocks out (with or without a journal, possibly cut by a crash). A transaction reads
// through img.overlay first: blocks changed in memory but not yet at home on disk (a write-back cache's dirty
// blocks, or journaled blocks not yet checkpointed). A crash (F.crash) throws the overlay away.
//   new F.Tx(img, {cred: {uid, gid}, read: (b) -> bytes})   tx.get(b), tx.fresh(b), tx.dirty(b, kind),
//       tx.inode(ino), tx.putInode(ino, n), tx.step(kind, say, data), tx.writes() -> [{block, kind, bytes, meta}],
//       tx.reads: the blocks it read from below, in order; tx.trace: its steps
//   F.readBlock(img, b)          a block as the mounted file system sees it (overlay first, then the disk)
//   F.allocInode(tx, type, {parent, mode, group})  F.allocBlock(tx, kind, goal)  F.freeBlock(tx, b)  F.freeInode(tx, ino)
//   F.isFreeBlock(tx, b)
// Placement: with one group the lowest free inode and the first free block at or after the goal are taken. With
// cylinder groups (FFS-style) a new directory goes to the group with the most free inodes, a file's inode to its
// directory's group, its blocks near its inode, and a large file moves to another group every g.chunk blocks.
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const KIND_ORDER = ['super', 'inode', 'ibm', 'dbm', 'fat', 'indirect', 'dir', 'link', 'data'];
  F.KIND_ORDER = KIND_ORDER;
  F.ROOT_CRED = { uid: 0, gid: 0 };
  F.readBlock = (img, b) => (img.overlay && img.overlay.has(b) ? img.overlay.get(b) : F.block(img, b));
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  F.plural = plural;

  class Tx {
    constructor(img, o) {
      o = o || {};
      this.img = img; this.g = img.g; this.buf = new Map(); this.kind = new Map(); this.trace = []; this.reads = [];
      this.cred = o.cred || F.ROOT_CRED; this.src = o.read || ((b) => F.readBlock(img, b));
    }
    get(b) {
      if (!this.buf.has(b)) { if (!(b >= 0 && b < this.g.nblocks)) throw new Error('block ' + b + ' is outside the disk'); this.reads.push(b); this.buf.set(b, this.src(b).slice()); }
      return this.buf.get(b);
    }
    fresh(b) { const u = new Uint8Array(this.g.bs); this.buf.set(b, u); return u; }
    dirty(b, kind) { this.kind.set(b, kind); }
    step(kind, say, data) { this.trace.push(Object.assign({ kind, say }, data || {})); }
    inode(ino) { const a = F.inodeAt(this.g, ino); return F.decodeInode(this.g, this.get(a.block), a.off); }
    putInode(ino, n) { const a = F.inodeAt(this.g, ino); F.encodeInode(this.g, this.get(a.block), a.off, n); this.dirty(a.block, 'inode'); }
    /** the changed blocks in the order this file system writes them without a journal: inodes, bitmaps, then the rest */
    writes() {
      const out = [...this.kind.entries()].map(([block, kind]) => ({ block, kind, bytes: this.buf.get(block).slice(), meta: kind !== 'data' }));
      out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.block - b.block);
      return out;
    }
  }
  F.Tx = Tx;

  // ---- inodes ----
  const inodeUsed = (tx, ino) => { const l = F.ibmLoc(tx.g, ino); return F.getBit(tx.get(l.block), l.bit); };
  F.freeInodesIn = (tx, G) => { let n = 0; for (let k = 0; k < G.nino; k++) if (!inodeUsed(tx, G.ino0 + k)) n++; return n; };
  F.allocInode = function (tx, type, o) {
    o = o || {};
    const g = tx.g;
    let order = g.grp.map((G) => G.i);
    if (g.groups > 1 && o.group === undefined) {
      const pg = F.groupOfIno(g, o.parent || F.ROOT);
      if (type === F.T_DIR) order.sort((a, b) => F.freeInodesIn(tx, g.grp[b]) - F.freeInodesIn(tx, g.grp[a]) || a - b);
      else order = order.slice(pg).concat(order.slice(0, pg));
    }
    for (const gi of order) {
      const G = g.grp[gi];
      for (let k = 0; k < G.nino; k++) {
        const i = G.ino0 + k;
        if (i === 0 || inodeUsed(tx, i)) continue;
        const l = F.ibmLoc(g, i);
        F.setBit(tx.get(l.block), l.bit, 1); tx.dirty(l.block, 'ibm');
        tx.putInode(i, F.emptyInode(g, type, o.mode, tx.cred.uid, tx.cred.gid));
        tx.step('alloc-inode', g.groups > 1 ? `Inode ${i}, in cylinder group ${gi}${type === F.T_DIR ? ' (the group with the most free inodes)' : ' (its directory’s group)'}, is marked used.` : `Inode ${i} is the lowest free bit in the inode bitmap: it is marked used.`, { ino: i, group: gi });
        return i;
      }
    }
    throw new Error('no free inodes');
  };
  F.freeInode = function (tx, ino) {
    const l = F.ibmLoc(tx.g, ino);
    F.setBit(tx.get(l.block), l.bit, 0); tx.dirty(l.block, 'ibm');
    tx.putInode(ino, F.emptyInode(tx.g, F.T_FREE));
  };

  // ---- blocks: a bitmap per group, or the FAT ----
  F.isFreeBlock = function (tx, b) {
    const g = tx.g;
    if (g.fat) { const l = F.fatLoc(g, b); return F.getPtr(tx.get(l.block), l.off, g.ps) === 0; }
    const l = F.dbmLoc(g, b); return !F.getBit(tx.get(l.block), l.bit);
  };
  function mark(tx, b, on) {
    const g = tx.g;
    if (g.fat) { const l = F.fatLoc(g, b); F.putPtr(tx.get(l.block), l.off, g.ps, on ? g.EOC : 0); tx.dirty(l.block, 'fat'); return; }
    const l = F.dbmLoc(g, b); F.setBit(tx.get(l.block), l.bit, on ? 1 : 0); tx.dirty(l.block, 'dbm');
  }
  F.markBlock = mark;
  const USE = { indirect: 'an indirect block', dir: 'directory entries', link: 'a symlink target', data: 'file data' };
  /** the first free block at or after goal (wrapping round its group, then the other groups); marked used */
  F.allocBlock = function (tx, kind, goal) {
    const g = tx.g, all = F.dataBlocks(g);
    let start = goal && F.isData(g, goal) ? all.indexOf(goal) : 0;
    if (start < 0) start = 0;
    const G0 = F.groupOfBlock(g, all[start]);
    // search the goal's group from the goal, then the rest of the disk from there, round to the start
    for (let k = 0; k < all.length; k++) {
      const b = all[(start + k) % all.length];
      if (!F.isFreeBlock(tx, b)) continue;
      mark(tx, b, true);
      tx.fresh(b); tx.dirty(b, kind);
      const gi = F.groupOfBlock(g, b);
      tx.step('alloc-block', `Block ${b} is the first free block ${goal ? 'at or after ' + goal : 'on the disk'}${g.groups > 1 ? ' (group ' + gi + (gi === G0 ? '' : ', since group ' + G0 + ' is full') + ')' : ''}: it is marked used${g.fat ? ' in the FAT' : ''} for ${USE[kind] || kind}.`, { block: b, use: kind, group: gi });
      return b;
    }
    throw new Error('no free data blocks');
  };
  F.freeBlock = function (tx, b) { mark(tx, b, false); tx.kind.delete(b); };
  F.countFree = function (tx) { let n = 0; for (const b of F.dataBlocks(tx.g)) if (F.isFreeBlock(tx, b)) n++; return n; };
  /** where a file's next block should go: after its previous one, or near its inode; FFS moves large files on */
  F.goal = function (tx, ino, fb, prev) {
    const g = tx.g;
    if (g.groups > 1 && g.chunk && fb > 0 && fb % g.chunk === 0) {
      const gi = (F.groupOfIno(g, ino) + fb / g.chunk) % g.groups;
      return g.grp[gi].data;
    }
    if (prev) return prev + 1;
    return g.grp[F.groupOfIno(g, ino || F.ROOT)].data;
  };
})(globalThis.Proses = globalThis.Proses || {});
