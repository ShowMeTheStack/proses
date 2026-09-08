// Part 10, the effective access time a TLB buys: the cost of a hit and of a miss, their average weighted by the hit
// ratio drawn as a curve, a page-walk cache that shortens the misses, and the TLB reach for small and large pages.
// Engines: S.Mem.eat, S.Mem.eatWalk, S.Mem.tlbReach (src/core/mem-c-tlb.js).
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const PAGES = [4096, 2 ** 21, 2 ** 30];

  S.topic({
    id: 'mem-eat', family: 'p10-tlb', order: 30, title: 'Effective access time and TLB reach',
    blurb: 'With a TLB, a memory reference costs one of two things: a hit (the TLB, then the data) or a miss (the TLB, a read for every level of the page table, then the data). The effective access time is their average weighted by the hit ratio h: EAT = h × hit + (1 − h) × miss. A miss is so much dearer that the hit ratio must be very close to 1. A page-walk cache that keeps the upper levels cuts the cost of a miss, and larger pages let the same TLB entries cover more memory: the TLB reach.',
    inputs: [
      { id: 'hit', kind: 'slider', label: 'Hit ratio h', def: 0.98, min: 0.5, max: 1, step: 0.005, fmt: (v) => (+v).toFixed(3) },
      { id: 'tlbNs', kind: 'number', label: 'TLB time (ns)', def: 1, min: 0, max: 20 },
      { id: 'memNs', kind: 'number', label: 'Memory time (ns)', def: 100, min: 10, max: 500 },
      { id: 'levels', kind: 'number', label: 'Table levels', def: 4, min: 1, max: 5 },
      { id: 'pwc', kind: 'slider', label: 'Walk-cache hit ratio', def: 0.8, min: 0, max: 1, step: 0.05, fmt: (v) => (+v).toFixed(2) },
      { id: 'entries', kind: 'number', label: 'TLB entries', def: 64, min: 8, max: 4096 },
      { id: 'ws', kind: 'number', label: 'Working set (MiB)', def: 64, min: 1, max: 65536 },
    ],
    presets: [
      { label: 'Four levels, h = 0.98', values: {} },
      { label: 'A poor hit ratio: 0.8', values: { hit: 0.8 } },
      { label: 'Two levels, slow memory', values: { levels: 2, memNs: 200, hit: 0.95 } },
      { label: 'Five levels, no walk cache', values: { levels: 5, pwc: 0, hit: 0.99 } },
      { label: 'A big working set, a big TLB', values: { entries: 1536, ws: 4096, hit: 0.995 } },
    ],
    counters: [{ id: 'eat', label: 'EAT (ns)' }],
    run(inp) {
      const h = +inp.hit, t = inp.tlbNs, m = inp.memNs, L = inp.levels, p = +inp.pwc;
      const hitNs = t + m, missNs = t + (L + 1) * m;
      const eat = M().eat({ hit: h, tlbNs: t, memNs: m, levels: L });
      const w = M().eatWalk({ hit: h, tlbNs: t, memNs: m, levels: L, pwcHit: p, pwcNs: 0 });
      // the hit ratio that keeps the average within 10% of one memory access, found on a fine grid of the engine's EAT
      let need = null;
      for (let k = 0; k <= 2000; k++) { const x = 0.5 + k / 4000; if (M().eat({ hit: x, tlbNs: t, memNs: m, levels: L }) <= 1.1 * m + 1e-9) { need = x; break; } }
      const reach = PAGES.map((pb) => M().tlbReach(inp.entries, pb)), wsB = inp.ws * 2 ** 20;
      const F = new S.Frames(['eat']), view = H.box(0, 0, 790, 480);
      const curve = (k) => {
        const ax = S.Kit.curve.axes({ prefix: 'ax', x: 470, y: 40, w: 290, h: 220, xr: [0.5, 1], yr: [0, Math.ceil(missNs / 100) * 100], xticks: [0.5, 0.75, 1], yticks: S.Kit.curve.ticks(0, Math.ceil(missNs / 100) * 100, 4), xname: 'hit ratio h', yname: 'EAT (ns)', tickSize: 12 });
        const pts = [], pts2 = [];
        for (let j = 0; j <= 50; j++) { const x = 0.5 + j / 100; pts.push([x, M().eat({ hit: x, tlbNs: t, memNs: m, levels: L })]); pts2.push([x, M().eatWalk({ hit: x, tlbNs: t, memNs: m, levels: L, pwcHit: p }).ns]); }
        const it = [...ax.items, S.Kit.curve.line(ax, 'c1', pts, 'c0')];
        if (k >= 4) it.push(S.Kit.curve.line(ax, 'c2', pts2, 'c1'));
        if (k >= 2 && (k < 4 || Math.abs(ax.Y(eat) - ax.Y(w.ns)) > 12)) it.push(S.Kit.curve.dot(ax, 'd1', h, eat, 'act', 5));
        if (k >= 4) it.push(S.Kit.curve.dot(ax, 'd2', h, w.ns, 'act', 5));
        if (k >= 3 && need !== null) it.push(S.Kit.curve.vline(ax, 'need', need, 'act'));
        it.push(...S.Kit.curve.legend('lg', 470, 314, [{ text: 'no walk cache', cls: 'c0' }].concat(k >= 4 ? [{ text: 'walk cache ' + H.f(p, 2), cls: 'c1' }] : [])));
        return it;
      };
      const path = (k) => {
        const it = [H.text('ph', 10, 22, 'a hit', 'title')];
        const box = (key, x, y, lines, cls) => it.push(H.cellL(key, x, y, 54, 46, lines, 'p10-box ' + (cls || ''), 13));
        box('h0', 10, 34, ['TLB', t + ' ns'], k === 0 ? 'good' : '');
        box('h1', 82, 34, ['data', m + ' ns'], k === 0 ? 'good' : '');
        it.push(H.wire('hw', [[64, 57], [82, 57]], k === 0 ? 'act' : ''));
        it.push(H.text('hs', 156, 63, '= ' + hitNs + ' ns', 'p10-sum good', 15));
        it.push(H.text('mh', 10, 118, 'a miss', 'title'));
        box('m0', 10, 130, ['TLB', t + ' ns'], k === 1 ? 'bad' : '');
        for (let l = 0; l < L; l++) {
          const x = 74 + l * 57;
          box('m' + (l + 1), x, 130, ['L' + (l + 1), (k >= 4 && l < L - 1 ? 'cached' : m + ' ns')], k === 1 ? 'act' : k >= 4 && l < L - 1 ? 'ghost' : '');
        }
        box('md', 74 + L * 57, 130, ['data', m + ' ns'], k === 1 ? 'bad' : '');
        it.push(H.text('ms', 10, 206, 'miss = ' + t + ' + ' + L + ' × ' + m + ' + ' + m + ' = ' + missNs + ' ns', 'p10-sum bad', 15));
        return it;
      };
      const lines = (k) => {
        const out = [];
        if (k >= 2) out.push(['EAT = ' + H.f(h, 3) + ' × ' + hitNs + ' + ' + H.f(1 - h, 3) + ' × ' + missNs, 'p10-sum'], ['    = ' + H.f(eat, 2) + ' ns', 'p10-sum act']);
        if (k >= 3) out.push([need === null ? 'no h ≥ 0.5 keeps EAT within 10%' : 'h ≥ ' + H.f(need, 4) + ' keeps EAT within 10% of ' + m + ' ns', 'strong']);
        if (k >= 4) out.push(['walk cache ' + H.f(p, 2) + ': EAT = ' + H.f(w.ns, 2) + ' ns', 'good']);
        return out.map((l, j) => H.text('ln' + j, 10, 252 + j * 28, l[0], l[1], 14));
      };
      const reachBars = () => {
        const it = [H.text('rt', 470, 352, 'TLB reach: ' + inp.entries + ' entries × page', 'title')], mx = Math.log2(Math.max(...reach, wsB));
        PAGES.forEach((pb, j) => {
          const y = 364 + j * 34, ww = Math.max(4, Math.round((Math.log2(reach[j]) / mx) * 180));
          it.push(H.text('rl' + j, 540, y + 18, M().bytes(pb), 'tick', 12, 'end'));
          it.push(H.cell('rb' + j, 550, y + 4, ww, 20, '', 'p10-run ' + (reach[j] >= wsB ? 'p2' : 'p1'), 12, { rx: 2 }));
          it.push(H.text('rv' + j, 556 + ww, y + 19, M().bytes(reach[j]), reach[j] >= wsB ? 'good' : 'tick', 12));
        });
        return it;
      };
      const say = [
        `A hit costs the TLB, ${t} ns, and the data, ${m} ns: ${hitNs} ns.`,
        `A miss costs the TLB, then ${H.plural(L, 'read')} of the tables at ${m} ns each, then the data: ${t} + ${L} × ${m} + ${m} = ${missNs} ns, ${H.f(missNs / hitNs, 2)} times a hit.`,
        `Weighted by the hit ratio: EAT = ${H.f(h, 3)} × ${hitNs} + ${H.f(1 - h, 3)} × ${missNs} = ${H.f(eat, 2)} ns, ${H.pct(eat / m - 1)} slower than memory alone.`,
        need === null ? `Even a perfect TLB cannot keep this within 10% of ${m} ns.` : `To stay within 10% of a bare memory access (${H.f(1.1 * m, 1)} ns) the hit ratio must be at least ${H.f(need, 4)}: misses must be rarer than ${H.pct(1 - need, 2)}.`,
        `A page-walk cache that hits ${H.pct(p, 0)} of the time leaves only the last level to read on those misses, so a miss now costs ${H.f(w.missNs, 2)} ns on average instead of ${missNs}. ` + w.say,
        `The TLB reach is entries × page size: ${inp.entries} entries cover ${M().bytes(reach[0])} with 4 KiB pages, ${M().bytes(reach[1])} with 2 MiB pages and ${M().bytes(reach[2])} with 1 GiB pages. Against a working set of ${M().bytes(wsB)}, ` + (reach[0] >= wsB ? 'even small pages reach it all.' : reach[1] >= wsB ? 'only the large pages cover it.' : 'only the huge pages cover it.') + ' Large pages are how big programs keep a high hit ratio.',
      ];
      const phases = ['hit', 'miss', 'eat', 'need', 'pwc', 'reach'];
      phases.forEach((ph, k) => {
        if (k === 2) F.set('eat', +eat.toFixed(2));
        F.add({ items: [...path(k), ...curve(k), ...lines(k), ...(k === 5 ? reachBars() : [])], say: say[k], meta: { phase: ph, ten: 0.1, h, t, m, L, hitNs, missNs, ratio: missNs / hitNs, eat, slow: eat / m - 1, need: need === null ? -1 : need, limit: 1.1 * m, miss: 1 - (need || 0), p, pwcEat: w.ns, pwcMiss: w.missNs, saved: p * (L - 1) * m, Lm1: L - 1, hitW: w.hitNs, reach, ws: wsB, entries: inp.entries, sz: reach.map((r) => M().bytes(r)).concat([M().bytes(wsB)], PAGES.map((b) => M().bytes(b))), oneMinus: 1 - h }, view, hl: { d: [[0], [1], [2], [2], [3], [4]][k] } });
      });
      return { frames: F.list, def: H.def('Effective access time', ['hit = TLB + memory', 'miss = TLB + levels × memory + memory', 'EAT = h × hit + (1 − h) × miss', 'walk cache: a hit leaves one level to read', 'reach = entries × page size']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'miss', pick: 'option', ask: 'At this hit ratio, roughly what will the effective access time be?', options: (fr, i) => { const m = fr[i].meta; return [...new Set([Math.round(m.eat), m.hitNs, m.missNs, Math.round((m.hitNs + m.missNs) / 2)])].sort((a, b) => a - b).map((v) => v + ' ns'); }, answer: (fr, i) => Math.round(fr[i].meta.eat) + ' ns', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'TLB 1 ns, memory 100 ns, two levels, h = 0.9. The EAT is…', options: ['0.9 × 101 + 0.1 × 301 = 121 ns', '101 ns', '301 ns', '201 ns'], answer: 0, why: 'A miss reads two tables and the data: 1 + 200 + 100 = 301.' },
      { q: 'Why must the hit ratio be so close to 1?', options: ['a miss costs several times a hit', 'misses are free', 'the TLB is slow', 'hits are rare'], answer: 0, why: 'With four levels a miss is about five accesses; even 2% misses add 8%.' },
      { q: '64 entries with 4 KiB pages reach…', options: ['256 KiB', '64 KiB', '4 MiB', '1 MiB'], answer: 0, why: '64 × 4 KiB.' },
      { q: 'The same 64 entries with 2 MiB pages reach…', options: ['128 MiB', '2 MiB', '64 MiB', '256 KiB'], answer: 0, why: '64 × 2 MiB.' },
      { q: 'A page-walk cache helps by…', options: ['skipping the upper levels on a TLB miss', 'making hits faster', 'storing data', 'flushing the TLB'], answer: 0, why: 'Neighbouring pages share their upper tables; caching those entries leaves one read.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
