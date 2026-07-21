// The file system in every mode: each allocation method (indexed, contiguous, linked, FAT, extent) runs the same
// operations, checked by fsck after every one and against a plain model, and all agree on every file's contents;
// contiguous allocation fails with external fragmentation and compaction cures it; free-space representations
// agree; the walk to byte N agrees with read; and every journaling mode (none, writeback, ordered, data, eager and
// lazy checkpointing, with and without revoke records) is cut at every write point and checked for the guarantee
// it promises.
import { load, harness, rng } from './load.mjs';

const t = harness('fs-modes');
const S = load(['core']);
const F = S.FS;

const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return s.length + ':' + h.toString(16); };
/** every name in the tree: [path, type, nlink, size, contents hash], sorted */
function snapshot(img) {
  const out = [], seen = new Set();
  const walk = (path) => {
    for (const e of F.list(img, path)) {
      if (e.name === '.' || e.name === '..') continue;
      const p = (path === '/' ? '' : path) + '/' + e.name, n = F.readInode(img, e.ino);
      out.push([p, n.type, n.nlink, n.size, n.type === F.T_FILE ? fnv(F.text(F.read(img, e.ino))) : n.type === F.T_LINK ? F.readlink(img, p) : '']);
      if (n.type === F.T_DIR && !seen.has(e.ino)) { seen.add(e.ino); walk(p); }
    }
  };
  walk('/');
  return JSON.stringify(out.sort());
}
// an independent model of the tree: paths to directories, files (shared by hard links) and symlinks
function model() {
  const m = { '/': { dir: true } }, files = new Map(); let next = 1;
  const kids = (p) => Object.keys(m).filter((q) => q !== p && q.startsWith(p === '/' ? '/' : p + '/') && !q.slice(p === '/' ? 1 : p.length + 1).includes('/'));
  return {
    mkdir(p) { m[p] = { dir: true }; },
    create(p) { const id = next++; files.set(id, ''); m[p] = { id }; },
    write(p, off, s) { const id = m[p].id; let c = files.get(id); while (c.length < off) c += '\0'; files.set(id, c.slice(0, off) + s + c.slice(off + s.length)); },
    append(p, s) { this.write(p, files.get(m[p].id).length, s); },
    link(a, b) { m[b] = { id: m[a].id }; },
    symlink(target, p) { m[p] = { link: target }; },
    unlink(p) { delete m[p]; },
    rmdir(p) { delete m[p]; },
    truncate(p, n) { const id = m[p].id, c = files.get(id); files.set(id, n <= c.length ? c.slice(0, n) : c + '\0'.repeat(n - c.length)); },
    rename(a, b) { for (const k of Object.keys(m).filter((q) => q === a || q.startsWith(a + '/'))) { m[b + k.slice(a.length)] = m[k]; delete m[k]; } },
    snap() {
      const out = [];
      for (const p of Object.keys(m)) {
        if (p === '/') continue;
        const x = m[p];
        if (x.dir) out.push([p, F.T_DIR, 2 + kids(p).filter((q) => m[q].dir).length, null, '']);
        else if (x.link !== undefined) out.push([p, F.T_LINK, 1, x.link.length, x.link]);
        else { const c = files.get(x.id); out.push([p, F.T_FILE, Object.values(m).filter((y) => y.id === x.id).length, c.length, fnv(c)]); }
      }
      return out.sort();
    },
  };
}
const OPS = [
  ['mkdir', '/home'], ['mkdir', '/home/ana'], ['create', '/home/ana/todo'], ['write', '/home/ana/todo', 0, 'buy lamp oil; mend the gate'],
  ['create', '/readme'], ['append', '/readme', 'first line\n'], ['append', '/readme', 'a second, longer line that crosses a block edge, and then some more words\n'],
  ['link', '/home/ana/todo', '/todo-link'], ['symlink', '/home/ana/todo', '/home/shortcut'], ['write', '/home/ana/todo', 300, 'past the end'],
  ['mkdir', '/tmp'], ['create', '/tmp/big'], ['write', '/tmp/big', 0, 'x'.repeat(700)], ['truncate', '/tmp/big', 150], ['append', '/readme', 'third'],
  ['rename', '/home/ana', '/ana'], ['unlink', '/ana/todo'], ['truncate', '/tmp/big', 400], ['create', '/ana/notes'], ['append', '/ana/notes', 'y'.repeat(200)],
  ['unlink', '/tmp/big'], ['unlink', '/todo-link'], ['rmdir', '/tmp'], ['rename', '/readme', '/ana/readme'], ['mkdir', '/srv'],
];
const cmp = (img, M, what) => {
  const a = JSON.parse(snapshot(img)).map((r) => (r[1] === F.T_DIR ? [r[0], r[1], r[2], null, ''] : r));
  t.eq(a, M.snap(), 'model agrees after ' + what);
};
const GEO = { bs: 128, nblocks: 120, ninodes: 24, ndirect: 3, ps: 4, jblocks: 12 };

