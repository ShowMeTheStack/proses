// Part 3, signals between processes: SIGCHLD, which the kernel sends a parent whenever a child exits, and a handler
// that reaps with waitpid(WNOHANG) in a loop (because several exits can arrive as one signal); and kill, with
// SIGTERM that a process may catch, SIGKILL that it cannot, and alarm, a signal the process sends itself later.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const INC = '#include <stdio.h>\n#include <signal.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';
  const P = (file, label, body) => ({ file, label, src: INC + body });
  const CHLD = {
    loop: P('reaper.c', 'the handler reaps in a loop', `int left = 3;
void reap(int s) {
    while (waitpid(-1, 0, WNOHANG) > 0)
        left--;
}
int main(void) {
    signal(SIGCHLD, reap);
    for (int i = 0; i < 3; i++)
        if (fork() == 0) {
            sleep(1);
            return i;
        }
    while (left > 0)
        pause();
    printf("all reaped\\n");
    return 0;
}`),
    once: P('reaper1.c', 'the handler reaps only one', `int left = 3;
void reap(int s) {
    if (waitpid(-1, 0, WNOHANG) > 0)
        left--;
}
int main(void) {
    signal(SIGCHLD, reap);
    for (int i = 0; i < 3; i++)
        if (fork() == 0) {
            sleep(1);
            return i;
        }
    while (left > 0)
        pause();
    printf("all reaped\\n");
    return 0;
}`),
    staggered: P('reaper2.c', 'children exit one at a time', `int left = 3;
void reap(int s) {
    if (waitpid(-1, 0, WNOHANG) > 0)
        left--;
}
int main(void) {
    signal(SIGCHLD, reap);
    for (int i = 0; i < 3; i++)
        if (fork() == 0) {
            sleep(i + 1);
            return i;
        }
    while (left > 0)
        pause();
    printf("all reaped\\n");
    return 0;
}`),
  };
  X.SIG_CHLD = CHLD;
  const zombiesAt = (b) => b.snap.filter((p) => p.role === 'prog' && p.state === 'zombie').length;

  S.topic({
    id: 'p03-sigchld', family: 'p03-signals', order: 30, title: 'SIGCHLD: reaping without waiting',
    blurb: 'When a child exits, the kernel sends its parent SIGCHLD. A parent with other work can reap in a handler instead of blocking in wait. But signals do not queue: if three children exit before the handler runs, it runs once. So the handler must loop, calling waitpid(-1, ..., WNOHANG) until it returns 0 or -1, reaping every child that has exited; a handler that reaps one per signal leaves zombies behind.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'loop', options: Object.keys(CHLD).map((k) => ({ value: k, label: CHLD[k].label })) }],
    presets: [{ label: 'Reap in a loop: none left', values: { prog: 'loop' } }, { label: 'Reap one per signal: zombies left', values: { prog: 'once' } }, { label: 'One per signal, exits apart: lucky', values: { prog: 'staggered' } }],
    counters: [{ id: 'sigs', label: 'SIGCHLD sent' }, { id: 'runs', label: 'handler runs' }, { id: 'zombies', label: 'zombies now' }],
    run(inp) {
      const pr = CHLD[inp.prog];
      const sys = X.drive(pr.src, {}, []);
      let sigs = 0, runs = 0;
      const { F } = X.cframes({ sys, src: pr.src, file: pr.file, panel: 'sig', maxRows: 4, counters: ['sigs', 'runs', 'zombies'], count: (F, b) => { for (const e of b.evs) { if (e.kind === 'signal' && e.sig === 17) sigs++; if (e.kind === 'handler') runs++; } F.set('sigs', sigs).set('runs', runs).set('zombies', zombiesAt(b)); }, extra: (b) => ({ zombies: zombiesAt(b), status: sys.status() }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Reaping in a handler', text: ['a child exits: SIGCHLD', '  to its parent', 'several exits, one pending bit:', '  one handler run', 'so loop:', '  while (waitpid(-1, 0,', '         WNOHANG) > 0) ...', 'WNOHANG: 0 if none has exited'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), status: sys.status(), sigs, runs } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'handler' && f.meta.phase !== 'handler', pick: 'option', ask: 'The handler is about to run. How many children will it reap this time?', options: ['0', '1', '2', '3'], answer: (fr, i) => { let k = 0; for (let j = i + 1; j < fr.length && fr[j].meta.phase !== 'sigreturn'; j++) if (fr[j].meta.phase === 'wait' && fr[j].meta.evs[0].ret > 0) k++; return String(k); }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Three children exit while the parent\'s SIGCHLD handler cannot run yet. How many times does it run?', options: ['once: one pending bit', 'three times', 'never', 'twice'], answer: 0, why: 'Standard signals do not queue.' },
      { q: 'Why must the handler call waitpid with WNOHANG?', options: ['so it returns 0 instead of waiting when no exited child is left', 'to reap faster', 'to ignore the status', 'to kill the child'], answer: 0, why: 'A handler that blocks would stall the whole process.' },
      { q: 'What is left when the handler reaps only one child per signal and two signals were merged?', options: ['a zombie', 'an orphan', 'nothing', 'a stopped child'], answer: 0, why: 'One exited child is never waited for.' },
      { q: 'If a process does nothing about SIGCHLD, what is the default action?', options: ['ignore it (the child stays a zombie until waited for)', 'terminate', 'stop', 'core dump'], answer: 0, why: 'SIGCHLD\'s default action is to ignore; the zombie remains until wait.' },
    ],
  });

  const KILL = {
    term: P('term.c', 'SIGTERM: the child cleans up', `void bye(int s) { _exit(40 + s); }
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        signal(SIGTERM, bye);
        while (1) pause();
    }
    sleep(1);
    kill(k, SIGTERM);
    int st;
    waitpid(k, &st, 0);
    int sig = WTERMSIG(st);
    int code = WEXITSTATUS(st);
    if (WIFSIGNALED(st))
        printf("signal %d\\n", sig);
    else
        printf("exit %d\\n", code);
    return 0;
}`),
    kill9: P('kill9.c', 'SIGKILL: no handler can catch it', `void bye(int s) { _exit(40 + s); }
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        signal(SIGKILL, bye);
        while (1) pause();
    }
    sleep(1);
    kill(k, SIGKILL);
    int st;
    waitpid(k, &st, 0);
    int sig = WTERMSIG(st);
    int code = WEXITSTATUS(st);
    if (WIFSIGNALED(st))
        printf("signal %d\\n", sig);
    else
        printf("exit %d\\n", code);
    return 0;
}`),
    alarm: P('alarm.c', 'alarm: a signal later, to itself', `void ring(int s) {
    printf("ring %d\\n", s);
}
int main(void) {
    signal(SIGALRM, ring);
    alarm(2);
    pause();
    signal(SIGALRM, SIG_DFL);
    alarm(1);
    pause();
    printf("not reached\\n");
    return 0;
}`),
  };
  X.SIG_KILL = KILL;
  S.topic({
    id: 'p03-kill', family: 'p03-signals', order: 40, title: 'kill, SIGKILL and alarm',
    blurb: 'kill(pid, sig) sends any signal to a process the sender may signal. SIGTERM asks politely: the target may catch it, tidy up and exit. SIGKILL cannot be caught, ignored or blocked; the kernel ends the process, and its parent sees the signal in the status. alarm(n) asks the kernel to send the caller SIGALRM n seconds later: a timeout, or, with the default action, an end.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'term', options: Object.keys(KILL).map((k) => ({ value: k, label: KILL[k].label })) }],
    presets: [{ label: 'SIGTERM, caught', values: { prog: 'term' } }, { label: 'SIGKILL, uncatchable', values: { prog: 'kill9' } }, { label: 'Two alarms', values: { prog: 'alarm' } }],
    counters: [{ id: 'sent', label: 'signals sent' }, { id: 'handled', label: 'handlers run' }],
    run(inp) {
      const pr = KILL[inp.prog];
      const sys = X.drive(pr.src, {}, []);
      let sent = 0, handled = 0;
      const { F } = X.cframes({ sys, src: pr.src, file: pr.file, panel: 'sig', counters: ['sent', 'handled'], count: (F, b) => { for (const e of b.evs) { if (e.kind === 'signal') sent++; if (e.kind === 'handler') handled++; } F.set('sent', sent).set('handled', handled); }, extra: () => ({ codes: [9, 15, 14, 40] }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Sending signals', text: ['kill(pid, sig): send sig', 'SIGTERM 15: may be caught', 'SIGKILL 9: never caught,', '  ignored or blocked', 'alarm(n): SIGALRM 14 to', '  the caller in n seconds', 'status: WIFSIGNALED, WTERMSIG,', '  or WIFEXITED, WEXITSTATUS'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join('') } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'signal' && f.meta.phase !== 'signal' && fr.some((g) => g.meta.phase === 'exit'), once: true, pick: 'option', ask: 'A signal is about to be sent. What will its target do?', options: ['run its handler', 'end, by the signal'], answer: (fr, i) => { const nx = fr.slice(i + 2).find((g) => g.meta.phase === 'handler' || g.meta.phase === 'exit'); return nx && nx.meta.phase === 'handler' ? 'run its handler' : 'end, by the signal'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why can no process catch SIGKILL?', options: ['so that a process can always be stopped, whatever its code does', 'it is too fast', 'handlers are only for SIGINT', 'it can, with sigaction'], answer: 0, why: 'signal(SIGKILL, ...) fails with EINVAL.' },
      { q: 'A child catches SIGTERM and calls _exit(55). What does the parent\'s waitpid report?', options: ['a normal exit with code 55', 'killed by signal 15', 'killed by signal 9', 'nothing'], answer: 0, why: 'The child ended itself; the signal only ran its handler.' },
      { q: 'What does alarm(2) do?', options: ['the kernel sends the caller SIGALRM about 2 seconds later', 'it sleeps for 2 seconds', 'it kills the process after 2 signals', 'it rings the terminal bell'], answer: 0, why: 'The caller keeps running; the signal comes later.' },
      { q: 'SIGALRM with its default action ends the process. Why does "not reached" never print?', options: ['the process ends inside pause, before the printf', 'printf is blocked', 'the output is buffered and lost', 'alarm cancels printf'], answer: 0, why: 'The default action of SIGALRM is to terminate.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
