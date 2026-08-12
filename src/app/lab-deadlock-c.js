// The Deadlock lab, part three: the banker's algorithm and detection with recovery, on the student's own matrices.
// The banker: Allocation, Max and Available; a request is tested against Need and Available, then pretended (the
// pretended state drawn inside a dashed ghost frame) and the safety check run on it row by row with Work and Finish
// (S.Banker.request / S.Banker.safety); granted or refused with the reason, the ghost of the pretended state kept
// beside the outcome. Detection: the same scan with Request in place of Need (S.Banker.detect), then recovery by
// termination in cost order (S.Banker.terminate) or by preemption with rollback to checkpoints (S.Banker.preempt).
//   DL.runBank(v, ctx), DL.runDetect(v, ctx) -> lab results
(function (S) {
  'use strict';
  const DL = S.DlLab, KB = () => S.Kit.bank;
  const T = (...a) => DL.text(...a), vec = DL.vec;
  const resOf = (m) => DL.RES.slice(0, m).split('');

  /** the tables: v = {alloc, max, need, needTitle, avail, work, finish, row, fits, seq, ledger, unsafe, stuck, changed,
   *  req: {i, req}, tests, verdict, verdictCls, zero, ghost: {label}, after: [lines]} */
  DL.bankPic = function (n, m, v, narrow) {
    const items = [], K = KB(), cw = narrow ? 36 : 40, ch = 30, size = 15, W = m * (cw + 3) - 3, gap = 30, x0 = 34, y0 = 84;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), res = resOf(m);
    const rowCls = (i) => (v.row === i ? 'act' : v.finish && v.finish[i] ? 'good' : v.stuck && v.stuck.includes(i) ? 'bad' : '');
    const chg = (t, i, j) => (v.changed && v.changed.has(t + i + '_' + j) ? ' req' : '');
    const showMax = v.max && !narrow;
    const ax = x0, mx = ax + W + gap, nx = showMax ? mx + W + gap : mx, fx = nx + W + gap;
    items.push(...K.matrix({ prefix: 'al', x: ax, y: y0, cw, ch, size, title: 'Allocation', cols: res, rows: P, vals: v.alloc, rowCls, cls: (i, j) => (v.row === i && v.fits ? 'good' : '') + chg('a', i, j) + (v.zero && v.zero.includes(i) ? ' faded' : '') }).items);
    if (showMax) items.push(...K.matrix({ prefix: 'mx', x: mx, y: y0, cw, ch, size, title: 'Max', cols: res, rows: null, vals: v.max }).items);
    const needCls = (i, j) => {
      if (!v.need) return 'faded';
      if (v.row === i && v.work) return v.fits ? 'good' : v.need[i][j] > v.work[j] ? 'hot' : 'act';
      return (v.finish && v.finish[i] ? 'faded' : '') + chg('n', i, j);
    };
    items.push(...K.matrix({ prefix: 'nd', x: nx, y: y0, cw, ch, size, title: v.needTitle || 'Need', cols: res, rows: null, vals: v.need || v.alloc.map((r) => r.map(() => '')), cls: needCls, titleCls: v.needAct ? 'act' : '' }).items);
    if (v.finish) items.push(...K.finish({ prefix: 'fn', x: fx, y: y0, cw: 58, ch, vals: v.finish, title: 'Finish', cls: (i) => (v.row === i ? 'act' : '') }).items);
    const right = v.finish ? fx + 58 : fx - gap;
    const by = y0 + n * (ch + 3) + 26;
    if (v.ghost) {
      const lw = DL.tw(v.ghost.label, 13, { bold: true }) + 20, below = narrow || lw > right - 96 - m * (cw + 3);
      items.push({ key: 'gh', kind: 'region', x: -8, y: y0 - 54, w: Math.max(right + 22, below ? lw : 0), h: by + 2 * ch + (below ? 46 : 22) - (y0 - 54), rx: 10, text: '', cls: 'dlghost', audit: 'group' });
      items.push(below ? T('gh:t', 2, by + 2 * ch + 30, v.ghost.label, 'dlghost-l', 13) : T('gh:t', right + 4, by + 2 * ch + 4, v.ghost.label, 'dlghost-l', 13, 'end'));
    }
    items.push(...K.vector({ prefix: 'av', x: 0, y: by, cw, ch, size, title: 'Available', titleW: 96, vals: v.avail, cls: (j) => (v.changed && v.changed.has('v' + j) ? 'req' : '') }).items);
    if (v.work) items.push(...K.vector({ prefix: 'wk', x: 0, y: by + ch + 10, cw, ch, size, title: 'Work', titleW: 96, vals: v.work, cls: (j) => (v.row !== undefined && v.row >= 0 ? (v.fits ? 'good' : v.need[v.row][j] > v.work[j] ? 'hot' : 'act') : ''), titleCls: v.row !== undefined && v.row >= 0 ? 'act' : '' }).items);
    const lx = narrow ? 0 : Math.max(96 + m * (cw + 3) + 30, right + 40), ly = narrow ? by + (v.work ? 2 * ch + 40 : ch + 30) + (v.ghost ? 30 : 0) : y0 - 34;
    const lines = (v.ledger || []).slice(narrow ? -3 : -6);
    if (v.ledger) items.push(DL.title('lg:t', lx, ly - (narrow ? 0 : 0), 'the check, so far'));
    lines.forEach((t, k) => items.push({ key: 'lg:' + (v.ledger.length - lines.length + k), kind: 'text', x: lx, y: ly + 22 + k * 22, text: t, size: 14, cls: 'ledger' + (k === lines.length - 1 && v.fits ? ' act' : '') }));
    // room for the ledger's widest line (monospace runs wider on some screens than the estimate)
    if (v.ledger) items.push({ key: 'lg:room', kind: 'dot', x: Math.round(lx + Math.max(...v.ledger.map((t) => DL.tw(t, 14, { mono: true }))) * 1.15 + 12), y: ly + 22, r: 0.5, cls: 'nobox', audit: 'ignore', layer: 'back' });
    let y = narrow ? ly + (v.ledger ? 22 + Math.max(1, lines.length) * 22 + 20 : 0) : by + (v.work ? 2 * ch + 46 : ch + 36);
    if (v.seq) {
      const sq = K.seq({ prefix: 'sq', x: 0, y, names: v.seq.map((i) => P[i]), title: v.seqTitle || 'safe sequence', titleW: 124, w: 40, gap: 18, cls: () => (v.unsafe ? 'hot' : '') });
      items.push(...sq.items);
      if (v.unsafe) items.push({ key: 'sq:stuck', kind: 'text', x: 124 + (v.seq.length ? sq.w - 124 + 18 : 0), y: y + 20, text: v.seq.length ? 'then nobody can finish' : 'nobody can finish', size: 15, cls: 'verdict2 hot' });
      y += 50;
    }
    if (v.req) {
      items.push(...K.vector({ prefix: 'rq', x: 0, y, cw, ch, size, title: P[v.req.i] + ' asks', titleW: 96, vals: v.req.req, cls: () => 'req' }).items);
      const tx = narrow ? 0 : 96 + m * (cw + 3) + 30, ty = narrow ? y + ch + 24 : y - 2;
      (v.tests || []).forEach((t, k) => items.push({ key: 'rt:' + k, kind: 'text', x: tx, y: ty + 14 + k * 22, text: t.text, size: 14, cls: t.ok === true ? 'good' : t.ok === false ? 'hot' : 'strong' }));
      y = narrow ? ty + (v.tests || []).length * 22 + 12 : y + Math.max(ch, (v.tests || []).length * 22);
      if (v.verdict) items.push(T('rv', 0, y + 30, v.verdict, 'verdict2 ' + (v.verdictCls || ''), 16));
      y += 40;
    }
    if (v.after) {
      const gx = narrow ? 0 : right + 52, gy = narrow ? y + 20 : y0 - 34, w = Math.max(DL.tw((v.afterTitle || '').toUpperCase(), 13, { bold: true }) * 1.18 + 28, ...v.after.map((l) => DL.tw(l, 14, { mono: true }) + 30));
      items.push({ key: 'ga', kind: 'region', x: gx - 12, y: gy - 6, w, h: 30 + v.after.length * 22, rx: 8, text: '', cls: 'dlghost', audit: 'group' });
      items.push(DL.title('ga:t', gx, gy + 12, v.afterTitle || 'the pretended state'));
      v.after.forEach((l, k) => items.push({ key: 'ga:' + k, kind: 'text', x: gx, y: gy + 34 + k * 22, text: l, size: 14, cls: 'ledger dlghost-t' }));
    }
    return items;
  };

  /** frames of one safety (or detection) check on the tables s */
  DL.safetyFrames = function (s, safety, extra, P) {
    const out = [], ledger = [];
    for (const st of safety.steps) {
      if (st.kind === 'start') { ledger.push('Work = ' + vec(st.work)); out.push({ v: Object.assign({}, s, extra, { work: st.work, finish: st.finish, seq: [], ledger: ledger.slice() }), say: DL.plain(st.say), title: 'Work = Available', kind: 'start', step: st }); continue; }
      if (st.kind === 'check') {
        if (st.fits) ledger.push(P[st.i] + ' done: Work = ' + vec(st.after));
        out.push({ v: Object.assign({}, s, extra, { work: st.fits ? st.after : st.work, row: st.i, fits: st.fits, finish: st.finish, seq: safety.seq.filter((i) => st.finish[i]), ledger: ledger.slice() }), say: DL.plain(st.say), title: (st.pass > 1 ? 'pass ' + st.pass + ' · ' : '') + st.short, kind: 'check', step: st });
        continue;
      }
      const stuck = (st.stuck || []).concat(st.deadlocked || []);
      out.push({ v: Object.assign({}, s, extra, { work: st.work || safety.work, finish: st.finish || safety.finish, seq: st.seq || safety.seq, ledger: ledger.slice(), unsafe: st.kind === 'unsafe' || st.kind === 'deadlock', stuck }), say: DL.plain(st.say), title: st.short || st.kind, kind: st.kind, step: st });
    }
    return out;
  };

  const needTable = (title, need, P, m, hl) => ({ title, cols: ['', ...resOf(m)], rows: need.map((r, i) => [P[i], ...r.map(String)]), hl });

  DL.runBank = function (v, ctx) {
    const narrow = ctx.narrow, B = S.Banker, alloc = v.alloc, max = v.max, avail = v.avail, n = alloc.length, m = avail.length;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), need = B.need(max, alloc), frames = [], trace = [];
    const head = (t) => [DL.title('tt', 0, 14, t)];
    const push = (title, items, say, kind, o) => { o = o || {}; trace.push(Object.assign({ kind, say }, o.step ? { i: o.step.i } : {})); frames.push({ items, say, title, at: trace.length - 1, tables: [needTable('Need = Max − Allocation', o.need || need, P, m, o.hl)].concat(o.tables || []), metrics: o.metrics, hold: o.hold }); };
    const base = { alloc, max, avail, need };
    if (v.bkind === 'safety') {
      const sf = B.safety({ avail, alloc, need });
      const tt = head(n + ' processes, ' + m + ' resource types: is this state safe?');
      push('the tables', tt.concat(DL.bankPic(n, m, Object.assign({}, base, { need: null }), narrow)), `Allocation is what each process holds, Max the most it may ever hold, and Available \`${vec(avail)}\` what is free.`, 'tables', { metrics: [{ label: 'Processes', value: n }, { label: 'Resource types', value: m }] });
      push('Need', tt.concat(DL.bankPic(n, m, Object.assign({}, base, { needAct: true }), narrow)), `Need = Max − Allocation is what each may still ask for: P0 may still need \`${vec(need[0])}\`` + (n > 1 ? `, P${n - 1} \`${vec(need[n - 1])}\`.` : '.'), 'need', { metrics: [{ label: 'Processes', value: n }, { label: 'Resource types', value: m }] });
      for (const f of DL.safetyFrames(base, sf, {}, P)) push(f.title, tt.concat(DL.bankPic(n, m, f.v, narrow)), f.say, f.kind, { step: f.step, hl: f.step.i, metrics: [{ label: 'Work', value: vec(f.v.work) }, { label: 'Finished', value: f.v.finish.filter(Boolean).length + ' of ' + n }, { label: 'Verdict', value: f.kind === 'safe' ? 'safe' : f.kind === 'unsafe' ? 'unsafe' : '…', cls: f.kind === 'safe' ? 'good' : f.kind === 'unsafe' ? 'bad' : '' }] });
      frames[frames.length - 1].hold = 3000;
      const lastF = frames[frames.length - 1];
      return { frames, trace, tables: lastF.tables, metrics: [{ label: 'Verdict', value: sf.safe ? 'safe' : 'unsafe', cls: sf.safe ? 'good' : 'bad' }, { label: 'Safe sequence', value: sf.safe ? sf.seq.map((i) => P[i]).join(' ') : '–' }, { label: 'Rows checked', value: sf.steps.filter((s) => s.kind === 'check').length }], bank: sf };
    }
    const i = v.who, req = v.req, R = B.request({ avail, alloc, max }, i, req), Pi = P[i];
    const tt = head(Pi + ' asks for ' + vec(req));
    const sum = (verdict) => [{ label: 'Request', value: Pi + ' ' + vec(req) }, { label: 'Need of ' + Pi, value: vec(need[i]) }, { label: 'Available', value: vec(avail) }, { label: 'Verdict', value: verdict || '…', cls: verdict === 'granted' ? 'good' : verdict ? 'bad' : '' }];
    const reqB = Object.assign({}, base, { req: { i, req } });
    const tests = [];
    push('the request', tt.concat(DL.bankPic(n, m, Object.assign({}, reqB, { tests: [] }), narrow)), `${Pi} asks for \`${vec(req)}\`. Its Need is \`${vec(need[i])}\` and Available is \`${vec(avail)}\`. Three tests decide: within its Need, within what is free, and a safe state after.`, 'ask', { hl: i, metrics: sum() });
    const s0 = R.steps[0];
    if (R.verdict === 'over-need') {
      push('over its claim', tt.concat(DL.bankPic(n, m, Object.assign({}, reqB, { tests: [{ text: '1. Request ≤ Need ' + vec(need[i]) + '?  no', ok: false }], verdict: 'refused: over its declared claim', verdictCls: 'hot' }), narrow)), DL.plain(s0.say), 'over-need', { hl: i, metrics: sum('refused: over its claim'), hold: 3000 });
      return { frames, trace, tables: frames[frames.length - 1].tables, metrics: sum('refused: over its claim'), bank: R };
    }
    tests.push({ text: '1. Request ≤ Need ' + vec(need[i]) + '?  yes', ok: true });
    push('within its Need', tt.concat(DL.bankPic(n, m, Object.assign({}, reqB, { tests: tests.slice() }), narrow)), DL.plain(s0.say), 'req-need', { hl: i, metrics: sum() });
    if (R.verdict === 'wait') {
      tests.push({ text: '2. Request ≤ Available ' + vec(avail) + '?  no', ok: false });
      push('must wait', tt.concat(DL.bankPic(n, m, Object.assign({}, reqB, { tests: tests.slice(), verdict: 'must wait: not enough is free', verdictCls: 'hot' }), narrow)), DL.plain(R.steps[1].say), 'wait', { hl: i, metrics: sum('waits: not enough free'), hold: 3000 });
      return { frames, trace, tables: frames[frames.length - 1].tables, metrics: sum('waits: not enough free'), bank: R };
    }
    tests.push({ text: '2. Request ≤ Available ' + vec(avail) + '?  yes', ok: true });
    const pre = R.steps[1].state, changed = new Set();
    req.forEach((x, j) => { if (x) { changed.add('a' + i + '_' + j); changed.add('n' + i + '_' + j); changed.add('v' + j); } });
    const ghost = { label: 'pretend: ' + Pi + ' has been given ' + vec(req) + ' (not yet real)' };
    const sP = { alloc: pre.alloc, max, avail: pre.avail, need: pre.need, changed, req: { i, req }, ghost };
    push('pretend', tt.concat(DL.bankPic(n, m, Object.assign({}, sP, { tests: tests.concat([{ text: '3. Pretend to grant: is that state safe?', ok: null }]) }), narrow)), DL.plain(R.steps[1].say) + ' The dashed frame marks the pretended state: the cells that changed are blue.', 'pretend', { hl: i, need: pre.need, metrics: sum() });
    for (const f of DL.safetyFrames(sP, R.safety, { tests: tests.concat([{ text: '3. Safety check of the pretended state', ok: null }]) }, P)) push('pretend · ' + f.title, tt.concat(DL.bankPic(n, m, f.v, narrow)), f.say, f.kind, { step: f.step, hl: f.step.i, need: pre.need, metrics: sum().slice(0, 3).concat([{ label: 'Work (pretended)', value: vec(f.v.work) }]) });
    const ok = R.verdict === 'granted', last = R.steps[R.steps.length - 1];
    const t3 = { text: ok ? '3. The pretended state is safe' : '3. The pretended state is unsafe', ok };
    const after = ['Available ' + vec(pre.avail), Pi + ': Allocation ' + vec(pre.alloc[i]) + ', Need ' + vec(pre.need[i]), ok ? 'safe: ⟨' + R.safety.seq.map((k) => P[k]).join(', ') + '⟩' : 'unsafe: Work stops at ' + vec(R.safety.work)];
    const fin = ok ? Object.assign({}, sP, { ghost: null, tests: tests.concat([t3]), seq: R.safety.seq, verdict: 'granted: the pretended state becomes real', verdictCls: 'good', after, afterTitle: 'the pretended state, now real' })
      : Object.assign({}, reqB, { tests: tests.concat([t3]), verdict: 'refused: unsafe, so ' + Pi + ' waits', verdictCls: 'hot', after, afterTitle: 'the ghost of the pretended state, undone' });
    push(ok ? 'granted' : 'refused', tt.concat(DL.bankPic(n, m, fin, narrow)), DL.plain(last.say) + (ok ? '' : ` Work would have stopped at \`${vec(R.safety.work)}\` with ${DL.list(R.safety.finish.map((f, k) => (f ? null : P[k])).filter(Boolean))} unable to finish.`), ok ? 'granted' : 'denied', { hl: i, need: ok ? pre.need : need, metrics: sum(ok ? 'granted' : 'refused: unsafe'), hold: 3000 });
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: sum(ok ? 'granted' : 'refused: unsafe'), bank: R };
  };

  // ---- detection and recovery -------------------------------------------------------------------------------------
  /** the recovery picture: Allocation, Request, the costs, each process's state, Available */
  const recPic = (n, m, st, o, narrow) => {
    const K = KB(), cw = narrow ? 36 : 40, ch = 30, size = 15, W = m * (cw + 3) - 3, gap = 28, x0 = 34, y0 = 84;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), res = resOf(m), items = [];
    const rowCls = (i) => (o.victim === i ? 'act' : o.gone && o.gone.includes(i) ? 'bad' : o.dead && o.dead.includes(i) ? 'bad' : '');
    const ch2 = (i, j, t) => (o.victim === i && o.freed && o.freed[j] ? (t === 'r' ? ' req' : ' hot') : '');
    items.push(...K.matrix({ prefix: 'al', x: x0, y: y0, cw, ch, size, title: 'Allocation', cols: res, rows: P, vals: st.alloc, rowCls, cls: (i, j) => ch2(i, j, 'a') + (o.gone && o.gone.includes(i) ? ' faded' : '') }).items);
    items.push(...K.matrix({ prefix: 'rq', x: x0 + W + gap, y: y0, cw, ch, size, title: 'Request', cols: res, rows: null, vals: st.request, cls: (i, j) => ch2(i, j, 'r') + (o.gone && o.gone.includes(i) ? ' faded' : '') }).items);
    const cx = x0 + 2 * (W + gap);
    items.push(...K.matrix({ prefix: 'co', x: cx, y: y0, cw: 50, ch, size, title: o.costTitle || 'cost', cols: [''], rows: null, vals: o.costs.map((c) => [c]), cls: (i) => (o.victim === i ? 'act' : '') }).items);
    const fx = cx + 50 + gap;
    items.push(DL.title('st', fx, y0 - 34, 'state'));
    P.forEach((p, i) => { const t = o.gone && o.gone.includes(i) ? 'aborted' : o.dead && o.dead.includes(i) ? 'deadlocked' : o.rolled && o.rolled[i] ? 'rolled back ×' + o.rolled[i] : st.request[i].some((x) => x) ? (o.clear ? 'can finish' : 'waiting') : 'can go on'; items.push({ key: 'sx' + i, kind: 'cell', x: fx, y: y0 + i * (ch + 3), w: 124, h: ch, rx: 5, text: t, size: 13, cls: 'tag ' + (t === 'deadlocked' ? 'hot' : t === 'aborted' ? 'done' : t === 'can go on' || t === 'can finish' ? 'good' : t === 'waiting' ? '' : 'act') }); });
    const by = y0 + n * (ch + 3) + 26;
    items.push(...K.vector({ prefix: 'av', x: 0, y: by, cw, ch, size, title: 'Available', titleW: 96, vals: st.avail, cls: (j) => (o.freed && o.freed[j] ? 'req' : '') }).items);
    if (o.verdict) items.push(T('vd', 0, by + ch + 34, o.verdict, 'verdict2 ' + (o.vcls || ''), 16));
    return items;
  };

  DL.runDetect = function (v, ctx) {
    const narrow = ctx.narrow, B = S.Banker, alloc = v.dAlloc, request = v.dReq, avail = v.dAvail, n = alloc.length, m = avail.length;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), cost = v.cost.slice(0, n), frames = [], trace = [];
    const o = { avail, alloc, request };
    const d = B.detect(o), checks = d.steps.filter((s) => s.kind === 'check'), lastC = checks[checks.length - 1], st0 = d.steps[0];
    const seq = checks.filter((c) => c.fits).map((c) => c.i);
    const work = lastC ? lastC.after : st0.work, finish = lastC ? lastC.finish : st0.finish;
    const safety = { steps: d.steps.map((s) => (s.kind === 'deadlock' || s.kind === 'clear' ? Object.assign({}, s, { work, finish, seq }) : s)), seq, work, finish };
    const zero = alloc.map((r, i) => (r.every((x) => !x) ? i : -1)).filter((i) => i >= 0);
    const tt = (t) => [DL.title('tt', 0, 14, t)];
    const mats = (st) => [{ title: 'Allocation, Request', cols: ['', ...resOf(m).map((r) => r + ' held'), ...resOf(m).map((r) => r + ' asked')], rows: st.alloc.map((r, i) => [P[i], ...r.map(String), ...st.request[i].map(String)]) }];
    const push = (title, items, say, kind, st, metrics, hold) => { trace.push({ kind, say }); frames.push({ items, say, title, at: trace.length - 1, tables: mats(st), metrics, hold }); };
    const detM = (f) => [{ label: 'Work', value: vec(f.v.work) }, { label: 'Can finish', value: f.v.finish.filter(Boolean).length + ' of ' + n }, { label: 'Deadlocked', value: f.kind === 'deadlock' ? DL.list(d.deadlocked.map((i) => P[i])) : f.kind === 'clear' ? 'nobody' : '…', cls: f.kind === 'deadlock' ? 'bad' : f.kind === 'clear' ? 'good' : '' }];
    const base = { alloc, max: null, need: request, needTitle: 'Request', avail, zero };
    const T1 = tt('detection: ' + n + ' processes, ' + m + ' resource types');
    push('the tables', T1.concat(DL.bankPic(n, m, base, narrow)), `Allocation is what each holds, Request what each is waiting for now, and Available \`${vec(avail)}\` is free.` + (zero.length ? ` ${DL.list(zero.map((i) => P[i]))} ${zero.length > 1 ? 'hold' : 'holds'} nothing, so Finish starts true for ${zero.length > 1 ? 'them' : 'it'}: nobody can wait on ${zero.length > 1 ? 'them' : 'it'}.` : ''), 'tables', o, [{ label: 'Processes', value: n }, { label: 'Resource types', value: m }]);
    for (const f of DL.safetyFrames(base, safety, { seqTitle: 'can finish, in order' }, P)) push(f.title, T1.concat(DL.bankPic(n, m, f.v, narrow)), f.say.replace(/Need/g, 'Request'), f.kind, o, detM(f));
    if (v.recover === 'none' || !d.deadlocked.length) {
      frames[frames.length - 1].hold = 3000;
      return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, det: d };
    }
    if (v.recover === 'rollback') {
      const ck = v.ckpt.slice(0, n), pen = v.penalty, Rb = B.preempt({ avail, alloc, request, cost, checkpoint: ck, penalty: pen });
      const rolled = Array(n).fill(0), eff = () => cost.map((c, i) => c + pen * rolled[i]);
      const T2 = tt('recovery: roll back the cheapest, then look again');
      const mk = (st) => ({ avail: st.avail, alloc: st.alloc, request: st.request });
      push('checkpoints', T2.concat(recPic(n, m, o, { costs: eff(), costTitle: 'cost now', dead: d.deadlocked }, narrow)), `To recover, take units back by rollback. Each process saved a checkpoint: ${DL.list(ck.map((r, i) => P[i] + ' ' + vec(r)))}. Rolling one back costs ${DL.list(cost.map((c, i) => P[i] + ' ' + c))}, plus ${pen} for each earlier rollback of it.`, 'checkpoints', o, [{ label: 'Rollbacks', value: 0 }]);
      Rb.steps.forEach((st) => {
        if (st.kind === 'detect') push('detect', T2.concat(recPic(n, m, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice() }, narrow)), DL.plain(st.say), 'detect', mk(st), [{ label: 'Rollbacks', value: rolled.reduce((a, b) => a + b, 0) }, { label: 'Deadlocked', value: DL.list(st.deadlocked.map((i) => P[i])), cls: 'bad' }]);
        else if (st.kind === 'rollback') { rolled[st.i]++; push('roll back P' + st.i, T2.concat(recPic(n, m, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice(), victim: st.i, freed: st.freed }, narrow)), DL.plain(st.say) + ` Its cost for next time is \`${eff()[st.i]}\`.`, 'rollback', mk(st), [{ label: 'Rollbacks', value: rolled.reduce((a, b) => a + b, 0) }, { label: 'Victim', value: P[st.i], cls: 'act' }]); }
        else if (st.kind === 'stuck') push('stuck', T2.concat(recPic(n, m, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice(), verdict: 'rollback cannot help: one must be aborted', vcls: 'hot' }, narrow)), DL.plain(st.say), 'stuck', mk(st), [{ label: 'Rollbacks', value: rolled.reduce((a, b) => a + b, 0) }, { label: 'Outcome', value: 'stuck', cls: 'bad' }], 3000);
        else push('clear', T2.concat(recPic(n, m, st, { costs: eff(), costTitle: 'cost now', rolled: rolled.slice(), clear: true, verdict: 'recovered: nobody killed, ' + DL.plural(Rb.victims.length, 'rollback'), vcls: 'good' }, narrow)), DL.plain(st.say) + ` ${DL.plural(Rb.victims.length, 'rollback')} in all, and nobody was killed.`, 'clear', mk(st), [{ label: 'Rollbacks', value: Rb.victims.length }, { label: 'Outcome', value: 'recovered', cls: 'good' }], 3000);
      });
      return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, det: d, rec: Rb };
    }
    const policy = v.recover === 'all' ? 'all' : 'cheapest', Rt = B.terminate({ avail, alloc, request, cost }, { policy });
    const gone = [];
    let lost = 0;
    const T2 = tt(policy === 'all' ? 'recovery: abort every deadlocked process' : 'recovery: abort the cheapest, then look again');
    push('costs', T2.concat(recPic(n, m, o, { costs: cost, dead: d.deadlocked }, narrow)), `To recover, abort processes. The cost of aborting each: ${DL.list(cost.map((c, i) => P[i] + ' ' + c))}.` + (policy === 'all' ? ' Every deadlocked process goes at once.' : ' The cheapest deadlocked one goes first, then detection runs again.'), 'costs', o, [{ label: 'Aborted', value: 0 }, { label: 'Cost lost', value: 0 }]);
    Rt.steps.forEach((st) => {
      if (st.kind === 'detect') push('detect', T2.concat(recPic(n, m, st, { costs: cost, dead: st.deadlocked, gone: gone.slice() }, narrow)), DL.plain(st.say), 'detect', st, [{ label: 'Aborted', value: gone.length }, { label: 'Cost lost', value: lost }, { label: 'Deadlocked', value: DL.list(st.deadlocked.map((i) => P[i])), cls: 'bad' }]);
      else if (st.kind === 'abort') { gone.push(st.i); lost += cost[st.i]; push('abort P' + st.i, T2.concat(recPic(n, m, st, { costs: cost, dead: st.deadlocked.filter((k) => !gone.includes(k)), gone: gone.slice(), victim: st.i, freed: st.freed }, narrow)), DL.plain(st.say), 'abort', st, [{ label: 'Aborted', value: gone.length }, { label: 'Cost lost', value: lost }, { label: 'Victim', value: P[st.i], cls: 'act' }]); }
      else push('clear', T2.concat(recPic(n, m, st, { costs: cost, gone: gone.slice(), clear: true, verdict: 'recovered: ' + DL.plural(gone.length, 'process', 'processes') + ' aborted, cost ' + lost, vcls: 'good' }, narrow)), DL.plain(st.say) + ` In all ${DL.list(gone.map((i) => P[i]))} ${gone.length > 1 ? 'were' : 'was'} aborted, at a cost of \`${lost}\`.`, 'clear', st, [{ label: 'Aborted', value: gone.length }, { label: 'Cost lost', value: lost, cls: 'bad' }, { label: 'Outcome', value: 'recovered', cls: 'good' }], 3000);
    });
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, det: d, rec: Rt };
  };
})(globalThis.Proses = globalThis.Proses || {});
