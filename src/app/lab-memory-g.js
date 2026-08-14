// The Memory lab, part seven: the allocation pictures. Contiguous and segmented memory as one bar drawn to scale with
// its holes listed and the external fragmentation worked out (segmentation adds each process's segment table); the
// buddy arena as a row a block size, split blocks above the ones they became; slab caches as slabs of object slots,
// each on its full, partial or empty list; a malloc heap as tagged blocks with its free list or size classes.
//   ML.allocRun(v, ctx) -> {frames, trace, tables, metrics}
(function (S) {
  'use strict';
  const ML = S.MemLab, D = ML.D;
  const M = () => S.Mem, P10 = () => S.Kit.p10, T11 = () => S.Kit.p11;
  const pc = (k) => 'p' + (((k % 6) + 6) % 6);
  const pct = (x) => Math.round(x * 100) + '%';

  /** the operations as a row of chips: done, the current one lit, a refused one marked */
  function opChips(items, run, cur, x, y, W) {
    const cw = 78, per = Math.max(1, Math.floor((W + 6) / (cw + 6)));
    items.push(D.text('op:t', x, y, 'operations', 'title'));
    run.ops.forEach((o, k) => {
      const res = run.steps.filter((s) => s.k === k), done = k < cur || (k === cur);
      const bad = done && res.some((s) => s.st.kind === 'fail' || s.st.kind === 'skip');
      const cls = 'mb-ord' + (k === cur ? ' act' : bad ? ' hot' : done ? '' : ' none');
      items.push(D.cell('op:' + k, x + (k % per) * (cw + 6), y + 12 + Math.floor(k / per) * 34, cw, 28, o.text, cls, 12));
    });
    return 12 + Math.ceil(run.ops.length / per) * 34;
  }

  function holeChips(items, holes, act, x, y, w, unit) {
    items.push(D.text('hl:t', x, y, 'holes, by address (start · size)', 'title'));
    const cw = 118, per = Math.max(1, Math.floor((w + 6) / (cw + 6)));
    holes.slice(0, per * 2).forEach((h, k) => items.push(D.cell('hl:' + h.start, x + (k % per) * (cw + 6), y + 12 + Math.floor(k / per) * 34, cw, 28, h.start + ' · ' + h.size + unit, 'mb-ord' + (act === h.start ? ' act' : ''), 12)));
    if (!holes.length) items.push(D.text('hl:none', x, y + 32, 'none: memory is full', 'tick', 13));
    return 12 + Math.max(1, Math.ceil(Math.min(holes.length, per * 2) / per)) * 34;
  }

  function fragPanel(items, f, x, y, w, unit) {
    items.push(D.text('fr:t', x, y, 'external fragmentation', 'title'));
    items.push(D.text('fr:a', x, y + 26, 'free ' + f.free + unit + ' in ' + f.holes + ' hole' + (f.holes === 1 ? '' : 's') + ', the largest ' + f.largest + unit, 'tick', 13));
    items.push(D.text('fr:b', x, y + 50, f.free ? '1 − ' + f.largest + ' / ' + f.free + ' = ' + pct(f.external) : 'nothing free', 'mono strong' + (f.external > 0.3 ? ' bad' : ''), 14));
    const bw = w, k = f.free ? bw / f.free : 0;
    items.push(D.cell('fr:free', x, y + 62, Math.max(2, bw), 14, '', 'p11-bar soft', 12, { rx: 2 }));
    items.push(D.cell('fr:big', x, y + 62, Math.max(2, Math.round(f.largest * k)), 14, '', 'p11-bar best', 12, { rx: 2, audit: 'overlap-ok' }));
    return 80;
  }

  function contigItems(run, i, v, narrow) {
    const s = run.steps[i] || { st: { kind: 'start' }, snap: run.start, k: -1 }, st = s.st, snap = s.snap, W = narrow ? 380 : 1000, items = [], seg = run.kind === 'seg';
    const procIdx = (id) => run.names.indexOf(seg ? id.split('.')[0] : id);
    items.push(D.text('hd', 0, 14, (seg ? 'segmentation, ' : '') + ({ first: 'first', best: 'best', worst: 'worst', next: 'next' })[v.fit] + ' fit · ' + v.memK + ' KiB · kernel ' + v.osK + ' KiB', 'strong', 14));
    const moved = new Set((st.moved || []).map((m) => m.id).concat(st.compacted ? st.compacted.moved.map((m) => m.id) : []));
    const runs = [];
    if (v.osK) runs.push({ key: 'os', start: 0, size: v.osK, cls: 'os', text: 'kernel', sub: v.osK + 'K' });
    for (const b of snap.blocks) runs.push({ key: 'b:' + ML.h(b.id), start: b.start, size: b.size, cls: pc(procIdx(b.id)) + (b.id === st.id && st.kind === 'alloc' ? ' act' : moved.has(b.id) ? ' act' : ''), text: seg ? b.id : b.id, sub: b.size + 'K' });
    const big = snap.holes.reduce((a, h) => (h.size > (a ? a.size : -1) ? h : a), null);
    for (const h of snap.holes) runs.push({ key: 'h:' + h.start, start: h.start, size: h.size, cls: 'free' + ((st.kind === 'free' && st.hole && st.hole.start === h.start) ? ' act' : st.kind === 'fail' && big && big.start === h.start ? ' hot' : ''), text: String(h.size), sub: 'free' });
    const ticks = [0, v.memK].concat(snap.blocks.flatMap((b) => [b.start, b.start + b.size]), v.osK ? [v.osK] : []);
    const bar = P10().hbar({ prefix: 'mm', x: 0, y: 40, w: W, h: 64, total: v.memK, runs, ticks, tickSide: 'below', minGap: 10, size: 13 });
    items.push(...bar.items);
    let y = 160;
    if (!narrow) {
      holeChips(items, snap.holes, st.kind === 'free' && st.hole ? st.hole.start : null, 0, y, 560, 'K');
      fragPanel(items, snap.frag, 620, y, 380, ' KiB');
      y += 100;
    } else {
      y += holeChips(items, snap.holes, st.kind === 'free' && st.hole ? st.hole.start : null, 0, y, W, 'K') + 18;
      fragPanel(items, snap.frag, 0, y, W, ' KiB');
      y += 100;
    }
    if (seg) {
      // each process's segment table: the segments it has in memory, base and limit
      const procs = run.names, tw = narrow ? W : Math.min(240, Math.floor((W - 20 * (procs.length - 1)) / Math.max(1, procs.length)));
      let tx = 0, ty = y + 14, rowMax = 0;
      procs.forEach((p, k) => {
        const segs = snap.blocks.filter((b) => b.id.split('.')[0] === p);
        if (narrow && k > 0) { ty += rowMax + 34; rowMax = 0; tx = 0; }
        const t = T11().table({ prefix: 'sg' + k, x: tx, y: ty, title: p + '’s segment table', cols: [{ name: 'segment', w: Math.round(tw * 0.4), cls: 'name' }, { name: 'base', w: Math.round(tw * 0.3) }, { name: 'limit', w: tw - Math.round(tw * 0.4) - Math.round(tw * 0.3) }],
          rows: segs.length ? segs.map((b) => ({ key: ML.h(b.id), cells: [b.id.split('.')[1], String(b.start), String(b.size)], cls: b.id === st.id || moved.has(b.id) ? 'act' : '' })) : [{ key: 'none', cells: ['none', '–', '–'], cls: 'dim' }], rowH: 26, size: 12 });
        items.push(...t.items);
        items.push(D.cell('sg' + k + ':sw', tx + tw - 14, ty - 22, 14, 14, '', 'p10-run ' + pc(k), 12, { rx: 2 }));
        rowMax = Math.max(rowMax, t.h);
        tx += tw + 20;
      });
      y = ty + rowMax + 30;
    }
    opChips(items, run, s.k, 0, y, W);
    return items;
  }

  function buddyItems(run, i, v, narrow) {
    const s = run.steps[i] || { st: { kind: 'start' }, snap: run.start, k: -1 }, st = s.st, snap = s.snap, W = narrow ? 380 : 1000, items = [];
    const size = v.arena, min = v.minBlock, levels = M().log2(size / min) + 1;
    const X0 = narrow ? 52 : 80, BW = narrow ? W - X0 : 720, rowH = Math.min(44, Math.floor((narrow ? 300 : 300) / levels)), y0 = 40;
    items.push(D.text('hd', 0, 14, 'buddy system · ' + size + ' KiB arena · blocks of ' + min + ' to ' + size + ' KiB', 'strong', 14));
    if (!narrow) items.push(D.text('flh', W, y0 - 10, 'free list', 'tick', 12, 'end'));
    const actKey = st.kind === 'alloc' ? 'n' + st.offset + '_' + st.blockSize : st.kind === 'free' ? (st.merges && st.merges.length ? 'n' + st.merges[st.merges.length - 1].offset + '_' + 2 * st.merges[st.merges.length - 1].size : 'n' + st.offset + '_' + st.blockSize) : null;
    for (let L = 0; L < levels; L++) {
      const sz = size >> L, y = y0 + L * rowH;
      items.push(D.text('rs' + L, X0 - 8, y + rowH / 2 + 2, sz + 'K', 'tick mono', 12, 'end'));
      if (!narrow) { const fl = snap.freeLists[sz] || []; items.push(D.text('fl' + L, W, y + rowH / 2 + 2, fl.length ? (fl.length > 3 ? fl.slice(0, 3).join(', ') + ' …' : fl.join(', ')) : '—', fl.length ? 'mono strong' : 'tick', 12, 'end')); }
    }
    const walk = (n) => {
      const L = M().log2(size / n.size), y = y0 + L * rowH + 2, x = X0 + (n.offset / size) * BW, w = (n.size / size) * BW, key = 'n' + n.offset + '_' + n.size;
      const k = n.id ? run.names.indexOf(n.id) : -1;
      const room = (t) => t && S.geom.textWidth(t, 12, { mono: true }) + 8 < w;
      const labs = n.state === 'used' ? [n.id + ' ' + n.request, n.id] : n.state === 'free' ? ['free', ''] : [''];
      const cls = n.state === 'used' ? 'p10-run ' + pc(k) : n.state === 'free' ? 'p10-run free' : 'ml-split';
      items.push(D.cell(key, x + 1, y, Math.max(2, w - 2), rowH - 6, labs.find(room) || '', cls + (key === actKey ? ' act' : ''), 12, { rx: 2 }));
      if (n.state === 'used' && n.request < n.size) { const ww = ((n.size - n.request) / size) * BW; items.push(D.cell(key + 'w', x + w - 1 - ww, y + rowH - 12, Math.max(1, ww - 1), 5, '', 'p10-run waste', 12, { rx: 0, audit: 'overlap-ok' })); }
      for (const c of n.children || []) walk(c);
    };
    walk(snap.tree);
    const used = snap.allocated.reduce((a, u) => a + u.size, 0), asked = snap.allocated.reduce((a, u) => a + u.request, 0);
    let y = y0 + levels * rowH + 26;
    items.push(D.text('stat', 0, y, snap.allocated.length ? 'in use: ' + used + ' KiB in ' + snap.allocated.length + ' block' + (snap.allocated.length === 1 ? '' : 's') + ' for ' + asked + ' KiB asked; ' + (used - asked) + ' KiB lost inside blocks (red marks)' : 'nothing allocated: one free block', 'tick', 13));
    if (narrow) {
      y += 28;
      items.push(D.text('flt', 0, y, 'free lists', 'title'));
      for (let L = 0; L < levels; L++) { const sz = size >> L, fl = snap.freeLists[sz] || []; items.push(D.text('fl' + L, 0, y + 22 + L * 20, sz + 'K: ' + (fl.length ? fl.join(', ') : '—'), 'mono', 12)); }
      y += 22 + levels * 20;
    }
    opChips(items, run, s.k, 0, y + 26, W);
    return items;
  }

  function slabItems(run, i, v, narrow) {
    const s = run.steps[i] || { st: { kind: 'start' }, snap: run.start, k: -1 }, st = s.st, snap = s.snap, W = narrow ? 380 : 1000, items = [];
    items.push(D.text('hd', 0, 14, 'slab caches · slabs of ' + v.slabBytes + ' bytes', 'strong', 14));
    let y = 44;
    snap.caches.forEach((c, ci) => {
      const lx = 0, sx = narrow ? 0 : 280, cell = Math.min(40, Math.floor(((narrow ? W : 440) - 8) / c.perSlab)), sw = c.perSlab * cell + 8;
      items.push(D.text('cn' + ci, lx, y + 16, c.name + ' · ' + c.objSize + ' B', 'strong', 14));
      items.push(D.text('cs' + ci, lx, y + 36, c.perSlab + ' a slab · full ' + c.full.length + ', partial ' + c.partial.length + ', empty ' + c.empty.length, 'tick', 12));
      const per = Math.max(1, Math.floor((W - sx + 14) / (sw + 14)));
      const yy = narrow ? y + 50 : y;
      c.slabs.slice(0, per * 2).forEach((sl, j) => {
        const x = sx + (j % per) * (sw + 14), ys = yy + Math.floor(j / per) * 70;
        const act = st.slab === sl.id && (st.cache === c.name || st.kind === 'free');
        items.push({ key: 'sl' + sl.id, kind: 'region', x, y: ys, w: sw, h: 44, rx: 4, text: '', cls: 'ml-slab ' + sl.list, audit: 'group', layer: 'back' });
        sl.objs.forEach((o, q) => items.push(D.cell('so' + sl.id + '_' + q, x + 4 + q * cell, ys + 6, cell - 2, 32, o === null ? '' : o, o === null ? 'mb-ent nil' : 'p10-run ' + pc(ci) + (act && st.slot === q ? ' act' : ''), 12, { rx: 2 })));
        items.push(D.text('sll' + sl.id, x + sw / 2, ys + 60, 'slab ' + sl.id + ': ' + sl.list, 'tick ml-' + sl.list, 12, 'middle'));
      });
      if (!c.slabs.length) items.push(D.text('none' + ci, sx, yy + 26, 'no slabs yet', 'tick', 12));
      if (c.slabs.length > per * 2) items.push(D.text('more' + ci, W, yy + 150, '+ ' + (c.slabs.length - per * 2) + ' more slabs', 'tick', 12, 'end'));
      y = yy + Math.max(1, Math.min(2, Math.ceil(c.slabs.length / per))) * 70 + 16;
    });
    opChips(items, run, s.k, 0, y + 10, W);
    return items;
  }

  function mallocItems(run, i, v, narrow) {
    const s = run.steps[i] || { st: { kind: 'start' }, snap: run.start, k: -1 }, st = s.st, snap = s.snap, W = narrow ? 380 : 1000, items = [];
    items.push(D.text('hd', 0, 14, 'malloc · ' + v.heap + '-byte heap · ' + ({ first: 'first fit', next: 'next fit', best: 'best fit', segregated: 'segregated lists' })[v.mfit] + ' · 4-byte tags, 8-byte alignment', 'strong', 14));
    const searched = new Set(st.searched || []);
    const runs = [], k = W / v.heap;
    for (const b of snap.blocks) {
      const j = b.id ? run.names.indexOf(b.id) : -1;
      const cls = b.free ? 'free' + (searched.has(b.start) ? ' cand' : '') : pc(j) + ((st.kind === 'malloc' && b.id === st.id) ? ' act' : '');
      const merged = st.kind === 'free' && b.free && st.start !== undefined && b.start <= st.start && b.start + b.size > st.start;
      runs.push({ key: 'b' + b.start, start: b.start, size: b.size, cls: cls + (merged ? ' act' : ''), text: b.free ? String(b.size) : b.id, sub: b.free ? 'free' : b.request + ' of ' + b.size });
    }
    const bar = P10().hbar({ prefix: 'hp', x: 0, y: 40, w: W, h: 64, total: v.heap, runs, ticks: [0, v.heap].concat(snap.blocks.map((b) => b.start)), tickSide: 'below', minGap: 8, size: 13 });
    items.push(...bar.items);
    // the boundary tags at each end of every block, and the slack inside the used ones
    for (const b of snap.blocks) {
      const x0 = b.start * k, x1 = (b.start + b.size) * k, tw = Math.max(2, 4 * k);
      items.push(D.cell('tg' + b.start + 'h', x0, 40, tw, 64, '', 'ml-tag', 12, { rx: 0, audit: 'overlap-ok' }));
      items.push(D.cell('tg' + b.start + 'f', x1 - tw, 40, tw, 64, '', 'ml-tag', 12, { rx: 0, audit: 'overlap-ok' }));
      if (!b.free && b.size - 8 > b.request) items.push(D.cell('sk' + b.start, x0 + (4 + b.request) * k, 92, Math.max(1, (b.size - 8 - b.request) * k), 6, '', 'p10-run waste', 12, { rx: 0, audit: 'overlap-ok' }));
    }
    let y = 160;
    const lists = snap.freeLists, size = (st0) => (snap.blocks.find((b) => b.start === st0) || {}).size;
    items.push(D.text('fl:t', 0, y, v.mfit === 'segregated' ? 'free lists by size class (start · size)' : 'free list, by address (start · size)', 'title'));
    const keys = Object.keys(lists), cw = 92, per = Math.max(1, Math.floor((narrow ? W - 70 : 560) / (cw + 6)));
    keys.forEach((c, r) => {
      const ly = y + 12 + r * 34;
      const cls = Object.keys(lists).map(Number);
      if (v.mfit === 'segregated') items.push(D.text('fl:c' + c, 0, ly + 19, c + (r + 1 < keys.length ? '–' + (cls[r + 1] - 1) : '+'), 'tick mono', 12));
      const x0 = v.mfit === 'segregated' ? 70 : 0;
      lists[c].slice(0, per).forEach((st0, j) => items.push(D.cell('fl:' + c + '_' + st0, x0 + j * (cw + 6), ly, cw, 28, st0 + ' · ' + size(st0), 'mb-ord' + (searched.has(st0) ? ' act' : ''), 12)));
      if (!lists[c].length) items.push(D.text('fl:e' + c, x0, ly + 19, 'empty', 'tick', 12));
    });
    let yEnd = y + 12 + keys.length * 34;
    const sx = narrow ? 0 : 640, sy = narrow ? yEnd + 20 : y;
    const t = snap.stats;
    items.push(D.text('st:t', sx, sy, 'the heap now', 'title'));
    [['in blocks', t.used + ' B (' + t.payload + ' asked)'], ['lost inside', t.internal + ' B (tags, rounding)'], ['free', t.free + ' B, the largest ' + t.largest], ['external', t.free ? '1 − ' + t.largest + ' / ' + t.free + ' = ' + pct(t.external) : '–']].forEach(([a, b], j) => {
      items.push(D.text('st:a' + j, sx, sy + 26 + j * 22, a, 'tick', 13));
      items.push(D.text('st:b' + j, sx + 100, sy + 26 + j * 22, b, 'mono', 13));
    });
    if (narrow) yEnd = sy + 26 + 4 * 22;
    else yEnd = Math.max(yEnd, sy + 26 + 4 * 22);
    opChips(items, run, s.k, 0, yEnd + 28, W);
    return items;
  }

  ML.allocRun = function (v, ctx) {
    const run = ML.allocSteps(v), narrow = ctx.narrow;
    const draw = { contig: contigItems, seg: contigItems, buddy: buddyItems, slab: slabItems, malloc: mallocItems }[run.kind];
    const frames = [];
    const first = { contig: 'Memory starts as the kernel and one hole of ' + (v.memK - v.osK) + ' KiB.', seg: 'Memory starts as the kernel and one hole of ' + (v.memK - v.osK) + ' KiB; each segment will get a run of its own.', buddy: 'The arena is one free block of ' + v.arena + ' KiB.', slab: 'Every cache starts with no slabs; the first object of a cache makes it grow.', malloc: 'The heap is one free block of ' + v.heap + ' bytes, with a tag at each end.' }[run.kind];
    frames.push({ items: draw(run, -1, v, narrow), say: first, title: 'start', at: 0 });
    run.steps.forEach((s, i) => frames.push({ items: draw(run, i, v, narrow), say: s.say, title: s.op.text, at: i + 1, hold: 1300 }));
    const fv = ML.fitAll(frames, 10);
    frames.forEach((f) => { f.view = fv; });
    const trace = [{ kind: 'start', say: first }].concat(run.steps.map((s) => ({ kind: s.st.kind, say: s.say, op: s.op.text })));
    const last = run.steps.length ? run.steps[run.steps.length - 1].snap : run.start;
    const fails = run.steps.filter((s) => s.st.kind === 'fail').length;
    let metrics, tables;
    if (run.kind === 'contig' || run.kind === 'seg') {
      metrics = [{ label: 'Refused', value: fails, cls: fails ? 'bad' : 'good' }, { label: 'Holes', value: last.frag.holes }, { label: 'Free', value: last.frag.free, unit: 'KiB' }, { label: 'Largest hole', value: last.frag.largest, unit: 'KiB' }, { label: 'External fragmentation', value: pct(last.frag.external), cls: last.frag.external > 0.3 ? 'bad' : '' }];
      tables = [{ title: 'Blocks, by address', cols: ['Block', 'Start', 'Size'], rows: last.blocks.map((b) => [b.id, String(b.start), b.size + ' KiB']) }, { title: 'Holes', cols: ['Start', 'Size'], rows: last.holes.map((h) => [String(h.start), h.size + ' KiB']) }];
    } else if (run.kind === 'buddy') {
      const used = last.allocated.reduce((a, u) => a + u.size, 0), asked = last.allocated.reduce((a, u) => a + u.request, 0);
      metrics = [{ label: 'Refused', value: fails, cls: fails ? 'bad' : 'good' }, { label: 'Blocks in use', value: last.allocated.length }, { label: 'Internal fragmentation', value: used - asked, unit: 'KiB', note: used ? pct((used - asked) / used) + ' of the blocks in use' : '' }];
      tables = [{ title: 'Blocks in use', cols: ['Name', 'Asked', 'Block', 'At'], rows: last.allocated.map((u) => [u.id, u.request + ' KiB', u.size + ' KiB', String(u.offset)]) }, { title: 'Free lists', cols: ['Size', 'Free blocks at'], rows: Object.keys(last.freeLists).map(Number).sort((a, b) => b - a).map((sz) => [sz + ' KiB', last.freeLists[sz].join(', ') || '—']) }];
    } else if (run.kind === 'slab') {
      metrics = last.caches.map((c) => ({ label: c.name, value: c.slabs.length + ' slab' + (c.slabs.length === 1 ? '' : 's'), note: 'full ' + c.full.length + ', partial ' + c.partial.length + ', empty ' + c.empty.length }));
      tables = [{ title: 'Caches', cols: ['Cache', 'Object', 'A slab', 'Slabs', 'Objects'], rows: last.caches.map((c) => [c.name, c.objSize + ' B', String(c.perSlab), String(c.slabs.length), String(c.slabs.reduce((a, s) => a + s.objs.filter((o) => o !== null).length, 0))]) }];
    } else {
      const t = last.stats;
      metrics = [{ label: 'Refused', value: fails, cls: fails ? 'bad' : 'good' }, { label: 'In blocks', value: t.used, unit: 'B' }, { label: 'Internal', value: t.internal, unit: 'B' }, { label: 'Free', value: t.free, unit: 'B' }, { label: 'External fragmentation', value: pct(t.external), cls: t.external > 0.3 ? 'bad' : '' }];
      tables = [{ title: 'Blocks, by address', cols: ['Start', 'Size', 'State', 'Asked'], rows: last.blocks.map((b) => [String(b.start), String(b.size), b.free ? 'free' : b.id, b.free ? '–' : String(b.request)]) }];
    }
    return { frames, trace, tables, metrics, run };
  };
})(globalThis.Proses = globalThis.Proses || {});
