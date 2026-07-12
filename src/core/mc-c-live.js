// Liveness, bounded: can a thread wait forever? Over the graph of every reachable state (S.MC.graph, no reduction,
// so nothing is missed), a property "thread t eventually makes progress" fails when there is a reachable cycle in
// which t is still trying and never makes progress, and the cycle is fair, or when t can reach a state where it is
// trying and nothing at all can move.
// Fairness (stated in every answer): weak fairness, the usual assumption that the scheduler does not ignore a
// thread for ever: a thread that is able to run in every state of the cycle must take a step somewhere in it.
// A thread that is blocked part of the time may be passed over: that is how starvation happens with locks.
//   S.MC.live(make, props, opts) -> {results: [{name, holds, kind: 'starve' | 'stuck' | null, lasso: {prefix,
//     cycle} | null, say}], states, complete, fairness: 'weak'}
//     props: [{name, thread, progress(step) -> bool, trying(sys) -> bool}]
//       progress: by default a step of that thread whose op is marked 'progress'; trying: by default the thread
//       has not finished. thread is the owner a system reports (a thread id for S.Sync machines).
//     opts: as S.MC.graph ({maxDepth, maxStates}); complete is false when a bound cut the graph, and then a
//       property that holds holds only within the bound
//     lasso: the schedule to the cycle (prefix) and round it (cycle), both lists of choices: replayable
(function (S) {
  'use strict';
  const MC = (S.MC = S.MC || {});

  /** strongly connected components of the nodes in keep, over the edges in use (Tarjan, iterative) */
  function sccs(n, keep, out) {
    let idx = 0;
    const index = new Array(n).fill(-1), low = new Array(n).fill(0), on = new Array(n).fill(false), st = [], comps = [];
    for (let v0 = 0; v0 < n; v0++) {
      if (!keep[v0] || index[v0] >= 0) continue;
      const work = [[v0, 0]];
      index[v0] = low[v0] = idx++; st.push(v0); on[v0] = true;
      while (work.length) {
        const top = work[work.length - 1], v = top[0], es = out[v];
        if (top[1] < es.length) {
          const w = es[top[1]++].to;
          if (!keep[w]) continue;
          if (index[w] < 0) { index[w] = low[w] = idx++; st.push(w); on[w] = true; work.push([w, 0]); } else if (on[w]) low[v] = Math.min(low[v], index[w]);
        } else {
          work.pop();
          if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
          if (low[v] === index[v]) { const c = []; let w; do { w = st.pop(); on[w] = false; c.push(w); } while (w !== v); comps.push(c); }
        }
      }
    }
    return comps;
  }
  /** a shortest path of choices from a to any node in targets, over the allowed edges */
  function bfs(G, from, isTarget, allow) {
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const v = q.shift();
      if (isTarget(v) && (v !== from || prev.get(v) !== null)) { const p = []; let u = v; while (prev.get(u)) { const e = prev.get(u); p.unshift(e); u = e.from; } return { to: v, edges: p }; }
      for (const e of G.nodes[v].out) if ((!allow || allow(e)) && !prev.has(e.to)) { prev.set(e.to, e); q.push(e.to); }
    }
    return null;
  }

  MC.live = function (make, props, opts) {
    const G = MC.graph(make, opts), n = G.nodes.length, results = [];
    const own = (sys, c) => (sys.runner ? sys.runner(c) : sys.owner ? sys.owner(c) : c);
    for (const p of props) {
      const t = p.thread;
      const progress = p.progress || ((st) => st.tid === t && st.mark === 'progress');
      const trying = p.trying || ((sys) => sys.threads ? sys.threads[t].state !== 'done' : true);
      const keep = G.nodes.map((nd) => trying(nd.sys));
      const out = G.nodes.map((nd) => nd.out.filter((e) => !progress(e.step) && keep[e.to]));
      let found = null;
      // a state where t still tries and nothing can move at all
      for (const nd of G.nodes) if (keep[nd.id] && nd.sys.status() !== 'running') { found = { kind: 'stuck', node: nd.id }; break; }
      if (!found) {
        for (const comp of sccs(n, keep, out)) {
          const inC = new Set(comp), edges = [];
          for (const v of comp) for (const e of out[v]) if (inC.has(e.to)) edges.push(e);
          if (!edges.length) continue;
          // weak fairness: every thread able to run in all the component's states moves somewhere in it
          const owners = new Set(edges.map((e) => e.owner));
          const always = new Set(G.nodes[comp[0]].sys.choices().map((c) => own(G.nodes[comp[0]].sys, c)).filter((w) => w !== null));
          for (const v of comp) { const here = new Set(G.nodes[v].sys.choices().map((c) => own(G.nodes[v].sys, c))); for (const w of [...always]) if (!here.has(w)) always.delete(w); }
          if ([...always].every((w) => owners.has(w))) { found = { kind: 'starve', comp, edges, owners: [...owners] }; break; }
        }
      }
      if (!found) { results.push({ name: p.name, holds: true, kind: null, lasso: null, say: `${p.name}: holds${G.complete ? '' : ' within the bounds searched'}, assuming weak fairness.` }); continue; }
      if (found.kind === 'stuck') {
        const path = bfs(G, 0, (v) => v === found.node);
        results.push({ name: p.name, holds: false, kind: 'stuck', lasso: { prefix: path ? path.edges.map((e) => e.choice) : [], cycle: [] }, say: `${p.name}: fails. A schedule of ${path ? path.edges.length : 0} steps leaves it waiting where nothing else can move.` });
        continue;
      }
      // the lasso: reach the component, then walk a closed tour through it that takes a step of every owner in it
      const inC = new Set(found.comp), entry = bfs(G, 0, (v) => inC.has(v));
      const start = entry ? entry.to : found.comp[0], allow = (e) => inC.has(e.from) && inC.has(e.to) && !progress(e.step);
      const cycle = [];
      let at = start;
      for (const w of found.owners) {
        const e0 = found.edges.find((e) => e.owner === w);
        const leg = bfs(G, at, (v) => v === e0.from, allow);
        if (leg && at !== e0.from) cycle.push(...leg.edges);
        cycle.push(e0); at = e0.to;
      }
      if (at !== start) { const back = bfs(G, at, (v) => v === start, allow); if (back) cycle.push(...back.edges); }
      results.push({ name: p.name, holds: false, kind: 'starve', lasso: { prefix: entry ? entry.edges.map((e) => e.choice) : [], cycle: cycle.map((e) => e.choice) }, say: `${p.name}: fails. After ${entry ? entry.edges.length : 0} steps the others can go round a cycle of ${cycle.length} steps for ever while it never gets there, and the schedule is fair (weak fairness: no thread that could run throughout is ignored).` });
    }
    return { results, states: n, complete: G.complete, fairness: 'weak' };
  };
})(globalThis.Proses = globalThis.Proses || {});
