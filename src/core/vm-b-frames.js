// Virtual-memory engines, part 2: sharing frames among processes. How many frames each process gets (equal,
// proportional to its size, or weighted by priority too), and replacement that is global (a fault may take any
// process's frame) against local (a process replaces only among its own).
//   S.VM.allocFrames({frames, procs: [{name, size, priority}], scheme: 'equal' | 'proportional' | 'priority',
//                     min}) -> {alloc: [{name, frames, exact}], spare, say}
//     equal: ⌊frames / n⌋ each, the rest kept spare; proportional: size / total × frames; priority: in proportion to
//     size × priority. Shares are floored and the frames left go one each to the largest remainders (ties the
//     earlier process); every process gets at least min (default 1) if there are frames for it.
//   S.VM.globalLocal({procs: [{name, refs}], frames, mode: 'global' | 'local', quota: [frames each] (local),
//                     policy: 'lru' | 'fifo', quantum}) -> {steps, faults: [per process], held: [per process]}
//     The processes take turns of quantum references. A fault takes a free frame if there is one (local: only
//     while the process is under its quota); otherwise the policy's victim among all frames (global) or among the
//     process's own (local).
//     step: {kind: 'ref', i, proc, page, hit, frame, victim: {proc, page} | null, held: [frames per process],
//            frames: [{proc, page}], say}
(function (S) {
  'use strict';
  const V = (S.VM = S.VM || {});

  V.allocFrames = function (o) {
    const F = o.frames, P = o.procs, n = P.length, min = o.min === undefined ? 1 : o.min, scheme = o.scheme || 'equal';
    if (scheme === 'equal') {
      const each = Math.floor(F / n), spare = F - each * n;
      return { alloc: P.map((p) => ({ name: p.name, frames: each, exact: F / n })), spare, say: S.Mem.count(F, 'frame') + ' among ' + S.Mem.count(n, 'process', 'processes') + ': ' + each + ' each' + (spare ? ', and ' + spare + ' kept spare.' : '.') };
    }
    const w = P.map((p) => (scheme === 'priority' ? p.size * (p.priority || 1) : p.size)), W = w.reduce((a, b) => a + b, 0);
    const exact = w.map((x) => (x / W) * F), a = exact.map((x) => Math.max(min, Math.floor(x)));
    // the minimums may overshoot: take back one at a time from the share furthest above its exact value
    for (let sum = a.reduce((s, x) => s + x, 0); sum > F; sum--) {
      let k = -1;
      a.forEach((x, j) => { if (x > min && (k < 0 || x - exact[j] > a[k] - exact[k])) k = j; });
      if (k < 0) break;
      a[k]--;
    }
    let left = F - a.reduce((s, x) => s + x, 0);
    const order = exact.map((x, j) => ({ j, r: x - Math.floor(x) })).sort((p, q) => q.r - p.r || p.j - q.j);
    for (let k = 0; left > 0; k = (k + 1) % n, left--) a[order[k].j]++;
    const what = scheme === 'priority' ? 'size × priority' : 'size';
    return { alloc: P.map((p, j) => ({ name: p.name, frames: a[j], exact: exact[j] })), spare: 0, say: S.Mem.count(F, 'frame') + ' in proportion to ' + what + ': ' + P.map((p, j) => p.name + ' ' + w[j] + '/' + W + ' × ' + F + ' = ' + exact[j].toFixed(2) + ' → ' + a[j]).join(', ') + '.' };
  };

  V.globalLocal = function (o) {
    const P = o.procs, n = P.length, F = o.frames, mode = o.mode || 'global', q = o.quantum || 1, policy = o.policy || 'lru';
    const quota = o.quota || V.allocFrames({ frames: F, procs: P.map((p) => ({ name: p.name, size: 1 })), scheme: 'equal' }).alloc.map((a) => a.frames);
    const fr = Array.from({ length: F }, () => ({ proc: -1, page: null, last: -1, seq: -1 }));
    const pos = P.map(() => 0), faults = P.map(() => 0), steps = [];
    let clock = 0;
    const held = () => P.map((_, k) => fr.filter((f) => f.proc === k).length);
    while (pos.some((x, k) => x < P[k].refs.length)) {
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < q && pos[k] < P[k].refs.length; j++, pos[k]++) {
          const page = P[k].refs[pos[k]], t = clock++;
          let at = fr.findIndex((f) => f.proc === k && f.page === page), victim = null;
          const hit = at >= 0;
          if (hit) fr[at].last = t;
          else {
            faults[k]++;
            const free = fr.findIndex((f) => f.proc === -1);
            const mine = fr.filter((f) => f.proc === k).length;
            if (free >= 0 && (mode === 'global' || mine < quota[k])) at = free;
            else {
              const pool = [...fr.keys()].filter((i) => mode === 'global' || fr[i].proc === k);
              if (!pool.length) throw new Error(P[k].name + ' has no frame to replace (quota 0)');
              const key = policy === 'fifo' ? 'seq' : 'last';
              at = pool.reduce((a, i) => (fr[i][key] < fr[a][key] ? i : a));
              victim = { proc: fr[at].proc, page: fr[at].page };
            }
            fr[at] = { proc: k, page, last: t, seq: t };
          }
          const h = held();
          const say = P[k].name + ' references page ' + page + (hit ? ': a hit in frame ' + at + '.' : ': a fault; ' + (victim ? (victim.proc === k ? 'it replaces its own page ' + victim.page : 'it takes frame ' + at + ' from ' + P[victim.proc].name + ' (page ' + victim.page + ')') : 'it takes free frame ' + at) + ', and now holds ' + h[k] + ' frame' + (h[k] === 1 ? '' : 's') + '.');
          steps.push({ kind: 'ref', i: steps.length, proc: k, page, hit, frame: at, victim, held: h, frames: fr.map((f) => ({ proc: f.proc, page: f.page })), say });
        }
      }
    }
    return { mode, steps, faults, held: held(), say: mode + ' replacement: ' + P.map((p, k) => p.name + ' ' + S.Mem.count(faults[k], 'fault') + '').join(', ') + '.' };
  };

  (S.engines = S.engines || []).push({ name: 'Frame allocation' });
})(globalThis.Proses = globalThis.Proses || {});
