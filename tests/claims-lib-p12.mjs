// What the narration claims checks of parts 12, 13 and 14 share (tests/claims-p12.mjs, -p13.mjs, -p14.mjs).
// Every topic of these parts puts the values its narration quotes in each frame's meta, taken from the engines.
// Here every number in a frame's narration must be one of them (or one of the inputs) at the precision shown, the
// wording is checked (a against an, doubled words, double spaces, "1 processes"), and each part's own file works
// the meta values out again apart from the topic: by hand, or by a second method.
// This file only exports; run on its own it does nothing.
import { load, harness, rng } from './load.mjs';

export function setup(name) {
  const S = load(['core', 'stage', 'topics']);
  return { S, t: harness(name), rnd: rng(20261019) };
}

// ---- wording ----
/** does a word start with a vowel sound? single letters and acronyms by the names of their letters */
export function vowelSound(w) {
  if (/^(8|11|18|80|81|82|83|84|85|86|87|88|89)(\D|$)/.test(w) || /^8\d\d(\D|$)/.test(w)) return true;
  if (/^\d/.test(w)) return false;
  if (/^[^\x00-\x7f]/.test(w)) return false;
  const lead = w.match(/^[A-Za-z]+/);
  if (!lead) return false;
  const L = lead[0];
  if (/^(SSD|SSDs|FTL|LBA|LRU|RAID|FIFO|DMA|CRC|CPU|NFS|HDD|IRQ|EOF|ENOENT|EEXIST|EACCES|EXDEV|EBUSY|ELOOP|EAGAIN|ENOTEMPTY|ENOTDIR|EISDIR|EINVAL)$/.test(L))
    return /^(SSD|SSDs|FTL|LBA|LRU|FIFO|NFS|HDD|IRQ|EOF|ENOENT|EEXIST|EACCES|EXDEV|EBUSY|ELOOP|EAGAIN|ENOTEMPTY|ENOTDIR|EISDIR|EINVAL)$/.test(L);
  if (L.length === 1 || (L === L.toUpperCase() && L.length <= 5 && !/^(AND|OR|ONE)$/.test(L))) return /^[aefhilmnorsx]/i.test(L);
  if (/^(one|once|uni|use|usu|eu|ufo|ubiq)/i.test(L)) return false;
  if (/^(hour|honest|honour|inode)/i.test(L)) return true;
  return /^[aeiou]/i.test(L);
}
const PLURALS = /^(tracks|sectors|cylinders|blocks|heads|surfaces|disks|pages|requests|bytes|bits|writes|reads|processes|files|links|entries|zones|stripes|chunks|copies|erases|interrupts|polls|units|descriptors|seconds|times|steps|programs|calls|jobs|slots|buffers|misses|hits|inodes|directories|names|users|groups|mounts|levels|turns|switches|cycles|transfers|errors|ones|zeros|parities|devices|registers|retries|lines|rows|columns|segments|merges|dispatches|copies|moves|overtakes|cylinders)$/;
export function wording(say) {
  const s = String(say || ''), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/^\s|\s$/.test(s)) out.push('space at an end');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’`])(a|an|A|An) `?([\w′'’²/-]+)/g)) {
    const art = m[2].toLowerCase(), w = m[3];
    if (m[2] === 'A' && /^[A-Z]$/.test(w)) continue;
    if (/^A/.test(m[2]) && m.index > 0 && !/[.!?:;]\s*$/.test(s.slice(0, m.index + m[1].length))) continue; // a capital A inside a sentence is a name (process A)
    const v = vowelSound(w);
    if (art === 'a' && v) out.push('"a ' + w + '"');
    if (art === 'an' && !v) out.push('"an ' + w + '"');
  }
  for (const m of s.matchAll(/(^|[^\d.,])1 ([a-z]{3,})\b/g)) if (PLURALS.test(m[2]) && !/\b(head|disk|zone|block|cylinder|sector|stripe|page|process|step|level|fd|inode|group|core|request|job|chunk|slot|entry|file|user|bus|device|lane|row|column|segment|program|t =|[A-Z][a-z]*) $/.test(s.slice(Math.max(0, m.index - 14), m.index + m[1].length))) out.push('"1 ' + m[2] + '"');
  if (/\b(the|a|an) (the|a|an|of)\b/i.test(s)) out.push('a missing word');
  if (/\.\./.test(s.replace(/\.\.\./g, ''))) out.push('two full stops');
  if (/undefined|NaN|Infinity|\[object/.test(s)) out.push('a broken value');
  return out;
}

// ---- numbers ----
/** every number written in a sentence: {v, dec, pct}; digits inside words (x1, P3, sda2, 0x1d) do not count */
export function numbersIn(say) {
  const out = [];
  const s = String(say || '').replace(/“[^”]*”/g, '“…”').replace(/−/g, '-').replace(/(\d),(\d{3})\b/g, '$1$2'); // quoted text is the reader's own
  for (const m of s.matchAll(/(?<![\w.·^²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉/])(?<![A-Za-z]-)(-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴-⁹/])(?!-(bit|byte|level|way)\b)/g)) {
    const txt = m[1], dec = txt.includes('.') ? txt.split('.')[1].length : 0;
    const before = s.slice(Math.max(0, m.index - 3), m.index);
    if (/RAID $|RAID \d\+$/.test(s.slice(Math.max(0, m.index - 7), m.index))) continue; // a level's name
    out.push({ v: +txt, dec, pct: m[2] === '%', txt: m[0], signFree: / - $/.test(before) || /-$/.test(before) });
  }
  return out;
}
/** all numbers inside a value (arrays, objects), at most a few tens of thousands */
export function leaves(v, out = [], depth = 0) {
  if (out.length > 40000 || depth > 7) return out;
  if (typeof v === 'number') { if (isFinite(v)) out.push(v); }
  else if (typeof v === 'string') { if (/^-?\d+(\.\d+)?$/.test(v)) out.push(+v); }
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) { for (const x of v) leaves(x, out, depth + 1); }
  else if (v && typeof v === 'object') { for (const k of Object.keys(v)) leaves(v[k], out, depth + 1); }
  return out;
}
export function matches(num, vals) {
  const tol = 0.5 * Math.pow(10, -num.dec) * (1 + 1e-9) + 1e-12;
  for (const raw of vals) {
    for (const v of (num.pct ? [raw * 100, raw] : [raw]).flatMap((q) => (num.signFree ? [q, -q] : [q]))) {
      if (Math.abs(v - num.v) <= tol) return true;
    }
  }
  return false;
}
const CONST = [0, 1, 2];

