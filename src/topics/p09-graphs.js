// Part 9, resource-allocation graphs: the graph drawn live as processes run their scripts of requests and releases
// on the rules simulator (dl-d-sim.js), with the schedule that deadlocks found by the model checker (mc-a-search.js)
// or a seeded run; then cycle detection by depth-first search (S.Rag.cycle) on a snapshot, and the wait-for graph.
(function (S) {
  'use strict';
  const H = S.P09, KR = () => S.Kit.rag;
  const GX = 195, GY = 270, SX = 425;
  const stCls = (s) => ({ ready: 's-ready', blocked: 's-blocked', done: 's-done' }[s] || 's-ready');

  /** the words on a script cell */
  const opText = (sim, op) => op.op === 'work' ? 'work' : op.op === 'reqAll' ? 'req all' : (op.op === 'req' ? 'req ' : 'rel ') + (op.n > 1 ? op.n + ' ' : '') + sim.res[op.r].name;
  /** the scripts as rows of cells, each process's place marked */
  H.scripts = function (prefix, x, y, sim, procs, o) {
    o = o || {};
    const items = [H.title(prefix + ':t', x, y, o.title || 'scripts')];
    const ch = 32, rh = o.rh || 46;
    sim.progs.forEach((p, i) => {
      const yy = y + 22 + i * rh, st = procs[i];
      items.push(H.text(prefix + ':n' + i, x, yy + ch / 2 + 5, p.name, 'rowname' + (o.act === i ? ' act' : ''), 14));
      let cx = x + 36;
      p.script.forEach((op, k) => {
        const t = opText(sim, op), w = Math.max(54, Math.round(S.geom.textWidth(t, 13, { mono: true })) + 16);
        const cls = k < st.pc || st.state === 'done' ? 'done' : k === st.pc ? (st.state === 'blocked' ? 'wait' : 'next') : '';
        items.push({ key: prefix + ':o' + i + '_' + k, kind: 'cell', x: cx, y: yy, w, h: ch, rx: 5, text: t, size: 13, cls: 'op ' + cls });
        cx += w + 5;
      });
      if (st.state === 'done') items.push(H.text(prefix + ':d' + i, cx + 4, yy + ch / 2 + 5, 'done', 'good', 13));
    });
    return { items, h: 22 + sim.progs.length * rh };
  };
  /** the graph of a simulator state, with the cycle (if any) hot and the edges new since prev lit */
  H.ragItems = function (prefix, scen, rag, procs, o) {
    o = o || {};
    const g = S.Rag.graph(rag), cyc = o.cycle ? S.Rag.cycle(g).cycle : null, hot = new Set();
    if (cyc) cyc.forEach((v, k) => hot.add(v + '>' + cyc[(k + 1) % cyc.length]));
    const keys = (r) => new Set(S.Rag.edges(S.Rag.graph(r)).map((e) => e.from + '>' + e.to));
    const act = new Set();
    if (o.prev) { const before = keys(o.prev); for (const k of keys(rag)) if (!before.has(k)) act.add(k); }
    const wantN = {};
    if (o.wantN) Object.assign(wantN, o.wantN);
    const d = KR().draw({ prefix, g, pos: H.SCEN[scen] ? H.SCEN[scen].pos : o.pos, x: o.x === undefined ? GX : o.x, y: o.y === undefined ? GY : o.y, hot, act, wantN, procCls: (i) => (procs ? stCls(procs[i].state) : 's-ready') + (o.actP === i ? ' act' : '') });
    return { items: d.items, cycle: cyc, g };
  };
  /** how many units each waiting process asks for, from the simulator's state */
  const wantsOf = (sim) => { const w = {}; sim.p.forEach((x, i) => { if (x.want) x.want.v.forEach((k, r) => { if (k) w[i + '>' + r] = k; }); }); return w; };

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'dl-rag-live', family: 'p09-graphs', order: 10, title: 'The resource-allocation graph, live',
    blurb: 'A circle for each process, a box for each resource type with a dot for each unit. When a process asks for a unit and gets it, an assignment edge runs from the unit to the process; when it must wait, a request edge runs from the process to the box. Watch the graph change step by step as the processes run their scripts, and see the cycle close when they deadlock.',
    inputs: [
      { id: 'scen', kind: 'choice', label: 'Processes', def: 'pair', options: H.scenOptions(['pair', 'ring3', 'ring4', 'spare', 'pool']) },
      { id: 'how', kind: 'choice', label: 'Schedule', def: 'worst', options: [{ value: 'worst', label: 'the shortest one that deadlocks (model checker)' }, { value: 'seed', label: 'a seeded random one' }] },
      { id: 'seed', kind: 'number', label: 'Seed', def: 3, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Two processes, opposite orders: deadlock', values: { scen: 'pair', how: 'worst' } },
      { label: 'The same two, a lucky schedule', values: { scen: 'pair', how: 'seed', seed: 2 } },
      { label: 'A ring of three', values: { scen: 'ring3', how: 'worst' } },
      { label: 'A ring of four', values: { scen: 'ring4', how: 'worst' } },
      { label: 'A pool of memory blocks', values: { scen: 'pool', how: 'worst' } },
      { label: 'A spare unit, seed 5', values: { scen: 'spare', how: 'seed', seed: 5 } },
    ],
    counters: [{ id: 'steps', label: 'steps' }, { id: 'blocked', label: 'blocked' }],
    run(inp) {
      const sc = H.SCEN[inp.scen], spec = H.specOf(inp.scen);
      let sched;
      if (inp.how === 'worst') { const c = S.MC.check(() => S.Dl.sim(spec), {}); sched = c.violation ? c.violation.schedule : H.runSim(spec, inp.seed).sched; }
      else sched = H.runSim(spec, inp.seed).sched;
      const R = H.replaySim(spec, sched), sim0 = S.Dl.sim(spec), start = H.startSim(sim0);
      const F = new S.Frames(['steps', 'blocked']), n = spec.procs.length;
      const legend = KR().legend({ prefix: 'lg', x: SX, y: 0, hot: true });
      const scriptsH = 22 + n * 46;
      const legY = 70 + scriptsH + 30;
      legend.items.forEach((it) => { if (it.y1 !== undefined) { it.y1 += legY; it.y2 += legY; } else it.y += legY; });
      const head = H.title('tt', 0, 0, sc.label);
      const replay = S.Dl.sim(spec);
      const frame = (st, prev, say, meta, o) => {
        const g = H.ragItems('g', inp.scen, st.rag, st.procs, { prev, cycle: o && o.cycle, actP: st.tid, wantN: o && o.wantN });
        const sp = H.scripts('sc', SX, 40, replay, st.procs, { act: st.tid });
        return { items: [head, ...g.items, ...sp.items, ...legend.items], say, meta: Object.assign({ avail: st.avail, units: spec.res.map((r) => r.units), n, m: spec.res.length, prog: replay.progs.map((p) => p.script), wants: replay.p.map((x) => (x.want ? x.want.v : null)), held: st.procs.map((p) => p.held) }, meta), cycle: g.cycle };
      };
      F.add(frame(start, null, `${sc.story} ${H.plural(n, 'process', 'processes')} share ${H.list(spec.res.map((r) => (r.units > 1 ? r.units + ' units of ' : 'one ') + r.name))}. Nothing is held yet: no edges.`, { phase: 'start' }));
      let prev = start.rag, blocked = 0;
      R.steps.forEach((st, k) => {
        replay.step(sched[k]);
        blocked = st.procs.filter((x) => x.state === 'blocked').length;
        F.count('steps').set('blocked', blocked);
        const extra = st.kind === 'block' ? ' A request edge now runs from ' + st.name + ' to the box.' : st.kind === 'grant' ? ' An assignment edge now runs from the unit to ' + st.name + '.' : st.kind === 'release' ? ' Its assignment edge goes.' : '';
        F.add(Object.assign(frame(st, prev, H.plain(st.say) + extra, { phase: 'step', kind: st.kind, tid: st.tid, k }, { wantN: wantsOf(replay) }), { title: st.name + ' · ' + st.kind }));
        prev = st.rag;
      });
      const last = R.steps.length ? R.steps[R.steps.length - 1] : start;
      if (R.status === 'deadlock') {
        // detection on the simulator's own state (a request may be for several units)
        const det = S.Banker.detect({ avail: replay.avail, alloc: replay.p.map((x) => x.held), request: replay.p.map((x) => (x.want ? x.want.v : spec.res.map(() => 0))) });
        const names = det.deadlocked.map((i) => spec.procs[i].name), single = spec.res.every((r) => r.units === 1), gg = S.Rag.graph(last.rag);
        const cyc = S.Rag.cycle(gg).cycle;
        const say = single ? `Nobody can move: ${H.list(names)} each wait for a unit another of them holds. The pink edges form the cycle ${cyc.map((v) => S.Rag.name(gg, v)).join(' → ')} and back; with one unit per resource, a cycle is a deadlock.`
          : `Nobody can move: ${H.list(names)} each wait for more units than are free, and only the others could free them. The graph has a cycle, but with several units that alone proves nothing; the detection algorithm, run on the counts, confirms the deadlock.`;
        const f = frame(last, last.rag, say, { phase: 'end', deadlocked: det.deadlocked, status: 'deadlock' }, { cycle: true, wantN: wantsOf(replay) });
        f.items.push(H.text('vd', SX, legY + legend.h + 30, 'deadlock: ' + H.list(names) + ' wait for ever', 'verdict2 hot', 16));
        F.add(Object.assign(f, { title: 'deadlock', hold: 3000 }));
      } else {
        const f = frame(last, last.rag, `Every process ran its script to the end after ${H.plural(R.steps.length, 'step')}: this schedule never closed a cycle${inp.how === 'worst' ? '. With these scripts no schedule deadlocks' : ', though another schedule might'}.`, { phase: 'end', status: 'done', nsteps: R.steps.length });
        f.items.push(H.text('vd', SX, legY + legend.h + 30, 'no deadlock: every script finished', 'verdict2 good', 16));
        F.add(Object.assign(f, { title: 'done' }));
      }
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Reading the graph', text: ['P → R: a request edge, P waits for a unit of R', 'R → P: an assignment edge, P holds a unit of R', 'one unit per type: a cycle means deadlock', 'several units: a cycle is needed, not enough'].join('\n') }] } };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'Before you step: will this schedule end in a deadlock?', options: ['yes, a deadlock', 'no, every script finishes'], answer: (fr) => (fr[fr.length - 1].meta.status === 'deadlock' ? 'yes, a deadlock' : 'no, every script finishes'), explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.kind === 'block', once: true, pick: 'item', ask: 'The next step makes a process wait. Click the process that will block.', answer: (fr, i) => 'g:p' + fr[i + 1].meta.tid, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'An arrow from process P to resource box R means…', options: ['P is waiting for a unit of R', 'P holds a unit of R', 'R is free', 'P has finished with R'], answer: 0, why: 'A request edge points from the waiting process to the resource.' },
      { q: 'Every resource type has one unit and the graph has a cycle. Then…', options: ['the processes on the cycle are deadlocked', 'there may or may not be a deadlock', 'there is no deadlock', 'only one process is stuck'], answer: 0, why: 'With single units a cycle is both necessary and sufficient.' },
      { q: 'A resource type has two units and the graph has a cycle through it. Then…', options: ['there may or may not be a deadlock', 'there is certainly a deadlock', 'there is certainly no deadlock', 'the graph is drawn wrongly'], answer: 0, why: 'A holder off the cycle may finish and free a unit, breaking the wait.' },
      { q: 'When a process releases a unit, the graph loses…', options: ['an assignment edge', 'a request edge', 'a resource box', 'a process circle'], answer: 0, why: 'The unit is no longer held by it.' },
      { q: 'The same two scripts can deadlock under one schedule and finish under another. So deadlock depends on…', options: ['the order in which the steps interleave', 'only on the scripts', 'only on the number of units', 'the speed of the CPU alone'], answer: 0, why: 'The scripts make deadlock possible; the schedule decides whether it happens.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // snapshots for the cycle and wait-for topics: hand-placed graphs (single units unless named)
  const ringPos = (n, R, cx, cy) => { const pos = {}; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (2 * Math.PI * i) / n, b = a + Math.PI / n; pos['r' + i] = { x: Math.round(cx + R * Math.cos(a)), y: Math.round(cy + R * Math.sin(a)) }; pos['p' + i] = { x: Math.round(cx + R * Math.cos(b)), y: Math.round(cy + R * Math.sin(b)) }; } return pos; };
  const SNAP = {
    office: (() => {
      const pos = ringPos(3, 125, 0, 20);
      // a tail outward from R1 (lower right): P3 waits for R1, holds R3, which P4 waits for
      const a = Math.atan2(pos.r1.y - 20, pos.r1.x), at = (d) => ({ x: Math.round(pos.r1.x + d * Math.cos(a)), y: Math.round(pos.r1.y + d * Math.sin(a)) });
      pos.p3 = at(92); pos.r3 = at(184); pos.p4 = at(276);
      return { label: 'A cycle of three, and two more waiting on it', g: { procs: ['P0', 'P1', 'P2', 'P3', 'P4'], res: ['R0', 'R1', 'R2', 'R3'].map((name) => ({ name, units: 1 })), hold: [[0, 0], [1, 1], [2, 2], [3, 3]], want: [[0, 1], [1, 2], [2, 0], [3, 1], [4, 3]] }, pos };
    })(),
    chain: { label: 'A chain of waits with no cycle', g: { procs: ['P0', 'P1', 'P2'], res: ['R0', 'R1', 'R2'].map((name) => ({ name, units: 1 })), hold: [[0, 0], [1, 1], [2, 2]], want: [[0, 1], [1, 2]] }, pos: { p0: { x: -200, y: 40 }, r1: { x: -100, y: -50 }, p1: { x: 0, y: 40 }, r2: { x: 100, y: -50 }, p2: { x: 200, y: 40 }, r0: { x: -200, y: 160 } } },
    spare: { label: 'A cycle through a resource with a spare holder', g: { procs: ['P0', 'P1', 'P2'], res: [{ name: 'R0', units: 2 }, { name: 'R1', units: 1 }], hold: [[0, 0], [2, 0], [1, 1]], want: [[0, 1], [1, 0]] }, pos: { p0: { x: -150, y: 30 }, r0: { x: 0, y: -90 }, p1: { x: 150, y: 30 }, r1: { x: 0, y: 150 }, p2: { x: 0, y: -210 } } },
    ring4: { label: 'Four processes round a ring of four locks, all waiting', g: { procs: ['P0', 'P1', 'P2', 'P3'], res: ['R0', 'R1', 'R2', 'R3'].map((name) => ({ name, units: 1 })), hold: [[0, 0], [1, 1], [2, 2], [3, 3]], want: [[0, 1], [1, 2], [2, 3], [3, 0]] }, pos: ringPos(4, 150, 0, 30) },
    two: { label: 'Two units of R1, both held, and a cycle', g: { procs: ['P0', 'P1', 'P2'], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 2 }], hold: [[0, 0], [1, 1], [2, 1]], want: [[0, 1], [1, 0], [2, 0]] }, pos: { p0: { x: -160, y: 30 }, r0: { x: 0, y: -100 }, p1: { x: 0, y: 30 }, p2: { x: 160, y: 30 }, r1: { x: 0, y: 160 } } },
  };
  H.SNAP = SNAP;
  const snapOpts = (keys) => keys.map((k) => ({ value: k, label: SNAP[k].label }));
  const nodeName = (g, v) => S.Rag.name(g, v);

  S.topic({
    id: 'dl-rag-cycle', family: 'p09-graphs', order: 20, title: 'Finding a cycle by depth-first search',
    blurb: 'A deadlock shows in the graph as a cycle. A depth-first search finds one: walk from a node along its edges, keeping the path you are on; an edge back to a node still on the path closes a cycle; a node all of whose edges lead nowhere new is left for good. With one unit per resource a cycle is a deadlock; with several units the detection algorithm must still decide.',
    inputs: [{ id: 'snap', kind: 'choice', label: 'Graph', def: 'office', options: snapOpts(['office', 'chain', 'spare', 'ring4', 'two']) }],
    presets: [
      { label: 'A cycle of three with two waiting on it', values: { snap: 'office' } },
      { label: 'A chain with no cycle', values: { snap: 'chain' } },
      { label: 'A cycle, but a spare holder', values: { snap: 'spare' } },
      { label: 'A ring of four', values: { snap: 'ring4' } },
      { label: 'Two units of R1', values: { snap: 'two' } },
    ],
    counters: [{ id: 'visited', label: 'nodes visited' }],
    run(inp) {
      const sn = SNAP[inp.snap], g = S.Rag.graph(sn.g), C = S.Rag.cycle(g), F = new S.Frames(['visited']);
      const gb = KR().draw({ prefix: 'g', g, pos: sn.pos }).box, PX = Math.round(gb.x + gb.w + 50), TY = Math.round(gb.y);
      const head = H.title('tt', gb.x, TY - 40, sn.label);
      const done = new Set(), seen = new Set();
      const draw = (path, cur, hot, extra) => {
        const d = KR().draw({ prefix: 'g', g, pos: sn.pos, hot, procCls: (i) => ('p' + i === cur ? 's-running act' : path.includes('p' + i) ? 's-running' : done.has('p' + i) ? 's-done' : 's-ready'), resCls: (j) => ('r' + j === cur ? 'act' : path.includes('r' + j) ? 'act' : '') });
        const items = [head, ...d.items, H.title('pt', PX, TY + 4, 'the path (the search\'s stack)')];
        path.forEach((v, k) => { items.push({ key: 'pa:' + v, kind: 'cell', x: PX + (k % 5) * 52, y: TY + 18 + Math.floor(k / 5) * 40, w: 46, h: 32, rx: 6, text: nodeName(g, v), size: 14, cls: 'tag ' + (hot.size && hot.has(v + '>' + path[(k + 1) % path.length]) ? 'hot' : v === cur ? 'act' : '') }); });
        items.push(H.title('dn', PX, TY + 116, 'finished: no cycle through them'));
        [...done].forEach((v, k) => items.push({ key: 'dn:' + v, kind: 'cell', x: PX + (k % 5) * 52, y: TY + 130 + Math.floor(k / 5) * 40, w: 46, h: 32, rx: 6, text: nodeName(g, v), size: 14, cls: 'tag done' }));
        const lg = KR().legend({ prefix: 'lg', x: PX, y: TY + 230, hot: true });
        return items.concat(lg.items, extra || []);
      };
      const nodes = g.procs.length + g.res.length;
      F.add({ items: draw([], null, new Set()), say: `${H.plural(g.procs.length, 'process', 'processes')}, ${H.plural(g.res.length, 'resource type')} and ${H.plural(S.Rag.edges(g).length, 'edge')}. The search starts at P0 and follows edges in order, keeping the path it is on.`, meta: { phase: 'start', nodes, n: g.procs.length, m: g.res.length, edges: S.Rag.edges(g).length } });
      for (const st of C.steps) {
        if (st.kind === 'visit') { seen.add(st.node); F.count('visited'); F.add({ items: draw(st.stack, st.node, new Set()), say: st.say, meta: { phase: 'visit', node: st.node, depth: st.stack.length }, title: 'visit ' + nodeName(g, st.node) }); }
        else if (st.kind === 'leave') { done.add(st.node); F.add({ items: draw(st.stack, null, new Set()), say: st.say, meta: { phase: 'leave', node: st.node }, title: 'leave ' + nodeName(g, st.node) }); }
        else if (st.kind === 'back') {
          const hot = new Set(); st.cycle.forEach((v, k) => hot.add(v + '>' + st.cycle[(k + 1) % st.cycle.length]));
          F.add({ items: draw(st.cycle, st.node, hot), say: st.say, meta: { phase: 'back', cycle: st.cycle, len: st.cycle.length }, title: 'back edge' });
        }
      }
      const dl = S.Rag.deadlock(g), hot = new Set();
      if (C.cycle) C.cycle.forEach((v, k) => hot.add(v + '>' + C.cycle[(k + 1) % C.cycle.length]));
      const multi = g.res.some((r) => r.units > 1);
      const idle = C.cycle && dl.deadlocked.length ? g.procs.filter((_, i) => !dl.deadlocked.includes(i) && g.want.some(([p]) => p === i) && !g.hold.some(([p]) => p === i)) : [];
      const verdict = !C.cycle ? 'no cycle: no deadlock' : dl.deadlocked.length ? 'deadlocked: ' + H.list(dl.deadlocked.map((i) => g.procs[i])) : 'a cycle, yet no deadlock';
      const why = !C.cycle ? 'With no cycle, every chain of waits ends at a process that is not waiting; it will finish and free what it holds.' : dl.deadlocked.length ? (multi ? 'Here several units exist, so the cycle alone did not prove it; the detection algorithm confirms that nobody on it can be satisfied.' : '') + (dl.deadlocked.length > C.cycle.length / 2 ? ' ' + H.list(dl.deadlocked.filter((i) => !C.cycle.includes('p' + i)).map((i) => g.procs[i])) + ' ' + (dl.deadlocked.length - C.cycle.length / 2 > 1 ? 'are' : 'is') + ' stuck too, waiting on the cycle while holding a unit.' : '') + (idle.length ? ' ' + H.list(idle) + ' ' + (idle.length > 1 ? 'wait' : 'waits') + ' as well but ' + (idle.length > 1 ? 'hold' : 'holds') + ' nothing, so the algorithm does not count ' + (idle.length > 1 ? 'them' : 'it') + ' as deadlocked; ' + (idle.length > 1 ? 'they' : 'it') + ' will wait for ever all the same.' : '') : 'A unit on the cycle is held by a process off it that can finish and give it back, so the wait will end.';
      F.add({ items: draw(C.cycle || [], null, hot, [H.text('vd', PX, TY + 330, verdict, 'verdict2 ' + (dl.deadlocked.length ? 'hot' : 'good'), 16)]), say: (H.plain(dl.say) + ' ' + why).replace(/ +/g, ' ').trim(), meta: { phase: 'verdict', deadlocked: dl.deadlocked, cycle: C.cycle, multi }, title: 'verdict', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Depth-first search for a cycle', text: ['visit v: put v on the path', '  for each edge v → w:', '    w on the path: a cycle, stop', '    w new: visit w', 'leave v: take it off the path, finished', 'cost: O(nodes + edges)'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'back', once: true, pick: 'option', ask: 'The search is about to follow one more edge. Will it close a cycle?', options: ['yes, it leads back onto the path', 'no, it leads somewhere new'], answer: 'yes, it leads back onto the path', explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Before you step: is anyone deadlocked in this graph?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.deadlocked.length ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'During the search, an edge leads to a node that is on the current path. This means…', options: ['the graph has a cycle', 'the node is finished', 'the graph has no cycle', 'the search must restart'], answer: 0, why: 'The path from that node to here plus this edge is a cycle.' },
      { q: 'An edge leads to a node already finished (left). The search…', options: ['ignores it: no cycle runs through a finished node', 'reports a cycle', 'visits it again', 'stops'], answer: 0, why: 'Every edge out of a finished node was explored without finding the path again.' },
      { q: 'How long does the search take on a graph of n nodes and e edges?', options: ['O(n + e)', 'O(n²·e)', 'O(2ⁿ)', 'O(e²)'], answer: 0, why: 'Each node is visited once and each edge followed once.' },
      { q: 'A process waits for a resource held by a deadlocked process, but is not on the cycle. Is it deadlocked?', options: ['yes: it can never get the unit', 'no: only the cycle is', 'only if it holds something', 'it depends on the schedule'], answer: 0, why: 'Its wait ends only when a deadlocked process releases, which never happens.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'dl-wait-for', family: 'p09-graphs', order: 30, title: 'The wait-for graph',
    blurb: 'When every resource has one unit, the resource boxes can be dropped: a process waiting for R, which Q holds, simply waits for Q. Each request edge P → R and assignment edge R → Q collapse into one edge P → Q. The wait-for graph is smaller, and a cycle in it is a deadlock. A system that keeps it can look for cycles from time to time.',
    inputs: [{ id: 'snap', kind: 'choice', label: 'Graph', def: 'office', options: snapOpts(['office', 'chain', 'ring4']) }],
    presets: [
      { label: 'A cycle of three with two waiting on it', values: { snap: 'office' } },
      { label: 'A chain with no cycle', values: { snap: 'chain' } },
      { label: 'A ring of four', values: { snap: 'ring4' } },
    ],
    counters: [{ id: 'edges', label: 'wait-for edges' }],
    run(inp) {
      const sn = SNAP[inp.snap], g = S.Rag.graph(sn.g), W = S.Rag.waitFor(g), F = new S.Frames(['edges']);
      const OX = 0, scale = 0.6;
      const wpos = {}; g.procs.forEach((_, i) => { const p = sn.pos['p' + i]; wpos['p' + i] = { x: Math.round(p.x * scale), y: Math.round(p.y * scale) }; });
      const gb = KR().draw({ prefix: 'g', g, pos: sn.pos }).box, wxs = Object.values(wpos).map((p) => p.x);
      const WX = Math.round(gb.x + gb.w + 90 - Math.min(...wxs) + 25), TY = Math.round(gb.y - 34);
      const head = [H.title('tt', gb.x, TY, 'resource-allocation graph'), H.title('tw', WX + Math.min(...wxs) - 25, TY, 'wait-for graph')];
      const dl = S.Rag.deadlock(g), cyc = S.Rag.cycle(g).cycle;
      const draw = (upto, lit, hotAll) => {
        const act = new Set(), hot = new Set();
        if (lit) { act.add('p' + lit.from + '>r' + lit.via); act.add('r' + lit.via + '>p' + lit.to); }
        if (hotAll && cyc) cyc.forEach((v, k) => hot.add(v + '>' + cyc[(k + 1) % cyc.length]));
        const d = KR().draw({ prefix: 'g', g, pos: sn.pos, x: OX, act, hot, procCls: (i) => (lit && (lit.from === i || lit.to === i) ? 's-blocked act' : 's-ready') });
        const wh = new Set();
        if (hotAll && cyc) { const ps = cyc.filter((v) => v[0] === 'p').map((v) => +v.slice(1)); ps.forEach((p, k) => wh.add(p + '>' + ps[(k + 1) % ps.length])); }
        const w = KR().waitFor({ prefix: 'w', procs: g.procs, edges: W.slice(0, upto), pos: wpos, x: WX, y: 0, hot: wh, via: true, res: g.res.map((r) => r.name), procCls: (i) => (lit && (lit.from === i || lit.to === i) ? 's-blocked act' : 's-ready') });
        return [...head, ...d.items, ...w.items];
      };
      F.add({ items: draw(0, null, false), say: `Every resource here has one unit, so each request edge can be followed through the box to the one process that holds it. ${H.plural(W.length, 'wait', 'waits')} to collapse.`, meta: { phase: 'start', n: W.length } });
      W.forEach((e, k) => {
        F.count('edges');
        F.add({ items: draw(k + 1, e, false), say: `${g.procs[e.from]} → ${g.res[e.via].name} and ${g.res[e.via].name} → ${g.procs[e.to]} become one edge ${g.procs[e.from]} → ${g.procs[e.to]}: ${g.procs[e.from]} waits for ${g.procs[e.to]} to release ${g.res[e.via].name}.`, meta: { phase: 'edge', from: e.from, to: e.to, k }, title: g.procs[e.from] + ' → ' + g.procs[e.to] });
      });
      const ps = cyc ? cyc.filter((v) => v[0] === 'p').map((v) => g.procs[+v.slice(1)]) : [];
      F.add({ items: draw(W.length, null, true), say: cyc ? `The wait-for graph has the cycle ${ps.concat([ps[0]]).join(' → ')}: a deadlock. ${H.plain(dl.say)}` : 'The wait-for graph has no cycle: every chain of waits ends at a process that is running, so nobody is deadlocked.', meta: { phase: 'end', deadlocked: dl.deadlocked, cyc: ps }, title: 'cycle?', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Collapsing the graph', text: ['P → R and R → Q  ⇒  P → Q', 'only when every R has one unit', 'cycle in the wait-for graph ⇔ deadlock', 'checking it: O(n²) for n processes'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'start' && fr[i + 1] && fr[i + 1].meta.phase === 'edge', pick: 'item', ask: 'The first wait to collapse starts at the request edge of P0. Click the process P0 will be drawn waiting for.', answer: (fr, i) => 'w:p' + fr[i + 1].meta.to, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'The wait-for graph is exact only when…', options: ['every resource type has one unit', 'there are at most two processes', 'no process holds two resources', 'resources can be preempted'], answer: 0, why: 'With several units a request does not point at one particular holder.' },
      { q: 'An edge P → Q in the wait-for graph means…', options: ['P waits for a resource Q holds', 'Q waits for P', 'P and Q share a resource', 'P created Q'], answer: 0, why: 'It is the request P → R and the assignment R → Q together.' },
      { q: 'Which is smaller for the same system?', options: ['the wait-for graph', 'the resource-allocation graph', 'they are always the same size', 'neither: it depends on the cycle'], answer: 0, why: 'It drops the resource nodes and joins their edges.' },
      { q: 'A cycle P0 → P1 → P0 in the wait-for graph means…', options: ['P0 and P1 are deadlocked', 'P0 will finish first', 'nothing: more units may come', 'P1 holds nothing'], answer: 0, why: 'Each waits for the other with single units: neither can ever go on.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
