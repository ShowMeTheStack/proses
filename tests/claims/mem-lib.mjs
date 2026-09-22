// The narration claims check for parts 10 and 11 (tests/claims-p10.mjs, tests/claims-p11.mjs): every topic run with
// its default, every preset and random valid inputs. For every frame: the wording (a and an, doubled words, stray
// spaces, "1 pages"), and every number the narration quotes must be a value the frame carries from the engines (its
// meta), an input, or a named constant of the topic. Then each topic's own check compares the values with a second
// computation written in the test.
import { load, harness, rng } from '../load.mjs';

// ---- wording ----
const vowelSound = (w) => {
  if (/^[A-Za-z]$/.test(w) || /^[A-Z][A-Z0-9²-]*$/.test(w)) return /^[AEFHILMNORSX]/.test(w.toUpperCase());
  if (/^\d/.test(w)) return /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
  if (/^(hour|honest|heir)/i.test(w)) return true;
  return /^[aeiou]/i.test(w) && !/^(one|once|uni|use|usu|eu|ur[ai])/i.test(w);
};
export function wording(say) {
  const s = String(say || '').replace(/"[^"]*"/g, '"…"').replace(/`[^`]*`/g, '`…`'), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/\.\./.test(s.replace(/…/g, ''))) out.push('two full stops');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’])(a|an|A|An) ([\w²’'-]+)/g)) {
    const art = m[2].toLowerCase(), w = m[3], vowel = vowelSound(w);
    // a capital A inside a sentence is a name (block A, process A), not the article
    if (m[2] === 'A' && /[^\s.!?:]\s*$/.test(s.slice(0, m.index + m[1].length))) continue;
    if (art === 'a' && vowel && !(m[2] === 'A' && /^[A-Z]$/.test(w))) out.push('"a ' + w + '"');
    if (art === 'an' && !vowel) out.push('"an ' + w + '"');
  }
  // "1 pages", "2 page": a count and its noun must agree (for the nouns these parts count)
  const NOUNS = 'page|frame|fault|hit|miss|byte|block|hole|entry|address|reference|access|process|table|level|bit|slab|object|copy|write|read|time|step|set|way|segment|bucket|request|split|merge';
  for (const m of s.matchAll(new RegExp('(?<![\\w.,])(\\d+) (' + NOUNS + ')(es|s)?\\b', 'g'))) {
    const n = +m[1], plural = !!m[3];
    // a number that names something ("page 1 faults", "frame 2 holds") is a label, not a count
    if (/\b(page|frame|reference|entry|set|way|level|slot|segment|bucket|anchor|step|block|process|object|table|class|size|offset|address|of|at|to|is|=|×|\+|−|-)\s*$/i.test(s.slice(0, m.index))) continue;
    if (n === 1 && plural) out.push('"' + m[0] + '"');
    if (n !== 1 && !plural && !/^(of|in|to)$/.test((s.slice(m.index + m[0].length).match(/^ (\w+)/) || [])[1] || '')) out.push('"' + m[0] + '"');
  }
  if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
