// Part 9, the four necessary conditions and prevention. The rules simulator (dl-d-sim.js) runs the same scripts with
// one condition broken; the model checker (S.MC.check) searches every schedule to say whether a deadlock can still
// happen; a run is drawn step by step on the resource-allocation graph. Then the price of each prevention rule,
// measured on seeded runs.
(function (S) {
  'use strict';
  const H = S.P09, KR = () => S.Kit.rag;
  const GX = 195, GY = 285, SX = 425;
  const RULES = [{ value: 'none', label: 'none: all four conditions hold' }].concat(S.Dl.CONDITIONS.map((c) => ({ value: c.id, label: 'break ' + c.name })));
  const ruleOf = (id) => (id === 'none' ? {} : S.Dl.CONDITIONS.find((c) => c.id === id).rule);
  const condName = (id) => S.Dl.CONDITIONS.find((c) => c.id === id).name;

  /** follow a schedule while its choices are enabled, then round robin (the next process able to run), to the end */
  H.replayLoose = (spec, sched) => {
    const sim = S.Dl.sim(spec), steps = [], used = [];
    let k = 0, lastPick = -1;
    while (sim.status() === 'running' && steps.length < 200) {
      const c = sim.choices(), rr = c.find((x) => x > lastPick), pick = k < sched.length && c.includes(sched[k]) ? sched[k] : rr === undefined ? c[0] : rr;
      k++; lastPick = pick; used.push(pick); steps.push(H.snapSim(sim, sim.step(pick)));
    }
    return { sim, steps, sched: used, status: sim.status() };
  };

  /** the four conditions as a checklist: each holding, broken, or (at a deadlock) seen */
  const checklist = (x, y, broken, seen) => {
    const items = [H.title('ck:t', x, y, 'the four conditions')];
    S.Dl.CONDITIONS.forEach((c, i) => {
      const yy = y + 24 + i * 30, isB = broken === c.id;
      items.push({ key: 'ck:b' + i, kind: 'cell', x, y: yy, w: 70, h: 24, rx: 5, text: isB ? 'broken' : seen ? 'present' : 'holds', size: 13, cls: 'tag ' + (isB ? 'good' : seen ? 'hot' : '') });
      items.push(H.text('ck:n' + i, x + 82, yy + 17, c.name, isB ? 'good' : 'strong', 14));
    });
    return items;
  };

  S.topic({
    id: 'dl-conditions', family: 'p09-conditions', order: 10, title: 'The four conditions, each switched off in turn',
    blurb: 'A deadlock needs four things at once: mutual exclusion (a unit serves one process at a time), hold and wait (a process keeps what it has while it waits for more), no preemption (only the holder gives a unit back) and circular wait (a cycle of processes, each waiting for the next). Switch any one of them off and no schedule can deadlock. The model checker searches every schedule to prove it, and a run shows what the rule changes.',
    inputs: [
      { id: 'scen', kind: 'choice', label: 'Processes', def: 'pair', options: H.scenOptions(['pair', 'ring3', 'ring4', 'pool']) },
      { id: 'rule', kind: 'choice', label: 'Condition broken', def: 'none', options: RULES },
    ],
    presets: [
      { label: 'All four hold: a deadlock', values: { scen: 'pair', rule: 'none' } },
      { label: 'Shareable resources (no mutual exclusion)', values: { scen: 'pair', rule: 'mutex' } },
      { label: 'Ask for everything at once', values: { scen: 'ring3', rule: 'holdWait' } },
      { label: 'A waiting process gives back', values: { scen: 'pair', rule: 'preempt' } },
      { label: 'One global order', values: { scen: 'ring4', rule: 'order' } },
      { label: 'The memory pool, one order', values: { scen: 'pool', rule: 'order' } },
    ],
    counters: [{ id: 'steps', label: 'steps' }, { id: 'states', label: 'states searched' }],
    run(inp) {
      const sc = H.SCEN[inp.scen], base = H.specOf(inp.scen), spec = H.specOf(inp.scen, ruleOf(inp.rule));
      const mc0 = H.once('mc:' + inp.scen + ':none', () => S.MC.check(() => S.Dl.sim(base), {}));
      const mc = inp.rule === 'none' ? mc0 : S.MC.check(() => S.Dl.sim(spec), {});
      const bad = mc0.violation ? mc0.violation.schedule : [];
      const R = inp.rule === 'none' && mc.violation ? Object.assign(H.replaySim(spec, mc.violation.schedule), { sched: mc.violation.schedule }) : H.replayLoose(spec, bad);
      const F = new S.Frames(['steps', 'states']), replay = S.Dl.sim(spec), start = H.startSim(replay);
      const n = base.procs.length, cond = inp.rule === 'none' ? null : S.Dl.CONDITIONS.find((c) => c.id === inp.rule);
      const head = H.title('tt', 0, 0, sc.label);
      const ckY = 70 + 22 + n * 46 + 24;
      const frame = (st, prev, say, meta, o) => {
        o = o || {};
        const g = H.ragItems('g', inp.scen, st.rag, st.procs, { prev, cycle: o.cycle, actP: st.tid });
        const sp = H.scripts('sc', SX, 40, replay, st.procs, { act: st.tid, title: inp.rule === 'none' ? 'scripts' : 'scripts, as the rule runs them' });
        const items = [head, ...g.items, ...sp.items, ...checklist(SX, ckY, inp.rule === 'none' ? null : inp.rule, o.seen)];
        if (o.verdict) items.push(H.text('vd', SX, ckY + 24 + 4 * 30 + 26, o.verdict, 'verdict2 ' + o.vcls, 16));
        return { items, say, meta: Object.assign({ avail: st.avail, states: mc.stats.states, units: base.res.map((r) => r.units), prog: replay.progs.map((p) => p.script), held: st.procs.map((p) => p.held) }, meta) };
      };
      const intro = cond ? `${H.cap(cond.name)} is broken: ${cond.say}` + (inp.rule === 'holdWait' ? ' Each script\'s requests become one request for everything.' : inp.rule === 'order' ? ' Each script\'s requests are sorted by resource number.' : '') : `${sc.story} All four conditions hold: units are exclusive, a process holds while it waits, nothing is taken back, and the requests can form a cycle.`;
      F.add(frame(start, null, intro, { phase: 'start' }));
      F.set('states', mc.stats.states);
      const verdictSay = mc.violation ? `The model checker searched ${mc.stats.states} states and found a schedule that deadlocks: ${H.schedName(spec, mc.violation.schedule)}. Here it is, step by step.` : `The model checker searched all ${mc.stats.states} reachable states: no schedule deadlocks. Below, the schedule that deadlocked with all four conditions in place is tried again under the rule.`;
      F.add(frame(start, null, verdictSay, { phase: 'search', found: !!mc.violation, sched: mc.violation ? mc.violation.schedule : bad }));
      let prev = start.rag;
      R.steps.forEach((st, k) => {
        replay.step(R.sched[k]);
        F.count('steps');
        F.add(Object.assign(frame(st, prev, H.plain(st.say), { phase: 'step', kind: st.kind, tid: st.tid, k }), { title: st.name + ' · ' + st.kind }));
        prev = st.rag;
      });
      const last = R.steps.length ? R.steps[R.steps.length - 1] : start;
      if (R.status === 'deadlock') {
        const dl = S.Rag.deadlock(S.Rag.graph(last.rag)), names = dl.deadlocked.map((i) => base.procs[i].name);
        F.add(Object.assign(frame(last, last.rag, `Deadlock, and all four conditions are present: each unit is held by one process (mutual exclusion); ${H.list(names)} each hold a unit while waiting (hold and wait); nobody can take a unit away (no preemption); and the waits form the pink cycle (circular wait).`, { phase: 'end', status: 'deadlock', deadlocked: dl.deadlocked }, { cycle: true, seen: true, verdict: 'deadlock: all four conditions present', vcls: 'hot' }), { title: 'deadlock', hold: 3000 }));
      } else {
        const restarts = last.procs.reduce((a, p) => a + p.restarts, 0);
        const how = { mutex: 'nobody ever waited, since the resources are shared', holdWait: 'a process that waited held nothing while it waited', preempt: 'a process that could not get a unit gave back what it held and started again' + (restarts ? ' (' + H.plural(restarts, 'restart') + ' in this run)' : ''), order: 'every process asked in the same order, so no cycle of waits could form' }[inp.rule] || 'this schedule never closed a cycle';
        F.add(Object.assign(frame(last, last.rag, `Every script finished in ${H.plural(R.steps.length, 'step')}: ${how}.` + (inp.rule === 'none' ? '' : ` And over all ${mc.stats.states} states no deadlock exists.`), { phase: 'end', status: 'done', restarts, nsteps: R.steps.length }, { verdict: inp.rule === 'none' ? 'no deadlock in this run' : 'no deadlock in any schedule', vcls: 'good' }), { title: 'done' }));
      }
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Deadlock needs all four', text: S.Dl.CONDITIONS.map((c) => c.name + ': ' + c.say.split('. ')[0] + '.').concat(['', 'remove any one: no deadlock is possible']).join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Before the search: can any schedule of these scripts deadlock?', options: ['yes, some schedule deadlocks', 'no, none can'], answer: (fr) => (fr[1].meta.found ? 'yes, some schedule deadlocks' : 'no, none can'), explain: (fr) => fr[1].say },
    ],
    quiz: [
      { q: 'Spooling a printer (jobs go to a disk queue, one daemon prints) breaks which condition?', options: ['mutual exclusion', 'hold and wait', 'no preemption', 'circular wait'], answer: 0, why: 'Processes no longer hold the printer itself; they share the spool.' },
      { q: 'Requiring a process to ask for all its resources at once breaks…', options: ['hold and wait', 'circular wait', 'mutual exclusion', 'no preemption'], answer: 0, why: 'A process never holds some while waiting for more.' },
      { q: 'Numbering the resources and always asking in increasing order breaks…', options: ['circular wait', 'hold and wait', 'mutual exclusion', 'no preemption'], answer: 0, why: 'A cycle would need someone to ask for a lower number while holding a higher one.' },
      { q: 'Which resource is hard to make preemptible?', options: ['a lock in the middle of an update', 'the CPU', 'a page frame', 'a register set'], answer: 0, why: 'Taking it away leaves the protected data half changed; the CPU and memory can be saved and restored.' },
      { q: 'Why is breaking one condition enough?', options: ['a deadlock needs all four at once', 'each condition alone causes deadlock', 'the scheduler then runs in order', 'resources become infinite'], answer: 0, why: 'They are necessary conditions: without any one of them no deadlock state exists.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // the price of prevention: every rule on the same scripts, measured
  const SEEDS = 24;
  H.ruleStats = (scen, id) => H.once('rs:' + scen + ':' + id, () => {
    const spec = H.specOf(scen, ruleOf(id)), mc = S.MC.check(() => S.Dl.sim(spec), {});
    // units held before they are needed: what the original script has asked for by its next piece of work, against
    // what the process holds now (the rule may make it ask early)
    const orig = H.SCEN[scen].spec.procs.map((p) => p.script), progs = S.Dl.sim(spec).progs.map((p) => p.script);
    const needAt = orig.map((sc) => { const out = []; let have = 0; for (const op of sc) { if (op.op === 'req') have += op.n || 1; if (op.op === 'work') out.push(have); } return out; });
    const idleOf = (st) => st.procs.reduce((a, p, i) => { const held = p.held.reduce((b, x) => b + x, 0), w = progs[i].slice(0, p.pc).filter((op) => op.op === 'work').length, need = w < needAt[i].length ? needAt[i][w] : Infinity; return a + (p.state === 'done' ? 0 : Math.max(0, held - need)); }, 0);
    let dead = 0, steps = 0, fin = 0, waits = 0, restarts = 0, idle = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const r = H.runSim(spec, s);
      if (r.status === 'deadlock') { dead++; continue; }
      fin++; steps += r.steps.length;
      waits += r.steps.filter((st) => st.kind === 'block').length;
      restarts += r.steps.filter((st) => st.kind === 'restart').length;
      idle += r.steps.reduce((a, st) => a + idleOf(st), 0);
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return { id, possible: !!mc.violation, states: mc.stats.states, dead, fin, steps: fin ? r1(steps / fin) : 0, waits: fin ? r1(waits / fin) : 0, restarts: fin ? r1(restarts / fin) : 0, idle: fin ? r1(idle / fin) : 0 };
  });
  const COST = { none: 'nothing: but deadlock is possible', mutex: 'only works for resources that can be shared or spooled', holdWait: 'units sit idle from the first request; one must know every need in advance', preempt: 'work is thrown away and redone; only for state that can be saved', order: 'programmers must keep one order everywhere; requests may come earlier than needed' };

  S.topic({
    id: 'dl-prevention', family: 'p09-conditions', order: 20, title: 'Prevention and its price',
    blurb: 'Prevention designs deadlock out by making one condition impossible. Each way has a cost: resources held idle when everything is asked for at once, work thrown away when units are taken back, a discipline every programmer must keep when resources are ordered. The same scripts run under each rule, many times with different seeds, and the costs are counted: how long units sit held before the script needs them, and how often work is redone.',
    inputs: [{ id: 'scen', kind: 'choice', label: 'Processes', def: 'ring3', options: H.scenOptions(['pair', 'ring3', 'ring4', 'pool']) }],
    presets: [
      { label: 'A ring of three', values: { scen: 'ring3' } },
      { label: 'Two processes, opposite orders', values: { scen: 'pair' } },
      { label: 'A ring of four', values: { scen: 'ring4' } },
      { label: 'A memory pool', values: { scen: 'pool' } },
    ],
    counters: [{ id: 'rules', label: 'rules measured' }],
    run(inp) {
      const ids = ['none', 'mutex', 'holdWait', 'preempt', 'order'], rows = ids.map((id) => H.ruleStats(inp.scen, id));
      const F = new S.Frames(['rules']);
      const cols = [{ w: 206, label: 'rule' }, { w: 96, label: 'deadlock?' }, { w: 100, label: 'stuck runs' }, { w: 70, label: 'steps' }, { w: 100, label: 'held early' }, { w: 90, label: 'restarts' }];
      const name = (id) => (id === 'none' ? 'no rule' : 'break ' + condName(id));
      const head = H.title('tt', 0, 0, H.SCEN[inp.scen].label + ': ' + SEEDS + ' seeded runs per rule');
      const table = (upto, act) => S.Kit.gantt.table({ prefix: 'tb', x: 0, y: 24, cols, rowH: 36, size: 14, rows: rows.slice(0, upto).map((r, k) => ({ cls: k === act ? 'act' : '', cells: [name(r.id), { text: r.possible ? 'yes' : 'no', cls: r.possible ? 'hot' : 'good' }, String(r.dead), String(r.steps), String(r.idle), String(r.restarts)] })) }).items;
      const note = (id, y) => H.para('nt', 0, y, 'Price: ' + COST[id] + '.', 640, 'strong', 14);
      const ty = 24 + 36 * 6 + 30;
      F.add({ items: [head, ...table(0, -1)], say: `The same scripts, run ${SEEDS} times under each rule with seeds 1 to ${SEEDS}. For each rule: can any schedule deadlock (the model checker), how many runs did, how many steps a run took, how long units were held before the script needed them (unit-steps), and how many restarts.`, meta: { phase: 'start', seeds: SEEDS } });
      rows.forEach((r, k) => {
        F.count('rules');
        const say = r.id === 'none' ? `With no rule: ${r.dead} of ${SEEDS} runs deadlocked${r.possible ? '' : ' (and no schedule can)'}; a finished run took ${r.steps} steps on average, and a unit was never held before its script needed it.` : `Break ${condName(r.id)}: ${r.possible ? 'deadlock is still possible' : 'no schedule can deadlock'} (${r.states} states searched); the runs took ${r.steps} steps on average, held units early for ${r.idle} unit-steps` + (r.restarts ? ` and restarted ${r.restarts} times` : '') + '.';
        F.add({ items: [head, ...table(k + 1, k), ...note(r.id, ty)], say, meta: Object.assign({ phase: 'rule', seeds: SEEDS }, r), title: name(r.id) });
      });
      const ok = rows.filter((r) => r.id !== 'none'), most = ok.reduce((a, b) => (b.idle > a.idle ? b : a)), redo = ok.reduce((a, b) => (b.restarts > a.restarts ? b : a));
      const end = `Every rule removes the deadlock, and each pays differently. ${H.cap(H.list(ok.filter((r) => r.idle === most.idle).map((r) => name(r.id))))} ${ok.filter((r) => r.idle === most.idle).length > 1 ? 'hold' : 'holds'} units before they are needed the longest, ${most.idle} unit-steps per run; ${name(redo.id)} throws work away, ${redo.restarts} restarts per run.`;
      F.add({ items: [head, ...table(5, -1), ...H.para('nt', 0, ty, end, 640, 'strong', 14)], say: end, meta: { phase: 'end', idle: most.idle, restarts: redo.restarts, most: ok.filter((r) => r.idle === most.idle).map((r) => r.id), seeds: SEEDS }, title: 'compare', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Prevention, one condition at a time', text: ids.slice(1).map((id) => condName(id) + ': ' + COST[id]).join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which rule will make processes hold units the longest before they need them?', options: ['break hold and wait', 'break no preemption', 'break circular wait', 'break mutual exclusion'], answer: (fr) => fr[fr.length - 1].meta.most.map((id) => 'break ' + condName(id)), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Asking for everything at the start mainly costs…', options: ['units held idle long before they are used', 'more context switches', 'more deadlocks', 'larger page tables'], answer: 0, why: 'A process holds the tape drive from the start even if it uses it only at the end.' },
      { q: 'Preempting resources from a waiting process is practical for…', options: ['state that can be saved and restored, such as memory or registers', 'a printer halfway through a page', 'a lock around a half-done update', 'any resource at all'], answer: 0, why: 'Taking it back must not lose or corrupt work.' },
      { q: 'Lock ordering is the most common prevention in kernels because…', options: ['it costs nothing at run time once the order is kept', 'it needs no discipline', 'it lets resources be shared', 'it finds deadlocks after they happen'], answer: 0, why: 'The cost is in design: every path must take locks in the agreed order.' },
      { q: 'Starvation can come with which prevention rule?', options: ['asking for everything at once', 'mutual exclusion', 'none of them', 'only lock ordering'], answer: 0, why: 'A process needing many popular resources may wait a long time for all of them to be free at once.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
