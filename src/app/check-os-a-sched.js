// The gantt exercise kind: fill in the Gantt chart of a workload under a policy, and the metrics of each job.
//   {kind: 'gantt', workload: [{id, arrive, bursts: [cpu, io, cpu..], prio, tickets, nice, cls}], policy: 'fcfs' | 'sjf' |
//    'srtn' | 'prio' | 'rr' | 'mlfq' | 'mlq' | 'lottery' | 'stride' | 'cfs' | 'multi', params: {quantum, preemptive,
//    ...}, ask: 'both' (default) | 'chart' | 'metrics', metrics: ['finish', 'waiting'] (the columns asked; also
//    'turnaround', 'response'), jobs: the ids in colour order (default the workload's)}
//   Several cores: policy 'multi', params {cores, queue: 'shared' | 'per-core', quantum, push, pull, migrate, cs}
//    (S.Sched.multi): the chart has one row a core.
//   Real-time: tasks: [{id, C, T, D, phase}] instead of a workload, policy 'rm' | 'edf', params {horizon, onMiss}
//    (S.Sched.rt): one row, the task running each tick; the answer area marks every release and deadline. Metrics
//    are per job (A1, A2, ..): 'finish', 'response' (a job unfinished by the horizon is '-'), 'missed' (yes or no).
//   Answer: {ticks: ['A', 'A', 'B', '-', ..] (one entry a tick: a job's id, '-' idle, 'cs' a context switch) or a
//     string 'AAB-' when every id is one letter, or segs: [{job, start, end}]; with several cores lanes: [ticks of
//     core 0, ticks of core 1, ..] instead; metrics: {'A|finish': '9', ..}}
// The schedule comes from the engine (S.Sched); the chart is compared tick by tick (core by core) and the metrics
// cell by cell. S.Check.kinds.gantt.paramsText(x) says the policy and its parameters in words.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const O = () => K.os;
  const isRT = (x) => Array.isArray(x.tasks);
  const isMulti = (x) => x.policy === 'multi';

  /** the engine's trace for the exercise */
  const trace = (x) => {
    const Sch = S.Sched, p = x.policy || 'fcfs', params = x.params || {};
    if (isRT(x)) return Sch.rt(x.tasks, Object.assign({ policy: p === 'edf' ? 'edf' : 'rm' }, params));
    if (['mlfq', 'mlq', 'lottery', 'stride', 'cfs', 'multi'].includes(p)) return Sch[p](x.workload, params);
    return Sch.run(x.workload, p, params);
  };
  /** the chart as one entry a tick */
  const ticksOf = (segs, end) => {
    const t = Array.from({ length: end }, () => '-');
    for (const s of segs) for (let k = s.start; k < s.end && k < end; k++) t[k] = s.cs ? 'cs' : String(s.job);
    return t;
  };
  /** the rows of the chart: one for one CPU, one a core */
  const lanesOf = (x, tr) => {
    if (!isMulti(x)) return [{ label: isRT(x) ? 'CPU' : 'CPU', ticks: ticksOf(tr.segs, tr.end) }];
    const n = (x.params && x.params.cores) || 2;
    return Array.from({ length: n }, (_, c) => ({ label: 'core ' + c, ticks: ticksOf(tr.segs.filter((s) => (s.core || 0) === c), tr.end) }));
  };
  /** the metric rows: per job of the workload, or per released job of a real-time task set */
  const rowsOf = (x, tr) => (isRT(x) ? tr.jobs.map((j) => ({ id: j.job, finish: j.finish === null || j.finish === undefined ? '-' : j.finish, response: j.response === null || j.response === undefined ? '-' : j.response, missed: j.missed ? 'yes' : 'no' })) : tr.metrics.rows);
  /** what an exercise expects: {tr, lanes, ticks (the first lane), rows, cols, jobs} */
  const want = (x) => {
    const tr = trace(x), lanes = lanesOf(x, tr);
    return { tr, lanes, ticks: lanes[0].ticks, rows: rowsOf(x, tr), cols: x.metrics || (isRT(x) ? ['response'] : ['finish', 'waiting']), jobs: x.jobs || (isRT(x) ? x.tasks : x.workload).map((j) => String(j.id)) };
  };
  /** one lane of an answer as one entry a tick */
  const readLane = (v) => {
    if (Array.isArray(v)) return v.map((c) => String(c === undefined || c === null || c === '' ? '-' : c).trim());
    if (typeof v === 'string') return [...v.replace(/\s+/g, '')].map((c) => (c === '.' || c === '_' ? '-' : c));
    return [];
  };
  const readTicks = (a) => {
    if (!a) return [];
    if (a.ticks !== undefined) return readLane(a.ticks);
    if (Array.isArray(a.segs)) { const end = a.segs.reduce((m, s) => Math.max(m, +s.end || 0), 0); return ticksOf(a.segs.map((s) => ({ job: s.job, start: +s.start, end: +s.end, cs: s.job === 'cs' })), end); }
    return [];
  };
  const readLanes = (a, n) => (a && Array.isArray(a.lanes) ? a.lanes.map(readLane) : n === 1 ? [readTicks(a)] : []);
  const asks = (x, what) => (x.ask || 'both') === 'both' || x.ask === what;
  const same = (want, got) => {
    if (typeof want === 'number') { const v = Number(String(got).trim()); return Number.isFinite(v) && Math.abs(v - want) < 1e-9; }
    const g = String(got).trim().toLowerCase(), w = String(want).toLowerCase();
    if (w === '-') return ['-', '–', '—', 'none', 'no'].includes(g) && g !== 'no' || g === '-';
    return g === w || (w === 'yes' && ['y', 'true', 'missed'].includes(g)) || (w === 'no' && ['n', 'false', 'met'].includes(g));
  };

  /** the policy and its parameters in words, for the answer area */
  const NAMES = { fcfs: 'FCFS', sjf: 'SJF', srtn: 'SRTN', prio: 'Priority', rr: 'Round robin', mlfq: 'MLFQ', mlq: 'Multilevel queue', lottery: 'Lottery', stride: 'Stride', cfs: 'CFS', multi: 'Round robin on each core', rm: 'Rate monotonic', edf: 'Earliest deadline first' };
  const ticksW = (n) => n + ' tick' + (n === 1 ? '' : 's');
  function paramsText(x) {
    const p = x.params || {}, out = [];
    const pol = x.policy || 'fcfs';
    if (pol === 'mlfq') {
      const P = S.Sched.mlfqParams(p);
      out.push(P.levels + ' levels', 'quanta ' + P.quantum.join(', ') + ' ticks, top level first');
      const al = P.allot.filter((v) => isFinite(v));
      if (al.length) out.push('a job drops a level after ' + al.join(', ') + ' ticks there');
      out.push(P.boost ? 'every job back to the top every ' + ticksW(P.boost) : 'no boost');
    } else if (pol === 'mlq') {
      (p.classes || []).forEach((c, i) => out.push('class ' + i + (c.name ? ' (' + c.name + ')' : '') + ': ' + (c.policy === 'rr' ? 'round robin, quantum ' + (c.quantum || 2) : 'FCFS')));
      out.push(p.mode === 'share' ? 'the CPU shared ' + (p.shares || []).join(' : ') + ' in windows of ' + ticksW(p.window || 10) : 'strict priority: class 0 first');
    } else if (pol === 'multi') {
      out.push((p.cores || 2) + ' cores', (p.queue === 'per-core' ? 'a queue per core' : 'one shared queue'), 'quantum ' + ticksW(p.quantum || 2));
      if (p.queue === 'per-core') { if (p.push) out.push('rebalanced every ' + ticksW(p.push)); out.push(p.pull === false ? 'no work stealing' : 'an idle core steals work'); }
      if (p.migrate) out.push('a move to another core costs ' + ticksW(p.migrate));
    } else if (isRT(x)) {
      out.push('preemptive, one CPU', 'up to t = ' + (p.horizon || 'the hyperperiod'));
    } else {
      if (p.quantum) out.push('quantum ' + ticksW(p.quantum));
      if (p.preemptive !== undefined) out.push(p.preemptive ? 'preemptive' : 'non-preemptive');
      if (p.age) out.push('a waiting job gains a priority step every ' + ticksW(p.age));
      for (const [k, v] of Object.entries(p)) if (!['quantum', 'preemptive', 'age', 'cs'].includes(k)) out.push(k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : v));
    }
    if (p.cs) out.push('a context switch costs ' + ticksW(p.cs));
    return (NAMES[pol] || pol) + (out.length ? ': ' + out.join('; ') : '');
  }
  /** releases and deadlines of a real-time task set, up to the end: [{t, task, what: 'release' | 'deadline'}] */
  function rtMarks(x, end) {
    const out = [];
    for (const tk of x.tasks || []) for (let r = tk.phase || 0; r < end; r += tk.T) { out.push({ t: r, task: String(tk.id), what: 'release' }); const d = r + (tk.D || tk.T); if (d <= end) out.push({ t: d, task: String(tk.id), what: 'deadline' }); }
    return out;
  }

  O().kind('gantt', {
    want, ticksOf, paramsText, rtMarks, isRT, isMulti,
    check(x, a) {
      a = a || {};
      const W = want(x), out = [], cells = {};
      let chartOk = true, metricsOk = true;
      if (asks(x, 'chart')) {
        const lanes = readLanes(a, W.lanes.length);
        if (!lanes.some((l) => l.some((v) => v !== '-'))) { chartOk = false; out.push('the chart is still empty'); }
        else {
          W.lanes.forEach((L, c) => {
            const got = (lanes[c] || []).slice();
            // trailing idle ticks typed past the end are no mistake
            while (got.length > L.ticks.length && got[got.length - 1] === '-') got.pop();
            let first = -1, wrong = 0;
            for (let k = 0; k < Math.max(got.length, L.ticks.length); k++) {
              const ok = (got[k] || '-').toLowerCase() === (L.ticks[k] || '-').toLowerCase();
              cells[(W.lanes.length > 1 ? c + '|' : '') + 't|' + k] = ok;
              if (!ok) { wrong++; if (first < 0) first = k; }
            }
            if (wrong) {
              chartOk = false;
              const who = W.lanes.length > 1 ? L.label + "'s row" : 'the chart';
              out.push(first === 0 ? who + ' goes wrong at the very first tick (t = 0 to 1)' : who + ' is right up to t = ' + first + ' and goes wrong at the tick from ' + first + ' to ' + (first + 1) + ' (' + O().plural(wrong, 'tick') + ' differ in all)');
            }
          });
        }
      }
      if (asks(x, 'metrics')) {
        const m = a.metrics || {};
        let wrong = 0, empty = 0;
        for (const r of W.rows) for (const c of W.cols) {
          const key = r.id + '|' + c, got = m[key];
          if (got === undefined || got === null || !String(got).trim()) { empty++; cells[key] = false; continue; }
          cells[key] = same(r[c], got);
          if (!cells[key]) wrong++;
        }
        if (wrong || empty) { metricsOk = false; out.push((wrong ? O().plural(wrong, 'metric cell is', 'metric cells are') + ' not right' : '') + (wrong && empty ? ' and ' : '') + (empty ? O().plural(empty, 'metric cell is', 'metric cells are') + ' empty' : '')); }
      }
      if (chartOk && metricsOk) return { ok: true, cells, message: 'Right.' + (x.why ? ' ' + x.why : ' The schedule ends at t = ' + W.tr.end + '.') };
      const tip = isRT(x) ? 'A job\'s response is its finish less its release; a missed deadline is one passed with work left.' : 'Turnaround is finish − arrival; waiting is turnaround − CPU − I/O time.';
      return { ok: false, cells, message: 'Not quite: ' + out.join('; and ') + '.', details: [!metricsOk && chartOk ? tip : null, x.whyNot || null].filter(Boolean) };
    },
    lint(x) {
      const p = [];
      if (!isRT(x) && !Array.isArray(x.workload)) p.push('a gantt exercise needs a workload (or tasks for a real-time one)');
      if (isRT(x) && !['rm', 'edf'].includes(x.policy)) p.push('a real-time exercise\'s policy is rm or edf');
      try { const W = want(x); if (W.ticks.length > 60) p.push('the schedule is ' + W.ticks.length + ' ticks long: keep it under 60 so the chart fits'); if (W.lanes.length > 4) p.push('at most 4 cores, so the chart fits'); } catch (e) { p.push('the workload does not run: ' + e.message); }
      const ok = isRT(x) ? ['finish', 'response', 'missed'] : ['finish', 'waiting', 'turnaround', 'response'];
      for (const c of x.metrics || []) if (!ok.includes(c)) p.push('unknown metric ' + c);
      return p;
    },
    /** the solution as the engine has it */
    solve(x) {
      const W = want(x), metrics = {};
      for (const r of W.rows) for (const c of W.cols) metrics[r.id + '|' + c] = String(r[c]);
      return W.lanes.length > 1 ? { lanes: W.lanes.map((l) => l.ticks.slice()), metrics } : { ticks: W.ticks.slice(), metrics };
    },
    wrongFrom(x) {
      const s = this.solve(x), out = [];
      const bend = (t) => { t = t.slice(); const k = Math.max(0, t.findIndex((v, i) => i > 0 && v !== t[i - 1])); t[k] = t.find((v) => v !== t[k] && v !== '-') || 'Z'; return t; };
      if (asks(x, 'chart')) out.push(s.lanes ? { lanes: s.lanes.map((l, c) => (c === s.lanes.length - 1 ? bend(l) : l)), metrics: s.metrics } : { ticks: bend(s.ticks), metrics: s.metrics });
      if (asks(x, 'metrics') && Object.keys(s.metrics).length) { const m = Object.assign({}, s.metrics), k = Object.keys(m).find((q) => /^\d+$/.test(m[q])) || Object.keys(m)[0]; m[k] = /^\d+$/.test(m[k]) ? String(+m[k] + 1) : m[k] === 'yes' ? 'no' : '7'; out.push(Object.assign({}, s, { metrics: m })); }
      return out;
    },
    example() {
      const x = {
        id: 'k-gantt', kind: 'gantt', title: 'Round robin, quantum 2', level: 2,
        text: ['Three jobs share one CPU under round robin with a quantum of 2 ticks. Fill in the chart tick by tick, then the finish and waiting times.'],
        workload: [{ id: 'A', arrive: 0, bursts: [5] }, { id: 'B', arrive: 1, bursts: [3] }, { id: 'C', arrive: 2, bursts: [1] }],
        policy: 'rr', params: { quantum: 2 }, metrics: ['finish', 'waiting'],
        hints: ['A job that uses its whole quantum goes to the back of the queue, behind jobs that arrived meanwhile.', 'At t = 2, B is at the head of the queue and A joins behind C.', 'The chart reads A A B B C A A B A: A finishes at 9, B at 8 and C at 5.'],
      };
      x.solution = K.kinds.gantt.solve(x);
      x.wrong = [{ ticks: 'AABBCAABA'.replace('BBC', 'BCB'), metrics: x.solution.metrics }, { ticks: x.solution.ticks, metrics: Object.assign({}, x.solution.metrics, { 'A|waiting': '3' }) }];
      return x;
    },
    /** the samples of every mode: one CPU, two cores, real-time, and a multilevel queue */
    examples() {
      const solved = (x) => { x.solution = K.kinds.gantt.solve(x); x.wrong = K.kinds.gantt.wrongFrom(x); return Object.assign({ chapter: 'kinds', level: 2 }, x); };
      return [Object.assign({ chapter: 'kinds' }, this.example()), solved({
        id: 'k-gantt-multi', kind: 'gantt', title: 'Two cores, one queue',
        text: ['Four jobs on two cores that share one ready queue, round robin with a quantum of 2 on each core. Fill in each core\'s row.'],
        workload: [{ id: 'A', arrive: 0, bursts: [4] }, { id: 'B', arrive: 0, bursts: [3] }, { id: 'C', arrive: 1, bursts: [2] }, { id: 'D', arrive: 2, bursts: [3] }],
        policy: 'multi', params: { cores: 2, queue: 'shared', quantum: 2 }, ask: 'chart',
        hints: ['At every tick core 0 takes the head of the queue first, then core 1.', 'A job that used its quantum goes to the back, behind the jobs that arrived meanwhile.', 'Core 0 runs A A C C A A; core 1 runs B B D D B D. B and A finish at 5 and 6, C at 4, D at 6.'],
      }), solved({
        id: 'k-gantt-rt', kind: 'gantt', title: 'Rate monotonic, two tasks',
        text: ['Task A needs 1 tick every 3, task B needs 2 ticks every 5, both released at t = 0, under rate monotonic up to t = 15. Fill in the chart, then each job\'s response time.'],
        tasks: [{ id: 'A', C: 1, T: 3 }, { id: 'B', C: 2, T: 5 }], policy: 'rm', params: { horizon: 15 }, metrics: ['response'],
        hints: ['A has the shorter period, so it has the higher priority and preempts B.', 'At every release of A, A runs at once.', 'The chart reads A B B A - B A B - A B B A - -: every A job answers in 1 tick, B1 and B2 in 3, B3 in 2.'],
      }), solved({
        id: 'k-gantt-mlq', kind: 'gantt', title: 'Two classes, strict priority',
        text: ['Interactive jobs (class 0) run round robin with a quantum of 1; batch jobs (class 1) run first come, first served, only when no interactive job is ready.'],
        workload: [{ id: 'A', arrive: 0, bursts: [4], cls: 1 }, { id: 'B', arrive: 1, bursts: [2], cls: 0 }, { id: 'C', arrive: 2, bursts: [1], cls: 0 }],
        policy: 'mlq', params: { classes: [{ name: 'interactive', policy: 'rr', quantum: 1 }, { name: 'batch', policy: 'fcfs' }], mode: 'strict' }, metrics: ['finish'],
        hints: ['An interactive arrival preempts the batch job at once.', 'B and C share the CPU a tick at a time while both are ready.', 'The chart reads A B C B A A A: C finishes at 3, B at 4 and A at 7.'],
      })];
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
