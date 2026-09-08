// Part 10, contiguous allocation. Each process takes one run of memory. A script of requests (A=200 asks for 200 K,
// -A frees it, # compacts) runs under one placement policy; the memory is drawn to scale with its holes, the holes
// big enough for the next request outlined, and the fragmentation counted. The engine is S.Mem.contig.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const NAMES = { first: 'first fit', best: 'best fit', worst: 'worst fit', next: 'next fit' };
  const WHY = { first: 'the lowest hole big enough', best: 'the smallest hole big enough', worst: 'the largest hole', next: 'the first hole big enough after the last placement' };
  const C = (H.contig = {});
  C.NAMES = NAMES;
  C.policyOptions = Object.keys(NAMES).map((value) => ({ value, label: NAMES[value] }));

  /** the script's tokens: A=200 (allocate), -A (free), # (compact) */
  C.parse = function (list, compactOk) {
    const ops = [], live = new Set(), seen = new Set();
    for (const x of list) {
      let m;
      if ((m = /^([A-Za-z][A-Za-z0-9]{0,3})=(\d+)$/.exec(x))) {
        if (live.has(m[1])) throw new Error('Script: ' + m[1] + ' is allocated already; free it (-' + m[1] + ') before asking again');
        if (+m[2] < 1) throw new Error('Script: ' + m[1] + ' must ask for at least 1 K');
        ops.push({ op: 'alloc', id: m[1], size: +m[2] }); live.add(m[1]); seen.add(m[1]);
      } else if ((m = /^-([A-Za-z][A-Za-z0-9]{0,3})$/.exec(x))) {
        if (!live.has(m[1])) throw new Error('Script: -' + m[1] + ' frees ' + m[1] + ', which is not allocated at that point');
        ops.push({ op: 'free', id: m[1] }); live.delete(m[1]);
      } else if (x === '#' && compactOk) ops.push({ op: 'compact' });
      else throw new Error('Script: "' + x + '" is not a request (A=200), a free (-A)' + (compactOk ? ' or a compaction (#)' : ''));
    }
    return { ops, ids: [...seen] };
  };
  C.check = (compactOk) => (v) => { try { C.parse(v, compactOk); return null; } catch (e) { return e.message; } };

  /** the runs of a memory map: the kernel, the blocks and the holes */
  C.runs = function (st, osSize, colour, o) {
    o = o || {};
    const runs = [{ key: 'os', start: 0, size: osSize, cls: 'os', text: 'kernel', sub: osSize + ' K' }];
    for (const b of st.blocks) runs.push({ key: 'b' + b.id, start: b.start, size: b.size, cls: colour(b.id) + (o.act === b.id ? ' act' : o.hot === b.id ? ' hot' : ''), text: b.id, sub: b.size + ' K' });
    for (const h of st.holes) runs.push({ key: 'h' + h.start, start: h.start, size: h.size, cls: 'free' + (o.cand && o.cand.has(h.start) ? ' cand' : '') + (o.pick && o.pick === h.start ? ' act' : ''), text: h.size + ' K', pick: !!(o.cand && o.cand.has(h.start)) });
    return runs.sort((a, b) => a.start - b.start);
  };
  C.bar = function (prefix, x, y, w, h, memory, runs, ticks) {
    const b = S.Kit.p10.hbar({ prefix, x, y, w, h, total: memory, runs, ticks: ticks === false ? [] : [0, memory].concat(runs.map((r) => r.start)), minGap: 6 });
    // a hole that may be clicked (a prediction asks for one) says so
    for (const it of b.items) { const r = runs.find((q) => prefix + ':' + q.key === it.key); if (r && r.pick) it.pick = true; }
    return b;
  };
  /** the fragmentation of a state, as numbers and words */
  C.fragLine = (f) => (f.free ? f.free + ' K free in ' + H.plural(f.holes, 'hole') + ', the largest ' + f.largest + ' K' : 'no free memory');

  S.topic({
    id: 'mem-fits', family: 'p10-contig', order: 10, title: 'First, best, worst and next fit',
    blurb: 'With contiguous allocation each process gets one unbroken run of memory, cut from a hole. Which hole? First fit takes the lowest one big enough, next fit the first one after the last placement, best fit the smallest that fits, and worst fit the largest, hoping the leftover stays useful. Frees leave holes between the blocks; when a request finds no single hole big enough although the free memory adds up to more, that is external fragmentation.',
    inputs: [
      { id: 'policy', kind: 'choice', label: 'Policy', def: 'first', options: C.policyOptions },
      { id: 'memory', kind: 'number', label: 'Memory (K)', def: 1024, min: 256, max: 65536 },
      { id: 'os', kind: 'number', label: 'Kernel (K)', def: 128, min: 0, max: 8192 },
      { id: 'script', kind: 'list', label: 'Script (A=200 asks, -A frees)', def: ['A=200', 'B=150', 'C=260', 'D=100', '-B', '-D', 'E=90', 'F=120', 'G=180', 'H=60'], min: 1, max: 14, check: C.check(false) },
    ],
    check: (inp) => (inp.os >= inp.memory ? 'Kernel (K): less than the memory' : null),
    presets: [
      { label: 'First fit: two holes, then three requests', values: { policy: 'first' } },
      { label: 'Best fit on the same script', values: { policy: 'best' } },
      { label: 'Worst fit on the same script', values: { policy: 'worst' } },
      { label: 'Next fit wraps round', values: { policy: 'next', script: ['A=100', 'B=100', 'C=100', 'D=100', '-A', '-C', 'E=80', 'F=80', 'G=80'] } },
      { label: 'External fragmentation: 300 K free, no hole of 150', values: { policy: 'first', memory: 640, os: 64, script: ['A=96', 'B=96', 'C=96', 'D=96', 'E=96', 'F=96', '-B', '-D', '-F', 'G=150'] } },
      { label: 'A bigger machine, many small processes', values: { policy: 'best', memory: 4096, os: 512, script: ['P1=700', 'P2=300', 'P3=900', 'P4=250', '-P2', 'P5=280', '-P4', 'P6=200', '-P1', 'P7=640', 'P8=900'] } },
    ],
    counters: [{ id: 'placed', label: 'placed' }, { id: 'failed', label: 'refused' }, { id: 'holes', label: 'holes' }],
    run(inp) {
      const { ops, ids } = C.parse(inp.script, false), pol = inp.policy, name = NAMES[pol];
      const A = M().contig({ memory: inp.memory, osSize: inp.os, policy: pol });
      const colour = (id) => H.pc(ids.indexOf(id));
      const F = new S.Frames(['placed', 'failed', 'holes']), view = H.box(0, 0, 780, 470);
      let st = { blocks: A.blocks(), holes: A.holes(), frag: A.frag() };
      const draw = (state, o, cur, extra) => {
        const items = [H.text('ttl', 10, 22, name + ': ' + inp.memory + ' K of memory, the kernel in the first ' + inp.os + ' K', 'strong', 15)];
        items.push(...C.bar('mm', 20, 76, 740, 74, inp.memory, C.runs(state, inp.os, colour, o)).items);
        // the script, the current request lit
        items.push(H.text('sct', 20, 222, 'script', 'tick', 12));
        const cw = Math.min(62, Math.floor(740 / ops.length) - 4);
        ops.forEach((op, k) => items.push(H.cell('s' + k, 20 + k * (cw + 4), 232, cw, 30, op.op === 'alloc' ? op.id + '=' + op.size : '−' + op.id, 'mb-ord ' + (k === cur ? 'act' : k < cur ? '' : 'dim'), 13)));
        // the holes, address order
        items.push(H.text('hlt', 20, 300, 'holes (start: size in K)', 'tick', 12));
        state.holes.slice(0, 8).forEach((h, k) => items.push(H.cell('hl' + h.start, 20 + k * 92, 310, 88, 30, h.start + ': ' + h.size, 'mb-ord' + (o.cand && o.cand.has(h.start) ? ' act' : ''), 13)));
        if (state.holes.length > 8) items.push(H.text('hlmore', 760, 332, '+' + (state.holes.length - 8) + ' more', 'tick', 12, 'end'));
        if (!state.holes.length) items.push(H.text('hl0', 20, 330, 'none: memory is full', 'tick', 13));
        const f = state.frag;
        items.push(H.text('fr1', 20, 392, 'free ' + f.free + ' K in ' + H.plural(f.holes, 'hole') + ', largest hole ' + f.largest + ' K', 'strong', 14));
        items.push(H.text('fr2', 20, 420, 'external fragmentation = 1 − largest / free = ' + (f.free ? '1 − ' + f.largest + ' / ' + f.free + ' = ' + H.pct(f.external) : '0'), f.external > 0.3 ? 'p10-sum bad' : 'p10-sum', 14));
        if (extra) items.push(H.text('req', 760, 52, extra.text, extra.cls || 'act', 15, 'end'));
        return items;
      };
      const fm = (f) => ({ free: f.free, largest: f.largest, holes: f.holes, external: f.external });
      F.set('holes', st.frag.holes);
      F.add({ items: draw(st, {}, -1), say: `Memory is ${inp.memory} K and the kernel holds the first ${inp.os} K, so one hole of ${inp.memory - inp.os} K starts at ${inp.os}. ${H.plural(ops.length, 'request')} follow under ${name}: it takes ${WHY[pol]}.`, meta: Object.assign({ phase: 'start', hole: inp.memory - inp.os }, fm(st.frag)), view, hl: { d: [0] } });
      ops.forEach((op, k) => {
        if (op.op === 'free') {
          if (!st.blocks.some((b) => b.id === op.id)) { F.add({ items: draw(st, {}, k), say: `Process ${op.id} was never placed, so there is nothing to free.`, meta: Object.assign({ phase: 'skip', id: op.id }, fm(st.frag)), view }); return; }
          const s = A.free(op.id);
          F.set('holes', s.frag.holes);
          const merged = s.hole.size > s.size;
          F.add({ items: draw(s, { pick: s.hole.start }, k), say: `Process ${op.id} frees ${s.size} K at ${s.start}` + (merged ? `; it merges with the free space beside it into one hole of ${s.hole.size} K at ${s.hole.start}.` : ', a hole of its own between two blocks.') + ` Now ${C.fragLine(s.frag)}.`, meta: Object.assign({ phase: 'free', id: op.id, size: s.size, start: s.start, hole: [s.hole.start, s.hole.size] }, fm(s.frag)), view, hl: { d: [5] } });
          st = s;
          return;
        }
        const cands = st.holes.filter((h) => h.size >= op.size);
        const cset = new Set(cands.map((h) => h.start));
        const s = A.alloc(op.id, op.size);
        if (cands.length) {
          F.add({ items: draw(st, { cand: cset }, k, { text: op.id + ' asks for ' + op.size + ' K' }), say: `Process ${op.id} asks for ${op.size} K. ` + (cands.length === st.holes.length ? `Every hole is big enough (${H.list(cands.map((h) => h.size + ' K at ' + h.start))}).` : `${cands.length} of the ${H.plural(st.holes.length, 'hole')} ${cands.length === 1 ? 'is' : 'are'} big enough, outlined: ${H.list(cands.map((h) => h.size + ' K at ' + h.start))}.`), meta: Object.assign({ phase: 'search', id: op.id, size: op.size, cands: cands.map((h) => [h.start, h.size]), chosen: s.kind === 'alloc' ? s.hole.start : -1, nHoles: st.holes.length }, fm(st.frag)), view, hl: { d: [1, 2, 3, 4] } });
        }
        if (s.kind === 'fail') {
          F.count('failed');
          F.add({ items: draw(s, {}, k, { text: op.id + ': ' + op.size + ' K refused', cls: 'bad' }), say: `Process ${op.id} asks for ${op.size} K and no hole is that big: the largest is ${s.frag.largest} K` + (s.frag.free >= op.size ? `, though ${s.frag.free} K are free in ${H.plural(s.frag.holes, 'hole')}. The memory is there but in pieces: external fragmentation.` : `, and only ${s.frag.free} K are free in all.`) + ' The process must wait.', meta: Object.assign({ phase: 'fail', id: op.id, size: op.size }, fm(s.frag)), view, hl: { d: [6] } });
          st = s;
          return;
        }
        F.count('placed');
        F.set('holes', s.frag.holes);
        const left = s.hole.size - op.size;
        F.add({ items: draw(s, { act: op.id }, k, { text: op.id + ' at ' + s.start }), say: `${name} puts ${op.id} at ${s.start}, the bottom of ${WHY[pol]} (${s.hole.size} K at ${s.hole.start})` + (left ? `, leaving a hole of ${left} K at ${s.start + op.size}.` : ', which it fills exactly.') + ` Now ${C.fragLine(s.frag)}.`, meta: Object.assign({ phase: 'alloc', id: op.id, size: op.size, start: s.start, hole: [s.hole.start, s.hole.size], left, after: s.start + op.size }, fm(s.frag)), view, hl: { d: [1 + ['first', 'next', 'best', 'worst'].indexOf(pol)] } });
        st = s;
      });
      const f = st.frag, c = F.counts;
      F.add({ items: draw(st, {}, ops.length), say: `${name} placed ${c.placed} and refused ${c.failed}. ` + (f.free ? `${f.free} K are free in ${H.plural(f.holes, 'hole')}; the largest is ${f.largest} K, so external fragmentation is 1 − ${f.largest} / ${f.free} = ${H.pct(f.external)}.` : 'Memory is full.'), meta: Object.assign({ phase: 'end', placed: c.placed, failed: c.failed }, fm(f)), view, hl: { d: [6] } });
      return { frames: F.list, def: H.def('Placement', ['a request takes the bottom of one hole', 'first fit: the lowest hole big enough', 'next fit: the same, from the last placement on', 'best fit: the smallest hole big enough', 'worst fit: the largest hole', 'free: merge with the holes beside it', 'external = 1 − largest hole / free']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'search' && f.meta.chosen >= 0 && f.meta.cands.length > 1, pick: 'item', ask: (fr, i) => `Click the hole the policy gives ${fr[i].meta.id}.`, answer: (fr, i) => 'mm:h' + fr[i].meta.chosen, explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'search' && f.meta.chosen >= 0, once: true, pick: 'option', ask: (fr, i) => `After ${fr[i].meta.id} is placed, how many holes will there be?`, options: (fr, i) => { const n = fr[i + 1].meta.holes; return [...new Set([n, n + 1, Math.max(0, n - 1)])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.holes), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Holes of 50, 300 and 120 K in address order. A request for 100 K under best fit takes…', options: ['the 120 K hole', 'the 300 K hole', 'the 50 K hole', 'none'], answer: 0, why: 'Best fit takes the smallest hole that is big enough.' },
      { q: 'Same holes, worst fit?', options: ['the 300 K hole', 'the 120 K hole', 'the 50 K hole', 'the first one'], answer: 0, why: 'Worst fit takes the largest hole, leaving the biggest leftover.' },
      { q: 'Same holes, first fit?', options: ['the 300 K hole', 'the 120 K hole', 'the 50 K hole', 'none'], answer: 0, why: '50 K is too small; the next hole in address order, 300 K, fits.' },
      { q: '400 K are free in four holes of 100 K. A request for 150 K…', options: ['fails: external fragmentation', 'succeeds in two pieces', 'succeeds in the first hole', 'causes internal fragmentation'], answer: 0, why: 'Contiguous allocation needs one hole of 150 K; the free memory is in pieces.' },
      { q: 'Freeing a block between two holes leaves…', options: ['one hole, the three merged', 'three holes', 'two holes', 'no hole'], answer: 0, why: 'A freed block merges with the free space on both sides.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
