// The Memory lab, part four: the hashed and the inverted tables searched. Hashed: the page's bucket, then its chain
// of entries compared one by one. Inverted: the hash of (pid, page) picks an anchor, which points into the one table
// of frames; the chain is followed until an entry holds this page, and its position is the frame.
//   ML.D.hashed(o)   ML.D.inverted(o)   o: {model, look (the engine's lookup), x, y, w, phase, cur (node or frame lit),
//                    seen [..], skipped (a TLB hit), narrow}
(function (S) {
  'use strict';
  const ML = S.MemLab, D = ML.D;
  const KM = () => S.Kit.mem;
  const r = Math.round;

  function dataPage(items, o, x, y, w, ok, pfn, off, on, dim) {
    if (ok) {
      items.push(D.cellL('pg', x, y, w, 44, ['data page', 'frame ' + ML.hx(pfn)], 'mb-thead' + (on ? ' act' : dim ? '' : ' dim'), 13));
      items.push(D.cellL('pgb', x, y + 52, w, 56, o.pa === null || o.pa === undefined ? ['+ ' + ML.hx(off)] : ['+ ' + ML.hx(off), '= ' + ML.hx(o.pa)], 'mb-page mono' + (on ? ' act' : dim ? '' : ' dim'), 13));
    } else items.push(D.cellL('pg', x, y, w, 44, ['data page', 'not found'], 'mb-thead ghost', 13));
  }

  D.hashed = function (o) {
    const m = o.model, T = m.hpt, lk = o.look, items = [], dim = o.skipped, nB = T.buckets, b = lk.bucket, chain = T.chain(b);
    const seen = new Set(o.seen || []), narrow = o.narrow;
    const vpn = o.vpn;
    const hashCls = 'p10-box' + (o.phase === 'hash' && !dim ? ' act' : '');
    items.push(D.cellL('hs', o.x, o.y, narrow ? o.w : 250, 44, ['hash: page mod ' + nB, ML.hx(vpn) + ' mod ' + nB + ' = ' + b], hashCls, 13));
    const by = o.y + 56, bw = narrow ? 120 : 150;
    const tb = KM().table({ prefix: 'bk', x: o.x, y: by, w: bw, rowH: 28, idxW: 40, title: 'buckets', sub: nB + ' × ' + m.cfg.pteBytes + ' B', cls: 'lv0', n: nB, sel: b,
      entry: (i) => { const h = T.head[i]; return h === -1 ? { text: '—', cls: 'inv' } : { text: '→ e' + h }; }, act: o.phase === 'hash' && !dim, done: o.phase !== 'hash' && !dim, dim, size: 12 });
    items.push(...tb.items);
    const row = tb.row(b);
    // the chain: up to four entries in a row (narrow: in a column), the rest counted
    const maxShow = 3, shown = chain.slice(0, maxShow);
    const nw = narrow ? o.w - bw - 30 : 170, gap = narrow ? 10 : 36;
    const at = (j) => (narrow ? { x: o.x + bw + 30, y: r(row.y + row.h / 2 - 22) + j * (44 + gap) } : { x: o.x + bw + 50 + j * (nw + gap), y: r(row.y + row.h / 2 - 22) });
    shown.forEach((k, j) => {
      const n = T.nodes[k], p = at(j);
      const st = dim ? ' dim' : k === o.cur ? (o.hit ? ' good' : ' act') : seen.has(k) ? ' seen' : '';
      items.push(D.cellL('nd' + k, p.x, p.y, nw, 44, ['e' + k + ' → frame ' + ML.hx(n.pfn), 'page ' + ML.hx(n.vpn)], 'mb-ent chain' + st, 12, { rx: 3 }));
      const lit = !dim && seen.has(k);
      items.push({ key: 'ne' + k, kind: 'edge', from: j ? 'nd' + shown[j - 1] : { x: row.x + row.w, y: r(row.y + row.h / 2) }, to: 'nd' + k, cls: lit ? 'act' : '' });
    });
    if (!chain.length) items.push(D.text('nd:none', o.x + bw + 30, r(row.y + row.h / 2 + 5), 'empty chain', 'tick', 12));
    if (chain.length > maxShow) { const p = at(maxShow - 1); items.push(D.text('nd:more', narrow ? p.x : p.x + nw, narrow ? p.y + 44 + 18 : p.y - 8, '+ ' + (chain.length - maxShow) + ' more in this chain', 'tick', 12, narrow ? 'start' : 'end')); }
    if (!narrow) {
      const on = o.phase === 'frame' || o.phase === 'after';
      dataPage(items, o, o.x + o.w - 140, by, 140, lk.ok, lk.pfn, o.offset, on && !dim, dim);
    }
    return { items, h: narrow ? Math.max(tb.h + 62, row.y + row.h / 2 - 22 - o.y + shown.length * (44 + gap) + 20) : tb.h + 62 };
  };

  D.inverted = function (o) {
    const m = o.model, T = m.ipt, lk = o.look, items = [], dim = o.skipped, A = T.anchors, F = T.frames, s = lk.slot, narrow = o.narrow;
    const seen = new Set(o.seen || []);
    items.push(D.cellL('hs', o.x, o.y, narrow ? o.w : 300, 44, ['hash: (page + ' + T.mult + ' × pid) mod ' + A, '(' + ML.hx(o.vpn) + ' + ' + T.mult + ' × 1) mod ' + A + ' = ' + s], 'p10-box' + (o.phase === 'hash' && !dim ? ' act' : ''), 13));
    const by = o.y + 56, aw = narrow ? 110 : 140;
    const tb = KM().table({ prefix: 'an', x: o.x, y: by, w: aw, rowH: 28, idxW: 40, title: 'anchors', sub: A + ' × 4 B', cls: 'lv0', n: A, sel: s,
      entry: (i) => { const h = T.anchor[i]; return h === -1 ? { text: '—', cls: 'inv' } : { text: '→ ' + h }; }, act: (o.phase === 'hash' || o.phase === 'anchor') && !dim, done: !dim && o.phase !== 'hash' && o.phase !== 'anchor', dim, size: 12 });
    items.push(...tb.items);
    const aRow = tb.row(s);
    // the inverted table: frame 0, the chain's frames, the last frame, with ⋮ between rows that are not neighbours
    const chain = lk.chain.slice(0, 6);
    const rowsShown = [...new Set([0, ...chain, F - 1])].sort((a, b) => a - b);
    const ix = o.x + aw + (narrow ? 22 : 70), cols = narrow ? [46, 40, o.w - aw - 22 - 46 - 40 - 44, 44] : [62, 56, 150, 62];
    const names = ['frame', 'pid', 'page', 'next'];
    let x = ix;
    const iy = by + 22;
    names.forEach((nm, j) => { items.push(D.cell('it:h' + j, x, iy, cols[j], 26, nm, 'mb-colh', 12, { rx: 0 })); x += cols[j]; });
    const tw = x - ix;
    items.push(D.text('it:t', ix, by + 10, narrow ? 'inverted table, ' + F : 'inverted table: ' + F + ' entries, one a frame', 'title'));
    let y = iy + 26;
    const rowY = {};
    rowsShown.forEach((f, j) => {
      if (j > 0 && f > rowsShown[j - 1] + 1) { items.push(D.cell('it:g' + j, ix, y, tw, 18, '⋮', 'mb-gap', 13)); y += 18; }
      const e = T.entries[f], st = dim ? ' dim' : f === o.cur ? (o.hit ? ' good' : ' act') : seen.has(f) ? ' seen' : '';
      const cells = e ? [String(f), String(e.pid), ML.hx(e.vpn), e.next === -1 ? '—' : String(e.next)] : [String(f), '—', 'free', '—'];
      let cx = ix;
      cells.forEach((c, k) => { items.push(D.cell('it:r' + f + '_' + k, cx, y, cols[k], 28, c, (k === 0 ? 'mb-fno' : 'mb-ent' + (e ? '' : ' nil')) + st, 12, { rx: 0 })); cx += cols[k]; });
      rowY[f] = y;
      y += 28;
    });
    if (chain.length) {
      const f0 = chain[0], lit = !dim && o.phase !== 'hash';
      items.push({ key: 'ia', kind: 'edge', from: { x: aRow.x + aRow.w, y: r(aRow.y + aRow.h / 2) }, to: { x: ix, y: rowY[f0] + 14 }, cls: lit ? 'act' : '' });
      for (let k = 1; k < chain.length; k++) {
        const a = rowY[chain[k - 1]] + 14, b = rowY[chain[k]] + 14, wx = ix + tw + 14 + 12 * (k - 1);
        items.push({ key: 'iw' + k, kind: 'wire', pts: [[ix + tw, a], [wx, a], [wx, b], [ix + tw, b]], head: true, cls: !dim && seen.has(chain[k]) ? 'act hop' : 'hop' });
      }
    }
    if (!narrow) {
      const on = o.phase === 'frame' || o.phase === 'after';
      dataPage(items, o, o.x + o.w - 140, by, 140, lk.ok, lk.frame, o.offset, on && !dim, dim);
    }
    return { items, h: Math.max(y - o.y, tb.h + 62) };
  };
})(globalThis.Proses = globalThis.Proses || {});
