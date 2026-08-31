// Part 5: priority scheduling with starvation and aging, round robin, and the choice of quantum. Priority draws a
// ladder, one rung per priority number, with each waiting job on the rung of its current (aged) priority; round
// robin draws the queue with the arrow from the CPU back to its tail and the quantum ticking down; the quantum topic
// sweeps the quantum and plots the averages and the number of switches against it.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt, C = () => S.Kit.curve;

  /** the tick each ready job joined the ready queue, at every step (the start of its current run in the queue) */
  P.since = function (tr) {
    const out = [], cur = {};
    tr.steps.forEach((st, t) => {
      const rd = new Set(st.ready || []), m = {};
      for (const id of rd) { if (cur[id] === undefined) cur[id] = t; m[id] = cur[id]; }
      for (const id of Object.keys(cur)) if (!rd.has(id)) delete cur[id];
      out.push(m);
    });
    return out;
  };
  /** a job's priority after aging (the rule of the engine's prio policy, for the picture) */
  P.aged = (prio, waited, age) => (age > 0 ? Math.max(Math.min(0, prio), prio - Math.floor(waited / age)) : prio);

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-prio', family: 'p05-prio', order: 10, title: 'Priorities, starvation and aging',
    blurb: 'Each job has a priority number, lower meaning more urgent, and the most urgent ready job runs. Preemptive priority lets an urgent arrival take the CPU at once. A steady stream of urgent jobs can then keep a low-priority job waiting for ever: starvation. Aging fixes it by raising a job\'s priority the longer it waits. The ladder shows every waiting job on the rung of its current priority.',
    inputs: [
      P.workInput('L 0 6 prio=4\nA 0 3 prio=1\nB 2 3 prio=2\nC 4 3 prio=1\nD 6 3 prio=2\nE 8 3 prio=1'),
      { id: 'pre', kind: 'choice', label: 'Preemptive', def: 'yes', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }] },
      { id: 'age', kind: 'number', label: 'Aging: one step more urgent every n ticks waited (0: none)', def: 0, min: 0, max: 20 },
    ],
    presets: [
      { label: 'Starvation: urgent jobs keep coming', values: { work: 'L 0 6 prio=4\nA 0 3 prio=1\nB 2 3 prio=2\nC 4 3 prio=1\nD 6 3 prio=2\nE 8 3 prio=1', age: 0 } },
      { label: 'The same with aging every 2 ticks', values: { work: 'L 0 6 prio=4\nA 0 3 prio=1\nB 2 3 prio=2\nC 4 3 prio=1\nD 6 3 prio=2\nE 8 3 prio=1', age: 2 } },
      { label: 'Five jobs, preemptive', values: { work: 'A 0 6 prio=3\nB 2 3 prio=1\nC 4 7 prio=4\nD 5 2 prio=0\nE 8 4 prio=2', pre: 'yes' } },
      { label: 'Five jobs, not preemptive', values: { work: 'A 0 6 prio=3\nB 2 3 prio=1\nC 4 7 prio=4\nD 5 2 prio=0\nE 8 4 prio=2', pre: 'no' } },
      { label: 'Equal priorities: first come, first served', values: { work: 'A 0 4 prio=2\nB 1 3 prio=2\nC 2 2 prio=2' } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().run(work, 'prio', { preemptive: inp.pre === 'yes', age: inp.age }), jobs = tr.jobs.map((j) => j.id);
      const since = P.since(tr), maxP = Math.max(1, ...tr.jobs.map((j) => j.prio)), rungs = maxP + 1;
      const W = P.W_, ly = 128, rh = 36, rg = 6, lx = 150, ty = ly + rungs * (rh + rg) + 26;
      const prioOf = {};
      for (const j of tr.jobs) prioOf[j.id] = j.prio;
      const eff = (st, t) => { const o = {}; for (const id of st.ready || []) o[id] = P.aged(prioOf[id], t - since[t][id], inp.age); return o; };
      // the priority each running job was dispatched with (it keeps it while it runs)
      const runP = [];
      let cur = null;
      tr.steps.forEach((st, t) => {
        if (!st.run) { cur = null; runP.push(null); return; }
        if (['dispatch', 'preempt'].includes(st.decision) || cur === null) { const s0 = t > 0 && since[t - 1][st.run] !== undefined ? since[t - 1][st.run] : t; cur = P.aged(prioOf[st.run], t - s0, inp.age); }
        runP.push(cur);
      });
      const ts = P.moments(tr), frames = [];
      let prev = -1;
      for (const t of ts) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, 4, t, end)];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: 50, label: 'CPU', final: end }).items);
        const e = end ? {} : eff(st, t);
        for (let k = 0; k < rungs; k++) {
          const y = ly + k * (rh + rg);
          items.push({ key: 'rung' + k, kind: 'cell', x: lx, y, w: W - lx, h: rh, text: '', cls: 'glane' + (k === 0 ? ' top' : ''), audit: 'group', layer: 'back' });
          items.push(P.text('rl' + k, lx + 10, y + rh / 2 + 5, 'prio ' + k + (k === 0 ? ' (most urgent)' : ''), 'glabel', 14));
          let x = lx + (k === 0 ? 170 : 80);
          for (const id of (st.ready || []).filter((i) => e[i] === k)) {
            const w = t - since[t][id];
            const b = G().job('j:' + id, x, y + 2, id, jobs, { w: 86, h: rh - 4 });
            b.text = id + (e[id] !== prioOf[id] ? ' (was ' + prioOf[id] + ')' : '') ; b.size = 14;
            items.push(b);
            items.push(P.text('jw:' + id, x + 92, y + rh / 2 + 5, 'waited ' + w, w >= 6 ? 'hot' : 'glabel', 14));
            x += 180;
          }
        }
        // the CPU
        items.push({ key: 'cpu', kind: 'cell', x: 0, y: ly, w: 120, h: 2 * rh + rg, text: '', cls: 'gcpu', audit: 'group', layer: 'back' });
        items.push(P.text('cpuL', 10, ly + 20, 'CPU', 'glname', 15));
        if (st.run) { const b = G().job('j:' + st.run, 18, ly + 30, st.run, jobs, { w: 84, h: 40, cls: 'run' }); b.lines = [st.run, 'prio ' + runP[t] + (runP[t] !== prioOf[st.run] ? ' (was ' + prioOf[st.run] + ')' : '')]; b.w = runP[t] !== prioOf[st.run] ? 104 : 84; b.x = runP[t] !== prioOf[st.run] ? 8 : 18; b.size = 14; items.push(b); }
        else items.push(P.text('cpuI', 60, ly + 56, end ? 'done' : 'idle', 'glabel', 14, 'middle'));
        const fresh = P.finished(tr, prev, t);
        items.push(...P.table({ tr, t, x: 0, y: ty, final: end, cols: 'short', fresh: end ? [] : fresh, mark: end ? { waiting: tr.metrics.rows.slice().sort((a, b) => b.waiting - a.waiting)[0].id } : null }).items);
        const worst = tr.metrics.rows.slice().sort((a, b) => b.waiting - a.waiting)[0];
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], decision: st.decision, step: st, eff: e, runPrio: st.run ? runP[t] : null, waited: Object.fromEntries((st.ready || []).map((id) => [id, t - since[t][id]])), prio: prioOf };
        let say = P.clean(st.say);
        if (end) { meta.worst = worst; meta.metrics = tr.metrics; say = `Every job has finished at t = ${tr.end}. ${worst.id} waited longest, ${worst.waiting} ticks` + (inp.age ? `; aging lifted it one step for every ${inp.age} ticks it waited.` : tr.jobs.find((j) => j.id === worst.id).prio === maxP ? ', the price of the least urgent priority: with no aging nothing limits how long it waits.' : '.') + ` Average waiting ${P.f(tr.metrics.avg.waiting)}.`; }
        frames.push({ items, say, meta, title: end ? 'end' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
        prev = t;
      }
      P.markAsks(frames, 3);
      return { frames, def: P.def(['The rule', 'The ready job with the lowest priority number runs. Non-preemptive: it keeps the CPU until its burst ends. Preemptive: a job that becomes ready with a strictly more urgent priority takes the CPU at once. ' + Sch().TIES], ['Starvation', 'A job of low priority may wait indefinitely while more urgent jobs keep arriving.'], ['Aging', ['effective priority = base − ⌊waited / n⌋, never below 0', 'waited: ticks since the job last joined the ready queue', 'a running job keeps the priority it was dispatched with']]) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'Priorities 3 (A) and 1 (B) are ready, lower is more urgent. Which runs?', options: ['B', 'A', 'whichever arrived first', 'both, in turn'], answer: 0, why: '1 is more urgent than 3.' },
      { q: 'What is starvation?', options: ['A ready job waits indefinitely because others are always preferred', 'A job runs out of memory', 'A deadlock between two jobs', 'The CPU idles'], answer: 0, why: 'It is ready, yet never chosen.' },
      { q: 'Aging every 2 ticks: a job of priority 4 has waited 5 ticks. Its effective priority is…', options: ['2', '4', '1', '3'], answer: 0, why: '4 − ⌊5 / 2⌋ = 2.' },
      { q: 'With all priorities equal, priority scheduling behaves like…', options: ['FCFS', 'SJF', 'round robin', 'lottery'], answer: 0, why: 'Ties go to the job that waited longest.' },
      { q: 'Preemptive priority: B (priority 1) arrives while A (priority 2) runs. What happens?', options: ['B takes the CPU; A goes back to the ready queue', 'A finishes first', 'B waits for A\'s quantum', 'Both run'], answer: 0, why: 'B is strictly more urgent.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-rr', family: 'p05-prio', order: 20, title: 'Round robin',
    blurb: 'Round robin gives each ready job the CPU for at most one quantum, then sends it to the back of the ready queue and takes the next. Every job gets a turn within (n − 1) quanta, so response is good and nobody starves; the price is a context switch at every turn. The arrow from the CPU back to the tail of the queue is the whole policy.',
    inputs: [P.workInput(P.W.mixed), { id: 'q', kind: 'number', label: 'Quantum (ticks)', def: 2, min: 1, max: 12 }, { id: 'cs', kind: 'number', label: 'Context switch (ticks)', def: 0, min: 0, max: 3 }],
    presets: [
      { label: 'Five jobs, quantum 2', values: { work: P.W.mixed, q: 2 } },
      { label: 'Four equal jobs, quantum 1', values: { work: P.W.same, q: 1 } },
      { label: 'Four equal jobs, quantum 4: FCFS again', values: { work: P.W.same, q: 4 } },
      { label: 'Quantum 2, switches cost 1', values: { work: P.W.mixed, q: 2, cs: 1 } },
      { label: 'With I/O', values: { work: P.W.io, q: 3 } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().run(work, 'rr', { quantum: inp.q, cs: inp.cs }), jobs = tr.jobs.map((j) => j.id), q = tr.params.quantum;
      const used = []; // ticks of the current quantum used before each tick
      let run = null, n = 0;
      tr.steps.forEach((st, t) => { if (st.run !== run || ['dispatch', 'preempt', 'renew'].includes(st.decision)) n = 0; run = st.run; used[t] = n; if (st.run && !st.cs) n++; });
      const frames = P.scene({
        tr, tableY: 252,
        keep: (st) => st.decision === 'renew',
        runSub: (st, t) => (st.run ? (st.cs ? 'switching' : 'tick ' + (used[t] + 1) + ' of ' + q) : null),
        extra: (st, t, L) => {
          if (L.end) return [];
          const items = [];
          // the quantum: q cells, the ticks used so far filled
          const cw = Math.min(26, Math.floor(150 / q));
          items.push(P.text('qL', 0, 214, 'quantum', 'glabel', 14));
          for (let k = 0; k < q; k++) items.push({ key: 'qc' + k, kind: 'cell', x: 70 + k * (cw + 3), y: 200, w: cw, h: 18, text: '', cls: k < used[t] + (st.run && !st.cs ? 1 : 0) ? 'p05qon' : 'p05qoff' });
          // the arrow from the CPU to the back of the queue: where the job sent back just went, or where the
          // running job will go if its quantum runs out
          const ex = tr.events.find((e) => e.kind === 'expire' && e.t === t);
          if (L.Q && (ex || st.run)) {
            const c = L.Q.cpuBox, cx = Math.round(c.x + c.w / 2), yb = L.qy + 44;
            const exBox = ex && L.Q.items.find((it) => it.key === 'j:' + ex.job);
            const tx = exBox ? Math.round(exBox.x + exBox.w / 2) : Math.round(L.Q.readyEnd + 10);
            items.push({ key: 'back', kind: 'wire', pts: [[cx, yb], [cx, yb + 16], [tx, yb + 16], [tx, yb]], head: true, cls: 'p05back' });
            items.push(P.text('backL', Math.max(tx, L.Q.readyEnd) + 12, yb + 21, exBox ? `${ex.job}'s quantum was up: back of the queue` : `if its quantum runs out, ${st.run} goes here`, 'p05backt', 13));
          }
          return items;
        },
        metaOf: (st, t) => ({ used: used[t], q }),
      });
      P.markAsks(frames, 3);
      return { frames, def: P.def(['The rule', 'The head of the ready queue runs for at most one quantum q. If its burst ends first it leaves (I/O or done); if the quantum runs out, it goes to the back of the queue. Jobs arriving at the same tick queue ahead of the job whose quantum just ran out. If no one else is ready, it simply runs on.'], ['Bounds', ['with n jobs ready, each waits at most (n − 1) × q for its next turn', 'q very large: FCFS', 'q very small: many switches; their cost dominates']]) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'Quantum 2; A needs 5 ticks and B 3, both ready at 0 (A first). Who runs from 4 to 6?', options: ['A', 'B', 'nobody', 'A and B'], answer: 0, why: 'A 0–2, B 2–4, A 4–6, B 6–7, A 7–8.' },
      { q: 'With 4 jobs ready and quantum 3, how long can a job wait for its next turn?', options: ['up to 9 ticks', 'up to 3 ticks', 'up to 12 ticks', 'without limit'], answer: 0, why: '(4 − 1) × 3.' },
      { q: 'If the quantum is longer than every burst, round robin becomes…', options: ['FCFS', 'SJF', 'priority', 'lottery'], answer: 0, why: 'No quantum ever runs out.' },
      { q: 'Why not make the quantum 1 tick?', options: ['Every tick would need a context switch, and switches cost time', 'Jobs would starve', 'The queue would overflow', 'It is not allowed'], answer: 0, why: 'Overhead grows as the quantum shrinks.' },
      { q: 'A job arrives at the same tick as another job\'s quantum ends. Who is ahead in the queue?', options: ['the arriving job', 'the job whose quantum ended', 'whichever has less left', 'it is random'], answer: 0, why: 'That is the tie rule here: arrivals first, then the job sent back.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const switches = (tr) => { const js = tr.segs.filter((s) => !s.cs).map((s) => s.job); let n = 0; for (let i = 1; i < js.length; i++) if (js[i] !== js[i - 1]) n++; return n; };
  S.topic({
    id: 'sch-quantum', family: 'p05-prio', order: 30, title: 'Choosing the quantum',
    blurb: 'The quantum trades response against overhead. A short quantum lets every job start soon, but switches the CPU often, and each switch costs time. A long one switches rarely but turns into FCFS, with its convoy. Here round robin runs the same workload once for each quantum, and the averages and the number of switches are plotted against it.',
    inputs: [P.workInput(P.W.mixed), { id: 'cs', kind: 'number', label: 'Context switch (ticks)', def: 1, min: 0, max: 3 }, { id: 'qmax', kind: 'number', label: 'Largest quantum to try', def: 8, min: 3, max: 12 }],
    presets: [
      { label: 'Five jobs, switches cost 1', values: { work: P.W.mixed, cs: 1 } },
      { label: 'Five jobs, free switches', values: { work: P.W.mixed, cs: 0 } },
      { label: 'Equal jobs, switches cost 2', values: { work: P.W.same, cs: 2, qmax: 6 } },
      { label: 'An editor among compute jobs', values: { work: P.W.editor, cs: 1, qmax: 12 } },
    ],
    run(inp) {
      const work = P.work(inp.work), qs = [];
      for (let q = 1; q <= inp.qmax; q++) qs.push(q);
      const trs = qs.map((q) => Sch().run(work, 'rr', { quantum: q, cs: inp.cs })), jobs = trs[0].jobs.map((j) => j.id);
      const pts = trs.map((tr, k) => ({ q: qs[k], T: tr.metrics.avg.turnaround, W: tr.metrics.avg.waiting, R: tr.metrics.avg.response, sw: switches(tr), over: tr.metrics.overhead, end: tr.end }));
      const hiT = Math.max(...pts.map((p) => p.T)) * 1.1, hiS = Math.max(1, ...pts.map((p) => p.sw)) * 1.15, Tmax = Math.max(...trs.map((tr) => tr.end));
      const a1 = C().axes({ prefix: 'a1', x: 50, y: 30, w: 330, h: 210, xr: [0.5, inp.qmax + 0.5], yr: [0, hiT], xticks: inp.qmax > 8 ? 2 : 1, xname: 'quantum', yname: 'average, ticks', tickSize: 13 });
      const a2 = C().axes({ prefix: 'a2', x: 480, y: 30, w: 300, h: 210, xr: [0.5, inp.qmax + 0.5], yr: [0, hiS], xticks: inp.qmax > 8 ? 2 : 1, xname: 'quantum', yname: 'context switches', tickSize: 13 });
      const frames = [];
      const draw = (k) => {
        const items = [...a1.items, ...a2.items], sh = pts.slice(0, k + 1);
        const series = [['T', 'turnaround', 'c0'], ['W', 'waiting', 'c1'], ['R', 'response', 'c2']];
        for (const [f, , cls] of series) { if (sh.length > 1) items.push(C().line(a1, 'l' + f, sh.map((p) => [p.q, p[f]]), cls)); sh.forEach((p, i) => items.push(Object.assign(C().dot(a1, 'd' + f + i, p.q, p[f], cls), { audit: 'overlap-ok', point: false }))); }
        if (sh.length > 1) items.push(C().line(a2, 'ls', sh.map((p) => [p.q, p.sw]), 'act'));
        sh.forEach((p, i) => items.push(Object.assign(C().dot(a2, 'ds' + i, p.q, p.sw, ''), { audit: 'overlap-ok', point: false })));
        items.push(C().vline(a1, 'v1', qs[k], 'act'), C().vline(a2, 'v2', qs[k], 'act'));
        items.push(...C().legend('lg', 50, 312, series.map(([, t, cls]) => ({ text: 'average ' + t, cls }))));
        const tr = trs[k];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t: tr.end, x0: P.X0 + 40, x1: P.W_, y: 362, final: true, label: 'q = ' + qs[k], T: Tmax }).items);
        return items;
      };
      qs.forEach((q, k) => {
        const p = pts[k];
        frames.push({ items: draw(k), say: `Quantum ${q}: average turnaround ${P.f(p.T)}, waiting ${P.f(p.W)}, response ${P.f(p.R)}; the CPU switched jobs ${P.s(p.sw, 'time')}` + (inp.cs ? `, losing ${p.over} ticks to switching, and everything ended at t = ${p.end}.` : ', for free here.'), meta: { phase: 'q', k, p, cs: inp.cs }, title: 'q = ' + q });
      });
      const bestT = pts.reduce((a, b) => (b.T < a.T ? b : a)), bestR = pts.reduce((a, b) => (b.R < a.R ? b : a));
      const longest = Math.max(...trs[0].jobs.flatMap((j) => j.bursts.filter((_, i) => i % 2 === 0)));
      const items = draw(pts.indexOf(bestT));
      frames.push({ items, say: `The least average turnaround, ${P.f(bestT.T)}, comes at quantum ${bestT.q}; the least average response, ${P.f(bestR.R)}, at quantum ${bestR.q}. From quantum ${longest} on, no burst is ever cut, so round robin runs exactly as FCFS.`, meta: { phase: 'best', bestT, bestR, longest }, title: 'best' });
      return { frames, def: P.def(['The trade', ['small q: quick response, many switches', 'large q: few switches, FCFS behaviour', 'q ≥ the longest burst: exactly FCFS']], ['A rule of thumb', 'Choose the quantum so that most CPU bursts finish within one quantum, and so that a switch costs only a small fraction of a quantum.']) };
    },
    predict: [
      { at: (f, i) => f.meta.phase === 'q' && f.meta.k === 0, pick: 'option', ask: 'As the quantum grows, will the number of context switches mostly rise or fall?', options: ['fall', 'rise', 'stay the same'], answer: (fr) => { const q = fr.filter((f) => f.meta.phase === 'q'); return q[q.length - 1].meta.p.sw < q[0].meta.p.sw ? 'fall' : q[q.length - 1].meta.p.sw > q[0].meta.p.sw ? 'rise' : 'stay the same'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Switches cost 1 tick, the quantum is 1, and several jobs are ready. What share of the time is useful work?', options: ['half', 'all of it', 'a quarter', 'none'], answer: 0, why: 'Each tick of work is followed by a tick of switching to the next job.' },
      { q: 'The quantum is longer than every CPU burst. Round robin then behaves like…', options: ['FCFS', 'SRTN', 'SJF', 'priority'], answer: 0, why: 'No job is ever cut off.' },
      { q: 'What does a very small quantum improve?', options: ['response time', 'throughput', 'context-switch overhead', 'cache warmth'], answer: 0, why: 'Every job gets the CPU soon after arriving.' },
      { q: 'A good quantum is…', options: ['longer than most CPU bursts, but far longer than a switch', 'always 1 tick', 'equal to the longest job', 'zero'], answer: 0, why: 'Most bursts then finish in one turn and switching stays cheap.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
