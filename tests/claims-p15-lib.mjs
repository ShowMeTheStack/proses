// What the narration claims checks of parts 15 and 16 share (tests/claims-p15.mjs, tests/claims-p16.mjs). Every
// topic in these parts puts the values its narration quotes in each frame's meta; here every number in a frame's
// narration must be one of them (or one of the inputs) as written, the wording is checked (a/an, doubled words,
// double spaces, "1 blocks"), and each part's own file recomputes the meta values by a second route.
// Run alone it checks itself on a few sentences.
import { load, harness, rng } from './load.mjs';

export function setup(name) {
  const S = load(['core', 'stage', 'topics']);
  return { S, t: harness(name), rnd: rng(20261019) };
}

// ---- wording ----
export function vowelSound(w) {
  if (/^(8|11|18|8\d)(\b|\D|$)/.test(w) || /^8/.test(w)) return true;
  if (/^\d/.test(w)) return false;
  if (/^[^\x00-\x7f]/.test(w)) return false;
  const lead = w.match(/^[A-Za-z]+/);
  if (!lead) return false;
  const L = lead[0];
  if (L.length === 1 || (L === L.toUpperCase() && L.length <= 5 && !/^(AND|OR|ONE)$/.test(L))) return /^[aefhilmnorsx]/i.test(L) && !/^(UFS|USB|URL)$/.test(L);
  if (/^(one|once|uni|use|usu|eu|ufo|uber)/i.test(L)) return false;
  if (/^(hour|honest|honour)/i.test(L)) return true;
  return /^[aeiou]/i.test(L);
}
const PLURALS = new Set('blocks bytes ticks reads writes entries files inodes messages segments hits misses seconds pointers links bits hops runs groups transactions descriptors clients retries copies problems extents levels records operations requests replies callbacks pieces evictions cylinders'.split(' '));
export function wording(say) {
  const s = String(say || ''), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/^\s|\s$/.test(s)) out.push('space at an end');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’/.])(a|an|A|An) ([\w′'’²-]+)/g)) {
    const art = m[2].toLowerCase(), w = m[3];
    if (m[2] === 'A') continue; // a capital A is also a name (client A, inode A); only a, an and An are checked
    const v = vowelSound(w);
    if (art === 'a' && v) out.push('"a ' + w + '"');
    if (art === 'an' && !v) out.push('"an ' + w + '"');
  }
  if (/\b(the|a|an) (the|a|an|of)\b/i.test(s)) out.push('a missing word');
  if (/\.\./.test(s.replace(/\.\.\./g, '').replace(/['‘]\.\.['’]/g, '').replace(/(^|[\s/])\.\.(?=[\s/,]|$)/g, '$1'))) out.push('two full stops');
  for (const m of s.matchAll(/(?<![\d.,])\b1 ([a-z-]+s)\b/g)) if (PLURALS.has(m[1])) out.push('"1 ' + m[1] + '"');
  if (/\bundefined\b|\bNaN\b|\[object/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
/** every number written in a sentence: {v, dec, pct}; digits grouped by commas (32,768) are one number */
export function numbersIn(say) {
  const out = [];
  // text in double quotes is file contents, not a value the narration claims
  const s = String(say || '').replace(/−/g, '-').replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, '“”');
  for (const m of s.matchAll(/(?<![\w.·^²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉#'‘])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴-⁹])/g)) {
    const txt = m[1].replace(/,/g, ''), dec = txt.includes('.') ? txt.split('.')[1].length : 0;
    const before = s.slice(Math.max(0, m.index - 3), m.index);
    out.push({ v: +txt, dec, pct: m[2] === '%', txt: m[0], signFree: / - $/.test(before) || /–$/.test(before) });
  }
  return out;
}
export function leaves(v, out = [], depth = 0) {
  if (out.length > 50000 || depth > 7) return out;
  if (typeof v === 'number') { if (isFinite(v)) out.push(v); }
  else if (typeof v === 'string') { /* skip */ }
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) { for (const x of v) leaves(x, out, depth + 1); }
  else if (v instanceof Map) { for (const [k, x] of v) { leaves(k, out, depth + 1); leaves(x, out, depth + 1); } }
  else if (v instanceof Set) { for (const x of v) leaves(x, out, depth + 1); }
  else if (v && typeof v === 'object') { for (const k of Object.keys(v)) leaves(v[k], out, depth + 1); }
  return out;
}
export function matches(num, vals) {
  const tol = 0.5 * Math.pow(10, -num.dec) * (1 + 1e-9) + 1e-12;
  for (const raw of vals) for (const v of (num.pct ? [raw * 100, raw] : [raw]).flatMap((q) => (num.signFree ? [q, -q] : [q]))) {
    if (Math.abs(v - num.v) <= tol) return true;
  }
  return false;
}
const CONST = [0, 1, 2, 3];

/** the generic checks of one run: wording, and every number in a frame's narration is in its meta or the inputs */
export function generic(ctx) {
  const { r, input, fail, pass, extra } = ctx;
  const inVals = leaves(input).concat(CONST, extra || []);
  r.frames.forEach((f, i) => {
    for (const w of wording(f.say)) fail('frame ' + i + ': ' + w + ': ' + f.say);
    const vals = leaves(f.meta || {}).concat(inVals);
    for (const num of numbersIn(f.say)) {
      if (matches(num, vals)) pass();
      else fail('frame ' + i + ': the narration says ' + num.txt + ', which is not in the frame\'s values: ' + f.say.slice(0, 200));
    }
    if (!f.meta) fail('frame ' + i + ': no meta');
  });
}
export const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** run a part: mods is {topicId: {random(rnd) -> values, check(ctx), nRandom}}; ctx = {S, tp, input, r, fail, pass} */
export function runPart(S, t, rnd, pattern, mods, only) {
  let runs = 0;
  for (const tp of S.topics) {
    if (!pattern.test(tp.family)) continue;
    if (only.length && !only.some((o) => tp.id.startsWith(o) || tp.family.startsWith(o))) continue;
    const mod = mods[tp.id];
    if (!mod) { t.ok(false, tp.id + ': no claims module'); continue; }
    const inputs = [{}].concat((tp.presets || []).map((p) => p.values));
    if (mod.random) for (let k = 0; k < (mod.nRandom || 8); k++) inputs.push(mod.random(rnd));
    for (const v of inputs) {
      const input = S.inputOf(tp, Object.assign(S.inputOf(tp), v));
      const bad = S.checkInput(tp, input);
      if (bad) { if (!(tp.presets || []).some((p) => p.values === v) && Object.keys(v).length) continue; t.ok(false, tp.id + ' refuses ' + JSON.stringify(v) + ': ' + bad); continue; }
      const js = JSON.stringify(v), tag = tp.id + ' ' + (js.length > 90 ? js.slice(0, 87) + '…}' : js);
      let r;
      try { r = S.run(tp, input); } catch (e) { t.ok(false, tag + ': ' + e.message); continue; }
      if (!r.ok) { t.ok(false, tag + ': ' + r.error); continue; }
      runs++;
      const ctx = { S, tp, input, r, near, fail: (m) => t.ok(false, tag + ': ' + m), pass: () => t.ok(true), extra: mod.extra ? mod.extra(input) : [] };
      generic(ctx);
      if (mod.check) { try { mod.check(ctx); } catch (e) { t.ok(false, tag + ': the check threw ' + e.message + ' ' + (e.stack || '').split('\n')[1]); } }
    }
  }
  return runs;
}

// run alone: the checks check themselves
if (process.argv[1] && process.argv[1].endsWith('claims-p15-lib.mjs')) {
  const t = harness('claims-lib');
  t.eq(numbersIn('Block 32,768 and 7.5% of 12 − 3').map((n) => n.v), [32768, 7.5, 12, 3], 'numbers');
  t.ok(wording('an block').length === 1 && wording('a inode').length === 1 && wording('an inode').length === 0, 'articles');
  t.ok(wording('it holds 1 blocks').length === 1 && wording('it holds 2 blocks').length === 0, 'plurals');
  t.ok(wording('the the end').length >= 1 && wording('two  spaces').length === 1, 'doubles');
  t.ok(matches({ v: 7.5, dec: 1, pct: true }, [0.075]) && !matches({ v: 8, dec: 0 }, [7]), 'matching');
  t.done();
}
