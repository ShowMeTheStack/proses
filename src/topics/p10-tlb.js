// Part 10, the TLB. A reference string of page numbers through a set-associative TLB (sets as rows, ways as columns,
// least recently used replaced), every miss paying for a page walk; then two processes sharing a TLB, flushed on every
// switch or kept apart by address-space ids. Engines: S.Mem.tlbRun, S.Mem.switchRun (src/core/mem-c-tlb.js).
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const pages = (v) => { for (const x of v) if (!/^\d+$/.test(x) || +x > 9999) return 'Pages: whole numbers from 0 to 9999 ("' + x + '")'; return null; };


  /** a TLB drawn as sets × ways; at most 16 entries */
  function tlbGrid(prefix, x, y, nSets, ways, sets, o) {
    o = o || {};
    const items = [], cw = Math.min(84, Math.floor(600 / ways)), ch = 32;
    items.push(H.text(prefix + 'T', x, y - 10, o.title || 'TLB: ' + nSets + ' set' + (nSets > 1 ? 's' : '') + ' × ' + ways + ' way' + (ways > 1 ? 's' : ''), 'title'));
    for (let s = 0; s < nSets; s++) {
      items.push(H.text(prefix + 'sl' + s, x + 52, y + s * (ch + 6) + 21, 'set ' + s, 'tick', 12, 'end'));
      for (let w = 0; w < ways; w++) {
        const e = sets[s] && sets[s][w], on = o.set === s && o.way === w;
        const cls = 'mb-slot' + (e ? '' : ' empty') + (on ? (o.hit ? ' hit' : ' in') : '') + (e && o.asidCls ? ' ' + o.asidCls(e.asid) : '');
        items.push(H.cell(prefix + 'c' + s + '_' + w, x + 60 + w * cw, y + s * (ch + 6), cw - 4, ch, e ? (o.label ? o.label(e) : String(e.vpn)) : '', cls, 14, { rx: 3 }));
      }
    }
    return { items, h: nSets * (ch + 6), w: 60 + ways * cw };
  }

  S.topic({
    id: 'mem-tlb', family: 'p10-tlb', order: 10, title: 'The TLB: hits and misses',
    blurb: 'Every load would need a page-table walk first: one memory read per level before the data. The translation lookaside buffer keeps recent translations, page number to frame, in a small fast cache. A hit costs the TLB and one memory access; a miss costs the whole walk, and the new translation replaces the least recently used entry of its set. A set-associative TLB puts page p in set p mod sets. Because programs reuse the same pages, most references hit.',
    inputs: [
      { id: 'entries', kind: 'choice', label: 'Entries', def: '4', options: ['2', '4', '8', '16'].map((v) => ({ value: v, label: v })) },
      { id: 'ways', kind: 'choice', label: 'Associativity', def: 'full', options: [{ value: '1', label: 'direct-mapped' }, { value: '2', label: '2-way' }, { value: '4', label: '4-way' }, { value: 'full', label: 'fully associative' }] },
      { id: 'levels', kind: 'number', label: 'Table levels', def: 4, min: 1, max: 5 },
      { id: 'pwc', kind: 'choice', label: 'Page-walk cache', def: '0', options: [{ value: '0', label: 'none' }, { value: '2', label: '2 entries' }, { value: '4', label: '4 entries' }] },
      { id: 'refs', kind: 'list', label: 'Pages referenced', def: ['3', '4', '3', '5', '12', '3', '4', '20', '12', '3', '28', '4', '5', '3'], min: 2, max: 18, check: pages },
    ],
    check: (inp) => (inp.ways !== 'full' && +inp.ways > +inp.entries ? 'Associativity: at most as many ways as entries' : null),
    presets: [
      { label: 'Four entries, fully associative', values: {} },
      { label: 'Direct-mapped: pages that collide', values: { entries: '4', ways: '1', refs: ['1', '5', '1', '5', '9', '1', '2', '6', '2', '5'] } },
      { label: 'A loop larger than the TLB', values: { entries: '4', refs: ['1', '2', '3', '4', '5', '1', '2', '3', '4', '5', '1', '2'] } },
      { label: 'The same loop, 8 entries', values: { entries: '8', refs: ['1', '2', '3', '4', '5', '1', '2', '3', '4', '5', '1', '2'] } },
      { label: 'A walk cache for neighbouring pages', values: { entries: '2', ways: 'full', pwc: '2', levels: 4, refs: ['512', '513', '514', '515', '512', '1030', '1031', '513', '516'] } },
      { label: '2-way, 8 entries, a long string', values: { entries: '8', ways: '2', refs: ['0', '1', '2', '8', '0', '16', '1', '3', '0', '24', '2', '1', '8', '0', '3', '4'] } },
    ],
    counters: [{ id: 'hits', label: 'hits' }, { id: 'misses', label: 'misses' }, { id: 'acc', label: 'memory accesses' }],
    run(inp) {
      const entries = +inp.entries, ways = inp.ways === 'full' ? entries : +inp.ways, nSets = entries / ways, refs = inp.refs.map(Number);
      const R = M().tlbRun({ entries, ways, refs, levels: inp.levels, tlbNs: 1, memNs: 100, pwc: +inp.pwc });
      const F = new S.Frames(['hits', 'misses', 'acc']), view = H.box(0, 0, 790, 480);
      const cw = Math.min(42, Math.floor(740 / refs.length));
      const draw = (k) => {
        const items = [H.text('rt', 20, 18, 'pages referenced', 'title')];
        refs.forEach((p, j) => {
          items.push(H.cell('r' + j, 20 + j * cw, 28, cw - 3, 30, p, 'mb-ref' + (j === k ? ' act' : j > k ? ' dim' : ''), 14, { rx: 0 }));
          if (j <= k) items.push(H.text('m' + j, 20 + j * cw + (cw - 3) / 2, 80, R.steps[j].hit ? '✓' : 'miss', R.steps[j].hit ? 'good' : 'bad', 12, 'middle'));
        });
        const st = k >= 0 ? R.steps[k] : null;
        const g = tlbGrid('t', 20, 128, nSets, ways, k >= 0 ? R.steps[k].tlb : Array.from({ length: nSets }, () => []), { set: st ? st.set : -1, way: st ? st.way : -1, hit: st && st.hit });
        items.push(...g.items);
        const y0 = 140 + g.h + 24;
        if (st) {
          items.push(H.text('ex1', 20, y0, 'page ' + st.vpn + ' → set ' + st.vpn + ' mod ' + nSets + ' = ' + st.set, 'p10-sum', 14));
          items.push(H.text('ex2', 20, y0 + 28, st.hit ? 'hit: TLB 1 ns + memory 100 ns = ' + st.ns + ' ns' : 'miss: TLB 1 ns + ' + st.reads + ' table read' + (st.reads > 1 ? 's' : '') + ' + data = ' + st.ns + ' ns', 'p10-sum ' + (st.hit ? 'good' : 'bad'), 14));
          if (st.victim !== null) items.push(H.text('ex3', 20, y0 + 56, 'page ' + st.victim + ' was the least recently used in set ' + st.set + ': out', 'hot', 14));
          if (+inp.pwc && !st.hit) items.push(H.text('ex4', 20, y0 + 84, 'walk cache: ' + (st.pwcHit ? 'hit, only the last level read' : 'miss, the full walk'), st.pwcHit ? 'good' : 'tick', 13));
        }
        // the running totals
        const done = R.steps.slice(0, k + 1), hits = done.filter((s) => s.hit).length, ns = done.reduce((a, s) => a + s.ns, 0);
        items.push(H.text('tot', 20, 464, k < 0 ? 'every hit: 101 ns; every miss: ' + (1 + (inp.levels + 1) * 100) + ' ns' : H.plural(hits, 'hit') + ' in ' + done.length + ' · average ' + H.f(ns / done.length, 1) + ' ns per reference', 'strong', 14));
        return items;
      };
      F.add({ items: draw(-1), say: `A TLB of ${H.plural(entries, 'entry', 'entries')} in ${H.plural(nSets, 'set')} of ${H.plural(ways, 'way')}, and a ${inp.levels}-level page table. A hit costs 1 ns for the TLB and 100 ns for the data; a miss also reads ${H.plural(inp.levels, 'table')}, ${1 + (inp.levels + 1) * 100} ns in all.`, meta: { phase: 'start', entries, nSets, ways, levels: inp.levels, missNs: 1 + (inp.levels + 1) * 100, consts: [100, 101] }, view, hl: { d: [0] } });
      R.steps.forEach((st, k) => {
        F.count(st.hit ? 'hits' : 'misses'); F.count('acc', st.accesses);
        const prior = refs.slice(0, k).includes(st.vpn);
        const say = st.hit ? `Page ${st.vpn} is in set ${st.set}, way ${st.way}: a hit, ${st.ns} ns.` : `Page ${st.vpn} goes to set ${st.set} (${st.vpn} mod ${nSets}) and is not there: a miss.` + (prior ? ' It was here before but has been pushed out.' : ' It is the first touch of this page.') + ' ' + (st.pwcHit ? 'The walk cache holds the upper levels, so only 1 table is read' : `The walk reads ${H.plural(inp.levels, 'table')}`) + `, then the data: ${st.ns} ns.` + (st.victim !== null ? ` Page ${st.victim}, least recently used in its set, makes way.` : ` It fills a free way of set ${st.set}.`);
        F.add({ items: draw(k), say, meta: { phase: 'ref', i: k, vpn: st.vpn, hit: st.hit, set: st.set, way: st.way, victim: st.victim === null ? -1 : st.victim, ns: st.ns, reads: st.reads, nSets, levels: inp.levels, prior, pwcHit: st.pwcHit }, view, hl: { d: st.hit ? [1] : [2, 3] } });
      });
      F.add({ items: draw(refs.length - 1), say: `${H.plural(R.hits, 'hit')} and ${H.plural(R.misses, 'miss', 'misses')}: a hit ratio of ${H.f(R.hitRatio, 3)}. The ${refs.length} references took ${R.ns} ns, ${H.f(R.eat, 2)} ns each on average, against 100 ns with no translation at all and ${1 + (inp.levels + 1) * 100 - 1} ns with a walk every time.`, meta: { phase: 'end', mem: 100, hits: R.hits, misses: R.misses, ratio: R.hitRatio, ns: R.ns, eat: R.eat, n: refs.length, walkNs: (inp.levels + 1) * 100 }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('TLB', ['set = page mod sets', 'hit: TLB + 1 memory access', 'miss: TLB + one read per level + 1 access', 'fill the LRU way of the set', 'average = total time ÷ references']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1].meta.phase === 'ref' && fr[i + 1].meta.prior, pick: 'option', ask: (fr, i) => `Page ${fr[i + 1].meta.vpn} is next, and it has been used before. Hit or miss?`, options: ['hit', 'miss'], answer: (fr, i) => (fr[i + 1].meta.hit ? 'hit' : 'miss'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A TLB hit costs 1 ns and memory 100 ns; a 4-level table. What does a miss cost?', options: ['501 ns', '101 ns', '401 ns', '500 ns'], answer: 0, why: '1 + 4 × 100 + 100.' },
      { q: 'A 4-entry 2-way TLB has how many sets?', options: ['2', '4', '1', '8'], answer: 0, why: 'Sets = entries ÷ ways.' },
      { q: 'In a direct-mapped TLB with 4 sets, pages 1 and 5…', options: ['compete for the same entry', 'can both be held', 'never miss', 'go to sets 1 and 5'], answer: 0, why: 'Both are 1 mod 4.' },
      { q: 'A loop over 5 pages through a 4-entry LRU TLB hits…', options: ['never, once it is going', 'every time', 'every other time', 'four times in five'], answer: 0, why: 'LRU always evicts the page needed next; one more entry fixes it.' },
      { q: 'Why do TLBs work at all with so few entries?', options: ['programs reuse the same pages over and over (locality)', 'pages are large', 'the OS preloads them', 'misses are free'], answer: 0, why: 'Temporal and spatial locality keep the working pages few.' },
    ],
  });

  S.topic({
    id: 'mem-tlb-switch', family: 'p10-tlb', order: 20, title: 'ASIDs against flushing',
    blurb: 'Each process has its own page table, so page 3 of one process is not page 3 of another. On a context switch the TLB must either be flushed, losing every translation, or its entries must carry an address-space id (ASID) so the processes\' entries can live side by side and only matching ones hit. The same two processes run in turns below, on two TLBs: one flushed at each switch, one tagged.',
    inputs: [
      { id: 'a', kind: 'list', label: 'Process A pages', def: ['1', '2', '3', '1', '2', '3', '1', '2', '3', '1', '2', '3'], min: 1, max: 14, check: pages },
      { id: 'b', kind: 'list', label: 'Process B pages', def: ['1', '7', '1', '7', '1', '7', '1', '7'], min: 1, max: 14, check: pages },
      { id: 'quantum', kind: 'number', label: 'References per turn', def: 3, min: 1, max: 8 },
      { id: 'entries', kind: 'choice', label: 'TLB entries', def: '8', options: ['4', '8'].map((v) => ({ value: v, label: v + ', fully associative' })) },
    ],
    presets: [
      { label: 'Two small processes, turns of 3', values: {} },
      { label: 'Longer turns: flushing matters less', values: { quantum: 6 } },
      { label: 'Turns of 1: a switch every reference', values: { quantum: 1, a: ['1', '2', '1', '2', '1', '2'], b: ['5', '6', '5', '6', '5', '6'] } },
      { label: 'Too many pages for 4 entries', values: { entries: '4', a: ['1', '2', '3', '1', '2', '3', '1', '2', '3'], b: ['4', '5', '6', '4', '5', '6', '4', '5', '6'] } },
    ],
    counters: [{ id: 'fh', label: 'hits, flushed' }, { id: 'ah', label: 'hits, with ASIDs' }],
    run(inp) {
      const entries = +inp.entries, a = inp.a.map(Number), b = inp.b.map(Number);
      const procs = [{ asid: 1, refs: a }, { asid: 2, refs: b }];
      const run = (mode) => M().switchRun({ entries, ways: entries, procs, quantum: inp.quantum, mode, levels: 4, tlbNs: 1, memNs: 100 });
      const Rf = run('flush'), Ra = run('asid');
      const F = new S.Frames(['fh', 'ah']), view = H.box(0, 0, 790, 480), n = Ra.steps.length;
      const pcls = (asid) => H.pc(asid - 1);
      const cw = Math.min(36, Math.floor(690 / n));
      const draw = (k) => {
        const items = [H.text('tl', 20, 18, 'the references in turn (A, B) with the switches', 'title')];
        Ra.steps.forEach((st, j) => {
          const x = 80 + j * cw, on = j === k, past = j <= k;
          if (st.kind === 'switch') items.push(H.cell('s' + j, x, 28, cw - 3, 30, '⇄', 'mb-ord' + (on ? ' act' : past ? '' : ' none'), 13, { rx: 0 }));
          else items.push(H.cell('s' + j, x, 28, cw - 3, 30, st.vpn, 'p10-box ' + (on ? 'act' : pcls(st.asid)) + (past ? '' : ' dim'), 13, { rx: 0 }));
          if (past && st.kind === 'ref') {
            items.push(H.text('fm' + j, x + (cw - 3) / 2, 78, Rf.steps[j].hit ? '✓' : '✗', Rf.steps[j].hit ? 'good' : 'bad', 13, 'middle'));
            items.push(H.text('am' + j, x + (cw - 3) / 2, 98, st.hit ? '✓' : '✗', st.hit ? 'good' : 'bad', 13, 'middle'));
          }
        });
        items.push(H.text('fml', 70, 78, 'flushed', 'tick', 12, 'end'));
        items.push(H.text('aml', 70, 98, 'ASIDs', 'tick', 12, 'end'));
        const sf = k >= 0 ? Rf.steps[k] : null, sa = k >= 0 ? Ra.steps[k] : null;
        const lab = (e) => (e.asid === 1 ? 'A' : 'B') + ':' + e.vpn;
        const g1 = tlbGrid('f', 20, 160, 1, entries, k >= 0 ? Rf.steps[k].tlb : [[]], { title: 'TLB flushed at every switch', set: sf && sf.kind === 'ref' ? 0 : -1, way: sf ? sf.way : -1, hit: sf && sf.hit, label: lab, asidCls: pcls });
        const g2 = tlbGrid('a', 20, 280, 1, entries, k >= 0 ? Ra.steps[k].tlb : [[]], { title: 'TLB with address-space ids', set: sa && sa.kind === 'ref' ? 0 : -1, way: sa ? sa.way : -1, hit: sa && sa.hit, label: lab, asidCls: pcls });
        items.push(...g1.items, ...g2.items);
        const upto = (R) => R.steps.slice(0, k + 1).filter((s) => s.kind === 'ref');
        const hf = upto(Rf).filter((s) => s.hit).length, ha = upto(Ra).filter((s) => s.hit).length, nr = upto(Ra).length;
        items.push(H.text('cf', 20, 400, 'flushed: ' + H.plural(hf, 'hit') + ' of ' + nr, 'p10-sum', 14));
        items.push(H.text('ca', 20, 428, 'with ASIDs: ' + H.plural(ha, 'hit') + ' of ' + nr, 'p10-sum good', 14));
        return items;
      };
      F.add({ items: draw(-1), say: `Process A (address space 1) and process B (address space 2) take turns of ${H.plural(inp.quantum, 'reference')} on ${H.an(entries + '-entry')} TLB. Both use page numbers that clash: page 1 of A is not page 1 of B.`, meta: { phase: 'start', q: inp.quantum, entries, asids: [1, 2] }, view, hl: { d: [0] } });
      Ra.steps.forEach((st, k) => {
        const f = Rf.steps[k];
        if (st.kind === 'switch') {
          F.add({ items: draw(k), say: `A switch to ${st.to === 1 ? 'A' : 'B'}. The first TLB is flushed: every entry is gone. The second keeps its entries, each tagged with its address space.`, meta: { phase: 'switch', to: st.to }, view, hl: { d: [1, 2] } });
          return;
        }
        if (f.hit) F.count('fh'); if (st.hit) F.count('ah');
        const who = st.asid === 1 ? 'A' : 'B';
        F.add({ items: draw(k), say: `${who} touches page ${st.vpn}: ` + (f.hit === st.hit ? (st.hit ? 'both TLBs hit.' : 'both TLBs miss.') : f.hit ? 'the flushed TLB hits and the tagged one misses.' : `a miss in the flushed TLB, which lost it at the switch, but a hit with ASIDs.`), meta: { phase: 'ref', proc: who, vpn: st.vpn, hitF: f.hit, hitA: st.hit }, view, hl: { d: [st.hit ? 3 : 1] } });
      });
      F.add({ items: draw(n - 1), say: `Flushed: ${H.plural(Rf.hits, 'hit')} and ${H.plural(Rf.misses, 'miss', 'misses')}, a hit ratio of ${H.f(Rf.hitRatio, 3)}. With ASIDs: ${H.plural(Ra.hits, 'hit')} and ${H.plural(Ra.misses, 'miss', 'misses')}, ${H.f(Ra.hitRatio, 3)}. Tags let a process come back to a warm TLB; the price is a few bits per entry and the check on every lookup.`, meta: { phase: 'end', fh: Rf.hits, fm: Rf.misses, fr: Rf.hitRatio, ah: Ra.hits, am: Ra.misses, ar: Ra.hitRatio }, view, hl: { d: [3] } });
      return { frames: F.list, def: H.def('On a switch', ['entries are (ASID, page) → frame', 'flush: empty the TLB at every switch', 'ASID: keep entries, match the current ASID', 'a hit needs page and ASID to match']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'switch' && fr[i + 1].meta.phase === 'ref', once: true, pick: 'option', ask: (fr, i) => `After the switch, ${fr[i + 1].meta.proc} touches page ${fr[i + 1].meta.vpn}. What happens in the two TLBs?`, options: ['both hit', 'both miss', 'flushed misses, ASIDs hit', 'flushed hits, ASIDs miss'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.hitF && m.hitA ? 'both hit' : !m.hitF && !m.hitA ? 'both miss' : m.hitA ? 'flushed misses, ASIDs hit' : 'flushed hits, ASIDs miss'; }, explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1].meta.phase === 'end', pick: 'option', ask: 'Which TLB will end with more hits?', options: ['the flushed one', 'the one with ASIDs', 'the same'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.ah > m.fh ? 'the one with ASIDs' : m.ah < m.fh ? 'the flushed one' : 'the same'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Without ASIDs, why must the TLB be flushed on a switch?', options: ['the next process would use the old process\'s translations', 'to save power', 'to make room for the kernel', 'it need not be'], answer: 0, why: 'Page 1 of B would hit on A\'s entry for page 1 and reach A\'s memory.' },
      { q: 'With ASIDs, a TLB lookup hits when…', options: ['the page and the current ASID both match', 'only the page matches', 'only the ASID matches', 'the set is full'], answer: 0, why: 'The tag keeps the address spaces apart.' },
      { q: 'Longer time slices make flushing…', options: ['less costly per reference', 'more costly', 'impossible', 'unnecessary'], answer: 0, why: 'The cold misses after a switch are spread over more references.' },
      { q: 'Kernel pages mapped in every process can be marked…', options: ['global, so they survive a flush', 'invalid', 'dirty', 'read-only'], answer: 0, why: 'A global entry matches any ASID and is not flushed.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
