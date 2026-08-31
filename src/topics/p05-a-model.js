// Part 5: the workload model and the metrics. Bursts: one lane per job showing what it does at every tick
// (running, waiting, in I/O), so a job's alternation of CPU and I/O bursts and the overlap of one job's I/O with
// another's computing can be seen. Metrics: one job at a time, its turnaround, waiting and response time marked on
// its own lane and worked out, then the sums, averages, throughput and utilisation.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt;
  const POL = [{ value: 'fcfs', label: 'FCFS' }, { value: 'sjf', label: 'SJF' }, { value: 'srtn', label: 'SRTN' }, { value: 'rr', label: 'Round robin, quantum 2' }, { value: 'prio', label: 'Priority (preemptive)' }];
  const runPol = (work, pol) => Sch().run(work, pol, pol === 'rr' ? { quantum: 2 } : pol === 'prio' ? { preemptive: true } : {});
  const avgBurst = (j) => { const c = j.bursts.filter((_, k) => k % 2 === 0); return c.reduce((a, b) => a + b, 0) / c.length; };

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-bursts', family: 'p05-model', order: 10, title: 'CPU bursts and I/O bursts',
    blurb: 'A running program alternates between computing (a CPU burst) and waiting for a device (an I/O burst). A scheduler only ever chooses among jobs that are ready to compute; a job in I/O is away. Each lane shows one job, tick by tick: running, waiting in the ready queue, or doing I/O. While one job does I/O, another can use the CPU: that overlap is why an operating system keeps several programs in memory at once.',
    inputs: [P.workInput(P.W.io), { id: 'pol', kind: 'choice', label: 'Policy', def: 'fcfs', options: POL.slice(0, 4) }],
    presets: [
      { label: 'Two jobs with I/O, two without', values: { work: P.W.io } },
      { label: 'An editor, a compiler and a linker', values: { work: P.W.editor } },
      { label: 'A server mix, round robin', values: { work: P.W.burst, pol: 'rr' } },
      { label: 'Only computing: no overlap', values: { work: 'A 0 5\nB 0 4\nC 1 3' } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = runPol(work, inp.pol), jobs = tr.jobs.map((j) => j.id), W = P.W_;
      const ts = P.moments(tr), frames = [];
      const ly = 122, rowH = 30, gap = 10, nJ = jobs.length;
      const tableY = ly + nJ * (rowH + gap) + 44;
      const overlap = (upTo) => { let n = 0; for (let t = 0; t < upTo; t++) { const st = tr.steps[t]; if (st.run && !st.cs && (st.io || []).length) n++; } return n; };
      for (const t of ts) {
        const st = tr.steps[t], end = st.kind === 'end', items = [];
        items.push(P.now('now', 0, 4, t, end));
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: 50, label: 'CPU', final: end }).items);
        const L = P.lanes({ tr, jobs, t, x0: P.X0, x1: W, y: ly, rowH, gap, final: end });
        items.push(...L.items);
        if (!end) items.push(...G().cursor({ prefix: 'lc', X: L.X, t, y1: ly - 4, y2: ly + L.h + 4 }));
        items.push(...P.laneLegend('lg', P.X0, ly + L.h + 24, ['run', 'ready', 'io']));
        // so far: each job's ticks running, waiting and in I/O
        const upTo = end ? tr.end : t, rows = [], tally = {};
        for (const j of tr.jobs) {
          const s = L.states[j.id].slice(0, upTo), c = (k) => s.filter((x) => x === k).length;
          tally[j.id] = { run: c('run'), ready: c('ready'), io: c('io') };
          rows.push({ key: j.id, cells: [{ text: j.id, cls: P.pcls(jobs, j.id) }, P.burstText(j), String(j.cpu), String(j.io), String(tally[j.id].run), String(tally[j.id].ready), String(tally[j.id].io)] });
        }
        items.push(...G().table({ prefix: 'tb', x: 0, y: tableY, cols: [{ w: 56, label: 'job' }, { w: 170, label: 'bursts: CPU (I/O)' }, { w: 76, label: 'CPU' }, { w: 70, label: 'I/O' }, { w: 120, label: 'ran so far' }, { w: 112, label: 'waited' }, { w: 104, label: 'in I/O' }], rows, rowH: 28, size: 14 }).items);
        const ov = overlap(upTo);
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], decision: st.decision, step: st, tally, overlap: ov };
        let say = P.clean(st.say);
        if (end) {
          const ioB = tr.jobs.filter((j) => j.io > 0 && avgBurst(j) <= 3), cpuB = tr.jobs.filter((j) => j.io === 0 || avgBurst(j) > 3);
          const busy = tr.metrics.busy;
          meta.busy = busy; meta.end = tr.end; meta.ioBound = ioB.map((j) => j.id); meta.avg = tr.jobs.map((j) => P.r2(avgBurst(j)));
          say = `Every job has finished at t = ${tr.end}. The CPU computed for ${busy} of those ${tr.end} ticks, and for ${P.s(ov, 'tick')} of them another job was doing I/O at the same time.` + (ioB.length ? ` ${P.list(ioB.map((j) => j.id))} ${ioB.length === 1 ? 'is' : 'are'} I/O-bound (short CPU bursts, averaging ${P.list(ioB.map((j) => P.f(avgBurst(j))))}); ` : ' ') + (cpuB.length ? `${P.list(cpuB.map((j) => j.id))} ${cpuB.length === 1 ? 'is' : 'are'} CPU-bound.` : 'no job is CPU-bound.');
        }
        frames.push({ items, say, meta, title: end ? 'end' : 't = ' + t });
      }
      P.markAsks(frames, 2);
      return { frames, def: P.def(['Bursts', 'A job is a list of bursts: CPU, I/O, CPU, ..., CPU. During a CPU burst it needs the processor; during an I/O burst it waits for a device and needs nothing from the scheduler.'], ['States', ['running: on the CPU', 'ready: waiting in the ready queue for the CPU', 'blocked (I/O): waiting for a device']], ['CPU-bound and I/O-bound', 'A CPU-bound job has a few long CPU bursts; an I/O-bound job has many short ones between I/O. A good scheduler lets the I/O-bound jobs run quickly so that their devices stay busy while the CPU-bound jobs compute.']) };
    },
    predict: [P.askNextOpt()],
    quiz: [
      { q: 'A job\'s bursts are 3 (4) 2. How long does it need the CPU in all?', options: ['5 ticks', '9 ticks', '4 ticks', '3 ticks'], answer: 0, why: 'The CPU bursts are 3 and 2; the 4 is I/O.' },
      { q: 'While a job waits for its disk read, it is…', options: ['blocked, not in the ready queue', 'in the ready queue', 'running', 'finished'], answer: 0, why: 'It cannot use the CPU until the I/O completes.' },
      { q: 'Why keep an I/O-bound job and a CPU-bound job in memory together?', options: ['One computes while the other waits for its device, so both the CPU and the device stay busy', 'They share one burst', 'The I/O-bound job runs faster alone', 'It saves memory'], answer: 0, why: 'Overlapping computation with I/O raises utilisation.' },
      { q: 'Which job is I/O-bound?', options: ['1 (6) 1 (6) 1', '20', '9 (1) 9', '15 (2) 15'], answer: 0, why: 'Short CPU bursts with long I/O between them.' },
      { q: 'A job finishes its last CPU burst. What happens next?', options: ['It finishes and leaves', 'It goes to I/O', 'It joins the back of the ready queue', 'It waits for a quantum'], answer: 0, why: 'A workload ends with a CPU burst.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-metrics', family: 'p05-model', order: 20, title: 'Turnaround, waiting and response',
    blurb: 'A schedule is judged by numbers. Turnaround is the time from arrival to finish; waiting is the part of it spent in the ready queue; response is the time until a job first gets the CPU. Throughput counts jobs finished per tick and utilisation the share of time the CPU did useful work. Here each job\'s three times are marked on its own lane and worked out.',
    inputs: [P.workInput(P.W.mixed), { id: 'pol', kind: 'choice', label: 'Policy', def: 'fcfs', options: POL }],
    presets: [
      { label: 'Five jobs, FCFS', values: { work: P.W.mixed, pol: 'fcfs' } },
      { label: 'Five jobs, round robin', values: { work: P.W.mixed, pol: 'rr' } },
      { label: 'With I/O, SRTN', values: { work: P.W.io, pol: 'srtn' } },
      { label: 'An idle gap', values: { work: 'A 0 3\nB 6 4\nC 7 2' } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = runPol(work, inp.pol), jobs = tr.jobs.map((j) => j.id), W = P.W_, m = tr.metrics;
      const rowH = 22, gap = 6, ly = 116, lh = jobs.length * (rowH + gap) - gap, fy = ly + lh + 52, tableY = fy + 36 + 58;
      const frames = [];
      const name = POL.find((p) => p.value === inp.pol).label;
      const base = (focus, rowsDone, sums) => {
        const items = [P.text('ttl', 0, 4, name + ': the whole schedule', 'glabel', 14)];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t: tr.end, x0: P.X0, x1: W, y: 50, label: 'CPU', final: true }).items);
        items.push(...P.lanes({ tr, jobs, t: tr.end, x0: P.X0, x1: W, y: ly, rowH, gap, final: true, focus, labels: false }).items);
        const shown = Object.assign({}, tr, { metrics: Object.assign({}, m, { rows: m.rows.filter((r) => rowsDone.includes(r.id)) }), jobs: tr.jobs.filter((j) => rowsDone.includes(j.id)) });
        if (rowsDone.length) items.push(...P.table({ tr: shown, t: Infinity, x: 0, y: tableY, final: sums, cols: 'short', fresh: focus ? [focus] : [], sums }).items);
        return items;
      };
      frames.push({ items: base(null, [], false).concat(P.laneLegend('lg', P.X0, fy + 22, ['run', 'ready', 'io'])), say: `The schedule ${name} makes of these ${P.s(jobs.length, 'job')}, finished at t = ${tr.end}. Each lane is one job: coloured where it ran, pink where it waited in the ready queue, dashed where it did I/O. Now measure it, job by job.`, meta: { phase: 'schedule', end: tr.end, n: jobs.length }, title: 'schedule' });
      const done = [];
      tr.metrics.rows.forEach((r, k) => {
        const j = tr.jobs[k];
        done.push(r.id);
        const L = P.lanes({ prefix: 'fz', tr, jobs, t: tr.end, x0: P.X0, x1: W, y: fy, rowH: 36, gap: 0, final: true, names: false, only: r.id });
        const lane = L.items.filter((it) => it.key.startsWith('fz:' + r.id + ':') || it.key.startsWith('fz:tk' + r.id));
        const items = base(r.id, done, false).concat(lane);
        items.push(P.text('fzn', P.X0 - 10, fy + 23, r.id, 'glname', 16, 'end'));
        const first = r.arrive + r.response;
        items.push({ key: 'bT', kind: 'bracket', x1: L.X(r.arrive), x2: L.X(r.finish), y: fy - 4, side: 'above', text: 'turnaround ' + r.turnaround, cls: 'p05br' });
        if (r.response > 0) items.push({ key: 'bR', kind: 'bracket', x1: L.X(r.arrive), x2: L.X(first), y: fy + 40, side: 'below', text: 'response ' + r.response, cls: 'p05br' });
        else items.push({ key: 'bR0', kind: 'text', x: L.X(r.arrive), y: fy + 60, text: 'response 0: it ran at once', size: 13, cls: 'glabel' });
        const say = `${r.id} arrives at ${r.arrive}, first runs at ${first} and finishes at ${r.finish}. Turnaround = ${r.finish} − ${r.arrive} = ${r.turnaround}. It needed ${j.cpu} of CPU and ${j.io} of I/O, so it waited ${r.turnaround} − ${j.cpu} − ${j.io} = ${r.waiting} (the pink ticks). Response = ${first} − ${r.arrive} = ${r.response}.`;
        frames.push({ items, say, meta: { phase: 'job', id: r.id, row: r, cpu: j.cpu, io: j.io, first }, title: r.id });
      });
      const items = base(null, done, true);
      frames.push({ items, say: `Summing the columns: turnaround ${m.sumText.turnaround}, an average of ${P.f(m.avg.turnaround)}; waiting ${m.sumText.waiting}, an average of ${P.f(m.avg.waiting)}; response ${m.sumText.response}, an average of ${P.f(m.avg.response)}.`, meta: { phase: 'sums', metrics: m }, title: 'averages' });
      const it2 = base(null, done, true);
      it2.push(P.text('thr', 0, fy + 10, `throughput = ${jobs.length} jobs / ${m.end} ticks = ${P.f(m.throughput)} jobs per tick`, 'gwhy', 15));
      it2.push(P.text('utl', 0, fy + 38, `utilisation = ${m.busy} busy ticks / ${m.end} = ${P.f(m.util * 100)}%`, m.util < 1 ? 'hot' : 'good', 15));
      frames.push({ items: it2, say: `For the whole run: ${P.s(jobs.length, 'job')} finished in ${m.end} ticks, a throughput of ${P.f(m.throughput)} jobs per tick; the CPU did useful work for ${m.busy} of the ${m.end} ticks, a utilisation of ${P.f(m.util * 100)}%` + (m.util < 1 ? `, idle for ${m.end - m.busy - m.overhead}` + (m.overhead ? ` and switching for ${m.overhead}` : '') + '.' : '.'), meta: { phase: 'whole', metrics: m, pct: m.util * 100, idle: m.end - m.busy - m.overhead }, title: 'throughput' });
      return { frames, def: P.def(['For each job', ['turnaround = finish − arrival', 'waiting = turnaround − CPU − I/O', 'response = first run − arrival']], ['For the run', ['throughput = jobs finished / time', 'utilisation = busy ticks / time']], ['What each measures', 'Turnaround matters to batch jobs, response to interactive ones, and waiting is the part of turnaround a scheduler controls. A policy good for one is often poor for another.']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'schedule' || (f.meta.phase === 'job' && fr[i + 1] && fr[i + 1].meta.phase === 'job' && i === 2), pick: 'option', ask: (fr, i) => `What is ${fr[i + 1].meta.id}'s waiting time?`, options: (fr, i) => { const w = fr[i + 1].meta.row.waiting; return [...new Set([w, w + 1, Math.max(0, w - 1), w + 2, fr[i + 1].meta.row.turnaround])].map(String).sort((a, b) => a - b); }, answer: (fr, i) => String(fr[i + 1].meta.row.waiting), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A job arrives at 2, first runs at 5, finishes at 14, and needs 6 ticks of CPU and no I/O. Its turnaround is…', options: ['12', '9', '14', '6'], answer: 0, why: '14 − 2.' },
      { q: 'The same job\'s waiting time is…', options: ['6', '3', '12', '9'], answer: 0, why: '12 − 6 − 0.' },
      { q: 'And its response time?', options: ['3', '5', '0', '9'], answer: 0, why: '5 − 2.' },
      { q: 'Four jobs finish in 20 ticks. The throughput is…', options: ['0.2 jobs per tick', '5 jobs per tick', '20 ticks per job', '0.8'], answer: 0, why: '4 / 20.' },
      { q: 'Which metric matters most to someone typing in an editor?', options: ['response time', 'throughput', 'turnaround of the longest job', 'CPU utilisation'], answer: 0, why: 'They want the keystroke handled soon after it arrives.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
