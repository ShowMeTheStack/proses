// Part 5: a CFS-style fair scheduler. Every job carries a virtual runtime that grows by 1024 / weight per tick it
// runs, so heavy (low nice) jobs age slowly; the ready jobs sit in a red-black tree keyed by vruntime, and the
// leftmost runs next for a slice proportional to its weight. The tree is drawn with the tree kit, red and black
// nodes as the engine's snapshot has them, rebalancing as jobs come and go.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt, TK = () => S.Kit.tree;
  const CFS_WORK = 'A 0 10 nice=0\nB 0 10 nice=0\nC 1 8 nice=5\nD 2 2 (3) 2 (3) 2 nice=0\nE 3 6 nice=-5';

  /** the engine's tree snapshot as a tree-kit tree: filled in the job's colour, outlined red or black as the snapshot
   *  says; a lone (left) child gets an empty right slot so sides show */
  function kitTree(n, leftmost, jobs) {
    if (!n) return null;
    const node = { id: n.id, lines: [n.id, 'vr ' + n.v], cls: 'p05rb' + (jobs.indexOf(n.id) % 6) + ' ' + (n.red ? 'p05red' : 'p05black') + (n.id === leftmost ? ' act' : ''), kids: [], red: n.red };
    const l = kitTree(n.l, leftmost, jobs), r = kitTree(n.r, leftmost, jobs);
    if (l || r) node.kids = [l || { id: n.id + '_nl', lines: ['nil'], cls: 'p05nil', kids: [] }, r || { id: n.id + '_nr', lines: ['nil'], cls: 'p05nil', kids: [] }];
    return node;
  }
  /** each node of a snapshot: {id: {red, parent}} */
  const shape = (n, parent, out) => { out = out || {}; if (!n) return out; out[n.id] = { red: n.red, parent }; shape(n.l, n.id, out); shape(n.r, n.id, out); return out; };
  /** how the tree changed from one tick to the next: inserted, removed, recoloured and moved (a new parent) nodes */
  function rebalance(a, b) {
    const A = shape(a), B = shape(b), ins = Object.keys(B).filter((id) => !A[id]), rem = Object.keys(A).filter((id) => !B[id]);
    const kept = Object.keys(B).filter((id) => A[id]);
    const recol = kept.filter((id) => A[id].red !== B[id].red).sort(), moved = kept.filter((id) => A[id].parent !== B[id].parent && !rem.includes(A[id].parent)).sort();
    return { ins: ins.sort(), rem: rem.sort(), recol, moved, colour: Object.fromEntries(recol.map((id) => [id, B[id].red ? 'red' : 'black'])) };
  }
  const leftmostOf = (n) => { while (n && n.l) n = n.l; return n ? n.id : null; };
  const depth = (n) => (n ? 1 + Math.max(depth(n.l), depth(n.r)) : 0);

  S.topic({
    id: 'sch-cfs', family: 'p05-share', order: 30, title: 'A fair scheduler: vruntime and a red-black tree',
    blurb: 'A CFS-style scheduler keeps, for every job, a virtual runtime: the CPU it has had, scaled by its weight (nice 0 weighs 1024; each nice step is about 1.25 times lighter or heavier). The ready jobs sit in a red-black tree ordered by virtual runtime, and the leftmost, the one treated least fairly so far, runs next for a slice of the target latency in proportion to its weight. A job waking from I/O is placed near the smallest virtual runtime, so it runs soon without being owed a fortune.',
    inputs: [
      P.workInput(CFS_WORK),
      { id: 'lat', kind: 'number', label: 'Target latency (ticks)', def: 12, min: 4, max: 40 },
      { id: 'gran', kind: 'number', label: 'Minimum slice (ticks)', def: 2, min: 1, max: 8 },
      { id: 'credit', kind: 'choice', label: 'A waking job gets', def: 'yes', options: [{ value: 'yes', label: 'up to latency / 2 of credit' }, { value: 'no', label: 'no credit' }] },
    ],
    presets: [
      { label: 'Five jobs, nice −5 to 5', values: { work: CFS_WORK } },
      { label: 'Three equal jobs', values: { work: 'A 0 12\nB 0 12\nC 0 12' } },
      { label: 'Nice −2, 0 and 3', values: { work: 'A 0 20 nice=-2\nB 0 20 nice=0\nC 0 20 nice=3' } },
      { label: 'A sleeper among hogs, no credit', values: { work: 'A 0 16\nB 0 16\nI 1 1 (4) 1 (4) 1 (4) 1', credit: 'no' } },
      { label: 'The same sleeper, with credit', values: { work: 'A 0 16\nB 0 16\nI 1 1 (4) 1 (4) 1 (4) 1', credit: 'yes' } },
    ],
    run(inp) {
      const work = P.work(inp.work), tr = Sch().cfs(work, { latency: inp.lat, minGran: inp.gran, sleeperCredit: inp.credit === 'yes' }), jobs = tr.jobs.map((j) => j.id), W = P.W_;
      const decide = tr.steps.map((s, t) => (s.kind === 'tick' && s.decision !== 'continue' && !(s.decision === 'idle' && t && tr.steps[t - 1].decision === 'idle') ? t : -1)).filter((t) => t >= 0);
      // the ticks at which the tree had to rebalance (a recolour or a rotation beyond the insert or removal itself)
      const reb = {};
      for (let t = 1; t < tr.steps.length; t++) { if (tr.steps[t].kind !== 'tick') continue; const r = rebalance(tr.steps[t - 1].tree, tr.steps[t].tree); if (r.recol.length || r.moved.length) reb[t] = r; }
      const rebTicks = Object.keys(reb).map(Number);
      const base = decide.length <= 22 ? decide : decide.slice(0, 14).concat(P.spread(decide.slice(14), 8));
      const ts = [...new Set(base.concat(rebTicks.filter((t) => !base.includes(t)).slice(0, 4)))].sort((a, b) => a - b).concat([tr.end]);
      const maxD = Math.max(1, ...tr.steps.map((s) => depth(s.tree)));
      const frames = [];
      let prev = -1;
      for (const t of ts) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, 4, t, end)];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: 50, label: 'CPU', final: end }).items);
        // the CPU and the slice
        items.push({ key: 'cpu', kind: 'cell', x: 0, y: 122, w: 230, h: 104, text: '', cls: 'gcpu', audit: 'group', layer: 'back' });
        items.push(P.text('cpuL', 10, 142, 'CPU', 'glname', 15));
        if (st.run) {
          const b = G().job('j:' + st.run, 14, 154, st.run, jobs, { w: 84, h: 44, cls: 'run' + (st.cs ? ' p05sw' : '') });
          b.lines = [st.run, 'vr ' + st.vr[st.run]]; b.size = 14;
          items.push(b);
          const sw = 110, frac = Math.min(1, st.ran / st.slice);
          items.push(P.text('slL', 110, 168, 'slice ' + st.slice, 'glabel', 14));
          items.push({ key: 'slT', kind: 'cell', x: 110, y: 176, w: sw, h: 16, text: '', cls: 'p05qoff' });
          if (frac > 0) items.push({ key: 'slF', kind: 'cell', x: 110, y: 176, w: Math.max(2, Math.round(sw * frac)), h: 16, text: '', cls: 'p05qon' });
          items.push(P.text('slR', 110, 214, st.ran + ' used', 'glabel', 14));
        } else items.push(P.text('cpuI', 115, 186, end ? 'all done' : 'idle', 'glabel', 14, 'middle'));
        // each job's weight and vruntime
        const rows = tr.jobs.map((j) => ({ key: j.id, cells: [{ text: j.id, cls: P.pcls(jobs, j.id) }, String(j.nice), String(Sch().weight(j.nice)), st.vr && st.vr[j.id] !== undefined ? String(st.vr[j.id]) : t < j.arrive ? '—' : 'done'], cls: j.id === st.run ? 'fresh' : '' }));
        items.push(...G().table({ prefix: 'vt', x: 0, y: 250, cols: [{ w: 50, label: 'job' }, { w: 56, label: 'nice' }, { w: 72, label: 'weight' }, { w: 92, label: 'vruntime' }], rows, rowH: 28, size: 14 }).items);
        items.push(P.text('minv', 0, 250 + 28 * (jobs.length + 1) + 26, 'min_vruntime ' + st.minV, 'p05val', 14));
        // the tree
        const tx0 = 300, tw = W - tx0;
        items.push(P.text('trT', tx0, 128, end ? 'the tree is empty' : 'ready jobs, a red-black tree by vruntime (leftmost runs next)', 'glabel', 14));
        const lm = leftmostOf(st.tree);
        const root = kitTree(st.tree, lm, jobs);
        if (root) {
          const bw = 82, bh = 44;
          TK().layout(root, { x: 0, y: 0, levelH: Math.min(80, 300 / Math.max(1, maxD)), boxW: bw, boxH: bh, gapX: 34 });
          const bd = TK().bounds(root, bw, bh), dx = tx0 + 26 + (tw - 26 - bd.w) / 2 - bd.x, dy = 152 + bh / 2;
          const shift = (n) => { n.x = Math.round(n.x + dx); n.y = Math.round(n.y + dy); for (const k of n.kids || []) shift(k); };
          shift(root);
          items.push(...TK().draw(root, { prefix: 'rb', boxW: bw, boxH: bh, size: 14 }).map((it) => (it.kind === 'state' && /p05nil/.test(it.cls) ? Object.assign(it, { w: 40, h: 24 }) : it)));
          // a corner badge with the node's colour as a letter, so red and black read in either theme
          const rb = reb[t];
          const badge = (n) => { if (n.red === undefined) return; items.push({ key: 'rbm:' + n.id, kind: 'cell', x: n.x - bw / 2 - 26, y: n.y - bh / 2, w: 22, h: 20, rx: 4, text: n.red ? 'R' : 'B', size: 13, cls: (n.red ? 'p05mR' : 'p05mB') + (rb && rb.recol.includes(n.id) ? ' p05mNew' : ''), audit: 'overlap-ok', layer: 'labels' }); for (const k of n.kids || []) badge(k); };
          badge(root);
        }
        const lgy = 152 + (maxD - 1) * Math.min(80, 300 / Math.max(1, maxD)) + 44 + 34;
        items.push({ key: 'lgR', kind: 'cell', x: tx0, y: lgy - 14, w: 22, h: 20, rx: 4, text: 'R', size: 13, cls: 'p05mR' }, P.text('lgRt', tx0 + 28, lgy, 'red node', 'glabel', 13));
        items.push({ key: 'lgB', kind: 'cell', x: tx0 + 110, y: lgy - 14, w: 22, h: 20, rx: 4, text: 'B', size: 13, cls: 'p05mB' }, P.text('lgBt', tx0 + 138, lgy, 'black node', 'glabel', 13));
        items.push(P.text('lgL', tx0 + 236, lgy, 'fill: the job · ringed: leftmost', 'glabel', 13));
        const fresh = P.finished(tr, prev, t);
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], decision: st.decision, step: st, vr: st.vr, minV: st.minV, slice: st.slice, ran: st.ran, leftmost: lm, rb: st.tree ? Sch().rbCheck(st.tree) : null, fresh };
        let say = P.clean(st.say);
        const rb = reb[t];
        if (rb && !end) {
          const what = rb.ins.length ? `inserting ${P.list(rb.ins)}` + (rb.rem.length ? ` and taking out ${P.list(rb.rem)}` : '') : rb.rem.length ? `taking out ${P.list(rb.rem)}` : 'this change';
          const parts = [];
          if (rb.moved.length) parts.push(`a rotation gave ${P.list(rb.moved)} ${rb.moved.length === 1 ? 'a new parent' : 'new parents'}`);
          if (rb.recol.length) parts.push(`${P.list(rb.recol.map((id) => id + ' turned ' + rb.colour[id]))}`);
          say += ` In the tree, ${what} left it out of balance, so it rebalanced: ${parts.join('; ')}.`;
          meta.rebalance = rb;
        }
        if (end) {
          const f = tr.fairness;
          meta.fair = f; meta.metrics = tr.metrics;
          say = `Every job has finished at t = ${tr.end}. While all competed (t = ${f.from} to ${f.to}) the CPU ticks they got were ` + tr.jobs.map((j) => `${j.id} ${f.got[j.id]}`).join(', ') + `; divided by their weights that gives a fairness index of ${P.f(f.jain)}.` + ` Average response ${P.f(tr.metrics.avg.response)}.`;
        }
        frames.push({ items, say, meta, title: end ? 'end' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
        prev = t;
      }
      P.markAsks(frames, 3);
      return { frames, def: P.def(['Weights and virtual runtime', ['weight(nice 0) = 1024; each nice step ≈ × 1.25', 'running one tick: vruntime += 1024 / weight']], ['Who runs, and for how long', ['the leftmost job in the tree (least vruntime)', 'period = max(latency, n × minimum slice)', 'slice = max(minimum, period × weight / Σ weights)']], ['Newcomers and sleepers', ['a new job starts at min_vruntime', 'a waking job: max(its vruntime, min_vruntime − latency / 2)', 'it preempts if it is more than 1 below the running job']], ['The tree', 'A red-black tree keeps itself roughly balanced: no red node has a red child, and every path down has the same number of black nodes, so finding, inserting and removing the leftmost take O(log n).']) };
    },
    predict: [P.askNext((id) => 'rb:n' + id, 'Before you step: which job in the tree runs next? Click it.')],
    quiz: [
      { q: 'A nice 0 job (weight 1024) runs 3 ticks. Its vruntime grows by…', options: ['3', '3072', '1', '0.33'], answer: 0, why: '3 × 1024 / 1024.' },
      { q: 'A job of weight 2048 runs 4 ticks. Its vruntime grows by…', options: ['2', '4', '8', '0.5'], answer: 0, why: '4 × 1024 / 2048.' },
      { q: 'Which ready job runs next?', options: ['the one with the least vruntime, leftmost in the tree', 'the root of the tree', 'the one with the most tickets', 'the newest'], answer: 0, why: 'Least vruntime means least served, relative to its weight.' },
      { q: 'Latency 12, three ready jobs of weights 1024, 1024 and 2048. The heavy job\'s slice is…', options: ['6', '4', '3', '12'], answer: 0, why: '12 × 2048 / 4096.' },
      { q: 'Why not let a job that slept for a long time keep its old, small vruntime?', options: ['It would then monopolise the CPU until it caught up', 'It would be lost from the tree', 'Red-black trees cannot hold it', 'It would starve'], answer: 0, why: 'It is placed near min_vruntime instead, with at most a small credit.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
