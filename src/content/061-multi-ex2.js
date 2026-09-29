// Part 6, multicore and real-time scheduling: the rest of the exercises of chapter 2 (overload, the RM bound,
// response-time analysis, processor demand) and those of chapter 3 (priority inversion). As in 061-multi-ex.js, every
// value is worked out by the engine (S.Sched.rt, rtAnalysis and inversion) when the file loads, with the helpers that
// file leaves on S.MrtEx.
(function (S) {
  'use strict';
  const C = S.Content, Sch = S.Sched, H = S.MrtEx;
  if (!C || !Sch || !H || C.exercises.has('mrt-x-overload')) return;
  const T = H.T, f = H.f;
  const tasksText = (tk) => tk.map((k) => k.id + ' (' + k.C + ', ' + k.T + (k.D !== k.T ? ', ' + k.D : '') + ')').join(', ');

  // =========================================================================================================
  // Chapter 2: deadlines (overload and the tests)
  // =========================================================================================================
  C.exercise({ id: 'mrt-x-overload', chapter: 'mrt-rt', title: 'More work than time', level: 2, kind: 'choice',
    text: ['Two periodic tasks need 2 ticks every 4 and 3 ticks every 5, each due by the end of its period: U = 0.5 + 0.6 = 1.1. Which statement is true?'],
    options: ['Every policy misses some deadline: the tasks need more CPU than there is', 'EDF meets every deadline, because it is optimal', 'RM meets every deadline if the periods are harmonic', 'Only the task with the longer period can miss'],
    answer: 0,
    whyNot: { 1: 'EDF is optimal among policies on one CPU, but no policy can do 1.1 CPUs of work on one CPU.', 2: 'Harmonic periods let RM reach U = 1, not beyond; and 4 and 5 are not harmonic anyway.', 3: 'Under EDF the misses can fall on either task; in the topic, EDF missed two of A\'s jobs on this very set.' },
    hints: ['What does U > 1 mean in ticks of work against ticks of time?', 'Over the hyperperiod of 20, the tasks release 5 × 2 + 4 × 3 = 22 ticks of work, and only 20 ticks pass.', 'Every policy must miss: there is more work than time. Which jobs miss depends on the policy: EDF missed A4 and A5, RM missed all four of B\'s jobs.'],
    solution: 0, wrong: [1, 3] });

  const OV = T('A 1 2; B 3 5'), ovTr = Sch.rt(OV, { policy: 'edf' }), ovMiss = ovTr.misses.map((m) => m.job), ovA = Sch.rtAnalysis(OV);
  C.exercise({ id: 'mrt-x-edf-overload', chapter: 'mrt-rt', title: 'Where EDF\'s misses fall', level: 2, kind: 'set',
    text: ['Two tasks under EDF: A needs 1 tick every 2, B needs 3 ticks every 5, each due by the end of its period, all released at t = 0; U = ' + ovA.U + '. A job that misses its deadline carries on, late. On equal deadlines the job released first goes first. Over the hyperperiod of ' + ovA.hyper + ' ticks, which jobs miss? Write a set such as {A3, B1}.'],
    answer: '{' + ovMiss.join(', ') + '}',
    hints: ['List every job with its absolute deadline: A1 due 2, A2 due 4, A3 due 6, A4 due 8, A5 due 10; B1 due 5, B2 due 10.', 'Run the earliest deadline at each tick. At t = 8, A5 and the unfinished B2 are both due at 10: B2, released first, goes first.', 'The schedule is ' + H.rtTicks(OV, 'edf').join(' ') + ', and the jobs that miss are {' + ovMiss.join(', ') + '}.'],
    solution: '{' + ovMiss.join(', ') + '}', wrong: ['{}', '{' + Sch.rt(OV, { policy: 'rm' }).misses.map((m) => m.job).join(', ') + '}'] });

  const B4 = Sch.rtAnalysis(T('A 1 4; B 1 5; C 2 6; D 1 10'));
  C.exercise({ id: 'mrt-x-bound', chapter: 'mrt-rt', title: 'The RM bound for four tasks', level: 1, kind: 'number',
    text: ['The rate-monotonic utilisation bound for n tasks is n(2^(1/n) − 1). What is it for 4 tasks? Give three decimals.'],
    answer: B4.bound, tolerance: 0.001,
    whyNot: { 0.693: 'That is the limit as n grows without end; for 4 tasks the bound is a little higher.', 1: 'That is the bound for a single task.', '*': 'Work out 4 × (2^0.25 − 1).' },
    hints: ['2^(1/4) is the fourth root of 2, about 1.1892.', '4 × (1.1892 − 1) = 4 × 0.1892.', 'About ' + B4.bound + '. A set of four tasks with U at or under ' + B4.bound + ' is sure to meet every deadline under RM.'],
    solution: B4.bound, wrong: [0.693, 1] });

  const RS = T('A 1 4; B 2 5; C 3 10'), RA = Sch.rtAnalysis(RS);
  C.exercise({ id: 'mrt-x-bound-verdict', chapter: 'mrt-rt', title: 'Over the bound: now what?', level: 2, kind: 'choice',
    text: ['Three tasks ' + tasksText(RS) + ' (C, T), deadlines equal to periods, have U = ' + RA.U + ', above the RM bound for three tasks, ' + RA.bound + '. What can you conclude about RM?'],
    options: ['Nothing yet: the bound is sufficient, not necessary, so an exact test such as response-time analysis must decide', 'RM must miss some deadline', 'RM meets every deadline, since U ≤ 1', 'Only EDF can be used'],
    answer: 0,
    whyNot: { 1: 'Sets above the bound often work under RM; the bound only promises success below it.', 2: 'U ≤ 1 is the test for EDF, not for RM: some sets with U < 1 do miss under RM.', 3: 'EDF would certainly work (U ≤ 1), but RM may work too: test it.' },
    hints: ['What does the bound promise, and what does it not?', 'Under the bound: success is sure. Over it: the bound says nothing either way.', 'Nothing yet: run response-time analysis. For this set it finds every task in time (R = ' + RA.rta.map((r) => r.id + ' ' + r.R).join(', ') + '), so RM does meet every deadline.'],
    solution: 0, wrong: [1, 2] });

  const rtaCells = Object.fromEntries(RA.rta.map((r) => [r.id + '|R', r.R])), rtaSol = Object.fromEntries(Object.entries(rtaCells).map(([k, v]) => [k, String(v)]));
  const rtC = RA.rta.find((r) => r.id === 'C');
  C.exercise({ id: 'mrt-x-rta', chapter: 'mrt-rt', title: 'Response-time analysis', level: 2, kind: 'table',
    text: ['The same three tasks, ' + tasksText(RS) + ', under RM (A most urgent, then B, then C). For each task, iterate R = C + Σ ⌈R / T_j⌉ · C_j over the more urgent tasks j, starting from R = C, until R stops changing. Give each task\'s final R.'],
    rows: RA.rta.map((r) => r.id), cols: ['R'], corner: 'task', cells: rtaCells, cellKind: 'number',
    hints: ['A has nothing above it: R = C. For B, only A interferes.', 'B: R = 2, then 2 + ⌈2/4⌉ × 1 = 3, then 2 + ⌈3/4⌉ × 1 = 3: stable.', 'R: ' + RA.rta.map((r) => r.id + ' ' + r.R).join(', ') + '. C\'s iterations go ' + rtC.iterations.join(' → ') + ', exactly at its deadline of 10: every task is in time.'],
    solution: rtaSol, wrong: [Object.fromEntries(RS.map((k) => [k.id + '|R', String(k.C)])), Object.assign({}, rtaSol, { 'C|R': String(rtC.iterations[1]) })] });

  const LS = T('A 2 5; B 2 7; C 3 12'), LA = Sch.rtAnalysis(LS), lc = LA.rta.find((r) => r.id === 'C');
  C.exercise({ id: 'mrt-x-rta-late', chapter: 'mrt-rt', title: 'A task that can be late', level: 3, kind: 'number',
    text: ['Tasks ' + tasksText(LS) + ' (C, T), deadlines equal to periods, under RM. U = ' + LA.U + '. Run response-time analysis for the least urgent task, C: what is its worst-case response time R?'],
    answer: lc.R,
    whyNot: { [lc.iterations[1]]: 'That is only the first step: the window grew, so check it again with the new length.', 12: 'R is not capped at the deadline: keep iterating until it stops changing.', '*': 'Iterate R = 3 + ⌈R/5⌉ × 2 + ⌈R/7⌉ × 2, starting from 3, until it repeats.' },
    hints: ['C has A and B above it: R = 3 + ⌈R/5⌉ × 2 + ⌈R/7⌉ × 2.', 'Start with R = 3: the next value is 3 + 2 + 2 = 7. Keep going.', 'R goes ' + lc.iterations.join(' → ') + ' and settles at ' + lc.R + ', past the deadline of 12: C can miss. (The schedule bears it out: C1 misses at t = 12.)'],
    solution: lc.R, wrong: [lc.iterations[1], 12] });

  const DS = T('A 1 3 2; B 2 6 4; C 1 6 3'), DA = Sch.rtAnalysis(DS), DL = [2, 3, 4, 5, 8];
  const dem = Object.fromEntries(DL.map((L) => [L, DA.demand.find((d) => d.L === L).demand]));
  const dCells = Object.fromEntries(DL.map((L) => ['demand|L = ' + L, dem[L]])), dSol = Object.fromEntries(Object.entries(dCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'mrt-x-demand', chapter: 'mrt-rt', title: 'Processor demand at each deadline', level: 3, kind: 'table',
    text: ['Three tasks (C, T, D) with deadlines before their periods: ' + tasksText(DS) + '. The demand at L is the work of every job both released and due within [0, L]: Σ max(0, ⌊(L − D) / T⌋ + 1) · C. Give the demand at L = ' + DL.join(', ') + '.'],
    rows: ['demand'], cols: DL.map((L) => 'L = ' + L), corner: '', cells: dCells, cellKind: 'number',
    hints: ['Count, for each task, how many of its jobs have their deadline at or before L: the k-th job of a task is due at (k − 1)T + D.', 'At L = 4: A\'s first job is due at 2 (the second at 5), B\'s first at 4, C\'s first at 3: demand 1 + 2 + 1 = 4.', 'Demand: ' + DL.map((L) => dem[L] + ' at ' + L).join(', ') + '. It never exceeds L, so EDF meets every deadline of this set.'],
    solution: dSol, wrong: [Object.fromEntries(DL.map((L) => ['demand|L = ' + L, String(L)])), Object.assign({}, dSol, { 'demand|L = 4': '3' })] });

  // =========================================================================================================
  // Chapter 3: priority inversion
  // =========================================================================================================
  /** 'L 4 0: run 2, lock m, run 3, unlock m' -> tasks for S.Sched.inversion */
  const P = (s) => s.split(';').map((l) => { const [head, body] = l.split(':'); const [id, prio, arrive] = head.trim().split(/\s+/); return { id, prio: +prio, arrive: +arrive, script: body.split(',').map((x) => x.trim().split(/\s+/)).map(([op, a]) => (op === 'run' ? ['run', +a] : [op, a])) }; });
  const ptable = (tk) => ({ table: [['Task', 'Priority', 'Arrives', 'Script']].concat(tk.map((k) => [k.id, String(k.prio), String(k.arrive), k.script.map(([op, a]) => op + ' ' + a).join(', ')])), caption: 'A lower priority number is more urgent. run n: compute n ticks; lock and unlock take no time.' });
  const chartOf = (tr) => { const out = Array(tr.end).fill('-'); for (const g of tr.segs) for (let t = g.start; t < g.end; t++) out[t] = g.job; return out; };
  const row = (tr, id) => tr.metrics.rows.find((r) => r.id === id);

  C.exercise({ id: 'mrt-x-inversion', chapter: 'mrt-inv', title: 'Which wait is the problem?', level: 1, kind: 'choice',
    text: ['H (urgent) blocks on a mutex held by L (unimportant). Two things can then make H wait. Which of them is the unbounded priority inversion that the protocols are designed to stop?'],
    options: ['M, a middle-priority task that needs no mutex, preempts L and runs for as long as it likes while H waits', 'L finishes the rest of its critical section before releasing the mutex', 'H waits for its own I/O'],
    answer: 0,
    whyNot: { 1: 'That wait is bounded by the length of L\'s critical section, and it is the price of mutual exclusion: no protocol can avoid it.', 2: 'Waiting for a device has nothing to do with priorities or mutexes.' },
    hints: ['Which of the waits has a limit you can state in advance?', 'L\'s critical section has a known length. M\'s run, and the runs of any other middle tasks, do not depend on the mutex at all.', 'The middle task preempting the holder: H then waits for work that has nothing to do with the mutex, with no bound. Inheritance and the ceiling both lift L above M to stop it.'],
    solution: 0, wrong: [1, 2] });

  const P2 = P('L 3 0: run 1, lock m, run 3, unlock m; H 1 2: run 1, lock m, run 2, unlock m; M 2 3: run 3');
  const p2n = Sch.inversion(P2, { protocol: 'none' }), p2i = Sch.inversion(P2, { protocol: 'inherit' }), p2c = Sch.inversion(P2, { protocol: 'ceiling' });
  C.exercise({ id: 'mrt-x-pi-none', chapter: 'mrt-inv', title: 'Inverted, with no protocol', level: 2, kind: 'number',
    text: ['Three tasks share one CPU, scheduled preemptively by priority, with no protocol for the mutex m.', ptable(P2), 'For how many ticks in all is H kept waiting (ready or blocked) while a task of less urgent priority runs?'],
    answer: row(p2n, 'H').inversion,
    whyNot: { [row(p2n, 'H').inversion - 3]: 'That counts only L\'s critical section. While H is blocked, M runs too, and M is less urgent than H.', '*': 'Draw the schedule tick by tick, and count the ticks in which H waits while L or M runs.' },
    hints: ['L locks m at t = 1. H arrives at 2, runs a tick, and blocks on m at t = 3.', 'At t = 3, M arrives: with H blocked, M (priority 2) outranks L and runs all 3 of its ticks before L can finish its critical section.', 'The schedule is ' + chartOf(p2n).join(' ') + '. H waits from t = 3 until L unlocks at t = ' + (row(p2n, 'H').finish - 2) + ': ' + row(p2n, 'H').inversion + ' ticks, 3 of them M\'s.'],
    solution: row(p2n, 'H').inversion, wrong: [row(p2n, 'H').inversion - 3, 0] });

  const ich = chartOf(p2i), pcCells = Object.fromEntries(ich.map((j, t) => ['CPU|' + t, j])), pcSol = Object.assign({}, pcCells);
  C.exercise({ id: 'mrt-x-pi-chart', chapter: 'mrt-inv', title: 'The same tasks, with inheritance', level: 3, kind: 'table',
    text: ['The same three tasks, now with priority inheritance: while H is blocked on m, L runs at H\'s priority, 1.', ptable(P2), 'Fill in which task runs at each tick.'],
    rows: ['CPU'], cols: ich.map((_, t) => String(t)), corner: 'tick', cells: pcCells, cellKind: 'text',
    hints: ['Up to t = 3 nothing changes: L runs and locks m, H arrives at 2 and blocks on m at t = 3.', 'At t = 3, L inherits priority 1, so M, arriving then, cannot preempt it. L finishes its critical section and unlocks; H takes m.', 'The schedule is ' + ich.join(' ') + '. H finishes at ' + row(p2i, 'H').finish + ' instead of ' + row(p2n, 'H').finish + ', and M at ' + row(p2i, 'M').finish + ' instead of ' + row(p2n, 'M').finish + '.'],
    solution: pcSol, wrong: [Object.fromEntries(chartOf(p2n).map((j, t) => ['CPU|' + t, j])), Object.fromEntries(chartOf(p2c).map((j, t) => ['CPU|' + t, j]))] });

  const P1 = P('L 4 0: run 2, lock m, run 3, unlock m, run 1; M 2 3: run 4; H 1 4: run 1, lock m, run 1, unlock m, run 1'), PROTO = [['no protocol', 'none'], ['inheritance', 'inherit'], ['ceiling', 'ceiling']];
  const p1 = Object.fromEntries(PROTO.map(([n, p]) => [n, Sch.inversion(P1, { protocol: p })]));
  const ptCells = {};
  for (const [n] of PROTO) { ptCells[n + '|H finishes'] = row(p1[n], 'H').finish; ptCells[n + '|M finishes'] = row(p1[n], 'M').finish; }
  const ptSol = Object.fromEntries(Object.entries(ptCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'mrt-x-pi-table', chapter: 'mrt-inv', title: 'Three protocols, one task set', level: 2, kind: 'table',
    text: ['Three tasks share one CPU and one mutex m.', ptable(P1), 'Under the priority ceiling, m\'s ceiling is 1 (H locks it), so L runs at priority 1 from the moment it locks m. Give the times at which H and M finish under each protocol.'],
    rows: PROTO.map(([n]) => n), cols: ['H finishes', 'M finishes'], corner: 'protocol', cells: ptCells, cellKind: 'number',
    hints: ['Draw three schedules. They agree until L locks m at t = 2.', 'No protocol: M preempts L at 3; H blocks on m at 5 and M runs on. Inheritance: when H blocks, L rises to 1 and finishes its section first. Ceiling: L is at 1 from t = 2, so neither M nor H can preempt it.', PROTO.map(([n]) => n + ': ' + chartOf(p1[n]).join(' ') + ' (H ' + row(p1[n], 'H').finish + ', M ' + row(p1[n], 'M').finish + ')').join('; ') + '.'],
    solution: ptSol, wrong: [Object.fromEntries(PROTO.map(([n]) => [[n + '|H finishes', ptSol['no protocol|H finishes']], [n + '|M finishes', ptSol['no protocol|M finishes']]]).flat()), Object.assign({}, ptSol, { 'ceiling|H finishes': ptSol['inheritance|H finishes'] })] });

  const P3 = P('L 4 0: run 1, lock a, run 4, unlock a, run 1; K 3 1: run 1, lock b, run 1, lock a, run 1, unlock a, run 2, unlock b, run 1; M 2 4: run 5; H 1 5: run 1, lock b, run 2, unlock b, run 1');
  const ceil = {};
  for (const k of P3) for (const [op, m] of k.script) if (op === 'lock') ceil[m] = Math.min(ceil[m] === undefined ? 99 : ceil[m], k.prio);
  const mx = Object.keys(ceil).sort(), cCells = Object.fromEntries(mx.map((m) => [m + '|ceiling', ceil[m]])), cSol = Object.fromEntries(Object.entries(cCells).map(([k, v]) => [k, String(v)]));
  C.exercise({ id: 'mrt-x-ceiling', chapter: 'mrt-inv', title: 'Ceilings of two mutexes', level: 1, kind: 'table',
    text: ['Under the priority ceiling protocol, a mutex\'s ceiling is the most urgent priority of any task whose script locks it (a lower number is more urgent).', ptable(P3), 'Give the ceiling of each mutex.'],
    rows: mx, cols: ['ceiling'], corner: 'mutex', cells: cCells, cellKind: 'number',
    hints: ['List, for each mutex, the tasks that lock it.', 'a is locked by L (4) and K (3); b by K (3) and H (1). M locks nothing.', mx.map((m) => m + ': ' + ceil[m]).join(', ') + '. A task that locks b runs at priority 1 until it unlocks it.'],
    solution: cSol, wrong: [Object.fromEntries(mx.map((m) => [m + '|ceiling', String(Math.max(...P3.filter((k) => k.script.some(([op, x]) => op === 'lock' && x === m)).map((k) => k.prio)))])), Object.assign({}, cSol, { 'a|ceiling': '1' })] });

  const p3i = Sch.inversion(P3, { protocol: 'inherit' }), p3n = Sch.inversion(P3, { protocol: 'none' }), p3c = Sch.inversion(P3, { protocol: 'ceiling' }), hb = row(p3i, 'H').blockedOnMutex;
  C.exercise({ id: 'mrt-x-chain', chapter: 'mrt-inv', title: 'Inheritance through a chain', level: 3, kind: 'number',
    text: ['The same four tasks, under priority inheritance. H needs b, which K may hold; K, while holding b, needs a, which L may hold. Inheritance passes along the chain: a task blocked on a mutex lends its priority to the holder, and on to whatever that holder is blocked on.', ptable(P3), 'For how many ticks in all is H blocked on a mutex?'],
    answer: hb,
    whyNot: { [row(p3n, 'H').blockedOnMutex]: 'That is with no protocol: M then runs while H waits. Under inheritance, K and L are lifted above M.', 0: 'That is what the ceiling achieves here; under inheritance H still has to wait for K and L to clear the chain.', '*': 'Draw the schedule with the inherited priorities, and count the ticks from H\'s lock attempt until it gets b.' },
    hints: ['L locks a at t = 1; K arrives, locks b at 2 and blocks on a at 3. M arrives at 4 and H at 5.', 'When H blocks on b, K (the holder) inherits priority 1, and since K is blocked on a, L inherits it too: L runs ahead of M, unlocks a, then K finishes with b.', 'The schedule is ' + chartOf(p3i).join(' ') + '. H is blocked for ' + hb + ' ticks and finishes at ' + row(p3i, 'H').finish + '; with no protocol, ' + row(p3n, 'H').blockedOnMutex + ' ticks; with the ceiling, H finishes at ' + row(p3c, 'H').finish + '.'],
    solution: hb, wrong: [row(p3n, 'H').blockedOnMutex, 0] });
})(globalThis.Proses = globalThis.Proses || {});
