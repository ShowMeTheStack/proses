// Part 6: real-time scheduling of periodic tasks. Each task is a row: an arrow up at each release, a small mark at
// each deadline, the task's jobs where they ran, and a miss drawn where a deadline passed with work left. The model
// topic introduces the tasks and their utilisation; rate-monotonic and EDF step through their schedules with the
// ready jobs and the rule that picked one, and EDF ends by running RM on the same tasks for comparison.
(function (S) {
  'use strict';
  const P = S.P05, Q = S.P06, Sch = () => S.Sched, G = () => S.Kit.gantt;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  /** "A 1 4" (C, T), "A 1 4 3" (D) or "A 1 4 3 2" (phase) per line -> {tasks} or {error} */
  Q.parseTasks = function (text) {
    const lines = String(text || '').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
    if (!lines.length) return { error: 'Tasks: one per line, as name, C, T (and D, phase if wanted)' };
    if (lines.length > 5) return { error: 'Tasks: at most 5, so the picture stays readable' };
    const tasks = [], seen = new Set();
    for (const l of lines) {
      const tk = l.split(/[\s,;]+/);
      const [id, ...nums] = tk;
      if (!/^[A-Za-z][A-Za-z0-9]{0,2}$/.test(id)) return { error: `Tasks: "${id}" is not a task name` };
      if (seen.has(id)) return { error: `Tasks: two tasks are named ${id}` };
      seen.add(id);
      if (nums.length < 2 || nums.length > 4 || nums.some((x) => !/^\d+$/.test(x))) return { error: `Tasks: ${id} needs whole numbers C T, then optionally D and a phase` };
      const [C, T, D, ph] = nums.map(Number);
      if (C < 1 || T < 2 || T > 40) return { error: `Tasks: ${id} needs C ≥ 1 and a period T from 2 to 40` };
      const d = D === undefined ? T : D;
      if (d < C || d > 2 * T) return { error: `Tasks: the deadline of ${id} must be from C to 2T` };
      tasks.push({ id, C, T, D: d, phase: ph || 0 });
    }
    const hyper = tasks.reduce((a, k) => (a / gcd(a, k.T)) * k.T, 1);
    if (hyper + Math.max(...tasks.map((k) => k.phase)) > 72) return { error: `Tasks: the hyperperiod (${hyper}) is too long to draw; choose periods with a smaller common multiple (at most 72)` };
    return { tasks };
  };
  Q.taskInput = (def) => ({ id: 'tasks', kind: 'program', label: 'Tasks: name, C (work), T (period), optional D (deadline) and phase', def, check: (v) => Q.parseTasks(v).error || null });
  Q.tasks = (text) => { const r = Q.parseTasks(text); if (r.error) throw new Error(r.error); return r.tasks; };
  Q.TS = {
    easy: 'A 1 4\nB 2 6\nC 3 12',
    tight: 'A 2 5\nB 4 7',
    full: 'A 1 3\nB 1 4\nC 2 6',
    harmonic: 'A 2 4\nB 2 8\nC 4 16',
    deadlines: 'A 1 4 2\nB 2 6 5\nC 2 8 8',
  };

  /**
   * the task rows of a real-time trace up to tick t: o {tr, t, y, x0, x1, final, rowH, gap}. Returns {items, X, h}
   */
  Q.taskRows = function (o) {
    const tr = o.tr, items = [], H = tr.end, per = (o.x1 - o.x0) / H, X = (u) => Math.round((o.x0 + u * per) * 10) / 10, rowH = o.rowH || 28, gap = o.gap || 36, ids = tr.tasks.map((k) => k.id);
    const upTo = o.final ? H : o.t;
    items.push(...G().axis({ prefix: 'rax', X, t1: H, y: o.y - 34, step: P.tickStep(per, 24), size: 13 }));
    tr.tasks.forEach((k, i) => {
      const y = o.y + i * (rowH + gap);
      items.push(P.text('tn' + k.id, o.x0 - 12, y + rowH / 2 + 5, k.id, 'glname', 15, 'end'));
      items.push(...G().track({ prefix: 'tt' + k.id, x: o.x0, y, w: o.x1 - o.x0, h: rowH }));
      // releases (arrows up above the row) and deadlines (marks under it)
      let rel = '', dl = '';
      for (let r = k.phase; r < H; r += k.T) {
        if (o.showAll || r <= upTo) rel += `M${X(r)},${y - 2} V${y - 14} M${X(r) - 4},${y - 9} L${X(r)},${y - 14} L${X(r) + 4},${y - 9} `;
        const d = r + k.D;
        if (d <= H && (o.showAll || r <= upTo)) dl += `M${X(d) - 4},${y + rowH + 3} L${X(d) + 4},${y + rowH + 3} L${X(d)},${y + rowH + 10} Z `;
      }
      if (rel) items.push({ key: 'rel' + k.id, kind: 'path', d: rel, cls: 'p06rel', audit: 'ignore', layer: 'top' });
      if (dl) items.push({ key: 'dl' + k.id, kind: 'path', d: dl, cls: 'p06dl', audit: 'ignore', layer: 'top' });
      // the jobs of the task where they ran
      tr.segs.forEach((s, j) => {
        if (s.job !== k.id || s.start >= upTo) return;
        const e = Math.min(s.end, upTo), w = X(e) - X(s.start), fits = S.geom.textWidth(s.inst, 13, { bold: true }) + 6 <= w;
        items.push({ key: 'sg' + j, kind: 'cell', x: X(s.start), y, w: Math.round(w * 10) / 10, h: rowH, text: fits ? s.inst : '', size: 13, cls: 'gseg p' + (i % 6) });
      });
      for (const m of tr.misses) if (m.task === k.id && m.t <= upTo) items.push(P.text('ms' + m.job, X(m.t), y + rowH + 26, '✗ ' + m.job, 'bad', 13, 'middle'));
    });
    if (!o.final) items.push(...G().cursor({ prefix: 'rc', X, t: o.t, y1: o.y - 6, y2: o.y + ids.length * (rowH + gap) - gap + 4 }));
    return { items, X, h: ids.length * (rowH + gap) - gap };
  };

  /** the CPU and the ready jobs at a step, each with its period or deadline */
  Q.rtQueue = function (o) {
    const items = [], st = o.st, ids = o.tr.tasks.map((k) => k.id), T = {};
    for (const k of o.tr.tasks) T[k.id] = k;
    const box = (name, task, x, cls, sub) => {
      const w = Math.max(56, Math.ceil(S.geom.textWidth(sub, 14) + 14));
      items.push({ key: 'j:' + name, kind: 'cell', x, y: o.y, w, h: 44, rx: 5, lines: [name, sub], size: 14, cls: 'gjob p' + (ids.indexOf(task) % 6) + (cls ? ' ' + cls : '') });
      return w;
    };
    const sub = (task, deadline) => (o.edf ? 'due ' + deadline : 'T = ' + T[task].T);
    let x = 0;
    items.push(P.text('cpuL', x, o.y + 27, 'CPU', 'glabel', 14));
    x += 40;
    if (st.run) x += box(st.run, st.task, x, 'run', sub(st.task, st.deadline) + ', ' + st.left + ' left') + 24;
    else { items.push({ key: 'idle', kind: 'cell', x, y: o.y, w: 60, h: 44, text: 'idle', size: 14, cls: 'gslot' }); x += 84; }
    items.push(P.text('rdL', x, o.y + 27, 'ready', 'glabel', 14));
    x += 50;
    const ready = (st.ready || []).slice().sort((a, b) => (o.edf ? a.deadline - b.deadline : T[a.task].T - T[b.task].T));
    if (!ready.length) items.push(P.text('rdE', x, o.y + 27, 'none', 'glabel', 14));
    for (const r of ready) x += box(r.job, r.task, x, '', sub(r.task, r.deadline)) + 6;
    return items;
  };

  /** the scene of one real-time schedule: one frame per event */
  Q.rtScene = function (tr, o) {
    const frames = [], edf = tr.policy === 'edf', n = tr.tasks.length;
    const ry = 50, rows = Q.taskRows({ tr, t: 0, y: ry, x0: 60, x1: P.W_, final: true }), qy = ry + rows.h + 46;
    const ts = tr.steps.map((s, t) => (s.kind === 'end' || s.decision !== 'continue' || (s.released || []).length || (s.missed || []).length ? t : -1)).filter((t) => t >= 0);
    for (const t of ts) {
      const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, -14, t, end)];
      items.push(...Q.taskRows({ tr, t, y: ry, x0: 60, x1: P.W_, final: end }).items);
      if (!end) items.push(...Q.rtQueue({ st, tr, y: qy, edf }));
      else items.push(...G().table({ prefix: 'pt', x: 0, y: qy, cols: [{ w: 60, label: 'task' }, { w: 50, label: 'C' }, { w: 50, label: 'T' }, { w: 50, label: 'D' }, { w: 96, label: 'released' }, { w: 90, label: 'missed' }, { w: 160, label: 'worst response' }], rows: tr.perTask.map((k, i) => ({ key: k.id, cells: [{ text: k.id, cls: 'p' + (i % 6) }, String(k.C), String(k.T), String(k.D), String(k.released), { text: String(k.missed), cls: k.missed ? 'worst' : '' }, String(k.worst)] })), rowH: 28, size: 14 }).items);
      const ready = (st.ready || []).map((r) => r.job);
      const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready, decision: st.decision, step: st, U: tr.U, misses: tr.misses.length };
      let say = P.clean(st.say);
      if (end) { meta.perTask = tr.perTask; say = o.sayEnd ? o.sayEnd(tr) : say; }
      frames.push({ items, say, meta, title: end ? 'end' : (st.missed || []).length ? 'miss' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
    }
    P.markAsks(frames, 3);
    return frames;
  };

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-model', family: 'p06-rt', order: 10, title: 'Periodic tasks and deadlines',
    blurb: 'A real-time task repeats: every period T it releases a job that needs C ticks of CPU and must finish within its deadline D (usually D = T). The share of the CPU a task needs is its utilisation C / T, and their sum U is the load of the whole set. A set with U over 1 cannot be scheduled by anyone; under 1, the policy decides whether every deadline is met. The pattern repeats every hyperperiod, the least common multiple of the periods.',
    inputs: [Q.taskInput(Q.TS.easy)],
    presets: [
      { label: 'Three tasks, U = 0.83', values: { tasks: Q.TS.easy } },
      { label: 'Two tasks, U = 0.97', values: { tasks: Q.TS.tight } },
      { label: 'Exactly full, U = 1', values: { tasks: Q.TS.full } },
      { label: 'Deadlines before the periods', values: { tasks: Q.TS.deadlines } },
      { label: 'Overloaded, U > 1', values: { tasks: 'A 2 4\nB 3 5' } },
    ],
    run(inp) {
      const ts = Q.tasks(inp.tasks), tr = Sch().rt(ts, { policy: 'rm' }), A = tr.analysis, frames = [];
      const rowsAll = Q.taskRows({ tr, t: 0, y: 40, x0: 60, x1: P.W_, final: true, showAll: true });
      const by = 40 + rowsAll.h + 60, bw = 600;
      const ubar = (k, done) => {
        const items = [P.text('ubT', 0, by - 12, 'utilisation U = Σ C / T', 'glabel', 14)];
        items.push({ key: 'ubk', kind: 'cell', x: 60, y: by, w: bw, h: 30, text: '', cls: 'gtrack' });
        let x = 60;
        const sc = bw / Math.max(1, A.Uexact);
        tr.tasks.slice(0, k).forEach((tk, i) => { const w = Math.round((sc * tk.C) / tk.T); items.push({ key: 'ub' + tk.id, kind: 'cell', x, y: by, w, h: 30, text: w > 60 ? tk.id + ' ' + P.f(tk.C / tk.T) : w > 20 ? tk.id : '', size: 13, cls: 'gseg p' + (i % 6) }); x += w; });
        items.push({ key: 'ub1', kind: 'path', d: `M${Math.round(60 + sc)},${by - 6} V${by + 36}`, cls: 'p05want', audit: 'ignore', layer: 'top' });
        items.push(P.text('ub1t', Math.round(60 + sc), by + 54, 'U = 1', 'glabel', 14, 'middle'));
        if (done) items.push(P.text('ubv', 0, by + 54, 'U = ' + A.U, A.Uexact > 1 + 1e-9 ? 'bad' : 'p05val', 15));
        return items;
      };
      tr.tasks.forEach((k, i) => {
        const part = Object.assign({}, tr, { tasks: tr.tasks.slice(0, i + 1), segs: [], misses: [] });
        const items = Q.taskRows({ tr: part, t: 0, y: 40, x0: 60, x1: P.W_, final: true, showAll: true }).items.concat(ubar(i + 1, false));
        frames.push({ items, say: `Task ${k.id} releases a job every ${k.T} ticks (the arrows), each needing ${k.C} ${k.C === 1 ? 'tick' : 'ticks'} of CPU within ${k.D} of its release (the marks under the row): utilisation ${k.C} / ${k.T} = ${P.f(k.C / k.T)}.`, meta: { phase: 'task', k, u: P.r2(k.C / k.T) }, title: k.id });
      });
      const items = rowsAll.items.concat(ubar(tr.tasks.length, true));
      frames.push({ items, say: `Together the tasks need U = ${tr.tasks.map((k) => k.C + '/' + k.T).join(' + ')} = ${A.U} of the CPU` + (A.Uexact > 1 + 1e-9 ? ': more than all of it, so some deadline must be missed whatever the policy.' : `. The pattern repeats every hyperperiod of ${A.hyper} ticks, the least common multiple of the periods.`), meta: { phase: 'sum', U: A.U, hyper: A.hyper }, title: 'U' });
      const run = Q.taskRows({ tr, t: tr.end, y: 40, x0: 60, x1: P.W_, final: true, showAll: true }).items.concat(ubar(tr.tasks.length, true));
      frames.push({ items: run, say: `One schedule of these tasks over the hyperperiod, by rate-monotonic priority (the next topics explain it): ` + (tr.misses.length ? `${P.s(tr.misses.length, 'deadline')} missed, marked ✗.` : 'every deadline is met.') + ` The CPU is busy ${P.f(tr.util * 100)}% of the time.`, meta: { phase: 'run', misses: tr.misses.length, util: tr.util * 100 }, title: 'a schedule' });
      return { frames, def: P.def(['A periodic task', ['C: the CPU each job needs (worst case)', 'T: the period between releases', 'D: the relative deadline (D = T if not given)', 'phase: the time of the first release']], ['Utilisation', ['u = C / T for each task', 'U = Σ C / T', 'U > 1: no schedule can meet every deadline']], ['Input', 'One task per line: name, C, T, then optionally D and a phase, as "B 2 6" or "B 2 6 5".']) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'task' && fr[i + 1] && fr[i + 1].meta.phase === 'sum', pick: 'option', ask: 'Is the total utilisation more than 1?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.U > 1 ? 'yes' : 'no'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A task needs 2 ticks every 8. Its utilisation is…', options: ['0.25', '4', '0.5', '2'], answer: 0, why: '2 / 8.' },
      { q: 'Tasks (1, 4), (2, 6), (3, 12): what is U, to two places?', options: ['0.83', '0.75', '1', '0.5'], answer: 0, why: '1/4 + 2/6 + 3/12 = 0.25 + 0.33 + 0.25.' },
      { q: 'Periods 4, 6 and 12 repeat together every…', options: ['12 ticks', '24 ticks', '22 ticks', '288 ticks'], answer: 0, why: 'The least common multiple.' },
      { q: 'U = 1.2. What can a scheduler do?', options: ['Nothing will meet every deadline', 'EDF meets them all', 'RM meets them all', 'Use a smaller quantum'], answer: 0, why: 'The tasks need more CPU than exists.' },
      { q: 'What does D < T mean for a task?', options: ['Each job must finish before the next release, earlier than the period', 'It runs more often', 'It has no deadline', 'It is aperiodic'], answer: 0, why: 'A constrained deadline.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-rm', family: 'p06-rt', order: 20, title: 'Rate-monotonic scheduling',
    blurb: 'Rate-monotonic scheduling gives each task a fixed priority by its period: the shorter the period, the higher the priority. The ready job of the highest-priority task runs, and a release of a more urgent task preempts at once. It is the optimal fixed-priority policy for deadlines equal to periods, but it cannot always use the whole CPU: some sets with U under 1 still miss.',
    inputs: [Q.taskInput(Q.TS.easy), { id: 'miss', kind: 'choice', label: 'A job that misses its deadline', def: 'continue', options: [{ value: 'continue', label: 'carries on, late' }, { value: 'abort', label: 'is dropped' }] }],
    presets: [
      { label: 'Three tasks, U = 0.83: all met', values: { tasks: Q.TS.easy } },
      { label: 'U = 0.97: B misses', values: { tasks: Q.TS.tight } },
      { label: 'Harmonic periods, U = 1: all met', values: { tasks: Q.TS.harmonic } },
      { label: 'U = 0.97, misses dropped', values: { tasks: Q.TS.tight, miss: 'abort' } },
    ],
    run(inp) {
      const tr = Sch().rt(Q.tasks(inp.tasks), { policy: 'rm', onMiss: inp.miss }), A = tr.analysis;
      const frames = Q.rtScene(tr, { sayEnd: (tr) => `The hyperperiod ends at t = ${tr.end}: ` + (tr.misses.length ? `${P.s(tr.misses.length, 'deadline')} missed (${tr.misses.map((m) => m.job).join(', ')}), although U = ${A.U}.` : `every deadline is met, with U = ${A.U}.`) + ` The rate-monotonic bound for ${P.s(A.n, 'task')} is ${A.bound}.` });
      frames[frames.length - 1].meta.bound = A.bound; frames[frames.length - 1].meta.n = A.n;
      return { frames, def: P.def(['The rule', ['priority by period: shorter T, higher priority (fixed for ever)', 'the ready job of the highest-priority task runs', 'a release of a higher-priority task preempts']], ['When it works', 'Rate-monotonic is optimal among fixed-priority policies when D = T: if any fixed priorities meet every deadline, these do. Whether they do is decided by [[rt-bound]] or exactly by [[rt-rta]].']) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'Tasks with periods 5, 7 and 20 under RM: which has the highest priority?', options: ['the one with period 5', 'the one with period 20', 'the one with the most work', 'they rotate'], answer: 0, why: 'Shorter period, higher priority.' },
      { q: 'Under RM, can a task\'s priority change over time?', options: ['No, it is fixed by its period', 'Yes, at each deadline', 'Yes, by aging', 'Only on misses'], answer: 0, why: 'That is what makes it a fixed-priority policy.' },
      { q: 'A (2, 5) and B (4, 7), U ≈ 0.97. Under RM, B…', options: ['misses its first deadline at t = 7', 'always meets its deadlines', 'starves for ever', 'runs first'], answer: 0, why: 'A runs 0–2 and 5–7, B gets 2–5 only: 3 of its 4 ticks.' },
      { q: 'When are periods "harmonic", and why does it matter?', options: ['Each divides the next; RM can then use the whole CPU', 'They are all prime; RM fails', 'They are equal; RM is FCFS', 'It does not matter'], answer: 0, why: 'With harmonic periods, RM meets every deadline up to U = 1.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'rt-edf', family: 'p06-rt', order: 30, title: 'Earliest deadline first',
    blurb: 'EDF gives the CPU to the ready job whose absolute deadline comes first; priorities change from job to job. On one CPU, with deadlines equal to periods, it meets every deadline whenever U ≤ 1: it can use the whole processor where rate-monotonic cannot. The last step runs RM on the same tasks for comparison.',
    inputs: [Q.taskInput(Q.TS.tight)],
    presets: [
      { label: 'U = 0.97: EDF meets what RM misses', values: { tasks: Q.TS.tight } },
      { label: 'Exactly full, U = 1', values: { tasks: Q.TS.full } },
      { label: 'Overloaded: misses spread', values: { tasks: 'A 2 4\nB 3 5' } },
      { label: 'Deadlines before the periods', values: { tasks: Q.TS.deadlines } },
    ],
    run(inp) {
      const ts = Q.tasks(inp.tasks), tr = Sch().rt(ts, { policy: 'edf' }), rm = Sch().rt(ts, { policy: 'rm' }), A = tr.analysis;
      const frames = Q.rtScene(tr, { sayEnd: (tr) => `The hyperperiod ends at t = ${tr.end}: under EDF ` + (tr.misses.length ? `${P.s(tr.misses.length, 'deadline')} missed (${tr.misses.map((m) => m.job).join(', ')})` : 'every deadline is met') + `, with U = ${A.U}.` });
      // the same tasks under RM, drawn under EDF
      const last = frames[frames.length - 1], ry = 50, rows = Q.taskRows({ tr, t: 0, y: ry, x0: 60, x1: P.W_, final: true });
      const items = last.items.filter((it) => !it.key.startsWith('pt'));
      const y2 = ry + rows.h + 110;
      items.push(P.text('edfT', P.W_, -14, 'EDF', 'gpol', 15, 'end'));
      items.push(P.text('rmT', 0, y2 - 58, 'RM, the same tasks', 'gpol', 15));
      items.push(...Q.taskRows({ tr: rm, t: rm.end, y: y2, x0: 60, x1: P.W_, final: true }).items.map((it) => Object.assign(it, { key: 'rm:' + it.key })));
      frames.push({ items, say: `The same tasks under rate-monotonic priority: ` + (rm.misses.length ? `${P.s(rm.misses.length, 'deadline')} missed (${rm.misses.map((m) => m.job).join(', ')})` : 'every deadline met too') + `, against ${tr.misses.length} under EDF. EDF reorders jobs by deadline, so a long-period job close to its deadline can go ahead of a short-period one.`, meta: { phase: 'compare', edf: tr.misses.length, rm: rm.misses.length }, title: 'against RM' });
      return { frames, def: P.def(['The rule', ['the ready job with the earliest absolute deadline runs', 'ties: the one released first', 'a newly released job with an earlier deadline preempts']], ['When it works', 'With every deadline equal to its period, EDF meets every deadline if and only if U ≤ 1. With deadlines before the periods, the processor-demand test decides: see [[rt-demand]].'], ['Its cost', 'Priorities are dynamic, so the scheduler must keep the ready jobs ordered by deadline, and when the CPU is overloaded EDF can miss deadlines of every task, not just the least important.']) };
    },
    predict: [P.askNext(), { at: (f, i, fr) => f.meta.phase === 'end', pick: 'option', ask: 'Will rate-monotonic priority miss more deadlines than EDF on these tasks?', options: ['more', 'the same', 'fewer'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.rm > m.edf ? 'more' : m.rm === m.edf ? 'the same' : 'fewer'; }, explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'Ready: A2 due at 10 and B1 due at 7. Under EDF, which runs?', options: ['B1', 'A2', 'the one with the shorter period', 'the one released first'], answer: 0, why: 'Its deadline is earlier.' },
      { q: 'With deadlines equal to periods, EDF meets every deadline when…', options: ['U ≤ 1', 'U ≤ 0.69', 'U ≤ n(2^(1/n) − 1)', 'never'], answer: 0, why: 'That bound is exact for EDF on one CPU.' },
      { q: 'Why might a system still choose RM over EDF?', options: ['Fixed priorities are simpler, and overload hurts only the lowest-priority tasks', 'RM uses the CPU better', 'EDF cannot preempt', 'RM needs no periods'], answer: 0, why: 'EDF misses can hit any task in overload.' },
      { q: 'Is EDF a fixed-priority policy?', options: ['No: each job\'s priority is its deadline', 'Yes', 'Only with harmonic periods', 'Only at U = 1'], answer: 0, why: 'Priorities change job by job.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
