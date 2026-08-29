// Part 4, fork and exec in a threaded program, on the simulated kernel: fork copies the process with only the
// calling thread, so a mutex another thread held at that moment is locked in the child with no thread there to
// unlock it; exec replaces the image and every other thread of the process ends.
(function (S) {
  'use strict';
  const H = S.P04, K7 = () => S.Kit.sync7, KP = () => S.Kit.proc;

  const FORK = {
    lock: { label: 'the child locks m', child: '        pthread_mutex_lock(&m);\n        printf("child: got the lock\\n");\n        exit(0);' },
    nolock: { label: 'the child leaves m alone', child: '        printf("child: no lock needed\\n");\n        exit(0);' },
    exec: { label: 'the child calls exec at once', child: '        execl("/bin/echo", "echo", "child: a fresh image", NULL);\n        exit(1);' },
    before: { label: 'fork before making the thread', child: null },
  };
  const forkProg = (v) => v === 'before' ? `pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *saver(void *arg) {
    pthread_mutex_lock(&m);
    sleep(2);
    pthread_mutex_unlock(&m);
    return NULL;
}
int main(void) {
    pid_t pid = fork();
    if (pid == 0) {
        pthread_mutex_lock(&m);
        printf("child: got the lock\\n");
        exit(0);
    }
    pthread_t t;
    pthread_create(&t, NULL, saver, NULL);
    waitpid(pid, NULL, 0);
    pthread_join(t, NULL);
    printf("parent: child done\\n");
    return 0;
}` : `pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
void *saver(void *arg) {
    pthread_mutex_lock(&m);
    sleep(2);
    pthread_mutex_unlock(&m);
    return NULL;
}
int main(void) {
    pthread_t t;
    pthread_create(&t, NULL, saver, NULL);
    sleep(1);
    pid_t pid = fork();
    if (pid == 0) {
${FORK[v].child}
    }
    waitpid(pid, NULL, 0);
    pthread_join(t, NULL);
    printf("parent: child done\\n");
    return 0;
}`;

  function panel(prefix, x, w, cap, pid, title, act, extra) {
    const items = [], p = cap.procs.find((q) => q.pid === pid);
    const gone = !p || p.state === 'zombie' || p.state === 'reaped';
    items.push({ key: prefix + ':bg', kind: 'region', x, y: 0, w, h: 236, rx: 10, cls: gone ? 'frame' : 'panel', audit: 'group', layer: 'back' });
    items.push(H.text(prefix + ':t', x + 14, 26, title + (p ? ', ' + (p.state === 'zombie' ? 'exited' : p.image === 'builtin' ? 'now echo' : p.state) : ''), gone ? 'tick' : 'strong', 15));
    const ths = cap.threads.filter((t) => t.pid === pid && !(gone && t.state === 'done'));
    if (ths.length) items.push(...K7().threads({ prefix: prefix + 'th', x: x + 14, y: 44, threads: ths.map((t) => ({ id: t.tid, name: String(t.tid), state: t.state, act: t.tid === act, sub: t.main ? 'main' : 'saver' })), w: 70, h: 32, gap: 10 }).items);
    else items.push(H.text(prefix + ':nt', x + 14, 66, gone ? 'no threads left' : 'no C threads: a built-in program', 'tick', 13));
    const mo = cap.objs.find((o) => o.kind === 'mutex' && o.pid === pid);
    const owner = mo && mo.owner ? mo.owner : null, here = owner && cap.threads.some((t) => t.tid === owner && t.pid === pid && t.state !== 'done');
    items.push(...K7().mutex({ prefix: prefix + 'mx', x: x + 14, y: 130, name: 'm', owner: owner ? String(owner) : null, ownerCls: here ? '' : 'ghost', queue: mo ? mo.q.map(String) : [], nameW: 30, ownerW: 70, label: 'its copy of m: owner' }).items);
    if (owner && !here && !gone) items.push(H.text(prefix + ':gh', x + 14, 200, 'thread ' + owner + ' is not in this process', 'hot', 13));
    if (extra) items.push(H.text(prefix + ':ex', x + 14, 222, extra, 'tick', 13));
    return items;
  }

  H.topic({
    id: 'thr-fork', family: 'p04-fork', order: 10, title: 'fork in a threaded program',
    blurb: 'fork copies the whole address space but only the thread that called it. Every mutex is copied in whatever state it was in. If another thread held a lock at that moment, the child\'s copy stays locked for ever: the thread that would unlock it exists only in the parent. Hence the rule: after fork in a threaded program, the child should call exec (or only simple, lock-free functions).',
    inputs: [{ id: 'v', kind: 'choice', label: 'Program', def: 'lock', options: Object.entries(FORK).map(([value, o]) => ({ value, label: o.label })) }],
    presets: [
      { label: 'Child locks m: stuck', values: { v: 'lock' } },
      { label: 'Child leaves m alone', values: { v: 'nolock' } },
      { label: 'Child calls exec', values: { v: 'exec' } },
      { label: 'Fork first, then threads', values: { v: 'before' } },
    ],
    counters: [{ id: 'threads', label: 'threads alive' }],
    run(inp) {
      const src = forkProg(inp.v), R = H.kern(src), off = H.off();
      const F = new S.Frames(['threads']);
      let child = null;
      function picture(cap, act, final) {
        const items = panel('pa', 0, 390, cap, 100, 'parent 100', act);
        if (child) items.push(...panel('ch', 410, 390, cap, child, 'child ' + child, act, final && R.status === 'deadlock' ? 'blocked for ever' : ''));
        else items.push({ key: 'ch:bg', kind: 'region', x: 410, y: 0, w: 390, h: 236, rx: 10, cls: 'frame', audit: 'group', layer: 'back' }, H.text('ch:t', 424, 26, 'no child yet', 'tick', 15));
        items.push(...KP().term({ prefix: 'tm', x: 0, y: 256, w: 800, rows: H.term(cap), rowsShown: 2, title: 'terminal' }).items);
        return items;
      }
      R.steps.forEach((s, i) => {
        for (const e of s.events) if (e.kind === 'fork') { const m = /into process `(\d+)`/.exec(e.say); if (m) child = +m[1]; }
        const cap = s.cap;
        F.set('threads', cap.threads.filter((t) => t.state !== 'done').length);
        let say = i === 0 ? `main ${inp.v === 'before' ? 'forks first, and only then' : 'first'} starts a thread, saver, that locks m and keeps it for 2 seconds of sleep. ${inp.v === 'before' ? 'The child is made while no other thread exists.' : 'main sleeps 1 second, so it forks while saver holds m.'}` : s.events.map((e) => e.say).join(' ');
        if (s.events.some((e) => e.kind === 'fork')) {
          const mo = cap.objs.find((o) => o.kind === 'mutex' && o.pid === child);
          say += ` The child has one thread, a copy of the caller${mo && mo.owner ? '; its copy of m is still marked held by thread ' + mo.owner + ', which was not copied' : ''}.`;
        }
        const vals = [2, 1, child || 0, ...cap.threads.flatMap((t) => [t.tid, t.pid, t.line - off, t.line]), ...cap.objs.flatMap((o) => [o.owner, o.addr, o.pid]), ...s.events.flatMap((e) => [e.clock, e.secs])].filter((v) => typeof v === 'number');
        F.add({ items: picture(cap, s.choice, false), say, meta: { ev: (s.events || []).map((e) => e.say), vals: vals.concat(s.events.map((e) => e.say).join(' ').match(/\d+(\.\d+)?/g) || []).map(Number) } });
      });
      const last = R.steps[R.steps.length - 1].cap, stuck = R.status === 'deadlock';
      F.add({ items: picture(last, null, true), say: stuck ? `Nothing can run again. The child waits for its copy of m, which only thread ${(last.objs.find((o) => o.kind === 'mutex' && o.pid === child) || {}).owner} could unlock, and that thread lives in the parent, where it unlocked the parent's own m. The parent in turn waits for the child: the program hangs.` : `Everything finished: ${JSON.stringify(R.out.trim().split('\n'))}. ${inp.v === 'exec' ? 'exec threw away the copied memory, the stuck lock with it.' : inp.v === 'before' ? 'No other thread existed at the fork, so nothing was copied mid-flight.' : 'The child never touched the lock that was copied held.'}`, meta: { vals: [((last.objs.find((o) => o.kind === 'mutex' && o.pid === child) || {}).owner) || 0], stuck } });
      return { frames: F.list, def: H.def('fork with threads', ['the child gets:', '  a copy of all memory, every mutex', '  in the state it was in', '  ONE thread: a copy of the caller', 'a lock held by another thread stays', '  locked in the child, for ever', 'safe: exec right after fork', 'pthread_atfork: take every lock before', '  fork, release them in both after']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Will this program finish?', options: ['yes', 'no, it hangs'], answer: (fr) => (fr[fr.length - 1].meta.stuck ? 'no, it hangs' : 'yes'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A process with 4 threads calls fork. How many threads does the child have?', options: ['1', '4', '0', '5'], answer: 0, why: 'Only the calling thread is copied.' },
      { q: 'Why can the child\'s lock never be released?', options: ['the owner thread exists only in the parent', 'mutexes cannot be copied', 'the child has no stack', 'fork resets every lock'], answer: 0, why: 'The lock word says "held", and no thread in the child holds it.' },
      { q: 'Which is safe in the child of a threaded process?', options: ['calling exec straight away', 'calling malloc, whose lock may be held', 'locking any mutex', 'joining the parent\'s threads'], answer: 0, why: 'exec replaces the whole image, copied locks included.' },
      { q: 'printf takes a lock on stdout inside the library. A child that printfs after fork from a threaded parent…', options: ['can hang if another thread held that lock at the fork', 'is always safe', 'prints twice', 'gets a new stdout'], answer: 0, why: 'Library locks are copied too.' },
    ],
  });

  // ---- exec ---------------------------------------------------------------------------------------------------------
  const EXEC = (k, who) => `int ticks = 0;
void *beat(void *arg) {
    long me = (long)arg;
    while (1) {
        ticks++;
        if (me == ${who === 'worker' ? 1 : -1} && ticks >= 4)
            execl("/bin/echo", "echo", "a new image", NULL);
        sleep(1);
    }
    return NULL;
}
int main(void) {
    pthread_t t[${k}];
    for (long i = 1; i <= ${k}; i++)
        pthread_create(&t[i - 1], NULL, beat, (void *)i);
    sleep(2);
    printf("ticks = %d\\n", ticks);
    ${who === 'main' ? 'execl("/bin/echo", "echo", "a new image", NULL);' : 'sleep(5);'}
    return 1;
}`;
  H.topic({
    id: 'thr-exec', family: 'p04-fork', order: 20, title: 'exec in a threaded program',
    blurb: 'exec replaces the program of the whole process: the code, the globals, the heap and every stack go, and with them every thread but the one that called exec, which becomes the single thread of the new program. The pid and the open descriptors stay. It does not matter which thread calls it.',
    inputs: [
      { id: 'k', kind: 'choice', label: 'Worker threads', def: '2', options: ['1', '2', '3'].map((v) => ({ value: v, label: v })) },
      { id: 'who', kind: 'choice', label: 'Who calls exec', def: 'main', options: [{ value: 'main', label: 'main' }, { value: 'worker', label: 'worker 1' }] },
    ],
    presets: [{ label: 'main execs, two workers', values: { k: '2', who: 'main' } }, { label: 'A worker execs', values: { k: '2', who: 'worker' } }, { label: 'Three workers', values: { k: '3', who: 'main' } }],
    counters: [{ id: 'threads', label: 'threads' }],
    run(inp) {
      const k = +inp.k, R = H.kern(EXEC(k, inp.who)), off = H.off();
      const F = new S.Frames(['threads']);
      const ever = [];
      let caller = null;
      function picture(cap, act, ev) {
        const items = [], p = cap.procs.find((q) => q.pid === 100), img = p && p.image === 'builtin';
        for (const t of cap.threads) if (!ever.includes(t.tid)) ever.push(t.tid);
        items.push({ key: 'bg', kind: 'region', x: 0, y: 0, w: 520, h: 250, rx: 10, cls: 'panel', audit: 'group', layer: 'back' });
        items.push(H.text('pt', 14, 28, 'process 100: ' + (img ? 'running echo' : p && (p.state === 'zombie' || p.state === 'reaped') ? 'exited' : 'running the C program'), 'strong', 15));
        const cards = ever.map((tid) => { const t = cap.threads.find((q) => q.tid === tid); if (img && tid === caller) return { id: tid, name: String(tid), state: p.state === 'zombie' || p.state === 'reaped' ? 'done' : 'running', act: true, sub: 'runs echo' }; return { id: tid, name: String(tid), state: !t || img ? 'done' : t.state, act: tid === act, sub: !t || img || t.state === 'done' ? 'gone' : t.main ? 'main' : 'beat' }; });
        items.push(...K7().threads({ prefix: 'th', x: 14, y: 48, threads: cards, w: 76, h: 34, gap: 12 }).items);
        const g = cap.globals[100];
        items.push({ key: 'img', kind: 'cell', x: 14, y: 130, w: 492, h: 40, rx: 6, text: img ? 'image: echo, one thread, fresh memory' : 'image: the C program, ticks = ' + (g && g.ticks ? g.ticks.value : 0), size: 15, cls: 'varval' + (img ? ' ok' : '') });
        items.push(H.text('keep', 14, 204, 'kept across exec: pid 100, descriptors 0, 1, 2', 'tick', 13));
        items.push(...KP().term({ prefix: 'tm', x: 540, y: 0, w: 260, rows: H.term(cap), rowsShown: 3, title: 'terminal' }).items);
        return items;
      }
      R.steps.forEach((s, i) => {
        for (const e of s.events) if (e.kind === 'exec') caller = e.tid;
        const cap = s.cap, alive = cap.threads.filter((t) => t.state !== 'done').length;
        F.set('threads', cap.procs.find((q) => q.pid === 100 && q.image === 'builtin') ? 1 : alive);
        let say = i === 0 ? `main starts ${H.plural(k, 'thread')} that each add 1 to ticks every second; ${inp.who === 'main' ? 'after 2 seconds main prints ticks and calls exec' : 'the first worker calls exec once ticks reaches 4'}.` : s.events.map((e) => e.say).join(' ');
        if (s.events.some((e) => e.kind === 'exec')) say += ` Every other thread of process 100 is gone with the old image: ${H.list(ever.filter((t) => t !== s.choice).map(String))}.`;
        const vals = [k, 2, 4, 100, ...ever, ...cap.threads.flatMap((t) => [t.tid, t.line - off, t.line]), ...(s.events.map((e) => e.say).join(' ').match(/\d+(\.\d+)?/g) || []).map(Number)];
        F.add({ items: picture(cap, s.choice, s.events), say, meta: { ev: (s.events || []).map((e) => e.say), vals } });
      });
      const last = R.steps[R.steps.length - 1].cap;
      F.add({ items: picture(last, null), say: `The output: ${JSON.stringify(R.out.trim().split('\n'))}. The ${H.plural(ever.length, 'thread')} of the old program ended at the exec; echo ran as the single thread of process 100, the same pid.`, meta: { vals: [ever.length, 100], out: R.out, n: ever.length } });
      return { frames: F.list, def: H.def('exec with threads', ['every thread but the caller ends', 'the caller becomes the new image\'s', '  single (main) thread', 'kept: pid, open descriptors,', '  ignored signals', 'lost: code, globals, heap, stacks']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many threads does process 100 have right after exec?', options: ['0', '1', '2', '3', '4'], answer: '1', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A worker thread (not main) calls exec. Then…', options: ['the new program runs as the only thread, in the same process', 'only that thread is replaced', 'exec fails', 'main keeps running the old code'], answer: 0, why: 'exec acts on the whole process.' },
      { q: 'What survives exec?', options: ['the pid and open descriptors', 'the threads', 'the globals', 'the heap'], answer: 0, why: 'The image goes; the process and its open files stay.' },
      { q: 'Why is exec the safe thing for a child forked from a threaded parent?', options: ['it discards the copied memory with any stuck locks in it', 'it unlocks every mutex', 'it copies the parent\'s threads', 'it joins the threads'], answer: 0, why: 'A fresh image has fresh, unlocked state.' },
      { q: 'After exec, what happens to an unflushed printf buffer?', options: ['it is lost with the old memory', 'it is printed', 'it moves to the new program', 'it is written to a file'], answer: 0, why: 'The buffer was in the old image\'s memory: flush before exec.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
