// The Memory lab, part five: the translation frames put together, then two summing-up pictures: the memory the page
// tables take under each design for the same address space (a log scale, since one flat table can be a million
// times the rest), and the effective access time worked out from this run's own hits and misses.
//   ML.paging(v, ctx) -> {frames, trace, tables, metrics}
(function (S) {
  'use strict';
  const ML = S.MemLab, D = ML.D;
  const M = () => S.Mem, KM = () => S.Kit.mem;
  const B = (v) => BigInt(v);
  const f2 = (x) => String(+(+x).toFixed(2));
  const TABLE = { hier: 'hierarchical', hashed: 'hashed', inverted: 'inverted' };

  function lookOf(model, v, a) {
    const cfg = model.cfg, vpn = a.va >> B(cfg.offBits), off = a.va & ((1n << B(cfg.offBits)) - 1n);
    if (v.table === 'hier') return M().translate(model.pt, a.va);
    if (v.table === 'hashed') return model.hpt.lookup(Number(vpn), Number(off));
    return model.ipt.lookup(1, Number(vpn), Number(off));
  }

  ML.paging = function (v, ctx) {
    const model = ML.model(v), run = ML.translate(model, v), cfg = model.cfg, narrow = ctx.narrow, L = cfg.levels;
    const W = narrow ? 380 : 1000, H = (x) => M().hex(x, cfg.paBits);
    const looks = model.addrs.map((a) => lookOf(model, v, a));
    const emptyTlb = v.tlb > 0 ? Array.from({ length: v.tlb / (v.ways || v.tlb) }, () => []) : null;
    const tlbTitle = v.tlb > 0 ? 'TLB · ' + v.tlb + ' entries, ' + (v.ways && v.ways < v.tlb ? v.ways + '-way, ' + v.tlb / v.ways + ' sets' : 'fully associative') : 'no TLB';
    const pfnBits = v.pa - cfg.offBits, dirty = new Set();
    let tlbNow = emptyTlb, cur = { i: -1 };
    const frames = [];
    run.steps.forEach((st, at) => {
      const i = st.i, a = model.addrs[i], row = run.rows[i], look = looks[i], vpn = a.va >> B(cfg.offBits), off = a.va & ((1n << B(cfg.offBits)) - 1n);
      if (cur.i !== i) cur = { i, seen: [], acc: 0, lvl: -1, phase: 'start', entry: null, entryTitle: '' };
      if (st.tlb) tlbNow = st.tlb;
      const mapped = model.byVpn.get(vpn), region = mapped ? model.regions[mapped.region] : null;
      const leafEntry = (pfn) => ({ valid: true, leaf: true, pfn, perm: region ? region.perm : 'rw', dirty: dirty.has(vpn) || (a.access === 'w' && st.kind === 'done') });
      // where this step has got to
      switch (st.kind) {
        case 'tlb': cur.phase = 'tlb'; if (st.hit) { cur.entry = leafEntry(st.pfn); cur.entryTitle = 'the entry the TLB holds for page ' + ML.hx(vpn); } break;
        case 'split': cur.phase = 'split'; break;
        case 'read': cur.lvl = st.level; cur.acc = st.access; cur.phase = 'read'; cur.entry = st.entry ? Object.assign({}, st.entry, { valid: st.valid, perm: region ? region.perm : 'rw', dirty: dirty.has(vpn) }) : { valid: false }; cur.entryTitle = 'entry ' + st.index + ' of the L' + (st.level + 1) + ' table, read at ' + H(st.entryAddr); break;
        case 'hash': cur.phase = 'hash'; cur.acc = v.table === 'hashed' ? 1 : 0; break;
        case 'anchor': cur.phase = 'anchor'; cur.acc = st.access; break;
        case 'compare': cur.phase = 'compare'; cur.acc = st.access; cur.cur = v.table === 'hashed' ? st.node : st.frame; cur.hit = st.hit; cur.seen.push(cur.cur); cur.entry = leafEntry(B(v.table === 'hashed' ? st.entry.pfn : st.frame)); cur.entry.valid = true; if (!st.hit) cur.entry = { valid: true, leaf: true, pfn: B(v.table === 'hashed' ? st.entry.pfn : st.frame), perm: 'rw', other: true }; cur.entryTitle = v.table === 'hashed' ? 'entry e' + st.node + ' of bucket ' + look.bucket : 'entry ' + st.frame + ' of the inverted table'; break;
        case 'frame': cur.lvl = L; cur.acc = st.accesses; cur.phase = 'frame'; break;
        case 'fault': cur.acc = st.accesses; cur.phase = 'fault'; break;
        case 'fill': case 'prot': cur.phase = 'after'; if (row.ok || st.kind === 'prot') cur.lvl = L; break;
        case 'done': cur.phase = 'after'; cur.acc = row.accesses; if (row.ok) cur.lvl = L; if (row.ok && a.access === 'w') dirty.add(vpn); break;
      }
      const skipped = row.hit;
      const items = [];
      // the address and its split
      const verb = a.access === 'w' ? ' · a write' : a.access === 'x' ? ' · a fetch' : ' · a read';
      if (!narrow) {
        items.push(D.text('va', 0, 14, 'address ' + (i + 1) + ': ' + M().hex(a.va, cfg.vaBits) + verb, 'mono strong', 15));
        items.push(D.text('vaw', W, 112, cfg.vaBits + ' bits = ' + cfg.bits.join(' + ') + ' + ' + cfg.offBits + (v.table === 'hier' ? ' · root register: frame ' + ML.hx(model.pt.tables[0].frame) : ''), 'tick', 13, 'end'));
        const per = Math.max(1, Math.floor((W - 470) / 46));
        items.push(...D.chips({ x: W - Math.min(per, run.rows.length) * 46 + 6, y: 0, title: false, rows: run.rows, cur: i, doneCur: st.kind === 'done', per, cw: 40 }).items);
      } else {
        items.push(D.text('va', 0, 14, (i + 1) + ': ' + M().hex(a.va, cfg.vaBits) + verb, 'mono strong', 14));
      }
      const actField = st.kind === 'tlb' || st.kind === 'split' ? 'all' : st.kind === 'read' ? st.level : cur.lvl >= L && row.ok ? L : null;
      const sp = D.strip({ cfg, va: a.va, x: 0, y: narrow ? 30 : 52, w: W, narrow, act: v.table === 'hier' || actField === 'all' || actField === L ? actField : null });
      items.push(...sp.items);
      // the walk
      const wy = narrow ? 104 : 128;
      let walkH;
      const paNow = st.kind === 'done' && row.ok ? row.pa : null;
      const o = { model, look, x: 0, y: wy, w: W, phase: cur.phase, cur: cur.cur, hit: cur.hit, seen: cur.seen, skipped, narrow, vpn, offset: off, pa: paNow };
      if (v.table === 'hier') {
        const lvl = skipped ? -1 : cur.lvl;
        if (!narrow) { items.push(...D.hier({ model, walk: look, x: 0, y: wy, w: W, lvl, skipped, pa: paNow }).items); walkH = 196; }
        else { const h = D.hierNarrow({ model, walk: look, x: 0, y: wy, w: W, lvl, skipped }); items.push(...h.items); walkH = h.h; }
      } else {
        const h = v.table === 'hashed' ? D.hashed(o) : D.inverted(o);
        items.push(...h.items);
        walkH = narrow ? h.h : Math.max(h.h, 164);
      }
      if (skipped) items.push(D.text('skip', narrow ? W : 0, wy + (narrow ? -8 : -16), 'a TLB hit: no walk', 'tick good', 13, narrow ? 'end' : 'start'));
      // the TLB, the entry, the accesses, the addresses
      const by = wy + walkH + (narrow ? 18 : 24);
      let rx = narrow ? 0 : 470, ry = by;
      if (tlbNow) {
        const t = D.tlb({ perRow: narrow ? 2 : 4, contents: tlbNow, ways: v.ways || v.tlb, x: 0, y: by, w: narrow ? W : 430, title: tlbTitle, set: st.kind === 'tlb' || st.kind === 'fill' ? st.set : null, way: st.kind === 'tlb' ? st.way : st.kind === 'fill' ? st.way : null, hit: st.kind === 'tlb' && st.hit });
        items.push(...t.items);
        if (narrow) ry = by + t.h + 22;
      } else items.push(D.text('tlb:t', 0, by, 'no TLB: every access walks', 'title'));
      if (narrow && !tlbNow) ry = by + 24;
      const pt = D.pte({ x: rx, y: ry, w: narrow ? W : W - rx, flags: model.flags, flagW: narrow ? Math.min(34, Math.floor((W - 110) / Math.max(1, model.flags.length))) : 38, entry: cur.entry, bits: cur.entry ? ML.flagBits(model.flags, cur.entry) : [], pfnBits, title: cur.entry ? cur.entryTitle : 'the entry, once one is read' });
      items.push(...pt.items);
      // the access counter: one cell a table read, then the data
      let cells;
      if (skipped) cells = [{ text: 'TLB', cls: 'lv0', on: true }, { text: 'data', cls: 'data', on: cur.phase === 'after' }];
      else if (v.table === 'hier') {
        const used = look.ok ? look.accesses - 1 : look.accesses;
        cells = cfg.bits.map((_, k) => ({ text: 'L' + (k + 1), cls: KM().lv(k), on: k < cur.acc && k < used, dim: k >= used })).concat([{ text: 'data', cls: 'data', on: look.ok && cur.acc >= look.accesses && cur.lvl >= L, dim: !look.ok }]);
      } else {
        const chainN = look.chain.length, head = v.table === 'hashed' ? 'bucket' : 'anchor';
        cells = [{ text: head, cls: 'lv0', on: cur.acc >= 1 }].concat(look.chain.slice(0, 6).map((k, j) => ({ text: (v.table === 'hashed' ? 'e' : '#') + k, cls: 'lv1', on: cur.acc >= j + 2 }))).concat([{ text: 'data', cls: 'data', on: look.ok && cur.acc >= chainN + 2, dim: !look.ok }]);
      }
      const nAcc = skipped ? (cur.phase === 'after' && row.ok ? 1 : 0) : cur.acc;
      const cy = ry + pt.h + (narrow ? 22 : 26);
      const cn = D.counter({ x: rx, y: cy, cells, cw: narrow ? Math.min(52, Math.floor((W - 90) / cells.length) - 6) : Math.min(56, Math.floor((W - rx - 150) / cells.length) - 6), n: nAcc, ns: st.kind === 'done' ? f2(row.ns) : undefined, cls: st.kind === 'done' ? (row.ok ? 'good' : 'bad') : '' });
      items.push(...cn.items);
      if (narrow) {
        const chY = cy + cn.h + 22;
        items.push(...D.chips({ x: rx, y: chY, rows: run.rows, cur: i, doneCur: st.kind === 'done', per: 7, cw: 46 }).items);
        if (paNow !== null) items.push(D.text('pa', 0, chY + 64, 'PA ' + H(paNow), 'mono good', 13));
      }
      const tables = [ML.rowsTable(run, model, i, st.kind === 'done')];
      frames.push({ items, say: st.say, title: (i + 1) + ' · ' + st.kind, at, tables, hold: st.kind === 'done' ? 1300 : 1000 });
    });
    { const fv = ML.fitAll(frames, 10); frames.forEach((f) => { f.view = fv; }); }
    const designs = ML.designs(model, v), eat = ML.eat(run, v, model);
    frames.push(ML.compareFrame(model, v, designs, narrow, run.steps.length));
    frames.push(ML.eatFrame(model, v, run, eat, narrow, run.steps.length));
    const trace = run.steps.map((s) => ({ kind: s.kind, say: s.say, i: s.i }));
    trace.push({ kind: 'designs', say: frames[frames.length - 2].say }, { kind: 'eat', say: frames[frames.length - 1].say });
    frames[frames.length - 2].at = trace.length - 2;
    frames[frames.length - 1].at = trace.length - 1;
    const metrics = [
      { label: 'TLB hits', value: run.hits + ' of ' + model.addrs.length, cls: run.hits ? 'good' : '' },
      { label: 'Page faults', value: run.faults, cls: run.faults ? 'bad' : '' },
      { label: 'Memory accesses', value: run.accesses, note: 'the translations that completed' },
      { label: 'EAT', value: eat.n ? f2(eat.ns) : '–', unit: eat.n ? 'ns' : '', note: eat.n ? eat.say : 'no translation completed', cls: 'act' },
      { label: 'Tables (' + TABLE[v.table] + ')', value: M().bytes(designs.find((d) => d.id === (v.table === 'hier' ? 'hier' : v.table)).bytes) },
      { label: 'One flat table', value: M().bytes(designs[0].bytes) },
      { label: 'TLB reach', value: v.tlb ? M().bytes(M().tlbReach(v.tlb, cfg.pageBytes)) : '–' },
    ];
    const last = [ML.rowsTable(run, model, run.rows.length - 1, true), ML.designTable(designs, v)];
    frames[frames.length - 2].tables = last;
    frames[frames.length - 1].tables = last;
    return { frames, trace, tables: last, metrics, model, run, designs, eat };
  };

  ML.rowsTable = function (run, model, upto, doneCur) {
    const cfg = model.cfg;
    return { title: 'Each address', cols: ['#', 'Address', 'Page', 'TLB', 'Reads', 'Result'], hl: upto,
      rows: run.rows.map((r, k) => {
        const done = k < upto || (k === upto && doneCur);
        return [String(k + 1), M().hex(r.va, cfg.vaBits) + (r.access === 'r' ? '' : ':' + r.access), ML.hx(r.vpn), done ? { text: r.hit ? 'hit' : 'miss', cls: r.hit ? 'good' : '' } : '–', done ? String(r.reads) : '–', done ? (r.ok ? M().hex(r.pa, cfg.paBits) : { text: r.fault + ' fault', cls: 'bad' }) : '–'];
      }) };
  };
  ML.designTable = (designs, v) => ({ title: 'Page-table memory, this space', cols: ['Design', 'Memory', 'How'], rows: designs.map((d) => [d.name, M().bytes(d.bytes), d.note]), hl: designs.findIndex((d) => d.id === v.table) });

  /** one box round everything every frame draws, with a margin */
  ML.fitAll = function (frames, pad) {
    let box = null;
    for (const f of frames) { const b = S.stageBounds(f.items, { margin: 0, minW: 1, minH: 1 }); if (b) box = box ? S.geom.union([box, b]) : b; }
    return box ? { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), w: Math.ceil(box.w + 2 * pad), h: Math.ceil(box.h + 2 * pad) } : { x: 0, y: 0, w: 380, h: 400 };
  };

  ML.compareFrame = function (model, v, designs, narrow, at) {
    const W = narrow ? 380 : 1000, items = [];
    const lg = (b) => Math.log2(Math.max(1, b));
    const lo = Math.floor(Math.min(...designs.map((d) => lg(d.bytes))) / 10) * 10, hi = Math.max(lo + 10, Math.ceil(Math.max(...designs.map((d) => lg(d.bytes))) / 10) * 10);
    const x0 = narrow ? 0 : 230, bw = narrow ? W - 10 : W - x0 - 20, X = (b) => Math.round(x0 + ((lg(b) - lo) / (hi - lo)) * bw);
    items.push(D.text('cmp:t', 0, 14, 'page-table memory for this address space (log scale)', 'title'));
    const pages = model.map.length;
    items.push(D.text('cmp:s', 0, 38, pages + ' pages mapped in ' + model.regions.length + ' region' + (model.regions.length === 1 ? '' : 's') + (v.procs > 1 ? ', ' + v.procs + ' processes' : '') + ' · ' + M().bytes(model.cfg.pageBytes) + ' pages · ' + model.cfg.pteBytes + '-byte entries', 'tick', 13));
    const top = 70, rowH = narrow ? 92 : 78, best = Math.min(...designs.map((d) => d.bytes)), worst = Math.max(...designs.map((d) => d.bytes));
    designs.forEach((d, k) => {
      const y = top + k * rowH, cls = d.bytes === best ? 'best' : d.bytes === worst ? 'worst' : d.id === v.table ? 'act' : 'soft';
      const ly = narrow ? y : y + 20;
      items.push(D.text('cmp:n' + k, 0, ly, d.name + (d.id === v.table ? ' (yours)' : ''), d.id === v.table ? 'strong' : 'strong', 14));
      if (!narrow) items.push(D.text('cmp:h' + k, 0, ly + 20, d.note.length > 34 ? d.note.slice(0, 33) + '…' : d.note, 'tick', 12));
      const by = narrow ? y + 12 : y + 4, w = Math.max(3, X(d.bytes) - x0);
      items.push(D.cell('cmp:b' + k, x0, by, w, 30, '', 'p11-bar ' + cls, 12, { rx: 2 }));
      const label = M().bytes(d.bytes), lw = S.geom.textWidth(label, 14, { mono: true });
      if (x0 + w + 8 + lw < W) items.push(D.text('cmp:v' + k, x0 + w + 8, by + 20, label, 'mono strong', 14));
      else items.push(D.text('cmp:v' + k, x0 + w - 8, by + 20, label, 'mono strong onbar', 14, 'end'));
      if (narrow) items.push(D.text('cmp:h' + k, 0, by + 50, d.note.length > 50 ? d.note.slice(0, 49) + '…' : d.note, 'tick', 12));
    });
    // the scale: powers of 1024
    const ay = top + designs.length * rowH + (narrow ? 0 : 6);
    items.push({ key: 'cmp:ax', kind: 'line', x1: x0, y1: ay, x2: x0 + bw, y2: ay, cls: 'p10-tick' });
    for (let e = Math.ceil(lo / 10) * 10; e <= hi; e += narrow && hi - lo > 40 ? 20 : 10) {
      const x = Math.round(x0 + ((e - lo) / (hi - lo)) * bw);
      items.push({ key: 'cmp:tk' + e, kind: 'line', x1: x, y1: ay, x2: x, y2: ay + 6, cls: 'p10-tick' });
      items.push(D.text('cmp:tl' + e, x, ay + 22, M().bytes(2 ** e), 'tick mono', 12, 'middle'));
    }
    const mine = designs.find((d) => d.id === v.table), flat = designs[0];
    const hier = designs[1];
    const say = 'For these ' + pages + ' pages, one flat table would take ' + M().bytes(flat.bytes) + '; the ' + model.cfg.levels + '-level tables take ' + M().bytes(hier.bytes) + ' (' + hier.note + '), the hashed table ' + M().bytes(designs[2].bytes) + ' and the inverted table ' + M().bytes(designs[3].bytes) + (v.procs > 1 ? ', shared by all ' + v.procs + ' processes' : '') + '. Your ' + (v.table === 'hier' ? 'hierarchical' : v.table) + ' table is ' + (mine.bytes <= best ? 'the smallest here.' : (mine.bytes / best).toFixed(1).replace(/\.0$/, '') + ' times the smallest.');
    const f = { items, say, title: 'designs compared', at, hold: 2000 };
    f.view = ML.fitAll([f], 10);
    return f;
  };

  ML.eatFrame = function (model, v, run, e, narrow, at) {
    const W = narrow ? 380 : 1000, items = [], cfg = model.cfg, sz = narrow ? 13 : 15;
    if (!e.n) {
      items.push(D.text('eat:t', 0, 14, 'effective access time', 'title'), D.text('eat:none', 0, 50, 'no address translated: every one faulted', 'strong bad', 15));
      const f0 = { items, say: 'Every address faulted, so no translation completed and there is nothing to average: type some addresses inside the mapped regions.', title: 'access time', at, hold: 2000 };
      f0.view = ML.fitAll([f0], 10);
      return f0;
    }
    items.push(D.text('eat:t', 0, 14, 'effective access time, from these ' + e.n + ' translations', 'title'));
    const okRows = run.rows.filter((r) => r.ok), hits = okRows.filter((r) => r.hit).length;
    const lines = [
      ['h', 'hit ratio h = ' + hits + ' / ' + e.n + ' = ' + f2(e.h)],
      ['hit', 'a hit:  ' + (v.tlb ? 'TLB ' + f2(e.t) + ' ns + ' : '') + '1 access × ' + e.m + ' ns = ' + f2(e.hitNs) + ' ns'],
      ['miss', 'a miss: ' + (v.tlb ? f2(e.t) + ' + ' : '') + f2(e.r) + ' table reads × ' + e.m + ' + ' + e.m + ' = ' + f2(e.missNs) + ' ns'],
      ['eat', 'EAT = ' + f2(e.h) + ' × ' + f2(e.hitNs) + ' + ' + f2(1 - e.h) + ' × ' + f2(e.missNs) + ' = ' + f2(e.ns) + ' ns'],
    ];
    if (narrow) lines.splice(1, 3, ['hit', 'a hit: ' + f2(e.hitNs) + ' ns'], ['miss', 'a miss: ' + f2(e.missNs) + ' ns (' + f2(e.r) + ' reads)'], ['eat', 'EAT = ' + f2(e.ns) + ' ns']);
    lines.forEach(([k, t], j) => items.push(D.text('eat:' + k, 0, 52 + j * 34, t, 'mono' + (k === 'eat' ? ' strong' : ''), k === 'eat' ? sz + 2 : sz)));
    // bars: the cost of a hit, of a miss, and the average
    const by = 52 + lines.length * 34 + 16, bx = narrow ? 80 : 150, bw = W - bx - 120, mx = Math.max(e.missNs, e.hitNs, 1);
    [['hit', e.hitNs, 'best'], ['miss', e.missNs, 'worst'], ['EAT', e.ns, 'act']].forEach(([nm, val, cls], j) => {
      const y = by + j * 44;
      items.push(D.text('eb:n' + j, 0, y + 21, nm, 'strong', 14));
      items.push(D.cell('eb:b' + j, bx, y, Math.max(3, Math.round((val / mx) * bw)), 30, '', 'p11-bar ' + cls, 12, { rx: 2 }));
      items.push(D.text('eb:v' + j, bx + Math.max(3, Math.round((val / mx) * bw)) + 8, y + 21, f2(val) + ' ns', 'mono strong', 14));
    });
    const ny = by + 3 * 44 + 26;
    const reach = v.tlb ? M().tlbReach(v.tlb, cfg.pageBytes) : 0;
    items.push(D.text('eat:m', 0, ny, 'measured: ' + f2(e.measured) + ' ns a translation' + (run.faults ? ' (' + run.faults + ' fault' + (run.faults === 1 ? '' : 's') + ' left out)' : ''), 'tick', 13));
    if (v.tlb) items.push(D.text('eat:r', 0, ny + 24, 'TLB reach = ' + v.tlb + ' × ' + M().bytes(cfg.pageBytes) + ' = ' + M().bytes(reach), 'tick', 13));
    const say = 'With ' + hits + ' TLB hit' + (hits === 1 ? '' : 's') + ' in ' + e.n + ' translations, h = ' + f2(e.h) + '. A hit costs ' + f2(e.hitNs) + ' ns and a miss ' + f2(e.missNs) + ' ns (' + f2(e.r) + ' table reads on average), so ' + e.say + (Math.abs(e.measured - e.ns) < 0.01 ? ', the same as the run measured.' : '; the run measured ' + f2(e.measured) + ' ns.');
    const f = { items, say, title: 'access time', at, hold: 2000 };
    f.view = ML.fitAll([f], 10);
    return f;
  };
})(globalThis.Proses = globalThis.Proses || {});
