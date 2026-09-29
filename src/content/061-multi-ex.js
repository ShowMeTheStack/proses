// Part 6, multicore and real-time scheduling: the exercises of chapter 1 (several cores) and the first of chapter 2
// (periodic tasks, RM and EDF). Every chart and number is worked out by the scheduler engine (S.Sched.multi, rt and
// rtAnalysis) when the file loads. Charts of several cores are gantt exercises of policy multi, a row per core; RM and
// EDF are real-time gantt exercises of the task set itself, with every release and deadline marked.
(function (S) {
  'use strict';
  const C = S.Content, Sch = S.Sched, K = S.Check && S.Check.kinds;
  if (!C || !Sch || !K || !K.gantt || C.exercises.has('mrt-x-shared')) return;
  const H = (S.MrtEx = {});
  const f = (v) => String(Math.round(v * 1000) / 1000);
  H.f = f;
  H.W = (s) => s.split(';').map((l) => {
    const [id, a, ...r] = l.trim().split(/\s+/), o = { id, arrive: +a, bursts: [] };
    for (const x of r) { if (x.includes('=')) { const [k, v] = x.split('='); o[k] = k === 'affinity' ? v.split(',').map(Number) : +v; } else o.bursts.push(+x.replace(/[()]/g, '')); }
    return o;
  });
  H.T = (s) => s.split(';').map((l) => { const [id, c, t, d] = l.trim().split(/\s+/); return { id, C: +c, T: +t, D: d ? +d : +t }; });
  H.L = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  /** a multicore trace as a table: {rows, cols, cells} with one row per core and one column per tick (idle ticks left out) */
  H.coreTable = (tr, cores) => {
    const rows = Array.from({ length: cores }, (_, i) => 'core ' + i), cols = Array.from({ length: tr.end }, (_, t) => String(t)), cells = {};
    for (const s of tr.segs) for (let t = s.start; t < s.end; t++) cells['core ' + s.core + '|' + t] = s.warm ? 'w' : String(s.job);
    return { rows, cols, cells };
  };
  H.rowText = (tab, r) => tab.cols.map((c) => tab.cells[r + '|' + c] || '·').join(' ');
  /** the real-time schedule tick by tick, by job name */
  H.rtTicks = (tasks, policy) => { const tr = Sch.rt(tasks, { policy }), out = Array(tr.end).fill('-'); for (const s of tr.segs) for (let t = s.start; t < s.end; t++) out[t] = s.inst; while (out.length && out[out.length - 1] === '-') out.pop(); return out; };
  const W = H.W, T = H.T;

  // =========================================================================================================
  // Chapter 1: several cores
  // =========================================================================================================
  C.exercise({ id: 'mrt-x-shared', chapter: 'mrt-cores', title: 'The price of one shared queue', level: 1, kind: 'choice',
    text: ['A machine with 32 cores keeps a single ready queue that every core takes jobs from. Which of these are real costs of that design? Pick every one that is.'],
    options: ['Every core must lock the one queue to take a job, so the cores contend for the lock', 'A job often runs next on a different core from last time, where its data is not in the cache', 'A core can sit idle while a job waits in the queue', 'Jobs that do I/O can never be scheduled'],
    answer: [0, 1],
    whyNot: { 2: 'That is the weakness of per-core queues. With one shared queue a free core always takes the next job.', 3: 'A job back from I/O simply rejoins the queue.' },
    hints: ['Think about what all 32 cores share, and what a job leaves behind on the core it ran on.', 'One queue means one lock, taken by every core at every decision; and the next free core is rarely the one a job last used.', 'The costs are lock contention and lost cache warmth. Idle cores while work waits is the problem of per-core queues, not of a shared one.'],
    solution: [0, 1], wrong: [[0, 1, 2], [2]] });

  const PL = Sch.multi(W('A 0 6; B 0 2; C 1 4; D 3 3'), { cores: 2, queue: 'per-core', quantum: 2 }), plC = PL.segs.find((s) => s.job === 'C').core;
  C.exercise({ id: 'mrt-x-place', chapter: 'mrt-cores', title: 'Where does a newcomer go?', level: 1, kind: 'choice',
    text: ['Two cores with a ready queue each. A new job goes to the least loaded core, its load being the jobs queued there plus the one running; on a tie, the lower-numbered core. At t = 0, A joins core 0 and B core 1, and both start running. At t = 1, C arrives. Which queue does it join?'],
    options: ['core 0: the loads tie at 1, and the lower number wins', 'core 1: B is shorter, so that core will be free sooner', 'neither: it waits in a shared queue until a core is free'],
    answer: plC === 0 ? 0 : 1,
    whyNot: { 1: 'The placement looks only at the loads, not at how long the running jobs have left.', 2: 'With per-core queues there is no shared queue: every job is placed on a core when it arrives.' },
    hints: ['Count each core\'s load at t = 1: the jobs queued plus the one running.', 'Core 0 is running A with nothing queued: load 1. Core 1 is running B with nothing queued: load 1.', 'A tie, so the lower-numbered core: C joins core 0\'s queue, and first runs there at t = 2.'],
    solution: 0, wrong: [1, 2] });

  const SW = 'A 0 2 (2) 2; B 0 4; C 1 3; D 2 2', SWtxt = 'A arrives at 0, computes 2 ticks, does 2 ticks of I/O and computes 2 more; B arrives at 0 needing 4 ticks; C at 1 needing 3; D at 2 needing 2.';
  const G = K.gantt;
  /** a two-core chart of the workload SW, as a gantt exercise of policy multi (one row a core); its wrong answers are
   *  the other queue design's chart and this chart with the two cores' rows swapped */
  const coreEx = (id, title, level, queue, extra, hints2, otherQueue) => {
    const x = { id, chapter: 'mrt-cores', title, level, kind: 'gantt', workload: W(SW), policy: 'multi', params: { cores: 2, queue, quantum: 2 }, ask: 'chart',
      text: ['Two cores, round robin with a quantum of 2 on each. ' + SWtxt + ' ' + extra + ' Paint each core\'s row tick by tick; leave idle ticks empty.'] };
    x.solution = G.solve(x);
    const other = G.solve(Object.assign({}, x, { params: { cores: 2, queue: otherQueue, quantum: 2 } }));
    x.hints = [hints2[0], hints2[1], 'Core 0: ' + x.solution.lanes[0].join(' ') + '. Core 1: ' + x.solution.lanes[1].join(' ') + ' (- is idle).'];
    x.wrong = [{ lanes: other.lanes }, { lanes: [x.solution.lanes[1], x.solution.lanes[0]] }];
    C.exercise(x);
    return x;
  };
  coreEx('mrt-x-shared-chart', 'Two cores, one shared queue', 2, 'shared', 'There is one shared ready queue: a free core takes its head (core 0 chooses first); new arrivals and jobs back from I/O join the back, ahead of the jobs whose quantum just ended.',
    ['Keep the one queue on paper. At t = 0 core 0 takes A and core 1 takes B.', 'At t = 2, A leaves for I/O and B\'s quantum ends: the queue is then C, D, B, so core 0 takes C and core 1 takes D. A is back at t = 4 and joins the back.'], 'per-core');
  coreEx('mrt-x-percore-chart', 'Two cores, a queue each', 2, 'per-core', 'Each core has its own queue: a newcomer joins the least loaded core (jobs queued plus running; ties to core 0), and a job back from I/O returns to the core it last ran on. At a tick where a quantum ends, newcomers are placed before the preempted job rejoins its queue.',
    ['A joins core 0 and B core 1. At t = 1 C arrives: both cores have load 1 (a running job each), so C joins core 0.', 'At t = 2, A leaves core 0 for I/O (C waits there: load 1), and B\'s quantum has just ended, so it is not yet back in core 1\'s queue (load 0): D joins core 1. At t = 4, A returns to core 0, its old core.'], 'shared');

  const NB = 'A 0 1; B 0 6; C 0 1; D 0 6', NBtxt = 'Two cores with a queue each, round robin with a quantum of 2. Four jobs arrive at t = 0, dealt out in turn: A (1 tick) and C (1 tick) to core 0, B (6 ticks) and D (6 ticks) to core 1.';
  const NB0 = Sch.multi(W(NB), { cores: 2, queue: 'per-core', quantum: 2, pull: false, push: 0 }), NBP = Sch.multi(W(NB), { cores: 2, queue: 'per-core', quantum: 2, pull: true, push: 0 }), NBU = Sch.multi(W(NB), { cores: 2, queue: 'per-core', quantum: 2, pull: false, push: 3 });
  let idle = 0;
  for (const st of NB0.steps) if (st.kind === 'tick') for (const c of st.cores) if (!c.run && st.cores.some((o) => o.id !== c.id && (o.queue || []).length)) idle++;
  C.exercise({ id: 'mrt-x-idle', chapter: 'mrt-cores', title: 'Idle while work waits', level: 2, kind: 'number',
    text: [NBtxt + ' There is no balancing at all: no push, no pull. For how many ticks does a core sit idle while a job waits in the other core\'s queue?'],
    answer: idle,
    whyNot: { [NB0.end - 2]: 'Core 0 idles from t = 2 to the end, but in the last ticks only one job is left on core 1, running, with nothing waiting in its queue.', '*': 'Count the ticks where core 0 has nothing to run and core 1 has a job waiting in its queue, not just running.' },
    hints: ['Core 0 runs A and C, one tick each, and has nothing more from t = 2.', 'Core 1 alternates B and D, 2 ticks at a time: while one runs, the other waits in its queue, until one of them finishes.', 'Core 0 idles from t = 2; a job waits in core 1\'s queue until B finishes at t = ' + NB0.metrics.rows.find((r) => r.id === 'B').finish + ': ' + idle + ' ticks. Everything ends at t = ' + NB0.end + '.'],
    solution: idle, wrong: [NB0.end - 2, 0] });

  C.exercise({ id: 'mrt-x-pull', chapter: 'mrt-cores', title: 'An idle core pulls', level: 2, kind: 'number',
    text: [NBtxt + ' Now a core whose queue is empty pulls the job at the back of the busiest other queue. At what tick are all four jobs done?'],
    answer: NBP.end,
    whyNot: { [NB0.end]: 'That is the finish with no balancing. With pull, core 0 starts taking work from core 1 as soon as it is idle.', '*': 'Draw the two cores tick by tick: from t = 2, core 0 has a job pulled from core 1.' },
    hints: ['Without balancing everything ends at t = ' + NB0.end + ', core 0 idle from t = 2.', 'At t = 2 core 0 is idle and core 1\'s queue holds a job: core 0 pulls it, and from then core 0 always has work.', 'There are 14 ticks of work on 2 cores; core 0 pulls at t = 2 and t = 6, and all is done at t = ' + NBP.end + '.'],
    solution: NBP.end, wrong: [NB0.end, 7] });

  C.exercise({ id: 'mrt-x-push', chapter: 'mrt-cores', title: 'Push or pull?', level: 2, kind: 'choice',
    text: ['The same four jobs, now with a push balancer that runs every 3 ticks (and no pull): everything is done at t = ' + NBU.end + ', as with pull, but core 0 still sits idle for a tick while work waits. Why does push leave idle time that pull avoids?'],
    options: ['A push balancer acts only at its next check, so a core that goes idle between checks waits for it; a pull happens the moment a core is idle', 'Push moves jobs from the least loaded core to the most loaded', 'Push needs a shared queue', 'Push only moves jobs that are running'],
    answer: 0,
    whyNot: { 1: 'It is the other way round: push moves jobs from the most loaded core to the least loaded.', 2: 'Push balances per-core queues; with a shared queue there is nothing to balance.', 3: 'Both push and pull move waiting jobs from a queue; a running job stays where it is.' },
    hints: ['When does each kind of balancing happen?', 'Pull is triggered by the idle core itself, at once. Push is done by a balancer on a timer, every so many ticks.', 'Core 0 goes idle at t = 2, but the balancer next runs at t = 3: that tick is lost. A pull would have taken a job at t = 2.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'mrt-x-affinity', chapter: 'mrt-cores', title: 'Soft and hard affinity', level: 1, kind: 'choice',
    text: ['A database program calls the system to restrict itself to cores 2 and 3 only. Meanwhile, the scheduler on its own tries to run every job on the core it last used. Which is which?'],
    options: ['The program sets hard affinity; the scheduler\'s habit is soft affinity', 'Both are soft affinity', 'The program sets soft affinity; the scheduler\'s habit is hard affinity', 'Both are hard affinity'],
    answer: 0,
    whyNot: { 1: 'A restriction the scheduler must obey is not a mere preference.', 2: 'The program\'s restriction must be obeyed: that is hard. The scheduler\'s preference can be overridden, for instance to balance load: that is soft.', 3: 'The scheduler may still move a job when balancing needs it, so its habit is not hard.' },
    hints: ['Which of the two may the scheduler break when balancing?', 'Its own preference for the last core it may break; a restriction set by the program it may not.', 'The program\'s restriction to cores 2 and 3 is hard affinity; the scheduler\'s preference for the last core used is soft affinity.'],
    solution: 0, wrong: [1, 2] });

  const WM = Sch.multi(W('A 0 5; B 0 3; C 1 4'), { cores: 2, queue: 'shared', quantum: 2, migrate: 1 }), wmTicks = WM.segs.filter((s) => s.warm).reduce((a, s) => a + s.end - s.start, 0), wmTab = H.coreTable(WM, 2);
  C.exercise({ id: 'mrt-x-warm', chapter: 'mrt-cores', title: 'Counting cold caches', level: 3, kind: 'number',
    text: ['Two cores share one ready queue, round robin with a quantum of 2 (core 0 chooses first). A job that starts on a core other than the one it last ran on first spends 1 tick warming that core\'s cache, then goes on with its burst. A arrives at 0 needing 5 ticks, B at 0 needing 3, C at 1 needing 4. How many ticks are spent warming caches in all?'],
    answer: wmTicks,
    whyNot: { 0: 'Jobs do change cores here: with one shared queue, the next free core is often not a job\'s last one.', '*': 'Draw both cores tick by tick, and add a warming tick each time a job starts on a core it did not last run on.' },
    hints: ['A job\'s very first run needs no warming: it has no cache anywhere yet.', 'At t = 2, core 0 takes C (its first run) and core 1 takes the next in the queue, A, which last ran on core 0: a warming tick.', 'Core 0: ' + H.rowText(wmTab, 'core 0') + '; core 1: ' + H.rowText(wmTab, 'core 1') + ' (w marks a warming tick): ' + wmTicks + ' ticks in all, and everything ends at t = ' + WM.end + '.'],
    solution: wmTicks, wrong: [0, WM.migrations.length * 2] });

  // =========================================================================================================
  // Chapter 2: deadlines (periodic tasks, RM and EDF)
  // =========================================================================================================
  const UT = T('A 1 4; B 1 5; C 2 6; D 1 10'), UA = Sch.rtAnalysis(UT);
  C.exercise({ id: 'mrt-x-util', chapter: 'mrt-rt', title: 'How much of the CPU?', level: 1, kind: 'number',
    text: ['Four periodic tasks (C, T): A (1, 4), B (1, 5), C (2, 6) and D (1, 10), each due by the end of its period. What utilisation U do they need together? Give three decimals.'],
    answer: UA.Uexact, tolerance: 0.001,
    whyNot: { 5: 'That is the work of one job of each, not the share of the CPU: divide each C by its T.', '*': 'Add up C / T over the four tasks.' },
    hints: ['U = Σ C / T.', '1/4 + 1/5 + 2/6 + 1/10.', '0.25 + 0.2 + 0.333 + 0.1 ≈ ' + f(UA.Uexact) + '.'],
    solution: f(UA.Uexact), wrong: [5, 0.8] });

  C.exercise({ id: 'mrt-x-hyper', chapter: 'mrt-rt', title: 'When does it repeat?', level: 1, kind: 'number',
    text: ['The same four tasks have periods 4, 5, 6 and 10, all released together at t = 0. After how many ticks does the whole pattern of releases first repeat?'],
    answer: UA.hyper,
    whyNot: { 1200: 'That is the product of the periods; the pattern repeats sooner, at their least common multiple.', 10: 'At 10, task A (period 4) is half-way through a period.', '*': 'Find the least common multiple of 4, 5, 6 and 10.' },
    hints: ['The pattern repeats when every task is at the start of a period again.', 'That happens at the least common multiple of the periods.', 'lcm(4, 5, 6, 10) = ' + UA.hyper + '.'],
    solution: UA.hyper, wrong: [1200, 10] });

  const RT2 = T('A 2 4; B 3 6');
  /** RM or EDF on the task set RT2 up to t = 12, as a real-time gantt exercise (releases and deadlines are marked) */
  const rtEx = (id, title, level, policy, text, hints2, wrongFn) => {
    const x = { id, chapter: 'mrt-rt', title, level, kind: 'gantt', tasks: RT2, policy, params: { horizon: 12 }, metrics: ['finish'], text };
    x.solution = G.solve(x);
    const fin = Object.entries(x.solution.metrics).map(([k, v]) => k.split('|')[0] + ' ' + v).join(', ');
    x.hints = [hints2[0], hints2[1], 'The chart reads ' + x.solution.ticks.join(' ') + '. Finish times: ' + fin + '.' + (hints2[2] ? ' ' + hints2[2] : '')];
    x.wrong = wrongFn(x);
    C.exercise(x);
    return x;
  };
  const other = (x, policy) => G.solve(Object.assign({}, x, { policy }));
  const RMX = rtEx('mrt-x-rm-gantt', 'Rate monotonic by hand', 2, 'rm',
    ['Two periodic tasks: A needs 2 ticks every 4, B needs 3 ticks every 6, each due by the end of its period, both released at t = 0; U = 2/4 + 3/6 = 1. Under rate monotonic, A (the shorter period) always outranks B, so a released A job preempts a B job at once. Paint the schedule up to t = 12, writing the task that runs at each tick, then give each job\'s finish time. A job that misses its deadline carries on, late.'],
    ['A is released at 0, 4 and 8; B at 0 and 6. A\'s jobs run as soon as they are released.', 'A1 runs 0–2 and B1 2–4; at t = 4, A2 preempts B1, which has 1 tick left and is due at 6: B1 finishes late.', 'B1 misses its deadline at 6.'],
    (x) => [other(x, 'edf'), { ticks: x.solution.ticks, metrics: Object.assign({}, x.solution.metrics, { 'B1|finish': '6' }) }]);
  rtEx('mrt-x-edf-gantt', 'EDF by hand', 2, 'edf',
    ['The same two tasks, A (2 ticks every 4) and B (3 ticks every 6), now under earliest deadline first: the job with the earliest absolute deadline runs, and a new job preempts only with a strictly earlier deadline, so on equal deadlines the running job carries on. Paint the schedule up to t = 12, then give each job\'s finish time.'],
    ['Compare absolute deadlines: A1 is due at 4, A2 at 8, A3 at 12; B1 at 6, B2 at 12.', 'At t = 4, A2 (due 8) is released while B1 (due 6) has 1 tick left: B1 is earlier, so it carries on and finishes in time.', 'Every deadline is met, with U = 1.'],
    (x) => [RMX.solution, { ticks: x.solution.ticks, metrics: Object.assign({}, x.solution.metrics, { 'A3|finish': '10' }) }]);

  const MS = T('A 1 4; B 3 6; C 2 8'), msTr = Sch.rt(MS, { policy: 'rm' }), msMiss = msTr.misses.map((m) => m.job), msA = Sch.rtAnalysis(MS);
  C.exercise({ id: 'mrt-x-rm-miss', chapter: 'mrt-rt', title: 'Which jobs are late?', level: 2, kind: 'set',
    text: ['Three tasks under rate monotonic: A (1, 4), B (3, 6) and C (2, 8), as (C, T), each due by the end of its period, all released at t = 0. U = ' + msA.U + '. Over one hyperperiod of ' + msA.hyper + ' ticks, which jobs miss their deadlines? Name jobs by task and number (C1 is C\'s first job), as a set such as {B2, C3}; write {} if none does. A job that misses its deadline carries on, late.'],
    answer: '{' + msMiss.join(', ') + '}',
    hints: ['Under RM, A outranks B, and B outranks C. C runs only when neither A nor B has work.', 'In the first 8 ticks A takes 2 ticks and B takes 5 (all of B1 and two of B2), leaving C1 a single tick before its deadline at 8.', 'The schedule starts ' + H.rtTicks(MS, 'rm').slice(0, 16).join(' ') + ': C1 and C2 both finish late, so the jobs that miss are {' + msMiss.join(', ') + '}. EDF would meet every deadline here, since U = 1.'],
    solution: '{' + msMiss.join(', ') + '}', wrong: ['{}', '{' + msMiss[0] + '}'] });

  C.exercise({ id: 'mrt-x-edf-why', chapter: 'mrt-rt', title: 'Why EDF fits more', level: 1, kind: 'choice',
    text: ['The set A (2, 5), B (4, 7) has U = 0.971. RM misses a deadline of B; EDF meets them all. What does EDF do differently?'],
    options: ['It ranks jobs by their absolute deadlines, so a B job close to its deadline can go ahead of an A job due later', 'It runs the shortest job first', 'It gives B a higher fixed priority than A', 'It never preempts a running job'],
    answer: 0,
    whyNot: { 1: 'EDF looks at deadlines, not at how much work a job needs.', 2: 'EDF has no fixed priorities per task: A\'s jobs go first when they are due first.', 3: 'EDF does preempt, when a job with a strictly earlier deadline is released.' },
    hints: ['Under RM, A always outranks B, whatever the deadlines of the jobs at hand.', 'At t = 5, A2 (due at 10) is released while B1 (due at 7) still has work left.', 'EDF ranks jobs by absolute deadline: B1, due at 7, runs before A2, due at 10, and meets its deadline. With D = T, EDF meets every set with U ≤ 1.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
