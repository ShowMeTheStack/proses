// The model checker (src/core/mc-*.js): every ready-made program gets the verdict it should (each broken variant's
// bug is found, each correct one passes, liveness as stated), partial-order reduction agrees with the full search,
// counterexamples and liveness lassos replay, bounds behave, random and PCT schedules find bugs, the race tree is
// right, and the same checker runs over C programs on the kernel.
import { load, harness, rng } from './load.mjs';

const t = harness('mc');
const S = load(['core']);
const Y = S.Sync, MC = S.MC;

// ---- the catalogue: safety and liveness verdicts, and replayable counterexamples -----------------------------------
for (const e of Y.catalog) {
  const x = e.build(), spec = e.system ? x.spec : x;
  const r = MC.verify(x, { maxStates: 120000 });
  const safety = r.safety.verdict === 'violation' ? r.safety.violation.kind : r.safety.verdict;
  t.eq(safety, spec.expect, e.id + ': safety verdict');
  if (r.safety.violation) {
    const v = r.safety.violation, rp = r.replay;
    t.eq(rp.at, v.schedule.length, e.id + ': the counterexample replays step by step');
    t.ok(rp.end && rp.end.kind === v.kind, e.id + ': and ends in the same failure (' + v.kind + ')');
    t.ok(rp.steps.every((s) => typeof s.say === 'string' && s.say.length > 5), e.id + ': every replayed step is narrated');
  }
  if (spec.expect === 'ok' && (spec.check.liveness || []).length) t.eq(r.verdict === 'starve' ? 'starve' : 'ok', spec.expectLive, e.id + ': liveness verdict');
}

// ---- minimal counterexamples ----------------------------------------------------------------------------------------
for (const n of [3, 4]) {
  const r = MC.check(MC.maker(Y.philosophers(n, 'naive')), {}, {});
  t.eq(r.violation.schedule.length, 3 * n, 'naive philosophers, n = ' + n + ': the shortest deadlock takes 3n steps (think, left, try right)');
}
t.eq(MC.check(MC.maker(Y.counter('race', 2)), Y.counter('race', 2).check).violation.schedule.length, 6, 'the race needs all six steps, loads before stores');

