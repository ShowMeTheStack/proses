// Every sentence the file-system and distributed-file-system engines produce, gathered by running each of their
// functions over seeded inputs (every allocation method and journaling mode, crashes, errors, the open-file layer,
// copy-on-write, log-structured, and NFS and AFS timelines), then scanned for slips: a count that disagrees with
// its noun ("1 bytes", "3 block", also after × and ·), a or an before the wrong sound, a doubled word, and
// undefined, NaN or [object] leaking in.
import { load, harness, rng } from './load.mjs';

const t = harness('fs-say');
const S = load(['core']);
const F = S.FS, C = F.cow, L = F.lfs, D = S.DFS;
const says = [];
const take = (list, where) => { for (const s of list || []) if (s && typeof s.say === 'string') says.push([where, s.say]); };
const tryIt = (fn) => { try { return fn(); } catch (e) { says.push(['error', e.message]); return null; } };

// ---- the block file system in every allocation method and journaling mode ----
for (const alloc of F.ALLOCS) {
  for (const mode of ['none', 'writeback', 'ordered', 'data']) {
    const R = rng(alloc.length * 7 + mode.length), img = F.mkfs({ bs: 128, nblocks: 140, ninodes: 24, ndirect: 3, ps: 4, jblocks: 12, alloc, groups: alloc === 'fat' ? 1 : 1 + Math.floor(R() * 2) }, 'old disk ');
    const names = [];
    const ops = [['mkdir', '/d'], ['create', '/d/one'], ['write', '/d/one', 0, 'a'], ['write', '/d/one', 0, 'x'.repeat(300)], ['symlink', '/d/one', '/s'], ['link', '/d/one', '/two'], ['truncate', '/d/one', 1], ['truncate', '/d/one', 129], ['rename', '/two', '/d/three'], ['unlink', '/d/three'], ['create', '/e'], ['rmdir', '/d']];
    for (let i = 0; i < 12; i++) { const n = '/r' + i; ops.push(['create', n]); ops.push(['write', n, Math.floor(R() * 200), 'q'.repeat(1 + Math.floor(R() * 260))]); names.push(n); }
    ops.push(['unlink', names[0]], ['chmod', '/e', 0o600], ['chown', '/e', 3, 4]);
    if (alloc === 'contiguous') ops.push(['compact']);
    for (const [op, ...args] of ops) {
      const r = tryIt(() => F.apply(img, op, args, { mode, checkpoint: R() < 0.5 ? 'lazy' : 'eager' }));
      if (r) { take(r.trace, op); take(r.commit.writes, op + ' write'); }
      if (process.env.DBG && !F.fsck(img).ok) { console.log('BROKEN after', alloc, mode, op, args[0], F.fsck(img).problems.map((p) => p.say)); process.exit(1); }
    }
    take(tryIt(() => F.apply(img, 'write', ['/e', 0, 'no'], { cred: { uid: 9, gid: 9 } })) ? [] : [], 'perm');
    const tx = new F.Tx(img, { cred: { uid: 9, gid: 9 } }); tryIt(() => F.access(tx, F.lookup(img, '/e').ino, 2, '/e')); take(tx.trace, 'access');
    const lk = tryIt(() => F.lookup(img, '/s')); if (!lk) console.log('LOOKUP FAIL', alloc, mode, F.fsck(img).problems.map((p) => p.say)); else take(lk.steps, 'lookup');
    for (const N of [0, 1, 130, 700]) take(tryIt(() => F.walk(img, F.lookup(img, '/d/one', { quiet: true }).ino || 2, N).steps), 'walk');
    for (const p of ['sequential', 'direct']) take(tryIt(() => F.accessCost(img, names[3], p, { seed: 2 }).steps), 'access');
    for (const m of ['bitmap', 'list', 'grouping', 'counting']) take([F.freeSpace(img, m)], 'free');
    if (mode !== 'none') {
      for (let k = 0; k < 9; k++) {
        const c = F.cloneLive(img), r = tryIt(() => F.apply(c, 'append', ['/e', 'z'.repeat(40 * k)], { mode, crashAfter: k }));
        if (r) take(r.commit.writes, 'crash write');
        const rec = F.recover(c); take(rec.steps, 'recover');
        take(F.fsck(c).problems, 'fsck');
      }
      take(F.checkpoint(F.cloneLive(img)).writes, 'checkpoint');
      take(F.flush(F.cloneLive(img)).writes, 'flush');
    }
    // damage, for fsck and repair to describe
    const bad = F.clone(img);
    F.markBlock(new F.Tx(bad), F.dataBlocks(bad.g)[30], true);
    for (let b = 1; b < 6; b++) F.block(bad, b)[3] ^= 0x5a;
    take(F.fsck(bad, { disk: true }).problems, 'fsck damage');
    F.repair(bad).forEach((x) => says.push(['repair', x]));
  }
}
// ---- the open-file layer and costs ----
for (const cache of [{ capacity: 0 }, { capacity: 6, policy: 'write-back', sync: 3 }, { capacity: 6, policy: 'write-through', unified: false }]) {
  const img = F.mkfs({ bs: 128, nblocks: 80, ninodes: 16, ndirect: 3, ps: 4, jblocks: 10 }), sys = new F.Sys(img, { cache, mode: cache.capacity ? 'none' : 'ordered' });
  sys.proc(2, { uid: 5, gid: 5 });
  const fd = sys.open(1, '/f', 'rwc').result;
  sys.write(1, fd, 'a'); sys.write(1, fd, 'bcdef'); sys.lseek(1, fd, 0, 'set'); sys.read(1, fd, 1); sys.read(1, fd, 4);
  sys.dup(1, fd); sys.fork(1, 3); sys.fork(2, 4);
  const one = sys.open(1, '/g', 'wc').result; sys.fork(1, 5);
  sys.op(1, 'mkdir', '/m'); sys.mount('/m', F.mkfs({ bs: 128, nblocks: 40, ninodes: 8, ndirect: 3, ps: 4 }));
  sys.op(1, 'create', '/m/x'); tryIt(() => sys.op(1, 'rename', '/f', '/m/f'));
  sys.op(1, 'unlink', '/f'); sys.close(1, fd); sys.close(3, fd); sys.close(1, 1); sys.close(3, 1); sys.close(1, one); sys.close(5, one);
  tryIt(() => sys.open(2, '/g', 'w')); sys.tick(5); sys.sync(); sys.umount('/m');
  const o2 = sys.open(1, '/h', 'wc').result; sys.write(1, o2, 'h'); sys.op(1, 'unlink', '/h');
  sys.crash(); take(sys.recover().steps, 'sys recover');
  take(sys.trace, 'sys');
  for (const r of F.costs({ bs: 128, nblocks: 80, ninodes: 16, ndirect: 3, ps: 4 }, { cache, text: 'x' })) says.push(['costs', r.say]);
}
// ---- copy-on-write ----
{
  const img = C.mkfs({ bs: 128, nblocks: 80 });
  for (const [op, ...a] of [['create', 'atlas'], ['write', 'atlas', 0, 'x'], ['append', 'atlas', 'y'.repeat(300)], ['create', 'b'], ['snapshot'], ['rename', 'b', 'c'], ['delete', 'atlas']]) { const r = C.apply(img, op, a); take(r.plan.steps, 'cow'); take(r.plan.writes, 'cow write'); }
  take(C.mount(img).steps, 'cow mount'); take(C.scrub(img).steps, 'scrub');
  C.corrupt(img, [...C.tree(img).blocks.keys()][0], 1); take(C.scrub(img).steps, 'scrub bad'); take(C.check(img).problems, 'cow check');
  take(C.prepare(C.mkfs(), 'dropSnapshot', 1).steps, 'cow drop');
}
// ---- log-structured ----
for (const policy of ['greedy', 'cost-benefit']) {
  const R = rng(policy.length), fs = L.mkfs({ bs: 128, segBlocks: 16, nsegs: 10, ninodes: 32, policy });
  for (let i = 0; i < 60; i++) {
    const names = L.list(fs).map((e) => e.name);
    if (!names.length || R() < 0.2) take(L.create(fs, 'f' + i).steps, 'lfs');
    else if (R() < 0.85) take(L.write(fs, names[Math.floor(R() * names.length)], Math.floor(R() * 100), 'w'.repeat(1 + Math.floor(R() * 150))).steps, 'lfs');
    else take(L.delete(fs, names[0]).steps, 'lfs');
    if (i % 5 === 0) take(L.sync(fs).steps, 'lfs sync');
  }
  take(L.clean(fs, { policy, count: 1 }).steps, 'lfs clean');
  take(L.clean(fs, { policy, count: 3 }).steps, 'lfs clean');
  take(L.mount(fs.img).mountSteps, 'lfs mount');
  take(L.check(fs).problems, 'lfs check');
}
// ---- distributed ----
{
  const scripts = [
    [{ t: 0, c: 'A', op: 'open', file: 'f' }, { t: 0, c: 'A', op: 'read', file: 'f' }, { t: 0, c: 'B', op: 'open', file: 'f' }, { t: 0, c: 'B', op: 'write', file: 'f', data: 'n' }, { t: 0, c: 'B', op: 'read', file: 'f' }, { t: 0, c: 'B', op: 'close', file: 'f' }, { t: 5, c: 'A', op: 'read', file: 'f' }, { t: 5, c: 'A', op: 'close', file: 'f' }, { t: 9, c: 'A', op: 'open', file: 'f' }, { t: 9, c: 'A', op: 'read', file: 'f' }],
    [{ t: 1, c: 'A', op: 'remove', file: 'f' }, { t: 1, c: 'B', op: 'create', file: 'g' }, { t: 3, c: 'B', op: 'create', file: 'g' }, { t: 4, c: 'C', op: 'read', file: 'zz' }, { t: 6, c: 'C', op: 'open', file: 'zz' }],
  ];
  for (const protocol of ['nfs', 'afs']) for (const script of scripts) for (const extra of [{}, { crashes: [{ t: 3, until: 5 }] }, { drops: [{ t: 2, dir: 'reply' }], probe: 4, attrTimeout: 1 }, { dupCache: false, drops: [{ t: 1 }] }]) {
    const r = D.run(Object.assign({ protocol, clients: ['A', 'B', 'C'], files: { f: 'o' }, script }, extra));
    take(r.events, 'dfs'); take(r.outcomes, 'dfs');
  }
}

