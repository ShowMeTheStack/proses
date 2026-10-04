// Part 9, deadlocks: the exercises of chapter 1 (the graphs: cycles, units, wait-for edges) and chapter 2 (the four
// conditions, prevention, safe states and the banker's algorithm). Every answer, number and hint here is worked out
// by the engines (S.Rag, S.Banker, S.Dl) when this file loads: nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, B = S.Banker, RG = S.Rag;
  if (!C || !B || !RG || C.exercises.has('dl-x-cycle-pair')) return;
  const vec = (v) => '(' + v.join(', ') + ')';
  const strip = (t) => String(t).replace(/`/g, '');
  const P = (i) => 'P' + i;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // ---- the graphs ----------------------------------------------------------------------------------------------------
  /** the edges of a graph, in words: who holds what, who waits for what */
  const describe = (gr) => {
    const R = (r) => gr.res[r].name;
    const holds = gr.procs.map((p, i) => { const h = gr.hold.filter(([q]) => q === i).map(([, r]) => R(r)); const w = gr.want.filter(([q]) => q === i).map(([, r]) => R(r)); return p + (h.length ? ' holds ' + list(h) : ' holds nothing') + (w.length ? ' and waits for ' + list(w) : ' and waits for nothing'); });
    return holds.join('; ') + '.';
  };
  const units = (gr) => list(gr.res.map((r) => r.units + ' ' + (r.units === 1 ? 'unit' : 'units') + ' of ' + r.name));
  const cycOf = (gr) => { const g = RG.graph(gr), c = RG.cycle(g).cycle; return c ? c.map((id) => (id[0] === 'p' ? gr.procs[+id.slice(1)] : gr.res[+id.slice(1)].name)) : null; };

  const G_PAIR = { procs: ['P0', 'P1'], res: [{ name: 'Lathe', units: 1 }, { name: 'Drill', units: 1 }], hold: [[0, 0], [1, 1]], want: [[0, 1], [1, 0]] };
  const cPair = cycOf(G_PAIR);
  C.exercise({ id: 'dl-x-cycle-pair', chapter: 'dl-graphs', title: 'Two machines, two jobs', level: 1, kind: 'graph-cycle', graph: G_PAIR,
    text: ['A workshop has one lathe and one drill. ' + describe(G_PAIR) + ' Click the nodes of a cycle in the resource-allocation graph, or answer none.'],
    hints: ['An arrow from a process to a resource is a request (it waits); an arrow from a resource to a process is an assignment (it holds).', 'Start at P0 and follow the arrows: P0 waits for the drill. Who holds the drill?', 'The cycle is ' + cPair.join(' → ') + ' → ' + cPair[0] + ': each resource has one unit, so the two jobs are deadlocked.'],
    solution: cPair.join(', '), wrong: ['none', 'P0, P1'], why: 'With one unit of each resource, this cycle is a deadlock.' });

  const G_CHAIN = { procs: ['P0', 'P1', 'P2', 'P3'], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }, { name: 'R2', units: 1 }, { name: 'R3', units: 1 }], hold: [[0, 0], [1, 1], [2, 2], [3, 3]], want: [[0, 1], [1, 2], [2, 3]] };
  C.exercise({ id: 'dl-x-cycle-chain', chapter: 'dl-graphs', title: 'A queue of waits', level: 1, kind: 'graph-cycle', graph: G_CHAIN,
    text: ['Four processes and four single-unit resources. ' + describe(G_CHAIN) + ' Click the nodes of a cycle, or answer none.'],
    hints: ['Follow the waits from P0: whom does it wait for, and whom does that one wait for?', 'The chain P0 → R1 → P1 → R2 → P2 → R3 → P3 stops at P3, which waits for nothing.', 'There is no cycle: P3 will finish and free R3, then P2 can go on, then P1, then P0. Answer none.'],
    solution: 'none', wrong: ['P0, R1, P1, R2, P2, R3, P3', 'P0, R0'], why: 'Every chain of waits ends at P3, which is running.' });

  const G_OFFICE = { procs: ['P0', 'P1', 'P2', 'P3', 'P4'], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }, { name: 'R2', units: 1 }, { name: 'R3', units: 1 }],
    hold: [[0, 0], [1, 2], [2, 1], [3, 3]], want: [[0, 2], [1, 1], [2, 3], [3, 0], [4, 0]] };
  const cOffice = cycOf(G_OFFICE), dOffice = RG.deadlock(RG.graph(G_OFFICE));
  C.exercise({ id: 'dl-x-cycle-hidden', chapter: 'dl-graphs', title: 'The cycle among the waits', level: 2, kind: 'graph-cycle', graph: G_OFFICE,
    text: ['Five processes and four single-unit resources. ' + describe(G_OFFICE) + ' Find a cycle and click its nodes, or answer none.'],
    hints: ['A depth-first search keeps the path it is on; an arrow back to a node on the path closes a cycle.', 'From P0: P0 waits for R2, held by P1; P1 waits for R1, held by P2; P2 waits for R3, held by P3. Keep going.', 'The cycle is ' + cOffice.join(' → ') + ' → ' + cOffice[0] + '. P4 waits for R0 as well but holds nothing: it is stuck, but not on the cycle.'],
    solution: cOffice.join(', '), wrong: ['none', 'P0, R2, P1, R1, P2', 'P4, R0, P0, R2, P1'], why: 'Deadlocked: ' + dOffice.deadlocked.map(P).join(', ') + '.' });

  const G_SPARE = { procs: ['P0', 'P1', 'P2'], res: [{ name: 'Disk', units: 2 }, { name: 'Tape', units: 1 }], hold: [[0, 0], [1, 1], [2, 0]], want: [[0, 1], [1, 0]] };
  const cSpare = cycOf(G_SPARE), dSpare = RG.deadlock(RG.graph(G_SPARE));
  C.exercise({ id: 'dl-x-cycle-units', chapter: 'dl-graphs', title: 'A cycle with two disks', level: 2, kind: 'graph-cycle', graph: G_SPARE,
    text: ['There are ' + units(G_SPARE) + '. ' + describe(G_SPARE) + ' Find a cycle in the graph and click its nodes, or answer none. (Whether it is a deadlock is the next exercise.)'],
    hints: ['The Disk box has two dots; a request edge points at the box, not at one unit.', 'P0 waits for the tape, which P1 holds; P1 waits for a disk, and both disks are held, one by P0.', 'The graph has the cycle ' + cSpare.join(' → ') + ' → ' + cSpare[0] + '.'],
    solution: cSpare.join(', '), wrong: ['none', 'P2, Disk, P1'] });
  C.exercise({ id: 'dl-x-units-deadlock', chapter: 'dl-graphs', title: 'Is that cycle a deadlock?', level: 2, kind: 'choice',
    text: ['The same graph: ' + units(G_SPARE) + '. ' + describe(G_SPARE) + ' It has the cycle ' + cSpare.join(' → ') + ' → ' + cSpare[0] + '. Are P0 and P1 deadlocked?'],
    options: ['No: P2 holds the other disk and waits for nothing, so it will finish and free it; then P1, then P0 can go on', 'Yes: a cycle in a resource-allocation graph always means a deadlock', 'Yes, and P2 is deadlocked too, because it holds a disk on the cycle'],
    answer: dSpare.deadlocked.length ? 1 : 0,
    whyNot: { 1: 'A cycle proves a deadlock only when every resource on it has a single unit. Disk has two.', 2: 'P2 waits for nothing at all: it can run to the end.' },
    hints: ['With one unit per resource, a cycle is a deadlock. Here Disk has two units.', 'Who holds the second disk, and is that process waiting for anything?', 'P2 holds a disk and waits for nothing: it finishes and frees the disk, P1 gets it and finishes and frees the tape, and P0 finishes. The detection algorithm finds ' + (dSpare.deadlocked.length ? dSpare.deadlocked.map(P).join(', ') : 'nobody') + ' deadlocked.'],
    solution: 0, wrong: [1, 2] });

  const G_RING = { procs: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'], res: [{ name: 'A', units: 1 }, { name: 'B', units: 1 }, { name: 'C', units: 1 }, { name: 'D', units: 1 }, { name: 'E', units: 1 }],
    hold: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]], want: [[0, 1], [1, 3], [3, 2], [2, 1], [4, 0], [5, 4]] };
  const cRing = cycOf(G_RING), dRing = RG.deadlock(RG.graph(G_RING));
  C.exercise({ id: 'dl-x-cycle-big', chapter: 'dl-graphs', title: 'Six processes, five locks', level: 3, kind: 'graph-cycle', graph: G_RING,
    text: ['Six processes and five single-unit resources A to E. ' + describe(G_RING) + ' Find a cycle and click its nodes, or answer none. Not every waiting process is on it.'],
    hints: ['Start anywhere and follow the arrows; when you come back to a node already on your path, the part of the path from that node on is the cycle.', 'From P0: P0 waits for B, held by P1; P1 waits for D, held by P3; P3 waits for C, held by P2; P2 waits for B, which is already on the path.', 'The cycle is ' + cRing.join(' → ') + ' → ' + cRing[0] + '. P0, P4 and P5 wait on it from outside; the detection algorithm finds ' + dRing.deadlocked.map(P).join(', ') + ' deadlocked.'],
    solution: cRing.join(', '), wrong: ['none', 'P0, B, P1, D, P3, C, P2, B', 'P0, A, P4, E, P5'] });

  // ---- the wait-for graph -------------------------------------------------------------------------------------------
  const wf = RG.waitFor(RG.graph(G_OFFICE)).map((e) => '(' + G_OFFICE.procs[e.from] + ', ' + G_OFFICE.procs[e.to] + ')');
  C.exercise({ id: 'dl-x-waitfor', chapter: 'dl-graphs', title: 'Collapse it to a wait-for graph', level: 2, kind: 'set',
    text: ['The office graph again: every resource has one unit. ' + describe(G_OFFICE) + ' Write the edges of its wait-for graph as pairs (waiter, holder), like (P0, P1), (P2, P0).'],
    answer: wf.join(', '), caseless: true,
    hints: ['Each request edge P → R, followed through R to the process that holds R, becomes one edge P → holder.', 'P0 waits for R2 and P1 holds R2: (P0, P1). Do the same for every request edge.', 'The wait-for graph has ' + wf.length + ' edges: ' + wf.join(', ') + '.'],
    solution: wf.join(', '), wrong: [wf.slice(0, -1).join(', '), wf.map((p) => p.replace(/\((P\d), (P\d)\)/, '($2, $1)')).join(', ')],
    whyNot: 'An edge runs from the process that waits to the one that holds what it waits for, one for each request edge.' });

  // ---- the four conditions and prevention -------------------------------------------------------------------------------
  C.exercise({ id: 'dl-x-cond-which', chapter: 'dl-prevent', title: 'Which condition is broken?', level: 1, kind: 'choice',
    text: ['A print server takes whole jobs into a spool on disk, and only the spooler daemon ever talks to the printer. Programs that print never wait for the printer itself. Which of the four necessary conditions does that remove for the printer?'],
    options: ['Mutual exclusion', 'Hold and wait', 'No preemption', 'Circular wait'], answer: 0,
    whyNot: { 1: 'A program may still hold other things while it prints; what changed is that nobody waits to own the printer.', 2: 'Nothing is taken away from anyone.', 3: 'No order is imposed; the printer has simply stopped being something a program holds alone.' },
    hints: ['Ask what a program has to own, alone, to print.', 'With the spool, every program can "print" at once: the printer has become, in effect, shareable.', 'Mutual exclusion: the spool makes the printer shareable to the programs, so none of them can wait for it.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'dl-x-prevent-price', chapter: 'dl-prevent', title: 'The price of asking for everything', level: 2, kind: 'choice',
    text: ['A report job needs the scanner for its first minute and the plotter for its last minute of a ten-minute run. Under a rule that breaks hold and wait, it must ask for both at its first request. What does that cost?'],
    options: ['The plotter sits idle, held by the job, for about nine minutes, and others who need it wait', 'Nothing: it gets them one at a time as before', 'The job may be killed and restarted when it waits', 'The job may deadlock with another one that asks in the other order'],
    answer: 0,
    whyNot: { 1: 'Breaking hold and wait means all or nothing at the first request.', 2: 'That is the price of breaking no preemption, not hold and wait.', 3: 'Asking for everything at once means it never holds one while waiting for the other, so no cycle can form.' },
    hints: ['Under this rule a process holds nothing while it waits, because it waits for everything at once.', 'So the plotter is taken at minute 0 although it is needed only at minute 9.', 'Low utilisation: the plotter is held and idle for about nine minutes. In the prevention topic, this rule held units early for 4.6 unit-steps per run.'],
    solution: 0, wrong: [1, 3] });
  C.exercise({ id: 'dl-x-order-fix', chapter: 'dl-prevent', title: 'Numbering the resources', level: 2, kind: 'choice',
    text: ['Resources are numbered: R0 = tape, R1 = disk, R2 = printer. The rule is that a process may ask for a resource only if its number is higher than that of every resource it already holds. Which program breaks the rule?'],
    options: ['Hold the printer, then ask for the disk', 'Hold the tape, then ask for the printer', 'Hold the tape and the disk, then ask for the printer', 'Ask for the disk alone'], answer: 0,
    whyNot: { 1: 'R0, then R2: the numbers go up.', 2: 'R0 and R1, then R2: up.', 3: 'Holding nothing, any request is in order.' },
    hints: ['Under the rule every process climbs the numbers.', 'A wait can only point from a lower-numbered resource held to a higher one asked for, so a cycle would have to climb for ever.', 'Holding R2 and asking for R1 goes down: it breaks the order, and with it the guarantee that no circular wait can form.'],
    solution: 0, wrong: [1, 2] });

  // ---- safe states and the banker ----------------------------------------------------------------------------------------
  const bankText = (st) => {
    const N = st.alloc.length, R = st.avail.map((_, j) => String.fromCharCode(65 + j));
    return N + ' processes share the resource types ' + list(R) + '. Allocation: ' + st.alloc.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '. Max: ' + st.max.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '. Available: ' + vec(st.avail) + '.';
  };
  const safetyOf = (st) => B.safety({ avail: st.avail, alloc: st.alloc, need: B.need(st.max, st.alloc) });
  const says = (steps) => steps.map((s) => strip(s.say));

  const SA = { avail: [2, 1, 2], alloc: [[1, 1, 0], [2, 0, 1], [0, 1, 1], [1, 0, 2]], max: [[4, 2, 1], [2, 1, 3], [3, 3, 2], [1, 2, 3]] };
  const needA = B.need(SA.max, SA.alloc), safeA = safetyOf(SA);
  C.exercise({ id: 'dl-x-need', chapter: 'dl-avoid', title: 'Work out Need', level: 1, kind: 'table',
    text: [bankText(SA), 'Fill in the Need matrix: what each process may still ask for.'],
    rows: ['P0', 'P1', 'P2', 'P3'], cols: ['A', 'B', 'C'], corner: 'Need',
    cells: Object.fromEntries(needA.flatMap((r, i) => r.map((v, j) => [P(i) + '|' + 'ABC'[j], v]))),
    hints: ['Need = Max − Allocation, entry by entry.', 'P0: ' + vec(SA.max[0]) + ' − ' + vec(SA.alloc[0]) + ' = ' + vec(needA[0]) + '.', 'Need: ' + needA.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '.'],
    solution: Object.fromEntries(needA.flatMap((r, i) => r.map((v, j) => [P(i) + '|' + 'ABC'[j], String(v)]))),
    wrong: [Object.fromEntries(SA.max.flatMap((r, i) => r.map((v, j) => [P(i) + '|' + 'ABC'[j], String(v)]))), Object.fromEntries(needA.flatMap((r, i) => r.map((v, j) => [P(i) + '|' + 'ABC'[j], String(i === 2 && j === 1 ? v + 1 : v)])))] });

  C.exercise({ id: 'dl-x-seq-four', chapter: 'dl-avoid', title: 'A safe sequence', level: 1, kind: 'banker', ask: 'sequence', avail: SA.avail, alloc: SA.alloc, max: SA.max,
    text: [bankText(SA), 'Find an order in which every process can run to the end, each one getting its whole Need when its turn comes, or write none.'],
    hints: ['Work out Need first: ' + needA.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '.', 'Only one process\'s Need fits in Available ' + vec(SA.avail) + ' at the start. When it finishes, it gives back its whole allocation.', says(safeA.steps).filter((s, k) => safeA.steps[k].fits || safeA.steps[k].kind === 'safe').join(' ')],
    solution: safeA.seq.map(P).join(', '), wrong: ['P0, P1, P2, P3', 'none', 'P1, P2, P0, P3'] });

  const WA = (() => { const rows = {}; let w = SA.avail.slice(); for (const i of safeA.seq) { w = w.map((v, j) => v + SA.alloc[i][j]); rows[P(i)] = w.slice(); } return rows; })();
  C.exercise({ id: 'dl-x-work', chapter: 'dl-avoid', title: 'Work, row by row', level: 2, kind: 'table',
    text: [bankText(SA), 'Run the safety check as the algorithm does: scan the rows from P0 down, again and again, finishing any process whose Need fits in Work. Fill in Work just after each process finishes.'],
    rows: Object.keys(WA).sort(), cols: ['A', 'B', 'C'], corner: 'Work after',
    cells: Object.fromEntries(Object.entries(WA).flatMap(([p, w]) => w.map((v, j) => [p + '|' + 'ABC'[j], v]))),
    hints: ['Work starts at Available, ' + vec(SA.avail) + '. A process that finishes adds its Allocation (not its Need) to Work.', 'The first pass finishes ' + P(safeA.seq[0]) + ' (Work ' + vec(WA[P(safeA.seq[0])]) + '), then ' + P(safeA.seq[1]) + ' fits on the second pass.', says(safeA.steps).filter((s, k) => safeA.steps[k].fits).join(' ')],
    solution: Object.fromEntries(Object.entries(WA).flatMap(([p, w]) => w.map((v, j) => [p + '|' + 'ABC'[j], String(v)]))),
    wrong: [Object.fromEntries(Object.entries(WA).flatMap(([p, w]) => w.map((v, j) => [p + '|' + 'ABC'[j], String(v + (p === 'P3' && j === 0 ? 1 : 0))])))] });

  const SB = { avail: [0, 2, 2, 2], alloc: [[2, 0, 0, 2], [1, 2, 2, 0], [2, 1, 1, 1], [0, 0, 2, 1], [2, 0, 2, 1]], max: [[5, 3, 1, 5], [1, 4, 5, 2], [2, 1, 2, 2], [3, 1, 2, 2], [4, 2, 4, 1]] };
  const needB = B.need(SB.max, SB.alloc), safeB = safetyOf(SB);
  C.exercise({ id: 'dl-x-seq-five', chapter: 'dl-avoid', title: 'Five processes, four types', level: 2, kind: 'banker', ask: 'sequence', avail: SB.avail, alloc: SB.alloc, max: SB.max,
    text: [bankText(SB), 'Find a safe sequence, or write none.'],
    hints: ['Need: ' + needB.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '.', 'With no A free, only a process that needs no more A can go first.', says(safeB.steps).filter((s, k) => safeB.steps[k].fits || safeB.steps[k].kind === 'safe').join(' ')],
    solution: safeB.seq.map(P).join(', '), wrong: ['P2, P0, P4, P1, P3', 'none', safeB.seq.slice(0, 4).map(P).join(', ')] });

  const SU = { avail: [2, 1, 1], alloc: [[2, 1, 0], [2, 0, 0], [1, 2, 1], [0, 0, 2], [0, 1, 1]], max: [[2, 2, 1], [3, 0, 2], [2, 2, 4], [0, 1, 5], [3, 2, 1]] };
  const needU = B.need(SU.max, SU.alloc), safeU = safetyOf(SU);
  const doneU = safeU.steps.filter((s) => s.fits).map((s) => s.i);
  C.exercise({ id: 'dl-x-seq-none', chapter: 'dl-avoid', title: 'Three finish, then nobody', level: 2, kind: 'banker', ask: 'sequence', avail: SU.avail, alloc: SU.alloc, max: SU.max,
    text: [bankText(SU), 'Find a safe sequence, or write none.'],
    hints: ['Need: ' + needU.map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '.', doneU.map(P).join(', ') + ' can finish one after another. What is Work then, and what do the two left still need?', says(safeU.steps).filter((s, k) => safeU.steps[k].fits || safeU.steps[k].kind === 'unsafe').join(' ') + ' Answer none.'],
    solution: 'none', wrong: [doneU.concat([2, 3]).map(P).join(', '), 'P0, P4, P1, P3, P2'], why: 'Unsafe is not yet deadlocked: P2 and P3 might never ask for their whole claims. But the banker cannot promise that every process finishes.' });

  // how many more units of C would make it safe
  const extraU = (() => { for (let k = 1; k < 10; k++) { const a = SU.avail.slice(); a[2] += k; if (B.safety({ avail: a, alloc: SU.alloc, need: needU }).safe) return k; } return null; })();
  const fixU = (() => { const a = SU.avail.slice(); a[2] += extraU; return B.safety({ avail: a, alloc: SU.alloc, need: needU }); })();
  C.exercise({ id: 'dl-x-extra', chapter: 'dl-avoid', title: 'One more unit?', level: 3, kind: 'number',
    text: [bankText(SU), 'The state is unsafe. The machine room can add units of C to Available before anything else happens. What is the fewest units of C that make the state safe?'],
    answer: extraU, higherLower: true, whyNot: { '0': 'With Available as it is the check stops with P2 and P3 unfinished.', '3': 'That is P2\'s whole Need of C. But P2 does not have to go first.', '*': 'Run the check again with Available\'s C raised by your number and see whether every row finishes.' },
    hints: ['Run the check: after ' + doneU.map(P).join(', ') + ' finish, Work is ' + vec(safeU.work) + '.', 'P2 needs ' + vec(needU[2]) + ' and P3 needs ' + vec(needU[3]) + ': both are short only of C. Once one of them finishes, it gives back its C.', 'With ' + extraU + ' more of C: ' + says(fixU.steps).filter((s, k) => fixU.steps[k].kind === 'safe').join(' ').replace(/^\w/, (c) => c.toLowerCase())],
    solution: extraU, wrong: [0, 3] });

  const SV = { avail: [1, 1, 0], alloc: [[1, 0, 1], [0, 1, 1], [2, 0, 0]], max: [[2, 1, 1], [1, 2, 2], [3, 1, 1]] };
  const safeV = safetyOf(SV);
  C.exercise({ id: 'dl-x-safe-small', chapter: 'dl-avoid', title: 'Safe or unsafe?', level: 1, kind: 'banker', ask: 'verdict', avail: SV.avail, alloc: SV.alloc, max: SV.max,
    text: [bankText(SV), 'Is this state safe or unsafe?'],
    hints: ['Need: ' + B.need(SV.max, SV.alloc).map((r, i) => P(i) + ' ' + vec(r)).join(', ') + '.', 'Which Need fits in Available ' + vec(SV.avail) + '? Give its allocation back and look again.', says(safeV.steps).filter((s, k) => safeV.steps[k].fits || /safe/.test(safeV.steps[k].kind)).join(' ')],
    solution: safeV.safe ? 'safe' : 'unsafe', wrong: [safeV.safe ? 'unsafe' : 'safe'], whyNot: 'Run the check: Work starts at Available, and each process that can finish gives its allocation back.' });

  // ---- requests -------------------------------------------------------------------------------------------------------
  const SR = { avail: [2, 2, 1], alloc: [[1, 2, 0], [0, 1, 1], [2, 0, 1], [1, 1, 1]], max: [[3, 3, 2], [2, 4, 1], [4, 1, 2], [1, 3, 2]] };
  const needR = B.need(SR.max, SR.alloc);
  const reqEx = (id, title, level, who, req, extra) => {
    const r = B.request(SR, who, req);
    const tests = r.steps.slice(0, 3).map((s) => strip(s.say));
    const last = r.steps[r.steps.length - 1];
    return C.exercise(Object.assign({ id, chapter: 'dl-avoid', title, level, kind: 'banker', ask: 'verdict', avail: SR.avail, alloc: SR.alloc, max: SR.max, request: { who, req },
      text: [bankText(SR), P(who) + ' asks for ' + vec(req) + '. What does the banker do? Answer granted, wait (the units are not free), unsafe (free, but granting would leave an unsafe state) or over-need (more than its claim).'],
      hints: ['Three tests in order: Request ≤ Need? Request ≤ Available? Then pretend to grant it and run the safety check.', P(who) + '\'s Need is ' + vec(needR[who]) + ' and Available is ' + vec(SR.avail) + '.', tests.concat((r.verdict === 'granted' || r.verdict === 'unsafe') && !tests.includes(strip(last.say)) ? [strip(last.say)] : []).join(' ')],
      solution: r.verdict, wrong: ['granted', 'wait', 'unsafe', 'over-need'].filter((v) => v !== r.verdict).slice(0, 2) }, extra || {}));
  };
  reqEx('dl-x-req-granted', 'A request granted', 2, 2, [1, 1, 0]);
  reqEx('dl-x-req-unsafe', 'Free, but refused', 2, 1, [1, 1, 0], { whyNot: 'The units are free; look at the state granting them would leave.' });
  reqEx('dl-x-req-wait', 'Not enough free', 1, 1, [0, 3, 0]);
  reqEx('dl-x-req-over', 'More than it declared', 1, 3, [1, 0, 0]);

  // ---- the fewest units that can never deadlock (checked by the model checker in a scratch run: 8 units deadlock, 9 do not) --
  C.exercise({ id: 'dl-x-pool-min', chapter: 'dl-prevent', title: 'How many drives are enough?', level: 2, kind: 'number',
    text: ['Four backup jobs share a pool of identical tape drives. Each job takes drives one at a time until it holds 3, works, then gives all 3 back. Nobody declares anything and nothing is taken back. What is the fewest drives in the pool for which no order of requests can deadlock?'],
    answer: 9, higherLower: true, whyNot: { '12': 'That is enough for everyone at once, but fewer will do: only one job needs to be able to finish.', '8': 'With 8, every job can hold 2 drives and wait for a third: no drive is left.', '*': 'Think of the worst case: every job one drive short.' },
    hints: ['The worst case is every job holding all but one of the drives it needs.', 'That is 4 × 2 = 8 drives held, with all four jobs waiting.', 'One more drive, 9 in all, lets some job finish and free 3; then the others can finish in turn. The model checker agrees: with 8 drives some schedule deadlocks, with 9 none does.'],
    solution: 9, wrong: [8, 12] });
})(globalThis.Proses = globalThis.Proses || {});
