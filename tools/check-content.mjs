// Check the content: node tools/check-content.mjs [id or chapter prefix] [--verbose]
// Every exercise: its kind exists, its solution passes its own checker, every one of its wrong answers fails (with
// the message shown under --verbose; a table with none listed gets its solution with one cell changed), and it has
// three hints (the last a worked answer). A kind may lint its own fields (S.Check.kinds[kind].lint). Every lesson
// block names things that exist (topics, exercises, lessons, challenges, demo scenes), its predictions have an answer
// among their options. Every challenge: its kind exists, its reference answer reaches the target, every wrong one
// does not, and it has a story and three hints (S.Challenges.lint). Every course step and tour step is complete.
// Anything marked sample: true is placeholder content: a warning now, to be replaced before release.
import { files } from '../tests/load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout, TextEncoder, TextDecoder, crypto: globalThis.crypto });
// every file on its own, so a topic being written elsewhere that does not load yet only costs its topics
for (const f of files(['core', 'stage', 'demo', 'topics', 'app', 'content'])) {
  try { vm.runInContext(readFileSync(join(root, 'src', f), 'utf8'), ctx, { filename: f }); }
  catch (e) { if (/^(topics|demo)\//.test(f)) console.log('WARN ' + f + ' does not load: ' + e.message); else throw e; }
}
// --extra file.js loads one more content file (a scratch file to try the checker on)
if (process.argv.includes('--extra')) { const f = process.argv[process.argv.indexOf('--extra') + 1]; vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f }); }
const S = vm.runInContext('globalThis.Proses', ctx);
const C = S.Content, K = S.Check;
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--extra')[0];
const verbose = process.argv.includes('--verbose');
const want = (x) => !only || x.id.startsWith(only) || String(x.chapter || '').startsWith(only);
let ok = 0, bad = 0, warn = 0, answers = 0, nx = 0, nl = 0, nch = 0;
const report = (what, id, why, isWarn) => {
  if (!why.length) { ok++; if (verbose) console.log('ok   ' + what + ' ' + id); return; }
  if (isWarn) { warn++; console.log('WARN ' + what + ' ' + id + '\n    ' + why.join('\n    ')); return; }
  bad++; console.log('FAIL ' + what + ' ' + id + '\n    ' + why.join('\n    '));
};
for (const e of C.errors) { if (only && !e.includes(only)) continue; bad++; console.log('FAIL registry: ' + e); }
for (const x of [...C.chapters, ...C.lessons.values(), ...C.exercises.values(), ...C.courses.values(), ...C.challenges.values(), ...(S.topics || []), ...(S.families || [])]) {
  if (x.sample && want(x)) { warn++; console.log('WARN ' + x.id + ' is marked sample: true: placeholder content, to be replaced before release'); }
}
const short = (v) => (typeof v === 'string' ? v : JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x + 'n' : x))).replace(/\s+/g, ' ').slice(0, 100);

// ---- exercises ----------------------------------------------------------------------------------------------
const t0 = Date.now();
function exerciseProblems(x) {
  const why = [];
  if (!K.kinds[x.kind]) why.push('unknown kind ' + x.kind + ' (the kinds: ' + (K.kindNames || Object.keys(K.kinds)).join(', ') + ')');
  else {
    if (x.solution === undefined) why.push('no solution');
    else {
      answers++;
      const r = K.answer(x, x.solution);
      if (!r.ok) why.push('the solution fails: ' + r.message);
      else if (verbose) console.log('     ' + x.id + ' solution: ' + r.message);
    }
    // a table needs no listed wrong answer: its solution with one cell changed must fail
    let wrongs = x.wrong || [];
    if (!wrongs.length && x.kind === 'table' && x.solution && typeof x.solution === 'object') {
      const k = Object.keys(x.solution)[0], v = String(x.solution[k]);
      wrongs = [Object.assign({}, x.solution, { [k]: v === '0' ? '1' : v === '1' ? '0' : v + 'x' })];
    }
    // a kind may make its own wrong answer from the solution (a matrix with one cell changed)
    if (!wrongs.length && K.kinds[x.kind].wrongFrom) wrongs = K.kinds[x.kind].wrongFrom(x);
    if (!wrongs.length) why.push('no wrong answers to try');
    for (const w of wrongs) {
      answers++;
      const r = K.answer(x, w);
      if (r.ok) why.push('a wrong answer passes: ' + short(w));
      else if (!r.message || /could not be checked|cannot be checked/.test(r.message)) why.push('a wrong answer breaks the checker: ' + short(w) + ': ' + r.message);
      else if (verbose) console.log('     ' + x.id + ' wrong ' + short(w) + '\n       → ' + r.message);
    }
    if (x.kind === 'table') { try { K.tableSpec(x); } catch (e) { why.push('the table cannot be built: ' + e.message); } }
    if (K.kinds[x.kind] && K.kinds[x.kind].lint) for (const e of K.kinds[x.kind].lint(x) || []) why.push(e);
    if (x.kind === 'choice' && [].concat(x.answer).some((i) => !(i >= 0 && i < (x.options || []).length))) why.push('the answer is not one of the options');
  }
  if (!x.text || (Array.isArray(x.text) && !x.text.length)) why.push('no text');
  if (!x.hints || x.hints.length !== 3) why.push('three hints are needed, the last a worked answer (it has ' + ((x.hints || []).length) + ')');
  return why;
}
for (const x of C.exercises.values()) {
  if (!want(x)) continue;
  nx++;
  report('exercise', x.id, exerciseProblems(x));
}

