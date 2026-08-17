// The Storage lab, part four: the RAID workbench. An array of the student's level, layout, disks and chunk size
// (S.Raid over real bytes), drawn as disks across and stripes down. The message is written stripe by stripe, its
// parity worked bit by bit (and Q in GF(2⁸) for RAID 6), one or two disks fail, and every stripe is rebuilt from what
// survives, with the arithmetic of its first byte shown; the message is read back, and a small write is counted.
//   SL.raidCheck(v) -> 'why not' | null      SL.raidPlan(v) -> {A, stages, ...}      SL.raidRun(v, ctx)
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const R = () => S.Raid, GF = () => S.GF;
  const MIN = { 0: 2, 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 };
  const NAME = { 0: 'RAID 0', 1: 'RAID 1', 10: 'RAID 10', 4: 'RAID 4', 5: 'RAID 5', 6: 'RAID 6' };
  const MAXSTRIPES = 12;

  const bytesOf = (t) => S.Codes.bytes(String(t));
  const failedOf = (v) => [...new Set([v.rFail1, v.rFail2].filter((d) => d >= 0))].sort((a, b) => a - b);
  const shape = (v) => ({ level: v.rLevel, disks: v.rDisks, chunk: v.rChunk, layout: v.rLayout });
  /** stripes enough for the message (at least two, so a rotating parity is seen to move) */
  SL.raidStripes = function (v) {
    const w = R().width(R().create(Object.assign(shape(v), { stripes: 1 })));
    return Math.max(2, Math.ceil(bytesOf(v.rMsg).length / (w * v.rChunk)));
  };

  SL.raidCheck = function (v) {
    const lv = v.rLevel, n = v.rDisks;
    if (n < MIN[lv]) return NAME[lv] + ' needs at least ' + MIN[lv] + ' disks';
    if (lv === 10 && n % 2) return 'RAID 10 pairs its disks into mirrors: use an even number of disks';
    if (!String(v.rMsg).length) return 'Message to write: type a few characters';
    if ([...String(v.rMsg)].some((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32)) return 'Message to write: plain letters, digits and punctuation only';
    for (const d of failedOf(v)) if (d >= n) return 'Fail: disk ' + d + ', but the array has disks 0 to ' + (n - 1);
    const st = SL.raidStripes(v);
    if (st > MAXSTRIPES) return 'The message needs ' + st + ' stripes; at most ' + MAXSTRIPES + ' are drawn: use a larger chunk, more disks or a shorter message';
    if (!String(v.rSwText).length) return 'Small write: type at least one new byte';
    const cap = R().capacity(R().create(Object.assign(shape(v), { stripes: st })));
    if (v.rSwOff + String(v.rSwText).length > cap) return 'Small write: bytes ' + v.rSwOff + ' to ' + (v.rSwOff + String(v.rSwText).length - 1) + ' run past the array’s ' + cap + ' bytes';
    return null;
  };

  const snap = (A) => A.disk.map((u) => u.slice());

  SL.raidPlan = function (v) {
    const stripes = SL.raidStripes(v), A = R().create(Object.assign(shape(v), { stripes }));
    const w = R().width(A), msg = bytesOf(v.rMsg), lay = R().layoutTable(A), lost = failedOf(v);
    const empty = snap(A);
    const wr = R().write(A, 0, msg);
    const afterWrite = snap(A);
    const trace = wr.steps.map((s) => ({ kind: 'write-' + s.kind, stripe: s.stripe, say: s.say }));
    const fails = lost.map((d) => R().fail(A, d));
    trace.push(...fails.map((s) => ({ kind: 'fail', disk: s.disk, say: s.say })));
    let rb = null, rbErr = null;
    if (lost.length) {
      try { rb = R().rebuild(A, lost.length > 1 ? lost : lost[0]); } catch (e) { rbErr = e.message; }
    }
    if (rb) trace.push(...rb.steps.map((s) => ({ kind: 'rebuild', stripe: s.stripe, say: s.say })));
    if (rbErr) trace.push({ kind: 'lost', say: 'No rebuild: ' + rbErr + '.' });
    const afterRebuild = snap(A);
    let back = null, backErr = null;
    try { back = R().read(A, 0, msg.length); } catch (e) { backErr = e.message; }
    trace.push({ kind: 'read', say: back ? 'Read back: "' + String.fromCharCode(...back.bytes) + '".' : 'The read fails: ' + backErr + '.' });
    let sw = null, afterSmall = null;
    if (!rbErr) {
      sw = R().write(A, v.rSwOff, bytesOf(v.rSwText));
      afterSmall = snap(A);
      trace.push(...sw.steps.map((s) => ({ kind: 'small-' + s.kind, stripe: s.stripe, say: s.say })));
    }
    const costs = [];
    if (v.rLevel !== 0) for (let c = 1; c <= w; c++) costs.push(R().smallWrite({ level: v.rLevel, disks: v.rDisks, chunks: c }));
    return { A, w, msg, lay, lost, stripes, empty, wr, afterWrite, fails, rb, rbErr, afterRebuild, back, backErr, sw, afterSmall, costs, trace, dataStripes: Math.ceil(msg.length / (w * v.rChunk)) };
  };

  const show = (b) => (b === 32 ? '␣' : b === 0 ? '·' : b >= 33 && b <= 126 ? String.fromCharCode(b) : '.');
  const hexFit = (bytes, w, size) => { let t = SL.hexs(bytes); if (SL.tw(t, size, { mono: true }) <= w) return t; for (let k = bytes.length - 1; k >= 1; k--) { t = SL.hexs(bytes.slice(0, k)) + '…'; if (SL.tw(t, size, { mono: true }) <= w) return t; } return SL.hex2(bytes[0]); };
  const chunkOf = (disks, A, d, s) => [...disks[d].subarray(s * A.chunk, (s + 1) * A.chunk)];

  SL.raidRun = function (v, ctx) {
    const pl = SL.raidPlan(v), { A, w, lay, lost } = pl, narrow = ctx.narrow, n = A.n, C = A.chunk;
    const W = narrow ? 370 : 960, gx = 0, rowHeadW = 74, gap = 6;
    const cw = Math.max(34, Math.min(104, Math.floor(((narrow ? W : 560) - rowHeadW + gap) / n) - gap)), ch = 46;
    const gridH = 30 + pl.stripes * (ch + gap) - gap;
    const px = narrow ? 0 : rowHeadW + n * (cw + gap) + 34, py = narrow ? gridH + 70 : 0, pw = narrow ? W : W - px;
    const lostSet = new Set(lost);
    const roleName = (r) => (r.role === 'parity' ? 'P' : r.role === 'q' ? 'Q' : 'D' + r.chunk + (r.role === 'mirror' ? '′' : ''));
    /** the grid for one stage: o {disks, upTo (stripes shown filled), lostUpTo, rebuilt (stripes rebuilt), act: Set('s.d'), src: Set, wrote: Set} */
    function grid(o) {
      const cell = (s, d) => {
        const r = lay[s][d], k = s + '.' + d, sub = roleName(r);
        const isLost = o.lost && lostSet.has(d) && !(o.rebuilt !== undefined && s <= o.rebuilt);
        if (isLost) return { text: '', lines: [sub, '✗ lost'], cls: 'rd-lost', size: 13 };
        if (s > o.upTo) return { text: '', lines: [sub, ''], cls: 'rd-empty', size: 13 };
        const bytes = chunkOf(o.disks, A, d, s), par = r.role === 'parity' || r.role === 'q';
        const text = par ? hexFit(bytes, cw - 8, 13) : SL.fit(bytes.map(show).join(''), cw - 8, 13, { mono: true });
        let cls = par ? 'rd-par' + (r.role === 'q' ? ' q' : '') : 'rd-data' + (r.role === 'mirror' ? ' mirror' : '');
        if (o.rebuilt !== undefined && lostSet.has(d) && s <= o.rebuilt) cls = 'rd-new';
        if (o.src && o.src.has(k)) cls += ' src';
        if (o.act && o.act.has(k)) cls += ' act';
        return { text: '', lines: [sub, text], cls: cls + ' mono', size: 13 };
      };
      return S.Kit.disk.grid({ prefix: 'rg', x: gx, y: 0, n, rows: pl.stripes, cw, ch, gap, rowHeadW, size: 13,
        head: (d) => ({ text: 'disk ' + d, cls: o.lost && lostSet.has(d) && o.rebuilt === undefined ? 'bad' : 'strong' }),
        rowHead: (s) => 'stripe ' + s, cell }).items;
    }
    const legend = () => {
      const e = [{ cls: 'dk rd-data', text: 'data' }];
      if (v.rLevel === 1 || v.rLevel === 10) e.push({ cls: 'dk rd-data mirror', text: 'mirror copy' });
      if ([4, 5, 6].includes(v.rLevel)) e.push({ cls: 'dk rd-par', text: 'P parity' });
      if (v.rLevel === 6) e.push({ cls: 'dk rd-par q', text: 'Q parity' });
      if (lost.length) e.push({ cls: 'dk rd-lost', text: 'lost' }, { cls: 'dk rd-new', text: 'rebuilt' });
      e.push({ cls: 'rd-data src', text: 'read' }, { cls: 'rd-data act', text: 'written or worked out now' });
      return SL.legend('rl', 0, gridH + 22, e, narrow ? W : rowHeadW + n * (cw + gap), 12).items;
    };
    const panelTitle = (t) => SL.title('pt', px, py + 14, t);
    const para = (key, y, text, cls) => SL.para(key, px, y, text, pw, 13, cls || '');
    /** byte 0 of some chunks XORed, worked bit by bit */
    const bits = (rows, y, resLabel) => {
      const x = R().xorBits(rows.map((r) => r.b));
      const list = rows.map((r, i) => ({ label: r.label, hex: SL.hex2(r.b), bits: x.bits[i] })).concat([{ label: resLabel, hex: SL.hex2(x.out), bits: x.outBits, cls: 'res' }]);
      const bw = narrow ? 24 : 22;
      return S.Kit.disk.bits({ prefix: 'bx', x: px, y, rows: list, labelW: 96, bw, rh: 26, rule: rows.length, size: 13 });
    };
    const frames = [];
    const push = (items, say, title, at, extra) => frames.push(Object.assign({ items: items.concat(legend()), say, title, at: Math.max(0, Math.min(pl.trace.length - 1, at)), hold: 1500 }, extra || {}));
    const cap = R().capacity(A), tol = R().tolerance(A);

    // 1. the empty array
    {
      const items = grid({ disks: pl.empty, upTo: -1 });
      items.push(panelTitle(NAME[v.rLevel] + ', ' + n + ' disks, ' + SL.plural(C, 'byte') + ' a chunk'));
      const t = SL.plural(w, 'data chunk') + ' a stripe' + ([4, 5, 6].includes(v.rLevel) ? ' and ' + (v.rLevel === 6 ? 'two parity chunks, P and Q' : 'one parity chunk') : v.rLevel === 1 ? ', copied to all ' + n + ' disks' : v.rLevel === 10 ? ', each on a mirrored pair' : ', no redundancy') + '. Capacity ' + cap + ' of ' + n * C * pl.stripes + ' bytes (' + Math.round((100 * cap) / (n * C * pl.stripes)) + '%); ' + (tol ? 'it survives ' + SL.plural(tol, 'failed disk') + ' whichever fail' + (v.rLevel === 10 ? ', and more when they hit different mirrored pairs.' : '.') : 'it survives no failure at all: one lost disk loses data.');
      items.push(...para('pp', py + 26, t).items);
      push(items, 'An empty ' + NAME[v.rLevel] + ' array of ' + n + ' disks, ' + pl.stripes + ' stripes, chunks of ' + SL.plural(C, 'byte') + ': ' + t, 'empty', 0);
    }
    // 2. the message, stripe by stripe
    for (let s = 0; s < pl.dataStripes; s++) {
      const items = grid({ disks: pl.afterWrite, upTo: s, act: new Set(lay[s].map((r) => s + '.' + r.disk)) });
      const st = pl.wr.stripes.find((x) => x.stripe === s) || {};
      const says = pl.wr.steps.filter((x) => x.stripe === s && x.kind !== 'method').map((x) => x.say);
      items.push(panelTitle('writing stripe ' + s + (st.method ? ': ' + (st.method === 'full' ? 'a full stripe' : st.method === 'rmw' ? 'read-modify-write' : st.method === 'rcw' ? 'reconstruct-write' : st.method) : '')));
      let y = py + 26;
      for (const [i, line] of says.slice(0, narrow ? 3 : 6).entries()) { const p = para('pw' + i, y, line); items.push(...p.items); y += p.h + 4; }
      if (says.length > (narrow ? 3 : 6)) items.push(SL.text('pwm', px, y + 12, '… and ' + (says.length - (narrow ? 3 : 6)) + ' more in the trace', 'tick', 12));
      const at = pl.trace.findIndex((x) => x.stripe === s && /^write/.test(x.kind));
      const meth = pl.wr.steps.find((x) => x.stripe === s && x.kind === 'method');
      push(items, meth ? meth.say + ' ' + (says.find((x) => /arity/.test(x)) || '') : says.slice(0, 2).join(' ') + (says.length > 2 ? ' And ' + SL.plural(says.length - 2, 'more write') + '.' : ''), 'stripe ' + s, at);
    }
    // 3. the parity of stripe 0, worked bit by bit
    if ([4, 5, 6].includes(v.rLevel)) {
      const dd = lay[0].filter((r) => r.role === 'data').sort((a, b) => a.chunk - b.chunk), pd = lay[0].find((r) => r.role === 'parity').disk;
      const items = grid({ disks: pl.afterWrite, upTo: pl.dataStripes - 1, src: new Set(dd.map((r) => '0.' + r.disk)), act: new Set(['0.' + pd]) });
      items.push(panelTitle('stripe 0, byte 0: P = D0 ⊕ D1 ⊕ …'));
      const rows = dd.map((r) => ({ label: 'D' + r.chunk + ' "' + show(pl.afterWrite[r.disk][0]) + '"', b: pl.afterWrite[r.disk][0] }));
      const bx = bits(rows, py + 30, 'P');
      items.push(...bx.items);
      let say = 'P is the XOR of the data chunks, byte by byte: for byte 0, ' + rows.map((r) => SL.hex2(r.b)).join(' ⊕ ') + ' = ' + SL.hex2(pl.afterWrite[pd][0]) + '. A column with an odd number of 1s gives a 1.';
      if (v.rLevel === 6) {
        const qd = lay[0].find((r) => r.role === 'q').disk, y0 = py + 30 + bx.h + 22;
        const terms = dd.map((r) => ({ k: r.chunk, d: pl.afterWrite[r.disk][0], g: GF().gpow(r.chunk), m: GF().mul(GF().gpow(r.chunk), pl.afterWrite[r.disk][0]) }));
        items.push(SL.text('qt', px, y0, 'Q = ⊕ g^k · Dk in GF(2⁸), byte 0:', 'strong', 13));
        terms.forEach((x, i) => items.push(SL.text('qr' + i, px, y0 + 22 + i * 20, 'g^' + x.k + ' · ' + SL.hex2(x.d) + ' = ' + SL.hex2(x.g) + ' · ' + SL.hex2(x.d) + ' = ' + SL.hex2(x.m), 'mono', 13)));
        items.push(SL.text('qs', px, y0 + 22 + terms.length * 20 + 4, 'Q = ' + terms.map((x) => SL.hex2(x.m)).join(' ⊕ ') + ' = ' + SL.hex2(pl.afterWrite[qd][0]), 'mono act', 13));
        say += ' Q weights each chunk by a power of g = 2 before the XOR: ' + terms.map((x) => SL.hex2(x.m)).join(' ⊕ ') + ' = ' + SL.hex2(pl.afterWrite[qd][0]) + ', so two lost chunks give two equations.';
      }
      push(items, say, 'parity', pl.trace.findIndex((x) => x.kind === 'write-parity'));
    }
    // 4. the failure
    if (lost.length) {
      const items = grid({ disks: pl.afterWrite, upTo: pl.dataStripes - 1, lost: true });
      items.push(panelTitle(SL.plural(lost.length, 'disk') + ' fail' + (lost.length === 1 ? 's' : '')));
      const verdict = pl.rbErr ? 'Too many: ' + pl.rbErr + '. ' + (tol ? NAME[v.rLevel] + ' survives ' + SL.plural(tol, 'failure') + ' whichever disks fail.' : 'Every chunk on the lost disk is gone for good.') : 'The array survives: every lost chunk can be worked out from the disks that are left.';
      items.push(...para('pf', py + 26, 'Disk ' + SL.list(lost.map(String)) + ' ' + (lost.length === 1 ? 'is' : 'are') + ' gone, with everything on ' + (lost.length === 1 ? 'it' : 'them') + '. ' + verdict, pl.rbErr ? 'bad' : '').items);
      push(items, pl.fails.map((f) => f.say).join(' ') + ' ' + verdict, 'failure', pl.trace.findIndex((x) => x.kind === 'fail'));
    }
    // 5. the rebuild, stripe by stripe
    if (pl.rb) pl.rb.steps.forEach((st, i) => {
      const s = st.stripe, src = new Set((st.from || []).map((d) => s + '.' + d)), act = new Set(lost.map((d) => s + '.' + d));
      const items = grid({ disks: pl.afterRebuild, upTo: pl.stripes - 1, lost: true, rebuilt: s, src, act });
      items.push(panelTitle('rebuilding stripe ' + s + ' (' + (st.how === 'pq' ? 'from P and Q' : st.how === 'q' ? 'from Q' : st.how === 'mirror' ? 'a copy' : st.how === 'recompute' ? 'parity recomputed' : 'XOR') + ')'));
      let y = py + 26;
      if ((st.how === 'xor' || st.how === 'p') && st.from && st.from.length) {
        const from = st.from.filter((d) => !lostSet.has(d)), d0 = st.chunks.find((c) => c.role === 'data') || st.chunks[0];
        const rows = from.map((d) => ({ label: 'disk ' + d + ' ' + roleName(lay[s][d]), b: pl.afterRebuild[d][s * C] }));
        const bx = bits(rows, y + 4, roleName(lay[s][d0.disk]));
        items.push(...bx.items);
        y += bx.h + 16;
      }
      items.push(...para('pr', y, SL.cap(st.say.replace(/^Stripe \d+: /, '')), '').items);
      push(items, st.say, 'rebuild ' + s, pl.trace.findIndex((x) => x.kind === 'rebuild' && x.stripe === s));
    });
    // 6. reading the message back
    {
      const items = grid({ disks: pl.afterRebuild, upTo: pl.stripes - 1, lost: !!pl.rbErr });
      items.push(panelTitle('reading the message back'));
      const got = pl.back ? String.fromCharCode(...pl.back.bytes) : null, ok = got === String(v.rMsg);
      const text = got === null ? 'The read fails: ' + pl.backErr + '. With ' + SL.plural(lost.length, 'disk') + ' gone, ' + NAME[v.rLevel] + ' has lost data.' : '"' + got + '" ' + (ok ? (lost.length ? '— every byte back, rebuilt from the survivors.' : '— every byte, as written.') : '— not what was written.');
      items.push(...para('pb', py + 26, text, got === null || !ok ? 'bad' : 'good').items);
      push(items, (got === null ? 'The message cannot be read: ' + pl.backErr + '.' : 'Read back: "' + got + '"' + (ok ? ', the same as written.' : '.')) + (lost.length && !pl.rbErr ? ' The rebuilt disks hold exactly what was lost.' : ''), 'read', pl.trace.findIndex((x) => x.kind === 'read'));
    }
    // 7. a small write, counted
    if (pl.sw) {
      const rd = new Set(pl.sw.steps.filter((x) => x.kind === 'read-old').map((x) => x.stripe + '.' + x.disk));
      const wrt = new Set(pl.sw.steps.filter((x) => ['data', 'parity', 'q'].includes(x.kind)).map((x) => x.stripe + '.' + x.disk));
      const items = grid({ disks: pl.afterSmall, upTo: pl.stripes - 1, src: rd, act: wrt });
      const txt = String(v.rSwText);
      items.push(panelTitle('a small write: "' + SL.fit(txt, 120, 13) + '" at byte ' + v.rSwOff));
      const m = pl.sw.stripes.map((x) => 'stripe ' + x.stripe + ' by ' + (x.method === 'rmw' ? 'read-modify-write' : x.method === 'rcw' ? 'reconstruct-write' : x.method === 'full' ? 'a full-stripe write' : x.method)).join(', ');
      let y = py + 26;
      const p1 = para('ps', y, SL.cap(m) + ': ' + SL.plural(pl.sw.reads, 'read') + ' and ' + SL.plural(pl.sw.writes, 'write') + ' = ' + (pl.sw.reads + pl.sw.writes) + ' disk I/Os for ' + SL.plural(txt.length, 'byte') + '. Read cells are outlined, written cells lit.', '');
      items.push(...p1.items);
      y += p1.h + 12;
      if (pl.costs.length) {
        const cols = [{ w: 64, label: 'chunks' }, { w: 84, label: 'full' }, { w: 84, label: 'RMW' }, { w: 84, label: 'RCW' }];
        const rows = pl.costs.map((c, i) => ({ key: 'c' + i, cells: [String(c.chunks), c.full.reads + 'r ' + c.full.writes + 'w', { text: c.rmw.reads + 'r ' + c.rmw.writes + 'w', cls: c.best === 'rmw' ? 'best' : '' }, { text: c.rcw.reads + 'r ' + c.rcw.writes + 'w', cls: c.best === 'rcw' ? 'best' : '' }] }));
        items.push(SL.text('ct', px, y + 4, 'writing k chunks of one stripe costs', 'tick', 12));
        items.push(...S.Kit.gantt.table({ prefix: 'cs', x: px, y: y + 12, cols, rows: rows.slice(0, 8), rowH: 24, size: 12 }).items);
      }
      push(items, 'Writing "' + txt + '" at byte ' + v.rSwOff + '. ' + (pl.sw.steps.filter((x) => x.kind === 'method').map((x) => x.say).join(' ') || pl.sw.steps.map((x) => x.say).slice(0, 2).join(' ')) + ' In all ' + SL.plural(pl.sw.reads, 'read') + ' and ' + SL.plural(pl.sw.writes, 'write') + (v.rLevel === 0 ? '.' : ': the small-write penalty.'), 'small write', pl.trace.findIndex((x) => /^small/.test(x.kind)));
    }

    // the side panel
    const disks = (snapD) => pl.lay.map((row, s) => [String(s)].concat(row.map((r) => (lostSet.has(r.disk) && snapD === null ? '✗' : roleName(r) + ' ' + SL.hexs(chunkOf(snapD || pl.afterRebuild, A, r.disk, s))))));
    const tables = [{ title: 'Every chunk (role, then its bytes in hex)', cols: ['stripe'].concat(Array.from({ length: n }, (_, d) => 'disk ' + d)), rows: disks(pl.afterSmall || pl.afterRebuild) }];
    if (pl.costs.length) tables.push({ title: 'Small writes: reads and writes for k chunks of one stripe', cols: ['k', 'full stripe', 'read-modify-write', 'reconstruct-write', 'fewer reads'], rows: pl.costs.map((c) => [String(c.chunks), c.full.reads + ' + ' + c.full.writes, c.rmw.reads + ' + ' + c.rmw.writes, c.rcw.reads + ' + ' + c.rcw.writes, c.best]) });
    const metrics = [
      { label: 'Capacity', value: cap + ' bytes', note: Math.round((100 * cap) / (n * C * pl.stripes)) + '% of the raw ' + n * C * pl.stripes },
      { label: 'Survives', value: SL.plural(tol, 'failed disk'), note: 'whichever fail' },
      { label: 'Writing the message', value: pl.wr.reads + ' reads, ' + pl.wr.writes + ' writes' },
      { label: 'Disks failed', value: lost.length ? lost.join(', ') : 'none', cls: pl.rbErr ? 'bad' : lost.length ? 'act' : '' },
      { label: 'Rebuild', value: pl.rbErr ? 'impossible' : pl.rb ? SL.plural(pl.rb.steps.length, 'stripe') : '–', cls: pl.rbErr ? 'bad' : pl.rb ? 'good' : '' },
    ];
    if (pl.sw) metrics.push({ label: 'Small write', value: (pl.sw.reads + pl.sw.writes) + ' I/Os', note: pl.sw.reads + ' reads + ' + pl.sw.writes + ' writes for ' + SL.plural(String(v.rSwText).length, 'byte') });
    return { frames, trace: pl.trace, tables, metrics, plan: pl };
  };
})(globalThis.Proses = globalThis.Proses || {});
