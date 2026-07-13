// The banker's algorithm and resource-allocation graphs (src/core/dl-*.js): hand-worked cases on our own instance,
// an independent safety check (a search over every order) on random instances, an independent cycle test
// (reachability) on random graphs, and the banker scene's trace.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { load, harness, rng } from './load.mjs';

const t = harness('deadlock');
const S = load(['core', 'stage']);
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
for (const f of ['demo/scenes.js', 'demo/j-banker.js']) vm.runInThisContext(readFileSync(join(src, f), 'utf8'), { filename: f });
const B = S.Banker, G = S.Rag, MC = S.MC, Dl = S.Dl, LD = S.Lockdep, Y = S.Sync;

// ---- hand-worked: five jobs, three types (worked out on paper) ---------------------------------------------------
const A = { avail: [3, 2, 3], max: [[2, 4, 4], [6, 2, 2], [3, 2, 3], [8, 6, 2], [1, 5, 6]], alloc: [[0, 1, 3], [5, 1, 0], [0, 2, 1], [1, 0, 1], [0, 1, 1]] };
t.eq(B.need(A.max, A.alloc), [[2, 3, 1], [1, 1, 2], [3, 0, 2], [7, 6, 1], [1, 4, 5]], 'Need = Max − Allocation');
{
  const s = B.safety(A), checks = s.steps.filter((x) => x.kind === 'check');
  t.ok(s.safe, 'the state is safe');
  t.eq(s.seq, [1, 2, 0, 3, 4], 'safe sequence P1, P2, P0, P3, P4');
  t.eq(checks.map((c) => [c.i, c.fits]), [[0, false], [1, true], [2, true], [3, false], [4, false], [0, true], [3, true], [4, true]], 'the rows checked: pass 1 P0 no, P1 yes, P2 yes, P3 no, P4 no; pass 2 P0, P3, P4 yes');
  t.eq(checks.filter((c) => c.fits).map((c) => c.after), [[8, 3, 3], [8, 5, 4], [8, 6, 7], [9, 6, 8], [9, 7, 9]], 'Work grows (8,3,3) (8,5,4) (8,6,7) (9,6,8) (9,7,9)');
  t.ok(/3 of B is more than the 2 free/.test(checks[0].say), 'P0 is held back by B');
  t.eq(s.steps[s.steps.length - 1].kind, 'safe', 'it ends safe');
}
{
  const r = B.request(A, 1, [1, 1, 1]);
  t.eq(r.verdict, 'granted', 'P1 asks (1,1,1): granted');
  t.eq(r.after.avail, [2, 1, 2], 'Available becomes (2,1,2)');
  t.eq(r.after.alloc[1], [6, 2, 1], "P1's Allocation becomes (6,2,1)");
  t.eq(r.safety.seq, [1, 2, 0, 3, 4], 'and the state stays safe with the same order');
  const u = B.request(A, 0, [2, 2, 1]);
  t.eq(u.verdict, 'unsafe', 'P0 asks (2,2,1): free, but unsafe');
  t.eq(u.safety.seq, [], 'after it nobody could finish');
  t.eq(u.after, null, 'and nothing changes');
  t.eq(B.request(A, 3, [3, 3, 1]).verdict, 'wait', 'P3 asks (3,3,1): more B than is free, so it waits');
  t.eq(B.request(A, 1, [2, 0, 0]).verdict, 'over-need', 'P1 asks (2,0,0): more A than its claim');
}
// detection: P0 and P1 each ask for what the other holds, P2 is free to finish
{
  const d = B.detect({ avail: [0, 0], alloc: [[1, 0], [0, 1], [0, 0]], request: [[0, 1], [1, 0], [0, 0]] });
  t.eq(d.deadlocked, [0, 1], 'detection: P0 and P1 are deadlocked');
  const d2 = B.detect({ avail: [0, 0], alloc: [[1, 0], [0, 1], [1, 0]], request: [[0, 1], [1, 0], [0, 0]] });
  t.eq(d2.deadlocked, [], 'detection: when P2 can finish and give back its unit of A, nobody is stuck');
}

