// Part 12, disk-arm scheduling: one policy on a queue of requests, the arm's path drawn cylinder by cylinder
// against time, and every policy side by side on the same queue. The schedules come from the engine
// (src/core/st-e-sched.js); requests may arrive while the arm works (cylinder@time).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const POL = [
    { value: 'fcfs', label: 'FCFS (first come, first served)' }, { value: 'sstf', label: 'SSTF (shortest seek first)' },
    { value: 'scan', label: 'SCAN (the elevator)' }, { value: 'cscan', label: 'C-SCAN (one way, then return)' },
    { value: 'look', label: 'LOOK' }, { value: 'clook', label: 'C-LOOK' },
    { value: 'nscan', label: 'N-step SCAN' }, { value: 'fscan', label: 'F-SCAN' },
  ];
  const parse = (x) => { const m = String(x).match(/^(\d+)(?:@(\d+))?$/); return m ? { cyl: +m[1], at: m[2] ? +m[2] : 0 } : null; };
  const reqCheck = (v, inp) => { if (!v.every(parse)) return 'requests: a cylinder, or cylinder@time such as 120@40'; if (v.some((x) => parse(x).cyl >= inp.cylinders)) return 'requests: every cylinder below ' + inp.cylinders; return null; };
  const QUEUE = ['130', '41', '188', '12', '97', '155', '63', '77'];
  /** the schedule for an input */
  const sched = (inp, policy) => S.Storage.schedule(policy || inp.policy, { requests: inp.reqs.map(parse).map((q, i) => ({ cyl: q.cyl, at: q.at, id: i })), start: inp.start, cylinders: inp.cylinders, dir: inp.dir, n: inp.n });
  S.T12.armSched = sched;
  S.T12.armParse = parse;

  /** the arm's path: cylinders across the top, time down; the path up to time `upTo` (jumps dashed) */
  function chart(o) {
    const t = T(), items = [], P = o.prefix, C = o.C, x0 = o.x, x1 = o.x + o.w, y0 = o.y, H = o.h, t1 = Math.max(1, o.t1);
    const X = (c) => t.r1(x0 + (c / (C - 1)) * (x1 - x0)), Y = (tm) => t.r1(y0 + (tm / t1) * H);
    items.push({ key: P + ':axt', kind: 'path', d: `M${x0},${y0} H${x1}`, cls: 'axis', audit: 'ignore', layer: 'back' });
    const step = t.niceStep(C, o.ticks || 8), tk = [];
    for (let c = 0; c < C; c += step) tk.push(c);
    if (C - 1 - tk[tk.length - 1] < step * 0.45) tk.pop();
    tk.push(C - 1);
    let gd = '';
    tk.forEach((c, k) => { gd += `M${X(c)},${y0} V${t.r1(y0 + H)} `; items.push(t.text(P + ':tx' + k, X(c), y0 + H + 22, String(c), 'tick', o.tickSize || 13, 'middle')); });
    items.push({ key: P + ':grid', kind: 'path', d: gd, cls: 'grid', audit: 'ignore', layer: 'back' });
    items.push({ key: P + ':axb', kind: 'path', d: `M${x0},${t.r1(y0 + H)} H${x1}`, cls: 'axis', audit: 'ignore', layer: 'back' });
    if (o.names !== false) {
      items.push(t.text(P + ':xn', x1, y0 + H + 42, 'cylinder', 'axname', 13, 'end'));
      items.push(t.text(P + ':yn', x0 - 8, y0 + 5, 't = 0', 'tick', 13, 'end'), t.text(P + ':yn2', x0 - 8, t.r1(y0 + H + 4), 't = ' + t.fix(t1, 1), 'tick', 13, 'end'));
    }
    // the path, as straight runs (and dashed jumps) up to upTo
    const path = o.path, up = o.upTo;
    let d = '', dj = '', last = null;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (p.t > up + 1e-9) {
        if (last) { const f = (up - last.t) / (p.t - last.t), c = last.cyl + (p.cyl - last.cyl) * f, seg = `M${X(last.cyl)},${Y(last.t)} L${X(c)},${Y(up)} `; if (last.kind === 'jump') dj += seg; else d += seg; last = { t: up, cyl: c }; }
        break;
      }
      if (last && (last.t !== p.t || last.cyl !== p.cyl)) { const seg = `M${X(last.cyl)},${Y(last.t)} L${X(p.cyl)},${Y(p.t)} `; if (last.kind === 'jump') dj += seg; else d += seg; }
      last = p;
    }
    items.push({ key: P + ':path', kind: 'path', d: d || `M${X(o.start)},${y0}`, cls: 'arm-path ' + (o.cls || ''), audit: 'ignore', layer: 'lines' });
    if (dj || o.jumps) items.push({ key: P + ':jump', kind: 'path', d: dj || `M${X(o.start)},${y0}`, cls: 'arm-path jump', audit: 'ignore', layer: 'lines' });
    // service points
    for (const s of o.served) if (s.done <= up + 1e-9) items.push({ key: P + ':sv' + s.id, kind: 'dot', x: X(s.cyl), y: Y(s.done), r: o.r || 5, cls: 'req done' + (s.id === o.act ? ' act' : '') + (o.late && o.late.has(s.id) ? ' late' : ''), audit: 'ignore' });
    if (last) items.push({ key: P + ':now', kind: 'dot', x: X(last.cyl), y: Y(last.t), r: o.r ? o.r + 1 : 6.5, cls: 'pl-headdot', audit: 'ignore', layer: 'top' });
    return { items, X, Y, pos: last };
  }
  S.T12.armChart = chart;

  // =================================================================================================================
  S.topic({
    id: 'disk-arm', family: 'p12-arm', order: 10, title: 'Scheduling the disk arm',
    blurb: 'Requests wait for cylinders all over the disk. First come first served zigzags; shortest seek first goes to the nearest, and can leave a far request waiting; SCAN sweeps like an elevator; C-SCAN sweeps one way and jumps back; LOOK and C-LOOK turn at the last request instead of the edge. Watch the arm’s path and the cylinders it travels.',
    inputs: [
      { id: 'policy', kind: 'choice', label: 'policy', def: 'sstf', options: POL },
      { id: 'reqs', kind: 'list', label: 'requests (cylinder or cylinder@time)', def: QUEUE, min: 1, max: 14, check: reqCheck },
      { id: 'start', kind: 'number', label: 'arm starts at', def: 104, min: 0, max: 100000 },
      { id: 'dir', kind: 'choice', label: 'moving', def: 'up', options: [{ value: 'up', label: 'up (to higher cylinders)' }, { value: 'down', label: 'down' }] },
      { id: 'cylinders', kind: 'number', label: 'cylinders', def: 200, min: 20, max: 100000 },
      { id: 'n', kind: 'number', label: 'N (N-step SCAN batch)', def: 3, min: 1, max: 14 },
    ],
    check(inp) { if (inp.start >= inp.cylinders) return 'arm starts at: below ' + inp.cylinders; return null; },
    presets: [
      { label: 'SSTF on a morning queue', values: { policy: 'sstf', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'FCFS: the zigzag', values: { policy: 'fcfs', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'SCAN, the elevator', values: { policy: 'scan', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'C-SCAN', values: { policy: 'cscan', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'LOOK', values: { policy: 'look', reqs: QUEUE, start: 104, dir: 'down', cylinders: 200 } },
      { label: 'C-LOOK', values: { policy: 'clook', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'SSTF leaves a far request waiting', values: { policy: 'sstf', reqs: ['20', '178', '172', '181@4', '174@8', '179@12', '176@16', '183@20', '171@24', '177@28', '180@32'], start: 175, dir: 'up', cylinders: 200 } },
      { label: 'The same stream under LOOK', values: { policy: 'look', reqs: ['20', '178', '172', '181@4', '174@8', '179@12', '176@16', '183@20', '171@24', '177@28', '180@32'], start: 175, dir: 'up', cylinders: 200 } },
      { label: 'N-step SCAN, batches of 3', values: { policy: 'nscan', reqs: ['150', '30', '90', '60@20', '170@40', '10@60', '120@80'], start: 100, dir: 'up', cylinders: 200, n: 3 } },
      { label: 'F-SCAN freezes the queue', values: { policy: 'fscan', reqs: ['150', '30', '90', '60@20', '170@40', '10@60', '120@80'], start: 100, dir: 'up', cylinders: 200 } },
      { label: 'A big disk, LOOK', values: { policy: 'look', reqs: ['61200', '1450', '39000', '88000', '72500', '15800', '50100', '97000', '24400', '8000'], start: 45000, dir: 'up', cylinders: 100000 } },
    ],
    counters: [{ id: 'moved', label: 'cylinders moved' }, { id: 'served', label: 'served' }],
    run(inp) {
      const t = T(), r = sched(inp), C = inp.cylinders, q = inp.reqs.map(parse);
      const F = new S.Frames(['moved', 'served']);
      const x0 = 74, W = 700, y0 = 80, H = 250, t1 = r.totals.time;
      const servedAt = new Map(r.served.map((s, k) => [s.id, Object.assign({ k }, s)]));
      const starved = new Set([r.totals.starved]), none = new Set();
      const strip = (k, act, late) => {
        const its = [t.title('da:st', x0, y0 + H + 72, 'served in this order')], bw = Math.min(56, Math.floor((W + 6) / Math.max(1, r.served.length)) - 6);
        r.served.forEach((s, i) => {
          if (i >= k) return;
          const x = x0 + i * (bw + 6);
          its.push(t.cell('da:o' + s.id, x, y0 + H + 84, bw, 32, s.cyl, 'q done' + (s.id === act ? ' act' : '') + (late.has(s.id) ? ' late' : ''), C >= 10000 ? 12 : 14, { sub: (s.dist ? '+' + s.dist : '0') }));
        });
        return its;
      };
      const frame = (st, i) => {
        const up = st.t, pend = new Set(st.pending || []), late = st.kind === 'done' ? starved : none;
        const ch = chart({ prefix: 'da:c', C, x: x0, y: y0, w: W, h: H, t1, path: r.path, upTo: up, start: inp.start, served: r.served, act: st.kind === 'serve' ? st.id : null, late, jumps: inp.policy === 'cscan' || inp.policy === 'clook' });
        const its = [...ch.items];
        // the requests on the cylinder axis: waiting (open), served (filled), not yet arrived (not drawn)
        q.forEach((qq, id) => {
          const sv = servedAt.get(id), done = sv && sv.done <= up + 1e-9, here = qq.at <= up + 1e-9;
          if (!here) return;
          its.push({ key: 'da:q' + id, kind: 'dot', x: ch.X(qq.cyl), y: y0, r: 6, cls: 'req' + (done ? ' done' : '') + (st.kind === 'serve' && st.id === id ? ' act' : '') + (late.has(id) ? ' late' : ''), audit: 'ignore', layer: 'top' });
        });
        const pos = ch.pos ? ch.pos.cyl : inp.start;
        its.push({ key: 'da:arm', kind: 'head', x: ch.X(pos), y: y0 - 8, text: String(R(pos)), side: 'above', cls: 'act' });
        const k = r.served.filter((s) => s.done <= up + 1e-9).length;
        its.push(...strip(k, st.kind === 'serve' ? st.id : null, late));
        const waiting = [...pend].map((id) => q[id].cyl);
        its.push(t.text('da:w', x0, y0 + H + 152, waiting.length ? 'waiting: ' + waiting.join(', ') : 'nothing waiting', 'tick', 13));
        return its;
      };
      let moved = 0;
      const steps = r.steps;
      steps.forEach((st, i) => {
        const prev = i ? steps[i - 1] : null;
        if (st.kind === 'serve') { moved += st.dist; F.count('served'); }
        F.set('moved', st.kind === 'done' ? r.totals.movement : moved);
        let say = st.say, extra = {};
        const at0 = q.filter((x) => x.at <= 0).map((x) => x.cyl);
        if (st.kind === 'start') extra = { nAt0: at0.length };
        if (st.kind === 'batch') extra = { left: (st.pending || []).length - st.batch.length, ids: st.batch };
        if (st.kind === 'idle') { const nx = steps[i + 1]; extra = { nextT: nx ? nx.t : st.t }; }
        if (st.kind === 'serve' && prev) {
          const cands = [...new Set((prev.pending || []).concat(st.id))].map((id) => ({ id, cyl: q[id].cyl, d: Math.abs(q[id].cyl - prev.pos) }));
          Object.assign(extra, { cands, prevPos: prev.pos });
          if (inp.policy === 'sstf' && cands.length > 1) { const near = cands.slice().sort((a, b) => a.d - b.d); say += ` From cylinder ${prev.pos} it was the nearest: ${near.slice(0, 3).map((c) => c.cyl + ' is ' + c.d + ' away').join(', ')}.`; extra.near = near.slice(0, 3); }
        }
        const sv = st.kind === 'serve' ? servedAt.get(st.id) : null;
        F.add({ items: frame(st, i), title: st.kind, say, meta: Object.assign({ phase: st.kind, step: st, k: i, moved, totals: r.totals, served: sv, nreq: r.served.length, nWait: q.filter((x, id) => x.at <= st.t + 1e-9 && !(servedAt.get(id).done <= st.t + 1e-9 && st.kind !== 'start')).length }, extra) });
      });
      // what each frame's next service is, for the predictions
      const L = F.list;
      for (let i = 0; i < L.length; i++) { const nx = L.slice(i + 1).find((f) => f.meta.phase === 'serve'); L[i].meta.next = nx ? { cyl: nx.meta.step.cyl, cands: nx.meta.cands } : null; }
      const tot = r.totals;
      L[L.length - 1].say = `${r.name} served all ${t.plural(r.served.length, 'request')}, moving the arm ${tot.movement} cylinders${tot.jumps ? ` (${tot.jumps} of them on the return jump)` : ''}, ${t.fix(tot.meanDist, 2)} a request. The mean wait was ${t.fix(tot.meanWait, 2)} and the longest ${tot.maxWait}, by the request for cylinder ${q[tot.starved].cyl}.`;
      L[L.length - 1].meta.starvedCyl = q[tot.starved].cyl;
      return { frames: L, def: { sections: [{ id: 'p', kind: 'math', title: r.name, text: { fcfs: 'serve in arrival order', sstf: 'serve the nearest waiting request\na far request may wait a long time', scan: 'sweep to the edge serving on the way, then turn\nthe middle is served twice as often as the edges', cscan: 'sweep up serving, jump back to cylinder 0, sweep again\nevery cylinder waits about the same', look: 'like SCAN, but turn at the last request', clook: 'like C-SCAN, but jump from the last request\nto the farthest one behind', nscan: 'take the waiting requests N at a time\nsweep each batch; newcomers wait for a later batch', fscan: 'freeze the queue when a sweep starts\nnewcomers wait in the other queue' }[inp.policy] + '\n\nmovement = Σ |cylinder − previous cylinder|' }] } };
    },
    predict: [
      { at: (f) => (f.meta.phase === 'start' || f.meta.phase === 'serve') && f.meta.next && f.meta.next.cands && f.meta.next.cands.length > 2 && f.meta.k < 6, pick: 'option', ask: (fr, i) => 'The arm is on cylinder ' + (fr[i].meta.step.pos) + '. Which cylinder will it serve next?', options: (fr, i) => { const n = fr[i].meta.next; const opts = n.cands.slice().sort((a, b) => a.d - b.d).slice(0, 3).map((c) => String(c.cyl)); if (!opts.includes(String(n.cyl))) opts[2] = String(n.cyl); return [...new Set(opts)].sort((a, b) => a - b); }, answer: (fr, i) => String(fr[i].meta.next.cyl), explain: (fr, i) => fr.slice(i + 1).find((f) => f.meta.phase === 'serve').say },
    ],
    quiz: [
      { q: 'Which policy can leave one request waiting indefinitely while new requests keep arriving near the arm?', options: ['SSTF', 'FCFS', 'C-SCAN', 'F-SCAN'], answer: 0, why: 'SSTF always picks the nearest request, so a stream of close ones keeps winning.' },
      { q: 'Why does C-SCAN give more even waiting times than SCAN?', options: ['every cylinder is passed once per cycle, in the same direction', 'it moves the arm less', 'it serves the nearest request', 'it never moves the arm to the edge'], answer: 0, why: 'SCAN passes the middle cylinders twice per round trip and the edges once; C-SCAN treats the disk as a circle.' },
      { q: 'LOOK differs from SCAN in that it…', options: ['turns at the last request instead of the edge of the disk', 'serves requests in arrival order', 'jumps back to cylinder 0', 'serves the nearest request first'], answer: 0, why: 'There is no point travelling to the edge when nothing waits there.' },
      { q: 'With the arm at 50 and requests at 45, 70 and 10, SSTF serves first…', options: ['45', '70', '10', 'whichever came first'], answer: 0, why: '45 is 5 cylinders away, the nearest.' },
      { q: 'F-SCAN keeps newly arrived requests out of the sweep in progress so that…', options: ['a stream of new requests cannot hold the arm in one place', 'the arm moves less', 'requests are served in arrival order', 'the disk spins faster'], answer: 0, why: 'Requests that arrive during a sweep wait for the next one, which bounds every wait.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
