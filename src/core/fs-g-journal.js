// A block-level file system, part 7: writing transactions to disk, journaling, crashes and recovery.
//   F.commit(img, tx, opts) -> {writes: [{i, block, kind, phase, say, seq, home}], applied, crashed, seq, mode}
//     opts.mode: 'none'      every changed block straight home (inodes, bitmaps, then the rest); no guarantee
//                'writeback' metadata journaled; data written home after the commit, so a crash can leave
//                            metadata pointing at blocks that never got their data (stale contents)
//                'ordered'   data home first, then the metadata journaled: metadata never points at unwritten data
//                            (opts.journal: true means 'ordered', as in phase 1)
//                'data'      data and metadata both journaled: an operation is all or nothing, even an overwrite
//     opts.checkpoint: 'eager' (the default: checkpoint and free the log at once) or 'lazy' (committed blocks stay
//                in the log and in memory, img.overlay, until the log fills or F.checkpoint is called; the log is
//                circular and wraps)
//     opts.revoke (default true): a block the log holds as old metadata, now reused for data written in place, is
//                revoked so replay does not copy the old metadata over it
//     opts.defer (mode 'none'): leave the blocks dirty in memory (write-back caching) for F.flush
//     opts.crashAfter: k cuts the power after k writes (then F.crash: memory is lost)
//   F.cloneLive(img)        a copy of the disk and of the memory a crash would lose
//   F.crash(img)            memory is lost: the overlay, the journal's in-memory state, the open-file counts
//   F.replay(img) -> {replayed, seq, steps, txs}   every committed transaction after the last one done, in order
//   F.recover(img) -> {steps}  replay, then free the inodes on the orphan list (opened files unlinked before a crash)
//   F.checkpoint(img, {crashAfter}) -> {writes, applied}   write every committed block home and free the log
//   F.flush(img, {crashAfter}) -> {writes, applied}        write every dirty block home (checkpointing first)
//   F.journalState(img) -> {done, head, log: [{kind: 'TxB'|'TxE'|'data'|'empty', label, seq, homes, revokes}]}
//   The kinds 'TxB' and 'TxE' (and the replay step kind 'replay-txb') are identifiers kept stable for callers; what a
//   reader sees is the label: 'begin 3' for a transaction's begin block, 'commit 3' for its commit block.
//   F.apply(img, op, args, opts) -> {tx, result, trace, commit}   prepare (as opts.cred) and commit
//   F.MODES, F.GUARANTEE (a sentence per mode)
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const JSB = 0x4a534221, BEGIN = 0x54584221, COMMIT = 0x54584521;
  const NAME = { super: 'superblock', inode: 'inode-table block', ibm: 'inode bitmap', dbm: 'data bitmap', fat: 'FAT block', indirect: 'indirect block', dir: 'directory block', link: 'symlink block', data: 'data block' };
  F.MODES = ['none', 'writeback', 'ordered', 'data'];
  F.GUARANTEE = {
    none: 'No guarantee: a crash can leave any mix of old and new blocks; fsck must find and repair the damage, and stale data can stay unseen.',
    writeback: 'The metadata is always consistent after replay, but a file may point at blocks whose new data never arrived: it can show stale contents.',
    ordered: 'The metadata is consistent and never points at unwritten data; an overwrite of existing data can still be half done.',
    data: 'Every operation is all or nothing, data included: after replay a file is wholly old or wholly new.',
  };
  F.blockName = (w) => (w.kind === 'ibm' || w.kind === 'dbm' || w.kind === 'super' ? NAME[w.kind] : NAME[w.kind] + ' ' + w.block);
  const modeOf = (o) => o.mode || (o.journal === true ? 'ordered' : o.journal || 'none');
  const logLen = (g) => g.jblocks - 1;
  const jsbRead = (img) => { const u = F.block(img, img.g.jStart); return F.get32(u, 0) === JSB ? { done: F.get32(u, 4), head: F.get32(u, 8) } : { done: 0, head: 0 }; };
  const jsbBytes = (g, done, head) => { const j = new Uint8Array(g.bs); F.put32(j, 0, JSB); F.put32(j, 4, done); F.put32(j, 8, head); return j; };
  /** the journal's in-memory state: where the next transaction goes, and the committed ones not yet checkpointed */
  function jmem(img) {
    if (!img.jmem) { const s = jsbRead(img); img.jmem = { next: s.head, seq: s.done + 1, live: [] }; }
    return img.jmem;
  }
  const overlay = (img) => img.overlay || (img.overlay = new Map());

  F.journalState = function (img) {
    const g = img.g;
    if (!g.jblocks) return null;
    const s = jsbRead(img), log = [];
    for (let i = 1; i < g.jblocks; i++) {
      const u = F.block(img, g.jStart + i), m = F.get32(u, 0);
      if (m === BEGIN) { const n = F.get32(u, 8), r = F.get32(u, 12), homes = [], revokes = []; for (let k = 0; k < n; k++) homes.push(F.get32(u, 16 + 4 * k)); for (let k = 0; k < r; k++) revokes.push(F.get32(u, 16 + 4 * (n + k))); log.push({ kind: 'TxB', label: 'begin ' + F.get32(u, 4), seq: F.get32(u, 4), homes, revokes }); }
      else if (m === COMMIT) log.push({ kind: 'TxE', label: 'commit ' + F.get32(u, 4), seq: F.get32(u, 4) });
      else log.push({ kind: u.some((x) => x) ? 'data' : 'empty' });
    }
    return { done: s.done, head: s.head, log };
  };

  /** write a plan's first k writes; a cut means a crash */
  function run(img, plan, opts) {
    const stop = opts.crashAfter === undefined || opts.crashAfter === null ? plan.length : Math.max(0, Math.min(plan.length, opts.crashAfter));
    for (let i = 0; i < stop; i++) { F.block(img, plan[i].block).set(plan[i].bytes); if (plan[i].after) plan[i].after(); }
    const crashed = stop < plan.length;
    if (crashed) F.crash(img);
    return { writes: plan.map((p, i) => ({ i, block: p.block, kind: p.kind, label: p.label, phase: p.phase, say: p.say, seq: p.seq, home: p.home, homeKind: p.homeKind })), applied: stop, crashed };
  }

  /** checkpoint the oldest committed transactions (all of them, or until `need` log blocks are free) */
  function checkpointPlan(img, need) {
    const g = img.g, J = jmem(img), plan = [], len = logLen(g), ov = overlay(img);
    let take;
    if (need === undefined) take = J.live.slice();
    else { take = []; let free = len - J.live.reduce((a, t) => a + t.len, 0); for (const t of J.live) { if (free >= need) break; take.push(t); free += t.len; } }
    J.live = J.live.slice(take.length);
    if (!take.length) return plan;
    const later = new Set(J.live.flatMap((t) => t.homes));
    for (const t of take) for (const h of t.homes) {
      const bytes = (ov.get(h) || t.blocks.get(h)).slice();
      plan.push({ block: h, kind: t.kinds.get(h), bytes, phase: 'checkpoint', seq: t.seq, say: `Checkpoint transaction ${t.seq}: write the ${F.blockName({ kind: t.kinds.get(h), block: h })} home.`, after: () => { if (!later.has(h)) ov.delete(h); } });
    }
    const last = take[take.length - 1], head = J.live.length ? J.live[0].start : J.next;
    plan.push({ block: g.jStart, kind: 'jsb', bytes: jsbBytes(g, last.seq, head), phase: 'free', seq: last.seq, say: take.length === 1 ? `Mark transaction ${last.seq} done in the journal superblock: its log space is free again.` : `Mark transactions ${take[0].seq}–${last.seq} done in the journal superblock: their log space is free again.` });
    return plan;
  }
  F.checkpoint = (img, opts) => run(img, checkpointPlan(img), opts || {});

  F.commit = function (img, tx, opts) {
    opts = opts || {};
    const g = img.g, mode = modeOf(opts), list = tx.writes(), plan = [];
    if (mode === 'none') {
      if (opts.defer) { const ov = overlay(img); for (const w of list) ov.set(w.block, w.bytes); img.dirty = new Set([...(img.dirty || []), ...list.map((w) => w.block)]); return { writes: [], applied: 0, crashed: false, mode, deferred: list.map((w) => w.block) }; }
      for (const w of list) plan.push({ block: w.block, kind: w.kind, bytes: w.bytes, phase: 'home', say: `Write the ${F.blockName(w)} in place.`, after: () => { if (img.overlay) img.overlay.delete(w.block); } });
      return Object.assign(run(img, plan, opts), { mode });
    }
    if (!g.jblocks) throw new Error('this image has no journal');
    const J = jmem(img), len = logLen(g), L = g.jStart + 1, lazy = opts.checkpoint === 'lazy';
    const logged = mode === 'data' ? list : list.filter((w) => w.meta), home = mode === 'data' ? [] : list.filter((w) => !w.meta);
    // revoke: data going home over a block that the log still holds as an older copy
    const inLog = new Set(J.live.flatMap((t) => t.homes)), revokes = opts.revoke === false ? [] : home.filter((w) => inLog.has(w.block)).map((w) => w.block);
    const n = logged.length, need = n + 2;
    if (need > len) throw new Error('the transaction needs ' + need + ' log blocks; the journal has ' + len);
    if (16 + 4 * (n + revokes.length) > g.bs) throw new Error('too many blocks for one begin block');
    // room in the circular log: checkpoint the oldest transactions first if needed
    if (J.live.length && len - J.live.reduce((a, t) => a + t.len, 0) < need) plan.push(...checkpointPlan(img, need));
    const seq = J.seq, start = J.next, at = (k) => L + ((start + k) % len);
    const dataWrite = (w, phase, say) => ({ block: w.block, kind: 'data', bytes: w.bytes, phase, seq, say, after: () => { if (img.overlay) img.overlay.delete(w.block); } });
    if (mode === 'ordered') for (const w of home) plan.push(dataWrite(w, 'data', `Write the new data, ${F.blockName(w)}, in place first: no metadata points to it until the transaction commits.`));
    const b = new Uint8Array(g.bs);
    F.put32(b, 0, BEGIN); F.put32(b, 4, seq); F.put32(b, 8, n); F.put32(b, 12, revokes.length);
    logged.forEach((w, k) => F.put32(b, 16 + 4 * k, w.block)); revokes.forEach((r, k) => F.put32(b, 16 + 4 * (n + k), r));
    plan.push({ block: at(0), kind: 'TxB', bytes: b, phase: 'log', seq, label: 'begin ' + seq, say: `Write the begin block of transaction ${seq} to the log: it lists the home of ${n === 1 ? 'the one block that follows' : 'each of the ' + n + ' blocks that follow'} (${logged.map((w) => w.block).join(', ')})${revokes.length ? ' and revokes the old logged ' + (revokes.length === 1 ? 'copy of block ' : 'copies of blocks ') + revokes.join(', ') : ''}.` });
    logged.forEach((w, k) => plan.push({ block: at(1 + k), kind: 'log', home: w.block, homeKind: w.kind, bytes: w.bytes, phase: 'log', seq, say: `Log a copy of the new ${F.blockName(w)} in journal block ${at(1 + k)}.` }));
    const e = new Uint8Array(g.bs); F.put32(e, 0, COMMIT); F.put32(e, 4, seq);
    const t = { seq, start, len: need, homes: logged.map((w) => w.block), blocks: new Map(logged.map((w) => [w.block, w.bytes])), kinds: new Map(logged.map((w) => [w.block, w.kind])) };
    plan.push({ block: at(1 + n), kind: 'TxE', label: 'commit ' + seq, bytes: e, phase: 'commit', seq, say: `Write the commit block: transaction ${seq} is committed. From here on a crash is repaired by replaying it.`, after: () => { J.live.push(t); J.next = (start + need) % len; J.seq = seq + 1; const ov = overlay(img); for (const w of logged) ov.set(w.block, w.bytes); } });
    if (mode === 'writeback') for (const w of home) plan.push(dataWrite(w, 'data', `Write the data, ${F.blockName(w)}, in place after the commit: until it lands, the committed metadata points at whatever the block held before.`));
    if (!lazy) plan.push(...checkpointPlan2(img, t));
    const r = run(img, plan, opts);
    return Object.assign(r, { seq, mode, revokes });
  };
  // eager: checkpoint this transaction once it is committed, and any older ones still in the log (left there by
  // lazy commits before it), so the journal superblock can mark them all done
  function checkpointPlan2(img, t) {
    const g = img.g, J = jmem(img), ov = overlay(img), older = J.live.slice(), out = [];
    const homes = [...new Set(older.flatMap((x) => x.homes).concat(t.homes))];
    const kind = (h) => t.kinds.get(h) || older.map((x) => x.kinds.get(h)).find(Boolean);
    for (const h of homes) {
      const bytes = (t.blocks.get(h) || ov.get(h) || older.map((x) => x.blocks.get(h)).find(Boolean)).slice();
      out.push({ block: h, kind: kind(h), bytes, phase: 'checkpoint', seq: t.seq, say: `Checkpoint: write the ${F.blockName({ kind: kind(h), block: h })} home.`, after: () => { if (img.overlay) img.overlay.delete(h); } });
    }
    out.push({ block: g.jStart, kind: 'jsb', bytes: jsbBytes(g, t.seq, (t.start + t.len) % logLen(g)), phase: 'free', seq: t.seq, say: older.length ? `Mark transactions ${older[0].seq}–${t.seq} done in the journal superblock: the log is free again.` : `Mark transaction ${t.seq} done in the journal superblock: the log is free again.`, after: () => { J.live = J.live.filter((x) => x !== t && !older.includes(x)); } });
    return out;
  }

  F.cloneLive = function (img) {
    const c = F.clone(img);
    if (img.overlay) c.overlay = new Map([...img.overlay].map(([b, u]) => [b, u.slice()]));
    if (img.jmem) c.jmem = { next: img.jmem.next, seq: img.jmem.seq, live: img.jmem.live.slice() };
    if (img.open) c.open = new Map(img.open);
    if (img.dirty) c.dirty = new Set(img.dirty);
    return c;
  };
  F.crash = function (img) { img.overlay = null; img.jmem = null; img.open = null; img.dirty = null; return img; };

  F.replay = function (img) {
    const g = img.g, steps = [];
    if (!g.jblocks) return { replayed: false, steps: [{ kind: 'no-journal', say: 'This file system has no journal to replay.' }], txs: [] };
    const s = jsbRead(img), len = logLen(g), L = g.jStart + 1, txs = [];
    let pos = s.head, seq = s.done + 1, scanned = 0, discarded = null;
    while (scanned < len) {
      const b = F.block(img, L + (pos % len));
      if (F.get32(b, 0) !== BEGIN || F.get32(b, 4) !== seq) break;
      const n = F.get32(b, 8), r = F.get32(b, 12), homes = [], revokes = [];
      for (let k = 0; k < n; k++) homes.push(F.get32(b, 16 + 4 * k));
      for (let k = 0; k < r; k++) revokes.push(F.get32(b, 16 + 4 * (n + k)));
      const e = F.block(img, L + ((pos + 1 + n) % len));
      if (n + 2 > len - scanned || F.get32(e, 0) !== COMMIT || F.get32(e, 4) !== seq) { discarded = { seq, homes }; break; }
      txs.push({ seq, pos, homes, revokes });
      scanned += n + 2; pos = (pos + n + 2) % len; seq++;
    }
    if (!txs.length && !discarded) {
      steps.push({ kind: 'replay-none', say: `The journal superblock says transaction ${s.done} is the last one done, and the log holds no begin block for transaction ${s.done + 1}: there is nothing to replay.`, done: s.done });
      return { replayed: false, steps, txs };
    }
    const revokedBy = new Map();
    for (const t of txs) for (const r of t.revokes) revokedBy.set(r, Math.max(revokedBy.get(r) || 0, t.seq));
    for (const t of txs) {
      steps.push({ kind: 'replay-txb', say: `The log holds the begin block of transaction ${t.seq}, listing ${t.homes.length} block${t.homes.length === 1 ? '' : 's'} (homes ${t.homes.join(', ')}).`, seq: t.seq, homes: t.homes });
      const copied = [], skipped = [];
      t.homes.forEach((h, k) => { if ((revokedBy.get(h) || 0) > t.seq) { skipped.push(h); return; } F.block(img, h).set(F.block(img, L + ((t.pos + 1 + k) % len))); copied.push(h); });
      steps.push({ kind: 'replay-copy', say: `The commit block of transaction ${t.seq} is there: ${copied.length === 1 ? 'the logged block is' : 'the ' + copied.length + ' logged blocks are'} copied home again (${copied.join(', ')}), whatever the checkpoint had managed${skipped.length ? '; ' + (skipped.length === 1 ? 'block ' + skipped[0] + ' is' : 'blocks ' + skipped.join(', ') + ' are') + ' skipped, revoked by a later transaction' : ''}.`, seq: t.seq, homes: copied, skipped });
    }
    const last = txs.length ? txs[txs.length - 1].seq : s.done;
    F.block(img, g.jStart).set(jsbBytes(g, last, pos));
    if (txs.length) steps.push({ kind: 'replay-done', say: `The journal superblock now marks transaction ${last} done.`, seq: last });
    if (discarded) steps.push({ kind: 'replay-txb', say: `The log holds the begin block of transaction ${discarded.seq}, listing ${discarded.homes.length} block${discarded.homes.length === 1 ? '' : 's'} (homes ${discarded.homes.join(', ')}).`, seq: discarded.seq, homes: discarded.homes });
    if (discarded) steps.push({ kind: 'replay-discard', say: `There is no commit block for transaction ${discarded.seq}: it never committed, so it is thrown away and the old metadata stands.`, seq: discarded.seq });
    img.jmem = null;
    return { replayed: txs.length > 0, seq: last, steps, txs };
  };

  F.recover = function (img) {
    F.crash(img);
    const r = F.replay(img), steps = r.steps.slice(), orph = F.orphans(img);
    if (orph.length) {
      const tx = new F.Tx(img);
      F.setOrphans(tx, []);
      for (const i of orph) { const n = tx.inode(i); if (n.type && !n.nlink) F.releaseInode(tx, i); }
      for (const w of tx.writes()) F.block(img, w.block).set(w.bytes);
      steps.push({ kind: 'orphans', say: `The orphan list names inode${orph.length === 1 ? '' : 's'} ${orph.join(', ')}: unlinked while open when the power failed, ${orph.length === 1 ? 'it is' : 'they are'} freed now.`, inos: orph });
    }
    return { steps, replay: r };
  };

  F.flush = function (img, opts) {
    const plan = img.jmem && img.jmem.live.length ? checkpointPlan(img) : [];
    const ov = img.overlay, dirty = img.dirty ? [...img.dirty] : [];
    for (const b of dirty.sort((a, c) => a - c)) if (ov && ov.has(b)) plan.push({ block: b, kind: F.region(img.g, b), bytes: ov.get(b).slice(), phase: 'flush', say: `Flush dirty block ${b} home.`, after: () => { ov.delete(b); img.dirty.delete(b); } });
    return run(img, plan, opts || {});
  };

  F.apply = function (img, op, args, opts) {
    opts = opts || {};
    const tx = F.prepareAs(img, { cred: opts.cred }, op, args || []);
    const c = F.commit(img, tx, opts);
    return { tx, result: tx.result, trace: tx.trace, commit: c };
  };
  (S.engines = S.engines || []).push({ name: 'File system, fsck and journal' });
})(globalThis.Proses = globalThis.Proses || {});
