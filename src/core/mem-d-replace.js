// Memory engines, part 4: page replacement. Every policy runs on a reference string with a number of frames and
// returns a step per reference: the frames after it (a page stays in the frame it was loaded into), hit or fault,
// the victim and why, and each policy's own state (the clock's hand and use bits, the LRU order, counts, ages).
//   S.Mem.replace(policy, refs, nFrames, opts?) ->
//     {policy, name, nFrames, refs, steps, faults, hits, writeBacks}
//   refs: pages (numbers), or {page, write} for a reference that writes (it sets the page's dirty bit)
//   step: {kind: 'ref', i, page, write, hit, slot, free, victim, victimSlot, reason, writeBack, cleared,
//          frames, use, dirty, counts, ages, hand, handFrom, order, faults, hits, writeBacks, say}
//     order: FIFO and second chance the queue (oldest first); LRU the pages least to most recently used.
//     cleared: frames whose use bit the policy cleared on the way to its victim (clock, second chance, enhanced clock).
//   policies (S.Mem.policies):
//     fifo     evict the page loaded first
//     opt      evict the page used farthest ahead (never again is farthest); ties the lowest frame
//     lru      evict the page used longest ago
//     clock    a hand sweeps the frames, clearing set use bits, and takes the first frame whose bit is clear
//     second   second chance: FIFO, but a page whose use bit is set goes to the back with the bit cleared
//     eclock   enhanced clock: classes (use, dirty); first scan for (0,0) touching nothing, then for (0,1)
//              clearing use bits as it passes; repeat
//     lfu      evict the page with the fewest references since it was loaded; ties the one loaded first
//     mfu      evict the page with the most references since it was loaded; ties the one loaded first
//     aging    each page has a bits-wide register (opts.bits, 8); every opts.tick references (1) each register
//              shifts right with the use bit coming in at the top, and the use bits clear; evict the smallest
//              register, ties the page loaded first
//     nru      classes 2·use + dirty, evict from the lowest class (ties the lowest frame); the use bits clear every
//              opts.reset references (4)
//   Every policy fills empty frames in frame order first. A page's use bit is set when it is loaded and on every
//   hit; its dirty bit is set by a write and cleared when it is loaded.
//   S.Mem.faultCurve(policy, refs, fromN, toN, opts?) -> [{n, faults}]
//   S.Mem.beladySearch({policy: 'fifo', frames: 3, pages: 6, maxLength: 14, seed, tries, temp}) ->
//     {found, refs, frames: [n, n + 1], faults: [a, b], how: 'table' | 'exhaustive' | 'annealing' | 'none', tries, say}
//     FIFO with 3 frames against 4 picks, by seed, from the table of every anomaly of 13 references over six pages
//     found offline (S.Mem.BELADY_FIFO3, src/core/mem-e-belady.js), with its pages renamed by the seed (the pages
//     option is not a limit here: over five pages every short anomaly holds the well-known example). Otherwise every
//     string up to maxLength references (FIFO 12, others 8) over at most `pages` pages, shortest first, up to
//     renaming; then a seeded annealing search over longer strings; found: false, with the say, if both fail.
//     No result ever holds a renaming of the well-known 12-reference example, adjacent or not (S.Mem.holdsFamous).
//     tries: the table's size, or the strings looked at
//   S.Mem.refShape(refs) -> 'shape' (pages numbered by first use)   S.Mem.holdsFamous(refs) -> bool
//   S.Mem.findBelady(opts) -> the same result when found, else null
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});
  const NAMES = { fifo: 'FIFO', opt: 'OPT', lru: 'LRU', clock: 'Clock', second: 'Second chance', eclock: 'Enhanced clock', lfu: 'LFU', mfu: 'MFU', aging: 'Aging', nru: 'NRU' };
  M.policies = Object.keys(NAMES);
  M.policyName = (p) => NAMES[p] || p;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const bin = (v, n) => v.toString(2).padStart(n, '0');
  M.normRefs = (refs) => refs.map((r) => (typeof r === 'object' ? { page: r.page, write: !!r.write } : { page: r, write: false }));

  /** the oldest of the frames passing a test, by load sequence */
  const oldest = (fr, ok) => { let s = -1; fr.forEach((f, k) => { if ((!ok || ok(f)) && (s < 0 || f.seq < fr[s].seq)) s = k; }); return s; };

  // Each policy: choose(ctx) -> {slot, reason, cleared?} for a fault with every frame full (clock-like ones also
  // handle empty frames themselves: sweeps: true); after(ctx) runs after every reference.
  const POL = {
    fifo: { choose(c) { const s = oldest(c.fr); return { slot: s, reason: 'loaded first, at reference ' + (c.fr[s].loadedAt + 1) }; } },
    lru: { choose(c) { let s = 0; c.fr.forEach((f, k) => { if (f.lastUse < c.fr[s].lastUse) s = k; }); return { slot: s, reason: 'last used at reference ' + (c.fr[s].lastUse + 1) + ', longest ago' }; } },
    opt: {
      choose(c) {
        const next = c.fr.map((f) => { for (let j = c.i + 1; j < c.refs.length; j++) if (c.refs[j].page === f.page) return j; return Infinity; });
        let s = 0;
        for (let k = 1; k < c.n; k++) if (next[k] > next[s]) s = k;
        return { slot: s, reason: next[s] === Infinity ? 'never used again' : 'next used at reference ' + (next[s] + 1) + ', the farthest ahead' };
      },
    },
    clock: {
      sweeps: true,
      choose(c) {
        const cleared = [];
        for (;;) {
          const f = c.fr[c.hand];
          if (f.page === null || !f.use) return { slot: c.hand, cleared, reason: 'its use bit was 0 when the hand reached frame ' + c.hand };
          f.use = 0; cleared.push(c.hand); c.hand = (c.hand + 1) % c.n;
        }
      },
      load(c, s) { c.hand = (s + 1) % c.n; },
    },
    second: {
      choose(c) {
        const cleared = [];
        for (;;) {
          const s = oldest(c.fr), f = c.fr[s];
          if (!f.use) return { slot: s, cleared, reason: 'first in the queue with its use bit clear' };
          f.use = 0; f.seq = ++c.seq; cleared.push(s);
        }
      },
    },
    eclock: {
      sweeps: true,
      choose(c) {
        const cleared = [];
        for (let round = 0; round < 3; round++) {
          for (let k = 0; k < c.n; k++) {
            const h = (c.hand + k) % c.n, f = c.fr[h];
            if (f.page === null || (!f.use && !f.dirty)) { c.hand = h; return { slot: h, cleared, reason: f.page === null ? 'free' : 'class (use 0, dirty 0), the best, found on scan ' + (2 * round + 1) }; }
          }
          for (let k = 0; k < c.n; k++) {
            const h = (c.hand + k) % c.n, f = c.fr[h];
            if (!f.use && f.dirty) { c.hand = h; return { slot: h, cleared, reason: 'class (use 0, dirty 1), found on scan ' + (2 * round + 2) }; }
            if (f.use) { f.use = 0; cleared.push(h); }
          }
        }
        throw new Error('unreachable');
      },
      load(c, s) { c.hand = (s + 1) % c.n; },
    },
    lfu: { choose(c) { let s = 0; c.fr.forEach((f, k) => { if (f.count < c.fr[s].count || (f.count === c.fr[s].count && f.seq < c.fr[s].seq)) s = k; }); return { slot: s, reason: 'used ' + c.fr[s].count + ' time' + (c.fr[s].count === 1 ? '' : 's') + ', the fewest' }; } },
    mfu: { choose(c) { let s = 0; c.fr.forEach((f, k) => { if (f.count > c.fr[s].count || (f.count === c.fr[s].count && f.seq < c.fr[s].seq)) s = k; }); return { slot: s, reason: 'used ' + c.fr[s].count + ' time' + (c.fr[s].count === 1 ? '' : 's') + ', the most' }; } },
    aging: {
      choose(c) { let s = 0; c.fr.forEach((f, k) => { if (f.age < c.fr[s].age || (f.age === c.fr[s].age && f.seq < c.fr[s].seq)) s = k; }); return { slot: s, reason: 'register ' + bin(c.fr[s].age, c.bits) + ', the smallest' }; },
      after(c) { if ((c.i + 1) % c.tick === 0) for (const f of c.fr) if (f.page !== null) { f.age = (f.age >> 1) | (f.use << (c.bits - 1)); f.use = 0; } },
    },
    nru: {
      choose(c) { let s = 0; const cl = (f) => 2 * f.use + f.dirty; c.fr.forEach((f, k) => { if (cl(f) < cl(c.fr[s])) s = k; }); const k = cl(c.fr[s]); return { slot: s, reason: 'class ' + k + ' (' + (k & 2 ? 'used' : 'not used') + ', ' + (k & 1 ? 'dirty' : 'clean') + '), the lowest' }; },
      after(c) { if ((c.i + 1) % c.reset === 0) for (const f of c.fr) f.use = 0; },
    },
  };

  M.replace = function (policy, refs, nFrames, opts) {
    const P = POL[policy];
    if (!P) throw new Error('unknown policy ' + policy);
    if (!(nFrames >= 1)) throw new Error('at least one frame');
    opts = opts || {};
    const name = NAMES[policy], R = M.normRefs(refs);
    const fr = Array.from({ length: nFrames }, () => ({ page: null, loadedAt: -1, lastUse: -1, seq: -1, use: 0, dirty: 0, count: 0, age: 0 }));
    const c = { fr, n: nFrames, refs: R, i: 0, hand: 0, seq: 0, bits: opts.bits || 8, tick: opts.tick || 1, reset: opts.reset || 4 };
    let faults = 0, hits = 0, writeBacks = 0;
    const steps = [];
    R.forEach(({ page, write }, i) => {
      c.i = i;
      const n = i + 1, at = fr.findIndex((f) => f.page === page), handFrom = c.hand;
      const st = { kind: 'ref', i, page, write, hit: at >= 0, slot: at, free: false, victim: null, victimSlot: -1, reason: '', writeBack: false, cleared: [] };
      const w = write ? ' (a write)' : '';
      if (at >= 0) {
        hits++;
        const f = fr[at];
        f.lastUse = i; f.use = 1; f.count++; if (write) f.dirty = 1;
        st.say = 'Reference ' + n + ': page ' + page + w + ' is in frame ' + at + ', a hit' + (policy === 'lru' ? '; it becomes the most recently used.' : policy === 'clock' ? '; its use bit is set and the hand stays at frame ' + c.hand + '.' : policy === 'fifo' ? '; FIFO changes nothing on a hit.' : /lfu|mfu/.test(policy) ? '; its count is now ' + f.count + '.' : policy === 'opt' ? '.' : '; its use bit is set.');
      } else {
        faults++;
        let ch;
        const empty = fr.findIndex((f) => f.page === null);
        if (!P.sweeps && empty >= 0) ch = { slot: empty, cleared: [] };
        else ch = P.choose(c);
        const s = ch.slot, f = fr[s];
        st.cleared = ch.cleared || [];
        const swept = st.cleared.length ? (policy === 'second' ? 'page' + (st.cleared.length > 1 ? 's ' : ' ') + list(st.cleared.map((k) => fr[k].page)) + (st.cleared.length > 1 ? ' get' : ' gets') + ' a second chance (use bit cleared, to the back of the queue), then ' : 'the hand clears the use bit' + (st.cleared.length > 1 ? 's' : '') + ' of frame' + (st.cleared.length > 1 ? 's ' : ' ') + list(st.cleared) + ', then ') : '';
        if (f.page === null) {
          st.free = true;
          st.say = 'Reference ' + n + ': page ' + page + w + ' faults and goes into free frame ' + s + (st.cleared.length ? ', after the hand clears the use bit' + (st.cleared.length > 1 ? 's' : '') + ' of frame' + (st.cleared.length > 1 ? 's ' : ' ') + list(st.cleared) : '') + '.';
        } else {
          st.victim = f.page; st.victimSlot = s; st.reason = ch.reason; st.writeBack = !!f.dirty;
          if (f.dirty) writeBacks++;
          st.say = 'Reference ' + n + ': page ' + page + w + ' faults; ' + swept + name + ' evicts page ' + st.victim + ' from frame ' + s + ': ' + st.reason + (f.dirty ? '; it is dirty, so it is written back first.' : '.');
        }
        Object.assign(f, { page, loadedAt: i, lastUse: i, seq: ++c.seq, use: 1, dirty: write ? 1 : 0, count: 1, age: 0 });
        st.slot = s;
        if (P.load) P.load(c, s);
      }
      if (P.after) P.after(c);
      st.frames = fr.map((f) => f.page);
      st.use = fr.map((f) => f.use);
      st.dirty = fr.map((f) => f.dirty);
      st.counts = fr.map((f) => (f.page === null ? 0 : f.count));
      if (policy === 'aging') st.ages = fr.map((f) => bin(f.age, c.bits));
      st.handFrom = handFrom; st.hand = c.hand;
      const filled = [...fr.keys()].filter((k) => fr[k].page !== null);
      if (policy === 'fifo' || policy === 'second') st.order = filled.sort((a, b) => fr[a].seq - fr[b].seq).map((k) => fr[k].page);
      if (policy === 'lru') st.order = filled.sort((a, b) => fr[a].lastUse - fr[b].lastUse).map((k) => fr[k].page);
      st.faults = faults; st.hits = hits; st.writeBacks = writeBacks;
      steps.push(st);
    });
    return { policy, name, nFrames, refs: refs.slice(), steps, faults, hits, writeBacks };
  };

  M.faultCurve = (policy, refs, fromN, toN, opts) => { const out = []; for (let n = fromN; n <= toN; n++) out.push({ n, faults: M.replace(policy, refs, n, opts).faults }); return out; };

  /** a seeded generator of numbers in [0, 1) */
  M.rng = function (seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  /** every string of length len over at most `pages` pages, up to renaming (each new page is the next number),
   *  on which `policy` faults more with n + 1 frames than with n; FIFO is followed reference by reference down the
   *  search tree, other policies are run on each whole string */
  function anomalies(policy, len, pages, n, limit) {
    const out = [], refs = [];
    out.tries = 0;
    if (policy === 'fifo') {
      // each depth keeps both queues as rings in flat arrays: [pages..] with a head and a size, n and n + 1 long
      const A = new Int8Array((len + 1) * n), Bq = new Int8Array((len + 1) * (n + 1));
      const ha = new Int8Array(len + 1), sa = new Int8Array(len + 1), hb = new Int8Array(len + 1), sb = new Int8Array(len + 1);
      const has = (Q, base, h, sz, k, p) => { for (let i = 0; i < sz; i++) if (Q[base + ((h + i) % k)] === p) return true; return false; };
      const dfs = (d, used, fa, fb) => {
        if (out.length >= limit) return;
        // the excess fb − fa grows by at most one a reference: prune what can no longer pass zero
        if (fb - fa + (len - d) <= 0) { out.tries += pages ** (len - d) > 1e9 ? 0 : 1; return; }
        if (d === len) { out.tries++; out.push(refs.slice()); return; }
        for (let p = 0; p <= Math.min(used, pages - 1); p++) {
          refs[d] = p;
          const a0 = d * n, a1 = (d + 1) * n, b0 = d * (n + 1), b1 = (d + 1) * (n + 1);
          for (let i = 0; i < n; i++) A[a1 + i] = A[a0 + i];
          for (let i = 0; i <= n; i++) Bq[b1 + i] = Bq[b0 + i];
          let h = ha[d], z = sa[d], ga = fa;
          if (!has(A, a0, h, z, n, p)) { ga++; if (z < n) { A[a1 + ((h + z) % n)] = p; z++; } else { A[a1 + h] = p; h = (h + 1) % n; } }
          ha[d + 1] = h; sa[d + 1] = z;
          h = hb[d]; z = sb[d]; let gb = fb;
          if (!has(Bq, b0, h, z, n + 1, p)) { gb++; if (z < n + 1) { Bq[b1 + ((h + z) % (n + 1))] = p; z++; } else { Bq[b1 + h] = p; h = (h + 1) % (n + 1); } }
          hb[d + 1] = h; sb[d + 1] = z;
          dfs(d + 1, Math.max(used, p + 1), ga, gb);
        }
      };
      dfs(0, 0, 0, 0);
      return out;
    }
    const dfs = (d, used) => {
      if (out.length >= limit) return;
      if (d === len) { out.tries++; if (M.replace(policy, refs, n + 1).faults > M.replace(policy, refs, n).faults) out.push(refs.slice()); return; }
      for (let p = 0; p <= Math.min(used, pages - 1); p++) { refs[d] = p; dfs(d + 1, Math.max(used, p + 1)); }
    };
    dfs(0, 0);
    return out;
  }
  const found = new Map();
  /** a string's shape: every page replaced by the order of its first use (so renamings share a shape) */
  M.refShape = (r) => { const m = new Map(); return r.map((p) => { if (!m.has(p)) m.set(p, m.size); return m.get(p); }).join(','); };
  const FAMOUS = '0,1,2,3,0,1,4,0,1,2,3,4';
  /** whether 12 of a string's references, in order (adjacent or not), are a renaming of the well-known example */
  M.holdsFamous = function (r) {
    const f = FAMOUS.split(',').map(Number);
    const go = (i, j, map, used) => {
      if (j === 12) return true;
      for (let k = i; k <= r.length - (12 - j); k++) {
        const want = map[f[j]];
        if (want === undefined ? used.includes(r[k]) : want !== r[k]) continue;
        const m2 = map.slice();
        if (want === undefined) m2[f[j]] = r[k];
        if (go(k + 1, j + 1, m2, want === undefined ? used.concat(r[k]) : used)) return true;
      }
      return false;
    };
    return r.length >= 12 && go(0, 0, [], []);
  };

  M.beladySearch = function (o) {
    o = o || {};
    const policy = o.policy || 'fifo', n = o.frames || 3, pages = Math.min(o.pages || 5, 7), seed = o.seed === undefined ? 1 : o.seed;
    const maxLen = Math.min(o.maxLength || o.length || (policy === 'fifo' ? 12 : 8), policy === 'fifo' ? 12 : 8);
    const R = M.rng(seed);
    const rename = (shape, used) => { const names = Array.from({ length: Math.max(used, pages) }, (_, k) => k + 1); for (let k = names.length - 1; k > 0; k--) { const j = Math.floor(R() * (k + 1)); [names[k], names[j]] = [names[j], names[k]]; } return shape.map((p) => names[p]); };
    const done = (refs, how) => {
      const a = M.replace(policy, refs, n).faults, b = M.replace(policy, refs, n + 1).faults;
      return { found: true, refs, frames: [n, n + 1], faults: [a, b], how, say: 'On `' + refs.join(' ') + '` ' + NAMES[policy] + ' faults ' + M.count(a, 'time') + ' with ' + M.count(n, 'frame') + ' but ' + M.count(b, 'time') + ' with ' + (n + 1) + ': more memory, more faults.' };
    };
    // 0. FIFO, three frames against four: the table found offline (src/core/mem-e-belady.js)
    if (policy === 'fifo' && n === 3 && M.BELADY_FIFO3) {
      const table = M.BELADY_FIFO3;
      if (table.length) {
        const shape = [...table[Math.floor(R() * table.length)]].map(Number), used = Math.max(...shape) + 1;
        const r = done(rename(shape, used), 'table');
        r.tries = table.length;
        r.say = 'One of ' + table.length + ' anomalies an exhaustive search found among all strings of 13 references over six pages (up to renaming the pages). ' + r.say;
        return r;
      }
    }
    // 1. exhaustive, shortest length first; the seed picks one of the shortest anomalies and renames its pages
    let tried = 0;
    for (let len = n + 2; len <= maxLen; len++) {
      const key = policy + ':' + len + ':' + pages + ':' + n;
      if (!found.has(key)) found.set(key, anomalies(policy, len, pages, n, 5000));
      const all = found.get(key).filter((r) => !M.holdsFamous(r));
      tried += found.get(key).tries;
      if (!all.length) continue;
      const pick = all[Math.floor(R() * all.length)], used = Math.max(...pick) + 1;
      const r = done(rename(pick, used), 'exhaustive');
      r.tries = tried;
      r.say = 'An exhaustive search of strings up to ' + len + ' references over ' + M.count(Math.min(used, pages), 'page') + ' finds ' + M.count(all.length, 'anomaly', 'anomalies') + (all.length >= 5000 ? ' (at least)' : '') + ' at length ' + len + ', counting strings that differ only in their page numbers once. ' + r.say;
      return r;
    }
    // 2. longer strings: simulated annealing at a fixed temperature on the excess faults, seeded
    const len = Math.max(maxLen + 2, o.length || 16), P2 = Math.max(pages, n + 3), temp = o.temp || 1, tries = o.tries || 20000;
    const score = (r) => M.replace(policy, r, n + 1).faults - M.replace(policy, r, n).faults;
    let refs = null, sc = -Infinity;
    for (let t = 0; t < tries; t++) {
      if (t % 5000 === 0) { refs = Array.from({ length: len }, () => 1 + Math.floor(R() * P2)); sc = score(refs); }
      const cand = refs.slice();
      cand[Math.floor(R() * len)] = 1 + Math.floor(R() * P2);
      const c = score(cand);
      if (c >= sc || R() < Math.exp((c - sc) / temp)) { refs = cand; sc = c; }
      if (sc > 0 && !M.holdsFamous(refs)) { const r2 = done(refs, 'annealing'); r2.tries = tried + t + 1; r2.say = 'No anomaly exists among strings up to ' + maxLen + ' references over ' + M.count(pages, 'page') + '; a randomised search over ' + len + ' references found one after ' + M.count(t + 1, 'try', 'tries') + '. ' + r2.say; return r2; }
    }
    return { found: false, refs: null, frames: [n, n + 1], faults: null, how: 'none', tries: tried + tries, say: 'No anomaly for ' + NAMES[policy] + ' going from ' + M.count(n, 'frame') + ' to ' + (n + 1) + ': none among all strings up to ' + maxLen + ' references over ' + M.count(pages, 'page') + ', and none in ' + M.count(tries, 'try', 'tries') + ' of a randomised search over ' + len + '.' };
  };
  M.findBelady = (o) => { const r = M.beladySearch(o); return r.found ? r : null; };

  (S.engines = S.engines || []).push({ name: 'Page replacement' });
})(globalThis.Proses = globalThis.Proses || {});