// ---- partial-order reduction against the full search on random programs --------------------------------------------
/** a random program whose state space is finite: values wrap at 3 and the semaphores are binary */
function randomSpec(R) {
  const nm = 1 + Math.floor(R() * 2), ns = 1 + Math.floor(R() * 2), nt = 2 + Math.floor(R() * 2), threads = [];
  for (let k = 0; k < nt; k++) {
    const prog = [];
    for (let b = 0; b < 2 + Math.floor(R() * 2); b++) {
      const c = R();
      if (c < 0.3) { const a = Math.floor(R() * nm), d = Math.floor(R() * nm); prog.push({ op: 'lock', m: 'm' + a }); if (d !== a) prog.push({ op: 'lock', m: 'm' + d }, { op: 'update', v: 'x', by: 1, mod: 3 }, { op: 'unlock', m: 'm' + d }); else prog.push({ op: 'enter' }, { op: 'leave' }); prog.push({ op: 'unlock', m: 'm' + a }); }
      else if (c < 0.45) prog.push({ op: 'wait', s: 's' + Math.floor(R() * ns) });
      else if (c < 0.6) prog.push({ op: 'post', s: 's' + Math.floor(R() * ns) });
      else if (c < 0.75) prog.push({ op: 'read', v: 'x', into: 'r' }, { op: 'local', fn: (r) => { r.r = (r.r + 1) % 3; } }, { op: 'write', v: 'x', val: (r) => r.r });
      else if (c < 0.85) prog.push({ op: 'think' }, { op: 'enter' }, { op: 'leave' });
      else prog.push({ op: 'assert', label: 'x stays below 2', reads: ['x'], fn: (V) => V.x < 2 });
    }
    threads.push({ name: 'T' + k, prog, loop: R() < 0.4 });
  }
  return { threads, mutexes: Array.from({ length: nm }, (_, i) => 'm' + i), sems: Array.from({ length: ns }, (_, i) => ({ id: 's' + i, init: Math.floor(R() * 2), binary: true })), vars: { x: 0 } };
}
const R = rng(99);
const ME = { invariants: [Y.helpers.mutex()] };
let agree = 0, bugs = 0, fullT = 0, sleepT = 0;
for (let trial = 0; trial < 200; trial++) {
  const spec = randomSpec(R), make = MC.maker(spec);
  const full = new Set(), sleep = new Set();
  const a = MC.check(make, ME, { por: false, minimal: false, collect: full });
  const b = MC.check(make, ME, { por: true, ample: false, minimal: false, collect: sleep });
  const c = MC.check(make, ME, { por: true, minimal: false });
  // a violation stops each search at the first one it meets, which can differ; so compare whether there is one,
  // check that each one found is real, and without one, that sleep sets reached every state
  t.eq(b.verdict, a.verdict, 'random ' + trial + ': sleep sets give the full search\'s verdict');
  t.eq(c.verdict, a.verdict, 'random ' + trial + ': sleep and ample sets give the full search\'s verdict');
  if (!a.violation) { t.ok(full.size === sleep.size && [...full].every((h) => sleep.has(h)), 'random ' + trial + ': sleep sets visit exactly the same states'); fullT += a.stats.transitions; sleepT += b.stats.transitions; }
  for (const r of [a, b, c]) if (r.violation) { const rp = MC.replay(make, r.violation.schedule, ME); t.eq(rp.end && rp.end.kind, r.violation.kind, 'random ' + trial + ': its counterexample replays to the same failure'); }
  if (a.violation) bugs++;
  agree++;
}
t.ok(sleepT < fullT, 'random programs: sleep sets take fewer transitions in all (' + sleepT + ' against ' + fullT + ')');
t.ok(bugs > 20 && bugs < 180, 'random programs: both buggy and clean ones (' + bugs + ' of ' + agree + ' buggy)');
// the classic programs: the reduced search still finds every state the full one does
for (const id of ['phil-ordered', 'rw-fair', 'barber-correct', 'peterson-correct', 'lock-ticket']) {
  const spec = Y.catalog.find((e) => e.id === id).build(), A = new Set(), B = new Set();
  const plain = Object.assign({}, spec); delete plain.symmetry;
  MC.check(MC.maker(plain), plain.check, { por: false, collect: A });
  const rs = MC.check(MC.maker(plain), plain.check, { por: true, ample: false, collect: B });
  t.ok(A.size === B.size && [...A].every((h) => B.has(h)), id + ': sleep sets reach all ' + A.size + ' states');
  t.ok(rs.stats.slept > 0, id + ': and prune transitions (' + rs.stats.slept + ')');
  const sym = MC.check(MC.maker(spec), spec.check, {});
  t.eq(sym.verdict, 'ok', id + ': with symmetry and ample sets too');
}

// ---- bounds ----------------------------------------------------------------------------------------------------------
{
  const ab = Y.lockOrder('ab-ba'), make = MC.maker(ab);
  t.eq(MC.check(make, ab.check, { preemptions: 0 }).verdict, 'bounded', 'AB/BA with no preemption: each thread runs through, no deadlock seen');
  t.eq(MC.check(make, ab.check, { preemptions: 1 }).violation.kind, 'deadlock', 'one preemption is enough to deadlock');
  const ph = Y.philosophers(3, 'ordered');
  t.eq(MC.check(MC.maker(ph), ph.check, { maxDepth: 4 }).verdict, 'bounded', 'a depth bound makes the answer "bounded", not "ok"');
  t.ok(!MC.check(MC.maker(ph), ph.check, { maxDepth: 4 }).stats.complete, 'and says the search was incomplete');
}

