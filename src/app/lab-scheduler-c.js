// The Scheduler lab, part three: policies side by side. One block per policy on a shared time axis: its name and
// flags, its Gantt chart (a row per level, class or core where it has them), the CPU, its ready queues and the jobs
// in I/O at this tick, and why it chose what runs now. A comparison table under the blocks fills in as each policy
// finishes, the best averages marked. Starvation and convoys are flagged where they happen.
//   SL.compare(v, ctx) -> result
//   SL.jobTables(runs, t) / SL.compareMetrics(runs, t): the side panel's tables and metrics at tick t
(function (S) {
  'use strict';
  const SL = S.SchedLab;
  const G = () => S.Kit.gantt;
  const tw = (s, size, bold) => S.geom.textWidth(String(s), size, bold ? { bold: true } : undefined);
  const T = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, text: String(text), cls: cls || '', size: size || 14, anchor: anchor || 'start' });
  const f2 = (x) => String(Math.round(x * 100) / 100);
  SL.f2 = f2; SL.T = T; SL.tw = tw;
  SL.clean = (s) => String(s || '').replace(/`/g, '');
  SL.pcls = (jobs, id) => 'p' + (Math.max(0, jobs.indexOf(id)) % 6);
  /** a step of ticks for an axis, so the numbers stay apart */
  SL.tickStep = (per, min) => { let s = 1; while (per * s < (min || 26)) s = s === 1 ? 2 : s === 2 ? 5 : s + 5; return s; };
  /** a sentence cut to one line of the width, or wrapped to n lines */
  SL.fit = function (text, width, size, n) {
    const lines = G().wrap(text, width, size);
    if (lines.length <= (n || 1)) return lines;
    const out = lines.slice(0, n || 1);
    let last = out[out.length - 1];
    while (last.length > 3 && tw(last + ' …', size) > width) last = last.slice(0, last.lastIndexOf(' ') > 0 ? last.lastIndexOf(' ') : last.length - 2);
    out[out.length - 1] = last + ' …';
    return out;
  };

  /** the rows a policy's chart has, and the row of each segment */
  SL.rowsOf = function (tr, v) {
    if (tr.policy === 'mlfq') return { names: Array.from({ length: tr.params.levels }, (_, k) => 'Q' + k), of: (s) => s.level || 0 };
    if (tr.policy === 'mlq') return { names: tr.params.classes.map((c) => c.name), of: (s) => s.cls || 0 };
    if (tr.policy === 'multi') return { names: Array.from({ length: tr.params.cores }, (_, k) => 'core ' + k), of: (s) => s.core || 0 };
    return { names: ['CPU'], of: () => 0 };
  };

  /** the queues at a step, as labelled groups of job boxes: [{label, ids, kind: 'run' | 'ready' | 'io', subs}] */
  SL.groups = function (tr, st) {
    const out = [];
    if (st.kind === 'end') return out;
    if (st.cores) {
      for (const c of st.cores) out.push({ label: 'core ' + c.id, ids: c.run ? [c.run] : [], kind: 'run', cs: c.cs, extra: tr.params.queue === 'per-core' ? c.queue : null });
      if (tr.params.queue !== 'per-core') out.push({ label: 'ready', ids: st.shared || [], kind: 'ready' });
    } else {
      out.push({ label: 'CPU', ids: st.run ? [st.run] : [], kind: 'run', cs: st.cs });
      if (tr.policy === 'mlfq') st.queues.forEach((q, k) => out.push({ label: 'Q' + k, ids: q, kind: 'ready' }));
      else if (tr.policy === 'mlq') st.queues.forEach((q, k) => out.push({ label: tr.params.classes[k].name, ids: q, kind: 'ready' }));
      else out.push({ label: 'ready', ids: st.ready || [], kind: 'ready' });
    }
    out.push({ label: 'I/O', ids: (st.io || []).map((e) => e.id), kind: 'io', subs: Object.fromEntries((st.io || []).map((e) => [e.id, '→' + e.until])) });
    return out;
  };

  /** lay groups out left to right from x, wrapping at xr: {items, lines} */
  function flow(pre, groups, jobs, x0, xr, y, starving, narrow, dense) {
    const items = [], bw = narrow ? 26 : dense ? 26 : 30, bh = dense ? 22 : 26, lh = dense ? 27 : 32, gap = narrow ? 3 : 4;
    let x = x0, line = 0;
    const box = (id, kind, sub, cs) => {
      const text = sub ? id + sub : id, w = sub ? Math.max(bw, Math.ceil(tw(text, 13, true) + 10)) : Math.max(bw, Math.ceil(tw(id, 14, true) + 10));
      return { w, it: (xx, yy) => ({ key: pre + 'j:' + id, kind: 'cell', x: xx, y: yy, w, h: bh, rx: 5, text, size: sub ? 13 : 14, cls: 'gjob ' + SL.pcls(jobs, id) + (kind === 'run' ? ' run' + (cs ? ' p05sw' : '') : kind === 'io' ? ' io' : '') + (starving.includes(id) && kind === 'ready' ? ' slstarve' : '') }) };
    };
    groups.forEach((g, gi) => {
      const lab = g.label, lw = Math.ceil(tw(lab, 13)) + 6;
      const boxes = g.ids.map((id) => box(id, g.kind, g.subs ? g.subs[id] : null, g.cs)).concat((g.extra || []).map((id) => box(id, 'ready', null)));
      const empty = !boxes.length ? (g.kind === 'run' ? 'idle' : g.kind === 'io' ? 'none' : 'empty') : null;
      const need = lw + (empty ? Math.ceil(tw(empty, 13)) + 4 : boxes.reduce((a, b) => a + b.w + gap, 0)) + 14;
      if (x > x0 && x + need > xr) { x = x0; line++; }
      const yy = y + line * lh;
      items.push(T(pre + 'gl' + gi, x, yy + bh / 2 + 5, lab, 'glabel', 13));
      x += lw;
      if (empty) { items.push(T(pre + 'ge' + gi, x, yy + bh / 2 + 5, empty, 'glabel slmuted', 13)); x += Math.ceil(tw(empty, 13)) + 4; }
      boxes.forEach((b, k) => { items.push(b.it(x, yy)); if (g.extra && k === g.ids.length - 1 && g.extra.length) x += 2; x += b.w + gap; });
      x += 14;
    });
    return { items, lines: line + 1, endX: x };
  }

  /** the side panel's tables at tick t: each policy's jobs, filling in as they finish, with the sums worked out */
  SL.jobTables = function (runs, t, final) {
    return runs.map((r) => {
      const m = r.tr.metrics, rows = m.rows.map((x) => {
        const done = final || x.finish <= t, d = (val) => (done ? String(val) : '–');
        return [{ text: x.id, cls: '' }, String(x.arrive), String(x.cpu), String(x.io), d(x.finish), d(x.turnaround), d(x.waiting), d(x.response)];
      });
      const all = final || m.rows.every((x) => x.finish <= t);
      if (all) rows.push([{ text: 'sum', cls: 'act' }, '', '', '', '', m.sumText.turnaround, m.sumText.waiting, m.sumText.response], [{ text: 'mean', cls: 'act' }, '', '', '', '', f2(m.avg.turnaround), f2(m.avg.waiting), f2(m.avg.response)]);
      return { title: r.name, cols: ['Job', 'Arrives', 'CPU', 'I/O', 'Finish', 'Turnaround', 'Waiting', 'Response'], rows, note: all ? 'turnaround = finish − arrival; waiting = turnaround − CPU − I/O; response = first run − arrival' : 'rows fill in as jobs finish' };
    });
  };
  /** the burst predictions of a predicting policy, each shown once its burst has ended by tick t */
  SL.predTable = function (r, v, t) {
    const tr = r.tr;
    if (!tr.predictions) return null;
    if (!r.predEnds) r.predEnds = tr.predictions.map((p) => {
      const j = tr.jobs.find((x) => x.id === p.job);
      let need = 0;
      for (let k = 0; k <= p.burst; k++) need += j.bursts[2 * k];
      let u = 0;
      while (u <= tr.end && SL.ranBefore(tr, p.job, u) < need) u++;
      return u;
    });
    const rows = tr.predictions.map((p, i) => [p.job, String(p.burst + 1), f2(p.predicted), String(p.actual), r.predEnds[i] <= t ? f2(v.alpha) + '·' + p.actual + ' + ' + f2(1 - v.alpha) + '·' + f2(p.predicted) + ' = ' + f2(p.next) : '–']).filter((row, i) => r.predEnds[i] <= t);
    return { title: r.name + ': bursts guessed', cols: ['Job', 'Burst', 'Guess τ', 'Actual t', 'Next τ = α·t + (1 − α)·τ'], rows, note: rows.length ? 'each row appears when its burst ends' : 'no burst has ended yet' };
  };
  SL.compareMetrics = function (runs, t, final) {
    const out = [];
    for (const r of runs) {
      const m = r.tr.metrics, all = final || r.tr.end <= t;
      out.push({ label: r.name + ': mean turnaround', value: all ? f2(m.avg.turnaround) : '–', unit: 'ticks', cls: all && r.best.turnaround ? 'good' : '' });
      out.push({ label: r.name + ': mean waiting', value: all ? f2(m.avg.waiting) : '–', unit: 'ticks', cls: all && r.best.waiting ? 'good' : '' });
      out.push({ label: r.name + ': mean response', value: all ? f2(m.avg.response) : '–', unit: 'ticks', cls: all && r.best.response ? 'good' : '' });
      out.push({ label: r.name + ': CPU busy', value: all ? f2(m.util * 100) + '%' : '–', note: all ? m.busy + ' of ' + m.end + ' ticks' + (r.tr.policy === 'multi' ? ' on ' + r.tr.params.cores + ' cores' : '') + (m.overhead ? ', ' + m.overhead + ' switching' : '') : '' });
      out.push({ label: r.name + ': throughput', value: all ? f2(m.throughput) : '–', unit: 'jobs a tick' });
      const fl = r.flags;
      if (fl.convoy.length || fl.starve.length) out.push({ label: r.name + ': flags', value: [fl.convoy.length ? 'convoy behind ' + [...new Set(fl.convoy.map((c) => c.job))].join(', ') : '', fl.starve.length ? 'starved ' + fl.starve.map((s) => s.job + ' (' + s.ticks + ')').join(', ') : ''].filter(Boolean).join('; '), cls: 'bad' });
    }
    return out;
  };

  SL.compare = function (v, ctx) {
    const narrow = ctx.narrow, slots = SL.slots(v);
    const runs = slots.map((s) => {
      const tr = SL.runOne(s, v, ctx.seed);
      return { slot: s, tr, name: SL.name(s, v), flags: SL.flags(tr, v), rows: SL.rowsOf(tr, v) };
    });
    const jobs = runs[0].tr.jobs.map((j) => j.id), End = Math.max(...runs.map((r) => r.tr.end));
    for (const k of ['turnaround', 'waiting', 'response']) { const best = Math.min(...runs.map((r) => r.tr.metrics.avg[k])); for (const r of runs) { r.best = r.best || {}; r.best[k] = runs.length > 1 && Math.abs(r.tr.metrics.avg[k] - best) < 1e-9; } }
    const W = narrow ? 380 : 980, X0 = narrow ? 58 : 150, X1 = W - 8;
    const tm = G().time({ x0: X0, x1: X1, t1: End }), step = SL.tickStep(tm.per, narrow ? 24 : 28);
    const qx = narrow ? 0 : X0 - 92;
    // lay out the blocks once, from the most room any tick needs; when four charts would not fit the stage at full
    // size, the rows, the queue boxes and the table close up
    let rowH = 28, rowGap = 4, LH = 32, dense = false, y = 58;
    const layout = () => {
      y = 58;
      for (const r of runs) {
        r.y = y;
        let maxLines = 1;
        for (const st of r.tr.steps) maxLines = Math.max(maxLines, flow('m', SL.groups(r.tr, st), jobs, qx, X1, 0, [], narrow, dense).lines);
        r.barY = y + 14;
        r.barsH = r.rows.names.length * (rowH + rowGap) - rowGap;
        r.brY = r.barY + r.barsH + 6;
        r.qY = r.brY + (r.flags.convoy.length ? 36 : 4);
        // wide: the reason sits beside the name and the flags at the end of the queues; narrow: each on lines of its own
        r.whyY = narrow ? r.qY + maxLines * LH + 10 : r.y + 4;
        r.whyLines = narrow ? 2 : 1;
        y = narrow ? r.whyY + 17 + 26 : r.qY + maxLines * LH + (dense ? 16 : 22);
      }
    };
    layout();
    if (!narrow && y + 40 + 28 * (runs.length + 1) > 660) { dense = true; rowH = 22; rowGap = 3; LH = 27; layout(); }
    const tRowH = dense ? 24 : 28;
    const tableY = y + 4;
    const frames = [];
    for (let t = 0; t <= End; t++) {
      const items = [T('now', 0, 4, t >= End ? 'end, t = ' + t : 't = ' + t, 'gnow', 15)];
      items.push(...G().axis({ prefix: 'ax', X: tm.X, t1: End, y: 24, step, size: 13 }));
      const says = [];
      runs.forEach((r, k) => {
        const tr = r.tr, pre = 'r' + k, st = tr.steps[Math.min(t, tr.steps.length - 1)], ended = t >= tr.end;
        // the header: the policy's name and its flags so far
        const starving = r.flags.starve.filter((s) => s.at <= t && s.to >= t).map((s) => s.job);
        const flagText = [];
        for (const c of r.flags.convoy) if (c.start < t) flagText.push('convoy: ' + c.held.join(', ') + ' wait behind ' + c.job);
        for (const s of r.flags.starve) if (s.at <= t) flagText.push(s.job + (s.to >= t ? ' starving: ' + Math.min(s.ticks, t - s.from) + ' ticks waiting' : ' starved ' + s.ticks + ' ticks'));
        const nameW = Math.ceil(tw(r.name, 15, true));
        items.push(T(pre + 'nm', 0, r.y + 4, r.name, 'gpol slpol', 15));
        if (flagText.length && narrow) {
          const room = X1 - nameW - 24;
          const ft = SL.fit([...new Set(flagText)].join(' · '), room, 13, 1)[0];
          items.push(T(pre + 'fl', X1, r.y + 4, '⚑ ' + ft, 'bad', 13, 'end'));
        }
        // the chart, a row per level, class or core
        r.rows.names.forEach((nm, i) => {
          const ry = r.barY + i * (rowH + rowGap);
          items.push(T(pre + 'rl' + i, X0 - 8, ry + rowH / 2 + 5, nm, 'glname slrow', 13, 'end'));
          items.push(...G().track({ prefix: pre + 't' + i, x: X0, y: ry, w: X1 - X0, h: rowH }));
        });
        for (const it of G().bar({ prefix: pre + 'g', X: tm.X, segs: tr.segs.filter((s) => !s.cs && !s.warm), y: r.barY, h: rowH, upTo: t, jobs, now: ended ? undefined : t, size: 14, row: (s) => r.barY + r.rows.of(s) * (rowH + rowGap) })) {
          if (it.text && tw(it.text, 14, true) + 6 > it.w) it.text = '';
          items.push(it);
        }
        tr.segs.forEach((s, i) => {
          if (!(s.cs || s.warm) || s.start >= t) return;
          const x = tm.X(s.start);
          items.push({ key: pre + 'cs' + i, kind: 'cell', x, y: r.barY + r.rows.of(s) * (rowH + rowGap), w: Math.max(1, tm.X(Math.min(s.end, t)) - x), h: rowH, text: '', cls: s.cs ? 'p05cs' : 'p05warm', audit: 'overlap-ok' });
        });
        // MLFQ boosts: a dashed line at each boost so far
        if (tr.policy === 'mlfq' && tr.params.boost) for (let u = tr.params.boost; u <= Math.min(t, tr.end); u += tr.params.boost) items.push({ key: pre + 'bo' + u, kind: 'path', d: `M${tm.X(u)},${r.barY - 3} V${r.barY + r.barsH + 3}`, cls: 'gboost', audit: 'ignore', layer: 'top' });
        if (!ended) items.push(...G().cursor({ prefix: pre + 'c', X: tm.X, t, y1: r.barY - 4, y2: r.barY + r.barsH + 4 }));
        let lastEnd = -Infinity;
        for (const [ci, c] of r.flags.convoy.entries()) {
          if (c.start >= t) continue;
          const x1 = tm.X(c.start), x2 = tm.X(Math.min(c.end, t));
          const lab = narrow ? 'convoy' : 'convoy: ' + c.held.join(', ') + ' wait';
          let text = x2 - x1 > tw(lab, 13, true) + 8 ? lab : 'convoy';
          const half = tw(text, 13, true) / 2 + 6, mid = (x1 + x2) / 2;
          if (mid - half < lastEnd) text = ''; else lastEnd = mid + half;
          items.push({ key: pre + 'cv' + ci, kind: 'bracket', x1, x2, y: r.brY, side: 'below', text, size: 13, cls: 'hot' });
        }
        // the queues, or the result
        if (!ended) {
          const fl = flow(pre, SL.groups(tr, st), jobs, qx, X1, r.qY, starving, narrow, dense);
          items.push(...fl.items);
          const room = X1 - fl.endX - 8;
          if (flagText.length && !narrow && room > 80) items.push(T(pre + 'fl', X1, r.qY + (fl.lines - 1) * LH + (dense ? 16 : 18), '⚑ ' + SL.fit([...new Set(flagText)].join(' · '), room - 16, 13, 1)[0], 'bad', 13, 'end'));
        }
        else items.push(T(pre + 'done', qx, r.qY + 18, 'all ' + tr.jobs.length + ' jobs done at t = ' + tr.end + ': mean turnaround ' + f2(tr.metrics.avg.turnaround) + ', waiting ' + f2(tr.metrics.avg.waiting) + (narrow ? '' : ', response ' + f2(tr.metrics.avg.response)), 'gwhy', 14));
        // why this job now
        const why = ended ? '' : st.why ? (SL.running(st).length ? '' : '') + st.why : SL.clean(st.say).replace(/^At t = \d+,? ?/, '');
        const wx = narrow ? qx : Math.ceil(tw(r.name, 15, true)) + 22;
        if (why) SL.fit((narrow ? 't = ' + t + ': ' : '· ') + why, X1 - wx, 13, r.whyLines).forEach((ln, i) => items.push(T(pre + 'why' + i, wx, r.whyY + i * 17, ln, 'gwhy slwhy', 13)));
        says.push(runs.length === 1 ? st.say : (ended ? r.name + ': done at t = `' + tr.end + '`' : r.name + ': ' + (st.why || SL.clean(st.say).replace(/^At t = \d+,? ?/, ''))));
      });
      // the comparison
      const final = t >= End;
      const cols = narrow ? [{ w: 128, label: 'policy' }, { w: 80, label: 'turn.' }, { w: 80, label: 'wait' }, { w: 84, label: 'resp.' }]
        : [{ w: 272, label: 'policy' }, { w: 120, label: 'turnaround' }, { w: 100, label: 'waiting' }, { w: 108, label: 'response' }, { w: 104, label: 'CPU busy' }, { w: 104, label: 'switching' }, { w: 162, label: 'flags' }];
      const rows = runs.map((r, k) => {
        const m = r.tr.metrics, done = t >= r.tr.end, c = (key) => (done ? { text: f2(m.avg[key]), cls: final && r.best[key] ? 'best' : '' } : '–');
        const nm = narrow ? SL.fit(SL.polLabel(r.slot.pol) + (r.slot.q && SL.QPOL.includes(r.slot.pol) ? ' ' + r.slot.q : ''), 118, 14, 1)[0] : SL.fit(r.name, 262, 14, 1)[0];
        const cells = [nm, c('turnaround'), c('waiting'), c('response')];
        if (!narrow) cells.push(done ? f2(m.util * 100) + '%' : '–', done ? m.overhead + ' ticks' : '–', (() => { const cv = r.flags.convoy.some((c) => c.start < t), sv = r.flags.starve.some((x) => x.at <= t); return { text: [cv ? 'convoy' : '', sv ? 'starving' : ''].filter(Boolean).join(', ') || '–', cls: cv || sv ? 'worst' : 'muted' }; })());
        return { key: 'p' + k, cells };
      });
      items.push(T('cmpT', 0, tableY + 2, 'Means, in ticks, as each policy finishes', 'glabel', 13));
      items.push(...G().table({ prefix: 'cmp', x: 0, y: tableY + 12, cols, rows, rowH: tRowH, size: dense ? 13 : 14 }).items);
      const say = runs.length === 1 ? says[0] : 'At t = `' + t + '`: ' + says.map((s) => s.replace(/[.]$/, '')).join('. ') + '.';
      frames.push({ items, say, at: t, title: final ? 'end' : 't = ' + t, tables: SL.jobTables(runs, t, final).concat(runs.map((r) => SL.predTable(r, v, t)).filter(Boolean)), metrics: SL.compareMetrics(runs, t, final), hold: 1000 });
    }
    // the trace: every policy's decisions, in time order
    const trace = [];
    for (const r of runs) for (const e of r.tr.events) trace.push({ kind: e.kind, t: e.t, policy: r.name, job: e.job, say: (runs.length > 1 ? r.name + ': ' : '') + 'at t = ' + e.t + ', ' + SL.clean(e.say) });
    trace.sort((a, b) => a.t - b.t);
    frames.forEach((f) => { const k = trace.findIndex((e) => e.t >= f.at); f.at = k < 0 ? trace.length - 1 : k; });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics, runs };
  };
})(globalThis.Proses = globalThis.Proses || {});
