// Disk-arm scheduling: FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK, N-step SCAN and F-SCAN, on a static queue or with
// requests arriving over time.
//   S.Storage.schedule(policy, {requests: [cyl | {cyl, at, id}], start, cylinders, dir: 'up'|'down', n, sweep,
//                               perCyl, service, jumpPerCyl, disk}) -> {policy, name, order, served, path, steps, totals}
//   Time: moving one cylinder takes perCyl (default 1), serving a request `service` (default 0); a C-SCAN or C-LOOK
//   return costs jumpPerCyl a cylinder (default perCyl). A request is seen once t ≥ its `at`.
//   FCFS   the oldest waiting request next.
//   SSTF   the nearest waiting request; a tie goes to the one in the arm's current direction, then the oldest.
//          The arm goes straight there and does not stop for requests that arrive on the way.
//   SCAN   the arm sweeps, serving every request it reaches; with nothing more ahead it carries on to the last
//          cylinder and turns, but only when requests wait behind it (with nothing waiting it stops where it is).
//   LOOK   as SCAN, but it turns as soon as nothing waits ahead.
//   C-SCAN serves in one direction only: at the last cylinder it returns to cylinder 0 (a jump) and sweeps on.
//   C-LOOK as C-SCAN, but it sweeps only as far as the last request and jumps back to the farthest one behind.
//   N-step SCAN  the waiting requests are taken n at a time, oldest first, and each batch is swept (sweep: 'scan'
//          default, or 'look'); requests that arrive meanwhile wait for a later batch.
//   F-SCAN the batch is everything waiting when a sweep starts; newcomers wait in the other queue.
//   served: [{id, cyl, at, start, done, wait, response, dist, passed, seekMs?}] in service order. dist counts the
//     cylinders moved since the previous service (turns and jumps included); passed counts the requests that came
//     later and were served first (overtakes); seekMs is the disk model's seek for |cyl − previous cyl| if `disk`.
//   path: [{t, cyl, kind: 'start'|'serve'|'turn'|'jump'|'land'|'idle'|'wake'|'end', id?}], straight lines between.
//   totals: {movement (jumps included), jumps, sweep (movement − jumps), time, meanDist, meanWait, maxWait, sdWait,
//     meanResponse, maxPassed, starved: the id with the longest wait}
//   steps: start, arrive, batch, serve, turn, jump, idle, done; each with {t, pos, dir, pending: [ids]}.
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const T = (S.Storage = S.Storage || {});
  const NAMES = { fcfs: 'FCFS', sstf: 'SSTF', scan: 'SCAN', cscan: 'C-SCAN', look: 'LOOK', clook: 'C-LOOK', nscan: 'N-step SCAN', fscan: 'F-SCAN' };
  T.policies = Object.keys(NAMES);
  T.policyName = (p) => NAMES[p] || p;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  T.schedule = function (policy, o) {
    if (!NAMES[policy]) throw new Error('unknown disk policy ' + policy);
    const a = Object.assign({ requests: [], start: 0, cylinders: 200, dir: 'up', n: 4, sweep: 'scan', perCyl: 1, service: 0 }, o || {});
    const C = a.cylinders, per = a.perCyl, jper = a.jumpPerCyl === undefined ? per : a.jumpPerCyl;
    const reqs = a.requests.map((r, i) => { const x = typeof r === 'number' ? { cyl: r } : r; return { idx: i, id: x.id === undefined ? i : x.id, cyl: x.cyl, at: x.at || 0 }; });
    for (const r of reqs) if (!(r.cyl >= 0 && r.cyl < C)) throw new Error('request ' + r.id + ' at cylinder ' + r.cyl + ' is off the disk');
    if (!(a.start >= 0 && a.start < C)) throw new Error('the head must start on the disk');
    const future = reqs.slice().sort((x, y) => x.at - y.at || x.idx - y.idx);
    const sweepKind = policy === 'nscan' || policy === 'fscan' ? a.sweep : policy;
    let t = 0, pos = a.start, dir = a.dir === 'down' ? -1 : 1, fi = 0, moved = 0, jumps = 0, sinceLast = 0, prevCyl = a.start;
    let pending = [], active = null;
    const served = [], path = [{ t: 0, cyl: pos, kind: 'start' }], steps = [];
    const snap = () => ({ t: r3(t), pos, dir: dir > 0 ? 'up' : 'down', pending: pending.map((r) => r.id), active: active ? active.map((r) => r.id) : null });
    const step = (kind, say, extra) => steps.push(Object.assign({ kind, say }, snap(), extra || {}));
    const ws = (d) => (dir > 0 ? 'up' : 'down');
    step('start', `The head starts at cylinder ${pos}, moving ${ws()}, with ${reqs.filter((r) => r.at <= 0).length} request${reqs.filter((r) => r.at <= 0).length === 1 ? '' : 's'} waiting: ${reqs.filter((r) => r.at <= 0).map((r) => r.cyl).join(', ') || 'none'}.`);
    const admit = () => {
      while (fi < future.length && future[fi].at <= t) {
        const r = future[fi++]; pending.push(r);
        if (r.at > 0) step('arrive', `t = ${r3(t)}: request ${r.id} arrives for cylinder ${r.cyl}.`, { id: r.id });
      }
    };
    const serve = (r) => {
      const start = t;
      path.push({ t: r3(t), cyl: pos, kind: 'serve', id: r.id });
      t += a.service;
      if (a.service) path.push({ t: r3(t), cyl: pos, kind: 'serve-end', id: r.id });
      pending = pending.filter((x) => x !== r); if (active) active = active.filter((x) => x !== r);
      const rec = { id: r.id, idx: r.idx, cyl: r.cyl, at: r.at, start: r3(start), done: r3(t), wait: r3(start - r.at), response: r3(t - r.at), dist: sinceLast };
      if (a.disk) rec.seekMs = S.Storage.seekTime(a.disk, r.cyl - prevCyl).ms;
      served.push(rec);
      step('serve', `t = ${r3(start)}: serve request ${r.id} at cylinder ${r.cyl}${sinceLast ? ' after moving ' + sinceLast + ' cylinder' + (sinceLast === 1 ? '' : 's') : ', where the head already is'}; it waited ${r3(start - r.at)}.`, { id: r.id, cyl: r.cyl, dist: sinceLast });
      sinceLast = 0; prevCyl = r.cyl;
    };
    const move = (to) => { const d = Math.abs(to - pos); if (to !== pos) dir = to > pos ? 1 : -1; t += d * per; moved += d; sinceLast += d; pos = to; };
    const jump = (to) => {
      const d = Math.abs(to - pos);
      path.push({ t: r3(t), cyl: pos, kind: 'jump' });
      step('jump', `${NAMES[policy]} returns from cylinder ${pos} to ${to} without serving: ${pl(d, 'cylinder')}.`, { from: pos, to, d });
      t += d * jper; moved += d; jumps += d; sinceLast += d; pos = to;
      path.push({ t: r3(t), cyl: pos, kind: 'land' });
    };
    const turn = () => { dir = -dir; path.push({ t: r3(t), cyl: pos, kind: 'turn' }); step('turn', `Nothing waits further ${dir > 0 ? 'down' : 'up'}: the arm turns at cylinder ${pos} and now moves ${ws()}.`); };
    let guard = 0;
    while (served.length < reqs.length) {
      if (++guard > 1e7) throw new Error('the disk schedule does not finish');
      admit();
      if ((policy === 'nscan' || policy === 'fscan') && (!active || !active.length) && pending.length) {
        active = policy === 'nscan' ? pending.slice(0, a.n) : pending.slice();
        step('batch', `A new batch for the sweep: request${active.length === 1 ? '' : 's'} ${active.map((r) => r.id).join(', ')} (cylinder${active.length === 1 ? '' : 's'} ${active.map((r) => r.cyl).join(', ')})${pending.length > active.length ? '; ' + (pending.length - active.length) + ' more wait' + (pending.length - active.length === 1 ? 's' : '') + ' for the next batch' : ''}.`, { batch: active.map((r) => r.id) });
      }
      const E = policy === 'nscan' || policy === 'fscan' ? active || [] : pending;
      if (!E.length) {
        const next = future[fi].at;
        path.push({ t: r3(t), cyl: pos, kind: 'idle' });
        step('idle', `Nothing waits: the arm rests at cylinder ${pos} until t = ${r3(next)}.`);
        t = next; path.push({ t: r3(t), cyl: pos, kind: 'wake' });
        continue;
      }
      if (policy === 'fcfs' || policy === 'sstf') {
        let r = E[0];
        if (policy === 'sstf') for (const x of E) {
          const dx = Math.abs(x.cyl - pos), dr = Math.abs(r.cyl - pos);
          if (dx < dr || (dx === dr && x.cyl !== r.cyl && (x.cyl - pos) * dir > 0)) r = x;
        }
        move(r.cyl); serve(r);
        continue;
      }
      const here = E.filter((r) => r.cyl === pos);
      if (here.length) { serve(here[0]); continue; }
      if (E.some((r) => (r.cyl - pos) * dir > 0)) { move(pos + dir); continue; }
      const edge = dir > 0 ? C - 1 : 0;
      if (sweepKind === 'look') turn();
      else if (sweepKind === 'scan') { if (pos !== edge) move(pos + dir); else turn(); }
      else if (sweepKind === 'cscan') { if (pos !== edge) move(pos + dir); else jump(dir > 0 ? 0 : C - 1); }
      else jump(dir > 0 ? Math.min(...E.map((r) => r.cyl)) : Math.max(...E.map((r) => r.cyl)));
    }
    path.push({ t: r3(t), cyl: pos, kind: 'end' });
    // overtakes: a later request served earlier
    served.forEach((r, i) => { r.passed = served.slice(0, i).filter((q) => q.at > r.at || (q.at === r.at && q.idx > r.idx)).length; });
    const n = served.length || 1, waits = served.map((r) => r.wait);
    const meanWait = waits.reduce((s, x) => s + x, 0) / n;
    const worst = served.reduce((w, r) => (!w || r.wait > w.wait ? r : w), null);
    const totals = {
      movement: moved, jumps, sweep: moved - jumps, time: r3(t), meanDist: r3(moved / n), meanWait: r3(meanWait), maxWait: worst ? worst.wait : 0,
      sdWait: r3(Math.sqrt(waits.reduce((s, x) => s + (x - meanWait) ** 2, 0) / n)), meanResponse: r3(served.reduce((s, r) => s + r.response, 0) / n),
      maxPassed: Math.max(0, ...served.map((r) => r.passed)), starved: worst ? worst.id : null,
    };
    if (a.disk) totals.seekMs = r3(served.reduce((s, r) => s + r.seekMs, 0));
    step('done', `${NAMES[policy]} serves ${reqs.length === 1 ? 'its one request' : 'all ' + reqs.length + ' requests'} in ${pl(r3(t), 'time unit')}, moving the arm ${pl(moved, 'cylinder')}${jumps ? ' (' + jumps + ' of them on returns)' : ''}; the longest wait is ${totals.maxWait}, by request ${totals.starved}.`);
    return { policy, name: NAMES[policy], start: a.start, cylinders: C, order: served.map((r) => r.id), served: served.map((r) => { const x = Object.assign({}, r); delete x.idx; return x; }), path, steps, totals };
  };
  (S.engines = S.engines || []).push({ name: 'Disk model and arm scheduling' });
})(globalThis.Proses = globalThis.Proses || {});