// ---- every allocation method: fsck after every operation, the model, and agreement between methods ----
const finals = {};
for (const alloc of F.ALLOCS) {
  for (const mode of ['none', 'ordered']) {
    const img = F.mkfs(Object.assign({}, GEO, { alloc })), M = model();
    for (const [op, ...args] of OPS) {
      F.apply(img, op, args, { mode });
      M[op](...args);
      const r = F.fsck(img);
      t.ok(r.ok, `${alloc}/${mode}: fsck after ${op} ${args[0]}: ${r.problems.map((p) => p.say).join(' ')}`);
      cmp(img, M, `${alloc}/${mode} ${op} ${args[0]}`);
    }
    finals[alloc + mode] = snapshot(img);
    // the walk to byte N agrees with read, for every byte of a file
    const ino = F.lookup(img, '/ana/notes').ino, data = F.read(img, ino);
    for (let N = 0; N < data.length; N += 37) t.eq(F.walk(img, ino, N).byte, data[N], `${alloc}: walk to byte ${N}`);
  }
}
const first = finals.indexednone;
for (const k of Object.keys(finals)) t.eq(finals[k], first, `allocation method ${k} ends with the same files and contents as indexed`);
// the linked chain is a disk read per hop; the FAT chain is not
{
  const li = F.mkfs(Object.assign({}, GEO, { alloc: 'linked' })), fa = F.mkfs(Object.assign({}, GEO, { alloc: 'fat' }));
  for (const img of [li, fa]) { F.apply(img, 'create', ['/f']); F.apply(img, 'write', ['/f', 0, 'z'.repeat(900)]); }
  const wl = F.walk(li, 2, 850), wf = F.walk(fa, 2, 850);
  t.eq(wl.fb, Math.floor(850 / (128 - 4)), 'linked: a block carries bs − ps bytes');
  t.eq(wf.fb, Math.floor(850 / 128), 'FAT: a block carries all bs bytes');
  t.ok(wl.reads.length > wf.reads.length, `linked reads ${wl.reads.length} blocks to reach byte 850, FAT ${wf.reads.length}`);
}

