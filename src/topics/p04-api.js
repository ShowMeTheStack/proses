// Part 4, the thread API: pthread_create and pthread_join stepped on the simulated kernel, with every thread's
// state over time and the values join collects; and a thread's own copy of a variable (what thread-local storage
// gives), against one shared variable that threads overwrite for each other, with every output over every
// schedule enumerated by S.Kern.outcomes.
(function (S) {
  'use strict';
  const H = S.P04, K7 = () => S.Kit.sync7, KP = () => S.Kit.proc;

  const JOIN = (k) => `void *square(void *arg) {
    long n = (long)arg + 2;
    long r = n * n;
    return (void *)r;
}
int main(void) {
    pthread_t t[${k}];
    long sum = 0;
    for (long i = 0; i < ${k}; i++)
        pthread_create(&t[i], NULL, square, (void *)i);
    for (int i = 0; i < ${k}; i++) {
        void *r;
        pthread_join(t[i], &r);
        sum += (long)r;
    }
    printf("sum of squares = %ld\\n", sum);
    return 0;
}`;
  H.topic({
    id: 'thr-join', family: 'p04-api', order: 10, title: 'pthread_create and pthread_join',
    blurb: 'pthread_create starts a function in a new thread and returns at once; the new thread is ready, and the scheduler decides when it runs. pthread_join waits for one thread to end and collects the value it returned. Joining in a fixed order is fine: a thread that ended early keeps its value until it is joined.',
    inputs: [
      { id: 'k', kind: 'choice', label: 'Threads', def: '3', options: ['2', '3', '4'].map((v) => ({ value: v, label: v })) },
      { id: 'policy', kind: 'choice', label: 'Scheduler', def: 'fifo', options: [{ value: 'fifo', label: 'creator keeps running' }, { value: 'rr', label: 'round robin' }, { value: 'random', label: 'random (seed 4)' }] },
    ],
    presets: [
      { label: 'Three, creator first', values: { k: '3', policy: 'fifo' } },
      { label: 'Three, round robin', values: { k: '3', policy: 'rr' } },
      { label: 'Two at random', values: { k: '2', policy: 'random' } },
      { label: 'Four, round robin', values: { k: '4', policy: 'rr' } },
    ],
    counters: [{ id: 'alive', label: 'threads alive' }, { id: 'joined', label: 'joined' }],
    run(inp) {
      const k = +inp.k, src = JOIN(k), R = H.kern(src, { sys: { policy: inp.policy, quantum: 2, seed: 4 } });
      const F = new S.Frames(['alive', 'joined']), off = H.off();
      const tids = [], history = [], rets = {}, got = [];
      const lastCap = R.steps[R.steps.length - 1].cap;
      for (const st of R.steps) for (const t of st.cap.threads) if (!tids.includes(t.tid)) tids.push(t.tid);
      function picture(i, act) {
        const cap = R.steps[i].cap, items = [];
        items.push(...H.code('cd', 0, 0, 476, src, H.marks(cap, 100, act, (t) => (t.main ? 'main' : t.tid)), Math.max(0, (cap.threads.find((t) => t.tid === act && t.state !== 'done') || { line: 0 }).line - off), 'square.c').items);
        const cards = tids.map((tid) => { const t = cap.threads.find((q) => q.tid === tid); return { id: tid, name: tid === 100 ? 'main' : String(tid), state: t ? t.state : 'new', act: tid === act, sub: tid === 100 ? '' : rets[tid] !== undefined ? '→ ' + rets[tid] : '' }; });
        items.push(...K7().threads({ prefix: 'tc', x: 496, y: 6, threads: cards, w: 58, h: 32, gap: 8, perRow: 5, subSize: 12 }).items);
        const rows = tids.map((tid) => ({ id: tid, label: tid === 100 ? 'main' : String(tid), cells: history.slice(0, i + 1).map((h) => h[tid] || null) }));
        items.push(...KP().timeline({ prefix: 'tl', x: 496, y: 112, w: 324, rows, n: Math.max(R.steps.length, 8), now: i, rowH: 22, labelW: 46, title: 'states, step by step' }).items);
        const ty = 112 + rows.length * 22 + 20;
        items.push(H.title('jt', 496, ty + 4, 'collected by join'));
        got.slice(0, (R.steps[i].gotN || 0)).forEach((g, j) => items.push({ key: 'gv' + j, kind: 'cell', x: 496 + j * 82, y: ty + 14, w: 78, h: 30, rx: 5, text: g.tid + ' → ' + g.v, size: 13, cls: 'varval ok' }));
        if (!R.steps[i].gotN) items.push(H.text('gn', 496, ty + 34, 'nothing yet', 'tick', 13));
        items.push(...KP().term({ prefix: 'tm', x: 496, y: ty + 58, w: 324, rows: H.term(cap), rowsShown: 1, title: 'terminal' }).items);
        return items;
      }
      R.steps.forEach((s, i) => {
        const h = {};
        for (const t of s.cap.threads) h[t.tid] = t.state === 'done' ? (rets[t.tid] !== undefined || s.events.some((e) => e.kind === 'thread-exit' && e.tid === t.tid) ? 'done' : 'done') : t.state;
        history.push(h);
        for (const e of s.events) {
          if (e.kind === 'thread-exit') rets[e.tid] = e.value;
          if (e.kind === 'join') { const m = /collects thread `(\d+)`, which ended with `(-?\d+)`/.exec(e.say); if (m) got.push({ tid: +m[1], v: +m[2] }); }
        }
        s.gotN = got.length;
        s.rets = Object.assign({}, rets);
      });
      R.steps.forEach((s, i) => {
        Object.assign(rets, {}); // values shown are those known at this step
        for (const key of Object.keys(rets)) delete rets[key];
        Object.assign(rets, s.rets);
        const alive = s.cap.threads.filter((t) => t.state !== 'done').length;
        F.set('alive', alive).set('joined', s.gotN);
        const say = i === 0 ? `main will create ${H.plural(k, 'thread')}, the i-th squaring i + 2, then join them in order and add up what they return. The scheduler ${inp.policy === 'fifo' ? 'lets the running thread go on until it blocks' : inp.policy === 'rr' ? 'gives each ready thread 2 statements in turn' : 'picks a ready thread at random (seed 4)'}.` : s.events.map((e) => e.say).join(' ');
        const vals = [k, 2, 4, alive, s.gotN, ...s.cap.threads.flatMap((t) => [t.tid, t.line - off, t.line]), ...Object.values(s.rets), ...got.flatMap((g) => [g.tid, g.v])];
        F.add({ items: picture(i, s.choice), say, meta: { ev: (s.events || []).map((e) => e.say), vals, joinTid: s.events.some((e) => e.kind === 'block' && /pthread_join/.test(e.say)) ? 1 : 0 } });
      });
      const sum = got.reduce((a, g) => a + g.v, 0);
      F.add({ items: picture(R.steps.length - 1, null), say: `Done: join collected ${H.list(got.map((g) => g.v))} from ${H.list(got.map((g) => g.tid))}, and main printed ${JSON.stringify(R.out.trim())}. ${R.steps.some((s) => s.events.some((e) => e.kind === 'join')) ? 'A thread that ended before main joined it kept its value until the join; one still running made main block.' : ''}`, meta: { vals: [sum, ...got.flatMap((g) => [g.tid, g.v])], sum } });
      return { frames: F.list, def: H.def('The calls', ['pthread_create(&t, NULL, f, arg)', '  a new thread runs f(arg); returns at once', 'pthread_join(t, &ret)', '  waits for t to end; ret gets f\'s value', 'pthread_exit(v)  end now, returning v', 'an ended, unjoined thread keeps its', '  value (like a zombie) until joined']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'What sum will main print?', options: (fr, i, inp) => { const k = +inp.k; const s = Array.from({ length: k }, (_, j) => (j + 2) * (j + 2)).reduce((a, b) => a + b, 0); return [...new Set([s - 4, s, s + (k + 2) * (k + 2)])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.sum), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'pthread_create returns. Has the new thread run yet?', options: ['maybe: the scheduler decides', 'yes, always to the end', 'never, until joined', 'only if it has a higher priority'], answer: 0, why: 'The new thread is ready; which runs first is up to the scheduler.' },
      { q: 'Thread A ends before main calls pthread_join(A). The join…', options: ['returns at once with A\'s value', 'waits for ever', 'returns an error', 'restarts A'], answer: 0, why: 'An ended thread keeps its return value until someone joins it.' },
      { q: 'What happens to the other threads when main returns from main()?', options: ['the whole process exits, ending them', 'they keep running', 'they are joined automatically', 'they become processes'], answer: 0, why: 'Returning from main calls exit, which ends every thread of the process.' },
      { q: 'Why is a thread\'s return value a void *?', options: ['so any pointer (or a small integer cast) can be passed back', 'threads return nothing', 'it is always NULL', 'it points into the kernel'], answer: 0, why: 'void * is the generic pointer; return a pointer to heap data, never to the thread\'s own stack.' },
    ],
  });

  // ---- a thread's own copy ---------------------------------------------------------------------------------------
  const TLS = (own) => own ? `int last_error[2];
void fail(int id, int code) {
    last_error[id] = code;
}
void *work(void *arg) {
    int id = (int)(long)arg;
    int code = id * 10 + 1;
    fail(id, code);
    int seen = last_error[id];
    printf("T%d set %d, read %d\\n", id, code, seen);
    return NULL;
}
int main(void) {
    pthread_t t[2];
    for (long i = 0; i < 2; i++)
        pthread_create(&t[i], NULL, work, (void *)i);
    for (int i = 0; i < 2; i++)
        pthread_join(t[i], NULL);
    return 0;
}` : `int last_error = 0;
void fail(int id, int code) {
    last_error = code;
}
void *work(void *arg) {
    int id = (int)(long)arg;
    int code = id * 10 + 1;
    fail(id, code);
    int seen = last_error;
    printf("T%d set %d, read %d\\n", id, code, seen);
    return NULL;
}
int main(void) {
    pthread_t t[2];
    for (long i = 0; i < 2; i++)
        pthread_create(&t[i], NULL, work, (void *)i);
    for (int i = 0; i < 2; i++)
        pthread_join(t[i], NULL);
    return 0;
}`;
  const wrongIn = (out) => out.split('\n').filter((l) => { const m = /set (\d+), read (\d+)/.exec(l); return m && m[1] !== m[2]; });
  H.topic({
    id: 'thr-tls', family: 'p04-api', order: 20, title: 'A variable of each thread\'s own',
    blurb: 'A library that reports errors through one global variable, like a single last_error, breaks with threads: one thread sets it, another overwrites it, and the first reads the wrong code. Thread-local storage gives every thread its own copy under the same name; here each thread\'s copy is its own slot, last_error[id].',
    inputs: [
      { id: 'own', kind: 'choice', label: 'last_error is', def: 'shared', options: [{ value: 'shared', label: 'one global for all' }, { value: 'own', label: 'one per thread' }] },
      { id: 'seed', kind: 'number', label: 'Schedule seed', def: 25, min: 1, max: 40 },
    ],
    presets: [
      { label: 'Shared: a clash', values: { own: 'shared', seed: 25 } },
      { label: 'Shared: lucky', values: { own: 'shared', seed: 1 } },
      { label: 'Per thread, same schedule', values: { own: 'own', seed: 25 } },
      { label: 'Shared, seed 15', values: { own: 'shared', seed: 15 } },
    ],
    counters: [{ id: 'wrong', label: 'wrong reads' }],
    run(inp) {
      const own = inp.own === 'own', src = TLS(own), off = H.off();
      const R = H.kern(src, { sys: { policy: 'random', seed: inp.seed }, every: (evs) => evs.some((e) => e.kind === 'step') });
      const all = S.Kern.outcomes(H.HDR + src), outs = [...all.outputs.keys()], bad = outs.filter((o) => wrongIn(o).length);
      const F = new S.Frames(['wrong']);
      const tids = [101, 102];
      let prevKey = '', prevV = null;
      const lastSeen = {}, seenOf = (cap, tid) => { const l = (cap.locals[tid] || []).find((x) => x.name === 'seen' && x.value !== null); if (l && cap.threads.find((t) => t.tid === tid && t.line - off >= 10)) lastSeen[tid] = l.value; return lastSeen[tid] === undefined ? null : lastSeen[tid]; };
      const sets = {};
      function picture(cap, act, final) {
        const items = [];
        const al = (cap.threads.find((t) => t.tid === act) || { line: 0 }).line - off;
        items.push(...H.code('cd', 0, 0, 476, src, H.marks(cap, 100, act, (t) => (t.main ? 'main' : 'T' + (t.tid - 101))), al > 0 ? al : 0, own ? 'one slot per thread' : 'one shared global').items);
        const g = cap.globals[100] || {}, le = g.last_error ? g.last_error.value : own ? [0, 0] : 0;
        items.push(H.title('mt', 496, 16, 'last_error in memory'));
        if (own) le.forEach((v, j) => items.push({ key: 'le' + j, kind: 'cell', x: 496 + j * 130, y: 28, w: 122, h: 34, rx: 6, text: '[' + j + '] = ' + v, size: 15, cls: 'varval own ' + H.pcls(j + 1) }));
        else items.push({ key: 'le0', kind: 'cell', x: 496, y: 28, w: 252, h: 34, rx: 6, text: 'last_error = ' + le, size: 15, cls: 'varval shared' });
        tids.forEach((tid, j) => {
          const t = cap.threads.find((q) => q.tid === tid), sv = seenOf(cap, tid), st = sets[tid];
          const y = 90 + j * 70;
          items.push(...K7().threads({ prefix: 'th' + j, x: 496, y, threads: [{ id: j + 1, name: 'T' + j, state: t ? t.state : 'new', act: act === tid }], w: 60, h: 32 }).items);
          const wrongNow = st !== undefined && sv !== null && sv !== st;
          items.push({ key: 'sv' + j, kind: 'cell', x: 566, y: y + 1, w: 254, h: 30, rx: 5, text: (st === undefined ? 'has not set it' : 'set ' + st) + (sv === null ? '' : ', read ' + sv), size: 14, cls: 'varval' + (wrongNow ? ' bad' : sv !== null ? ' ok' : '') });
        });
        items.push(...KP().term({ prefix: 'tm', x: 496, y: 236, w: 324, rows: H.term(cap), rowsShown: 2, title: 'terminal' }).items);
        if (final) {
          items.push(...K7().verdict({ prefix: 'vd', x: 496, y: 350, w: 324, kind: bad.length ? 'bad' : 'ok', head: 'Every schedule: ' + H.plural(outs.length, 'output'), lines: [bad.length ? H.plural(bad.length, 'output') + ' with a wrong read' : 'no thread ever reads a wrong code'] }).items);
        }
        return items;
      }
      R.steps.forEach((s, i) => {
        const cap = s.cap, g = cap.globals[100] || {};
        const nowV = JSON.stringify(g.last_error && g.last_error.value);
        if (tids.includes(s.choice) && nowV !== prevV) { const id = s.choice - 101; sets[s.choice] = id * 10 + 1; }
        prevV = nowV;
        const key = JSON.stringify([g.last_error && g.last_error.value, tids.map((t) => seenOf(cap, t)), s.events.filter((e) => e.kind !== 'step').length ? i : 0]);
        if (i && key === prevKey) return;
        prevKey = key;
        const w = wrongIn(cap.out).length;
        F.set('wrong', w);
        let say;
        if (i === 0) say = `Two threads each call fail() with a code of their own (T0 uses 1, T1 uses 11), then read last_error back. ${own ? 'Each thread writes and reads only its own slot.' : 'Both write and read the one global.'} The scheduler picks at random with seed ${inp.seed}.`;
        else {
          const ev = s.events.filter((e) => e.kind !== 'step').map((e) => e.say);
          const t = cap.threads.find((q) => q.tid === s.choice), who = s.choice === 100 ? 'main' : 'T' + (s.choice - 101);
          if (!ev.length) ev.push(`${who} runs line ${t ? t.line - off : 0}; last_error is now ${own ? '[' + g.last_error.value.join(', ') + ']' : '`' + g.last_error.value + '`'}.`);
          say = ev.join(' ');
        }
        F.add({ items: picture(cap, s.choice, false), say, meta: { ev: (s.events || []).map((e) => e.say), vals: [inp.seed, w, ...[].concat(g.last_error ? g.last_error.value : []), ...tids.map((t) => seenOf(cap, t)).filter((v) => v !== null), ...cap.threads.map((t) => t.line - off), 1, 11] } });
      });
      const last = R.steps[R.steps.length - 1].cap, w = wrongIn(R.out);
      F.add({ items: picture(last, null, true), say: `${w.length ? 'This schedule went wrong: ' + w.map((l) => '"' + l + '"').join(', ') + '.' : 'This schedule happened to be fine.'} Over every schedule the kernel can produce there ${outs.length === 1 ? 'is 1 output' : 'are ' + outs.length + ' outputs'}, and ${bad.length ? H.plural(bad.length, 'of them shows', 'of them show') + ' a thread reading the other\'s code' : 'in none of them does a thread read the other\'s code'}. ${own ? 'With a copy per thread, the order of the lines is all that varies.' : 'Testing a few runs could easily miss this; a copy per thread removes it.'}`, meta: { vals: [w.length, outs.length, bad.length, all.states, 1, 11], outs: outs.length, bad: bad.length } });
      return { frames: F.list, def: H.def('Thread-local storage', ['_Thread_local int last_error;   (C11)', '  one copy per thread, same name', 'errno is one: each thread has its own', 'here: last_error[id], a slot per thread,', '  which is what the compiler arranges', 'pthread_key_create / getspecific:', '  the library version of the same idea']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Over every possible schedule, can some thread read the other thread\'s code?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.bad ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why must errno be thread-local?', options: ['one thread\'s failing call would overwrite another\'s error code', 'it is too large to share', 'the kernel forbids sharing it', 'it lives in a register'], answer: 0, why: 'Between a call and the check of errno, another thread can fail and change it.' },
      { q: 'A thread-local variable has…', options: ['one name, and a separate copy in every thread', 'one copy shared by all', 'a copy per process only', 'no address'], answer: 0, why: 'Each thread reaches its own copy through the same name.' },
      { q: 'Is a local variable already private to its thread?', options: ['yes, but it lives only for one call; thread-local storage lasts the thread\'s whole life', 'no, locals are shared', 'only in main', 'only if static'], answer: 0, why: 'Locals die with their frame; a thread-local variable persists across calls.' },
      { q: 'Making last_error a per-thread slot fixes the clash because…', options: ['the two threads no longer write the same memory', 'it adds a lock', 'it makes the threads run in order', 'it slows them down'], answer: 0, why: 'No shared memory, no race.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
