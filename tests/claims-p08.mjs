// Part 8 (classic problems and concurrency bugs): every topic run with its default, every preset and random valid
// inputs; every frame's wording and quoted numbers checked against the values it carries from the engines (the
// shared machinery of claims-p07.mjs). Then, independently of the topics' code:
//   - every snapshot a frame shows obeys the rules of the primitives: a semaphore never below 0 and at 0 whenever
//     someone waits on it, a mutex owner never in its own queue, every queued thread blocked on that object;
//     consecutive snapshots change a semaphore by at most one step of the protocol;
//   - the checker's verdict a topic shows agrees with what the program is known to do (spec.expect / expectLive),
//     re-checked here without partial-order reduction;
//   - problem invariants hold on every frame of a correct program (no reader beside a writer, free_seats never below 0
//    , neighbours never eating together, an eater holding both its forks);
//   - the event-loop model against a second simulation written here, one millisecond at a time, and a hand-worked
//     case.
// Prints "claims-p08 N passed, M failed".
import { load, harness, rng } from './load.mjs';
import { wording, untraced, numbersOf } from './claims-p07.mjs';

const S = load(['core', 'stage', 'topics']);
const t = harness('claims-p08');
const Y = S.Sync;

// ---- the shared frame checks, with names masked first: a lock or request called A, B, C (A is free, A arrives) and
// numbered names (smoker 1 needs, n − 1 seats) are names, not words or quantities
const mask = (say) => String(say || '').replace(/(^|[^\w'’])([A-Z])(?=[\s:,.;)’']|$)/g, (m0, a) => a + 'Xq').replace(/\b(smoker|philosopher|fork|seat|slot|line|step)\s\d+/g, '$1 n').replace(/n − 1 (\w+)/g, 'n − 1 x');
function checkTopics(S, t, prefixes, o) {
  const topics = S.topics.filter((x) => prefixes.some((p) => x.family.startsWith(p)));
  t.ok(topics.length > 0, 'topics found');
  for (const tp of topics) {
    const inputs = [{ label: 'default', values: {} }].concat(tp.presets || []).map((p) => [p.label, S.inputOf(tp, Object.assign(S.inputOf(tp), p.values))]);
    const gen = o.random && o.random[tp.id];
    if (gen) { const r = rng(7); for (let k = 0; k < (o.randomRuns || 3); k++) { const v = gen(r, k); if (v && !S.checkInput(tp, v)) inputs.push(['random ' + k, v]); } }
    for (const [label, input] of inputs) {
      const res = S.run(tp, input);
      if (!res.ok) { t.ok(false, tp.id + ' / ' + label + ' crashed: ' + res.error); continue; }
      const inNums = numbersOf(input);
      res.frames.forEach((f, i) => {
        const where = tp.id + ' / ' + label + ' / frame ' + i, w = wording(mask(f.say));
        t.ok(!w.length, where + ': wording ' + w.join(', ') + ' in "' + f.say + '"');
        const said = String(f.say || '').replace(/\b(T|P|C|W|R|S|Q|H|O|A|B|L|F|fork|seat|slot|thread|smoker|philosopher|line|step)\s?\d+/gi, (m0) => m0.replace(/\d+/g, 'n'));
        const bad = untraced(said, numbersOf(f.meta || {}).concat(inNums));
        t.ok(!bad.length, where + ': untraced numbers ' + bad.join(', ') + ' in "' + f.say + '"');
      });
      o.extra(tp, input, res, label);
    }
  }
  return topics.length;
}

// ---- the rules of the primitives, on any snapshot ----
function primitives(st, where) {
  if (!st || !st.threads || !st.sem) return;
  for (const [id, s] of Object.entries(st.sem)) {
    t.ok(s.value >= 0, where + ': semaphore ' + id + ' below 0');
    if (s.queue.length) t.ok(s.value === 0, where + ': semaphore ' + id + ' has waiters but value ' + s.value);
    for (const q of s.queue) t.ok(st.threads[q].state === 'blocked' && st.threads[q].on.id === id, where + ': ' + st.threads[q].name + ' queued on ' + id + ' but not blocked there');
  }
  for (const [id, m] of Object.entries(st.mutex || {})) {
    t.ok(!m.queue.includes(m.owner), where + ': the owner of ' + id + ' waits for it');
    if (m.queue.length) t.ok(m.owner !== null, where + ': ' + id + ' is free yet has a queue');
  }
}
function semStep(prev, st, where) {
  if (!prev || !st || !prev.sem) return;
  for (const id of Object.keys(st.sem)) {
    const a = prev.sem[id], b = st.sem[id], dv = b.value - a.value, dq = b.queue.length - a.queue.length;
    const ok = (dv === 0 && dq === 0) || (dv === -1 && dq === 0) || (dv === 1 && dq === 0) || (dv === 0 && Math.abs(dq) === 1);
    t.ok(ok, where + ': semaphore ' + id + ' moved from ' + a.value + '/' + a.queue.length + ' to ' + b.value + '/' + b.queue.length + ' in one step');
  }
}