// ---- an independent safety check: is there any order in which everyone finishes? -----------------------------------
function anyOrder(avail, alloc, need) {
  const n = alloc.length, seen = new Set();
  function go(done, work) {
    if (done.every(Boolean)) return true;
    const key = done.join('');
    if (seen.has(key)) return false;
    seen.add(key);
    for (let i = 0; i < n; i++) if (!done[i] && need[i].every((x, j) => x <= work[j])) {
      const d2 = done.slice(); d2[i] = true;
      if (go(d2, work.map((w, j) => w + alloc[i][j]))) return true;
    }
    return false;
  }
  return go(Array(n).fill(false), avail.slice());
}
function validSeq(st, seq) {
  let work = st.avail.slice();
  const need = B.need(st.max, st.alloc);
  for (const i of seq) { if (!need[i].every((x, j) => x <= work[j])) return false; work = work.map((w, j) => w + st.alloc[i][j]); }
  return true;
}
const R = rng(77);
const ri = (k) => Math.floor(R() * k);
let safeCount = 0, total = 0, verdicts = {};
for (let trial = 0; trial < 1500; trial++) {
  const n = 2 + ri(5), m = 1 + ri(4);
  const tot = Array.from({ length: m }, () => 2 + ri(8));
  const max = Array.from({ length: n }, () => tot.map((x) => ri(x + 1)));
  const alloc = max.map((row) => row.map((x) => ri(x + 1)));
  const used = tot.map((_, j) => alloc.reduce((s, r) => s + r[j], 0));
  if (used.some((u, j) => u > tot[j])) continue;
  const st = { avail: tot.map((x, j) => x - used[j]), alloc, max };
  const s = B.safety(st), want = anyOrder(st.avail, alloc, B.need(max, alloc));
  total++; if (want) safeCount++;
  t.eq(s.safe, want, 'trial ' + trial + ': safe exactly when some order lets everyone finish');
  if (s.safe) t.ok(s.seq.length === n && new Set(s.seq).size === n && validSeq(st, s.seq), 'trial ' + trial + ': the sequence given is a safe one');
  // a random request, judged independently
  const i = ri(n), need = B.need(max, alloc), req = need[i].map((x) => ri(x + 2));
  const r = B.request(st, i, req);
  let expect;
  if (req.some((x, j) => x > need[i][j])) expect = 'over-need';
  else if (req.some((x, j) => x > st.avail[j])) expect = 'wait';
  else {
    const al2 = alloc.map((row, k) => (k === i ? row.map((x, j) => x + req[j]) : row));
    expect = anyOrder(st.avail.map((x, j) => x - req[j]), al2, B.need(max, al2)) ? 'granted' : 'unsafe';
  }
  verdicts[expect] = (verdicts[expect] || 0) + 1;
  t.eq(r.verdict, expect, 'trial ' + trial + ': request verdict');
}
t.ok(safeCount > 50 && total - safeCount > 50, 'random instances cover both safe and unsafe states (' + safeCount + ' of ' + total + ' safe)');
t.ok(['granted', 'unsafe', 'wait', 'over-need'].every((v) => verdicts[v] > 10), 'random requests reach every verdict');

