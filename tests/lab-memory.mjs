// The Memory lab in node: every preset and random setups run through the lab's run(); the frames are well formed
// (unique keys, a sentence each with no undefined or NaN, steps pointing into the trace), and the numbers come out as
// an independent reckoning gives them: page splits and walks, physical addresses, the TLB's hits (a set-associative
// LRU cache simulated here), the tables' memory for every design, the access time, and the allocators' end states.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-memory-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
const t = harness('lab-memory');
const lab = S.Labs.get('memory'), LS = S.LabSetup, ML = S.MemLab;
t.ok(!!lab, 'the Memory lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');

function wellFormed(r, what) {
  t.ok(r.frames.length >= 2, what + ': has frames');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10 && !/undefined|NaN/.test(f.say), what + ': frame ' + i + ' says something');
    t.ok(f.at >= 0 && f.at < r.trace.length, what + ': frame ' + i + ' points into the trace');
    t.ok(f.view && f.view.w > 0 && f.view.h > 0, what + ': frame ' + i + ' has a view');
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { const s = it.text === undefined ? (it.lines || []).join(' ') : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
  });
}

/** the paging run checked against a reckoning of its own */
function checkPaging(v, what) {
  const vv = Object.assign({}, v, { n: v.space === 'dense' ? v.nd : v.n });
  const r = lab.run(v, { seed: 1, narrow: false });
  wellFormed(r, what);
  wellFormed(lab.run(v, { seed: 1, narrow: true }), what + ' (narrow)');
  const m = r.model, cfg = m.cfg, B = BigInt;
  // the split: the fields are the address's bits, top level first
  const off = cfg.offBits, vpnBits = cfg.vaBits - off;
  t.eq(cfg.bits.reduce((a, b) => a + b, 0) + off, cfg.vaBits, what + ': the fields add up to the address');
  // mapped pages, and the prefixes their tables need
  const pages = new Map(m.map.map((x) => [x.vpn, x]));
  const prefixes = cfg.bits.map(() => new Set());
  for (const x of m.map) { let hi = vpnBits; for (let i = 0; i < cfg.levels; i++) { hi -= cfg.bits[i]; prefixes[i].add(String(x.vpn >> B(hi))); } }
  // the TLB, simulated: sets of LRU ways
  const ways = v.ways || v.tlb, nSets = v.tlb ? v.tlb / ways : 0, sets = Array.from({ length: nSets }, () => []);
  m.addrs.forEach((a, i) => {
    const row = r.run.rows[i], vpn = a.va >> B(off), o = a.va & ((1n << B(off)) - 1n), mapped = pages.get(vpn);
    let hit = false;
    if (nSets) { const s = sets[Number(vpn % B(nSets))], k = s.indexOf(String(vpn)); if (k >= 0) { hit = true; s.splice(k, 1); s.push(String(vpn)); } }
    t.eq(row.hit, hit, what + ': address ' + (i + 1) + ' TLB ' + (hit ? 'hit' : 'miss'));
    let pfn = null, reads = 0;
    if (v.table === 'hier') {
      if (mapped) { pfn = mapped.pfn; reads = cfg.levels; } else { let hi = vpnBits; reads = 0; for (let lv = 0; lv < cfg.levels; lv++) { reads++; hi -= cfg.bits[lv]; if (!prefixes[lv].has(String(vpn >> B(hi)))) break; } }
    } else if (v.table === 'hashed') {
      const chain = m.map.filter((x) => Number(x.vpn) % v.buckets === Number(vpn) % v.buckets).reverse();
      const k = chain.findIndex((x) => x.vpn === vpn);
      reads = 1 + (k >= 0 ? k + 1 : chain.length);
      if (k >= 0) pfn = chain[k].pfn;
    } else {
      const res = m.map.slice(0, v.frames).map((x, f) => ({ vpn: x.vpn, f }));
      const chain = res.filter((x) => (Number(x.vpn) + 7) % v.buckets === (Number(vpn) + 7) % v.buckets).reverse();
      const k = chain.findIndex((x) => x.vpn === vpn);
      reads = 1 + (k >= 0 ? k + 1 : chain.length);
      if (k >= 0) pfn = B(chain[k].f);
    }
    if (!hit) t.eq(row.reads, reads, what + ': address ' + (i + 1) + ' table reads');
    const perm = mapped ? m.regions[mapped.region].perm : null;
    const prot = pfn !== null && perm && ((a.access === 'w' && !perm.includes('w')) || (a.access === 'x' && !perm.includes('x')));
    const ok = pfn !== null && !prot;
    t.eq(row.ok, ok, what + ': address ' + (i + 1) + ' translates or faults');
    if (ok) t.eq(row.pa, (pfn << B(off)) | o, what + ': address ' + (i + 1) + ' physical address');
    if (nSets && !hit && pfn !== null) { const s = sets[Number(vpn % B(nSets))]; if (s.length >= ways) s.shift(); s.push(String(vpn)); }
  });
  // the tables' memory, each design
  const d = Object.fromEntries(r.designs.map((x) => [x.id, x.bytes]));
  t.eq(d.flat, 2 ** vpnBits * cfg.pteBytes * v.procs, what + ': one flat table');
  t.eq(d.hier, cfg.bits.reduce((a, b, i) => a + (i === 0 ? 1 : prefixes[i - 1].size) * 2 ** b * cfg.pteBytes, 0) * v.procs, what + ': the hierarchical tables');
  t.eq(d.hashed, (m.map.length * 2 * cfg.pteBytes + v.buckets * cfg.pteBytes) * v.procs, what + ': the hashed table');
  t.eq(d.inverted, v.frames * cfg.pteBytes + v.buckets * 4, what + ': the inverted table');
  // the access time from this run's own counts
  const okRows = r.run.rows.filter((x) => x.ok), tns = v.tlb ? v.tlbNs : 0;
  const measured = okRows.reduce((a, x) => a + tns + x.accesses * v.memNs, 0) / Math.max(1, okRows.length);
  t.ok(Math.abs(r.eat.measured - measured) < 1e-9, what + ': measured access time');
  if (okRows.length) t.ok(Math.abs(r.eat.ns - r.eat.measured) < 1e-6 || v.table !== 'hier', what + ': the EAT formula matches the run (hierarchical)');
  else t.ok(/nothing to average/.test(r.frames[r.frames.length - 1].say), what + ': with every address faulting, no EAT is claimed');
  return r;
}

