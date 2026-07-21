// The block file system: the layout worked by hand, the largest file against its formula and the pointer walk
// against an independent decomposition, every operation checked by fsck and against a plain model of the tree,
// fsck catching damage done on purpose, and a crash at every write point: with the journal, replay always gives
// a consistent image equal to the state before or after the operation; without it, fsck finds the damage and
// repair makes the image consistent.
import { load, harness, rng } from './load.mjs';

const t = harness('fs');
const S = load(['core']);
const F = S.FS;

// ---- the layout, by hand ----
{
  const g = F.geometry({ bs: 256, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, jblocks: 8 });
  t.eq(g.isz, 64, 'inode size: 16 + 7 pointers of 4 bytes = 44, rounded up to 64');
  t.eq([g.ibmStart, g.dbmStart, g.itStart, g.itBlocks, g.jStart, g.dataStart, g.ndata], [1, 2, 3, 4, 7, 15, 49], 'regions of the 64-block image');
  t.eq(g.P, 64, '64 pointers in a 256-byte block');
  const g2 = F.geometry({ bs: 128, nblocks: 2000, ninodes: 64, ndirect: 2, ps: 2 });
  t.eq(g2.dbmBlocks, 2, 'a data bitmap of 1997-ish blocks needs two 1024-bit blocks');
  t.ok(g2.ndata <= g2.dbmBlocks * 1024, 'the data bitmap covers the data region');
}

// ---- the largest file: formula, hand values, and the edge of the pointer walk ----
t.eq(F.maxFileSize({ bs: 1024, ps: 4, ndirect: 12 }), 17247252480, '1 KiB blocks, 4-byte pointers, 12 direct');
t.eq(F.maxFileSize({ bs: 4096, ps: 4, ndirect: 12 }), 4096 * (12 + 1024 + 1048576 + 1073741824), '4 KiB blocks');
t.eq(F.maxFileSize({ bs: 256, ps: 8, ndirect: 3 }), 256 * (3 + 32 + 1024 + 32768), '256-byte blocks, 8-byte pointers');
for (const [bs, ps, nd] of [[64, 4, 1], [128, 2, 5], [256, 8, 3], [512, 4, 12], [1024, 4, 12], [4096, 8, 10]]) {
  const g = { bs, ps, ndirect: nd, P: bs / ps }, P = bs / ps;
  let blocks = nd, span = 1;                       // an independent count: one level at a time
  for (let lv = 1; lv <= 3; lv++) { span *= P; blocks += span; }
  t.eq(F.maxFileSize(g), blocks * bs, `max size ${bs}/${ps}/${nd} against level-by-level sum`);
  t.ok(F.locate(g, blocks - 1) && !F.locate(g, blocks), `the walk maps the last block and not one past it (${bs}/${ps}/${nd})`);
}
// the pointer walk against base-P digits
{
  const R = rng(7);
  for (let trial = 0; trial < 400; trial++) {
    const bs = [64, 128, 256, 1024][trial % 4], ps = [2, 4, 8][trial % 3], nd = 1 + (trial % 12), P = bs / ps, g = { bs, ps, ndirect: nd };
    const total = nd + P + P * P + P * P * P, fb = Math.floor(R() * total), loc = F.locate(g, fb);
    let level = 0, rel = fb, cap = nd;
    while (rel >= cap) { rel -= cap; level++; cap = Math.pow(P, level); }
    const digits = []; let x = rel; for (let d = 0; d < level; d++) { digits.unshift(x % P); x = Math.floor(x / P); }
    t.eq([loc.level, loc.level ? loc.idx : [loc.slot]], [level, level ? digits : [rel]], `locate ${fb} in ${bs}/${ps}/${nd}`);
  }
}

