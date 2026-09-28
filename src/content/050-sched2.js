// Part 5, CPU scheduling: the lessons of chapters 3 and 4 (time slices and feedback; fair shares). The chapters are
// declared in 050-sched.js. Every value quoted was read from the topics' own runs (S.Sched) on the inputs named.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('cpu-rr')) return;
  const X = (id) => ({ exercise: id });
  const R = (id, arrive, bursts, more) => Object.assign({ id, arrive, bursts, prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' }, more || {});
  const cmp = (pols, more) => Object.assign({ mode: 'compare', pol1: pols[0] || 'fcfs', pol2: pols[1] || 'none', pol3: pols[2] || 'none', pol4: pols[3] || 'none' }, more || {});
  const lab = (title, text, setup) => ({ lab: 'scheduler', title, text, setup });
  const FIVE = [R('A', 0, [6]), R('B', 2, [3]), R('C', 4, [7]), R('D', 5, [2]), R('E', 8, [4])];

  // =========================================================================================================
  // Chapter 3: time slices and feedback
  // =========================================================================================================
  C.lesson({
    id: 'cpu-rr', chapter: 'cpu-slices', title: 'Round robin and its quantum', minutes: 8,
    summary: 'Round robin gives each ready job a quantum of CPU in turn; a job that uses its whole quantum goes to the back of the queue. A small quantum gives quick response but many context switches, each of which costs time; a quantum longer than every burst turns round robin back into FCFS.',
    blocks: [
      'Five people share one microphone. If each may speak until finished, the first long talker silences everyone. If each gets thirty seconds and then passes it on, everyone is heard early, but some time goes into handing the microphone round.',
      { def: 'round robin', text: 'the job at the head of the ready queue runs for at most one quantum q. If its burst is not done, it goes to the back of the queue. Jobs that arrive at the same tick join first, then the job whose quantum just ran out.' },
      { topic: 'sch-rr', frame: 1, caption: 'Quantum 2. At t = 2, A has used its quantum, so it goes to the back; B, which arrived at that very tick, is ahead of it: the queue is [B, A].' },
      { predict: { q: 'At t = 6, A\'s second quantum ends. D arrived at t = 5 and is waiting. Who is nearer the front, D or A?', options: ['A: it has waited since t = 0', 'D: it joined the queue before A went back into it', 'They are in name order: A first'], answer: 1, explain: 'D joined the queue at t = 5; A only rejoins at t = 6, at the back. The queue is [C, B, D, A].' } },
      { topic: 'sch-rr', frame: 3, caption: 't = 6: A goes to the back of [C, B, D, A]; D, which arrived at t = 5, is ahead of it.' },
      { topic: 'sch-rr', frame: 12, caption: 'All done at t = 22. Average waiting 6.6 and turnaround 11, both a little worse than FCFS here (6 and 10.4), but average response is 2.2 against FCFS\'s 6.' },
      { def: 'context switch', text: 'saving one job\'s registers and loading another\'s, with the caches and TLB going cold. It does no useful work, so a scheduler that switches often loses time.' },
      { topic: 'sch-quantum', frame: 0, caption: 'The same five jobs, each switch now costing a tick. With quantum 1: 18 switches, 18 ticks lost, everything ends at t = 40 and turnaround averages 25.8; response averages 3.4.' },
      { topic: 'sch-quantum', frame: 8, caption: 'Over quanta 1 to 8: the best turnaround, 12.4, comes at quantum 7; the best response, 3.4, at quantum 1. From quantum 7 on no burst is ever cut, so round robin is FCFS.' },
      lab('Sweep the quantum', 'Round robin on five jobs with every quantum from 1 to 10, switches costing 1 tick: the metrics as curves.', { mode: 'sweep', sweepPol: 'rr', qmax: 10, cs: 1, work: FIVE }),
      { tip: 'A common rule of thumb: choose the quantum so that most CPU bursts end within one. Then interactive jobs finish their burst in one go, and only the long ones are cut.' },
      { h: 'Recap' },
      { list: ['Each ready job gets up to one quantum, then goes to the back.', 'New arrivals at a tick queue ahead of the job whose quantum just ended.', 'Small quantum: good response, many switches. Large quantum: FCFS.'] },
      X('cpu-x-rr'), X('cpu-x-rr-q3'), X('cpu-x-rr-cs'), X('cpu-x-quantum'), X('cpu-x-big-q'),
    ],
  });

  C.lesson({
    id: 'cpu-mlq', chapter: 'cpu-slices', title: 'Classes of jobs: the multilevel queue', minutes: 6,
    summary: 'A multilevel queue gives each class of job (system, interactive, batch) a queue of its own with its own policy. Between the queues, strict priority lets a lower class run only when every higher one is empty; time shares give each class a budget in every window instead, so the lowest class is never shut out completely.',
    blocks: [
      'Some jobs are known in advance to be urgent (the system\'s own daemons), some interactive, some batch work that nobody watches. Why make them compete in one queue at all?',
      { def: 'multilevel queue', text: 'each job belongs to one class for life, and each class has its own ready queue and policy (round robin for interactive jobs, FCFS for batch). The scheduler first chooses a class, then a job within it.' },
      { topic: 'sch-mlq', input: { mode: 'strict' }, frame: 5, caption: 'Strict priority. At t = 9, J (interactive) comes back from I/O, and B (batch) is preempted at once: a higher class always goes first.' },
      { topic: 'sch-mlq', input: { mode: 'strict' }, frame: 13, caption: 'Average waiting by class: system 0, interactive 3, batch 23.5. The batch class runs only in the gaps the others leave.' },
      { predict: { q: 'With shares of 5 : 3 : 2 ticks in every window of 10, when does the batch class first get the CPU?', options: ['Only when the other classes are empty, as before', 'As soon as the interactive class has used its 3 ticks of the window', 'Never: 2 ticks is too few'], answer: 1, explain: 'At t = 3 the interactive class has used its budget for the window, so J is preempted and B runs, even though J is ready.' } },
      { topic: 'sch-mlq', input: { mode: 'share', shares: ['5', '3', '2'], window: 10 }, frame: 2, caption: 'Shares 5 : 3 : 2. At t = 3 the interactive class has spent its budget for this window, so J is preempted for the batch class.' },
      { topic: 'sch-mlq', input: { mode: 'share', shares: ['5', '3', '2'], window: 10 }, frame: 16, caption: 'Averages by class: system 0, interactive 8, batch 24. Shares give batch a guaranteed slice of every window, not a shorter average wait: here the interactive class paid for it.' },
      { h: 'Recap' },
      { list: ['Each class has its own queue and policy; a job never changes class.', 'Strict priority: a lower class runs only when the higher ones are empty, and can starve.', 'Time shares: each class gets a budget per window.'] },
      X('cpu-x-mlq'),
    ],
  });

  C.lesson({
    id: 'cpu-mlfq', chapter: 'cpu-slices', title: 'The multilevel feedback queue', minutes: 9,
    summary: 'An MLFQ does not need to be told which jobs are interactive: it watches. Every job starts in the top queue, Q0, with a short quantum; a job that uses up its allotment of CPU at a level drops one level, where quanta are longer. Jobs that compute briefly and block stay near the top. A periodic boost lifts every job back to Q0, so long jobs cannot starve.',
    blocks: [
      'SJF would be ideal if burst lengths were known, and a multilevel queue works if each job\'s class is known. Can a scheduler learn both by watching how jobs behave?',
      { def: 'multilevel feedback queue (MLFQ)', text: 'several queues Q0, Q1, ..., Q0 the most urgent, with longer quanta lower down. The rules: (1) run from the highest non-empty queue, round robin within it; (2) a new job enters Q0; (3) once a job has used its allotment of CPU at a level, however it split it up, it drops one level; (4) every boost period, every job moves back to Q0.' },
      { topic: 'sch-mlfq', frame: 3, caption: 'Three levels with quanta 2, 4 and 8, allotment 4 at each level. At t = 6, A has used its 4 ticks at Q0 and drops to Q1; C, the editor, runs from Q0.' },
      { predict: { q: 'C runs for 1 tick and blocks for I/O. When it comes back at t = 14, B is running from Q1. What happens?', options: ['C waits behind B in Q1', 'C goes into Q0 and preempts B at once', 'C waits for B\'s quantum to end'], answer: 1, explain: 'C has used only 1 of its 4 ticks at Q0, so it is still a Q0 job. A job becoming ready in a higher queue preempts a lower one at once.' } },
      { topic: 'sch-mlfq', frame: 7, caption: 't = 14: C is back from I/O into Q0, so B, at Q1, is preempted and goes to the back of Q1.' },
      { topic: 'sch-mlfq', frame: 12, caption: 't = 24: the boost lifts A, B and C to Q0 with fresh allotments. Without it, a crowd of short jobs at Q0 could keep A and B from ever running again.' },
      { topic: 'sch-mlfq', frame: 19, caption: 'All done at t = 40. Response times A 0, B 1, C 3: an average of 1.33. The editor, C, never left Q0.' },
      { table: [['Rule', 'What it is for'], ['new jobs enter Q0', 'assume a job is short until it proves otherwise'], ['drop after the allotment', 'a long computation sinks to longer quanta and fewer switches'], ['allotment counted across I/O', 'a job cannot stay on top by blocking just before its time runs out'], ['boost', 'every job gets a turn at the top now and then: no starvation, and a job that turns interactive is noticed']], caption: 'The rules and their reasons.' },
      { h: 'Recap' },
      { list: ['Jobs start in Q0 and drop one level each time they use an allotment.', 'Higher queues preempt lower ones; within a queue, round robin.', 'The boost brings everything back to Q0 every so often.'] },
      X('cpu-x-mlfq'), X('cpu-x-mlfq3'),
    ],
  });

  C.lesson({
    id: 'cpu-game', chapter: 'cpu-slices', title: 'Gaming the feedback queue', minutes: 6,
    summary: 'If a job\'s count of CPU at a level were reset every time it blocked, a program could run for just under its allotment, do a tiny I/O, and stay in Q0 for ever, taking far more than its share. Counting the allotment across I/O closes that hole; the boost closes another, the starvation of long jobs below a busy top queue.',
    blocks: [
      'Rules that reward short bursts invite a program to fake them. What if a long computation paused for a moment of I/O every 3 ticks, just before it would be demoted?',
      { topic: 'sch-mlfq-game', frame: 2, caption: 'Two honest hogs, A and B, and G, which runs 3 ticks and then does 1 tick of I/O, again and again. It is run twice: under an MLFQ that resets the count when a job blocks, and under one that keeps it. By t = 18, G has had 8 ticks under the first, 4 under the second.' },
      { predict: { q: 'Over the 31 ticks while all three compete, about what share of the CPU does G get when the count is reset by I/O?', options: ['About a third, like the others', 'More than half', 'Less than a fifth'], answer: 1, explain: 'G never uses up its allotment, so it stays in Q0 and preempts the hogs each time it comes back: 18 of 31 ticks, 58%.' } },
      { topic: 'sch-mlfq-game', frame: 6, caption: 'While all three competed, G took 18 of 31 ticks (58%) when the count was reset by I/O, and 8 of 31 (26%) when it was kept. A finished at 43 against 31, B at 49 against 36.' },
      { topic: 'sch-mlfq-game', input: { work: 'A 0 30\nI 1 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1\nJ 2 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1 (1) 1', rule: 'boost', boost: 8, allot: 4 }, frame: 6, caption: 'The other hole: two genuinely interactive jobs keep Q0 busy. Without a boost, the long job A got 8 of the first 23 ticks (35%); with a boost every 8 ticks, 12 of 23 (52%).' },
      { topic: 'sch-mlfq-game', input: { rule: 'allot', allot: 4, work: 'A 0 16\nB 1 12\nC 3 1 (7) 1 (7) 1 (7) 1 (7) 1' }, frame: 6, caption: 'And the rule costs an honest interactive job nothing: an editor, C, that runs 1 tick between long waits never comes near its allotment, and every job finishes at the same time under both rules (C at t = 39).' },
      lab('MLFQ, gamed and fixed', 'The gaming job G under an MLFQ whose count resets on I/O, and under one that keeps it, side by side.', cmp(['mlfqr', 'mlfq'], { levels: 3, mq: [1, 2, 4], ma: [4, 8], boost: 0, work: [R('A', 0, [14]), R('B', 0, [14]), R('G', 1, [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3])] })),
      { h: 'Recap' },
      { list: ['Resetting the count on I/O lets a program stay on top by blocking briefly.', 'Counting CPU at a level, however it is split up, closes the hole.', 'The boost guarantees long jobs a turn even when the top queues are always busy.'] },
      X('cpu-x-game'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: fair shares
  // =========================================================================================================
  C.lesson({
    id: 'cpu-lottery', chapter: 'cpu-fair', title: 'Lottery and stride', minutes: 8,
    summary: 'Proportional-share schedulers give each job a share of the CPU in proportion to its tickets. Lottery scheduling draws a random ticket at every decision: right on average, but unpredictable over short times. Stride scheduling does the same deterministically: each job has a stride inversely proportional to its tickets and a pass that grows by the stride as it runs; the lowest pass runs next.',
    blocks: [
      'Three teams share a machine and have paid 3 : 2 : 1. They do not care about response or turnaround; they want CPU in that ratio. How can a scheduler hand it out?',
      { def: 'lottery scheduling', text: 'each job holds tickets. At each decision the scheduler draws a ticket number at random among the ready jobs\' tickets; its holder runs for a quantum. A job with twice the tickets wins twice as often, on average.' },
      { topic: 'sch-lottery', frame: 0, caption: 'Tickets 300, 200 and 100: A holds numbers 0–299, B 300–499, C 500–599. The first draw is 7, so A runs, with a chance of 300/600.' },
      { topic: 'sch-lottery', frame: 18, caption: 'While all three competed, the CPU per ticket gave a fairness index of 0.95, where 1 is perfectly in proportion. (Each needed the same 30 ticks, so over the whole run each got a third.)' },
      { topic: 'sch-lottery', input: { work: 'A 0 6 tickets=300\nB 0 6 tickets=100', seed: 3 }, frame: 6, caption: 'Over a short run luck dominates: with 300 tickets against 100, A won all three draws while both competed, so B got nothing until A had finished. The fairness index for that stretch is only 0.5.' },
      { def: 'stride scheduling', text: 'each job\'s stride is L / tickets for a large constant L. Each job has a pass, and the ready job with the lowest pass runs; every tick it runs adds its stride to its pass. Many tickets, small stride: the pass grows slowly and the job runs often.' },
      { predict: { q: 'With L = 600, what are the strides of A (300 tickets), B (200) and C (100)?', options: ['2, 3 and 6', '300, 200 and 100', '6, 3 and 2'], answer: 0, explain: '600 / 300 = 2, 600 / 200 = 3, 600 / 100 = 6. The job with the most tickets has the smallest stride.' } },
      { topic: 'sch-stride', frame: 2, caption: 't = 4: passes A 6, B 9, C 6. C and A tie at 6; C has waited longer, so C runs, and each tick it runs adds 6 to its pass.' },
      { topic: 'sch-stride', frame: 20, caption: 'While all competed, A got 30 ticks, B 20 and C 10: exactly 3 : 2 : 1, a fairness index of 1, with no luck involved.' },
      lab('Lottery draws beside stride', 'Tickets 3 : 2 : 1 under lottery, every draw shown, with stride beside it for the same tickets. Change the seed and watch the lottery change while stride stays put.', { mode: 'lottery', lq: 2, withStride: true, work: [R('A', 0, [16], { tickets: 300 }), R('B', 0, [16], { tickets: 200 }), R('C', 0, [16], { tickets: 100 })] }),
      { h: 'Recap' },
      { list: ['Tickets express shares; lottery hands them out at random, right on average.', 'Stride: stride = L / tickets; the lowest pass runs and its pass grows by its stride.', 'Lottery needs no global state and handles new jobs easily; stride is exact but must place a newcomer\'s pass.'] },
      X('cpu-x-lottery'), X('cpu-x-strides'), X('cpu-x-stride'),
    ],
  });

  C.lesson({
    id: 'cpu-cfs', chapter: 'cpu-fair', title: 'A fair scheduler: virtual runtime', minutes: 9,
    summary: 'A CFS-style scheduler tracks each job\'s virtual runtime: CPU time scaled by 1024 / its weight, the weight coming from its nice value. The ready jobs sit in a red-black tree ordered by vruntime, and the leftmost, the one that has had least, runs next, for a slice of the target latency in proportion to its weight. A sleeping job comes back with a little credit, not with all the time it missed.',
    blocks: [
      'Stride scheduling keeps a pass per job and runs the lowest. Suppose instead each job keeps the CPU time it has had, scaled by how important it is, and the job that has had least runs. How would you find that job quickly among hundreds?',
      { def: 'weight and vruntime', text: 'nice 0 has weight 1024, and each step of nice changes the weight by about 1.25 times. Running one tick adds 1024 / weight to a job\'s vruntime: a heavy (low nice) job\'s vruntime grows slowly, so it is picked more often.' },
      { def: 'slice', text: 'a job runs for target latency × its weight / the weights of every runnable job, but never less than the minimum slice. With latency 12, two equal jobs get 6 ticks each.' },
      { topic: 'sch-cfs', frame: 0, caption: 'A and B arrive at t = 0, both nice 0. A, leftmost in the tree, runs with a slice of max(2, 12 × 1024 / 2048) = 6.' },
      { topic: 'sch-cfs', frame: 2, caption: 't = 2: C (nice 5) and D have arrived. B\'s vruntime 0 is more than 1 below A\'s 2, so A is preempted. B\'s slice is now 12 × 1024 / 3407 = 3.61, the weights of four jobs sharing the latency.' },
      { predict: { q: 'C has nice 5, weight 335. By how much does each tick it runs increase its vruntime?', options: ['1', 'about 3.06', '335'], answer: 1, explain: '1024 / 335 ≈ 3.06. A light job\'s virtual clock runs about three times as fast, so it soon stops being leftmost.' } },
      { topic: 'sch-cfs', frame: 4, caption: 't = 8: after C\'s 2-tick slice its vruntime is 6.11, about 3.06 a tick. It goes back into the tree well to the right.' },
      { topic: 'sch-cfs', input: { work: 'A 0 16\nB 0 16\nI 1 1 (4) 1 (4) 1 (4) 1', credit: 'no' }, frame: 13, caption: 'A job that sleeps a lot: with no credit on waking it comes back at the current minimum vruntime, and while all competed it got 3 ticks to the hogs\' 13 and 16 (fairness index 0.79).' },
      { topic: 'sch-cfs', input: { work: 'A 0 16\nB 0 16\nI 1 1 (4) 1 (4) 1 (4) 1', credit: 'yes' }, frame: 12, caption: 'With up to latency / 2 of credit on waking, it is placed a little left of the hogs and runs promptly: 4 ticks against 9 and 12, fairness index 0.86.' },
      lab('CFS and its tree', 'Five jobs with nice values from −5 to 5 and one that sleeps: the red-black tree at every tick, each vruntime and each slice.', { mode: 'cfs', lat: 12, gran: 2, credit: true, work: [R('A', 0, [10]), R('B', 0, [10]), R('C', 1, [8], { nice: 5 }), R('D', 2, [2, 3, 2, 3, 2]), R('E', 3, [6], { nice: -5 })] }),
      { tip: 'Why a red-black tree? It keeps its jobs sorted, finds the leftmost at once, and inserts and removes in O(log n) steps, so the cost stays small with hundreds of runnable jobs.' },
      { h: 'Recap' },
      { list: ['vruntime grows by 1024 / weight per tick; the smallest runs next.', 'A slice is the latency shared out by weight, with a minimum.', 'Waking jobs get a bounded credit, never all the time they slept.'] },
      X('cpu-x-cfs-vr'), X('cpu-x-cfs-slice'),
    ],
  });

  C.lesson({
    id: 'cpu-compare', chapter: 'cpu-fair', title: 'One workload, every policy', minutes: 6,
    summary: 'On the same workload, each policy wins at what it was built for: SRTN at average waiting, the feedback queue and round robin at response, FCFS and SJF at fewest switches, the fair schedulers at proportion. Choosing a scheduler is choosing which metric matters for the jobs at hand.',
    blocks: [
      'After a dozen policies, which is best? Run them all on one workload and look at the numbers side by side.',
      { topic: 'sch-compare', frame: 0, caption: 'FCFS on five jobs: average turnaround 10.4, waiting 6, response 6, with 4 switches.' },
      { topic: 'sch-compare', frame: 2, caption: 'SRTN: waiting 3.8, response 2.8. Knowing every burst and preempting for shorter ones is hard to beat on averages.' },
      { predict: { q: 'Which of these policies gives the best average response on this workload?', options: ['FCFS', 'SJF', 'MLFQ'], answer: 2, explain: 'The MLFQ gives every newcomer a quick turn in Q0: average response 1.8, against 6 for FCFS and 4.2 for SJF.' } },
      { topic: 'sch-compare', frame: 6, caption: 'Least waiting: SRTN (3.8). Best response: MLFQ (1.8). Fewest switches: FCFS and SJF (4). The longest single wait, A\'s 13, comes under MLFQ.' },
      { topic: 'sch-compare', input: { work: 'A 0 11\nB 1 2\nC 2 3\nD 3 1' }, frame: 6, caption: 'On the convoy workload SRTN wins both waiting (2) and response (0.5); FCFS leaves D waiting 13 ticks behind A\'s burst.' },
      lab('Four policies on your own jobs', 'FCFS, SRTN, round robin and an MLFQ side by side. Type a workload of your own in the table and watch the metrics.', cmp(['fcfs', 'srtn', 'rr', 'mlfq'], { q3: 2, levels: 3, mq: [1, 2, 4], ma: [3, 6], boost: 20, work: FIVE })),
      { table: [['Policy', 'Strong at', 'Weak at'], ['FCFS', 'simplicity, few switches', 'convoys, response'], ['SJF / SRTN', 'average waiting', 'needs burst lengths; starves long jobs'], ['priority', 'urgent work first', 'starvation without aging'], ['round robin', 'response, no starvation', 'switch overhead; turnaround'], ['MLFQ', 'response without being told', 'tuning; gaming without its rules'], ['lottery, stride, CFS', 'shares in proportion', 'not built for turnaround']], caption: 'What each policy is for.' },
      { h: 'Recap' },
      { list: ['No policy wins every metric.', 'Name the metric that matters, then choose the policy and tune it.', 'The challenges of this part score your choice on workloads you cannot see.'] },
      X('cpu-x-compare'), { challenge: 'cpu-ch-desk' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
