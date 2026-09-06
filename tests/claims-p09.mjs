// Part 9 (deadlocks): every topic run with its default, every preset and random valid inputs. For every frame: the
// wording (a/an, doubled words, stray spaces, "1 processes"), and every number the narration quotes must be a value
// the frame carries from the engines (its meta), an input, or a named constant of the topic. Then per topic the
// values themselves are checked against a second computation written here (an independent safety search over every
// order, an independent cycle test, independent detection, a brute-force search of every interleaving).
// Prints "claims-p09 N passed, M failed". The shared machinery is exported for tests/claims-p17.mjs and claims-p18.mjs.
import { pathToFileURL } from 'node:url';
import { load, harness, rng } from './load.mjs';

// ---- wording ----
const vowelSound = (w) => {
  if (/^[A-Za-z]$/.test(w) || /^[A-Z][A-Z0-9²-]*$/.test(w)) return /^[AEFHILMNORSX]/.test(w.toUpperCase());
  if (/^\d/.test(w)) return /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
  if (/^(hour|honest|heir)/i.test(w)) return true;
  return /^[aeiou]/i.test(w) && !/^(one|once|uni|use|usu|eu|ur[ai])/i.test(w);
};
export function wording(say) {
  // quoted text and file paths (which may hold "..") are not prose
  const s = String(say || '').replace(/"[^"]*"/g, '"…"').replace(/`/g, '').replace(/(^|\s|\()\/[\w.\/-]*/g, '$1/path'), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/\.\./.test(s.replace(/…/g, ''))) out.push('two full stops');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’])(a|an|A|An) ([\w²’'-]+)/g)) {
    const art = m[2].toLowerCase(), w = m[3], vowel = vowelSound(w);
    // a capital A inside a sentence is a name (resource A, lock A), not the article
    if (m[2] === 'A' && !/(^|[.:;!?]\s*)$/.test(s.slice(0, m.index + m[1].length))) continue;
    if (art === 'a' && vowel && !(m[2] === 'A' && /^[A-Z]$/.test(w))) out.push('"a ' + w + '"');
    if (art === 'an' && !vowel) out.push('"an ' + w + '"');
  }
  for (const m of s.matchAll(/(^|[^\w.])1 ([a-z]+s)\b/g)) if (!/^(is|as|us|was|has|does|this|its|his|yes|plus|bits|units?)$/.test(m[2]) && !/ss$/.test(m[2])) out.push('"1 ' + m[2] + '"');
  for (const m of s.matchAll(/(^|[^\w.])([02-9]|\d{2,}) (process|step|unit|thread|request|edge|rollback|state|run|time|record|exit|miss|fault|page|round|copy)\b(?![-'’])/g)) out.push('"' + m[2] + ' ' + m[3] + '"');
  if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
export function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) stringsOf(v[k], out);
  return out;
}
export function numbersOf(v, out = []) {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v); }
  else if (typeof v === 'string') { for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(+m[0]); }
  else if (typeof v === 'boolean' || typeof v === 'bigint') { if (typeof v === 'bigint') out.push(Number(v)); }
  else if (Array.isArray(v)) { out.push(v.length); for (const x of v) numbersOf(x, out); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbersOf(v[k], out);
  return out;
}
/** the numbers quoted in a sentence (names such as P3, R0, T1, x2 are not numbers, nor hex such as 0x1f00) */
export function quoted(say) {
  const s = String(say || '').replace(/−/g, '-').replace(/`/g, '').replace(/\b0x[0-9a-f]+\b/gi, ' '), out = [];
  for (const m of s.matchAll(/(^|[^\w.²³⁰¹⁴⁵⁶⁷⁸⁹ₖ_^])(-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴⁵⁶⁷⁸⁹])/g)) {
    const t = m[2], d = t.includes('.') ? t.split('.')[1].length : 0;
    out.push([t + m[3], +t, d, !!m[3]]);
  }
  return out;
}
const matches = (tok, v) => {
  const [, x, d, pct] = tok, tol = 0.5 * Math.pow(10, -d) + 1e-9 * Math.max(1, Math.abs(x));
  const cand = pct ? [v * 100, v] : [v, v * 100];
  return cand.some((c) => Math.abs(c - x) <= tol || Math.abs(Math.abs(c) - Math.abs(x)) <= tol);
};
export function untraced(say, allowed, names) {
  let s = String(say || '');
  for (const nm of (names || []).filter((x) => /\d/.test(x) && x.length < 40).sort((a, b) => b.length - a.length)) s = s.split(nm).join(' ');
  return quoted(s).filter((tok) => !(tok[2] === 0 && Math.abs(tok[1]) <= 1) && !allowed.some((v) => matches(tok, v))).map((t) => t[0]);
}
export const close = (a, b, tol = 1e-6) => {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => close(a[i], v, tol));
  if (b === null || b === undefined) return a === null || a === undefined;
  if (typeof b !== 'number') return JSON.stringify(a) === JSON.stringify(b);
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
};

/**
 * Run the claims of the topics whose family matches `family`: CHECKS[topicId] = { constants: [n..], names: [..],
 * random(rnd) -> values, nRandom, check(ctx) } with ctx = { S, t, input, r, near(got, want, what, tol), ok(cond,
 * what), frame(phase), frames(phase) }.
 */
export function runClaims(name, family, CHECKS) {
  const S = load(['core', 'stage', 'topics']);
  const t0 = harness(name);
  const only = process.argv.slice(2);
  const rnd = rng(20261019);
  let runs = 0, frames = 0;
  for (const t of S.topics) {
    if (!family.test(t.family)) continue;
    if (only.length && !only.some((o) => t.id.startsWith(o))) continue;
    const C = CHECKS[t.id] || {};
    if (!CHECKS[t.id]) t0.ok(false, t.id + ': no claims check is written for this topic');
    const inputs = [{}].concat((t.presets || []).map((p) => p.values));
    if (C.random) for (let k = 0; k < (C.nRandom || 6); k++) inputs.push(C.random(rnd));
    inputs.forEach((v, idx) => {
      const input = S.inputOf(t, Object.assign(S.inputOf(t), v));
      const err = S.checkInput(t, input);
      if (err) { if (idx <= (t.presets || []).length) t0.ok(false, t.id + ' ' + JSON.stringify(v).slice(0, 80) + ': its input is refused: ' + err); return; }
      const tag = t.id + ' ' + JSON.stringify(v).slice(0, 70);
      const r = S.run(t, input);
      runs++;
      if (!r.ok) { t0.ok(false, tag + ': ' + r.error); return; }
      const consts = (C.constants || []).concat(numbersOf(input));
      r.frames.forEach((f, i) => {
        frames++;
        for (const w of wording(f.say)) t0.ok(false, tag + ' frame ' + i + ': ' + w + ': ' + f.say);
        if (f.predict) { for (const w of wording(f.predict.ask)) t0.ok(false, tag + ' frame ' + i + ' prediction: ' + w); }
        const allowed = numbersOf(f.meta || {}).concat(consts);
        const bad = untraced(f.say, allowed, stringsOf(f.meta || {}).filter((x) => /[A-Za-z]/.test(x)).concat(C.names || []));
        t0.ok(!bad.length, tag + ' frame ' + i + ': the narration quotes ' + bad.join(', ') + ', which the frame does not carry: ' + f.say);
      });
      for (const q of t.quiz || []) for (const w of wording(q.q + ' / ' + q.options.join(' / ') + ' / ' + q.why)) t0.ok(false, t.id + ' quiz: ' + w + ': ' + q.q);
      const ctx = {
        S, t, input, r,
        near: (got, want, what, tol) => t0.ok(close(got, want, tol === undefined ? 1e-6 : tol), tag + ': ' + what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)),
        ok: (c, what) => t0.ok(!!c, tag + ': ' + what),
        frame: (phase) => r.frames.find((f) => f.meta && f.meta.phase === phase),
        frames: (phase) => r.frames.filter((f) => f.meta && f.meta.phase === phase),
        last: () => r.frames[r.frames.length - 1],
      };
      try { if (C.check) C.check(ctx); } catch (e) { t0.ok(false, tag + ': the check fails: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    });
  }
  console.log('  (' + runs + ' runs, ' + frames + ' frames)');
  t0.done();
}
export const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
export const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---------------------------------------------------------------------------------------------------------------
// independent computations
const le = (a, b) => a.every((x, j) => x <= b[j]);
/** is there any order in which every process finishes? (a search over orders, memoised on the finished set) */
function anyOrder(avail, alloc, want) {
  const n = alloc.length, seen = new Set();
  const go = (done, work) => {
    if (done.every(Boolean)) return true;
    const k = done.join('');
    if (seen.has(k)) return false;
    seen.add(k);
    for (let i = 0; i < n; i++) if (!done[i] && le(want[i], work)) { const d2 = done.slice(); d2[i] = true; if (go(d2, work.map((w, j) => w + alloc[i][j]))) return true; }
    return false;
  };
  return go(alloc.map(() => false), avail.slice());
}
/** detection by fixed point: who can never be satisfied (holders of nothing are free) */
function detectInd(avail, alloc, request) {
  const n = alloc.length, fin = alloc.map((r) => r.every((x) => !x));
  let work = avail.slice(), changed = true;
  while (changed) { changed = false; for (let i = 0; i < n; i++) if (!fin[i] && le(request[i], work)) { fin[i] = true; work = work.map((w, j) => w + alloc[i][j]); changed = true; } }
  return fin.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
}
/** a cycle in a directed graph given as edges [[a, b]..], by repeatedly removing nodes with no outgoing edge */
function hasCycle(edges) {
  let E = edges.slice();
  for (;;) { const nodes = new Set(E.flat()), sinks = [...nodes].filter((v) => !E.some(([a]) => a === v)); if (!sinks.length) return E.length > 0; E = E.filter(([, b]) => !sinks.includes(b)); if (!E.length) return false; }
}
const ragEdges = (g) => g.want.map(([p, r]) => ['p' + p, 'r' + r]).concat(g.hold.map(([p, r]) => ['r' + r, 'p' + p]));
const ragMatrices = (g) => {
  const n = g.procs.length, m = g.res.length, alloc = Array.from({ length: n }, () => Array(m).fill(0)), request = Array.from({ length: n }, () => Array(m).fill(0));
  for (const [p, r] of g.hold) alloc[p][r]++;
  for (const [p, r] of g.want) request[p][r]++;
  return { alloc, request, avail: g.res.map((r, j) => r.units - alloc.reduce((s, row) => s + row[j], 0)) };
};
/** every interleaving of two-lock threads: can they deadlock? (a plain search over (pc.., owner..) states) */
function lockSearch(progs) {
  const seen = new Set(), st0 = { pc: progs.map(() => 0), own: {} };
  let dead = false;
  const go = (st) => {
    const k = JSON.stringify(st);
    if (seen.has(k) || dead) return; seen.add(k);
    let moved = false, blocked = false;
    progs.forEach((p, t) => {
      if (st.pc[t] >= p.length) return;
      const op = p[st.pc[t]];
      if (op.op === 'lock') { if (st.own[op.m] !== undefined && st.own[op.m] !== null) { blocked = true; return; } moved = true; go({ pc: st.pc.map((x, u) => (u === t ? x + 1 : x)), own: Object.assign({}, st.own, { [op.m]: t }) }); }
      else if (op.op === 'unlock') { moved = true; go({ pc: st.pc.map((x, u) => (u === t ? x + 1 : x)), own: Object.assign({}, st.own, { [op.m]: null }) }); }
      else { moved = true; go({ pc: st.pc.map((x, u) => (u === t ? x + 1 : x)), own: st.own }); }
    });
    if (!moved && blocked) dead = true;
  };
  go(st0);
  return dead;
}
const parseRows = (t) => String(t).split(';').map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/).filter(Boolean).map(Number));
const nums = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean)).map(Number);
/** a random banker instance: n processes, m types, everything consistent */
function randomBank(rnd) {
  const n = int(rnd, 2, 6), m = int(rnd, 1, 4);
  const max = Array.from({ length: n }, () => Array.from({ length: m }, () => int(rnd, 0, 7)));
  const alloc = max.map((r) => r.map((x) => int(rnd, 0, x)));
  const avail = Array.from({ length: m }, () => int(rnd, 0, 4));
  return { avail: avail.map(String), alloc: alloc.map((r) => r.join(' ')).join('; '), max: max.map((r) => r.join(' ')).join('; '), n, m };
}
function randomDet(rnd) {
  const n = int(rnd, 2, 6), m = int(rnd, 1, 4);
  const alloc = Array.from({ length: n }, () => Array.from({ length: m }, () => (rnd() < 0.4 ? int(rnd, 1, 2) : 0)));
  const request = Array.from({ length: n }, () => Array.from({ length: m }, () => (rnd() < 0.3 ? int(rnd, 1, 2) : 0)));
  const avail = Array.from({ length: m }, () => (rnd() < 0.5 ? 0 : 1));
  return { avail: avail.map(String), alloc: alloc.map((r) => r.join(' ')).join('; '), request: request.map((r) => r.join(' ')).join('; '), cost: alloc.map(() => String(int(rnd, 1, 9))) };
}

// ---------------------------------------------------------------------------------------------------------------
export const P09 = {
  'dl-rag-live': {
    random: (rnd) => ({ scen: pick(rnd, ['pair', 'ring3', 'ring4', 'spare', 'pool']), how: pick(rnd, ['worst', 'seed']), seed: int(rnd, 1, 999) }),
    check({ S, input, frames, last, ok, near }) {
      const spec = S.P09.SCEN[input.scen].spec;
      for (const f of frames('step')) ok(f.meta.avail.every((a, j) => a >= 0 && a <= spec.res[j].units), 'Available between 0 and the units');
      const end = last().meta;
      ok(end.phase === 'end', 'the run ends with a verdict');
      if (input.how === 'worst') { const mc = S.MC.check(() => S.Dl.sim(spec), {}); ok((end.status === 'deadlock') === !!mc.violation, 'the worst schedule deadlocks exactly when the model checker finds one'); }
      if (end.status === 'deadlock') {
        // the final state: an independent detection on the simulator's counts, and a cycle in the graph
        const sim = S.Dl.sim(spec); const sched = (input.how === 'worst' ? S.MC.check(() => S.Dl.sim(spec), {}).violation.schedule : S.P09.runSim(spec, input.seed).sched);
        for (const c of sched) sim.step(c);
        ok(hasCycle(ragEdges(sim.rag())), 'the deadlocked graph has a cycle (independent test)');
        near(end.deadlocked, detectInd(sim.avail, sim.p.map((x) => x.held), sim.p.map((x) => (x.want ? x.want.v : spec.res.map(() => 0)))), 'the deadlocked processes (independent detection)');
      }
    },
  },
  'dl-rag-cycle': {
    check({ S, input, last, near, ok }) {
      const g = S.P09.SNAP[input.snap].g, M = ragMatrices(g), end = last().meta;
      ok(!!end.cycle === hasCycle(ragEdges(g)), 'a cycle is found exactly when one exists (independent test)');
      near(end.deadlocked, detectInd(M.avail, M.alloc, M.request), 'the deadlocked processes (independent detection)');
      if (end.cycle) { const E = new Set(ragEdges(g).map((e) => e.join('>'))); ok(end.cycle.every((v, k) => E.has(v + '>' + end.cycle[(k + 1) % end.cycle.length])), 'every step of the reported cycle is an edge'); }
    },
  },
  'dl-wait-for': {
    check({ S, input, frames, last, ok, near }) {
      const g = S.P09.SNAP[input.snap].g, ind = new Set();
      for (const [p, r] of g.want) for (const [q, r2] of g.hold) if (r === r2 && p !== q) ind.add(p + '>' + q);
      near(frames('edge').length, ind.size, 'one frame per wait-for edge (independent count)');
      ok(frames('edge').every((f) => ind.has(f.meta.from + '>' + f.meta.to)), 'each drawn wait is a real one');
      ok((last().meta.cyc.length > 0) === hasCycle([...ind].map((e) => e.split('>'))), 'the wait-for graph has a cycle exactly when the independent test finds one');
    },
  },
  'dl-conditions': {
    random: (rnd) => ({ scen: pick(rnd, ['pair', 'ring3', 'ring4', 'pool']), rule: pick(rnd, ['none', 'mutex', 'holdWait', 'preempt', 'order']) }),
    check({ S, input, frame, last, ok }) {
      const rules = { none: {}, mutex: { mutex: false }, holdWait: { holdWait: false }, preempt: { preempt: true }, order: { order: true } };
      const spec = Object.assign({}, S.P09.SCEN[input.scen].spec, { rules: rules[input.rule] });
      // a second method: many random runs; with a rule on none may deadlock
      let dead = 0;
      for (let s = 1; s <= 40; s++) if (S.Dl.run(S.Dl.sim(spec), { seed: s }).end.kind === 'deadlock') dead++;
      if (input.rule !== 'none') ok(dead === 0 && !frame('search').meta.found, 'with ' + input.rule + ' broken no run deadlocks and the search finds none');
      else ok(frame('search').meta.found === (dead > 0 || frame('search').meta.found), 'the search finds a deadlock whenever random runs do');
      if (last().meta.status === 'deadlock') ok(input.rule === 'none', 'only with all four conditions does the run deadlock');
    },
  },
  'dl-prevention': {
    check({ S, input, frames, ok, near }) {
      const rules = { none: {}, mutex: { mutex: false }, holdWait: { holdWait: false }, preempt: { preempt: true }, order: { order: true } };
      for (const f of frames('rule')) {
        const spec = Object.assign({}, S.P09.SCEN[input.scen].spec, { rules: rules[f.meta.id] });
        let dead = 0;
        for (let s = 1; s <= f.meta.seeds; s++) if (S.Dl.run(S.Dl.sim(spec), { seed: s }).end.kind === 'deadlock') dead++;
        near(f.meta.dead, dead, f.meta.id + ': the deadlocked runs, counted again with S.Dl.run');
        ok(f.meta.id === 'none' || !f.meta.possible, f.meta.id + ': the rule removes every deadlock');
        if (f.meta.id === 'mutex') near(f.meta.idle, 0, 'shared resources are never held');
      }
    },
  },
  'dl-safety': {
    random: (rnd) => randomBank(rnd),
    nRandom: 10,
    check({ input, last, frames, ok, near }) {
      const avail = nums(input.avail), alloc = parseRows(input.alloc), max = parseRows(input.max), need = max.map((r, i) => r.map((x, j) => x - alloc[i][j]));
      const safe = anyOrder(avail, alloc, need), end = last().meta;
      ok((end.phase === 'safe') === safe, 'safe exactly when some order lets everyone finish (a search over orders)');
      if (safe) near(end.work, avail.map((a, j) => a + alloc.reduce((s, r) => s + r[j], 0)), 'Work ends at everything there is');
      for (const f of frames('check')) ok(f.meta.fits === le(f.meta.need, f.meta.work), 'a row fits exactly when its Need ≤ Work');
    },
  },
  'dl-banker-request': {
    random: (rnd) => { const b = randomBank(rnd); return Object.assign(b, { who: int(rnd, 0, b.n - 1), req: Array.from({ length: b.m }, () => String(int(rnd, 0, 2))).map((x, j, a) => (a.every((y) => y === '0') && j === 0 ? '1' : x)) }); },
    nRandom: 12,
    check({ input, last, ok }) {
      const avail = nums(input.avail), alloc = parseRows(input.alloc), max = parseRows(input.max), i = input.who, req = nums(input.req);
      const need = max.map((r, k) => r.map((x, j) => x - alloc[k][j]));
      let want;
      if (!le(req, need[i])) want = 'over-need';
      else if (!le(req, avail)) want = 'wait';
      else {
        const a2 = avail.map((x, j) => x - req[j]), al2 = alloc.map((r, k) => (k === i ? r.map((x, j) => x + req[j]) : r)), n2 = max.map((r, k) => r.map((x, j) => x - al2[k][j]));
        want = anyOrder(a2, al2, n2) ? 'granted' : 'unsafe';
      }
      ok(last().meta.verdict === want, 'the verdict ' + last().meta.verdict + ' agrees with an independent check (' + want + ')');
    },
  },
  'dl-claim-graph': {
    check({ S, input, r, ok }) {
      // the claim rule worked again: grant when the free unit, assigned, closes no cycle with the claims as requests
      const sc = S.P09.CLAIM[input.sc], hold = [], want = [], got = [];
      for (const [p, q] of sc.reqs) {
        if (hold.some((h) => h[1] === q)) { want.push([p, q]); got.push('wait'); continue; }
        const h2 = hold.concat([[p, q]]), claims = sc.claim.filter(([a, b]) => !h2.some(([x, y]) => x === a && y === b));
        const E = h2.map(([a, b]) => ['r' + b, 'p' + a]).concat(want.concat(claims).map(([a, b]) => ['p' + a, 'r' + b]));
        if (hasCycle(E)) { want.push([p, q]); got.push('deny'); } else { hold.push([p, q]); got.push('grant'); }
      }
      const shown = r.frames.filter((f) => ['grant', 'wait', 'deny'].includes(f.meta.phase)).map((f) => f.meta.phase);
      ok(JSON.stringify(shown) === JSON.stringify(got), 'the decisions ' + shown.join(',') + ' agree with an independent run of the rule (' + got.join(',') + ')');
    },
  },
  'dl-detect': {
    random: (rnd) => { const d = randomDet(rnd); delete d.cost; return d; },
    nRandom: 12,
    check({ input, last, near }) {
      near(last().meta.deadlocked, detectInd(nums(input.avail), parseRows(input.alloc), parseRows(input.request)), 'the deadlocked processes (independent detection)');
    },
  },
  'dl-recover-abort': {
    random: (rnd) => Object.assign(randomDet(rnd), { policy: pick(rnd, ['cheapest', 'all']) }),
    nRandom: 10,
    check({ input, r, frames, last, ok, near }) {
      const avail = nums(input.avail), alloc = parseRows(input.alloc), request = parseRows(input.request), cost = nums(input.cost);
      const gone = frames('abort').map((f) => f.meta.i);
      const a2 = alloc.map((r, i) => (gone.includes(i) ? r.map(() => 0) : r)), r2 = request.map((r, i) => (gone.includes(i) ? r.map(() => 0) : r));
      const av2 = avail.map((x, j) => x + gone.reduce((s, i) => s + alloc[i][j], 0));
      near(detectInd(av2, a2, r2), [], 'after the aborts nobody is deadlocked (independent detection)');
      near(last().meta.lost || 0, gone.reduce((s, i) => s + cost[i], 0), 'the cost lost is the sum of the aborted costs');
      if (input.policy === 'cheapest') { let dead = null; for (const f of r.frames) { if (f.meta.phase === 'detect') dead = f.meta.deadlocked; if (f.meta.phase === 'abort') { const best = dead.reduce((a, b) => (cost[b] < cost[a] ? b : a)); ok(f.meta.i === best, 'P' + f.meta.i + ' is the cheapest deadlocked process'); } } }
      if (input.policy === 'all') near(gone.slice().sort((a, b) => a - b), detectInd(avail, alloc, request), 'all at once aborts exactly the deadlocked');
    },
  },
  'dl-recover-rollback': {
    random: (rnd) => Object.assign(randomDet(rnd), { penalty: int(rnd, 0, 20) }),
    nRandom: 10,
    check({ input, frames, ok }) {
      const avail = nums(input.avail), alloc = parseRows(input.alloc), total = avail.map((a, j) => a + alloc.reduce((s, r) => s + r[j], 0));
      for (const f of frames('rollback')) ok(f.meta.freed.every((x) => x >= 0), 'a rollback frees units, never takes them');
      const end = frames('clear')[0] || frames('stuck')[0];
      ok(!!end, 'the recovery ends clear or stuck');
      void total;
    },
  },
  'dl-lock-order': {
    random: (rnd) => ({ variant: pick(rnd, ['ab-ba', 'ordered']), sched: pick(rnd, ['worst', 'rr', 'whole']) }),
    check({ S, input, frame, last, ok }) {
      const spec = S.Sync.lockOrder(input.variant);
      const can = lockSearch(spec.threads.map((t) => t.prog));
      ok(frame('search').meta.found === can, 'the model checker and a plain search of every interleaving agree');
      if (last().meta.status === 'deadlock') ok(can, 'a run deadlocks only if some interleaving can');
    },
  },
  'dl-lockdep': {
    check({ S, input, last, ok }) {
      const LD = { three: [['A', 'B'], ['B', 'C'], ['C', 'A']], abba: [['A', 'B'], ['B', 'A']], ordered: [['A', 'B'], ['B', 'C'], ['A', 'C']] }[input.prog];
      ok((last().meta.cycles > 0) === hasCycle(LD), 'a cycle is reported exactly when the orders written in the program form one');
      ok(last().meta.found === lockSearch(LD.map(([a, b]) => [{ op: 'lock', m: a }, { op: 'lock', m: b }, { op: 'enter' }, { op: 'unlock', m: b }, { op: 'unlock', m: a }])), 'the model checker agrees with a plain search of every interleaving');
    },
  },
  'dl-livelock': {
    random: (rnd) => ({ rounds: int(rnd, 1, 4) }),
    check({ frames, last, ok }) {
      const st = frames('step');
      ok(st.every((f) => f.meta.kind !== 'block'), 'nobody ever blocks');
      ok(last().meta.prog === 0 && last().meta.backs > 0, 'back-offs, and no critical section entered');
      ok(st.filter((f) => /back off/.test(f.meta.label || '')).length === last().meta.backs, 'the back-offs counted are the back-off steps');
    },
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p09', /^p09-/, P09);
