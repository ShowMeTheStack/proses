// Part 5, CPU scheduling: the chapters, and the lessons of the first two (bursts, metrics and first come, first
// served; shortest first, prediction and priorities). The lessons of chapters 3 and 4 are in 050-sched2.js, the
// exercises in 051-sched-ex.js and 051-sched-ex2.js, and the challenges, tour, course and the pages the diagram checker
// looks at in 052-sched-ch.js. Each lesson opens with a situation, runs a topic at a frame chosen for the point being
// made, asks for a prediction, sums up and leads to its exercises. Every value quoted was read from the topics' own
// runs (the scheduler engine S.Sched) on the inputs named in each block.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'cpu-model')) return;

  C.chapter({ id: 'cpu-model', part: 'scheduling', n: 1, title: 'Bursts, metrics and the queue', blurb: 'What a scheduler chooses among, how a schedule is measured, and first come, first served with the convoy it builds.' });
  C.chapter({ id: 'cpu-short', part: 'scheduling', n: 2, title: 'Shortest first and priorities', blurb: 'Shortest job first and its preemptive form, guessing a burst nobody knows yet, and priorities with starvation and aging.' });
  C.chapter({ id: 'cpu-slices', part: 'scheduling', n: 3, title: 'Time slices and feedback', blurb: 'Round robin and the size of its quantum, fixed classes of queues, and the multilevel feedback queue that learns, with the rules that keep it honest.' });
  C.chapter({ id: 'cpu-fair', part: 'scheduling', n: 4, title: 'Fair shares', blurb: 'Lottery and stride scheduling, a fair scheduler with weights and virtual runtime, and every policy on one workload.' });

  const X = (id) => ({ exercise: id });
  // a row of the Scheduler lab's workload table
  const R = (id, arrive, bursts, more) => Object.assign({ id, arrive, bursts, prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' }, more || {});
  const cmp = (pols, more) => Object.assign({ mode: 'compare', pol1: pols[0] || 'fcfs', pol2: pols[1] || 'none', pol3: pols[2] || 'none', pol4: pols[3] || 'none' }, more || {});
  const lab = (title, text, setup) => ({ lab: 'scheduler', title, text, setup });
  /** the frames of a topic run on an input (empty when the topic is missing) */
  const framesOf = (id, input) => { const t = S.byId && S.byId(id); return t ? t.run(S.inputOf(t, input || {})).frames : []; };
  const SR = framesOf('sch-srtn'), srA = (SR[1] && SR[1].meta.left) || { B: 5, A: 6 }, srB = (SR[2] && SR[2].meta.left) || { B: 4, C: 8 };
  const srCmp = (SR[SR.length - 1] && SR[SR.length - 1].meta) || { a: { waiting: 6, response: 4 }, b: { waiting: 6.5, response: 6.5 } };
  const PR = framesOf('sch-predict'), PRin = (() => { const t = S.byId && S.byId('sch-predict'); return t ? S.inputOf(t) : { tau0: 8 }; })();
  const pb = (k) => (PR[k] && PR[k].meta.p) || {}, pr1 = pb(1), pr5 = pb(5);
  const prErr = (a) => { const f = framesOf('sch-predict', a === undefined ? {} : { alpha: a }); return f.length ? Math.round(f[f.length - 1].meta.err * 100) / 100 : 0; };
  const prMax = Math.max(...PR.filter((f) => f.meta && f.meta.p).map((f) => f.meta.p.next));
  const prBig = Math.max(...PR.filter((f) => f.meta && f.meta.p).map((f) => f.meta.p.actual));
  const CONVOY = [R('A', 0, [11]), R('B', 1, [2]), R('C', 2, [3]), R('D', 3, [1])];

  // =========================================================================================================
  // Chapter 1: bursts, metrics and the queue
  // =========================================================================================================
  C.lesson({
    id: 'cpu-bursts', chapter: 'cpu-model', title: 'Computing, then waiting', minutes: 7,
    summary: 'A running program alternates between CPU bursts, when it needs the processor, and I/O bursts, when it waits for a device and needs nothing. The scheduler chooses only among jobs that are ready; a job in I/O is away. Keeping several jobs in memory lets one compute while another waits for its device.',
    blocks: [
      'A text editor spends most of its life waiting for the next key; a compiler computes for seconds without a pause. Both are on the same machine, with one processor. When the editor is waiting, does it need the CPU at all? And who decides which of them runs next?',
      { def: 'CPU burst, I/O burst', text: 'a stretch of time in which a job computes and needs the processor (a CPU burst), or waits for a device and needs nothing from the scheduler (an I/O burst). A job is a list of bursts: CPU, I/O, CPU, ..., CPU.' },
      { def: 'ready queue', text: 'the jobs that could compute right now if they had the processor. A scheduler only ever chooses among them: a running job is already on the CPU, a blocked job is waiting for its device.' },
      { topic: 'sch-bursts', input: { pol: 'fcfs' }, frame: 1, caption: 'Four jobs under first come, first served. At t = 3, A starts an I/O burst that lasts until t = 7, and B runs, first in the ready queue [B, C]. A is not in the queue at all: it is away at its device.' },
      { predict: { q: 'At t = 23, C starts an I/O burst until t = 26, and every other job has finished. What does the CPU do for those three ticks?', options: ['It runs C anyway, to save time later', 'It idles: nothing is ready', 'It runs the job that finished last again'], answer: 1, explain: 'A job in I/O cannot use the processor, and no other job is left. The CPU idles until C comes back at t = 26.' } },
      { topic: 'sch-bursts', input: { pol: 'fcfs' }, frame: 6, caption: 't = 23: C goes to its device and the ready queue is empty, so the CPU idles until C is back at t = 26.' },
      { topic: 'sch-bursts', input: { pol: 'fcfs' }, frame: 8, caption: 'All done at t = 27. The CPU computed for 24 of the 27 ticks, and for 7 of them another job was doing I/O at the same time: that overlap is the point of keeping several programs in memory. A and C, with short CPU bursts, are I/O-bound; B and D are CPU-bound.' },
      { table: [['State', 'Where the job is', 'Can the scheduler pick it?'], ['running', 'on the CPU', 'it already has it'], ['ready', 'in the ready queue', 'yes'], ['blocked', 'waiting for a device (an I/O burst)', 'no']], caption: 'The three states a scheduler sees.' },
      { tip: 'A job that does a lot of I/O and computes little (I/O-bound) should be let in quickly: it will soon block again, and its device works while others compute. Many of the policies in this part are ways of noticing such jobs.' },
      { h: 'Recap' },
      { list: ['A job alternates CPU bursts and I/O bursts, starting and ending with CPU.', 'The scheduler picks among ready jobs only; a job in I/O is away.', 'With several jobs, one can compute while another waits for its device: the CPU stays busy.'] },
      X('cpu-x-ready'), X('cpu-x-overlap'),
    ],
  });

  C.lesson({
    id: 'cpu-metrics', chapter: 'cpu-model', title: 'Measuring a schedule', minutes: 8,
    summary: 'Turnaround is finish minus arrival; waiting is the part of it spent in the ready queue (turnaround less CPU and I/O time); response is the wait until the first tick on the CPU. Throughput counts jobs finished per tick, and utilisation the share of time the CPU did useful work.',
    blocks: [
      'Two schedules of the same jobs both finish at t = 22. Is one better than the other? It depends on what you ask: when each job is done, how long each one sat idle, or how quickly each got its first slice of the CPU.',
      { def: 'turnaround, waiting, response', text: 'turnaround = finish − arrival. waiting = turnaround − CPU time − I/O time: the time spent ready but not running. response = the first tick on the CPU − arrival: how long before the job shows any sign of life.' },
      { topic: 'sch-metrics', input: { pol: 'fcfs' }, frame: 0, caption: 'Five jobs under FCFS, finished at t = 22. Each lane is one job: coloured where it ran, pink where it waited.' },
      { topic: 'sch-metrics', input: { pol: 'fcfs' }, frame: 3, caption: 'C arrives at 4, first runs at 9 and finishes at 16: turnaround 16 − 4 = 12, waiting 12 − 7 = 5, response 9 − 4 = 5.' },
      { predict: { q: 'D arrives at 5, first runs at 16 and finishes at 18; it needs 2 ticks of CPU and no I/O. What is its waiting time?', options: ['2', '11', '13'], answer: 1, explain: 'Turnaround is 18 − 5 = 13; take away its 2 ticks of computing and 11 is left, all of it in the ready queue.' } },
      { topic: 'sch-metrics', input: { pol: 'fcfs' }, frame: 6, caption: 'The sums: turnaround averages 10.4, waiting 6 and response 6. With no I/O, FCFS runs each job straight through once it starts, so here every job\'s waiting equals its response.' },
      { topic: 'sch-metrics', input: { pol: 'rr' }, frame: 6, caption: 'The same jobs under round robin, quantum 2: average response falls from 6 to 2.2, but turnaround rises from 10.4 to 11 and waiting from 6 to 6.6. The metrics pull in different directions.' },
      { topic: 'sch-metrics', input: { work: 'A 0 3\nB 6 4\nC 7 2', pol: 'fcfs' }, frame: 5, caption: 'Throughput and utilisation: 3 jobs in 12 ticks is 0.25 jobs a tick, and with nobody to run from t = 3 to t = 6 the CPU worked 9 of 12 ticks, a utilisation of 75%.' },
      { table: [['Metric', 'Who cares about it'], ['turnaround', 'a batch job\'s owner: when is my result ready?'], ['waiting', 'the scheduler itself: how long do jobs sit ready but idle?'], ['response', 'someone at a keyboard: how soon does it react?'], ['throughput, utilisation', 'whoever pays for the machine']], caption: 'Each metric answers someone\'s question.' },
      { h: 'Recap' },
      { list: ['turnaround = finish − arrival', 'waiting = turnaround − CPU − I/O', 'response = first run − arrival', 'Averages compare schedules; no single policy is best at all of them.'] },
      X('cpu-x-metrics'), X('cpu-x-util'),
    ],
  });

  C.lesson({
    id: 'cpu-fcfs', chapter: 'cpu-model', title: 'First come, first served', minutes: 7,
    summary: 'FCFS runs the job at the head of the ready queue until its burst ends. It is simple and fair in one sense, but a long burst at the head makes every short job behind it wait: the convoy effect. The same jobs in another order can have a far smaller average wait.',
    blocks: [
      'At a supermarket with one till, the person in front has a full trolley and you hold a single carton of milk. Nobody is cheating, and yet three of you wait far longer than the work in front of you deserves. A scheduler that serves strictly in order of arrival has the same problem.',
      { def: 'FCFS (first come, first served)', text: 'the job at the head of the ready queue runs until its CPU burst ends; jobs join the queue at the back when they arrive or come back from I/O. It never preempts.' },
      { topic: 'sch-fcfs', frame: 0, caption: 'A arrives first, with an 11-tick burst; B, C and D, each 3 ticks or less, arrive just after it.' },
      { topic: 'sch-fcfs', frame: 4, caption: 'All done at t = 17. Waiting times 0 + 10 + 11 + 13: an average of 8.5. B, C and D sat behind A\'s burst for 27 job-ticks in all: a convoy.' },
      { predict: { q: 'Now the same four jobs arrive so that the long one, A, comes last (B at 0, C at 1, D at 2, A at 3). What happens to the average wait under FCFS?', options: ['It stays 8.5: the same work is done', 'It falls a long way', 'It rises: A now waits'], answer: 1, explain: 'The short jobs are now served first and A waits only for them: the average waiting time falls from 8.5 to 1.75.' } },
      { topic: 'sch-fcfs', input: { work: 'A 3 11\nB 0 2\nC 1 3\nD 2 1' }, frame: 4, caption: 'With the long job last, waiting times are 3, 0, 1 and 3, an average of 1.75. Same jobs, same policy: only the order changed.' },
      { topic: 'sch-fcfs', frame: 5, caption: 'Back to the convoy: shortest burst first would have cut the average wait from 8.5 to 7.75 even here, where A was already running before the others arrived.' },
      lab('A convoy, three ways', 'The convoy workload under FCFS, SJF and round robin side by side, with the convoy flagged.', cmp(['fcfs', 'sjf', 'rr'], { q3: 2, work: CONVOY })),
      { warn: 'A convoy also hurts the devices: while a CPU-bound job holds the processor, I/O-bound jobs queue behind it instead of starting their next I/O, so the disks sit idle too.' },
      { h: 'Recap' },
      { list: ['FCFS runs each burst to its end, in order of arrival.', 'One long burst at the head makes every short job wait: the convoy effect.', 'Average waiting depends strongly on the order of the jobs.'] },
      X('cpu-x-fcfs'), X('cpu-x-fcfs-io'), X('cpu-x-convoy'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: shortest first and priorities
  // =========================================================================================================
  C.lesson({
    id: 'cpu-sjf', chapter: 'cpu-short', title: 'Shortest first', minutes: 8,
    summary: 'Shortest job first (SJF) picks the ready job with the shortest next CPU burst and lets it run to the end of that burst; when the jobs are all ready together, no order that never preempts gives a smaller average wait. Shortest remaining time next (SRTN) also preempts when a job arrives with strictly less to do than the running job has left. Both can starve a long job.',
    blocks: [
      'If the till could see what everyone holds, serving the smallest basket first would get the most people out quickly. The scheduler\'s version: look at the next CPU burst of every ready job and run the shortest.',
      { def: 'SJF and SRTN', text: 'SJF: the ready job with the shortest next CPU burst runs until that burst ends. SRTN (shortest remaining time next): the same, but a job that becomes ready with strictly less than the running job has left preempts it. Ties go to the job that has waited longest.' },
      { topic: 'sch-sjf', frame: 1, caption: 'Under SJF, at t = 6 A finishes, and D runs: its burst of 2 is the shortest of B (3), C (7) and D (2).' },
      { topic: 'sch-sjf', frame: 6, caption: 'The same five jobs under FCFS wait 6 ticks on average; under SJF, 4.2. Turnaround falls from 10.4 to 8.6.' },
      { topic: 'sch-srtn', frame: 1, caption: 'SRTN: at t = 1, B arrives needing ' + srA.B + ' while A has ' + srA.A + ' left, so B preempts A and A goes back to the queue.' },
      { predict: { q: 'At t = 2, C arrives needing ' + srB.C + '; B, running, has ' + srB.B + ' left. Does C preempt B?', options: ['Yes: every arrival is a chance to preempt', 'No: ' + srB.C + ' is not less than ' + srB.B, 'Only if C has waited longer'], answer: 1, explain: 'SRTN preempts only for a job with strictly less to do than the running job has left. B keeps the CPU.' } },
      { topic: 'sch-srtn', frame: 8, caption: 'Over the run, SRTN waits ' + srCmp.a.waiting + ' on average against ' + srCmp.b.waiting + ' under SJF, and responds in ' + srCmp.a.response + ' against ' + srCmp.b.response + ': preemption lets a short job in at once, at the price of more switches.' },
      { topic: 'sch-sjf', input: { work: 'L 0 1\nX 0 9\nA 1 2\nB 3 2\nC 5 2\nD 7 2' }, frame: 5, caption: 'The other side: X needs 9 ticks, and a 2-tick job keeps arriving just in time to go first. X does not run until t = 9. With a steady stream of short jobs it would never run: starvation.' },
      { warn: 'Both policies need to know how long each CPU burst will be, and a scheduler cannot know that. The next lesson shows how a real one guesses.' },
      { h: 'Recap' },
      { list: ['SJF: the shortest next burst runs to its end; with all jobs ready together, the least average wait of any order without preemption.', 'SRTN: a strictly shorter newcomer preempts; better response, more switches.', 'A long job can starve behind a stream of short ones.'] },
      X('cpu-x-sjf'), X('cpu-x-srtn'), X('cpu-x-srtn-tie'), X('cpu-x-sjf-catch'),
    ],
  });

  C.lesson({
    id: 'cpu-predict', chapter: 'cpu-short', title: 'Guessing the next burst', minutes: 6,
    summary: 'A scheduler cannot know a burst\'s length in advance, but bursts of one job tend to resemble their predecessors. Exponential averaging guesses the next one as τ(n+1) = α·t(n) + (1 − α)·τ(n): a large α follows the latest burst closely, a small one changes slowly.',
    blocks: [
      'Shortest first needs the length of a burst before it starts. A job does not announce it. But a job that computed for 4 ticks between reads last time will probably do something similar next time. How should a scheduler weigh what it has seen?',
      { math: 'τ(n+1) = α · t(n) + (1 − α) · τ(n)\n  t(n)   the length of burst n, just measured\n  τ(n)   the guess that was made for it\n  α      0 to 1: how much the newest burst counts' },
      { topic: 'sch-predict', frame: 1, caption: 'The first guess is τ₀ = ' + PRin.tau0 + '. Burst 1 takes ' + pr1.actual + ', so the next guess is 0.5 × ' + pr1.actual + ' + 0.5 × ' + pr1.predicted + ' = ' + pr1.next + '.' },
      { predict: { q: 'With α = 0.5, the guess for burst 5 is ' + pr5.predicted + ', but burst 5 takes ' + pr5.actual + '. What is the guess for burst 6?', options: [String(pr5.actual), String(pr5.next), String(pr5.predicted)], answer: 1, explain: 'Half of the new burst plus half of the old guess: 0.5 × ' + pr5.actual + ' + 0.5 × ' + pr5.predicted + ' = ' + pr5.next + '. The guess moves halfway towards what happened.' } },
      { topic: 'sch-predict', frame: 5, caption: 'Burst 5 takes ' + pr5.actual + ' against a guess of ' + pr5.predicted + ': the next guess is ' + pr5.next + ', up by ' + Math.round((pr5.next - pr5.predicted) * 100) / 100 + '. Even three long bursts in a row never bring the guess up to ' + prBig + ': it peaks at ' + prMax + '.' },
      { topic: 'sch-predict', frame: 10, caption: 'Over ' + PRin.bursts.length + ' bursts the guesses were off by ' + prErr() + ' ticks on average with α = 0.5.' },
      { topic: 'sch-predict', input: { alpha: 0.125 }, frame: 10, caption: 'With α = 0.125 the guess barely moves: off by ' + prErr(0.125) + ' on average. With α = 1 it simply repeats the last burst and is off by ' + prErr(1) + ' here, but wrong every time the job changes pace.' },
      { tip: 'Unrolled, the formula weighs a burst k steps back by α(1 − α)^k: the past fades geometrically. That is why it is called an exponential average.' },
      { h: 'Recap' },
      { list: ['The next burst is guessed from the last burst and the last guess.', 'α near 1: quick to follow, easily fooled by one odd burst.', 'α near 0: steady, slow to notice a real change.'] },
      X('cpu-x-predict'), X('cpu-x-predict-run'),
    ],
  });

  C.lesson({
    id: 'cpu-prio', chapter: 'cpu-short', title: 'Priorities, starvation and aging', minutes: 8,
    summary: 'A priority scheduler runs the most urgent ready job (here, the lowest number). Preemptive priority lets a more urgent arrival take the CPU at once. A job of low priority can wait for ever while urgent work keeps coming: starvation. Aging raises a waiting job\'s priority step by step, so every job eventually runs.',
    blocks: [
      'A hospital triage desk sees the most urgent patient first. Fair enough, until a mild case has waited all night because serious ones never stopped arriving. Schedulers face the same choice.',
      { def: 'priority scheduling', text: 'each job has a priority number, lower meaning more urgent; the most urgent ready job runs. Preemptive: a strictly more urgent job that becomes ready takes the CPU at once. Not preemptive: it waits for the running burst to end. SJF is the special case where the priority is the next burst\'s length.' },
      { topic: 'sch-prio', frame: 3, caption: 'Preemptive priority. At t = 4, C (priority 1) arrives and preempts B (priority 2); B goes to the back of the queue.' },
      { topic: 'sch-prio', frame: 10, caption: 'L has priority 4 and arrives at t = 0, yet urgent jobs keep arriving: L waits 15 ticks and does not run until t = 15. Nothing limits how long it might wait.' },
      { def: 'aging', text: 'every so many ticks a job waits, its priority number drops by one (it becomes more urgent), so a job that has waited long enough outranks newcomers.' },
      { predict: { q: 'With aging every 2 ticks, L (priority 4) has waited since t = 0. Roughly when does it first run?', options: ['Still at t = 15', 'Much earlier, at t = 7', 'At t = 0: aging makes it first'], answer: 1, explain: 'By t = 7 L has waited long enough to reach priority 1, ties with B and wins by having waited longer: it runs at t = 7.' } },
      { topic: 'sch-prio', input: { age: 2 }, frame: 5, caption: 'With aging every 2 ticks, at t = 7 L has reached priority 1: it ties with B and wins by having waited longer.' },
      { topic: 'sch-prio', input: { age: 2 }, frame: 10, caption: 'L still finishes at t = 21, since it is preempted after a tick, but it is no longer shut out; average waiting falls from 5 to 4.83.' },
      lab('Starvation, then aging', 'Two copies of preemptive priority on a stream of urgent jobs: without aging, and with aging every tick. The lab flags any job left waiting 12 ticks in a row.', cmp(['priop', 'priop'], { a1: 0, a2: 1, starve: 12, work: [R('Lo', 0, [6], { prio: 7 }), R('A', 1, [4], { prio: 1 }), R('B', 3, [5], { prio: 2 }), R('C', 6, [4], { prio: 1 }), R('D', 9, [5], { prio: 2 }), R('E', 13, [4], { prio: 1 })] })),
      { h: 'Recap' },
      { list: ['The most urgent ready job runs; preemptive priority lets it in at once.', 'Low-priority jobs can starve while urgent work keeps arriving.', 'Aging makes a waiting job more urgent over time, which bounds its wait.'] },
      X('cpu-x-prio'), X('cpu-x-prio-np'), X('cpu-x-aging'), { challenge: 'cpu-ch-triage' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