// ---- the scan ----
const SING = 'block|byte|entry|descriptor|reference|link|write|read|hop|record|file|segment|piece|inode|extent|tick|run|message|transaction|bit|blocks?|pointer|copy|problem|step|client|group|level|directory|retry|try|error|slot|chunk|disk|time|turn|seek|fix'.split('|').filter((w) => !w.endsWith('?'));
const PLURAL = { entry: 'entries', directory: 'directories', copy: 'copies', retry: 'retries', try: 'tries' };
const plural = (w) => PLURAL[w] || w + 's';
const singularRe = new RegExp(`(?:^|[\\s(×·])(?:0|[2-9]|\\d{2,}) (${SING.join('|')})\\b(?!-| [a-z-]+s\\b)`, 'i');
const pluralRe = new RegExp(`(?<!(?:process|byte|block|inode|descriptor|entry|transaction|segment|offset|group|region|disk|client))(?:^|[\\s(×·])1 (${SING.map(plural).join('|')})\\b`, 'i');
const aRe = /\ba ([aeiou]\w*|8\d*|11|18|1[1-9]?\b|FAT|NFS|AFS|LRU|LFS|FFS)/, anRe = /\b[Aa]n ([b-df-hj-np-tv-z]\w*|[02-79]\d*\b)/;
const A_OK = /^(u[nsr]\w*|one\w*|eu\w*|1[02-79]\d*)$/i;   // "a unit", "a one-block", "a 12" are right
const AN_OK = /^(h(our|onest)\w*|FAT|NFS|LFS|FFS|LRU|SSD|MRU|RPC|x\w*)$/;
function scan(s) {
  const bad = [];
  const m1 = s.match(singularRe); if (m1) bad.push('a count with a singular noun: ' + m1[0].trim());
  const m2 = s.match(pluralRe); if (m2) bad.push('one with a plural noun: ' + m2[0].trim());
  const m3 = s.match(aRe); if (m3 && !A_OK.test(m3[1])) bad.push('a before a vowel sound: ' + m3[0]);
  const m4 = s.match(anRe); if (m4 && !AN_OK.test(m4[1])) bad.push('an before a consonant sound: ' + m4[0]);
  const m6 = s.match(new RegExp(`(?:^|[\\s(×·])1 (${SING.join('|')}) (are|were|fail|hold|name|say|point|follow)\\b`, 'i')); if (m6) bad.push('one with a plural verb: ' + m6[0].trim());
  const m7 = s.match(/(?:^|[;:(]\s*|[a-z], |\b(?:and|but|so) )(\d+(?:, \d+)*) (are|is|were|was) /); if (m7) bad.push('a bare number as the subject: ' + m7[0].trim());
  const m5 = s.match(/\b(\w+) \1\b/i); if (m5 && !/^\d+$/.test(m5[1])) bad.push('a doubled word: ' + m5[0]);
  if (/undefined|NaN|\[object|null\b/.test(s)) bad.push('undefined, NaN or [object]');
  if (/\bTx[BE]\b/.test(s)) bad.push('TxB or TxE: say the begin block or the commit block');
  return bad;
}
let n = 0;
for (const [where, s] of says) { n++; const bad = scan(s); t.ok(!bad.length, `${where}: ${bad.join('; ')} — "${s}"`); }
// the scan itself catches the slips found by reading: each of these must be flagged
for (const s of ['Process 1 writes 1 bytes through descriptor 0.', 'so each of its 1 descriptors points to the same entry.', 'it lists the home of each of the 1 blocks that follow (5).', 'whatever the checkpoint had managed; 30 are skipped, revoked by a later transaction.', 'Scrub: 1 block fail their checksums (7).', 'its 1 block are copied from 27 to 33.', 'and 0, 1 are free again.', 'a total of 3 block.', 'a × 2 block', 'Read an block.', 'Take a inode.', 'the the block', 'block undefined', 'NaN bytes', 'Write TxE: transaction 3 is committed.']) t.ok(scan(s).length > 0, 'the scan flags: ' + s);
t.ok(n > 1500, `${n} sentences scanned`);
t.ok(new Set(says.map((x) => x[1])).size > 300, 'many different sentences');
t.done();
