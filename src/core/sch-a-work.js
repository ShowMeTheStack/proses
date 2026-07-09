// CPU scheduling, part 1: the workload model and what every policy shares.
// The engine (S.Sched), file by file:
//   sch-a-work      the workload, metrics, fairness, presets, seeded workloads
//   sch-b-policies  run(work, 'fcfs' | 'sjf' | 'srtn' | 'prio' | 'rr', params): context-switch cost, burst
//                   prediction by exponential averaging, aging rules
//   sch-c-mlfq      mlfq(work, params): levels, quanta, allotments, boost, and rule switches (allotMode, preempt)
//   sch-d-mlq       mlq(work, params): fixed classes, strict priority or time-slice shares between queues
//   sch-e-share     lottery(work, params) with currencies and transfers; stride(work, params)
//   sch-f-cfs       cfs(work, params): weights from nice, vruntime, slices, a red-black tree per step
//   sch-g-multi     multi(work, params): N cores, shared or per-core queues, push and pull, affinity, migration
//   sch-h-rt        rt(tasks, params) under RM or EDF, rtAnalysis(tasks): utilisation, bounds, RTA, demand
//   sch-i-pi        inversion(tasks, params): a mutex model with no protocol, inheritance or a priority ceiling
// A workload is a list of jobs {id, arrive, bursts: [cpu, io, cpu, ..., cpu], prio, tickets, nice, cls, affinity}:
// bursts alternate CPU and I/O, starting and ending with CPU, all in whole ticks of at least 1. prio is a number,
// lower is more urgent; tickets (default 100) serve lottery and stride; nice (-20..19, default 0) serves the
// CFS-style scheduler; cls (default 0) is a job's class in a multilevel queue; affinity (default all) lists the
// cores a job may run on. I/O never queues: every job has its own device, so a job doing I/O just comes back
// after its I/O burst.
//
// Time runs in ticks. At each tick boundary t the scheduler handles, in this order:
//   1. the job that ran the tick before: its burst ended (it blocks for I/O or finishes), or its quantum or
//      allotment ran out;
//   2. jobs arriving at t and jobs back from I/O at t join the ready queue, in name order (A before B);
//   3. a job whose quantum ran out at t goes to the back, behind the jobs of step 2;
//   4. a preemptive policy compares the best ready job with the running one, and preempts only when the
//      newcomer is strictly better;
//   5. if the CPU is free, the policy picks a job.
// Ties: when two ready jobs are equally good by the policy's measure, the one that has been in the ready queue
// longer wins (first come, first served among equals). This is the rule every policy here uses.
//
// Traces: every policy returns {policy, name, params, jobs, steps, events, segs, metrics, end}. steps has one
// entry per tick {kind: 'tick', t, run, ready, io, decision, why, say} (and a last {kind: 'end'}), with say one
// sentence naming the values; events lists what happened at each boundary {kind, t, job, say}; segs the Gantt
// chart {job, start, end} (cs: true marks context-switch time, level/core/cls where the policy has them).
// metrics (Sch.metrics) = {rows: [{id, arrive, finish, turnaround, waiting, response, cpu, io}], sum, avg,
// sumText, end, busy, overhead, util, throughput}: util is the share of ticks spent on jobs' bursts, throughput
// jobs finished per tick; turnaround = finish − arrive, waiting = turnaround − cpu − io (all time neither running
// nor in I/O, so it includes context-switch time), response = first tick on the CPU − arrive.
// Shared helpers: Sch.norm(work), Sch.list(xs), Sch.qtext(ids), Sch.metrics(jobs, finish, first, o),
// Sch.segments(perTick, extra, key), Sch.jain(xs), Sch.share(trace, from, to), Sch.rng(seed), Sch.random(seed, o),
// Sch.presets, Sch.WEIGHTS (the nice-to-weight table).
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  Sch.TIES = 'Ties go to the job that has waited in the ready queue longest; jobs ready at the same tick queue in name order, ahead of a job whose quantum just ran out.';

  /** a workload made safe to run: ids, whole-tick bursts, an index for colour and order */
  Sch.norm = function (work) {
    const jobs = work.map((j, i) => {
      const bursts = (j.bursts || [j.burst || 1]).map((b) => Math.max(1, Math.round(+b || 1)));
      if (bursts.length % 2 === 0) bursts.pop();
      const cpu = bursts.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
      const io = bursts.filter((_, k) => k % 2 === 1).reduce((a, b) => a + b, 0);
      return {
        id: String(j.id || String.fromCharCode(65 + i)), idx: i, arrive: Math.max(0, Math.round(+j.arrive || 0)), bursts, prio: Math.round(+j.prio || 0), cpu, io,
        tickets: Math.max(1, Math.round(j.tickets === undefined ? 100 : +j.tickets || 1)), nice: Math.max(-20, Math.min(19, Math.round(+j.nice || 0))), cls: Math.max(0, Math.round(+j.cls || 0)),
        affinity: Array.isArray(j.affinity) && j.affinity.length ? j.affinity.map(Number) : null, currency: j.currency || null,
      };
    });
    return jobs;
  };

  /** "A", "A and B", "A, B and C" */
  Sch.list = function (xs) {
    xs = xs.map(String);
    if (xs.length < 2) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  };
  /** "[B, C]" or "empty" */
  Sch.qtext = (ids) => (ids.length ? '[' + ids.join(', ') + ']' : 'empty');
  Sch.s = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  /** the same with the number set as a value: "`1` tick", "`3` ticks" */
  Sch.sv = (n, word) => '`' + n + '` ' + word + (n === 1 ? '' : 's');

  /** the metrics of a finished run: per job, then their sums and averages, and for the whole run (o: {end, busy,
   *  overhead}) the CPU utilisation and the throughput */
  Sch.metrics = function (jobs, finish, first, o) {
    o = o || {};
    const rows = jobs.map((j) => {
      const turnaround = finish[j.id] - j.arrive;
      return { id: j.id, arrive: j.arrive, finish: finish[j.id], turnaround, waiting: turnaround - j.cpu - j.io, response: first[j.id] - j.arrive, cpu: j.cpu, io: j.io };
    });
    const sum = {}, avg = {}, sumText = {};
    for (const k of ['turnaround', 'waiting', 'response']) {
      sum[k] = rows.reduce((a, r) => a + r[k], 0);
      avg[k] = rows.length ? sum[k] / rows.length : 0;
      sumText[k] = rows.map((r) => r[k]).join(' + ') + ' = ' + sum[k];
    }
    const end = o.end !== undefined ? o.end : Math.max(0, ...rows.map((r) => r.finish));
    const busy = o.busy !== undefined ? o.busy : jobs.reduce((a, j) => a + j.cpu, 0);
    const cores = o.cores || 1;
    return { rows, sum, avg, sumText, end, busy, overhead: o.overhead || 0, util: end ? busy / (end * cores) : 0, throughput: end ? rows.length / end : 0 };
  };

  /** Jain's fairness index of a list of non-negative numbers: (Σx)² / (n·Σx²), 1 when all are equal, 1/n at worst */
  Sch.jain = function (xs) {
    const n = xs.length, s = xs.reduce((a, b) => a + b, 0), q = xs.reduce((a, b) => a + b * b, 0);
    return n && q ? (s * s) / (n * q) : 1;
  };
  /** how a trace shared the CPU over [from, to): {id: ticks} (whole run when from and to are left out) */
  Sch.share = function (tr, from, to) {
    from = from === undefined ? 0 : from; to = to === undefined ? tr.end : to;
    const got = {};
    for (const j of tr.jobs) got[j.id] = 0;
    for (const s of tr.segs) if (!s.cs && !s.warm) { const a = Math.max(from, s.start), b = Math.min(to, s.end); if (b > a) got[s.job] += b - a; }
    return got;
  };
  /** fairness while every job competes: the CPU each got over [last arrival, first finish), per unit of its weight
   *  (weightOf(job)), and Jain's index of those numbers */
  Sch.fairness = function (tr, weightOf) {
    const from = Math.max(...tr.jobs.map((j) => j.arrive)), to = Math.min(...tr.metrics.rows.map((r) => r.finish));
    const got = Sch.share(tr, from, Math.max(from, to));
    const per = tr.jobs.map((j) => got[j.id] / weightOf(j));
    return { from, to: Math.max(from, to), got, per, jain: to > from ? Sch.jain(per) : 1 };
  };

  /** the CFS weight of each nice value, -20 to 19 (each step about 1.25 times the next; nice 0 is 1024) */
  Sch.WEIGHTS = [88761, 71755, 56483, 46273, 36291, 29154, 23254, 18705, 14949, 11916, 9548, 7620, 6100, 4904, 3906, 3121, 2501, 1991, 1586, 1277,
    1024, 820, 655, 526, 423, 335, 272, 215, 172, 137, 110, 87, 70, 56, 45, 36, 29, 23, 18, 15];
  Sch.weight = (nice) => Sch.WEIGHTS[Math.max(-20, Math.min(19, nice)) + 20];

  /** merge a list of per-tick runners into Gantt segments; extra[t] (with its key, default 'level') splits them
   *  further; a runner written '~A' is A's context-switch time (cs: true), '!A' A warming a cold cache (warm: true) */
  Sch.segments = function (perTick, extra, key) {
    key = key || 'level';
    const segs = [];
    perTick.forEach((id, t) => {
      if (id === null || id === undefined) return;
      const cs = id[0] === '~', warm = id[0] === '!', job = cs || warm ? id.slice(1) : id;
      const lv = extra ? extra[t] : undefined, last = segs[segs.length - 1];
      if (last && last.job === job && last.end === t && last[key] === lv && !!last.cs === cs && !!last.warm === warm) last.end = t + 1;
      else { const s = { job, start: t, end: t + 1 }; if (lv !== undefined) s[key] = lv; if (cs) s.cs = true; if (warm) s.warm = true; segs.push(s); }
    });
    return segs;
  };

  /** a small seeded generator (the same seed gives the same numbers) */
  Sch.rng = function (seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  /** a random workload from a seed: n jobs, some with I/O */
  Sch.random = function (seed, o) {
    o = o || {};
    const r = Sch.rng(seed), n = o.n || 2 + Math.floor(r() * 5), int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = o.io === false ? 1 : 1 + 2 * Math.floor(r() * (r() < 0.5 ? 1 : 3));
      const bursts = [];
      for (let b = 0; b < k; b++) bursts.push(b % 2 ? int(1, o.maxIo || 6) : int(1, o.maxCpu || 9));
      out.push({ id: String.fromCharCode(65 + i), arrive: int(0, o.spread || 12), bursts, prio: int(0, 4) });
    }
    return out;
  };

  /** the sample workloads of the scenes and the lab, our own */
  Sch.presets = {
    convoy: { name: 'convoy', blurb: 'one long job arrives first, three short ones just after it', jobs: [
      { id: 'A', arrive: 0, bursts: [11], prio: 2 }, { id: 'B', arrive: 1, bursts: [2], prio: 1 }, { id: 'C', arrive: 2, bursts: [3], prio: 3 }, { id: 'D', arrive: 3, bursts: [1], prio: 0 }] },
    mixed: { name: 'mixed', blurb: 'five jobs of mixed lengths arriving over time', jobs: [
      { id: 'A', arrive: 0, bursts: [6], prio: 3 }, { id: 'B', arrive: 2, bursts: [3], prio: 1 }, { id: 'C', arrive: 4, bursts: [7], prio: 4 }, { id: 'D', arrive: 5, bursts: [2], prio: 0 }, { id: 'E', arrive: 8, bursts: [4], prio: 2 }] },
    io: { name: 'with I/O', blurb: 'two jobs that stop for I/O between CPU bursts, and two that only compute', jobs: [
      { id: 'A', arrive: 0, bursts: [3, 4, 3], prio: 1 }, { id: 'B', arrive: 1, bursts: [9], prio: 3 }, { id: 'C', arrive: 2, bursts: [2, 3, 2, 3, 1], prio: 0 }, { id: 'D', arrive: 4, bursts: [4], prio: 2 }] },
    mlfq: { name: 'two hogs and an editor', blurb: 'two long compute jobs and an interactive one that runs a tick, then waits for a key', jobs: [
      { id: 'A', arrive: 0, bursts: [16], prio: 0 }, { id: 'B', arrive: 1, bursts: [12], prio: 0 }, { id: 'C', arrive: 3, bursts: [1, 7, 1, 7, 1, 7, 1, 7, 1], prio: 0 }] },
    gamer: { name: 'a job that games the queue', blurb: 'two honest compute jobs and G, which runs 3 ticks and then does a 1-tick I/O, again and again, to stay just under an allotment of 4', jobs: [
      { id: 'A', arrive: 0, bursts: [14] }, { id: 'B', arrive: 0, bursts: [14] }, { id: 'G', arrive: 1, bursts: [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3] }] },
    classes: { name: 'system, interactive, batch', blurb: 'a multilevel queue: one system job, two interactive jobs, two batch jobs, each in its fixed class', jobs: [
      { id: 'S', arrive: 4, bursts: [2, 6, 2], cls: 0 }, { id: 'I', arrive: 0, bursts: [3, 4, 3, 4, 2], cls: 1 }, { id: 'J', arrive: 2, bursts: [2, 5, 2], cls: 1 }, { id: 'B', arrive: 0, bursts: [12], cls: 2 }, { id: 'C', arrive: 1, bursts: [9], cls: 2 }] },
    shares: { name: 'three jobs, 3 : 2 : 1 tickets', blurb: 'three long compute jobs holding 300, 200 and 100 tickets, for lottery, stride and CFS', jobs: [
      { id: 'A', arrive: 0, bursts: [40], tickets: 300, nice: -2 }, { id: 'B', arrive: 0, bursts: [40], tickets: 200, nice: 0 }, { id: 'C', arrive: 0, bursts: [40], tickets: 100, nice: 3 }] },
  };

  (S.engines = S.engines || []).push({ name: 'Schedulers' });
})(globalThis.Proses = globalThis.Proses || {});
