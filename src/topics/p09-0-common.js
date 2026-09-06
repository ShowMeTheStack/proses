// Part 9, deadlocks: the families, and the helpers parts 9, 17 and 18 share (S.P09): small item makers, number and
// list wording, and the resource-allocation scenarios with their hand-placed layouts (so that no two edges of a
// graph cross), run on the deadlock engines (dl-*.js) and the model checker (mc-*.js).
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'deadlock', order, title, blurb });
  fam('p09-graphs', 10, 'Resource-allocation graphs', 'Processes, resource types with their units, request and assignment edges drawn live; cycles found by a depth-first search; the wait-for graph.');
  fam('p09-conditions', 20, 'The four conditions and prevention', 'Mutual exclusion, hold and wait, no preemption and circular wait: all four are needed, so breaking any one prevents deadlock, at a price.');
  fam('p09-avoid', 30, 'Avoidance', 'Safe states and the banker\'s algorithm row by row, requests granted or refused, and the claim graph for single units.');
  fam('p09-detect', 40, 'Detection and recovery', 'The detection algorithm for many units, then recovery by aborting processes or by preempting and rolling back.');
  fam('p09-locks', 50, 'Locks in programs', 'Two locks in opposite orders, a lock-order checker that sees the danger in a run that did not deadlock, and livelock.');

  const H = (S.P09 = S.P09 || {});
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text, cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  H.title = (key, x, y, text, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text, cls: 'title' }; if (anchor) it.anchor = anchor; return it; };
  H.box = (x, y, w, h) => ({ x, y, w, h });
  H.plural = (k, word, many) => k + ' ' + (Number(k) === 1 ? word : many || word + 's');
  H.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  H.vec = (v) => '(' + v.join(', ') + ')';
  H.cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  /** strip the backticks the engines put round values, for text drawn on the stage */
  H.plain = (s) => String(s || '').replace(/`/g, '');
  /** wrapped lines of text, top-left at (x, y): items */
  H.para = (prefix, x, y, text, w, cls, size, lh) => {
    size = size || 14; lh = lh || Math.round(size * 1.45);
    const lines = S.Kit.proc.wrap(H.plain(text), w, size);
    return lines.map((l, i) => H.text(prefix + i, x, y + i * lh, l, cls === undefined ? '' : cls, size));
  };
  H.paraH = (text, w, size, lh) => { size = size || 14; lh = lh || Math.round(size * 1.45); return S.Kit.proc.wrap(H.plain(text), w, size).length * lh; };
  H.cache = new Map();
  H.once = (k, f) => { if (!H.cache.has(k)) H.cache.set(k, f()); return H.cache.get(k); };
  /** a quiz/prediction helper: shuffle-free options with the answer first moved to a stable place */
  H.opts = (answer, others) => { const all = [answer].concat(others.filter((x) => x !== answer)); return all.sort(); };

  // ---- resource scenarios for the rules simulator (dl-d-sim.js), each with a layout for its graph ----------------
  // pos: where each process (p0..) and resource (r0..) sits; positions are chosen so the graph's edges meet only at
  // their ends whatever state the run reaches.
  const req = (r, n) => ({ op: 'req', r, n: n || 1 }), rel = (r, n) => ({ op: 'rel', r, n: n || 1 }), work = { op: 'work' };
  const ring = (n, R) => {
    const pos = {};
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n, b = a + Math.PI / n;
      pos['r' + i] = { x: Math.round(R * Math.cos(a)), y: Math.round(R * Math.sin(a)) };
      pos['p' + i] = { x: Math.round(R * Math.cos(b)), y: Math.round(R * Math.sin(b)) };
    }
    return pos;
  };
  H.SCEN = {
    pair: {
      label: 'Two processes, two printers taken in opposite orders',
      spec: { procs: [{ name: 'P0', script: [req(0), work, req(1), work, rel(1), rel(0)] }, { name: 'P1', script: [req(1), work, req(0), work, rel(0), rel(1)] }], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }] },
      pos: { p0: { x: -150, y: 0 }, r0: { x: 0, y: -115 }, p1: { x: 150, y: 0 }, r1: { x: 0, y: 115 } },
      story: 'P0 copies from scanner R0 to plotter R1; P1 copies the other way.',
    },
    ring3: {
      label: 'Three processes round a ring of three tape drives',
      spec: { procs: [0, 1, 2].map((i) => ({ name: 'P' + i, script: [req(i), work, req((i + 1) % 3), work, rel((i + 1) % 3), rel(i)] })), res: [0, 1, 2].map((j) => ({ name: 'R' + j, units: 1 })) },
      pos: ring(3, 145),
      story: 'Each process needs its own drive and its neighbour\'s.',
    },
    ring4: {
      label: 'Four processes round a ring of four locks',
      spec: { procs: [0, 1, 2, 3].map((i) => ({ name: 'P' + i, script: [req(i), work, req((i + 1) % 4), work, rel((i + 1) % 4), rel(i)] })), res: [0, 1, 2, 3].map((j) => ({ name: 'R' + j, units: 1 })) },
      pos: ring(4, 155),
      story: 'Each process takes the lock on its left, then the one on its right.',
    },
    spare: {
      label: 'Two units of R0: a cycle that need not deadlock',
      spec: { procs: [{ name: 'P0', script: [req(0), req(1), work, rel(1), rel(0)] }, { name: 'P1', script: [req(1), req(0), work, rel(0), rel(1)] }, { name: 'P2', script: [req(0), work, rel(0)] }], res: [{ name: 'R0', units: 2 }, { name: 'R1', units: 1 }] },
      pos: { p0: { x: -160, y: 10 }, r0: { x: 0, y: -105 }, p1: { x: 160, y: 10 }, r1: { x: 0, y: 125 }, p2: { x: 0, y: -225 } },
      story: 'P2 uses one of R0\'s two units for a short job and gives it back.',
    },
    pool: {
      label: 'Memory in a pool of four blocks, asked for in pieces',
      spec: { procs: [{ name: 'P0', script: [req(0, 2), work, req(0, 2), work, rel(0, 4)] }, { name: 'P1', script: [req(0, 1), work, req(0, 2), work, rel(0, 3)] }], res: [{ name: 'M', units: 4 }] },
      pos: { p0: { x: -150, y: 0 }, r0: { x: 0, y: 0 }, p1: { x: 150, y: 0 } },
      story: 'P0 needs four blocks in the end and P1 three; the pool has four.',
    },
  };
  H.scenOptions = (keys) => keys.map((k) => ({ value: k, label: H.SCEN[k].label }));
  H.specOf = (k, rules) => Object.assign({}, H.SCEN[k].spec, { rules: rules || {} });

  /** a step record with the simulator's state after it: each process's state, place and holdings, and Available */
  H.snapSim = (sim, st) => Object.assign(st, { procs: sim.p.map((x) => ({ state: x.state, pc: x.pc, held: x.held.slice(), restarts: x.restarts })), avail: sim.avail.slice() });
  H.startSim = (sim) => ({ kind: 'start', rag: sim.rag(), procs: sim.p.map((x) => ({ state: x.state, pc: x.pc, held: x.held.slice(), restarts: 0 })), avail: sim.avail.slice() });
  /** a schedule as text: the process names in order */
  H.schedName = (spec, sched) => sched.map((i) => spec.procs[i].name).join(' ');
  /** a seeded schedule that drives a run to the end (deadlock or done), from S.Dl.run's own choices */
  H.runSim = (spec, seed) => {
    const sim = S.Dl.sim(spec), r = S.MC.rng(seed || 1), steps = [], sched = [];
    while (sim.status() === 'running' && steps.length < 200) { const c = sim.choices(), pick = c[Math.floor(r() * c.length)]; sched.push(pick); steps.push(H.snapSim(sim, sim.step(pick))); }
    return { sim, steps, sched, status: sim.status() };
  };
  /** replay a schedule on a fresh simulator, keeping every step */
  H.replaySim = (spec, sched) => {
    const sim = S.Dl.sim(spec), steps = [];
    for (const c of sched) { if (!sim.choices().includes(c)) break; steps.push(H.snapSim(sim, sim.step(c))); }
    return { sim, steps, status: sim.status() };
  };
})(globalThis.Proses = globalThis.Proses || {});
