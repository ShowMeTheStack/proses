// Part 2, every ordering: a small program with two processes can print in several orders. The kernel's enumerator
// (S.Kern.outcomes) tries every schedule and lists every output the program can produce; each output is shown as a
// card, and for each one a real run that produced it (a seeded random schedule) tags every line with its writer.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    mixed: {
      label: 'the child prints two lines, the parent one before wait', file: 'mix.c',
      src: INC + `int main(void) {
    if (fork() == 0) {
        printf("a\\n");
        printf("b\\n");
        return 0;
    }
    printf("c\\n");
    wait(NULL);
    printf("d\\n");
    return 0;
}`,
    },
    nowait: {
      label: 'two lines each, no wait', file: 'free.c',
      src: INC + `int main(void) {
    if (fork() == 0) {
        printf("child 1\\n");
        printf("child 2\\n");
        return 0;
    }
    printf("parent 1\\n");
    printf("parent 2\\n");
    return 0;
}`,
    },
    counter: {
      label: 'a counter in each copy', file: 'count.c',
      src: INC + `int n = 0;

int main(void) {
    pid_t k = fork();
    n = n + 1;
    if (k == 0)
        printf("child n=%d\\n", n);
    else
        printf("parent n=%d\\n", n);
    return 0;
}`,
    },
    waits: {
      label: 'wait before printing', file: 'order.c',
      src: INC + `int main(void) {
    if (fork() == 0) {
        printf("first\\n");
        return 0;
    }
    wait(NULL);
    printf("second\\n");
    return 0;
}`,
    },
  };
  P.PROGS_ORDERS = PROGS;
  const memo = new Map();
  /** every output, and for each a seed whose random schedule (sleep only yields) produced it */
  P.orders = function (src) {
    if (memo.has(src)) return memo.get(src);
    const o = S.Kern.outcomes(src, {}), outs = [...o.outputs.keys()].sort(), seeds = {};
    for (let seed = 1; seed <= 300 && Object.keys(seeds).length < outs.length; seed++) {
      const sys = S.Kern.run(src, { policy: 'random', seed, sleep: 'free', cow: false });
      if (!(sys.out in seeds)) seeds[sys.out] = seed;
    }
    const r = { outs, seeds, states: o.states, complete: o.complete };
    memo.set(src, r);
    return r;
  };

  function cards(outs, cur, x, y, w) {
    const items = [], n = outs.length, cols = Math.min(n, n > 4 ? 3 : n), gap = 8, cw = Math.floor((w - (cols - 1) * gap) / cols);
    const maxL = Math.max(...outs.map((o) => o.split('\n').filter(Boolean).length));
    const ch = 28 + maxL * 19;
    items.push(H.text('oct', x, y + 13, 'every output it can print: ' + n, 'title', 13));
    outs.forEach((o, k) => {
      const cx = x + (k % cols) * (cw + gap), cy = y + 22 + Math.floor(k / cols) * (ch + gap);
      items.push(H.cell('oc' + k, cx, cy, cw, ch, '', 'outc' + (k === cur ? ' act' : ''), { rx: 6 }));
      items.push(H.text('ot' + k, cx + 8, cy + 18, '#' + (k + 1), k === cur ? 'act' : 'addr', 13));
      o.split('\n').filter(Boolean).forEach((l, j) => items.push(H.text('ol' + k + '_' + j, cx + 34, cy + 18 + j * 19, l, 'mono', 13)));
    });
    return { items, h: 22 + Math.ceil(n / cols) * (ch + gap) };
  }

  S.topic({
    id: 'p02-orders', family: 'p02-copy', order: 30, title: 'Every order a program can print in',
    blurb: 'Once a process has forked, the scheduler may run parent and child in any interleaving, so a program can print its lines in several orders. Here the kernel tries every schedule of a small program and collects every output it can produce. A correct program either does not care, or forces the order it needs with wait. Every output shown is one a real machine can print; no other can appear.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'mixed', options: P.options(PROGS) }],
    presets: [
      { label: 'Two lines and two lines around a wait', values: { prog: 'mixed' } },
      { label: 'No wait at all', values: { prog: 'nowait' } },
      { label: 'Each copy has its own counter', values: { prog: 'counter' } },
      { label: 'wait fixes the order', values: { prog: 'waits' } },
    ],
    counters: [{ id: 'outs', label: 'possible outputs' }, { id: 'states', label: 'states explored' }],
    run(inp) {
      const pr = PROGS[inp.prog], R = P.orders(pr.src), F = new S.Frames(['outs', 'states']);
      const n = R.outs.length;
      F.set('outs', n).set('states', R.states);
      const base = P.run(pr.src, { cow: false, policy: 'fifo' }), bs0 = P.beats(base);
      const first = bs0[0];
      const sc0 = P.scene({ sys: base, beat: first, src: pr.src, file: pr.file, noTree: true, term: false, extra: (y, rx, rw) => cards(R.outs, -1, rx, y, rw) });
      F.add({ items: sc0.items, say: 'The kernel explored ' + R.states + ' states, every way to schedule the two processes, and found ' + H.plural(n, 'different output') + '.', meta: { phase: 'all', n, states: R.states } });
      R.outs.forEach((o, k) => {
        const seed = R.seeds[o];
        const sys = seed ? P.run(pr.src, { cow: false, policy: 'random', seed, sleep: 'free' }) : null;
        const bs = sys ? P.beats(sys) : null, last = bs ? bs[bs.length - 1] : null;
        const lines = o.split('\n').filter(Boolean);
        const sc = P.scene({ sys: sys || base, beat: last || first, src: pr.src, file: pr.file, noTree: true, rowsShown: Math.max(...R.outs.map((x) => x.split('\n').filter(Boolean).length)), termTitle: sys ? 'a run that prints #' + (k + 1) + ' (seed ' + seed + ')' : 'terminal', extra: (y, rx, rw) => cards(R.outs, k, rx, y, rw) });
        const who = sys ? H.termRows(sys.term, sys.term.length).map((r) => r.pids[0]) : [];
        const story = who.length ? lines.map((l, j) => '"' + l + '" by ' + who[j]).join(', ') : lines.map((l) => '"' + l + '"').join(', ');
        F.add({ items: sc.items, say: 'Output #' + (k + 1) + ' of ' + n + ': ' + story + '.' + (seed ? ' It comes from a random schedule (seed ' + seed + ').' : ''), meta: { phase: 'out', k: k + 1, n, seed: seed || null, who, out: o } });
      });
      const verdict = n === 1 ? 'Only one output is possible: the program forces its order.' : 'All ' + n + ' outputs are correct runs of this program; none is a bug of the machine. If one order matters, the program must enforce it, with wait or another way to synchronise.';
      F.add({ items: F.list[0].items, say: verdict, meta: { phase: 'verdict', n } });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Counting interleavings', text: ['after fork, either process may', '  run next, at every step', 'a lines in one, b in the other,', '  no waiting: (a + b)! / (a! b!)', '  orders, e.g. 2 and 2: 6', 'wait(NULL): everything the child', '  prints comes before what the', '  parent prints after the wait'].join('\n') }] }, result: { outs: R.outs } };
    },
    predict: [
      { at: (f, i) => i === 0, once: true, pick: 'option', ask: 'How many different outputs can this program print?', options: (fr) => [...new Set([1, 2, 3, 4, 6, fr[0].meta.n])].sort((a, b) => a - b).map(String), answer: (fr) => String(fr[0].meta.n), explain: (fr) => fr[0].say },
    ],
    quiz: [
      { q: 'Parent and child each print two lines, with no wait. How many orders are possible?', options: ['6', '2', '4', '24'], answer: 0, why: 'Choose which 2 of the 4 places the child\'s lines take: 4! / (2! 2!) = 6, each keeping its own order.' },
      { q: 'Can the child\'s two lines ever appear in the reverse order?', options: ['no: one process runs its own statements in order', 'yes, if the scheduler wants', 'only on a pipe', 'only with two CPUs'], answer: 0, why: 'Interleaving mixes processes; it never reorders one process\'s own steps.' },
      { q: 'Both processes add 1 to a global n that was 0, then print it. What do they print?', options: ['both print 1', 'one prints 1, the other 2', 'both print 2', 'it depends on the order'], answer: 0, why: 'After fork each has its own copy of n.' },
      { q: 'How does a parent make sure its line comes after everything the child prints?', options: ['call wait before printing', 'print later in the source', 'sleep(1)', 'call fork again'], answer: 0, why: 'wait returns only after the child has exited; sleep only makes it likely.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
