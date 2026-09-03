// Part 7, checking concurrent programs: what the model checker (S.MC) does with a program from the catalogue
// (S.Sync.catalog). The reachable states as a graph for a small program; the search with and without partial-order
// reduction, counted; a shortest failing schedule. Then the cheaper hunts for bigger programs: a search bounded by
// the number of preemptions, seeded random schedules and PCT, each with the effort it took to find the bug.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, MC = () => S.MC, K7 = () => S.Kit.sync7;
  const PROGS = ['counter-race', 'bug-order', 'bug-atomicity', 'bug-lost-wakeup', 'lock-order-ab-ba', 'peterson-check-then-set', 'peterson-tso', 'hash-no-lock', 'barrier-racy', 'phil-naive', 'peterson-correct', 'lock-ticket', 'phil-ordered', 'counter-mutex'];
  const BUGGY = PROGS.filter((p) => !/correct|ticket|ordered|mutex$/.test(p));
  const entry = (id) => Y().catalog.find((c) => c.id === id);
  const bar = (key, x, y, w, max, v, cls, label) => [{ key: key + 'b', kind: 'cell', x, y, w: Math.max(2, Math.round((w * v) / max)), h: 24, rx: 4, text: '', cls: 'bar ' + cls, audit: 'ignore' }, H.text(key + 't', x + Math.max(2, Math.round((w * v) / max)) + 8, y + 17, label, 'strong', 13)];

  H.topic({
    id: 'sync-checker-search', family: 'p07-checker', order: 10, title: 'How the model checker searches',
    blurb: 'A model checker runs a program from its start state, tries every thread that could step next, and remembers each state it has seen so it never explores one twice. Every state is checked against the program\'s invariants and for deadlock. Partial-order reduction skips orders that cannot differ (two steps that touch different things commute), and the failing schedule it finds is cut to a shortest one.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'counter-race', options: PROGS.map((id) => ({ value: id, label: entry(id).title.replace(/^a ([aeiou])/, 'an $1') })) }],
    presets: [
      { label: 'count++ race', values: { prog: 'counter-race' } },
      { label: 'An order violation', values: { prog: 'bug-order' } },
      { label: 'Two locks, opposite orders', values: { prog: 'lock-order-ab-ba' } },
      { label: 'Peterson (correct)', values: { prog: 'peterson-correct' } },
      { label: 'Peterson on store buffers', values: { prog: 'peterson-tso' } },
    ],
    counters: [{ id: 'states', label: 'states' }, { id: 'edges', label: 'transitions' }],
    run(inp) {
      const c = entry(inp.prog), spec = c.build(), make = MC().maker(spec), ck = spec.check, F = new S.Frames(['states', 'edges']);
      const full = MC().check(make, ck, { por: false, minimal: false }), por = MC().check(make, ck, { por: true, minimal: true });
      const G = MC().graph(make, { maxStates: 90 }), small = G.complete && G.nodes.length <= 60;
      const names = spec.threads.map((t) => t.name);
      // layered drawing of a small state graph: depth by row, each row ordered by its parents' places
      const pos = {};
      if (small) {
        const rows = [];
        G.nodes.forEach((nd) => { (rows[nd.depth] = rows[nd.depth] || []).push(nd.id); });
        const parentX = (id) => { const ps = G.edges.filter((e) => e.to === id && pos[e.from]).map((e) => pos[e.from].x); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0; };
        rows.forEach((row, d) => { row.sort((a, b) => parentX(a) - parentX(b)); const w = 560; row.forEach((id, i) => { pos[id] = { x: Math.round(20 + ((i + 0.5) * w) / row.length), y: 30 + d * 44 }; }); });
      }
      const bad = (nd) => { const st = nd.sys.status(); if (st === 'error') return true; if (st === 'deadlock' && ck.deadlock !== false) return true; return (ck.invariants || []).some((iv) => !iv.holds(nd.sys)); };
      const path = new Set(), pathE = new Set();
      if (small && por.violation) { let at = 0; path.add(0); for (const ch of por.violation.schedule) { const e = G.edges.find((x) => x.from === at && x.choice === ch); if (!e) break; pathE.add(e.from + '>' + e.to + ':' + e.choice); at = e.to; path.add(at); } }
      const gy = small ? 30 + Math.max(...G.nodes.map((n) => n.depth)) * 44 + 40 : 0;
      // a bigger program: its listings instead of the graph (threads that share a program share a listing)
      const st0 = Y().machine(spec).snap(), groups = [];
      spec.threads.forEach((t, i) => { const g = groups.find((x) => spec.threads[x[0]].prog === t.prog); if (g) g.push(i); else groups.push([i]); });
      function graph(upto, o) {
        if (!small) {
          const items = [];
          let x = 0;
          groups.slice(0, 2).forEach((g, k) => { const r = H.code('cd' + k, x, 0, spec, st0, g, { textW: 230, size: 13, lh: 26, markW: 30, title: g.map((i) => names[i]).join(', ') + (g.length > 1 ? ' each run:' : ' runs:') }); items.push(...r.items); x += 230 + 12 + g.length * 33 + 16; });
          return items;
        }
        const items = [H.title('gt', 20, 12, 'every reachable state, by depth')];
        G.nodes.forEach((nd) => { if (nd.depth > upto) return; const p = pos[nd.id], st = nd.sys.status(); items.push({ key: 'n' + nd.id, kind: 'state', x: p.x, y: p.y, r: 9, text: '', cls: 'tnode' + (bad(nd) ? ' bad' : st === 'done' ? ' ok' : '') + (o.path && path.has(nd.id) ? ' path' : '') }); });
        G.edges.forEach((e, k) => { if (G.nodes[e.to].depth > upto || G.nodes[e.from].depth >= G.nodes[e.to].depth) return; const on = o.path && pathE.has(e.from + '>' + e.to + ':' + e.choice); items.push({ key: 'e' + k, kind: 'edge', from: 'n' + e.from, to: 'n' + e.to, head: false, cls: (on ? 'path ' : '') + (typeof e.owner === 'number' ? K7().pcls(e.owner) : 'faint'), audit: 'ignore' }); });
        items.push(...H.KS().legend({ prefix: 'lg', x: 20, y: gy, entries: names.slice(0, 3).map((n, i) => ({ cls: 'p' + i, text: n + ' steps', line: true })).concat([{ cls: 'bad', text: 'breaks the spec', round: true }, { cls: 'ok', text: 'finished', round: true }]), gap: 18 }).items);
        return items;
      }
      const sx = small ? 610 : Math.max(560, groups.slice(0, 2).reduce((a, g) => a + 230 + 12 + g.length * 33 + 16, 0)), sy = 20;
      function stats(o) {
        const items = [], max = Math.max(full.stats.transitions, por.stats.transitions, 1);
        items.push(H.title('st', sx, sy, 'search effort'));
        items.push(H.text('s1', sx, sy + 26, 'every order (no reduction)', 'p7note', 13));
        items.push(...bar('bf', sx, sy + 34, 170, max, full.stats.states, 'soft', full.stats.states + ' states'));
        items.push(...bar('bft', sx, sy + 62, 170, max, full.stats.transitions, 'soft', full.stats.transitions + ' steps'));
        if (o.por) {
          items.push(H.text('s2', sx, sy + 110, 'with partial-order reduction', 'p7note', 13));
          items.push(...bar('bp', sx, sy + 118, 170, max, por.stats.states, 'pos', por.stats.states + ' states'));
          items.push(...bar('bpt', sx, sy + 146, 170, max, por.stats.transitions, 'pos', por.stats.transitions + ' steps'));
        }
        if (o.verdict) {
          const v = por.violation;
          items.push(...K7().verdict({ prefix: 'vd', x: sx, y: sy + 190, w: 250, kind: v ? 'bad' : 'ok', head: v ? { invariant: 'Invariant broken', deadlock: 'Deadlock', assert: 'Assertion failed' }[v.kind] : 'No violation', lines: v ? ['shortest schedule: ' + v.schedule.length + ' steps'] : ['every state checked'] }).items);
          if (v) items.push(...K7().strip({ prefix: 'sc', x: sx, y: sy + 270, w: 250, steps: H.stripSteps(spec, v.schedule), cw: 32, ch: 26, size: 13, maxCols: 8, title: 'the failing schedule' }).items);
        }
        return items;
      }
      const maxD = small ? Math.max(...G.nodes.map((n) => n.depth)) : 0;
      F.add({ items: graph(0, {}).concat(stats({})), say: `${H.cap(c.title.replace(/^a ([aeiou])/, 'an $1'))}: ${H.plural(spec.threads.length, 'thread')}. ${spec.about} The checker looks for ${ck.invariants && ck.invariants.length ? 'a state that breaks "' + ck.invariants.map((x) => x.name).join('", "') + '", ' : ''}a failed assertion or a deadlock.`, meta: { vals: [spec.threads.length].concat(H.nums((ck.invariants || []).map((x) => x.name).join(' '))) } });
      if (small) for (let d = 1; d <= maxD; d++) {
        const at = G.nodes.filter((n) => n.depth === d), nb = at.filter(bad).length;
        F.set('states', G.nodes.filter((n) => n.depth <= d).length).set('edges', G.edges.filter((e) => G.nodes[e.to].depth <= d && G.nodes[e.from].depth < d + 1).length);
        F.add({ items: graph(d, {}).concat(stats({})), say: `Depth ${d}: ${H.plural(at.length, 'new state')} reachable in ${H.plural(d, 'step')}${nb ? ', and ' + nb + ' of them ' + (nb > 1 ? 'break' : 'breaks') + ' the specification' : ''}. States reached by different orders are merged: the graph is not a tree.`, meta: { vals: [d, at.length, nb] } });
      }
      F.set('states', full.stats.states).set('edges', full.stats.transitions);
      F.add({ items: graph(maxD, {}).concat(stats({})), say: `Without any reduction the search ${full.violation ? 'stops at its first violation after' : 'covers the whole space in'} ${full.stats.states} states and ${full.stats.transitions} steps.`, meta: { vals: [full.stats.states, full.stats.transitions] } });
      F.set('states', por.stats.states).set('edges', por.stats.transitions);
      F.add({ items: graph(maxD, {}).concat(stats({ por: true })), say: `With partial-order reduction: ${por.stats.states} states and ${por.stats.transitions} steps; ${por.stats.slept} choices were skipped by sleep sets (an order already covered by swapping two independent steps) and ${por.stats.ample} states took a purely local step alone.${!full.violation && por.stats.transitions < full.stats.transitions ? ' The same answer for ' + Math.round((100 * (full.stats.transitions - por.stats.transitions)) / full.stats.transitions) + '% less work.' : ''}`, meta: { vals: [por.stats.states, por.stats.transitions, por.stats.slept, por.stats.ample, Math.round((100 * (full.stats.transitions - por.stats.transitions)) / Math.max(1, full.stats.transitions))] } });
      F.add({ items: graph(maxD, { path: true }).concat(stats({ por: true, verdict: true })), say: por.violation ? `${por.violation.say} A breadth-first search then cuts the schedule to a shortest one: ${H.plural(por.violation.schedule.length, 'step')}, ${H.stripSteps(spec, por.violation.schedule).map((s) => s.text).join(', ')}${small ? ', drawn as the lit path' : ''}.` : por.say, meta: { vals: [por.stats.states].concat(por.violation ? [por.violation.schedule.length] : H.nums(por.say)), full: full.stats, por: por.stats, verdicts: [full.verdict, por.verdict], expect: spec.expect, sched: por.violation ? por.violation.schedule : null } });
      return { frames: F.list, def: H.def('Explicit-state model checking', ['start: the initial state', 'repeat: take a state not yet seen,', '  try every thread that can step', 'check each new state: invariants,', '  assertions, deadlock', 'seen states are hashed, never redone', 'reduction: skip orders of steps', '  that touch disjoint things']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Will the checker find a violation in this program?', options: ['yes', 'no'], answer: (fr) => (/A breadth-first search/.test(fr[fr.length - 1].say) ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Why does the checker remember the states it has seen?', options: ['different orders often reach the same state; exploring it again finds nothing new', 'to print them', 'to save time on the first state', 'it does not'], answer: 0, why: 'Merging equal states turns an exponential tree into a much smaller graph.' },
      { q: 'Two steps of different threads touch different variables. Partial-order reduction…', options: ['explores only one of their two orders', 'explores both', 'removes both', 'runs them at once'], answer: 0, why: 'They commute: both orders reach the same state.' },
      { q: 'A clean verdict from the checker means…', options: ['no schedule of this program at this size breaks the specification', 'the program is correct for any number of threads', 'the program is fast', 'no test is needed for other inputs'], answer: 0, why: 'It is exhaustive for the program as given, not for every size.' },
      { q: 'Why shorten the failing schedule?', options: ['a short schedule is easier to read and replay', 'shorter is more likely', 'the long one is wrong', 'it is required for deadlock'], answer: 0, why: 'Breadth-first search finds a schedule with the fewest steps to the same kind of failure.' },
    ],
  });

  H.topic({
    id: 'sync-checker-bounds', family: 'p07-checker', order: 20, title: 'When the space is too big: bounds and random schedules',
    blurb: 'Most concurrency bugs need only a few preemptions (forced switches) to show up. A search that allows at most k preemptions covers every such schedule cheaply. Random schedules are cheaper still, but they hit a bug only by luck; PCT gives threads random priorities and changes them at a few random points, which finds a bug of depth d with a known chance. Compare the effort each needed.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Buggy program', def: 'peterson-tso', options: BUGGY.map((id) => ({ value: id, label: entry(id).title.replace(/^a ([aeiou])/, 'an $1') })) },
      { id: 'seed', kind: 'number', label: 'Seed', def: 1, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Peterson on store buffers', values: { prog: 'peterson-tso', seed: 1 } },
      { label: 'Hash table without a lock', values: { prog: 'hash-no-lock', seed: 1 } },
      { label: 'Two locks, opposite orders', values: { prog: 'lock-order-ab-ba', seed: 3 } },
      { label: 'A racy barrier', values: { prog: 'barrier-racy', seed: 2 } },
    ],
    counters: [{ id: 'effort', label: 'states or runs' }],
    run(inp) {
      const c = entry(inp.prog), spec = c.build(), make = MC().maker(spec), ck = spec.check, F = new S.Frames(['effort']);
      const bounds = [];
      for (let k = 0; k <= 4; k++) { const r = MC().check(make, ck, { preemptions: k, minimal: false, maxStates: 20000 }); bounds.push({ k, verdict: r.verdict, states: r.stats.states, len: r.violation ? r.violation.schedule.length : 0 }); if (r.verdict === 'violation') break; }
      const runs = 300, rnd = MC().random(make, ck, { runs, seed: inp.seed }), pct2 = MC().pct(make, ck, { runs, seed: inp.seed, depth: 2 }), pct3 = MC().pct(make, ck, { runs, seed: inp.seed, depth: 3 });
      const rows = [];
      function table(n, o) {
        const items = [H.title('tt', 0, 14, 'hunting for the bug in ' + c.title)];
        items.push(...S.Kit.gantt.table({ prefix: 'tb', x: 0, y: 30, cols: [{ w: 300, label: 'method' }, { w: 160, label: 'effort' }, { w: 160, label: 'result' }], rows: rows.slice(0, n).map((r) => ({ cells: [r[0], r[1], { text: r[2], cls: r[3] ? 'bad' : 'good' }] })), rowH: 32, size: 14 }).items);
        if (o && o.verdict) items.push(...K7().verdict({ prefix: 'vd', x: 660, y: 30, w: 240, kind: 'bad', head: 'Found', lines: o.verdict }).items);
        return items;
      }
      F.add({ items: table(0), say: `${H.cap(c.title)}: ${spec.about} Four ways to look for the failure, from exhaustive to lucky.`, meta: { vals: [] } });
      bounds.forEach((b) => {
        rows.push(['search, at most ' + H.plural(b.k, 'preemption'), b.states + ' states', b.verdict === 'violation' ? 'found (' + b.len + ' steps)' : 'nothing', b.verdict === 'violation']);
        F.set('effort', b.states);
        F.add({ items: table(rows.length), say: b.verdict === 'violation' ? `Allowing ${H.plural(b.k, 'preemption')}, the search finds it after ${b.states} states: the bug needs a thread to be switched out ${b.k === 1 ? 'once' : b.k + ' times'} at the wrong moment.` : `With at most ${H.plural(b.k, 'preemption')} (threads switch only when they block or finish${b.k ? ', plus ' + b.k : ''}), ${b.states} states hold no failure.`, meta: { vals: [b.k, b.states, b.len] } });
      });
      for (const [nm, r] of [['random schedules', rnd], ['PCT, depth 2', pct2], ['PCT, depth 3', pct3]]) {
        rows.push([nm + ' (seed ' + inp.seed + ')', r.runs + ' of ' + runs + ' runs', r.verdict === 'violation' ? 'found' : 'nothing', r.verdict === 'violation']);
        F.set('effort', r.runs);
        F.add({ items: table(rows.length), say: r.verdict === 'violation' ? `${H.cap(nm)}: run ${r.runs} of ${runs} hits the bug (${r.violation.say.replace(/\.$/, '')}), after ${r.steps} steps in all.` : `${H.cap(nm)}: ${runs} runs and nothing found. Random testing can miss a bug for a long time.`, meta: { vals: [r.runs, runs, r.steps, inp.seed, 2, 3].concat(r.violation ? H.nums(r.violation.say) : []) } });
      }
      const best = bounds[bounds.length - 1];
      F.add({ items: table(rows.length, { verdict: best.verdict === 'violation' ? ['needs ' + H.plural(best.k, 'preemption'), best.states + ' states to prove it'] : ['not within ' + best.k + ' preemptions'] }), say: best.verdict === 'violation' ? `The bounded search gives a guarantee the random runs cannot: every schedule with up to ${H.plural(best.k, 'preemption')} was covered, and the bug was there with ${best.k}. Random runs ${rnd.verdict === 'violation' ? 'found it too, this time, after ' + rnd.runs : 'missed it in ' + runs}; PCT is built to find bugs that need a few priority changes.` : 'Even with 4 preemptions the bounded search found nothing; the random hunters are the remaining hope.', meta: { vals: [best.k, best.states, rnd.runs, runs, 4], bounds } });
      return { frames: F.list, def: H.def('Cheaper hunts', ['preemption bound k: switch threads', '  freely only when one blocks or', '  ends, plus at most k times', 'random: pick any ready thread', 'PCT: random priorities, lowered at', '  d − 1 random steps; finds a depth-d', '  bug with chance about 1/(n·k^(d−1))']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'How many preemptions will the bounded search need to find this bug?', options: ['0', '1', '2', '3', '4', 'more'], answer: (fr) => { const f = fr.find((x) => /the search finds it/.test(x.say)); return f ? String(f.meta.vals[0]) : 'more'; }, explain: (fr) => (fr.find((x) => /the search finds it/.test(x.say)) || fr[fr.length - 1]).say }],
    quiz: [
      { q: 'Why does a small preemption bound find most bugs?', options: ['most bugs need only one or two badly timed switches', 'preemptions are rare', 'bugs never need switches', 'the bound is random'], answer: 0, why: 'Experience with real programs: shallow bugs dominate.' },
      { q: 'A random tester ran 300 schedules and found nothing. This shows…', options: ['nothing certain: the bug may be in a schedule it never tried', 'the program is correct', 'the bug needs 300 threads', 'PCT will fail too'], answer: 0, why: 'Testing shows the presence of bugs, not their absence.' },
      { q: 'What does PCT change compared with plain random scheduling?', options: ['it fixes random priorities and lowers them at a few chosen points', 'it runs threads in order', 'it searches every schedule', 'it adds threads'], answer: 0, why: 'Priority changes at random points give a guaranteed chance for bugs of small depth.' },
      { q: 'A preemption is…', options: ['a switch away from a thread that could have gone on', 'any context switch', 'a blocked thread', 'a deadlock'], answer: 0, why: 'Switching when a thread blocks or ends is free; switching a runnable thread out costs one.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