// ---- the spec each topic runs, built here from its input ----
const specOf = {
  'classic-buffer-broken': (i) => Y.buffer(i.size, i.producers, i.consumers, { check: true, variant: i.variant }),
  'classic-buffer-cv': (i) => { const v = i.variant, base = v.startsWith('while') ? 'while' : v.startsWith('if') ? 'if' : 'one-cv'; return Y.cvBuffer(1, v === 'one-cv' ? 2 : 1, v === 'while-1' ? 1 : 2, { variant: base, hoare: v === 'if-hoare' }); },
  'classic-rw-starve': (i) => Y.readersWriters(i.variant, i.readers, i.writers),
  'classic-phil-deadlock': (i) => Y.philosophers(i.n, 'naive'),
  'classic-phil-fixes': (i) => Y.philosophers(i.n, i.variant),
  'classic-barber': (i) => Y.barber(i.customers, i.seats, { variant: i.variant }),
  'classic-smokers': (i) => Y.smokers(i.variant),
  'classic-barrier': (i) => Y.barrierProblem(i.n, i.variant, i.variant === 'racy' ? 1 : i.rounds),
  'classic-crew': (i) => Y.crews(i.boats, i.variant),
  'classic-bug-violations': (i) => Y.bug(i.variant.replace('-fixed', ''), i.variant.endsWith('fixed')),
  'classic-bug-deadlock': (i) => (i.variant === 'ab-ba' || i.variant === 'ordered' ? Y.lockOrder(i.variant) : Y.bug('lost-wakeup', i.variant === 'lost-fixed')),
};
const verdictCache = new Map();
/** the verdict kind expected, from a search without partial-order reduction (bad, warn or ok) */
function expected(spec, key) {
  if (verdictCache.has(key)) return verdictCache.get(key);
  const r = S.MC.check(S.MC.maker(spec), spec.check, { por: false, minimal: false, maxStates: 400000 });
  let k = r.verdict === 'violation' ? 'bad' : 'ok';
  if (k === 'ok' && (spec.check.liveness || []).length) { const L = S.MC.live(S.MC.maker(spec), spec.check.liveness); if (L.results.some((x) => !x.holds)) k = 'warn'; }
  t.eq(k, spec.expect !== 'ok' ? 'bad' : spec.expectLive === 'starve' ? 'warn' : 'ok', key + ': the search without reduction agrees with what the program is known to do');
  verdictCache.set(key, k);
  return k;
}

// ---- the event loop, one millisecond at a time ----
function tick(reqs, mode) {
  const R = reqs.map((r) => Object.assign({ phase: 0, ready: null, left: 0 }, r)), done = {};
  if (mode === 'serial') { let now = 0; for (const r of R.slice().sort((a, b) => a.at - b.at)) { now = Math.max(now, r.at) + r.cpu + r.io + r.cpu2; done[r.name] = now; } return done; }
  const order = (a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === 'req' ? -1 : 1) || (a.name < b.name ? -1 : 1);
  let now = 0, busy = null;
  const queue = [], due = R.map((r) => ({ t: r.at, kind: 'req', name: r.name }));
  for (; now < 10000 && Object.keys(done).length < R.length; now++) {
    // finish the work that ends now
    if (busy && busy.end === now) {
      const r = R.find((x) => x.name === busy.name);
      if (busy.kind === 'req') due.push({ t: now + r.io, kind: 'io', name: r.name }); else done[r.name] = now;
      busy = null;
    }
    const arrived = due.filter((e) => e.t <= now).sort(order);
    for (const e of arrived) { due.splice(due.indexOf(e), 1); queue.push(e); }
    if (!busy && queue.length) {
      const e = queue.shift(), r = R.find((x) => x.name === e.name);
      busy = { name: e.name, kind: e.kind, end: now + (e.kind === 'req' ? r.cpu : r.cpu2) };
    }
  }
  return done;
}
{
  const reqs = [{ name: 'A', at: 0, cpu: 2, io: 6, cpu2: 1 }, { name: 'B', at: 1, cpu: 2, io: 5, cpu2: 1 }, { name: 'C', at: 2, cpu: 1, io: 8, cpu2: 2 }];
  // worked by hand: one thread finishes A at 9, B at 17, C at 28; the loop answers A at 9, B at 10, C at 15
  t.eq(S.P08.events(reqs, 'serial').done, { A: 9, B: 17, C: 28 }, 'blocking, one thread: the hand-worked times');
  t.eq(S.P08.events(reqs, 'loop').done, { A: 9, B: 10, C: 15 }, 'event loop: the hand-worked times');
  t.eq(S.P08.events(reqs, 'threads', { sw: 0 }).done, S.P08.events(reqs, 'loop').done, 'with free switches, a thread per request on one core matches the loop');
  const r = rng(5);
  for (let k = 0; k < 60; k++) {
    const n = 1 + Math.floor(r() * 5), R = Array.from({ length: n }, (_, i) => ({ name: 'ABCDE'[i], at: Math.floor(r() * 6), cpu: 1 + Math.floor(r() * 4), io: Math.floor(r() * 9), cpu2: 1 + Math.floor(r() * 3) }));
    for (const m of ['serial', 'loop']) t.eq(S.P08.events(R, m).done, tick(R, m), 'random case ' + k + ', ' + m + ': the model agrees with a millisecond-by-millisecond run');
    t.eq(S.P08.events(R, 'threads', { sw: 0 }).done, tick(R, 'threads'), 'random case ' + k + ', threads: agrees');
    const m = S.P08.events(R, 'threads', { sw: 0 }), alive = Math.max(...R.map((q) => R.filter((x) => x.at <= q.at && m.done[x.name] > q.at).length));
    t.eq(m.maxThreads, alive, 'random case ' + k + ': threads alive at once');
  }
}

