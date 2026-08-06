// The Process lab, part one: its example programs and how it drives the simulated kernel (S.Kern). Shared with the
// Shell lab through S.ProcLab:
//   PL.PROGS [{name, src, show, policy, tty, gran, about}]   the example programs (each one original)
//   PL.FILES {name: text}                                    the files on the simulated disk by default
//   PL.system(src, o) -> a System    o: {tty, files, policy, quantum, seed, gran, hand}; by hand, sleep only yields
//   PL.run(src, o) -> {sys, beats, decisions, waiting, bad, steps}
//     by hand (o.hand) the schedule o.sched [choice..] is followed: init and the shell reap at once, a lone choice is
//     taken at once, and each choice runs that thread until it does something another process could notice (the
//     enumerator's own step, so a schedule from "every output" replays exactly); when the schedule runs out, waiting
//     lists the choices; else the policy picks every step
//     beat: {evs, main, snap, ks, nterm, at, globals, choice}   one picture: the events of one step (or one choice)
//   PL.decisions(src, o, path) -> [choice..]   an enumerator's path as the choices a student would click
//   PL.every(src, o) -> {list: [{out, sched, hangs}], states, complete}   every output over every schedule
//   PL.schedText(list) / PL.parseSched(text)   a schedule as "101 100 a101" (a: that process's alarm fires)
//   PL.termRows(sys, nterm, typed) -> [{tags: [{pid}], text, you}]   the terminal's lines, with who wrote each
(function (S) {
  'use strict';
  const PL = (S.ProcLab = S.ProcLab || {});
  const QUIET = new Set(['step', 'buffer', 'sleep', 'flush', 'cow', 'cow-share', 'mask', 'disposition', 'alarm']);
  // events a picture is not needed for on their own
  const SKIP = new Set(['step', 'sleep', 'cow-share']);
  const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n';
  PL.QUIET = QUIET;

  PL.FILES = { 'notes.txt': 'pear\napple\nfig\n', 'todo.txt': 'water the plants\n' };
  PL.PROGS = [
    { name: 'zombie-orphan.c', show: 'procs', policy: 'fifo', about: 'A finishes at once and waits as a zombie until someone reaps it; B outlives its parent and is adopted by init.',
      src: H + '\nint main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        printf("A: I finish at once\\n");\n        exit(3);\n    }\n    pid_t b = fork();\n    if (b == 0) {\n        sleep(2);\n        printf("B: my parent is now %d\\n", getppid());\n        return 0;\n    }\n    sleep(1);\n    printf("parent: leaving, no wait\\n");\n    return 0;\n}\n' },
    { name: 'fork-count.c', show: 'procs', policy: 'random', about: 'Each round doubles the processes: 2 rounds make 4, and the lines can come out in 12 orders.',
      src: H + '#include <sys/wait.h>\n\n#define ROUNDS 2\n\nint main(void) {\n    int n = 0;\n    for (int i = 0; i < ROUNDS; i++) {\n        if (fork() == 0)\n            n++;\n    }\n    printf("n = %d\\n", n);\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n' },
    { name: 'printf-before-fork.c', show: 'buffers', policy: 'fifo', tty: false, about: 'Text still in the stdout buffer is copied by fork: on a pipe even "one\\n" is printed twice.',
      src: '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    printf("one\\n");\n    printf("two");\n    if (fork() == 0) {\n        printf(" (child)\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf(" (parent)\\n");\n    return 0;\n}\n' },
    { name: 'ls-wc.c', show: 'fds', policy: 'fifo', about: 'Two children joined by a pipe: ls writes into it, wc reads from it, and the parent closes both ends.',
      src: H + '#include <sys/wait.h>\n\nint main(void) {\n    int fd[2];\n    pipe(fd);\n    if (fork() == 0) {\n        dup2(fd[1], 1);\n        close(fd[0]);\n        close(fd[1]);\n        execlp("ls", "ls", NULL);\n        perror("ls");\n        exit(1);\n    }\n    if (fork() == 0) {\n        dup2(fd[0], 0);\n        close(fd[0]);\n        close(fd[1]);\n        execlp("wc", "wc", NULL);\n        perror("wc");\n        exit(1);\n    }\n    close(fd[0]);\n    close(fd[1]);\n    while (wait(NULL) > 0)\n        ;\n    printf("ls | wc is done\\n");\n    return 0;\n}\n' },
    { name: 'dup2-redirect.c', show: 'fds', policy: 'fifo', about: 'dup2 points descriptor 1 at a file and back again; then exec keeps the descriptors and runs cat.',
      src: '#include <stdio.h>\n#include <fcntl.h>\n#include <unistd.h>\n\nint main(void) {\n    printf("to the terminal\\n");\n    fflush(stdout);\n    int f = open("log.txt", O_WRONLY | O_CREAT | O_TRUNC, 0644);\n    int saved = dup(1);\n    dup2(f, 1);\n    close(f);\n    printf("into log.txt\\n");\n    fflush(stdout);\n    dup2(saved, 1);\n    close(saved);\n    printf("back on the terminal\\n");\n    fflush(stdout);\n    execlp("cat", "cat", "log.txt", NULL);\n    return 1;\n}\n' },
    { name: 'sigchld-handler.c', show: 'signals', policy: 'fifo', about: 'A SIGCHLD handler reaps each child as it exits. The test before pause() can miss a signal: list every output to find the hang.',
      src: H + '#include <signal.h>\n#include <sys/wait.h>\n\nvolatile sig_atomic_t reaped = 0;\n\nvoid on_child(int sig) {\n    int st;\n    pid_t k;\n    while ((k = waitpid(-1, &st, WNOHANG)) > 0) {\n        reaped++;\n        printf("reaped %d, status %d\\n", k, WEXITSTATUS(st));\n    }\n}\n\nint main(void) {\n    signal(SIGCHLD, on_child);\n    for (int i = 0; i < 2; i++) {\n        if (fork() == 0) {\n            sleep(i + 1);\n            exit(10 + i);\n        }\n    }\n    while (reaped < 2)\n        pause();\n    printf("both children reaped\\n");\n    return 0;\n}\n' },
    { name: 'waitpid-wnohang.c', show: 'procs', policy: 'fifo', about: 'WNOHANG asks without waiting: the parent polls, doing its own work, until the child has exited.',
      src: H + '#include <sys/wait.h>\n\nint main(void) {\n    pid_t k = fork();\n    if (k == 0) {\n        sleep(2);\n        exit(7);\n    }\n    int st, polls = 0;\n    while (polls < 3 && waitpid(k, &st, WNOHANG) == 0) {\n        polls++;\n        printf("poll %d: still running\\n", polls);\n        sleep(1);\n    }\n    if (polls == 3)\n        waitpid(k, &st, 0);\n    printf("child exited with %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n' },
    { name: 'threads-mutex.c', show: 'threads', policy: 'rr', gran: 'machine', about: 'Two threads add to one total under a mutex: whatever the interleaving, the total is 4.',
      src: '#include <stdio.h>\n#include <pthread.h>\n\nint total = 0;\npthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;\n\nvoid *work(void *arg) {\n    for (int i = 0; i < 2; i++) {\n        pthread_mutex_lock(&lock);\n        total = total + 1;\n        pthread_mutex_unlock(&lock);\n    }\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, work, NULL);\n    pthread_create(&b, NULL, work, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    printf("total = %d\\n", total);\n    return 0;\n}\n' },
    { name: 'race.c', show: 'threads', policy: 'hand', gran: 'machine', sched: '100 101 102 101 101 102 102', about: 'count++ is a load, an add and a store: two threads that both load 0 both store 1, and one increment is lost.',
      src: '#include <stdio.h>\n#include <pthread.h>\n\nint count = 0;\n\nvoid *bump(void *arg) {\n    count++;\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, bump, NULL);\n    pthread_create(&b, NULL, bump, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    printf("count = %d\\n", count);\n    return 0;\n}\n' },
    { name: 'copy-on-write.c', show: 'pages', policy: 'fifo', about: 'After fork both processes share every page; the first write to one gives the writer its own copy.',
      src: H + '#include <sys/wait.h>\n\nint shared[1024];\n\nint main(void) {\n    shared[0] = 5;\n    pid_t k = fork();\n    if (k == 0) {\n        shared[0] = 6;\n        printf("child sees %d\\n", shared[0]);\n        return 0;\n    }\n    wait(NULL);\n    printf("parent still sees %d\\n", shared[0]);\n    return 0;\n}\n' },
  ];

  PL.system = function (src, o) {
    o = o || {};
    return new S.Kern.System(src, {
      tty: o.tty !== false, files: Object.assign({}, o.files || {}), policy: o.hand ? 'hand' : o.policy || 'fifo', quantum: o.quantum || 1, seed: o.seed || 1,
      granularity: o.gran || 'statement', sleep: o.hand ? 'free' : 'timed', cow: o.cow !== false, pageSize: o.pageSize || 4096, shell: o.shell !== false,
      input: o.input || '', eof: o.eof !== false, pipeCap: o.pipeCap || 4096, choose: (cs) => cs[0], argv: o.argv,
    });
  };

  /** the enumerator's step: c runs until it does something another process could notice */
  PL.macro = function (sys, c) {
    const evs = [];
    for (let n = 0; n < 5000; n++) {
      sys.fp = { r: new Set(), w: new Set() };
      sys.shared = false;
      const e = sys.step(c);
      evs.push(...e);
      const t = typeof c === 'number' && sys.thread(c);
      const mine = (x) => t && x === 'buf:' + t.pid;
      const caught = t && Object.values(sys.proc(t.pid).sig.handlers).some((h) => h && h.fn);
      if (!t || t.state !== 'running' || caught || [...sys.fp.r].some((x) => !mine(x)) || [...sys.fp.w].some((x) => !mine(x)) || e.some((x) => !QUIET.has(x.kind))) break;
    }
    sys.fp = null;
    return evs;
  };
  const isReaper = (sys, c) => typeof c === 'number' && sys.proc(sys.thread(c).pid).role !== 'prog';

  /** the global variables of a process with threads, for the threads view */
  function globalsOf(sys, skip) {
    const C = S.CLang, out = {};
    for (const p of sys.procs) {
      if (p.role !== 'prog' || p.image !== 'c' || !p.prog || p.state === 'zombie' || p.state === 'reaped') continue;
      const t = sys.threads.find((x) => x.pid === p.pid && x.vm && x.state !== 'done');
      if (!t) continue;
      const list = [];
      for (const [name, g] of p.prog.globals) {
        if (name.startsWith('__') || g.addr < C.LIBC.end || g.fn) continue;
        const sz = C.T.size(g.type);
        if (!C.T.isInt(g.type) || sz > 8 || (skip && skip.has(g.short || name))) continue;
        let v;
        try { v = C.load(t.vm, g.addr, sz, 1); } catch (e) { continue; }
        list.push({ name: g.short || name, value: Number(v), addr: g.addr });
      }
      out[p.pid] = list;
    }
    return out;
  }
  PL.globalsOf = globalsOf;

  /** names declared as locks, condition variables, semaphores or thread ids: not values to show */
  PL.objNames = function (src) {
    const out = new Set(), re = /\b(?:pthread_mutex_t|pthread_cond_t|sem_t|pthread_t)\s+([^;(]+);/g;
    let m;
    while ((m = re.exec(String(src)))) for (const part of m[1].split(',')) { const w = /([A-Za-z_]\w*)/.exec(part.replace(/\*/g, '')); if (w) out.add(w[1]); }
    return out;
  };
  function beatOf(sys, evs, at, choice, wantGlobals) {
    const kept = evs.filter((e) => !SKIP.has(e.kind) || e.mstep);
    const main = kept.find((e) => !QUIET.has(e.kind)) || kept.find((e) => e.mstep) || kept[0] || evs[evs.length - 1];
    const modes = {};
    for (const p of sys.procs) if (p.role === 'prog') modes[p.pid] = p.bufMode;
    return { evs: kept, main, snap: sys.snapshot(), ks: sys.ksnap(), nterm: sys.term.length, at, choice, clock: sys.ms / 1000, modes, globals: wantGlobals ? globalsOf(sys, wantGlobals) : null };
  }
  const usesThreads = (src) => /pthread_create/.test(src);

  PL.run = function (src, o) {
    o = o || {};
    const sys = PL.system(src, o), beats = [], decisions = [], wantG = usesThreads(src) ? PL.objNames(src) : null;
    const machine = o.gran === 'machine';
    const add = (evs, choice) => {
      if (!evs.length) return;
      const at = sys.trace.length - evs.length;
      beats.push(beatOf(sys, evs, at, choice, wantG));
    };
    beats.push(beatOf(sys, sys.trace.slice(), 0, null, wantG));
    let waiting = null, bad = null, steps = 0;
    const limit = o.maxSteps || 40000, maxBeats = o.maxBeats || 600;
    if (o.hand) {
      const sched = o.sched || [];
      let k = 0;
      for (let n = 0; n < limit && beats.length < maxBeats; n++) {
        const cs = sys.choices();
        if (!cs.length) { sys.done(); break; }
        const reaper = cs.find((c) => isReaper(sys, c));
        if (reaper !== undefined) { add(PL.macro(sys, reaper), reaper); continue; }
        if (cs.length === 1) { add(PL.macro(sys, cs[0]), cs[0]); continue; }
        const c = sched[k];
        if (c === undefined) { waiting = cs; break; }
        if (!cs.includes(c)) { bad = { at: k, choice: c, choices: cs }; waiting = cs; break; }
        k++; decisions.push(c);
        add(PL.macro(sys, c), c);
      }
    } else {
      for (let n = 0; n < limit; n++) {
        if (!sys.advance()) { sys.done(); break; }
        const c = sys.pick(), from = sys.trace.length;
        sys.step(c); steps++;
        const evs = sys.trace.slice(from);
        // a picture for a step that does something (and, at machine granularity, each load and store)
        if (evs.some((e) => !SKIP.has(e.kind) && e.kind !== 'buffer' || (machine && e.mstep) || e.kind === 'buffer')) {
          if (beats.length < maxBeats) add(evs, c);
        }
      }
      if (!sys.finished) { sys.event('limit', null, {}, 'The run stops here: the program may loop forever.'); add(sys.trace.slice(-1), null); }
    }
    if (sys.finished && beats.length && beats[beats.length - 1].main.kind !== 'done') add(sys.trace.slice(-1), null);
    return { sys, beats, decisions, waiting, bad, steps };
  };

  /** an enumerator's path as the choices a student clicks (no reaps, no lone choices) */
  PL.decisions = function (src, o, path) {
    const sys = PL.system(src, Object.assign({}, o, { hand: true, cow: false })), out = [];
    for (const c of path) {
      const cs = sys.choices();
      if (!cs.includes(c)) break;
      if (!isReaper(sys, c) && cs.length > 1) out.push(c);
      PL.macro(sys, c);
    }
    return out;
  };
  PL.every = function (src, o) {
    o = o || {};
    const r = S.Kern.outcomes(src, { tty: o.tty !== false, files: Object.assign({}, o.files || {}), granularity: o.gran || 'statement', shell: o.shell !== false, maxStates: o.maxStates || 60000 });
    const list = [];
    for (const [out, path] of r.outputs) list.push({ out, path, sched: PL.decisions(src, o, path), hangs: r.deadlocks.has(out) });
    // the hangs whose output was also reached by a run that ended
    for (const [out, path] of r.deadlocks) { const l = list.find((x) => x.out === out); if (l && !l.hangs) l.hangs = true; if (l) l.hangPath = PL.decisions(src, o, path); }
    list.sort((a, b) => (a.hangs - b.hangs) || (a.out < b.out ? -1 : a.out > b.out ? 1 : 0));
    return { list, states: r.states, complete: r.complete, deadlocks: r.deadlocks.size };
  };
  PL.schedText = (list) => (list || []).map(String).join(' ');
  PL.parseSched = (text) => String(text || '').trim().split(/[\s,]+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? +w : w));

  /** the terminal's lines: each with the processes that wrote it; typed lines (typed: [{text, n}]) tagged as yours */
  PL.termRows = function (sys, nterm, typed) {
    const writes = [], tq = (typed || []).slice().sort((a, b) => a.n - b.n);
    sys.term.slice(0, nterm).forEach((w, i) => {
      while (tq.length && tq[0].n <= i) writes.push({ pid: 'you', text: tq.shift().text + '\n' });
      writes.push({ pid: w.pid, text: w.text });
    });
    while (tq.length && tq[0].n <= nterm) writes.push({ pid: 'you', text: tq.shift().text + '\n' });
    const rows = [];
    let cur = null;
    for (const w of writes) {
      const parts = String(w.text).split('\n');
      parts.forEach((part, k) => {
        if (k > 0) { if (cur) rows.push(cur); cur = null; }
        if (!part && !(k > 0 && k < parts.length - 1)) return;
        cur = cur || { tags: [], text: '', you: w.pid === 'you' };
        cur.text += part;
        if (!cur.tags.some((t) => t.pid === w.pid)) cur.tags.push({ pid: w.pid });
      });
    }
    if (cur) rows.push(cur);
    return rows;
  };
})(globalThis.Proses = globalThis.Proses || {});
