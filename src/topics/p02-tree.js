// Part 2, fork trees: how many processes a few forks make. Every process alive at a fork runs it, so forks in a
// row double the count, a fork whose child leaves the loop makes a fan, one whose parent leaves makes a chain,
// and a fork inside && or || makes three where there was one. The tree grows as the real C program runs.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const HEAD = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n#define N ';
  const TAIL = '    printf("I am %d\\n", getpid());\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}';
  const SHAPES = {
    seq: { label: 'fork(); written N times', max: 3, count: (n) => 2 ** n, body: (n) => Array.from({ length: n }, () => '    fork();').join('\n') },
    loop: { label: 'fork() in a loop', max: 3, count: (n) => 2 ** n, body: () => '    for (int i = 0; i < N; i++)\n        fork();' },
    fan: { label: 'the child leaves the loop: a fan', max: 4, count: (n) => n + 1, body: () => '    for (int i = 0; i < N; i++)\n        if (fork() == 0)\n            break;' },
    chain: { label: 'the parent leaves the loop: a chain', max: 4, count: (n) => n + 1, body: () => '    for (int i = 0; i < N; i++)\n        if (fork() != 0)\n            break;' },
    and: { label: 'fork() && fork()', max: 2, count: (n) => 3 ** n, body: () => '    for (int i = 0; i < N; i++)\n        fork() && fork();' },
    or: { label: 'fork() || fork()', max: 2, count: (n) => 3 ** n, body: () => '    for (int i = 0; i < N; i++)\n        fork() || fork();' },
  };
  P.SHAPES = SHAPES;
  P.treeSrc = (shape, n) => HEAD + n + '\n\nint main(void) {\n' + SHAPES[shape].body(n) + '\n' + TAIL;

  S.topic({
    id: 'p02-forktree', family: 'p02-api', order: 20, title: 'Counting the processes in a fork tree',
    blurb: 'Every process that reaches a fork runs it, the children made by earlier forks included. So N forks in a row make 2^N processes, a fan or a chain makes N + 1, and fork() && fork() turns one process into three. Each process prints one line, so the count of lines is the count of processes. Watch the tree grow and count.',
    inputs: [
      { id: 'shape', kind: 'choice', label: 'Program', def: 'loop', options: Object.keys(SHAPES).map((k) => ({ value: k, label: SHAPES[k].label })) },
      { id: 'n', kind: 'number', label: 'N', def: 3, min: 1, max: 4, check: (v, inp) => (v > SHAPES[inp.shape].max ? 'N: at most ' + SHAPES[inp.shape].max + ' for this program, so the tree fits' : null) },
      { id: 'pol', kind: 'choice', label: 'Who runs', def: 'fifo', options: P.POLICIES },
      { id: 'seed', kind: 'slider', label: 'Seed (random)', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'Three forks in a loop: 8', values: { shape: 'loop', n: 3, pol: 'fifo' } },
      { label: 'Two forks written out', values: { shape: 'seq', n: 2, pol: 'child' } },
      { label: 'A fan of four children', values: { shape: 'fan', n: 4, pol: 'fifo' } },
      { label: 'A chain four deep', values: { shape: 'chain', n: 4, pol: 'fifo' } },
      { label: 'fork() && fork(), twice: 9', values: { shape: 'and', n: 2, pol: 'random', seed: 3 } },
      { label: 'fork() || fork()', values: { shape: 'or', n: 1, pol: 'fifo' } },
    ],
    counters: [{ id: 'procs', label: 'processes so far' }, { id: 'lines', label: 'lines printed' }],
    run(inp) {
      const src = P.treeSrc(inp.shape, inp.n), sys = P.run(src, Object.assign({ cow: false }, P.policy(inp.pol, inp.seed)));
      const bs = P.beats(sys, { skip: ['block'] }), F = new S.Frames(['procs', 'lines']);
      const total = sys.procs.filter((p) => p.role === 'prog').length, lines = H.termRows(sys.term, sys.term.length).length;
      const leaves = (() => { const kids = new Set(sys.procs.map((p) => p.ppid)); return sys.procs.filter((p) => p.role === 'prog' && !kids.has(p.pid)).length; })();
      const rw = 870 - 444, boxW = Math.min(100, Math.floor((rw - (leaves - 1) * 6) / leaves));
      bs.forEach((b) => {
        const sc = P.scene({ sys, beat: b, src, file: 'tree.c', boxW, boxH: 34, levelH: 50, gap: 6, oneLine: true, rowsShown: 4 });
        const now = b.snap.filter((p) => p.role === 'prog').length;
        F.set('procs', now).set('lines', H.termRows(sys.term, b.nterm).length);
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { now, total, lines, n: inp.n }), title: b.kind });
      });
      F.add({ items: F.last().items, say: 'In all ' + H.plural(total, 'process', 'processes') + ' ran this program, and each printed one line: ' + H.plural(lines, 'line') + ' on the terminal.', meta: { phase: 'total', total, lines, n: inp.n } });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Counting', text: ['N forks in a row: 2^N processes', '  (each fork doubles the count)', 'child breaks out: a fan, N + 1', 'parent breaks out: a chain, N + 1', 'fork() && fork(): 3 from 1', '  only the parent forks again', 'fork() || fork(): 3 from 1', '  only the first child forks again'].join('\n') }] }, result: { total, lines } };
    },
    predict: [
      { at: (f, i) => i === 0, once: true, pick: 'option', ask: 'How many lines will this program print in all?', options: (fr, i, inp) => [...new Set([inp.n + 1, 2 * inp.n, 2 ** inp.n, 3 ** inp.n, 2 ** (inp.n + 1) - 1, fr[fr.length - 1].meta.lines])].sort((a, b) => a - b).map(String), answer: (fr) => String(fr[fr.length - 1].meta.lines), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'fork(); fork(); fork(); then printf("x"). How many x?', options: ['8', '3', '4', '6'], answer: 0, why: 'Each fork doubles the processes that reach it: 2, 4, 8.' },
      { q: 'for (i = 0; i < 4; i++) if (fork() == 0) break; How many processes in all?', options: ['5', '16', '4', '8'], answer: 0, why: 'Only the original parent keeps looping; each child breaks out at once: 1 parent and 4 children.' },
      { q: 'How many processes does fork() && fork(); make from one?', options: ['3', '4', '2', '1'], answer: 0, why: 'The child of the first fork sees 0 and skips the second; the parent forks again.' },
      { q: 'In a chain (the parent breaks out after forking), how deep is the tree for N = 4?', options: ['4 levels below the first process', '1 level', '2 levels', '16 levels'], answer: 0, why: 'Each child goes on to fork the next one, so each new process is the child of the last.' },
      { q: 'Why does each process here loop on wait(NULL) before returning?', options: ['to reap its own children, so none is left a zombie', 'to make the output faster', 'because fork needs it', 'to stop the children from printing'], answer: 0, why: 'wait returns −1 once there are no children left, ending the loop.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
