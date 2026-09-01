// Part 6: several cores. One shared ready queue against a queue per core; balancing the per-core queues by pushing
// (a periodic balancer) and pulling (an idle core steals); and affinity, where a job that moves to another core first
// spends ticks warming that core's cache, so each job's lane is coloured by the core it ran on.
(function (S) {
  'use strict';
  const P = S.P05, Q = S.P06, Sch = () => S.Sched, G = () => S.Kit.gantt;
  const MC_WORK = 'A 0 8\nB 0 3 (2) 3\nC 1 6\nD 2 2 (3) 2\nE 3 5';
  const runMulti = (inp, extra) => Sch().multi(P.work(inp.work), Object.assign({ cores: inp.cores, queue: inp.mode, quantum: inp.q, migrate: inp.migrate || 0 }, extra || {}));
  const coreInputs = (def) => [
    P.workInput(def || MC_WORK),
    { id: 'mode', kind: 'choice', label: 'Ready queues', def: 'per-core', options: [{ value: 'shared', label: 'one shared queue' }, { value: 'per-core', label: 'one queue per core' }] },
    { id: 'cores', kind: 'number', label: 'Cores', def: 2, min: 2, max: 4 },
    { id: 'q', kind: 'number', label: 'Quantum (ticks)', def: 2, min: 1, max: 6 },
  ];

  /** the standard multicore frame: lanes, the Gantt by core, and an extra */
  function frame(tr, t, o) {
    const st = tr.steps[t], end = st.kind === 'end', jobs = tr.jobs.map((j) => j.id), n = tr.params.cores;
    const items = [P.now('now', 0, -14, t, end)];
    const L = Q.cores({ st, jobs, shared: tr.params.queue === 'shared', x: 0, y: 0, w: o.w || 680, end, sub: o.sub });
    items.push(...L.items);
    const gy = L.h + 46;
    if (o.noGantt) return { items, st, end, L, gy: L.h + 20, jobs };
    items.push(...P.rowGantt({ tr, jobs, t, x0: 70, x1: P.W_, y: gy, rows: Array.from({ length: n }, (_, k) => 'core ' + k), rowOf: (s) => s.core, final: end }).items);
    return { items, st, end, L, gy: gy + n * 34 + 20, jobs };
  }

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'mc-queues', family: 'p06-multi', order: 10, title: 'One queue or one per core',
    blurb: 'With several cores, the ready jobs can wait in one shared queue, from which any free core takes the next job, or in a queue per core. A shared queue balances itself, but every core must lock it, and a job hops from core to core, leaving its cache behind. Per-core queues need no shared lock and keep each job on one core, but the queues can drift out of balance. Each core here runs round robin.',
    inputs: coreInputs(),
    presets: [
      { label: 'Per-core queues, two cores', values: { mode: 'per-core' } },
      { label: 'A shared queue, two cores', values: { mode: 'shared' } },
      { label: 'Three cores, shared', values: { mode: 'shared', cores: 3, work: 'A 0 6\nB 0 6\nC 0 6\nD 1 4\nE 2 4\nF 3 4' } },
      { label: 'Three cores, per-core', values: { mode: 'per-core', cores: 3, work: 'A 0 6\nB 0 6\nC 0 6\nD 1 4\nE 2 4\nF 3 4' } },
    ],
    run(inp) {
      const tr = runMulti(inp), frames = [];
      for (const t of Q.moments(tr)) {
        const f = frame(tr, t, {});
        if (f.end) f.items.push(...Q.coreTable(tr, 0, f.gy + 10).items);
        const meta = { phase: f.end ? 'end' : 'tick', t, step: f.st, migrations: f.st.migrations, ready: [].concat(f.st.shared || [], ...(f.st.cores || []).map((c) => c.queue)), cores: f.st.cores };
        let say = P.clean(f.st.say);
        if (f.end) { meta.perCore = tr.perCore; meta.metrics = tr.metrics; meta.mig = tr.migrations.length; say = `Every job has finished at t = ${tr.end}. ` + tr.perCore.map((c) => `Core ${c.id} was busy ${c.busy} of ${tr.end} ticks (${Math.round(100 * c.util)}%)`).join('; ') + `. Jobs moved between cores ${P.s(tr.migrations.length, 'time')}; average turnaround ${P.f(tr.metrics.avg.turnaround)}.`; }
        frames.push({ items: f.items, say, meta, title: f.end ? 'end' : 't = ' + t });
      }
      return { frames, def: P.def(['Shared queue', ['+ balanced by construction: a free core always finds work', '− one lock for every core; contention grows with cores', '− jobs wander between cores, losing their caches']], ['Per-core queues', ['+ no shared lock; a job stays near its cache', '− queues drift out of balance: one core idle while another has a queue', 'a new job goes to the least loaded core; a job back from I/O to the core it last ran on']]) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'tick' && i === 0, pick: 'option', ask: 'By the end, how many times will a job have started on a core other than the one it last ran on?', options: (fr) => { const m = fr[fr.length - 1].meta.mig; return [...new Set([0, m, m + 2, Math.max(0, m - 2), m + 4])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.mig), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'What is the main drawback of one shared ready queue on many cores?', options: ['Every core contends for its lock, and jobs lose their caches by moving', 'Cores can sit idle while others have work', 'Jobs starve', 'It needs priorities'], answer: 0, why: 'It balances well but scales poorly.' },
      { q: 'What is the main drawback of per-core queues?', options: ['They can go out of balance', 'They need one global lock', 'Jobs migrate constantly', 'They cannot run round robin'], answer: 0, why: 'One core may idle while another has a queue.' },
      { q: 'Under per-core queues, where does a job coming back from I/O go here?', options: ['to the core it last ran on', 'to core 0', 'to the shared queue', 'to the busiest core'], answer: 0, why: 'Its cache may still be warm there.' },
      { q: 'Two cores, jobs needing 6, 6, 6 and 6 ticks all at 0, with free switches. When can all be done at best?', options: ['t = 12', 't = 24', 't = 6', 't = 18'], answer: 0, why: '24 ticks of work shared by 2 cores.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const BAL_WORK = 'A 0 2\nB 0 10\nC 0 2\nD 0 10\nE 0 2\nF 0 10';
  S.topic({
    id: 'mc-balance', family: 'p06-multi', order: 20, title: 'Load balancing: push and pull',
    blurb: 'Per-core queues drift apart: here the short jobs happen to land on one core, which soon has nothing to do while the other still has a queue. Two fixes move work between queues. Pull: a core whose queue is empty steals a job from the busiest queue. Push: every so often a balancer moves jobs from the most loaded core to the least loaded. The arrows show each move.',
    inputs: [P.workInput(BAL_WORK), { id: 'cores', kind: 'number', label: 'Cores', def: 2, min: 2, max: 4 }, { id: 'q', kind: 'number', label: 'Quantum (ticks)', def: 2, min: 1, max: 6 }, { id: 'pull', kind: 'choice', label: 'An idle core pulls', def: 'no', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }] }, { id: 'push', kind: 'number', label: 'Balancer pushes every (ticks, 0: never)', def: 0, min: 0, max: 20 }],
    presets: [
      { label: 'No balancing: a core idles', values: { pull: 'no', push: 0 } },
      { label: 'Pull: the idle core steals', values: { pull: 'yes', push: 0 } },
      { label: 'Push every 4 ticks', values: { pull: 'no', push: 4 } },
      { label: 'Three cores, pull', values: { cores: 3, pull: 'yes', work: 'A 0 1\nB 0 9\nC 0 9\nD 0 1\nE 0 9\nF 0 9' } },
    ],
    run(inp) {
      const tr = Sch().multi(P.work(inp.work), { cores: inp.cores, queue: 'per-core', quantum: inp.q, pull: inp.pull === 'yes', push: inp.push }), frames = [];
      const idleWhileWaiting = (upTo) => { let n = 0; for (let t = 0; t < upTo; t++) { const st = tr.steps[t]; const waiting = st.cores.reduce((a, c) => a + c.queue.length, 0); n += st.cores.filter((c) => !c.run).length && waiting ? st.cores.filter((c) => !c.run).length : 0; } return n; };
      for (const t of Q.moments(tr)) {
        const f = frame(tr, t, { w: 640 });
        // loads beside each lane, and this tick's moves as arrows on the right
        if (!f.end) f.st.cores.forEach((c, k) => f.items.push(P.text('load' + k, 652, f.L.laneY[k] + 31, 'load ' + (c.queue.length + (c.run ? 1 : 0)), 'p05val', 14)));
        tr.moves.filter((m) => m.t === t).forEach((m, i) => {
          const y1 = f.L.laneY[m.from] + 26, y2 = f.L.laneY[m.to] + 26, x = 744 + i * 26;
          f.items.push({ key: 'mv' + i, kind: 'wire', pts: [[716, y1], [x, y1], [x, y2], [716, y2]], head: true, cls: 'p05back' });
          f.items.push(P.text('mvL' + i, x + 8, (y1 + y2) / 2 + 5, (m.why.startsWith('push') ? 'push ' : 'pull ') + m.job, 'p05backt', 13));
        });
        if (f.end) f.items.push(...Q.coreTable(tr, 0, f.gy + 10).items);
        const iw = idleWhileWaiting(f.end ? tr.end : t);
        const meta = { phase: f.end ? 'end' : 'tick', t, step: f.st, moves: tr.moves.filter((m) => m.t === t), idleWait: iw };
        let say = P.clean(f.st.say);
        if (f.end) { meta.metrics = tr.metrics; meta.perCore = tr.perCore; meta.nMoves = tr.moves.length; say = `Every job has finished at t = ${tr.end}, after ${P.s(tr.moves.length, 'move')} between queues. A core sat idle while a job waited in another core's queue for ${P.s(iw, 'core-tick')}. ` + tr.perCore.map((c) => `Core ${c.id} ${Math.round(100 * c.util)}% busy`).join(', ') + '.'; }
        frames.push({ items: f.items, say, meta, title: f.end ? 'end' : meta.moves.length ? 'move' : 't = ' + t });
      }
      return { frames, def: P.def(['Load', 'A core\'s load here is the jobs in its queue plus the one it is running.'], ['Pull (work stealing)', 'A core whose own queue is empty takes the job at the back of the longest other queue that may run on it.'], ['Push', 'Every n ticks a balancer compares loads and moves jobs, one at a time from the back of the busiest queue, until no two loads differ by 2 or more.'], ['The cost', 'Every move sends a job to a core whose cache does not hold its data, so balancing too eagerly costs as much as it gains.']) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'tick' && i === 0, pick: 'option', ask: 'Will some core sit idle while a job waits in another core\'s queue?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.idleWait > 0 ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Core 0 has an empty queue and core 1 has three jobs waiting. With pulling, what happens?', options: ['Core 0 takes a job from core 1\'s queue', 'Core 1 sends all three to core 0', 'Nothing until the next balance', 'Core 0 sleeps'], answer: 0, why: 'An idle core steals work.' },
      { q: 'Loads 5 and 1, and the balancer moves jobs while loads differ by 2 or more. How many jobs move?', options: ['2', '1', '4', '3'], answer: 0, why: '5/1 → 4/2 → 3/3.' },
      { q: 'Why not balance at every tick?', options: ['Every move costs a cold cache, and checking loads costs time', 'It is forbidden', 'It starves jobs', 'Loads cannot be measured'], answer: 0, why: 'Balancing has a price.' },
      { q: 'Which of push and pull reacts the moment a core runs dry?', options: ['pull', 'push', 'both equally', 'neither'], answer: 0, why: 'Pull runs when the core finds its queue empty; push waits for its period.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'mc-affinity', family: 'p06-multi', order: 30, title: 'Affinity and cache warmth',
    blurb: 'A job that has been running on a core has its data in that core\'s cache. If it next runs on another core it starts cold: here it first spends a few ticks warming the new cache before its work moves on. Each job\'s lane is coloured by the core it ran on, warming time hatched. A shared queue scatters jobs across cores; per-core queues keep them home (soft affinity); a job can also be pinned to chosen cores with aff= (hard affinity).',
    inputs: coreInputs('A 0 6\nB 0 6\nC 0 6\nD 1 3 (2) 3'),
    presets: [
      { label: 'A shared queue: jobs wander', values: { mode: 'shared', migrate: 2 } },
      { label: 'Per-core queues: jobs stay home', values: { mode: 'per-core', migrate: 2 } },
      { label: 'Pinned: A and B on core 0 only', values: { mode: 'shared', migrate: 2, work: 'A 0 6 aff=0\nB 0 6 aff=0\nC 0 6\nD 1 3 (2) 3' } },
      { label: 'Free migration', values: { mode: 'shared', migrate: 0 } },
    ].map((p) => ({ label: p.label, values: Object.assign({ migrate: 2 }, p.values) })),
    run(inp) {
      const tr = runMulti(inp), jobs = tr.jobs.map((j) => j.id), n = tr.params.cores, frames = [];
      for (const t of Q.moments(tr)) {
        const f = frame(tr, t, { noGantt: true });
        // each job's lane, coloured by the core it ran on
        const ly = f.gy + 30, per = (P.W_ - 70) / tr.end, X = (u) => Math.round((70 + u * per) * 10) / 10;
        f.items.push(P.text('jlT', 0, ly - 10, 'where each job ran (colour: the core; hatched: warming a cold cache)', 'glabel', 14));
        tr.jobs.forEach((j, k) => {
          const y = ly + k * 32;
          f.items.push(P.text('jl' + j.id, 60, y + 18, j.id, 'glname', 14, 'end'));
          f.items.push(...G().track({ prefix: 'jt' + j.id, x: 70, y, w: P.W_ - 70, h: 26 }));
          tr.segs.filter((s) => s.job === j.id && !s.cs && (f.end || s.start < t)).forEach((s, i) => {
            const e = f.end ? s.end : Math.min(s.end, t), w = X(e) - X(s.start), lab = 'c' + s.core;
            f.items.push({ key: 'js' + j.id + s.start, kind: 'cell', x: X(s.start), y, w: Math.round(w * 10) / 10, h: 26, text: !s.warm && w > S.geom.textWidth(lab, 13) + 6 ? lab : '', size: 13, cls: 'p06c' + (s.core % 4) + (s.warm ? ' p06warm' : '') });
          });
        });
        if (f.end) {
          const rows = tr.jobs.map((j) => { const m = tr.migrations.filter((x) => x.job === j.id).length, w = tr.segs.filter((s) => s.job === j.id && s.warm).reduce((a, s) => a + s.end - s.start, 0); return { key: j.id, cells: [{ text: j.id, cls: P.pcls(jobs, j.id) }, String(m), String(w), String(tr.metrics.rows.find((r) => r.id === j.id).finish)] }; });
          f.items.push(...G().table({ prefix: 'mt', x: 0, y: ly + tr.jobs.length * 32 + 20, cols: [{ w: 60, label: 'job' }, { w: 120, label: 'migrations' }, { w: 120, label: 'warming' }, { w: 90, label: 'finish' }], rows, rowH: 28, size: 14 }).items);
        }
        const warm = tr.segs.filter((s) => s.warm && (f.end || s.start < t)).reduce((a, s) => a + Math.min(s.end, f.end ? s.end : t) - s.start, 0);
        const meta = { phase: f.end ? 'end' : 'tick', t, step: f.st, warm, migrations: f.st.migrations };
        let say = P.clean(f.st.say);
        if (f.end) { meta.mig = tr.migrations.length; meta.metrics = tr.metrics; say = `Every job has finished at t = ${tr.end}. Jobs started on a new core ${P.s(tr.migrations.length, 'time')} and spent ${P.s(warm, 'tick')} warming caches in all; average turnaround ${P.f(tr.metrics.avg.turnaround)}.`; }
        frames.push({ items: f.items, say, meta, title: f.end ? 'end' : 't = ' + t });
      }
      return { frames, def: P.def(['Cache warmth', 'A core\'s caches hold the data its recent jobs used. A job that moves must fetch its working set again, which here costs a fixed number of ticks before its work moves on.'], ['Affinity', ['soft: the scheduler prefers the core a job last ran on (per-core queues do this)', 'hard: a job may run only on the cores listed (aff=0 or aff=0|1 here)']]) };
    },
    predict: [{ at: (f, i) => f.meta.phase === 'tick' && i === 0, pick: 'option', ask: 'How many ticks will the jobs spend warming caches in all?', options: (fr) => { const w = fr[fr.length - 1].meta.warm; return [...new Set([0, w, w + 2, w + 4, Math.max(0, w - 2)])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[fr.length - 1].meta.warm), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Why does moving a job to another core cost time?', options: ['Its data is in the old core\'s cache, so the new core must fetch it again', 'The job must be recompiled', 'The core has to reboot', 'It costs nothing'], answer: 0, why: 'The new cache starts cold.' },
      { q: 'What is soft affinity?', options: ['Preferring to run a job on the core it last ran on', 'Forbidding a job some cores', 'Giving a job more tickets', 'Lowering a job\'s priority'], answer: 0, why: 'Hard affinity is the forbidding kind.' },
      { q: 'Which queue design gives soft affinity naturally?', options: ['per-core queues', 'one shared queue', 'a lottery', 'FCFS'], answer: 0, why: 'A job stays in its core\'s queue.' },
      { q: 'A job pinned to core 0 is ready while core 0 is busy and core 1 idles. What happens?', options: ['It waits for core 0', 'It runs on core 1', 'It is moved to I/O', 'It preempts core 0'], answer: 0, why: 'Hard affinity forbids core 1.' },
    ],
  });
  // the affinity topic needs the migration cost as an input too
  S.byId('mc-affinity').inputs.push({ id: 'migrate', kind: 'number', label: 'Warming a cold cache (ticks)', def: 2, min: 0, max: 4 });
})(globalThis.Proses = globalThis.Proses || {});
