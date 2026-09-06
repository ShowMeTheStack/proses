// Part 9, detection and recovery: the detection algorithm for many units (S.Banker.detect), then recovery by
// aborting processes (S.Banker.terminate) or by rolling a victim back to a checkpoint (S.Banker.preempt).
(function (S) {
  'use strict';
  const H = S.P09;
  // instances of our own: Allocation, Request (what each waits for now) and Available
  const DET = {
    office: { label: 'Five processes, three types: a knot', avail: [0, 0, 0], alloc: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]], request: [[0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0]], cost: [4, 2, 5, 3, 1] },
    clear: { label: 'The same, but P3 waits for C instead', avail: [0, 0, 0], alloc: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]], request: [[0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0]], cost: [4, 2, 5, 3, 1] },
    big: { label: 'Six processes, four types', avail: [0, 0, 0, 0], alloc: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 0, 1], [1, 0, 0, 0]], request: [[0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 0, 0], [2, 0, 0, 0], [0, 0, 0, 1]], cost: [6, 3, 8, 2, 1, 4] },
    pair: { label: 'Two units of A, both held, and a cycle', avail: [0, 0], alloc: [[1, 0], [1, 0], [0, 1]], request: [[0, 1], [1, 0], [1, 0]], cost: [3, 1, 2] },
  };
  const rowsText = (m) => m.map((r) => r.join(' ')).join('; ');
  const parseRows = (t) => String(t).split(';').map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/).filter(Boolean).map(Number));
  const nums = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean)).map(Number);
  H.detInput = (inp) => {
    const avail = nums(inp.avail), alloc = parseRows(inp.alloc), request = parseRows(inp.request), m = avail.length, n = alloc.length;
    if (m < 1 || m > 4) return 'Available: 1 to 4 resource types';
    if (n < 1 || n > 6) return 'Allocation: 1 to 6 rows, separated by ;';
    if (request.length !== n) return 'Request needs ' + n + ' rows, one per process';
    for (const v of [avail, ...alloc, ...request]) if (v.length !== m || v.some((x) => !Number.isInteger(x) || x < 0 || x > 20)) return 'Every row needs ' + m + ' whole numbers from 0 to 20';
    const cost = inp.cost === undefined ? alloc.map(() => 1) : nums(inp.cost);
    if (cost.length !== n || cost.some((x) => !Number.isInteger(x) || x < 1 || x > 99)) return 'Cost: ' + n + ' whole numbers from 1 to 99';
    return { avail, alloc, request, cost, n, m };
  };
  const detInputs = (def, withCost) => [
    { id: 'avail', kind: 'list', label: 'Available', def: DET[def].avail.map(String), check: (v, inp) => { const r = H.detInput(inp); return typeof r === 'string' ? r : null; } },
    { id: 'alloc', kind: 'text', label: 'Allocation (rows; separated)', def: rowsText(DET[def].alloc) },
    { id: 'request', kind: 'text', label: 'Request (rows; separated)', def: rowsText(DET[def].request) },
  ].concat(withCost ? [{ id: 'cost', kind: 'list', label: 'Cost of each process', def: DET[def].cost.map(String) }] : []);
  const detValues = (k, withCost) => Object.assign({ avail: DET[k].avail.map(String), alloc: rowsText(DET[k].alloc), request: rowsText(DET[k].request) }, withCost ? { cost: DET[k].cost.map(String) } : {});
  /** the detection trace in the shape the safety frames read */
  H.detectAsSafety = (o) => {
    const d = S.Banker.detect(o), checks = d.steps.filter((s) => s.kind === 'check'), lastC = checks[checks.length - 1], st0 = d.steps[0];
    const seq = checks.filter((c) => c.fits).map((c) => c.i);
    const work = lastC ? lastC.after : st0.work, finish = lastC ? lastC.finish : st0.finish;
    const steps = d.steps.map((s) => (s.kind === 'deadlock' || s.kind === 'clear' ? Object.assign({}, s, { work, finish, seq }) : s));
    return { d, safety: { steps, seq, work, finish } };
  };
  const vec = H.vec;

  S.topic({
    id: 'dl-detect', family: 'p09-detect', order: 10, title: 'Detecting a deadlock with many units',
    blurb: 'With several units per resource a cycle is not proof, so the detector runs the same scan as the safety check, with one change: instead of the most a process may ever need it uses what each process is asking for right now (Request). A process that holds nothing cannot be on a cycle, so the scan marks it finished at once; it may still wait for ever behind a deadlocked process. Whoever cannot be satisfied when the scan stops is deadlocked. Run it on a timer, or when the CPU sits idle with processes waiting.',
    inputs: detInputs('office'),
    presets: [
      { label: 'A knot of three', values: detValues('office') },
      { label: 'P3 waits for C: no deadlock', values: detValues('clear') },
      { label: 'Six processes, four types', values: detValues('big') },
      { label: 'Two units of A and a cycle', values: detValues('pair') },
    ],
    counters: [{ id: 'checks', label: 'rows checked' }, { id: 'done', label: 'can finish' }],
    run(inp) {
      const T = H.detInput(inp), o = { avail: T.avail, alloc: T.alloc, request: T.request }, D = H.detectAsSafety(o);
      const F = new S.Frames(['checks', 'done']), zero = T.alloc.map((r, i) => (r.every((x) => !x) ? i : -1)).filter((i) => i >= 0);
      const base = { alloc: T.alloc, max: null, need: T.request, needTitle: 'Request', avail: T.avail, zero };
      const tt = H.title('tt', 0, 0, T.n + ' processes, ' + T.m + ' resource types');
      F.add({ items: [tt, ...H.bankPicture(T, base)], say: `Allocation is what each holds, Request what each is waiting for now, and Available ${vec(T.avail)} is free.` + (zero.length ? ` ${H.list(zero.map((i) => 'P' + i))} ${zero.length > 1 ? 'hold' : 'holds'} nothing, so ${zero.length > 1 ? 'they cannot be' : 'it cannot be'} on a cycle and Finish starts true; ${zero.length > 1 ? 'they' : 'it'} may still wait for ever behind a deadlocked process.` : ''), meta: { phase: 'tables', avail: T.avail } });
      for (const f of H.safetyFrames(T, base, D.safety, {})) {
        if (f.meta.phase === 'check') { F.count('checks'); if (f.meta.fits) F.count('done'); }
        F.add({ items: [H.title('tt', 0, 0, T.n + ' processes, ' + T.m + ' resource types'), ...H.bankPicture(T, f.v)], say: f.say.replace(/Need/g, 'Request'), meta: Object.assign({ avail: T.avail, deadlocked: D.d.deadlocked }, f.meta), title: f.title });
      }
      F.last().hold = 3000;
      F.last().meta.deadlocked = D.d.deadlocked;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The detection algorithm', text: ['Work = Available', 'Finish[i] = (Allocation[i] = 0)', 'find i: not Finish[i] and Request[i] ≤ Work', '  Work = Work + Allocation[i]; Finish[i] = true', 'repeat until no such i', 'deadlocked: every i with Finish[i] false'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'tables', pick: 'option', ask: 'Before the scan: how many processes are deadlocked?', options: ['0', '1', '2', '3', '4 or more'], answer: (fr) => { const k = fr[fr.length - 1].meta.deadlocked.length; return k >= 4 ? '4 or more' : String(k); }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Detection uses Request where the safety check uses Need because…', options: ['it asks whether the processes can finish now, not in the worst case', 'Request is always larger', 'Need is unknown to everyone', 'it is faster'], answer: 0, why: 'It optimistically assumes a satisfied process finishes without asking for more.' },
      { q: 'A process that holds nothing…', options: ['cannot close a cycle: Finish starts true', 'is always deadlocked', 'must be aborted first', 'blocks the scan'], answer: 0, why: 'Nobody waits for it, so it cannot close a cycle; it may still wait for ever behind a deadlocked process.' },
      { q: 'Running detection after every request…', options: ['finds deadlocks at once but costs time at every request', 'is free', 'prevents deadlocks', 'is never correct'], answer: 0, why: 'The usual compromise is to run it every so often, or when CPU use drops.' },
      { q: 'If detection runs rarely, a deadlock found then…', options: ['may involve many processes, and its cause is harder to name', 'is always small', 'cannot be broken', 'is a false alarm'], answer: 0, why: 'Waits pile up behind a deadlock while nobody looks.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  /** the recovery picture: Allocation, Request, Available, the costs, and who was aborted or rolled back */
  const recPicture = (T, st, o) => {
    const K = S.Kit.bank, n = T.n, m = T.m, cw = 40, ch = 30, size = 15, W = m * (cw + 3) - 3, gap = 30, x0 = 34, y0 = 56;
    const P = Array.from({ length: n }, (_, i) => 'P' + i), res = 'ABCD'.slice(0, m).split(''), items = [];
    const rowCls = (i) => (o.victim === i ? 'act' : o.gone && o.gone.includes(i) ? 'bad' : o.dead && o.dead.includes(i) ? 'bad' : '');
    const ch2 = (i, j, t) => (o.victim === i && o.freed && o.freed[j] ? (t === 'r' ? ' req' : ' hot') : '');
    items.push(...K.matrix({ prefix: 'al', x: x0, y: y0, cw, ch, size, title: 'Allocation', cols: res, rows: P, vals: st.alloc, rowCls, cls: (i, j) => ch2(i, j, 'a') + (o.gone && o.gone.includes(i) ? ' faded' : '') }).items);
    items.push(...K.matrix({ prefix: 'rq', x: x0 + W + gap, y: y0, cw, ch, size, title: 'Request', cols: res, rows: null, vals: st.request, cls: (i, j) => ch2(i, j, 'r') + (o.gone && o.gone.includes(i) ? ' faded' : '') }).items);
    const cx = x0 + 2 * (W + gap);
    items.push(...K.matrix({ prefix: 'co', x: cx, y: y0, cw: 50, ch, size, title: o.costTitle || 'cost', cols: [''], rows: null, vals: o.costs.map((c) => [c]), cls: (i) => (o.victim === i ? 'act' : '') }).items);
    const fx = cx + 50 + gap;
    items.push(H.title('st', fx, y0 - 34, 'state'));
    P.forEach((p, i) => { const t = o.gone && o.gone.includes(i) ? 'aborted' : o.unknown ? (st.request[i].some((x) => x) ? 'waiting' : 'running') : o.dead && o.dead.includes(i) ? 'deadlocked' : o.rolled && o.rolled[i] ? 'rolled back ×' + o.rolled[i] : 'can go on'; items.push({ key: 'sx' + i, kind: 'cell', x: fx, y: y0 + i * (ch + 3), w: 132, h: ch, rx: 5, text: t, size: 13, cls: 'tag ' + (t === 'deadlocked' ? 'hot' : t === 'aborted' ? 'done' : t === 'can go on' ? 'good' : t === 'waiting' || t === 'running' ? '' : 'act') }); });
    const by = y0 + n * (ch + 3) + 26;
    items.push(...K.vector({ prefix: 'av', x: 0, y: by, cw, ch, size, title: 'Available', titleW: 96, vals: st.avail, cls: (j) => (o.freed && o.freed[j] ? 'req' : '') }).items);
    if (o.verdict) items.push(H.text('vd', 0, by + ch + 34, o.verdict, 'verdict2 ' + (o.vcls || ''), 16));
    return items;
  };

  S.topic({
    id: 'dl-recover-abort', family: 'p09-detect', order: 20, title: 'Recovery by aborting processes',
    blurb: 'Once a deadlock is found, something must give. The bluntest cure aborts every deadlocked process at once: certain, but all their work is lost. A gentler one aborts them one at a time, the cheapest first by some cost (how long it has run, how much it holds, its priority), and runs detection again after each, stopping as soon as the rest can go on.',
    inputs: detInputs('office', true).concat([{ id: 'policy', kind: 'choice', label: 'Policy', def: 'cheapest', options: [{ value: 'cheapest', label: 'one at a time, the cheapest first' }, { value: 'all', label: 'every deadlocked process at once' }] }]),
    presets: [
      { label: 'A knot of three, cheapest first', values: Object.assign(detValues('office', true), { policy: 'cheapest' }) },
      { label: 'The same, all at once', values: Object.assign(detValues('office', true), { policy: 'all' }) },
      { label: 'Six processes, cheapest first', values: Object.assign(detValues('big', true), { policy: 'cheapest' }) },
      { label: 'Two units of A, cheapest first', values: Object.assign(detValues('pair', true), { policy: 'cheapest' }) },
    ],
    counters: [{ id: 'aborted', label: 'aborted' }, { id: 'lost', label: 'cost lost' }],
    run(inp) {
      const T = H.detInput(inp), R = S.Banker.terminate({ avail: T.avail, alloc: T.alloc, request: T.request, cost: T.cost }, { policy: inp.policy });
      const F = new S.Frames(['aborted', 'lost']), gone = [];
      const tt = H.title('tt', 0, 0, inp.policy === 'all' ? 'abort every deadlocked process' : 'abort the cheapest, then look again');
      const st0 = { avail: T.avail, alloc: T.alloc, request: T.request };
      F.add({ items: [tt, ...recPicture(T, st0, { costs: T.cost, unknown: true })], say: `The costs of aborting each process: ${H.list(T.cost.map((c, i) => 'P' + i + ' ' + c))}. First, detection.`, meta: { phase: 'start', cost: T.cost } });
      let lost = 0;
      R.steps.forEach((st) => {
        if (st.kind === 'detect') F.add({ items: [tt, ...recPicture(T, st, { costs: T.cost, dead: st.deadlocked, gone: gone.slice() })], say: H.plain(st.say), meta: { phase: 'detect', deadlocked: st.deadlocked, avail: st.avail }, title: 'detect' });
        else if (st.kind === 'abort') {
          gone.push(st.i); lost += T.cost[st.i]; F.count('aborted').set('lost', lost);
          F.add({ items: [tt, ...recPicture(T, st, { costs: T.cost, dead: st.deadlocked.filter((i) => !gone.includes(i)), gone: gone.slice(), victim: st.i, freed: st.freed })], say: H.plain(st.say), meta: { phase: 'abort', i: st.i, freed: st.freed, avail: st.avail, cost: T.cost[st.i], lost }, title: 'abort P' + st.i });
        } else F.add({ items: [tt, ...recPicture(T, st, { costs: T.cost, gone: gone.slice(), verdict: gone.length ? 'recovered: ' + H.plural(gone.length, 'process', 'processes') + ' aborted, cost ' + lost : 'no deadlock: nothing to abort', vcls: 'good' })], say: H.plain(st.say) + (gone.length ? ` In all ${H.list(gone.map((i) => 'P' + i))} ${gone.length > 1 ? 'were' : 'was'} aborted, at a cost of ${lost}.` : ''), meta: { phase: 'clear', avail: st.avail, lost, n: gone.length }, title: 'clear', hold: 3000 });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Abort', text: ['all: abort every deadlocked process', '  sure, but all their work is lost', 'one at a time: abort the cheapest,', '  run detection again, repeat', 'cost: time run, time left, units held,', '  priority, interactive or batch'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'detect' && fr[i + 1] && fr[i + 1].meta.phase === 'abort', once: true, pick: 'item', ask: 'Click the Allocation row of the process that will be aborted first.', answer: (fr, i) => 'al:r' + fr[i + 1].meta.i, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Aborting every deadlocked process at once is…', options: ['certain to break the deadlock, but wasteful', 'never enough', 'the cheapest choice always', 'the same as rollback'], answer: 0, why: 'All their work is lost, even of processes whose abort was not needed.' },
      { q: 'After aborting one process, the system must…', options: ['run detection again', 'abort the rest anyway', 'reboot', 'grant every request'], answer: 0, why: 'It may already be enough; or the deadlock may remain among the others.' },
      { q: 'Which is a sensible cost for choosing whom to abort?', options: ['how much work would be lost', 'the process id', 'alphabetical order', 'the last process to start, always'], answer: 0, why: 'The aim is to lose as little as possible.' },
      { q: 'Aborting a process in the middle of updating a file can…', options: ['leave the file inconsistent', 'never cause harm', 'speed up the disk', 'free its memory twice'], answer: 0, why: 'This is why databases roll transactions back rather than just stop them.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'dl-recover-rollback', family: 'p09-detect', order: 30, title: 'Recovery by preemption and rollback',
    blurb: 'Instead of killing a process, take resources from it: roll it back to a checkpoint it saved earlier, return the units it gained since, and let it ask for them again. The victim is the deadlocked process that is cheapest to roll back. If the same process is picked every time it may never finish, so each rollback adds a penalty to its cost: that is how starvation is avoided.',
    inputs: detInputs('office', true).concat([{ id: 'penalty', kind: 'number', label: 'Penalty per rollback', def: 10, min: 0, max: 50 }]),
    presets: [
      { label: 'A knot of three', values: Object.assign(detValues('office', true), { penalty: 10 }) },
      { label: 'Six processes, four types', values: Object.assign(detValues('big', true), { penalty: 10 }) },
      { label: 'Two units of A', values: Object.assign(detValues('pair', true), { penalty: 5 }) },
    ],
    counters: [{ id: 'rollbacks', label: 'rollbacks' }],
    run(inp) {
      const T = H.detInput(inp), R = S.Banker.preempt({ avail: T.avail, alloc: T.alloc, request: T.request, cost: T.cost, penalty: inp.penalty });
      const F = new S.Frames(['rollbacks']), rolled = T.alloc.map(() => 0);
      const tt = H.title('tt', 0, 0, 'roll back the cheapest, then look again');
      const eff = () => T.cost.map((c, i) => c + inp.penalty * rolled[i]);
      F.add({ items: [tt, ...recPicture(T, { avail: T.avail, alloc: T.alloc, request: T.request }, { costs: eff(), costTitle: 'cost now', unknown: true })], say: `Each process saved a checkpoint holding nothing. Rolling one back costs ${H.list(T.cost.map((c, i) => 'P' + i + ' ' + c))}, plus ${inp.penalty} for every earlier rollback of it, so that a process rolled back in one deadlock is less likely to be picked in the next.`, meta: { phase: 'start', cost: T.cost, penalty: inp.penalty } });
      R.steps.forEach((st) => {
        if (st.kind === 'detect') F.add({ items: [tt, ...recPicture(T, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice() })], say: H.plain(st.say), meta: { phase: 'detect', deadlocked: st.deadlocked, avail: st.avail, costs: eff() }, title: 'detect' });
        else if (st.kind === 'rollback') {
          const c = eff()[st.i]; rolled[st.i]++; F.count('rollbacks');
          F.add({ items: [tt, ...recPicture(T, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice(), victim: st.i, freed: st.freed })], say: H.plain(st.say) + ` Its cost for next time is ${eff()[st.i]}.`, meta: { phase: 'rollback', i: st.i, freed: st.freed, avail: st.avail, request: st.request[st.i], was: c, costs: eff() }, title: 'roll back P' + st.i });
        } else if (st.kind === 'stuck') F.add({ items: [tt, ...recPicture(T, st, { costs: eff(), costTitle: 'cost now', dead: st.deadlocked, rolled: rolled.slice(), verdict: 'rollback cannot help: abort one', vcls: 'hot' })], say: H.plain(st.say), meta: { phase: 'stuck', costs: eff() }, title: 'stuck', hold: 3000 });
        else F.add({ items: [tt, ...recPicture(T, st, { costs: eff(), costTitle: 'cost now', rolled: rolled.slice(), verdict: 'recovered: no work beyond the checkpoints lost', vcls: 'good' })], say: H.plain(st.say) + ` ${H.plural(R.victims.length, 'rollback')} in all, and nobody was killed.`, meta: { phase: 'clear', avail: st.avail, n: R.victims.length }, title: 'clear', hold: 3000 });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Preempt and roll back', text: ['victim: least cost + penalty × rollbacks', 'roll it back to its checkpoint:', '  units gained since go to Available', '  its Request grows by the same units', 'run detection again', 'the penalty stops one victim starving'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'detect' && fr[i + 1] && fr[i + 1].meta.phase === 'rollback', once: true, pick: 'item', ask: 'Click the Allocation row of the process that will be rolled back.', answer: (fr, i) => 'al:r' + fr[i + 1].meta.i, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Rolling a process back means…', options: ['restoring it to a saved checkpoint and returning what it gained since', 'killing it', 'lowering its priority', 'moving it to another CPU'], answer: 0, why: 'Its work since the checkpoint is redone later.' },
      { q: 'Without a penalty, the same cheap process might be…', options: ['rolled back again and again, and starve', 'never chosen', 'deadlocked for ever', 'promoted'], answer: 0, why: 'Counting rollbacks in the cost moves the choice on.' },
      { q: 'Rollback needs…', options: ['checkpoints, saved state the process can return to', 'a second CPU', 'single units per resource', 'the banker\'s Max table'], answer: 0, why: 'Without a saved state the only rollback is to the start, which is an abort.' },
      { q: 'After a rollback, the victim\'s Request…', options: ['includes the units it gave back', 'becomes zero', 'is unchanged', 'is forgotten'], answer: 0, why: 'It must ask for them again to redo its work.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
