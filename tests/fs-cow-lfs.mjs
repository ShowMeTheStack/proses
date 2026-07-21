// Copy-on-write and log-structured file systems. Copy-on-write: random operations against a model, the checker
// after every one, a crash at every write point (the old tree or the new, never a mix), checksums catching a
// flipped bit, scrub, snapshots keeping old contents. Log-structured: random operations with the cleaner running
// (greedy and cost-benefit), every live file preserved; usage worked by hand; the write cost rising with
// utilisation; a crash then mount from the checkpoint, with and without roll-forward.
import { load, harness, rng } from './load.mjs';

const t = harness('fs-cow-lfs');
const S = load(['core']);
const F = S.FS, C = F.cow, L = F.lfs;

// ---- copy-on-write ----
{
  const R = rng(9), img = C.mkfs({ bs: 128, nblocks: 120 }), model = new Map();
  const snapC = (im) => JSON.stringify(C.list(im).map((e) => [e.name, C.read(im, e.name)]).sort());
  const snapM = () => JSON.stringify([...model].sort());
  for (let i = 0; i < 40; i++) {
    const names = [...model.keys()], p = R();
    let op, args;
    if (p < 0.3 || !names.length) { op = 'create'; args = ['n' + i]; }
    else if (p < 0.6) { const n = names[Math.floor(R() * names.length)]; op = 'write'; args = [n, Math.floor(R() * 100), 'w' + i + '-'.repeat(Math.floor(R() * 150))]; }
    else if (p < 0.75) { op = 'append'; args = [names[Math.floor(R() * names.length)], 'a' + i]; }
    else if (p < 0.9) { op = 'delete'; args = [names[Math.floor(R() * names.length)]]; }
    else { const n = names[Math.floor(R() * names.length)]; op = 'rename'; args = [n, 'm' + i]; }
    const before = snapC(img), probe = { g: img.g, bytes: img.bytes.slice() }, plan = C.prepare(probe, op, ...args);
    for (let k = 0; k <= plan.writes.length; k++) {
      const c = { g: img.g, bytes: img.bytes.slice() };
      C.commit(c, C.prepare(c, op, ...args), { crashAfter: k });
      t.ok(C.check(c).ok, `cow: ${op} cut at ${k}: the tree checks`);
      if (k < plan.writes.length) t.eq(snapC(c), before, `cow: ${op} cut at ${k} (before the flip): the old tree`);
    }
    C.apply(img, op, args);
    if (op === 'create') model.set(args[0], '');
    else if (op === 'delete') model.delete(args[0]);
    else if (op === 'rename') { model.set(args[1], model.get(args[0])); model.delete(args[0]); }
    else { const old = model.get(args[0]), off = op === 'append' ? old.length : args[1], txt = op === 'append' ? args[1] : args[2]; let s = old; while (s.length < off) s += '\0'; model.set(args[0], s.slice(0, off) + txt + s.slice(off + txt.length)); }
    t.eq(snapC(img), snapM(), `cow: ${op} ${args[0]} agrees with the model`);
  }
  t.eq(plan0(), 'flip last', 'the uberblock write is the last of every plan');
  function plan0() { const p = C.prepare(img, 'create', 'zz'); return p.writes[p.writes.length - 1].kind === 'uber' ? 'flip last' : 'no'; }
  // sharing: a write to one block of a long file copies only that block
  const img2 = C.mkfs({ bs: 128, nblocks: 60 });
  C.apply(img2, 'create', ['long']); C.apply(img2, 'write', ['long', 0, 'L'.repeat(600)]);
  const p = C.prepare(img2, 'write', 'long', 300, 'X');
  t.eq(p.writes.map((w) => w.kind), ['data', 'inode', 'imap', 'uber'], 'one changed block: a new data block, inode, map and the flip');
  // checksums: a flipped bit is caught on read and by scrub
  const tr = C.tree(img2), dataBlock = tr.inodes.get(2).ptrs[1].block;
  C.corrupt(img2, dataBlock, 5, 3);
  let err = null; try { C.read(img2, 'long'); } catch (e) { err = e; }
  t.ok(err && err.code === 'ECSUM' && err.block === dataBlock, 'a flipped bit fails its checksum on read');
  const sc = C.scrub(img2);
  t.eq(sc.bad.map((b) => b.block), [dataBlock], 'scrub finds exactly the corrupt block');
  C.corrupt(img2, dataBlock, 5, 3);
  t.eq(C.scrub(img2).bad.length, 0, 'flipped back, scrub is clean');
  // snapshots keep the old contents readable and their blocks allocated
  C.apply(img2, 'snapshot', []);
  const snapGen = C.mount(img2).snaps[0].gen;
  C.apply(img2, 'delete', ['long']);
  t.eq(C.list(img2).length, 0, 'the current tree has no file');
  t.eq(C.read(img2, 'long', { gen: snapGen }), 'L'.repeat(600), 'the snapshot still reads the old file');
  for (let i = 0; i < 6; i++) { C.apply(img2, 'create', ['f' + i]); C.apply(img2, 'write', ['f' + i, 0, 'new data ' + i]); }
  t.eq(C.read(img2, 'long', { gen: snapGen }), 'L'.repeat(600), 'new files do not reuse the snapshot\'s blocks');
  C.apply(img2, 'dropSnapshot', [snapGen]);
  t.ok(C.check(img2).free > 0 && C.check(img2).ok, 'dropping the snapshot frees its blocks');
  // a torn uberblock: its own checksum fails and the other one is used
  const img3 = C.mkfs(); C.apply(img3, 'create', ['a']);
  const p3 = C.prepare(img3, 'create', 'b'), ub = p3.writes[p3.writes.length - 1];
  C.commit(img3, p3, { crashAfter: p3.writes.length - 1 });
  img3.bytes.set(ub.bytes.subarray(0, 40), ub.block * img3.g.bs);       // half the uberblock reached the disk
  t.eq(C.list(img3).map((e) => e.name), ['a'], 'a torn uberblock is ignored: the older one mounts');
}

