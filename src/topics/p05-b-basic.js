// Part 5: FCFS and the convoy effect, shortest job first, and shortest remaining time next. Each is the standard
// single-CPU scene (chart, CPU, ready queue, table) with its own extra: FCFS brackets the convoy and replays the same
// jobs short-first; SJF draws the ready jobs as bars of their next burst, shortest lit; SRTN draws every job's
// remaining time as a shrinking bar, so a preemption is a shorter bar arriving.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched;

  /** the convoy on FCFS: the burst that kept the most ticks of shorter jobs waiting behind it */
  P.convoy = function (tr) {
    let best = null;
    for (const s of tr.segs) {
      if (s.cs) continue;
      const waiters = new Map();
      for (let t = s.start; t < s.end; t++) for (const id of tr.steps[t].ready || []) waiters.set(id, (waiters.get(id) || 0) + 1);
      const short = [...waiters.keys()].filter((id) => tr.jobs.find((j) => j.id === id).cpu < s.end - s.start);
      const cost = short.reduce((a, id) => a + waiters.get(id), 0);
      if (s.end - s.start >= 4 && short.length >= 2 && (!best || cost > best.cost)) best = { seg: s, ids: short.sort(), cost, len: s.end - s.start };
    }
    return best;
  };

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-fcfs', family: 'p05-basic', order: 10, title: 'FCFS and the convoy effect',
    blurb: 'First come, first served runs jobs in the order they became ready, each until its CPU burst ends. It is simple and never starves anyone, but one long burst at the front makes every short job behind it wait: the convoy effect. The same jobs in another order can wait far less.',
    inputs: [P.workInput(P.W.convoy), { id: 'cs', kind: 'number', label: 'Context switch (ticks)', def: 0, min: 0, max: 3 }],
    presets: [
      { label: 'A convoy: one long job first', values: { work: P.W.convoy } },
      { label: 'The same jobs, the long one last', values: { work: 'A 3 11\nB 0 2\nC 1 3\nD 2 1' } },
      { label: 'Five jobs over time', values: { work: P.W.mixed } },
      { label: 'Jobs that do I/O', values: { work: P.W.io } },
      { label: 'A convoy, with switches costing 1 tick', values: { work: P.W.convoy, cs: 1 } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().run(work, 'fcfs', { cs: inp.cs });
      const cv = P.convoy(tr);
      const frames = P.scene({
        tr, title: 'first come, first served',
        subs: () => null,
        extra: (st, t, L) => {
          if (!L.end || !cv) return [];
          const g = P.gantt({ tr, jobs: tr.jobs.map((j) => j.id), t, x0: P.X0, x1: L.W, y: L.gy, final: true });
          const s = cv.seg, by = L.gy + 36 + 4;
          return [{ key: 'convoy', kind: 'bracket', x1: g.X(s.start) + 2, x2: g.X(s.end) - 2, y: by, side: 'below', cls: 'hot' }];
        },
        endLine: (tr) => cv ? `convoy: ${P.list(cv.ids)} wait behind ${cv.seg.job}'s ${cv.len}-tick burst` : `every job has finished: average waiting ${P.f(tr.metrics.avg.waiting)}`,
        mark: () => (cv ? { waiting: cv.ids.slice().sort((a, b) => tr.metrics.rows.find((r) => r.id === b).waiting - tr.metrics.rows.find((r) => r.id === a).waiting)[0] } : null),
        sayEnd: (tr) => P.sayEnd(tr) + (cv ? ` The convoy: ${P.list(cv.ids)} sat in the queue behind ${cv.seg.job}'s ${cv.len}-tick burst for ${cv.cost} job-ticks in all.` : ' No long burst held a crowd of short jobs back here.'),
        metaOf: () => ({ convoy: cv ? { len: cv.len, cost: cv.cost, ids: cv.ids } : null }),
      });
      // the same jobs, shortest first, for comparison: a last frame
      const end = frames[frames.length - 1];
      const sjf = Sch().run(work, 'sjf', { cs: inp.cs });
      const items = end.items.filter((it) => !it.key.startsWith('mt'));
      items.push(...P.gantt({ prefix: 'h', tr: sjf, jobs: tr.jobs.map((j) => j.id), t: sjf.end, x0: P.X0, x1: P.W_, y: 206, final: true, label: 'SJF', T: Math.max(tr.end, sjf.end), axis: false }).items);
      items.forEach((it) => { if (it.key === 'g:lab') it.text = 'FCFS'; });
      items.push(P.text('cmp1', 0, 280, `FCFS: average waiting ${P.f(tr.metrics.avg.waiting)}, turnaround ${P.f(tr.metrics.avg.turnaround)}`, 'gwhy', 15));
      items.push(P.text('cmp2', 0, 306, `shortest first (SJF): average waiting ${P.f(sjf.metrics.avg.waiting)}, turnaround ${P.f(sjf.metrics.avg.turnaround)}`, sjf.metrics.avg.waiting < tr.metrics.avg.waiting ? 'good' : 'gwhy', 15));
      frames.push({ items, title: 'compare', say: `For comparison, the same jobs run shortest burst first: average waiting ${P.f(sjf.metrics.avg.waiting)} against FCFS's ${P.f(tr.metrics.avg.waiting)}` + (sjf.metrics.avg.waiting < tr.metrics.avg.waiting ? '. Order alone made the difference.' : ': here the arrival order was already a good one.'), meta: { phase: 'compare', fcfs: tr.metrics.avg.waiting, sjf: sjf.metrics.avg.waiting, sjfT: sjf.metrics.avg.turnaround, fcfsT: tr.metrics.avg.turnaround } });
      P.markAsks(frames, 2);
      return { frames, def: P.def(['The rule', 'The CPU goes to the job at the head of the ready queue, which runs until its CPU burst ends (it finishes or starts I/O). A job that becomes ready joins the back. ' + Sch().TIES], ['The convoy effect', 'A long CPU burst at the head holds every job behind it. Each short job\'s waiting time includes the whole long burst, so the average waiting time is high even though the CPU never idles.'], ['Metrics', ['turnaround = finish − arrival', 'waiting = turnaround − CPU − I/O', 'response = first run − arrival'] ]) };
    },
    predict: [
      P.askNext(),
      { at: (f) => f.meta && f.meta.phase === 'end', pick: 'option', ask: 'Would running these jobs shortest-first lower the average waiting time?', options: ['yes, it would be lower', 'no, it would be the same or higher'], answer: (fr, i) => (fr[i + 1].meta.sjf < fr[i + 1].meta.fcfs ? 'yes, it would be lower' : 'no, it would be the same or higher'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Jobs of 10, 1 and 1 ticks arrive together in that order under FCFS. What is the average waiting time?', options: ['7', '4', '1', '10'], answer: 0, why: 'They wait 0, 10 and 11 ticks: 21 / 3 = 7.' },
      { q: 'The same three jobs in the order 1, 1, 10. The average waiting time is…', options: ['1', '7', '4', '0'], answer: 0, why: 'They wait 0, 1 and 2: 3 / 3 = 1.' },
      { q: 'Can a job starve under FCFS?', options: ['No: every job ahead of it eventually finishes its burst', 'Yes, if shorter jobs keep arriving', 'Yes, if its priority is low', 'Only on several cores'], answer: 0, why: 'FCFS serves in order; new arrivals join behind it.' },
      { q: 'Why is the convoy effect bad for interactive jobs?', options: ['Their short bursts wait behind a long one, so they respond late', 'They use too much CPU', 'They are preempted too often', 'They never get to do I/O'], answer: 0, why: 'Each short burst waits for the whole long burst ahead of it.' },
      { q: 'Is FCFS preemptive?', options: ['No', 'Yes, at every tick', 'Only when an I/O completes', 'Only with a quantum'], answer: 0, why: 'A job keeps the CPU until its burst ends.' },
    ],
  });

  /** a last frame: the finished chart over a second policy's chart on the same jobs, with both averages */
  P.compareFrame = function (frames, tr, other, nameA, nameB, sayTail) {
    const last = frames[frames.length - 1], jobs = tr.jobs.map((j) => j.id), T = Math.max(tr.end, other.end);
    const items = last.items.filter((it) => !/^(mt|br|fin)/.test(it.key) && !it.key.startsWith('g'));
    items.push(...P.gantt({ prefix: 'g', tr, jobs, t: tr.end, x0: P.X0 + 24, x1: P.W_, y: 50, final: true, label: nameA, T }).items);
    items.push(...P.gantt({ prefix: 'h', tr: other, jobs, t: other.end, x0: P.X0 + 24, x1: P.W_, y: 112, final: true, label: nameB, T, axis: false }).items);
    const a = tr.metrics.avg, b = other.metrics.avg, better = b.waiting < a.waiting;
    const tb = S.Kit.gantt.table({ prefix: 'cmp', x: 0, y: 190, cols: [{ w: 110, label: '' }, { w: 190, label: 'average turnaround' }, { w: 160, label: 'average waiting' }, { w: 170, label: 'average response' }], rows: [
      { key: 'a', cells: [nameA, P.f(a.turnaround), { text: P.f(a.waiting), cls: !better && a.waiting < b.waiting ? 'best' : '' }, P.f(a.response)] },
      { key: 'b', cells: [nameB, P.f(b.turnaround), { text: P.f(b.waiting), cls: better ? 'best' : '' }, P.f(b.response)] }], rowH: 30, size: 14 });
    items.push(...tb.items);
    frames.push({ items, title: 'compare', say: `The same jobs under ${nameB}: average waiting ${P.f(b.waiting)} against ${P.f(a.waiting)} under ${nameA}, turnaround ${P.f(b.turnaround)} against ${P.f(a.turnaround)}, response ${P.f(b.response)} against ${P.f(a.response)}.` + (sayTail ? ' ' + sayTail : ''), meta: { phase: 'compare', a, b, better } });
  };

  // ---------------------------------------------------------------------------------------------------------------
  const sjfDef = () => P.def(['The rule', 'When the CPU is free, the ready job with the shortest next CPU burst runs, until that burst ends. Here the scheduler is told every burst exactly: an ideal that real systems can only estimate (see [[sch-predict]]). ' + Sch().TIES], ['Why it is optimal', 'Among schedules that never preempt and only choose among jobs already waiting, running the shortest burst first gives the least average waiting time: moving a short burst ahead of a long one saves the long one\'s length for the short job and costs the long job only the short one\'s length.'], ['The catch', 'A long job can wait a long time while shorter jobs keep arriving, and burst lengths are not known in advance.']);
  S.topic({
    id: 'sch-sjf', family: 'p05-basic', order: 20, title: 'Shortest job first',
    blurb: 'Shortest job first gives the free CPU to the ready job with the shortest next CPU burst, and lets it run that burst to the end. Under the bars, each waiting job is drawn as its next burst on the chart\'s own time scale: the shortest goes next. When all the jobs are ready together, no non-preemptive order gives a smaller average waiting time.',
    inputs: [P.workInput(P.W.mixed), { id: 'cs', kind: 'number', label: 'Context switch (ticks)', def: 0, min: 0, max: 3 }],
    presets: [
      { label: 'Five jobs over time', values: { work: P.W.mixed } },
      { label: 'Four jobs at once', values: { work: 'A 0 5\nB 0 9\nC 0 2\nD 0 4' } },
      { label: 'A long job keeps losing', values: { work: 'L 0 1\nX 0 9\nA 1 2\nB 3 2\nC 5 2\nD 7 2' } },
      { label: 'Jobs with I/O', values: { work: P.W.io } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().run(work, 'sjf', { cs: inp.cs }), per = (P.W_ - P.X0) / tr.end;
      const frames = P.scene({
        tr, tableY: 206 + tr.jobs.length * 28 + 22,
        subs: (st, t) => { const o = {}; for (const id of st.ready || []) o[id] = 'next ' + P.leftAt(tr, id, t)[0]; return o; },
        runSub: (st, t) => (st.run ? 'left ' + P.leftAt(tr, st.run, t)[0] : null),
        extra: (st, t, L) => {
          if (L.end) return [];
          const rows = (st.ready || []).map((id) => ({ id, len: P.leftAt(tr, id, t)[0] })).sort((a, b) => a.len - b.len);
          if (!rows.length) return [];
          rows[0].cls = 'p05next';
          return P.bars({ rows, jobs: tr.jobs.map((j) => j.id), per, x0: P.X0, y: 206, h: 22, gap: 6, label: 'waiting jobs, as their next CPU burst on the same scale:' });
        },
        metaOf: (st, t) => ({ next: Object.fromEntries((st.ready || []).map((id) => [id, P.leftAt(tr, id, t)[0]])) }),
      });
      P.compareFrame(frames, tr, Sch().run(work, 'fcfs', { cs: inp.cs }), 'SJF', 'FCFS');
      P.markAsks(frames, 3);
      return { frames, def: sjfDef() };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'Bursts of 5, 9, 2 and 4 are all ready at 0. In what order does SJF run them?', options: ['2, 4, 5, 9', '5, 9, 2, 4', '9, 5, 4, 2', '2, 9, 5, 4'], answer: 0, why: 'Shortest first.' },
      { q: 'The same four. What is the average waiting time?', options: ['4.75', '6.5', '5', '8.25'], answer: 0, why: 'They wait 0, 2, 6 and 11: 19 / 4 = 4.75.' },
      { q: 'What can happen to a long job under SJF?', options: ['It can starve while shorter jobs keep arriving', 'It is preempted every tick', 'It runs first', 'Nothing: SJF is fair'], answer: 0, why: 'Every new short job goes ahead of it.' },
      { q: 'Why can a real scheduler not run SJF exactly?', options: ['It does not know the length of the next CPU burst', 'It needs two CPUs', 'Sorting takes too long', 'Bursts change while they run'], answer: 0, why: 'It has to predict it, for example by exponential averaging.' },
      { q: 'Is SJF as drawn here preemptive?', options: ['No: a running burst finishes even if a shorter job arrives', 'Yes', 'Only for I/O', 'Only at the quantum'], answer: 0, why: 'Its preemptive form is SRTN.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-srtn', family: 'p05-basic', order: 30, title: 'Shortest remaining time next',
    blurb: 'The preemptive form of shortest job first: whenever a job becomes ready, it is compared with the running job, and if it needs strictly less than the running job has left, it takes the CPU. Every job is drawn as a bar of what remains of its burst; the running bar shrinks tick by tick, and a shorter newcomer cuts in.',
    inputs: [P.workInput('A 0 7\nB 1 5\nC 2 8\nD 3 3'), { id: 'cs', kind: 'number', label: 'Context switch (ticks)', def: 0, min: 0, max: 3 }],
    presets: [
      { label: 'Four jobs, one a tick', values: { work: 'A 0 7\nB 1 5\nC 2 8\nD 3 3' } },
      { label: 'Five jobs over time', values: { work: P.W.mixed } },
      { label: 'A tie does not preempt', values: { work: 'A 0 5\nB 2 3\nC 4 1' } },
      { label: 'Preemption with switches costing 1', values: { work: 'A 0 7\nB 1 5\nC 2 8\nD 3 3', cs: 1 } },
      { label: 'Jobs with I/O', values: { work: P.W.io } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().run(work, 'srtn', { cs: inp.cs }), per = (P.W_ - P.X0) / tr.end;
      const frames = P.scene({
        tr, tableY: 206 + tr.jobs.length * 28 + 22,
        subs: (st, t) => { const o = {}; for (const id of st.ready || []) o[id] = 'left ' + P.leftAt(tr, id, t)[0]; return o; },
        runSub: (st, t) => (st.run ? 'left ' + P.leftAt(tr, st.run, t)[0] : null),
        extra: (st, t, L) => {
          if (L.end) return [];
          const ids = (st.run ? [st.run] : []).concat(st.ready || []);
          const rows = ids.map((id) => ({ id, len: P.leftAt(tr, id, t)[0], cls: id === st.run ? 'now' : '' })).sort((a, b) => a.len - b.len || (b.cls ? 1 : 0) - (a.cls ? 1 : 0));
          return rows.length ? P.bars({ rows, jobs: tr.jobs.map((j) => j.id), per, x0: P.X0, y: 206, h: 22, gap: 6, label: 'what each job has left of its burst (the running one ringed):' }) : [];
        },
        metaOf: (st, t) => ({ left: Object.fromEntries(((st.run ? [st.run] : []).concat(st.ready || [])).map((id) => [id, P.leftAt(tr, id, t)[0]])) }),
      });
      P.compareFrame(frames, tr, Sch().run(work, 'sjf', { cs: inp.cs }), 'SRTN', 'SJF', 'Preemption lets a short job in at once, at the price of more switches.');
      P.markAsks(frames, 3);
      return { frames, def: P.def(['The rule', 'At every moment a job becomes ready, if its burst is strictly shorter than what the running job has left, the running job is preempted and goes back to the ready queue. Otherwise the running job keeps the CPU. When the CPU is free, the job with the least remaining time runs.'], ['Ties', 'An equal remaining time does not preempt: switching would gain nothing. ' + Sch().TIES], ['Its strength and its cost', 'SRTN gives the least average waiting time of all policies when burst lengths are known, but long jobs can starve and every preemption is a context switch.']) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'A has 6 left when B arrives needing 4. Under SRTN…', options: ['B preempts A', 'A keeps the CPU', 'They share the CPU', 'B waits for A\'s quantum'], answer: 0, why: '4 < 6.' },
      { q: 'A has 4 left when B arrives needing 4. Under SRTN…', options: ['A keeps the CPU: a tie does not preempt', 'B preempts A', 'A is aborted', 'Both run'], answer: 0, why: 'Only a strictly shorter job preempts.' },
      { q: 'A (arrives 0, needs 7), B (arrives 1, needs 3): when does A finish under SRTN?', options: ['10', '7', '4', '11'], answer: 0, why: 'A runs 1 tick, B runs 1 to 4, A runs its remaining 6 from 4 to 10.' },
      { q: 'What does SRTN add over SJF?', options: ['Preemption when a shorter job arrives', 'A quantum', 'Priorities', 'Aging'], answer: 0, why: 'It checks at every arrival, not only when the CPU is free.' },
      { q: 'With a high context-switch cost, SRTN\'s advantage over SJF…', options: ['shrinks, since every preemption costs a switch', 'grows', 'is unchanged', 'disappears completely in every case'], answer: 0, why: 'Each preemption adds overhead.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