// ---- every topic: words, numbers, and the checks above on every frame ----
const randomInputs = {
  'classic-buffer-sem': (r) => ({ size: 1 + Math.floor(r() * 6), producers: 1 + Math.floor(r() * 3), consumers: 1 + Math.floor(r() * 3), seed: 1 + Math.floor(r() * 500), steps: 10 + Math.floor(r() * 40) }),
  'classic-rw': (r) => ({ variant: ['reader', 'writer', 'fair', 'lock-reader', 'lock-writer', 'lock-fair'][Math.floor(r() * 6)], readers: 1 + Math.floor(r() * 2), writers: 1, seed: 1 + Math.floor(r() * 500), steps: 20 }),
  'classic-phil-fixes': (r) => ({ variant: ['ordered', 'arbiter', 'naive'][Math.floor(r() * 3)], n: 2 + Math.floor(r() * 2), seed: 1 + Math.floor(r() * 500) }),
  'classic-chandy': (r) => ({ variant: 'correct', n: 3, seed: 1 + Math.floor(r() * 500), steps: 8 + Math.floor(r() * 30) }),
  'classic-events': (r) => { const n = 1 + Math.floor(r() * 5); return { reqs: Array.from({ length: n }, (_, i) => 'ABCDE'[i] + ' ' + Math.floor(r() * 5) + ' ' + (1 + Math.floor(r() * 3)) + ' ' + Math.floor(r() * 8) + ' ' + (1 + Math.floor(r() * 2))).join('; '), sw: Math.floor(r() * 3), stack: 64 }; },
};
const okInv = {
  'classic-rw': (st) => st.vars.W <= 1 && (st.vars.W === 0 || st.vars.R === 0),
  'classic-rw-starve': (st) => st.vars.W <= 1 && (st.vars.W === 0 || st.vars.R === 0),
};
const n = checkTopics(S, t, ['p08-'], {
  random: randomInputs, randomRuns: 3,
  extra(tp, input, r, label) {
    const where = tp.id + ' / ' + label;
    r.frames.forEach((f, i) => {
      const st = f.meta && f.meta.st;
      if (st && st.sem) { primitives(st, where + ' / frame ' + i); if (f.meta.prev) semStep(f.meta.prev, st, where + ' / frame ' + i); }
      if (st && okInv[tp.id]) t.ok(okInv[tp.id](st), where + ' / frame ' + i + ': a reader beside a writer');
      if (tp.id === 'classic-chandy' && st && st.phil) {
        st.phil.forEach((p, k) => { if (p.state === 'eating') { t.ok(st.phil[(k + 1) % st.phil.length].state !== 'eating', where + ' / frame ' + i + ': neighbours eat at once'); t.ok(st.forks.filter((fk) => fk.a === k || fk.b === k).every((fk) => fk.holder === k), where + ' / frame ' + i + ': an eater lacks a fork'); } });
      }
    });
    if (specOf[tp.id]) {
      const spec = specOf[tp.id](input), vf = r.frames.find((f) => f.meta && f.meta.verdict);
      if (vf) t.eq(vf.meta.verdict, expected(spec, tp.id + JSON.stringify(input)), where + ': the verdict shown');
      if (spec.expect === 'ok' && tp.id === 'classic-barber') r.frames.forEach((f, i) => { if (f.meta && f.meta.st) t.ok(f.meta.st.vars.free_seats >= 0 && f.meta.st.vars.free_seats <= input.seats, where + ' / frame ' + i + ': free_seats out of range'); });
    }
    if (tp.id === 'classic-events') {
      const last = r.frames[r.frames.length - 1], R = String(input.reqs).split(';').map((x) => x.trim().split(/\s+/)).map(([name, at, cpu, io, cpu2]) => ({ name, at: +at, cpu: +cpu, io: +io, cpu2: +cpu2 }));
      const fin = (m) => Math.max(...Object.values(tick(R, m)));
      for (const m of ['serial', 'loop']) t.ok(last.meta.vals.includes(fin(m)), where + ': the ' + m + ' finish time shown is the independent one (' + fin(m) + ')');
    }
  },
});
console.log('  (' + n + ' topics)');
t.done();