for (const p of lab.setup.presets) {
  const v = LS.merge(lab, Object.assign({}, defs, p.values));
  t.ok(LS.check(lab, v) === null, p.label + ': a valid setup (' + LS.check(lab, v) + ')');
  if (v.mode === 'alloc') continue;
  checkPaging(v, p.label);
}
checkPaging(defs, 'defaults');

// random paging setups: layouts, TLBs, designs and addresses
const R = rng(5);
const pick = (xs) => xs[Math.floor(R() * xs.length)];
let ran = 0;
for (let k = 0; k < 40 && ran < 24; k++) {
  const va = pick([24, 30, 32, 39, 48]), page = pick([1024, 4096, 16384]), levels = 1 + Math.floor(R() * 4);
  const v = Object.assign({}, defs, { va, pa: Math.min(52, va + 4), page, levels, bits: 'auto', pte: pick([4, 8]), flags: ['V', 'R', 'W'], tlb: pick([0, 2, 4, 8]), ways: pick([1, 2, 0]), table: pick(['hier', 'hashed', 'inverted']), buckets: pick([3, 8, 16]), frames: pick([8, 32]), space: pick(['sparse', 'dense']), n: 1 + Math.floor(R() * 20), nd: 1 + Math.floor(R() * 60) });
  const top = 2 ** va;
  v.addrs = Array.from({ length: 6 }, () => '0x' + Math.floor(R() * Math.min(top, 0x800000)).toString(16) + pick(['', ':w']));
  if (LS.check(lab, v)) continue;
  ran++;
  checkPaging(v, 'random ' + k);
}
t.ok(ran >= 15, 'random setups ran (' + ran + ')');

