// The file-system interface: permission bits checked for a uid and gid, symbolic links (resolution, dangling,
// loops), hard links and link counts, rename, truncate, rmdir; the open-file layer (descriptor tables, the open-file
// table and the inode table; fork and dup sharing an offset; append; unlink of an open file; mounts); the cost of
// each operation with and without a buffer cache, worked by hand; the buffer cache's LRU, write-back and
// write-through, sync interval and split caches; cylinder-group placement and seek distance; access methods.
import { load, harness } from './load.mjs';

const t = harness('fs-api');
const S = load(['core']);
const F = S.FS;
const GEO = { bs: 256, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4 };
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code || e.message; } };

// ---- permissions ----
{
  const img = F.mkfs(GEO), ana = { uid: 5, gid: 5 }, ben = { uid: 6, gid: 5 }, eve = { uid: 7, gid: 9 };
  F.apply(img, 'mkdir', ['/shared'], {});
  F.apply(img, 'chown', ['/shared', 5, 5]);
  F.apply(img, 'chmod', ['/shared', 0o750]);
  F.apply(img, 'create', ['/shared/plan', 0o640], { cred: ana });
  t.eq(F.stat(img, '/shared/plan').uid, 5, 'a new file belongs to its creator');
  t.eq(F.stat(img, '/shared/plan').perms, 'rw-r-----', 'mode 640');
  F.apply(img, 'write', ['/shared/plan', 0, 'meet at noon'], { cred: ana });
  t.eq(code(() => F.apply(img, 'write', ['/shared/plan', 0, 'x'], { cred: ben })), 'EACCES', 'group may not write a 640 file');
  t.eq(F.text(F.read(img, '/shared/plan', 0, 4, { cred: ben })), 'meet', 'group may read it');
  t.eq(code(() => F.read(img, '/shared/plan', 0, 4, { cred: eve })), 'EACCES', 'others may not even search the 750 directory');
  t.eq(code(() => F.apply(img, 'create', ['/shared/b'], { cred: ben })), 'EACCES', 'group has no write permission on the directory');
  t.eq(code(() => F.apply(img, 'chmod', ['/shared/plan', 0o666], { cred: ben })), 'EPERM', 'only the owner changes the mode');
  F.apply(img, 'chmod', ['/shared', 0o770], { cred: ana });
  t.eq(code(() => F.apply(img, 'create', ['/shared/b'], { cred: ben })), 'ok', 'after chmod 770 the group may create');
  t.eq(code(() => F.apply(img, 'unlink', ['/shared/plan'], { cred: eve })), 'EACCES', 'others may not unlink');
  t.ok(F.can({ mode: 0o604, uid: 1, gid: 1 }, { uid: 1, gid: 1 }, 4) && !F.can({ mode: 0o004, uid: 1, gid: 1 }, { uid: 1, gid: 1 }, 4), 'the owner class applies even when it is stricter than others');
  t.ok(F.can({ mode: 0, uid: 1, gid: 1 }, { uid: 0, gid: 0 }, 7), 'root may do all');
  t.ok(F.fsck(img).ok, 'consistent after the permission tests');
}
// ---- symbolic links ----
{
  const img = F.mkfs(GEO);
  for (const [op, ...a] of [['mkdir', '/etc'], ['create', '/etc/hosts'], ['write', '/etc/hosts', 0, 'loopback'], ['symlink', '/etc/hosts', '/h'], ['symlink', 'hosts', '/etc/rel'], ['symlink', '/nowhere', '/dangle'], ['symlink', '/loop2', '/loop1'], ['symlink', '/loop1', '/loop2'], ['symlink', '/etc', '/e']]) F.apply(img, op, a);
  t.eq(F.text(F.read(img, '/h')), 'loopback', 'an absolute link is followed');
  t.eq(F.text(F.read(img, '/etc/rel')), 'loopback', 'a relative link is followed from its own directory');
  t.eq(F.text(F.read(img, '/e/hosts')), 'loopback', 'a link in the middle of a path is followed');
  t.eq(F.readlink(img, '/h'), '/etc/hosts', 'readlink gives the text');
  t.eq(F.lookup(img, '/dangle', { quiet: true }).ino, 0, 'a dangling link leads nowhere');
  t.eq(code(() => F.lookup(img, '/loop1')), 'ELOOP', 'a loop of links is caught');
  const L = F.lookup(img, '/e/hosts');
  t.ok(L.steps.some((s) => s.kind === 'lookup-link' && s.target === '/etc'), 'the lookup trace shows the link');
  t.eq(F.stat(img, '/h', { nofollow: true }).type, 'symlink', 'lstat sees the link itself');
  t.eq(F.stat(img, '/etc/hosts').nlink, 1, 'symbolic links do not count as links');
  F.apply(img, 'unlink', ['/etc/hosts']);
  t.eq(F.lookup(img, '/h', { quiet: true }).ino, 0, 'removing the target leaves the link dangling');
  t.ok(F.fsck(img).ok, 'consistent with dangling links');
}
// ---- hard links, rename, truncate, rmdir ----
{
  const img = F.mkfs(GEO);
  for (const [op, ...a] of [['mkdir', '/a'], ['mkdir', '/b'], ['create', '/a/f'], ['write', '/a/f', 0, 'abcdefghij'], ['link', '/a/f', '/b/g']]) F.apply(img, op, a);
  t.eq(F.stat(img, '/a/f').nlink, 2, 'two names, link count 2');
  t.eq(F.stat(img, '/a/f').ino, F.stat(img, '/b/g').ino, 'one inode');
  t.eq(code(() => F.apply(img, 'link', ['/a', '/c'])), 'EPERM', 'no hard links to directories: EPERM');
  t.eq(code(() => new F.Sys(img).op(1, 'link', '/a', '/c')), 'EPERM', 'the same through the open-file layer');
  t.eq(code(() => F.apply(img, 'rmdir', ['/a'])), 'ENOTEMPTY', 'rmdir refuses a directory that is not empty');
  F.apply(img, 'unlink', ['/a/f']);
  t.eq(F.text(F.read(img, '/b/g')), 'abcdefghij', 'the other name keeps the data');
  t.eq(F.stat(img, '/b/g').nlink, 1, 'link count 1');
  F.apply(img, 'rename', ['/b', '/a/b']);
  t.eq([F.stat(img, '/a').nlink, F.stat(img, '/').nlink], [3, 3], "moving a directory moves its '..' link: /a gains one, / keeps /a's");
  t.eq(F.lookup(img, '/a/b/..', { quiet: true }).ino, F.stat(img, '/a').ino, "the moved directory's '..' names its new parent");
  t.eq(code(() => F.apply(img, 'rename', ['/a', '/a/b/c'])), 'EINVAL', 'a directory may not move inside itself');
  F.apply(img, 'create', ['/x']); F.apply(img, 'write', ['/x', 0, 'old']);
  F.apply(img, 'rename', ['/a/b/g', '/x']);
  t.eq(F.text(F.read(img, '/x')), 'abcdefghij', 'rename over a file replaces it');
  F.apply(img, 'truncate', ['/x', 3]);
  F.apply(img, 'truncate', ['/x', 6]);
  t.eq(F.text(F.read(img, '/x')), 'abc\0\0\0', 'shrink then grow: the regrown bytes are zeros');
  F.apply(img, 'write', ['/x', 600, 'Z']);
  t.eq(F.stat(img, '/x').dataBlocks.length, 2, 'a write past the end leaves a hole (no block for file block 1)');
  t.ok(F.fsck(img).ok, 'consistent');
  F.apply(img, 'rmdir', ['/a/b']);
  t.ok(F.fsck(img).ok && F.stat(img, '/a').nlink === 2, 'rmdir of an empty directory');
}

