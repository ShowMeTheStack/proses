// Part 11 claims: frames, thrashing, the working set, the allocators and the page size (merged into
// tests/claims-p11.mjs). Each topic's values are worked out again here by a simulator of its own: largest
// remainders, a turn-taking replacement loop, mean value analysis, a sliding window, PFF, a buddy arena, slab lists,
// a boundary-tag heap under four policies, and the page-size arithmetic.
import { pick, int } from './mem-lib.mjs';

const pages = (rnd, n, k) => Array.from({ length: n }, () => String(int(rnd, 1, k)));
const log2 = (n) => Math.round(Math.log2(n));

/** largest remainders, written out plainly */
function shares(F, w, min) {
  const W = w.reduce((a, b) => a + b, 0), exact = w.map((x) => (x / W) * F), fl = exact.map(Math.floor);
  if (fl.some((x) => x < min)) return null; // the minimum binds: only the sums are checked
  const left = F - fl.reduce((a, b) => a + b, 0), order = exact.map((e, j) => [e - Math.floor(e), j]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = fl.slice();
  for (let k = 0; k < left; k++) out[order[k % w.length][1]]++;
  return { exact, out };
}

/** processes taking turns over frames: global or local, LRU or FIFO */
function turns(refs, F, mode, policy, q) {
  const n = refs.length, quota = Array(n).fill(Math.floor(F / n)), fr = [], out = [], faults = Array(n).fill(0), pos = Array(n).fill(0);
  for (let i = 0; i < F; i++) fr.push(null);
  let t = 0;
  while (pos.some((p, k) => p < refs[k].length)) {
    for (let k = 0; k < n; k++) for (let j = 0; j < q && pos[k] < refs[k].length; j++, pos[k]++) {
      const page = refs[k][pos[k]], now = t++;
      let at = fr.findIndex((f) => f && f.p === k && f.page === page);
      if (at >= 0) { fr[at].last = now; out.push({ hit: true, frame: at }); continue; }
      faults[k]++;
      const mine = fr.filter((f) => f && f.p === k).length, free = fr.indexOf(null);
      let victim = null;
      if (free >= 0 && (mode === 'global' || mine < quota[k])) at = free;
      else {
        let best = -1;
        fr.forEach((f, i) => { if (f && (mode === 'global' || f.p === k)) { const key = policy === 'fifo' ? f.seq : f.last; if (best < 0 || key < (policy === 'fifo' ? fr[best].seq : fr[best].last)) best = i; } });
        at = best; victim = [fr[at].p, fr[at].page];
      }
      fr[at] = { p: k, page, last: now, seq: now };
      out.push({ hit: false, frame: at, victim });
    }
  }
  return { out, faults };
}

/** a buddy arena: free sets per size; lowest offset first; splits keep the lower half */
function buddySim(size, min) {
  const free = new Map(), used = new Map();
  for (let s = min; s <= size; s *= 2) free.set(s, new Set());
  free.get(size).add(0);
  return {
    alloc(id, n) {
      let need = min; while (need < n) need *= 2;
      let s = need; while (s <= size && !free.get(s).size) s *= 2;
      if (s > size) return null;
      const off = Math.min(...free.get(s)); free.get(s).delete(off);
      let splits = 0;
      while (s > need) { s /= 2; free.get(s).add(off + s); splits++; }
      used.set(id, [off, need, n]);
      return { off, need, splits };
    },
    free(id) {
      let [off, s] = used.get(id); used.delete(id);
      let merges = 0;
      while (s < size && free.get(s).has(off ^ s)) { free.get(s).delete(off ^ s); off = Math.min(off, off ^ s); s *= 2; merges++; }
      free.get(s).add(off);
      return { merges };
    },
    has: (id) => used.has(id),
    waste() { let w = 0; for (const [, [, s, n]] of used) w += s - n; return w; },
  };
}

/** a boundary-tag heap: blocks [start, size, id|null, request] in address order */
function heapSim(heap, policy) {
  const TAG = 4, MIN = 16, CL = [16, 32, 64, 128, 256], cls = (s) => { let k = 0; while (k + 1 < CL.length && s >= CL[k + 1]) k++; return k; };
  let B = [[0, heap, null, 0]], rover = 0;
  return {
    malloc(id, n) {
      const need = Math.max(MIN, Math.ceil((n + 2 * TAG) / 8) * 8), fr = B.filter((b) => b[2] === null);
      let b = null;
      if (policy === 'first') b = fr.find((x) => x[1] >= need);
      if (policy === 'best') b = fr.filter((x) => x[1] >= need).sort((x, y) => x[1] - y[1] || x[0] - y[0])[0];
      if (policy === 'next') { const k = fr.findIndex((x) => x[0] + x[1] > rover), order = k < 0 ? fr : fr.slice(k).concat(fr.slice(0, k)); b = order.find((x) => x[1] >= need); }
      if (policy === 'segregated') for (let k = cls(need); k < CL.length && !b; k++) b = fr.find((x) => cls(x[1]) === k && x[1] >= need);
      if (!b) return null;
      const i = B.indexOf(b), rest = b[1] - need;
      if (rest >= MIN) { B.splice(i + 1, 0, [b[0] + need, rest, null, 0]); b[1] = need; }
      b[2] = id; b[3] = n; rover = b[0] + b[1];
      return { start: b[0], size: b[1] };
    },
    free(id) {
      let i = B.findIndex((b) => b[2] === id), merges = 0;
      B[i][2] = null; B[i][3] = 0;
      if (B[i + 1] && B[i + 1][2] === null) { B[i][1] += B[i + 1][1]; B.splice(i + 1, 1); merges++; }
      if (i > 0 && B[i - 1][2] === null) { B[i - 1][1] += B[i][1]; B.splice(i, 1); i--; merges++; }
      if (rover > B[i][0] && rover < B[i][0] + B[i][1]) rover = B[i][0];
      return { start: B[i][0], size: B[i][1], merges };
    },
    has: (id) => B.some((b) => b[2] === id),
    stats() { const fr = B.filter((b) => b[2] === null), free = fr.reduce((a, b) => a + b[1], 0), largest = Math.max(0, ...fr.map((b) => b[1])); return { free, largest, used: heap - free, payload: B.reduce((a, b) => a + b[3], 0) }; },
  };
}
const parseOps = (xs) => xs.map((x) => { const m = /^([A-Za-z]\w*)=(\d+)$/.exec(x); return m ? { op: 'alloc', id: m[1], n: +m[2] } : { op: 'free', id: x.slice(1) }; });
/** a random legal script of allocations and frees */
function script(rnd, n, maxSize, names) {
  const live = [], out = [], pool = names.slice();
  for (let k = 0; k < n; k++) {
    if (live.length && (rnd() < 0.35 || !pool.length)) { const j = int(rnd, 0, live.length - 1); out.push('-' + live[j]); live.splice(j, 1); }
    else if (pool.length) { const id = pool.shift(); out.push(id + '=' + int(rnd, 1, maxSize)); live.push(id); }
  }
  return out;
}
const SZ = { K: 1024, M: 1048576, G: 1073741824 };
const parseSize = (x) => { const m = /^(\d+)([KMG])?$/.exec(x); return +m[1] * (m[2] ? SZ[m[2]] : 1); };

export const P11B = {
  'vmem-frame-alloc': {
    names: ['P1', 'P2', 'P3', 'P4'],
    random: (rnd) => { const n = int(rnd, 2, 4); return { frames: int(rnd, 10, 200), scheme: pick(rnd, ['equal', 'proportional', 'priority']), procs: Array.from({ length: n }, (_, j) => 'P' + (j + 1) + ':' + int(rnd, 1, 300) + ':' + int(rnd, 1, 4)), min: int(rnd, 0, 3) }; },
    check({ input, frame, near, ok }) {
      const P = input.procs.map((x) => x.split(':').map((v, i) => (i ? +v : v))), f = frame('final').meta, F = input.frames, n = P.length;
      if (input.scheme === 'equal') { near(f.final, P.map(() => Math.floor(F / n)), 'equal shares'); near(f.spare, F % n, 'spare frames'); return; }
      const w = P.map((p) => (input.scheme === 'priority' ? p[1] * (p[2] || 1) : p[1]));
      near(f.final.reduce((a, b) => a + b, 0), F, 'every frame is given');
      ok(f.final.every((x) => x >= input.min), 'every process has its minimum');
      const s = shares(F, w, input.min);
      near(f.exact, w.map((x) => (x / w.reduce((a, b) => a + b, 0)) * F), 'the exact shares');
      if (s) near(f.final, s.out, 'largest remainders');
      near(frame('floor').meta.floor, f.exact.map(Math.floor), 'rounded down');
    },
  },
  'vmem-global-local': {
    random: (rnd) => ({ a: pages(rnd, int(rnd, 3, 12), 8), b: pages(rnd, int(rnd, 3, 12), 8), frames: int(rnd, 2, 8), mode: pick(rnd, ['global', 'local']), policy: pick(rnd, ['lru', 'fifo']), quantum: int(rnd, 1, 4) }),
    check({ input, frames, frame, near, ok }) {
      const sim = turns([input.a.map(Number), input.b.map(Number)], input.frames, input.mode, input.policy, input.quantum), fs = frames('ref');
      ok(fs.length === sim.out.length, 'one frame a reference');
      fs.forEach((f, i) => { const x = sim.out[i]; near([f.meta.hit, f.meta.frame], [x.hit, x.frame], 'reference ' + (i + 1)); if (!x.hit) near(f.meta.victim, x.victim, 'victim at ' + (i + 1)); });
      near(frame('end').meta.faults, sim.faults, 'faults per process');
      if (input.mode === 'local') ok(fs.every((f) => f.meta.held.every((h) => h <= Math.floor(input.frames / 2))), 'local: no process over its quota');
    },
  },
  'vmem-thrashing': {
    random: (rnd) => ({ frames: int(rnd, 200, 3000), wss: int(rnd, 20, 200), lifetime: int(rnd, 5, 60), disk: int(rnd, 2, 30), k: int(rnd, 1, 3), maxN: int(rnd, 6, 24) }),
    check({ input, frames, frame, near }) {
      // mean value analysis, two centres
      const pts = [];
      for (let n = 1; n <= input.maxN; n++) {
        const m = input.frames / n, L = m >= input.wss ? input.lifetime : input.lifetime * (m / input.wss) ** input.k;
        let qc = 0, qd = 0, X = 0;
        for (let c = 1; c <= n; c++) { const rc = L * (1 + qc), rd = input.disk * (1 + qd); X = c / (rc + rd); qc = X * rc; qd = X * rd; }
        pts.push([Math.min(1, X * L), Math.min(1, X * input.disk), L, m]);
      }
      frames('n').forEach((f, i) => near([f.meta.cpu, f.meta.disk, f.meta.lifetime, f.meta.each], pts[i], 'n = ' + (i + 1)));
      let best = 0; pts.forEach((p, i) => { if (p[0] > pts[best][0]) best = i; });
      near(frame('end').meta.best, best + 1, 'the peak');
    },
  },
  'vmem-working-set': {
    random: (rnd) => ({ refs: pages(rnd, int(rnd, 4, 30), int(rnd, 3, 12)), delta: int(rnd, 1, 12) }),
    check({ input, frames, frame, near }) {
      const R = input.refs.map(Number), D = input.delta;
      const ws = R.map((_, t) => [...new Set(R.slice(Math.max(0, t - D + 1), t + 1))].sort((a, b) => a - b));
      frames('step').forEach((f, t) => near(f.meta.ws, ws[t], 'W(' + (t + 1) + ')'));
      const e = frame('end').meta;
      near([e.avg, e.max], [ws.reduce((a, w) => a + w.length, 0) / R.length, Math.max(...ws.map((w) => w.length))], 'mean and peak');
    },
  },
  'vmem-pff': {
    random: (rnd) => { const lo = pick(rnd, [0.1, 0.2, 0.3]); return { refs: pages(rnd, int(rnd, 6, 40), int(rnd, 3, 9)), interval: int(rnd, 2, 8), lower: lo, upper: lo + pick(rnd, [0.1, 0.2, 0.3, 0.4]), frames: int(rnd, 1, 4), max: int(rnd, 4, 8) }; },
    check({ input, frames, frame, near }) {
      const R = input.refs.map(Number), I = input.interval, res = [], last = new Map(), adj = [], hits = [];
      let fr = input.frames, inI = 0, faults = 0;
      R.forEach((p, t) => {
        last.set(p, t);
        const hit = res.includes(p); hits.push(hit);
        if (!hit) { faults++; inI++; if (res.length >= fr) { const v = res.reduce((a, q) => (last.get(q) < last.get(a) ? q : a)); res.splice(res.indexOf(v), 1); } res.push(p); }
        if ((t + 1) % I === 0) {
          const rate = inI / I;
          if (rate > input.upper && fr < input.max) fr++;
          else if (rate < input.lower && fr > 1) { fr--; if (res.length > fr) { const v = res.reduce((a, q) => (last.get(q) < last.get(a) ? q : a)); res.splice(res.indexOf(v), 1); } }
          adj.push([rate, fr]); inI = 0;
        }
      });
      near(frames('ref').map((f) => f.meta.hit), hits, 'hits and faults');
      near(frames('adjust').map((f) => [f.meta.rate, f.meta.frames]), adj, 'each adjustment');
      near(frame('end').meta.faults, faults, 'faults');
    },
  },
  'vmem-buddy': {
    random: (rnd) => ({ size: pick(rnd, ['256', '512', '1024', '2048']), min: pick(rnd, ['32', '64']), ops: script(rnd, int(rnd, 2, 12), 300, ['P', 'Q', 'R', 'S', 'T', 'U', 'V']) }),
    check({ input, r, frame, near, ok }) {
      const B = buddySim(+input.size, +input.min), steps = r.frames.filter((f) => ['alloc', 'free', 'fail', 'skip'].includes(f.meta.phase));
      parseOps(input.ops).forEach((o, k) => {
        const f = steps[k].meta;
        if (o.op === 'alloc') { const x = B.alloc(o.id, o.n); if (!x) ok(f.phase === 'fail', o.id + ' fails'); else near([f.offset, f.block, f.splits], [x.off, x.need, x.splits], o.id + ' placed'); }
        else if (!B.has(o.id)) ok(f.phase === 'skip', 'nothing to free');
        else near(f.merges.length, B.free(o.id).merges, 'joins when ' + o.id + ' is freed');
      });
      near(frame('end').meta.waste, B.waste(), 'waste at the end');
    },
  },
  'vmem-slab': {
    random: (rnd) => {
      const live = [], ops = [];
      let id = 0;
      for (let k = 0; k < int(rnd, 3, 16); k++) {
        const u = rnd();
        if (u < 0.1) ops.push('shrink');
        else if (live.length && u < 0.4) { const j = int(rnd, 0, live.length - 1); ops.push('-' + live[j]); live.splice(j, 1); }
        else { const nm = 'o' + id++; ops.push(pick(rnd, ['inode', 'task']) + ':' + nm); live.push(nm); }
      }
      return { inode: pick(rnd, ['128', '256', '512']), task: pick(rnd, ['256', '512', '1024']), slab: pick(rnd, ['1024', '2048']), ops };
    },
    check({ input, r, frame, near }) {
      // slabs per cache: arrays of slots; partial first, then empty, then a new slab
      const per = { inode: +input.slab / +input.inode, task: +input.slab / +input.task }, caches = { inode: [], task: [] }, where = new Map();
      let next = 0;
      const n = (s) => s.objs.filter((x) => x !== null).length, steps = r.frames.filter((f) => ['alloc', 'grow', 'free', 'shrink'].includes(f.meta.phase));
      input.ops.forEach((x, k) => {
        const f = steps[k].meta;
        if (x === 'shrink') { for (const c of Object.keys(caches)) caches[c] = caches[c].filter((s) => n(s) > 0); return; }
        if (x[0] === '-') { const w = where.get(x.slice(1)); w.s.objs[w.j] = null; where.delete(x.slice(1)); near([f.slab, f.slot], [w.s.id, w.j], 'free ' + x.slice(1)); return; }
        const [c, id] = x.split(':'), L = caches[c];
        let s = L.find((q) => n(q) > 0 && n(q) < per[c]) || L.find((q) => n(q) === 0), grew = false;
        if (!s) { s = { id: next++, objs: Array(per[c]).fill(null) }; L.push(s); grew = true; }
        const j = s.objs.indexOf(null); s.objs[j] = id; where.set(id, { s, j });
        near([f.slab, f.slot, f.phase], [s.id, j, grew ? 'grow' : 'alloc'], 'alloc ' + id);
      });
      const all = Object.values(caches).flat();
      near([frame('end').meta.slabs, frame('end').meta.objs], [all.length, all.reduce((a, s) => a + n(s), 0)], 'slabs and objects at the end');
    },
  },
  'vmem-malloc': {
    random: (rnd) => ({ heap: pick(rnd, ['128', '256', '512']), policy: pick(rnd, ['first', 'next', 'best', 'segregated']), ops: script(rnd, int(rnd, 2, 14), 120, 'abcdefghij'.split('')) }),
    check({ input, r, frame, near, ok }) {
      const Hs = heapSim(+input.heap, input.policy), steps = r.frames.filter((f) => ['malloc', 'free', 'fail', 'skip'].includes(f.meta.phase));
      parseOps(input.ops).forEach((o, k) => {
        const f = steps[k].meta;
        if (o.op === 'alloc') { const x = Hs.malloc(o.id, o.n); if (!x) ok(f.phase === 'fail', o.id + ' fails'); else near([f.start, f.size], [x.start, x.size], o.id + ' placed'); }
        else if (!Hs.has(o.id)) ok(f.phase === 'skip', 'nothing to free');
        else { const x = Hs.free(o.id); near([f.start, f.size, f.merges], [x.start, x.size, x.merges], 'free ' + o.id); }
      });
      const s = Hs.stats(), e = frame('end').meta.stats;
      near([e.free, e.largest, e.used, e.payload], [s.free, s.largest, s.used, s.payload], 'the heap at the end');
    },
  },
  'vmem-malloc-compare': {
    random: (rnd) => ({ heap: pick(rnd, ['128', '256', '512']), ops: script(rnd, int(rnd, 2, 14), 120, 'abcdefghij'.split('')) }),
    check({ input, frames, frame, near }) {
      const pol = ['first', 'next', 'best', 'segregated'], sims = pol.map((p) => heapSim(+input.heap, p)), fs = frames('malloc').concat(frames('free')).sort((a, b) => 0);
      const steps = [...frames('malloc'), ...frames('free')];
      let mi = 0, fi = 0;
      const ms = frames('malloc'), fr = frames('free');
      parseOps(input.ops).forEach((o) => {
        if (o.op === 'alloc') { const f = ms[mi++].meta; near(f.starts, sims.map((s) => { const x = s.malloc(o.id, o.n); return x ? x.start : -1; }), 'where ' + o.id + ' goes'); }
        else { const f = fr[fi++].meta; near(f.sizes, sims.map((s) => (s.has(o.id) ? s.free(o.id).size : 0)), 'the block after freeing ' + o.id); }
      });
      near(frame('end').meta.largest, sims.map((s) => s.stats().largest), 'the largest holes');
    },
  },
  'vmem-page-size': {
    random: (rnd) => ({ sizes: Array.from({ length: int(rnd, 1, 6) }, () => String(int(rnd, 1, 200000))), pages: [...new Set(Array.from({ length: int(rnd, 1, 5) }, () => String(2 ** int(rnd, 9, 22))))], vaBits: pick(rnd, ['32', '39', '48']), pte: pick(rnd, ['4', '8']), tlb: int(rnd, 4, 2048) }),
    check({ input, frames, frame, near }) {
      const sizes = input.sizes.map(parseSize), ps = input.pages.map(parseSize).sort((a, b) => a - b);
      frames('row').forEach((f, i) => {
        const p = ps[i], ent = sizes.reduce((a, s) => a + Math.max(1, Math.ceil(s / p)), 0), waste = sizes.reduce((a, s) => a + Math.max(1, Math.ceil(s / p)) * p - s, 0);
        near([f.meta.page, f.meta.offBits, f.meta.flat, f.meta.entries, f.meta.waste, f.meta.reach, f.meta.covers], [p, log2(p), 2 ** (+input.vaBits - log2(p)) * +input.pte, ent, waste, input.tlb * p, Math.min(1, input.tlb / ent)], 'the row for ' + p);
      });
      const m = frame('reach').meta;
      near(m.reach, m.tlb * m.page, 'reach = entries × page size');
    },
  },
};