// a setup that does not fit is refused with a reason
t.ok(/do not fit|bits/.test(LS.check(lab, Object.assign({}, defs, { pte: 4, pa: 52 })) || ''), 'a 4-byte entry cannot hold a 40-bit frame number');
t.ok(/make/.test(LS.check(lab, Object.assign({}, defs, { bits: '9 9 9', levels: 3 })) || ''), 'bits that do not add up are refused');

// ---- allocation: the end state checked by a reckoning of its own
const firstFit = (mem, os, ops) => {
  let blocks = [];
  const holes = () => { const hs = []; let at = os; for (const b of blocks) { if (b.start > at) hs.push({ start: at, size: b.start - at }); at = b.start + b.size; } if (mem > at) hs.push({ start: at, size: mem - at }); return hs; };
  for (const o of ops) {
    if (o.op === 'alloc') { const h = holes().find((x) => x.size >= o.size); if (h) { blocks.push({ id: o.id, start: h.start, size: o.size }); blocks.sort((a, b) => a.start - b.start); } }
    else if (o.op === 'free') blocks = blocks.filter((b) => b.id !== o.id);
    else if (o.op === 'compact') { let at = os; blocks = blocks.map((b) => { const nb = Object.assign({}, b, { start: at }); at += b.size; return nb; }); }
  }
  return blocks;
};
for (const p of lab.setup.presets.filter((x) => x.values.mode === 'alloc')) {
  const v = LS.merge(lab, Object.assign({}, defs, p.values));
  const r = lab.run(v, { seed: 1, narrow: false });
  wellFormed(r, p.label);
  wellFormed(lab.run(v, { seed: 1, narrow: true }), p.label + ' (narrow)');
  const run = r.run, last = run.steps[run.steps.length - 1].snap;
  t.eq(r.frames.length, run.steps.length + 1, p.label + ': a frame a step and the start');
  if (v.alloc === 'contig' && v.fit === 'first') t.eq(last.blocks.map((b) => [b.id, b.start, b.size]), firstFit(v.memK, v.osK, ML.parseOps('contig', v.ops_contig)).map((b) => [b.id, b.start, b.size]), p.label + ': first fit places every block where a simple first fit does');
  if (v.alloc === 'contig' || v.alloc === 'seg') {
    const free = last.holes.reduce((a, h) => a + h.size, 0), used = last.blocks.reduce((a, b) => a + b.size, 0);
    t.eq(free + used + v.osK, v.memK, p.label + ': blocks and holes tile memory');
    t.ok(Math.abs(last.frag.external - (free ? 1 - Math.max(...last.holes.map((h) => h.size)) / free : 0)) < 1e-9, p.label + ': external fragmentation');
  }
  if (v.alloc === 'buddy') for (const u of last.allocated) { t.ok(u.size >= u.request && u.size / 2 < Math.max(u.request, v.minBlock) && (u.size & (u.size - 1)) === 0, p.label + ': ' + u.id + ' got the smallest power of two'); t.eq(u.offset % u.size, 0, p.label + ': ' + u.id + ' is aligned to its size'); }
  if (v.alloc === 'malloc') { let at = 0; for (const b of last.blocks) { t.eq(b.start, at, p.label + ': the heap is tiled'); at += b.size; } t.eq(at, v.heap, p.label + ': the blocks fill the heap'); }
  if (v.alloc === 'slab') for (const c of last.caches) t.eq(c.perSlab, Math.floor(v.slabBytes / c.objSize), p.label + ': ' + c.name + ' objects a slab');
}
t.done();
