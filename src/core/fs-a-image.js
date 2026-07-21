// A block-level file system, part 1: the geometry, the on-disk layout and the raw encodings.
//
// The image is a real byte array of nblocks blocks of bs bytes. With one cylinder group (the default):
//   block 0          superblock (magic and geometry)
//   inode bitmap     one bit per inode (inode 0 is reserved and always marked)
//   data bitmap      one bit per block of the data region; with alloc 'fat' this region is the FAT instead
//   inode table      ninodes inodes of isz bytes
//   journal          jblocks blocks (none when jblocks is 0): a journal superblock and the log
//   data region      file data, directory blocks, indirect blocks, symlink targets
// With groups > 1 (FFS-style cylinder groups): superblock, journal, then each group in turn holds its own inode
// bitmap, data bitmap, slice of the inode table and data blocks.
//
// An inode (isz bytes): type u16 (0 free, 1 file, 2 directory, 3 symlink), nlink u16, mode u16 (rwx bits for
// user, group, other), uid u8, gid u8, size as two u32 halves, then ndirect + 3 pointer slots of ps bytes. What the
// slots mean depends on the allocation method (g.alloc):
//   indexed     ndirect direct pointers, then single, double and triple indirect (g.levels of them are used)
//   contiguous  slot 0 the first block, slot 1 the number of blocks
//   linked      slot 0 the first block, slot 1 the last, slot 2 the count; each block ends with a ps-byte pointer
//               to the next, so it carries bs − ps bytes of data
//   fat         slot 0 the first block, slot 1 the last, slot 2 the count; the chain lives in the FAT
//   extent      pairs of slots (start, length), up to ⌊(ndirect + 3) / 2⌋ extents
// A pointer of 0 means none: block 0 is the superblock, never a data block.
//
// API: F.geometry(o) -> g; F.maxFileSize(g); F.reach(g); F.region(g, b); F.layout(g); F.payload(g);
//   F.inodeAt(g, ino) -> {block, off}; F.ibmLoc(g, ino), F.dbmLoc(g, b) -> {block, bit}; F.isData(g, b);
//   F.dataBlocks(g) -> [b..]; F.groupOfIno / groupOfBlock; F.fatLoc(g, b) -> {block, off};
//   field helpers get16/put16/get32/put32/getPtr/putPtr/getBit/setBit; F.image, F.clone, F.block;
//   F.decodeInode / encodeInode / emptyInode / readInode / slot / setSlot; F.encodeSuper / decodeSuper;
//   F.decodeDirent / encodeDirent; F.crc32(bytes).
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  F.MAGIC = 0x50f5;
  F.T_FREE = 0; F.T_FILE = 1; F.T_DIR = 2; F.T_LINK = 3;
  F.TYPE_NAME = ['free', 'file', 'directory', 'symlink'];
  F.ROOT = 1;
  /** '1 block', '3 blocks', '1 entry', '2 entries': a count that agrees with its noun */
  F.count = (n, word, many) => n + ' ' + (n === 1 ? word : many || word + 's');
  F.DIRENT = 32;            // a directory entry: inode number u32, then the name, NUL-padded
  F.NAME_MAX = 27;
  F.ALLOCS = ['indexed', 'contiguous', 'linked', 'fat', 'extent'];
  const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

  /** the full geometry with every region's start, from the few numbers that define it */
  F.geometry = function (o) {
    if (o && o.ibmStart !== undefined && o.grp) return o;          // already a geometry
    const g = Object.assign({ bs: 256, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, jblocks: 0, alloc: 'indexed', levels: 3, groups: 1 }, o || {});
    if (![2, 4, 8].includes(g.ps)) throw new Error('pointer size must be 2, 4 or 8 bytes');
    if (g.bs < 64 || pow2(g.bs) !== g.bs) throw new Error('block size must be a power of two, at least 64');
    if (!F.ALLOCS.includes(g.alloc)) throw new Error('allocation method must be one of ' + F.ALLOCS.join(', '));
    if (!(g.levels >= 0 && g.levels <= 3)) throw new Error('levels of indirection must be 0 to 3');
    g.allocCode = F.ALLOCS.indexOf(g.alloc);
    g.isz = g.isz || Math.max(32, pow2(16 + (g.ndirect + 3) * g.ps));
    if (g.isz > g.bs) throw new Error('an inode of ' + g.isz + ' bytes does not fit a block of ' + g.bs);
    if (16 + (g.ndirect + 3) * g.ps > g.isz) throw new Error('the inode is too small for its pointers');
    g.P = g.bs / g.ps;                                        // pointers per indirect block
    g.fat = g.alloc === 'fat';
    if (g.jblocks && g.jblocks < 4) throw new Error('a journal needs at least 4 blocks');
    const bits = g.bs * 8;
    if (g.groups <= 1) {
      g.groups = 1;
      g.ibmStart = 1; g.ibmBlocks = Math.ceil(g.ninodes / bits);
      g.dbmStart = g.ibmStart + g.ibmBlocks;
      g.itBlocks = Math.ceil((g.ninodes * g.isz) / g.bs);
      // the data bitmap (or FAT) must cover the data region, whose size depends on it: settle it
      let dbm = 1;
      for (;;) {
        g.itStart = g.dbmStart + dbm; g.jStart = g.itStart + g.itBlocks; g.dataStart = g.jStart + g.jblocks; g.ndata = g.nblocks - g.dataStart;
        const need = g.fat ? Math.ceil((g.ndata * g.ps) / g.bs) : Math.ceil(g.ndata / bits);
        if (need <= dbm) break;
        dbm++;
      }
      g.dbmBlocks = dbm;
      g.ipg = g.ninodes;
      g.grp = [{ i: 0, ibm: g.ibmStart, dbm: g.dbmStart, it: g.itStart, itBlocks: g.itBlocks, data: g.dataStart, ndata: g.ndata, ino0: 0, nino: g.ninodes }];
    } else {
      if (g.fat) throw new Error('a FAT file system has one table, not cylinder groups');
      g.jStart = 1;
      const s = 1 + g.jblocks, per = Math.floor((g.nblocks - s) / g.groups);
      g.ipg = Math.ceil(g.ninodes / g.groups);
      const itb = Math.ceil((g.ipg * g.isz) / g.bs);
      g.grp = [];
      for (let i = 0; i < g.groups; i++) {
        const start = s + i * per, size = i === g.groups - 1 ? g.nblocks - start : per, nd = size - 2 - itb;
        if (nd < 2) throw new Error('cylinder groups too small: ' + size + ' blocks each');
        if (nd > bits || g.ipg > bits) throw new Error('a group is bigger than one bitmap block covers');
        g.grp.push({ i, ibm: start, dbm: start + 1, it: start + 2, itBlocks: itb, data: start + 2 + itb, ndata: nd, ino0: i * g.ipg, nino: Math.max(0, Math.min(g.ipg, g.ninodes - i * g.ipg)) });
      }
      const g0 = g.grp[0];
      Object.assign(g, { ibmStart: g0.ibm, ibmBlocks: 1, dbmStart: g0.dbm, dbmBlocks: 1, itStart: g0.it, itBlocks: g0.itBlocks, dataStart: g0.data, ndata: g.grp.reduce((a, x) => a + x.ndata, 0) });
    }
    if (g.ndata < 2) throw new Error('no room for data blocks');
    if (g.ps < 8 && g.nblocks >= 2 ** (8 * g.ps) - 1) throw new Error('pointers of ' + g.ps + ' bytes cannot name ' + g.nblocks + ' blocks');
    g.EOC = 2 ** (8 * g.ps) - 1;                               // end of a FAT chain
    return g;
  };
  /** the bytes of file data a block carries */
  F.payload = (g) => (g.alloc === 'linked' ? g.bs - g.ps : g.bs);
  F.nExtents = (g) => Math.floor((g.ndirect + 3) / 2);

  /** the largest file the structure can describe, in bytes. Indexed: bs·(ndirect + P + P² + P³), fewer levels as set */
  F.maxFileSize = function (g) {
    const alloc = g.alloc || 'indexed', ps = g.ps, cnt = Math.pow(2, 8 * ps) - 1;
    if (alloc === 'indexed') { const P = g.bs / ps, L = g.levels === undefined ? 3 : g.levels; let blocks = g.ndirect; for (let l = 1; l <= L; l++) blocks += Math.pow(P, l); return g.bs * blocks; }
    if (alloc === 'linked') return cnt * (g.bs - ps);
    if (alloc === 'extent') return F.nExtents(g) * cnt * g.bs;
    return cnt * g.bs;
  };
  /** for an indexed inode, what each part maps: [{part, blocks, from, bytes}] in file-block numbers */
  F.reach = function (g) {
    const P = g.bs / g.ps, L = g.levels === undefined ? 3 : g.levels, parts = [['direct', g.ndirect], ['single', P], ['double', P * P], ['triple', P * P * P]].slice(0, L + 1);
    let from = 0;
    return parts.map(([part, blocks]) => { const r = { part, blocks, from, bytes: blocks * g.bs }; from += blocks; return r; });
  };

  // ---- where things are ----
  F.groupOfIno = (g, ino) => Math.min(g.grp.length - 1, Math.floor(ino / g.ipg));
  F.groupOfBlock = (g, b) => { for (let i = g.grp.length - 1; i >= 0; i--) if (b >= g.grp[i].ibm) return i; return 0; };
  F.inodeAt = (g, ino) => { const G = g.grp ? g.grp[F.groupOfIno(g, ino)] : { it: g.itStart, ino0: 0 }, k = ino - G.ino0; return { block: G.it + Math.floor((k * g.isz) / g.bs), off: (k * g.isz) % g.bs }; };
  F.ibmLoc = (g, ino) => { const G = g.grp[F.groupOfIno(g, ino)]; return { block: G.ibm, bit: ino - G.ino0 }; };
  F.isData = (g, b) => { const G = g.grp[F.groupOfBlock(g, b)]; return b >= G.data && b < G.data + G.ndata; };
  F.dbmLoc = (g, b) => { const G = g.grp[F.groupOfBlock(g, b)]; return { block: G.dbm, bit: b - G.data }; };
  /** the FAT entry of data block b */
  F.fatLoc = (g, b) => { const j = b - g.dataStart, off = j * g.ps; return { block: g.dbmStart + Math.floor(off / g.bs), off: off % g.bs }; };
  F.dataBlocks = (g) => { if (!g._data) { g._data = []; for (const G of g.grp) for (let j = 0; j < G.ndata; j++) g._data.push(G.data + j); } return g._data; };

  /** which region of the layout a block is in: 'super' | 'ibm' | 'dbm' | 'fat' | 'itable' | 'journal' | 'data' */
  F.region = function (g, b) {
    if (b === 0) return 'super';
    if (g.jblocks && b >= g.jStart && b < g.jStart + g.jblocks) return 'journal';
    const G = g.grp ? g.grp[F.groupOfBlock(g, b)] : null;
    if (!G) { if (b < g.dbmStart) return 'ibm'; if (b < g.itStart) return g.fat ? 'fat' : 'dbm'; if (b < g.jStart) return 'itable'; return 'data'; }
    if (b < G.dbm) return 'ibm';
    if (b < G.it) return g.fat ? 'fat' : 'dbm';
    if (b < G.data) return 'itable';
    return 'data';
  };
  /** the layout as a list of regions [{region, start, count, group}] in disk order */
  F.layout = function (g) {
    const out = [{ region: 'super', start: 0, count: 1 }];
    if (g.groups === 1) {
      out.push({ region: 'ibm', start: g.ibmStart, count: g.ibmBlocks }, { region: g.fat ? 'fat' : 'dbm', start: g.dbmStart, count: g.dbmBlocks }, { region: 'itable', start: g.itStart, count: g.itBlocks });
      if (g.jblocks) out.push({ region: 'journal', start: g.jStart, count: g.jblocks });
      out.push({ region: 'data', start: g.dataStart, count: g.ndata });
      return out;
    }
    if (g.jblocks) out.push({ region: 'journal', start: g.jStart, count: g.jblocks });
    for (const G of g.grp) out.push({ region: 'ibm', start: G.ibm, count: 1, group: G.i }, { region: 'dbm', start: G.dbm, count: 1, group: G.i }, { region: 'itable', start: G.it, count: G.itBlocks, group: G.i }, { region: 'data', start: G.data, count: G.ndata, group: G.i });
    return out;
  };

  // ---- little-endian fields in a block buffer ----
  F.get16 = (u, o) => u[o] | (u[o + 1] << 8);
  F.put16 = (u, o, v) => { u[o] = v & 255; u[o + 1] = (v >>> 8) & 255; };
  F.get32 = (u, o) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
  F.put32 = (u, o, v) => { u[o] = v & 255; u[o + 1] = (v >>> 8) & 255; u[o + 2] = (v >>> 16) & 255; u[o + 3] = (v >>> 24) & 255; };
  F.getPtr = (u, o, ps) => (ps === 2 ? F.get16(u, o) : ps === 4 ? F.get32(u, o) : F.get32(u, o) + F.get32(u, o + 4) * 4294967296);
  F.putPtr = (u, o, ps, v) => { if (ps === 2) F.put16(u, o, v); else if (ps === 4) F.put32(u, o, v); else { F.put32(u, o, v % 4294967296); F.put32(u, o + 4, Math.floor(v / 4294967296)); } };
  F.getBit = (u, i) => (u[i >> 3] >> (i & 7)) & 1;
  F.setBit = (u, i, on) => { if (on) u[i >> 3] |= 1 << (i & 7); else u[i >> 3] &= ~(1 << (i & 7)) & 255; };

  /** a fresh image object around a byte array */
  F.image = function (g, bytes) { return { g, bytes: bytes || new Uint8Array(g.nblocks * g.bs) }; };
  /** a copy of the disk (what survives a crash: in-memory state such as the open-file count is not copied) */
  F.clone = (img) => F.image(img.g, img.bytes.slice());
  /** a view of one block of the image (writes through) */
  F.block = (img, b) => img.bytes.subarray(b * img.g.bs, (b + 1) * img.g.bs);

  // ---- inodes ----
  F.decodeInode = function (g, u, off) {
    const n = { type: F.get16(u, off), nlink: F.get16(u, off + 2), mode: F.get16(u, off + 4), uid: u[off + 6], gid: u[off + 7], size: F.get32(u, off + 8) + F.get32(u, off + 12) * 4294967296, direct: [], single: 0, double: 0, triple: 0 };
    let p = off + 16;
    for (let i = 0; i < g.ndirect; i++, p += g.ps) n.direct.push(F.getPtr(u, p, g.ps));
    n.single = F.getPtr(u, p, g.ps); n.double = F.getPtr(u, p + g.ps, g.ps); n.triple = F.getPtr(u, p + 2 * g.ps, g.ps);
    return n;
  };
  F.encodeInode = function (g, u, off, n) {
    u.fill(0, off, off + g.isz);
    F.put16(u, off, n.type); F.put16(u, off + 2, n.nlink); F.put16(u, off + 4, n.mode || 0); u[off + 6] = n.uid || 0; u[off + 7] = n.gid || 0;
    F.put32(u, off + 8, n.size % 4294967296); F.put32(u, off + 12, Math.floor(n.size / 4294967296));
    let p = off + 16;
    for (let i = 0; i < g.ndirect; i++, p += g.ps) F.putPtr(u, p, g.ps, n.direct[i] || 0);
    F.putPtr(u, p, g.ps, n.single || 0); F.putPtr(u, p + g.ps, g.ps, n.double || 0); F.putPtr(u, p + 2 * g.ps, g.ps, n.triple || 0);
  };
  F.emptyInode = (g, type, mode, uid, gid) => ({ type, nlink: 0, mode: mode === undefined ? (type === F.T_DIR ? 0o755 : type === F.T_LINK ? 0o777 : type ? 0o644 : 0) : mode, uid: uid || 0, gid: gid || 0, size: 0, direct: new Array(g.ndirect).fill(0), single: 0, double: 0, triple: 0 });
  /** pointer slot i of an inode, counting the direct slots and then single, double, triple (the raw slots) */
  F.slot = (g, n, i) => (i < g.ndirect ? n.direct[i] : n[['single', 'double', 'triple'][i - g.ndirect]]);
  F.setSlot = (g, n, i, v) => { if (i < g.ndirect) n.direct[i] = v; else n[['single', 'double', 'triple'][i - g.ndirect]] = v; };
  /** read inode ino straight from an image */
  F.readInode = (img, ino) => { const a = F.inodeAt(img.g, ino); return F.decodeInode(img.g, (F.readBlock || F.block)(img, a.block), a.off); };
  /** 'rwxr-xr--' for a mode */
  F.modeString = (m) => [8, 7, 6, 5, 4, 3, 2, 1, 0].map((b, i) => ((m >> b) & 1 ? 'rwx'[i % 3] : '-')).join('');

  // ---- the superblock ----
  const SB_FIELDS = ['bs', 'nblocks', 'ninodes', 'isz', 'ndirect', 'ps', 'jblocks', 'ibmStart', 'dbmStart', 'itStart', 'jStart', 'dataStart', 'allocCode', 'levels', 'groups'];
  F.encodeSuper = function (g, u) { u.fill(0); F.put32(u, 0, F.MAGIC); SB_FIELDS.forEach((k, i) => F.put32(u, 4 + 4 * i, g[k])); };
  F.decodeSuper = function (u) { const s = { magic: F.get32(u, 0) }; SB_FIELDS.forEach((k, i) => { s[k] = F.get32(u, 4 + 4 * i); }); return s; };
  F.SB_FIELDS = SB_FIELDS;

  // ---- directory entries ----
  F.decodeDirent = function (u, off) {
    const ino = F.get32(u, off);
    let name = '';
    for (let i = 4; i < F.DIRENT && u[off + i]; i++) name += String.fromCharCode(u[off + i]);
    return { ino, name };
  };
  F.encodeDirent = function (u, off, ino, name) {
    u.fill(0, off, off + F.DIRENT);
    F.put32(u, off, ino);
    for (let i = 0; i < name.length; i++) u[off + 4 + i] = name.charCodeAt(i) & 255;
  };

  // ---- checksums: CRC-32 (the reflected 0xEDB88320 polynomial) ----
  let TABLE = null;
  F.crc32 = function (u) {
    if (!TABLE) { TABLE = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[i] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < u.length; i++) c = TABLE[(c ^ u[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})(globalThis.Proses = globalThis.Proses || {});
