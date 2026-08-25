// Part 2, zombies and orphans: what is left of a process after it exits (its entry and status, a zombie, until its
// parent waits), and what happens to children whose parent exits first (re-parented to init, which reaps them).
// The tree here shows init and the shell too, so a re-parenting is an edge that moves.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    zombie: {
      label: 'a zombie until the parent waits', file: 'late.c',
      src: INC + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        printf("child done\\n");
        exit(7);
    }
    sleep(2);
    int st;
    waitpid(k, &st, 0);
    printf("got %d\\n", WEXITSTATUS(st));
    return 0;
}`,
    },
    orphan: {
      label: 'an orphan adopted by init', file: 'orphan.c',
      src: INC + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        sleep(2);
        printf("parent: %d\\n", getppid());
        return 0;
    }
    printf("parent leaves\\n");
    return 0;
}`,
    },
    never: {
      label: 'a parent that never waits', file: 'careless.c',
      src: INC + `int main(void) {
    for (int i = 0; i < 2; i++)
        if (fork() == 0)
            exit(i);
    sleep(3);
    printf("parent exits\\n");
    return 0;
}`,
    },
    both: {
      label: 'one zombie, one orphan', file: 'mixed.c',
      src: INC + `int main(void) {
    pid_t a = fork();
    if (a == 0)
        exit(5);
    pid_t b = fork();
    if (b == 0) {
        sleep(3);
        printf("b: %d\\n", getppid());
        exit(0);
    }
    sleep(1);
    waitpid(a, NULL, 0);
    printf("a reaped\\n");
    return 0;
}`,
    },
  };
  P.PROGS_ZOMBIE = PROGS;

  S.topic({
    id: 'p02-zombie', family: 'p02-family', order: 10, title: 'Zombies, orphans and init',
    blurb: 'When a process exits, the kernel frees its memory and descriptors but keeps its entry in the process table, holding the exit status, until the parent calls wait. In between it is a zombie: dead, but not yet gone. If the parent exits first, its children are orphans; the kernel gives them to init (pid 1), whose whole job is to wait for them, so they never stay zombies for long.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'zombie', options: P.options(PROGS) },
      { id: 'pol', kind: 'choice', label: 'Who runs', def: 'fifo', options: P.POLICIES },
      { id: 'seed', kind: 'slider', label: 'Seed (random)', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'A zombie for two seconds', values: { prog: 'zombie', pol: 'fifo' } },
      { label: 'An orphan, adopted by init', values: { prog: 'orphan', pol: 'fifo' } },
      { label: 'A parent that never waits', values: { prog: 'never', pol: 'fifo' } },
      { label: 'One zombie and one orphan', values: { prog: 'both', pol: 'fifo' } },
      { label: 'One of each, a random schedule', values: { prog: 'both', pol: 'random', seed: 5 } },
    ],
    counters: [{ id: 'zombies', label: 'zombies now' }, { id: 'adopted', label: 're-parented to init' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, Object.assign({ cow: false }, P.policy(inp.pol, inp.seed)));
      const bs = P.beats(sys, { skip: ['wake'] }), F = new S.Frames(['zombies', 'adopted']), adopted = new Set();
      const depth = H.depth(sys);
      bs.forEach((b) => {
        const sc = P.scene({ sys, beat: b, src: pr.src, file: pr.file, adopted, kernel: true, depth, rowsShown: 3, boxW: 108 });
        const zombies = b.snap.filter((p) => p.state === 'zombie').map((p) => p.pid);
        F.set('zombies', zombies.length).set('adopted', adopted.size);
        let say = b.say;
        if (b.kind === 'reparent') say += b.evs.length > 1 ? ' Each one\'s parent pid is now 1.' : ' Its parent pid is now 1.';
        F.add({ items: sc.items, say, meta: H.metaOf(b, { zombies, adopted: [...adopted], nAdopted: adopted.size, by: b.evs.map((e) => e.by).filter((x) => x !== undefined) }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'After exit', text: ['exit: memory and descriptors freed;', '  the entry stays, with the status:', '  a zombie', 'the parent\'s wait reaps it:', '  the entry is freed', 'parent gone first: the children', '  are re-parented to init (pid 1)', 'init waits in a loop, so', '  orphans are always reaped'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'exit' && f.meta.evs[0].pid >= 100 && fr.slice(i + 1).some((g) => g.meta.phase === 'reap' || (g.meta.phase === 'wait' && g.meta.evs.some((e) => e.kind === 'reap' && e.pid === f.meta.evs[0].pid))), once: true, pick: 'option',
        ask: (fr, i) => 'Process ' + fr[i].meta.evs[0].pid + ' is a zombie now. Who will reap it?', options: (fr, i) => { const pp = fr[i].meta.procs.find((p) => p.pid === fr[i].meta.evs[0].pid).ppid; return [...new Set(['its parent, ' + pp, 'init, pid 1', 'nobody: it stays a zombie'])]; },
        answer: (fr, i) => { const pid = fr[i].meta.evs[0].pid, pp = fr[i].meta.procs.find((p) => p.pid === pid).ppid; const r = fr.slice(i + 1).flatMap((g) => g.meta.evs).find((e) => e.kind === 'reap' && e.pid === pid); return r && r.by === 1 ? 'init, pid 1' : r ? 'its parent, ' + pp : 'nobody: it stays a zombie'; },
        explain: (fr, i) => { const pid = fr[i].meta.evs[0].pid, g = fr.slice(i + 1).find((x) => x.meta.evs.some((e) => e.kind === 'reap' && e.pid === pid)); return g ? g.say : 'Nobody waits for it.'; } },
    ],
    quiz: [
      { q: 'What does a zombie process still hold?', options: ['its process-table entry, with its pid and exit status', 'its memory', 'its open files', 'the CPU'], answer: 0, why: 'Everything else is freed at exit; the entry waits for the parent to read the status.' },
      { q: 'A parent exits while its child is still running. What becomes the child\'s parent?', options: ['init (pid 1)', 'the shell', 'nobody: getppid returns 0', 'the child itself'], answer: 0, why: 'The kernel re-parents orphans to init (or to a designated reaper on some systems).' },
      { q: 'Why is a long-running server that forks children and never waits a problem?', options: ['its zombies pile up in the process table, which can fill', 'its children cannot run', 'the server is killed', 'nothing happens'], answer: 0, why: 'Each zombie keeps a pid and an entry; the table is finite.' },
      { q: 'Can you kill a zombie with SIGKILL?', options: ['no: it is already dead; only a wait by its parent (or init) removes it', 'yes', 'only as root', 'yes, but only once'], answer: 0, why: 'A zombie runs no code, so signals do nothing; reaping is the only way out.' },
      { q: 'What does init do with the orphans it adopts?', options: ['waits for each one, so its entry is freed when it exits', 'kills them', 'gives them to the shell', 'nothing'], answer: 0, why: 'init loops on wait for exactly this reason.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