// ---- the open-file layer ----
{
  const img = F.mkfs(GEO), sys = new F.Sys(img);
  sys.proc(10, { uid: 0, gid: 0 });
  const fd = sys.open(10, '/log', 'rwc').result;
  t.eq(fd, 0, 'the lowest free descriptor');
  sys.write(10, fd, 'abcdefghi');
  sys.lseek(10, fd, 0, 'set');
  sys.fork(10, 11);
  t.eq(sys.read(10, fd, 3).result, 'abc', 'the parent reads abc');
  t.eq(sys.read(11, fd, 3).result, 'def', 'the child continues from the shared offset');
  t.eq(sys.read(10, fd, 3).result, 'ghi', 'and so does the parent');
  const snap = sys.snapshot();
  t.eq(snap.files.length, 1, 'one open-file entry');
  t.eq(snap.files[0].refs, 2, 'two descriptors (parent and child) share it');
  t.eq(snap.inodes[0].refs, 1, 'one open reference to the inode');
  const fd2 = sys.open(11, '/log', 'r').result;
  t.eq(sys.read(11, fd2, 2).result, 'ab', 'a second open has its own offset');
  t.eq(sys.snapshot().inodes[0].refs, 2, 'the inode now has two open-file entries');
  const d = sys.dup(11, fd2).result;
  t.eq(sys.read(11, d, 2).result, 'cd', 'dup shares the offset');
  const a = sys.open(10, '/log', 'a').result;
  sys.write(10, a, 'XY');
  t.eq(F.text(F.read(img, '/log')), 'abcdefghiXY', 'append writes at the end');
  // unlink while open: the data stays until the last close
  sys.op(10, 'unlink', '/log');
  t.eq(F.lookup(img, '/log', { quiet: true }).ino, 0, 'the name is gone');
  t.ok(F.orphans(img).length === 1 && F.fsck(img).ok, 'the inode waits on the orphan list, and fsck accepts it');
  sys.lseek(10, fd, 0, 'set');
  t.eq(sys.read(10, fd, 5).result, 'abcde', 'an open descriptor still reads the unlinked file');
  const ino = F.orphans(img)[0], blocks = F.stat(img, ino).dataBlocks;
  for (const [p, f] of [[10, fd], [11, fd], [11, fd2], [11, d], [10, a]]) sys.close(p, f);
  t.eq(F.orphans(img), [], 'the last close frees it');
  t.ok(F.fsck(img).ok && blocks.every((b) => F.isFreeBlock(new F.Tx(img), b)), 'and its blocks');
  // a crash while an unlinked file is open: recovery frees it
  const img2 = F.mkfs(Object.assign({}, GEO, { jblocks: 12 })), s2 = new F.Sys(img2, { mode: 'ordered' });
  const f3 = s2.open(1, '/tmp', 'wc').result; s2.write(1, f3, 'scratch'); s2.op(1, 'unlink', '/tmp');
  s2.crash();
  const rec = s2.recover();
  t.ok(rec.steps.some((s) => s.kind === 'orphans') && rec.fsck.every((r) => r.ok) && !F.orphans(img2).length, 'after a crash the orphan is freed and fsck is clean');
  // mounts
  const root = F.mkfs(GEO), usb = F.mkfs(GEO), s3 = new F.Sys(root);
  s3.op(1, 'mkdir', '/mnt'); s3.op(1, 'create', '/home'); s3.mount('/mnt', usb);
  s3.op(1, 'create', '/mnt/photo');
  t.ok(F.lookup(usb, '/photo', { quiet: true }).ino > 0 && !F.lookup(root, '/mnt/photo', { quiet: true }).ino, 'a file made under the mount point lands on the mounted disk');
  t.eq(code(() => s3.op(1, 'rename', '/home', '/mnt/home')), 'EXDEV', 'rename across file systems fails');
  t.eq(code(() => s3.op(1, 'link', '/mnt/photo', '/p')), 'EXDEV', 'so does a hard link');
  t.eq(code(() => s3.op(1, 'symlink', '/mnt/photo', '/p')), 'ok', 'a symbolic link may point anywhere');
  const pf = s3.open(1, '/mnt/photo', 'r').result;
  t.eq(code(() => s3.umount('/mnt')), 'EBUSY', 'cannot unmount with a file open');
  s3.close(1, pf); s3.umount('/mnt');
  t.eq(s3.stat(1, '/mnt').result.dev, 0, 'after umount /mnt is the root disk again');
  // permission at open
  const s4 = new F.Sys(F.mkfs(GEO));
  s4.op(1, 'create', '/secret'); s4.op(1, 'chmod', '/secret', 0o600); s4.proc(20, { uid: 20, gid: 20 });
  t.eq(code(() => s4.open(20, '/secret', 'r')), 'EACCES', 'open checks the permission bits');
  t.eq(code(() => s4.read(20, 7, 1)), 'EBADF', 'a descriptor that is not open');
}

