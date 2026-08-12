// The Deadlock lab, part two: the resource-allocation graph mode. Either a script of requests and releases runs on
// the rules simulator (S.Dl.sim, every condition in place) in the order typed, a blocked process's later steps
// waiting until it is woken; or a graph typed or drawn by clicking is taken as it stands. Each step draws the
// allocation graph and the wait-for graph (S.Rag.waitFor, single units only), with any cycle (S.Rag.cycle) hot; then
// the depth-first search for a cycle on the final graph is narrated node by node, and the verdict comes from the
// detection algorithm (S.Banker.detect) on the graph's counts.
//   DL.runRag(v, ctx) -> a lab result
(function (S) {
  'use strict';
  const DL = S.DlLab, KR = () => S.Kit.rag;
  const T = (...a) => DL.text(...a);
  DL.sel = null; // the node clicked first when drawing ('p1' or 'r0')

  /** the script, run in the order typed: a step per line (or a note that it waits), each with the state after it */
  DL.scriptRun = function (v) {
    const res = DL.readRes(v), n = v.nproc, lines = DL.readScript(v);
    const procs = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, script: lines.filter((l) => l.who === i).map((l) => (l.op === 'work' ? { op: 'work' } : { op: l.op, r: l.r, n: l.n })) }));
    const gidx = procs.map((_, i) => lines.filter((l) => l.who === i).map((l) => l.k));
    const spec = { procs, res };
    const sim = S.Dl.sim(spec), evs = [];
    const snap = () => sim.p.map((x) => ({ state: x.state, pc: x.pc, held: x.held.slice(), want: x.want ? x.want.v.slice() : null }));
    const wantN = () => { const w = {}; sim.p.forEach((x, i) => { if (x.want) x.want.v.forEach((k, r) => { if (k) w[i + '>' + r] = k; }); }); return w; };
    const record = (k, st, i, late) => evs.push({ k, kind: st.kind, tid: i, say: st.say, late, procs: snap(), rag: sim.rag(), wantN: wantN() });
    const catchUp = (k) => {
      for (let guard = 0; guard < 200; guard++) {
        let best = -1, bi = -1;
        sim.p.forEach((x, i) => { if (x.state === 'ready' && x.pc < gidx[i].length && gidx[i][x.pc] <= k && (best < 0 || gidx[i][x.pc] < best)) { best = gidx[i][x.pc]; bi = i; } });
        if (bi < 0) return;
        record(best, sim.step(bi), bi, true);
      }
    };
    lines.forEach((l) => {
      const i = l.who, x = sim.p[i];
      if (x.state === 'ready' && gidx[i][x.pc] === l.k) record(l.k, sim.step(i), i, false);
      else {
        const why = x.state === 'blocked' ? 'it is blocked, waiting for ' + sim.vecName(x.want.v) : 'it has not yet done its earlier steps';
        evs.push({ k: l.k, kind: 'defer', tid: i, say: `Line ${l.k + 1} is P${i}'s turn (${DL.opText(sim, sim.progs[i].script[gidx[i].indexOf(l.k)])}), but ${why}: the step waits until P${i} can go on.`, procs: snap(), rag: sim.rag(), wantN: wantN() });
      }
      catchUp(l.k);
    });
    return { sim, spec, evs, lines, status: sim.status(), start: { procs: sim.p.map(() => ({ state: 'ready', pc: 0, held: res.map(() => 0) })), rag: S.Dl.sim(spec).rag() } };
  };

  /** the verdict on a graph with its request counts: the cycle, who is deadlocked (detection), and why */
  DL.verdict = function (g, wantN, procs, sim) {
    const gg = S.Rag.graph(g), C = S.Rag.cycle(gg), M = DL.ragMatrices(gg, wantN);
    const det = S.Banker.detect({ avail: M.avail, alloc: M.alloc, request: M.request, names: g.procs, res: g.res.map((r) => r.name) });
    const single = g.res.every((r) => r.units === 1), nm = (v) => S.Rag.name(gg, v), dead = det.deadlocked.map((i) => g.procs[i]);
    const cyc = C.cycle ? C.cycle.concat([C.cycle[0]]).map(nm).join(' → ') : '';
    let say, text, cls;
    if (dead.length) {
      say = (C.cycle ? `The cycle ${cyc} ` + (single ? 'is a deadlock: every resource on it has one unit.' : 'alone proves nothing with several units, but the detection algorithm on the counts confirms it.') : 'There is no cycle of single units, yet the detection algorithm finds nobody among them able to finish.') + ` ${DL.list(dead)} ${dead.length > 1 ? 'are' : 'is'} deadlocked: each waits for units only the others could free.`;
      text = 'deadlock: ' + DL.list(dead); cls = 'hot';
    } else if (C.cycle) {
      say = `The graph has the cycle ${cyc}, but it is no deadlock: a unit on it is spare, or held by a process that can finish and give it back. Detection finds that every process can finish.`;
      text = 'a cycle, but no deadlock'; cls = 'good';
    } else {
      say = 'The graph has no cycle, so nobody is deadlocked: every chain of waits ends at a process that is not waiting.';
      text = 'no cycle: no deadlock'; cls = 'good';
    }
    // a process blocked for ever although detection clears it: a finished holder that never released
    if (procs && sim) {
      const stuck = procs.map((p, i) => (p.state === 'blocked' && !det.deadlocked.includes(i) ? i : -1)).filter((i) => i >= 0);
      const keepers = procs.map((p, i) => (p.state === 'done' && p.held.some((x) => x) ? i : -1)).filter((i) => i >= 0);
      if (stuck.length && keepers.length) { say += ` Yet ${DL.list(stuck.map((i) => 'P' + i))} will wait for ever: ${DL.list(keepers.map((i) => 'P' + i))} finished ${keepers.length > 1 ? 'their scripts' : 'its script'} still holding ${keepers.length > 1 ? 'units' : sim.vecName(procs[keepers[0]].held)}, which nobody will release.`; text = 'stuck: a finished process kept its units'; cls = 'hot'; }
    }
    return { C, det, say, text, cls, cyc };
  };

  /** the DFS frames on a final graph: the path as chips, the visited and finished nodes coloured */
  function dfsFrames(push, g, C, draw) {
    const gg = S.Rag.graph(g), nm = (v) => S.Rag.name(gg, v), done = new Set();
    C.steps.forEach((st) => {
      if (st.kind === 'visit') push(draw({ path: st.stack, cur: st.node, done: new Set(done) }), st.say, 'visit ' + nm(st.node), 'dfs');
      else if (st.kind === 'leave') { done.add(st.node); push(draw({ path: st.stack, done: new Set(done) }), st.say, 'leave ' + nm(st.node), 'dfs'); }
      else if (st.kind === 'back') push(draw({ path: st.cycle, cur: st.node, done: new Set(done), hot: DL.cycleSet(st.cycle) }), st.say, 'back edge', 'dfs');
    });
  }
  /** the search's path as chips, then the nodes it has finished with (or, at the end, the cycle it found): {items, h} */
  const pathItems = (x, y, g, o, w) => {
    const gg = S.Rag.graph(g), nm = (v) => S.Rag.name(gg, v), per = Math.max(3, Math.floor(w / 62));
    const chips = (pre, list, yy, cls) => list.map((v, k) => ({ key: pre + v, kind: 'cell', x: x + (k % per) * 62, y: yy + Math.floor(k / per) * 38, w: 56, h: 30, rx: 6, text: nm(v), size: 14, cls: 'tag ' + cls(v, k) }));
    const rowsH = (k) => Math.max(1, Math.ceil(k / per)) * 38;
    const path = o.path || [], items = [DL.title('pa:t', x, y, o.final ? (path.length ? 'the cycle found' : 'the search found no cycle') : 'the search\'s path (its stack)')];
    if (o.final && !path.length) return { items, h: 20 };
    items.push(...chips('pa:', path, y + 12, (v, k) => (o.hot && o.hot.has(v + '>' + path[(k + 1) % path.length]) ? 'hot' : v === o.cur ? 'act' : '')));
    if (!path.length) items.push(T('pa:e', x, y + 32, 'empty', 'qnone', 13));
    const dy = y + 12 + rowsH(path.length) + 18;
    if (o.final) return { items, h: dy - y - 18 };
    items.push(DL.title('dn:t', x, dy, 'finished: no cycle through them'));
    const done = [...(o.done || [])];
    items.push(...chips('dn:', done, dy + 12, () => 'done'));
    if (!done.length) items.push(T('dn:e', x, dy + 32, 'none yet', 'qnone', 13));
    return { items, h: dy + 12 + rowsH(done.length) - y };
  };

  DL.runRag = function (v, ctx) {
    const narrow = ctx.narrow, res = DL.readRes(v), n = v.nproc, P = Array.from({ length: n }, (_, i) => 'P' + i);
    const fromScript = v.ragFrom !== 'graph';
    let R = null, finalG, finalWantN = {}, finalProcs = null;
    const steps = [];
    if (fromScript) {
      R = DL.scriptRun(v);
      finalG = R.evs.length ? R.evs[R.evs.length - 1].rag : R.start.rag;
      finalWantN = R.evs.length ? R.evs[R.evs.length - 1].wantN : {};
      finalProcs = R.evs.length ? R.evs[R.evs.length - 1].procs : R.start.procs;
    } else {
      const e = DL.parseEdges(v.edges, n, res);
      if (e.error) return { frames: [], error: { msg: 'the graph: ' + e.error } };
      finalG = { procs: P, res, hold: e.hold, want: e.want };
    }
    // one layout for every frame: every edge any frame draws
    const all = [], wf = [];
    const gs = fromScript ? [R.start.rag].concat(R.evs.map((e) => e.rag)) : [finalG];
    for (const g of gs) { for (const [p, r] of g.hold) all.push(['r' + r, 'p' + p]); for (const [p, r] of g.want) all.push(['p' + p, 'r' + r]); if (res.every((r) => r.units === 1)) for (const e of S.Rag.waitFor(g)) wf.push([e.from, e.to]); }
    // a drawn graph keeps its nodes where they are while edges come and go: one layout per set of nodes, and new
    // nodes placed among the old ones
    let L;
    if (fromScript) L = DL.layout(n, res, all, wf, { narrow });
    else {
      const key = JSON.stringify([n, res, !!narrow]), mem = (DL.drawn = DL.drawn || { orders: {}, last: {} });
      const last = mem.last[!!narrow];
      L = DL.layout(n, res, all, wf, mem.orders[key] ? { narrow, order: mem.orders[key] } : last ? { narrow, base: last.order.filter((id) => (id[0] === 'p' ? +id.slice(1) < n : last.res[+id.slice(1)] && res.findIndex((r) => r.name === last.res[+id.slice(1)].name) === +id.slice(1))) } : { narrow });
      mem.orders[key] = L.order; mem.last[!!narrow] = { order: L.order, res };
    }
    // the graph the cycle search runs on: the last one with a cycle, else the final one (or the busiest one)
    let snapAt = -1;
    if (fromScript) {
      if (R.status === 'deadlock') snapAt = R.evs.length - 1;
      else R.evs.forEach((e, k) => { if (S.Rag.cycle(S.Rag.graph(e.rag)).cycle) snapAt = k; });
      if (snapAt < 0 && R.evs.length) {
        const ne = (g) => g.hold.length + g.want.length;
        snapAt = ne(finalG) ? R.evs.length - 1 : R.evs.reduce((b, e, k) => (ne(e.rag) > ne(R.evs[b].rag) ? k : b), 0);
      }
    }
    const snapLast = !fromScript || snapAt === R.evs.length - 1 || snapAt < 0;
    const sG = fromScript && snapAt >= 0 ? R.evs[snapAt].rag : finalG, sW = fromScript && snapAt >= 0 ? R.evs[snapAt].wantN : finalWantN, sP = fromScript && snapAt >= 0 ? R.evs[snapAt].procs : finalProcs;
    const V = DL.verdict(sG, sW, snapLast ? sP : null, R && R.sim);
    const PRr = KR().PR, multi = res.some((r) => r.units > 1);
    // places: the allocation graph on the left, the wait-for graph and the scripts on the right (stacked on a phone)
    const gx = Math.round(L.w / 2), gy = 40 + Math.round(L.h / 2);
    const lg = narrow ? { items: [], h: -22 } : KR().legend({ prefix: 'lg', x: 0, y: gy + L.h / 2 + 22, hot: true });
    const sw = fromScript ? DL.scriptW(R.sim) : 0;
    const RX = narrow ? 0 : L.w + 56, colW = narrow ? Math.max(L.w, 380) : Math.max(L.ww + 20, sw, 330);
    const wfH = multi ? 120 : L.wh + 26;
    const wy0 = narrow ? gy + L.h / 2 + 22 + lg.h + 30 : 40;
    const wcx = RX + L.wrx + PRr, wcy = wy0 + 20 + L.wry + PRr;
    const sy = narrow ? (multi ? wy0 : wy0) : wy0 + wfH + 14;
    const scriptH = fromScript ? 14 + n * 40 : 0;
    const py = (narrow ? sy : sy) + scriptH + (fromScript ? 24 : 0);
    const title = fromScript ? 'the resource-allocation graph, as the script runs' : 'the resource-allocation graph you drew';
    const head = [DL.title('tt', 0, 14, title)];
    if (!fromScript) head.push(T('hint', 0, 34, DL.sel ? 'now click a ' + (DL.sel[0] === 'p' ? 'resource: a request edge' : 'process: an assignment edge') : 'click a process, then a resource (a request), or a resource, then a process', 'p7note', 13));
    const procCls = (procs) => (i) => (procs ? DL.stCls(procs[i].state) : finalG.want.some(([p]) => p === i) ? 's-blocked' : 's-ready');
    const draw = (g, o) => {
      o = o || {};
      const items = head.slice();
      const d = DL.ragItems('g', g, L, gx, gy, { hot: o.hot, act: o.act, wantN: o.wantN, procCls: o.procCls, actP: o.actP, pick: !fromScript, sel: !fromScript ? DL.sel : null, resCls: o.resCls });
      items.push(...d.items, ...lg.items);
      if (!narrow) items.push(...DL.wfItems('w', g, L, wcx, wcy, { cycle: o.cycle, procCls: o.procCls }).items);
      if (fromScript) items.push(...DL.scriptRows('sc', RX, sy, R.sim, o.procs || R.start.procs, { act: o.actP }).items);
      let ph = 0;
      if (o.dfs) { const pi = pathItems(RX, py, g, o.dfs, colW); items.push(...pi.items); ph = pi.h + 14; }
      if (o.verdict) items.push(T('vd', narrow ? 0 : RX, py + ph + 16, o.verdict.text, 'verdict2 ' + o.verdict.cls, 16));
      return items;
    };
    const frames = [], trace = [];
    const metricsOf = (g, procs, wantN, extra) => {
      const gg = S.Rag.graph(g), c = S.Rag.cycle(gg).cycle;
      return [{ label: 'Steps run', value: extra.steps === undefined ? '–' : extra.steps }, { label: 'Waiting', value: procs ? procs.filter((p) => p.state === 'blocked').length : g.procs.filter((_, i) => g.want.some(([p]) => p === i)).length }, { label: 'Edges', value: S.Rag.edges(gg).length }, { label: 'Cycle', value: c ? c.map((x) => S.Rag.name(gg, x)).join(' → ') : 'none', cls: c ? 'bad' : 'good' }].concat(extra.verdict ? [{ label: 'Verdict', value: extra.verdict.text, cls: extra.verdict.cls === 'hot' ? 'bad' : 'good' }] : []);
    };
    const add = (items, say, title, kind, g, procs, wantN, extra) => {
      trace.push({ kind, say });
      const tables = [DL.holdTable(g, wantN, procs)];
      if (fromScript) tables.push({ title: 'The script', cols: ['#', 'process', 'step', 'done'], rows: R.lines.map((l) => [String(l.k + 1), 'P' + l.who, l.op === 'work' ? 'work' : l.op + ' ' + (l.n > 1 ? l.n + ' ' : '') + res[l.r].name, (extra && extra.doneLines && extra.doneLines.has(l.k)) ? { text: 'yes', cls: 'good' } : '–']), hl: extra && extra.line !== undefined ? extra.line : -1 });
      frames.push({ items, say, title, at: trace.length - 1, tables, metrics: metricsOf(g, procs, wantN, extra || {}), hold: extra && extra.hold });
    };
    if (fromScript) {
      const doneLines = new Set();
      const s0 = R.start;
      add(draw(s0.rag, { procs: s0.procs, procCls: procCls(s0.procs) }), `${DL.plural(n, 'process', 'processes')} share ${DL.list(res.map((r) => (r.units > 1 ? r.units + ' units of ' : 'one unit of ') + r.name))}. The script has ${DL.plural(R.lines.length, 'line')}, run in the order typed; a blocked process's later lines wait for it. Nothing is held yet: no edges.`, 'start', 'start', s0.rag, s0.procs, {}, { steps: 0, doneLines });
      let prev = s0.rag, hadCycle = false, nsteps = 0;
      R.evs.forEach((e) => {
        if (e.kind !== 'defer') { doneLines.add(e.k); nsteps++; }
        const before = new Set(S.Rag.edges(S.Rag.graph(prev)).map((x) => x.from + '>' + x.to));
        const act = new Set(S.Rag.edges(S.Rag.graph(e.rag)).map((x) => x.from + '>' + x.to).filter((k) => !before.has(k)));
        const cyc = S.Rag.cycle(S.Rag.graph(e.rag)).cycle, hot = DL.cycleSet(cyc);
        let say = (e.late ? `P${e.tid} is awake again, so its waiting line ${e.k + 1} runs: ` : e.kind === 'defer' ? '' : `Line ${e.k + 1}: `) + DL.plain(e.say);
        if (e.kind === 'block') say += ` A request edge runs from P${e.tid} to the box.`;
        if (e.kind === 'grant' && e.rag.hold.length > prev.hold.length) say += ` An assignment edge runs from the unit to P${e.tid}.`;
        if (cyc && !hadCycle) say += ` The edges now close a cycle, ${cyc.concat([cyc[0]]).map((x) => S.Rag.name(S.Rag.graph(e.rag), x)).join(' → ')}` + (multi ? ', though with several units a cycle alone is not a deadlock.' : ': with one unit each, that is a deadlock.');
        hadCycle = !!cyc;
        add(draw(e.rag, { procs: e.procs, procCls: procCls(e.procs), act, hot, cycle: cyc, wantN: e.wantN, actP: e.tid }), say, (e.kind === 'defer' ? 'line ' + (e.k + 1) + ' waits' : 'P' + e.tid + ' · ' + e.kind), e.kind, e.rag, e.procs, e.wantN, { steps: nsteps, doneLines: new Set(doneLines), line: e.k });
        prev = e.rag;
      });
      const left = R.lines.length - doneLines.size;
      const fc = S.Rag.cycle(S.Rag.graph(finalG)).cycle;
      add(draw(finalG, { procs: finalProcs, procCls: procCls(finalProcs), wantN: finalWantN, hot: DL.cycleSet(fc), cycle: fc }), (R.status === 'deadlock' ? `The script is over and ${DL.plural(left, 'line')} never ran: ${DL.list(finalProcs.map((p, i) => (p.state === 'blocked' ? 'P' + i : null)).filter(Boolean))} ${finalProcs.filter((p) => p.state === 'blocked').length > 1 ? 'are' : 'is'} still blocked.` : 'Every line of the script has run, and every process has finished.') + (snapLast ? ' Now a depth-first search looks for a cycle in the final graph.' : ` Now a depth-first search looks for a cycle in the graph as it stood after line ${R.evs[snapAt].k + 1}` + (S.Rag.cycle(S.Rag.graph(sG)).cycle ? ', when it last had one.' : ', when it had the most edges.')), 'the end of the script', 'end', finalG, finalProcs, finalWantN, { steps: nsteps, doneLines });
    } else {
      add(draw(finalG, { procCls: procCls(null) }), `${DL.plural(n, 'process', 'processes')}, ${DL.plural(res.length, 'resource type')} and ${DL.plural(S.Rag.edges(S.Rag.graph(finalG)).length, 'edge')}, as drawn: ${finalG.hold.length ? DL.plural(finalG.hold.length, 'unit') + ' held' : 'nothing held'} and ${DL.plural(finalG.want.length, 'request')} waiting. A depth-first search will look for a cycle.`, 'the graph', 'start', finalG, null, {}, {});
    }
    // the cycle search on the final graph, then the verdict
    const fp = sP, fcls = procCls(fp);
    const pushD = (o, say, title, kind) => {
      const hotP = (i) => ((o.path || []).includes('p' + i) ? (o.cur === 'p' + i ? 's-running act' : 's-running') : o.done.has('p' + i) ? 's-done' : 's-ready');
      const items = draw(sG, { procs: fp, procCls: hotP, resCls: (j) => ((o.path || []).includes('r' + j) ? 'act' : ''), hot: o.hot, wantN: sW, dfs: o });
      add(items, DL.plain(say), title, kind, sG, fp, sW, {});
    };
    dfsFrames(pushD, sG, V.C, (o) => o);
    const last = V.C.steps[V.C.steps.length - 1];
    add(draw(sG, { procs: fp, procCls: (i) => (V.det.deadlocked.includes(i) ? 's-blocked' : fcls(i)), wantN: sW, hot: DL.cycleSet(V.C.cycle), cycle: V.C.cycle, verdict: V, dfs: { final: true, path: V.C.cycle || [], hot: DL.cycleSet(V.C.cycle) } }), DL.plain(last.say) + ' ' + V.say + (snapLast ? '' : R.status === 'deadlock' ? ' The run itself went on to end in a deadlock, as the end of the script showed.' : ' In the run itself the waits did end: by the end of the script every process had finished.'), 'verdict', 'verdict', sG, fp, sW, { verdict: V, hold: 3000 });
    const lastF = frames[frames.length - 1];
    return { frames, trace, tables: lastF.tables, metrics: lastF.metrics, rag: { L, V, R, sG, sW } };
  };
})(globalThis.Proses = globalThis.Proses || {});
