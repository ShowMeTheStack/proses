// The banker's algorithm (src/core/dl-a-banker.js) on our own instances: the Allocation, Max, Need and Available
// tables; the safety check scanning rows, Work growing and Finish flipping, giving a safe sequence; then the chosen
// request checked and granted or denied, and the other outcome shown with a second request.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box, B = () => S.Banker, KB = () => S.Kit.bank;
  // instances of our own (the totals: A 9 7 9; B 9 6 6 5; C 6 7 9)
  const PRESETS = [
    { name: 'five jobs, three types', avail: [3, 2, 3], max: [[2, 4, 4], [6, 2, 2], [3, 2, 3], [8, 6, 2], [1, 5, 6]], alloc: [[0, 1, 3], [5, 1, 0], [0, 2, 1], [1, 0, 1], [0, 1, 1]] },
    { name: 'four jobs, four types', avail: [1, 2, 2, 3], max: [[1, 3, 1, 4], [1, 1, 3, 5], [4, 2, 4, 2], [5, 5, 2, 3]], alloc: [[1, 0, 0, 1], [1, 1, 1, 0], [3, 0, 3, 0], [3, 3, 0, 1]] },
    { name: 'six jobs, little spare', avail: [2, 1, 2], max: [[1, 5, 1], [2, 1, 2], [1, 6, 1], [1, 3, 6], [1, 5, 1], [2, 2, 4]], alloc: [[1, 2, 0], [0, 0, 2], [1, 0, 1], [0, 2, 3], [0, 2, 1], [2, 0, 0]] },
  ];
  const RES = ['A', 'B', 'C', 'D'];
  const vec = (v) => '(' + v.join(', ') + ')';
  /** the request a process makes in this scene: up to k of each type it still needs */
  const ask = (need, k) => need.map((x) => Math.min(x, k));

  function trace(knobs) {
    const k = Object.assign({ preset: 0, who: 1, amount: 1 }, knobs || {});
    const p = PRESETS[k.preset], n = p.alloc.length, who = Math.min(k.who, n - 1);
    const st = { avail: p.avail, alloc: p.alloc, max: p.max };
    const need = B().need(p.max, p.alloc), safety = B().safety(st);
    const mine = { i: who, req: ask(need[who], k.amount) };
    mine.r = B().request(st, mine.i, mine.req);
    // the other outcomes, so that the scene always shows one request granted and one denied as unsafe
    const others = [];
    for (const want of ['granted', 'unsafe']) {
      if (mine.r.verdict === want) continue;
      search: for (let a = 1; a <= 3; a++) for (let i = 0; i < n; i++) { const req = ask(need[i], a); if (req.every((x) => !x)) continue; const r = B().request(st, i, req); if (r.verdict === want) { others.push({ i, req, r }); break search; } }
    }
    return { k, p, n, m: p.avail.length, who, need, safety, mine, others, st };
  }

  function layout(narrow, n, m) {
    if (narrow) {
      const cw = 30, ch = 28, W = m * (cw + 3) - 3;
      // below the tables one area holds Work's ledger and the safe sequence while a check runs, or the ghost of a
      // denied request's state in the last frames; the request panel follows it
      const ledY = 70 + 2 * n * 31 + 218, area = Math.max((n + 1) * 22 + 10 + 70, n * 31 + 150), reqY = ledY + area + 30;
      const end = reqY + Math.max(ch + 26 + 3 * 24, 3 * 50) + 10;
      return { narrow, view: box(0, 0, 400, end), cw, ch, alloc: [44, 70], max: [44 + W + 52, 70], need: [44, 70 + n * 31 + 70], fin: [44 + W + 52, 70 + n * 31 + 70], finW: 58, availY: 70 + 2 * n * 31 + 122, vecX: 104, ledger: [12, ledY], ledgerLh: 22, seq: [12, 0], req: [12, reqY], ghostY: ledY - 16, size: 13 };
    }
    const cw = 44, ch = 34, W = m * (cw + 3) - 3, gapX = 42;
    const x0 = 64, ax = x0, mx = ax + W + gapX, nx = mx + W + gapX, fx = nx + W + gapX;
    return { narrow, view: box(0, 0, 1240, 610), cw, ch, alloc: [ax, 96], max: [mx, 96], need: [nx, 96], fin: [fx, 96], finW: 64, availY: 96, vecX: 0, right: Math.max(fx + 110, 800), ledger: [Math.max(fx + 110, 800), 210], ledgerLh: 26, seq: [x0 - 50, 96 + n * 37 + 30], req: [x0 - 50, 96 + n * 37 + 96], size: 15 };
  }

  function frames(narrow, knobs) {
    const T = D.once('bank:' + JSON.stringify(knobs), () => trace(knobs)), { p, n, m } = T, L = layout(narrow, n, m);
    const P = Array.from({ length: n }, (_, i) => 'P' + i), res = RES.slice(0, m);
    const out = [];

    /** one picture: v = {alloc, max, need, avail, work, finish, row, fits, seq, ledger, changed, req, tests, verdict} */
    function picture(v) {
      const items = [], K = KB(), cw = L.cw, ch = L.ch, size = L.size;
      const rowCls = (i) => (v.row === i ? 'act' : v.finish && v.finish[i] ? 'good' : '');
      const chg = (t, i, j) => (v.changed && v.changed.has(t + i + '_' + j) ? ' req' : '');
      items.push(...K.matrix({ prefix: 'al', x: L.alloc[0], y: L.alloc[1], cw, ch, size, title: 'Allocation', cols: res, rows: P, vals: v.alloc, rowCls, cls: (i, j) => (v.row === i && v.fits ? 'good' : '') + chg('a', i, j) }).items);
      items.push(...K.matrix({ prefix: 'mx', x: L.max[0], y: L.max[1], cw, ch, size, title: 'Max', cols: res, rows: narrow ? P : null, vals: v.max, rowCls }).items);
      const needVals = v.need || v.alloc.map((r) => r.map(() => ''));
      const needCls = (i, j) => {
        if (!v.need) return 'faded';
        if (v.row === i) return v.fits ? 'good' : (v.need[i][j] > v.work[j] ? 'hot' : 'act');
        return (v.finish && v.finish[i] ? 'faded' : '') + chg('n', i, j) + (v.reqRow === i && !v.changed ? ' req' : '');
      };
      items.push(...K.matrix({ prefix: 'nd', x: L.need[0], y: L.need[1], cw, ch, size, title: 'Need = Max − Alloc', cols: res, rows: narrow ? P : null, vals: needVals, cls: needCls, rowCls, titleCls: v.needAct ? 'act' : '' }).items);
      if (v.finish) items.push(...K.finish({ prefix: 'fn', x: L.fin[0], y: L.fin[1], cw: L.finW, ch, vals: v.finish, title: 'Finish', cls: (i) => (v.row === i ? 'act' : '') }).items);
      // Available, and Work while a check runs
      const vx = narrow ? L.vecX : L.right, ay = narrow ? L.availY : L.availY;
      items.push(...K.vector({ prefix: 'av', x: narrow ? 12 : vx, y: ay, cw, ch, size, title: 'Available', titleW: narrow ? L.vecX - 12 : 96, vals: v.avail, cols: res, cls: (j) => (v.changed && v.changed.has('v' + j) ? 'req' : '') }).items);
      if (v.work) items.push(...K.vector({ prefix: 'wk', x: narrow ? 12 : vx, y: ay + ch + 14, cw, ch, size, title: 'Work', titleW: narrow ? L.vecX - 12 : 96, vals: v.work, cls: (j) => (v.row !== undefined && v.row >= 0 ? (v.fits ? 'good' : v.need[v.row][j] > v.work[j] ? 'hot' : 'act') : ''), titleCls: v.row !== undefined && v.row >= 0 ? 'act' : '', pulse: v.fits }).items);
      // the ledger of Work: where it started and every allocation given back
      (v.ledger || []).forEach((t, k) => items.push({ key: 'lg:' + k, kind: 'text', x: L.ledger[0], y: L.ledger[1] + k * L.ledgerLh, text: t, size: narrow ? 13 : 14, cls: 'ledger' + (k === v.ledger.length - 1 && v.fits ? ' act' : '') }));
      // the safe sequence so far
      let y = narrow ? L.ledger[1] + (n + 1) * L.ledgerLh + 10 : L.seq[1];
      if (v.seq) {
        const sq = K.seq({ prefix: 'sq', x: narrow ? 12 : L.seq[0], y, names: v.seq.map((i) => P[i]), title: narrow ? '' : 'safe sequence', titleW: narrow ? 0 : 130, w: narrow ? 38 : 44, gap: narrow ? 14 : 22, cls: () => (v.unsafe ? 'hot' : '') });
        if (narrow) items.push({ key: 'sq:t2', kind: 'text', x: 12, y: y - 2, text: 'safe sequence', size: 14, cls: 'vecname' });
        if (narrow) sq.items.forEach((it) => { it.y += 10; });
        items.push(...sq.items);
        if (v.unsafe) items.push({ key: 'sq:stuck', kind: 'text', x: (narrow ? 12 : L.seq[0] + 130) + (v.seq.length ? sq.w - (narrow ? 0 : 130) + 18 : 0), y: y + (narrow ? 10 : 0) + 20, text: v.seq.length ? 'then nobody can finish' : 'nobody can finish', size: 14, cls: 'verdict hot' });
      }
      y = L.req[1];
      // the request panel
      if (v.role) items.push({ key: 'rq:role', kind: 'text', x: narrow ? 12 : L.req[0], y: y - 14, text: v.role, size: 13, cls: 'title' });
      if (v.req) {
        const rx = narrow ? 12 : L.req[0];
        items.push(...K.vector({ prefix: 'rq', x: rx, y, cw, ch, size, title: P[v.req.i] + ' asks for', titleW: narrow ? 92 : 130, vals: v.req.req, cls: () => 'req' }).items);
        (v.tests || []).forEach((t, k) => {
          const ty = y + ch + 26 + k * (narrow ? 24 : 26);
          items.push({ key: 'rt:' + k, kind: 'text', x: rx, y: ty, text: t.text, size: narrow ? 13 : 14, cls: t.ok === true ? 'good' : t.ok === false ? 'hot' : 'strong' });
        });
        if (v.verdict) items.push({ key: 'rv', kind: 'text', x: narrow ? rx + 92 + m * (cw + 3) + 14 : rx + 130 + m * (cw + 3) + 22, y: y + ch / 2 + 6, text: v.verdict, size: narrow ? 15 : 17, cls: 'verdict ' + (v.verdictCls || '') });
      }
      // the summary of every request: one row each
      (v.summary || []).forEach((r, k) => {
        const ry = y + 12 + k * (narrow ? 50 : 32);
        items.push({ key: 'su:a' + k, kind: 'text', x: narrow ? 12 : L.req[0], y: ry + 4, text: r.head, size: 14, cls: 'strong' });
        items.push({ key: 'su:b' + k, kind: 'text', x: narrow ? 12 : L.req[0] + 330, y: ry + 4 + (narrow ? 22 : 0), text: r.tail, size: 14, cls: r.cls });
      });
      if (v.ghost) items.push(...ghost(v.ghost, narrow ? 12 : L.right, narrow ? L.ghostY : 196));
      return items;
    }

    /** a ghost copy of the state a denied request would have made: its Available, Allocation and Need, and where
     *  the safety check run on it stops */
    function ghost(g, x, y) {
      const K = KB(), items = [], pre = g.pre, sf = g.safety, i = g.i, gw = narrow ? 28 : Math.min(34, Math.floor((1230 - x - 120) / (2 * m)) - 3), gh = 28;
      const work = sf.work, stuck = (k) => !sf.finish[k];
      items.push({ key: 'gh:t', kind: 'text', x, y, text: 'If ' + P[i] + '’s request were granted:', size: 15, cls: 'strong' });
      items.push(...K.vector({ prefix: 'ghv', x, y: y + 16, cw: gw, ch: gh, size: 14, title: 'Available', titleW: 92, vals: pre.avail, cls: (j) => (g.req[j] ? 'req' : '') }).items);
      const mx = x + 34, top = y + 16 + gh + 62, W = m * (gw + 3) - 3;
      items.push(...K.matrix({ prefix: 'gha', x: mx, y: top, cw: gw, ch: gh, size: 14, title: 'Allocation', cols: res, rows: P, vals: pre.alloc, cls: (k, j) => (k === i && g.req[j] ? 'req' : ''), rowCls: (k) => (stuck(k) ? 'bad' : 'good') }).items);
      items.push(...K.matrix({ prefix: 'ghn', x: mx + W + 16, y: top, cw: gw, ch: gh, size: 14, title: 'Need', cols: res, rows: null, vals: pre.need, cls: (k, j) => (stuck(k) ? (pre.need[k][j] > work[j] ? 'hot' : '') : 'faded') }).items);
      items.push(...K.finish({ prefix: 'ghf', x: mx + 2 * W + 32, y: top, cw: 52, ch: gh, vals: sf.finish, title: 'Finish' }).items);
      items.push({ key: 'gh:w', kind: 'text', x, y: top + n * (gh + 3) + 20, text: 'Work stops at ' + vec(work) + ': no Need left fits', size: 14, cls: 'hot' });
      return items;
    }

    const base = { alloc: p.alloc, max: p.max, avail: p.avail };
    const say0 = `${n} processes and ${m} resource types (${p.name}). Allocation is what each holds now, Max the most it may ever hold, and Available \`${vec(p.avail)}\` what is free.`;
    out.push({ items: picture(base), say: say0, title: 'the tables' });
    out.push({ items: picture(Object.assign({}, base, { need: T.need, needAct: true })), say: `Need = Max − Allocation is what each may still ask for: P0 may still need \`${vec(T.need[0])}\`, P${n - 1} \`${vec(T.need[n - 1])}\`. The state is safe if some order lets every process get its full Need and finish.`, title: 'Need' });

    /** frames for one safety check, from its trace, on the state s */
    function safetyFrames(s, safety, extra, quick) {
      const ledger = [];
      const fr = [];
      safety.steps.forEach((st) => {
        if (st.kind === 'start') { ledger.push('Work = ' + vec(st.work)); if (!quick) fr.push({ v: Object.assign({}, s, extra, { work: st.work, finish: st.finish, seq: [], ledger: ledger.slice() }), say: st.say, title: 'Work = Available' }); return; }
        if (st.kind === 'check') {
          if (st.fits) ledger.push(`+ P${st.i}’s ${vec(s.alloc[st.i])} = ${vec(st.after)}`);
          const seq = st.finish.map((f, i) => i).filter((i) => st.finish[i]);
          const order = safety.seq.filter((i) => seq.includes(i));
          if (!quick) fr.push({ v: Object.assign({}, s, extra, { work: st.fits ? st.after : st.work, row: st.i, fits: st.fits, finish: st.finish, seq: order, ledger: ledger.slice() }), say: (st.pass > 1 && !st.fits ? '' : '') + st.say, title: (st.pass > 1 ? 'pass ' + st.pass + ' · ' : '') + st.short });
          return;
        }
        fr.push({ v: Object.assign({}, s, extra, { work: st.work, finish: st.finish, seq: st.seq, ledger: ledger.slice(), unsafe: st.kind === 'unsafe' }), say: st.say, title: st.kind });
      });
      return fr;
    }
    for (const f of safetyFrames(Object.assign({}, base, { need: T.need }), T.safety, {})) out.push({ items: picture(f.v), say: f.say, title: f.title });

    /** frames for a request: its tests, the pretend state, its safety check (in full or just the verdict) */
    function requestFrames(R, full, lead, role) {
      const r = R.r, i = R.i, req = R.req, s0 = Object.assign({}, base, { need: T.need, role });
      const tests = [], rq = { i, req };
      const st1 = r.steps[0];
      if (r.verdict === 'over-need') { out.push({ items: picture(Object.assign({}, s0, { req: rq, reqRow: i, tests: [{ text: 'Request ≤ Need ' + vec(T.need[i]) + '? no', ok: false }], verdict: 'refused', verdictCls: 'hot' })), say: lead + st1.say, title: 'over its claim' }); return; }
      tests.push({ text: '1. Request ≤ Need ' + vec(T.need[i]) + '?  yes', ok: true });
      out.push({ items: picture(Object.assign({}, s0, { req: rq, reqRow: i, tests: tests.slice() })), say: lead + st1.say, title: 'request · P' + i });
      if (r.verdict === 'wait') {
        tests.push({ text: '2. Request ≤ Available ' + vec(p.avail) + '?  no', ok: false });
        out.push({ items: picture(Object.assign({}, s0, { req: rq, reqRow: i, tests: tests.slice(), verdict: 'must wait', verdictCls: 'hot' })), say: r.steps[1].say, title: 'must wait' });
        return;
      }
      tests.push({ text: '2. Request ≤ Available ' + vec(p.avail) + '?  yes', ok: true });
      const pre = r.steps[1].state, changed = new Set();
      req.forEach((x, j) => { if (x) { changed.add('a' + i + '_' + j); changed.add('n' + i + '_' + j); changed.add('v' + j); } });
      const sP = { alloc: pre.alloc, max: p.max, avail: pre.avail, need: pre.need, changed, req: rq, role };
      out.push({ items: picture(Object.assign({}, sP, { tests: tests.slice().concat([{ text: '3. Pretend to grant it: is that state safe?', ok: null }]) })), say: r.steps[1].say, title: 'pretend' });
      const ok = r.verdict === 'granted', sf = r.safety;
      const t3 = { text: ok ? '3. The pretended state is safe' : '3. The pretended state is unsafe: the check stops', ok };
      for (const f of safetyFrames(sP, sf, { tests: tests.slice().concat([{ text: '3. Safety check of the pretended state …', ok: null }]) }, !full)) out.push({ items: picture(Object.assign(f.v, f.v.unsafe || f.title === 'safe' ? { tests: tests.concat([t3]) } : {})), say: f.say, title: 'pretend · ' + f.title });
      const last = r.steps[r.steps.length - 1];
      // granted: the pretended state becomes the real one; denied: the tables go back, and a ghost keeps the
      // pretended state and where its check stopped
      const fin = ok ? Object.assign({ alloc: pre.alloc, max: p.max, avail: pre.avail, need: pre.need, changed, seq: sf.seq, finish: sf.finish }, { role, req: rq, tests: tests.concat([t3]), verdict: 'granted', verdictCls: 'good' })
        : Object.assign({}, s0, { req: rq, reqRow: i, tests: tests.concat([t3]), verdict: 'denied: unsafe', verdictCls: 'hot', ghost: { i, req, pre, safety: sf } });
      const why = ok ? '' : ` ${narrow ? 'Below' : 'On the right'}, the state it would have made: Work stops at \`${vec(sf.work)}\`, and ${sf.finish.map((f, k) => (f ? -1 : k)).filter((k) => k >= 0).map((k) => P[k]).join(', ')} keep Finish false.`;
      out.push({ items: picture(fin), say: last.say + why, title: ok ? 'granted' : 'denied', hold: 3500 });
    }
    const amt = T.k.amount;
    const roleMine = 'your request: ' + P[T.mine.i] + ', up to ' + amt + ' of each';
    const leadMine = (T.k.who > n - 1 ? `This instance has only P0 to P${n - 1}, so P${n - 1} asks. ` : '') + `Your request: ${P[T.mine.i]} asks for up to ${amt} of each type it still needs. `;
    requestFrames(T.mine, true, leadMine, roleMine);
    T.others.forEach((o) => {
      const g = o.r.verdict === 'granted', what = g ? 'a grant' : 'a denial';
      requestFrames(o, false, `A second request, added to show ${what}, judged on the same starting tables. `, 'a second request, added to show ' + what);
    });
    // both outcomes side by side
    const all = [{ R: T.mine, head: 'Your request: ' + P[T.mine.i] + ' asks ' + vec(T.mine.req) }].concat(T.others.map((o) => ({ R: o, head: 'Added: ' + P[o.i] + ' asks ' + vec(o.req) })));
    const tail = (R) => (R.r.verdict === 'granted' ? 'granted, safe sequence ⟨' + R.r.safety.seq.map((k) => P[k]).join(', ') + '⟩' : R.r.verdict === 'unsafe' ? 'denied: unsafe, Work would stop at ' + vec(R.r.safety.work) : R.r.verdict === 'wait' ? 'must wait: not enough free' : 'refused: more than its claim');
    const summary = all.map((a) => ({ head: a.head, tail: tail(a.R), cls: a.R.r.verdict === 'granted' ? 'good' : 'hot' }));
    const den = all.find((a) => a.R.r.verdict === 'unsafe');
    out.push({ items: picture(Object.assign({}, base, { need: T.need, role: 'the requests, side by side', summary, ghost: den ? { i: den.R.i, req: den.R.req, pre: den.R.r.steps[1].state, safety: den.R.r.safety } : null })), title: 'both outcomes', hold: 4000,
      say: 'Side by side: ' + all.map((a) => `${P[a.R.i]}’s \`${vec(a.R.req)}\` is ${tail(a.R).replace('⟨', '⟨').replace(/^denied: unsafe, /, 'denied as unsafe, since ')}`).join('; ') + '. Free units are not enough: the banker grants only what keeps a safe sequence.' });
    return out.map((f) => Object.assign(f, { view: L.view }));
  }

  D.add({
    id: 'banker', order: 90, tag: 'Deadlocks · avoidance', short: "Banker's algorithm", title: "The banker's algorithm: a safe sequence, then two requests",
    blurb: 'The safety check looks for an order in which every process can get the most it may still need and finish. A request is granted only if the state after it is still safe; otherwise the process waits, even when the units are free.',
    knobs: [
      { id: 'preset', label: 'instance', type: 'select', value: 0, options: PRESETS.map((p, i) => ({ value: i, label: p.name })) },
      { id: 'who', label: 'who asks', type: 'select', value: 1, options: [0, 1, 2, 3, 4, 5].map((i) => ({ value: i, label: 'P' + i })) },
      { id: 'amount', label: 'asks for', min: 1, max: 3, step: 1, value: 1, fmt: (v) => 'up to ' + v + ' of each' },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({ preset: 0, who: 1, amount: 1 }, knobs)); },
    trace,
    presets: PRESETS,
  });
})(globalThis.Proses = globalThis.Proses || {});
