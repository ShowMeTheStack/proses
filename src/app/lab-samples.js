// The framework's own sample labs (hidden from the Labs list, open at #labs/sample-sched, sample-proc, sample-bank):
// small, complete uses of the lab shell that the checks and the end-to-end tests drive, and a pattern for the real
// labs. sample-sched: a workload table, a policy select, a quantum and a toggle, Gantt frames from S.Sched.
// sample-proc: a C program in the editor, run on the simulated kernel, each process's line tagged in the editor.
// sample-bank: matrix and list editors, the banker's safety check row by row.
(function (S) {
  'use strict';
  const L = S.Labs;
  const box = (x, y, w, h) => ({ x, y, w, h });

  // ---- a scheduler sample -----------------------------------------------------------------------------------------
  const WORK = [
    { id: 'A', arrive: 0, bursts: [7] }, { id: 'B', arrive: 1, bursts: [2, 3, 2] }, { id: 'C', arrive: 2, bursts: [4] }, { id: 'D', arrive: 4, bursts: [1] },
  ];
  const POLICIES = [{ value: 'fcfs', label: 'FCFS' }, { value: 'sjf', label: 'SJF' }, { value: 'srtn', label: 'SRTN' }, { value: 'rr', label: 'Round robin' }];
  L.add({
    id: 'sample-sched', hidden: true, part: 'scheduling', icon: 'history', title: 'Sample lab: a scheduler',
    blurb: 'A workload you type, a policy and its quantum: the Gantt chart tick by tick, the ready queue, and the metrics as each job finishes.',
    setup: {
      fields: [
        { id: 'work', label: 'Jobs', type: 'table', group: 'Workload', def: WORK, minRows: 1, maxRows: 6,
          columns: [{ id: 'id', label: 'Job', type: 'text', pattern: '^[A-Z]$', patternWhy: 'one capital letter', width: '52px' }, { id: 'arrive', label: 'Arrives', type: 'int', min: 0, max: 30, width: '70px' }, { id: 'bursts', label: 'Bursts (CPU I/O CPU…)', type: 'ints', min: 1, max: 12, odd: 'an odd count: CPU, then I/O and CPU in turn' }],
          newRow: (i) => ({ id: String.fromCharCode(65 + i), arrive: i, bursts: [3] }),
          check: (r, i, rows) => (rows.findIndex((x) => x.id === r.id) !== i ? { id: 'two jobs are called ' + r.id } : null) },
        { id: 'policy', label: 'Policy', type: 'select', group: 'Policy', options: POLICIES, def: 'rr' },
        { id: 'q', label: 'Quantum', type: 'number', min: 1, max: 8, def: 2, unit: 'ticks', show: (v) => v.policy === 'rr' },
        { id: 'cs', label: 'A context switch costs a tick', type: 'toggle', def: false },
      ],
      presets: [
        { label: 'Mixed', values: { work: WORK, policy: 'rr', q: 2 } },
        { label: 'Convoy', values: { work: [{ id: 'A', arrive: 0, bursts: [9] }, { id: 'B', arrive: 1, bursts: [1] }, { id: 'C', arrive: 1, bursts: [1] }, { id: 'D', arrive: 2, bursts: [2] }], policy: 'fcfs' } },
      ],
    },
    run(v, ctx) {
      const G = S.Kit.gantt, tr = S.Sched.run(v.work, v.policy, { quantum: v.q, cs: v.cs ? 1 : 0 });
      const jobs = tr.jobs.map((j) => j.id), T = tr.end, narrow = ctx.narrow;
      const W = narrow ? 380 : 960, x0 = narrow ? 8 : 150, x1 = W - 10;
      const tm = G.time({ x0, x1, t1: T });
      let step = 1;
      while (tm.per * step < 28) step = step === 1 ? 2 : step === 2 ? 5 : step + 5;
      const name = POLICIES.find((p) => p.value === v.policy).label + (v.policy === 'rr' ? ' q = ' + v.q : '');
      const rowsOf = (t) => tr.metrics.rows.map((r) => [r.id, r.arrive, r.finish <= t ? r.finish : '–', r.finish <= t ? r.turnaround : '–', r.finish <= t ? r.waiting : '–', r.finish <= t ? r.response : '–']);
      const frames = [];
      for (let t = 0; t <= T; t++) {
        const s = tr.steps[Math.min(t, tr.steps.length - 1)] || {};
        const items = [];
        if (!narrow) items.push({ key: 'nm', kind: 'text', x: 0, y: 66, text: name, size: 15, cls: 'strong', anchor: 'start' });
        items.push(...G.axis({ prefix: 'ax', X: tm.X, t1: T, y: 22, step, size: 13 }));
        items.push(...G.track({ prefix: 'tk', x: x0, y: narrow ? 48 : 46, w: x1 - x0, h: 40 }));
        items.push(...G.bar({ prefix: 'br', X: tm.X, segs: tr.segs, y: narrow ? 48 : 46, h: 40, upTo: t, jobs, now: t < T ? t : null, size: 15 }));
        items.push(...G.cursor({ prefix: 'cu', X: tm.X, t, y1: 40, y2: 94 }));
        const q = G.queue({ prefix: 'rq', x: narrow ? 8 : x0, y: 128, ids: s.ready || [], jobs, w: 34, h: 32, gap: 8, label: 'ready', labelW: 64, keyOf: (id) => 'job:' + id });
        items.push(...q.items);
        const io = G.queue({ prefix: 'io', x: narrow ? 8 : x0 + 380, y: narrow ? 180 : 128, ids: (s.io || []).map((o) => (typeof o === 'object' ? o.id : o)), jobs, w: 34, h: 32, gap: 8, label: 'in I/O', labelW: 64, cls: 'io', keyOf: (id) => 'io:' + id });
        items.push(...io.items);
        const done = tr.metrics.rows.filter((r) => r.finish <= t);
        const avg = (k) => (done.length ? +(done.reduce((a, r) => a + r[k], 0) / done.length).toFixed(2) : '–');
        frames.push({
          items, at: Math.min(t, tr.steps.length - 1), title: 't = ' + t,
          say: t >= T ? 'Every job has finished at t = `' + T + '`: the mean turnaround is `' + avg('turnaround') + '` ticks and the mean waiting time `' + avg('waiting') + '`.' : s.say || 'Tick ' + t + '.',
          view: narrow ? box(-4, 0, 388, 226) : box(-10, 0, 980, 176),
          tables: [{ title: 'Each job', cols: ['Job', 'Arrives', 'Finish', 'Turnaround', 'Waiting', 'Response'], rows: rowsOf(t), hl: tr.metrics.rows.findIndex((r) => r.id === s.run) }],
          metrics: [{ label: 'Mean turnaround', value: avg('turnaround'), unit: 'ticks' }, { label: 'Mean waiting', value: avg('waiting'), unit: 'ticks' }, { label: 'Mean response', value: avg('response'), unit: 'ticks' }, { label: 'Jobs finished', value: done.length + ' of ' + tr.jobs.length, cls: done.length === tr.jobs.length ? 'good' : '' }],
          hold: 1100,
        });
      }
      return { frames, trace: tr.steps, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics };
    },
  });

  // ---- a C program sample -----------------------------------------------------------------------------------------
  const PROGS = [
    { name: 'two-children.c', src: '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    for (int i = 0; i < 2; i++) {\n        pid_t k = fork();\n        if (k == 0) {\n            printf("child %d of %d\\n", i, getppid());\n            exit(i + 4);\n        }\n    }\n    int st;\n    while (wait(&st) > 0)\n        printf("reaped, status %d\\n", WEXITSTATUS(st));\n    return 0;\n}' },
    { name: 'late-parent.c', src: '#include <stdio.h>\n#include <unistd.h>\n\nint main(void) {\n    if (fork() == 0) {\n        sleep(1);\n        printf("orphan, now a child of %d\\n", getppid());\n        return 0;\n    }\n    printf("parent leaves first\\n");\n    return 0;\n}' },
  ];
  const STATE = { ready: 'ready', running: 'running', blocked: 'blocked', zombie: 'zombie', reaped: 'done', stopped: 'blocked' };
  L.add({
    id: 'sample-proc', hidden: true, part: 'processes', icon: 'terminal', title: 'Sample lab: a C program', wide: true,
    blurb: 'Type or open a program; Run compiles it and runs it on the simulated kernel. Each process’s line is tagged in the editor, and the tree and the terminal follow the steps.',
    setup: {
      fields: [
        { id: 'src', label: 'Program', type: 'code', def: PROGS[0].src, examples: PROGS, files: 'sample-proc' },
        { id: 'policy', label: 'Who runs next', type: 'select', group: 'Kernel', options: [{ value: 'fifo', label: 'First in line' }, { value: 'rr', label: 'Round robin' }, { value: 'random', label: 'Random (seeded)' }], def: 'random' },
        { id: 'tty', label: 'stdout is a terminal', type: 'toggle', def: true },
      ],
    },
    run(v, ctx) {
      const Kp = S.Kit.proc, narrow = ctx.narrow;
      const sys = S.Kern.run(v.src, { policy: v.policy, seed: ctx.seed, snap: true, cow: false, tty: v.tty });
      const evs = sys.trace.map((e, at) => Object.assign({ at }, e)).filter((e) => e.snap && !['step', 'sleep', 'flush', 'buffer'].includes(e.kind));
      const progs = sys.procs.filter((p) => p.role === 'prog').map((p) => p.pid);
      const cls = (pid) => 'p' + (Math.max(0, progs.indexOf(pid)) % 6);
      const W = narrow ? 380 : 760;
      const frames = evs.map((e) => {
        const snap = e.snap, items = [];
        const nodes = snap.slice().sort((a, b) => a.pid - b.pid).map((p) => ({ id: p.pid, parent: p.ppid, lines: [p.role === 'init' ? 'init · 1' : p.role === 'shell' ? 'sh · 2' : 'pid ' + p.pid, p.state === 'zombie' ? (narrow ? 'zombie · ' : 'zombie · exit ') + p.exitCode : p.state === 'reaped' ? 'reaped' : p.state], cls: (p.role !== 'prog' ? 'kern ' : '') + 's-' + (STATE[p.state] || 'ready') + (p.pid === e.pid ? ' act' : ''), dim: p.state === 'reaped' }));
        const tree = Kp.tree({ prefix: 'tr', x: 0, y: 0, w: W, nodes, boxW: narrow ? 92 : 130, boxH: 44, levelH: 70, gap: 12, size: 13 });
        items.push(...tree.items);
        const rows = [];
        let cur = null;
        for (const w of sys.term.slice(0, e.nterm || 0)) for (const [k, part] of w.text.split('\n').entries()) {
          if (k > 0) { if (cur) rows.push(cur); cur = null; }
          if (part) { cur = cur || { tags: [], text: '' }; cur.text += part; if (!cur.tags.some((t) => t.pid === w.pid)) cur.tags.push({ pid: w.pid, cls: cls(w.pid) }); }
        }
        if (cur) rows.push(cur);
        const termY = 3 * 70 + 44 + 26;
        items.push(...Kp.term({ prefix: 'tm', x: 0, y: termY, w: W, rows, rowsShown: 4, title: 'terminal', buffers: [] }).items);
        const marks = snap.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped' && p.line).map((p) => ({ line: p.line, tag: String(p.pid), cls: cls(p.pid), act: p.pid === e.pid, title: 'pid ' + p.pid + ', ' + p.state }));
        return {
          items, say: e.say, title: e.kind, at: e.at, marks, view: box(-10, -6, W + 20, termY + 32 + 4 * 24 + 40),
          tables: [{ title: 'Processes', cols: ['pid', 'ppid', 'state', 'line', 'exit'], rows: snap.filter((p) => p.role === 'prog').map((p) => [String(p.pid), String(p.ppid), { text: p.state, cls: p.state === 'zombie' ? 'bad' : '' }, p.line ? String(p.line) : '–', p.exitCode === undefined || p.exitCode === null ? '–' : String(p.exitCode)]), hl: snap.filter((p) => p.role === 'prog').findIndex((p) => p.pid === e.pid) }],
        };
      });
      return { frames, trace: sys.trace.filter((e) => e.kind !== 'step') .map((e) => ({ kind: e.kind, say: e.say, pid: e.pid, t: e.t })), metrics: [{ label: 'Processes', value: progs.length }, { label: 'Output lines', value: sys.out.split('\n').filter(Boolean).length }, { label: 'Kernel events', value: sys.trace.length }] };
    },
  });

  // ---- a banker's sample ----------------------------------------------------------------------------------------
  L.add({
    id: 'sample-bank', hidden: true, part: 'deadlock', icon: 'route', title: 'Sample lab: the banker’s safety check', seed: false,
    blurb: 'Allocation, Max and Available as you type them: the safety check scans the rows, Work grows as each process finishes, and a safe sequence comes out, or none does.',
    setup: {
      fields: [
        { id: 'alloc', label: 'Allocation', type: 'matrix', group: 'State', def: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1]], max: 9, resize: true },
        { id: 'max', label: 'Max', type: 'matrix', def: [[6, 4, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2]], max: 12, resize: true },
        { id: 'avail', label: 'Available', type: 'list', def: [3, 3, 2], min: 0, max: 12, minLen: 1, maxLen: 5, names: (j) => String.fromCharCode(65 + j) },
      ],
      check(v) {
        const n = v.alloc.length, m = (v.alloc[0] || []).length;
        if (v.max.length !== n || (v.max[0] || []).length !== m) return 'Max must have the same shape as Allocation (' + n + ' × ' + m + ')';
        if (v.avail.length !== m) return 'Available needs one number for each of the ' + m + ' resources';
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (v.alloc[i][j] > v.max[i][j]) return 'P' + i + ' holds more ' + String.fromCharCode(65 + j) + ' than its Max';
        return null;
      },
    },
    run(v, ctx) {
      const B = S.Banker, Kb = S.Kit.bank, need = B.need(v.max, v.alloc), n = v.alloc.length, m = v.avail.length;
      const names = v.alloc.map((r, i) => 'P' + i), res = v.avail.map((r, j) => String.fromCharCode(65 + j));
      const out = B.safety({ avail: v.avail, alloc: v.alloc, need, names, res });
      const cw = 34, ch = 28, gap = 3, mw = m * (cw + gap);
      const frames = out.steps.map((s) => {
        const items = [];
        const fin = s.finish || out.steps[0].finish || names.map(() => false);
        const rowCls = (i) => (i === s.i ? 'act' : fin[i] ? 'good' : '');
        let x = 40;
        for (const [k, title, vals] of [['al', 'Allocation', v.alloc], ['mx', 'Max', v.max], ['nd', 'Need', need]]) {
          items.push(...Kb.matrix({ prefix: k, x, y: 30, cw, ch, gap, title, cols: res, rows: k === 'al' ? names : null, vals, rowCls, size: 14 }).items);
          x += mw + 26;
        }
        items.push(...Kb.finish({ prefix: 'fi', x, y: 30, cw: 54, ch, gap, vals: fin, title: 'Finish', cls: (i) => (fin[i] ? 'good' : '') }).items);
        items.push(...Kb.vector({ prefix: 'wk', x: 40 + 60, y: 30 + 26 + n * (ch + gap) + 30, cw, ch, gap, title: 'Work', vals: s.after || s.work || v.avail, titleW: 60, cols: res }).items);
        return { items, say: s.say, title: s.short || s.kind, tables: [{ title: 'Need = Max − Allocation', cols: ['', ...res], rows: need.map((r, i) => [names[i], ...r.map(String)]), hl: s.i }] };
      });
      return { frames, trace: out.steps, metrics: [{ label: 'Verdict', value: out.safe ? 'safe' : 'unsafe', cls: out.safe ? 'good' : 'bad' }, { label: 'Safe sequence', value: out.safe ? out.seq.map((i) => names[i]).join(' ') : '–' }] };
    },
  });

  // ---- what the diagram checker looks at ------------------------------------------------------------------------
  if (S.Checks) {
    S.Checks.push({ group: 'labs', name: 'lab shell: scheduler sample', hash: 'labs/sample-sched', ready: "document.querySelector('#labView svg .it')", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'lab shell: scheduler sample, last step, metrics', hash: 'labs/sample-sched', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.go(P.frames.length - 1, true); P.showTab('metrics'); P.stage.finish();", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'lab shell: C program sample', hash: 'labs/sample-proc', ready: "document.querySelector('#labView svg .it') && document.querySelector('.le-tag')", setup: "const P = Proses.app.page.lab; P.go(3, true); P.showTab('tables'); P.stage.finish();", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'lab shell: C program with a compile error', hash: 'labs/sample-proc', fresh: true, ready: "document.querySelector('#labView .le')", setup: "const P = Proses.app.page.lab; P.setup.editor.set(P.setup.editor.get().replace('int st;', 'int st')); P.values.src = P.setup.editor.get(); await P.runNow(false); try { localStorage.removeItem('proses.lab:sample-proc'); } catch (e) {}", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'lab shell: banker sample', hash: 'labs/sample-bank', ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.go(2, true); P.stage.finish();", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