// ---- operations against a model; fsck after every one ----
const GEO = { bs: 128, nblocks: 96, ninodes: 24, ndirect: 3, ps: 4, jblocks: 10 };
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return s.length + ':' + h.toString(16); };
function snapshot(img) {
  const out = [], seen = new Set();
  const walk = (path) => {
    for (const e of F.list(img, path)) {
      if (e.name === '.' || e.name === '..') continue;
      const p = (path === '/' ? '' : path) + '/' + e.name, n = F.readInode(img, e.ino);
      out.push([p, n.type, n.nlink, n.size, n.type === F.T_FILE ? fnv(F.text(F.read(img, p))) : '']);
      if (n.type === F.T_DIR && !seen.has(e.ino)) { seen.add(e.ino); walk(p); }
    }
  };
  walk('/');
  return JSON.stringify(out.sort());
}
// the model: a map from path to {dir} or {file content}, with inode sharing for links
function model() {
  const m = { '/': { dir: true } }, files = new Map(); let nextId = 1;
  return {
    mkdir(p) { m[p] = { dir: true }; },
    create(p) { const id = nextId++; files.set(id, ''); m[p] = { id }; },
    write(p, off, s) { const id = m[p].id; let c = files.get(id); while (c.length < off) c += '\0'; c = c.slice(0, off) + s + c.slice(off + s.length); files.set(id, c); },
    append(p, s) { this.write(p, files.get(m[p].id).length, s); },
    link(a, b) { m[b] = { id: m[a].id }; },
    unlink(p) { delete m[p]; },
    rmdir(p) { delete m[p]; },
    snap() {
      const out = [];
      for (const p of Object.keys(m)) {
        if (p === '/') continue;
        if (m[p].dir) { const subs = Object.keys(m).filter((q) => q !== p && q.startsWith(p + '/') && q.slice(p.length + 1).indexOf('/') < 0 && m[q].dir).length; out.push([p, F.T_DIR, 2 + subs, null, '']); }
        else { const c = files.get(m[p].id), links = Object.values(m).filter((x) => x.id === m[p].id).length; out.push([p, F.T_FILE, links, c.length, fnv(c)]); }
      }
      return out.sort();
    },
  };
}
const OPS = [
  ['mkdir', '/home'], ['mkdir', '/home/ana'], ['create', '/home/ana/todo'], ['write', '/home/ana/todo', 0, 'buy lamp oil; mend the gate'],
  ['create', '/readme'], ['append', '/readme', 'first line\n'], ['append', '/readme', 'a second, longer line that crosses a block edge\n'],
  ['link', '/home/ana/todo', '/todo-link'], ['write', '/home/ana/todo', 300, 'past a hole'], ['mkdir', '/tmp'],
  ['create', '/tmp/big'], ['write', '/tmp/big', 128 * 3 + 100, 'single'], ['write', '/tmp/big', 128 * (3 + 32 + 40) + 5, 'double'],
  ['write', '/tmp/big', 128 * (3 + 32 + 1024 + 1100) + 9, 'triple!'], ['unlink', '/home/ana/todo'], ['create', '/home/ana/notes'],
  ['append', '/home/ana/notes', 'x'.repeat(200)], ['unlink', '/tmp/big'], ['unlink', '/todo-link'], ['rmdir', '/tmp'], ['mkdir', '/srv'],
];
function cmpModel(img, M, what) {
  const a = JSON.parse(snapshot(img)).map((r) => (r[1] === F.T_DIR ? [r[0], r[1], r[2], null, ''] : r));
  t.eq(a, M.snap(), 'model agrees after ' + what);
}
for (const journal of [false, true]) {
  const img = F.mkfs(GEO), M = model();
  for (const [op, ...args] of OPS) {
    F.apply(img, op, args, { journal });
    M[op](...args);
    const r = F.fsck(img);
    t.ok(r.ok, `fsck passes after ${op} ${args[0]} (journal ${journal}): ${r.problems.map((p) => p.say).join(' ')}`);
    cmpModel(img, M, op + ' ' + args[0]);
  }
  t.eq(F.text(F.read(img, '/readme', 0, 10)), 'first line', 'read back the start of /readme');
}
// path lookup trace
{
  const img = F.mkfs(GEO);
  for (const [op, ...a] of OPS.slice(0, 3)) F.apply(img, op, a);
  const L = F.lookup(img, '/home/ana/todo');
  t.eq(L.steps.map((s) => s.kind), ['lookup-root', 'lookup-dir', 'lookup-dir', 'lookup-dir'], 'one step per directory on the way');
  t.eq(L.steps.slice(1).map((s) => s.found), [2, 3, 4], 'the inode found at each step');
  t.eq(F.lookup(img, '/home/bob').ino, 0, 'a missing name gives inode 0');
}
// the walk to byte N on a real sparse file reaches the right block and byte
{
  const R = rng(3);
  for (const [bs, ps, nd] of [[256, 4, 4], [128, 8, 2], [512, 2, 6]]) {
    const img = F.mkfs({ bs, ps, ndirect: nd, nblocks: 80, ninodes: 8 });
    F.apply(img, 'create', ['/f']);
    const max = F.maxFileSize(img.g);
    for (let k = 0; k < 6; k++) {
      const N = Math.floor(R() * (max - 8)), ch = String.fromCharCode(65 + k);
      F.apply(img, 'write', ['/f', N, ch]);
      const w = F.walk(img, 2, N);
      t.eq(String.fromCharCode(w.byte), ch, `walk to byte ${N} (${bs}/${ps}/${nd}) finds what was written`);
      t.eq(w.steps.filter((s) => s.kind === 'index').length, w.loc.level, 'one index step per level of indirection');
      t.ok(F.fsck(img).ok, 'sparse file image passes fsck');
    }
    t.ok(F.walk(img, 2, 0).block === 0 || F.read(img, '/f', 0, 1)[0] === 0, 'an unwritten start reads as zero');
  }
}