// ---- resource-allocation graphs ------------------------------------------------------------------------------------
{
  const g = G.graph({ procs: ['P0', 'P1'], res: [{ name: 'R0' }, { name: 'R1' }], hold: [[0, 0], [1, 1]], want: [[0, 1], [1, 0]] });
  const c = G.cycle(g);
  t.eq(c.cycle, ['p0', 'r1', 'p1', 'r0'], 'a two-process cycle: P0 → R1 → P1 → R0 → P0');
  t.eq(c.steps.filter((s) => s.kind === 'back').length, 1, 'found by one back edge');
  t.eq(G.waitFor(g), [{ from: 0, to: 1, via: 1 }, { from: 1, to: 0, via: 0 }], 'wait-for: P0 waits for P1 and P1 for P0');
  const d = G.deadlock(g);
  t.eq(d.deadlocked, [0, 1], 'both deadlocked');
  t.ok(d.single, 'single-unit resources');
  // the same cycle, but R0 has a second unit held by P2, who wants nothing more
  const h = G.graph({ procs: ['P0', 'P1', 'P2'], res: [{ name: 'R0', units: 2 }, { name: 'R1' }], hold: [[0, 0], [1, 1], [2, 0]], want: [[0, 1], [1, 0]] });
  t.ok(G.cycle(h).cycle !== null, 'with two units of R0 there is still a cycle');
  t.eq(G.deadlock(h).deadlocked, [], 'but no deadlock: P2 can finish and free a unit of R0');
  t.eq(G.cycle(G.graph({ procs: ['P0', 'P1'], res: [{ name: 'R0' }], hold: [[0, 0]], want: [[1, 0]] })).cycle, null, 'a plain wait is no cycle');
  let threw = false; try { G.graph({ procs: ['P0', 'P1'], res: [{ name: 'R0' }], hold: [[0, 0], [1, 0]] }); } catch (e) { threw = true; }
  t.ok(threw, 'holding more units than exist is refused');
}
for (let trial = 0; trial < 600; trial++) {
  const np = 1 + ri(5), nr = 1 + ri(4);
  const res = Array.from({ length: nr }, () => ({ name: 'R', units: 1 + ri(2) }));
  const hold = [], want = [];
  res.forEach((r, j) => { for (let u = 0; u < r.units; u++) if (R() < 0.7) hold.push([ri(np), j]); });
  for (let p = 0; p < np; p++) for (let j = 0; j < nr; j++) if (R() < 0.3 && !hold.some((e) => e[0] === p && e[1] === j)) want.push([p, j]);
  const g = G.graph({ procs: Array.from({ length: np }, (_, i) => 'P' + i), res, hold, want });
  // independent: a node on a cycle reaches itself (transitive closure)
  const nodes = [...g.procs.map((_, i) => 'p' + i), ...g.res.map((_, j) => 'r' + j)], ix = new Map(nodes.map((v, k) => [v, k])), N = nodes.length;
  const reach = Array.from({ length: N }, () => Array(N).fill(false));
  for (const e of G.edges(g)) reach[ix.get(e.from)][ix.get(e.to)] = true;
  for (let k = 0; k < N; k++) for (let a = 0; a < N; a++) if (reach[a][k]) for (let b = 0; b < N; b++) if (reach[k][b]) reach[a][b] = true;
  const has = nodes.some((_, k) => reach[k][k]);
  const c = G.cycle(g).cycle;
  t.eq(c !== null, has, 'graph ' + trial + ': a cycle is found exactly when one exists');
  if (c) { const E = new Set(G.edges(g).map((e) => e.from + '>' + e.to)); t.ok(c.every((v, k) => E.has(v + '>' + c[(k + 1) % c.length])), 'graph ' + trial + ': the cycle reported is made of edges'); }
  const d = G.deadlock(g);
  if (!has) t.eq(d.deadlocked, [], 'graph ' + trial + ': no cycle, no deadlock');
  if (g.res.every((r) => r.units === 1)) {
    // single units: deadlock exactly when a cycle, and the deadlocked processes are those that wait into a cycle
    t.eq(d.deadlocked.length > 0, has, 'graph ' + trial + ': with single units, deadlock exactly when a cycle');
  }
}

