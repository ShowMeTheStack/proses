// Part 13, blocking, non-blocking and asynchronous I/O: process A reads from a device while process B computes,
// drawn as lanes for A, B, the CPU and the device with A's program beside them; then the three modes side by
// side. Every time comes from the I/O-mode model (S.IO.mode and S.IO.modes, src/core/io-b-modes.js).
(function (S) {
  'use strict';
  const R = Math.round;
  const NAMES = { blocking: 'blocking', nonblocking: 'non-blocking', async: 'asynchronous' };
  const PROG = {
    blocking: ['n = read(fd, buf, N);      /* sleeps until the data is in */', 'work();                    /* needs no data */', 'use(buf, n);', 'exit(0);'],
    nonblocking: ['fcntl(fd, F_SETFL, O_NONBLOCK);', 'while ((n = read(fd, buf, N)) < 0 && errno == EAGAIN)', '    work_a_little();       /* a slice of the work */', 'use(buf, n);', 'exit(0);'],
    async: ['aio_read(&cb);             /* starts the read, returns at once */', 'work();', 'aio_suspend(list, 1, NULL); /* waits only if not yet done */', 'use(buf, n);               /* after the completion handler */', 'exit(0);'],
  };
  const LINE = {
    blocking: { syscall: 1, interrupt: 1, 'done-A': 4 },
    nonblocking: { syscall: 2, eagain: 2, interrupt: 3, copy: 4, 'done-A': 5 },
    async: { syscall: 1, suspend: 3, interrupt: 4, 'done-A': 5 },
  };
  const IN = [
    { id: 'device', kind: 'number', label: 'device µs', def: 30, min: 1, max: 1000 },
    { id: 'work', kind: 'number', label: 'A’s other work µs', def: 20, min: 0, max: 1000 },
    { id: 'use', kind: 'number', label: 'A uses the data µs', def: 10, min: 0, max: 1000 },
    { id: 'other', kind: 'number', label: 'B computes µs', def: 40, min: 0, max: 2000 },
    { id: 'syscall', kind: 'number', label: 'system call µs', def: 2, min: 0.5, max: 50, integer: false },
    { id: 'copy', kind: 'number', label: 'copy µs', def: 3, min: 0.5, max: 50, integer: false },
    { id: 'slice', kind: 'number', label: 'work between retries µs', def: 5, min: 1, max: 100 },
  ];
  const PRE = [
    { label: 'The standard case', values: { device: 30, work: 20, use: 10, other: 40, syscall: 2, copy: 3, slice: 5 } },
    { label: 'A slow device', values: { device: 90, work: 20, use: 10, other: 40, syscall: 2, copy: 3, slice: 5 } },
    { label: 'More work than waiting', values: { device: 15, work: 50, use: 10, other: 40, syscall: 2, copy: 3, slice: 5 } },
    { label: 'Nobody else to run', values: { device: 40, work: 20, use: 10, other: 0, syscall: 2, copy: 3, slice: 5 } },
  ];
  const ACLS = { user: 'ps-user', kernel: 'ps-kernel', blocked: 'ps-blocked', ready: 'ps-ready', done: 'ps-idle' };
  const CCLS = { A: 'ps-user', B: 'ps-B', irq: 'io-irq', idle: 'ps-idle' };
  const params = (inp) => { const o = {}; for (const i of IN) o[i.id] = inp[i.id]; return o; };

  /** the lanes for one mode's run, cut at now */
  function lanes(prefix, res, x, y, w, t1, now, rows) {
    const t = S.T12;
    const R0 = {
      A: { id: 'A', label: 'A', segs: res.lanes.A.map((s) => ({ from: s.from, to: s.to, cls: ACLS[s.state], text: s.label || (s.state === 'blocked' ? 'blocked' : '') })) },
      B: { id: 'B', label: 'B', segs: res.lanes.B.map((s) => ({ from: s.from, to: s.to, cls: s.state === 'user' ? 'ps-B' : ACLS[s.state], text: s.label })) },
      cpu: { id: 'cpu', label: 'CPU', segs: res.lanes.cpu.map((s) => ({ from: s.from, to: s.to, cls: CCLS[s.who], text: s.who === 'idle' ? 'idle' : s.who === 'irq' ? 'irq' : s.who })) },
      device: { id: 'dev', label: 'device', segs: res.lanes.device.map((s) => ({ from: s.from, to: s.to, cls: 'io-busy', text: 'busy' })) },
    };
    return t.lanes({ prefix, x, y, w, labelW: 70, t1, rows: rows.map((r) => R0[r]), rowH: 30, gap: 10, size: 14, upTo: now, now: isFinite(now) && now > 0 ? now : undefined, unit: 'µs' });
  }
  S.T13.modeLanes = lanes;
  const LEG = [{ cls: 'tl ps-user', text: 'A in user mode' }, { cls: 'tl ps-kernel', text: 'A in the kernel' }, { cls: 'tl ps-blocked', text: 'blocked' }, { cls: 'tl ps-ready', text: 'ready, waiting for the CPU' }, { cls: 'tl ps-B', text: 'B computing' }, { cls: 'tl io-irq', text: 'interrupt' }, { cls: 'tl io-busy', text: 'device busy' }];

  /** who held the CPU longest while the device worked */
  function waitHolder(res) {
    const d = res.lanes.device[0], by = { A: 0, B: 0, idle: 0, irq: 0 };
    for (const s of res.lanes.cpu) by[s.who] += Math.max(0, Math.min(s.to, d.to) - Math.max(s.from, d.from));
    return ['A', 'B', 'idle'].sort((x, y) => by[y] - by[x])[0];
  }

  S.topic({
    id: 'io-modes', family: 'p13-modes', order: 10, title: 'Blocking, non-blocking and asynchronous reads',
    blurb: 'Process A reads from a device that takes a while; process B has computing to do. A blocking read puts A to sleep until the data is in. A non-blocking read returns at once with EAGAIN, and A must try again. An asynchronous read starts the transfer and lets A carry on until it is told the data has arrived.',
    inputs: [{ id: 'mode', kind: 'choice', label: 'the read', def: 'blocking', options: Object.keys(NAMES).map((k) => ({ value: k, label: NAMES[k] })) }].concat(IN),
    presets: [
      { label: 'Blocking', values: Object.assign({ mode: 'blocking' }, PRE[0].values) },
      { label: 'Non-blocking, retrying', values: Object.assign({ mode: 'nonblocking' }, PRE[0].values) },
      { label: 'Asynchronous', values: Object.assign({ mode: 'async' }, PRE[0].values) },
      { label: 'Non-blocking with nothing else to do', values: Object.assign({ mode: 'nonblocking' }, PRE[3].values) },
      { label: 'Asynchronous, a slow device', values: Object.assign({ mode: 'async' }, PRE[1].values) },
    ],
    counters: [{ id: 'calls', label: 'A’s system calls' }],
    run(inp) {
      const t = S.T12, a = Object.assign({}, S.IO.modeDefaults, params(inp)), res = S.IO.mode(inp.mode, a), F = new S.Frames(['calls']);
      const t1 = res.end, prog = PROG[inp.mode];
      const base = { a, mode: inp.mode, finishA: res.finishA, finishB: res.finishB, end: res.end, cpu: res.cpu, syscalls: res.syscalls, retries: res.retries, holder: waitHolder(res) };
      const callsBy = (now) => res.lanes.A.filter((s) => s.state === 'kernel' && /\(\)/.test(s.label || '') && s.to <= now + 1e-9).length;
      const pic = (now, line) => {
        const L = lanes('im', res, 0, 20, 800, t1, now, ['A', 'B', 'cpu', 'device']);
        const lg = t.legend('img', 70, 20 + L.h + 8, LEG, 730, 13);
        const code = S.Kit.proc.code({ prefix: 'imc', x: 0, y: 20 + L.h + lg.h + 30, w: 800, src: prog, lineH: 24, size: 13, title: 'process A, ' + NAMES[inp.mode], act: line });
        return [...L.items, ...lg.items, ...code.items];
      };
      F.add({ items: pic(0, 0), title: 'two processes', say: `A will read data that takes the device ${a.device} µs; it has ${a.work} µs of work that needs no data and ${a.use} µs that does. ${a.other ? `B has ${a.other} µs of computing and runs whenever A cannot; A has the higher priority.` : 'No other process is waiting to run.'}`, meta: Object.assign({ phase: 'start' }, base) });
      let line = 0, eag = 0;
      res.steps.forEach((s) => {
        if (s.kind === 'summary') return;
        if (s.kind === 'eagain') eag++;
        if (LINE[inp.mode][s.kind]) line = LINE[inp.mode][s.kind];
        F.set('calls', callsBy(s.t));
        F.add({ items: pic(s.t, line), title: s.kind, say: s.say, meta: Object.assign({ phase: s.kind, at: s.t, k: eag, other: a.other }, base) });
      });
      F.set('calls', res.syscalls);
      const sm = res.steps[res.steps.length - 1];
      F.add({ items: pic(t1, 0), title: 'totals', say: sm.say, meta: Object.assign({ phase: 'done' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Three ways to read', text: ['blocking      read() sleeps; the CPU goes to others', 'non-blocking  read() returns EAGAIN at once;', '              the program must try again', 'asynchronous  aio_read() returns at once;', '              completion is signalled later', 'select / poll / epoll: wait on many at once'].join('\n') }, { id: 't', kind: 'text', text: 'The three side by side: [[io-modes-compare]].' }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'syscall', pick: 'option', ask: 'While the device works, who will use most of the CPU?', options: ['A', 'B', 'nobody: the CPU idles'], answer: (fr) => ({ A: 'A', B: 'B', idle: 'nobody: the CPU idles' })[fr[0].meta.holder], explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => i === fr.length - 3, once: true, pick: 'option', ask: 'Which process finishes first?', options: ['A', 'B'], answer: (fr) => { const m = fr[0].meta; return m.a.other === 0 ? null : m.finishA <= m.finishB ? 'A' : 'B'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A non-blocking read finds no data. It returns…', options: ['-1 with errno EAGAIN', '0, end of file', 'after the data arrives', 'a signal'], answer: 0, why: 'EAGAIN says: nothing yet, try again later.' },
      { q: 'What is the danger of retrying a non-blocking read in a tight loop?', options: ['busy waiting: the CPU is burnt on fruitless calls', 'data loss', 'a deadlock', 'none'], answer: 0, why: 'Every retry is a system call that achieves nothing until the data is in.' },
      { q: 'With a blocking read, what does the CPU do while A waits?', options: ['runs another ready process', 'polls the device for A', 'stops', 'copies A’s data'], answer: 0, why: 'A is blocked, so the scheduler gives the CPU to someone else.' },
      { q: 'How does an asynchronous read report that it is done?', options: ['a notification: a signal, a callback or a completion queue', 'by returning EAGAIN', 'it never does', 'by blocking'], answer: 0, why: 'The call returned long before; completion has to be announced separately.' },
    ],
  });

  // =================================================================================================================
  S.topic({
    id: 'io-modes-compare', family: 'p13-modes', order: 20, title: 'Three reads side by side',
    blurb: 'The same two processes under a blocking, a non-blocking and an asynchronous read. When does A finish, when does B, how many system calls does A make, and how much of the CPU is wasted?',
    inputs: IN, presets: PRE,
    counters: [{ id: 'shown', label: 'modes shown' }],
    run(inp) {
      const t = S.T12, a = Object.assign({}, S.IO.modeDefaults, params(inp)), all = S.IO.modes(a), F = new S.Frames(['shown']);
      const K = ['blocking', 'nonblocking', 'async'], t1 = Math.max(...K.map((k) => all[k].end));
      const sum = {}; for (const k of K) sum[k] = { finishA: all[k].finishA, finishB: all[k].finishB, cpuA: all[k].cpu.A, idle: all[k].cpu.idle, syscalls: all[k].syscalls, retries: all[k].retries, end: all[k].end };
      const base = { a, sum };
      const pic = (n, lit) => {
        const items = [];
        K.forEach((k, i) => {
          const y = i * 182;
          items.push(t.text('mc:h' + i, 0, y + 16, NAMES[k] + (i < n ? `: A done at ${sum[k].finishA} µs, B at ${sum[k].finishB} µs` : ''), 'strong' + (lit === k ? ' act-t' : ''), 14));
          const L = lanes('mc' + i, all[k], 0, y + 30, 800, t1, i < n ? Infinity : 0, ['A', 'B', 'cpu']);
          items.push(...L.items);
        });
        items.push(...t.legend('mcg', 70, 3 * 182 + 4, LEG.slice(0, 6), 730, 13).items);
        return items;
      };
      F.add({ items: pic(0), title: 'three runs', say: `The same pair each time: A reads from a device that takes ${a.device} µs and has ${a.work} µs of work and ${a.use} µs that needs the data; B computes for ${a.other} µs.`, meta: Object.assign({ phase: 'start' }, base) });
      K.forEach((k, i) => {
        F.set('shown', i + 1);
        const m = sum[k];
        const say = k === 'blocking' ? `Blocking: A makes ${t.plural(m.syscalls, 'system call')} and sleeps through the device’s ${a.device} µs, so A is done at ${m.finishA} µs and B at ${m.finishB} µs.`
          : k === 'nonblocking' ? `Non-blocking: A makes ${m.syscalls} system calls, ${m.retries} of them fruitless retries, and is done at ${m.finishA} µs; it used ${m.cpuA} µs of CPU, B finishes at ${m.finishB} µs.`
          : `Asynchronous: A makes ${t.plural(m.syscalls, 'system call')}, works while the device does, and is done at ${m.finishA} µs; B at ${m.finishB} µs.`;
        F.add({ items: pic(i + 1, k), title: NAMES[k], say, meta: Object.assign({ phase: k }, base) });
      });
      const ties = (f) => { const best = Math.min(...K.map(f)); return K.filter((k) => f(k) === best); };
      const names = (ks) => 'the ' + t.list(ks.map((k) => NAMES[k])) + ' read' + (ks.length > 1 ? 's' : '');
      const fa = ties((k) => sum[k].finishA), fe = ties((k) => sum[k].end), mc = ties((k) => -sum[k].syscalls);
      F.add({ items: pic(3, fa[0]), title: 'compared', say: `Process A is done soonest with ${names(fa)}, at ${sum[fa[0]].finishA} µs. ${t.cap(names(mc))} cost${mc.length > 1 ? '' : 's'} the most system calls, ${sum[mc[0]].syscalls}. Both processes are done soonest with ${names(fe)}, at ${sum[fe[0]].end} µs.`, meta: Object.assign({ phase: 'compare' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'What each costs A', text: ['blocking:      1 call; no work done while waiting', 'non-blocking:  1 call + 1 per retry; work between', 'asynchronous:  a start, maybe a wait; work overlaps', '               the device, a handler at the end'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'With which read will A finish first?', options: ['blocking', 'non-blocking', 'asynchronous'], answer: (fr) => { const s = fr[0].meta.sum, K = ['blocking', 'nonblocking', 'async'], b = Math.min(...K.map((k) => s[k].finishA)); return K.filter((k) => s[k].finishA === b).map((k) => NAMES[k]); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Why can A finish sooner with an asynchronous read than a blocking one?', options: ['its own work overlaps the device’s', 'the device runs faster', 'it skips the copy', 'it makes more system calls'], answer: 0, why: 'A blocked process cannot do its other work; an asynchronous one can.' },
      { q: 'Which read can make the most system calls?', options: ['non-blocking, retried', 'blocking', 'asynchronous', 'they all make one'], answer: 0, why: 'Each retry that finds nothing is another call.' },
      { q: 'With a blocking read, B gets the CPU while A…', options: ['is blocked waiting for the device', 'computes', 'polls', 'copies'], answer: 0, why: 'A blocked process gives the CPU away.' },
      { q: 'A server handles thousands of connections in one thread. Which suits it?', options: ['non-blocking or asynchronous I/O with a readiness or completion queue', 'one blocking read at a time', 'busy waiting on each socket', 'polling with a timer'], answer: 0, why: 'One blocking read would stall every other connection.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
