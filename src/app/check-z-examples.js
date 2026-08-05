// Sample exercises for the basic kinds (choice, string, number, set, table), so `node tools/check-content.mjs --kinds`
// tries every kind the same way: the solution passes, the wrong answers fail with a message.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const H = ['Think about what the question names.', 'Work it out on paper first.', 'The worked answer is in the solution.'];
  const EX = {
    choice: () => ({ id: 'kind-choice', title: 'A state', text: ['A process waiting for a disk read is in which state?'], options: ['running', 'ready', 'blocked'], answer: 2, hints: H, solution: 2, wrong: [0, 1] }),
    string: () => ({ id: 'kind-string', title: 'A call', text: ['Which call makes a copy of the calling process?'], answer: 'fork', caseless: true, hints: H, solution: 'fork', wrong: ['exec', 'wait'] }),
    number: () => ({ id: 'kind-number', title: 'Forks', text: ['Three fork calls in a row, with no if: how many processes in the end?'], answer: 8, hints: H, solution: '8', wrong: ['6', '3'] }),
    set: () => ({ id: 'kind-set', title: 'Pages in memory', text: ['FIFO, 3 frames, references 1 2 3 4: which pages are in memory at the end?'], answer: '{2, 3, 4}', hints: H, solution: '{4, 3, 2}', wrong: ['{1, 2, 3}', '{1, 3, 4}'] }),
    table: () => ({ id: 'kind-table', title: 'Finish times', text: ['FCFS: A arrives at 0 needing 3, B at 1 needing 2. Their finish times?'], rows: ['A', 'B'], cols: ['finish'], cells: { 'A|finish': 3, 'B|finish': 5 }, hints: H, solution: { 'A|finish': '3', 'B|finish': '5' }, wrong: [{ 'A|finish': '3', 'B|finish': '2' }] }),
  };
  for (const [k, f] of Object.entries(EX)) if (K.kinds && K.kinds[k] && !K.kinds[k].example) K.kinds[k].example = () => Object.assign({ chapter: 'kinds', level: 1, kind: k }, f());
})(globalThis.Proses = globalThis.Proses || {});
