// Part 5, CPU scheduling: the exercises of chapters 1 and 2 (bursts, metrics and FCFS; shortest first, prediction and
// priorities). Every chart and number is worked out here, when the file loads, by the scheduler engine (S.Sched)
// through the gantt checker's own solver, so the text, the hints and the checked answer cannot disagree. Shared
// helpers for both exercise files of the part live on S.CpuEx.
(function (S) {
  'use strict';
  const C = S.Content, Sch = S.Sched, K = S.Check && S.Check.kinds;
  if (!C || !Sch || !K || !K.gantt || C.exercises.has('cpu-x-ready')) return;

  // ---- helpers shared with 051-sched-ex2.js --------------------------------------------------------------------
  const H = (S.CpuEx = {});
  /** 'A 0 3 (4) 3; B 1 9 prio=2' -> a workload */
  H.W = (s) => s.split(';').map((l) => {
    const [id, a, ...r] = l.trim().split(/\s+/), o = { id, arrive: +a, bursts: [] };
    for (const x of r) { if (x.includes('=')) { const [k, v] = x.split('='); o[k] = +v; } else o.bursts.push(+x.replace(/[()]/g, '')); }
    return o;
  });
  H.f = (v) => String(Math.round(v * 100) / 100);
  H.L = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  H.solve = (x, policy, params) => K.gantt.solve(Object.assign({}, x, policy ? { policy, params: params || {} } : {}));
  H.trace = (x) => K.gantt.want(x).tr;
  /** the chart as text: 'A A B - B' */
  H.chart = (ticks) => ticks.map((t) => (t === '-' ? '·' : t)).join(' ');
  /** the chart as runs: 'A 0–3, B 3–5, idle 5–6' */
  H.runs = (ticks) => { const out = []; let k = 0; while (k < ticks.length) { let e = k; while (e < ticks.length && ticks[e] === ticks[k]) e++; out.push((ticks[k] === '-' ? 'idle' : ticks[k] === 'cs' ? 'switch' : ticks[k]) + ' ' + k + '–' + e); k = e; } return out.join(', '); };
  /** the metrics in words: 'A finishes at 5 and waits 0; B ...' */
  H.mtext = (x, cols) => {
    const tr = H.trace(x), cs = cols || x.metrics || ['finish', 'waiting'];
    const word = { finish: 'finishes at', waiting: 'waits', turnaround: 'turnaround', response: 'response' };
    return tr.metrics.rows.map((r) => r.id + ' ' + cs.map((c) => word[c] + ' ' + H.f(r[c])).join(', ')).join('; ');
  };
  /** the solution with one metric column replaced: a slip a reader might make */
  H.slip = (x, col, f) => {
    const s = H.solve(x), rows = H.trace(x).metrics.rows, m = Object.assign({}, s.metrics);
    for (const r of rows) if (m[r.id + '|' + col] !== undefined) m[r.id + '|' + col] = String(f(r));
    return { ticks: s.ticks, metrics: m };
  };
  /** a gantt exercise: the solution from the engine, wrong answers given as policies, slips or charts */
  H.gantt = (x, wrongs) => {
    x.kind = 'gantt';
    x.metrics = x.metrics || ['finish', 'waiting'];
    x.solution = H.solve(x);
    x.wrong = wrongs.map((w) => (typeof w === 'function' ? w(x) : w));
    return C.exercise(x);
  };
  const W = H.W, f = H.f;

  // =========================================================================================================
  // Chapter 1: bursts, metrics and the queue
  // =========================================================================================================
  const BW = W('A 0 3 (4) 3; B 1 9; C 2 2 (3) 2 (3) 1; D 4 4'), BT = Sch.run(BW, 'fcfs', {}), B5 = BT.steps[5];
  C.exercise({ id: 'cpu-x-ready', chapter: 'cpu-model', title: 'Who can be chosen?', level: 1, kind: 'set',
    text: ['Four jobs run under FCFS. Bursts alternate CPU and I/O: A computes 3 ticks, does 4 ticks of I/O, then computes 3 more.', { table: [['Job', 'Arrives', 'Bursts'], ...BW.map((j) => [j.id, String(j.arrive), j.bursts.map((b, k) => (k % 2 ? '(' + b + ')' : String(b))).join(' ')])], caption: 'I/O bursts in brackets.' }, 'At t = 5, ' + B5.run + ' is running. Which jobs are in the ready queue, the ones the scheduler could choose from? Write a set, like {A, B}.'],
    answer: '{' + B5.ready.join(', ') + '}',
    hints: ['A job that is running is not in the ready queue, and neither is a job doing I/O.', 'A ran from 0 to 3, then went to its device until t = 7. B started at 3. C arrived at 2 and D at 4, and neither has run yet.', 'At t = 5 the ready queue is {' + B5.ready.join(', ') + '}: ' + B5.run + ' is on the CPU and A is in I/O until t = 7.'],
    solution: '{' + B5.ready.join(', ') + '}', wrong: ['{A, ' + B5.ready.join(', ') + '}', '{' + [B5.run].concat(B5.ready).join(', ') + '}'],
    whyNot: 'A job in I/O is away at its device, and the running job is on the CPU: neither is waiting to be chosen.' });

  C.exercise({ id: 'cpu-x-overlap', chapter: 'cpu-model', title: 'Why keep several jobs?', level: 1, kind: 'choice',
    text: ['A machine runs one job at a time to completion; then it is changed to keep several jobs in memory and switch between them. The jobs do a mix of computing and disk reads. Why does the CPU now spend more of its time doing useful work?'],
    options: ['While one job waits for the disk, another can compute', 'Switching between jobs makes each instruction faster', 'Jobs in memory need no I/O at all', 'The disk reads go faster when several jobs ask at once'],
    answer: 0,
    whyNot: { 1: 'Switching costs time; it never speeds up an instruction.', 2: 'Being in memory does not remove a job\'s I/O: it still has to read its files.', 3: 'Each read takes as long as before; what changes is that the CPU has something else to do meanwhile.' },
    hints: ['What does the CPU do while the only job in memory waits for the disk?', 'With one job, the CPU idles through every I/O burst. With several, an I/O burst of one can overlap a CPU burst of another.', 'While one job waits for the disk, another can compute: the CPU idles only when every job is in I/O at once.'],
    solution: 0, wrong: [1, 3] });

  const MX = { id: 'cpu-x-metrics', chapter: 'cpu-model', title: 'Measure a finished schedule', level: 1, ask: 'metrics', metrics: ['finish', 'turnaround', 'waiting', 'response'],
    workload: W('X 0 4; Y 2 2; Z 3 3'), policy: 'fcfs' };
  MX.text = ['Three jobs ran under FCFS, and the chart reads: ' + H.runs(H.solve(MX).ticks) + '. Fill in each job\'s finish time, turnaround, waiting time and response time.'];
  MX.hints = ['Turnaround = finish − arrival; waiting = turnaround − CPU time (there is no I/O here); response = first tick on the CPU − arrival.', 'Z arrives at 3, first runs at 6 and finishes at 9: turnaround 6, waiting 6 − 3 = 3, response 3.', H.mtext(MX, ['finish', 'turnaround', 'waiting', 'response']) + '.'];
  H.gantt(MX, [(x) => H.slip(x, 'waiting', (r) => r.turnaround), (x) => H.slip(x, 'turnaround', (r) => r.finish)]);

  const F1 = { id: 'cpu-x-fcfs', chapter: 'cpu-model', title: 'FCFS by hand', level: 1, workload: W('P 0 5; Q 1 3; R 2 1; S 4 2'), policy: 'fcfs',
    text: ['Four jobs share one CPU under first come, first served. Paint the chart tick by tick, then give each job\'s finish time and waiting time.'] };
  F1.hints = ['FCFS never preempts: the job at the head of the queue runs its whole burst, and the others queue in order of arrival.', 'P runs from 0 to 5; by then Q, R and S have all arrived, in that order.', 'The chart reads ' + H.chart(H.solve(F1).ticks) + '. ' + H.mtext(F1) + '.'];
  H.gantt(F1, [(x) => H.solve(x, 'sjf'), (x) => H.slip(x, 'waiting', (r) => r.response + 1)]);

  const F2 = { id: 'cpu-x-fcfs-io', chapter: 'cpu-model', title: 'FCFS with I/O', level: 2, workload: W('A 0 2 (3) 2; B 1 4; C 3 1 (2) 1'), policy: 'fcfs',
    text: ['Bursts alternate CPU and I/O: A computes 2 ticks, does 3 ticks of I/O, then computes 2 more. A job back from I/O joins the back of the ready queue. Paint the FCFS chart, then give each job\'s finish time and waiting time (time ready but not running: turnaround less CPU and I/O).'] };
  F2.hints = ['When A starts its I/O at t = 2, B runs. A comes back at t = 5 and joins the queue behind whoever is already there.', 'C arrived at t = 3, before A came back at t = 5, so C is ahead of A when B finishes at t = 6.', 'The chart reads ' + H.chart(H.solve(F2).ticks) + '. ' + H.mtext(F2) + '.'];
  H.gantt(F2, [{ ticks: 'AABBBBAACC', metrics: H.solve(F2).metrics }, (x) => H.slip(x, 'waiting', (r) => r.turnaround - r.cpu)]);

  const CV1 = Sch.run(W('A 0 11; B 1 2; C 2 3; D 3 1'), 'fcfs', {}).metrics.avg, CV2 = Sch.run(W('A 3 11; B 0 2; C 1 3; D 2 1'), 'fcfs', {}).metrics.avg;
  const cvCells = { 'long first|average waiting': CV1.waiting, 'long first|average turnaround': CV1.turnaround, 'long last|average waiting': CV2.waiting, 'long last|average turnaround': CV2.turnaround };
  const cvSol = Object.fromEntries(Object.entries(cvCells).map(([k, v]) => [k, f(v)]));
  C.exercise({ id: 'cpu-x-convoy', chapter: 'cpu-model', title: 'The same jobs, two orders', level: 2, kind: 'table',
    text: ['Under FCFS, a job A needing 11 ticks and three short jobs B (2 ticks), C (3) and D (1) arrive one tick apart. In the first order A comes first (A at 0, B at 1, C at 2, D at 3); in the second A comes last (B at 0, C at 1, D at 2, A at 3). Give the average waiting and turnaround times for each order, to two decimals.'],
    rows: ['long first', 'long last'], cols: ['average waiting', 'average turnaround'], corner: 'order', cells: cvCells, cellKind: 'number', tolerance: 0.005,
    hints: ['Work out each job\'s start and finish, then waiting = start − arrival here (no I/O, no preemption).', 'Long first: B, C and D wait behind A\'s 11 ticks. Long last: A waits only for the 6 ticks of the short jobs.', 'Long first: waiting ' + f(CV1.waiting) + ', turnaround ' + f(CV1.turnaround) + '. Long last: waiting ' + f(CV2.waiting) + ', turnaround ' + f(CV2.turnaround) + '.'],
    solution: cvSol, wrong: [{ 'long first|average waiting': cvSol['long last|average waiting'], 'long first|average turnaround': cvSol['long last|average turnaround'], 'long last|average waiting': cvSol['long first|average waiting'], 'long last|average turnaround': cvSol['long first|average turnaround'] }, Object.assign({}, cvSol, { 'long first|average waiting': f(CV1.turnaround) })] });

  const UT = Sch.run(W('A 0 2 (5) 2; B 1 2'), 'fcfs', {}), UTP = Math.round(UT.metrics.util * 1000) / 10;
  C.exercise({ id: 'cpu-x-util', chapter: 'cpu-model', title: 'How busy was the CPU?', level: 2, kind: 'number',
    text: ['Two jobs run under FCFS: A arrives at 0 and computes 2 ticks, does 5 ticks of I/O, then computes 2 more; B arrives at 1 and computes 2 ticks. What is the CPU utilisation over the whole run, from t = 0 until the last job finishes, as a percentage to one decimal place?'],
    answer: UTP, tolerance: 0.05,
    whyNot: { 100: 'The CPU is not busy all the time: once B has finished, nothing is ready until A comes back from its device.', '*': 'Count the ticks the CPU spends on a job, then divide by the length of the whole run.' },
    hints: ['Utilisation = ticks the CPU spent computing ÷ the length of the run.', 'A runs 0–2, B 2–4; then both are done or away until A is back at t = 7, and A finishes at t = ' + UT.end + '.', 'The CPU was busy ' + UT.metrics.busy + ' of ' + UT.end + ' ticks: ' + UTP + '%.'],
    solution: UTP, wrong: [100, 75] });

  // =========================================================================================================
  // Chapter 2: shortest first and priorities
  // =========================================================================================================
  const SJ = { id: 'cpu-x-sjf', chapter: 'cpu-short', title: 'SJF by hand', level: 1, workload: W('A 0 7; B 1 4; C 2 1; D 3 2'), policy: 'sjf',
    text: ['Four jobs under shortest job first (not preemptive): whenever the CPU is free, the ready job with the shortest next burst runs to the end of it. Paint the chart, then give finish and waiting times.'] };
  SJ.hints = ['At t = 0 only A is there, so A runs all 7 ticks: SJF does not preempt.', 'At t = 7, B (4), C (1) and D (2) are ready: shortest first.', 'The chart reads ' + H.chart(H.solve(SJ).ticks) + '. ' + H.mtext(SJ) + '.'];
  H.gantt(SJ, [(x) => H.solve(x, 'fcfs'), (x) => H.solve(x, 'srtn')]);

  const SR = { id: 'cpu-x-srtn', chapter: 'cpu-short', title: 'SRTN by hand', level: 2, workload: W('A 0 7; B 2 4; C 4 1; D 5 4'), policy: 'srtn',
    text: ['The same idea, now preemptive: under shortest remaining time next, a job that arrives with strictly less to do than the running job has left takes the CPU at once. Paint the chart, then give finish and waiting times.'] };
  SR.hints = ['At each arrival compare the newcomer\'s burst with what the running job has left. A tie does not preempt.', 'At t = 2, B (4) beats A\'s 5 left. At t = 4, C (1) beats B\'s 2 left. At t = 5, D (4) does not beat B\'s 2.', 'The chart reads ' + H.chart(H.solve(SR).ticks) + '. ' + H.mtext(SR) + '.'];
  H.gantt(SR, [(x) => H.solve(x, 'sjf'), (x) => H.slip(x, 'waiting', (r) => r.response)]);

  const TIE = Sch.run(W('A 0 5; B 2 3; C 4 1'), 'srtn', {}), tie2 = TIE.steps[2];
  C.exercise({ id: 'cpu-x-srtn-tie', chapter: 'cpu-short', title: 'A tie under SRTN', level: 2, kind: 'choice',
    text: ['Under SRTN, A arrives at 0 needing 5 ticks. At t = 2, B arrives needing 3, and A has 3 left. What happens at t = 2?'],
    options: ['B preempts A: it is the newer job', 'A keeps the CPU: B is not strictly shorter', 'They split the CPU, a tick each'],
    answer: tie2.run === 'A' ? 1 : 0,
    whyNot: { 0: 'SRTN preempts only for strictly less remaining time; preempting on a tie would cost a switch and gain nothing.', 2: 'SRTN never shares the CPU tick by tick; that would be round robin with quantum 1.' },
    hints: ['Compare B\'s 3 with what A has left.', 'They are equal, and SRTN preempts only for a strictly shorter job.', 'A keeps the CPU and finishes at t = 5. In the engine\'s words: ' + TIE.steps[2].say.replace(/`/g, '').replace(/^At/, 'at')],
    solution: 1, wrong: [0, 2] });

  C.exercise({ id: 'cpu-x-sjf-catch', chapter: 'cpu-short', title: 'The catch in SJF', level: 1, kind: 'choice',
    text: ['When all the jobs are ready at once, SJF gives the least average waiting time of any policy that never preempts. Why can an operating system not simply use it as it stands?'],
    options: ['It needs the length of each job\'s next CPU burst before the burst starts', 'It needs a sorted list, which is too slow to keep', 'It cannot handle jobs that do I/O', 'It wastes CPU time while it decides'],
    answer: 0,
    whyNot: { 1: 'Keeping jobs ordered by a key is cheap (a heap, a tree); the trouble is knowing the key.', 2: 'SJF schedules CPU bursts; a job doing I/O simply comes back with its next burst.', 3: 'Choosing the shortest of a few known numbers costs almost nothing.' },
    hints: ['What does SJF compare when it chooses?', 'It compares the lengths of the next CPU bursts, which lie in the future.', 'A real scheduler cannot know the next burst\'s length; it has to estimate it, for example by exponential averaging of the past bursts.'],
    solution: 0, wrong: [1, 3] });

  const PR1 = Sch.run([{ id: 'A', arrive: 0, bursts: [4, 1, 9] }], 'sjf', { predict: { alpha: 0.25, tau0: 12 } }).predictions[0];
  C.exercise({ id: 'cpu-x-predict', chapter: 'cpu-short', title: 'One step of the average', level: 1, kind: 'number',
    text: ['A scheduler guesses CPU bursts by exponential averaging, τ(n+1) = α·t(n) + (1 − α)·τ(n), with α = 0.25. Its guess for a job\'s burst was ' + PR1.predicted + ' ticks; the burst actually took ' + PR1.actual + '. What is the guess for the next burst?'],
    answer: PR1.next, tolerance: 0.005,
    whyNot: { [PR1.actual]: 'That is α = 1: only the last burst counts. Here the old guess still weighs 0.75.', '*': 'Weigh the new burst by α = 0.25 and the old guess by 1 − α = 0.75.' },
    hints: ['Put t(n) = ' + PR1.actual + ' and τ(n) = ' + PR1.predicted + ' into the formula.', 'α·t(n) = 0.25 × ' + PR1.actual + ' and (1 − α)·τ(n) = 0.75 × ' + PR1.predicted + '.', '0.25 × ' + PR1.actual + ' + 0.75 × ' + PR1.predicted + ' = ' + PR1.next + '.'],
    solution: PR1.next, wrong: [PR1.actual, (PR1.actual + PR1.predicted) / 2] });

  const PRS = Sch.run([{ id: 'A', arrive: 0, bursts: [4, 1, 8, 1, 8, 1, 2, 1, 5] }], 'sjf', { predict: { alpha: 0.5, tau0: 6 } }).predictions;
  const prCols = ['burst 2', 'burst 3', 'burst 4', 'burst 5'], prCells = Object.fromEntries(prCols.map((c, k) => ['guess|' + c, PRS[k + 1].predicted]));
  const prSol = Object.fromEntries(Object.entries(prCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'cpu-x-predict-run', chapter: 'cpu-short', title: 'Guesses over a run', level: 2, kind: 'table',
    text: ['α = 0.5, and the guess for the first burst is τ₀ = 6. The job\'s first four CPU bursts take ' + PRS.slice(0, 4).map((p) => p.actual).join(', ') + ' ticks. Give the guess made for each of bursts 2 to 5, to two decimals.'],
    rows: ['guess'], cols: prCols, corner: '', cells: prCells, cellKind: 'number', tolerance: 0.01,
    hints: ['Each guess is half the burst just seen plus half the guess that was made for it.', 'Burst 1 took ' + PRS[0].actual + ' against a guess of 6, so the guess for burst 2 is 0.5 × ' + PRS[0].actual + ' + 0.5 × 6 = ' + PRS[1].predicted + '.', 'The guesses for bursts 2 to 5 are ' + H.L(PRS.slice(1, 5).map((p) => p.predicted)) + '.'],
    solution: prSol, wrong: [Object.fromEntries(prCols.map((c, k) => ['guess|' + c, String(PRS[k].actual)])), Object.assign({}, prSol, { 'guess|burst 5': '5' })] });

  const PW = W('A 0 5 prio=3; B 1 3 prio=1; C 2 4 prio=2; D 4 2 prio=0');
  const P1 = { id: 'cpu-x-prio', chapter: 'cpu-short', title: 'Preemptive priority', level: 2, workload: PW, policy: 'prio', params: { preemptive: true },
    text: ['A lower number is more urgent. Under preemptive priority, a job that becomes ready with a strictly more urgent priority than the running one takes the CPU at once. Paint the chart, then give finish and waiting times.'] };
  P1.hints = ['At each arrival compare the newcomer\'s priority with the running job\'s.', 'B (1) preempts A (3) at t = 1. C (2) arriving at 2 does not beat B. D (0) arrives at 4 just as B finishes.', 'The chart reads ' + H.chart(H.solve(P1).ticks) + '. ' + H.mtext(P1) + '.'];
  H.gantt(P1, [(x) => H.solve(x, 'prio', { preemptive: false }), (x) => H.slip(x, 'waiting', (r) => r.response)]);

  const P2 = { id: 'cpu-x-prio-np', chapter: 'cpu-short', title: 'Priority without preemption', level: 2, workload: PW, policy: 'prio', params: { preemptive: false },
    text: ['The same four jobs, now under priority scheduling that never preempts: a running job keeps the CPU until its burst ends, and only then does the most urgent ready job run. Paint the chart, then give finish and waiting times.'] };
  P2.hints = ['A arrives alone at 0 and keeps the CPU for all 5 ticks, however urgent the newcomers are.', 'At t = 5, B (1), C (2) and D (0) are all ready: D first, then B, then C.', 'The chart reads ' + H.chart(H.solve(P2).ticks) + '. ' + H.mtext(P2) + '.'];
  H.gantt(P2, [(x) => H.solve(x, 'prio', { preemptive: true }), (x) => H.solve(x, 'fcfs')]);

  const AG = { id: 'cpu-x-aging', chapter: 'cpu-short', title: 'Aging lets L in', level: 3, workload: W('L 0 4 prio=5; A 0 3 prio=1; B 2 3 prio=1; C 5 3 prio=1; D 8 3 prio=1'), policy: 'prio', params: { preemptive: true, age: 2 },
    text: ['Preemptive priority with aging: for every 2 ticks a job has waited since it last joined the ready queue, its priority number drops by 1 (never below 0). A running job keeps the priority it was dispatched with. Ties go to the job that has waited longer. Paint the chart, then give finish and waiting times.'] };
  const agT = H.trace(AG), ag10 = agT.steps[10];
  AG.hints = ['Track L\'s priority: it has waited since t = 0, so at t = 2 it is 4, at t = 4 it is 3, and so on.', 'At t = 9, C finishes; L has reached priority 1 and ties with D, which has waited only 1 tick, so L runs. But D keeps aging while it waits: ' + ag10.say.replace(/`/g, '').replace(/^At/, 'at'), 'The chart reads ' + H.chart(H.solve(AG).ticks) + '. ' + H.mtext(AG) + '.'];
  H.gantt(AG, [(x) => H.solve(x, 'prio', { preemptive: true }), (x) => H.slip(x, 'waiting', (r) => r.waiting + 1)]);
})(globalThis.Proses = globalThis.Proses || {});
