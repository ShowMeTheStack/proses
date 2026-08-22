// The Sync lab: it opens on the philosophers with the deadlock found and replayed; a typed program runs and is
// checked; the step controls move through it; by hand, a click on a thread runs it; a property edited in the
// specification changes the verdict; the Programs tab opens a program; a share link carries the setup into a
// fresh browser.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;
const RACE = '#include <pthread.h>\n\nint hits = 0;\n\nvoid *visit(void *arg) {\n    hits++;\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, visit, NULL);\n    pthread_create(&b, NULL, visit, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    return 0;\n}\n';

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab|progs):sync/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on the philosophers: the deadlock found, replayed, tagged in the editor', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res && P.res.sync && P.frames.length > 5'), 30000);
    assert.equal(await p.ev(L('P.res.sync.run.R.kind')), 'deadlock');
    assert.ok(await p.exists('#labView svg [data-key="vd:box"]'), 'the verdict box');
    assert.ok(await p.exists('#labView svg [data-key="tb:s0"]'), 'the table scene');
    await p.ev(L('(P.go(P.frames.length - 1, true), 1)'));
    assert.match(await p.text('#labSay'), /deadlock/);
    assert.ok(await p.exists('.le-tag'), 'a thread tag in the editor');
  });

  t.test('a typed program runs and is checked; step, step back and the end', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.ev(`Proses.app.page.lab.setup.editor.set(${JSON.stringify(RACE)}, true)`);
    await p.setValue('#lab-gran', '1', 'change');
    await p.ev(L("(P.values.spec = [{ kind: 'deadlock', what: '' }, { kind: 'end', what: 'hits == 2' }], P.setup.set(P.values), 1)"));
    await p.click('#btnLabRun');
    // the run with this program and this property, finished (the worker idle, no newer run pending)
    const done = "P.res && P.res.sync && P.res.sync.run.R && /hits/.test(P.res.sync.P.src) && P.res.sync.P.gran === 'machine' && P.res.sync.P.spec.rows.some((r) => r.what === 'hits == 2') && !Proses.SyncLab.remote.busy() && P.frames.length > 3";
    await p.wait(L(done), 60000);
    await p.sleep(300);
    await p.wait(L(done), 60000);
    assert.equal(await p.ev(L('P.res.sync.run.R.verdict')), 'violation', 'the lost update is found');
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.wait(L('P.i === 1'), 10000);
    await p.click('#btnLabStep');
    await p.wait(L('P.i === 2'), 10000);
    await p.click('#btnLabBack');
    await p.wait(L('P.i === 1'), 10000);
    await p.ev(L('(P.go(P.frames.length - 1, true), 1)'));
    assert.match(await p.text('#labSay'), /hits/);
  });

  t.test('by hand: a click on a thread runs it, undo takes it back', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.ev("Proses.SyncLab.open(Proses.app.page.lab, 'lock-order')");
    await p.wait(L("/lockB/.test(P.values.src) && P.res && P.res.sync"), 30000);
    await p.setValue('#lab-mode', '0', 'change');
    await p.wait(L("P.values.mode === 'hand' && P.res.sync.mode === 'hand' && P.res.sync.run.waiting"), 10000);
    await p.ev(L('(P.pause(), P.go(P.frames.length - 1, true), 1)'));
    const first = await p.ev(L('P.res.sync.run.beats.at(-1).names[P.res.sync.run.waiting[1]].name'));
    await p.click('#labView svg [data-key="pick:' + first + '"]');
    await p.wait(L('P.values.sched === ' + JSON.stringify(first)), 10000);
    assert.equal(await p.ev("document.querySelector('#lab-sched').value"), first, 'the choice is in the setup');
    await p.ev(L('(P.go(P.frames.length - 1, true), 1)'));
    await p.click('#labView svg [data-key="pick:undo"]');
    await p.wait(L("P.values.sched === ''"), 10000);
  });

  t.test('a property edited in the specification changes the verdict', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.ev("Proses.SyncLab.open(Proses.app.page.lab, 'race-mutex')");
    await p.wait(L("P.res && P.res.sync && P.res.sync.run.R && P.res.sync.run.R.verdict === 'ok'"), 30000);
    await p.setValue('#labSetup .lw-table tbody tr:nth-child(2) input[data-col="what"]', 'count == 3');
    await p.click('#btnLabRun');
    await p.wait(L("P.res && P.res.sync.run.R && P.res.sync.run.R.verdict === 'violation'"), 30000);
    assert.match(await p.ev(L("P.frames.at(-1).say")), /count == 3/);
  });

  t.test('the Programs tab opens a program', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.click('#labTab-programs');
    await p.click('#labTabBody button[data-prog="bug-wakeup"]');
    await p.wait(L("/notifier/.test(P.values.src) && P.res && P.res.sync && P.res.sync.run.R"), 30000);
    assert.equal(await p.ev(L('P.res.sync.run.R.kind')), 'deadlock');
  });

  t.test('Check it runs in a worker: the page shows progress, and Cancel stops it', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    assert.ok(await p.ev('Proses.SyncLab.remote.available()'), 'a worker can be made from the page');
    await p.ev("(() => { Proses.SyncLab.open(Proses.app.page.lab, 'rw-writers'); return 1; })()");
    await p.wait("!!document.getElementById('btnSyncCancel')", 10000);
    await p.wait("/states made so far/.test(document.getElementById('labSay').textContent)", 10000);
    assert.equal(await p.ev('typeof Proses.app.page.lab.go'), 'function', 'the page answers while the check runs');
    await p.click('#btnSyncCancel');
    await p.wait(L("P.frames.length === 1 && /cancelled/.test(P.frames[0].say)"), 10000);
    await p.click('#btnLabRun');
    await p.wait(L("P.res && P.res.sync && P.res.sync.run.R && P.res.sync.run.R.verdict === 'starve'"), 60000);
  });

  t.test('a step-machine program opens on the stage, with its listing, and runs by hand', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.click('#labTab-programs');
    await p.click('#labTabBody button[data-cat="lock-ticket"]');
    await p.wait(L("P.values.source === 'model' && P.res && P.res.sync && P.res.sync.P.machine && P.res.sync.run.R"), 30000);
    assert.equal(await p.ev(L('P.res.sync.run.R.verdict')), 'ok');
    assert.ok(await p.exists('#labView svg [data-key="th:t"]'), 'the threads are drawn');
    await p.click('#labTab-listing');
    assert.ok(await p.exists('#labTabBody .sl-listing li'), 'the listing');
    await p.setValue('#lab-mode', '0', 'change');
    await p.wait(L("P.res.sync.mode === 'hand' && P.res.sync.run.waiting"), 10000);
    await p.ev(L('(P.pause(), P.go(P.frames.length - 1, true), 1)'));
    const name = await p.ev(L('P.res.sync.run.label(P.res.sync.run.waiting[1])'));
    await p.click('#labView svg [data-key="pick:' + name + '"]');
    await p.wait(L('P.values.sched === ' + JSON.stringify(name)), 10000);
  });

  t.test('a share link carries the program, the mode and the seed', async (p) => {
    await p.route('labs/sync');
    await p.wait(L('P && P.res'), 30000);
    await p.ev("Proses.SyncLab.open(Proses.app.page.lab, 'buffer')");
    await p.wait(L("P.values.mode === 'random' && P.res && P.res.sync"), 30000);
    await p.setValue('#labSeed', '42', 'change');
    await p.wait(L('P.seed === 42 && P.res'), 10000);
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/sync\?s=P1\./);
    const trace = await p.ev(L('JSON.stringify(P.res.trace.map((x) => x.say))'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.res.sync && P.values.mode === 'random'"), 30000);
    assert.equal(await p.ev(L('P.seed')), 42);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace.map((x) => x.say))')), trace, 'the same run');
  });
}
