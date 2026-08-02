// The lab framework in node: share codes (pack and unpack, compressed, URL-safe, damaged codes refused), lab share
// links, the registry (add, hidden labs, presets), the setup's typed values (defaults, merge, check), the widgets'
// parsers, and the C highlighter (every character kept, tokens classed).
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(share|lab-0-registry|lab-widgets|lab-setup|lab-views|lab-editor)\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('app-labs');

// ---- share codes ----------------------------------------------------------------------------------------------
const values = [
  { lab: 'scheduler', setup: { work: [{ id: 'A', arrive: 0, bursts: [3, 2, 4] }], policy: 'rr', q: 2, cs: false }, seed: 17 },
  { src: '#include <stdio.h>\nint main(void) { printf("héllo → ∅\\n"); return 0; }\n', n: -0.5, big: 'x'.repeat(5000) },
  [1, 2, [3, { a: null }]], 'plain', 0, true,
];
for (const v of values) {
  const code = await S.Share.pack(v);
  t.ok(/^P1\.[zr][A-Za-z0-9_-]+$/.test(code), 'a share code is URL-safe: ' + code.slice(0, 20));
  t.eq(await S.Share.unpack(code), v, 'a value comes back from its code');
  t.eq(await S.Share.unpack('https://x.org/#share=' + code), v, 'a whole link holding the code reads too');
}
const long = await S.Share.pack({ big: 'abc '.repeat(4000) });
t.ok(long.length < 400, 'compression keeps a repetitive setup short (' + long.length + ' characters)');
const rnd = rng(5);
for (let k = 0; k < 40; k++) {
  const v = { rows: Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({ id: String.fromCharCode(65 + i), arrive: Math.floor(rnd() * 20), bursts: Array.from({ length: 1 + 2 * Math.floor(rnd() * 3) }, () => 1 + Math.floor(rnd() * 9)) })), seed: Math.floor(rnd() * 1e6) };
  t.eq(await S.Share.unpack(await S.Share.pack(v)), v, 'random workload ' + k + ' round-trips');
}
const refuse = async (code, re, what) => { try { await S.Share.unpack(code); t.ok(false, what + ' is refused'); } catch (e) { t.ok(re.test(e.message), what + ': ' + e.message); } };
const good = await S.Share.pack({ a: 1 });
await refuse('nothing here', /does not look like/, 'a text with no code');
await refuse(good.slice(0, good.length - 6), /damaged|incomplete/, 'a cut code');
await refuse('P1.z' + good.slice(4).split('').reverse().join(''), /damaged|incomplete/, 'a scrambled code');
const raw = 'P1.r' + Buffer.from(JSON.stringify({ v: 2, d: 1 })).toString('base64url');
await refuse(raw, /newer version/, 'a code from a newer version');

// ---- lab links ----------------------------------------------------------------------------------------------------
const lab = { id: 'sample-x', title: 'X' };
const hash = await S.LabViews.link(lab, { a: [1, 2, 3], s: 'two words' }, 42);
t.ok(hash.startsWith('labs/sample-x?s=P1.'), 'a lab link names the lab and carries the code: ' + hash.slice(0, 30));
const back = await S.LabViews.readLink(hash.replace(/^labs\/sample-x\?/, ''));
t.eq(back, { lab: 'sample-x', values: { a: [1, 2, 3], s: 'two words' }, seed: 42 }, 'the link reads back to the setup and the seed');
t.eq(await S.LabViews.readLink('nothing'), null, 'no code: no setup');

// ---- the registry -------------------------------------------------------------------------------------------------
const L = S.Labs;
t.ok(L.planned.length === 10, 'ten labs are planned');
L.add({ id: 'scheduler', title: 'Scheduler lab', run: () => ({ frames: [] }) });
L.add({ id: 'zz-hidden', title: 'Hidden', hidden: true, run: () => ({ frames: [] }) });
t.ok(L.list().some((l) => l.id === 'scheduler') && !L.list().some((l) => l.id === 'zz-hidden'), 'hidden labs open but are not listed');
t.ok(L.all().some((l) => l.id === 'zz-hidden'), 'every lab is in all()');
t.eq(L.get('scheduler').icon, 'history', 'a planned lab keeps its planned icon');
t.ok(/Gantt/.test(L.get('scheduler').blurb), 'and its planned blurb when it gives none');
L.preset('scheduler', { q: 3 });
t.eq(L.takePreset('scheduler'), { q: 3 }, 'a preset is taken once');
t.eq(L.takePreset('scheduler'), null, 'and only once');
let threw = false; try { L.add({ id: 'bad' }); } catch (e) { threw = true; }
t.ok(threw, 'a lab with no run is refused');