// ---- the banker scene ------------------------------------------------------------------------------------------------
const sc = S.Demo.byId('banker');
for (let preset = 0; preset < sc.presets.length; preset++) for (let who = 0; who <= 5; who++) for (let amount = 1; amount <= 3; amount++) {
  const T = sc.trace({ preset, who, amount });
  const seen = new Set([T.mine.r.verdict, ...T.others.map((o) => o.r.verdict)]);
  t.ok(T.safety.safe, 'scene preset ' + preset + ': the starting state is safe');
  t.ok(seen.has('granted') && seen.has('unsafe'), 'scene preset ' + preset + ' P' + who + ' up to ' + amount + ': shows a request granted and one denied as unsafe');
}
for (const narrow of [false, true]) {
  const fr = sc.frames({ narrow, knobs: { preset: 0, who: 1, amount: 1 } });
  t.ok(fr.some((f) => /safe sequence is ⟨P1, P2, P0, P3, P4⟩/.test(f.say)), 'scene: the safe sequence is narrated');
  t.ok(fr.some((f) => /is granted/.test(f.say)) && fr.some((f) => /is denied/.test(f.say)), 'scene: one granted, one denied');
}
// ---- phase 2: detection with several units, against an independent fixpoint ------------------------------------------
function fixpoint(avail, alloc, request) {
  const n = alloc.length, done = alloc.map((r) => r.every((x) => !x));
  let work = avail.slice(), moved = true;
  while (moved) { moved = false; for (let i = n - 1; i >= 0; i--) if (!done[i] && request[i].every((x, j) => x <= work[j])) { done[i] = true; work = work.map((w, j) => w + alloc[i][j]); moved = true; } }
  return done.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
}
for (let trial = 0; trial < 800; trial++) {
  const n = 2 + ri(4), m = 1 + ri(3), tot = Array.from({ length: m }, () => 1 + ri(4));
  const alloc = Array.from({ length: n }, () => Array(m).fill(0));
  const avail = tot.slice();
  for (let j = 0; j < m; j++) for (let u = 0; u < tot[j]; u++) if (R() < 0.7) { alloc[ri(n)][j]++; avail[j]--; }
  const request = Array.from({ length: n }, () => tot.map((x) => (R() < 0.4 ? ri(x + 1) : 0)));
  const st = { avail, alloc, request };
  t.eq(B.detect(st).deadlocked, fixpoint(avail, alloc, request), 'detect ' + trial + ': the same deadlocked set as a fixpoint scanned the other way');
  const d = B.detect(st).deadlocked;
  if (d.length) {
    const tm = B.terminate(Object.assign({ cost: request.map((_, i) => 1 + ((i * 7) % 5)) }, st));
    t.eq(B.detect(tm.state).deadlocked, [], 'terminate ' + trial + ': no deadlock is left');
    t.ok(tm.aborted.every((i) => d.includes(i)), 'terminate ' + trial + ': only deadlocked processes are aborted');
    const all = B.terminate(st, { policy: 'all' });
    t.eq(all.aborted.slice().sort(), d.slice().sort(), 'terminate all ' + trial + ': exactly the deadlocked set is aborted');
    const pr = B.preempt(Object.assign({ cost: request.map(() => 1) }, st));
    const last = pr.steps[pr.steps.length - 1];
    t.ok(last.kind === 'clear' || last.kind === 'stuck', 'preempt ' + trial + ': it ends broken free, or says rolling back is not enough');
    if (last.kind === 'clear') t.eq(B.detect(pr.state).deadlocked, [], 'preempt ' + trial + ': and then nobody is deadlocked');
    const sum = (M) => M.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
    t.eq(sum(pr.state.alloc) + pr.state.avail.reduce((a, b) => a + b, 0), tot.reduce((a, b) => a + b, 0), 'preempt ' + trial + ': no unit is lost or made up');
  }
}
{
  // worked by hand: a cycle P0 → P1 → P2 over single units, P3 idle; P1 is the cheapest
  const st = { avail: [0, 0, 0], alloc: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]], request: [[0, 1, 0], [0, 0, 1], [1, 0, 0], [1, 1, 0]], cost: [5, 2, 8, 1] };
  const tm = B.terminate(st);
  t.eq(tm.aborted, [1], 'terminate: abort P1 (cost 2), the cheapest of P0, P1, P2');
  t.eq(tm.steps.map((x) => x.kind), ['detect', 'abort', 'clear'], 'terminate: detect, abort, clear');
  const pr = B.preempt(st);
  t.eq(pr.victims, [1], 'preempt: roll back P1');
  t.eq(pr.steps[1].request[1], [0, 1, 1], 'preempt: P1 must ask again for the B it gave up, as well as C');
  t.eq(pr.steps[pr.steps.length - 1].kind, 'clear', 'preempt: and the deadlock is gone');
  // the penalty moves the choice on: P1 rolled back twice before costs 2 + 20, more than P0's 5
  const again = B.preempt(Object.assign({}, st, { cost: [5, 2, 8, 1], penalty: 10, checkpoint: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }));
  t.eq(again.rollbacks[1], 1, 'preempt: one rollback was enough here');
}

