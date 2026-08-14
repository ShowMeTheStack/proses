// The Memory lab, part three: the pieces of a translation picture. The address split into coloured fields, the TLB
// as sets and ways, the entry just read decoded into its frame number and flags, the memory accesses counted, the
// addresses as a row of chips (hit, miss, fault), and the hierarchical walk table by table (wide: one column a level;
// narrow: one row a level). Every piece returns items; part four puts them together.
//   ML.D.text/cell/cellL(..)   item helpers;   ML.D.strip(o), tlb(o), pte(o), counter(o), chips(o), hier(o), hierNarrow(o)
(function (S) {
  'use strict';
  const ML = S.MemLab;
  const M = () => S.Mem, KM = () => S.Kit.mem;
  const B = (v) => BigInt(v);
  const r = Math.round;
  const D = (ML.D = {});
  D.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: r(x), y: r(y), text: String(text), cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  D.cell = (key, x, y, w, h, text, cls, size, more) => Object.assign({ key, kind: 'cell', x: r(x), y: r(y), w: r(w), h: r(h), rx: 4, text: String(text), cls: cls || '', size: size || 13 }, more || {});
  D.cellL = (key, x, y, w, h, lines, cls, size, more) => Object.assign({ key, kind: 'cell', x: r(x), y: r(y), w: r(w), h: r(h), rx: 5, lines, cls: cls || '', size: size || 13 }, more || {});
  const short = (v) => B(v).toString(16);

  /** the address as bits (wide) or as one cell a field holding its value (narrow) */
  D.strip = function (o) {
    const cfg = o.cfg, fields = M().split(cfg, o.va), W = cfg.vaBits, items = [];
    const act = o.act === 'all' ? fields.map((f, k) => k) : o.act === undefined || o.act === null ? [] : [o.act];
    if (!o.narrow) {
      const bitW = Math.min(22, Math.floor(o.w / W)), x = o.x + r((o.w - bitW * W) / 2);
      const fs = fields.map((f) => ({ name: f.name, bits: f.bits, hi: f.hi, lo: f.lo, value: f.value, cls: KM().lv(f.level), label: f.bits * bitW >= (f.level < 0 ? 46 : 38) ? (f.level < 0 ? 'offset ' + ML.hx(f.value) : f.name + ' = ' + f.value) : f.bits * bitW >= 22 ? (f.level < 0 ? 'off' : f.name) : '' }));
      const s = KM().strip({ prefix: 'bs', x, y: o.y, fields: fs, bitW, h: 26, va: B(o.va), total: W, bits: true, act, size: bitW >= 15 ? 13 : 12, labelSize: 12 });
      // the bit numbers: the top of each field, and 0
      items.push(...s.items.filter((it) => !/^bs:lo\d+$/.test(it.key) || it.key === 'bs:lo' + (fields.length - 1)).filter((it) => !(/^bs:hi\d+$/.test(it.key) && bitW * fields[+it.key.slice(5)].bits < 18)));
      return { items, h: 70 };
    }
    // narrow: a cell a field, as wide as it needs
    const ws = fields.map((f) => Math.max(40, 14 + 8 * String(f.level < 0 ? ML.hx(f.value) : f.value).length));
    const k = Math.min(1, o.w / ws.reduce((a, b) => a + b, 0));
    const fs = fields.map((f, i) => ({ name: f.name, w: r(ws[i] * k), value: f.value, text: f.level < 0 ? ML.hx(f.value) : String(f.value), cls: KM().lv(f.level), label: f.level < 0 ? 'off' : f.name }));
    items.push(...KM().strip({ prefix: 'bs', x: o.x, y: o.y, fields: fs, h: 30, bits: false, act, size: 13, labelSize: 12 }).items);
    return { items, h: 60 };
  };

  /** the TLB: a row a set (only set 0, the current one and the last when there are many), a cell a way */
  D.tlb = function (o) {
    const items = [], T = o.contents, nSets = T.length, ways = o.ways, perRow = Math.min(ways, o.perRow || 4), rowsPer = Math.ceil(Math.min(ways, 8) / perRow);
    const labW = 50, cw = (o.w - labW) / perRow, ch = 36, fs = 13;
    items.push(D.text('tlb:t', o.x, o.y, o.title, 'title'));
    let y = o.y + 14;
    const show = nSets <= 4 ? [...Array(nSets).keys()] : [...new Set([0, o.set === undefined || o.set === null ? 0 : o.set, nSets - 1])].sort((a, b) => a - b);
    show.forEach((s, j) => {
      if (j > 0 && s > show[j - 1] + 1) { items.push(D.cell('tlb:gap' + j, o.x, y, o.w, 18, '⋮', 'mb-gap', 13)); y += 18; }
      const set = T[s] || [];
      // the entries a set shows: all of them, or for a big set the most recent eight (the one in play among them)
      let idx = set.map((e, w) => w);
      if (idx.length > 8) { idx.sort((a, b) => set[a].age - set[b].age); idx = idx.slice(0, 8); if (o.set === s && o.way >= 0 && !idx.includes(o.way)) idx[7] = o.way; idx.sort((a, b) => a - b); }
      const nShow = Math.max(idx.length, Math.min(ways, 8));
      const rows = Math.max(1, Math.ceil(nShow / perRow));
      items.push(D.cell('tlb:s' + s, o.x, y, labW - 6, rows * ch + (rows - 1) * 4, 'set ' + s, 'mb-fno' + (o.set === s ? ' act' : ''), 13));
      for (let q = 0; q < nShow; q++) {
        const w = q < idx.length ? idx[q] : null, e = w === null ? null : set[w];
        const x = o.x + labW + (q % perRow) * cw, yy = y + Math.floor(q / perRow) * (ch + 4);
        const key = 'tlb:e' + s + '_' + (w === null ? 'n' + q : 'w' + w);
        if (!e) { items.push(D.cell(key, x, yy, cw - 4, ch, 'empty', 'mb-ent nil', fs)); continue; }
        const st = o.set === s && o.way === w ? (o.hit ? ' good' : ' act') : '';
        const one = '0x' + short(e.vpn) + ' → 0x' + short(e.pfn);
        if (S.geom.textWidth(one, fs, { mono: true }) + 12 <= cw - 4) items.push(D.cell(key, x, yy, cw - 4, ch, one, 'mb-ent' + st, fs, { rx: 3 }));
        else items.push(D.cellL(key, x, yy, cw - 4, ch, ['p ' + short(e.vpn), 'f ' + short(e.pfn)], 'mb-ent' + st, fs, { rx: 3 }));
      }
      if (set.length > idx.length) items.push(D.text('tlb:more' + s, o.x + o.w, y + rows * (ch + 4) + 10, '+ ' + (set.length - idx.length) + ' older', 'tick', 12, 'end'));
      y += rows * (ch + 4) + (set.length > idx.length ? 14 : 0);
    });
    return { items, h: y - o.y };
  };

  /** the entry just read: its frame number and each flag bit, under the flag names */
  D.pte = function (o) {
    const items = [], fw = o.flagW || 34, ch = 30, n = o.flags.length;
    items.push(D.text('pte:t', o.x, o.y, o.title, 'strong', 13));
    const y = o.y + 28;
    const pfnW = Math.max(110, o.w - n * fw - 4);
    items.push(D.cell('pte:pfn', o.x, y, pfnW, ch, o.entry ? (o.entry.valid ? 'frame ' + ML.hx(o.entry.pfn) : 'not valid') : '—', 'mb-ent' + (o.entry ? (o.entry.valid ? ' act' : ' bad') : ' nil'), 13));
    items.push(D.text('pte:pfnn', o.x + pfnW / 2, y - 6, o.pfnBits + '-bit frame number', 'tick', 12, 'middle'));
    o.flags.forEach((f, k) => {
      const bit = o.entry ? o.bits[k] : null, x = o.x + pfnW + 4 + k * fw;
      items.push(D.text('pte:fn' + k, x + fw / 2, y - 6, f, 'tick', 12, 'middle'));
      items.push(D.cell('pte:f' + k, x, y, fw - 3, ch, bit === null ? '' : bit, 'mb-ent' + (bit === 1 ? ' good' : bit === 0 ? '' : ' nil'), 13, { rx: 2 }));
    });
    return { items, h: 28 + ch };
  };

  /** the memory accesses: a cell for each table read and one for the data, lit as they happen */
  D.counter = function (o) {
    const items = [], cw = o.cw || 52, gap = 6;
    items.push(D.text('acc:t', o.x, o.y, 'memory accesses', 'title'));
    o.cells.forEach((c, k) => items.push(D.cell('acc:' + k, o.x + k * (cw + gap), o.y + 12, cw, 28, c.text, 'mb-acc ' + (c.cls || '') + (c.on ? ' on' : '') + (c.dim ? ' dim' : ''), 12)));
    const x = o.x + o.cells.length * (cw + gap) + 4;
    items.push(D.text('acc:n', x, o.y + 32, '= ' + o.n + (o.ns !== undefined ? ' · ' + o.ns + ' ns' : ''), 'mb-big' + (o.cls ? ' ' + o.cls : ''), 16));
    return { items, h: 40 };
  };

  /** the addresses, a chip each: done ones say hit, miss or fault; the current one is lit */
  D.chips = function (o) {
    const items = [], cw = o.cw || 40, ch = 26, gap = 6, n = o.rows.length, per = Math.max(1, Math.min(n, o.per || n));
    const w0 = Math.max(0, Math.min(n - per, o.cur - Math.floor(per / 2)));
    if (o.title !== false) items.push(D.text('ch:t', o.x, o.y, o.title || 'addresses', 'title'));
    const y = o.title === false ? o.y : o.y + 12;
    for (let k = w0; k < w0 + per; k++) {
      const row = o.rows[k], done = k < o.cur || (k === o.cur && o.doneCur), x = o.x + (k - w0) * (cw + gap);
      const mark = !done ? String(k + 1) : row.fault ? '✗' : row.hit ? 'hit' : 'miss';
      const cls = 'mb-ord' + (k === o.cur ? ' act' : done ? (row.fault ? ' hot' : '') : ' none');
      items.push(D.cell('ch:' + k, x, y, cw, ch, mark, cls, 12));
    }
    return { items, h: (o.title === false ? 0 : 12) + ch, w: per * (cw + gap) - gap };
  };

  /** the hierarchical walk, a column a level then the data page; lvl: the level being read (L: the data, −1 none) */
  D.hier = function (o) {
    const m = o.model, cfg = m.cfg, L = cfg.levels, walk = o.walk, items = [];
    const reads = walk.steps.filter((s) => s.kind === 'read'), tables = reads.map((x) => m.pt.tables[x.table]);
    const n = L + 1, gap = n > 5 ? 18 : 26, colW = Math.min(150, Math.floor((o.w - (n - 1) * gap) / n)), colX = (i) => o.x + i * (colW + gap);
    const lvl = o.lvl, dim = o.skipped, top = o.y;
    const ty = top, sz = colW < 110 ? 12 : 13;
    for (let i = 0; i < L; i++) {
      const P = 'w' + i, t = tables[i];
      if (!t) { items.push(D.cellL(P + ':head', colX(i), ty, colW, 44, ['L' + (i + 1), 'no table'], 'mb-thead ghost', 13)); continue; }
      const sel = walk.fields[i].value, nE = 2 ** cfg.bits[i];
      const fault = !walk.ok && i === reads.length - 1 && lvl >= i && !dim;
      const tb = KM().table({ prefix: P, x: colX(i), y: ty, w: colW, rowH: 28, idxW: colW < 110 ? 34 : 42, title: 'L' + (i + 1) + ' table', sub: 'frame ' + ML.hx(t.frame), cls: KM().lv(i), n: nE, sel,
        entry: (idx) => { const e = t.entries.get(idx); return !e ? { text: '—', cls: 'inv' } : { text: (e.leaf ? 'f ' : '→ ') + ML.hx(e.pfn) }; }, act: lvl === i && !fault && !dim, fault, done: lvl > i && !dim, dim: dim || lvl < i, size: sz });
      items.push(...tb.items);
      items.push(D.text(P + ':n', colX(i) + colW / 2, ty + tb.h + 17, nE + ' × ' + cfg.pteBytes + ' B', 'tick' + (lvl < i || dim ? ' dim' : ''), 12, 'middle'));
      const rw = tb.row(sel);
      const leafHere = walk.ok && i === reads.length - 1;
      if (lvl > i && !dim && (tables[i + 1] || leafHere)) {
        const nx = leafHere ? colX(L) : colX(i + 1);
        items.push({ key: 'ar' + i, kind: 'edge', from: { x: rw.x + rw.w, y: r(rw.y + rw.h / 2) }, to: { x: nx, y: ty + 22 }, cls: lvl === i + 1 || (leafHere && lvl === L) ? 'act' : '' });
      }
    }
    const on = lvl >= L && !dim;
    if (walk.ok) {
      items.push(D.cellL('pg', colX(L), ty, colW, 44, ['data page', 'frame ' + ML.hx(walk.pfn)], 'mb-thead' + (on ? ' act' : dim ? '' : ' dim'), 13));
      items.push(D.cellL('pgb', colX(L), ty + 52, colW, 56, o.pa === null || o.pa === undefined ? ['+ ' + ML.hx(walk.offset)] : ['+ ' + ML.hx(walk.offset), '= ' + ML.hx(o.pa)], 'mb-page mono' + (on ? ' act' : dim ? '' : ' dim'), 13));
    } else items.push(D.cellL('pg', colX(L), ty, colW, 44, ['data page', 'not mapped'], 'mb-thead ghost', 13));
    return { items, colX, colW, ty };
  };

  /** narrow: a row a level, "L2 · frame 0x104 · [148] → 0x105" */
  D.hierNarrow = function (o) {
    const m = o.model, cfg = m.cfg, L = cfg.levels, walk = o.walk, items = [], lvl = o.lvl, dim = o.skipped;
    const reads = walk.steps.filter((s) => s.kind === 'read');
    const rh = 34, w = o.w;
    for (let i = 0; i <= L; i++) {
      const y = o.y + i * (rh + 6), st = reads[i], cls = i < L ? KM().lv(i) : 'lvoff';
      const state = dim ? ' dim' : lvl === i ? ' act' : lvl > i ? '' : ' dim';
      items.push(D.cell('wn:l' + i, o.x, y, 44, rh, i < L ? 'L' + (i + 1) : 'data', 'mb-idx sel ' + cls + (dim || lvl < i ? ' dim' : ''), 12));
      let text;
      if (i < L) text = !st ? 'no table' : 'frame ' + ML.hx(st.frame) + ' [' + st.index + '] → ' + (st.valid ? (st.leaf ? 'f ' : '') + ML.hx(st.next) : 'not valid');
      else text = walk.ok ? 'frame ' + ML.hx(walk.pfn) + ' + ' + ML.hx(walk.offset) : 'not mapped';
      const bad = i < L && st && !st.valid;
      items.push(D.cell('wn:e' + i, o.x + 50, y, w - 50, rh, text, 'mb-ent' + (bad && lvl >= i && !dim ? ' bad' : state === ' act' ? ' act' : '') + (state === ' dim' ? ' dim' : ''), 12));
    }
    return { items, h: (L + 1) * (rh + 6) };
  };
})(globalThis.Proses = globalThis.Proses || {});
