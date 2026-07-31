// Check every topic: with its default input and with every preset it runs, every frame draws (keys
// unique, numbers finite, edges joining items that exist), nearly every frame is narrated
// with no "undefined" in it, predictions are answerable, and the topic has a quiz of at least four questions.
// Usage: node tools/check-topics.mjs [topic id, family or id prefix ...] [--verbose]
import { files } from '../tests/load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// every file on its own, so a topic file being written elsewhere that does not load yet fails alone (and is reported)
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout, TextEncoder, TextDecoder });
const broken = [];
for (const f of files(['core', 'stage', 'topics'])) {
  try { vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { if (f.startsWith('topics/')) broken.push(f + ': ' + e.message); else throw e; }
}
const T = ctx.Proses;
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const verbose = process.argv.includes('--verbose');
let pass = 0, fail = 0, frames = 0, runs = 0;
const ids = new Set();
const KINDS = new Set(['state', 'edge', 'arrow', 'cell', 'text', 'region', 'ellipse', 'line', 'token', 'head', 'bracket', 'wire', 'op', 'chip', 'dot', 'path', 'bitmap', 'raster']);
const t0 = Date.now();
for (const t of T.topics) {
  if (only.length && !only.some((o) => t.id.includes(o) || t.family.includes(o))) continue;
  const why = [];
  if (ids.has(t.id)) why.push('duplicate id');
  ids.add(t.id);
  if (!T.familyOf(t)) why.push('unknown family ' + t.family);
  else if (!T.partOf(T.familyOf(t).part)) why.push('the family ' + t.family + ' has an unknown part');
  if (!t.title || !t.blurb) why.push('title and blurb needed');
  if (!t.quiz || t.quiz.length < 4) why.push('at least 4 quiz questions');
  else for (const q of t.quiz) if (!(q.answer >= 0 && q.answer < q.options.length) || !q.why) why.push('quiz question needs a valid answer and a why: ' + q.q);
  if (!t.predict || !t.predict.length) why.push('at least one prediction');
  const list = [{ label: 'default', values: {} }].concat(t.presets || []);
  let predicts = 0;
  for (const p of list) {
    const input = T.inputOf(t, Object.assign(T.inputOf(t), p.values));
    const err = T.checkInput(t, input);
    if (err) { why.push(p.label + ': its own input is refused: ' + err); continue; }
    const r = T.run(t, input);
    runs++;
    if (!r.ok) { why.push(p.label + ': crashed: ' + r.error + ' ' + (r.stack || '').split('\n').slice(1, 3).join(' ')); continue; }
    for (const e of [...new Set(r.predictErrors || [])].slice(0, 4)) why.push(p.label + ': ' + e);
    if (r.frames.length < 2) why.push(p.label + ': only ' + r.frames.length + ' frame');
    frames += r.frames.length;
    for (const sec of (r.def && r.def.sections) || []) for (const x of T.topicLinks(sec.text || '')) if (x.missing) why.push(p.label + ': the definition links to [[' + x.id + ']], which is not a topic');
    const silent = r.frames.filter((f) => !f.say);
    if (silent.length > Math.max(0, r.frames.length * 0.05)) why.push(p.label + ': ' + silent.length + ' of ' + r.frames.length + ' frames have no narration');
    r.frames.forEach((f, i) => {
      const keys = new Set();
      if (!f.items.length) why.push(p.label + ' frame ' + i + ': nothing is drawn');
      for (const it of f.items) {
        if (!it.key) { why.push(p.label + ' frame ' + i + ': an item without a key'); break; }
        if (keys.has(it.key)) { why.push(p.label + ' frame ' + i + ': two items share the key ' + it.key); break; }
        keys.add(it.key);
        if (!KINDS.has(it.kind)) why.push(p.label + ' frame ' + i + ': unknown kind ' + it.kind);
        for (const k of ['x', 'y', 'w', 'h', 'r', 'lx', 'ly', 'x1', 'y1', 'x2', 'y2', 'bend']) if (it[k] !== undefined && !Number.isFinite(it[k])) { why.push(p.label + ' frame ' + i + ': ' + it.key + ' has ' + k + ' = ' + it[k]); break; }
      }
      for (const it of f.items) if (it.kind === 'edge' || it.kind === 'arrow') for (const end of [it.from, it.to]) if (typeof end === 'string' && !keys.has(end)) why.push(p.label + ' frame ' + i + ': the edge ' + it.key + ' joins ' + end + ', which is not drawn');
      if (/undefined|NaN|\[object|\bnull\b/.test(f.say || '')) why.push(p.label + ' frame ' + i + ': narration says "' + f.say.slice(0, 90) + '"');
      for (const x of T.topicLinks(f.say || '')) if (x.missing) why.push(p.label + ' frame ' + i + ': the narration links to [[' + x.id + ']], which is not a topic');
      for (const it of f.items) for (const k of ['text', 'label', 'sub', 'top', 'bottom']) if (typeof it[k] === 'string' && /undefined|NaN|\[object/.test(it[k])) why.push(p.label + ' frame ' + i + ': ' + it.key + ' shows "' + it[k] + '"');
      const q = f.predict;
      if (!q) return;
      predicts++;
      if (i === r.frames.length - 1) why.push(p.label + ': a prediction on the last frame has nothing to reveal');
      if (!q.ask) why.push(p.label + ' frame ' + i + ': a prediction without a question');
      if (q.pick === 'option') { if (!q.options || ![].concat(q.answer).map(String).some((a) => q.options.map(String).includes(a))) why.push(p.label + ' frame ' + i + ': the answer ' + q.answer + ' is not among the options'); }
      else if (![].concat(q.answer).some((a) => keys.has(a))) why.push(p.label + ' frame ' + i + ': the answer ' + q.answer + ' is to be clicked but is not drawn');
    });
    if (verbose) console.log('  ' + t.id + ' / ' + p.label + ': ' + r.frames.length + ' frames, ' + r.frames.filter((f) => f.predict).length + ' predictions');
  }
  if (!predicts) why.push('no prediction fires with the default input or any preset');
  const uniq = [...new Set(why)];
  if (uniq.length) { fail++; console.log('FAIL ' + t.id + '\n    ' + uniq.slice(0, 12).join('\n    ')); } else pass++;
}
for (const b of broken) { fail++; console.log('FAIL ' + b + ' (the file does not load)'); }
if (!T.topics.length) console.log('no topics yet (they go in src/topics/)');
console.log(pass + ' topics ok, ' + fail + ' with problems (' + runs + ' runs, ' + frames + ' frames, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
if (fail) process.exitCode = 1;
