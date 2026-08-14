// The Memory lab, part two: the addresses translated, one after another, through the TLB and the chosen table, and
// the numbers the last pictures need (the tables' memory for each design on the same space, the access time).
//   ML.translate(model, v) -> {steps, rows, hits, misses, faults, accesses, ns, tlb}
//     steps: the trace, in order: {kind: 'tlb', i, hit, set, way, vpn, pfn, tlb (contents after), say}, then on a
//     miss the walk's own steps from the engine (hierarchical: split, read, frame | fault; hashed and inverted: hash,
//     anchor, compare, frame | fault), each with i and table: v.table; then {kind: 'fill', set, way, victim} when
//     the TLB takes the translation, {kind: 'prot'} when the access is not allowed, and {kind: 'done', i, ok, pa,
//     accesses, reads, ns, hit, fault}
//     rows: one per address {i, va, access, vpn, offset, hit, ok, fault, pa, pfn, reads, accesses, ns, region}
//   ML.designs(model, v) -> [{id, name, bytes, per, note}]   the tables' memory for the space, each design
//   ML.eat(run, v, model) -> {h, t, m, r, hitNs, missNs, ns, measured, n, say}
(function (S) {
  'use strict';
  const ML = S.MemLab;
  const M = () => S.Mem;
  const B = (v) => BigInt(v);
  const ns = (x) => +(+x).toFixed(2);

  ML.translate = function (model, v) {
    const cfg = model.cfg, T = v.tlb > 0 ? M().tlb({ entries: v.tlb, ways: v.ways || v.tlb }) : null;
    const steps = [], rows = [], dirty = new Set(), t = v.tlbNs, m = v.memNs, H = (x) => M().hex(x, cfg.paBits);
    let hits = 0, misses = 0, faults = 0;
    model.addrs.forEach((a, i) => {
      const va = a.va, vpn = va >> B(cfg.offBits), off = va & ((1n << B(cfg.offBits)) - 1n);
      const mapped = model.byVpn.get(vpn), region = mapped ? model.regions[mapped.region] : null;
      const verb = a.access === 'w' ? 'a write' : a.access === 'x' ? 'an instruction fetch' : 'a read';
      const row = { i, va, access: a.access, vpn, offset: off, hit: false, ok: false, fault: null, pa: null, pfn: null, reads: 0, accesses: 0, ns: 0, region };
      const push = (st) => { steps.push(Object.assign({ i, table: v.table }, st)); };
      let pfn = null, fromTlb = false;
      if (T) {
        const r = T.lookup(vpn, 0);
        if (r.hit) { hits++; pfn = r.pfn; fromTlb = true; } else misses++;
        push({ kind: 'tlb', hit: r.hit, set: r.set, way: r.way, vpn, pfn: r.hit ? r.pfn : null, tlb: M().tlbContents(T),
          say: 'Address ' + (i + 1) + ', ' + verb + ' of ' + M().hex(va, cfg.vaBits) + ': page ' + ML.hx(vpn) + ', offset ' + ML.hx(off) + '. ' + (r.hit ? 'The TLB has it in set ' + r.set + ', way ' + r.way + ': frame ' + ML.hx(r.pfn) + ', with no walk.' : 'Set ' + r.set + ' of the TLB holds no entry for it: a miss, so the ' + (v.table === 'hier' ? cfg.levels + '-level table is walked.' : v.table === 'hashed' ? 'hashed table is searched.' : 'inverted table is searched.')) });
      } else misses++;
      let reads = 0, fault = null;
      if (!fromTlb) {
        if (v.table === 'hier') {
          const tr = M().translate(model.pt, va);
          for (const st of tr.steps) {
            if (st.kind === 'split' && T) continue;
            const extra = st.kind === 'read' ? { entry: model.pt.tables[st.table].entries.get(st.index) || null } : {};
            push(Object.assign({}, st, extra, { say: st.kind === 'split' ? 'Address ' + (i + 1) + ', ' + verb + '. ' + st.say : st.say }));
          }
          reads = tr.ok ? tr.accesses - 1 : tr.accesses;
          if (tr.ok) pfn = tr.pfn; else fault = 'page';
        } else if (v.table === 'hashed') {
          const lk = model.hpt.lookup(Number(vpn), Number(off));
          for (const st of lk.steps) {
            const s2 = Object.assign({}, st);
            if (st.kind === 'frame') { s2.pa = (B(st.pfn) << B(cfg.offBits)) | off; s2.say = 'Frame ' + ML.hx(st.pfn) + ' joined to offset ' + ML.hx(off) + ' gives ' + H(s2.pa) + '; with the data, ' + st.accesses + ' memory accesses.'; }
            if (st.kind === 'hash' && !T) s2.say = 'Address ' + (i + 1) + ', ' + verb + ' of ' + M().hex(va, cfg.vaBits) + '. ' + st.say;
            push(s2);
          }
          reads = lk.ok ? lk.accesses - 1 : lk.accesses;
          if (lk.ok) pfn = B(lk.pfn); else fault = 'page';
        } else {
          const lk = model.ipt.lookup(1, Number(vpn), Number(off));
          for (const st of lk.steps) {
            const s2 = Object.assign({}, st);
            if (st.kind === 'frame') { s2.pa = (B(st.frame) << B(cfg.offBits)) | off; s2.say = 'Entry ' + st.frame + ' matched, so the page is in frame ' + st.frame + ': ' + st.frame + ' joined to offset ' + ML.hx(off) + ' gives ' + H(s2.pa) + '; with the data, ' + st.accesses + ' memory accesses.'; }
            if ((st.kind === 'fault' || (st.kind === 'anchor' && st.frame === -1)) && mapped) s2.say += ' Page ' + ML.hx(vpn) + ' is mapped but not resident: the inverted table has only ' + v.frames + ' frames, so the kernel finds it in its own records, on disk.';
            if (st.kind === 'hash' && !T) s2.say = 'Address ' + (i + 1) + ', ' + verb + ' of ' + M().hex(va, cfg.vaBits) + '. ' + st.say;
            push(s2);
          }
          reads = lk.ok ? lk.accesses - 1 : lk.accesses;
          if (lk.ok) pfn = B(lk.frame); else fault = 'page';
        }
        if (!fault && T) {
          const ins = T.insert(vpn, pfn, 0);
          push({ kind: 'fill', set: ins.set, way: ins.way, vpn, pfn, victim: ins.victim ? ins.victim.vpn : null, tlb: M().tlbContents(T), say: 'The TLB keeps the translation: page ' + ML.hx(vpn) + ' → frame ' + ML.hx(pfn) + ' goes into set ' + ins.set + ', way ' + ins.way + (ins.victim ? ', where page ' + ML.hx(ins.victim.vpn) + ', used longest ago, makes way.' : ', a free way.') });
        }
      }
      if (!fault && region && ((a.access === 'w' && !region.perm.includes('w')) || (a.access === 'x' && !region.perm.includes('x')))) {
        fault = 'protection';
        push({ kind: 'prot', say: 'The entry allows ' + region.perm.split('').map((c) => ({ r: 'reading', w: 'writing', x: 'running' })[c]).join(' and ') + ' (' + region.name + ', ' + region.perm + '): ' + verb + ' is refused with a protection fault, after ' + (reads ? reads + ' table read' + (reads > 1 ? 's' : '') : 'the TLB hit') + '.' });
      }
      if (fault) faults++;
      const ok = !fault;
      if (ok && a.access === 'w') dirty.add(vpn);
      const accesses = reads + (ok ? 1 : 0), cost = (T ? t : 0) + accesses * m;
      Object.assign(row, { hit: fromTlb, ok, fault, pfn, pa: ok ? (pfn << B(cfg.offBits)) | off : null, reads, accesses, ns: cost });
      rows.push(row);
      push({ kind: 'done', ok, hit: fromTlb, fault, pa: row.pa, pfn, reads, accesses, ns: cost, dirty: dirty.has(vpn),
        say: ok ? 'Address ' + (i + 1) + ': ' + M().hex(va, cfg.vaBits) + ' → ' + H(row.pa) + (fromTlb ? ', a TLB hit: 1 memory access, ' + ns(cost) + ' ns.' : ', after ' + reads + ' table read' + (reads === 1 ? '' : 's') + ' and the data: ' + accesses + ' memory accesses, ' + ns(cost) + ' ns.') + (a.access === 'w' ? ' The write sets the page’s dirty bit.' : '')
          : 'Address ' + (i + 1) + ': ' + (fault === 'page' ? 'a page fault after ' + reads + ' memory access' + (reads === 1 ? '' : 'es') + '; the kernel must map page ' + ML.hx(vpn) + ' or stop the process.' : 'a protection fault; the kernel sends the process a segmentation fault.') });
    });
    const ok = rows.filter((r) => r.ok);
    return { steps, rows, hits, misses, faults, accesses: ok.reduce((a, r) => a + r.accesses, 0), ns: ok.reduce((a, r) => a + r.ns, 0), n: ok.length, tlb: T, dirty };
  };

  /** the memory each design takes for this space; a forward table is per process, the inverted one is shared */
  ML.designs = function (model, v) {
    const cfg = model.cfg, procs = v.procs || 1, u = model.usage;
    const flat = 2 ** cfg.vpnBits * cfg.pteBytes, hs = model.hpt.size(), is = model.ipt.size();
    return [
      { id: 'flat', name: 'one flat table', bytes: flat * procs, per: flat, note: '2^' + cfg.vpnBits + ' entries × ' + cfg.pteBytes + ' B' + (procs > 1 ? ', × ' + procs + ' processes' : '') },
      { id: 'hier', name: cfg.levels + '-level tables', bytes: u.bytes * procs, per: u.bytes, note: u.tables + ' table' + (u.tables === 1 ? '' : 's') + ' (' + u.perLevel.map((n, i) => n + ' at L' + (i + 1)).join(', ') + ')' + (procs > 1 ? ', × ' + procs : '') },
      { id: 'hashed', name: 'hashed, ' + v.buckets + ' buckets', bytes: hs.total * procs, per: hs.total, note: model.hpt.nodes.length + ' entries × ' + 2 * cfg.pteBytes + ' B + ' + v.buckets + ' buckets × ' + cfg.pteBytes + ' B' + (procs > 1 ? ', × ' + procs : '') },
      { id: 'inverted', name: 'inverted, ' + v.frames + ' frames', bytes: is.total, per: is.total, note: v.frames + ' entries × ' + cfg.pteBytes + ' B + ' + v.buckets + ' anchors × 4 B, one for the whole system' },
    ];
  };

  ML.eat = function (run, v, model) {
    const t = v.tlb > 0 ? v.tlbNs : 0, m = v.memNs, okRows = run.rows.filter((r) => r.ok), n = okRows.length;
    const hitsOk = okRows.filter((r) => r.hit).length, missRows = okRows.filter((r) => !r.hit);
    const h = n ? hitsOk / n : 0, r = missRows.length ? missRows.reduce((a, x) => a + x.reads, 0) / missRows.length : (v.table === 'hier' ? model.cfg.levels : 1);
    const hitNs = t + m, missNs = t + r * m + m, eatNs = h * hitNs + (1 - h) * missNs, measured = n ? run.ns / n : 0;
    return { h, t, m, r, hitNs, missNs, ns: eatNs, measured, n, say: 'EAT = ' + ns(h) + ' × ' + ns(hitNs) + ' + ' + ns(1 - h) + ' × ' + ns(missNs) + ' = ' + ns(eatNs) + ' ns' };
  };
})(globalThis.Proses = globalThis.Proses || {});