// ---- fsck catches damage ----
{
  const base = F.mkfs(GEO);
  for (const [op, ...a] of OPS.slice(0, 8)) F.apply(base, op, a);
  const g = base.g;
  const hurt = (fn) => { const img = F.clone(base); fn(img); return F.fsck(img).problems.map((p) => p.kind); };
  const todo = F.lookup(base, '/home/ana/todo').ino, tb = F.readInode(base, todo).direct[0];
  t.ok(hurt((img) => F.setBit(F.block(img, g.dbmStart), tb - g.dataStart, 0)).includes('used-but-free'), 'a used block cleared in the bitmap');
  t.ok(hurt((img) => F.setBit(F.block(img, g.dbmStart), g.ndata - 1, 1)).includes('leak'), 'a block marked used that nobody owns');
  t.ok(hurt((img) => F.setBit(F.block(img, g.ibmStart), todo, 0)).includes('inode-bitmap'), 'a live inode free in the inode bitmap');
  t.ok(hurt((img) => { const a = F.inodeAt(g, todo), n = F.decodeInode(g, F.block(img, a.block), a.off); n.nlink = 5; F.encodeInode(g, F.block(img, a.block), a.off, n); }).includes('link-count'), 'a wrong link count');
  t.ok(hurt((img) => { const a = F.inodeAt(g, todo), n = F.decodeInode(g, F.block(img, a.block), a.off); n.direct[1] = tb; n.size = 300; F.encodeInode(g, F.block(img, a.block), a.off, n); }).includes('dup-block'), 'a block pointed to twice');
  t.ok(hurt((img) => { const a = F.inodeAt(g, todo); F.block(img, a.block).fill(0, a.off, a.off + g.isz); }).includes('dangling-entry'), 'an entry naming a freed inode');
  t.ok(hurt((img) => { const a = F.inodeAt(g, 9), n = F.emptyInode(g, F.T_FILE); n.nlink = 1; F.encodeInode(g, F.block(img, a.block), a.off, n); F.setBit(F.block(img, g.ibmStart), 9, 1); }).includes('orphan'), 'an inode nobody names');
  const fixed = F.clone(base); F.setBit(F.block(fixed, g.dbmStart), g.ndata - 1, 1); F.setBit(F.block(fixed, g.dbmStart), tb - g.dataStart, 0);
  t.ok(F.repair(fixed).length >= 2 && F.fsck(fixed).ok, 'repair fixes both bitmap problems');
}

// ---- a crash at every write point ----
let points = 0, noJournalBad = 0;
for (const journal of [true, false]) {
  const img = F.mkfs(GEO, 'stale bytes from an older file system ');
  for (const [op, ...args] of OPS) {
    const before = F.clone(img), probe = F.clone(img), all = F.apply(probe, op, args, { journal }).commit.writes.length, after = snapshot(probe);
    const was = snapshot(before);
    for (let k = 0; k <= all; k++) {
      const c = F.clone(before);
      const res = F.apply(c, op, args, { journal, crashAfter: k });
      points++;
      if (journal) {
        F.replay(c);
        const r = F.fsck(c), s = snapshot(c), committed = res.commit.writes.findIndex((w) => w.kind === 'TxE') < k;
        t.ok(r.ok, `journal: ${op} ${args[0]} crash after ${k}/${all}: fsck ${r.problems.map((p) => p.say).join(' ')}`);
        t.eq(s, committed ? after : was, `journal: ${op} ${args[0]} crash after ${k}/${all} gives the ${committed ? 'new' : 'old'} state`);
      } else {
        const r = F.fsck(c);
        if (!r.ok) { noJournalBad++; F.repair(c); t.ok(F.fsck(c).ok, `no journal: repair makes ${op} ${args[0]} crash ${k} consistent`); }
        if (k === 0) t.eq(snapshot(c), was, 'no write, no change');
        if (k === all) t.eq(snapshot(c), after, 'every write, the new state');
      }
    }
    F.apply(img, op, args, { journal });
  }
}
t.ok(points > 200, 'many crash points tried (' + points + ')');
t.ok(noJournalBad > 10, 'without the journal, fsck finds damage at many crash points (' + noJournalBad + ')');

