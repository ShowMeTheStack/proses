// The Deadlock lab, part four: the four conditions. The processes' scripts (the same table as the graph mode, each
// process's lines in order) run on the rules simulator (S.Dl.sim) with each condition switched on or off; the model
// checker (S.MC.check over the simulator) says whether any schedule can deadlock; one run, seeded at random or the
// checker's own deadlocking schedule, is drawn step by step as a live allocation graph; then a lock-order checker
// (S.Lockdep.check) goes over the run's acquisitions and draws the lock-order graph, whose cycle warns of a deadlock
// even after a run that did not deadlock.
//   DL.runCond(v, ctx) -> a lab result     DL.condSpec(v) -> the simulator's spec
(function (S) {
  'use strict';
  const DL = S.DlLab, KR = () => S.Kit.rag;
  const T = (...a) => DL.text(...a);

  DL.rulesOf = (v) => ({ mutex: v.cMutex !== false, holdWait: v.cHold !== false, preempt: v.cPreempt === false, order: v.cCirc === false });
  DL.condSpec = (v, rules) => {
    const res = DL.readRes(v), lines = DL.readScript(v);
    return { procs: Array.from({ length: v.nproc }, (_, i) => ({ name: 'P' + i, script: lines.filter((l) => l.who === i).map((l) => (l.op === 'work' ? { op: 'work' } : { op: l.op, r: l.r, n: l.n })) })), res, rules: rules || DL.rulesOf(v) };
  };
  const broken = (v) => S.Dl.CONDITIONS.filter((c) => ({ mutex: v.cMutex, holdWait: v.cHold, preempt: v.cPreempt, order: v.cCirc })[c.id] === false);

  /** run the simulator along a schedule (or seeded at random), keeping each step, its state, and the lock events */
  DL.condRun = function (spec, o) {
    const sim = S.Dl.sim(spec), steps = [], events = [], rng = S.MC.rng(o.seed || 1), sched = o.sched || null;
    // in the lock checker's view a process holds a type while it holds units of it or waits for them
    const lk = sim.p.map(() => new Set());
    let k = 0;
    while (sim.status() === 'running' && steps.length < 120) {
      const c = sim.choices();
      const i = sched ? (k < sched.length && c.includes(sched[k]) ? sched[k] : c[0]) : c[Math.floor(rng() * c.length)];
      k++;
      const op = sim.progs[i].script[sim.p[i].pc], name = sim.nm(i);
      if (op.op === 'req' || op.op === 'reqAll') { const v = sim.needOf(op); v.forEach((x, r) => { if (x && !lk[i].has(r)) { lk[i].add(r); events.push({ thread: name, op: 'acquire', lock: spec.res[r].name, at: steps.length }); } }); }
      const st = sim.step(i);
      // a type neither held nor waited for any more is released (a release, a restart, or a shareable resource)
      sim.p.forEach((x, q) => { for (const r of [...lk[q]]) if (!x.held[r] && !(x.want && x.want.v[r])) { lk[q].delete(r); events.push({ thread: sim.nm(q), op: 'release', lock: spec.res[r].name, at: steps.length }); } });
      steps.push(Object.assign(st, { procs: sim.p.map((x) => ({ state: x.state, pc: x.pc, held: x.held.slice(), restarts: x.restarts })), avail: sim.avail.slice(), wantN: (() => { const w = {}; sim.p.forEach((x, q) => { if (x.want) x.want.v.forEach((h, r) => { if (h) w[q + '>' + r] = h; }); }); return w; })() }));
    }
    return { sim, steps, events, status: sim.status() };
  };

  const checklist = (x, y, v, seen) => {
    const items = [DL.title('ck:t', x, y, 'the four conditions')];
    const on = { mutex: v.cMutex !== false, holdWait: v.cHold !== false, preempt: v.cPreempt !== false, order: v.cCirc !== false };
    S.Dl.CONDITIONS.forEach((c, i) => {
      const yy = y + 14 + i * 30, isB = !on[c.id];
      items.push({ key: 'ck:b' + i, kind: 'cell', x, y: yy, w: 74, h: 24, rx: 5, text: isB ? 'off' : seen ? 'present' : 'on', size: 13, cls: 'tag ' + (isB ? 'good' : seen ? 'hot' : '') });
      items.push(T('ck:n' + i, x + 86, yy + 17, c.name, isB ? 'good' : 'strong', 14));
    });
    return { items, h: 14 + 4 * 30 };
  };

  DL.runCond = function (v, ctx) {
    const narrow = ctx.narrow, spec = DL.condSpec(v), base = DL.condSpec(v, {}), n = spec.procs.length, res = spec.res;
    const off = broken(v);
    const mc = S.MC.check(() => S.Dl.sim(spec), {}, { maxStates: 60000 });
    const mc0 = off.length ? S.MC.check(() => S.Dl.sim(base), {}, { maxStates: 60000 }) : mc;
    const worst = v.cSched === 'worst' && mc.violation;
    const R = DL.condRun(spec, worst ? { sched: mc.violation.schedule } : { seed: ctx.seed });
    const L = S.Lockdep.check(R.events);
    // one layout for all: every edge of the run, and the lock-order edges between resources
    const all = [], wf = [];
    for (const st of R.steps) { for (const [p, r] of st.rag.hold) all.push(['r' + r, 'p' + p]); for (const [p, r] of st.rag.want) all.push(['p' + p, 'r' + r]); }
    const rIx = (name) => res.findIndex((r) => r.name === name);
    for (const e of L.edges) all.push(['r' + rIx(e.from), 'r' + rIx(e.to)]);
    const Lay = DL.layout(n, res, all, wf, { narrow });
    const sim0 = S.Dl.sim(spec), procs0 = sim0.p.map((x) => ({ state: x.state, pc: 0, held: x.held.slice(), restarts: 0 }));
    const gx = Math.round(Lay.w / 2), gy = 40 + Math.round(Lay.h / 2);
    const lg = narrow ? { items: [], h: -22 } : KR().legend({ prefix: 'lg', x: 0, y: gy + Lay.h / 2 + 22, hot: true });
    const RX = narrow ? 0 : Lay.w + 56, RY = narrow ? gy + Lay.h / 2 + 22 + lg.h + 26 : 46;
    const scH = 14 + n * 40, ckY = RY + scH + 26, vdY = narrow ? ckY : ckY + 14 + 4 * 30 + 30;
    const title = off.length ? 'with ' + DL.list(off.map((c) => c.name)) + ' switched off' : 'all four conditions in place';
    const head = [DL.title('tt', 0, 14, 'the resource-allocation graph, ' + title)];
    const mcLine = mc.violation ? 'deadlock possible: the checker found one in ' + mc.stats.states + ' states' : (mc.stats.complete ? 'no schedule can deadlock (' + mc.stats.states + ' states)' : 'none found in ' + mc.stats.states + ' states (search cut short)');
    const pic = (rag, procs, o) => {
      o = o || {};
      const g = S.Rag.graph(rag), cyc = o.cycle ? S.Rag.cycle(g).cycle : null;
      const items = head.slice();
      items.push(...DL.ragItems('g', rag, Lay, gx, gy, { hot: DL.cycleSet(cyc), act: o.act, wantN: o.wantN, procCls: (i) => DL.stCls(procs[i].state), actP: o.actP }).items, ...lg.items);
      items.push(...DL.scriptRows('sc', RX, RY, sim0, procs, { act: o.actP, title: off.length ? 'scripts, as the rules make them run' : 'scripts' }).items);
      if (!narrow) items.push(...checklist(RX, ckY, v, o.seen).items);
      items.push(T('mc', RX, vdY, mcLine, 'verdict2 ' + (mc.violation ? 'hot' : 'good'), 15));
      if (o.verdict) items.push(T('vd', RX, vdY + 28, o.verdict, 'verdict2 ' + o.vcls, 15));
      return items;
    };
    const frames = [], trace = [];
    const holdT = (rag, procs, wantN) => DL.holdTable(rag, wantN, procs);
    const met = (extra) => [{ label: 'States searched', value: mc.stats.states }, { label: 'Deadlock possible', value: mc.violation ? 'yes' : 'no', cls: mc.violation ? 'bad' : 'good' }].concat(off.length ? [{ label: 'With all four on', value: mc0.violation ? 'possible' : 'impossible', cls: mc0.violation ? 'bad' : 'good' }] : []).concat(extra || []);
    const push = (title, items, say, kind, tables, metrics, hold) => { trace.push({ kind, say }); frames.push({ items, say, title, at: trace.length - 1, tables, metrics, hold }); };
    const startRag = sim0.rag();
    const intro = off.length ? `${DL.cap(DL.list(off.map((c) => c.name)))} ${off.length > 1 ? 'are' : 'is'} switched off: ${off.map((c) => c.say.split('. ').slice(1).join('. ')).join(' ')}` + (off.some((c) => c.id === 'holdWait') ? ' Each script\'s requests become one request for everything at its first.' : '') + (off.some((c) => c.id === 'order') ? ' Each script\'s requests are taken in resource order.' : '') : 'All four conditions are in place: units are exclusive, a process holds while it waits, nothing is taken back, and the requests may form a cycle.';
    push('start', pic(startRag, procs0), `${DL.plural(n, 'process', 'processes')} share ${DL.list(res.map((r) => (r.units > 1 ? r.units + ' units of ' : 'one unit of ') + r.name))}. ${intro}`, 'start', [holdT(startRag, procs0, {})], met());
    const mcSay = mc.violation ? `The model checker searched \`${mc.stats.states}\` states and found a schedule that deadlocks: ${mc.violation.schedule.map((i) => 'P' + i).join(' ')}.` : `The model checker searched ${mc.stats.complete ? 'all' : 'the first'} \`${mc.stats.states}\` reachable states: ${mc.stats.complete ? 'no schedule can deadlock' : 'no deadlock among them'}.` + (off.length && mc0.violation ? ` With all four conditions in place the same scripts can deadlock (\`${mc0.stats.states}\` states searched), so switching ${off.length > 1 ? 'these off' : 'this one off'} is what prevents it.` : '');
    push('the search', pic(startRag, procs0), mcSay + (worst ? ' Here is that schedule, step by step.' : ` Now one run, its schedule drawn at random from seed \`${ctx.seed}\`.`), 'search', [holdT(startRag, procs0, {})], met());
    let prev = startRag;
    R.steps.forEach((st, k) => {
      const before = new Set(S.Rag.edges(S.Rag.graph(prev)).map((x) => x.from + '>' + x.to));
      const act = new Set(S.Rag.edges(S.Rag.graph(st.rag)).map((x) => x.from + '>' + x.to).filter((x) => !before.has(x)));
      push(st.name + ' · ' + st.kind, pic(st.rag, st.procs, { act, actP: st.tid, wantN: st.wantN, cycle: true }), DL.plain(st.say), st.kind, [holdT(st.rag, st.procs, st.wantN)], met([{ label: 'Step', value: (k + 1) + ' of ' + R.steps.length }, { label: 'Blocked', value: st.procs.filter((p) => p.state === 'blocked').length }]));
      prev = st.rag;
    });
    const last = R.steps.length ? R.steps[R.steps.length - 1] : { rag: startRag, procs: procs0, wantN: {} };
    if (R.status === 'deadlock') {
      const names = last.procs.map((p, i) => (p.state === 'blocked' ? 'P' + i : null)).filter(Boolean);
      push('deadlock', pic(last.rag, last.procs, { cycle: true, wantN: last.wantN, seen: true, verdict: 'this run deadlocked: ' + DL.list(names), vcls: 'hot' }), `Deadlock: ${DL.list(names)} each wait for units only the others hold. All four conditions are present: each unit serves one process, ${DL.list(names)} hold units while waiting, nobody takes a unit back, and the waits form the pink cycle.`, 'deadlock', [holdT(last.rag, last.procs, last.wantN)], met([{ label: 'This run', value: 'deadlocked', cls: 'bad' }]));
    } else {
      const restarts = last.procs.reduce((a, p) => a + p.restarts, 0);
      push('done', pic(last.rag, last.procs, { verdict: 'this run finished in ' + DL.plural(R.steps.length, 'step'), vcls: 'good' }), `Every script finished in ${DL.plural(R.steps.length, 'step')}` + (restarts ? `, with ${DL.plural(restarts, 'restart')} under the preemption rule` : '') + (mc.violation ? ', a lucky schedule: another one deadlocks.' : '.'), 'done', [holdT(last.rag, last.procs, last.wantN)], met([{ label: 'This run', value: 'finished', cls: 'good' }]));
    }
    // the lock-order check over the run's acquisitions
    const lockItems = (k, hotC) => {
      const items = [DL.title('tt', 0, 14, 'lock-order graph, from this run')];
      const hot = new Set();
      for (const c of hotC || []) c.forEach((x, q) => hot.add(x + '>' + c[(q + 1) % c.length]));
      res.forEach((r, j) => { const p = Lay.pos['r' + j], w = KR().resW(1); items.push({ key: 'g:r' + j, kind: 'cell', x: Math.round(gx + p.x - w / 2), y: Math.round(gy + p.y - KR().BH / 2), w, h: KR().BH, rx: 6, text: r.name, size: 15, cls: 'lockbox' + ((hotC || []).some((c) => c.includes(r.name)) ? ' hot' : '') }); });
      L.edges.slice(0, k).forEach((e) => { const a = rIx(e.from), b = rIx(e.to), back = L.edges.slice(0, k).some((f) => f.from === e.to && f.to === e.from); items.push({ key: 'lo:' + a + '>' + b, kind: 'edge', from: 'g:r' + a, to: 'g:r' + b, bend: back ? 0.3 : 0, cls: 'ragwf' + (hot.has(e.from + '>' + e.to) ? ' hot' : '') }); });
      items.push(DL.title('lo:t', RX, RY, 'orders recorded (held → taken)'));
      L.edges.slice(0, k).slice(-8).forEach((e, q) => items.push(T('lo:l' + q, RX, RY + 22 + q * 22, e.from + ' → ' + e.to + '   (' + e.thread + ')', 'ledger', 14)));
      if (!k) items.push(T('lo:n', RX, RY + 22, 'none yet', 'qnone', 13));
      return items;
    };
    const lmet = (k, c) => [{ label: 'Lock events', value: R.events.length }, { label: 'Orders recorded', value: k }, { label: 'Cycles', value: c, cls: c ? 'bad' : 'good' }];
    const ltab = (k) => [{ title: 'Lock orders', cols: ['held', 'taken', 'by'], rows: L.edges.slice(0, k).map((e) => [e.from, e.to, e.thread]) }];
    push('lock orders', lockItems(0), `A lock-order checker now reads the run's ${DL.plural(R.events.length, 'acquisition and release', 'acquisitions and releases')}: each time a process asks for a resource while holding another, it records "held before taken".`, 'lockdep', ltab(0), lmet(0, 0));
    let k = 0, c = 0;
    for (const st of L.steps) {
      if (st.kind === 'edge') { k++; push(st.edge.from + ' → ' + st.edge.to, lockItems(k), DL.plain(st.say), 'edge', ltab(k), lmet(k, c)); }
      else { c++; push('cycle', lockItems(k, [st.cycle]), DL.plain(st.say), 'cycle', ltab(k), lmet(k, c)); }
    }
    const endItems = lockItems(k, L.cycles);
    endItems.push(T('lo:v', RX, RY + 22 + Math.min(8, k) * 22 + 24, L.cycles.length ? (R.status === 'deadlock' ? 'the cycle that deadlocked' : 'this run finished, yet a deadlock is possible') : 'no cycle: these orders cannot deadlock', 'verdict2 ' + (L.cycles.length ? 'hot' : 'good'), 15));
    push('lock-order verdict', endItems, DL.plain(L.say) + (L.cycles.length && R.status !== 'deadlock' ? ' The run itself did not deadlock: the checker sees the danger from the orders alone.' : '') + (!!mc.violation === !!L.cycles.length ? (mc.violation ? ' The model checker agrees: some schedule deadlocks.' : ' The model checker agrees: no schedule deadlocks.') : mc.violation ? ' Yet the model checker finds a schedule that deadlocks: with several units, waits can close a cycle that lock orders alone do not show.' : ` The model checker, though, finds no schedule that deadlocks: with ${DL.list(off.map((c) => c.name)) || 'a condition'} switched off, the opposite orders can no longer close into a deadlock.`), 'lockdep', ltab(k), lmet(k, L.cycles.length), 3000);
    const lastF = frames[frames.length - 1];
    return { frames, trace, tables: lastF.tables, metrics: met([{ label: 'This run', value: R.status === 'deadlock' ? 'deadlocked' : 'finished', cls: R.status === 'deadlock' ? 'bad' : 'good' }, { label: 'Lock-order cycles', value: L.cycles.length, cls: L.cycles.length ? 'bad' : 'good' }]), cond: { mc, mc0, R, L } };
  };
})(globalThis.Proses = globalThis.Proses || {});
