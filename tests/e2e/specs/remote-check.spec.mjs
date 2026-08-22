// Long checks off the page: a code exercise and a challenge's hidden tests run in a Web Worker made from the page's
// own scripts, with a progress line and Cancel; the page stays responsive meanwhile; with no worker they still run.
import { assert } from '../lib.mjs';

const REG = `(() => {
  const C = Proses.Content;
  if (!C.chapters.some((c) => c.id === 'kinds')) C.chapter({ id: 'kinds', part: 'sync', title: 'Kinds' });
  for (const x of Proses.Check.kinds.code.examples()) if (!C.exercises.has(x.id)) C.exercise(x);
  const ch = Proses.Challenges.kinds['sync-solution'].example();
  if (!C.challenges.has(ch.id)) C.challenge(ch);
  return 1; })()`;

export default function (t) {
  t.test('a code exercise is checked in a worker, and the page stays responsive', async (p) => {
    await p.ev(REG);
    await p.route('exercise=k-code-gate');
    assert.ok(await p.ev('Proses.Remote.available()'), 'a worker can be made from the bundle');
    const sol = await p.ev("Proses.Content.exercises.get('k-code-gate').solution");
    await p.ev(`Proses.app.page.answer.editor.set(${JSON.stringify(sol)}, true)`);
    await p.click('#btnCheck');
    await p.wait("!!document.querySelector('#checkProgress')", 5000);
    // the page answers while the worker searches
    const t0 = Date.now(); await p.ev('1 + 1'); const lag = Date.now() - t0;
    assert.ok(lag < 1000, 'the page answers within a second while checking (' + lag + ' ms)');
    assert.ok(await p.ev('Proses.Remote.busy()'), 'the worker is busy');
    await p.wait("document.querySelector('#exResult.ok')", 120000);
    assert.match(await p.text('#exResult'), /every property holds/);
    assert.equal(await p.exists('#checkProgress'), false, 'the progress line goes');
  }, { timeout: 150000 });

  t.test('Cancel stops a check', async (p) => {
    await p.ev(REG);
    await p.route('exercise=k-code-gate');
    const wrong = await p.ev("Proses.Content.exercises.get('k-code-gate').wrong[0]");
    await p.ev(`Proses.app.page.answer.editor.set(${JSON.stringify(wrong)}, true)`);
    await p.click('#btnCheck');
    await p.wait("!!document.querySelector('#btnCancelCheck')", 5000);
    await p.click('#btnCancelCheck');
    await p.wait("/cancelled/.test(document.querySelector('#exResult').innerText)", 5000);
    assert.equal(await p.ev('Proses.Remote.busy()'), false);
    assert.equal(await p.ev("document.querySelector('#btnCheck').disabled"), false, 'Check works again');
  }, { timeout: 60000 });

  t.test('a challenge is scored in a worker, with progress', async (p) => {
    await p.ev(REG);
    await p.route('challenge/sample-sync-mailbox');
    const src = await p.ev("Proses.Content.challenges.get('sample-sync-mailbox').solution");
    await p.ev(`Proses.app.page.load(${JSON.stringify(src)})`);
    await p.click('#btnSubmit');
    await p.wait("!!document.querySelector('#checkProgress')", 5000);
    await p.wait("document.querySelector('#chResult.ok')", 120000);
    assert.match(await p.text('#chResult'), /Target reached/);
  }, { timeout: 150000 });

  t.test('with no worker the check runs on the page', async (p) => {
    await p.ev(REG);
    await p.route('exercise=k-code');
    await p.ev("(() => { Proses.Remote.available = () => false; return 1; })()");
    const sol = await p.ev("Proses.Content.exercises.get('k-code').solution");
    await p.ev(`Proses.app.page.answer.editor.set(${JSON.stringify(sol)}, true)`);
    await p.click('#btnCheck');
    await p.wait("document.querySelector('#exResult.ok')", 60000);
    assert.match(await p.text('#exResult'), /passed/);
  }, { timeout: 90000 });
}
