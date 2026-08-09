// The Scheduler lab, part one: the setup and the runs. S.SchedLab (SL) holds what the other parts share:
//   SL.POLICIES [{value, label, short}]           the policies a slot can hold
//   SL.fields, SL.presets                          the setup panel (registered in lab-scheduler-e.js)
//   SL.jobs(rows) -> the engine's workload         SL.tasks(rows), SL.piTasks(rows) for real time and inversion
//   SL.slots(v) -> [{k, pol, q, age}]              the policies chosen, in slot order
//   SL.runOne(pol, v, seed, o) -> trace            one policy through S.Sched, with the setup's parameters
//   SL.name(slot, v) -> 'RR, q = 2'                a policy's name with its parameters
//   SL.flags(tr, v) -> {starve: [..], convoy: [..]} starvation and convoy episodes read from a trace
//   SL.check(v) -> 'why not' | null
// Every number the lab shows comes from the S.Sched traces; this file only turns the setup into engine calls.
(function (S) {
  'use strict';
  const SL = (S.SchedLab = S.SchedLab || {});
  const Sch = () => S.Sched;

  SL.POLICIES = [
    { value: 'fcfs', label: 'FCFS', short: 'FCFS' },
    { value: 'sjf', label: 'SJF, bursts known', short: 'SJF' },
    { value: 'sjfp', label: 'SJF, bursts predicted', short: 'SJF predicted' },
    { value: 'srtn', label: 'SRTN, bursts known', short: 'SRTN' },
    { value: 'srtnp', label: 'SRTN, bursts predicted', short: 'SRTN predicted' },
    { value: 'prio', label: 'Priority, non-preemptive', short: 'Priority' },
    { value: 'priop', label: 'Priority, preemptive', short: 'Priority, preemptive' },
    { value: 'rr', label: 'Round robin', short: 'RR' },
    { value: 'mlq', label: 'Multilevel queue', short: 'MLQ' },
    { value: 'mlfq', label: 'MLFQ', short: 'MLFQ' },
    { value: 'mlfqr', label: 'MLFQ, allotment reset by I/O', short: 'MLFQ, reset by I/O' },
    { value: 'lottery', label: 'Lottery', short: 'Lottery' },
    { value: 'stride', label: 'Stride', short: 'Stride' },
    { value: 'cfs', label: 'CFS', short: 'CFS' },
    { value: 'multi', label: 'Multicore, one shared queue', short: 'Multicore, shared queue' },
    { value: 'multip', label: 'Multicore, a queue per core', short: 'Multicore, per-core queues' },
  ];
  SL.QPOL = ['rr', 'lottery', 'stride', 'multi', 'multip'];
  SL.PRIO = ['prio', 'priop'];
  SL.SLOTS = 4;
  const NONE = { value: 'none', label: '— none —', short: '' };
  SL.polLabel = (p) => (SL.POLICIES.find((x) => x.value === p) || NONE).short;

  // ---- the workload --------------------------------------------------------------------------------------------
  SL.WORK = [
    { id: 'A', arrive: 0, bursts: [8], prio: 3, tickets: 100, nice: 0, cls: 2, cores: 'all' },
    { id: 'B', arrive: 1, bursts: [2, 3, 2], prio: 1, tickets: 200, nice: -2, cls: 1, cores: 'all' },
    { id: 'C', arrive: 2, bursts: [3], prio: 2, tickets: 100, nice: 0, cls: 1, cores: 'all' },
    { id: 'D', arrive: 3, bursts: [1, 2, 1], prio: 0, tickets: 300, nice: -4, cls: 0, cores: 'all' },
    { id: 'E', arrive: 5, bursts: [4], prio: 4, tickets: 100, nice: 2, cls: 2, cores: 'all' },
  ];
  const row = (id, arrive, bursts, more) => Object.assign({ id, arrive, bursts, prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' }, more || {});
  SL.row = row;
  SL.jobs = (rows) => (rows || []).map((r) => ({ id: r.id, arrive: r.arrive, bursts: r.bursts.slice(), prio: r.prio, tickets: r.tickets, nice: r.nice, cls: r.cls, affinity: !r.cores || r.cores === 'all' ? null : String(r.cores).trim().split(/\s+/).map(Number) }));
  SL.cpuOf = (r) => r.bursts.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);

  SL.TASKS = [{ id: 'A', C: 1, T: 4, D: 4, phase: 0 }, { id: 'B', C: 2, T: 6, D: 6, phase: 0 }, { id: 'C', C: 3, T: 12, D: 12, phase: 0 }];
  SL.tasks = (rows) => (rows || []).map((r) => ({ id: r.id, C: r.C, T: r.T, D: r.D, phase: r.phase || 0 }));

  SL.PITASKS = [
    { id: 'L', prio: 3, arrive: 0, script: '1 +m 4 -m 1' },
    { id: 'H', prio: 1, arrive: 3, script: '1 +m 2 -m 1' },
    { id: 'M', prio: 2, arrive: 4, script: '6' },
  ];
  /** '1 +m 4 -m 1' -> [['run', 1], ['lock', 'm'], ['run', 4], ['unlock', 'm'], ['run', 1]] */
  SL.parseScript = function (text) {
    const out = [];
    for (const w of String(text || '').trim().split(/[\s,]+/).filter(Boolean)) {
      if (/^\d+$/.test(w)) { if (+w < 1 || +w > 20) return { error: 'each run is 1 to 20 ticks' }; out.push(['run', +w]); }
      else if (/^[+-][a-z][a-z0-9]{0,3}$/i.test(w)) out.push([w[0] === '+' ? 'lock' : 'unlock', w.slice(1)]);
      else return { error: '"' + w + '" is not a run (a number), a lock (+m) or an unlock (−m)' };
    }
    if (!out.some((o) => o[0] === 'run')) return { error: 'the script needs at least one run' };
    const held = [];
    for (const o of out) {
      if (o[0] === 'lock') { if (held.includes(o[1])) return { error: 'it locks ' + o[1] + ' twice' }; held.push(o[1]); }
      if (o[0] === 'unlock') { if (!held.includes(o[1])) return { error: 'it unlocks ' + o[1] + ' without holding it' }; held.splice(held.indexOf(o[1]), 1); }
    }
    if (held.length) return { error: 'it ends still holding ' + held.join(' and ') };
    return { value: out };
  };
  SL.piTasks = (rows) => (rows || []).map((r) => ({ id: r.id, prio: r.prio, arrive: r.arrive, script: SL.parseScript(r.script).value || [['run', 1]] }));
  SL.scriptText = (ops) => ops.map((o) => (o[0] === 'run' ? String(o[1]) : (o[0] === 'lock' ? '+' : '−') + o[1])).join(' ');

  // ---- the policies chosen and their runs -------------------------------------------------------------------------
  SL.slots = function (v) {
    const out = [];
    for (let k = 1; k <= SL.SLOTS; k++) {
      const pol = v['pol' + k];
      if (!pol || pol === 'none') continue;
      out.push({ k, pol, q: v['q' + k], age: v['a' + k] });
    }
    return out;
  };
  const uses = (v, list) => v.mode === 'compare' && SL.slots(v).some((s) => list.includes(s.pol));
  SL.uses = uses;

  SL.name = function (s, v) {
    const p = s.pol, f = (x) => String(+(+x).toFixed(2));
    if (p === 'rr') return 'RR, q = ' + s.q;
    if (p === 'lottery' || p === 'stride') return SL.polLabel(p) + ', q = ' + s.q;
    if (p === 'sjfp' || p === 'srtnp') return SL.polLabel(p) + ' (α ' + f(v.alpha) + ', τ₀ ' + v.tau0 + ')';
    if (SL.PRIO.includes(p)) return SL.polLabel(p) + (s.age ? ', aging every ' + s.age : ', no aging');
    if (p === 'mlfq' || p === 'mlfqr') return SL.polLabel(p) + ', ' + v.levels + ' levels' + (v.boost ? ', boost every ' + v.boost : ', no boost');
    if (p === 'mlq') return 'MLQ, ' + (v.mlqMode === 'share' ? 'shares ' + (v.classes || []).map((c) => c.share).join(':') : 'strict priority');
    if (p === 'multi' || p === 'multip') return v.cores + ' cores, ' + (p === 'multi' ? 'shared queue' : 'per-core queues') + ', q = ' + s.q;
    return SL.polLabel(p);
  };

  SL.mlfqParams = (v, reset) => ({ levels: v.levels, quantum: (v.mq || []).slice(0, v.levels), allot: (v.ma || []).slice(0, Math.max(0, v.levels - 1)), boost: v.boost, allotMode: reset ? 'reset-io' : 'level', preempt: v.mpre !== false, cs: v.cs });
  SL.mlqParams = (v) => ({ classes: (v.classes || []).map((c) => ({ name: c.name, policy: c.policy, quantum: c.quantum })), mode: v.mlqMode, shares: (v.classes || []).map((c) => c.share), window: v.window, cs: v.cs });

  /** one policy over the workload, with the setup's parameters; o.q overrides the slot's quantum (the sweep) */
  SL.runOne = function (s, v, seed, o) {
    o = o || {};
    const work = SL.jobs(v.work), q = o.q || s.q || 2, cs = v.cs || 0, p = s.pol;
    const pred = { alpha: v.alpha, tau0: v.tau0 };
    switch (p) {
      case 'fcfs': return Sch().run(work, 'fcfs', { cs });
      case 'sjf': return Sch().run(work, 'sjf', { cs });
      case 'sjfp': return Sch().run(work, 'sjf', { cs, predict: pred });
      case 'srtn': return Sch().run(work, 'srtn', { cs });
      case 'srtnp': return Sch().run(work, 'srtn', { cs, predict: pred });
      case 'prio': case 'priop': return Sch().run(work, 'prio', { cs, preemptive: p === 'priop', age: s.age || 0, ageFrom: v.ageFrom });
      case 'rr': return Sch().run(work, 'rr', { cs, quantum: q });
      case 'mlq': return Sch().mlq(work, SL.mlqParams(v));
      case 'mlfq': case 'mlfqr': return Sch().mlfq(work, SL.mlfqParams(v, p === 'mlfqr'));
      case 'lottery': return Sch().lottery(work, { quantum: q, seed, cs });
      case 'stride': return Sch().stride(work, { quantum: q, L: v.strideL, cs });
      case 'cfs': return Sch().cfs(work, { latency: v.lat, minGran: v.gran, wakeupGran: v.wake, sleeperCredit: v.credit !== false, cs });
      case 'multi': case 'multip': return Sch().multi(work, { cores: v.cores, queue: p === 'multi' ? 'shared' : 'per-core', quantum: q, push: v.push, pull: v.pull !== false, migrate: v.migrate, cs });
    }
    throw new Error('Unknown policy ' + p);
  };

  // ---- what a trace says about each job at each tick --------------------------------------------------------------
  /** the jobs on a CPU at step st (several on a multicore) */
  SL.running = (st) => (st.cores ? st.cores.map((c) => c.run).filter(Boolean) : st.run ? [st.run] : []);
  /** each job's state at each tick: 'run' | 'ready' | 'io' | 'none' | 'done' */
  SL.states = function (tr) {
    const out = {}, fin = {};
    for (const r of tr.metrics.rows) fin[r.id] = r.finish;
    for (const j of tr.jobs) out[j.id] = [];
    tr.steps.forEach((st, t) => {
      if (st.kind === 'end') return;
      const run = new Set(SL.running(st)), io = new Set((st.io || []).map((e) => e.id));
      for (const j of tr.jobs) out[j.id][t] = t < j.arrive ? 'none' : t >= fin[j.id] ? 'done' : run.has(j.id) ? 'run' : io.has(j.id) ? 'io' : 'ready';
    });
    return out;
  };
  /** CPU ticks each job has had before t (context-switch and warming time left out) */
  SL.ranBefore = function (tr, id, t) {
    let n = 0;
    for (const s of tr.segs) if (s.job === id && !s.cs && !s.warm) n += Math.max(0, Math.min(t, s.end) - s.start);
    return n;
  };
  /** what is left of a job's current CPU burst at tick t */
  SL.leftAt = function (tr, id, t) {
    const j = tr.jobs.find((x) => x.id === id);
    let ran = SL.ranBefore(tr, id, t);
    for (let k = 0; k < j.bursts.length; k += 2) { if (ran < j.bursts[k]) return j.bursts[k] - ran; ran -= j.bursts[k]; }
    return 0;
  };

  /**
   * Starvation: a job kept waiting in a ready queue for at least v.starve ticks in a row (the longest such wait of
   * each job, with the tick it reached the threshold). Convoy: a CPU stretch of one job, at least 4 ticks long, while
   * two or more other jobs wait whose CPU bursts left are each at most half of it.
   */
  SL.flags = function (tr, v) {
    const st = SL.states(tr), starve = [], convoy = [], lim = v.starve || 12;
    for (const j of tr.jobs) {
      let run = 0, best = null;
      st[j.id].forEach((s, t) => {
        run = s === 'ready' ? run + 1 : 0;
        if (run >= lim && (!best || run > best.ticks)) best = { job: j.id, ticks: run, at: best ? best.at : t + 1, from: t + 1 - run, to: t + 1 };
      });
      if (best) starve.push(best);
    }
    // on several cores a long run holds up only the jobs queued for its own core, so convoys are judged on one CPU
    if (tr.policy !== 'multi') for (const s of tr.segs) {
      if (s.cs || s.warm || s.end - s.start < 4) continue;
      const len = s.end - s.start, short = new Set();
      for (let t = s.start; t < s.end; t++) for (const j of tr.jobs) if (j.id !== s.job && st[j.id][t] === 'ready' && SL.leftAt(tr, j.id, t) * 2 <= len) short.add(j.id);
      if (short.size >= 2) convoy.push({ job: s.job, start: s.start, end: s.end, len, held: [...short].sort(), core: s.core });
    }
    return { starve, convoy };
  };

  // ---- the limits -----------------------------------------------------------------------------------------------
  SL.check = function (v) {
    const m = v.mode;
    if (m === 'compare' || m === 'sweep' || m === 'cfs' || m === 'lottery') {
      const w = v.work || [];
      const cpu = w.reduce((a, r) => a + SL.cpuOf(r), 0);
      if (cpu > 80) return 'Workload: at most 80 ticks of CPU in all, so the charts stay readable (this has ' + cpu + ')';
      const cores = m === 'compare' && uses(v, ['multi', 'multip']) ? v.cores : 0;
      for (const r of w) if (cores && r.cores !== 'all') { const c = String(r.cores).trim().split(/\s+/).map(Number); if (c.some((x) => x >= cores)) return 'Workload: ' + r.id + ' may run on core ' + Math.max(...c) + ', but there are ' + cores + ' cores (0 to ' + (cores - 1) + ')'; }
    }
    if (m === 'compare') {
      const sl = SL.slots(v);
      if (!sl.length) return 'Choose at least one policy';
      if (uses(v, ['mlfq', 'mlfqr'])) {
        if ((v.mq || []).length < v.levels) return 'MLFQ: give a quantum for each of the ' + v.levels + ' levels';
        if ((v.ma || []).length < v.levels - 1) return 'MLFQ: give an allotment for each level but the bottom one (' + (v.levels - 1) + ')';
        for (let k = 0; k < v.levels - 1; k++) if (v.ma[k] < v.mq[k]) return 'MLFQ: the allotment at Q' + k + ' (' + v.ma[k] + ') is less than its quantum (' + v.mq[k] + ')';
      }
      if (uses(v, ['mlq'])) {
        const top = Math.max(...v.work.map((r) => r.cls));
        if (top >= (v.classes || []).length) return 'Multilevel queue: a job is in class ' + top + ', but there are only ' + v.classes.length + ' classes (0 to ' + (v.classes.length - 1) + ')';
      }
    }
    if (m === 'sweep' && v.qmax < 2) return 'Sweep: at least two quanta';
    if (m === 'rt') {
      if (!v.rtRM && !v.rtEDF) return 'Real time: choose RM, EDF or both';
      for (const k of v.tasks || []) { if (k.C > k.D) return 'Task ' + k.id + ': its WCET ' + k.C + ' is longer than its deadline ' + k.D; if (k.C > k.T) return 'Task ' + k.id + ': its WCET ' + k.C + ' is longer than its period ' + k.T; }
      const A = Sch().rtAnalysis(SL.tasks(v.tasks));
      const H = v.horizon || A.hyper;
      if (H > 96) return 'Real time: the hyperperiod is ' + A.hyper + ' ticks; choose periods with a smaller least common multiple, or set a horizon of at most 96';
    }
    if (m === 'pi') {
      if (!v.piNone && !v.piInherit && !v.piCeiling) return 'Inversion: choose at least one protocol';
      for (const r of v.pitasks || []) { const p = SL.parseScript(r.script); if (p.error) return 'Task ' + r.id + ': ' + p.error; }
      const tr = Sch().inversion(SL.piTasks(v.pitasks), { protocol: 'none' });
      if (tr.end > 120) return 'Inversion: these scripts never finish (two tasks wait for each other’s mutex, or the run is longer than 120 ticks)';
    }
    return null;
  };
})(globalThis.Proses = globalThis.Proses || {});
