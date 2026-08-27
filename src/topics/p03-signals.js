// Part 3, signals, with real C programs on the simulated kernel: ^C at the terminal and what a handler, the default
// action and SIG_IGN make of it; the mask, which holds a signal pending until it is unblocked (and does not count
// them); SIGCHLD and reaping every child that has exited; and kill, SIGKILL, which no handler can catch, and alarm.
// Beside the listing, each process's signal state: its handlers, its pending set and its mask.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const INC = '#include <stdio.h>\n#include <signal.h>\n#include <unistd.h>\n';
  const P = (file, label, body, extra) => Object.assign({ file, label, src: INC + body }, extra || {});
  const INT = {
    handler: P('count.c', 'a handler counts each ^C', `int hits = 0;
void on_int(int s) {
    hits++;
    printf("caught ^C %d\\n", hits);
}
int main(void) {
    signal(SIGINT, on_int);
    while (hits < 2)
        pause();
    printf("bye\\n");
    return 0;
}`),
    deflt: P('plain.c', 'no handler: the default action', `int main(void) {
    printf("waiting for ^C\\n");
    while (1)
        pause();
    return 0;
}`),
    ignore: P('deaf.c', 'SIG_IGN: ^C is ignored', `int main(void) {
    signal(SIGINT, SIG_IGN);
    for (int i = 1; i <= 2; i++) {
        sleep(1);
        printf("tick %d\\n", i);
    }
    return 0;
}`),
  };
  X.SIG_INT = INT;
  const sigFrames = (pr, sys, extra) => X.cframes({ sys, src: pr.src, file: pr.file, panel: 'sig', counters: ['sent', 'handled'], count: (() => { let sent = 0, handled = 0; return (F, b) => { for (const e of b.evs) { if (e.kind === 'signal') sent++; if (e.kind === 'handler') handled++; } F.set('sent', sent).set('handled', handled); }; })(), extra: (b) => Object.assign({ pending: X.live(b.snap).map((p) => p.pending), status: sys.status() }, extra ? extra(b) : {}) });
  const statusOf = (sys) => { const e = sys.trace.find((x) => x.kind === 'wait' && x.pid === 2); const z = sys.trace.find((x) => x.kind === 'zombie' && x.pid === 100); return z ? (z.termsig ? 'killed by ' + X.sig(z.termsig) : 'exit ' + z.code) : sys.status(); };

  S.topic({
    id: 'p03-signal', family: 'p03-signals', order: 10, title: 'Signals, handlers and ^C',
    blurb: 'A signal is a small notice the kernel delivers to a process: ^C at the terminal sends SIGINT to the foreground process group. Each process chooses, per signal, what happens: the default action (for SIGINT, the end of the process), SIG_IGN (nothing), or a handler, a function the kernel calls on the process\'s own stack, interrupting whatever it was doing, after which the process carries on. pause() waits for exactly that.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'handler', options: Object.keys(INT).map((k) => ({ value: k, label: INT[k].label })) },
      { id: 'presses', kind: 'slider', label: 'Times the user types ^C', def: 2, min: 1, max: 3, step: 1 },
    ],
    presets: [
      { label: 'A handler, ^C twice', values: { prog: 'handler', presses: 2 } },
      { label: 'No handler: ^C ends it', values: { prog: 'deflt', presses: 1 } },
      { label: 'Ignored: ^C does nothing', values: { prog: 'ignore', presses: 2 } },
      { label: 'A third ^C after it is gone', values: { prog: 'handler', presses: 3 } },
    ],
    counters: [{ id: 'sent', label: 'signals sent' }, { id: 'handled', label: 'handlers run' }],
    run(inp) {
      const pr = INT[inp.prog];
      const sys = X.drive(pr.src, {}, Array.from({ length: inp.presses }, () => ({ key: 'C' })));
      const { F } = sigFrames(pr, sys);
      const def = { sections: [{ id: 'd', kind: 'math', title: 'What a signal does', text: ['default: SIGINT, SIGTERM end it;', '  SIGCHLD is ignored', 'SIG_IGN: dropped on arrival', 'handler: the kernel calls it', '  on the process\'s stack,', '  then sigreturn resumes it', 'pause: wait for a handler', '  (returns -1, EINTR)'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), end: statusOf(sys) } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'key' && fr[i + 1] && fr[i + 1].meta.phase === 'signal', pick: 'option', ask: 'The user typed ^C. What will the process do with SIGINT?', options: ['run its handler and carry on', 'end (the default action)', 'nothing: it ignores SIGINT'], answer: (fr, i) => { const nx = fr.slice(i + 1).find((g) => /^(handler|exit|signal)$/.test(g.meta.phase) && g.meta.phase !== 'signal'); return nx && nx.meta.phase === 'handler' ? 'run its handler and carry on' : nx && nx.meta.phase === 'exit' && nx.meta.evs[0].crash ? 'end (the default action)' : 'nothing: it ignores SIGINT'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which process gets SIGINT when the user types ^C?', options: ['every process in the terminal\'s foreground process group', 'the shell', 'init', 'the process that last printed'], answer: 0, why: 'The terminal driver sends it to the foreground group.' },
      { q: 'A process with no handler for SIGINT gets one. What happens?', options: ['it ends: that is the default action', 'nothing', 'it stops', 'it restarts'], answer: 0, why: 'Most signals\' default action is to terminate; the parent sees it in the status.' },
      { q: 'Where does a signal handler run?', options: ['in the process, on its own stack, as if it had called the function', 'in the kernel', 'in a new process', 'in the shell'], answer: 0, why: 'The kernel arranges the call and a return path (sigreturn) that resumes the interrupted code.' },
      { q: 'What does pause() return after a handler runs?', options: ['-1, with errno EINTR', '0', 'the signal number', 'it never returns'], answer: 0, why: 'pause only ever returns because a handler ran.' },
    ],
  });

  const MASK = {
    once: P('hold.c', 'one signal, held then let go', `void on_usr(int s) {
    printf("in the handler\\n");
}
int main(void) {
    sigset_t m, old;
    signal(SIGUSR1, on_usr);
    sigemptyset(&m);
    sigaddset(&m, SIGUSR1);
    sigprocmask(SIG_BLOCK, &m, &old);
    raise(SIGUSR1);
    printf("raised, blocked\\n");
    sigprocmask(SIG_SETMASK, &old, 0);
    printf("unblocked\\n");
    return 0;
}`),
    twice: P('twice.c', 'two signals while blocked: one handler', `int runs = 0;
void on_usr(int s) { runs++; }
int main(void) {
    sigset_t m, old;
    signal(SIGUSR1, on_usr);
    sigemptyset(&m);
    sigaddset(&m, SIGUSR1);
    sigprocmask(SIG_BLOCK, &m, &old);
    raise(SIGUSR1);
    raise(SIGUSR1);
    sigprocmask(SIG_SETMASK, &old, 0);
    printf("ran %d time\\n", runs);
    return 0;
}`),
  };
  X.SIG_MASK = MASK;
  S.topic({
    id: 'p03-mask', family: 'p03-signals', order: 20, title: 'Blocking signals: the mask and the pending set',
    blurb: 'A process can block signals with sigprocmask: one that arrives while blocked is not lost but waits in the pending set, a bit per signal, and is delivered the moment it is unblocked. A bit can only be set once, so two signals of the same kind that arrive while it is blocked are delivered as one. Code that must not be interrupted half-way blocks the signals whose handlers touch the same data.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'once', options: Object.keys(MASK).map((k) => ({ value: k, label: MASK[k].label })) }],
    presets: [{ label: 'Held, then delivered', values: { prog: 'once' } }, { label: 'Raised twice, delivered once', values: { prog: 'twice' } }],
    counters: [{ id: 'sent', label: 'signals sent' }, { id: 'handled', label: 'handlers run' }],
    run(inp) {
      const pr = MASK[inp.prog];
      const sys = X.drive(pr.src, {}, []);
      const { F } = sigFrames(pr, sys);
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Mask and pending', text: ['pending: a bit per signal', '  set when it is sent', 'mask: a bit per blocked signal', 'deliver when pending & ~mask', 'a bit is set or not:', '  signals do not queue', 'SIGKILL, SIGSTOP: never blocked'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join('') } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'mask' && fr[i + 1].meta.evs[0].mask === 0, once: true, pick: 'option', ask: 'The next step unblocks SIGUSR1. How many times will its handler run now?', options: ['0', '1', '2'], answer: (fr) => String(fr.filter((g) => g.meta.phase === 'handler').length), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A blocked signal arrives. What happens to it?', options: ['it waits in the pending set until it is unblocked', 'it is thrown away', 'it is delivered anyway', 'the sender waits'], answer: 0, why: 'Blocking delays delivery; ignoring would discard it.' },
      { q: 'SIGUSR1 is sent three times while blocked. How many times does its handler run when it is unblocked?', options: ['once', 'three times', 'never', 'twice'], answer: 0, why: 'The pending set has one bit per signal: standard signals do not queue.' },
      { q: 'Which signal can never be blocked?', options: ['SIGKILL', 'SIGINT', 'SIGTERM', 'SIGCHLD'], answer: 0, why: 'SIGKILL and SIGSTOP always reach the process, so the system can always stop it.' },
      { q: 'Why block a signal around an update of a list that its handler also reads?', options: ['so the handler never sees the list half-changed', 'to speed the update', 'to lose the signal', 'it is never needed'], answer: 0, why: 'A handler can run between any two instructions of the main code.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
