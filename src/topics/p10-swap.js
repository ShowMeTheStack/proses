// Part 10, swapping. Whole processes move between memory and a backing store: loaded (A=300), swapped out (>A),
// swapped back in (<A), possibly at another address, which the base register hides, and ending (-A). Each transfer
// costs a latency plus its size over the transfer rate. Placement is first fit (S.Mem.contig); the relocation of a
// sample address after a swap is S.Mem.baseBounds.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const LOGICAL = 100;

  function parse(list) {
    const ops = [], state = new Map();
    for (const x of list) {
      let m;
      if ((m = /^([A-Z][A-Za-z0-9]?)=(\d+)$/.exec(x))) { if (state.has(m[1]) && !(state.get(m[1]) === 'new' && ops.some((o) => o.op === 'load' && o.id === m[1] && o.size === +m[2]))) throw new Error('Script: ' + m[1] + ' exists already (repeat it with the same size to retry a load that had to wait)'); if (+m[2] < 1) throw new Error('Script: ' + m[1] + ' needs at least 1 K'); ops.push({ op: 'load', id: m[1], size: +m[2] }); state.set(m[1], 'new'); }
      else if ((m = /^([<>-])([A-Z][A-Za-z0-9]?)$/.exec(x))) {
        if (!state.has(m[2]) || state.get(m[2]) === 'gone') throw new Error('Script: ' + m[2] + ' is not a process at that point (create it with ' + m[2] + '=size)');
        ops.push({ op: m[1] === '>' ? 'out' : m[1] === '<' ? 'in' : 'exit', id: m[2] });
        if (m[1] === '-') state.set(m[2], 'gone');
      } else throw new Error('Script: "' + x + '" is not A=300 (load), >A (swap out), <A (swap in) or -A (exit)');
    }
    return ops;
  }

  S.topic({
    id: 'mem-swapping', family: 'p10-binding', order: 20, title: 'Swapping whole processes',
    blurb: 'When memory is full, a whole process can be copied out to a backing store, a disk area, to make room, and copied back later to run again. With run-time binding it can come back anywhere: only its base register changes. Swapping is slow, because the transfer time grows with the size of the process, which is why systems swap rarely and why paging, which moves single pages, replaced it.',
    inputs: [
      { id: 'memory', kind: 'number', label: 'Memory (K)', def: 1024, min: 256, max: 65536 },
      { id: 'os', kind: 'number', label: 'Kernel (K)', def: 128, min: 0, max: 8192 },
      { id: 'rate', kind: 'number', label: 'Transfer rate (MiB/s)', def: 100, min: 1, max: 10000 },
      { id: 'lat', kind: 'number', label: 'Latency per transfer (ms)', def: 8, min: 0, max: 100 },
      { id: 'script', kind: 'list', label: 'Script (A=300, >A, <A, -A)', def: ['A=300', 'B=250', 'C=280', 'D=200', '>B', 'D=200', '>A', '<B', '<A', '>C', '<A'], min: 1, max: 14, check: (v) => { try { parse(v); return null; } catch (e) { return e.message; } } },
    ],
    check: (inp) => (inp.os >= inp.memory ? 'Kernel (K): less than the memory' : null),
    presets: [
      { label: 'Out, in, and back somewhere else', values: { script: ['A=300', 'B=250', 'C=280', 'D=200', '>B', '>A', '<B', '<A', '>C', '<A'] } },
      { label: 'One process in and out', values: { script: ['A=500', '>A', 'B=600', '-B', '<A'] } },
      { label: 'A fast SSD and a slow disk', values: { rate: 2000, lat: 0, script: ['A=600', 'B=400', '>A', '<A'] } },
      { label: 'Slow disk: 20 MiB/s', values: { rate: 20, lat: 15, script: ['A=600', 'B=400', '>A', '<A'] } },
      { label: 'A large machine', values: { memory: 16384, os: 1024, rate: 500, script: ['P1=6000', 'P2=5000', 'P3=4000', '>P2', 'P4=4500', '>P1', '<P2'] } },
    ],
    counters: [{ id: 'ms', label: 'ms swapping' }, { id: 'swaps', label: 'transfers' }],
    run(inp) {
      const ops = parse(inp.script), ids = [...new Set(ops.map((o) => o.id))];
      const A = M().contig({ memory: inp.memory, osSize: inp.os, policy: 'first' });
      const C = H.contig, colour = (id) => H.pc(ids.indexOf(id));
      const size = new Map(), where = new Map(), store = [];
      const F = new S.Frames(['ms', 'swaps']), view = H.box(0, 0, 790, 480);
      const msOf = (k) => inp.lat + (k / 1024 / inp.rate) * 1000;
      let total = 0;
      const draw = (st, o) => {
        o = o || {};
        const items = [H.text('mt', 20, 40, 'memory', 'title')];
        const runs = C.runs(st, inp.os, colour, { act: o.act });
        const bar = C.bar('mm', 20, 54, 740, 70, inp.memory, runs);
        items.push(...bar.items);
        items.push(H.title('bt', 760, 286, 'backing store', 'end'));
        items.push({ key: 'bs', kind: 'region', x: 20, y: 296, w: 740, h: 70, rx: 8, text: '', cls: 'p10-unit', layer: 'back' });
        store.forEach((id, k) => items.push(H.cellL('s' + id, 34 + k * 120, 306, 108, 50, [id, size.get(id) + ' K'], 'p10-box ' + colour(id) + (o.act === id ? ' act' : ''), 13)));
        if (!store.length) items.push(H.text('bse', 34, 337, 'empty', 'tick', 13));
        if (o.move) {
          const b = bar.run('b' + o.move.id), si = store.indexOf(o.move.id);
          if (b && si >= 0) {
            const x1 = Math.round(b.x + b.w / 2), x2 = 34 + si * 120 + 54;
            items.push({ key: 'mv', kind: 'edge', from: o.move.dir === 'out' ? { x: x1, y: 148 } : { x: x2, y: 300 }, to: o.move.dir === 'out' ? { x: x2, y: 300 } : { x: x1, y: 148 }, cls: 'act' });
          }
        }
        (o.lines || []).forEach((l, k) => items.push(H.text('ln' + k, 20, 410 + k * 28, l[0], l[1], 14)));
        items.push(H.text('tot', 760, 466, 'time spent swapping: ' + H.f(total, 1) + ' ms', 'strong', 13, 'end'));
        return items;
      };
      let st = { blocks: A.blocks(), holes: A.holes(), frag: A.frag() };
      F.add({ items: draw(st), say: `Memory is ${inp.memory} K with the kernel in the first ${inp.os} K. A transfer to or from the backing store costs ${inp.lat} ms of latency plus the size over ${inp.rate} MiB/s.`, meta: { phase: 'start' }, view, hl: { d: [0] } });
      for (const op of ops) {
        if (op.op === 'load' || op.op === 'in') {
          const sz = op.op === 'load' ? op.size : size.get(op.id);
          if (op.op === 'in' && !store.includes(op.id)) { F.add({ items: draw(st), say: `Process ${op.id} is not in the backing store, so there is nothing to swap in.`, meta: { phase: 'skip', id: op.id }, view }); continue; }
          if (op.op === 'load' && (where.has(op.id) || store.includes(op.id))) { F.add({ items: draw(st), say: `Process ${op.id} is already loaded, so there is nothing to retry.`, meta: { phase: 'skip', id: op.id }, view }); continue; }
          if (op.op === 'load') size.set(op.id, sz);
          const s = A.alloc(op.id, sz);
          if (s.kind === 'fail') {
            if (op.op === 'load') size.delete(op.id);
            F.add({ items: draw(s, { lines: [['no hole of ' + sz + ' K: the largest is ' + s.frag.largest + ' K', 'p10-sum bad']] }), say: `Process ${op.id} needs ${sz} K but the largest hole is ${s.frag.largest} K (${s.frag.free} K free in all). It must wait until something is swapped out or ends.`, meta: { phase: 'wait', id: op.id, size: sz, largest: s.frag.largest, free: s.frag.free }, view, hl: { d: [1] } });
            st = s; continue;
          }
          const old = where.has(op.id) ? where.get(op.id) : -1, pa = M().baseBounds({ base: s.start, limit: sz }, LOGICAL).pa;
          where.set(op.id, s.start);
          if (op.op === 'load') {
            F.add({ items: draw(s, { act: op.id, lines: [['base ' + s.start + ', limit ' + sz, 'p10-sum']] }), say: `Process ${op.id} (${sz} K) is loaded at ${s.start}: its base register is ${s.start} and its limit ${sz}.`, meta: { phase: 'load', id: op.id, size: sz, start: s.start }, view, hl: { d: [0] } });
          } else {
            const t = msOf(sz);
            total += t; F.count('swaps'); F.set('ms', +total.toFixed(1));
            const draws = draw(s, { act: op.id, move: { id: op.id, dir: 'in' }, lines: [['swap in: ' + inp.lat + ' + ' + sz + ' K ÷ ' + inp.rate + ' MiB/s = ' + H.f(t, 1) + ' ms', 'p10-sum'], [old === s.start ? 'back at ' + s.start + ', its old place' : 'new base ' + s.start + ' (was ' + old + '): logical ' + LOGICAL + ' → ' + pa, old === s.start ? 'strong' : 'p10-sum good']] });
            store.splice(store.indexOf(op.id), 1);
            F.add({ items: draws, say: `Process ${op.id} is swapped back in, ${H.f(t, 1)} ms for ${sz} K. ` + (old === s.start ? `It lands at ${s.start}, where it was before.` : `It lands at ${s.start}, not at ${old} where it ran before: the kernel only sets its base register to ${s.start}, so its logical address ${LOGICAL} now means physical ${pa}.`), meta: { phase: 'in', id: op.id, size: sz, start: s.start, old, pa, logical: LOGICAL, ms: t, total }, view, hl: { d: [2, 3] } });
          }
          st = s; continue;
        }
        if (!st.blocks.some((b) => b.id === op.id)) { F.add({ items: draw(st), say: `Process ${op.id} is not in memory, so it cannot be ${op.op === 'out' ? 'swapped out' : 'ended there'}.`, meta: { phase: 'skip', id: op.id }, view }); if (op.op === 'exit' && store.includes(op.id)) store.splice(store.indexOf(op.id), 1); continue; }
        if (op.op === 'out') {
          const before = st, sz = size.get(op.id), t = msOf(sz);
          store.push(op.id);
          const s = A.free(op.id);
          total += t; F.count('swaps'); F.set('ms', +total.toFixed(1));
          void before;
          F.add({ items: draw(s, { act: op.id, move: { id: op.id, dir: 'out' }, lines: [['swap out: ' + inp.lat + ' + ' + sz + ' K ÷ ' + inp.rate + ' MiB/s = ' + H.f(t, 1) + ' ms', 'p10-sum']] }).map((it) => it), say: `Process ${op.id} is swapped out: ${sz} K copied to the backing store in ${inp.lat} ms + ${sz} K ÷ ${inp.rate} MiB/s = ${H.f(t, 1)} ms, leaving a hole of ${s.hole.size} K at ${s.hole.start}.`, meta: { phase: 'out', id: op.id, size: sz, ms: t, total, hole: [s.hole.start, s.hole.size] }, view, hl: { d: [2] } });
          st = s; continue;
        }
        const s = A.free(op.id);
        F.add({ items: draw(s), say: `Process ${op.id} ends and frees ${s.size} K at ${s.start}.`, meta: { phase: 'exit', id: op.id, size: s.size, start: s.start }, view });
        st = s;
      }
      F.add({ items: draw(st), say: `${H.plural(F.counts.swaps, 'transfer')} took ${H.f(total, 1)} ms in all. A context switch takes microseconds; a swap takes milliseconds, so a kernel swaps only when memory is badly overcommitted.`, meta: { phase: 'end', swaps: F.counts.swaps, total }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('Swapping', ['load: place the process in a hole (first fit)', 'out: copy it to the backing store, free its run', 'in: place it again, anywhere it fits', 'relocation: only the base register changes', 'time = latency + size ÷ transfer rate']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1].meta.phase === 'in', once: true, pick: 'option', ask: (fr, i) => `Process ${fr[i + 1].meta.id} is swapped back in. Where will it land?`, options: (fr, i) => { const m = fr[i + 1].meta; return [...new Set([m.start, m.old])].map((v) => 'at ' + v); }, answer: (fr, i) => 'at ' + fr[i + 1].meta.start, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A 400 K process, 100 MiB/s, 8 ms latency. Roughly how long is one swap out?', options: ['about 12 ms', 'about 4 s', 'about 0.4 ms', 'about 100 ms'], answer: 0, why: '8 ms + 400 K ÷ 100 MiB/s ≈ 8 + 3.9 ms.' },
      { q: 'A process swapped back in at a different address keeps working because…', options: ['addresses are relocated at run time by the base register', 'the compiler fixes its addresses', 'the TLB remembers it', 'it is copied to the old place first'], answer: 0, why: 'Only the base register changes.' },
      { q: 'Why can a process waiting for I/O into its buffer be a bad candidate to swap out?', options: ['the device may write into memory now used by someone else', 'it is too small', 'it has no base register', 'it is never'], answer: 0, why: 'Pending I/O must finish first, or go through kernel buffers.' },
      { q: 'What replaced swapping whole processes in most systems?', options: ['paging single pages in and out', 'larger disks', 'compaction', 'base registers'], answer: 0, why: 'Moving only the pages needed costs far less.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