/** the generic checks of one run: wording, and every number in a frame's narration is in its meta or the inputs */
export function generic(ctx) {
  const { r, input, fail, pass, extra } = ctx;
  const inVals = leaves(input).concat(CONST, extra || []);
  r.frames.forEach((f, i) => {
    for (const w of wording(f.say)) fail('frame ' + i + ': ' + w + ': ' + f.say);
    if (!f.meta) { fail('frame ' + i + ': no meta'); return; }
    const vals = leaves(f.meta).concat(inVals);
    for (const num of numbersIn(f.say)) {
      if (matches(num, vals)) pass();
      else fail('frame ' + i + ': the narration says ' + num.txt + ', which is not in the frame\'s values: ' + f.say.slice(0, 200));
    }
    if (f.predict) for (const w of wording(f.predict.ask)) fail('frame ' + i + ' prediction: ' + w);
  });
}

export const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * run a part: mods is {topicId: {random(rnd) -> values, check(ctx), nRandom}}; ctx = {S, tp, input, r, fail, pass, near}
 */
export function runPart(S, t, rnd, pattern, mods, only) {
  let runs = 0;
  const seen = new Set();
  for (const tp of S.topics) {
    if (!pattern.test(tp.family)) continue;
    if (only.length && !only.some((o) => tp.id.startsWith(o) || tp.family.startsWith(o))) continue;
    seen.add(tp.id);
    const mod = mods[tp.id] || {};
    if (!mods[tp.id]) t.ok(false, tp.id + ': no claims module');
    const inputs = [{}].concat((tp.presets || []).map((p) => p.values));
    const nPre = inputs.length;
    if (mod.random) for (let k = 0; k < (mod.nRandom || 8); k++) inputs.push(mod.random(rnd));
    inputs.forEach((v, idx) => {
      const input = S.inputOf(tp, Object.assign(S.inputOf(tp), v));
      const err = S.checkInput(tp, input);
      if (err) { if (idx >= nPre) return; t.ok(false, tp.id + ' refuses ' + JSON.stringify(v) + ': ' + err); return; }
      const js = JSON.stringify(v), tag = tp.id + ' ' + (js.length > 90 ? js.slice(0, 87) + '…}' : js);
      let r;
      try { r = S.run(tp, input); } catch (e) { t.ok(false, tag + ': ' + e.message); return; }
      if (!r.ok) { t.ok(false, tag + ': ' + r.error); return; }
      runs++;
      const ctx = { S, tp, input, r, near, fail: (m) => t.ok(false, tag + ': ' + m), pass: () => t.ok(true), extra: mod.extra ? mod.extra(input) : [] };
      generic(ctx);
      if (mod.check) { try { mod.check(ctx); } catch (e) { t.ok(false, tag + ': the check threw ' + e.message + ' ' + (e.stack || '').split('\n')[1]); } }
    });
  }
  return { runs, seen };
}
export const pick = (r, a) => a[Math.floor(r() * a.length)];
export const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
