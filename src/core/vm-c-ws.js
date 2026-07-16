// Virtual-memory engines, part 3: thrashing and how to avoid it. A model of CPU utilisation against the degree of
// multiprogramming; the working set with window Δ and its size over time; and page-fault-frequency control that
// gives a process frames when it faults too often and takes them back when it faults rarely.
//   S.VM.thrashing({frames, wss, lifetime, k, disk, maxN}) -> {points: [{n, framesEach, lifetime, cpu, disk,
//     throughput}], best: n, say}
//     Each process needs wss frames to run well; between faults it computes for lifetime(m) ms with m frames:
//     lifetime × (m / wss)^k below wss, lifetime at or above it (k = 2). Each fault takes disk ms on one paging
//     disk. The CPU and the disk are solved as a closed queueing network with n processes (mean value analysis):
//     cpu is the CPU's utilisation, which climbs with n and then collapses once frames / n falls below wss.
//   S.VM.workingSet(refs, delta) -> {steps: [{t, page, ws: [pages], wss, entered, left}], avg, max, say}
//     the working set at time t: the distinct pages among the last delta references (t − Δ + 1 .. t)
//   S.VM.pff({refs, frames, lower, upper, interval, min, max}) -> {steps, faults, framesOver: [frames at each t]}
//     LRU within the process's frames; after every interval references the fault rate over it is compared with
//     the bounds: above upper the process gains a frame, below lower it loses one (its LRU page goes if all are
//     full). steps: {kind: 'ref', t, page, hit, victim, frames, resident} and {kind: 'adjust', t, rate, frames, say}
(function (S) {
  'use strict';
  const V = (S.VM = S.VM || {});

  V.thrashing = function (o) {
    const F = o.frames || 1000, W = o.wss || 100, L0 = o.lifetime || 20, k = o.k || 2, D = o.disk || 10, maxN = o.maxN || 20;
    const points = [];
    for (let n = 1; n <= maxN; n++) {
      const m = F / n, L = m >= W ? L0 : L0 * Math.pow(m / W, k);
      // mean value analysis, two queueing centres, n customers
      let qc = 0, qd = 0, X = 0;
      for (let c = 1; c <= n; c++) {
        const rc = L * (1 + qc), rd = D * (1 + qd);
        X = c / (rc + rd);
        qc = X * rc; qd = X * rd;
      }
      points.push({ n, framesEach: m, lifetime: L, cpu: Math.min(1, X * L), disk: Math.min(1, X * D), throughput: X });
    }
    const best = points.reduce((a, p) => (p.cpu > a.cpu ? p : a));
    const last = points[points.length - 1];
    return { points, best: best.n, say: 'CPU utilisation peaks at ' + Math.round(best.cpu * 100) + '% with ' + S.Mem.count(best.n, 'process', 'processes') + ' (' + Math.floor(best.framesEach) + ' frames each); with ' + last.n + ' each has ' + Math.floor(last.framesEach) + ' of the ' + W + ' it needs, the paging disk is ' + Math.round(last.disk * 100) + '% busy and the CPU only ' + Math.round(last.cpu * 100) + '%: thrashing.' };
  };

  V.workingSet = function (refs, delta) {
    const steps = [];
    let prev = new Set(), sum = 0, max = 0;
    refs.forEach((page, t) => {
      const win = refs.slice(Math.max(0, t - delta + 1), t + 1), ws = [...new Set(win)].sort((a, b) => a - b), set = new Set(ws);
      const entered = ws.filter((p) => !prev.has(p)), left = [...prev].filter((p) => !set.has(p)).sort((a, b) => a - b);
      sum += ws.length; max = Math.max(max, ws.length);
      steps.push({ kind: 'ws', t, page, ws, wss: ws.length, entered, left, say: 't = ' + (t + 1) + ', page ' + page + ': the last ' + win.length + ' reference' + (win.length === 1 ? ' holds ' : 's hold ') + S.Mem.count(ws.length, 'distinct page') + ' {' + ws.join(', ') + '}' + (left.length ? '; page' + (left.length > 1 ? 's ' : ' ') + S.Mem.list(left) + ' fell out of the window' : '') + '.' });
      prev = set;
    });
    const avg = refs.length ? sum / refs.length : 0;
    return { steps, avg, max, say: 'With Δ = ' + delta + ' the working set averages ' + avg.toFixed(2) + ' pages and peaks at ' + max + '.' };
  };

  V.pff = function (o) {
    const refs = o.refs, I = o.interval || 10, lo = o.lower, hi = o.upper, min = o.min || 1, maxF = o.max || Infinity;
    let frames = o.frames || 2, faults = 0, inI = 0;
    const res = [], last = new Map(), steps = [], framesOver = [];
    refs.forEach((page, t) => {
      last.set(page, t);
      const hit = res.includes(page);
      let victim = null;
      if (!hit) {
        faults++; inI++;
        if (res.length >= frames) { victim = res.reduce((a, p) => (last.get(p) < last.get(a) ? p : a)); res.splice(res.indexOf(victim), 1); }
        res.push(page);
      }
      steps.push({ kind: 'ref', t, page, hit, victim, frames, resident: res.slice().sort((a, b) => a - b), say: 't = ' + (t + 1) + ': page ' + page + (hit ? ' is resident.' : ' faults' + (victim !== null ? ' and replaces page ' + victim + ' (LRU).' : ' and takes a free frame.')) });
      if ((t + 1) % I === 0) {
        const rate = inI / I;
        let say = 'Over the last ' + S.Mem.count(I, 'reference') + ' the fault rate was ' + rate.toFixed(2);
        if (rate > hi && frames < maxF) { frames++; say += ', above ' + hi + ': the process gets frame number ' + frames + '.'; }
        else if (rate < lo && frames > min) {
          frames--;
          let gone = null;
          if (res.length > frames) { gone = res.reduce((a, p) => (last.get(p) < last.get(a) ? p : a)); res.splice(res.indexOf(gone), 1); }
          say += ', below ' + lo + ': the process gives up a frame' + (gone !== null ? ' (page ' + gone + ' goes)' : '') + ', leaving ' + frames + '.';
        } else say += ', within [' + lo + ', ' + hi + ']: the allocation stays at ' + frames + '.';
        steps.push({ kind: 'adjust', t, rate, frames, resident: res.slice().sort((a, b) => a - b), say });
        inI = 0;
      }
      framesOver.push(frames);
    });
    return { steps, faults, framesOver, say: S.Mem.count(faults, 'fault') + '; the allocation ended at ' + S.Mem.count(frames, 'frame') + '.' };
  };

  (S.engines = S.engines || []).push({ name: 'Working sets' });
})(globalThis.Proses = globalThis.Proses || {});
