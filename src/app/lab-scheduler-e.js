// The Scheduler lab, part five: real time and priority inversion.
//   SL.rtRun(v, ctx)  periodic tasks under RM and EDF side by side: a row per task with its releases (arrows above)
//                     and deadlines (marks under), its jobs where they ran, misses marked; the CPU and the ready jobs;
//                     and the schedulability tests worked out: U = Σ C/T, the RM bound n(2^(1/n) − 1), response-time
//                     analysis iteration by iteration, and the EDF test (U ≤ 1, or the processor demand)
//   SL.piRun(v, ctx)  tasks that lock mutexes, under no protocol, priority inheritance and a priority ceiling side by
//                     side: each task's lane (running, holding a mutex, running above its own priority, blocked, ready),
//                     who holds each mutex and who waits, and the inversion each task suffered
(function (S) {
  'use strict';
  const SL = S.SchedLab;
  const G = () => S.Kit.gantt;
  const T = (...a) => SL.T(...a), f2 = (x) => SL.f2(x), tw = (...a) => SL.tw(...a);

  // ---- real time ----------------------------------------------------------------------------------------------------
  /** the schedulability tests as lines of text: [{text, cls}] */
  SL.rtLines = function (tasks, A, which) {
    const out = [], n = tasks.length;
    out.push({ text: 'U = ' + tasks.map((k) => k.C + '/' + k.T).join(' + ') + ' = ' + A.U + (A.Uexact > 1 + 1e-9 ? ': more than the whole CPU, so some deadline must be missed' : ''), cls: A.Uexact > 1 + 1e-9 ? 'bad' : '' });
    if (which.rm) {
      out.push({ text: 'RM bound for ' + n + (n === 1 ? ' task' : ' tasks') + ': ' + n + '(2^(1/' + n + ') − 1) = ' + A.bound + (A.rmBound ? '; U ≤ bound, so RM meets every deadline' : '; U is above it, so the bound cannot promise anything: test each task'), cls: A.rmBound ? 'good' : '' });
      for (const r of A.rta) out.push({ text: 'RM, task ' + r.id + (r.hp.length ? ' (under ' + r.hp.join(', ') + ')' : ' (the most urgent)') + ': R = ' + r.iterations.join(' → ') + (r.ok ? ' ≤ D ' + r.D + ' ✓' : ' > D ' + r.D + ' ✗'), cls: r.ok ? 'good' : 'bad' });
    }
    if (which.edf) {
      if (A.implicit) out.push({ text: 'EDF, deadlines equal to periods: U = ' + A.U + (A.edfExact ? ' ≤ 1, so EDF meets every deadline ✓' : ' > 1, so EDF must miss ✗'), cls: A.edfExact ? 'good' : 'bad' });
      else {
        const bad = (A.demand || []).find((d) => !d.ok);
        out.push({ text: 'EDF, processor demand at every deadline L up to ' + (A.hyper + Math.max(...tasks.map((k) => k.D))) + ': ' + (A.Uexact > 1 + 1e-9 ? 'U > 1 ✗' : bad ? 'at L = ' + bad.L + ' the demand is ' + bad.demand + ' > ' + bad.L + ' ✗' : (A.demand || []).length + ' points, demand ≤ L at each ✓'), cls: A.edfExact ? 'good' : 'bad' });
      }
    }
    return out;
  };

  SL.rtRun = function (v, ctx) {
    const narrow = ctx.narrow, tasks = SL.tasks(v.tasks), ids = tasks.map((k) => k.id), A = S.Sched.rtAnalysis(tasks);
    const pols = [v.rtRM ? 'rm' : null, v.rtEDF ? 'edf' : null].filter(Boolean);
    const runs = pols.map((p) => ({ p, tr: S.Sched.rt(tasks, { policy: p, horizon: v.horizon || undefined, onMiss: v.onMiss }) }));
    const H = runs[0].tr.end, W = narrow ? 380 : 980, x0 = narrow ? 70 : 110, x1 = W - 10, tm = G().time({ x0, x1, t1: H }), X = tm.X;
    const rowH = 22, gap = 28;
    let y = 50;
    for (const r of runs) { r.y = y; r.rowY = y + 28; r.qY = r.rowY + ids.length * (rowH + gap) - 10; y = r.qY + 26 + 28; }
    const lines = SL.rtLines(tasks, A, { rm: v.rtRM, edf: v.rtEDF });
    const anY = y + 4;
    const frames = [];
    for (let t = 0; t <= H; t++) {
      const items = [T('now', 0, 4, t >= H ? 'end, t = ' + t : 't = ' + t, 'gnow', 15)];
      items.push(...G().axis({ prefix: 'ax', X, t1: H, y: 24, step: SL.tickStep(tm.per, 24), size: 13 }));
      const says = [];
      runs.forEach((r, b) => {
        const tr = r.tr, pre = 'b' + b, st = tr.steps[Math.min(t, tr.steps.length - 1)], end = t >= H, edf = r.p === 'edf';
        const misses = tr.misses.filter((m) => m.t <= t);
        items.push(T(pre + 'nm', 0, r.y + 4, edf ? 'EDF: the earliest deadline runs' : narrow ? 'RM: shorter period first' : 'RM: the shorter the period, the higher the priority', 'gpol slpol', 15));
        items.push(T(pre + 'ms', x1, r.y + 4, misses.length ? '✗ ' + misses.length + (misses.length === 1 ? ' miss: ' : ' misses: ') + misses.map((m) => m.job).join(', ') : 'no misses' + (end ? '' : ' so far'), misses.length ? 'bad' : 'good', 13, 'end'));
        tasks.forEach((k, i) => {
          const ry = r.rowY + i * (rowH + gap);
          items.push(T(pre + 'tn' + k.id, x0 - 10, ry + rowH / 2 + 5, narrow ? k.id : k.id + ' (' + k.C + ', ' + k.T + (k.D !== k.T ? ', ' + k.D : '') + ')', 'glname slrow', 13, 'end'));
          items.push(...G().track({ prefix: pre + 'tt' + k.id, x: x0, y: ry, w: x1 - x0, h: rowH }));
          let rel = '', dl = '';
          for (let u = k.phase; u < H; u += k.T) {
            if (u > t) break;
            rel += `M${X(u)},${ry - 2} V${ry - 14} M${X(u) - 4},${ry - 9} L${X(u)},${ry - 14} L${X(u) + 4},${ry - 9} `;
            if (u + k.D <= H && !misses.some((m) => m.task === k.id && m.t === u + k.D)) dl += `M${X(u + k.D) - 4},${ry + rowH + 3} L${X(u + k.D) + 4},${ry + rowH + 3} L${X(u + k.D)},${ry + rowH + 10} Z `;
          }
          if (rel) items.push({ key: pre + 'rel' + k.id, kind: 'path', d: rel, cls: 'p06rel', audit: 'ignore', layer: 'top' });
          if (dl) items.push({ key: pre + 'dl' + k.id, kind: 'path', d: dl, cls: 'p06dl', audit: 'ignore', layer: 'top' });
          tr.segs.forEach((s, j) => {
            if (s.job !== k.id || s.start >= t) return;
            const w = X(Math.min(s.end, t)) - X(s.start), fits = tw(s.inst, 13, true) + 6 <= w;
            items.push({ key: pre + 'sg' + j, kind: 'cell', x: X(s.start), y: ry, w: Math.round(w * 10) / 10, h: rowH, text: fits ? s.inst : '', size: 13, cls: 'gseg p' + (i % 6) + (st.run === s.inst && s.end > t && !end ? ' now' : '') });
          });
          // a missed deadline: a red cross where its mark would be
          const mx = misses.filter((m) => m.task === k.id).map((m) => `M${X(m.t) - 5},${ry + rowH + 2} L${X(m.t) + 5},${ry + rowH + 12} M${X(m.t) + 5},${ry + rowH + 2} L${X(m.t) - 5},${ry + rowH + 12} `).join('');
          if (mx) items.push({ key: pre + 'mx' + k.id, kind: 'path', d: mx, cls: 'slmiss', audit: 'ignore', layer: 'top' });
        });
        if (!end) items.push(...G().cursor({ prefix: pre + 'c', X, t, y1: r.rowY - 16, y2: r.rowY + ids.length * (rowH + gap) - gap + 4 }));
        // the CPU and the ready jobs
        const T2 = Object.fromEntries(tasks.map((k) => [k.id, k]));
        const sub = (task, dl) => (edf ? ' · due ' + dl : ' · T ' + T2[task].T);
        let x = 0;
        const box = (name, task, text, cls) => { const w = Math.ceil(tw(text, 13, true) + 14); items.push({ key: pre + 'j:' + name, kind: 'cell', x, y: r.qY, w, h: 26, rx: 5, text, size: 13, cls: 'gjob p' + (ids.indexOf(task) % 6) + (cls ? ' ' + cls : '') }); x += w + 6; };
        if (!end) {
          items.push(T(pre + 'cpuL', x, r.qY + 19, 'CPU', 'glabel', 13)); x += 36;
          if (st.run) box(st.run, st.task, st.run + sub(st.task, st.deadline) + (narrow ? '' : ', ' + st.left + ' left'), 'run');
          else { items.push(T(pre + 'idle', x, r.qY + 19, 'idle', 'glabel slmuted', 13)); x += 40; }
          x += 12;
          items.push(T(pre + 'rdL', x, r.qY + 19, 'ready', 'glabel', 13)); x += 44;
          const ready = (st.ready || []).slice().sort((a, c) => (edf ? a.deadline - c.deadline : T2[a.task].T - T2[c.task].T));
          if (!ready.length) items.push(T(pre + 'rdE', x, r.qY + 19, 'none', 'glabel slmuted', 13));
          for (const q of ready) { if (x + 90 > W) break; box(q.job, q.task, q.job + sub(q.task, q.deadline)); }
        } else items.push(T(pre + 'sum', 0, r.qY + 19, tr.perTask.map((p) => p.id + ': ' + p.done + ' of ' + p.released + ' done, worst response ' + p.worst).join(narrow ? '; ' : ' · '), 'gwhy', 13));
        says.push((runs.length > 1 ? (edf ? 'EDF: ' : 'RM: ') : '') + (runs.length > 1 ? SL.clean(st.say).replace(/^At t = \d+,? ?/, '') : st.say));
      });
      // the tests
      items.push(T('anT', 0, anY, 'Schedulability, worked out', 'gpol slpol', 15));
      let ly = anY + 22;
      lines.forEach((l, i) => { SL.fit(l.text, W - 10, 13, narrow ? 3 : 1).forEach((ln, j) => { items.push(T('an' + i + '_' + j, 0, ly, ln, l.cls ? l.cls + ' slan' : 'gwhy slan', 13)); ly += 18; }); ly += 1; });
      frames.push({ items, say: runs.length > 1 ? 'At t = `' + t + '`: ' + says.map((s) => s.replace(/[.]$/, '')).join('. ') + '.' : says[0], at: t, title: t >= H ? 'end' : 't = ' + t, hold: 1000,
        tables: runs.map((r) => ({ title: (r.p === 'edf' ? 'EDF' : 'RM') + ': each job so far', cols: ['Job', 'Released', 'Deadline', 'Finished', 'Response', 'Missed'], rows: r.tr.jobs.filter((j) => j.release <= t).map((j) => [j.job, String(j.release), String(j.deadline), j.finish !== null && j.finish !== undefined && j.finish <= t ? String(j.finish) : '–', j.finish !== null && j.finish !== undefined && j.finish <= t ? String(j.response) : '–', j.missed && j.deadline <= t ? { text: 'missed', cls: 'bad' } : '']) })).concat([{ title: 'Response-time analysis (RM)', cols: ['Task', 'C', 'T', 'D', 'Iterations of R', 'R ≤ D'], rows: A.rta.map((q) => { const k = tasks.find((x) => x.id === q.id); return [q.id, String(k.C), String(k.T), String(k.D), q.iterations.join(' → '), { text: q.ok ? 'yes' : 'no', cls: q.ok ? 'good' : 'bad' }]; }) }]),
        metrics: [{ label: 'Utilisation U', value: String(A.U) }, { label: 'RM bound', value: String(A.bound), note: A.rmBound ? 'U is under it' : 'U is above it' }, { label: 'Hyperperiod', value: String(A.hyper), unit: 'ticks' }].concat(runs.map((r) => ({ label: (r.p === 'edf' ? 'EDF' : 'RM') + ' misses so far', value: String(r.tr.misses.filter((m) => m.t <= t).length), cls: r.tr.misses.filter((m) => m.t <= t).length ? 'bad' : 'good' }))) });
    }
    const trace = [];
    for (const r of runs) for (const e of r.tr.events) trace.push({ kind: e.kind, t: e.t, say: (runs.length > 1 ? (r.p === 'edf' ? 'EDF: ' : 'RM: ') : '') + 'at t = ' + e.t + ', ' + SL.clean(e.say) });
    trace.sort((a, b) => a.t - b.t);
    frames.forEach((f) => { const k = trace.findIndex((e) => e.t >= f.at); f.at = k < 0 ? trace.length - 1 : k; });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics, runs, analysis: A };
  };

  // ---- priority inversion -------------------------------------------------------------------------------------------
  const PROTO = { none: 'No protocol', inherit: 'Priority inheritance', ceiling: 'Priority ceiling' };
  /** a task's state at a step: run | hold | boost | blk | wait | none | done */
  function piState(st, x, t, fin) {
    if (t < x.arrive) return 'none';
    if (fin !== null && fin !== undefined && t >= fin) return 'done';
    const holds = Object.values(st.holders || {}).includes(x.id);
    if (st.run === x.id) return st.eff && st.eff[x.id] < x.prio ? 'boost' : holds ? 'hold' : 'run';
    if ((st.blocked || []).some((b) => b.id === x.id)) return 'blk';
    return 'wait';
  }
  SL.piRun = function (v, ctx) {
    const narrow = ctx.narrow, tasks = SL.piTasks(v.pitasks), ids = tasks.map((k) => k.id);
    const pols = ['none', 'inherit', 'ceiling'].filter((p) => v[{ none: 'piNone', inherit: 'piInherit', ceiling: 'piCeiling' }[p]]);
    const runs = pols.map((p) => ({ p, tr: S.Sched.inversion(tasks, { protocol: p }) }));
    const End = Math.max(...runs.map((r) => r.tr.end)), W = narrow ? 380 : 980, x0 = narrow ? 58 : 110, x1 = W - 10, tm = G().time({ x0, x1, t1: End }), X = tm.X;
    const rowH = 20, gap = 4, mutexes = [...new Set(tasks.flatMap((k) => k.script.filter((o) => o[0] === 'lock').map((o) => o[1])))];
    let y = 52;
    for (const r of runs) { r.y = y; r.rowY = y + 16; r.mY = r.rowY + ids.length * (rowH + gap) + 4; r.whyY = (narrow ? r.mY + 26 * mutexes.length : r.rowY + ids.length * (rowH + gap)) + 12; y = r.whyY + (narrow ? 34 : 17) + 12; }
    const legY = y + 4, tabY = legY + (narrow ? 50 : 22);
    const lane = { run: (i) => 'gseg p' + (i % 6), hold: (i) => 'gseg p' + (i % 6) + ' p06hold', boost: (i) => 'gseg p' + (i % 6) + ' p06boost', blk: () => 'p06blk', wait: () => 'p05lane p05wait' };
    const frames = [];
    for (let t = 0; t <= End; t++) {
      const items = [T('now', 0, 4, t >= End ? 'end, t = ' + t : 't = ' + t, 'gnow', 15)];
      items.push(...G().axis({ prefix: 'ax', X, t1: End, y: 24, step: SL.tickStep(tm.per, 24), size: 13 }));
      const says = [];
      runs.forEach((r, b) => {
        const tr = r.tr, pre = 'b' + b, st = tr.steps[Math.min(t, tr.steps.length - 1)], end = t >= tr.end, fin = Object.fromEntries(tr.metrics.rows.map((m) => [m.id, m.finish]));
        items.push(T(pre + 'nm', 0, r.y + 4, PROTO[r.p], 'gpol slpol', 15));
        tasks.forEach((k, i) => {
          const ry = r.rowY + i * (rowH + gap);
          items.push(T(pre + 'tn' + k.id, x0 - 8, ry + rowH / 2 + 5, narrow ? k.id : k.id + ' · prio ' + k.prio, 'glname slrow', 13, 'end'));
          items.push(...G().track({ prefix: pre + 'tk' + k.id, x: x0, y: ry, w: x1 - x0, h: rowH }));
          let cur = null;
          const segs = [];
          for (let u = 0; u < Math.min(t, tr.steps.length - 1); u++) {
            const s = piState(tr.steps[u], k, u, fin[k.id]);
            if (cur && cur.s === s && cur.e === u) cur.e = u + 1; else { cur = { s, b: u, e: u + 1 }; segs.push(cur); }
          }
          for (const sg of segs) {
            if (!lane[sg.s]) continue;
            const w = X(sg.e) - X(sg.b), word = sg.s === 'blk' ? 'blocked' : sg.s === 'wait' ? '' : k.id;
            items.push({ key: pre + 'l' + k.id + ':' + sg.b, kind: 'cell', x: X(sg.b), y: ry, w: Math.round(w * 10) / 10, h: rowH, text: word && tw(word, 13, true) + 6 <= w ? word : '', size: 13, cls: lane[sg.s](i) + (sg.e === t && st.run === k.id && !end ? ' now' : '') });
          }
        });
        if (!end) items.push(...G().cursor({ prefix: pre + 'c', X, t, y1: r.rowY - 4, y2: r.rowY + ids.length * (rowH + gap) - gap + 4 }));
        // the mutexes: holder and waiters, and the effective priorities
        let mxx = Math.ceil(tw(PROTO[r.p], 15, true)) + 24;
        mutexes.forEach((m, j) => {
          const mx = narrow ? 0 : mxx, my = narrow ? r.mY + j * 26 : r.y - 13;
          const h = end ? null : (st.holders || {})[m], ws = end ? [] : (st.waiters || {})[m] || [];
          const txt = 'mutex ' + m + ': ' + (h ? 'held by ' + h + (st.eff && st.eff[h] !== undefined && st.eff[h] < tasks.find((k) => k.id === h).prio ? ' at priority ' + st.eff[h] : '') : 'free') + (ws.length ? ', waiting ' + ws.join(', ') : '');
          const mw = Math.min(W - mx, Math.ceil(tw(txt, 13, true) + 20));
          items.push({ key: pre + 'mx' + m, kind: 'cell', x: mx, y: my, w: mw, h: 22, rx: 5, text: txt, size: 13, cls: 'p06mutex' });
          mxx += mw + 10;
        });
        const why = end ? 'every task done at t = ' + tr.end : SL.clean(st.say).replace(/^At t = \d+,? ?/, '');
        SL.fit('t = ' + Math.min(t, tr.end) + ': ' + why, W - 10, 13, narrow ? 2 : 1).forEach((ln, i) => items.push(T(pre + 'why' + i, 0, r.whyY + i * 17, ln, 'gwhy slwhy', 13)));
        says.push((runs.length > 1 ? PROTO[r.p] + ': ' : '') + (runs.length > 1 ? SL.clean(st.say).replace(/^At t = \d+,? ?/, '') : st.say));
      });
      // the legend and the comparison
      const leg = [['running', 'gseg p0'], ['holding a mutex', 'gseg p0 p06hold'], ['above its own priority', 'gseg p0 p06boost'], ['blocked on a mutex', 'p06blk'], ['ready, waiting', 'p05lane p05wait']];
      let lx = 0, lyy = legY;
      leg.forEach(([word, cls], i) => {
        const wd = 30 + tw(word, 13) + 18;
        if (lx + wd > W) { lx = 0; lyy += 22; }
        items.push({ key: 'lg' + i, kind: 'cell', x: lx, y: lyy - 13, w: 22, h: 16, text: '', cls });
        items.push(T('lgt' + i, lx + 28, lyy, word, 'glabel', 13));
        lx += wd;
      });
      const cols = narrow ? [{ w: 120, label: 'protocol' }].concat(ids.map(() => ({ w: Math.floor(250 / ids.length), label: '' }))) : [{ w: 200, label: 'protocol' }].concat(ids.map(() => ({ w: Math.floor(760 / ids.length), label: '' })));
      ids.forEach((id, i) => { cols[i + 1].label = narrow ? id : id + ': finish, inversion'; });
      const rows = runs.map((r, k) => ({ key: 'p' + k, cells: [narrow ? { none: 'none', inherit: 'inherit', ceiling: 'ceiling' }[r.p] : PROTO[r.p]].concat(r.tr.metrics.rows.map((m) => (m.finish <= t ? { text: narrow ? m.finish + ', ' + m.inversion : 't = ' + m.finish + ', ' + m.inversion + ' inverted', cls: m.inversion ? 'worst' : '' } : '–'))) }));
      items.push(...G().table({ prefix: 'cmp', x: 0, y: tabY, cols, rows, rowH: 25, size: 13 }).items);
      frames.push({ items, say: runs.length > 1 ? 'At t = `' + t + '`: ' + says.map((s) => s.replace(/[.]$/, '')).join('. ') + '.' : says[0], at: t, title: t >= End ? 'end' : 't = ' + t, hold: 1000,
        tables: runs.map((r) => ({ title: PROTO[r.p] + ': each task', cols: ['Task', 'Prio', 'Arrives', 'Script', 'Finish', 'Response', 'Blocked on mutex', 'Inversion'], rows: r.tr.metrics.rows.map((m, i) => { const done = m.finish <= t; return [m.id, String(m.prio), String(m.arrive), SL.scriptText(tasks[i].script), done ? String(m.finish) : '–', done ? String(m.response) : '–', done ? String(m.blockedOnMutex) : '–', done ? { text: String(m.inversion), cls: m.inversion ? 'bad' : '' } : '–']; }), note: 'inversion: ticks a task waited while a task of less urgent base priority ran' })),
        metrics: runs.flatMap((r) => { const hi = r.tr.metrics.rows.slice().sort((a, c) => a.prio - c.prio)[0], done = hi.finish <= t; return [{ label: PROTO[r.p] + ': ' + hi.id + ' finishes', value: done ? 't = ' + hi.finish : '–' }, { label: PROTO[r.p] + ': ' + hi.id + ' inverted', value: done ? String(hi.inversion) : '–', unit: 'ticks', cls: done ? (hi.inversion ? 'bad' : 'good') : '' }]; }) });
    }
    const trace = [];
    for (const r of runs) for (const e of r.tr.events) trace.push({ kind: e.kind, t: e.t, say: (runs.length > 1 ? PROTO[r.p] + ': ' : '') + 'at t = ' + e.t + ', ' + SL.clean(e.say) });
    trace.sort((a, b) => a.t - b.t);
    frames.forEach((f) => { const k = trace.findIndex((e) => e.t >= f.at); f.at = k < 0 ? trace.length - 1 : k; });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics, runs };
  };
})(globalThis.Proses = globalThis.Proses || {});
