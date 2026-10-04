// Part 9, deadlocks: the chapters and the lessons. The exercises are in 091-dl-ex.js and 091-dl-ex2.js; the
// challenges, the guided tour, the course and the pages the diagram checker looks at are in 092-dl-ch.js. Each
// lesson opens with a situation, runs the topic that shows the idea at a frame chosen for the point being made, asks
// for a prediction, sums up, and leads to its exercises. Every value quoted is what the topics' engines (S.Rag,
// S.Banker, S.Dl, S.MC, S.Lockdep) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'dl-graphs')) return;

  C.chapter({ id: 'dl-graphs', part: 'deadlock', n: 1, title: 'Deadlock and its graphs', blurb: 'Processes that wait for each other for ever, the resource-allocation graph that shows it, cycles found by search, units that change what a cycle means, and the wait-for graph.' });
  C.chapter({ id: 'dl-prevent', part: 'deadlock', n: 2, title: 'The four conditions and prevention', blurb: 'Mutual exclusion, hold and wait, no preemption and circular wait; each one broken in turn, and what each way of breaking it costs.' });
  C.chapter({ id: 'dl-avoid', part: 'deadlock', n: 3, title: 'Avoidance: safe states and the banker', blurb: 'Declared claims, Need and Available, the safety check row by row, the banker granting and refusing requests, and claim edges.' });
  C.chapter({ id: 'dl-detect', part: 'deadlock', n: 4, title: 'Detection, recovery and lock order', blurb: 'Finding a deadlock after the fact, breaking it by aborting or rolling back, and the everyday cure for locks: one order, checked by a lock-order validator; and livelock.' });
  const X = (id) => ({ exercise: id });
  const lab = (title, text, setup) => ({ lab: 'deadlock', title, text, setup });
  const row = (who, op, res, n) => ({ who, op, res, n: n || 1 });

  // =========================================================================================================
  // Chapter 1: deadlock and its graphs
  // =========================================================================================================
  C.lesson({
    id: 'dl-what', chapter: 'dl-graphs', title: 'Waiting for each other for ever', minutes: 7,
    summary: 'A set of processes is deadlocked when each one waits for something only another one in the set can give. The resource-allocation graph shows it: a circle per process, a box per resource type with a dot per unit, an assignment edge from a unit to its holder and a request edge from a waiting process to the box. With one unit per resource, a cycle in the graph is a deadlock.',
    blocks: [
      'A copying job takes the scanner, then asks for the plotter; another job takes the plotter, then asks for the scanner. Most days they run at different times and nothing happens. One day they start together, and both sit still for ever, though neither has crashed and both are "running". What went wrong, and how could we see it?',
      { def: 'deadlock', text: 'a set of processes in which every process waits for an event (usually the release of a resource) that only another process in the set can cause. None of them can ever move again.' },
      { def: 'resource-allocation graph', text: 'a circle for each process, a box for each resource type with a dot for each unit. An assignment edge runs from a unit to the process that holds it; a request edge runs from a waiting process to the box.' },
      { topic: 'dl-rag-live', frame: 0, caption: 'P0 copies from scanner R0 to plotter R1; P1 copies the other way. One unit of each, and nothing held yet.' },
      { topic: 'dl-rag-live', frame: 4, caption: 'P0 holds R0; P1 got R1 a moment ago. Now P0 asks for R1 and blocks, still holding R0: a request edge from P0 to the box.' },
      { predict: { q: 'P1 now asks for R0. What happens?', options: ['It gets R0, because P0 is blocked anyway', 'It blocks too, and neither can ever move', 'The kernel takes R0 back from P0'], answer: 1, explain: 'R0 is held by P0, which is blocked, so it will never release R0. P1 blocks holding R1, which P0 is waiting for: each waits for the other.' } },
      { topic: 'dl-rag-live', frame: 7, caption: 'The edges P0 → R1 → P1 → R0 → P0 form a cycle. With one unit per resource, a cycle is a deadlock.' },
      { topic: 'dl-rag-live', input: { how: 'seed', seed: 2 }, frame: 7, caption: 'A different schedule (seed 2): P1 takes R1 first, P0 takes R0, and they meet in the same deadlock from the other side.' },
      'Timing matters: under many schedules the two jobs finish without trouble, which is why a deadlock can hide in code for months. Change the seed and watch.',
      { topic: 'dl-rag-live', input: { scen: 'ring3', how: 'worst' }, inputs: true, caption: 'Three processes round a ring of three tape drives: the model checker finds the shortest schedule that deadlocks. Try the other scenarios too.' },
      lab('Run the scripts yourself', 'The Deadlock lab with the two copying jobs: change the order of the lines in the script and see whether the cycle still closes.', { mode: 'rag', ragFrom: 'script', nproc: 2, res: [{ name: 'Scan', units: 1 }, { name: 'Plot', units: 1 }], script: [row('P0', 'req', 'Scan'), row('P1', 'req', 'Plot'), row('P0', 'req', 'Plot'), row('P1', 'req', 'Scan'), row('P0', 'rel', 'Plot'), row('P0', 'rel', 'Scan'), row('P1', 'rel', 'Scan'), row('P1', 'rel', 'Plot')] }),
      { h: 'Recap' },
      { list: ['Deadlock: every process in a set waits for another in the set.', 'Assignment edges run from a unit to its holder; request edges from a waiting process to the box.', 'With one unit per resource, a cycle in the graph is a deadlock; without a cycle, there is none.', 'Whether it happens depends on the timing, so testing alone rarely finds it.'] },
      X('dl-x-cycle-pair'), X('dl-x-cycle-chain'),
    ],
  });

  C.lesson({
    id: 'dl-cycle', chapter: 'dl-graphs', title: 'Finding the cycle, and what units change', minutes: 8,
    summary: 'A depth-first search finds a cycle: it keeps the path it is on and reports a cycle when an edge leads back to a node on that path. With one unit per resource a cycle means deadlock. With several units it does not: a unit on the cycle may be held by a process off it that will finish and free it, so the counts must be checked with the detection algorithm.',
    blocks: [
      'The office server shows five blocked processes and four locks. Some of the processes are stuck in a deadlock; others just happen to be queued behind them. How can a program tell which waits go round in a circle?',
      { topic: 'dl-rag-cycle', frame: 0, caption: '5 processes, 4 resource types and 9 edges. The search starts at P0 and keeps the path it is on.' },
      { topic: 'dl-rag-cycle', frame: 6, caption: 'The path is P0 → R1 → P1 → R2 → P2 → R0. The next edge out of R0 decides it.' },
      { predict: { q: 'R0 is held by P0. What does the search conclude when it follows R0 → P0?', options: ['Nothing yet: it must visit every node first', 'A cycle: P0 is already on the path', 'A dead end: P0 was visited, so it is skipped'], answer: 1, explain: 'An edge back to a node on the current path closes a cycle. A node visited earlier but no longer on the path would just be skipped.' } },
      { topic: 'dl-rag-cycle', frame: 8, caption: 'The cycle P0 → R1 → P1 → R2 → P2 → R0 → P0. P3 holds a unit and waits on the cycle, so it is stuck too; P4 holds nothing and is not counted, though it waits for ever as well.' },
      { h: 'When there are several units' },
      'With a single unit, a request edge points at the one process that can free it. With two units, the request may be met by either holder. A cycle then shows only that some processes wait on each other, not that they must wait for ever.',
      { topic: 'dl-rag-cycle', input: { snap: 'spare' }, frame: 6, caption: 'A cycle P0 → R1 → P1 → R0 → P0, but R0 has two units and the other is held by P2, which waits for nothing. P2 will finish and free it: no deadlock.' },
      { topic: 'dl-rag-cycle', input: { snap: 'two' }, frame: 6, caption: 'The same cycle, but now the holder off the cycle waits too: the detection algorithm, counting every unit, finds P0, P1 and P2 deadlocked.' },
      { table: [['Every resource has', 'No cycle', 'A cycle'], ['one unit', 'no deadlock', 'deadlock'], ['several units', 'no deadlock', 'maybe: count with the detection algorithm']], caption: 'What a cycle tells you.' },
      lab('Draw your own graph', 'The Deadlock lab with a graph drawn by clicking: a process then a resource adds a request, a resource then a process an assignment. Give a resource two units and see the verdict change.', { mode: 'rag', ragFrom: 'graph', nproc: 3, res: [{ name: 'R0', units: 2 }, { name: 'R1', units: 1 }], edges: 'R0>P0 P0>R1 R1>P1 P1>R0 R0>P2' }),
      { h: 'Recap' },
      { list: ['Depth-first search with a path: an edge back onto the path closes a cycle.', 'One unit per resource: cycle ⇔ deadlock.', 'Several units: a cycle is necessary but not enough.', 'A process waiting on a deadlock from outside is stuck as well.'] },
      X('dl-x-cycle-hidden'), X('dl-x-cycle-units'), X('dl-x-units-deadlock'), X('dl-x-cycle-big'),
    ],
  });

  C.lesson({
    id: 'dl-waitfor', chapter: 'dl-graphs', title: 'The wait-for graph', minutes: 5,
    summary: 'When every resource has one unit, each request edge leads through its box to exactly one holder. Collapsing P → R → Q into P → Q gives the wait-for graph, with processes only; a cycle in it is a deadlock. It is smaller, and it is what a lock manager can keep as it hands out locks.',
    blocks: [
      'A database hands out thousands of row locks, each held by one transaction at a time. To spot a deadlock it does not need to draw the rows at all, only who waits for whom. How do we get that picture from the full graph?',
      { def: 'wait-for graph', text: 'a graph of processes only, with an edge P → Q when P waits for a resource that Q holds. It exists when every resource has a single unit.' },
      { topic: 'dl-wait-for', frame: 1, caption: 'P0 → R1 and R1 → P1 become one edge P0 → P1: P0 waits for P1 to release R1.' },
      { predict: { q: 'P4 waits for R3, which P3 holds. Which edge does that become?', options: ['P3 → P4', 'P4 → P3', 'None: P4 holds nothing'], answer: 1, explain: 'An edge runs from the waiter to the holder, whether or not the waiter holds anything itself.' } },
      { topic: 'dl-wait-for', frame: 6, caption: 'The wait-for graph has the cycle P0 → P1 → P2 → P0: a deadlock. P3 and P4 wait on it from outside.' },
      { topic: 'dl-wait-for', input: { snap: 'ring4' }, frame: 5, caption: 'A ring of four: P0 → P1 → P2 → P3 → P0.' },
      { h: 'Recap' },
      { list: ['Each request edge, followed to its holder, becomes one edge waiter → holder.', 'Only for single-unit resources: with several units a request has no single holder.', 'A cycle in the wait-for graph is a deadlock.'] },
      X('dl-x-waitfor'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: the four conditions and prevention
  // =========================================================================================================
  C.lesson({
    id: 'dl-conditions', chapter: 'dl-prevent', title: 'The four conditions', minutes: 8,
    summary: 'A deadlock needs four things at once: mutual exclusion (a unit is held by one process), hold and wait (a process holds units while it waits for more), no preemption (only the holder gives a unit back), and circular wait (a cycle of processes, each waiting for the next). Take any one away and no schedule can deadlock.',
    blocks: [
      'The two copying jobs deadlocked. Before we try to fix them, ask what had to be true for it to happen at all. If even one of those things were false, could they still get stuck?',
      { topic: 'dl-conditions', frame: 8, caption: 'Deadlock, with all four present: each unit held by one process, each process holding while it waits, nothing taken away, and the waits in a pink cycle.' },
      { list: ['**Mutual exclusion**: a unit can be used by only one process at a time.', '**Hold and wait**: a process holds some units while it waits for more.', '**No preemption**: a unit is given back only by the process holding it.', '**Circular wait**: a cycle of processes, each waiting for a unit the next one holds.'] },
      'These are necessary conditions: all four hold in every deadlock. So breaking any one of them, by a rule every process obeys, makes deadlock impossible. The model checker can confirm it by searching every schedule.',
      { topic: 'dl-conditions', input: { scen: 'pair', rule: 'mutex' }, frame: 1, caption: 'Resources made shareable, as a spooled printer: the checker searched all 49 reachable states and no schedule deadlocks.' },
      { predict: { q: 'Under the rule "ask for everything at once", P1 asks for R1 and R2 together while P0 holds R1. What does P1 hold while it waits?', options: ['R2, which was free', 'Nothing', 'R1 and R2'], answer: 1, explain: 'All or nothing: P1 gets neither until both are free, so a waiting process never holds anything, and hold and wait is gone.' } },
      { topic: 'dl-conditions', input: { scen: 'ring3', rule: 'holdWait' }, frame: 4, caption: 'P1 asks for everything its script needs, 1 R1 and 1 R2, but only R2 is free: it blocks holding nothing.' },
      { topic: 'dl-conditions', input: { scen: 'pair', rule: 'preempt' }, frame: 5, caption: 'No preemption broken: P0 cannot get R1, so it gives back R0 and starts again. The cycle cannot close.' },
      { topic: 'dl-conditions', input: { scen: 'ring4', rule: 'order' }, frame: 26, caption: 'Circular wait broken: every process asks in one global order of resource number. All 1567 states searched, and none is a deadlock.' },
      lab('Switch the conditions yourself', 'The Deadlock lab\'s conditions mode with a ring of four: turn any one condition off and the checker reports that no schedule can deadlock.', { mode: 'cond', cSched: 'worst', nproc: 4, res: [{ name: 'L0', units: 1 }, { name: 'L1', units: 1 }, { name: 'L2', units: 1 }, { name: 'L3', units: 1 }], script: [0, 1, 2, 3].flatMap((i) => [row('P' + i, 'req', 'L' + i), row('P' + i, 'work', 'L' + i), row('P' + i, 'req', 'L' + ((i + 1) % 4)), row('P' + i, 'rel', 'L' + ((i + 1) % 4)), row('P' + i, 'rel', 'L' + i)]) }),
      { h: 'Recap' },
      { list: ['All four conditions hold in every deadlock.', 'Break one, by a rule every process follows, and deadlock is impossible: that is prevention.', 'The checker shows it by searching every schedule, not by one lucky run.'] },
      X('dl-x-cond-which'),
    ],
  });

  C.lesson({
    id: 'dl-prevention', chapter: 'dl-prevent', title: 'Prevention and its price', minutes: 7,
    summary: 'Each way of preventing deadlock costs something. Sharing works only for resources that can be shared. Asking for everything at once holds units long before they are needed. Taking units back throws work away. One global order of resources costs least, which is why it is the usual rule for locks; its price is the discipline of keeping to it.',
    blocks: [
      'Every rule in the last lesson removed the deadlock. A system designer must still pick one. What does each rule cost the processes that obey it?',
      { topic: 'dl-prevention', frame: 0, caption: 'Three processes round a ring of three resources, run 24 times under each rule, with seeds 1 to 24.' },
      { topic: 'dl-prevention', frame: 1, caption: 'With no rule: 13 of 24 runs deadlocked.' },
      { predict: { q: 'Which rule do you expect to hold units the longest before they are needed?', options: ['Sharing the resources', 'Asking for everything at once', 'Giving back on a wait', 'One global order'], answer: 1, explain: 'A process that asks for all its units at its first request holds the last of them from the start, whether it needs them yet or not.' } },
      { topic: 'dl-prevention', frame: 6, caption: 'Asking for everything at once held units early for 4.6 unit-steps per run; giving back on a wait threw work away, 4.6 restarts per run.' },
      { table: [['Condition broken', 'Rule', 'Price'], ['Mutual exclusion', 'make the resource shareable (spool it)', 'only some resources can be shared'], ['Hold and wait', 'ask for everything at once, or release before asking', 'units held idle; may starve a process that needs many'], ['No preemption', 'a waiting process gives back what it holds', 'lost work, restarts; only for state that can be saved'], ['Circular wait', 'ask in one global order', 'a discipline to keep; requests in order only']], caption: 'Prevention, rule by rule.' },
      { topic: 'dl-prevention', input: { scen: 'pair' }, inputs: true, caption: 'Try another set of scripts: the price of each rule changes with the workload.' },
      { h: 'Recap' },
      { list: ['Every prevention rule works, and every one costs something.', 'Asking for everything at once wastes units; preemption wastes work.', 'A global order is cheap and is the standard rule for locks.', 'A pool is safe when even the worst case leaves one process able to finish.'] },
      X('dl-x-prevent-price'), X('dl-x-order-fix'), X('dl-x-pool-min'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: avoidance
  // =========================================================================================================
  C.lesson({
    id: 'dl-safe', chapter: 'dl-avoid', title: 'Safe states, row by row', minutes: 9,
    summary: 'If each process declares the most it may ever hold (Max), the system can tell whether it could always let every process finish. Need = Max − Allocation. The safety check starts with Work = Available, repeatedly finds a process whose Need fits in Work, lets it finish and adds its Allocation to Work. If every process finishes, the state is safe and that order is a safe sequence; if a pass finishes nobody, it is unsafe.',
    blocks: [
      'A bank has a little cash in the vault and several customers with credit lines, each partly drawn. If every customer came in now and drew the rest of their line, could the bank pay them all, one after another, as each one repays? That question, for processes and resources, is the safety check.',
      { def: 'Max, Allocation, Need, Available', text: 'Max is the most a process has declared it may ever hold; Allocation what it holds now; Need = Max − Allocation what it may still ask for; Available what is free.' },
      { topic: 'dl-safety', frame: 1, caption: 'Need = Max − Allocation: P0 may still need (2, 3, 1), P4 (1, 4, 5). Available is (3, 2, 3).' },
      { topic: 'dl-safety', frame: 3, caption: 'P0: Need (2, 3, 1) is not ≤ Work (3, 2, 3), since 3 of B is more than the 2 free. P0 cannot finish yet.' },
      { topic: 'dl-safety', frame: 4, caption: 'P1: Need (1, 1, 2) fits. It can run to the end and give back its allocation (5, 1, 0): Work becomes (8, 3, 3).' },
      { predict: { q: 'Work is now (8, 3, 3). The scan goes on to P2, whose Need is (3, 0, 2). Then P3 needs (7, 6, 1). Which of them can finish?', options: ['Both', 'P2 only', 'P3 only', 'Neither'], answer: 1, explain: 'P2\'s (3, 0, 2) fits in (8, 3, 3). P3 needs 6 of B, and even after P2 returns its 2 there are only 5.' } },
      { topic: 'dl-safety', frame: 11, caption: 'Every Finish is true: the state is safe, with the safe sequence ⟨P1, P2, P0, P3, P4⟩. Work ends at (9, 7, 9), everything there is.' },
      { h: 'Unsafe' },
      { topic: 'dl-safety', input: { avail: ['0', '1', '0'], alloc: '1 0 1; 0 2 0; 1 1 1', max: '1 1 1; 2 3 1; 2 2 3' }, frame: 8, caption: 'P0 finishes and Work becomes (1, 1, 1); then a whole pass finishes nobody. P1 and P2 are left, and the state is unsafe.' },
      { warn: 'Unsafe is not deadlocked. The processes may never ask for their whole Need. Unsafe means only that the system can no longer promise that everyone will finish.' },
      lab('Your own tables in the Deadlock lab', 'Allocation, Max and Available for four processes and four types: the safety check runs row by row, with Work and Finish updated.', { mode: 'bank', bkind: 'safety', alloc: [[2, 0, 1, 1], [0, 1, 0, 2], [1, 1, 1, 0], [0, 2, 1, 1]], max: [[3, 2, 2, 2], [1, 2, 3, 3], [2, 3, 2, 1], [1, 3, 2, 2]], avail: [1, 1, 1, 1] }),
      { h: 'Recap' },
      { list: ['Need = Max − Allocation.', 'Work = Available; finish any row whose Need fits; add its Allocation to Work; repeat.', 'All rows finish: safe, and the order is a safe sequence. A pass with no progress: unsafe.', 'Safe ⇒ no deadlock can happen. Unsafe ⇒ one might.'] },
      X('dl-x-need'), X('dl-x-seq-four'), X('dl-x-work'), X('dl-x-safe-small'),
    ],
  });

  C.lesson({
    id: 'dl-banker', chapter: 'dl-avoid', title: 'The banker grants or refuses', minutes: 8,
    summary: 'The banker\'s algorithm checks every request in three steps: it must be within the process\'s Need (else the process broke its claim), within Available (else it waits), and the state after granting it must be safe (else it waits, although the units are free). Pretending to grant and running the safety check is the heart of avoidance.',
    blocks: [
      'The bank has the cash a customer asks for, right there in the vault. Should it hand it over? Not if paying it would leave the bank unable to pay the others their lines in some order. The banker refuses requests it could meet, to stay safe.',
      { steps: ['Request ≤ Need? If not, the process asked for more than it declared: an error.', 'Request ≤ Available? If not, the units are not free: it waits.', 'Pretend to grant it: Available −= Request, Allocation += Request, Need −= Request. Run the safety check on that state.', 'Safe: grant it for real. Unsafe: undo the pretence; the process waits.'] },
      { topic: 'dl-banker-request', input: { who: 1, req: ['1', '1', '1'] }, frame: 2, caption: 'P1 asks for (1, 1, 1): within its Need (1, 1, 2) and within Available (3, 2, 3). Pretend: Available becomes (2, 1, 2).' },
      { topic: 'dl-banker-request', input: { who: 1, req: ['1', '1', '1'] }, frame: 13, caption: 'The pretended state is safe, ⟨P1, P2, P0, P3, P4⟩, so the request is granted for real.' },
      { predict: { q: 'P0 asks for (2, 2, 1). Its Need is (2, 3, 1) and Available is (3, 2, 3). Granting it would leave Available at (1, 0, 2). What does the banker do?', options: ['Grants it: the units are free', 'Makes P0 wait: that state might be unsafe', 'Reports an error: P0 asked for too much'], answer: 1, explain: 'The request is within the claim and the units are free, but with no B left nobody\'s Need fits: the pretended state is unsafe, so P0 waits.' } },
      { topic: 'dl-banker-request', frame: 9, caption: 'A whole pass finishes nobody: P0 to P4 are left with Finish false. The pretended state is unsafe.' },
      { topic: 'dl-banker-request', frame: 10, caption: 'The request (2, 2, 1) is denied although the units are free: P0 waits, and the tables go back to how they were.' },
      { topic: 'dl-banker-request', input: { who: 1, req: ['2', '0', '0'] }, frame: 1, caption: 'P1 asks for (2, 0, 0) with a Need of only (1, 1, 2): it broke its own claim, an error.' },
      lab('A request in the Deadlock lab', 'Change who asks and for what: the pretended state is drawn inside a dashed frame, then granted or refused.', { mode: 'bank', bkind: 'request', who: 3, req: [1, 1, 0] }),
      { h: 'Recap' },
      { list: ['Three tests: Need, Available, then safety of the pretended state.', 'Over-need is an error; not enough free means wait; unsafe means wait too.', 'The price of avoidance: every process must declare its Max in advance, and the check runs on every request.'] },
      X('dl-x-req-wait'), X('dl-x-req-over'), X('dl-x-req-granted'), X('dl-x-req-unsafe'), X('dl-x-seq-five'), X('dl-x-seq-none'), X('dl-x-extra'),
    ],
  });

  C.lesson({
    id: 'dl-claims', chapter: 'dl-avoid', title: 'Avoidance with claim edges', minutes: 5,
    summary: 'When every resource has one unit, avoidance can work on the graph itself. Each process\'s declared claims are drawn as dashed claim edges. A request is granted only if, with the resource assigned and every remaining claim counted as a request, the graph has no cycle.',
    blocks: [
      'With single-unit resources the banker\'s matrices are overkill. Can the graph do the job instead?',
      { def: 'claim edge', text: 'a dashed edge P → R meaning P may ask for R some day. It turns into a request edge when P asks, and back into a claim edge when P releases R.' },
      { topic: 'dl-claim-graph', frame: 1, caption: 'P0 asks for R0: with R0 assigned and every claim counted as a request, there is no cycle. Granted.' },
      { predict: { q: 'P1 now asks for R1, which is free. P0 still claims R1 and P1 still claims R0. Granted?', options: ['Yes, R1 is free', 'No: the pretended graph would have a cycle'], answer: 1, explain: 'With R1 assigned to P1, the claims P0 → R1 and P1 → R0 close the cycle P0 → R1 → P1 → R0 → P0: unsafe.' } },
      { topic: 'dl-claim-graph', frame: 3, caption: 'So P1 must wait for R1 although nobody holds it: granting it could lead to a deadlock nothing could then avoid.' },
      { topic: 'dl-claim-graph', input: { sc: 'three' }, frame: 3, caption: 'Three processes in a ring of claims: P2\'s request for R2 would close P0 → R1 → P1 → R2 → P2 → R0.' },
      { h: 'Recap' },
      { list: ['Claims are drawn as dashed edges.', 'Grant a request only if the graph, with claims as requests, stays free of cycles.', 'Single units only; with several units, use the banker.'] },
      X('dl-x-seq-four'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: detection, recovery and lock order
  // =========================================================================================================
  C.lesson({
    id: 'dl-detection', chapter: 'dl-detect', title: 'Detecting a deadlock', minutes: 7,
    summary: 'A system that neither prevents nor avoids deadlock can look for one now and then. The detection algorithm is the safety check with Request (what each process is blocked waiting for now) in place of Need: a process whose request can be met is assumed to finish and free its allocation. Whoever is left is deadlocked.',
    blocks: [
      'Avoidance makes every process declare its claims in advance, and most programs cannot. Many systems let deadlocks happen, rarely, and clean up. But first they must notice one. How?',
      { topic: 'dl-detect', frame: 0, caption: 'Allocation, Request (what each waits for now) and Available (0, 0, 0). P4 holds nothing, so Finish starts true for it.' },
      { topic: 'dl-detect', frame: 4, caption: 'P2 waits for nothing: it can finish and give back (0, 0, 1). Work becomes (0, 0, 1).' },
      { predict: { q: 'P0 waits for B, P1 for A and P3 for B. Work is (0, 0, 1). Can any of them finish now?', options: ['P0', 'P1', 'P3', 'None of them'], answer: 3, explain: 'None of the three waits for C, the only thing free; and nobody else can free anything.' } },
      { topic: 'dl-detect', frame: 9, caption: 'Nobody else can finish: P0, P1 and P3 are deadlocked.' },
      { topic: 'dl-detect', input: { request: '0 1 0; 1 0 0; 0 0 0; 0 0 1; 0 1 0' }, frame: 9, caption: 'Change one request (P3 now waits for C): P3 finishes after P2, then P1 and P0. No deadlock now.' },
      'How often to run it is a trade: every request is expensive, rarely means deadlocked processes sit idle for long, and so does everything waiting behind them. A falling CPU utilisation is a common trigger.',
      lab('Detection in the Deadlock lab', 'Type your own Allocation and Request: detection runs row by row, then recovery.', { mode: 'detect', recover: 'none' }),
      { h: 'Recap' },
      { list: ['Detection = the safety check with Request instead of Need.', 'A process that holds nothing starts with Finish true: it can keep no one else waiting, though it may itself be stuck behind a deadlock.', 'Run it on a timer or when utilisation drops, not on every request.'] },
      X('dl-x-detect-set'), X('dl-x-units-set'),
    ],
  });

  C.lesson({
    id: 'dl-recovery', chapter: 'dl-detect', title: 'Recovery: abort or roll back', minutes: 6,
    summary: 'A deadlock is broken by taking resources away. Aborting every deadlocked process is simple and expensive; aborting one at a time, cheapest first, and detecting again often costs less. Preemption rolls a victim back to a checkpoint so it can ask again; adding a penalty for every earlier rollback keeps the same process from being chosen for ever.',
    blocks: [
      'Detection has named three deadlocked processes. Something must give. Which process do we sacrifice, and how much work is lost?',
      { topic: 'dl-recover-abort', frame: 2, caption: 'Abort P1, the cheapest deadlocked process (cost 2): its (0, 1, 0) returns, so Available is (0, 1, 0).' },
      { predict: { q: 'Detection runs again with Available (0, 1, 0). Must another process be aborted?', options: ['Yes: P0 and P3 are still waiting', 'No: P0 and P3 both wait for B, and one B is now free'], answer: 1, explain: 'P0 gets the B, finishes, and frees its A, which P1 no longer wants; P3 then gets B. One abort was enough.' } },
      { topic: 'dl-recover-abort', frame: 3, caption: 'Every process can now finish. In all P1 was aborted, at a cost of 2.' },
      { topic: 'dl-recover-abort', input: { policy: 'all' }, frame: 5, caption: 'Aborting all the deadlocked at once: P0, P1 and P3, at a cost of 9.' },
      { h: 'Preemption and rollback' },
      { topic: 'dl-recover-rollback', frame: 2, caption: 'Preempt from P1 (cost 2): roll it back to its checkpoint; its (0, 1, 0) goes back to Available. Its cost next time is 12, with the penalty of 10.' },
      { topic: 'dl-recover-rollback', frame: 3, caption: 'The deadlock is broken: 1 rollback in all, and nobody was killed.' },
      lab('Recovery in the Deadlock lab', 'Rollback to checkpoints, with your own costs and penalty.', { mode: 'detect', recover: 'rollback' }),
      { h: 'Recap' },
      { list: ['Abort all: simple, costly. Abort one at a time: detect again after each.', 'Choose victims by cost: work done, resources held, how much is left.', 'Rollback needs checkpoints, and a penalty per rollback avoids starvation.'] },
      X('dl-x-abort-cost'), X('dl-x-rollback-cost'), X('dl-x-recover-why'),
    ],
  });

  C.lesson({
    id: 'dl-locks', chapter: 'dl-detect', title: 'Locks: one order, and livelock', minutes: 9,
    summary: 'Most deadlocks in real programs are two threads taking two locks in opposite orders. The cure is one global order for locks. A lock-order checker records every "held, then acquired" pair as an edge; a cycle among them warns of a deadlock even after a run that did not deadlock. Backing off with a try-lock avoids deadlock but can livelock: busy for ever, with no progress.',
    blocks: [
      'Two threads, two mutexes. Thread T0 locks A then B; T1 locks B then A. It passes every test you run. Why can it still hang in production, and what is the cheapest fix?',
      { topic: 'dl-lock-order', frame: 6, caption: 'T0 holds A and waits for B; T1 holds B and waits for A. The model checker found this schedule among 21 states.' },
      { predict: { q: 'Both threads now take A first, then B. Can any schedule deadlock?', options: ['Yes, the same one', 'No: whoever gets A first gets B too', 'Only if a thread is preempted between the locks'], answer: 1, explain: 'Nobody can hold B while waiting for A, so a cycle cannot close: the other thread simply waits at A.' } },
      { topic: 'dl-lock-order', input: { variant: 'ordered', sched: 'worst' }, frame: 14, caption: 'One order: the checker tried every schedule (34 states) and none deadlocks.' },
      { h: 'Checking the order on a good run' },
      { topic: 'dl-lockdep', frame: 4, caption: 'T0 takes B while holding A, T1 takes C while holding B, T2 takes A while holding C: the edges A → B → C → A close a cycle, though this run did not deadlock.' },
      { topic: 'dl-lockdep', input: { prog: 'ordered' }, frame: 4, caption: 'Everyone in one order: 3 orders recorded, all consistent, and the model checker finds none of 208 states a deadlock.' },
      { h: 'Livelock' },
      { topic: 'dl-livelock', frame: 15, caption: 'Each thread holds its first lock and its try for the second fails at once. Nobody blocks.' },
      { topic: 'dl-livelock', frame: 36, caption: 'After 34 steps both threads ran all the time, backed off 6 times, and never entered the critical section.' },
      { tip: 'Livelock is broken by randomness (wait a random time before trying again) or, better, by the same cure as deadlock: one lock order.' },
      { h: 'Recap' },
      { list: ['Opposite lock orders are the commonest deadlock.', 'One global order (by address, by number, by level) prevents it.', 'A lock-order checker finds the danger without needing the bad timing.', 'Back-off avoids deadlock but can livelock.'] },
      X('dl-x-lockdep-edges'), X('dl-x-lockdep-warn'), X('dl-x-livelock'), X('dl-x-code-transfer'), X('dl-x-code-ring'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
