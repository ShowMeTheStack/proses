// Part 11, user allocators. One malloc heap with boundary tags: each malloc rounded up with its two tags, a free
// block found by the policy (the blocks searched outlined), split when the rest is big enough; each free coalescing
// with free neighbours found through the next block's header and the previous block's footer. Then the four
// policies side by side on the same script.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem, C = () => S.P11C;
  const POL = { first: 'first fit', next: 'next fit', best: 'best fit', segregated: 'segregated lists' };
  const TAG = 4;
  const opsInput = (def) => ({ id: 'ops', kind: 'list', label: 'Requests (a=20, -a frees)', def, min: 1, max: 14, check: (v) => C().scriptCheck(C().parseOps(v), v, 'Requests') });
  const names = (ops) => [...new Set(ops.filter((o) => o.id).map((o) => o.id))];

  /** the heap as a bar: blocks to scale, with their header and footer tags */
  function heapBar(pre, blocks, heap, x, y, w, h, o) {
    o = o || {};
    const tw0 = o.small ? 0 : 2 * Math.max(2, (TAG / heap) * w), roomy = (t, bw, mono) => S.geom.textWidth(t, mono ? 12 : 13, { mono, bold: !mono }) + 10 + tw0 <= bw;
    const runs = blocks.map((b) => {
      const bw = (b.size / heap) * w, t = b.free ? (o.small ? String(b.size) : 'free ' + b.size) : b.id + ' ' + b.request, sub = b.start + '–' + (b.start + b.size - 1);
      return { key: 'b' + b.start, start: b.start, size: b.size, cls: (b.free ? 'free' : H.pc(o.names.indexOf(b.id))) + (o.act === b.start ? ' act' : o.searched && o.searched.includes(b.start) ? ' cand' : ''), text: roomy(t, bw) ? t : roomy(String(b.free ? b.size : b.id), bw) ? String(b.free ? b.size : b.id) : '', sub: !o.small && roomy(sub, bw, true) ? sub : '' };
    });
    const bar = S.Kit.p10.hbar({ prefix: pre, x, y, w, h, total: heap, runs, ticks: o.ticks === false ? [] : blocks.map((b) => b.start).concat([heap]), size: 13 });
    const items = bar.items, tw = Math.max(2, (TAG / heap) * w);
    if (!o.small) for (const b of blocks) {
      const x0 = bar.X(b.start), x1 = bar.X(b.start + b.size);
      items.push(H.cell(pre + ':h' + b.start, x0 + 1, y + 1, tw - 1, h - 2, '', 'htag' + (b.free ? ' free' : ''), 12, { rx: 0, audit: 'overlap-ok' }), H.cell(pre + ':f' + b.start, x1 - tw, y + 1, tw - 1, h - 2, '', 'htag' + (b.free ? ' free' : ''), 12, { rx: 0, audit: 'overlap-ok' }));
    }
    return { items, X: bar.X };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // One heap
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'vmem-malloc', family: 'p11-ualloc', order: 10, title: 'malloc and free',
    blurb: 'malloc carves the heap into blocks. Each block starts with a header and ends with a footer, boundary tags that both hold the block\'s size and whether it is in use. A request grows by the two tags and is rounded up to the alignment; the policy picks a free block that fits, and if the rest is big enough to be a block of its own the block is split. free marks the block free and looks at its neighbours: the next block\'s header and the previous block\'s footer, right beside it, say at once whether they are free too, and free neighbours coalesce into one block.',
    inputs: [
      { id: 'heap', kind: 'choice', label: 'Heap', def: '256', options: ['128', '256', '512'].map((v) => ({ value: v, label: v + ' bytes' })) },
      { id: 'policy', kind: 'choice', label: 'Policy', def: 'first', options: Object.entries(POL).map(([value, label]) => ({ value, label })) },
      opsInput(['a=20', 'b=40', 'c=12', 'd=30', '-b', 'e=10', '-c', '-a', 'f=60']),
    ],
    presets: [
      { label: 'Split, free and coalesce, first fit', values: {} },
      { label: 'The same requests, best fit', values: { policy: 'best' } },
      { label: 'Coalescing on both sides', values: { ops: ['a=24', 'b=24', 'c=24', 'd=24', '-a', '-c', '-b'] } },
      { label: 'Too small to split: internal waste', values: { heap: '128', ops: ['a=50', 'b=40', '-a', 'c=44'] } },
      { label: 'Segregated lists', values: { policy: 'segregated', ops: ['a=10', 'b=100', 'c=10', '-a', 'd=6', 'e=50', '-c', 'f=8'] } },
      { label: 'Free space in pieces: a failure', values: { heap: '128', ops: ['a=20', 'b=20', 'c=20', 'd=20', '-a', '-c', 'e=40'] } },
    ],
    counters: [{ id: 'used', label: 'bytes in blocks' }, { id: 'holes', label: 'free blocks' }],
    run(inp) {
      const heap = +inp.heap, ops = C().parseOps(inp.ops), A = M().malloc({ heap, policy: inp.policy, tag: TAG }), nm = names(ops);
      const FR = new S.Frames(['used', 'holes']), view = H.box(0, 0, 790, 470);
      const draw = (st, o) => {
        const blocks = st.blocks, items = [H.text('hdr', 4, 22, heap + '-byte heap, ' + POL[inp.policy] + ', ' + TAG + '-byte header and footer, 8-byte alignment', 'p10-sum', 15)];
        items.push(...heapBar('hp', blocks, heap, 10, 52, 756, 64, Object.assign({ names: nm }, o)).items);
        // the anatomy of the block acted on
        const b = o.act === undefined ? null : blocks.find((x) => x.start === o.act);
        if (b) {
          const y = 176, W = 756, parts = b.free ? [['header', TAG, 'htag free'], ['free space ' + (b.size - 2 * TAG), b.size - 2 * TAG, 'p10-run free'], ['footer', TAG, 'htag free']]
            : [['header', TAG, 'htag'], ['payload ' + b.request, b.request, 'p10-run ' + H.pc(nm.indexOf(b.id))], ['pad ' + (b.size - 2 * TAG - b.request), b.size - 2 * TAG - b.request, 'p10-run waste'], ['footer', TAG, 'htag']];
          items.push(H.text('an', 10, y - 12, 'the block at ' + b.start + ', ' + b.size + ' bytes: ' + (b.free ? 'free' : 'in use by ' + b.id), 'strong', 13));
          let x = 10;
          const unit = (W - 4 * 72) / b.size;
          parts.forEach(([t, n, cls], k) => {
            if (n <= 0) return;
            const w = Math.max(72, n * unit);
            items.push(H.cell('ap' + k, x, y, w, 40, '', cls, 12, { rx: 0 }));
            items.push(H.text('apt' + k, x + w / 2, y + 60, (k === 0 || k === parts.length - 1) ? t + ' ' + b.size + (b.free ? '/0' : '/1') : t, 'tick', 12, 'middle'));
            x += w;
          });
        }
        // free lists
        const fl = st.freeLists, keys = Object.keys(fl), ly = 290;
        items.push(H.text('flt', 10, ly, inp.policy === 'segregated' ? 'free lists by size class' : 'free list (address order)', 'strong', 13));
        keys.forEach((k, r) => {
          const y = ly + 14 + r * 30;
          if (inp.policy === 'segregated') items.push(H.text('fk' + k, 70, y + 19, (+k === +keys[keys.length - 1] ? k + '+' : k + '–' + (+keys[r + 1] - 1)), 'tick mono', 12, 'end'));
          const xs = inp.policy === 'segregated' ? 80 : 10;
          if (!fl[k].length) items.push(H.text('fe' + k, xs, y + 19, 'empty', 'tick', 12));
          fl[k].slice(0, 8).forEach((s, j) => { const bb = blocks.find((x) => x.start === s); items.push(H.cell('fn' + k + '_' + s, xs + j * 86, y, 76, 26, s + ': ' + bb.size, 'flnode' + (o.act === s ? ' act' : ''), 12, { rx: 3 })); if (j) items.push({ key: 'fa' + k + '_' + s, kind: 'edge', from: 'fn' + k + '_' + fl[k][j - 1], to: 'fn' + k + '_' + s, cls: '' }); });
        });
        const sts = A.stats();
        items.push(H.text('st', 10, 462, 'in blocks ' + sts.used + ' B, payload ' + sts.payload + ' B, tags and padding ' + sts.internal + ' B; free ' + sts.free + ' B, largest ' + sts.largest + ' B', 'tick', 13));
        return { items, sts };
      };
      const s0 = { blocks: A.blocks(), freeLists: A.freeLists() };
      FR.set('holes', 1);
      FR.add({ items: draw(s0, {}).items, say: `The heap is one free block of ${heap} bytes. Every block will carry a ${TAG}-byte header and a ${TAG}-byte footer, and sizes are multiples of 8.`, meta: { phase: 'start', heap, tag: TAG, tags: 2 * TAG }, view, hl: { d: [0] } });
      ops.forEach((o) => {
        const was = A.blocks().find((b) => b.id === o.id);
        if (o.op === 'free' && !was) { FR.add({ items: draw({ blocks: A.blocks(), freeLists: A.freeLists() }, {}).items, say: `${o.id} was never placed, so free(${o.id}) has nothing to do.`, meta: { phase: 'skip', id: o.id }, view, hl: { d: [] } }); return; }
        const st = o.op === 'alloc' ? A.malloc(o.id, o.n) : A.free(o.id);
        const d = draw(st, { act: st.kind === 'fail' ? undefined : st.start, searched: st.searched });
        const holes = st.blocks.filter((b) => b.free).length;
        FR.set('used', d.sts.used).set('holes', holes);
        FR.add({ items: d.items, say: st.say + (st.kind === 'malloc' && st.searched.length > 1 ? ` ${H.plural(st.searched.length, 'free block')} ${st.searched.length === 1 ? 'was' : 'were'} looked at.` : ''), meta: { phase: st.kind, id: o.id, from: was ? was.start : null, request: st.request, size: st.size, start: st.start, payloadAt: st.start + TAG, searched: (st.searched || []).length, split: !!st.split, rest: st.kind === 'malloc' ? null : null, merges: (st.merges || []).length, tags: 2 * TAG, need: st.kind === 'malloc' ? st.size : st.size, stats: d.sts, holes, rounded: Math.max(16, Math.ceil(((st.request || 0) + 2 * TAG) / 8) * 8), blocks: st.blocks.map((b) => [b.start, b.size]) }, view, hl: { d: st.kind === 'malloc' ? (st.split ? [1, 2] : [1]) : st.kind === 'free' ? [3, 4] : [1] } });
      });
      const sts = A.stats();
      FR.add({ items: draw({ blocks: A.blocks(), freeLists: A.freeLists() }, {}).items, say: `At the end ${sts.payload} bytes of payload occupy ${sts.used} bytes of blocks: ${sts.internal} bytes are tags and padding. ${sts.free} bytes are free` + (!sts.free ? '.' : sts.external ? `, but the largest piece is ${sts.largest}: ${H.pct(sts.external)} of the free space lies outside it, external fragmentation.` : ', all in one piece.'), meta: { phase: 'end', stats: sts }, view, hl: { d: [4] } });
      return { frames: FR.list, def: H.def('Boundary tags', ['block = header + payload + padding + footer', 'size = align8(request + 2 × tag)', 'split if the rest ≥ the smallest block', 'free: next header free? merge; previous footer free? merge', 'internal: tags + padding; external: free in pieces']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'malloc', once: true, pick: 'option', ask: (fr, i) => `malloc(${fr[i + 1].meta.request}) for ${fr[i + 1].meta.id}: how big a block does it need, with its two ${TAG}-byte tags and 8-byte alignment?`, options: (fr, i) => { const s = fr[i + 1].meta.rounded; return [...new Set([s - 8, s, s + 8, fr[i + 1].meta.request])].filter((x) => x > 0).sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.rounded), explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'free', once: true, pick: 'option', ask: (fr, i) => `free(${fr[i + 1].meta.id}): with how many neighbours will it coalesce?`, options: ['0', '1', '2'], answer: (fr, i) => String(fr[i + 1].meta.merges), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'With 4-byte tags and 8-byte alignment, malloc(13) needs a block of…', options: ['24 bytes', '13 bytes', '16 bytes', '21 bytes'], answer: 0, why: '13 + 8 = 21, rounded up to 24.' },
      { q: 'Why keep a footer as well as a header?', options: ['so free can find whether the previous block is free in one step', 'to store the payload', 'to align the heap', 'to count references'], answer: 0, why: 'The previous block\'s footer sits just below the freed block\'s header.' },
      { q: 'A free block of 48 bytes serves a request needing 40, and the smallest block is 16. What happens?', options: ['the whole 48 is given: 8 bytes are too small to split off', 'it splits 40 and 8', 'the request fails', 'it splits 32 and 16'], answer: 0, why: 'The 8 left over could not hold even its own tags.' },
      { q: 'Best fit compared with first fit usually…', options: ['searches more of the list but leaves big holes intact', 'is always faster', 'never fragments', 'needs no tags'], answer: 0, why: 'It must look at every free block to find the smallest that fits.' },
      { q: '100 bytes are free in four pieces of 25. A request needs a 40-byte block. This is…', options: ['external fragmentation', 'internal fragmentation', 'a leak', 'thrashing'], answer: 0, why: 'Enough memory is free, but not in one piece.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Four policies, one script
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'vmem-malloc-compare', family: 'p11-ualloc', order: 20, title: 'First fit against segregated lists',
    blurb: 'The same requests, four policies. First fit takes the lowest free block that fits; next fit carries on from where the last search stopped; best fit takes the smallest that fits; segregated lists keep one free list per size class and search from the request\'s class upward, so a small request never walks past big blocks. Watch how many blocks each one looks at, where it leaves its holes, and which one fails first.',
    inputs: [
      { id: 'heap', kind: 'choice', label: 'Heap', def: '256', options: ['128', '256', '512'].map((v) => ({ value: v, label: v + ' bytes' })) },
      opsInput(['a=40', 'b=8', 'c=60', 'd=8', 'e=40', '-a', '-c', 'f=8', 'g=50', 'h=30']),
    ],
    presets: [
      { label: 'Big holes and small requests', values: {} },
      { label: 'Best fit keeps the big hole', values: { ops: ['a=100', 'b=8', 'c=20', 'd=8', '-c', '-a', 'e=12', 'f=90'] } },
      { label: 'Next fit spreads out', values: { ops: ['a=20', 'b=20', 'c=20', '-a', 'd=10', 'e=10', 'f=10', 'g=10'] } },
      { label: 'A small heap fills up', values: { heap: '128', ops: ['a=30', 'b=10', 'c=30', '-a', 'd=8', 'e=36'] } },
    ],
    counters: [{ id: 'searched', label: 'blocks looked at' }],
    run(inp) {
      const heap = +inp.heap, ops = C().parseOps(inp.ops), nm = names(ops), keys = Object.keys(POL);
      const As = keys.map((p) => M().malloc({ heap, policy: p, tag: TAG })), tot = keys.map(() => 0), fails = keys.map(() => 0);
      const FR = new S.Frames(['searched']), view = H.box(0, 0, 790, 470), rowH = 112;
      const draw = (sts, acts) => {
        const items = [];
        keys.forEach((p, k) => {
          const y = 8 + k * rowH, A = As[k], s = A.stats();
          items.push(H.text('pn' + k, 4, y + 14, POL[p], 'strong', 14));
          items.push(H.text('pt' + k, 786, y + 14, 'searched ' + tot[k] + (fails[k] ? ' · failed ' + fails[k] : ''), fails[k] ? 'bad' : 'tick', 13, 'end'));
          items.push(...heapBar('h' + k, A.blocks(), heap, 8, y + 24, 756, 40, { names: nm, act: acts ? acts[k] : undefined, searched: sts ? sts[k].searched : null, small: true }).items);
          items.push(H.text('ps' + k, 4, y + 102, 'free ' + s.free + ' B in ' + H.plural(A.blocks().filter((b) => b.free).length, 'hole') + ', largest ' + s.largest + ' B', 'tick', 12));
        });
        return items;
      };
      FR.add({ items: draw(null, null), say: `Four empty heaps of ${heap} bytes, one a policy, and the same ${H.plural(ops.length, 'request')} for each.`, meta: { phase: 'start', heap, n: ops.length }, view, hl: { d: [0] } });
      ops.forEach((o) => {
        const sts = As.map((A) => (o.op === 'alloc' ? A.malloc(o.id, o.n) : A.blocks().some((b) => b.id === o.id) ? A.free(o.id) : { kind: 'skip', start: -1, size: 0, merges: [] }));
        sts.forEach((st, k) => { if (st.kind === 'malloc' || st.kind === 'fail') tot[k] += st.searched.length; if (st.kind === 'fail') fails[k]++; });
        FR.set('searched', tot.reduce((a, b) => a + b, 0));
        const acts = sts.map((st) => (st.kind === 'fail' || st.kind === 'skip' ? undefined : st.start));
        let say;
        if (o.op === 'alloc') {
          const need = sts[0].size;
          say = `malloc(${o.n}) for ${o.id} needs a block of ${need}: ` + keys.map((p, k) => POL[p] + ' ' + (sts[k].kind === 'fail' ? 'fails' : 'takes ' + sts[k].start) + ' (' + sts[k].searched.length + ' looked at)').join(', ') + '.';
        } else say = `free(${o.id}): ` + keys.map((p, k) => POL[p] + ' ' + (sts[k].kind === 'skip' ? 'never placed it' : sts[k].merges.length ? 'merges into ' + sts[k].size + ' at ' + sts[k].start : 'leaves ' + sts[k].size + ' at ' + sts[k].start)).join('; ') + '.';
        FR.add({ items: draw(sts, acts), say, meta: { phase: o.op === 'alloc' ? 'malloc' : 'free', id: o.id, request: o.n || 0, need: sts[0].size, starts: sts.map((s) => (s.kind === 'fail' ? -1 : s.start)), sizes: sts.map((s) => s.size), searched: sts.map((s) => (s.searched || []).length), failed: sts.map((s) => s.kind === 'fail'), totals: tot.slice() }, view, hl: { d: [1] } });
      });
      const ss = As.map((A) => A.stats());
      FR.add({ items: draw(null, null), say: 'Totals: ' + keys.map((p, k) => POL[p] + ' looked at ' + tot[k] + ' blocks' + (fails[k] ? ' and failed ' + fails[k] + (fails[k] === 1 ? ' time' : ' times') : '') + ', ' + H.pct(ss[k].external) + ' of its free space outside its largest hole').join('; ') + '.', meta: { phase: 'end', totals: tot.slice(), fails: fails.slice(), external: ss.map((s) => s.external), free: ss.map((s) => s.free), largest: ss.map((s) => s.largest) }, view, hl: { d: [0, 1, 2, 3] } });
      return { frames: FR.list, def: H.def('Four ways to choose', ['first: lowest address that fits', 'next: first fit from where the last search stopped', 'best: the smallest that fits (looks at all)', 'segregated: a list per size class, from the request\'s class up']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'malloc' && new Set(fr[i + 1].meta.starts).size > 1, once: true, pick: 'option', ask: (fr, i) => `malloc(${fr[i + 1].meta.request}) comes next. Which policy looks at the fewest free blocks?`, options: Object.values(POL), answer: (fr, i) => { const s = fr[i + 1].meta.searched, m = Math.min(...s); return s.filter((x) => x === m).length > 1 ? null : Object.values(POL)[s.indexOf(m)]; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Free blocks of 64, 16 and 32 bytes, in that address order. A request needs 16. First fit takes…', options: ['the 64', 'the 16', 'the 32', 'none'], answer: 0, why: 'It is the first that fits.' },
      { q: 'Same blocks, best fit?', options: ['the 16', 'the 64', 'the 32', 'it splits the 32'], answer: 0, why: 'The smallest block that fits is an exact fit.' },
      { q: 'Segregated lists make a small request fast because…', options: ['it starts in its own size class, skipping the big blocks', 'they never split', 'they need no tags', 'they sort by address'], answer: 0, why: 'Only blocks of a suitable size are looked at.' },
      { q: 'Next fit tends to…', options: ['spread allocations through the heap', 'pack everything at the start', 'always find the best block', 'never fail'], answer: 0, why: 'It resumes where it left off rather than at the bottom.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
