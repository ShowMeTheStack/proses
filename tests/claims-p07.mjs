// Part 7 (synchronisation tools): every topic run with its default, every preset and random valid inputs. For
// every frame: the wording (a/an, doubled words, stray spaces, "1 threads"), and every number the narration quotes
// must be a value the frame carries from the engines (meta.vals and the rest of its meta) or an input. Then per
// topic the values themselves are checked against a second computation written here: the race by brute force over
// every schedule, Peterson and the locks by an independent search, semaphores and mutexes by a queue model.
// Prints "claims-p07 N passed, M failed". The shared machinery is exported for claims-p04 and claims-p08.
import { load, harness, rng } from './load.mjs';
import { fileURLToPath } from 'node:url';

// ---- wording ----
const vowelSound = (w) => {
  if (/^[A-Za-z]$/.test(w) || /^[A-Z][A-Z0-9²-]*$/.test(w)) return /^[AEFHILMNORSX]/.test(w.toUpperCase());
  if (/^\d/.test(w)) return /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
  if (/^(hour|honest|heir)/i.test(w)) return true;
  return /^[aeiou]/i.test(w) && !/^(one|once|uni|use|usu|eu|ur[ai])/i.test(w);
};
export function wording(say) {
  const s = String(say || '').replace(/`/g, '').replace(/"[^"]*"/g, '"…"'), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/\.\./.test(s.replace(/…/g, ''))) out.push('two full stops');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’])(a|an|A|An) ([\w²’'-]+)/g)) {
    const art = m[2].toLowerCase(), w = m[3], vowel = vowelSound(w);
    if (art === 'a' && vowel && !(m[2] === 'A' && /^[A-Z]$/.test(w))) out.push('"a ' + w + '"');
    if (art === 'an' && !vowel) out.push('"an ' + w + '"');
  }
  for (const m of s.matchAll(/(^|[^\w.])1 ([a-z]+s)\b/g)) if (!/^(is|was|has|does|goes|ends|holds|stays|waits|runs|sits|steps|sleeps|wakes|blocks|takes|gets|sees|loads|stores|starts|finishes|leaves|enters|joins|exits|returns|prints|plus|minus|less|times|ms|us|ns)$/.test(m[2])) out.push('"1 ' + m[2] + '"');
  if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
export function numbersOf(v, out = []) {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v); }
  else if (typeof v === 'string') { for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(+m[0]); }
  else if (Array.isArray(v)) { out.push(v.length); for (const x of v) numbersOf(x, out); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbersOf(v[k], out);
  return out;
}
/** the numbers quoted in a sentence: [text, value, decimals] (names such as T0, P1, x2, fork 2 kept apart by the caller) */
export function quoted(say) {
  const s = String(say || '').replace(/−/g, '-').replace(/`/g, ' '), out = [];
  for (const m of s.matchAll(/(^|[^\w.²³⁰¹⁴⁵⁶⁷⁸⁹_'’])(-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴⁵⁶⁷⁸⁹])/g)) {
    const t = m[2], d = t.includes('.') ? t.split('.')[1].length : 0;
    out.push([t + m[3], +t, d, !!m[3]]);
  }
  return out;
}
const matches = (tok, v) => { const [, x, d, pct] = tok, tol = 0.5 * Math.pow(10, -d) + 1e-9; return (pct ? [v * 100, v] : [v]).some((c) => Math.abs(c - x) <= tol); };
/** the quoted numbers of a sentence that match no allowed value; 0 and 1 pass ("1 step", "count = 0") */
export function untraced(say, allowed) {
  return quoted(say).filter((tok) => !(tok[2] === 0 && Math.abs(tok[1]) <= 1) && !allowed.some((v) => matches(tok, v))).map((t) => t[0]);
}

/** run every topic of the prefixes over its presets and random inputs; check each frame's words and numbers;
 *  each run is handed to extra(t, input, r, t) for the topic's own checks */
export function checkTopics(S, t, prefixes, o = {}) {
  const topics = S.topics.filter((x) => prefixes.some((p) => x.family.startsWith(p)));
  t.ok(topics.length > 0, 'topics found for ' + prefixes.join(', '));
  for (const tp of topics) {
    const inputs = [{ label: 'default', values: {} }].concat(tp.presets || []).map((p) => [p.label, S.inputOf(tp, Object.assign(S.inputOf(tp), p.values))]);
    const gen = o.random && o.random[tp.id];
    if (gen) { const r = rng(o.seed || 7); for (let k = 0; k < (o.randomRuns || 6); k++) { const v = gen(r, k); if (v && !S.checkInput(tp, v)) inputs.push(['random ' + k, v]); } }
    for (const [label, input] of inputs) {
      const res = S.run(tp, input);
      if (!res.ok) { t.ok(false, tp.id + ' / ' + label + ' crashed: ' + res.error); continue; }
      const inNums = numbersOf(input);
      res.frames.forEach((f, i) => {
        const where = tp.id + ' / ' + label + ' / frame ' + i;
        const w = wording(f.say);
        t.ok(!w.length, where + ': wording ' + w.join(', ') + ' in "' + f.say + '"');
        const allowed = numbersOf(f.meta || {}).concat(inNums, o.constants || [], (tp.constants || []));
        // names with digits are not quantities: T0, P1, fork 2, line 7, C1 …
        const said = String(f.say || '').replace(/\b(T|P|C|W|R|S|Q|H|O|A|B|L|F|fork|seat|slot|level|thread|process|pid|tid|core|CPU|smoker|philosopher|line|lines|step)\s?\d+/gi, (m0) => m0.replace(/\d+/g, 'n'));
        const bad = untraced(said, allowed);
        t.ok(!bad.length, where + ': untraced numbers ' + bad.join(', ') + ' in "' + f.say + '"');
      });
      if (o.extra) o.extra(tp, input, res, label);
    }
  }
  return topics.length;
}

// ---- independent checks of what the checker hands back (used by parts 7 and 8) ----
/** replay a schedule on a fresh machine, one step at a time, and say how it ends by our own reading of the state */
export function ownEnding(S, spec, sched) {
  const M = S.Sync.machine(spec);
  for (const c of sched) { if (!M.choices().includes(c)) return { ok: false, why: 'choice ' + c + ' is not enabled' }; M.step(c); }
  const blocked = M.threads.some((t) => t.state === 'blocked'), ready = M.choices().length > 0, failed = M.threads.some((t) => t.state === 'error');
  const broken = (spec.check.invariants || []).filter((iv) => !iv.holds(M)).map((iv) => iv.name);
  return { ok: true, deadlock: !ready && blocked && !failed, failed, broken, M };
}
/** a lasso is real: after the prefix, the cycle comes back to the same state, the thread never makes progress in it,
 *  and every thread enabled all along the cycle takes a step in it (weak fairness) */
export function ownLasso(S, spec, lasso, thread) {
  const M = S.Sync.machine(spec);
  for (const c of lasso.prefix) M.step(c);
  const h0 = M.hash(), owners = new Set();
  let always = null, progress = false;
  for (const c of lasso.cycle) {
    const en = new Set(M.choices().map((x) => M.runner(x)).filter((x) => x !== null));
    always = always ? new Set([...always].filter((x) => en.has(x))) : en;
    const st = M.step(c);
    if (st.tid === thread && st.mark === 'progress') progress = true;
    if (M.runner(c) !== null) owners.add(M.runner(c));
  }
  return { back: M.hash() === h0, progress, fair: [...(always || [])].every((x) => owners.has(x)) };
}

// ---- part 7's own checks ----
/** count++ as load, add, store: every final value over every interleaving, by brute force (n threads, k each) */
function raceFinals(n, k) {
  const out = new Set(), len = 3 * k;
  const go = (pc, reg, count) => {
    if (pc.every((p) => p === len)) { out.add(count); return; }
    for (let t = 0; t < n; t++) {
      if (pc[t] === len) continue;
      const p2 = pc.slice(), r2 = reg.slice(); let c2 = count;
      const ph = pc[t] % 3;
      if (ph === 0) r2[t] = count; else if (ph === 1) r2[t]++; else c2 = r2[t];
      p2[t]++; go(p2, r2, c2);
    }
  };
  go(Array(n).fill(0), Array(n).fill(0), 0);
  return [...out].sort((a, b) => a - b);
}
/** Peterson's algorithm by hand, for a given schedule of thread ids: flag, turn, and how many entries */
function petersonByHand(sched) {
  const flag = [0, 0], reg = [{}, {}], pc = [0, 0];
  let turn = 0, entries = 0;
  // 0 flag[i]=1, 1 turn=j, 2 f=flag[j], 3 t=turn, 4 while: back to 2 if f && t==j, 5 enter, 6 leave, 7 flag[i]=0
  for (const i of sched) {
    const j = 1 - i;
    switch (pc[i]) {
      case 0: flag[i] = 1; pc[i] = 1; break;
      case 1: turn = j; pc[i] = 2; break;
      case 2: reg[i].f = flag[j]; pc[i] = 3; break;
      case 3: reg[i].t = turn; pc[i] = 4; break;
      case 4: pc[i] = reg[i].f && reg[i].t === j ? 2 : 5; break;
      case 5: entries++; pc[i] = 6; break;
      case 6: pc[i] = 7; break;
      case 7: flag[i] = 0; pc[i] = 0; break;
    }
  }
  return { flag, turn, entries };
}
/** a semaphore by hand: wait takes one or queues, post hands to the first waiter or adds one (binary: at most 1) */
function semByHand(init, binary, events) {
  let v = init; const q = [], vals = [];
  for (const [op, tid] of events) {
    if (op === 'wait') { if (v > 0) v--; else q.push(tid); }
    else if (op === 'post') { if (q.length) q.shift(); else v = binary ? 1 : v + 1; }
    vals.push(v);
  }
  return vals;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const S = load(['core', 'stage', 'topics']);
  const t = harness('claims-p07');
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const random = {
    'sync-race-steps': (r) => { const n = r() < 0.5 ? 2 : 3, order = []; const left = Array(n).fill(3); while (left.some((x) => x)) { const c = pick(r, left.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)); left[c]--; order.push('T' + c); } return { threads: String(n), order }; },
    'sync-peterson': (r) => ({ seed: 1 + Math.floor(r() * 500), quantum: 1 + Math.floor(r() * 6), steps: 10 + Math.floor(r() * 50) }),
    'sync-atomic-ops': (r) => ({ op: pick(r, ['tas', 'cas', 'faa']), threads: 2 + Math.floor(r() * 2), how: pick(r, ['atomic', 'split']) }),
    'sync-spinlock': (r) => ({ kind: pick(r, ['tas', 'cas', 'ticket']), threads: 2, seed: 1 + Math.floor(r() * 500), steps: 10 + Math.floor(r() * 40) }),
    'sync-mcs': (r) => ({ threads: 2 + Math.floor(r() * 2), seed: 1 + Math.floor(r() * 500), steps: 12 + Math.floor(r() * 50) }),
    'sync-mutex': (r) => ({ kind: pick(r, ['mutex', 'spin']), threads: 2 + Math.floor(r() * 4), inside: 1 + Math.floor(r() * 5), quantum: 1 + Math.floor(r() * 8) }),
    'sync-semaphore': (r) => ({ use: pick(r, ['pool', 'signal']), k: 1 + Math.floor(r() * 3), threads: 2 + Math.floor(r() * 4), binary: pick(r, ['counting', 'binary']), seed: 1 + Math.floor(r() * 500) }),
    'sync-condvar': (r) => ({ scene: pick(r, ['gate', 'tickets']), wake: pick(r, ['signal', 'broadcast']), test: pick(r, ['while', 'if']), n: 2 }),
    'sync-struct-list': (r) => ({ variant: pick(r, ['coarse', 'hoh', 'hoh-broken']), work: pick(r, ['a', 'b', 'c']), seed: 1 + Math.floor(r() * 500) }),
    'sync-struct-hash': (r) => ({ variant: pick(r, ['coarse', 'bucket']), buckets: 2 + Math.floor(r() * 3), work: pick(r, ['a', 'b', 'c']), seed: 1 + Math.floor(r() * 500) }),
    'sync-struct-counter': (r) => ({ variant: pick(r, ['lock', 'sloppy', 'faa']), thresh: 2 + Math.floor(r() * 3), ops: 2 + Math.floor(r() * 3) }),
  };
  const last = (r) => r.frames[r.frames.length - 1];
  const extra = (tp, inp, r, label) => {
    const at = tp.id + ' / ' + label;
    if (tp.id === 'sync-race-steps') {
      const n = +inp.threads, reg = Array(n).fill(0), ph = Array(n).fill(0); let c = 0;
      for (const nm of inp.order) { const i = +nm.slice(1); if (ph[i] === 0) reg[i] = c; else if (ph[i] === 1) reg[i]++; else c = reg[i]; ph[i]++; }
      t.eq(last(r).meta.fin, c, at + ': the final count, by hand');
    }
    if (tp.id === 'sync-race-tree' && inp.prog === 'race') {
      const f = r.frames.find((x) => x.meta.total);
      t.eq(f.meta.total, 20, at + ': 6!/(3!3!) = 20 schedules');
      t.eq(f.meta.vals[1], 2, at + ': exactly 2 schedules count to 2');
    }
    if (tp.id === 'sync-race-c') {
      const f = r.frames.find((x) => x.meta.values);
      const want = inp.lock === 'mutex' ? [+inp.threads * +inp.iters] : raceFinals(+inp.threads, +inp.iters);
      t.eq(f.meta.values, want, at + ': every output, by brute force over load/add/store interleavings');
      const p = last(r).meta.printed;
      if (p !== undefined) t.ok(want.includes(p) && p < f.meta.want, at + ': the replayed schedule prints a wrong value that is possible');
    }
    if (tp.id === 'sync-peterson') {
      const run = S.Sync.run(S.Sync.peterson('correct'), { policy: 'random', seed: inp.seed, quantum: inp.quantum, max: inp.steps });
      const own = petersonByHand(run.steps.map((s) => s.tid));
      t.eq([own.flag, own.turn], [run.machine.vars.flag, run.machine.vars.turn], at + ': flag and turn, by hand');
      t.eq(last(r).counters.entries, own.entries, at + ': entries, by hand');
    }
    if (tp.id === 'sync-atomic-ops') {
      const f = r.frames.find((x) => x.meta.violated !== undefined);
      // by hand: atomic never breaks; split always can (two threads both load before either stores)
      t.eq(f.meta.violated, inp.how === 'split', at + ': split breaks, atomic holds');
    }
    if (tp.id === 'sync-mutex') {
      const m = last(r).meta;
      t.eq(m.T - m.wasted, m.n * m.rounds * m.progLen, at + ': useful steps = threads × rounds × program length');
      if (inp.kind === 'mutex') t.eq(m.wasted, 0, at + ': a mutex wastes no step');
    }
    if (tp.id === 'sync-semaphore') {
      const pool = inp.use === 'pool';
      const steps = r.frames.slice(1, -1);
      const init = r.frames[0].counters.value;
      const ev = [];
      // the engine's step records carry the op; rebuild them from the same run
      const sp = pool ? S.Sync.run({ threads: Array.from({ length: inp.threads }, (_, i) => ({ name: 'T' + i, loop: true, iters: 2, prog: [{ op: 'wait', s: 's' }, { op: 'update', v: 'inside', by: 1 }, { op: 'work' }, { op: 'update', v: 'inside', by: -1 }, { op: 'post', s: 's' }, { op: 'think' }] })), sems: [{ id: 's', init: inp.k }], vars: { inside: 0 } }, { policy: 'random', seed: inp.seed, quantum: 2, max: 60 }) : null;
      if (pool) {
        for (const s of sp.steps) ev.push([s.op, s.tid]);
        const own = semByHand(inp.k, false, ev);
        t.eq(steps.map((f) => f.counters.value), own, at + ': the value after every step, by a queue model');
        t.eq(init, inp.k, at + ': starts at k');
      }
    }
    if (tp.id === 'sync-struct-list' || tp.id === 'sync-struct-hash') {
      const f = last(r);
      const W = tp.id === 'sync-struct-list' ? { a: [[10, 30], [['i', 20], ['d', 10]]], b: [[10, 20, 30], [['i', 25], ['d', 20]]], c: [[10, 20, 30, 40], [['i', 15], ['i', 35]]] } : { a: [[1, 3], [['i', 2], ['i', 4], ['d', 3]]], b: [[5], [['i', 3], ['i', 7]]], c: [[2, 4, 9], [['i', 6], ['d', 2], ['i', 7], ['i', 5]]] };
      const [init, ops] = W[inp.work], set = new Set(init);
      for (const [o, k] of ops) if (o === 'i') set.add(k); else set.delete(k);
      const want = [...set].sort((a, b) => a - b);
      if (!f.meta.violated) t.eq(f.meta.final, want, at + ': the final contents, by set arithmetic');
      else t.ok(JSON.stringify(f.meta.final) !== JSON.stringify(want), at + ': the broken run really lost something');
    }
    if (tp.id === 'sync-struct-counter') {
      const m = last(r).meta;
      t.eq(m.global, m.total, at + ': the counter is exact at the end');
      const f0 = r.frames[0].meta;
      t.eq(f0.runTotal, 2 * inp.ops, at + ': frame 0 names the stepped run\'s own total');
      t.ok(m.curves.lock.every((p) => p.ops === p.n * f0.per), at + ': the per-thread count quoted for the curves is the measured one');
      t.ok(r.frames.slice(1).every((f) => !/12 increments/.test(f.say) || f0.per === 12), at + ': no stale count of increments');
      if (inp.variant === 'sloppy') {
        t.ok(m.maxLocal <= m.thresh, at + ': no thread held more than S increments (' + m.maxLocal + ' ≤ ' + m.thresh + ')');
        t.ok(m.maxLag <= 2 * m.thresh, at + ': the total lag stayed within S × threads (' + m.maxLag + ' ≤ ' + 2 * m.thresh + ')');
        // by hand: the lag at every frame is the true total minus global, and never above S × threads
        for (const f of r.frames) if (f.counters && f.counters.lag !== undefined) t.ok(f.counters.lag <= 2 * m.thresh, at + ': lag ' + f.counters.lag + ' within the bound');
      }
      const faa = m.curves.faa;
      t.ok(faa.every((p) => Math.abs(p.throughput - p.n * faa[0].throughput) < 1e-9), at + ': fetch-and-add scales linearly on the ideal machine');
      t.ok(m.curves.lock[3].throughput / m.curves.lock[0].throughput < 2, at + ': one lock does not scale');
    }
    if (tp.id === 'sync-checker-search') {
      const m = last(r).meta;
      t.eq(m.verdicts[0] === 'violation', m.verdicts[1] === 'violation', at + ': reduction does not change the verdict');
      t.eq(m.verdicts[1] === 'violation' ? 'bad' : 'ok', m.expect === 'ok' ? 'ok' : 'bad', at + ': the verdict the catalogue expects');
      if (m.verdicts[0] === 'ok') t.ok(m.por.transitions <= m.full.transitions, at + ': reduction never adds work on a full search');
    }
    if (tp.id === 'sync-checker-bounds') {
      const b = last(r).meta.bounds;
      t.ok(b.slice(0, -1).every((x) => x.verdict !== 'violation'), at + ': no smaller bound found it');
    }
  };
  const n = checkTopics(S, t, ['p07-'], { random, extra, randomRuns: 5 });
  // every program the topics check: the counterexamples and lassos replayed and judged by our own reading
  const specs = S.Sync.catalog.filter((c) => !c.system).map((c) => [c.id, c.build()]);
  for (const sc of ['gate', 'tickets']) for (const w of ['signal', 'broadcast']) for (const te of ['while', 'if']) specs.push(['cv ' + sc + ' ' + w + ' ' + te, S.P07.cvSpec(sc, w, te, 2)]);
  for (const te of ['if', 'while']) for (const h of [false, true]) specs.push(['bank ' + te + (h ? ' hoare' : ''), S.P07.bankSpec(te, h)]);
  for (const k of ['mutex', 'spin']) specs.push(['lock ' + k, S.P07.lockSpec(k, 3, 2, 1)]);
  for (const [id, spec] of specs) {
    const c = S.P07.check(spec);
    if (c.res.safety.violation) {
      const v = c.res.safety.violation, own = ownEnding(S, spec, v.schedule);
      t.ok(own.ok, id + ': the failing schedule replays');
      if (v.kind === 'deadlock') t.ok(own.deadlock, id + ': nothing can run and someone is blocked');
      if (v.kind === 'assert') t.ok(own.failed, id + ': a thread failed its assertion');
      if (v.kind === 'invariant') t.ok(own.broken.includes(v.name), id + ': the invariant is broken at the end of the schedule');
      if (spec.expect) t.eq(v.kind, spec.expect, id + ': the failure the catalogue expects');
    } else {
      if (spec.expect) t.ok(spec.expect === 'ok', id + ': clean, as the catalogue expects');
      if (c.lasso) {
        const own = ownLasso(S, spec, c.lasso.lasso, c.lasso.lasso && spec.check.liveness.find((x) => x.name === c.lasso.name).thread);
        if (c.lasso.kind === 'starve') { t.ok(own.back, id + ': the cycle returns to its start'); t.ok(!own.progress, id + ': no progress inside the cycle'); t.ok(own.fair, id + ': the cycle is weakly fair'); }
      }
      if (spec.expectLive) t.eq(c.lasso ? 'starve' : 'ok', spec.expectLive, id + ': the liveness the catalogue expects');
    }
  }
  console.log('  (' + n + ' topics, ' + specs.length + ' programs replayed)');
  t.done();
}