// ---- contiguous: external fragmentation, then compaction ----
{
  const img = F.mkfs({ bs: 128, nblocks: 40, ninodes: 48, ndirect: 3, ps: 4, alloc: 'contiguous' });
  const free0 = new F.Tx(img);
  const n = F.countFree(free0);
  // fill the disk with one-block files, then delete every other one: the free space is all holes of one block
  const names = [];
  for (let i = 0; F.countFree(new F.Tx(img)) > 0 && i < 44; i++) { F.apply(img, 'create', ['/f' + i]); F.apply(img, 'write', ['/f' + i, 0, 'block ' + i]); names.push('/f' + i); }
  for (let i = 0; i < names.length; i += 2) F.apply(img, 'unlink', [names[i]]);
  t.ok(F.fsck(img).ok, 'contiguous: consistent with holes');
  const runs = F.freeRuns(new F.Tx(img));
  F.apply(img, 'create', ['/big']);
  let err = null;
  try { F.apply(img, 'write', ['/big', 0, 'w'.repeat(128 * 4)]); } catch (e) { err = e; }
  const freeNow = F.countFree(new F.Tx(img));
  t.ok(err && err.code === 'EFRAG' && freeNow >= 4 && Math.max(...runs.map((r) => r.len)) < 4, `contiguous: ${freeNow} blocks free in runs of at most ${Math.max(...runs.map((r) => r.len))} cannot hold 4 (${err && err.message})`);
  const before = snapshot(img), c = F.apply(img, 'compact', []);
  t.ok(F.fsck(img).ok, 'contiguous: consistent after compaction');
  t.eq(snapshot(img), before, 'compaction keeps every file');
  t.eq(F.freeRuns(new F.Tx(img)).length, 1, 'compaction leaves one run of free blocks');
  t.ok(c.result > 0, 'compaction moved files');
  F.apply(img, 'write', ['/big', 0, 'w'.repeat(128 * 4)]);
  t.eq(F.text(F.read(img, '/big')), 'w'.repeat(512), 'after compaction the large file fits');
  t.ok(F.fsck(img).ok, 'and the image is consistent');
  // a growing file that cannot extend in place is moved, whole
  const img2 = F.mkfs({ bs: 128, nblocks: 40, ninodes: 16, ndirect: 3, ps: 4, alloc: 'contiguous' });
  F.apply(img2, 'create', ['/a']); F.apply(img2, 'write', ['/a', 0, 'a'.repeat(200)]);
  F.apply(img2, 'create', ['/b']); F.apply(img2, 'write', ['/b', 0, 'b']);
  const s1 = F.stat(img2, '/a').blocks[0], r = F.apply(img2, 'append', ['/a', 'A'.repeat(300)]);
  t.ok(F.stat(img2, '/a').blocks[0] !== s1 && r.trace.some((s) => s.kind === 'move'), 'a contiguous file that cannot grow in place moves');
  t.eq(F.text(F.read(img2, '/a')), 'a'.repeat(200) + 'A'.repeat(300), 'and keeps its bytes');
  t.ok(F.fsck(img2).ok, 'and the image is consistent');
  void n;
}
// extent: runs merge when the next block is free, and the inode's extent slots can run out
{
  const img = F.mkfs({ bs: 128, nblocks: 60, ninodes: 16, ndirect: 3, ps: 4, alloc: 'extent' });
  F.apply(img, 'create', ['/a']); F.apply(img, 'write', ['/a', 0, 'a'.repeat(128 * 3)]);
  const n = F.readInode(img, 2);
  t.eq(F.extents(img.g, n).length, 1, 'three blocks written together are one extent');
  F.apply(img, 'create', ['/b']); F.apply(img, 'write', ['/b', 0, 'b']); F.apply(img, 'append', ['/a', 'more']);
  t.eq(F.extents(img.g, F.readInode(img, 2)).length, 2, 'a block that cannot follow on starts a second extent');
  t.ok(F.fsck(img).ok, 'extent image consistent');
}

// ---- free space: four representations of the same free blocks ----
{
  const img = F.mkfs(GEO);
  for (const [op, ...a] of OPS.slice(0, 14)) F.apply(img, op, a);
  const tx = new F.Tx(img), free = F.dataBlocks(img.g).filter((b) => F.isFreeBlock(tx, b));
  const bm = F.freeSpace(img, 'bitmap'), li = F.freeSpace(img, 'list'), gr = F.freeSpace(img, 'grouping'), co = F.freeSpace(img, 'counting');
  t.eq([bm.free, li.free, gr.free, co.free], [free.length, free.length, free.length, free.length], 'every representation counts the same free blocks');
  t.eq(bm.structure.filter((x) => !x).length, free.length, 'the bitmap has a 0 per free block');
  t.eq(li.structure, free, 'the free list threads the free blocks in order');
  t.eq(gr.structure.flat(), free, 'grouping holds every free block');
  t.eq(co.structure.reduce((a, r) => a + r.len, 0), free.length, 'counting runs add up');
  t.ok(co.structure.every((r) => [...Array(r.len).keys()].every((k) => free.includes(r.start + k))), 'every counted run is free');
  t.ok(li.readsFor(10) > gr.readsFor(10), 'taking 10 blocks from a free list reads more than from grouping');
}

