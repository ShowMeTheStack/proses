// Part 11, kernel allocators. The buddy system: the arena drawn as one row a block size, each block where it lies,
// split on the way down and joined with its buddy on the way up, with the free list of every size beside its row.
// Slabs: caches of one object size, each slab of the cache on the full, partial or empty list.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;

  /** "A=70" -> {op: 'alloc', id, n};  "-A" -> {op: 'free', id};  "shrink" */
  const parseOps = (xs) => xs.map((x) => {
    let m = /^([A-Za-z][A-Za-z0-9]{0,3})=(\d+)$/.exec(x);
    if (m) return { op: 'alloc', id: m[1], n: +m[2] };
    m = /^-([A-Za-z][A-Za-z0-9]{0,3})$/.exec(x);
    if (m) return { op: 'free', id: m[1] };
    if (x === 'shrink') return { op: 'shrink' };
    return null;
  });
  /** a script is legal: each name allocated once while live, freed only while live */
  const scriptCheck = (ops, raw, label) => {
    const live = new Set();
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (!o) return label + ': "' + raw[k] + '" is not name=size or -name';
      if (o.op === 'alloc') { if (live.has(o.id)) return label + ': ' + o.id + ' is allocated twice without a free'; if (o.n < 1) return label + ': ' + o.id + ' asks for nothing'; live.add(o.id); }
      if (o.op === 'free') { if (!live.has(o.id)) return label + ': -' + o.id + ' frees something not allocated'; live.delete(o.id); }
    }
    return null;
  };
  S.P11C = { parseOps, scriptCheck };
  const ids = (ops) => [...new Set(ops.filter((o) => o && o.id).map((o) => o.id))];

  // ---------------------------------------------------------------------------------------------------------------
  // The buddy system
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'vmem-buddy', family: 'p11-kalloc', order: 10, title: 'The buddy system',
    blurb: 'The kernel hands out physically contiguous memory in blocks whose sizes are powers of two. A request is rounded up to the next power of two; if no block of that size is free, a larger one is split in halves, again and again, each unused half going on the free list of its size. The two halves of a split are buddies: a block\'s buddy is at its offset XOR its size. When a block is freed and its buddy is free too, they join, and the join can cascade upward. Fast, and coalescing is cheap, but the rounding wastes memory inside the blocks.',
    inputs: [
      { id: 'size', kind: 'choice', label: 'Arena (KiB)', def: '1024', options: ['256', '512', '1024', '2048'].map((v) => ({ value: v, label: v + ' KiB' })) },
      { id: 'min', kind: 'choice', label: 'Smallest block (KiB)', def: '32', options: ['16', '32', '64'].map((v) => ({ value: v, label: v + ' KiB' })) },
      { id: 'ops', kind: 'list', label: 'Requests (P=70, -P frees)', def: ['P=70', 'Q=35', 'R=80', '-P', 'S=60', '-Q', '-S', '-R'], min: 1, max: 14, check: (v) => scriptCheck(parseOps(v), v, 'Requests') },
    ],
    check(inp) { if (+inp.min * 64 < +inp.size) return 'Smallest block: at most 6 sizes fit the picture; choose a larger smallest block'; return null; },
    presets: [
      { label: 'Four requests and their frees', values: {} },
      { label: 'A cascade of joins', values: { size: '512', min: '32', ops: ['P=30', 'Q=30', 'R=60', 'S=120', '-P', '-Q', '-R', '-S'] } },
      { label: 'Buddies that cannot join', values: { size: '512', min: '32', ops: ['P=64', 'Q=64', 'R=64', 'S=64', '-Q', '-R'] } },
      { label: 'Just over a power of two: waste', values: { size: '1024', min: '32', ops: ['P=130', 'Q=260', 'R=70', 'S=40'] } },
      { label: 'Failure with memory free', values: { size: '256', min: '16', ops: ['P=60', 'Q=60', 'R=60', '-P', '-R', 'S=100'] } },
    ],
    counters: [{ id: 'blocks', label: 'blocks allocated' }, { id: 'waste', label: 'KiB wasted inside' }],
    run(inp) {
      const size = +inp.size, min = +inp.min, ops = parseOps(inp.ops), B = M().buddy({ size, minBlock: min });
      const levels = M().log2(size / min) + 1, FR = new S.Frames(['blocks', 'waste']), view = H.box(0, 0, 800, 470);
      const X0 = 70, W = 610, rowH = Math.min(62, Math.floor(330 / levels)), y0 = 56, names = ids(ops);
      const lvlOf = (s) => M().log2(size / s);
      const res = [];
      let curOp = -1;
      const draw = (st, actKey, note) => {
        const items = [H.text('hdr', 4, 22, size + ' KiB arena, blocks of ' + min + ' to ' + size + ' KiB', 'p10-sum', 15)];
        items.push(H.text('hs', X0 - 10, y0 - 12, 'block', 'tick', 12, 'end'), H.text('hf', 796, y0 - 12, 'free list', 'tick', 12, 'end'));
        for (let L = 0; L < levels; L++) {
          const s = size >> L, y = y0 + L * rowH;
          items.push(H.text('rs' + L, X0 - 10, y + rowH / 2 + 4, s + ' KiB', 'tick mono', 12, 'end'));
          const fl = (st.freeLists[s] || []);
          items.push(H.text('fl' + L, 796, y + rowH / 2 + 4, fl.length ? (fl.length > 2 ? fl.slice(0, 2).join(', ') + ' …' : fl.join(', ')) : '—', fl.length ? 'mono' : 'tick', 12, 'end'));
        }
        const walk = (n) => {
          const L = lvlOf(n.size), y = y0 + L * rowH + 3, x = X0 + (n.offset / size) * W, w = (n.size / size) * W, key = 'n' + n.offset + '_' + n.size;
          const j = n.id ? names.indexOf(n.id) : -1;
          const cls = 'bd ' + (n.state === 'used' ? 'used p10-run ' + H.pc(j) : n.state) + (key === actKey ? ' act' : '');
          const room = (t) => t && S.geom.textWidth(t, 12, { mono: true }) + 8 < w;
          const labs = n.state === 'used' ? [n.id + ' ' + n.request, n.id] : n.state === 'free' ? ['free', ''] : [''];
          items.push(H.cell(key, x + 1, y, w - 2, rowH - 6, labs.find(room) || '', cls, 12, { rx: 2 }));
          if (n.state === 'used' && n.request < n.size) { const ww = ((n.size - n.request) / size) * W; items.push(H.cell(key + 'w', x + w - 1 - ww, y + rowH - 12, Math.max(1, ww - 1), 5, '', 'bd waste', 12, { rx: 0, audit: 'overlap-ok' })); }
          for (const c of n.children || []) walk(c);
        };
        walk(st.tree);
        const yb = y0 + levels * rowH + 26;
        items.push(H.text('note', 4, yb, note || '', 'p10-sum' + (st.kind === 'fail' ? ' bad' : ''), 14));
        const al = B.allocated(), used = al.reduce((a, u) => a + u.size, 0), asked = al.reduce((a, u) => a + u.request, 0);
        // the request list: what each request got, the current one lit, the ones to come dimmed
        items.push(H.text('rqt', 4, yb + 58, 'requests', 'title'));
        ops.forEach((o, k) => {
          const txt = res[k] || (o.op === 'alloc' ? o.id + ' = ' + o.n : 'free ' + o.id), cw = 97, x = 4 + (k % 8) * (cw + 2), y = yb + 68 + Math.floor(k / 8) * 34;
          items.push(H.cell('rq' + k, x, y, cw, 28, txt, 'mb-ord' + (k === curOp ? ' act' : k > curOp ? ' dim' : '') + (res[k] && /✗/.test(res[k]) ? ' hot' : ''), 12, { rx: 3 }));
        });
        items.push(H.text('stat', 4, yb + 26, al.length ? 'in use: ' + used + ' KiB in ' + H.plural(al.length, 'block') + ' for ' + asked + ' KiB asked, ' + (used - asked) + ' KiB wasted inside' : 'nothing allocated', 'tick', 13));
        return { items, used, asked, n: al.length };
      };
      const st0 = { tree: B.tree(), freeLists: B.freeLists(), kind: 'start' };
      FR.add({ items: draw(st0, null, 'one free block of ' + size + ' KiB').items, say: `The arena is one free block of ${size} KiB. Blocks come in ${levels} sizes, from ${size} down to ${min} KiB; each row holds the blocks of one size, and the free list of that size is at its right.`, meta: { phase: 'start', size, min, levels }, view, hl: { d: [0] } });
      ops.forEach((o, k) => {
        curOp = k;
        if (o.op === 'free' && !B.allocated().some((u) => u.id === o.id)) {
          res[k] = 'free ' + o.id + ': –';
          const st = { tree: B.tree(), freeLists: B.freeLists(), kind: 'skip' };
          FR.add({ items: draw(st, null, '-' + o.id + ': nothing to free').items, say: `${o.id} was never placed, so freeing it does nothing.`, meta: { phase: 'skip', id: o.id }, view, hl: { d: [] } });
          return;
        }
        const st = o.op === 'alloc' ? B.alloc(o.id, o.n) : B.free(o.id);
        res[k] = st.kind === 'alloc' ? o.id + ' ' + st.blockSize + ' @' + st.offset : st.kind === 'free' ? 'free ' + o.id : o.id + ' = ' + o.n + ' ✗';
        const key = st.kind === 'fail' ? null : st.kind === 'alloc' ? 'n' + st.offset + '_' + st.blockSize : (() => { const m = st.merges[st.merges.length - 1]; return m ? 'n' + m.offset + '_' + 2 * m.size : 'n' + st.offset + '_' + st.blockSize; })();
        const d = draw(st, key, st.kind === 'alloc' ? o.id + ': ' + st.request + ' → ' + st.blockSize + ' KiB at ' + st.offset : st.kind === 'free' ? 'free ' + o.id + (st.merges.length ? ': joined up to ' + 2 * st.merges[st.merges.length - 1].size + ' KiB' : '') : o.id + ' cannot be placed');
        FR.set('blocks', d.n).set('waste', d.used - d.asked);
        const meta = { phase: st.kind, id: o.id, request: st.request, block: st.blockSize, offset: st.offset, splits: (st.splits || []).length, merges: (st.merges || []).map((m) => [m.size, m.offset, m.buddy, 2 * m.size]), internal: st.internal, buddy: st.kind === 'free' ? st.offset ^ st.blockSize : null, used: d.used, asked: d.asked, inUse: d.n, free: size - d.used, splitSizes: (st.splits || []).map((x) => x.size) };
        let say = st.say.replace(/(\d+) bytes/g, '$1 KiB').replace(/of (\d+)([:;, .])/g, 'of $1 KiB$2').replace(/ (\d+) at (\d+)/g, ' $1 KiB at $2');
        if (st.kind === 'fail') say += ` ${size - d.used} KiB are free, but not as one block of that size.`;
        FR.add({ items: d.items, say, meta, view, hl: { d: st.kind === 'alloc' ? [0, 1] : st.kind === 'free' ? [2, 3] : [0] } });
      });
      const last = FR.last().meta;
      curOp = ops.length;
      const st = { tree: B.tree(), freeLists: B.freeLists(), kind: 'end' };
      const d = draw(st, null, 'after ' + H.plural(ops.length, 'request'));
      FR.add({ items: d.items, say: d.n ? `${H.plural(d.n, 'block')} still in use hold ${d.used} KiB for ${d.asked} KiB asked: ${d.used - d.asked} KiB, ${H.pct((d.used - d.asked) / d.used)}, lost to rounding up to powers of two.` : `Everything is freed, and the joins have rebuilt the single free block of ${size} KiB.`, meta: { phase: 'end', inUse: d.n, used: d.used, asked: d.asked, waste: d.used - d.asked, frac: d.used ? (d.used - d.asked) / d.used : 0, size, prev: last.phase }, view, hl: { d: [1] } });
      return { frames: FR.list, def: H.def('Buddy system', ['block = the next power of two ≥ the request', 'none free: split a larger block in halves', 'buddy of a block at offset o, size s: o XOR s', 'free: join with the buddy while it is free', 'waste: block − request (internal fragmentation)']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'alloc', once: true, pick: 'option', ask: (fr, i) => `${fr[i + 1].meta.id} asks for ${fr[i + 1].meta.request} KiB. What size of block will it get?`, options: (fr, i) => { const b = fr[i + 1].meta.block; return [b / 2, b, b * 2].filter((x) => x >= 1).map((x) => x + ' KiB'); }, answer: (fr, i) => fr[i + 1].meta.block + ' KiB', explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'free', once: true, pick: 'option', ask: (fr, i) => `${fr[i + 1].meta.id} is freed. Will it join with its buddy?`, options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.merges.length ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A request for 33 KiB in a buddy system with 32 KiB as the smallest block gets…', options: ['a 64 KiB block', 'a 33 KiB block', 'a 32 KiB block', 'two 32 KiB blocks'], answer: 0, why: '64 is the next power of two at or above 33; 31 KiB of it is wasted.' },
      { q: 'The buddy of the 64 KiB block at offset 192 is at…', options: ['128', '256', '64', '0'], answer: 0, why: '192 XOR 64 = 128.' },
      { q: 'Two adjacent free blocks of 64 KiB at offsets 64 and 128. Do they join?', options: ['no: they are not buddies', 'yes: they are next to each other', 'yes, into 128 KiB at 64', 'only if the arena is full'], answer: 0, why: 'The buddy of 64 is 0 and the buddy of 128 is 192; joining them would make a block that does not start on a 128 KiB boundary.' },
      { q: 'The main weakness of the buddy system is…', options: ['internal fragmentation from rounding up', 'slow coalescing', 'it cannot split', 'it needs a hash table'], answer: 0, why: 'A request just over a power of two wastes nearly half its block.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Slabs
  // ---------------------------------------------------------------------------------------------------------------
  const CN = ['inode', 'task'];
  const parseSlabOps = (xs) => xs.map((x) => {
    if (x === 'shrink') return { op: 'shrink' };
    let m = /^(inode|task):([a-z][a-z0-9]{0,2})$/.exec(x);
    if (m) return { op: 'alloc', cache: m[1], id: m[2] };
    m = /^-([a-z][a-z0-9]{0,2})$/.exec(x);
    if (m) return { op: 'free', id: m[1] };
    return null;
  });
  S.topic({
    id: 'vmem-slab', family: 'p11-kalloc', order: 20, title: 'Slab caches',
    blurb: 'The kernel allocates the same few kinds of object over and over: inodes, task structures, buffers. A slab allocator keeps a cache for each kind. A cache owns slabs, each one or more pages cut into objects of exactly that size, and keeps its slabs on three lists: full, partial and empty. An allocation takes a free object from a partial slab if there is one, else from an empty slab, and only then grows the cache by a new slab. Freed objects stay in their slab, ready for the next request; empty slabs go back to the page allocator only when memory runs short. No rounding waste, and allocation is fast.',
    inputs: [
      { id: 'inode', kind: 'choice', label: 'inode size', def: '256', options: ['128', '256', '512'].map((v) => ({ value: v, label: v + ' B' })) },
      { id: 'task', kind: 'choice', label: 'task size', def: '512', options: ['256', '512', '1024'].map((v) => ({ value: v, label: v + ' B' })) },
      { id: 'slab', kind: 'choice', label: 'Slab size', def: '1024', options: ['1024', '2048'].map((v) => ({ value: v, label: v + ' B' })) },
      { id: 'ops', kind: 'list', label: 'Operations (inode:a, task:t, -a, shrink)', def: ['inode:a', 'inode:b', 'task:t', 'inode:c', 'inode:d', 'inode:e', 'task:u', '-b', '-t', '-u', 'inode:f', 'shrink'], min: 1, max: 16, check: (v) => {
        const ops = parseSlabOps(v), live = new Set();
        for (let k = 0; k < ops.length; k++) { const o = ops[k]; if (!o) return 'Operations: "' + v[k] + '" is not inode:name, task:name, -name or shrink'; if (o.op === 'alloc') { if (live.has(o.id)) return 'Operations: ' + o.id + ' is allocated twice'; live.add(o.id); } if (o.op === 'free') { if (!live.has(o.id)) return 'Operations: -' + o.id + ' frees something not allocated'; live.delete(o.id); } }
        return null;
      } },
    ],
    check(inp) { for (const c of CN) { const per = +inp.slab / +inp[c]; if (per > 8) return c + ' size: at most 8 objects a slab fit the picture (' + per + ' here)'; } return null; },
    presets: [
      { label: 'Two caches, a grow, frees and a shrink', values: {} },
      { label: 'Filling one slab, then a second', values: { ops: ['inode:a', 'inode:b', 'inode:c', 'inode:d', 'inode:e', '-a', 'inode:f'] } },
      { label: 'Big slabs of small inodes', values: { inode: '256', task: '1024', slab: '2048', ops: ['inode:a', 'inode:b', 'task:t', 'task:u', 'task:v', '-u', '-t', 'shrink', 'task:w'] } },
      { label: 'Freeing everything, then shrinking', values: { ops: ['task:a', 'task:b', 'task:c', '-a', '-b', '-c', 'shrink'] } },
    ],
    counters: [{ id: 'slabs', label: 'slabs' }, { id: 'objs', label: 'objects in use' }],
    run(inp) {
      const slabBytes = +inp.slab, A = M().slab({ caches: CN.map((n) => ({ name: n, objSize: +inp[n] })), slabBytes }), ops = parseSlabOps(inp.ops);
      const FR = new S.Frames(['slabs', 'objs']), view = H.box(0, 0, 790, 470), names = [...new Set(ops.filter((o) => o.id).map((o) => o.id))];
      const LISTS = ['full', 'partial', 'empty'], colW = 256, panH = 200;
      const draw = (snap, act) => {
        const items = [];
        snap.caches.forEach((c, ci) => {
          const y0 = 8 + ci * (panH + 26);
          items.push(H.text('ct' + ci, 4, y0 + 14, c.name + ' cache: ' + c.objSize + ' B objects, ' + c.perSlab + ' a slab of ' + slabBytes + ' B', 'strong', 14));
          LISTS.forEach((L, li) => {
            const x = 4 + li * (colW + 8), list = c.slabs.filter((s) => s.list === L);
            items.push(H.text('lh' + ci + L, x, y0 + 40, L + ' (' + list.length + ')', 'tick', 13));
            list.slice(0, 3).forEach((sl, k) => {
              const sy = y0 + 50 + k * 48, isAct = act && act.slab === sl.id && act.cache === c.name;
              items.push({ key: 'sl' + sl.id, kind: 'region', x, y: sy, w: colW - 8, h: 42, rx: 5, text: '', cls: 'slab ' + L + (isAct ? ' act' : ''), layer: 'back', audit: 'group' });
              items.push(H.text('sll' + sl.id, x + 8, sy + 26, 'slab ' + sl.id, 'tick', 12));
              const ow = Math.min(24, Math.floor((colW - 74) / c.perSlab));
              sl.objs.forEach((o, j) => items.push(H.cell('o' + sl.id + '_' + j, x + 58 + j * (ow + 1), sy + 9, ow, 24, o === null ? '' : o, 'sobj' + (o === null ? '' : ' used') + (isAct && act.slot === j ? (act.kind === 'free' ? ' hot' : ' act') : ''), 12, { rx: 2 })));
            });
            if (list.length > 3) items.push(H.text('more' + ci + L, x, y0 + 50 + 3 * 48 + 12, '+ ' + (list.length - 3) + ' more', 'tick', 12));
          });
        });
        return items;
      };
      const count = (snap) => ({ slabs: snap.caches.reduce((a, c) => a + c.slabs.length, 0), objs: snap.caches.reduce((a, c) => a + c.slabs.reduce((b, s) => b + s.objs.filter((o) => o !== null).length, 0), 0) });
      const s0 = A.snapshot();
      FR.add({ items: draw(s0), say: `Two caches, each still without a slab: inode objects of ${inp.inode} B, ${s0.caches[0].perSlab} to a slab of ${slabBytes} B, and task objects of ${inp.task} B, ${s0.caches[1].perSlab} to a slab.`, meta: { phase: 'start', per: s0.caches.map((c) => c.perSlab), sizes: [+inp.inode, +inp.task], slab: slabBytes }, view, hl: { d: [0] } });
      ops.forEach((o) => {
        const st = o.op === 'alloc' ? A.alloc(o.cache, o.id) : o.op === 'free' ? A.free(o.id) : A.shrink();
        const c = count(st.snapshot);
        FR.set('slabs', c.slabs).set('objs', c.objs);
        const cache = st.cache ? st.snapshot.caches.find((x) => x.name === st.cache) : null;
        FR.add({ items: draw(st.snapshot, st), say: st.say.replace('(1 objects of', '(1 object of'), meta: { phase: st.kind, cache: st.cache || '', id: st.id || '', slab: st.slab, slot: st.slot, moved: st.moved || '', freed: st.freed || [], slabs: c.slabs, objs: c.objs, per: cache ? cache.perSlab : 0, objSize: cache ? cache.objSize : 0, slabBytes, lists: cache ? [cache.full.length, cache.partial.length, cache.empty.length] : [] }, view, hl: { d: st.kind === 'grow' ? [3] : st.kind === 'shrink' ? [4] : st.kind === 'free' ? [2] : [1] } });
      });
      const c = count(A.snapshot());
      FR.add({ items: draw(A.snapshot()), say: `At the end: ${H.plural(c.slabs, 'slab')} holding ${H.plural(c.objs, 'object')}. Each object sits in a slot of exactly its size, so nothing is lost to rounding; what a cache keeps unused is whole free slots, ready for the next object of its kind.`, meta: { phase: 'end', slabs: c.slabs, objs: c.objs }, view, hl: { d: [0] } });
      void names;
      return { frames: FR.list, def: H.def('Slab allocator', ['a cache per object type; slabs of equal objects', 'alloc: a partial slab, else an empty one', 'free: the object returns to its slab', 'no free object: the cache grows a slab', 'memory short: empty slabs return their pages']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && ['alloc', 'grow'].includes(fr[i + 1].meta.phase) && i > 0, once: true, pick: 'option', ask: (fr, i) => `Object ${fr[i + 1].meta.id} comes next, from the ${fr[i + 1].meta.cache} cache. Does the cache have to grow a new slab?`, options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.phase === 'grow' ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A slab of 4096 bytes in a cache of 512-byte objects holds…', options: ['8 objects', '4 objects', '512 objects', '1 object'], answer: 0, why: '4096 / 512 = 8.' },
      { q: 'Where does an allocation look first?', options: ['a partial slab', 'an empty slab', 'the buddy allocator', 'a full slab'], answer: 0, why: 'Filling partial slabs keeps empty ones free to be returned.' },
      { q: 'An object is freed and its slab becomes empty. The slab…', options: ['moves to the empty list and stays with the cache', 'is returned to the page allocator at once', 'is destroyed with its neighbours', 'becomes full'], answer: 0, why: 'Empty slabs are given back only when memory is short.' },
      { q: 'Why is there no internal fragmentation inside a slab\'s objects?', options: ['every slot is exactly the size of the object type', 'slabs are powers of two', 'objects are compressed', 'the TLB maps each object'], answer: 0, why: 'A cache serves one size only; the only slack is a remainder at the end of a slab.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