// ---- --kinds: every kind's own sample exercise (S.Check.kinds[kind].example()) through the same checks ----------------
if (process.argv.includes('--kinds')) {
  let nk = 0;
  for (const [name, kind] of Object.entries(K.kinds)) {
    if (only && !name.startsWith(only)) continue;
    nk++;
    if (!kind.example) { report('kind', name, ['no example(): a kind brings a sample exercise, so this check can try it'], ['choice', 'string', 'number', 'set', 'table'].includes(name)); continue; }
    // a kind may bring several samples (examples()), one for each of its modes
    let xs;
    try { xs = kind.examples ? kind.examples() : [kind.example()]; } catch (e) { report('kind', name, ['example() throws: ' + e.message]); continue; }
    xs.forEach((x, k) => report('kind', name + (xs.length > 1 ? ' (' + (x.id || 'sample ' + (k + 1)) + ')' : ''), exerciseProblems(Object.assign({ kind: name }, x))));
  }
  // and every challenge kind's sample challenge (S.Challenges.kinds[kind].example()) through S.Challenges.lint
  let nck = 0;
  for (const [name, kind] of Object.entries((S.Challenges && S.Challenges.kinds) || {})) {
    if (only && !name.startsWith(only)) continue;
    nck++;
    if (!kind.example) { report('challenge kind', name, ['no example(): a challenge kind brings a sample challenge, so this check can try it']); continue; }
    let xs;
    try { xs = (kind.examples ? kind.examples() : [kind.example()]).map((y) => Object.assign({ kind: name }, y)); } catch (e) { report('challenge kind', name, ['example() throws: ' + e.message]); continue; }
    for (const x of xs) {
    const why = [];
    if (!x.hints || x.hints.length !== 3) why.push('three hints are needed (it has ' + (x.hints || []).length + ')');
    try { const r = S.Challenges.lint(x, { verbose }); answers += r.answers || 0; why.push(...r.problems); if (verbose) for (const n of r.notes || []) console.log('     ' + name + ' ' + n); } catch (e) { why.push('the check failed: ' + (e.stack || e.message)); }
    report('challenge kind', name + (xs.length > 1 ? ' (' + x.id + ')' : ''), why);
    }
  }
  console.log(ok + ' ok, ' + bad + ' with problems, ' + warn + ' warnings (' + nk + ' exercise kinds, ' + nck + ' challenge kinds, ' + answers + ' answers checked)');
  process.exit(bad ? 1 : 0);
}

// ---- lab presets: a lesson's lab card (S.Labs.preset(id, values)) names a lab that exists, and its setup passes ------
// the lab's own check (S.LabSetup.check) with every value it gives belonging to one of the lab's fields
function labProblems(id, setup) {
  const lab = S.Labs && S.Labs.get(id);
  if (!lab) return ['no lab ' + id + ' (the labs: ' + ((S.Labs && S.Labs.all().map((l) => l.id).join(', ')) || 'none') + ')'];
  if (setup === undefined || setup === null) return [];
  if (!lab.shell) return lab.preset ? [] : ['the lab ' + id + ' cannot be opened set up (it has no preset)'];
  const out = [], fields = ((lab.setup && lab.setup.fields) || []).map((f) => f.id);
  for (const k of Object.keys(setup)) if (!fields.includes(k)) out.push('the setup for lab ' + id + ' gives ' + k + ', which is none of its fields (' + fields.join(', ') + ')');
  try { const e = S.LabSetup.check(lab, S.LabSetup.merge(lab, setup)); if (e) out.push('the setup for lab ' + id + ' is refused: ' + e); } catch (e) { out.push('the setup for lab ' + id + ' cannot be checked: ' + e.message); }
  return out;
}

