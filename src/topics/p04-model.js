// Part 4, threads and the address space: the same small job done by threads and by forked processes, drawn as
// address spaces (one with a stack per thread, or one copy per process); and a table of what every thread sees at
// which address: the shared global and heap, each thread's own locals. All of it read from S.Kern runs.
(function (S) {
  'use strict';
  const H = S.P04, K7 = () => S.Kit.sync7, KP = () => S.Kit.proc;

  function progFor(how, k) {
    if (how === 'threads') return `int total = 0;
void *work(void *arg) {
    int id = (int)(long)arg;
    int mine = id * 10;
    total += mine;
    printf("worker %d: mine at %p\\n", id, (void *)&mine);
    return NULL;
}
int main(void) {
    pthread_t t[${k}];
    for (long i = 1; i <= ${k}; i++)
        pthread_create(&t[i - 1], NULL, work, (void *)i);
    for (int i = 0; i < ${k}; i++)
        pthread_join(t[i], NULL);
    printf("main: total = %d\\n", total);
    return 0;
}`;
    return `int total = 0;
void work(int id) {
    int mine = id * 10;
    total += mine;
    printf("worker %d: mine at %p\\n", id, (void *)&mine);
}
int main(void) {
    for (int i = 1; i <= ${k}; i++)
        if (fork() == 0) { work(i); exit(0); }
    for (int i = 0; i < ${k}; i++)
        wait(NULL);
    printf("main: total = %d\\n", total);
    return 0;
}`;
  }

  /** an address space as a column of bands, highest addresses on top */
  function space(prefix, x, y, w, bands, o) {
    const items = [], lh = 30;
    o = o || {};
    if (o.title) items.push({ key: prefix + ':t', kind: 'text', x: x + w / 2, y: y - 10, text: o.title, anchor: 'middle', size: 15, cls: o.titleCls || 'strong' });
    let yy = y;
    for (const b of bands) {
      const h = b.h || 44 + (b.rows || []).length * lh;
      items.push({ key: prefix + ':b' + b.id, kind: 'region', x, y: yy, w, h, rx: 6, cls: b.cls || 'memband', audit: 'group', layer: 'back' });
      items.push({ key: prefix + ':n' + b.id, kind: 'text', x: x + 10, y: yy + 19, text: b.name, size: 14, cls: b.nameCls || 'strong' });
      if (b.range) items.push({ key: prefix + ':r' + b.id, kind: 'text', x: x + w - 10, y: yy + 19, text: b.range, size: 12, anchor: 'end', cls: 'tick mono' });
      (b.rows || []).forEach((r, i) => items.push({ key: prefix + ':v' + b.id + '_' + (r.key || i), kind: 'cell', x: x + (r.indent || 10), y: yy + 30 + i * lh, w: w - (r.indent || 10) - 10, h: lh - 4, rx: 5, text: r.text, size: 13, cls: r.cls || 'varval', align: 'left' }));
      yy += h + 6;
    }
    return { items, h: yy - y };
  }

  H.topic({
    id: 'thr-space', family: 'p04-model', order: 10, title: 'Threads against processes',
    blurb: 'Give the same job to workers made by pthread_create and to workers made by fork. Threads live in one address space: one copy of the globals and the code, and a stack of its own for each thread. fork gives every worker a whole copy, so what a child writes, the parent never sees.',
    inputs: [
      { id: 'how', kind: 'choice', label: 'Workers made by', def: 'threads', options: [{ value: 'threads', label: 'pthread_create' }, { value: 'fork', label: 'fork' }] },
      { id: 'k', kind: 'choice', label: 'Workers', def: '2', options: ['1', '2', '3'].map((v) => ({ value: v, label: v })) },
    ],
    presets: [
      { label: 'Two threads', values: { how: 'threads', k: '2' } },
      { label: 'Two forked children', values: { how: 'fork', k: '2' } },
      { label: 'Three threads', values: { how: 'threads', k: '3' } },
      { label: 'Three children', values: { how: 'fork', k: '3' } },
    ],
    counters: [{ id: 'spaces', label: 'address spaces' }, { id: 'stacks', label: 'stacks' }],
    run(inp) {
      const k = +inp.k, thr = inp.how === 'threads', src = progFor(inp.how, k);
      const R = H.kern(src), prog = R.prog, off = H.off();
      const F = new S.Frames(['spaces', 'stacks']);
      const mainPid = 100, sum = (k * (k + 1) / 2) * 10;
      const totalAddr = prog.globals.get('total').addr;
      const pids = [], tids = [], lastTot = {}, lastMine = {};
      function picture(cap, act) {
        const items = [];
        for (const p of cap.procs) if (!pids.includes(p.pid)) pids.push(p.pid);
        for (const t of cap.threads) if (!tids.includes(t.tid)) tids.push(t.tid);
        const mine = (tid) => (cap.locals[tid] || []).find((l) => l.name === 'mine');
        const procOf = (pid) => cap.procs.find((p) => p.pid === pid);
        if (thr) {
          const ths = cap.threads.filter((t) => t.pid === mainPid);
          const main = ths.find((t) => t.main);
          const g = cap.globals[mainPid] || {};
          const stacks = ths.filter((t) => !t.main).map((t) => {
            const m = (cap.locals[t.tid] || []).find((l) => l.name === 'mine');
            return { key: 's' + t.tid, text: 'stack of ' + t.tid + (m ? ': mine = ' + m.value + ' at ' + H.hex(m.addr) : t.state === 'done' ? ': ended' : ''), cls: 'thstk ' + H.pcls(tids.indexOf(t.tid)) + (t.tid === act ? ' act' : '') + (t.state === 'done' ? ' gone' : ''), indent: 16 };
          });
          const bands = [
            { id: 'st', name: 'main\'s stack', range: main ? H.hex(main.lo) + '–' + H.hex(main.hi) : '', rows: [{ key: 'm', text: 'thread ' + mainPid + (main && main.state === 'done' ? ' (ended)' : '') + ': main\'s frame', cls: 'thstk ' + H.pcls(0) + (act === mainPid ? ' act' : '') }], cls: 'stackband' },
            { id: 'hp', name: 'heap', range: H.hex(prog.heapBase) + '–' + H.hex(prog.heapEnd), rows: stacks.length ? stacks : [{ key: 'none', text: 'no thread stacks yet', cls: 'varval qn' }], cls: 'memband' },
            { id: 'dt', name: 'globals', range: H.hex(prog.dataBase) + '–' + H.hex(prog.dataEnd), rows: [{ key: 'tot', text: 'total = ' + (g.total ? g.total.value : 0) + ' at ' + H.hex(totalAddr), cls: 'varval' + (cap.__wrote ? ' act' : '') }], cls: 'memband' },
            { id: 'cd', name: 'code: main, work, printf', rows: [], h: 34, cls: 'memband' },
          ];
          items.push(...space('as', 0, 30, 380, bands, { title: 'process ' + mainPid + ': one address space' }).items);
          items.push(...K7().threads({ prefix: 'tc', x: 410, y: 20, threads: ths.map((t) => ({ id: t.tid, name: String(t.tid), state: t.state === 'running' ? 'running' : t.state, act: t.tid === act, sub: t.main ? 'main' : 'worker' })), w: 74, h: 34, gap: 10, perRow: 4 }).items);
        } else {
          const n = pids.length, w = Math.min(250, Math.floor((800 - (n - 1) * 12) / n));
          pids.forEach((pid, i) => {
            const p = procOf(pid), t = cap.threads.find((q) => q.pid === pid);
            const g = cap.globals[pid] || {}, m = t && mine(t.tid), gone = !p || p.state === 'zombie' || p.state === 'reaped';
            if (!gone && g.total) lastTot[pid] = g.total.value;
            if (!gone && m && m.name === 'mine') lastMine[pid] = m;
            const lm = lastMine[pid];
            const rows = [{ key: 'tot', text: 'total = ' + (lastTot[pid] === undefined ? 0 : lastTot[pid]) + (gone ? ' (last)' : ''), cls: 'varval' + (t && t.tid === act ? ' act' : '') + (gone ? ' qn' : '') }];
            const bands = [
              { id: 'st', name: 'stack', rows: [{ key: 'm', text: lm ? 'mine = ' + lm.value + ' at ' + H.hex(lm.addr) : pid === mainPid ? 'main\'s frame' : 'work\'s frame', cls: 'thstk ' + H.pcls(i) + (gone ? ' gone' : '') }], cls: 'stackband' },
              { id: 'dt', name: 'globals', rows, cls: 'memband' },
            ];
            items.push(...space('as' + pid, i * (w + 12), 30, w, bands, { title: (pid === mainPid ? 'parent ' : 'child ') + pid + (gone ? (p && p.state === 'zombie' ? ' (zombie)' : ' (gone)') : ''), titleCls: gone ? 'tick' : 'strong' }).items);
          });
        }
        const rows = H.term(cap);
        const ty = thr ? 140 : 220;
        items.push(...KP().term({ prefix: 'tm', x: thr ? 410 : 0, y: ty, w: thr ? 400 : 560, rows, rowsShown: k + 2, title: 'terminal' }).items);
        return items;
      }
      const spaces = (cap) => (thr ? 1 : cap.procs.filter((p) => p.state !== 'zombie' && p.state !== 'reaped').length);
      const stacks = (cap) => cap.threads.filter((t) => t.state !== 'done').length;
      let totalSeen = 0;
      R.steps.forEach((s, i) => {
        const cap = s.cap;
        const g = cap.globals[s.choice && cap.threads.find((t) => t.tid === s.choice) ? cap.threads.find((t) => t.tid === s.choice).pid : mainPid];
        F.set('spaces', spaces(cap)).set('stacks', stacks(cap));
        const vals = [k, sum, 10, totalAddr, prog.heapBase, ...cap.threads.flatMap((t) => [t.tid, t.pid, t.line - off, t.line, t.lo, t.hi]), ...Object.values(cap.globals).map((x) => x.total && x.total.value), ...Object.values(cap.locals).flat().flatMap((l) => [l.value, l.addr])];
        let say;
        if (i === 0) say = thr ? `Process ${mainPid} will start ${H.plural(k, 'worker thread')}. Each adds id × 10 to the global total, so if they all write to the same total it ends at \`${sum}\`. One address space holds main's stack, the heap, the globals and the code.` : `Process ${mainPid} will fork ${H.plural(k, 'child', 'children')}. Each child adds id × 10 to total, as the threads would; the parent then prints its own total.`;
        else say = s.events.map((e) => e.say).join(' ');
        const tot = g && g.total ? g.total.value : null;
        if (tot !== null && tot !== totalSeen && s.events.some((e) => e.kind === 'print') && /worker/.test(s.events.map((e) => e.say).join(' '))) totalSeen = tot;
        if (s.events.some((e) => e.kind === 'thread') && thr) {
          const nt = cap.threads[cap.threads.length - 1];
          say += ` Its stack is a block of the heap from ${H.hex(nt.lo)} to ${H.hex(nt.hi)}.`;
        }
        if (s.events.some((e) => e.kind === 'fork')) say += ' The child gets its own copy of every page: its own total, its own stack.';
        F.add({ items: picture(cap, s.choice), say, meta: { ev: (s.events || []).map((e) => e.say), vals: vals.filter((v) => typeof v === 'number'), main: cap.globals[mainPid] && cap.globals[mainPid].total ? cap.globals[mainPid].total.value : null } });
      });
      const last = R.steps[R.steps.length - 1].cap, final = +(/total = (\d+)/.exec(R.out) || [0, 0])[1];
      F.add({ items: picture(last, null), say: thr ? `main prints total = \`${final}\`: every worker wrote to the one total in the one address space, so all ${k} additions are there (${H.list(Array.from({ length: k }, (_, i) => (i + 1) * 10))}). Each worker's mine lived at a different address, on its own stack.` : `The parent prints total = \`${final}\`: each child added to the total in its own copy of memory, and that copy vanished when it exited.${Object.keys(lastMine).length > 1 && new Set(Object.values(lastMine).map((m) => m.addr)).size === 1 ? ' Note that every child\'s mine had the same address, ' + H.hex(Object.values(lastMine)[0].addr) + ': the same virtual address in different address spaces names different memory.' : ''} To share results, processes need a pipe, shared memory or a file; threads just share.`, meta: { vals: [final, k, sum, ...Array.from({ length: k }, (_, i) => (i + 1) * 10), ...Object.values(lastMine).map((m) => m.addr), ...Object.values(lastTot)], final } });
      return { frames: F.list, def: H.def('One process, several threads', ['shared by every thread:', '  code, globals, heap, open files', 'each thread\'s own:', '  stack, registers, program counter', 'fork: the child gets a copy of it all', '  (copy-on-write), then they part']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'What total will main print at the end?', options: (fr, i, inp) => { const k = +inp.k, s = k * (k + 1) * 5; return [...new Set(['0', '10', String(s)])]; }, answer: (fr) => String(fr[fr.length - 1].meta.final), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Two threads of one process each declare a local int x. How many x exist?', options: ['two, one on each thread\'s stack', 'one, shared', 'none until joined', 'one per core'], answer: 0, why: 'Locals live on the stack, and every thread has its own stack.' },
      { q: 'A child process made by fork changes a global. The parent then reads it and sees…', options: ['its own old value', 'the child\'s new value', 'zero', 'a crash'], answer: 0, why: 'After fork each process has its own copy of memory.' },
      { q: 'Where does a thread made by pthread_create get its stack here?', options: ['a block of the process\'s memory, set aside for it', 'a new process', 'the main thread\'s stack', 'the kernel\'s stack'], answer: 0, why: 'The stack is memory in the same address space, so other threads could even reach it by pointer.' },
      { q: 'Which is cheaper to create and to switch between?', options: ['threads of one process', 'processes', 'they cost the same', 'neither can be switched'], answer: 0, why: 'No new address space is built and no page tables change on a switch between threads of one process.' },
      { q: 'What do threads of one process NOT share?', options: ['registers and stack', 'globals', 'the heap', 'open files'], answer: 0, why: 'Each thread has its own registers, program counter and stack.' },
    ],
  });

  // ---- what each thread sees where -------------------------------------------------------------------------------
  const SHARE = (k) => `int shared = 0;
int *box;
void *work(void *arg) {
    int id = (int)(long)arg;
    int local = id * 100;
    shared = shared + 1;
    box[id] = local + shared;
    return NULL;
}
int main(void) {
    pthread_t t[${k}];
    box = malloc(${k + 1} * sizeof(int));
    for (long i = 1; i <= ${k}; i++)
        pthread_create(&t[i - 1], NULL, work, (void *)i);
    for (int i = 0; i < ${k}; i++)
        pthread_join(t[i], NULL);
    printf("shared = %d\\n", shared);
    return 0;
}`;
  H.topic({
    id: 'thr-share', family: 'p04-model', order: 20, title: 'What threads share, and what each keeps',
    blurb: 'A table of every name each thread can use, with the address it reaches. Where a column of addresses is all the same, the threads share one object: the global, the heap block. Where every thread has its own address, each has its own copy: the locals on its own stack.',
    inputs: [
      { id: 'k', kind: 'choice', label: 'Worker threads', def: '2', options: ['2', '3'].map((v) => ({ value: v, label: v })) },
      { id: 'policy', kind: 'choice', label: 'Scheduler', def: 'rr', options: [{ value: 'rr', label: 'round robin, one statement each' }, { value: 'fifo', label: 'run each until it blocks' }] },
    ],
    presets: [{ label: 'Two workers, interleaved', values: { k: '2', policy: 'rr' } }, { label: 'Three workers, interleaved', values: { k: '3', policy: 'rr' } }, { label: 'Two, one after the other', values: { k: '2', policy: 'fifo' } }],
    counters: [{ id: 'alive', label: 'threads alive' }],
    run(inp) {
      const k = +inp.k, R = H.kern(SHARE(k), { sys: { policy: inp.policy, quantum: 1 }, every: (evs) => evs.some((e) => e.kind === 'step') });
      const F = new S.Frames(['alive']), prog = R.prog, sAddr = prog.globals.get('shared').addr, bAddr = prog.globals.get('box').addr;
      const seen = {}; // tid -> {local: {addr, value}, id}
      const cols = [100];
      let boxAt = null;
      function picture(cap, act) {
        const items = [], cw = 150, x0 = 140, rh = 34;
        cols.forEach((tid, j) => items.push({ key: 'h' + tid, kind: 'cell', x: x0 + j * (cw + 6), y: 0, w: cw, h: 32, rx: 6, text: tid === 100 ? 'main 100' : 'thread ' + tid, size: 14, cls: 'thcard ' + K7().stateCls((cap.threads.find((t) => t.tid === tid) || { state: 'done' }).state) + (tid === act ? ' act' : '') }));
        const rows = [['shared', 'global'], ['box', 'global'], ['box[id]', 'heap'], ['local', 'stack'], ['id', 'stack']];
        rows.forEach(([nm, where], r) => {
          const y = 44 + r * (rh + 8);
          items.push({ key: 'rn' + r, kind: 'text', x: 0, y: y + 21, text: nm, size: 15, cls: 'mono' });
          items.push({ key: 'rw' + r, kind: 'text', x: 74, y: y + 21, text: where, size: 13, cls: 'tick' });
          cols.forEach((tid, j) => {
            let text = '', cls = 'varval';
            const sv = seen[tid] || {};
            if (nm === 'shared') { text = H.hex(sAddr); cls += ' shared'; }
            else if (nm === 'box') { text = H.hex(bAddr); cls += ' shared'; }
            else if (nm === 'box[id]') { if (tid !== 100 && boxAt !== null && sv.id) { text = H.hex(boxAt + 4 * sv.id); cls += ' heapown'; } }
            else if (nm === 'local' && sv.local) { text = H.hex(sv.local.addr); cls += ' own ' + H.pcls(j); }
            else if (nm === 'id' && sv.idv) { text = H.hex(sv.idv.addr); cls += ' own ' + H.pcls(j); }
            if (tid === 100 && (nm === 'local' || nm === 'id' || nm === 'box[id]')) { text = 'none'; cls = 'varval qn'; }
            items.push({ key: 'c' + r + '_' + tid, kind: 'cell', x: x0 + j * (cw + 6), y, w: cw, h: rh, rx: 5, text, size: 14, cls: cls + (text ? '' : ' empty') });
          });
        });
        const g = cap.globals[100] || {}, vy = 44 + 5 * (rh + 8) + 14;
        items.push(H.title('vt', 0, vy, 'values now'));
        const vals = ['shared = ' + (g.shared ? g.shared.value : 0)];
        if (boxAt !== null) { vals.push('box = ' + H.hex(boxAt)); }
        cols.filter((t) => t !== 100).forEach((tid) => { const sv = seen[tid]; if (sv && sv.local) vals.push(tid + ': local = ' + sv.local.value); });
        vals.forEach((v, i) => items.push(H.text('vv' + i, (i % 3) * 220, vy + 24 + Math.floor(i / 3) * 24, v, 'mono', 14)));
        items.push(...S.Kit.sync.legend({ prefix: 'lg', x: 0, y: vy + 64, entries: [{ cls: 'shared', text: 'one object, the same address for all' }, { cls: 'own', text: 'a copy of its own' }], gap: 26 }).items);
        return items;
      }
      let prevAlive = -1, prevShared = -1;
      R.steps.forEach((s, i) => {
        const cap = s.cap;
        for (const t of cap.threads) if (!cols.includes(t.tid)) cols.push(t.tid);
        for (const [tid, ls] of Object.entries(cap.locals)) {
          const sv = (seen[tid] = seen[tid] || {});
          for (const l of ls) { if (l.name === 'local' && l.fn === 'work') sv.local = l; if (l.name === 'id' && l.fn === 'work') { sv.idv = l; sv.id = l.value; } }
        }
        const g = cap.globals[100] || {};
        if (g.box && g.box.value) boxAt = g.box.value;
        const alive = cap.threads.filter((t) => t.state !== 'done').length, sh = g.shared ? g.shared.value : 0;
        const interesting = s.events.some((e) => e.kind !== 'step') || i === 0 || sh !== prevShared || alive !== prevAlive || (s.choice && seen[s.choice] && seen[s.choice].local && !seen[s.choice].told);
        if (!interesting) return;
        let say;
        if (i === 0) say = `main starts ${H.plural(k, 'worker')}. Every worker uses the same names: the global shared, the heap block box, its own id and local. Fill the table and compare addresses.`;
        else {
          const ev = s.events.filter((e) => e.kind !== 'step').map((e) => e.say);
          const sv = s.choice && seen[s.choice];
          if (sv && sv.local && !sv.told) { sv.told = true; ev.push(`Thread ${s.choice}'s local is at ${H.hex(sv.local.addr)}, on its own stack, holding \`${sv.local.value}\`.`); }
          if (sh !== prevShared && prevShared >= 0) ev.push(`shared, at ${H.hex(sAddr)} for every thread, is now \`${sh}\`.`);
          say = ev.join(' ') || `Thread ${s.choice} runs line ${(cap.threads.find((t) => t.tid === s.choice) || { line: 0 }).line - H.off()}.`;
        }
        prevAlive = alive; prevShared = sh;
        F.set('alive', alive);
        const vals = [k, sAddr, bAddr, boxAt || 0, sh, ...cap.threads.flatMap((t) => [t.tid, t.line - H.off()]), ...Object.values(seen).flatMap((v) => [v.local && v.local.addr, v.local && v.local.value, v.id])];
        F.add({ items: picture(cap, s.choice), say, meta: { ev: (s.events || []).map((e) => e.say), vals: vals.filter((v) => typeof v === 'number'), locals: Object.fromEntries(Object.entries(seen).map(([t, v]) => [t, v.local ? v.local.addr : null])), sAddr } });
      });
      const last = R.steps[R.steps.length - 1].cap, addrs = Object.values(seen).filter((v) => v.local).map((v) => v.local.addr);
      F.add({ items: picture(last, null), say: `Every thread reached shared at the one address ${H.hex(sAddr)}, and the heap block at ${H.hex(boxAt || 0)}, but each local had an address of its own: ${H.list(addrs.map(H.hex))}. main prints shared = \`${+(/= (\d+)/.exec(R.out) || [0, 0])[1]}\`.`, meta: { vals: [sAddr, boxAt || 0, ...addrs, +(/= (\d+)/.exec(R.out) || [0, 0])[1]], addrs } });
      return { frames: F.list, def: H.def('Who sees what', ['global int shared   one copy, data segment', 'malloc\'d block     one copy, heap', 'local variables     one per thread, its stack', 'registers, pc       one set per thread', '', 'a pointer to a local can be passed on:', 'the stack is shared memory too, just', 'not shared by name']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Will two workers\' local variables have the same address?', options: ['yes, the same address', 'no, different addresses'], answer: (fr) => (new Set(fr[fr.length - 1].meta.addrs).size === fr[fr.length - 1].meta.addrs.length ? 'no, different addresses' : 'yes, the same address'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Thread A passes &x (x a local of A) to thread B. Can B read x?', options: ['yes, it is memory in the same address space', 'no, stacks are invisible to other threads', 'only after A exits', 'only with a mutex'], answer: 0, why: 'Stacks are private by convention, not protection: the address works for every thread while A\'s frame lives.' },
      { q: 'Which of these is one object for all threads?', options: ['a global variable', 'a local variable', 'the program counter', 'the stack pointer'], answer: 0, why: 'Globals sit in the data segment, once per process.' },
      { q: 'A thread mallocs a block and returns its pointer. After the thread ends, the block…', options: ['still exists until someone frees it', 'is freed with the thread\'s stack', 'moves to another thread', 'becomes read-only'], answer: 0, why: 'The heap belongs to the process, not to the thread.' },
      { q: 'Why does shared need care when two threads update it?', options: ['both write the same memory, so updates can collide', 'it lives on a stack', 'globals are read-only', 'it is copied per thread'], answer: 0, why: 'A shared object is where races happen: see part 7.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
