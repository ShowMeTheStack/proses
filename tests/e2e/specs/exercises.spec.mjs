// The operating-systems exercise kinds in the page: each kind's sample exercise is registered at run time and opened,
// its answer area filled the way a student would (painting a Gantt chart, clicking graph nodes, typing fields,
// writing C in the editor), and checked: the right answer passes, a wrong one is marked.
import { assert } from '../lib.mjs';

const REG = `(() => {
  const C = Proses.Content, K = Proses.Check;
  if (!C.chapters.some((c) => c.id === 'kx')) C.chapter({ id: 'kx', part: 'processes', n: 99, title: 'Kinds' });
  for (const [name, kind] of Object.entries(K.kinds)) {
    if (!kind.example) continue;
    const x = Object.assign(kind.example(), { chapter: 'kx' });
    if (!C.exercises.has(x.id)) C.exercise(x);
  }
  return C.exercises.size;
})()`;
const open = async (p, id) => { await p.ev(REG); await p.route('exercise=' + id); await p.wait("!!document.querySelector('#exerciseView')"); };
const check = async (p) => { await p.click('#btnCheck'); await p.wait("!!document.querySelector('#exResult .ex-v')", 15000); return p.ev("document.querySelector('#exResult').className.includes('ok')"); };
const fill = (p, map) => p.fn((m) => { for (const [k, v] of Object.entries(m)) { const i = document.querySelector('#answer [data-key="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; }, map);

export default function (t) {
  t.test('every kind has an answer area', async (p) => {
    const n = await p.ev(REG);
    assert.ok(n >= 13, 'examples registered: ' + n);
    for (const id of ['k-gantt', 'k-split', 'k-walk', 'k-repl', 'k-banker', 'k-cycle', 'k-fork', 'k-tree', 'k-code', 'k-inode', 'k-disk', 'k-raid', 'k-sem']) {
      await open(p, id);
      assert.ok(!(await p.ev("/has no answer area/.test(document.querySelector('#answer').innerText)")), id + ' has its own answer area');
    }
    assert.deepEqual(p.newExceptions(), []);
  });

  t.test('a Gantt chart painted tick by tick, and its metrics', async (p) => {
    await open(p, 'k-gantt');
    const sol = await p.ev("Proses.Check.kinds.gantt.solve(Proses.Content.exercises.get('k-gantt'))");
    for (let k = 0; k < sol.ticks.length; k++) {
      await p.click('.ex-penbtn[data-v="' + sol.ticks[k] + '"]');
      await p.click('.ex-tick[data-k="' + k + '"]');
    }
    await fill(p, Object.fromEntries(Object.entries(sol.metrics).map(([k, v]) => [k, '9' === v ? '8' : v])));
    assert.equal(await check(p), false, 'a wrong metric fails');
    assert.ok(await p.exists('.fill-table input.wrong'), 'the wrong cell is marked');
    await fill(p, sol.metrics);
    assert.equal(await check(p), true, 'the chart and metrics pass');
  });

  t.test('fields: an address split, a disk order, a parity byte', async (p) => {
    await open(p, 'k-split');
    await fill(p, { L1: '2', L2: '0x37', offset: '0xE4' });
    assert.equal(await check(p), true);
    await fill(p, { offset: '0xE5' });
    assert.equal(await check(p), false);
    assert.ok(await p.exists('#answer input.wrong[data-key="offset"]'));
    await open(p, 'k-disk');
    await fill(p, { order: '72 91 44 30 150 186', movement: '248' });
    assert.equal(await check(p), true);
    await open(p, 'k-raid');
    await fill(p, { v: 'a1' });
    assert.equal(await check(p), true);
  });

  t.test('click the cycle in a resource-allocation graph', async (p) => {
    await open(p, 'k-cycle');
    for (const n of ['P1', 'R2', 'P2']) await p.click('.ex-node[data-name="' + n + '"]');
    assert.equal(await check(p), false, 'three of the four nodes');
    await p.click('.ex-node[data-name="R1"]');
    assert.match(await p.text('.ex-picked'), /P1/);
    assert.equal(await check(p), true, 'the whole cycle');
  });

  t.test('a process table: parents, zombie and orphan', async (p) => {
    await open(p, 'k-tree');
    await p.fn(() => { for (const s of document.querySelectorAll('.ex-ptab select')) { s.value = 'P'; s.dispatchEvent(new Event('change', { bubbles: true })); } return 1; });
    await p.click('input[aria-label="A is a zombie"]');
    await p.click('input[aria-label="B is an orphan"]');
    assert.equal(await check(p), true);
  });

  t.test('code: the editor shows a compile error at its place, and a right program passes', async (p) => {
    await open(p, 'k-code');
    assert.ok(await p.exists('#answer .le'), 'the C editor');
    await p.setValue('#ansCode', 'int main(void) {\n    int a = ;\n    return 0;\n}\n');
    assert.equal(await check(p), false);
    await p.wait("!!document.querySelector('#answer .le-err')");
    assert.match(await p.text('#answer .le-msg'), /line 2/);
    const sol = await p.ev("Proses.Content.exercises.get('k-code').solution");
    await p.setValue('#ansCode', sol);
    assert.equal(await check(p), true);
    assert.ok(await p.fitsPhone(), 'no sideways scroll on a phone');
  });
}
