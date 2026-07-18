// An SSD: flash pages in erase blocks behind a page-mapping flash translation layer (FTL).
// A page is free (erased), valid (holds the current copy of a logical page) or invalid (a stale copy). A page is
// programmed once and can only be reused after its whole block is erased. Writes go to the next free page of the
// active block; the old copy of the logical page turns invalid. When the free blocks fall to the reserve, garbage
// collection picks a victim block, copies its valid pages to the active block and erases it.
//   S.SSD.create({blocks, pages, op, gc: 'greedy'|'cost-benefit', wear: 'none'|'dynamic'|'static', wearDelta,
//                 reserve}) -> F
//     op: over-provisioning, (physical − logical) / logical, so logical = ⌊blocks · pages / (1 + op)⌋, capped so
//     that garbage collection can always find a victim with an invalid page (at most (blocks − 1 − reserve) · pages
//     − 1 logical pages).
//     greedy: the victim with the fewest valid pages. cost-benefit: the largest (1 − u) · age / (1 + u), u the share
//     of valid pages and age the time since the block was last programmed. Ties go to the lowest block number.
//     wear 'none' takes free blocks in the order they were erased; 'dynamic' takes the free block erased fewest
//     times; 'static' also moves the data of a cold block (the fewest erases) once the spread of erase counts
//     exceeds wearDelta, so that block rejoins the pool.
//   S.SSD.write(F, lpn, value?) -> {steps}; S.SSD.read(F, lpn) -> {value, ppn, step}; S.SSD.trim(F, lpn, n?) -> {steps}
//   S.SSD.run(F, ops: [{op: 'w'|'r'|'t', lpn, n?}], {snap}) -> {steps, series: [{i, host, flash, wa, erases, free,
//       gcCopies, wlCopies}], stats}   snap: true puts a snapshot on each op's summary step (kind 'op')
//   S.SSD.snapshot(F) -> {B, P, logical, active, blocks: [{id, pages: ['free'|'valid'|'invalid'], lpns, erases,
//       valid, invalid, free, active}], l2p, stats}
//   S.SSD.stats(F) -> {host, flash, gcCopies, wlCopies, erases, trims, reads, gcRuns, wa, minErase, maxErase}
//       wa = flash page programs / host page writes
//   S.SSD.check(F) -> [problems]   the mapping, the page states and the block counts agree
//   S.SSD.workload(kind: 'sequential'|'uniform'|'hotcold', count, {logical, seed, hot, hotShare, fill, trim}) -> ops
(function (S) {
  'use strict';
  const F0 = (S.SSD = S.SSD || {});
  const FREE = 0, VALID = 1, INVALID = 2, NAMES = ['free', 'valid', 'invalid'];
  const r3 = (v) => Math.round(v * 1000) / 1000;

  F0.create = function (o) {
    const a = Object.assign({ blocks: 16, pages: 8, op: 0.25, gc: 'greedy', wear: 'none', wearDelta: 4, reserve: 1 }, o || {});
    const B = a.blocks, P = a.pages;
    if (B < a.reserve + 3) throw new Error('an SSD needs at least ' + (a.reserve + 3) + ' blocks');
    const L = Math.max(1, Math.min(Math.floor((B * P) / (1 + a.op)), (B - 1 - a.reserve) * P - 1));
    const F = {
      B, P, logical: L, gc: a.gc, wear: a.wear, wearDelta: a.wearDelta, reserve: a.reserve, opAsked: a.op, opReal: (B * P - L) / L,
      page: new Uint8Array(B * P), data: new Array(B * P).fill(null), p2l: new Int32Array(B * P).fill(-1), l2p: new Int32Array(L).fill(-1),
      blocks: Array.from({ length: B }, (_, id) => ({ id, erases: 0, valid: 0, invalid: 0, ptr: 0, stamp: 0 })),
      free: Array.from({ length: B }, (_, i) => i), active: -1, clock: 0,
      stats: { host: 0, flash: 0, gcCopies: 0, wlCopies: 0, erases: 0, trims: 0, reads: 0, gcRuns: 0 },
    };
    return F;
  };

  const blockOf = (F, ppn) => Math.floor(ppn / F.P);
  function invalidate(F, lpn, steps, why) {
    const old = F.l2p[lpn];
    if (old < 0) return -1;
    const b = F.blocks[blockOf(F, old)];
    F.page[old] = INVALID; F.p2l[old] = -1; b.valid--; b.invalid++; F.l2p[lpn] = -1;
    steps.push({ kind: 'invalidate', lpn, ppn: old, block: b.id, say: `${why}: the old copy of logical page ${lpn} in block ${b.id}, page ${old % F.P}, becomes invalid.` });
    return old;
  }
  function take(F, steps, why) {
    let i = 0;
    if (F.wear !== 'none') for (let j = 1; j < F.free.length; j++) { const x = F.blocks[F.free[j]], y = F.blocks[F.free[i]]; if (x.erases < y.erases || (x.erases === y.erases && x.id < y.id)) i = j; }
    const id = F.free.splice(i, 1)[0];
    if (id === undefined) throw new Error('no free block is left');
    F.active = id; F.blocks[id].ptr = 0;
    steps.push({ kind: 'new-block', block: id, erases: F.blocks[id].erases, say: `Block ${id} (erased ${F.blocks[id].erases} time${F.blocks[id].erases === 1 ? '' : 's'}) becomes the active block${why ? ' ' + why : ''}; ${F.free.length} free block${F.free.length === 1 ? '' : 's'} remain.` });
  }
  function program(F, lpn, value, steps, kind, from) {
    if (F.active < 0 || F.blocks[F.active].ptr === F.P) take(F, steps, kind === 'write' ? '' : 'for the copies');
    const b = F.blocks[F.active], ppn = b.id * F.P + b.ptr;
    if (F.page[ppn] !== FREE) throw new Error('page ' + ppn + ' is programmed twice without an erase');
    F.page[ppn] = VALID; F.p2l[ppn] = lpn; F.l2p[lpn] = ppn; F.data[ppn] = value;
    b.ptr++; b.valid++; b.stamp = F.clock; F.stats.flash++;
    const st = { kind, lpn, ppn, block: b.id, page: ppn % F.P };
    if (kind === 'write') st.say = `Logical page ${lpn} is programmed into block ${b.id}, page ${ppn % F.P}; the mapping table now points ${lpn} → ${ppn}.`;
    else st.say = `${kind === 'gc-copy' ? 'Copy' : 'Move'} the valid logical page ${lpn} from block ${blockOf(F, from)}, page ${from % F.P}, to block ${b.id}, page ${ppn % F.P}.`;
    if (from !== undefined) st.from = from;
    steps.push(st);
    return ppn;
  }
  function evacuate(F, id, steps, kind) {
    const b = F.blocks[id];
    for (let k = 0; k < F.P; k++) {
      const ppn = id * F.P + k;
      if (F.page[ppn] !== VALID) continue;
      const lpn = F.p2l[ppn], value = F.data[ppn];
      F.page[ppn] = INVALID; F.p2l[ppn] = -1; b.valid--; b.invalid++;
      program(F, lpn, value, steps, kind, ppn);
      if (kind === 'gc-copy') F.stats.gcCopies++; else F.stats.wlCopies++;
    }
    for (let k = 0; k < F.P; k++) { F.page[id * F.P + k] = FREE; F.data[id * F.P + k] = null; }
    b.erases++; b.valid = 0; b.invalid = 0; b.ptr = 0; F.stats.erases++;
    F.free.push(id);
    steps.push({ kind: 'erase', block: id, erases: b.erases, say: `Erase block ${id} (now erased ${b.erases} time${b.erases === 1 ? '' : 's'}); its ${F.P === 1 ? 'page is' : F.P + ' pages are'} free again.` });
  }
  function scores(F) {
    const out = [];
    for (const b of F.blocks) {
      if (b.id === F.active || F.free.includes(b.id)) continue;
      const u = b.valid / F.P, age = F.clock - b.stamp + 1;
      out.push({ block: b.id, valid: b.valid, u: r3(u), age, score: F.gc === 'greedy' ? -b.valid : u === 1 ? 0 : ((1 - u) * age) / (1 + u) });
    }
    return out;
  }
  function gcOnce(F, steps) {
    const sc = scores(F);
    let v = null;
    for (const x of sc) if (!v || x.score > v.score) v = x;
    if (!v || v.valid === F.P) throw new Error('garbage collection cannot free a page');
    F.stats.gcRuns++;
    steps.push({ kind: 'gc-victim', block: v.block, valid: v.valid, scores: sc.map((x) => Object.assign({}, x, { score: r3(x.score) })), say: F.gc === 'greedy'
      ? `Garbage collection: ${F.free.length} free block${F.free.length === 1 ? '' : 's'} left, so block ${v.block}, with the fewest valid pages (${v.valid} of ${F.P}), is the victim.`
      : `Garbage collection: block ${v.block} has the best cost-benefit, (1 − ${v.u}) · ${v.age} / (1 + ${v.u}) = ${r3(v.score)}; it holds ${v.valid} valid page${v.valid === 1 ? '' : 's'} to copy.` });
    evacuate(F, v.block, steps, 'gc-copy');
  }
  function level(F, steps) {
    let lo = null, hi = 0;
    for (const b of F.blocks) { hi = Math.max(hi, b.erases); if (b.id !== F.active && !F.free.includes(b.id) && (!lo || b.erases < lo.erases)) lo = b; }
    if (!lo || hi - lo.erases <= F.wearDelta) return;
    const room = F.active < 0 ? 0 : F.P - F.blocks[F.active].ptr;
    if (lo.valid > room && !F.free.length) return;
    steps.push({ kind: 'wear-level', block: lo.id, erases: lo.erases, max: hi, say: `Static wear levelling: block ${lo.id} has been erased only ${lo.erases} time${lo.erases === 1 ? '' : 's'} against ${hi} for the most worn, so its ${lo.valid} cold page${lo.valid === 1 ? '' : 's'} move and it rejoins the free pool.` });
    evacuate(F, lo.id, steps, 'wl-move');
  }
  function ensureRoom(F, steps) {
    const room = () => F.active >= 0 && F.blocks[F.active].ptr < F.P;
    if (room()) return;
    while (F.free.length <= F.reserve) { gcOnce(F, steps); }
    if (room()) return;
    if (F.wear === 'static') { level(F, steps); if (room()) return; while (F.free.length <= F.reserve) gcOnce(F, steps); if (room()) return; }
    take(F, steps, '');
  }

  F0.write = function (F, lpn, value) {
    if (!(lpn >= 0 && lpn < F.logical)) throw new Error('logical page ' + lpn + ' is beyond the ' + F.logical + ' the drive shows');
    const steps = [];
    F.clock++; F.stats.host++;
    invalidate(F, lpn, steps, 'An overwrite');
    ensureRoom(F, steps);
    program(F, lpn, value === undefined ? F.stats.host : value, steps, 'write');
    return { steps };
  };
  F0.read = function (F, lpn) {
    F.clock++; F.stats.reads++;
    const ppn = F.l2p[lpn];
    return { value: ppn < 0 ? null : F.data[ppn], ppn, step: { kind: 'read', lpn, ppn, say: ppn < 0 ? `Logical page ${lpn} is not mapped: the read returns zeros.` : `The mapping table sends logical page ${lpn} to block ${blockOf(F, ppn)}, page ${ppn % F.P}.` } };
  };
  F0.trim = function (F, lpn, n) {
    const steps = [];
    F.clock++;
    for (let i = lpn; i < lpn + (n || 1) && i < F.logical; i++) { if (invalidate(F, i, steps, 'TRIM') >= 0) F.stats.trims++; }
    if (!steps.length) steps.push({ kind: 'trim', lpn, say: `TRIM of logical page ${lpn}: it holds no data, so nothing changes.` });
    return { steps };
  };

  F0.stats = function (F) {
    const e = F.blocks.map((b) => b.erases);
    return Object.assign({}, F.stats, { wa: F.stats.host ? r3(F.stats.flash / F.stats.host) : 0, minErase: Math.min(...e), maxErase: Math.max(...e) });
  };
  F0.snapshot = function (F) {
    return {
      B: F.B, P: F.P, logical: F.logical, active: F.active,
      blocks: F.blocks.map((b) => ({ id: b.id, pages: Array.from({ length: F.P }, (_, k) => NAMES[F.page[b.id * F.P + k]]), lpns: Array.from({ length: F.P }, (_, k) => F.p2l[b.id * F.P + k]), erases: b.erases, valid: b.valid, invalid: b.invalid, free: F.free.includes(b.id), active: b.id === F.active })),
      l2p: [...F.l2p], stats: F0.stats(F),
    };
  };
  F0.run = function (F, ops, opt) {
    const steps = [], series = [];
    ops.forEach((o, i) => {
      const before = steps.length;
      if (o.op === 'r') steps.push(F0.read(F, o.lpn).step);
      else if (o.op === 't') steps.push(...F0.trim(F, o.lpn, o.n).steps);
      else steps.push(...F0.write(F, o.lpn, o.value).steps);
      const st = F0.stats(F);
      series.push({ i, host: st.host, flash: st.flash, wa: st.wa, erases: st.erases, free: F.free.length, gcCopies: st.gcCopies, wlCopies: st.wlCopies });
      const sum = { kind: 'op', i, op: o.op, lpn: o.lpn, first: before, say: `After operation ${i + 1}: ${st.host} host writes, ${st.flash} flash writes, write amplification ${st.wa}.` };
      if (opt && opt.snap) sum.snap = F0.snapshot(F);
      steps.push(sum);
    });
    return { steps, series, stats: F0.stats(F) };
  };

  F0.check = function (F) {
    const bad = [];
    for (let l = 0; l < F.logical; l++) { const p = F.l2p[l]; if (p >= 0 && (F.page[p] !== VALID || F.p2l[p] !== l)) bad.push('logical ' + l + ' maps to ' + p + ', which does not point back'); }
    for (let p = 0; p < F.B * F.P; p++) if (F.page[p] === VALID && F.l2p[F.p2l[p]] !== p) bad.push('valid page ' + p + ' is not mapped');
    for (const b of F.blocks) {
      let v = 0, inv = 0, fr = 0, seenFree = false, gap = false;
      for (let k = 0; k < F.P; k++) { const s = F.page[b.id * F.P + k]; if (s === VALID) v++; else if (s === INVALID) inv++; else fr++; if (s === FREE) seenFree = true; else if (seenFree) gap = true; }
      if (v !== b.valid || inv !== b.invalid) bad.push('block ' + b.id + ' counts are wrong');
      if (gap) bad.push('block ' + b.id + ' is not programmed in page order');
      if (F.free.includes(b.id) && fr !== F.P) bad.push('free block ' + b.id + ' is not erased');
      if (b.id !== F.active && !F.free.includes(b.id) && fr) bad.push('closed block ' + b.id + ' has free pages');
    }
    return bad;
  };

  F0.workload = function (kind, count, o) {
    const a = Object.assign({ logical: 64, seed: 1, hot: 0.2, hotShare: 0.8, fill: false, trim: 0 }, o || {});
    let s = a.seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const L = a.logical, ops = [], hotN = Math.max(1, Math.round(L * a.hot));
    if (a.fill) for (let i = 0; i < L; i++) ops.push({ op: 'w', lpn: i });
    for (let i = 0; i < count; i++) {
      let lpn;
      if (kind === 'sequential') lpn = i % L;
      else if (kind === 'hotcold') lpn = rnd() < a.hotShare ? Math.floor(rnd() * hotN) : hotN + Math.floor(rnd() * (L - hotN));
      else lpn = Math.floor(rnd() * L);
      ops.push({ op: a.trim && rnd() < a.trim ? 't' : 'w', lpn });
    }
    return ops;
  };
  (S.engines = S.engines || []).push({ name: 'SSD and flash translation layer' });
})(globalThis.Proses = globalThis.Proses || {});
