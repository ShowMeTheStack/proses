// Part 5, CPU scheduling: the challenges, the guided tour, the course, and the pages the diagram checker looks at.
// Both challenges are of the sched-tune kind: the reader picks a policy and its parameters, and the choice is scored
// on seeded workloads the reader never sees. Targets and medals were set by scoring every policy and a grid of
// parameters through the kind's own evaluate on the same hidden workloads.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('cpu-ch-desk')) return;

  // ---- 1. the help desk: quick replies without stretching the long jobs -----------------------------------------
  C.challenge({ id: 'cpu-ch-desk', n: 51, title: 'The help desk', level: 2, kind: 'sched-tune',
    story: 'A support team shares one small server. Its jobs are a mix: an agent clicks "search" and waits for a list to appear; a nightly report starts early and runs for a while; a ticket import reads from the network in bursts. The agents complain when a click takes long to show anything; the report owners complain when their reports come out late.\n\nThe team scores a scheduler by the mean response time plus half the mean turnaround time. Every context switch costs a tick of overhead, so switching constantly is not free.',
    task: 'Choose a policy and its parameters. The score is mean response + mean turnaround / 2 over six hidden workloads of six jobs each, with I/O.',
    metric: 'mix', weights: { response: 1, turnaround: 0.5 }, metricName: 'response + turnaround/2', unit: 'ticks', higher: false,
    cs: 1, hidden: { seed: 501, count: 6, n: 6, spread: 14, maxCpu: 10, maxIo: 5 },
    preview: [{ id: 'A', arrive: 0, bursts: [9] }, { id: 'B', arrive: 1, bursts: [2, 3, 2] }, { id: 'C', arrive: 3, bursts: [6, 2, 3] }, { id: 'D', arrive: 4, bursts: [1] }, { id: 'E', arrive: 7, bursts: [3, 4, 1] }],
    limits: { policies: ['fcfs', 'sjf', 'rr', 'mlfq'], quantum: [1, 12], levels: [2, 4], boost: [0, 60] },
    target: 30.2, marks: { silver: 29.8, gold: 29.45 },
    hints: ['FCFS and SJF never preempt, so a click that arrives behind a long burst waits for all of it: their response time is poor. Round robin answers quickly, but every quantum boundary costs a switch tick, and on turnaround it does no better.', 'A feedback queue gives a newcomer a short first quantum (a quick response), and lets a job that keeps computing sink to longer quanta where it switches less. Try a top quantum and allotment of 2.', 'An MLFQ with 3 levels, a top quantum of 2, a top allotment of 2 and no boost scores about 29.4, gold. Round robin never beats FCFS here: with a quantum of 10 or more it is FCFS (about 31.3); quantum 8 scores about 32.5.'],
    solution: { policy: 'mlfq', levels: 3, q0: 2, allot: 2, boost: 0 },
    wrong: [{ policy: 'fcfs' }, { policy: 'rr', quantum: 8 }, { policy: 'rr', quantum: 1 }, { policy: 'sjf' }] });

  // ---- 2. triage: priorities that do not starve anyone -------------------------------------------------------------
  C.challenge({ id: 'cpu-ch-triage', n: 52, title: 'Triage without starvation', level: 3, kind: 'sched-tune',
    story: 'A print shop\'s order system gives every job a priority from 0 (rush) to 4 (whenever). The owner insists on priorities: rush orders must be served first. But the customers who order "whenever" have started to notice that their jobs sometimes sit for most of the day.\n\nThe shop wants work to start promptly (a low mean response time), and it will not accept a schedule that slows some jobs far more than others: on every hidden day, Jain\'s fairness index of the slowdowns (each job\'s turnaround divided by its own work) must be at least 0.6.',
    task: 'Priority scheduling only. Choose preemptive or not, and how many ticks of waiting improve a job\'s priority by one step (0: no aging).',
    metric: 'response', metricName: 'mean response time', unit: 'ticks', higher: false,
    cs: 0, hidden: { seed: 77, count: 6, n: 6, spread: 10, maxCpu: 9, maxIo: 4 },
    preview: [{ id: 'A', arrive: 0, bursts: [7], prio: 4 }, { id: 'B', arrive: 1, bursts: [3], prio: 1 }, { id: 'C', arrive: 2, bursts: [2, 2, 2], prio: 0 }, { id: 'D', arrive: 4, bursts: [5], prio: 2 }, { id: 'E', arrive: 5, bursts: [3], prio: 1 }],
    limits: { policies: ['prio'], age: [0, 20], minFair: 0.6 },
    target: 7.5, marks: { silver: 7, gold: 6.7 },
    hints: ['Without aging, a job of priority 4 can wait behind every rush order that arrives: on some hidden days the fairness index falls below 0.6, whatever else you choose.', 'Preemption lets an urgent arrival start at once, which helps the response time. Then tune the aging step: too slow and a low-priority job is still starved; too fast and priorities hardly matter.', 'Preemptive, aging every 2 ticks: about 6.69, gold, with the fairness index at least 0.62 on every day. Aging every 3 ticks is not fair enough on one day (0.59), and every tick responds more slowly (about 7.33).'],
    solution: { policy: 'prio', preemptive: true, age: 2 },
    wrong: [{ policy: 'prio', preemptive: true, age: 0 }, { policy: 'prio', preemptive: true, age: 3 }, { policy: 'prio', preemptive: false, age: 8 }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'cpu-tour', title: 'Tour: CPU scheduling', blurb: 'Bursts and metrics, the convoy, shortest first, round robin and its quantum, the feedback queue, fair shares and the Scheduler lab, in eight steps.',
    steps: [
      { route: 'part=scheduling', target: '#main', text: 'Part 5 of the catalogue: one CPU, several jobs that want it, and the policies that decide who runs next.' },
      { route: 'topic=sch-bursts', target: '#stageWrap', text: 'Every job alternates CPU bursts and I/O bursts. The scheduler chooses only among ready jobs; while one waits for its device another computes.' },
      { target: '#btnPlay', text: 'Play steps through the schedule tick by tick; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=sch-fcfs', target: '#stageWrap', text: 'First come, first served: one long burst at the head of the queue holds every short job behind it, the convoy effect.' },
      { route: 'topic=sch-quantum', target: '#inputs', text: 'Round robin trades response for switching. Change the cost of a switch here and watch the best quantum move.' },
      { route: 'topic=sch-mlfq', target: '#stageWrap', text: 'The multilevel feedback queue learns which jobs are interactive by watching them, and boosts everyone now and then so nothing starves.' },
      { route: 'labs/scheduler', target: '#labView', text: 'The Scheduler lab: type your own jobs, put up to four policies side by side, and read why each job runs when it does.' },
      { route: 'learn', target: '[data-chapter="cpu-model"]', text: 'The lessons and exercises of this part start here: Gantt charts to paint by hand, metrics to work out, and two tuning challenges.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'cpu-course', title: 'CPU scheduling', blurb: 'All sixteen topics of part 5, from bursts and metrics to a fair scheduler with virtual runtime, with lessons and exercises on the way.',
    steps: [
      { lesson: 'cpu-bursts', note: 'What a scheduler chooses among.' },
      { topic: 'sch-bursts', note: 'CPU bursts and I/O bursts.' },
      { topic: 'sch-metrics', note: 'Turnaround, waiting and response.' },
      { exercise: 'cpu-x-metrics', note: 'Measure a finished schedule.' },
      { topic: 'sch-fcfs', note: 'The convoy effect.' },
      { exercise: 'cpu-x-fcfs-io', note: 'FCFS with I/O, by hand.' },
      { topic: 'sch-sjf', note: 'Shortest job first.' },
      { topic: 'sch-srtn', note: 'Its preemptive form.' },
      { exercise: 'cpu-x-srtn', note: 'SRTN by hand.' },
      { topic: 'sch-predict', note: 'Guessing the next burst.' },
      { exercise: 'cpu-x-predict-run', note: 'Guesses over a run.' },
      { lesson: 'cpu-prio', note: 'Starvation and aging.' },
      { topic: 'sch-prio', note: 'Priorities, preemptive or not.' },
      { exercise: 'cpu-x-aging', note: 'Aging lets a job in.' },
      { topic: 'sch-rr', note: 'Round robin.' },
      { topic: 'sch-quantum', note: 'Choosing the quantum.' },
      { exercise: 'cpu-x-rr-cs', note: 'Paying for each switch.' },
      { topic: 'sch-mlq', note: 'Fixed classes of queues.' },
      { lesson: 'cpu-mlfq', note: 'A queue that learns.' },
      { topic: 'sch-mlfq', note: 'Levels, quanta, allotments and the boost.' },
      { exercise: 'cpu-x-mlfq3', note: 'Three levels by hand.' },
      { topic: 'sch-mlfq-game', note: 'Gaming it, and the rules that stop it.' },
      { topic: 'sch-lottery', note: 'Shares by lottery.' },
      { topic: 'sch-stride', note: 'Shares by stride.' },
      { exercise: 'cpu-x-stride', note: 'Stride by hand.' },
      { topic: 'sch-cfs', note: 'Virtual runtime and a red-black tree.' },
      { exercise: 'cpu-x-cfs-slice', note: 'Slices of the latency.' },
      { topic: 'sch-compare', note: 'Every policy on one workload.' },
      { exercise: 'cpu-x-compare', note: 'Three policies, one workload.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson cpu-bursts')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'scheduling').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['cpu-x-ready', 'cpu-x-metrics', 'cpu-x-fcfs-io', 'cpu-x-convoy', 'cpu-x-srtn', 'cpu-x-predict-run', 'cpu-x-aging', 'cpu-x-rr-cs', 'cpu-x-quantum', 'cpu-x-mlq', 'cpu-x-mlfq3', 'cpu-x-stride', 'cpu-x-cfs-slice', 'cpu-x-compare'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course cpu-course', hash: 'course=cpu-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['cpu-ch-desk', 'cpu-ch-triage']) S.Checks.push({ group: 'learn', name: 'cpu challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
