// Part 10 claims, the topics after base and bounds (merged into tests/claims-p10.mjs). Each check works the values
// out again here: a contiguous allocator of its own, segment and page arithmetic, a TLB simulated with plain arrays,
// and table sizes counted from the mapped pages.
import { pick, int } from './mem-lib.mjs';

// ---- a contiguous allocator, written again ----
function contig(memory, os, policy, compact) {
  let blocks = [], rover = os;
  const holes = () => { const hs = []; let at = os; for (const b of blocks) { if (b.start > at) hs.push([at, b.start - at]); at = b.start + b.size; } if (memory > at) hs.push([at, memory - at]); return hs; };
  const frag = () => { const hs = holes(), free = hs.reduce((a, h) => a + h[1], 0), largest = hs.reduce((a, h) => Math.max(a, h[1]), 0); return { free, largest, holes: hs.length, external: free ? 1 - largest / free : 0 }; };
  const choose = (size) => {
    const hs = holes().filter((h) => h[1] >= size);
    if (!hs.length) return null;
    if (policy === 'first') return hs[0];
    if (policy === 'best') { let b = hs[0]; for (const h of hs) if (h[1] < b[1]) b = h; return b; }
    if (policy === 'worst') { let b = hs[0]; for (const h of hs) if (h[1] > b[1]) b = h; return b; }
    return hs.find((h) => h[0] + h[1] > rover) || hs[0];
  };
  const doCompact = () => { let at = os, moved = 0; blocks.sort((a, b) => a.start - b.start); for (const b of blocks) { if (b.start !== at) { moved += b.size; b.start = at; } at += b.size; } rover = os; return moved; };
  return {
    alloc(id, size) {
      let h = choose(size), moved = null;
      if (!h && compact === 'on-fail' && frag().free >= size) { moved = doCompact(); h = choose(size); }
      if (!h) return { kind: 'fail', frag: frag(), moved };
      blocks.push({ id, start: h[0], size }); blocks.sort((a, b) => a.start - b.start); rover = h[0] + size;
      return { kind: 'alloc', start: h[0], frag: frag(), moved };
    },
    free(id) { blocks = blocks.filter((b) => b.id !== id); return { kind: 'free', frag: frag() }; },
    compact() { return { kind: 'compact', moved: doCompact(), frag: frag() }; },
    has: (id) => blocks.some((b) => b.id === id),
  };
}
const parse = (list) => list.map((x) => { let m; if ((m = /^(\w+)=(\d+)$/.exec(x))) return { op: 'alloc', id: m[1], size: +m[2] }; if (x === '#') return { op: 'compact' }; return { op: 'free', id: x.slice(1) }; });
function randomScript(rnd, compactOk) {
  const out = [], live = [];
  let n = 0;
  for (let k = int(rnd, 4, 11); k > 0; k--) {
    const r = rnd();
    if (compactOk && r < 0.08) out.push('#');
    else if (live.length && r < 0.4) { const i = int(rnd, 0, live.length - 1); out.push('-' + live[i]); live.splice(i, 1); }
    else { const id = String.fromCharCode(65 + n++); live.push(id); out.push(id + '=' + int(rnd, 20, 320)); }
  }
  return out;
}
const fragOf = (m) => [m.free, m.largest, m.holes];

