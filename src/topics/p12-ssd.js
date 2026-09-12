// Part 12, solid-state drives: flash pages behind the page-mapping translation layer, step by step (an overwrite
// goes to a fresh page, the old copy turns invalid, garbage collection copies and erases), and the blocks drawn as
// columns of pages. Every event comes from the SSD model (src/core/st-f-ssd.js); the pictures replay its steps on
// the last snapshot so each step can be drawn, and the state is the model's own at the end of every operation.
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const parseOp = (x) => { const m = String(x).match(/^([wrt])(\d+)$/i); return m ? { op: m[1].toLowerCase(), lpn: +m[2] } : null; };
  S.T12.ssdParse = parseOp;

  /** apply one engine step to a snapshot copy (for drawing between operations) */
  function apply(sn, st) {
    const P = sn.P, at = (ppn) => ({ b: Math.floor(ppn / P), k: ppn % P });
    if (st.kind === 'new-block') { sn.active = st.block; sn.blocks.forEach((b) => { b.active = b.id === st.block; }); const b = sn.blocks[st.block]; b.free = false; }
    if (st.kind === 'invalidate') { const p = at(st.ppn), b = sn.blocks[p.b]; b.pages[p.k] = 'invalid'; b.valid--; b.invalid++; sn.l2p[st.lpn] = -1; }
    if (st.kind === 'write' || st.kind === 'gc-copy' || st.kind === 'wl-move') {
      if (st.from !== undefined) { const f = at(st.from), fb = sn.blocks[f.b]; fb.pages[f.k] = 'invalid'; fb.valid--; fb.invalid++; }
      const p = at(st.ppn), b = sn.blocks[p.b]; b.pages[p.k] = 'valid'; b.lpns[p.k] = st.lpn; b.valid++; sn.l2p[st.lpn] = st.ppn;
    }
    if (st.kind === 'erase') { const b = sn.blocks[st.block]; b.pages = b.pages.map(() => 'free'); b.lpns = b.lpns.map(() => -1); b.valid = 0; b.invalid = 0; b.erases = st.erases; b.free = true; }
    return sn;
  }
  const copy = (sn) => JSON.parse(JSON.stringify(sn));
  S.T12.ssdApply = apply;

  /**
   * the blocks as columns of pages: o {prefix, x, y, sn, cw, ch, gap, act: {ppn}, src: {ppn}, victim, erased, lpnText}
   */
  function blocks(o) {
    const t = T(), items = [], sn = o.sn, P = sn.P, cw = o.cw || 64, ch = o.ch || 28, gap = o.gap || 14, pad = 8;
    sn.blocks.forEach((b, i) => {
      const x = o.x + i * (cw + 2 * pad + gap), y = o.y;
      const cls = 'blk' + (b.id === o.victim ? ' victim' : b.id === o.erased ? ' erased' : b.active ? ' active' : '');
      items.push({ key: o.prefix + ':bk' + i, kind: 'region', x: R(x), y: R(y), w: cw + 2 * pad, h: R(34 + P * (ch + 4) + 26), rx: 6, cls, audit: 'group' });
      items.push(t.text(o.prefix + ':bt' + i, x + pad + cw / 2, y + 22, 'block ' + b.id, 'strong', 13, 'middle'));
      b.pages.forEach((st, k) => {
        const ppn = b.id * P + k, lp = b.lpns[k] >= 0 ? b.lpns[k] : o.memo && o.memo.has(ppn) ? o.memo.get(ppn) : '?';
        items.push(t.cell(o.prefix + ':pg' + ppn, x + pad, y + 32 + k * (ch + 4), cw, ch, st === 'free' ? '' : 'L' + lp, 'pg ' + st + (o.act && o.act === ppn ? ' act' : '') + (o.src === ppn ? ' src' : ''), 13));
      });
      items.push(t.text(o.prefix + ':be' + i, x + pad + cw / 2, y + 32 + P * (ch + 4) + 16, 'erased ' + b.erases + '×', 'tick', 13, 'middle'));
    });
    return { items, w: sn.blocks.length * (cw + 2 * pad + gap) - gap, h: 34 + P * (ch + 4) + 26, pageAt: (ppn) => { const i = Math.floor(ppn / P), k = ppn % P; return { x: o.x + i * (cw + 2 * pad + gap) + pad, y: o.y + 32 + k * (ch + 4), w: cw, h: ch }; } };
  }
  S.T12.ssdBlocks = blocks;

  // =================================================================================================================
  S.topic({
    id: 'ssd-ftl', family: 'p12-ssd', order: 10, title: 'Flash pages and the translation layer',
    blurb: 'Flash is written a page at a time but erased only a whole block at a time, and a page cannot be rewritten until its block is erased. So an SSD never overwrites in place: each write goes to the next free page, the mapping table points the logical page there, and the old copy is left behind as invalid. When free blocks run out, garbage collection copies a block’s valid pages away and erases it.',
    inputs: [
      { id: 'ops', kind: 'list', label: 'operations (w5 write, r5 read, t5 trim)', def: ['w0', 'w1', 'w2', 'w3', 'w1', 'r1', 'w4', 'w1', 't2', 'w5'], min: 1, max: 40, check: (v) => (v.every(parseOp) ? null : 'operations: w, r or t and a logical page, such as w3') },
      { id: 'blocks', kind: 'number', label: 'erase blocks', def: 5, min: 4, max: 7 },
      { id: 'pages', kind: 'number', label: 'pages a block', def: 4, min: 2, max: 6 },
      { id: 'op', kind: 'choice', label: 'over-provisioning', def: '0.5', options: [{ value: '0.25', label: '25% spare' }, { value: '0.5', label: '50% spare' }, { value: '1', label: '100% spare' }] },
    ],
    check(inp) { const F = S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: +inp.op }); const bad = inp.ops.map(parseOp).find((x) => x.lpn >= F.logical); return bad ? 'operations: this drive shows logical pages 0 to ' + (F.logical - 1) : null; },
    presets: [
      { label: 'Writes, an overwrite, a read and a trim', values: { ops: ['w0', 'w1', 'w2', 'w3', 'w1', 'r1', 'w4', 'w1', 't2', 'w5'], blocks: 5, pages: 4, op: '0.5' } },
      { label: 'Overwrite one page again and again', values: { ops: ['w0', 'w1', 'w2', 'w0', 'w0', 'w0', 'w0', 'w0', 'w0', 'w0', 'w0', 'w0', 'w0'], blocks: 4, pages: 4, op: '0.5' } },
      { label: 'A full drive needs garbage collection', values: { ops: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w0', 'w5', 'w9', 'w2', 'w7', 'w10', 'w3', 'w0', 'w5', 'w9'], blocks: 5, pages: 4, op: '0.25' } },
      { label: 'Without TRIM: dead pages are copied', values: { ops: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w0', 'w5', 'w9', 'w4', 'w8', 'w0', 'w5', 'w9', 'w4'], blocks: 5, pages: 4, op: '0.25' } },
      { label: 'With TRIM: nothing to copy', values: { ops: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 't1', 't2', 't3', 'w0', 'w5', 'w9', 'w4', 'w8', 'w0', 'w5', 'w9', 'w4'], blocks: 5, pages: 4, op: '0.25' } },
    ],
    counters: [{ id: 'host', label: 'host writes' }, { id: 'flash', label: 'flash writes' }, { id: 'erases', label: 'erases' }],
    run(inp) {
      const t = T(), Fd = S.SSD.create({ blocks: inp.blocks, pages: inp.pages, op: +inp.op }), ops = inp.ops.map(parseOp);
      let sn = S.SSD.snapshot(Fd);
      const F = new S.Frames(['host', 'flash', 'erases']);
      const L = Fd.logical, BX = 20, BY = 44, BH = 34 + Fd.P * 32 + 26, MY = BY + BH + 30, per = 8, mw = 92;
      const mapRows = Math.ceil(L / per), SY = MY + 26 + mapRows * 30 + 14;
      const map = (act) => {
        const its = [t.title('sf:mt', BX, MY, 'the mapping table: logical page → physical page')];
        for (let l = 0; l < L; l++) {
          const p = sn.l2p[l];
          its.push(t.cell('sf:m' + l, BX + (l % per) * (mw + 4), MY + 12 + Math.floor(l / per) * 30, mw, 26, 'L' + l + ' → ' + (p < 0 ? '–' : p), 'l2p' + (p < 0 ? ' none' : '') + (act === l ? ' act' : ''), 13));
        }
        return its;
      };
      const strip = (cur) => {
        const its = [t.title('sf:ot', BX, 16, 'operations')], w0 = Math.max(0, Math.min(ops.length - 14, cur - 6));
        ops.forEach((o, i) => { if (i < w0 || i >= w0 + 14) return; its.push(t.cell('sf:o' + i, BX + 112 + (i - w0) * 46, -2, 40, 26, o.op + o.lpn, 'q' + (i < cur ? ' done' : i === cur ? ' act' : ' wait'), 13)); });
        return its;
      };
      const stats = (st) => [t.text('sf:s', BX, SY + 10, `host writes ${st.host}  ·  flash writes ${st.flash}  ·  write amplification ${st.host ? t.fix(st.flash / st.host, 3) : 0}  ·  erases ${st.erases}`, 'calc', 14)];
      const draw = (o, cur, act, st) => {
        const bk = blocks({ prefix: 'sf:b', x: BX, y: BY, sn, act: o.act, src: o.src, victim: o.victim, erased: o.erased, memo });
        return [...strip(cur), ...map(act), ...bk.items, ...stats(st)];
      };
      const cnt = { host: 0, flash: 0, erases: 0 }, memo = new Map();
      F.add({ items: draw({}, -1, null, cnt), say: `${Fd.B} erase blocks of ${Fd.P} pages: ${Fd.B * Fd.P} physical pages. The drive shows only ${L} logical pages; the other ${Fd.B * Fd.P - L} are spare room (${t.fix(100 * Fd.opReal, 1)}% over-provisioning) so that garbage collection always finds space. Every page is erased and free.`, meta: { phase: 'start', B: Fd.B, P: Fd.P, L, phys: Fd.B * Fd.P, spare: Fd.B * Fd.P - L, opPct: t.r1(100 * Fd.opReal) } });
      ops.forEach((o, i) => {
        let steps;
        if (o.op === 'w') steps = S.SSD.write(Fd, o.lpn).steps;
        else if (o.op === 't') steps = S.SSD.trim(Fd, o.lpn).steps;
        else steps = [S.SSD.read(Fd, o.lpn).step];
        let victim = null;
        steps.forEach((st) => {
          if (st.kind === 'write') { cnt.host++; cnt.flash++; }
          if (st.kind === 'gc-copy' || st.kind === 'wl-move') cnt.flash++;
          if (st.kind === 'erase') cnt.erases++;
          if (st.kind === 'gc-victim') victim = st.block;
          sn = apply(copy(sn), st);
          if (st.ppn !== undefined && st.ppn >= 0 && st.kind !== 'invalidate' && st.kind !== 'read') memo.set(st.ppn, st.lpn);
          F.set('host', cnt.host).set('flash', cnt.flash).set('erases', cnt.erases);
          const oo = { act: st.ppn !== undefined && st.kind !== 'invalidate' ? st.ppn : undefined, src: st.kind === 'invalidate' ? st.ppn : st.from, victim: st.kind === 'erase' ? null : victim, erased: st.kind === 'erase' ? st.block : null };
          if (st.kind === 'invalidate') oo.act = st.ppn;
          let say = st.say;
          if (st.kind === 'gc-victim') say += ` Its ${t.plural(st.valid, 'valid page')} must be copied before the erase.`;
          if (st.kind === 'read' && st.ppn >= 0) say += ` No erase or write is needed: reads are cheap.`;
          F.add({ items: draw(oo, i, st.lpn !== undefined ? st.lpn : null, cnt), title: (o.op + o.lpn) + ': ' + st.kind, say, meta: { phase: st.kind, step: st, op: i, opNo: i + 1, pageIn: st.ppn !== undefined && st.ppn >= 0 ? st.ppn % Fd.P : null, blockOf: st.ppn !== undefined && st.ppn >= 0 ? Math.floor(st.ppn / Fd.P) : null, freeBlocks: sn.blocks.filter((b) => b.free).length, cands: sn.blocks.filter((b) => !b.free && !b.active).map((b) => b.id), cnt: Object.assign({}, cnt), P: Fd.P } });
        });
        const real = S.SSD.snapshot(Fd);
        sn = real;
        F.list[F.list.length - 1].meta.snap = real;
      });
      const stt = S.SSD.stats(Fd);
      F.add({ items: draw({}, ops.length, null, cnt), title: 'done', say: `${t.cap(t.plural(stt.host, 'host write'))} became ${t.plural(stt.flash, 'flash write')} (${stt.gcCopies} copied by garbage collection) and ${t.plural(stt.erases, 'erase')}: write amplification ${stt.flash} / ${stt.host} = ${stt.wa}.`, meta: { phase: 'done', stats: stt } });
      return { frames: F.list, def: { sections: [{ id: 'r', kind: 'math', title: 'Flash rules', text: ['read and program: a page at a time', 'erase: a whole block at a time', 'a programmed page is not written again until its block is erased', 'write: the next free page; the old copy turns invalid', 'GC: copy a block’s valid pages, erase it', 'write amplification = flash writes / host writes'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'write' && fr[i + 1] && fr[i + 1].meta.phase === 'invalidate', pick: 'option', once: true, ask: (fr, i) => 'Logical page ' + fr[i + 1].meta.step.lpn + ' is written again. Where does the new copy go?', options: ['to the next free page of the active block', 'over the old copy, in place', 'to a new block, which is erased first'], answer: 'to the next free page of the active block', explain: 'A programmed page cannot be rewritten until its whole block is erased, so the FTL writes elsewhere and marks the old copy invalid.' },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'gc-victim', pick: 'option', once: true, ask: 'Free blocks are running out. Which block will garbage collection choose?', options: (fr, i) => (fr[i].meta.cands || []).map((b) => 'block ' + b), answer: (fr, i) => 'block ' + fr[i + 1].meta.step.block, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why can an SSD not overwrite a page in place?', options: ['a page is written once and can only be reused after its whole block is erased', 'the page is read-only', 'the mapping table is full', 'the controller is too slow'], answer: 0, why: 'Programming only clears bits; setting them back needs an erase, which works on whole blocks.' },
      { q: 'After logical page 5 is written twice, how many physical pages hold a copy of it?', options: ['two: one valid, one invalid', 'one', 'none', 'two valid copies'], answer: 0, why: 'The old copy stays until its block is erased; it is marked invalid.' },
      { q: 'Write amplification of 1.5 means…', options: ['for every 2 host writes the flash wrote 3 pages', 'the drive is 1.5 times faster', 'half the writes failed', 'each write is stored 1.5 times'], answer: 0, why: 'WA = flash writes / host writes; the extra writes are garbage-collection copies.' },
      { q: 'TRIM helps because…', options: ['the drive learns which pages are dead and need not copy them', 'it erases a block at once', 'it makes reads faster', 'it compresses the data'], answer: 0, why: 'A trimmed page is invalid, so garbage collection skips it.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
