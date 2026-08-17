// The Storage lab, part two: the disk workbench. A disk of the student's geometry, RPM and seek curve
// (S.Storage.disk), a request queue (typed cylinders, typed arrivals with their sectors, or a seeded stream), and
// one or more arm policies (S.Storage.schedule) side by side: each arm's path over the cylinders against time, the
// cylinders moved per request, and every request's access time split into seek, rotation and transfer.
//   SL.DISK_POLS [{id, label}]          SL.diskModel(v) -> S.Storage.disk(..)       SL.diskReqs(v, seed) -> requests
//   SL.diskPlan(v, seed) -> {D, reqs, runs: [{pol, r, rows, tot}]}   SL.diskRun(v, ctx) -> the lab's result
// The access times follow the arm's real path: a leg that ends at a turn or a C-SCAN return is a seek of its own
// (S.Storage.seekTime), and the last leg, the rotational wait and the transfer come from S.Storage.access, called
// at the moment the arm sets off on that leg, so the platter's angle is right. Requests are served back to back.
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const St = () => S.Storage;
  SL.DISK_POLS = [{ id: 'fcfs', label: 'FCFS' }, { id: 'sstf', label: 'SSTF' }, { id: 'scan', label: 'SCAN' }, { id: 'cscan', label: 'C-SCAN' }, { id: 'look', label: 'LOOK' }, { id: 'clook', label: 'C-LOOK' }, { id: 'nscan', label: 'N-step SCAN' }, { id: 'fscan', label: 'F-SCAN' }];
  SL.diskPolsOn = (v) => SL.DISK_POLS.filter((p) => v['p_' + p.id]);

  SL.diskModel = (v) => St().disk({ cylinders: v.dCyl, heads: v.dHeads, spt: v.dSpt, rpm: v.dRpm, settle: v.dSettle, knee: v.dKnee, kneeTime: v.dKneeT, full: v.dFull });

  /** the requests: [{id, cyl, at, head, sector, count, seeded}] */
  SL.diskReqs = function (v, seed) {
    const r = SL.rng((seed || 1) * 7919 + 17), int = (a, b) => a + Math.floor(r() * (b - a + 1));
    if (v.dSrc === 'table') return (v.dArr || []).map((q, id) => ({ id, cyl: q.cyl, at: q.at, head: q.head, sector: q.sector, count: q.count }));
    if (v.dSrc === 'random') {
      const out = [];
      for (let id = 0; id < v.dRandN; id++) out.push({ id, cyl: int(0, v.dCyl - 1), at: id < Math.min(3, v.dRandN) ? 0 : int(0, v.dSpread), head: int(0, v.dHeads - 1), sector: int(0, v.dSpt - 1), count: v.dCount, seeded: true });
      return out;
    }
    return (v.dQueue || []).map((cyl, id) => ({ id, cyl, at: 0, head: int(0, v.dHeads - 1), sector: int(0, v.dSpt - 1), count: v.dCount, seeded: true }));
  };

  /** the cylinders the arm passes through between two services: the legs of its path, each a separate motion */
  function legs(path, from, to) {
    const pts = path.slice(from, to + 1).filter((p) => p.kind !== 'idle' && p.kind !== 'wake');
    const out = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].cyl !== pts[i - 1].cyl) out.push({ from: pts[i - 1].cyl, to: pts[i].cyl, jump: pts[i - 1].kind === 'jump' });
    return out;
  }

  SL.diskPlan = function (v, seed) {
    const D = SL.diskModel(v), reqs = SL.diskReqs(v, seed);
    const runs = SL.diskPolsOn(v).map((pol) => {
      const r = St().schedule(pol.id, { requests: reqs.map((q) => ({ cyl: q.cyl, at: q.at, id: q.id })), start: v.dStart, cylinders: v.dCyl, dir: v.dDir, n: v.dBatch, disk: D });
      let state = { cyl: v.dStart, t: 0 }, prevIdx = 0;
      const rows = r.served.map((s, k) => {
        const q = reqs[s.id], idx = r.path.findIndex((p, i) => i > prevIdx && p.kind === 'serve' && p.id === s.id);
        const lg = legs(r.path, prevIdx, idx);
        prevIdx = idx;
        // every leg but the last is a seek that stops (a turn at the edge, a return jump); the last is the access's own
        let pre = 0;
        const preLegs = lg.slice(0, -1).map((l) => { const s1 = St().seekTime(D, Math.abs(l.to - l.from)); pre += s1.ms; return Object.assign({ ms: s1.ms }, l); });
        const startCyl = lg.length ? lg[lg.length - 1].from : state.cyl;
        const a = St().access(D, { cyl: startCyl, t: state.t + pre }, { cyl: q.cyl, head: q.head, sector: q.sector, count: q.count, id: q.id });
        state = a.state;
        return { k, id: s.id, cyl: s.cyl, head: q.head, sector: q.sector, count: q.count, at: s.at, wait: s.wait, dist: s.dist, passed: s.passed, done: s.done, legs: preLegs, seek: pre + a.seek.ms, rot: a.rotation.ms, xfer: a.transfer.ms, total: pre + a.total, access: a };
      });
      const sum = (f) => rows.reduce((n, x) => n + x[f], 0);
      const tot = { seek: sum('seek'), rot: sum('rot'), xfer: sum('xfer'), total: sum('total') };
      const sv = r.served.find((s) => s.id === r.totals.starved);
      // starvation: the longest wait belongs to a request that later arrivals overtook again and again
      const starved = !!sv && reqs.length >= 4 && sv.passed >= 3 && sv.wait >= 2 * r.totals.meanWait;
      return { pol, r, rows, tot, starvedReq: sv, starved };
    });
    return { D, reqs, runs };
  };

  const PART = [['seek', 'seek', 'seek'], ['rot', 'rot', 'rotation'], ['xfer', 'xfer', 'transfer']];

  SL.diskRun = function (v, ctx) {
    const plan = SL.diskPlan(v, ctx.seed), { reqs, runs } = plan, narrow = ctx.narrow, n = reqs.length, single = runs.length === 1;
    const W = narrow ? 370 : 960, fix = SL.fix;
    const tmax = Math.max(1, ...runs.map((x) => x.r.totals.time));
    const msMax = Math.max(1e-9, ...runs.map((x) => x.tot.total));
    const trace = [];
    const frames = [];
    const reqName = (q) => 'cylinder ' + q.cyl;
    for (let k = 0; k <= n + 1; k++) {
      const fin = k === n + 1, kk = Math.min(k, n), items = [];
      let y = 0;
      // ---- the arm charts ----
      const cols = narrow ? (runs.length > 2 ? 2 : 1) : runs.length <= 4 ? runs.length : Math.ceil(runs.length / 2);
      const gapX = narrow ? 20 : 30, pw = (W - (cols - 1) * gapX) / cols;
      const H = single ? (narrow ? 220 : 280) : narrow ? (cols > 1 ? 120 : 150) : runs.length <= cols ? 220 : 96;
      const chartW = single && !narrow ? 560 : pw;
      const top = narrow && cols > 1 ? 76 : 58, panelH = top + H + 26;
      runs.forEach((run, i) => {
        const c = i % cols, row = Math.floor(i / cols), px = c * (pw + gapX), py = row * (panelH + 18), P = 'c' + i;
        const done = run.rows.slice(0, kk), last = done[done.length - 1];
        const upTo = fin ? run.r.totals.time : last ? last.done : 0;
        const late = fin && run.starved ? new Set([run.starvedReq.id]) : new Set();
        const moved = done.reduce((s, x) => s + x.dist, 0);
        items.push(SL.text(P + ':nm', px, py + 14, run.r.name, 'strong', 15));
        const two = narrow && cols > 1;
        items.push(SL.text(P + ':mv', two ? px : px + (single && !narrow ? chartW : pw), two ? py + 33 : py + 14, 'moved ' + moved + (fin && run.starved ? ' · starved: ' + run.starvedReq.cyl : ''), fin && run.starved ? 'bad' : 'tick', 13, two ? 'start' : 'end'));
        const ch = SL.armChart({ prefix: P, C: v.dCyl, x: px + 60, y: py + top, w: (single && !narrow ? chartW : pw) - 66, h: H, t1: tmax, path: run.r.path, upTo, start: v.dStart, served: run.r.served, act: !fin && last ? last.id : null, late, reqs, ticks: narrow || !single ? 4 : 6, tickSize: 13 });
        items.push(...ch.items);
      });
      const rowsOfGrid = Math.ceil(runs.length / cols);
      y = rowsOfGrid * (panelH + 18) + 6;
      // ---- single policy: the order served, and each request's access time ----
      if (single) {
        const run = runs[0], done = run.rows.slice(0, kk), per = narrow ? 7 : 12, sw = narrow ? 370 : 560;
        items.push(SL.title('so:t', 0, y + 10, 'served in this order (cylinders moved)'));
        const bw = Math.min(56, Math.floor((sw + 6) / Math.min(per, Math.max(1, n))) - 6);
        run.rows.forEach((x, i) => {
          const cx = (i % per) * (bw + 6), cy = y + 22 + Math.floor(i / per) * 52;
          if (i < kk) items.push(SL.cell('so:' + x.id, cx, cy, bw, 30, x.cyl, 'q done' + (i === kk - 1 && !fin ? ' act' : '') + (fin && run.starved && x.id === run.starvedReq.id ? ' late' : ''), 13, { sub: x.dist ? '+' + x.dist : '0' }));
          else items.push(SL.cell('so:' + x.id, cx, cy, bw, 30, '', 'q wait', 13));
        });
        y += 22 + Math.ceil(n / per) * 52;
        // the access-time bars
        const bx = narrow ? 0 : 640, by = narrow ? y + 8 : 0, bwid = narrow ? 370 : 320, lab = 44, barMax = bwid - lab - 66, rh = n > 14 ? 17 : 22;
        items.push(SL.title('ab:t', bx, by + 14, 'access time per request, ms'));
        const sc = barMax / Math.max(1e-9, ...run.rows.map((x) => x.total));
        run.rows.forEach((x, i) => {
          const ry = by + 28 + i * (rh + 4);
          items.push(SL.text('ab:n' + x.id, bx + lab - 8, ry + rh / 2 + 5, x.cyl, i < kk ? 'tick' : 'tick muted', 12, 'end'));
          if (i >= kk) { items.push(SL.cell('ab:e' + x.id, bx + lab, ry, barMax, rh, '', 'tl-track', 12)); return; }
          items.push(...SL.stack({ prefix: 'ab:b' + x.id, x: bx + lab, y: ry, h: rh, scale: sc, parts: PART.map(([f, cls]) => ({ v: x[f], cls: cls + (i === kk - 1 && !fin ? ' act' : '') })) }).items);
          items.push(SL.text('ab:v' + x.id, bx + bwid, ry + rh / 2 + 5, fix(x.total, 2), i === kk - 1 && !fin ? 'act-t' : 'tick', 12, 'end'));
        });
        const ly = by + 28 + n * (rh + 4) + 8;
        items.push(...SL.legend('ab:lg', bx + lab, ly, PART.map(([, cls, name]) => ({ cls: 'tl ' + cls, text: name })), bwid - lab, 12).items);
        const sumY = ly + (narrow ? 30 : 46);
        const d = run.rows.slice(0, kk), s = (f) => d.reduce((a, x) => a + x[f], 0);
        items.push(...SL.para('ab:sum', bx, sumY, kk ? 'So far ' + fix(s('total'), 2) + ' ms = ' + fix(s('seek'), 2) + ' seek + ' + fix(s('rot'), 2) + ' rotation + ' + fix(s('xfer'), 2) + ' transfer' : 'Nothing served yet', bwid, 13, 'tick').items);
        if (narrow) y = sumY + 50;
      } else {
        // ---- several policies: the totals compared, growing as each serves ----
        const lab = narrow ? 84 : 110, barMax = narrow ? 270 : 470, rh = runs.length > 3 && !narrow ? 20 : 26;
        items.push(SL.title('cmp:t', 0, y + 12, 'access time so far, requests served back to back (ms)'));
        const sc = barMax / msMax;
        runs.forEach((run, i) => {
          const ry = y + 26 + i * (narrow ? rh + 30 : rh + 6), d = run.rows.slice(0, kk), s = (f) => d.reduce((a, x) => a + x[f], 0);
          items.push(SL.text('cmp:n' + i, lab - 10, ry + rh / 2 + 5, run.r.name, 'strong', 13, 'end'));
          items.push(SL.cell('cmp:tr' + i, lab, ry, barMax, rh, '', 'tl-track', 12));
          items.push(...SL.stack({ prefix: 'cmp:b' + i, x: lab, y: ry, h: rh, scale: sc, parts: PART.map(([f, cls]) => ({ v: s(f), cls, text: '' })) }).items);
          const note = fix(s('total'), 1) + ' ms · moved ' + d.reduce((a, x) => a + x.dist, 0) + (fin ? ' · longest wait ' + run.r.totals.maxWait + (run.starved ? ' (starved)' : '') : '');
          items.push(SL.text('cmp:v' + i, narrow ? lab : lab + barMax + 12, narrow ? ry + rh + 17 : ry + rh / 2 + 5, note, fin && run.starved ? 'bad' : 'tick', 13));
        });
        const ly = y + 26 + runs.length * (narrow ? rh + 30 : rh + 6) + 8;
        items.push(...SL.legend('cmp:lg', lab, ly, PART.map(([, cls, name]) => ({ cls: 'tl ' + cls, text: name })), barMax, 12).items);
      }
      // ---- the sentence and the trace ----
      let say;
      if (k === 0) {
        say = runs[0].r.steps[0].say.replace(/^The head/, 'The arm') + ' ' + (single ? '' : SL.plural(runs.length, 'policy', 'policies') + ' serve the same queue: ' + SL.list(runs.map((x) => x.r.name)) + '.');
        if (reqs.some((q) => q.at > 0)) say += ' ' + SL.plural(reqs.filter((q) => q.at > 0).length, 'more request') + ' arrive later.';
      } else if (fin) {
        const best = runs.slice().sort((a, b) => a.r.totals.movement - b.r.totals.movement)[0], worst = runs.slice().sort((a, b) => b.r.totals.movement - a.r.totals.movement)[0];
        const st = runs.filter((x) => x.starved);
        say = single
          ? runs[0].r.name + ' served all ' + n + ' requests, moving the arm ' + best.r.totals.movement + ' cylinders' + (best.r.totals.jumps ? ' (' + best.r.totals.jumps + ' on return jumps)' : '') + ', in ' + fix(best.tot.total, 2) + ' ms: ' + fix(best.tot.seek, 2) + ' seek, ' + fix(best.tot.rot, 2) + ' rotation, ' + fix(best.tot.xfer, 2) + ' transfer. The longest wait was ' + best.r.totals.maxWait + ', the request for cylinder ' + best.starvedReq.cyl + (best.starved ? ': starved, passed by ' + best.starvedReq.passed + ' later requests.' : '.')
          : 'Least movement: ' + best.r.name + ', ' + best.r.totals.movement + ' cylinders and ' + fix(best.tot.total, 2) + ' ms; most: ' + worst.r.name + ', ' + worst.r.totals.movement + ' cylinders and ' + fix(worst.tot.total, 2) + ' ms. ' + (st.length ? 'Starvation: ' + st.map((x) => x.r.name + ' left cylinder ' + x.starvedReq.cyl + ' waiting ' + x.starvedReq.wait).join('; ') + '.' : 'No request starved: the longest wait is ' + Math.max(...runs.map((x) => x.r.totals.maxWait)) + '.');
      } else if (single) {
        const run = runs[0], x = run.rows[k - 1], st = run.r.steps.find((s) => s.kind === 'serve' && s.id === x.id);
        const a = x.access;
        say = st.say + ' Its access: ' + (x.legs.length ? fix(x.seek - a.seek.ms, 3) + ' ms for ' + SL.plural(x.legs.length, 'turn') + ' + ' : '') + fix(a.seek.ms, 3) + ' ms seek + ' + fix(a.rotation.ms, 3) + ' ms waiting for sector ' + x.sector + (x.count > 1 ? '' : '') + ' + ' + fix(a.transfer.ms, 3) + ' ms to read ' + SL.plural(x.count, 'sector') + ' = ' + fix(x.total, 3) + ' ms.';
      } else {
        say = 'Request ' + k + ' of ' + n + ': ' + runs.map((run) => { const x = run.rows[k - 1]; return run.r.name + ' serves ' + x.cyl + ' (+' + x.dist + ', ' + fix(x.total, 2) + ' ms)'; }).join('; ') + '.';
      }
      trace.push({ kind: k === 0 ? 'start' : fin ? 'done' : 'serve', say });
      const tables = runs.map((run) => ({
        title: run.r.name + (run.starved ? ' (starvation)' : ''),
        cols: ['#', 'cyl', 'moved', 'wait', 'seek', 'rotation', 'transfer', 'ms'],
        rows: run.rows.map((x, i) => [String(i + 1), String(x.cyl), String(x.dist), { text: String(x.wait), cls: run.starved && x.id === run.starvedReq.id ? 'bad' : '' }, fix(x.seek, 3), fix(x.rot, 3), fix(x.xfer, 3), fix(x.total, 3)]).concat([['Σ', '', String(run.r.totals.movement), '', fix(run.tot.seek, 2), fix(run.tot.rot, 2), fix(run.tot.xfer, 2), fix(run.tot.total, 2)]]),
        hl: !fin && k > 0 ? k - 1 : undefined,
      }));
      frames.push({ items, say, at: trace.length - 1, title: k === 0 ? 'start' : fin ? 'totals' : 'request ' + k, tables, hold: 1300 });
    }
    const metrics = [];
    for (const run of runs) {
      const t = run.r.totals;
      metrics.push({ label: run.r.name + ': cylinders moved', value: t.movement, note: t.jumps ? t.jumps + ' on return jumps' : '' });
      metrics.push({ label: run.r.name + ': access time', value: fix(run.tot.total, 2), unit: 'ms', note: fix(run.tot.seek, 2) + ' seek + ' + fix(run.tot.rot, 2) + ' rotation + ' + fix(run.tot.xfer, 2) + ' transfer' });
      metrics.push({ label: run.r.name + ': mean / longest wait', value: fix(t.meanWait, 2) + ' / ' + t.maxWait, cls: run.starved ? 'bad' : '', note: run.starved ? 'cylinder ' + run.starvedReq.cyl + ' starved' : '' });
    }
    const av = St().averages(plan.D);
    metrics.push({ label: 'One turn', value: fix(av.rev, 3), unit: 'ms', note: 'average rotational wait ' + fix(av.avgRotation, 3) + ' ms' }, { label: 'Average seek', value: fix(av.avgSeek, 3), unit: 'ms', note: 'over every pair of cylinders' });
    return { frames, trace, metrics, tables: frames[frames.length - 1].tables, plan };
  };
})(globalThis.Proses = globalThis.Proses || {});