// ---- random and PCT schedules ------------------------------------------------------------------------------------------
for (const [name, spec] of [['race', Y.counter('race', 2)], ['buffer without mutex', Y.buffer(2, 2, 1, { check: true, variant: 'no-mutex' })], ['naive philosophers', Y.philosophers(3, 'naive')], ['Peterson on store buffers', Y.peterson('tso')]]) {
  const make = MC.maker(spec);
  for (const [how, f] of [['random', MC.random], ['PCT', MC.pct]]) {
    const r = f(make, spec.check, { runs: 300, seed: 5, maxSteps: 300, depth: 3 });
    t.eq(r.verdict, 'violation', how + ' schedules find the bug in ' + name);
    if (r.violation) t.eq(MC.replay(make, r.violation.schedule, spec.check).end.kind, r.violation.kind, how + ': its schedule replays to the same failure in ' + name);
  }
  t.eq(JSON.stringify(MC.pct(make, spec.check, { runs: 50, seed: 2 }).violation), JSON.stringify(MC.pct(make, spec.check, { runs: 50, seed: 2 }).violation), 'PCT: the same seed, the same schedule (' + name + ')');
}
t.eq(MC.random(MC.maker(Y.philosophers(3, 'ordered')), Y.philosophers(3, 'ordered').check, { runs: 50 }).verdict, 'none found', 'random runs of a correct program find nothing');

// ---- liveness lassos replay ------------------------------------------------------------------------------------------
for (const spec of [Y.readersWriters('reader', 2, 1), Y.spinlock('tas', 2), Y.livelock(), Y.peterson('turn-only')]) {
  const make = MC.maker(spec), L = MC.live(make, spec.check.liveness);
  t.eq(L.fairness, 'weak', 'the fairness assumption is stated');
  for (const res of L.results.filter((x) => !x.holds)) {
    const p = spec.check.liveness.find((q) => q.name === res.name);
    const pre = MC.replay(make, res.lasso.prefix);
    t.eq(pre.at, res.lasso.prefix.length, res.name + ': the prefix replays');
    const h0 = pre.sys.hash();
    let ok = true, prog = false;
    for (const c of res.lasso.cycle) { if (!pre.sys.choices().includes(c)) { ok = false; break; } const st = pre.sys.step(c); if (st.tid === p.thread && st.mark === 'progress') prog = true; }
    t.ok(ok && pre.sys.hash() === h0, res.name + ': the cycle replays and comes back to where it began');
    t.ok(!prog, res.name + ': and the starving thread never makes progress in it');
  }
}
{
  const fair = Y.readersWriters('fair', 2, 1), L = MC.live(MC.maker(fair), fair.check.liveness);
  t.ok(L.results.every((x) => x.holds), 'the fair readers–writers solution starves nobody');
  const rw = Y.readersWriters('reader', 2, 1), L2 = MC.live(MC.maker(rw), rw.check.liveness);
  t.eq(L2.results.filter((x) => !x.holds).map((x) => x.name), ['W1 eventually gets in'], 'reader preference starves the writer, and only the writer');
}

// ---- the race tree, against a count of its own ----------------------------------------------------------------------
{
  const tree = Y.raceTree();
  t.eq(tree.leaves.length, 20, 'two threads of three steps: 6!/(3!3!) = 20 schedules');
  // independent: every arrangement of three T0 steps and three T1 steps, run by hand
  const tally = new Map();
  for (let m = 0; m < 64; m++) {
    const bits = [0, 1, 2, 3, 4, 5].map((k) => (m >> k) & 1);
    if (bits.filter(Boolean).length !== 3) continue;
    let x = 0; const pc = [0, 0], r = [0, 0];
    for (const who of bits) { const k = pc[who]++; if (k === 0) r[who] = x; else if (k === 1) r[who]++; else x = r[who]; }
    tally.set(x, (tally.get(x) || 0) + 1);
  }
  t.eq(tree.finals, [...tally.entries()].sort((a, b) => a[0] - b[0]).map(([value, leaves]) => ({ value, leaves })), 'the final values and how many schedules reach each');
  t.ok(tree.nodes.every((n) => n.parent === null || tree.nodes[n.parent].depth === n.depth - 1), 'every node sits one below its parent');
  t.ok(tree.nodes.every((n) => typeof n.x === 'number' && isFinite(n.x)), 'every node has a place');
  t.eq(Y.raceTree(Y.counter('mutex', 2)).finals.map((f) => f.value), [2], 'with a mutex every schedule ends at 2');
}

