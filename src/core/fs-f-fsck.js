// A block-level file system, part 6: fsck. It reads the whole image and checks that its parts agree:
//   the superblock against the geometry; the inode bitmap against the inodes; every pointer (or chain, run, extent)
//   inside the data region and every block owned once; the data bitmap (or the FAT) against the blocks the inodes
//   own (a block marked used that nobody owns is a leak; a block owned but marked free will be handed out twice);
//   the number of mapped blocks against the size; directories ('.', '..', entries naming live inodes); every live
//   inode reachable from the root, or on the superblock's orphan list with no links; every link count equal to the
//   entries that name the inode.
//   F.fsck(img, {disk: true}) -> {ok, problems: [{kind, say, ...}], owners: Map(block -> ino), refs, live, reach}
//       (by default it reads the file system as mounted, overlay first; disk: true reads only what is on disk)
//   F.repair(img) -> [fix sentences]: pointers outside the data region cleared, dangling entries removed, '.' and
//       '..' restored, orphans and unreachable inodes freed, link counts set, the bitmaps (or FAT marks) rebuilt.
//       The same fixes as structured steps are on the result's .steps: [{kind, say, ...}] with kinds
//         clear-pointer {ino, block}        empty-inode {ino}
//         remove-entry {entry, ino, dir, block}   (entry: the name; ino: the inode it named; dir: the directory's inode)
//         restore-entry {entry: '.'|'..', ino, dir, block}   free-unlinked {ino}   free-orphan {ino}
//         set-nlink {ino, from, nlink}      mark-inode {ino, used}   mark-block {block, used, map: 'bitmap'|'fat'}
//   fsck problems carry their fields too; a dangling-entry problem has {entry, dir, target, block, off} (and ino = dir).
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});

  F.fsck = function (img, o) {
    o = o || {};
    const g = img.g, problems = [], bad = (kind, say, d) => problems.push(Object.assign({ kind, say }, d || {}));
    const read = o.disk ? (b) => F.block(img, b) : (b) => F.readBlock(img, b);
    const sb = F.decodeSuper(read(0));
    if (sb.magic !== F.MAGIC) bad('superblock', 'The superblock has no valid magic number.');
    for (const k of F.SB_FIELDS) if (sb[k] !== g[k]) bad('superblock', `The superblock says ${k} = ${sb[k]}, but the layout has ${g[k]}.`, { field: k });
    const ibit = (i) => { const l = F.ibmLoc(g, i); return F.getBit(read(l.block), l.bit); };
    if (!ibit(0)) bad('inode-bitmap', 'Inode 0 is reserved but not marked in the inode bitmap.', { ino: 0 });
    const live = new Map(), owners = new Map(), orphans = new Set(F.orphans(img, read));
    const decode = (i) => { const a = F.inodeAt(g, i); return F.decodeInode(g, read(a.block), a.off); };
    for (let i = 1; i < g.ninodes; i++) {
      const n = decode(i), used = ibit(i);
      if (n.type > F.T_LINK) { bad('bad-type', `Inode ${i} has type ${n.type}, which is not a file, a directory or a link.`, { ino: i }); continue; }
      if (used && n.type === F.T_FREE) bad('inode-bitmap', `Inode ${i} is marked used in the inode bitmap but is free.`, { ino: i });
      if (!used && n.type !== F.T_FREE) bad('inode-bitmap', `Inode ${i} is in use but free in the inode bitmap.`, { ino: i });
      if (n.type !== F.T_FREE) live.set(i, n);
    }
    const inData = (b) => b > 0 && b < g.nblocks && F.isData(g, b);
    const own = (b, ino, what) => {
      if (owners.has(b)) { bad('dup-block', `Block ${b} is claimed by inode ${owners.get(b)} and again by inode ${ino} (${what}).`, { block: b, ino }); return false; }
      owners.set(b, ino); return true;
    };
    const pay = F.payload(g), P = g.bs / g.ps;
    for (const [i, n] of live) {
      const need = n.type === F.T_DIR ? Math.ceil(n.size / F.DIRENT / F.direntsPer(g)) : Math.ceil(n.size / pay);
      if (g.alloc === 'indexed') {
        n.direct.forEach((b, k) => {
          if (!b) return;
          if (!inData(b)) return bad('bad-pointer', `Inode ${i}: direct pointer ${k} names block ${b}, outside the data region.`, { ino: i, block: b, field: 'direct', k });
          if (k >= need) bad('beyond-size', `Inode ${i} has size ${n.size} but maps file block ${k}.`, { ino: i, block: b });
          own(b, i, 'direct ' + k);
        });
        const walk = (b, depth, base, what, from) => {
          if (!inData(b)) return bad('bad-pointer', `Inode ${i}: ${from ? 'entry ' + from.k + ' of indirect block ' + from.in : 'its ' + what + ' pointer'} names block ${b}, outside the data region.`, Object.assign({ ino: i, block: b }, from || { field: what }));
          if (!own(b, i, what + ' indirect')) return;
          const u = read(b), span = Math.pow(P, depth - 1);
          for (let k = 0; k < P; k++) {
            const p = F.getPtr(u, k * g.ps, g.ps);
            if (!p) continue;
            if (depth > 1) { walk(p, depth - 1, base + k * span, what, { in: b, k }); continue; }
            if (!inData(p)) { bad('bad-pointer', `Inode ${i}: entry ${k} of indirect block ${b} names block ${p}, outside the data region.`, { ino: i, block: p, in: b, k }); continue; }
            if (base + k >= need) bad('beyond-size', `Inode ${i} has size ${n.size} but maps file block ${base + k}.`, { ino: i, block: p });
            own(p, i, 'data');
          }
        };
        let base = g.ndirect;
        for (let d = 1; d <= 3; d++) {
          const k = F.LEVEL[d];
          if (n[k]) { if (d > g.levels) bad('bad-pointer', `Inode ${i} uses a ${k}-indirect pointer, but this file system has ${g.levels} level${g.levels === 1 ? '' : 's'}.`, { ino: i, block: n[k], field: k }); else walk(n[k], d, base, k); }
          base += Math.pow(P, d);
        }
      } else {
        // the sequential methods: follow the run, the chain or the extents with every step checked
        const blocks = [];
        let broke = false;
        if (g.alloc === 'contiguous' || g.alloc === 'extent') {
          const runs = g.alloc === 'contiguous' ? [{ start: F.slot(g, n, 0), len: F.slot(g, n, 1) }] : F.extents(g, n);
          for (const r of runs) for (let k = 0; k < r.len; k++) blocks.push(r.start + k);
        } else {
          let b = F.slot(g, n, 0);
          const cnt = F.slot(g, n, 2);
          for (let k = 0; k < cnt; k++) {
            if (!inData(b)) { bad('bad-pointer', `Inode ${i}: its chain reaches block ${b} at link ${k}, outside the data region.`, { ino: i, block: b, chain: k }); broke = true; break; }
            blocks.push(b);
            b = g.alloc === 'linked' ? F.getPtr(read(b), g.bs - g.ps, g.ps) : F.fatGet(g, read, b);
          }
          if (!broke && cnt && (g.alloc === 'linked' ? b !== 0 : b !== g.EOC)) bad('chain-end', `Inode ${i}: its chain of ${F.count(cnt, 'block')} does not end where it should (next is ${b}).`, { ino: i });
          if (!broke && cnt && blocks[cnt - 1] !== F.slot(g, n, 1)) bad('chain-end', `Inode ${i}: its last block is recorded as ${F.slot(g, n, 1)}, but the chain ends at ${blocks[cnt - 1]}.`, { ino: i });
        }
        for (const b of blocks) { if (!inData(b)) { bad('bad-pointer', `Inode ${i} maps block ${b}, outside the data region.`, { ino: i, block: b }); broke = true; continue; } if (!own(b, i, 'data')) broke = true; }
        if (!broke && blocks.length !== need) bad('size', `Inode ${i} has size ${n.size}, which needs ${need} block${need === 1 ? '' : 's'}, but maps ${blocks.length}.`, { ino: i, size: n.size, blocks: blocks.length });
      }
    }
    for (const b of F.dataBlocks(g)) {
      let used;
      if (g.fat) { const l = F.fatLoc(g, b); used = F.getPtr(read(l.block), l.off, g.ps) !== 0; } else { const l = F.dbmLoc(g, b); used = !!F.getBit(read(l.block), l.bit); }
      if (used && !owners.has(b)) bad('leak', `Block ${b} is marked used in the ${g.fat ? 'FAT' : 'data bitmap'}, but no inode points to it.`, { block: b });
      if (!used && owners.has(b)) bad('used-but-free', `Block ${b} belongs to inode ${owners.get(b)} but is free in the ${g.fat ? 'FAT' : 'data bitmap'}.`, { block: b, ino: owners.get(b) });
    }
    // directories, from the root
    const refs = new Map(), reach = new Set(), tx = new F.Tx(img, { read });
    const root = live.get(F.ROOT);
    if (!root || root.type !== F.T_DIR) bad('root', `Inode ${F.ROOT}, the root, is not a directory.`, { ino: F.ROOT });
    else {
      const queue = [[F.ROOT, F.ROOT]];
      reach.add(F.ROOT);
      while (queue.length) {
        const [d, parent] = queue.shift(), n = live.get(d);
        if (n.size % F.DIRENT) bad('dir-size', `Directory inode ${d} has size ${n.size}, not a whole number of entries.`, { ino: d });
        let ents;
        try { ents = F.dirEntries(tx, d); } catch (e) { bad('dir-read', `Directory inode ${d} cannot be read: ${e.message}.`, { ino: d }); continue; }
        const dot = ents.find((e) => e.ino && e.name === '.'), dotdot = ents.find((e) => e.ino && e.name === '..');
        if (!dot || dot.ino !== d) bad('dot', `Directory inode ${d} has no '.' entry naming itself.`, { ino: d });
        if (!dotdot || dotdot.ino !== parent) bad('dotdot', `Directory inode ${d} has no '..' entry naming its parent, inode ${parent}.`, { ino: d, parent });
        for (const e of ents) {
          if (!e.ino) continue;
          if (e.ino >= g.ninodes || !live.has(e.ino)) { bad('dangling-entry', `Directory inode ${d} has an entry ${e.name} naming inode ${e.ino}, which is free.`, { ino: d, name: e.name, target: e.ino, entry: e.name, dir: d, block: e.block, off: e.off }); continue; }
          refs.set(e.ino, (refs.get(e.ino) || 0) + 1);
          if (e.name === '.' || e.name === '..') continue;
          const t = live.get(e.ino);
          if (t.type === F.T_DIR) {
            if (reach.has(e.ino)) { bad('dir-loop', `Directory inode ${e.ino} is named a second time, as ${e.name} in inode ${d}.`, { ino: e.ino }); continue; }
            queue.push([e.ino, d]);
          }
          reach.add(e.ino);
        }
      }
    }
    for (const [i, n] of live) {
      if (!reach.has(i)) {
        if (orphans.has(i) && n.nlink === 0) continue;
        bad('orphan', `Inode ${i} is in use, but no directory entry leads to it.`, { ino: i }); continue;
      }
      const r = refs.get(i) || 0;
      if (r !== n.nlink) bad('link-count', `Inode ${i} has link count ${n.nlink}, but ${r} entr${r === 1 ? 'y names' : 'ies name'} it.`, { ino: i, nlink: n.nlink, refs: r });
    }
    for (const i of orphans) if (!live.has(i)) bad('orphan-list', `The orphan list names inode ${i}, which is free.`, { ino: i });
    return { ok: problems.length === 0, problems, owners, refs, live, reach, orphans };
  };

  /** fix what can be fixed, in place on the disk (after a crash: the overlay is gone); the fixes as sentences */
  F.repair = function (img) {
    const g = img.g, fixes = [], steps = [];
    const fix = (kind, say, d) => { fixes.push(say); steps.push(Object.assign({ kind, say }, d)); };
    fixes.steps = steps;
    img.overlay = null;
    for (let pass = 0; pass < 5; pass++) {
      const r = F.fsck(img, { disk: true });
      if (r.ok) break;
      const tx = new F.Tx(img);
      for (const p of r.problems.filter((x) => x.kind === 'bad-pointer' || x.kind === 'chain-end' || x.kind === 'size' || x.kind === 'dup-block' && g.alloc !== 'indexed')) {
        const m = tx.inode(p.ino);
        if (g.alloc === 'indexed') {
          if (p.in !== undefined) { F.putPtr(tx.get(p.in), p.k * g.ps, g.ps, 0); tx.dirty(p.in, 'indirect'); }
          else { if (p.field === 'direct') m.direct[p.k] = 0; else m[p.field] = 0; tx.putInode(p.ino, m); }
          fix('clear-pointer', `cleared a pointer of inode ${p.ino} to block ${p.block}`, { ino: p.ino, block: p.block });
        } else {
          // a broken run or chain: keep the inode, drop its blocks (fsck cannot know which data is right)
          for (let k = 0; k < g.ndirect + 3; k++) F.setSlot(g, m, k, 0);
          m.size = 0; tx.putInode(p.ino, m); fix('empty-inode', `emptied inode ${p.ino}, whose blocks could not be trusted`, { ino: p.ino });
        }
      }
      for (const p of r.problems.filter((x) => x.kind === 'dangling-entry')) { F.encodeDirent(tx.get(p.block), p.off, 0, ''); tx.dirty(p.block, 'dir'); fix('remove-entry', `removed entry ${p.name} from directory inode ${p.ino}`, { entry: p.name, ino: p.target, dir: p.ino, block: p.block }); }
      for (const p of r.problems.filter((x) => x.kind === 'dot' || x.kind === 'dotdot')) {
        const m = tx.inode(p.ino), b = F.bmap(tx, m, 0, null, p.ino);
        if (!b) continue;
        if (p.kind === 'dot') F.encodeDirent(tx.get(b), 0, p.ino, '.'); else F.encodeDirent(tx.get(b), F.DIRENT, p.parent, '..');
        if (m.size < 2 * F.DIRENT) { m.size = 2 * F.DIRENT; tx.putInode(p.ino, m); }
        tx.dirty(b, 'dir'); fix('restore-entry', `restored '${p.kind === 'dot' ? '.' : '..'}' in directory inode ${p.ino}`, { entry: p.kind === 'dot' ? '.' : '..', ino: p.kind === 'dot' ? p.ino : p.parent, dir: p.ino, block: b });
      }
      if (r.orphans.size) { F.setOrphans(tx, []); for (const i of r.orphans) if (r.live.has(i) && !r.reach.has(i)) { tx.putInode(i, F.emptyInode(g, F.T_FREE)); fix('free-unlinked', `freed inode ${i}, an open file unlinked before the crash`, { ino: i }); } }
      for (const [i, n] of r.live) {
        if (r.orphans.has(i)) continue;
        if (!r.reach.has(i)) { tx.putInode(i, F.emptyInode(g, F.T_FREE)); fix('free-orphan', `freed orphan inode ${i}`, { ino: i }); continue; }
        const refs = r.refs.get(i) || 0;
        if (n.nlink !== refs) { const m = tx.inode(i); m.nlink = refs; tx.putInode(i, m); fix('set-nlink', `set the link count of inode ${i} to ${refs}`, { ino: i, from: n.nlink, nlink: refs }); }
      }
      for (const [b, u] of tx.buf) if (tx.kind.has(b)) F.block(img, b).set(u);
      // the inode bitmap and the block marks rebuilt from what the inodes say
      const r2 = F.fsck(img, { disk: true }), t2 = new F.Tx(img, { read: (b) => F.block(img, b) });
      for (let i = 0; i < g.ninodes; i++) { const want = i === 0 || r2.live.has(i) ? 1 : 0, l = F.ibmLoc(g, i); if (F.getBit(t2.get(l.block), l.bit) !== want) { F.setBit(t2.get(l.block), l.bit, want); t2.dirty(l.block, 'ibm'); fix('mark-inode', `${want ? 'marked' : 'cleared'} inode ${i} in the inode bitmap`, { ino: i, used: !!want }); } }
      for (const b of F.dataBlocks(g)) {
        const want = r2.owners.has(b);
        if (g.fat) {
          const l = F.fatLoc(g, b), v = F.getPtr(t2.get(l.block), l.off, g.ps);
          if (!want && v) { F.putPtr(t2.get(l.block), l.off, g.ps, 0); t2.dirty(l.block, 'fat'); fix('mark-block', `freed block ${b} in the FAT`, { block: b, used: false, map: 'fat' }); }
          else if (want && !v) { F.putPtr(t2.get(l.block), l.off, g.ps, g.EOC); t2.dirty(l.block, 'fat'); fix('mark-block', `marked block ${b} in the FAT`, { block: b, used: true, map: 'fat' }); }
        } else if (!F.isFreeBlock(t2, b) !== want) { F.markBlock(t2, b, want); fix('mark-block', `${want ? 'marked' : 'freed'} block ${b} in the data bitmap`, { block: b, used: want, map: 'bitmap' }); }
      }
      for (const [b, u] of t2.buf) if (t2.kind.has(b)) F.block(img, b).set(u);
    }
    return fixes;
  };
})(globalThis.Proses = globalThis.Proses || {});
