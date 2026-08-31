// Part 5, CPU scheduling: the families, and what the topics share. A workload is typed one job per line
// ("A 0 3 (4) 3 prio=2": the name, the arrival tick, then CPU bursts with I/O bursts in brackets, then options),
// run through the scheduler engine (S.Sched), and drawn with the Gantt kit: the chart so far with a time cursor,
// the CPU with the job on it, the ready queue and the jobs away in I/O, and the metrics table filling in as jobs
// finish. Frames carry meta: the values their narration quotes, straight from the engine's trace.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'scheduling', order, title, blurb });
  fam('p05-model', 10, 'Bursts and metrics', 'What a scheduler works with, CPU and I/O bursts, and how a schedule is judged: turnaround, waiting, response, throughput and utilisation.');
  fam('p05-basic', 20, 'FCFS, SJF and SRTN', 'First come, first served and its convoy; shortest job first and its preemptive form; and predicting a burst nobody knows yet.');
  fam('p05-prio', 30, 'Priorities and round robin', 'Priority scheduling with starvation and aging, round robin, and how the quantum and the cost of a switch trade off.');
  fam('p05-mlq', 40, 'Multilevel queues', 'Fixed classes with their own queues, and the multilevel feedback queue that learns which jobs are interactive, with the rules that stop a program from gaming it.');
  fam('p05-share', 50, 'Fair shares', 'Lottery and stride scheduling, and a fair scheduler with weights, virtual runtime and a red-black tree.');
  fam('p05-lab', 60, 'Every policy at once', 'One workload under every policy, side by side, with the metrics compared.');

  const P = (S.P05 = {});
  const Sch = () => S.Sched, G = () => S.Kit.gantt;
  const cache = new Map();
  P.once = (k, f) => { if (!cache.has(k)) { if (cache.size > 400) cache.clear(); cache.set(k, f()); } return cache.get(k); };
  P.r2 = (v) => Math.round(v * 100) / 100;
  P.f = (v) => String(P.r2(v));
  P.s = (n, w, pl) => n + ' ' + (n === 1 ? w : pl || w + 's');
  P.list = (xs) => Sch().list(xs);
  P.text = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, text: String(text), cls: cls || '', size: size || 14, anchor: anchor || 'start' });
  P.W_ = 800; P.X0 = 56;
  /** the engines' sentences mark values with backticks for the demo player, which topics do not render: show them plain */
  P.clean = (say) => String(say || '').replace(/`/g, '');
  P.pcls = (jobs, id) => 'p' + (Math.max(0, jobs.indexOf(id)) % 6);

  // ---- the workload as text ----------------------------------------------------------------------------------
  const OPT = { prio: 'prio', p: 'prio', tickets: 'tickets', t: 'tickets', nice: 'nice', n: 'nice', cls: 'cls', class: 'cls', c: 'cls', aff: 'affinity', cores: 'affinity' };
  /** text -> {jobs} or {error} */
  P.parseWork = function (text, o) {
    o = o || {};
    const lines = String(text || '').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
    const maxJobs = o.maxJobs || 6;
    if (!lines.length) return { error: 'Workload: one job per line, such as A 0 3 (4) 2' };
    if (lines.length > maxJobs) return { error: 'Workload: at most ' + maxJobs + ' jobs, so the picture stays readable' };
    const jobs = [], seen = new Set();
    let cpuAll = 0;
    for (const line of lines) {
      const tk = line.split(/[\s,;]+/).filter(Boolean);
      const id = tk[0];
      if (!/^[A-Za-z][A-Za-z0-9]{0,2}$/.test(id)) return { error: `Workload: "${id}" is not a job name (a letter, then up to two letters or digits)` };
      if (seen.has(id)) return { error: `Workload: two jobs are named ${id}` };
      seen.add(id);
      if (!/^\d+$/.test(tk[1] || '')) return { error: `Workload: job ${id} needs its arrival tick after its name` };
      const arrive = +tk[1];
      if (arrive > (o.maxArrive || 40)) return { error: `Workload: job ${id} arrives at most at tick ${o.maxArrive || 40}` };
      const bursts = [], j = { id, arrive };
      for (const w of tk.slice(2)) {
        let m;
        if ((m = /^\((\d+)\)$/.exec(w))) { if (bursts.length % 2 === 0) return { error: `Workload: job ${id} has an I/O burst (${m[1]}) where a CPU burst should be` }; bursts.push(+m[1]); }
        else if (/^\d+$/.test(w)) { if (bursts.length % 2 === 1) return { error: `Workload: job ${id} has two CPU bursts in a row; put the I/O between them in brackets, as 3 (4) 2` }; bursts.push(+w); }
        else if ((m = /^([a-z]+)=(-?[\d.|+]+)$/i.exec(w)) && OPT[m[1].toLowerCase()]) {
          const k = OPT[m[1].toLowerCase()];
          if (k === 'affinity') j.affinity = m[2].split(/[|+.]/).filter(Boolean).map(Number);
          else if (!/^-?\d+$/.test(m[2])) return { error: `Workload: ${m[1]} of job ${id} should be a whole number` };
          else j[k] = +m[2];
        } else return { error: `Workload: "${w}" in job ${id} is not a burst or an option (prio=, tickets=, nice=, cls=)` };
      }
      if (!bursts.length) return { error: `Workload: job ${id} needs at least one CPU burst` };
      if (bursts.length % 2 === 0) return { error: `Workload: job ${id} ends with I/O; it should end with a CPU burst` };
      if (bursts.some((b) => b < 1 || b > (o.maxBurst || 30))) return { error: `Workload: every burst of job ${id} is from 1 to ${o.maxBurst || 30} ticks` };
      if (j.nice !== undefined && (j.nice < -20 || j.nice > 19)) return { error: `Workload: nice of job ${id} is from -20 to 19` };
      if (j.tickets !== undefined && (j.tickets < 1 || j.tickets > 1000)) return { error: `Workload: tickets of job ${id} are from 1 to 1000` };
      if (j.prio !== undefined && (j.prio < 0 || j.prio > 9)) return { error: `Workload: prio of job ${id} is from 0 (most urgent) to 9` };
      j.bursts = bursts;
      cpuAll += bursts.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
      jobs.push(j);
    }
    if (cpuAll > (o.maxCpu || 70)) return { error: `Workload: at most ${o.maxCpu || 70} ticks of CPU in all, so the chart stays readable (this has ${cpuAll})` };
    return { jobs };
  };
  P.fmtJob = (j) => [j.id, j.arrive].concat(j.bursts.map((b, k) => (k % 2 ? '(' + b + ')' : String(b)))).join(' ');
  P.burstText = (j) => j.bursts.map((b, k) => (k % 2 ? '(' + b + ')' : String(b))).join(' ');
  P.workText = (jobs, extra) => jobs.map((j) => P.fmtJob(j) + (extra ? extra(j) : '')).join('\n');
  /** the workload input of a topic */
  P.workInput = (def, o) => ({ id: 'work', kind: 'program', label: 'Workload (name, arrival, CPU bursts with (I/O) between)', def, check: (v) => P.parseWork(v, o).error || null });
  P.work = (text, o) => { const r = P.parseWork(text, o); if (r.error) throw new Error(r.error); return r.jobs; };

  // ---- workloads of our own ------------------------------------------------------------------------------------
  P.W = {
    convoy: 'A 0 11\nB 1 2\nC 2 3\nD 3 1',
    mixed: 'A 0 6\nB 2 3\nC 4 7\nD 5 2\nE 8 4',
    io: 'A 0 3 (4) 3\nB 1 9\nC 2 2 (3) 2 (3) 1\nD 4 4',
    editor: 'Ed 0 1 (3) 1 (3) 1 (3) 1\nCc 0 12\nLnk 2 6',
    same: 'A 0 4\nB 0 4\nC 0 4\nD 0 4',
    burst: 'Web 0 2 (2) 2 (2) 2\nDb 1 5 (1) 5\nLog 3 1 (6) 1\nBk 0 10',
  };

  // ---- the moments worth a frame ------------------------------------------------------------------------------
  /** the ticks at which a policy decides something other than running on (repeated idles once), and the end */
  P.moments = function (tr, keep) {
    const out = [];
    tr.steps.forEach((s, t) => {
      if (s.kind === 'end') { out.push(t); return; }
      if (keep && keep(s, t)) { out.push(t); return; }
      if (s.decision === 'continue' || s.decision === 'renew' && !keep) { if (t === 0) out.push(t); return; }
      if (s.decision === 'idle' && t > 0 && tr.steps[t - 1].decision === 'idle') return;
      out.push(t);
    });
    return [...new Set(out)];
  };
  /** spread n asks over the frames that qualify */
  P.spread = (idx, n) => { if (idx.length <= n) return idx; const out = []; for (let k = 0; k < n; k++) out.push(idx[Math.floor(((k + 0.5) * idx.length) / n)]); return [...new Set(out)]; };

  // ---- drawing ------------------------------------------------------------------------------------------------
  /** a step of ticks for an axis so numbers stay apart */
  P.tickStep = (per, min) => { let s = 1; while (per * s < (min || 26)) s = s === 1 ? 2 : s === 2 ? 5 : s + 5; return s; };

  /**
   * a Gantt chart drawn to tick t: o {prefix, tr, segs, jobs, t, x0, x1, y, h, T, label, axis: true, row(seg),
   * cursor: true, final}
   */
  P.gantt = function (o) {
    const g = G(), items = [], T = o.T || o.tr.end, tm = g.time({ x0: o.x0, x1: o.x1, t1: T }), h = o.h || 36;
    const pre = o.prefix || 'g';
    if (o.axis !== false) items.push(...g.axis({ prefix: pre + 'ax', X: tm.X, t1: T, y: o.y - 12, step: P.tickStep(tm.per, o.minTick), size: 13 }));
    if (o.label) items.push(P.text(pre + ':lab', o.x0 - 10, o.y + h / 2 + 5, o.label, 'glname', o.labelSize || 15, 'end'));
    items.push(...g.track({ prefix: pre, x: o.x0, y: o.y, w: o.x1 - o.x0, h }));
    const segs = o.segs || o.tr.segs;
    for (const it of g.bar({ prefix: pre, X: tm.X, segs: segs.filter((s) => !s.cs && !s.warm), y: o.y, h, upTo: o.final ? Infinity : o.t, jobs: o.jobs, size: o.size || 14, row: o.row })) {
      if (it.text && S.geom.textWidth(it.text, o.size || 14, { bold: true }) + 6 > it.w) it.text = '';
      items.push(it);
    }
    // context-switch and cache-warming time: grey, hatched slivers
    segs.forEach((s, i) => {
      if (!(s.cs || s.warm) || (!o.final && s.start >= o.t)) return;
      const end = o.final ? s.end : Math.min(s.end, o.t), x = tm.X(s.start);
      items.push({ key: pre + ':cs' + i, kind: 'cell', x, y: o.row ? o.row(s) : o.y, w: Math.max(1, tm.X(end) - x), h, text: '', cls: s.cs ? 'p05cs' : 'p05warm', audit: 'overlap-ok' });
    });
    if (o.cursor !== false && !o.final) items.push(...g.cursor({ prefix: pre + 'c', X: tm.X, t: o.t, y1: o.y - 4, y2: o.y + (o.span || h) + 4 }));
    return { items, X: tm.X, per: tm.per };
  };

  /** the CPU, the ready queue and the jobs in I/O at a step: o {prefix, st, jobs, x, y, subs: {id: text}, ioSub, readyLabel, w} */
  P.queues = function (o) {
    const g = G(), items = [], bw = o.bw || 46, bh = 44, st = o.st, jobs = o.jobs;
    let x = o.x;
    const y = o.y;
    const wOf = (sub) => (sub !== undefined && sub !== null && sub !== '' ? Math.max(bw, Math.ceil(S.geom.textWidth(String(sub), 14) + 14)) : bw);
    const box = (id, xx, cls, sub) => { const b = g.job('j:' + id, xx, y, id, jobs, { w: wOf(sub), h: bh, cls }); if (sub !== undefined && sub !== null && sub !== '') { b.lines = [id, String(sub)]; b.size = 14; } return b; };
    items.push(P.text((o.prefix || 'q') + ':cpuL', x, y + bh / 2 + 5, 'CPU', 'glabel', 14));
    x += 40;
    const rsub = st.run ? (o.runSub !== undefined ? o.runSub : o.subs ? o.subs[st.run] : null) : null;
    if (st.run) items.push(box(st.run, x, 'run' + (st.cs ? ' p05sw' : ''), rsub));
    else items.push({ key: (o.prefix || 'q') + ':idle', kind: 'cell', x, y, w: bw + 12, h: bh, text: o.done ? 'done' : 'idle', size: 14, cls: 'gslot' });
    const cpuBox = { x, y, w: st.run ? wOf(rsub) : bw + 12, h: bh };
    x += (st.run ? wOf(rsub) : bw + 12) + 26;
    items.push(P.text((o.prefix || 'q') + ':rdL', x, y + bh / 2 + 5, o.readyLabel || 'ready', 'glabel', 14));
    x += Math.max(48, S.geom.textWidth(o.readyLabel || 'ready', 14) + 10);
    const ready = st.ready || [];
    if (!ready.length) items.push(P.text((o.prefix || 'q') + ':rdE', x, y + bh / 2 + 5, 'empty', 'glabel', 14));
    for (const id of ready) { const sub = o.subs ? o.subs[id] : null; items.push(box(id, x, '', sub)); x += wOf(sub) + 5; }
    if (!ready.length) x += 46;
    const readyEnd = x;
    if (o.io !== false) {
      x += 22;
      items.push(P.text((o.prefix || 'q') + ':ioL', x, y + bh / 2 + 5, 'I/O', 'glabel', 14));
      x += 34;
      const io = st.io || [];
      if (!io.length) items.push(P.text((o.prefix || 'q') + ':ioE', x, y + bh / 2 + 5, 'none', 'glabel', 14));
      for (const e of io) { items.push(box(e.id, x, 'io', 'to ' + e.until)); x += wOf('to ' + e.until) + 5; }
    }
    return { items, x, readyEnd, cpuBox };
  };

  /** the metrics table, rows filled as jobs finish by tick t; o {prefix, tr, t, x, y, final, cols: 'full' | 'short', fresh: [ids]} */
  P.table = function (o) {
    const g = G(), tr = o.tr, rows = [], short = o.cols === 'short';
    const cols = short
      ? [{ w: 62, label: 'job' }, { w: 92, label: 'finish' }, { w: 120, label: 'turnaround' }, { w: 96, label: 'waiting' }, { w: 104, label: 'response' }]
      : [{ w: 62, label: 'job' }, { w: 84, label: 'arrives' }, { w: 170, label: 'CPU (I/O) bursts' }, { w: 76, label: 'finish' }, { w: 116, label: 'turnaround' }, { w: 92, label: 'waiting' }, { w: 100, label: 'response' }];
    tr.metrics.rows.forEach((r, k) => {
      const j = tr.jobs[k], fin = o.final || r.finish <= o.t, fresh = o.fresh && o.fresh.includes(r.id);
      const c = (v, cls) => (fin ? { text: String(v), cls: (fresh ? 'fresh ' : '') + (cls || '') } : '');
      const cells = [{ text: r.id, cls: 'p' + (k % 6) }];
      if (!short) cells.push(String(r.arrive), P.burstText(j));
      cells.push(c(r.finish), c(r.turnaround, o.mark && o.mark.turnaround === r.id ? 'worst' : ''), c(r.waiting, o.mark && o.mark.waiting === r.id ? 'worst' : ''), c(r.response));
      rows.push({ key: r.id, cells });
    });
    if (o.final && o.sums !== false) {
      const m = tr.metrics, pad = short ? [] : ['', ''];
      rows.push({ key: 'sum', cls: 'gsum', cells: ['sum'].concat(pad, [''], [String(m.sum.turnaround), String(m.sum.waiting), String(m.sum.response)]) });
      rows.push({ key: 'avg', cls: 'gsum', cells: ['average'].concat(pad, [''], [P.f(m.avg.turnaround), P.f(m.avg.waiting), P.f(m.avg.response)]) });
    }
    return g.table({ prefix: o.prefix || 'mt', x: o.x, y: o.y, cols, rows, rowH: 28, size: 14 });
  };

  /** "t = 7" or "end, t = 21" in the corner */
  P.now = (key, x, y, t, end, anchor) => P.text(key, x, y, end ? 'end, t = ' + t : 't = ' + t, 'gnow', 15, anchor || 'start');

  /** the jobs that finished in (t0, t1] */
  P.finished = (tr, t0, t1) => tr.metrics.rows.filter((r) => r.finish > t0 && r.finish <= t1).map((r) => r.id);

  /**
   * The standard single-CPU scene: chart, queues, table, one frame per decision. o {tr, subs(st, t) -> {id: text},
   * runSub(st), extra(st, t, layout) -> items, sayEnd(tr) -> sentence, metaOf(st, t) -> more meta, title, tableCols,
   * keep(st, t)}. Returns frames (each with meta {phase: 'tick' | 'end', t, run, ready, decision, step}).
   */
  P.scene = function (o) {
    const tr = o.tr, jobs = tr.jobs.map((j) => j.id), W = P.W_, ts = P.moments(tr, o.keep);
    const gy = 50, qy = 124, ty = o.tableY || 206;
    const out = [];
    let prev = -1;
    for (const t of ts) {
      const st = tr.steps[t], end = st.kind === 'end', items = [];
      items.push(P.now('now', 0, 4, t, end));
      if (o.title) items.push(P.text('ttl', W, 4, o.title, 'glabel', 14, 'end'));
      items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: gy, label: 'CPU', final: end }).items);
      let Q = null;
      if (!end) { Q = P.queues({ st, jobs, x: 0, y: qy, subs: o.subs ? o.subs(st, t) : null, runSub: o.runSub ? o.runSub(st, t) : undefined }); items.push(...Q.items); }
      else items.push(P.text('fin', 0, qy + 27, o.endLine ? o.endLine(tr) : `every job has finished: average turnaround ${P.f(tr.metrics.avg.turnaround)}, waiting ${P.f(tr.metrics.avg.waiting)}, response ${P.f(tr.metrics.avg.response)}`, 'gwhy', 15));
      const fresh = P.finished(tr, prev, t);
      items.push(...P.table({ tr, t, x: 0, y: ty, final: end, fresh: end ? [] : fresh, mark: end && o.mark ? o.mark(tr) : null }).items);
      if (o.extra) items.push(...o.extra(st, t, { W, gy, qy, ty, end, Q }));
      const meta = Object.assign({ phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], decision: st.decision, step: st, fresh, rows: fresh.map((id) => tr.metrics.rows.find((r) => r.id === id)) }, o.metaOf ? o.metaOf(st, t) : {});
      let say = P.clean(st.say);
      if (end) { say = o.sayEnd ? o.sayEnd(tr) : P.sayEnd(tr); meta.metrics = tr.metrics; }
      out.push({ items, say, meta, title: end ? 'end' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
      prev = t;
    }
    return out;
  };
  P.sayEnd = (tr) => `Every job has finished at t = ${tr.end}. Waiting times ${tr.metrics.sumText.waiting}, an average of ${P.f(tr.metrics.avg.waiting)}; turnaround averages ${P.f(tr.metrics.avg.turnaround)} and response ${P.f(tr.metrics.avg.response)}.`;

  /** the prediction most scheduling topics ask: click the job the CPU takes next */
  P.askNext = (keyOf, ask) => ({
    at: (f) => !!(f.meta && f.meta.ask),
    pick: 'item',
    ask: ask || 'Before you step: which job does the CPU run next? Click it.',
    answer: (fr, i) => (keyOf ? keyOf(fr[i + 1].meta.run) : 'j:' + fr[i + 1].meta.run),
    explain: (fr, i) => fr[i + 1].say,
  });
  /** the same question answered by choosing a name (for pictures without job boxes) */
  P.askNextOpt = () => ({
    at: (f) => !!(f.meta && f.meta.ask),
    pick: 'option',
    ask: 'Before you step: which job does the CPU run next?',
    options: (fr, i) => (fr[i].meta.run ? [fr[i].meta.run] : []).concat(fr[i].meta.ready).filter((x, k, a) => a.indexOf(x) === k),
    answer: (fr, i) => fr[i + 1].meta.run,
    explain: (fr, i) => fr[i + 1].say,
  });
  /** mark up to n frames where the next frame dispatches a job already waiting in this one */
  P.markAsks = function (frames, n, cond) {
    const idx = [];
    frames.forEach((f, i) => {
      const nx = frames[i + 1];
      if (!nx || !f.meta || !nx.meta || nx.meta.phase !== 'tick' || !nx.meta.run || f.meta.phase !== 'tick') return;
      if (!['dispatch', 'preempt'].includes(nx.meta.decision)) return;
      const waiting = f.meta.ready || [];
      if (!waiting.includes(nx.meta.run) || waiting.length < 2 && !f.meta.run) return;
      if (nx.meta.run === f.meta.run) return;
      if (cond && !cond(f, nx)) return;
      idx.push(i);
    });
    for (const i of P.spread(idx, n || 3)) frames[i].meta.ask = true;
    return frames;
  };

  // ---- each job's life, tick by tick ---------------------------------------------------------------------------
  /** the state of every job at every tick of a single-CPU trace: {id: ['none' | 'run' | 'switch' | 'ready' | 'io' | 'done']} */
  P.states = function (tr) {
    const out = {};
    for (const j of tr.jobs) out[j.id] = [];
    tr.steps.forEach((st, t) => {
      if (st.kind === 'end') return;
      const io = new Set((st.io || []).map((e) => e.id)), rd = new Set(st.ready || []);
      for (const j of tr.jobs) {
        const r = tr.metrics.rows.find((x) => x.id === j.id);
        out[j.id][t] = st.run === j.id ? (st.cs ? 'switch' : 'run') : rd.has(j.id) ? 'ready' : io.has(j.id) ? 'io' : t < j.arrive ? 'none' : t >= r.finish ? 'done' : 'ready';
      }
    });
    return out;
  };
  /** runs of one state: [{state, start, end}] */
  P.runs = (arr, upTo) => { const out = []; for (let t = 0; t < Math.min(arr.length, upTo); t++) { const s = arr[t], l = out[out.length - 1]; if (l && l.state === s && l.end === t) l.end = t + 1; else out.push({ state: s, start: t, end: t + 1 }); } return out; };
  const LANE = { run: '', switch: 'p05cs', ready: 'p05wait', io: 'p05io', none: null, done: null };
  /**
   * one lane per job: what it was doing at each tick up to t. o {prefix, tr, jobs, t, x0, x1, y, rowH, gap, final,
   * focus (a job id: the others dimmed), labels: true (state words in long runs), names: true}
   */
  P.lanes = function (o) {
    const tr = o.tr, items = [], st = P.states(tr), T = o.T || tr.end, per = (o.x1 - o.x0) / T, X = (t) => Math.round((o.x0 + t * per) * 10) / 10;
    const rowH = o.rowH || 30, gap = o.gap || 10, upTo = o.final ? T : o.t, pre = o.prefix || 'ln';
    (o.only ? tr.jobs.filter((j) => j.id === o.only) : tr.jobs).forEach((j, k) => {
      const y = o.y + k * (rowH + gap), dim = o.focus && o.focus !== j.id;
      if (o.names !== false) items.push(Object.assign(P.text(pre + ':nm' + j.id, o.x0 - 10, y + rowH / 2 + 5, j.id, 'glname', 15, 'end'), dim ? { dim: true } : {}));
      items.push(...G().track({ prefix: pre + ':tk' + j.id, x: o.x0, y, w: o.x1 - o.x0, h: rowH }));
      for (const r of P.runs(st[j.id], upTo)) {
        if (LANE[r.state] === null) continue;
        const cls = r.state === 'run' ? 'gseg ' + P.pcls(o.jobs, j.id) : 'p05lane ' + LANE[r.state];
        const w = X(r.end) - X(r.start);
        const word = r.state === 'io' ? 'I/O' : r.state === 'ready' ? 'wait' : r.state === 'run' ? j.id : '';
        const fits = o.labels !== false && w >= S.geom.textWidth(word, 13) + 8;
        items.push({ key: pre + ':' + j.id + ':' + r.start, kind: 'cell', x: X(r.start), y, w: Math.round(w * 10) / 10, h: rowH, text: fits ? word : '', size: 13, cls: cls + (dim ? ' dim' : '') });
      }
    });
    return { items, X, h: tr.jobs.length * (rowH + gap) - gap, states: st };
  };
  /** a legend of the lane colours */
  P.laneLegend = function (key, x, y, which) {
    const items = [], all = [['run', 'running', 'gseg p0'], ['ready', 'waiting in the ready queue', 'p05lane p05wait'], ['io', 'doing I/O', 'p05lane p05io'], ['switch', 'context switch', 'p05lane p05cs']];
    let cx = x;
    for (const [k, word, cls] of all) {
      if (which && !which.includes(k)) continue;
      items.push({ key: key + ':b' + k, kind: 'cell', x: cx, y: y - 13, w: 22, h: 16, text: '', cls });
      items.push(P.text(key + ':t' + k, cx + 28, y, word, 'glabel', 13));
      cx += 28 + S.geom.textWidth(word, 13) + 22;
    }
    return items;
  };

  /** what is left of a job's current CPU burst at tick t, read from the trace: [left, burst index] */
  P.leftAt = function (tr, id, t) {
    const j = tr.jobs.find((x) => x.id === id);
    let ran = 0;
    for (let u = 0; u < t && u < tr.steps.length; u++) if (tr.steps[u].run === id && !tr.steps[u].cs) ran++;
    for (let k = 0; k < j.bursts.length; k += 2) { if (ran < j.bursts[k]) return [j.bursts[k] - ran, k / 2]; ran -= j.bursts[k]; }
    return [0, (j.bursts.length - 1) / 2];
  };
  /** horizontal bars on the chart's time scale: o {prefix, rows: [{id, len, cls, note}], jobs, per, x0, y, h, gap, label} */
  P.bars = function (o) {
    const items = [], h = o.h || 24, gap = o.gap || 6;
    if (o.label) items.push(P.text((o.prefix || 'br') + ':lab', 0, o.y - 10, o.label, 'glabel', 13));
    o.rows.forEach((r, k) => {
      const y = o.y + k * (h + gap), w = Math.max(4, Math.round(r.len * o.per * 10) / 10);
      items.push(P.text((o.prefix || 'br') + ':n' + r.id, o.x0 - 10, y + h / 2 + 5, r.id, 'glname', 14, 'end'));
      items.push({ key: (o.prefix || 'br') + ':' + r.id, kind: 'cell', x: o.x0, y, w, h, text: '', cls: 'gseg ' + P.pcls(o.jobs, r.id) + (r.cls ? ' ' + r.cls : '') });
      items.push(P.text((o.prefix || 'br') + ':v' + r.id, o.x0 + w + 8, y + h / 2 + 5, r.note || String(r.len), 'p05val' + (r.cls && r.cls.includes('now') ? ' act' : ''), 14));
    });
    return items;
  };

  /** a Gantt chart with one row per level, class or core: o {prefix, tr, segs, jobs, t, x0, x1, y, rows: [labels],
   *  rowOf(seg) -> index, h, gap, final, T, axis, marks: [{t, text}] (dashed lines, such as boosts)} */
  P.rowGantt = function (o) {
    const h = o.h || 28, gap = o.gap || 6, pre = o.prefix || 'rg', items = [];
    const rowY = (k) => o.y + k * (h + gap), span = o.rows.length * (h + gap) - gap;
    o.rows.forEach((lab, k) => {
      items.push(P.text(pre + ':rl' + k, o.x0 - 10, rowY(k) + h / 2 + 5, lab, 'glname', 14, 'end'));
      if (k) items.push(...G().track({ prefix: pre + ':t' + k, x: o.x0, y: rowY(k), w: o.x1 - o.x0, h }));
    });
    const g = P.gantt({ prefix: pre, tr: o.tr, segs: o.segs, jobs: o.jobs, t: o.t, x0: o.x0, x1: o.x1, y: o.y, h, T: o.T, final: o.final, row: (s) => rowY(o.rowOf(s)), span, axis: o.axis });
    items.push(...g.items);
    for (const m of o.marks || []) {
      if (!o.final && m.t > o.t) continue;
      items.push({ key: pre + ':mk' + m.t, kind: 'path', d: `M${g.X(m.t)},${o.y - 2} V${o.y + span + 4}`, cls: 'gboost', audit: 'ignore', layer: 'top' });
      if (m.text) items.push(P.text(pre + ':mt' + m.t, g.X(m.t), o.y + span + 20, m.text, 'gboost', 13, 'middle'));
    }
    return { items, X: g.X, h: span, rowY };
  };

  /** a definition panel: [title, text] or [title, lines] pairs */
  P.def = (...secs) => ({ sections: secs.map(([title, text], i) => (Array.isArray(text) ? { id: 's' + i, kind: 'math', title, text: text.join('\n') } : { id: 's' + i, title, text })) });
})(globalThis.Proses = globalThis.Proses || {});