// ---- typed setup values ------------------------------------------------------------------------------------------
const W = S.LabWidgets;
t.eq(W.parseCell({ type: 'int', min: 0 }, ' 7 '), { value: 7 }, 'an int cell');
t.ok(/not a whole number/.test(W.parseCell({ type: 'int' }, '2.5').error), 'a fraction is not an int');
t.ok(/at least 1/.test(W.parseCell({ type: 'int', min: 1 }, '0').error), 'an int below its least');
t.eq(W.parseCell({ type: 'int' }, '−3'), { value: -3 }, 'a typographic minus reads as minus');
t.eq(W.parseCell({ type: 'ints', min: 1 }, '3, 2  4'), { value: [3, 2, 4] }, 'a list of ints in one cell');
t.ok(/odd/.test(W.parseCell({ type: 'ints', odd: 'an odd count' }, '3 2').error), 'bursts need an odd count');
t.ok(/one capital/.test(W.parseCell({ type: 'text', pattern: '^[A-Z]$', patternWhy: 'one capital letter' }, 'ab').error), 'a text cell with a pattern');
t.eq(W.parseCell({ type: 'select', options: [{ value: 4, label: 'four' }] }, '4'), { value: 4 }, 'a select cell keeps the option value');
t.eq(W.parseList('7 0 1, 2;0', { kind: 'int' }), { value: [7, 0, 1, 2, 0] }, 'a reference string');
t.ok(/item 3/.test(W.parseList('1 2 x', { kind: 'int' }).error), 'a bad item is named by its place');
t.ok(/at most 4/.test(W.parseList('1 2 3 4 5', { maxLen: 4 }).error), 'a list too long');
t.ok(/at most 199/.test(W.parseList('10 200', { max: 199 }).error), 'an item over the most');
t.eq(W.parseList('a b', { kind: 'text' }), { value: ['a', 'b'] }, 'a list of words');

const LS = S.LabSetup;
const demo = {
  id: 'd', title: 'D', run() {},
  setup: {
    fields: [
      { id: 'policy', type: 'select', options: [{ value: 'fcfs', label: 'FCFS' }, { value: 'rr', label: 'RR' }] },
      { id: 'q', type: 'number', min: 1, max: 8, def: 2, show: (v) => v.policy === 'rr' },
      { id: 'on', type: 'toggle', on: 1, off: 0 },
      { id: 'refs', type: 'list', def: [1, 2, 3], min: 0, max: 9, maxLen: 5 },
      { id: 'work', type: 'table', def: [{ id: 'A', arrive: 0 }], columns: [{ id: 'id', label: 'Job', type: 'text' }, { id: 'arrive', label: 'Arrives', type: 'int', min: 0 }] },
      { id: 'm', type: 'matrix', def: [[1, 0], [0, 1]], max: 3 },
      { id: 'src', type: 'code', def: 'int main(void) { return 0; }' },
    ],
    check: (v) => (v.refs.length > 3 && v.on ? 'with the toggle on, at most 3 references' : null),
  },
};
t.eq(LS.defaults(demo), { policy: 'fcfs', q: 2, on: 0, refs: [1, 2, 3], work: [{ id: 'A', arrive: 0 }], m: [[1, 0], [0, 1]], src: 'int main(void) { return 0; }' }, 'the defaults of every field type');
t.eq(LS.merge(demo, { q: 5, other: 1 }).q, 5, 'a given value is kept');
t.ok(!('other' in LS.merge(demo, { other: 1 })), 'a value for no field is dropped');
t.eq(LS.check(demo, LS.defaults(demo)), null, 'the defaults pass');
t.eq(LS.check(demo, Object.assign(LS.defaults(demo), { q: 99 })), null, 'a hidden field is not checked');
t.ok(/at most 8/.test(LS.check(demo, Object.assign(LS.defaults(demo), { policy: 'rr', q: 99 }))), 'a shown field is');
t.ok(/choose one/.test(LS.check(demo, Object.assign(LS.defaults(demo), { policy: 'sjf' }))), 'a select outside its options');
t.ok(/at most 5 items/.test(LS.check(demo, Object.assign(LS.defaults(demo), { refs: [1, 2, 3, 4, 5, 6] }))), 'a list over its length');
t.ok(/Arrives: at least 0/.test(LS.check(demo, Object.assign(LS.defaults(demo), { work: [{ id: 'A', arrive: -1 }] }))), 'a table cell out of range');
t.ok(/between 0 and 3/.test(LS.check(demo, Object.assign(LS.defaults(demo), { m: [[4, 0], [0, 1]] }))), 'a matrix cell out of range');
t.ok(/at most 3 references/.test(LS.check(demo, Object.assign(LS.defaults(demo), { on: 1, refs: [1, 2, 3, 4] }))), 'the setup\'s own check');

// ---- the C highlighter ------------------------------------------------------------------------------------------------
const src = '#include <stdio.h>\n/* a comment\n   over lines */\nint main(void) {\n    pid_t k = fork(); // a child\n    if (k == 0) printf("in %d\\n", 0x1F);\n    return \'a\' < 3.5e2;\n}';
const lines = S.LabEditor.highlight(src);
const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
t.eq(lines.length, src.split('\n').length, 'one highlighted line per line');
t.eq(lines.map(plain), src.split('\n'), 'highlighting keeps every character');
const has = (i, cls, text) => t.ok(lines[i].includes('<span class="ck-' + cls + '">' + text), 'line ' + (i + 1) + ': ' + text + ' is ' + cls);
has(0, 'pre', '#include'); has(0, 'str', '&lt;stdio.h&gt;'); has(1, 'com', '/* a comment'); has(2, 'com', '   over lines */');
has(3, 'type', 'int'); has(3, 'fn', 'main'); has(4, 'type', 'pid_t'); has(4, 'sys', 'fork'); has(4, 'com', '// a child');
has(5, 'kw', 'if'); has(5, 'fn', 'printf'); has(5, 'str', '"in %d\\n"'); has(5, 'num', '0x1F'); has(6, 'chr', "'a'"); has(6, 'num', '3.5e2');
t.done();
