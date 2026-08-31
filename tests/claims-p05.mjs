// Part 5 (CPU scheduling): every topic run with its default, every preset and random valid inputs. For every frame:
// the wording (a/an, doubled words, stray spaces, "1 ticks"), and every number the narration quotes must be a value
// the frame carries from the engine (its meta), an input, or a named constant. Frames narrated by the engine's own
// sentence must carry that sentence. Then per topic the values are checked against independent computations here:
// small schedulers written again from their rules, the metrics from the segments, the formulas worked by hand.
// Prints "claims-p05 N passed, M failed". The machinery is exported for tests/claims-p06.mjs.
import { pathToFileURL } from 'node:url';
import { load, harness, rng } from './load.mjs';

// ---- wording ----
const vowelSound = (w) => {
  if (/^[A-Za-z]$/.test(w) || /^[A-Z][A-Z0-9]*$/.test(w)) return /^[AEFHILMNORSX]/.test(w.toUpperCase());
  if (/^\d/.test(w)) return /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
  if (/^(hour|honest)/i.test(w)) return true;
  return /^[aeiou]/i.test(w) && !/^(one|once|uni|use|usu|util|eu|ur[ai])/i.test(w);
};
export function wording(say, names) {
  const s = String(say || ''), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/\.\./.test(s.replace(/…/g, ''))) out.push('two full stops');
  if (/`/.test(s)) out.push('a backtick');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’])(a|an|A|An) ([\w’'-]+)/g)) {
    if (m[2] === 'A' && names && names.has('A')) continue;
    const art = m[2].toLowerCase(), w = m[3], v = vowelSound(w);
    if (art === 'a' && v && !(m[2] === 'A' && /^[A-Z]$/.test(w))) out.push('"a ' + w + '"');
    if (art === 'an' && !v) out.push('"an ' + w + '"');
  }
  for (const m of s.matchAll(/(^|[^\d.,])1 (ticks|jobs|tasks|cores|deadlines|times|moves|draws|bursts|processes|core-ticks|job-ticks)\b/g)) out.push('"1 ' + m[2] + '"');
  for (const m of s.matchAll(/(^|[^\d.])([02-9]|\d{2,}) (tick|job|task|core|deadline|time|move|draw|burst)\b(?![-'’])/g)) if (!/^(tick|time) (of|is|on|to|at)$/.test(m[3] + ' ' + (s.slice(m.index + m[0].length).trim().split(' ')[0] || ''))) out.push('"' + m[2] + ' ' + m[3] + '"');
  if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
export function numbersOf(v, out = [], seen = new Set()) {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v); }
  else if (Array.isArray(v)) { out.push(v.length); for (const x of v) numbersOf(x, out, seen); }
  else if (v && typeof v === 'object') { if (seen.has(v)) return out; seen.add(v); for (const k of Object.keys(v)) if (k !== 'say' && k !== 'why') numbersOf(v[k], out, seen); }
  else if (typeof v === 'string') for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(+m[0]);
  return out;
}
/** the numbers a sentence quotes (names such as Q1, A2, p3, c0, τ₀ are not numbers) */
export function quoted(say) {
  const s = String(say || '').replace(/−/g, '-'), out = [];
  for (const m of s.matchAll(/(^|[^\w.⁰¹²³⁴⁵⁶⁷⁸⁹ₖ_])(-?\d+(?:\.\d+)?)(%?)(?![\w⁰¹²³⁴⁵⁶⁷⁸⁹])/g)) {
    if (/[A-Za-z]$/.test(m[1])) continue;
    const t = m[2];
    out.push([t + m[3], +t, t.includes('.') ? t.split('.')[1].length : 0, !!m[3]]);
  }
  return out;
}
const matches = (tok, v) => { const [, x, d, pct] = tok, tol = 0.5 * Math.pow(10, -d) + 1e-9 * Math.max(1, Math.abs(x)); return (pct ? [v * 100, v] : [v, v * 100]).some((c) => Math.abs(c - x) <= tol || Math.abs(Math.abs(c) - Math.abs(x)) <= tol); };
export const untraced = (say, allowed) => quoted(say).filter((tok) => !(tok[2] === 0 && Math.abs(tok[1]) <= 1) && !allowed.some((v) => matches(tok, v))).map((t) => t[0]);
export const close = (a, b, tol = 1e-6) => {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => close(a[i], v, tol));
  if (b && typeof b === 'object') return a && typeof a === 'object' && Object.keys(b).every((k) => close(a[k], b[k], tol));
  if (typeof b === 'string') return a === b;
  if (b === null || b === undefined) return a === null || a === undefined;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
};
const clean = (say) => String(say || '').replace(/`/g, '');

