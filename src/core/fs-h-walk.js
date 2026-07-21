// A block-level file system, part 8: the way to byte N, for every allocation method, and access methods as costs.
//   F.walk(img, ino, N) -> {fb, off, loc, block, byte, steps, reads}
//     indexed: the file block, the part of the inode that maps it, the index computed at each level of indirect
//     blocks, the data block. contiguous: start + file block. linked: one hop per block, each a disk read. fat:
//     one hop per block through the table (in memory once read). extent: the extents scanned until one covers it.
//   F.accessCost(img, path, pattern, {records, recsize, seed}) -> {steps, reads, seeks, distance, blocks}
//     pattern 'sequential' reads records 0, 1, 2 ... in order; 'direct' reads them in a seeded random order. Every
//     block read is counted (the inode's pointer blocks once each, as a small cache would keep them), and the
//     head's travel between blocks is summed (F.seekDistance).
//   F.seekDistance(blocks) -> {total, hops: [{from, to, d}]}   (block numbers stand for positions on the disk)
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const LEVEL = ['direct', 'single', 'double', 'triple'];
  const shown = (byte) => (byte >= 32 && byte < 127 ? "'" + String.fromCharCode(byte) + "'" : String(byte));

  F.walk = function (img, ino, N) {
    const g = img.g, tx = new F.Tx(img), pay = F.payload(g), steps = [], fb = Math.floor(N / pay), off = N % pay;
    const ia = F.inodeAt(g, ino), n = tx.inode(ino);
    steps.push({ kind: 'split', fb, off, say: `Byte ${N} is in file block ${N} ÷ ${pay} = ${fb}, at offset ${N} mod ${pay} = ${off} inside it.` });
    let b = 0, loc;
    if (g.alloc === 'indexed') {
      const P = g.bs / g.ps;
      loc = F.locate(g, fb);
      if (!loc) throw F.err('EFBIG', 'byte ' + N + ' is beyond the largest file');
      const ends = [g.ndirect]; for (let l = 1; l < 3; l++) ends.push(ends[l - 1] + Math.pow(P, l));
      const what = loc.level === 0 ? `File block ${fb} is below ${g.ndirect}, so direct pointer ${fb} maps it.`
        : `File block ${fb} is at least ${ends[loc.level - 1]}${loc.level < g.levels ? ' and below ' + ends[loc.level] : ''}, so the ${LEVEL[loc.level]}-indirect pointer maps it, as entry ${loc.rel} of what it reaches (${fb} − ${ends[loc.level - 1]}).`;
      steps.push({ kind: 'level', level: loc.level, part: LEVEL[loc.level], rel: loc.rel, say: what });
      b = loc.level === 0 ? n.direct[loc.slot] : n[LEVEL[loc.level]];
      steps.push({ kind: 'inode', ino, block: ia.block, slot: loc.level === 0 ? loc.slot : LEVEL[loc.level], ptr: b, say: `Inode ${ino} lives in inode-table block ${ia.block}; its ${loc.level === 0 ? 'direct pointer ' + loc.slot : LEVEL[loc.level] + '-indirect pointer'} holds block ${b || 'none'}.` });
      let rem = loc.rel;
      for (let d = 0; d < loc.idx.length && b; d++) {
        const span = Math.pow(P, loc.idx.length - 1 - d), i = loc.idx[d], p = F.getPtr(tx.get(b), i * g.ps, g.ps);
        const how = span > 1 ? `${rem} ÷ ${span} = ${i}` : `what is left, ${i}`;
        steps.push({ kind: 'index', depth: d, of: loc.idx.length, span, rem, idx: i, block: b, ptr: p, byteOff: i * g.ps, say: `In indirect block ${b} (${P} pointers of ${g.ps} bytes), the index is ${how}: entry ${i}, at byte ${i * g.ps}, holds block ${p || 'none'}.` });
        rem = rem % span;
        b = p;
      }
    } else {
      loc = { level: 0, method: g.alloc };
      const cnt = F.amap[g.alloc].count(g, n);
      if (g.alloc === 'contiguous') {
        const s = F.slot(g, n, 0);
        steps.push({ kind: 'inode', ino, block: ia.block, ptr: s, say: `Inode ${ino} (inode-table block ${ia.block}) records a run of ${F.count(cnt, 'block')} from block ${s}.` });
        b = fb < cnt ? s + fb : 0;
        steps.push({ kind: 'add', block: b, say: b ? `Contiguous: block = start + file block = ${s} + ${fb} = ${b}, with no other read.` : `File block ${fb} is past the ${F.count(cnt, 'block')} of the run.` });
      } else if (g.alloc === 'extent') {
        steps.push({ kind: 'inode', ino, block: ia.block, say: `Inode ${ino} (inode-table block ${ia.block}) holds ${F.extents(g, n).length} extent${F.extents(g, n).length === 1 ? '' : 's'}.` });
        let left = fb;
        for (const e of F.extents(g, n)) {
          if (left < e.len) { b = e.start + left; steps.push({ kind: 'extent', start: e.start, len: e.len, block: b, say: `Extent (${e.start}, ${e.len}) covers it: block ${e.start} + ${left} = ${b}.` }); break; }
          steps.push({ kind: 'extent', start: e.start, len: e.len, say: `Extent (${e.start}, ${e.len}) holds file blocks ${fb - left}–${fb - left + e.len - 1}: skip it, ${left - e.len} to go.` });
          left -= e.len;
        }
      } else {
        const fat = g.alloc === 'fat';
        b = F.slot(g, n, 0);
        steps.push({ kind: 'inode', ino, block: ia.block, ptr: b, say: `Inode ${ino} (inode-table block ${ia.block}) names the first block of the chain, ${b || 'none'}.` });
        const hops = Math.min(fb, cnt);
        for (let i = 0; i < hops && b; i++) {
          const next = fat ? F.fatGet(g, (x) => tx.get(x), b) : F.getPtr(tx.get(b), g.bs - g.ps, g.ps);
          if (i < 3 || i >= hops - 2) steps.push({ kind: 'hop', from: b, to: next, i, say: fat ? `FAT entry ${b} says the next block is ${next}.` : `Read block ${b}: its last ${g.ps} bytes say the next block is ${next}.` });
          else if (i === 3) steps.push({ kind: 'hops', count: hops - 5, say: `… ${hops - 5} more hops like these …` });
          b = next;
        }
        if (fb >= cnt) b = 0;
        steps.push({ kind: 'chain', hops, say: fat ? `${hops} hop${hops === 1 ? '' : 's'} through the FAT, which a system keeps in memory: no data block is read on the way.` : `${hops} hop${hops === 1 ? '' : 's'}, each a disk read: reaching byte ${N} reads every block before it.` });
      }
    }
    const byte = b ? tx.get(b)[off] : 0;
    steps.push({ kind: 'data', block: b, off, byte, say: b ? `Data block ${b} holds byte ${N} at offset ${off}: ${shown(byte)}.` : `No block is mapped there: byte ${N} reads as 0.` });
    return { fb, off, loc, block: b, byte, steps, reads: tx.reads };
  };

  F.seekDistance = function (blocks) {
    const hops = [];
    let total = 0;
    for (let i = 1; i < blocks.length; i++) { const d = Math.abs(blocks[i] - blocks[i - 1]); hops.push({ from: blocks[i - 1], to: blocks[i], d }); total += d; }
    return { total, hops };
  };

  F.accessCost = function (img, path, pattern, o) {
    o = o || {};
    const g = img.g, tx = new F.Tx(img), ino = typeof path === 'number' ? path : F.namei(tx, path, { quiet: true }), n = tx.inode(ino), pay = F.payload(g);
    const recsize = o.recsize || pay, records = o.records || Math.max(1, Math.ceil(n.size / recsize)), order = [...Array(records).keys()];
    if (pattern === 'direct') { let s = (o.seed || 1) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    const steps = [], seq = [], seen = new Set(), data = new Set(F.ownedBlocks(img, n).filter((x) => x.kind === 'data').map((x) => x.block));
    let reads = 0;
    // sequential access keeps its place: after record r the next block is found from the current one (one hop on
    // a chain), so each data block is read once; direct access must find every record from the inode
    const chainPos = { fb: -1, block: 0 };
    for (const r of order) {
      if (pattern !== 'direct' && (g.alloc === 'linked' || g.alloc === 'fat')) {
        const fb = Math.floor((r * recsize) / pay), before = reads;
        if (fb !== chainPos.fb) {
          if (chainPos.fb < 0) { const t0 = new F.Tx(img, { read: (b) => { if (!seen.has(b)) { reads++; seq.push(b); seen.add(b); } return F.readBlock(img, b); } }); chainPos.block = F.slot(g, t0.inode(ino), 0); }
          else chainPos.block = g.alloc === 'fat' ? F.fatGet(g, (x) => F.readBlock(img, x), chainPos.block) : F.getPtr(F.readBlock(img, chainPos.block), g.bs - g.ps, g.ps);
          chainPos.fb = fb; reads++; seq.push(chainPos.block);
        }
        steps.push({ kind: 'record', record: r, block: chainPos.block, reads: reads - before, say: `Record ${r} is in block ${chainPos.block}: ${reads - before} read${reads - before === 1 ? '' : 's'}, following on from the block before.` });
        continue;
      }
      const t = new F.Tx(img, { read: (b) => { if (data.has(b) || !seen.has(b)) { reads++; seq.push(b); } if (!data.has(b)) seen.add(b); return F.readBlock(img, b); } });
      const before = reads;
      const b = F.bmap(t, t.inode(ino), Math.floor((r * recsize) / pay), null, ino);
      if (b && !t.buf.has(b)) t.get(b);
      steps.push({ kind: 'record', record: r, block: b, reads: reads - before, say: `Record ${r} is in block ${b}: ${reads - before} read${reads - before === 1 ? '' : 's'}.` });
    }
    const dist = F.seekDistance(seq);
    steps.push({ kind: 'total', reads, distance: dist.total, say: `${pattern === 'direct' ? 'Direct' : 'Sequential'} access to ${F.count(records, 'record')} of ${F.count(recsize, 'byte')}: ${F.count(reads, 'block read')} and ${F.count(dist.total, 'block')} of head travel.` });
    return { steps, reads, seeks: dist.hops.filter((h) => h.d > 1).length, distance: dist.total, blocks: seq };
  };
})(globalThis.Proses = globalThis.Proses || {});
