// The workspace of a 'sched-tune' challenge: the policy and its parameters on the left; on the right the visible
// sample workload run under them as it changes, a Gantt chart with a lane per job (context switches hatched) and
// the numbers the hidden workloads will be scored on.
(function (S) {
  'use strict';
  const KIND = () => S.Challenges.kinds['sched-tune'];
  const r2 = (v) => String(Math.round(v * 100) / 100);

  /** a Gantt chart in HTML: one lane per job, each segment placed by its ticks */
  function gantt(tr) {
    const { h } = S.UI;
    const end = Math.max(1, tr.end), ids = tr.jobs.map((j) => j.id);
    const pc = (t) => (100 * t / end).toFixed(3) + '%';
    const lanes = h('div.chg-lanes');
    tr.jobs.forEach((j, i) => {
      const track = h('div.chg-track');
      track.appendChild(h('span.chg-arrive', { style: { left: pc(j.arrive) }, title: j.id + ' arrives at t = ' + j.arrive }));
      // its I/O: the ticks it spends at its device, as outlined stretches
      let from = null;
      (tr.steps || []).forEach((st, n, all) => {
        const on = st.kind === 'tick' && (st.io || []).some((q) => q.id === j.id);
        if (on && from === null) from = st.t;
        const next = all[n + 1];
        if (from !== null && (!on || !next || next.kind !== 'tick' || !(next.io || []).some((q) => q.id === j.id))) { const to = on ? st.t + 1 : st.t; if (to > from) track.appendChild(h('span.chg-io', { style: { left: pc(from), width: pc(to - from) }, title: j.id + ' does I/O from ' + from + ' to ' + to })); from = null; }
      });
      for (const s of tr.segs) if (s.job === j.id) {
        const seg = h('span.chg-seg.p' + (i % 6) + (s.cs ? '.cs' : ''), { style: { left: pc(s.start), width: pc(s.end - s.start) }, title: j.id + (s.cs ? ': context switch' : ' runs') + ' from ' + s.start + ' to ' + s.end + (s.level !== undefined ? ' at level ' + s.level : '') + (s.core !== undefined ? ' on core ' + s.core : '') + (s.inst ? ' (job ' + s.inst + ')' : '') });
        if (!s.cs && s.end - s.start >= Math.max(2, end / 24) && s.level !== undefined) seg.textContent = 'Q' + s.level;
        else if (!s.cs && s.end - s.start >= Math.max(2, end / 24) && s.core !== undefined) seg.textContent = 'c' + s.core;
        track.appendChild(seg);
      }
      lanes.appendChild(h('div.chg-lane', h('span.chg-id.mono', j.id), track));
    });
    const step = end <= 20 ? 2 : end <= 50 ? 5 : 10, ticks = h('div.chg-ticks');
    for (let t = 0; t <= end; t += step) ticks.appendChild(h('span', { style: { left: pc(t) } }, String(t)));
    void ids;
    const key = h('div.chg-key', h('span', h('i.k-run'), 'runs'), h('span', h('i.k-cs'), 'context switch'), h('span', h('i.k-io'), 'I/O'), h('span', h('i.k-arr'), 'arrives'));
    return h('div.chg', lanes, h('div.chg-axis', h('span.chg-id'), ticks), key);
  }

  S.SchedTuneWorkspace = function (host, x, draft, onChange) {
    const { h } = S.UI, KIT = S.ChallengeKit, k = KIND();
    let a = Object.assign({}, k.start(x), draft || {});
    const mode = k.modeOf(x), allowed = (x.limits && x.limits.policies) || k.POLICIES[mode];
    const fields = {
      policy: KIT.select({ id: 'chPolicy', label: 'Policy', value: a.policy, options: allowed.map((p) => ({ value: p, label: k.NAMES[p] })), onChange: (v) => { a.policy = v; show(); changed(); } }),
      quantum: KIT.num({ id: 'chQuantum', label: 'Quantum (ticks)', value: a.quantum, min: 1, max: 50, onChange: (v) => { a.quantum = v; changed(); } }),
      preemptive: KIT.toggle({ id: 'chPreempt', label: 'Preemptive', value: a.preemptive, onChange: (v) => { a.preemptive = v; changed(); } }),
      age: KIT.num({ id: 'chAge', label: 'Aging step (ticks, 0: none)', value: a.age, min: 0, max: 50, onChange: (v) => { a.age = v; changed(); } }),
      levels: KIT.num({ id: 'chLevels', label: 'Levels', value: a.levels, min: 2, max: 6, onChange: (v) => { a.levels = v; changed(); } }),
      q0: KIT.num({ id: 'chQ0', label: 'Top quantum (doubles a level)', value: a.q0, min: 1, max: 50, onChange: (v) => { a.q0 = v; changed(); } }),
      allot: KIT.num({ id: 'chAllot', label: 'Top allotment (doubles a level)', value: a.allot, min: 1, max: 100, onChange: (v) => { a.allot = v; changed(); } }),
      boost: KIT.num({ id: 'chBoost', label: 'Boost every (ticks, 0: never)', value: a.boost, min: 0, max: 500, onChange: (v) => { a.boost = v; changed(); } }),
      queue: KIT.select({ id: 'chQueue', label: 'Ready queue', value: a.queue, options: ((x.limits && x.limits.queues) || ['shared', 'per-core']).map((q) => ({ value: q, label: q === 'shared' ? 'One shared by every core' : 'One per core' })), onChange: (v) => { a.queue = v; show(); changed(); } }),
      push: KIT.num({ id: 'chPush', label: 'Rebalance every (ticks, 0: never)', value: a.push, min: 0, max: 100, onChange: (v) => { a.push = v; changed(); } }),
      pull: KIT.toggle({ id: 'chPull', label: 'An idle core steals work', value: a.pull, onChange: (v) => { a.pull = v; changed(); } }),
    };
    const USES = { rr: ['quantum'], prio: ['preemptive', 'age'], mlfq: ['levels', 'q0', 'allot', 'boost'], multi: ['queue', 'quantum', 'push', 'pull'] };
    const uses = () => (USES[a.policy] || []).filter((id) => a.policy !== 'multi' || a.queue === 'per-core' || (id !== 'push' && id !== 'pull'));
    const form = h('div.chk-form', ...Object.values(fields).map((f) => f.el));
    const note = h('p.chk-note');
    const preview = h('div.chk-preview', { id: 'chPreview' });
    const nums = h('div.chk-nums', { id: 'chNums' });
    const err = h('div.chk-status.bad');
    host.appendChild(h('div.chk-grid',
      KIT.panel('Your scheduler', form, note),
      KIT.panel(mode === 'rt' ? 'On a sample task set' : 'On the sample workload', h('p.chk-sub', mode === 'rt' ? 'The hidden task sets are like this one, but you do not see them. A lane a task; each job is a run of its colour.' : 'The hidden workloads are like this one, but you do not see them.' + (mode === 'multi' ? ' ' + (x.cores || 2) + ' cores; c0, c1 say where a job ran.' : '') + ' Every switch costs ' + (x.cs || 0) + ' tick' + (x.cs === 1 ? '' : 's') + ' (hatched).'), preview, nums, err)));
    const sample = x.preview || (k.workloads(x)[0] || []);
    function show() {
      for (const [id, f] of Object.entries(fields)) if (id !== 'policy') f.el.style.display = uses().includes(id) ? '' : 'none';
      fields.policy.el.style.display = allowed.length > 1 ? '' : 'none';
      note.textContent = { fcfs: 'Each job runs its whole CPU burst in the order the jobs became ready.', prio: 'The lowest priority number runs first; aging lowers a waiting job\'s number by 1 every step ticks.', rr: 'Each job runs at most one quantum, then goes to the back of the queue.', mlfq: 'New jobs start at the top; a job that uses up its allotment sinks a level, where the quantum is twice as long. A boost lifts every job back to the top.', multi: 'Every core runs round robin with the quantum. With one shared queue a free core takes the next job; with a queue per core a job stays on its core unless the queues are rebalanced or an idle core steals it.', rm: 'The task with the shorter period always wins: fixed priorities.', edf: 'The job whose deadline comes first runs, whatever its task.' }[a.policy] || '';
    }
    function draw() {
      preview.innerHTML = ''; nums.innerHTML = ''; err.textContent = '';
      const probs = k.limitsProblems(Object.assign({}, x, { limits: Object.assign({}, x.limits, { minFair: 0 }) }), a);
      if (probs.length) { err.textContent = probs[0].replace(/^./, (c) => c.toUpperCase()) + '.'; return; }
      let tr;
      try { tr = k.simulate(sample, a, x.cs || 0, x); } catch (e) { err.textContent = String(e.message || e); return; }
      const cell = (label, v, cls) => h('div.chk-num' + (cls ? '.' + cls : ''), h('span', label), h('b.mono', v));
      if (mode === 'rt') {
        preview.appendChild(gantt({ jobs: sample.map((t) => ({ id: t.id, arrive: t.phase || 0 })), segs: tr.segs, end: tr.end, steps: [] }));
        const js = tr.jobs.filter((j) => j.response !== null && j.response !== undefined);
        nums.append(cell('deadline misses', String(tr.misses.length), tr.misses.length ? 'bad' : 'good'), cell('mean response', r2(js.length ? js.reduce((q, j) => q + j.response, 0) / js.length : 0)), cell('utilisation', r2(sample.reduce((q, t) => q + t.C / t.T, 0))));
        return;
      }
      preview.appendChild(gantt(tr));
      const avg = tr.metrics.avg, fair = k.fairness(tr);
      nums.append(cell('mean response', r2(avg.response)), cell('mean turnaround', r2(avg.turnaround)), mode === 'multi' ? cell('utilisation', r2(tr.metrics.util)) : cell('switch ticks', String(tr.metrics.overhead || 0)),
        cell('fairness', r2(fair), x.limits && x.limits.minFair ? (fair >= x.limits.minFair ? 'good' : 'bad') : ''));
    }
    const redraw = S.UI.debounce(draw, 60);
    function changed() { redraw(); if (onChange) onChange(); }
    show(); draw();
    return {
      get: () => {
        const out = { policy: a.policy };
        for (const id of uses()) out[id] = fields[id].get();
        return out;
      },
      load(v) { a = Object.assign({}, k.start(x), v || {}); for (const [id, f] of Object.entries(fields)) f.set(a[id]); show(); draw(); },
      redraw: draw,
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