// ---- log-structured ----
for (const policy of ['greedy', 'cost-benefit']) {
  const R = rng(policy === 'greedy' ? 4 : 8), fs = L.mkfs({ bs: 128, segBlocks: 32, nsegs: 10, ninodes: 32, policy }), model = new Map();
  let cleanedRuns = 0;
  for (let i = 0; i < 120; i++) {
    const names = [...model.keys()], p = R();
    if (p < 0.15 && names.length < 10 || !names.length) { const n = 'f' + i; L.create(fs, n); model.set(n, ''); }
    else if (p < 0.8) { const n = names[Math.floor(R() * names.length)], off = Math.floor(R() * 200), txt = String.fromCharCode(97 + (i % 26)).repeat(1 + Math.floor(R() * 120)); const r = L.write(fs, n, off, txt); if (r.steps.some((s) => s.kind === 'cleaned')) cleanedRuns++; let s = model.get(n); while (s.length < off) s += '\0'; model.set(n, s.slice(0, off) + txt + s.slice(off + txt.length)); }
    else if (p < 0.88 && names.length > 2) { const n = names[Math.floor(R() * names.length)]; L.delete(fs, n); model.delete(n); }
    if (i % 3 === 0) L.sync(fs);
    const ok = [...model].every(([n, v]) => L.read(fs, n) === v) && L.list(fs).length === model.size;
    t.ok(ok, `lfs ${policy}: every live file intact after step ${i}`);
    const ck = L.check(fs);
    t.ok(ck.ok, `lfs ${policy} step ${i}: ${ck.problems.map((x) => x.say).join(' ')}`);
  }
  const r = L.clean(fs, { policy, count: 3 });
  t.ok([...model].every(([n, v]) => L.read(fs, n) === v), `lfs ${policy}: an explicit cleaning keeps every file`);
  t.ok(cleanedRuns > 0 && r.cleaned.length > 0, `lfs ${policy}: the cleaner ran (${cleanedRuns} times on its own)`);
  t.ok(L.stats(fs).writeCost > 1, `lfs ${policy}: write cost ${L.stats(fs).writeCost}`);
  // crash: mount with roll-forward gives the state of the last partial segment written
  L.sync(fs);
  const n0 = [...model.keys()][0]; L.write(fs, n0, 0, 'AFTER'); L.sync(fs);
  const after = new Map(model); after.set(n0, 'AFTER' + after.get(n0).slice(5));
  L.write(fs, n0, 0, 'LOST!');                           // still in the buffer when the power fails
  const m1 = L.mount(fs.img);
  t.ok([...after].every(([n, v]) => L.read(m1, n) === v), `lfs ${policy}: after a crash the last synced state is back; the buffered write is lost`);
  t.ok(L.check(m1).ok, `lfs ${policy}: the mounted image checks`);
}
// usage by hand. mkfs writes one partial segment: a summary, the root's inode and inode-map piece 0 (3 blocks,
// 2 live). Then a file of 3 blocks: the directory block, 3 data blocks, the 2 inodes and the piece do not fit in
// the 5 blocks left of segment 0, so the 4 data blocks go first (summary + 4 = the rest of segment 0) and the
// metadata follows in segment 1 (summary, 2 inodes, piece). The old root inode and piece in segment 0 are dead.
{
  const fs = L.mkfs({ bs: 128, segBlocks: 8, nsegs: 6, ninodes: 16, autoClean: false });
  const u0 = L.usage(fs)[0];
  t.eq([u0.total, u0.live], [3, 2], 'mkfs: 3 blocks written, 2 live');
  L.create(fs, 'a'); L.write(fs, 'a', 0, 'x'.repeat(384)); L.sync(fs);
  const u = L.usage(fs);
  t.eq([u[0].total, u[0].live, u[1].total, u[1].live], [8, 4, 4, 3], 'segment 0: 8 written, the 4 data blocks live; segment 1: 4 written, 3 live');
  t.eq(L.read(fs, 'a'), 'x'.repeat(384), 'the file reads back');
}
// write cost grows with utilisation: overwrite random blocks of a disk kept fuller or emptier
{
  const cost = (files) => {
    const fs = L.mkfs({ bs: 128, segBlocks: 32, nsegs: 14, ninodes: 64, policy: 'greedy' }), R = rng(3);
    for (let i = 0; i < files; i++) { L.create(fs, 'f' + i); L.write(fs, 'f' + i, 0, 'x'.repeat(384)); }
    L.sync(fs);
    const s0 = L.stats(fs);
    for (let k = 0; k < 150; k++) { L.write(fs, 'f' + Math.floor(R() * files), 128 * Math.floor(R() * 3), 'y'.repeat(128)); if (k % 4 === 3) L.sync(fs); }
    const s1 = L.stats(fs);
    return (s1.written - s0.written + s1.cleanerReads - s0.cleanerReads) / (s1.newBlocks - s0.newBlocks);
  };
  const low = cost(8), high = cost(50);
  t.ok(high > low, `write cost per new block: ${low.toFixed(2)} at low utilisation, ${high.toFixed(2)} at high`);
}
t.done();
