// Part 10, contiguous allocation compared: the four fits side by side on one script, and the fifty-percent rule
// measured on a long random run; then compaction, which slides every block down so the holes become one.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem, C = () => H.contig;
  const POLS = ['first', 'next', 'best', 'worst'];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const LONG = { memory: 20000, mean: 400, ops: 1200 };

  S.topic({
    id: 'mem-fits-compare', family: 'p10-contig', order: 20, title: 'The four fits side by side',
    blurb: 'The same requests and frees under first, next, best and worst fit, one memory map each. They place the blocks differently, so they leave different holes, and the same request can succeed under one policy and fail under another. Over a long run, first fit leaves about one hole for every two blocks: the fifty-percent rule, which means a third of memory can sit in holes.',
    inputs: [
      { id: 'memory', kind: 'number', label: 'Memory (K)', def: 1024, min: 256, max: 65536 },
      { id: 'os', kind: 'number', label: 'Kernel (K)', def: 128, min: 0, max: 8192 },
      { id: 'script', kind: 'list', label: 'Script (A=200 asks, -A frees)', def: ['A=150', 'B=60', 'C=180', 'D=90', 'E=200', '-B', '-D', 'F=50', 'G=90', 'H=210'], min: 1, max: 12, check: (v) => C().check(false)(v) },
    ],
    check: (inp) => (inp.os >= inp.memory ? 'Kernel (K): less than the memory' : null),
    presets: [
      { label: 'Two small holes: who keeps room for H?', values: {} },
      { label: 'Best fit leaves slivers', values: { memory: 1000, os: 100, script: ['A=200', 'B=210', 'C=200', 'D=190', '-A', '-C', 'E=195', 'F=185', 'G=20', 'H=200'] } },
      { label: 'Worst fit breaks up the big hole', values: { memory: 1024, os: 64, script: ['A=100', 'B=300', 'C=100', '-B', 'D=50', 'E=50', 'F=500'] } },
      { label: 'All four agree', values: { memory: 800, os: 80, script: ['A=100', 'B=100', 'C=100', '-B', 'D=100'] } },
    ],
    counters: [{ id: 'fails', label: 'refusals (all four)' }],
    run(inp) {
      const { ops, ids } = C().parse(inp.script, false);
      const colour = (id) => H.pc(ids.indexOf(id));
      const runs = POLS.map((p) => M().runContig({ memory: inp.memory, osSize: inp.os, policy: p }, ops));
      const init = M().contig({ memory: inp.memory, osSize: inp.os });
      const st0 = { blocks: init.blocks(), holes: init.holes(), frag: init.frag() };
      const F = new S.Frames(['fails']), view = H.box(0, 0, 780, 470);
      const fifty = H.once('fifty', () => POLS.map((p) => M().fiftyPercent({ policy: p, memory: LONG.memory, meanSize: LONG.mean, ops: LONG.ops, seed: 7 })));
      const draw = (k, opts) => {
        const items = [];
        POLS.forEach((p, r) => {
          const y = 34 + r * 104, st = k < 0 ? st0 : runs[r].steps[k], s = runs[r].steps[k];
          const o = s && s.kind === 'alloc' ? { act: s.id } : {};
          const fails = runs[r].steps.slice(0, k + 1).filter((x) => x.kind === 'fail').length;
          items.push(H.text('pn' + r, 8, y + 30, C().NAMES[p], 'mb-ptitle', 15));
          items.push(...C().bar('m' + r, 110, y, 640, 52, inp.memory, C().runs(st, inp.os, colour, o), false).items);
          let line;
          if (opts.fifty) { const q = fifty[r]; line = 'long run: ' + H.f(q.avgBlocks, 1) + ' blocks, ' + H.f(q.avgHoles, 1) + ' holes, ratio ' + H.f(q.ratio, 2); }
          else line = (s && s.kind === 'fail' ? s.id + ' refused · ' : s && s.kind === 'alloc' ? s.id + ' at ' + s.start + ' · ' : '') + H.plural(st.frag.holes, 'hole') + ', largest ' + st.frag.largest + ' K' + (fails ? ' · ' + H.plural(fails, 'refusal') : '');
          items.push(H.text('ps' + r, 110, y + 76, line, s && s.kind === 'fail' && !opts.fifty ? 'bad' : 'tick', 13));
        });
        return items;
      };
      F.add({ items: draw(-1, {}), say: `Four copies of the same memory, ${inp.memory} K with the kernel in the first ${inp.os} K, each about to see the same ${H.plural(ops.length, 'request')} under its own policy.`, meta: { phase: 'start' }, view });
      ops.forEach((op, k) => {
        const ss = runs.map((r) => r.steps[k]);
        let say;
        if (op.op === 'free') say = new Set(ss.map((x) => x.frag.holes)).size === 1 ? `Process ${op.id} is freed in all four, and each now has ${H.plural(ss[0].frag.holes, 'hole')}.` : `Process ${op.id} is freed in all four: ` + H.list(POLS.map((p, r) => C().NAMES[p] + ' now has ' + H.plural(ss[r].frag.holes, 'hole'))) + '.';
        else {
          const groups = new Map();
          ss.forEach((s, r) => { const w = s.kind === 'fail' ? 'refused' : 'at ' + s.start; if (!groups.has(w)) groups.set(w, []); groups.get(w).push(C().NAMES[POLS[r]]); });
          say = `Process ${op.id} asks for ${op.size} K: ` + [...groups].map(([w, ns]) => H.list(ns) + (w === 'refused' ? (ns.length > 1 ? ' refuse it' : ' refuses it') : (ns.length > 1 ? ' put it ' : ' puts it ') + w)).join('; ') + '.';
          const nf = ss.filter((s) => s.kind === 'fail').length;
          F.count('fails', nf);
        }
        F.add({ items: draw(k, {}), say, meta: { phase: 'op', op: op.op, id: op.id, size: op.size || 0, starts: ss.map((s) => (s.kind === 'alloc' ? s.start : -1)), holes: ss.map((s) => s.frag.holes), kinds: ss.map((s) => s.kind) }, view });
      });
      const last = ops.length - 1, fails = runs.map((r) => r.failed), best = Math.min(...fails);
      const winners = POLS.filter((p, r) => fails[r] === best).map((p) => C().NAMES[p]);
      F.add({ items: draw(last, {}), say: `Refusals: ` + H.list(POLS.map((p, r) => C().NAMES[p] + ' ' + fails[r])) + '. ' + (best === Math.max(...fails) ? 'On this script they tie.' : cap(H.list(winners)) + (winners.length > 1 ? ' do' : ' does') + ' best here; a different script can change the order, which is why no fit wins everywhere.'), meta: { phase: 'end', fails, holes: runs.map((r) => r.frag.holes), largest: runs.map((r) => r.frag.largest) }, view });
      F.add({ items: draw(last, { fifty: true }), say: `A long random run (${LONG.memory} K, requests averaging ${LONG.mean} K, ${LONG.ops} of them, a random block freed whenever one fails): on average ` + H.list(POLS.map((p, r) => C().NAMES[p] + ' keeps ' + H.f(fifty[r].avgHoles, 1) + ' holes for ' + H.f(fifty[r].avgBlocks, 1) + ' blocks')) + `. For first fit the ratio is ${H.f(fifty[0].ratio, 2)}: about one hole for every two blocks, the fifty-percent rule.`, meta: { phase: 'fifty', long: [LONG.memory, LONG.mean, LONG.ops], blocks: fifty.map((q) => q.avgBlocks), holesAvg: fifty.map((q) => q.avgHoles), ratio: fifty.map((q) => q.ratio) }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('Four fits', ['first: the lowest hole big enough', 'next: the same, from the last placement', 'best: the smallest hole big enough', 'worst: the largest hole', 'fifty-percent rule: holes ≈ blocks / 2']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase !== 'end' && f.meta.phase !== 'fifty' && fr[i + 1].meta.phase === 'op' && fr[i + 1].meta.op === 'alloc' && fr[i + 1].meta.kinds.includes('fail') && fr[i + 1].meta.kinds.includes('alloc'), once: true, pick: 'option', ask: (fr, i) => `${fr[i + 1].meta.id} will ask for ${fr[i + 1].meta.size} K. Which policy refuses it?`, options: ['first fit', 'next fit', 'best fit', 'worst fit'], answer: (fr, i) => ['first fit', 'next fit', 'best fit', 'worst fit'].filter((_, r) => fr[i + 1].meta.kinds[r] === 'fail'), explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1].meta.phase === 'end', pick: 'option', ask: 'Which policy will end with the fewest refusals?', options: ['first fit', 'next fit', 'best fit', 'worst fit'], answer: (fr, i) => { const m = fr[i + 1].meta, b = Math.min(...m.fails); return ['first fit', 'next fit', 'best fit', 'worst fit'].filter((_, r) => m.fails[r] === b); }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which fit tends to leave many tiny holes nobody can use?', options: ['best fit', 'worst fit', 'first fit', 'none'], answer: 0, why: 'Taking the tightest hole leaves the smallest leftovers.' },
      { q: 'The fifty-percent rule says that with N blocks allocated there are about…', options: ['N / 2 holes', 'N holes', '2N holes', 'no holes'], answer: 0, why: 'Measured over long runs of first fit: about half as many holes as blocks.' },
      { q: 'Why can best fit be slow?', options: ['it must look at every hole (unless they are kept sorted by size)', 'it compacts on every request', 'it frees blocks', 'it needs paging'], answer: 0, why: 'The smallest fitting hole can be anywhere in the list.' },
      { q: 'Next fit differs from first fit by…', options: ['starting each search where the last one stopped', 'choosing the largest hole', 'splitting holes in half', 'never wrapping round'], answer: 0, why: 'It spreads allocations through memory instead of crowding the low addresses.' },
    ],
  });

  S.topic({
    id: 'mem-compaction', family: 'p10-contig', order: 30, title: 'Compaction',
    blurb: 'External fragmentation leaves free memory in pieces too small to use. Compaction slides the blocks down, one after another, so the free memory becomes a single hole at the top. It is only possible because addresses are bound at run time: moving a process means copying it and changing its base register. Every byte copied costs time, so a kernel compacts rarely, for example only when a request has failed.',
    inputs: [
      { id: 'memory', kind: 'number', label: 'Memory (K)', def: 1024, min: 256, max: 65536 },
      { id: 'os', kind: 'number', label: 'Kernel (K)', def: 128, min: 0, max: 8192 },
      { id: 'mode', kind: 'choice', label: 'Compact', def: 'on-fail', options: [{ value: 'on-fail', label: 'when a request fails' }, { value: 'never', label: 'only at # in the script' }] },
      { id: 'script', kind: 'list', label: 'Script (A=200, -A, # compacts)', def: ['A=120', 'B=160', 'C=140', 'D=180', 'E=110', '-B', '-D', 'F=300'], min: 1, max: 12, check: (v) => C().check(true)(v) },
    ],
    check: (inp) => (inp.os >= inp.memory ? 'Kernel (K): less than the memory' : null),
    presets: [
      { label: 'A request that only fits after compacting', values: {} },
      { label: 'Compact by hand with #', values: { mode: 'never', script: ['A=100', 'B=100', 'C=100', 'D=100', '-A', '-C', '#', 'E=250'] } },
      { label: 'Nothing to move', values: { mode: 'never', script: ['A=200', 'B=200', '#', 'C=100'] } },
      { label: 'Not enough even after compacting', values: { script: ['A=300', 'B=200', 'C=300', '-B', 'D=500'] } },
      { label: 'A larger machine', values: { memory: 4096, os: 256, script: ['P1=500', 'P2=700', 'P3=400', 'P4=900', 'P5=600', '-P1', '-P3', 'P6=1000', '-P5', 'P7=1100'] } },
    ],
    counters: [{ id: 'moved', label: 'K copied' }, { id: 'compactions', label: 'compactions' }],
    run(inp) {
      const { ops, ids } = C().parse(inp.script, true);
      const colour = (id) => H.pc(ids.indexOf(id));
      const A = M().contig({ memory: inp.memory, osSize: inp.os, policy: 'first', compact: inp.mode });
      const F = new S.Frames(['moved', 'compactions']), view = H.box(0, 0, 780, 470);
      let st = { blocks: A.blocks(), holes: A.holes(), frag: A.frag() };
      const draw = (top, o, after, moved, label) => {
        const items = [H.text('t1', 20, 40, label || 'memory', 'title')];
        items.push(...C().bar('a', 20, 54, 740, 70, inp.memory, C().runs(top, inp.os, colour, o)).items);
        items.push(H.text('fr', 20, 176, C().fragLine(top.frag) + (top.frag.free ? ' · external fragmentation ' + H.pct(top.frag.external) : ''), 'strong', 14));
        if (after) {
          items.push(H.text('t2', 20, 390, 'after compaction', 'title'));
          const b = C().bar('b', 20, 276, 740, 70, inp.memory, C().runs(after, inp.os, colour, {}));
          items.push(...b.items);
          const ra = C().runs(top, inp.os, colour, {});
          const xa = (id) => { const r = ra.find((q) => q.key === 'b' + id); return 20 + ((r.start + r.size / 2) / inp.memory) * 740; };
          for (const mv of moved) {
            const x1 = xa(mv.id), x2 = 20 + ((mv.to + mv.size / 2) / inp.memory) * 740;
            items.push({ key: 'mv' + mv.id, kind: 'edge', from: { x: Math.round(x1), y: 190 }, to: { x: Math.round(x2), y: 274 }, cls: 'act' });
          }
          items.push(H.text('fr2', 20, 414, C().fragLine(after.frag), 'good', 14));
        }
        return items;
      };
      const comp = (pre, before, k, why, req) => {
        F.count('compactions'); F.count('moved', pre.bytesMoved);
        const after = { blocks: pre.blocks, holes: pre.holes, frag: pre.frag };
        F.add({ items: draw(before, {}, after, pre.moved, 'before'), say: why + (pre.moved.length ? `Compaction slides ${H.list(pre.moved.map((m) => m.id + ' from ' + m.from + ' to ' + m.to))}: ${pre.bytesMoved} K copied, and each moved process gets a new base register. The free memory is now one hole of ${pre.frag.largest} K.` : 'Compaction finds every block already packed against the one below: nothing moves.'), meta: { phase: 'compact', req: req || 0, was: before.frag.largest, moved: pre.moved.map((m) => [m.from, m.to, m.size]), bytes: pre.bytesMoved, hole: pre.frag.largest, free: before.frag.free, holes: before.frag.holes }, view, hl: { d: [1, 2] } });
        return after;
      };
      F.add({ items: draw(st, {}), say: `Memory is ${inp.memory} K with the kernel in the first ${inp.os} K. Blocks are placed by first fit; compaction happens ${inp.mode === 'on-fail' ? 'whenever a request finds no hole but enough free memory in all' : 'only where the script says #'}.`, meta: { phase: 'start' }, view });
      ops.forEach((op, k) => {
        if (op.op === 'compact') { const s = A.compact(); st = comp(s, st, k, ''); return; }
        if (op.op === 'free') {
          if (!st.blocks.some((b) => b.id === op.id)) { F.add({ items: draw(st, {}), say: `Process ${op.id} was never placed, so there is nothing to free.`, meta: { phase: 'skip' }, view }); return; }
          const s = A.free(op.id);
          F.add({ items: draw(s, {}), say: `Process ${op.id} frees ${s.size} K at ${s.start}. Now ${C().fragLine(s.frag)}.`, meta: { phase: 'free', id: op.id, size: s.size, start: s.start, free: s.frag.free, holes: s.frag.holes, largest: s.frag.largest }, view });
          st = s; return;
        }
        const s = A.alloc(op.id, op.size);
        if (s.kind === 'alloc' && s.compacted) st = comp(s.compacted, st, k, `Process ${op.id} asks for ${op.size} K. No hole is that big (the largest is ${st.frag.largest} K), but ${st.frag.free} K are free in all. `, op.size);
        if (s.kind === 'fail') {
          F.add({ items: draw(s, {}), say: `Process ${op.id} asks for ${op.size} K and is refused: ` + (s.frag.free >= op.size ? `the largest hole is ${s.frag.largest} K though ${s.frag.free} K are free. Compacting would make room.` : `only ${s.frag.free} K are free in all, so compacting cannot help.`), meta: { phase: 'fail', id: op.id, size: op.size, free: s.frag.free, largest: s.frag.largest }, view, hl: { d: [3] } });
          st = s; return;
        }
        F.add({ items: draw(s, { act: op.id }), say: `Process ${op.id} (${op.size} K) goes at ${s.start}. Now ${C().fragLine(s.frag)}.`, meta: { phase: 'alloc', id: op.id, size: op.size, start: s.start, free: s.frag.free, holes: s.frag.holes, largest: s.frag.largest }, view });
        st = s;
      });
      const c = F.counts;
      F.add({ items: draw(st, {}), say: `${H.plural(c.compactions, 'compaction')} copied ${c.moved} K in all. Copying is the price: a kernel that compacted after every free would spend its time moving memory, which is one reason paging, which needs no contiguous holes at all, replaced this scheme.`, meta: { phase: 'end', compactions: c.compactions, moved: c.moved }, view, hl: { d: [4] } });
      return { frames: F.list, def: H.def('Compaction', ['slide blocks down in address order', 'each moved process: copy it, new base', 'result: all free memory in one hole', 'needs run-time binding (relocation)', 'cost: every byte moved is copied']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1].meta.phase === 'compact', once: true, pick: 'option', ask: 'Compaction is next. How many K will it copy?', options: (fr, i) => { const b = fr[i + 1].meta.bytes, fre = fr[i + 1].meta.free; return [...new Set([b, fre, 0, b + fre])].sort((x, y) => x - y).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.bytes), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Compaction is possible only if…', options: ['addresses are bound at run time', 'addresses are bound at compile time', 'memory is paged', 'every hole is the same size'], answer: 0, why: 'A moved process keeps running only if its addresses are relocated by the hardware, through a new base.' },
      { q: 'Blocks of 100 K at 200 and 300 K at 500, the kernel ends at 200. Compaction copies…', options: ['300 K', '400 K', '100 K', 'nothing'], answer: 0, why: 'The first block is already against the kernel; only the second slides down, from 500 to 300.' },
      { q: 'After compaction, how many holes are there (with some free memory)?', options: ['one', 'as many as before', 'none', 'two'], answer: 0, why: 'All free memory ends up together at the top.' },
      { q: 'Why not compact after every free?', options: ['copying memory costs time', 'it loses data', 'it needs a TLB', 'it creates holes'], answer: 0, why: 'Every moved byte must be read and written.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
