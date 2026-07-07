// The kernel's sentences. The exit event names the line that ended the process: the exit call's, or main's
// return statement, or main's closing brace when it ran off the end. Then every sentence of seeded runs of every
// test program (tests/c, tests/c/kern) is scanned for slips: undefined or NaN, a doubled word, "a" before a vowel
// or "an" before a consonant, and a count that disagrees with its noun ("1 bytes", "3 reference").
import { load, harness } from './load.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = harness('kern-say');
const S = load(['core']);
const K = S.Kern;
const exitLine = (src, o) => { const s = K.run(src, o); const e = s.trace.find((x) => x.kind === 'exit'); return [e.line, e.say.match(/line `(\d+)`/)[1] | 0]; };

t.eq(exitLine('int main(void) {\n  int x = 1;\n  return x;\n}'), [3, 3], 'return from main: its return statement\'s line');
t.eq(exitLine('int main(void) {\n  int x = 1;\n}'), [3, 3], 'running off the end of main: its closing brace');
t.eq(exitLine('int main(void) {\n  int x = 0;\n  if (x)\n    return 4;\n  x = 2;\n\n}'), [7, 7], 'a return not taken: the closing brace');
t.eq(exitLine('#include <stdlib.h>\nvoid die(int c) {\n  exit(c);\n}\nint main(void) {\n  die(2);\n  return 0;\n}'), [3, 3], 'exit inside a function: the exit call\'s line');
t.eq(exitLine('#include <stdlib.h>\n#include <pthread.h>\nvoid *f(void *a) {\n  exit(5);\n  return 0;\n}\nint main(void) {\n  pthread_t x;\n  pthread_create(&x, NULL, f, NULL);\n  pthread_join(x, NULL);\n  return 0;\n}', { policy: 'fifo' }), [4, 4], 'exit in a thread: that thread\'s line');
const z = K.run('int main(void) {\n  return 7;\n}').trace.find((e) => e.kind === 'zombie');
t.ok(/returns `7` from main at line `2`/.test(z.say), 'the zombie sentence says main returned, and where');

// a kernel sentence that ends with a message carrying its own full stop gets only one
{
  const s = K.run('int main(void) {\n  int *p = 0;\n  return *p;\n}');
  const e = s.trace.find((x) => x.kind === 'error');
  t.ok(e && !/\.\.$/.test(e.say) && /\.$/.test(e.say), 'a crash sentence ends with one full stop');
}
// ---- the scan ------------------------------------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const progs = [];
for (const d of [join(here, 'c'), join(here, 'c', 'kern')]) for (const f of readdirSync(d).filter((x) => x.endsWith('.c'))) progs.push([f, readFileSync(join(d, f), 'utf8')]);
const NOUNS = 'byte|reference|second|process|child|thread|page|step|line|descriptor|signal|state';
const slips = (say) => {
  const bad = [];
  const plain = say.replace(/`[^`]*`/g, (m) => (/^`\d+`$/.test(m) ? m.slice(1, -1) : 'X'));
  if (/undefined|NaN|\[object/.test(say)) bad.push('undefined or NaN');
  if (/(^|[^.])\.\.(?!\.)/.test(say)) bad.push('a double full stop');
  const dbl = /\b([A-Za-z]+) \1\b/i.exec(plain);
  if (dbl) bad.push('doubled "' + dbl[1] + '"');
  if (/\ba [aeiou]/i.test(plain.replace(/\ba (u[^n]|one\b|uni)/gi, ''))) bad.push('"a" before a vowel');
  if (/\ban [b-df-hj-np-tv-z]/i.test(plain.replace(/\ban (h(our|onest))/gi, '').replace(/\ban [A-Z]{2,}/g, ''))) bad.push('"an" before a consonant');
  if (new RegExp('\\b1 (' + NOUNS + ')s\\b').test(plain)) bad.push('1 with a plural');
  if (new RegExp('\\b([02-9]|\\d{2,}) (' + NOUNS + ')\\b(?!s)').test(plain)) bad.push('a count with a singular');
  return bad;
};
// the scan itself catches what it should, and lets good sentences through
for (const [bad, kind] of [['It has 1 references left.', '1 with'], ['It writes `3` byte.', 'a count'], ['It runs a handler on a own stack.', '"a"'], ['It is an pipe.', '"an"'], ['It reads the the pipe.', 'doubled'], ['Line undefined.', 'undefined'], ['It stops the program..', 'double']]) t.ok(slips(bad).some((x) => x.includes(kind.replace(/"/g, '"'))), 'the scan catches: ' + bad);
for (const good of ['It has 1 reference left.', 'It writes `3` bytes.', 'An open file, a handler, an EPIPE, a unit.']) t.eq(slips(good), [], 'the scan passes: ' + good);
let n = 0;
for (const [f, src] of progs) {
  for (const seed of [1, 2, 3]) {
    let sys;
    try { sys = K.run(src, { policy: 'random', seed, snap: false }); } catch (e) { t.ok(false, f + ': runs (' + e.message + ')'); continue; }
    for (const e of sys.trace) {
      n++;
      const bad = slips(e.say || '');
      t.ok(!bad.length, f + ' seed ' + seed + ' ' + e.kind + ': ' + bad.join(', ') + ' in: ' + e.say);
    }
  }
}
t.ok(n > 1000, 'the scan read ' + n + ' sentences');
t.done();
