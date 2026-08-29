// Part 4, pools and fork-join. A fixed pool of worker threads takes tasks from a queue guarded by a mutex and a
// condition variable, run on the thread-step machine (S.Sync) under a seeded random scheduler; and an array summed
// by k threads in real C on the simulated kernel (S.Kern), each over its own slice, then joined and combined.
(function (S) {
  'use strict';
  const H = S.P04, Y = () => S.Sync, P7 = () => S.P07, K7 = () => S.Kit.sync7;

  /** the pool as a machine spec: main queues the tasks then closes the queue; each worker takes, runs, repeats */
  function poolSpec(w, costs) {
    const n = costs.length, main = [];
    costs.forEach((c, i) => main.push({ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'write', v: 'q', idx: 'tail', val: i, label: 'q[tail] = task ' + i }, { op: 'update', v: 'tail', by: 1, label: 'tail++' }, { op: 'signal', c: 'c', label: 'signal(c)' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }));
    main.push({ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'write', v: 'closed', val: 1, label: 'closed = 1' }, { op: 'broadcast', c: 'c', label: 'broadcast(c)' }, { op: 'unlock', m: 'm', label: 'unlock(m)' });
    const worker = [
      { label: 'top' }, { op: 'lock', m: 'm', label: 'lock(m)' },
      { label: 'chk' }, { op: 'read', v: 'head', into: 'h', label: 'h = head' }, { op: 'read', v: 'tail', into: 't', label: 't = tail' },
      { op: 'jump', to: 'got', if: (r) => r.h < r.t, label: 'if a task waits' },
      { op: 'read', v: 'closed', into: 'cl', label: 'cl = closed' }, { op: 'jump', to: 'quit', if: (r) => r.cl, label: 'if closed, quit' },
      { op: 'cwait', c: 'c', m: 'm', label: 'wait(c, m)' }, { op: 'jump', to: 'chk', label: 'test again' },
      { label: 'got' }, { op: 'read', v: 'q', idx: 'head', into: 'task', label: 'task = q[head]' }, { op: 'update', v: 'head', by: 1, label: 'head++' }, { op: 'unlock', m: 'm', label: 'unlock(m)' },
      { op: 'local', fn: (r) => { r.left = costs[r.task]; }, label: 'left = cost(task)' },
      { label: 'run' }, { op: 'jump', to: 'fin', if: (r) => r.left === 0, label: 'if finished' }, { op: 'work', label: 'runs its task' }, { op: 'local', fn: (r) => { r.left--; }, label: 'left--' }, { op: 'jump', to: 'run', label: 'go on' },
      { label: 'fin' }, { op: 'log', v: 'done', val: (r, th) => r.task + ':' + th.name, label: 'finishes', mark: 'progress' }, { op: 'local', fn: (r) => { r.task = null; }, label: 'forgets the task' }, { op: 'jump', to: 'top', label: 'next task' },
      { label: 'quit' }, { op: 'unlock', m: 'm', label: 'unlock(m)' },
    ];
    const threads = [{ name: 'main', prog: main }];
    for (let i = 0; i < w; i++) threads.push({ name: 'W' + (i + 1), prog: worker });
    return { threads, mutexes: [{ id: 'm', name: 'm' }], conds: [{ id: 'c', name: 'c' }], vars: { q: Array(n).fill(null), head: 0, tail: 0, closed: 0, done: [] } };
  }
  const KEEP = new Set(['block', 'cwait', 'csignal', 'handoff', 'lost', 'log', 'update', 'write']);
  function checkCosts(v) {
    if (v.length < 2 || v.length > 7) return 'Task lengths: 2 to 7 tasks';
    if (v.some((x) => !/^\d+$/.test(x) || +x < 1 || +x > 9)) return 'Task lengths: whole numbers from 1 to 9';
    return null;
  }
  H.topic({
    id: 'thr-pool', family: 'p04-patterns', order: 10, title: 'A thread pool',
    blurb: 'Making a thread for every small task costs a system call, a stack and a scheduler entry each time, and a burst of tasks makes a burst of threads. A pool makes a few workers once; main puts tasks in a queue, and each idle worker takes the next one. The queue is shared, so a mutex guards it and a condition variable lets idle workers sleep.',
    inputs: [
      { id: 'workers', kind: 'choice', label: 'Workers', def: '2', options: ['1', '2', '3'].map((v) => ({ value: v, label: v })) },
      { id: 'costs', kind: 'list', label: 'Task lengths (steps)', def: ['3', '1', '4', '2', '2'], check: checkCosts },
      { id: 'seed', kind: 'number', label: 'Schedule seed', def: 2, min: 1, max: 50 },
    ],
    presets: [
      { label: 'Two workers, five tasks', values: { workers: '2', costs: ['3', '1', '4', '2', '2'], seed: 2 } },
      { label: 'One worker', values: { workers: '1', costs: ['3', '1', '4', '2', '2'], seed: 2 } },
      { label: 'Three workers, a long task', values: { workers: '3', costs: ['8', '1', '1', '1', '1', '1'], seed: 5 } },
      { label: 'Short tasks', values: { workers: '2', costs: ['1', '1', '1', '1'], seed: 7 } },
    ],
    counters: [{ id: 'queued', label: 'in the queue' }, { id: 'done', label: 'tasks done' }],
    run(inp) {
      const w = +inp.workers, costs = inp.costs.map(Number), n = costs.length, spec = poolSpec(w, costs);
      const run = Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 3, max: 2000 });
      const F = new S.Frames(['queued', 'done']);
      function picture(st, s) {
        const items = [], V = st.vars, act = s ? s.tid : null;
        items.push(H.title('qt', 0, 14, 'the task queue'));
        const doneBy = {};
        for (const d of V.done) { const [t, wn] = d.split(':'); doneBy[t] = wn; }
        const running = {};
        st.threads.forEach((th) => { if (th.id > 0 && th.reg.task !== null && th.reg.task !== undefined) running[th.reg.task] = th; });
        for (let i = 0; i < n; i++) {
          const queued = i < V.tail, taken = i < V.head;
          const who = doneBy[i] ? doneBy[i] : running[i] ? running[i].name : null;
          const cls = doneBy[i] ? 'varval ok' : running[i] ? 'thstk ' + H.pcls(running[i].id) : queued ? 'varval' : 'varval empty';
          items.push({ key: 'q' + i, kind: 'cell', x: i * 112, y: 26, w: 104, h: 44, rx: 6, text: queued ? 'task ' + i + ' (' + costs[i] + ')' : '', size: 14, cls });
          items.push(H.text('qs' + i, i * 112 + 52, 88, doneBy[i] ? 'done by ' + who : running[i] ? who + (running[i].reg.left === undefined || running[i].reg.left === null || running[i].reg.task !== i ? ' takes it' : ', ' + running[i].reg.left + ' left') : queued && !taken ? 'waiting' : '', doneBy[i] ? 'good' : 'tick', 13, 'middle'));
        }
        items.push({ key: 'hd', kind: 'head', x: Math.min(V.head, n - 1) * 112 + 52 + (V.head >= n ? 56 : 0), y: 104, text: 'head ' + V.head, side: 'below' });
        items.push(H.title('wt', 0, 172, 'threads'));
        items.push(...K7().threads({ prefix: 'th', x: 0, y: 184, threads: st.threads.map((th) => ({ id: th.id, name: th.name, state: th.state === 'ready' && act === th.id ? 'running' : th.state, act: act === th.id, sub: th.id === 0 ? (th.state === 'done' ? 'all queued' : 'queuing') : th.state === 'done' ? 'quit' : th.state === 'blocked' ? (th.on.kind === 'cond' ? 'asleep on c' : 'waits for m') : th.reg.task !== null && th.reg.task !== undefined ? 'task ' + th.reg.task : 'looking' })), w: 90, h: 36, gap: 14 }).items);
        items.push(...H.lockCond('ob', 0, 300, st, 'm', 'c', s && s.obj));
        items.push(H.text('cl', 500, 302, 'closed = ' + V.closed + ', head = ' + V.head + ', tail = ' + V.tail, 'mono', 14));
        return items;
      }
      const st0 = Y().machine(spec).snap();
      F.add({ items: picture(st0, null), say: `main will queue ${H.plural(n, 'task')} of ${H.list(costs)} steps for a pool of ${H.plural(w, 'worker')}, then mark the queue closed. A worker holds m only while it looks at the queue; it runs its task with m released, so others can take tasks meanwhile. The scheduler is random with seed ${inp.seed}.`, meta: { vals: [n, w, inp.seed, ...costs] } });
      run.steps.forEach((s, k) => {
        const keep = KEEP.has(s.kind) && !(s.kind === 'update' && s.obj !== 'head') && !(s.kind === 'write' && s.obj !== 'closed');
        const took = s.op === 'read' && s.label === 'task = q[head]';
        if (!keep && !took) return;
        const V = s.state.vars;
        F.set('queued', V.tail - V.head).set('done', V.done.length);
        let say = s.say;
        if (took) say = `${s.name} takes task ${s.state.threads[s.tid].reg.task} (${costs[s.state.threads[s.tid].reg.task]} steps) from the front of the queue.`;
        if (s.kind === 'log') { const t = s.state.threads[s.tid]; say = `${s.name} finishes task ${V.done[V.done.length - 1].split(':')[0]}; ${H.plural(V.done.length, 'task')} of ${n} done.`; }
        F.add({ items: picture(s.state, s), say, meta: { vals: [V.head, V.tail, V.done.length, n, ...V.done.map((d) => +d.split(':')[0]), ...costs, ...s.state.threads.map((t) => t.reg.task).filter((x) => x !== null && x !== undefined), ...s.state.threads.map((t) => t.reg.left).filter((x) => x !== undefined)], next: null } });
      });
      const M = run.machine, per = {};
      for (const d of M.vars.done) { const [, wn] = d.split(':'); per[wn] = (per[wn] || 0) + 1; }
      const busy = M.threads.slice(1).map((th) => th.name + ' ran ' + H.plural(M.vars.done.filter((d) => d.endsWith(':' + th.name)).length, 'task'));
      F.add({ items: picture(M.snap(), null), say: `${run.end.say} ${H.list(busy)}: ${H.plural(n, 'task')} with ${H.plural(w, 'thread')} made once, where a thread per task would have made ${n}. A worker that drew short tasks simply took more of them.`, meta: { vals: [n, w, M.t, ...Object.values(per)], per } });
      return { frames: F.list, def: H.def('A pool', ['main:   lock; q[tail++] = task;', '        signal(c); unlock', 'worker: lock', '        while (queue empty && !closed)', '            wait(c, m)', '        take q[head++]; unlock', '        run the task (no lock held)', 'n tasks, w threads made once']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Which worker will finish the most tasks?', options: (fr, i, inp) => Array.from({ length: +inp.workers }, (_, j) => 'W' + (j + 1)).concat(+inp.workers > 1 ? ['a tie'] : []), answer: (fr, i, inp) => { const p = fr[fr.length - 1].meta.per, ws = Array.from({ length: +inp.workers }, (_, j) => 'W' + (j + 1)), best = Math.max(...ws.map((x) => p[x] || 0)), top = ws.filter((x) => (p[x] || 0) === best); return top.length > 1 ? 'a tie' : top[0]; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why does a worker release m before running its task?', options: ['so other workers can take tasks while it works', 'tasks cannot run under a lock', 'the condition variable needs it', 'to let main exit'], answer: 0, why: 'Holding the queue\'s lock while working would make the pool run one task at a time.' },
      { q: 'An idle worker finds the queue empty and not closed. It…', options: ['waits on c, which releases m while it sleeps', 'spins on head', 'quits', 'creates a task'], answer: 0, why: 'cwait sleeps and gives up the mutex so main can add a task.' },
      { q: 'Why does main broadcast after setting closed?', options: ['every sleeping worker must wake to see the queue is closed and quit', 'one signal is enough', 'to start new workers', 'to empty the queue'], answer: 0, why: 'A signal wakes one worker; the others would sleep for ever.' },
      { q: 'Compared with a thread per task, a pool…', options: ['makes threads once and bounds how many run at once', 'runs every task in parallel', 'needs no synchronisation', 'uses more memory'], answer: 0, why: 'Creation cost is paid once, and a flood of tasks cannot make a flood of threads.' },
    ],
  });

  // ---- fork-join in C --------------------------------------------------------------------------------------------
  const FJ = (data, k) => `int data[${data.length}] = {${data.join(', ')}};
long part[${k}];
void *sum(void *arg) {
    int id = (int)(long)arg;
    int lo = id * ${data.length} / ${k}, hi = (id + 1) * ${data.length} / ${k};
    long s = 0;
    for (int i = lo; i < hi; i++)
        s += data[i];
    part[id] = s;
    return NULL;
}
int main(void) {
    pthread_t t[${k}];
    for (long id = 0; id < ${k}; id++)
        pthread_create(&t[id], NULL, sum, (void *)id);
    long total = 0;
    for (int id = 0; id < ${k}; id++) {
        pthread_join(t[id], NULL);
        total += part[id];
    }
    printf("total = %ld\\n", total);
    return 0;
}`;
  H.topic({
    id: 'thr-forkjoin', family: 'p04-patterns', order: 20, title: 'Fork-join: split, work, join, combine',
    blurb: 'To add up a long array, split it into k slices and give each slice to a thread (the fork). Each thread sums its own slice into its own slot of part[], so no two threads write the same memory. main then joins each thread and adds the parts (the join). The slices run at the same time on separate cores.',
    inputs: [
      { id: 'k', kind: 'choice', label: 'Threads', def: '3', options: ['1', '2', '3', '4'].map((v) => ({ value: v, label: v })) },
      { id: 'data', kind: 'list', label: 'The array', def: ['4', '8', '15', '16', '23', '42', '7', '9', '1'], min: 2, max: 12, check: (v) => (v.some((x) => !/^-?\d+$/.test(x) || Math.abs(+x) > 999) ? 'The array: whole numbers up to 999' : null) },
    ],
    presets: [
      { label: 'Nine numbers, three threads', values: { k: '3', data: ['4', '8', '15', '16', '23', '42', '7', '9', '1'] } },
      { label: 'One thread: no split', values: { k: '1', data: ['4', '8', '15', '16', '23', '42', '7', '9', '1'] } },
      { label: 'Uneven: ten over four', values: { k: '4', data: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] } },
      { label: 'Two halves', values: { k: '2', data: ['12', '30', '5', '18', '7', '40'] } },
    ],
    counters: [{ id: 'alive', label: 'threads alive' }],
    run(inp) {
      const k = +inp.k, data = inp.data.map(Number), N = data.length, src = FJ(data, k), off = H.off();
      const R = H.kern(src, { sys: { policy: 'rr', quantum: 1 }, every: (evs) => evs.some((e) => e.kind === 'step') });
      const F = new S.Frames(['alive']);
      const slice = (id) => [Math.floor(id * N / k), Math.floor((id + 1) * N / k)];
      const owner = (i) => { for (let id = 0; id < k; id++) { const [lo, hi] = slice(id); if (i >= lo && i < hi) return id; } return 0; };
      const tidOf = {};
      let prev = '';
      function picture(cap, act) {
        const items = [], cw = Math.min(64, Math.floor(800 / N));
        items.push(H.title('at', 0, 14, 'data[], each slice coloured by its thread'));
        const at = {};
        for (const [tid, ls] of Object.entries(cap.locals)) { const i = ls.find((l) => l.name === 'i' && l.fn === 'sum'), id = ls.find((l) => l.name === 'id' && l.fn === 'sum'); if (i && id && i.value !== null) at[i.value] = { tid: +tid, id: id.value }; }
        data.forEach((v, i) => items.push({ key: 'd' + i, kind: 'cell', x: i * cw, y: 26, w: cw - 4, h: 40, rx: 5, text: String(v), size: 15, cls: 'thstk ' + H.pcls(owner(i)) + (at[i] ? ' act' : '') }));
        data.forEach((v, i) => items.push(H.text('di' + i, i * cw + (cw - 4) / 2, 84, String(i), 'tick', 12, 'middle')));
        const g = cap.globals[100] || {}, part = g.part ? g.part.value : [];
        items.push(H.title('pt', 0, 124, 'threads and their partial sums'));
        for (let id = 0; id < k; id++) {
          const tid = tidOf[id], t = tid ? cap.threads.find((q) => q.tid === tid) : null, ls = tid ? cap.locals[tid] || [] : [];
          const s = ls.find((l) => l.name === 's'), [lo, hi] = slice(id), x = id * 200;
          items.push(...K7().threads({ prefix: 'th' + id, x, y: 136, threads: [{ id, name: tid ? String(tid) : 'id ' + id, state: t ? t.state : 'new', act: tid === act }], w: 60, h: 32 }).items);
          items.push(H.text('rg' + id, x + 70, 150, 'slice ' + lo + '–' + (hi - 1), 'tick', 13));
          items.push(H.text('sv' + id, x + 70, 168, s && s.value !== null ? 's = ' + s.value : t && t.state === 'done' ? 'ended' : '', 'mono', 13));
          items.push({ key: 'pp' + id, kind: 'cell', x, y: 182, w: 180, h: 32, rx: 5, text: 'part[' + id + '] = ' + (part[id] === undefined || part[id] === null ? 0 : part[id]), size: 14, cls: 'varval own ' + H.pcls(id) });
        }
        const main = cap.locals[100] || [], tot = main.find((l) => l.name === 'total');
        items.push(H.title('mt', 0, 254, 'main joins and combines'));
        items.push({ key: 'tot', kind: 'cell', x: 0, y: 266, w: 200, h: 36, rx: 6, text: 'total = ' + (tot && tot.value !== null ? tot.value : '–'), size: 16, cls: 'varval' + (act === 100 ? ' act' : '') });
        items.push(...S.Kit.proc.term({ prefix: 'tm', x: 220, y: 254, w: 380, rows: H.term(cap), rowsShown: 1, title: 'terminal' }).items);
        return items;
      }
      R.steps.forEach((s, i) => {
        const cap = s.cap;
        for (const e of s.events) if (e.kind === 'thread') { const m = /creates thread `(\d+)`/.exec(e.say), a = /sum\((\d+)\)/.exec(e.say); if (m && a) tidOf[+a[1]] = +m[1]; }
        const sums = Object.entries(cap.locals).map(([t, ls]) => { const x = ls.find((l) => l.name === 's' || l.name === 'total'); return x ? x.value : null; });
        const g = cap.globals[100] || {}, key = JSON.stringify([sums, g.part && g.part.value]);
        const ev = s.events.filter((e) => e.kind !== 'step');
        if (i && !ev.length && key === prev) return;
        prev = key;
        F.set('alive', cap.threads.filter((t) => t.state !== 'done').length);
        let say;
        if (i === 0) say = `${N} numbers, ${H.plural(k, 'thread')}: thread id sums data[id·${N}/${k}] up to (but not including) data[(id + 1)·${N}/${k}], so the slices are ${Array.from({ length: k }, (_, id) => slice(id)).map(([lo, hi]) => lo + '–' + (hi - 1)).join(', ')}. The scheduler gives each ready thread one statement in turn, as if each had a core.`;
        else if (ev.length) say = ev.map((e) => e.say).join(' ');
        else {
          const t = cap.threads.find((q) => q.tid === s.choice), ls = cap.locals[s.choice] || [], sv = ls.find((l) => l.name === 's' || l.name === 'total');
          say = `${s.choice === 100 ? 'main' : 'Thread ' + s.choice} runs line ${t ? t.line - off : 0}${sv && sv.value !== null ? '; its ' + sv.name + ' is now `' + sv.value + '`' : ''}${g.part ? '; part[] is [' + g.part.value.join(', ') + ']' : ''}.`;
        }
        F.add({ items: picture(cap, s.choice), say, meta: { ev: (s.events || []).map((e) => e.say), vals: [N, k, ...data, ...Array.from({ length: k }, (_, id) => slice(id)).flat(), ...Array.from({ length: k }, (_, id) => slice(id)[1] - 1), ...sums.filter((x) => x !== null), ...(g.part ? g.part.value : []), ...cap.threads.flatMap((t) => [t.tid, t.line - off])] } });
      });
      const last = R.steps[R.steps.length - 1].cap, total = data.reduce((a, b) => a + b, 0), printed = +(/total = (-?\d+)/.exec(R.out) || [0, NaN])[1];
      const lens = Array.from({ length: k }, (_, id) => slice(id)[1] - slice(id)[0]);
      F.add({ items: picture(last, null), say: `main printed total = \`${printed}\`, the sum of all ${N} numbers. The slice sizes were ${H.list(lens)}: with a core per thread the sums take as long as the longest slice, ${H.plural(Math.max(...lens), 'addition')} instead of ${N}, plus the cost of creating and joining ${H.plural(k, 'thread')}.`, meta: { vals: [printed, N, total, k, ...lens, Math.max(...lens)], printed } });
      return { frames: F.list, def: H.def('Fork-join', ['fork     k threads, a slice each', 'work     each sums its slice', '         into its own part[id]', 'join     wait for each, any order', 'combine  total = sum of part[]', '', 'time ≈ create + longest slice', '       + join']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'What total will main print?', options: (fr, i, inp) => { const t = inp.data.map(Number).reduce((a, b) => a + b, 0); return [String(t - +inp.data[0]), String(t), String(t + +inp.data[inp.data.length - 1])]; }, answer: (fr) => String(fr[fr.length - 1].meta.printed), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Why does each thread write its own part[id] rather than adding straight into one total?', options: ['so no two threads write the same memory: no race and no lock needed', 'part[] is faster to print', 'threads cannot see globals', 'join needs an array'], answer: 0, why: 'One shared total would need a lock on every addition, or lose updates.' },
      { q: 'With 10 elements over 4 threads (slices of 2, 3, 2, 3), the parallel part takes about…', options: ['3 additions\' time', '10', '2.5', '4'], answer: 0, why: 'Everyone waits for the longest slice.' },
      { q: 'Does it matter in which order main joins the threads?', options: ['no: a thread that ended early keeps its result until joined', 'yes, it must join the fastest first', 'yes, it must join in reverse', 'join order changes the total'], answer: 0, why: 'Joining blocks only until that thread is done; the total is the same.' },
      { q: 'Why would 1000 threads for 1000 numbers be slower?', options: ['creating and joining a thread costs far more than one addition', 'threads cannot add', 'the array would be copied', 'it would deadlock'], answer: 0, why: 'Overheads must be paid back by enough work per thread.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