export const P10A = {
  'mem-fits': {
    random: (rnd) => ({ policy: pick(rnd, ['first', 'best', 'worst', 'next']), memory: pick(rnd, [640, 1024, 2048]), os: pick(rnd, [0, 64, 128]), script: randomScript(rnd, false) }),
    check({ input, frames, frame, near, ok }) {
      const A = contig(input.memory, input.os, input.policy), allocs = frames('alloc'), fails = frames('fail');
      let ia = 0, ifl = 0;
      for (const op of parse(input.script)) {
        if (op.op === 'free') { if (A.has(op.id)) A.free(op.id); continue; }
        const r = A.alloc(op.id, op.size);
        if (r.kind === 'alloc') { const f = allocs[ia++]; near(f.meta.start, r.start, op.id + ' placed'); near([f.meta.free, f.meta.largest, f.meta.holes], fragOf(r.frag), 'the holes after ' + op.id); near(f.meta.external, r.frag.external, 'external fragmentation'); }
        else { const f = fails[ifl++]; ok(f && f.meta.id === op.id, op.id + ' refused'); }
      }
      ok(ia === allocs.length && ifl === fails.length, 'every placement and refusal is a frame');
      for (const f of frames('search')) ok(f.meta.cands.every((c) => c[1] >= f.meta.size), 'the outlined holes are big enough');
      const e = frame('end').meta;
      near([e.placed, e.failed], [allocs.length, fails.length], 'the totals');
    },
  },
  'mem-fits-compare': {
    nRandom: 4,
    random: (rnd) => ({ memory: pick(rnd, [640, 1024]), os: pick(rnd, [64, 128]), script: randomScript(rnd, false) }),
    check({ input, frames, frame, near }) {
      const As = ['first', 'next', 'best', 'worst'].map((p) => contig(input.memory, input.os, p)), opsF = frames('op'), fails = [0, 0, 0, 0];
      parse(input.script).forEach((op, k) => {
        const f = opsF[k];
        As.forEach((A, r) => {
          if (op.op === 'free') { A.free(op.id); return; }
          const x = A.alloc(op.id, op.size);
          if (x.kind === 'fail') fails[r]++;
          near(f.meta.starts[r], x.kind === 'alloc' ? x.start : -1, op.id + ' under policy ' + r);
        });
      });
      near(frame('end').meta.fails, fails, 'refusals per policy');
      const fi = frame('fifty').meta;
      fi.ratio.forEach((v, r) => near(v, fi.holesAvg[r] / fi.blocks[r], 'the ratio is holes over blocks'));
      near(fi.ratio[0], 0.5, 'first fit keeps about one hole per two blocks', 0.25);
    },
  },
  'mem-compaction': {
    random: (rnd) => ({ memory: pick(rnd, [640, 1024]), os: pick(rnd, [64, 128]), mode: pick(rnd, ['on-fail', 'never']), script: randomScript(rnd, true) }),
    check({ input, frames, frame, near, ok }) {
      const A = contig(input.memory, input.os, 'first', input.mode), comps = frames('compact');
      let k = 0, total = 0;
      for (const op of parse(input.script)) {
        if (op.op === 'compact') { const r = A.compact(); near(comps[k++].meta.bytes, r.moved, 'K copied by #'); total += r.moved; continue; }
        if (op.op === 'free') { if (A.has(op.id)) A.free(op.id); continue; }
        const r = A.alloc(op.id, op.size);
        if (r.moved !== null) { near(comps[k++].meta.bytes, r.moved, 'K copied before ' + op.id); total += r.moved; }
      }
      ok(k === comps.length, 'every compaction is a frame');
      for (const c of comps) near(c.meta.moved.reduce((a, m) => a + m[2], 0), c.meta.bytes, 'the moved blocks add up');
      near(frame('end').meta.moved, total, 'K copied in all');
    },
  },

  'mem-segmentation': {
    random: (rnd) => ({ heap: int(rnd, 256, 8192), stack: int(rnd, 256, 6000), paging: pick(rnd, ['off', 'on']), refs: Array.from({ length: int(rnd, 1, 6) }, () => int(rnd, 0, 3) + '.' + int(rnd, 0, 16383) + ':' + pick(rnd, ['r', 'w', 'x'])) }),
    check({ input, frames, near, ok }) {
      const segs = [[4096, 3000, 'up', 'rx'], [12000, 1800, 'up', 'rw'], [20000, input.heap, 'up', 'rw'], [30000, input.stack, 'down', 'rw']];
      const BASEF = [4, 12, 20, 32];
      const res = frames('result');
      input.refs.forEach((x, k) => {
        let seg, off, acc;
        const m = /^(\d)\.(\d+):(\w)$/.exec(x);
        if (m) { seg = +m[1]; off = +m[2]; acc = m[3]; } else { const [a, c] = x.split(':'); const v = Number(a); seg = v >> 14; off = v & 16383; acc = c; }
        const [base, limit, grow, prot] = segs[seg], lo = grow === 'down' ? 16384 - limit : 0, hi = grow === 'down' ? 16384 : limit, f = res[k].meta;
        let fault = 'none', pa = -1;
        if (off < lo || off >= hi) fault = 'limit';
        else if (!prot.includes(acc)) fault = 'protection';
        else if (input.paging === 'on') { const rel = off - lo, pg = Math.floor(rel / 1024); if ((seg === 2 && pg === 2) || (seg === 3 && pg === 1)) fault = 'page'; else pa = (BASEF[seg] + pg) * 1024 + rel % 1024; }
        else pa = base + off - lo;
        ok(f.seg === seg && f.offset === off, 'the split of ' + x);
        ok(f.fault === fault, 'the outcome of ' + x + ': ' + fault);
        if (fault === 'none') near(f.pa, pa, 'the physical address of ' + x);
      });
    },
  },
  'mem-paging': {
    random: (rnd) => { const page = pick(rnd, [32, 64, 128, 256, 512, 1024, 2048, 4096]), off = Math.log2(page), va = off + int(rnd, 1, 6), n = 2 ** (va - off), frs = [...Array(15).keys()].sort(() => rnd() - 0.5), map = []; for (let p = 0; p < n && map.length < 8; p++) if (rnd() < 0.5) map.push(p + ':' + frs[map.length]); if (!map.length) map.push('0:' + frs[0]); return { va, page: String(page), map, addrs: Array.from({ length: int(rnd, 1, 5) }, () => String(int(rnd, 0, 2 ** va - 1))) }; },
    check({ input, frames, near, ok }) {
      const pb = +input.page, map = new Map(input.map.map((x) => x.split(':').map(Number))), res = frames('result'), flt = frames('fault');
      let r = 0, f = 0;
      for (const x of input.addrs) {
        const a = Number(x), vpn = Math.floor(a / pb), off = a % pb;
        if (map.has(vpn)) { const m = res[r++].meta; near([m.vpn, m.off, m.pa], [vpn, off, map.get(vpn) * pb + off], 'translation of ' + a); }
        else { ok(flt[f++].meta.vpn === vpn, 'a fault for ' + a); }
      }
      ok(r === res.length && f === flt.length, 'every address answered');
    },
  },
  'mem-internal-frag': {
    random: (rnd) => ({ page: pick(rnd, ['512', '1024', '2048', '4096', '8192', '16384']), sizes: Array.from({ length: int(rnd, 1, 7) }, () => String(int(rnd, 1, 65536))) }),
    check({ input, frames, frame, near }) {
      const pb = +input.page;
      let used = 0, waste = 0;
      frames('row').forEach((f, k) => { const s = +input.sizes[k], pg = Math.ceil(s / pb); near([f.meta.pages, f.meta.waste], [pg, pg * pb - s], 'pages and waste of ' + s); used += pg * pb; waste += pg * pb - s; });
      near([frame('total').meta.waste, frame('total').meta.used], [waste, used], 'the totals');
    },
  },
  'mem-tlb': {
    random: (rnd) => { const entries = pick(rnd, ['2', '4', '8', '16']), ways = pick(rnd, ['1', '2', '4', 'full'].filter((w) => w === 'full' || +w <= +entries)); return { entries, ways, levels: int(rnd, 1, 5), pwc: '0', refs: Array.from({ length: int(rnd, 2, 18) }, () => String(int(rnd, 0, 12))) }; },
    check({ input, frames, frame, near, ok }) {
      // an LRU set-associative TLB of arrays
      const E = +input.entries, W = input.ways === 'full' ? E : +input.ways, NS = E / W, sets = Array.from({ length: NS }, () => []), L = input.levels;
      let total = 0, hits = 0;
      frames('ref').forEach((f, k) => {
        const p = +input.refs[k], set = sets[p % NS], i = set.indexOf(p);
        let hit = i >= 0, victim = -1;
        if (hit) { set.splice(i, 1); set.push(p); } else { if (set.length >= W) victim = set.shift(); set.push(p); }
        const ns = hit ? 101 : input.pwc === '0' ? 1 + (L + 1) * 100 : 1 + (f.meta.reads + 1) * 100;
        if (!hit && input.pwc !== '0') ok(f.meta.reads === (f.meta.pwcHit ? 1 : L), 'a walk-cache hit reads one level');
        total += ns; hits += hit;
        ok(f.meta.hit === hit && f.meta.set === p % NS, 'reference ' + k + ' hit or miss');
        near([f.meta.victim, f.meta.ns], [victim, ns], 'victim and time of reference ' + k);
      });
      const e = frame('end').meta;
      near([e.hits, e.ns, e.eat], [hits, total, total / input.refs.length], 'the totals');
    },
  },
  'mem-tlb-switch': {
    random: (rnd) => ({ a: Array.from({ length: int(rnd, 1, 12) }, () => String(int(rnd, 0, 6))), b: Array.from({ length: int(rnd, 1, 12) }, () => String(int(rnd, 0, 6))), quantum: int(rnd, 1, 8), entries: pick(rnd, ['4', '8']) }),
    check({ input, frames, frame, near }) {
      const run = (flush) => {
        const E = +input.entries, q = input.quantum, refs = [input.a.map(Number), input.b.map(Number)], pos = [0, 0], tlb = [], out = [];
        let cur = -1;
        while (pos[0] < refs[0].length || pos[1] < refs[1].length) for (let k = 0; k < 2; k++) {
          if (pos[k] >= refs[k].length) continue;
          if (cur !== -1 && cur !== k && flush) tlb.length = 0;
          cur = k;
          for (let j = 0; j < q && pos[k] < refs[k].length; j++, pos[k]++) {
            const key = k + ':' + refs[k][pos[k]], i = tlb.indexOf(key);
            if (i >= 0) { tlb.splice(i, 1); tlb.push(key); out.push(true); } else { if (tlb.length >= E) tlb.shift(); tlb.push(key); out.push(false); }
          }
        }
        return out;
      };
      const f = run(true), a = run(false), refs = frames('ref');
      near(refs.map((x) => x.meta.hitF), f, 'hits when flushed');
      near(refs.map((x) => x.meta.hitA), a, 'hits with ASIDs');
      const e = frame('end').meta;
      near([e.fh, e.ah], [f.filter(Boolean).length, a.filter(Boolean).length], 'the totals');
    },
  },
  'mem-eat': {
    random: (rnd) => ({ hit: 0.5 + int(rnd, 0, 100) * 0.005, tlbNs: int(rnd, 0, 20), memNs: int(rnd, 10, 500), levels: int(rnd, 1, 5), pwc: int(rnd, 0, 20) * 0.05, entries: int(rnd, 8, 4096), ws: int(rnd, 1, 65536) }),
    check({ input, frame, near, ok }) {
      const h = +input.hit, t = input.tlbNs, m = input.memNs, L = input.levels, p = +input.pwc, x = frame('eat').meta;
      const eat = (q) => q * (t + m) + (1 - q) * (t + (L + 1) * m);
      near([x.hitNs, x.missNs, x.eat], [t + m, t + (L + 1) * m, eat(h)], 'hit, miss and EAT');
      const pm = t + (p + (1 - p) * L) * m + m;
      near([frame('pwc').meta.pwcMiss, frame('pwc').meta.pwcEat], [pm, h * (t + m) + (1 - h) * pm], 'with the walk cache');
      const need = frame('need').meta.need;
      if (need >= 0) ok(eat(need) <= 1.1 * m + 1e-9 && (need <= 0.5 || eat(need - 0.00025) > 1.1 * m), 'the needed hit ratio is the smallest on the grid');
      else ok(eat(1) > 1.1 * m, 'no hit ratio is enough');
      near(frame('reach').meta.reach, [4096, 2 ** 21, 2 ** 30].map((b) => b * input.entries), 'the TLB reach');
    },
  },
  'mem-walk': {
    random: (rnd) => ({ layout: pick(rnd, ['x86-32', 'x86-64', 'x86-64-5', 'sv39', 'sv48', 'custom']), which: pick(rnd, ['code', 'heap', 'stack', 'large', 'unmapped']), bits: Array.from({ length: int(rnd, 1, 5) }, () => String(int(rnd, 2, 9))), page: pick(rnd, ['1024', '4096', '16384']) }),
    check({ S, input, frames, frame, near, ok }) {
      const cfg = input.layout === 'custom' ? S.Mem.config({ bits: input.bits.map(Number), pageBytes: +input.page, pteBytes: 8 }) : S.Mem.preset(input.layout);
      const sp = frame('split').meta;
      // the indexes again, by shifting a number made from the address's hex digits
      const vaHex = frame('split').say.match(/0x[0-9a-f_]+/)[0].replace(/_/g, ''), va = BigInt(vaHex);
      let lo = BigInt(cfg.offBits);
      const want = [];
      for (let i = cfg.levels - 1; i >= 0; i--) { want[i] = Number((va >> lo) & ((1n << BigInt(cfg.bits[i])) - 1n)); lo += BigInt(cfg.bits[i]); }
      near(sp.fields.slice(0, -1), want, 'the indexes of the address');
      frames('read').forEach((f) => near(f.meta.index, want[frames('read').indexOf(f)], 'the entry read at each level'));
      const reads = frames('read').length, fr = frame('frame');
      ok(fr ? fr.meta.accesses === reads + 1 : frame('fault').meta.accesses === reads, 'accesses = reads (+ the data)');
      if (input.which !== 'large' && fr) ok(reads === cfg.levels, 'a small page needs every level');
    },
  },
  'mem-table-size': {
    nRandom: 4,
    random: (rnd) => ({ layout: pick(rnd, ['x86-32', 'x86-64', 'sv39']), pattern: pick(rnd, ['sparse', 'dense', 'scattered']), n: int(rnd, 1, 600), procs: int(rnd, 1, 1000), phys: pick(rnd, ['1', '4']) }),
    check({ S, input, frame, near }) {
      const cfg = S.Mem.preset(input.layout), m = frame('flat').meta;
      near(frame('flat').meta.entries * cfg.pteBytes, 2 ** cfg.vpnBits * cfg.pteBytes, 'the flat table');
      near(frame('hash').meta.n * 16 + frame('hash').meta.buckets * 8, m.n * 16 + 2 ** Math.ceil(Math.log2(m.n)) * 8, 'the hashed table');
      const frames = (+input.phys * 2 ** 30) / cfg.pageBytes;
      near(m.frames, frames, 'frames of physical memory');
      // tables per level, counted from the mapped pages' prefixes
      const pages = [];
      const top = 2 ** cfg.vpnBits;
      if (input.pattern === 'dense') for (let i = 0; i < input.n; i++) pages.push(i);
      else if (input.pattern === 'scattered') { const st = Math.max(1, Math.floor(top / input.n / 512) * 512); for (let i = 0; i < input.n; i++) pages.push(i * st); }
      else { const c = 0x400000 / cfg.pageBytes, h = Math.floor(top * 0.21 / 512) * 512; for (let i = 0; i < 16; i++) pages.push(c + i); for (let i = 0; i < input.n; i++) pages.push(h + i); for (let i = 0; i < 8; i++) pages.push(top - 8 + i); }
      const per = cfg.bits.map((_, i) => { let below = 0; for (let j = i; j < cfg.levels; j++) below += cfg.bits[j]; return new Set(pages.map((p) => Math.floor(p / 2 ** below))).size; });
      near(m.perLevel, per, 'tables at each level');
    },
  },
  'mem-hashed': {
    random: (rnd) => { const used = new Set(), map = []; for (let k = int(rnd, 1, 12); k > 0; k--) { const p = int(rnd, 0, 60); if (!used.has(p)) { used.add(p); map.push(p + ':' + int(rnd, 0, 40)); } } return { buckets: pick(rnd, ['4', '8', '16']), map, look: Array.from({ length: int(rnd, 1, 5) }, () => String(int(rnd, 0, 60))) }; },
    check({ input, frames, near, ok }) {
      const B = +input.buckets, chains = Array.from({ length: B }, () => []);
      for (const x of input.map) { const [p, f] = x.split(':').map(Number); chains[p % B].unshift([p, f]); }
      const found = frames('found'), faults = frames('fault');
      let i = 0, j = 0;
      for (const x of input.look) {
        const p = +x, ch = chains[p % B], at = ch.findIndex((c) => c[0] === p);
        if (at >= 0) { const m = found[i++].meta; near([m.frame, m.accesses], [ch[at][1], at + 3], 'lookup of ' + p); }
        else near(faults[j++].meta.accesses, 1 + ch.length, 'the fault for ' + p);
      }
      ok(i === found.length && j === faults.length, 'every lookup answered');
    },
  },
  'mem-inverted': {
    check({ input, frames, near, ok }) {
      const nA = +input.anchors, chains = Array.from({ length: nA }, () => []);
      for (const x of input.res) { const [, pid, page, fr] = /^(\d+):(\d+)@(\d+)$/.exec(x).map(Number); chains[(page + 7 * pid) % nA].unshift([pid, page, fr]); }
      const found = frames('found');
      let i = 0;
      for (const x of input.look) {
        const [pid, page] = x.split(':').map(Number), ch = chains[(page + 7 * pid) % nA], at = ch.findIndex((c) => c[0] === pid && c[1] === page);
        if (at >= 0) { const m = found[i++].meta; near([m.frame, m.accesses], [ch[at][2], at + 3], 'lookup of ' + x); }
      }
      ok(i === found.length, 'every hit is found');
      near(frames('end')[0].meta.total, +input.frames * 8 + nA * 4, 'the table size');
    },
  },
  'mem-swapping': {
    check({ input, frames, frame, near }) {
      const A = contig(input.memory, input.os, 'first'), sizes = new Map(), out = new Set();
      let total = 0;
      const ins = frames('in'), outs = frames('out');
      let a = 0, b = 0;
      for (const x of input.script) {
        let m;
        if ((m = /^(\w+)=(\d+)$/.exec(x))) { if (sizes.has(m[1]) && (A.has(m[1]) || out.has(m[1]))) continue; const r = A.alloc(m[1], +m[2]); if (r.kind === 'alloc') sizes.set(m[1], +m[2]); continue; }
        const id = x.slice(1);
        if (x[0] === '>') { if (!A.has(id)) continue; A.free(id); out.add(id); const ms = input.lat + sizes.get(id) / 1024 / input.rate * 1000; total += ms; near(outs[b++].meta.ms, ms, 'swap-out time of ' + id); }
        else if (x[0] === '<') { if (!out.has(id)) continue; const r = A.alloc(id, sizes.get(id)); if (r.kind === 'alloc') { out.delete(id); const ms = input.lat + sizes.get(id) / 1024 / input.rate * 1000; total += ms; near(ins[a++].meta.start, r.start, 'where ' + id + ' lands'); } }
        else if (A.has(id)) A.free(id);
      }
      near(frame('end').meta.total, total, 'time spent swapping');
    },
  },
};
