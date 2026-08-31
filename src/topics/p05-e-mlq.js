// Part 5: the multilevel queue (fixed classes, strict priority or shares of each window), the multilevel feedback
// queue (levels, quanta, allotments and the boost), and the ways a program can game the feedback queue, shown by
// running the same jobs under a rule and without it, side by side.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt;

  /** lanes, one per queue, each with its waiting jobs; o {prefix, x, y, w, h, gap, names: [..], subs: [..], queues: [[ids]], jobs, sub(id) -> text, cls(k)} */
  P.queueLanes = function (o) {
    const items = [], nameW = o.nameW || 190;
    o.names.forEach((nm, k) => {
      const y = o.y + k * (o.h + o.gap);
      items.push(...G().lane({ prefix: (o.prefix || 'ql') + k, x: o.x, y, w: o.w, h: o.h, name: '', cls: o.cls ? o.cls(k) : k === 0 ? 'top' : '', size: 15 }).filter((it) => it.kind !== 'text'));
      items.push(P.text((o.prefix || 'ql') + k + ':nm', o.x + 12, y + (o.subs ? o.h / 2 - 4 : o.h / 2 + 6), nm, 'glname', 15));
      if (o.subs) items.push(P.text((o.prefix || 'ql') + k + ':sb', o.x + 12, y + o.h / 2 + 15, o.subs[k], 'glabel', 14));
      const ids = o.queues[k] || [];
      let x = o.x + nameW;
      if (!ids.length) items.push(P.text((o.prefix || 'ql') + k + ':e', x, y + o.h / 2 + 5, 'empty', 'glabel', 14));
      for (const id of ids) {
        const sub = o.sub ? o.sub(id) : null, w = sub ? Math.max(48, Math.ceil(S.geom.textWidth(sub, 14) + 14)) : 44;
        const b = G().job('j:' + id, x, y + (o.h - 40) / 2, id, o.jobs, { w, h: 40 });
        if (sub) { b.lines = [id, sub]; b.size = 14; }
        items.push(b);
        x += w + 6;
      }
    });
    return items;
  };
  /** the CPU box and the I/O box at the side: o {x, y, w, h, st, jobs, sub(id), ioSub(e), end, cpuNote} */
  P.sideBoxes = function (o) {
    const items = [], half = Math.round((o.h - 12) / 2);
    items.push({ key: 'cpu', kind: 'cell', x: o.x, y: o.y, w: o.w, h: half, text: '', cls: 'gcpu', audit: 'group', layer: 'back' });
    items.push(P.text('cpu:l', o.x + 10, o.y + 20, 'CPU', 'glname', 15));
    if (o.cpuNote) items.push(P.text('cpu:n', o.x + o.w - 10, o.y + 20, o.cpuNote, 'glabel', 14, 'end'));
    if (o.st.run) {
      const sub = o.sub ? o.sub(o.st.run) : null, w = sub ? Math.max(56, Math.ceil(S.geom.textWidth(sub, 14) + 14)) : 48;
      const b = G().job('j:' + o.st.run, o.x + (o.w - w) / 2, o.y + 30, o.st.run, o.jobs, { w, h: 40, cls: 'run' + (o.st.cs ? ' p05sw' : '') });
      if (sub) { b.lines = [o.st.run, sub]; b.size = 14; }
      items.push(b);
    } else items.push(P.text('cpu:i', o.x + o.w / 2, o.y + 56, o.end ? 'all done' : 'idle', 'glabel', 14, 'middle'));
    const iy = o.y + half + 12;
    items.push({ key: 'io', kind: 'cell', x: o.x, y: iy, w: o.w, h: half, text: '', cls: 'gio', audit: 'group', layer: 'back' });
    items.push(P.text('io:l', o.x + 10, iy + 20, 'I/O', 'glname', 15));
    (o.st.io || []).slice(0, 3).forEach((e, k) => {
      const sub = o.ioSub ? o.ioSub(e) : 'to ' + e.until, w = Math.max(56, Math.ceil(S.geom.textWidth(sub, 14) + 14));
      const b = G().job('j:' + e.id, o.x + 10 + k * (w + 6), iy + 30, e.id, o.jobs, { w, h: 40, cls: 'io' });
      b.lines = [e.id, sub]; b.size = 14;
      items.push(b);
    });
    if (!(o.st.io || []).length) items.push(P.text('io:n', o.x + o.w / 2, iy + 56, 'none', 'glabel', 14, 'middle'));
    return items;
  };

  // ---------------------------------------------------------------------------------------------------------------
  const CLS = () => Sch().MLQ_CLASSES;
  S.topic({
    id: 'sch-mlq', family: 'p05-mlq', order: 10, title: 'Multilevel queue',
    blurb: 'A multilevel queue sorts jobs into fixed classes, each with its own ready queue and its own policy: here system jobs (FCFS), interactive jobs (round robin) and batch jobs (FCFS). Between the classes, either a strict order (a class runs only when every more important one is empty) or shares of the CPU, a budget of ticks per window for each class, so the batch class is never shut out entirely.',
    inputs: [
      P.workInput('S 4 2 (6) 2 cls=0\nI 0 3 (4) 3 (4) 2 cls=1\nJ 2 2 (5) 2 cls=1\nB 0 12 cls=2\nC 1 9 cls=2'),
      { id: 'mode', kind: 'choice', label: 'Between the classes', def: 'strict', options: [{ value: 'strict', label: 'strict priority' }, { value: 'share', label: 'shares of each window' }] },
      { id: 'shares', kind: 'list', label: 'Shares: system, interactive, batch', def: ['5', '3', '2'], min: 3, max: 3, check: (v) => (v.every((x) => /^\d+$/.test(x) && +x >= 1 && +x <= 20) ? null : 'Shares: three whole numbers from 1 to 20') },
      { id: 'window', kind: 'number', label: 'Window (ticks)', def: 10, min: 3, max: 30 },
    ],
    presets: [
      { label: 'Strict: batch waits for everyone', values: { mode: 'strict' } },
      { label: 'Shares 5 : 3 : 2 of every 10 ticks', values: { mode: 'share', shares: ['5', '3', '2'], window: 10 } },
      { label: 'Shares 1 : 1 : 1 of every 6 ticks', values: { mode: 'share', shares: ['1', '1', '1'], window: 6 } },
      { label: 'A busy interactive class starves batch', values: { work: 'I 0 4 (1) 4 (1) 4 cls=1\nJ 0 3 (1) 3 (1) 3 cls=1\nB 0 6 cls=2', mode: 'strict' } },
      { label: 'The same, with shares', values: { work: 'I 0 4 (1) 4 (1) 4 cls=1\nJ 0 3 (1) 3 (1) 3 cls=1\nB 0 6 cls=2', mode: 'share', shares: ['4', '4', '2'], window: 10 } },
    ],
    run(inp) {
      const work = P.work(inp.work), shares = inp.shares.map(Number);
      const tr = Sch().mlq(work, { mode: inp.mode, shares, window: inp.window }), jobs = tr.jobs.map((j) => j.id), C = tr.params.classes, share = inp.mode === 'share';
      const full = tr.params.budgets;
      const laneH = 56, gap = 8, lanesH = 3 * laneH + 2 * gap, gy = lanesH + 70, ty = gy + 3 * 34 + 40;
      const frames = [];
      let prev = -1;
      for (const t of P.moments(tr)) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, -14, t, end)];
        const subs = C.map((c, k) => (c.policy === 'rr' ? 'round robin, q ' + c.quantum : 'first come, first served') + (share ? ' · budget ' + (end ? full[k] : st.budget[k]) + ' of ' + full[k] : ''));
        items.push(...P.queueLanes({ x: 0, y: 0, w: 570, h: laneH, gap, names: C.map((c) => c.name), subs, queues: end ? [[], [], []] : st.queues, jobs, nameW: 300, cls: (k) => (k === 0 ? 'top' : '') + (share && !end && st.budget[k] === 0 ? ' p05spent' : '') }));
        items.push(...P.sideBoxes({ x: 590, y: 0, w: 210, h: lanesH, st: end ? { run: null, io: [] } : st, jobs, end, cpuNote: st.run ? C[st.cls].name : '' }));
        items.push(...P.rowGantt({ tr, jobs, t, x0: 110, x1: P.W_, y: gy, rows: C.map((c) => c.name), rowOf: (s) => s.cls, final: end, marks: share ? Array.from({ length: Math.floor((tr.end - 1) / tr.params.window) }, (_, k) => ({ t: (k + 1) * tr.params.window, text: '' })) : [] }).items);
        const fresh = P.finished(tr, prev, t);
        items.push(...P.table({ tr, t, x: 0, y: ty, final: end, cols: 'short', fresh: end ? [] : fresh }).items);
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: end ? [] : [].concat(...st.queues), decision: st.decision, step: st, budget: st.budget, full };
        let say = P.clean(st.say);
        if (end) {
          const rows = tr.metrics.rows, by = C.map((c, k) => rows.filter((r) => tr.jobs.find((j) => j.id === r.id).cls === k || (k === 2 && tr.jobs.find((j) => j.id === r.id).cls > 2)));
          const avgW = by.map((rs) => (rs.length ? rs.reduce((a, r) => a + r.waiting, 0) / rs.length : null));
          meta.avgW = avgW; meta.metrics = tr.metrics;
          say = `Every job has finished at t = ${tr.end}. Average waiting by class: ` + C.map((c, k) => (avgW[k] === null ? `${c.name} none` : `${c.name} ${P.f(avgW[k])}`)).join(', ') + '.' + (share ? ` With budgets (in ticks) of ${full.join(', ')} in every window of ${tr.params.window}, the batch class still gets its turn.` : ' Under strict priority the batch class only runs when no system or interactive job is ready.');
        }
        frames.push({ items, say, meta, title: end ? 'end' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
        prev = t;
      }
      P.markAsks(frames, 3);
      return { frames, def: P.def(['Classes', 'Each job belongs to one class for its whole life, chosen when it is created (by its kind, its owner, its memory size...). Each class has its own ready queue and its own policy.'], ['Between the classes', ['strict: run the most important non-empty class; an arrival in a more important class preempts', 'shares: each window of w ticks, class k may use shares[k] / Σ shares of it; a class out of budget waits, unless no class with budget has a job']], ['Its weakness', 'Jobs cannot move between classes, so a misplaced job stays misplaced, and under strict priority the last class can starve.']) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'Under strict priority, when does the batch class run?', options: ['Only when the system and interactive queues are both empty', 'Every third tick', 'When its quantum comes', 'Never'], answer: 0, why: 'A class runs only when every more important class is empty.' },
      { q: 'Shares 5 : 3 : 2 in a window of 10 ticks give the batch class…', options: ['2 ticks of every 10', '5 ticks', '3 ticks', 'whatever is left over'], answer: 0, why: '2 / (5 + 3 + 2) × 10.' },
      { q: 'Can a job move from the batch class to the interactive class in a multilevel queue?', options: ['No: classes are fixed', 'Yes, after using its quantum', 'Yes, by aging', 'Only on I/O'], answer: 0, why: 'Moving between queues is what the feedback queue adds.' },
      { q: 'Why give each class its own policy?', options: ['Interactive jobs want short turns; batch jobs want few switches', 'To use less memory', 'So that classes can share a queue', 'It is required by FCFS'], answer: 0, why: 'Different kinds of work want different trade-offs.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const MLFQ_WORK = 'A 0 16\nB 1 12\nC 3 1 (7) 1 (7) 1 (7) 1 (7) 1';
  const mlfqInputs = () => [
    P.workInput(MLFQ_WORK),
    { id: 'levels', kind: 'number', label: 'Levels', def: 3, min: 2, max: 4 },
    { id: 'q', kind: 'number', label: 'Q0 quantum (doubles each level)', def: 2, min: 1, max: 4 },
    { id: 'allot', kind: 'number', label: 'Allotment per level (ticks)', def: 4, min: 1, max: 16 },
    { id: 'boost', kind: 'number', label: 'Boost every (ticks, 0: never)', def: 24, min: 0, max: 60 },
  ];
  const mlfqParams = (inp, extra) => Object.assign({ levels: inp.levels, quantum: [inp.q], allot: Math.max(inp.allot, inp.q), boost: inp.boost }, extra || {});
  S.topic({
    id: 'sch-mlfq', family: 'p05-mlq', order: 20, title: 'The multilevel feedback queue',
    blurb: 'A multilevel feedback queue learns what each job is like by watching it. Every job starts in the top queue, Q0. A job that uses up its allotment of CPU at a level drops a level, where quanta are longer; a job that blocks for I/O before then stays where it is. So interactive jobs stay on top and get the CPU at once, while long computations sink. Every so often a boost lifts everyone back to Q0, so nobody starves and a job that changes its ways is noticed.',
    inputs: mlfqInputs(),
    presets: [
      { label: 'Two hogs and an editor', values: { work: MLFQ_WORK } },
      { label: 'No boost: the hogs sink and stay', values: { work: MLFQ_WORK, boost: 0 } },
      { label: 'Four levels, quantum 1', values: { work: MLFQ_WORK, levels: 4, q: 1, allot: 2, boost: 30 } },
      { label: 'Jobs with I/O', values: { work: P.W.io, boost: 16 } },
      { label: 'A server mix', values: { work: P.W.burst, boost: 20 } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().mlfq(work, mlfqParams(inp)), Pm = tr.params, n = Pm.levels, jobs = tr.jobs.map((j) => j.id);
      const al = (k) => (Pm.allot[k] === Infinity ? '∞' : Pm.allot[k]);
      const laneH = 54, gap = 8, lanesH = n * laneH + (n - 1) * gap, gy = lanesH + 64, ty = gy + n * 34 + 46;
      const boosts = tr.events.filter((e) => e.kind === 'boost').map((e) => ({ t: e.t, text: 'boost' }));
      const frames = [];
      let prev = -1;
      for (const t of P.moments(tr, (st) => st.boosted)) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, -14, t, end)];
        const subs = Pm.quantum.map((q, k) => 'quantum ' + q + ' · allotment ' + (Pm.allot[k] === Infinity ? 'none' : Pm.allot[k]));
        items.push(...P.queueLanes({ x: 0, y: 0, w: 560, h: laneH, gap, names: Pm.quantum.map((_, k) => 'Q' + k), subs, queues: end ? Pm.quantum.map(() => []) : st.queues, jobs, nameW: 230, sub: (id) => st.used[id] + '/' + al(st.lv[id]), cls: (k) => (k === 0 ? 'top' : '') + (st.boosted && k === 0 ? ' boost' : '') }));
        items.push(...P.sideBoxes({ x: 590, y: 0, w: 210, h: lanesH, st: end ? { run: null, io: [] } : st, jobs, end, sub: (id) => st.used[id] + '/' + al(st.lv[id]), ioSub: (e) => 'Q' + st.lv[e.id] + ', to ' + e.until, cpuNote: st.run ? 'at Q' + st.level : '' }));
        items.push(...P.rowGantt({ tr, jobs, t, x0: 60, x1: P.W_, y: gy, rows: Pm.quantum.map((_, k) => 'Q' + k), rowOf: (s) => s.level, final: end, marks: boosts }).items);
        const fresh = P.finished(tr, prev, t);
        items.push(...P.table({ tr, t, x: 0, y: ty, final: end, cols: 'short', fresh: end ? [] : fresh }).items);
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: end ? [] : [].concat(...st.queues), decision: st.decision, step: st, used: st.used, lv: st.lv, params: { quantum: Pm.quantum, allot: Pm.allot.filter((a) => a !== Infinity), boost: Pm.boost } };
        let say = P.clean(st.say);
        if (end) { meta.metrics = tr.metrics; say = P.sayEnd(tr) + ` Response times: ${tr.metrics.rows.map((r) => r.id + ' ' + r.response).join(', ')}.`; }
        frames.push({ items, say, meta, title: end ? 'end' : st.boosted ? 'boost' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
        prev = t;
      }
      P.markAsks(frames, 3);
      return { frames, def: P.def(['The rules', ['1. A job always runs from the highest non-empty queue; round robin within a queue', '2. A new job enters Q0', '3. A job that has used its allotment at a level (however it split it up) drops one level', '4. A job that uses its whole quantum goes to the back of its queue', '5. Every boost period, all jobs move to Q0', 'A job ready in a higher queue preempts a lower one at once']], ['Reading the boxes', 'Each job shows used/allotment: the CPU ticks it has used at its current level, against the allotment it may use there before dropping.']) };
    },
    predict: [P.askNext(), { at: (f, i, fr) => f.meta.phase === 'tick' && fr[i + 1] && fr[i + 1].meta.step && fr[i + 1].meta.step.boosted && !fr.slice(0, i).some((g) => g.meta.step && g.meta.step.boosted), pick: 'option', ask: 'The boost comes next. Which queue will every job be in after it?', options: ['Q0', 'the queue it is in now', 'the bottom queue'], answer: 'Q0', explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'Where does a new job start in an MLFQ?', options: ['Q0, the top queue', 'the bottom queue', 'a random queue', 'the queue of its parent'], answer: 0, why: 'Every job is first assumed to be interactive.' },
      { q: 'Allotment 4 at Q0. A job runs 3 ticks, blocks for I/O, comes back and runs 1 tick. Where is it now?', options: ['It drops to Q1', 'It stays in Q0', 'It goes to the bottom', 'It is boosted'], answer: 0, why: 'The allotment counts all its CPU at the level: 3 + 1 = 4.' },
      { q: 'Why boost every job to Q0 periodically?', options: ['So long jobs at the bottom do not starve, and a job that turns interactive is noticed', 'To save memory', 'To shorten the quanta', 'To reset the clock'], answer: 0, why: 'Without it, a steady stream of short jobs can starve the bottom queues.' },
      { q: 'Why are quanta longer in lower queues?', options: ['Jobs there are CPU-bound; longer turns mean fewer switches', 'Lower queues are less important', 'To punish them', 'They are not'], answer: 0, why: 'Long computations gain little from frequent switching.' },
      { q: 'An interactive job runs 1 tick and then waits for a key. In an MLFQ it…', options: ['stays in Q0 and gets the CPU quickly each time', 'sinks to the bottom', 'is boosted each time', 'starves'], answer: 0, why: 'It never uses up its allotment.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const GAME_WORK = 'A 0 14\nB 0 14\nG 1 3 (1) 3 (1) 3 (1) 3 (1) 3 (1) 3 (1) 3';
  S.topic({
    id: 'sch-mlfq-game', family: 'p05-mlq', order: 30, title: 'Gaming the feedback queue',
    blurb: 'Each MLFQ rule closes a loophole. If the allotment count started again after every I/O, a program could run just under its allotment, do a tiny I/O, and stay in Q0 for ever, taking most of the CPU. If there were no boost, long jobs at the bottom could starve. Here the same jobs run twice, with the rule and without it, and the CPU each job got is compared.',
    inputs: [
      P.workInput(GAME_WORK),
      { id: 'rule', kind: 'choice', label: 'Compare', def: 'allot', options: [{ value: 'allot', label: 'allotment kept across I/O, or reset by it' }, { value: 'boost', label: 'with the boost, or without it' }] },
      { id: 'allot', kind: 'number', label: 'Allotment per level (ticks)', def: 4, min: 2, max: 12 },
      { id: 'boost', kind: 'number', label: 'Boost every (ticks)', def: 20, min: 4, max: 60 },
    ],
    presets: [
      { label: 'G runs 3, does 1 tick of I/O, again and again', values: { work: GAME_WORK, rule: 'allot' } },
      { label: 'Starvation without the boost', values: { work: 'A 0 30\nI 1 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1\nJ 2 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1', rule: 'boost', boost: 8, allot: 4 } },
      { label: 'An honest editor is not hurt by the rule', values: { work: MLFQ_WORK, rule: 'allot', allot: 4 } },
    ],
    run(inp) {
      const work = P.work(inp.work), base = { levels: 3, quantum: [2], allot: inp.allot, boost: inp.rule === 'boost' ? inp.boost : 0 };
      const A = inp.rule === 'allot' ? Sch().mlfq(work, Object.assign({}, base, { allotMode: 'reset-io' })) : Sch().mlfq(work, Object.assign({}, base, { boost: 0 }));
      const B = inp.rule === 'allot' ? Sch().mlfq(work, Object.assign({}, base, { allotMode: 'level' })) : Sch().mlfq(work, Object.assign({}, base, { boost: inp.boost }));
      const names = inp.rule === 'allot' ? ['count reset by I/O', 'count kept across I/O'] : ['no boost', 'boost every ' + inp.boost];
      const jobs = A.jobs.map((j) => j.id), T = Math.max(A.end, B.end), rows = ['Q0', 'Q1', 'Q2'];
      const frames = [];
      // while every job still competes: up to the first finish in either run
      const compete = Math.min(...A.metrics.rows.map((r) => r.finish), ...B.metrics.rows.map((r) => r.finish));
      const step = Math.max(3, Math.ceil(compete / 6)), ts = [];
      for (let t = step; t < compete; t += step) ts.push(t);
      ts.push(compete, T);
      const share = (tr, t) => Sch().share(tr, 0, Math.min(t, tr.end, compete));
      for (const t of ts) {
        const end = t === T, items = [P.now('now', 0, -14, t, end)];
        [A, B].forEach((tr, k) => {
          const y = 40 + k * 200;
          items.push(P.text('nm' + k, 0, y - 6, names[k], 'gpol', 16));
          const marks = tr.events.filter((e) => e.kind === 'boost').map((e) => ({ t: e.t, text: 'boost' }));
          items.push(...P.rowGantt({ prefix: 'r' + k, tr, jobs, t: Math.min(t, tr.end), x0: 60, x1: 520, y: y + 30, rows, rowOf: (s) => s.level, final: t >= tr.end, T, marks }).items);
          // the CPU each job has had so far, as bars
          const got = share(tr, t), tot = Object.values(got).reduce((a, b) => a + b, 0) || 1;
          items.push(P.text('sh' + k, 570, y - 6, t > compete ? 'CPU up to t = ' + compete : 'CPU so far', 'glabel', 14));
          jobs.forEach((id, i) => {
            const by = y + 30 + i * 34, w = Math.round((150 * got[id]) / Math.max(1, Math.min(t, compete))) || 1;
            items.push(P.text('sn' + k + id, 590, by + 18, id, 'glname', 14, 'end'));
            items.push({ key: 'sb' + k + id, kind: 'cell', x: 600, y: by + 2, w, h: 22, text: '', cls: 'gseg ' + P.pcls(jobs, id) });
            items.push(P.text('sv' + k + id, 606 + w, by + 18, got[id] + ' (' + Math.round((100 * got[id]) / tot) + '%)', 'p05val', 14));
          });
        });
        const gA = share(A, t), gB = share(B, t), totA = Object.values(gA).reduce((a, b) => a + b, 0) || 1, totB = Object.values(gB).reduce((a, b) => a + b, 0) || 1;
        const hog = jobs.reduce((a, id) => (gA[id] / totA > gA[a] / totA ? id : a), jobs[0]);
        const say = end
          ? `While all ${jobs.length} jobs competed, up to t = ${compete}: ${names[0]}, ${hog} got ${gA[hog]} of ${totA} CPU ticks (${Math.round((100 * gA[hog]) / totA)}%); ${names[1]}, ${hog} got ${gB[hog]} of ${totB} (${Math.round((100 * gB[hog]) / totB)}%). Finish times: ` + jobs.map((id) => `${id} ${A.metrics.rows.find((r) => r.id === id).finish} against ${B.metrics.rows.find((r) => r.id === id).finish}`).join(', ') + '.'
          : `Ticks of CPU by t = ${Math.min(t, compete)}, ${names[0]}: ` + jobs.map((id) => `${id} ${gA[id]}`).join(', ') + `; ${names[1]}: ` + jobs.map((id) => `${id} ${gB[id]}`).join(', ') + '.';
        frames.push({ items, say, meta: { phase: end ? 'end' : 'window', t, compete, n: jobs.length, gA, gB, totA, totB, hog, finA: A.metrics.rows.map((r) => r.finish), finB: B.metrics.rows.map((r) => r.finish), pA: Math.round((100 * gA[hog]) / totA), pB: Math.round((100 * gB[hog]) / totB), pctA: jobs.map((id) => Math.round((100 * gA[id]) / totA)), pctB: jobs.map((id) => Math.round((100 * gB[id]) / totB)) }, title: end ? 'end' : 't = ' + t });
      }
      return { frames, def: P.def(['The loophole and its fix', ['old rule: an I/O resets the allotment count', 'trick: run just under the allotment, then do a tiny I/O', 'fix: count all CPU used at a level, however it is split up']], ['Starvation and its fix', 'With many interactive jobs always in the top queues, a long job at the bottom may never run. A periodic boost to Q0 gives it a turn, and lets a job whose behaviour changes be judged afresh.']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Under which of the two runs will the job that benefits most get the larger share of the CPU?', options: (fr) => { const m = fr[fr.length - 1].meta; return ['the first run', 'the second run', 'the same in both']; }, answer: (fr) => { const m = fr[fr.length - 1].meta; return m.pA > m.pB ? 'the first run' : m.pA < m.pB ? 'the second run' : 'the same in both'; }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Allotment 4, and the count resets at every I/O. A job runs 3 ticks then does 1 tick of I/O, over and over. Where does it stay?', options: ['Q0, for ever', 'it sinks one level per burst', 'the bottom queue', 'it alternates'], answer: 0, why: 'It never reaches 4 ticks between resets.' },
      { q: 'What stops that trick?', options: ['Counting all CPU used at a level, however it is split up', 'A shorter quantum', 'More levels', 'Aging'], answer: 0, why: 'Then 3 + 1 ticks reach the allotment.' },
      { q: 'With no boost, what can happen to a long job at the bottom?', options: ['It can starve while interactive jobs keep the upper queues busy', 'It is promoted', 'It finishes first', 'Nothing'], answer: 0, why: 'Upper queues always win.' },
      { q: 'Does the fixed accounting hurt a truly interactive job that runs 1 tick per keystroke?', options: ['Hardly: it takes many keystrokes to use up an allotment, and the boost lifts it again', 'Yes, it drops at once', 'It starves', 'It is removed'], answer: 0, why: 'It uses little CPU per burst.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
