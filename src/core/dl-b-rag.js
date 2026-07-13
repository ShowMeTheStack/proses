// Resource-allocation graphs: processes and resource types (each with its units), assignment edges (a unit of R is
// held by P) and request edges (P waits for R). Cycle detection by depth-first search, with a trace; the wait-for
// graph when every resource has one unit; and the full answer for many units through the detection algorithm.
//   S.Rag.graph({procs: [name..], res: [{name, units}..], hold: [[p, r, n?]..], want: [[p, r, n?]..]}) -> g (a copy,
//     checked): n units (default 1); g.hold has one [p, r] entry a unit, g.want one [p, r, n] entry a process and type
//   S.Rag.edges(g) -> [{from, to, kind: 'request' | 'assign', n (units asked for)}]  nodes 'p0', 'p1', .., 'r0', ..
//   S.Rag.cycle(g) -> {cycle: [node..] | null, steps}   steps: {kind: 'visit' | 'back' | 'done' | 'leave', node, say}
//   S.Rag.waitFor(g) -> [{from: p, to: q, via: r}]
//   S.Rag.deadlock(g) -> {deadlocked: [p..], cycle, single, say}   by the matrix detection algorithm (dl-a-banker.js)
//     on the graph's Allocation and Request, so a request for several units counts every one of them
(function (S) {
  'use strict';
  const R = (S.Rag = S.Rag || {});

  R.graph = function (o) {
    const g = { procs: o.procs.slice(), res: o.res.map((r) => ({ name: r.name, units: r.units || 1 })), hold: [], want: [] };
    // a hold [p, r, n] is n units, one assignment entry each; requests by one process for one type add up
    for (const e of o.hold || []) for (let u = 0; u < (e[2] === undefined ? 1 : e[2]); u++) g.hold.push([e[0], e[1]]);
    for (const e of o.want || []) { const n = e[2] === undefined ? 1 : e[2], same = g.want.find((w) => w[0] === e[0] && w[1] === e[1]); if (same) same[2] += n; else if (n > 0) g.want.push([e[0], e[1], n]); }
    g.res.forEach((r, j) => { const held = g.hold.filter((e) => e[1] === j).length; if (held > r.units) throw new Error(r.name + ' has ' + r.units + ' units but ' + held + ' are held'); });
    return g;
  };
  R.name = (g, node) => (node[0] === 'p' ? g.procs[+node.slice(1)] : g.res[+node.slice(1)].name);
  R.edges = function (g) {
    const out = [], seen = new Set();
    for (const [p, r, n] of g.want) out.push({ from: 'p' + p, to: 'r' + r, kind: 'request', n });
    for (const [p, r] of g.hold) { const k = r + '>' + p; if (!seen.has(k)) { seen.add(k); out.push({ from: 'r' + r, to: 'p' + p, kind: 'assign' }); } }
    return out;
  };

  /** depth-first search, nodes in order p0.., r0..; a back edge to a node on the stack closes a cycle */
  R.cycle = function (g) {
    const E = R.edges(g), nodes = [...g.procs.map((_, i) => 'p' + i), ...g.res.map((_, j) => 'r' + j)];
    const adj = new Map(nodes.map((v) => [v, E.filter((e) => e.from === v).map((e) => e.to)]));
    const colour = new Map(nodes.map((v) => [v, 0])), stack = [], steps = [];
    const nm = (v) => R.name(g, v);
    let cycle = null;
    function dfs(v) {
      colour.set(v, 1); stack.push(v);
      steps.push({ kind: 'visit', node: v, stack: stack.slice(), say: `Visit ${nm(v)}; the path is ${stack.map(nm).join(' → ')}.` });
      for (const w of adj.get(v)) {
        if (cycle) return;
        if (colour.get(w) === 1) {
          cycle = stack.slice(stack.indexOf(w));
          steps.push({ kind: 'back', node: w, from: v, cycle: cycle.slice(), say: `${nm(v)} → ${nm(w)} leads back to ${nm(w)}, which is on the path: a cycle ${cycle.concat([w]).map(nm).join(' → ')}.` });
          return;
        }
        if (colour.get(w) === 0) dfs(w);
      }
      if (cycle) return;
      colour.set(v, 2); stack.pop();
      steps.push({ kind: 'leave', node: v, stack: stack.slice(), say: `Every edge out of ${nm(v)} is explored with no cycle: leave it.` });
    }
    for (const v of nodes) { if (cycle) break; if (colour.get(v) === 0) dfs(v); }
    steps.push({ kind: 'done', cycle, say: cycle ? `The graph has a cycle through ${cycle.map(nm).join(', ')}.` : 'Every node is explored and no edge led back onto the path: the graph has no cycle.' });
    return { cycle, steps };
  };

  R.waitFor = function (g) {
    const out = [];
    for (const [p, r] of g.want) for (const [q, r2] of g.hold) if (r2 === r && q !== p && !out.some((e) => e.from === p && e.to === q && e.via === r)) out.push({ from: p, to: q, via: r });
    return out;
  };

  R.deadlock = function (g) {
    const single = g.res.every((r) => r.units === 1), cyc = R.cycle(g).cycle;
    const n = g.procs.length, m = g.res.length;
    const alloc = Array.from({ length: n }, () => Array(m).fill(0)), request = Array.from({ length: n }, () => Array(m).fill(0));
    for (const [p, r] of g.hold) alloc[p][r]++;
    for (const [p, r, n] of g.want) request[p][r] += n;
    const avail = g.res.map((r, j) => r.units - alloc.reduce((s, row) => s + row[j], 0));
    const det = S.Banker.detect({ avail, alloc, request, names: g.procs, res: g.res.map((r) => r.name) });
    const who = (ps) => ps.map((p) => g.procs[p]).join(', ') + (ps.length > 1 ? ' are' : ' is');
    const say = det.deadlocked.length
      ? (cyc ? `A cycle${single ? ', and every resource has one unit, so' : ', and the detection algorithm, counting every unit asked for, confirms it:'} ${who(det.deadlocked)} deadlocked.` : `${who(det.deadlocked)} stuck: what ${det.deadlocked.length > 1 ? 'they ask' : 'it asks'} for can never be met.`)
      : cyc ? 'A cycle, but enough units are free or can be freed for every request: no deadlock.' : 'No cycle, so no deadlock.';
    return { deadlocked: det.deadlocked, cycle: cyc, single, say };
  };
  (S.engines = S.engines || []).push({ name: 'Resource-allocation graphs' });
})(globalThis.Proses = globalThis.Proses || {});