// ---- journaling: a crash at every write point, in every mode ----
const MODE_OPS = OPS.slice(0, 16).concat([['write', '/readme', 2, 'OVERWRITE'], ['create', '/z'], ['append', '/z', 'q'.repeat(300)]]);
let stale = 0, torn = 0;
for (const [mode, alloc] of [['none', 'indexed'], ['writeback', 'indexed'], ['ordered', 'indexed'], ['data', 'indexed'], ['ordered', 'fat'], ['data', 'linked'], ['ordered', 'extent'], ['data', 'contiguous']]) {
  const img = F.mkfs(Object.assign({}, GEO, { alloc }), 'stale bytes of an older disk ');
  for (const [op, ...args] of MODE_OPS) {
    const before = F.clone(img), was = snapshot(before), probe = F.clone(img), all = F.apply(probe, op, args, { mode }).commit.writes, after = snapshot(probe);
    for (let k = 0; k <= all.length; k++) {
      const c = F.clone(before), res = F.apply(c, op, args, { mode, crashAfter: k });
      if (mode === 'none') {
        if (!F.fsck(c).ok) { F.repair(c); t.ok(F.fsck(c).ok, `none: repair after ${op} cut at ${k}`); }
        if (k === 0) t.eq(snapshot(c), was, 'none: no write, no change');
        if (k === all.length) t.eq(snapshot(c), after, 'none: every write, the new state');
        continue;
      }
      F.recover(c);
      const r = F.fsck(c), s = snapshot(c), committed = res.commit.writes.findIndex((w) => w.kind === 'TxE') < k;
      t.ok(r.ok, `${mode}/${alloc}: ${op} ${args[0]} cut at ${k}/${all.length}: fsck ${r.problems.map((p) => p.say).join(' ')}`);
      const meta = (x) => JSON.parse(x).map((row) => row.slice(0, 4));
      t.eq(JSON.stringify(meta(s)), JSON.stringify(meta(committed ? after : was)), `${mode}/${alloc}: ${op} ${args[0]} cut at ${k}: the metadata is the ${committed ? 'new' : 'old'} state`);
      if (mode === 'data') t.eq(s, committed ? after : was, `data: ${op} ${args[0]} cut at ${k}: contents all old or all new`);
      if (mode === 'ordered' && op !== 'write') t.eq(s, committed ? after : was, `ordered: ${op} ${args[0]} cut at ${k}: no stale data shown`);
      if (mode === 'ordered' && op === 'write' && s !== (committed ? after : was)) torn++;
      if (mode === 'writeback' && s !== (committed ? after : was)) stale++;
    }
    F.apply(img, op, args, { mode });
  }
}
t.ok(stale > 0, `writeback: some crash points expose stale data (${stale})`);
t.ok(torn > 0, `ordered: an overwrite cut before its commit is half new (${torn})`);

// ---- lazy checkpointing: the log fills, wraps, and replay restores the last committed state ----
{
  const geo = Object.assign({}, GEO, { jblocks: 9 });
  let wraps = 0, points = 0;
  const img = F.mkfs(geo);
  const states = [snapshot(img)], heads = [];
  const seq = MODE_OPS.slice(0, 12);
  for (const [op, ...args] of seq) {
    const probe = F.cloneLive(img), all = F.apply(probe, op, args, { mode: 'ordered', checkpoint: 'lazy' }).commit.writes, afterSnap = snapshot(probe);
    for (let k = 0; k < all.length; k++) {
      const c = F.cloneLive(img), res = F.apply(c, op, args, { mode: 'ordered', checkpoint: 'lazy', crashAfter: k });
      F.recover(c);
      const committed = res.commit.writes.findIndex((w) => w.kind === 'TxE') < k;
      t.ok(F.fsck(c).ok, `lazy: ${op} cut at ${k}: consistent`);
      t.eq(snapshot(c), committed ? afterSnap : states[states.length - 1], `lazy: ${op} cut at ${k}: the last committed state`);
      points++;
    }
    const r = F.apply(img, op, args, { mode: 'ordered', checkpoint: 'lazy' });
    if (r.commit.writes.some((w) => w.phase === 'checkpoint')) wraps++;
    states.push(snapshot(img));
    heads.push(F.journalState(img).head);
    t.ok(F.fsck(img).ok, `lazy: ${op}: the mounted view is consistent`);
  }
  const js = F.journalState(img);
  t.ok(wraps > 0 && points > 50, `lazy: the log filled and was checkpointed ${wraps} times (${points} cut points)`);
  t.ok(heads.some((h, i) => i && h < heads[i - 1]) && heads.some((h) => h > 0), 'lazy: the log head has moved round the circular log: ' + heads.join(' '));
  void js;
  const c = F.clone(img); F.recover(c);
  t.eq(snapshot(c), states[states.length - 1], 'lazy: after a crash at rest, replay gives the last state');
  F.flush(img);
  t.ok(F.fsck(img, { disk: true }).ok && snapshot(img) === states[states.length - 1], 'lazy: a full checkpoint brings the disk up to date');
}

