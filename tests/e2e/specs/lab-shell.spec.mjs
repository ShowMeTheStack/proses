// The lab shell with the framework's sample labs: the layout (setup, stage, narration, controls, side panel), the
// controls and keys, the seed, real inputs (select, number, toggle) that run the lab again, the table, list and
// matrix editors with their checks, the side panel's tabs, exports (trace JSON, SVG, PNG), the phone layout, and the
// Labs list (hidden samples stay off it, and a registered lab replaces its placeholder).
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):sample/.test(k)) localStorage.removeItem(k); return 1; })()"); });
  t.test('the layout: setup, stage, narration, controls and the side panel', async (p) => {
    await p.route('labs/sample-sched');
    for (const sel of ['#labSetup', '#labStage svg', '#labSay', '#labControls', '#labSide', '#btnLabRun', '#btnLabShare', '#btnLabExport']) assert.ok(await p.exists(sel), sel);
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /Step 1 of \d+/);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#labSide .tabs button')].map((b) => b.textContent)"), ['Tables', 'Metrics', 'Trace']);
    const s = await p.rect('#labSetup'), st = await p.rect('#labStage');
    assert.ok(s.x < st.x, 'the setup is left of the stage on a wide screen');
  });

  t.test('step, step back, reset, play and the keys', async (p) => {
    await p.route('labs/sample-sched');
    await p.click('#btnLabStep'); await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.key('ArrowRight');
    assert.equal(await p.ev(L('P.i')), 2, '→ steps');
    await p.key('Home');
    assert.equal(await p.ev(L('P.i')), 0, 'Home goes back to the start');
    await p.setValue('#labSpeed', '3', 'change');
    await p.click('#btnLabPlay');
    await p.wait(L('P.i >= 2'), 4000);
    await p.key(' ');
    const at = await p.ev(L('P.i'));
    await p.sleep(700);
    assert.equal(await p.ev(L('P.i')), at, 'Space pauses');
    await p.click('#btnLabReset');
    assert.equal(await p.ev(L('P.i')), 0);
    assert.equal(await p.ev("document.querySelector('#btnLabBack').disabled"), true);
  });

  t.test('a select, a number and a toggle run the lab again', async (p) => {
    await p.route('labs/sample-sched');
    const before = await p.ev(L('JSON.stringify(P.res.trace.map((s) => s.run))'));
    await p.setValue('#lab-policy', '0', 'change');
    await p.wait(L("P.values.policy === 'fcfs'"));
    await p.sleep(300);
    assert.notEqual(await p.ev(L('JSON.stringify(P.res.trace.map((s) => s.run))')), before, 'FCFS gives another chart');
    assert.equal(await p.ev("document.querySelector('[data-field=q]').hidden"), true, 'the quantum hides when it does not apply');
    await p.setValue('#lab-policy', '3', 'change');
    await p.setValue('#lab-q', '5');
    await p.sleep(300);
    assert.equal(await p.ev(L('P.values.q')), 5);
    await p.setValue('#lab-q', '50');
    assert.ok(await p.ev("document.querySelector('#lab-q').classList.contains('bad')"), 'a number out of range is marked');
    assert.match(await p.text('#labSetupErr'), /Quantum: at most 8/);
    await p.setValue('#lab-q', '2');
    const n = await p.ev(L('P.frames.length'));
    await p.click('.lab-toggle');
    await p.sleep(300);
    assert.equal(await p.ev(L('P.values.cs')), true, 'the toggle is on');
    assert.ok(await p.ev(L('P.frames.length')) > n, 'context switches make the run longer');
  });

  t.test('the same seed gives the same run; another seed may not', async (p) => {
    await p.route('labs/sample-proc');
    const run = () => p.ev(L('JSON.stringify(P.res.trace.map((s) => s.kind + s.pid))'));
    const a = await run();
    await p.click('#btnLabRun'); await p.sleep(200);
    assert.equal(await run(), a, 'run again: the same');
    const seen = new Set([a]);
    for (const s of [2, 3, 4, 5, 6]) { await p.setValue('#labSeed', String(s), 'change'); await p.sleep(200); seen.add(await run()); }
    assert.ok(seen.size > 1, 'some seed schedules differently');
    await p.setValue('#labSeed', '1', 'change'); await p.sleep(200);
    assert.equal(await run(), a, 'seed 1 again: the first run again');
  });

  t.test('the table editor: rows added and removed, bad cells marked with the reason', async (p) => {
    await p.route('labs/sample-sched');
    const rows = () => p.ev(L('P.values.work.length'));
    const n = await rows();
    await p.click('.lw-tablebox .lw-foot .btn');
    await p.sleep(250);
    assert.equal(await rows(), n + 1, 'a row is added');
    await p.setValue('.lw-table tbody tr:nth-child(2) input[data-col="bursts"]', '2 3');
    assert.match(await p.text('.lw-tablebox .lw-err'), /Row 2, Bursts.*odd count/);
    await p.setValue('.lw-table tbody tr:nth-child(2) input[data-col="bursts"]', '2 3 2');
    await p.setValue('.lw-table tbody tr:nth-child(3) input[data-col="id"]', 'A');
    assert.match(await p.text('.lw-tablebox .lw-err'), /two jobs are called A/);
    await p.setValue('.lw-table tbody tr:nth-child(3) input[data-col="id"]', 'C');
    await p.click('.lw-table tbody tr:last-child .lw-del');
    await p.sleep(250);
    assert.equal(await rows(), n);
  });

  t.test('the list and matrix editors in the banker sample', async (p) => {
    await p.route('labs/sample-bank');
    assert.equal(await p.count('.lw-matrix'), 2);
    await p.setValue('#lab-avail', '3 3 x');
    assert.match(await p.text('.lw-list .lw-err'), /Item 3/);
    assert.ok(await p.exists('.lw-chip.bad'), 'the bad item is marked');
    await p.setValue('#lab-avail', '3 3 2');
    await p.setValue('#lab-alloc input[data-i="0"][data-j="0"]', '9');
    await p.sleep(200);
    assert.match(await p.text('#labSetupErr'), /P0 holds more A than its Max/);
    await p.setValue('#lab-alloc input[data-i="0"][data-j="0"]', '0');
    await p.sleep(300);
    await p.click('[data-field=alloc] .lw-mbtn', '+ row');
    await p.sleep(200);
    assert.match(await p.text('#labSetupErr'), /same shape/, 'the shapes are checked against each other');
    await p.click('[data-field=alloc] .lw-mbtn', '− row');
    await p.sleep(300);
    assert.equal(await p.text('#labSetupErr'), '');
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    await p.click('#labTab-metrics');
    assert.match(await p.text('#labTabBody'), /safe/);
  });

  t.test('the side panel: tables follow the step, the trace jumps to a step', async (p) => {
    await p.route('labs/sample-sched');
    await p.click('#labTab-tables');
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.ok(!/–/.test(await p.text('#labTabBody tbody')), 'every job has its numbers at the end');
    await p.click('#labTab-trace');
    assert.ok((await p.count('#labTrace li')) > 5);
    await p.click('#labTrace li[data-i="4"]');
    assert.equal(await p.ev(L('P.frames[P.i].at')), 4, 'a click on a step shows it');
    assert.ok(await p.exists('#labTrace li.on[data-i="4"]'));
  });

  t.test('exports: the trace as JSON, the picture as SVG and PNG', async (p) => {
    await p.route('labs/sample-sched');
    await p.ev("(() => { window.__dl = []; Proses.UI.download = (name, data, type) => window.__dl.push({ name, type, size: data.size || data.length, text: typeof data === 'string' ? data : null }); return 1; })()");
    await p.click('#btnLabExport');
    await p.click('.menu-pop .menu-item', 'trace');
    await p.click('#btnLabExport');
    await p.click('.menu-pop .menu-item', 'SVG');
    await p.click('#btnLabExport');
    await p.click('.menu-pop .menu-item', 'PNG');
    await p.wait('window.__dl.length === 3');
    const dl = await p.ev('window.__dl');
    const tr = JSON.parse(dl[0].text);
    assert.equal(tr.lab, 'sample-sched');
    assert.ok(tr.trace.length > 5 && tr.setup.work.length === 4 && tr.seed === 1, 'the trace JSON holds the setup, the seed and the steps');
    assert.match(dl[1].text, /^<\?xml[\s\S]*<svg[\s\S]*fill:/, 'a standalone SVG with its colours written in');
    assert.equal(dl[2].type, 'image/png');
    assert.ok(dl[2].size > 2000, 'a PNG of some size');
  });

  t.test('on a phone: the stage first, nothing scrolls sideways', async (p) => {
    await p.viewport(390, 844, { mobile: true, touch: true });
    try {
      await p.route('labs/sample-proc');
      const st = await p.rect('#labStage'), se = await p.rect('#labSetup');
      assert.ok(st.y < se.y, 'the stage comes before the setup');
      assert.ok(await p.noHScroll());
      await p.route('labs/sample-sched');
      assert.ok(await p.noHScroll());
      assert.ok(await p.ev(L('P.builtNarrow')), 'the narrow frames are used');
    } finally { await p.viewport(1400, 900); }
  });

  t.test('the Labs list: hidden samples are off it; a registered lab replaces its placeholder', async (p) => {
    // an id the plan will never use, added to the registry's own planned list, so the test holds as real labs arrive
    await p.ev("Proses.Labs.planned.some((x) => x[0] === 'zz-e2e') || Proses.Labs.planned.push(['zz-e2e', 'Test lab', 'chip', 'A lab for the test.']); 1");
    await p.route('labs/x'); await p.route('labs');
    assert.equal(await p.exists('[data-lab="sample-sched"]'), false);
    assert.ok(await p.exists('.tool-card.soon[data-lab="zz-e2e"]'), 'a planned, unregistered lab shows as on its way');
    const unbuilt = await p.ev("Proses.Labs.planned.filter((x) => !Proses.Labs.get(x[0])).map((x) => x[0])");
    for (const id of unbuilt) assert.ok(await p.exists('.tool-card.soon[data-lab="' + id + '"]'), id + ' is a placeholder');
    await p.ev("Proses.Labs.add({ id: 'zz-e2e', title: 'Test lab', run: () => ({ frames: [{ items: [], say: 'hello' }] }) }); 1");
    await p.route('labs/x'); await p.route('labs');
    assert.equal(await p.exists('.tool-card.soon[data-lab="zz-e2e"]'), false, 'no placeholder');
    assert.ok(await p.exists('a.tool-card[data-lab="zz-e2e"]'), 'the lab itself');
    await p.click('a.tool-card[data-lab="zz-e2e"]');
    await p.wait("!!document.querySelector('#labView[data-lab=zz-e2e]')");
    assert.match(await p.text('#labSay'), /hello/);
  });

  t.test('the setup is kept in this browser', async (p) => {
    await p.route('labs/sample-sched');
    await p.setValue('#lab-policy', '1', 'change');
    await p.sleep(250);
    await p.reload();
    await p.route('labs/sample-sched');
    assert.equal(await p.ev(L('P.values.policy')), 'sjf');
    await p.click('#btnLabDefaults');
    await p.waitModal();
    await p.modalButton('Use the defaults');
    assert.equal(await p.ev(L('P.values.policy')), 'rr');
  });

  t.test('two code fields keep their own editors', async (p) => {
    await p.ev(`(() => { if (!Proses.Labs.get('zz-two-code')) Proses.Labs.add({ id: 'zz-two-code', title: 'Two programs', hidden: true,
      setup: { fields: [{ id: 'a', label: 'First', type: 'code', def: 'int main(void) { return 1; }', files: false }, { id: 'b', label: 'Second', type: 'code', def: 'int main(void) { return 2; }', files: false }] },
      run: (v) => ({ frames: [{ items: [], say: 'a has ' + v.a.length + ', b has ' + v.b.length, marks: [{ line: 1, tag: 'X', cls: 'p1' }], editor: 'b' }] }) }); return 1; })()`);
    await p.route('labs/zz-two-code');
    assert.equal(await p.count('#labView .le'), 2, 'an editor each');
    assert.equal(await p.ev("document.querySelector('#lab-a').value"), 'int main(void) { return 1; }');
    assert.equal(await p.ev("document.querySelector('#lab-b').value"), 'int main(void) { return 2; }');
    await p.ev("Proses.app.page.lab.setup.set({ a: 'int main(void) { return 10; }', b: 'int main(void) { return 20; }' })");
    assert.equal(await p.ev("document.querySelector('#lab-a').value"), 'int main(void) { return 10; }', 'setting the values sets each field');
    assert.equal(await p.ev("document.querySelector('#lab-b').value"), 'int main(void) { return 20; }');
    await p.ev("Proses.app.page.lab.setup.editors.b.set('int x;', true)");
    assert.equal(await p.ev("Proses.app.page.lab.setup.get().a"), 'int main(void) { return 10; }', 'typing in one leaves the other alone');
    assert.equal(await p.ev("Proses.app.page.lab.setup.get().b"), 'int x;');
    await p.click('#btnLabRun');
    await p.wait("!!document.querySelector('[data-field=b] .le-tag')");
    assert.equal(await p.exists('[data-field=a] .le-tag'), false, 'a frame\'s tags go to the editor it names');
  });

  t.test('a tour step opens a lab set up, even on the lab\'s own page', async (p) => {
    await p.route('labs/sample-sched');
    await p.ev(`(() => { Proses.Content.tour({ id: 'zz-lab-tour', title: 'A lab tour', steps: [{ route: 'labs/sample-sched', text: 'The lab.' }, { lab: 'sample-sched', setup: { policy: 'srtn' }, target: '#labSetup', text: 'Now with SRTN.' }] }); Proses.Tour.start('zz-lab-tour'); return 1; })()`);
    await p.wait("!!document.querySelector('#tourNext')");
    await p.click('#tourNext');
    await p.wait("Proses.app.page && Proses.app.page.lab && Proses.app.page.lab.values.policy === 'srtn'", 8000);
    await p.wait("/Now with SRTN/.test((document.querySelector('#tourBox') || {}).innerText || '')", 5000);
    assert.ok(await p.exists('.tour-hi#labSetup'), 'the step\'s target is lit on the lab');
    await p.click('#tourClose');
  });
}