// ---- the rules simulator: each condition broken in turn ---------------------------------------------------------------
{
  const base = { procs: [{ name: 'A', script: [{ op: 'req', r: 0 }, { op: 'req', r: 1 }, { op: 'work' }, { op: 'rel', r: 1 }, { op: 'rel', r: 0 }] }, { name: 'B', script: [{ op: 'req', r: 1 }, { op: 'req', r: 0 }, { op: 'work' }, { op: 'rel', r: 0 }, { op: 'rel', r: 1 }] }], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }] };
  const r0 = MC.check(() => Dl.sim(base), {});
  t.eq(r0.violation && r0.violation.kind, 'deadlock', 'sim: two processes taking R0 and R1 in opposite orders can deadlock');
  const rp = MC.replay(() => Dl.sim(base), r0.violation.schedule);
  const last = rp.steps[rp.steps.length - 1];
  t.ok(G.cycle(G.graph(last.rag)).cycle !== null && G.deadlock(G.graph(last.rag)).deadlocked.length === 2, 'sim: the graph drawn at that step has the cycle, and both are deadlocked');
  for (const c of Dl.CONDITIONS) t.eq(MC.check(() => Dl.sim(Object.assign({}, base, { rules: c.rule })), {}).verdict, 'ok', 'sim: breaking ' + c.name + ' removes the deadlock');
  const run = Dl.run(Dl.sim(base), { seed: 4 });
  t.ok(run.steps.every((x) => x.say && x.rag && Array.isArray(x.rag.hold)), 'sim: a seeded run narrates every step with its graph');
}
let simDead = 0;
for (let trial = 0; trial < 150; trial++) {
  const np = 2 + ri(2), nr = 2 + ri(2), res = Array.from({ length: nr }, (_, j) => ({ name: 'R' + j, units: 1 + ri(2) }));
  const procs = Array.from({ length: np }, (_, i) => {
    const want = [], k = 1 + ri(3);
    for (let q = 0; q < k; q++) want.push({ op: 'req', r: ri(nr), n: 1 });
    return { name: 'P' + i, script: want.concat([{ op: 'work' }], want.slice().reverse().map((x) => ({ op: 'rel', r: x.r, n: 1 }))) };
  });
  // keep every process's total need within the units, as a real system would refuse more
  if (procs.some((p) => res.some((rr, j) => p.script.filter((x) => x.op === 'req' && x.r === j).length > rr.units))) continue;
  const spec = { procs, res };
  if (MC.check(() => Dl.sim(spec), {}).violation) simDead++;
  for (const c of Dl.CONDITIONS) t.eq(MC.check(() => Dl.sim(Object.assign({}, spec, { rules: c.rule })), {}).verdict, 'ok', 'sim ' + trial + ': with ' + c.name + ' broken there is no deadlock');
}
t.ok(simDead > 5, 'random scripts: some deadlock with every condition in place (' + simDead + ')');

