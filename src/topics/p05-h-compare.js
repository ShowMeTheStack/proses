// Part 5: every policy on one workload. The chosen policies run the same jobs; their Gantt charts appear one under
// another on a shared time axis, each with its averages, and the last frame ranks them, flagging the longest wait
// (starvation) and the convoy behind a long FCFS burst. This is the scheduler lab's comparison as a topic.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt;
  const POLS = {
    fcfs: ['FCFS', (w, q) => Sch().run(w, 'fcfs')],
    sjf: ['SJF', (w, q) => Sch().run(w, 'sjf')],
    srtn: ['SRTN', (w, q) => Sch().run(w, 'srtn')],
    rr: ['RR', (w, q) => Sch().run(w, 'rr', { quantum: q })],
    prio: ['Priority', (w, q) => Sch().run(w, 'prio', { preemptive: true })],
    mlfq: ['MLFQ', (w, q) => Sch().mlfq(w, { levels: 3, quantum: [q], boost: 24 })],
    cfs: ['CFS', (w, q) => Sch().cfs(w, {})],
    stride: ['Stride', (w, q) => Sch().stride(w, { quantum: q })],
    lottery: ['Lottery', (w, q) => Sch().lottery(w, { quantum: q, seed: 1 })],
  };
  const switches = (tr) => { const js = tr.segs.filter((s) => !s.cs).map((s) => s.job); let n = 0; for (let i = 1; i < js.length; i++) if (js[i] !== js[i - 1]) n++; return n; };

  S.topic({
    id: 'sch-compare', family: 'p05-lab', order: 10, title: 'Every policy on one workload',
    blurb: 'No policy wins on every measure. Shortest-first policies minimise waiting but need burst lengths and can starve long jobs; round robin and the fair schedulers give quick, even response at the cost of switches; FCFS is simple and fair in order, but convoys. Pick up to six policies and compare them on your own workload, chart by chart, then side by side.',
    inputs: [
      P.workInput(P.W.mixed),
      { id: 'pols', kind: 'list', label: 'Policies (fcfs, sjf, srtn, rr, prio, mlfq, cfs, stride, lottery)', def: ['fcfs', 'sjf', 'srtn', 'rr', 'mlfq', 'cfs'], min: 2, max: 6, check: (v) => { const bad = v.find((x) => !POLS[x]); return bad ? `Policies: "${bad}" is not one of fcfs, sjf, srtn, rr, prio, mlfq, cfs, stride, lottery` : new Set(v).size !== v.length ? 'Policies: each at most once' : null; } },
      { id: 'q', kind: 'number', label: 'Quantum (RR, MLFQ Q0, stride, lottery)', def: 2, min: 1, max: 8 },
    ],
    presets: [
      { label: 'Five jobs over time', values: { work: P.W.mixed } },
      { label: 'A convoy', values: { work: P.W.convoy } },
      { label: 'Jobs with I/O', values: { work: P.W.io, pols: ['fcfs', 'srtn', 'rr', 'mlfq', 'cfs'] } },
      { label: 'Priorities that starve', values: { work: 'L 0 6 prio=4\nA 0 3 prio=1\nB 2 3 prio=2\nC 4 3 prio=1\nD 6 3 prio=2\nE 8 3 prio=1', pols: ['fcfs', 'prio', 'rr', 'cfs'] } },
      { label: 'Equal jobs: fair shares', values: { work: P.W.same, pols: ['fcfs', 'rr', 'stride', 'lottery', 'cfs'], q: 1 } },
    ],
    run(inp) {
      const work = P.work(inp.work), names = inp.pols.map((p) => POLS[p][0] + (['rr', 'stride', 'lottery'].includes(p) ? ' q ' + inp.q : ''));
      const trs = inp.pols.map((p) => POLS[p][1](work, inp.q)), jobs = trs[0].jobs.map((j) => j.id), T = Math.max(...trs.map((tr) => tr.end));
      const rowH = 34, gap = 14, y0 = 40, tY = y0 + trs.length * (rowH + gap) + 24;
      const stats = trs.map((tr, k) => { const m = tr.metrics, worst = m.rows.reduce((a, r) => (r.waiting > a.waiting ? r : a)); return { name: names[k], T: m.avg.turnaround, W: m.avg.waiting, R: m.avg.response, maxW: worst.waiting, worst: worst.id, sw: switches(tr), end: tr.end }; });
      const best = { T: Math.min(...stats.map((s) => s.T)), W: Math.min(...stats.map((s) => s.W)), R: Math.min(...stats.map((s) => s.R)), maxW: Math.min(...stats.map((s) => s.maxW)), sw: Math.min(...stats.map((s) => s.sw)) };
      const fi = inp.pols.indexOf('fcfs'), cv = fi >= 0 && P.convoy ? P.convoy(trs[fi]) : null;
      const frames = [];
      const draw = (upTo, final) => {
        const items = [];
        trs.forEach((tr, k) => {
          if (k > upTo) return;
          items.push(...P.gantt({ prefix: 'g' + k, tr, jobs, t: tr.end, x0: 110, x1: P.W_, y: y0 + k * (rowH + gap), h: rowH, final: true, label: names[k], T, axis: k === 0, labelSize: 14 }).items);
        });
        const cols = [{ w: 116, label: 'policy' }, { w: 108, label: 'turnaround' }, { w: 92, label: 'waiting' }, { w: 100, label: 'response' }, { w: 128, label: 'longest wait' }, { w: 100, label: 'switches' }];
        const rows = stats.slice(0, upTo + 1).map((s, k) => {
          const c = (v, key) => ({ text: key === 'maxW' ? v + ' (' + s.worst + ')' : P.f(v), cls: final && v === best[key] ? 'best' : final && key === 'maxW' && v === Math.max(...stats.map((x) => x.maxW)) && v > best.maxW ? 'worst' : k === upTo && !final ? 'fresh' : '' });
          return { key: 'p' + k, cells: [s.name, c(s.T, 'T'), c(s.W, 'W'), c(s.R, 'R'), c(s.maxW, 'maxW'), c(s.sw, 'sw')] };
        });
        items.push(...G().table({ prefix: 'cmp', x: 0, y: tY, cols, rows, rowH: 28, size: 14 }).items);
        items.push(P.text('cap', 0, tY - 10, 'averages over the jobs, and the longest single wait', 'glabel', 14));
        return items;
      };
      trs.forEach((tr, k) => {
        const s = stats[k];
        frames.push({ items: draw(k, false), say: `${s.name}: average turnaround ${P.f(s.T)}, waiting ${P.f(s.W)}, response ${P.f(s.R)}; the longest wait is ${s.worst}'s ${s.maxW}, and the CPU switched jobs ${P.s(s.sw, 'time')}, finishing at t = ${s.end}.`, meta: { phase: 'policy', k, s }, title: s.name });
      });
      const by = (key) => stats.filter((s) => s[key] === best[key]).map((s) => s.name);
      const starve = stats.reduce((a, s) => (s.maxW > a.maxW ? s : a));
      frames.push({ items: draw(trs.length - 1, true), say: `Least average waiting: ${P.list(by('W'))} (${P.f(best.W)}); best response: ${P.list(by('R'))} (${P.f(best.R)}); fewest switches: ${P.list(by('sw'))} (${best.sw}). The longest single wait is ${starve.worst}'s ${starve.maxW} under ${starve.name}` + (cv ? `; under FCFS, ${P.list(cv.ids)} queued behind ${cv.seg.job}'s ${cv.len}-tick burst.` : '.'), meta: { phase: 'compare', best, stats, starve, convoy: cv ? { len: cv.len, ids: cv.ids } : null }, title: 'compare' });
      return { frames, def: P.def(['What to compare', ['turnaround: arrival to finish', 'waiting: time in the ready queue', 'response: arrival to first run', 'longest wait: the worst-treated job (starvation)', 'switches: how often the CPU changed jobs']], ['Policies here', 'FCFS, SJF, SRTN, round robin, preemptive priority, a three-level MLFQ (boost every 24), a CFS-style fair scheduler, stride and lottery (seed 1). The quantum applies to round robin, MLFQ\'s top level, stride and lottery.']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Which of the chosen policies will give the least average waiting time?', options: (fr) => fr[fr.length - 1].meta.stats.map((s) => s.name), answer: (fr) => { const m = fr[fr.length - 1].meta; return m.stats.filter((s) => s.W === m.best.W).map((s) => s.name); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Which policy gives the least average waiting time when burst lengths are known?', options: ['SRTN', 'FCFS', 'round robin', 'lottery'], answer: 0, why: 'Always serving the least remaining work first minimises waiting.' },
      { q: 'Which policy is best for response time with many interactive jobs?', options: ['round robin with a small quantum', 'FCFS', 'SJF', 'non-preemptive priority'], answer: 0, why: 'Every job gets the CPU within a few quanta.' },
      { q: 'Which policies can starve a job?', options: ['SJF, SRTN and priority without aging', 'round robin', 'stride', 'FCFS'], answer: 0, why: 'They can always prefer someone else.' },
      { q: 'Why would anyone use FCFS?', options: ['It is simple, has the fewest switches and never starves', 'It minimises waiting', 'It gives the best response', 'It needs burst lengths'], answer: 0, why: 'Its cost is the convoy effect.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
