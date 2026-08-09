// The Scheduler lab, part two: the setup panel's fields and the presets. Six workbenches share one panel:
//   compare   up to four policies over one workload, Gantt charts side by side, queues and a reason per decision
//   sweep     one quantum policy at every quantum from 1 up: the averages plotted against the quantum
//   cfs       the CFS-style scheduler with its red-black tree of vruntimes, tick by tick
//   lottery   every lottery draw: the ticket ranges, the number drawn, the shares against the tickets
//   rt        periodic tasks under RM and EDF: releases, deadlines, misses, and the schedulability tests worked out
//   pi        priority inversion: tasks that lock a mutex, under no protocol, inheritance or a priority ceiling
(function (S) {
  'use strict';
  const SL = S.SchedLab;
  const mode = (...ms) => (v) => ms.includes(v.mode);
  const work = mode('compare', 'sweep', 'cfs', 'lottery');
  const any = (list) => (v) => SL.uses(v, list);
  const sweepIs = (list) => (v) => v.mode === 'sweep' && list.includes(v.sweepPol);
  const or = (...fs) => (v) => fs.some((f) => f(v));
  const NONE = { value: 'none', label: '— none —' };
  const opts = SL.POLICIES.map((p) => ({ value: p.value, label: p.label }));

  const slotFields = [];
  for (let k = 1; k <= SL.SLOTS; k++) {
    const on = (list) => (v) => v.mode === 'compare' && list.includes(v['pol' + k]);
    slotFields.push(
      { id: 'pol' + k, label: 'Policy ' + k, type: 'select', group: k === 1 ? 'Policies, side by side' : undefined, options: k === 1 ? opts : [NONE].concat(opts), def: ['fcfs', 'sjf', 'rr', 'none'][k - 1], show: mode('compare') },
      { id: 'q' + k, label: 'Quantum, policy ' + k, type: 'number', min: 1, max: 12, def: 2, unit: 'ticks', show: on(SL.QPOL) },
      { id: 'a' + k, label: 'Aging, policy ' + k, type: 'number', min: 0, max: 30, def: 0, unit: 'ticks a step', help: 'every so many ticks of waiting, one step more urgent; 0: none', show: on(SL.PRIO) },
    );
  }

  SL.fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'compare', options: [
      { value: 'compare', label: 'Policies side by side' }, { value: 'sweep', label: 'Quantum sweep' }, { value: 'cfs', label: 'CFS and its tree' },
      { value: 'lottery', label: 'Lottery draws' }, { value: 'rt', label: 'Real time: RM and EDF' }, { value: 'pi', label: 'Priority inversion' }] },
    // ---- the workload
    { id: 'work', label: 'Jobs (bursts: CPU, I/O, CPU, …)', type: 'table', group: 'Workload', def: SL.WORK, minRows: 1, maxRows: 6, show: work,
      columns: [
        { id: 'id', label: 'Job', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,2}$', patternWhy: 'a letter, then up to two letters or digits', width: '34px' },
        { id: 'arrive', label: 'Arr.', type: 'int', min: 0, max: 40, width: '36px', title: 'the tick it arrives' },
        { id: 'bursts', label: 'Bursts', type: 'ints', min: 1, max: 30, odd: 'an odd count: CPU, then I/O and CPU in turn', maxLen: 13, title: 'CPU and I/O bursts in turn, starting and ending with CPU, e.g. 3 2 4', width: '58px' },
        { id: 'prio', label: 'Prio', type: 'int', min: 0, max: 9, width: '34px', title: 'priority: 0 is the most urgent' },
        { id: 'tickets', label: 'Tkts', type: 'int', min: 1, max: 1000, width: '46px', title: 'tickets, for lottery and stride' },
        { id: 'nice', label: 'Nice', type: 'int', min: -20, max: 19, width: '38px', title: 'for CFS: −20 heaviest, 19 lightest' },
        { id: 'cls', label: 'Cls', type: 'int', min: 0, max: 3, width: '30px', title: 'its class in a multilevel queue, 0 the most important' },
        { id: 'cores', label: 'Cores', type: 'text', pattern: '^(all|[0-3]( [0-3])*)$', patternWhy: 'all, or core numbers like 0 1', width: '40px', title: 'affinity: the cores it may run on' },
      ],
      newRow: (i, rows) => SL.row(String.fromCharCode(65 + (rows || []).length % 26), i * 2, [3]),
      check: (r, i, rows) => (rows.findIndex((x) => x.id === r.id) !== i ? { id: 'two jobs are called ' + r.id } : null) },
    { id: 'tasks', label: 'Periodic tasks', type: 'table', group: 'Tasks', def: SL.TASKS, minRows: 1, maxRows: 5, show: mode('rt'),
      columns: [
        { id: 'id', label: 'Task', type: 'text', pattern: '^[A-Z]$', patternWhy: 'one capital letter', width: '46px' },
        { id: 'C', label: 'WCET', type: 'int', min: 1, max: 20, width: '56px', title: 'the worst-case execution time of each job' },
        { id: 'T', label: 'Period', type: 'int', min: 2, max: 48, width: '58px' },
        { id: 'D', label: 'Deadline', type: 'int', min: 1, max: 48, width: '66px', title: 'relative to each release' },
        { id: 'phase', label: 'Phase', type: 'int', min: 0, max: 20, width: '54px', title: 'the first release' },
      ],
      newRow: (i) => ({ id: String.fromCharCode(65 + i), C: 1, T: 8, D: 8, phase: 0 }),
      check: (r, i, rows) => (rows.findIndex((x) => x.id === r.id) !== i ? { id: 'two tasks are called ' + r.id } : null) },
    { id: 'pitasks', label: 'Tasks (script: 3 run, +m lock, -m unlock)', type: 'table', group: 'Tasks', def: SL.PITASKS, minRows: 2, maxRows: 5, show: mode('pi'),
      columns: [
        { id: 'id', label: 'Task', type: 'text', pattern: '^[A-Z]$', patternWhy: 'one capital letter', width: '46px' },
        { id: 'prio', label: 'Prio', type: 'int', min: 0, max: 9, width: '44px', title: '0 is the most urgent' },
        { id: 'arrive', label: 'Arrives', type: 'int', min: 0, max: 30, width: '56px' },
        { id: 'script', label: 'Script', type: 'text', pattern: '^\\s*(\\d+|[+-][A-Za-z][A-Za-z0-9]{0,3})([\\s,]+(\\d+|[+-][A-Za-z][A-Za-z0-9]{0,3}))*\\s*$', patternWhy: 'runs and locks like 1 +m 4 -m 1', width: '130px' },
      ],
      newRow: (i) => ({ id: String.fromCharCode(65 + i), prio: i, arrive: i, script: '2' }),
      check: (r, i, rows) => { if (rows.findIndex((x) => x.id === r.id) !== i) return { id: 'two tasks are called ' + r.id }; const p = SL.parseScript(r.script); return p.error ? { script: p.error } : null; } },
    // ---- the policies
    ...slotFields,
    { id: 'sweepPol', label: 'Policy', type: 'select', group: 'Sweep', def: 'rr', show: mode('sweep'), options: [{ value: 'rr', label: 'Round robin' }, { value: 'lottery', label: 'Lottery' }, { value: 'stride', label: 'Stride' }, { value: 'multi', label: 'Multicore, one shared queue' }, { value: 'multip', label: 'Multicore, a queue per core' }, { value: 'mlfq', label: 'MLFQ (the quantum is Q0’s; each level doubles it)' }] },
    { id: 'qmax', label: 'Quanta from 1 to', type: 'number', min: 2, max: 16, def: 10, unit: 'ticks', show: mode('sweep') },
    { id: 'lq', label: 'Quantum', type: 'number', group: 'Lottery', min: 1, max: 8, def: 2, unit: 'ticks', show: mode('lottery') },
    { id: 'withStride', label: 'Stride beside it, for the same tickets', type: 'toggle', def: true, show: mode('lottery') },
    { id: 'rtRM', label: 'Rate monotonic (RM)', type: 'toggle', group: 'Real-time policies', def: true, show: mode('rt') },
    { id: 'rtEDF', label: 'Earliest deadline first (EDF)', type: 'toggle', def: true, show: mode('rt') },
    { id: 'horizon', label: 'Horizon', type: 'number', min: 0, max: 96, def: 0, unit: 'ticks', help: '0: one hyperperiod', show: mode('rt') },
    { id: 'onMiss', label: 'A job that misses its deadline', type: 'select', def: 'continue', options: [{ value: 'continue', label: 'carries on, late' }, { value: 'abort', label: 'is dropped' }], show: mode('rt') },
    { id: 'piNone', label: 'No protocol', type: 'toggle', group: 'Protocols, side by side', def: true, show: mode('pi') },
    { id: 'piInherit', label: 'Priority inheritance', type: 'toggle', def: true, show: mode('pi') },
    { id: 'piCeiling', label: 'Priority ceiling', type: 'toggle', def: true, show: mode('pi') },
    // ---- parameters shared by the policies that use them
    { id: 'cs', label: 'A context switch costs', type: 'number', group: 'Parameters', min: 0, max: 3, def: 0, unit: 'ticks', show: work },
    { id: 'starve', label: 'Flag starvation after waiting', type: 'number', min: 3, max: 80, def: 10, unit: 'ticks in a row', show: mode('compare') },
    { id: 'alpha', label: 'Prediction weight α', type: 'number', integer: false, min: 0, max: 1, step: 0.1, def: 0.5, help: 'τ(n+1) = α·t(n) + (1 − α)·τ(n)', show: any(['sjfp', 'srtnp']) },
    { id: 'tau0', label: 'First guess τ₀', type: 'number', min: 1, max: 20, def: 5, unit: 'ticks', show: any(['sjfp', 'srtnp']) },
    { id: 'ageFrom', label: 'Aging counts the wait', type: 'select', def: 'joined', options: [{ value: 'joined', label: 'since it last joined the queue' }, { value: 'arrival', label: 'since it arrived, never reset' }], show: any(['prio', 'priop']) },
    { id: 'levels', label: 'MLFQ levels', type: 'number', group: 'MLFQ', min: 2, max: 4, def: 3, show: or(any(['mlfq', 'mlfqr']), sweepIs(['mlfq'])) },
    { id: 'mq', label: 'Quantum per level, Q0 first', type: 'list', kind: 'int', min: 1, max: 16, minLen: 2, maxLen: 4, def: [1, 2, 4], names: (j) => 'Q' + j, show: any(['mlfq', 'mlfqr']) },
    { id: 'ma', label: 'Allotment per level (the bottom has none)', type: 'list', kind: 'int', min: 1, max: 40, minLen: 1, maxLen: 3, def: [3, 6], names: (j) => 'Q' + j, show: or(any(['mlfq', 'mlfqr']), sweepIs(['mlfq'])) },
    { id: 'boost', label: 'Boost every', type: 'number', min: 0, max: 200, def: 0, unit: 'ticks', help: '0: never', show: or(any(['mlfq', 'mlfqr']), sweepIs(['mlfq'])) },
    { id: 'mpre', label: 'A job arriving higher up preempts at once', type: 'toggle', def: true, show: or(any(['mlfq', 'mlfqr']), sweepIs(['mlfq'])) },
    { id: 'classes', label: 'Classes, 0 first', type: 'table', group: 'Multilevel queue', def: [{ name: 'system', policy: 'fcfs', quantum: 2, share: 5 }, { name: 'inter', policy: 'rr', quantum: 2, share: 3 }, { name: 'batch', policy: 'fcfs', quantum: 4, share: 2 }], minRows: 1, maxRows: 4, show: any(['mlq']),
      columns: [
        { id: 'name', label: 'Name', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,5}$', patternWhy: 'a short name', width: '72px' },
        { id: 'policy', label: 'Inside', type: 'select', options: [{ value: 'fcfs', label: 'FCFS' }, { value: 'rr', label: 'RR' }], width: '64px' },
        { id: 'quantum', label: 'Quantum', type: 'int', min: 1, max: 10, width: '64px' },
        { id: 'share', label: 'Share', type: 'int', min: 1, max: 10, width: '52px' },
      ],
      newRow: (i) => ({ name: 'c' + i, policy: 'rr', quantum: 2, share: 1 }) },
    { id: 'mlqMode', label: 'Between the classes', type: 'select', def: 'strict', options: [{ value: 'strict', label: 'strict priority' }, { value: 'share', label: 'time shares per window' }], show: any(['mlq']) },
    { id: 'window', label: 'Share window', type: 'number', min: 4, max: 40, def: 10, unit: 'ticks', show: (v) => SL.uses(v, ['mlq']) && v.mlqMode === 'share' },
    { id: 'strideL', label: 'Stride constant L', type: 'number', group: 'Stride', min: 100, max: 100000, def: 10000, show: or(any(['stride']), sweepIs(['stride']), (v) => v.mode === 'lottery' && v.withStride) },
    { id: 'lat', label: 'Target latency', type: 'number', group: 'CFS', min: 4, max: 40, def: 12, unit: 'ticks', show: or(any(['cfs']), mode('cfs')) },
    { id: 'gran', label: 'Minimum slice', type: 'number', min: 1, max: 8, def: 2, unit: 'ticks', show: or(any(['cfs']), mode('cfs')) },
    { id: 'wake', label: 'Wake-up preemption margin', type: 'number', min: 0, max: 6, def: 1, unit: 'ticks of vruntime', show: or(any(['cfs']), mode('cfs')) },
    { id: 'credit', label: 'A waking job gets up to latency / 2 of credit', type: 'toggle', def: true, show: or(any(['cfs']), mode('cfs')) },
    { id: 'cores', label: 'Cores', type: 'number', group: 'Multicore', min: 1, max: 4, def: 2, show: or(any(['multi', 'multip']), sweepIs(['multi', 'multip'])) },
    { id: 'push', label: 'Push balancing every', type: 'number', min: 0, max: 30, def: 0, unit: 'ticks', help: '0: never (per-core queues)', show: or(any(['multip']), sweepIs(['multip'])) },
    { id: 'pull', label: 'An idle core pulls work', type: 'toggle', def: true, show: or(any(['multip']), sweepIs(['multip'])) },
    { id: 'migrate', label: 'Warming a cold cache costs', type: 'number', min: 0, max: 3, def: 0, unit: 'ticks', show: or(any(['multi', 'multip']), sweepIs(['multi', 'multip'])) },
  ];

  // ---- presets: each one shows something at once ----------------------------------------------------------------
  const R = SL.row;
  const cmp = (pols, more) => Object.assign({ mode: 'compare', pol1: pols[0] || 'fcfs', pol2: pols[1] || 'none', pol3: pols[2] || 'none', pol4: pols[3] || 'none' }, more || {});
  SL.presets = [
    { label: 'A convoy: FCFS, SJF, RR', values: cmp(['fcfs', 'sjf', 'rr'], { work: SL.WORK }) },
    { label: 'Quantum 1 against 6, switches cost 1', values: cmp(['rr', 'rr'], { q1: 1, q2: 6, cs: 1, work: [R('A', 0, [5]), R('B', 0, [7]), R('C', 1, [2, 4, 2]), R('D', 2, [3])] }) },
    { label: 'Starvation, then aging', values: cmp(['priop', 'priop'], { a1: 0, a2: 1, starve: 12, work: [R('Lo', 0, [6], { prio: 7 }), R('A', 1, [4], { prio: 1 }), R('B', 3, [5], { prio: 2 }), R('C', 6, [4], { prio: 1 }), R('D', 9, [5], { prio: 2 }), R('E', 13, [4], { prio: 1 })] }) },
    { label: 'Guessing bursts: SJF known against predicted', values: cmp(['sjf', 'sjfp', 'srtnp'], { alpha: 0.5, tau0: 6, work: [R('A', 0, [2, 1, 2, 1, 2, 1, 8]), R('B', 0, [8, 1, 2, 1, 2]), R('C', 1, [4, 2, 4]), R('D', 2, [1, 3, 1, 3, 1])] }) },
    { label: 'MLFQ, gamed and fixed', values: cmp(['mlfqr', 'mlfq'], { levels: 3, mq: [1, 2, 4], ma: [4, 8], boost: 0, work: [R('A', 0, [14]), R('B', 0, [14]), R('G', 1, [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3])] }) },
    { label: 'Fair shares: lottery, stride, CFS', values: cmp(['lottery', 'stride', 'cfs'], { q1: 2, q2: 2, starve: 16, work: [R('A', 0, [14], { tickets: 300, nice: -4 }), R('B', 0, [14], { tickets: 200, nice: -2 }), R('C', 0, [14], { tickets: 100, nice: 2 })] }) },
    { label: 'Classes: MLQ against MLFQ', values: cmp(['mlq', 'mlfq'], { mlqMode: 'strict', work: [R('S', 4, [2, 6, 2], { cls: 0 }), R('I', 0, [3, 4, 3, 4, 2], { cls: 1 }), R('J', 2, [2, 5, 2], { cls: 1 }), R('B', 0, [12], { cls: 2 }), R('C', 1, [9], { cls: 2 })] }) },
    { label: 'Two cores: shared against per-core', values: cmp(['multi', 'multip'], { q1: 2, q2: 2, cores: 2, push: 0, pull: true, migrate: 1, work: [R('A', 0, [6, 2, 4]), R('B', 0, [9]), R('C', 1, [3, 3, 3], { cores: '1' }), R('D', 2, [8]), R('E', 4, [2, 2, 2])] }) },
    { label: 'Sweep: RR, quantum 1 to 10', values: { mode: 'sweep', sweepPol: 'rr', qmax: 10, cs: 1, work: SL.WORK } },
    { label: 'CFS: nice values and a sleeper', values: { mode: 'cfs', lat: 12, gran: 2, credit: true, work: [R('A', 0, [10], { nice: 0 }), R('B', 0, [10], { nice: 0 }), R('C', 1, [8], { nice: 5 }), R('D', 2, [2, 3, 2, 3, 2]), R('E', 3, [6], { nice: -5 })] } },
    { label: 'Lottery: 3 : 2 : 1 tickets', values: { mode: 'lottery', lq: 2, withStride: true, work: [R('A', 0, [16], { tickets: 300 }), R('B', 0, [16], { tickets: 200 }), R('C', 0, [16], { tickets: 100 })] } },
    { label: 'RT: RM misses, EDF does not', values: { mode: 'rt', rtRM: true, rtEDF: true, horizon: 0, tasks: [{ id: 'A', C: 2, T: 5, D: 5, phase: 0 }, { id: 'B', C: 4, T: 7, D: 7, phase: 0 }] } },
    { label: 'RT: under the bound', values: { mode: 'rt', rtRM: true, rtEDF: true, horizon: 0, tasks: SL.TASKS } },
    { label: 'Inversion: a middle task in the way', values: { mode: 'pi', piNone: true, piInherit: true, piCeiling: true, pitasks: SL.PITASKS } },
    { label: 'Inversion: a chain of two mutexes', values: { mode: 'pi', piNone: true, piInherit: true, piCeiling: true, pitasks: [{ id: 'L', prio: 4, arrive: 0, script: '1 +a 5 -a 1' }, { id: 'K', prio: 3, arrive: 1, script: '1 +b 1 +a 1 -a 2 -b 1' }, { id: 'M', prio: 2, arrive: 4, script: '5' }, { id: 'H', prio: 1, arrive: 5, script: '1 +b 2 -b 1' }] } },
  ];
})(globalThis.Proses = globalThis.Proses || {});
