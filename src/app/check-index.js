// EXERCISE KINDS: the reference for content writers. An exercise is
//   S.Content.exercise({ id, chapter, title, level: 1..3, kind, text: ['paragraph' | lesson block, ...],
//     hints: [hint 1, hint 2, 'the worked answer'], solution: <an answer that passes>,
//     wrong: [<answers that fail>, ...], why: 'said after a right answer', whyNot: 'said after a wrong one',
//     sample: true (placeholder content, warned about), ...the fields of its kind })
// tools/check-content.mjs runs the solution and every wrong answer through the checker: the solution must pass and
// every wrong answer must fail. Write a wrong answer for each mistake you expect, and read its message: it is what
// the student sees (node tools/check-content.mjs <id prefix> --verbose). Numbers in text and answers come from the
// engines (src/core), worked out in a scratch script with tests/load.mjs, never typed from memory.
//
// Every checker returns { ok, message, details? }; message is one plain sentence with the actual values.
//
// ---- the basic kinds (src/app/check-basic.js, check-table.js) -------------------------------------------------------
//   choice      options: ['..'], answer: index | [indexes] (several right: the reader picks all); whyNot: {index: 'why
//               that option is wrong'}. Options and text may use `code`, **bold** and [links](#topic=id).
//                                                                                      Answer: index or [indexes]
//   string      answer: 'text' | [...] or accept(text) -> true | false | 'why not' | {ok, why}; set: true compares as
//               sets; caseless: true; spaces: true keeps single spaces; placeholder; synonyms: [['system call',
//               'syscall', 'sys call'], ..] or {'system call': ['syscall']} (an answer, or a set's element, that is
//               any word of a group reads as the group's first; with caseless the case is ignored).   Answer: text
//   number      answer: a number; tolerance (absolute, e.g. 0.005 for an answer to two decimals); higherLower: true
//               says whether the answer is more or less; whyNot: 'sentence' or {value: 'why that slip', '*': 'any
//               other value'} (keys are the numbers as typed, like '0.75'). Fractions like 3/4 are not read here: ask
//               for a decimal. A trailing % is read as the number before it (an answer asked as a percentage:
//               66.7% is 66.7); percent: 'fraction' when the answer is a fraction (66.7% is then 0.667). Answer: number
//   set         answer: '{a, b}' | '(1, 2), (2, 3)' | '{{a, b}, {c}}' (or several), or accept(value, canonical);
//               caseless; synonyms (as for string, element by element). One element typed without braces (P1) is
//               read as the set {P1}. For the processes in a safe sequence, the pages in memory.   Answer: text
//   table       rows: ['r0', ..], cols: ['c0', ..], cells: {'row|col': expected}, cellKind: 'number' | 'text' | 'bit' |
//               'set' (numbers when every expected value is a number), tolerance (number cells), corner (the
//               top-left label); synonyms and caseless as for string (text cells ignore case always). Only the cells listed are asked for. A schedule's finish and waiting times,
//               the frames after each reference, a banker's Need table. With no wrong answers listed, the solution
//               with one cell changed is tried.                                        Answer: {'row|col': text}
//
// ---- the operating-systems kinds (src/app/check-os-*.js; answer areas in src/app/exercises-os-*.js) ------------------
// Every expected value comes from an engine (src/core), never typed in. Numbers may be typed in decimal, 0x hex or 0b
// binary. Each kind has example() (a complete sample: node tools/check-content.mjs --kinds tries them all), lint and,
// where it can, wrongFrom (wrong answers made from the solution).
//   gantt             workload: [{id, arrive, bursts: [cpu, io, ..], prio, tickets, nice}], policy: 'fcfs' | 'sjf' |
//                     'srtn' | 'prio' | 'rr' | 'mlfq' | 'mlq' | 'lottery' | 'stride' | 'cfs', params, ask: 'both' |
//                     'chart' | 'metrics', metrics: ['finish', 'waiting', 'turnaround', 'response'].
//                     Answer: {ticks: ['A', 'A', '-', 'cs', ..] | 'AA-B', metrics: {'A|finish': '9'}} (or segs)
//   address-split     vaBits, pageBytes, levels, bits?: [top..], pteBytes, va.   Answer: {L1: '2', .., offset: '228'}
//   page-walk         the same plus paBits, map: [[vpn, pfn]..], tableFrame?, ask: ['index', 'entry', 'next'].
//                     Answer: {'L1|index', 'L1|entry', 'L1|next', .., pa} ('fault' where the walk stops)
//   replacement-table refs: [page..], frames, policy (S.Mem.policies), opts.
//                     Answer: {'f0|1': '7', .., 'fault|1': 'F'} (frame rows f0.., a fault row; columns 1..n)
//   banker            avail, alloc, max, names?, res?, ask: 'sequence' | 'verdict', request?: {who, req}.
//                     Answer: 'P1, P0, P2, P3' (any safe order passes) or 'none'; a verdict: 'granted' | 'wait' |
//                     'unsafe' | 'over-need' (with a request) or 'safe' | 'unsafe'
//   graph-cycle       graph: {procs, res: [{name, units}], hold: [[p, r]], want: [[p, r]]}, exact.
//                     Answer: the names on a cycle ('P1, R2, P2, R1' or a list; any real cycle passes) or 'none'
//   fork-outputs      src, ask: 'count' | 'set' | 'lines', tty, input, sleep: 'timed' (real timing orders sleepers; default 'free': a sleep only yields), granularity: 'machine'.  Answer: a number, or the outputs one a line
//                     (an output's own newlines as spaces)
//   process-tree      src, names: {pid: 'P'}, policy, seed, ask: ['parents', 'zombie', 'orphan'].
//                     Answer: {parents: {A: 'P'}, zombie: ['A'], orphan: ['B']}
//   inode-walk        bs, ps, ndirect, levels, N, ask: 'walk' | 'max'.  Answer: {part: 'direct' | 'single' | 'double' |
//                     'triple', indices: '0, 5', offset: '9'}, or the largest file size in bytes
//   disk-order        policy: 'fcfs' | 'sstf' | 'scan' | 'look' | 'cscan' | 'clook', requests, start, cylinders, dir,
//                     ask: 'both' | 'order' | 'movement'.  Answer: {order: '72, 91, ..', movement: '248'}
//   raid-parity       chunks: [byte..] (one from each data disk), ask: 'p' | 'q'.  Answer: '0xA1' (two bare digits
//                     are read as hex)
//   semaphore-trace   sems: [{id, init}], threads: [{name, prog: ['wait s', 'post s', 'work']}], schedule: [name..],
//                     blocked: false (do not ask who is blocked).  Answer: {'1|s': '0', '1|blocked': 'T2', ..}
//   code              starter, tests: [{name, input, files, argv, tty, stdout | match | expect(sys), exit, seeds,
//                     policy}], mc: {deadlock, invariants, maxStates, preemptions, failOnError}, maxSteps.
//                     granularity: 'machine' (loads and stores are steps, so count++ can race; default 'statement'),
//                     outputs: [text..] | {set, subset} (the outputs over every schedule, by S.Kern.outcomes),
//                     spec: [{kind: always | never | end | live | deadlock, what}] (the Sync lab's property rows,
//                     checked by its checker; live 'worker calls enter' is no starvation, by S.MC.live).
//                     Answer: the source. A compile error comes back as result.error {line, col, msg, hint}; a
//                     failing property as result.replay (the schedule, and the lasso's cycleFrom and cycleLen) and
//                     result.starved, and the answer area offers to replay it in the Sync lab.
// More kinds register through S.Check.os.kind(name, {check, checkAsync?, lint?, wrongFrom?, example}) with their
// answer area in S.ExerciseViews (src/app/exercises.js), and are listed here with their fields.
//
// Hints: three, the last a worked answer. Lesson blocks: src/app/lessons.js. Challenges (id, n, title, level, kind,
// story, task, target, marks: {silver, gold}, metricName, higher, limits, three hints, solution and at least two
// wrong answers): src/app/challenges-core.js.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  /** the kinds this file documents, for tools that list them */
  K.kindNames = ['choice', 'string', 'number', 'set', 'table', 'gantt', 'address-split', 'page-walk', 'replacement-table', 'banker',
    'graph-cycle', 'fork-outputs', 'process-tree', 'inode-walk', 'disk-order', 'raid-parity', 'semaphore-trace', 'code'];
})(globalThis.Proses = globalThis.Proses || {});
