// Part 5, CPU scheduling: the exercises of chapters 3 and 4 (time slices and feedback; fair shares). As in
// 051-sched-ex.js, every chart and number is worked out by the scheduler engine (S.Sched) when the file loads, through
// the helpers that file leaves on S.CpuEx.
(function (S) {
  'use strict';
  const C = S.Content, Sch = S.Sched, H = S.CpuEx;
  if (!C || !Sch || !H || C.exercises.has('cpu-x-rr')) return;
  const W = H.W, f = H.f;

  // =========================================================================================================
  // Chapter 3: time slices and feedback
  // =========================================================================================================
  const RR1 = { id: 'cpu-x-rr', chapter: 'cpu-slices', title: 'Round robin by hand', level: 1, workload: W('A 0 5; B 1 3; C 2 2'), policy: 'rr', params: { quantum: 2 },
    text: ['Three jobs under round robin with a quantum of 2 ticks. A job that uses its whole quantum goes to the back of the ready queue; a job arriving at the same tick joins ahead of it. Paint the chart, then give finish and waiting times.'] };
  RR1.hints = ['At t = 2, A\'s quantum is up. B arrived at 1, and C arrives at 2, so both are ahead of A when it rejoins.', 'The queue at t = 2 is [B, C, A]. Keep going two ticks at a time, sending each unfinished job to the back.', 'The chart reads ' + H.chart(H.solve(RR1).ticks) + '. ' + H.mtext(RR1) + '.'];
  H.gantt(RR1, [{ ticks: 'AABBAACCBA', metrics: H.solve(RR1).metrics }, (x) => H.solve(x, 'fcfs')]);

  const RR3 = { id: 'cpu-x-rr-q3', chapter: 'cpu-slices', title: 'Quantum 3, jobs arriving', level: 2, workload: W('A 0 6; B 1 4; C 3 5; D 5 2'), policy: 'rr', params: { quantum: 3 },
    text: ['Round robin, quantum 3, with jobs arriving while others run. Paint the chart, then give finish and waiting times.'] };
  RR3.hints = ['Keep the queue written down at every quantum boundary: arrivals join the back as they come, and the job whose quantum just ended joins behind them.', 'At t = 3 the queue is [B, C, A]; at t = 6 it is [C, A, D, B].', 'The chart reads ' + H.chart(H.solve(RR3).ticks) + '. ' + H.mtext(RR3) + '.'];
  H.gantt(RR3, [(x) => H.solve(x, 'rr', { quantum: 2 }), (x) => H.slip(x, 'finish', (r) => r.finish + 1)]);

  const RC = { id: 'cpu-x-rr-cs', chapter: 'cpu-slices', title: 'Paying for each switch', level: 3, workload: W('A 0 3; B 0 4; C 1 2'), policy: 'rr', params: { quantum: 2, cs: 1 },
    text: ['Round robin with a quantum of 2, but now every context switch costs 1 tick: whenever the CPU starts a job other than the one that ran last, 1 tick of switching comes first. (The very first job needs no switch.) Paint the chart, using the switch pen for switching ticks, then give finish and waiting times. Waiting counts the switching ticks too: they are time a job is not running.'] };
  const rcT = H.trace(RC);
  RC.hints = ['A runs 0–2. Then the CPU switches to B: a switch tick at t = 2, and B runs 3–5.', 'A job that runs again straight after itself needs no switch; here that never happens, since someone is always waiting. ' + rcT.metrics.overhead + ' ticks go to switching in all.', 'The chart reads ' + H.chart(H.solve(RC).ticks) + '. ' + H.mtext(RC) + '.'];
  H.gantt(RC, [(x) => H.solve(x, 'rr', { quantum: 2 }), (x) => H.slip(x, 'waiting', (r) => r.waiting - 2)]);

  const FIVE = W('A 0 6; B 2 3; C 4 7; D 5 2; E 8 4'), QS = [1, 2, 4];
  const QT = Object.fromEntries(QS.map((q) => [q, Sch.run(FIVE, 'rr', { quantum: q, cs: 1 })]));
  const qCols = ['average turnaround', 'average response', 'all done at'];
  const qCells = {};
  for (const q of QS) { qCells['q = ' + q + '|average turnaround'] = QT[q].metrics.avg.turnaround; qCells['q = ' + q + '|average response'] = QT[q].metrics.avg.response; qCells['q = ' + q + '|all done at'] = QT[q].end; }
  const qSol = Object.fromEntries(Object.entries(qCells).map(([k, v]) => [k, f(v)]));
  const Q0 = Sch.run(FIVE, 'rr', { quantum: 1 });
  C.exercise({ id: 'cpu-x-quantum', chapter: 'cpu-slices', title: 'Three quanta, switches costing 1', level: 3, kind: 'table',
    text: ['Five jobs: A arrives at 0 needing 6 ticks, B at 2 needing 3, C at 4 needing 7, D at 5 needing 2, E at 8 needing 4. They run under round robin, and every context switch costs 1 tick (none before the first job). For quanta 1, 2 and 4, give the average turnaround and response times (to two decimals) and the tick at which everything is done. Work it out on paper, or check yourself in the Scheduler lab\'s quantum sweep.'],
    rows: QS.map((q) => 'q = ' + q), cols: qCols, corner: 'quantum', cells: qCells, cellKind: 'number', tolerance: 0.005,
    hints: ['Draw each schedule with its switch ticks. Response counts from arrival to the first tick of real work, after the switch.', 'Quantum 1 switches after almost every tick: ' + QT[1].metrics.overhead + ' switches, so the run stretches to t = ' + QT[1].end + '. Quantum 4 switches only ' + QT[4].metrics.overhead + ' times.', QS.map((q) => 'q = ' + q + ': turnaround ' + f(QT[q].metrics.avg.turnaround) + ', response ' + f(QT[q].metrics.avg.response) + ', done at ' + QT[q].end).join('; ') + '.'],
    solution: qSol, wrong: [Object.assign({}, qSol, { 'q = 1|average turnaround': f(Q0.metrics.avg.turnaround), 'q = 1|all done at': String(Q0.end) }), Object.assign({}, qSol, { 'q = 2|average response': f(QT[1].metrics.avg.response) })] });

  C.exercise({ id: 'cpu-x-big-q', chapter: 'cpu-slices', title: 'A very long quantum', level: 1, kind: 'choice',
    text: ['Round robin is given a quantum longer than any CPU burst in the workload. Which policy does it now behave exactly like?'],
    options: ['FCFS', 'SJF', 'SRTN', 'Priority'],
    answer: 0,
    whyNot: { 1: 'Round robin never looks at burst lengths: the order is still the order of the queue.', 2: 'Nothing is ever preempted when the quantum outlasts every burst, and SRTN preempts.', 3: 'Round robin has no priorities.' },
    hints: ['When does round robin cut a job off?', 'Only when its quantum ends before its burst does. If that never happens, each job runs its whole burst in queue order.', 'FCFS: every burst runs to its end, in the order the jobs joined the queue.'],
    solution: 0, wrong: [1, 2] });

  const MQ = { id: 'cpu-x-mlq', chapter: 'cpu-slices', title: 'Three classes, strict priority', level: 2, workload: W('I 0 3 (2) 2 cls=1; B 0 5 cls=2; S 4 2 cls=0; J 1 2 cls=1'), policy: 'mlq', params: { mode: 'strict' },
    text: ['A multilevel queue with three classes: class 0, system (FCFS); class 1, interactive (round robin, quantum 2); class 2, batch (FCFS). Under strict priority a class runs only when every more important class is empty, and an arrival in a more important class preempts at once. S is a system job, I and J are interactive, B is batch. Paint the chart, then give finish and waiting times.'] };
  MQ.hints = ['Batch runs only when no system or interactive job is ready. Inside the interactive class, round robin with quantum 2.', 'I runs 0–2; its quantum is up and J (arrived at 1) runs 2–4; S arrives at 4 and outranks both classes. B first gets the CPU when I leaves for I/O.', 'The chart reads ' + H.chart(H.solve(MQ).ticks) + '. ' + H.mtext(MQ) + '.'];
  H.gantt(MQ, [(x) => H.solve(x, 'mlq', { mode: 'share', shares: [5, 3, 2], window: 10 }), (x) => H.solve(x, 'fcfs')]);

  const MF = { id: 'cpu-x-mlfq', chapter: 'cpu-slices', title: 'A two-level feedback queue', level: 2, workload: W('A 0 8; B 1 1 (3) 1 (3) 1; C 3 4'), policy: 'mlfq', params: { levels: 2, quantum: [2, 4], allot: [2], boost: 0 },
    text: ['An MLFQ with two levels: Q0 has a quantum of 2 and an allotment of 2 ticks; Q1, the bottom, has a quantum of 4. New jobs enter Q0; a job that has used 2 ticks of CPU at Q0 in all (I/O does not reset the count) drops to Q1. Q0 always goes first, and a job becoming ready in Q0 preempts a Q1 job at once. No boost. Paint the chart, then give finish and waiting times.'] };
  MF.hints = ['Count each job\'s ticks at Q0. A uses its 2 at once and drops; B runs 1 tick before each I/O.', 'B uses its second Q0 tick at t = 6 and so drops to Q1: when it is back from I/O at t = 10 it waits behind A in Q1.', 'The chart reads ' + H.chart(H.solve(MF).ticks) + '. ' + H.mtext(MF) + '.'];
  H.gantt(MF, [(x) => H.solve(x, 'mlfq', Object.assign({}, x.params, { allotMode: 'reset-io' })), (x) => H.solve(x, 'rr', { quantum: 2 })]);

  const M3 = { id: 'cpu-x-mlfq3', chapter: 'cpu-slices', title: 'Three levels, quanta 1, 2 and 4', level: 3, workload: W('A 0 7; B 1 2 (2) 2; C 2 3'), policy: 'mlfq', params: { levels: 3, quantum: [1, 2, 4], allot: [2, 4], boost: 0 },
    text: ['An MLFQ with three levels: quanta 1, 2 and 4 ticks; allotments 2 ticks at Q0 and 4 at Q1 (the bottom has none). New jobs enter Q0. A job drops a level when it has used its level\'s allotment in all, I/O or not; a job that uses a whole quantum goes to the back of its queue; a job becoming ready in a higher queue preempts at once. Jobs arriving at a tick queue ahead of the job whose quantum just ended. No boost. Paint the chart, then give finish and waiting times.'] };
  M3.hints = ['Keep three queues on paper, and for each job its level and its ticks used there.', 'A runs 1 tick at Q0 and goes to the back; B arrived at 1 and runs. At t = 2, A runs its second Q0 tick and drops to Q1.', 'The chart reads ' + H.chart(H.solve(M3).ticks) + '. ' + H.mtext(M3) + '.'];
  H.gantt(M3, [(x) => H.solve(x, 'rr', { quantum: 1 }), (x) => H.slip(x, 'waiting', (r) => r.waiting + 1)]);

  C.exercise({ id: 'cpu-x-game', chapter: 'cpu-slices', title: 'Closing the loophole', level: 2, kind: 'choice',
    text: ['An MLFQ resets a job\'s count of CPU at its level every time the job blocks for I/O. A long computation is rewritten to do a one-tick write to a log file just before its allotment would run out, again and again. Which change to the rules stops it from staying in the top queue for ever?'],
    options: ['Count the CPU a job uses at a level across its I/O, so it drops after its allotment however the time is split up', 'Make the top quantum longer', 'Boost every job to the top queue more often', 'Give the top queue FCFS instead of round robin'],
    answer: 0,
    whyNot: { 1: 'A longer quantum just lets the program run longer before its next tiny write; the count is still reset each time.', 2: 'The boost helps long jobs that are starving, but a job that never drops gains nothing from it, and a frequent boost lifts the cheater too.', 3: 'The order inside the queue is not the problem: the cheater should not be in the top queue at all.' },
    hints: ['What does the program exploit?', 'Every time it blocks, its count starts again, so it never reaches its allotment.', 'Count the ticks used at a level across I/O: after its allotment in all, however split up, the job drops a level. In the topic, the cheater\'s share fell from 58% to 26%.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 4: fair shares
  // =========================================================================================================
  const LT = Sch.lottery(W('B 0 4 tickets=200; C 0 4 tickets=100'), { quantum: 2, seed: 1 }).steps[0].draw;
  const lotP = LT.holders.find((h) => h.id === 'C').tickets / LT.total;
  C.exercise({ id: 'cpu-x-lottery', chapter: 'cpu-fair', title: 'The odds of a draw', level: 1, kind: 'number',
    text: ['Under lottery scheduling, A holds 300 tickets, B 200 and C 100. A is away doing I/O, so only B and C are in the draw. What is the chance that C wins it? Give it as a decimal to two places.'],
    answer: lotP, tolerance: 0.005,
    whyNot: { 0.17: 'A is not ready, so its tickets are not in the draw: only B\'s and C\'s count.', '*': 'C\'s tickets divided by all the tickets in the draw.' },
    hints: ['Only the tickets of ready jobs take part in a draw.', 'The draw has 200 + 100 = ' + LT.total + ' tickets, and C holds 100 of them.', '100 / ' + LT.total + ' ≈ ' + f(lotP) + '.'],
    solution: f(lotP), wrong: [0.17, 0.5] });

  const STW = W('A 0 5 tickets=250; B 0 5 tickets=100; C 0 5 tickets=400'), STT = Sch.stride(STW, { quantum: 1, L: 1000 }).steps[0].table;
  const stCells = Object.fromEntries(STT.map((r) => [r.id + '|stride', r.stride])), stSol = Object.fromEntries(Object.entries(stCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'cpu-x-strides', chapter: 'cpu-fair', title: 'Strides from tickets', level: 1, kind: 'table',
    text: ['Stride scheduling with L = 1000: each job\'s stride is L divided by its tickets (rounded down). A holds 250 tickets, B 100 and C 400. Give each stride.'],
    rows: STT.map((r) => r.id), cols: ['stride'], corner: 'job', cells: stCells, cellKind: 'number',
    hints: ['stride = L / tickets.', 'A: 1000 / 250. The more tickets, the smaller the stride.', STT.map((r) => r.id + ': ' + r.stride).join(', ') + '. C, with the most tickets, has the smallest stride and runs most often.'],
    solution: stSol, wrong: [Object.fromEntries(STT.map((r) => [r.id + '|stride', String(r.tickets)])), Object.assign({}, stSol, { 'C|stride': '3' })] });

  const ST = { id: 'cpu-x-stride', chapter: 'cpu-fair', title: 'Stride by hand', level: 2, workload: W('A 0 5 tickets=300; B 0 2 tickets=100; C 0 3 tickets=200'), policy: 'stride', params: { quantum: 1, L: 600 },
    text: ['Stride scheduling with L = 600 and a quantum of 1 tick. A holds 300 tickets, B 100 and C 200, so the strides are 2, 6 and 3. Each job starts with its pass equal to its stride; the ready job with the lowest pass runs for a tick and its pass grows by its stride. On a tie, the job that has waited longer runs. Paint the chart, then give finish and waiting times.'] };
  ST.hints = ['Write the three passes down and update one after every tick: A 2, B 6, C 3 at the start.', 'A runs (2 → 4); C runs (3 → 6); A runs (4 → 6); now all three are at 6, and B has waited longest.', 'The chart reads ' + H.chart(H.solve(ST).ticks) + '. ' + H.mtext(ST) + '.'];
  H.gantt(ST, [(x) => H.solve(x, 'rr', { quantum: 1 }), (x) => H.slip(x, 'finish', (r) => r.finish - 1)]);

  const VRT = Sch.cfs([{ id: 'E', arrive: 0, bursts: [9], nice: -5 }], {}).steps[6].vr.E, WE = Sch.weight(-5);
  C.exercise({ id: 'cpu-x-cfs-vr', chapter: 'cpu-fair', title: 'A heavy job\'s virtual clock', level: 2, kind: 'number',
    text: ['In a CFS-style scheduler a job of nice −5 has weight ' + WE + ' (nice 0 is 1024). Each tick it runs adds 1024 / weight to its virtual runtime. It starts at vruntime 0. What is its vruntime after it has run 6 ticks? Give two decimals.'],
    answer: VRT, tolerance: 0.01,
    whyNot: { 6: 'That is nice 0: real time and virtual time agree only at weight 1024.', '*': 'Multiply the 6 ticks by 1024 / ' + WE + '.' },
    hints: ['One tick adds 1024 / ' + WE + ' to its vruntime.', '1024 / ' + WE + ' ≈ ' + f(1024 / WE) + ' per tick: a heavy job\'s virtual clock runs slowly, so it stays leftmost in the tree longer.', '6 × 1024 / ' + WE + ' ≈ ' + f(VRT) + '.'],
    solution: f(VRT), wrong: [6, f(6 * WE / 1024)] });

  const SW = [['A', 5], ['B', 0], ['C', 0]], wsum = SW.reduce((s, [, n]) => s + Sch.weight(n), 0);
  const ctr = Sch.cfs(SW.map(([id, n]) => ({ id, arrive: 0, bursts: [20], nice: n })), { latency: 12, minGran: 2 });
  const sliceOf = (id) => ctr.steps.find((st) => st.run === id).slice;
  const slCells = Object.fromEntries(SW.map(([id]) => [id + '|slice', sliceOf(id)])), slSol = Object.fromEntries(Object.entries(slCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'cpu-x-cfs-slice', chapter: 'cpu-fair', title: 'Slices of the latency', level: 3, kind: 'table',
    text: ['Three jobs are runnable under a CFS-style scheduler with a target latency of 12 ticks and a minimum slice of 2. A has nice 5 (weight ' + Sch.weight(5) + '); B and C have nice 0 (weight 1024). A job\'s slice is latency × its weight / the sum of the runnable weights, but never less than the minimum. Give each job\'s slice, to two decimals.'],
    rows: SW.map(([id]) => id), cols: ['slice'], corner: 'job', cells: slCells, cellKind: 'number', tolerance: 0.01,
    hints: ['Add the three weights first: ' + Sch.weight(5) + ' + 1024 + 1024 = ' + wsum + '.', 'B: 12 × 1024 / ' + wsum + ' ≈ ' + f(12 * 1024 / wsum) + '. A: 12 × ' + Sch.weight(5) + ' / ' + wsum + ' ≈ ' + f(12 * Sch.weight(5) / wsum) + ', which is under the minimum.', 'A: ' + slSol['A|slice'] + ' (the minimum), B: ' + slSol['B|slice'] + ', C: ' + slSol['C|slice'] + '.'],
    solution: slSol, wrong: [Object.assign({}, slSol, { 'A|slice': f(12 * Sch.weight(5) / wsum) }), Object.assign({}, slSol, { 'B|slice': '4', 'C|slice': '4', 'A|slice': '4' })] });

  const CW = W('A 0 5; B 1 2; C 2 6; D 4 1'), CP = [['FCFS', 'fcfs', {}], ['SRTN', 'srtn', {}], ['RR, q = 2', 'rr', { quantum: 2 }]];
  const CR = Object.fromEntries(CP.map(([n, p, o]) => [n, Sch.run(CW, p, o).metrics.avg]));
  const cCells = {};
  for (const [n] of CP) { cCells[n + '|average waiting'] = CR[n].waiting; cCells[n + '|average response'] = CR[n].response; }
  const cSol = Object.fromEntries(Object.entries(cCells).map(([k, v]) => [k, f(v)]));
  C.exercise({ id: 'cpu-x-compare', chapter: 'cpu-fair', title: 'Three policies, one workload', level: 3, kind: 'table',
    text: ['Four jobs: A arrives at 0 needing 5 ticks, B at 1 needing 2, C at 2 needing 6, D at 4 needing 1. Schedule them under FCFS, SRTN and round robin with quantum 2, and give the average waiting and response times of each, to two decimals.'],
    rows: CP.map(([n]) => n), cols: ['average waiting', 'average response'], corner: 'policy', cells: cCells, cellKind: 'number', tolerance: 0.005,
    hints: ['Draw the three charts first; the metrics follow from them. Under FCFS, waiting and response are the same here.', 'Under SRTN, B preempts A at t = 1 and D preempts A at t = 4, each being strictly shorter than what A has left.', CP.map(([n]) => n + ': waiting ' + f(CR[n].waiting) + ', response ' + f(CR[n].response)).join('; ') + '. SRTN wins on waiting, round robin is close on response.'],
    solution: cSol, wrong: [Object.assign({}, cSol, { 'SRTN|average waiting': cSol['FCFS|average waiting'] }), Object.assign({}, cSol, { 'RR, q = 2|average response': cSol['FCFS|average response'] })] });
})(globalThis.Proses = globalThis.Proses || {});