// ---- costs by hand ----
// bs 256, 4 inodes a block: the root, /docs and /docs/report (inodes 1, 2, 3) share inode-table block 3; the root
// directory is block 7 and /docs's is block 8.
{
  const rows = F.costs(GEO);
  const r = Object.fromEntries(rows.map((x) => [x.op, x]));
  t.eq([r.open.reads, r.open.writes], [3, 0], 'open /docs/report: inode block 3, root directory 7, /docs directory 8; nothing written');
  t.eq([r.create.reads, r.create.writes], [4, 3], 'create: reads blocks 3, 7, 8 and the inode bitmap; writes the inode block, the inode bitmap and the directory block');
  t.eq(r.write.writes, 5, 'write 522 bytes: the inode, the data bitmap and three data blocks');
  t.eq(r.read.reads, 4, 'read: the inode block and three data blocks');
  t.eq([r.close.reads, r.close.writes], [0, 0], 'close costs nothing');
  const c = Object.fromEntries(F.costs(GEO, { cache: { capacity: 16, policy: 'write-back' } }).map((x) => [x.op, x]));
  t.eq([c.open.reads, c.read.reads], [0, 0], 'with a cache, open and read find every block already cached');
  t.ok(c.write.writes === 0 && c.sync.writes > 0, 'write-back: the write costs nothing until sync');
  const wt = Object.fromEntries(F.costs(GEO, { cache: { capacity: 16, policy: 'write-through' } }).map((x) => [x.op, x]));
  t.eq(wt.write.writes, 5, 'write-through: every block is written at once');
  const total = (rs) => rs.reduce((a, x) => a + x.reads + x.writes, 0);
  t.ok(total(F.costs(GEO, { cache: { capacity: 16 } })) < total(F.costs(GEO)), 'the cache cuts the total I/O');
}
// ---- the buffer cache itself ----
{
  const c = new F.Cache({ capacity: 3, policy: 'write-back' }), written = [];
  c.onWrite = (k) => written.push(k);
  for (const k of [1, 2, 3]) c.read(k);
  c.read(1);                                  // 1 is now the most recent
  c.write(2);                                 // 2 dirty, most recent
  c.read(4);                                  // evicts 3 (the least recently used)
  t.eq(c.snapshot().map((x) => x.key), [1, 2, 4], 'LRU order after the eviction of 3');
  c.read(5);                                  // evicts 1
  c.read(6);                                  // evicts 2, which is dirty: written
  t.eq(written, [2], 'a dirty block is written when evicted');
  t.eq([c.stats.hits, c.stats.misses], [1, 6], 'one hit, six misses');
  const d = new F.Cache({ capacity: 4, policy: 'write-back', sync: 5 });
  d.write('a'); d.write('b');
  t.eq(d.tick(4), [], 'no flush before the sync interval');
  t.eq(d.tick(1).sort(), ['a', 'b'], 'the sync interval flushes every dirty block');
  const u = new F.Cache({ capacity: 4, unified: true }), sp = new F.Cache({ capacity: 4, unified: false });
  for (const k of [1, 2, 3, 4]) { u.read(k, 'data'); sp.read(k, 'data'); }
  t.eq([u.lru.size, sp.stats.copies], [4, 4], 'unified: 4 distinct blocks; split: each data block held twice');
  t.ok(sp.snapshot().filter((x) => x.pool === 'data').length === 2, 'split: only two data blocks fit in the page cache half');
  // write-back caching and a crash: the data never reaches the disk
  const img = F.mkfs(GEO), sys = new F.Sys(img, { cache: { capacity: 32, policy: 'write-back' } });
  const fd = sys.open(1, '/w', 'wc').result; sys.write(1, fd, 'unsaved'); sys.close(1, fd);
  const lost = sys.crash().lost;
  t.ok(lost.length > 0 && !F.lookup(img, '/w', { quiet: true }).ino && F.fsck(img).ok, 'write-back: a crash loses the cached changes, and the disk still holds the old consistent state');
}