// ---- lessons -------------------------------------------------------------------------------------------------
for (const l of C.lessons.values()) {
  if (!want(l)) continue;
  nl++;
  const why = [];
  if (!l.blocks || !l.blocks.length) why.push('no blocks');
  (l.blocks || []).forEach((b, i) => {
    const at = 'block ' + (i + 1) + ': ';
    if (typeof b === 'string') return;
    if (b.topic && !S.byId(b.topic)) why.push(at + 'no topic ' + b.topic);
    if (b.topic && S.byId(b.topic) && b.input) { const t = S.byId(b.topic); const e = S.checkInput(t, S.inputOf(t, Object.assign(S.inputOf(t), b.input))); if (e) why.push(at + 'the input is refused: ' + e); }
    if (b.topic && S.byId(b.topic) && b.frame) { try { const t = S.byId(b.topic); const r = t.run(S.inputOf(t, Object.assign(S.inputOf(t), b.input || {}))); if (b.frame >= r.frames.length) why.push(at + 'frame ' + b.frame + ' is past the last frame (' + (r.frames.length - 1) + ')'); } catch (e) { why.push(at + 'the topic does not run: ' + e.message); } }
    if (b.exercise && !C.exercises.has(b.exercise)) why.push(at + 'no exercise ' + b.exercise);
    if (b.lesson && !C.lessons.has(b.lesson)) why.push(at + 'no lesson ' + b.lesson);
    if (b.challenge && !C.challenges.has(b.challenge)) why.push(at + 'no challenge ' + b.challenge);
    if (b.predict && !(b.predict.answer >= 0 && b.predict.answer < (b.predict.options || []).length)) why.push(at + 'the prediction\'s answer is not an option');
    if (b.scene && !(S.Demo && S.Demo.byId(b.scene))) why.push(at + 'no demo scene ' + b.scene);
    if (b.lab !== undefined) why.push(...labProblems(b.lab, b.setup).map((e) => at + e));
  });
  report('lesson', l.id, why);
}

// ---- challenges ------------------------------------------------------------------------------------------------
// S.Challenges.lint(x, {verbose}) -> {problems: [..], notes: [..], answers: n} scores the reference answer and the wrong
// ones through the challenge's kind (src/app/challenges-core.js)
for (const x of C.challenges.values()) {
  if (!want(x)) continue;
  nch++;
  const why = [];
  if (!x.hints || x.hints.length !== 3) why.push('three hints are needed (it has ' + (x.hints || []).length + ')');
  if (!S.Challenges || !S.Challenges.lint) why.push('the challenge engine (S.Challenges.lint) is missing');
  else {
    try {
      const r = S.Challenges.lint(x, { verbose });
      answers += r.answers || 0;
      why.push(...r.problems);
      if (verbose) for (const n of r.notes || []) console.log('     ' + x.id + ' ' + n);
    } catch (e) { why.push('the check failed: ' + (e.stack || e.message)); }
  }
  report('challenge', x.id, why);
}

// ---- courses and tours ------------------------------------------------------------------------------------------
let ncourse = 0, ntour = 0;
for (const c of C.courses.values()) {
  if (!want(c)) continue;
  ncourse++;
  const why = [];
  for (const s of c.steps) { const st = C.stepOf(s); if (!C.stepExists(st)) why.push('no ' + st.type + ' ' + st.id); }
  report('course', c.id, why);
}
for (const t of C.tours.values()) {
  if (!want(t)) continue;
  ntour++;
  const why = [];
  t.steps.forEach((s, i) => { if (!s.text) why.push('step ' + (i + 1) + ' has no text'); if (s.lab !== undefined) why.push(...labProblems(s.lab, s.setup).map((e) => 'step ' + (i + 1) + ': ' + e)); });
  if (t.steps[0] && t.steps[0].route === undefined && t.steps[0].lab === undefined) why.push('the first step needs a route, so the tour starts in the right place');
  report('tour', t.id, why);
}
console.log(ok + ' ok, ' + bad + ' with problems, ' + warn + ' warnings (' + nx + ' exercises, ' + answers + ' answers checked in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's; ' + nl + ' lessons, ' + nch + ' challenges, ' + ncourse + ' courses, ' + ntour + ' tours)');
if (bad) process.exitCode = 1;