// ---- the append of the journal scene: three blocks, inode first, without the journal ----
{
  const img = F.mkfs(GEO); F.apply(img, 'create', ['/log']); F.apply(img, 'append', ['/log', 'x'.repeat(128)]);
  const tx = F.prepare(img, 'append', '/log', 'more');
  t.eq(tx.writes().map((w) => w.kind), ['inode', 'dbm', 'data'], 'an append to a new block writes an inode, the data bitmap and a data block');
  const c1 = F.clone(img); F.commit(c1, tx, { crashAfter: 1 });
  t.eq(F.fsck(c1).problems.map((p) => p.kind), ['used-but-free'], 'inode written alone: its new block is free in the bitmap');
  const c2 = F.clone(img); F.commit(c2, F.prepare(c2, 'append', '/log', 'more'), { crashAfter: 2 });
  t.ok(F.fsck(c2).ok, 'inode and bitmap written: consistent, though the data never came');
  const c3 = F.clone(img), tx3 = F.prepare(c3, 'append', '/log', 'more'); tx3.writes().forEach(() => {});
  const order = F.commit(c3, tx3, { journal: true }).writes.map((w) => w.kind);
  t.eq(order, ['data', 'TxB', 'log', 'log', 'TxE', 'inode', 'dbm', 'jsb'], 'journaled: data, the begin block, two logged blocks, the commit block, checkpoint, free');
  const ws = F.commit(F.clone(img), F.prepare(img, 'append', '/log', 'more'), { journal: true }).writes;
  t.eq(ws.filter((w) => w.label).map((w) => w.label), ['begin 1', 'commit 1'], 'the begin and commit blocks are labelled for readers');
  const jc = F.clone(img); F.commit(jc, F.prepare(jc, 'append', '/log', 'more'), { journal: true, crashAfter: 5 });
  t.eq(F.journalState(jc).log.slice(0, 4).map((e) => e.label || e.kind), ['begin 1', 'data', 'data', 'commit 1'], 'the journal state labels them too');
}

// ---- the scenes built on this engine: the inode walk and the journal replay ----
{
  const V = load(['core', 'stage', 'demo'], { vm: true });
  const walk = V.Demo.byId('inode-walk');
  for (const kn of [{}, { target: 0 }, { target: 1 }, { target: 2 }, { target: 3, bs: 12, ps: 1, nd: 12 }, { target: 4, N: 123456789, bs: 9, ps: 3, nd: 7 }]) {
    const r = walk.run(kn), g = r.g, P = g.bs / g.ps, fb = Math.floor(r.N / g.bs);
    let level = 0, rel = fb, cap = g.ndirect;
    while (rel >= cap) { rel -= cap; level++; cap = Math.pow(P, level); }
    const digits = []; let x = rel; for (let d = 0; d < level; d++) { digits.unshift(x % P); x = Math.floor(x / P); }
    t.eq(r.w.steps.filter((s) => s.kind === 'index').map((s) => s.idx), digits, 'inode-walk ' + JSON.stringify(kn) + ': the index at each level');
    t.eq(String.fromCharCode(r.w.byte), 'l', 'inode-walk ' + JSON.stringify(kn) + ': the walk reaches the byte written');
    t.ok(r.ok, 'inode-walk ' + JSON.stringify(kn) + ': its image passes fsck');
  }
  const jr = V.Demo.byId('journal-replay');
  for (let k = 0; k <= 8; k++) {
    const r = jr.run(k, true);
    t.ok(r.fsck.ok && (r.size === 128 || r.tail === 'Day 2. Rain all morning.'), 'journal-replay: cut after ' + k + ' with the journal gives the old or the new file');
    t.eq(r.size === 152, k >= 5, 'journal-replay: the append survives exactly when the commit block was written (cut ' + k + ')');
  }
  t.eq(jr.run(1, false).fsck.problems.map((p) => p.kind), ['used-but-free'], 'journal-replay: no journal, inode alone written');
  const r2 = jr.run(2, false);
  t.ok(r2.fsck.ok && r2.size === 152 && r2.tail !== 'Day 2. Rain all morning.', 'journal-replay: no journal, data block missing: consistent but stale');
}
t.done();
