// A multi-level feedback queue at work on two long compute jobs and an interactive one. The queues are drawn as
// lanes, Q0 on top; each job's box shows how much of its allotment it has used at its level. The hogs use up
// their allotments and sink a level at a time; the interactive job runs a tick and blocks, so it stays in Q0 and
// preempts the hogs whenever it comes back; the boost lifts everyone to Q0. Under the queues, a Gantt chart with
// one row per level shows where each job ran, and the boosts as dashed lines.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;

  function run(knobs) {
    const p = { levels: Math.round(knobs.levels || 3), quantum: [Math.round(knobs.q || 2)], allot: Math.round(knobs.allot || 4), boost: Math.round(knobs.boost === undefined ? 24 : knobs.boost) };
    return D.once('mlfq:' + JSON.stringify(p), () => S.Sched.mlfq(S.Sched.presets.mlfq.jobs, p));
  }
  const KIND = { A: 'compute', B: 'compute', C: 'interactive' };

  function frames(narrow, knobs) {
    const tr = run(knobs), P = tr.params, n = P.levels, G = S.Kit.gantt;
    const jobs = tr.jobs.map((j) => j.id), T = tr.end;
    const al = (k) => (P.allot[k] === Infinity ? '∞' : P.allot[k]);
    // the layout
    const W = narrow ? 380 : 1180;
    const laneH = narrow ? 56 : 62, laneGap = narrow ? 8 : 10;
    const lanesW = narrow ? W : 640, nameW = narrow ? 112 : 230;
    const chip = narrow ? [44, 44] : [52, 46];
    const lanesH = n * laneH + (n - 1) * laneGap;
    const cpuBox = narrow ? { x: 0, y: lanesH + 20, w: 130, h: 92 } : { x: 690, y: 0, w: 150, h: lanesH };
    const ioBox = narrow ? { x: 142, y: lanesH + 20, w: W - 142, h: 92 } : { x: 870, y: 0, w: W - 870, h: lanesH };
    const gTop = (narrow ? cpuBox.y + cpuBox.h : lanesH) + (narrow ? 58 : 64);
    const gx0 = narrow ? 34 : 60, gx1 = W - (narrow ? 14 : 10), rowH = narrow ? 26 : 32, rowGap = 6;
    const tm = G.time({ x0: gx0, x1: gx1, t1: T });
    let step = 1;
    while (tm.per * step < (narrow ? 26 : 30)) step = step === 1 ? 2 : step === 2 ? 5 : step + 5;
    const rowY = (k) => gTop + 10 + k * (rowH + rowGap);
    const gBottom = rowY(n - 1) + rowH;
    const tableY = gBottom + (narrow ? 34 : 40);
    const cols = narrow
      ? [{ w: 44, label: 'job' }, { w: 112, label: 'turnaround' }, { w: 96, label: 'waiting' }, { w: 104, label: 'response' }]
      : [{ w: 64, label: 'job' }, { w: 130, label: 'kind' }, { w: 170, label: 'CPU' }, { w: 80, label: 'I/O' }, { w: 110, label: 'finishes' }, { w: 130, label: 'turnaround' }, { w: 110, label: 'waiting' }, { w: 120, label: 'response' }];
    const tableW = cols.reduce((a, c) => a + c.w, 0), tableX = Math.round((W - tableW) / 2);
    const tRowH = narrow ? 26 : 28;
    const H = tableY + (jobs.length + 1) * tRowH + 10;
    const view = narrow ? box(-4, -8, W + 8, H + 8) : box(-10, -10, W + 20, H + 20);
    // the moments worth a step
    const ts = tr.steps.map((s, t) => t).filter((t) => tr.steps[t].decision !== 'continue' && !(tr.steps[t].decision === 'idle' && t > 0 && tr.steps[t - 1].decision === 'idle'));
    const boosts = tr.events.filter((e) => e.kind === 'boost').map((e) => e.t);

    return ts.map((t, fi) => {
      const st = tr.steps[t], last = st.kind === 'end', items = [];
      // the lanes
      for (let k = 0; k < n; k++) {
        const y = k * (laneH + laneGap);
        const sub = narrow ? `q ${P.quantum[k]} · allot ${al(k)}` : `quantum ${P.quantum[k]} · allotment ${P.allot[k] === Infinity ? 'none' : P.allot[k]}`;
        items.push(...G.lane({ prefix: 'ln' + k, x: 0, y, w: lanesW, h: laneH, name: 'Q' + k + (k === 0 ? (narrow ? '' : '  most urgent') : k === n - 1 && !narrow ? '  least urgent' : ''), sub, cls: (k === 0 ? 'top' : '') + (st.boosted && k === 0 ? ' boost' : ''), size: narrow ? 15 : 16 }));
        let x = nameW;
        for (const id of st.queues[k] || []) {
          items.push(G.job('mq:' + id, x, y + (laneH - chip[1]) / 2, id, jobs, { w: chip[0], h: chip[1], size: 15 }));
          items[items.length - 1].lines = [id, st.used[id] + '/' + al(k)];
          items[items.length - 1].size = narrow ? 13 : 14;
          x += chip[0] + 6;
        }
        if (!(st.queues[k] || []).length) items.push({ key: 'ln' + k + ':empty', kind: 'text', x: nameW, y: y + laneH / 2 + 5, text: 'empty', size: 13, cls: 'glabel' });
      }
      // the CPU and the jobs in I/O
      items.push({ key: 'cpu', kind: 'cell', x: cpuBox.x, y: cpuBox.y, w: cpuBox.w, h: cpuBox.h, text: '', cls: 'gcpu', audit: 'group', layer: 'back' });
      items.push({ key: 'cpu:l', kind: 'text', x: cpuBox.x + 12, y: cpuBox.y + 22, text: 'CPU', size: 15, cls: 'glname' });
      if (st.run) {
        const c = G.job('mq:' + st.run, cpuBox.x + (cpuBox.w - chip[0]) / 2, cpuBox.y + (narrow ? 38 : cpuBox.h / 2 - chip[1] / 2 + 8), st.run, jobs, { w: chip[0], h: chip[1], cls: 'run' });
        c.lines = [st.run, st.used[st.run] + '/' + al(st.level)]; c.size = narrow ? 13 : 14;
        items.push(c);
        items.push({ key: 'cpu:lv', kind: 'text', x: cpuBox.x + cpuBox.w - 12, y: cpuBox.y + 22, text: 'at Q' + st.level, anchor: 'end', size: 13, cls: 'glabel' });
      } else items.push({ key: 'cpu:idle', kind: 'text', x: cpuBox.x + cpuBox.w / 2, y: cpuBox.y + cpuBox.h / 2 + 14, text: last ? 'all done' : 'idle', anchor: 'middle', size: 14, cls: 'glabel' });
      items.push({ key: 'io', kind: 'cell', x: ioBox.x, y: ioBox.y, w: ioBox.w, h: ioBox.h, text: '', cls: 'gio', audit: 'group', layer: 'back' });
      items.push({ key: 'io:l', kind: 'text', x: ioBox.x + 12, y: ioBox.y + 22, text: 'I/O', size: 15, cls: 'glname' });
      (st.io || []).forEach((o, k) => {
        const c = G.job('mq:' + o.id, ioBox.x + 12 + k * (chip[0] + 30), ioBox.y + (narrow ? 38 : ioBox.h / 2 - chip[1] / 2 + 8), o.id, jobs, { w: chip[0] + 24, h: chip[1], cls: 'io' });
        c.lines = [o.id + ' at Q' + st.lv[o.id], 'back ' + o.until]; c.size = narrow ? 12 : 13;
        items.push(c);
      });
      // the Gantt chart, one row per level
      items.push(...G.axis({ prefix: 'gx', X: tm.X, t1: T, y: gTop - 14, step, size: 13 }));
      for (let k = 0; k < n; k++) {
        items.push({ key: 'gr' + k, kind: 'text', x: gx0 - 10, y: rowY(k) + rowH / 2 + 5, text: 'Q' + k, anchor: 'end', size: 14, cls: 'glname' });
        items.push(...G.track({ prefix: 'gt' + k, x: gx0, y: rowY(k), w: gx1 - gx0, h: rowH }));
      }
      items.push(...G.bar({ prefix: 'gb', X: tm.X, segs: tr.segs, h: rowH, upTo: t, jobs, row: (s) => rowY(s.level), size: narrow ? 12 : 14 }));
      for (const b of boosts) {
        if (b > t) continue;
        items.push({ key: 'bst' + b, kind: 'path', d: `M${tm.X(b)},${gTop - 2} V${gBottom + 6}`, cls: 'gboost', audit: 'ignore', layer: 'top' });
        items.push({ key: 'bst' + b + ':t', kind: 'text', x: tm.X(b), y: gBottom + 22, text: 'boost', anchor: 'middle', size: 12, cls: 'gboost' });
      }
      if (!last) items.push(...G.cursor({ prefix: 'gc', X: tm.X, t, y1: gTop - 2, y2: gBottom + 4 }));
      items.push({ key: 'gnow', kind: 'text', x: narrow ? W : 0, y: narrow ? gTop - 36 : gTop - 36, text: last ? 'end, t = ' + t : 't = ' + t, anchor: narrow ? 'end' : 'start', size: 15, cls: 'gnow' });
      // the metrics, as jobs finish
      const rows = tr.metrics.rows.map((r, k) => {
        const j = tr.jobs[k], fin = r.finish <= t;
        const cells = [{ text: r.id, cls: 'p' + (k % 6) }];
        if (!narrow) cells.push({ text: KIND[r.id] || '', cls: 'muted' }, j.bursts.length > 1 ? `${j.cpu} in ${(j.bursts.length + 1) / 2} bursts` : String(j.cpu), String(j.io), fin ? String(r.finish) : '');
        for (const m of ['turnaround', 'waiting', 'response']) cells.push(fin ? String(r[m]) : '');
        return { key: r.id, cells };
      });
      items.push(...G.table({ prefix: 'mt', x: tableX, y: tableY, cols, rows, rowH: tRowH, size: narrow ? 13 : 14 }).items);
      const say = last ? `At t = \`${t}\` every job has finished: the interactive C waited \`${tr.metrics.rows[2].waiting}\` ticks in all and was first served \`${tr.metrics.rows[2].response}\` after it arrived, while the hogs A and B turned around in \`${tr.metrics.rows[0].turnaround}\` and \`${tr.metrics.rows[1].turnaround}\`.` : st.say;
      return { items, say, view, title: last ? 'end' : st.boosted ? 'boost' : st.decision === 'preempt' ? 'preempt' : 't = ' + t, hold: st.boosted || last ? 3600 : 2400 };
    });
  }

  D.add({
    id: 'mlfq', order: 42, tag: 'Scheduling · MLFQ', short: 'MLFQ', title: 'A multi-level feedback queue',
    blurb: 'Two compute jobs and an interactive one under a ladder of queues, Q0 the most urgent. A job that uses up its allotment at a level drops a level; the interactive job blocks before it does, so it stays on top; every so often a boost lifts everyone back to Q0.',
    knobs: [
      { id: 'levels', label: 'Levels', min: 2, max: 4, step: 1, value: 3, fmt: (v) => String(Math.round(v)) },
      { id: 'q', label: 'Q0 quantum (doubles per level)', min: 1, max: 4, step: 1, value: 2, fmt: (v) => Math.round(v) + (Math.round(v) === 1 ? ' tick' : ' ticks') },
      { id: 'allot', label: 'Allotment per level', min: 2, max: 12, step: 1, value: 4, fmt: (v) => Math.round(v) + ' ticks' },
      { id: 'boost', label: 'Boost every', min: 0, max: 48, step: 4, value: 24, fmt: (v) => (Math.round(v) ? Math.round(v) + ' ticks' : 'never') },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs || {}); },
    trace: (knobs) => run(knobs || {}),
  });
})(globalThis.Proses = globalThis.Proses || {});
