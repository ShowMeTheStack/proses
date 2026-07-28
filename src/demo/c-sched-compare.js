// FCFS, SRTN and round robin on the same workload, as three Gantt charts stacked on one time axis. Each step moves
// time to the next moment one of the three makes a decision; each policy shows what is on its CPU, its ready
// queue and the reason for its choice. The table under the charts fills in each job's turnaround, waiting and
// response time as it finishes, and the last step adds the sums and averages and calls out the convoy on FCFS.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const PRESETS = ['convoy', 'mixed', 'io'];
  const POLS = [['fcfs', 'FCFS', 'first come, first served'], ['srtn', 'SRTN', 'shortest remaining time next'], ['rr', 'RR', 'round robin']];

  /** the three runs, computed once per workload and quantum */
  function runs(preset, q) {
    return D.once('sched-cmp:' + preset + ':' + q, () => {
      const work = S.Sched.presets[preset].jobs;
      return POLS.map(([p]) => S.Sched.run(work, p, { quantum: q }));
    });
  }

  /** the convoy on FCFS: the burst that kept the most job-ticks of shorter jobs waiting behind it */
  function convoy(tr) {
    let best = null;
    for (const s of tr.segs) {
      const waiters = new Map();
      for (let t = s.start; t < s.end; t++) for (const id of tr.steps[t].ready) waiters.set(id, (waiters.get(id) || 0) + 1);
      const short = [...waiters.keys()].filter((id) => tr.jobs.find((j) => j.id === id).cpu < s.end - s.start);
      const cost = short.reduce((a, id) => a + waiters.get(id), 0);
      if (s.end - s.start >= 5 && short.length >= 2 && (!best || cost > best.cost)) best = { seg: s, ids: short.sort(), cost };
    }
    return best;
  }

  /** the moments worth a step: any policy decides something other than running on */
  function moments(trs) {
    const ts = new Set([0]);
    for (const tr of trs) {
      tr.steps.forEach((s, t) => { if (s.kind === 'end' || (s.decision !== 'continue' && !(s.decision === 'idle' && t > 0 && tr.steps[t - 1].decision === 'idle'))) ts.add(t); });
    }
    return [...ts].sort((a, b) => a - b);
  }

  const burstText = (j) => j.bursts.map((b, k) => (k % 2 ? '(' + b + ')' : String(b))).join(' ');
  const avgText = (v) => String(Math.round(v * 100) / 100);

  function frames(narrow, knobs) {
    const q = Math.round(knobs.q || 2), preset = PRESETS[Math.round(knobs.w || 0)] || 'convoy';
    const trs = runs(preset, q), jobs = trs[0].jobs.map((j) => j.id), T = Math.max(...trs.map((tr) => tr.end));
    const names = POLS.map(([, n]) => n);
    names[2] = 'RR q = ' + q;
    const cv = convoy(trs[0]);
    const ioJobs = trs[0].jobs.filter((j) => j.bursts.length > 1).length;
    const G = S.Kit.gantt;
    // the layout
    const W = narrow ? 380 : 1180;
    const L = narrow
      ? { x0: 10, x1: 370, axisY: 44, top: 64, BH: 150, barDy: 26, barH: 32, rowDy: 68, chip: [28, 26], whyDy: 116, size: 14 }
      : { x0: 170, x1: 1160, axisY: 18, top: 42, BH: 104, barDy: 4, barH: 36, rowDy: 50, chip: [30, 28], size: 14 };
    const tm = G.time({ x0: L.x0, x1: L.x1, t1: T });
    let step = 1;
    while (tm.per * step < (narrow ? 26 : 30)) step = step === 1 ? 2 : step === 2 ? 5 : step + 5;
    // the table under the charts
    const tableY = L.top + 3 * L.BH + (narrow ? 6 : 10);
    const cw = narrow ? 37 : 66;
    const cols = (narrow ? [{ w: 36, label: 'job' }] : [{ w: 64, label: 'job' }, { w: 84, label: 'arrives' }, { w: 190, label: 'CPU (I/O) bursts' }]);
    const m0 = cols.length;
    for (let k = 0; k < 3; k++) for (const lab of ['T', 'W', 'R']) cols.push({ w: cw, label: lab });
    const tableW = cols.reduce((a, c) => a + c.w, 0);
    const tableX = narrow ? Math.round((W - tableW) / 2) : L.x0;
    const groups = names.map((n, k) => ({ label: n, from: m0 + 3 * k, to: m0 + 3 * k + 2 }));
    const rowH = narrow ? 26 : 28;
    const tableH = (jobs.length + 4) * rowH;
    const legendY = tableY + tableH + (narrow ? 22 : 26);
    const legend = 'T turnaround = finish − arrival;  W waiting = time spent in the ready queue;  R response = first run − arrival';
    const legendLines = narrow ? G.wrap(legend.replace(/;  /g, '; '), W - 16, 12) : [legend];
    const H = legendY + (legendLines.length - 1) * 17 + 18;
    const view = narrow ? box(0, 0, W, H) : box(-14, 0, W + 14, H);
    const ts = moments(trs);
    const bestAvg = {};
    for (const k of ['turnaround', 'waiting', 'response']) bestAvg[k] = Math.min(...trs.map((tr) => tr.metrics.avg[k]));

    return ts.map((t, fi) => {
      const last = fi === ts.length - 1, items = [];
      items.push(...G.axis({ prefix: 'ax', X: tm.X, t1: T, y: L.axisY, step, size: 13 }));
      items.push({ key: 'now', kind: 'text', x: narrow ? L.x1 : 0, y: narrow ? 16 : L.axisY, text: last ? 'end, t = ' + t : 't = ' + t, anchor: narrow ? 'end' : 'start', size: 15, cls: 'gnow' });
      trs.forEach((tr, i) => {
        const yP = L.top + i * L.BH, pre = 'c' + i, st = tr.steps[Math.min(t, tr.end)];
        // the name
        if (narrow) items.push({ key: pre + ':nm', kind: 'text', x: L.x0, y: yP + 16, text: names[i] + ' · ' + POLS[i][2], size: 15, cls: 'gpol' });
        else {
          items.push({ key: pre + ':nm', kind: 'text', x: 0, y: yP + 22, text: names[i], size: 17, cls: 'gpol' });
          G.wrap(POLS[i][2], 150, 13).forEach((ln, k) => items.push({ key: pre + ':sub' + k, kind: 'text', x: 0, y: yP + 42 + k * 17, text: ln, size: 13, cls: 'gpolsub' }));
        }
        // the chart so far
        items.push(...G.track({ prefix: pre, x: L.x0, y: yP + L.barDy, w: L.x1 - L.x0, h: L.barH }));
        items.push(...G.bar({ prefix: pre, X: tm.X, segs: tr.segs, y: yP + L.barDy, h: L.barH, upTo: t, jobs, size: narrow ? 13 : 15 }));
        // the CPU and the ready queue
        const ry = yP + L.rowDy, [cwd, chh] = L.chip, done = t >= tr.end;
        let x = L.x0;
        if (!last) {
          items.push({ key: pre + ':cpuL', kind: 'text', x, y: ry + chh / 2 + 5, text: 'CPU', size: 13, cls: 'glabel' });
          x += 38;
          if (st.run) items.push(G.job(pre + ':q' + st.run, x, ry, st.run, jobs, { w: cwd, h: chh, cls: 'run' }));
          else items.push({ key: pre + ':idle', kind: 'cell', x, y: ry, w: cwd + 22, h: chh, text: done ? 'done' : 'idle', size: 13, cls: 'gslot' });
          x += (st.run ? cwd : cwd + 22) + 18;
          const qd = G.queue({ prefix: pre, x, y: ry, ids: st.ready || [], jobs, w: cwd, h: chh, label: 'ready', labelW: 48, keyOf: (id) => pre + ':q' + id });
          items.push(...qd.items);
          if (!st.ready || !st.ready.length) items.push({ key: pre + ':qe', kind: 'text', x: x + 48, y: ry + chh / 2 + 5, text: 'empty', size: 13, cls: 'glabel' });
          // the jobs away doing I/O, when the workload has any
          if (ioJobs) {
            const ix = x + 48 + (jobs.length - 1) * (cwd + 4) + 10;
            items.push(...G.queue({ prefix: pre + 'io', x: ix, y: ry, ids: (st.io || []).map((o) => o.id), jobs, w: cwd, h: chh, label: 'I/O', labelW: 32, cls: 'io', keyOf: (id) => pre + ':q' + id }).items);
          }
        }
        // the reason, or at the end the verdict
        let why = done ? (last ? `average waiting ${avgText(tr.metrics.avg.waiting)}, turnaround ${avgText(tr.metrics.avg.turnaround)}, response ${avgText(tr.metrics.avg.response)}` : `all done at t = ${tr.end}`) : st.why;
        if (last && i === 0 && cv) { /* the convoy is called out instead */ } else if (narrow) {
          G.wrap(why, L.x1 - L.x0, 14).slice(0, 2).forEach((ln, k) => items.push({ key: pre + ':why' + k, kind: 'text', x: L.x0, y: (last ? yP + L.rowDy + 14 : yP + L.whyDy) + k * 18, text: ln, size: 14, cls: 'gwhy' + (st.decision === 'preempt' && !done ? ' act' : '') }));
        } else {
          const wx = last ? L.x0 : L.x0 + 38 + cwd + 18 + 48 + (jobs.length - 1) * (cwd + 4) + 14 + (ioJobs ? 32 + ioJobs * (cwd + 4) : 0);
          items.push({ key: pre + ':why', kind: 'text', x: wx, y: ry + chh / 2 + 5, text: why, size: 14, cls: 'gwhy' + (st.decision === 'preempt' && !done ? ' act' : '') });
        }
        if (last && i === 0 && cv) {
          const s = cv.seg;
          const by = yP + L.barDy + L.barH + 4, bx = tm.X(s.start) + 2;
          items.push({ key: 'convoy', kind: 'bracket', x1: bx, x2: tm.X(s.end) - 2, y: by, side: 'below', cls: 'hot' });
          const msg = `convoy: ${S.Sched.list(cv.ids)} wait behind ${s.job}'s ${s.end - s.start}-tick burst`, tx = Math.min(bx, Math.max(L.x0, L.x1 - S.geom.textWidth(msg, 14, { bold: true }) - 4));
          G.wrap(msg, L.x1 - tx, 14).forEach((ln, k) => items.push({ key: 'convoy:t' + k, kind: 'text', x: tx, y: by + 30 + k * 18, text: ln, size: 14, cls: 'hot' }));
        }
      });
      // the time cursor across the three charts
      items.push(...G.cursor({ prefix: 'cur', X: tm.X, t, y1: L.axisY + 12, y2: narrow ? L.top - 2 : L.top + L.barDy - 4 }));
      trs.forEach((tr, i) => { const y = L.top + i * L.BH + L.barDy; items.push(...G.cursor({ prefix: 'cur' + i, X: tm.X, t, y1: y - 4, y2: y + L.barH + 4 })); });
      // the table: workload, then each job's metrics as it finishes, then sums and averages at the end
      const rows = trs[0].jobs.map((j) => {
        const cells = [{ text: j.id, cls: 'p' + (j.idx % 6) }];
        if (!narrow) cells.push(String(j.arrive), burstText(j));
        trs.forEach((tr, i) => {
          const r = tr.metrics.rows[j.idx], fin = r.finish <= t, fresh = fin && !last && fi > 0 && r.finish > ts[fi - 1];
          const stuck = last && i === 0 && cv && cv.ids.includes(j.id);
          for (const k of ['turnaround', 'waiting', 'response']) cells.push(fin ? { text: r[k], cls: fresh ? 'fresh' : stuck && k === 'waiting' ? 'worst' : '' } : '');
        });
        return { cells, key: j.id };
      });
      const sumRow = { key: 'sum', cls: 'gsum', cells: [narrow ? 'Σ' : 'sum'].concat(narrow ? [] : ['', '']) }, avgRow = { key: 'avg', cls: 'gsum', cells: [narrow ? 'avg' : 'average'].concat(narrow ? [] : ['', '']) };
      trs.forEach((tr) => {
        for (const k of ['turnaround', 'waiting', 'response']) {
          sumRow.cells.push(last ? String(tr.metrics.sum[k]) : '');
          avgRow.cells.push(last ? { text: avgText(tr.metrics.avg[k]), cls: tr.metrics.avg[k] === bestAvg[k] ? 'best' : '' } : '');
        }
      });
      const tb = G.table({ prefix: 'tb', x: tableX, y: tableY, cols, groups, rows: rows.concat([sumRow, avgRow]), rowH, size: narrow ? 13 : 14 });
      items.push(...tb.items);
      legendLines.forEach((ln, k) => items.push({ key: 'lg' + k, kind: 'text', x: narrow ? 10 : tableX, y: legendY + k * 17, text: ln, size: narrow ? 12 : 13, cls: 'glabel' }));
      // the narration
      const ev = trs[0].events.filter((e) => e.t === t && e.kind === 'arrive').map((e) => e.job);
      let say;
      if (last) {
        const a = trs.map((tr, i) => `\`${avgText(tr.metrics.avg.waiting)}\` under ${names[i]}`);
        say = `All done: the average wait is ${S.Sched.list(a)}` + (cv ? `; on FCFS ${S.Sched.list(cv.ids)} sit behind ${cv.seg.job}'s ${cv.seg.end - cv.seg.start}-tick burst, the convoy effect.` : '.');
      } else {
        const parts = trs.map((tr, i) => (t < tr.end ? `${names[i]}: ${tr.steps[t].why}` : `${names[i]}: done`));
        say = `At t = \`${t}\`${ev.length ? ' ' + S.Sched.list(ev) + (ev.length > 1 ? ' arrive' : ' arrives') : ''}: ${parts.join('; ')}.`;
      }
      return { items, say, view, title: last ? 'metrics' : 't = ' + t, hold: last ? 4000 : 2400 };
    });
  }

  D.add({
    id: 'sched-compare', order: 40, tag: 'Scheduling · policies', short: 'FCFS, SRTN, RR', title: 'Three schedulers, one workload',
    blurb: 'FCFS, shortest remaining time next and round robin run the same jobs on one time axis. Each step moves to the next decision; the table fills in as jobs finish. ' + 'Ties go to the job that has waited longest.',
    knobs: [
      { id: 'w', label: 'Workload', type: 'select', value: 0, options: PRESETS.map((p, i) => ({ value: i, label: S.Sched.presets[p].name })) },
      { id: 'q', label: 'RR quantum', min: 1, max: 6, step: 1, value: 2, fmt: (v) => Math.round(v) + (Math.round(v) === 1 ? ' tick' : ' ticks') },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs || {}); },
    trace: (knobs) => runs(PRESETS[(knobs && knobs.w) || 0], (knobs && knobs.q) || 2),
  });
})(globalThis.Proses = globalThis.Proses || {});
