// The model checker: a search over every schedule of a "system", checking safety properties in every state it
// reaches. Generic: a system is any object with
//   choices() -> [choice]  step(choice)  clone()  hash() -> string  status() -> 'running' | 'done' | 'deadlock' | 'error'
//   and optionally canon() (a hash up to symmetry, used instead of hash() for the safety search), footprint(choice) -> {r, w} (for partial-order reduction), owner(choice) -> the thread whose
//   state it changes (two choices of one owner never commute), runner(choice) -> whose turn it is for the
//   preemption bound (null for a choice that is no thread's turn, such as a store-buffer flush),
//   failure (the message of an assertion that failed). S.Sync machines, the deadlock resource simulator, the
//   Chandy–Misra table and the kernel adapter (mc-d-adapt.js) all are systems.
//
//   S.MC.check(make, spec, opts) -> {verdict, violation, stats, say}
//     make: () -> a fresh system (the start state)
//     spec: {invariants: [{name, holds(sys) -> bool}], deadlock: true (report a deadlock; false to allow one),
//            terminal(sys) (called at every finished state, e.g. to collect outputs)}
//     opts: {por: true (sleep sets, and ample sets: a local, invisible step, sys.local(choice), is taken alone
//            when that does not close a cycle; ample: false keeps only the sleep sets), maxDepth: Infinity, preemptions: Infinity, maxStates: 200000, minimal: true,
//            collect: a Set that receives the hash of every state reached}
//     verdict: 'ok' (no violation in the whole space), 'bounded' (none found, but a bound cut the search short),
//              'violation'
//     violation: {kind: 'invariant' | 'deadlock' | 'assert', name, say, schedule: [choice..], depth}
//       with minimal: true the schedule is a shortest one (breadth-first search for the same kind of failure, over at
//       most minStates: 60000 states; past that the depth-first schedule is kept)
//     stats: {states, transitions, slept (pruned by sleep sets), ample (states reduced to one local step), revisits, bounded (cut by depth or preemptions),
//             depth (the deepest path), complete}
//   S.MC.independent(sys, a, b) -> bool   whether two choices commute in this state
(function (S) {
  'use strict';
  const MC = (S.MC = S.MC || {});

  MC.independent = function (sys, a, b) {
    const own = (c) => (sys.owner ? sys.owner(c) : c);
    if (own(a) === own(b)) return false;
    if (!sys.footprint) return false;
    const A = sys.footprint(a), B = sys.footprint(b);
    const hit = (x, y) => x.some((k) => y.includes(k));
    return !hit(A.w, B.w) && !hit(A.w, B.r) && !hit(B.w, A.r);
  };

  /** the property a state breaks, if any */
  function judge(sys, spec) {
    const st = sys.status();
    if (st === 'error') return { kind: 'assert', name: 'assertion', say: sys.failure || 'a thread failed' };
    if (st === 'deadlock' && spec.deadlock !== false) return { kind: 'deadlock', name: 'deadlock', say: 'No thread can move, yet some are blocked: a deadlock.' };
    for (const inv of spec.invariants || []) if (!inv.holds(sys)) return { kind: 'invariant', name: inv.name, say: 'The invariant "' + inv.name + '" is broken.' };
    if (st === 'done' && spec.terminal) spec.terminal(sys);
    return null;
  }
  /** whose turn a choice is, for the preemption bound (null: no thread's, like a store-buffer flush) */
  const freeOf = (sys, c) => (sys.runner ? sys.runner(c) : sys.owner ? sys.owner(c) : c);

  MC.check = function (make, spec, opts) {
    spec = spec || {}; opts = Object.assign({ por: true, maxDepth: Infinity, preemptions: Infinity, maxStates: 200000, minimal: true }, opts || {});
    const stats = { states: 0, transitions: 0, slept: 0, ample: 0, revisits: 0, bounded: 0, depth: 0, complete: true };
    const bounded = isFinite(opts.preemptions);
    const seen = new Map();
    let found = null;
    const path = [];

    const keyOf = (sys, last, pre) => (sys.canon ? sys.canon() : sys.hash()) + (bounded ? '@' + last + ':' + pre : '');
    /** arrive at a state with a sleep set: the frame to explore it, or null when there is nothing (new) to do */
    function arrive(sys, sleep, depth, last, pre) {
      const key = keyOf(sys, last, pre);
      const enabled = sys.status() === 'running' ? sys.choices() : [];
      const old = seen.get(key);
      if (old && (!isFinite(opts.maxDepth) || old.depth <= depth)) {
        stats.revisits++;
        // the earlier visit slept through some choices that are awake now: explore the state again with the
        // smaller sleep set (stored sets only shrink, so this ends; done in full it stays sound on cycles too)
        const prev = old.sleep;
        if (![...prev].some((c) => !sleep.has(c) && enabled.includes(c))) return null;
        old.sleep = new Set([...prev].filter((c) => sleep.has(c)));
        const todo = enabled.filter((c) => !sleep.has(c));
        return { sys, key, todo, k: 0, sl: new Set(sleep), depth, last, pre, enabled };
      }
      if (!old) {
        stats.states++;
        if (opts.collect) opts.collect.add(sys.hash());
        if (stats.states > opts.maxStates) { stats.complete = false; return null; }
        const bad = judge(sys, spec);
        if (bad) { found = Object.assign(bad, { schedule: path.slice(), depth }); return null; }
      }
      seen.set(key, { sleep: new Set(sleepOn ? sleep : []), depth });
      if (depth > stats.depth) stats.depth = depth;
      if (depth >= opts.maxDepth) { if (enabled.length) { stats.bounded++; stats.complete = false; } return null; }
      const todo = enabled.filter((c) => !sleepOn || !sleep.has(c));
      stats.slept += enabled.length - todo.length;
      // a step that is local and invisible commutes with everything: take it alone (unless it closes a cycle)
      const amp = opts.por && opts.ample !== false && sys.local ? todo.find((c) => sys.local(c)) : undefined;
      if (amp !== undefined && todo.length > 1) { stats.ample++; return { sys, key, todo: [amp], full: todo, k: 0, sl: new Set(sleep), depth, last, pre, enabled }; }
      return { sys, key, todo, k: 0, sl: new Set(sleepOn ? sleep : []), depth, last, pre, enabled };
    }
    const stack = [], onStack = new Map();
    const s0 = make();
    // sleep sets name threads, which a symmetric hash renumbers: with symmetry only the ample sets reduce
    const sleepOn = opts.por && !(s0.spec && s0.spec.symmetry);
    const push = (fr) => { stack.push(fr); onStack.set(fr.key, (onStack.get(fr.key) || 0) + 1); };
    const first = arrive(s0, new Set(), 0, null, 0);
    if (first) push(first);
    while (stack.length && !found) {
      const f = stack[stack.length - 1];
      if (f.k >= f.todo.length) { stack.pop(); const n = onStack.get(f.key) - 1; if (n) onStack.set(f.key, n); else onStack.delete(f.key); path.pop(); continue; }
      const c = f.todo[f.k++], sys = f.sys;
      if (f.full) {
        // the cycle proviso: an ample step must not lead back onto the stack, or the others could be ignored for ever
        const probe = sys.clone(); probe.step(c);
        if (onStack.has(keyOf(probe, f.last, f.pre))) { f.todo = f.full; f.full = null; f.k = 0; stats.ample--; continue; }
      }
      const o = freeOf(sys, c);
      const lastOn = f.last !== null && o !== null && o !== f.last && f.enabled.some((x) => freeOf(sys, x) === f.last);
      const p2 = f.pre + (lastOn ? 1 : 0);
      if (p2 > opts.preemptions) { stats.bounded++; stats.complete = false; continue; }
      const child = sys.clone(), childSleep = new Set();
      if (sleepOn) for (const s of f.sl) if (MC.independent(sys, s, c)) childSleep.add(s);
      if (sleepOn) f.sl.add(c);
      child.step(c); stats.transitions++;
      path.push(c);
      const nf = arrive(child, childSleep, f.depth + 1, o === null ? f.last : o, p2);
      if (nf) push(nf); else if (!found) path.pop();
    }
    if (found && opts.minimal) {
      const short = MC.shortest(make, spec, Object.assign({}, opts, { kind: found.kind, name: found.name }));
      if (short) found = Object.assign(found, short);
    }
    const verdict = found ? 'violation' : stats.complete ? 'ok' : 'bounded';
    const say = found ? `${found.say} A schedule of ${found.schedule.length} steps leads there.`
      : verdict === 'ok' ? `Every one of the ${stats.states} reachable states was checked: no deadlock, no failed assertion${(spec.invariants || []).length ? ', and ' + spec.invariants.map((i) => '"' + i.name + '"').join(', ') + ' always hold' : ''}.`
        : `No violation in the ${stats.states} states reached, but the search stopped at its bounds (depth ${opts.maxDepth}${bounded ? ', ' + opts.preemptions + ' preemptions' : ''}), so this is no proof.`;
    return { verdict, violation: found, stats, say };
  };

  /** breadth-first: a shortest schedule to a state with the same kind of failure (and invariant name) */
  MC.shortest = function (make, spec, opts) {
    const bounded = isFinite(opts.preemptions);
    const start = make(), q = [[start, null, 0, []]], seen = new Set();
    const H = (x) => (x.canon ? x.canon() : x.hash());
    seen.add(H(start) + (bounded ? '@null:0' : ''));
    const quiet = Object.assign({}, spec, { terminal: null });
    let n = 0;
    while (q.length) {
      const [sys, last, pre, sched] = q.shift();
      const bad = judge(sys, quiet);
      if (bad && bad.kind === opts.kind && bad.name === opts.name) return Object.assign(bad, { schedule: sched, depth: sched.length });
      if (bad || sys.status() !== 'running' || sched.length >= opts.maxDepth) continue;
      if (++n > (opts.minStates || 60000)) return null;
      const en = sys.choices();
      for (const c of en) {
        const o = freeOf(sys, c), lastOn = last !== null && o !== null && o !== last && en.some((x) => freeOf(sys, x) === last);
        const p2 = pre + (lastOn ? 1 : 0);
        if (p2 > opts.preemptions) continue;
        const ch = sys.clone(); ch.step(c);
        const l2 = o === null ? last : o, key = H(ch) + (bounded ? '@' + l2 + ':' + p2 : '');
        if (seen.has(key)) continue;
        seen.add(key);
        q.push([ch, l2, p2, sched.concat([c])]);
      }
    }
    return null;
  };

  /** every state reachable (no reduction), as a graph: for liveness checks and for drawing small spaces */
  MC.graph = function (make, opts) {
    opts = Object.assign({ maxDepth: 400, maxStates: 50000 }, opts || {});
    const start = make(), ids = new Map(), nodes = [], edges = [];
    let complete = true;
    const add = (sys, depth) => { const k = sys.hash(); if (ids.has(k)) return [ids.get(k), false]; const id = nodes.length; ids.set(k, id); nodes.push({ id, sys, depth, out: [] }); return [id, true]; };
    add(start, 0);
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i], sys = nd.sys;
      if (sys.status() !== 'running') continue;
      if (nd.depth >= opts.maxDepth || nodes.length > opts.maxStates) { complete = false; continue; }
      for (const c of sys.choices()) {
        const ch = sys.clone(), st = ch.step(c);
        const [to] = add(ch, nd.depth + 1);
        const e = { from: i, to, choice: c, owner: freeOf(sys, c), step: st };
        edges.push(e); nd.out.push(e);
      }
    }
    return { nodes, edges, complete };
  };
  (S.engines = S.engines || []).push({ name: 'Model checker' });
})(globalThis.Proses = globalThis.Proses || {});
