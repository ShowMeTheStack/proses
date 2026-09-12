// Part 12, disk-arm scheduling (2): every policy on the same queue, each path drawn small, then the movement and
// the waiting of each compared. The schedules come from the engine (src/core/st-e-sched.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const SIX = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'], EIGHT = SIX.concat(['nscan', 'fscan']);
  const QUEUE = ['130', '41', '188', '12', '97', '155', '63', '77'];

  S.topic({
    id: 'disk-arm-compare', family: 'p12-arm', order: 20, title: 'Every policy on one queue',
    blurb: 'The same requests, the same starting place, and each policy’s path side by side. Count the cylinders each one moves and the longest any request waits: the policy that moves least is not always the one that treats every request fairly.',
    inputs: [
      { id: 'set', kind: 'choice', label: 'policies', def: 'six', options: [{ value: 'six', label: 'the six classic policies' }, { value: 'eight', label: 'with N-step SCAN and F-SCAN' }] },
      { id: 'reqs', kind: 'list', label: 'requests (cylinder or cylinder@time)', def: QUEUE, min: 1, max: 14, check: (v, inp) => { const p = S.T12.armParse; if (!v.every(p)) return 'requests: a cylinder, or cylinder@time such as 120@40'; if (v.some((x) => p(x).cyl >= inp.cylinders)) return 'requests: every cylinder below ' + inp.cylinders; return null; } },
      { id: 'start', kind: 'number', label: 'arm starts at', def: 104, min: 0, max: 100000 },
      { id: 'dir', kind: 'choice', label: 'moving', def: 'up', options: [{ value: 'up', label: 'up' }, { value: 'down', label: 'down' }] },
      { id: 'cylinders', kind: 'number', label: 'cylinders', def: 200, min: 20, max: 100000 },
      { id: 'n', kind: 'number', label: 'N (N-step SCAN batch)', def: 3, min: 1, max: 14 },
    ],
    check(inp) { if (inp.start >= inp.cylinders) return 'arm starts at: below ' + inp.cylinders; return null; },
    presets: [
      { label: 'A morning queue', values: { set: 'six', reqs: QUEUE, start: 104, dir: 'up', cylinders: 200 } },
      { label: 'The arm near an edge', values: { set: 'six', reqs: ['22', '35', '160', '178', '120', '9', '64'], start: 15, dir: 'up', cylinders: 200 } },
      { label: 'A stream of near requests', values: { set: 'eight', reqs: ['20', '178', '172', '181@4', '174@8', '179@12', '176@16', '183@20', '171@24', '177@28', '180@32'], start: 175, dir: 'up', cylinders: 200, n: 3 } },
      { label: 'A big disk', values: { set: 'six', reqs: ['61200', '1450', '39000', '88000', '72500', '15800', '50100', '97000', '24400', '8000'], start: 45000, dir: 'up', cylinders: 100000 } },
    ],
    counters: [{ id: 'shown', label: 'policies shown' }],
    run(inp) {
      const t = T(), pols = inp.set === 'eight' ? EIGHT : SIX, res = pols.map((p) => S.T12.armSched(inp, p)), C = inp.cylinders, q = inp.reqs.map(S.T12.armParse);
      const F = new S.Frames(['shown']);
      const NC = pols.length > 6 ? 4 : 3, gapX = NC === 4 ? 26 : 32, cw = Math.floor((760 - (NC - 1) * gapX) / NC), chH = 80, rowH = chH + 66, x0 = 30;
      const tmax = Math.max(...res.map((r) => r.totals.time));
      const bestMove = Math.min(...res.map((r) => r.totals.movement)), worstMove = Math.max(...res.map((r) => r.totals.movement));
      const bestWait = Math.min(...res.map((r) => r.totals.maxWait));
      const rows = Math.ceil(pols.length / NC), barsY = 24 + rows * rowH + 6;
      const mini = (k, act) => {
        const r = res[k], col = k % NC, row = Math.floor(k / NC), x = x0 + col * (cw + gapX), y = 24 + row * rowH;
        const ch = S.T12.armChart({ prefix: 'cm:' + k, C, x, y: y + 30, w: cw, h: chH, t1: tmax, path: r.path, upTo: Infinity, start: inp.start, served: r.served, names: false, r: 3.5, ticks: 3, jumps: false, tickSize: 13 });
        return [t.text('cm:t' + k, x, y + 12, r.name, 'strong' + (act ? ' act-t' : ''), 14), t.text('cm:m' + k, x + cw, y + 12, r.totals.movement + (NC === 4 ? '' : ' cylinders'), 'calc' + (r.totals.movement === bestMove ? ' good' : ''), 13, 'end'), ...ch.items];
      };
      const bars = (n) => {
        const its = [t.title('cm:bt', x0, barsY + 4, 'cylinders moved'), t.title('cm:wt', x0 + 400, barsY + 4, 'longest wait')], bw = 220, bh = 22;
        const worstWait = Math.max(...res.map((r) => r.totals.maxWait));
        res.slice(0, n).forEach((r, k) => {
          const y = barsY + 18 + k * (bh + 6), w = Math.max(3, (r.totals.movement / worstMove) * bw), w2 = Math.max(3, (r.totals.maxWait / worstWait) * bw);
          its.push(t.text('cm:bn' + k, x0 + 76, y + 16, r.name, 'strong', 13, 'end'));
          its.push(t.cell('cm:b' + k, x0 + 86, y, w, bh, '', 'bar12' + (r.totals.movement === bestMove ? ' best' : r.totals.movement === worstMove ? ' worst' : ''), 13));
          its.push(t.text('cm:bv' + k, x0 + 86 + w + 8, y + 16, String(r.totals.movement), 'calc', 13));
          its.push(t.cell('cm:w' + k, x0 + 400, y, w2, bh, '', 'bar12' + (r.totals.maxWait === bestWait ? ' best' : r.totals.maxWait === worstWait ? ' worst' : ''), 13));
          its.push(t.text('cm:wv' + k, x0 + 400 + w2 + 8, y + 16, String(r.totals.maxWait), 'calc', 13));
        });
        return its;
      };
      const meta = { res: res.map((r) => ({ name: r.name, totals: r.totals, order: r.served.map((s) => s.cyl) })), bestMove, worstMove, bestWait, start: inp.start, n: q.length, q };
      const all = [];
      F.add({ items: [t.text('cm:intro', x0, 40, `${t.plural(q.length, 'request')}, the arm at cylinder ${inp.start} moving ${inp.dir}`, 'strong', 15), t.text('cm:q', x0, 70, 'queue: ' + q.map((x) => x.cyl + (x.at ? '@' + x.at : '')).join(', '), 'calc', 14)], say: `${t.cap(t.plural(q.length, 'request'))} wait: ${q.map((x) => x.cyl + (x.at ? ' (arriving at t = ' + x.at + ')' : '')).join(', ')}. The arm is on cylinder ${inp.start}, moving ${inp.dir}. Each policy now serves the same queue; time runs down each chart, on one scale.`, meta: Object.assign({ phase: 'queue' }, meta) });
      res.forEach((r, k) => {
        F.set('shown', k + 1);
        all.push(...mini(k, false));
        const items = all.slice(0, all.length - mini(k, false).length).concat(mini(k, true));
        const tt = r.totals;
        F.add({ items, title: r.name, say: `${r.name} serves ${r.served.map((s) => s.cyl).join(', ')}: ${tt.movement} cylinders${tt.jumps ? ` (${tt.jumps} of them on the return)` : ''}. The mean wait is ${t.fix(tt.meanWait, 2)}, the longest ${tt.maxWait}, by the request for cylinder ${q[tt.starved].cyl}.`, meta: Object.assign({ phase: 'policy', k, starvedCyl: q[tt.starved].cyl }, meta) });
      });
      const best = res.filter((r) => r.totals.movement === bestMove).map((r) => r.name), fair = res.filter((r) => r.totals.maxWait === bestWait).map((r) => r.name), worst = res.filter((r) => r.totals.movement === worstMove).map((r) => r.name);
      F.add({ items: all.concat(bars(res.length)), title: 'compared', say: `Least movement: ${t.list(best)}, ${bestMove} cylinders; most: ${t.list(worst)}, ${worstMove}. The shortest longest wait, ${bestWait}, belongs to ${t.list(fair)}${fair.some((x) => best.includes(x)) ? '' : ': saving movement is not the same as treating every request fairly'}.`, meta: Object.assign({ phase: 'bars' }, meta) });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Measures', text: ['movement = Σ |cylinder − previous|', 'wait of a request = when it is served − when it arrived', 'mean wait: the average over the requests', 'longest wait: the worst-treated request'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'queue', pick: 'option', ask: 'Which policy will move the arm least on this queue?', options: (fr) => fr[0].meta.res.map((r) => r.name), answer: (fr) => { const m = fr[0].meta; return m.res.find((r) => r.totals.movement === m.bestMove).name; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'FCFS usually moves the arm the most because…', options: ['it ignores where the requests are', 'it sweeps to the edge', 'it serves the nearest first', 'it jumps back to cylinder 0'], answer: 0, why: 'Arrival order has nothing to do with position, so the arm zigzags.' },
      { q: 'C-SCAN moves the arm more than SCAN on the same queue, yet it is often preferred because…', options: ['waits are more even across the disk', 'it moves less', 'it serves the nearest request', 'it never reaches the edge'], answer: 0, why: 'The return trip costs movement but every cylinder gets the same treatment.' },
      { q: 'A policy with the least total movement is guaranteed to have the shortest longest wait.', options: ['false', 'true'], answer: 0, why: 'SSTF often moves least yet can make one far request wait for everything else.' },
      { q: 'LOOK beats SCAN on movement when…', options: ['no request waits near the edge it would sweep to', 'the queue is empty', 'all requests are at the edge', 'never'], answer: 0, why: 'LOOK saves the trip to the edge when nothing waits there.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
