// Memory engines, part 3: a TLB. A set-associative cache of translations (page number and address-space id to
// frame), fully associative when there is one set; each set replaces its least recently used entry. And the
// effective access time it buys.
//   S.Mem.tlb({entries, ways}) -> tlb
//     .lookup(vpn, asid) -> {hit, set, way, pfn, say}
//     .insert(vpn, pfn, asid) -> {set, way, victim: {vpn, asid} | null, say}
//     .flush(asid?)  drops every entry, or one address space's
//     .sets -> [[{vpn, asid, pfn, used}..]..]  (a copy, for drawing)
//   S.Mem.eat({hit, tlbNs, memNs, levels}) -> ns: a hit costs the TLB and one access, a miss the TLB, a read per
//     level and the access
//   S.Mem.eatWalk({hit, tlbNs, memNs, levels, pwcHit, pwcNs}) -> {ns, hitNs, missNs, say}   with a page-walk cache
//     that, when it hits (ratio pwcHit), leaves only the last level's read
//   S.Mem.tlbReach(entries, pageBytes) -> bytes the TLB maps at once
//   S.Mem.tlbRun({entries, ways, refs: [vpn | {vpn, asid}], levels, lastBits, tlbNs, memNs, pwc}) ->
//     {steps: [{kind: 'ref', i, vpn, asid, hit, set, way, filled, victim, victimAsid, pwcHit, reads, accesses, ns,
//      tlb, say}], hits, misses,
//      hitRatio, accesses, ns, eat, eatFormula}   pwc: entries of a page-walk cache (0 none) keyed by the page
//      number less its last lastBits (9) bits, kept LRU
//   S.Mem.switchRun({entries, ways, procs: [{asid, refs}], quantum, mode: 'asid' | 'flush', levels, tlbNs, memNs})
//     -> {mode, steps (refs and {kind: 'switch', tlb}), hits, misses, hitRatio, perProc: [{asid, hits, misses}]}
//   On a hit, set and way are where the entry was found; on a miss, where it was put (filled: true, with the
//   victim's vpn and asid if one was evicted). Every step carries tlb: S.Mem.tlbContents after it.
//   S.Mem.tlbContents(tlb) -> [[{vpn, asid, pfn, age}] a set, by way]   age: 0 the most recently used in its set
//     the processes take turns of quantum references; on a switch 'flush' empties the TLB, 'asid' keeps it
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.tlb = function (o) {
    const entries = o.entries || 8, ways = o.ways || entries, nSets = entries / ways;
    if (!Number.isInteger(nSets) || nSets < 1) throw new Error('entries must be a multiple of ways');
    const sets = Array.from({ length: nSets }, () => []);
    let clock = 0;
    const setOf = (vpn) => Number(BigInt(vpn) % BigInt(nSets));
    const same = (e, vpn, asid) => e.vpn === BigInt(vpn) && e.asid === (asid || 0);
    const T = {
      entries, ways, nSets,
      lookup(vpn, asid) {
        const s = setOf(vpn), set = sets[s], w = set.findIndex((e) => same(e, vpn, asid));
        if (w >= 0) { set[w].used = ++clock; return { hit: true, set: s, way: w, pfn: set[w].pfn, say: 'TLB hit in set ' + s + ', way ' + w + ': page ' + vpn + ' is in frame ' + set[w].pfn + '.' }; }
        return { hit: false, set: s, way: -1, pfn: null, say: 'TLB miss: set ' + s + ' holds no entry for page ' + vpn + (asid ? ' of address space ' + asid : '') + '.' };
      },
      insert(vpn, pfn, asid) {
        const s = setOf(vpn), set = sets[s], e = { vpn: BigInt(vpn), asid: asid || 0, pfn: BigInt(pfn), used: ++clock };
        const have = set.findIndex((x) => same(x, vpn, asid));
        if (have >= 0) { set[have] = e; return { set: s, way: have, victim: null, say: 'The TLB entry for page ' + vpn + ' is refreshed.' }; }
        if (set.length < ways) { set.push(e); return { set: s, way: set.length - 1, victim: null, say: 'Page ' + vpn + ' → frame ' + pfn + ' goes into a free way ' + (set.length - 1) + ' of set ' + s + '.' }; }
        let w = 0;
        for (let i = 1; i < set.length; i++) if (set[i].used < set[w].used) w = i;
        const victim = { vpn: set[w].vpn, asid: set[w].asid };
        set[w] = e;
        return { set: s, way: w, victim, say: 'Set ' + s + ' is full: page ' + victim.vpn + ', used longest ago, makes way for page ' + vpn + '.' };
      },
      flush(asid) { for (const set of sets) { for (let i = set.length - 1; i >= 0; i--) if (asid === undefined || set[i].asid === asid) set.splice(i, 1); } },
      get sets() { return sets.map((set) => set.map((e) => Object.assign({}, e))); },
    };
    return T;
  };

  M.eat = (o) => o.hit * (o.tlbNs + o.memNs) + (1 - o.hit) * (o.tlbNs + (o.levels + 1) * o.memNs);

  M.eatWalk = function (o) {
    const t = o.tlbNs || 0, m = o.memNs, L = o.levels, p = o.pwcHit || 0, c = o.pwcNs || 0;
    const hitNs = t + m, missNs = t + c + (p * 1 + (1 - p) * L) * m + m, ns = o.hit * hitNs + (1 - o.hit) * missNs;
    return { ns, hitNs, missNs, say: 'EAT = ' + o.hit + ' × ' + +hitNs.toFixed(2) + ' + ' + +(1 - o.hit).toFixed(4) + ' × ' + +missNs.toFixed(2) + ' = ' + +ns.toFixed(2) + ' ns' + (p ? ', the walk cache saving ' + +(p * (L - 1) * m).toFixed(2) + ' ns on an average miss (' + p + ' × ' + M.count(L - 1, 'read') + ' × ' + m + ' ns)' : '') + '.' };
  };
  M.tlbReach = (entries, pageBytes) => entries * pageBytes;

  /** the TLB's contents: a list a set, a way a slot, each {vpn, asid, pfn, age} with age 0 the most recent */
  M.tlbContents = (T) => T.sets.map((set) => set.map((e) => ({ vpn: Number(e.vpn), asid: e.asid, pfn: Number(e.pfn), age: set.filter((x) => x.used > e.used).length })));

  /** a small LRU cache of keys */
  function lru(size) {
    const keys = [];
    return {
      has(k) { const i = keys.indexOf(k); if (i < 0) return false; keys.splice(i, 1); keys.push(k); return true; },
      put(k) { if (!size) return; const i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); else if (keys.length >= size) keys.shift(); keys.push(k); },
      clear() { keys.length = 0; },
    };
  }

  /** one translation through a TLB (and maybe a walk cache): the step, and the TLB filled on a miss */
  function translate(T, P, vpn, asid, o, i) {
    const L = o.levels || 4, m = o.memNs === undefined ? 100 : o.memNs, t = o.tlbNs === undefined ? 1 : o.tlbNs, lastBits = o.lastBits || 9;
    const r = T.lookup(vpn, asid);
    const st = { kind: 'ref', i, vpn: Number(vpn), asid: asid || 0, hit: r.hit, set: r.set, way: r.way, victim: null, pwcHit: false, reads: 0 };
    const snap = () => { st.tlb = M.tlbContents(T); return st; };
    if (r.hit) { st.filled = false; st.accesses = 1; st.ns = t + m; st.say = 'Page ' + vpn + (asid ? ' of address space ' + asid : '') + ': ' + r.say.replace(/^TLB hit/, 'a TLB hit') + ' 1 memory access, ' + st.ns + ' ns.'; return snap(); }
    const key = (asid || 0) + ':' + (BigInt(vpn) >> BigInt(lastBits));
    st.pwcHit = P ? P.has(key) : false;
    st.reads = st.pwcHit ? 1 : L;
    if (P) P.put(key);
    const ins = T.insert(vpn, vpn, asid);
    st.victim = ins.victim ? Number(ins.victim.vpn) : null;
    st.victimAsid = ins.victim ? ins.victim.asid : null;
    st.set = ins.set; st.way = ins.way; st.filled = true;
    st.accesses = st.reads + 1;
    st.ns = t + st.accesses * m;
    st.say = 'Page ' + vpn + (asid ? ' of address space ' + asid : '') + ': a TLB miss; ' + (st.pwcHit ? 'the walk cache holds the last table, so 1 table read' : 'the walk reads ' + L + ' tables') + ', then the data: ' + M.count(st.accesses, 'access', 'accesses') + ', ' + st.ns + ' ns.' + (st.victim !== null ? ' The TLB entry for page ' + st.victim + ' makes way.' : '') + ' The new entry goes into set ' + ins.set + ', way ' + ins.way + '.';
    return snap();
  }

  M.tlbRun = function (o) {
    const T = M.tlb({ entries: o.entries, ways: o.ways }), P = o.pwc ? lru(o.pwc) : null, steps = [];
    o.refs.forEach((r, i) => { const vpn = typeof r === 'object' ? r.vpn : r, asid = typeof r === 'object' ? r.asid : 0; steps.push(translate(T, P, vpn, asid, o, i)); });
    const hits = steps.filter((s) => s.hit).length, misses = steps.length - hits, hitRatio = steps.length ? hits / steps.length : 0;
    const accesses = steps.reduce((a, s) => a + s.accesses, 0), ns = steps.reduce((a, s) => a + s.ns, 0);
    const eat = steps.length ? ns / steps.length : 0;
    const pwcHits = steps.filter((s) => !s.hit && s.pwcHit).length;
    const eatFormula = M.eatWalk({ hit: hitRatio, tlbNs: o.tlbNs === undefined ? 1 : o.tlbNs, memNs: o.memNs === undefined ? 100 : o.memNs, levels: o.levels || 4, pwcHit: misses ? pwcHits / misses : 0 }).ns;
    return { steps, hits, misses, hitRatio, accesses, ns, eat, eatFormula, say: M.count(hits, 'hit') + ' in ' + M.count(steps.length, 'reference') + ', a hit ratio of ' + +hitRatio.toFixed(3) + '; the effective access time is ' + +eat.toFixed(2) + ' ns.' };
  };

  M.switchRun = function (o) {
    const T = M.tlb({ entries: o.entries, ways: o.ways }), steps = [], q = o.quantum || 4, mode = o.mode || 'asid';
    const pos = o.procs.map(() => 0), per = o.procs.map((p) => ({ asid: p.asid, hits: 0, misses: 0 }));
    let cur = -1;
    while (pos.some((p, k) => p < o.procs[k].refs.length)) {
      for (let k = 0; k < o.procs.length; k++) {
        const pr = o.procs[k];
        if (pos[k] >= pr.refs.length) continue;
        if (cur !== -1 && cur !== k) {
          if (mode === 'flush') T.flush();
          steps.push({ kind: 'switch', from: o.procs[cur].asid, to: pr.asid, mode, tlb: M.tlbContents(T), say: 'A context switch to address space ' + pr.asid + ': ' + (mode === 'flush' ? 'the TLB is flushed, so every entry is lost.' : 'entries are tagged with their address space, so nothing is flushed.') });
        }
        cur = k;
        for (let j = 0; j < q && pos[k] < pr.refs.length; j++, pos[k]++) {
          const st = translate(T, null, pr.refs[pos[k]], pr.asid, o, steps.length);
          if (st.hit) per[k].hits++; else per[k].misses++;
          steps.push(st);
        }
      }
    }
    const hits = per.reduce((a, p) => a + p.hits, 0), misses = per.reduce((a, p) => a + p.misses, 0);
    return { mode, steps, hits, misses, hitRatio: hits / Math.max(1, hits + misses), perProc: per };
  };
})(globalThis.Proses = globalThis.Proses || {});