// ---- Chandy–Misra ---------------------------------------------------------------------------------------------------------
{
  const c = Y.chandy(3, 'correct'), r = MC.verify(c);
  t.eq(r.verdict, 'ok', 'Chandy–Misra: no deadlock and nobody starves');
  t.ok(r.liveness.results.every((x) => x.holds), 'every philosopher eventually eats');
  t.eq(MC.verify(Y.chandy(3, 'cyclic')).verdict, 'deadlock', 'started with a cycle of clean forks it deadlocks');
  t.eq(MC.verify(Y.chandy(4, 'correct')).verdict, 'ok', 'with four philosophers too');
}

// ---- the kernel: C programs with threads, through the same checker --------------------------------------------------------
{
  const head = '#include <stdio.h>\n#include <pthread.h>\nint counter = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n';
  const main = 'int main(void) { pthread_t a, b; pthread_create(&a, NULL, work, NULL); pthread_create(&b, NULL, work, NULL); pthread_join(a, NULL); pthread_join(b, NULL); printf("%d\\n", counter); return 0; }\n';
  const race = head + 'void *work(void *x) { int r = counter; r = r + 1; counter = r; return 0; }\n' + main;
  const safe = head + 'void *work(void *x) { pthread_mutex_lock(&m); int r = counter; r = r + 1; counter = r; pthread_mutex_unlock(&m); return 0; }\n' + main;
  const outs = (src, por) => { const o = new Set(); const r = MC.check(MC.kernel(src), { terminal: (s) => o.add(s.out) }, { por }); return { o: [...o].sort(), r }; };
  const a = outs(race, false), b = outs(race, true);
  t.eq(a.o, ['1\n', '2\n'], 'kernel: the C race prints 1 or 2');
  t.eq(b.o, a.o, 'kernel: partial-order reduction finds the same outputs');
  t.eq(outs(safe, true).o, ['2\n'], 'kernel: with the mutex it always prints 2');
  t.eq(a.r.verdict, 'ok', 'kernel: no deadlock in either');
  const abba = '#include <pthread.h>\npthread_mutex_t A = PTHREAD_MUTEX_INITIALIZER;\npthread_mutex_t B = PTHREAD_MUTEX_INITIALIZER;\nvoid *t1(void *x) { pthread_mutex_lock(&A); pthread_mutex_lock(&B); pthread_mutex_unlock(&B); pthread_mutex_unlock(&A); return 0; }\nvoid *t2(void *x) { pthread_mutex_lock(&B); pthread_mutex_lock(&A); pthread_mutex_unlock(&A); pthread_mutex_unlock(&B); return 0; }\nint main(void) { pthread_t a, b; pthread_create(&a, NULL, t1, NULL); pthread_create(&b, NULL, t2, NULL); pthread_join(a, NULL); pthread_join(b, NULL); return 0; }\n';
  const d = MC.check(MC.kernel(abba), {}, {});
  t.eq(d.violation && d.violation.kind, 'deadlock', 'kernel: two pthread mutexes taken in opposite orders deadlock');
  t.eq(MC.replay(MC.kernel(abba), d.violation.schedule).end.kind, 'deadlock', 'kernel: and the schedule replays to it');
}
// ---- the barber's expectation follows its parameters -------------------------------------------------------------------
for (const [c, ch] of [[1, 1], [2, 2], [3, 3], [2, 1], [3, 1], [3, 2]]) for (const variant of ['correct', 'no-mutex']) {
  const spec = Y.barber(c, ch, { variant }), r = MC.check(MC.maker(spec), spec.check);
  const got = r.violation ? r.violation.kind : r.verdict;
  t.eq(got, spec.expect, 'barber ' + variant + ' with ' + c + ' customers and ' + ch + ' chairs: ' + spec.expect);
  t.eq(spec.expect, variant === 'no-mutex' && c > ch ? 'invariant' : 'ok', 'barber ' + variant + ' ' + c + '/' + ch + ': it can fail only with more customers than chairs');
}
t.done();
