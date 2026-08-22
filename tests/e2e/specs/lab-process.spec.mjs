// The Process lab: it opens on a program with its fork tree and tags in the editor; a typed program runs; the step
// controls move through the run; by hand, a click on a ready process runs it; "Every output" lists and replays the
// outputs; a share link carries the program, the policy and the seed into a fresh browser.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;
const FORKS = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    fork();\n    fork();\n    printf("hi\\n");\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab|progs):process/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens with the tree, the terminal and the process tags', async (p) => {
    await p.route('labs/process');
    await p.wait(L('P && P.frames.length > 5'));
    assert.ok(await p.exists('#labView svg [data-key="tr:n100"]'), 'process 100 is in the tree');
    assert.ok(await p.exists('#labView svg [data-key="tm:panel"]'), 'the terminal is drawn');
    await p.ev(L('P.go(3, true)'));
    assert.ok(await p.exists('.le-tag'), 'a process tag in the editor');
    assert.ok((await p.text('#labSay')).length > 20, 'a sentence for the step');
  });

  t.test('a typed program runs; step, step back and the end', async (p) => {
    await p.route('labs/process');
    await p.ev(`Proses.app.page.lab.setup.editor.set(${JSON.stringify(FORKS)}, true)`);
    await p.click('#btnLabRun');
    await p.wait(L("P.res && P.res.proc && P.res.proc.sys.out === 'hi\\nhi\\nhi\\nhi\\n'"));
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.click('#btnLabStep');
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.equal(await p.ev("document.querySelectorAll('#labView svg [data-key^=\"tr:n\"]').length"), 5, 'init and four processes');
  });

  t.test('by hand: a click on a ready process runs it', async (p) => {
    await p.route('labs/process');
    await p.ev(`Proses.app.page.lab.setup.editor.set(${JSON.stringify(FORKS)}, true)`);
    await p.setValue('#lab-policy', '0', 'change');
    await p.click('#btnLabRun');
    await p.wait(L('P.res && P.res.proc && P.res.proc.waiting'));
    await p.ev(L('(P.pause(), P.go(P.frames.length - 1, true), 1)'));
    assert.deepEqual(await p.ev(L('P.res.proc.waiting')), [100, 101]);
    await p.click('#labView svg [data-key="pick:101"]');
    await p.wait(L("P.values.sched === '101'"));
    assert.equal(await p.ev("document.querySelector('#lab-sched').value"), '101', 'the choice is in the setup');
    await p.click('#labView svg [data-key="pick:undo"]');
    await p.wait(L("P.values.sched === ''"));
  });

  t.test('every output: the count, and a replay of one', async (p) => {
    await p.route('labs/process');
    await p.click('.lab-presets .chip', 'fork count');
    await p.wait(L("/ROUNDS 2/.test(P.values.src) && P.res && P.res.proc"));
    await p.click('#labTab-outputs');
    await p.click('#plEvery');
    await p.wait("!!document.getElementById('plOuts')", 30000);
    assert.equal(await p.text('#plEveryCount'), '12');
    const want = await p.ev("document.querySelector('#plOuts .pl-out-text').textContent");
    await p.click('#plOuts .pl-out .btn');
    await p.wait(L("P.values.policy === 'hand' && P.res.proc && !P.res.proc.waiting"));
    assert.equal(await p.ev(L('P.res.proc.sys.out.trim()')), want, 'the replay prints that output');
  });

  t.test('a share link carries the program, the policy and the seed', async (p) => {
    await p.route('labs/process');
    await p.ev(`Proses.app.page.lab.setup.editor.set(${JSON.stringify(FORKS)}, true)`);
    await p.setValue('#lab-policy', '3', 'change');
    await p.setValue('#labSeed', '42', 'change');
    await p.wait(L("P.values.policy === 'random' && P.seed === 42 && P.res"));
    await p.click('#btnLabRun');
    await p.wait(L("P.res && /fork\\(\\);\\n    fork/.test(P.values.src)"));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/process\?s=P1\./);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.values.policy === 'random'"));
    assert.equal(await p.ev(L('P.seed')), 42);
    assert.equal(await p.ev("document.querySelector('#lab-src').value"), FORKS);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/process');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
