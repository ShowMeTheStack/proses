// The Sync lab, part three: running a C program. Every run is a list of beats, one a scheduling decision: a
// thread runs until it does something another thread could notice (SL.Sys), and the beat keeps what the
// pictures need: the decision, the lines run, the kernel's events, the state as a world (SL.world) and each
// property's truth then.
//   SL.prepare(v) -> P | {error}       compile, read the program, parse the specification (v: the lab's setup)
//   SL.hand(P, picks) -> {beats, waiting, bad, names}   by hand: picks are thread names; a lone choice is taken at
//                                      once, and when the picks run out, waiting lists who could run next
//   SL.random(P, seed, max) -> {beats, names, end}       a seeded random schedule
//   SL.check(P, o) -> R                "Check it": the model checker with partial-order reduction (and a bound on
//                                      preemptions and states), or PCT and random runs for larger programs; then
//                                      the liveness properties over the reachable states. R: {how, verdict ('ok' |
//                                      'bounded' | 'none' | 'violation' | 'starve'), kind, say, stats, schedule,
//                                      cycleFrom, beats (the schedule replayed), runs, live}
//   SL.replay(P, schedule) -> {beats, names}
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});

  SL.prepare = function (v) {
    let prog;
    try { prog = SL.compile(v.src); } catch (e) { return { error: e }; }
    if (!prog.funcs.get('main')) return { error: { line: 1, col: 1, msg: 'the program has no main function', hint: 'main starts the threads: pthread_create for each, then pthread_join' } };
    const I = SL.info(prog, v.src), spec = SL.spec(v.spec || [], I);
    return { prog, I, spec, gran: v.gran === 'machine' ? 'machine' : 'statement', src: v.src };
  };
  /** the functions the specification looks inside: in(f) in any row, and f in "A calls f" */
  SL.watched = (spec) => new Set(spec.rows.flatMap((r) => (r.x ? r.x.uses.fns : [])).concat(spec.live.map((r) => r.B)));
  const boot = (P, keep, o) => SL.boot(P.prog, { I: P.I, src: P.src, gran: P.gran, keep, endExprs: P.spec.endExprs, watch: SL.watched(P.spec), single: !!(o && o.single) });

  /** one beat: the state after a decision */
  function beat(P, sys, rec, names, prev) {
    const nm = SL.nameThreads(sys.sys, names);
    const world = SL.world(sys.sys, P.I, nm, sys.vars || (prev && prev.world.vars));
    // a thread that crashed takes the process down: it is drawn as failed, at the line it failed on
    const err = rec && rec.events.find((e) => e.kind === 'error');
    if (err) { const t = world.threads.find((x) => x.tid === (err.tid || rec.tid)) || world.threads.find((x) => x.tid === rec.tid); if (t) { t.state = 'error'; t.line = err.line || t.line; } }
    return { choice: rec ? rec.tid : null, rec, world, names: nm, truth: SL.holdsNow(P.spec, sys), status: sys.status(), failure: sys.failure, out: sys.sys.out };
  }
  SL.beat = beat;
  /** the first property a beat breaks: {kind, name, say} | null */
  SL.broken = function (P, b) {
    if (b.status === 'error') return { kind: 'assert', name: 'assertion', say: b.failure };
    if (b.status === 'deadlock' && P.spec.deadlock) return { kind: 'deadlock', name: 'deadlock', say: 'No thread can move, yet some are blocked: a deadlock.' };
    const bad = b.truth.find((x) => x.ok === false && x.row.kind !== 'deadlock');
    return bad ? { kind: 'invariant', name: bad.row.text, say: 'The property "' + bad.row.text + '" is broken.' } : null;
  };

  SL.hand = function (P, picks, max) {
    return SL.withStacks(() => {
      const sys = boot(P, true), beats = [beat(P, sys, null, {}, null)];
      let k = 0, waiting = null, bad = null;
      for (let n = 0; n < (max || 400); n++) {
        if (sys.status() !== 'running') break;
        const cs = sys.choices(), names = beats[beats.length - 1].names;
        let c;
        if (cs.length === 1) c = cs[0];
        else {
          const want = picks[k];
          if (want === undefined) { waiting = cs; break; }
          c = cs.find((x) => names[x] && names[x].name === want);
          if (c === undefined) { bad = { at: k, want, could: cs.map((x) => (names[x] ? names[x].name : String(x))) }; waiting = cs; break; }
          k++;
        }
        const rec = sys.step(c);
        rec.picked = cs.length > 1;
        beats.push(beat(P, sys, rec, names, beats[beats.length - 1]));
      }
      return { beats, waiting, bad, used: k, names: beats[beats.length - 1].names };
    });
  };

  SL.random = function (P, seed, max) {
    return SL.withStacks(() => {
      const sys = boot(P, true), r = S.MC.rng(seed || 1), beats = [beat(P, sys, null, {}, null)];
      let end = null;
      for (let n = 0; n < (max || 80); n++) {
        if (sys.status() !== 'running') break;
        const cs = sys.choices(), c = cs[Math.floor(r() * cs.length)];
        const rec = sys.step(c);
        const b = beat(P, sys, rec, beats[beats.length - 1].names, beats[beats.length - 1]);
        beats.push(b);
        const br = SL.broken(P, b);
        if (br && br.kind !== 'deadlock') { end = br; break; }
      }
      return { beats, end, names: beats[beats.length - 1].names, limit: sys.status() === 'running' };
    });
  };

  SL.replay = function (P, schedule) {
    return SL.withStacks(() => {
      const sys = boot(P, true), beats = [beat(P, sys, null, {}, null)];
      for (const c of schedule) {
        if (sys.status() !== 'running' || !sys.choices().includes(c)) break;
        const rec = sys.step(c);
        beats.push(beat(P, sys, rec, beats[beats.length - 1].names, beats[beats.length - 1]));
      }
      return { beats, names: beats[beats.length - 1].names };
    });
  };

  /** the names threads get in a plain run (for the liveness properties, which need them before the search) */
  function threadNames(P) {
    const sys = boot(P, true);
    for (let n = 0; n < 3000 && sys.status() === 'running'; n++) sys.step(sys.choices()[0]);
    return SL.nameThreads(sys.sys, {});
  }

  /** the check, with the states limit raised (four times at a go, to SL.GROW_MAX) while a bound alone stops it:
   *  a ready-made program always gets a complete verdict; R.limit is the limit that sufficed */
  SL.GROW_MAX = 40000;
  SL.check = function (P, o) {
    o = o || {};
    let lim = o.maxStates || 10000, R;
    for (;;) {
      R = SL.checkOnce(P, Object.assign({}, o, { maxStates: lim }));
      const cut = R.verdict === 'bounded' || (R.live && !R.live.complete && R.verdict !== 'starve');
      if (!cut || o.grow === false || isFinite(o.preempt === null || o.preempt === undefined ? Infinity : o.preempt) || lim >= SL.GROW_MAX || !(o.search === undefined || o.search === 'auto' || o.search === 'full')) break;
      lim = Math.min(SL.GROW_MAX, lim * 4);
    }
    R.limit = lim;
    return R;
  };
  SL.checkOnce = function (P, o) {
    o = Object.assign({ search: 'auto', preempt: Infinity, maxStates: 10000, runs: 120, depth: 3, seed: 1, maxSteps: 300 }, o || {});
    if (o.preempt === null) o.preempt = Infinity;
    return SL.withStacks(() => {
      const start = boot(P, false, o), make = () => start.clone();
      // progress for a caller that shows it (the lab's worker): how many states have been made so far
      if (o.progress) { let n = 0, last = 0; start.ctx.tick = () => { n++; const t = Date.now(); if (t - last > 200) { last = t; o.progress(n); } }; }
      const spec = { invariants: P.spec.invariants, deadlock: P.spec.deadlock };
      const t0 = Date.now();
      const R = { how: null, verdict: 'ok', stats: null, schedule: null, cycleFrom: -1, runs: 0, steps: 0, live: null, kind: null };
      let v = null, G = null;
      const liveRows = P.spec.live.length && o.live !== false;
      if ((o.search === 'auto' || o.search === 'full') && liveRows) {
        // with liveness to check, one graph of every reachable state serves both: each state is judged as it is
        // found (breadth first, so the first failure found is a nearest one), and the liveness check runs on it
        G = S.MC.graph(make, { maxStates: Math.round(o.maxStates * 1.5), maxDepth: 600 });
        R.how = 'graph';
        R.stats = { states: G.nodes.length, transitions: G.edges.length, slept: 0, complete: G.complete, depth: Math.max(0, ...G.nodes.map((n) => n.depth)) };
        const parent = new Map();
        for (const e of G.edges) if (!parent.has(e.to) && e.to !== 0) parent.set(e.to, e);
        for (const nd of G.nodes) {
          const bad = S.MC.judge(nd.sys, spec);
          if (!bad) continue;
          const sched = [];
          for (let at = nd.id; parent.has(at); at = parent.get(at).from) sched.unshift(parent.get(at).choice);
          v = Object.assign(bad, { schedule: sched });
          break;
        }
        R.verdict = v ? 'violation' : G.complete ? 'ok' : 'bounded';
        R.say = v ? v.say : G.complete ? 'Every one of the ' + G.nodes.length + ' reachable states was checked.' : 'No violation in the ' + G.nodes.length + ' states reached, but the search stopped at its bound.';
      } else if (o.search === 'auto' || o.search === 'full') {
        const r = S.MC.check(make, spec, { por: o.por !== false, preemptions: o.preempt, maxStates: o.maxStates, minimal: true, minStates: Math.min(6000, o.maxStates * 2) });
        R.how = 'full'; R.stats = r.stats; R.verdict = r.verdict; R.say = r.say;
        if (r.violation) v = r.violation;
      }
      if (!v && (o.search === 'pct' || o.search === 'random' || (o.search === 'auto' && R.verdict === 'bounded'))) {
        const opts = { runs: o.runs, seed: o.seed, depth: o.depth, maxSteps: o.maxSteps };
        const r = o.search === 'random' ? S.MC.random(make, spec, opts) : S.MC.pct(make, spec, opts);
        R.runs = r.runs; R.steps = r.steps; R.how = o.search === 'auto' ? 'full+' + (o.search === 'random' ? 'random' : 'pct') : o.search;
        R.searchSay = r.say;
        if (r.violation) v = r.violation; else if (o.search !== 'auto') { R.verdict = 'none'; R.say = r.say; }
        if (!r.violation && o.search === 'auto') R.say = R.say + ' Then ' + r.say.charAt(0).toLowerCase() + r.say.slice(1);
      }
      if (v) {
        R.verdict = 'violation'; R.kind = v.kind; R.name = v.name; R.violationSay = v.say; R.schedule = v.schedule;
      } else if (liveRows) {
        const names = threadNames(P), props = P.spec.props(names);
        if (props.length) {
          // the graph already built is lent to the liveness check rather than built again
          const g0 = S.MC.graph;
          if (G) S.MC.graph = () => G;
          let L;
          try { L = S.MC.live(make, props, { maxStates: Math.round(o.maxStates * 1.5), maxDepth: 600 }); } finally { S.MC.graph = g0; }
          R.live = L;
          const bad = L.results.find((x) => !x.holds);
          if (bad) {
            R.verdict = 'starve'; R.kind = bad.kind; R.name = bad.name; R.violationSay = bad.say;
            R.schedule = bad.lasso.prefix.concat(bad.lasso.cycle, bad.lasso.cycle);
            R.cycleFrom = bad.lasso.prefix.length; R.cycleLen = bad.lasso.cycle.length;
          }
        }
      }
      R.ms = Date.now() - t0;
      if (R.schedule) { const rp = SL.replay(P, R.schedule); R.beats = rp.beats; R.names = rp.names; }
      return R;
    });
  };
  /** a check's verdict in a head and lines for the verdict box */
  SL.verdictBox = function (R) {
    const st = R.stats;
    const head = R.verdict === 'violation' ? ({ deadlock: 'Deadlock found', assert: 'Assertion failed', invariant: 'Property broken' }[R.kind] || 'Violation found')
      : R.verdict === 'starve' ? (R.kind === 'stuck' ? 'A thread can be stuck for ever' : 'A thread can starve')
        : R.verdict === 'ok' ? 'Correct in every schedule' : R.verdict === 'none' ? 'Nothing found in the runs' : 'Nothing found within the bounds';
    const kind = R.verdict === 'violation' ? 'bad' : R.verdict === 'starve' ? 'warn' : R.verdict === 'ok' ? 'ok' : 'warn';
    const lines = [];
    if (st) lines.push(st.states + ' states searched' + (st.slept ? ', ' + st.slept + ' pruned by reduction' : ''));
    if (R.runs) lines.push(R.runs + ' ' + (/random/.test(R.how) ? 'random' : 'PCT') + ' runs, ' + R.steps + ' steps');
    if (R.live && R.how !== 'graph') lines.push('liveness: ' + R.live.states + ' states, weak fairness');
    if (R.verdict === 'starve' && R.name) lines.push(R.name.replace(/ eventually /, ' never ') + ' (on the cycle)');
    if (R.schedule) lines.push(R.verdict === 'starve' ? 'way in ' + R.cycleFrom + ' steps, then a cycle of ' + R.cycleLen : 'failing schedule: ' + R.schedule.length + ' steps');
    return { head, kind, lines };
  };
})(globalThis.Proses = globalThis.Proses || {});
