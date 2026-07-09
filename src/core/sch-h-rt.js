// CPU scheduling, part 8: real-time scheduling of periodic tasks.
//   S.Sched.rt(tasks, {policy: 'rm' | 'edf', horizon, onMiss: 'continue' | 'abort'}) -> trace
//   S.Sched.rtAnalysis(tasks) -> {U, n, bound, rmBound, rta: [..], rmExact, edfU, edfExact, hyper, demand}
// A task is {id, C, T, D, phase}: every T ticks from `phase` (default 0) it releases a job that needs C ticks of
// CPU by its deadline, D ticks after its release (default D = T). Jobs are named task + number: A1, A2, ...
// Scheduling is preemptive on one CPU:
//   rm   rate monotonic: the shorter a task's period, the higher its fixed priority (equal periods: the task listed
//        first);
//   edf  earliest deadline first: the job with the earliest absolute deadline runs (equal deadlines: the one
//        released first, then the task listed first).
// A running job is preempted only by a strictly better one. At a tick: deadlines that pass with work left are
// misses (onMiss 'continue', the default, lets the late job carry on; 'abort' drops it); then releases; then the pick.
// The trace: steps [{kind: 'tick', t, run (job name), task, ready: [{job, task, left, deadline}], released, missed,
// say}], events, segs [{job (task id), inst (job name), start, end}], jobs [{job, task, release, deadline, finish,
// response, missed}], misses [{job, task, t}], perTask [{id, released, done, missed, worst}], end, U, analysis.
// rtAnalysis: U = Σ C/T; the Liu–Layland bound n(2^(1/n) − 1) (U at or under it: RM is sure to meet every
// deadline); response-time analysis for RM, R = C_i + Σ_{higher j} ⌈R / T_j⌉ C_j iterated to a fixed point
// (rta [{id, R, ok, iterations: [..]}]; exact for D ≤ T and all phases 0); for EDF, U ≤ 1 when every D = T, and
// otherwise the processor-demand test: at every absolute deadline L up to the hyperperiod the demand
// Σ max(0, ⌊(L − D_i) / T_i⌋ + 1) C_i is at most L (exact for phases 0).
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  Sch.rtNorm = (tasks) => tasks.map((k, i) => ({ id: String(k.id || String.fromCharCode(65 + i)), idx: i, C: Math.max(1, Math.round(k.C)), T: Math.max(1, Math.round(k.T)), D: Math.max(1, Math.round(k.D === undefined ? k.T : k.D)), phase: Math.max(0, Math.round(k.phase || 0)) }));

  /** fixed RM priority order: shorter period first, then the order listed */
  const rmOrder = (ts) => ts.slice().sort((a, b) => a.T - b.T || a.idx - b.idx);

  Sch.rtAnalysis = function (tasks) {
    const ts = Sch.rtNorm(tasks), n = ts.length;
    const U = ts.reduce((a, k) => a + k.C / k.T, 0);
    const bound = n * (Math.pow(2, 1 / n) - 1);
    const hyper = ts.reduce((a, k) => lcm(a, k.T), 1);
    const ord = rmOrder(ts), rta = [];
    ord.forEach((k, i) => {
      const hp = ord.slice(0, i);
      let R = k.C, its = [R], ok = true;
      for (let g = 0; g < 1000; g++) {
        const next = k.C + hp.reduce((a, j) => a + Math.ceil(R / j.T) * j.C, 0);
        if (next === R) break;
        R = next; its.push(R);
        if (R > k.D) { ok = false; break; }
      }
      rta.push({ id: k.id, R, ok: ok && R <= k.D, iterations: its, D: k.D, hp: hp.map((j) => j.id) });
    });
    const implicit = ts.every((k) => k.D === k.T);
    // the processor-demand test at every absolute deadline up to the hyperperiod (plus the largest deadline)
    const limit = Math.min(100000, hyper + Math.max(...ts.map((k) => k.D)));
    const demand = [];
    let edfExact = U <= 1 + 1e-12;
    if (edfExact && !implicit) {
      const Ls = new Set();
      for (const k of ts) for (let L = k.D; L <= limit; L += k.T) Ls.add(L);
      for (const L of [...Ls].sort((a, b) => a - b)) {
        const d = ts.reduce((a, k) => a + Math.max(0, Math.floor((L - k.D) / k.T) + 1) * k.C, 0);
        demand.push({ L, demand: d, ok: d <= L });
        if (d > L) { edfExact = false; break; }
      }
    }
    return { U: r3(U), Uexact: U, n, bound: r3(bound), rmBound: U <= bound + 1e-12, rta, rmExact: rta.every((r) => r.ok), edfU: U <= 1 + 1e-12, edfExact, implicit, hyper, demand };
  };

  Sch.rt = function (tasks, params) {
    const P = Object.assign({ policy: 'rm', onMiss: 'continue' }, params || {});
    const ts = Sch.rtNorm(tasks);
    const A = Sch.rtAnalysis(tasks);
    const H = Math.max(1, Math.round(P.horizon || Math.min(1000, A.hyper + Math.max(...ts.map((k) => k.phase)))));
    P.horizon = H;
    const rank = {};
    rmOrder(ts).forEach((k, i) => { rank[k.id] = i; });
    const edf = P.policy === 'edf';
    const better = (a, b) => (edf ? a.deadline - b.deadline || a.release - b.release || a.k.idx - b.k.idx : rank[a.k.id] - rank[b.k.id] || a.release - b.release) < 0;
    const live = [], all = [], steps = [], events = [], misses = [], perTick = [], perInst = [];
    let run = null;
    const ev = (kind, j, say, more) => { events.push(Object.assign({ kind, t: tt, job: j ? j.name : null, say }, more || {})); };
    let tt = 0;
    for (let t = 0; t <= H; t++) {
      tt = t;
      const said = [], missed = [], released = [];
      if (run && run.left === 0) { run.finish = t; said.push(`${run.name} completes, ${run.finish <= run.deadline ? 'in time' : 'late'} (deadline ${run.deadline})`); ev('complete', run, `${run.name} completes at t = ${t}`); live.splice(live.indexOf(run), 1); run = null; }
      for (const j of live.slice()) if (j.deadline === t && j.left > 0) {
        j.missed = true; missed.push(j.name); misses.push({ job: j.name, task: j.k.id, t, left: j.left });
        said.push(`${j.name} misses its deadline at t = \`${t}\` with \`${j.left}\` left` + (P.onMiss === 'abort' ? ', and is dropped' : ''));
        ev('miss', j, `${j.name} misses its deadline with ${j.left} left`);
        if (P.onMiss === 'abort') { live.splice(live.indexOf(j), 1); if (run === j) run = null; }
      }
      if (t === H) { steps.push({ kind: 'end', t, run: null, ready: [], released: [], missed, say: `At t = \`${t}\` the horizon is reached` + (said.length ? ': ' + said.join('; ') : '') + `; ${misses.length ? Sch.s(misses.length, 'deadline') + ' missed' : 'no deadline was missed'}.` }); break; }
      for (const k of ts) if (t >= k.phase && (t - k.phase) % k.T === 0) {
        const n = (t - k.phase) / k.T + 1, j = { name: k.id + n, k, n, release: t, deadline: t + k.D, left: k.C, finish: null, start: null, missed: false };
        live.push(j); all.push(j); released.push(j.name);
        ev('release', j, `${k.id} releases ${j.name}, due at t = ${j.deadline}`);
      }
      if (released.length) said.push(`${Sch.list(released)} ${released.length > 1 ? 'are' : 'is'} released`);
      let best = null;
      for (const j of live) if (!best || better(j, best)) best = j;
      let decision = 'continue';
      if (best && run && best !== run && better(best, run)) {
        said.push(`${best.name} preempts ${run.name}: ` + (edf ? `its deadline \`${best.deadline}\` is earlier than \`${run.deadline}\`` : `its period \`${best.k.T}\` is shorter than \`${run.k.T}\``));
        ev('preempt', best, `${best.name} preempts ${run.name}`, { from: run.name });
        run = best; decision = 'preempt';
      } else if (!run && best) {
        run = best; decision = 'dispatch';
        const others = live.filter((j) => j !== best);
        said.push(`${best.name} runs` + (others.length ? ': ' + (edf ? `its deadline \`${best.deadline}\` is the earliest of ${Sch.list(live.map((j) => j.name + ' (' + j.deadline + ')'))}` : `its period \`${best.k.T}\` is the shortest of ${Sch.list(live.map((j) => j.name + ' (' + j.k.T + ')'))}`) : ', the only job ready'));
      } else if (!run) { decision = 'idle'; said.push('the CPU idles'); }
      else said.push(`${run.name} runs on, \`${run.left}\` left, due at \`${run.deadline}\``);
      if (run && run.start === null) run.start = t;
      steps.push({ kind: 'tick', t, run: run ? run.name : null, task: run ? run.k.id : null, ready: live.filter((j) => j !== run).map((j) => ({ job: j.name, task: j.k.id, left: j.left, deadline: j.deadline })), left: run ? run.left : null, deadline: run ? run.deadline : null, released, missed, decision, say: `At t = \`${t}\` ${said.join('; ')}.` });
      perTick.push(run ? run.k.id : null); perInst.push(run ? run.name : null);
      if (run) run.left--;
    }
    const segs = [];
    perTick.forEach((id, t) => { if (id === null) return; const l = segs[segs.length - 1]; if (l && l.inst === perInst[t] && l.end === t) l.end = t + 1; else segs.push({ job: id, inst: perInst[t], start: t, end: t + 1 }); });
    const jobsOut = all.map((j) => ({ job: j.name, task: j.k.id, release: j.release, deadline: j.deadline, start: j.start, finish: j.finish, response: j.finish === null ? null : j.finish - j.release, missed: j.missed }));
    const perTask = ts.map((k) => { const js = jobsOut.filter((j) => j.task === k.id); return { id: k.id, C: k.C, T: k.T, D: k.D, released: js.length, done: js.filter((j) => j.finish !== null).length, missed: js.filter((j) => j.missed).length, worst: Math.max(0, ...js.filter((j) => j.response !== null).map((j) => j.response)) }; });
    const busy = perTick.filter((x) => x !== null).length;
    return { policy: P.policy, name: edf ? 'EDF' : 'RM', params: P, tasks: ts, steps, events, segs, jobs: jobsOut, misses, perTask, end: H, U: A.U, util: busy / H, analysis: A };
  };
})(globalThis.Proses = globalThis.Proses || {});