// ---- cylinder groups ----
{
  const g = { bs: 256, nblocks: 200, ninodes: 32, ndirect: 4, ps: 4, groups: 4 }, img = F.mkfs(g);
  t.eq(img.g.grp.length, 4, 'four cylinder groups');
  t.ok(F.fsck(img).ok, 'consistent');
  for (const d of ['/a', '/b', '/c']) F.apply(img, 'mkdir', [d]);
  const grpOf = (p) => F.groupOfIno(img.g, F.stat(img, p).ino);
  t.ok(new Set(['/a', '/b', '/c'].map(grpOf)).size === 3, 'new directories are spread over groups with free inodes');
  F.apply(img, 'create', ['/b/f']); F.apply(img, 'write', ['/b/f', 0, 'f'.repeat(1000)]);
  t.eq(grpOf('/b/f'), grpOf('/b'), "a file's inode goes in its directory's group");
  const fb = F.stat(img, '/b/f').dataBlocks;
  t.ok(fb.every((b) => F.groupOfBlock(img.g, b) === grpOf('/b')), "and its blocks near its inode");
  F.apply(img, 'create', ['/b/big']); F.apply(img, 'write', ['/b/big', 0, 'B'.repeat(256 * img.g.chunk * 2 + 10)]);
  t.ok(new Set(F.stat(img, '/b/big').dataBlocks.map((b) => F.groupOfBlock(img.g, b))).size > 1, `a large file moves to another group every ${img.g.chunk} blocks`);
  t.ok(F.fsck(img).ok, 'consistent with groups');
  // the seek distance of reading a directory and its files: groups against one region
  const travel = (geo) => {
    const m = F.mkfs(geo), names = [];
    for (let i = 0; i < 4; i++) { F.apply(m, 'mkdir', ['/d' + i]); for (let j = 0; j < 3; j++) { const n = `/d${i}/f${j}`; F.apply(m, 'create', [n]); F.apply(m, 'write', [n, 0, 'x'.repeat(300)]); names.push(n); } }
    const sys = new F.Sys(m, { cache: { capacity: 6, policy: 'write-through' } });
    for (const n of names.filter((x) => x.startsWith('/d2'))) { const fd = sys.open(1, n, 'r').result; sys.read(1, fd, 300); sys.close(1, fd); }
    return F.seekDistance(sys.disk).total;
  };
  const one = travel({ bs: 256, nblocks: 200, ninodes: 32, ndirect: 4, ps: 4 }), four = travel(g);
  t.ok(four < one, `reading one directory's files: ${four} blocks of head travel with groups, ${one} without`);
  const dt = F.diskTime([0, 16, 32]);
  t.ok(dt.model === 'storage' && dt.items.length === 3 && dt.ms > 0, `disk time through the storage engine's disk model: ${dt.ms} ms`);
  const near = F.diskTime([100, 101, 102, 103], { bs: 512 }), far = F.diskTime([100, 9000, 200, 8000], { bs: 512 });
  t.ok(far.ms > near.ms, `far-apart blocks take longer (${far.ms} ms) than neighbours (${near.ms} ms)`);
  const saved = S.Storage; S.Storage = undefined;
  const sd = F.diskTime([0, 16, 32]);
  S.Storage = saved;
  t.eq([sd.model, +sd.ms.toFixed(2)], ['stand-in', +(3 * 4.22 + 2 * 1.02).toFixed(2)], 'without the disk model, the stand-in: two one-cylinder seeks and three half turns');
}
// ---- structured repair steps ----
{
  const img = F.mkfs(GEO);
  for (const [op, ...a] of [['mkdir', '/d'], ['create', '/d/f'], ['create', '/d/g'], ['write', '/d/g', 0, 'x']]) F.apply(img, op, a);
  const g = img.g, f = F.stat(img, '/d/f').ino, d = F.stat(img, '/d').ino, a = F.inodeAt(g, f);
  F.block(img, a.block).fill(0, a.off, a.off + g.isz);                      // inode of /d/f wiped: its entry dangles
  const gb = F.stat(img, '/d/g').dataBlocks[0];
  F.setBit(F.block(img, g.dbmStart), gb - g.dataStart, 0);                  // /d/g's block marked free
  const fixes = F.repair(img), st = fixes.steps;
  t.eq(st.length, fixes.length, 'one structured step per fix sentence');
  t.eq(st.filter((x) => x.kind === 'remove-entry').map((x) => [x.entry, x.ino, x.dir]), [['f', f, d]], 'remove-entry: entry f, naming inode ' + f + ', from directory inode ' + d);
  t.eq(st.filter((x) => x.kind === 'set-nlink').map((x) => [x.ino, x.from, x.nlink]), [], 'no link count needed fixing');
  t.ok(st.some((x) => x.kind === 'mark-block' && x.block === gb && x.used === true && x.map === 'bitmap'), 'mark-block: block ' + gb + ' marked used in the bitmap');
  t.ok(st.some((x) => x.kind === 'mark-inode' && x.ino === f && x.used === false), 'mark-inode: inode ' + f + ' cleared');
  t.ok(F.fsck(img).ok, 'repaired');
}
{
  const sys = new F.Sys(F.mkfs(GEO), { cache: { capacity: 8, policy: 'write-back' } }), fd = sys.open(1, '/w', 'wc').result;
  const st = sys.write(1, fd, 'abc').steps.find((x) => x.kind === 'write-fd');
  t.ok(st.buffered.length > 0 && st.buffered.every((k) => /^0:\d+$/.test(k)), 'write-fd lists the dirty cached blocks: ' + st.buffered.join(' '));
  const s2 = new F.Sys(F.mkfs(GEO)), fd2 = s2.open(1, '/w', 'wc').result;
  t.eq(s2.write(1, fd2, 'abc').steps.find((x) => x.kind === 'write-fd').buffered, [], 'no cache: an empty buffered list');
  const L = F.lfs, fs = L.mkfs({ bs: 128, segBlocks: 32, nsegs: 6, ninodes: 16 });
  L.create(fs, 'x');
  const b = L.write(fs, 'x', 0, 'y'.repeat(200)).steps.filter((x) => x.kind === 'buffer');
  t.eq(b[b.length - 1].buffered.filter((x) => x.ino === 2).map((x) => x.fb), [0, 1], 'lfs buffer step: blocks 0 and 1 of inode 2 wait in the buffer');
}
// ---- the FAT, as a table ----
{
  const img = F.mkfs(Object.assign({}, GEO, { alloc: 'fat' }));
  F.apply(img, 'create', ['/a']); F.apply(img, 'write', ['/a', 0, 'a'.repeat(600)]);
  const tab = F.fatTable(img), chain = F.stat(img, '/a').dataBlocks;
  t.eq(chain.map((b) => tab.find((x) => x.block === b).next), chain.slice(1).concat([-1]), "the FAT entries chain the file's blocks and end it");
  t.ok(tab.filter((x) => x.state !== 'free').every((x) => x.owner), 'every used entry belongs to a file');
}
// ---- access methods ----
{
  for (const alloc of ['indexed', 'linked', 'contiguous']) {
    const img = F.mkfs(Object.assign({}, GEO, { alloc, nblocks: 96 }));
    F.apply(img, 'create', ['/rec']); F.apply(img, 'write', ['/rec', 0, 'r'.repeat(256 * 12)]);
    const sq = F.accessCost(img, '/rec', 'sequential'), dr = F.accessCost(img, '/rec', 'direct', { seed: 3 });
    if (alloc === 'linked') t.ok(dr.reads > sq.reads, `linked: direct access reads ${dr.reads} blocks, sequential ${sq.reads}`);
    else t.eq(dr.reads, sq.reads, `${alloc}: direct access reads as many blocks as sequential (${sq.reads})`);
    t.ok(dr.distance >= sq.distance, `${alloc}: direct access travels further (${dr.distance} against ${sq.distance})`);
    if (alloc === 'contiguous') t.eq(sq.reads, 13, 'contiguous: the inode block once, then one read per record');
    if (alloc === 'indexed') t.eq(sq.reads, 14, 'indexed: the inode, the single-indirect block once, then 12 records');
  }
}
t.done();