/**
 * Run the claims of the topics whose family matches `family`: CHECKS[id] = { constants, random(rnd) -> values,
 * nRandom, check(ctx) } with ctx = { S, t, input, r, near(got, want, what, tol), ok(cond, what), frame(phase),
 * frames(phase) }.
 */
export function runClaims(name, family, CHECKS) {
  const S = load(['core', 'stage', 'topics']);
  const t0 = harness(name), only = process.argv.slice(2), rnd = rng(20261019);
  let runs = 0;
  for (const t of S.topics) {
    if (!family.test(t.family)) continue;
    if (only.length && !only.some((o) => t.id.startsWith(o))) continue;
    const C = CHECKS[t.id];
    if (!C) { t0.ok(false, t.id + ': no claims check is written for this topic'); continue; }
    const inputs = [{}].concat((t.presets || []).map((p) => p.values));
    const nFixed = inputs.length;
    if (C.random) for (let k = 0; k < (C.nRandom || 8); k++) inputs.push(C.random(rnd, S));
    inputs.forEach((v, vi) => {
      const input = S.inputOf(t, Object.assign(S.inputOf(t), v));
      const err = S.checkInput(t, input);
      if (err) { if (vi < nFixed) t0.ok(false, t.id + ' ' + JSON.stringify(v) + ': its input is refused: ' + err); return; }
      const tag = t.id + ' ' + JSON.stringify(v).slice(0, 80);
      const r = S.run(t, input);
      runs++;
      if (!r.ok) { t0.ok(false, tag + ': ' + r.error); return; }
      const consts = (C.constants || []).concat(numbersOf(input));
      const names = new Set();
      for (const x of Object.values(input)) if (typeof x === 'string') for (const mm of x.matchAll(/^\s*([A-Za-z][A-Za-z0-9]{0,2})\b/gm)) names.add(mm[1]);
      r.frames.forEach((f, i) => {
        for (const w of wording(f.say, names)) t0.ok(false, tag + ' frame ' + i + ': ' + w + ': ' + f.say);
        if (f.predict) for (const w of wording(typeof f.predict.ask === 'string' ? f.predict.ask : '')) t0.ok(false, tag + ' frame ' + i + ' prediction: ' + w);
        const m = f.meta || {};
        // a frame narrated by the engine's own sentence carries exactly that sentence
        // a topic may add a sentence after the engine's (the CFS tree's rebalancing): the engine's comes first
        const engine = !!(m.step && m.step.say && f.say.startsWith(clean(m.step.say)));
        if (engine && f.say !== clean(m.step.say)) { const extra = f.say.slice(clean(m.step.say).length), bad = untraced(extra, numbersOf(m).concat(consts)); t0.ok(!bad.length, tag + ' frame ' + i + ': the added sentence quotes ' + bad.join(', ') + ': ' + extra); }
        if (m.step && m.step.say && m.phase !== 'end' && m.phase !== 'compare') t0.ok(engine, tag + ' frame ' + i + ': the narration is not the engine\'s sentence for t = ' + m.step.t);
        // the engine's own sentences quote its state by construction; the topic's own sentences must quote the frame
        if (!engine) {
          const allowed = numbersOf(m).concat(consts, C.extra ? C.extra(m, input, S) : []);
          const bad = untraced(f.say, allowed);
          t0.ok(!bad.length, tag + ' frame ' + i + ': the narration quotes ' + bad.join(', ') + ', which the frame does not carry: ' + f.say);
        }
        t0.ok(f.items.length > 0, tag + ' frame ' + i + ': nothing drawn');
      });
      const ctx = {
        S, t, input, r, tag,
        near: (got, want, what, tol) => t0.ok(close(got, want, tol === undefined ? 1e-6 : tol), tag + ': ' + what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)),
        ok: (c, what) => t0.ok(!!c, tag + ': ' + what),
        frame: (phase) => r.frames.find((f) => f.meta && f.meta.phase === phase),
        frames: (phase) => r.frames.filter((f) => f.meta && f.meta.phase === phase),
      };
      try { C.check(ctx); } catch (e) { t0.ok(false, tag + ': the check fails: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    });
  }
  console.log('  (' + runs + ' runs)');
  t0.done();
}

// ---------------------------------------------------------------------------------------------------------------
// Independent schedulers, written again from the rules in sch-a-work.js and sch-b-policies.js, for CPU-only
// workloads with free switches: the ready queue in the order jobs joined it (arrivals in name order, then a job sent
// back), the best by the policy's measure, ties to the one ahead in the queue; preemption only when strictly better.
// ---------------------------------------------------------------------------------------------------------------
export function simulate(work, policy, q) {
  const J = work.map((j, i) => ({ id: j.id, i, arrive: j.arrive, left: j.bursts[0], prio: j.prio || 0, done: null, first: null }));
  const queue = [], perTick = [];
  let run = null, slice = 0;
  for (let t = 0; t < 5000; t++) {
    let back = null;
    if (run && run.left === 0) { run.done = t; run = null; }
    else if (run && policy === 'rr' && slice >= q) { back = run; run = null; }
    for (const j of J) if (j.arrive === t) queue.push(j);
    if (back) { if (queue.length) queue.push(back); else { run = back; slice = 0; } }
    const key = policy === 'sjf' || policy === 'srtn' ? (j) => j.left : policy === 'prio' ? (j) => j.prio : null;
    const best = () => { let b = queue[0]; if (key) for (const j of queue) if (key(j) < key(b)) b = j; return b; };
    if (run && queue.length && (policy === 'srtn' || policy === 'prio-pre')) {
      const b = best();
      if (key(b) < key(run)) { queue.push(run); queue.splice(queue.indexOf(b), 1); run = b; slice = 0; }
    }
    if (!run && queue.length) { const b = best(); queue.splice(queue.indexOf(b), 1); run = b; slice = 0; }
    if (J.every((j) => j.done !== null)) return { end: t, perTick, J };
    perTick.push(run ? run.id : null);
    if (run) { if (run.first === null) run.first = t; run.left--; slice++; }
  }
  throw new Error('no end');
}
/** metrics from segments alone: finish = end of the job's last segment, first = start of its first */
export function metricsFromSegs(tr) {
  const out = {};
  for (const j of tr.jobs) {
    const ss = tr.segs.filter((s) => s.job === j.id && !s.cs && !s.warm);
    const ran = ss.reduce((a, s) => a + s.end - s.start, 0), finish = Math.max(...ss.map((s) => s.end)), first = Math.min(...ss.map((s) => s.start));
    out[j.id] = { ran, finish, first, turnaround: finish - j.arrive, waiting: finish - j.arrive - j.cpu - j.io, response: first - j.arrive };
  }
  return out;
}
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
/** a random workload as text: n jobs, CPU only or with I/O, with prio/tickets/nice options */
export function randomWork(rnd, o = {}) {
  const n = int(rnd, 2, o.max || 5), lines = [];
  let cpu = 0;
  for (let i = 0; i < n; i++) {
    const io = o.io && rnd() < 0.4, b = [];
    const k = io ? 3 : 1;
    for (let q = 0; q < k; q++) b.push(q % 2 ? '(' + int(rnd, 1, 5) + ')' : String(int(rnd, 1, o.maxBurst || 8)));
    cpu += b.filter((x) => !x.startsWith('(')).reduce((a, x) => a + +x, 0);
    let line = String.fromCharCode(65 + i) + ' ' + int(rnd, 0, o.spread || 8) + ' ' + b.join(' ');
    if (o.prio) line += ' prio=' + int(rnd, 0, 5);
    if (o.tickets) line += ' tickets=' + pick(rnd, [50, 100, 150, 200, 300]);
    if (o.nice) line += ' nice=' + int(rnd, -5, 5);
    if (o.cls) line += ' cls=' + int(rnd, 0, 2);
    lines.push(line);
  }
  return lines.join('\n');
}
let rebalances = 0, recalls = 0;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const parse = (S, text, o) => S.P05.parseWork(text, o).jobs;
const noIo = (jobs) => jobs.every((j) => j.bursts.length === 1);

/** the checks every single-CPU topic shares: segments against metrics, tables against rows */
function common(ctx, tr) {
  const m = metricsFromSegs(tr);
  for (const r of tr.metrics.rows) {
    const j = tr.jobs.find((x) => x.id === r.id);
    ctx.near(m[r.id].ran, j.cpu, r.id + ' runs exactly its CPU');
    ctx.near([m[r.id].turnaround, m[r.id].waiting, m[r.id].response], [r.turnaround, r.waiting, r.response], r.id + "'s metrics from the chart");
  }
  ctx.near(tr.metrics.avg.waiting, avg(tr.metrics.rows.map((r) => r.waiting)), 'average waiting');
}
const endTrace = (ctx) => {
  const e = ctx.frame('end');
  return e && e.meta.metrics ? e.meta : null;
};
/** a topic's single-CPU trace, rebuilt from its frames: the end frame's metrics with the steps of its tick frames */
function sameAsSim(ctx, work, policy, q, metrics) {
  if (!noIo(work)) return;
  const sim = simulate(work, policy, q);
  for (const r of metrics.rows) {
    const j = sim.J.find((x) => x.id === r.id);
    ctx.near([r.finish, r.response], [j.done, j.first - j.arrive], `${r.id} finishes and first runs as an independent ${policy} would have it`);
  }
}

export const P05 = {
  'sch-bursts': {
    random: (rnd) => ({ work: randomWork(rnd, { io: true }), pol: pick(rnd, ['fcfs', 'sjf', 'srtn', 'rr']) }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work);
      const tr = input.pol === 'rr' ? S.Sched.run(work, 'rr', { quantum: 2 }) : S.Sched.run(work, input.pol);
      common(ctx, tr);
      for (const f of frames('tick')) {
        const T = f.meta.tally;
        // at tick t every job that has arrived and not finished was running, ready or in I/O for each tick before t
        for (const j of tr.jobs) { const r = tr.metrics.rows.find((x) => x.id === j.id), live = Math.max(0, Math.min(f.meta.t, r.finish) - Math.min(j.arrive, f.meta.t)); ctx.near(T[j.id].run + T[j.id].ready + T[j.id].io, live, `${j.id}'s ticks add up at t = ${f.meta.t}`); }
      }
      const e = ctx.frame('end');
      let ov = 0;
      for (let t = 0; t < tr.end; t++) if (tr.steps[t].run && (tr.steps[t].io || []).length) ov++;
      ctx.near([e.meta.overlap, e.meta.busy], [ov, work.reduce((a, j) => a + j.bursts.filter((_, k) => k % 2 === 0).reduce((x, y) => x + y, 0), 0)], 'overlap and busy ticks');
    },
  },
  'sch-metrics': {
    random: (rnd) => ({ work: randomWork(rnd, { io: true, prio: true }), pol: pick(rnd, ['fcfs', 'sjf', 'srtn', 'rr', 'prio']) }),
    check(ctx) {
      const { frames, frame } = ctx;
      for (const f of frames('job')) { const r = f.meta.row; ctx.near([r.turnaround, r.waiting, r.response], [r.finish - r.arrive, r.finish - r.arrive - f.meta.cpu - f.meta.io, f.meta.first - r.arrive], r.id + ' worked by hand'); }
      const m = frame('whole').meta.metrics;
      ctx.near([m.throughput, m.util], [m.rows.length / m.end, m.busy / m.end], 'throughput and utilisation');
      const sums = frame('sums').meta.metrics;
      ctx.near(sums.sum.turnaround, sums.rows.reduce((a, r) => a + r.turnaround, 0), 'the sum of turnarounds');
    },
  },
  'sch-fcfs': {
    random: (rnd) => ({ work: randomWork(rnd, { io: rnd() < 0.5 }), cs: pick(rnd, [0, 0, 1]) }),
    check(ctx) {
      const { S, input, frame, frames } = ctx, work = parse(S, input.work), tr = S.Sched.run(work, 'fcfs', { cs: input.cs });
      common(ctx, tr);
      if (!input.cs) sameAsSim(ctx, work, 'fcfs', 0, tr.metrics);
      // FCFS never preempts: every CPU burst runs in one piece (switch time aside)
      for (const j of tr.jobs) ctx.near(tr.segs.filter((x) => x.job === j.id && !x.cs).length, (j.bursts.length + 1) / 2, j.id + ' runs each burst in one piece');
      const c = frame('compare').meta, sjf = S.Sched.run(work, 'sjf', { cs: input.cs });
      ctx.near([c.fcfs, c.sjf], [avg(tr.metrics.rows.map((r) => r.waiting)), avg(sjf.metrics.rows.map((r) => r.waiting))], 'the averages compared');
    },
  },
  'sch-sjf': {
    random: (rnd) => ({ work: randomWork(rnd, { io: rnd() < 0.4 }), cs: 0 }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.run(work, 'sjf', { cs: input.cs });
      common(ctx, tr);
      if (!input.cs) sameAsSim(ctx, work, 'sjf', 0, tr.metrics);
      for (const f of frames('tick')) {
        const nx = f.meta.next;
        if (f.meta.decision === 'dispatch' && Object.keys(nx).length) {
          // the job dispatched had a burst no longer than any job still waiting
          const left = S.P05.leftAt(tr, f.meta.run, f.meta.t)[0];
          ctx.ok(Object.values(nx).every((v) => left <= v), `at t = ${f.meta.t} ${f.meta.run} (${left}) is the shortest`);
        }
      }
    },
  },
  'sch-srtn': {
    random: (rnd) => ({ work: randomWork(rnd, { io: rnd() < 0.3 }), cs: pick(rnd, [0, 0, 1]) }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.run(work, 'srtn', { cs: input.cs });
      common(ctx, tr);
      if (!input.cs) sameAsSim(ctx, work, 'srtn', 0, tr.metrics);
      for (const f of frames('tick')) if (f.meta.run && !f.meta.step.cs) { const l = f.meta.left; ctx.ok(Object.values(l).every((v) => l[f.meta.run] <= v), `at t = ${f.meta.t} the running job has the least left`); }
    },
  },
  'sch-predict': {
    random: (rnd) => ({ bursts: Array.from({ length: int(rnd, 2, 10) }, () => String(int(rnd, 1, 20))), alpha: pick(rnd, [0, 0.125, 0.25, 0.5, 0.75, 1]), tau0: int(rnd, 1, 20) }),
    check(ctx) {
      const { input, frames, frame } = ctx;
      let tau = input.tau0;
      const bs = input.bursts.map(Number), fs = frames('burst');
      ctx.near(fs.length, bs.length, 'one frame per burst');
      fs.forEach((f, k) => {
        const p = f.meta.p, next = input.alpha * bs[k] + (1 - input.alpha) * tau;
        ctx.near([p.predicted, p.actual, p.next], [Math.round(tau * 100) / 100, bs[k], Math.round(next * 100) / 100], 'burst ' + (k + 1) + ' by hand', 1e-9);
        tau = next;
      });
      let tau2 = input.tau0, err = 0;
      for (const b of bs) { err += Math.abs(b - Math.round(tau2 * 100) / 100); tau2 = input.alpha * b + (1 - input.alpha) * tau2; }
      ctx.near(frame('end').meta.err, err / bs.length, 'the mean error', 1e-6);
    },
  },
  'sch-prio': {
    random: (rnd) => ({ work: randomWork(rnd, { prio: true, io: rnd() < 0.3 }), pre: pick(rnd, ['yes', 'no']), age: pick(rnd, [0, 0, 2, 3, 5]) }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.run(work, 'prio', { preemptive: input.pre === 'yes', age: input.age });
      common(ctx, tr);
      if (!input.age && input.pre === 'no') sameAsSim(ctx, work.map((j) => Object.assign({}, j, { prio: j.prio || 0 })), 'prio', 0, tr.metrics);
      // the job dispatched is at least as urgent, by its aged priority, as every job left waiting
      for (const f of frames('tick')) if (['dispatch', 'preempt'].includes(f.meta.decision)) ctx.ok(Object.values(f.meta.eff).every((v) => f.meta.runPrio <= v), `at t = ${f.meta.t} ${f.meta.run} (${f.meta.runPrio}) is the most urgent`);
      for (const f of frames('tick')) for (const [id, v] of Object.entries(f.meta.eff)) ctx.near(v, Math.max(Math.min(0, f.meta.prio[id]), input.age ? f.meta.prio[id] - Math.floor(f.meta.waited[id] / input.age) : f.meta.prio[id]), `${id}'s aged priority at t = ${f.meta.t}`);
    },
  },
  'sch-rr': {
    random: (rnd) => ({ work: randomWork(rnd, { io: rnd() < 0.3 }), q: int(rnd, 1, 5), cs: pick(rnd, [0, 0, 1]) }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.run(work, 'rr', { quantum: input.q, cs: input.cs });
      common(ctx, tr);
      if (!input.cs) sameAsSim(ctx, work, 'rr', input.q, tr.metrics);
      for (const f of frames('tick')) ctx.ok(f.meta.used >= 0 && f.meta.used < input.q, `the quantum used at t = ${f.meta.t} is under q`);
      for (const s of tr.segs) if (!s.cs) ctx.ok(s.end - s.start <= input.q || tr.steps.slice(s.start, s.end).some((x) => x.decision === 'renew'), `no run of ${s.job} longer than the quantum without a renewal`);
    },
  },
  'sch-quantum': {
    random: (rnd) => ({ work: randomWork(rnd, {}), cs: int(rnd, 0, 2), qmax: int(rnd, 3, 10) }),
    check(ctx) {
      const { S, input, frames, frame } = ctx, work = parse(S, input.work);
      for (const f of frames('q')) {
        const p = f.meta.p, tr = S.Sched.run(work, 'rr', { quantum: p.q, cs: input.cs });
        ctx.near([p.T, p.W, p.R], [avg(tr.metrics.rows.map((r) => r.turnaround)), avg(tr.metrics.rows.map((r) => r.waiting)), avg(tr.metrics.rows.map((r) => r.response))], 'q = ' + p.q + ' averages');
        ctx.near(p.over, tr.segs.filter((x) => x.cs).reduce((a, x) => a + x.end - x.start, 0), 'q = ' + p.q + ' switching ticks from the chart');
        ctx.near(p.sw, tr.segs.filter((x) => !x.cs).reduce((a, x, i, arr) => a + (i && x.job !== arr[i - 1].job ? 1 : 0), 0), 'q = ' + p.q + ' switches from the chart');
        if (!input.cs) { const sim = simulate(work, 'rr', p.q); ctx.near(p.T, avg(sim.J.map((j) => j.done - j.arrive)), 'q = ' + p.q + ' against an independent round robin'); }
      }
      const b = frame('best').meta;
      ctx.near(b.bestT.T, Math.min(...frames('q').map((f) => f.meta.p.T)), 'the best turnaround');
      ctx.near(b.longest, Math.max(...work.map((j) => j.bursts[0])), 'the longest burst');
    },
  },
  'sch-mlq': {
    random: (rnd) => ({ work: randomWork(rnd, { cls: true, io: rnd() < 0.4 }), mode: pick(rnd, ['strict', 'share']), shares: [String(int(rnd, 1, 6)), String(int(rnd, 1, 6)), String(int(rnd, 1, 6))], window: int(rnd, 3, 12) }),
    extra: (m) => (m.full ? m.full : []),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.mlq(work, { mode: input.mode, shares: input.shares.map(Number), window: input.window });
      common(ctx, tr);
      for (const f of frames('tick')) {
        const st = f.meta.step;
        if (input.mode === 'strict' && st.run) ctx.ok(st.queues.every((q, k) => !q.length || k >= st.cls), `strict: nothing more important waits at t = ${st.t}`);
      }
      if (input.mode === 'share') { const b = tr.params.budgets; ctx.near(b.reduce((a, x) => a + x, 0), Math.max(3, input.window), 'budgets add up to the window'); }
    },
  },
  'sch-mlfq': {
    random: (rnd) => ({ work: randomWork(rnd, { io: true }), levels: int(rnd, 2, 4), q: int(rnd, 1, 3), allot: int(rnd, 2, 8), boost: pick(rnd, [0, 10, 20]) }),
    check(ctx) {
      const { S, input, frames } = ctx;
      const tr = S.Sched.mlfq(parse(S, input.work), { levels: input.levels, quantum: [input.q], allot: Math.max(input.allot, input.q), boost: input.boost });
      common(ctx, tr);
      for (const f of frames('tick')) {
        const st = f.meta.step;
        if (st.run && !st.boosted) ctx.ok(st.queues.every((q, k) => !q.length || k >= st.level || !tr.params.preempt), `the job runs from the highest non-empty queue at t = ${st.t}`);
        for (const [id, u] of Object.entries(st.used)) ctx.ok(u <= tr.params.allot[st.lv[id]], `${id} never exceeds its allotment`);
      }
      // quanta double per level from Q0
      ctx.near(tr.params.quantum, Array.from({ length: input.levels }, (_, k) => input.q * Math.pow(2, k)), 'quanta double');
    },
  },
  'sch-mlfq-game': {
    random: (rnd) => ({ rule: pick(rnd, ['allot', 'boost']), allot: int(rnd, 2, 8), boost: int(rnd, 6, 30) }),
    check(ctx) {
      const { frames, frame } = ctx;
      for (const f of frames('window').concat([frame('end')])) {
        const m = f.meta;
        ctx.near([Object.values(m.gA).reduce((a, b) => a + b, 0), Object.values(m.gB).reduce((a, b) => a + b, 0)], [m.totA, m.totB], 'shares add up');
        ctx.ok(m.totA <= Math.min(m.t, m.compete) && m.totB <= Math.min(m.t, m.compete), 'no more CPU than time');
      }
    },
  },
  'sch-lottery': {
    random: (rnd) => ({ work: randomWork(rnd, { tickets: true }), q: int(rnd, 1, 4), seed: int(rnd, 0, 999) }),
    check(ctx) {
      const { frames, frame } = ctx;
      for (const f of frames('draw')) {
        const d = f.meta.draw;
        let lo = 0;
        for (const h of d.holders) { ctx.near([h.lo, h.hi], [lo, lo + h.tickets - 1], 'ticket ranges follow on'); lo += h.tickets; }
        ctx.near(d.total, lo, 'the total');
        // with no tickets among the ready jobs even after recalling loans, no draw is made and the first ready job runs
        if (d.skipped) { ctx.ok(d.winner === f.meta.run, 'a skipped draw runs the first ready job'); continue; }
        const w = d.holders.find((h) => d.number >= h.lo && d.number <= h.hi);
        ctx.ok(w && w.id === d.winner && w.id === f.meta.run, 'the holder of the number runs');
        if (d.recalled && d.recalled.length) recalls++;
      }
      const e = frame('end').meta, fr = e.fair;
      ctx.near(fr.jain, Math.pow(fr.per.reduce((a, b) => a + b, 0), 2) / (fr.per.length * fr.per.reduce((a, b) => a + b * b, 0) || 1) || 1, "Jain's index by hand", 1e-9);
    },
  },
  'sch-stride': {
    random: (rnd) => ({ work: randomWork(rnd, { tickets: true }), q: int(rnd, 1, 4), L: pick(rnd, [600, 1000, 10000]) }),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work, { maxCpu: 120 }), tr = S.Sched.stride(work, { quantum: input.q, L: input.L });
      common(ctx, tr);
      for (const f of frames('tick')) {
        const tab = f.meta.table, run = tab.find((r) => r.id === f.meta.run);
        if (f.meta.decision === 'dispatch' && run) ctx.ok(tab.filter((r) => r.state === 'ready').every((r) => run.pass <= r.pass), `the lowest pass runs at t = ${f.meta.t}`);
        for (const r of tab) ctx.near(r.stride, Math.floor(input.L / r.tickets), 'stride = L / tickets');
      }
      // between consecutive ticks a running job's pass grows by its stride
      for (let t = 1; t < tr.steps.length - 1; t++) {
        const a = tr.steps[t - 1], b = tr.steps[t];
        if (!a.run || a.cs) continue;
        const pa = a.table.find((r) => r.id === a.run), pb = (b.table || []).find((r) => r.id === a.run);
        if (pa && pb && pb.state !== 'io' && pa.state === 'running') ctx.near(pb.pass - pa.pass, pa.stride, `${a.run}'s pass grows by its stride at t = ${t}`);
      }
    },
  },
  'sch-cfs': {
    random: (rnd) => ({ work: randomWork(rnd, { nice: true, io: rnd() < 0.4 }), lat: int(rnd, 6, 24), gran: int(rnd, 1, 4), credit: pick(rnd, ['yes', 'no']) }),
    extra: (m, input, S) => (m.step && m.step.tree !== undefined ? S.Sched.WEIGHTS.concat(m.step.say ? [] : []) : []),
    check(ctx) {
      const { S, input, frames } = ctx, work = parse(S, input.work), tr = S.Sched.cfs(work, { latency: input.lat, minGran: input.gran, sleeperCredit: input.credit === 'yes' });
      common(ctx, tr);
      for (const f of frames('tick')) {
        ctx.ok(f.meta.rb === null, `a valid red-black tree at t = ${f.meta.t}: ${f.meta.rb}`);
        const keys = [];
        const walk = (n) => { if (!n) return; walk(n.l); keys.push(n.v); walk(n.r); };
        walk(f.meta.step.tree);
        ctx.ok(keys.every((v, i) => !i || keys[i - 1] <= v), 'the tree is in order');
        if (['dispatch', 'preempt'].includes(f.meta.decision)) {
          // the job taken was the leftmost: no job left in the tree has less vruntime
          ctx.ok(keys.every((v) => f.meta.vr[f.meta.run] <= v + 1e-9), `the leftmost runs at t = ${f.meta.t}`);
          const runnable = f.meta.ready.concat([f.meta.run]), W = runnable.reduce((a, id) => a + S.Sched.weight(tr.jobs.find((j) => j.id === id).nice), 0), w = S.Sched.weight(tr.jobs.find((j) => j.id === f.meta.run).nice);
          ctx.near(f.meta.slice, Math.round(Math.max(input.gran, (Math.max(input.lat, runnable.length * input.gran) * w) / W) * 100) / 100, 'the slice by hand');
        }
      }
      // a rebalance narrated: recoloured nodes really changed colour, and the tree after it is valid
      const col = (n, o) => { o = o || {}; if (n) { o[n.id] = n.red; col(n.l, o); col(n.r, o); } return o; };
      for (const f of frames('tick')) {
        const rb = f.meta.rebalance;
        if (!rb) continue;
        const before = col(tr.steps[f.meta.t - 1].tree), after = col(f.meta.step.tree);
        for (const id of rb.recol) ctx.ok(before[id] !== after[id] && (after[id] ? 'red' : 'black') === rb.colour[id], `${id} was recoloured at t = ${f.meta.t}`);
        ctx.ok(/rebalanced/.test(f.say), 'the rebalance is narrated at t = ' + f.meta.t);
        rebalances++;
      }
      // vruntime grows by 1024 / weight per tick run
      for (let t = 1; t < tr.steps.length - 1; t++) {
        const a = tr.steps[t - 1], b = tr.steps[t];
        if (a.run && !a.cs && b.vr[a.run] !== undefined && b.io.every((x) => x.id !== a.run) || (a.run && !a.cs && b.vr[a.run] !== undefined)) {
          const w = S.Sched.weight(tr.jobs.find((j) => j.id === a.run).nice);
          ctx.near(b.vr[a.run], Math.round((a.vr[a.run] + 1024 / w) * 100) / 100, `${a.run}'s vruntime after t = ${t - 1}`, 0.011);
        }
      }
    },
  },
  'sch-compare': {
    random: (rnd) => ({ work: randomWork(rnd, { prio: true, io: rnd() < 0.3 }), q: int(rnd, 1, 4), pols: ['fcfs', 'sjf', 'srtn', 'rr', 'prio', 'mlfq', 'cfs', 'stride', 'lottery'].filter(() => rnd() < 0.6).slice(0, 6).concat(['fcfs', 'rr']).filter((x, i, a) => a.indexOf(x) === i).slice(0, 6) }),
    check(ctx) {
      const { S, input, frame } = ctx, work = parse(S, input.work), c = frame('compare').meta;
      c.stats.forEach((s, k) => {
        const p = input.pols[k];
        if (['fcfs', 'sjf', 'srtn'].includes(p) && noIo(work)) { const sim = simulate(work, p, 0); ctx.near(s.T, avg(sim.J.map((j) => j.done - j.arrive)), p + ' turnaround against an independent run'); }
        if (p === 'rr' && noIo(work)) { const sim = simulate(work, 'rr', input.q); ctx.near(s.R, avg(sim.J.map((j) => j.first - j.arrive)), 'rr response against an independent run'); }
      });
      ctx.near(c.best.W, Math.min(...c.stats.map((s) => s.W)), 'the best waiting');
    },
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { runClaims('claims-p05', /^p05-/, P05); console.log('  (' + rebalances + ' red-black rebalances narrated and checked, ' + recalls + ' lottery loans recalled)'); }
