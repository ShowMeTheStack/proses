// Part 2, fork: one call, two returns. A real C program runs on the simulated kernel; beside its listing (each
// process's line marked) are the process tree, each process's own copy of the variables, and the terminal.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const PROGS = {
    twice: {
      label: 'fork returns twice', file: 'twice.c', names: ['k', 'x'],
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int x = 10;
    pid_t k = fork();
    if (k == 0) {
        x = x + 1;
        printf("child k=%d x=%d\\n", k, x);
        return 0;
    }
    x = x - 1;
    printf("parent k=%d x=%d\\n", k, x);
    wait(NULL);
    return 0;
}`,
    },
    ids: {
      label: 'getpid and getppid', file: 'ids.c', names: ['me', 'up', 'k'],
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t k = fork();
    pid_t me = getpid();
    pid_t up = getppid();
    if (k == 0)
        printf("%d of %d\\n", me, up);
    else {
        wait(NULL);
        printf("%d made %d\\n", me, k);
    }
    return 0;
}`,
    },
    two: {
      label: 'two children, one parent', file: 'two.c', names: ['a', 'b'],
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t a = fork();
    if (a == 0) {
        printf("first child\\n");
        return 0;
    }
    pid_t b = fork();
    if (b == 0) {
        printf("second child\\n");
        return 0;
    }
    printf("made %d and %d\\n", a, b);
    while (wait(NULL) > 0)
        ;
    return 0;
}`,
    },
  };
  P.PROGS_FORK = PROGS;
  /** a scheduling choice as kernel options */
  P.policy = (pol, seed) => (pol === 'child' ? { policy: 'hand', choose: (c, sys) => c.slice().sort((a, b) => (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0))[0] } : pol === 'random' ? { policy: 'random', seed } : { policy: 'fifo' });
  P.POLICIES = [{ value: 'fifo', label: 'the running process keeps the CPU' }, { value: 'child', label: 'the newest process runs first' }, { value: 'random', label: 'random, from the seed' }];

  S.topic({
    id: 'p02-fork', family: 'p02-api', order: 10, title: 'fork returns twice',
    blurb: 'fork makes a copy of the calling process: the same program, at the same line, with a copy of every variable. Both copies return from the one call. The parent gets the child\'s pid, the child gets 0, and that number is how the program tells them apart. From then on each changes only its own copy of the variables.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'twice', options: P.options(PROGS) },
      { id: 'pol', kind: 'choice', label: 'Who runs', def: 'fifo', options: P.POLICIES },
      { id: 'seed', kind: 'slider', label: 'Seed (random)', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'fork returns twice', values: { prog: 'twice', pol: 'fifo' } },
      { label: 'The child runs first', values: { prog: 'twice', pol: 'child' } },
      { label: 'getpid and getppid', values: { prog: 'ids', pol: 'fifo' } },
      { label: 'Two children', values: { prog: 'two', pol: 'fifo' } },
      { label: 'Two children, a random order', values: { prog: 'two', pol: 'random', seed: 4 } },
    ],
    counters: [{ id: 'procs', label: 'processes made' }, { id: 'lines', label: 'lines printed' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, Object.assign({ cow: false }, P.policy(inp.pol, inp.seed)));
      const bs = P.beats(sys), F = new S.Frames(['procs', 'lines']);
      bs.forEach((b) => {
        const live = b.snap.filter((p) => p.role === 'prog' && p.state !== 'reaped');
        const vals = live.map((p) => ({ pid: p.pid, act: p.pid === b.pid, vals: pr.names.map((n) => (b.vars[p.pid] ? P.val(b.vars[p.pid], n) : p.state === 'zombie' ? 'gone' : '—')) }));
        const sc = P.scene({ sys, beat: b, src: pr.src, file: pr.file, rowsShown: 3, extra: (y, rx, rw) => P.vars({ x: rx, y, names: pr.names, rows: vals, title: 'each process\'s own variables', colW: Math.min(80, Math.floor((rw - 80) / pr.names.length)), pidW: 80 }) });
        F.set('procs', b.snap.filter((p) => p.role === 'prog').length).set('lines', H.termRows(sys.term, b.nterm).length);
        let say = b.say;
        if (b.kind === 'fork') say = say + ' The child starts at the same line, as a copy.';
        F.add({ items: sc.items, say, meta: H.metaOf(b, { vars: vals.map((v) => [v.pid].concat(v.vals)) }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'fork', text: ['pid_t k = fork();', '  in the parent: k = the child\'s pid', '  in the child:  k = 0', '  on failure:    k = −1, no child', 'getpid(): my own pid', 'getppid(): my parent\'s pid', 'the child gets a copy of every', '  variable; changes stay private'].join('\n') }] }, result: { term: sys.term.map((w) => w.text).join('') } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'fork', once: true, pick: 'option', ask: 'fork has just returned in both processes. What value of k does the child see?', options: ['0', 'the child\'s own pid', 'the parent\'s pid', '−1'], answer: '0', explain: 'fork returns 0 in the child and the child\'s pid in the parent, so one test of k tells them apart.' },
      { at: (f, i, fr) => { const live = P.livePids(f), nx = fr.slice(i + 1).find((g) => g.meta.phase === 'print'); return f.meta.phase !== 'print' && live.length > 1 && nx && live.includes(nx.meta.evs[0].pid); }, once: true, pick: 'option', ask: 'Which process writes to the terminal next?', options: (fr, i) => P.livePids(fr[i]).map(String), answer: (fr, i) => String(fr.slice(i + 1).find((g) => g.meta.phase === 'print').meta.evs[0].pid), explain: (fr, i) => fr.slice(i + 1).find((g) => g.meta.phase === 'print').say },
    ],
    quiz: [
      { q: 'What does fork return in the parent?', options: ['the child\'s pid', '0', 'its own pid', '1'], answer: 0, why: 'The parent needs the child\'s pid to wait for it or signal it.' },
      { q: 'x is 10 before fork; the child adds 1 and the parent subtracts 1. What does each print?', options: ['the child 11, the parent 9', 'both 10', 'both 11', 'the child 11, the parent 10'], answer: 0, why: 'Each process changes its own copy; the copies do not see each other.' },
      { q: 'After fork, which process runs first?', options: ['it is up to the scheduler; a correct program must not depend on it', 'always the parent', 'always the child', 'the one with the smaller pid'], answer: 0, why: 'Either order is possible, which is why programs use wait to impose one.' },
      { q: 'Where does the child start running?', options: ['returning from the same fork call, at the same line', 'at the top of main', 'at the next function', 'nowhere until exec'], answer: 0, why: 'The child is a copy of the parent at the moment of the call, program counter included.' },
      { q: 'In the child, what does getppid() return?', options: ['the pid of the process that called fork', '0', '1 always', 'the child\'s own pid'], answer: 0, why: 'The parent is the process that forked it (until that parent exits and init adopts the child).' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
