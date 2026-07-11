// More classic problems as machine specs, each with spec.check, spec.expect, spec.expectLive and spec.about (see
// sync-d-classic.js):
//   S.Sync.smokers(variant)        one agent picks a pair (every pick is tried); 'naive' (each smoker waits for its
//                                  two ingredients in turn) | 'helpers' (three helper threads, one an ingredient, note
//                                  on_table under table_lock and post go0..go2 for the smoker who can use the pair)
//   S.Sync.barrierProblem(n, variant, rounds)  'primitive' (the barrier op) | 'two-gates' (a reusable barrier from
//                                  semaphores: count_lock, and gate_even and gate_odd opened in alternate rounds by
//                                  the last to arrive) | 'racy' (count++ without a lock: an arrival can be lost, and
//                                  everyone waits). 'two-phase' is an older name for 'two-gates'.
//   S.Sync.crews(boats, variant)   rowers and coxes arrive as threads; every boat needs two rowers and one cox.
//                                  Under dock each newcomer signs in; the one who completes a crew posts call_rower
//                                  twice and call_cox once; boarders log themselves in aboard. 'correct' (the dock
//                                  stays shut until the last of the three is aboard) | 'early-release' (the launcher
//                                  frees the dock at once, so two crews' people mix)
//   S.Sync.livelock()              two polite threads: take one lock, try the other, back off, start again
//   S.Sync.lockOrder(variant)      'ab-ba' (two threads take two locks in opposite orders) | 'ordered'
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const H = () => Y.helpers;
  const W = (s) => ({ op: 'wait', s, label: 'wait(' + s + ')' }), P = (s) => ({ op: 'post', s, label: 'post(' + s + ')' });
  const ING = ['tobacco', 'paper', 'matches'];

  Y.smokers = function (variant) {
    const v = variant || 'naive', threads = [], sems = [{ id: 'agent', name: 'agent', init: 1 }, ...ING.map((g) => ({ id: g, name: g, init: 0 }))];
    // the agent: one thread that picks which two ingredients to put out (the schedule decides: every choice is tried)
    const put = (k) => [{ label: 'put' + k }, { op: 'write', v: 'table', val: k, label: 'puts ' + ING[(k + 1) % 3] + ' and ' + ING[(k + 2) % 3] + ' out' }, P(ING[(k + 1) % 3]), P(ING[(k + 2) % 3]), { op: 'jump', to: 'end', label: 'done' }];
    threads.push({ name: 'A', role: 'agent', loop: true, prog: [W('agent'), { op: 'choose', n: 3, into: 'k', label: 'which smoker to serve', say: (k, th) => `${th.name} picks the pair that smoker ${k} needs.` },
      { op: 'jump', to: 'put0', if: (r) => r.k === 0, label: 'k == 0' }, { op: 'jump', to: 'put1', if: (r) => r.k === 1, label: 'k == 1' }, ...put(2), ...put(0), ...put(1), { label: 'end' }] });
    const smoke = (k) => [{ op: 'assert', label: 'the table holds what smoker ' + k + ' lacks', reads: ['table'], fn: (V) => V.table === k }, { op: 'write', v: 'table', val: -1, label: 'takes them', mark: 'progress' }, { op: 'work', label: 'smokes' }, P('agent')];
    if (v === 'naive') {
      for (let k = 0; k < 3; k++) threads.push({ name: 'S' + k, role: 'smoker', loop: true, prog: [W(ING[(k + 1) % 3]), W(ING[(k + 2) % 3]), ...smoke(k)] });
    } else {
      sems.push({ id: 'table_lock', name: 'table_lock', init: 1 }, ...[0, 1, 2].map((k) => ({ id: 'go' + k, name: 'go' + k, init: 0 })));
      for (let j = 0; j < 3; j++) {
        const a = (j + 1) % 3, b = (j + 2) % 3;
        // a helper watches for one ingredient j; with j and a out, the smoker who holds b can smoke, and so on
        const decide = { op: 'atomic', w: ['on_table'], label: 'checks the table and notes ' + ING[j], fn: (V, r) => { const t = V.on_table.slice(); r.go = -1; if (t[a]) { t[a] = 0; r.go = b; } else if (t[b]) { t[b] = 0; r.go = a; } else t[j] = 1; V.on_table = t; } };
        const wake = [0, 1, 2].flatMap((k) => [{ op: 'jump', to: 'n' + k, if: (r) => r.go !== k, label: 'not smoker ' + k }, P('go' + k), { label: 'n' + k }]);
        threads.push({ name: 'H' + j, role: 'helper', loop: true, prog: [W(ING[j]), W('table_lock'), decide, ...wake, { op: 'local', fn: (r) => { r.go = null; }, label: 'forgets' }, P('table_lock')] });
      }
      for (let k = 0; k < 3; k++) threads.push({ name: 'S' + k, role: 'smoker', loop: true, prog: [W('go' + k), ...smoke(k)] });
    }
    const spec = { threads, sems, vars: { table: -1, on_table: [0, 0, 0] } };
    spec.check = { invariants: [], liveness: [], deadlock: true };
    spec.expect = v === 'naive' ? 'deadlock' : 'ok'; spec.expectLive = 'ok';
    spec.about = v === 'naive' ? 'Two smokers can each grab one of the two ingredients on the table, and then nobody can smoke.' : 'Three helper threads note each ingredient as it lands on the table and wake the one smoker who holds the third.';
    return spec;
  };

  Y.barrierProblem = function (n, variant, rounds) {
    const v = variant === 'two-phase' ? 'two-gates' : variant || 'primitive', N = n || 3, R = rounds || 2, threads = [];
    const mark = (arr) => ({ op: 'write', v: arr, idx: (reg, th) => th.id, val: (reg, th) => th.rounds + 1, label: arr === 'arrived' ? 'arrives' : 'passes', mark: arr === 'passed' ? 'progress' : undefined });
    let body, sems = [], barriers = [];
    if (v === 'primitive') { barriers = [{ id: 'b', name: 'the barrier', n: N }]; body = [{ op: 'barrier', b: 'b', label: 'barrier(b)' }]; }
    else if (v === 'two-gates') {
      // two gates used in alternate rounds: the last to arrive opens this round's gate for the n − 1 others; a fast
      // thread reaches the next round's gate, which stays shut until everyone has arrived again
      sems = [{ id: 'count_lock', init: 1 }, { id: 'gate_even', init: 0 }, { id: 'gate_odd', init: 0 }];
      const open = (g) => Array.from({ length: N - 1 }, () => P(g));
      body = [W('count_lock'), { op: 'update', v: 'count', by: 1, label: 'count++' }, { op: 'read', v: 'count', into: 'c', label: 'c = count' }, { op: 'jump', to: 'wait', if: (r) => r.c !== N, label: 'if not the last' },
        { op: 'write', v: 'count', val: 0, label: 'count = 0' }, { op: 'jump', to: 'oddo', if: (r) => r.par, label: 'if an odd round' }, ...open('gate_even'), { op: 'jump', to: 'rel', label: 'opened' }, { label: 'oddo' }, ...open('gate_odd'), { label: 'rel' }, P('count_lock'), { op: 'jump', to: 'pass', label: 'go through' },
        { label: 'wait' }, P('count_lock'), { op: 'jump', to: 'oddw', if: (r) => r.par, label: 'if an odd round' }, W('gate_even'), { op: 'jump', to: 'pass', label: 'through' }, { label: 'oddw' }, W('gate_odd'),
        { label: 'pass' }, { op: 'local', fn: (r) => { r.par = r.par ? 0 : 1; r.c = null; }, label: 'the next round uses the other gate' }];
    } else {
      sems = [{ id: 'gate', init: 0 }];
      body = [{ op: 'read', v: 'count', into: 'c', label: 'c = count' }, { op: 'local', fn: (r) => { r.c++; }, label: 'c = c + 1' }, { op: 'write', v: 'count', val: (r) => r.c, label: 'count = c' }, { op: 'jump', to: 's1', if: (r) => r.c !== N, label: 'if not the last' }, ...Array.from({ length: N }, () => P('gate')), { label: 's1' }, W('gate')];
    }
    for (let i = 0; i < N; i++) threads.push({ name: 'T' + i, loop: true, iters: v === 'racy' ? 1 : R, prog: [mark('arrived'), ...body, mark('passed')] });
    const spec = { threads, sems: sems.map((s) => Object.assign({ name: s.id }, s)), barriers, vars: { count: 0, arrived: Array(N).fill(0), passed: Array(N).fill(0) } };
    spec.check = { invariants: [{ name: 'nobody passes round r before everyone has arrived at round r', holds: (M) => M.vars.passed.every((p) => M.vars.arrived.every((a) => p <= a)) }], liveness: H().each(spec, 'passes'), deadlock: true };
    spec.expect = v === 'racy' ? 'deadlock' : 'ok'; spec.expectLive = 'ok';
    spec.about = { primitive: 'The last to arrive lets everyone through.', 'two-gates': 'The last to arrive opens this round\'s gate for the others; rounds alternate between two gates, so a fast thread waits at the next one instead of slipping through this one again.', racy: 'count++ without a lock can lose an arrival: the count never reaches n, the gate is never opened, and everyone waits.' }[v];
    return spec;
  };

  Y.crews = function (boats, variant) {
    const v = variant || 'correct', m = boats || 2, threads = [];
    // under dock: count the newcomer; whoever completes a crew (two rowers and a cox) launches it
    const count = (role) => ({ op: 'atomic', w: ['rowers', 'coxes', 'boarding'], label: 'signs in and checks for a full crew', fn: (V, r) => { if (role === 'C') V.coxes++; else V.rowers++; r.lead = V.rowers >= 2 && V.coxes >= 1; if (r.lead) { V.rowers -= 2; V.coxes -= 1; V.boarding = 3; } } });
    const board = { op: 'atomic', w: ['boarding'], label: 'counts itself aboard', fn: (V, r) => { V.boarding--; r.last = V.boarding === 0; } };
    const member = (role) => [W('dock'), count(role), { op: 'jump', to: 'wait', if: (r) => !r.lead, label: 'if no full crew yet' },
      P('call_rower'), P('call_rower'), P('call_cox')].concat(v === 'early-release' ? [P('dock')] : [], [{ op: 'jump', to: 'go', label: 'launches this boat' }, { label: 'wait' }, P('dock'), { label: 'go' },
      W(role === 'C' ? 'call_cox' : 'call_rower'), { op: 'log', v: 'aboard', val: role, label: 'boards as', mark: 'progress' }, board],
      v === 'early-release' ? [] : [{ op: 'jump', to: 'end', if: (r) => !r.last, label: 'if not the last aboard' }, P('dock'), { label: 'end' }]);
    for (let i = 0; i < m; i++) threads.push({ name: 'X' + (i + 1), role: 'cox', prog: member('C') });
    for (let i = 0; i < 2 * m; i++) threads.push({ name: 'R' + (i + 1), role: 'rower', prog: member('R') });
    const spec = { threads, sems: [{ id: 'dock', name: 'dock', init: 1 }, { id: 'call_rower', name: 'call_rower', init: 0 }, { id: 'call_cox', name: 'call_cox', init: 0 }], vars: { rowers: 0, coxes: 0, boarding: 0, aboard: [] }, symmetry: [Array.from({ length: m }, (_, i) => i), Array.from({ length: 2 * m }, (_, i) => m + i)] };
    spec.check = { invariants: [{ name: 'each boat takes two rowers and one cox', holds: (M) => { const b = M.vars.aboard; for (let i = 0; i + 3 <= b.length; i += 3) if (b.slice(i, i + 3).filter((x) => x === 'C').length !== 1) return false; return true; } }], liveness: [], deadlock: true };
    spec.expect = v === 'correct' ? 'ok' : 'invariant'; spec.expectLive = 'ok';
    spec.about = v === 'correct' ? 'The newcomer who completes a crew calls two rowers and a cox aboard and keeps the dock until the last of the three has boarded, who then frees it.' : 'The launcher frees the dock at once, so the next crew is called while this one is still boarding, and people board the wrong boat.';
    return spec;
  };

  Y.livelock = function () {
    const polite = (a, b) => [{ label: 'top' }, { op: 'lock', m: a, label: 'lock(' + a + ')' }, { op: 'trylock', m: b, into: 'ok', label: 'trylock(' + b + ')' }, { op: 'jump', to: 'got', if: (r) => r.ok, label: 'if it worked' }, { op: 'unlock', m: a, label: 'back off: unlock(' + a + ')' }, { op: 'jump', to: 'top', label: 'try again' },
      { label: 'got' }, { op: 'enter', mark: 'progress' }, { op: 'leave' }, { op: 'unlock', m: b, label: 'unlock(' + b + ')' }, { op: 'unlock', m: a, label: 'unlock(' + a + ')' }];
    const spec = { threads: [{ name: 'T0', loop: true, prog: polite('A', 'B') }, { name: 'T1', loop: true, prog: polite('B', 'A') }], mutexes: ['A', 'B'] };
    spec.check = { invariants: [H().mutex()], liveness: H().each(spec, 'gets both locks'), deadlock: true };
    spec.expect = 'ok'; spec.expectLive = 'starve';
    spec.about = 'Nobody ever blocks, so there is no deadlock, but in lock step both back off and retry for ever: a livelock.';
    return spec;
  };

  Y.lockOrder = function (variant) {
    const v = variant || 'ab-ba', two = (a, b) => [{ op: 'lock', m: a, label: 'lock(' + a + ')' }, { op: 'lock', m: b, label: 'lock(' + b + ')' }, { op: 'enter', mark: 'progress' }, { op: 'leave' }, { op: 'unlock', m: b, label: 'unlock(' + b + ')' }, { op: 'unlock', m: a, label: 'unlock(' + a + ')' }];
    const spec = { threads: [{ name: 'T0', prog: two('A', 'B') }, { name: 'T1', prog: v === 'ab-ba' ? two('B', 'A') : two('A', 'B') }], mutexes: ['A', 'B'] };
    spec.check = { invariants: [H().mutex()], liveness: [], deadlock: true };
    spec.expect = v === 'ab-ba' ? 'deadlock' : 'ok'; spec.expectLive = 'ok';
    spec.about = v === 'ab-ba' ? 'T0 takes A then B, T1 takes B then A: each can hold one and wait for the other.' : 'Both take A before B: a cycle of waits cannot form.';
    return spec;
  };
})(globalThis.Proses = globalThis.Proses || {});
