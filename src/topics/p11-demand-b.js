// Part 11, demand paging continued: the effective access time against the fault rate (a log-log curve, the slowdown
// and the fault budget), and a reference string run under demand paging with every fault priced by its own path.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, M = () => S.Mem, C = () => S.Kit.curve, KM = () => S.Kit.mem;
  const us = (v) => H.us(v);
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const pow10 = (k) => '10' + String(k).split('').map((c) => SUP[c]).join('');
  /** a count with thousands separated by spaces kept out: plain digits */
  const n0 = (v) => String(Math.round(v));

  S.topic({
    id: 'vmem-demand-eat', family: 'p11-demand', order: 20, title: 'The fault rate and the access time',
    blurb: 'With demand paging an access costs a memory access when the page is resident and a whole fault when it is not. With fault rate p the effective access time is (1 − p) × memory + p × fault. A fault takes milliseconds and memory a tenth of a microsecond, so even one fault in a hundred thousand accesses doubles the average. Turn it round: to stay within a slowdown you choose, how rare must faults be?',
    inputs: [
      { id: 'memNs', kind: 'number', label: 'Memory access (ns)', def: 100, min: 10, max: 1000 },
      { id: 'faultMs', kind: 'number', label: 'Fault service (ms)', def: 8, min: 0.01, max: 50, integer: false },
      { id: 'every', kind: 'number', label: 'One fault every … accesses', def: 100000, min: 10, max: 1000000000 },
      { id: 'slow', kind: 'number', label: 'Slowdown allowed (%)', def: 10, min: 1, max: 400 },
    ],
    presets: [
      { label: 'A disk, one fault in 100000', values: {} },
      { label: 'A disk, one fault in 1000', values: { every: 1000 } },
      { label: 'An SSD (0.1 ms), one in 100000', values: { faultMs: 0.1 } },
      { label: 'Fast memory (50 ns), a 5% budget', values: { memNs: 50, slow: 5, every: 10000000 } },
      { label: 'Fault-heavy: one in 50', values: { every: 50, slow: 100 } },
    ],
    counters: [{ id: 'eat', label: 'EAT (µs)' }],
    run(inp) {
      const mem = inp.memNs / 1000, fault = inp.faultMs * 1000, p = 1 / inp.every;
      const E = (q) => V().eat({ mem, fault, p: q }).us;
      const F = new S.Frames(['eat']), view = H.box(0, 0, 800, 480);
      const yLo = Math.floor(Math.log10(mem)) - 1, yHi = Math.max(yLo + 2, Math.ceil(Math.log10(E(0.1))));
      const ax = C().axes({ prefix: 'ax', x: 74, y: 40, w: 440, h: 360, xr: [-9, -1], yr: [yLo, yHi], xticks: [-9, -7, -5, -3, -1], yticks: Array.from({ length: yHi - yLo + 1 }, (_, k) => yLo + k), fmtX: (v) => pow10(v), fmtY: (v) => us(10 ** v), xname: 'fault rate p (log scale)', yname: 'effective access time (log scale)', tickSize: 12 });
      const pts = []; for (let k = 0; k <= 160; k++) { const lx = -9 + (8 * k) / 160; pts.push([lx, Math.log10(E(10 ** lx))]); }
      const curve = C().line(ax, 'eat', pts, 'c0');
      const lp = Math.log10(p), e = E(p), ratio = e / mem;
      const pmax = V().maxFaultRate({ mem, fault, slowdown: inp.slow / 100 }), every = 1 / pmax;
      const side = (lines) => lines.map((l, i) => H.text('sd' + i, 548, 70 + i * 26, l[0], l[1] || 'strong', 14));
      const base = [...ax.items, C().hline(ax, 'memline', Math.log10(mem), ''), H.text('ml', ax.X(-9) + 8, ax.Y(Math.log10(mem)) + 18, 'memory alone: ' + us(mem), 'tick', 12, 'start')];
      F.set('eat', +mem.toFixed(4));
      F.add({ items: [...base, ...side([['EAT = (1 − p) × m + p × f', 'mono'], ['m = ' + us(mem) + ' (a memory access)'], ['f = ' + us(fault) + ' (a fault)'], ['f / m = ' + n0(fault / mem), 'act']])], say: `A memory access takes ${us(mem)} and a fault ${us(fault)}, ${n0(fault / mem)} times longer. With no faults the access time is just ${us(mem)}, the flat line.`, meta: { phase: 'formula', mem, memNs: inp.memNs, fault, faultMs: inp.faultMs, ratio: Math.round(fault / mem) }, view, hl: { d: [0] } });
      const e9 = E(1e-9), e1 = E(0.1);
      F.add({ items: [...base, curve, ...side([['EAT = (1 − p) × m + p × f', 'mono'], ['p = ' + pow10(-9) + ': ' + us(e9)], ['p = ' + pow10(-1) + ': ' + us(e1)]])], say: `As p grows the fault term takes over: at one fault in a billion the access time is ${us(e9)}, at one in ten it is ${us(e1)}. Past the bend the curve is a straight line on these log scales, the fault cost times p.`, meta: { phase: 'curve', e9, e1, e9ms: e9 / 1000, e1ms: e1 / 1000 }, view, hl: { d: [0, 1] } });
      F.set('eat', +e.toFixed(4));
      const you = [C().vline(ax, 'pv', lp, 'act'), C().dot(ax, 'pd', lp, Math.log10(e), 'act', 6)];
      F.add({ items: [...base, curve, ...you, ...side([['one fault in ' + n0(inp.every), 'act'], ['EAT = ' + us(e)], ['= ' + H.f(ratio, 1) + ' × a memory access', ratio > 2 ? 'bad' : 'good']])], say: `One fault every ${n0(inp.every)} accesses: EAT = (1 − p) × ${us(mem)} + p × ${us(fault)} = ${us(e)}, or ${H.f(ratio, 1)}× a memory access.`, meta: { phase: 'yours', every: inp.every, eat: e, eatms: e / 1000, slowdown: ratio, mem, fault, faultMs: inp.faultMs }, view, hl: { d: [1] } });
      const yb = Math.log10(mem * (1 + inp.slow / 100));
      const budget = [C().vline(ax, 'bv', Math.log10(pmax), 'good'), C().hline(ax, 'bh', yb, 'act'), C().dot(ax, 'bd', Math.log10(pmax), yb, 'good', 6)].filter((it) => it.key !== 'ax:bd' && it.key !== 'bd' || Math.hypot(ax.X(Math.log10(pmax)) - ax.X(lp), ax.Y(yb) - ax.Y(Math.log10(e))) > 14);
      const ok = p <= pmax;
      F.add({ items: [...base, curve, ...you, ...budget, ...side([['allowed: +' + inp.slow + '%', 'act'], ['EAT ≤ ' + us(mem * (1 + inp.slow / 100))], ['p ≤ ' + H.f(pmax * 1e6, 4) + ' in a million'], ['one fault in ' + n0(every) + ' or fewer', 'good'], [ok ? 'yours is within it' : 'yours is ' + H.f(p / pmax, 1) + ' times too many', ok ? 'good' : 'bad']])], say: `To stay within ${inp.slow}% of a memory access, p must satisfy p × (${us(fault)} − ${us(mem)}) ≤ ${inp.slow}% of ${us(mem)}: at most one fault in ${n0(every)} accesses. ` + (ok ? 'Your rate is within that.' : `Your rate is ${H.f(p / pmax, 1)} times too high.`), meta: { phase: 'budget', pmax, every: Math.round(every), slow: inp.slow, over: p / pmax, mem, fault, faultMs: inp.faultMs, cap: mem * (1 + inp.slow / 100) }, view, hl: { d: [2] } });
      const rows = [3, 4, 5, 6, 7].map((k) => [k, E(10 ** -k)]);
      F.add({ items: [...base, curve, ...rows.map(([k, v]) => C().dot(ax, 'r' + k, -k, Math.log10(v), '', 4.5)), ...side([['one fault in …', 'title'], ...rows.map(([k, v]) => [n0(10 ** k) + ': ' + us(v) + ', ×' + H.f(v / mem, 1), v / mem > 1 + inp.slow / 100 ? 'bad' : 'good'])])], say: `The same machine at five rates: ${H.list(rows.map(([k, v]) => 'one in ' + n0(10 ** k) + ' gives ' + us(v)))}. Each tenfold drop in the fault rate cuts the extra time tenfold.`, meta: { phase: 'table', rows: rows.map(([k, v]) => [10 ** k, v, v / mem]) }, view, hl: { d: [0] } });
      return { frames: F.list, def: H.def('Effective access time', ['EAT = (1 − p) × m + p × f', 'slowdown = EAT / m', 'within a slowdown s: p ≤ s × m / (f − m)']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'curve', pick: 'option', ask: 'At your fault rate, is the effective access time more than double a memory access?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.slowdown > 2 ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'yours', pick: 'option', ask: 'Is your fault rate within the slowdown allowed?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.over <= 1 ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Memory 0.1 µs, a fault 10 ms, p = 0.001. Roughly what is the EAT?', options: ['10 µs', '0.1 µs', '1 µs', '10 ms'], answer: 0, why: '0.999 × 0.1 + 0.001 × 10000 ≈ 10.1 µs: a hundred times slower.' },
      { q: 'Which change helps the EAT most when faults are frequent?', options: ['fewer faults', 'faster memory', 'a faster CPU', 'larger registers'], answer: 0, why: 'The fault term dominates; memory speed hardly shows.' },
      { q: 'Faults move from a disk (8 ms) to an SSD (0.1 ms). The fault rate allowed for the same slowdown…', options: ['grows about 80 times', 'stays the same', 'shrinks', 'doubles'], answer: 0, why: 'p ≤ s × m / (f − m): the allowance is inversely proportional to the fault time.' },
      { q: 'Why does a slowdown of 10% need such a tiny fault rate?', options: ['one fault costs as much as tens of thousands of accesses', 'faults are counted twice', 'the TLB is flushed on each fault', 'the CPU stops for a second'], answer: 0, why: 'The ratio f / m is enormous, so p must be tiny for p × f to stay below 0.1 × m.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // A reference string under demand paging
  // ---------------------------------------------------------------------------------------------------------------
  const parseRefs = (xs) => xs.map((x) => { const m = /^(\d+)(w?)$/.exec(x); if (!m) throw new Error('reference "' + x + '": a page number, with w after it for a write'); return { page: +m[1], write: !!m[2] }; });
  const POLS = () => M().policies.map((value) => ({ value, label: M().policyName(value) }));
  const SRC = { zero: 'zero', swap: 'swap', file: 'file' };
  S.topic({
    id: 'vmem-demand-run', family: 'p11-demand', order: 30, title: 'Demand paging a reference string',
    blurb: 'A process starts with nothing in memory and faults its pages in as it touches them. Each fault is priced by its own path: a code or file page is read from its file, a new anonymous page (heap or stack) is filled with zeros at almost no cost, and when memory is full a dirty victim must be written to swap first, after which reading it back is a disk read too. Writes are marked w.',
    inputs: [
      { id: 'refs', kind: 'list', label: 'References (w = a write)', def: ['0', '4w', '5w', '0', '1', '4', '6w', '0', '2', '4w', '5', '1', '0', '6'], min: 1, max: 20, check: (v) => { try { parseRefs(v); return null; } catch (e) { return e.message; } } },
      { id: 'frames', kind: 'number', label: 'Frames', def: 3, min: 1, max: 6 },
      { id: 'policy', kind: 'choice', label: 'Replacement', def: 'lru', options: POLS() },
      { id: 'anon', kind: 'list', label: 'Anonymous pages (heap, stack)', def: ['4', '5', '6'], max: 10, check: (v) => (v.some((x) => !/^\d+$/.test(x)) ? 'Anonymous pages: page numbers' : null) },
      { id: 'diskMs', kind: 'number', label: 'Disk transfer (ms)', def: 8, min: 0.05, max: 20, integer: false },
    ],
    presets: [
      { label: 'Code and heap, three frames', values: {} },
      { label: 'Plenty of frames: only first touches fault', values: { frames: 6 } },
      { label: 'Two frames: write-backs pile up', values: { frames: 2 } },
      { label: 'All anonymous: zero-fill everywhere', values: { anon: ['0', '1', '2', '3', '4', '5', '6'], refs: ['0w', '1w', '2w', '3w', '0', '1', '2', '3'], frames: 4 } },
      { label: 'A file read in a loop, FIFO', values: { refs: ['1', '2', '3', '4', '1', '2', '3', '4', '1', '2', '3', '4'], anon: [], frames: 3, policy: 'fifo' } },
    ],
    counters: [{ id: 'faults', label: 'faults' }, { id: 'wb', label: 'write-backs' }, { id: 'ms', label: 'ms so far' }],
    run(inp) {
      const refs = parseRefs(inp.refs), anon = inp.anon.map(Number), costs = { read: inp.diskMs * 1000, writeBack: inp.diskMs * 1000 };
      const D = V().demand({ refs, frames: inp.frames, policy: inp.policy, anon, costs });
      const n = refs.length, nf = inp.frames, F = new S.Frames(['faults', 'wb', 'ms']), view = H.box(0, 0, 800, 470);
      const cw = Math.min(48, Math.floor(740 / n)), ch = nf > 4 ? 28 : 34, gx = 40, gy = 48;
      const label = refs.map((r) => r.page + (r.write ? 'w' : ''));
      const kindOf = (st) => (st.kind === 'hit' ? 'hit' : st.path.some((x) => x.kind === 'writeBack') ? 'wr' : st.path.some((x) => x.kind === 'zero') ? 'zero' : 'read');
      const MARK = { hit: '', zero: 'z', read: 'r', wr: 'w+r' };
      const gridH = (nf + 2) * ch + 14;
      const by = gy + gridH + 30, bh = 110, top = Math.log10(2 * inp.diskMs * 1000 / 0.1 + 20);
      const draw = (upto) => {
        const items = [...KM().grid({ prefix: 'rg', x: 0, y: gy, cw, ch, labelW: gx, refs: label, nFrames: nf, steps: D.run.steps, upto, cur: upto, size: 13 }).items];
        // the source of each fault, and the time of each reference as a bar (log scale)
        items.push(H.text('srcl', gx - 8, by - 6, 'from', 'tick', 12, 'end'));
        items.push(H.text('tl', gx - 8, by + bh, 'time', 'tick', 12, 'end'));
        items.push({ key: 'base', kind: 'line', x1: gx, y1: by + bh, x2: gx + n * cw, y2: by + bh, cls: 'faint', audit: 'ignore' });
        for (let j = 0; j <= upto; j++) {
          const st = D.steps[j], k = kindOf(st);
          if (MARK[k]) items.push(H.text('src' + j, gx + j * cw + cw / 2, by - 6, MARK[k], 'p11-mark ' + (k === 'zero' ? 'good' : 'bad'), 12, 'middle'));
          const h = Math.max(3, Math.round((Math.log10(st.us / 0.1) + 1) / (top + 1) * bh));
          items.push(H.cell('bar' + j, gx + j * cw + 5, by + bh - h, cw - 10, h, '', 'p11-bar ' + (k === 'hit' ? 'soft' : k === 'zero' ? 'cpu' : 'disk') + (j === upto ? ' act' : '')));
        }
        items.push(H.text('logn', gx + n * cw, by + bh + 20, 'bar heights on a log scale: a hit is ' + us(0.1) + ', a disk read ' + us(inp.diskMs * 1000), 'tick', 12, 'end'));
        const t = upto >= 0 ? D.steps.slice(0, upto + 1).reduce((a, s) => a + s.us, 0) : 0;
        items.push(H.text('sum', 0, 22, upto < 0 ? n + ' references, ' + nf + ' frames, ' + M().policyName(inp.policy) : 'time so far ' + us(t), 'p10-sum', 15));
        items.push(H.text('leg', 800, 22, 'z zero-fill · r read · w+r write-back, then read', 'tick', 12, 'end'));
        return { items, t };
      };
      F.add({ items: draw(-1).items, say: `The process starts with nothing resident and ${nf} free ${nf === 1 ? 'frame' : 'frames'}. Pages ${anon.length ? H.list(anon) : 'none'} ${anon.length === 1 ? 'is' : 'are'} anonymous (zero-filled when first touched); the rest come from their file. ${M().policyName(inp.policy)} picks the victims.`, meta: { phase: 'start', anon, frames: nf }, view, hl: { d: [0] } });
      let wb = 0;
      D.steps.forEach((st, j) => {
        const k = kindOf(st);
        if (st.kind === 'fault') F.count('faults');
        if (k === 'wr') { wb++; F.count('wb'); }
        const d = draw(j);
        F.set('ms', +(d.t / 1000).toFixed(3));
        const rp = st.rep;
        const say = st.kind === 'hit' ? `Reference ${j + 1}: page ${st.page} is in frame ${rp.slot}, a hit, ${us(st.us)}.`
          : `Reference ${j + 1}, page ${st.page}: a fault` + (rp.free ? ` into free frame ${rp.slot}` : `; ${M().policyName(inp.policy)} evicts ${rp.writeBack ? 'dirty' : 'clean'} page ${rp.victim} (${rp.reason})${rp.writeBack ? ', which is written to swap first' : ''}`) + (k === 'zero' ? `; the page is anonymous and new, so its frame is filled with zeros` : `; the page is read from ${anon.includes(st.page) ? 'swap, where it was written out' : 'its file'}`) + `: ${us(st.us)} in all.`;
        F.add({ items: d.items, say, meta: { phase: st.kind, i: j, n: j + 1, reasonN: (rp.reason.match(/\d+/g) || []).map(Number), page: st.page, slot: rp.slot, victim: rp.victim, us: st.us, ms: st.us / 1000, kind: k, t: d.t, tms: d.t / 1000, reason: rp.reason }, view, hl: { d: k === 'hit' ? [0] : k === 'zero' ? [2] : k === 'wr' ? [3] : [1] } });
      });
      const last = draw(n - 1);
      F.add({ items: last.items, say: `${H.plural(D.faults, 'fault')} in ${n} references, with ${H.plural(D.writeBacks, 'dirty page')} written back: ${us(D.total)} in all, an effective access time of ${us(D.eat)}, against ${us(0.1)} with every page resident. Almost all of it is spent on the disk.`, meta: { phase: 'end', faults: D.faults, wb: D.writeBacks, total: D.total, tms: D.total / 1000, eat: D.eat, eatms: D.eat / 1000, n, mem: 0.1 }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('What a reference costs', ['hit: one memory access (0.1 µs)', 'fault, file page: a disk read', 'fault, new anonymous page: zero-fill', 'fault, dirty victim: write-back, then the read', 'EAT = total time / references']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'fault' && f.meta.phase !== 'start', pick: 'option', ask: (fr, i) => `Reference ${fr[i + 1].meta.i + 1} (page ${fr[i + 1].meta.page}) faults. What will its path need?`, options: ['a zero-fill only', 'one disk read', 'a write-back and a read'], answer: (fr, i) => ({ zero: 'a zero-fill only', read: 'one disk read', wr: 'a write-back and a read' }[fr[i + 1].meta.kind]), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why is the first touch of a new heap page cheap?', options: ['the frame is filled with zeros: nothing is read', 'heap pages live in the TLB', 'it is copied from the parent', 'heap pages never fault'], answer: 0, why: 'Zero-fill on demand costs microseconds, not a disk transfer.' },
      { q: 'A dirty anonymous page is evicted and later touched again. Where does it come from?', options: ['swap, where it was written', 'zeros again', 'its file', 'the TLB'], answer: 0, why: 'Its contents were saved to swap on eviction and must be read back.' },
      { q: 'Which victim costs least to evict?', options: ['a clean page', 'a dirty page', 'the most recently used page', 'a page of the stack'], answer: 0, why: 'A clean page can be dropped; its copy on disk is still good.' },
      { q: 'With more frames, which faults remain no matter what?', options: ['the first touch of each page', 'none', 'only the writes', 'every other reference'], answer: 0, why: 'Compulsory faults: a page that was never resident must fault once.' },
    ],
  });
  void SRC;
})(globalThis.Proses = globalThis.Proses || {});