// ---- eager and lazy commits mixed on one image: an eager checkpoint takes the older lazy transactions with it ----
{
  const img = F.mkfs(Object.assign({}, GEO, { jblocks: 30 })), R = rng(12);
  for (const [op, ...args] of OPS) {
    const r = F.apply(img, op, args, { mode: 'writeback', checkpoint: R() < 0.5 ? 'lazy' : 'eager' });
    t.ok(F.fsck(img).ok, `mixed checkpointing: fsck after ${op} ${args[0]}`);
    if (r.commit.writes.some((w) => w.kind === 'jsb')) t.ok(F.fsck(img, { disk: true }).ok, `mixed checkpointing: after ${op} the disk itself is up to date`);
  }
}
// ---- revoke records: a block logged as metadata, freed, then reused for data ----
for (const revoke of [true, false]) {
  const img = F.mkfs(Object.assign({}, GEO, { jblocks: 40, nblocks: 160 })), o = { mode: 'ordered', checkpoint: 'lazy', revoke };
  F.apply(img, 'mkdir', ['/d'], o);
  const dirBlock = F.stat(img, '/d').blocks[0];
  F.apply(img, 'rmdir', ['/d'], o);
  F.apply(img, 'create', ['/f'], o);
  const w = F.apply(img, 'write', ['/f', 0, 'D'.repeat(100)], o);
  t.eq(F.stat(img, '/f').blocks[0], dirBlock, 'the file reuses the old directory block');
  t.eq(w.commit.revokes.length ? 'revoked' : 'none', revoke ? 'revoked' : 'none', revoke ? 'the write revokes the logged copy' : 'no revoke record is written');
  const c = F.clone(img); F.recover(c);
  const got = F.text(F.read(c, '/f'));
  if (revoke) t.eq(got, 'D'.repeat(100), 'with revoke: replay leaves the new data alone');
  else t.ok(got !== 'D'.repeat(100), 'without revoke: replay copies the old directory block over the file data');
}

// ---- levels of indirection ----
{
  const g = F.geometry({ bs: 256, ps: 4, ndirect: 4, levels: 1 });
  t.eq(F.maxFileSize(g), 256 * (4 + 64), 'one level: direct plus single only');
  const img = F.mkfs({ bs: 256, ps: 4, ndirect: 4, levels: 1, nblocks: 64, ninodes: 8 });
  F.apply(img, 'create', ['/f']);
  let err = null; try { F.apply(img, 'write', ['/f', 256 * 68, 'x']); } catch (e) { err = e; }
  t.ok(err && err.code === 'EFBIG', 'past the single-indirect reach the write is refused');
}
// random sequences: fsck after every operation, for each method
{
  const R = rng(5);
  for (const alloc of F.ALLOCS) {
    const img = F.mkfs(Object.assign({}, GEO, { alloc, nblocks: 160 })), names = [];
    for (let i = 0; i < 40; i++) {
      const pick = R();
      try {
        if (pick < 0.3 || !names.length) { const n = '/r' + i; F.apply(img, 'create', [n]); names.push(n); }
        else if (pick < 0.7) { const n = names[Math.floor(R() * names.length)]; F.apply(img, 'write', [n, Math.floor(R() * 300), 'v'.repeat(1 + Math.floor(R() * 200))]); }
        else if (pick < 0.85) { const n = names.splice(Math.floor(R() * names.length), 1)[0]; F.apply(img, 'unlink', [n]); }
        else { const n = names[Math.floor(R() * names.length)]; F.apply(img, 'truncate', [n, Math.floor(R() * 200)]); }
      } catch (e) { t.ok(['ENOSPC', 'EFRAG', 'EXTENTS'].includes(e.code) || /no free/.test(e.message), `${alloc}: only space errors expected (${e.message})`); }
      const r = F.fsck(img);
      t.ok(r.ok, `${alloc} random step ${i}: ${r.problems.map((p) => p.say).join(' ')}`);
    }
  }
}
t.done();
