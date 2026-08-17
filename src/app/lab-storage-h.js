// The Storage lab, part eight: the kernel I/O subsystem, second half (S.IO.spool and S.IO.blockQueue).
//   spool   print jobs from several processes, each process holding the printer itself against writing its job to
//           a spool directory for a daemon to print: the printer and every process on one time axis, both ways
//   queue   block requests (arrival, sector, length, read or write) through the block layer: merging of contiguous
//           requests, and the noop, look and deadline elevators side by side; each shows its dispatches, the head's
//           place over the sectors, and the queue at every moment
//   SL.spoolCheck(v), SL.spoolRun(v, ctx), SL.queueCheck(v), SL.queueRun(v, ctx)
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const IO = () => S.IO;
  const fix = (x, d) => SL.fix(x, d === undefined ? 2 : d);
  const r1 = SL.r1;
  const cap = (xs, n) => (xs.length > n ? xs.filter((_, i) => i % Math.ceil(xs.length / n) === 0) : xs);

  // ---- spooling ------------------------------------------------------------------------------------------------
  SL.spoolCheck = function (v) {
    const seen = new Set();
    for (const j of v.spJobs) { if (seen.has(j.proc)) return 'Print jobs: two jobs from ' + j.proc + '; give each process one job'; seen.add(j.proc); }
    return null;
  };
  SL.spoolOpts = (v) => ({ pageTime: v.spPage, spoolTime: v.spSpool });
  function spoolRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 380 : 980, jobs = v.spJobs.map((j) => ({ proc: j.proc, at: j.at, pages: j.pages }));
    const r = IO().spool(jobs, SL.spoolOpts(v)), procs = jobs.map((j) => j.proc);
    const T = Math.max(...r.direct.printer.map((p) => p.to), ...r.spooled.printer.map((p) => p.to));
    const pc = (p) => 'pr' + (procs.indexOf(p) % 6);
    const ts = cap([...new Set([0].concat(r.direct.jobs.flatMap((j) => [j.at, j.start, j.end]), r.spooled.jobs.flatMap((j) => [j.at, j.spooled, j.start, j.end])))].filter((t) => t < T).sort((a, b) => a - b), 30).concat([T]);
    const rowsOf = (side, spooled) => [{ label: 'printer', segs: side.printer.map((p) => ({ from: p.from, to: p.to, cls: pc(p.proc), text: p.proc })) }].concat(side.jobs.slice().sort((a, b) => procs.indexOf(a.proc) - procs.indexOf(b.proc)).map((j) => ({ label: j.proc, segs: spooled
      ? [{ from: j.at, to: j.spooled, cls: 'ps-move', text: 'spool' }, { from: j.spooled, to: T, cls: 'free', text: 'carries on' }]
      : [{ from: j.at, to: j.start, cls: 'ps-wait', text: 'wait' }, { from: j.start, to: j.end, cls: pc(j.proc), text: 'printing' }, { from: j.end, to: T, cls: 'free', text: 'carries on' }].filter((s) => s.to > s.from) })));
    const secH = 22 + (procs.length + 1) * 26 + 34;
    const word = (side, spooled, t) => {
      const p = side.printer.find((x) => x.from <= t && t < x.to);
      const waiting = side.jobs.filter((j) => (spooled ? j.at <= t && t < j.spooled : j.at <= t && t < j.start)).map((j) => j.proc);
      return (p ? 'the printer prints ' + p.proc + "'s job" : 'the printer is idle') + (waiting.length ? '; ' + SL.list(waiting) + (spooled ? ' writing to the spool' : ' waiting for it') : '');
    };
    const frames = ts.map((t, fi) => {
      const fin = fi === ts.length - 1, items = [];
      [[narrow ? 'Holding the printer' : 'Each process holds the printer', r.direct, false], [narrow ? 'Through a spool' : 'Through a spool and a printer daemon', r.spooled, true]].forEach(([title, side, sp], i) => {
        const y = i * (secH + 8);
        items.push(SL.text('sn' + i, 0, y + 14, title, 'strong', 14));
        items.push(SL.text('sm' + i, W, y + 14, (narrow ? 'mean wait ' : 'a process waits ') + fix(side.meanDelay) + (narrow ? ' s' : ' on average'), 'tick', 13, 'end'));
        items.push(...SL.lanes({ prefix: 's' + i, x: 0, y: y + 22, w: W, labelW: narrow ? 58 : 76, t1: T, rows: rowsOf(side, sp), rowH: 22, gap: 4, upTo: fin ? Infinity : t, now: fin ? null : t, unit: 's', size: 13 }).items);
      });
      items.push(...SL.legend('sl', 0, 2 * (secH + 8), [['tl ps-wait', 'waiting for the printer'], ['tl ps-move', 'writing the job to the spool'], ['tl pr0', 'a job printing'], ['tl free', 'free to carry on']].map(([cls, text]) => ({ cls, text })), W, 12).items);
      const say = fin ? r.steps[r.steps.length - 1].say : 'At t = `' + fix(t) + '`: holding the printer, ' + word(r.direct, false, t) + '. With a spool, ' + word(r.spooled, true, t) + '.';
      return { items, say, title: fin ? 'end' : 't = ' + fix(t), at: Math.min(r.steps.length - 1, fi), hold: 1100 };
    });
    const tab = (side, sp) => ({ title: sp ? 'Through a spool' : 'Holding the printer', cols: ['process', 'asks at', sp ? 'spooled by' : 'starts', 'printer from', 'printer to', 'goes on at', 'delay'], rows: side.jobs.map((j) => [j.proc, fix(j.at), sp ? fix(j.spooled) : fix(j.start), fix(j.start), fix(j.end), fix(j.free), fix(j.delay)]) });
    return { frames, trace: r.steps.map((s) => ({ kind: s.kind, say: s.say })), tables: [tab(r.direct, false), tab(r.spooled, true)], spool: r,
      metrics: [{ label: 'Mean delay, holding the printer', value: fix(r.direct.meanDelay), unit: 's', cls: 'bad' }, { label: 'Mean delay, with a spool', value: fix(r.spooled.meanDelay), unit: 's', cls: 'good' }, { label: 'The printer is busy until', value: fix(Math.max(...r.spooled.printer.map((p) => p.to))), unit: 's' }] };
  }
  SL.spoolRun = spoolRun;

  // ---- the block queue ------------------------------------------------------------------------------------------
  const EL = [['noop', 'qNoop', 'noop: in arrival order'], ['look', 'qLook', 'look: an elevator sweep'], ['deadline', 'qDeadline', 'deadline: a sweep, but late requests first']];
  SL.queueEls = (v) => EL.filter((e) => v[e[1]]).map((e) => e[0]);
  SL.queueReqs = (v) => v.qReqs.map((q) => ({ at: q.at, sector: q.sector, count: q.count, op: q.op, proc: q.proc }));
  SL.queueOpts = (v, el) => ({ elevator: el, merge: v.qMerge, base: v.qBase, perSector: v.qPer, seek: v.qSeek, readExpire: v.qRexp, writeExpire: v.qWexp, start: v.qStart });
  SL.queueCheck = function (v) {
    if (!SL.queueEls(v).length) return 'Schedulers: turn on at least one';
    return null;
  };
  function queueRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 380 : 980, reqs = SL.queueReqs(v);
    const runs = SL.queueEls(v).map((el) => ({ el, r: IO().blockQueue(reqs, SL.queueOpts(v, el)) }));
    const T = Math.max(...runs.map((x) => x.r.totals.time));
    const maxS = Math.max(v.qStart, ...reqs.map((q) => q.sector + q.count)) + 1;
    const ts = cap([...new Set([0].concat(reqs.map((q) => q.at), runs.flatMap((x) => x.r.dispatched.map((d) => d.start))))].filter((t) => t < T).sort((a, b) => a - b), 36).concat([T]);
    const blockH = 170, lw = narrow ? 62 : 80;
    const head = (x, t) => { const done = x.r.dispatched.filter((d) => d.start <= t); const d = done[done.length - 1]; return d ? (d.end <= t ? d.sector + d.count - 1 : d.sector) : v.qStart; };
    const waiting = (x, t) => {
      const out = [];
      for (const d of x.r.dispatched) { if (d.start <= t) continue; const ids = d.ids.filter((id) => reqs[id].at <= t); if (ids.length) out.push({ ids, d }); }
      return out;
    };
    const frames = ts.map((t, fi) => {
      const fin = fi === ts.length - 1, items = [], says = [];
      runs.forEach((x, i) => {
        const y = i * blockH, name = EL.find((e) => e[0] === x.el)[2];
        items.push(SL.text('qn' + i, 0, y + 14, narrow ? x.el : name, 'strong', 14));
        const tt = x.r.totals;
        items.push(SL.text('qm' + i, W, y + 14, (fin ? '' : 'so far ') + 'mean wait ' + fix(fin ? tt.meanWait : 0) + (narrow ? '' : ' · ' + tt.merges + ' merged · moved ' + tt.movement + ' sectors'), 'tick', 13, 'end'));
        if (!fin) items[items.length - 1].text = (narrow ? '' : tt.merges + ' merged · ') + 'head at ' + head(x, t);
        items.push(...SL.lanes({ prefix: 'q' + i, x: 0, y: y + 22, w: W, labelW: lw, t1: T, rows: [{ label: 'disk', segs: x.r.dispatched.map((d) => ({ from: d.start, to: d.end, cls: d.op === 'r' ? 'io-busy' : 'ps-move', text: d.ids.join('+') })) }], rowH: 24, gap: 4, upTo: fin ? Infinity : t, now: fin ? null : t, unit: 'ms', size: 13 }).items);
        // the sectors: where the head is and what waits
        const sy = y + 100, X = (s) => r1(lw + (s / maxS) * (W - lw));
        items.push(SL.text('ql' + i, lw - 10, sy + 5, 'sectors', 'strong', 13, 'end'));
        items.push({ key: 'qa' + i, kind: 'path', d: `M${X(0)},${sy} H${X(maxS)} M${X(0)},${sy - 4} v8 M${X(maxS)},${sy - 4} v8`, cls: 'axis', audit: 'ignore', layer: 'back' });
        items.push(SL.text('qa0' + i, X(0), sy - 8, '0', 'tick', 12, 'start'), SL.text('qa1' + i, X(maxS), sy - 8, String(maxS), 'tick', 12, 'end'));
        const w = fin ? [] : waiting(x, t);
        if (!fin) items.push({ key: 'qh' + i, kind: 'head', x: X(head(x, t)), y: sy + 3, text: 'head ' + head(x, t), side: 'below', cls: 'act' });
        w.forEach((g) => items.push(SL.cell('qw' + i + '_' + g.ids[0], X(g.d.sector) - 4, sy - 7, 8, 14, '', 'tl ' + (g.d.op === 'r' ? 'io-busy' : 'ps-move'), 12, { rx: 2, audit: 'overlap-ok' })));
        // the queue
        let qx = lw;
        items.push(SL.text('qq' + i, lw - 10, sy + 50, 'queue', 'strong', 13, 'end'));
        if (!w.length) items.push(SL.text('qe' + i, qx + (fin ? 0 : 0), sy + 50, fin ? 'every request served by ' + fix(x.r.totals.time) : 'empty', 'tick', 13));
        for (const g of w) {
          const lab = g.ids.join('+') + ' ' + g.d.op + '@' + reqs[g.ids[0]].sector;
          const bw = Math.ceil(SL.tw(lab, 12) + 12);
          if (qx + bw > W) break;
          items.push(SL.cell('qb' + i + '_' + g.ids[0], qx, sy + 34, bw, 22, lab, 'tl ' + (g.d.op === 'r' ? 'io-busy' : 'ps-move'), 12));
          qx += bw + 5;
        }
        const st = x.r.steps.find((s) => s.kind === 'dispatch' && Math.abs(s.t - t) < 1e-9);
        if (!fin) says.push((runs.length > 1 ? x.el + ': ' : '') + (st ? st.say.replace(/^t = [\d.]+: /, '') : w.length ? SL.plural(w.length, 'request') + ' waiting, the head at sector ' + head(x, t) : 'the queue is empty'));
      });
      items.push(...SL.legend('ql', 0, runs.length * blockH, [['tl io-busy', 'a read'], ['tl ps-move', 'a write']].map(([cls, text]) => ({ cls, text })), W, 12).items);
      const arr = reqs.map((q, id) => ({ q, id })).filter((e) => e.q.at === t);
      const say = fin ? runs.map((x) => (runs.length > 1 ? x.el + ': ' : '') + 'mean wait ' + fix(x.r.totals.meanWait) + ', longest ' + fix(x.r.totals.maxWait) + ', ' + x.r.totals.dispatches + ' dispatches for ' + x.r.totals.requests + ' requests, the head moved ' + x.r.totals.movement + ' sectors').join('. ') + '.'
        : 'At t = `' + fix(t) + '`' + (arr.length ? ', request' + (arr.length > 1 ? 's ' : ' ') + SL.list(arr.map((e) => e.id + ' (' + (e.q.op === 'r' ? 'read' : 'write') + ' at ' + e.q.sector + ')')) + ' arrive' + (arr.length > 1 ? '' : 's') : '') + ': ' + says.map((x) => x.replace(/[.]$/, '')).join('; ') + '.';
      return { items, say, title: fin ? 'end' : 't = ' + fix(t), at: fi, hold: 1100 };
    });
    const trace = runs.flatMap((x) => x.r.steps.map((s) => ({ kind: s.kind, t: s.t, say: (runs.length > 1 ? x.el + ': ' : '') + s.say })));
    frames.forEach((f, i) => { f.at = Math.min(trace.length - 1, Math.round((i * (trace.length - 1)) / Math.max(1, frames.length - 1))); });
    const tables = runs.map((x) => ({ title: x.el + ': dispatches, in order', cols: ['requests', 'op', 'sectors', 'starts', 'ends', 'waited'], rows: x.r.dispatched.map((d) => [d.ids.join(' + '), d.op === 'r' ? 'read' : 'write', d.sector + '–' + (d.sector + d.count - 1), fix(d.start), fix(d.end), fix(d.wait)]) }));
    const best = Math.min(...runs.map((x) => x.r.totals.meanWait));
    const metrics = runs.flatMap((x) => [{ label: x.el + ': mean wait', value: fix(x.r.totals.meanWait), unit: 'ms', cls: runs.length > 1 && x.r.totals.meanWait === best ? 'good' : '' }, { label: x.el + ': longest wait', value: fix(x.r.totals.maxWait), unit: 'ms' }, { label: x.el + ': head movement', value: x.r.totals.movement, unit: 'sectors', note: x.r.totals.merges + ' merges, ' + x.r.totals.dispatches + ' dispatches' }]);
    return { frames, trace, tables, metrics, queue: runs };
  }
  SL.queueRun = queueRun;
})(globalThis.Proses = globalThis.Proses || {});
