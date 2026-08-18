// The File-system lab in node: every preset and many random setups go through the lab's run(), wide and narrow; the
// frames are well formed (unique keys, a sentence each, nothing undefined or NaN shown, steps that point into the
// trace) and the same seed gives the same frames. The numbers are checked by independent means: the blocks a command
// is said to change against a byte-by-byte comparison of the disk before and after; the largest file by its formula;
// the walk to byte N by arithmetic on the raw inode and indirect blocks; the free counts by counting bitmap bits; every
// power cut under data journaling leaving a file wholly old or wholly new; offsets shared after fork and dup by a small
// model of the open-file table; the copy-on-write tree unchanged by a crash before the flip; the log's write cost by
// its definition; and the distributed timeline's counts from its messages.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-fs-[a-z])\.js$/;
for (const f of files(['core', 'stage', 'topics']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-fs');
const lab = S.Labs.get('fs'), LS = S.LabSetup, FL = S.FsLab, F = S.FS;
t.ok(!!lab, 'the File-system lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');
const setup = (vals) => LS.merge(lab, Object.assign({}, defs, vals));

function frames(v, seed, narrow, what) {
  let r;
  try { r = lab.run(v, { seed, narrow }); } catch (e) { t.ok(false, what + ': runs (' + e.stack + ')'); return null; }
  if (r.error) { t.ok(false, what + ': no error (' + JSON.stringify(r.error) + ')'); return null; }
  t.ok(r.frames.length >= 2, what + ': has frames (' + r.frames.length + ')');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' has a duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10, what + ': frame ' + i + ' says something');
    t.ok(f.at >= 0 && f.at < Math.max(1, r.trace.length), what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) {
      const s = [it.text, it.sub].concat(it.lines || []).filter((x) => x !== undefined).join(' ');
      if (/undefined|NaN|\[object|Infinity/.test(s) || /NaN/.test(String(it.x) + it.y + it.w + it.h)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '" (' + it.key + ')'); break; }
    }
    if (/undefined|NaN|\[object/.test(f.say)) t.ok(false, what + ': frame ' + i + ' says "' + f.say + '"');
    for (const tb of f.tables || []) for (const row of tb.rows) if (row.length !== tb.cols.length) { t.ok(false, what + ': table "' + tb.title + '" rows match its columns'); break; }
  });
  return r;
}

// ---- every preset, wide and narrow, twice ------------------------------------------------------------------------
for (const p of lab.setup.presets) {
  const v = setup(p.values);
  t.ok(LS.check(lab, v) === null, p.label + ': the preset is a valid setup (' + LS.check(lab, v) + ')');
  const r1 = frames(v, 1, false, p.label);
  frames(v, 1, true, p.label + ' (narrow)');
  const r2 = lab.run(v, { seed: 1, narrow: false });
  if (r1) t.eq(r2.frames.map((f) => f.say), r1.frames.map((f) => f.say), p.label + ': the same seed gives the same run');
}

// ---- disk: random geometries and scripts -------------------------------------------------------------------------
const R = rng(7);
const pick = (a) => a[Math.floor(R() * a.length)];
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
function script(n) {
  const names = ['/a', '/b', '/c', '/d/e', '/d/f'], out = ['mkdir /d'];
  for (let i = 0; i < n; i++) {
    const p = pick(names);
    const op = pick(['create', 'create', 'write', 'append', 'append', 'link', 'unlink', 'rename', 'truncate', 'symlink', 'read', 'chmod']);
    if (op === 'create') out.push('create ' + p);
    else if (op === 'write') out.push(`write ${p} ${int(0, 900)} ${pick(['tide', 'gulls at the pier', '[' + int(1, 700) + ' bytes]'])}`);
    else if (op === 'append') out.push(`append ${p} [${int(1, 600)} bytes]`);
    else if (op === 'link') out.push(`link ${p} /l${i}`);
    else if (op === 'unlink') out.push('unlink ' + p);
    else if (op === 'rename') out.push(`rename ${p} /r${i}`);
    else if (op === 'truncate') out.push(`truncate ${p} ${int(0, 400)}`);
    else if (op === 'symlink') out.push(`symlink ${p} /s${i}`);
    else if (op === 'read') out.push(`read ${p} ${int(0, 50)} ${int(1, 80)}`);
    else out.push(`chmod ${p} ${pick(['600', '644', '444'])}`);
  }
  return out.join('\n');
}
/** the blocks whose contents differ between two snapshots, as the mounted file system sees them */
function diff(a, b) {
  const g = a.g, out = new Set();
  const view = (sn, k) => (sn.mem.has(k) ? sn.mem.get(k) : sn.bytes.subarray(k * g.bs, (k + 1) * g.bs));
  for (let k = 0; k < g.nblocks; k++) { const x = view(a, k), y = view(b, k); for (let i = 0; i < g.bs; i++) if (x[i] !== y[i]) { out.add(k); break; } }
  return out;
}
const maxRef = (g) => { if (g.alloc !== 'indexed') return null; const P = g.bs / g.ps; let n = g.ndirect; for (let l = 1; l <= g.levels; l++) n += P ** l; return g.bs * n; };
let runs = 0;
for (let k = 0; k < 40; k++) {
  const alloc = k % 5 === 0 ? pick(['contiguous', 'linked', 'fat', 'extent']) : 'indexed';
  const v = setup({ mode: 'disk', src: script(int(4, 12)), bs: pick([64, 128, 256, 512]), nblocks: pick([48, 64, 96]), ninodes: int(8, 24), ndirect: int(1, 8), levels: int(1, 3), ps: pick([2, 4, 8]), alloc, journal: pick(['none', 'none', 'ordered', 'writeback', 'data']), jblocks: int(8, 16), cache: pick(['none', 'write-through', 'write-back']), cacheBlocks: int(2, 16), walk: true, walkPath: pick(['/a', '/b', '/c']), walkN: int(0, 2000) });
  if (v.bs * v.nblocks > 262144) v.nblocks = 64;
  if (LS.check(lab, v)) continue;
  runs++;
  const r = frames(v, 1, k % 2 === 1, 'random disk ' + k);
  if (!r) continue;
  const B = r.bench, g = B.first.devs[0].g;
  // the largest file
  const ref = maxRef(g);
  if (ref !== null) t.eq(F.maxFileSize(g), ref, 'random disk ' + k + ': the largest file by its formula');
  // each command: the explained blocks are exactly those that changed
  B.recs.forEach((rec, i) => {
    if (!rec.ok || rec.cmd.op === 'mkfs' || rec.cmd.op === 'read' || rec.cmd.op === 'user' || rec.cmd.op === 'sync') return;
    const prev = i ? B.recs[i - 1].devs : B.first.devs;
    for (const cap of rec.caps) {
      const said = new Set(cap.writes.map((w) => w.block)), changed = diff(prev[cap.dev], rec.devs[cap.dev]);
      const g2 = prev[cap.dev].g, home = [...changed].filter((b) => !(g2.jblocks && b >= g2.jStart && b < g2.jStart + g2.jblocks));
      t.ok(home.every((b) => said.has(b)), `random disk ${k}, ${rec.cmd.text}: every changed block is explained (${home} against ${[...said]})`);
      t.eq(FL.explain(cap, FL.names(rec.devs)).length, cap.writes.length, `random disk ${k}, ${rec.cmd.text}: one sentence a block`);
    }
    // free counts by counting bits
    const sn = rec.devs[0];
    if (sn.g.groups === 1 && !sn.g.fat) {
      const img = FL.live(sn), ib = F.readBlock(img, sn.g.ibmStart), db = F.readBlock(img, sn.g.dbmStart);
      let fi = 0, fb = 0;
      for (let q = 0; q < sn.g.ninodes; q++) if (!((ib[q >> 3] >> (q & 7)) & 1)) fi++;
      for (let q = 0; q < sn.g.ndata; q++) if (!((db[q >> 3] >> (q & 7)) & 1)) fb++;
      t.eq(FL.counts(sn), { fi, fb }, `random disk ${k}, ${rec.cmd.text}: free counts by the bits`);
    }
  });
  // the walk to byte N, by arithmetic on the raw blocks
  const fin = B.final[0], img = FL.live(fin);
  let ino = 0;
  try { ino = F.lookup(img, v.walkPath).ino; } catch (e) { ino = 0; }
  if (ino && g.alloc === 'indexed' && F.readInode(img, ino).type === F.T_FILE) {
    const P = g.bs / g.ps, N = v.walkN, fb = Math.floor(N / g.bs), n = F.readInode(img, ino);
    let blk = 0, rest = fb, ok = true;
    if (rest < g.ndirect) blk = n.direct[rest];
    else {
      rest -= g.ndirect;
      let lvl = 1;
      while (lvl <= g.levels && rest >= P ** lvl) { rest -= P ** lvl; lvl++; }
      if (lvl > g.levels) ok = false;
      else {
        blk = n[['', 'single', 'double', 'triple'][lvl]];
        for (let d = lvl - 1; d >= 0 && blk; d--) { const span = P ** d, idx = Math.floor(rest / span); rest %= span; blk = F.getPtr(F.readBlock(img, blk), idx * g.ps, g.ps); }
      }
    }
    if (ok) t.eq(F.walk(img, ino, N).block, blk, `random disk ${k}: the walk to byte ${N} reaches the block the arithmetic gives`);
  }
}
t.ok(runs >= 25, 'enough random disk setups ran (' + runs + ')');

// ---- crashes: data journaling is all or nothing; no journal is repaired consistent --------------------------------
for (let cut = 0; cut <= 12; cut++) {
  for (const journal of ['data', 'none', 'ordered']) {
    const v = setup({ mode: 'disk', src: 'create /log\nwrite /log 0 [300 bytes]\nwrite /log 100 [250 bytes]', journal, jblocks: 12, crash: true, cutAfter: cut, walk: false });
    const r = frames(v, 1, false, `crash ${journal} after ${cut}`);
    if (!r) continue;
    const rec = r.bench.recs[2], img = FL.live(rec.devs[0]);
    t.ok(F.fsck(img, { disk: true }).ok, `crash ${journal} after ${cut}: consistent after recovery and repair`);
    if (journal === 'data') {
      const now = F.text(F.read(img, '/log')), old = FL.filler(300, 7), nw = old.slice(0, 100) + FL.filler(250, 14);
      t.ok(now === old || now === nw, `crash data after ${cut}: /log is wholly old or wholly new`);
    }
  }
}

// ---- tables: offsets by a small model ------------------------------------------------------------------------------
{
  const v = setup({ mode: 'tables' });
  const r = frames(v, 1, false, 'tables model');
  const text = 'harbour log: fog at six';
  // 1 open r (fd 0, offset 0), read 7 -> 7, fork 2 shares, P2 reads 4 -> 11, P1 open rw (fd 1) write TIDE -> its own offset 4
  const reads = r.frames.map((f) => f.say).filter((s) => /returns "/.test(s)).map((s) => s.match(/returns "(.*?)"/)[1]);
  t.eq(reads.slice(0, 2), [text.slice(0, 7), text.slice(7, 11)], 'tables: fork shares the offset (the child reads on from 7)');
  const last = r.frames[r.frames.length - 1].tables.find((x) => x.title === 'Open-file table');
  t.eq(last.rows.length, 0, 'tables: every entry is gone after the last close');
}

// ---- copy-on-write: a crash before the flip leaves the old tree -------------------------------------------------------
for (let cut = 0; cut <= 3; cut++) {
  const v = setup({ mode: 'cow', ccmds: FL.toRows('create chart\nwrite chart 0 rocks at the point\nappend chart [150 bytes]', 'cmd'), ccrash: true, ccut: cut });
  const r = frames(v, 1, false, 'cow cut ' + cut);
  if (!r) continue;
  const last = r.frames[r.frames.length - 1].tables[0];
  t.eq(last.rows.map((x) => x[2]), [String('rocks at the point'.length)], `cow cut ${cut}: chart still holds its old bytes`);
}

// ---- log-structured: the write cost by its definition ------------------------------------------------------------------
{
  const v = setup({ mode: 'lfs', lcmds: FL.toRows('create a\ncreate b\nwrite a 0 [300 bytes]\nwrite b 0 [300 bytes]\nsync\nchurn 30\nclean 2', 'cmd') });
  const r = frames(v, 3, false, 'lfs cost');
  const m = Object.fromEntries(r.frames[r.frames.length - 1].metrics.map((x) => [x.label, x.value]));
  const [cr] = String(m['Cleaner: read, wrote']).split(', ').map(Number);
  t.ok(typeof m['Write cost'] === 'number' && m['Write cost'] >= 1, 'lfs: a write cost of at least 1');
  t.ok(cr >= 0, 'lfs: the cleaner read count');
  // the cost by its definition, from the counts shown: (blocks written + cleaner reads) / new data blocks
  const nb = m['New data blocks'], wr = m['Blocks written'];
  t.ok(nb > 0 && wr > nb, 'lfs: more blocks written than new data');
  t.ok(Math.abs(m['Write cost'] - (wr + cr) / nb) < 0.001, `lfs: write cost ${m['Write cost']} = (${wr} written + ${cr} read by the cleaner) / ${nb} new`);
}

// ---- distributed: the counts come from the messages -----------------------------------------------------------------
for (const p of lab.setup.presets.filter((x) => x.values.mode === 'dfs')) {
  const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), sim = S.DFS.run(FL.dfsCfg(v));
  const m = Object.fromEntries(r.frames[r.frames.length - 1].metrics.map((x) => [x.label, x.value]));
  t.eq(m.Messages, sim.messages.length, p.label + ': messages counted');
  t.eq(m['Bytes on the wire'], sim.messages.reduce((a, x) => a + x.bytes, 0), p.label + ': bytes summed');
  t.eq(m['Stale reads'], sim.reads.filter((x) => x.stale).length, p.label + ': stale reads counted');
}

// ---- the parser refuses what it should ------------------------------------------------------------------------------
for (const [src, why] of [['frobnicate /x', 'unknown'], ['create notes', 'absolute'], ['write /a x hello', 'whole number'], ['chmod /a 999', 'octal']]) {
  const p = FL.parse(src);
  t.ok(p.error && new RegExp(why).test(p.error.msg), 'the parser refuses "' + src + '" (' + (p.error && p.error.msg) + ')');
}
t.done();