// ---- lock-order checking ---------------------------------------------------------------------------------------------
{
  const serial = Y.run(Y.lockOrder('ab-ba'), { policy: 'fifo' });
  t.eq(serial.end.kind, 'done', 'lockdep: run one thread after the other and nothing deadlocks');
  const ld = LD.check(LD.fromRun(serial.steps));
  t.eq(ld.cycles.length, 1, 'lockdep: yet the lock graph has the cycle A → B → A');
  t.eq(ld.edges.map((e) => e.from + '>' + e.to), ['A>B', 'B>A'], 'lockdep: from the two orders');
  t.eq(LD.check(LD.fromRun(Y.run(Y.lockOrder('ordered'), { policy: 'fifo' }).steps)).cycles.length, 0, 'lockdep: one order everywhere, no cycle');
  const ph = LD.check(LD.fromRun(Y.run(Y.philosophers(3, 'naive'), { policy: 'random', seed: 1, max: 200 }).steps));
  t.ok(ph.cycles.length >= 1, 'lockdep: the naive philosophers\' fork order has a cycle');
  t.eq(LD.check(LD.fromRun(Y.run(Y.philosophers(3, 'ordered'), { policy: 'random', seed: 1, max: 300 }).steps)).cycles.length, 0, 'lockdep: the ordered philosophers\' does not');
}
for (let trial = 0; trial < 300; trial++) {
  const locks = ['A', 'B', 'C', 'D'].slice(0, 2 + ri(3)), ev = [], held = { T0: [], T1: [], T2: [] };
  for (let k = 0; k < 12; k++) {
    const th = 'T' + ri(3), h = held[th];
    if (h.length && R() < 0.4) { const l = h.pop(); ev.push({ thread: th, op: 'release', lock: l }); }
    else { const free = locks.filter((l) => !h.includes(l)); if (!free.length) continue; const l = free[ri(free.length)]; h.push(l); ev.push({ thread: th, op: 'acquire', lock: l }); }
  }
  // independent: the order relation, closed transitively; a cycle when a lock comes before itself
  const ix = new Map(locks.map((l, i) => [l, i])), N = locks.length, reach = Array.from({ length: N }, () => Array(N).fill(false)), hh = { T0: [], T1: [], T2: [] };
  for (const e of ev) { if (e.op === 'acquire') { for (const x of hh[e.thread]) reach[ix.get(x)][ix.get(e.lock)] = true; hh[e.thread].push(e.lock); } else hh[e.thread] = hh[e.thread].filter((x) => x !== e.lock); }
  for (let k = 0; k < N; k++) for (let a = 0; a < N; a++) if (reach[a][k]) for (let b = 0; b < N; b++) if (reach[k][b]) reach[a][b] = true;
  const has = locks.some((_, i) => reach[i][i]);
  t.eq(LD.check(ev).cycles.length > 0, has, 'lockdep ' + trial + ': a cycle is reported exactly when the order relation has one');
}
// ---- graphs with requests for several units, against the matrix detection --------------------------------------------
{
  // a memory pool of 4 pages: P0 and P1 hold 2 each, and each asks for 2 more
  const pool = G.graph({ procs: ['P0', 'P1'], res: [{ name: 'pages', units: 4 }], hold: [[0, 0, 2], [1, 0, 2]], want: [[0, 0, 2], [1, 0, 2]] });
  t.eq(G.deadlock(pool).deadlocked, [0, 1], 'pool: two holders of 2 pages, each asking for 2 more, are deadlocked');
  t.eq(G.edges(pool).filter((e) => e.kind === 'request').map((e) => e.n), [2, 2], 'pool: the request edges carry their counts');
  const one = G.graph({ procs: ['P0', 'P1'], res: [{ name: 'pages', units: 5 }], hold: [[0, 0, 2], [1, 0, 2]], want: [[0, 0, 1], [1, 0, 2]] });
  t.eq(G.deadlock(one).deadlocked, [], 'pool: with a fifth page P0 finishes and frees 2, so P1 can go on');
}
for (let trial = 0; trial < 600; trial++) {
  const np = 1 + ri(4), nr = 1 + ri(3), res = Array.from({ length: nr }, (_, j) => ({ name: 'R' + j, units: 1 + ri(4) }));
  const alloc = Array.from({ length: np }, () => Array(nr).fill(0)), request = Array.from({ length: np }, () => Array(nr).fill(0)), hold = [], want = [];
  res.forEach((r, j) => { for (let u = 0; u < r.units; u++) if (R() < 0.7) alloc[ri(np)][j]++; });
  alloc.forEach((row, p) => row.forEach((k, j) => { if (k) hold.push([p, j, k]); }));
  for (let p = 0; p < np; p++) for (let j = 0; j < nr; j++) if (R() < 0.35) { request[p][j] = 1 + ri(res[j].units); want.push([p, j, request[p][j]]); }
  const avail = res.map((r, j) => r.units - alloc.reduce((s, row) => s + row[j], 0));
  const g = G.graph({ procs: Array.from({ length: np }, (_, i) => 'P' + i), res, hold, want });
  const d = G.deadlock(g);
  t.eq(d.deadlocked, B.detect({ avail, alloc, request }).deadlocked, 'multi-unit graph ' + trial + ': the same deadlocked set as the matrix detection');
  t.eq(d.deadlocked, fixpoint(avail, alloc, request), 'multi-unit graph ' + trial + ': and as the independent fixpoint');
  // each request fits in its type's units, so a deadlocked process waits on units held by deadlocked processes
  // (itself included): the graph must have a cycle
  if (d.deadlocked.length) t.ok(d.cycle !== null, 'multi-unit graph ' + trial + ': a deadlock always shows as a cycle');
}
t.done();
