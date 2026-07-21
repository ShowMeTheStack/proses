// A log-structured file system on a real byte image. Every change is appended to the log: new data blocks, a new
// copy of the inode, and the inode-map pieces that say where the inodes now are. Nothing is updated in place.
//   Layout: blocks 0 and 1 are the checkpoint regions (written alternately); then nsegs segments of segBlocks.
//   A segment holds one or more partial segments, each a summary block and the blocks it describes:
//     summary   magic, sequence number, count, CRC-32 of the blocks, then per block (type, ino or piece, file block):
//               type 1 data, 2 inode, 3 inode-map piece
//     inode     magic, ino, type (1 file, 2 directory), size, count, then the data block addresses
//     imap piece magic, piece number, then the address of each inode's latest copy
//     checkpoint magic, sequence, head (segment, offset), the address of every imap piece, CRC-32
//   The directory is inode 1, a file of 32-byte entries (inode number, name).
//   const L = S.FS.lfs
//   L.mkfs({bs, segBlocks, nsegs, ninodes}) -> fs     (fs.img is the disk; the rest is memory)
//   L.create(fs, name), L.write(fs, name, offset, text), L.append(fs, name, text), L.delete(fs, name)
//       -> {steps}    buffered in memory until the buffer fills or L.sync
//   A 'buffer' step has {ino, fb, buffered: [{ino, fb}]}: every data block waiting in the segment buffer.
//   L.sync(fs) -> {steps, writes}   write the buffered blocks as a partial segment, then a checkpoint
//   L.read(fs, name) -> text        L.list(fs) -> [{name, ino, size}]
//   L.usage(fs) -> [{seg, live, total, u, age, state: 'free'|'head'|'used'}]   live blocks found by the summaries
//   L.clean(fs, {policy: 'greedy'|'cost-benefit', count}) -> {steps, cleaned, moved}  pick segments, copy their live
//       blocks to the head of the log, free them
//   L.stats(fs) -> {newBlocks, written, cleanerReads, cleanerWrites, writeCost}   writeCost = (all blocks written
//       and read by the cleaner + new data) / new data, the measure from the LFS paper's analysis: 2 / (1 − u)
//   L.crash(fs) -> memory lost; L.mount(img, {rollForward}) -> fs   the newest valid checkpoint, then (by default)
//       every later partial segment whose summary checksum holds, in sequence
//   When fewer than g.reserve (3) clean segments are left, the cleaner runs by itself (g.autoClean: false stops it).
//   L.check(fs) -> {ok, problems}   every file readable, every live block in one place, usage consistent
(function (S) {
  'use strict';
  const F = S.FS = S.FS || {};
  const L = (F.lfs = {});
  const CRM = 0x4c464343, SUM = 0x4c465353, INM = 0x4c46494e, IMP = 0x4c46494d;
  const g32 = (u, o) => F.get32(u, o), p32 = (u, o, v) => F.put32(u, o, v);
  const blk = (fs, b) => fs.img.bytes.subarray(b * fs.g.bs, (b + 1) * fs.g.bs);
  const segStart = (g, s) => 2 + s * g.segBlocks;
  const segOf = (g, b) => Math.floor((b - 2) / g.segBlocks);
  const perPiece = (g) => (g.bs - 8) / 4;
  const maxPtrs = (g) => (g.bs - 20) / 4;

  function fresh(img, g) {
    return { img, g, imap: new Array(g.ninodes).fill(0), inodes: new Map(), pending: [], dirtyInodes: new Set(), dirtyPieces: new Set(), pieces: new Array(Math.ceil(g.ninodes / perPiece(g))).fill(0), head: { seg: 0, off: 0 }, seq: 0, time: 0, segTime: new Array(g.nsegs).fill(0), free: [], stats: { newBlocks: 0, written: 0, cleanerReads: 0, cleanerWrites: 0 } };
  }
  L.mkfs = function (o) {
    const g = Object.assign({ bs: 128, segBlocks: 8, nsegs: 12, ninodes: 32 }, o || {});
    g.nblocks = 2 + g.nsegs * g.segBlocks;
    const fs = fresh({ g, bytes: new Uint8Array(g.nblocks * g.bs) }, g);
    fs.free = [...Array(g.nsegs).keys()].slice(1);
    fs.inodes.set(1, { type: 2, size: 0, ptrs: [] }); fs.dirtyInodes.add(1); fs.dirtyPieces.add(0);
    L.sync(fs);
    return fs;
  };

  // ---- reading through memory ----
  const inode = (fs, ino) => {
    if (fs.inodes.has(ino)) return fs.inodes.get(ino);
    const a = fs.imap[ino];
    if (!a) return null;
    const u = blk(fs, a), n = { type: g32(u, 8), size: g32(u, 12), ptrs: [] };
    for (let k = 0; k < g32(u, 16); k++) n.ptrs.push(g32(u, 20 + 4 * k));
    fs.inodes.set(ino, n);
    return n;
  };
  const dataOf = (fs, p) => (typeof p === 'object' ? p.bytes : blk(fs, p));
  function contents(fs, ino) {
    const n = inode(fs, ino), out = new Uint8Array(n.size), bs = fs.g.bs;
    n.ptrs.forEach((p, j) => { if (p) out.set(dataOf(fs, p).subarray(0, Math.min(bs, n.size - j * bs)), j * bs); });
    return out;
  }
  const dir = (fs) => { const u = contents(fs, 1), out = []; for (let o = 0; o + 32 <= u.length; o += 32) { const e = F.decodeDirent(u, o); if (e.ino) out.push(Object.assign(e, { off: o })); } return out; };
  L.list = (fs) => dir(fs).map((e) => ({ name: e.name, ino: e.ino, size: inode(fs, e.ino).size }));
  L.read = (fs, name) => { const e = dir(fs).find((x) => x.name === name); if (!e) throw F.err('ENOENT', name + ': no such file'); return F.text(contents(fs, e.ino)); };

  // ---- writing into the buffer ----
  const space = (fs) => fs.g.segBlocks - fs.head.off;
  const need = (fs) => 1 + fs.pending.length + fs.dirtyInodes.size + fs.dirtyPieces.size;
  function room(fs, extraData, extraInodes) {
    // the buffer holds up to a segment's worth; flush when the next blocks would overflow it (cleaning first if
    // clean segments run low)
    if (need(fs) + extraData + extraInodes > fs.g.segBlocks) { autoclean(fs, null); flush(fs); }
  }
  function setData(fs, ino, fb, bytes, steps) {
    room(fs, 1, fs.dirtyInodes.has(ino) ? 0 : 1);
    const n = inode(fs, ino);
    if (fb >= maxPtrs(fs.g)) throw F.err('EFBIG', 'the file is too big for one inode block');
    const p = { pending: true, bytes, ino, fb };
    n.ptrs[fb] = p; fs.pending = fs.pending.filter((x) => !(x.ino === ino && x.fb === fb)); fs.pending.push(p);
    fs.dirtyInodes.add(ino); fs.dirtyPieces.add(Math.floor(ino / perPiece(fs.g)));
    if (steps) steps.push({ kind: 'buffer', ino, fb, buffered: fs.pending.map((x) => ({ ino: x.ino, fb: x.fb })), say: `File block ${fb} of inode ${ino} goes into the in-memory segment buffer (${fs.pending.length} data block${fs.pending.length === 1 ? '' : 's'} waiting).` });
  }
  function writeBytes(fs, ino, offset, d, steps) {
    const bs = fs.g.bs, n = inode(fs, ino), end = offset + d.length, old = contents(fs, ino);
    const all = new Uint8Array(Math.max(n.size, end)); all.set(old); all.set(d, offset);
    for (let fb = Math.floor(offset / bs); fb * bs < end; fb++) { const c = new Uint8Array(bs); c.set(all.subarray(fb * bs, (fb + 1) * bs)); setData(fs, ino, fb, c, steps); }
    // blocks between the old end and the offset (a gap) are written as zeros
    for (let fb = Math.ceil(n.size / bs); fb < Math.floor(offset / bs); fb++) setData(fs, ino, fb, new Uint8Array(bs), steps);
    inode(fs, ino).size = all.length;
    fs.stats.newBlocks += Math.ceil(end / bs) - Math.floor(offset / bs);
  }
  function putDir(fs, ents, steps) {
    const u = new Uint8Array(ents.length * 32), n = inode(fs, 1);
    ents.forEach((e, k) => F.encodeDirent(u, k * 32, e.ino, e.name));
    n.size = 0; n.ptrs = []; fs.pending = fs.pending.filter((p) => p.ino !== 1);
    writeBytes(fs, 1, 0, u, steps);
  }

  /** keep a reserve of clean segments: when it runs low, the cleaner runs before the next change */
  function autoclean(fs, steps) {
    if (fs.cleaning || fs.g.autoClean === false || fs.free.length >= (fs.g.reserve || 3)) return;
    const used = L.usage(fs).filter((x) => x.state === 'used' && x.live < fs.g.segBlocks);
    if (!used.length) return;
    fs.cleaning = true;
    try {
      for (let round = 0; round < 8 && fs.free.length < (fs.g.reserve || 3); round++) {
        const r = L.clean(fs, { policy: fs.free.length <= 1 ? 'greedy' : fs.g.policy, count: 2 });
        if (steps) steps.push(...r.steps);
        if (!r.cleaned.length) break;
      }
    } finally { fs.cleaning = false; }
  }
  L.create = function (fs, name) {
    const steps = [];
    autoclean(fs, steps);
    const ents = dir(fs);
    if (ents.some((e) => e.name === name)) throw F.err('EEXIST', name + ' exists');
    let ino = 2; while (ino < fs.g.ninodes && (fs.imap[ino] || fs.inodes.has(ino) && fs.inodes.get(ino).type)) ino++;
    if (ino >= fs.g.ninodes) throw F.err('ENOSPC', 'no free inodes');
    fs.inodes.set(ino, { type: 1, size: 0, ptrs: [] }); fs.dirtyInodes.add(ino); fs.dirtyPieces.add(Math.floor(ino / perPiece(fs.g)));
    ents.push({ ino, name }); putDir(fs, ents, steps);
    steps.unshift({ kind: 'create', ino, say: `Create ${name} as inode ${ino}: a new inode and a new directory block go into the buffer; nothing on disk changes yet.` });
    return { steps, ino };
  };
  const fileIno = (fs, name) => { const e = dir(fs).find((x) => x.name === name); if (!e) throw F.err('ENOENT', name + ': no such file'); return e.ino; };
  L.write = function (fs, name, offset, text) {
    const steps = [];
    autoclean(fs, steps);
    const ino = fileIno(fs, name);
    writeBytes(fs, ino, offset, Uint8Array.from(text, (c) => c.charCodeAt(0) & 255), steps);
    steps.unshift({ kind: 'write', ino, say: `Write ${F.count(text.length, 'byte')} to ${name} at offset ${offset}: the changed blocks are new copies at the end of the log; the old copies become dead.` });
    return { steps };
  };
  L.append = (fs, name, text) => L.write(fs, name, inode(fs, fileIno(fs, name)).size, text);
  L.delete = function (fs, name) {
    const steps = [];
    autoclean(fs, steps);
    const ents = dir(fs), e = ents.find((x) => x.name === name);
    if (!e) throw F.err('ENOENT', name + ': no such file');
    ents.splice(ents.indexOf(e), 1); putDir(fs, ents, steps);
    fs.inodes.set(e.ino, { type: 0, size: 0, ptrs: [] }); fs.pending = fs.pending.filter((p) => p.ino !== e.ino);
    fs.dirtyInodes.delete(e.ino); fs.imap[e.ino] = 0; fs.dirtyPieces.add(Math.floor(e.ino / perPiece(fs.g)));
    steps.unshift({ kind: 'delete', ino: e.ino, say: `Delete ${name}: the inode map forgets inode ${e.ino}, so every block of it in the log is dead, to be reclaimed by the cleaner.` });
    return { steps };
  };

  /** write the buffer at the head as partial segments: data that does not fit with the metadata goes first, alone */
  function flush(fs, steps) {
    const g = fs.g, out = [];
    if (!fs.pending.length && !fs.dirtyInodes.size && !fs.dirtyPieces.size) return out;
    for (let guard = 0; guard < 64; guard++) {
      if (space(fs) < 2) nextSeg(fs);
      const meta = fs.dirtyInodes.size + fs.dirtyPieces.size;
      if (1 + fs.pending.length + meta <= space(fs)) { out.push(partial(fs, fs.pending, true)); break; }
      const k = Math.min(fs.pending.length, space(fs) - 1);
      if (k <= 0 || 1 + meta > g.segBlocks) { if (1 + meta > g.segBlocks) throw F.err('ENOSPC', 'the metadata does not fit in a segment'); nextSeg(fs); continue; }
      out.push(partial(fs, fs.pending.slice(0, k), false));
    }
    for (const [ino, n] of fs.inodes) if (!n.type && ino !== 1) fs.inodes.delete(ino);
    if (steps) steps.push(...out);
    return out;
  }
  /** one partial segment: a summary, the given data blocks, and (with meta) the dirty inodes and imap pieces */
  function partial(fs, data, meta) {
    const g = fs.g, bs = g.bs, base = segStart(g, fs.head.seg) + fs.head.off, blocks = [], entries = [];
    let a = base + 1;
    for (const p of data) { p.addr = a++; blocks.push(p.bytes); entries.push([1, p.ino, p.fb]); const n = inode(fs, p.ino); if (n && n.ptrs[p.fb] === p) n.ptrs[p.fb] = p.addr; }
    const done = new Set(data);
    fs.pending = fs.pending.filter((p) => !done.has(p));
    const ni = meta ? fs.dirtyInodes.size : 0, np = meta ? fs.dirtyPieces.size : 0;
    if (meta) {
      for (const ino of [...fs.dirtyInodes].sort((x, y) => x - y)) {
        const n = inode(fs, ino), u = new Uint8Array(bs);
        p32(u, 0, INM); p32(u, 4, ino); p32(u, 8, n.type); p32(u, 12, n.size); p32(u, 16, n.ptrs.length); n.ptrs.forEach((x, k) => p32(u, 20 + 4 * k, typeof x === 'object' ? x.addr : x || 0));
        fs.imap[ino] = a++; blocks.push(u); entries.push([2, ino, 0]);
      }
      for (const k of [...fs.dirtyPieces].sort((x, y) => x - y)) {
        const u = new Uint8Array(bs); p32(u, 0, IMP); p32(u, 4, k);
        for (let i = 0; i < perPiece(g); i++) { const ino = k * perPiece(g) + i; if (ino < g.ninodes) p32(u, 8 + 4 * i, fs.imap[ino]); }
        fs.pieces[k] = a++; blocks.push(u); entries.push([3, k, 0]);
      }
      fs.dirtyInodes.clear(); fs.dirtyPieces.clear();
    }
    if (16 + 4 * entries.length > bs) throw new Error('the summary is full');
    const sum = new Uint8Array(bs), crc = F.crc32(concat(blocks, bs));
    fs.seq++;
    p32(sum, 0, SUM); p32(sum, 4, fs.seq); p32(sum, 8, entries.length); p32(sum, 12, crc);
    entries.forEach(([t, i, fb], k) => { sum[16 + 4 * k] = t; F.put16(sum, 17 + 4 * k, i); sum[19 + 4 * k] = fb; });
    blk(fs, base).set(sum); blocks.forEach((u, k) => blk(fs, base + 1 + k).set(u));
    fs.stats.written += blocks.length + 1;
    fs.segTime[fs.head.seg] = ++fs.time;
    fs.head.off += blocks.length + 1;
    return { kind: 'segment', at: base, count: blocks.length, seq: fs.seq, say: `Write a partial segment at block ${base}: a summary and ${blocks.length} block${blocks.length === 1 ? '' : 's'} (${data.length} data, ${ni} inode${ni === 1 ? '' : 's'}, ${np} inode-map piece${np === 1 ? '' : 's'}) in one sequential write.` };
  }
  const concat = (list, bs) => { const u = new Uint8Array(list.length * bs); list.forEach((x, k) => u.set(x, k * bs)); return u; };
  function nextSeg(fs) {
    if (!fs.free.length) throw F.err('ENOSPC', 'no clean segment: run the cleaner');
    fs.head = { seg: fs.free.shift(), off: 0 };
  }
  function checkpoint(fs, steps) {
    const g = fs.g, u = new Uint8Array(g.bs), slot = fs.seq % 2;
    p32(u, 0, CRM); p32(u, 4, fs.seq); p32(u, 8, fs.head.seg); p32(u, 12, fs.head.off); p32(u, 16, fs.pieces.length);
    fs.pieces.forEach((a, k) => p32(u, 20 + 4 * k, a));
    p32(u, g.bs - 4, F.crc32(u.subarray(0, g.bs - 4)));
    blk(fs, slot).set(u); fs.stats.written++;
    steps.push({ kind: 'checkpoint', slot, seq: fs.seq, say: `Checkpoint region ${slot}: the addresses of the ${fs.pieces.length} inode-map piece${fs.pieces.length === 1 ? '' : 's'} and the head of the log, as of partial segment ${fs.seq}.` });
  }
  L.sync = function (fs) { const steps = []; autoclean(fs, steps); flush(fs, steps); checkpoint(fs, steps); return { steps }; };

  // ---- liveness, usage, cleaning ----
  function summaries(fs, seg) {
    const g = fs.g, out = [];
    let off = 0;
    while (off < g.segBlocks) {
      const b = segStart(g, seg) + off, u = blk(fs, b);
      if (g32(u, 0) !== SUM) break;
      const n = g32(u, 8), ents = [];
      for (let k = 0; k < n; k++) ents.push({ type: u[16 + 4 * k], id: F.get16(u, 17 + 4 * k), fb: u[19 + 4 * k], addr: b + 1 + k });
      out.push({ at: b, seq: g32(u, 4), n, crc: g32(u, 12), ents });
      off += n + 1;
    }
    return out;
  }
  const isLive = (fs, e) => {
    if (e.type === 1) { const n = inode(fs, e.id); return !!n && n.type > 0 && n.ptrs[e.fb] === e.addr; }
    if (e.type === 2) return fs.imap[e.id] === e.addr;
    return fs.pieces[e.id] === e.addr;
  };
  L.usage = function (fs) {
    const g = fs.g;
    return [...Array(g.nsegs).keys()].map((seg) => {
      const sums = summaries(fs, seg), total = sums.reduce((a, s) => a + s.n + 1, 0), live = sums.reduce((a, s) => a + s.ents.filter((e) => isLive(fs, e)).length, 0);
      const state = seg === fs.head.seg ? 'head' : fs.free.includes(seg) ? 'free' : 'used';
      return { seg, live, total, u: live / g.segBlocks, age: fs.time - fs.segTime[seg], state };
    });
  };
  L.clean = function (fs, o) {
    o = o || {};
    const policy = o.policy || 'cost-benefit', count = o.count || 1, steps = [], g = fs.g;
    const cand = L.usage(fs).filter((x) => x.state === 'used');
    const score = (x) => (policy === 'greedy' ? -x.u : ((1 - x.u) * x.age) / (1 + x.u));
    cand.sort((a, b) => score(b) - score(a) || a.seg - b.seg);
    // take the best candidates whose live blocks fit in the space left (a segment's worth kept in reserve)
    const avail = space(fs) + fs.free.length * g.segBlocks - g.segBlocks, pick = [];
    let est = 0;
    for (const c of cand) { if (pick.length >= count) break; const e = c.live + 2; if (est + e > avail) continue; pick.push(c); est += e; }
    let moved = 0;
    for (const s of pick) {
      steps.push({ kind: 'pick', seg: s.seg, u: s.u, age: s.age, say: policy === 'greedy' ? `Greedy: segment ${s.seg} has the fewest live blocks (${s.live} of ${g.segBlocks}, u = ${s.u.toFixed(2)}).` : `Cost-benefit: segment ${s.seg} scores (1 − u)·age / (1 + u) = ${(1 - s.u).toFixed(2)}·${s.age} / ${(1 + s.u).toFixed(2)} = ${score(s).toFixed(2)}, the best.` });
      for (const sm of summaries(fs, s.seg)) {
        fs.stats.cleanerReads += sm.n + 1;
        for (const e of sm.ents) {
          if (!isLive(fs, e)) continue;
          moved++;
          if (e.type === 1) setData(fs, e.id, e.fb, blk(fs, e.addr).slice(), null);
          else if (e.type === 2) { inode(fs, e.id); fs.dirtyInodes.add(e.id); fs.dirtyPieces.add(Math.floor(e.id / perPiece(g))); }
          else fs.dirtyPieces.add(e.id);
        }
      }
    }
    const before = fs.stats.written;
    flush(fs, steps); checkpoint(fs, steps);
    fs.stats.cleanerWrites += fs.stats.written - before - 1;
    for (const s of pick) { fs.img.bytes.fill(0, segStart(g, s.seg) * g.bs, (segStart(g, s.seg) + g.segBlocks) * g.bs); fs.free.push(s.seg); }
    steps.push({ kind: 'cleaned', segs: pick.map((x) => x.seg), moved, say: `${F.count(pick.length, 'segment')} cleaned: ${F.count(moved, 'live block')} copied to the head of the log, and ${pick.length === 1 ? 'segment ' + pick[0].seg + ' is' : 'segments ' + pick.map((x) => x.seg).join(', ') + ' are'} free again.` });
    return { steps, cleaned: pick.map((x) => x.seg), moved };
  };
  L.stats = function (fs) {
    const s = fs.stats, nb = Math.max(1, s.newBlocks);
    return Object.assign({}, s, { writeCost: +((s.written + s.cleanerReads) / nb).toFixed(3) });
  };

  // ---- crash and mount ----
  L.crash = (fs) => L.mount(fs.img, { rollForward: false, crashed: true });
  L.mount = function (img, o) {
    o = o || {};
    const g = img.g, fs = fresh(img, g), steps = [];
    let best = null;
    for (const slot of [0, 1]) {
      const u = img.bytes.subarray(slot * g.bs, (slot + 1) * g.bs);
      if (g32(u, 0) === CRM && F.crc32(u.subarray(0, g.bs - 4)) === g32(u, g.bs - 4) && (!best || g32(u, 4) > best.seq)) best = { slot, seq: g32(u, 4), seg: g32(u, 8), off: g32(u, 12), pieces: [...Array(g32(u, 16)).keys()].map((k) => g32(u, 20 + 4 * k)) };
    }
    if (!best) throw new Error('no valid checkpoint region');
    fs.seq = best.seq; fs.head = { seg: best.seg, off: best.off }; fs.pieces = best.pieces;
    const loadPiece = (k, a) => { const u = blk(fs, a); for (let i = 0; i < perPiece(g); i++) { const ino = k * perPiece(g) + i; if (ino < g.ninodes) fs.imap[ino] = g32(u, 8 + 4 * i); } };
    fs.pieces.forEach((a, k) => { if (a) loadPiece(k, a); });
    steps.push({ kind: 'mount', say: `Checkpoint region ${best.slot} is the newest valid one (partial segment ${best.seq}): the inode map is loaded from its ${fs.pieces.length} piece${fs.pieces.length === 1 ? '' : 's'}.` });
    if (o.rollForward !== false) {
      const later = [];
      for (let s = 0; s < g.nsegs; s++) for (const sm of summaries(fs, s)) if (sm.seq > best.seq) later.push(Object.assign(sm, { seg: s }));
      later.sort((a, b) => a.seq - b.seq);
      let want = best.seq + 1;
      for (const sm of later) {
        if (sm.seq !== want) break;
        const data = []; for (let k = 0; k < sm.n; k++) data.push(blk(fs, sm.at + 1 + k));
        if (F.crc32(concat(data, g.bs)) !== sm.crc) { steps.push({ kind: 'roll-bad', say: `Partial segment ${sm.seq} at block ${sm.at} fails its checksum (torn by the crash): roll-forward stops.` }); break; }
        for (const e of sm.ents) { if (e.type === 2) fs.imap[e.id] = e.addr; if (e.type === 3) { fs.pieces[e.id] = e.addr; loadPiece(e.id, e.addr); } }
        steps.push({ kind: 'roll', seq: sm.seq, say: `Roll forward: partial segment ${sm.seq} at block ${sm.at} is whole; its inodes and inode-map pieces are taken.` });
        fs.seq = sm.seq; fs.head = { seg: sm.seg, off: sm.at - segStart(g, sm.seg) + sm.n + 1 };
        want++;
      }
    }
    // clean segments: those with no live block, other than the head's
    const use = L.usage(fs);
    fs.free = use.filter((x) => x.seg !== fs.head.seg && x.live === 0).map((x) => x.seg);
    for (const s of fs.free) { const sums = summaries(fs, s); if (sums.length) fs.img.bytes.fill(0, segStart(g, s) * g.bs, (segStart(g, s) + g.segBlocks) * g.bs); }
    fs.mountSteps = steps;
    return fs;
  };

  L.check = function (fs) {
    const problems = [], where = new Map();
    let ents = [];
    try { ents = dir(fs); } catch (e) { problems.push({ kind: 'dir', say: e.message }); }
    for (const e of ents) {
      const n = inode(fs, e.ino);
      if (!n || !n.type) { problems.push({ kind: 'dangling', say: `${e.name} names inode ${e.ino}, which the inode map lacks.` }); continue; }
      n.ptrs.forEach((p, fb) => { if (typeof p === 'number' && p) { if (where.has(p)) problems.push({ kind: 'dup', say: `Block ${p} is used twice.` }); where.set(p, e.ino); if (segOf(fs.g, p) < 0 || segOf(fs.g, p) >= fs.g.nsegs) problems.push({ kind: 'range', say: `Inode ${e.ino} block ${fb} is at ${p}, outside the log.` }); } });
      if (n.ptrs.length !== Math.ceil(n.size / fs.g.bs)) problems.push({ kind: 'size', say: `Inode ${e.ino} has size ${n.size} but ${F.count(n.ptrs.length, 'block')}.` });
    }
    for (const s of fs.free) for (const b of where.keys()) if (segOf(fs.g, b) === s) problems.push({ kind: 'free-live', say: `Segment ${s} is marked clean but block ${b} in it is live.` });
    return { ok: !problems.length, problems };
  };
})(globalThis.Proses = globalThis.Proses || {});
