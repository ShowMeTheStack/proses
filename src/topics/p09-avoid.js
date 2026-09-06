// Part 9, avoidance: the safety check of the banker's algorithm row by row (S.Banker.safety), a request granted or
// refused (S.Banker.request), and the claim-edge graph for single units (S.Rag.cycle on the graph with the claims as
// future requests).
(function (S) {
  'use strict';
  const H = S.P09, KB = () => S.Kit.bank, KR = () => S.Kit.rag;
  const RES = 'ABCD';
  // instances of our own
  const INST = {
    five: { label: 'Five jobs, three types', avail: [3, 2, 3], max: [[2, 4, 4], [6, 2, 2], [3, 2, 3], [8, 6, 2], [1, 5, 6]], alloc: [[0, 1, 3], [5, 1, 0], [0, 2, 1], [1, 0, 1], [0, 1, 1]] },
    four: { label: 'Four jobs, four types', avail: [1, 2, 2, 3], max: [[1, 3, 1, 4], [1, 1, 3, 5], [4, 2, 4, 2], [5, 5, 2, 3]], alloc: [[1, 0, 0, 1], [1, 1, 1, 0], [3, 0, 3, 0], [3, 3, 0, 1]] },
    stuck: { label: 'Three jobs, one finishes, then nobody', avail: [0, 1, 0], max: [[1, 1, 1], [2, 3, 1], [2, 2, 3]], alloc: [[1, 0, 1], [0, 2, 0], [1, 1, 1]] },
    tight: { label: 'Six jobs, little spare', avail: [2, 1, 2], max: [[1, 5, 1], [2, 1, 2], [1, 6, 1], [1, 3, 6], [1, 5, 1], [2, 2, 4]], alloc: [[1, 2, 0], [0, 0, 2], [1, 0, 1], [0, 2, 3], [0, 2, 1], [2, 0, 0]] },
  };
  const rowsText = (m) => m.map((r) => r.join(' ')).join('; ');
  const parseRows = (t) => String(t).split(';').map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/).filter(Boolean).map(Number));
  const nums = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean)).map(Number);
  /** the tables of an input, or an error sentence */
  H.bankInput = (inp) => {
    const avail = nums(inp.avail), alloc = parseRows(inp.alloc), max = parseRows(inp.max), m = avail.length, n = alloc.length;
    if (m < 1 || m > 4) return 'Available: 1 to 4 resource types';
    if (n < 1 || n > 6) return 'Allocation: 1 to 6 rows, separated by ;';
    if (max.length !== n) return 'Max needs ' + n + ' rows, one per process, like Allocation';
    for (const v of [avail, ...alloc, ...max]) if (v.length !== m || v.some((x) => !Number.isInteger(x) || x < 0 || x > 20)) return 'Every row needs ' + m + ' whole numbers from 0 to 20';
    for (let i = 0; i < n; i++) if (alloc[i].some((x, j) => x > max[i][j])) return 'P' + i + ' holds more than its Max';
    return { avail, alloc, max, n, m };
  };
  const tableInputs = (def) => [
    { id: 'avail', kind: 'list', label: 'Available', def: INST[def].avail.map(String), check: (v, inp) => { const r = H.bankInput(inp); return typeof r === 'string' ? r : null; } },
    { id: 'alloc', kind: 'text', label: 'Allocation (rows; separated)', def: rowsText(INST[def].alloc) },
    { id: 'max', kind: 'text', label: 'Max (rows; separated)', def: rowsText(INST[def].max) },
  ];
  const instValues = (k) => ({ avail: INST[k].avail.map(String), alloc: rowsText(INST[k].alloc), max: rowsText(INST[k].max) });

  /** the banker's tables: v = {alloc, max, need, avail, work, finish, row, fits, seq, ledger, unsafe, changed: Set, req, tests} */
  H.bankPicture = function (T, v) {
    const items = [], K = KB(), n = T.n, m = T.m, cw = 40, ch = 30, size = 15, W = m * (cw + 3) - 3, gap = 30, x0 = 34, y0 = 56;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), res = RES.slice(0, m).split('');
    const rowCls = (i) => (v.row === i ? 'act' : v.finish && v.finish[i] ? 'good' : v.stuck && v.stuck.includes(i) ? 'bad' : '');
    const chg = (t, i, j) => (v.changed && v.changed.has(t + i + '_' + j) ? ' req' : '');
    const ax = x0, mx = ax + W + gap, nx = v.max ? mx + W + gap : mx, fx = nx + W + gap;
    items.push(...K.matrix({ prefix: 'al', x: ax, y: y0, cw, ch, size, title: 'Allocation', cols: res, rows: P, vals: v.alloc, rowCls, cls: (i, j) => (v.row === i && v.fits ? 'good' : '') + chg('a', i, j) + (v.zero && v.zero.includes(i) ? ' faded' : '') }).items);
    if (v.max) items.push(...K.matrix({ prefix: 'mx', x: mx, y: y0, cw, ch, size, title: 'Max', cols: res, rows: null, vals: v.max }).items);
    const needCls = (i, j) => {
      if (!v.need) return 'faded';
      if (v.row === i && v.work) return v.fits ? 'good' : v.need[i][j] > v.work[j] ? 'hot' : 'act';
      return (v.finish && v.finish[i] ? 'faded' : '') + chg('n', i, j);
    };
    items.push(...K.matrix({ prefix: 'nd', x: nx, y: y0, cw, ch, size, title: v.needTitle || 'Need', cols: res, rows: null, vals: v.need || v.alloc.map((r) => r.map(() => '')), cls: needCls, titleCls: v.needAct ? 'act' : '' }).items);
    if (v.side) v.side.forEach((t, k) => items.push(H.text('sd' + k, fx + (v.finish ? 84 : 0), y0 - 34 + k * 24, t.text, t.cls || 'strong', 14)));
    if (v.finish) items.push(...K.finish({ prefix: 'fn', x: fx, y: y0, cw: 58, ch, vals: v.finish, title: 'Finish', cls: (i) => (v.row === i ? 'act' : '') }).items);
    const by = y0 + n * (ch + 3) + 26;
    items.push(...K.vector({ prefix: 'av', x: 0, y: by, cw, ch, size, title: 'Available', titleW: 96, vals: v.avail, cls: (j) => (v.changed && v.changed.has('v' + j) ? 'req' : '') }).items);
    if (v.work) items.push(...K.vector({ prefix: 'wk', x: 0, y: by + ch + 10, cw, ch, size, title: 'Work', titleW: 96, vals: v.work, cls: (j) => (v.row !== undefined && v.row >= 0 ? (v.fits ? 'good' : v.need[v.row][j] > v.work[j] ? 'hot' : 'act') : ''), titleCls: v.row !== undefined && v.row >= 0 ? 'act' : '' }).items);
    const lx = 96 + m * (cw + 3) + 30;
    (v.ledger || []).slice(-4).forEach((t, k, a) => items.push({ key: 'lg:' + (v.ledger.length - a.length + k), kind: 'text', x: lx, y: by + 18 + k * 22, text: t, size: 14, cls: 'ledger' + (k === a.length - 1 && v.fits ? ' act' : '') }));
    // room for the ledger's widest line (mono text runs wider on some screens than the estimate)
    items.push({ key: 'lg:room', kind: 'dot', x: lx + 300, y: by + 18, r: 0.5, cls: 'nobox', audit: 'ignore', layer: 'back' });
    let y = by + 2 * ch + 46;
    if (v.seq) {
      const sq = K.seq({ prefix: 'sq', x: 0, y, names: v.seq.map((i) => P[i]), title: 'safe sequence', titleW: 120, w: 40, gap: 18, cls: () => (v.unsafe ? 'hot' : '') });
      items.push(...sq.items);
      if (v.unsafe) items.push({ key: 'sq:stuck', kind: 'text', x: 120 + (v.seq.length ? sq.w - 120 + 18 : 0), y: y + 20, text: v.seq.length ? 'then nobody can finish' : 'nobody can finish', size: 15, cls: 'verdict hot' });
      y += 50;
    }
    if (v.req) {
      items.push(...K.vector({ prefix: 'rq', x: 0, y, cw, ch, size, title: P[v.req.i] + ' asks', titleW: 96, vals: v.req.req, cls: () => 'req' }).items);
      (v.tests || []).forEach((t, k) => items.push({ key: 'rt:' + k, kind: 'text', x: lx, y: y - 4 + k * 22, text: t.text, size: 14, cls: t.ok === true ? 'good' : t.ok === false ? 'hot' : 'strong' }));
      if (v.verdict) items.push({ key: 'rv', kind: 'text', x: 0, y: y + ch + 30, text: v.verdict, size: 16, cls: 'verdict ' + (v.verdictCls || '') });
    }
    return items;
  };

  /** frames for one safety check (its trace) on the tables s */
  H.safetyFrames = function (T, s, safety, extra) {
    const out = [], ledger = [], P = (i) => 'P' + i;
    for (const st of safety.steps) {
      if (st.kind === 'start') { ledger.push('Work = ' + H.vec(st.work)); out.push({ v: Object.assign({}, s, extra, { work: st.work, finish: st.finish, seq: [], ledger: ledger.slice() }), say: H.plain(st.say), meta: { phase: 'start', work: st.work }, title: 'Work = Available' }); continue; }
      if (st.kind === 'check') {
        if (st.fits) ledger.push(P(st.i) + ' done: Work = ' + H.vec(st.after));
        const order = safety.seq.filter((i) => st.finish[i]);
        out.push({ v: Object.assign({}, s, extra, { work: st.fits ? st.after : st.work, row: st.i, fits: st.fits, finish: st.finish, seq: order, ledger: ledger.slice() }), say: H.plain(st.say), meta: { phase: 'check', i: st.i, fits: st.fits, pass: st.pass, work: st.work, after: st.after, need: s.need[st.i], alloc: s.alloc[st.i] }, title: (st.pass > 1 ? 'pass ' + st.pass + ' · ' : '') + st.short });
        continue;
      }
      const stuck = st.kind === 'unsafe' ? st.stuck : [];
      const dead = st.deadlocked || [];
      out.push({ v: Object.assign({}, s, extra, { work: st.work, finish: st.finish, seq: st.seq || safety.seq, ledger: ledger.slice(), unsafe: st.kind === 'unsafe' || st.kind === 'deadlock', stuck: stuck.concat(dead) }), say: H.plain(st.say), meta: { phase: st.kind, seq: st.seq || safety.seq, work: st.work || safety.work, stuck: stuck.concat(dead) }, title: st.kind });
    }
    return out;
  };

  const bankDef = { sections: [{ id: 'd', kind: 'math', title: 'The safety check', text: ['Need = Max − Allocation', 'Work = Available; Finish[i] = false', 'find i: not Finish[i] and Need[i] ≤ Work', '  Work = Work + Allocation[i]; Finish[i] = true', 'repeat until no such i', 'safe ⇔ every Finish[i] is true'].join('\n') }] };

  S.topic({
    id: 'dl-safety', family: 'p09-avoid', order: 10, title: 'Safe states, row by row',
    blurb: 'A state is safe when some order lets every process get the most it may still need (its Need), finish, and give everything back. The safety check builds that order: start with Work = Available, find a process whose Need fits in Work, pretend it finishes and add its Allocation to Work, and repeat. If everyone finishes, the order found is a safe sequence. If a pass finishes nobody, the state is unsafe: not yet a deadlock, but no longer guaranteed to avoid one.',
    inputs: tableInputs('five'),
    presets: [
      { label: 'Five jobs, three types', values: instValues('five') },
      { label: 'Four jobs, four types', values: instValues('four') },
      { label: 'One finishes, then nobody (unsafe)', values: instValues('stuck') },
      { label: 'Six jobs, little spare', values: instValues('tight') },
    ],
    counters: [{ id: 'checks', label: 'rows checked' }, { id: 'done', label: 'finished' }],
    run(inp) {
      const T = H.bankInput(inp), st = { avail: T.avail, alloc: T.alloc, max: T.max }, need = S.Banker.need(T.max, T.alloc), sf = S.Banker.safety(st);
      const F = new S.Frames(['checks', 'done']), base = { alloc: T.alloc, max: T.max, avail: T.avail };
      const tt = H.title('tt', 0, 0, T.n + ' processes, ' + T.m + ' resource types');
      const add = (v, say, meta, title) => F.add({ items: [tt, ...H.bankPicture(T, v)], say, meta: Object.assign({ avail: T.avail }, meta), title });
      add(base, `Allocation is what each process holds now, Max the most it may ever hold, and Available ${H.vec(T.avail)} what is free.`, { phase: 'tables' }, 'the tables');
      add(Object.assign({}, base, { need, needAct: true }), `Need = Max − Allocation is what each may still ask for: P0 may still need ${H.vec(need[0])}, P${T.n - 1} ${H.vec(need[T.n - 1])}.`, { phase: 'need', need }, 'Need');
      for (const f of H.safetyFrames(T, Object.assign({}, base, { need }), sf, {})) {
        if (f.meta.phase === 'check') { F.count('checks'); if (f.meta.fits) F.count('done'); }
        F.add({ items: [tt, ...H.bankPicture(T, f.v)], say: f.say, meta: Object.assign({ avail: T.avail }, f.meta), title: f.title });
      }
      F.last().hold = 3000;
      return { frames: F.list, def: bankDef };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'start', pick: 'option', ask: 'Before the scan: is this state safe?', options: ['safe', 'unsafe'], answer: (fr) => (fr[fr.length - 1].meta.phase === 'safe' ? 'safe' : 'unsafe'), explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'check' && fr[i + 1].meta.fits && fr[i + 1].meta.pass === 1, once: true, pick: 'item', ask: 'The scan goes on down the rows. Click the Allocation row name of the next process that can finish.', answer: (fr, i) => 'al:r' + fr[i + 1].meta.i, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Need = Max − Allocation means…', options: ['what a process may still ask for', 'what it holds', 'what is free', 'what it has finished with'], answer: 0, why: 'Max is its declared ceiling; Allocation is already held.' },
      { q: 'When process i finishes in the check, Work grows by…', options: ['its Allocation', 'its Need', 'its Max', 'nothing'], answer: 0, why: 'It gives back everything it holds.' },
      { q: 'An unsafe state means…', options: ['a deadlock may happen if processes ask for their full Need', 'the system is deadlocked now', 'some process has crashed', 'Available is zero'], answer: 0, why: 'Unsafe removes the guarantee; it is not yet a deadlock.' },
      { q: 'Does the order in which the check scans rows change whether a state is safe?', options: ['no: if any safe sequence exists, the scan finds one', 'yes: a bad order can miss it', 'only with more than three types', 'only when Available is zero'], answer: 0, why: 'Finishing a process only adds to Work, so a process that fits now still fits later.' },
      { q: 'The check costs about…', options: ['m × n² steps', 'n steps', '2ⁿ steps', 'm steps'], answer: 0, why: 'Up to n passes over n rows, each comparing m numbers.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'dl-banker-request', family: 'p09-avoid', order: 20, title: 'The banker grants or refuses a request',
    blurb: 'A request is checked three ways. It must stay within the process\'s declared Need, or it is an error. It must fit in Available, or the process waits. Then the banker pretends to grant it and runs the safety check on the state that would result: if that state is safe the request is granted; if not, the process waits, even though the units are free. Free units are not enough; only a safe state is.',
    inputs: tableInputs('five').concat([
      { id: 'who', kind: 'number', label: 'Process', def: 0, min: 0, max: 5, check: (v, inp) => { const r = H.bankInput(inp); return typeof r !== 'string' && v >= r.n ? 'Process: 0 to ' + (r.n - 1) : null; } },
      { id: 'req', kind: 'list', label: 'Request', def: ['2', '2', '1'], check: (v, inp) => { const r = H.bankInput(inp); if (typeof r === 'string') return null; const q = nums(v); return q.length !== r.m || q.some((x) => !Number.isInteger(x) || x < 0 || x > 20) ? 'Request: ' + r.m + ' whole numbers' : q.every((x) => !x) ? 'Request: ask for at least one unit' : null; } },
    ]),
    presets: [
      { label: 'P0 asks (2, 2, 1): free but unsafe', values: Object.assign(instValues('five'), { who: 0, req: ['2', '2', '1'] }) },
      { label: 'P1 asks (1, 1, 1): granted', values: Object.assign(instValues('five'), { who: 1, req: ['1', '1', '1'] }) },
      { label: 'P3 asks (3, 3, 1): must wait', values: Object.assign(instValues('five'), { who: 3, req: ['3', '3', '1'] }) },
      { label: 'P1 asks (2, 0, 0): over its claim', values: Object.assign(instValues('five'), { who: 1, req: ['2', '0', '0'] }) },
      { label: 'Four types: P2 asks (1, 1, 1, 0)', values: Object.assign(instValues('four'), { who: 2, req: ['1', '1', '1', '0'] }) },
    ],
    counters: [{ id: 'tests', label: 'tests passed' }],
    run(inp) {
      const T = H.bankInput(inp), st = { avail: T.avail, alloc: T.alloc, max: T.max }, need = S.Banker.need(T.max, T.alloc), i = inp.who, req = nums(inp.req);
      const R = S.Banker.request(st, i, req), F = new S.Frames(['tests']), P = 'P' + i;
      const base = { alloc: T.alloc, max: T.max, avail: T.avail, need, req: { i, req } };
      const tt = H.title('tt', 0, 0, P + ' asks for ' + H.vec(req));
      const add = (v, say, meta, title, extra) => F.add(Object.assign({ items: [tt, ...H.bankPicture(T, v)], say, meta: Object.assign({ avail: T.avail, req, need: need[i] }, meta), title }, extra || {}));
      const tests = [];
      add(Object.assign({}, base, { tests: [] }), `${P} asks for ${H.vec(req)}. Its Need is ${H.vec(need[i])} and Available is ${H.vec(T.avail)}.`, { phase: 'ask' }, 'the request');
      const s0 = R.steps[0];
      if (R.verdict === 'over-need') {
        add(Object.assign({}, base, { tests: [{ text: '1. Request ≤ Need ' + H.vec(need[i]) + '?  no', ok: false }], verdict: 'refused: over its claim', verdictCls: 'hot' }), H.plain(s0.say), { phase: 'end', verdict: R.verdict }, 'over its claim', { hold: 3000 });
        return { frames: F.list, def: bankDef };
      }
      tests.push({ text: '1. Request ≤ Need ' + H.vec(need[i]) + '?  yes', ok: true }); F.count('tests');
      add(Object.assign({}, base, { tests: tests.slice() }), H.plain(s0.say), { phase: 'test1' }, 'within its Need');
      if (R.verdict === 'wait') {
        tests.push({ text: '2. Request ≤ Available ' + H.vec(T.avail) + '?  no', ok: false });
        add(Object.assign({}, base, { tests: tests.slice(), verdict: 'must wait: not enough free', verdictCls: 'hot' }), H.plain(R.steps[1].say), { phase: 'end', verdict: R.verdict }, 'must wait', { hold: 3000 });
        return { frames: F.list, def: bankDef };
      }
      tests.push({ text: '2. Request ≤ Available ' + H.vec(T.avail) + '?  yes', ok: true }); F.count('tests');
      const pre = R.steps[1].state, changed = new Set();
      req.forEach((x, j) => { if (x) { changed.add('a' + i + '_' + j); changed.add('n' + i + '_' + j); changed.add('v' + j); } });
      const sP = { alloc: pre.alloc, max: T.max, avail: pre.avail, need: pre.need, changed, req: { i, req } };
      add(Object.assign({}, sP, { tests: tests.concat([{ text: '3. Pretend to grant: is that state safe?', ok: null }]) }), H.plain(R.steps[1].say), { phase: 'pretend', after: pre.avail, alloc: pre.alloc[i], needAfter: pre.need[i] }, 'pretend');
      for (const f of H.safetyFrames(T, sP, R.safety, { tests: tests.concat([{ text: '3. Safety check of the pretended state', ok: null }]) })) F.add({ items: [tt, ...H.bankPicture(T, f.v)], say: f.say, meta: Object.assign({ avail: pre.avail, req }, f.meta), title: 'pretend · ' + f.title });
      const ok = R.verdict === 'granted', last = R.steps[R.steps.length - 1];
      const t3 = { text: ok ? '3. The pretended state is safe' : '3. The pretended state is unsafe', ok };
      if (ok) F.count('tests');
      const fin = ok ? Object.assign({}, sP, { tests: tests.concat([t3]), seq: R.safety.seq, finish: R.safety.finish, verdict: 'granted', verdictCls: 'good' }) : Object.assign({}, base, { tests: tests.concat([t3]), verdict: 'refused: unsafe, ' + P + ' waits', verdictCls: 'hot' });
      add(fin, H.plain(last.say) + (ok ? '' : ` Work would have stopped at ${H.vec(R.safety.work)}.`), { phase: 'end', verdict: R.verdict, work: R.safety.work, seq: R.safety.seq }, ok ? 'granted' : 'refused', { hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'A request from Pi', text: ['1. Request ≤ Need[i], else an error', '2. Request ≤ Available, else Pi waits', '3. pretend: Available −= Request', '   Allocation[i] += Request; Need[i] −= Request', '   safe: grant it; unsafe: undo, Pi waits'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'ask', pick: 'option', ask: 'What will the banker do with this request?', options: ['grant it', 'make it wait: not enough free', 'refuse it: the state would be unsafe', 'refuse it: over its claim'], answer: (fr) => ({ granted: 'grant it', wait: 'make it wait: not enough free', unsafe: 'refuse it: the state would be unsafe', 'over-need': 'refuse it: over its claim' }[fr[fr.length - 1].meta.verdict]), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A request fits in Available but the pretended state is unsafe. The banker…', options: ['makes the process wait', 'grants it anyway', 'aborts the process', 'grants half of it'], answer: 0, why: 'Granting would leave no guaranteed way for everyone to finish.' },
      { q: 'A request asks for more than the process\'s Need. This is…', options: ['an error: the process broke its declared maximum', 'a reason to wait', 'allowed if the units are free', 'a deadlock'], answer: 0, why: 'The algorithm relies on every claim being declared in advance.' },
      { q: 'What must each process declare in advance for the banker to work?', options: ['the most of each type it may ever hold', 'how long it will run', 'its priority', 'the order of its requests'], answer: 0, why: 'Max is the basis of Need and of every safety check.' },
      { q: 'Why is the banker\'s algorithm rare in general-purpose systems?', options: ['processes rarely know their maximum needs, and the check runs at every request', 'it is wrong for many types', 'it always refuses', 'it needs a single unit per type'], answer: 0, why: 'Its assumptions (known maxima, a fixed set of processes) seldom hold.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // single units: claim edges, and a request granted only if turning it into an assignment closes no cycle
  const CLAIM = {
    pair: { label: 'Two processes may both use R0 and R1', procs: ['P0', 'P1'], res: ['R0', 'R1'], claim: [[0, 0], [0, 1], [1, 0], [1, 1]], reqs: [[0, 0], [1, 1], [1, 0], [0, 1]], pos: { p0: { x: -140, y: 0 }, r0: { x: 0, y: -110 }, p1: { x: 140, y: 0 }, r1: { x: 0, y: 110 } } },
    three: { label: 'Three processes, three resources, overlapping claims', procs: ['P0', 'P1', 'P2'], res: ['R0', 'R1', 'R2'], claim: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 0]], reqs: [[0, 0], [1, 1], [2, 2], [0, 1]], pos: (() => { const p = {}; for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (2 * Math.PI * i) / 3, b = a + Math.PI / 3; p['r' + i] = { x: Math.round(140 * Math.cos(a)), y: Math.round(140 * Math.sin(a)) }; p['p' + i] = { x: Math.round(140 * Math.cos(b)), y: Math.round(140 * Math.sin(b)) }; } return p; })() },
  };
  H.CLAIM = CLAIM;
  /** the claim-edge algorithm on a list of requests: a step per request */
  H.claimRun = (sc) => {
    const hold = [], want = [], steps = [];
    for (const [p, r] of sc.reqs) {
      const held = hold.find((h) => h[1] === r);
      if (held) { want.push([p, r]); steps.push({ kind: 'wait', p, r, holder: held[0], hold: hold.map((x) => x.slice()), want: want.map((x) => x.slice()) }); continue; }
      // pretend: the claim becomes an assignment; every remaining claim counts as a future request
      const tryHold = hold.concat([[p, r]]);
      const claims = sc.claim.filter(([cp, cr]) => !tryHold.some(([hp, hr]) => hp === cp && hr === cr));
      const g = S.Rag.graph({ procs: sc.procs, res: sc.res.map((name) => ({ name, units: 1 })), hold: tryHold, want: want.concat(claims) });
      const c = S.Rag.cycle(g);
      if (c.cycle) { want.push([p, r]); steps.push({ kind: 'deny', p, r, cycle: c.cycle, test: { hold: tryHold, want: want.slice(0, -1).concat(claims) }, hold: hold.map((x) => x.slice()), want: want.map((x) => x.slice()) }); }
      else { hold.push([p, r]); steps.push({ kind: 'grant', p, r, hold: hold.map((x) => x.slice()), want: want.map((x) => x.slice()) }); }
    }
    return steps;
  };

  S.topic({
    id: 'dl-claim-graph', family: 'p09-avoid', order: 30, title: 'Avoidance with claim edges',
    blurb: 'With one unit per resource, avoidance needs no tables. Each process declares in advance which resources it may use: a dotted claim edge to each. A request turns a claim into a request; the unit is granted only if turning it into an assignment would close no cycle in the graph, counting every remaining claim as a future request. A cycle there would be an unsafe state, so the process waits even though the resource is free.',
    inputs: [{ id: 'sc', kind: 'choice', label: 'Claims', def: 'pair', options: Object.entries(CLAIM).map(([value, c]) => ({ value, label: c.label })) }],
    presets: [{ label: 'Two processes, two resources', values: { sc: 'pair' } }, { label: 'Three in a ring of claims', values: { sc: 'three' } }],
    counters: [{ id: 'granted', label: 'granted' }, { id: 'refused', label: 'made to wait' }],
    run(inp) {
      const sc = CLAIM[inp.sc], steps = H.claimRun(sc), F = new S.Frames(['granted', 'refused']);
      const gOf = (hold, want) => ({ procs: sc.procs, res: sc.res.map((name) => ({ name, units: 1 })), hold, want, claim: sc.claim });
      const d0 = KR().draw({ prefix: 'g', g: gOf([], []), pos: sc.pos }), SX = Math.round(d0.box.x + d0.box.w + 60), TY = Math.round(d0.box.y);
      const lg = KR().legend({ prefix: 'lg', x: SX, y: TY + 190, claim: true, hot: true });
      const list = (upto, cur) => [H.title('rl', SX, TY, 'requests, in order')].concat(sc.reqs.map(([p, r], k) => H.text('rq' + k, SX, TY + 28 + k * 26, (k + 1) + '. ' + sc.procs[p] + ' asks for ' + sc.res[r] + (k < upto ? ': ' + { grant: 'granted', deny: 'waits (unsafe)', wait: 'waits (held)' }[steps[k].kind] : ''), k === cur ? 'stepline act' : k < upto ? 'stepline done' : 'stepline', 14)));
      const pic = (hold, want, upto, cur, o) => {
        o = o || {};
        const hot = new Set();
        if (o.cycle) o.cycle.forEach((v, k) => hot.add(v + '>' + o.cycle[(k + 1) % o.cycle.length]));
        const d = KR().draw({ prefix: 'g', g: o.g || gOf(hold, want), pos: sc.pos, hot, act: o.act || new Set() });
        return [H.title('tt', d0.box.x, TY - 36, sc.label), ...d.items, ...list(upto, cur), ...lg.items];
      };
      F.add({ items: pic([], [], 0, -1), say: `Every process has declared its claims: ${H.list(sc.procs.map((p, i) => p + ' may use ' + H.list(sc.claim.filter(([cp]) => cp === i).map(([, r]) => sc.res[r]))))}. Nothing is held yet.`, meta: { phase: 'start', n: sc.reqs.length } });
      steps.forEach((st, k) => {
        const P = sc.procs[st.p], R = sc.res[st.r];
        if (st.kind === 'grant') { F.count('granted'); F.add({ items: pic(st.hold, st.want, k + 1, k, { act: new Set(['r' + st.r + '>p' + st.p]) }), say: `${P} asks for ${R}. It is free; with ${R} assigned to ${P} and every remaining claim counted as a request, the graph has no cycle, so the state is safe: granted.`, meta: { phase: 'grant', p: st.p, r: st.r, k }, title: P + ' gets ' + R }); }
        else if (st.kind === 'wait') { F.count('refused'); F.add({ items: pic(st.hold, st.want, k + 1, k), say: `${P} asks for ${R}, but ${sc.procs[st.holder]} holds it: ${P} waits, as it would anywhere.`, meta: { phase: 'wait', p: st.p, r: st.r, k }, title: P + ' waits' }); }
        else {
          const tg = { procs: sc.procs, res: sc.res.map((name) => ({ name, units: 1 })), hold: st.test.hold, want: st.test.want, claim: [] };
          F.add({ items: pic(null, null, k, k, { g: tg, cycle: st.cycle }), say: `${P} asks for ${R}, which is free. Pretend: ${R} goes to ${P}, and the remaining claims count as requests. That graph has the cycle ${st.cycle.map((v) => S.Rag.name(S.Rag.graph(tg), v)).join(' → ')}: an unsafe state.`, meta: { phase: 'test', p: st.p, r: st.r, k }, title: 'pretend' });
          F.count('refused');
          F.add({ items: pic(st.hold, st.want, k + 1, k), say: `So ${P} must wait for ${R}, although nobody holds it: granting it could let the processes run into a deadlock that nothing could then avoid.`, meta: { phase: 'deny', p: st.p, r: st.r, k }, title: P + ' waits' });
        }
      });
      F.last().hold = 3000;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The claim-edge rule', text: ['P ⇢ R: a claim, P may ask for R later', 'request: the claim becomes P → R', 'grant only if R → P closes no cycle', '  (claims counted as requests)', 'release: the assignment turns back into a claim', 'cycle check: O(n²) for n processes'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && (fr[i + 1].meta.phase === 'test' || fr[i + 1].meta.phase === 'grant') && fr[i + 1].meta.k > 0, pick: 'option', ask: 'Before you step: will this request be granted?', options: ['granted', 'made to wait'], answer: (fr, i) => (fr[i + 1].meta.phase === 'grant' ? 'granted' : 'made to wait'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A claim edge P ⇢ R means…', options: ['P may ask for R at some time in the future', 'P holds R', 'P waits for R now', 'R is shared'], answer: 0, why: 'Claims are declared before the process starts.' },
      { q: 'A free resource is refused under the claim-edge rule when…', options: ['assigning it would close a cycle with the claims', 'another process claims it', 'it was used before', 'the process holds nothing'], answer: 0, why: 'The cycle marks an unsafe state.' },
      { q: 'The claim-edge rule works only when…', options: ['every resource has a single unit', 'there are two processes', 'no claims overlap', 'resources can be preempted'], answer: 0, why: 'With several units a cycle no longer means a deadlock; the banker\'s tables are needed.' },
      { q: 'When P releases R, the assignment edge R → P…', options: ['becomes a claim edge again', 'disappears for good', 'becomes a request edge', 'reverses'], answer: 0, why: 'P may still ask for R again later.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