/** every string inside a value (deep): names that hold digits (P1, f0), which are not quoted numbers */
export function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) stringsOf(v[k], out);
  return out;
}
/** every number inside a value (deep), BigInts too, and the lengths of its arrays */
export function numbersOf(v, out = []) {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v); }
  else if (typeof v === 'bigint') out.push(Number(v));
  else if (typeof v === 'string') { if (/^-?\d+(\.\d+)?$/.test(v)) out.push(+v); }
  else if (Array.isArray(v)) { out.push(v.length); for (const x of v) numbersOf(x, out); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbersOf(v[k], out);
  return out;
}
/** the numbers quoted in a sentence: [text, value, decimals, percent]; hex (0x..) and names (P1, L2, f0) are skipped */
export function quoted(say) {
  const s = String(say || '').replace(/−/g, '-').replace(/0x[0-9a-f_]+/gi, ' ').replace(/`[^`]*`/g, ' '), out = [];
  for (const m of s.matchAll(/(^|[^\w.²³⁰¹⁴⁵⁶⁷⁸⁹_])(-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴⁵⁶⁷⁸⁹])/g)) {
    if (/[A-Za-z]$/.test(m[1])) continue;
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
/** the quoted numbers of a sentence that match no allowed value (0 and 1 alone are free: "1 frame", "0 faults") */
export function untraced(say, allowed, names) {
  let s = String(say || '');
  for (const nm of (names || []).filter((x) => /\d/.test(x) && !/^-?\d+(\.\d+)?$/.test(x)).sort((a, b) => b.length - a.length)) s = s.replace(new RegExp('(?<![\\w.])' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w|\\.\\d)', 'g'), ' ');
  return quoted(s).filter((tok) => !(tok[2] === 0 && Math.abs(tok[1]) <= 1) && !allowed.some((v) => matches(tok, v))).map((t) => t[0]);
}

export const close = (a, b, tol = 1e-9) => {
  if (typeof a === 'bigint') a = Number(a);
  if (typeof b === 'bigint') b = Number(b);
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => close(a[i], v, tol));
  if (b === null || b === undefined) return a === null || a === undefined;
  if (typeof b === 'string' || typeof b === 'boolean') return a === b;
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
  let runs = 0;
  for (const t of S.topics) {
    if (!family.test(t.family)) continue;
    if (only.length && !only.some((o) => t.id.startsWith(o))) continue;
    const C = CHECKS[t.id] || {};
    if (!CHECKS[t.id]) t0.ok(false, t.id + ': no claims check is written for this topic');
    const inputs = [{}].concat((t.presets || []).map((p) => p.values));
    const nFixed = inputs.length;
    if (C.random) for (let k = 0; k < (C.nRandom || 8); k++) inputs.push(C.random(rnd));
    inputs.forEach((v, vi) => {
      const input = S.inputOf(t, Object.assign(S.inputOf(t), v));
      const err = S.checkInput(t, input);
      if (err) { if (vi < nFixed) t0.ok(false, t.id + ' ' + JSON.stringify(v) + ': its input is refused: ' + err); return; }
      const tag = t.id + ' ' + JSON.stringify(v).slice(0, 80);
      // no reference string any input carries may hide the well-known textbook example, renamed or spread out
      for (const [k, x] of Object.entries(input)) {
        if (!Array.isArray(x)) continue;
        const refs = x.map((e) => (/^\d+/.exec(String(e)) || [])[0]).filter((e) => e !== undefined).map(Number);
        if (refs.length >= 12 && vi < nFixed) t0.ok(!S.Mem.holdsFamous(refs), tag + ': the input ' + k + ' holds the well-known example string');
      }
      const r = S.run(t, input);
      runs++;
      if (!r.ok) { t0.ok(false, tag + ': ' + r.error); return; }
      const consts = (C.constants || []).concat(numbersOf(input));
      r.frames.forEach((f, i) => {
        for (const w of wording(f.say)) t0.ok(false, tag + ' frame ' + i + ': ' + w + ': ' + f.say);
        if (f.predict) for (const w of wording(f.predict.ask)) t0.ok(false, tag + ' frame ' + i + ' prediction: ' + w);
        const allowed = numbersOf(f.meta || {}).concat(consts);
        const bad = untraced(f.say, allowed, stringsOf(f.meta || {}).concat(stringsOf(input)).concat(C.names || []));
        t0.ok(!bad.length, tag + ' frame ' + i + ': the narration quotes ' + bad.join(', ') + ', which the frame does not carry: ' + f.say);
        t0.ok(!!(f.meta && f.meta.phase), tag + ' frame ' + i + ': a frame without meta.phase');
      });
      const ctx = {
        S, t, input, r, rnd,
        near: (got, want, what, tol) => t0.ok(close(got, want, tol), tag + ': ' + what + ': got ' + JSON.stringify(got, big) + ', want ' + JSON.stringify(want, big)),
        ok: (c, what) => t0.ok(!!c, tag + ': ' + what),
        frame: (phase) => r.frames.find((f) => f.meta && f.meta.phase === phase),
        frames: (phase) => r.frames.filter((f) => f.meta && f.meta.phase === phase),
      };
      try { if (C.check) C.check(ctx); } catch (e) { t0.ok(false, tag + ': the check fails: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    });
  }
  console.log('  (' + runs + ' runs)');
  t0.done();
}
const big = (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x);
export const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
export const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
